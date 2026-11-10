// Package tcrypto checks what the browsers sign (design §5): P-256 public
// keys, fingerprints, ECDSA P1363 signatures, the revision chain, rosters
// and key wraps. The server never decrypts anything; it verifies shapes and
// signatures so a member cannot push or grant what their role does not
// allow, and the browsers verify everything again themselves (D60).
//
// It is named tcrypto so it does not shadow the standard crypto package.
package tcrypto

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"math/big"
	"regexp"
)

// B64 is base64url without padding, the only binary encoding on the wire.
var B64 = base64.RawURLEncoding

// Errors.
var (
	ErrKey       = errors.New("tcrypto: not a P-256 public key")
	ErrSignature = errors.New("tcrypto: bad signature")
	ErrShape     = errors.New("tcrypto: malformed")
)

// DecodeB64 decodes strict base64url (no padding, no stray characters).
func DecodeB64(s string) ([]byte, error) {
	b, err := B64.Strict().DecodeString(s)
	if err != nil {
		return nil, ErrShape
	}
	return b, nil
}

// ParseRawP256 parses a 65-byte uncompressed P-256 point (the WebCrypto
// `raw` export), given in base64url. The point must be on the curve.
func ParseRawP256(b64 string) (*ecdsa.PublicKey, []byte, error) {
	raw, err := DecodeB64(b64)
	if err != nil || len(raw) != 65 || raw[0] != 4 {
		return nil, nil, ErrKey
	}
	pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), raw)
	if err != nil {
		return nil, nil, ErrKey
	}
	return pub, raw, nil
}

// Fingerprint is the first 22 characters (132 bits) of the base64url
// SHA-256 of a raw public key (design §5.1).
func Fingerprint(raw []byte) string {
	h := sha256.Sum256(raw)
	return B64.EncodeToString(h[:])[:22]
}

// FingerprintB64 is Fingerprint of a base64url raw key ("" when malformed).
func FingerprintB64(b64 string) string {
	raw, err := DecodeB64(b64)
	if err != nil || len(raw) != 65 {
		return ""
	}
	return Fingerprint(raw)
}

var fpRe = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)

// ValidFingerprint reports whether s has the shape of a fingerprint.
func ValidFingerprint(s string) bool { return fpRe.MatchString(s) }

// VerifyP1363 checks a 64-byte r||s ECDSA P-256 SHA-256 signature, the
// format WebCrypto produces.
func VerifyP1363(pub *ecdsa.PublicKey, msg []byte, sig []byte) bool {
	if pub == nil || len(sig) != 64 {
		return false
	}
	r := new(big.Int).SetBytes(sig[:32])
	s := new(big.Int).SetBytes(sig[32:])
	h := sha256.Sum256(msg)
	return ecdsa.Verify(pub, h[:], r, s)
}

// VerifyB64 is VerifyP1363 with the key and signature in base64url.
func VerifyB64(pubB64 string, msg []byte, sigB64 string) error {
	pub, _, err := ParseRawP256(pubB64)
	if err != nil {
		return err
	}
	sig, err := DecodeB64(sigB64)
	if err != nil || !VerifyP1363(pub, msg, sig) {
		return ErrSignature
	}
	return nil
}

// SignP1363 signs msg the way WebCrypto does (r||s, 32 bytes each). The
// server never signs anything; tests and tools use it.
func SignP1363(priv *ecdsa.PrivateKey, msg []byte) []byte {
	h := sha256.Sum256(msg)
	r, s, err := ecdsa.Sign(rand.Reader, priv, h[:])
	if err != nil {
		panic(err)
	}
	out := make([]byte, 64)
	r.FillBytes(out[:32])
	s.FillBytes(out[32:])
	return out
}

// RawPublic is the 65-byte uncompressed form of pub, in base64url.
func RawPublic(pub *ecdsa.PublicKey) string {
	b, err := pub.Bytes()
	if err != nil {
		panic(err)
	}
	return B64.EncodeToString(b)
}
