// Package hub is the Server-Sent Events broker (D65, amendment C8): one
// stream per connected tab (or one per browser when its tabs elect a
// leader), indexed by user and session, so an event reaches every stream of
// the users concerned and a revoked session or device loses its streams at
// once.
//
// Events carry ids only, never content. There is no replay: a client that
// reconnects re-reads GET /api/sites and GET /api/me.
package hub

import (
	"encoding/json"
	"errors"
	"sync"
)

// Limits (amendment C8: 12 per user, because a browser without
// BroadcastChannel or locks opens one stream per tab).
const (
	DefaultPerUser = 12
	DefaultTotal   = 500
	buffer         = 32
)

// ErrTooMany is returned by Subscribe beyond the limits (the handler answers
// 429).
var ErrTooMany = errors.New("hub: too many streams")

// Event is one SSE message.
type Event struct {
	Name string
	Data []byte // JSON
}

// NewEvent marshals data into an Event.
func NewEvent(name string, data any) Event {
	b, err := json.Marshal(data)
	if err != nil {
		b = []byte("{}")
	}
	return Event{Name: name, Data: b}
}

// Stream is one open connection.
type Stream struct {
	UserID    string
	SessionID string
	C         chan Event    // events to write
	Done      chan struct{} // closed when the hub ends the stream
	once      sync.Once
}

func (s *Stream) close() { s.once.Do(func() { close(s.Done) }) }

// Hub holds the open streams. A nil *Hub is valid and does nothing.
type Hub struct {
	mu      sync.Mutex
	byUser  map[string]map[*Stream]struct{}
	total   int
	PerUser int
	Total   int
}

// New returns an empty hub with the default limits.
func New() *Hub {
	return &Hub{byUser: map[string]map[*Stream]struct{}{}, PerUser: DefaultPerUser, Total: DefaultTotal}
}

// Subscribe opens a stream for a session.
func (h *Hub) Subscribe(userID, sessionID string) (*Stream, error) {
	if h == nil {
		return nil, ErrTooMany
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.total >= h.Total || len(h.byUser[userID]) >= h.PerUser {
		return nil, ErrTooMany
	}
	s := &Stream{UserID: userID, SessionID: sessionID, C: make(chan Event, buffer), Done: make(chan struct{})}
	if h.byUser[userID] == nil {
		h.byUser[userID] = map[*Stream]struct{}{}
	}
	h.byUser[userID][s] = struct{}{}
	h.total++
	return s, nil
}

// Unsubscribe removes a stream (the handler calls it when it returns).
func (h *Hub) Unsubscribe(s *Stream) {
	if h == nil || s == nil {
		return
	}
	h.mu.Lock()
	h.removeLocked(s)
	h.mu.Unlock()
}

func (h *Hub) removeLocked(s *Stream) {
	m := h.byUser[s.UserID]
	if _, ok := m[s]; !ok {
		return
	}
	delete(m, s)
	if len(m) == 0 {
		delete(h.byUser, s.UserID)
	}
	h.total--
	s.close()
}

// send delivers without blocking; a stream whose buffer is full is too slow
// and is closed (the browser reconnects and re-reads).
func (h *Hub) sendLocked(s *Stream, ev Event) {
	select {
	case s.C <- ev:
	default:
		h.removeLocked(s)
	}
}

// Publish sends ev to every stream of the users.
func (h *Hub) Publish(users []string, ev Event) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	seen := map[string]bool{}
	for _, u := range users {
		if seen[u] {
			continue
		}
		seen[u] = true
		for s := range h.byUser[u] {
			h.sendLocked(s, ev)
		}
	}
}

// PublishExcept sends ev to the user's streams except those of one session.
func (h *Hub) PublishExcept(user, exceptSession string, ev Event) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.byUser[user] {
		if s.SessionID != exceptSession {
			h.sendLocked(s, ev)
		}
	}
}

// CloseSessions ends every stream of these sessions (sign-out, revoke,
// device removal, disabling, expiry).
func (h *Hub) CloseSessions(ids []string) {
	if h == nil || len(ids) == 0 {
		return
	}
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, m := range h.byUser {
		for s := range m {
			if want[s.SessionID] {
				h.removeLocked(s)
			}
		}
	}
}

// Online reports whether the user has an open stream.
func (h *Hub) Online(user string) bool {
	if h == nil {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.byUser[user]) > 0
}

// OnlineExcept reports whether the user has an open stream from a session
// other than this one.
func (h *Hub) OnlineExcept(user, session string) bool {
	if h == nil {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.byUser[user] {
		if s.SessionID != session {
			return true
		}
	}
	return false
}

// Count is the number of open streams.
func (h *Hub) Count() int {
	if h == nil {
		return 0
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.total
}
