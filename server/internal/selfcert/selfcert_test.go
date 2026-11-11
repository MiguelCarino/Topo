package selfcert

import (
	"crypto/tls"
	"crypto/x509"
	"net/netip"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func addrs(s ...string) []netip.Addr {
	var out []netip.Addr
	for _, x := range s {
		out = append(out, netip.MustParseAddr(x))
	}
	return out
}

func TestFilterLAN(t *testing.T) {
	got := FilterLAN(addrs("127.0.0.1", "169.254.3.4", "fe80::1", "2001:db8::1", "100.64.1.2", "192.168.1.20", "10.0.0.5", "192.168.1.20", "0.0.0.0", "::ffff:172.16.0.9"))
	var s []string
	for _, a := range got {
		s = append(s, a.String())
	}
	if strings.Join(s, ",") != "10.0.0.5,172.16.0.9,192.168.1.20,100.64.1.2" {
		t.Fatalf("got %v", s)
	}
}

func TestDefaultNames(t *testing.T) {
	n := Default("Front-Desk", addrs("192.168.1.20"), "topo.lan", "192.168.1.20", "10.1.1.1", "")
	if strings.Join(n.DNS, ",") != "localhost,front-desk,front-desk.local,topo.lan" {
		t.Fatalf("dns %v", n.DNS)
	}
	var ips []string
	for _, a := range n.IPs {
		ips = append(ips, a.String())
	}
	if strings.Join(ips, ",") != "127.0.0.1,::1,192.168.1.20,10.1.1.1" {
		t.Fatalf("ips %v", ips)
	}
}

func TestEnsure(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "tls")
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	names := Default("pc1", addrs("192.168.1.20"))

	r1, err := Ensure(dir, names, now)
	if err != nil || !r1.Made || r1.Why != "no certificate yet" {
		t.Fatalf("first: %+v %v", r1, err)
	}
	pair, err := tls.LoadX509KeyPair(filepath.Join(dir, CertFile), filepath.Join(dir, KeyFile))
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := x509.ParseCertificate(pair.Certificate[0])
	if Fingerprint(leaf.Raw) != r1.Fingerprint || len(r1.Fingerprint) != 32*3-1 {
		t.Fatalf("fingerprint %s", r1.Fingerprint)
	}
	fp, _ := os.ReadFile(filepath.Join(dir, FingerprintFile))
	if strings.TrimSpace(string(fp)) != r1.Fingerprint {
		t.Fatalf("fingerprint file %q", fp)
	}
	// It verifies as its own root for every name it covers.
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	for _, h := range []string{"localhost", "pc1", "pc1.local", "192.168.1.20", "127.0.0.1", "::1"} {
		if _, err := leaf.Verify(x509.VerifyOptions{DNSName: h, Roots: pool, CurrentTime: now}); err != nil {
			t.Errorf("verify %s: %v", h, err)
		}
	}
	if _, err := leaf.Verify(x509.VerifyOptions{DNSName: "192.168.1.99", Roots: pool, CurrentTime: now}); err == nil {
		t.Error("an address it does not name verifies")
	}
	if got := leaf.NotAfter.Sub(now); got < Lifetime-time.Hour || got > Lifetime {
		t.Errorf("lifetime %s", got)
	}
	if runtime.GOOS != "windows" {
		st, _ := os.Stat(filepath.Join(dir, KeyFile))
		if st.Mode().Perm() != 0o600 {
			t.Errorf("key mode %v", st.Mode().Perm())
		}
		st, _ = os.Stat(dir)
		if st.Mode().Perm() != 0o700 {
			t.Errorf("folder mode %v", st.Mode().Perm())
		}
	}

	// Kept: same names, a day later.
	r2, err := Ensure(dir, names, now.Add(24*time.Hour))
	if err != nil || r2.Made || r2.Fingerprint != r1.Fingerprint {
		t.Fatalf("kept: %+v %v", r2, err)
	}
	// A subset is still covered.
	if r, _ := Ensure(dir, Default("pc1", nil), now); r.Made {
		t.Fatal("a subset made a new one")
	}
	// A new address: a new certificate.
	r3, err := Ensure(dir, Default("pc1", addrs("192.168.1.20", "10.0.0.7")), now)
	if err != nil || !r3.Made || r3.Why != "it does not cover 10.0.0.7" || r3.Fingerprint == r1.Fingerprint {
		t.Fatalf("new address: %+v %v", r3, err)
	}
	// Close to the end: renewed.
	r4, err := Ensure(dir, Default("pc1", addrs("10.0.0.7")), now.Add(Lifetime-10*24*time.Hour))
	if err != nil || !r4.Made || r4.Why != "it expires soon" {
		t.Fatalf("renew: %+v %v", r4, err)
	}
	// Broken files: made again.
	os.WriteFile(filepath.Join(dir, KeyFile), []byte("junk"), 0o600)
	r5, err := Ensure(dir, names, now)
	if err != nil || !r5.Made || r5.Why != "the files did not load" {
		t.Fatalf("broken: %+v %v", r5, err)
	}
	// A deleted fingerprint file comes back.
	os.Remove(filepath.Join(dir, FingerprintFile))
	if r, err := Ensure(dir, names, now); err != nil || r.Made {
		t.Fatalf("%+v %v", r, err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, FingerprintFile)); strings.TrimSpace(string(b)) != r5.Fingerprint {
		t.Fatalf("fingerprint file not restored: %q", b)
	}
}

// A WSL / Hyper-V / Docker / VPN address never comes before the real LAN
// card's, whatever its number.
func TestOrderLANVirtualLast(t *testing.T) {
	got := OrderLAN(addrs("192.168.1.20"), addrs("172.22.0.1", "10.8.0.3", "192.168.1.20"))
	if len(got) != 3 || got[0].String() != "192.168.1.20" || got[1].String() != "10.8.0.3" {
		t.Fatalf("%v", got)
	}
	for _, c := range []struct {
		name string
		mac  bool
		want bool
	}{
		{"eth0", true, false}, {"enp3s0", true, false}, {"wlan0", true, false}, {"Ethernet", true, false}, {"Wi-Fi", true, false}, {"en0", true, false},
		{"vEthernet (WSL)", true, true}, {"vEthernet (Default Switch)", true, true}, {"docker0", true, true}, {"br-1a2b", true, true},
		{"virbr0", true, true}, {"tailscale0", true, true}, {"wg0", true, true}, {"tun0", false, true}, {"VirtualBox Host-Only Network", true, true},
		{"vboxnet0", true, true}, {"utun3", false, true}, {"bridge100", true, true},
	} {
		if VirtualInterface(c.name, c.mac) != c.want {
			t.Errorf("%q: want virtual=%v", c.name, c.want)
		}
	}
}
