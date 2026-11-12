package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"

	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/notify"
	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// Body limits for the site routes (design §4.1).
const (
	siteBody   = 64 << 10
	rotateBody = 256 << 10
	maxNameCt  = 4 << 10
)

// ---- JSON shapes ----

type headJSON struct {
	N int64  `json:"n"`
	H string `json:"h"`
}

// SiteJSON is the site summary (design §4.6).
type SiteJSON struct {
	ID        string          `json:"id"`
	Role      string          `json:"role"`
	Status    string          `json:"status"`
	Epoch     int64           `json:"epoch"`
	Head      headJSON        `json:"head"`
	RosterSeq int64           `json:"rosterSeq"`
	NameCt    json.RawMessage `json:"nameCt"`
	NameClear *string         `json:"nameClear"`
	ShowName  bool            `json:"showName"`
	Updated   int64           `json:"updated"`
	Bytes     int64           `json:"bytes"`
	Members   int             `json:"members"`
	Waiting   *int            `json:"waiting,omitempty"`
	Muted     bool            `json:"muted"`
}

func siteJSON(ctx context.Context, q store.Q, st *store.Site, m *store.Member) (*SiteJSON, error) {
	out := &SiteJSON{ID: st.ID, Role: m.Role, Status: m.Status, Epoch: st.Epoch, Head: headJSON{st.HeadN, st.HeadH}, RosterSeq: st.RosterSeq,
		ShowName: st.ShowName, Updated: st.Updated, Bytes: st.Bytes, Muted: m.Muted, NameCt: json.RawMessage("null")}
	if st.NameCt != "" {
		out.NameCt = json.RawMessage(st.NameCt)
	}
	if st.ShowName && st.NameClear != "" {
		n := st.NameClear
		out.NameClear = &n
	}
	var granted, waiting int
	if err := q.QueryRowContext(ctx, "SELECT coalesce(sum(status = 'granted'),0), coalesce(sum(status = 'waiting'),0) FROM members WHERE site_id = ?", st.ID).Scan(&granted, &waiting); err != nil {
		return nil, err
	}
	out.Members = granted
	if m.Role == "owner" && m.Status == "granted" {
		out.Waiting = &waiting
	}
	return out, nil
}

// checkNameCt shape-checks an encrypted site name {"v":1,"epoch","iv","ct"}
// for the epoch it must be encrypted with.
func checkNameCt(raw json.RawMessage, epoch int64) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil
	}
	if len(raw) > maxNameCt {
		return "", fail(http.StatusRequestEntityTooLarge, ErrTooLarge)
	}
	var n struct {
		V     int    `json:"v"`
		Epoch int64  `json:"epoch"`
		IV    string `json:"iv"`
		CT    string `json:"ct"`
	}
	if json.Unmarshal(raw, &n) != nil || n.V != 1 {
		return "", fail(http.StatusBadRequest, ErrBadRequest)
	}
	iv, e1 := tcrypto.DecodeB64(n.IV)
	ct, e2 := tcrypto.DecodeB64(n.CT)
	if e1 != nil || e2 != nil || len(iv) != 12 || len(ct) < 16 {
		return "", fail(http.StatusBadRequest, ErrBadRequest)
	}
	if n.Epoch != epoch {
		return "", fail(http.StatusConflict, ErrStaleEpoch)
	}
	return string(raw), nil
}

// checkRoster verifies a roster an owner sends with an operation (design
// §4.6): the shape, the site, seq = the next one, the epoch the operation
// produces, signed by the caller with their registered U_sig, and the
// member set (with roles, emails and key fingerprints) exactly what the
// operation produces. It returns the compact JSON to store.
func checkRoster(ctx context.Context, q store.Q, site string, raw json.RawMessage, seq, epoch int64, by string, want map[string]string) (*tcrypto.Roster, string, error) {
	if len(raw) == 0 {
		return nil, "", fail(http.StatusBadRequest, ErrBadRoster)
	}
	ro, err := tcrypto.ParseRoster(raw)
	if err != nil || ro.Site != site {
		return nil, "", fail(http.StatusBadRequest, ErrBadRoster)
	}
	if ro.Seq != seq {
		return nil, "", failWith(http.StatusConflict, ErrStaleRoster, map[string]any{"rosterSeq": seq - 1})
	}
	if ro.Epoch != epoch || ro.By != by || len(ro.Members) != len(want) {
		return nil, "", fail(http.StatusUnprocessableEntity, ErrBadRoster)
	}
	signer, err := store.UserByID(ctx, q, by)
	if err != nil {
		return nil, "", err
	}
	if err := ro.Verify(signer.SigPub); err != nil {
		return nil, "", fail(http.StatusUnprocessableEntity, ErrBadSignature)
	}
	for _, m := range ro.Members {
		role, ok := want[m.U]
		if !ok || role != m.Role {
			return nil, "", fail(http.StatusUnprocessableEntity, ErrBadRoster)
		}
		u, err := store.UserByID(ctx, q, m.U)
		if errors.Is(err, store.ErrNotFound) {
			return nil, "", fail(http.StatusUnprocessableEntity, ErrBadRoster)
		}
		if err != nil {
			return nil, "", err
		}
		if u.EncPub == "" || m.Email != u.EmailNorm || m.Enc != tcrypto.FingerprintB64(u.EncPub) || m.Sig != tcrypto.FingerprintB64(u.SigPub) {
			return nil, "", fail(http.StatusUnprocessableEntity, ErrBadRoster)
		}
	}
	compact, _ := json.Marshal(ro)
	return ro, string(compact), nil
}

// wrapIn is one wrapped site key in a request.
type wrapIn struct {
	User  string          `json:"user"`
	Epoch int64           `json:"epoch"`
	Wrap  json.RawMessage `json:"wrap"`
}

// checkSiteWrap verifies a site key wrapped for a member: the exact ctx,
// addressed to the member's U_enc, made and signed by the caller.
func checkSiteWrap(ctx context.Context, q store.Q, site string, in wrapIn, by *store.User) (string, error) {
	if len(in.Wrap) == 0 || len(in.Wrap) > maxWrapBytes {
		return "", fail(http.StatusBadRequest, ErrBadWrap)
	}
	u, err := store.UserByID(ctx, q, in.User)
	if errors.Is(err, store.ErrNotFound) {
		return "", fail(http.StatusUnprocessableEntity, ErrBadWrap)
	}
	if err != nil {
		return "", err
	}
	if u.EncPub == "" {
		return "", fail(http.StatusConflict, ErrNoKeys)
	}
	w, err := tcrypto.ParseWrap(in.Wrap, tcrypto.SiteKeyCT, tcrypto.SiteKeyCT)
	if err != nil {
		return "", fail(http.StatusBadRequest, ErrBadWrap)
	}
	if err := w.Check(tcrypto.SiteCtx(site, in.Epoch, in.User), u.EncPub, by.ID, by.SigPub); err != nil {
		if errors.Is(err, tcrypto.ErrSignature) {
			return "", fail(http.StatusUnprocessableEntity, ErrBadSignature)
		}
		return "", fail(http.StatusUnprocessableEntity, ErrBadWrap)
	}
	compact, _ := json.Marshal(w)
	return string(compact), nil
}

// grantedRoles is the granted members of a site as user → role.
func grantedRoles(ms []store.Member) map[string]string {
	out := map[string]string{}
	for _, m := range ms {
		if m.Status == "granted" {
			out[m.UserID] = m.Role
		}
	}
	return out
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func countOwners(roles map[string]string) int {
	n := 0
	for _, r := range roles {
		if r == "owner" {
			n++
		}
	}
	return n
}

// ---- handlers ----

// listSites: GET /api/sites: the caller's memberships, granted and waiting,
// and the pending invitations addressed to their email.
func (s *Server) listSites(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	q := s.d.Store.R
	ss, ms, err := store.UserSites(ctx, q, sess.UserID)
	if err != nil {
		s.internal(w, "sites", err)
		return
	}
	sites := []*SiteJSON{}
	for i := range ss {
		sj, err := siteJSON(ctx, q, &ss[i], &ms[i])
		if err != nil {
			s.internal(w, "sites", err)
			return
		}
		sites = append(sites, sj)
	}
	u, err := store.UserByID(ctx, q, sess.UserID)
	if err != nil {
		s.internal(w, "sites", err)
		return
	}
	invs, err := store.EmailInvites(ctx, q, u.EmailNorm, s.d.Now().UnixMilli())
	if err != nil {
		s.internal(w, "sites", err)
		return
	}
	type inv struct {
		ID        string  `json:"id"`
		Site      string  `json:"site"`
		Role      string  `json:"role"`
		NameClear *string `json:"nameClear"`
		Inviter   string  `json:"inviter"`
		Expires   int64   `json:"expires"`
	}
	invites := []inv{}
	for _, i := range invs {
		if _, err := store.MemberOf(ctx, q, i.SiteID, sess.UserID); err == nil {
			continue
		}
		it := inv{ID: i.ID, Site: i.SiteID, Role: i.Role, Expires: i.Expires}
		if st, err := store.SiteByID(ctx, q, i.SiteID); err == nil && st.ShowName && st.NameClear != "" {
			n := st.NameClear
			it.NameClear = &n
		}
		if by, err := store.UserByID(ctx, q, i.InvitedBy); err == nil {
			it.Inviter = by.EmailNorm
		}
		invites = append(invites, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"sites": sites, "invites": invites})
}

// createSite: POST /api/sites {id, roster, wrap, nameCt, showName,
// nameClear}. The browser mints the id (amendment D4) and signs roster
// seq 1 naming only itself as owner, plus the site key wrapped for itself.
func (s *Server) createSite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID        string          `json:"id"`
		Roster    json.RawMessage `json:"roster"`
		Wrap      json.RawMessage `json:"wrap"`
		NameCt    json.RawMessage `json:"nameCt"`
		ShowName  bool            `json:"showName"`
		NameClear string          `json:"nameClear"`
	}
	if err := decodeBody(w, r, siteBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	if sess.ServerRole != "owner" && sess.ServerRole != "staff" {
		writeError(w, http.StatusForbidden, ErrForbidden, nil)
		return
	}
	if !tcrypto.ValidSiteID(req.ID) {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "id"})
		return
	}
	nameCt, err := checkNameCt(req.NameCt, 1)
	if err != nil {
		s.answer(w, "create site", err)
		return
	}
	ctx := r.Context()
	ms := s.d.Now().UnixMilli()
	err = s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := store.SiteByID(ctx, tx, req.ID); err == nil {
			return fail(http.StatusConflict, ErrConflict)
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		me, err := store.UserByID(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		_, roster, err := checkRoster(ctx, tx, req.ID, req.Roster, 1, 1, me.ID, map[string]string{me.ID: "owner"})
		if err != nil {
			return err
		}
		wrap, err := checkSiteWrap(ctx, tx, req.ID, wrapIn{User: me.ID, Epoch: 1, Wrap: req.Wrap}, me)
		if err != nil {
			return err
		}
		if err := store.InsertSite(ctx, tx, &store.Site{ID: req.ID, Created: ms, CreatedBy: me.ID, Epoch: 1, HeadN: 0, HeadH: tcrypto.Genesis(req.ID),
			RosterSeq: 1, NameCt: nameCt, NameClear: mail.CleanName(req.NameClear), ShowName: req.ShowName && mail.CleanName(req.NameClear) != "", Updated: ms}); err != nil {
			return err
		}
		if !req.ShowName {
			if _, err := tx.ExecContext(ctx, "UPDATE sites SET name_clear = NULL WHERE id = ?", req.ID); err != nil {
				return err
			}
		}
		if err := store.InsertMember(ctx, tx, req.ID, me.ID, "owner", "granted", ms); err != nil {
			return err
		}
		if err := store.InsertRoster(ctx, tx, req.ID, 1, 1, me.ID, roster, ms); err != nil {
			return err
		}
		return store.InsertWrap(ctx, tx, req.ID, 1, me.ID, wrap, me.ID, ms)
	})
	if err != nil {
		s.answer(w, "create site", err)
		return
	}
	s.writeSite(w, r, req.ID, http.StatusCreated)
}

// writeSite answers with the caller's summary of a site.
func (s *Server) writeSite(w http.ResponseWriter, r *http.Request, site string, status int) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	q := s.d.Store.R
	st, err := store.SiteByID(ctx, q, site)
	if err != nil {
		s.answer(w, "site", notFoundOr(err))
		return
	}
	m, err := store.MemberOf(ctx, q, site, sess.UserID)
	if err != nil {
		s.answer(w, "site", notFoundOr(err))
		return
	}
	sj, err := siteJSON(ctx, q, st, m)
	if err != nil {
		s.internal(w, "site", err)
		return
	}
	writeJSON(w, status, map[string]any{"site": sj})
}

func notFoundOr(err error) error {
	if errors.Is(err, store.ErrNotFound) {
		return fail(http.StatusNotFound, ErrNotFound)
	}
	return err
}

// getSite: GET /api/sites/{site}: the summary, the members (a waiting
// member sees only themselves) and, for owners, the pending invitations.
func (s *Server) getSite(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	q := s.d.Store.R
	site := r.PathValue("site")
	st, err := store.SiteByID(ctx, q, site)
	if err != nil {
		s.answer(w, "site", notFoundOr(err))
		return
	}
	ms, err := store.SiteMembers(ctx, q, site)
	if err != nil {
		s.internal(w, "site", err)
		return
	}
	var me *store.Member
	for i := range ms {
		if ms[i].UserID == sess.UserID {
			me = &ms[i]
		}
	}
	if me == nil {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	sj, err := siteJSON(ctx, q, st, me)
	if err != nil {
		s.internal(w, "site", err)
		return
	}
	type memberJSON struct {
		User   string `json:"user"`
		Email  string `json:"email"`
		Role   string `json:"role"`
		Status string `json:"status"`
		EncPub string `json:"encPub"`
		SigPub string `json:"sigPub"`
		KeysAt int64  `json:"keysAt"`
		Added  int64  `json:"added"`
	}
	members := []memberJSON{}
	for _, m := range ms {
		if me.Status != "granted" && m.UserID != me.UserID {
			continue
		}
		members = append(members, memberJSON{m.UserID, m.Email, m.Role, m.Status, m.EncPub, m.SigPub, m.KeysAt, m.Added})
	}
	out := map[string]any{"site": sj, "members": members}
	if me.Role == "owner" && me.Status == "granted" {
		invs, err := store.SiteInvites(ctx, q, site, s.d.Now().UnixMilli())
		if err != nil {
			s.internal(w, "site", err)
			return
		}
		type invJSON struct {
			ID      string `json:"id"`
			Email   string `json:"email"`
			Role    string `json:"role"`
			Status  string `json:"status"`
			Created int64  `json:"created"`
			Expires int64  `json:"expires"`
		}
		list := []invJSON{}
		for _, i := range invs {
			list = append(list, invJSON{i.ID, i.EmailNorm, i.Role, i.Status, i.Created, i.Expires})
		}
		out["invites"] = list
		// What the owner's browser needs to know about backups (D106).
		bcfg, err := store.GetBackupConfig(ctx, q)
		if err != nil {
			s.internal(w, "site", err)
			return
		}
		info, err := store.SiteForBackup(ctx, q, site)
		if err != nil {
			s.internal(w, "site", err)
			return
		}
		out["backups"] = map[string]any{"on": bcfg.Enabled && bcfg.Kind != "", "readableAllowed": bcfg.ReadableAllowed, "readable": info.Readable}
	}
	writeJSON(w, http.StatusOK, out)
}

// patchSite: PATCH /api/sites/{site} {nameCt?, showName?, nameClear?}.
// Turning showName off clears the clear name (D68).
func (s *Server) patchSite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NameCt    json.RawMessage `json:"nameCt"`
		ShowName  *bool           `json:"showName"`
		NameClear *string         `json:"nameClear"`
		// NameSlug is the name in file-name form, made by the browser
		// (fileSlug), for backup file names while the name is shown in
		// clear (amendment 4).
		NameSlug *string `json:"nameSlug"`
		// BackupReadable turns this network's readable copies on (D106),
		// only while the server owner allows them.
		BackupReadable *bool `json:"backupReadable"`
	}
	if err := decodeBody(w, r, siteBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	ctx := r.Context()
	site := r.PathValue("site")
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		st, err := store.SiteByID(ctx, tx, site)
		if err != nil {
			return notFoundOr(err)
		}
		nameCt := st.NameCt
		if len(req.NameCt) > 0 {
			if nameCt, err = checkNameCt(req.NameCt, st.Epoch); err != nil {
				return err
			}
		}
		show, clear := st.ShowName, st.NameClear
		if req.ShowName != nil {
			show = *req.ShowName
		}
		if req.NameClear != nil {
			clear = mail.CleanName(*req.NameClear)
		}
		if clear == "" {
			show = false
		}
		if err := store.SetSiteName(ctx, tx, site, nameCt, show, clear, s.d.Now().UnixMilli()); err != nil {
			return err
		}
		if req.NameSlug != nil && *req.NameSlug != "" && !backup.ValidSlug(*req.NameSlug) {
			return failWith(http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "nameSlug"})
		}
		if !show {
			if err := store.SetSiteNameSlug(ctx, tx, site, ""); err != nil {
				return err
			}
		} else if req.NameSlug != nil {
			if err := store.SetSiteNameSlug(ctx, tx, site, *req.NameSlug); err != nil {
				return err
			}
		}
		if req.BackupReadable != nil {
			if *req.BackupReadable {
				bcfg, err := store.GetBackupConfig(ctx, tx)
				if err != nil {
					return err
				}
				if !bcfg.ReadableAllowed {
					return fail(http.StatusConflict, ErrReadableOff)
				}
			}
			return store.SetSiteBackupReadable(ctx, tx, site, *req.BackupReadable)
		}
		return nil
	})
	if err != nil {
		s.answer(w, "patch site", err)
		return
	}
	s.writeSite(w, r, site, http.StatusOK)
}

// deleteSite: DELETE /api/sites/{site}: everything goes; members are told.
func (s *Server) deleteSite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	site := r.PathValue("site")
	var users []string
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		ms, err := store.SiteMembers(ctx, tx, site)
		if err != nil {
			return err
		}
		for _, m := range ms {
			users = append(users, m.UserID)
		}
		if err := s.d.Blobs.DropSite(ctx, tx, site); err != nil {
			return err
		}
		return store.DeleteSite(ctx, tx, site)
	})
	if err != nil {
		s.answer(w, "delete site", err)
		return
	}
	s.publish(users, "site-removed", map[string]string{"site": site})
	noContent(w)
}

// patchSiteMe: PATCH /api/sites/{site}/me {muted}: the caller's own
// per-site notification mute.
func (s *Server) patchSiteMe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Muted *bool `json:"muted"`
	}
	if err := decodeBody(w, r, 1<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	if req.Muted == nil {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "muted"})
		return
	}
	sess := SessionFrom(r.Context())
	site := r.PathValue("site")
	if err := store.SetMemberMuted(r.Context(), s.d.Store.W, site, sess.UserID, *req.Muted); err != nil {
		s.internal(w, "mute", err)
		return
	}
	s.writeSite(w, r, site, http.StatusOK)
}

func sinceParam(r *http.Request) (int64, bool) {
	v := r.URL.Query().Get("since")
	if v == "" {
		return 0, true
	}
	n, err := strconv.ParseInt(v, 10, 64)
	return n, err == nil && n >= 0
}

// siteRosters: GET /api/sites/{site}/rosters?since=k (seq > k, ascending).
// Rosters are kept forever so a joiner can walk the whole chain.
func (s *Server) siteRosters(w http.ResponseWriter, r *http.Request) {
	since, ok := sinceParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "since"})
		return
	}
	rs, err := store.RostersSince(r.Context(), s.d.Store.R, r.PathValue("site"), since)
	if err != nil {
		s.internal(w, "rosters", err)
		return
	}
	out := []json.RawMessage{}
	// The registered public keys of everyone these rosters name (signers and
	// members), so a browser walking the chain can check a signature by a
	// member who has since left. Untrusted: the browser accepts a key only
	// when its fingerprint is the one a roster it already trusts names.
	type pub struct {
		EncPub string `json:"encPub"`
		SigPub string `json:"sigPub"`
	}
	pubs := map[string]pub{}
	for _, x := range rs {
		out = append(out, json.RawMessage(x))
		var ro struct {
			By      string `json:"by"`
			Members []struct {
				U string `json:"u"`
			} `json:"members"`
		}
		if json.Unmarshal([]byte(x), &ro) != nil {
			continue
		}
		ids := []string{ro.By}
		for _, m := range ro.Members {
			ids = append(ids, m.U)
		}
		for _, id := range ids {
			if _, seen := pubs[id]; seen || id == "" {
				continue
			}
			if u, err := store.UserByID(r.Context(), s.d.Store.R, id); err == nil && u.EncPub != "" {
				pubs[id] = pub{u.EncPub, u.SigPub}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rosters": out, "pubs": pubs})
}

// siteKeys: GET /api/sites/{site}/keys: the caller's wrapped site keys,
// every epoch they were given.
func (s *Server) siteKeys(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ws, err := store.UserWraps(r.Context(), s.d.Store.R, r.PathValue("site"), sess.UserID)
	if err != nil {
		s.internal(w, "keys", err)
		return
	}
	type item struct {
		Epoch int64           `json:"epoch"`
		Wrap  json.RawMessage `json:"wrap"`
	}
	out := []item{}
	for _, x := range ws {
		out = append(out, item{x.Epoch, json.RawMessage(x.Wrap)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"wraps": out})
}

// leaveSite: POST /api/sites/{site}/leave. The last granted owner cannot
// leave (delete the site instead). Leaving does not rotate the key: the
// owners are told (roster-needed) and their next action rotates.
func (s *Server) leaveSite(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	var owners []string
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		ms, err := store.SiteMembers(ctx, tx, site)
		if err != nil {
			return err
		}
		roles := grantedRoles(ms)
		if roles[sess.UserID] == "owner" && countOwners(roles) == 1 {
			return fail(http.StatusConflict, ErrLastOwner)
		}
		if _, granted := roles[sess.UserID]; granted {
			for u, role := range roles {
				if role == "owner" && u != sess.UserID {
					owners = append(owners, u)
				}
			}
		}
		return store.DeleteMember(ctx, tx, site, sess.UserID)
	})
	if err != nil {
		s.answer(w, "leave", err)
		return
	}
	s.publish(owners, "roster-needed", map[string]string{"site": site})
	s.publish([]string{sess.UserID}, "site-removed", map[string]string{"site": site})
	noContent(w)
}

// grant: POST /api/sites/{site}/grant {roster, wraps}: an owner's browser
// gives waiting members the site key (D61). Each grantee must be a waiting
// member with keys and get a wrap for the current epoch (and, for "also
// the older history", earlier ones); the roster (seq + 1, same epoch) lists
// the granted members plus the grantees.
func (s *Server) grant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Roster json.RawMessage `json:"roster"`
		Wraps  []wrapIn        `json:"wraps"`
	}
	if err := decodeBody(w, r, rotateBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	now := s.d.Now()
	ms := now.UnixMilli()
	var grantees, members []string
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		st, err := store.SiteByID(ctx, tx, site)
		if err != nil {
			return notFoundOr(err)
		}
		all, err := store.SiteMembers(ctx, tx, site)
		if err != nil {
			return err
		}
		byID := map[string]*store.Member{}
		for i := range all {
			byID[all[i].UserID] = &all[i]
		}
		want := grantedRoles(all)
		current := map[string]bool{}
		for _, in := range req.Wraps {
			m := byID[in.User]
			if m == nil || m.Status != "waiting" {
				return fail(http.StatusConflict, ErrConflict)
			}
			if m.EncPub == "" {
				return fail(http.StatusConflict, ErrNoKeys)
			}
			if in.Epoch < 1 || in.Epoch > st.Epoch {
				return fail(http.StatusConflict, ErrStaleEpoch)
			}
			if in.Epoch == st.Epoch {
				current[in.User] = true
			}
			want[in.User] = m.Role
		}
		if len(current) == 0 {
			return fail(http.StatusBadRequest, ErrBadRequest)
		}
		for _, in := range req.Wraps {
			if !current[in.User] {
				return fail(http.StatusBadRequest, ErrBadWrap)
			}
		}
		_, roster, err := checkRoster(ctx, tx, site, req.Roster, st.RosterSeq+1, st.Epoch, sess.UserID, want)
		if err != nil {
			return err
		}
		me, err := store.UserByID(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		for _, in := range req.Wraps {
			wrap, err := checkSiteWrap(ctx, tx, site, in, me)
			if err != nil {
				return err
			}
			if err := store.InsertWrap(ctx, tx, site, in.Epoch, in.User, wrap, me.ID, ms); err != nil {
				return err
			}
		}
		if err := store.InsertRoster(ctx, tx, site, st.RosterSeq+1, st.Epoch, me.ID, roster, ms); err != nil {
			return err
		}
		if err := store.SetRoster(ctx, tx, site, st.RosterSeq+1, st.Epoch, "", ms); err != nil {
			return err
		}
		for u := range current {
			if err := store.GrantMember(ctx, tx, site, u, ms); err != nil {
				return err
			}
			m := byID[u]
			if m.Disabled || m.Role == "monitor" {
				continue
			}
			if err := store.InsertMail(ctx, tx, &store.Mail{ID: store.NewID("o_"), Kind: "granted", To: m.Email, UserID: u, SiteID: site,
				Lang: m.Lang, Data: "{}", Created: ms, SendAfter: ms}); err != nil {
				return err
			}
			grantees = append(grantees, u)
		}
		members = keys(want)
		return nil
	})
	if err != nil {
		s.answer(w, "grant", err)
		return
	}
	s.publish(grantees, "granted", map[string]string{"site": site})
	s.publish(members, "roster", map[string]any{"site": site})
	s.wake()
	// The next backup carries the new roster and the new owner's wrap.
	s.d.Backups.TouchNow(site)
	s.writeSite(w, r, site, http.StatusOK)
}

// setRole: POST /api/sites/{site}/members/{uid}/role {role, roster?}. A
// granted member's change needs a new roster (no rotation); a waiting
// member's role is only the server's record until they are granted. The
// last granted owner cannot be demoted.
func (s *Server) setRole(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Role   string          `json:"role"`
		Roster json.RawMessage `json:"roster"`
	}
	if err := decodeBody(w, r, siteBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	site, uid := r.PathValue("site"), r.PathValue("uid")
	// A monitor's role is never changed, nor anyone made a monitor (step 7h).
	if !tcrypto.ValidRole(req.Role) || store.IsMonitorID(uid) {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "role"})
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	ms := s.d.Now().UnixMilli()
	var members []string
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		st, err := store.SiteByID(ctx, tx, site)
		if err != nil {
			return notFoundOr(err)
		}
		all, err := store.SiteMembers(ctx, tx, site)
		if err != nil {
			return err
		}
		roles := grantedRoles(all)
		var target *store.Member
		for i := range all {
			if all[i].UserID == uid {
				target = &all[i]
			}
		}
		if target == nil {
			return fail(http.StatusNotFound, ErrNotFound)
		}
		if target.Status == "granted" {
			if target.Role == "owner" && req.Role != "owner" && countOwners(roles) == 1 {
				return fail(http.StatusConflict, ErrLastOwner)
			}
			roles[uid] = req.Role
			_, roster, err := checkRoster(ctx, tx, site, req.Roster, st.RosterSeq+1, st.Epoch, sess.UserID, roles)
			if err != nil {
				return err
			}
			if err := store.InsertRoster(ctx, tx, site, st.RosterSeq+1, st.Epoch, sess.UserID, roster, ms); err != nil {
				return err
			}
			if err := store.SetRoster(ctx, tx, site, st.RosterSeq+1, st.Epoch, "", ms); err != nil {
				return err
			}
			members = keys(roles)
		}
		return store.SetMemberRole(ctx, tx, site, uid, req.Role)
	})
	if err != nil {
		s.answer(w, "role", err)
		return
	}
	s.publish(members, "roster", map[string]any{"site": site})
	s.writeSite(w, r, site, http.StatusOK)
}

// rotation applies a new epoch (remove, rotate): roster seq + 1 and epoch
// + 1 listing exactly `remaining`, a wrap of the new key for each of them,
// and the name re-encrypted when the site has one.
func (s *Server) rotation(ctx context.Context, tx *sql.Tx, st *store.Site, by string, rosterRaw json.RawMessage, wraps []wrapIn, nameRaw json.RawMessage, remaining map[string]string) error {
	ms := s.d.Now().UnixMilli()
	epoch := st.Epoch + 1
	_, roster, err := checkRoster(ctx, tx, st.ID, rosterRaw, st.RosterSeq+1, epoch, by, remaining)
	if err != nil {
		return err
	}
	nameCt, err := checkNameCt(nameRaw, epoch)
	if err != nil {
		return err
	}
	if st.NameCt != "" && nameCt == "" {
		return failWith(http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "nameCt"})
	}
	got := map[string]bool{}
	me, err := store.UserByID(ctx, tx, by)
	if err != nil {
		return err
	}
	for _, in := range wraps {
		if _, ok := remaining[in.User]; !ok || in.Epoch != epoch || got[in.User] {
			return fail(http.StatusUnprocessableEntity, ErrBadWrap)
		}
		got[in.User] = true
		wrap, err := checkSiteWrap(ctx, tx, st.ID, in, me)
		if err != nil {
			return err
		}
		if err := store.InsertWrap(ctx, tx, st.ID, epoch, in.User, wrap, by, ms); err != nil {
			return err
		}
	}
	if len(got) != len(remaining) {
		return fail(http.StatusUnprocessableEntity, ErrBadWrap)
	}
	if err := store.InsertRoster(ctx, tx, st.ID, st.RosterSeq+1, epoch, by, roster, ms); err != nil {
		return err
	}
	return store.SetRoster(ctx, tx, st.ID, st.RosterSeq+1, epoch, nameCt, ms)
}

type rotateReq struct {
	User   string          `json:"user"`
	Roster json.RawMessage `json:"roster"`
	Wraps  []wrapIn        `json:"wraps"`
	NameCt json.RawMessage `json:"nameCt"`
}

// removeMember: POST /api/sites/{site}/remove {user, roster, wraps, nameCt}.
// Removing a granted member rotates the site key (D62): new revisions only;
// whatever they already downloaded stays with them. So does removing a
// waiting member the roster in force still names (one who reset their keys
// may keep the current key). A waiting member never granted holds no key
// and is removed without a rotation.
func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	var req rotateReq
	if err := decodeBody(w, r, rotateBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	if req.User == sess.UserID {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "user"})
		return
	}
	var members []string
	rotated := false
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		st, err := store.SiteByID(ctx, tx, site)
		if err != nil {
			return notFoundOr(err)
		}
		target, err := store.MemberOf(ctx, tx, site, req.User)
		if err != nil {
			return notFoundOr(err)
		}
		all, err := store.SiteMembers(ctx, tx, site)
		if err != nil {
			return err
		}
		roles := grantedRoles(all)
		// A member named by the roster in force may hold the current key
		// even when they wait (a key reset keeps the old key in that
		// browser): removing them rotates too, whatever their status.
		named, err := inRosterInForce(ctx, tx, st, req.User)
		if err != nil {
			return err
		}
		if target.Status == "granted" || named {
			delete(roles, req.User)
			if err := s.rotation(ctx, tx, st, sess.UserID, req.Roster, req.Wraps, req.NameCt, roles); err != nil {
				return err
			}
			rotated = true
		}
		members = keys(roles)
		if store.IsMonitorID(req.User) {
			// Removing a monitor from the members list revokes it (D149).
			if err := store.RevokeMonitor(ctx, tx, site, req.User); err != nil {
				return err
			}
		}
		return store.DeleteMember(ctx, tx, site, req.User)
	})
	if err != nil {
		s.answer(w, "remove", err)
		return
	}
	s.publish([]string{req.User}, "site-removed", map[string]string{"site": site})
	if rotated {
		s.publish(members, "roster", map[string]any{"site": site})
		s.publish(members, "epoch", map[string]any{"site": site})
	}
	s.writeSite(w, r, site, http.StatusOK)
}

// inRosterInForce reports whether the site's latest roster names user.
func inRosterInForce(ctx context.Context, q store.Q, st *store.Site, user string) (bool, error) {
	rs, err := store.RostersSince(ctx, q, st.ID, st.RosterSeq-1)
	if err != nil {
		return false, err
	}
	if len(rs) == 0 {
		return false, nil
	}
	ro, err := tcrypto.ParseRoster([]byte(rs[0]))
	if err != nil {
		return false, err
	}
	return ro.Member(user) != nil, nil
}

// rotate: POST /api/sites/{site}/rotate {roster, wraps, nameCt}: a new
// epoch for the current granted members (after a leave, or to lock out a
// key that changed).
func (s *Server) rotate(w http.ResponseWriter, r *http.Request) {
	var req rotateReq
	if err := decodeBody(w, r, rotateBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	var members []string
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		st, err := store.SiteByID(ctx, tx, site)
		if err != nil {
			return notFoundOr(err)
		}
		all, err := store.SiteMembers(ctx, tx, site)
		if err != nil {
			return err
		}
		roles := grantedRoles(all)
		members = keys(roles)
		return s.rotation(ctx, tx, st, sess.UserID, req.Roster, req.Wraps, req.NameCt, roles)
	})
	if err != nil {
		s.answer(w, "rotate", err)
		return
	}
	s.publish(members, "roster", map[string]any{"site": site})
	s.publish(members, "epoch", map[string]any{"site": site})
	s.writeSite(w, r, site, http.StatusOK)
}

// joinedNotify queues member-joined for the site's owners (inside tx).
func joinedNotify(ctx context.Context, tx *sql.Tx, o notify.Options, site, joiner, email string) error {
	all, err := store.SiteMembers(ctx, tx, site)
	if err != nil {
		return err
	}
	rc := notify.Recipients("member-joined", joiner, nil, all)
	o.Data = map[string]string{"email": email}
	_, err = notify.Enqueue(ctx, tx, site, "member-joined", rc, o)
	return err
}
