package backup_test

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
	_ "time/tzdata"

	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/backup/backuptest"
	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// world is a store with users, sites and signed revisions, an engine on a
// fake clock writing to an in-memory destination.
type world struct {
	t     *testing.T
	ctx   context.Context
	st    *store.Store
	clk   *backuptest.Clock
	mem   *backuptest.Mem
	e     *backup.Engine
	opens int
	wakes int
	mu    sync.Mutex
	users map[string]*ecdsa.PrivateKey
	owner string
	quiet bool // push without touching the engine (the daily run alone)
}

var t0 = time.Date(2026, 11, 10, 10, 0, 0, 0, time.UTC)

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{t: t, ctx: context.Background(), clk: backuptest.NewClock(t0), mem: backuptest.NewMem(), users: map[string]*ecdsa.PrivateKey{}}
	st, err := store.Open(t.TempDir(), w.clk.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	w.st = st
	w.owner = w.addUser("owner@example.test", "owner", true)
	w.e = backup.New(backup.Options{Store: st, Key: make([]byte, 32), Origin: "https://topo.example", Debounce: 2 * time.Minute,
		Tick: time.Second, Now: w.clk.Now, Loc: time.UTC, Log: slog.New(slog.NewTextHandler(tWriter{t}, nil)), Wake: func() { w.mu.Lock(); w.wakes++; w.mu.Unlock() },
		Open: func(s backup.Settings, id string, marker bool) (backup.Dest, error) {
			w.mu.Lock()
			w.opens++
			w.mu.Unlock()
			return w.mem, nil
		}})
	w.enable()
	return w
}

func (w *world) enable() {
	w.t.Helper()
	if err := store.SetBackupConfig(w.ctx, w.st.W, &store.BackupConfig{Enabled: true, Kind: "folder", Fields: `{"path":"/x"}`, ConfigID: "bc_1", DailyAt: "02:30", Updated: 1}); err != nil {
		w.t.Fatal(err)
	}
	// As a save does: the daily run of today is done, the check clock starts.
	st, _ := store.GetBackupState(w.ctx, w.st.R)
	st.LastDailyDate = w.clk.Now().Format("2006-01-02")
	st.LastCheckAt = w.clk.Now().UnixMilli()
	store.SetBackupState(w.ctx, w.st.W, st)
}

func (w *world) addUser(email, role string, escrow bool) string {
	w.t.Helper()
	id := "u_" + tcrypto.B64.EncodeToString(randB(16))
	if err := store.CreateUser(w.ctx, w.st.W, &store.User{ID: id, Email: email, EmailNorm: email, Lang: "en", ServerRole: role, Created: 1}); err != nil {
		w.t.Fatal(err)
	}
	sig, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	enc, _ := ecdh.P256().GenerateKey(rand.Reader)
	var esc *string
	if escrow {
		e := `{"v":1,"kdf":"HKDF-SHA256","salt":"AAAAAAAAAAAAAAAAAAAAAA","iv":"AAAAAAAAAAAAAAAA","ct":"secret-escrow"}`
		esc = &e
	}
	if err := store.SetUserKeys(w.ctx, w.st.W, id, tcrypto.B64.EncodeToString(enc.PublicKey().Bytes()), tcrypto.RawPublic(&sig.PublicKey), 1, esc); err != nil {
		w.t.Fatal(err)
	}
	w.users[id] = sig
	return id
}

type tWriter struct{ t *testing.T }

func (w tWriter) Write(b []byte) (int, error) {
	w.t.Log(strings.TrimSpace(string(b)))
	return len(b), nil
}

func randB(n int) []byte { b := make([]byte, n); rand.Read(b); return b }

func (w *world) pub(u string) (string, string) {
	var enc, sig string
	w.st.R.QueryRow("SELECT enc_pub, sig_pub FROM users WHERE id = ?", u).Scan(&enc, &sig)
	return enc, sig
}

// addSite makes a site owned by w.owner (and members), roster 1, epoch 1.
func (w *world) addSite(members ...string) string {
	w.t.Helper()
	site := "s_" + tcrypto.B64.EncodeToString(randB(16))
	now := w.clk.Now().UnixMilli()
	err := w.st.Tx(w.ctx, func(tx *sql.Tx) error {
		if err := store.InsertSite(w.ctx, tx, &store.Site{ID: site, Created: now, CreatedBy: w.owner, Epoch: 1, HeadH: tcrypto.Genesis(site), RosterSeq: 1, Updated: now}); err != nil {
			return err
		}
		all := append([]string{w.owner}, members...)
		r := &tcrypto.Roster{V: 1, Site: site, Seq: 1, Epoch: 1, By: w.owner, At: now}
		for i, u := range all {
			role := "owner"
			if i > 0 {
				role = "provider"
			}
			enc, sig := w.pub(u)
			r.Members = append(r.Members, tcrypto.RosterMember{U: u, Email: strings.ToLower("m" + u[2:6] + "@example.test"), Role: role, Enc: tcrypto.FingerprintB64(enc), Sig: tcrypto.FingerprintB64(sig)})
			if err := store.InsertMember(w.ctx, tx, site, u, role, "granted", now); err != nil {
				return err
			}
			if err := store.InsertWrap(w.ctx, tx, site, 1, u, `{"v":1,"for":"`+u+`"}`, w.owner, now); err != nil {
				return err
			}
		}
		r.Sig = tcrypto.B64.EncodeToString(tcrypto.SignP1363(w.users[w.owner], []byte(r.Canonical())))
		raw, _ := json.Marshal(r)
		return store.InsertRoster(w.ctx, tx, site, 1, 1, w.owner, string(raw), now)
	})
	if err != nil {
		w.t.Fatal(err)
	}
	return site
}

// push stores a signed revision on top of the head, by author.
func (w *world) push(site, author string) {
	w.t.Helper()
	err := w.st.Tx(w.ctx, func(tx *sql.Tx) error {
		s, err := store.SiteByID(w.ctx, tx, site)
		if err != nil {
			return err
		}
		iv, ct := randB(12), append([]byte("Router 10.0.0.1 secret-device"), randB(32)...) // stands in for ciphertext
		hdr := &tcrypto.RevHeader{Site: site, N: s.HeadN + 1, Base: s.HeadN, Prev: s.HeadH, Epoch: s.Epoch, RSeq: s.RosterSeq, Author: author, Dev: "d_x", At: w.clk.Now().UnixMilli(), CTHash: tcrypto.CTHash(iv, ct)}
		sig := tcrypto.B64.EncodeToString(tcrypto.SignP1363(w.users[author], []byte(hdr.SignedString())))
		rev := &store.Rev{SiteID: site, N: hdr.N, Base: hdr.Base, Prev: hdr.Prev, Epoch: hdr.Epoch, RSeq: hdr.RSeq, Author: author, Device: "d_x", At: hdr.At,
			Received: hdr.At, Size: int64(len(ct)), CTHash: hdr.CTHash, Sig: sig, H: tcrypto.ChainHash(hdr.SignedString(), sig)}
		if err := store.InsertRev(w.ctx, tx, rev); err != nil {
			return err
		}
		return store.DBBlobs{}.Put(w.ctx, tx, site, rev.N, tcrypto.B64.EncodeToString(iv), ct)
	})
	if err != nil {
		w.t.Fatal(err)
	}
	if !w.quiet {
		w.e.Touch(site, "push")
	}
}

func (w *world) tick() {
	w.t.Helper()
	if err := w.e.Tick(w.ctx); err != nil {
		w.t.Fatal(err)
	}
}

func (w *world) rows(site string) []store.Backup {
	w.t.Helper()
	rs, err := store.SiteBackups(w.ctx, w.st.R, site, "enc", "")
	if err != nil {
		w.t.Fatal(err)
	}
	return rs
}

func (w *world) state() *store.BackupState {
	st, _ := store.GetBackupState(w.ctx, w.st.R)
	return st
}

func (w *world) mails(kind string) int {
	var n int
	w.st.R.QueryRow("SELECT count(*) FROM outbox WHERE kind = ?", kind).Scan(&n)
	return n
}

func TestEngineDebounceAndMaxWait(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	w.tick() // start: nothing has a revision yet
	w.push(site, w.owner)
	w.clk.Add(time.Minute)
	w.tick()
	if len(w.rows(site)) != 1 {
		// The first tick saw the site behind at start? No: it had no head then.
		t.Logf("rows after a minute: %d", len(w.rows(site)))
	}
	// Quiet for 2 minutes: written.
	w.clk.Add(90 * time.Second)
	w.tick()
	rs := w.rows(site)
	if len(rs) != 1 || rs[0].RevN != 1 {
		t.Fatalf("after the quiet spell: %+v", rs)
	}
	if !strings.HasPrefix(rs[0].Name, "topo_network-") || !strings.HasSuffix(rs[0].Name, "_2026-11-10.json") {
		t.Fatalf("name %q", rs[0].Name)
	}
	// A long session: an edit every minute; still written by 15 minutes.
	for i := 0; i < 16; i++ {
		w.clk.Add(time.Minute)
		w.push(site, w.owner)
		w.tick()
	}
	rs = w.rows(site)
	if len(rs) != 2 {
		t.Fatalf("a 16-minute session wrote %d (want one more by the 15-minute cap)", len(rs))
	}
	if !strings.Contains(rs[0].Name, "_2026-11-10_") {
		t.Fatalf("second file of the day has no time: %q", rs[0].Name)
	}
}

func TestEngineVisitIsQuicker(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	w.tick()
	w.push(site, w.owner)
	w.e.Touch(site, "visit")
	w.clk.Add(31 * time.Second)
	w.tick()
	if len(w.rows(site)) != 1 {
		t.Fatal("a visit is written after 30 s")
	}
}

func TestEngineStartAndDailySkipUnchanged(t *testing.T) {
	w := newWorld(t)
	a, b := w.addSite(), w.addSite()
	w.push(a, w.owner)
	w.push(b, w.owner)
	// A fresh engine (a restart) writes every network that is behind at once.
	w.e = backup.New(backup.Options{Store: w.st, Key: make([]byte, 32), Origin: "x", Debounce: time.Hour, Now: w.clk.Now, Loc: time.UTC,
		Open: func(backup.Settings, string, bool) (backup.Dest, error) { return w.mem, nil }})
	w.tick()
	if len(w.rows(a)) != 1 || len(w.rows(b)) != 1 {
		t.Fatalf("start: %d %d", len(w.rows(a)), len(w.rows(b)))
	}
	puts := w.mem.Puts
	// Next day 02:30: only the network that changed.
	w.quiet = true
	w.push(a, w.owner)
	w.clk.Set(time.Date(2026, 11, 11, 2, 29, 0, 0, time.UTC))
	w.tick()
	if w.mem.Puts != puts {
		t.Fatal("written before the daily time (debounce is an hour)")
	}
	w.clk.Set(time.Date(2026, 11, 11, 2, 30, 0, 0, time.UTC))
	w.tick()
	if len(w.rows(a)) != 2 || len(w.rows(b)) != 1 {
		t.Fatalf("daily: a %d b %d", len(w.rows(a)), len(w.rows(b)))
	}
	if w.state().LastDailyDate != "2026-11-11" {
		t.Fatalf("daily date %q", w.state().LastDailyDate)
	}
	// Ticks later the same day do not run it again.
	w.push(b, w.owner)
	w.clk.Add(10 * time.Minute)
	w.tick()
	if len(w.rows(b)) != 1 {
		t.Fatal("the daily run ran twice in a day")
	}
}

func TestEngineDailyOnceOnDSTDays(t *testing.T) {
	for _, tc := range []struct {
		zone string
		day  time.Time // a DST change day (local midnight)
	}{
		{"Europe/Madrid", time.Date(2026, 3, 29, 0, 0, 0, 0, time.UTC)},
		{"Europe/Madrid", time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)},
		{"America/New_York", time.Date(2026, 3, 8, 0, 0, 0, 0, time.UTC)},
		{"America/New_York", time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)},
	} {
		loc, err := time.LoadLocation(tc.zone)
		if err != nil {
			t.Fatal(err)
		}
		w := newWorld(t)
		w.quiet = true
		site := w.addSite()
		start := time.Date(tc.day.Year(), tc.day.Month(), tc.day.Day(), 0, 0, 0, 0, loc)
		w.clk.Set(start.Add(-time.Hour))
		w.e = backup.New(backup.Options{Store: w.st, Key: make([]byte, 32), Origin: "x", Debounce: 100 * time.Hour, Now: w.clk.Now, Loc: loc,
			Open: func(backup.Settings, string, bool) (backup.Dest, error) { return w.mem, nil }})
		w.tick() // start
		runs := 0
		for i := 0; i < 6*12; i++ { // every 5 minutes for 6 hours
			w.push(site, w.owner)
			before := len(w.rows(site))
			w.clk.Add(5 * time.Minute)
			w.tick()
			if len(w.rows(site)) > before {
				runs++
			}
		}
		if runs != 1 {
			t.Errorf("%s %s: the daily run ran %d times", tc.zone, tc.day.Format("2006-01-02"), runs)
		}
	}
}

func TestEngineFailureMailsOnceAndRecovers(t *testing.T) {
	w := newWorld(t)
	w.addUser("owner2@example.test", "owner", false)
	site := w.addSite()
	w.tick()
	w.push(site, w.owner)
	w.mem.FailPut = backup.CodeUnreachable
	w.clk.Add(3 * time.Minute)
	w.tick()
	st := w.state()
	if st.LastErr != backup.CodeUnreachable || st.BackoffUntil == 0 {
		t.Fatalf("state %+v", st)
	}
	if n := w.mails("backup-failed"); n != 2 {
		t.Fatalf("mails %d, want one per server owner", n)
	}
	var data string
	w.st.R.QueryRow("SELECT data FROM outbox WHERE kind = 'backup-failed' LIMIT 1").Scan(&data)
	if data != `{"why":"unreachable"}` || w.wakes == 0 {
		t.Fatalf("mail data %s wakes %d", data, w.wakes)
	}
	// Backing off: the next ticks do not even try.
	puts := w.mem.Puts
	w.clk.Add(time.Minute)
	w.tick()
	// Past the backoff, still failing: no second mail the same day.
	w.clk.Add(10 * time.Minute)
	w.tick()
	if w.mails("backup-failed") != 2 {
		t.Fatal("a second mail the same day")
	}
	_ = puts
	// The next day it fails again: one more mail each.
	w.clk.Add(24 * time.Hour)
	w.mem.FailPut = backup.CodeFull
	w.e.RequestRun()
	w.tick()
	if w.mails("backup-failed") != 4 {
		t.Fatalf("next day mails %d", w.mails("backup-failed"))
	}
	// It works again: the status clears, no mail.
	w.mem.FailPut = ""
	w.e.RequestRun()
	w.tick()
	st = w.state()
	if st.LastErr != "" || st.LastOK == 0 || st.BackoffUntil != 0 || len(w.rows(site)) != 1 || w.mails("backup-failed") != 4 {
		t.Fatalf("recovered: %+v rows %d", st, len(w.rows(site)))
	}
}

func TestEngineSecretsUnreadable(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	cfg, _ := store.GetBackupConfig(w.ctx, w.st.R)
	cfg.SecretCt = "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" // not under this key
	store.SetBackupConfig(w.ctx, w.st.W, cfg)
	w.push(site, w.owner)
	w.e.RequestRun()
	w.tick()
	if st := w.state(); st.LastErr != backup.CodeSecrets || w.mails("backup-failed") != 1 {
		t.Fatalf("secrets: %+v", st)
	}
}

func TestEngineOneRunAtATime(t *testing.T) {
	w := newWorld(t)
	for i := 0; i < 3; i++ {
		w.push(w.addSite(), w.owner)
	}
	w.mem.Hold = make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); w.e.RequestRun(); w.e.Tick(w.ctx) }()
	}
	go func() {
		for i := 0; i < 3; i++ {
			w.mem.Hold <- struct{}{}
		}
		close(w.mem.Hold)
	}()
	wg.Wait()
	if w.mem.MaxActive != 1 || w.mem.Puts != 3 {
		t.Fatalf("max at once %d, puts %d", w.mem.MaxActive, w.mem.Puts)
	}
}

func TestEngineLease(t *testing.T) {
	w := newWorld(t)
	other := backup.New(backup.Options{Store: w.st, Now: w.clk.Now})
	if ok, _ := other.Lease(w.ctx); !ok {
		t.Fatal("first lease")
	}
	if err := w.e.RunNow(w.ctx); err != backup.ErrLeased {
		t.Fatalf("run while leased: %v", err)
	}
	other.Release(w.ctx)
	if err := w.e.RunNow(w.ctx); err != nil {
		t.Fatal(err)
	}
	// An engine that died: its lease lapses after five minutes.
	if ok, _ := other.Lease(w.ctx); ok {
		t.Fatal("w.e holds it now")
	}
	w.clk.Add(6 * time.Minute)
	if ok, _ := other.Lease(w.ctx); !ok {
		t.Fatal("a lapsed lease is taken over")
	}
}

func TestEngineDeletedSiteKeepsBackups(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	w.push(site, w.owner)
	w.e.RequestRun()
	w.tick()
	if len(w.rows(site)) != 1 {
		t.Fatal("not written")
	}
	w.st.Tx(w.ctx, func(tx *sql.Tx) error { return store.DeleteSite(w.ctx, tx, site) })
	w.e.Touch(site, "push")
	w.e.RequestRun()
	w.clk.Add(time.Hour)
	w.tick()
	if len(w.rows(site)) != 1 || len(w.mem.Names(site)) != 1 {
		t.Fatal("a deleted network's backup must stay")
	}
	sums, _ := store.BackupSummaries(w.ctx, w.st.R, "")
	if len(sums) != 1 || !sums[0].Deleted {
		t.Fatalf("summaries %+v", sums)
	}
}

func TestEngineFreshAfterKeyChange(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	w.push(site, w.owner)
	w.e.RequestRun()
	w.tick()
	// Unchanged: Back up now writes nothing.
	w.clk.Add(time.Hour)
	w.e.RequestRun()
	w.tick()
	if len(w.rows(site)) != 1 {
		t.Fatal("unchanged network written again")
	}
	// A new recovery key: the next file carries it although the head did not move.
	w.e.TouchNow(site)
	w.clk.Add(time.Minute)
	w.tick()
	if len(w.rows(site)) != 2 {
		t.Fatal("TouchNow writes a fresh file")
	}
}

func TestEngineRetentionAndMissing(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	// Thirty days, one change a day at noon.
	w.clk.Set(time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC))
	for d := 0; d < 30; d++ {
		w.push(site, w.owner)
		w.e.RequestRun()
		w.tick()
		w.clk.Add(24 * time.Hour)
	}
	rs := w.rows(site)
	if len(rs) >= 30 || len(rs) < 7 {
		t.Fatalf("kept %d of 30", len(rs))
	}
	if len(w.mem.Names(site)) != len(rs) {
		t.Fatalf("files %d rows %d", len(w.mem.Names(site)), len(rs))
	}
	// A file deleted by hand is marked missing at the next run.
	delete(w.mem.Files, site+"/"+rs[len(rs)-1].Name)
	w.push(site, w.owner)
	w.e.RequestRun()
	w.tick()
	missing := 0
	for _, r := range w.rows(site) {
		if r.Missing {
			missing++
		}
	}
	if missing != 1 {
		t.Fatalf("missing %d", missing)
	}
}

func TestSnapshotFile(t *testing.T) {
	w := newWorld(t)
	prov := w.addUser("prov@example.test", "member", false)
	site := w.addSite(prov)
	w.push(site, prov)
	b, err := backup.BuildSnapshot(w.ctx, w.st, store.DBBlobs{R: w.st.R}, site, "https://topo.example", w.clk.Now())
	if err != nil {
		t.Fatal(err)
	}
	var s map[string]json.RawMessage
	if err := json.Unmarshal(b.Body, &s); err != nil {
		t.Fatal(err)
	}
	// Canonical: keys sorted, as encoding/json writes a map.
	keys := []string{}
	dec := json.NewDecoder(strings.NewReader(string(b.Body)))
	dec.Token()
	for dec.More() {
		k, _ := dec.Token()
		keys = append(keys, k.(string))
		var skip json.RawMessage
		dec.Decode(&skip)
	}
	if strings.Join(keys, ",") != "$schema,kind,made,name,nameCt,originHash,owners,pubs,rev,rosters,site,v" {
		t.Fatalf("keys %v", keys)
	}
	for _, bad := range []string{"server", "email\":\"owner", "10.0.0.1", "secret-device"} {
		if strings.Contains(string(b.Body), bad) {
			t.Errorf("the file holds %q", bad)
		}
	}
	var snap backup.Snapshot
	json.Unmarshal(b.Body, &snap)
	if len(snap.Owners) != 1 || snap.Owners[0].U != w.owner || !strings.Contains(string(snap.Owners[0].Escrow), "secret-escrow") || string(snap.Owners[0].Wrap) == "" {
		t.Fatalf("owners %+v", snap.Owners)
	}
	if len(snap.Rosters) != 1 || len(snap.Pubs) != 2 || snap.Name != nil || snap.OriginHash != backup.OriginHash("https://topo.example") {
		t.Fatalf("rosters %d pubs %d name %v", len(snap.Rosters), len(snap.Pubs), snap.Name)
	}
	if err := backup.VerifySnapshot(b.Body, site, 1); err != nil {
		t.Fatal(err)
	}
	// The provider resets keys: their key no longer matches their line, so it
	// is left out and the signature is not checked (not a failure).
	sig, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	store.SetUserKeys(w.ctx, w.st.W, prov, tcrypto.B64.EncodeToString(randB(65)), tcrypto.RawPublic(&sig.PublicKey), 2, nil)
	b2, err := backup.BuildSnapshot(w.ctx, w.st, store.DBBlobs{R: w.st.R}, site, "https://topo.example", w.clk.Now())
	if err != nil {
		t.Fatal(err)
	}
	var snap2 backup.Snapshot
	json.Unmarshal(b2.Body, &snap2)
	if _, ok := snap2.Pubs[prov]; ok {
		t.Fatal("a reset key is in pubs")
	}
	if err := backup.VerifySnapshot(b2.Body, site, 1); err != nil {
		t.Fatalf("a reset author is not a failure: %v", err)
	}
	// An owner without an escrow is listed with escrow null.
	w.st.W.Exec("UPDATE users SET escrow = NULL WHERE id = ?", w.owner)
	b3, _ := backup.BuildSnapshot(w.ctx, w.st, store.DBBlobs{R: w.st.R}, site, "https://topo.example", w.clk.Now())
	if !strings.Contains(string(b3.Body), `"escrow":null`) {
		t.Fatal("escrow null not kept")
	}
	// The name only when shown, with the browser's slug.
	w.st.W.Exec("UPDATE sites SET show_name = 1, name_clear = 'Clínica Sol', name_slug = 'clinica-sol' WHERE id = ?", site)
	b4, _ := backup.BuildSnapshot(w.ctx, w.st, store.DBBlobs{R: w.st.R}, site, "https://topo.example", w.clk.Now())
	if !strings.Contains(string(b4.Body), `"name":"Clínica Sol"`) || b4.Slug != "clinica-sol" {
		t.Fatalf("name %s", b4.Slug)
	}
}

func TestCheck(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	w.push(site, w.owner)
	w.e.RequestRun()
	w.tick()
	name := site + "/" + w.rows(site)[0].Name
	good := append([]byte(nil), w.mem.Files[name]...)

	check := func() *store.BackupState {
		t.Helper()
		if err := w.e.CheckNow(w.ctx); err != nil {
			t.Fatal(err)
		}
		return w.state()
	}
	if st := check(); !st.LastCheckOK {
		t.Fatalf("good file: %+v", st)
	}
	if w.mem.Checks == 0 {
		t.Fatal("no probe")
	}
	// One byte changed: the hash differs.
	bad := append([]byte(nil), good...)
	bad[len(bad)/2] ^= 1
	w.mem.Files[name] = bad
	if st := check(); st.LastCheckOK || st.LastCheckErr != backup.CodeMismatch {
		t.Fatalf("tampered: %+v", st)
	}
	if w.mails("backup-check-failed") != 1 {
		t.Fatal("no check mail")
	}
	// The hash recorded matches but the ciphertext was replaced (a forged
	// file and row): ctHash fails.
	var snap map[string]any
	json.Unmarshal(good, &snap)
	snap["rev"].(map[string]any)["ct"] = tcrypto.B64.EncodeToString(randB(40))
	forged, _ := json.Marshal(snap)
	if err := backup.VerifySnapshot(forged, site, 1); backup.CodeOf(err) != backup.CodeDamaged {
		t.Fatalf("forged ct: %v", err)
	}
	// A wrong signature.
	json.Unmarshal(good, &snap)
	snap["rev"].(map[string]any)["sig"] = tcrypto.B64.EncodeToString(randB(64))
	forged, _ = json.Marshal(snap)
	if err := backup.VerifySnapshot(forged, site, 1); backup.CodeOf(err) != backup.CodeDamaged {
		t.Fatalf("forged sig: %v", err)
	}
	// Missing at the destination.
	delete(w.mem.Files, name)
	if st := check(); st.LastCheckOK || st.LastCheckErr != backup.CodeNotFound {
		t.Fatalf("missing: %+v", st)
	}
	if !w.rows(site)[0].Missing {
		t.Fatal("not marked missing")
	}
	if w.mails("backup-check-failed") != 1 {
		t.Fatal("a second check mail the same day")
	}
	// The probe fails.
	w.mem.Files[name] = good
	store.SetBackupFlags(w.ctx, w.st.W, w.rows(site)[0].ID, false, false)
	w.mem.FailPut = backup.CodeFull
	if st := check(); st.LastCheckOK || st.LastCheckErr != backup.CodeFull {
		t.Fatalf("probe: %+v", st)
	}
	// Weekly: due seven days after the last.
	w.mem.FailPut = ""
	checks := w.mem.Checks
	w.clk.Add(6 * 24 * time.Hour)
	w.tick()
	if w.mem.Checks != checks {
		t.Fatal("checked before a week")
	}
	w.clk.Add(25 * time.Hour)
	w.tick()
	if w.mem.Checks != checks+1 || !w.state().LastCheckOK {
		t.Fatalf("weekly check: %d %+v", w.mem.Checks-checks, w.state())
	}
}

// A store that keeps files locked (S3 object lock): old backups stay, the
// run still succeeds, the status notes it once (amendment 16).
func TestEngineLockedDeletesNoted(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	w.mem.FailDelete = backup.CodeLocked
	w.clk.Set(time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC))
	for d := 0; d < 12; d++ {
		w.push(site, w.owner)
		w.e.RequestRun()
		w.tick()
		w.clk.Add(24 * time.Hour)
	}
	st, err := store.GetBackupState(w.ctx, w.st.R)
	if err != nil {
		t.Fatal(err)
	}
	if st.DropNote != backup.CodeLocked || st.LastErr != "" {
		t.Fatalf("note %q, error %q", st.DropNote, st.LastErr)
	}
	pending := 0
	for _, r := range w.rows(site) {
		if r.DropPending {
			pending++
		}
	}
	if len(w.mem.Names(site)) != 12 || pending == 0 {
		t.Fatalf("files %d, waiting to be deleted %d", len(w.mem.Names(site)), pending)
	}
}

// A change that lands while a backup is being written is not lost: the
// next quiet spell writes it (and a TouchNow during a write is kept).
func TestEngineTouchDuringWriteKept(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	w.tick()
	w.push(site, w.owner)
	w.clk.Add(3 * time.Minute)
	once := true
	w.mem.OnPut = func(name string) {
		if once {
			once = false
			w.push(site, w.owner) // rev 2 while rev 1 is written
		}
	}
	w.tick()
	w.mem.OnPut = nil
	if rs := w.rows(site); len(rs) != 1 || rs[0].RevN != 1 {
		t.Fatalf("first write: %+v", rs)
	}
	w.clk.Add(3 * time.Minute)
	w.tick()
	if rs := w.rows(site); len(rs) != 2 || rs[0].RevN != 2 {
		t.Fatalf("the edit made during the write was dropped: %+v", rs)
	}
	// TouchNow during a write: the next tick writes a fresh file.
	once = true
	w.e.TouchNow(site)
	w.mem.OnPut = func(name string) {
		if once {
			once = false
			w.e.TouchNow(site)
		}
	}
	w.tick()
	w.mem.OnPut = nil
	if len(w.rows(site)) != 3 {
		t.Fatal("TouchNow not written")
	}
	w.clk.Add(time.Second)
	w.tick()
	if len(w.rows(site)) != 4 {
		t.Fatal("a TouchNow that landed during the write was lost")
	}
	w.clk.Add(time.Hour)
	w.tick()
	if len(w.rows(site)) != 4 {
		t.Fatal("written again with nothing pending")
	}
}

// A readable copy whose write failed is kept and written on the next run.
func TestEngineReadableKeptAfterFailure(t *testing.T) {
	w := newWorld(t)
	site := w.addSite()
	cfg, _ := store.GetBackupConfig(w.ctx, w.st.R)
	cfg.ReadableAllowed = true
	if err := store.SetBackupConfig(w.ctx, w.st.W, cfg); err != nil {
		t.Fatal(err)
	}
	if err := store.SetSiteBackupReadable(w.ctx, w.st.W, site, true); err != nil {
		t.Fatal(err)
	}
	w.tick()
	w.e.QueueReadable(site, 0, "topo_office_2026-11-10.json", []byte(`{"v":18}`))
	w.mem.FailPut = backup.CodeUnreachable
	w.e.RequestRun()
	w.tick()
	readable := func() int {
		rs, err := store.SiteBackups(w.ctx, w.st.R, site, "readable", "")
		if err != nil {
			t.Fatal(err)
		}
		return len(rs)
	}
	if readable() != 0 {
		t.Fatal("written although Put failed")
	}
	w.mem.FailPut = ""
	w.e.RequestRun()
	w.tick()
	if readable() != 1 {
		t.Fatal("the readable copy was lost after a failed write")
	}
}
