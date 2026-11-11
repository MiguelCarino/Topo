// Package notify sends the queued mail. Handlers never send: they write an
// outbox row (in the same transaction as the change it reports) and wake
// the worker, so a slow or failing mail server never slows a request and a
// restart loses nothing (D74).
//
// rules.go decides who gets what (design §7.4); the worker sends what is
// queued.
package notify

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/store"
)

// Backoff is the wait after each failed try; after MaxTries the row is
// given up (sent = -1) and logged at warn.
var Backoff = []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour}

// MaxTries before a message is given up.
const MaxTries = 8

// Worker drains the outbox.
type Worker struct {
	St        *store.Store
	Mailer    mail.Mailer
	Log       *slog.Logger
	Now       func() time.Time
	PublicURL string // origin + "/", the only link a message may carry besides its own
	PerMinute int    // global send cap (TOPO_MAIL_PER_MINUTE)
	// Online reports whether a user has a live stream open; a revision
	// digest that comes due while they are online is skipped (design §7.4:
	// they see the changes arrive). Nil means nobody is online.
	Online func(userID string) bool

	wake chan struct{}
	mu   sync.Mutex
	sent []time.Time // send times within the last minute
}

// New returns a worker; Run starts it.
func New(st *store.Store, m mail.Mailer, log *slog.Logger, now func() time.Time, publicURL string, perMinute int) *Worker {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	if perMinute <= 0 {
		perMinute = 30
	}
	return &Worker{St: st, Mailer: m, Log: log, Now: now, PublicURL: publicURL, PerMinute: perMinute, wake: make(chan struct{}, 1)}
}

// Wake asks the worker to look at the outbox now. It never blocks.
func (w *Worker) Wake() {
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

// Run loops until ctx ends: on a wake, and every 5 s. A send in flight when
// ctx ends is finished (it has its own 30 s limit), then Run returns.
func (w *Worker) Run(ctx context.Context) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		if _, err := w.Drain(ctx); err != nil && ctx.Err() == nil {
			w.Log.Error("mail outbox", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-w.wake:
		case <-t.C:
		}
	}
}

// capWait reports how long until the global cap allows another send.
func (w *Worker) capWait(now time.Time) time.Duration {
	w.mu.Lock()
	defer w.mu.Unlock()
	keep := w.sent[:0]
	for _, t := range w.sent {
		if now.Sub(t) < time.Minute {
			keep = append(keep, t)
		}
	}
	w.sent = keep
	if len(w.sent) < w.PerMinute {
		return 0
	}
	return time.Minute - now.Sub(w.sent[0])
}

func (w *Worker) noteSent(now time.Time) {
	w.mu.Lock()
	w.sent = append(w.sent, now)
	w.mu.Unlock()
}

// Drain sends every due row the global cap allows and returns how many
// were sent. It stops early when ctx ends (between messages) or the cap is
// reached; the rest waits for the next round.
func (w *Worker) Drain(ctx context.Context) (int, error) {
	sent := 0
	for ctx.Err() == nil {
		now := w.Now()
		if w.capWait(now) > 0 {
			return sent, nil
		}
		rows, err := store.DueMail(ctx, w.St.R, now.UnixMilli(), 20)
		if err != nil || len(rows) == 0 {
			return sent, err
		}
		for i := range rows {
			if ctx.Err() != nil || w.capWait(w.Now()) > 0 {
				return sent, nil
			}
			ok, err := w.sendOne(ctx, &rows[i])
			if err != nil {
				return sent, err
			}
			if ok {
				sent++
			}
		}
	}
	return sent, nil
}

// sendOne renders and sends one row and records the outcome. A send error
// is not returned (it is recorded on the row); only database errors are.
func (w *Worker) sendOne(ctx context.Context, row *store.Mail) (bool, error) {
	var data mail.Data
	if err := json.Unmarshal([]byte(row.Data), &data); err != nil {
		data = mail.Data{}
	}
	if data["url"] == "" {
		data["url"] = w.PublicURL
	}
	if row.Kind == "revision" {
		if w.Online != nil && row.UserID != "" && w.Online(row.UserID) {
			return false, store.MailSkipped(ctx, w.St.W, row.ID)
		}
		data["n"] = strconv.Itoa(row.Count)
		if t, err := time.Parse(time.RFC3339, data["since"]); err == nil {
			data["time"] = t.UTC().Format("2006-01-02 15:04 UTC")
		}
	} else if row.Count > 1 {
		data["n"] = strconv.Itoa(row.Count)
	}
	if row.SiteID != "" {
		// The site name goes in only while its owner allows it in clear
		// (D68), read at send time so turning it off takes effect at once.
		name, err := store.SiteNameClear(ctx, w.St.R, row.SiteID)
		if err != nil {
			return false, err
		}
		if name != "" {
			data["name"] = name
		} else {
			delete(data, "name")
		}
	}
	// The file a report carries (D97). Gone (a site deleted meanwhile): the
	// message goes without it, and says nothing of it.
	var att *mail.Attachment
	if row.FileID != "" {
		f, ferr := store.GetMailFile(ctx, w.St.R, row.FileID)
		if errors.Is(ferr, sql.ErrNoRows) {
			w.Log.Warn("mail attachment missing: sending without it", "kind", row.Kind, "to", mail.Mask(row.To))
			delete(data, "attach")
		} else if ferr != nil {
			return false, ferr
		} else {
			att = &mail.Attachment{Name: f.Name, Type: f.Type, Data: f.Data}
		}
	}
	msg, err := mail.Render(row.Kind, row.Lang, data)
	sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	if err == nil {
		msg.ID, msg.To, msg.Site = row.ID, row.To, row.SiteID
		msg.Attachment = att
		w.noteSent(w.Now())
		err = w.Mailer.Send(sendCtx, msg)
	}
	now := w.Now()
	if err == nil {
		if row.Kind == "revision" && row.UserID != "" && row.SiteID != "" {
			if err := store.SetLastSent(sendCtx, w.St.W, row.UserID, row.SiteID, row.Kind, now.UnixMilli()); err != nil {
				return false, err
			}
		}
		if err := store.MailSent(sendCtx, w.St.W, row.ID, now.UnixMilli()); err != nil {
			return false, err
		}
		return true, w.dropFile(sendCtx, row)
	}
	tries := row.Tries + 1
	var next int64
	if tries < MaxTries {
		b := Backoff[min(tries-1, len(Backoff)-1)]
		next = now.Add(b).UnixMilli()
		w.Log.Info("mail not sent yet: will retry", "kind", row.Kind, "to", mail.Mask(row.To), "try", tries, "in", b.String(), "err", err)
	} else {
		w.Log.Warn("mail given up", "kind", row.Kind, "to", mail.Mask(row.To), "tries", tries, "err", err)
	}
	msgText := err.Error()
	if len(msgText) > 500 {
		msgText = msgText[:500]
	}
	if err := store.MailRetry(sendCtx, w.St.W, row.ID, next, msgText); err != nil {
		return false, err
	}
	if next == 0 {
		return false, w.dropFile(sendCtx, row)
	}
	return false, nil
}

// dropFile deletes the row's file once no other row waits for it.
func (w *Worker) dropFile(ctx context.Context, row *store.Mail) error {
	if row.FileID == "" {
		return nil
	}
	_, err := store.DropMailFileIfUnused(ctx, w.St.W, row.FileID)
	return err
}
