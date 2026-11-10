package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"carino.systems/topo/server/internal/tcrypto"
)

func TestCreateSite(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	if e.count("SELECT count(*) FROM site_rosters WHERE site_id = ?", site) != 1 || e.count("SELECT count(*) FROM site_wraps WHERE site_id = ?", site) != 1 {
		t.Fatal("roster or wrap not stored")
	}
	n, h, epoch, rseq := o.head(site)
	if n != 0 || h != tcrypto.Genesis(site) || epoch != 1 || rseq != 1 {
		t.Fatalf("new head: %d %s %d %d", n, h, epoch, rseq)
	}
	list := o.b.get("/api/sites").json()["sites"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["role"] != "owner" || list[0].(map[string]any)["nameClear"] != nil {
		t.Fatalf("sites: %v", list)
	}
	// The same id again: 409.
	again := map[string]any{"id": site, "roster": o.roster(site, 1, 1, rm{o, "owner"}), "wrap": o.siteWrap(site, 1, o)["wrap"]}
	if r := o.b.post("/api/sites", again); r.Code != 409 {
		t.Fatalf("duplicate id: %d", r.Code)
	}
	// A malformed id, a roster naming someone else, a wrong seq, a roster
	// signed by another key, a wrap for the wrong epoch.
	s2 := "s_" + b64(randBytes(16))
	o.newKey(s2, 1)
	staff := e.newPerson("staff@example.test", "staff")
	cases := []struct {
		name string
		body map[string]any
		code int
	}{
		{"bad id", map[string]any{"id": "s_x", "roster": o.roster(s2, 1, 1, rm{o, "owner"}), "wrap": o.siteWrap(s2, 1, o)["wrap"]}, 400},
		{"two members", map[string]any{"id": s2, "roster": o.roster(s2, 1, 1, rm{o, "owner"}, rm{staff, "provider"}), "wrap": o.siteWrap(s2, 1, o)["wrap"]}, 422},
		{"seq 2", map[string]any{"id": s2, "roster": o.roster(s2, 2, 1, rm{o, "owner"}), "wrap": o.siteWrap(s2, 1, o)["wrap"]}, 409},
		{"signed by another", map[string]any{"id": s2, "roster": staff.roster(s2, 1, 1, rm{o, "owner"}), "wrap": o.siteWrap(s2, 1, o)["wrap"]}, 422},
		{"wrap epoch 2", map[string]any{"id": s2, "roster": o.roster(s2, 1, 1, rm{o, "owner"}), "wrap": o.wrap(o.enc.PublicKey().Bytes(), tcrypto.SiteCtx(s2, 2, o.id), randBytes(32))}, 422},
		{"other site's roster", map[string]any{"id": s2, "roster": o.roster(site, 1, 1, rm{o, "owner"}), "wrap": o.siteWrap(s2, 1, o)["wrap"]}, 400},
	}
	for _, c := range cases {
		if r := o.b.post("/api/sites", c.body); r.Code != c.code {
			t.Errorf("%s: %d %s", c.name, r.Code, r.Body.String())
		}
	}
	// A member (invited, not staff) may not create sites.
	m := e.newPerson("member@example.test", "member")
	m.newKey(s2, 1)
	if r := m.b.post("/api/sites", map[string]any{"id": s2, "roster": m.roster(s2, 1, 1, rm{m, "owner"}), "wrap": m.siteWrap(s2, 1, m)["wrap"]}); r.Code != 403 {
		t.Fatalf("member creating a site: %d", r.Code)
	}
	// A stranger cannot see the site (404, the id is not confirmed).
	if r := staff.b.get("/api/sites/" + site); r.Code != 404 {
		t.Fatalf("stranger: %d", r.Code)
	}
}

func TestInviteAcceptGrant(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	tok := o.invite(site, "Prov@Example.test", "provider")
	if !strings.HasPrefix(tok, "i_") {
		t.Fatalf("token %q", tok)
	}
	// The invitation email carries no site name (none allowed in clear).
	if body := e.mailBody("prov@example.test", "invite"); strings.Contains(body, "Office") || !strings.Contains(body, ownerEmail) {
		t.Fatalf("invite body: %s", body)
	}
	// Peek tells the token holder who it is for.
	anon := e.browser(nextIP())
	pk := anon.post("/api/invites/peek", map[string]any{"token": tok})
	if pk.Code != 200 || pk.json()["email"] != "prov@example.test" || pk.json()["role"] != "provider" || pk.json()["inviter"] != ownerEmail {
		t.Fatalf("peek: %d %s", pk.Code, pk.Body.String())
	}
	if r := anon.post("/api/invites/peek", map[string]any{"token": tok + "x"}); r.Code != 400 || r.json()["error"] != ErrBadInvite {
		t.Fatalf("bad peek: %d", r.Code)
	}
	// Someone signed in as another address cannot accept.
	other := e.newPerson("other@example.test", "member")
	if r := other.b.post("/api/invites/accept", map[string]any{"token": tok}); r.Code != 403 || r.json()["error"] != ErrWrongEmail {
		t.Fatalf("wrong email: %d %s", r.Code, r.Body.String())
	}
	// The invitee can sign in thanks to the invitation; they accept before
	// setting up keys (allowed), and the owner hears about it.
	stream := o.b.open()
	defer stream.cancel()
	p := e.signedIn("prov@example.test", "")
	if inv := p.b.get("/api/sites").json()["invites"].([]any); len(inv) != 1 {
		t.Fatalf("invites listed: %v", inv)
	}
	if r := p.b.post("/api/invites/accept", map[string]any{"token": tok}); r.Code != 200 || r.json()["site"].(map[string]any)["status"] != "waiting" {
		t.Fatalf("accept: %d %s", r.Code, r.Body.String())
	}
	stream.wait(t, "event: invite-accepted")
	if r := p.b.post("/api/invites/accept", map[string]any{"token": tok}); r.Code != 400 {
		t.Fatalf("accept twice: %d", r.Code)
	}
	if me := o.b.get("/api/me").json(); me["waitingGrants"] != float64(1) {
		t.Fatalf("waitingGrants: %v", me["waitingGrants"])
	}
	e.clk.Add(3 * time.Minute)
	if body := e.mailBody(ownerEmail, "member-joined"); !strings.Contains(body, "prov@example.test") {
		t.Fatalf("member-joined: %s", body)
	}
	// A waiting member sees the site, only themselves, and no keys.
	g := p.b.get("/api/sites/" + site).json()
	if len(g["members"].([]any)) != 1 || g["invites"] != nil {
		t.Fatalf("waiting view: %v", g)
	}
	if r := p.b.get("/api/sites/" + site + "/keys"); r.Code != 403 {
		t.Fatalf("waiting keys: %d", r.Code)
	}
	// Grant is refused until they have keys.
	o.shareKeys(site, p)
	_, _, _, rseq := o.head(site)
	noKeys := map[string]any{"roster": o.roster(site, rseq+1, 1, rm{o, "owner"}), "wraps": []any{map[string]any{"user": p.id, "epoch": 1, "wrap": o.siteWrap(site, 1, o)["wrap"]}}}
	if r := o.b.post("/api/sites/"+site+"/grant", noKeys); r.Code != 409 || r.json()["error"] != ErrNoKeys {
		t.Fatalf("grant without keys: %d %s", r.Code, r.Body.String())
	}
	p.setupKeys()
	// A roster that leaves the grantee out, or gives them another role.
	bad := []map[string]any{
		{"roster": o.roster(site, rseq+1, 1, rm{o, "owner"}), "wraps": []any{o.siteWrap(site, 1, p)}},
		{"roster": o.roster(site, rseq+1, 1, rm{o, "owner"}, rm{p, "owner"}), "wraps": []any{o.siteWrap(site, 1, p)}},
		{"roster": o.roster(site, rseq+1, 1, rm{o, "owner"}, rm{p, "provider"}), "wraps": []any{map[string]any{"user": p.id, "epoch": 1, "wrap": o.wrap(o.enc.PublicKey().Bytes(), tcrypto.SiteCtx(site, 1, p.id), randBytes(32))}}},
	}
	for i, b := range bad {
		if r := o.b.post("/api/sites/"+site+"/grant", b); r.Code != 422 {
			t.Errorf("bad grant %d: %d %s", i, r.Code, r.Body.String())
		}
	}
	ps := p.b.open()
	defer ps.cancel()
	o.grant(site, p)
	ps.wait(t, "event: granted")
	if e.lastMail("prov@example.test", "granted") == nil {
		t.Fatal("no granted mail")
	}
	if r := p.b.get("/api/sites/" + site + "/keys"); r.Code != 200 || len(r.json()["wraps"].([]any)) != 1 {
		t.Fatalf("keys: %d %s", r.Code, r.Body.String())
	}
	rj := p.b.get("/api/sites/" + site + "/rosters?since=0").json()
	if rs := rj["rosters"].([]any); len(rs) != 2 {
		t.Fatalf("rosters: %d", len(rs))
	}
	// The keys of everyone the rosters name come with them.
	if pubs := rj["pubs"].(map[string]any); len(pubs) != 2 || pubs[o.id].(map[string]any)["sigPub"] != o.sigPub() {
		t.Fatalf("roster pubs: %v", pubs)
	}
	if rs := p.b.get("/api/sites/" + site + "/rosters?since=1").json()["rosters"].([]any); len(rs) != 1 {
		t.Fatalf("rosters since 1: %d", len(rs))
	}
	// Granting a member who is already granted: 409.
	if r := o.grantRaw(site, p); r.Code != 409 {
		t.Fatalf("grant twice: %d", r.Code)
	}
	// Owners see the member list with keys; the members see each other.
	full := p.b.get("/api/sites/" + site).json()
	if len(full["members"].([]any)) != 2 || full["invites"] != nil {
		t.Fatalf("member view: %v", full)
	}
	if inv := o.b.get("/api/sites/" + site).json()["invites"].([]any); len(inv) != 0 {
		t.Fatalf("accepted invite still pending: %v", inv)
	}
	// Inviting an existing member: 409.
	if r := o.b.post("/api/sites/"+site+"/invites", map[string]any{"email": "prov@example.test", "role": "viewer"}); r.Code != 409 {
		t.Fatalf("invite a member: %d", r.Code)
	}
}

func TestInviteExpiryResendCancelAndCaps(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	tok := o.invite(site, "late@example.test", "viewer")
	e.clk.Add(15 * 24 * time.Hour)
	anon := e.browser(nextIP())
	if r := anon.post("/api/invites/peek", map[string]any{"token": tok}); r.Code != 400 {
		t.Fatalf("expired invite peek: %d", r.Code)
	}
	invs := o.b.get("/api/sites/" + site).json()["invites"].([]any)
	if len(invs) != 0 {
		t.Fatal("expired invite listed as pending")
	}
	var iid string
	e.st.R.QueryRow("SELECT id FROM invites WHERE site_id = ?", site).Scan(&iid)
	if r := o.b.post("/api/sites/"+site+"/invites/"+iid+"/resend", map[string]any{}); r.Code != 204 {
		t.Fatalf("resend: %d %s", r.Code, r.Body.String())
	}
	m := e.lastMail("late@example.test", "invite")
	_, tok2, _ := strings.Cut(m.Link, "#invite=")
	if tok2 == tok {
		t.Fatal("resend kept the old token")
	}
	if r := anon.post("/api/invites/peek", map[string]any{"token": tok}); r.Code != 400 {
		t.Fatal("old token still works after a resend")
	}
	if r := anon.post("/api/invites/peek", map[string]any{"token": tok2}); r.Code != 200 {
		t.Fatalf("new token: %d", r.Code)
	}
	// Three emails per invitation per day: the fourth in a day is refused.
	o.b.post("/api/sites/"+site+"/invites/"+iid+"/resend", map[string]any{})
	o.b.post("/api/sites/"+site+"/invites/"+iid+"/resend", map[string]any{})
	if r := o.b.post("/api/sites/"+site+"/invites/"+iid+"/resend", map[string]any{}); r.Code != 429 {
		t.Fatalf("resend cap: %d", r.Code)
	}
	if r := o.b.do("DELETE", "/api/sites/"+site+"/invites/"+iid, nil); r.Code != 204 {
		t.Fatalf("cancel: %d", r.Code)
	}
	if r := anon.post("/api/invites/peek", map[string]any{"token": tok2}); r.Code != 400 {
		t.Fatal("cancelled invite still opens")
	}
	// Five invitation emails to one address per day, from any site.
	for i := 0; i < 5; i++ {
		s := o.createSite()
		code := 201
		if i == 4 {
			code = 429
		}
		if r := o.b.post("/api/sites/"+s+"/invites", map[string]any{"email": "popular@example.test", "role": "viewer"}); r.Code != code {
			t.Fatalf("invite %d: %d", i, r.Code)
		}
		if i == 0 {
			// re-inviting the same pending address replaces the token
			if r := o.b.post("/api/sites/"+s+"/invites", map[string]any{"email": "popular@example.test", "role": "provider"}); r.Code != 201 {
				t.Fatalf("re-invite: %d", r.Code)
			}
		}
	}
	// Peeks are rate-limited per IP.
	for i := 0; i < ipPeeksPerHour+1; i++ {
		r := anon.post("/api/invites/peek", map[string]any{"token": "i_x.y"})
		if i == ipPeeksPerHour && r.Code != 429 {
			t.Fatalf("peek limit: %d", r.Code)
		}
	}
}

func TestRolesRemoveRotateLeaveDelete(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	v := o.join(site, "view@example.test", "viewer")

	// Viewer cannot push or manage; provider cannot manage.
	if r := v.push(site, "doc"); r.Code != 403 {
		t.Fatalf("viewer push: %d", r.Code)
	}
	if r := p.b.post("/api/sites/"+site+"/invites", map[string]any{"email": "x@example.test", "role": "viewer"}); r.Code != 403 {
		t.Fatalf("provider invite: %d", r.Code)
	}
	if r := p.push(site, "doc1"); r.Code != 201 {
		t.Fatalf("provider push: %d %s", r.Code, r.Body.String())
	}

	// Role change: viewer becomes provider (new roster, no rotation).
	_, _, epoch, rseq := o.head(site)
	r := o.b.post("/api/sites/"+site+"/members/"+v.id+"/role", map[string]any{"role": "provider",
		"roster": o.roster(site, rseq+1, epoch, rm{o, "owner"}, rm{p, "provider"}, rm{v, "provider"})})
	if r.Code != 200 {
		t.Fatalf("role: %d %s", r.Code, r.Body.String())
	}
	if r := v.push(site, "doc2"); r.Code != 201 {
		t.Fatalf("new provider push: %d %s", r.Code, r.Body.String())
	}
	// The last owner cannot be demoted.
	_, _, epoch, rseq = o.head(site)
	if r := o.b.post("/api/sites/"+site+"/members/"+o.id+"/role", map[string]any{"role": "viewer",
		"roster": o.roster(site, rseq+1, epoch, rm{o, "viewer"}, rm{p, "provider"}, rm{v, "provider"})}); r.Code != 409 {
		t.Fatalf("demote last owner: %d", r.Code)
	}
	// The last owner cannot leave.
	if r := o.b.post("/api/sites/"+site+"/leave", map[string]any{}); r.Code != 409 || r.json()["error"] != ErrLastOwner {
		t.Fatalf("last owner leaves: %d", r.Code)
	}

	// Remove the provider: the key rotates; every remaining member needs a
	// wrap for the new epoch.
	ps := p.b.open()
	defer ps.cancel()
	_, _, epoch, rseq = o.head(site)
	o.newKey(site, epoch+1)
	missing := map[string]any{"user": p.id, "roster": o.roster(site, rseq+1, epoch+1, rm{o, "owner"}, rm{v, "provider"}),
		"wraps": []any{o.siteWrap(site, epoch+1, o)}, "nameCt": o.nameCt(site, epoch+1)}
	if r := o.b.post("/api/sites/"+site+"/remove", missing); r.Code != 422 {
		t.Fatalf("remove without every wrap: %d %s", r.Code, r.Body.String())
	}
	noName := map[string]any{"user": p.id, "roster": o.roster(site, rseq+1, epoch+1, rm{o, "owner"}, rm{v, "provider"}),
		"wraps": []any{o.siteWrap(site, epoch+1, o), o.siteWrap(site, epoch+1, v)}}
	if r := o.b.post("/api/sites/"+site+"/remove", noName); r.Code != 400 {
		t.Fatalf("remove without re-encrypting the name: %d %s", r.Code, r.Body.String())
	}
	ok := map[string]any{"user": p.id, "roster": o.roster(site, rseq+1, epoch+1, rm{o, "owner"}, rm{v, "provider"}),
		"wraps": []any{o.siteWrap(site, epoch+1, o), o.siteWrap(site, epoch+1, v)}, "nameCt": o.nameCt(site, epoch+1)}
	if r := o.b.post("/api/sites/"+site+"/remove", ok); r.Code != 200 || r.json()["site"].(map[string]any)["epoch"] != float64(2) {
		t.Fatalf("remove: %d %s", r.Code, r.Body.String())
	}
	ps.wait(t, "event: site-removed")
	o.shareKeys(site, v)
	if e.count("SELECT count(*) FROM site_wraps WHERE site_id = ? AND user_id = ?", site, p.id) != 0 {
		t.Fatal("removed member's wraps kept")
	}
	if r := p.b.get("/api/sites/" + site); r.Code != 404 {
		t.Fatalf("removed member sees the site: %d", r.Code)
	}
	n0, h0, e0, r0 := o.head(site)
	if r := p.pushAt(site, n0, h0, e0, r0, "after"); r.Code != 404 {
		t.Fatalf("removed member push: %d", r.Code)
	}
	// A push under the old epoch is refused.
	n, h, _, rseq := o.head(site)
	if r := v.pushAt(site, n, h, 1, rseq, "old epoch"); r.Code != 409 || r.json()["error"] != ErrStaleEpoch {
		t.Fatalf("old epoch push: %d %s", r.Code, r.Body.String())
	}
	if r := v.push(site, "new epoch"); r.Code != 201 {
		t.Fatalf("new epoch push: %d %s", r.Code, r.Body.String())
	}

	// A provider leaves: the owners are told; the next owner action rotates.
	os := o.b.open()
	defer os.cancel()
	if r := v.b.post("/api/sites/"+site+"/leave", map[string]any{}); r.Code != 204 {
		t.Fatalf("leave: %d", r.Code)
	}
	os.wait(t, "event: roster-needed")
	_, _, epoch, rseq = o.head(site)
	o.newKey(site, epoch+1)
	if r := o.b.post("/api/sites/"+site+"/rotate", map[string]any{"roster": o.roster(site, rseq+1, epoch+1, rm{o, "owner"}),
		"wraps": []any{o.siteWrap(site, epoch+1, o)}, "nameCt": o.nameCt(site, epoch+1)}); r.Code != 200 {
		t.Fatalf("rotate: %d %s", r.Code, r.Body.String())
	}
	// A second owner via role, then delete: everyone is told.
	w := o.join(site, "second@example.test", "viewer")
	ws := w.b.open()
	defer ws.cancel()
	if r := o.b.do("DELETE", "/api/sites/"+site, nil); r.Code != 204 {
		t.Fatalf("delete: %d", r.Code)
	}
	ws.wait(t, "event: site-removed")
	if e.count("SELECT count(*) FROM revisions WHERE site_id = ?", site)+e.count("SELECT count(*) FROM rev_bodies WHERE site_id = ?", site) != 0 {
		t.Fatal("revisions kept after delete")
	}
	if r := w.b.get("/api/sites/" + site); r.Code != 404 {
		t.Fatalf("deleted site: %d", r.Code)
	}
}

func TestSiteNameSettingAndMute(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	r := o.b.do("PATCH", "/api/sites/"+site, map[string]any{"showName": true, "nameClear": "Main\r\nBcc: x@evil.test office"})
	if r.Code != 200 {
		t.Fatalf("patch: %d %s", r.Code, r.Body.String())
	}
	nc := r.json()["site"].(map[string]any)["nameClear"]
	if nc != "Main Bcc: x@evil.test office" {
		t.Fatalf("clear name not cleaned: %q", nc)
	}
	o.invite(site, "named@example.test", "viewer")
	if m := e.lastMail("named@example.test", "invite"); !strings.Contains(m.Subject, "Main") {
		t.Fatalf("subject without the allowed name: %q", m.Subject)
	}
	r = o.b.do("PATCH", "/api/sites/"+site, map[string]any{"showName": false})
	if r.json()["site"].(map[string]any)["nameClear"] != nil {
		t.Fatal("name kept in clear after turning it off")
	}
	if e.count("SELECT count(*) FROM sites WHERE id = ? AND name_clear IS NOT NULL", site) != 0 {
		t.Fatal("name_clear stored after turning it off")
	}
	// A nameCt for the wrong epoch is refused.
	bad := o.nameCt(site, 1)
	bad["epoch"] = 2
	if r := o.b.do("PATCH", "/api/sites/"+site, map[string]any{"nameCt": bad}); r.Code != 409 {
		t.Fatalf("name for another epoch: %d", r.Code)
	}
	if r := o.b.do("PATCH", "/api/sites/"+site+"/me", map[string]any{"muted": true}); r.Code != 200 || r.json()["site"].(map[string]any)["muted"] != true {
		t.Fatalf("mute: %d %s", r.Code, r.Body.String())
	}
	var raw json.RawMessage
	_ = raw
}
