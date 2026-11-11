package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"time"

	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/store"
)

// Connect for Google Drive and OneDrive (docs/SCOPE.md 5c, D110):
//
//  1. Connect in Account, Backups posts the settings typed so far to
//     oauth/start. The server keeps them sealed with a fresh state and a
//     PKCE verifier, bound to this session, the provider, the app's client
//     id and the redirect address, for 10 minutes, and answers the
//     provider's sign-in address.
//  2. The browser goes there (a page load, not a fetch: the CSP is not
//     involved); the owner says yes.
//  3. The provider sends the browser to GET /api/backups/oauth/callback,
//     which only redirects to /#backup-connect=… (a GET never changes
//     anything, D57).
//  4. The app takes the fragment off the URL and posts oauth/finish. The
//     server checks the state, exchanges the code, seals the refresh token
//     with the other secrets (D105), runs the check, and saves.

const (
	oauthCallbackPath = "/api/backups/oauth/callback"
	oauthStateTTL     = 10 * time.Minute
)

// Error codes of Connect.
const (
	ErrOAuthState  = "oauth-state"  // unknown, used, expired, or another session's
	ErrOAuthDenied = "oauth-denied" // the provider (or the owner) said no
	ErrOAuthKind   = "oauth-kind"   // the destination does not sign in with OAuth
)

func hashHex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// sessionBinding is what ties a Connect to the session that started it.
func sessionBinding(sess *Session) string {
	if sess == nil {
		return ""
	}
	if len(sess.hash) > 0 {
		return hex.EncodeToString(sess.hash)
	}
	return hashHex("id:" + sess.ID)
}

// oauthRedirect is the address the provider sends the browser back to.
// Google and Microsoft take http only for localhost, and no LAN address:
// a request that came in on this machine uses http(s)://localhost:<port>
// (amendment 19), anything else the public address.
func (s *Server) oauthRedirect(r *http.Request) string {
	peer := parseIP(r.RemoteAddr)
	host := r.Host
	if peer.IsValid() && peer.IsLoopback() && config.IsLoopbackHost(hostOnly(host)) {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		_, port, err := net.SplitHostPort(host)
		h := "localhost"
		if err == nil && port != "" {
			h += ":" + port
		}
		return scheme + "://" + h + oauthCallbackPath
	}
	return s.d.Cfg.Origin() + oauthCallbackPath
}

// pending is what Connect keeps while the owner is at the provider.
type pendingConnect struct {
	Enabled         bool              `json:"enabled"`
	Kind            string            `json:"kind"`
	Fields          map[string]string `json:"fields"`
	Secrets         map[string]string `json:"secrets"`
	DailyAt         string            `json:"dailyAt"`
	ReadableAllowed bool              `json:"readableAllowed"`
}

func pendingAAD(stateHash string) string { return "oauth-pending/" + stateHash }

// adminOAuthStart: POST /api/admin/backups/oauth/start {the Save body}:
// {url} of the provider's sign-in page.
func (s *Server) adminOAuthStart(w http.ResponseWriter, r *http.Request) {
	var req backupReq
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	ctx := r.Context()
	m, err := s.mergeBackupReq(ctx, &req)
	if err != nil {
		s.answer(w, "connect", err)
		return
	}
	kind := m.cfg.Kind
	if !backup.OAuthKind(kind) {
		writeError(w, http.StatusBadRequest, ErrOAuthKind, nil)
		return
	}
	if m.settings.Secrets["clientSecret"] == "" {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "clientSecret", "code": "missing"})
		return
	}
	stateB := make([]byte, 32)
	rand.Read(stateB)
	state := base64.RawURLEncoding.EncodeToString(stateB)
	verifier, challenge := backup.PKCE()
	redirect := s.oauthRedirect(r)
	authURL, err := backup.AuthURL(kind, m.settings.Fields, state, challenge, redirect)
	if err != nil {
		s.internal(w, "connect", err)
		return
	}
	p := pendingConnect{Enabled: m.cfg.Enabled, Kind: kind, Fields: m.settings.Fields, Secrets: m.settings.Secrets, DailyAt: m.cfg.DailyAt, ReadableAllowed: m.cfg.ReadableAllowed}
	delete(p.Secrets, "refreshToken") // a new sign-in replaces it
	blob, _ := json.Marshal(p)
	sh := hashHex(state)
	sealed, err := backup.SealSecrets(s.d.Key, "oauth-pending", pendingAAD(sh), map[string]string{"pending": string(blob)})
	if err != nil {
		s.internal(w, "connect", err)
		return
	}
	row := &store.OAuthState{State: sh, Provider: kind, SessHash: sessionBinding(SessionFrom(ctx)), Verifier: verifier,
		ClientIDHash: hashHex(kind + "\n" + m.settings.Fields["clientId"]), RedirectURI: redirect, PendingCt: sealed, Created: s.d.Now().UnixMilli()}
	if err := store.InsertOAuthState(ctx, s.d.Store.W, row); err != nil {
		s.internal(w, "connect", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": authURL, "redirect": redirect})
}

// oauthCallback: GET /api/backups/oauth/callback?code&state[&error]. It
// changes nothing: it hands the answer to the app in the fragment, which
// never reaches a server or a Referer (D110).
func (s *Server) oauthCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	v := url.Values{}
	for _, k := range []string{"state", "code", "error"} {
		if x := q.Get(k); x != "" && len(x) <= 4096 {
			v.Set(k, x)
		}
	}
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Location", "/#backup-connect="+url.QueryEscape(v.Encode()))
	w.WriteHeader(http.StatusSeeOther)
}

// adminOAuthFinish: POST /api/admin/backups/oauth/finish {state, code |
// error}: exchanges the code, saves the destination, answers the backups
// view plus {connect: {account, code}} (code: the check's problem, if any;
// the sign-in is saved either way).
func (s *Server) adminOAuthFinish(w http.ResponseWriter, r *http.Request) {
	var req struct {
		State string `json:"state"`
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := decodeBody(w, r, 16<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	ctx := r.Context()
	if req.State == "" {
		writeError(w, http.StatusBadRequest, ErrOAuthState, nil)
		return
	}
	sh := hashHex(req.State)
	row, err := store.TakeOAuthState(ctx, s.d.Store.W, sh)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusBadRequest, ErrOAuthState, nil)
		return
	}
	if err != nil {
		s.internal(w, "connect", err)
		return
	}
	now := s.d.Now()
	if row.SessHash != sessionBinding(SessionFrom(ctx)) || now.Sub(time.UnixMilli(row.Created)) > oauthStateTTL {
		writeError(w, http.StatusBadRequest, ErrOAuthState, nil)
		return
	}
	if req.Error != "" || req.Code == "" {
		writeError(w, http.StatusUnprocessableEntity, ErrOAuthDenied, nil)
		return
	}
	sec, err := backup.OpenSecrets(s.d.Key, "oauth-pending", pendingAAD(sh), row.PendingCt)
	var p pendingConnect
	if err != nil || json.Unmarshal([]byte(sec["pending"]), &p) != nil || p.Kind != row.Provider ||
		hashHex(p.Kind+"\n"+p.Fields["clientId"]) != row.ClientIDHash {
		writeError(w, http.StatusBadRequest, ErrOAuthState, nil)
		return
	}
	xctx, cancel := context.WithTimeout(ctx, interactiveCheck)
	rt, err := backup.Exchange(xctx, p.Kind, p.Fields, p.Secrets["clientSecret"], req.Code, row.Verifier, row.RedirectURI, now)
	cancel()
	if err != nil {
		s.answer(w, "connect", destFailure(err))
		return
	}
	if p.Secrets == nil {
		p.Secrets = map[string]string{}
	}
	p.Secrets["refreshToken"] = rt

	// The same app and kind keep the destination (its files stay "here");
	// another app or kind is a new destination.
	cur, err := store.GetBackupConfig(ctx, s.d.Store.R)
	if err != nil {
		s.internal(w, "connect", err)
		return
	}
	next := *cur
	saved, _ := backup.SavedSettings(cur, s.d.Key)
	same := cur.Kind == p.Kind && cur.ConfigID != "" && sameFields(saved.Fields, p.Fields)
	if !same {
		next.ConfigID = store.NewID("bc_")
		next.OAuthRef = ""
	}
	next.Enabled, next.Kind, next.DailyAt, next.ReadableAllowed = p.Enabled, p.Kind, p.DailyAt, p.ReadableAllowed
	settings := backup.Settings{Kind: p.Kind, Fields: p.Fields, Secrets: p.Secrets}
	connect := map[string]any{}
	ref := backup.ParseRef(next.OAuthRef)
	if s.d.Backups != nil {
		d, cerr := s.d.Backups.TestDestRef(ctx, settings, next.ConfigID, next.OAuthRef, interactiveCheck)
		if cerr != nil {
			connect["code"] = backup.CodeOf(cerr)
		} else if c, ok := d.(backup.Connected); ok {
			ref = backup.ParseRef(c.Ref())
			actx, cancel := context.WithTimeout(ctx, 10*time.Second)
			ref.Account = c.Account(actx)
			cancel()
		}
	}
	connect["account"] = ref.Account
	next.OAuthRef = ref.String()
	fields, _ := json.Marshal(settings.Fields)
	next.Fields = string(fields)
	if next.SecretCt, err = backup.SealSecrets(s.d.Key, next.Kind, next.ConfigID, settings.Secrets); err != nil {
		s.internal(w, "connect", err)
		return
	}
	next.Updated, next.UpdatedBy = now.UnixMilli(), SessionFrom(ctx).UserID
	if err := store.SetBackupConfig(ctx, s.d.Store.W, &next); err != nil {
		s.internal(w, "connect", err)
		return
	}
	if st, err := store.GetBackupState(ctx, s.d.Store.R); err == nil && connect["code"] == nil {
		st.LastCheckAt, st.LastCheckOK, st.LastCheckErr = now.UnixMilli(), true, ""
		st.BackoffStep, st.BackoffUntil = 0, 0
		st.LastErr, st.LastErrAt = "", 0
		if !same {
			st.DropNote = ""
		}
		store.SetBackupState(ctx, s.d.Store.W, st)
	}
	s.d.Backups.Kick()
	v, err := s.backupView(ctx)
	if err != nil {
		s.internal(w, "connect", err)
		return
	}
	v["connect"] = connect
	writeJSON(w, http.StatusOK, v)
}

// keepAccount is ref (from the destination) with the account of saved
// kept (a Save does not ask the drive who it is again).
func keepAccount(ref, saved string) string {
	r := backup.ParseRef(ref)
	if r.Account == "" {
		r.Account = backup.ParseRef(saved).Account
	}
	return r.String()
}
