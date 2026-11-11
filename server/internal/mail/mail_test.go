package mail

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"math/big"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"carino.systems/topo/server/internal/config"
)

var sample = Data{
	"code": "012345", "minutes": "10", "link": "https://topo.example.com/#signin=abc", "url": "https://topo.example.com/",
	"inviter": "ana@example.com", "role": "provider", "email": "bo@example.com", "n": "3", "time": "2026-11-10 09:00 UTC",
}

func TestEveryKeyInEveryLocale(t *testing.T) {
	en := locales["en"]
	for _, lang := range Langs {
		m, ok := locales[lang]
		if !ok {
			t.Fatalf("no locale %s", lang)
		}
		for k := range en {
			v, ok := m[k]
			if !ok || strings.TrimSpace(v) == "" {
				t.Errorf("%s: missing %s", lang, k)
				continue
			}
			// Same placeholders as English.
			re := regexp.MustCompile(`\{[a-z]+\}`)
			if a, b := strings.Join(sorted(re.FindAllString(en[k], -1)), ","), strings.Join(sorted(re.FindAllString(v, -1)), ","); a != b {
				t.Errorf("%s %s: placeholders %s, English has %s", lang, k, b, a)
			}
		}
		for k := range m {
			if _, ok := en[k]; !ok {
				t.Errorf("%s: extra key %s", lang, k)
			}
		}
		if lang == "ja" {
			for k, v := range m {
				if strings.Contains(v, "パソコン") {
					t.Errorf("ja %s says パソコン (the fleet says PC)", k)
				}
			}
		}
	}
}

func sorted(s []string) []string {
	for i := range s {
		for j := i + 1; j < len(s); j++ {
			if s[j] < s[i] {
				s[i], s[j] = s[j], s[i]
			}
		}
	}
	return s
}

var hrefRe = regexp.MustCompile(`https?://[^\s"'<>]+`)

func TestRenderEveryKindEveryLocale(t *testing.T) {
	for _, kind := range Kinds {
		for _, lang := range Langs {
			for _, named := range []bool{false, true} {
				d := Data{}
				for k, v := range sample {
					d[k] = v
				}
				if named {
					d["name"] = "Clínica Sol"
				}
				m, err := Render(kind, lang, d)
				if err != nil {
					t.Fatalf("%s %s: %v", kind, lang, err)
				}
				for _, part := range []string{m.Subject, m.Text, m.HTML} {
					if strings.Contains(part, "{") || strings.Contains(part, "}") {
						t.Errorf("%s %s: placeholder left in %q", kind, lang, part)
					}
				}
				if m.Subject == "" || m.Text == "" {
					t.Errorf("%s %s: empty", kind, lang)
				}
				if strings.Contains(strings.ToLower(m.HTML), "<img") || strings.Contains(m.HTML, "src=") || strings.Contains(m.HTML, "url(") {
					t.Errorf("%s %s: remote content in HTML", kind, lang)
				}
				for _, u := range hrefRe.FindAllString(m.HTML+m.Text, -1) {
					u = strings.TrimRight(u, ".,")
					if u != sample["link"] && u != sample["url"] && !strings.HasPrefix(u, "https://topo.example.com/") {
						t.Errorf("%s %s: foreign URL %s", kind, lang, u)
					}
				}
				if strings.Count(m.HTML, "<a ") != 1 {
					t.Errorf("%s %s: want one link button, got %d", kind, lang, strings.Count(m.HTML, "<a "))
				}
				if named && kind != "signin" && kind != "welcome" && kind != "test" && kind != "link-request" && kind != "report" && !strings.Contains(m.Text, "Clínica Sol") {
					t.Errorf("%s %s: name allowed in clear but not shown", kind, lang)
				}
				if !named && strings.Contains(m.Text+m.Subject, "Clínica") {
					t.Errorf("%s %s: name leaked", kind, lang)
				}
			}
		}
	}
	// The sign-in code is in the subject and the body; the link only in the body.
	m, _ := Render("signin", "es", sample)
	if !strings.Contains(m.Subject, "012345") || !strings.Contains(m.Text, "012345") || !strings.Contains(m.Text, sample["link"]) || m.Code != "012345" {
		t.Fatalf("signin: %+v", m)
	}
	if strings.Contains(m.Text, "Notificaciones") {
		t.Fatal("sign-in mail has the notifications footer")
	}
	m, _ = Render("visit-recorded", "en", sample)
	if !strings.Contains(m.Text, "Visits recorded on one of your sites: 3") || !strings.Contains(m.Text, "Notifications") {
		t.Fatalf("visit digest: %s", m.Text)
	}
	m, _ = Render("member-joined", "ru", Data{"email": "bo@example.com", "reason": "keys", "url": "https://x.example/"})
	if !strings.Contains(m.Text, "ключи") {
		t.Fatalf("keys reason: %s", m.Text)
	}
	m, _ = Render("invite", "ja", sample)
	if !strings.Contains(m.Text, "プロバイダー") {
		t.Fatalf("role not translated: %s", m.Text)
	}
	m, _ = Render("signin", "xx", sample)
	if m.Lang != "en" || !strings.Contains(m.Subject, "sign-in code") {
		t.Fatalf("fallback: %+v", m)
	}
	if _, err := Render("nope", "en", sample); err == nil {
		t.Fatal("unknown kind rendered")
	}
}

// The infrastructure link (D88): incident-sent and report name it "Follow
// the infrastructure link", a hyperlink in HTML and "…: URL" in text.
func TestInfrastructureLinkWording(t *testing.T) {
	want := map[string]string{"en": "Follow the infrastructure link", "es": "Siga el enlace de la infraestructura", "pt-BR": "Siga o link da infraestrutura",
		"ja": "インフラのリンクを開く", "ru": "Перейдите по ссылке на инфраструктуру"}
	for lang, w := range want {
		m, err := Render("incident-sent", lang, Data{"url": "https://topo.example.com/"})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(m.HTML, `<a href="https://topo.example.com/"`) || !strings.Contains(m.HTML, ">"+w+"</a>") {
			t.Errorf("%s incident-sent HTML: %s", lang, m.HTML)
		}
		if !strings.Contains(m.Text, w+": https://topo.example.com/") {
			t.Errorf("%s incident-sent text: %s", lang, m.Text)
		}
	}
	// Other kinds keep "Open Topo".
	if m, _ := Render("visit-recorded", "en", Data{"url": "https://topo.example.com/"}); !strings.Contains(m.HTML, ">Open Topo</a>") || strings.Contains(m.Text, "infrastructure") {
		t.Errorf("visit-recorded: %s", m.Text)
	}
}

// The report kind (D87): the client's lines escaped, the fixed template
// around them, Reply-To the sender.
func TestReportRender(t *testing.T) {
	link := "https://topo.example.com/#e~abc"
	d := Data{"subject": "Network problem at Office: No internet\r", "lines": "My <b>words</b> & more\n\nProblem: No internet\nWhere: Reception PC",
		"link": link, "phone": "+52 55 1234 5678", "pass": "1", "email": "ana@example.com", "replyTo": "ana@example.com", "url": "https://topo.example.com/"}
	d["subject"] = "Network problem at Office: No internet"
	for _, lang := range Langs {
		m, err := Render("report", lang, d)
		if err != nil {
			t.Fatal(err)
		}
		infra, _ := lookup(lang, "infra.link")
		if !strings.Contains(m.HTML, `<a href="`+link+`"`) || !strings.Contains(m.HTML, ">"+infra+"</a>") {
			t.Errorf("%s: no infrastructure hyperlink: %s", lang, m.HTML)
		}
		if !strings.Contains(m.Text, infra+": "+link) {
			t.Errorf("%s: plain link line: %s", lang, m.Text)
		}
		if !strings.Contains(m.HTML, `<a href="tel:+525512345678"`) || !strings.Contains(m.Text, "+52 55 1234 5678") {
			t.Errorf("%s: phone: %s", lang, m.HTML)
		}
		if strings.Contains(m.HTML, "<b>words</b>") || !strings.Contains(m.HTML, "My &lt;b&gt;words&lt;/b&gt; &amp; more") {
			t.Errorf("%s: lines not escaped: %s", lang, m.HTML)
		}
		if !strings.Contains(m.Text, "My <b>words</b> & more") || !strings.Contains(m.Text, "ana@example.com") || !strings.Contains(m.Text, "https://topo.example.com/") {
			t.Errorf("%s: text: %s", lang, m.Text)
		}
		pass, _ := lookup(lang, "report.pass")
		if !strings.Contains(m.Text, pass) {
			t.Errorf("%s: passphrase note missing", lang)
		}
		if m.Subject != "Network problem at Office: No internet" || m.ReplyTo != "ana@example.com" || strings.Count(m.HTML, "<a ") != 2 {
			t.Errorf("%s: %+v", lang, m)
		}
	}
	m, _ := Render("report", "en", d)
	m.To = "bo@example.com"
	raw, err := m.Bytes("Topo <topo@example.com>", "topo.example.com", time.Unix(0, 0))
	if err != nil || !strings.Contains(string(raw), "\r\nReply-To: <ana@example.com>\r\n") || !strings.HasPrefix(string(raw), "From: \"Topo\" <topo@example.com>\r\n") {
		t.Fatalf("headers: %v %s", err, raw)
	}
	// A Reply-To with a line break or a display name is refused.
	m.ReplyTo = "a@example.com\r\nBcc: x@example.com"
	if _, err := m.Bytes("Topo <topo@example.com>", "h", time.Unix(0, 0)); err == nil {
		t.Fatal("reply-to injection accepted")
	}
	if _, err := Render("report", "en", Data{"link": link, "replyTo": "a@example.com\nBcc: x"}); err != ErrHeader {
		t.Fatal("reply-to with a line break rendered")
	}
	// No phone digits: no tel: link; no link: no pass note.
	m, _ = Render("report", "en", Data{"lines": "x", "phone": "call me", "pass": "1"})
	if strings.Contains(m.HTML, "tel:") || strings.Contains(m.Text, "passphrase") || m.Subject == "" {
		t.Fatalf("bare report: %+v", m)
	}
}

func TestHTMLEscapesValues(t *testing.T) {
	m, err := Render("invite", "en", Data{"inviter": "a@example.com", "role": "viewer", "name": `<script>x</script> & "q"`, "link": "https://t.example/#invite=a.b"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(m.HTML, "<script>") || !strings.Contains(m.HTML, "&lt;script&gt;") {
		t.Fatalf("not escaped: %s", m.HTML)
	}
}

// B7: a site name with a line break cannot add a header.
func TestHeaderInjection(t *testing.T) {
	m, err := Render("invite", "en", Data{"inviter": "a@example.com", "role": "viewer", "name": "Lab\r\nBcc: evil@example.com\r\n\r\nhi", "link": "https://t.example/#invite=x"})
	if err != nil {
		t.Fatal(err)
	}
	m.To, m.ID = "bo@example.com", "o_1"
	raw, err := m.Bytes("Topo <topo@example.com>", "topo.example.com", time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	head := string(raw[:bytes.Index(raw, []byte("\r\n\r\n"))])
	if strings.Contains(strings.ToLower(head), "\nbcc:") {
		t.Fatalf("injected header:\n%s", head)
	}
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	subj, _ := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if !strings.Contains(subj, "Lab Bcc: evil@example.com hi") || len(msg.Header["Subject"]) != 1 || msg.Header.Get("Bcc") != "" {
		t.Fatalf("subject %q headers %v", subj, msg.Header)
	}
	// An inviter or code with a line break is refused outright.
	if _, err := Render("invite", "en", Data{"inviter": "a@example.com\r\nBcc: x@y.z"}); err == nil {
		t.Fatal("line break in inviter rendered")
	}
	// A recipient with a display name or a line break is refused.
	for _, to := range []string{"x@example.com\r\nBcc: y@example.com", "Evil <x@example.com>", "a@example.com, b@example.com"} {
		m.To = to
		if _, err := m.Bytes("Topo <topo@example.com>", "h", time.Now()); err == nil {
			t.Errorf("to %q accepted", to)
		}
	}
	if _, err := (&Message{To: "a@example.com"}).Bytes("Topo <topo@example.com>\r\nBcc: x@y.z", "h", time.Now()); err == nil {
		t.Fatal("from with a line break accepted")
	}
	// Long names are clipped to 80 runes.
	if n := []rune(CleanName(strings.Repeat("ñ", 200))); len(n) != 80 {
		t.Fatalf("clip %d", len(n))
	}
}

func parse(t *testing.T, raw []byte) (*mail.Message, string, string) {
	t.Helper()
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	_, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	mr := multipart.NewReader(msg.Body, params["boundary"])
	var text, html string
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(p) // multipart decodes quoted-printable itself
		if strings.HasPrefix(p.Header.Get("Content-Type"), "text/plain") {
			text = string(b)
		} else {
			html = string(b)
		}
	}
	return msg, text, html
}

func TestBytesStructure(t *testing.T) {
	m, _ := Render("signin", "ja", sample)
	m.To, m.ID = "bo@example.com", "o_abc"
	raw, err := m.Bytes("Topo <topo@example.com>", "topo.example.com", time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(bytes.ReplaceAll(raw, []byte("\r\n"), nil), []byte("\n")) {
		t.Fatal("bare LF in message")
	}
	msg, text, html := parse(t, raw)
	h := msg.Header
	if h.Get("Message-ID") != "<o_abc@topo.example.com>" || h.Get("Auto-Submitted") != "auto-generated" || h.Get("X-Auto-Response-Suppress") != "All" || h.Get("To") != "<bo@example.com>" {
		t.Fatalf("headers %v", h)
	}
	subj, _ := new(mime.WordDecoder).DecodeHeader(h.Get("Subject"))
	if subj != m.Subject {
		t.Fatalf("subject %q", subj)
	}
	crlf := func(s string) string { return strings.ReplaceAll(s, "\r\n", "\n") }
	if crlf(text) != m.Text || crlf(html) != m.HTML {
		t.Fatalf("parts do not round trip:\n%q\n%q", crlf(text), m.Text)
	}
}

func testCfg(t *testing.T, env ...string) *config.Config {
	t.Helper()
	r, err := config.Load(config.Options{Environ: append([]string{"TOPO_DATA=" + t.TempDir()}, env...)})
	if err != nil {
		t.Fatal(err)
	}
	return r.Config
}

func TestFileSink(t *testing.T) {
	cfg := testCfg(t, "TOPO_MAIL=file")
	now := time.UnixMilli(1_700_000_000_123)
	m, err := New(cfg, nil, Options{Now: func() time.Time { return now }})
	if err != nil || m.Name() != "file" {
		t.Fatal(m, err)
	}
	msg, _ := Render("signin", "en", sample)
	msg.To, msg.ID, msg.Site = "bo@example.com", "o_x", ""
	if err := m.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	msg2, _ := Render("granted", "es", Data{"url": "http://127.0.0.1:7380/"})
	msg2.To, msg2.ID, msg2.Site = "ana@example.com", "o_y", "s_1"
	if err := m.Send(context.Background(), msg2); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(cfg.MailDir, "outbox.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) != 2 {
		t.Fatalf("%d lines", len(lines))
	}
	var l SinkLine
	json.Unmarshal([]byte(lines[0]), &l)
	if l.Kind != "signin" || l.To != "bo@example.com" || l.Code != "012345" || l.Link != sample["link"] || l.At != now.UnixMilli() || l.File != "1700000000123-o_x.eml" {
		t.Fatalf("line %+v", l)
	}
	l = SinkLine{}
	json.Unmarshal([]byte(lines[1]), &l)
	if l.Code != "" || l.Site != "s_1" || l.Lang != "es" {
		t.Fatalf("line %+v", l)
	}
	st, err := os.Stat(filepath.Join(cfg.MailDir, l.File))
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("eml %v %v", st, err)
	}
	raw, _ := os.ReadFile(filepath.Join(cfg.MailDir, "1700000000123-o_x.eml"))
	if _, text, _ := parse(t, raw); !strings.Contains(text, "012345") {
		t.Fatal("eml has no code")
	}
}

func TestLogTransportHidesCodes(t *testing.T) {
	cfg := testCfg(t, "TOPO_MAIL=log")
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	m, _ := New(cfg, log, Options{})
	msg, _ := Render("signin", "en", sample)
	msg.To = "bo@example.com"
	if err := m.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if strings.Contains(out, "012345") || strings.Contains(out, "bo@example.com") || !strings.Contains(out, "b***@example.com") {
		t.Fatalf("log line %q", out)
	}
	buf.Reset()
	log = slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	m, _ = New(cfg, log, Options{})
	m.Send(context.Background(), msg)
	if !strings.Contains(buf.String(), "012345") {
		t.Fatal("debug level should show the code for development")
	}
}

// ---- a fake SMTP server ----

type fakeSMTP struct {
	t        *testing.T
	ln       net.Listener
	tlsCfg   *tls.Config
	starttls bool   // offer STARTTLS
	implicit bool   // TLS from the first byte (465)
	authMech string // "PLAIN", "LOGIN" or ""
	user     string
	pass     string

	mu   sync.Mutex
	got  []fakeMail
	cmds []string
}

type fakeMail struct {
	from, to string
	data     []byte
	tls      bool
	authed   bool
}

func selfSigned(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"}, DNSNames: []string{"localhost"},
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := x509.ParseCertificate(der)
	pool := x509.NewCertPool()
	pool.AddCert(c)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, pool
}

func startFake(t *testing.T, f *fakeSMTP) (port string, pool *x509.CertPool) {
	t.Helper()
	cert, pool := selfSigned(t)
	f.t = t
	f.tlsCfg = &tls.Config{Certificates: []tls.Certificate{cert}}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f.ln = ln
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(c)
		}
	}()
	_, port, _ = net.SplitHostPort(ln.Addr().String())
	return port, pool
}

func (f *fakeSMTP) serve(c net.Conn) {
	defer c.Close()
	c.SetDeadline(time.Now().Add(10 * time.Second))
	isTLS := false
	if f.implicit {
		c = tls.Server(c, f.tlsCfg)
		isTLS = true
	}
	r, w := bufio.NewReader(c), bufio.NewWriter(c)
	say := func(s string) { w.WriteString(s + "\r\n"); w.Flush() }
	say("220 fake ESMTP")
	cur := fakeMail{}
	authed := false
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		f.mu.Lock()
		f.cmds = append(f.cmds, line)
		f.mu.Unlock()
		up := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(up, "EHLO"):
			w.WriteString("250-fake\r\n")
			if f.starttls && !isTLS {
				w.WriteString("250-STARTTLS\r\n")
			}
			if f.authMech != "" {
				w.WriteString("250-AUTH " + f.authMech + "\r\n")
			}
			say("250 8BITMIME")
		case up == "STARTTLS":
			say("220 go ahead")
			tc := tls.Server(c, f.tlsCfg)
			if err := tc.Handshake(); err != nil {
				return
			}
			c, isTLS = tc, true
			r, w = bufio.NewReader(c), bufio.NewWriter(c)
		case strings.HasPrefix(up, "AUTH PLAIN"):
			arg := strings.TrimSpace(line[len("AUTH PLAIN"):])
			if arg == "" {
				say("334 ")
				arg, _ = r.ReadString('\n')
				arg = strings.TrimSpace(arg)
			}
			b, _ := base64.StdEncoding.DecodeString(arg)
			parts := strings.Split(string(b), "\x00")
			if len(parts) == 3 && parts[1] == f.user && parts[2] == f.pass {
				authed = true
				say("235 ok")
			} else {
				say("535 bad")
			}
		case up == "AUTH LOGIN":
			say("334 " + base64.StdEncoding.EncodeToString([]byte("Username:")))
			u, _ := r.ReadString('\n')
			say("334 " + base64.StdEncoding.EncodeToString([]byte("Password:")))
			p, _ := r.ReadString('\n')
			ub, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(u))
			pb, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(p))
			if string(ub) == f.user && string(pb) == f.pass {
				authed = true
				say("235 ok")
			} else {
				say("535 bad")
			}
		case strings.HasPrefix(up, "MAIL FROM:"):
			addr, _, _ := strings.Cut(line[10:], ">")
			cur = fakeMail{from: strings.Trim(addr, "<> "), tls: isTLS, authed: authed}
			say("250 ok")
		case strings.HasPrefix(up, "RCPT TO:"):
			addr, _, _ := strings.Cut(line[8:], ">")
			cur.to = strings.Trim(addr, "<> ")
			say("250 ok")
		case up == "DATA":
			say("354 go")
			var buf bytes.Buffer
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				buf.WriteString(strings.TrimPrefix(l, "."))
			}
			cur.data = buf.Bytes()
			f.mu.Lock()
			f.got = append(f.got, cur)
			f.mu.Unlock()
			say("250 queued")
		case up == "QUIT":
			say("221 bye")
			return
		default:
			say("502 what")
		}
	}
}

func smtpMailer(t *testing.T, port string, pool *x509.CertPool, env ...string) Mailer {
	t.Helper()
	cfg := testCfg(t, append([]string{"TOPO_SMTP_HOST=localhost", "TOPO_SMTP_PORT=" + port, "TOPO_SMTP_FROM=Topo <topo@example.com>"}, env...)...)
	m, err := New(cfg, nil, Options{RootCAs: pool})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func sendSample(m Mailer) error {
	msg, _ := Render("signin", "pt-BR", sample)
	msg.To, msg.ID = "bo@example.com", "o_t"
	return m.Send(context.Background(), msg)
}

func TestSMTPStartTLSPlain(t *testing.T) {
	f := &fakeSMTP{starttls: true, authMech: "PLAIN LOGIN", user: "u@example.com", pass: "s3cret"}
	port, pool := startFake(t, f)
	m := smtpMailer(t, port, pool, "TOPO_SMTP_USER=u@example.com", "TOPO_SMTP_PASS=s3cret")
	if err := sendSample(m); err != nil {
		t.Fatal(err)
	}
	if len(f.got) != 1 || !f.got[0].tls || !f.got[0].authed || f.got[0].from != "topo@example.com" || f.got[0].to != "bo@example.com" {
		t.Fatalf("%+v", f.got)
	}
	if _, text, _ := parse(t, f.got[0].data); !strings.Contains(text, "012345") {
		t.Fatal("body")
	}
	// The password never went over the wire before STARTTLS.
	sawTLS := false
	for _, c := range f.cmds {
		if c == "STARTTLS" {
			sawTLS = true
		}
		if strings.HasPrefix(strings.ToUpper(c), "AUTH") && !sawTLS {
			t.Fatal("AUTH before STARTTLS")
		}
	}
}

func TestSMTPLoginFallback(t *testing.T) {
	f := &fakeSMTP{starttls: true, authMech: "LOGIN", user: "u", pass: "p"}
	port, pool := startFake(t, f)
	if err := sendSample(smtpMailer(t, port, pool, "TOPO_SMTP_USER=u", "TOPO_SMTP_PASS=p")); err != nil {
		t.Fatal(err)
	}
	if len(f.got) != 1 || !f.got[0].authed {
		t.Fatalf("%+v", f.got)
	}
	// A wrong password is an error, not a silent drop.
	f2 := &fakeSMTP{starttls: true, authMech: "LOGIN", user: "u", pass: "p"}
	port2, pool2 := startFake(t, f2)
	if err := sendSample(smtpMailer(t, port2, pool2, "TOPO_SMTP_USER=u", "TOPO_SMTP_PASS=wrong")); err == nil || len(f2.got) != 0 {
		t.Fatalf("wrong password: %v %d", err, len(f2.got))
	}
}

func TestSMTPRefusesWithoutStartTLS(t *testing.T) {
	f := &fakeSMTP{starttls: false, authMech: "PLAIN", user: "u", pass: "p"}
	port, pool := startFake(t, f)
	err := sendSample(smtpMailer(t, port, pool, "TOPO_SMTP_USER=u", "TOPO_SMTP_PASS=p"))
	if err != ErrNoStartTLS || len(f.got) != 0 {
		t.Fatalf("err %v, %d sent", err, len(f.got))
	}
	for _, c := range f.cmds {
		if strings.HasPrefix(strings.ToUpper(c), "AUTH") || strings.HasPrefix(strings.ToUpper(c), "MAIL") {
			t.Fatalf("sent %q in clear", c)
		}
	}
}

func TestSMTPImplicitTLS(t *testing.T) {
	f := &fakeSMTP{implicit: true, authMech: "PLAIN", user: "u", pass: "p"}
	port, pool := startFake(t, f)
	if err := sendSample(smtpMailer(t, port, pool, "TOPO_SMTP_SECURITY=tls", "TOPO_SMTP_USER=u", "TOPO_SMTP_PASS=p")); err != nil {
		t.Fatal(err)
	}
	if len(f.got) != 1 || !f.got[0].tls || !f.got[0].authed {
		t.Fatalf("%+v", f.got)
	}
}

func TestSMTPUntrustedCertRefused(t *testing.T) {
	f := &fakeSMTP{starttls: true}
	port, _ := startFake(t, f)
	if err := sendSample(smtpMailer(t, port, nil)); err == nil || len(f.got) != 0 {
		t.Fatalf("self-signed cert accepted: %v", err)
	}
}

func TestSMTPPlainRelayOnLoopback(t *testing.T) {
	f := &fakeSMTP{}
	port, _ := startFake(t, f)
	if err := sendSample(smtpMailer(t, port, nil, "TOPO_SMTP_SECURITY=none")); err != nil {
		t.Fatal(err)
	}
	if len(f.got) != 1 || f.got[0].tls {
		t.Fatalf("%+v", f.got)
	}
}

func TestMask(t *testing.T) {
	if Mask("ana@example.com") != "a***@example.com" || Mask("bad") != "***" {
		t.Fatal(Mask("ana@example.com"))
	}
}

// An address listen (IPv6 loopback, an IPv4 address) with no From set
// still builds a mailer: the default From uses localhost and the EHLO name
// is an address literal.
func TestDefaultFromOnAddressHosts(t *testing.T) {
	for _, c := range []struct{ listen, helo string }{
		{"[::1]:7381", "[IPv6:::1]"},
		{"127.0.0.1:7381", "[127.0.0.1]"},
	} {
		r, err := config.Load(config.Options{Environ: []string{"TOPO_DATA=" + t.TempDir(), "TOPO_LISTEN=" + c.listen, "TOPO_MAIL=log"}})
		if err != nil {
			t.Fatalf("%s: %v", c.listen, err)
		}
		if r.Config.SMTP.HELO != c.helo {
			t.Errorf("%s: helo %q, want %q", c.listen, r.Config.SMTP.HELO, c.helo)
		}
		if _, err := New(r.Config, slog.New(slog.DiscardHandler), Options{}); err != nil {
			t.Errorf("%s: %v", c.listen, err)
		}
	}
}

// A client-chosen attachment name (D97): no path, no quotes or separators,
// no leading dots, the type's extension forced, at most 120 runes.
func TestCleanAttachName(t *testing.T) {
	for in, want := range map[string]string{
		"../../x.exe":                         "x.pdf",
		"topo_acme_casa_2026-11-10_fibra.pdf": "topo_acme_casa_2026-11-10_fibra.pdf",
		"topo_acme_casa_2026-11-10_fibra.PDF": "topo_acme_casa_2026-11-10_fibra.pdf",
		"":                                    "report.pdf",
		"...":                                 "report.pdf",
		".hidden":                             "hidden.pdf",
		"a\"b;c\r\nd.pdf":                     "abc d.pdf",
		`C:\Users\x\report.pdf`:               "report.pdf",
		"topo_東京_2026-11-10_光ファイバー.pdf": "topo_東京_2026-11-10_光ファイバー.pdf",
		"report.html": "report.pdf",
	} {
		if got := CleanAttachName(in, "application/pdf"); got != want {
			t.Errorf("%q -> %q, want %q", in, got, want)
		}
	}
	if n := []rune(CleanAttachName(strings.Repeat("ж", 300), "application/pdf")); len(n) != 120 {
		t.Fatalf("long name: %d runes", len(n))
	}
}

// With an attachment the message is multipart/mixed: the alternative
// (text and HTML, as without one), then the file in base64 lines of 76
// with its name (RFC 2231 when not ASCII). Without one, nothing changes.
func TestBytesWithAttachment(t *testing.T) {
	m, _ := Render("report", "ja", Data{"lines": "x", "link": "https://topo.example.com/#e~a", "attach": "報告書.pdf", "email": "a@example.com"})
	m.To, m.ID = "bo@example.com", "o_att"
	plain, err := m.Bytes("Topo <topo@example.com>", "topo.example.com", time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.Text, "報告書を添付しています: 報告書.pdf") || !strings.Contains(m.HTML, "報告書を添付しています") {
		t.Fatalf("attached line: %s", m.Text)
	}
	data := []byte("%PDF-1.4\n" + strings.Repeat("\x00\xff binary ", 500))
	m.Attachment = &Attachment{Name: "報告書.pdf", Type: "application/pdf", Data: data}
	raw, err := m.Bytes("Topo <topo@example.com>", "topo.example.com", time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(bytes.ReplaceAll(raw, []byte("\r\n"), nil), []byte("\n")) {
		t.Fatal("bare LF in message")
	}
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	mt, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if mt != "multipart/mixed" {
		t.Fatalf("top type %s", mt)
	}
	mr := multipart.NewReader(msg.Body, params["boundary"])
	alt, err := mr.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	amt, aparams, _ := mime.ParseMediaType(alt.Header.Get("Content-Type"))
	if amt != "multipart/alternative" {
		t.Fatalf("first part %s", amt)
	}
	ar := multipart.NewReader(alt, aparams["boundary"])
	var text string
	for {
		p, err := ar.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(p)
		if strings.HasPrefix(p.Header.Get("Content-Type"), "text/plain") {
			text = string(b)
		}
	}
	if strings.ReplaceAll(text, "\r\n", "\n") != m.Text {
		t.Fatalf("text part: %q", text)
	}
	file, err := mr.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	if file.FileName() != "報告書.pdf" {
		t.Fatalf("filename %q (%s)", file.FileName(), file.Header.Get("Content-Disposition"))
	}
	if ct, p, _ := mime.ParseMediaType(file.Header.Get("Content-Type")); ct != "application/pdf" || p["name"] != "報告書.pdf" {
		t.Fatalf("file type %s %v", ct, p)
	}
	enc, _ := io.ReadAll(file)
	for _, l := range strings.Split(strings.TrimRight(string(enc), "\r\n"), "\r\n") {
		if len(l) > 76 {
			t.Fatalf("base64 line of %d", len(l))
		}
	}
	got, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(string(enc), "\r\n", ""))
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("attachment bytes differ: %v", err)
	}
	if _, err := mr.NextPart(); err != io.EOF {
		t.Fatal("a third part")
	}
	// Without the attachment, byte for byte what it always was.
	m.Attachment = nil
	again, _ := m.Bytes("Topo <topo@example.com>", "topo.example.com", time.Unix(1_700_000_000, 0))
	if mt, _, _ := mime.ParseMediaType(mustHeader(t, again)); mt != "multipart/alternative" || len(again) != len(plain) {
		t.Fatalf("no attachment: %s", mt)
	}
	// A type other than a PDF is refused at composing.
	m.Attachment = &Attachment{Name: "x.html", Type: "text/html", Data: []byte("<p>")}
	if _, err := m.Bytes("Topo <topo@example.com>", "h", time.Unix(0, 0)); err == nil {
		t.Fatal("html attachment composed")
	}
}

func mustHeader(t *testing.T, raw []byte) string {
	t.Helper()
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	return msg.Header.Get("Content-Type")
}

// The file sink names the attachment and its size.
func TestFileSinkAttachment(t *testing.T) {
	cfg := testCfg(t, "TOPO_MAIL=file")
	m, err := New(cfg, nil, Options{Now: func() time.Time { return time.UnixMilli(1_700_000_000_000) }})
	if err != nil {
		t.Fatal(err)
	}
	msg, _ := Render("report", "en", Data{"lines": "x", "attach": "r.pdf"})
	msg.To, msg.ID = "bo@example.com", "o_f"
	msg.Attachment = &Attachment{Name: "r.pdf", Type: "application/pdf", Data: []byte("%PDF-123")}
	if err := m.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(cfg.MailDir, "outbox.jsonl"))
	var l SinkLine
	json.Unmarshal(bytes.TrimSpace(b), &l)
	if l.Attachment != "r.pdf" || l.AttachmentBytes != 8 {
		t.Fatalf("sink line %+v", l)
	}
}
