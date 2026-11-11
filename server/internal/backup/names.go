package backup

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Names on the drive (D101): <site>/topo_<stem>_<YYYY-MM-DD>.json, later
// files of the same day with _HHMM, then _HHMMSS, then -2, -3... (amendment
// 6). The time is the server's local time. Readable copies go in
// <site>/readable/ under the name the owner's browser made.
//
// The stem is the network's name in the form the owner's browser made
// (fileSlug in js/report.js; the server has no Unicode normalisation to
// make it, amendment 4) when the owner shows the name in clear, otherwise
// network-<the last 8 characters of the site id>.

// MaxSlugBytes is the byte budget of a name in a file name (the browser's
// TOPO_NAMES_BYTES).
const MaxSlugBytes = 180

var slugRe = regexp.MustCompile(`^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$`)

// ValidSlug checks a name the browser made for file names: letters, marks
// and digits in runs joined by single hyphens, at most MaxSlugBytes, no
// underscore (it separates the parts), dot, slash or control character.
func ValidSlug(s string) bool {
	return s != "" && len(s) <= MaxSlugBytes && slugRe.MatchString(s)
}

// Stem is the name part of a backup's file name.
func Stem(slug, siteID string) string {
	if ValidSlug(slug) {
		return slug
	}
	id := siteID
	if len(id) > 8 {
		id = id[len(id)-8:]
	}
	// A "_" inside the stem would break nameFromTopoFileName (amendment 5).
	return "network-" + strings.ToLower(strings.ReplaceAll(id, "_", "-"))
}

// FileName is the first free name for a file made at t: taken reports
// whether a name is in use already (the backups table and the folder).
func FileName(stem string, t time.Time, loc *time.Location, taken func(string) bool) string {
	return Suffixed("topo_"+stem+"_"+t.In(loc).Format("2006-01-02"), t, loc, taken)
}

// Suffixed is base + ".json", or with the first free time suffix.
func Suffixed(base string, t time.Time, loc *time.Location, taken func(string) bool) string {
	lt := t.In(loc)
	for _, n := range []string{base, base + "_" + lt.Format("1504"), base + "_" + lt.Format("150405")} {
		if !taken(n + ".json") {
			return n + ".json"
		}
	}
	for i := 2; i < 10000; i++ {
		n := fmt.Sprintf("%s_%s-%d.json", base, lt.Format("150405"), i)
		if !taken(n) {
			return n
		}
	}
	return fmt.Sprintf("%s_%s-%d.json", base, lt.Format("150405"), lt.UnixNano())

}

var readableRe = regexp.MustCompile(`^topo_[^/\\\x00-\x1f]+\.json$`)

// ValidReadableName checks the name a browser gave a readable copy: a Topo
// file name (topo_….json) with no folder part, at most 240 bytes.
func ValidReadableName(s string) bool {
	return len(s) <= 240 && readableRe.MatchString(s) && !strings.Contains(s, "..")
}
