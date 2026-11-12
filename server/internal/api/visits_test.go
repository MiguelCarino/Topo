package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"database/sql"
	"strings"
	"testing"
	"time"

	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// visitEnvelope builds and signs a visit copy as js/servercrypto.js
// sealVisit does (docs/SCOPE.md D154). id "" mints one.
func (p *person) visitEnvelope(site, id, slot string, baseN int64, doc string) map[string]any {
	if id == "" {
		id = store.NewID("v_")
	}
	_, _, epoch, rseq := p.head(site)
	key := p.keys[site][epoch]
	if key == nil {
		key = randBytes(32)
	}
	iv := randBytes(12)
	at := p.e.clk.Now().UnixMilli()
	hdr := &tcrypto.VisitHeader{Site: site, ID: id, Slot: slot, BaseN: baseN, Epoch: epoch, RSeq: rseq, Author: p.id, Dev: p.devID, At: at}
	blk, _ := aes.NewCipher(key)
	g, _ := cipher.NewGCM(blk)
	ct := g.Seal(nil, iv, append([]byte{0, 0}, doc...), []byte(hdr.AAD()))
	hdr.CTHash = tcrypto.CTHash(iv, ct)
	sig := b64(tcrypto.SignP1363(p.sig, []byte(hdr.SignedString())))
	return map[string]any{"id": id, "slot": slot, "baseN": baseN, "epoch": epoch, "rseq": rseq, "author": p.id, "dev": p.devID, "at": at,
		"ctHash": hdr.CTHash, "sig": sig, "iv": b64(iv), "ct": b64(ct)}
}

// putVisit uploads a visit copy on the current head (base 0: the head).
func (p *person) putVisit(site, id, slot, doc string) resp {
	p.e.t.Helper()
	n, _, _, _ := p.head(site)
	return p.b.post("/api/sites/"+site+"/visits", map[string]any{"copy": p.visitEnvelope(site, id, slot, n, doc)})
}

func visitsOf(t *testing.T, r resp) []map[string]any {
	t.Helper()
	if r.Code != 200 {
		t.Fatalf("list visits: %d %s", r.Code, r.Body.String())
	}
	var out []map[string]any
	for _, v := range r.json()["visits"].([]any) {
		out = append(out, v.(map[string]any))
	}
	return out
}

func TestVisitCopies(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	q := o.join(site, "prov2@example.test", "provider")
	v := o.join(site, "view@example.test", "viewer")
	o.shareKeys(site, p)
	o.shareKeys(site, q)
	if r := o.push(site, "1"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	e.clk.Add(10 * time.Minute)
	e.mails()
	ps := p.b.open()
	defer ps.cancel()
	os := o.b.open()
	defer os.cancel()

	// The provider uploads; the owner is told live and by email.
	r := p.putVisit(site, "", "slot_report_one", "p edits")
	if r.Code != 201 || r.json()["visit"].(map[string]any)["state"] != "waiting" {
		t.Fatalf("upload: %d %s", r.Code, r.Body.String())
	}
	first := r.json()["visit"].(map[string]any)["id"].(string)
	os.wait(t, "event: visits")
	e.clk.Add(3 * time.Minute)
	if e.lastMail(ownerEmail, "visit-recorded") == nil || e.lastMail("prov@example.test", "visit-recorded") != nil {
		t.Fatal("visit-recorded should go to the owner only")
	}
	// The server holds ciphertext only.
	if e.count("SELECT count(*) FROM visit_copies WHERE CAST(ct AS TEXT) LIKE '%p edits%'") != 0 {
		t.Fatal("plaintext on the server")
	}

	// Refusals: an owner (their edits are revisions), a viewer, a bad
	// signature, another person's envelope, a base past the head or one
	// that is not there, a stale epoch or roster.
	if r := o.putVisit(site, "", "slot_report_one", "x"); r.Code != 403 {
		t.Fatalf("owner upload: %d", r.Code)
	}
	if r := v.putVisit(site, "", "slot_report_one", "x"); r.Code != 403 {
		t.Fatalf("viewer upload: %d", r.Code)
	}
	env := p.visitEnvelope(site, "", "slot_report_one", 1, "x")
	env["sig"] = q.visitEnvelope(site, "", "slot_report_one", 1, "x")["sig"]
	if r := p.b.post("/api/sites/"+site+"/visits", map[string]any{"copy": env}); r.Code != 422 || r.json()["error"] != ErrBadSignature {
		t.Fatalf("bad signature: %d %s", r.Code, r.Body.String())
	}
	if r := p.b.post("/api/sites/"+site+"/visits", map[string]any{"copy": q.visitEnvelope(site, "", "slot_report_one", 1, "x")}); r.Code != 400 {
		t.Fatalf("someone else's envelope: %d", r.Code)
	}
	if r := p.b.post("/api/sites/"+site+"/visits", map[string]any{"copy": p.visitEnvelope(site, "", "slot_report_one", 9, "x")}); r.Code != 409 || r.json()["error"] != ErrStaleBase {
		t.Fatalf("base past the head: %d %s", r.Code, r.Body.String())
	}
	env = p.visitEnvelope(site, "", "slot_report_one", 1, "x")
	env["epoch"] = float64(7)
	if r := p.b.post("/api/sites/"+site+"/visits", map[string]any{"copy": env}); r.Code != 422 {
		t.Fatalf("epoch edited after signing: %d", r.Code)
	}
	if r := p.b.post("/api/sites/"+site+"/visits", map[string]any{"copy": map[string]any{"id": "bad"}}); r.Code != 400 {
		t.Fatalf("junk: %d", r.Code)
	}

	// One copy per provider and report: a second Record visit replaces it.
	r = p.putVisit(site, "", "slot_report_one", "p edits, then more")
	if r.Code != 201 || r.json()["replacedId"] != first || r.json()["visit"].(map[string]any)["replaced"] != float64(1) {
		t.Fatalf("replace: %d %s", r.Code, r.Body.String())
	}
	second := r.json()["visit"].(map[string]any)["id"].(string)
	if e.count("SELECT count(*) FROM visit_copies WHERE site_id = ? AND author = ?", site, p.id) != 1 {
		t.Fatal("the replaced copy is still there")
	}
	// Another report and another provider: copies of their own.
	e.clk.Add(time.Second)
	if r := p.putVisit(site, "", "slot_report_two", "other"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	e.clk.Add(time.Second)
	if r := q.putVisit(site, "", "slot_report_one", "q edits"); r.Code != 201 {
		t.Fatal(r.Code)
	}

	// The owner sees all three, oldest first, with the author's email; a
	// provider their own; a viewer none.
	all := visitsOf(t, o.b.get("/api/sites/"+site+"/visits"))
	if len(all) != 3 || all[0]["id"] != second || all[2]["email"] != "prov2@example.test" {
		t.Fatalf("owner's list: %v", all)
	}
	if mine := visitsOf(t, p.b.get("/api/sites/"+site+"/visits")); len(mine) != 2 {
		t.Fatalf("provider's list: %v", mine)
	}
	if none := visitsOf(t, v.b.get("/api/sites/"+site+"/visits")); len(none) != 0 {
		t.Fatalf("viewer's list: %v", none)
	}
	// One copy with its body: the owner and its author; not another provider.
	if r := o.b.get("/api/sites/" + site + "/visits/" + second); r.Code != 200 || r.json()["body"].(map[string]any)["ct"] == "" {
		t.Fatalf("owner get: %d", r.Code)
	}
	if r := q.b.get("/api/sites/" + site + "/visits/" + second); r.Code != 404 {
		t.Fatalf("another provider's copy: %d", r.Code)
	}

	// Deciding: owners only, on a revision that exists, once.
	if r := p.b.post("/api/sites/"+site+"/visits/"+second+"/decide", map[string]any{"decision": "approved", "n": 1}); r.Code != 403 {
		t.Fatalf("provider decides: %d", r.Code)
	}
	if r := o.b.post("/api/sites/"+site+"/visits/"+second+"/decide", map[string]any{"decision": "maybe", "n": 1}); r.Code != 400 {
		t.Fatalf("bad decision: %d", r.Code)
	}
	if r := o.b.post("/api/sites/"+site+"/visits/"+second+"/decide", map[string]any{"decision": "approved", "n": 5}); r.Code != 422 {
		t.Fatalf("a revision that is not there: %d", r.Code)
	}
	if r := o.push(site, "merged p's visit"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	e.mails()
	if r := o.b.post("/api/sites/"+site+"/visits/"+second+"/decide", map[string]any{"decision": "approved", "n": 2}); r.Code != 200 {
		t.Fatalf("approve: %d %s", r.Code, r.Body.String())
	}
	ps.wait(t, `"state":"approved"`)
	if r := o.b.post("/api/sites/"+site+"/visits/"+second+"/decide", map[string]any{"decision": "rejected", "n": 2}); r.Code != 409 {
		t.Fatalf("decided twice: %d", r.Code)
	}
	e.clk.Add(3 * time.Minute)
	m := e.lastMail("prov@example.test", "visit-recorded")
	if m == nil || !strings.Contains(m.Subject, "approved") {
		t.Fatalf("the provider's approval email: %+v", m)
	}
	if body := e.mailBody("prov@example.test", "visit-recorded"); !strings.Contains(body, "approved your visit") || strings.Contains(body, "p edits") {
		t.Fatalf("approval body: %s", body)
	}
	// q's is rejected: q is told so; the owner, who decided, is not.
	third := all[2]["id"].(string)
	before := len(e.mails())
	if r := o.b.post("/api/sites/"+site+"/visits/"+third+"/decide", map[string]any{"decision": "rejected", "n": 2}); r.Code != 200 {
		t.Fatal(r.Code)
	}
	e.clk.Add(3 * time.Minute)
	got := map[string]int{}
	for _, mm := range e.mails()[before:] {
		got[mm.To+" "+mm.Kind+" "+mm.Subject]++
	}
	if got["prov2@example.test visit-recorded The owner did not accept your visit"] != 1 || len(got) != 1 {
		t.Fatalf("rejection mail: %v", got)
	}
	// The provider sees its decision, takes it, and deletes its copy.
	mine := visitsOf(t, p.b.get("/api/sites/"+site+"/visits"))
	if mine[0]["state"] != "approved" || mine[0]["decidedN"] != float64(2) || mine[0]["decidedBy"] != o.id {
		t.Fatalf("decision as the provider sees it: %v", mine[0])
	}
	if r := q.b.do("DELETE", "/api/sites/"+site+"/visits/"+second, nil); r.Code != 404 {
		t.Fatalf("another provider deletes: %d", r.Code)
	}
	if r := p.b.do("DELETE", "/api/sites/"+site+"/visits/"+second, nil); r.Code != 204 {
		t.Fatalf("author deletes: %d", r.Code)
	}
	// Housekeeping drops a decided copy left behind after 90 days.
	e.clk.Add(91 * 24 * time.Hour)
	if _, err := e.st.Housekeep(context.Background(), e.clk.Now().UnixMilli(), store.HousekeepLimits{SessionIdleMs: 1 << 50}); err != nil {
		t.Fatal(err)
	}
	if e.count("SELECT count(*) FROM visit_copies WHERE id = ?", third) != 0 || e.count("SELECT count(*) FROM visit_copies WHERE state = 'waiting'") != 1 {
		t.Fatal("housekeeping: decided copies should go, waiting ones stay")
	}
}

// A waiting copy's base is never pruned (the owner reviews three-way
// against it); once decided it may go.
func TestVisitBaseHeldFromPruning(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail, "TOPO_REV_CAP=2")
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	o.push(site, "1")
	o.push(site, "2")
	r := p.b.post("/api/sites/"+site+"/visits", map[string]any{"copy": p.visitEnvelope(site, "", "slot_report_one", 2, "v")})
	if r.Code != 201 {
		t.Fatal(r.Code, r.Body.String())
	}
	id := r.json()["visit"].(map[string]any)["id"].(string)
	for i := 0; i < 4; i++ {
		o.push(site, "more")
	}
	if r := o.b.get("/api/sites/" + site + "/revs/2"); r.Code != 200 {
		t.Fatalf("a waiting copy's base was pruned: %d", r.Code)
	}
	if r := o.b.get("/api/sites/" + site + "/revs/1"); r.Code != 410 {
		t.Fatalf("an unheld old body should go: %d", r.Code)
	}
	if r := o.b.post("/api/sites/"+site+"/visits/"+id+"/decide", map[string]any{"decision": "approved", "n": 6}); r.Code != 200 {
		t.Fatal(r.Code)
	}
	o.push(site, "after")
	if r := o.b.get("/api/sites/" + site + "/revs/2"); r.Code != 410 {
		t.Fatalf("a decided copy's base still held: %d", r.Code)
	}
}

// A database from v0.0.1 holds revisions pushed by providers. They stay
// valid history: the pull serves them, their chain and signatures verify
// from the headers alone, and an owner pushes on top. Only new provider
// pushes are refused (D154).
func TestV001ProviderRevisionsStillVerify(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	if r := o.push(site, "1"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	// What a v0.0.1 server stored for a provider's push, written as it did.
	n, h, epoch, rseq := o.head(site)
	env := p.envelope(site, n+1, h, epoch, rseq, "provider's v0.0.1 edit")
	iv, _ := tcrypto.DecodeB64(env["iv"].(string))
	ct, _ := tcrypto.DecodeB64(env["ct"].(string))
	hdr := &tcrypto.RevHeader{Site: site, N: n + 1, Base: n, Prev: h, Epoch: epoch, RSeq: rseq, Author: p.id, Dev: p.devID, At: env["at"].(int64), CTHash: tcrypto.CTHash(iv, ct)}
	ch := tcrypto.ChainHash(hdr.SignedString(), env["sig"].(string))
	ctx := context.Background()
	if err := e.st.Tx(ctx, func(tx *sql.Tx) error {
		if err := store.InsertRev(ctx, tx, &store.Rev{SiteID: site, N: n + 1, Base: n, Prev: h, Epoch: epoch, RSeq: rseq, Author: p.id, Device: p.devID,
			At: hdr.At, Received: hdr.At, Size: int64(len(ct)), CTHash: hdr.CTHash, Sig: env["sig"].(string), H: ch}); err != nil {
			return err
		}
		return store.DBBlobs{R: e.st.R}.Put(ctx, tx, site, n+1, env["iv"].(string), ct)
	}); err != nil {
		t.Fatal(err)
	}
	// The pull from 0: every header chains and verifies with its author's key.
	pj := o.b.get("/api/sites/" + site + "/revs?since=0").json()
	prev := tcrypto.Genesis(site)
	keys := map[string]string{o.id: o.sigPub(), p.id: p.sigPub()}
	for _, x := range pj["revs"].([]any) {
		hd := x.(map[string]any)
		hh := &tcrypto.RevHeader{Site: site, N: int64(hd["n"].(float64)), Base: int64(hd["base"].(float64)), Prev: hd["prev"].(string), Epoch: int64(hd["epoch"].(float64)),
			RSeq: int64(hd["rseq"].(float64)), Author: hd["author"].(string), Dev: hd["dev"].(string), At: int64(hd["at"].(float64)), CTHash: hd["ctHash"].(string)}
		if hh.Prev != prev || tcrypto.ChainHash(hh.SignedString(), hd["sig"].(string)) != hd["h"] || tcrypto.VerifyB64(keys[hh.Author], []byte(hh.SignedString()), hd["sig"].(string)) != nil {
			t.Fatalf("revision %v does not verify", hd["n"])
		}
		prev = hd["h"].(string)
	}
	if len(pj["revs"].([]any)) != 2 || pj["revs"].([]any)[1].(map[string]any)["author"] != p.id || pj["body"].(map[string]any)["n"] != float64(2) {
		t.Fatalf("pull: %v", pj)
	}
	// The owner builds on it; the provider cannot add another.
	if r := o.push(site, "3"); r.Code != 201 || r.json()["n"] != float64(3) {
		t.Fatalf("owner on top of a provider revision: %d %s", r.Code, r.Body.String())
	}
	if r := p.push(site, "4"); r.Code != 403 || r.json()["error"] != ErrOwnersOnly {
		t.Fatalf("a new provider push: %d", r.Code)
	}
}
