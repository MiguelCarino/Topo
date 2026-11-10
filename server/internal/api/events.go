package api

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"carino.systems/topo/server/internal/hub"
)

// ssePing is the keep-alive comment interval (D65).
var ssePing = 20 * time.Second

// events: GET /api/events, Server-Sent Events (D65). One stream per tab, or
// per browser when its tabs share one (amendment C8). It ends when the
// client goes, the session is revoked (the hub closes it), or the server
// shuts down (the base context ends).
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	if s.d.Hub == nil {
		writeError(w, http.StatusServiceUnavailable, ErrUnavailable, nil)
		return
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, ErrInternal, nil)
		return
	}
	sess := SessionFrom(r.Context())
	st, err := s.d.Hub.Subscribe(sess.UserID, sess.ID)
	if errors.Is(err, hub.ErrTooMany) {
		rateLimited(w, 30*time.Second)
		return
	}
	defer s.d.Hub.Unsubscribe(st)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "retry: 5000\n\n")
	fl.Flush()
	t := time.NewTicker(ssePing)
	defer t.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-st.Done:
			return
		case <-t.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			fl.Flush()
		case ev := <-st.C:
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, ev.Data); err != nil {
				return
			}
			fl.Flush()
		}
	}
}
