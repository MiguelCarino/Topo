package backuptest

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Fakes of the 5c destinations (S3, Google Drive, OneDrive) and of an OAuth
// provider: http.Handlers for httptest servers. They check what the real
// services check where it matters to Topo (signatures, tokens, sizes) and
// nothing else. No real service is ever called.

// ---------------------------------------------------------------- S3 ----

// S3 is an in-memory bucket that checks every request's SigV4 signature
// with its own minimal implementation (not the client's), the payload hash
// and Content-MD5; path style or virtual host (by the Host header);
// ListObjectsV2 with pages of MaxKeys and opaque continuation tokens that
// hold "+", "/" and "=" (amendment 16).
type S3 struct {
	mu          sync.Mutex
	KeyID       string
	Secret      string
	Region      string
	Bucket      string
	MaxKeys     int
	Now         func() time.Time
	LockDeletes bool // a delete answers 403 AccessDenied (object lock)
	Objects     map[string][]byte
	Tokens      []string // continuation tokens received, as decoded
	Requests    int
}

// NewS3 is a bucket for one key.
func NewS3(keyID, secret, region, bucket string) *S3 {
	return &S3{KeyID: keyID, Secret: secret, Region: region, Bucket: bucket, MaxKeys: 1000, Objects: map[string][]byte{}}
}

// Keys lists the stored keys, sorted.
func (s *S3) Keys() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for k := range s.Objects {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Object is the stored body of key.
func (s *S3) Object(key string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.Objects[key]
	return b, ok
}

func s3err(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(status)
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>%s</Code><Message>%s</Message></Error>`, code, code)
}

// enc is the URI encoding SigV4 asks for, written again here on purpose.
func enc(s string, slash bool) string {
	const ok = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
	var b strings.Builder
	for _, c := range []byte(s) {
		if strings.IndexByte(ok, c) >= 0 || (slash && c == '/') {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func mac(k []byte, s string) []byte {
	m := hmac.New(sha256.New, k)
	m.Write([]byte(s))
	return m.Sum(nil)
}

// verify recomputes the signature of r.
func (s *S3) verify(r *http.Request, body []byte) (int, string) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 ") {
		return 403, "AccessDenied"
	}
	parts := map[string]string{}
	for _, p := range strings.Split(strings.TrimPrefix(auth, "AWS4-HMAC-SHA256 "), ",") {
		if k, v, ok := strings.Cut(strings.TrimSpace(p), "="); ok {
			parts[k] = v
		}
	}
	cred := strings.Split(parts["Credential"], "/")
	if len(cred) != 5 || cred[0] != s.KeyID {
		return 403, "InvalidAccessKeyId"
	}
	if cred[2] != s.Region || cred[3] != "s3" || cred[4] != "aws4_request" {
		return 400, "AuthorizationHeaderMalformed"
	}
	amz := r.Header.Get("X-Amz-Date")
	t, err := time.Parse("20060102T150405Z", amz)
	if err != nil || amz[:8] != cred[1] {
		return 403, "AccessDenied"
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	if d := now.Sub(t); d > 15*time.Minute || d < -15*time.Minute {
		return 403, "RequestTimeTooSkewed"
	}
	sum := sha256.Sum256(body)
	if r.Header.Get("X-Amz-Content-Sha256") != hex.EncodeToString(sum[:]) {
		return 400, "XAmzContentSHA256Mismatch"
	}
	signed := strings.Split(parts["SignedHeaders"], ";")
	need := map[string]bool{"host": false, "x-amz-date": false, "x-amz-content-sha256": false}
	var ch strings.Builder
	for _, h := range signed {
		need[h] = true
		v := r.Host
		if h != "host" {
			v = strings.Join(strings.Fields(strings.Join(r.Header.Values(h), ",")), " ")
		}
		ch.WriteString(h + ":" + v + "\n")
	}
	for _, v := range need {
		if !v {
			return 403, "AccessDenied"
		}
	}
	var qs []string
	if r.URL.RawQuery != "" {
		for _, kv := range strings.Split(r.URL.RawQuery, "&") {
			k, v, _ := strings.Cut(kv, "=")
			k, _ = url.PathUnescape(k)
			v, _ = url.PathUnescape(v)
			qs = append(qs, enc(k, false)+"="+enc(v, false))
		}
	}
	sort.Strings(qs)
	uri := enc(r.URL.Path, true) // the decoded path, encoded again
	canon := r.Method + "\n" + uri + "\n" + strings.Join(qs, "&") + "\n" + ch.String() + "\n" + parts["SignedHeaders"] + "\n" + r.Header.Get("X-Amz-Content-Sha256")
	cs := sha256.Sum256([]byte(canon))
	sts := "AWS4-HMAC-SHA256\n" + amz + "\n" + strings.Join(cred[1:], "/") + "\n" + hex.EncodeToString(cs[:])
	k := mac(mac(mac(mac([]byte("AWS4"+s.Secret), cred[1]), cred[2]), "s3"), "aws4_request")
	if !hmac.Equal([]byte(hex.EncodeToString(mac(k, sts))), []byte(parts["Signature"])) {
		return 403, "SignatureDoesNotMatch"
	}
	return 0, ""
}

func (s *S3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 80<<20))
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Requests++
	if st, code := s.verify(r, body); st != 0 {
		s3err(w, st, code)
		return
	}
	// The bucket: from the host (virtual host) or the first segment.
	host := r.Host
	if h, _, ok := strings.Cut(host, ":"); ok {
		host = h
	}
	p := r.URL.Path
	bucket := ""
	if strings.HasPrefix(host, s.Bucket+".") {
		bucket = s.Bucket
		p = strings.TrimPrefix(p, "/")
	} else {
		seg, rest, _ := strings.Cut(strings.TrimPrefix(p, "/"), "/")
		bucket, p = seg, rest
	}
	if bucket != s.Bucket {
		s3err(w, 404, "NoSuchBucket")
		return
	}
	key := p
	q := r.URL.Query()
	switch {
	case r.Method == "GET" && key == "" && q.Get("list-type") == "2":
		s.list(w, q)
	case r.Method == "PUT" && key != "":
		md := r.Header.Get("Content-MD5")
		sum := md5.Sum(body)
		if md == "" {
			s3err(w, 400, "InvalidRequest") // object lock buckets need it
			return
		}
		if md != base64.StdEncoding.EncodeToString(sum[:]) {
			s3err(w, 400, "BadDigest")
			return
		}
		s.Objects[key] = append([]byte(nil), body...)
		w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:])+`"`)
		w.WriteHeader(200)
	case r.Method == "GET" && key != "":
		b, ok := s.Objects[key]
		if !ok {
			s3err(w, 404, "NoSuchKey")
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(b)))
		w.WriteHeader(200)
		w.Write(b)
	case r.Method == "DELETE" && key != "":
		if s.LockDeletes {
			s3err(w, 403, "AccessDenied")
			return
		}
		delete(s.Objects, key)
		w.WriteHeader(204)
	default:
		s3err(w, 405, "MethodNotAllowed")
	}
}

func (s *S3) list(w http.ResponseWriter, q url.Values) {
	prefix, delim := q.Get("prefix"), q.Get("delimiter")
	start := ""
	if t := q.Get("continuation-token"); t != "" {
		s.Tokens = append(s.Tokens, t)
		b, err := base64.StdEncoding.DecodeString(t)
		if err != nil || len(b) < 2 {
			s3err(w, 400, "InvalidArgument")
			return
		}
		start = string(b[2:])
	}
	var keys []string
	for k := range s.Objects {
		if !strings.HasPrefix(k, prefix) || k <= start {
			continue
		}
		if delim != "" && strings.Contains(strings.TrimPrefix(k, prefix), delim) {
			continue // in a "sub-folder"
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	max := s.MaxKeys
	if max <= 0 {
		max = 1000
	}
	type content struct {
		Key          string
		Size         int
		LastModified string
	}
	type result struct {
		XMLName               xml.Name `xml:"ListBucketResult"`
		Name                  string
		Prefix                string
		IsTruncated           bool
		NextContinuationToken string `xml:",omitempty"`
		EncodingType          string `xml:",omitempty"`
		Contents              []content
	}
	res := result{Name: s.Bucket, Prefix: prefix, EncodingType: q.Get("encoding-type")}
	if len(keys) > max {
		res.IsTruncated = true
		// Two bytes that base64 turns into "+/" first, so the token
		// carries the characters that must be encoded.
		res.NextContinuationToken = base64.StdEncoding.EncodeToString(append([]byte{0xfb, 0xff}, keys[max-1]...))
		keys = keys[:max]
	}
	for _, k := range keys {
		name := k
		if res.EncodingType == "url" {
			name = url.QueryEscape(k)
		}
		res.Contents = append(res.Contents, content{name, len(s.Objects[k]), "2026-11-10T12:00:00.000Z"})
	}
	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(200)
	xml.NewEncoder(w).Encode(res)
}

// -------------------------------------------------------------- OAuth ----

// OAuth is a provider's token endpoint and a stand-in for its sign-in
// page: Authorize plays the browser and the owner saying yes. It checks
// the client, the redirect address and PKCE (S256), issues refresh tokens
// and access tokens, and can rotate refresh tokens (Microsoft) or refuse
// them (invalid_grant, invalid_client).
type OAuth struct {
	mu           sync.Mutex
	ClientID     string
	ClientSecret string
	ExpiresIn    int
	Rotate       bool
	FailRefresh  string // "invalid_grant" / "invalid_client"
	NoRefresh    bool   // the code exchange gives no refresh token
	Now          func() time.Time
	Refreshes    int
	Exchanges    int
	LastAuth     url.Values
	codes        map[string]oauthCode
	refresh      map[string]bool
	access       map[string]time.Time
}

type oauthCode struct{ challenge, redirect string }

// NewOAuth is a provider for one app.
func NewOAuth(clientID, secret string) *OAuth {
	return &OAuth{ClientID: clientID, ClientSecret: secret, ExpiresIn: 3600, codes: map[string]oauthCode{}, refresh: map[string]bool{}, access: map[string]time.Time{}}
}

func (o *OAuth) now() time.Time {
	if o.Now != nil {
		return o.Now()
	}
	return time.Now()
}

func randTok(prefix string) string {
	b := make([]byte, 12)
	rand.Read(b)
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

// Authorize is the owner saying yes on the sign-in page at authURL: it
// answers the address the provider sends the browser back to.
func (o *OAuth) Authorize(authURL string) (string, error) {
	u, err := url.Parse(authURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	o.mu.Lock()
	defer o.mu.Unlock()
	o.LastAuth = q
	if q.Get("client_id") != o.ClientID || q.Get("response_type") != "code" || q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" {
		return "", fmt.Errorf("bad authorize request: %s", u.RawQuery)
	}
	code := randTok("c_")
	o.codes[code] = oauthCode{q.Get("code_challenge"), q.Get("redirect_uri")}
	back, err := url.Parse(q.Get("redirect_uri"))
	if err != nil {
		return "", err
	}
	bq := back.Query()
	bq.Set("code", code)
	bq.Set("state", q.Get("state"))
	back.RawQuery = bq.Encode()
	return back.String(), nil
}

// RefreshTokens are the valid refresh tokens.
func (o *OAuth) RefreshTokens() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	var out []string
	for k, ok := range o.refresh {
		if ok {
			out = append(out, k)
		}
	}
	return out
}

// ExpireAccess makes every access token invalid (the next call gets 401).
func (o *OAuth) ExpireAccess() {
	o.mu.Lock()
	o.access = map[string]time.Time{}
	o.mu.Unlock()
}

// Valid reports whether an Authorization header carries a live token.
func (o *OAuth) Valid(h string) bool {
	tok, ok := strings.CutPrefix(h, "Bearer ")
	if !ok {
		return false
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	until, ok := o.access[tok]
	return ok && o.now().Before(until)
}

func oauthErr(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": code})
}

func (o *OAuth) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" || !strings.HasSuffix(r.URL.Path, "/token") {
		http.NotFound(w, r)
		return
	}
	r.ParseForm()
	f := r.PostForm
	o.mu.Lock()
	defer o.mu.Unlock()
	if f.Get("client_id") != o.ClientID || f.Get("client_secret") != o.ClientSecret {
		oauthErr(w, 401, "invalid_client")
		return
	}
	ans := map[string]any{"token_type": "Bearer", "expires_in": o.ExpiresIn}
	switch f.Get("grant_type") {
	case "authorization_code":
		c, ok := o.codes[f.Get("code")]
		delete(o.codes, f.Get("code"))
		sum := sha256.Sum256([]byte(f.Get("code_verifier")))
		if !ok || c.redirect != f.Get("redirect_uri") || base64.RawURLEncoding.EncodeToString(sum[:]) != c.challenge {
			oauthErr(w, 400, "invalid_grant")
			return
		}
		o.Exchanges++
		if !o.NoRefresh {
			rt := randTok("r_")
			o.refresh[rt] = true
			ans["refresh_token"] = rt
		}
	case "refresh_token":
		o.Refreshes++
		if o.FailRefresh != "" {
			oauthErr(w, map[bool]int{true: 401, false: 400}[o.FailRefresh == "invalid_client"], o.FailRefresh)
			return
		}
		rt := f.Get("refresh_token")
		if !o.refresh[rt] {
			oauthErr(w, 400, "invalid_grant")
			return
		}
		if o.Rotate {
			delete(o.refresh, rt)
			nt := randTok("r_")
			o.refresh[nt] = true
			ans["refresh_token"] = nt
		}
	default:
		oauthErr(w, 400, "unsupported_grant_type")
		return
	}
	at := randTok("a_")
	o.access[at] = o.now().Add(time.Duration(o.ExpiresIn) * time.Second)
	ans["access_token"] = at
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ans)
}

// -------------------------------------------------------------- Drive ----

// Drive is Google Drive v3 as Topo uses it: files and folders with
// parents, queries on parents/name/mimeType/trashed, multipart uploads up
// to MultipartMax (5 MB, amendment 17), resumable uploads, alt=media,
// delete, about. Names are not unique, as on Drive.
type Drive struct {
	mu           sync.Mutex
	Auth         *OAuth
	MultipartMax int
	PageSize     int
	Account      string
	files        map[string]*DriveFile
	sessions     map[string][]byte // upload id -> metadata JSON
	n            int
	Resumables   int
	Multiparts   int
}

// DriveFile is a file or folder in the fake Drive.
type DriveFile struct {
	ID, Name, Parent, Mime string
	Body                   []byte
	Trashed                bool
	Mod                    time.Time
}

const driveFolder = "application/vnd.google-apps.folder"

// NewDrive is an empty Drive checking tokens with auth.
func NewDrive(auth *OAuth) *Drive {
	return &Drive{Auth: auth, MultipartMax: 5 << 20, PageSize: 100, Account: "ana@example.test", files: map[string]*DriveFile{}, sessions: map[string][]byte{}}
}

// Add puts a file in (tests make duplicates and strangers' files).
func (d *Drive) Add(name, parent, mimeType string, body []byte) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.add(name, parent, mimeType, body)
}

func (d *Drive) add(name, parent, mimeType string, body []byte) string {
	d.n++
	id := fmt.Sprintf("f%04d", d.n)
	d.files[id] = &DriveFile{ID: id, Name: name, Parent: parent, Mime: mimeType, Body: body, Mod: time.Date(2026, 11, 10, 12, 0, d.n, 0, time.UTC)}
	return id
}

// Find lists files called name under parent (any parent when "").
func (d *Drive) Find(name, parent string) []DriveFile {
	d.mu.Lock()
	defer d.mu.Unlock()
	var out []DriveFile
	for _, f := range d.files {
		if f.Name == name && (parent == "" || f.Parent == parent) && !f.Trashed {
			out = append(out, *f)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Path is the folder path of a file ("Topo/<site>/<name>").
func (d *Drive) Path(id string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var segs []string
	for f := d.files[id]; f != nil; f = d.files[f.Parent] {
		segs = append([]string{f.Name}, segs...)
	}
	return strings.Join(segs, "/")
}

// Trash moves a file to the bin (the owner tidying up by hand).
func (d *Drive) Trash(id string) {
	d.mu.Lock()
	if f := d.files[id]; f != nil {
		f.Trashed = true
	}
	d.mu.Unlock()
}

func unq(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(strings.TrimPrefix(s, "'"), "'")
	return strings.NewReplacer(`\'`, `'`, `\\`, `\`).Replace(s)
}

// match is a query made of clauses joined by " and ".
func (d *Drive) match(f *DriveFile, q string) bool {
	for _, c := range strings.Split(q, " and ") {
		c = strings.TrimSpace(c)
		switch {
		case strings.HasSuffix(c, " in parents"):
			if f.Parent != unq(strings.TrimSuffix(c, " in parents")) {
				return false
			}
		case c == "trashed = false":
			if f.Trashed {
				return false
			}
		case strings.HasPrefix(c, "name = "):
			if f.Name != unq(strings.TrimPrefix(c, "name = ")) {
				return false
			}
		case strings.HasPrefix(c, "mimeType != "):
			if f.Mime == unq(strings.TrimPrefix(c, "mimeType != ")) {
				return false
			}
		case strings.HasPrefix(c, "mimeType = "):
			if f.Mime != unq(strings.TrimPrefix(c, "mimeType = ")) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func (d *Drive) meta(f *DriveFile) map[string]any {
	return map[string]any{"id": f.ID, "name": f.Name, "mimeType": f.Mime, "size": strconv.Itoa(len(f.Body)), "modifiedTime": f.Mod.Format(time.RFC3339), "trashed": f.Trashed}
}

func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (d *Drive) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !d.Auth.Valid(r.Header.Get("Authorization")) {
		jsonOut(w, 401, map[string]any{"error": map[string]any{"code": 401}})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 80<<20))
	d.mu.Lock()
	defer d.mu.Unlock()
	p := r.URL.Path
	q := r.URL.Query()
	switch {
	case p == "/drive/v3/about" && r.Method == "GET":
		jsonOut(w, 200, map[string]any{"user": map[string]any{"emailAddress": d.Account}})
	case p == "/drive/v3/files" && r.Method == "GET":
		var all []*DriveFile
		for _, f := range d.files {
			if d.match(f, q.Get("q")) {
				all = append(all, f)
			}
		}
		sort.Slice(all, func(i, j int) bool { return all[i].ID < all[j].ID })
		start, _ := strconv.Atoi(q.Get("pageToken"))
		end := min(start+d.PageSize, len(all))
		out := []map[string]any{}
		for _, f := range all[min(start, len(all)):end] {
			out = append(out, d.meta(f))
		}
		ans := map[string]any{"files": out}
		if end < len(all) {
			ans["nextPageToken"] = strconv.Itoa(end)
		}
		jsonOut(w, 200, ans)
	case p == "/drive/v3/files" && r.Method == "POST":
		var m struct {
			Name     string   `json:"name"`
			MimeType string   `json:"mimeType"`
			Parents  []string `json:"parents"`
		}
		if json.Unmarshal(body, &m) != nil || len(m.Parents) != 1 {
			jsonOut(w, 400, map[string]any{})
			return
		}
		id := d.add(m.Name, m.Parents[0], m.MimeType, nil)
		jsonOut(w, 200, map[string]any{"id": id})
	case strings.HasPrefix(p, "/drive/v3/files/"):
		f := d.files[strings.TrimPrefix(p, "/drive/v3/files/")]
		if f == nil {
			jsonOut(w, 404, map[string]any{})
			return
		}
		switch r.Method {
		case "GET":
			if q.Get("alt") == "media" {
				w.WriteHeader(200)
				w.Write(f.Body)
				return
			}
			jsonOut(w, 200, d.meta(f))
		case "DELETE":
			delete(d.files, f.ID)
			w.WriteHeader(204)
		default:
			w.WriteHeader(405)
		}
	case p == "/upload/drive/v3/files" && r.Method == "POST" && q.Get("uploadType") == "multipart":
		d.Multiparts++
		if len(body) > d.MultipartMax+4096 {
			jsonOut(w, 413, map[string]any{})
			return
		}
		mt, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mt != "multipart/related" {
			jsonOut(w, 400, map[string]any{})
			return
		}
		mr := multipart.NewReader(strings.NewReader(string(body)), params["boundary"])
		var parts [][]byte
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			b, _ := io.ReadAll(part)
			parts = append(parts, b)
		}
		if len(parts) != 2 {
			jsonOut(w, 400, map[string]any{})
			return
		}
		d.create(w, parts[0], parts[1])
	case p == "/upload/drive/v3/files" && r.Method == "POST" && q.Get("uploadType") == "resumable":
		id := randTok("u_")
		d.sessions[id] = body
		w.Header().Set("Location", "http://"+r.Host+"/upload/drive/v3/files?uploadType=resumable&upload_id="+id)
		w.WriteHeader(200)
	case p == "/upload/drive/v3/files" && r.Method == "PUT" && q.Get("upload_id") != "":
		meta, ok := d.sessions[q.Get("upload_id")]
		if !ok {
			jsonOut(w, 404, map[string]any{})
			return
		}
		delete(d.sessions, q.Get("upload_id"))
		d.Resumables++
		d.create(w, meta, body)
	default:
		jsonOut(w, 404, map[string]any{})
	}
}

func (d *Drive) create(w http.ResponseWriter, meta, body []byte) {
	var m struct {
		Name     string   `json:"name"`
		MimeType string   `json:"mimeType"`
		Parents  []string `json:"parents"`
	}
	if json.Unmarshal(meta, &m) != nil || len(m.Parents) != 1 || d.files[m.Parents[0]] == nil {
		jsonOut(w, 400, map[string]any{})
		return
	}
	id := d.add(m.Name, m.Parents[0], m.MimeType, append([]byte(nil), body...))
	jsonOut(w, 200, map[string]any{"id": id, "size": strconv.Itoa(len(body))})
}

// -------------------------------------------------------------- Graph ----

// Graph is OneDrive's app folder through Microsoft Graph: simple PUT up to
// 4 MB, upload sessions, children with @odata.nextLink pages, content GET
// answered with a 302 to another host, delete by path or id. Other is the
// handler of that other host (upload sessions and downloads); it refuses
// any request that carries a token (amendment 12) and counts them.
type Graph struct {
	mu        sync.Mutex
	Auth      *OAuth
	OtherBase string // set by the test: the other host's URL
	PageSize  int
	items     map[string]*graphItem // path in the app folder -> file
	sessions  map[string]*graphSession
	n         int
	Sessions  int
	TokenSent int // requests to the other host that carried a token
}

type graphItem struct {
	id   string
	body []byte
}

type graphSession struct {
	path string
	buf  []byte
	size int
}

// NewGraph is an empty app folder.
func NewGraph(auth *OAuth) *Graph {
	return &Graph{Auth: auth, PageSize: 200, items: map[string]*graphItem{}, sessions: map[string]*graphSession{}}
}

// Files lists the paths in the app folder.
func (g *Graph) Files() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	var out []string
	for p := range g.items {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

// File is the body at path.
func (g *Graph) File(p string) ([]byte, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	it, ok := g.items[p]
	if !ok {
		return nil, false
	}
	return it.body, true
}

func (g *Graph) itemJSON(p string, it *graphItem) map[string]any {
	name := p[strings.LastIndex(p, "/")+1:]
	return map[string]any{"id": it.id, "name": name, "size": len(it.body), "lastModifiedDateTime": "2026-11-10T12:00:00Z", "file": map[string]any{"mimeType": "application/json"}}
}

func (g *Graph) byID(id string) (string, *graphItem) {
	for p, it := range g.items {
		if it.id == id {
			return p, it
		}
	}
	return "", nil
}

func (g *Graph) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !g.Auth.Valid(r.Header.Get("Authorization")) {
		jsonOut(w, 401, map[string]any{"error": map[string]any{"code": "InvalidAuthenticationToken"}})
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 80<<20))
	g.mu.Lock()
	defer g.mu.Unlock()
	const root = "/v1.0/me/drive/special/approot"
	p := r.URL.Path
	switch {
	case p == root && r.Method == "GET":
		jsonOut(w, 200, map[string]any{"id": "approot", "name": "Topo", "createdBy": map[string]any{"user": map[string]any{"displayName": "Ana Example"}}})
	case p == root+"/children" && r.Method == "GET":
		g.children(w, r, "")
	case strings.HasPrefix(p, root+":/"):
		rest := strings.TrimPrefix(p, root+":/")
		item, suffix := rest, ""
		if i := strings.LastIndex(rest, ":"); i >= 0 {
			item, suffix = rest[:i], rest[i+1:]
		}
		switch {
		case suffix == "/content" && r.Method == "PUT":
			if len(body) > 4<<20 {
				jsonOut(w, 413, map[string]any{})
				return
			}
			it := g.put(item, body)
			jsonOut(w, 201, g.itemJSON(item, it))
		case suffix == "/content" && r.Method == "GET":
			it := g.items[item]
			if it == nil {
				jsonOut(w, 404, map[string]any{})
				return
			}
			w.Header().Set("Location", g.OtherBase+"/dl/"+it.id)
			w.WriteHeader(302)
		case suffix == "/children" && r.Method == "GET":
			g.children(w, r, item)
		case suffix == "/createUploadSession" && r.Method == "POST":
			id := randTok("s_")
			g.sessions[id] = &graphSession{path: item}
			g.Sessions++
			jsonOut(w, 200, map[string]any{"uploadUrl": g.OtherBase + "/up/" + id})
		case suffix == "" && r.Method == "DELETE":
			if g.items[item] == nil {
				jsonOut(w, 404, map[string]any{})
				return
			}
			delete(g.items, item)
			w.WriteHeader(204)
		default:
			jsonOut(w, 400, map[string]any{})
		}
	case strings.HasPrefix(p, "/v1.0/me/drive/items/"):
		rest := strings.TrimPrefix(p, "/v1.0/me/drive/items/")
		id, content := strings.CutSuffix(rest, "/content")
		path, it := g.byID(id)
		if it == nil {
			jsonOut(w, 404, map[string]any{})
			return
		}
		switch {
		case content && r.Method == "GET":
			w.Header().Set("Location", g.OtherBase+"/dl/"+it.id)
			w.WriteHeader(302)
		case !content && r.Method == "DELETE":
			delete(g.items, path)
			w.WriteHeader(204)
		default:
			jsonOut(w, 400, map[string]any{})
		}
	default:
		jsonOut(w, 404, map[string]any{})
	}
}

func (g *Graph) put(p string, body []byte) *graphItem {
	it := g.items[p]
	if it == nil {
		g.n++
		it = &graphItem{id: fmt.Sprintf("i%04d", g.n)}
		g.items[p] = it
	}
	it.body = append([]byte(nil), body...)
	return it
}

func (g *Graph) children(w http.ResponseWriter, r *http.Request, dir string) {
	pre := ""
	if dir != "" {
		pre = dir + "/"
		found := false
		for p := range g.items {
			if strings.HasPrefix(p, pre) {
				found = true
			}
		}
		if !found {
			jsonOut(w, 404, map[string]any{"error": map[string]any{"code": "itemNotFound"}})
			return
		}
	}
	var names []string
	folders := map[string]bool{}
	for p := range g.items {
		if !strings.HasPrefix(p, pre) {
			continue
		}
		rest := strings.TrimPrefix(p, pre)
		if f, _, sub := strings.Cut(rest, "/"); sub {
			folders[f] = true
			continue
		}
		names = append(names, p)
	}
	sort.Strings(names)
	var vals []map[string]any
	for f := range folders {
		vals = append(vals, map[string]any{"id": "d-" + f, "name": f, "folder": map[string]any{}})
	}
	for _, p := range names {
		vals = append(vals, g.itemJSON(p, g.items[p]))
	}
	skip, _ := strconv.Atoi(r.URL.Query().Get("$skiptoken"))
	end := min(skip+g.PageSize, len(vals))
	ans := map[string]any{"value": vals[min(skip, len(vals)):end]}
	if end < len(vals) {
		u := *r.URL
		q := u.Query()
		q.Set("$skiptoken", strconv.Itoa(end))
		u.RawQuery = q.Encode()
		ans["@odata.nextLink"] = "http://" + r.Host + u.RequestURI()
	}
	jsonOut(w, 200, ans)
}

// Other serves the second host: upload sessions and downloads.
func (g *Graph) Other() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 80<<20))
		g.mu.Lock()
		defer g.mu.Unlock()
		if r.Header.Get("Authorization") != "" {
			g.TokenSent++
			jsonOut(w, 401, map[string]any{})
			return
		}
		switch {
		case strings.HasPrefix(r.URL.Path, "/dl/") && r.Method == "GET":
			_, it := g.byID(strings.TrimPrefix(r.URL.Path, "/dl/"))
			if it == nil {
				w.WriteHeader(404)
				return
			}
			w.WriteHeader(200)
			w.Write(it.body)
		case strings.HasPrefix(r.URL.Path, "/up/") && r.Method == "PUT":
			s := g.sessions[strings.TrimPrefix(r.URL.Path, "/up/")]
			if s == nil {
				w.WriteHeader(404)
				return
			}
			var from, to, total int
			if _, err := fmt.Sscanf(r.Header.Get("Content-Range"), "bytes %d-%d/%d", &from, &to, &total); err != nil || from != len(s.buf) || to-from+1 != len(body) {
				jsonOut(w, 416, map[string]any{})
				return
			}
			if len(body)%(320<<10) != 0 && to+1 != total {
				jsonOut(w, 400, map[string]any{}) // pieces must be multiples of 320 KiB
				return
			}
			s.buf = append(s.buf, body...)
			if len(s.buf) < total {
				jsonOut(w, 202, map[string]any{"nextExpectedRanges": []string{fmt.Sprintf("%d-", len(s.buf))}})
				return
			}
			it := g.put(s.path, s.buf)
			delete(g.sessions, strings.TrimPrefix(r.URL.Path, "/up/"))
			jsonOut(w, 201, g.itemJSON(s.path, it))
		default:
			w.WriteHeader(404)
		}
	})
}
