package store

import (
	"context"
	"database/sql"
	"errors"
	"io"
)

// MetaGet reads one meta value; ErrNotFound when unset.
func (s *Store) MetaGet(ctx context.Context, key string) (string, error) {
	return MetaGetQ(ctx, s.W, key)
}

// MetaGetQ is MetaGet on q (a transaction).
func MetaGetQ(ctx context.Context, q Q, key string) (string, error) {
	var v string
	err := q.QueryRowContext(ctx, "SELECT value FROM meta WHERE key = ?", key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return v, err
}

// MetaSet writes one meta value.
func (s *Store) MetaSet(ctx context.Context, key, value string) error {
	_, err := s.W.ExecContext(ctx, "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value)
	return err
}

// MetaDelete removes one meta value.
func (s *Store) MetaDelete(ctx context.Context, key string) error {
	_, err := s.W.ExecContext(ctx, "DELETE FROM meta WHERE key = ?", key)
	return err
}

// HasOwner reports whether an enabled server owner exists.
func (s *Store) HasOwner(ctx context.Context) (bool, error) {
	var n int
	err := s.R.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE server_role = 'owner' AND disabled = 0").Scan(&n)
	return n > 0, err
}

// Blobs is where revision bodies live. 5a keeps them in SQLite (the
// rev_bodies table, implemented with the revisions in step 5a stage 3); a
// later step (5b/5c, TOPO_BLOBS=dir:… or s3:…) adds other stores behind the
// same interface. Put runs inside the push transaction so a body never
// exists without its header.
type Blobs interface {
	Put(ctx context.Context, tx *sql.Tx, site string, n int64, iv string, ct []byte) error
	Get(ctx context.Context, site string, n int64) (iv string, ct io.ReadCloser, size int64, err error)
	Drop(ctx context.Context, tx *sql.Tx, site string, ns []int64) error
	DropSite(ctx context.Context, tx *sql.Tx, site string) error
}
