package api

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/netip"
	"time"
	"unicode/utf8"

	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/store"
)

// Sign-in error codes (the browser maps each to a translated sentence).
const (
	ErrBadEmail     = "bad-email"
	ErrBadCode      = "bad-code"
	ErrBadLink      = "bad-link"
	ErrOtherBrowser = "other-browser"
)

// Sign-in limits (design §6.3 and amendments B1, B2).
const (
	maxTries         = 5  // per challenge
	maxFailsPerDay   = 10 // failed code verifies per address per 24 h (B1)
	perEmail15       = 5  // requests per address per 15 min, per bucket
	perEmailDay      = 20 // requests per address per 24 h, per bucket
	ipCodesPerHour   = 20
	ipFailsPerHour   = 30
	ipPeeksPerHour   = 60
	challengeCookieX = 5 * time.Minute // challenge cookie outlives the code a little
)

// cookie names: __Host- and Secure on https, plain names on a loopback http
// server (D52, D56).
func (s *Server) sessionCookie() string {
	if s.d.Cfg.Secure() {
		return "__Host-topo_s"
	}
	return "topo_s"
}

func (s *Server) challengeCookie() string {
	if s.d.Cfg.Secure() {
		return "__Host-topo_c"
	}
	return "topo_c"
}

func (s *Server) setCookie(w http.ResponseWriter, name, value string, maxAge time.Duration) {
	c := &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: s.d.Cfg.Secure(), SameSite: http.SameSiteLaxMode}
	if maxAge <= 0 {
		c.MaxAge = -1
		c.Value = ""
	} else {
		c.MaxAge = int(maxAge / time.Second)
	}
	http.SetCookie(w, c)
}

func cookieToken(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil || !auth.ValidToken(c.Value) {
		return ""
	}
	return c.Value
}

func (s *Server) ipKey(r *http.Request) string {
	return RateKey(s.clientIP(r))
}

// clientIP is ClientIP with the configured proxies. A request carrying
// X-Forwarded-For from a peer that is not trusted is logged once, naming
// the peer: behind a proxy (or a container's port forwarding, whose peer
// is rarely 127.0.0.1) every client would otherwise share one rate limit.
func (s *Server) clientIP(r *http.Request) netip.Addr {
	a := ClientIP(r, s.d.Cfg.TrustedProxies)
	if r.Header.Get("X-Forwarded-For") != "" {
		if peer := parseIP(r.RemoteAddr); peer.IsValid() && !inPrefixes(peer, s.d.Cfg.TrustedProxies) {
			s.xffWarned.Do(func() {
				s.d.Log.Warn("X-Forwarded-For from a peer not in TOPO_TRUSTED_PROXIES is ignored: every client behind it shares one rate limit. If it is your reverse proxy, add it", "peer", peer.String())
			})
		}
	}
	return a
}

func (s *Server) ipString(r *http.Request) string {
	a := s.clientIP(r)
	if !a.IsValid() {
		return ""
	}
	return a.String()
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}

func rateLimited(w http.ResponseWriter, wait time.Duration) {
	sec := int((wait + time.Second - 1) / time.Second)
	if sec < 1 {
		sec = 1
	}
	writeError(w, http.StatusTooManyRequests, ErrRateLimited, map[string]any{"retryAfter": sec})
}

type rateErr struct{ wait time.Duration }

func (e *rateErr) Error() string { return "rate limited" }

// authRequest: POST /api/auth/request. Always 202 with a challenge id and
// the challenge cookie, whether or not the address may sign in (D55): an
// address that may not gets a decoy challenge that never verifies, written
// with the same statements (B3) and an outbox row that is never sent.
func (s *Server) authRequest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email      string `json:"email"`
		Lang       string `json:"lang"`
		SetupToken string `json:"setupToken"`
		Invite     string `json:"invite"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	norm, ok := auth.NormalizeEmail(req.Email)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrBadEmail, nil)
		return
	}
	lang := req.Lang
	if !mail.ValidLang(lang) {
		lang = "en"
	}
	if ok, wait := s.ipCodes.Take(s.ipKey(r)); !ok {
		rateLimited(w, wait)
		return
	}
	ctx := r.Context()
	now := s.d.Now()
	ms := now.UnixMilli()
	oldBind := cookieToken(r, s.challengeCookie())
	cid := store.NewID("c_")
	code, link, bind := auth.NewCode(), auth.NewToken(), auth.NewToken()
	eligible := false
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		// Every lookup runs on both paths, in the same order (B3).
		u, err := store.UserByEmail(ctx, tx, norm)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		invited, err := store.PendingInvite(ctx, tx, norm, ms)
		if err != nil {
			return err
		}
		owners, err := store.CountOwners(ctx, tx)
		if err != nil {
			return err
		}
		setupOK, err := auth.CheckSetupTokenQ(ctx, tx, req.SetupToken)
		if err != nil {
			return err
		}
		setupOK = setupOK && owners == 0 && s.d.Cfg.OwnerEmail == ""
		ownerEmail := s.d.Cfg.OwnerEmail != "" && norm == s.d.Cfg.OwnerEmail
		eligible = (u != nil && !u.Disabled) || invited || ownerEmail || setupOK

		// Per-address limits. A request from the browser that already holds
		// a recent challenge for this address counts in its own bucket, so a
		// flood from elsewhere cannot lock the real person out (B2).
		kind := "req"
		if oldBind != "" {
			own, err := store.RecentChallengeByBind(ctx, tx, auth.Hash(oldBind), norm, ms-int64(15*time.Minute/time.Millisecond))
			if err != nil {
				return err
			}
			if own {
				kind = "own"
			}
		}
		for _, lim := range []struct {
			win time.Duration
			max int
		}{{15 * time.Minute, perEmail15}, {24 * time.Hour, perEmailDay}} {
			n, oldest, err := store.RateWindow(ctx, tx, norm, kind, ms-lim.win.Milliseconds())
			if err != nil {
				return err
			}
			if n >= lim.max {
				return &rateErr{wait: time.Duration(oldest+lim.win.Milliseconds()-ms) * time.Millisecond}
			}
		}

		if err := store.SupersedeChallenges(ctx, tx, norm); err != nil {
			return err
		}
		mac := auth.RandomBytes(32)
		data := map[string]string{}
		mk, sent := "none", int64(-2)
		if eligible {
			mac = auth.CodeMAC(s.d.Key, cid, code)
			data = map[string]string{"code": code, "link": s.d.Cfg.Origin() + "/#signin=" + link, "minutes": itoa(int(s.d.Cfg.CodeTTL / time.Minute))}
			mk, sent = "signin", 0
		}
		c := &store.Challenge{ID: cid, EmailNorm: norm, Real: eligible, CodeMAC: mac, LinkHash: auth.Hash(link), BindHash: auth.Hash(bind),
			Lang: lang, Setup: setupOK, InviteID: clip(req.Invite, 64), Created: ms, Expires: ms + s.d.Cfg.CodeTTL.Milliseconds(), IP: s.ipString(r)}
		if err := store.InsertChallenge(ctx, tx, c); err != nil {
			return err
		}
		if err := store.RateAdd(ctx, tx, norm, kind, ms); err != nil {
			return err
		}
		b, _ := json.Marshal(data)
		return store.InsertMail(ctx, tx, &store.Mail{ID: store.NewID("o_"), Kind: mk, To: norm, Lang: lang, Data: string(b), Created: ms, SendAfter: ms, Sent: sent})
	})
	var re *rateErr
	if errors.As(err, &re) {
		rateLimited(w, re.wait)
		return
	}
	if err != nil {
		s.internal(w, "sign-in request", err)
		return
	}
	if eligible && s.d.Wake != nil {
		s.d.Wake()
	}
	s.setCookie(w, s.challengeCookie(), bind, s.d.Cfg.CodeTTL+challengeCookieX)
	writeJSON(w, http.StatusAccepted, map[string]any{"challenge": cid})
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func (s *Server) internal(w http.ResponseWriter, what string, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	s.d.Log.Error(what, "err", err)
	writeError(w, http.StatusInternalServerError, ErrInternal, nil)
}

// errNotEligible: the challenge was real, but by now the address may no
// longer sign in (its invite expired, the user was disabled).
var errNotEligible = errors.New("not eligible")

// signedIn is the result of a successful verify or link.
type signedIn struct {
	token    string
	userID   string
	deviceID string
	closed   []string // session ids ended (B4)
}

// signIn turns a consumed challenge into a session, inside tx: it creates
// the user when the address may sign in without one (owner email, setup
// token, pending invite), applies the owner rules (D53), drops any session
// this browser already had (B4) and issues a fresh one.
func (s *Server) signIn(ctx context.Context, tx *sql.Tx, r *http.Request, c *store.Challenge, deviceID string) (*signedIn, error) {
	ms := s.d.Now().UnixMilli()
	norm := c.EmailNorm
	ownerEmail := s.d.Cfg.OwnerEmail != "" && norm == s.d.Cfg.OwnerEmail
	owners, err := store.CountOwners(ctx, tx)
	if err != nil {
		return nil, err
	}
	setupWins := c.Setup && owners == 0 && s.d.Cfg.OwnerEmail == ""
	u, err := store.UserByEmail(ctx, tx, norm)
	switch {
	case errors.Is(err, store.ErrNotFound):
		role := ""
		switch {
		case ownerEmail || setupWins:
			role = "owner"
		default:
			invited, err := store.PendingInvite(ctx, tx, norm, ms)
			if err != nil {
				return nil, err
			}
			if invited {
				role = "member"
			}
		}
		if role == "" {
			return nil, errNotEligible
		}
		u = &store.User{ID: store.NewID("u_"), Email: norm, EmailNorm: norm, Lang: c.Lang, ServerRole: "member", Created: ms}
		if err := store.CreateUser(ctx, tx, u); err != nil {
			return nil, err
		}
		if role == "owner" {
			if err := store.SetServerRole(ctx, tx, u.ID, "owner"); err != nil {
				return nil, err
			}
		}
	case err != nil:
		return nil, err
	default:
		if u.Disabled && !ownerEmail {
			return nil, errNotEligible
		}
		if (ownerEmail || setupWins) && (u.ServerRole != "owner" || u.Disabled) {
			if _, err := tx.ExecContext(ctx, "UPDATE users SET disabled = 0 WHERE id = ?", u.ID); err != nil {
				return nil, err
			}
			if err := store.SetServerRole(ctx, tx, u.ID, "owner"); err != nil {
				return nil, err
			}
		}
	}
	if setupWins {
		if _, err := tx.ExecContext(ctx, "DELETE FROM meta WHERE key = ?", auth.MetaSetupToken); err != nil {
			return nil, err
		}
	}
	out := &signedIn{userID: u.ID}
	if old := cookieToken(r, s.sessionCookie()); old != "" {
		id, err := store.DeleteSessionByHash(ctx, tx, auth.Hash(old))
		if err != nil {
			return nil, err
		}
		if id != "" {
			out.closed = append(out.closed, id)
		}
	}
	dev := ""
	if deviceID != "" && len(deviceID) <= 64 {
		if owner, err := store.DeviceOwner(ctx, tx, deviceID); err == nil && owner == u.ID {
			dev = deviceID
		}
	}
	out.deviceID = dev
	out.token = auth.NewToken()
	row := &store.SessionRow{IDHash: auth.Hash(out.token), ID: store.NewID("l_"), UserID: u.ID, DeviceID: dev,
		Created: ms, LastSeen: ms, Expires: ms + s.d.Cfg.SessionMax.Milliseconds(), IP: s.ipString(r), UA: clip(r.UserAgent(), 120)}
	if err := store.InsertSession(ctx, tx, row); err != nil {
		return nil, err
	}
	return out, nil
}

// finishSignIn sets the cookies and answers with Me.
func (s *Server) finishSignIn(w http.ResponseWriter, r *http.Request, si *signedIn) {
	s.closeSessions(si.closed)
	s.setCookie(w, s.sessionCookie(), si.token, s.d.Cfg.SessionMax)
	s.setCookie(w, s.challengeCookie(), "", 0)
	me, err := s.me(r.Context(), si.userID, si.deviceID)
	if err != nil {
		s.internal(w, "me after sign-in", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": me})
}

func (s *Server) closeSessions(ids []string) {
	if len(ids) > 0 && s.d.CloseSessions != nil {
		s.d.CloseSessions(ids)
	}
}

// authVerify: POST /api/auth/verify {challenge, code, deviceId?}. Every
// failure is the same 400 bad-code: wrong code, decoy, unknown id, used,
// expired, out of tries, or the address over its daily failure budget (B1).
func (s *Server) authVerify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Challenge string `json:"challenge"`
		Code      string `json:"code"`
		DeviceID  string `json:"deviceId"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	ip := s.ipKey(r)
	if ok, wait := s.ipFails.Take(ip); !ok {
		rateLimited(w, wait)
		return
	}
	ctx := r.Context()
	ms := s.d.Now().UnixMilli()
	var si *signedIn
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		if len(req.Challenge) > 64 {
			return nil
		}
		c, err := store.ChallengeByID(ctx, tx, req.Challenge)
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := store.AddTry(ctx, tx, c.ID); err != nil {
			return err
		}
		fails, err := store.VerifyFails(ctx, tx, c.EmailNorm, ms-int64(24*time.Hour/time.Millisecond))
		if err != nil {
			return err
		}
		code, okFmt := auth.NormalizeCode(req.Code)
		match := auth.CheckCode(s.d.Key, c.ID, code, c.CodeMAC)
		good := okFmt && match && c.Real && !c.Used && c.Expires > ms && c.Tries < maxTries && fails < maxFailsPerDay
		if good {
			if err := store.UseChallenge(ctx, tx, c.ID); err != nil {
				return err
			}
			si, err = s.signIn(ctx, tx, r, c, req.DeviceID)
			if errors.Is(err, errNotEligible) {
				si = nil
				return nil
			}
			return err
		}
		return store.VerifyFailAdd(ctx, tx, c.EmailNorm, ms)
	})
	if err != nil {
		s.internal(w, "sign-in verify", err)
		return
	}
	if si == nil {
		writeError(w, http.StatusBadRequest, ErrBadCode, nil)
		return
	}
	s.ipFails.Refund(ip)
	s.finishSignIn(w, r, si)
}

// authLink: POST /api/auth/link {token, deviceId?}. The token arrives in a
// URL fragment (never sent to a server by a mail scanner's prefetch) and is
// consumed only by this POST, only from the browser holding the challenge
// cookie (D54).
func (s *Server) authLink(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token    string `json:"token"`
		DeviceID string `json:"deviceId"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	ip := s.ipKey(r)
	if ok, wait := s.ipFails.Take(ip); !ok {
		rateLimited(w, wait)
		return
	}
	ctx := r.Context()
	ms := s.d.Now().UnixMilli()
	bind := cookieToken(r, s.challengeCookie())
	var si *signedIn
	other := false
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		if !auth.ValidToken(req.Token) {
			return nil
		}
		c, err := store.ChallengeByLink(ctx, tx, auth.Hash(req.Token))
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if !c.Real || c.Used || c.Expires <= ms {
			return nil
		}
		if bind == "" || subtle.ConstantTimeCompare(auth.Hash(bind), c.BindHash) != 1 {
			other = true
			return nil
		}
		if err := store.UseChallenge(ctx, tx, c.ID); err != nil {
			return err
		}
		si, err = s.signIn(ctx, tx, r, c, req.DeviceID)
		if errors.Is(err, errNotEligible) {
			si = nil
			return nil
		}
		return err
	})
	switch {
	case err != nil:
		s.internal(w, "sign-in link", err)
	case other:
		writeError(w, http.StatusConflict, ErrOtherBrowser, nil)
	case si == nil:
		writeError(w, http.StatusBadRequest, ErrBadLink, nil)
	default:
		s.ipFails.Refund(ip)
		s.finishSignIn(w, r, si)
	}
}

// authSignout: POST /api/auth/signout. 204, the session row is deleted and
// the cookie cleared.
func (s *Server) authSignout(w http.ResponseWriter, r *http.Request) {
	sess := SessionFrom(r.Context())
	if sess != nil && len(sess.hash) > 0 {
		if _, err := store.DeleteSessionByHash(r.Context(), s.d.Store.W, sess.hash); err != nil {
			s.internal(w, "sign out", err)
			return
		}
		s.closeSessions([]string{sess.ID})
	}
	s.setCookie(w, s.sessionCookie(), "", 0)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// resolveSession is the default Deps.Sessions: the session cookie, looked up
// by its SHA-256, valid while within both the idle and the absolute limit
// and the user is enabled. last_seen moves at most hourly (D56).
func (s *Server) resolveSession(r *http.Request) *Session {
	if m := s.resolveMonitor(r); m != nil {
		return m
	}
	tok := cookieToken(r, s.sessionCookie())
	if tok == "" {
		return nil
	}
	h := auth.Hash(tok)
	row, err := store.SessionByHash(r.Context(), s.d.Store.R, h)
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			s.d.Log.Error("session lookup", "err", err)
		}
		return nil
	}
	ms := s.d.Now().UnixMilli()
	if row.Expires <= ms || row.LastSeen+s.d.Cfg.SessionIdle.Milliseconds() <= ms || row.User.Disabled {
		return nil
	}
	if ms-row.LastSeen >= int64(time.Hour/time.Millisecond) {
		if err := store.TouchSession(r.Context(), s.d.Store.W, h, ms); err != nil {
			s.d.Log.Warn("session touch", "err", err)
		}
	}
	return &Session{ID: row.ID, UserID: row.UserID, DeviceID: row.DeviceID, ServerRole: row.User.ServerRole,
		HasKeys: row.User.EncPub != "", Email: row.User.Email, hash: h}
}

// authorize is the default Authorizer: Keyed needs keys, Admin the server
// owner, and the site classes the caller's membership of the {site} in the
// path. A stranger to the site gets 404 (ids are not confirmed); a member
// whose role or status is not enough gets 403.
func (s *Server) authorize(r *http.Request, c Class, sess *Session) int {
	switch c {
	case Keyed:
		if !sess.HasKeys {
			return http.StatusForbidden
		}
		return 0
	case Admin:
		if sess.ServerRole != "owner" {
			return http.StatusForbidden
		}
		return 0
	case Member, Reader, Writer, Owner:
		site := r.PathValue("site")
		if site == "" || s.d.Store == nil {
			return http.StatusNotFound
		}
		var role, status string
		err := s.d.Store.R.QueryRowContext(r.Context(), "SELECT role, status FROM members WHERE site_id = ? AND user_id = ?", site, sess.UserID).Scan(&role, &status)
		if errors.Is(err, sql.ErrNoRows) {
			return http.StatusNotFound
		}
		if err != nil {
			s.d.Log.Error("membership lookup", "err", err)
			return http.StatusServiceUnavailable
		}
		granted := status == "granted"
		switch {
		case c == Member:
		case c == Reader && granted:
		case c == Writer && granted && (role == "owner" || role == "provider"):
		case c == Owner && granted && role == "owner":
		default:
			return http.StatusForbidden
		}
		return 0
	}
	return http.StatusNotFound
}
