// Package store keeps the server's state in SQLite (modernc.org/sqlite,
// pure Go) inside the data folder: topo.db with WAL.
//
// Two handles: W, the only writer (one connection, transactions begin
// IMMEDIATE through the driver's _txlock, so a check-then-insert such as a
// push is serialised), and R, a read-only pool. Everything else in the
// server talks to the database through this package.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// FileName is the database file inside the data folder.
const FileName = "topo.db"

// Store is the open database.
type Store struct {
	W   *sql.DB // the writer: one connection, BEGIN IMMEDIATE
	R   *sql.DB // readers: mode=ro, query_only
	Now func() time.Time
	dir string
}

// Open opens (creating if needed) <dir>/topo.db, applies the migrations and
// returns the store. dir must exist. now may be nil (time.Now).
func Open(dir string, now func() time.Time) (*Store, error) {
	if now == nil {
		now = time.Now
	}
	path := filepath.Join(dir, FileName)
	w, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	w.SetMaxIdleConns(1)
	w.SetConnMaxLifetime(0)
	w.SetConnMaxIdleTime(0)
	if err := w.Ping(); err != nil {
		w.Close()
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	s := &Store{W: w, Now: now, dir: dir}
	if err := s.migrate(context.Background()); err != nil {
		w.Close()
		return nil, err
	}
	r, err := sql.Open("sqlite", dsn(path, false))
	if err != nil {
		w.Close()
		return nil, err
	}
	r.SetMaxOpenConns(4)
	r.SetMaxIdleConns(4)
	if err := r.Ping(); err != nil {
		w.Close()
		r.Close()
		return nil, fmt.Errorf("open %s for reading: %w", path, err)
	}
	s.R = r
	if _, err := s.MetaGet(context.Background(), "created_at"); errors.Is(err, ErrNotFound) {
		if err := s.MetaSet(context.Background(), "created_at", fmt.Sprint(now().UnixMilli())); err != nil {
			s.Close()
			return nil, err
		}
	}
	return s, nil
}

// dsn builds a file: URI for SQLite. The path is escaped (spaces, '#', '?'
// in folder names) and given a leading slash so Windows drive paths work.
func dsn(path string, writer bool) string {
	p := filepath.ToSlash(path)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	u := (&url.URL{Path: p}).EscapedPath()
	q := []string{
		"_pragma=busy_timeout(5000)",
		"_pragma=foreign_keys(1)",
	}
	if writer {
		q = append([]string{"_pragma=journal_mode(WAL)"}, q...)
		q = append(q, "_pragma=synchronous(NORMAL)", "_txlock=immediate")
	} else {
		q = append([]string{"mode=ro"}, q...)
		q = append(q, "_pragma=query_only(1)")
	}
	return "file:" + u + "?" + strings.Join(q, "&")
}

// Dir is the data folder the store lives in.
func (s *Store) Dir() string { return s.dir }

// Close checkpoints the WAL into the main file and closes both handles.
func (s *Store) Close() error {
	var errs []error
	if s.R != nil {
		errs = append(errs, s.R.Close())
	}
	if s.W != nil {
		if _, err := s.W.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
			errs = append(errs, fmt.Errorf("wal checkpoint: %w", err))
		}
		errs = append(errs, s.W.Close())
	}
	return errors.Join(errs...)
}

// Tx runs fn in one write transaction (BEGIN IMMEDIATE). fn's error rolls
// back; a nil error commits.
func (s *Store) Tx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.W.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ErrNotFound is returned for a missing row.
var ErrNotFound = errors.New("not found")

// NewID returns prefix + 16 random bytes in base64url (no padding).
func NewID(prefix string) string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

// Millis is t in unix milliseconds, the unit of every time column.
func Millis(t time.Time) int64 { return t.UnixMilli() }
