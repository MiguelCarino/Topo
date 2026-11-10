package platform

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestEnsureDirTightens(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "a", "b")
	if err := EnsureDir(dir); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "windows" {
		return
	}
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDir(dir); err != nil {
		t.Fatal(err)
	}
	st, _ := os.Stat(dir)
	if st.Mode().Perm() != 0o700 {
		t.Fatalf("mode %v, want 0700", st.Mode().Perm())
	}
}

func TestWritePrivate(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "x")
	if err := WritePrivate(p, []byte("one")); err != nil {
		t.Fatal(err)
	}
	if err := WritePrivate(p, []byte("two")); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "two" {
		t.Fatalf("got %q", b)
	}
	if runtime.GOOS != "windows" {
		st, _ := os.Stat(p)
		if st.Mode().Perm() != 0o600 {
			t.Fatalf("mode %v", st.Mode().Perm())
		}
	}
	ents, _ := os.ReadDir(dir)
	if len(ents) != 1 {
		t.Fatalf("temp files left: %v", ents)
	}
}

func TestServerKeyStable(t *testing.T) {
	dir := t.TempDir()
	a, err := ServerKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := ServerKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != KeySize || !bytes.Equal(a, b) {
		t.Fatal("key not stable")
	}
	os.WriteFile(filepath.Join(dir, "server.key"), []byte("short"), 0o600)
	if _, err := ServerKey(dir); err == nil {
		t.Fatal("a short key must be refused")
	}
}
