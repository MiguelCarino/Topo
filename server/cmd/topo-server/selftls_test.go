package main

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/selfcert"
)

// TOPO_TLS_SELF (D113): the server makes its own certificate at the first
// start, serves https with it, logs the fingerprint, and keeps it at the
// next start.
func TestSelfSignedTLS(t *testing.T) {
	data := t.TempDir()
	env := []string{"TOPO_DATA=" + data, "TOPO_LISTEN=127.0.0.1:0", "TOPO_STATIC=" + staticDir(t), "TOPO_TLS_SELF=1", "TOPO_MAIL=log"}
	cfg := loadCfg(t, env...)
	if !cfg.TLSSelf || cfg.TLSCert != filepath.Join(data, "tls", "cert.pem") || !cfg.Secure() || cfg.PublicURL.Scheme != "https" {
		t.Fatalf("config: %+v %s", cfg, cfg.PublicURL)
	}
	r := start(t, cfg)
	fp, err := os.ReadFile(filepath.Join(data, "tls", selfcert.FingerprintFile))
	if err != nil {
		t.Fatal(err)
	}
	want := strings.TrimSpace(string(fp))
	if !strings.Contains(r.log.String(), "made a self-signed certificate") || !strings.Contains(r.log.String(), want) {
		t.Fatalf("log: %s", r.log.String())
	}
	// The served certificate is the one on disk, and verifies for 127.0.0.1
	// when trusted (what "trust the certificate" on another PC does).
	var seen *x509.Certificate
	c := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true,
		VerifyConnection: func(cs tls.ConnectionState) error { seen = cs.PeerCertificates[0]; return nil }}}}
	resp, err := c.Get("https://" + r.addr + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 || seen == nil || selfcert.Fingerprint(seen.Raw) != want {
		t.Fatalf("%d %v", resp.StatusCode, seen)
	}
	pool := x509.NewCertPool()
	pool.AddCert(seen)
	trusted := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}}
	resp, err = trusted.Get("https://" + r.addr + "/api/health")
	if err != nil {
		t.Fatalf("trusted: %v", err)
	}
	resp.Body.Close()
	for _, a := range selfcert.LANAddresses() {
		if _, err := seen.Verify(x509.VerifyOptions{DNSName: a.String(), Roots: pool}); err != nil {
			t.Errorf("LAN address %s not covered: %v", a, err)
		}
	}
	r.stop(t)

	// The second start keeps it.
	r2 := start(t, loadCfg(t, env...))
	if strings.Contains(r2.log.String(), "made a self-signed certificate") || !strings.Contains(r2.log.String(), want) {
		t.Fatalf("second start: %s", r2.log.String())
	}
}

func TestSelfSignedTLSConfig(t *testing.T) {
	for _, bad := range [][]string{
		{"TOPO_TLS_SELF=1", "TOPO_TLS_CERT=/c", "TOPO_TLS_KEY=/k"},
		{"TOPO_TLS_SELF=maybe"},
		// A LAN listen needs its https address.
		{"TOPO_TLS_SELF=1", "TOPO_LISTEN=0.0.0.0:7380"},
		{"TOPO_TLS_SELF=1", "TOPO_LISTEN=0.0.0.0:7380", "TOPO_PUBLIC_URL=http://192.168.1.20:7380"},
	} {
		if _, err := config.Load(config.Options{Environ: append([]string{"TOPO_DATA=" + t.TempDir()}, bad...)}); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
	r, err := config.Load(config.Options{Environ: []string{"TOPO_DATA=" + t.TempDir(), "TOPO_TLS_SELF=1", "TOPO_LISTEN=0.0.0.0:7380", "TOPO_PUBLIC_URL=https://192.168.1.20:7380", "TOPO_MAIL=log"}})
	if err != nil || !r.Config.TLSSelf {
		t.Fatalf("%v", err)
	}
	if r, err := config.Load(config.Options{Environ: []string{"TOPO_DATA=" + t.TempDir(), "TOPO_TLS_SELF=0"}}); err != nil || r.Config.TLSSelf || r.Config.TLSCert != "" {
		t.Fatalf("off: %v", err)
	}
}

func TestLANAddressesAndServiceCommands(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run([]string{"lan-addresses"}, nil, &out, &errb); code != 0 {
		t.Fatalf("lan-addresses: %d %s", code, errb.String())
	}
	for _, line := range strings.Fields(out.String()) {
		a, err := netip.ParseAddr(line)
		if err != nil || !a.Is4() || a.IsLoopback() {
			t.Errorf("not a LAN address: %q", line)
		}
	}
	errb.Reset()
	// `service` with nothing to do says how to use it (the service
	// commands themselves are in service_test.go).
	if code := run([]string{"service"}, nil, &out, &errb); code != 2 || !strings.Contains(errb.String(), "usage: topo-server service") {
		t.Fatalf("service without a verb: %d %s", code, errb.String())
	}
}

// The Windows service's data folder and first settings file (the service
// itself is build-tested only).
func TestServiceDefaults(t *testing.T) {
	if got := config.DefaultDataDir("windows-service", "", map[string]string{"ProgramData": `C:\ProgramData`}); got != filepath.Join(`C:\ProgramData`, "Topo") {
		t.Fatalf("data dir %s", got)
	}
	r, err := config.Load(config.Options{GOOS: "windows", Service: true, Home: "/h", Environ: []string{"ProgramData=/pd", "LOCALAPPDATA=/la"}})
	if err != nil || r.Config.DataDir != filepath.Join("/pd", "Topo") {
		t.Fatalf("%v %v", err, r)
	}
	r, err = config.Load(config.Options{GOOS: "windows", Home: "/h", Environ: []string{"ProgramData=/pd", "LOCALAPPDATA=/la"}})
	if err != nil || r.Config.DataDir != filepath.Join("/la", "Topo") {
		t.Fatalf("not a service: %v %v", err, r)
	}
	// The MSI ships the same first settings file as `service install` writes.
	if b, err := os.ReadFile(filepath.Join("..", "..", "packaging", "windows", "topo.conf")); err != nil || string(b) != serviceConfTemplate {
		t.Fatalf("packaging/windows/topo.conf differs from serviceConfTemplate: %v", err)
	}
	// The template loads as a settings file and sets nothing.
	f := filepath.Join(t.TempDir(), "topo.conf")
	os.WriteFile(f, []byte(strings.ReplaceAll(serviceConfTemplate, "\n", "\r\n")), 0o600)
	vals, _, err := config.ReadFile(f)
	if err != nil || len(vals) != 0 {
		t.Fatalf("template: %v %v", err, vals)
	}
	for _, k := range strings.Fields(serviceConfTemplate) {
		if name, _, ok := strings.Cut(strings.TrimPrefix(k, "#"), "="); ok && strings.HasPrefix(name, "TOPO_") {
			if _, err := config.Load(config.Options{Environ: []string{"TOPO_DATA=" + t.TempDir(), name + "=x"}}); err != nil && strings.Contains(err.Error(), "unknown setting") {
				t.Errorf("template names an unknown key %s", name)
			}
		}
	}
}
