package api

// Monitors through the server (docs/SCOPE.md step 7h, D146-D151, D158,
// D159, D161, D162).
//
// A site monitor is a PC an owner turned on from the desktop app. It is a
// credential, not a person: POST /monitors registers its public keys and
// answers a token, which the PC keeps in its keychain and sends as
// "Authorization: Topo-Monitor <token>". The owner's browser then grants it
// as any waiting member (POST /grant: the roster naming it with the role
// 'monitor', and the site key wrapped to it). A monitor session may only
// read the site (GET routes of the classes Member and Reader) and use the
// routes of the class Monitor: its status (the heartbeat), its issue
// records and its statistics. It never writes a revision. The token does
// not depend on anyone's session, so the monitor keeps working after the
// owner who turned it on signs out (D129). Revoking it deletes the
// credential and rotates the site key like removing a member (D149).
//
// Records are opaque to the server: it checks their shape, that the author
// is the caller, that the signature verifies under the caller's registered
// key, and that the epoch is the site's, never the plaintext.

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

const (
	// MonitorsPerSite bounds a site's monitors.
	MonitorsPerSite = 20
	// MonitorMissed is how many heartbeat intervals a monitor may miss
	// before it is "stopped reporting" (D151).
	MonitorMissed = 3
	// RecordsPerSite bounds a site's records (status excluded).
	RecordsPerSite = 5000
	statusBody     = 2 << 20
	recordBody     = 128 << 10
	statsBody      = 2 << 20
	monitorAuth    = "Topo-Monitor "
	// Intervals a monitor may say it reports at (ms).
	monitorIntervalMin = 30_000
	monitorIntervalMax = 900_000
	// StatsDaysMax is the longest Keep statistics (10 years, as the app's).
	StatsDaysMax = 3650
)

// Error codes of the monitor routes.
const (
	ErrMonitorsFull = "monitors-full"
	ErrNotAuthor    = "not-author"
	ErrOlderRecord  = "older-record"
	ErrRecordsFull  = "records-full"
	ErrStatsOff     = "stats-off"
	ErrConfirm      = "confirm"
)

// resolveMonitor turns "Authorization: Topo-Monitor <token>" into the
// monitor's session, or nil. A lookup that failed (not "no such token")
// is a session marked unavailable: the answer is 503, not 401, because the
// app takes a 401 for a revoke and forgets its keys.
func (s *Server) resolveMonitor(r *http.Request) *Session {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, monitorAuth) {
		return nil
	}
	tok := strings.TrimSpace(h[len(monitorAuth):])
	if !auth.ValidToken(tok) {
		return nil
	}
	m, err := store.MonitorByToken(r.Context(), s.d.Store.R, auth.Hash(tok))
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			s.d.Log.Error("monitor lookup", "err", err)
			return &Session{unavailable: true}
		}
		return nil
	}
	return &Session{ID: "", UserID: m.ID, ServerRole: "member", HasKeys: true, Monitor: m.SiteID}
}

// monitorGate is the gate's rule for a monitor session: it may read its
// own site (GET of Member and Reader routes) and use the Monitor routes.
// -> 0 when allowed, else the status.
func monitorGate(r *http.Request, c Class, sess *Session) int {
	if site := r.PathValue("site"); site != "" && site != sess.Monitor {
		return http.StatusNotFound
	}
	switch c {
	case Monitor:
		if mid := r.PathValue("mid"); mid != "" && mid != sess.UserID {
			return http.StatusForbidden
		}
		return 0
	case Member, Reader:
		if r.Method == http.MethodGet {
			return 0
		}
		// Its issue records go where the people's acts go (putRecord
		// lets a monitor write only issues).
		if c == Reader && r.Method == http.MethodPost && r.URL.Path == "/api/sites/"+sess.Monitor+"/records" {
			return 0
		}
	}
	return http.StatusForbidden
}

// ---- JSON ----

type monitorJSON struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	By         string `json:"by"`
	ByEmail    string `json:"byEmail"`
	Created    int64  `json:"created"`
	IntervalMs int64  `json:"intervalMs"`
	LastReport int64  `json:"lastReport"`
	Stale      bool   `json:"stale"`
	EncPub     string `json:"encPub"`
	SigPub     string `json:"sigPub"`
}

func toMonitorJSON(m store.Monitor) monitorJSON {
	return monitorJSON{m.ID, m.Name, m.ByUser, m.ByEmail, m.Created, m.IntervalMs, m.LastReport, m.Stale, m.EncPub, m.SigPub}
}

// newMonitorID is m_ and 22 lowercase hex digits (88 random bits), so the
// id is its own lowercase roster "email".
func newMonitorID() string {
	b := []byte(auth.NewToken())
	sum := auth.Hash(string(b))
	return "m_" + hex.EncodeToString(sum[:11])
}

// personMembers is the site's granted people (no monitors): who hears the
// live events about it.
func personMembers(ctx context.Context, q store.Q, site string) ([]string, error) {
	ms, err := store.SiteMembers(ctx, q, site)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, m := range ms {
		if m.Status == "granted" && m.Role != "monitor" {
			out = append(out, m.UserID)
		}
	}
	return out, nil
}

func (s *Server) publishSite(ctx context.Context, site, name string, data any) {
	users, err := personMembers(ctx, s.d.Store.R, site)
	if err != nil {
		s.d.Log.Warn("monitor event", "err", err)
		return
	}
	s.publish(users, name, data)
}

// ---- Owners ----

// addMonitor: POST /api/sites/{site}/monitors {name, encPub, sigPub,
// intervalMs?}: registers a PC's keys as a waiting member 'monitor' and
// answers {monitor, token}. The token is shown once.
func (s *Server) addMonitor(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name       string `json:"name"`
		EncPub     string `json:"encPub"`
		SigPub     string `json:"sigPub"`
		IntervalMs int64  `json:"intervalMs"`
	}
	if err := decodeBody(w, r, siteBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > 120 || strings.ContainsAny(name, "\n\r") {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "name"})
		return
	}
	for _, k := range []string{req.EncPub, req.SigPub} {
		if _, _, err := tcrypto.ParseRawP256(k); err != nil {
			writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "keys"})
			return
		}
	}
	if req.IntervalMs == 0 {
		req.IntervalMs = 60_000
	}
	if req.IntervalMs < monitorIntervalMin || req.IntervalMs > monitorIntervalMax {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "intervalMs"})
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	tok := auth.NewToken()
	m := &store.Monitor{ID: newMonitorID(), SiteID: site, Name: name, ByUser: sess.UserID, Created: s.d.Now().UnixMilli(),
		IntervalMs: req.IntervalMs, EncPub: req.EncPub, SigPub: req.SigPub}
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		have, err := store.SiteMonitors(ctx, tx, site)
		if err != nil {
			return err
		}
		if len(have) >= MonitorsPerSite {
			return fail(http.StatusConflict, ErrMonitorsFull)
		}
		return store.InsertMonitor(ctx, tx, m, auth.Hash(tok))
	})
	if err != nil {
		s.answer(w, "monitor", err)
		return
	}
	got, err := store.MonitorByID(ctx, s.d.Store.R, site, m.ID)
	if err != nil {
		s.internal(w, "monitor", err)
		return
	}
	s.publishSite(ctx, site, "monitors", map[string]any{"site": site})
	writeJSON(w, http.StatusCreated, map[string]any{"monitor": toMonitorJSON(*got), "token": tok})
}

// listMonitors: GET /api/sites/{site}/monitors: every monitor with its last
// report (the heartbeat, D151), the server's time to compare with, and the
// site's Keep statistics.
func (s *Server) listMonitors(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	site := r.PathValue("site")
	ms, err := store.SiteMonitors(ctx, s.d.Store.R, site)
	if err != nil {
		s.internal(w, "monitors", err)
		return
	}
	days, err := store.SiteStatsDays(ctx, s.d.Store.R, site)
	if err != nil {
		s.answer(w, "monitors", notFoundOr(err))
		return
	}
	list := []monitorJSON{}
	for _, m := range ms {
		list = append(list, toMonitorJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"monitors": list, "now": s.d.Now().UnixMilli(), "statsDays": days, "missed": MonitorMissed})
}

// revokeMonitor: POST /api/sites/{site}/monitors/{mid}/revoke {roster,
// wraps, nameCt}: as removing a member (D149): a monitor the roster names
// rotates the key (a new epoch, wrapped for every member left, the other
// monitors included); its credential and status go at once.
func (s *Server) revokeMonitor(w http.ResponseWriter, r *http.Request) {
	var req rotateReq
	if err := decodeBody(w, r, rotateBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site, mid := r.PathValue("site"), r.PathValue("mid")
	var members []string
	rotated := false
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		st, err := store.SiteByID(ctx, tx, site)
		if err != nil {
			return notFoundOr(err)
		}
		if _, err := store.MonitorByID(ctx, tx, site, mid); err != nil {
			return notFoundOr(err)
		}
		target, err := store.MemberOf(ctx, tx, site, mid)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		all, err := store.SiteMembers(ctx, tx, site)
		if err != nil {
			return err
		}
		roles := grantedRoles(all)
		named, err := inRosterInForce(ctx, tx, st, mid)
		if err != nil {
			return err
		}
		if (target != nil && target.Status == "granted") || named {
			delete(roles, mid)
			if err := s.rotation(ctx, tx, st, sess.UserID, req.Roster, req.Wraps, req.NameCt, roles); err != nil {
				return err
			}
			rotated = true
		}
		members = keys(roles)
		if target != nil {
			if err := store.DeleteMember(ctx, tx, site, mid); err != nil {
				return err
			}
		}
		return store.RevokeMonitor(ctx, tx, site, mid)
	})
	if err != nil {
		s.answer(w, "revoke", err)
		return
	}
	if rotated {
		s.publish(members, "roster", map[string]any{"site": site})
		s.publish(members, "epoch", map[string]any{"site": site})
	}
	s.publishSite(ctx, site, "monitors", map[string]any{"site": site})
	s.d.Backups.TouchNow(site)
	s.writeSite(w, r, site, http.StatusOK)
}

// patchStatsDays: PATCH /api/sites/{site}/stats-days {days, confirm}: Keep
// statistics for the site (D162; 0 = Off). Shortening it when blobs would
// go needs confirm: without it the answer is 409 confirm {deletes}, the
// number to name in the question.
func (s *Server) patchStatsDays(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Days    *int64 `json:"days"`
		Confirm bool   `json:"confirm"`
	}
	if err := decodeBody(w, r, siteBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	if req.Days == nil || *req.Days < 0 || *req.Days > StatsDaysMax {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "days"})
		return
	}
	ctx := r.Context()
	site := r.PathValue("site")
	now := s.d.Now().UnixMilli()
	var deleted int64
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		n, err := store.StatsOlder(ctx, tx, site, *req.Days, now)
		if err != nil {
			return err
		}
		if n > 0 && !req.Confirm {
			return failWith(http.StatusConflict, ErrConfirm, map[string]any{"deletes": n})
		}
		deleted, err = store.SetSiteStatsDays(ctx, tx, site, *req.Days, now)
		return err
	})
	if err != nil {
		s.answer(w, "stats-days", err)
		return
	}
	s.publishSite(ctx, site, "monitors", map[string]any{"site": site})
	writeJSON(w, http.StatusOK, map[string]any{"statsDays": *req.Days, "deleted": deleted})
}

// ---- Records ----

// checkRecord parses a record and checks it is the caller's, for this site,
// of an allowed kind, at the site's epoch, and signed with the caller's key.
func (s *Server) checkRecord(ctx context.Context, q store.Q, raw []byte, site, caller string, kinds ...string) (*tcrypto.Record, error) {
	rec, err := tcrypto.ParseRecord(raw)
	if err != nil || rec.Site != site {
		return nil, fail(http.StatusBadRequest, ErrBadRequest)
	}
	ok := false
	for _, k := range kinds {
		ok = ok || rec.Kind == k
	}
	if !ok {
		return nil, failWith(http.StatusForbidden, ErrForbidden, map[string]any{"field": "kind"})
	}
	if rec.Author != caller {
		return nil, fail(http.StatusForbidden, ErrNotAuthor)
	}
	st, err := store.SiteByID(ctx, q, site)
	if err != nil {
		return nil, notFoundOr(err)
	}
	if rec.Epoch != st.Epoch {
		return nil, failWith(http.StatusConflict, ErrStaleEpoch, map[string]any{"epoch": st.Epoch})
	}
	u, err := store.UserByID(ctx, q, caller)
	if err != nil {
		return nil, err
	}
	if u.SigPub == "" || rec.Verify(u.SigPub) != nil {
		return nil, fail(http.StatusUnprocessableEntity, ErrBadSignature)
	}
	return rec, nil
}

func readRaw(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	var raw json.RawMessage
	if err := decodeBody(w, r, limit, &raw); err != nil {
		writeDecodeError(w, err)
		return nil, false
	}
	return raw, true
}

func storeErr(err error) error {
	switch {
	case errors.Is(err, store.ErrNotAuthor):
		return fail(http.StatusForbidden, ErrNotAuthor)
	case errors.Is(err, store.ErrOlder):
		return fail(http.StatusConflict, ErrOlderRecord)
	}
	return err
}

// putStatus: PUT /api/sites/{site}/status {record (kind status, id = the
// monitor)}: the monitor's latest status, kept alone, and its heartbeat.
// ?interval=ms says how often it reports.
func (s *Server) putStatus(w http.ResponseWriter, r *http.Request) {
	raw, ok := readRaw(w, r, statusBody)
	if !ok {
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	now := s.d.Now().UnixMilli()
	interval := int64(60_000)
	if v, err := strconv.ParseInt(r.URL.Query().Get("interval"), 10, 64); err == nil && v >= monitorIntervalMin && v <= monitorIntervalMax {
		interval = v
	}
	var n int64
	var wasStale bool
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		rec, err := s.checkRecord(ctx, tx, raw, site, sess.UserID, "status")
		if err != nil {
			return err
		}
		if rec.ID != sess.UserID {
			return failWith(http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "id"})
		}
		n, err = store.PutRecord(ctx, tx, &store.Record{SiteID: site, Kind: rec.Kind, ID: rec.ID, Author: rec.Author, Epoch: rec.Epoch, At: rec.At, Received: now, Body: string(raw)})
		if err != nil {
			return storeErr(err)
		}
		wasStale, err = store.MonitorReported(ctx, tx, sess.UserID, now, interval)
		return err
	})
	if err != nil {
		s.answer(w, "status", err)
		return
	}
	s.publishSite(ctx, site, "monitor-status", map[string]any{"site": site, "monitor": sess.UserID, "n": n})
	if wasStale {
		s.publishSite(ctx, site, "monitor", map[string]any{"site": site, "monitor": sess.UserID, "stale": false})
	}
	writeJSON(w, http.StatusOK, map[string]any{"n": n})
}

// putRecord: POST /api/sites/{site}/records {record}: an issue (only a
// monitor opens one, D159), or a person's act or quiet window (owners and
// providers; whether a provider covers the device is the folding browser's
// check, since only it can read the network). Viewers write nothing.
func (s *Server) putRecord(w http.ResponseWriter, r *http.Request) {
	raw, ok := readRaw(w, r, recordBody)
	if !ok {
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	now := s.d.Now().UnixMilli()
	var n int64
	var rec *tcrypto.Record
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		var kinds []string
		if sess.Monitor != "" {
			kinds = []string{"issue"}
			if _, err := store.MonitorReported(ctx, tx, sess.UserID, now, 0); err != nil && !errors.Is(err, store.ErrNotFound) {
				return err
			}
		} else {
			m, err := store.MemberOf(ctx, tx, site, sess.UserID)
			if err != nil {
				return notFoundOr(err)
			}
			if m.Role != "owner" && m.Role != "provider" {
				return fail(http.StatusForbidden, ErrForbidden)
			}
			kinds = []string{"act", "quiet"}
		}
		var err error
		rec, err = s.checkRecord(ctx, tx, raw, site, sess.UserID, kinds...)
		if err != nil {
			return err
		}
		// The cap: folded records (already in the document) make room
		// first, oldest first; a monitor's issue is never refused for it,
		// so an outage always reaches the people (only acts and quiet
		// windows wait for room).
		have, err := store.CountRecords(ctx, tx, site)
		if err != nil {
			return err
		}
		if have >= RecordsPerSite {
			if _, err := store.DropOldestFolded(ctx, tx, site, have-RecordsPerSite+1); err != nil {
				return err
			}
			if have, err = store.CountRecords(ctx, tx, site); err != nil {
				return err
			}
		}
		if have >= RecordsPerSite && rec.Kind != "issue" {
			return fail(http.StatusInsufficientStorage, ErrRecordsFull)
		}
		n, err = store.PutRecord(ctx, tx, &store.Record{SiteID: site, Kind: rec.Kind, ID: rec.ID, Author: rec.Author, Epoch: rec.Epoch, At: rec.At, Received: now, Body: string(raw)})
		return storeErr(err)
	})
	if err != nil {
		s.answer(w, "record", err)
		return
	}
	s.publishSite(ctx, site, "record", map[string]any{"site": site, "kind": rec.Kind, "id": rec.ID, "n": n})
	s.d.Backups.Touch(site, "record")
	writeJSON(w, http.StatusOK, map[string]any{"n": n})
}

// listRecords: GET /api/sites/{site}/records?since=n: every record after n
// (status included), oldest first, at most 1000; `more` when there are.
func (s *Server) listRecords(w http.ResponseWriter, r *http.Request) {
	since, ok := sinceParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "since"})
		return
	}
	const limit = 1000
	rs, err := store.RecordsSince(r.Context(), s.d.Store.R, r.PathValue("site"), since, false, limit+1)
	if err != nil {
		s.internal(w, "records", err)
		return
	}
	more := len(rs) > limit
	if more {
		rs = rs[:limit]
	}
	type recJSON struct {
		N        int64           `json:"n"`
		Folded   bool            `json:"folded"`
		Received int64           `json:"received"`
		Record   json.RawMessage `json:"record"`
	}
	list := []recJSON{}
	last := since
	for _, x := range rs {
		list = append(list, recJSON{x.N, x.Folded, x.Received, json.RawMessage(x.Body)})
		last = x.N
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": list, "last": last, "more": more, "now": s.d.Now().UnixMilli()})
}

// foldRecords: POST /api/sites/{site}/records/folded {ns}: an owner's
// browser put these into the document (D158); they then go after 30 days.
// Folding an issue folds the acts on it too (their ids start with the
// issue's id and "|", D277): the document holds them now.
func (s *Server) foldRecords(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Ns []int64 `json:"ns"`
	}
	if err := decodeBody(w, r, siteBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	if len(req.Ns) > 1000 {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "ns"})
		return
	}
	n, err := store.FoldRecords(r.Context(), s.d.Store.W, r.PathValue("site"), req.Ns)
	if err != nil {
		s.internal(w, "fold", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"folded": n})
}

// ---- Statistics ----

const dayMs = int64(24 * 3600 * 1000)

// putStats: PUT /api/sites/{site}/stats/{day} {record (kind stats, id =
// "<monitor>|<day>")}: a monitor's hourly figures of one UTC day (D161).
// Refused when the site keeps no statistics (D162) or the day is past the
// retention.
func (s *Server) putStats(w http.ResponseWriter, r *http.Request) {
	day, err := strconv.ParseInt(r.PathValue("day"), 10, 64)
	if err != nil || day < 0 || day%dayMs != 0 {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "day"})
		return
	}
	raw, ok := readRaw(w, r, statsBody)
	if !ok {
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	now := s.d.Now().UnixMilli()
	err = s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		rec, err := s.checkRecord(ctx, tx, raw, site, sess.UserID, "stats")
		if err != nil {
			return err
		}
		if rec.ID != sess.UserID+"|"+strconv.FormatInt(day, 10) {
			return failWith(http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "id"})
		}
		days, err := store.SiteStatsDays(ctx, tx, site)
		if err != nil {
			return err
		}
		if days == 0 {
			return failWith(http.StatusConflict, ErrStatsOff, map[string]any{"statsDays": 0})
		}
		today := (now / dayMs) * dayMs
		if day < today-days*dayMs || day > today+dayMs {
			return failWith(http.StatusConflict, ErrStatsOff, map[string]any{"statsDays": days})
		}
		return store.PutStats(ctx, tx, site, sess.UserID, day, now, string(raw))
	})
	if err != nil {
		s.answer(w, "stats", err)
		return
	}
	noContent(w)
}

// listStats: GET /api/sites/{site}/stats?from=day&to=day: the blobs of
// those days (every monitor), at most 400.
func (s *Server) listStats(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, err1 := strconv.ParseInt(q.Get("from"), 10, 64)
	to, err2 := strconv.ParseInt(q.Get("to"), 10, 64)
	if err1 != nil || err2 != nil || from < 0 || to < from {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "from"})
		return
	}
	bs, err := store.SiteStats(r.Context(), s.d.Store.R, r.PathValue("site"), from, to, 400)
	if err != nil {
		s.internal(w, "stats", err)
		return
	}
	type statJSON struct {
		Monitor string          `json:"monitor"`
		Day     int64           `json:"day"`
		Record  json.RawMessage `json:"record"`
	}
	list := []statJSON{}
	for _, b := range bs {
		list = append(list, statJSON{b.Monitor, b.Day, json.RawMessage(b.Body)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"stats": list})
}

// ---- The monitor itself ----

// monitorSelf: GET /api/monitor: who this credential is, its site's epoch
// and Keep statistics. A revoked credential gets 401 here like everywhere.
func (s *Server) monitorSelf(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	m, err := store.MonitorByID(ctx, s.d.Store.R, sess.Monitor, sess.UserID)
	if err != nil {
		s.answer(w, "monitor", notFoundOr(err))
		return
	}
	st, err := store.SiteByID(ctx, s.d.Store.R, sess.Monitor)
	if err != nil {
		s.answer(w, "monitor", notFoundOr(err))
		return
	}
	days, err := store.SiteStatsDays(ctx, s.d.Store.R, sess.Monitor)
	if err != nil {
		s.internal(w, "monitor", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": m.ID, "site": m.SiteID, "name": m.Name, "epoch": st.Epoch, "rosterSeq": st.RosterSeq,
		"statsDays": days, "intervalMs": m.IntervalMs, "now": s.d.Now().UnixMilli()})
}

// SweepMonitors marks the monitors that missed MonitorMissed intervals and
// tells their sites' people (D151). The server runs it every 30 s.
func (s *Server) SweepMonitors(ctx context.Context) {
	if s.d.Store == nil {
		return
	}
	ms, err := store.StaleMonitors(ctx, s.d.Store.W, s.d.Now().UnixMilli(), MonitorMissed)
	if err != nil {
		if ctx.Err() == nil {
			s.d.Log.Error("monitor sweep", "err", err)
		}
		return
	}
	for _, m := range ms {
		s.publishSite(ctx, m.SiteID, "monitor", map[string]any{"site": m.SiteID, "monitor": m.ID, "name": m.Name, "stale": true, "lastReport": m.LastReport})
	}
}
