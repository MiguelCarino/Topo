package notify

import (
	"context"
	"testing"
	"time"

	"carino.systems/topo/server/internal/store"
)

func TestRecipients(t *testing.T) {
	ms := []store.Member{
		{UserID: "o1", Role: "owner", Status: "granted", Email: "o1@x", Notify: "{}"},
		{UserID: "o2", Role: "owner", Status: "granted", Email: "o2@x", Notify: `{"visit":false,"join":false,"revision":false}`},
		{UserID: "p1", Role: "provider", Status: "granted", Email: "p1@x", Notify: "{}"},
		{UserID: "p2", Role: "provider", Status: "granted", Email: "p2@x", Notify: `{"revisionShared":true}`, Muted: true},
		{UserID: "p3", Role: "provider", Status: "waiting", Email: "p3@x", Notify: "{}"},
		{UserID: "v1", Role: "viewer", Status: "granted", Email: "v1@x", Notify: `{"revisionShared":true}`},
		{UserID: "d1", Role: "owner", Status: "granted", Email: "d1@x", Notify: "{}", Disabled: true},
	}
	ids := func(rs []store.Member) string {
		s := ""
		for _, r := range rs {
			s += r.UserID + " "
		}
		return s
	}
	cases := []struct {
		kind, author string
		to           []string
		want         string
	}{
		// Routed providers only, minus the author; waiting, muted and
		// disabled members never.
		{"incident-sent", "o1", []string{"p1", "p2", "p3", "o1"}, "p1 "},
		{"incident-closed", "o1", []string{"p1"}, "p1 "},
		// Owners (o2 opted out) plus the named reporter.
		{"visit-recorded", "p1", []string{"v1"}, "o1 v1 "},
		{"visit-recorded", "o1", nil, ""},
		{"member-joined", "p3", nil, "o1 "},
		// Owners by default; providers and viewers only when they opted in.
		{"revision", "p1", nil, "o1 v1 "},
		{"revision", "o1", nil, "v1 "},
	}
	for _, c := range cases {
		if got := ids(Recipients(c.kind, c.author, c.to, ms)); got != c.want {
			t.Errorf("%s by %s to %v: %q, want %q", c.kind, c.author, c.to, got, c.want)
		}
	}
}

func TestEffectiveDefaults(t *testing.T) {
	e := Effective(`{"visit":false,"unknown":true}`)
	if e["visit"] || !e["incident"] || e["revisionShared"] || !e["revision"] || len(e) != len(Defaults) {
		t.Fatalf("effective: %v", e)
	}
	if prefOf("revision", "owner") != "revision" || prefOf("revision", "viewer") != "revisionShared" {
		t.Fatal("revision switches")
	}
}

// TOPO_NOTIFY_EVENT_SECONDS: zero in Options means the 2-minute default, a
// negative delay sends at once, a positive one is used as given.
func TestEventDelay(t *testing.T) {
	now := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		delay time.Duration
		want  time.Duration
	}{{0, Debounce}, {-1, 0}, {30 * time.Second, 30 * time.Second}} {
		st, err := store.Open(t.TempDir(), func() time.Time { return now })
		if err != nil {
			t.Fatal(err)
		}
		ctx := context.Background()
		tx, err := st.W.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		rc := []store.Member{{UserID: "u_p", Email: "p@example.test", Lang: "en", Role: "provider", Status: "granted", Notify: "{}"}}
		if n, err := Enqueue(ctx, tx, "s_x", "incident-sent", rc, Options{Now: now, EventDelay: c.delay}); err != nil || n != 1 {
			t.Fatal(n, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		var after int64
		if err := st.R.QueryRow("SELECT send_after FROM outbox WHERE kind = 'incident-sent'").Scan(&after); err != nil {
			t.Fatal(err)
		}
		if got := time.Duration(after-now.UnixMilli()) * time.Millisecond; got != c.want {
			t.Errorf("delay %v: due after %v, want %v", c.delay, got, c.want)
		}
		st.Close()
	}
}
