package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// Migration 0007 makes site_records again to take the kind 'plan'
// (docs/SCOPE.md D457): the rows are kept, n never goes back (a reader asks
// for n > the last it saw), and the kind's rule still refuses others.
func TestPlanRecordsMigrationKeepsRowsAndTheCounter(t *testing.T) {
	ms, err := loadMigrations(migrationFS, "migrations")
	if err != nil || len(ms) < 7 {
		t.Fatalf("migrations: %v (%d)", err, len(ms))
	}
	w, _ := sql.Open("sqlite", dsn(filepath.Join(t.TempDir(), "x.db"), true))
	w.SetMaxOpenConns(1)
	defer w.Close()
	s := &Store{W: w}
	ctx := context.Background()
	if err := applyMigrations(ctx, s, ms[:6]); err != nil {
		t.Fatal(err)
	}
	// No site row is needed for this: the rule under test is the records' own.
	if _, err := w.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		t.Fatal(err)
	}
	ins := func(kind, id string) (int64, error) {
		var n int64
		err := w.QueryRow(`INSERT INTO site_records(site_id, kind, id, author, epoch, at, received, record) VALUES('s_1', ?, ?, 'u', 1, 1, 1, '{}') RETURNING n`, kind, id).Scan(&n)
		return n, err
	}
	if _, err := ins("plan", "p"); err == nil {
		t.Fatal("before the migration the kind 'plan' was taken")
	}
	for _, id := range []string{"a", "b", "c"} {
		if _, err := ins("act", id); err != nil {
			t.Fatal(err)
		}
	}
	// The newest row goes: the counter stays at 3.
	if _, err := w.Exec(`DELETE FROM site_records WHERE id = 'c'`); err != nil {
		t.Fatal(err)
	}
	if err := applyMigrations(ctx, s, ms[:7]); err != nil {
		t.Fatal(err)
	}
	var rows int
	w.QueryRow(`SELECT count(*) FROM site_records`).Scan(&rows)
	var leftover int
	w.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name = 'site_records_new'`).Scan(&leftover)
	var idx int
	w.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name IN ('site_records_key', 'site_records_since')`).Scan(&idx)
	if rows != 2 || leftover != 0 || idx != 2 {
		t.Fatalf("rows %d, leftover table %d, indexes %d", rows, leftover, idx)
	}
	n, err := ins("plan", "m|u|0")
	if err != nil {
		t.Fatalf("the kind 'plan' after the migration: %v", err)
	}
	if n != 4 {
		t.Fatalf("n went back: the next record got %d, want 4", n)
	}
	if _, err := ins("other", "x"); err == nil {
		t.Fatal("an unknown kind was taken")
	}
	if _, err := ins("act", "a"); err == nil {
		t.Fatal("the same (site, kind, id) twice")
	}
}

// With no record ever written there is no counter to carry: the first one is 1.
func TestPlanRecordsMigrationOnAnEmptyTable(t *testing.T) {
	s := open(t, t.TempDir())
	var seq sql.NullInt64
	s.W.QueryRow(`SELECT seq FROM sqlite_sequence WHERE name = 'site_records'`).Scan(&seq)
	if seq.Valid && seq.Int64 != 0 {
		t.Fatalf("a counter with no record: %d", seq.Int64)
	}
}
