package packaging

import (
	"io/fs"
	"strings"
	"testing"
)

func TestUnits(t *testing.T) {
	for name, want := range map[string][]string{
		"topo-server.service":      {"ExecStart=/usr/local/bin/topo-server serve", "StateDirectory=topo", "TimeoutStopSec=60", "DynamicUser=yes"},
		"topo-server.user.service": {"ExecStart=%h/.local/bin/topo-server serve", "TOPO_DATA=%h/.local/share/topo"},
		"container/topo.container": {"PublishPort=127.0.0.1:7380:7380", "Volume=topo-data:/data", "HealthCmd=/topo-server healthcheck"},
	} {
		b, err := fs.ReadFile(Files, name)
		if err != nil {
			t.Fatal(err)
		}
		for _, w := range want {
			if !strings.Contains(string(b), w) {
				t.Errorf("%s lacks %q", name, w)
			}
		}
	}
}
