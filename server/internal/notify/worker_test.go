package notify

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/store"
)

type fakeMailer struct {
	mu   sync.Mutex
	fail error
	got  []*mail.Message
}

func (f *fakeMailer) Name() string { return "fake" }
func (f *fakeMailer) Send(ctx context.Context, m *mail.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail != nil {
		return f.fail
	}
	f.got = append(f.got, m)
	return nil
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

func setup(t *testing.T, perMinute int) (*Worker, *fakeMailer, *clock, *store.Store) {
	t.Helper()
	c := &clock{t: time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)}
	st, err := store.Open(t.TempDir(), c.now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	f := &fakeMailer{}
	return New(st, f, nil, c.now, "https://topo.example.com/", perMinute), f, c, st
}

func queue(t *testing.T, st *store.Store, c *clock, kind, data string) string {
	t.Helper()
	id := store.NewID("o_")
	ms := c.now().UnixMilli()
	if err := store.InsertMail(context.Background(), st.W, &store.Mail{ID: id, Kind: kind, To: "a@example.com", Lang: "es", Data: data, Created: ms, SendAfter: ms}); err != nil {
		t.Fatal(err)
	}
	return id
}

func row(t *testing.T, st *store.Store, id string) (sent int64, tries int, data string, after int64) {
	t.Helper()
	var s *int64
	st.R.QueryRow("SELECT sent, tries, data, send_after FROM outbox WHERE id = ?", id).Scan(&s, &tries, &data, &after)
	if s != nil {
		sent = *s
	}
	return
}

func TestSendBlanksData(t *testing.T) {
	w, f, c, st := setup(t, 30)
	id := queue(t, st, c, "signin", `{"code":"012345","link":"https://topo.example.com/#signin=x","minutes":"10"}`)
	// Decoy rows are never sent.
	ms := c.now().UnixMilli()
	store.InsertMail(context.Background(), st.W, &store.Mail{ID: "o_decoy", Kind: "none", To: "b@example.com", Lang: "en", Data: "{}", Created: ms, SendAfter: ms, Sent: -2})
	n, err := w.Drain(context.Background())
	if err != nil || n != 1 || len(f.got) != 1 {
		t.Fatal(n, err, len(f.got))
	}
	m := f.got[0]
	if m.ID != id || m.To != "a@example.com" || m.Lang != "es" || m.Code != "012345" {
		t.Fatalf("%+v", m)
	}
	sent, _, data, _ := row(t, st, id)
	if sent != c.now().UnixMilli() || data != "{}" {
		t.Fatalf("sent %d data %s", sent, data)
	}
	if n, _ := w.Drain(context.Background()); n != 0 {
		t.Fatal("sent twice")
	}
}

func TestBackoffAndGiveUp(t *testing.T) {
	w, f, c, st := setup(t, 30)
	f.fail = errors.New("smtp: 451 try later")
	id := queue(t, st, c, "welcome", `{"inviter":"o@example.com"}`)
	want := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, time.Hour, time.Hour, time.Hour}
	for i, d := range want {
		w.Drain(context.Background())
		sent, tries, data, after := row(t, st, id)
		if sent != 0 || tries != i+1 || after != c.now().Add(d).UnixMilli() || data == "{}" {
			t.Fatalf("try %d: sent %d tries %d after %d data %s", i+1, sent, tries, after, data)
		}
		// Not due yet: nothing happens.
		w.Drain(context.Background())
		if _, tr, _, _ := row(t, st, id); tr != i+1 {
			t.Fatal("retried before its time")
		}
		c.add(d)
	}
	w.Drain(context.Background())
	sent, tries, data, _ := row(t, st, id)
	if sent != -1 || tries != MaxTries || data != "{}" {
		t.Fatalf("give up: sent %d tries %d data %s", sent, tries, data)
	}
	// A message that recovers is sent.
	f.fail = nil
	id2 := queue(t, st, c, "welcome", `{}`)
	w.Drain(context.Background())
	if s, _, _, _ := row(t, st, id2); s <= 0 {
		t.Fatal("not sent")
	}
}

func TestGlobalCap(t *testing.T) {
	w, f, c, st := setup(t, 3)
	for i := 0; i < 5; i++ {
		queue(t, st, c, "granted", `{}`)
	}
	if n, _ := w.Drain(context.Background()); n != 3 || len(f.got) != 3 {
		t.Fatalf("first minute: %d", n)
	}
	c.add(30 * time.Second)
	if n, _ := w.Drain(context.Background()); n != 0 {
		t.Fatal("cap not held")
	}
	c.add(31 * time.Second)
	if n, _ := w.Drain(context.Background()); n != 2 {
		t.Fatalf("after a minute: %d", n)
	}
}

func TestRunWakesAndStops(t *testing.T) {
	w, f, c, st := setup(t, 30)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()
	queue(t, st, c, "granted", `{}`)
	w.Wake()
	deadline := time.Now().Add(3 * time.Second)
	for {
		f.mu.Lock()
		n := len(f.got)
		f.mu.Unlock()
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("wake did not send")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Run did not stop")
	}
}

func TestUnknownKindIsGivenUpNotLooped(t *testing.T) {
	w, _, c, st := setup(t, 30)
	id := queue(t, st, c, "bogus", `{}`)
	w.Drain(context.Background())
	if _, tries, _, _ := row(t, st, id); tries != 1 {
		t.Fatalf("tries %d", tries)
	}
}
