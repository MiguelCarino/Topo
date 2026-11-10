package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func load(t *testing.T, env ...string) (*Result, error) {
	t.Helper()
	return Load(Options{Environ: append([]string{"TOPO_DATA=" + t.TempDir()}, env...), GOOS: "linux", Home: "/home/x"})
}

func mustLoad(t *testing.T, env ...string) *Result {
	t.Helper()
	r, err := load(t, env...)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestDefaults(t *testing.T) {
	r := mustLoad(t)
	c := r.Config
	if c.Listen != "127.0.0.1:7380" || c.Origin() != "http://127.0.0.1:7380" || !c.PublicDefaulted {
		t.Fatalf("listen/public: %s %s", c.Listen, c.Origin())
	}
	if c.Secure() {
		t.Fatal("loopback http is not secure")
	}
	if c.Mail != "log" || c.SMTP.Port != 587 || c.SMTP.Security != "starttls" {
		t.Fatalf("mail defaults: %+v", c)
	}
	if c.MaxRevBytes != 8<<20 || c.RevCap != 500 || c.SessionIdle != 720*time.Hour || c.SessionMax != 2160*time.Hour || c.CodeTTL != 10*time.Minute || c.NotifyRevisionMinutes != 60 || c.MailPerMinute != 30 {
		t.Fatalf("limits: %+v", c)
	}
	if c.MailDir != filepath.Join(c.DataDir, "mail") {
		t.Fatalf("mail dir %s", c.MailDir)
	}
	if len(r.Warnings) != 0 {
		t.Fatalf("warnings: %v", r.Warnings)
	}
}

func TestDefaultDataDir(t *testing.T) {
	cases := []struct {
		goos string
		env  map[string]string
		want string
	}{
		{"linux", nil, "/h/.local/share/topo"},
		{"linux", map[string]string{"XDG_DATA_HOME": "/x"}, "/x/topo"},
		{"linux", map[string]string{"XDG_DATA_HOME": "rel"}, "/h/.local/share/topo"},
		{"darwin", nil, "/h/Library/Application Support/Topo"},
	}
	for _, c := range cases {
		if got := DefaultDataDir(c.goos, "/h", c.env); got != filepath.FromSlash(c.want) {
			t.Errorf("%s %v: %s", c.goos, c.env, got)
		}
	}
	r, err := Load(Options{Environ: []string{"XDG_DATA_HOME=/xdg"}, GOOS: "linux", Home: "/h"})
	if err != nil || r.Config.DataDir != "/xdg/topo" {
		t.Fatalf("%v %v", err, r)
	}
}

func TestFileThenEnv(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "topo.env")
	os.WriteFile(f, []byte("# comment\n\nTOPO_REV_CAP=7\nTOPO_CODE_TTL='5m'\nTOPO_LOG_LEVEL=\"debug\"\nTZ=UTC\n"), 0o600)
	r, err := Load(Options{File: f, Environ: []string{"TOPO_DATA=" + dir, "TOPO_REV_CAP=9"}})
	if err != nil {
		t.Fatal(err)
	}
	c := r.Config
	if c.RevCap != 9 {
		t.Fatalf("env must win: %d", c.RevCap)
	}
	if c.CodeTTL != 5*time.Minute || c.LogLevel.String() != "DEBUG" {
		t.Fatalf("file values: %v %v", c.CodeTTL, c.LogLevel)
	}
	if len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "TZ") {
		t.Fatalf("warnings %v", r.Warnings)
	}
	// TOPO_CONFIG in the environment names the file too.
	r, err = Load(Options{Environ: []string{"TOPO_DATA=" + dir, "TOPO_CONFIG=" + f}})
	if err != nil || r.Config.RevCap != 7 {
		t.Fatalf("TOPO_CONFIG: %v", err)
	}
	// Overrides (flags) win over both.
	r, err = Load(Options{File: f, Environ: []string{"TOPO_DATA=" + dir, "TOPO_REV_CAP=9"}, Overrides: map[string]string{"TOPO_REV_CAP": "11"}})
	if err != nil || r.Config.RevCap != 11 {
		t.Fatalf("override: %v", err)
	}
}

func TestBadFile(t *testing.T) {
	f := filepath.Join(t.TempDir(), "x.env")
	os.WriteFile(f, []byte("TOPO_REV_CAP\n"), 0o600)
	if _, err := Load(Options{File: f, Environ: []string{"TOPO_DATA=/tmp/x"}}); err == nil || !strings.Contains(err.Error(), ":1:") {
		t.Fatalf("want a line error, got %v", err)
	}
	if _, err := Load(Options{File: "/nonexistent/x.env", Environ: []string{"TOPO_DATA=/tmp/x"}}); err == nil {
		t.Fatal("missing file must fail")
	}
}

func TestUnknownAndReserved(t *testing.T) {
	if _, err := load(t, "TOPO_LISTN=1"); err == nil || !strings.Contains(err.Error(), "TOPO_LISTN") {
		t.Fatalf("unknown key: %v", err)
	}
	r := mustLoad(t, "TOPO_BACKUP_DEST=dir:/b", "TOPO_BACKUP_S3_BUCKET=x", "TOPO_DB=sqlite", "TOPO_E2E_BIN=/x")
	if len(r.Config.Reserved) != 3 {
		t.Fatalf("reserved %v", r.Config.Reserved)
	}
	if len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "TOPO_BACKUP_DEST") {
		t.Fatalf("warnings %v", r.Warnings)
	}
	// Non-TOPO variables in the environment are not ours to judge.
	mustLoad(t, "HOME=/x", "PATH=/bin")
}

func TestFileVariants(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "pass")
	os.WriteFile(p, []byte("s3cret\n"), 0o600)
	r := mustLoad(t, "TOPO_SMTP_HOST=smtp.example.com", "TOPO_SMTP_FROM=Topo <t@example.com>", "TOPO_SMTP_USER=u", "TOPO_SMTP_PASS_FILE="+p)
	if r.Config.SMTP.Pass != "s3cret" || r.Config.Mail != "smtp" {
		t.Fatalf("pass %q mail %s", r.Config.SMTP.Pass, r.Config.Mail)
	}
	if _, err := load(t, "TOPO_SMTP_PASS=a", "TOPO_SMTP_PASS_FILE="+p); err == nil {
		t.Fatal("both must fail")
	}
	if _, err := load(t, "TOPO_LISTEN_FILE="+p); err == nil {
		t.Fatal("non-secret _FILE must fail")
	}
}

func TestD52(t *testing.T) {
	// Non-loopback listen with no public URL.
	if _, err := load(t, "TOPO_LISTEN=:7380"); err == nil {
		t.Fatal("non-loopback listen needs a public URL")
	}
	// Non-loopback plain http public URL.
	if _, err := load(t, "TOPO_LISTEN=0.0.0.0:7380", "TOPO_PUBLIC_URL=http://topo.lan:7380"); err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("plain http on a LAN name must fail: %v", err)
	}
	// Reverse proxy.
	r := mustLoad(t, "TOPO_LISTEN=:7380", "TOPO_PUBLIC_URL=https://Topo.Example.com/")
	if !r.Config.Secure() || r.Config.Origin() != "https://topo.example.com" {
		t.Fatalf("proxy: %s", r.Config.Origin())
	}
	// Container on loopback http: allowed, loudly (B6).
	r = mustLoad(t, "TOPO_LISTEN=:7380", "TOPO_PUBLIC_URL=http://127.0.0.1:7380")
	if r.Config.Secure() || len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "127.0.0.1:7380:7380") {
		t.Fatalf("B6 warning: %v", r.Warnings)
	}
	// Built-in TLS needs both files and an https public URL.
	if _, err := load(t, "TOPO_TLS_CERT=/c"); err == nil {
		t.Fatal("cert without key")
	}
	if _, err := load(t, "TOPO_TLS_KEY=/k"); err == nil {
		t.Fatal("key without cert")
	}
	r = mustLoad(t, "TOPO_TLS_CERT=/c", "TOPO_TLS_KEY=/k")
	if r.Config.Origin() != "https://127.0.0.1:7380" || !r.Config.Secure() {
		t.Fatalf("tls default origin %s", r.Config.Origin())
	}
	if _, err := load(t, "TOPO_TLS_CERT=/c", "TOPO_TLS_KEY=/k", "TOPO_PUBLIC_URL=http://127.0.0.1:7380"); err == nil {
		t.Fatal("tls with an http public URL must fail")
	}
}

func TestPublicURLShape(t *testing.T) {
	for _, bad := range []string{"https://x.com/topo", "ftp://x.com", "https://", "https://u:p@x.com", "https://x.com/?a=1", "https://x.com:99999"} {
		if _, err := load(t, "TOPO_PUBLIC_URL="+bad); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
	r := mustLoad(t, "TOPO_PUBLIC_URL=https://x.com:443")
	if r.Config.Origin() != "https://x.com" {
		t.Fatalf("default port kept: %s", r.Config.Origin())
	}
}

func TestMailValidation(t *testing.T) {
	if _, err := load(t, "TOPO_MAIL=smtp"); err == nil {
		t.Fatal("smtp without host/from")
	}
	if _, err := load(t, "TOPO_SMTP_HOST=smtp.x.com"); err == nil || !strings.Contains(err.Error(), "TOPO_SMTP_FROM") {
		t.Fatalf("smtp without from: %v", err)
	}
	if _, err := load(t, "TOPO_SMTP_HOST=smtp.x.com", "TOPO_SMTP_FROM=t@x.com", "TOPO_SMTP_SECURITY=none"); err == nil {
		t.Fatal("plain smtp to a remote host must fail")
	}
	mustLoad(t, "TOPO_SMTP_HOST=127.0.0.1", "TOPO_SMTP_PORT=25", "TOPO_SMTP_FROM=t@x.com", "TOPO_SMTP_SECURITY=none")
	r := mustLoad(t, "TOPO_SMTP_HOST=smtp.x.com", "TOPO_SMTP_PORT=465", "TOPO_SMTP_FROM=t@x.com")
	if r.Config.SMTP.Security != "tls" {
		t.Fatalf("465 means tls: %s", r.Config.SMTP.Security)
	}
	if _, err := load(t, "TOPO_SMTP_FROM=a@b.com\r\nBcc: x@y.com"); err == nil {
		t.Fatal("header injection in From")
	}
	if _, err := load(t, "TOPO_MAIL=pigeon"); err == nil {
		t.Fatal("unknown transport")
	}
	r = mustLoad(t, "TOPO_MAIL=file", "TOPO_MAIL_DIR=/m")
	if r.Config.MailDir != "/m" {
		t.Fatal(r.Config.MailDir)
	}
}

func TestOwnerAndLists(t *testing.T) {
	r := mustLoad(t, "TOPO_OWNER_EMAIL= Boss@Example.COM ", "TOPO_ALLOWED_HOSTS=a.example, B.example", "TOPO_TRUSTED_PROXIES=127.0.0.1,10.0.0.0/8")
	c := r.Config
	if c.OwnerEmail != "boss@example.com" {
		t.Fatal(c.OwnerEmail)
	}
	if len(c.AllowedHosts) != 2 || c.AllowedHosts[1] != "b.example" {
		t.Fatal(c.AllowedHosts)
	}
	if len(c.TrustedProxies) != 2 || c.TrustedProxies[0].Bits() != 32 {
		t.Fatal(c.TrustedProxies)
	}
	for _, bad := range []string{"TOPO_OWNER_EMAIL=nope", "TOPO_OWNER_EMAIL=A <a@b.c>", "TOPO_TRUSTED_PROXIES=lan", "TOPO_ALLOWED_HOSTS=a/b"} {
		if _, err := load(t, bad); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
}

func TestNumbersAndDurations(t *testing.T) {
	for _, bad := range []string{"TOPO_REV_CAP=-1", "TOPO_MAX_REV_BYTES=x", "TOPO_CODE_TTL=2h", "TOPO_SESSION_IDLE=3000h", "TOPO_SESSION_MAX=0s", "TOPO_LOG_LEVEL=loud", "TOPO_LOG_FORMAT=xml", "TOPO_LISTEN=nohost", "TOPO_SMTP_PORT=0"} {
		if _, err := load(t, bad); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
	r := mustLoad(t, "TOPO_REV_CAP=0", "TOPO_NOTIFY_REVISION_MINUTES=0")
	if r.Config.RevCap != 0 || r.Config.NotifyRevisionMinutes != 0 {
		t.Fatal("zero must be allowed")
	}
	// TOPO_NOTIFY_EVENT_SECONDS: 120 by default, 0 means "no wait" (-1).
	if d := mustLoad(t).Config.NotifyEventDelay; d != 2*time.Minute {
		t.Fatalf("default event delay %v", d)
	}
	if d := mustLoad(t, "TOPO_NOTIFY_EVENT_SECONDS=0").Config.NotifyEventDelay; d >= 0 {
		t.Fatalf("0 seconds gave %v", d)
	}
	if _, err := load(t, "TOPO_NOTIFY_EVENT_SECONDS=4000"); err == nil {
		t.Fatal("over an hour accepted")
	}
}

func TestStaticFolder(t *testing.T) {
	dir := t.TempDir()
	if _, err := load(t, "TOPO_STATIC="+dir); err == nil {
		t.Fatal("no index.html")
	}
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("x"), 0o600)
	mustLoad(t, "TOPO_STATIC="+dir)
	os.Mkdir(filepath.Join(dir, ".git"), 0o700)
	if _, err := load(t, "TOPO_STATIC="+dir); err == nil || !strings.Contains(err.Error(), "git") {
		t.Fatalf("a git checkout must be refused: %v", err)
	}
}

func TestIsLoopbackHost(t *testing.T) {
	for h, want := range map[string]bool{"localhost": true, "127.0.0.1": true, "127.9.9.9": true, "[::1]": true, "::1": true, "0.0.0.0": false, "": false, "10.0.0.1": false, "topo.lan": false} {
		if IsLoopbackHost(h) != want {
			t.Errorf("%q", h)
		}
	}
}

// An https deployment with no SMTP warns at every start (codes would only
// reach the log); a loopback dev server and an explicit TOPO_MAIL=log do not.
func TestNoSMTPWarning(t *testing.T) {
	has := func(r *Result) bool {
		for _, w := range r.Warnings {
			if strings.Contains(w, "no SMTP server") {
				return true
			}
		}
		return false
	}
	if r := mustLoad(t, "TOPO_PUBLIC_URL=https://topo.example.com", "TOPO_LISTEN=127.0.0.1:7380"); r.Config.Mail != "log" || !has(r) {
		t.Fatalf("https without smtp: mail %s, warnings %v", r.Config.Mail, r.Warnings)
	}
	if r := mustLoad(t); has(r) {
		t.Fatalf("loopback dev: %v", r.Warnings)
	}
	if r := mustLoad(t, "TOPO_PUBLIC_URL=https://topo.example.com", "TOPO_LISTEN=127.0.0.1:7380", "TOPO_MAIL=log"); has(r) {
		t.Fatalf("explicit log: %v", r.Warnings)
	}
}
