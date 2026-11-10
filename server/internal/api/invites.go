package api

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/notify"
	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// Invitation limits (design §4.6, amendment B8).
const (
	inviteTTL          = 14 * 24 * time.Hour
	maxPendingInvites  = 50
	invitesPerInviter  = 100 // invitation emails per inviting user per 24 h
	invitesPerEmail    = 5   // invitation emails to one address per 24 h, any site
	sendsPerInvitation = 3   // emails per invitation per 24 h (the first one and resends)
	maxMembers         = tcrypto.MaxRosterMembers
)

type inviteJSON struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Role    string `json:"role"`
	Status  string `json:"status"`
	Created int64  `json:"created"`
	Expires int64  `json:"expires"`
}

// sendInvite gives the invitation a fresh token and queues its email,
// inside tx, within the B8 caps.
func (s *Server) sendInvite(ctx context.Context, tx *sql.Tx, inv *store.Invite, inviter *Session, fresh bool) error {
	now := s.d.Now()
	ms := now.UnixMilli()
	byInviter, toEmail, forInvite, err := store.InviteSendCounts(ctx, tx, inviter.UserID, inv.EmailNorm, inv.ID, now.Add(-24*time.Hour).UnixMilli())
	if err != nil {
		return err
	}
	if byInviter >= invitesPerInviter || toEmail >= invitesPerEmail || forInvite >= sendsPerInvitation {
		return failWith(http.StatusTooManyRequests, ErrRateLimited, map[string]any{"retryAfter": 3600})
	}
	token := inv.ID + "." + auth.NewToken()
	inv.TokenHash = auth.Hash(token)
	inv.Expires = now.Add(inviteTTL).UnixMilli()
	if fresh {
		inv.Created = ms
		if err := store.InsertInvite(ctx, tx, inv); err != nil {
			return err
		}
	} else if err := store.RenewInvite(ctx, tx, inv.ID, inv.TokenHash, inv.Role, inv.Lang, inv.Expires); err != nil {
		return err
	}
	if err := store.AddInviteSend(ctx, tx, inviter.UserID, inv.SiteID, inv.ID, inv.EmailNorm, ms); err != nil {
		return err
	}
	data, _ := json.Marshal(map[string]string{"inviter": inviter.Email, "role": inv.Role, "link": s.d.Cfg.Origin() + "/#invite=" + token})
	return store.InsertMail(ctx, tx, &store.Mail{ID: store.NewID("o_"), Kind: "invite", To: inv.EmailNorm, SiteID: inv.SiteID, Lang: inv.Lang,
		Data: string(data), Created: ms, SendAfter: ms})
}

// invite: POST /api/sites/{site}/invites {email, role, lang}. Inviting an
// address that already has a pending invitation replaces its token (and
// role) and sends it again.
func (s *Server) invite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		Role  string `json:"role"`
		Lang  string `json:"lang"`
	}
	if err := decodeBody(w, r, siteBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	norm, ok := auth.NormalizeEmail(req.Email)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrBadEmail, nil)
		return
	}
	if !tcrypto.ValidRole(req.Role) {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "role"})
		return
	}
	if !mail.ValidLang(req.Lang) {
		req.Lang = "en"
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	site := r.PathValue("site")
	ms := s.d.Now().UnixMilli()
	var inv *store.Invite
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		if u, err := store.UserByEmail(ctx, tx, norm); err == nil {
			if _, err := store.MemberOf(ctx, tx, site, u.ID); err == nil {
				return fail(http.StatusConflict, ErrMember)
			}
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		var members int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM members WHERE site_id = ?", site).Scan(&members); err != nil {
			return err
		}
		if members >= maxMembers {
			return fail(http.StatusConflict, ErrConflict)
		}
		existing, err := store.PendingInviteFor(ctx, tx, site, norm)
		switch {
		case err == nil:
			existing.Role, existing.Lang = req.Role, req.Lang
			inv = existing
			return s.sendInvite(ctx, tx, inv, sess, false)
		case !errors.Is(err, store.ErrNotFound):
			return err
		}
		n, err := store.CountPendingInvites(ctx, tx, site, ms)
		if err != nil {
			return err
		}
		if n >= maxPendingInvites {
			return fail(http.StatusConflict, ErrConflict)
		}
		inv = &store.Invite{ID: store.NewID("i_"), SiteID: site, EmailNorm: norm, Role: req.Role, Lang: req.Lang, Status: "pending", InvitedBy: sess.UserID}
		return s.sendInvite(ctx, tx, inv, sess, true)
	})
	if err != nil {
		s.answer(w, "invite", err)
		return
	}
	s.wake()
	writeJSON(w, http.StatusCreated, map[string]any{"invite": inviteJSON{inv.ID, inv.EmailNorm, inv.Role, "pending", inv.Created, inv.Expires}})
}

// siteInvite loads an invitation of the site in the path.
func siteInvite(ctx context.Context, q store.Q, r *http.Request) (*store.Invite, error) {
	inv, err := store.InviteByID(ctx, q, r.PathValue("iid"))
	if errors.Is(err, store.ErrNotFound) || (err == nil && inv.SiteID != r.PathValue("site")) {
		return nil, fail(http.StatusNotFound, ErrNotFound)
	}
	return inv, err
}

// resendInvite: POST /api/sites/{site}/invites/{iid}/resend: a new token
// and a new 14 days (at most 3 emails per invitation per day).
func (s *Server) resendInvite(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		inv, err := siteInvite(ctx, tx, r)
		if err != nil {
			return err
		}
		if inv.Status != "pending" && inv.Status != "expired" {
			return fail(http.StatusConflict, ErrConflict)
		}
		if inv.Status == "expired" {
			if err := store.SetInviteStatus(ctx, tx, inv.ID, "pending", "", 0); err != nil {
				return err
			}
		}
		return s.sendInvite(ctx, tx, inv, sess, false)
	})
	if err != nil {
		s.answer(w, "resend invite", err)
		return
	}
	s.wake()
	noContent(w)
}

// cancelInvite: DELETE /api/sites/{site}/invites/{iid}.
func (s *Server) cancelInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		inv, err := siteInvite(ctx, tx, r)
		if err != nil {
			return err
		}
		if inv.Status != "pending" {
			return fail(http.StatusConflict, ErrConflict)
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM outbox WHERE kind = 'invite' AND site_id = ? AND to_email = ? AND sent IS NULL", inv.SiteID, inv.EmailNorm); err != nil {
			return err
		}
		return store.SetInviteStatus(ctx, tx, inv.ID, "revoked", "", 0)
	})
	if err != nil {
		s.answer(w, "cancel invite", err)
		return
	}
	noContent(w)
}

// inviteByToken finds the pending, unexpired invitation a token opens.
// Every failure is the same bad-invite.
func (s *Server) inviteByToken(ctx context.Context, q store.Q, token string) (*store.Invite, error) {
	iid, secret, ok := strings.Cut(token, ".")
	if !ok || !strings.HasPrefix(iid, "i_") || len(iid) > 40 || !auth.ValidToken(secret) {
		return nil, fail(http.StatusBadRequest, ErrBadInvite)
	}
	inv, err := store.InviteByID(ctx, q, iid)
	if errors.Is(err, store.ErrNotFound) {
		return nil, fail(http.StatusBadRequest, ErrBadInvite)
	}
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare(inv.TokenHash, auth.Hash(token)) != 1 || inv.Status != "pending" || inv.Expires <= s.d.Now().UnixMilli() {
		return nil, fail(http.StatusBadRequest, ErrBadInvite)
	}
	return inv, nil
}

// peekInvite: POST /api/invites/peek {token}: who the invitation is for,
// so the sign-in sheet can be prefilled. Only the token holder learns the
// address. Rate-limited per IP.
func (s *Server) peekInvite(w http.ResponseWriter, r *http.Request) {
	if ok, wait := s.ipPeeks.Take(s.ipKey(r)); !ok {
		rateLimited(w, wait)
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if err := decodeBody(w, r, 4<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	ctx := r.Context()
	q := s.d.Store.R
	inv, err := s.inviteByToken(ctx, q, req.Token)
	if err != nil {
		s.answer(w, "peek invite", err)
		return
	}
	out := map[string]any{"email": inv.EmailNorm, "role": inv.Role, "site": inv.SiteID, "nameClear": nil, "inviter": ""}
	if st, err := store.SiteByID(ctx, q, inv.SiteID); err == nil && st.ShowName && st.NameClear != "" {
		out["nameClear"] = st.NameClear
	}
	if by, err := store.UserByID(ctx, q, inv.InvitedBy); err == nil {
		out["inviter"] = by.EmailNorm
	}
	writeJSON(w, http.StatusOK, out)
}

// acceptInvite: POST /api/invites/accept {token} or {id}. The caller must be
// signed in as the invited address. They become a waiting member; the
// owners are told (live, and by email) and give access from their browser
// (D61). Accepting by id needs no token: the sign-in already proved the
// address, and the id comes from the caller's own GET /api/sites.
func (s *Server) acceptInvite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
		ID    string `json:"id"`
	}
	if err := decodeBody(w, r, 4<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	now := s.d.Now()
	ms := now.UnixMilli()
	var site string
	var owners []string
	joined := false
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		me, err := store.UserByID(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		var inv *store.Invite
		if req.Token != "" {
			if inv, err = s.inviteByToken(ctx, tx, req.Token); err != nil {
				return err
			}
		} else {
			inv, err = store.InviteByID(ctx, tx, req.ID)
			if errors.Is(err, store.ErrNotFound) || (err == nil && (inv.EmailNorm != me.EmailNorm || inv.Status != "pending" || inv.Expires <= ms)) {
				return fail(http.StatusBadRequest, ErrBadInvite)
			}
			if err != nil {
				return err
			}
		}
		if inv.EmailNorm != me.EmailNorm {
			return fail(http.StatusForbidden, ErrWrongEmail)
		}
		site = inv.SiteID
		if err := store.SetInviteStatus(ctx, tx, inv.ID, "accepted", me.ID, ms); err != nil {
			return err
		}
		if _, err := store.MemberOf(ctx, tx, site, me.ID); err == nil {
			return nil // already a member: nothing more to do
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if err := store.InsertMember(ctx, tx, site, me.ID, inv.Role, "waiting", ms); err != nil {
			return err
		}
		joined = true
		owners = s.ownersOf(ctx, tx, site)
		return joinedNotify(ctx, tx, notify.Options{Now: now, EventDelay: s.d.Cfg.NotifyEventDelay}, site, me.ID, me.Email)
	})
	if err != nil {
		s.answer(w, "accept invite", err)
		return
	}
	if joined {
		s.publish(owners, "invite-accepted", map[string]string{"site": site, "user": sess.UserID})
		s.publish([]string{sess.UserID}, "site-added", map[string]string{"site": site})
		s.wake()
	}
	s.writeSite(w, r, site, http.StatusOK)
}
