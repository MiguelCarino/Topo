package packaging

// The desktop app's service files (D125), shipped in the Topo desktop rpm
// and deb (desktop/src-tauri/linux, named in tauri.conf.json): the unit is
// the server package's unit with three marked differences, the sysusers
// line is the same user, and tauri.conf.json ships them all to the paths
// the service command (cmd/topo-server/service_linux.go) expects.

import (
	"encoding/json"
	"encoding/xml"
	"path/filepath"
	"strings"
	"testing"
)

const desktopLinux = "../../desktop/src-tauri/linux"

func TestDesktopUnit(t *testing.T) {
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
	pkg := strip(read(t, "linux/topo-server.service"))
	desk := strip(read(t, filepath.Join(desktopLinux, "topo-desktop-server.service")))
	var expect []string
	for _, l := range pkg {
		switch l {
		case "EnvironmentFile=-/etc/topo/topo.env":
			continue
		case "ExecStart=/usr/bin/topo-server serve":
			expect = append(expect, "ExecStart=/usr/bin/topo-desktop-server serve --config /etc/topo/topo-desktop-server.conf")
			continue
		}
		expect = append(expect, l)
		if strings.HasPrefix(l, "Description=") {
			expect = append(expect, "Conflicts=topo-server.service")
		}
	}
	if strings.Join(expect, "\n") != strings.Join(desk, "\n") {
		t.Fatalf("the desktop unit differs from the packaged one beyond Conflicts/ExecStart/--config:\n%s\n----\n%s", strings.Join(expect, "\n"), strings.Join(desk, "\n"))
	}
	su := strip(read(t, filepath.Join(desktopLinux, "topo-desktop-server.sysusers")))
	if strings.Join(su, "\n") != strings.Join(strip(read(t, "linux/topo.sysusers")), "\n") {
		t.Fatal("the desktop sysusers line differs from the server package's")
	}
}

func TestDesktopPolicyAndConf(t *testing.T) {
	var pol struct {
		Actions []struct {
			ID       string `xml:"id,attr"`
			Annotate []struct {
				Key   string `xml:"key,attr"`
				Value string `xml:",chardata"`
			} `xml:"annotate"`
			Messages []struct {
				Lang string `xml:"lang,attr"`
			} `xml:"message"`
		} `xml:"action"`
	}
	if err := xml.Unmarshal([]byte(read(t, filepath.Join(desktopLinux, "systems.carino.topo.policy"))), &pol); err != nil || len(pol.Actions) != 1 {
		t.Fatalf("policy: %v %+v", err, pol)
	}
	a := pol.Actions[0]
	if len(a.Annotate) != 1 || a.Annotate[0].Value != "/usr/bin/topo-desktop-server" {
		t.Fatalf("the polkit action must name the bundled server: %+v", a.Annotate)
	}
	langs := map[string]bool{}
	for _, m := range a.Messages {
		langs[m.Lang] = true
	}
	for _, l := range []string{"", "es", "pt_BR", "ja", "ru"} {
		if !langs[l] {
			t.Errorf("the prompt's message has no %q", l)
		}
	}

	var conf struct {
		Bundle struct {
			Linux map[string]struct {
				Files             map[string]string `json:"files"`
				PostInstallScript string            `json:"postInstallScript"`
				PreRemoveScript   string            `json:"preRemoveScript"`
				PostRemoveScript  string            `json:"postRemoveScript"`
			} `json:"linux"`
			Windows struct {
				NSIS struct {
					InstallMode    string   `json:"installMode"`
					InstallerHooks string   `json:"installerHooks"`
					Languages      []string `json:"languages"`
				} `json:"nsis"`
			} `json:"windows"`
		} `json:"bundle"`
	}
	if err := json.Unmarshal([]byte(read(t, "../../desktop/src-tauri/tauri.conf.json")), &conf); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"/usr/lib/systemd/system/topo-desktop-server.service":    "linux/topo-desktop-server.service",
		"/usr/lib/sysusers.d/topo-desktop-server.conf":           "linux/topo-desktop-server.sysusers",
		"/usr/share/polkit-1/actions/systems.carino.topo.policy": "linux/systems.carino.topo.policy",
	}
	for _, kind := range []string{"deb", "rpm"} {
		c := conf.Bundle.Linux[kind]
		for dst, src := range want {
			if c.Files[dst] != src {
				t.Errorf("%s: %s should come from %s, not %q", kind, dst, src, c.Files[dst])
			}
		}
		if c.PostInstallScript != "linux/postinst.sh" || c.PreRemoveScript != "linux/prerm.sh" || c.PostRemoveScript != "linux/postrm.sh" {
			t.Errorf("%s scripts: %+v", kind, c)
		}
	}
	n := conf.Bundle.Windows.NSIS
	if n.InstallMode != "perMachine" || n.InstallerHooks != "windows/hooks.nsh" || strings.Join(n.Languages, ",") != "English,Spanish,PortugueseBR,Japanese,Russian" {
		t.Errorf("nsis: %+v", n)
	}
	hooks := read(t, "../../desktop/src-tauri/windows/hooks.nsh")
	for _, s := range []string{"!macro NSIS_HOOK_PREINSTALL", "!macro NSIS_HOOK_POSTINSTALL", "!macro NSIS_HOOK_PREUNINSTALL",
		`service install --start`, `service uninstall`, `"/SERVER"`, `"/NOSERVER"`, "MUI_PAGE_CUSTOMFUNCTION_SHOW TopoWelcomeShow", "ServerQuestion"} {
		if !strings.Contains(hooks, s) {
			t.Errorf("hooks.nsh lacks %q", s)
		}
	}
	if !strings.HasPrefix(hooks, "\xef\xbb\xbf") {
		t.Error("hooks.nsh must start with a UTF-8 BOM (its translations are not ASCII)")
	}
}
