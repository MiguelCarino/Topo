package api

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"carino.systems/topo/server/internal/tcrypto"
)

func TestKeySetupAndDevices(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	p := e.signedIn(ownerEmail, "")
	// Keys need a device bound to the session.
	if r := p.b.get("/api/me/escrow"); r.Code != 403 {
		t.Fatalf("escrow without keys: %d", r.Code)
	}
	p.setupKeys()
	me := p.b.get("/api/me").json()
	if me["keys"] == nil || me["hasEscrow"] != true || me["device"].(map[string]any)["linked"] != true {
		t.Fatalf("me after setup: %v", me)
	}
	if r := p.putKeys(false); r.Code != 409 {
		t.Fatalf("second setup without reset: %d", r.Code)
	}
	devs := p.b.get("/api/devices").json()["devices"].([]any)
	if len(devs) != 1 || devs[0].(map[string]any)["current"] != true || devs[0].(map[string]any)["linked"] != true {
		t.Fatalf("devices: %v", devs)
	}
	if r := p.b.get("/api/devices/" + p.devID + "/wrap"); r.Code != 200 || r.json()["wrappedBy"] != "setup" {
		t.Fatalf("own wrap: %d %s", r.Code, r.Body.String())
	}
	if r := p.b.get("/api/me/escrow"); r.Code != 200 || r.json()["escrow"].(map[string]any)["kdf"] != "HKDF-SHA256" {
		t.Fatalf("escrow: %d", r.Code)
	}
	if r := p.b.do("PUT", "/api/me/escrow", map[string]any{"escrow": map[string]any{"v": 2}}); r.Code != 400 {
		t.Fatalf("bad escrow: %d", r.Code)
	}
	if r := p.b.do("PUT", "/api/me/escrow", map[string]any{"escrow": escrow()}); r.Code != 204 {
		t.Fatalf("new escrow: %d", r.Code)
	}

	// Someone else cannot read my device's wrap.
	q := e.newPerson("staff@example.test", "staff")
	if r := q.b.get("/api/devices/" + p.devID + "/wrap"); r.Code != 404 {
		t.Fatalf("foreign wrap: %d", r.Code)
	}

	// A device wrap with the wrong ctx, recipient or signer is refused.
	x := e.signedIn("member@example.test", "member")
	x.addDevice()
	x.enc, _ = ecdh.P256().GenerateKey(rand.Reader)
	x.sig = q.sig // signs with someone else's key but claims to be x
	bad := []json.RawMessage{
		x.wrap(x.dev.PublicKey().Bytes(), tcrypto.DeviceCtx(x.id, "d_other"), []byte("bundle")),
		x.wrap(q.dev.PublicKey().Bytes(), tcrypto.DeviceCtx(x.id, x.devID), []byte("bundle")),
	}
	for i, w := range bad {
		r := x.b.do("PUT", "/api/me/keys", map[string]any{"encPub": x.encPub(), "sigPub": x.sigPub(), "deviceWrap": w})
		if r.Code != 422 {
			t.Fatalf("bad wrap %d: %d %s", i, r.Code, r.Body.String())
		}
	}
	// Signed with a key that is not the sigPub sent: refused.
	x.sig = p.sig
	w := x.wrap(x.dev.PublicKey().Bytes(), tcrypto.DeviceCtx(x.id, x.devID), []byte("bundle"))
	if r := x.b.do("PUT", "/api/me/keys", map[string]any{"encPub": x.encPub(), "sigPub": q.sigPub(), "deviceWrap": w}); r.Code != 422 || r.json()["error"] != ErrBadSignature {
		t.Fatalf("foreign signature: %d %s", r.Code, r.Body.String())
	}

	// Deleting a device ends its sessions.
	sid := p.b.get("/api/me/sessions").json()["sessions"].([]any)[0].(map[string]any)["id"].(string)
	if r := p.b.do("DELETE", "/api/devices/"+p.devID, nil); r.Code != 204 {
		t.Fatalf("delete device: %d", r.Code)
	}
	if !e.wasClosed(sid) {
		t.Fatal("the device's session was not closed")
	}
	if r := p.b.get("/api/me"); r.Code != 401 {
		t.Fatalf("session after its device was deleted: %d", r.Code)
	}
}

func TestDeviceLinking(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	a := e.newPerson(ownerEmail, "")
	// A second browser of the same person.
	b := &person{e: e, b: e.browser(nextIP()), email: ownerEmail, id: a.id, enc: a.enc, sig: a.sig, keys: map[string]map[int64][]byte{}}
	b.b.signIn(ownerEmail)
	b.addDevice()
	if me := b.b.get("/api/me").json(); me["device"].(map[string]any)["linked"] != false || me["keys"] == nil {
		t.Fatalf("new browser: %v", me)
	}
	// Nobody else online: the request is also emailed.
	r := b.b.post("/api/link-requests", map[string]any{})
	if r.Code != 201 {
		t.Fatalf("link request: %d %s", r.Code, r.Body.String())
	}
	id := r.json()["id"].(string)
	if e.lastMail(ownerEmail, "link-request") == nil {
		t.Fatal("no link-request mail")
	}
	// A second request within 15 minutes sends no second email.
	b.b.post("/api/link-requests", map[string]any{})
	n := 0
	for _, m := range e.mails() {
		if m.Kind == "link-request" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("link-request mails: %d", n)
	}
	reqs := a.b.get("/api/link-requests").json()["requests"].([]any)
	if len(reqs) != 1 {
		t.Fatalf("pending requests: %v", reqs)
	}
	id = reqs[0].(map[string]any)["id"].(string)
	if reqs[0].(map[string]any)["devPub"] != b64(b.dev.PublicKey().Bytes()) {
		t.Fatal("devPub")
	}
	// The unlinked browser cannot approve itself.
	selfWrap := b.wrap(b.dev.PublicKey().Bytes(), tcrypto.DeviceCtx(b.id, b.devID), []byte("bundle"))
	if r := b.b.post("/api/link-requests/"+id+"/approve", map[string]any{"wrap": selfWrap}); r.Code != 403 {
		t.Fatalf("unlinked approver: %d", r.Code)
	}
	stream := b.b.open()
	// A wrap addressed to the wrong device is refused.
	wrong := a.wrap(a.dev.PublicKey().Bytes(), tcrypto.DeviceCtx(a.id, b.devID), []byte("bundle"))
	if r := a.b.post("/api/link-requests/"+id+"/approve", map[string]any{"wrap": wrong}); r.Code != 422 {
		t.Fatalf("wrong recipient: %d", r.Code)
	}
	good := a.wrap(b.dev.PublicKey().Bytes(), tcrypto.DeviceCtx(a.id, b.devID), []byte("bundle"))
	if r := a.b.post("/api/link-requests/"+id+"/approve", map[string]any{"wrap": good}); r.Code != 204 {
		t.Fatalf("approve: %d %s", r.Code, r.Body.String())
	}
	stream.wait(t, "event: link-approved")
	stream.cancel()
	if r := b.b.get("/api/devices/" + b.devID + "/wrap"); r.Code != 200 || r.json()["wrappedBy"] != a.devID {
		t.Fatalf("linked wrap: %d %s", r.Code, r.Body.String())
	}
	if r := a.b.post("/api/link-requests/"+id+"/approve", map[string]any{"wrap": good}); r.Code != 404 {
		t.Fatalf("second approve: %d", r.Code)
	}
	if r := b.b.post("/api/link-requests", map[string]any{}); r.Code != 409 {
		t.Fatalf("request from a linked device: %d", r.Code)
	}

	// A third browser recovers with the code instead (self-wrap), and a
	// denied request is gone.
	c := &person{e: e, b: e.browser(nextIP()), email: ownerEmail, id: a.id, enc: a.enc, sig: a.sig}
	c.b.signIn(ownerEmail)
	c.addDevice()
	id3 := c.b.post("/api/link-requests", map[string]any{}).json()["id"].(string)
	if r := a.b.post("/api/link-requests/"+id3+"/deny", map[string]any{}); r.Code != 204 {
		t.Fatalf("deny: %d", r.Code)
	}
	if r := c.b.post("/api/me/devices/self-wrap", map[string]any{"wrap": c.wrap(c.dev.PublicKey().Bytes(), tcrypto.DeviceCtx(c.id, c.devID), []byte("bundle"))}); r.Code != 204 {
		t.Fatalf("self-wrap: %d %s", r.Code, r.Body.String())
	}
	if r := c.b.get("/api/devices/" + c.devID + "/wrap"); r.json()["wrappedBy"] != "recovery" {
		t.Fatal("self-wrap not recorded as recovery")
	}

	// Expired requests are not listed.
	d := &person{e: e, b: e.browser(nextIP()), email: ownerEmail, id: a.id, enc: a.enc, sig: a.sig}
	d.b.signIn(ownerEmail)
	d.addDevice()
	d.b.post("/api/link-requests", map[string]any{})
	e.clk.Add(16 * time.Minute)
	if reqs := a.b.get("/api/link-requests").json()["requests"].([]any); len(reqs) != 0 {
		t.Fatalf("expired request listed: %v", reqs)
	}
}

func TestResetKeys(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	if e.roleOf(site, p.id) != "provider" {
		t.Fatal("setup")
	}
	ownerStream := o.b.open()
	defer ownerStream.cancel()
	// A stolen browser still signed in as the provider (finding: a reset
	// must sign every other session out).
	stolen := e.browser(nextIP())
	stolen.signIn("prov@example.test")
	stolenStream := stolen.open()
	defer stolenStream.cancel()
	if r := stolen.get("/api/me"); r.Code != 200 {
		t.Fatalf("second session: %d", r.Code)
	}
	// The provider lost everything and resets.
	p.addDevice()
	p.enc, _ = ecdh.P256().GenerateKey(rand.Reader)
	if r := p.putKeys(true); r.Code != 200 {
		t.Fatalf("reset: %d %s", r.Code, r.Body.String())
	}
	if e.count("SELECT count(*) FROM site_wraps WHERE user_id = ?", p.id) != 0 {
		t.Fatal("site wraps kept after a reset")
	}
	if r := stolen.get("/api/me"); r.Code != 401 {
		t.Fatalf("other session after a reset: %d", r.Code)
	}
	if r := p.b.get("/api/me"); r.Code != 200 {
		t.Fatalf("resetting session after a reset: %d", r.Code)
	}
	if !stolenStream.ended() {
		t.Fatal("other session's live stream kept after a reset")
	}
	if e.count("SELECT count(*) FROM members WHERE user_id = ? AND status = 'waiting'", p.id) != 1 {
		t.Fatal("membership not waiting after a reset")
	}
	if e.count("SELECT count(*) FROM devices WHERE user_id = ? AND wrap IS NOT NULL", p.id) != 1 {
		t.Fatal("other devices still linked")
	}
	ownerStream.wait(t, "event: keys-changed")
	e.clk.Add(3 * time.Minute)
	body := e.mailBody(ownerEmail, "member-joined")
	if !strings.Contains(body, "their keys changed") {
		t.Fatalf("member-joined (keys) body: %s", body)
	}
	// The provider can no longer push or read until granted again.
	n, h, ep, rs := o.head(site)
	if r := p.pushAt(site, n, h, ep, rs, "x"); r.Code != 403 {
		t.Fatalf("push while waiting: %d", r.Code)
	}
	if r := p.b.get("/api/sites/" + site + "/keys"); r.Code != 403 {
		t.Fatalf("keys while waiting: %d", r.Code)
	}
	// The owner grants again with the new keys.
	o.grant(site, p)
	if r := p.b.get("/api/sites/" + site + "/keys"); r.Code != 200 || len(r.json()["wraps"].([]any)) != 1 {
		t.Fatalf("keys after re-grant: %d %s", r.Code, r.Body.String())
	}
}

// A member who reset their keys waits, but the roster in force still names
// them and their old browser may hold the current key: removing them
// rotates, like removing a granted member.
func TestRemoveResetMemberRotates(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	p.addDevice()
	p.enc, _ = ecdh.P256().GenerateKey(rand.Reader)
	if r := p.putKeys(true); r.Code != 200 {
		t.Fatalf("reset: %d %s", r.Code, r.Body.String())
	}
	_, _, epoch, rseq := o.head(site)
	if r := o.b.post("/api/sites/"+site+"/remove", map[string]any{"user": p.id}); r.Code == 200 {
		t.Fatal("a reset member was removed without a rotation")
	}
	if _, _, ep, _ := o.head(site); ep != epoch {
		t.Fatalf("epoch moved on a refused removal: %d", ep)
	}
	o.newKey(site, epoch+1)
	r := o.b.post("/api/sites/"+site+"/remove", map[string]any{"user": p.id, "roster": o.roster(site, rseq+1, epoch+1, rm{o, "owner"}),
		"wraps": []any{o.siteWrap(site, epoch+1, o)}, "nameCt": o.nameCt(site, epoch+1)})
	if r.Code != 200 || r.json()["site"].(map[string]any)["epoch"] != float64(epoch+1) {
		t.Fatalf("remove with rotation: %d %s", r.Code, r.Body.String())
	}
	// A waiting member never granted (not in any roster) still goes without one.
	tok := o.invite(site, "late@example.test", "viewer")
	v := e.signedIn("late@example.test", "")
	if r := v.b.post("/api/invites/accept", map[string]any{"token": tok}); r.Code != 200 {
		t.Fatalf("accept: %d %s", r.Code, r.Body.String())
	}
	if r := o.b.post("/api/sites/"+site+"/remove", map[string]any{"user": v.id}); r.Code != 200 {
		t.Fatalf("remove never-granted waiting member: %d %s", r.Code, r.Body.String())
	}
}
