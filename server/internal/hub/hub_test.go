package hub

import (
	"testing"
)

func TestSubscribePublishClose(t *testing.T) {
	h := New()
	h.PerUser, h.Total = 2, 3
	a1, err := h.Subscribe("u_a", "l_1")
	if err != nil {
		t.Fatal(err)
	}
	a2, _ := h.Subscribe("u_a", "l_2")
	if _, err := h.Subscribe("u_a", "l_3"); err != ErrTooMany {
		t.Fatal("per-user cap")
	}
	b1, _ := h.Subscribe("u_b", "l_4")
	if _, err := h.Subscribe("u_c", "l_5"); err != ErrTooMany {
		t.Fatal("total cap")
	}
	h.Publish([]string{"u_a", "u_a"}, NewEvent("head", map[string]any{"n": 1}))
	if len(a1.C) != 1 || len(a2.C) != 1 || len(b1.C) != 0 {
		t.Fatal("publish fan-out (duplicates must not double-send)")
	}
	h.PublishExcept("u_a", "l_1", NewEvent("me", struct{}{}))
	if len(a1.C) != 1 || len(a2.C) != 2 {
		t.Fatal("publish except")
	}
	if !h.Online("u_b") || !h.OnlineExcept("u_a", "l_1") || h.OnlineExcept("u_b", "l_4") {
		t.Fatal("online")
	}
	h.CloseSessions([]string{"l_2", "l_4"})
	select {
	case <-a2.Done:
	default:
		t.Fatal("closed session's stream still open")
	}
	if h.Online("u_b") || h.Count() != 1 {
		t.Fatal("count after close")
	}
	h.Unsubscribe(a2) // already gone: no double count
	h.Unsubscribe(a1)
	if h.Count() != 0 {
		t.Fatal("count")
	}
}

func TestSlowStreamIsDropped(t *testing.T) {
	h := New()
	s, _ := h.Subscribe("u_a", "l_1")
	for i := 0; i < buffer+1; i++ {
		h.Publish([]string{"u_a"}, NewEvent("head", i))
	}
	select {
	case <-s.Done:
	default:
		t.Fatal("a full buffer must close the stream")
	}
	if h.Count() != 0 {
		t.Fatal("count")
	}
}

func TestNilHub(t *testing.T) {
	var h *Hub
	h.Publish([]string{"u"}, Event{})
	h.CloseSessions([]string{"x"})
	if h.Online("u") || h.Count() != 0 {
		t.Fatal("nil hub")
	}
	if _, err := h.Subscribe("u", "s"); err == nil {
		t.Fatal("nil hub subscribe")
	}
}
