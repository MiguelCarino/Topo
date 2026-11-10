package tcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type vecPerson struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	EncPub   string `json:"encPub"`
	SigPub   string `json:"sigPub"`
	EncFp    string `json:"encFp"`
	SigFp    string `json:"sigFp"`
	EncPkcs8 string `json:"encPkcs8"`
}

type vecRev struct {
	Rev struct {
		N      int64  `json:"n"`
		Base   int64  `json:"base"`
		Prev   string `json:"prev"`
		Epoch  int64  `json:"epoch"`
		RSeq   int64  `json:"rseq"`
		Author string `json:"author"`
		Dev    string `json:"dev"`
		At     int64  `json:"at"`
		CTHash string `json:"ctHash"`
		Sig    string `json:"sig"`
		IV     string `json:"iv"`
		CT     string `json:"ct"`
	} `json:"rev"`
	Signed    string `json:"signed"`
	H         string `json:"h"`
	Plaintext string `json:"plaintext"`
}

type vectors struct {
	Site     string    `json:"site"`
	Genesis  string    `json:"genesis"`
	Owner    vecPerson `json:"owner"`
	Provider vecPerson `json:"provider"`
	Device   struct {
		ID    string `json:"id"`
		Pub   string `json:"pub"`
		FP    string `json:"fp"`
		Pkcs8 string `json:"pkcs8"`
	} `json:"device"`
	Rosters []struct {
		Roster    json.RawMessage `json:"roster"`
		Canonical string          `json:"canonical"`
	} `json:"rosters"`
	SiteKey    string          `json:"siteKey"`
	SiteWrap   json.RawMessage `json:"siteWrap"`
	DeviceWrap json.RawMessage `json:"deviceWrap"`
	Bundle     string          `json:"bundle"`
	Revs       []vecRev        `json:"revs"`
}

func load(t *testing.T) *vectors {
	t.Helper()
	b, err := os.ReadFile("testdata/webcrypto_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return &v
}

func mustB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := DecodeB64(s)
	if err != nil {
		t.Fatalf("b64 %q: %v", s, err)
	}
	return b
}

func TestVectorFingerprintsAndGenesis(t *testing.T) {
	v := load(t)
	for _, p := range []vecPerson{v.Owner, v.Provider} {
		if FingerprintB64(p.EncPub) != p.EncFp || FingerprintB64(p.SigPub) != p.SigFp {
			t.Fatalf("fingerprint mismatch for %s", p.Email)
		}
		if _, _, err := ParseRawP256(p.EncPub); err != nil {
			t.Fatal(err)
		}
	}
	if FingerprintB64(v.Device.Pub) != v.Device.FP {
		t.Fatal("device fp")
	}
	if Genesis(v.Site) != v.Genesis {
		t.Fatal("genesis")
	}
}

func TestVectorRosters(t *testing.T) {
	v := load(t)
	for i, r := range v.Rosters {
		ro, err := ParseRoster(r.Roster)
		if err != nil {
			t.Fatalf("roster %d: %v", i, err)
		}
		if ro.Canonical() != r.Canonical {
			t.Fatalf("roster %d canonical:\n%s\nwant\n%s", i, ro.Canonical(), r.Canonical)
		}
		if err := ro.Verify(v.Owner.SigPub); err != nil {
			t.Fatalf("roster %d: %v", i, err)
		}
		if ro.Verify(v.Provider.SigPub) == nil {
			t.Fatal("verified with the wrong key")
		}
		// A changed role, member or seq fails.
		for _, mut := range []func(*Roster){
			func(x *Roster) { x.Seq++ },
			func(x *Roster) { x.Epoch++ },
			func(x *Roster) { x.Members[len(x.Members)-1].Role = "viewer" },
			func(x *Roster) { x.Members[0].Enc = strings.Repeat("A", 22) },
			func(x *Roster) { x.By = x.Members[0].U[:len(x.Members[0].U)-1] + "Z" },
		} {
			c, _ := ParseRoster(r.Roster)
			mut(c)
			if c.Verify(v.Owner.SigPub) == nil {
				t.Fatalf("roster %d: a tampered roster verified", i)
			}
		}
	}
}

func unwrapGo(t *testing.T, w *Wrap, pkcs8B64 string) []byte {
	t.Helper()
	k, err := x509.ParsePKCS8PrivateKey(mustB64(t, pkcs8B64))
	if err != nil {
		t.Fatal(err)
	}
	priv, err := k.(*ecdsa.PrivateKey).ECDH()
	if err != nil {
		t.Fatal(err)
	}
	epk, err := ecdh.P256().NewPublicKey(mustB64(t, w.EPK))
	if err != nil {
		t.Fatal(err)
	}
	z, err := priv.ECDH(epk)
	if err != nil {
		t.Fatal(err)
	}
	key, err := hkdf.Key(sha256.New, z, mustB64(t, w.Salt), "topo/v1/wrap\n"+w.Ctx, 32)
	if err != nil {
		t.Fatal(err)
	}
	blk, _ := aes.NewCipher(key)
	g, _ := cipher.NewGCM(blk)
	pt, err := g.Open(nil, mustB64(t, w.IV), mustB64(t, w.CT), []byte(w.Header()))
	if err != nil {
		t.Fatalf("unwrap: %v", err)
	}
	return pt
}

func TestVectorWraps(t *testing.T) {
	v := load(t)
	w, err := ParseWrap(v.SiteWrap, SiteKeyCT, SiteKeyCT)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.Check(SiteCtx(v.Site, 1, v.Provider.ID), v.Provider.EncPub, v.Owner.ID, v.Owner.SigPub); err != nil {
		t.Fatal(err)
	}
	if got := unwrapGo(t, w, v.Provider.EncPkcs8); B64.EncodeToString(got) != v.SiteKey {
		t.Fatal("site key differs")
	}
	// Wrong ctx, recipient, signer, or a tampered field: refused.
	if w.Check(SiteCtx(v.Site, 2, v.Provider.ID), v.Provider.EncPub, v.Owner.ID, v.Owner.SigPub) == nil ||
		w.Check(SiteCtx(v.Site, 1, v.Provider.ID), v.Owner.EncPub, v.Owner.ID, v.Owner.SigPub) == nil ||
		w.Check(SiteCtx(v.Site, 1, v.Provider.ID), v.Provider.EncPub, v.Provider.ID, v.Provider.SigPub) == nil {
		t.Fatal("a wrong expectation passed")
	}
	for _, field := range []string{"salt", "iv", "ct", "epk"} {
		var m map[string]any
		json.Unmarshal(v.SiteWrap, &m)
		s := m[field].(string)
		b := mustB64(t, s)
		b[len(b)/2] ^= 1
		m[field] = B64.EncodeToString(b)
		raw, _ := json.Marshal(m)
		tw, err := ParseWrap(raw, SiteKeyCT, SiteKeyCT)
		if err != nil {
			continue // an epk off the curve is refused at parse time
		}
		if tw.Check(SiteCtx(v.Site, 1, v.Provider.ID), v.Provider.EncPub, v.Owner.ID, v.Owner.SigPub) == nil {
			t.Fatalf("tampered %s passed", field)
		}
	}

	dw, err := ParseWrap(v.DeviceWrap, 1, MaxBundleCT)
	if err != nil {
		t.Fatal(err)
	}
	if err := dw.Check(DeviceCtx(v.Provider.ID, v.Device.ID), v.Device.Pub, v.Provider.ID, v.Provider.SigPub); err != nil {
		t.Fatal(err)
	}
	if got := unwrapGo(t, dw, v.Device.Pkcs8); B64.EncodeToString(got) != v.Bundle {
		t.Fatal("bundle differs")
	}
}

func TestVectorRevisionChain(t *testing.T) {
	v := load(t)
	prev := v.Genesis
	key := mustB64(t, v.SiteKey)
	pubs := map[string]string{v.Owner.ID: v.Owner.SigPub, v.Provider.ID: v.Provider.SigPub}
	for _, r := range v.Revs {
		x := r.Rev
		iv, ct := mustB64(t, x.IV), mustB64(t, x.CT)
		h := &RevHeader{Site: v.Site, N: x.N, Base: x.Base, Prev: x.Prev, Epoch: x.Epoch, RSeq: x.RSeq, Author: x.Author, Dev: x.Dev, At: x.At, CTHash: x.CTHash}
		if x.Prev != prev {
			t.Fatalf("rev %d does not link", x.N)
		}
		if h.SignedString() != r.Signed {
			t.Fatalf("rev %d signed string differs", x.N)
		}
		if CTHash(iv, ct) != x.CTHash {
			t.Fatalf("rev %d ctHash", x.N)
		}
		if err := VerifyB64(pubs[x.Author], []byte(h.SignedString()), x.Sig); err != nil {
			t.Fatalf("rev %d: %v", x.N, err)
		}
		if ChainHash(h.SignedString(), x.Sig) != r.H {
			t.Fatalf("rev %d chain hash", x.N)
		}
		blk, _ := aes.NewCipher(key)
		g, _ := cipher.NewGCM(blk)
		pt, err := g.Open(nil, iv, ct, []byte(h.AAD()))
		if err != nil || B64.EncodeToString(pt) != r.Plaintext {
			t.Fatalf("rev %d decrypt: %v", x.N, err)
		}
		// Each signed field, changed, breaks the signature.
		for i := range 10 {
			c := *h
			switch i {
			case 0:
				c.Site += "x"
			case 1:
				c.N++
			case 2:
				c.Base++
			case 3:
				c.Prev = Genesis("other")
			case 4:
				c.Epoch++
			case 5:
				c.RSeq++
			case 6:
				c.Author += "x"
			case 7:
				c.Dev += "x"
			case 8:
				c.At++
			case 9:
				c.CTHash = CTHash(iv, append([]byte{0}, ct...))
			}
			if VerifyB64(pubs[x.Author], []byte(c.SignedString()), x.Sig) == nil {
				t.Fatalf("rev %d: field %d tampered and still verified", x.N, i)
			}
		}
		prev = r.H
	}
}

func TestSignP1363RoundTrip(t *testing.T) {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	sig := SignP1363(k, []byte("hello"))
	if err := VerifyB64(RawPublic(&k.PublicKey), []byte("hello"), B64.EncodeToString(sig)); err != nil {
		t.Fatal(err)
	}
	if VerifyB64(RawPublic(&k.PublicKey), []byte("hellp"), B64.EncodeToString(sig)) == nil {
		t.Fatal("wrong message verified")
	}
}

func TestParseRejects(t *testing.T) {
	if _, _, err := ParseRawP256(B64.EncodeToString(make([]byte, 65))); err == nil {
		t.Fatal("point off the curve accepted")
	}
	if _, err := ParseRoster([]byte(`{"v":1}`)); err == nil {
		t.Fatal("empty roster accepted")
	}
	if _, err := ParseWrap([]byte(`{"v":2}`), 1, 10); err == nil {
		t.Fatal("bad wrap accepted")
	}
	if ValidSiteID("s_short") || !ValidSiteID("s_"+strings.Repeat("a", 22)) {
		t.Fatal("site id shape")
	}
}
