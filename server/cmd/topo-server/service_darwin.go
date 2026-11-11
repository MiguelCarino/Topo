//go:build darwin

package main

// The macOS LaunchDaemon the Topo desktop app installs when the person says
// "Use this PC as the server" (D125); build-tested only (no Mac here). The
// app runs these through an administrator prompt (osascript "with
// administrator privileges"). The daemon is the one the server's own pkg
// recipe installs (server/packaging/macos), with the same label, user and
// folders, except that it runs the binary inside Topo.app:
//
//	/Library/LaunchDaemons/systems.carino.topo-server.plist
//	/Library/Application Support/Topo/topo.conf   settings (root:_topo 0640)
//	/Library/Application Support/Topo/data        data (_topo, 0700)
//	/Library/Logs/Topo/topo-server.log
//
// The hidden _topo user is made here with dscl, as the pkg's postinstall does.

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	macLabel = "systems.carino.topo-server"
	macPlist = "/Library/LaunchDaemons/systems.carino.topo-server.plist"
	macBase  = "/Library/Application Support/Topo"
	macLogs  = "/Library/Logs/Topo"
	macLog   = "/Library/Logs/Topo/topo-server.log"
)

func confPath() string { return filepath.Join(macBase, "topo.conf") }
func passPath() string { return filepath.Join(macBase, "smtp.pass") }

func sysRun(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).CombinedOutput()
}

func needRoot() error {
	if os.Geteuid() != 0 {
		return errors.New("needs an administrator (the Topo app asks; in a terminal, sudo)")
	}
	return nil
}

// ids reads _topo's uid or gid from Directory Services (os/user without
// cgo reads only /etc/passwd, which does not list _topo).
func ids(kind string) (int, error) {
	rec, key := "/Users/_topo", "UniqueID"
	if kind == "group" {
		rec, key = "/Groups/_topo", "PrimaryGroupID"
	}
	out, err := exec.Command("dscl", ".", "-read", rec, key).Output()
	if err != nil {
		return 0, fmt.Errorf("%s: %w", rec, err)
	}
	f := strings.Fields(string(out))
	if len(f) != 2 {
		return 0, fmt.Errorf("%s %s: %q", rec, key, out)
	}
	return strconv.Atoi(f[1])
}

// freeID is the first id from 400 to 499 no user or group has.
func freeID() (string, error) {
	used := map[string]bool{}
	for _, args := range [][]string{{".", "-list", "/Users", "UniqueID"}, {".", "-list", "/Groups", "PrimaryGroupID"}} {
		out, err := exec.Command("dscl", args...).Output()
		if err != nil {
			return "", err
		}
		for _, l := range strings.Split(string(out), "\n") {
			if f := strings.Fields(l); len(f) == 2 {
				used[f[1]] = true
			}
		}
	}
	for id := 400; id < 500; id++ {
		if !used[strconv.Itoa(id)] {
			return strconv.Itoa(id), nil
		}
	}
	return "", errors.New("no free id from 400 to 499")
}

func dscl(args ...string) error {
	if out, err := sysRun("dscl", append([]string{"."}, args...)...); err != nil {
		return fmt.Errorf("dscl %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func ensureUser() error {
	if _, err := ids("group"); err != nil {
		id, err := freeID()
		if err != nil {
			return err
		}
		for _, a := range [][]string{{"-create", "/Groups/_topo"}, {"-create", "/Groups/_topo", "PrimaryGroupID", id}, {"-create", "/Groups/_topo", "RealName", "Topo server"}} {
			if err := dscl(a...); err != nil {
				return err
			}
		}
	}
	gid, err := ids("group")
	if err != nil {
		return err
	}
	if _, err := ids("user"); err != nil {
		id, err := freeID()
		if err != nil {
			return err
		}
		u := "/Users/_topo"
		for _, a := range [][]string{{"-create", u}, {"-create", u, "UniqueID", id}, {"-create", u, "PrimaryGroupID", strconv.Itoa(gid)},
			{"-create", u, "UserShell", "/usr/bin/false"}, {"-create", u, "NFSHomeDirectory", "/var/empty"},
			{"-create", u, "RealName", "Topo server"}, {"-create", u, "IsHidden", "1"}} {
			if err := dscl(a...); err != nil {
				return err
			}
		}
	}
	return nil
}

func toGroup(p string) error {
	gid, err := ids("group")
	if err != nil {
		return err
	}
	if err := os.Chown(p, 0, gid); err != nil {
		return err
	}
	return os.Chmod(p, 0o640)
}

func xmlText(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// macPlistFor is the LaunchDaemon for the binary at exe.
func macPlistFor(exe string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Topo server, installed by the Topo app (Settings, This PC as the server). -->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>` + macLabel + `</string>
    <key>ProgramArguments</key>
    <array>
        <string>` + xmlText(exe) + `</string>
        <string>serve</string>
        <string>--config</string>
        <string>` + xmlText(confPath()) + `</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>TOPO_DATA</key>
        <string>` + xmlText(filepath.Join(macBase, "data")) + `</string>
    </dict>
    <key>UserName</key>
    <string>_topo</string>
    <key>GroupName</key>
    <string>_topo</string>
    <key>Umask</key>
    <integer>63</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>ExitTimeOut</key>
    <integer>60</integer>
    <key>StandardOutPath</key>
    <string>` + macLog + `</string>
    <key>StandardErrorPath</key>
    <string>` + macLog + `</string>
</dict>
</plist>
`
}

func writeServiceConf(o svcOptions) error {
	if o.pass != nil {
		if err := writePrivate(passPath(), o.pass, toGroup); err != nil {
			return err
		}
	}
	if !o.hasConf {
		if _, err := os.Stat(confPath()); errors.Is(err, os.ErrNotExist) {
			return writeConfChecked(confPath(), unixConfTemplate, 0o640, false, toGroup)
		}
		return nil
	}
	have := o.pass != nil || hadPassLine(confPath())
	return writeConfChecked(confPath(), composeConf(o.conf, passPath(), have), 0o640, false, toGroup)
}

func loaded() bool {
	_, err := sysRun("launchctl", "print", "system/"+macLabel)
	return err == nil
}

func svcInstall(stdout io.Writer, o svcOptions) error {
	if err := needRoot(); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return err
	}
	if err := ensureUser(); err != nil {
		return err
	}
	uid, err := ids("user")
	if err != nil {
		return err
	}
	gid, err := ids("group")
	if err != nil {
		return err
	}
	data := filepath.Join(macBase, "data")
	for _, d := range []struct {
		p    string
		mode os.FileMode
		uid  int
	}{{macBase, 0o750, 0}, {data, 0o700, uid}, {macLogs, 0o750, uid}} {
		if err := os.MkdirAll(d.p, d.mode); err != nil {
			return err
		}
		if err := os.Chown(d.p, d.uid, gid); err != nil {
			return err
		}
		if err := os.Chmod(d.p, d.mode); err != nil {
			return err
		}
	}
	if err := writeServiceConf(o); err != nil {
		return err
	}
	if err := os.WriteFile(macPlist, []byte(macPlistFor(exe)), 0o644); err != nil {
		return err
	}
	if err := os.Chown(macPlist, 0, 0); err != nil {
		return err
	}
	_, _ = sysRun("launchctl", "bootout", "system/"+macLabel)
	if o.start {
		if out, err := sysRun("launchctl", "bootstrap", "system", macPlist); err != nil {
			return fmt.Errorf("launchctl bootstrap: %v: %s", err, strings.TrimSpace(string(out)))
		}
		fmt.Fprintf(stdout, "Installed and started %s.\nSettings: %s\n", macLabel, confPath())
		return nil
	}
	fmt.Fprintf(stdout, "Installed %s (it starts with the Mac).\nSettings: %s\n", macLabel, confPath())
	return nil
}

func svcUninstall(stdout io.Writer) error {
	if err := needRoot(); err != nil {
		return err
	}
	_, _ = sysRun("launchctl", "bootout", "system/"+macLabel)
	if err := os.Remove(macPlist); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	fmt.Fprintf(stdout, "Removed %s. The data in %s stays.\n", macLabel, macBase)
	return nil
}

func svcStart(stdout io.Writer) error {
	if err := needRoot(); err != nil {
		return err
	}
	if _, err := os.Stat(macPlist); err != nil {
		return errors.New("the server is not installed on this Mac")
	}
	if loaded() {
		if out, err := sysRun("launchctl", "kickstart", "system/"+macLabel); err != nil {
			return fmt.Errorf("launchctl kickstart: %v: %s", err, strings.TrimSpace(string(out)))
		}
	} else if out, err := sysRun("launchctl", "bootstrap", "system", macPlist); err != nil {
		return fmt.Errorf("launchctl bootstrap: %v: %s", err, strings.TrimSpace(string(out)))
	}
	fmt.Fprintln(stdout, "Started.")
	return nil
}

func svcStop(stdout io.Writer) error {
	if err := needRoot(); err != nil {
		return err
	}
	_, _ = sysRun("launchctl", "bootout", "system/"+macLabel)
	fmt.Fprintln(stdout, "Stopped. It starts again with the Mac.")
	return nil
}

func svcConfigure(stdout io.Writer, o svcOptions) error {
	if err := needRoot(); err != nil {
		return err
	}
	if _, err := os.Stat(macPlist); err != nil {
		return errors.New("the server is not installed on this Mac")
	}
	if err := writeServiceConf(o); err != nil {
		return err
	}
	if loaded() {
		if out, err := sysRun("launchctl", "kickstart", "-k", "system/"+macLabel); err != nil {
			return fmt.Errorf("launchctl kickstart: %v: %s", err, strings.TrimSpace(string(out)))
		}
	} else if o.start {
		if out, err := sysRun("launchctl", "bootstrap", "system", macPlist); err != nil {
			return fmt.Errorf("launchctl bootstrap: %v: %s", err, strings.TrimSpace(string(out)))
		}
	}
	fmt.Fprintf(stdout, "Saved %s.\n", confPath())
	return nil
}

func svcStatus() serviceStatus {
	st := serviceStatus{Supported: true, Config: confPath(), Log: macLog}
	if _, err := os.Stat(macPlist); err != nil {
		return st
	}
	st.Installed = true
	if out, err := sysRun("launchctl", "print", "system/"+macLabel); err == nil {
		st.Running = strings.Contains(string(out), "state = running")
	}
	return st
}

func svcLog(n int) []string {
	b, err := os.ReadFile(macLog)
	if err != nil {
		return nil
	}
	if len(b) > 256*1024 {
		b = b[len(b)-256*1024:]
	}
	return lastLines(string(b), n)
}
