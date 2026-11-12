package api

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"

	"carino.systems/topo/server/internal/notify"
	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// Provider visits through the owner (docs/SCOPE.md step 7, D139, D153,
// D154). A provider member's Record visit uploads a visit copy: the network
// they edited, sealed with the site key, on top of the server revision they
// started from. It waits for an owner, every time. An owner's browser
// reviews it three-way against that revision, writes the result as an
// ordinary revision, then says approved or rejected here; the provider's
// browser takes the server's version and deletes its copy.

// MaxWaitingVisits caps the copies waiting on one site.
const MaxWaitingVisits = 64

var (
	visitIDRe   = regexp.MustCompile(`^v_[A-Za-z0-9_-]{16,40}$`)
	visitSlotRe = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)
)

// VisitJSON is one copy's header on the wire.
type VisitJSON struct {
	ID        string `json:"id"`
	Author    string `json:"author"`
	Email     string `json:"email,omitempty"`
	Dev       string `json:"dev"`
	Slot      string `json:"slot"`
	BaseN     int64  `json:"baseN"`
	Epoch     int64  `json:"epoch"`
	RSeq      int64  `json:"rseq"`
	At        int64  `json:"at"`
	Received  int64  `json:"received"`
	Replaced  int64  `json:"replaced"`
	Size      int64  `json:"size"`
	CTHash    string `json:"ctHash"`
	Sig       string `json:"sig"`
	State     string `json:"state"`
	DecidedAt int64  `json:"decidedAt,omitempty"`
	DecidedBy string `json:"decidedBy,omitempty"`
	DecidedN  int64  `json:"decidedN,omitempty"`
}

func visitJSON(v *store.VisitCopy, email string) VisitJSON {
	return VisitJSON{v.ID, v.Author, email, v.Device, v.Slot, v.BaseN, v.Epoch, v.RSeq, v.At, v.Received, v.Replaced, v.Size, v.CTHash, v.Sig,
		v.State, v.DecidedAt, v.DecidedBy, v.DecidedN}
}

type visitEnvelope struct {
	ID     string `json:"id"`
	Slot   string `json:"slot"`
	BaseN  int64  `json:"baseN"`
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

// owners lists the granted owners' ids and, separately, the granted
// members (for the mail rules).
func ownersOf(all []store.Member) []string {
	var out []string
	for _, m := range all {
		if m.Status == "granted" && m.Role == "owner" {
			out = append(out, m.UserID)
		}
	}
	return out
}

// putVisit: POST /api/sites/{site}/visits {copy}. Providers only (an
// owner's own edits are revisions). The checks mirror a push: the device,
// the ciphertext hash and the author's signature, then, inside the
// transaction, the base (a revision that exists), the epoch and the roster
// in force. Owners get a live `visits` event and the visit-recorded email.
func (s *Server) putVisit(w http.ResponseWriter, r *http.Request) {
	maxB := s.d.Cfg.MaxRevBytes
	var req struct {
		Copy visitEnvelope `json:"copy"`
	}
	if err := decodeBody(w, r, maxB*4/3+64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	e := req.Copy
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
	if !visitIDRe.MatchString(e.ID) || !visitSlotRe.MatchString(e.Slot) || e.Author != sess.UserID || e.Dev == "" || e.Dev != sess.DeviceID || e.BaseN < 1 || e.At <= 0 {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "copy"})
		return
	}
	if tcrypto.CTHash(iv, ct) != e.CTHash {
		writeError(w, http.StatusUnprocessableEntity, ErrBadSignature, nil)
		return
	}
	author, err := store.UserByID(ctx, s.d.Store.R, sess.UserID)
	if err != nil {
		s.internal(w, "visit", err)
		return
	}
	hdr := &tcrypto.VisitHeader{Site: site, ID: e.ID, Slot: e.Slot, BaseN: e.BaseN, Epoch: e.Epoch, RSeq: e.RSeq, Author: e.Author, Dev: e.Dev, At: e.At, CTHash: e.CTHash}
	if author.SigPub == "" || tcrypto.VerifyB64(author.SigPub, []byte(hdr.SignedString()), e.Sig) != nil {
		writeError(w, http.StatusUnprocessableEntity, ErrBadSignature, nil)
		return
	}
	now := s.d.Now()
	ms := now.UnixMilli()
	v := &store.VisitCopy{ID: e.ID, SiteID: site, Author: e.Author, Device: e.Dev, Slot: e.Slot, BaseN: e.BaseN, Epoch: e.Epoch, RSeq: e.RSeq,
		At: e.At, Received: ms, Size: int64(len(ct)), CTHash: e.CTHash, Sig: e.Sig, IV: e.IV, CT: ct}
	var owners []string
	var replacedID string
	err = s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		st, err := store.SiteByID(ctx, tx, site)
		if err != nil {
			return notFoundOr(err)
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
		}
		if me == nil || me.Status != "granted" || me.Role != "provider" {
			return fail(http.StatusForbidden, ErrForbidden)
		}
		if me.SigPub != author.SigPub || me.KeysAt != author.KeysAt {
			return fail(http.StatusUnprocessableEntity, ErrBadSignature)
		}
		if e.BaseN > st.HeadN {
			return failWith(http.StatusConflict, ErrStaleBase, map[string]any{"head": headJSON{st.HeadN, st.HeadH}})
		}
		if _, err := store.RevByN(ctx, tx, site, e.BaseN); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return failWith(http.StatusConflict, ErrStaleBase, map[string]any{"head": headJSON{st.HeadN, st.HeadH}})
			}
			return err
		}
		if e.Epoch != st.Epoch {
			return failWith(http.StatusConflict, ErrStaleEpoch, map[string]any{"epoch": st.Epoch})
		}
		if e.RSeq != st.RosterSeq {
			return failWith(http.StatusConflict, ErrStaleRoster, map[string]any{"rosterSeq": st.RosterSeq})
		}
		n, err := store.CountWaitingVisits(ctx, tx, site)
		if err != nil {
			return err
		}
		// A copy that replaces one of the author's own never counts twice.
		var mine int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM visit_copies WHERE site_id = ? AND author = ? AND slot = ? AND state = 'waiting'", site, e.Author, e.Slot).Scan(&mine); err != nil {
			return err
		}
		if n-mine >= MaxWaitingVisits {
			return failWith(http.StatusConflict, ErrVisitsFull, map[string]any{"max": MaxWaitingVisits})
		}
		if replacedID, err = store.PutVisit(ctx, tx, v); err != nil {
			return err
		}
		if err := store.TouchDevice(ctx, tx, e.Dev, ms); err != nil {
			return err
		}
		owners = ownersOf(all)
		// The owners are told a visit waits (D67's visit-recorded, which
		// already goes to owners); the author never is.
		rc := notify.Recipients("visit-recorded", sess.UserID, nil, all)
		_, err = notify.Enqueue(ctx, tx, site, "visit-recorded", rc, notify.Options{Now: now, EventDelay: s.d.Cfg.NotifyEventDelay})
		return err
	})
	if err != nil {
		s.answer(w, "visit", err)
		return
	}
	s.publish(append(owners, sess.UserID), "visits", map[string]any{"site": site, "id": e.ID, "state": "waiting"})
	s.wake()
	out := map[string]any{"visit": visitJSON(v, "")}
	if replacedID != "" {
		out["replacedId"] = replacedID
	}
	writeJSON(w, http.StatusCreated, out)
}

// listVisits: GET /api/sites/{site}/visits. Owners see every copy, a
// provider their own; a viewer is refused.
func (s *Server) listVisits(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	me, err := store.MemberOf(ctx, s.d.Store.R, site, sess.UserID)
	if err != nil {
		s.answer(w, "visits", notFoundOr(err))
		return
	}
	author := ""
	switch me.Role {
	case "owner":
	case "provider":
		author = sess.UserID
	default:
		// A viewer has no visits to see.
		writeJSON(w, http.StatusOK, map[string]any{"visits": []VisitJSON{}})
		return
	}
	list, err := store.SiteVisits(ctx, s.d.Store.R, site, author)
	if err != nil {
		s.internal(w, "visits", err)
		return
	}
	all, err := store.SiteMembers(ctx, s.d.Store.R, site)
	if err != nil {
		s.internal(w, "visits", err)
		return
	}
	emails := map[string]string{}
	for _, m := range all {
		emails[m.UserID] = m.Email
	}
	out := make([]VisitJSON, 0, len(list))
	for i := range list {
		out = append(out, visitJSON(&list[i], emails[list[i].Author]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"visits": out})
}

// visitFor loads a copy the caller may see (an owner any, a provider their
// own); 404 otherwise.
func (s *Server) visitFor(r *http.Request) (*store.VisitCopy, *store.Member, error) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	me, err := store.MemberOf(ctx, s.d.Store.R, site, sess.UserID)
	if err != nil {
		return nil, nil, notFoundOr(err)
	}
	v, err := store.VisitByID(ctx, s.d.Store.R, site, r.PathValue("id"))
	if err != nil {
		return nil, nil, notFoundOr(err)
	}
	if me.Role != "owner" && v.Author != sess.UserID {
		return nil, nil, fail(http.StatusNotFound, ErrNotFound)
	}
	return v, me, nil
}

// getVisit: GET /api/sites/{site}/visits/{id}: the header and the body.
func (s *Server) getVisit(w http.ResponseWriter, r *http.Request) {
	v, _, err := s.visitFor(r)
	if err != nil {
		s.answer(w, "visit", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"visit": visitJSON(v, ""), "body": map[string]any{"iv": v.IV, "ct": tcrypto.B64.EncodeToString(v.CT)}})
}

// decideVisit: POST /api/sites/{site}/visits/{id}/decide {decision, n}.
// n is the revision the owner's browser wrote with the decision (the
// provider takes it); it must exist. The author gets a live event and the
// visit-recorded email saying approved or rejected (their "visit" switch).
func (s *Server) decideVisit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Decision string `json:"decision"`
		N        int64  `json:"n"`
	}
	if err := decodeBody(w, r, 4<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	if (req.Decision != "approved" && req.Decision != "rejected") || req.N < 1 {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "decision"})
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	id := r.PathValue("id")
	now := s.d.Now()
	var notifyUsers []string
	var author string
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		st, err := store.SiteByID(ctx, tx, site)
		if err != nil {
			return notFoundOr(err)
		}
		v, err := store.VisitByID(ctx, tx, site, id)
		if err != nil {
			return notFoundOr(err)
		}
		if v.State != "waiting" {
			return failWith(http.StatusConflict, ErrConflict, map[string]any{"state": v.State})
		}
		if req.N > st.HeadN || req.N < v.BaseN {
			return fail(http.StatusUnprocessableEntity, ErrBadChain)
		}
		if err := store.DecideVisit(ctx, tx, site, id, req.Decision, sess.UserID, req.N, now.UnixMilli()); err != nil {
			return notFoundOr(err)
		}
		author = v.Author
		all, err := store.SiteMembers(ctx, tx, site)
		if err != nil {
			return err
		}
		notifyUsers = ownersOf(all)
		var rc []store.Member
		for _, m := range all {
			if m.UserID != v.Author || m.Status != "granted" || m.Disabled || m.Muted || m.Email == "" || !notify.Effective(m.Notify)["visit"] {
				continue
			}
			rc = append(rc, m)
		}
		_, err = notify.Enqueue(ctx, tx, site, "visit-recorded", rc, notify.Options{Now: now, EventDelay: s.d.Cfg.NotifyEventDelay,
			Data: map[string]string{"reason": req.Decision}})
		return err
	})
	if err != nil {
		s.answer(w, "decide", err)
		return
	}
	s.publish(append(notifyUsers, author), "visits", map[string]any{"site": site, "id": id, "state": req.Decision, "n": req.N})
	s.wake()
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "state": req.Decision, "n": req.N})
}

// deleteVisit: DELETE /api/sites/{site}/visits/{id}: the author (their copy
// taken back, or a decision taken) or an owner.
func (s *Server) deleteVisit(w http.ResponseWriter, r *http.Request) {
	v, _, err := s.visitFor(r)
	if err != nil {
		s.answer(w, "visit", err)
		return
	}
	if err := store.DeleteVisit(r.Context(), s.d.Store.W, v.SiteID, v.ID); err != nil {
		s.answer(w, "visit", notFoundOr(err))
		return
	}
	noContent(w)
}
