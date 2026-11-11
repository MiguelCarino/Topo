package api

import (
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	netmail "net/mail"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// htmlPart decodes the text/html part and the headers of a sink message.
func (e *aenv) reportEml(to string) (netmail.Header, string, string) {
	e.t.Helper()
	m := e.lastMail(to, "report")
	if m == nil {
		e.t.Fatalf("no report mail to %s", to)
	}
	raw, err := readFile(filepath.Join(e.cfg.MailDir, filepath.Base(m.File)))
	if err != nil {
		e.t.Fatal(err)
	}
	msg, err := netmail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		e.t.Fatal(err)
	}
	_, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	mr := multipart.NewReader(msg.Body, params["boundary"])
	var text, html string
	for {
		part, err := mr.NextPart()
		if err != nil {
			break
		}
		b, _ := io.ReadAll(part)
		if strings.HasPrefix(part.Header.Get("Content-Type"), "text/html") {
			html = string(b)
		} else {
			text = string(b)
		}
	}
	return msg.Header, text, html
}

func TestReportMail(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	p := o.join(site, "prov@example.test", "provider")
	v := o.join(site, "view@example.test", "viewer")
	stranger := e.newPerson("stranger@example.test", "staff")
	e.clk.Add(10 * time.Minute)
	e.mails()

	if me := o.b.get("/api/me").json(); me["mailRelay"] != true {
		t.Fatalf("mailRelay with TOPO_MAIL=file: %v", me["mailRelay"])
	}
	path := "/api/sites/" + site + "/report-mail"
	link := e.origin + "/#e~sealed"
	body := func() map[string]any {
		return map[string]any{"to": []string{"outside@example.test", "Second@Example.test"}, "subject": "Network problem at Office: No internet",
			"lines": []string{"It stopped <b>at 9</b>", "", "Problem: No internet", "Reported by: Ana · ana@example.test"}, "link": link,
			"phone": "+52 55 1234 5678", "passphraseNote": true, "lang": "es"}
	}
	r := p.b.post(path, body())
	if r.Code != 202 || r.json()["queued"] != float64(2) {
		t.Fatalf("provider send: %d %s", r.Code, r.Body.String())
	}
	h, text, html := e.reportEml("outside@example.test")
	if h.Get("Reply-To") != "<prov@example.test>" || !strings.Contains(h.Get("From"), "topo@") {
		t.Fatalf("headers: reply-to %q from %q", h.Get("Reply-To"), h.Get("From"))
	}
	if !strings.Contains(html, `<a href="`+link+`"`) || !strings.Contains(html, ">Siga el enlace de la infraestructura</a>") {
		t.Fatalf("html link: %s", html)
	}
	if !strings.Contains(text, "Siga el enlace de la infraestructura: "+link) || !strings.Contains(text, "It stopped <b>at 9</b>") {
		t.Fatalf("text: %s", text)
	}
	if !strings.Contains(html, `href="tel:+525512345678"`) || strings.Contains(html, "<b>at 9</b>") || !strings.Contains(html, "&lt;b&gt;at 9") {
		t.Fatalf("html phone or escaping: %s", html)
	}
	if !strings.Contains(text, "prov@example.test") || !strings.Contains(text, e.origin) || !strings.Contains(text, "por otro medio") {
		t.Fatalf("footer or pass note: %s", text)
	}
	if e.lastMail("Second@Example.test", "report") == nil {
		t.Fatal("second address not sent")
	}
	// The owner may send too.
	if r := o.b.post(path, body()); r.Code != 202 {
		t.Fatalf("owner send: %d", r.Code)
	}
	// A viewer is 403, a stranger 404.
	if r := v.b.post(path, body()); r.Code != 403 {
		t.Fatalf("viewer: %d", r.Code)
	}
	if r := stranger.b.post(path, body()); r.Code != 404 {
		t.Fatalf("stranger: %d", r.Code)
	}
	// Refused bodies.
	bad := map[string]func(m map[string]any){
		"foreign link":    func(m map[string]any) { m["link"] = "https://evil.example/#e~x" },
		"lookalike host":  func(m map[string]any) { m["link"] = e.origin + ".evil.example/#x" },
		"user info":       func(m map[string]any) { m["link"] = strings.Replace(e.origin, "://", "://x@", 1) + "/#x" },
		"no link":         func(m map[string]any) { m["link"] = "" },
		"javascript link": func(m map[string]any) { m["link"] = "javascript:alert(1)//" + e.origin + "/" },
		"six addresses": func(m map[string]any) {
			m["to"] = []string{"a@x.test", "b@x.test", "c@x.test", "d@x.test", "e@x.test", "f@x.test"}
		},
		"no address":       func(m map[string]any) { m["to"] = []string{} },
		"display name":     func(m map[string]any) { m["to"] = []string{"Eve <eve@x.test>"} },
		"header injection": func(m map[string]any) { m["to"] = []string{"a@x.test\r\nBcc: z@x.test"} },
		"long subject":     func(m map[string]any) { m["subject"] = strings.Repeat("x", 201) },
		"empty subject":    func(m map[string]any) { m["subject"] = "" },
		"61 lines":         func(m map[string]any) { m["lines"] = make([]string, 61) },
		"6001 chars":       func(m map[string]any) { m["lines"] = []string{strings.Repeat("y", 6001)} },
		"long phone":       func(m map[string]any) { m["phone"] = strings.Repeat("5", 41) },
	}
	for name, mut := range bad {
		b := body()
		mut(b)
		if r := p.b.post(path, b); r.Code != 400 {
			t.Errorf("%s: %d %s", name, r.Code, r.Body.String())
		}
	}
	// A subject with a line break is flattened, never a header.
	b := body()
	b["subject"] = "Hi\r\nBcc: z@x.test"
	b["to"] = []string{"flat@example.test"}
	if r := p.b.post(path, b); r.Code != 202 {
		t.Fatalf("flattened subject: %d", r.Code)
	}
	if h, _, _ := e.reportEml("flat@example.test"); h.Get("Bcc") != "" || h.Get("Subject") != "Hi Bcc: z@x.test" {
		t.Fatalf("subject: %q bcc %q", h.Get("Subject"), h.Get("Bcc"))
	}
	// 10 per person per hour: p has sent 2, 8 more go, the 11th is 429.
	for i := 0; i < 8; i++ {
		if r := p.b.post(path, body()); r.Code != 202 {
			t.Fatalf("send %d: %d", i+3, r.Code)
		}
	}
	r = p.b.post(path, body())
	if r.Code != 429 || r.json()["error"] != ErrRateLimited || r.Header().Get("Retry-After") == "" || r.json()["limit"] != "user" {
		t.Fatalf("11th send: %d %s", r.Code, r.Body.String())
	}
	// An hour later p may send again.
	e.clk.Add(61 * time.Minute)
	if r := p.b.post(path, body()); r.Code != 202 {
		t.Fatalf("after an hour: %d", r.Code)
	}
}

// 30 per site per day, whoever sends (the bucket refills 30 a day, so the
// sends here are made without the clock moving).
func TestReportMailSiteLimit(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	ws := []*person{o, o.join(site, "p1@example.test", "provider"), o.join(site, "p2@example.test", "provider"), o.join(site, "p3@example.test", "provider")}
	path := "/api/sites/" + site + "/report-mail"
	body := map[string]any{"to": []string{"outside@example.test"}, "subject": "s", "lines": []string{"x"}, "link": e.origin + "/#e~x"}
	for i := 0; i < ReportPerSiteDay; i++ {
		if r := ws[i/ReportPerUserHour].b.post(path, body); r.Code != 202 {
			t.Fatalf("send %d: %d %s", i+1, r.Code, r.Body.String())
		}
	}
	r := ws[3].b.post(path, body)
	if r.Code != 429 || r.json()["limit"] != "site" {
		t.Fatalf("31st site send: %d %s", r.Code, r.Body.String())
	}
	// The refused site send did not spend p3's own allowance.
	e.clk.Add(2 * time.Hour)
	if r := ws[3].b.post(path, body); r.Code != 202 {
		t.Fatalf("after the site refilled a little: %d", r.Code)
	}
}

func TestReportMailNeedsARelay(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	// Signed in through the file sink, then the server's mail is "log".
	e.cfg.Mail = "log"
	if me := o.b.get("/api/me").json(); me["mailRelay"] != false {
		t.Fatalf("mailRelay with TOPO_MAIL=log: %v", me["mailRelay"])
	}
	r := o.b.post("/api/sites/"+site+"/report-mail", map[string]any{"to": []string{"a@x.test"}, "subject": "s", "link": e.origin + "/#x"})
	if r.Code != 503 {
		t.Fatalf("send without a relay: %d", r.Code)
	}
}

// The provider report attached (D97): a PDF only, at most ReportMaxAttach
// bytes, its name cleaned; stored once for every address, gone once sent.
func TestReportMailAttachment(t *testing.T) {
	e := newAuthEnv(t, "TOPO_OWNER_EMAIL="+ownerEmail)
	o := e.newPerson(ownerEmail, "")
	site := o.createSite()
	e.clk.Add(10 * time.Minute)
	e.mails()
	path := "/api/sites/" + site + "/report-mail"
	pdf := []byte("%PDF-1.7\n" + strings.Repeat("report \x00\xff ", 2000))
	body := func(att map[string]any) map[string]any {
		return map[string]any{"to": []string{"a@example.test", "b@example.test", "c@example.test", "d@example.test", "e@example.test"},
			"subject": "Network problem", "lines": []string{"x"}, "link": e.origin + "/#e~sealed", "lang": "en", "attachment": att}
	}
	good := func() map[string]any {
		return map[string]any{"name": "../../x.exe", "type": "application/pdf", "dataBase64": base64.StdEncoding.EncodeToString(pdf)}
	}
	// Five addresses, one stored file, held until they are sent.
	r := o.b.post(path, body(good()))
	if r.Code != 202 || r.json()["attachment"] != "x.pdf" {
		t.Fatalf("send: %d %s", r.Code, r.Body.String())
	}
	if n := e.count("SELECT count(*) FROM mail_files"); n != 1 {
		t.Fatalf("mail_files rows: %d", n)
	}
	if n := e.count("SELECT count(*) FROM outbox WHERE file_id IS NOT NULL AND sent IS NULL"); n != 5 {
		t.Fatalf("rows naming it: %d", n)
	}
	m := e.lastMail("c@example.test", "report")
	if m == nil || m.Attachment != "x.pdf" || m.AttachmentBytes != len(pdf) {
		t.Fatalf("sink line: %+v", m)
	}
	raw, _ := readFile(filepath.Join(e.cfg.MailDir, filepath.Base(m.File)))
	msg, _ := netmail.ReadMessage(strings.NewReader(raw))
	mt, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if mt != "multipart/mixed" {
		t.Fatalf("type %s", mt)
	}
	mr := multipart.NewReader(msg.Body, params["boundary"])
	mr.NextPart()
	file, err := mr.NextPart()
	if err != nil || file.FileName() != "x.pdf" {
		t.Fatalf("file part: %v", err)
	}
	enc, _ := io.ReadAll(file)
	if got, _ := base64.StdEncoding.DecodeString(strings.ReplaceAll(string(enc), "\r\n", "")); string(got) != string(pdf) {
		t.Fatal("attachment bytes differ")
	}
	if n := e.count("SELECT count(*) FROM mail_files"); n != 0 {
		t.Fatalf("file kept once sent: %d", n)
	}
	// Refused: another type, bad base64, not a PDF, empty, too big.
	for name, mut := range map[string]func(a map[string]any){
		"html": func(a map[string]any) {
			a["type"] = "text/html"
			a["dataBase64"] = base64.StdEncoding.EncodeToString([]byte("<p>hi"))
		},
		"exe":        func(a map[string]any) { a["type"] = "application/octet-stream" },
		"bad base64": func(a map[string]any) { a["dataBase64"] = "%%%not base64" },
		"fake pdf": func(a map[string]any) {
			a["dataBase64"] = base64.StdEncoding.EncodeToString([]byte("MZ\x90 not a pdf"))
		},
	} {
		a := good()
		mut(a)
		if r := o.b.post(path, body(a)); r.Code != 400 || r.json()["field"] != "attachment" {
			t.Errorf("%s: %d %s", name, r.Code, r.Body.String())
		}
	}
	for name, data := range map[string][]byte{"empty": {}, "over the limit": append([]byte("%PDF-"), make([]byte, ReportMaxAttach)...)} {
		a := good()
		a["dataBase64"] = base64.StdEncoding.EncodeToString(data)
		if r := o.b.post(path, body(a)); r.Code != 413 {
			t.Errorf("%s: %d %s", name, r.Code, r.Body.String())
		}
	}
	if n := e.count("SELECT count(*) FROM mail_files"); n != 0 {
		t.Fatalf("a refused file was stored: %d", n)
	}
	// Refused requests spent nothing: 9 more sends go (10 an hour), with no
	// attachment as before.
	for i := 0; i < ReportPerUserHour-1; i++ {
		if r := o.b.post(path, body(nil)); r.Code != 202 || r.json()["attachment"] != nil {
			t.Fatalf("send %d: %d %s", i+2, r.Code, r.Body.String())
		}
	}
	// Spent: refused before the body is read, whatever its size.
	r = o.b.post(path, body(good()))
	if r.Code != 429 || r.json()["limit"] != "user" {
		t.Fatalf("over the limit: %d %s", r.Code, r.Body.String())
	}
	if n := e.count("SELECT count(*) FROM mail_files"); n != 0 {
		t.Fatalf("files: %d", n)
	}
}
