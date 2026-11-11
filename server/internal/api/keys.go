package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"

	"carino.systems/topo/server/internal/hub"
	"carino.systems/topo/server/internal/notify"
	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// Limits for keys and devices.
const (
	maxDevices     = 50
	linkTTL        = 15 * time.Minute
	maxEscrowBytes = 16 << 10
	maxWrapBytes   = 16 << 10
)

// cleanLabel keeps a device label printable and short.
func cleanLabel(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	return clip(strings.TrimSpace(s), 80)
}

// checkEscrow shape-checks a recovery escrow blob (design §5.4); the server
// cannot open it.
func checkEscrow(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || len(raw) > maxEscrowBytes {
		return "", fail(http.StatusBadRequest, ErrBadRequest)
	}
	var e struct {
		V    int    `json:"v"`
		KDF  string `json:"kdf"`
		Salt string `json:"salt"`
		IV   string `json:"iv"`
		CT   string `json:"ct"`
	}
	if json.Unmarshal(raw, &e) != nil || e.V != 1 || e.KDF != "HKDF-SHA256" {
		return "", fail(http.StatusBadRequest, ErrBadRequest)
	}
	salt, err1 := tcrypto.DecodeB64(e.Salt)
	iv, err2 := tcrypto.DecodeB64(e.IV)
	ct, err3 := tcrypto.DecodeB64(e.CT)
	if err1 != nil || err2 != nil || err3 != nil || len(salt) != 16 || len(iv) != 12 || len(ct) < 17 || len(ct) > tcrypto.MaxBundleCT {
		return "", fail(http.StatusBadRequest, ErrBadRequest)
	}
	return string(raw), nil
}

// checkDeviceWrap verifies a user bundle wrapped to a device: addressed to
// that device's key, the right ctx, made by the user and signed with
// sigPub (the user's, or the new one at key setup).
func checkDeviceWrap(raw json.RawMessage, user string, dev *store.Device, sigPub string) (string, error) {
	if len(raw) == 0 || len(raw) > maxWrapBytes {
		return "", fail(http.StatusBadRequest, ErrBadWrap)
	}
	w, err := tcrypto.ParseWrap(raw, 17, tcrypto.MaxBundleCT)
	if err != nil {
		return "", fail(http.StatusBadRequest, ErrBadWrap)
	}
	if err := w.Check(tcrypto.DeviceCtx(user, dev.ID), dev.DevPub, user, sigPub); err != nil {
		if errors.Is(err, tcrypto.ErrSignature) {
			return "", fail(http.StatusUnprocessableEntity, ErrBadSignature)
		}
		return "", fail(http.StatusUnprocessableEntity, ErrBadWrap)
	}
	return string(raw), nil
}

// addDevice: POST /api/devices {devPub, label}. The session is bound to it.
func (s *Server) addDevice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DevPub string `json:"devPub"`
		Label  string `json:"label"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	if _, _, err := tcrypto.ParseRawP256(req.DevPub); err != nil {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "devPub"})
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	ms := s.d.Now().UnixMilli()
	id := store.NewID("d_")
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		n, err := store.CountDevices(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		if n >= maxDevices {
			return fail(http.StatusConflict, ErrConflict)
		}
		if err := store.InsertDevice(ctx, tx, &store.Device{ID: id, UserID: sess.UserID, DevPub: req.DevPub, Label: cleanLabel(req.Label), Created: ms, LastSeen: ms}); err != nil {
			return err
		}
		return store.BindSession(ctx, tx, sess.ID, id)
	})
	if err != nil {
		s.answer(w, "add device", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// listDevices: GET /api/devices.
func (s *Server) listDevices(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ds, err := store.UserDevices(r.Context(), s.d.Store.R, sess.UserID)
	if err != nil {
		s.internal(w, "devices", err)
		return
	}
	type item struct {
		ID       string `json:"id"`
		Label    string `json:"label"`
		Created  int64  `json:"created"`
		LastSeen int64  `json:"lastSeen"`
		Linked   bool   `json:"linked"`
		Current  bool   `json:"current"`
	}
	out := []item{}
	for _, d := range ds {
		out = append(out, item{d.ID, d.Label, d.Created, d.LastSeen, d.Wrap != "", d.ID == sess.DeviceID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": out})
}

// deleteDevice: DELETE /api/devices/{id}: the device, its wrap, its link
// requests and its sessions (and their live streams) go.
func (s *Server) deleteDevice(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	var ids []string
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		ids, err = store.DeleteDevice(ctx, tx, sess.UserID, r.PathValue("id"))
		if errors.Is(err, store.ErrNotFound) {
			return fail(http.StatusNotFound, ErrNotFound)
		}
		return err
	})
	if err != nil {
		s.answer(w, "delete device", err)
		return
	}
	s.closeSessions(ids)
	for _, id := range ids {
		if id == sess.ID {
			s.setCookie(w, s.sessionCookie(), "", 0)
		}
	}
	noContent(w)
}

// deviceWrap: GET /api/devices/{id}/wrap (own device only).
func (s *Server) deviceWrap(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	d, err := store.DeviceByID(r.Context(), s.d.Store.R, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) || (err == nil && (d.UserID != sess.UserID || d.Wrap == "")) {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	if err != nil {
		s.internal(w, "device wrap", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wrap": json.RawMessage(d.Wrap), "wrappedBy": d.WrappedBy})
}

// sessionDevice is the device the session is bound to, which must be the
// user's.
func (s *Server) sessionDevice(ctx context.Context, q store.Q, sess *Session) (*store.Device, error) {
	if sess.DeviceID == "" {
		return nil, fail(http.StatusConflict, ErrNoDevice)
	}
	d, err := store.DeviceByID(ctx, q, sess.DeviceID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && d.UserID != sess.UserID) {
		return nil, fail(http.StatusConflict, ErrNoDevice)
	}
	return d, err
}

// putKeys: PUT /api/me/keys {encPub, sigPub, deviceWrap, escrow|null,
// reset}. First setup, or "Reset my keys" (D77): new keys, every other
// device unlinked, every other session signed out, every site wrap gone,
// every membership waiting again, co-members told (keys-changed) and the
// site owners emailed.
func (s *Server) putKeys(w http.ResponseWriter, r *http.Request) {
	var req struct {
		EncPub     string          `json:"encPub"`
		SigPub     string          `json:"sigPub"`
		DeviceWrap json.RawMessage `json:"deviceWrap"`
		Escrow     json.RawMessage `json:"escrow"`
		Reset      bool            `json:"reset"`
	}
	if err := decodeBody(w, r, 128<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	if _, _, err := tcrypto.ParseRawP256(req.EncPub); err != nil {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "encPub"})
		return
	}
	if _, _, err := tcrypto.ParseRawP256(req.SigPub); err != nil || req.SigPub == req.EncPub {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "sigPub"})
		return
	}
	var escrow *string
	if len(req.Escrow) > 0 && string(req.Escrow) != "null" {
		e, err := checkEscrow(req.Escrow)
		if err != nil {
			s.answer(w, "keys", err)
			return
		}
		escrow = &e
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	now := s.d.Now()
	ms := now.UnixMilli()
	var evs []pendingEvent
	var closed []string
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		u, err := store.UserByID(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		if u.EncPub != "" && !req.Reset {
			return fail(http.StatusConflict, ErrConflict)
		}
		dev, err := s.sessionDevice(ctx, tx, sess)
		if err != nil {
			return err
		}
		wrap, err := checkDeviceWrap(req.DeviceWrap, u.ID, dev, req.SigPub)
		if err != nil {
			return err
		}
		if err := store.SetUserKeys(ctx, tx, u.ID, req.EncPub, req.SigPub, ms, escrow); err != nil {
			return err
		}
		if err := store.SetDeviceWrap(ctx, tx, dev.ID, wrap, "setup"); err != nil {
			return err
		}
		if u.EncPub == "" {
			return nil
		}
		// A reset (D77, amendments A6 and B4).
		if err := store.KillChallenges(ctx, tx, u.EmailNorm); err != nil {
			return err
		}
		sites, err := store.ResetUserKeys(ctx, tx, u.ID, dev.ID)
		if err != nil {
			return err
		}
		// Every other session ends: a stolen browser signed in as this
		// user must not outlive the reset (it keeps the old keys only).
		if closed, err = store.DeleteUserSessions(ctx, tx, u.ID, sess.ID); err != nil {
			return err
		}
		co := map[string]bool{}
		for _, site := range sites {
			ms2, err := store.SiteMembers(ctx, tx, site)
			if err != nil {
				return err
			}
			for _, m := range ms2 {
				if m.UserID != u.ID && m.Status == "granted" {
					co[m.UserID] = true
				}
			}
			rc := notify.Recipients("member-joined", u.ID, nil, ms2)
			if _, err := notify.Enqueue(ctx, tx, site, "member-joined", rc, notify.Options{Now: now, EventDelay: s.d.Cfg.NotifyEventDelay, Data: map[string]string{"email": u.Email, "reason": "keys"}}); err != nil {
				return err
			}
		}
		var users []string
		for id := range co {
			users = append(users, id)
		}
		evs = append(evs, pendingEvent{users, "keys-changed", map[string]string{"user": u.ID}})
		for _, site := range sites {
			evs = append(evs, pendingEvent{s.ownersOf(ctx, tx, site), "invite-accepted", map[string]string{"site": site, "user": u.ID}})
		}
		return nil
	})
	if err != nil {
		s.answer(w, "keys", err)
		return
	}
	s.closeSessions(closed)
	s.flush(evs)
	s.wake()
	s.touchOwned(ctx, sess.UserID)
	s.getMe(w, r)
}

// ownersOf lists a site's granted owners (errors give none).
func (s *Server) ownersOf(ctx context.Context, q store.Q, site string) []string {
	rows, err := q.QueryContext(ctx, "SELECT user_id FROM members WHERE site_id = ? AND role = 'owner' AND status = 'granted'", site)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var u string
		if rows.Scan(&u) == nil {
			out = append(out, u)
		}
	}
	return out
}

// getEscrow: GET /api/me/escrow.
func (s *Server) getEscrow(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	e, err := store.GetEscrow(r.Context(), s.d.Store.R, sess.UserID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	if err != nil {
		s.internal(w, "escrow", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"escrow": json.RawMessage(e)})
}

// putEscrow: PUT /api/me/escrow {escrow}: a new recovery code replaces the
// old one.
func (s *Server) putEscrow(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Escrow json.RawMessage `json:"escrow"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	e, err := checkEscrow(req.Escrow)
	if err != nil {
		s.answer(w, "escrow", err)
		return
	}
	sess := SessionFrom(r.Context())
	if err := store.SetEscrow(r.Context(), s.d.Store.W, sess.UserID, e); err != nil {
		s.internal(w, "escrow", err)
		return
	}
	s.touchOwned(r.Context(), sess.UserID)
	noContent(w)
}

// selfWrap: POST /api/me/devices/self-wrap {wrap}: a device that opened the
// account with the recovery code stores its own wrap.
func (s *Server) selfWrap(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Wrap json.RawMessage `json:"wrap"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		dev, err := s.sessionDevice(ctx, tx, sess)
		if err != nil {
			return err
		}
		if dev.Wrap != "" {
			return fail(http.StatusConflict, ErrConflict)
		}
		u, err := store.UserByID(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		wrap, err := checkDeviceWrap(req.Wrap, u.ID, dev, u.SigPub)
		if err != nil {
			return err
		}
		if err := store.SetDeviceWrap(ctx, tx, dev.ID, wrap, "recovery"); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE link_requests SET status = 'expired' WHERE device_id = ? AND status = 'pending'", dev.ID)
		return err
	})
	if err != nil {
		s.answer(w, "self wrap", err)
		return
	}
	noContent(w)
}

// addLinkRequest: POST /api/link-requests {}: this browser (the session's
// device, not linked yet) asks the user's other browsers for the bundle.
// The other sessions get a live event; when none is online, the user gets
// an email.
func (s *Server) addLinkRequest(w http.ResponseWriter, r *http.Request) {
	var req struct{}
	if err := decodeBody(w, r, 1<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	now := s.d.Now()
	ms := now.UnixMilli()
	l := &store.LinkRequest{ID: store.NewID("k_"), UserID: sess.UserID, Created: ms, Expires: now.Add(linkTTL).UnixMilli()}
	online := s.d.Hub.OnlineExcept(sess.UserID, sess.ID)
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		dev, err := s.sessionDevice(ctx, tx, sess)
		if err != nil {
			return err
		}
		if dev.Wrap != "" {
			return fail(http.StatusConflict, ErrConflict)
		}
		l.DeviceID = dev.ID
		if err := store.InsertLinkRequest(ctx, tx, l); err != nil {
			return err
		}
		if online {
			return nil
		}
		// One email per user per 15 minutes at most.
		n, err := store.CountMail(ctx, tx, "link-request", "", sess.UserID, ms-linkTTL.Milliseconds())
		if err != nil || n > 0 {
			return err
		}
		u, err := store.UserByID(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		return store.InsertMail(ctx, tx, &store.Mail{ID: store.NewID("o_"), Kind: "link-request", To: u.EmailNorm, UserID: u.ID, Lang: u.Lang, Data: "{}", Created: ms, SendAfter: ms})
	})
	if err != nil {
		s.answer(w, "link request", err)
		return
	}
	s.d.Hub.PublishExcept(sess.UserID, sess.ID, hub.NewEvent("link-request", map[string]string{"id": l.ID}))
	s.wake()
	writeJSON(w, http.StatusCreated, map[string]any{"id": l.ID, "expires": l.Expires})
}

// listLinkRequests: GET /api/link-requests (pending only).
func (s *Server) listLinkRequests(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ls, err := store.PendingLinkRequests(r.Context(), s.d.Store.R, sess.UserID, s.d.Now().UnixMilli())
	if err != nil {
		s.internal(w, "link requests", err)
		return
	}
	type item struct {
		ID       string `json:"id"`
		DeviceID string `json:"deviceId"`
		DevPub   string `json:"devPub"`
		Label    string `json:"label"`
		Created  int64  `json:"created"`
		Expires  int64  `json:"expires"`
	}
	out := []item{}
	for _, l := range ls {
		out = append(out, item{l.ID, l.DeviceID, l.DevPub, l.Label, l.Created, l.Expires})
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": out})
}

// pendingLink loads one of the user's pending, unexpired link requests.
func (s *Server) pendingLink(ctx context.Context, q store.Q, sess *Session, id string) (*store.LinkRequest, error) {
	l, err := store.LinkRequestByID(ctx, q, id)
	if errors.Is(err, store.ErrNotFound) || (err == nil && (l.UserID != sess.UserID || l.Status != "pending" || l.Expires <= s.d.Now().UnixMilli())) {
		return nil, fail(http.StatusNotFound, ErrNotFound)
	}
	return l, err
}

// approveLink: POST /api/link-requests/{id}/approve {wrap}. Only a linked
// device may approve; the wrap is the bundle to the new device, signed by
// the user.
func (s *Server) approveLink(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Wrap json.RawMessage `json:"wrap"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	id := r.PathValue("id")
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		me, err := s.sessionDevice(ctx, tx, sess)
		if err != nil {
			return err
		}
		if me.Wrap == "" {
			return fail(http.StatusForbidden, ErrForbidden)
		}
		l, err := s.pendingLink(ctx, tx, sess, id)
		if err != nil {
			return err
		}
		dev, err := store.DeviceByID(ctx, tx, l.DeviceID)
		if err != nil {
			return err
		}
		u, err := store.UserByID(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		wrap, err := checkDeviceWrap(req.Wrap, u.ID, dev, u.SigPub)
		if err != nil {
			return err
		}
		if err := store.SetDeviceWrap(ctx, tx, dev.ID, wrap, me.ID); err != nil {
			return err
		}
		return store.SetLinkStatus(ctx, tx, l.ID, "approved")
	})
	if err != nil {
		s.answer(w, "approve link", err)
		return
	}
	s.publish([]string{sess.UserID}, "link-approved", map[string]string{"id": id})
	noContent(w)
}

// denyLink: POST /api/link-requests/{id}/deny.
func (s *Server) denyLink(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	id := r.PathValue("id")
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		l, err := s.pendingLink(ctx, tx, sess, id)
		if err != nil {
			return err
		}
		return store.SetLinkStatus(ctx, tx, l.ID, "denied")
	})
	if err != nil {
		s.answer(w, "deny link", err)
		return
	}
	s.publish([]string{sess.UserID}, "link-denied", map[string]string{"id": id})
	noContent(w)
}

// touchOwned writes a fresh backup of every network the user owns: after a
// key reset or a new recovery key, older backups open only with the old
// recovery key, so the next file must carry the new one (amendment 2).
func (s *Server) touchOwned(ctx context.Context, user string) {
	if s.d.Backups == nil {
		return
	}
	sites, err := store.OwnedSites(ctx, s.d.Store.R, user)
	if err != nil {
		s.d.Log.Warn("backups: owned sites", "err", err)
		return
	}
	s.d.Backups.TouchNow(sites...)
}
