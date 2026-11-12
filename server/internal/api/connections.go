package api

// Connections (docs/SCOPE.md step 8f, D376-D379): whether the desktop apps
// that asked to be watched are still connected to this server.
//
//   POST   /api/connection/beat   a watched PC's heartbeat (every 60 s, from
//                                 the app, the window closed too): {name,
//                                 intervalMs?, gaps?: [{from, to}]} - the
//                                 gaps the PC saw itself (it could not reach
//                                 the server), told once it could (D378).
//   POST   /api/connection/away   it is going (quit, signed out): its silence
//                                 is not lost until it beats again.
//   DELETE /api/connection        stop watching this PC.
//   GET    /api/sites/{site}/connections?from=&to=  the site's members'
//                                 watched PCs and the site's monitors, with
//                                 their gaps in the period (none kept when
//                                 the site keeps no statistics, D379).
//
// A PC that misses 3 intervals is lost: every signed-in page of a person who
// shares a site with its owner gets the event "connection" {lost: true}
// once; when it beats again, {back: true, from, to}. Only the desktop app
// with a device beats: a browser tab is never watched (D376). These are the
// server's metadata, kept in the clear (docs/SERVER.md).

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"carino.systems/topo/server/internal/store"
)

// ConnectionMissed intervals make a PC lost (D377).
const ConnectionMissed = 3

const (
	connIntervalDefault = int64(60_000)
	connIntervalMin     = int64(30_000)
	connIntervalMax     = int64(900_000)
	connNameMax         = 120
	connGapsMax         = 20
	connBody            = 16 << 10
	// The longest a gap is kept, whatever a site says (ten years).
	connKeepMaxMs = int64(3650) * 86_400_000
)

// usersSharing is every person who shares a granted site with `user`,
// `user` included.
func (s *Server) usersSharing(ctx context.Context, user string) []string {
	seen := map[string]bool{user: true}
	out := []string{user}
	sites, err := store.GrantedSiteIDs(ctx, s.d.Store.R, user)
	if err != nil {
		s.d.Log.Warn("connection event", "err", err)
		return out
	}
	for _, site := range sites {
		us, err := personMembers(ctx, s.d.Store.R, site)
		if err != nil {
			continue
		}
		for _, u := range us {
			if !seen[u] {
				seen[u] = true
				out = append(out, u)
			}
		}
	}
	return out
}

func connName(v string) string {
	n := strings.TrimSpace(strings.ReplaceAll(v, "\n", " "))
	if r := []rune(n); len(r) > connNameMax {
		n = string(r[:connNameMax])
	}
	return n
}

func (s *Server) connectionBeat(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	if sess.DeviceID == "" || sess.Monitor != "" {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "device"})
		return
	}
	var req struct {
		Name       string `json:"name"`
		IntervalMs int64  `json:"intervalMs"`
		Gaps       []struct {
			From int64 `json:"from"`
			To   int64 `json:"to"`
		} `json:"gaps"`
	}
	if err := decodeBody(w, r, connBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	name := connName(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "name"})
		return
	}
	interval := connIntervalDefault
	if req.IntervalMs >= connIntervalMin && req.IntervalMs <= connIntervalMax {
		interval = req.IntervalMs
	}
	ctx := r.Context()
	now := s.d.Now().UnixMilli()
	var wasLost bool
	var from int64
	var told [][2]int64
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		wasLost, from, err = store.ConnectionBeat(ctx, tx, sess.DeviceID, sess.UserID, name, now, interval)
		if err != nil {
			return err
		}
		// The PC's own gaps (it could not reach the server): only ended
		// ones in the past, at most connGapsMax per beat.
		for i, g := range req.Gaps {
			if i >= connGapsMax {
				break
			}
			if g.From <= 0 || g.To <= g.From || g.To > now || now-g.From > connKeepMaxMs {
				continue
			}
			if err := store.AddGap(ctx, tx, store.Gap{ClientID: sess.DeviceID, From: g.From, To: g.To, SeenBy: "client"}); err != nil {
				return err
			}
			told = append(told, [2]int64{g.From, g.To})
		}
		return nil
	})
	if err != nil {
		s.answer(w, "connection", err)
		return
	}
	if wasLost || len(told) > 0 {
		users := s.usersSharing(ctx, sess.UserID)
		if wasLost {
			s.publish(users, "connection", map[string]any{"device": sess.DeviceID, "name": name, "back": true, "from": from, "to": now})
		}
		for _, g := range told {
			s.publish(users, "connection", map[string]any{"device": sess.DeviceID, "name": name, "serverSilent": true, "from": g[0], "to": g[1]})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"intervalMs": interval, "at": now})
}

func (s *Server) connectionAway(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	if sess.DeviceID != "" {
		if err := store.ConnectionAway(r.Context(), s.d.Store.W, sess.DeviceID); err != nil {
			s.internal(w, "connection away", err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) connectionStop(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	if sess.DeviceID != "" {
		if err := store.DeleteConnection(r.Context(), s.d.Store.W, sess.DeviceID, sess.UserID); err != nil {
			s.internal(w, "connection stop", err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

type gapJSON struct {
	From   int64  `json:"from"`
	To     int64  `json:"to,omitempty"`
	SeenBy string `json:"seenBy"`
}

func toGaps(gs []store.Gap) []gapJSON {
	out := make([]gapJSON, 0, len(gs))
	for _, g := range gs {
		out = append(out, gapJSON{From: g.From, To: g.To, SeenBy: g.SeenBy})
	}
	return out
}

func (s *Server) siteConnections(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	site := r.PathValue("site")
	now := s.d.Now().UnixMilli()
	q := r.URL.Query()
	from, _ := strconv.ParseInt(q.Get("from"), 10, 64)
	to, _ := strconv.ParseInt(q.Get("to"), 10, 64)
	if to <= 0 || to > now {
		to = now
	}
	days, err := store.SiteStatsDays(ctx, s.d.Store.R, site)
	if err != nil {
		s.internal(w, "connections", err)
		return
	}
	// Nothing kept further back than the site's Keep statistics, nothing at
	// all with it Off (D379).
	if keep := now - days*86_400_000; from < keep {
		from = keep
	}
	pcs, err := store.SiteConnections(ctx, s.d.Store.R, site)
	if err != nil {
		s.internal(w, "connections", err)
		return
	}
	mons, err := store.SiteMonitors(ctx, s.d.Store.R, site)
	if err != nil {
		s.internal(w, "connections", err)
		return
	}
	gaps := func(id string) []gapJSON {
		if days == 0 || from >= to {
			return []gapJSON{}
		}
		gs, err := store.GapsOf(ctx, s.d.Store.R, id, from, to, 500)
		if err != nil {
			s.d.Log.Warn("connections", "err", err)
			return []gapJSON{}
		}
		return toGaps(gs)
	}
	out := []map[string]any{}
	for _, c := range pcs {
		out = append(out, map[string]any{"id": c.DeviceID, "kind": "pc", "name": c.Name, "email": c.Email, "since": c.Since,
			"lastBeat": c.LastBeat, "intervalMs": c.IntervalMs, "lost": c.Lost, "away": c.Away, "gaps": gaps(c.DeviceID)})
	}
	for _, m := range mons {
		out = append(out, map[string]any{"id": m.ID, "kind": "monitor", "name": m.Name, "since": m.Created,
			"lastBeat": m.LastReport, "intervalMs": m.IntervalMs, "lost": m.Stale, "away": false, "gaps": gaps(m.ID)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"statsDays": days, "from": from, "to": to, "clients": out})
}

// SweepConnections marks the watched PCs that missed ConnectionMissed
// intervals as lost and says so once to everyone who shares a site with
// them (D377); and prunes gaps past the longest any site keeps.
func (s *Server) SweepConnections(ctx context.Context) {
	if s.d.Store == nil {
		return
	}
	now := s.d.Now().UnixMilli()
	var lost []store.Connection
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		lost, err = store.LostConnections(ctx, tx, now, ConnectionMissed)
		return err
	})
	if err != nil {
		if ctx.Err() == nil {
			s.d.Log.Error("connection sweep", "err", err)
		}
		return
	}
	for _, c := range lost {
		s.publish(s.usersSharing(ctx, c.UserID), "connection", map[string]any{"device": c.DeviceID, "name": c.Name, "lost": true, "at": c.LastBeat})
	}
	if _, err := store.PruneGaps(ctx, s.d.Store.W, now-connKeepMaxMs); err != nil && ctx.Err() == nil {
		s.d.Log.Warn("connection gaps", "err", err)
	}
}
