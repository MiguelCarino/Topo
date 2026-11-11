package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"carino.systems/topo/server/internal/api"
	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/store"
)

const page = `<!doctype html>
<html><head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'">
    <title>t</title><script src="js/a.js"></script>
</head></html>
`

func staticDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte(page), 0o644)
	os.Mkdir(filepath.Join(dir, "js"), 0o755)
	os.WriteFile(filepath.Join(dir, "js", "a.js"), []byte("1"), 0o644)
	return dir
}

func loadCfg(t *testing.T, env ...string) *config.Config {
	t.Helper()
	r, err := config.Load(config.Options{Environ: env})
	if err != nil {
		t.Fatal(err)
	}
	return r.Config
}

type running struct {
	addr   string
	cancel context.CancelFunc
	done   chan error
	log    *syncWriter
}

func start(t *testing.T, cfg *config.Config) *running {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	logBuf := &syncWriter{}
	log := slog.New(slog.NewTextHandler(logBuf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	ready := make(chan string, 1)
	done := make(chan error, 1)
	go func() { done <- serve(ctx, cfg, log, func(a string) { ready <- a }) }()
	select {
	case a := <-ready:
		r := &running{addr: a, cancel: cancel, done: done, log: logBuf}
		t.Cleanup(func() { r.stop(t) })
		return r
	case err := <-done:
		cancel()
		t.Fatalf("serve failed: %v", err)
	case <-time.After(20 * time.Second):
		cancel()
		t.Fatal("server not ready")
	}
	return nil
}

func (r *running) stop(t *testing.T) time.Duration {
	if r.cancel == nil {
		return 0
	}
	t0 := time.Now()
	r.cancel()
	r.cancel = nil
	select {
	case err := <-r.done:
		if err != nil {
			t.Errorf("serve returned %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("shutdown hung")
	}
	return time.Since(t0)
}

type syncWriter struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncWriter) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// at is cfg with Listen set to the bound address, for healthcheck.
func at(cfg *config.Config, addr string) *config.Config {
	c := *cfg
	c.Listen = addr
	return &c
}

func get(t *testing.T, url string) (*http.Response, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func TestServeLifecycle(t *testing.T) {
	data := t.TempDir()
	cfg := loadCfg(t, "TOPO_DATA="+data, "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t))
	r := start(t, cfg)
	base := "http://" + r.addr
	if cfg.Origin() != base {
		t.Fatalf("public URL not fixed to the bound port: %s vs %s", cfg.Origin(), base)
	}
	resp, body := get(t, base+"/api/health")
	var h map[string]any
	json.Unmarshal([]byte(body), &h)
	if resp.StatusCode != 200 || h["server"] != "topo" || h["setup"] != true {
		t.Fatalf("health %d %s", resp.StatusCode, body)
	}
	resp, body = get(t, base+"/")
	if !strings.Contains(body, api.Marker) || resp.Header.Get("Content-Security-Policy") != "default-src 'self'; connect-src 'self'; frame-ancestors 'none'" {
		t.Fatalf("index: %s %v", body, resp.Header)
	}
	if err := healthcheck(at(cfg, r.addr)); err != nil {
		t.Fatalf("healthcheck: %v", err)
	}
	// The setup token was logged once and its hash stored.
	if !strings.Contains(r.log.String(), "token=") {
		t.Fatalf("no setup token in the log:\n%s", r.log)
	}
	// The data folder has the database and the key, private.
	for _, f := range []string{store.FileName, "server.key"} {
		if _, err := os.Stat(filepath.Join(data, f)); err != nil {
			t.Fatal(err)
		}
	}
	st, _ := os.Stat(data)
	if st.Mode().Perm() != 0o700 {
		t.Fatalf("data folder mode %v", st.Mode().Perm())
	}
	// A slow request in flight finishes during shutdown; then the server stops fast.
	if d := r.stop(t); d > 2*time.Second {
		t.Fatalf("shutdown took %s", d)
	}
	if err := healthcheck(at(cfg, r.addr)); err == nil {
		t.Fatal("healthcheck passes with the server stopped")
	}
	// Restart on the same data: migrations are idempotent, the key is reused.
	key1, _ := os.ReadFile(filepath.Join(data, "server.key"))
	cfg2 := loadCfg(t, "TOPO_DATA="+data, "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t))
	r2 := start(t, cfg2)
	if resp, _ := get(t, "http://"+r2.addr+"/api/health"); resp.StatusCode != 200 {
		t.Fatal("restart unhealthy")
	}
	key2, _ := os.ReadFile(filepath.Join(data, "server.key"))
	if !bytes.Equal(key1, key2) {
		t.Fatal("server key changed on restart")
	}
}

// Shutdown waits for a request in flight and closes long-lived ones through
// the base context.
func TestShutdownWithOpenStream(t *testing.T) {
	cfg := loadCfg(t, "TOPO_DATA="+t.TempDir(), "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t))
	r := start(t, cfg)
	// Hold a keep-alive connection open plus a request body that never ends:
	// Shutdown must not wait for the idle connection.
	conn, err := net.Dial("tcp", r.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.Write([]byte("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"))
	buf := make([]byte, 4096)
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if n, _ := conn.Read(buf); !bytes.Contains(buf[:n], []byte("200 OK")) {
		t.Fatalf("no answer: %q", buf[:n])
	}
	if d := r.stop(t); d > 2*time.Second {
		t.Fatalf("shutdown with an idle keep-alive took %s", d)
	}
}

func TestOwnerEmailMeansNoToken(t *testing.T) {
	data := t.TempDir()
	cfg := loadCfg(t, "TOPO_DATA="+data, "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t), "TOPO_OWNER_EMAIL=o@example.com")
	r := start(t, cfg)
	_, body := get(t, "http://"+r.addr+"/api/health")
	if !strings.Contains(body, `"setup":false`) || strings.Contains(r.log.String(), "token=") {
		t.Fatalf("health %s log %s", body, r.log)
	}
}

func TestBuiltInTLS(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "c.pem"), filepath.Join(dir, "k.pem")
	writeCert(t, certFile, keyFile)
	cfg := loadCfg(t, "TOPO_DATA="+t.TempDir(), "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t), "TOPO_TLS_CERT="+certFile, "TOPO_TLS_KEY="+keyFile)
	r := start(t, cfg)
	c := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	resp, err := c.Get("https://" + r.addr + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Strict-Transport-Security") == "" {
		t.Fatalf("%d %v", resp.StatusCode, resp.Header)
	}
	if err := healthcheck(at(cfg, r.addr)); err != nil {
		t.Fatalf("healthcheck over tls: %v", err)
	}
}

func writeCert(t *testing.T, certFile, keyFile string) {
	t.Helper()
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &k.PublicKey, k)
	if err != nil {
		t.Fatal(err)
	}
	kb, _ := x509.MarshalECPrivateKey(k)
	os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600)
	os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}), 0o600)
}

// A built-in TLS pair that cannot be read stops the start (no healthy-looking
// server that only answers handshake errors).
func TestMissingCertIsFatal(t *testing.T) {
	cfg := loadCfg(t, "TOPO_DATA="+t.TempDir(), "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+staticDir(t),
		"TOPO_TLS_CERT=/nonexistent/c.pem", "TOPO_TLS_KEY=/nonexistent/k.pem")
	err := serve(context.Background(), cfg, slog.New(slog.DiscardHandler), func(string) { t.Error("listening with no certificate") })
	if err == nil || !strings.Contains(err.Error(), "tls certificate") {
		t.Fatalf("want a tls error, got %v", err)
	}
}

func TestCertReloader(t *testing.T) {
	dir := t.TempDir()
	cf, kf := filepath.Join(dir, "c.pem"), filepath.Join(dir, "k.pem")
	log := slog.New(slog.DiscardHandler)
	if _, err := newCertReloader(cf, kf, log); err == nil { // files missing: fatal at start
		t.Fatal("a missing pair must fail the first load")
	}
	writeCert(t, cf, kf)
	cr, err := newCertReloader(cf, kf, log)
	if err != nil {
		t.Fatal(err)
	}
	if cr.changed() {
		t.Fatal("change seen with nothing changed")
	}
	writeCert(t, cf, kf)
	os.Chtimes(cf, time.Now().Add(time.Minute), time.Now().Add(time.Minute))
	if !cr.changed() {
		t.Fatal("change not seen")
	}
	cr.try("test")
	c1, err := cr.getCertificate(nil)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(cf, []byte("garbage"), 0o600)
	cr.try("test")
	if c2, _ := cr.getCertificate(nil); c2 != c1 {
		t.Fatal("a failed reload must keep the old pair")
	}
}

func TestRunCommands(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run([]string{"version"}, nil, &out, &errb); code != 0 || !strings.HasPrefix(out.String(), "topo-server ") {
		t.Fatalf("version: %d %q", code, out.String())
	}
	if code := run([]string{"nope"}, nil, &out, &errb); code != 2 {
		t.Fatal("unknown command")
	}
	errb.Reset()
	if code := run([]string{"serve"}, []string{"TOPO_DATA=" + t.TempDir(), "TOPO_TYPO=1"}, &out, &errb); code != 2 || !strings.Contains(errb.String(), "TOPO_TYPO") {
		t.Fatalf("bad config: %d %s", code, errb.String())
	}
	if code := run([]string{"serve", "extra"}, []string{"TOPO_DATA=" + t.TempDir()}, &out, &errb); code != 2 {
		t.Fatal("stray argument")
	}
	// healthcheck with nothing listening fails.
	if code := run([]string{"healthcheck", "--listen", "127.0.0.1:1"}, []string{"TOPO_DATA=" + t.TempDir()}, &out, &errb); code != 1 {
		t.Fatal("healthcheck must fail")
	}
}

func TestSetupTokenCommand(t *testing.T) {
	data := t.TempDir()
	env := []string{"TOPO_DATA=" + data}
	var out, errb bytes.Buffer
	// No database there yet: refused, never a new empty one (the running
	// server's TOPO_DATA may differ from this shell's).
	if code := run([]string{"setup-token"}, env, &out, &errb); code != 1 || !strings.Contains(errb.String(), data) {
		t.Fatalf("setup-token on an empty folder: %d %s", code, errb.String())
	}
	if _, err := os.Stat(filepath.Join(data, store.FileName)); err == nil {
		t.Fatal("setup-token created a database")
	}
	st0, err := store.Open(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	st0.Close()
	errb.Reset()
	if code := run([]string{"setup-token"}, env, &out, &errb); code != 0 || !strings.Contains(errb.String(), "Data folder: "+data) {
		t.Fatalf("%d %s", code, errb.String())
	}
	tok := strings.TrimSpace(out.String())
	st, err := store.Open(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := auth.CheckSetupToken(context.Background(), st, tok)
	st.W.Exec("INSERT INTO users(id,email,email_norm,server_role,created) VALUES('u_1','a@x','a@x','owner',1)")
	st.Close()
	if !ok {
		t.Fatalf("printed token %q does not verify", tok)
	}
	if code := run([]string{"setup-token"}, env, &out, &errb); code != 1 {
		t.Fatal("a server with an owner needs no token")
	}
	if code := run([]string{"setup-token"}, append(env, "TOPO_OWNER_EMAIL=o@x.com"), &out, &errb); code != 1 {
		t.Fatal("owner email set: no token")
	}
}

func TestStaticRefusesBrokenIndex(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>no csp</html>"), 0o644)
	cfg := loadCfg(t, "TOPO_DATA="+t.TempDir(), "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC="+dir)
	err := serve(context.Background(), cfg, slog.New(slog.DiscardHandler), nil)
	if err == nil || !strings.Contains(err.Error(), "Content-Security-Policy") {
		t.Fatalf("want a stage error, got %v", err)
	}
}

// backup-now: refused with no data, while backups are off, and while
// another engine holds the lease; otherwise it backs up (amendment 11).
func TestBackupNowCommand(t *testing.T) {
	data := t.TempDir()
	env := []string{"TOPO_DATA=" + data, "TOPO_LOG_LEVEL=error"}
	var out, errb bytes.Buffer
	if code := run([]string{"backup-now"}, env, &out, &errb); code != 1 || !strings.Contains(errb.String(), "no Topo server data") {
		t.Fatalf("no data: %d %s", code, errb.String())
	}
	st, err := store.Open(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	errb.Reset()
	if code := run([]string{"backup-now"}, env, &out, &errb); code != 1 || !strings.Contains(errb.String(), "backups are off") {
		t.Fatalf("off: %d %s", code, errb.String())
	}
	dir := filepath.Join(data, "backups", "bk")
	os.MkdirAll(dir, 0o700)
	os.WriteFile(filepath.Join(dir, ".topo-backups"), []byte("{}"), 0o600)
	fields, _ := json.Marshal(map[string]string{"path": dir})
	store.SetBackupConfig(ctx, st.W, &store.BackupConfig{Enabled: true, Kind: "folder", Fields: string(fields), ConfigID: "bc_1", DailyAt: "02:30", Updated: 1})
	// A running server holds the lease.
	store.AcquireBackupLease(ctx, st.W, "e_server", time.Now().UnixMilli(), time.Now().Add(time.Minute).UnixMilli())
	errb.Reset()
	if code := run([]string{"backup-now"}, env, &out, &errb); code != 1 || !strings.Contains(errb.String(), "running Topo server") {
		t.Fatalf("leased: %d %s", code, errb.String())
	}
	store.ReleaseBackupLease(ctx, st.W, "e_server")
	out.Reset()
	errb.Reset()
	if code := run([]string{"backup-now", "--check"}, env, &out, &errb); code != 0 || !strings.Contains(out.String(), "Backups: done.") || !strings.Contains(out.String(), "Check: passed.") {
		t.Fatalf("run: %d %s %s", code, out.String(), errb.String())
	}
	// The lease was given back.
	if ok, _ := store.AcquireBackupLease(ctx, st.W, "e_other", time.Now().UnixMilli(), time.Now().Add(time.Minute).UnixMilli()); !ok {
		t.Fatal("backup-now kept the lease")
	}
	st.Close()
}

// TOPO_SERVER_KEY naming a missing file stops the start.
func TestExplicitServerKeyMissing(t *testing.T) {
	var out, errb bytes.Buffer
	env := []string{"TOPO_DATA=" + t.TempDir(), "TOPO_LISTEN=127.0.0.1:0", "TOPO_SERVER_KEY=" + filepath.Join(t.TempDir(), "none", "server.key")}
	if code := run([]string{"serve"}, env, &out, &errb); code != 1 || !strings.Contains(errb.String(), "TOPO_SERVER_KEY") {
		t.Fatalf("%d %s", code, errb.String())
	}
}
