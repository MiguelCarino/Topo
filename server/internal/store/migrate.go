package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

type migration struct {
	version int
	name    string
	sql     string
}

// migrations returns the embedded NNNN_name.sql files in order. The numbers
// must run 1, 2, 3... without gaps.
func migrations() ([]migration, error) {
	return loadMigrations(migrationFS, "migrations")
}

func loadMigrations(fsys fs.FS, dir string) ([]migration, error) {
	ents, err := fs.ReadDir(fsys, dir)
	if err != nil {
		return nil, err
	}
	var out []migration
	for _, e := range ents {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".sql") {
			continue
		}
		num, _, ok := strings.Cut(name, "_")
		v, err := strconv.Atoi(num)
		if !ok || err != nil || v < 1 {
			return nil, fmt.Errorf("migration %s: want NNNN_name.sql", name)
		}
		b, err := fs.ReadFile(fsys, dir+"/"+name)
		if err != nil {
			return nil, err
		}
		out = append(out, migration{version: v, name: name, sql: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	for i, m := range out {
		if m.version != i+1 {
			return nil, fmt.Errorf("migration %s: expected number %d", m.name, i+1)
		}
	}
	return out, nil
}

// SchemaVersion is the newest schema this binary knows.
func SchemaVersion() int {
	ms, err := migrations()
	if err != nil {
		return 0
	}
	return len(ms)
}

// ErrTooNew means the database was written by a newer server.
type ErrTooNew struct{ Have, Know int }

func (e ErrTooNew) Error() string {
	return fmt.Sprintf("this data was written by a newer Topo server (schema %d; this binary knows up to %d). Run the newer server, or restore a backup made before the upgrade", e.Have, e.Know)
}

// migrate applies every migration above PRAGMA user_version, each in its own
// transaction together with the new user_version. Forward only.
func (s *Store) migrate(ctx context.Context) error {
	ms, err := migrations()
	if err != nil {
		return err
	}
	return applyMigrations(ctx, s, ms)
}

func applyMigrations(ctx context.Context, s *Store, ms []migration) error {
	var have int
	if err := s.W.QueryRowContext(ctx, "PRAGMA user_version").Scan(&have); err != nil {
		return err
	}
	if have > len(ms) {
		return ErrTooNew{Have: have, Know: len(ms)}
	}
	for _, m := range ms[have:] {
		err := s.Tx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, m.sql); err != nil {
				return fmt.Errorf("migration %s: %w", m.name, err)
			}
			_, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", m.version))
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}
