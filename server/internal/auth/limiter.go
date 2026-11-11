package auth

import (
	"sync"
	"time"
)

// Limiter is a set of in-memory token buckets keyed by caller (an IP, or an
// IPv6 /64). Each bucket holds Capacity tokens and refills Capacity per
// Period. Take reserves a token before the work is done, so parallel
// guesses cannot slip past the limit; Refund gives it back when the attempt
// turns out to be one that should not count (a correct code).
type Limiter struct {
	Capacity float64
	Period   time.Duration
	Now      func() time.Time

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

// NewLimiter returns a limiter of capacity per period.
func NewLimiter(capacity int, period time.Duration, now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{Capacity: float64(capacity), Period: period, Now: now, buckets: map[string]*bucket{}}
}

func (l *Limiter) refill(b *bucket, now time.Time) {
	if el := now.Sub(b.last); el > 0 {
		b.tokens += l.Capacity * float64(el) / float64(l.Period)
		if b.tokens > l.Capacity {
			b.tokens = l.Capacity
		}
		b.last = now
	}
}

// Take spends one token for key. When none is left it reports false and
// how long until one is back.
func (l *Limiter) Take(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Now()
	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.Capacity, last: now}
		l.buckets[key] = b
	}
	l.refill(b, now)
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	wait := time.Duration((1 - b.tokens) * float64(l.Period) / l.Capacity)
	if wait < time.Second {
		wait = time.Second
	}
	return false, wait
}

// Peek reports what Take would answer, without spending a token (a caller
// that must read a large body first refuses early, then Takes).
func (l *Limiter) Peek(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.buckets[key]
	if b == nil {
		return true, 0
	}
	l.refill(b, l.Now())
	if b.tokens >= 1 {
		return true, 0
	}
	wait := time.Duration((1 - b.tokens) * float64(l.Period) / l.Capacity)
	if wait < time.Second {
		wait = time.Second
	}
	return false, wait
}

// Refund returns one token to key.
func (l *Limiter) Refund(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if b := l.buckets[key]; b != nil {
		b.tokens++
		if b.tokens > l.Capacity {
			b.tokens = l.Capacity
		}
	}
}

// Prune drops buckets that have refilled completely (memory stays bounded
// by the callers of the last Period).
func (l *Limiter) Prune() {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Now()
	for k, b := range l.buckets {
		l.refill(b, now)
		if b.tokens >= l.Capacity {
			delete(l.buckets, k)
		}
	}
}

// Len is the number of live buckets (tests).
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}
