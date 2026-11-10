package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Marker is the tag the server adds to index.html. js/server.js does nothing
// at all without it (D66), so the same files stay inert on a static host,
// in the offline zip and in the desktop app.
const Marker = `<meta name="topo-server" content="1">`

// App is the static app held in memory: every file with its ETag, and
// index.html with the marker already injected.
type App struct {
	files   map[string]*appFile
	CSP     string // the page's own meta policy (E2); the header adds frame-ancestors
	AppHash string // SHA-256 over "path\tsha256\n" of the unmodified files, sorted
	HasApp  bool   // false when the build has no staged app (index.html missing)
	Count   int
	Bytes   int64
}

type appFile struct {
	body  []byte
	etag  string
	ctype string
}

var cspRe = regexp.MustCompile(`(?i)<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*/?>`)

// LoadApp reads every file of fsys (dotfiles and anything under a dot
// folder are skipped) and prepares index.html. A staged index.html without
// exactly one CSP meta tag is an error: it means a broken stage.
func LoadApp(fsys fs.FS) (*App, error) {
	a := &App{files: map[string]*appFile{}}
	type hashed struct{ p, sum string }
	var sums []hashed
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p != "." && strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() && d.Type()&fs.ModeSymlink == 0 {
			return nil
		}
		b, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(b)
		hexsum := hex.EncodeToString(sum[:])
		sums = append(sums, hashed{p, hexsum})
		a.files[p] = &appFile{body: b, etag: `"` + hexsum[:32] + `"`, ctype: contentType(p)}
		a.Count++
		a.Bytes += int64(len(b))
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(sums, func(i, j int) bool { return sums[i].p < sums[j].p })
	h := sha256.New()
	for _, s := range sums {
		fmt.Fprintf(h, "%s\t%s\n", s.p, s.sum)
	}
	a.AppHash = hex.EncodeToString(h.Sum(nil))

	idx, ok := a.files["index.html"]
	if !ok {
		return a, nil
	}
	body, csp, err := InjectMarker(idx.body)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(body)
	idx.body = body
	idx.etag = `"` + hex.EncodeToString(sum[:16]) + `"`
	a.CSP = csp
	a.HasApp = true
	return a, nil
}

// InjectMarker puts Marker on its own line right after the CSP meta tag and
// returns the page's policy.
func InjectMarker(page []byte) ([]byte, string, error) {
	locs := cspRe.FindAllSubmatchIndex(page, -1)
	if len(locs) != 1 {
		return nil, "", fmt.Errorf("index.html has %d Content-Security-Policy meta tags, want exactly 1 (is the stage broken?)", len(locs))
	}
	loc := locs[0]
	csp := string(page[loc[2]:loc[3]])
	if bytes.Contains(page, []byte(`name="topo-server"`)) {
		return nil, "", errors.New("index.html already carries the topo-server marker")
	}
	// The line's own indentation, so the page source stays tidy.
	lineStart := bytes.LastIndexByte(page[:loc[0]], '\n') + 1
	indent := page[lineStart:loc[0]]
	if len(bytes.TrimLeft(indent, " \t")) != 0 {
		indent = nil
	}
	end := loc[1]
	var out bytes.Buffer
	out.Grow(len(page) + len(Marker) + 16)
	out.Write(page[:end])
	out.WriteByte('\n')
	out.Write(indent)
	out.WriteString(Marker)
	out.Write(page[end:])
	return out.Bytes(), csp, nil
}

// HeaderCSP is the response header policy: the page's own policy plus
// frame-ancestors, which a meta policy cannot carry. It is never stricter
// than the meta policy otherwise (E2), and a test compares the two.
func (a *App) HeaderCSP() string {
	p := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(a.CSP), ";"))
	if p == "" {
		return "frame-ancestors 'none'"
	}
	return p + "; frame-ancestors 'none'"
}

var types = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".webp":        "image/webp",
	".gif":         "image/gif",
	".ico":         "image/x-icon",
	".woff":        "font/woff",
	".woff2":       "font/woff2",
	".ttf":         "font/ttf",
	".otf":         "font/otf",
	".txt":         "text/plain; charset=utf-8",
	".md":          "text/plain; charset=utf-8",
	".wasm":        "application/wasm",
	".webmanifest": "application/manifest+json",
}

func contentType(p string) string {
	if t, ok := types[strings.ToLower(path.Ext(p))]; ok {
		return t
	}
	if path.Base(p) == "LICENSE" {
		return "text/plain; charset=utf-8"
	}
	return "application/octet-stream"
}

// modTime is the Last-Modified every asset claims; ETags carry the truth.
var modTime = time.Unix(0, 0)

// ServeHTTP serves the app: "/" is index.html; dotfiles, ".." and folders
// are 404. Every response is revalidated (no-cache) against its ETag.
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p := r.URL.Path
	if p == "/" {
		p = "/index.html"
	}
	if !a.HasApp && p == "/index.html" {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "The app is not in this build. Run make stage, then build again.", http.StatusServiceUnavailable)
		return
	}
	f, ok := a.lookup(p)
	if !ok {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	h := w.Header()
	h.Set("Content-Type", f.ctype)
	h.Set("ETag", f.etag)
	h.Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "", modTime, bytes.NewReader(f.body))
}

func (a *App) lookup(p string) (*appFile, bool) {
	if !strings.HasPrefix(p, "/") || strings.Contains(p, "\\") || strings.Contains(p, "\x00") {
		return nil, false
	}
	rel := strings.TrimPrefix(p, "/")
	for _, seg := range strings.Split(rel, "/") {
		if seg == "" || seg == "." || seg == ".." || strings.HasPrefix(seg, ".") {
			return nil, false
		}
	}
	f, ok := a.files[rel]
	return f, ok
}
