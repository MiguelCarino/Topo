package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/store"
)

func readSink(t *testing.T, dir, to, kind string) *mail.SinkLine {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if f, err := os.Open(filepath.Join(dir, "outbox.jsonl")); err == nil {
			var found *mail.SinkLine
			sc := bufio.NewScanner(f)
			for sc.Scan() {
				var l mail.SinkLine
				if json.Unmarshal(sc.Bytes(), &l) == nil && l.To == to && l.Kind == kind {
					found = &l
				}
			}
			f.Close()
			if found != nil {
				return found
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no %s mail to %s", kind, to)
	return nil
}

func call(t *testing.T, c *http.Client, method, url, origin string, body any) (int, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, url, rd)
	if method != "GET" {
		req.Header.Set("X-Topo", "1")
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var m map[string]any
	json.NewDecoder(resp.Body).Decode(&m)
	return resp.StatusCode, m
}

// The whole sign-in over real HTTP: the worker started by serve delivers
// the code to the file sink, and the session cookie works.
func TestSignInEndToEnd(t *testing.T) {
	data := t.TempDir()
	cfg := loadCfg(t, "TOPO_DATA="+data, "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t), "TOPO_MAIL=file", "TOPO_OWNER_EMAIL=boss@example.test")
	r := start(t, cfg)
	base := "http://" + r.addr
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}
	code, m := call(t, c, "POST", base+"/api/auth/request", base, map[string]any{"email": "boss@example.test", "lang": "ja"})
	if code != 202 {
		t.Fatalf("%d %v", code, m)
	}
	mailDir := filepath.Join(data, "mail")
	l := readSink(t, mailDir, "boss@example.test", "signin")
	if l.Lang != "ja" || len(l.Code) != 6 {
		t.Fatalf("%+v", l)
	}
	code, m = call(t, c, "POST", base+"/api/auth/verify", base, map[string]any{"challenge": m["challenge"], "code": l.Code})
	if code != 200 {
		t.Fatalf("verify %d %v", code, m)
	}
	code, m = call(t, c, "GET", base+"/api/me", base, nil)
	if code != 200 || m["serverRole"] != "owner" {
		t.Fatalf("me %d %v", code, m)
	}
	// The magic link from a second request, in the same browser.
	call(t, c, "POST", base+"/api/auth/signout", base, map[string]any{})
	if code, _ := call(t, c, "GET", base+"/api/me", base, nil); code != 401 {
		t.Fatal("signed out")
	}
	time.Sleep(5 * time.Millisecond)
	call(t, c, "POST", base+"/api/auth/request", base, map[string]any{"email": "boss@example.test"})
	var link *mail.SinkLine
	deadline := time.Now().Add(10 * time.Second)
	for link == nil || link.Code == l.Code {
		if time.Now().After(deadline) {
			t.Fatal("second mail")
		}
		link = readSink(t, mailDir, "boss@example.test", "signin")
		time.Sleep(20 * time.Millisecond)
	}
	tok := strings.TrimPrefix(link.Link, base+"/#signin=")
	if code, m := call(t, c, "POST", base+"/api/auth/link", base, map[string]any{"token": tok}); code != 200 {
		t.Fatalf("link %d %v", code, m)
	}
	// Request logs never carry the code or the token.
	r.stop(t)
	if logs := r.log.String(); strings.Contains(logs, l.Code) || strings.Contains(logs, tok) || strings.Contains(logs, "boss@example.test") {
		t.Fatalf("secret in the log:\n%s", logs)
	}
}

func TestOwnerEmailPromotedAtStart(t *testing.T) {
	data := t.TempDir()
	st, err := store.Open(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	store.CreateUser(context.Background(), st.W, &store.User{ID: "u_1", Email: "o@example.com", EmailNorm: "o@example.com", Lang: "en", ServerRole: "member", Created: 1})
	st.Close()
	cfg := loadCfg(t, "TOPO_DATA="+data, "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t), "TOPO_OWNER_EMAIL=o@example.com")
	r := start(t, cfg)
	_, body := get(t, "http://"+r.addr+"/api/health")
	r.stop(t)
	st, _ = store.Open(data, nil)
	defer st.Close()
	u, _ := store.UserByID(context.Background(), st.R, "u_1")
	if u.ServerRole != "owner" || !strings.Contains(body, `"setup":false`) {
		t.Fatalf("role %s health %s", u.ServerRole, body)
	}
}

func TestMailTestCommand(t *testing.T) {
	data := t.TempDir()
	env := []string{"TOPO_DATA=" + data, "TOPO_MAIL=file"}
	var out, errb bytes.Buffer
	if code := run([]string{"mail-test", "you@example.com"}, env, &out, &errb); code != 0 || !strings.Contains(out.String(), "file") {
		t.Fatalf("%d %s %s", code, out.String(), errb.String())
	}
	l := readSink(t, filepath.Join(data, "mail"), "you@example.com", "test")
	if l.Subject != "Topo test email" {
		t.Fatalf("%+v", l)
	}
	if code := run([]string{"mail-test"}, env, &out, &errb); code != 2 {
		t.Fatal("no address")
	}
	if code := run([]string{"mail-test", "nope"}, env, &out, &errb); code != 2 {
		t.Fatal("bad address")
	}
	// An unreachable SMTP server is reported, not hidden.
	errb.Reset()
	smtpEnv := []string{"TOPO_DATA=" + data, "TOPO_SMTP_HOST=127.0.0.1", "TOPO_SMTP_PORT=1", "TOPO_SMTP_SECURITY=none", "TOPO_SMTP_FROM=Topo <t@example.com>"}
	if code := run([]string{"mail-test", "you@example.com"}, smtpEnv, &out, &errb); code != 1 || !strings.Contains(errb.String(), "not sent") {
		t.Fatalf("%d %s", code, errb.String())
	}
}

// D358: the desktop app's "This PC only" server with no email. The code
// reaches the app that holds TOPO_LOCAL_CODE_KEY, over loopback, and the
// sign-in finishes with it; the code is never in the log at info.
func TestLocalSigninCodeEndToEnd(t *testing.T) {
	const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	data := t.TempDir()
	cfg := loadCfg(t, "TOPO_DATA="+data, "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t), "TOPO_MAIL=log",
		"TOPO_OWNER_EMAIL=boss@example.test", "TOPO_LOCAL_CODE_KEY="+key)
	r := start(t, cfg)
	base := "http://" + r.addr
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}
	fetch := func(k string) (int, map[string]any) {
		req, _ := http.NewRequest("GET", base+"/api/local/signin-code", nil)
		req.Header.Set("X-Topo-Local-Key", k)
		req.Header.Set("X-Topo-Email", "boss@example.test")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var m map[string]any
		json.NewDecoder(resp.Body).Decode(&m)
		return resp.StatusCode, m
	}
	sent := time.Now().UnixMilli()
	code, m := call(t, c, "POST", base+"/api/auth/request", base, map[string]any{"email": "boss@example.test"})
	if code != 202 {
		t.Fatalf("%d %v", code, m)
	}
	var got map[string]any
	deadline := time.Now().Add(10 * time.Second)
	for {
		st, b := fetch(key)
		if st == 200 {
			got = b
			break
		}
		if st != 404 || b["error"] != "no-code" || time.Now().After(deadline) {
			t.Fatalf("waiting for the code: %d %v", st, b)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if at, _ := got["at"].(float64); int64(at) < sent-1000 {
		t.Fatalf("at %v before the request %d", got["at"], sent)
	}
	if st, b := fetch("wrong" + key); st != 404 || b["error"] != "not-found" {
		t.Fatalf("wrong key: %d %v", st, b)
	}
	if code, m := call(t, c, "POST", base+"/api/auth/verify", base, map[string]any{"challenge": m["challenge"], "code": got["code"]}); code != 200 {
		t.Fatalf("verify %d %v", code, m)
	}
	r.stop(t)
	for _, l := range strings.Split(r.log.String(), "\n") {
		if strings.Contains(l, "level=DEBUG") {
			continue
		}
		if strings.Contains(l, got["code"].(string)) || strings.Contains(l, key) {
			t.Fatalf("a secret above debug in the log: %s", l)
		}
	}
}
