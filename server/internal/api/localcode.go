package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"

	"carino.systems/topo/server/internal/auth"
)

// ErrNoCode: the app's key matched, but no sign-in code is waiting.
const ErrNoCode = "no-code"

// localSigninCode hands the newest sign-in code sent to an address to the
// desktop app that set this server up (docs/SCOPE.md D358). Only on a
// server only this computer reaches that sends no email (cfg.LocalCodes),
// only to a caller on this computer's loopback (the TCP peer itself, never
// a forwarded address), and only with the key the app wrote into the
// server's settings (TOPO_LOCAL_CODE_KEY), which other accounts on the PC
// cannot read. Anything else is 404, as if the route did not exist.
//
// GET with the key in X-Topo-Local-Key and the address in X-Topo-Email
// (headers, so neither is in a logged URL). 200 {code, at}; 404 no-code
// (the key matched, nothing waiting); any other refusal is 404 not-found.
func (s *Server) localSigninCode(w http.ResponseWriter, r *http.Request) {
	cfg := s.d.Cfg
	if s.d.LocalCodes == nil || !cfg.LocalCodes() {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	peer := parseIP(r.RemoteAddr)
	if !peer.IsValid() || !peer.IsLoopback() || r.Header.Get("X-Forwarded-For") != "" {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	got := sha256.Sum256([]byte(strings.TrimSpace(r.Header.Get("X-Topo-Local-Key"))))
	want := sha256.Sum256([]byte(cfg.LocalCodeKey))
	if subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	norm, ok := auth.NormalizeEmail(r.Header.Get("X-Topo-Email"))
	if !ok {
		writeError(w, http.StatusBadRequest, ErrBadEmail, nil)
		return
	}
	c, ok := s.d.LocalCodes.Take(norm)
	if !ok {
		// The key matched: "none yet", which the app tells apart from a
		// server that does not hand it codes (any other 404).
		writeError(w, http.StatusNotFound, ErrNoCode, nil)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, c)
}
