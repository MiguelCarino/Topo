package api

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/hub"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/notify"
	"carino.systems/topo/server/internal/store"
)

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *fakeClock) Add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

// aenv is a server with a store, the file mail sink, an injected clock and
// the mail worker driven by hand.
type aenv struct {
	t      *testing.T
	srv    *Server
	cfg    *config.Config
	st     *store.Store
	clk    *fakeClock
	worker *notify.Worker
	hub    *hub.Hub
	origin string
	host   string

	mu     sync.Mutex
	closed []string
}

func newAuthEnv(t *testing.T, extra ...string) *aenv {
	t.Helper()
	dir := t.TempDir()
	r, err := config.Load(config.Options{Environ: append([]string{"TOPO_DATA=" + dir, "TOPO_MAIL=file"}, extra...)})
	if err != nil {
		t.Fatal(err)
	}
	clk := &fakeClock{t: time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)}
	st, err := store.Open(dir, clk.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	app, err := LoadApp(testFS())
	if err != nil {
		t.Fatal(err)
	}
	m, err := mail.New(r.Config, nil, mail.Options{Now: clk.Now})
	if err != nil {
		t.Fatal(err)
	}
	e := &aenv{t: t, cfg: r.Config, st: st, clk: clk, origin: r.Config.Origin(), host: r.Config.PublicURL.Host, hub: hub.New()}
	e.worker = notify.New(st, m, nil, clk.Now, r.Config.Origin()+"/", 1000)
	e.worker.Online = e.hub.Online
	e.srv = New(Deps{Cfg: r.Config, Store: st, App: app, Version: "0.0.1", Now: clk.Now, Key: []byte("k0123456789abcdef0123456789abcde"), Hub: e.hub,
		Wake: func() {}, CloseSessions: func(ids []string) {
			e.mu.Lock()
			e.closed = append(e.closed, ids...)
			e.mu.Unlock()
			e.hub.CloseSessions(ids)
		}})
	return e
}

// browser keeps cookies and an address, like one browser on one network.
type browser struct {
	e       *aenv
	ip      string
	ua      string
	cookies map[string]*http.Cookie
}

func (e *aenv) browser(ip string) *browser {
	return &browser{e: e, ip: ip, ua: "Test/1.0", cookies: map[string]*http.Cookie{}}
}

type resp struct {
	*httptest.ResponseRecorder
	t *testing.T
}

func (r resp) json() map[string]any {
	r.t.Helper()
	var m map[string]any
	if err := json.Unmarshal(r.Body.Bytes(), &m); err != nil {
		r.t.Fatalf("not JSON (%d): %q", r.Code, r.Body.String())
	}
	return m
}

func (r resp) cookie(name string) *http.Cookie {
	for _, c := range r.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func (b *browser) do(method, path string, body any, hdr ...string) resp {
	b.e.t.Helper()
	var rd io.Reader
	if body != nil {
		s, ok := body.(string)
		if !ok {
			j, _ := json.Marshal(body)
			s = string(j)
		}
		rd = strings.NewReader(s)
	}
	req := httptest.NewRequest(method, b.e.origin+path, rd)
	req.RemoteAddr = b.ip + ":40000"
	req.Header.Set("User-Agent", b.ua)
	if method != "GET" {
		req.Header.Set("X-Topo", "1")
		req.Header.Set("Origin", b.e.origin)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		if hdr[i+1] == "" {
			req.Header.Del(hdr[i])
		} else {
			req.Header.Set(hdr[i], hdr[i+1])
		}
	}
	for _, c := range b.cookies {
		req.AddCookie(&http.Cookie{Name: c.Name, Value: c.Value})
	}
	w := httptest.NewRecorder()
	b.e.srv.ServeHTTP(w, req)
	for _, c := range w.Result().Cookies() {
		if c.MaxAge < 0 || c.Value == "" {
			delete(b.cookies, c.Name)
		} else {
			b.cookies[c.Name] = c
		}
	}
	return resp{w, b.e.t}
}

func (b *browser) post(path string, body any) resp { b.e.t.Helper(); return b.do("POST", path, body) }
func (b *browser) get(path string) resp            { b.e.t.Helper(); return b.do("GET", path, nil) }

// mails drains the outbox and returns the file sink's lines.
func (e *aenv) mails() []mail.SinkLine {
	e.t.Helper()
	if _, err := e.worker.Drain(context.Background()); err != nil {
		e.t.Fatal(err)
	}
	f, err := os.Open(filepath.Join(e.cfg.MailDir, "outbox.jsonl"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		e.t.Fatal(err)
	}
	defer f.Close()
	var out []mail.SinkLine
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var l mail.SinkLine
		json.Unmarshal(sc.Bytes(), &l)
		out = append(out, l)
	}
	return out
}

// lastMail is the newest message of kind to addr.
func (e *aenv) lastMail(to, kind string) *mail.SinkLine {
	e.t.Helper()
	ms := e.mails()
	for i := len(ms) - 1; i >= 0; i-- {
		if ms[i].To == to && ms[i].Kind == kind {
			return &ms[i]
		}
	}
	return nil
}

func (e *aenv) countMail(to string) int {
	n := 0
	for _, m := range e.mails() {
		if m.To == to {
			n++
		}
	}
	return n
}

// requestCode asks for a code and returns the challenge id.
func (b *browser) requestCode(email string, extra ...map[string]any) string {
	b.e.t.Helper()
	body := map[string]any{"email": email, "lang": "en"}
	for _, x := range extra {
		for k, v := range x {
			body[k] = v
		}
	}
	r := b.post("/api/auth/request", body)
	if r.Code != http.StatusAccepted {
		b.e.t.Fatalf("request: %d %s", r.Code, r.Body.String())
	}
	id, _ := r.json()["challenge"].(string)
	return id
}

// signIn runs the whole code flow and returns the user id.
func (b *browser) signIn(email string) string {
	b.e.t.Helper()
	cid := b.requestCode(email)
	m := b.e.lastMail(email, "signin")
	if m == nil {
		b.e.t.Fatalf("no sign-in mail for %s", email)
	}
	r := b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": m.Code})
	if r.Code != 200 {
		b.e.t.Fatalf("verify %s: %d %s", email, r.Code, r.Body.String())
	}
	u := r.json()["user"].(map[string]any)
	return u["id"].(string)
}

func (e *aenv) addUser(email, role string) string {
	e.t.Helper()
	id := store.NewID("u_")
	if err := store.CreateUser(context.Background(), e.st.W, &store.User{ID: id, Email: email, EmailNorm: email, Lang: "en", ServerRole: role, Created: 1}); err != nil {
		e.t.Fatal(err)
	}
	return id
}

const ownerEmail = "owner@example.test"

func TestSignInByCode(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	b := e.browser("192.0.2.1")
	r := b.post("/api/auth/request", map[string]any{"email": "  Owner@Example.TEST ", "lang": "es"})
	if r.Code != 202 {
		t.Fatalf("%d %s", r.Code, r.Body.String())
	}
	cid, _ := r.json()["challenge"].(string)
	c := r.cookie("topo_c")
	if c == nil || !c.HttpOnly || c.Secure || c.SameSite != http.SameSiteLaxMode || c.Path != "/" || c.MaxAge != 15*60 {
		t.Fatalf("challenge cookie %+v", c)
	}
	m := e.lastMail(ownerEmail, "signin")
	if m == nil || len(m.Code) != 6 || m.Lang != "es" || !strings.HasPrefix(m.Link, e.origin+"/#signin=") || !strings.Contains(m.Subject, m.Code) {
		t.Fatalf("mail %+v", m)
	}
	// The code is not in the database, and the outbox row was blanked once sent.
	var data string
	e.st.R.QueryRow("SELECT data FROM outbox WHERE kind = 'signin'").Scan(&data)
	if data != "{}" {
		t.Fatalf("outbox data kept: %s", data)
	}
	var mac []byte
	e.st.R.QueryRow("SELECT code_mac FROM challenges WHERE id = ?", cid).Scan(&mac)
	if len(mac) != 32 || strings.Contains(string(mac), m.Code) {
		t.Fatal("code stored")
	}
	if r := b.get("/api/me"); r.Code != 401 {
		t.Fatalf("me before sign-in: %d", r.Code)
	}
	r = b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": m.Code[:3] + " " + m.Code[3:]})
	if r.Code != 200 {
		t.Fatalf("verify %d %s", r.Code, r.Body.String())
	}
	u := r.json()["user"].(map[string]any)
	if u["email"] != ownerEmail || u["serverRole"] != "owner" || u["canCreate"] != true || u["lang"] != "es" || u["keys"] != nil || u["device"] != nil {
		t.Fatalf("user %v", u)
	}
	sc := r.cookie("topo_s")
	if sc == nil || !sc.HttpOnly || sc.SameSite != http.SameSiteLaxMode || sc.MaxAge != int(e.cfg.SessionMax/time.Second) {
		t.Fatalf("session cookie %+v", sc)
	}
	if cc := r.cookie("topo_c"); cc == nil || cc.MaxAge >= 0 {
		t.Fatalf("challenge cookie not cleared: %+v", cc)
	}
	if b.cookies["topo_c"] != nil {
		t.Fatal("jar kept the challenge cookie")
	}
	r = b.get("/api/me")
	if r.Code != 200 || r.json()["email"] != ownerEmail {
		t.Fatalf("me %d %s", r.Code, r.Body.String())
	}
	n := r.json()["notify"].(map[string]any)
	if n["revision"] != true || n["revisionShared"] != false || n["visit"] != true || len(n) != len(NotifyKeys) {
		t.Fatalf("notify defaults %v", n)
	}
	// The session cookie is stored as a hash only.
	var cnt int
	e.st.R.QueryRow("SELECT count(*) FROM sessions WHERE id_hash = ?", auth.Hash(sc.Value)).Scan(&cnt)
	if cnt != 1 {
		t.Fatal("session not stored by hash")
	}
	e.st.R.QueryRow("SELECT count(*) FROM sessions WHERE id = ? OR CAST(id_hash AS TEXT) = ?", sc.Value, sc.Value).Scan(&cnt)
	if cnt != 0 {
		t.Fatal("cookie value stored in clear")
	}
	// The code is single use.
	b2 := e.browser("192.0.2.2")
	if r := b2.post("/api/auth/verify", map[string]any{"challenge": cid, "code": m.Code}); r.Code != 400 || r.json()["error"] != ErrBadCode {
		t.Fatalf("reuse: %d %s", r.Code, r.Body.String())
	}
}

// D55, B3: an address that may not sign in gets the same answer, byte for
// byte apart from the id, and no mail.
func TestDecoyIndistinguishable(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	e.addUser("member@example.test", "member")
	off := e.addUser("off@example.test", "staff")
	e.st.W.Exec("UPDATE users SET disabled = 1 WHERE id = ?", off)
	shape := func(email string) (int, string, string) {
		b := e.browser("198.51.100.7")
		r := b.post("/api/auth/request", map[string]any{"email": email, "lang": "en"})
		id, _ := r.json()["challenge"].(string)
		body := strings.Replace(r.Body.String(), id, "ID", 1)
		c := r.cookie("topo_c")
		ck := ""
		if c != nil {
			ck = strings.Replace(c.String(), c.Value, "V", 1)
		}
		hdr := r.Header().Clone()
		hdr.Del("Set-Cookie")
		hj, _ := json.Marshal(hdr)
		if len(id) != len(store.NewID("c_")) {
			t.Fatalf("id %q", id)
		}
		return r.Code, body + "|" + ck, string(hj)
	}
	rc, rb, rh := shape("member@example.test")
	for _, decoy := range []string{"stranger@example.test", "off@example.test"} {
		dc, db, dh := shape(decoy)
		if dc != rc || db != rb || dh != rh {
			t.Fatalf("%s differs:\n%d %s %s\n%d %s %s", decoy, rc, rb, rh, dc, db, dh)
		}
		if e.countMail(decoy) != 0 {
			t.Fatalf("mail sent to %s", decoy)
		}
	}
	if e.lastMail("member@example.test", "signin") == nil {
		t.Fatal("real address got no mail")
	}
	// Decoy rows exist (same work) and are never sent.
	var decoys int
	e.st.R.QueryRow("SELECT count(*) FROM outbox WHERE kind = 'none' AND sent = -2").Scan(&decoys)
	if decoys != 2 {
		t.Fatalf("decoy outbox rows %d", decoys)
	}
	// A decoy never verifies, whatever the code.
	b := e.browser("198.51.100.8")
	cid := b.requestCode("stranger@example.test")
	var mac []byte
	e.st.R.QueryRow("SELECT code_mac FROM challenges WHERE id = ?", cid).Scan(&mac)
	for _, code := range []string{"000000", "123456", "999999"} {
		if r := b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": code}); r.Code != 400 || r.json()["error"] != ErrBadCode {
			t.Fatalf("decoy verify %d", r.Code)
		}
	}
	// A malformed email is the only other answer, and it says nothing about anyone.
	if r := b.post("/api/auth/request", map[string]any{"email": "not an email"}); r.Code != 400 || r.json()["error"] != ErrBadEmail {
		t.Fatalf("bad email %d", r.Code)
	}
	// Unknown challenge ids behave like decoys.
	if r := b.post("/api/auth/verify", map[string]any{"challenge": "c_nope", "code": "123456"}); r.Code != 400 || r.json()["error"] != ErrBadCode {
		t.Fatalf("unknown id %d", r.Code)
	}
}

func TestCodeExpiresTriesAndSupersede(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	b := e.browser("192.0.2.10")
	bad := func(cid, code string) {
		t.Helper()
		if r := b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": code}); r.Code != 400 || r.json()["error"] != ErrBadCode {
			t.Fatalf("want bad-code, got %d %s", r.Code, r.Body.String())
		}
	}
	wrong := func(code string) string {
		if code == "000000" {
			return "000001"
		}
		return "000000"
	}
	// Expiry: 10 minutes.
	cid := b.requestCode(ownerEmail)
	code := e.lastMail(ownerEmail, "signin").Code
	e.clk.Add(10*time.Minute + time.Second)
	bad(cid, code)

	// Five tries per code: the right code on the sixth try fails.
	cid = b.requestCode(ownerEmail)
	code = e.lastMail(ownerEmail, "signin").Code
	for i := 0; i < 5; i++ {
		bad(cid, wrong(code))
	}
	bad(cid, code)

	// A newer request supersedes the older code.
	e.clk.Add(16 * time.Minute)
	old := b.requestCode(ownerEmail)
	oldCode := e.lastMail(ownerEmail, "signin").Code
	cid = b.requestCode(ownerEmail)
	code = e.lastMail(ownerEmail, "signin").Code
	bad(old, oldCode)
	if r := b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": code}); r.Code != 200 {
		t.Fatalf("newest code: %d %s", r.Code, r.Body.String())
	}
	// Malformed codes count as tries and fail the same way.
	b2 := e.browser("192.0.2.11")
	cid = b2.requestCode(ownerEmail)
	for _, c := range []string{"", "abc", "1234567", "12345"} {
		if r := b2.post("/api/auth/verify", map[string]any{"challenge": cid, "code": c}); r.Code != 400 {
			t.Fatalf("code %q: %d", c, r.Code)
		}
	}
}

func TestPerEmailRateLimit(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	for _, email := range []string{ownerEmail, "stranger@example.test"} {
		for i := 0; i < perEmail15; i++ {
			// A fresh browser and address each time: only the per-email limit applies.
			e.browser("203.0.113." + itoa(i+1)).requestCode(email)
		}
		r := e.browser("203.0.113.99").post("/api/auth/request", map[string]any{"email": email})
		if r.Code != 429 || r.json()["error"] != ErrRateLimited || r.Header().Get("Retry-After") == "" {
			t.Fatalf("%s: %d %v", email, r.Code, r.Header())
		}
		ra, _ := r.json()["retryAfter"].(float64)
		if ra < 14*60 || ra > 15*60 {
			t.Fatalf("retryAfter %v", ra)
		}
	}
	e.clk.Add(15*time.Minute + time.Second)
	e.browser("203.0.113.50").requestCode(ownerEmail)
	// The daily limit: 20 per 24 h.
	for i := 0; i < 3; i++ {
		e.clk.Add(16 * time.Minute)
		for j := 0; j < perEmail15; j++ {
			r := e.browser("203.0.113.60").post("/api/auth/request", map[string]any{"email": ownerEmail})
			if r.Code == 429 {
				if i == 2 && j >= 4 {
					return
				}
				t.Fatalf("limited early: round %d, %d", i, j)
			}
		}
	}
	t.Fatal("daily limit never reached")
}

// B2: a flood from elsewhere cannot lock out the browser that already holds
// a recent challenge for the address.
func TestOwnBrowserKeepsItsAllowance(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	me := e.browser("192.0.2.30")
	me.requestCode(ownerEmail)
	for i := 0; i < perEmail15; i++ {
		e.browser("203.0.113.7").post("/api/auth/request", map[string]any{"email": ownerEmail})
	}
	if r := e.browser("203.0.113.8").post("/api/auth/request", map[string]any{"email": ownerEmail}); r.Code != 429 {
		t.Fatalf("flood not limited: %d", r.Code)
	}
	cid := me.requestCode(ownerEmail)
	code := e.lastMail(ownerEmail, "signin").Code
	if r := me.post("/api/auth/verify", map[string]any{"challenge": cid, "code": code}); r.Code != 200 {
		t.Fatalf("own new code: %d %s", r.Code, r.Body.String())
	}
}

func TestPerIPRequestLimit(t *testing.T) {
	e := newAuthEnv(t)
	b := e.browser("192.0.2.40")
	for i := 0; i < ipCodesPerHour; i++ {
		b.requestCode("p" + itoa(i) + "@example.test")
	}
	if r := b.post("/api/auth/request", map[string]any{"email": "last@example.test"}); r.Code != 429 {
		t.Fatalf("21st request: %d", r.Code)
	}
	// IPv6 callers share a /64.
	b6 := e.browser("[2001:db8::1]")
	for i := 0; i < ipCodesPerHour; i++ {
		e.browser("[2001:db8::" + itoa(i+2) + "]").requestCode("q" + itoa(i) + "@example.test")
	}
	if r := b6.post("/api/auth/request", map[string]any{"email": "v6@example.test"}); r.Code != 429 {
		t.Fatalf("same /64 not limited: %d", r.Code)
	}
	if r := e.browser("[2001:db8:0:1::1]").post("/api/auth/request", map[string]any{"email": "v6@example.test"}); r.Code != 202 {
		t.Fatalf("other /64 limited: %d", r.Code)
	}
}

func TestPerIPFailureLimit(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	b := e.browser("192.0.2.50")
	for i := 0; i < ipFailsPerHour; i++ {
		b.post("/api/auth/verify", map[string]any{"challenge": "c_x" + itoa(i), "code": "123456"})
	}
	if r := b.post("/api/auth/verify", map[string]any{"challenge": "c_y", "code": "123456"}); r.Code != 429 || r.Header().Get("Retry-After") == "" {
		t.Fatalf("31st failure: %d", r.Code)
	}
	if r := b.post("/api/auth/link", map[string]any{"token": auth.NewToken()}); r.Code != 429 {
		t.Fatalf("links share the budget: %d", r.Code)
	}
	// A right code does not spend the budget: from a fresh address, 30
	// failures plus successes in between are all answered.
	b2 := e.browser("192.0.2.51")
	for i := 0; i < 3; i++ {
		e.clk.Add(16 * time.Minute)
		b2.signIn(ownerEmail)
	}
	for i := 0; i < ipFailsPerHour-3; i++ {
		if r := b2.post("/api/auth/verify", map[string]any{"challenge": "c_z", "code": "123456"}); r.Code != 400 {
			t.Fatalf("failure %d answered %d", i, r.Code)
		}
	}
}

// B1: 10 failed codes in 24 h stop code sign-in for the address; the magic
// link still works.
func TestDailyFailureBudget(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	for round := 0; round < 2; round++ {
		b := e.browser("198.51.100." + itoa(round+1))
		cid := b.requestCode(ownerEmail)
		code := e.lastMail(ownerEmail, "signin").Code
		w := "000000"
		if code == w {
			w = "000001"
		}
		for i := 0; i < 5; i++ {
			b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": w})
		}
	}
	b := e.browser("198.51.100.9")
	cid := b.requestCode(ownerEmail)
	m := e.lastMail(ownerEmail, "signin")
	if r := b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": m.Code}); r.Code != 400 {
		t.Fatalf("right code after 10 failures: %d", r.Code)
	}
	// The link of a new request still signs in.
	cid = b.requestCode(ownerEmail)
	m = e.lastMail(ownerEmail, "signin")
	tok := strings.TrimPrefix(m.Link, e.origin+"/#signin=")
	if r := b.post("/api/auth/link", map[string]any{"token": tok}); r.Code != 200 {
		t.Fatalf("link after code lockout: %d %s", r.Code, r.Body.String())
	}
	// A day later codes work again.
	e.clk.Add(24*time.Hour + time.Minute)
	e.browser("198.51.100.10").signIn(ownerEmail)
}

func TestMagicLinkBoundToBrowser(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	a := e.browser("192.0.2.60")
	a.requestCode(ownerEmail)
	m := e.lastMail(ownerEmail, "signin")
	tok := strings.TrimPrefix(m.Link, e.origin+"/#signin=")
	if !auth.ValidToken(tok) {
		t.Fatalf("link %q", m.Link)
	}
	// Another browser (a mail scanner, a forwarded email) cannot use it,
	// and trying does not consume it.
	other := e.browser("192.0.2.61")
	if r := other.post("/api/auth/link", map[string]any{"token": tok}); r.Code != 409 || r.json()["error"] != ErrOtherBrowser {
		t.Fatalf("other browser: %d %s", r.Code, r.Body.String())
	}
	// A GET of the link page consumes nothing either (the token is in the
	// fragment, so the server never sees it): the app is served as usual.
	if r := other.get("/"); r.Code != 200 {
		t.Fatalf("/ %d", r.Code)
	}
	r := a.post("/api/auth/link", map[string]any{"token": tok})
	if r.Code != 200 || r.json()["user"].(map[string]any)["email"] != ownerEmail || r.cookie("topo_s") == nil {
		t.Fatalf("own browser: %d %s", r.Code, r.Body.String())
	}
	// Single use.
	a2 := e.browser("192.0.2.60")
	a2.cookies = map[string]*http.Cookie{"topo_c": {Name: "topo_c", Value: "x"}}
	if r := a.post("/api/auth/link", map[string]any{"token": tok}); r.Code != 400 || r.json()["error"] != ErrBadLink {
		t.Fatalf("reuse: %d %s", r.Code, r.Body.String())
	}
	for _, bad := range []string{"", "short", auth.NewToken()} {
		if r := a.post("/api/auth/link", map[string]any{"token": bad}); r.Code != 400 {
			t.Fatalf("token %q: %d", bad, r.Code)
		}
	}
	// Expired links fail.
	b := e.browser("192.0.2.62")
	b.requestCode(ownerEmail)
	tok = strings.TrimPrefix(e.lastMail(ownerEmail, "signin").Link, e.origin+"/#signin=")
	e.clk.Add(11 * time.Minute)
	if r := b.post("/api/auth/link", map[string]any{"token": tok}); r.Code != 400 {
		t.Fatalf("expired link: %d", r.Code)
	}
}

func TestSetupToken(t *testing.T) {
	e := newAuthEnv(t)
	tok, err := auth.MintSetupToken(context.Background(), e.st)
	if err != nil {
		t.Fatal(err)
	}
	b := e.browser("192.0.2.70")
	if r := b.get("/api/health"); r.json()["setup"] != true || r.json()["signedIn"] != false {
		t.Fatal("health setup false, or signed in without a session")
	}
	// Without the token, or with a wrong one, the address gets nothing.
	b.requestCode("first@example.test")
	b.requestCode("first@example.test", map[string]any{"setupToken": strings.Repeat("a", 26)})
	if e.countMail("first@example.test") != 0 {
		t.Fatal("mail without a valid token")
	}
	e.clk.Add(16 * time.Minute)
	cid := b.requestCode("first@example.test", map[string]any{"setupToken": strings.ToUpper(tok)})
	m := e.lastMail("first@example.test", "signin")
	if m == nil {
		t.Fatal("no mail with the token")
	}
	r := b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": m.Code})
	if r.Code != 200 || r.json()["user"].(map[string]any)["serverRole"] != "owner" {
		t.Fatalf("%d %s", r.Code, r.Body.String())
	}
	if r := b.get("/api/health"); r.json()["setup"] != false {
		t.Fatal("setup still on")
	}
	if _, err := e.st.MetaGet(context.Background(), auth.MetaSetupToken); err != store.ErrNotFound {
		t.Fatal("token not burnt")
	}
	if v, _ := e.st.MetaGet(context.Background(), "owner_exists"); v != "1" {
		t.Fatal("owner_exists not set")
	}
	// The same token cannot make a second owner.
	c := e.browser("192.0.2.71")
	c.requestCode("second@example.test", map[string]any{"setupToken": tok})
	if e.countMail("second@example.test") != 0 {
		t.Fatal("burnt token still works")
	}
}

// A token presented while two people race: only the first sign-in becomes
// owner; the second challenge (made while there was no owner) fails.
func TestSetupTokenRace(t *testing.T) {
	e := newAuthEnv(t)
	tok, _ := auth.MintSetupToken(context.Background(), e.st)
	a, b := e.browser("192.0.2.72"), e.browser("192.0.2.73")
	ca := a.requestCode("a@example.test", map[string]any{"setupToken": tok})
	cb := b.requestCode("b@example.test", map[string]any{"setupToken": tok})
	ma, mb := e.lastMail("a@example.test", "signin"), e.lastMail("b@example.test", "signin")
	if r := a.post("/api/auth/verify", map[string]any{"challenge": ca, "code": ma.Code}); r.Code != 200 {
		t.Fatal(r.Code)
	}
	if r := b.post("/api/auth/verify", map[string]any{"challenge": cb, "code": mb.Code}); r.Code != 400 {
		t.Fatalf("second setup sign-in: %d", r.Code)
	}
	if n, _ := store.CountOwners(context.Background(), e.st.R); n != 1 {
		t.Fatalf("%d owners", n)
	}
}

func TestOwnerEmailPromotesExistingUser(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	id := e.addUser(ownerEmail, "member")
	b := e.browser("192.0.2.80")
	if got := b.signIn(ownerEmail); got != id {
		t.Fatalf("new user %s, want %s", got, id)
	}
	if r := b.get("/api/me"); r.json()["serverRole"] != "owner" {
		t.Fatal("not promoted")
	}
	// Store-level ensure (run at every start) promotes and never demotes.
	id2 := e.addUser("boss@example.test", "staff")
	if p, err := e.st.EnsureOwnerEmail(context.Background(), "boss@example.test"); err != nil || !p {
		t.Fatal(p, err)
	}
	if p, _ := e.st.EnsureOwnerEmail(context.Background(), "boss@example.test"); p {
		t.Fatal("promoted twice")
	}
	u, _ := store.UserByID(context.Background(), e.st.R, id2)
	if u.ServerRole != "owner" {
		t.Fatal(u.ServerRole)
	}
	if p, _ := e.st.EnsureOwnerEmail(context.Background(), "nobody@example.test"); p {
		t.Fatal("created a user")
	}
}

func TestInviteeMaySignIn(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	owner := e.browser("192.0.2.90")
	oid := owner.signIn(ownerEmail)
	ms := e.clk.Now().UnixMilli()
	e.st.W.Exec("INSERT INTO sites(id, created, created_by, head_h, updated) VALUES('s_1', ?, ?, 'h0', ?)", ms, oid, ms)
	e.st.W.Exec("INSERT INTO invites(id, site_id, email_norm, role, lang, token_hash, status, invited_by, created, expires) VALUES('i_1','s_1','guest@example.test','provider','ja',x'00','pending',?,?,?)",
		oid, ms, ms+14*24*3600*1000)
	g := e.browser("192.0.2.91")
	cid := g.requestCode("guest@example.test", map[string]any{"invite": "i_1"})
	m := e.lastMail("guest@example.test", "signin")
	if m == nil {
		t.Fatal("invitee got no code")
	}
	r := g.post("/api/auth/verify", map[string]any{"challenge": cid, "code": m.Code})
	u := r.json()["user"].(map[string]any)
	if r.Code != 200 || u["serverRole"] != "member" || u["canCreate"] != false {
		t.Fatalf("%d %v", r.Code, u)
	}
	// An expired invite no longer lets an address in.
	e.st.W.Exec("INSERT INTO invites(id, site_id, email_norm, role, lang, token_hash, status, invited_by, created, expires) VALUES('i_2','s_1','late@example.test','viewer','en',x'01','pending',?,?,?)",
		oid, ms, ms+1000)
	e.clk.Add(time.Minute)
	e.browser("192.0.2.92").requestCode("late@example.test")
	if e.countMail("late@example.test") != 0 {
		t.Fatal("expired invite still eligible")
	}
}

func TestSessionsListRevokeSignOut(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	a, b := e.browser("192.0.2.100"), e.browser("192.0.2.101")
	b.ua = "Other/2.0"
	a.signIn(ownerEmail)
	e.clk.Add(16 * time.Minute)
	b.signIn(ownerEmail)
	r := a.get("/api/me/sessions")
	list := r.json()["sessions"].([]any)
	if len(list) != 2 {
		t.Fatalf("%d sessions", len(list))
	}
	var mine, theirs string
	for _, x := range list {
		s := x.(map[string]any)
		if s["current"] == true {
			mine = s["id"].(string)
			if s["ip"] != "192.0.2.100" || s["ua"] != "Test/1.0" {
				t.Fatalf("session %v", s)
			}
		} else {
			theirs = s["id"].(string)
		}
	}
	if mine == "" || theirs == "" {
		t.Fatal(list)
	}
	// Another user's session id is not mine to end.
	c := e.browser("192.0.2.102")
	e.addUser("c@example.test", "member")
	c.signIn("c@example.test")
	if r := c.get("/api/health"); r.json()["signedIn"] != true {
		t.Fatal("health: signedIn false with a session")
	}
	if r := c.do("DELETE", "/api/me/sessions/"+theirs, nil); r.Code != 404 {
		t.Fatalf("foreign revoke: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/me/sessions/"+theirs, nil); r.Code != 204 {
		t.Fatalf("revoke: %d", r.Code)
	}
	if r := b.get("/api/me"); r.Code != 401 {
		t.Fatalf("revoked session still works: %d", r.Code)
	}
	if !e.wasClosed(theirs) {
		t.Fatal("streams of the revoked session not closed")
	}
	// Revoke others.
	e.clk.Add(16 * time.Minute)
	b.signIn(ownerEmail)
	if r := a.post("/api/me/sessions/revoke-others", nil); r.Code != 204 {
		t.Fatal(r.Code)
	}
	if b.get("/api/me").Code != 401 || a.get("/api/me").Code != 200 {
		t.Fatal("revoke-others")
	}
	// Sign out.
	r = a.post("/api/auth/signout", nil)
	if r.Code != 204 || r.cookie("topo_s") == nil || r.cookie("topo_s").MaxAge >= 0 {
		t.Fatalf("signout %d %v", r.Code, r.cookie("topo_s"))
	}
	if !e.wasClosed(mine) {
		t.Fatal("signout did not close streams")
	}
	a.cookies["topo_s"] = &http.Cookie{Name: "topo_s", Value: "replayed"}
	if a.get("/api/me").Code != 401 {
		t.Fatal("after signout")
	}
}

func (e *aenv) wasClosed(id string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, c := range e.closed {
		if c == id {
			return true
		}
	}
	return false
}

func TestSessionLimits(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail, "TOPO_SESSION_IDLE=48h", "TOPO_SESSION_MAX=120h")
	a := e.browser("192.0.2.110")
	a.signIn(ownerEmail)
	lastSeen := func() int64 {
		var v int64
		e.st.R.QueryRow("SELECT max(last_seen) FROM sessions").Scan(&v)
		return v
	}
	t0 := lastSeen()
	// Touched at most hourly.
	e.clk.Add(30 * time.Minute)
	a.get("/api/me")
	if lastSeen() != t0 {
		t.Fatal("touched within the hour")
	}
	e.clk.Add(31 * time.Minute)
	a.get("/api/me")
	if lastSeen() == t0 {
		t.Fatal("not touched after an hour")
	}
	// Sliding idle limit: use it every 40 h, it keeps working ...
	for i := 0; i < 2; i++ {
		e.clk.Add(40 * time.Hour)
		if a.get("/api/me").Code != 200 {
			t.Fatalf("idle %d", i)
		}
	}
	// ... until the absolute limit (120 h from sign-in).
	e.clk.Add(40 * time.Hour)
	if a.get("/api/me").Code != 401 {
		t.Fatal("past the absolute limit")
	}
	// Idle limit alone.
	b := e.browser("192.0.2.111")
	b.signIn(ownerEmail)
	e.clk.Add(48 * time.Hour)
	if b.get("/api/me").Code != 401 {
		t.Fatal("past the idle limit")
	}
	// Housekeeping deletes both and reports them.
	ids, err := e.st.Housekeep(context.Background(), e.clk.Now().UnixMilli(), store.HousekeepLimits{SessionIdleMs: e.cfg.SessionIdle.Milliseconds()})
	if err != nil || len(ids) != 2 {
		t.Fatalf("housekeep %v %v", ids, err)
	}
}

// B4: signing in drops the session this browser already had (another
// user's) and always issues a fresh id.
func TestSignInReplacesBrowserSession(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	e.addUser("other@example.test", "member")
	b := e.browser("192.0.2.120")
	b.signIn("other@example.test")
	first := b.cookies["topo_s"].Value
	var firstID string
	e.st.R.QueryRow("SELECT id FROM sessions WHERE id_hash = ?", auth.Hash(first)).Scan(&firstID)
	b.signIn(ownerEmail)
	if b.cookies["topo_s"].Value == first {
		t.Fatal("session id reused")
	}
	var n int
	e.st.R.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
	if n != 1 || !e.wasClosed(firstID) {
		t.Fatalf("%d sessions; old closed %v", n, e.wasClosed(firstID))
	}
	// A planted cookie value never becomes the session id (no fixation).
	c := e.browser("192.0.2.121")
	planted := auth.NewToken()
	c.cookies["topo_s"] = &http.Cookie{Name: "topo_s", Value: planted}
	e.clk.Add(16 * time.Minute)
	c.signIn(ownerEmail)
	if c.cookies["topo_s"].Value == planted {
		t.Fatal("fixation")
	}
}

func TestDeviceBinding(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	other := e.addUser("other@example.test", "member")
	b := e.browser("192.0.2.130")
	uid := b.signIn(ownerEmail)
	ms := e.clk.Now().UnixMilli()
	e.st.W.Exec("INSERT INTO devices(id, user_id, dev_pub, created, last_seen, wrap) VALUES('d_mine', ?, 'p', ?, ?, 'w')", uid, ms, ms)
	e.st.W.Exec("INSERT INTO devices(id, user_id, dev_pub, created, last_seen) VALUES('d_theirs', ?, 'p', ?, ?)", other, ms, ms)
	for dev, want := range map[string]any{"d_mine": "d_mine", "d_theirs": nil, "d_none": nil} {
		e.clk.Add(16 * time.Minute)
		cid := b.requestCode(ownerEmail)
		code := e.lastMail(ownerEmail, "signin").Code
		r := b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": code, "deviceId": dev})
		d, _ := r.json()["user"].(map[string]any)["device"].(map[string]any)
		var got any
		if d != nil {
			got = d["id"]
			if d["linked"] != true {
				t.Fatal("linked")
			}
		}
		if got != want {
			t.Fatalf("device %s: %v", dev, got)
		}
	}
}

func TestSecureCookieNames(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail, "TOPO_PUBLIC_URL=https://topo.example.com")
	b := e.browser("192.0.2.140")
	r := b.post("/api/auth/request", map[string]any{"email": ownerEmail})
	c := r.cookie("__Host-topo_c")
	if r.Code != 202 || c == nil || !c.Secure || !c.HttpOnly || c.Path != "/" || c.Domain != "" {
		t.Fatalf("%d %+v", r.Code, c)
	}
	if r.cookie("topo_c") != nil {
		t.Fatal("insecure name on https")
	}
	code := e.lastMail(ownerEmail, "signin")
	if !strings.HasPrefix(code.Link, "https://topo.example.com/#signin=") {
		t.Fatal(code.Link)
	}
	cid, _ := r.json()["challenge"].(string)
	r = b.post("/api/auth/verify", map[string]any{"challenge": cid, "code": code.Code})
	s := r.cookie("__Host-topo_s")
	if r.Code != 200 || s == nil || !s.Secure {
		t.Fatalf("%d %+v", r.Code, s)
	}
	if b.get("/api/me").Code != 200 {
		t.Fatal("me")
	}
	// The plain-http name is not accepted on an https server.
	b2 := e.browser("192.0.2.141")
	b2.cookies["topo_s"] = &http.Cookie{Name: "topo_s", Value: s.Value}
	if b2.get("/api/me").Code != 401 {
		t.Fatal("insecure cookie name accepted")
	}
	if strings.Contains(r.Header().Get("Strict-Transport-Security"), "max-age") == false {
		t.Fatal("no HSTS")
	}
}

func TestPatchMe(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	b := e.browser("192.0.2.150")
	b.signIn(ownerEmail)
	for _, body := range []string{`{"lang":"de"}`, `{"notify":{"spam":true}}`, `{"notify":{"visit":null}}`, `{"notify":{"visit":"no"}}`, `[1]`} {
		if r := b.do("PATCH", "/api/me", body); r.Code != 400 {
			t.Fatalf("%s: %d", body, r.Code)
		}
	}
	r := b.do("PATCH", "/api/me", map[string]any{"lang": "pt-BR", "notify": map[string]bool{"visit": false, "revisionShared": true}})
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	m := r.json()
	n := m["notify"].(map[string]any)
	if m["lang"] != "pt-BR" || n["visit"] != false || n["revisionShared"] != true || n["join"] != true {
		t.Fatalf("%v", m)
	}
	r = b.do("PATCH", "/api/me", map[string]any{"notify": map[string]bool{"join": false}})
	n = r.json()["notify"].(map[string]any)
	if n["visit"] != false || n["join"] != false {
		t.Fatalf("merge lost a choice: %v", n)
	}
	// A sign-in code mail follows the language the page asked in (the
	// person may not be signed in yet), not the stored one.
	e.clk.Add(16 * time.Minute)
	b.requestCode(ownerEmail)
	if m := e.lastMail(ownerEmail, "signin"); m.Lang != "en" {
		t.Fatalf("signin lang %s", m.Lang)
	}
}

func TestAdminUsers(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.browser("192.0.2.160")
	o.signIn(ownerEmail)
	if r := o.post("/api/admin/users", map[string]any{"email": "staff@example.test", "serverRole": "owner"}); r.Code != 400 {
		t.Fatalf("owner via POST: %d", r.Code)
	}
	r := o.post("/api/admin/users", map[string]any{"email": "Staff@Example.test", "serverRole": "staff", "lang": "ru"})
	if r.Code != 201 {
		t.Fatal(r.Code, r.Body.String())
	}
	sid := r.json()["user"].(map[string]any)["id"].(string)
	w := e.lastMail("staff@example.test", "welcome")
	if w == nil || w.Lang != "ru" || !strings.Contains(w.Subject, "Topo") {
		t.Fatalf("welcome %+v", w)
	}
	raw, _ := os.ReadFile(filepath.Join(e.cfg.MailDir, w.File))
	if !strings.Contains(string(raw), "owner@example.test") {
		t.Fatal("welcome does not name the inviter")
	}
	if r := o.post("/api/admin/users", map[string]any{"email": "staff@example.test", "serverRole": "member"}); r.Code != 409 {
		t.Fatalf("duplicate: %d", r.Code)
	}
	// The new staff member signs in and may create sites, but is no admin.
	s := e.browser("192.0.2.161")
	s.signIn("staff@example.test")
	if r := s.get("/api/me"); r.json()["canCreate"] != true {
		t.Fatal("staff cannot create")
	}
	if r := s.get("/api/admin/users"); r.Code != 403 {
		t.Fatalf("staff admin: %d", r.Code)
	}
	r = o.get("/api/admin/users")
	if users := r.json()["users"].([]any); len(users) != 2 {
		t.Fatalf("users %v", users)
	}
	// The last owner, and the configured owner email, cannot be demoted.
	oid := o.get("/api/me").json()["id"].(string)
	if r := o.do("PATCH", "/api/admin/users/"+oid, map[string]any{"serverRole": "staff"}); r.Code != 409 {
		t.Fatalf("demote owner email: %d", r.Code)
	}
	if r := o.do("PATCH", "/api/admin/users/"+sid, map[string]any{"serverRole": "owner"}); r.Code != 200 {
		t.Fatal(r.Code)
	}
	if r := o.do("PATCH", "/api/admin/users/"+oid, map[string]any{"disabled": true}); r.Code != 409 || r.json()["reason"] != "owner-email" {
		t.Fatalf("disable owner email: %d %s", r.Code, r.Body.String())
	}
	if r := s.do("PATCH", "/api/admin/users/"+sid, map[string]any{"serverRole": "member"}); r.Code != 200 {
		t.Fatalf("self demote with another owner: %d", r.Code)
	}
	if r := o.do("PATCH", "/api/admin/users/u_nope", map[string]any{"disabled": true}); r.Code != 404 {
		t.Fatal(r.Code)
	}
	// Disabling ends sessions and open codes, and sign-in stops.
	e.clk.Add(16 * time.Minute)
	pending := s.requestCode("staff@example.test")
	pendingCode := e.lastMail("staff@example.test", "signin").Code
	if r := o.do("PATCH", "/api/admin/users/"+sid, map[string]any{"disabled": true}); r.Code != 200 || r.json()["user"].(map[string]any)["disabled"] != true {
		t.Fatal(r.Code)
	}
	if s.get("/api/me").Code != 401 {
		t.Fatal("disabled user still signed in")
	}
	if r := s.post("/api/auth/verify", map[string]any{"challenge": pending, "code": pendingCode}); r.Code != 400 {
		t.Fatalf("open code of a disabled user: %d", r.Code)
	}
	e.clk.Add(16 * time.Minute)
	s.requestCode("staff@example.test")
	e.mails()
	var n int
	e.st.R.QueryRow("SELECT count(*) FROM outbox WHERE to_email = 'staff@example.test' AND kind = 'signin'").Scan(&n)
	if n != 2 {
		t.Fatalf("a disabled user got a new code (%d sign-in rows)", n)
	}
}

func TestLastOwnerProtected(t *testing.T) {
	e := newAuthEnv(t)
	tok, _ := auth.MintSetupToken(context.Background(), e.st)
	o := e.browser("192.0.2.170")
	cid := o.requestCode("solo@example.test", map[string]any{"setupToken": tok})
	o.post("/api/auth/verify", map[string]any{"challenge": cid, "code": e.lastMail("solo@example.test", "signin").Code})
	oid := o.get("/api/me").json()["id"].(string)
	for _, body := range []map[string]any{{"serverRole": "member"}, {"disabled": true}} {
		if r := o.do("PATCH", "/api/admin/users/"+oid, body); r.Code != 409 || r.json()["reason"] != "last-owner" {
			t.Fatalf("%v: %d %s", body, r.Code, r.Body.String())
		}
	}
}

func TestWelcomeCap(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.browser("192.0.2.180")
	o.signIn(ownerEmail)
	ms := e.clk.Now().UnixMilli()
	for i := 0; i < welcomePerDay; i++ {
		store.InsertMail(context.Background(), e.st.W, &store.Mail{ID: store.NewID("o_"), Kind: "welcome", To: "x@example.test", Lang: "en", Data: "{}", Created: ms, SendAfter: ms, Sent: ms})
	}
	if r := o.post("/api/admin/users", map[string]any{"email": "late@example.test", "serverRole": "member"}); r.Code != 429 {
		t.Fatalf("cap: %d", r.Code)
	}
}

func TestCSRFOnSignInRoutes(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	b := e.browser("192.0.2.190")
	body := map[string]any{"email": ownerEmail}
	cases := [][]string{
		{"X-Topo", ""},
		{"X-Topo", "0"},
		{"Origin", "https://evil.example"},
		{"Origin", "null"},
		{"Content-Type", "text/plain"},
		{"Content-Type", "application/x-www-form-urlencoded"},
		{"Origin", "", "Sec-Fetch-Site", "cross-site"},
		{"Origin", ""},
	}
	for _, h := range cases {
		if r := b.do("POST", "/api/auth/request", body, h...); r.Code != 403 || r.json()["error"] != ErrCSRF {
			t.Fatalf("%v: %d", h, r.Code)
		}
	}
	if e.countMail(ownerEmail) != 0 {
		t.Fatal("a refused request sent mail")
	}
	if r := b.do("POST", "/api/auth/request", body, "Origin", "", "Sec-Fetch-Site", "same-origin"); r.Code != 202 {
		t.Fatalf("same-origin without Origin: %d", r.Code)
	}
	b.signIn(ownerEmail)
	for _, p := range []struct{ m, path string }{{"POST", "/api/auth/signout"}, {"PATCH", "/api/me"}, {"POST", "/api/me/sessions/revoke-others"}, {"DELETE", "/api/me/sessions/l_x"}, {"POST", "/api/admin/users"}, {"PATCH", "/api/admin/users/u_x"}} {
		if r := b.do(p.m, p.path, map[string]any{}, "Origin", "https://evil.example"); r.Code != 403 {
			t.Fatalf("%s %s: %d", p.m, p.path, r.Code)
		}
	}
	if b.get("/api/me").Code != 200 {
		t.Fatal("a refused signout signed out")
	}
	// No CORS, ever.
	r := b.do("OPTIONS", "/api/auth/request", nil, "Origin", "https://evil.example", "Access-Control-Request-Method", "POST")
	if r.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("CORS header")
	}
}

// The route matrix: every non-public route refuses a caller with no
// session (401), and the admin routes a non-owner (403).
func TestRoutesMatrixStage2(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	e.addUser("m@example.test", "member")
	m := e.browser("192.0.2.200")
	m.signIn("m@example.test")
	anon := e.browser("192.0.2.201")
	for pattern, class := range e.srv.Routes() {
		method, path, ok := strings.Cut(pattern, " ")
		if !ok {
			continue // the /api/ catch-all
		}
		path = strings.NewReplacer("{id}", "x_1", "{site}", "s_1", "{uid}", "u_1", "{iid}", "i_1", "{n}", "1").Replace(path)
		var body any
		if method != "GET" {
			body = map[string]any{}
		}
		switch class {
		case Public:
			continue
		case Admin:
			if r := m.do(method, path, body); r.Code != 403 {
				t.Errorf("%s as member: %d", pattern, r.Code)
			}
		}
		if r := anon.do(method, path, body); r.Code != 401 || r.json()["error"] != ErrUnauthorized {
			t.Errorf("%s without a session: %d", pattern, r.Code)
		}
	}
}

func TestHousekeeping(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	b := e.browser("192.0.2.210")
	b.requestCode(ownerEmail)
	b.requestCode("stranger@example.test")
	e.mails()
	count := func(q string) int {
		var n int
		e.st.R.QueryRow(q).Scan(&n)
		return n
	}
	if count("SELECT count(*) FROM challenges") != 2 || count("SELECT count(*) FROM mail_rate") != 2 {
		t.Fatal("setup")
	}
	e.clk.Add(2 * time.Hour)
	e.st.Housekeep(context.Background(), e.clk.Now().UnixMilli(), store.HousekeepLimits{SessionIdleMs: e.cfg.SessionIdle.Milliseconds()})
	if count("SELECT count(*) FROM outbox WHERE sent = -2") != 0 {
		t.Fatal("decoy rows kept")
	}
	e.clk.Add(25 * time.Hour)
	e.st.Housekeep(context.Background(), e.clk.Now().UnixMilli(), store.HousekeepLimits{SessionIdleMs: e.cfg.SessionIdle.Milliseconds()})
	if count("SELECT count(*) FROM challenges") != 0 || count("SELECT count(*) FROM mail_rate") != 0 {
		t.Fatal("old challenges or rate rows kept")
	}
	e.clk.Add(7 * 24 * time.Hour)
	e.st.Housekeep(context.Background(), e.clk.Now().UnixMilli(), store.HousekeepLimits{SessionIdleMs: e.cfg.SessionIdle.Milliseconds()})
	if count("SELECT count(*) FROM outbox") != 0 {
		t.Fatal("sent mail kept past 7 days")
	}
}
