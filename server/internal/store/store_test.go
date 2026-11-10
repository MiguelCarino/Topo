package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
)

func open(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestOpenMigratesAndReopens(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	ctx := context.Background()
	var v int
	s.W.QueryRow("PRAGMA user_version").Scan(&v)
	if v != SchemaVersion() || v < 1 {
		t.Fatalf("user_version %d, schema %d", v, SchemaVersion())
	}
	var mode string
	s.W.QueryRow("PRAGMA journal_mode").Scan(&mode)
	if mode != "wal" {
		t.Fatalf("journal_mode %s", mode)
	}
	var fk int
	s.R.QueryRow("PRAGMA foreign_keys").Scan(&fk)
	if fk != 1 {
		t.Fatal("foreign keys off on the reader")
	}
	for _, table := range []string{"meta", "users", "devices", "link_requests", "sessions", "challenges", "sites", "site_rosters", "members", "site_wraps", "invites", "revisions", "rev_bodies", "outbox", "mail_rate", "verify_fail", "last_sent"} {
		var n int
		if err := s.R.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&n); err != nil || n != 1 {
			t.Errorf("table %s missing", table)
		}
	}
	created, err := s.MetaGet(ctx, "created_at")
	if err != nil || created == "" {
		t.Fatalf("created_at: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	// The WAL is checkpointed away on close.
	if st, err := os.Stat(filepath.Join(dir, FileName+"-wal")); err == nil && st.Size() > 0 {
		t.Fatalf("wal left with %d bytes", st.Size())
	}
	s = open(t, dir)
	defer s.Close()
	again, _ := s.MetaGet(ctx, "created_at")
	if again != created {
		t.Fatal("created_at changed on reopen")
	}
}

func TestReaderIsReadOnly(t *testing.T) {
	s := open(t, t.TempDir())
	defer s.Close()
	if _, err := s.R.Exec("INSERT INTO meta(key,value) VALUES('x','y')"); err == nil {
		t.Fatal("the reader pool accepted a write")
	}
}

func TestNewerSchemaRefused(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	s.W.Exec("PRAGMA user_version = 999")
	s.Close()
	_, err := Open(dir, nil)
	var tooNew ErrTooNew
	if !errors.As(err, &tooNew) || !strings.Contains(err.Error(), "newer Topo server") {
		t.Fatalf("want ErrTooNew, got %v", err)
	}
}

func TestMigrationsStepByStep(t *testing.T) {
	fsys := fstest.MapFS{
		"m/0001_a.sql": {Data: []byte("CREATE TABLE a(x);")},
		"m/0002_b.sql": {Data: []byte("CREATE TABLE b(x); INSERT INTO b VALUES (1);")},
	}
	ms, err := loadMigrations(fsys, "m")
	if err != nil || len(ms) != 2 {
		t.Fatal(err)
	}
	dir := t.TempDir()
	w, _ := sql.Open("sqlite", dsn(filepath.Join(dir, "x.db"), true))
	w.SetMaxOpenConns(1)
	s := &Store{W: w}
	defer w.Close()
	if err := applyMigrations(context.Background(), s, ms[:1]); err != nil {
		t.Fatal(err)
	}
	if err := applyMigrations(context.Background(), s, ms); err != nil {
		t.Fatal(err)
	}
	if err := applyMigrations(context.Background(), s, ms); err != nil {
		t.Fatal("idempotent:", err)
	}
	var n int
	w.QueryRow("SELECT count(*) FROM b").Scan(&n)
	if n != 1 {
		t.Fatalf("migration 2 ran %d times", n)
	}
	// A failing migration leaves user_version where it was.
	bad := append(ms, migration{version: 3, name: "0003_bad.sql", sql: "CREATE TABLE c(x); NOT SQL;"})
	if err := applyMigrations(context.Background(), s, bad); err == nil {
		t.Fatal("bad migration accepted")
	}
	var v int
	w.QueryRow("PRAGMA user_version").Scan(&v)
	w.QueryRow("SELECT count(*) FROM sqlite_master WHERE name='c'").Scan(&n)
	if v != 2 || n != 0 {
		t.Fatalf("partial migration: version %d, table c %d", v, n)
	}
	for _, broken := range []fstest.MapFS{
		{"m/0002_x.sql": {Data: []byte("")}},
		{"m/x.sql": {Data: []byte("")}},
	} {
		if _, err := loadMigrations(broken, "m"); err == nil {
			t.Error("bad numbering accepted")
		}
	}
}

// Writes that check and then insert are serialised: 20 goroutines each read
// a counter and write it back +1; with BEGIN IMMEDIATE none is lost.
func TestImmediateTransactions(t *testing.T) {
	for round := 0; round < 3; round++ {
		s := open(t, t.TempDir())
		ctx := context.Background()
		s.MetaSet(ctx, "n", "0")
		var wg sync.WaitGroup
		for i := 0; i < 20; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				err := s.Tx(ctx, func(tx *sql.Tx) error {
					var n int
					if err := tx.QueryRow("SELECT CAST(value AS INTEGER) FROM meta WHERE key='n'").Scan(&n); err != nil {
						return err
					}
					_, err := tx.Exec("UPDATE meta SET value=? WHERE key='n'", n+1)
					return err
				})
				if err != nil {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		v, _ := s.MetaGet(ctx, "n")
		if v != "20" {
			t.Fatalf("round %d: counter %s", round, v)
		}
		s.Close()
	}
}

func TestDSNEscapes(t *testing.T) {
	d := dsn("/tmp/a b/#x?/topo.db", true)
	if !strings.HasPrefix(d, "file:/tmp/a%20b/%23x%3F/topo.db?") || !strings.Contains(d, "_txlock=immediate") {
		t.Fatal(d)
	}
	if r := dsn("/x/topo.db", false); !strings.Contains(r, "mode=ro") || strings.Contains(r, "journal_mode") {
		t.Fatal(r)
	}
	// A folder with a space actually opens.
	dir := filepath.Join(t.TempDir(), "with space #1")
	os.Mkdir(dir, 0o700)
	s := open(t, dir)
	s.Close()
	if _, err := os.Stat(filepath.Join(dir, FileName)); err != nil {
		t.Fatal(err)
	}
}

func TestMetaAndOwner(t *testing.T) {
	s := open(t, t.TempDir())
	defer s.Close()
	ctx := context.Background()
	if _, err := s.MetaGet(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	s.MetaSet(ctx, "k", "1")
	s.MetaSet(ctx, "k", "2")
	if v, _ := s.MetaGet(ctx, "k"); v != "2" {
		t.Fatal(v)
	}
	s.MetaDelete(ctx, "k")
	if _, err := s.MetaGet(ctx, "k"); !errors.Is(err, ErrNotFound) {
		t.Fatal("not deleted")
	}
	if ok, err := s.HasOwner(ctx); ok || err != nil {
		t.Fatal(ok, err)
	}
	s.W.Exec("INSERT INTO users(id,email,email_norm,server_role,created) VALUES('u_1','A@x.com','a@x.com','owner',1)")
	if ok, _ := s.HasOwner(ctx); !ok {
		t.Fatal("owner not seen")
	}
	if id := NewID("u_"); len(id) != 2+22 || !strings.HasPrefix(id, "u_") {
		t.Fatal(id)
	}
}

func TestRevBodiesCascade(t *testing.T) {
	s := open(t, t.TempDir())
	defer s.Close()
	ex := func(q string) {
		t.Helper()
		if _, err := s.W.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	ex("INSERT INTO users(id,email,email_norm,created) VALUES('u_1','a@x','a@x',1)")
	ex("INSERT INTO sites(id,created,created_by,head_h,updated) VALUES('s_1',1,'u_1','h0',1)")
	ex("INSERT INTO revisions(site_id,n,base,prev,epoch,rseq,author,device,at,received,size,ct_hash,sig,h) VALUES('s_1',1,0,'h0',1,1,'u_1','d_1',1,1,3,'c','s','h1')")
	ex("INSERT INTO rev_bodies(site_id,n,iv,ct) VALUES('s_1',1,'iv',x'010203')")
	if _, err := s.W.Exec("INSERT INTO rev_bodies(site_id,n,iv,ct) VALUES('s_1',2,'iv',x'01')"); err == nil {
		t.Fatal("a body without its header was accepted")
	}
	ex("DELETE FROM sites WHERE id='s_1'")
	var n int
	s.W.QueryRow("SELECT count(*) FROM rev_bodies").Scan(&n)
	if n != 0 {
		t.Fatal("bodies outlived their site")
	}
}
