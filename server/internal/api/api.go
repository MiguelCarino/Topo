// Package api is the server's HTTP surface: the static app and /api/*.
//
// Every route registers with a Class. The gate in front of the handler
// enforces it, and registering a route without one panics at startup, so
// no route is ever reachable by accident (design §4.1).
//
// Middleware order, outermost first:
// recover, log, headers, host, csrf, session, gate, mux.
package api

import (
	"context"
	"log/slog"
	"net/http"
	"runtime"
	"sync"
	"time"

	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/hub"
	"carino.systems/topo/server/internal/store"
)

// Class says who may call a route.
type Class int

const (
	unclassified Class = iota
	Public             // anyone
	User               // a session
	Keyed              // a session whose user has keys
	Member             // any membership of the site in the path (granted or waiting)
	Reader             // a granted membership
	Writer             // a granted owner or provider
	Owner              // a granted site owner
	Admin              // the server owner
)

var classNames = map[Class]string{Public: "public", User: "user", Keyed: "keyed", Member: "member", Reader: "reader", Writer: "writer", Owner: "owner", Admin: "admin"}

func (c Class) String() string {
	if n, ok := classNames[c]; ok {
		return n
	}
	return "unclassified"
}

// Session is the signed-in caller, put in the request context by the session
// middleware.
type Session struct {
	ID         string // public handle (l_…)
	UserID     string
	DeviceID   string
	ServerRole string // owner | staff | member
	HasKeys    bool
	Email      string
	hash       []byte // SHA-256 of the cookie (sign out)
}

type sessionKey struct{}

// SessionFrom returns the request's session, or nil when signed out.
func SessionFrom(ctx context.Context) *Session {
	s, _ := ctx.Value(sessionKey{}).(*Session)
	return s
}

// WithSession returns ctx carrying s (used by the session middleware and
// by tests).
func WithSession(ctx context.Context, s *Session) context.Context {
	return context.WithValue(ctx, sessionKey{}, s)
}

// Authorizer decides the classes beyond User for one request: Keyed from the
// session, the site classes from the membership of the {site} in the path,
// Admin from the server role. It returns the HTTP status to answer with
// (0 = allowed). Site checks answer 404, never 403, so ids are not
// confirmed to strangers.
type Authorizer func(r *http.Request, c Class, s *Session) int

// Deps are what the handlers need.
type Deps struct {
	Cfg     *config.Config
	Store   *store.Store
	App     *App
	Log     *slog.Logger
	Version string
	Build   string
	Now     func() time.Time
	// Key is the server key (server.key): it keys the sign-in code HMACs.
	Key []byte
	// Sessions resolves the session cookie; nil means the built-in resolver
	// (the sessions table) when there is a store, else nobody is signed in.
	Sessions func(r *http.Request) *Session
	// Authorize enforces the classes beyond User; nil means the built-in
	// one (Keyed, Admin; the site classes come with sites).
	Authorize Authorizer
	// Wake tells the mail worker a message is queued (nil: nothing to wake).
	Wake func()
	// CloseSessions ends the live streams of sessions that were signed out
	// or revoked (nil: Hub.CloseSessions).
	CloseSessions func(ids []string)
	// Hub is the live-event broker (nil: no live events; every publish is a
	// no-op and GET /api/events answers 503).
	Hub *hub.Hub
	// Blobs holds revision bodies (nil: the rev_bodies table).
	Blobs store.Blobs
	// Backups is the backup engine (step 5b; nil: no engine, every touch
	// is a no-op and Test/Save cannot check a destination).
	Backups *backup.Engine
}

// Server is the assembled handler.
type Server struct {
	d       Deps
	mux     *http.ServeMux
	routes  map[string]Class
	handler http.Handler

	// Per-IP limits (design §6.3), keyed by RateKey(ClientIP).
	ipCodes *auth.Limiter // sign-in code requests
	ipFails *auth.Limiter // failed verifies and links
	ipPeeks *auth.Limiter // invite peeks
	// Report emails sent for a client (reportmail.go, D87): per person per
	// hour and per site per day. In memory: a restart refills them.
	reportUser *auth.Limiter
	reportSite *auth.Limiter

	xffWarned sync.Once // an X-Forwarded-For from an untrusted peer, logged once
}

// New builds the handler with every route registered.
func New(d Deps) *Server {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.Log == nil {
		d.Log = slog.New(slog.DiscardHandler)
	}
	s := &Server{d: d, mux: http.NewServeMux(), routes: map[string]Class{}}
	s.ipCodes = auth.NewLimiter(ipCodesPerHour, time.Hour, d.Now)
	s.ipFails = auth.NewLimiter(ipFailsPerHour, time.Hour, d.Now)
	s.ipPeeks = auth.NewLimiter(ipPeeksPerHour, time.Hour, d.Now)
	s.reportUser = auth.NewLimiter(ReportPerUserHour, time.Hour, d.Now)
	s.reportSite = auth.NewLimiter(ReportPerSiteDay, 24*time.Hour, d.Now)
	if s.d.Sessions == nil && d.Store != nil {
		s.d.Sessions = s.resolveSession
	}
	if s.d.CloseSessions == nil && d.Hub != nil {
		s.d.CloseSessions = d.Hub.CloseSessions
	}
	if s.d.Blobs == nil && d.Store != nil {
		s.d.Blobs = store.DBBlobs{R: d.Store.R}
	}
	if s.d.Authorize == nil {
		s.d.Authorize = s.authorize
	}
	s.routesV1()
	s.mux.Handle("/", d.App)
	s.handler = s.recoverMW(s.readDeadlineMW(s.logMW(s.headersMW(s.hostMW(s.csrfMW(s.sessionMW(s.mux)))))))
	return s
}

// CloseSessions ends the live streams of the sessions (Deps.CloseSessions).
func (s *Server) CloseSessions(ids []string) { s.closeSessions(ids) }

// PruneLimiters drops idle rate-limit buckets (housekeeping calls it).
func (s *Server) PruneLimiters() {
	s.ipCodes.Prune()
	s.ipFails.Prune()
	s.ipPeeks.Prune()
	s.reportUser.Prune()
	s.reportSite.Prune()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.handler.ServeHTTP(w, r) }

// Routes returns every registered pattern with its class (tests walk it).
func (s *Server) Routes() map[string]Class {
	out := make(map[string]Class, len(s.routes))
	for k, v := range s.routes {
		out[k] = v
	}
	return out
}

// handle registers pattern behind the gate for class. An unclassified route
// is a programming error and stops the server at startup.
func (s *Server) handle(pattern string, c Class, h http.HandlerFunc) {
	if c == unclassified || classNames[c] == "" {
		panic("api: route " + pattern + " has no class")
	}
	if _, dup := s.routes[pattern]; dup {
		panic("api: route " + pattern + " registered twice")
	}
	s.routes[pattern] = c
	s.mux.Handle(pattern, s.gate(pattern, c, h))
}

// routesV1 is the route table. Later stages add theirs here.
func (s *Server) routesV1() {
	s.handle("GET /api/health", Public, s.health)
	s.handle("GET /api/admin/info", Admin, s.adminInfo)

	// Sign-in and sessions (design §4.3).
	s.handle("POST /api/auth/request", Public, s.authRequest)
	s.handle("POST /api/auth/verify", Public, s.authVerify)
	s.handle("POST /api/auth/link", Public, s.authLink)
	s.handle("POST /api/auth/signout", User, s.authSignout)
	s.handle("GET /api/me", User, s.getMe)
	s.handle("PATCH /api/me", User, s.patchMe)
	s.handle("GET /api/me/sessions", User, s.mySessions)
	s.handle("DELETE /api/me/sessions/{id}", User, s.deleteMySession)
	s.handle("POST /api/me/sessions/revoke-others", User, s.revokeOthers)

	// People on this server (design §4.5).
	s.handle("GET /api/admin/users", Admin, s.adminUsers)
	s.handle("POST /api/admin/users", Admin, s.adminAddUser)
	s.handle("PATCH /api/admin/users/{id}", Admin, s.adminPatchUser)

	// Keys, devices, linking, recovery (design §4.4).
	s.handle("POST /api/devices", User, s.addDevice)
	s.handle("GET /api/devices", User, s.listDevices)
	s.handle("DELETE /api/devices/{id}", User, s.deleteDevice)
	s.handle("GET /api/devices/{id}/wrap", User, s.deviceWrap)
	s.handle("PUT /api/me/keys", User, s.putKeys)
	s.handle("GET /api/me/escrow", Keyed, s.getEscrow)
	s.handle("PUT /api/me/escrow", Keyed, s.putEscrow)
	s.handle("POST /api/me/devices/self-wrap", Keyed, s.selfWrap)
	s.handle("POST /api/link-requests", Keyed, s.addLinkRequest)
	s.handle("GET /api/link-requests", Keyed, s.listLinkRequests)
	s.handle("POST /api/link-requests/{id}/approve", Keyed, s.approveLink)
	s.handle("POST /api/link-requests/{id}/deny", Keyed, s.denyLink)

	// Sites, rosters, members, invites (design §4.6).
	s.handle("GET /api/sites", User, s.listSites)
	s.handle("POST /api/sites", Keyed, s.createSite)
	s.handle("GET /api/sites/{site}", Member, s.getSite)
	s.handle("PATCH /api/sites/{site}", Owner, s.patchSite)
	s.handle("DELETE /api/sites/{site}", Owner, s.deleteSite)
	s.handle("PATCH /api/sites/{site}/me", Member, s.patchSiteMe)
	s.handle("GET /api/sites/{site}/rosters", Reader, s.siteRosters)
	s.handle("GET /api/sites/{site}/keys", Reader, s.siteKeys)
	s.handle("POST /api/sites/{site}/leave", Member, s.leaveSite)
	s.handle("POST /api/sites/{site}/grant", Owner, s.grant)
	s.handle("POST /api/sites/{site}/members/{uid}/role", Owner, s.setRole)
	s.handle("POST /api/sites/{site}/remove", Owner, s.removeMember)
	s.handle("POST /api/sites/{site}/rotate", Owner, s.rotate)
	s.handle("POST /api/sites/{site}/report-mail", Writer, s.reportMail)
	s.handle("POST /api/sites/{site}/invites", Owner, s.invite)
	s.handle("POST /api/sites/{site}/invites/{iid}/resend", Owner, s.resendInvite)
	s.handle("DELETE /api/sites/{site}/invites/{iid}", Owner, s.cancelInvite)
	s.handle("POST /api/invites/peek", Public, s.peekInvite)
	s.handle("POST /api/invites/accept", User, s.acceptInvite)

	// Revisions (design §4.7) and live events (§4.8).
	s.handle("POST /api/sites/{site}/revs", Writer, s.pushRev)
	s.handle("GET /api/sites/{site}/revs", Reader, s.pullRevs)
	s.handle("GET /api/sites/{site}/revs/{n}", Reader, s.getRev)
	s.handle("GET /api/events", User, s.events)

	// Backups (step 5b, D99-D105).
	s.handle("GET /api/admin/backups", Admin, s.adminBackups)
	s.handle("PUT /api/admin/backups", Admin, s.adminPutBackups)
	s.handle("POST /api/admin/backups/test", Admin, s.adminTestBackups)
	s.handle("POST /api/admin/backups/run", Admin, s.adminRunBackups)
	s.handle("POST /api/admin/backups/check", Admin, s.adminCheckBackups)
	s.handle("POST /api/admin/backups/oauth/start", Admin, s.adminOAuthStart)
	s.handle("POST /api/admin/backups/oauth/finish", Admin, s.adminOAuthFinish)
	s.handle("GET "+oauthCallbackPath, Public, s.oauthCallback)
	s.handle("GET /api/admin/backups/deleted/{sid}", Admin, s.adminDeletedBackups)
	s.handle("DELETE /api/admin/backups/deleted/{sid}", Admin, s.adminDeleteDeletedBackups)
	s.handle("GET /api/admin/backups/files/{id}", Admin, s.adminDeletedBackupFile)
	s.handle("GET /api/sites/{site}/backups", Owner, s.siteBackups)
	s.handle("GET /api/sites/{site}/backups/{id}", Owner, s.siteBackupFile)
	s.handle("POST /api/sites/{site}/backups/readable", Owner, s.siteReadableCopy)
	s.handle("DELETE /api/sites/{site}/backups/readable", Owner, s.siteDeleteReadable)
	// Anything else under /api is JSON 404, never the app.
	s.handle("/api/", Public, func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
	})
}

// streaming routes keep their connection open (no write deadline).
var streaming = map[string]bool{"GET /api/events": true}

// gate enforces the route's class.
func (s *Server) gate(pattern string, c Class, h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if info := infoFrom(r.Context()); info != nil {
			info.route = pattern
		}
		if !streaming[pattern] {
			// No server-wide WriteTimeout (SSE stays open); every other
			// handler gets 60 s to write its answer.
			http.NewResponseController(w).SetWriteDeadline(time.Now().Add(60 * time.Second))
		}
		if c == Public {
			h(w, r)
			return
		}
		sess := SessionFrom(r.Context())
		if sess == nil {
			writeError(w, http.StatusUnauthorized, ErrUnauthorized, nil)
			return
		}
		if c != User {
			status := s.d.Authorize(r, c, sess)
			if status != 0 {
				code := ErrForbidden
				switch status {
				case http.StatusNotFound:
					code = ErrNotFound
				case http.StatusUnauthorized:
					code = ErrUnauthorized
				case http.StatusServiceUnavailable:
					code = ErrUnavailable
				}
				writeError(w, status, code, nil)
				return
			}
		}
		h(w, r)
	})
}

// health is public: enough for the browser to know it is on a Topo server
// and for monitoring, nothing about the configuration (amendment D7).
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	setup := false
	if s.d.Cfg.OwnerEmail == "" && s.d.Store != nil {
		has, err := s.d.Store.HasOwner(r.Context())
		if err != nil {
			s.d.Log.Error("health: database", "err", err)
			writeError(w, http.StatusServiceUnavailable, ErrUnavailable, nil)
			return
		}
		setup = !has
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"server":      "topo",
		"api":         1,
		"version":     s.d.Version,
		"appHash":     s.d.App.AppHash,
		"app":         s.d.App.HasApp,
		"secure":      s.d.Cfg.Secure(),
		"setup":       setup,
		"maxRevBytes": s.d.Cfg.MaxRevBytes,
		// Whether this browser's cookie is a live session, so a signed-out
		// page does not ask /api/me only to be told 401 (it says nothing
		// about anyone but the caller).
		"signedIn": SessionFrom(r.Context()) != nil,
	})
}

// adminInfo is what health leaves out, for the server owner.
func (s *Server) adminInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"version":   s.d.Version,
		"build":     s.d.Build,
		"go":        runtime.Version(),
		"os":        runtime.GOOS + "/" + runtime.GOARCH,
		"mail":      s.d.Cfg.Mail,
		"schema":    store.SchemaVersion(),
		"appHash":   s.d.App.AppHash,
		"appFiles":  s.d.App.Count,
		"dataDir":   s.d.Cfg.DataDir,
		"publicUrl": s.d.Cfg.Origin(),
		"backups":   s.backupBrief(r),
	})
}

// backupBrief is {on, kind} for adminInfo.
func (s *Server) backupBrief(r *http.Request) map[string]any {
	out := map[string]any{"on": false, "kind": ""}
	if s.d.Store == nil {
		return out
	}
	if cfg, err := store.GetBackupConfig(r.Context(), s.d.Store.R); err == nil {
		out["on"], out["kind"] = cfg.Enabled && cfg.Kind != "", cfg.Kind
	}
	return out
}
