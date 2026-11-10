// Package auth holds the sign-in primitives: the first-run setup token
// (D53, amendment B5), emailed codes and link tokens (D54), address
// normalisation and the per-IP limiter (§6.3).
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"math/big"
	"strings"

	"carino.systems/topo/server/internal/store"
)

// Alphabet is the recovery alphabet (no i, l, o, 0 or 1), shared with the
// browser's recovery code and generatePassphrase (js/app.js).
const Alphabet = "abcdefghjkmnpqrstuvwxyz23456789"

// SetupTokenLen symbols of a 31-letter alphabet: 26 × log2(31) ≈ 128.8 bits.
const SetupTokenLen = 26

// MetaSetupToken is the meta key holding SHA-256 of the current token.
const MetaSetupToken = "setup_token_hash"

// RandomSymbols returns n symbols of Alphabet, uniformly (crypto/rand.Int
// rejects internally, so there is no modulo bias).
func RandomSymbols(n int) string {
	var b strings.Builder
	max := big.NewInt(int64(len(Alphabet)))
	for i := 0; i < n; i++ {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(err)
		}
		b.WriteByte(Alphabet[v.Int64()])
	}
	return b.String()
}

// FormatGroups writes s in dash-separated groups of four for reading out
// and typing.
func FormatGroups(s string) string {
	var parts []string
	for len(s) > 4 {
		parts = append(parts, s[:4])
		s = s[4:]
	}
	parts = append(parts, s)
	return strings.Join(parts, "-")
}

// NormalizeToken lowercases and drops spaces and dashes. It reports false
// when a character is outside the alphabet or the length is wrong.
func NormalizeToken(s string) (string, bool) {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r == ' ' || r == '-' || r == '\t':
			continue
		case r < 128 && strings.ContainsRune(Alphabet, r):
			b.WriteRune(r)
		default:
			return "", false
		}
	}
	out := b.String()
	return out, len(out) == SetupTokenLen
}

func hashToken(norm string) string {
	sum := sha256.Sum256([]byte("topo-setup-v1\n" + norm))
	return hex.EncodeToString(sum[:])
}

// MintSetupToken makes a new setup token, stores only its hash (replacing
// any older one) and returns it formatted for the log. Called at every start
// while the server has no owner and TOPO_OWNER_EMAIL is unset, and by the
// setup-token subcommand.
func MintSetupToken(ctx context.Context, s *store.Store) (string, error) {
	tok := RandomSymbols(SetupTokenLen)
	if err := s.MetaSet(ctx, MetaSetupToken, hashToken(tok)); err != nil {
		return "", err
	}
	return FormatGroups(tok), nil
}

// CheckSetupToken compares a typed token with the stored hash in constant
// time. A missing hash (no token outstanding) never matches.
func CheckSetupToken(ctx context.Context, s *store.Store, typed string) (bool, error) {
	return CheckSetupTokenQ(ctx, s.W, typed)
}

// CheckSetupTokenQ is CheckSetupToken inside a transaction (the writer has
// one connection, so a check inside a transaction must use it).
func CheckSetupTokenQ(ctx context.Context, q store.Q, typed string) (bool, error) {
	norm, ok := NormalizeToken(typed)
	want, err := store.MetaGetQ(ctx, q, MetaSetupToken)
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	got := hashToken(norm)
	match := subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
	return ok && match, nil
}

// BurnSetupToken deletes the stored hash once an owner exists.
func BurnSetupToken(ctx context.Context, s *store.Store) error {
	return s.MetaDelete(ctx, MetaSetupToken)
}
