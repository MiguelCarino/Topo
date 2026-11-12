package api

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/store"
)

const testLocalKey = "k0123456789abcdef0123456789abcdef"

// D358: the desktop app that set up a server only this computer reaches,
// with no email, fetches the sign-in code with its key, from loopback.
// Nobody else gets it: not without the key, not from another address, not
// through a proxy, not on a server other computers reach.
func TestLocalSigninCode(t *testing.T) {
	mk := func(env ...string) (*Server, *mail.CodeBox, mail.Mailer) {
		dir := t.TempDir()
		r, err := config.Load(config.Options{Environ: append([]string{"TOPO_DATA=" + dir}, env...)})
		if err != nil {
			t.Fatal(err)
		}
		st, err := store.Open(dir, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { st.Close() })
		app, err := LoadApp(testFS())
		if err != nil {
			t.Fatal(err)
		}
		box := mail.NewCodeBox(nil)
		m, err := mail.New(r.Config, slog.New(slog.DiscardHandler), mail.Options{Codes: box})
		if err != nil {
			t.Fatal(err)
		}
		return New(Deps{Cfg: r.Config, Store: st, App: app, LocalCodes: box}), box, m
	}
	send := func(m mail.Mailer, to, code string) {
		msg, err := mail.Render("signin", "en", map[string]string{"code": code, "link": "http://127.0.0.1:7380/#signin=x", "minutes": "15"})
		if err != nil {
			t.Fatal(err)
		}
		msg.To = to
		if err := m.Send(context.Background(), msg); err != nil {
			t.Fatal(err)
		}
	}
	get := func(s *Server, remote, key, email string, extra map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "http://127.0.0.1:7380/api/local/signin-code", nil)
		req.RemoteAddr = remote
		if key != "" {
			req.Header.Set("X-Topo-Local-Key", key)
		}
		req.Header.Set("X-Topo-Email", email)
		for k, v := range extra {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, req)
		return w
	}

	s, _, m := mk("TOPO_MAIL=log", "TOPO_LISTEN=127.0.0.1:7380", "TOPO_LOCAL_CODE_KEY="+testLocalKey)
	if w := get(s, "127.0.0.1:5555", testLocalKey, "it@example.com", nil); w.Code != 404 || !strings.Contains(w.Body.String(), `"no-code"`) {
		t.Fatalf("nothing sent yet: %d %s", w.Code, w.Body.String())
	}
	send(m, "it@example.com", "123456")
	if w := get(s, "127.0.0.1:5555", "", "it@example.com", nil); w.Code != 404 || strings.Contains(w.Body.String(), "no-code") {
		t.Fatalf("no key: %d %s", w.Code, w.Body.String())
	}
	if w := get(s, "127.0.0.1:5555", testLocalKey+"x", "it@example.com", nil); w.Code != 404 {
		t.Fatalf("wrong key: %d", w.Code)
	}
	if w := get(s, "192.168.1.9:5555", testLocalKey, "it@example.com", nil); w.Code != 404 {
		t.Fatalf("another address: %d", w.Code)
	}
	if w := get(s, "127.0.0.1:5555", testLocalKey, "it@example.com", map[string]string{"X-Forwarded-For": "192.168.1.9"}); w.Code != 404 {
		t.Fatalf("through a proxy: %d", w.Code)
	}
	if w := get(s, "127.0.0.1:5555", testLocalKey, "other@example.com", nil); w.Code != 404 {
		t.Fatalf("another address's code: %d", w.Code)
	}
	w := get(s, "[::1]:5555", testLocalKey, "IT@example.com", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"code":"123456"`) || !strings.Contains(w.Body.String(), `"at":`) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("the app's own fetch: %d %s", w.Code, w.Body.String())
	}
	if w := get(s, "127.0.0.1:5555", testLocalKey, "it@example.com", nil); w.Code != 404 {
		t.Fatalf("taken once: %d", w.Code)
	}

	// A server other computers reach never answers, key or not.
	s2, _, m2 := mk("TOPO_MAIL=log", "TOPO_LISTEN=0.0.0.0:7380", "TOPO_PUBLIC_URL=http://127.0.0.1:7380", "TOPO_LOCAL_CODE_KEY="+testLocalKey)
	send(m2, "it@example.com", "123456")
	if w := get(s2, "127.0.0.1:5555", testLocalKey, "it@example.com", nil); w.Code != 404 {
		t.Fatalf("not only this PC: %d", w.Code)
	}
}
