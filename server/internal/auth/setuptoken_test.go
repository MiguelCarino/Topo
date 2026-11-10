package auth

import (
	"context"
	"strings"
	"testing"

	"carino.systems/topo/server/internal/store"
)

func TestSetupTokenLifecycle(t *testing.T) {
	s, err := store.Open(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	if ok, _ := CheckSetupToken(ctx, s, "anything"); ok {
		t.Fatal("matched with no token")
	}
	a, err := MintSetupToken(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != SetupTokenLen+6 || strings.Count(a, "-") != 6 {
		t.Fatalf("format %q", a)
	}
	if ok, _ := CheckSetupToken(ctx, s, a); !ok {
		t.Fatal("own token refused")
	}
	if ok, _ := CheckSetupToken(ctx, s, strings.ToUpper(strings.ReplaceAll(a, "-", " "))); !ok {
		t.Fatal("typed with spaces and capitals refused")
	}
	b, _ := MintSetupToken(ctx, s)
	if ok, _ := CheckSetupToken(ctx, s, a); ok {
		t.Fatal("a superseded token still works")
	}
	if ok, _ := CheckSetupToken(ctx, s, b); !ok {
		t.Fatal("new token refused")
	}
	if ok, _ := CheckSetupToken(ctx, s, b[:len(b)-1]); ok {
		t.Fatal("short token accepted")
	}
	BurnSetupToken(ctx, s)
	if ok, _ := CheckSetupToken(ctx, s, b); ok {
		t.Fatal("burnt token works")
	}
}

func TestRandomSymbolsAlphabet(t *testing.T) {
	seen := map[byte]bool{}
	for i := 0; i < 200; i++ {
		for _, c := range []byte(RandomSymbols(26)) {
			if !strings.ContainsRune(Alphabet, rune(c)) {
				t.Fatalf("%c outside the alphabet", c)
			}
			seen[c] = true
		}
	}
	if len(seen) != len(Alphabet) {
		t.Fatalf("only %d of %d symbols seen", len(seen), len(Alphabet))
	}
	if _, ok := NormalizeToken("abcd-efgh-jkmn-pqrs-tuvw-xyz2-3o"); ok {
		t.Fatal("o accepted")
	}
}
