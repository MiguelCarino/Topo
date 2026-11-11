package main

// `topo-server service …`: the server as a service that starts with the
// computer (D112, D125). One command on every OS, so the Topo desktop app
// (which bundles this binary as topo-desktop-server) and the Windows
// installer drive the same code:
//
//	service install [--start] [--config FILE] [--smtp-pass FILE]
//	                              register the service (Windows service,
//	                              systemd unit from the desktop package,
//	                              macOS LaunchDaemon), its folders and a
//	                              first settings file; --config writes FILE's
//	                              settings instead; --start starts it
//	service uninstall             stop and remove it (the data stays)
//	service start | stop          through the service manager
//	service configure FILE [--smtp-pass FILE] [--start]
//	                              replace the service's settings with FILE's
//	                              (only the keys the app sets), restart it if
//	                              it runs (or start it with --start)
//	service status [--port N]     JSON: supported, installed, running and,
//	                              with --port, whether 127.0.0.1:N answers
//	                              and its certificate's fingerprint
//	service log [--lines N]       the service's recent log lines, when this
//	                              user may read them
//
// install, uninstall, start, stop and configure need an administrator (the
// app asks through UAC, pkexec or an administrator prompt); status and log
// do not. --report FILE writes the outcome to FILE too, for a caller that
// cannot read an elevated process's output (UAC on Windows).
//
// This file is the part that is the same on every OS (and is tested here);
// service_windows.go, service_linux.go and service_darwin.go do the rest.

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"carino.systems/topo/server/internal/config"
	"carino.systems/topo/server/internal/selfcert"
)

const (
	serviceName        = "TopoServer"
	serviceDisplayName = "Topo server"
	serviceDescription = "Topo: network documentation with email sign-in and end-to-end encrypted sync (docs/SERVER.md)."
)

// serviceConfTemplate is the first topo.conf of a Windows service. Nothing
// in it is required: as written, the server answers only on this PC at
// http://127.0.0.1:7380 and writes sign-in codes to the log.
const serviceConfTemplate = `# Topo server settings (KEY=VALUE, one per line; docs/SERVER.md lists every key).
# After a change: topo-server service stop, then topo-server service start
# (or Services, Topo server, Restart).
#
# Data (topo.db, server.key, mail, backups) lives in this folder unless you set:
#TOPO_DATA=C:\ProgramData\Topo
#
# Only this PC (the default):
#TOPO_LISTEN=127.0.0.1:7380
#
# Other PCs need https: a certificate and its key (PEM files) ...
#TOPO_LISTEN=0.0.0.0:7380
#TOPO_PUBLIC_URL=https://topo.example.lan:7380
#TOPO_TLS_CERT=C:\ProgramData\Topo\tls\cert.pem
#TOPO_TLS_KEY=C:\ProgramData\Topo\tls\key.pem
# ... or a self-signed one the server makes (each PC accepts it once):
#TOPO_TLS_SELF=1
#
# The owner and email (sign-in codes are sent by email):
#TOPO_OWNER_EMAIL=it@example.com
#TOPO_SMTP_HOST=smtp.office365.com
#TOPO_SMTP_PORT=587
#TOPO_SMTP_USER=topo@example.com
#TOPO_SMTP_PASS_FILE=C:\ProgramData\Topo\smtp.pass
#TOPO_SMTP_FROM=Topo <topo@example.com>
#
# Folders a "folder on the server" backup may use (; between folders). The
# service runs as Local Service, which cannot reach \\server\share or a
# mapped drive: use WebDAV or S3 for those, or run the service as an account
# that can (docs/SERVER.md, Install on Windows).
#TOPO_BACKUP_FOLDERS=C:\ProgramData\Topo\backups;D:\TopoBackups
`

// unixConfTemplate is the first settings file on Linux and macOS (the
// desktop app's service). As written the server answers only on this
// computer; the app's Settings, This PC as the server, rewrites it.
const unixConfTemplate = `# Topo server settings (KEY=VALUE, one per line; docs/SERVER.md lists every key).
# The Topo app writes this file (Settings, This PC as the server). As
# shipped every line is a comment: the server answers only on this computer
# (http://127.0.0.1:7380) and writes sign-in codes to its log.
#TOPO_LISTEN=127.0.0.1:7380
#TOPO_OWNER_EMAIL=it@example.com
`

// appConfKeys are the settings `service configure` (and `install --config`)
// accept: the ones the desktop app's "This PC as the server" sets. The data
// folder and the password file are the service's own, never the caller's.
var appConfKeys = map[string]bool{
	"TOPO_LISTEN":         true,
	"TOPO_PUBLIC_URL":     true,
	"TOPO_ALLOWED_HOSTS":  true,
	"TOPO_TLS_SELF":       true,
	"TOPO_OWNER_EMAIL":    true,
	"TOPO_MAIL":           true,
	"TOPO_SMTP_HOST":      true,
	"TOPO_SMTP_PORT":      true,
	"TOPO_SMTP_SECURITY":  true,
	"TOPO_SMTP_USER":      true,
	"TOPO_SMTP_FROM":      true,
	"TOPO_BACKUP_FOLDERS": true,
}

// serviceStatus is what `service status` prints (one JSON line).
type serviceStatus struct {
	// Supported: this computer can run the service (Windows always; Linux
	// when the desktop package's unit is there; macOS).
	Supported bool `json:"supported"`
	// Installed: set up to start with the computer.
	Installed bool `json:"installed"`
	Running   bool `json:"running"`
	// With --port: 127.0.0.1:port answered over https (TLS) or http.
	Answering   bool   `json:"answering"`
	TLS         bool   `json:"tls"`
	Fingerprint string `json:"fingerprint,omitempty"`
	// Where the settings and the log are, to say so.
	Config string `json:"config,omitempty"`
	Log    string `json:"log,omitempty"`
}

// svcOptions are the flags of the service subcommands.
type svcOptions struct {
	start   bool
	conf    string // the new settings (already checked), "" for none
	pass    []byte // the new SMTP password, nil to keep the one there
	hasConf bool
	port    int
	lines   int
}

const serviceUsage = `usage: topo-server service install|uninstall|start|stop|configure|status|log
  install [--start] [--config FILE] [--smtp-pass FILE]
  configure FILE [--smtp-pass FILE] [--start]
  status [--port N]
  log [--lines N]
  (any of them: --report FILE)
install, uninstall, start, stop and configure need an administrator.
docs/SERVER.md, "Install", has the steps.
`

// serviceCommand is `topo-server service …`.
func serviceCommand(args []string, _ []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, serviceUsage)
		return 2
	}
	verb := args[0]
	fs := flag.NewFlagSet("service "+verb, flag.ContinueOnError)
	fs.SetOutput(stderr)
	start := fs.Bool("start", false, "start the service too")
	confFile := fs.String("config", "", "settings file to install")
	passFile := fs.String("smtp-pass", "", "file holding the SMTP password")
	report := fs.String("report", "", "also write the outcome to this file")
	port := fs.Int("port", 0, "status: probe 127.0.0.1:PORT")
	lines := fs.Int("lines", 200, "log: how many lines")
	if err := fs.Parse(reorderFlags(args[1:])); err != nil {
		return 2
	}
	rest := fs.Args()
	if verb == "configure" {
		if len(rest) != 1 || *confFile != "" {
			fmt.Fprint(stderr, serviceUsage)
			return 2
		}
		*confFile, rest = rest[0], nil
	}
	if len(rest) > 0 {
		fmt.Fprintf(stderr, "topo-server service %s: unexpected argument %q\n", verb, rest[0])
		return 2
	}

	var out bytes.Buffer
	o := svcOptions{start: *start, port: *port, lines: *lines}
	err := func() error {
		if *confFile != "" {
			s, err := readAppConf(*confFile)
			if err != nil {
				return err
			}
			o.conf, o.hasConf = s, true
		}
		if *passFile != "" {
			b, err := os.ReadFile(*passFile)
			if err != nil {
				return fmt.Errorf("the SMTP password file: %w", err)
			}
			b = bytes.TrimRight(b, "\r\n")
			if len(b) == 0 || bytes.ContainsAny(b, "\r\n") {
				return errors.New("the SMTP password file must hold one line")
			}
			o.pass = b
		}
		switch verb {
		case "install":
			return svcInstall(&out, o)
		case "uninstall":
			return svcUninstall(&out)
		case "start":
			return svcStart(&out)
		case "stop":
			return svcStop(&out)
		case "configure":
			return svcConfigure(&out, o)
		case "status":
			st := svcStatus()
			if o.port > 0 {
				st.Answering, st.TLS, st.Fingerprint = probeLocal(o.port, 2*time.Second)
			}
			b, _ := json.Marshal(st)
			out.Write(append(b, '\n'))
			return nil
		case "log":
			for _, l := range svcLog(o.lines) {
				fmt.Fprintln(&out, l)
			}
			return nil
		}
		return fmt.Errorf("unknown %q (install, uninstall, start, stop, configure, status, log)", verb)
	}()
	stdout.Write(out.Bytes())
	if *report != "" {
		msg := "ok\n" + out.String()
		if err != nil {
			msg = "error\n" + err.Error() + "\n"
		}
		_ = os.WriteFile(*report, []byte(msg), 0o600)
	}
	if err != nil {
		fmt.Fprintf(stderr, "topo-server service %s: %v\n", verb, err)
		if errors.Is(err, errUnsupported) {
			return 2
		}
		return 1
	}
	return 0
}

// reorderFlags moves flags before the positional arguments, so
// `configure FILE --start` parses like `configure --start FILE`.
func reorderFlags(args []string) []string {
	var flags, pos []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "-") && len(a) > 1 {
			flags = append(flags, a)
			name := strings.TrimLeft(a, "-")
			if !strings.Contains(name, "=") && name != "start" && i+1 < len(args) {
				flags = append(flags, args[i+1])
				i++
			}
			continue
		}
		pos = append(pos, a)
	}
	return append(flags, pos...)
}

var errUnsupported = errors.New("not supported on this computer")

// readAppConf reads a settings file the app wrote and returns it cleaned:
// only appConfKeys, one KEY=VALUE per line in a fixed order, no control
// characters.
func readAppConf(path string) (string, error) {
	vals, _, err := config.ReadFile(path)
	if err != nil {
		return "", err
	}
	return cleanAppConf(vals)
}

func cleanAppConf(vals map[string]string) (string, error) {
	keys := make([]string, 0, len(vals))
	for k, v := range vals {
		if !appConfKeys[k] {
			return "", fmt.Errorf("%s cannot be set here (the service's own folders and files are fixed)", k)
		}
		if strings.ContainsFunc(v, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
			return "", fmt.Errorf("%s: a control character", k)
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "%s=%s\n", k, vals[k])
	}
	return b.String(), nil
}

// composeConf is the settings file a service gets: a header, the app's
// settings and, when the mail needs a password, the service's own
// password file (havePass: one is there, or is being written now).
func composeConf(app, passPath string, havePass bool) string {
	var b strings.Builder
	b.WriteString("# Topo server settings, written by the Topo app (Settings, This PC as the server).\n")
	b.WriteString("# A change made here by hand is replaced the next time the app saves.\n")
	b.WriteString(app)
	if havePass && strings.Contains("\n"+app, "\nTOPO_SMTP_USER=") {
		fmt.Fprintf(&b, "TOPO_SMTP_PASS_FILE=%s\n", passPath)
	}
	return b.String()
}

// checkConf loads a settings file the way the service will, so a setting
// the server would refuse is refused before the service is restarted.
func checkConf(path string) error {
	_, err := config.Load(config.Options{File: path, Service: runtime.GOOS == "windows"})
	return err
}

// writeConfChecked writes a settings file next to the old one, checks it,
// then puts it in place (the old one stays when the check fails).
func writeConfChecked(path, content string, perm os.FileMode, crlf bool, fix func(string) error) error {
	if crlf {
		content = strings.ReplaceAll(content, "\n", "\r\n")
	}
	tmp := path + ".new"
	if err := os.WriteFile(tmp, []byte(content), perm); err != nil {
		return err
	}
	if fix != nil {
		if err := fix(tmp); err != nil {
			os.Remove(tmp)
			return err
		}
	}
	if err := checkConf(tmp); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("the settings were not saved: %w", err)
	}
	return os.Rename(tmp, path)
}

// writePrivate writes a secret file (the SMTP password) for the service.
func writePrivate(path string, b []byte, fix func(string) error) error {
	tmp := path + ".new"
	if err := os.WriteFile(tmp, append(append([]byte{}, b...), '\n'), 0o600); err != nil {
		return err
	}
	if fix != nil {
		if err := fix(tmp); err != nil {
			os.Remove(tmp)
			return err
		}
	}
	return os.Rename(tmp, path)
}

// hadPassLine says whether the settings file in place names a password file.
func hadPassLine(path string) bool {
	vals, _, err := config.ReadFile(path)
	return err == nil && vals["TOPO_SMTP_PASS_FILE"] != ""
}

// probeLocal asks 127.0.0.1:port whether a server answers, over https
// first (then it also reads the certificate's fingerprint, the same one the
// server writes to tls/cert.sha256) and then over http. The certificate is
// not verified: it is only read, from this computer's own loopback, so the
// app can show it to people who compare it in their browsers.
func probeLocal(port int, timeout time.Duration) (answering, isTLS bool, fingerprint string) {
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	d := &net.Dialer{Timeout: timeout}
	tc := &tls.Config{InsecureSkipVerify: true} //nolint:gosec // read-only probe of this computer's own server
	if conn, err := tls.DialWithDialer(d, "tcp", addr, tc); err == nil {
		certs := conn.ConnectionState().PeerCertificates
		conn.Close()
		if len(certs) > 0 {
			fingerprint = selfcert.Fingerprint(certs[0].Raw)
		}
		return httpAnswers("https://"+addr, timeout, tc), true, fingerprint
	}
	return httpAnswers("http://"+addr, timeout, nil), false, ""
}

func httpAnswers(base string, timeout time.Duration, tc *tls.Config) bool {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/health", nil)
	if err != nil {
		return false
	}
	c := &http.Client{Transport: &http.Transport{TLSClientConfig: tc, Proxy: nil}}
	resp, err := c.Do(req)
	if err != nil {
		return false
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
	resp.Body.Close()
	// Any answer means a server is there (a host check may refuse
	// 127.0.0.1 as a name, which is still an answer).
	return true
}

// lastLines keeps the last n lines of text.
func lastLines(text string, n int) []string {
	text = strings.TrimRight(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if text == "" {
		return nil
	}
	ls := strings.Split(text, "\n")
	if n > 0 && len(ls) > n {
		ls = ls[len(ls)-n:]
	}
	return ls
}
