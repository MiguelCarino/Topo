package auth

import (
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewCodeShapeAndSpread(t *testing.T) {
	seen := map[string]bool{}
	leadingZero := 0
	firstDigit := [10]int{}
	const n = 20000
	for i := 0; i < n; i++ {
		c := NewCode()
		if len(c) != 6 || strings.Trim(c, "0123456789") != "" {
			t.Fatalf("code %q", c)
		}
		if c[0] == '0' {
			leadingZero++
		}
		firstDigit[c[0]-'0']++
		seen[c] = true
	}
	// Leading zeros are kept (about 1 in 10).
	if leadingZero < n/20 || leadingZero > n/5 {
		t.Fatalf("leading zero in %d of %d codes", leadingZero, n)
	}
	for d, c := range firstDigit {
		if c < n/20 || c > n/5 {
			t.Fatalf("first digit %d in %d of %d codes", d, c, n)
		}
	}
	if len(seen) < n*95/100 {
		t.Fatalf("only %d distinct codes of %d", len(seen), n)
	}
}

func TestNormalizeCode(t *testing.T) {
	for in, want := range map[string]string{"012345": "012345", " 012 345 ": "012345", "012-345": "012345"} {
		if got, ok := NormalizeCode(in); !ok || got != want {
			t.Errorf("%q: %q %v", in, got, ok)
		}
	}
	for _, in := range []string{"", "12345", "1234567", "12a456", "１２３４５６", "012345\n"} {
		if _, ok := NormalizeCode(in); ok {
			t.Errorf("%q accepted", in)
		}
	}
}

func TestCodeMAC(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	mac := CodeMAC(key, "c_1", "123456")
	if !CheckCode(key, "c_1", "123456", mac) {
		t.Fatal("own code refused")
	}
	if CheckCode(key, "c_2", "123456", mac) || CheckCode(key, "c_1", "123457", mac) || CheckCode([]byte("other"), "c_1", "123456", mac) {
		t.Fatal("wrong challenge, code or key accepted")
	}
	if strings.Contains(string(mac), "123456") {
		t.Fatal("mac holds the code")
	}
}

func TestTokens(t *testing.T) {
	a, b := NewToken(), NewToken()
	if a == b || !ValidToken(a) || len(a) != 43 {
		t.Fatalf("%q %q", a, b)
	}
	for _, bad := range []string{"", "short", a + "x", strings.Repeat("!", 43)} {
		if ValidToken(bad) {
			t.Errorf("%q valid", bad)
		}
	}
	if string(Hash(a)) == string(Hash(b)) || len(Hash(a)) != 32 {
		t.Fatal("hash")
	}
}

func TestNormalizeEmail(t *testing.T) {
	good := map[string]string{
		"Ana@Example.COM":            "ana@example.com",
		"  ana.b+x@sub.example.mx  ": "ana.b+x@sub.example.mx",
	}
	for in, want := range good {
		if got, ok := NormalizeEmail(in); !ok || got != want {
			t.Errorf("%q: %q %v", in, got, ok)
		}
	}
	bad := []string{"", "ana", "ana@", "@example.com", "ana@example", "ana@@example.com", "a@b@example.com",
		"Ana <ana@example.com>", "ana@example.com\r\nBcc: x@y.z", "ana@example.com,b@example.com", "ana@.example.com",
		"ana@example..com", "ana @example.com", strings.Repeat("a", 250) + "@example.com", strings.Repeat("a", 65) + "@example.com"}
	for _, in := range bad {
		if got, ok := NormalizeEmail(in); ok {
			t.Errorf("%q accepted as %q", in, got)
		}
	}
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

func TestLimiterBucket(t *testing.T) {
	c := &clock{t: time.Unix(1_700_000_000, 0)}
	l := NewLimiter(3, time.Hour, c.now)
	for i := 0; i < 3; i++ {
		if ok, _ := l.Take("a"); !ok {
			t.Fatalf("take %d refused", i)
		}
	}
	ok, wait := l.Take("a")
	if ok || wait < 19*time.Minute || wait > 21*time.Minute {
		t.Fatalf("4th: %v wait %v", ok, wait)
	}
	if ok, _ := l.Take("b"); !ok {
		t.Fatal("another key shares the bucket")
	}
	l.Refund("a")
	if ok, _ := l.Take("a"); !ok {
		t.Fatal("refund not returned")
	}
	c.add(20 * time.Minute)
	if ok, _ := l.Take("a"); !ok {
		t.Fatal("no refill after a third of the period")
	}
	if ok, _ := l.Take("a"); ok {
		t.Fatal("refilled too much")
	}
	// Refund never exceeds capacity.
	for i := 0; i < 10; i++ {
		l.Refund("b")
	}
	n := 0
	for {
		if ok, _ := l.Take("b"); !ok {
			break
		}
		n++
	}
	if n != 3 {
		t.Fatalf("capacity after refunds: %d", n)
	}
	c.add(2 * time.Hour)
	l.Prune()
	if l.Len() != 0 {
		t.Fatalf("prune left %d", l.Len())
	}
}

// Parallel takes cannot get more than the capacity (the reservation is
// taken before the work, so concurrent guesses do not slip past).
func TestLimiterParallel(t *testing.T) {
	l := NewLimiter(30, time.Hour, nil)
	var got atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ok, _ := l.Take("ip"); ok {
				got.Add(1)
			}
		}()
	}
	wg.Wait()
	if got.Load() != 30 {
		t.Fatalf("%d of 200 parallel takes passed, want 30", got.Load())
	}
}
