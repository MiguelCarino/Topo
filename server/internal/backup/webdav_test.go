package backup_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/backup/backuptest"
)

const davPrefix = "/remote.php/dav/files/ana"

func davDest(t *testing.T, fake *backuptest.WebDAV, tls bool, pin, pass string) (backup.Dest, *httptest.Server) {
	t.Helper()
	var srv *httptest.Server
	if tls {
		srv = httptest.NewTLSServer(fake)
	} else {
		srv = httptest.NewServer(fake) // 127.0.0.1: plain http is allowed on loopback only
	}
	t.Cleanup(srv.Close)
	s := backup.Normalize(backup.Settings{Kind: "webdav", Fields: map[string]string{"url": srv.URL + davPrefix + "/Topo Backups", "user": "ana", "fingerprint": pin},
		Secrets: map[string]string{"password": pass}})
	if err := backup.Validate(s, nil); err != nil {
		t.Fatal(err)
	}
	d, err := backup.OpenDest(s, nil, "bc_1", true)
	if err != nil {
		t.Fatal(err)
	}
	return d, srv
}

func TestWebDAVRoundTrip(t *testing.T) {
	ctx := context.Background()
	for _, abs := range []bool{false, true} {
		fake := backuptest.NewWebDAV("ana", "app-pass", davPrefix)
		fake.AbsoluteHrefs = abs
		d, _ := davDest(t, fake, false, "", "app-pass")
		if err := d.Check(ctx); err != nil {
			t.Fatal(err)
		}
		// Nested folders made top down; names with spaces, ñ and 日本.
		names := []string{"s_site1/topo_año_2026-11-10.json", "s_site1/topo_日本 支店_2026-11-10.json", "s_site1/readable/topo_x_2026-11-10.json"}
		for _, n := range names {
			if _, err := d.Put(ctx, n, []byte(`{"n":"`+n+`"}`)); err != nil {
				t.Fatalf("put %s: %v", n, err)
			}
		}
		if _, ok := fake.File("Topo Backups/s_site1/topo_日本 支店_2026-11-10.json"); !ok {
			t.Fatalf("stored: %v", fake.Files())
		}
		ls, err := d.List(ctx, "s_site1")
		if err != nil || len(ls) != 2 || ls[0].Name != "topo_año_2026-11-10.json" || ls[1].Size <= 0 || ls[1].Mod.IsZero() {
			t.Fatalf("abs %v: list %+v %v", abs, ls, err)
		}
		rc, err := d.Get(ctx, names[1], "")
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		if !strings.Contains(string(b), "日本") {
			t.Fatal(string(b))
		}
		if err := d.Delete(ctx, names[1], ""); err != nil {
			t.Fatal(err)
		}
		if _, err := d.Get(ctx, names[1], ""); backup.CodeOf(err) != backup.CodeNotFound {
			t.Fatalf("get deleted: %v", err)
		}
		if err := d.Delete(ctx, names[1], ""); backup.CodeOf(err) != backup.CodeNotFound {
			t.Fatalf("delete twice: %v", err)
		}
		if l, err := d.List(ctx, "s_none"); err != nil || len(l) != 0 {
			t.Fatalf("missing folder: %v %v", l, err)
		}
		// No probe file is left.
		for _, f := range fake.Files() {
			if strings.Contains(f, ".topo-check-") {
				t.Fatalf("probe left: %s", f)
			}
		}
	}
}

func TestWebDAVErrors(t *testing.T) {
	ctx := context.Background()
	fake := backuptest.NewWebDAV("ana", "right", davPrefix)
	d, _ := davDest(t, fake, false, "", "wrong")
	if err := d.Check(ctx); backup.CodeOf(err) != backup.CodeRefused {
		t.Fatalf("wrong password: %v", err)
	}
	fake = backuptest.NewWebDAV("ana", "p", davPrefix)
	fake.Quota = 100
	d, _ = davDest(t, fake, false, "", "p")
	if _, err := d.Put(ctx, "s/a.json", make([]byte, 200)); backup.CodeOf(err) != backup.CodeFull {
		t.Fatalf("quota: %v", err)
	}
	fake = backuptest.NewWebDAV("ana", "p", davPrefix)
	fake.MaxBody = 10
	d, _ = davDest(t, fake, false, "", "p")
	if _, err := d.Put(ctx, "s/a.json", make([]byte, 20)); backup.CodeOf(err) != backup.CodeTooLarge {
		t.Fatalf("413: %v", err)
	}
	// A PUT that does not land whole is not a backup.
	fake = backuptest.NewWebDAV("ana", "p", davPrefix)
	fake.ShortPut = true
	d, _ = davDest(t, fake, false, "", "p")
	if _, err := d.Put(ctx, "s/a.json", []byte(`{"x":1}`)); backup.CodeOf(err) != backup.CodeBadAnswer {
		t.Fatalf("short put: %v", err)
	}
	// A redirect is never followed: a PUT turned into a GET would answer 200.
	fake = backuptest.NewWebDAV("ana", "p", davPrefix)
	fake.Redirect = davPrefix + "/Topo Backups/s_moved"
	d, _ = davDest(t, fake, false, "", "p")
	if _, err := d.Put(ctx, "s_moved/a.json", []byte("{}")); backup.CodeOf(err) != backup.CodeBadAnswer {
		t.Fatalf("redirect: %v", err)
	}
	for _, l := range fake.Log {
		if strings.HasPrefix(l, "GET ") {
			t.Fatalf("followed a redirect: %v", fake.Log)
		}
	}
	// The base's parent missing: MKCOL 409.
	fake = backuptest.NewWebDAV("ana", "p", "/elsewhere")
	d, _ = davDest(t, fake, false, "", "p")
	if err := d.Check(ctx); backup.CodeOf(err) != backup.CodeNotFound {
		t.Fatalf("no parent: %v", err)
	}
	// Nobody there.
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	s := backup.Normalize(backup.Settings{Kind: "webdav", Fields: map[string]string{"url": url + "/dav", "user": "a"}})
	d, _ = backup.OpenDest(s, nil, "bc", true)
	if err := d.Check(ctx); backup.CodeOf(err) != backup.CodeUnreachable {
		t.Fatalf("closed port: %v", err)
	}
}

func TestWebDAVAddressRules(t *testing.T) {
	for _, bad := range []string{"http://cloud.example/dav", "ftp://x/y", "https://user:pw@cloud.example/dav", "https:///dav", "https://cloud.example/dav?x=1"} {
		s := backup.Normalize(backup.Settings{Kind: "webdav", Fields: map[string]string{"url": bad, "user": "a"}})
		if err := backup.Validate(s, nil); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
	for _, ok := range []string{"https://cloud.example/remote.php/dav/files/ana/Topo", "http://127.0.0.1:8080/dav", "http://localhost/dav"} {
		s := backup.Normalize(backup.Settings{Kind: "webdav", Fields: map[string]string{"url": ok, "user": "a"}})
		if err := backup.Validate(s, nil); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
}

// A self-signed NAS: refused under the system roots with the fingerprint
// shown, accepted when that fingerprint is pinned, refused with another pin.
func TestWebDAVCertificatePin(t *testing.T) {
	ctx := context.Background()
	fake := backuptest.NewWebDAV("ana", "p", davPrefix)
	d, srv := davDest(t, fake, true, "", "p")
	err := d.Check(ctx)
	var be *backup.Error
	if backup.CodeOf(err) != backup.CodeCertificate {
		t.Fatalf("self-signed: %v", err)
	}
	want := backup.Fingerprint(srv.Certificate().Raw)
	if !asErr(err, &be) || be.Fingerprint != want {
		t.Fatalf("fingerprint %+v want %s", be, want)
	}
	// Pasted with colons and capitals, as browsers show it.
	pretty := strings.ToUpper(want[:2]) + ":" + strings.ToUpper(want[2:])
	s := backup.Normalize(backup.Settings{Kind: "webdav", Fields: map[string]string{"url": srv.URL + davPrefix + "/T", "user": "ana", "fingerprint": pretty}, Secrets: map[string]string{"password": "p"}})
	if err := backup.Validate(s, nil); err != nil {
		t.Fatal(err)
	}
	d, _ = backup.OpenDest(s, nil, "bc", true)
	if err := d.Check(ctx); err != nil {
		t.Fatalf("pinned: %v", err)
	}
	s.Fields["fingerprint"] = strings.Repeat("ab", 32)
	d, _ = backup.OpenDest(s, nil, "bc", true)
	if err := d.Check(ctx); backup.CodeOf(err) != backup.CodeCertificate {
		t.Fatalf("other pin: %v", err)
	}
}

func asErr(err error, be **backup.Error) bool {
	for err != nil {
		if e, ok := err.(*backup.Error); ok {
			*be = e
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
