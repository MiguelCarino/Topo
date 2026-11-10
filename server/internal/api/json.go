package api

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
)

// writeJSON writes v with status. API responses are never cached.
func writeJSON(w http.ResponseWriter, status int, v any) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if v != nil {
		enc := json.NewEncoder(w)
		enc.SetEscapeHTML(true)
		enc.Encode(v)
	}
}

// Error codes (design §4.1). The browser maps each to a translated sentence.
const (
	ErrBadRequest   = "bad-request"
	ErrUnauthorized = "unauthorized"
	ErrForbidden    = "forbidden"
	ErrCSRF         = "csrf"
	ErrNotFound     = "not-found"
	ErrConflict     = "conflict"
	ErrGone         = "gone"
	ErrTooLarge     = "too-large"
	ErrRateLimited  = "rate-limited"
	ErrUnavailable  = "unavailable"
	ErrMethod       = "method-not-allowed"
	ErrMisdirected  = "misdirected"
	ErrInternal     = "internal"
)

// writeError writes {"error": code} plus any extra fields. retryAfter, when
// present in extra as an int, also becomes the Retry-After header.
func writeError(w http.ResponseWriter, status int, code string, extra map[string]any) {
	body := map[string]any{"error": code}
	for k, v := range extra {
		body[k] = v
	}
	if s, ok := extra["retryAfter"].(int); ok {
		w.Header().Set("Retry-After", strconv.Itoa(s))
	}
	writeJSON(w, status, body)
}

// errBody is returned by decodeBody; it carries the response to give.
type errBody struct {
	status int
	code   string
}

func (e *errBody) Error() string { return e.code }

// decodeBody reads one JSON value of at most limit bytes into v. An empty
// body decodes as {} (some POSTs carry nothing). Callers answer with
// writeDecodeError.
func decodeBody(w http.ResponseWriter, r *http.Request, limit int64, v any) error {
	if ct := r.Header.Get("Content-Type"); ct != "" {
		if mt, _, err := mime.ParseMediaType(ct); err != nil || mt != "application/json" {
			return &errBody{http.StatusBadRequest, ErrBadRequest}
		}
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		switch {
		case errors.As(err, &mbe):
			return &errBody{http.StatusRequestEntityTooLarge, ErrTooLarge}
		case errors.Is(err, io.EOF):
			return json.Unmarshal([]byte("{}"), v)
		default:
			return &errBody{http.StatusBadRequest, ErrBadRequest}
		}
	}
	if dec.More() {
		return &errBody{http.StatusBadRequest, ErrBadRequest}
	}
	// Trailing bytes after the value (other than space) are malformed.
	if _, err := dec.Token(); err != io.EOF {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return &errBody{http.StatusRequestEntityTooLarge, ErrTooLarge}
		}
		return &errBody{http.StatusBadRequest, ErrBadRequest}
	}
	return nil
}

func writeDecodeError(w http.ResponseWriter, err error) {
	var eb *errBody
	if errors.As(err, &eb) {
		writeError(w, eb.status, eb.code, nil)
		return
	}
	writeError(w, http.StatusBadRequest, ErrBadRequest, nil)
}
