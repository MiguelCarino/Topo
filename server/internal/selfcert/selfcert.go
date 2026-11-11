// Package selfcert makes and keeps the self-signed certificate of a Topo
// server on a PC (TOPO_TLS_SELF, D113): the desktop app's "other PCs on this
// network" option. Browsers allow the encryption Topo needs only over https
// (D52), and a PC on a LAN has no public name to get a real certificate for,
// so the server signs its own. Each other PC accepts it once (or trusts it),
// after comparing the fingerprint the desktop app shows.
//
// The certificate covers every address a person may type: localhost,
// 127.0.0.1, ::1, the PC's name, every non-loopback IPv4 address of the PC
// (not only the one a route picks, which is a VPN when one is up) and the
// public URL's host. It is made again when one of them is not covered (the
// PC got a new address), when it expires within 30 days, or when the files
// do not load.
package selfcert

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"carino.systems/topo/server/internal/platform"
)

// Lifetime is how long a certificate is valid: 825 days, the most Apple's
// platforms accept for a trusted server certificate.
const Lifetime = 825 * 24 * time.Hour

// renewBefore makes a new certificate this long before the old one expires.
const renewBefore = 30 * 24 * time.Hour

// File names inside the folder.
const (
	CertFile        = "cert.pem"
	KeyFile         = "key.pem"
	FingerprintFile = "cert.sha256"
)

// Names are what the certificate must cover.
type Names struct {
	DNS []string
	IPs []netip.Addr
}

// Result says what Ensure found or made.
type Result struct {
	Fingerprint string // SHA-256 of the certificate, AB:CD:… as browsers show it
	Made        bool   // a new certificate was written
	Why         string // why it was made ("" when kept)
	NotAfter    time.Time
}

// LANAddresses lists the PC's IPv4 addresses that other PCs could reach:
// interfaces that are up, not loopback, not link-local (169.254/16).
// Sorted, private ranges first.
func LANAddresses() []netip.Addr {
	ifs, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var real, virt []netip.Addr
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ad, ok := netip.AddrFromSlice(ip); ok {
				if VirtualInterface(ifc.Name, len(ifc.HardwareAddr) > 0) {
					virt = append(virt, ad.Unmap())
				} else {
					real = append(real, ad.Unmap())
				}
			}
		}
	}
	return OrderLAN(real, virt)
}

// OrderLAN lists the addresses of real network cards before those of
// virtual adapters, each part as FilterLAN orders it, so the first is the
// one to give people (not a WSL, Hyper-V, Docker or VPN address).
func OrderLAN(real, virt []netip.Addr) []netip.Addr {
	out := FilterLAN(real)
	seen := map[netip.Addr]bool{}
	for _, a := range out {
		seen[a] = true
	}
	for _, a := range FilterLAN(virt) {
		if !seen[a] {
			out = append(out, a)
		}
	}
	return out
}

// virtualPrefixes are interface names of virtual adapters (lower case):
// containers, VMs, WSL/Hyper-V, VPNs and tunnels.
var virtualPrefixes = []string{"docker", "br-", "virbr", "veth", "vethernet", "vmnet", "vboxnet", "vnic", "tun", "tap", "wg", "zt",
	"tailscale", "utun", "lxc", "lxd", "cni", "flannel", "cali", "podman", "awdl", "llw", "bridge", "ham", "nordlynx", "proton", "ipsec", "ppp"}

// VirtualInterface reports a virtual adapter by its name (or, for a
// tunnel, by having no hardware address).
func VirtualInterface(name string, hasMAC bool) bool {
	n := strings.ToLower(name)
	if !hasMAC {
		return true
	}
	for _, p := range virtualPrefixes {
		if strings.HasPrefix(n, p) {
			return true
		}
	}
	for _, w := range []string{"virtual", "hyper-v", "vmware", "virtualbox", "wsl", "vpn", "loopback", "tunnel"} {
		if strings.Contains(n, w) {
			return true
		}
	}
	return false
}

// FilterLAN keeps the IPv4 addresses worth offering, without duplicates,
// private ranges first.
func FilterLAN(in []netip.Addr) []netip.Addr {
	seen := map[netip.Addr]bool{}
	var out []netip.Addr
	for _, a := range in {
		a = a.Unmap()
		if !a.Is4() || a.IsLoopback() || a.IsLinkLocalUnicast() || a.IsUnspecified() || a.IsMulticast() || seen[a] {
			continue
		}
		seen[a] = true
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool {
		pi, pj := out[i].IsPrivate(), out[j].IsPrivate()
		if pi != pj {
			return pi
		}
		return out[i].Less(out[j])
	})
	return out
}

// Default is what a server on this PC covers: localhost, the loopback
// addresses, the PC's name (and name.local for mDNS), its LAN addresses,
// plus extra host names or addresses (the public URL's host,
// TOPO_ALLOWED_HOSTS).
func Default(hostname string, lan []netip.Addr, extra ...string) Names {
	n := Names{DNS: []string{"localhost"}, IPs: []netip.Addr{netip.MustParseAddr("127.0.0.1"), netip.MustParseAddr("::1")}}
	add := func(h string) {
		h = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(h), "."))
		if h == "" {
			return
		}
		if ip, err := netip.ParseAddr(strings.Trim(h, "[]")); err == nil {
			n.IPs = append(n.IPs, ip.Unmap())
			return
		}
		n.DNS = append(n.DNS, h)
	}
	if hostname != "" {
		add(hostname)
		if !strings.Contains(hostname, ".") {
			add(hostname + ".local")
		}
	}
	for _, a := range lan {
		n.IPs = append(n.IPs, a)
	}
	for _, e := range extra {
		add(e)
	}
	return n.clean()
}

func (n Names) clean() Names {
	ds := map[string]bool{}
	var dns []string
	for _, d := range n.DNS {
		if !ds[d] {
			ds[d] = true
			dns = append(dns, d)
		}
	}
	is := map[netip.Addr]bool{}
	var ips []netip.Addr
	for _, a := range n.IPs {
		if !is[a] {
			is[a] = true
			ips = append(ips, a)
		}
	}
	return Names{DNS: dns, IPs: ips}
}

// Ensure keeps the certificate in dir when it loads, covers names and is
// valid for 30 more days; otherwise it makes a new one (key 0600, folder
// 0700) and writes its fingerprint beside it.
func Ensure(dir string, names Names, now time.Time) (Result, error) {
	names = names.clean()
	certPath, keyPath := filepath.Join(dir, CertFile), filepath.Join(dir, KeyFile)
	why := ""
	if pair, err := tls.LoadX509KeyPair(certPath, keyPath); err != nil {
		why = "no certificate yet"
		if _, serr := os.Stat(certPath); serr == nil {
			why = "the files did not load"
		}
	} else {
		leaf, err := x509.ParseCertificate(pair.Certificate[0])
		switch {
		case err != nil:
			why = "the certificate did not parse"
		case now.Add(renewBefore).After(leaf.NotAfter):
			why = "it expires soon"
		default:
			if miss := missing(leaf, names); miss != "" {
				why = "it does not cover " + miss
			} else {
				fp := Fingerprint(leaf.Raw)
				// The fingerprint file follows the certificate (an older one,
				// or one deleted by hand).
				if b, _ := os.ReadFile(filepath.Join(dir, FingerprintFile)); strings.TrimSpace(string(b)) != fp {
					if err := os.WriteFile(filepath.Join(dir, FingerprintFile), []byte(fp+"\n"), 0o644); err != nil {
						return Result{}, err
					}
				}
				return Result{Fingerprint: fp, NotAfter: leaf.NotAfter}, nil
			}
		}
	}
	if err := platform.EnsureDir(dir); err != nil {
		return Result{}, err
	}
	der, keyDER, notAfter, err := make1(names, now)
	if err != nil {
		return Result{}, err
	}
	if err := platform.WritePrivate(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})); err != nil {
		return Result{}, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := writeAtomic(certPath, certPEM); err != nil {
		return Result{}, err
	}
	fp := Fingerprint(der)
	if err := os.WriteFile(filepath.Join(dir, FingerprintFile), []byte(fp+"\n"), 0o644); err != nil {
		return Result{}, err
	}
	return Result{Fingerprint: fp, Made: true, Why: why, NotAfter: notAfter}, nil
}

// writeAtomic is WritePrivate then a readable mode: the certificate is
// public (every browser gets it), and readable lets a person copy it to
// trust it on another PC.
func writeAtomic(path string, b []byte) error {
	if err := platform.WritePrivate(path, b); err != nil {
		return err
	}
	return os.Chmod(path, 0o644)
}

// missing names the first host or address the certificate does not cover.
func missing(leaf *x509.Certificate, n Names) string {
	have := map[string]bool{}
	for _, d := range leaf.DNSNames {
		have[strings.ToLower(d)] = true
	}
	for _, d := range n.DNS {
		if !have[d] {
			return d
		}
	}
	for _, a := range n.IPs {
		found := false
		for _, ip := range leaf.IPAddresses {
			if b, ok := netip.AddrFromSlice(ip); ok && b.Unmap() == a {
				found = true
				break
			}
		}
		if !found {
			return a.String()
		}
	}
	return ""
}

func make1(n Names, now time.Time) (der, keyDER []byte, notAfter time.Time, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, time.Time{}, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	if err != nil {
		return nil, nil, time.Time{}, err
	}
	cn := "Topo server"
	for _, d := range n.DNS {
		if d != "localhost" {
			cn = "Topo server (" + d + ")"
			break
		}
	}
	notAfter = now.Add(Lifetime).UTC().Truncate(time.Second)
	tpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: cn, Organization: []string{"Topo"}},
		NotBefore:             now.Add(-time.Hour).UTC().Truncate(time.Second),
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              n.DNS,
	}
	for _, a := range n.IPs {
		tpl.IPAddresses = append(tpl.IPAddresses, net.IP(a.AsSlice()))
	}
	der, err = x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, time.Time{}, err
	}
	keyDER, err = x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, nil, time.Time{}, err
	}
	return der, keyDER, notAfter, nil
}

// Fingerprint is the SHA-256 of a DER certificate as browsers show it
// (upper-case hex pairs joined by colons).
func Fingerprint(der []byte) string {
	sum := sha256.Sum256(der)
	var b bytes.Buffer
	for i, c := range sum {
		if i > 0 {
			b.WriteByte(':')
		}
		fmt.Fprintf(&b, "%02X", c)
	}
	return b.String()
}
