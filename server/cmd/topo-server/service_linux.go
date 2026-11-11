//go:build linux

package main

// The systemd service the Topo desktop app's rpm and deb ship (D125):
//
//	/usr/lib/systemd/system/topo-desktop-server.service   the unit (disabled)
//	/usr/lib/sysusers.d/topo-desktop-server.conf          the topo user
//	/usr/share/polkit-1/actions/systems.carino.topo.policy the admin prompt
//
// The package enables nothing. The app runs these commands through pkexec
// (`pkexec /usr/bin/topo-desktop-server service install --start --config …`)
// when the person says "Use this PC as the server". Settings live in
// /etc/topo/topo-desktop-server.conf (root:topo 0640), the data in
// /var/lib/topo (StateDirectory). Paths and the command runner are
// variables so the tests run the sequence without root or systemd.

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"strings"
)

var (
	unitName     = "topo-desktop-server.service"
	unitPath     = "/usr/lib/systemd/system/topo-desktop-server.service"
	sysusersPath = "/usr/lib/sysusers.d/topo-desktop-server.conf"
	linuxConfDir = "/etc/topo"
	linuxConf    = "/etc/topo/topo-desktop-server.conf"
	linuxPass    = "/etc/topo/topo-desktop-server.smtp.pass"

	// sysRun runs a system command (systemctl, systemd-sysusers, journalctl).
	sysRun = func(name string, args ...string) ([]byte, error) {
		return exec.Command(name, args...).CombinedOutput()
	}
	// toGroup makes a file root:topo (the service reads it, nobody else).
	toGroup = func(path string) error {
		g, err := user.LookupGroup("topo")
		if err != nil {
			return fmt.Errorf("the topo group: %w", err)
		}
		gid, _ := strconv.Atoi(g.Gid)
		return os.Chown(path, 0, gid)
	}
	isRoot = func() bool { return os.Geteuid() == 0 }
)

func confPath() string { return linuxConf }
func passPath() string { return linuxPass }

func needRoot() error {
	if !isRoot() {
		return errors.New("needs root (the Topo app asks through pkexec; in a terminal, sudo)")
	}
	if _, err := os.Stat(unitPath); err != nil {
		return fmt.Errorf("%w: %s is missing (it comes with the Topo desktop app's rpm or deb; for a server without the app see docs/SERVER.md)", errUnsupported, unitPath)
	}
	return nil
}

func systemctl(args ...string) error {
	if out, err := sysRun("systemctl", args...); err != nil {
		return fmt.Errorf("systemctl %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func writeServiceConf(o svcOptions) error {
	if o.pass != nil {
		if err := writePrivate(linuxPass, o.pass, func(p string) error {
			if err := toGroup(p); err != nil {
				return err
			}
			return os.Chmod(p, 0o640)
		}); err != nil {
			return err
		}
	}
	fix := func(p string) error {
		if err := toGroup(p); err != nil {
			return err
		}
		return os.Chmod(p, 0o640)
	}
	if !o.hasConf {
		if _, err := os.Stat(linuxConf); errors.Is(err, os.ErrNotExist) {
			return writeConfChecked(linuxConf, unixConfTemplate, 0o640, false, fix)
		}
		return nil
	}
	have := o.pass != nil || hadPassLine(linuxConf)
	return writeConfChecked(linuxConf, composeConf(o.conf, linuxPass, have), 0o640, false, fix)
}

func svcInstall(stdout io.Writer, o svcOptions) error {
	if err := needRoot(); err != nil {
		return err
	}
	if out, err := sysRun("systemd-sysusers", sysusersPath); err != nil {
		return fmt.Errorf("making the topo user (systemd-sysusers): %v: %s", err, strings.TrimSpace(string(out)))
	}
	if err := os.MkdirAll(linuxConfDir, 0o750); err != nil {
		return err
	}
	if err := toGroup(linuxConfDir); err != nil {
		return err
	}
	if err := os.Chmod(linuxConfDir, 0o750); err != nil {
		return err
	}
	if err := writeServiceConf(o); err != nil {
		return err
	}
	if err := systemctl("daemon-reload"); err != nil {
		return err
	}
	args := []string{"enable", unitName}
	if o.start {
		args = []string{"enable", "--now", unitName}
	}
	if err := systemctl(args...); err != nil {
		return err
	}
	if o.start {
		fmt.Fprintf(stdout, "Enabled and started %s.\nSettings: %s\n", unitName, linuxConf)
	} else {
		fmt.Fprintf(stdout, "Enabled %s (it starts with the computer).\nSettings: %s\n", unitName, linuxConf)
	}
	return nil
}

func svcUninstall(stdout io.Writer) error {
	if err := needRoot(); err != nil {
		return err
	}
	if err := systemctl("disable", "--now", unitName); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "Stopped and disabled %s. The data in /var/lib/topo and %s stay.\n", unitName, linuxConf)
	return nil
}

func svcStart(stdout io.Writer) error {
	if err := needRoot(); err != nil {
		return err
	}
	if err := systemctl("start", unitName); err != nil {
		return err
	}
	fmt.Fprintln(stdout, "Started. The log: journalctl -u "+unitName)
	return nil
}

func svcStop(stdout io.Writer) error {
	if err := needRoot(); err != nil {
		return err
	}
	if err := systemctl("stop", unitName); err != nil {
		return err
	}
	fmt.Fprintln(stdout, "Stopped. It starts again with the computer while it is enabled.")
	return nil
}

func svcConfigure(stdout io.Writer, o svcOptions) error {
	if err := needRoot(); err != nil {
		return err
	}
	if err := os.MkdirAll(linuxConfDir, 0o750); err != nil {
		return err
	}
	if err := writeServiceConf(o); err != nil {
		return err
	}
	verb := "try-restart"
	if o.start {
		verb = "restart"
	}
	if err := systemctl(verb, unitName); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "Saved %s.\n", linuxConf)
	return nil
}

func svcStatus() serviceStatus {
	st := serviceStatus{Config: linuxConf, Log: "journalctl -u " + unitName}
	if _, err := os.Stat(unitPath); err != nil {
		return st
	}
	st.Supported = true
	out, _ := sysRun("systemctl", "is-enabled", unitName)
	st.Installed = strings.TrimSpace(string(out)) == "enabled"
	out, _ = sysRun("systemctl", "is-active", unitName)
	switch strings.TrimSpace(string(out)) {
	case "active", "activating", "reloading":
		st.Running = true
	}
	return st
}

// svcLog is the journal's tail; a person outside the groups that may read
// the system journal (wheel, adm, systemd-journal) gets nothing.
func svcLog(n int) []string {
	if n <= 0 || n > 1000 {
		n = 200
	}
	out, err := sysRun("journalctl", "-u", unitName, "-n", strconv.Itoa(n), "-o", "cat", "--no-pager", "-q")
	if err != nil {
		return nil
	}
	return lastLines(string(out), n)
}
