package tcrypto

import (
	"crypto/sha256"
	"strconv"
	"strings"
)

// RevHeader is the signed part of one encrypted revision (design §5.5).
type RevHeader struct {
	Site   string
	N      int64
	Base   int64
	Prev   string // h of base (the genesis hash for n = 1)
	Epoch  int64
	RSeq   int64 // the roster in force
	Author string
	Dev    string
	At     int64 // client-claimed ms
	CTHash string
}

// SignedString is S = ["topo-rev-v1", site, n, base, prev, epoch, rseq,
// author, dev, at, ctHash] joined by "\n". The AES-GCM AAD is S without its
// last line.
func (h *RevHeader) SignedString() string {
	return strings.Join([]string{"topo-rev-v1", h.Site, i64(h.N), i64(h.Base), h.Prev, i64(h.Epoch), i64(h.RSeq),
		h.Author, h.Dev, i64(h.At), h.CTHash}, "\n")
}

// AAD is the additional data the ciphertext is bound to.
func (h *RevHeader) AAD() string {
	s := h.SignedString()
	return s[:strings.LastIndexByte(s, '\n')]
}

// ChainHash is h_n = b64u(SHA-256(S + "\n" + sig_b64u)).
func ChainHash(signed, sigB64 string) string {
	sum := sha256.Sum256([]byte(signed + "\n" + sigB64))
	return B64.EncodeToString(sum[:])
}

// Genesis is h_0 = b64u(SHA-256("topo-genesis-v1\n" + site)).
func Genesis(site string) string {
	sum := sha256.Sum256([]byte("topo-genesis-v1\n" + site))
	return B64.EncodeToString(sum[:])
}

// CTHash is b64u(SHA-256(iv || ct)).
func CTHash(iv, ct []byte) string {
	h := sha256.New()
	h.Write(iv)
	h.Write(ct)
	return B64.EncodeToString(h.Sum(nil))
}

func i64(n int64) string { return strconv.FormatInt(n, 10) }
