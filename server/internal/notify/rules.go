package notify

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"carino.systems/topo/server/internal/store"
)

// Event kinds a browser may declare when it pushes (D67). The server cannot
// read the document, so these come in clear with the push; member-invited,
// member-joined and granted come from the server itself and cannot be
// declared.
var Declarable = map[string]bool{"incident-sent": true, "visit-recorded": true, "incident-closed": true}

// Limits (design §7.4, amendment F2).
const (
	Debounce          = 2 * time.Minute // event kinds merge within this window
	PerSiteHourCap    = 20              // event emails per recipient per site per hour
	DeclarePerHourCap = 5               // incident-sent from one author to one person per site per hour
	MaxEvents         = 20              // per push
	MaxTo             = 50              // recipient ids per event
)

// eventKinds are the opt-out-able kinds counted by the hourly cap.
var eventKinds = []string{"member-joined", "incident-sent", "visit-recorded", "incident-closed", "revision"}

// prefOf is the per-user switch for a kind (api.NotifyKeys holds the same
// names and the defaults).
func prefOf(kind, role string) string {
	switch kind {
	case "incident-sent":
		return "incident"
	case "visit-recorded":
		return "visit"
	case "incident-closed":
		return "closed"
	case "member-joined":
		return "join"
	case "revision":
		if role == "owner" {
			return "revision"
		}
		return "revisionShared"
	}
	return ""
}

// Defaults are the notification switches before a person changes them.
var Defaults = map[string]bool{
	"revision":       true,
	"revisionShared": false,
	"visit":          true,
	"incident":       true,
	"closed":         true,
	"join":           true,
}

// Effective merges a stored notify JSON over the defaults.
func Effective(stored string) map[string]bool {
	out := make(map[string]bool, len(Defaults))
	for k, v := range Defaults {
		out[k] = v
	}
	var m map[string]bool
	if json.Unmarshal([]byte(stored), &m) == nil {
		for k, v := range m {
			if _, ok := Defaults[k]; ok {
				out[k] = v
			}
		}
	}
	return out
}

// Recipients is who gets an email for kind (design §7.4), before the
// debounce and caps. members is the site's membership list; author is the
// person who caused the event (never notified); to is the declared
// recipient ids (incident and visit events). Waiting members, disabled
// accounts, a per-site mute and the person's own switch all exclude.
func Recipients(kind, author string, to []string, members []store.Member) []store.Member {
	named := map[string]bool{}
	for _, u := range to {
		named[u] = true
	}
	var out []store.Member
	for _, m := range members {
		if m.UserID == author || m.Status != "granted" || m.Disabled || m.Muted || m.Email == "" {
			continue
		}
		var want bool
		switch kind {
		case "incident-sent", "incident-closed":
			want = named[m.UserID]
		case "visit-recorded":
			want = m.Role == "owner" || named[m.UserID]
		case "member-joined":
			want = m.Role == "owner"
		case "revision":
			want = true
		}
		if !want || !Effective(m.Notify)[prefOf(kind, m.Role)] {
			continue
		}
		out = append(out, m)
	}
	return out
}

// Options are the settings Enqueue needs.
type Options struct {
	Now            time.Time
	RevisionWindow time.Duration // TOPO_NOTIFY_REVISION_MINUTES
	// EventDelay is how long an event kind waits (and merges) before it is
	// sent (TOPO_NOTIFY_EVENT_SECONDS). Zero means Debounce; a negative value
	// means no wait (tests, the e2e).
	EventDelay time.Duration
	Data       map[string]string
}

// Enqueue queues kind for each recipient about a site, inside tx, applying
// the dedupe (an unsent row for the same person, site and kind gains one to
// its count), the per-site hourly cap, and for 'revision' the digest
// window (the row is due no sooner than the window after the last one
// sent). It returns how many rows were added or merged.
func Enqueue(ctx context.Context, tx *sql.Tx, site, kind string, recipients []store.Member, o Options) (int, error) {
	ms := o.Now.UnixMilli()
	hourAgo := o.Now.Add(-time.Hour).UnixMilli()
	data := "{}"
	if len(o.Data) > 0 {
		b, _ := json.Marshal(o.Data)
		data = string(b)
	}
	done := 0
	for _, m := range recipients {
		dedupe := m.UserID + "|" + site + "|" + kind
		if reason := o.Data["reason"]; reason != "" {
			// A key change is a different warning (amendment A6): never
			// merged into an ordinary join.
			dedupe += "|" + reason
		}
		merged, err := store.MergeMail(ctx, tx, dedupe)
		if err != nil {
			return done, err
		}
		if merged {
			done++
			continue
		}
		n, err := store.CountSiteMail(ctx, tx, m.UserID, site, eventKinds, hourAgo)
		if err != nil {
			return done, err
		}
		if n >= PerSiteHourCap {
			continue
		}
		due := ms
		d := data
		if kind == "revision" {
			last, err := store.LastSent(ctx, tx, m.UserID, site, kind)
			if err != nil {
				return done, err
			}
			if w := o.RevisionWindow.Milliseconds(); last > 0 && last+w > due {
				due = last + w
			}
			b, _ := json.Marshal(map[string]string{"since": o.Now.UTC().Format(time.RFC3339)})
			d = string(b)
		} else {
			switch {
			case o.EventDelay < 0:
			case o.EventDelay == 0:
				due = ms + Debounce.Milliseconds()
			default:
				due = ms + o.EventDelay.Milliseconds()
			}
		}
		if err := store.InsertMail(ctx, tx, &store.Mail{ID: store.NewID("o_"), Kind: kind, To: m.Email, UserID: m.UserID, SiteID: site,
			Lang: m.Lang, Data: d, Dedupe: dedupe, Created: ms, SendAfter: due}); err != nil {
			return done, err
		}
		done++
	}
	return done, nil
}
