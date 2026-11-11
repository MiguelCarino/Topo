package backup

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// OAuth 2.0 for Google Drive and OneDrive (D110), by hand (D109): the
// authorization-code flow with PKCE (S256), and refresh tokens. The client
// registers its own app (docs/SERVER.md); Topo asks only for its own
// folder: Drive "drive.file" (files Topo made), OneDrive
// "Files.ReadWrite.AppFolder" (the app folder) plus "offline_access".
//
// The refresh token is sealed with the other secrets (D105). Access tokens
// live in memory only and are refreshed a minute before they expire, or
// once after a 401. Microsoft rotates refresh tokens: the new one is saved
// (Hooks.Save) before the new access token is used (amendment 20).

// Endpoints are a provider's addresses. Production code never changes
// them; tests swap them for local fakes (SwapEndpoints).
type Endpoints struct {
	Auth   string // the authorize page ({tenant} replaced)
	Token  string // the token endpoint ({tenant} replaced)
	API    string // Drive: .../drive/v3; Graph: .../v1.0
	Upload string // Drive: .../upload/drive/v3
}

var (
	endpointsMu sync.RWMutex
	endpoints   = map[string]Endpoints{
		"gdrive": {Auth: "https://accounts.google.com/o/oauth2/v2/auth", Token: "https://oauth2.googleapis.com/token",
			API: "https://www.googleapis.com/drive/v3", Upload: "https://www.googleapis.com/upload/drive/v3"},
		"onedrive": {Auth: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize", Token: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
			API: "https://graph.microsoft.com/v1.0"},
	}
	scopes = map[string]string{
		"gdrive":   "https://www.googleapis.com/auth/drive.file",
		"onedrive": "Files.ReadWrite.AppFolder offline_access",
	}
)

// SwapEndpoints points kind at other addresses and returns the undo. For
// tests only (local fakes); nothing in the server calls it, and there is
// no setting for it.
func SwapEndpoints(kind string, e Endpoints) (restore func()) {
	endpointsMu.Lock()
	old := endpoints[kind]
	endpoints[kind] = e
	endpointsMu.Unlock()
	tokens.forget()
	return func() {
		endpointsMu.Lock()
		endpoints[kind] = old
		endpointsMu.Unlock()
		tokens.forget()
	}
}

func endpointsOf(kind, tenant string) Endpoints {
	endpointsMu.RLock()
	e := endpoints[kind]
	endpointsMu.RUnlock()
	if tenant == "" {
		tenant = "common"
	}
	t := url.PathEscape(tenant)
	e.Auth = strings.ReplaceAll(e.Auth, "{tenant}", t)
	e.Token = strings.ReplaceAll(e.Token, "{tenant}", t)
	return e
}

// Hooks connect a destination to the server: the clock, what was saved
// with it (oauth_ref) and how to save a rotated refresh token or a folder
// id. The zero value saves nothing.
type Hooks struct {
	Now func() time.Time
	Ref string
	// Save stores the secrets (sealed) and the ref of the destination this
	// was opened for, only while it is still the saved one.
	Save func(secrets map[string]string, ref string) error
}

func (h Hooks) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

// PKCE is a verifier and its S256 challenge.
func PKCE() (verifier, challenge string) {
	b := make([]byte, 32)
	rand.Read(b)
	verifier = base64.RawURLEncoding.EncodeToString(b)
	s := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(s[:])
}

// AuthURL is the provider's sign-in page for the owner's app.
func AuthURL(kind string, fields map[string]string, state, challenge, redirect string) (string, error) {
	if !OAuthKind(kind) {
		return "", &FieldError{"kind", "bad"}
	}
	e := endpointsOf(kind, fields["tenant"])
	u, err := url.Parse(e.Auth)
	if err != nil {
		return "", err
	}
	q := url.Values{
		"client_id": {fields["clientId"]}, "response_type": {"code"}, "redirect_uri": {redirect},
		"scope": {scopes[kind]}, "state": {state}, "code_challenge": {challenge}, "code_challenge_method": {"S256"},
	}
	if kind == "gdrive" {
		// A refresh token is only given with offline access, and again
		// only with consent asked once more.
		q.Set("access_type", "offline")
		q.Set("prompt", "consent")
		q.Set("include_granted_scopes", "false")
	} else {
		q.Set("response_mode", "query")
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// tokenAnswer is a token endpoint's JSON.
type tokenAnswer struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	Error        string `json:"error"`
}

// tokenPost posts a form to the token endpoint.
func tokenPost(ctx context.Context, c *http.Client, kind, tenant string, form url.Values) (*tokenAnswer, error) {
	e := endpointsOf(kind, tenant)
	req, err := http.NewRequestWithContext(ctx, "POST", e.Token, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, errf(CodeOther, "token request: %v", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "topo-server")
	resp, err := c.Do(req)
	if err != nil {
		return nil, netErr(err)
	}
	defer drain(resp)
	var a tokenAnswer
	jerr := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&a)
	if resp.StatusCode != 200 {
		switch a.Error {
		case "invalid_grant":
			return nil, errf(CodeConnect, "token: invalid_grant")
		case "invalid_client", "unauthorized_client":
			return nil, errf(CodeClientSecret, "token: %s", a.Error)
		}
		return nil, statusErr(resp.StatusCode)
	}
	if jerr != nil || a.AccessToken == "" {
		return nil, errf(CodeBadAnswer, "token: no access token")
	}
	return &a, nil
}

// Exchange trades the code the provider sent back for tokens (the finish
// step of Connect). It answers the refresh token; the access token is kept
// in memory for the destination opened next.
func Exchange(ctx context.Context, kind string, fields map[string]string, clientSecret, code, verifier, redirect string, now time.Time) (string, error) {
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirect},
		"client_id": {fields["clientId"]}, "client_secret": {clientSecret}, "code_verifier": {verifier}}
	if kind == "onedrive" {
		form.Set("scope", scopes[kind])
	}
	a, err := tokenPost(ctx, newHTTPClient(""), kind, fields["tenant"], form)
	if err != nil {
		return "", err
	}
	if a.RefreshToken == "" {
		return "", errf(CodeBadAnswer, "token: no refresh token (offline access not granted)")
	}
	tokens.put(tokenKey(kind, fields["clientId"], a.RefreshToken), a.AccessToken, expiry(now, a.ExpiresIn))
	return a.RefreshToken, nil
}

func expiry(now time.Time, in int64) time.Time {
	if in <= 0 {
		in = 3600
	}
	return now.Add(time.Duration(in)*time.Second - time.Minute)
}

// tokenCache keeps access tokens in memory, by provider, client and
// refresh token (never written anywhere).
type tokenCache struct {
	mu sync.Mutex
	m  map[string]cachedToken
}

type cachedToken struct {
	access string
	until  time.Time
}

var tokens = &tokenCache{m: map[string]cachedToken{}}

func tokenKey(kind, clientID, refresh string) string {
	s := sha256.Sum256([]byte(kind + "\n" + clientID + "\n" + refresh))
	return hex.EncodeToString(s[:])
}

func (c *tokenCache) get(k string, now time.Time) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	t, ok := c.m[k]
	if !ok || !now.Before(t.until) {
		return ""
	}
	return t.access
}

func (c *tokenCache) put(k, access string, until time.Time) {
	c.mu.Lock()
	c.m[k] = cachedToken{access, until}
	c.mu.Unlock()
}

func (c *tokenCache) drop(k string) {
	c.mu.Lock()
	delete(c.m, k)
	c.mu.Unlock()
}

func (c *tokenCache) forget() {
	c.mu.Lock()
	c.m = map[string]cachedToken{}
	c.mu.Unlock()
}

// refreshMu serialises refreshes, so two jobs never spend one rotating
// refresh token twice (amendment 20).
var refreshMu sync.Mutex

// oauthClient is what Drive and OneDrive share: the app, the sealed
// secrets (the refresh token updated in place when rotated), the hooks.
type oauthClient struct {
	kind, clientID, tenant string
	secrets                map[string]string
	hooks                  Hooks
	c                      *http.Client
}

func newOAuthClient(kind string, s Settings, h Hooks) (*oauthClient, error) {
	if s.Secrets == nil {
		s.Secrets = map[string]string{}
	}
	return &oauthClient{kind: kind, clientID: s.Fields["clientId"], tenant: s.Fields["tenant"], secrets: s.Secrets, hooks: h, c: newHTTPClient("")}, nil
}

func (o *oauthClient) key() string { return tokenKey(o.kind, o.clientID, o.secrets["refreshToken"]) }

// token is a valid access token: from memory, or refreshed.
func (o *oauthClient) token(ctx context.Context, force bool) (string, error) {
	if o.secrets["refreshToken"] == "" {
		return "", errf(CodeConnect, "not connected")
	}
	if !force {
		if t := tokens.get(o.key(), o.hooks.now()); t != "" {
			return t, nil
		}
	}
	refreshMu.Lock()
	defer refreshMu.Unlock()
	if !force {
		if t := tokens.get(o.key(), o.hooks.now()); t != "" {
			return t, nil // another job refreshed meanwhile
		}
	}
	old := o.key()
	form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {o.secrets["refreshToken"]},
		"client_id": {o.clientID}, "client_secret": {o.secrets["clientSecret"]}}
	if o.kind == "onedrive" {
		form.Set("scope", scopes[o.kind])
	}
	a, err := tokenPost(ctx, o.c, o.kind, o.tenant, form)
	if err != nil {
		return "", err
	}
	if a.RefreshToken != "" && a.RefreshToken != o.secrets["refreshToken"] {
		// Rotated: saved first, then used (amendment 20).
		o.secrets["refreshToken"] = a.RefreshToken
		if o.hooks.Save != nil {
			if err := o.hooks.Save(o.secrets, o.hooks.Ref); err != nil {
				return "", errf(CodeOther, "saving the new sign-in: %v", err)
			}
		}
		tokens.drop(old)
	}
	tokens.put(o.key(), a.AccessToken, expiry(o.hooks.now(), a.ExpiresIn))
	return a.AccessToken, nil
}

// apiReq is one request to the provider's API. body is resent as is when
// a 401 asks for a fresh token.
type apiReq struct {
	method, url string
	body        []byte
	hdr         map[string]string
	noAuth      bool // an upload session or a download URL (amendment 12)
}

// do sends r with the access token; on 401 it refreshes once and resends.
func (o *oauthClient) do(ctx context.Context, r apiReq) (*http.Response, error) {
	for attempt := 0; ; attempt++ {
		var tok string
		if !r.noAuth {
			var err error
			if tok, err = o.token(ctx, attempt > 0); err != nil {
				return nil, err
			}
		}
		var rd io.Reader
		if r.body != nil {
			rd = bytes.NewReader(r.body)
		}
		req, err := http.NewRequestWithContext(ctx, r.method, r.url, rd)
		if err != nil {
			return nil, errf(CodeOther, "request: %v", err)
		}
		if r.body != nil {
			req.ContentLength = int64(len(r.body))
		}
		req.Header.Set("User-Agent", "topo-server")
		for k, v := range r.hdr {
			req.Header.Set(k, v)
		}
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		resp, err := o.c.Do(req)
		if err != nil {
			return nil, netErr(err)
		}
		if resp.StatusCode == 401 && !r.noAuth && attempt == 0 {
			drain(resp)
			tokens.drop(o.key())
			continue
		}
		return resp, nil
	}
}

// getJSON sends r and decodes a 2xx JSON answer into v.
func (o *oauthClient) json(ctx context.Context, r apiReq, v any) error {
	resp, err := o.do(ctx, r)
	if err != nil {
		return err
	}
	defer drain(resp)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return statusErr(resp.StatusCode)
	}
	if v == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(v); err != nil {
		return errf(CodeBadAnswer, "answer: %v", err)
	}
	return nil
}

// sameOrigin reports whether raw is on the origin of base (a next-page
// link must not take the token elsewhere).
func sameOrigin(raw, base string) bool {
	u, err1 := url.Parse(raw)
	b, err2 := url.Parse(base)
	return err1 == nil && err2 == nil && u.Scheme == b.Scheme && strings.EqualFold(u.Host, b.Host)
}

// plainURL reports whether raw may be fetched without the token: https,
// or http on this machine (the tests' fakes).
func plainURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	_, err = davBase(u.Scheme + "://" + u.Host + "/")
	return err == nil
}

// RefJSON is what oauth_ref holds: the Drive folder id and the account the
// provider named at Connect (shown as "Connected as …", nothing else).
type RefJSON struct {
	Folder  string `json:"folder,omitempty"`
	Account string `json:"account,omitempty"`
}

// ParseRef reads oauth_ref.
func ParseRef(s string) RefJSON {
	var r RefJSON
	json.Unmarshal([]byte(s), &r)
	return r
}

func (r RefJSON) String() string {
	if r == (RefJSON{}) {
		return ""
	}
	b, _ := json.Marshal(r)
	return string(b)
}

// Connected is a destination that signs in with OAuth: its ref after use
// (a folder made) and the account it reaches.
type Connected interface {
	Dest
	Ref() string
	Account(ctx context.Context) string
}
