package backup

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"carino.systems/topo/server/internal/platform"
)

// MarkerName is the file a folder destination must hold once saved
// (amendment 13): an unplugged USB disk leaves an empty mount point on the
// system disk, and without the marker the server would fill that disk
// believing it was backing up.
const MarkerName = ".topo-backups"

// allowedFolder checks that p is an absolute folder inside one of roots
// (TOPO_BACKUP_FOLDERS, set by whoever installs the server, so a hijacked
// owner session cannot make the server write anywhere). Symbolic links are
// resolved as far as the path exists, so a link cannot lead outside. The
// folder itself need not exist yet (a disk not plugged in, saved with
// force); the run then says not-found.
func allowedFolder(p string, roots []string) (string, error) {
	if !filepath.IsAbs(p) || strings.ContainsRune(p, 0) {
		return "", &FieldError{"path", "bad"}
	}
	clean := filepath.Clean(p)
	real := resolveExisting(clean)
	for _, r := range roots {
		r = filepath.Clean(r)
		if within(clean, r) && within(real, resolveExisting(r)) {
			return clean, nil
		}
	}
	return "", &FieldError{"path", "not-allowed"}
}

// within reports whether p is root or inside it.
func within(p, root string) bool {
	rel, err := filepath.Rel(root, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// resolveExisting follows symbolic links in the longest part of p that
// exists and appends the rest.
func resolveExisting(p string) string {
	rest := ""
	cur := p
	for {
		if r, err := filepath.EvalSymlinks(cur); err == nil {
			return filepath.Join(r, rest)
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return p
		}
		rest = filepath.Join(filepath.Base(cur), rest)
		cur = parent
	}
}

// Folder writes into a folder on the server's own disks.
type Folder struct {
	root          string
	requireMarker bool
	configID      string
}

// NewFolder opens a folder destination. requireMarker is false only while
// the owner tests and saves the setting (the marker is written then).
func NewFolder(path string, roots []string, requireMarker bool, configID string) (*Folder, error) {
	p, err := allowedFolder(path, roots)
	if err != nil {
		return nil, err
	}
	return &Folder{root: p, requireMarker: requireMarker, configID: configID}, nil
}

func (f *Folder) Kind() string { return "folder" }

// ready checks the folder is there (and, after the first save, that it is
// the same folder: the marker).
func (f *Folder) ready() error {
	st, err := os.Stat(f.root)
	if err != nil || !st.IsDir() {
		return errf(CodeNotFound, "the backup folder is not there")
	}
	if f.requireMarker {
		if _, err := os.Stat(filepath.Join(f.root, MarkerName)); err != nil {
			return errf(CodeNotFound, "the backup folder has no %s (is the disk connected?)", MarkerName)
		}
	}
	return nil
}

// WriteMarker writes the marker (on a successful save).
func (f *Folder) WriteMarker() error {
	if err := f.ready(); err != nil {
		return err
	}
	body := []byte(`{"topo":"backups","config":"` + f.configID + `"}` + "\n")
	return osErr(platform.WritePrivate(filepath.Join(f.root, MarkerName), body))
}

// file maps a relative name to a path inside the root.
func (f *Folder) file(name string) (string, error) {
	if !validRel(name) {
		return "", errf(CodeOther, "bad name")
	}
	return filepath.Join(f.root, filepath.FromSlash(name)), nil
}

// validRel accepts "a/b/c" made of plain segments.
func validRel(name string) bool {
	if name == "" || strings.HasPrefix(name, "/") || strings.ContainsAny(name, "\\\x00") {
		return false
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return false
		}
	}
	return true
}

func osErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, syscall.ENOSPC):
		return &Error{Code: CodeFull, Err: err}
	case errors.Is(err, fs.ErrPermission), errors.Is(err, syscall.EROFS):
		return &Error{Code: CodeRefused, Err: err}
	case errors.Is(err, fs.ErrNotExist):
		return &Error{Code: CodeNotFound, Err: err}
	}
	return &Error{Code: CodeOther, Err: err}
}

func (f *Folder) Put(ctx context.Context, name string, body []byte) (string, error) {
	if len(body) > MaxFile {
		return "", errf(CodeTooLarge, "%d bytes", len(body))
	}
	if err := f.ready(); err != nil {
		return "", err
	}
	p, err := f.file(name)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return "", osErr(err)
	}
	return "", osErr(platform.WritePrivate(p, body))
}

func (f *Folder) Get(ctx context.Context, name, ref string) (io.ReadCloser, error) {
	if err := f.ready(); err != nil {
		return nil, err
	}
	p, err := f.file(name)
	if err != nil {
		return nil, err
	}
	r, err := os.Open(p)
	if err != nil {
		return nil, osErr(err)
	}
	return r, nil
}

func (f *Folder) List(ctx context.Context, dir string) ([]Entry, error) {
	if err := f.ready(); err != nil {
		return nil, err
	}
	p := f.root
	if dir != "" {
		var err error
		if p, err = f.file(dir); err != nil {
			return nil, err
		}
	}
	ents, err := os.ReadDir(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, osErr(err)
	}
	var out []Entry
	for _, e := range ents {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, Entry{Name: e.Name(), Size: info.Size(), Mod: info.ModTime()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *Folder) Delete(ctx context.Context, name, ref string) error {
	if err := f.ready(); err != nil {
		return err
	}
	p, err := f.file(name)
	if err != nil {
		return err
	}
	return osErr(os.Remove(p))
}

func (f *Folder) Check(ctx context.Context) error {
	if err := f.ready(); err != nil {
		return err
	}
	return probe(ctx, f)
}

// probe writes a random file at the top, reads it back and deletes it.
func probe(ctx context.Context, d Dest) error {
	b := make([]byte, 16)
	rand.Read(b)
	name := ".topo-check-" + hex.EncodeToString(b[:6]) + ".json"
	body := []byte(`{"topo":"check","n":"` + hex.EncodeToString(b) + `"}`)
	ref, err := d.Put(ctx, name, body)
	if err != nil {
		return err
	}
	rc, err := d.Get(ctx, name, ref)
	if err != nil {
		d.Delete(ctx, name, ref)
		return err
	}
	got, err := io.ReadAll(io.LimitReader(rc, int64(len(body))+1))
	rc.Close()
	if err != nil {
		d.Delete(ctx, name, ref)
		return &Error{Code: CodeUnreachable, Err: err}
	}
	if !bytes.Equal(got, body) {
		d.Delete(ctx, name, ref)
		return errf(CodeMismatch, "the probe read back differs")
	}
	return d.Delete(ctx, name, ref)
}
