package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"carino.systems/topo/server/internal/hub"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/notify"
	"carino.systems/topo/server/internal/store"
)

// NotifyKeys are the per-user notification choices and their defaults
// (notify.Defaults). "revision" covers sites the user owns (on by default);
// "revisionShared" the sites where they are a provider or viewer (off by
// default): the design's rule that revision digests go to owners by
// default, as two switches the person can see.
var NotifyKeys = notify.Defaults

// EffectiveNotify merges a stored notify JSON over the defaults.
func EffectiveNotify(stored string) map[string]bool { return notify.Effective(stored) }

// Me is GET /api/me.
type Me struct {
	ID            string          `json:"id"`
	Email         string          `json:"email"`
	Lang          string          `json:"lang"`
	ServerRole    string          `json:"serverRole"`
	CanCreate     bool            `json:"canCreate"`
	Keys          *MeKeys         `json:"keys"`
	HasEscrow     bool            `json:"hasEscrow"`
	Notify        map[string]bool `json:"notify"`
	Device        *MeDevice       `json:"device"`
	WaitingGrants int             `json:"waitingGrants"`
	LinkRequests  int             `json:"linkRequests"`
	// MailRelay: this server can email a problem report for the client
	// (TOPO_MAIL smtp or file; D87). False with log.
	MailRelay bool `json:"mailRelay"`
}

type MeKeys struct {
	EncPub string `json:"encPub"`
	SigPub string `json:"sigPub"`
	At     int64  `json:"at"`
}

type MeDevice struct {
	ID     string `json:"id"`
	Linked bool   `json:"linked"`
}

// me builds Me for userID; deviceID is the session's device ("" none).
func (s *Server) me(ctx context.Context, userID, deviceID string) (*Me, error) {
	q := s.d.Store.R
	u, err := store.UserByID(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	me := &Me{ID: u.ID, Email: u.Email, Lang: u.Lang, ServerRole: u.ServerRole, CanCreate: u.ServerRole == "owner" || u.ServerRole == "staff",
		HasEscrow: u.HasEscrow, Notify: EffectiveNotify(u.Notify), MailRelay: s.MailRelay()}
	if u.EncPub != "" {
		me.Keys = &MeKeys{EncPub: u.EncPub, SigPub: u.SigPub, At: u.KeysAt}
	}
	if deviceID != "" {
		var linked bool
		err := q.QueryRowContext(ctx, "SELECT wrap IS NOT NULL FROM devices WHERE id = ? AND user_id = ?", deviceID, userID).Scan(&linked)
		if err == nil {
			me.Device = &MeDevice{ID: deviceID, Linked: linked}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	ms := s.d.Now().UnixMilli()
	if err := q.QueryRowContext(ctx, `SELECT count(*) FROM members w JOIN members o ON o.site_id = w.site_id
		WHERE o.user_id = ? AND o.role = 'owner' AND o.status = 'granted' AND w.status = 'waiting'`, userID).Scan(&me.WaitingGrants); err != nil {
		return nil, err
	}
	if err := q.QueryRowContext(ctx, "SELECT count(*) FROM link_requests WHERE user_id = ? AND status = 'pending' AND expires > ?", userID, ms).Scan(&me.LinkRequests); err != nil {
		return nil, err
	}
	return me, nil
}

// getMe: GET /api/me.
func (s *Server) getMe(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	me, err := s.me(r.Context(), sess.UserID, sess.DeviceID)
	if err != nil {
		s.internal(w, "me", err)
		return
	}
	writeJSON(w, http.StatusOK, me)
}

// patchMe: PATCH /api/me {lang?, notify?}. lang is the email language;
// notify merges known keys only.
func (s *Server) patchMe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Lang   *string          `json:"lang"`
		Notify map[string]*bool `json:"notify"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	if req.Lang != nil && !mail.ValidLang(*req.Lang) {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "lang"})
		return
	}
	for k, v := range req.Notify {
		if _, ok := NotifyKeys[k]; !ok || v == nil {
			writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "notify"})
			return
		}
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		u, err := store.UserByID(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		if req.Lang != nil {
			if _, err := tx.ExecContext(ctx, "UPDATE users SET lang = ? WHERE id = ?", *req.Lang, u.ID); err != nil {
				return err
			}
		}
		if len(req.Notify) > 0 {
			stored := map[string]bool{}
			json.Unmarshal([]byte(u.Notify), &stored)
			for k, v := range req.Notify {
				stored[k] = *v
			}
			b, _ := json.Marshal(stored)
			if _, err := tx.ExecContext(ctx, "UPDATE users SET notify = ? WHERE id = ?", string(b), u.ID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.internal(w, "patch me", err)
		return
	}
	s.d.Hub.PublishExcept(sess.UserID, sess.ID, hub.NewEvent("me", struct{}{}))
	s.getMe(w, r)
}

// mySessions: GET /api/me/sessions.
func (s *Server) mySessions(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	rows, err := store.UserSessions(r.Context(), s.d.Store.R, sess.UserID)
	if err != nil {
		s.internal(w, "sessions", err)
		return
	}
	type item struct {
		ID       string `json:"id"`
		Created  int64  `json:"created"`
		LastSeen int64  `json:"lastSeen"`
		Expires  int64  `json:"expires"`
		IP       string `json:"ip"`
		UA       string `json:"ua"`
		DeviceID string `json:"deviceId"`
		Current  bool   `json:"current"`
	}
	out := []item{}
	for _, r := range rows {
		out = append(out, item{r.ID, r.Created, r.LastSeen, r.Expires, r.IP, r.UA, r.DeviceID, r.ID == sess.ID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

// deleteMySession: DELETE /api/me/sessions/{id}. Ending the current session
// also clears its cookie.
func (s *Server) deleteMySession(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	id := r.PathValue("id")
	err := store.DeleteUserSession(r.Context(), s.d.Store.W, sess.UserID, id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	if err != nil {
		s.internal(w, "delete session", err)
		return
	}
	s.closeSessions([]string{id})
	if id == sess.ID {
		s.setCookie(w, s.sessionCookie(), "", 0)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// revokeOthers: POST /api/me/sessions/revoke-others.
func (s *Server) revokeOthers(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ids, err := store.DeleteUserSessions(r.Context(), s.d.Store.W, sess.UserID, sess.ID)
	if err != nil {
		s.internal(w, "revoke sessions", err)
		return
	}
	s.closeSessions(ids)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
