package main

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"carino.systems/topo/server/internal/selfcert"
)

// The settings the app hands to `service configure`: only its own keys,
// sorted, nothing that moves the service's folders or files.
func TestCleanAppConf(t *testing.T) {
	got, err := cleanAppConf(map[string]string{"TOPO_OWNER_EMAIL": "it@example.com", "TOPO_LISTEN": "0.0.0.0:7380", "TOPO_TLS_SELF": "1"})
	if err != nil || got != "TOPO_LISTEN=0.0.0.0:7380\nTOPO_OWNER_EMAIL=it@example.com\nTOPO_TLS_SELF=1\n" {
		t.Fatalf("%q %v", got, err)
	}
	for _, k := range []string{"TOPO_DATA", "TOPO_STATIC", "TOPO_SMTP_PASS_FILE", "TOPO_SMTP_PASS", "TOPO_CONFIG", "TOPO_MAIL_DIR"} {
		if _, err := cleanAppConf(map[string]string{k: "x"}); err == nil {
			t.Errorf("%s was accepted", k)
		}
	}
	if _, err := cleanAppConf(map[string]string{"TOPO_SMTP_FROM": "a\x1bb"}); err == nil {
		t.Error("a control character was accepted")
	}
}

func TestComposeConf(t *testing.T) {
	app := "TOPO_MAIL=smtp\nTOPO_SMTP_USER=topo@example.com\n"
	if c := composeConf(app, "/etc/topo/p", true); !strings.HasSuffix(c, "TOPO_SMTP_PASS_FILE=/etc/topo/p\n") || !strings.HasPrefix(c, "# Topo server settings") {
		t.Fatalf("with a password: %q", c)
	}
	if c := composeConf(app, "/etc/topo/p", false); strings.Contains(c, "PASS") {
		t.Fatalf("no password saved: %q", c)
	}
	if c := composeConf("TOPO_MAIL=smtp\n", "/etc/topo/p", true); strings.Contains(c, "PASS") {
		t.Fatalf("no SMTP user: %q", c)
	}
}

func TestReorderFlags(t *testing.T) {
	got := strings.Join(reorderFlags([]string{"/tmp/a.conf", "--start", "--smtp-pass", "/tmp/p", "--report=/tmp/r"}), " ")
	if got != "--start --smtp-pass /tmp/p --report=/tmp/r /tmp/a.conf" {
		t.Fatal(got)
	}
}

// probeLocal reads the fingerprint of an https server on loopback (the one
// the server writes to tls/cert.sha256) and tells http from nothing.
func TestProbeLocal(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(`{"ok":true}`)) })
	ts := httptest.NewTLSServer(ok)
	defer ts.Close()
	port := ts.Listener.Addr().(*net.TCPAddr).Port
	answering, isTLS, fp := probeLocal(port, 2*time.Second)
	want := selfcert.Fingerprint(ts.Certificate().Raw)
	if !answering || !isTLS || fp != want {
		t.Fatalf("https: %v %v %q (want %q)", answering, isTLS, fp, want)
	}
	hs := httptest.NewServer(ok)
	port = hs.Listener.Addr().(*net.TCPAddr).Port
	if a, tl, f := probeLocal(port, 2*time.Second); !a || tl || f != "" {
		t.Fatalf("http: %v %v %q", a, tl, f)
	}
	hs.Close()
	if a, _, _ := probeLocal(port, time.Second); a {
		t.Fatal("a closed port answered")
	}
}

func TestServiceCommandUsage(t *testing.T) {
	var out, errb bytes.Buffer
	if code := serviceCommand([]string{"configure"}, nil, &out, &errb); code != 2 {
		t.Fatalf("configure without a file: %d", code)
	}
	if code := serviceCommand([]string{"status", "extra"}, nil, &out, &errb); code != 2 {
		t.Fatalf("an extra argument: %d", code)
	}
	errb.Reset()
	if code := serviceCommand([]string{"bogus"}, nil, &out, &errb); code == 0 || !strings.Contains(errb.String(), "unknown") {
		t.Fatalf("unknown verb: %d %s", code, errb.String())
	}
	// A settings file with a key the app never sets is refused before
	// anything is touched, and --report says so.
	dir := t.TempDir()
	conf, rep := filepath.Join(dir, "a.conf"), filepath.Join(dir, "r")
	os.WriteFile(conf, []byte("TOPO_DATA=/tmp/x\n"), 0o600)
	errb.Reset()
	if code := serviceCommand([]string{"configure", conf, "--report", rep}, nil, &out, &errb); code != 1 || !strings.Contains(errb.String(), "TOPO_DATA cannot be set") {
		t.Fatalf("TOPO_DATA: %d %s", code, errb.String())
	}
	if b, _ := os.ReadFile(rep); !strings.HasPrefix(string(b), "error\nTOPO_DATA") {
		t.Fatalf("report: %q", b)
	}
}

// status always prints one JSON line, also where no service is set up.
func TestServiceStatusJSON(t *testing.T) {
	var out, errb bytes.Buffer
	if code := serviceCommand([]string{"status", "--port", "1"}, nil, &out, &errb); code != 0 {
		t.Fatalf("status: %d %s", code, errb.String())
	}
	var st serviceStatus
	if err := json.Unmarshal(out.Bytes(), &st); err != nil || st.Answering {
		t.Fatalf("status JSON: %v %q", err, out.String())
	}
}
