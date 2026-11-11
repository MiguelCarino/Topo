package backup_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/backup/backuptest"
)

// Destinations of 5c against local fakes only (D109-D111): no real cloud
// call anywhere.

var ctx0 = context.Background()

func wantCode(t *testing.T, what string, err error, code string) {
	t.Helper()
	if backup.CodeOf(err) != code {
		t.Fatalf("%s: code %q (%v), want %q", what, backup.CodeOf(err), err, code)
	}
}

func readAll(t *testing.T, d backup.Dest, name, ref string) []byte {
	t.Helper()
	rc, err := d.Get(ctx0, name, ref)
	if err != nil {
		t.Fatalf("get %s: %v", name, err)
	}
	defer rc.Close()
	b, _ := io.ReadAll(rc)
	return b
}

func names(es []backup.Entry) string {
	var s []string
	for _, e := range es {
		s = append(s, e.Name)
	}
	return strings.Join(s, ",")
}

// ---- S3 ----

func s3Dest(t *testing.T, srvURL, secret, pin string, now func() time.Time) backup.Dest {
	t.Helper()
	s := backup.Normalize(backup.Settings{Kind: "s3", Fields: map[string]string{"endpoint": srvURL, "region": "us-west-004", "bucket": "topo-backups",
		"prefix": "", "keyId": "AKIDTEST", "pathStyle": "1", "fingerprint": pin}, Secrets: map[string]string{"secret": secret}})
	if err := backup.Validate(s, nil); err != nil {
		t.Fatal(err)
	}
	d, err := backup.OpenDestWith(s, nil, "bc_1", false, backup.Hooks{Now: now})
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestS3Destination(t *testing.T) {
	fake := backuptest.NewS3("AKIDTEST", "s3cr3t/key+", "us-west-004", "topo-backups")
	fake.MaxKeys = 2
	srv := httptest.NewTLSServer(fake)
	defer srv.Close()
	pin := backup.Fingerprint(srv.Certificate().Raw)
	clk := backuptest.NewClock(time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC))
	fake.Now = clk.Now
	d := s3Dest(t, srv.URL, "s3cr3t/key+", pin, clk.Now)

	if err := d.Check(ctx0); err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(fake.Keys()) != 0 {
		t.Fatalf("the probe stayed: %v", fake.Keys())
	}
	body := []byte(`{"topo":"backup"}`)
	for _, n := range []string{"a.json", "b.json", "c.json", "d.json", "e f.json"} {
		if _, err := d.Put(ctx0, "s_1/"+n, body); err != nil {
			t.Fatalf("put %s: %v", n, err)
		}
	}
	d.Put(ctx0, "s_1/readable/r.json", body)
	if k := fake.Keys(); k[0] != "topo/s_1/a.json" || len(k) != 6 {
		t.Fatalf("keys under the prefix: %v", k)
	}
	es, err := d.List(ctx0, "s_1")
	if err != nil || names(es) != "a.json,b.json,c.json,d.json,e f.json" || es[0].Size != int64(len(body)) {
		t.Fatalf("list (pages of 2, sub-folder left out): %v %s", err, names(es))
	}
	if len(fake.Tokens) < 2 || !strings.ContainsAny(fake.Tokens[0], "+/") {
		t.Fatalf("continuation tokens with + and / sent intact: %v", fake.Tokens)
	}
	if got := readAll(t, d, "s_1/e f.json", ""); !bytes.Equal(got, body) {
		t.Fatalf("get: %q", got)
	}
	if err := d.Delete(ctx0, "s_1/a.json", ""); err != nil {
		t.Fatal(err)
	}
	if es, _ := d.List(ctx0, "missing"); len(es) != 0 {
		t.Fatalf("an empty folder lists nothing")
	}
	_, err = d.Get(ctx0, "s_1/a.json", "")
	wantCode(t, "a deleted file", err, backup.CodeNotFound)

	// A wrong secret is refused (the fake checks the signature itself).
	wantCode(t, "wrong secret", s3Dest(t, srv.URL, "nope", pin, clk.Now).Check(ctx0), backup.CodeRefused)
	// This server's clock 20 minutes off.
	off := func() time.Time { return clk.Now().Add(20 * time.Minute) }
	wantCode(t, "clock", s3Dest(t, srv.URL, "s3cr3t/key+", pin, off).Check(ctx0), backup.CodeClock)
	// Another certificate than the pinned one.
	err = s3Dest(t, srv.URL, "s3cr3t/key+", strings.Repeat("0", 64), clk.Now).Check(ctx0)
	wantCode(t, "pinned certificate", err, backup.CodeCertificate)
	var be *backup.Error
	if !errors.As(err, &be) || be.Fingerprint != pin {
		t.Fatalf("the refused certificate's fingerprint is reported: %v", err)
	}
	// Object lock: a delete refused is "locked", not a failed run.
	fake.LockDeletes = true
	wantCode(t, "object lock", d.Delete(ctx0, "s_1/b.json", ""), backup.CodeLocked)
	fake.LockDeletes = false
	// The wrong bucket.
	s := backup.Normalize(backup.Settings{Kind: "s3", Fields: map[string]string{"endpoint": srv.URL, "bucket": "other", "keyId": "AKIDTEST", "pathStyle": "1", "region": "us-west-004", "fingerprint": pin},
		Secrets: map[string]string{"secret": "s3cr3t/key+"}})
	od, _ := backup.OpenDestWith(s, nil, "x", false, backup.Hooks{Now: clk.Now})
	wantCode(t, "no such bucket", od.Check(ctx0), backup.CodeNotFound)
	// Too large never leaves.
	_, err = d.Put(ctx0, "s_1/big.json", make([]byte, backup.MaxFile+1))
	wantCode(t, "too large", err, backup.CodeTooLarge)
}

// A redirect is a bad answer, never followed (amendment 12).
func TestS3RedirectRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "http://127.0.0.1:1/elsewhere")
		w.WriteHeader(301)
	}))
	defer srv.Close()
	d := s3Dest(t, srv.URL, "x", "", nil)
	_, err := d.Put(ctx0, "s_1/a.json", []byte("{}"))
	wantCode(t, "redirect", err, backup.CodeBadAnswer)
}

func TestS3Settings(t *testing.T) {
	bad := []map[string]string{
		{"endpoint": "http://s3.example.com", "bucket": "b1", "keyId": "k"}, // http off this machine
		{"endpoint": "https://s3.example.com", "bucket": "b", "keyId": "k"}, // bucket too short
		{"endpoint": "https://s3.example.com", "bucket": "b1", "keyId": "k k"},
		{"endpoint": "https://s3.example.com", "bucket": "b1", "keyId": "k", "region": "US EAST"},
		{"endpoint": "https://s3.example.com", "bucket": "b1", "keyId": "k", "prefix": "../b"},
	}
	for i, f := range bad {
		if err := backup.Validate(backup.Normalize(backup.Settings{Kind: "s3", Fields: f}), nil); err == nil {
			t.Errorf("bad %d accepted: %v", i, f)
		}
	}
	n := backup.Normalize(backup.Settings{Kind: "s3", Fields: map[string]string{"endpoint": "http://127.0.0.1:9000", "bucket": "b1", "keyId": "k", "prefix": "/backups/topo", "pathStyle": "true"},
		Secrets: map[string]string{"secret": "s", "refreshToken": "x"}})
	if err := backup.Validate(n, nil); err != nil {
		t.Fatal(err)
	}
	if n.Fields["prefix"] != "backups/topo/" || n.Fields["pathStyle"] != "1" || n.Secrets["refreshToken"] != "" {
		t.Fatalf("normalised: %v %v", n.Fields, n.Secrets)
	}
	if n := backup.Normalize(backup.Settings{Kind: "s3", Fields: map[string]string{"prefix": ""}}); n.Fields["prefix"] != "topo/" {
		t.Fatalf("default prefix: %q", n.Fields["prefix"])
	}
}

// ---- OAuth, Google Drive, OneDrive ----

type cloud struct {
	auth   *backuptest.OAuth
	srv    *httptest.Server
	other  *httptest.Server
	drive  *backuptest.Drive
	graph  *backuptest.Graph
	undo   func()
	mu     sync.Mutex
	saved  map[string]string
	ref    string
	saves  int
	fields map[string]string
}

func newCloud(t *testing.T, kind string) *cloud {
	t.Helper()
	c := &cloud{auth: backuptest.NewOAuth("client-1.apps", "app-secret")}
	mux := http.NewServeMux()
	mux.Handle("/token", c.auth)
	mux.Handle("/tenant-1/token", c.auth)
	if kind == "gdrive" {
		c.drive = backuptest.NewDrive(c.auth)
		mux.Handle("/", c.drive)
	} else {
		c.graph = backuptest.NewGraph(c.auth)
		mux.Handle("/", c.graph)
		c.other = httptest.NewServer(c.graph.Other())
		c.graph.OtherBase = c.other.URL
	}
	c.srv = httptest.NewServer(mux)
	ep := backup.Endpoints{Auth: c.srv.URL + "/authorize", Token: c.srv.URL + "/token", API: c.srv.URL + "/drive/v3", Upload: c.srv.URL + "/upload/drive/v3"}
	c.fields = map[string]string{"clientId": "client-1.apps"}
	if kind == "onedrive" {
		ep = backup.Endpoints{Auth: c.srv.URL + "/{tenant}/authorize", Token: c.srv.URL + "/{tenant}/token", API: c.srv.URL + "/v1.0"}
		c.fields["tenant"] = "tenant-1"
	}
	c.undo = backup.SwapEndpoints(kind, ep)
	t.Cleanup(func() {
		c.undo()
		c.srv.Close()
		if c.other != nil {
			c.other.Close()
		}
	})
	return c
}

// connect runs the sign-in as the server does: AuthURL, the owner says
// yes, Exchange.
func (c *cloud) connect(t *testing.T, kind string) string {
	t.Helper()
	verifier, challenge := backup.PKCE()
	au, err := backup.AuthURL(kind, c.fields, "st-1", challenge, "http://localhost:7380/api/backups/oauth/callback")
	if err != nil {
		t.Fatal(err)
	}
	back, err := c.auth.Authorize(au)
	if err != nil {
		t.Fatal(err)
	}
	if kind == "gdrive" && (c.auth.LastAuth.Get("scope") != "https://www.googleapis.com/auth/drive.file" || c.auth.LastAuth.Get("access_type") != "offline") {
		t.Fatalf("Drive asks only for its own files, offline: %v", c.auth.LastAuth)
	}
	if kind == "onedrive" && c.auth.LastAuth.Get("scope") != "Files.ReadWrite.AppFolder offline_access" {
		t.Fatalf("OneDrive asks only for its app folder: %v", c.auth.LastAuth)
	}
	bu, _ := url.Parse(back)
	if bu.Query().Get("state") != "st-1" {
		t.Fatalf("state comes back: %s", back)
	}
	// A wrong verifier is refused (PKCE).
	if _, err := backup.Exchange(ctx0, kind, c.fields, "app-secret", bu.Query().Get("code"), verifier+"x", "http://localhost:7380/api/backups/oauth/callback", time.Now()); backup.CodeOf(err) != backup.CodeConnect {
		t.Fatalf("PKCE mismatch: %v", err)
	}
	// The code was spent by the refused try: sign in again.
	back, _ = c.auth.Authorize(au)
	bu, _ = url.Parse(back)
	rt, err := backup.Exchange(ctx0, kind, c.fields, "app-secret", bu.Query().Get("code"), verifier, "http://localhost:7380/api/backups/oauth/callback", time.Now())
	if err != nil || rt == "" {
		t.Fatalf("exchange: %q %v", rt, err)
	}
	return rt
}

func (c *cloud) open(t *testing.T, kind, refresh string) backup.Dest {
	t.Helper()
	c.mu.Lock()
	ref := c.ref
	c.mu.Unlock()
	h := backup.Hooks{Ref: ref, Save: func(sec map[string]string, ref string) error {
		c.mu.Lock()
		defer c.mu.Unlock()
		c.saved = map[string]string{}
		for k, v := range sec {
			c.saved[k] = v
		}
		c.ref = ref
		c.saves++
		return nil
	}}
	s := backup.Normalize(backup.Settings{Kind: kind, Fields: c.fields, Secrets: map[string]string{"clientSecret": "app-secret", "refreshToken": refresh}})
	if err := backup.Validate(s, nil); err != nil {
		t.Fatal(err)
	}
	d, err := backup.OpenDestWith(s, nil, "bc_1", false, h)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestGoogleDrive(t *testing.T) {
	c := newCloud(t, "gdrive")
	rt := c.connect(t, "gdrive")
	d := c.open(t, "gdrive", rt)
	if err := d.Check(ctx0); err != nil {
		t.Fatalf("check: %v", err)
	}
	if backup.ParseRef(c.ref).Folder == "" || c.auth.Refreshes != 0 {
		t.Fatalf("the Topo folder's id is saved, the access token from the exchange used: %q %d", c.ref, c.auth.Refreshes)
	}
	topo := c.drive.Find("Topo", "root")
	if len(topo) != 1 {
		t.Fatalf("one Topo folder: %v", topo)
	}
	if acct := d.(backup.Connected).Account(ctx0); acct != "ana@example.test" {
		t.Fatalf("account: %q", acct)
	}
	body := []byte(`{"topo":"backup","n":1}`)
	ref1, err := d.Put(ctx0, "s_1/topo_net_2026-11-10.json", body)
	if err != nil || ref1 == "" {
		t.Fatalf("put: %q %v", ref1, err)
	}
	if p := c.drive.Path(ref1); p != "Topo/s_1/topo_net_2026-11-10.json" {
		t.Fatalf("path: %s", p)
	}
	// Drive names are not unique: a stray file of the same name (made by
	// hand) does not confuse reading by id; writing the name again leaves
	// one file.
	site := c.drive.Find("s_1", "")[0].ID
	c.drive.Add("topo_net_2026-11-10.json", site, "application/json", []byte("stranger"))
	if got := readAll(t, d, "s_1/topo_net_2026-11-10.json", ref1); !bytes.Equal(got, body) {
		t.Fatalf("read by id: %q", got)
	}
	ref2, err := d.Put(ctx0, "s_1/topo_net_2026-11-10.json", []byte(`{"n":2}`))
	if err != nil || ref2 == ref1 || len(c.drive.Find("topo_net_2026-11-10.json", site)) != 1 {
		t.Fatalf("written again: one file: %v %v", err, c.drive.Find("topo_net_2026-11-10.json", site))
	}
	d.Put(ctx0, "s_1/readable/topo_net_2026-11-10.json", body)
	es, err := d.List(ctx0, "s_1")
	if err != nil || names(es) != "topo_net_2026-11-10.json" || es[0].Ref != ref2 {
		t.Fatalf("list (folders left out, ids given): %v %+v", err, es)
	}
	// Over 5 MB: the resumable upload (multipart is for 5 MB or less).
	big := bytes.Repeat([]byte("x"), backup.DriveMultipartMax+10)
	refB, err := d.Put(ctx0, "s_1/big.json", big)
	if err != nil || c.drive.Resumables != 1 {
		t.Fatalf("resumable: %v %d", err, c.drive.Resumables)
	}
	if got := readAll(t, d, "s_1/big.json", refB); len(got) != len(big) {
		t.Fatalf("big read back: %d", len(got))
	}
	if err := d.Delete(ctx0, "s_1/big.json", refB); err != nil {
		t.Fatal(err)
	}
	wantCode(t, "deleted", d.Delete(ctx0, "s_1/big.json", refB), backup.CodeNotFound)

	// A 401 refreshes once and goes on.
	c.auth.ExpireAccess()
	if _, err := d.List(ctx0, "s_1"); err != nil || c.auth.Refreshes != 1 {
		t.Fatalf("refresh on 401: %v %d", err, c.auth.Refreshes)
	}
	// A new destination object reuses the access token in memory.
	d2 := c.open(t, "gdrive", rt)
	if _, err := d2.List(ctx0, "s_1"); err != nil || c.auth.Refreshes != 1 {
		t.Fatalf("access token kept in memory: %v %d", err, c.auth.Refreshes)
	}
	// The Topo folder trashed by hand: Check makes a new one and saves it.
	c.drive.Trash(topo[0].ID)
	d3 := c.open(t, "gdrive", rt)
	if err := d3.Check(ctx0); err != nil || backup.ParseRef(c.ref).Folder == topo[0].ID {
		t.Fatalf("a new Topo folder: %v %s", err, c.ref)
	}
	// The sign-in revoked: "Connect again".
	c.auth.ExpireAccess()
	c.auth.FailRefresh = "invalid_grant"
	_, err = c.open(t, "gdrive", rt).List(ctx0, "s_1")
	wantCode(t, "invalid_grant", err, backup.CodeConnect)
	c.auth.FailRefresh = "invalid_client"
	_, err = c.open(t, "gdrive", rt).List(ctx0, "s_1")
	wantCode(t, "invalid_client", err, backup.CodeClientSecret)
	// Never connected.
	_, err = c.open(t, "gdrive", "").List(ctx0, "s_1")
	wantCode(t, "not connected", err, backup.CodeConnect)
}

func TestOneDrive(t *testing.T) {
	c := newCloud(t, "onedrive")
	c.auth.Rotate = true
	rt := c.connect(t, "onedrive")
	d := c.open(t, "onedrive", rt)
	if err := d.Check(ctx0); err != nil {
		t.Fatalf("check: %v", err)
	}
	if acct := d.(backup.Connected).Account(ctx0); acct != "Ana Example" {
		t.Fatalf("account: %q", acct)
	}
	body := []byte(`{"topo":"backup"}`)
	for _, n := range []string{"a.json", "b.json", "c.json"} {
		if _, err := d.Put(ctx0, "s_1/"+n, body); err != nil {
			t.Fatalf("put: %v", err)
		}
	}
	d.Put(ctx0, "s_1/readable/r.json", body)
	c.graph.PageSize = 2
	es, err := d.List(ctx0, "s_1")
	if err != nil || names(es) != "a.json,b.json,c.json" || es[0].Ref == "" {
		t.Fatalf("list over pages, folders left out: %v %s", err, names(es))
	}
	if es, err := d.List(ctx0, "nothing"); err != nil || len(es) != 0 {
		t.Fatalf("a missing folder lists nothing: %v", err)
	}
	// Read through the 302 to the download host, without the token.
	if got := readAll(t, d, "s_1/a.json", ""); !bytes.Equal(got, body) {
		t.Fatalf("get: %q", got)
	}
	if got := readAll(t, d, "s_1/b.json", es[1].Ref); !bytes.Equal(got, body) {
		t.Fatalf("get by id: %q", got)
	}
	// Over 4 MB: an upload session in pieces, the token never sent there.
	big := bytes.Repeat([]byte("y"), backup.OneDriveSimpleMax+backup.OneDriveChunk+5)
	ref, err := d.Put(ctx0, "s_1/big.json", big)
	if err != nil || c.graph.Sessions != 1 {
		t.Fatalf("upload session: %v %d", err, c.graph.Sessions)
	}
	if got, _ := c.graph.File("s_1/big.json"); len(got) != len(big) {
		t.Fatalf("big stored: %d", len(got))
	}
	if err := d.Delete(ctx0, "s_1/big.json", ref); err != nil {
		t.Fatal(err)
	}
	if err := d.Delete(ctx0, "s_1/c.json", ""); err != nil {
		t.Fatal(err)
	}
	if c.graph.TokenSent != 0 {
		t.Fatalf("the token went to the upload or download host %d times", c.graph.TokenSent)
	}
	// Microsoft rotates the refresh token: the new one is saved before it
	// is used, and the old one no longer works.
	c.auth.ExpireAccess()
	if _, err := d.List(ctx0, "s_1"); err != nil {
		t.Fatal(err)
	}
	if c.saves != 1 || c.saved["refreshToken"] == "" || c.saved["refreshToken"] == rt || c.saved["clientSecret"] != "app-secret" {
		t.Fatalf("rotated token saved: %d %v", c.saves, c.saved)
	}
	c.auth.ExpireAccess()
	_, err = c.open(t, "onedrive", rt).List(ctx0, "s_1")
	wantCode(t, "the old refresh token", err, backup.CodeConnect)
	if _, err := c.open(t, "onedrive", c.saved["refreshToken"]).List(ctx0, "s_1"); err != nil {
		t.Fatalf("the saved one works: %v", err)
	}
}

func TestOAuthSettings(t *testing.T) {
	n := backup.Normalize(backup.Settings{Kind: "onedrive", Fields: map[string]string{"clientId": " 1234-abcd "}})
	if n.Fields["tenant"] != "common" || n.Fields["clientId"] != "1234-abcd" || backup.Validate(n, nil) != nil {
		t.Fatalf("onedrive defaults: %v", n.Fields)
	}
	if backup.Validate(backup.Normalize(backup.Settings{Kind: "gdrive", Fields: map[string]string{"clientId": "a b"}}), nil) == nil {
		t.Fatal("a client id with a space")
	}
	if names := backup.SecretNames("gdrive"); len(names) != 1 || names[0] != "clientSecret" {
		t.Fatalf("only the client secret is typed: %v", names)
	}
	_, err := backup.AuthURL("webdav", nil, "s", "c", "r")
	if err == nil {
		t.Fatal("AuthURL for webdav")
	}
}
