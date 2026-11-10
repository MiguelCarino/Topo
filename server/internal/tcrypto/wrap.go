package tcrypto

import (
	"crypto/sha256"
	"encoding/json"
	"strconv"
	"strings"
)

// WrapAlg is the only wrap algorithm: ECDH P-256, HKDF-SHA256, AES-GCM-256.
const WrapAlg = "P256-HKDF256-A256GCM"

// Wrap is a key encrypted to one public key (design §5.3 with amendment A4:
// `by` and `salt` are inside the signed, authenticated header).
type Wrap struct {
	V    int     `json:"v"`
	Alg  string  `json:"alg"`
	To   string  `json:"to"`  // fingerprint of the recipient's public key
	Ctx  string  `json:"ctx"` // user:<u>|dev:<d> or site:<s>|epoch:<e>|user:<u>
	EPK  string  `json:"epk"` // ephemeral public key, raw 65 bytes
	Salt string  `json:"salt"`
	IV   string  `json:"iv"`
	CT   string  `json:"ct"`
	By   *string `json:"by"`
	Sig  *string `json:"sig"`
}

// Size limits for a wrap's ciphertext: a site key is 32 bytes plus the
// 16-byte tag; a user bundle (two pkcs8 keys in JSON) stays well under 4 KiB.
const (
	SiteKeyCT   = 48
	MaxBundleCT = 4096
)

// DeviceCtx is the wrap context of a user bundle wrapped to a device.
func DeviceCtx(user, dev string) string { return "user:" + user + "|dev:" + dev }

// SiteCtx is the wrap context of a site key for one member and epoch.
func SiteCtx(site string, epoch int64, user string) string {
	return "site:" + site + "|epoch:" + strconv.FormatInt(epoch, 10) + "|user:" + user
}

// Header is ["topo-wrap-v1", ctx, to, epk, salt, by ?? ""] joined by "\n":
// the AES-GCM AAD and the signed prefix.
func (w *Wrap) Header() string {
	by := ""
	if w.By != nil {
		by = *w.By
	}
	return strings.Join([]string{"topo-wrap-v1", w.Ctx, w.To, w.EPK, w.Salt, by}, "\n")
}

// SignedString is the header plus "\n" + b64u(SHA-256(iv || ct)).
func (w *Wrap) SignedString() string {
	iv, _ := DecodeB64(w.IV)
	ct, _ := DecodeB64(w.CT)
	sum := sha256.New()
	sum.Write(iv)
	sum.Write(ct)
	return w.Header() + "\n" + B64.EncodeToString(sum.Sum(nil))
}

// ParseWrap decodes and shape-checks a wrap whose ciphertext is between
// minCT and maxCT bytes.
func ParseWrap(raw []byte, minCT, maxCT int) (*Wrap, error) {
	var w Wrap
	if err := json.Unmarshal(raw, &w); err != nil {
		return nil, ErrShape
	}
	if w.V != 1 || w.Alg != WrapAlg || !ValidFingerprint(w.To) || w.Ctx == "" || len(w.Ctx) > 200 || strings.ContainsAny(w.Ctx, "\n\r") {
		return nil, ErrShape
	}
	if _, _, err := ParseRawP256(w.EPK); err != nil {
		return nil, ErrShape
	}
	if b, err := DecodeB64(w.Salt); err != nil || len(b) != 16 {
		return nil, ErrShape
	}
	if b, err := DecodeB64(w.IV); err != nil || len(b) != 12 {
		return nil, ErrShape
	}
	if b, err := DecodeB64(w.CT); err != nil || len(b) < minCT || len(b) > maxCT {
		return nil, ErrShape
	}
	if w.By != nil && (strings.ContainsAny(*w.By, "\n\r") || len(*w.By) > 64) {
		return nil, ErrShape
	}
	if w.Sig != nil {
		if b, err := DecodeB64(*w.Sig); err != nil || len(b) != 64 {
			return nil, ErrShape
		}
	}
	return &w, nil
}

// Check verifies a wrap for the server: the expected ctx, addressed to
// toPubB64, made by `by` and signed with that person's U_sig.
func (w *Wrap) Check(ctx, toPubB64, by, sigPubB64 string) error {
	if w.Ctx != ctx || w.To != FingerprintB64(toPubB64) || w.By == nil || *w.By != by || w.Sig == nil {
		return ErrShape
	}
	return VerifyB64(sigPubB64, []byte(w.SignedString()), *w.Sig)
}
