package api

import (
	"errors"
	"net/http"

	"carino.systems/topo/server/internal/hub"
)

// Error codes of the site, key and revision routes (design §4.1). The
// browser maps each to a translated sentence (amendment E4).
const (
	ErrBadSignature = "bad-signature"
	ErrBadChain     = "bad-chain"
	ErrBadRoster    = "bad-roster"
	ErrBadWrap      = "bad-wrap"
	ErrStaleBase    = "stale-base"
	ErrStaleEpoch   = "stale-epoch"
	ErrStaleRoster  = "stale-roster"
	ErrSiteFull     = "site-full"
	ErrBadInvite    = "bad-invite"
	ErrWrongEmail   = "wrong-email"
	ErrLastOwner    = "last-owner"
	ErrNoKeys       = "no-keys"
	ErrNoDevice     = "no-device"
	ErrMember       = "already-member"
	// A revision pushed by anyone but an owner (D154); "update": true.
	ErrOwnersOnly = "owners-only"
	// A visit copy for a site with too many waiting already.
	ErrVisitsFull = "visits-full"
)

// apiErr is a refusal decided inside a handler or a transaction; answer()
// writes it, anything else is a 500.
type apiErr struct {
	status int
	code   string
	extra  map[string]any
}

func (e *apiErr) Error() string { return e.code }

func fail(status int, code string) error { return &apiErr{status: status, code: code} }

func failWith(status int, code string, extra map[string]any) error {
	return &apiErr{status: status, code: code, extra: extra}
}

// answer writes err: an apiErr as its status and code, anything else as
// 500 (logged with what).
func (s *Server) answer(w http.ResponseWriter, what string, err error) {
	var ae *apiErr
	if errors.As(err, &ae) {
		if ae.status == http.StatusTooManyRequests {
			if ra, ok := ae.extra["retryAfter"].(int); ok {
				writeError(w, ae.status, ae.code, map[string]any{"retryAfter": ra})
				return
			}
		}
		writeError(w, ae.status, ae.code, ae.extra)
		return
	}
	var eb *errBody
	if errors.As(err, &eb) {
		writeError(w, eb.status, eb.code, nil)
		return
	}
	s.internal(w, what, err)
}

func noContent(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) wake() {
	if s.d.Wake != nil {
		s.d.Wake()
	}
}

// publish sends a live event to users (after the change is committed).
func (s *Server) publish(users []string, name string, data any) {
	if len(users) > 0 {
		s.d.Hub.Publish(users, hub.NewEvent(name, data))
	}
}

// pendingEvent is a live event decided inside a transaction and published
// after it commits.
type pendingEvent struct {
	users []string
	name  string
	data  any
}

func (s *Server) flush(evs []pendingEvent) {
	for _, e := range evs {
		s.publish(e.users, e.name, e.data)
	}
}
