package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"carino.systems/topo/server/internal/tcrypto"
)

func TestPushPullAnd409(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")

	// First push: base 0, prev = genesis.
	r := o.push(site, `{"v":1}`)
	if r.Code != 201 || r.json()["n"] != float64(1) {
		t.Fatalf("first push: %d %s", r.Code, r.Body.String())
	}
	h1 := r.json()["h"].(string)
	// Both browsers had head 1; the provider wins the race, the owner gets
	// 409 with the new head.
	n, h, epoch, rseq := o.head(site)
	if r := p.pushAt(site, n, h, epoch, rseq, "provider edit"); r.Code != 201 {
		t.Fatalf("provider push: %d %s", r.Code, r.Body.String())
	}
	r = o.pushAt(site, n, h, epoch, rseq, "owner edit")
	if r.Code != 409 || r.json()["error"] != ErrStaleBase {
		t.Fatalf("stale push: %d %s", r.Code, r.Body.String())
	}
	head := r.json()["head"].(map[string]any)
	if head["n"] != float64(2) {
		t.Fatalf("409 head: %v", head)
	}
	// The owner pulls since 1 and gets header 2 plus the head body.
	pr := o.b.get("/api/sites/" + site + "/revs?since=1")
	pj := pr.json()
	revs := pj["revs"].([]any)
	if pr.Code != 200 || len(revs) != 1 || pj["more"] != false || pj["body"].(map[string]any)["n"] != float64(2) {
		t.Fatalf("pull: %d %s", pr.Code, pr.Body.String())
	}
	h2 := revs[0].(map[string]any)
	if h2["prev"] != h1 || h2["author"] != p.id || h2["h"] != head["h"] {
		t.Fatalf("header 2: %v", h2)
	}
	// The chain verifies client-side from the headers alone.
	hdr := &tcrypto.RevHeader{Site: site, N: 2, Base: 1, Prev: h1, Epoch: 1, RSeq: int64(h2["rseq"].(float64)), Author: p.id, Dev: h2["dev"].(string),
		At: int64(h2["at"].(float64)), CTHash: h2["ctHash"].(string)}
	if tcrypto.ChainHash(hdr.SignedString(), h2["sig"].(string)) != h2["h"] || tcrypto.VerifyB64(p.sigPub(), []byte(hdr.SignedString()), h2["sig"].(string)) != nil {
		t.Fatal("chain or signature does not verify from the pulled header")
	}
	// Then re-encrypts on the new base and pushes again (amendment A5).
	if r := o.push(site, "owner edit merged"); r.Code != 201 || r.json()["n"] != float64(3) {
		t.Fatalf("push after merge: %d %s", r.Code, r.Body.String())
	}
	// Nothing new: no body.
	if pj := o.b.get("/api/sites/" + site + "/revs?since=3").json(); pj["body"] != nil || len(pj["revs"].([]any)) != 0 {
		t.Fatalf("pull at head: %v", pj)
	}
	// Paging.
	if pj := o.b.get("/api/sites/" + site + "/revs?since=0&limit=2").json(); len(pj["revs"].([]any)) != 2 || pj["more"] != true {
		t.Fatalf("paged pull: %v", pj)
	}
	// One revision with its body.
	if r := o.b.get("/api/sites/" + site + "/revs/2"); r.Code != 200 || r.json()["body"].(map[string]any)["ct"] == "" {
		t.Fatalf("rev 2: %d", r.Code)
	}
	if r := o.b.get("/api/sites/" + site + "/revs/9"); r.Code != 404 {
		t.Fatalf("missing rev: %d", r.Code)
	}

	n, h, epoch, rseq = o.head(site)
	// A tampered signature, a ciphertext that does not match its hash, a
	// wrong prev, a stale roster, someone else's device: all refused.
	env := o.envelope(site, n+1, h, epoch, rseq, "x")
	env["sig"] = p.envelope(site, n+1, h, epoch, rseq, "x")["sig"]
	if r := o.b.post("/api/sites/"+site+"/revs", map[string]any{"rev": env}); r.Code != 422 || r.json()["error"] != ErrBadSignature {
		t.Fatalf("bad signature: %d %s", r.Code, r.Body.String())
	}
	env = o.envelope(site, n+1, h, epoch, rseq, "x")
	env["ct"] = b64(randBytes(40))
	if r := o.b.post("/api/sites/"+site+"/revs", map[string]any{"rev": env}); r.Code != 422 {
		t.Fatalf("ct hash: %d", r.Code)
	}
	if r := o.pushAt(site, n, h1, epoch, rseq, "x"); r.Code != 422 || r.json()["error"] != ErrBadChain {
		t.Fatalf("wrong prev: %d %s", r.Code, r.Body.String())
	}
	if r := o.pushAt(site, n, h, epoch, rseq-1, "x"); r.Code != 409 || r.json()["error"] != ErrStaleRoster || r.json()["rosterSeq"] != float64(rseq) {
		t.Fatalf("stale roster: %d %s", r.Code, r.Body.String())
	}
	env = p.envelope(site, n+1, h, epoch, rseq, "x")
	if r := o.b.post("/api/sites/"+site+"/revs", map[string]any{"rev": env}); r.Code != 400 {
		t.Fatalf("someone else's envelope: %d", r.Code)
	}
	// A viewer gets 403, a stranger 404.
	v := o.join(site, "view@example.test", "viewer")
	n, h, epoch, rseq = o.head(site)
	if r := v.pushAt(site, n, h, epoch, rseq, "x"); r.Code != 403 {
		t.Fatalf("viewer: %d", r.Code)
	}
	s := e.newPerson("stranger@example.test", "staff")
	if r := s.pushAt(site, n, h, epoch, rseq, "x"); r.Code != 404 {
		t.Fatalf("stranger: %d", r.Code)
	}
	if r := s.b.get("/api/sites/" + site + "/revs"); r.Code != 404 {
		t.Fatalf("stranger pull: %d", r.Code)
	}
}

func TestRevisionCapsAndSizes(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail, "TOPO_REV_CAP=3", "TOPO_MAX_REV_BYTES=2048", "TOPO_SITE_MAX_BYTES=4000")
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	for i := 0; i < 5; i++ {
		if r := o.push(site, strings.Repeat("a", 300)); r.Code != 201 {
			t.Fatalf("push %d: %d %s", i, r.Code, r.Body.String())
		}
	}
	if e.count("SELECT count(*) FROM rev_bodies WHERE site_id = ?", site) != 3 || e.count("SELECT count(*) FROM revisions WHERE site_id = ?", site) != 5 {
		t.Fatal("cap: bodies or headers")
	}
	r := o.b.get("/api/sites/" + site + "/revs/1")
	if r.Code != 410 || r.json()["error"] != ErrGone {
		t.Fatalf("pruned body: %d", r.Code)
	}
	if pj := o.b.get("/api/sites/" + site + "/revs?since=0").json(); len(pj["revs"].([]any)) != 5 || pj["revs"].([]any)[0].(map[string]any)["pruned"] != true {
		t.Fatal("headers must outlive their bodies")
	}
	var bytes int64
	e.st.R.QueryRow("SELECT bytes FROM sites WHERE id = ?", site).Scan(&bytes)
	if want := int64(e.count("SELECT coalesce(sum(length(ct)),0) FROM rev_bodies WHERE site_id = ?", site)); bytes != want {
		t.Fatalf("site bytes %d, stored %d", bytes, want)
	}
	// Over TOPO_MAX_REV_BYTES: 413.
	if r := o.push(site, strings.Repeat("b", 3000)); r.Code != 413 || r.json()["error"] != ErrTooLarge {
		t.Fatalf("too large: %d %s", r.Code, r.Body.String())
	}
	// Bodies near the site limit: old bodies go first; the head stays.
	for i := 0; i < 3; i++ {
		if r := o.push(site, strings.Repeat("c", 1900)); r.Code != 201 {
			t.Fatalf("big push %d: %d %s", i, r.Code, r.Body.String())
		}
	}
	e.st.R.QueryRow("SELECT bytes FROM sites WHERE id = ?", site).Scan(&bytes)
	if bytes > 4000 {
		t.Fatalf("site over its limit: %d", bytes)
	}
	n, _, _, _ := o.head(site)
	if e.count("SELECT count(*) FROM rev_bodies WHERE site_id = ? AND n = ?", site, n) != 1 {
		t.Fatal("head body pruned")
	}
}

func TestSiteFull(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail, "TOPO_MAX_REV_BYTES=2048", "TOPO_SITE_MAX_BYTES=3000")
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	if r := o.push(site, strings.Repeat("a", 1800)); r.Code != 201 {
		t.Fatal(r.Code)
	}
	// The head cannot be pruned, and head + this one is over the limit.
	if r := o.push(site, strings.Repeat("a", 1800)); r.Code != 413 || r.json()["error"] != ErrSiteFull {
		t.Fatalf("site full: %d %s", r.Code, r.Body.String())
	}
}

func TestConcurrentPushesOneWinner(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	for round := 0; round < 3; round++ {
		n, h, epoch, rseq := o.head(site)
		bodies := make([]map[string]any, 20)
		for i := range bodies {
			bodies[i] = map[string]any{"rev": o.envelope(site, n+1, h, epoch, rseq, "edit")}
		}
		var wg sync.WaitGroup
		codes := make([]int, 20)
		for i := range bodies {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				codes[i] = o.b.post("/api/sites/"+site+"/revs", bodies[i]).Code
			}(i)
		}
		wg.Wait()
		won := 0
		for _, c := range codes {
			switch c {
			case 201:
				won++
			case 409:
			default:
				t.Fatalf("round %d: unexpected %d", round, c)
			}
		}
		if won != 1 {
			t.Fatalf("round %d: %d winners", round, won)
		}
	}
	if e.count("SELECT count(*) FROM revisions WHERE site_id = ?", site) != 3 {
		t.Fatal("revision count")
	}
}

func TestLiveHeadAndRevoke(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	ps := p.b.open()
	os := o.b.open()
	if r := o.push(site, "x"); r.Code != 201 {
		t.Fatal(r.Code)
	}
	ps.wait(t, "event: head")
	ps.wait(t, `"site":"`+site+`"`)
	os.wait(t, "event: head") // the author's other tabs need it too
	if !strings.Contains(ps.text(), "retry: 5000") {
		t.Fatal("no retry line")
	}
	// Revoking the provider's session ends their stream.
	sid := p.b.get("/api/me/sessions").json()["sessions"].([]any)[0].(map[string]any)["id"].(string)
	if r := p.b.post("/api/me/sessions/revoke-others", map[string]any{}); r.Code != 204 {
		t.Fatal(r.Code)
	}
	if ps.ended() {
		t.Fatal("revoke-others ended the caller's own stream")
	}
	if r := p.b.do("DELETE", "/api/me/sessions/"+sid, nil); r.Code != 204 {
		t.Fatal(r.Code)
	}
	if !ps.ended() {
		t.Fatal("stream still open after its session was revoked")
	}
	os.cancel()
	if !os.ended() {
		t.Fatal("stream did not end when the client went")
	}
	// A stream needs a session.
	anon := e.browser(nextIP())
	if r := anon.get("/api/events"); r.Code != 401 {
		t.Fatalf("anonymous events: %d", r.Code)
	}
	// Per-user cap.
	e.hub.PerUser = 2
	a1, a2 := o.b.open(), o.b.open()
	defer a1.cancel()
	defer a2.cancel()
	a3 := o.b.open()
	a3.ended()
	if !strings.Contains(a3.text(), "rate-limited") {
		t.Fatalf("third stream: %q", a3.text())
	}
}

func TestNotificationsFromPushes(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	q := o.join(site, "prov2@example.test", "provider")
	s := e.newPerson("stranger@example.test", "staff")
	e.clk.Add(10 * time.Minute)
	e.mails() // join notices out of the way

	before := len(e.mails())
	// The owner sends an incident to p; the event names a stranger and an
	// unknown kind too (both dropped, the push still succeeds).
	r := o.push(site, "incident sent", map[string]any{"kind": "incident-sent", "to": []string{p.id, s.id, "u_nobody"}}, map[string]any{"kind": "bogus", "to": []string{p.id}})
	if r.Code != 201 {
		t.Fatalf("push with events: %d %s", r.Code, r.Body.String())
	}
	e.clk.Add(3 * time.Minute)
	ms := e.mails()[before:]
	kinds := map[string]int{}
	for _, m := range ms {
		kinds[m.To+" "+m.Kind]++
		if m.To == "stranger@example.test" {
			t.Fatal("mail to a non-member")
		}
	}
	if kinds["prov@example.test incident-sent"] != 1 || kinds["prov2@example.test incident-sent"] != 0 {
		t.Fatalf("incident-sent recipients: %v", kinds)
	}
	// The digest: nobody else gets 'revision' for their own push; providers
	// are off by default; the author never gets anything.
	if kinds[ownerEmail+" revision"] != 0 || kinds["prov@example.test revision"] != 0 {
		t.Fatalf("revision digests: %v", kinds)
	}
	body := e.mailBody("prov@example.test", "incident-sent")
	if !strings.Contains(body, "A client reported a problem on one of your sites") || strings.Contains(body, "incident sent") {
		t.Fatalf("incident body: %s", body)
	}

	// The provider records a visit: the owner (and the reporter id named)
	// get visit-recorded; the owner gets no separate revision digest for
	// that push.
	before = len(e.mails())
	if r := p.push(site, "visit", map[string]any{"kind": "visit-recorded", "to": []string{o.id}}); r.Code != 201 {
		t.Fatal(r.Code)
	}
	e.clk.Add(3 * time.Minute)
	kinds = map[string]int{}
	for _, m := range e.mails()[before:] {
		kinds[m.To+" "+m.Kind]++
	}
	if kinds[ownerEmail+" visit-recorded"] != 1 || kinds[ownerEmail+" revision"] != 0 || kinds["prov2@example.test visit-recorded"] != 0 {
		t.Fatalf("visit recipients: %v", kinds)
	}

	// A plain push by the provider: the owner gets a revision digest; more
	// pushes inside the window merge into one later email with a count.
	before = len(e.mails())
	p.push(site, "r1")
	if e.lastMail(ownerEmail, "revision") == nil {
		t.Fatal("no first revision digest")
	}
	p.push(site, "r2")
	p.push(site, "r3")
	e.clk.Add(30 * time.Minute)
	n := 0
	for _, m := range e.mails()[before:] {
		if m.Kind == "revision" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("digest sent inside the window: %d", n)
	}
	e.clk.Add(31 * time.Minute)
	if body := e.mailBody(ownerEmail, "revision"); !strings.Contains(body, ": 2.") {
		t.Fatalf("digest count: %s", body)
	}

	// Opt-outs: the provider turns incident emails off; a per-site mute
	// silences the second provider.
	p.b.do("PATCH", "/api/me", map[string]any{"notify": map[string]any{"incident": false}})
	q.b.do("PATCH", "/api/sites/"+site+"/me", map[string]any{"muted": true})
	before = len(e.mails())
	o.push(site, "again", map[string]any{"kind": "incident-sent", "to": []string{p.id, q.id}})
	e.clk.Add(3 * time.Minute)
	for _, m := range e.mails()[before:] {
		if m.Kind == "incident-sent" {
			t.Fatalf("opted-out or muted member got %s", m.To)
		}
	}

	// A revision digest that comes due while the person is online is
	// skipped (they see the change live).
	p.b.do("PATCH", "/api/me", map[string]any{"notify": map[string]any{"revisionShared": true}})
	ps := p.b.open()
	before = len(e.mails())
	o.push(site, "while online")
	e.clk.Add(61 * time.Minute)
	for _, m := range e.mails()[before:] {
		if m.Kind == "revision" && m.To == "prov@example.test" {
			t.Fatal("digest sent to someone online")
		}
	}
	if e.count("SELECT count(*) FROM outbox WHERE sent = -3 AND user_id = ?", p.id) != 1 {
		t.Fatal("skipped digest not recorded")
	}
	ps.cancel()
	ps.ended()

	// F2: one author may declare incident-sent to one person at most 5
	// times per site per hour; each declared email merges while unsent.
	p.b.do("PATCH", "/api/me", map[string]any{"notify": map[string]any{"incident": true}})
	e.clk.Add(2 * time.Hour)
	e.mails()
	for i := 0; i < 8; i++ {
		o.push(site, "spam", map[string]any{"kind": "incident-sent", "to": []string{p.id}})
	}
	if got := e.count("SELECT count(*) FROM declared WHERE site_id = ? AND author = ? AND to_user = ? AND at > ?", site, o.id, p.id, e.clk.Now().Add(-time.Hour).UnixMilli()); got != 5 {
		t.Fatalf("declared within the hour: %d", got)
	}
	var count int
	e.st.R.QueryRow("SELECT count FROM outbox WHERE kind = 'incident-sent' AND user_id = ? AND sent IS NULL", p.id).Scan(&count)
	if count != 5 {
		t.Fatalf("merged incident count: %d", count)
	}
}

func TestEventsFromRefusedPushAreDropped(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	o.push(site, "1")
	e.clk.Add(10 * time.Minute)
	e.mails()
	before := e.count("SELECT count(*) FROM outbox")
	n, h, epoch, rseq := o.head(site)
	if r := o.pushAt(site, n-1, h, epoch, rseq, "stale", map[string]any{"kind": "incident-sent", "to": []string{p.id}}); r.Code != 409 {
		t.Fatal(r.Code)
	}
	if e.count("SELECT count(*) FROM outbox") != before || e.count("SELECT count(*) FROM declared") != 0 {
		t.Fatal("a refused push queued mail")
	}
}

// The route matrix for the site routes: a stranger gets 404 (ids are not
// confirmed), a waiting member 403 beyond Member routes, a viewer 403 on
// Writer and Owner routes, a provider 403 on Owner routes, and every
// state-changing route refuses a request without X-Topo.
func TestRoutesMatrixSites(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	prov := o.join(site, "prov@example.test", "provider")
	view := o.join(site, "view@example.test", "viewer")
	tok := o.invite(site, "wait@example.test", "provider")
	wait := e.newPerson("wait@example.test", "")
	wait.b.post("/api/invites/accept", map[string]any{"token": tok})
	stranger := e.newPerson("stranger@example.test", "staff")

	type who struct {
		name string
		b    *browser
		want map[Class]int // status for the class; 0 = allowed (not 401/403/404)
	}
	whos := []who{
		{"stranger", stranger.b, map[Class]int{Member: 404, Reader: 404, Writer: 404, Owner: 404}},
		{"waiting", wait.b, map[Class]int{Reader: 403, Writer: 403, Owner: 403}},
		{"viewer", view.b, map[Class]int{Writer: 403, Owner: 403}},
		{"provider", prov.b, map[Class]int{Owner: 403}},
	}
	for pattern, class := range e.srv.Routes() {
		if !strings.Contains(pattern, "{site}") {
			continue
		}
		method, path, _ := strings.Cut(pattern, " ")
		path = strings.NewReplacer("{site}", site, "{uid}", o.id, "{iid}", "i_x", "{n}", "1").Replace(path)
		if (method == "DELETE" && strings.HasSuffix(path, site)) || strings.HasSuffix(path, "/leave") {
			continue // checked last: they would delete the site or end the membership
		}
		var body any
		if method != "GET" {
			body = map[string]any{}
		}
		for _, w := range whos {
			want := w.want[class]
			r := w.b.do(method, path, body)
			if want != 0 && r.Code != want {
				t.Errorf("%s as %s: %d, want %d", pattern, w.name, r.Code, want)
			}
			if want == 0 && (r.Code == 401 || (r.Code == 403 && r.json()["error"] == ErrForbidden) || (r.Code == 404 && strings.Count(path, "/") == 4 && method == "GET")) {
				t.Errorf("%s as %s: refused with %d", pattern, w.name, r.Code)
			}
		}
		if method != "GET" {
			if r := o.b.do(method, path, body, "X-Topo", ""); r.Code != 403 || r.json()["error"] != ErrCSRF {
				t.Errorf("%s without X-Topo: %d", pattern, r.Code)
			}
			if r := o.b.do(method, path, body, "Origin", "https://evil.example"); r.Code != 403 || r.json()["error"] != ErrCSRF {
				t.Errorf("%s from a foreign origin: %d", pattern, r.Code)
			}
		}
	}
	for _, w := range whos {
		if r := w.b.do("DELETE", "/api/sites/"+site, nil); r.Code != w.want[Owner] {
			t.Errorf("delete as %s: %d", w.name, r.Code)
		}
	}
	for _, w := range whos {
		want := w.want[Member]
		if want == 0 {
			want = 204
		}
		if r := w.b.post("/api/sites/"+site+"/leave", map[string]any{}); r.Code != want {
			t.Errorf("leave as %s: %d", w.name, r.Code)
		}
	}
	var _ = json.Marshal
	var _ = http.StatusOK
}
