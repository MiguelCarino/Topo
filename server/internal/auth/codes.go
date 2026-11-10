package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net/mail"
	"strings"
)

// CodeDigits is the length of an emailed sign-in code (D54).
const CodeDigits = 6

// NewCode returns a uniform 6-digit code, leading zeros kept. A crypto/rand
// uint32 is rejection-sampled into [0, 10^6) so no value is likelier.
func NewCode() string {
	const n = 1_000_000
	const limit = (1 << 32) / n * n
	var b [4]byte
	for {
		if _, err := rand.Read(b[:]); err != nil {
			panic(err)
		}
		v := binary.BigEndian.Uint32(b[:])
		if v < limit {
			return fmt.Sprintf("%06d", v%n)
		}
	}
}

// NormalizeCode strips spaces and dashes; it reports false unless six
// ASCII digits remain.
func NormalizeCode(s string) (string, bool) {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == ' ' || r == '-' || r == '\t':
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			return "", false
		}
	}
	out := b.String()
	return out, len(out) == CodeDigits
}

// CodeMAC is HMAC-SHA256(key, challengeID "|" code): the database never
// holds the code itself.
func CodeMAC(key []byte, challengeID, code string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("topo-code-v1\n" + challengeID + "|" + code))
	return m.Sum(nil)
}

// CheckCode compares in constant time.
func CheckCode(key []byte, challengeID, code string, mac []byte) bool {
	return hmac.Equal(CodeMAC(key, challengeID, code), mac)
}

// NewToken returns 32 random bytes in base64url (magic links, invite
// tokens, session and challenge cookies).
func NewToken() string {
	return base64.RawURLEncoding.EncodeToString(RandomBytes(32))
}

// RandomBytes returns n bytes from crypto/rand.
func RandomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

// Hash is SHA-256 of a token: what the database keeps.
func Hash(token string) []byte {
	s := sha256.Sum256([]byte(token))
	return s[:]
}

// ValidToken reports whether s looks like a NewToken value (43 base64url
// characters), so junk never reaches the database.
func ValidToken(s string) bool {
	if len(s) != 43 {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(s)
	return err == nil
}

// NormalizeEmail trims and lowercases an address and checks it: one bare
// address (no display name, no line breaks), one @, a dot in the domain, at
// most 254 characters.
func NormalizeEmail(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" || len(s) > 254 || strings.ContainsAny(s, "\r\n\x00 \t<>,;\"") {
		return "", false
	}
	if strings.Count(s, "@") != 1 {
		return "", false
	}
	local, domain, _ := strings.Cut(s, "@")
	if local == "" || len(local) > 64 || !strings.Contains(domain, ".") || strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") || strings.Contains(domain, "..") {
		return "", false
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Name != "" || a.Address != s {
		return "", false
	}
	return s, true
}
