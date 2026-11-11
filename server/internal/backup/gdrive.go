package backup

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// GDrive writes into a folder "Topo" in the owner's Google Drive, through
// Drive v3's REST API with the drive.file scope: Topo sees only the files
// it made itself (D110). Drive names are not unique, so files are tracked
// by id (backups.ref), and a name written again replaces the older file.
// Up to 5 MB a file goes up in one multipart request, above that through a
// resumable upload (amendment 17).
type GDrive struct {
	o   *oauthClient
	ep  Endpoints
	mu  sync.Mutex
	ref RefJSON
	ids map[string]string // folder path ("" is Topo) -> id, this session
}

const (
	driveFolderMime = "application/vnd.google-apps.folder"
	driveRootName   = "Topo"
	// DriveMultipartMax is the largest body sent in one multipart upload.
	DriveMultipartMax = 5 << 20
)

// NewGDrive opens a Google Drive destination.
func NewGDrive(s Settings, h Hooks) (*GDrive, error) {
	o, err := newOAuthClient("gdrive", s, h)
	if err != nil {
		return nil, err
	}
	return &GDrive{o: o, ep: endpointsOf("gdrive", ""), ref: ParseRef(h.Ref), ids: map[string]string{}}, nil
}

func (g *GDrive) Kind() string { return "gdrive" }

// Ref is oauth_ref after use: the Topo folder's id and the account.
func (g *GDrive) Ref() string { g.mu.Lock(); defer g.mu.Unlock(); return g.ref.String() }

type driveFile struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Size         string `json:"size"`
	ModifiedTime string `json:"modifiedTime"`
	MimeType     string `json:"mimeType"`
	Trashed      bool   `json:"trashed"`
}

// qstr quotes s for a Drive query.
func qstr(s string) string {
	return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(s) + "'"
}

// find lists the children of parent matching extra (a Drive query clause).
func (g *GDrive) find(ctx context.Context, parent, extra string) ([]driveFile, error) {
	q := qstr(parent) + " in parents and trashed = false"
	if extra != "" {
		q += " and " + extra
	}
	var out []driveFile
	token := ""
	for page := 0; page < 1000; page++ {
		v := url.Values{"q": {q}, "fields": {"nextPageToken,files(id,name,size,modifiedTime,mimeType)"}, "pageSize": {"1000"}, "spaces": {"drive"}}
		if token != "" {
			v.Set("pageToken", token)
		}
		var ans struct {
			NextPageToken string      `json:"nextPageToken"`
			Files         []driveFile `json:"files"`
		}
		if err := g.o.json(ctx, apiReq{method: "GET", url: g.ep.API + "/files?" + v.Encode()}, &ans); err != nil {
			return nil, err
		}
		out = append(out, ans.Files...)
		if ans.NextPageToken == "" {
			return out, nil
		}
		token = ans.NextPageToken
	}
	return nil, errf(CodeBadAnswer, "list: too many pages")
}

func (g *GDrive) mkdir(ctx context.Context, parent, name string) (string, error) {
	meta, _ := json.Marshal(map[string]any{"name": name, "mimeType": driveFolderMime, "parents": []string{parent}})
	var f driveFile
	if err := g.o.json(ctx, apiReq{method: "POST", url: g.ep.API + "/files?fields=id", body: meta, hdr: map[string]string{"Content-Type": "application/json; charset=UTF-8"}}, &f); err != nil {
		return "", err
	}
	if f.ID == "" {
		return "", errf(CodeBadAnswer, "no folder id")
	}
	return f.ID, nil
}

// root is the Topo folder's id: the saved one while it is there, else the
// one Topo made before (drive.file finds only Topo's own), else a new one.
func (g *GDrive) root(ctx context.Context, create bool) (string, error) {
	g.mu.Lock()
	id, known := g.ids[""]
	saved := g.ref.Folder
	g.mu.Unlock()
	if known {
		return id, nil
	}
	if saved != "" {
		var f driveFile
		err := g.o.json(ctx, apiReq{method: "GET", url: g.ep.API + "/files/" + url.PathEscape(saved) + "?fields=id,trashed,mimeType"}, &f)
		if err == nil && !f.Trashed && f.MimeType == driveFolderMime {
			g.setDir("", saved)
			return saved, nil
		}
		if err != nil && CodeOf(err) != CodeNotFound {
			return "", err
		}
	}
	found, err := g.find(ctx, "root", "name = "+qstr(driveRootName)+" and mimeType = "+qstr(driveFolderMime))
	if err != nil {
		return "", err
	}
	if len(found) > 0 {
		id = found[0].ID
	} else if !create {
		return "", nil
	} else if id, err = g.mkdir(ctx, "root", driveRootName); err != nil {
		return "", err
	}
	g.setDir("", id)
	g.mu.Lock()
	changed := g.ref.Folder != id
	g.ref.Folder = id
	ref := g.ref.String()
	g.mu.Unlock()
	if changed && g.o.hooks.Save != nil {
		g.o.hooks.Save(g.o.secrets, ref)
	}
	return id, nil
}

func (g *GDrive) setDir(dir, id string) { g.mu.Lock(); g.ids[dir] = id; g.mu.Unlock() }

// dirID is the id of the folder dir ("<site>" or "<site>/readable"),
// made when create; "" when it is not there.
func (g *GDrive) dirID(ctx context.Context, dir string, create bool) (string, error) {
	id, err := g.root(ctx, create)
	if err != nil || id == "" || dir == "" {
		return id, err
	}
	cur := ""
	for _, seg := range strings.Split(dir, "/") {
		next := seg
		if cur != "" {
			next = cur + "/" + seg
		}
		g.mu.Lock()
		known, ok := g.ids[next]
		g.mu.Unlock()
		if ok {
			id, cur = known, next
			continue
		}
		found, err := g.find(ctx, id, "name = "+qstr(seg)+" and mimeType = "+qstr(driveFolderMime))
		if err != nil {
			return "", err
		}
		switch {
		case len(found) > 0:
			id = found[0].ID
		case !create:
			return "", nil
		default:
			if id, err = g.mkdir(ctx, id, seg); err != nil {
				return "", err
			}
		}
		g.setDir(next, id)
		cur = next
	}
	return id, nil
}

func splitName(name string) (dir, base string) {
	if i := strings.LastIndex(name, "/"); i >= 0 {
		return name[:i], name[i+1:]
	}
	return "", name
}

// filesNamed are the ids of the files called base in dir, newest first.
func (g *GDrive) filesNamed(ctx context.Context, dir, base string) ([]driveFile, error) {
	pid, err := g.dirID(ctx, dir, false)
	if err != nil || pid == "" {
		return nil, err
	}
	fs, err := g.find(ctx, pid, "name = "+qstr(base)+" and mimeType != "+qstr(driveFolderMime))
	sort.Slice(fs, func(i, j int) bool { return fs[i].ModifiedTime > fs[j].ModifiedTime })
	return fs, err
}

func (g *GDrive) Put(ctx context.Context, name string, body []byte) (string, error) {
	if len(body) > MaxFile {
		return "", errf(CodeTooLarge, "%d bytes", len(body))
	}
	if !validRel(name) {
		return "", errf(CodeOther, "bad name")
	}
	dir, base := splitName(name)
	pid, err := g.dirID(ctx, dir, true)
	if err != nil {
		return "", err
	}
	old, err := g.filesNamed(ctx, dir, base)
	if err != nil {
		return "", err
	}
	meta, _ := json.Marshal(map[string]any{"name": base, "parents": []string{pid}, "mimeType": "application/json"})
	var f driveFile
	if len(body) <= DriveMultipartMax {
		err = g.multipart(ctx, meta, body, &f)
	} else {
		err = g.resumable(ctx, meta, body, &f)
	}
	if err != nil {
		return "", err
	}
	if f.ID == "" {
		return "", errf(CodeBadAnswer, "no file id")
	}
	if n, perr := strconv.ParseInt(f.Size, 10, 64); perr == nil && n != int64(len(body)) {
		g.Delete(ctx, name, f.ID)
		return "", errf(CodeBadAnswer, "the file is not the size written")
	}
	for _, o := range old {
		if o.ID != f.ID {
			g.o.do(ctx, apiReq{method: "DELETE", url: g.ep.API + "/files/" + url.PathEscape(o.ID)})
		}
	}
	return f.ID, nil
}

func (g *GDrive) multipart(ctx context.Context, meta, body []byte, f *driveFile) error {
	b := make([]byte, 12)
	rand.Read(b)
	boundary := "topo" + hex.EncodeToString(b)
	var buf bytes.Buffer
	buf.WriteString("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n")
	buf.Write(meta)
	buf.WriteString("\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n")
	buf.Write(body)
	buf.WriteString("\r\n--" + boundary + "--\r\n")
	return g.o.json(ctx, apiReq{method: "POST", url: g.ep.Upload + "/files?uploadType=multipart&fields=id,size", body: buf.Bytes(),
		hdr: map[string]string{"Content-Type": "multipart/related; boundary=" + boundary}}, f)
}

// resumable starts an upload session and sends the body in one PUT to the
// session address, which must be on the upload host.
func (g *GDrive) resumable(ctx context.Context, meta, body []byte, f *driveFile) error {
	resp, err := g.o.do(ctx, apiReq{method: "POST", url: g.ep.Upload + "/files?uploadType=resumable&fields=id,size", body: meta,
		hdr: map[string]string{"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/json", "X-Upload-Content-Length": strconv.Itoa(len(body))}})
	if err != nil {
		return err
	}
	drain(resp)
	if resp.StatusCode != 200 {
		return statusErr(resp.StatusCode)
	}
	loc := resp.Header.Get("Location")
	if loc == "" || !sameOrigin(loc, g.ep.Upload) {
		return errf(CodeBadAnswer, "upload session elsewhere")
	}
	return g.o.json(ctx, apiReq{method: "PUT", url: loc, body: body, hdr: map[string]string{"Content-Type": "application/json"}}, f)
}

func (g *GDrive) idOf(ctx context.Context, name, ref string) (string, error) {
	if ref != "" {
		return ref, nil
	}
	dir, base := splitName(name)
	fs, err := g.filesNamed(ctx, dir, base)
	if err != nil {
		return "", err
	}
	if len(fs) == 0 {
		return "", errf(CodeNotFound, "no such file")
	}
	return fs[0].ID, nil
}

func (g *GDrive) Get(ctx context.Context, name, ref string) (io.ReadCloser, error) {
	if !validRel(name) {
		return nil, errf(CodeOther, "bad name")
	}
	id, err := g.idOf(ctx, name, ref)
	if err != nil {
		return nil, err
	}
	resp, err := g.o.do(ctx, apiReq{method: "GET", url: g.ep.API + "/files/" + url.PathEscape(id) + "?alt=media"})
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		drain(resp)
		return nil, statusErr(resp.StatusCode)
	}
	return resp.Body, nil
}

func (g *GDrive) Delete(ctx context.Context, name, ref string) error {
	if !validRel(name) {
		return errf(CodeOther, "bad name")
	}
	id, err := g.idOf(ctx, name, ref)
	if err != nil {
		return err
	}
	resp, err := g.o.do(ctx, apiReq{method: "DELETE", url: g.ep.API + "/files/" + url.PathEscape(id)})
	if err != nil {
		return err
	}
	drain(resp)
	if resp.StatusCode == 200 || resp.StatusCode == 204 {
		return nil
	}
	return statusErr(resp.StatusCode)
}

func (g *GDrive) List(ctx context.Context, dir string) ([]Entry, error) {
	if dir != "" && !validRel(dir) {
		return nil, errf(CodeOther, "bad name")
	}
	pid, err := g.dirID(ctx, dir, false)
	if err != nil || pid == "" {
		return nil, err
	}
	fs, err := g.find(ctx, pid, "mimeType != "+qstr(driveFolderMime))
	if err != nil {
		return nil, err
	}
	var out []Entry
	for _, f := range fs {
		e := Entry{Name: f.Name, Size: -1, Ref: f.ID}
		if n, err := strconv.ParseInt(f.Size, 10, 64); err == nil {
			e.Size = n
		}
		if t, err := time.Parse(time.RFC3339, f.ModifiedTime); err == nil {
			e.Mod = t
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (g *GDrive) Check(ctx context.Context) error {
	if _, err := g.root(ctx, true); err != nil {
		return err
	}
	return probe(ctx, g)
}

// Account is the Google account's address, when Drive says it ("" if not).
func (g *GDrive) Account(ctx context.Context) string {
	var ans struct {
		User struct {
			EmailAddress string `json:"emailAddress"`
			DisplayName  string `json:"displayName"`
		} `json:"user"`
	}
	if err := g.o.json(ctx, apiReq{method: "GET", url: g.ep.API + "/about?fields=user(emailAddress,displayName)"}, &ans); err != nil {
		return ""
	}
	a := ans.User.EmailAddress
	if a == "" {
		a = ans.User.DisplayName
	}
	g.mu.Lock()
	g.ref.Account = a
	g.mu.Unlock()
	return a
}
