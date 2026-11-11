// Package backuptest holds fakes for the backup engine's tests: a clock, an
// in-memory destination and a WebDAV server (an http.Handler). They are
// not in _test files so the api tests can use them too. Nothing here talks
// to a real service.
package backuptest

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"carino.systems/topo/server/internal/backup"
)

// Clock is a settable clock.
type Clock struct {
	mu sync.Mutex
	t  time.Time
}

func NewClock(t time.Time) *Clock    { return &Clock{t: t} }
func (c *Clock) Now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *Clock) Add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }
func (c *Clock) Set(t time.Time)     { c.mu.Lock(); c.t = t; c.mu.Unlock() }

// Mem is an in-memory destination. Fail, when set, makes every operation
// fail with that code; FailPut only the writes.
type Mem struct {
	mu      sync.Mutex
	Files   map[string][]byte
	Fail    string
	FailPut string
	// FailDelete makes deletes fail with that code (an S3 bucket's object
	// lock: "locked").
	FailDelete string
	Puts       int
	Deletes    int
	Checks     int
	// Active counts operations in progress; MaxActive the most at once
	// (one run at a time).
	active, MaxActive int
	// Hold, when set, is waited on inside Put (to test overlap).
	Hold chan struct{}
	// OnPut, when set, runs inside Put before the file is stored (to land
	// a change while a backup is being written).
	OnPut func(name string)
}

func NewMem() *Mem { return &Mem{Files: map[string][]byte{}} }

func (m *Mem) Kind() string { return "mem" }

func (m *Mem) enter() func() {
	m.mu.Lock()
	m.active++
	if m.active > m.MaxActive {
		m.MaxActive = m.active
	}
	m.mu.Unlock()
	return func() { m.mu.Lock(); m.active--; m.mu.Unlock() }
}

func (m *Mem) err(put bool) error {
	if m.Fail != "" {
		return &backup.Error{Code: m.Fail}
	}
	if put && m.FailPut != "" {
		return &backup.Error{Code: m.FailPut}
	}
	return nil
}

func (m *Mem) Put(ctx context.Context, name string, body []byte) (string, error) {
	defer m.enter()()
	if m.Hold != nil {
		<-m.Hold
	}
	if m.OnPut != nil {
		m.OnPut(name)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.err(true); err != nil {
		return "", err
	}
	m.Puts++
	m.Files[name] = append([]byte(nil), body...)
	return "", nil
}

func (m *Mem) Get(ctx context.Context, name, ref string) (io.ReadCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.err(false); err != nil {
		return nil, err
	}
	b, ok := m.Files[name]
	if !ok {
		return nil, &backup.Error{Code: backup.CodeNotFound}
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

func (m *Mem) List(ctx context.Context, dir string) ([]backup.Entry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.err(false); err != nil {
		return nil, err
	}
	var out []backup.Entry
	for n, b := range m.Files {
		if path.Dir(n) == dir {
			out = append(out, backup.Entry{Name: path.Base(n), Size: int64(len(b))})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (m *Mem) Delete(ctx context.Context, name, ref string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.err(false); err != nil {
		return err
	}
	if m.FailDelete != "" {
		return &backup.Error{Code: m.FailDelete}
	}
	if _, ok := m.Files[name]; !ok {
		return &backup.Error{Code: backup.CodeNotFound}
	}
	m.Deletes++
	delete(m.Files, name)
	return nil
}

func (m *Mem) Check(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Checks++
	return m.err(true)
}

// Names lists the files under dir, sorted.
func (m *Mem) Names(dir string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for n := range m.Files {
		if path.Dir(n) == dir {
			out = append(out, path.Base(n))
		}
	}
	sort.Strings(out)
	return out
}

// WebDAV is an in-memory WebDAV server: MKCOL, PUT, GET, DELETE, PROPFIND
// (Depth 0 and 1), Basic auth, a quota (507), a body limit (413), MKCOL 409
// when the parent is missing, and traps (amendment 14).
type WebDAV struct {
	User, Pass string
	// Prefix is the path the tree lives under (e.g. "/remote.php/dav/files/ana").
	Prefix string
	// Quota, when > 0, is the most bytes stored (507 above it).
	Quota int
	// MaxBody, when > 0, answers 413 to a larger PUT.
	MaxBody int
	// AbsoluteHrefs answers PROPFIND hrefs as full URLs.
	AbsoluteHrefs bool
	// Redirect: paths under it answer 301 (a redirect trap).
	Redirect string
	// ShortPut stores one byte less than sent (a PUT that is not atomic).
	ShortPut bool

	mu    sync.Mutex
	files map[string][]byte
	mods  map[string]time.Time
	dirs  map[string]bool
	Log   []string // "METHOD path"
}

// NewWebDAV makes a server whose Prefix folder exists.
func NewWebDAV(user, pass, prefix string) *WebDAV {
	w := &WebDAV{User: user, Pass: pass, Prefix: strings.TrimSuffix(prefix, "/"), files: map[string][]byte{}, mods: map[string]time.Time{}, dirs: map[string]bool{"/": true}}
	p := ""
	for _, seg := range strings.Split(strings.Trim(w.Prefix, "/"), "/") {
		if seg == "" {
			continue
		}
		p += "/" + seg
		w.dirs[p] = true
	}
	return w
}

// File returns a stored file (path relative to Prefix, unescaped).
func (w *WebDAV) File(rel string) ([]byte, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	b, ok := w.files[path.Clean(w.Prefix+"/"+rel)]
	return b, ok
}

// SetFile replaces a stored file (to tamper with it).
func (w *WebDAV) SetFile(rel string, b []byte) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.files[path.Clean(w.Prefix+"/"+rel)] = b
}

// Files lists stored files relative to Prefix.
func (w *WebDAV) Files() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []string
	for p := range w.files {
		out = append(out, strings.TrimPrefix(p, w.Prefix+"/"))
	}
	sort.Strings(out)
	return out
}

func (w *WebDAV) used() int {
	n := 0
	for _, b := range w.files {
		n += len(b)
	}
	return n
}

func (w *WebDAV) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	w.mu.Lock()
	defer w.mu.Unlock()
	p, err := url.PathUnescape(r.URL.EscapedPath())
	if err != nil {
		http.Error(rw, "bad path", 400)
		return
	}
	isDir := strings.HasSuffix(p, "/")
	p = path.Clean(p)
	w.Log = append(w.Log, r.Method+" "+p)
	if user, pass, ok := r.BasicAuth(); !ok || user != w.User || pass != w.Pass {
		rw.Header().Set("WWW-Authenticate", `Basic realm="fake"`)
		rw.WriteHeader(401)
		return
	}
	if w.Redirect != "" && strings.HasPrefix(p, path.Clean(w.Redirect)) {
		http.Redirect(rw, r, "http://elsewhere.invalid"+p, http.StatusMovedPermanently)
		return
	}
	switch r.Method {
	case "MKCOL":
		if w.dirs[p] || w.files[p] != nil {
			rw.WriteHeader(405)
			return
		}
		if !w.dirs[path.Dir(p)] {
			rw.WriteHeader(409)
			return
		}
		w.dirs[p] = true
		rw.WriteHeader(201)
	case "PUT":
		if isDir || w.dirs[p] {
			rw.WriteHeader(405)
			return
		}
		if !w.dirs[path.Dir(p)] {
			rw.WriteHeader(409)
			return
		}
		body, _ := io.ReadAll(r.Body)
		if w.MaxBody > 0 && len(body) > w.MaxBody {
			rw.WriteHeader(413)
			return
		}
		if w.Quota > 0 && w.used()-len(w.files[p])+len(body) > w.Quota {
			rw.WriteHeader(507)
			return
		}
		if w.ShortPut && len(body) > 0 {
			body = body[:len(body)-1]
		}
		_, existed := w.files[p]
		w.files[p] = body
		w.mods[p] = time.Now()
		if existed {
			rw.WriteHeader(204)
		} else {
			rw.WriteHeader(201)
		}
	case "GET":
		b, ok := w.files[p]
		if !ok {
			rw.WriteHeader(404)
			return
		}
		rw.Header().Set("Content-Length", strconv.Itoa(len(b)))
		rw.WriteHeader(200)
		rw.Write(b)
	case "DELETE":
		if _, ok := w.files[p]; !ok {
			rw.WriteHeader(404)
			return
		}
		delete(w.files, p)
		rw.WriteHeader(204)
	case "PROPFIND":
		depth := r.Header.Get("Depth")
		var list []string
		switch {
		case w.dirs[p]:
			list = append(list, p)
			if depth == "1" {
				for q := range w.dirs {
					if q != p && path.Dir(q) == p {
						list = append(list, q)
					}
				}
				for q := range w.files {
					if path.Dir(q) == p {
						list = append(list, q)
					}
				}
			}
		case w.files[p] != nil:
			list = append(list, p)
		default:
			rw.WriteHeader(404)
			return
		}
		sort.Strings(list)
		var b strings.Builder
		b.WriteString(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:" xmlns:oc="http://owncloud.org/ns">`)
		for _, q := range list {
			href := (&url.URL{Path: q}).EscapedPath()
			if w.dirs[q] {
				href += "/"
			}
			if w.AbsoluteHrefs {
				href = "http://" + r.Host + href
			}
			b.WriteString("<D:response><D:href>")
			xml.EscapeText(&b, []byte(href))
			b.WriteString("</D:href><D:propstat><D:prop>")
			if w.dirs[q] {
				b.WriteString("<D:resourcetype><D:collection/></D:resourcetype>")
			} else {
				fmt.Fprintf(&b, "<D:resourcetype/><D:getcontentlength>%d</D:getcontentlength><D:getlastmodified>%s</D:getlastmodified>",
					len(w.files[q]), w.mods[q].UTC().Format(http.TimeFormat))
			}
			b.WriteString("</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>")
			b.WriteString("<D:propstat><D:prop><oc:size/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>")
		}
		b.WriteString("</D:multistatus>")
		rw.Header().Set("Content-Type", "application/xml; charset=utf-8")
		rw.WriteHeader(207)
		io.WriteString(rw, b.String())
	default:
		rw.WriteHeader(405)
	}
}

// BasicAuth is the Authorization value for user and pass (tests).
func BasicAuth(user, pass string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass))
}
