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
	for _, table := range []string{"meta", "users", "devices", "link_requests", "sessions", "challenges", "sites", "site_rosters", "members", "site_wraps", "invites", "revisions", "rev_bodies", "outbox", "mail_rate", "verify_fail", "last_sent", "mail_files"} {
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

// 0002 (D97) applies on a database left at 0001 with mail queued, and the
// rows already there keep working (file_id NULL).
func TestMailFilesMigrationOnAnOldDatabase(t *testing.T) {
	ms, err := migrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) < 2 || ms[1].name != "0002_mail_files.sql" {
		t.Fatalf("migrations: %v", ms)
	}
	dir := t.TempDir()
	w, _ := sql.Open("sqlite", dsn(filepath.Join(dir, "x.db"), true))
	w.SetMaxOpenConns(1)
	defer w.Close()
	s := &Store{W: w, R: w}
	ctx := context.Background()
	if err := applyMigrations(ctx, s, ms[:1]); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Exec("INSERT INTO outbox(id, kind, to_email, lang, data, created, send_after) VALUES('o_old','report','a@x.test','en','{}',1,1)"); err != nil {
		t.Fatal(err)
	}
	if err := applyMigrations(ctx, s, ms); err != nil {
		t.Fatal(err)
	}
	rows, err := DueMail(ctx, w, 10, 10)
	if err != nil || len(rows) != 1 || rows[0].FileID != "" {
		t.Fatalf("old row after 0002: %v %+v", err, rows)
	}
	// A file named by two waiting rows stays until both are done.
	if err := InsertMailFile(ctx, w, &MailFile{ID: "mf_1", SiteID: "s_1", Name: "r.pdf", Type: "application/pdf", Data: []byte("%PDF-1"), Created: 1}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"o_a", "o_b"} {
		if err := InsertMail(ctx, w, &Mail{ID: id, Kind: "report", To: "a@x.test", SiteID: "s_1", Lang: "en", Data: "{}", Created: 1, SendAfter: 1, FileID: "mf_1"}); err != nil {
			t.Fatal(err)
		}
	}
	MailSent(ctx, w, "o_a", 2)
	if gone, _ := DropMailFileIfUnused(ctx, w, "mf_1"); gone {
		t.Fatal("dropped while o_b still waits")
	}
	MailRetry(ctx, w, "o_b", 0, "given up")
	if gone, _ := DropMailFileIfUnused(ctx, w, "mf_1"); !gone {
		t.Fatal("kept after every row was done")
	}
	if n, _ := CountMailFiles(ctx, w); n != 0 {
		t.Fatalf("files left: %d", n)
	}
}

// A deleted site takes its files; the housekeeping sweeps a file no waiting
// row names.
func TestMailFilesCleanup(t *testing.T) {
	s := open(t, t.TempDir())
	defer s.Close()
	ctx := context.Background()
	for _, f := range []MailFile{{ID: "mf_site", SiteID: "s_gone"}, {ID: "mf_orphan", SiteID: "s_other"}, {ID: "mf_wait", SiteID: "s_other"}} {
		f.Name, f.Type, f.Data, f.Created = "r.pdf", "application/pdf", []byte("%PDF-"), 1
		if err := InsertMailFile(ctx, s.W, &f); err != nil {
			t.Fatal(err)
		}
	}
	if err := InsertMail(ctx, s.W, &Mail{ID: "o_w", Kind: "report", To: "a@x.test", SiteID: "s_other", Lang: "en", Data: "{}", Created: 1, SendAfter: 1, FileID: "mf_wait"}); err != nil {
		t.Fatal(err)
	}
	if err := InsertMail(ctx, s.W, &Mail{ID: "o_s", Kind: "report", To: "a@x.test", SiteID: "s_gone", Lang: "en", Data: "{}", Created: 1, SendAfter: 1, FileID: "mf_site"}); err != nil {
		t.Fatal(err)
	}
	if err := DeleteSite(ctx, s.W, "s_gone"); err != nil {
		t.Fatal(err)
	}
	if _, err := GetMailFile(ctx, s.R, "mf_site"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("site file kept: %v", err)
	}
	if _, err := s.Housekeep(ctx, 10, HousekeepLimits{SessionIdleMs: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := GetMailFile(ctx, s.R, "mf_orphan"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("orphan kept: %v", err)
	}
	if f, err := GetMailFile(ctx, s.R, "mf_wait"); err != nil || string(f.Data) != "%PDF-" {
		t.Fatalf("waiting file swept: %v", err)
	}
}

// A v0.0.1 database (migrations 1-3) with a site whose history holds a
// provider's revision opens under 0004: the history is untouched, the
// visit copies table is there, and a waiting copy holds its base from
// pruning (D154).
func TestVisitCopiesMigrationOnAV001Database(t *testing.T) {
	ms, err := migrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) < 4 || ms[3].name != "0004_visit_copies.sql" {
		t.Fatalf("migrations: %v", ms)
	}
	dir := t.TempDir()
	w, _ := sql.Open("sqlite", dsn(filepath.Join(dir, "x.db"), true))
	w.SetMaxOpenConns(1)
	defer w.Close()
	s := &Store{W: w, R: w}
	ctx := context.Background()
	if err := applyMigrations(ctx, s, ms[:3]); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		"INSERT INTO users(id, email, email_norm, lang, server_role, created) VALUES('u_o','o@x.test','o@x.test','en','owner',1),('u_p','p@x.test','p@x.test','en','member',1)",
		"INSERT INTO sites(id, created, created_by, epoch, head_n, head_h, roster_seq, updated) VALUES('s_1',1,'u_o',1,2,'h2',2,1)",
		"INSERT INTO members(site_id, user_id, role, status, added) VALUES('s_1','u_o','owner','granted',1),('s_1','u_p','provider','granted',1)",
		"INSERT INTO revisions(site_id, n, base, prev, epoch, rseq, author, device, at, received, size, ct_hash, sig, h) VALUES('s_1',1,0,'g',1,2,'u_o','d_o',1,1,3,'c1','s1','h1'),('s_1',2,1,'h1',1,2,'u_p','d_p',2,2,3,'c2','s2','h2')",
		"INSERT INTO rev_bodies(site_id, n, iv, ct) VALUES('s_1',1,'iv',x'010203'),('s_1',2,'iv',x'040506')",
	} {
		if _, err := w.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	if err := applyMigrations(ctx, s, ms); err != nil {
		t.Fatal(err)
	}
	r, err := RevByN(ctx, w, "s_1", 2)
	if err != nil || r.Author != "u_p" || r.H != "h2" || r.Pruned {
		t.Fatalf("the provider's revision after 0004: %v %+v", err, r)
	}
	if err := (&Store{W: w, R: w}).Tx(ctx, func(tx *sql.Tx) error {
		_, err := PutVisit(ctx, tx, &VisitCopy{ID: "v_1", SiteID: "s_1", Author: "u_p", Device: "d_p", Slot: "slot_one_x", BaseN: 1, Epoch: 1, RSeq: 2, At: 3, Received: 3, Size: 1, CTHash: "c", Sig: "s", IV: "iv", CT: []byte{1}})
		if err != nil {
			return err
		}
		_, err = Prune(ctx, tx, DBBlobs{R: w}, "s_1", 2, 1, 0, 0)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if r, _ := RevByN(ctx, w, "s_1", 1); r.Pruned {
		t.Fatal("a waiting copy's base was pruned")
	}
}

// A v0.0.1 database (migrations 1-3, then 0004) takes 0005: the members
// keep their roles and statuses, 'monitor' is now a role the CHECK allows,
// sites keep 360 days of statistics, and the monitor tables are there
// (docs/SCOPE.md step 7h, D146).
func TestMonitorRoleMigrationOnAV001Database(t *testing.T) {
	ms, err := migrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) < 5 || ms[4].name != "0005_monitors.sql" {
		t.Fatalf("migrations: %v", ms)
	}
	dir := t.TempDir()
	w, _ := sql.Open("sqlite", dsn(filepath.Join(dir, "x.db"), true))
	w.SetMaxOpenConns(1)
	defer w.Close()
	s := &Store{W: w, R: w}
	ctx := context.Background()
	if err := applyMigrations(ctx, s, ms[:3]); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		"INSERT INTO users(id, email, email_norm, lang, server_role, created) VALUES('u_o','o@x.test','o@x.test','en','owner',1),('u_p','p@x.test','p@x.test','en','member',1),('u_v','v@x.test','v@x.test','en','member',1)",
		"INSERT INTO sites(id, created, created_by, epoch, head_n, head_h, roster_seq, updated) VALUES('s_1',1,'u_o',1,0,'g',1,1)",
		"INSERT INTO members(site_id, user_id, role, status, added, granted, muted) VALUES('s_1','u_o','owner','granted',1,1,0),('s_1','u_p','provider','granted',2,2,1),('s_1','u_v','viewer','waiting',3,NULL,0)",
	} {
		if _, err := w.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	if _, err := w.Exec("INSERT INTO members(site_id, user_id, role, status, added) VALUES('s_1','u_o','monitor','granted',1)"); err == nil {
		t.Fatal("v0.0.1 accepted the role monitor")
	}
	if err := applyMigrations(ctx, s, ms); err != nil {
		t.Fatal(err)
	}
	got, err := SiteMembers(ctx, w, "s_1")
	if err != nil || len(got) != 3 {
		t.Fatalf("members after 0005: %v %+v", err, got)
	}
	want := map[string][3]any{"u_o": {"owner", "granted", false}, "u_p": {"provider", "granted", true}, "u_v": {"viewer", "waiting", false}}
	for _, m := range got {
		x := want[m.UserID]
		if m.Role != x[0] || m.Status != x[1] || m.Muted != x[2] {
			t.Fatalf("member changed by 0005: %+v", m)
		}
	}
	m := &Monitor{ID: "m_0123456789abcdef012345", SiteID: "s_1", Name: "PC", ByUser: "u_o", Created: 5, IntervalMs: 60000, EncPub: "e", SigPub: "s"}
	if err := InsertMonitor(ctx, w, m, []byte("tokenhash")); err != nil {
		t.Fatal(err)
	}
	if mm, err := monitorMemberOf(ctx, w, m.ID); err != nil || mm.Role != "monitor" || mm.Status != "waiting" {
		t.Fatalf("monitor member: %v %+v", err, mm)
	}
	if _, err := w.Exec("INSERT INTO members(site_id, user_id, role, status, added) VALUES('s_1','u_v','nobody','granted',1)"); err == nil {
		t.Fatal("the CHECK lets any role in")
	}
	if d, err := SiteStatsDays(ctx, w, "s_1"); err != nil || d != 360 {
		t.Fatalf("stats days: %v %d", err, d)
	}
	if got, err := MonitorByToken(ctx, w, []byte("tokenhash")); err != nil || got.Name != "PC" {
		t.Fatalf("by token: %v %+v", err, got)
	}
	var fk int
	w.QueryRow("SELECT count(*) FROM pragma_foreign_key_check").Scan(&fk)
	if fk != 0 {
		t.Fatalf("%d foreign key problems after 0005", fk)
	}
}

func monitorMemberOf(ctx context.Context, q Q, id string) (*Member, error) { return MemberOf(ctx, q, "s_1", id) }
