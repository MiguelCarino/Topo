package backup

import (
	"fmt"
	"sort"
	"time"
)

// Retention (D103), per network and kind, over the files Topo wrote only:
//   - the newest file, always;
//   - every file from the last 24 hours, at most 24;
//   - the newest file of each of the 7 most recent days that have one,
//     of the 4 most recent ISO weeks that have one, and of the 12 most
//     recent months that have one.
//
// "That have one" is restic's rule, not a calendar window: a network left
// alone for a month still keeps its last files, so a gap never deletes
// everything. Days, weeks and months are counted in loc (the server's time
// zone, amendment 10). tests/fixtures/retention.json holds vectors the
// browser's port (js/backupdir.js) shares.
const (
	KeepRecentMax = 24
	KeepDaily     = 7
	KeepWeekly    = 4
	KeepMonthly   = 12
)

// Keep returns, for each time in times (any order), whether that file is
// kept at now.
func Keep(times []time.Time, now time.Time, loc *time.Location) []bool {
	keep := make([]bool, len(times))
	if len(times) == 0 {
		return keep
	}
	idx := make([]int, len(times))
	for i := range idx {
		idx[i] = i
	}
	// Newest first; equal times by position, so the result is stable.
	sort.SliceStable(idx, func(a, b int) bool { return times[idx[a]].After(times[idx[b]]) })
	keep[idx[0]] = true

	recent := 0
	for _, i := range idx {
		if recent >= KeepRecentMax {
			break
		}
		if d := now.Sub(times[i]); d >= 0 && d < 24*time.Hour {
			keep[i] = true
			recent++
		}
	}
	bucket := func(n int, key func(t time.Time) string) {
		last, count := "", 0
		for _, i := range idx {
			if count >= n {
				return
			}
			k := key(times[i].In(loc))
			if k != last {
				keep[i] = true
				last = k
				count++
			}
		}
	}
	bucket(KeepDaily, func(t time.Time) string { return t.Format("2006-01-02") })
	bucket(KeepWeekly, func(t time.Time) string { y, w := t.ISOWeek(); return fmt.Sprintf("%d-W%02d", y, w) })
	bucket(KeepMonthly, func(t time.Time) string { return t.Format("2006-01") })
	return keep
}
