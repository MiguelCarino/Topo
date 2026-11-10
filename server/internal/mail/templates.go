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
	"encoding/hex"
	"errors"
	"fmt"
	"html"
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
var Kinds = []string{"signin", "invite", "welcome", "member-joined", "granted", "incident-sent", "visit-recorded", "incident-closed", "revision", "link-request", "test"}

// notifyKinds end with the "change them under Notifications" footer; the
// others (the person concerned, not opt-out-able) with the plain one.
var notifyKinds = map[string]bool{"member-joined": true, "incident-sent": true, "visit-recorded": true, "incident-closed": true, "revision": true}

// buttonKinds have their own action line and button label; the rest use
// action.open / button.open.
var buttonKinds = map[string]bool{"signin": true, "invite": true}

// Data fills the placeholders. Known keys: code, minutes, link, url,
// inviter, role (owner|provider|viewer, translated here), email, n, time,
// name (the site name in clear, only when its owner allowed it), reason
// ("keys" for member-joined after a key reset).
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
	// For the file sink only (the e2e reads them); never in headers.
	Code string
	Link string
	Site string
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
	for _, k := range []string{"inviter", "email", "code", "minutes", "n", "time", "url", "link"} {
		if strings.ContainsAny(v[k], "\r\n\x00") {
			return nil, ErrHeader
		}
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

	// Plain text.
	var tb strings.Builder
	tb.WriteString(body)
	if link != "" {
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
		hb.WriteString(`<p style="margin:0 0 8px">` + esc(action) + `</p>`)
		hb.WriteString(`<p style="margin:0 0 16px"><a href="` + esc(link) + `" style="display:inline-block;padding:12px 20px;background:#8a6a1f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">` + esc(button) + `</a></p>`)
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
	mw := multipart.NewWriter(&buf)
	h := func(k, v string) { buf.WriteString(k + ": " + v + "\r\n") }
	h("From", fa.String())
	h("To", (&mail.Address{Address: to}).String())
	h("Subject", encodeHeader(m.Subject))
	h("Date", date.UTC().Format(time.RFC1123Z))
	h("Message-ID", "<"+id+"@"+host+">")
	h("MIME-Version", "1.0")
	h("Content-Type", `multipart/alternative; boundary="`+mw.Boundary()+`"`)
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
	return buf.Bytes(), nil
}
