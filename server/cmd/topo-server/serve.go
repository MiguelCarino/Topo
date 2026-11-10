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
	"sync"
	"time"

	"carino.systems/topo/server/internal/api"
	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/hub"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/notify"
	"carino.systems/topo/server/internal/platform"
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
	key, err := platform.ServerKey(cfg.DataDir)
	if err != nil {
		return fmt.Errorf("server key: %w", err)
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
	handler := api.New(api.Deps{Cfg: cfg, Store: st, App: app, Log: log, Version: version, Build: build, Key: key, Wake: worker.Wake, Hub: events})

	// The mail worker and housekeeping stop with the base context; serve
	// waits for them (an in-flight send finishes) before closing the store.
	var bg sync.WaitGroup
	bg.Add(2)
	go func() { defer bg.Done(); worker.Run(baseCtx) }()
	go func() { defer bg.Done(); housekeeping(baseCtx, st, handler, cfg, log) }()
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
