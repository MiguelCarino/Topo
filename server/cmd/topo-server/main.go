// Command topo-server is the Topo server: one static binary that serves the
// Topo app and its API (email sign-in, sites, end-to-end encrypted sync).
// docs/SERVER.md explains how to host it.
//
//	topo-server [serve]        run the server (default)
//	topo-server healthcheck    exit 0 when the local server answers /api/health
//	topo-server version        print the version
//	topo-server setup-token    mint a new first-sign-in token (no owner yet)
//	topo-server mail-test TO   send one test email through the configured transport
//	topo-server backup-now     back up every changed network now (--check: then check)
//	topo-server lan-addresses  print this PC's LAN IPv4 addresses (the desktop app asks)
//	topo-server service …      install|uninstall|start|stop|configure|status|log the service
//	                           (Windows service, the desktop package's systemd unit, macOS LaunchDaemon)
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/selfcert"
	"carino.systems/topo/server/internal/store"
)

// Set by the Makefile: -X main.version=… -X main.build=….
var (
	version = "0.0.0-dev"
	build   = ""
)

func main() {
	os.Exit(run(os.Args[1:], os.Environ(), os.Stdout, os.Stderr))
}

const usage = `Usage: topo-server [command] [flags]

Commands:
  serve         run the server (the default)
  healthcheck   exit 0 when the server on this machine answers /api/health
  version       print the version
  setup-token   mint a new first sign-in token (only while there is no owner)
  mail-test TO  send one test email to TO through the configured mail settings
  backup-now    back up every changed network now, to the destination set in
                the app (Account, Backups); --check also reads the newest
                backups back. Refused while a running server holds the
                backup lock (use Back up now in the app then)
  lan-addresses print this PC's IPv4 addresses that other PCs can reach,
                one per line (the desktop app's built-in server asks)
  service CMD   install, uninstall, start, stop, configure, status or log
                the service that starts with the computer: a Windows
                service, the systemd unit of the Topo desktop app's rpm/deb,
                or a macOS LaunchDaemon (topo-server service, for details)
  help          this text

Flags (serve, healthcheck, setup-token, mail-test, backup-now):
  --config FILE   KEY=VALUE settings file (also TOPO_CONFIG)
  --static DIR    serve the app from DIR instead of the built-in copy (development)
  --listen ADDR   listen address (also TOPO_LISTEN)

Every setting is a TOPO_* environment variable; docs/SERVER.md lists them.
`

func run(args, environ []string, stdout, stderr io.Writer) int {
	cmd := "serve"
	if len(args) > 0 && len(args[0]) > 0 && args[0][0] != '-' {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "version", "--version", "-v":
		fmt.Fprintf(stdout, "topo-server %s (%s) %s %s/%s\n", version, orUnknown(build), runtime.Version(), runtime.GOOS, runtime.GOARCH)
		return 0
	case "help", "-h", "--help":
		fmt.Fprint(stdout, usage)
		return 0
	case "lan-addresses":
		for _, a := range selfcert.LANAddresses() {
			fmt.Fprintln(stdout, a)
		}
		return 0
	case "service":
		return serviceCommand(args, environ, stdout, stderr)
	case "serve", "healthcheck", "setup-token", "mail-test", "backup-now":
	default:
		fmt.Fprintf(stderr, "topo-server: unknown command %q\n\n%s", cmd, usage)
		return 2
	}

	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(stderr)
	cfgFile := fs.String("config", "", "settings file")
	static := fs.String("static", "", "serve the app from this folder")
	listen := fs.String("listen", "", "listen address")
	var checkToo *bool
	if cmd == "backup-now" {
		checkToo = fs.Bool("check", false, "also check the newest backups")
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}
	var mailTo string
	if cmd == "mail-test" {
		if fs.NArg() != 1 {
			fmt.Fprintln(stderr, "topo-server mail-test: give one address, e.g. topo-server mail-test you@example.com")
			return 2
		}
		mailTo = fs.Arg(0)
	} else if fs.NArg() > 0 {
		fmt.Fprintf(stderr, "topo-server %s: unexpected argument %q\n", cmd, fs.Arg(0))
		return 2
	}
	over := map[string]string{}
	if *static != "" {
		over["TOPO_STATIC"] = *static
	}
	if *listen != "" {
		over["TOPO_LISTEN"] = *listen
	}
	asService := cmd == "serve" && runningAsService()
	res, err := config.Load(config.Options{File: *cfgFile, Environ: environ, Overrides: over, Service: asService})
	if err != nil {
		fmt.Fprintf(stderr, "topo-server: configuration:\n%v\n", err)
		return 2
	}
	cfg := res.Config

	switch cmd {
	case "healthcheck":
		if err := healthcheck(cfg); err != nil {
			fmt.Fprintf(stderr, "topo-server healthcheck: %v\n", err)
			return 1
		}
		return 0
	case "setup-token":
		return setupToken(cfg, stdout, stderr)
	case "mail-test":
		return mailTest(cfg, mailTo, stdout, stderr)
	case "backup-now":
		return backupNow(cfg, *checkToo, stdout, stderr)
	}

	if asService {
		// A Windows service (service_windows.go): the service manager stops
		// it, and the log goes to the event log.
		return runService(func(ctx context.Context, logw io.Writer) error {
			log := newLogger(cfg, logw)
			for _, w := range res.Warnings {
				log.Warn(w)
			}
			err := serve(ctx, cfg, log, nil)
			if err != nil {
				log.Error("server stopped", "err", err)
			}
			return err
		}, stderr)
	}
	log := newLogger(cfg, stderr)
	for _, w := range res.Warnings {
		log.Warn(w)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := serve(ctx, cfg, log, nil); err != nil {
		log.Error("server stopped", "err", err)
		return 1
	}
	return 0
}

func orUnknown(s string) string {
	if s == "" {
		return "unknown build"
	}
	return s
}

func newLogger(cfg *config.Config, w io.Writer) *slog.Logger {
	opts := &slog.HandlerOptions{Level: cfg.LogLevel}
	if cfg.LogFormat == "json" {
		return slog.New(slog.NewJSONHandler(w, opts))
	}
	return slog.New(slog.NewTextHandler(w, opts))
}

// setupToken mints a new first sign-in token into the data folder, for an
// operator who lost the one printed in the log. No running server is
// needed: SQLite's busy timeout lets it share the database with one.
func setupToken(cfg *config.Config, stdout, stderr io.Writer) int {
	if cfg.OwnerEmail != "" {
		fmt.Fprintf(stderr, "topo-server: TOPO_OWNER_EMAIL is set (%s): that address signs in as the owner, no token is needed\n", cfg.OwnerEmail)
		return 1
	}
	// Never a new, empty database: a token minted there would never reach
	// the running server (a systemd unit or a container sets its own
	// TOPO_DATA, which this shell may not have).
	if _, err := os.Stat(filepath.Join(cfg.DataDir, store.FileName)); err != nil {
		fmt.Fprintf(stderr, "topo-server: no Topo server data in %s. Start the server once, or point TOPO_DATA at the server's folder:\n"+
			"  systemd:   sudo env TOPO_DATA=/var/lib/topo topo-server setup-token\n"+
			"  container: podman exec <container> /topo-server setup-token\n", cfg.DataDir)
		return 1
	}
	st, err := store.Open(cfg.DataDir, nil)
	if err != nil {
		fmt.Fprintf(stderr, "topo-server: %v\n", err)
		return 1
	}
	defer st.Close()
	ctx := context.Background()
	has, err := st.HasOwner(ctx)
	if err != nil {
		fmt.Fprintf(stderr, "topo-server: %v\n", err)
		return 1
	}
	if has {
		fmt.Fprintln(stderr, "topo-server: this server already has an owner; the owner adds people from Account, People on this server")
		return 1
	}
	tok, err := auth.MintSetupToken(ctx, st)
	if err != nil {
		fmt.Fprintf(stderr, "topo-server: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "%s\n", tok)
	fmt.Fprintf(stderr, "Data folder: %s\nType this token at the first sign-in to become the server owner. Any older token stopped working.\n", cfg.DataDir)
	return 0
}

// mailTest sends one message through the configured transport, right away
// (no outbox, no running server needed), and prints the outcome: the setup
// check for TOPO_SMTP_*.
func mailTest(cfg *config.Config, to string, stdout, stderr io.Writer) int {
	addr, ok := auth.NormalizeEmail(to)
	if !ok {
		fmt.Fprintf(stderr, "topo-server mail-test: %q is not an email address\n", to)
		return 2
	}
	log := newLogger(cfg, stderr)
	m, err := mail.New(cfg, log, mail.Options{})
	if err != nil {
		fmt.Fprintf(stderr, "topo-server mail-test: %v\n", err)
		return 1
	}
	msg, err := mail.Render("test", "en", mail.Data{"url": cfg.Origin() + "/"})
	if err != nil {
		fmt.Fprintf(stderr, "topo-server mail-test: %v\n", err)
		return 1
	}
	msg.To, msg.ID = addr, store.NewID("o_")
	if err := m.Send(context.Background(), msg); err != nil {
		fmt.Fprintf(stderr, "topo-server mail-test: not sent (%s): %v\n", m.Name(), err)
		return 1
	}
	where := ""
	if m.Name() == "file" {
		where = " into " + cfg.MailDir
	}
	fmt.Fprintf(stdout, "Sent a test email to %s through %s%s.\n", addr, m.Name(), where)
	return 0
}

// backupNow runs the backup engine once, outside a running server (cron,
// debugging). The lease row in the database (amendment 11) keeps it from
// running beside a server that is backing up the same data folder.
func backupNow(cfg *config.Config, check bool, stdout, stderr io.Writer) int {
	if _, err := os.Stat(filepath.Join(cfg.DataDir, store.FileName)); err != nil {
		fmt.Fprintf(stderr, "topo-server: no Topo server data in %s (point TOPO_DATA at the server's folder)\n", cfg.DataDir)
		return 1
	}
	if rootOnForeignData(cfg.DataDir) {
		fmt.Fprintf(stderr, "topo-server: run backup-now as the user that owns %s (e.g. sudo -u topo ...), not as root: files root makes there would lock the server out\n", cfg.DataDir)
		return 1
	}
	key, err := loadServerKey(cfg)
	if err != nil {
		fmt.Fprintf(stderr, "topo-server: server key: %v\n", err)
		return 1
	}
	st, err := store.Open(cfg.DataDir, nil)
	if err != nil {
		fmt.Fprintf(stderr, "topo-server: %v\n", err)
		return 1
	}
	defer st.Close()
	ctx := context.Background()
	bc, err := store.GetBackupConfig(ctx, st.R)
	if err != nil {
		fmt.Fprintf(stderr, "topo-server: %v\n", err)
		return 1
	}
	if !bc.Enabled || bc.Kind == "" {
		fmt.Fprintln(stderr, "topo-server: backups are off. The server owner turns them on in the app: Account, Backups.")
		return 1
	}
	log := newLogger(cfg, stderr)
	e := newBackupEngine(cfg, st, key, log, nil)
	ok, err := e.Lease(ctx)
	if err != nil {
		fmt.Fprintf(stderr, "topo-server: %v\n", err)
		return 1
	}
	if !ok {
		fmt.Fprintln(stderr, "topo-server: a running Topo server is backing up this data folder; use Back up now in the app (Account, Backups)")
		return 1
	}
	defer e.Release(ctx)
	if err := e.RunNow(ctx); err != nil {
		fmt.Fprintf(stderr, "topo-server: %v\n", err)
		return 1
	}
	if check {
		if err := e.CheckNow(ctx); err != nil {
			fmt.Fprintf(stderr, "topo-server: %v\n", err)
			return 1
		}
	}
	bs, err := store.GetBackupState(ctx, st.R)
	if err != nil {
		fmt.Fprintf(stderr, "topo-server: %v\n", err)
		return 1
	}
	code := 0
	if bs.LastErr != "" {
		fmt.Fprintf(stderr, "Backups: failed (%s). The server owners get an email when the server next runs.\n", bs.LastErr)
		code = 1
	} else {
		fmt.Fprintln(stdout, "Backups: done.")
	}
	if check {
		if bs.LastCheckOK {
			fmt.Fprintln(stdout, "Check: passed.")
		} else {
			fmt.Fprintf(stderr, "Check: failed (%s).\n", bs.LastCheckErr)
			code = 1
		}
	}
	return code
}
