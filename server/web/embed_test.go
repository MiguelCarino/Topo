package web

import (
	"io/fs"
	"regexp"
	"strings"
	"testing"
)

// Every src/href in the staged index.html that names a local file is in the
// embedded copy (the stage script checks the same before it finishes).
func TestStagedIndexComplete(t *testing.T) {
	app := App()
	page, err := fs.ReadFile(app, "index.html")
	if err != nil {
		t.Skip("no staged app (run make stage)")
	}
	re := regexp.MustCompile(`(?:src|href)="([^"]*)"`)
	n := 0
	for _, m := range re.FindAllStringSubmatch(string(page), -1) {
		ref := m[1]
		if ref == "" || strings.HasPrefix(ref, "#") || strings.Contains(ref, ":") || strings.HasPrefix(ref, "//") {
			continue
		}
		ref, _, _ = strings.Cut(ref, "?")
		ref, _, _ = strings.Cut(ref, "#")
		if _, err := fs.Stat(app, ref); err != nil {
			t.Errorf("index.html needs %s, which is not embedded", ref)
		}
		n++
	}
	if n == 0 {
		t.Fatal("no local references found")
	}
	if _, err := fs.Stat(app, "carino-diag.js"); err == nil {
		t.Error("carino-diag.js must not be staged")
	}
}
