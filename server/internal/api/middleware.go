package api

import (
	"context"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"carino.systems/topo/server/internal/config"
)

// reqInfo travels in the context so the log line can name the route pattern
// (never the raw path, which may carry ids) and the user.
type reqInfo struct {
	route string
}

type infoKey struct{}

func infoFrom(ctx context.Context) *reqInfo {
	i, _ := ctx.Value(infoKey{}).(*reqInfo)
	return i
}

// statusWriter records the status for the log. It passes Flush through, so
// Server-Sent Events work behind it, and Unwrap for ResponseController.
type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, err
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// recoverMW turns a handler panic into a 500 and a log line.
func (s *Server) recoverMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.d.Log.Error("handler panic", "method", r.Method, "route", routeOf(r), "panic", v)
				writeError(w, http.StatusInternalServerError, ErrInternal, nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// Body read limits. The server has no ReadTimeout (Server-Sent Events stay
// open), so every other request gets a deadline for reading its body: a
// client that trickles a body in cannot hold a connection forever.
var (
	BodyReadTimeout = 30 * time.Second
	RevReadTimeout  = 2 * time.Minute // a revision push may be several MB
)

// readDeadlineMW sets the read deadline for every request but the live
// stream (a read deadline there would end the stream).
func (s *Server) readDeadlineMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !(r.Method == http.MethodGet && r.URL.Path == "/api/events") {
			d := BodyReadTimeout
			if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/sites/") && strings.HasSuffix(r.URL.Path, "/revs") {
				d = RevReadTimeout
			}
			_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(d))
		}
		next.ServeHTTP(w, r)
	})
}

func routeOf(r *http.Request) string {
	if i := infoFrom(r.Context()); i != nil && i.route != "" {
		return i.route
	}
	return "static"
}

// logMW writes one line per request: method, route pattern, status,
// duration and user id. Static asset hits log at debug.
func (s *Server) logMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		info := &reqInfo{}
		r = r.WithContext(context.WithValue(r.Context(), infoKey{}, info))
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		route := info.route
		if route == "" && strings.HasPrefix(r.URL.Path, "/api/") {
			route = "api" // refused before routing (Host, CSRF)
		}
		attrs := []any{"method", r.Method, "route", routeOrStatic(route), "status", sw.status, "ms", time.Since(start).Milliseconds()}
		if sess := SessionFrom(r.Context()); sess != nil {
			attrs = append(attrs, "user", sess.UserID)
		}
		if route == "" && sw.status < 400 {
			s.d.Log.Debug("request", attrs...)
		} else {
			s.d.Log.Info("request", attrs...)
		}
	})
}

func routeOrStatic(r string) string {
	if r == "" {
		return "static"
	}
	return r
}

// headersMW sets the security headers on every response. No
// Cross-Origin-Opener-Policy: the report opens in a blob: tab that the page
// wires up through its window handle (js/report.js openReportTab), which a
// COOP browsing-context switch would cut.
func (s *Server) headersMW(next http.Handler) http.Handler {
	csp := s.d.App.HeaderCSP()
	hsts := s.d.Cfg.Secure()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy", csp)
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if hsts {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

// hostMW refuses Host headers the server does not answer to (DNS
// rebinding): loopback names, the listen host, the public host and
// TOPO_ALLOWED_HOSTS.
func (s *Server) hostMW(next http.Handler) http.Handler {
	allowed := map[string]bool{}
	allowed[strings.ToLower(s.d.Cfg.PublicURL.Hostname())] = true
	if h, _, err := net.SplitHostPort(s.d.Cfg.Listen); err == nil && h != "" {
		if ip, err := netip.ParseAddr(strings.Trim(h, "[]")); err != nil || !ip.IsUnspecified() {
			allowed[strings.ToLower(strings.Trim(h, "[]"))] = true
		}
	}
	for _, h := range s.d.Cfg.AllowedHosts {
		allowed[h] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := hostOnly(r.Host)
		if !allowed[host] && !config.IsLoopbackHost(host) {
			writeError(w, http.StatusMisdirectedRequest, ErrMisdirected, nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func hostOnly(hostport string) string {
	h := hostport
	if hh, _, err := net.SplitHostPort(hostport); err == nil {
		h = hh
	}
	return strings.ToLower(strings.Trim(h, "[]"))
}

// csrfMW protects every state-changing /api request (D57): the custom
// header X-Topo: 1 (a cross-site form cannot set it, and a cross-site fetch
// with it needs a CORS preflight the server never grants), a JSON body, and
// an Origin equal to the public origin. With no Origin, Sec-Fetch-Site must
// say same-origin or none. GETs never change state.
func (s *Server) csrfMW(next http.Handler) http.Handler {
	origin := s.d.Cfg.Origin()
	loopbackHTTP := !s.d.Cfg.Secure() && config.IsLoopbackHost(s.d.Cfg.PublicURL.Hostname())
	port := s.d.Cfg.PublicURL.Port()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || safeMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("X-Topo") != "1" || !jsonOrEmpty(r) || !s.originOK(r, origin, loopbackHTTP, port) {
			writeError(w, http.StatusForbidden, ErrCSRF, nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func safeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

func jsonOrEmpty(r *http.Request) bool {
	ct := r.Header.Get("Content-Type")
	if ct == "" {
		return r.ContentLength == 0
	}
	mt, _, err := mime.ParseMediaType(ct)
	return err == nil && mt == "application/json"
}

func (s *Server) originOK(r *http.Request, origin string, loopbackHTTP bool, port string) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		switch r.Header.Get("Sec-Fetch-Site") {
		case "same-origin", "none":
			return true
		}
		return false
	}
	if o == origin {
		return true
	}
	if !loopbackHTTP {
		return false
	}
	// On a loopback http server, 127.0.0.1 and localhost are the same
	// place: accept any loopback origin on the same port.
	u, err := url.Parse(o)
	if err != nil || u.Scheme != "http" || !config.IsLoopbackHost(u.Hostname()) {
		return false
	}
	return u.Port() == port
}

// sessionMW resolves the session cookie into the context (stage 2 provides
// Deps.Sessions; until then nobody is signed in).
func (s *Server) sessionMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.d.Sessions != nil && strings.HasPrefix(r.URL.Path, "/api/") {
			if sess := s.d.Sessions(r); sess != nil {
				r = r.WithContext(WithSession(r.Context(), sess))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// ClientIP is the caller's address for rate limits (D71): the TCP peer,
// unless the peer is a trusted proxy, in which case X-Forwarded-For is
// walked from the right past trusted hops.
func ClientIP(r *http.Request, trusted []netip.Prefix) netip.Addr {
	peer := parseIP(r.RemoteAddr)
	if !peer.IsValid() || !inPrefixes(peer, trusted) {
		return peer
	}
	parts := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		a := parseIP(strings.TrimSpace(parts[i]))
		if !a.IsValid() {
			return peer
		}
		if !inPrefixes(a, trusted) {
			return a
		}
		peer = a
	}
	return peer
}

func parseIP(s string) netip.Addr {
	if ap, err := netip.ParseAddrPort(s); err == nil {
		return ap.Addr().Unmap()
	}
	a, err := netip.ParseAddr(strings.Trim(s, "[]"))
	if err != nil {
		return netip.Addr{}
	}
	return a.Unmap()
}

func inPrefixes(a netip.Addr, ps []netip.Prefix) bool {
	for _, p := range ps {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// RateKey groups IPv6 callers by /64 (one subscriber's block), IPv4 by
// address.
func RateKey(a netip.Addr) string {
	if !a.IsValid() {
		return "?"
	}
	if a.Is4() {
		return a.String()
	}
	p, _ := a.Prefix(64)
	return p.String()
}
