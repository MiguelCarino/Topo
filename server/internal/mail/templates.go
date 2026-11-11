// Package mail renders the server's emails (translated, plain text plus a
// simple HTML part, no remote content) and sends them through one of three
// transports: smtp (the client's own mail server), file (one .eml per message
// plus mail/outbox.jsonl, for development and tests) and log.
//
// Mail is never sent from a request handler: handlers queue it in the outbox
// table and internal/notify sends it.
package mail

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"net/textproto"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Kinds are the messages the server sends. "none" is the decoy outbox row of
// a sign-in request for an address that may not sign in (amendment B3); it is
// never rendered or sent.
var Kinds = []string{"signin", "invite", "welcome", "member-joined", "granted", "incident-sent", "visit-recorded", "incident-closed", "revision", "link-request", "test", "report", "backup-failed", "backup-check-failed"}

// backupKinds go to the server owners when a backup or its weekly check
// fails (D104). They never name a network (even one shown in clear) and
// carry the reason as a code, "why", turned into a sentence here.
var backupKinds = map[string]bool{"backup-failed": true, "backup-check-failed": true}

// notifyKinds end with the "change them under Notifications" footer; the
// others (the person concerned, not opt-out-able) with the plain one.
var notifyKinds = map[string]bool{"member-joined": true, "incident-sent": true, "visit-recorded": true, "incident-closed": true, "revision": true}

// buttonKinds have their own action line and button label; the rest use
// action.open / button.open.
var buttonKinds = map[string]bool{"signin": true, "invite": true}

// infraKinds name their link "Follow the infrastructure link" (D88): the
// plain part says "Follow the infrastructure link: URL", the HTML part is a
// hyperlink with those words.
var infraKinds = map[string]bool{"incident-sent": true, "report": true}

// Data fills the placeholders. Known keys: code, minutes, link, url,
// inviter, role (owner|provider|viewer, translated here), email, n, time,
// name (the site name in clear, only when its owner allowed it), reason
// ("keys" for member-joined after a key reset). The "report" kind (D87)
// also reads subject, lines (newline-joined plain text written by the
// client), phone, pass ("1": the passphrase comes separately) and replyTo.
type Data map[string]string

// Message is one rendered email.
type Message struct {
	ID      string // outbox id (o_…), also the Message-ID local part
	Kind    string
	Lang    string
	To      string // bare address
	Subject string
	Text    string
	HTML    string
	// ReplyTo is a bare address for the Reply-To header ("report" only: the
	// person the server sends on behalf of).
	ReplyTo string
	// For the file sink only (the e2e reads them); never in headers.
	Code string
	Link string
	Site string
	// Attachment is the one file a "report" carries (D97), or nil.
	Attachment *Attachment
}

// Attachment is a file sent with a message: a provider report as a PDF.
type Attachment struct {
	Name string // cleaned (CleanAttachName)
	Type string // application/pdf
	Data []byte
}

// AttachTypes are the attachment types a client may ask the server to send
// (D97): a PDF only. An HTML file from the server's own mail account would
// carry arbitrary markup to anyone, which D87's fixed template rules out,
// and mail filters hold .html attachments back.
var AttachTypes = map[string]string{"application/pdf": ".pdf"}

// CleanAttachName makes a client-chosen file name safe for the
// Content-Disposition: CleanName200's flattening, no path or quote
// characters, no leading dots, at most 120 runes, and the extension of its
// type (forced). Empty -> "report" plus the extension.
func CleanAttachName(name, typ string) string {
	ext := AttachTypes[typ]
	if ext == "" {
		ext = ".bin"
	}
	s := CleanName200(name)
	if i := strings.LastIndexAny(s, `/\`); i >= 0 {
		s = s[i+1:]
	}
	s = strings.Map(func(r rune) rune {
		switch r {
		case '"', '\'', ';', '<', '>', '|', '*', '?', ':', '/', '\\':
			return -1
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(strings.TrimLeft(s, ". "))
	if strings.EqualFold(filepathExt(s), ext) {
		s = s[:len(s)-len(ext)]
	} else if e := filepathExt(s); e != "" && len([]rune(e)) <= 6 {
		s = s[:len(s)-len(e)]
	}
	s = strings.TrimRight(strings.TrimSpace(s), ". ")
	if r := []rune(s); len(r) > 120-len(ext) {
		s = strings.TrimRight(string(r[:120-len(ext)]), ". ")
	}
	if s == "" {
		s = "report"
	}
	return s + ext
}

// filepathExt is the last ".xyz" of s (empty when none).
func filepathExt(s string) string {
	i := strings.LastIndexByte(s, '.')
	if i <= 0 || strings.ContainsAny(s[i:], " ") {
		return ""
	}
	return s[i:]
}

// ErrHeader is returned when a header value would carry a line break.
var ErrHeader = errors.New("mail: header value has a line break")

func lookup(lang, key string) (string, bool) {
	if m, ok := locales[lang]; ok {
		if v, ok := m[key]; ok {
			return v, true
		}
	}
	v, ok := locales["en"][key]
	return v, ok
}

// CleanName makes an owner-typed site name safe for a subject and a body:
// control characters (CR, LF, NUL, tabs…) dropped, spaces collapsed, at most
// 80 runes (amendment B7).
func CleanName(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		if r == utf8.RuneError || unicode.IsControl(r) || r == ' ' || r == ' ' {
			r = ' '
		}
		if unicode.IsSpace(r) {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	out := b.String()
	if utf8.RuneCountInString(out) > 80 {
		out = string([]rune(out)[:80])
	}
	return strings.TrimSpace(out)
}

func fill(tmpl string, d Data) string {
	var b strings.Builder
	for {
		i := strings.IndexByte(tmpl, '{')
		if i < 0 {
			b.WriteString(tmpl)
			return b.String()
		}
		j := strings.IndexByte(tmpl[i:], '}')
		if j < 0 {
			b.WriteString(tmpl)
			return b.String()
		}
		key := tmpl[i+1 : i+j]
		b.WriteString(tmpl[:i])
		if v, ok := d[key]; ok {
			b.WriteString(v)
		} else {
			b.WriteString(tmpl[i : i+j+1])
		}
		tmpl = tmpl[i+j+1:]
	}
}

// Render builds the message for kind in lang (unknown languages fall back
// to English). The url key defaults to nothing: callers pass the public URL.
func Render(kind, lang string, d Data) (*Message, error) {
	if !ValidLang(lang) {
		lang = "en"
	}
	known := false
	for _, k := range Kinds {
		known = known || k == kind
	}
	if !known {
		return nil, fmt.Errorf("mail: unknown kind %q", kind)
	}
	v := Data{}
	for k, val := range d {
		v[k] = val
	}
	if n, ok := v["name"]; ok {
		v["name"] = CleanName(n)
		if v["name"] == "" {
			delete(v, "name")
		}
	}
	for _, k := range []string{"inviter", "email", "code", "minutes", "n", "time", "url", "link", "phone", "replyTo", "subject"} {
		if strings.ContainsAny(v[k], "\r\n\x00") {
			return nil, ErrHeader
		}
	}
	if kind == "report" {
		return renderReport(lang, v)
	}
	if backupKinds[kind] {
		delete(v, "name")
		why, ok := lookup(lang, "backup.why."+v["why"])
		if !ok {
			why, _ = lookup(lang, "backup.why.other")
		}
		v["reason"] = why
	}
	if r, ok := v["role"]; ok {
		if t, ok := lookup(lang, "role."+r); ok {
			v["role"] = t
		}
	}
	_, named := v["name"]
	t := func(key string) string {
		s, _ := lookup(lang, key)
		return fill(s, v)
	}
	pick := func(base string) string {
		if named {
			if _, ok := lookup(lang, base+"_named"); ok {
				return t(base + "_named")
			}
		}
		return t(base)
	}

	subject := pick(kind + ".subject")
	bodyKey := kind + ".body"
	switch {
	case kind == "member-joined" && v["reason"] == "keys":
		bodyKey = "member-joined.keys.body"
	case kind == "visit-recorded" && v["n"] != "" && v["n"] != "1":
		bodyKey = "visit-recorded.many"
	}
	body := pick(bodyKey)
	action, button := t("action.open"), t("button.open")
	if buttonKinds[kind] {
		action, button = t(kind+".action"), t(kind+".button")
	}
	link := v["link"]
	if link == "" {
		link = v["url"]
	}
	var after string
	if _, ok := lookup(lang, kind+".after"); ok {
		after = t(kind + ".after")
	}
	footer := t("footer.plain")
	if notifyKinds[kind] {
		footer = t("footer.notify")
	}
	if kind == "signin" {
		footer = ""
	}

	infra := infraKinds[kind]
	if infra {
		button = t("infra.link")
	}

	// Plain text.
	var tb strings.Builder
	tb.WriteString(body)
	switch {
	case link != "" && infra:
		tb.WriteString("\n\n" + fill(t("infra.plain"), Data{"link": link}))
	case link != "":
		tb.WriteString("\n\n" + action + "\n" + link)
	}
	if after != "" {
		tb.WriteString("\n\n" + after)
	}
	if footer != "" {
		tb.WriteString("\n\n-- \n" + footer)
	}
	tb.WriteString("\n")

	// HTML: inline styles, no images, no remote resources, one link.
	var hb strings.Builder
	esc := html.EscapeString
	hb.WriteString(`<!doctype html><html lang="` + esc(lang) + `"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>` + esc(subject) + `</title></head>`)
	hb.WriteString(`<body style="margin:0;padding:24px 16px;background:#f6f4ef;color:#1d1b16;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.5">`)
	hb.WriteString(`<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3ddcf;border-radius:12px;padding:24px">`)
	hb.WriteString(`<p style="margin:0 0 16px;font-weight:600;color:#8a6a1f">Topo</p>`)
	hb.WriteString(`<p style="margin:0 0 16px">` + esc(body) + `</p>`)
	if link != "" {
		if !infra {
			hb.WriteString(`<p style="margin:0 0 8px">` + esc(action) + `</p>`)
		}
		hb.WriteString(`<p style="margin:0 0 16px"><a href="` + esc(link) + `" style="` + buttonStyle + `">` + esc(button) + `</a></p>`)
	}
	if after != "" {
		hb.WriteString(`<p style="margin:0 0 16px;color:#5c574b">` + esc(after) + `</p>`)
	}
	if footer != "" {
		hb.WriteString(`<p style="margin:16px 0 0;font-size:13px;color:#6f6a5e">` + esc(footer) + `</p>`)
	}
	hb.WriteString(`</div></body></html>`)

	return &Message{Kind: kind, Lang: lang, Subject: subject, Text: tb.String(), HTML: hb.String(), Code: v["code"], Link: v["link"]}, nil
}

const buttonStyle = "display:inline-block;padding:12px 20px;background:#8a6a1f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600"

func htmlHead(lang, subject string) string {
	esc := html.EscapeString
	return `<!doctype html><html lang="` + esc(lang) + `"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>` + esc(subject) + `</title></head>` +
		`<body style="margin:0;padding:24px 16px;background:#f6f4ef;color:#1d1b16;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.5">` +
		`<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3ddcf;border-radius:12px;padding:24px">` +
		`<p style="margin:0 0 16px;font-weight:600;color:#8a6a1f">Topo</p>`
}

// CleanLine makes one line of client-written text safe for a body: control
// characters become spaces (a line never breaks), the ends are trimmed.
func CleanLine(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r == utf8.RuneError || unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			r = ' '
		}
		b.WriteRune(r)
	}
	return strings.TrimRight(b.String(), " ")
}

// TelHref is a phone number as a tel: target (digits and a leading +), or
// "" when it has no digits.
func TelHref(phone string) string {
	var b strings.Builder
	for i, r := range strings.TrimSpace(phone) {
		if (r >= '0' && r <= '9') || (r == '+' && i == 0) {
			b.WriteRune(r)
		}
	}
	if strings.Trim(b.String(), "+") == "" {
		return ""
	}
	return "tel:" + b.String()
}

// renderReport is the "report" kind (D87): a problem report the client
// wrote, sent by the server on their behalf. The words are the client's
// (plain text, escaped here, never HTML); everything around them is this
// fixed template: the infrastructure link as a hyperlink, the reporter's
// phone as a tel: link, the passphrase note and the footer naming the
// sender. Reply-To is the sender.
func renderReport(lang string, v Data) (*Message, error) {
	t := func(key string, d Data) string {
		s, _ := lookup(lang, key)
		return fill(s, d)
	}
	esc := html.EscapeString
	subject := CleanName200(v["subject"])
	if subject == "" {
		subject = t("report.subject", nil)
	}
	var lines []string
	if v["lines"] != "" {
		for _, l := range strings.Split(v["lines"], "\n") {
			lines = append(lines, CleanLine(l))
		}
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	link, phone, tel := v["link"], CleanLine(v["phone"]), TelHref(v["phone"])
	pass := v["pass"] == "1"
	footer := t("report.footer", Data{"url": v["url"], "email": v["email"]})

	var tb strings.Builder
	tb.WriteString(strings.Join(lines, "\n"))
	if len(lines) > 0 {
		tb.WriteString("\n\n")
	}
	if phone != "" && tel != "" {
		tb.WriteString(t("report.phone", Data{"phone": phone}) + "\n")
	}
	if link != "" {
		tb.WriteString(fill(t("infra.plain", nil), Data{"link": link}) + "\n")
	}
	if pass && link != "" {
		tb.WriteString(t("report.pass", nil) + "\n")
	}
	attached := ""
	if a := CleanLine(v["attach"]); a != "" {
		attached = t("report.attached", Data{"name": a})
		tb.WriteString(attached + "\n")
	}
	tb.WriteString("\n-- \n" + footer + "\n")

	var hb strings.Builder
	hb.WriteString(htmlHead(lang, subject))
	// Paragraphs split at empty lines, lines within one joined by <br>.
	var para []string
	flush := func() {
		if len(para) > 0 {
			hb.WriteString(`<p style="margin:0 0 16px">` + strings.Join(para, "<br>") + `</p>`)
			para = nil
		}
	}
	for _, l := range lines {
		if strings.TrimSpace(l) == "" {
			flush()
			continue
		}
		para = append(para, esc(l))
	}
	flush()
	if phone != "" && tel != "" {
		label, _ := lookup(lang, "report.phone")
		before, after, _ := strings.Cut(label, "{phone}")
		hb.WriteString(`<p style="margin:0 0 16px">` + esc(before) + `<a href="` + esc(tel) + `" style="color:#8a6a1f">` + esc(phone) + `</a>` + esc(after) + `</p>`)
	}
	if link != "" {
		hb.WriteString(`<p style="margin:0 0 16px"><a href="` + esc(link) + `" style="` + buttonStyle + `">` + esc(t("infra.link", nil)) + `</a></p>`)
	}
	if pass && link != "" {
		hb.WriteString(`<p style="margin:0 0 16px;color:#5c574b">` + esc(t("report.pass", nil)) + `</p>`)
	}
	if attached != "" {
		hb.WriteString(`<p style="margin:0 0 16px">` + esc(attached) + `</p>`)
	}
	hb.WriteString(`<p style="margin:16px 0 0;font-size:13px;color:#6f6a5e">` + esc(footer) + `</p>`)
	hb.WriteString(`</div></body></html>`)
	return &Message{Kind: "report", Lang: lang, Subject: subject, Text: tb.String(), HTML: hb.String(), Link: link, ReplyTo: v["replyTo"]}, nil
}

// CleanName200 is CleanName for a subject the client wrote: at most 200 runes.
func CleanName200(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		if r == utf8.RuneError || unicode.IsControl(r) {
			r = ' '
		}
		if unicode.IsSpace(r) {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	out := b.String()
	if utf8.RuneCountInString(out) > 200 {
		out = string([]rune(out)[:200])
	}
	return out
}

// ParseAddress accepts one bare address (no display name, no line breaks).
func ParseAddress(s string) (string, error) {
	if strings.ContainsAny(s, "\r\n\x00") {
		return "", ErrHeader
	}
	a, err := mail.ParseAddress(s)
	if err != nil {
		return "", err
	}
	if a.Name != "" || a.Address != strings.TrimSpace(s) {
		return "", errors.New("mail: want a bare address")
	}
	return a.Address, nil
}

func encodeHeader(s string) string {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 || s[i] < 0x20 {
			return mime.QEncoding.Encode("utf-8", s)
		}
	}
	return s
}

// Bytes composes the RFC 5322 message: multipart/alternative with
// quoted-printable text/plain and text/html, CRLF line ends. from is the
// configured sender (`Topo <topo@example.com>`), host names the Message-ID
// domain.
func (m *Message) Bytes(from, host string, date time.Time) ([]byte, error) {
	fa, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("mail: from: %w", err)
	}
	to, err := ParseAddress(m.To)
	if err != nil {
		return nil, fmt.Errorf("mail: to: %w", err)
	}
	var replyTo string
	if m.ReplyTo != "" {
		if replyTo, err = ParseAddress(m.ReplyTo); err != nil {
			return nil, fmt.Errorf("mail: reply-to: %w", err)
		}
	}
	for _, s := range []string{from, m.Subject, host, m.ID} {
		if strings.ContainsAny(s, "\r\n\x00") {
			return nil, ErrHeader
		}
	}
	if host == "" {
		host = "localhost"
	}
	id := m.ID
	if id == "" {
		b := make([]byte, 12)
		rand.Read(b)
		id = hex.EncodeToString(b)
	}
	var buf bytes.Buffer
	// Without an attachment the body is multipart/alternative, as it always
	// was; with one (D97) it is multipart/mixed: the alternative first, then
	// the file.
	var mixed *multipart.Writer
	var alt bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if m.Attachment != nil {
		mixed = mw
		mw = multipart.NewWriter(&alt)
	}
	h := func(k, v string) { buf.WriteString(k + ": " + v + "\r\n") }
	h("From", fa.String())
	h("To", (&mail.Address{Address: to}).String())
	if replyTo != "" {
		h("Reply-To", (&mail.Address{Address: replyTo}).String())
	}
	h("Subject", encodeHeader(m.Subject))
	h("Date", date.UTC().Format(time.RFC1123Z))
	h("Message-ID", "<"+id+"@"+host+">")
	h("MIME-Version", "1.0")
	if mixed != nil {
		h("Content-Type", `multipart/mixed; boundary="`+mixed.Boundary()+`"`)
	} else {
		h("Content-Type", `multipart/alternative; boundary="`+mw.Boundary()+`"`)
	}
	h("Auto-Submitted", "auto-generated")
	h("X-Auto-Response-Suppress", "All")
	if m.Lang != "" {
		h("Content-Language", m.Lang)
	}
	buf.WriteString("\r\n")
	for _, part := range []struct{ ct, body string }{{"text/plain; charset=utf-8", m.Text}, {"text/html; charset=utf-8", m.HTML}} {
		ph := textproto.MIMEHeader{}
		ph.Set("Content-Type", part.ct)
		ph.Set("Content-Transfer-Encoding", "quoted-printable")
		w, err := mw.CreatePart(ph)
		if err != nil {
			return nil, err
		}
		qw := quotedprintable.NewWriter(w)
		if _, err := qw.Write([]byte(part.body)); err != nil {
			return nil, err
		}
		if err := qw.Close(); err != nil {
			return nil, err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	if mixed != nil {
		ah := textproto.MIMEHeader{}
		ah.Set("Content-Type", `multipart/alternative; boundary="`+mw.Boundary()+`"`)
		w, err := mixed.CreatePart(ah)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(alt.Bytes()); err != nil {
			return nil, err
		}
		if err := writeAttachment(mixed, m.Attachment); err != nil {
			return nil, err
		}
		if err := mixed.Close(); err != nil {
			return nil, err
		}
	}
	return buf.Bytes(), nil
}

// writeAttachment adds the file part: its type and name (RFC 2231 for a
// name that is not plain ASCII), base64 in 76-column CRLF lines.
func writeAttachment(mw *multipart.Writer, a *Attachment) error {
	typ := a.Type
	if AttachTypes[typ] == "" {
		return fmt.Errorf("mail: attachment type %q", typ)
	}
	name := CleanAttachName(a.Name, typ)
	ct := mime.FormatMediaType(typ, map[string]string{"name": name})
	cd := mime.FormatMediaType("attachment", map[string]string{"filename": name})
	if ct == "" || cd == "" {
		ct, cd = typ, "attachment"
	}
	ph := textproto.MIMEHeader{}
	ph.Set("Content-Type", ct)
	ph.Set("Content-Disposition", cd)
	ph.Set("Content-Transfer-Encoding", "base64")
	w, err := mw.CreatePart(ph)
	if err != nil {
		return err
	}
	enc := base64.StdEncoding.EncodeToString(a.Data)
	for len(enc) > 76 {
		if _, err := io.WriteString(w, enc[:76]+"\r\n"); err != nil {
			return err
		}
		enc = enc[76:]
	}
	_, err = io.WriteString(w, enc+"\r\n")
	return err
}
