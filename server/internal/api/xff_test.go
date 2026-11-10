package api

import (
	"bytes"
	"log/slog"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"carino.systems/topo/server/internal/config"
)

// X-Forwarded-For from a peer outside TOPO_TRUSTED_PROXIES is ignored and
// logged once, naming the peer (a container's forwarded port shows a bridge
// address, not 127.0.0.1).
func TestUntrustedForwardedForWarnsOnce(t *testing.T) {
	r, err := config.Load(config.Options{Environ: []string{"TOPO_DATA=" + t.TempDir(), "TOPO_TRUSTED_PROXIES=127.0.0.1/32"}})
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	s := New(Deps{Cfg: r.Config, Log: slog.New(slog.NewTextHandler(&buf, nil)), App: &App{}})
	req := func(peer string) *netip.Addr {
		q := httptest.NewRequest("POST", "/api/auth/request", nil)
		q.RemoteAddr = peer
		q.Header.Set("X-Forwarded-For", "203.0.113.9")
		a := s.clientIP(q)
		return &a
	}
	if a := req("10.88.0.1:5000"); a.String() != "10.88.0.1" {
		t.Fatalf("untrusted peer: %s", a)
	}
	req("10.88.0.1:5001")
	if n := strings.Count(buf.String(), "X-Forwarded-For"); n != 1 || !strings.Contains(buf.String(), "peer=10.88.0.1") {
		t.Fatalf("want one warning naming the peer, got %q", buf.String())
	}
	if a := req("127.0.0.1:5000"); a.String() != "203.0.113.9" {
		t.Fatalf("trusted proxy: %s", a)
	}
}
