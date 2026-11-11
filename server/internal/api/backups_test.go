package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/backup/backuptest"
	"carino.systems/topo/server/internal/store"
)

// backupEnv is the auth env with a backup engine on the same clock, the
// allowed root a temporary folder.
type backupEnv struct {
	*aenv
	eng  *backup.Engine
	root string
}

func newBackupEnv(t *testing.T) *backupEnv {
	t.Helper()
	root := t.TempDir()
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail, "TOPO_BACKUP_FOLDERS="+root)
	key := []byte("k0123456789abcdef0123456789abcde")
	eng := backup.New(backup.Options{Store: e.st, Key: key, Origin: e.origin, Roots: e.cfg.BackupFolders, Debounce: time.Minute, Now: e.clk.Now, Loc: time.UTC})
	app, _ := LoadApp(testFS())
	e.srv = New(Deps{Cfg: e.cfg, Store: e.st, App: app, Version: "0.0.1", Now: e.clk.Now, Key: key, Hub: e.hub, Wake: func() {}, Backups: eng,
		CloseSessions: func(ids []string) { e.hub.CloseSessions(ids) }})
	return &backupEnv{aenv: e, eng: eng, root: root}
}

func (e *backupEnv) tick() {
	e.t.Helper()
	if err := e.eng.Tick(context.Background()); err != nil {
		e.t.Fatal(err)
	}
}

func TestBackupSettings(t *testing.T) {
	e := newBackupEnv(t)
	o := e.newPerson(ownerEmail, "")
	if r := o.b.get("/api/admin/backups"); r.Code != 200 {
		t.Fatalf("owner GET: %d %s", r.Code, r.Body.String())
	}
	member := e.newPerson("m@example.test", "member")
	for _, p := range []string{"/api/admin/backups"} {
		if r := member.b.get(p); r.Code != 403 {
			t.Fatalf("member GET %s: %d", p, r.Code)
		}
		if r := member.b.do("PUT", p, map[string]any{}); r.Code != 403 {
			t.Fatalf("member PUT: %d", r.Code)
		}
	}
	for _, p := range []string{"/api/admin/backups/test", "/api/admin/backups/run", "/api/admin/backups/check"} {
		if r := member.b.post(p, map[string]any{}); r.Code != 403 {
			t.Fatalf("member %s: %d", p, r.Code)
		}
		if r := o.b.do("POST", p, map[string]any{}, "X-Topo", ""); r.Code != 403 || r.json()["error"] != ErrCSRF {
			t.Fatalf("%s without X-Topo: %d", p, r.Code)
		}
	}
	// Off: Back up now says so.
	if r := o.b.post("/api/admin/backups/run", nil); r.Code != 409 || r.json()["error"] != ErrBackupOff {
		t.Fatalf("run while off: %d %s", r.Code, r.Body.String())
	}
	put := func(body map[string]any, q string) resp { return o.b.do("PUT", "/api/admin/backups"+q, body) }
	if r := put(map[string]any{"enabled": true, "kind": "tape"}, ""); r.Code != 400 {
		t.Fatalf("unknown kind: %d", r.Code)
	}
	if r := put(map[string]any{"enabled": true, "kind": "folder", "fields": map[string]string{"path": t.TempDir()}}, ""); r.Code != 422 || r.json()["error"] != ErrBackupFolder {
		t.Fatalf("outside the roots: %d %s", r.Code, r.Body.String())
	}
	if r := put(map[string]any{"enabled": true, "kind": "folder", "fields": map[string]string{"path": "/etc/../" + e.root}}, ""); r.Code == 200 && !strings.Contains(r.Body.String(), e.root) {
		t.Fatalf("cleaned path: %s", r.Body.String())
	}
	dir := filepath.Join(e.root, "usb")
	// The disk is not there: the check fails, nothing is saved...
	r := put(map[string]any{"enabled": true, "kind": "folder", "fields": map[string]string{"path": dir}, "dailyAt": "03:15"}, "")
	if r.Code != 422 || r.json()["error"] != ErrBackupDest || r.json()["code"] != "not-found" {
		t.Fatalf("no folder: %d %s", r.Code, r.Body.String())
	}
	// ...unless forced (a disk plugged in later).
	if r := put(map[string]any{"enabled": true, "kind": "folder", "fields": map[string]string{"path": dir}, "dailyAt": "03:15"}, "?force=1"); r.Code != 200 {
		t.Fatalf("force: %d %s", r.Code, r.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, backup.MarkerName)); err == nil {
		t.Fatal("a forced save wrote a marker")
	}
	if st := o.b.get("/api/admin/backups").json()["status"].(map[string]any); st["markerOwed"] != true {
		t.Fatalf("a forced save owes the marker: %v", st)
	}
	os.Mkdir(dir, 0o700)
	// The disk is plugged in: saving again (nothing changed) writes the owed marker.
	r = put(map[string]any{"enabled": true}, "")
	if r.Code != 200 {
		t.Fatalf("save: %d %s", r.Code, r.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, backup.MarkerName)); err != nil {
		t.Fatal("no marker after a save")
	}
	if st := r.json()["status"].(map[string]any); st["markerOwed"] != false {
		t.Fatalf("marker still owed: %v", st)
	}
	// Unplugged later (an empty mount point): saving an unchanged folder
	// fails and writes no marker on the system disk (amendment 13).
	os.RemoveAll(dir)
	os.Mkdir(dir, 0o700)
	if r := put(map[string]any{"dailyAt": "03:15"}, ""); r.Code != 422 || r.json()["code"] != "not-found" {
		t.Fatalf("unchanged folder without its marker: %d %s", r.Code, r.Body.String())
	}
	if r := o.b.post("/api/admin/backups/test", map[string]any{}); r.Code != 422 {
		t.Fatalf("test of an unplugged disk: %d %s", r.Code, r.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, backup.MarkerName)); err == nil {
		t.Fatal("a save wrote a marker into an empty mount point")
	}
	os.WriteFile(filepath.Join(dir, backup.MarkerName), []byte("{}\n"), 0o600)
	cfg := r.json()["config"].(map[string]any)
	if cfg["kind"] != "folder" || cfg["dailyAt"] != "03:15" || cfg["fields"].(map[string]any)["path"] != dir {
		t.Fatalf("config %v", cfg)
	}
	if r := put(map[string]any{"dailyAt": "25:00"}, ""); r.Code != 400 {
		t.Fatalf("bad time: %d", r.Code)
	}
	info := o.b.get("/api/admin/info").json()
	if b := info["backups"].(map[string]any); b["on"] != true || b["kind"] != "folder" {
		t.Fatalf("admin info %v", info["backups"])
	}
}

// The WebDAV password is never sent back; leaving it out keeps it; a new
// address without it clears it (D105).
func TestBackupSecretsNeverReturned(t *testing.T) {
	e := newBackupEnv(t)
	o := e.newPerson(ownerEmail, "")
	fake := backuptest.NewWebDAV("ana", "app-pass-123", "/dav")
	srv := httptest.NewServer(fake)
	defer srv.Close()
	body := map[string]any{"enabled": true, "kind": "webdav", "fields": map[string]string{"url": srv.URL + "/dav/Topo", "user": "ana"}, "secrets": map[string]string{"password": "app-pass-123"}}
	r := o.b.do("PUT", "/api/admin/backups", body)
	if r.Code != 200 {
		t.Fatalf("save: %d %s", r.Code, r.Body.String())
	}
	for _, rr := range []resp{r, o.b.get("/api/admin/backups"), o.b.get("/api/admin/info")} {
		if strings.Contains(rr.Body.String(), "app-pass-123") {
			t.Fatalf("the password came back: %s", rr.Body.String())
		}
	}
	if set := r.json()["config"].(map[string]any)["secretsSet"].([]any); len(set) != 1 || set[0] != "password" {
		t.Fatalf("secretsSet %v", set)
	}
	var sealed string
	e.st.R.QueryRow("SELECT secret_ct FROM backup_config").Scan(&sealed)
	if sealed == "" || strings.Contains(sealed, "app-pass") {
		t.Fatalf("stored %q", sealed)
	}
	// Left out: kept (the check still signs in).
	if r := o.b.post("/api/admin/backups/test", map[string]any{"fields": map[string]string{"url": srv.URL + "/dav/Topo", "user": "ana"}}); r.Code != 200 {
		t.Fatalf("test with the saved password: %d %s", r.Code, r.Body.String())
	}
	// A new address without the password: cleared, so the far end refuses.
	srv2 := httptest.NewServer(fake)
	defer srv2.Close()
	r = o.b.post("/api/admin/backups/test", map[string]any{"fields": map[string]string{"url": srv2.URL + "/dav/Topo", "user": "ana"}})
	if r.Code != 422 || r.json()["code"] != "refused" {
		t.Fatalf("new host kept the password: %d %s", r.Code, r.Body.String())
	}
	// "" clears it.
	if r := o.b.do("PUT", "/api/admin/backups?force=1", map[string]any{"secrets": map[string]string{"password": ""}}); r.Code != 200 || len(r.json()["config"].(map[string]any)["secretsSet"].([]any)) != 0 {
		t.Fatalf("clear: %d %s", r.Code, r.Body.String())
	}
}

func TestBackupSiteRoutes(t *testing.T) {
	e := newBackupEnv(t)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	prov := o.join(site, "prov@example.test", "provider")
	stranger := e.newPerson("x@example.test", "member")
	dir := filepath.Join(e.root, "bk")
	os.Mkdir(dir, 0o700)
	if r := o.b.do("PUT", "/api/admin/backups", map[string]any{"enabled": true, "kind": "folder", "fields": map[string]string{"path": dir}}); r.Code != 200 {
		t.Fatalf("save: %d %s", r.Code, r.Body.String())
	}
	if r := o.push(site, `{"nodes":[{"name":"Core switch","ip":"10.9.8.7"}]}`); r.Code != 201 {
		t.Fatalf("push: %d", r.Code)
	}
	e.tick() // a new destination: every network behind is written at once
	files, _ := filepath.Glob(filepath.Join(dir, site, "topo_network-*.json"))
	if len(files) != 1 {
		t.Fatalf("files %v", files)
	}
	raw, _ := os.ReadFile(files[0])
	if strings.Contains(string(raw), "Core switch") || strings.Contains(string(raw), "10.9.8.7") || !strings.Contains(string(raw), `"kind":"topo-backup"`) {
		t.Fatal("the file is not the encrypted revision")
	}
	// The list: owner only.
	if r := stranger.b.get("/api/sites/" + site + "/backups"); r.Code != 404 {
		t.Fatalf("stranger: %d", r.Code)
	}
	if r := prov.b.get("/api/sites/" + site + "/backups"); r.Code != 403 {
		t.Fatalf("provider: %d", r.Code)
	}
	r := o.b.get("/api/sites/" + site + "/backups")
	var list struct {
		Backups []backupFileJSON `json:"backups"`
	}
	json.Unmarshal(r.Body.Bytes(), &list)
	if len(list.Backups) != 1 || list.Backups[0].RevN != 1 || list.Backups[0].Kind != "enc" || list.Backups[0].PreviousDest {
		t.Fatalf("list %+v", list)
	}
	id := list.Backups[0].ID
	dl := o.b.get("/api/sites/" + site + "/backups/" + id)
	if dl.Code != 200 || dl.Body.String() != string(raw) || dl.Header().Get("X-Topo-Backup-Sha256") == "" {
		t.Fatalf("download: %d", dl.Code)
	}
	if r := prov.b.get("/api/sites/" + site + "/backups/" + id); r.Code != 403 {
		t.Fatalf("provider download: %d", r.Code)
	}
	other := o.createSite()
	if r := o.b.get("/api/sites/" + other + "/backups/" + id); r.Code != 404 {
		t.Fatalf("another site's id: %d", r.Code)
	}
	// The weekly check through the API: Check now.
	if r := o.b.post("/api/admin/backups/check", nil); r.Code != 202 {
		t.Fatalf("check: %d", r.Code)
	}
	e.tick()
	st := o.b.get("/api/admin/backups").json()["status"].(map[string]any)
	if lc := st["lastCheck"].(map[string]any); lc["ok"] != true {
		t.Fatalf("check status %v", st)
	}

	// Readable copies: off until the server owner allows and the network's owner turns them on.
	file := map[string]any{"revN": 1, "fileName": "topo_acme_office_2026-11-10.json", "file": map[string]any{"kind": "nettopology"}}
	if r := o.b.post("/api/sites/"+site+"/backups/readable", file); r.Code != 409 || r.json()["error"] != ErrReadableOff {
		t.Fatalf("readable while off: %d %s", r.Code, r.Body.String())
	}
	if r := o.b.do("PATCH", "/api/sites/"+site, map[string]any{"backupReadable": true}); r.Code != 409 {
		t.Fatalf("turn on while not allowed: %d", r.Code)
	}
	o.b.do("PUT", "/api/admin/backups", map[string]any{"readableAllowed": true})
	if r := o.b.do("PATCH", "/api/sites/"+site, map[string]any{"backupReadable": true}); r.Code != 200 {
		t.Fatalf("turn on: %d %s", r.Code, r.Body.String())
	}
	if b := o.b.get("/api/sites/" + site).json()["backups"].(map[string]any); b["on"] != true || b["readable"] != true || b["readableAllowed"] != true {
		t.Fatalf("site backups %v", b)
	}
	if r := prov.b.post("/api/sites/"+site+"/backups/readable", file); r.Code != 403 {
		t.Fatalf("provider readable: %d", r.Code)
	}
	stale := map[string]any{"revN": 0, "fileName": file["fileName"], "file": file["file"]}
	if r := o.b.post("/api/sites/"+site+"/backups/readable", stale); r.Code != 409 || r.json()["error"] != ErrStale {
		t.Fatalf("stale: %d", r.Code)
	}
	for _, bad := range []string{"../x.json", "a.json", "topo_x/y.json"} {
		if r := o.b.post("/api/sites/"+site+"/backups/readable", map[string]any{"revN": 1, "fileName": bad, "file": file["file"]}); r.Code != 400 {
			t.Fatalf("name %q: %d", bad, r.Code)
		}
	}
	if r := o.b.post("/api/sites/"+site+"/backups/readable", file); r.Code != 202 {
		t.Fatalf("readable: %d %s", r.Code, r.Body.String())
	}
	e.tick()
	if b, err := os.ReadFile(filepath.Join(dir, site, "readable", "topo_acme_office_2026-11-10.json")); err != nil || !strings.Contains(string(b), "nettopology") {
		t.Fatalf("readable copy: %v", err)
	}
	// Delete readable copies: gone from the destination and the list;
	// the encrypted ones stay. A provider may not.
	if r := prov.b.do("DELETE", "/api/sites/"+site+"/backups/readable", nil); r.Code != 403 {
		t.Fatalf("provider delete readable: %d", r.Code)
	}
	if r := o.b.do("DELETE", "/api/sites/"+site+"/backups/readable", nil); r.Code != 204 {
		t.Fatalf("delete readable: %d %s", r.Code, r.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, site, "readable", "topo_acme_office_2026-11-10.json")); !os.IsNotExist(err) {
		t.Fatalf("readable copy still there: %v", err)
	}
	if rows, _ := store.SiteBackups(context.Background(), e.st.R, site, "readable", ""); len(rows) != 0 {
		t.Fatalf("readable rows left: %d", len(rows))
	}
	if rows, _ := store.SiteBackups(context.Background(), e.st.R, site, "enc", ""); len(rows) == 0 {
		t.Fatal("the encrypted backups went too")
	}
	// The name slug: checked, kept only while the name is shown.
	if r := o.b.do("PATCH", "/api/sites/"+site, map[string]any{"showName": true, "nameClear": "Clínica Sol", "nameSlug": "bad_slug"}); r.Code != 400 {
		t.Fatalf("bad slug: %d", r.Code)
	}
	if r := o.b.do("PATCH", "/api/sites/"+site, map[string]any{"showName": true, "nameClear": "Clínica Sol", "nameSlug": "clinica-sol"}); r.Code != 200 {
		t.Fatalf("slug: %d %s", r.Code, r.Body.String())
	}
	info, _ := store.SiteForBackup(context.Background(), e.st.R, site)
	if info.NameSlug != "clinica-sol" {
		t.Fatalf("slug %q", info.NameSlug)
	}
	o.b.do("PATCH", "/api/sites/"+site, map[string]any{"showName": false})
	info, _ = store.SiteForBackup(context.Background(), e.st.R, site)
	if info.NameSlug != "" {
		t.Fatal("slug kept after the name was hidden")
	}

	// A deleted network: its backups stay; the server owner lists,
	// downloads and deletes them.
	if r := o.b.do("DELETE", "/api/sites/"+site, nil); r.Code != 204 {
		t.Fatalf("delete site: %d", r.Code)
	}
	adm := o.b.get("/api/admin/backups").json()
	if del := adm["deleted"].([]any); len(del) != 1 || del[0].(map[string]any)["site"] != site {
		t.Fatalf("deleted %v", adm["deleted"])
	}
	if r := o.b.get("/api/admin/backups/deleted/" + other); r.Code != 404 {
		t.Fatalf("a live network through the deleted door: %d", r.Code)
	}
	if r := o.b.get("/api/admin/backups/deleted/" + site); r.Code != 200 || !strings.Contains(r.Body.String(), id) {
		t.Fatalf("deleted list: %d", r.Code)
	}
	if r := o.b.get("/api/admin/backups/files/" + id); r.Code != 200 || r.Body.String() != string(raw) {
		t.Fatalf("deleted download: %d", r.Code)
	}
	if r := member(e, "y@example.test").get("/api/admin/backups/files/" + id); r.Code != 403 {
		t.Fatalf("member: %d", r.Code)
	}
	if r := o.b.do("DELETE", "/api/admin/backups/deleted/"+site, nil); r.Code != 204 {
		t.Fatalf("delete backups: %d %s", r.Code, r.Body.String())
	}
	if left, _ := filepath.Glob(filepath.Join(dir, site, "*.json")); len(left) != 0 {
		t.Fatalf("files left %v", left)
	}
}

func member(e *backupEnv, email string) *browser {
	return e.newPerson(email, "member").b
}

// Pushes touch the engine: a visit is written after 30 s, an edit after
// the quiet spell; a new recovery key writes a fresh file.
func TestBackupTouchedByPushes(t *testing.T) {
	e := newBackupEnv(t)
	o := e.newPerson(ownerEmail, "")
	dir := filepath.Join(e.root, "bk")
	os.Mkdir(dir, 0o700)
	o.b.do("PUT", "/api/admin/backups", map[string]any{"enabled": true, "kind": "folder", "fields": map[string]string{"path": dir}})
	site := o.createSite()
	e.tick()
	count := func() int { f, _ := filepath.Glob(filepath.Join(dir, site, "*.json")); return len(f) }
	o.push(site, "a", map[string]any{"kind": "visit-recorded", "to": []string{}})
	e.clk.Add(31 * time.Second)
	e.tick()
	if count() != 1 {
		t.Fatalf("visit: %d", count())
	}
	o.push(site, "b")
	e.clk.Add(30 * time.Second)
	e.tick()
	if count() != 1 {
		t.Fatal("an edit is written before its quiet spell")
	}
	e.clk.Add(31 * time.Second)
	e.tick()
	if count() != 2 {
		t.Fatalf("edit: %d", count())
	}
	if r := o.b.do("PUT", "/api/me/escrow", map[string]any{"escrow": escrow()}); r.Code != 204 {
		t.Fatalf("escrow: %d", r.Code)
	}
	e.clk.Add(time.Second)
	e.tick()
	if count() != 3 {
		t.Fatalf("a new recovery key writes a fresh file: %d", count())
	}
}
