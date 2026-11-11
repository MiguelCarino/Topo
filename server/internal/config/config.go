// Package config loads the server's settings: one optional KEY=VALUE file
// (systemd EnvironmentFile syntax, so the same file serves the binary,
// systemd and `podman --env-file`), then the process environment, which
// wins. Only TOPO_* keys are read. An unknown TOPO_* key is a startup error,
// so a typo never silently falls back to a default.
package config

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/mail"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SMTP is the client's own mail server (sign-in codes and notifications).
type SMTP struct {
	Host     string
	Port     int
	Security string // starttls | tls | none
	User     string
	Pass     string
	From     string // as configured, e.g. `Topo <topo@example.com>`
	HELO     string
}

// Config is the validated configuration. Every field is final after Load.
type Config struct {
	DataDir string
	Listen  string

	// PublicURL is the origin people reach the server at (scheme://host[:port],
	// no path). PublicDefaulted is true when it was derived from a loopback
	// Listen; serve then fixes the port once a ":0" listener is bound.
	PublicURL       *url.URL
	PublicDefaulted bool

	AllowedHosts []string
	TLSCert      string
	TLSKey       string
	// TLSSelf is TOPO_TLS_SELF: the server makes its own self-signed
	// certificate in <data>/tls (the desktop app's LAN server, D113).
	// TLSCert and TLSKey then name those files.
	TLSSelf        bool
	TrustedProxies []netip.Prefix
	OwnerEmail     string

	Mail          string // smtp | file | log
	MailDir       string
	SMTP          SMTP
	MailPerMinute int

	Static string // serve the app from this folder instead of the embedded copy

	MaxRevBytes           int64
	RevCap                int
	SiteMaxBytes          int64
	SessionIdle           time.Duration
	SessionMax            time.Duration
	CodeTTL               time.Duration
	NotifyRevisionMinutes int
	// NotifyEventDelay is TOPO_NOTIFY_EVENT_SECONDS: how long an event email
	// waits (merging repeats). 0 seconds is stored as -1ns ("no wait"), so
	// the zero value of Config keeps the 2-minute default.
	NotifyEventDelay time.Duration

	LogLevel  slog.Level
	LogFormat string // text | json

	// Backups (step 5b). The destination itself is set in the app
	// (Account, Backups) and kept in the database (D99); these say where a
	// folder destination may be (whoever installs the server decides) and
	// how quickly the engine runs.
	BackupFolders          []string      // TOPO_BACKUP_FOLDERS; default <data>/backups
	BackupFoldersDefaulted bool          // the default above (serve creates it)
	BackupDebounce         time.Duration // TOPO_BACKUP_DEBOUNCE, default 2m (0 = at once)
	BackupTick             time.Duration // TOPO_BACKUP_TICK, default 30s
	// ServerKeyPath is TOPO_SERVER_KEY: server.key somewhere else. Set, the
	// file must exist (it is never created there, amendment 21).
	ServerKeyPath string

	// Reserved holds keys that a later step uses (backups, Postgres, blob
	// stores). They are accepted so a config written ahead of time loads,
	// and logged as not yet used.
	Reserved map[string]string
}

// Secure reports whether the server is reached over https (built-in TLS or a
// reverse proxy named by an https public URL). Without it, cookies drop the
// Secure flag and the __Host- prefix, which D52 allows on loopback only.
func (c *Config) Secure() bool {
	return c.TLSCert != "" || c.PublicURL.Scheme == "https"
}

// Origin is scheme://host[:port] of the public URL.
func (c *Config) Origin() string {
	return c.PublicURL.Scheme + "://" + c.PublicURL.Host
}

// ListenIsLoopback reports whether the listen address is a loopback address
// (or localhost). ":7380" and "0.0.0.0:7380" are not.
func (c *Config) ListenIsLoopback() bool {
	host, _, err := net.SplitHostPort(c.Listen)
	if err != nil {
		return false
	}
	return IsLoopbackHost(host)
}

// IsLoopbackHost reports whether host (no port, brackets optional) is
// localhost or a loopback IP.
func IsLoopbackHost(host string) bool {
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip, err := netip.ParseAddr(host)
	return err == nil && ip.IsLoopback()
}

// key describes one setting.
type key struct {
	name   string
	secret bool // allowed as NAME_FILE as well
}

// Known keys. Order is the documented order (docs/SERVER.md).
var known = []key{
	{"TOPO_CONFIG", false},
	{"TOPO_DATA", false},
	{"TOPO_LISTEN", false},
	{"TOPO_PUBLIC_URL", false},
	{"TOPO_ALLOWED_HOSTS", false},
	{"TOPO_TLS_CERT", false},
	{"TOPO_TLS_KEY", false},
	{"TOPO_TLS_SELF", false},
	{"TOPO_TRUSTED_PROXIES", false},
	{"TOPO_OWNER_EMAIL", true},
	{"TOPO_MAIL", false},
	{"TOPO_MAIL_DIR", false},
	{"TOPO_SMTP_HOST", false},
	{"TOPO_SMTP_PORT", false},
	{"TOPO_SMTP_SECURITY", false},
	{"TOPO_SMTP_USER", true},
	{"TOPO_SMTP_PASS", true},
	{"TOPO_SMTP_FROM", false},
	{"TOPO_SMTP_HELO", false},
	{"TOPO_MAIL_PER_MINUTE", false},
	{"TOPO_STATIC", false},
	{"TOPO_MAX_REV_BYTES", false},
	{"TOPO_REV_CAP", false},
	{"TOPO_SITE_MAX_BYTES", false},
	{"TOPO_SESSION_IDLE", false},
	{"TOPO_SESSION_MAX", false},
	{"TOPO_CODE_TTL", false},
	{"TOPO_NOTIFY_REVISION_MINUTES", false},
	{"TOPO_NOTIFY_EVENT_SECONDS", false},
	{"TOPO_LOG_LEVEL", false},
	{"TOPO_LOG_FORMAT", false},
	{"TOPO_BACKUP_FOLDERS", false},
	{"TOPO_BACKUP_DEBOUNCE", false},
	{"TOPO_BACKUP_TICK", false},
	{"TOPO_SERVER_KEY", false},
}

// reservedExact are keys for a later step (Postgres, blob stores):
// accepted, logged as "not yet used".
var reservedExact = map[string]bool{
	"TOPO_DB":    true,
	"TOPO_BLOBS": true,
}
var reservedPrefix = []string{}

// retiredExact and retiredPrefix were reserved for backups before 5b; the
// destination is now set in the app. Accepted (an old config file still
// loads) and logged as ignored.
var retiredExact = map[string]bool{
	"TOPO_BACKUP_DEST":     true,
	"TOPO_BACKUP_SCHEDULE": true,
	"TOPO_BACKUP_KEEP":     true,
}
var retiredPrefix = []string{"TOPO_BACKUP_WEBDAV_", "TOPO_BACKUP_S3_"}

func isRetired(k string) bool {
	if retiredExact[k] {
		return true
	}
	for _, p := range retiredPrefix {
		if strings.HasPrefix(k, p) {
			return true
		}
	}
	return false
}

// ignoredPrefix are TOPO_* variables that belong to tools around the server
// (the e2e runner), never to the server itself.
var ignoredPrefix = []string{"TOPO_E2E_"}

func isReserved(k string) bool {
	if reservedExact[k] {
		return true
	}
	for _, p := range reservedPrefix {
		if strings.HasPrefix(k, p) {
			return true
		}
	}
	return false
}

func isIgnored(k string) bool {
	for _, p := range ignoredPrefix {
		if strings.HasPrefix(k, p) {
			return true
		}
	}
	return false
}

// Options are the inputs of Load. Environ is "K=V" pairs (os.Environ());
// File is the config file (TOPO_CONFIG or --config; empty for none);
// Overrides are applied last (command-line flags such as --static).
type Options struct {
	File      string
	Environ   []string
	Overrides map[string]string
	// GOOS picks the default data folder; empty means runtime.GOOS.
	GOOS string
	// Home is the user's home folder for the default data folder; empty means
	// os.UserHomeDir().
	Home string
	// Service is true when the binary runs as a Windows service: the
	// default data folder is then %ProgramData%\Topo, never the service
	// account's own profile (D112).
	Service bool
}

// Result is a loaded config plus the warnings to log once the logger exists.
type Result struct {
	Config   *Config
	Warnings []string
}

// Load reads the file, then the environment, then the overrides, and
// validates the result.
func Load(o Options) (*Result, error) {
	env := map[string]string{}
	for _, kv := range o.Environ {
		k, v, ok := strings.Cut(kv, "=")
		if ok {
			env[k] = v
		}
	}
	file := o.File
	if file == "" {
		file = env["TOPO_CONFIG"]
	}
	if v, ok := o.Overrides["TOPO_CONFIG"]; ok && v != "" {
		file = v
	}

	vals := map[string]string{}
	var warnings []string
	if file != "" {
		fv, w, err := ReadFile(file)
		if err != nil {
			return nil, err
		}
		warnings = append(warnings, w...)
		for k, v := range fv {
			vals[k] = v
		}
	}
	for k, v := range env {
		if strings.HasPrefix(k, "TOPO_") {
			vals[k] = v
		}
	}
	for k, v := range o.Overrides {
		vals[k] = v
	}

	if err := resolveFiles(vals); err != nil {
		return nil, err
	}

	knownSet := map[string]bool{}
	for _, k := range known {
		knownSet[k.name] = true
	}
	reserved := map[string]string{}
	var unknown, retired []string
	for k, v := range vals {
		switch {
		case knownSet[k]:
		case isReserved(k):
			reserved[k] = v
		case isRetired(k):
			retired = append(retired, k)
			delete(vals, k)
		case isIgnored(k):
			delete(vals, k)
		default:
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return nil, fmt.Errorf("unknown setting %s (check the spelling; docs/SERVER.md lists every key)", strings.Join(unknown, ", "))
	}
	if len(reserved) > 0 {
		names := make([]string, 0, len(reserved))
		for k := range reserved {
			names = append(names, k)
		}
		sort.Strings(names)
		warnings = append(warnings, "settings for a later Topo server are not used yet: "+strings.Join(names, ", "))
	}
	if len(retired) > 0 {
		sort.Strings(retired)
		warnings = append(warnings, "backups are set in the app (Account, Backups); ignored: "+strings.Join(retired, ", "))
	}

	c, w, err := build(vals, o)
	if err != nil {
		return nil, err
	}
	c.Reserved = reserved
	warnings = append(warnings, w...)
	return &Result{Config: c, Warnings: warnings}, nil
}

// resolveFiles turns NAME_FILE into NAME for the secret keys (podman and
// systemd credentials). Setting both is an error.
func resolveFiles(vals map[string]string) error {
	for _, k := range known {
		fk := k.name + "_FILE"
		path, ok := vals[fk]
		if !ok {
			continue
		}
		delete(vals, fk)
		if !k.secret {
			return fmt.Errorf("%s: only secret settings can be read from a file", fk)
		}
		if _, both := vals[k.name]; both {
			return fmt.Errorf("set %s or %s, not both", k.name, fk)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("%s: %w", fk, err)
		}
		vals[k.name] = strings.TrimRight(string(b), "\r\n")
	}
	return nil
}

// ReadFile parses a KEY=VALUE file: blank lines and lines starting with #
// are skipped, values may be wrapped in single or double quotes. Keys that
// are not TOPO_* are ignored with a warning (an env file shared with a
// container may carry TZ and the like).
func ReadFile(path string) (map[string]string, []string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("config file: %w", err)
	}
	return parseFile(path, b)
}

func parseFile(path string, b []byte) (map[string]string, []string, error) {
	out := map[string]string{}
	var warnings []string
	sc := bufio.NewScanner(bytes.NewReader(b))
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	line := 0
	for sc.Scan() {
		line++
		s := strings.TrimSpace(sc.Text())
		if line == 1 {
			s = strings.TrimPrefix(s, "\ufeff")
		}
		if s == "" || strings.HasPrefix(s, "#") || strings.HasPrefix(s, ";") {
			continue
		}
		k, v, ok := strings.Cut(s, "=")
		if !ok {
			return nil, nil, fmt.Errorf("%s:%d: expected KEY=VALUE", path, line)
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' && v[len(v)-1] == '"' || v[0] == '\'' && v[len(v)-1] == '\'') {
			v = v[1 : len(v)-1]
		}
		if k == "" || strings.ContainsAny(k, " \t") {
			return nil, nil, fmt.Errorf("%s:%d: bad key %q", path, line, k)
		}
		if !strings.HasPrefix(k, "TOPO_") {
			warnings = append(warnings, fmt.Sprintf("%s:%d: %s is not a Topo setting and is ignored", path, line, k))
			continue
		}
		out[k] = v
	}
	if err := sc.Err(); err != nil {
		return nil, nil, fmt.Errorf("%s: %w", path, err)
	}
	return out, warnings, nil
}

// DefaultDataDir is the per-user data folder for a server run outside a
// container (the container sets TOPO_DATA=/data).
func DefaultDataDir(goos, home string, env map[string]string) string {
	switch goos {
	case "windows-service":
		if v := env["ProgramData"]; v != "" {
			return filepath.Join(v, "Topo")
		}
		return `C:\ProgramData\Topo`
	case "windows":
		if v := env["LOCALAPPDATA"]; v != "" {
			return filepath.Join(v, "Topo")
		}
		return filepath.Join(home, "AppData", "Local", "Topo")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Topo")
	default:
		if v := env["XDG_DATA_HOME"]; v != "" && filepath.IsAbs(v) {
			return filepath.Join(v, "topo")
		}
		return filepath.Join(home, ".local", "share", "topo")
	}
}

func build(v map[string]string, o Options) (*Config, []string, error) {
	var warnings []string
	var errs []string
	fail := func(format string, a ...any) { errs = append(errs, fmt.Sprintf(format, a...)) }

	c := &Config{}

	// Data folder.
	c.DataDir = v["TOPO_DATA"]
	if c.DataDir == "" {
		goos := o.GOOS
		if goos == "" {
			goos = runtime.GOOS
		}
		home := o.Home
		if home == "" {
			home, _ = os.UserHomeDir()
		}
		env := map[string]string{}
		for _, kv := range o.Environ {
			if k, val, ok := strings.Cut(kv, "="); ok {
				env[k] = val
			}
		}
		if o.Service && goos == "windows" {
			goos = "windows-service"
		}
		// An admin command run from a prompt with the service's settings
		// file (backup-now --config C:\ProgramData\Topo\topo.conf) uses
		// the service's data, not the admin's own profile.
		if goos == "windows" && o.File != "" &&
			strings.EqualFold(filepath.Clean(filepath.Dir(o.File)), filepath.Clean(DefaultDataDir("windows-service", home, env))) {
			goos = "windows-service"
		}
		if home == "" && env["LOCALAPPDATA"] == "" && env["XDG_DATA_HOME"] == "" && goos != "windows-service" {
			fail("TOPO_DATA is not set and there is no home folder to put the data in")
		} else {
			c.DataDir = DefaultDataDir(goos, home, env)
		}
	}
	if c.DataDir != "" {
		if abs, err := filepath.Abs(c.DataDir); err == nil {
			c.DataDir = abs
		}
	}

	// Listen.
	c.Listen = orDefault(v["TOPO_LISTEN"], "127.0.0.1:7380")
	lhost, lport, err := net.SplitHostPort(c.Listen)
	if err != nil {
		fail("TOPO_LISTEN %q: want host:port, e.g. 127.0.0.1:7380 or :7380", c.Listen)
	} else if p, err := strconv.Atoi(lport); err != nil || p < 0 || p > 65535 {
		fail("TOPO_LISTEN %q: bad port", c.Listen)
	}

	// TLS.
	c.TLSCert, c.TLSKey = v["TOPO_TLS_CERT"], v["TOPO_TLS_KEY"]
	if (c.TLSCert == "") != (c.TLSKey == "") {
		fail("set both TOPO_TLS_CERT and TOPO_TLS_KEY, or neither")
	}
	switch strings.ToLower(strings.TrimSpace(v["TOPO_TLS_SELF"])) {
	case "", "0", "false", "no", "off":
	case "1", "true", "yes", "on":
		if c.TLSCert != "" {
			fail("set TOPO_TLS_SELF or TOPO_TLS_CERT and TOPO_TLS_KEY, not both")
		} else if c.DataDir != "" {
			// The files the server makes at start (tlsself.go).
			c.TLSSelf = true
			c.TLSCert = filepath.Join(c.DataDir, "tls", "cert.pem")
			c.TLSKey = filepath.Join(c.DataDir, "tls", "key.pem")
		}
	default:
		fail("TOPO_TLS_SELF %q: want 1 or 0", v["TOPO_TLS_SELF"])
	}

	// Public URL.
	if pu := v["TOPO_PUBLIC_URL"]; pu != "" {
		u, err := parsePublicURL(pu)
		if err != nil {
			fail("TOPO_PUBLIC_URL: %v", err)
		} else {
			c.PublicURL = u
		}
	} else if err == nil && IsLoopbackHost(lhost) {
		scheme := "http"
		if c.TLSCert != "" {
			scheme = "https"
		}
		c.PublicURL = &url.URL{Scheme: scheme, Host: c.Listen}
		c.PublicDefaulted = true
	} else if err == nil {
		fail("TOPO_PUBLIC_URL is required when TOPO_LISTEN (%s) is not a loopback address: it is the https address people open", c.Listen)
	}

	// D52: E2E needs a secure context. Plain http only on loopback.
	if c.PublicURL != nil {
		if c.TLSCert != "" && c.PublicURL.Scheme != "https" {
			fail("TOPO_PUBLIC_URL must be https:// when built-in TLS (TOPO_TLS_CERT) is on")
		}
		if !c.Secure() {
			publicLoop := IsLoopbackHost(c.PublicURL.Hostname())
			listenLoop := err == nil && IsLoopbackHost(lhost)
			switch {
			case !publicLoop:
				fail("TOPO_PUBLIC_URL %s is plain http on a non-loopback host. Browsers allow the encryption Topo needs only over https: put a reverse proxy with https in front (and set an https TOPO_PUBLIC_URL), or set TOPO_TLS_CERT and TOPO_TLS_KEY", c.Origin())
			case !listenLoop:
				// B6: inside a container the published port decides who can
				// reach this; the server cannot tell.
				warnings = append(warnings, fmt.Sprintf("plain http on %s with a loopback public URL (%s): publish the port on 127.0.0.1 only (-p 127.0.0.1:7380:7380). Published on every interface, sign-in would travel in clear on the network", c.Listen, c.Origin()))
			}
		}
	}

	// Hosts.
	for _, h := range splitList(v["TOPO_ALLOWED_HOSTS"]) {
		if strings.ContainsAny(h, "/ ") {
			fail("TOPO_ALLOWED_HOSTS: %q is not a host name", h)
			continue
		}
		c.AllowedHosts = append(c.AllowedHosts, strings.ToLower(h))
	}
	for _, p := range splitList(v["TOPO_TRUSTED_PROXIES"]) {
		pf, err := netip.ParsePrefix(p)
		if err != nil {
			if a, err2 := netip.ParseAddr(p); err2 == nil {
				pf = netip.PrefixFrom(a, a.BitLen())
			} else {
				fail("TOPO_TRUSTED_PROXIES: %q is not an address or CIDR", p)
				continue
			}
		}
		c.TrustedProxies = append(c.TrustedProxies, pf.Masked())
	}

	// Owner.
	if e := strings.TrimSpace(v["TOPO_OWNER_EMAIL"]); e != "" {
		a, err := mail.ParseAddress(e)
		if err != nil || a.Name != "" || !strings.Contains(a.Address, "@") {
			fail("TOPO_OWNER_EMAIL %q is not one email address", e)
		} else {
			c.OwnerEmail = strings.ToLower(a.Address)
		}
	}

	// Mail.
	c.SMTP.Host = v["TOPO_SMTP_HOST"]
	c.Mail = v["TOPO_MAIL"]
	if c.Mail == "" {
		c.Mail = "log"
		if c.SMTP.Host != "" {
			c.Mail = "smtp"
		}
	}
	switch c.Mail {
	case "smtp", "file", "log":
	default:
		fail("TOPO_MAIL %q: want smtp, file or log", c.Mail)
	}
	c.MailDir = v["TOPO_MAIL_DIR"]
	if c.MailDir == "" && c.DataDir != "" {
		c.MailDir = filepath.Join(c.DataDir, "mail")
	}
	c.SMTP.Port = 587
	if p := v["TOPO_SMTP_PORT"]; p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1 || n > 65535 {
			fail("TOPO_SMTP_PORT %q: bad port", p)
		} else {
			c.SMTP.Port = n
		}
	}
	c.SMTP.Security = v["TOPO_SMTP_SECURITY"]
	if c.SMTP.Security == "" {
		c.SMTP.Security = "starttls"
		if c.SMTP.Port == 465 {
			c.SMTP.Security = "tls"
		}
	}
	switch c.SMTP.Security {
	case "starttls", "tls", "none":
	default:
		fail("TOPO_SMTP_SECURITY %q: want starttls, tls or none", c.SMTP.Security)
	}
	c.SMTP.User, c.SMTP.Pass = v["TOPO_SMTP_USER"], v["TOPO_SMTP_PASS"]
	c.SMTP.From = v["TOPO_SMTP_FROM"]
	c.SMTP.HELO = v["TOPO_SMTP_HELO"]
	if c.SMTP.HELO == "" && c.PublicURL != nil {
		c.SMTP.HELO = heloName(c.PublicURL.Hostname())
	}
	if c.SMTP.From != "" {
		if strings.ContainsAny(c.SMTP.From, "\r\n\x00") {
			fail("TOPO_SMTP_FROM has a line break")
		} else if _, err := mail.ParseAddress(c.SMTP.From); err != nil {
			fail("TOPO_SMTP_FROM %q: %v", c.SMTP.From, err)
		}
	}
	if strings.ContainsAny(c.SMTP.HELO, "\r\n\x00 ") {
		fail("TOPO_SMTP_HELO has a space or line break")
	}
	if c.Mail == "smtp" {
		if c.SMTP.Host == "" {
			fail("TOPO_MAIL=smtp needs TOPO_SMTP_HOST")
		}
		if c.SMTP.From == "" {
			fail("TOPO_MAIL=smtp needs TOPO_SMTP_FROM, e.g. Topo <topo@example.com>")
		}
		if c.SMTP.Security == "none" && c.SMTP.Host != "" && !IsLoopbackHost(c.SMTP.Host) {
			fail("TOPO_SMTP_SECURITY=none is allowed only for a relay on this machine (127.0.0.1 or localhost), not %s", c.SMTP.Host)
		}
		if (c.SMTP.User == "") != (c.SMTP.Pass == "") {
			fail("set both TOPO_SMTP_USER and TOPO_SMTP_PASS, or neither")
		}
	}
	c.MailPerMinute = intKey(v, "TOPO_MAIL_PER_MINUTE", 30, 1, 100000, fail)

	// Static app folder (development).
	c.Static = v["TOPO_STATIC"]
	if c.Static != "" {
		if abs, err := filepath.Abs(c.Static); err == nil {
			c.Static = abs
		}
		if st, err := os.Stat(filepath.Join(c.Static, "index.html")); err != nil || st.IsDir() {
			fail("TOPO_STATIC %s has no index.html (stage the app first: make stage, or desktop/stage.sh <dir>)", c.Static)
		}
		if _, err := os.Stat(filepath.Join(c.Static, ".git")); err == nil {
			fail("TOPO_STATIC %s is a git checkout; point it at a staged copy (make dev does this), never at the repository", c.Static)
		}
	}

	// Limits.
	c.MaxRevBytes = int64Key(v, "TOPO_MAX_REV_BYTES", 8<<20, 1024, 1<<30, fail)
	c.RevCap = intKey(v, "TOPO_REV_CAP", 500, 0, 1<<30, fail)
	c.SiteMaxBytes = int64Key(v, "TOPO_SITE_MAX_BYTES", 2<<30, 0, 1<<50, fail)
	c.SessionIdle = durKey(v, "TOPO_SESSION_IDLE", 720*time.Hour, fail)
	c.SessionMax = durKey(v, "TOPO_SESSION_MAX", 2160*time.Hour, fail)
	if c.SessionIdle > c.SessionMax {
		fail("TOPO_SESSION_IDLE (%s) is longer than TOPO_SESSION_MAX (%s)", c.SessionIdle, c.SessionMax)
	}
	c.CodeTTL = durKey(v, "TOPO_CODE_TTL", 10*time.Minute, fail)
	if c.CodeTTL > time.Hour {
		fail("TOPO_CODE_TTL %s: codes may live an hour at most", c.CodeTTL)
	}
	c.NotifyRevisionMinutes = intKey(v, "TOPO_NOTIFY_REVISION_MINUTES", 60, 0, 7*24*60, fail)
	if sec := intKey(v, "TOPO_NOTIFY_EVENT_SECONDS", 120, 0, 3600, fail); sec == 0 {
		c.NotifyEventDelay = -1
	} else {
		c.NotifyEventDelay = time.Duration(sec) * time.Second
	}

	// Logging.
	switch strings.ToLower(orDefault(v["TOPO_LOG_LEVEL"], "info")) {
	case "debug":
		c.LogLevel = slog.LevelDebug
	case "info":
		c.LogLevel = slog.LevelInfo
	case "warn", "warning":
		c.LogLevel = slog.LevelWarn
	case "error":
		c.LogLevel = slog.LevelError
	default:
		fail("TOPO_LOG_LEVEL %q: want debug, info, warn or error", v["TOPO_LOG_LEVEL"])
	}
	c.LogFormat = strings.ToLower(orDefault(v["TOPO_LOG_FORMAT"], "text"))
	if c.LogFormat != "text" && c.LogFormat != "json" {
		fail("TOPO_LOG_FORMAT %q: want text or json", c.LogFormat)
	}

	// Backups.
	if c.DataDir != "" {
		if lst := v["TOPO_BACKUP_FOLDERS"]; lst != "" {
			for _, p := range filepath.SplitList(lst) {
				p = strings.TrimSpace(p)
				if p == "" {
					continue
				}
				if !filepath.IsAbs(p) {
					fail("TOPO_BACKUP_FOLDERS: %q is not an absolute path", p)
					continue
				}
				c.BackupFolders = append(c.BackupFolders, filepath.Clean(p))
			}
		} else {
			c.BackupFolders = []string{filepath.Join(c.DataDir, "backups")}
			c.BackupFoldersDefaulted = true
		}
	}
	c.BackupDebounce = 2 * time.Minute
	if s := v["TOPO_BACKUP_DEBOUNCE"]; s != "" {
		d, err := time.ParseDuration(s)
		if err != nil || d < 0 || d > 24*time.Hour {
			fail("TOPO_BACKUP_DEBOUNCE %q: want a duration from 0s to 24h, such as 2m", s)
		} else {
			c.BackupDebounce = d
		}
	}
	c.BackupTick = durKey(v, "TOPO_BACKUP_TICK", 30*time.Second, fail)
	if c.BackupTick < time.Second || c.BackupTick > time.Hour {
		fail("TOPO_BACKUP_TICK %s: want 1s to 1h", c.BackupTick)
	}
	if p := v["TOPO_SERVER_KEY"]; p != "" {
		if !filepath.IsAbs(p) {
			fail("TOPO_SERVER_KEY %q: want an absolute path", p)
		} else {
			c.ServerKeyPath = filepath.Clean(p)
		}
	}

	// A real deployment (https, built in or behind a proxy) with no mail
	// set up would start healthy and never deliver a sign-in code.
	if len(errs) == 0 && c.PublicURL != nil && v["TOPO_MAIL"] == "" && c.Mail == "log" && c.Secure() {
		warnings = append(warnings, "no SMTP server is set (TOPO_SMTP_HOST): sign-in codes and invitations are only written to the log, nobody receives them. Set the TOPO_SMTP_* settings, or TOPO_MAIL=log to silence this")
	}

	if len(errs) > 0 {
		return nil, nil, errors.New(strings.Join(errs, "\n"))
	}
	return c, warnings, nil
}

// parsePublicURL accepts scheme://host[:port] with an optional trailing
// slash. The app must sit at the root (its links are fragments on /).
func parsePublicURL(s string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil {
		return nil, err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%q: want http:// or https://", s)
	}
	if u.Host == "" || u.Hostname() == "" {
		return nil, fmt.Errorf("%q has no host", s)
	}
	if u.User != nil {
		return nil, fmt.Errorf("%q: no user or password in the address", s)
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return nil, fmt.Errorf("%q: Topo must be at the root of its host, with no path (use its own host name, e.g. https://topo.example.com)", s)
	}
	if p := u.Port(); p != "" {
		if n, err := strconv.Atoi(p); err != nil || n < 1 || n > 65535 {
			return nil, fmt.Errorf("%q: bad port", s)
		}
	}
	host := strings.ToLower(u.Host)
	// Drop default ports so the Origin check compares like the browser does.
	if u.Scheme == "https" {
		host = strings.TrimSuffix(host, ":443")
	} else {
		host = strings.TrimSuffix(host, ":80")
	}
	return &url.URL{Scheme: u.Scheme, Host: host}, nil
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' }) {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func intKey(v map[string]string, k string, def, min, max int, fail func(string, ...any)) int {
	s := v[k]
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < min || n > max {
		fail("%s %q: want a whole number from %d to %d", k, s, min, max)
		return def
	}
	return n
}

func int64Key(v map[string]string, k string, def, min, max int64, fail func(string, ...any)) int64 {
	s := v[k]
	if s == "" {
		return def
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n < min || n > max {
		fail("%s %q: want a whole number of bytes from %d to %d", k, s, min, max)
		return def
	}
	return n
}

func durKey(v map[string]string, k string, def time.Duration, fail func(string, ...any)) time.Duration {
	s := v[k]
	if s == "" {
		return def
	}
	d, err := time.ParseDuration(s)
	if err != nil || d <= 0 {
		fail("%s %q: want a duration such as 10m or 720h", k, s)
		return def
	}
	return d
}

// heloName is the EHLO argument for a host: a name as is, an address as
// an address literal ([127.0.0.1], [IPv6:::1]; RFC 5321 §4.1.3).
func heloName(host string) string {
	ip := net.ParseIP(host)
	switch {
	case ip == nil:
		return host
	case ip.To4() != nil:
		return "[" + ip.String() + "]"
	default:
		return "[IPv6:" + ip.String() + "]"
	}
}
