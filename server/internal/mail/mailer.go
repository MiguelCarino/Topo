package mail

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"carino.systems/topo/server/internal/config"
)

// Mailer sends one rendered message.
type Mailer interface {
	Send(ctx context.Context, m *Message) error
	Name() string
}

// Options are the parts of New that tests replace.
type Options struct {
	Now     func() time.Time
	RootCAs *x509.CertPool // SMTP TLS roots (nil = the system's)
}

// New returns the transport cfg.Mail names.
func New(cfg *config.Config, log *slog.Logger, o Options) (Mailer, error) {
	if o.Now == nil {
		o.Now = time.Now
	}
	host := "localhost"
	if cfg.PublicURL != nil && cfg.PublicURL.Hostname() != "" {
		host = cfg.PublicURL.Hostname()
	}
	// An address (127.0.0.1, ::1) is no mail domain: the default From and
	// the Message-ID use localhost then.
	if net.ParseIP(host) != nil {
		host = "localhost"
	}
	from := cfg.SMTP.From
	if from == "" {
		from = "Topo <topo@" + host + ">"
	}
	if _, err := parseFrom(from); err != nil {
		return nil, fmt.Errorf("mail: from %q: %w", from, err)
	}
	base := sender{from: from, host: host, now: o.Now}
	switch cfg.Mail {
	case "smtp":
		return &SMTP{sender: base, cfg: cfg.SMTP, rootCAs: o.RootCAs}, nil
	case "file":
		dir := cfg.MailDir
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("mail folder %s: %w", dir, err)
		}
		return &File{sender: base, dir: dir}, nil
	case "log", "":
		return &Log{sender: base, log: log, debugCodes: true}, nil
	}
	return nil, fmt.Errorf("mail: unknown transport %q", cfg.Mail)
}

func parseFrom(from string) (string, error) {
	if strings.ContainsAny(from, "\r\n\x00") {
		return "", ErrHeader
	}
	m := &Message{To: "x@example.com"}
	_, err := m.Bytes(from, "localhost", time.Unix(0, 0))
	return from, err
}

type sender struct {
	from string
	host string
	now  func() time.Time
}

// Mask hides most of an address for logs: a***@example.com.
func Mask(addr string) string {
	at := strings.LastIndexByte(addr, '@')
	if at <= 0 {
		return "***"
	}
	return addr[:1] + "***" + addr[at:]
}

// ---- smtp ----

// SMTP sends through the client's mail server: STARTTLS (587, required to be
// offered: it fails closed), implicit TLS (465) or plain to a relay on this
// machine. AUTH PLAIN, or LOGIN when only LOGIN is offered (some Microsoft
// 365 tenants).
type SMTP struct {
	sender
	cfg     config.SMTP
	rootCAs *x509.CertPool
}

func (s *SMTP) Name() string { return "smtp" }

// ErrNoStartTLS is returned when the server does not offer STARTTLS.
var ErrNoStartTLS = errors.New("smtp: the server does not offer STARTTLS; set TOPO_SMTP_SECURITY=tls for port 465")

func (s *SMTP) Send(ctx context.Context, m *Message) error {
	raw, err := m.Bytes(s.from, s.host, s.now())
	if err != nil {
		return err
	}
	from, _ := parseFromAddress(s.from)
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	addr := net.JoinHostPort(s.cfg.Host, strconv.Itoa(s.cfg.Port))
	tcfg := &tls.Config{ServerName: s.cfg.Host, RootCAs: s.rootCAs, MinVersion: tls.VersionTLS12}
	d := &net.Dialer{Timeout: 15 * time.Second}
	var conn net.Conn
	if s.cfg.Security == "tls" {
		conn, err = (&tls.Dialer{NetDialer: d, Config: tcfg}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = d.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("smtp: connect %s: %w", addr, err)
	}
	if dl, ok := ctx.Deadline(); ok {
		conn.SetDeadline(dl)
	}
	stop := context.AfterFunc(ctx, func() { conn.SetDeadline(time.Now()) })
	defer stop()
	c, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp: greeting: %w", err)
	}
	defer c.Close()
	helo := s.cfg.HELO
	if helo == "" {
		helo = s.host
	}
	if err := c.Hello(helo); err != nil {
		return fmt.Errorf("smtp: EHLO: %w", err)
	}
	if s.cfg.Security == "starttls" {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return ErrNoStartTLS
		}
		if err := c.StartTLS(tcfg); err != nil {
			return fmt.Errorf("smtp: STARTTLS: %w", err)
		}
	}
	if s.cfg.User != "" {
		ok, mechs := c.Extension("AUTH")
		if !ok {
			return errors.New("smtp: the server offers no AUTH; check the port and security")
		}
		var a smtp.Auth
		switch {
		case hasWord(mechs, "PLAIN"):
			a = smtp.PlainAuth("", s.cfg.User, s.cfg.Pass, s.cfg.Host)
		case hasWord(mechs, "LOGIN"):
			a = &loginAuth{user: s.cfg.User, pass: s.cfg.Pass}
		default:
			return fmt.Errorf("smtp: no supported AUTH mechanism in %q", mechs)
		}
		if err := c.Auth(a); err != nil {
			return fmt.Errorf("smtp: AUTH: %w", err)
		}
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("smtp: MAIL FROM: %w", err)
	}
	if err := c.Rcpt(m.To); err != nil {
		return fmt.Errorf("smtp: RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp: DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return fmt.Errorf("smtp: DATA: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp: DATA: %w", err)
	}
	return c.Quit()
}

func parseFromAddress(from string) (string, error) {
	i, j := strings.LastIndexByte(from, '<'), strings.LastIndexByte(from, '>')
	if i >= 0 && j > i {
		return from[i+1 : j], nil
	}
	return strings.TrimSpace(from), nil
}

func hasWord(list, w string) bool {
	for _, f := range strings.Fields(list) {
		if strings.EqualFold(f, w) {
			return true
		}
	}
	return false
}

// loginAuth is AUTH LOGIN. Like smtp.PlainAuth it refuses to send the
// password without TLS unless the server is on this machine.
type loginAuth struct{ user, pass string }

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && !config.IsLoopbackHost(server.Name) {
		return "", nil, errors.New("smtp: refusing AUTH LOGIN without TLS")
	}
	return "LOGIN", nil, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimSpace(string(fromServer))) {
	case "username:", "username":
		return []byte(a.user), nil
	case "password:", "password":
		return []byte(a.pass), nil
	}
	return nil, fmt.Errorf("smtp: unexpected AUTH LOGIN prompt %q", fromServer)
}

// ---- file ----

// File writes mail/<unixms>-<id>.eml (0600) and one JSON line per message
// to mail/outbox.jsonl. Development and tests read the codes from there.
type File struct {
	sender
	dir string
	mu  sync.Mutex
}

func (f *File) Name() string { return "file" }

// SinkLine is one line of outbox.jsonl.
type SinkLine struct {
	At      int64  `json:"at"`
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	To      string `json:"to"`
	Lang    string `json:"lang"`
	Subject string `json:"subject"`
	Code    string `json:"code,omitempty"`
	Link    string `json:"link,omitempty"`
	Site    string `json:"site,omitempty"`
	File    string `json:"file"`
	// The attached file's name and size (D97), when the message carries one.
	Attachment      string `json:"attachment,omitempty"`
	AttachmentBytes int    `json:"attachmentBytes,omitempty"`
}

func (f *File) Send(ctx context.Context, m *Message) error {
	now := f.now()
	raw, err := m.Bytes(f.from, f.host, now)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	name := fmt.Sprintf("%d-%s.eml", now.UnixMilli(), safeName(m.ID))
	if err := os.WriteFile(filepath.Join(f.dir, name), raw, 0o600); err != nil {
		return err
	}
	sl := SinkLine{At: now.UnixMilli(), ID: m.ID, Kind: m.Kind, To: m.To, Lang: m.Lang, Subject: m.Subject, Code: m.Code, Link: m.Link, Site: m.Site, File: name}
	if m.Attachment != nil {
		sl.Attachment, sl.AttachmentBytes = CleanAttachName(m.Attachment.Name, m.Attachment.Type), len(m.Attachment.Data)
	}
	line, _ := json.Marshal(sl)
	out, err := os.OpenFile(filepath.Join(f.dir, "outbox.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, err = out.Write(append(line, '\n'))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	return err
}

func safeName(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r == '-' || r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "msg"
	}
	return b.String()
}

// ---- log ----

// Log writes one slog line per message: kind, masked address and subject.
// The code is logged at debug only (TOPO_MAIL=log is for development
// without SMTP); a sign-in subject carries the code, so it is left out.
type Log struct {
	sender
	log        *slog.Logger
	debugCodes bool
}

func (l *Log) Name() string { return "log" }

func (l *Log) Send(ctx context.Context, m *Message) error {
	if _, err := m.Bytes(l.from, l.host, l.now()); err != nil {
		return err
	}
	subject := m.Subject
	if m.Code != "" {
		subject = "(sign-in code)"
	}
	l.log.Info("mail", "kind", m.Kind, "to", Mask(m.To), "lang", m.Lang, "subject", subject)
	if l.debugCodes && (m.Code != "" || m.Link != "") {
		l.log.Debug("mail sign-in", "to", Mask(m.To), "code", m.Code, "link", m.Link)
	}
	return nil
}
