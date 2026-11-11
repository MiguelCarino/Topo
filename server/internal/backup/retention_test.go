package backup

import (
	"encoding/json"
	"os"
	"testing"
	"time"
	_ "time/tzdata" // the vectors name zones; never depend on the host's zoneinfo
)

// The shared vectors (tests/fixtures/retention.json), made by an
// independent implementation; js/backupdir.js reads the same file.
func TestRetentionVectors(t *testing.T) {
	raw, err := os.ReadFile("../../../tests/fixtures/retention.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []struct {
			Name  string   `json:"name"`
			TZ    string   `json:"tz"`
			Now   string   `json:"now"`
			Times []string `json:"times"`
			Keep  []bool   `json:"keep"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) < 8 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		loc, err := time.LoadLocation(c.TZ)
		if err != nil {
			t.Fatal(err)
		}
		now, _ := time.Parse(time.RFC3339, c.Now)
		ts := make([]time.Time, len(c.Times))
		for i, s := range c.Times {
			ts[i], _ = time.Parse(time.RFC3339, s)
		}
		got := Keep(ts, now, loc)
		for i := range got {
			if got[i] != c.Keep[i] {
				t.Errorf("%s: times[%d] %s: keep %v, want %v", c.Name, i, c.Times[i], got[i], c.Keep[i])
			}
		}
	}
}

func TestRetentionRules(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	if len(Keep(nil, now, time.UTC)) != 0 {
		t.Fatal("empty")
	}
	// A gap never deletes everything: one very old file is kept.
	if k := Keep([]time.Time{now.AddDate(-3, 0, 0)}, now, time.UTC); !k[0] {
		t.Fatal("the only file must stay")
	}
	// 100 files in the last 10 hours: 24 recent, nothing older than that
	// beyond the daily newest (the same day).
	var ts []time.Time
	for i := 0; i < 100; i++ {
		ts = append(ts, now.Add(-time.Duration(i)*6*time.Minute))
	}
	n := 0
	for _, k := range Keep(ts, now, time.UTC) {
		if k {
			n++
		}
	}
	if n != 24 {
		t.Fatalf("burst kept %d, want 24", n)
	}
	// ISO weeks: 2026-12-31 (Thu) and 2027-01-03 (Sun) are the same week
	// (2026-W53), 2027-01-04 is the next.
	a, b := time.Date(2026, 12, 31, 9, 0, 0, 0, time.UTC), time.Date(2027, 1, 3, 9, 0, 0, 0, time.UTC)
	ya, wa := a.ISOWeek()
	yb, wb := b.ISOWeek()
	if ya != yb || wa != wb || wa != 53 {
		t.Fatalf("ISO weeks %d-%d %d-%d", ya, wa, yb, wb)
	}
}
