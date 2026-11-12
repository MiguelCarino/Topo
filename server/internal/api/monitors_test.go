package api

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// monitorOf makes a PC's device keys, registers them as a monitor of site
// (p is an owner) and returns it as a *person (its id, email = id, keys)
// with a browser that sends only its token, plus the token.
func (p *person) addMonitorPC(site, name string) (*person, string) {
	p.e.t.Helper()
	m := &person{e: p.e, b: p.e.browser(nextIP()), keys: map[string]map[int64][]byte{}}
	m.enc, _ = ecdh.P256().GenerateKey(rand.Reader)
	m.sig, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	r := p.b.post("/api/sites/"+site+"/monitors", map[string]any{"name": name, "encPub": m.encPub(), "sigPub": m.sigPub()})
	if r.Code != 201 {
		p.e.t.Fatalf("add monitor: %d %s", r.Code, r.Body.String())
	}
	mj := r.json()["monitor"].(map[string]any)
	m.id = mj["id"].(string)
	m.email = m.id
	people.Store(m.id, m)
	return m, r.json()["token"].(string)
}

// mdo is a request with the monitor's token and no cookie.
func (m *person) mdo(tok, method, path string, body any) resp {
	m.e.t.Helper()
	return m.b.do(method, path, body, "Authorization", "Topo-Monitor "+tok, "Origin", "", "Sec-Fetch-Site", "same-origin")
}

// record seals and signs a record as js/servercrypto.js sealRecord does.
func (p *person) record(site, kind, id string, epoch int64, plain string) json.RawMessage {
	key := p.keys[site][epoch]
	if key == nil {
		key = randBytes(32)
	}
	iv := randBytes(12)
	r := &tcrypto.Record{V: 1, Site: site, Kind: kind, ID: id, Epoch: epoch, Author: p.id, At: p.e.clk.Now().UnixMilli()}
	blk, _ := aes.NewCipher(key)
	g, _ := cipher.NewGCM(blk)
	ct := g.Seal(nil, iv, []byte(plain), []byte(r.AAD()))
	r.IV, r.CT, r.CTHash = b64(iv), b64(ct), tcrypto.CTHash(iv, ct)
	r.Sig = b64(tcrypto.SignP1363(p.sig, []byte(r.SignedString())))
	out, _ := json.Marshal(r)
	return out
}

func (e *aenv) str(q string, args ...any) string {
	var s string
	e.st.R.QueryRow(q, args...).Scan(&s)
	return s
}

// The whole life of a site monitor on the server (docs/SCOPE.md D146-D151,
// D158, D159, D161, D162).
func TestSiteMonitor(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	v := o.join(site, "view@example.test", "viewer")
	if r := o.push(site, "1"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	os := o.b.open()
	defer os.cancel()

	// Only an owner turns a PC into a monitor.
	if r := p.b.post("/api/sites/"+site+"/monitors", map[string]any{"name": "x", "encPub": o.encPub(), "sigPub": o.sigPub()}); r.Code != 403 {
		t.Fatalf("provider adds a monitor: %d", r.Code)
	}
	if r := o.b.post("/api/sites/"+site+"/monitors", map[string]any{"name": "x", "encPub": "bad", "sigPub": o.sigPub()}); r.Code != 400 {
		t.Fatalf("bad keys: %d", r.Code)
	}
	m, tok := o.addMonitorPC(site, "Building B")
	if !tcrypto.ValidMonitorID(m.id) || e.roleOf(site, m.id) != "monitor" {
		t.Fatalf("monitor %q role %q", m.id, e.roleOf(site, m.id))
	}
	// Before it is granted it holds no key and reads nothing.
	if r := m.mdo(tok, "GET", "/api/sites/"+site+"/revs?since=0", nil); r.Code != 403 {
		t.Fatalf("waiting monitor pulls: %d", r.Code)
	}
	// The owner's browser grants it: the roster names it 'monitor', the
	// site key is wrapped to its device key. No email goes to a monitor.
	e.mails()
	o.grant(site, m)
	for _, ml := range e.mails() {
		if strings.EqualFold(ml.To, m.id) {
			t.Fatal("mail sent to a monitor")
		}
	}
	// It reads the site: the summary, rosters, its wrap, the revisions.
	for _, path := range []string{"/api/sites/" + site, "/api/sites/" + site + "/rosters?since=0", "/api/sites/" + site + "/keys", "/api/sites/" + site + "/revs?since=0", "/api/monitor"} {
		if r := m.mdo(tok, "GET", path, nil); r.Code != 200 {
			t.Fatalf("monitor GET %s: %d %s", path, r.Code, r.Body.String())
		}
	}
	if r := m.mdo(tok, "GET", "/api/monitor", nil); r.json()["site"] != site || r.json()["statsDays"] != float64(360) {
		t.Fatalf("self: %s", r.Body.String())
	}
	// It never writes a revision, a visit copy, a roster or anything a person does.
	_, _, epoch, _ := o.head(site)
	o.shareKeys(site, m)
	m.devID = "d_monitor"
	n, h, ep, rseq := o.head(site)
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"POST", "/api/sites/" + site + "/revs", map[string]any{"rev": m.envelope(site, n+1, h, ep, rseq, "monitor")}},
		{"POST", "/api/sites/" + site + "/visits", map[string]any{}},
		{"POST", "/api/sites/" + site + "/leave", map[string]any{}},
		{"POST", "/api/sites/" + site + "/rotate", map[string]any{}},
		{"GET", "/api/me", nil},
		{"GET", "/api/events", nil},
		{"POST", "/api/sites/" + site + "/records", m.record(site, "act", "in1|ack|1", epoch, "{}")},
	} {
		if r := m.mdo(tok, c.method, c.path, c.body); r.Code != 403 {
			t.Fatalf("monitor %s %s: %d %s", c.method, c.path, r.Code, r.Body.String())
		}
	}
	// Another site is not there for it.
	other := o.createSite()
	if r := m.mdo(tok, "GET", "/api/sites/"+other, nil); r.Code != 404 {
		t.Fatalf("monitor reads another site: %d", r.Code)
	}
	// A person cannot use the monitor routes.
	if r := o.b.do("PUT", "/api/sites/"+site+"/status", o.record(site, "status", o.id, epoch, "{}")); r.Code != 403 {
		t.Fatalf("owner puts a status: %d", r.Code)
	}

	// Status: kept alone, the heartbeat, a live event; the server keeps
	// only ciphertext.
	plain := `{"v":1,"items":{"n1":{"state":"down"}},"secret":"plaintext-marker"}`
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/status?interval=60000", m.record(site, "status", m.id, epoch, plain)); r.Code != 200 {
		t.Fatalf("status: %d %s", r.Code, r.Body.String())
	}
	os.wait(t, "event: monitor-status")
	e.clk.Add(time.Second)
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/status", m.record(site, "status", m.id, epoch, plain)); r.Code != 200 {
		t.Fatalf("status again: %d", r.Code)
	}
	if e.count("SELECT count(*) FROM site_records WHERE kind = 'status'") != 1 {
		t.Fatal("more than the latest status kept")
	}
	// Someone else's id, a forged signature, another epoch: refused.
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/status", m.record(site, "status", "m_00000000000000000000aa", epoch, plain)); r.Code != 400 {
		t.Fatalf("status for another id: %d", r.Code)
	}
	forged := o.record(site, "status", o.id, epoch, plain)
	var fr map[string]any
	json.Unmarshal(forged, &fr)
	fr["author"] = m.id
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/status", fr); r.Code != 422 && r.Code != 400 {
		t.Fatalf("forged status: %d %s", r.Code, r.Body.String())
	}
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/status", m.record(site, "status", m.id, epoch+1, plain)); r.Code != 409 || r.json()["error"] != ErrStaleEpoch {
		t.Fatalf("status at another epoch: %d %s", r.Code, r.Body.String())
	}

	// Issues: only a monitor opens one; acts are owners' and providers'.
	e.clk.Add(time.Second)
	if r := m.mdo(tok, "POST", "/api/sites/"+site+"/records", m.record(site, "issue", "in0000000001", epoch, `{"node":"n1"}`)); r.Code != 200 {
		t.Fatalf("issue: %d %s", r.Code, r.Body.String())
	}
	os.wait(t, "event: record")
	o.shareKeys(site, p)
	if r := p.b.post("/api/sites/"+site+"/records", p.record(site, "issue", "in0000000002", epoch, "{}")); r.Code != 403 {
		t.Fatalf("provider opens an issue: %d", r.Code)
	}
	if r := p.b.post("/api/sites/"+site+"/records", p.record(site, "act", "in0000000001|ack|1", epoch, "{}")); r.Code != 200 {
		t.Fatalf("provider act: %d %s", r.Code, r.Body.String())
	}
	if r := o.b.post("/api/sites/"+site+"/records", o.record(site, "quiet", "q1", epoch, "{}")); r.Code != 200 {
		t.Fatalf("owner quiet: %d %s", r.Code, r.Body.String())
	}
	o.shareKeys(site, v)
	if r := v.b.post("/api/sites/"+site+"/records", v.record(site, "act", "in0000000001|ack|2", epoch, "{}")); r.Code != 403 {
		t.Fatalf("viewer act: %d", r.Code)
	}
	// Someone else cannot replace the monitor's issue.
	if r := o.b.post("/api/sites/"+site+"/records", o.record(site, "act", "in0000000001|ack|1", epoch, "{}")); r.Code != 403 || r.json()["error"] != ErrNotAuthor {
		t.Fatalf("owner replaces the provider's act: %d %s", r.Code, r.Body.String())
	}
	// Every member reads them, the viewer too.
	r := v.b.get("/api/sites/" + site + "/records?since=0")
	if r.Code != 200 || len(r.json()["records"].([]any)) != 4 {
		t.Fatalf("records: %d %s", r.Code, r.Body.String())
	}
	if e.count("SELECT count(*) FROM site_records WHERE record LIKE '%plaintext-marker%'") != 0 {
		t.Fatal("the server holds plaintext")
	}

	// Statistics: a blob per monitor and day; Off refuses; shortening asks.
	day := (e.clk.Now().UnixMilli() / dayMs) * dayMs
	ds := strconv.FormatInt(day, 10)
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/stats/"+ds, m.record(site, "stats", m.id+"|"+ds, epoch, `{"hours":[]}`)); r.Code != 204 {
		t.Fatalf("stats: %d %s", r.Code, r.Body.String())
	}
	old := day - 400*dayMs
	olds := strconv.FormatInt(old, 10)
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/stats/"+olds, m.record(site, "stats", m.id+"|"+olds, epoch, `{}`)); r.Code != 409 {
		t.Fatalf("stats past the retention: %d", r.Code)
	}
	if err := store.PutStats(t.Context(), e.st.W, site, m.id, day-100*dayMs, 1, "{}"); err != nil {
		t.Fatal(err)
	}
	r = v.b.get("/api/sites/" + site + "/stats?from=" + strconv.FormatInt(day-200*dayMs, 10) + "&to=" + ds)
	if r.Code != 200 || len(r.json()["stats"].([]any)) != 2 {
		t.Fatalf("pull stats: %d %s", r.Code, r.Body.String())
	}
	if r := p.b.do("PATCH", "/api/sites/"+site+"/stats-days", map[string]any{"days": 30}); r.Code != 403 {
		t.Fatalf("provider sets retention: %d", r.Code)
	}
	if r := o.b.do("PATCH", "/api/sites/"+site+"/stats-days", map[string]any{"days": 30}); r.Code != 409 || r.json()["deletes"] != float64(1) {
		t.Fatalf("shorten without confirm: %d %s", r.Code, r.Body.String())
	}
	if r := o.b.do("PATCH", "/api/sites/"+site+"/stats-days", map[string]any{"days": 30, "confirm": true}); r.Code != 200 || r.json()["deleted"] != float64(1) {
		t.Fatalf("shorten: %d %s", r.Code, r.Body.String())
	}
	if r := o.b.do("PATCH", "/api/sites/"+site+"/stats-days", map[string]any{"days": 0, "confirm": true}); r.Code != 200 {
		t.Fatalf("off: %d", r.Code)
	}
	if e.count("SELECT count(*) FROM monitor_stats WHERE site_id = ?", site) != 0 {
		t.Fatal("Off kept statistics")
	}
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/stats/"+ds, m.record(site, "stats", m.id+"|"+ds, epoch, `{}`)); r.Code != 409 || r.json()["error"] != ErrStatsOff {
		t.Fatalf("stats while Off: %d", r.Code)
	}
	// Status and issues still work with statistics Off.
	e.clk.Add(time.Second)
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/status", m.record(site, "status", m.id, epoch, plain)); r.Code != 200 {
		t.Fatalf("status with stats Off: %d", r.Code)
	}

	// The unfolded records go into the backup beside the document; folded
	// ones do not.
	b, err := backup.BuildSnapshot(t.Context(), e.st, store.DBBlobs{R: e.st.R}, site, e.origin, e.clk.Now())
	if err != nil {
		t.Fatal(err)
	}
	var snap backup.Snapshot
	json.Unmarshal(b.Body, &snap)
	if len(snap.Records) != 3 {
		t.Fatalf("backup records: %d", len(snap.Records))
	}
	if err := backup.VerifySnapshot(b.Body, site, snap.Rev.N); err != nil {
		t.Fatal(err)
	}
	all := v.b.get("/api/sites/" + site + "/records?since=0").json()["records"].([]any)
	var ns []int64
	for _, x := range all {
		rec := x.(map[string]any)
		if rec["record"].(map[string]any)["kind"] == "issue" {
			ns = append(ns, int64(rec["n"].(float64)))
		}
	}
	if r := p.b.post("/api/sites/"+site+"/records/folded", map[string]any{"ns": ns}); r.Code != 403 {
		t.Fatalf("provider folds: %d", r.Code)
	}
	if r := o.b.post("/api/sites/"+site+"/records/folded", map[string]any{"ns": ns}); r.Code != 200 || r.json()["folded"] != float64(1) {
		t.Fatalf("fold: %d %s", r.Code, r.Body.String())
	}
	b, _ = backup.BuildSnapshot(t.Context(), e.st, store.DBBlobs{R: e.st.R}, site, e.origin, e.clk.Now())
	snap = backup.Snapshot{}
	json.Unmarshal(b.Body, &snap)
	// The issue's act went with it (D277); only the quiet window stays.
	if len(snap.Records) != 1 {
		t.Fatalf("backup records after the fold: %d", len(snap.Records))
	}
	if e.count("SELECT count(*) FROM site_records WHERE kind = 'act' AND folded = 1") != 1 {
		t.Fatal("the act on the folded issue was not folded")
	}

	// The heartbeat: 3 missed intervals -> stopped reporting, said once;
	// reporting again says so.
	ms := o.b.get("/api/sites/" + site + "/monitors").json()
	if mons := ms["monitors"].([]any); len(mons) != 1 || mons[0].(map[string]any)["lastReport"].(float64) == 0 || mons[0].(map[string]any)["stale"] != false {
		t.Fatalf("monitors: %v", ms)
	}
	e.clk.Add(2 * time.Minute)
	e.srv.SweepMonitors(t.Context())
	if e.count("SELECT count(*) FROM monitors WHERE stale = 1") != 0 {
		t.Fatal("stale after 2 intervals")
	}
	e.clk.Add(90 * time.Second)
	e.srv.SweepMonitors(t.Context())
	os.wait(t, `"stale":true`)
	if e.count("SELECT count(*) FROM monitors WHERE stale = 1") != 1 {
		t.Fatal("not stale after 3 intervals")
	}
	before := strings.Count(os.text(), `"stale":true`)
	e.srv.SweepMonitors(t.Context())
	time.Sleep(20 * time.Millisecond)
	if strings.Count(os.text(), `"stale":true`) != before {
		t.Fatal("stopped reporting announced twice")
	}
	e.clk.Add(time.Second)
	if r := m.mdo(tok, "PUT", "/api/sites/"+site+"/status", m.record(site, "status", m.id, epoch, plain)); r.Code != 200 {
		t.Fatalf("status after stale: %d", r.Code)
	}
	os.wait(t, `"stale":false`)

	// The monitor survives its technician signing out.
	if r := o.b.post("/api/auth/signout", map[string]any{}); r.Code != 204 && r.Code != 200 {
		t.Fatalf("sign out: %d", r.Code)
	}
	if r := m.mdo(tok, "GET", "/api/monitor", nil); r.Code != 200 {
		t.Fatalf("monitor after its owner signed out: %d", r.Code)
	}
}

// Revoking a monitor deletes its credential and rotates the key; the
// rotation must wrap the new key for the monitors that stay (D149).
func TestRevokeMonitorRotates(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	a, tokA := o.addMonitorPC(site, "A")
	b, tokB := o.addMonitorPC(site, "B")
	o.grant(site, a, b)
	if e.roleOf(site, a.id) != "monitor" || e.str("SELECT status FROM members WHERE user_id = ?", b.id) != "granted" {
		t.Fatal("not granted")
	}
	// A person's role cannot be set to monitor, nor a monitor's changed.
	if r := o.b.post("/api/sites/"+site+"/members/"+a.id+"/role", map[string]any{"role": "owner"}); r.Code != 400 {
		t.Fatalf("monitor made owner: %d", r.Code)
	}
	_, _, epoch, rseq := o.head(site)
	o.newKey(site, epoch+1)
	// Without a wrap for monitor B: refused.
	missing := map[string]any{"roster": o.roster(site, rseq+1, epoch+1, rm{o, "owner"}, rm{b, "monitor"}),
		"wraps": []any{o.siteWrap(site, epoch+1, o)}, "nameCt": o.nameCt(site, epoch+1)}
	if r := o.b.post("/api/sites/"+site+"/monitors/"+a.id+"/revoke", missing); r.Code != 422 {
		t.Fatalf("revoke without B's wrap: %d %s", r.Code, r.Body.String())
	}
	ok := map[string]any{"roster": o.roster(site, rseq+1, epoch+1, rm{o, "owner"}, rm{b, "monitor"}),
		"wraps": []any{o.siteWrap(site, epoch+1, o), o.siteWrap(site, epoch+1, b)}, "nameCt": o.nameCt(site, epoch+1)}
	if r := o.b.post("/api/sites/"+site+"/monitors/"+a.id+"/revoke", ok); r.Code != 200 {
		t.Fatalf("revoke: %d %s", r.Code, r.Body.String())
	}
	if r := a.mdo(tokA, "GET", "/api/monitor", nil); r.Code != 401 {
		t.Fatalf("revoked monitor: %d", r.Code)
	}
	if r := b.mdo(tokB, "GET", "/api/sites/"+site+"/keys", nil); r.Code != 200 || !strings.Contains(r.Body.String(), `"epoch":`+strconv.FormatInt(epoch+1, 10)) {
		t.Fatalf("B's new wrap: %d %s", r.Code, r.Body.String())
	}
	if e.count("SELECT count(*) FROM monitors") != 1 || e.count("SELECT count(*) FROM users WHERE id = ? AND disabled = 1", a.id) != 1 {
		t.Fatal("A's credential kept")
	}
	// B writes at the new epoch only.
	b.keys[site] = map[int64][]byte{epoch: o.keys[site][epoch], epoch + 1: o.keys[site][epoch+1]}
	if r := b.mdo(tokB, "PUT", "/api/sites/"+site+"/status", b.record(site, "status", b.id, epoch, "{}")); r.Code != 409 {
		t.Fatalf("old epoch: %d", r.Code)
	}
	if r := b.mdo(tokB, "PUT", "/api/sites/"+site+"/status", b.record(site, "status", b.id, epoch+1, "{}")); r.Code != 200 {
		t.Fatalf("new epoch: %d %s", r.Code, r.Body.String())
	}
	// Removing a monitor through the members list revokes it too.
	_, _, epoch, rseq = o.head(site)
	o.newKey(site, epoch+1)
	rem := map[string]any{"user": b.id, "roster": o.roster(site, rseq+1, epoch+1, rm{o, "owner"}),
		"wraps": []any{o.siteWrap(site, epoch+1, o)}, "nameCt": o.nameCt(site, epoch+1)}
	if r := o.b.post("/api/sites/"+site+"/remove", rem); r.Code != 200 {
		t.Fatalf("remove monitor: %d %s", r.Code, r.Body.String())
	}
	if r := b.mdo(tokB, "GET", "/api/monitor", nil); r.Code != 401 {
		t.Fatalf("removed monitor: %d", r.Code)
	}
	// Monitors are not people: not in the server's list of people.
	r := e.browserAdmin(o).get("/api/admin/users")
	if strings.Contains(r.Body.String(), "m_") {
		t.Fatalf("a monitor in the people list: %s", r.Body.String())
	}
}

func (e *aenv) browserAdmin(o *person) *browser { return o.b }

// The records cap (D277): folded records make room first, and a monitor's
// issue is never refused for it; acts wait for room.
func TestRecordsCapKeepsIssues(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	if r := o.push(site, "1"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	m, tok := o.addMonitorPC(site, "A")
	o.grant(site, m)
	_, _, epoch, _ := o.head(site)
	o.shareKeys(site, m)
	// Fill the cap with acts (straight into the table: 5000 requests are slow).
	for i := 0; i < RecordsPerSite; i++ {
		if _, err := e.st.W.Exec("INSERT INTO site_records(site_id, kind, id, author, epoch, at, received, record) VALUES(?,?,?,?,?,?,?,?)",
			site, "act", "inX|ack|"+strconv.Itoa(i), o.id, epoch, i, 1, "{}"); err != nil {
			t.Fatal(err)
		}
	}
	e.clk.Add(time.Second)
	if r := o.b.post("/api/sites/"+site+"/records", o.record(site, "act", "inY|ack|1", epoch, "{}")); r.Code != 507 || r.json()["error"] != ErrRecordsFull {
		t.Fatalf("act over the cap: %d %s", r.Code, r.Body.String())
	}
	if r := m.mdo(tok, "POST", "/api/sites/"+site+"/records", m.record(site, "issue", "in0000000009", epoch, "{}")); r.Code != 200 {
		t.Fatalf("issue over the cap: %d %s", r.Code, r.Body.String())
	}
	// Folded ones make room: an act fits again.
	e.st.W.Exec("UPDATE site_records SET folded = 1 WHERE site_id = ? AND kind = 'act' AND id LIKE 'inX|ack|1%'", site)
	e.clk.Add(time.Second)
	if r := o.b.post("/api/sites/"+site+"/records", o.record(site, "act", "inY|ack|2", epoch, "{}")); r.Code != 200 {
		t.Fatalf("act after folded room: %d %s", r.Code, r.Body.String())
	}
}

// A database fault while looking up a monitor's token is 503, never 401:
// the app takes a 401 for a revoke and forgets its keys.
func TestMonitorLookupFaultIs503(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	m, tok := o.addMonitorPC(site, "A")
	o.grant(site, m)
	if r := m.mdo(tok, "GET", "/api/monitor", nil); r.Code != 200 {
		t.Fatalf("monitor: %d", r.Code)
	}
	// Another token: its first character changed (a random token can start
	// with "x" itself, which made this check flaky).
	other := "x"
	if tok[0] == 'x' {
		other = "y"
	}
	if r := m.mdo(other+tok[1:], "GET", "/api/monitor", nil); r.Code != 401 {
		t.Fatalf("unknown token: %d", r.Code)
	}
	e.st.R.Close()
	if r := m.mdo(tok, "GET", "/api/monitor", nil); r.Code != 503 || r.json()["error"] != ErrUnavailable {
		t.Fatalf("lookup fault: %d %s", r.Code, r.Body.String())
	}
}
