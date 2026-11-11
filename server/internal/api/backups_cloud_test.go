package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/backup/backuptest"
	"carino.systems/topo/server/internal/store"
)

// 5c through the API (D110, D111): S3 saved and written by the engine;
// Connect for OneDrive and Google Drive end to end against local fakes
// (state bound to the session, single use, 10 minutes; PKCE; the refresh
// token sealed and never returned; a rotated one saved by the engine).

func TestBackupS3ThroughAPI(t *testing.T) {
	e := newBackupEnv(t)
	o := e.newPerson(ownerEmail, "")
	fake := backuptest.NewS3("AKIDAPI", "sekret", "us-east-1", "bk")
	fake.Now = e.clk.Now
	srv := httptest.NewServer(fake)
	defer srv.Close()
	body := map[string]any{"enabled": true, "kind": "s3", "fields": map[string]string{"endpoint": srv.URL, "bucket": "bk", "keyId": "AKIDAPI", "pathStyle": "1"},
		"secrets": map[string]string{"secret": "wrong"}}
	if r := o.b.do("PUT", "/api/admin/backups", body); r.Code != 422 || r.json()["code"] != backup.CodeRefused {
		t.Fatalf("a wrong secret fails the check: %d %s", r.Code, r.Body.String())
	}
	body["secrets"] = map[string]string{"secret": "sekret"}
	r := o.b.do("PUT", "/api/admin/backups", body)
	if r.Code != 200 || strings.Contains(r.Body.String(), "sekret") {
		t.Fatalf("save: %d %s", r.Code, r.Body.String())
	}
	cfg := r.json()["config"].(map[string]any)
	if cfg["fields"].(map[string]any)["prefix"] != "topo/" || len(cfg["secretsSet"].([]any)) != 1 {
		t.Fatalf("saved: %v", cfg)
	}
	site := o.createSite()
	o.push(site, "a")
	e.tick()
	keys := fake.Keys()
	if len(keys) != 1 || !strings.HasPrefix(keys[0], "topo/"+site+"/topo_") {
		t.Fatalf("the backup is in the bucket: %v", keys)
	}
	if b, _ := fake.Object(keys[0]); !bytes.Contains(b, []byte(`"topo-backup"`)) {
		t.Fatalf("a topo-backup file: %.80s", b)
	}
	// Download goes through the destination.
	list := o.b.get("/api/sites/" + site + "/backups").json()["backups"].([]any)
	id := list[0].(map[string]any)["id"].(string)
	if r := o.b.get("/api/sites/" + site + "/backups/" + id); r.Code != 200 || !strings.Contains(r.Body.String(), "topo-backup") {
		t.Fatalf("download: %d", r.Code)
	}
	// Changing the key id without typing the secret again clears it.
	body["fields"].(map[string]string)["keyId"] = "AKIDOTHER"
	delete(body, "secrets")
	if r := o.b.do("POST", "/api/admin/backups/test", body); r.Code != 422 {
		t.Fatalf("a new key id without its secret: %d %s", r.Code, r.Body.String())
	}
}

// cloudEnv is a backup env with a fake provider (OneDrive or Drive) on the
// swapped endpoints.
type cloudEnv struct {
	*backupEnv
	auth  *backuptest.OAuth
	graph *backuptest.Graph
	drive *backuptest.Drive
	owner *person
}

func newCloudEnv(t *testing.T, kind string) *cloudEnv {
	e := &cloudEnv{backupEnv: newBackupEnv(t), auth: backuptest.NewOAuth("app-1", "app-secret")}
	e.auth.Now = e.clk.Now
	mux := http.NewServeMux()
	mux.Handle("/common/token", e.auth)
	mux.Handle("/token", e.auth)
	var ep backup.Endpoints
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	if kind == "onedrive" {
		e.graph = backuptest.NewGraph(e.auth)
		other := httptest.NewServer(e.graph.Other())
		t.Cleanup(other.Close)
		e.graph.OtherBase = other.URL
		mux.Handle("/", e.graph)
		ep = backup.Endpoints{Auth: "https://login.example.test/{tenant}/authorize", Token: srv.URL + "/{tenant}/token", API: srv.URL + "/v1.0"}
	} else {
		e.drive = backuptest.NewDrive(e.auth)
		mux.Handle("/", e.drive)
		ep = backup.Endpoints{Auth: "https://accounts.example.test/auth", Token: srv.URL + "/token", API: srv.URL + "/drive/v3", Upload: srv.URL + "/upload/drive/v3"}
	}
	t.Cleanup(backup.SwapEndpoints(kind, ep))
	e.owner = e.newPerson(ownerEmail, "")
	return e
}

// start posts Connect and returns the provider's sign-in address.
func (e *cloudEnv) start(b *browser, kind string) string {
	e.t.Helper()
	r := b.post("/api/admin/backups/oauth/start", map[string]any{"enabled": true, "kind": kind, "fields": map[string]string{"clientId": "app-1"},
		"secrets": map[string]string{"clientSecret": "app-secret"}})
	if r.Code != 200 {
		e.t.Fatalf("start: %d %s", r.Code, r.Body.String())
	}
	return r.json()["url"].(string)
}

// callback plays the provider sending the browser back: the callback's
// redirect, and the fragment's state and code.
func (e *cloudEnv) callback(b *browser, authURL string) map[string]any {
	e.t.Helper()
	back, err := e.auth.Authorize(authURL)
	if err != nil {
		e.t.Fatal(err)
	}
	u, _ := url.Parse(back)
	r := b.get(u.Path + "?" + u.RawQuery)
	loc := r.Header().Get("Location")
	if r.Code != 303 || !strings.HasPrefix(loc, "/#backup-connect=") {
		e.t.Fatalf("callback: %d %q", r.Code, loc)
	}
	raw, _ := url.QueryUnescape(strings.TrimPrefix(loc, "/#backup-connect="))
	v, _ := url.ParseQuery(raw)
	return map[string]any{"state": v.Get("state"), "code": v.Get("code")}
}

func TestBackupConnectOneDrive(t *testing.T) {
	e := newCloudEnv(t, "onedrive")
	e.auth.Rotate = true
	o := e.owner
	// Only for OAuth kinds, with a client secret.
	if r := o.b.post("/api/admin/backups/oauth/start", map[string]any{"kind": "webdav", "fields": map[string]string{"url": "https://dav.example.test/", "user": "a"}}); r.Code != 400 || r.json()["error"] != ErrOAuthKind {
		t.Fatalf("webdav: %d %s", r.Code, r.Body.String())
	}
	if r := o.b.post("/api/admin/backups/oauth/start", map[string]any{"kind": "onedrive", "fields": map[string]string{"clientId": "app-1"}}); r.Code != 400 || r.json()["field"] != "clientSecret" {
		t.Fatalf("no secret: %d %s", r.Code, r.Body.String())
	}
	member := e.newPerson("m@example.test", "member")
	if r := member.b.post("/api/admin/backups/oauth/start", map[string]any{}); r.Code != 403 {
		t.Fatalf("a member: %d", r.Code)
	}
	o.b.ip = "127.0.0.1" // on the server machine itself
	au := e.start(o.b, "onedrive")
	pu, _ := url.Parse(au)
	if pu.Host != "login.example.test" || !strings.HasPrefix(pu.Path, "/common/") || pu.Query().Get("redirect_uri") != "http://localhost:7380"+oauthCallbackPath {
		t.Fatalf("sign-in address (loopback: http://localhost redirect): %s", au)
	}
	// The callback changes nothing and needs no session.
	stranger := e.browser("127.0.0.1")
	fin := e.callback(stranger, au)
	// Another session cannot finish it, and that spends the state.
	other := e.newPerson("owner2@example.test", "owner")
	if r := other.b.post("/api/admin/backups/oauth/finish", fin); r.Code != 400 || r.json()["error"] != ErrOAuthState {
		t.Fatalf("another session: %d %s", r.Code, r.Body.String())
	}
	if r := o.b.post("/api/admin/backups/oauth/finish", fin); r.Code != 400 {
		t.Fatalf("a spent state: %d", r.Code)
	}
	// Ten minutes is too late.
	au = e.start(o.b, "onedrive")
	fin = e.callback(stranger, au)
	e.clk.Add(11 * time.Minute)
	if r := o.b.post("/api/admin/backups/oauth/finish", fin); r.Code != 400 || r.json()["error"] != ErrOAuthState {
		t.Fatalf("expired: %d", r.Code)
	}
	// The owner said no.
	au = e.start(o.b, "onedrive")
	fin = e.callback(stranger, au)
	if r := o.b.post("/api/admin/backups/oauth/finish", map[string]any{"state": fin["state"], "error": "access_denied"}); r.Code != 422 || r.json()["error"] != ErrOAuthDenied {
		t.Fatalf("denied: %d %s", r.Code, r.Body.String())
	}
	// Yes.
	au = e.start(o.b, "onedrive")
	fin = e.callback(stranger, au)
	r := o.b.post("/api/admin/backups/oauth/finish", fin)
	if r.Code != 200 {
		t.Fatalf("finish: %d %s", r.Code, r.Body.String())
	}
	j := r.json()
	cfg := j["config"].(map[string]any)
	if cfg["connected"] != true || cfg["account"] != "Ana Example" || cfg["enabled"] != true || cfg["kind"] != "onedrive" || j["connect"].(map[string]any)["code"] != nil {
		t.Fatalf("connected: %s", r.Body.String())
	}
	for _, tok := range e.auth.RefreshTokens() {
		if strings.Contains(r.Body.String(), tok) || strings.Contains(o.b.get("/api/admin/backups").Body.String(), tok) {
			t.Fatal("the refresh token reached the browser")
		}
	}
	if strings.Contains(r.Body.String(), "app-secret") {
		t.Fatal("the client secret reached the browser")
	}
	// The engine writes there.
	site := o.createSite()
	o.push(site, "a")
	e.tick()
	files := e.graph.Files()
	if len(files) != 1 || !strings.HasPrefix(files[0], site+"/topo_") {
		t.Fatalf("written to the app folder: %v", files)
	}
	// A rotated refresh token is sealed and saved by the engine.
	before := e.auth.RefreshTokens()
	e.auth.ExpireAccess()
	o.push(site, "b")
	e.clk.Add(2 * time.Minute)
	e.tick()
	if len(e.graph.Files()) != 2 {
		t.Fatalf("second backup: %v", e.graph.Files())
	}
	c, _ := store.GetBackupConfig(context.Background(), e.st.R)
	saved, err := backup.SavedSettings(c, []byte("k0123456789abcdef0123456789abcde"))
	now := e.auth.RefreshTokens()
	if err != nil || len(now) != 1 || saved.Secrets["refreshToken"] != now[0] || now[0] == before[0] {
		t.Fatalf("rotated token saved: %v %v %v", err, saved.Secrets["refreshToken"] == now[0], now)
	}
	// Saving again (same app) keeps the sign-in.
	if r := o.b.do("PUT", "/api/admin/backups", map[string]any{"enabled": true, "kind": "onedrive", "fields": map[string]string{"clientId": "app-1", "tenant": "common"}}); r.Code != 200 || r.json()["config"].(map[string]any)["connected"] != true {
		t.Fatalf("save keeps the sign-in: %d %s", r.Code, r.Body.String())
	}
	// Another app id: the sign-in is gone, Connect again.
	r = o.b.do("PUT", "/api/admin/backups?force=1", map[string]any{"enabled": true, "kind": "onedrive", "fields": map[string]string{"clientId": "app-2"}, "secrets": map[string]string{"clientSecret": "x"}})
	if r.Code != 200 || r.json()["config"].(map[string]any)["connected"] == true {
		t.Fatalf("another app: %d %s", r.Code, r.Body.String())
	}
	if r := o.b.post("/api/admin/backups/test", map[string]any{}); r.Code != 422 || r.json()["code"] != backup.CodeConnect {
		t.Fatalf("not connected: %d %s", r.Code, r.Body.String())
	}
}

func TestBackupConnectDrive(t *testing.T) {
	e := newCloudEnv(t, "gdrive")
	o := e.owner
	au := e.start(o.b, "gdrive")
	if q, _ := url.Parse(au); q.Query().Get("access_type") != "offline" || q.Query().Get("scope") != "https://www.googleapis.com/auth/drive.file" {
		t.Fatalf("Drive sign-in: %s", au)
	}
	// From another machine the public address is the redirect.
	far := e.newPerson("owner3@example.test", "owner")
	far.b.ip = "192.0.2.10"
	au2 := e.start(far.b, "gdrive")
	if q, _ := url.Parse(au2); q.Query().Get("redirect_uri") != e.origin+oauthCallbackPath {
		t.Fatalf("redirect off this machine: %s", au2)
	}
	fin := e.callback(o.b, au)
	r := o.b.post("/api/admin/backups/oauth/finish", fin)
	if r.Code != 200 || r.json()["config"].(map[string]any)["account"] != "ana@example.test" {
		t.Fatalf("finish: %d %s", r.Code, r.Body.String())
	}
	c, _ := store.GetBackupConfig(context.Background(), e.st.R)
	folder := backup.ParseRef(c.OAuthRef).Folder
	if folder == "" || len(e.drive.Find("Topo", "root")) != 1 {
		t.Fatalf("the Topo folder made and remembered: %q", c.OAuthRef)
	}
	site := o.createSite()
	o.push(site, "a")
	e.tick()
	rows, _ := store.SiteBackups(context.Background(), e.st.R, site, "enc", c.ConfigID)
	if len(rows) != 1 || rows[0].Ref == "" || !strings.HasPrefix(e.drive.Path(rows[0].Ref), "Topo/"+site+"/topo_") {
		t.Fatalf("written by id: %+v", rows)
	}
	// Connect again with the same app keeps the destination and its files.
	fin = e.callback(o.b, e.start(o.b, "gdrive"))
	if r := o.b.post("/api/admin/backups/oauth/finish", fin); r.Code != 200 {
		t.Fatalf("again: %d", r.Code)
	}
	c2, _ := store.GetBackupConfig(context.Background(), e.st.R)
	if c2.ConfigID != c.ConfigID || backup.ParseRef(c2.OAuthRef).Folder != folder {
		t.Fatalf("same destination: %s %s", c2.ConfigID, c2.OAuthRef)
	}
	// The sign-in revoked: the run fails with "connect" and mails once.
	e.auth.ExpireAccess()
	e.auth.FailRefresh = "invalid_grant"
	o.push(site, "b")
	e.clk.Add(3 * time.Minute)
	e.tick()
	st, _ := store.GetBackupState(context.Background(), e.st.R)
	if st.LastErr != backup.CodeConnect {
		t.Fatalf("status: %q", st.LastErr)
	}
	sent := 0
	for _, m := range e.mails() {
		if m.Kind == "backup-failed" && m.To == ownerEmail {
			sent++
		}
	}
	if sent != 1 {
		t.Fatalf("one failure mail to the owner: %d", sent)
	}
}
