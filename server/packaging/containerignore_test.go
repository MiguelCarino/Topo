package packaging

import (
	"os"
	"path"
	"regexp"
	"strings"
	"testing"
)

// The container build copies the whole context and Containerfile.dockerignore
// is its only allow-list. Every item desktop/stage.sh copies must be let in,
// or the image build stops at "missing from the source".
func TestContainerIgnoreAdmitsStageItems(t *testing.T) {
	stage, err := os.ReadFile("../../desktop/stage.sh")
	if err != nil {
		t.Skip("desktop/stage.sh not found:", err)
	}
	m := regexp.MustCompile(`(?s)\nITEMS="([^"]*)"`).FindSubmatch(stage)
	if m == nil {
		t.Fatal("no ITEMS list in desktop/stage.sh")
	}
	items := strings.Fields(string(m[1]))
	ign, err := os.ReadFile("../Containerfile.dockerignore")
	if err != nil {
		t.Fatal(err)
	}
	rules := parseIgnore(string(ign))
	for _, it := range append(items, "desktop/stage.sh", "server/go.mod", "server/cmd/topo-server/main.go") {
		if !admitted(rules, it) {
			t.Errorf("%s is copied by desktop/stage.sh (or needed by the build) but Containerfile.dockerignore keeps it out", it)
		}
	}
	for _, out := range []string{".git", "server/dist", "server/web/dist", "docs", "tests", "desktop/src-tauri", "js/.hidden"} {
		if admitted(rules, out) {
			t.Errorf("%s is let into the build context", out)
		}
	}
	cf, err := os.ReadFile("../Containerfile")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(cf), "\nCOPY . ./\n") {
		t.Error("the Containerfile no longer copies the whole (filtered) context")
	}
	if regexp.MustCompile(`(?m)^COPY [^.-].*(index\.html|carino-)`).Match(cf) {
		t.Error("the Containerfile lists app files again: keep one list (Containerfile.dockerignore)")
	}
}

type rule struct {
	pat string
	neg bool
}

func parseIgnore(s string) []rule {
	var out []rule
	for _, l := range strings.Split(s, "\n") {
		l = strings.TrimSpace(l)
		if l == "" || strings.HasPrefix(l, "#") {
			continue
		}
		r := rule{}
		if strings.HasPrefix(l, "!") {
			r.neg, l = true, l[1:]
		}
		r.pat = strings.TrimSuffix(l, "/")
		out = append(out, r)
	}
	return out
}

// admitted follows the .dockerignore rules as moby's pattern matcher does:
// a rule matches a path when it matches the path or one of its parent
// folders, and the last matching rule decides.
func admitted(rules []rule, p string) bool {
	parts := strings.Split(p, "/")
	ex := false
	for _, r := range rules {
		for i := 1; i <= len(parts); i++ {
			if match(r.pat, strings.Join(parts[:i], "/")) {
				ex = !r.neg
				break
			}
		}
	}
	return !ex
}

func match(pat, p string) bool {
	if strings.HasPrefix(pat, "**/") {
		sub := pat[3:]
		segs := strings.Split(p, "/")
		ok, _ := path.Match(sub, segs[len(segs)-1])
		return ok
	}
	ok, _ := path.Match(pat, p)
	return ok
}
