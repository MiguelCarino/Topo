package api

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	netmail "net/mail"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// person is a browser that does what js/servercrypto.js does, in Go: a
// device key, user keys, rosters, wraps and encrypted revisions.
type person struct {
	e     *aenv
	b     *browser
	id    string
	email string
	enc   *ecdh.PrivateKey
	sig   *ecdsa.PrivateKey
	dev   *ecdh.PrivateKey
	devID string
	keys  map[string]map[int64][]byte // site → epoch → site key
}

var ipSeq struct {
	sync.Mutex
	n int
}

func nextIP() string {
	ipSeq.Lock()
	defer ipSeq.Unlock()
	ipSeq.n++
	return "198.51.100." + itoa(ipSeq.n%250+1)
}

func b64(b []byte) string { return tcrypto.B64.EncodeToString(b) }

// newPerson signs email in (creating the account with serverRole first
// when it is not "") and sets up keys on a fresh device.
func (e *aenv) newPerson(email, serverRole string) *person {
	e.t.Helper()
	p := e.signedIn(email, serverRole)
	p.setupKeys()
	return p
}

// signedIn signs in without setting up keys.
func (e *aenv) signedIn(email, serverRole string) *person {
	e.t.Helper()
	if serverRole != "" {
		e.addUser(email, serverRole)
	}
	p := &person{e: e, b: e.browser(nextIP()), email: email, keys: map[string]map[int64][]byte{}}
	p.id = p.b.signIn(email)
	people.Store(p.id, p)
	return p
}

func (p *person) encPub() string { return b64(p.enc.PublicKey().Bytes()) }
func (p *person) sigPub() string { return tcrypto.RawPublic(&p.sig.PublicKey) }

// addDevice registers a new device key for this browser.
func (p *person) addDevice() {
	p.e.t.Helper()
	p.dev, _ = ecdh.P256().GenerateKey(rand.Reader)
	r := p.b.post("/api/devices", map[string]any{"devPub": b64(p.dev.PublicKey().Bytes()), "label": "Test on Linux"})
	if r.Code != 201 {
		p.e.t.Fatalf("add device: %d %s", r.Code, r.Body.String())
	}
	p.devID = r.json()["id"].(string)
}

func (p *person) setupKeys() {
	p.e.t.Helper()
	p.addDevice()
	p.enc, _ = ecdh.P256().GenerateKey(rand.Reader)
	p.sig, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	r := p.putKeys(false)
	if r.Code != 200 {
		p.e.t.Fatalf("keys: %d %s", r.Code, r.Body.String())
	}
}

func (p *person) putKeys(reset bool) resp {
	p.e.t.Helper()
	return p.b.do("PUT", "/api/me/keys", map[string]any{"encPub": p.encPub(), "sigPub": p.sigPub(),
		"deviceWrap": p.wrap(p.dev.PublicKey().Bytes(), tcrypto.DeviceCtx(p.id, p.devID), []byte(`{"v":1,"enc":"x","sig":"y"}`)),
		"escrow":     escrow(), "reset": reset})
}

func escrow() map[string]any {
	return map[string]any{"v": 1, "kdf": "HKDF-SHA256", "salt": b64(make([]byte, 16)), "iv": b64(make([]byte, 12)), "ct": b64(make([]byte, 40))}
}

// wrap is ECIES to a raw P-256 public key, signed by p (design §5.3, A4).
func (p *person) wrap(toRaw []byte, ctx string, pt []byte) json.RawMessage {
	to, err := ecdh.P256().NewPublicKey(toRaw)
	if err != nil {
		panic(err)
	}
	eph, _ := ecdh.P256().GenerateKey(rand.Reader)
	z, _ := eph.ECDH(to)
	salt, iv := make([]byte, 16), make([]byte, 12)
	rand.Read(salt)
	rand.Read(iv)
	key, _ := hkdf.Key(sha256.New, z, salt, "topo/v1/wrap\n"+ctx, 32)
	w := &tcrypto.Wrap{V: 1, Alg: tcrypto.WrapAlg, To: tcrypto.Fingerprint(toRaw), Ctx: ctx, EPK: b64(eph.PublicKey().Bytes()), Salt: b64(salt), IV: b64(iv), By: &p.id}
	blk, _ := aes.NewCipher(key)
	g, _ := cipher.NewGCM(blk)
	w.CT = b64(g.Seal(nil, iv, pt, []byte(w.Header())))
	sig := b64(tcrypto.SignP1363(p.sig, []byte(w.SignedString())))
	w.Sig = &sig
	out, _ := json.Marshal(w)
	return out
}

type rm struct {
	p    *person
	role string
}

// roster signs a roster listing ms.
func (p *person) roster(site string, seq, epoch int64, ms ...rm) json.RawMessage {
	r := &tcrypto.Roster{V: 1, Site: site, Seq: seq, Epoch: epoch, By: p.id, At: p.e.clk.Now().UnixMilli()}
	for _, m := range ms {
		r.Members = append(r.Members, tcrypto.RosterMember{U: m.p.id, Email: strings.ToLower(m.p.email), Role: m.role,
			Enc: tcrypto.FingerprintB64(m.p.encPub()), Sig: tcrypto.FingerprintB64(m.p.sigPub())})
	}
	sort.Slice(r.Members, func(i, j int) bool { return r.Members[i].U < r.Members[j].U })
	r.Sig = b64(tcrypto.SignP1363(p.sig, []byte(r.Canonical())))
	out, _ := json.Marshal(r)
	return out
}

// siteWrap wraps the site key of epoch for member m.
func (p *person) siteWrap(site string, epoch int64, m *person) map[string]any {
	key := p.keys[site][epoch]
	return map[string]any{"user": m.id, "epoch": epoch, "wrap": p.wrap(m.enc.PublicKey().Bytes(), tcrypto.SiteCtx(site, epoch, m.id), key)}
}

func (p *person) newKey(site string, epoch int64) []byte {
	k := make([]byte, 32)
	rand.Read(k)
	if p.keys[site] == nil {
		p.keys[site] = map[int64][]byte{}
	}
	p.keys[site][epoch] = k
	return k
}

func (p *person) nameCt(site string, epoch int64) map[string]any {
	key := p.keys[site][epoch]
	iv := make([]byte, 12)
	rand.Read(iv)
	blk, _ := aes.NewCipher(key)
	g, _ := cipher.NewGCM(blk)
	return map[string]any{"v": 1, "epoch": epoch, "iv": b64(iv), "ct": b64(g.Seal(nil, iv, []byte("Office"), []byte("topo-name-v1\n"+site+"\n"+itoa(int(epoch)))))}
}

// createSite puts a new site on the server with p as its only owner.
func (p *person) createSite() string {
	p.e.t.Helper()
	site := "s_" + b64(randBytes(16))
	p.newKey(site, 1)
	r := p.b.post("/api/sites", map[string]any{"id": site, "roster": p.roster(site, 1, 1, rm{p, "owner"}),
		"wrap": p.siteWrap(site, 1, p)["wrap"], "nameCt": p.nameCt(site, 1)})
	if r.Code != 201 {
		p.e.t.Fatalf("create site: %d %s", r.Code, r.Body.String())
	}
	return site
}

func randBytes(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

// shareKeys lets m use the keys p holds (as if m had unwrapped them).
func (p *person) shareKeys(site string, m *person) {
	m.keys[site] = map[int64][]byte{}
	for e, k := range p.keys[site] {
		m.keys[site][e] = k
	}
}

// head is the site's head as the server reports it.
func (p *person) head(site string) (int64, string, int64, int64) {
	p.e.t.Helper()
	r := p.b.get("/api/sites/" + site + "/revs?since=0&limit=1")
	if r.Code != 200 {
		p.e.t.Fatalf("pull: %d %s", r.Code, r.Body.String())
	}
	h := r.json()["head"].(map[string]any)
	return int64(h["n"].(float64)), h["h"].(string), int64(h["epoch"].(float64)), int64(h["rosterSeq"].(float64))
}

// envelope builds and signs a revision envelope.
func (p *person) envelope(site string, n int64, prev string, epoch, rseq int64, doc string) map[string]any {
	key := p.keys[site][epoch]
	if key == nil {
		key = randBytes(32)
	}
	iv := randBytes(12)
	at := p.e.clk.Now().UnixMilli()
	hdr := &tcrypto.RevHeader{Site: site, N: n, Base: n - 1, Prev: prev, Epoch: epoch, RSeq: rseq, Author: p.id, Dev: p.devID, At: at}
	blk, _ := aes.NewCipher(key)
	g, _ := cipher.NewGCM(blk)
	// The AAD is S without its last line (ctHash): build it with an empty
	// ctHash and drop the trailing line.
	ct := g.Seal(nil, iv, append([]byte{0, 0}, doc...), []byte(hdr.AAD()))
	hdr.CTHash = tcrypto.CTHash(iv, ct)
	sig := b64(tcrypto.SignP1363(p.sig, []byte(hdr.SignedString())))
	return map[string]any{"n": n, "base": n - 1, "prev": prev, "epoch": epoch, "rseq": rseq, "author": p.id, "dev": p.devID, "at": at,
		"ctHash": hdr.CTHash, "sig": sig, "iv": b64(iv), "ct": b64(ct)}
}

// push pushes doc on top of the current head (as the server reports it).
func (p *person) push(site, doc string, events ...map[string]any) resp {
	p.e.t.Helper()
	n, h, epoch, rseq := p.head(site)
	return p.pushAt(site, n, h, epoch, rseq, doc, events...)
}

func (p *person) pushAt(site string, base int64, prev string, epoch, rseq int64, doc string, events ...map[string]any) resp {
	p.e.t.Helper()
	body := map[string]any{"rev": p.envelope(site, base+1, prev, epoch, rseq, doc)}
	if len(events) > 0 {
		body["events"] = events
	}
	return p.b.post("/api/sites/"+site+"/revs", body)
}

// invite sends an invitation and returns the token from the mail sink.
func (p *person) invite(site, email, role string) string {
	p.e.t.Helper()
	r := p.b.post("/api/sites/"+site+"/invites", map[string]any{"email": email, "role": role, "lang": "en"})
	if r.Code != 201 {
		p.e.t.Fatalf("invite: %d %s", r.Code, r.Body.String())
	}
	m := p.e.lastMail(strings.ToLower(email), "invite")
	if m == nil {
		p.e.t.Fatal("no invite mail")
	}
	_, tok, ok := strings.Cut(m.Link, "#invite=")
	if !ok {
		p.e.t.Fatalf("invite link %q", m.Link)
	}
	return tok
}

// join invites email with role, signs them in, sets up their keys, accepts
// and has p give access. It returns the new member.
func (p *person) join(site, email, role string) *person {
	p.e.t.Helper()
	tok := p.invite(site, email, role)
	m := p.e.newPerson(email, "")
	if r := m.b.post("/api/invites/accept", map[string]any{"token": tok}); r.Code != 200 {
		p.e.t.Fatalf("accept: %d %s", r.Code, r.Body.String())
	}
	p.grant(site, m)
	return m
}

// grant gives waiting members access with the current epoch's key, listing
// the granted members plus them in the next roster.
func (p *person) grant(site string, ms ...*person) resp {
	p.e.t.Helper()
	r := p.grantRaw(site, ms...)
	if r.Code != 200 {
		p.e.t.Fatalf("grant: %d %s", r.Code, r.Body.String())
	}
	return r
}

func (p *person) grantRaw(site string, ms ...*person) resp {
	p.e.t.Helper()
	_, _, epoch, rseq := p.head(site)
	roster := p.currentRoster(site)
	var wraps []map[string]any
	for _, m := range ms {
		roster = append(roster, rm{m, p.e.roleOf(site, m.id)})
		wraps = append(wraps, p.siteWrap(site, epoch, m))
		p.shareKeys(site, m)
	}
	return p.b.post("/api/sites/"+site+"/grant", map[string]any{"roster": p.roster(site, rseq+1, epoch, roster...), "wraps": wraps})
}

// people maps user ids to the persons a test made (for rosters).
var people sync.Map

func (p *person) currentRoster(site string) []rm {
	p.e.t.Helper()
	r := p.b.get("/api/sites/" + site)
	if r.Code != 200 {
		p.e.t.Fatalf("site: %d %s", r.Code, r.Body.String())
	}
	var out []rm
	for _, x := range r.json()["members"].([]any) {
		m := x.(map[string]any)
		if m["status"] != "granted" {
			continue
		}
		q, ok := people.Load(m["user"].(string))
		if !ok {
			p.e.t.Fatalf("unknown member %v", m["user"])
		}
		out = append(out, rm{q.(*person), m["role"].(string)})
	}
	return out
}

func (e *aenv) roleOf(site, user string) string {
	var role string
	e.st.R.QueryRow("SELECT role FROM members WHERE site_id = ? AND user_id = ?", site, user).Scan(&role)
	return role
}

func (e *aenv) count(q string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.st.R.QueryRow(q, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

// mailBody reads the .eml of the newest message of kind to addr.
func (e *aenv) mailBody(to, kind string) string {
	e.t.Helper()
	m := e.lastMail(to, kind)
	if m == nil {
		e.t.Fatalf("no %s mail to %s", kind, to)
	}
	raw, err := readFile(filepath.Join(e.cfg.MailDir, filepath.Base(m.File)))
	if err != nil {
		e.t.Fatal(err)
	}
	return plainText(e.t, raw)
}

// plainText decodes the text/plain part of a message (quoted-printable).
func plainText(t *testing.T, raw string) string {
	t.Helper()
	msg, err := netmail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	_, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	mr := multipart.NewReader(msg.Body, params["boundary"])
	for {
		part, err := mr.NextPart()
		if err != nil {
			t.Fatal("no text/plain part")
		}
		if strings.HasPrefix(part.Header.Get("Content-Type"), "text/plain") {
			b, _ := io.ReadAll(part) // multipart decodes quoted-printable
			return msg.Header.Get("Subject") + "\n" + string(b)
		}
	}
}

// sse is an open GET /api/events stream.
type sse struct {
	mu     sync.Mutex
	h      http.Header
	buf    bytes.Buffer
	code   int
	cancel context.CancelFunc
	done   chan struct{}
}

func (s *sse) Header() http.Header { return s.h }
func (s *sse) WriteHeader(c int)   { s.mu.Lock(); s.code = c; s.mu.Unlock() }
func (s *sse) Write(b []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.code == 0 {
		s.code = 200
	}
	return s.buf.Write(b)
}
func (s *sse) Flush()       {}
func (s *sse) text() string { s.mu.Lock(); defer s.mu.Unlock(); return s.buf.String() }

// open starts an event stream for the browser.
func (b *browser) open() *sse {
	ctx, cancel := context.WithCancel(context.Background())
	s := &sse{h: http.Header{}, cancel: cancel, done: make(chan struct{})}
	req := httptest.NewRequest("GET", b.e.origin+"/api/events", nil).WithContext(ctx)
	req.RemoteAddr = b.ip + ":40000"
	for _, c := range b.cookies {
		req.AddCookie(&http.Cookie{Name: c.Name, Value: c.Value})
	}
	go func() { defer close(s.done); b.e.srv.ServeHTTP(s, req) }()
	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(s.text(), "retry:") && time.Now().Before(deadline) {
		select {
		case <-s.done:
			return s
		case <-time.After(2 * time.Millisecond):
		}
	}
	return s
}

// wait waits until the stream holds want.
func (s *sse) wait(t *testing.T, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(s.text(), want) {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("stream never got %q; has %q", want, s.text())
}

// ended reports whether the handler returned within a second.
func (s *sse) ended() bool {
	select {
	case <-s.done:
		return true
	case <-time.After(time.Second):
		return false
	}
}

var _ = store.ErrNotFound

func readFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	return string(b), err
}
