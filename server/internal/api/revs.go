package api

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"carino.systems/topo/server/internal/notify"
	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// RevHeaderJSON is one revision header on the wire (design §4.7).
type RevHeaderJSON struct {
	N        int64  `json:"n"`
	Base     int64  `json:"base"`
	Prev     string `json:"prev"`
	Epoch    int64  `json:"epoch"`
	RSeq     int64  `json:"rseq"`
	Author   string `json:"author"`
	Dev      string `json:"dev"`
	At       int64  `json:"at"`
	Size     int64  `json:"size"`
	CTHash   string `json:"ctHash"`
	Sig      string `json:"sig"`
	H        string `json:"h"`
	Received int64  `json:"received"`
	Pruned   bool   `json:"pruned"`
}

func revJSON(r *store.Rev) RevHeaderJSON {
	return RevHeaderJSON{r.N, r.Base, r.Prev, r.Epoch, r.RSeq, r.Author, r.Device, r.At, r.Size, r.CTHash, r.Sig, r.H, r.Received, r.Pruned}
}

// revEnvelope is what a browser pushes.
type revEnvelope struct {
	N      int64  `json:"n"`
	Base   int64  `json:"base"`
	Prev   string `json:"prev"`
	Epoch  int64  `json:"epoch"`
	RSeq   int64  `json:"rseq"`
	Author string `json:"author"`
	Dev    string `json:"dev"`
	At     int64  `json:"at"`
	CTHash string `json:"ctHash"`
	Sig    string `json:"sig"`
	IV     string `json:"iv"`
	CT     string `json:"ct"`
}

// declaredEvent is one event the browser declares with a push (D67).
type declaredEvent struct {
	Kind string   `json:"kind"`
	To   []string `json:"to"`
}

// pushRev: POST /api/sites/{site}/revs {rev, events}. The expensive checks
// (sizes, the ciphertext hash, the signature, the chain hash) run before
// the write transaction (amendment D1); inside it, the head, chain, epoch,
// roster, role and the author's key are checked against the database, the
// revision stored, old bodies pruned (TOPO_REV_CAP, TOPO_SITE_MAX_BYTES)
// and the notifications queued. Members get a live `head` event.
func (s *Server) pushRev(w http.ResponseWriter, r *http.Request) {
	maxB := s.d.Cfg.MaxRevBytes
	var req struct {
		Rev    revEnvelope     `json:"rev"`
		Events []declaredEvent `json:"events"`
	}
	if err := decodeBody(w, r, maxB*4/3+64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	e := req.Rev
	iv, errIV := tcrypto.DecodeB64(e.IV)
	ct, errCT := tcrypto.DecodeB64(e.CT)
	if errIV != nil || errCT != nil || len(iv) != 12 || len(ct) < 16 {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "ct"})
		return
	}
	if int64(len(ct)) > maxB {
		writeError(w, http.StatusRequestEntityTooLarge, ErrTooLarge, map[string]any{"max": maxB})
		return
	}
	if e.Author != sess.UserID || e.Dev == "" || e.Dev != sess.DeviceID || e.N < 1 || e.Base < 0 || e.At <= 0 {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "rev"})
		return
	}
	if len(req.Events) > notify.MaxEvents {
		req.Events = req.Events[:notify.MaxEvents]
	}
	if tcrypto.CTHash(iv, ct) != e.CTHash {
		writeError(w, http.StatusUnprocessableEntity, ErrBadSignature, nil)
		return
	}
	author, err := store.UserByID(ctx, s.d.Store.R, sess.UserID)
	if err != nil {
		s.internal(w, "push", err)
		return
	}
	hdr := &tcrypto.RevHeader{Site: site, N: e.N, Base: e.Base, Prev: e.Prev, Epoch: e.Epoch, RSeq: e.RSeq, Author: e.Author, Dev: e.Dev, At: e.At, CTHash: e.CTHash}
	signed := hdr.SignedString()
	if author.SigPub == "" || tcrypto.VerifyB64(author.SigPub, []byte(signed), e.Sig) != nil {
		writeError(w, http.StatusUnprocessableEntity, ErrBadSignature, nil)
		return
	}
	h := tcrypto.ChainHash(signed, e.Sig)
	now := s.d.Now()
	ms := now.UnixMilli()

	var members []string
	err = s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		st, err := store.SiteByID(ctx, tx, site)
		if err != nil {
			return notFoundOr(err)
		}
		if e.Base != st.HeadN {
			return failWith(http.StatusConflict, ErrStaleBase, map[string]any{"head": headJSON{st.HeadN, st.HeadH}})
		}
		if e.N != e.Base+1 || e.Prev != st.HeadH {
			return fail(http.StatusUnprocessableEntity, ErrBadChain)
		}
		if e.Epoch != st.Epoch {
			return failWith(http.StatusConflict, ErrStaleEpoch, map[string]any{"epoch": st.Epoch})
		}
		if e.RSeq != st.RosterSeq {
			return failWith(http.StatusConflict, ErrStaleRoster, map[string]any{"rosterSeq": st.RosterSeq})
		}
		all, err := store.SiteMembers(ctx, tx, site)
		if err != nil {
			return err
		}
		var me *store.Member
		for i := range all {
			if all[i].UserID == sess.UserID {
				me = &all[i]
			}
			if all[i].Status == "granted" {
				members = append(members, all[i].UserID)
			}
		}
		if me == nil || me.Status != "granted" || (me.Role != "owner" && me.Role != "provider") {
			return fail(http.StatusForbidden, ErrForbidden)
		}
		// The key verified above must still be the author's (a reset in
		// between would make the signature meaningless).
		if me.SigPub != author.SigPub || me.KeysAt != author.KeysAt {
			return fail(http.StatusUnprocessableEntity, ErrBadSignature)
		}
		size := int64(len(ct))
		if fits, err := store.Prune(ctx, tx, s.d.Blobs, site, st.HeadN, 0, s.d.Cfg.SiteMaxBytes, size); err != nil {
			return err
		} else if !fits {
			return failWith(http.StatusRequestEntityTooLarge, ErrSiteFull, map[string]any{"max": s.d.Cfg.SiteMaxBytes})
		}
		rev := &store.Rev{SiteID: site, N: e.N, Base: e.Base, Prev: e.Prev, Epoch: e.Epoch, RSeq: e.RSeq, Author: e.Author, Device: e.Dev,
			At: e.At, Received: ms, Size: size, CTHash: e.CTHash, Sig: e.Sig, H: h}
		if err := store.InsertRev(ctx, tx, rev); err != nil {
			return err
		}
		if err := s.d.Blobs.Put(ctx, tx, site, e.N, e.IV, ct); err != nil {
			return err
		}
		if s.d.Cfg.RevCap > 0 {
			if _, err := store.Prune(ctx, tx, s.d.Blobs, site, e.N, s.d.Cfg.RevCap, 0, 0); err != nil {
				return err
			}
		}
		if err := store.TouchDevice(ctx, tx, e.Dev, ms); err != nil {
			return err
		}
		return s.pushNotifications(ctx, tx, now, site, sess.UserID, req.Events, all)
	})
	if err != nil {
		s.answer(w, "push", err)
		return
	}
	s.publish(members, "head", map[string]any{"site": site, "n": e.N, "h": h})
	s.wake()
	writeJSON(w, http.StatusCreated, map[string]any{"n": e.N, "h": h})
}

// pushNotifications queues the emails a push causes (design §7.4): the
// declared events (unknown kinds and ids that are not granted members are
// dropped, never failing the push; amendment F2 caps incident-sent per
// author and recipient), then the revision digest for everyone who did
// not just get an event email from this push.
func (s *Server) pushNotifications(ctx context.Context, tx *sql.Tx, now time.Time, site, author string, events []declaredEvent, all []store.Member) error {
	granted := map[string]bool{}
	for _, m := range all {
		if m.Status == "granted" {
			granted[m.UserID] = true
		}
	}
	got := map[string]bool{}
	hourAgo := now.Add(-time.Hour).UnixMilli()
	for _, ev := range events {
		if !notify.Declarable[ev.Kind] {
			continue
		}
		var to []string
		seen := map[string]bool{}
		for i, u := range ev.To {
			if i >= notify.MaxTo {
				break
			}
			if !granted[u] || seen[u] || u == author {
				continue
			}
			seen[u] = true
			if ev.Kind == "incident-sent" {
				n, err := store.CountDeclared(ctx, tx, site, author, ev.Kind, u, hourAgo)
				if err != nil {
					return err
				}
				if n >= notify.DeclarePerHourCap {
					continue
				}
				if err := store.AddDeclared(ctx, tx, site, author, ev.Kind, u, now.UnixMilli()); err != nil {
					return err
				}
			}
			to = append(to, u)
		}
		rc := notify.Recipients(ev.Kind, author, to, all)
		if _, err := notify.Enqueue(ctx, tx, site, ev.Kind, rc, notify.Options{Now: now, EventDelay: s.d.Cfg.NotifyEventDelay}); err != nil {
			return err
		}
		for _, m := range rc {
			got[m.UserID] = true
		}
	}
	var digest []store.Member
	for _, m := range notify.Recipients("revision", author, nil, all) {
		if !got[m.UserID] {
			digest = append(digest, m)
		}
	}
	_, err := notify.Enqueue(ctx, tx, site, "revision", digest, notify.Options{Now: now, RevisionWindow: time.Duration(s.d.Cfg.NotifyRevisionMinutes) * time.Minute})
	return err
}

// pullRevs: GET /api/sites/{site}/revs?since=k&limit=1000: the headers after
// k and, when the head is newer than k, the head's body.
func (s *Server) pullRevs(w http.ResponseWriter, r *http.Request) {
	since, ok := sinceParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "since"})
		return
	}
	limit := 1000
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "limit"})
			return
		}
		limit = min(n, 1000)
	}
	ctx := r.Context()
	site := r.PathValue("site")
	// One read transaction: the head and the headers agree.
	tx, err := s.d.Store.R.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		s.internal(w, "pull", err)
		return
	}
	defer tx.Rollback()
	st, err := store.SiteByID(ctx, tx, site)
	if err != nil {
		s.answer(w, "pull", notFoundOr(err))
		return
	}
	revs, err := store.RevsSince(ctx, tx, site, since, limit)
	if err != nil {
		s.internal(w, "pull", err)
		return
	}
	var body any
	if st.HeadN > since {
		iv, rc, _, err := s.d.Blobs.Get(ctx, site, st.HeadN)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			s.internal(w, "pull", err)
			return
		}
		if err == nil {
			ct, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				s.internal(w, "pull", err)
				return
			}
			body = map[string]any{"n": st.HeadN, "iv": iv, "ct": tcrypto.B64.EncodeToString(ct)}
		}
	}
	hs := make([]RevHeaderJSON, 0, len(revs))
	for i := range revs {
		hs = append(hs, revJSON(&revs[i]))
	}
	more := len(revs) > 0 && revs[len(revs)-1].N < st.HeadN
	writeJSON(w, http.StatusOK, map[string]any{
		"head": map[string]any{"n": st.HeadN, "h": st.HeadH, "epoch": st.Epoch, "rosterSeq": st.RosterSeq},
		"revs": hs, "more": more, "body": body,
	})
}

// getRev: GET /api/sites/{site}/revs/{n}: one header and its body; 410 when
// the body was pruned (amendment C4: the browser then falls back to a
// two-way review).
func (s *Server) getRev(w http.ResponseWriter, r *http.Request) {
	n, err := strconv.ParseInt(r.PathValue("n"), 10, 64)
	if err != nil || n < 1 {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "n"})
		return
	}
	ctx := r.Context()
	site := r.PathValue("site")
	rev, err := store.RevByN(ctx, s.d.Store.R, site, n)
	if err != nil {
		s.answer(w, "rev", notFoundOr(err))
		return
	}
	if rev.Pruned {
		writeError(w, http.StatusGone, ErrGone, map[string]any{"rev": revJSON(rev)})
		return
	}
	iv, rc, _, err := s.d.Blobs.Get(ctx, site, n)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusGone, ErrGone, map[string]any{"rev": revJSON(rev)})
		return
	}
	if err != nil {
		s.internal(w, "rev", err)
		return
	}
	defer rc.Close()
	ct, err := io.ReadAll(rc)
	if err != nil {
		s.internal(w, "rev", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rev": revJSON(rev), "body": map[string]any{"iv": iv, "ct": tcrypto.B64.EncodeToString(ct)}})
}
