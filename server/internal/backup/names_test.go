package backup

import (
	"strings"
	"testing"
	"time"
)

func TestStemAndSlug(t *testing.T) {
	for _, ok := range []string{"clinica-sol", "東京-本社", "офис-1", "a", strings.Repeat("я", 90)} {
		if !ValidSlug(ok) {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"", "a_b", "a.b", "../x", "a/b", "-a", "a-", "a--b", "a b", "a\nb", strings.Repeat("я", 91), strings.Repeat("x", 181)} {
		if ValidSlug(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
	if s := Stem("clinica-sol", "s_AAAAAAAAAAAAAAAAAAAAAA"); s != "clinica-sol" {
		t.Fatal(s)
	}
	// No name: network-<last 8 of the id>, "_" turned into "-", lowercase
	// (amendment 5: an underscore would split the name apart).
	if s := Stem("", "s_AAAAAAAAAAAAAAAbC_d-E9z"); s != "network-bc-d-e9z" {
		t.Fatal(s)
	}
	if s := Stem("bad_slug", "s_AAAAAAAAAAAAAAAAAAAAAA"); !strings.HasPrefix(s, "network-") {
		t.Fatal(s)
	}
}

func TestFileNameSuffixes(t *testing.T) {
	loc, _ := time.LoadLocation("America/Mexico_City")
	at := time.Date(2026, 11, 11, 2, 5, 9, 0, time.UTC) // 20:05:09 the day before in Mexico City
	taken := map[string]bool{}
	is := func(n string) bool { return taken[n] }
	want := []string{
		"topo_x_2026-11-10.json",
		"topo_x_2026-11-10_2005.json",
		"topo_x_2026-11-10_200509.json",
		"topo_x_2026-11-10_200509-2.json",
		"topo_x_2026-11-10_200509-3.json",
	}
	for _, w := range want {
		got := FileName("x", at, loc, is)
		if got != w {
			t.Fatalf("got %q want %q", got, w)
		}
		taken[got] = true
	}
	// nameFromTopoFileName (js/report.js) reads one suffix part with no "_".
	for n := range taken {
		parts := strings.Split(strings.TrimSuffix(n, ".json"), "_")
		if len(parts) > 4 || parts[0] != "topo" {
			t.Errorf("%s does not split back", n)
		}
	}
	// A 180-byte multi-byte name stays within a 255-byte file name.
	long := strings.Repeat("я", 90)
	if n := FileName(long, at, loc, func(n string) bool { return !strings.Contains(n, "-9.json") }); len(n) > 255 || !strings.HasSuffix(n, "-9.json") {
		t.Fatalf("%d bytes", len(n))
	}
}

func TestReadableName(t *testing.T) {
	for _, ok := range []string{"topo_acme_casa_2026-11-10.json", "topo_東京_2026-11-10.json"} {
		if !ValidReadableName(ok) {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"x.json", "topo_a/b.json", `topo_a\b.json`, "topo_..json", "topo_a.html", "topo_a\n.json"} {
		if ValidReadableName(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}
