package packaging

// The installers' files (D112), checked here because the Windows MSI and the
// macOS pkg cannot be built on the Linux machine that tests this: every
// file the recipes name exists, the packaged unit differs from the generic
// one only where it should, the LaunchDaemon and the WiX source parse and
// say what SERVER.md says, and the settings files load and set nothing.

import (
	"encoding/xml"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"carino.systems/topo/server/internal/config"
)

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestRecipesNameExistingFiles(t *testing.T) {
	for _, f := range []string{
		"linux/topo-server.service", "linux/topo.sysusers", "linux/topo.env", "linux/backup-folder.conf.example",
		"linux/topo-server.spec", "linux/build-rpm.sh", "linux/build-deb.sh",
		"linux/deb/control.in", "linux/deb/conffiles", "linux/deb/postinst", "linux/deb/prerm", "linux/deb/postrm",
		"windows/topo-server.wxs", "windows/build-msi.ps1", "windows/topo.conf",
		"macos/systems.carino.topo-server.plist", "macos/topo.conf", "macos/build-pkg.sh", "macos/scripts/postinstall",
		"../../docs/SERVER.md", "../../LICENSE",
	} {
		if _, err := os.Stat(f); err != nil {
			t.Errorf("missing %s", f)
		}
	}
	// Every %{topo_src}/X the spec installs is copied in by build-rpm.sh.
	spec, rpmSh := read(t, "linux/topo-server.spec"), read(t, "linux/build-rpm.sh")
	for _, m := range regexp.MustCompile(`%\{topo_src\}/(\S+)`).FindAllStringSubmatch(spec, -1) {
		if m[1] != "topo-server" && !strings.Contains(rpmSh, m[1]) {
			t.Errorf("the spec installs %s, which build-rpm.sh does not copy", m[1])
		}
	}
	// Scripts are executable and parse.
	for _, f := range []string{"linux/build-rpm.sh", "linux/build-deb.sh", "linux/deb/postinst", "linux/deb/prerm", "linux/deb/postrm", "macos/build-pkg.sh", "macos/scripts/postinstall"} {
		st, err := os.Stat(f)
		if err != nil || st.Mode().Perm()&0o111 == 0 {
			t.Errorf("%s is not executable", f)
			continue
		}
		if out, err := exec.Command("sh", "-n", f).CombinedOutput(); err != nil && !strings.HasSuffix(f, ".sh") {
			t.Errorf("sh -n %s: %v %s", f, err, out)
		} else if strings.HasSuffix(f, ".sh") {
			if out, err := exec.Command("bash", "-n", f).CombinedOutput(); err != nil {
				t.Errorf("bash -n %s: %v %s", f, err, out)
			}
		}
	}
}

// The packaged unit is the generic one with a fixed user and /usr/bin.
func TestPackagedUnit(t *testing.T) {
	strip := func(s string) []string {
		var out []string
		for _, l := range strings.Split(s, "\n") {
			if l == "" || strings.HasPrefix(l, "#") {
				continue
			}
			out = append(out, l)
		}
		return out
	}
	gen, pkg := strip(read(t, "topo-server.service")), strip(read(t, "linux/topo-server.service"))
	want := map[string]string{
		"DynamicUser=yes": "",
		"ExecStart=/usr/local/bin/topo-server serve": "ExecStart=/usr/bin/topo-server serve",
	}
	var expect []string
	for _, l := range gen {
		if r, ok := want[l]; ok {
			if r != "" {
				expect = append(expect, r)
			}
			continue
		}
		expect = append(expect, l)
		if l == "User=topo" {
			expect = append(expect, "Group=topo")
		}
	}
	if strings.Join(expect, "\n") != strings.Join(pkg, "\n") {
		t.Fatalf("the packaged unit differs from the generic one beyond User/Group/ExecStart:\n%s\n----\n%s", strings.Join(expect, "\n"), strings.Join(pkg, "\n"))
	}
	for _, l := range pkg {
		if strings.HasPrefix(l, "RestrictAddressFamilies=") && !strings.Contains(l, "AF_NETLINK") {
			t.Error("RestrictAddressFamilies without AF_NETLINK: the server cannot list its LAN addresses (TOPO_TLS_SELF)")
		}
	}
	if !strings.Contains(read(t, "linux/topo.sysusers"), "u topo - ") {
		t.Error("sysusers does not make topo")
	}
}

// The settings files load as settings files, set nothing, and name only
// keys the server knows.
func TestSettingsTemplates(t *testing.T) {
	for _, f := range []string{"linux/topo.env", "macos/topo.conf", "windows/topo.conf"} {
		vals, _, err := config.ReadFile(f)
		if err != nil || len(vals) != 0 {
			t.Errorf("%s: %v %v", f, err, vals)
		}
		for _, m := range regexp.MustCompile(`(?m)^#(TOPO_[A-Z_]+)=(.*)$`).FindAllStringSubmatch(read(t, f), -1) {
			name := strings.TrimSuffix(m[1], "_FILE")
			_, err := config.Load(config.Options{Environ: []string{"TOPO_DATA=" + t.TempDir(), name + "=x"}})
			if err != nil && strings.Contains(err.Error(), "unknown setting") {
				t.Errorf("%s names an unknown key %s", f, m[1])
			}
		}
	}
	// Uncommenting the macOS folder lines keeps the path with its space.
	f := filepath.Join(t.TempDir(), "c")
	os.WriteFile(f, []byte("TOPO_TLS_CERT=/Library/Application Support/Topo/tls/cert.pem\n"), 0o600)
	if v, _, err := config.ReadFile(f); err != nil || v["TOPO_TLS_CERT"] != "/Library/Application Support/Topo/tls/cert.pem" {
		t.Errorf("a path with a space: %v %v", err, v)
	}
}

// plist is the generic shape of an Apple property list.
type plistDict struct {
	Items []plistItem `xml:",any"`
}
type plistItem struct {
	XMLName xml.Name
	Text    string      `xml:",chardata"`
	Items   []plistItem `xml:",any"`
}

func plistMap(items []plistItem) map[string]plistItem {
	m := map[string]plistItem{}
	for i := 0; i+1 < len(items); i += 2 {
		if items[i].XMLName.Local == "key" {
			m[items[i].Text] = items[i+1]
		}
	}
	return m
}

func TestLaunchDaemon(t *testing.T) {
	var doc struct {
		Dict plistDict `xml:"dict"`
	}
	if err := xml.Unmarshal([]byte(read(t, "macos/systems.carino.topo-server.plist")), &doc); err != nil {
		t.Fatal(err)
	}
	m := plistMap(doc.Dict.Items)
	if m["Label"].Text != "systems.carino.topo-server" || m["UserName"].Text != "_topo" || m["GroupName"].Text != "_topo" {
		t.Fatalf("label/user: %+v", m)
	}
	var args []string
	for _, a := range m["ProgramArguments"].Items {
		args = append(args, a.Text)
	}
	if strings.Join(args, "|") != "/usr/local/bin/topo-server|serve|--config|/Library/Application Support/Topo/topo.conf" {
		t.Fatalf("args %v", args)
	}
	env := plistMap(m["EnvironmentVariables"].Items)
	if env["TOPO_DATA"].Text != "/Library/Application Support/Topo/data" {
		t.Fatalf("env %+v", env)
	}
	if m["StandardErrorPath"].Text != "/Library/Logs/Topo/topo-server.log" || m["Umask"].Text != "63" || m["RunAtLoad"].Items != nil && m["RunAtLoad"].XMLName.Local != "true" {
		t.Fatalf("logs/umask: %+v", m)
	}
	if m["KeepAlive"].XMLName.Local != "dict" {
		t.Fatal("KeepAlive")
	}
	if out, err := exec.Command("xmllint", "--noout", "macos/systems.carino.topo-server.plist").CombinedOutput(); err != nil && !strings.Contains(err.Error(), "executable file not found") {
		t.Fatalf("xmllint: %v %s", err, out)
	}
	post := read(t, "macos/scripts/postinstall")
	for _, w := range []string{"dscl . -create /Users/_topo", "chmod 0700 \"$BASE/data\"", "launchctl bootstrap system \"$PLIST\"", "topo.conf.default"} {
		if !strings.Contains(post, w) {
			t.Errorf("postinstall lacks %q", w)
		}
	}
	if !strings.Contains(read(t, "macos/build-pkg.sh"), "topo.conf.default") {
		t.Error("build-pkg.sh does not install topo.conf.default")
	}
}

func TestWixSource(t *testing.T) {
	src := read(t, "windows/topo-server.wxs")
	var doc struct {
		XMLName xml.Name
		Package struct {
			Name        string `xml:",attr"`
			UpgradeCode string `xml:",attr"`
			Groups      []struct {
				ID         string `xml:"Id,attr"`
				Components []struct {
					ID      string                          `xml:"Id,attr"`
					Files   []struct{ Name, Source string } `xml:"File"`
					Service []struct {
						Name      string `xml:",attr"`
						Account   string `xml:",attr"`
						Start     string `xml:",attr"`
						Arguments string `xml:",attr"`
					} `xml:"ServiceInstall"`
					Control []struct {
						Start  string `xml:",attr"`
						Stop   string `xml:",attr"`
						Remove string `xml:",attr"`
					} `xml:"ServiceControl"`
					Permanent      string `xml:",attr"`
					NeverOverwrite string `xml:",attr"`
				} `xml:"Component"`
			} `xml:"ComponentGroup"`
		} `xml:"Package"`
	}
	if err := xml.Unmarshal([]byte(src), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.XMLName.Space != "http://wixtoolset.org/schemas/v4/wxs" || doc.Package.UpgradeCode == "" {
		t.Fatalf("not a WiX v4 package: %v", doc.XMLName)
	}
	seen := map[string]bool{}
	for _, g := range doc.Package.Groups {
		for _, c := range g.Components {
			seen[c.ID] = true
			for _, s := range c.Service {
				if s.Name != "TopoServer" || s.Account != `NT AUTHORITY\LocalService` || s.Start != "auto" || s.Arguments != `serve --config "[DATAFOLDER]topo.conf"` {
					t.Errorf("service %+v", s)
				}
			}
			for _, sc := range c.Control {
				if sc.Start != "" || sc.Remove != "uninstall" || sc.Stop != "both" {
					t.Errorf("control %+v (never started by the installer)", sc)
				}
			}
			if c.ID == "ConfFile" && (c.NeverOverwrite != "yes" || c.Permanent != "yes") {
				t.Error("topo.conf must be kept across upgrades and uninstall")
			}
		}
	}
	for _, id := range []string{"ServerExe", "DataFolder", "ConfFile"} {
		if !seen[id] {
			t.Errorf("no component %s", id)
		}
	}
	if !strings.Contains(read(t, "windows/build-msi.ps1"), "WixToolset.Util.wixext") {
		t.Error("build-msi.ps1 must load the Util extension (ServiceConfig, WixQuietExec)")
	}
	// The data folder's access is protected (no inherited Users read), as
	// `service install` does: util:PermissionEx only adds entries.
	if strings.Contains(src, "<util:PermissionEx") {
		t.Error("util:PermissionEx keeps the inherited access of ProgramData")
	}
	if !strings.Contains(src, `CustomAction Id="LockDataFolder"`) || !strings.Contains(src, "/inheritance:r") || !strings.Contains(src, `Action="LockDataFolder"`) {
		t.Error("no icacls /inheritance:r custom action on the data folder")
	}
}
