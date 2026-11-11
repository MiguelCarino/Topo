package backup

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestFolderAllowList(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	os.Mkdir(filepath.Join(root, "usb"), 0o700)
	os.Symlink(outside, filepath.Join(root, "escape"))
	roots := []string{root}
	for _, ok := range []string{root, filepath.Join(root, "usb"), filepath.Join(root, "not-yet")} {
		if _, err := allowedFolder(ok, roots); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
	for _, bad := range []string{outside, "relative/path", filepath.Join(root, "..", filepath.Base(outside)), filepath.Join(root, "escape"), filepath.Join(root, "escape", "deeper"), "/"} {
		if _, err := allowedFolder(bad, roots); err == nil {
			t.Errorf("%s allowed", bad)
		}
	}
	if err := Validate(Normalize(Settings{Kind: "folder", Fields: map[string]string{"path": outside}}), roots); err == nil {
		t.Fatal("Validate let it through")
	} else if fe, ok := err.(*FieldError); !ok || fe.Code != "not-allowed" {
		t.Fatalf("%v", err)
	}
}

func TestFolderMarkerAndWrites(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	dir := filepath.Join(root, "bk")
	// Saving never creates the folder (an unplugged disk's mount point).
	f, _ := NewFolder(dir, []string{root}, false, "bc_1")
	if err := f.Check(ctx); CodeOf(err) != CodeNotFound {
		t.Fatalf("missing folder: %v", err)
	}
	os.Mkdir(dir, 0o700)
	if err := f.Check(ctx); err != nil {
		t.Fatal(err)
	}
	// A run requires the marker.
	run, _ := NewFolder(dir, []string{root}, true, "bc_1")
	if _, err := run.Put(ctx, "s_a/topo_x_2026-11-10.json", []byte("{}")); CodeOf(err) != CodeNotFound {
		t.Fatalf("no marker: %v", err)
	}
	if err := f.WriteMarker(); err != nil {
		t.Fatal(err)
	}
	if _, err := run.Put(ctx, "s_a/topo_x_2026-11-10.json", []byte(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, "s_a", "topo_x_2026-11-10.json")
	st, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if st.Mode().Perm() != 0o600 {
			t.Fatalf("file mode %v", st.Mode().Perm())
		}
		if d, _ := os.Stat(filepath.Dir(p)); d.Mode().Perm() != 0o700 {
			t.Fatalf("folder mode %v", d.Mode().Perm())
		}
	}
	// No temp file left behind; List skips dot files.
	ents, _ := os.ReadDir(filepath.Join(dir, "s_a"))
	if len(ents) != 1 {
		t.Fatalf("left %d entries", len(ents))
	}
	ls, err := run.List(ctx, "s_a")
	if err != nil || len(ls) != 1 || ls[0].Size != 7 {
		t.Fatalf("list %v %v", ls, err)
	}
	rc, err := run.Get(ctx, "s_a/topo_x_2026-11-10.json", "")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(rc)
	rc.Close()
	if string(b) != `{"a":1}` {
		t.Fatal(string(b))
	}
	for _, bad := range []string{"../x", "/abs", "a//b", "a/../../b", `a\b`} {
		if _, err := run.Put(ctx, bad, []byte("x")); err == nil {
			t.Errorf("%q written", bad)
		}
	}
	if err := run.Delete(ctx, "s_a/topo_x_2026-11-10.json", ""); err != nil {
		t.Fatal(err)
	}
	if err := run.Delete(ctx, "s_a/topo_x_2026-11-10.json", ""); CodeOf(err) != CodeNotFound {
		t.Fatalf("second delete: %v", err)
	}
	if l, err := run.List(ctx, "s_missing"); err != nil || len(l) != 0 {
		t.Fatal("a missing folder lists empty")
	}
	// A folder the server may not write to.
	if runtime.GOOS != "windows" && os.Getuid() != 0 {
		os.Chmod(dir, 0o500)
		defer os.Chmod(dir, 0o700)
		if err := run.Check(ctx); CodeOf(err) != CodeRefused {
			t.Fatalf("read-only: %v", err)
		}
	}
	if _, err := run.Put(ctx, "big", make([]byte, MaxFile+1)); CodeOf(err) != CodeTooLarge {
		t.Fatal("too large")
	}
}
