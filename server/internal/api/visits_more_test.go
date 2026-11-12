package api

import (
	"fmt"
	"testing"
	"time"
)

// A decided copy stays beside a new one for the same report until its
// author takes the answer (D191): only a waiting copy is replaced.
func TestVisitDecidedCopyKeptBesideNewOne(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	o.shareKeys(site, p)
	if r := o.push(site, "1"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	r := p.putVisit(site, "", "slot_report_one", "a")
	if r.Code != 201 {
		t.Fatal(r.Code)
	}
	first := r.json()["visit"].(map[string]any)["id"].(string)
	if r := o.push(site, "2"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	if r := o.b.post("/api/sites/"+site+"/visits/"+first+"/decide", map[string]any{"decision": "rejected", "n": 2}); r.Code != 200 {
		t.Fatal(r.Code)
	}
	e.clk.Add(time.Second)
	r = p.putVisit(site, "", "slot_report_one", "a and b")
	if r.Code != 201 || r.json()["replacedId"] != nil || r.json()["visit"].(map[string]any)["replaced"] != float64(0) {
		t.Fatalf("new copy beside a decided one: %d %s", r.Code, r.Body.String())
	}
	second := r.json()["visit"].(map[string]any)["id"].(string)
	mine := visitsOf(t, p.b.get("/api/sites/"+site+"/visits"))
	if len(mine) != 2 || mine[0]["id"] != first || mine[0]["state"] != "rejected" || mine[1]["state"] != "waiting" {
		t.Fatalf("the provider's copies: %v", mine)
	}
	// A third replaces only the waiting one.
	e.clk.Add(time.Second)
	r = p.putVisit(site, "", "slot_report_one", "a, b and c")
	if r.Code != 201 || r.json()["replacedId"] != second {
		t.Fatalf("replace the waiting one: %d %s", r.Code, r.Body.String())
	}
	if e.count("SELECT count(*) FROM visit_copies WHERE site_id = ? AND author = ?", site, p.id) != 2 {
		t.Fatal("a decided and a waiting copy should be there")
	}
}

// A provider made a viewer, or removed, takes their copies with them
// (D191): no copy an owner cannot review waits for good.
func TestVisitCopiesGoWithTheProvider(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	q := o.join(site, "prov2@example.test", "provider")
	o.shareKeys(site, p)
	o.shareKeys(site, q)
	if r := o.push(site, "1"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	if r := p.putVisit(site, "", "slot_report_one", "p"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	if r := q.putVisit(site, "", "slot_report_one", "q"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	_, _, epoch, rseq := o.head(site)
	if r := o.b.post("/api/sites/"+site+"/members/"+p.id+"/role", map[string]any{"role": "viewer",
		"roster": o.roster(site, rseq+1, epoch, rm{o, "owner"}, rm{p, "viewer"}, rm{q, "provider"})}); r.Code != 200 {
		t.Fatalf("set role: %d %s", r.Code, r.Body.String())
	}
	if e.count("SELECT count(*) FROM visit_copies WHERE author = ?", p.id) != 0 {
		t.Fatal("a viewer's copies should be gone")
	}
	_, _, epoch, rseq = o.head(site)
	o.newKey(site, epoch+1)
	if r := o.b.post("/api/sites/"+site+"/remove", map[string]any{"user": q.id, "roster": o.roster(site, rseq+1, epoch+1, rm{o, "owner"}, rm{p, "viewer"}),
		"wraps": []any{o.siteWrap(site, epoch+1, o), o.siteWrap(site, epoch+1, p)}, "nameCt": o.nameCt(site, epoch+1)}); r.Code != 200 {
		t.Fatalf("remove: %d %s", r.Code, r.Body.String())
	}
	if e.count("SELECT count(*) FROM visit_copies WHERE author = ?", q.id) != 0 {
		t.Fatal("a removed provider's copies should be gone")
	}
}

// At most MaxWaitingVisits copies wait on one site; replacing one's own
// waiting copy is still accepted when the site is full.
func TestVisitsFull(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	o.shareKeys(site, p)
	if r := o.push(site, "1"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	for i := 0; i < MaxWaitingVisits; i++ {
		if r := p.putVisit(site, "", fmt.Sprintf("slot_report_%03d", i), "x"); r.Code != 201 {
			t.Fatalf("copy %d: %d %s", i, r.Code, r.Body.String())
		}
	}
	r := p.putVisit(site, "", "slot_report_full", "x")
	if r.Code != 409 || r.json()["error"] != ErrVisitsFull {
		t.Fatalf("one past the cap: %d %s", r.Code, r.Body.String())
	}
	if r := p.putVisit(site, "", "slot_report_000", "y"); r.Code != 201 {
		t.Fatalf("a replacement when full: %d %s", r.Code, r.Body.String())
	}
}
