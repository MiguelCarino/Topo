// Package platform holds the small file-system helpers the server needs on
// every OS: a private data folder, atomic private writes, and the server key.
package platform

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
)

// EnsureDir creates dir (and parents) with mode 0700. An existing folder that
// others can read is tightened to 0700 (not on Windows, where modes are not
// POSIX).
func EnsureDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		return nil
	}
	st, err := os.Stat(dir)
	if err != nil {
		return err
	}
	if !st.IsDir() {
		return fmt.Errorf("%s is not a folder", dir)
	}
	if st.Mode().Perm()&0o077 != 0 {
		return os.Chmod(dir, 0o700)
	}
	return nil
}

// WritePrivate writes data to path atomically (temp file in the same folder,
// fsync, rename) with mode 0600.
func WritePrivate(path string, data []byte) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	ok := false
	defer func() {
		if !ok {
			f.Close()
			os.Remove(tmp)
		}
	}()
	if err := f.Chmod(0o600); err != nil && runtime.GOOS != "windows" {
		return err
	}
	if _, err := f.Write(data); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	ok = true
	return nil
}

// KeySize is the length of the server key in bytes.
const KeySize = 32

// ServerKey loads <dir>/server.key, creating it with 32 random bytes the
// first time. It keys the HMACs of sign-in codes, so losing it only voids
// codes still outstanding.
func ServerKey(dir string) ([]byte, error) {
	path := filepath.Join(dir, "server.key")
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) != KeySize {
			return nil, fmt.Errorf("%s is %d bytes, want %d (move it away to make a new one; outstanding sign-in codes stop working)", path, len(b), KeySize)
		}
		return b, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	b = make([]byte, KeySize)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	if err := WritePrivate(path, b); err != nil {
		return nil, err
	}
	return b, nil
}
