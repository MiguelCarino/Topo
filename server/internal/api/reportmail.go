package api

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/store"
)

// A problem report the server emails for a client (docs/SCOPE.md D87): the
// browser made the locked link of the network and the words; the server
// sends them to providers who are not members (members get incident-sent
// through a push, D75) through its own SMTP account, From the server,
// Reply-To the signed-in person. The text and HTML come from a fixed
// template (internal/mail renderReport): the client sends plain lines, never
// HTML, and the link must be one of this server's own pages, so the server
// cannot be used to mail anyone an arbitrary link. The one file it may carry
// is a PDF (D97: the provider report), checked for its signature, its name
// cleaned and its extension forced.
const (
	reportMaxTo      = 5
	reportMaxSubject = 200
	reportMaxLines   = 60
	reportMaxChars   = 6000
	reportMaxLink    = 20000 // DOC_URL_MAX (16,000) and room for the query
	reportMaxPhone   = 40
	// ReportMaxAttach is the largest attached report (decoded bytes, D97); a
	// body carrying one is read with up to reportMaxBody (base64 adds a
	// third, plus the rest of the request).
	ReportMaxAttach = 6 << 20
	reportMaxBody   = 9 << 20
	// ReportPerUserHour and ReportPerSiteDay are the sends allowed (one
	// request is one send, up to reportMaxTo addresses).
	ReportPerUserHour = 10
	ReportPerSiteDay  = 30
)

// MailRelay reports whether this server can send mail for a client: smtp,
// or the file sink of tests and development; log only writes a line.
func (s *Server) MailRelay() bool { return s.d.Cfg.Mail == "smtp" || s.d.Cfg.Mail == "file" }

// reportLinkOK: the link is an http(s) URL on this server's public origin
// (scheme and host:port exactly), with no user info and no line breaks.
func (s *Server) reportLinkOK(link string) bool {
	if link == "" || len(link) > reportMaxLink || strings.ContainsAny(link, "\r\n\x00 \t") {
		return false
	}
	origin := s.d.Cfg.Origin()
	if !strings.HasPrefix(link, origin+"/") {
		return false
	}
	u, err := url.Parse(link)
	if err != nil || u.User != nil {
		return false
	}
	return u.Scheme+"://"+u.Host == origin
}

// reportMail: POST /api/sites/{site}/report-mail (Writer: a granted owner
// or provider; a viewer is 403, anyone else 404, D83).
func (s *Server) reportMail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		To       []string `json:"to"`
		Subject  string   `json:"subject"`
		Lines    []string `json:"lines"`
		Link     string   `json:"link"`
		Phone    string   `json:"phone"`
		PassNote bool     `json:"passphraseNote"`
		Lang     string   `json:"lang"`
		// The provider report attached (D97): a PDF only, at most
		// ReportMaxAttach bytes. The server reads it in clear and keeps it
		// until it is sent: the client was told so (the E2E exception).
		Attachment *struct {
			Name       string `json:"name"`
			Type       string `json:"type"`
			DataBase64 string `json:"dataBase64"`
		} `json:"attachment"`
	}
	if !s.MailRelay() {
		writeError(w, http.StatusServiceUnavailable, ErrUnavailable, map[string]any{"field": "mail"})
		return
	}
	sess := SessionFrom(r.Context())
	site := r.PathValue("site")
	// The limits are looked at before a large body is read (a refused send
	// costs a few bytes, not megabytes); they are spent below, once the
	// request is valid.
	if ok, wait := s.reportUser.Peek(sess.UserID); !ok {
		writeError(w, http.StatusTooManyRequests, ErrRateLimited, map[string]any{"retryAfter": retrySeconds(wait), "limit": "user"})
		return
	}
	if ok, wait := s.reportSite.Peek(site); !ok {
		writeError(w, http.StatusTooManyRequests, ErrRateLimited, map[string]any{"retryAfter": retrySeconds(wait), "limit": "site"})
		return
	}
	if r.ContentLength > reportMaxBody {
		writeError(w, http.StatusRequestEntityTooLarge, ErrTooLarge, map[string]any{"field": "attachment"})
		return
	}
	if err := decodeBody(w, r, reportMaxBody, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	bad := func(field string) {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": field})
	}
	if len(req.To) == 0 || len(req.To) > reportMaxTo {
		bad("to")
		return
	}
	var to []string
	seen := map[string]bool{}
	for _, a := range req.To {
		addr, err := mail.ParseAddress(strings.TrimSpace(a))
		if err != nil || !strings.Contains(addr, "@") {
			bad("to")
			return
		}
		if k := strings.ToLower(addr); !seen[k] {
			seen[k] = true
			to = append(to, addr)
		}
	}
	subject := mail.CleanName200(req.Subject)
	if subject == "" || utf8.RuneCountInString(req.Subject) > reportMaxSubject {
		bad("subject")
		return
	}
	if len(req.Lines) > reportMaxLines {
		bad("lines")
		return
	}
	chars := 0
	lines := make([]string, len(req.Lines))
	for i, l := range req.Lines {
		chars += utf8.RuneCountInString(l)
		lines[i] = mail.CleanLine(l)
	}
	if chars > reportMaxChars {
		bad("lines")
		return
	}
	if !s.reportLinkOK(req.Link) {
		bad("link")
		return
	}
	phone := mail.CleanLine(req.Phone)
	if utf8.RuneCountInString(phone) > reportMaxPhone {
		bad("phone")
		return
	}
	lang := req.Lang
	if !mail.ValidLang(lang) {
		lang = "en"
	}
	var file *store.MailFile
	if a := req.Attachment; a != nil {
		if mail.AttachTypes[a.Type] == "" {
			bad("attachment")
			return
		}
		data, err := base64.StdEncoding.DecodeString(a.DataBase64)
		if err != nil {
			bad("attachment")
			return
		}
		if len(data) == 0 || len(data) > ReportMaxAttach {
			writeError(w, http.StatusRequestEntityTooLarge, ErrTooLarge, map[string]any{"field": "attachment"})
			return
		}
		if !bytes.HasPrefix(data, []byte("%PDF-")) {
			bad("attachment")
			return
		}
		file = &store.MailFile{ID: store.NewID("mf_"), SiteID: site, Name: mail.CleanAttachName(a.Name, a.Type), Type: a.Type, Data: data}
	}
	replyTo, err := mail.ParseAddress(sess.Email)
	if err != nil {
		replyTo = ""
	}
	// The limits: per person per hour, then per site per day (a refused
	// site send gives the person's token back).
	if ok, wait := s.reportUser.Take(sess.UserID); !ok {
		writeError(w, http.StatusTooManyRequests, ErrRateLimited, map[string]any{"retryAfter": retrySeconds(wait), "limit": "user"})
		return
	}
	if ok, wait := s.reportSite.Take(site); !ok {
		s.reportUser.Refund(sess.UserID)
		writeError(w, http.StatusTooManyRequests, ErrRateLimited, map[string]any{"retryAfter": retrySeconds(wait), "limit": "site"})
		return
	}
	data := map[string]string{"subject": subject, "lines": strings.Join(lines, "\n"), "link": req.Link, "email": sess.Email, "replyTo": replyTo}
	if phone != "" && mail.TelHref(phone) != "" {
		data["phone"] = phone
	}
	if req.PassNote {
		data["pass"] = "1"
	}
	fileID := ""
	if file != nil {
		data["attach"] = file.Name
		fileID = file.ID
	}
	b, _ := json.Marshal(data)
	ctx := r.Context()
	ms := s.d.Now().UnixMilli()
	err = s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		// The file once, however many addresses (D97).
		if file != nil {
			file.Created = ms
			if err := store.InsertMailFile(ctx, tx, file); err != nil {
				return err
			}
		}
		for _, addr := range to {
			if err := store.InsertMail(ctx, tx, &store.Mail{ID: store.NewID("o_"), Kind: "report", To: addr, SiteID: site, Lang: lang,
				Data: string(b), Created: ms, SendAfter: ms, FileID: fileID}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.reportUser.Refund(sess.UserID)
		s.reportSite.Refund(site)
		s.internal(w, "report mail", err)
		return
	}
	masked := make([]string, len(to))
	for i, a := range to {
		masked[i] = mail.Mask(a)
	}
	attached := 0
	if file != nil {
		attached = len(file.Data)
	}
	s.d.Log.Info("report mail queued", "site", site, "user", sess.UserID, "to", strings.Join(masked, ","), "attachmentBytes", attached)
	s.wake()
	out := map[string]any{"queued": len(to)}
	if file != nil {
		out["attachment"] = file.Name
	}
	writeJSON(w, http.StatusAccepted, out)
}

func retrySeconds(d time.Duration) int {
	n := int((d + time.Second - 1) / time.Second)
	if n < 1 {
		n = 1
	}
	return n
}
