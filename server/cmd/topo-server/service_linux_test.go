//go:build linux

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeSystem points the Linux service code at a temporary folder and
// records the commands it would run.
func fakeSystem(t *testing.T, active string) (dir string, calls *[]string) {
	t.Helper()
	dir = t.TempDir()
	saved := []string{unitPath, sysusersPath, linuxConfDir, linuxConf, linuxPass}
	savedRun, savedGroup, savedRoot := sysRun, toGroup, isRoot
	t.Cleanup(func() {
		unitPath, sysusersPath, linuxConfDir, linuxConf, linuxPass = saved[0], saved[1], saved[2], saved[3], saved[4]
		sysRun, toGroup, isRoot = savedRun, savedGroup, savedRoot
	})
	unitPath = filepath.Join(dir, "topo-desktop-server.service")
	os.WriteFile(unitPath, []byte("[Unit]\n"), 0o644)
	sysusersPath = filepath.Join(dir, "sysusers.conf")
	linuxConfDir = filepath.Join(dir, "etc-topo")
	linuxConf = filepath.Join(linuxConfDir, "topo-desktop-server.conf")
	linuxPass = filepath.Join(linuxConfDir, "topo-desktop-server.smtp.pass")
	var c []string
	calls = &c
	sysRun = func(name string, args ...string) ([]byte, error) {
		*calls = append(*calls, strings.TrimSpace(name+" "+strings.Join(args, " ")))
		if name == "systemctl" && len(args) == 2 && args[0] == "is-active" {
			return []byte(active + "\n"), nil
		}
		if name == "systemctl" && len(args) == 2 && args[0] == "is-enabled" {
			return []byte("enabled\n"), nil
		}
		return nil, nil
	}
	toGroup = func(string) error { return nil }
	isRoot = func() bool { return true }
	return dir, calls
}

func TestLinuxInstallSequence(t *testing.T) {
	dir, calls := fakeSystem(t, "active")
	conf := filepath.Join(dir, "app.conf")
	pass := filepath.Join(dir, "pass")
	os.WriteFile(conf, []byte("TOPO_OWNER_EMAIL=it@example.com\nTOPO_MAIL=smtp\nTOPO_SMTP_HOST=smtp.example.com\nTOPO_SMTP_FROM=Topo <topo@example.com>\nTOPO_SMTP_USER=topo@example.com\n"), 0o600)
	os.WriteFile(pass, []byte("s3cret\n"), 0o600)
	var out, errb bytes.Buffer
	if code := serviceCommand([]string{"install", "--start", "--config", conf, "--smtp-pass", pass}, nil, &out, &errb); code != 0 {
		t.Fatalf("install: %d %s", code, errb.String())
	}
	want := []string{"systemd-sysusers " + sysusersPath, "systemctl daemon-reload", "systemctl enable --now topo-desktop-server.service"}
	if strings.Join(*calls, "|") != strings.Join(want, "|") {
		t.Fatalf("commands:\n%s", strings.Join(*calls, "\n"))
	}
	b, _ := os.ReadFile(linuxConf)
	if !strings.Contains(string(b), "TOPO_OWNER_EMAIL=it@example.com\n") || !strings.Contains(string(b), "TOPO_SMTP_PASS_FILE="+linuxPass+"\n") {
		t.Fatalf("settings:\n%s", b)
	}
	if p, _ := os.ReadFile(linuxPass); string(p) != "s3cret\n" {
		t.Fatalf("password file %q", p)
	}
	for _, f := range []string{linuxConf, linuxPass} {
		if fi, _ := os.Stat(f); fi.Mode().Perm() != 0o640 {
			t.Errorf("%s: %v", f, fi.Mode())
		}
	}

	// configure without a new password keeps the saved one and restarts a
	// running service only (try-restart).
	*calls = nil
	os.WriteFile(conf, []byte("TOPO_OWNER_EMAIL=boss@example.com\nTOPO_MAIL=smtp\nTOPO_SMTP_HOST=smtp.example.com\nTOPO_SMTP_FROM=Topo <topo@example.com>\nTOPO_SMTP_USER=topo@example.com\n"), 0o600)
	if code := serviceCommand([]string{"configure", conf}, nil, &out, &errb); code != 0 {
		t.Fatalf("configure: %d %s", code, errb.String())
	}
	b, _ = os.ReadFile(linuxConf)
	if !strings.Contains(string(b), "boss@example.com") || !strings.Contains(string(b), "TOPO_SMTP_PASS_FILE=") {
		t.Fatalf("after configure:\n%s", b)
	}
	if strings.Join(*calls, "|") != "systemctl try-restart topo-desktop-server.service" {
		t.Fatalf("configure ran %v", *calls)
	}

	// A setting the server refuses leaves the old file in place.
	os.WriteFile(conf, []byte("TOPO_OWNER_EMAIL=not an address\n"), 0o600)
	errb.Reset()
	if code := serviceCommand([]string{"configure", conf}, nil, &out, &errb); code != 1 || !strings.Contains(errb.String(), "not saved") {
		t.Fatalf("bad setting: %d %s", code, errb.String())
	}
	if b2, _ := os.ReadFile(linuxConf); !bytes.Equal(b, b2) {
		t.Fatal("a refused setting replaced the file")
	}
	if _, err := os.Stat(linuxConf + ".new"); err == nil {
		t.Fatal("a .new file was left behind")
	}

	// status reads systemctl without root.
	st := svcStatus()
	if !st.Supported || !st.Installed || !st.Running {
		t.Fatalf("status %+v", st)
	}

	*calls = nil
	if code := serviceCommand([]string{"uninstall"}, nil, &out, &errb); code != 0 || strings.Join(*calls, "|") != "systemctl disable --now topo-desktop-server.service" {
		t.Fatalf("uninstall: %d %v", code, *calls)
	}
	if _, err := os.Stat(linuxConf); err != nil {
		t.Fatal("uninstall removed the settings")
	}
}

// install without settings writes the all-comment file once and only
// enables (the computer starts it next time); a later install keeps it.
func TestLinuxInstallDefault(t *testing.T) {
	_, calls := fakeSystem(t, "inactive")
	var out, errb bytes.Buffer
	if code := serviceCommand([]string{"install"}, nil, &out, &errb); code != 0 {
		t.Fatalf("install: %d %s", code, errb.String())
	}
	if (*calls)[len(*calls)-1] != "systemctl enable topo-desktop-server.service" {
		t.Fatalf("commands %v", *calls)
	}
	b, _ := os.ReadFile(linuxConf)
	if string(b) != unixConfTemplate {
		t.Fatalf("first settings:\n%s", b)
	}
	if st := svcStatus(); st.Running {
		t.Fatalf("status %+v", st)
	}
}

func TestLinuxNeedsRootAndUnit(t *testing.T) {
	_, _ = fakeSystem(t, "inactive")
	isRoot = func() bool { return false }
	var out, errb bytes.Buffer
	if code := serviceCommand([]string{"start"}, nil, &out, &errb); code != 1 || !strings.Contains(errb.String(), "needs root") {
		t.Fatalf("not root: %d %s", code, errb.String())
	}
	isRoot = func() bool { return true }
	os.Remove(unitPath)
	errb.Reset()
	if code := serviceCommand([]string{"start"}, nil, &out, &errb); code != 2 || !strings.Contains(errb.String(), "desktop app's rpm or deb") {
		t.Fatalf("no unit: %d %s", code, errb.String())
	}
	if st := svcStatus(); st.Supported {
		t.Fatal("supported without the unit")
	}
}
