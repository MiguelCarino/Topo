package main

import (
	"bufio"
	"net/http"
	"net/http/cookiejar"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A signed-in browser's live stream over real HTTP: it opens, and shutdown
// ends it through the base context in well under two seconds.
func TestShutdownEndsLiveStream(t *testing.T) {
	data := t.TempDir()
	cfg := loadCfg(t, "TOPO_DATA="+data, "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t), "TOPO_MAIL=file", "TOPO_OWNER_EMAIL=boss@example.test")
	r := start(t, cfg)
	base := "http://" + r.addr
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}
	_, m := call(t, c, "POST", base+"/api/auth/request", base, map[string]any{"email": "boss@example.test"})
	l := readSink(t, filepath.Join(data, "mail"), "boss@example.test", "signin")
	if code, _ := call(t, c, "POST", base+"/api/auth/verify", base, map[string]any{"challenge": m["challenge"], "code": l.Code}); code != 200 {
		t.Fatal("sign in")
	}
	resp, err := c.Get(base + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("events: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	line, err := bufio.NewReader(resp.Body).ReadString('\n')
	if err != nil || line != "retry: 5000\n" {
		t.Fatalf("first line %q %v", line, err)
	}
	if d := r.stop(t); d > 2*time.Second {
		t.Fatalf("shutdown with an open stream took %s", d)
	}
}
