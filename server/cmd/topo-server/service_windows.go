//go:build windows

package main

// The Windows service (D112, D125). Build-tested here only: this repository
// is built on Linux, so the code below is compiled and vetted for Windows;
// CI's builds.yml runs the desktop installer with it on a Windows runner
// (docs/SERVER.md says what was run where).
//
//	service install     create the service (automatic, delayed start, Local
//	                    Service, restart on failure), make %ProgramData%\Topo
//	                    with its ACL, a first topo.conf (or --config's), and a
//	                    firewall rule letting the program in on private and
//	                    domain networks (never public ones)
//	service uninstall   stop and remove it and its firewall rule (the data stays)
//	service start|stop|configure|status|log (service.go)
//
// The Topo desktop installer (desktop/src-tauri/windows/hooks.nsh) runs
// `service install --start` when "Use this PC as the server" is ticked.
//
// Started by the service manager, `topo-server serve --config …` runs the
// same server as in a terminal, logs to the Windows event log (source
// TopoServer) and stops gracefully on Stop or Shutdown.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

func runningAsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

// eventWriter turns the server's log lines into event-log entries: errors
// as errors, warnings as warnings, the rest as information.
type eventWriter struct {
	mu  sync.Mutex
	log *eventlog.Log
	buf bytes.Buffer
}

func (w *eventWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf.Write(p)
	for {
		line, err := w.buf.ReadString('\n')
		if err != nil {
			// An unfinished line waits for the rest.
			w.buf.Reset()
			w.buf.WriteString(line)
			return len(p), nil
		}
		line = strings.TrimRight(line, "\r\n")
		switch {
		case strings.Contains(line, "level=ERROR"), strings.Contains(line, `"level":"ERROR"`):
			w.log.Error(1, line)
		case strings.Contains(line, "level=WARN"), strings.Contains(line, `"level":"WARN"`):
			w.log.Warning(1, line)
		default:
			w.log.Info(1, line)
		}
	}
}

type topoService struct {
	start func(ctx context.Context, logw io.Writer) error
	logw  io.Writer
	err   error
}

func (s *topoService) Execute(_ []string, req <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.start(ctx, s.logw) }()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case err := <-done:
			// The server stopped by itself (a bad setting, a port in use):
			// the service manager's recovery restarts it.
			s.err = err
			if err != nil {
				return true, 1
			}
			return false, 0
		case c := <-req:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				// The graceful stop takes up to 45 s (shutdownTimeout).
				status <- svc.Status{State: svc.StopPending, WaitHint: 60000}
				cancel()
				s.err = <-done
				return false, 0
			}
		}
	}
}

// runService runs the server under the service manager.
func runService(start func(ctx context.Context, logw io.Writer) error, stderr io.Writer) int {
	el, err := eventlog.Open(serviceName)
	var logw io.Writer = stderr
	if err == nil {
		defer el.Close()
		logw = &eventWriter{log: el}
	}
	s := &topoService{start: start, logw: logw}
	if err := svc.Run(serviceName, s); err != nil {
		fmt.Fprintf(logw, "level=ERROR msg=\"service\" err=%q\n", err.Error())
		return 1
	}
	if s.err != nil {
		return 1
	}
	return 0
}

func programData() string {
	if v := os.Getenv("ProgramData"); v != "" {
		return filepath.Join(v, "Topo")
	}
	return `C:\ProgramData\Topo`
}

func confPath() string { return filepath.Join(programData(), "topo.conf") }
func passPath() string { return filepath.Join(programData(), "smtp.pass") }

// The firewall rule: the program, inbound, on private and domain networks.
const firewallRule = "Topo server"

// hiddenCmd runs a console tool without a console window flashing up.
func hiddenCmd(name string, args ...string) *exec.Cmd {
	c := exec.Command(name, args...)
	c.SysProcAttr = &windows.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return c
}

// writeServiceConf writes the app's settings (or, with none, the first
// all-comment file when there is no file yet) and the SMTP password into
// %ProgramData%\Topo, whose ACL the files inherit.
func writeServiceConf(o svcOptions) error {
	conf := confPath()
	if o.pass != nil {
		if err := writePrivate(passPath(), o.pass, nil); err != nil {
			return err
		}
	}
	if !o.hasConf {
		if _, err := os.Stat(conf); errors.Is(err, os.ErrNotExist) {
			return os.WriteFile(conf, []byte(strings.ReplaceAll(serviceConfTemplate, "\n", "\r\n")), 0o600)
		}
		return nil
	}
	have := o.pass != nil || hadPassLine(conf)
	return writeConfChecked(conf, composeConf(o.conf, passPath(), have), 0o600, true, nil)
}

func svcInstall(stdout io.Writer, o svcOptions) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if exe, err = filepath.Abs(exe); err != nil {
		return err
	}
	dir := programData()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	// Local Service, SYSTEM and Administrators only, inherited by what the
	// server makes (amendment 42: install sets it, not only an installer).
	// S-1-5-19 Local Service, S-1-5-18 SYSTEM, S-1-5-32-544 Administrators.
	if out, err := hiddenCmd("icacls", dir, "/inheritance:r",
		"/grant:r", "*S-1-5-19:(OI)(CI)M", "/grant:r", "*S-1-5-18:(OI)(CI)F", "/grant:r", "*S-1-5-32-544:(OI)(CI)F").CombinedOutput(); err != nil {
		return fmt.Errorf("setting the folder's access (icacls): %v: %s", err, strings.TrimSpace(string(out)))
	}
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("the service manager (run this as an administrator): %w", err)
	}
	defer m.Disconnect()
	if s, err := m.OpenService(serviceName); err == nil {
		s.Close()
		return fmt.Errorf("the service %s is already installed (topo-server service uninstall first)", serviceName)
	}
	if err := writeServiceConf(o); err != nil {
		return err
	}
	s, err := m.CreateService(serviceName, exe, mgr.Config{
		DisplayName:      serviceDisplayName,
		Description:      serviceDescription,
		StartType:        mgr.StartAutomatic,
		DelayedAutoStart: true,
		ServiceStartName: `NT AUTHORITY\LocalService`,
	}, "serve", "--config", confPath())
	if err != nil {
		return err
	}
	defer s.Close()
	if err := s.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 2 * time.Minute},
	}, 24*60*60); err != nil {
		return err
	}
	if err := eventlog.InstallAsEventCreate(serviceName, eventlog.Error|eventlog.Warning|eventlog.Info); err != nil &&
		!strings.Contains(err.Error(), "exists") {
		return fmt.Errorf("event log source: %w", err)
	}
	// Other PCs reach it only when its settings say so (TOPO_LISTEN); the
	// rule spares the person Windows' own firewall prompt, which a service
	// cannot show. Public networks (a café's Wi-Fi) stay closed.
	_ = hiddenCmd("netsh", "advfirewall", "firewall", "delete", "rule", "name="+firewallRule).Run()
	if out, err := hiddenCmd("netsh", "advfirewall", "firewall", "add", "rule", "name="+firewallRule,
		"dir=in", "action=allow", "program="+exe, "enable=yes", "profile=private,domain").CombinedOutput(); err != nil {
		fmt.Fprintf(stdout, "The firewall rule was not added (%v: %s); other PCs may not reach it.\n", err, strings.TrimSpace(string(out)))
	}
	if o.start {
		if err := s.Start(); err != nil {
			return fmt.Errorf("installed, but it did not start: %w", err)
		}
		fmt.Fprintf(stdout, "Installed and started the service %s.\nSettings: %s\n", serviceName, confPath())
		return nil
	}
	fmt.Fprintf(stdout, "Installed the service %s (not started).\nSettings: %s\nStart it: topo-server service start\n", serviceName, confPath())
	return nil
}

func openService() (*mgr.Mgr, *mgr.Service, error) {
	m, err := mgr.Connect()
	if err != nil {
		return nil, nil, fmt.Errorf("the service manager (run this as an administrator): %w", err)
	}
	s, err := m.OpenService(serviceName)
	if err != nil {
		m.Disconnect()
		return nil, nil, fmt.Errorf("the service %s is not installed", serviceName)
	}
	return m, s, nil
}

func svcUninstall(stdout io.Writer) error {
	m, s, err := openService()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	defer s.Close()
	_ = stopAndWait(s)
	if err := s.Delete(); err != nil {
		return err
	}
	_ = eventlog.Remove(serviceName)
	_ = hiddenCmd("netsh", "advfirewall", "firewall", "delete", "rule", "name="+firewallRule).Run()
	fmt.Fprintf(stdout, "Removed the service %s. The data in %s stays.\n", serviceName, programData())
	return nil
}

func svcStart(stdout io.Writer) error {
	m, s, err := openService()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	defer s.Close()
	if err := s.Start(); err != nil {
		return err
	}
	fmt.Fprintln(stdout, "Started. The log is in Event Viewer, Windows Logs, Application, source TopoServer.")
	return nil
}

// stopAndWait asks the service to stop and waits for it (70 s at most: the
// graceful stop takes up to 45 s).
func stopAndWait(s *mgr.Service) error {
	st, err := s.Query()
	if err != nil {
		return err
	}
	if st.State == svc.Stopped {
		return nil
	}
	if st.State != svc.StopPending {
		if st, err = s.Control(svc.Stop); err != nil {
			return err
		}
	}
	for i := 0; i < 70 && st.State != svc.Stopped; i++ {
		time.Sleep(time.Second)
		if st, err = s.Query(); err != nil {
			return err
		}
	}
	if st.State != svc.Stopped {
		return errors.New("still stopping after 70 s")
	}
	return nil
}

func svcStop(stdout io.Writer) error {
	m, s, err := openService()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	defer s.Close()
	if err := stopAndWait(s); err != nil {
		return err
	}
	fmt.Fprintln(stdout, "Stopped. It starts again with Windows.")
	return nil
}

// svcConfigure writes the settings, then restarts a running service (or
// starts a stopped one with --start).
func svcConfigure(stdout io.Writer, o svcOptions) error {
	m, s, err := openService()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	defer s.Close()
	if err := writeServiceConf(o); err != nil {
		return err
	}
	st, err := s.Query()
	if err != nil {
		return err
	}
	if st.State == svc.Stopped && !o.start {
		fmt.Fprintf(stdout, "Saved %s (the service is stopped).\n", confPath())
		return nil
	}
	if err := stopAndWait(s); err != nil {
		return err
	}
	if err := s.Start(); err != nil {
		return fmt.Errorf("saved, but it did not start: %w", err)
	}
	fmt.Fprintf(stdout, "Saved %s and (re)started the service.\n", confPath())
	return nil
}

// svcStatus needs no administrator: connect and query rights only (which
// mgr.Connect, asking for every right, would not get).
func svcStatus() serviceStatus {
	st := serviceStatus{Supported: true, Config: confPath(), Log: "Event Viewer, Windows Logs, Application, source TopoServer"}
	h, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return st
	}
	defer windows.CloseServiceHandle(h)
	name, _ := windows.UTF16PtrFromString(serviceName)
	sh, err := windows.OpenService(h, name, windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return st
	}
	defer windows.CloseServiceHandle(sh)
	st.Installed = true
	var ss windows.SERVICE_STATUS
	if windows.QueryServiceStatus(sh, &ss) == nil {
		st.Running = ss.CurrentState == windows.SERVICE_RUNNING || ss.CurrentState == windows.SERVICE_START_PENDING
	}
	return st
}

// svcLog reads the service's newest event-log entries (the Application log
// is readable by the people signed in to this PC).
func svcLog(n int) []string {
	if n <= 0 || n > 1000 {
		n = 200
	}
	out, err := hiddenCmd("wevtutil", "qe", "Application",
		"/q:*[System[Provider[@Name='"+serviceName+"']]]", fmt.Sprintf("/c:%d", n), "/rd:true", "/f:text").Output()
	if err != nil {
		return nil
	}
	// Blocks of "Event[i]: … Description:" then the message, newest first.
	var msgs []string
	inDesc := false
	for _, l := range strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n") {
		switch {
		case strings.HasPrefix(l, "Event["):
			inDesc = false
		case strings.TrimSpace(l) == "Description:":
			inDesc = true
		case inDesc && strings.TrimSpace(l) != "":
			msgs = append(msgs, strings.TrimSpace(l))
		}
	}
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return lastLines(strings.Join(msgs, "\n"), n)
}
