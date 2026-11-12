package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"carino.systems/topo/server/internal/api"
	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/hub"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/notify"
	"carino.systems/topo/server/internal/platform"
	"carino.systems/topo/server/internal/selfcert"
	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/web"
)

// shutdownTimeout bounds a graceful stop (systemd's TimeoutStopSec is 60 s).
var shutdownTimeout = 45 * time.Second

// serve runs the server until ctx ends, then shuts down gracefully: new
// connections stop, open requests get shutdownTimeout to finish, long-lived
// streams (SSE, stage 3) end through the base context, and the database is
// checkpointed and closed. ready, when set, gets the bound address once the
// listener is up (tests listen on port 0).
func serve(ctx context.Context, cfg *config.Config, log *slog.Logger, ready func(addr string)) error {
	if err := platform.EnsureDir(cfg.DataDir); err != nil {
		return fmt.Errorf("data folder %s: %w", cfg.DataDir, err)
	}
	key, err := loadServerKey(cfg)
	if err != nil {
		return fmt.Errorf("server key: %w", err)
	}
	// The default backup folder lives in the data folder (never a mount
	// point), so it is made here; a folder named in TOPO_BACKUP_FOLDERS is
	// the installer's to make (amendment 13).
	if cfg.BackupFoldersDefaulted {
		for _, f := range cfg.BackupFolders {
			if err := platform.EnsureDir(f); err != nil {
				return fmt.Errorf("backup folder %s: %w", f, err)
			}
		}
	}

	st, err := store.Open(cfg.DataDir, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err := st.Close(); err != nil {
			log.Error("closing the database", "err", err)
		}
	}()

	var appFS fs.FS
	source := "built in"
	if cfg.Static != "" {
		appFS, source = os.DirFS(cfg.Static), cfg.Static
	} else {
		appFS = web.App()
	}
	app, err := api.LoadApp(appFS)
	if err != nil {
		return fmt.Errorf("app (%s): %w", source, err)
	}
	if app.HasApp {
		log.Info("app loaded", "from", source, "files", app.Count, "kb", app.Bytes/1024, "appHash", app.AppHash)
	} else {
		log.Warn("this build has no app: / answers 503 until the binary is built after make stage", "from", source)
	}

	// The certificate is loaded before anything else can fail late: a pair
	// that is missing or unreadable stops the start.
	var cr *certReloader
	if cfg.TLSSelf {
		if err := ensureSelfCert(cfg, log, time.Now()); err != nil {
			return err
		}
	}
	if cfg.TLSCert != "" {
		if cr, err = newCertReloader(cfg.TLSCert, cfg.TLSKey, log); err != nil {
			return err
		}
	}

	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.Listen, err)
	}
	addr := ln.Addr().String()
	if cfg.PublicDefaulted {
		// A ":0" listen (tests) gets its real port in the public URL, which the
		// Origin and Host checks compare against.
		cfg.PublicURL = &url.URL{Scheme: cfg.PublicURL.Scheme, Host: addr}
	}

	mailer, err := mail.New(cfg, log, mail.Options{})
	if err != nil {
		ln.Close()
		return err
	}
	// Bound and the mailer built first, so a start that cannot listen or
	// send leaves the setup token alone.
	if err := firstRun(ctx, cfg, st, log); err != nil {
		ln.Close()
		return err
	}
	worker := notify.New(st, mailer, log, nil, cfg.Origin()+"/", cfg.MailPerMinute)
	events := hub.New()
	worker.Online = events.Online

	baseCtx, cancelBase := context.WithCancel(context.Background())
	defer cancelBase()
	backups := newBackupEngine(cfg, st, key, log, worker.Wake)
	handler := api.New(api.Deps{Cfg: cfg, Store: st, App: app, Log: log, Version: version, Build: build, Key: key, Wake: worker.Wake, Hub: events, Backups: backups})

	// The mail worker and housekeeping stop with the base context; serve
	// waits for them (an in-flight send finishes) before closing the store.
	var bg sync.WaitGroup
	bg.Add(4)
	go func() { defer bg.Done(); worker.Run(baseCtx) }()
	go func() { defer bg.Done(); backups.Run(baseCtx) }()
	go func() { defer bg.Done(); housekeeping(baseCtx, st, handler, cfg, log) }()
	go func() { defer bg.Done(); monitorSweep(baseCtx, handler, cfg.MonitorSweep) }()
	defer func() { cancelBase(); bg.Wait() }()
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
		// No WriteTimeout: Server-Sent Events stay open. Ordinary handlers
		// set their own write deadline (stage 2 onward).
		BaseContext: func(net.Listener) context.Context { return baseCtx },
		ErrorLog:    slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
	srv.RegisterOnShutdown(cancelBase)

	if cr != nil {
		go cr.watch(baseCtx)
		ln = tls.NewListener(ln, cr.tlsConfig())
	}

	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	log.Info("topo server listening", "addr", addr, "public", cfg.Origin(), "secure", cfg.Secure(), "mail", cfg.Mail, "data", cfg.DataDir, "version", version)
	// The plain-http-on-every-interface warning (B6) comes from config.Load
	// and is logged by run() at every start.
	if ready != nil {
		ready(addr)
	}

	select {
	case err := <-errc:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	sctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		log.Warn("graceful shutdown cut short", "err", err)
		srv.Close()
	}
	if err := <-errc; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Info("stopped")
	return nil
}

// firstRun handles the bootstrap owner (D53, amendment B5): with
// TOPO_OWNER_EMAIL that address is the owner (promoted here if the user
// exists, created as owner at its first sign-in otherwise). Without it, while there is no
// owner, every start mints a new setup token and logs it once.
func firstRun(ctx context.Context, cfg *config.Config, st *store.Store, log *slog.Logger) error {
	has, err := st.HasOwner(ctx)
	if err != nil {
		return err
	}
	if cfg.OwnerEmail != "" {
		// D53: the configured owner email is ensured at every start. It
		// promotes (and re-enables) that user, never demotes anyone.
		promoted, err := st.EnsureOwnerEmail(ctx, cfg.OwnerEmail)
		if err != nil {
			return err
		}
		if promoted {
			log.Info("the owner email is now a server owner", "owner", mail.Mask(cfg.OwnerEmail))
			has = true
		}
	}
	if has {
		return auth.BurnSetupToken(ctx, st)
	}
	if cfg.OwnerEmail != "" {
		log.Info("no owner yet: the owner email signs in first", "owner", mail.Mask(cfg.OwnerEmail))
		return auth.BurnSetupToken(ctx, st)
	}
	tok, err := auth.MintSetupToken(ctx, st)
	if err != nil {
		return err
	}
	log.Warn("no owner yet: the first person to sign in types this setup token to become the owner (a new one is made at every start until then; `topo-server setup-token` makes one too)", "token", tok)
	return nil
}

// housekeeping runs every 10 minutes until ctx ends: expired challenges,
// sessions, link requests and invites, old rate rows and sent mail
// (design §3), and idle rate-limit buckets.
func housekeeping(ctx context.Context, st *store.Store, h *api.Server, cfg *config.Config, log *slog.Logger) {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		ids, err := st.Housekeep(ctx, time.Now().UnixMilli(), store.HousekeepLimits{SessionIdleMs: cfg.SessionIdle.Milliseconds()})
		if err != nil && ctx.Err() == nil {
			log.Error("housekeeping", "err", err)
		} else if len(ids) > 0 {
			h.CloseSessions(ids)
		}
		h.PruneLimiters()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// monitorSweep looks for site monitors that stopped reporting (missed 3
// heartbeat intervals, docs/SCOPE.md D151) every TOPO_MONITOR_SWEEP (30 s;
// the end-to-end test shortens it) until ctx ends.
func monitorSweep(ctx context.Context, h *api.Server, every time.Duration) {
	if every <= 0 {
		every = 30 * time.Second
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.SweepMonitors(ctx)
		}
	}
}

// loadServerKey reads server.key: TOPO_SERVER_KEY when set (never created
// there, amendment 21), else <data>/server.key (made at the first start).
func loadServerKey(cfg *config.Config) ([]byte, error) {
	if cfg.ServerKeyPath != "" {
		return platform.ServerKeyAt(cfg.ServerKeyPath, false)
	}
	return platform.ServerKey(cfg.DataDir)
}

// ensureSelfCert makes or keeps the self-signed certificate of
// TOPO_TLS_SELF (D113) and logs its fingerprint, which people compare with
// what their browser shows before they accept it.
func ensureSelfCert(cfg *config.Config, log *slog.Logger, now time.Time) error {
	hostname, _ := os.Hostname()
	extra := append([]string{cfg.PublicURL.Hostname()}, cfg.AllowedHosts...)
	lan := selfcert.LANAddresses()
	if len(lan) == 0 && wildcardListen(cfg.Listen) {
		log.Warn("self-signed certificate: no LAN address found (a sandbox without AF_NETLINK?); other PCs reaching this server by IP will see a name mismatch")
	}
	res, err := selfcert.Ensure(filepath.Dir(cfg.TLSCert), selfcert.Default(hostname, lan, extra...), now)
	if err != nil {
		return fmt.Errorf("self-signed certificate in %s: %w", filepath.Dir(cfg.TLSCert), err)
	}
	if res.Made {
		log.Info("made a self-signed certificate", "why", res.Why, "until", res.NotAfter.Format("2006-01-02"))
	}
	log.Info("self-signed certificate: compare this fingerprint with the one the browser shows before accepting it", "sha256", res.Fingerprint)
	return nil
}

// wildcardListen reports a listen address on every interface.
func wildcardListen(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	return host == "" || host == "0.0.0.0" || host == "::"
}

// newBackupEngine builds the backup engine (step 5b).
func newBackupEngine(cfg *config.Config, st *store.Store, key []byte, log *slog.Logger, wake func()) *backup.Engine {
	return backup.New(backup.Options{
		Store: st, Key: key, Origin: cfg.Origin(), Roots: cfg.BackupFolders,
		Debounce: cfg.BackupDebounce, Tick: cfg.BackupTick, Log: log.With("part", "backups"), Wake: wake,
	})
}
