package api

import (
	"strings"
	"testing"
	"time"
)

// Watched connections (docs/SCOPE.md step 8f, D376-D379): a PC's heartbeat,
// lost after 3 missed intervals and said once, back with its gap, going
// away not lost, its own gaps (the server not answering) told when it can,
// the site's list with the monitors, nothing kept with statistics Off.
func TestConnections(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	os := o.b.open()

	beat := func(who *person, body map[string]any) resp {
		t.Helper()
		return who.b.post("/api/connection/beat", body)
	}
	if r := beat(p, map[string]any{"name": ""}); r.Code != 400 {
		t.Fatalf("a beat with no name: %d", r.Code)
	}
	if r := beat(p, map[string]any{"name": "Reception PC", "intervalMs": 60000}); r.Code != 200 {
		t.Fatalf("beat: %d %s", r.Code, r.Body.String())
	}
	if e.count("SELECT count(*) FROM connections WHERE name = 'Reception PC' AND lost = 0") != 1 {
		t.Fatal("not watched after its first beat")
	}

	// Two intervals missed: not lost yet; three: lost, said once.
	e.clk.Add(2 * time.Minute)
	e.srv.SweepConnections(t.Context())
	if e.count("SELECT count(*) FROM connections WHERE lost = 1") != 0 {
		t.Fatal("lost after 2 intervals")
	}
	e.clk.Add(90 * time.Second)
	e.srv.SweepConnections(t.Context())
	os.wait(t, `"lost":true`)
	if !strings.Contains(os.text(), `"name":"Reception PC"`) {
		t.Fatalf("the event does not name the PC: %s", os.text())
	}
	before := strings.Count(os.text(), `"lost":true`)
	e.srv.SweepConnections(t.Context())
	time.Sleep(20 * time.Millisecond)
	if strings.Count(os.text(), `"lost":true`) != before {
		t.Fatal("lost announced twice")
	}
	if e.count("SELECT count(*) FROM connection_gaps WHERE seen_by = 'server' AND to_ms IS NULL") != 1 {
		t.Fatal("no open gap while lost")
	}

	// Back: the gap closes, said with its times.
	e.clk.Add(10 * time.Minute)
	if r := beat(p, map[string]any{"name": "Reception PC"}); r.Code != 200 {
		t.Fatalf("beat after lost: %d", r.Code)
	}
	os.wait(t, `"back":true`)
	if e.count("SELECT count(*) FROM connection_gaps WHERE seen_by = 'server' AND to_ms IS NOT NULL") != 1 {
		t.Fatal("the gap did not close")
	}

	// Going away (quit) is not lost; signing out is going away too.
	if r := p.b.post("/api/connection/away", map[string]any{}); r.Code != 204 {
		t.Fatalf("away: %d", r.Code)
	}
	e.clk.Add(30 * time.Minute)
	e.srv.SweepConnections(t.Context())
	if e.count("SELECT count(*) FROM connections WHERE lost = 1") != 0 {
		t.Fatal("a PC that went away was called lost")
	}

	// The PC's own gap: the server did not answer it; told when it could.
	now := e.clk.Now().UnixMilli()
	if r := beat(p, map[string]any{"name": "Reception PC", "gaps": []map[string]any{{"from": now - 600_000, "to": now - 300_000}, {"from": now + 1, "to": now + 2}}}); r.Code != 200 {
		t.Fatalf("beat with gaps: %d", r.Code)
	}
	os.wait(t, `"serverSilent":true`)
	if e.count("SELECT count(*) FROM connection_gaps WHERE seen_by = 'client'") != 1 {
		t.Fatal("the PC's gap not kept once (a future one refused)")
	}

	// The site's list: the PC, its gaps, seen by whom.
	list := o.b.get("/api/sites/" + site + "/connections?from=0").json()
	clients := list["clients"].([]any)
	if len(clients) != 1 {
		t.Fatalf("clients: %v", list)
	}
	c := clients[0].(map[string]any)
	gaps := c["gaps"].([]any)
	if c["kind"] != "pc" || c["name"] != "Reception PC" || c["email"] != "prov@example.test" || len(gaps) != 2 {
		t.Fatalf("the PC: %v", c)
	}
	seen := map[string]bool{}
	for _, g := range gaps {
		seen[g.(map[string]any)["seenBy"].(string)] = true
	}
	if !seen["server"] || !seen["client"] {
		t.Fatalf("gaps: %v", gaps)
	}

	// Keep statistics Off: nothing kept is shown.
	if r := o.b.do("PATCH", "/api/sites/"+site+"/stats-days", map[string]any{"days": 0, "confirm": true}); r.Code != 200 {
		t.Fatalf("stats off: %d %s", r.Code, r.Body.String())
	}
	off := o.b.get("/api/sites/" + site + "/connections?from=0").json()
	if g := off["clients"].([]any)[0].(map[string]any)["gaps"].([]any); len(g) != 0 {
		t.Fatalf("gaps shown with statistics Off: %v", g)
	}

	// A person who shares no site with it is not told, nor sees it.
	x := e.newPerson("other@example.test", "member")
	xs := x.b.open()
	if r := beat(x, map[string]any{"name": "Elsewhere"}); r.Code != 200 {
		t.Fatalf("x beat: %d", r.Code)
	}
	if r := o.b.get("/api/sites/" + site + "/connections"); len(r.json()["clients"].([]any)) != 1 {
		t.Fatalf("another site's PC listed: %v", r.json())
	}
	e.clk.Add(10 * time.Minute)
	e.srv.SweepConnections(t.Context())
	xs.wait(t, `"lost":true`)
	time.Sleep(20 * time.Millisecond)
	if strings.Contains(os.text(), `"name":"Elsewhere"`) {
		t.Fatal("the owner was told about a PC of someone who shares no site with them")
	}

	// Stop watching.
	if r := p.b.do("DELETE", "/api/connection", nil); r.Code != 204 {
		t.Fatalf("stop: %d", r.Code)
	}
	if e.count("SELECT count(*) FROM connections WHERE name = 'Reception PC'") != 0 {
		t.Fatal("still watched")
	}
}
