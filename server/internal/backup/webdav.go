package backup

import (
	"bytes"
	"context"
	"encoding/xml"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
)

// WebDAV writes into a folder on a WebDAV server: Nextcloud, ownCloud,
// Synology, QNAP (docs/SERVER.md has their addresses). Basic auth over
// https (http only on this machine), no redirects, collections addressed
// with a trailing slash (amendment 14).
type WebDAV struct {
	base *url.URL // ends with "/"
	user string
	pass string
	c    *http.Client
	made map[string]bool // folders known to exist in this session
}

// NewWebDAV opens a WebDAV destination from normalised settings.
func NewWebDAV(s Settings) (*WebDAV, error) {
	b, err := davBase(s.Fields["url"])
	if err != nil {
		return nil, &FieldError{"url", "bad"}
	}
	return &WebDAV{base: b, user: s.Fields["user"], pass: s.Secrets["password"], c: newHTTPClient(s.Fields["fingerprint"]), made: map[string]bool{}}, nil
}

func (w *WebDAV) Kind() string { return "webdav" }

// href is the address of rel ("" is the base; dir adds the trailing slash).
func (w *WebDAV) href(rel string, dir bool) string {
	var b strings.Builder
	b.WriteString(w.base.Scheme + "://" + w.base.Host + w.base.EscapedPath())
	if rel != "" {
		segs := strings.Split(rel, "/")
		for i, s := range segs {
			if i > 0 {
				b.WriteByte('/')
			}
			b.WriteString(url.PathEscape(s))
		}
		if dir {
			b.WriteByte('/')
		}
	}
	return b.String()
}

func (w *WebDAV) do(ctx context.Context, method, rel string, dir bool, body []byte, hdr map[string]string) (*http.Response, error) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, w.href(rel, dir), rd)
	if err != nil {
		return nil, errf(CodeOther, "request: %v", err)
	}
	if body != nil {
		req.ContentLength = int64(len(body))
	}
	req.SetBasicAuth(w.user, w.pass)
	req.Header.Set("User-Agent", "topo-server")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := w.c.Do(req)
	if err != nil {
		return nil, netErr(err)
	}
	return resp, nil
}

func drain(resp *http.Response) {
	io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
}

// mkcol makes the folder rel (its parent must exist). 405 means it is
// there already.
func (w *WebDAV) mkcol(ctx context.Context, rel string) error {
	resp, err := w.do(ctx, "MKCOL", rel, true, nil, nil)
	if err != nil {
		return err
	}
	drain(resp)
	switch resp.StatusCode {
	case 200, 201, 204, 405:
		return nil
	case 409:
		return errf(CodeNotFound, "MKCOL: the parent folder is missing")
	}
	return statusErr(resp.StatusCode)
}

// ensureDir makes the base and every folder of dir, top down.
func (w *WebDAV) ensureDir(ctx context.Context, dir string) error {
	parts := []string{""}
	if dir != "" {
		segs := strings.Split(dir, "/")
		for i := range segs {
			parts = append(parts, strings.Join(segs[:i+1], "/"))
		}
	}
	for _, p := range parts {
		if w.made[p] {
			continue
		}
		if err := w.mkcol(ctx, p); err != nil {
			return err
		}
		w.made[p] = true
	}
	return nil
}

func (w *WebDAV) Put(ctx context.Context, name string, body []byte) (string, error) {
	if len(body) > MaxFile {
		return "", errf(CodeTooLarge, "%d bytes", len(body))
	}
	if !validRel(name) {
		return "", errf(CodeOther, "bad name")
	}
	dir := path.Dir(name)
	if dir == "." {
		dir = ""
	}
	if err := w.ensureDir(ctx, dir); err != nil {
		return "", err
	}
	resp, err := w.do(ctx, "PUT", name, false, body, map[string]string{"Content-Type": "application/json"})
	if err != nil {
		return "", err
	}
	drain(resp)
	switch resp.StatusCode {
	case 200, 201, 204:
	default:
		return "", statusErr(resp.StatusCode)
	}
	// PUT is not atomic on every server: the file must show its whole size
	// before the backup counts (amendment 14).
	ents, err := w.propfind(ctx, name, false)
	if err != nil {
		return "", err
	}
	if len(ents) != 1 || (ents[0].Size >= 0 && ents[0].Size != int64(len(body))) {
		return "", errf(CodeBadAnswer, "the file is not the size written")
	}
	return "", nil
}

func (w *WebDAV) Get(ctx context.Context, name, ref string) (io.ReadCloser, error) {
	if !validRel(name) {
		return nil, errf(CodeOther, "bad name")
	}
	resp, err := w.do(ctx, "GET", name, false, nil, nil)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		drain(resp)
		return nil, statusErr(resp.StatusCode)
	}
	return resp.Body, nil
}

func (w *WebDAV) Delete(ctx context.Context, name, ref string) error {
	if !validRel(name) {
		return errf(CodeOther, "bad name")
	}
	resp, err := w.do(ctx, "DELETE", name, false, nil, nil)
	if err != nil {
		return err
	}
	drain(resp)
	switch resp.StatusCode {
	case 200, 202, 204:
		return nil
	}
	return statusErr(resp.StatusCode)
}

func (w *WebDAV) List(ctx context.Context, dir string) ([]Entry, error) {
	if dir != "" && !validRel(dir) {
		return nil, errf(CodeOther, "bad name")
	}
	ents, err := w.propfind(ctx, dir, true)
	if CodeOf(err) == CodeNotFound {
		return nil, nil
	}
	return ents, err
}

func (w *WebDAV) Check(ctx context.Context) error {
	if err := w.ensureDir(ctx, ""); err != nil {
		return err
	}
	if _, err := w.propfind(ctx, "", true); err != nil {
		return err
	}
	return probe(ctx, w)
}

const propfindBody = `<?xml version="1.0" encoding="utf-8"?>` +
	`<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>`

// multistatus is a 207 answer. Elements are matched by the DAV: namespace
// whatever their prefix.
type multistatus struct {
	XMLName   xml.Name `xml:"DAV: multistatus"`
	Responses []struct {
		Href      string `xml:"DAV: href"`
		Propstats []struct {
			Status string `xml:"DAV: status"`
			Prop   struct {
				Length string `xml:"DAV: getcontentlength"`
				Mod    string `xml:"DAV: getlastmodified"`
				Type   struct {
					Collection *struct{} `xml:"DAV: collection"`
				} `xml:"DAV: resourcetype"`
			} `xml:"DAV: prop"`
		} `xml:"DAV: propstat"`
	} `xml:"DAV: response"`
}

// propfind asks for rel: with dir (Depth 1) the files directly inside it,
// without (Depth 0) the file itself. The folder's own entry and
// sub-folders are skipped. A size the server leaves out is -1.
func (w *WebDAV) propfind(ctx context.Context, rel string, dir bool) ([]Entry, error) {
	depth := "0"
	if dir {
		depth = "1"
	}
	resp, err := w.do(ctx, "PROPFIND", rel, dir && rel != "", []byte(propfindBody), map[string]string{"Depth": depth, "Content-Type": "application/xml; charset=utf-8"})
	if err != nil {
		return nil, err
	}
	defer drain(resp)
	if resp.StatusCode != 207 {
		return nil, statusErr(resp.StatusCode)
	}
	var ms multistatus
	if err := xml.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&ms); err != nil {
		return nil, errf(CodeBadAnswer, "PROPFIND: %v", err)
	}
	self := path.Clean(w.base.Path + rel)
	var out []Entry
	for _, r := range ms.Responses {
		p, ok := hrefPath(r.Href)
		if !ok {
			continue
		}
		if dir && (p == self || path.Dir(p) != self) {
			continue
		}
		if !dir && p != self {
			continue
		}
		for _, ps := range r.Propstats {
			if !strings.Contains(ps.Status, " 200") {
				continue
			}
			if ps.Prop.Type.Collection != nil {
				break
			}
			e := Entry{Name: path.Base(p), Size: -1}
			if n, err := strconv.ParseInt(strings.TrimSpace(ps.Prop.Length), 10, 64); err == nil {
				e.Size = n
			}
			if t, err := http.ParseTime(strings.TrimSpace(ps.Prop.Mod)); err == nil {
				e.Mod = t
			} else {
				e.Mod = time.Time{}
			}
			out = append(out, e)
			break
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// hrefPath is an href (an absolute URL or an absolute path) as a cleaned,
// decoded path.
func hrefPath(h string) (string, bool) {
	h = strings.TrimSpace(h)
	u, err := url.Parse(h)
	if err != nil {
		return "", false
	}
	p, err := url.PathUnescape(u.EscapedPath())
	if err != nil || !strings.HasPrefix(p, "/") {
		return "", false
	}
	return path.Clean(p), true
}
