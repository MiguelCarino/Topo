package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"testing/fstest"

	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/store"
)

const testCSP = `default-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'none'`

const testIndex = "<!doctype html>\n<html>\n<head>\n    <!-- a comment about the Content-Security-Policy -->\n" +
	`    <meta http-equiv="Content-Security-Policy" content="` + testCSP + `">` + "\n" +
	"    <title>Topo</title>\n    <script src=\"js/app.js\"></script>\n</head>\n</html>\n"

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":    {Data: []byte(testIndex)},
		"js/app.js":     {Data: []byte("console.log(1)")},
		"css/app.css":   {Data: []byte("body{}")},
		"fonts/a.woff2": {Data: []byte("w")},
		".hidden":       {Data: []byte("secret")},
		"js/.DS_Store":  {Data: []byte("x")},
		".git/config":   {Data: []byte("x")},
		"LICENSE":       {Data: []byte("AGPL")},
	}
}

type env struct {
	t   *testing.T
	srv *Server
	cfg *config.Config
	st  *store.Store
}

func newEnv(t *testing.T, fsys fstest.MapFS, extra ...string) *env {
	t.Helper()
	dir := t.TempDir()
	r, err := config.Load(config.Options{Environ: append([]string{"TOPO_DATA=" + dir}, extra...)})
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	app, err := LoadApp(fsys)
	if err != nil {
		t.Fatal(err)
	}
	srv := New(Deps{Cfg: r.Config, Store: st, App: app, Version: "0.0.1", Build: "abc"})
	return &env{t: t, srv: srv, cfg: r.Config, st: st}
}

func (e *env) do(method, target string, body string, hdr map[string]string) *httptest.ResponseRecorder {
	e.t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, "http://127.0.0.1:7380"+target, rd)
	for k, v := range hdr {
		if k == "Host" {
			req.Host = v
			continue
		}
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.srv.ServeHTTP(w, req)
	return w
}

func jsonOf(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("not JSON (%d): %s", w.Code, w.Body.String())
	}
	return m
}

func TestHealth(t *testing.T) {
	e := newEnv(t, testFS())
	w := e.do("GET", "/api/health", "", nil)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	m := jsonOf(t, w)
	if m["ok"] != true || m["server"] != "topo" || m["api"] != float64(1) || m["secure"] != false || m["setup"] != true || m["app"] != true {
		t.Fatalf("health %v", m)
	}
	if h, _ := m["appHash"].(string); len(h) != 64 {
		t.Fatalf("appHash %v", m["appHash"])
	}
	// D7: no mail mode, no build string.
	for _, k := range []string{"mail", "build"} {
		if _, ok := m[k]; ok {
			t.Errorf("health leaks %s", k)
		}
	}
	// An owner email in config means no setup token is needed.
	e2 := newEnv(t, testFS(), "TOPO_OWNER_EMAIL=o@example.com")
	if m := jsonOf(t, e2.do("GET", "/api/health", "", nil)); m["setup"] != false {
		t.Fatal("setup with an owner email")
	}
	// Once an owner exists, setup is over.
	e.st.W.Exec("INSERT INTO users(id,email,email_norm,server_role,created) VALUES('u_1','a@x','a@x','owner',1)")
	if m := jsonOf(t, e.do("GET", "/api/health", "", nil)); m["setup"] != false {
		t.Fatal("setup with an owner")
	}
}

func TestAdminInfoNeedsSession(t *testing.T) {
	e := newEnv(t, testFS())
	w := e.do("GET", "/api/admin/info", "", nil)
	if w.Code != 401 || jsonOf(t, w)["error"] != "unauthorized" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestEveryRouteClassified(t *testing.T) {
	e := newEnv(t, testFS())
	for p, c := range e.srv.Routes() {
		if c == unclassified || c.String() == "unclassified" {
			t.Errorf("%s unclassified", p)
		}
	}
	defer func() {
		if recover() == nil {
			t.Fatal("an unclassified route must panic")
		}
	}()
	e.srv.handle("GET /api/x", unclassified, nil)
}

func TestGateAuthorizer(t *testing.T) {
	e := newEnv(t, testFS())
	e.srv.d.Sessions = func(r *http.Request) *Session { return &Session{UserID: "u_1"} }
	if w := e.do("GET", "/api/admin/info", "", nil); w.Code != 403 {
		t.Fatalf("no authorizer must refuse: %d", w.Code)
	}
	e.srv.d.Authorize = func(r *http.Request, c Class, s *Session) int {
		if c == Admin {
			return 0
		}
		return 404
	}
	w := e.do("GET", "/api/admin/info", "", nil)
	if w.Code != 200 || jsonOf(t, w)["build"] != "abc" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestStaticIndexMarker(t *testing.T) {
	e := newEnv(t, testFS())
	for _, p := range []string{"/", "/index.html"} {
		w := e.do("GET", p, "", nil)
		body := w.Body.String()
		if w.Code != 200 || w.Header().Get("Content-Type") != "text/html; charset=utf-8" {
			t.Fatalf("%s: %d %v", p, w.Code, w.Header())
		}
		if strings.Count(body, Marker) != 1 {
			t.Fatalf("marker count %d", strings.Count(body, Marker))
		}
		want := testCSP + "\">\n    " + Marker + "\n    <title>"
		if !strings.Contains(body, want) {
			t.Fatalf("marker not right after the CSP line:\n%s", body)
		}
		if w.Header().Get("Cache-Control") != "no-cache" || w.Header().Get("ETag") == "" {
			t.Fatalf("cache headers %v", w.Header())
		}
	}
}

func TestInjectMarkerRefusesBrokenPages(t *testing.T) {
	if _, _, err := InjectMarker([]byte("<html></html>")); err == nil {
		t.Fatal("no CSP accepted")
	}
	two := testIndex + `<meta http-equiv="Content-Security-Policy" content="x">`
	if _, _, err := InjectMarker([]byte(two)); err == nil {
		t.Fatal("two CSPs accepted")
	}
	if _, _, err := InjectMarker([]byte(strings.Replace(testIndex, "<title>", Marker+"<title>", 1))); err == nil {
		t.Fatal("double marker accepted")
	}
	if _, err := LoadApp(fstest.MapFS{"index.html": {Data: []byte("<html>")}}); err == nil {
		t.Fatal("LoadApp must refuse a broken index.html")
	}
}

func TestStaticAssetsAndETag(t *testing.T) {
	e := newEnv(t, testFS())
	w := e.do("GET", "/js/app.js", "", nil)
	if w.Code != 200 || w.Body.String() != "console.log(1)" || w.Header().Get("Content-Type") != "text/javascript; charset=utf-8" {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	etag := w.Header().Get("ETag")
	w = e.do("GET", "/js/app.js", "", map[string]string{"If-None-Match": etag})
	if w.Code != 304 || w.Body.Len() != 0 {
		t.Fatalf("revalidation: %d", w.Code)
	}
	if w := e.do("HEAD", "/css/app.css", "", nil); w.Code != 200 || w.Body.Len() != 0 {
		t.Fatalf("HEAD %d", w.Code)
	}
	if w := e.do("GET", "/fonts/a.woff2", "", nil); w.Header().Get("Content-Type") != "font/woff2" {
		t.Fatal(w.Header())
	}
	if w := e.do("GET", "/LICENSE", "", nil); !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") {
		t.Fatal(w.Header())
	}
	for _, p := range []string{"/.hidden", "/js/.DS_Store", "/.git/config", "/js/", "/js", "/nope.js", "/%2e%2e/etc/passwd"} {
		if w := e.do("GET", p, "", nil); w.Code != 404 {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
	// Unclean paths are redirected by the router to their clean form, which
	// is then judged like any other path.
	for p, loc := range map[string]string{"/js/../.hidden": "/.hidden", "/js//app.js": "/js/app.js"} {
		if w := e.do("GET", p, "", nil); w.Code != 307 || w.Header().Get("Location") != loc {
			t.Errorf("%s: %d %s", p, w.Code, w.Header().Get("Location"))
		}
	}
	if w := e.do("POST", "/js/app.js", "", map[string]string{"X-Topo": "1"}); w.Code != 405 {
		t.Errorf("POST to an asset: %d", w.Code)
	}
}

func TestAppHashIgnoresMarkerAndDotfiles(t *testing.T) {
	a, _ := LoadApp(testFS())
	fs2 := testFS()
	delete(fs2, ".hidden")
	b, _ := LoadApp(fs2)
	if a.AppHash != b.AppHash {
		t.Fatal("dotfiles changed the app hash")
	}
	fs2["js/app.js"] = &fstest.MapFile{Data: []byte("changed")}
	c, _ := LoadApp(fs2)
	if c.AppHash == a.AppHash {
		t.Fatal("a changed file kept the hash")
	}
	if a.Count != 5 {
		t.Fatalf("count %d", a.Count)
	}
}

func TestNoAppIn503(t *testing.T) {
	e := newEnv(t, fstest.MapFS{".gitkeep": {Data: nil}})
	if w := e.do("GET", "/", "", nil); w.Code != 503 || !strings.Contains(w.Body.String(), "make stage") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	m := jsonOf(t, e.do("GET", "/api/health", "", nil))
	if m["app"] != false {
		t.Fatal("health must say the app is missing")
	}
}

func TestAPINotFoundIsJSON(t *testing.T) {
	e := newEnv(t, testFS())
	for _, p := range []string{"/api/", "/api/nope", "/api/health/x"} {
		w := e.do("GET", p, "", nil)
		if w.Code != 404 || jsonOf(t, w)["error"] != "not-found" {
			t.Errorf("%s: %d %s", p, w.Code, w.Body)
		}
	}
}

func TestSecurityHeaders(t *testing.T) {
	e := newEnv(t, testFS())
	for _, p := range []string{"/", "/api/health", "/nope"} {
		h := e.do("GET", p, "", nil).Header()
		if h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Referrer-Policy") != "no-referrer" || h.Get("X-Frame-Options") != "DENY" || h.Get("Permissions-Policy") == "" {
			t.Fatalf("%s: %v", p, h)
		}
		if h.Get("Strict-Transport-Security") != "" {
			t.Fatal("HSTS on plain http")
		}
	}
	e2 := newEnv(t, testFS(), "TOPO_PUBLIC_URL=https://topo.example.com", "TOPO_LISTEN=127.0.0.1:7380")
	if e2.do("GET", "/", "", map[string]string{"Host": "topo.example.com"}).Header().Get("Strict-Transport-Security") == "" {
		t.Fatal("no HSTS behind https")
	}
}

// E2: the header policy is the page's meta policy plus frame-ancestors, and
// nothing else.
func TestHeaderCSPEqualsMeta(t *testing.T) {
	e := newEnv(t, testFS())
	w := e.do("GET", "/", "", nil)
	header := w.Header().Get("Content-Security-Policy")
	m := cspRe.FindStringSubmatch(w.Body.String())
	if m == nil {
		t.Fatal("no meta CSP in the served page")
	}
	if header != m[1]+"; frame-ancestors 'none'" {
		t.Fatalf("header %q\nmeta   %q", header, m[1])
	}
}

func TestHostAllowlist(t *testing.T) {
	e := newEnv(t, testFS(), "TOPO_LISTEN=127.0.0.1:7380", "TOPO_PUBLIC_URL=https://topo.example.com", "TOPO_ALLOWED_HOSTS=topo.lan")
	for host, want := range map[string]int{
		"topo.example.com":     200,
		"TOPO.example.com:443": 200,
		"topo.lan":             200,
		"127.0.0.1:7380":       200,
		"localhost":            200,
		"[::1]:7380":           200,
		"evil.example":         421,
		"rebind.attacker.test": 421,
	} {
		if w := e.do("GET", "/api/health", "", map[string]string{"Host": host}); w.Code != want {
			t.Errorf("Host %s: %d, want %d", host, w.Code, want)
		}
	}
}

func TestCSRF(t *testing.T) {
	e := newEnv(t, testFS())
	good := map[string]string{"X-Topo": "1", "Content-Type": "application/json", "Origin": "http://127.0.0.1:7380"}
	with := func(k, v string) map[string]string {
		m := map[string]string{}
		for a, b := range good {
			m[a] = b
		}
		if v == "" {
			delete(m, k)
		} else {
			m[k] = v
		}
		return m
	}
	// Passing CSRF reaches the router (404 for an unknown route).
	if w := e.do("POST", "/api/nope", "{}", good); w.Code != 404 {
		t.Fatalf("good request: %d %s", w.Code, w.Body)
	}
	if w := e.do("POST", "/api/nope", "{}", with("Origin", "http://localhost:7380")); w.Code != 404 {
		t.Fatalf("localhost is the same loopback place: %d", w.Code)
	}
	if w := e.do("DELETE", "/api/nope", "", with("Content-Type", "")); w.Code != 404 {
		t.Fatalf("empty body without a type: %d", w.Code)
	}
	if w := e.do("POST", "/api/nope", "{}", with("Origin", "")); w.Code != 403 {
		t.Fatalf("no Origin and no Sec-Fetch-Site: %d", w.Code)
	}
	o := with("Origin", "")
	o["Sec-Fetch-Site"] = "same-origin"
	if w := e.do("POST", "/api/nope", "{}", o); w.Code != 404 {
		t.Fatalf("same-origin fetch metadata: %d", w.Code)
	}
	o["Sec-Fetch-Site"] = "cross-site"
	if w := e.do("POST", "/api/nope", "{}", o); w.Code != 403 {
		t.Fatalf("cross-site fetch metadata: %d", w.Code)
	}
	for name, h := range map[string]map[string]string{
		"no X-Topo":      with("X-Topo", ""),
		"X-Topo wrong":   with("X-Topo", "yes"),
		"form type":      with("Content-Type", "application/x-www-form-urlencoded"),
		"text type":      with("Content-Type", "text/plain"),
		"foreign origin": with("Origin", "https://evil.example"),
		"other port":     with("Origin", "http://127.0.0.1:9999"),
		"https loopback": with("Origin", "https://127.0.0.1:7380"),
		"null origin":    with("Origin", "null"),
	} {
		for _, m := range []string{"POST", "PUT", "PATCH", "DELETE"} {
			w := e.do(m, "/api/nope", "{}", h)
			if w.Code != 403 || jsonOf(t, w)["error"] != "csrf" {
				t.Errorf("%s %s: %d", m, name, w.Code)
			}
		}
	}
	// A JSON body without a type is refused (a no-cors form post sends one).
	if w := e.do("POST", "/api/nope", "{}", with("Content-Type", "")); w.Code != 403 {
		t.Fatalf("body without a type: %d", w.Code)
	}
	// GETs are read-only and need nothing.
	if w := e.do("GET", "/api/health", "", nil); w.Code != 200 {
		t.Fatal(w.Code)
	}
	// Behind https only the exact public origin passes.
	e2 := newEnv(t, testFS(), "TOPO_PUBLIC_URL=https://topo.example.com", "TOPO_LISTEN=127.0.0.1:7380")
	h := with("Origin", "https://topo.example.com")
	h["Host"] = "topo.example.com"
	if w := e2.do("POST", "/api/nope", "{}", h); w.Code != 404 {
		t.Fatalf("https origin: %d", w.Code)
	}
	h["Origin"] = "http://localhost:7380"
	if w := e2.do("POST", "/api/nope", "{}", h); w.Code != 403 {
		t.Fatalf("loopback origin on an https server: %d", w.Code)
	}
}

func TestDecodeBody(t *testing.T) {
	type v struct{ A int }
	cases := []struct {
		body, ct string
		limit    int64
		code     int
	}{
		{`{"A":1}`, "application/json", 100, 0},
		{``, "", 100, 0},
		{`{"A":1} {"A":2}`, "application/json", 100, 400},
		{`{"A":1} x`, "application/json", 100, 400},
		{`{"A":`, "application/json", 100, 400},
		{`{"A":1}`, "text/plain", 100, 400},
		{`{"A":11111111111}`, "application/json; charset=utf-8", 5, 413},
	}
	for _, c := range cases {
		r := httptest.NewRequest("POST", "/", strings.NewReader(c.body))
		if c.ct != "" {
			r.Header.Set("Content-Type", c.ct)
		}
		w := httptest.NewRecorder()
		var out v
		err := decodeBody(w, r, c.limit, &out)
		if c.code == 0 {
			if err != nil {
				t.Errorf("%q: %v", c.body, err)
			}
			continue
		}
		writeDecodeError(w, err)
		if w.Code != c.code {
			t.Errorf("%q: %d, want %d", c.body, w.Code, c.code)
		}
	}
}

func TestClientIP(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32"), netip.MustParsePrefix("10.0.0.0/8")}
	mk := func(peer string, xff ...string) *http.Request {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = peer
		for _, x := range xff {
			r.Header.Add("X-Forwarded-For", x)
		}
		return r
	}
	cases := []struct {
		r    *http.Request
		tr   []netip.Prefix
		want string
	}{
		{mk("203.0.113.5:1234", "1.2.3.4"), trusted, "203.0.113.5"},           // untrusted peer: XFF ignored
		{mk("127.0.0.1:1", "1.2.3.4"), trusted, "1.2.3.4"},                    // proxy
		{mk("127.0.0.1:1", "6.6.6.6, 1.2.3.4, 10.1.1.1"), trusted, "1.2.3.4"}, // spoofed left part ignored
		{mk("127.0.0.1:1"), trusted, "127.0.0.1"},                             // no header
		{mk("127.0.0.1:1", "garbage"), trusted, "127.0.0.1"},                  // bad header
		{mk("127.0.0.1:1", "1.2.3.4"), nil, "127.0.0.1"},                      // nothing trusted
		{mk("[::ffff:127.0.0.1]:1", "1.2.3.4"), trusted, "1.2.3.4"},           // mapped v4 peer
	}
	for i, c := range cases {
		if got := ClientIP(c.r, c.tr).String(); got != c.want {
			t.Errorf("case %d: %s, want %s", i, got, c.want)
		}
	}
	if RateKey(netip.MustParseAddr("2001:db8:1:2:3:4:5:6")) != "2001:db8:1:2::/64" || RateKey(netip.MustParseAddr("1.2.3.4")) != "1.2.3.4" {
		t.Fatal("rate keys")
	}
}

func TestPanicIsJSON500(t *testing.T) {
	e := newEnv(t, testFS())
	e.srv.handle("GET /api/boom", Public, func(w http.ResponseWriter, r *http.Request) { panic("boom") })
	w := e.do("GET", "/api/boom", "", nil)
	if w.Code != 500 || jsonOf(t, w)["error"] != "internal" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
