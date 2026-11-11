package backup

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/xml"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"
)

// S3 writes into a bucket of any S3-compatible store: Backblaze B2 (its S3
// API), Wasabi, MinIO, AWS (D111). Requests are signed with SigV4 by hand
// (sigv4.go, D109). Virtual-host addresses by default; path style when the
// owner ticks it (MinIO and most self-hosted stores) or the bucket name has
// a dot (amendment 16). Redirects are never followed (amendment 12).
type S3 struct {
	scheme, host, basePath string // the endpoint
	bucket, prefix         string // prefix ends with "/" (or is "")
	region, keyID, secret  string
	pathStyle              bool
	c                      *http.Client
	now                    func() time.Time
}

// s3Endpoint parses the endpoint: https, or http on this machine only.
func s3Endpoint(raw string) (*url.URL, error) {
	u, err := davBase(raw) // the same rules as a WebDAV address
	if err != nil {
		return nil, err
	}
	return u, nil
}

// NewS3 opens an S3 destination from normalised settings; now is the
// clock requests are signed with (nil: time.Now).
func NewS3(s Settings, now func() time.Time) (*S3, error) {
	u, err := s3Endpoint(s.Fields["endpoint"])
	if err != nil {
		return nil, &FieldError{"endpoint", "bad"}
	}
	if now == nil {
		now = time.Now
	}
	region := s.Fields["region"]
	if region == "" {
		region = "us-east-1"
	}
	bucket := s.Fields["bucket"]
	return &S3{scheme: u.Scheme, host: u.Host, basePath: strings.TrimSuffix(u.Path, "/"), bucket: bucket, prefix: s3Prefix(s.Fields["prefix"]),
		region: region, keyID: s.Fields["keyId"], secret: s.Secrets["secret"],
		pathStyle: s.Fields["pathStyle"] == "1" || strings.Contains(bucket, "."), c: newHTTPClient(s.Fields["fingerprint"]), now: now}, nil
}

// s3Prefix is the folder inside the bucket: "topo/" when empty, never a
// leading "/", always a trailing one.
func s3Prefix(p string) string {
	p = strings.Trim(strings.TrimSpace(p), "/")
	if p == "" {
		return "topo/"
	}
	return path.Clean(p) + "/"
}

func (s *S3) Kind() string { return "s3" }

// objectURL is the address of key ("" is the bucket itself).
func (s *S3) objectURL(key string) *url.URL {
	u := &url.URL{Scheme: s.scheme, Host: s.host}
	p := s.basePath
	if s.pathStyle {
		p += "/" + s.bucket
	} else {
		u.Host = s.bucket + "." + s.host
	}
	p += "/" + key
	u.Path = p
	u.RawPath = awsEncode(p, true)
	return u
}

// s3Error is the <Error> body S3 answers with.
type s3Error struct {
	Code    string `xml:"Code"`
	Message string `xml:"Message"`
}

func (s *S3) do(ctx context.Context, method, key string, query [][2]string, body []byte, hdr map[string]string) (*http.Response, error) {
	u := s.objectURL(key)
	u.RawQuery = canonicalQuery(query)
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), rd)
	if err != nil {
		return nil, errf(CodeOther, "request: %v", err)
	}
	// NewRequest re-parses the address; keep the exact encoding signed.
	req.URL.RawPath, req.URL.RawQuery = u.RawPath, u.RawQuery
	if body != nil {
		req.ContentLength = int64(len(body))
	}
	req.Header.Set("User-Agent", "topo-server")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	signV4(req, sha256Hex(body), s.keyID, s.secret, s.region, s.now())
	resp, err := s.c.Do(req)
	if err != nil {
		return nil, netErr(err)
	}
	return resp, nil
}

// failure reads an error answer into a code. 403 SignatureDoesNotMatch,
// InvalidAccessKeyId, AccessDenied: refused; NoSuchBucket, NoSuchKey: not
// found; RequestTimeTooSkewed: this server's clock is wrong.
func s3Failure(resp *http.Response) error {
	defer drain(resp)
	var e s3Error
	if resp.Body != nil {
		xml.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&e)
	}
	switch e.Code {
	case "RequestTimeTooSkewed":
		return errf(CodeClock, "S3: %s", e.Code)
	case "NoSuchBucket", "NoSuchKey":
		return errf(CodeNotFound, "S3: %s", e.Code)
	case "SignatureDoesNotMatch", "InvalidAccessKeyId", "AccessDenied", "InvalidToken", "ExpiredToken":
		return errf(CodeRefused, "S3: %s", e.Code)
	case "EntityTooLarge":
		return errf(CodeTooLarge, "S3: %s", e.Code)
	}
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		return errf(CodeBadAnswer, "S3: HTTP %d (a redirect; check the region and the path-style tick)", resp.StatusCode)
	}
	return statusErr(resp.StatusCode)
}

func (s *S3) Put(ctx context.Context, name string, body []byte) (string, error) {
	if len(body) > MaxFile {
		return "", errf(CodeTooLarge, "%d bytes", len(body))
	}
	if !validRel(name) {
		return "", errf(CodeOther, "bad name")
	}
	if body == nil {
		body = []byte{}
	}
	sum := md5.Sum(body)
	// Content-MD5: buckets with object lock (B2, Wasabi) refuse a PUT
	// without it (amendment 16).
	resp, err := s.do(ctx, "PUT", s.prefix+name, nil, body, map[string]string{"Content-Type": "application/json", "Content-MD5": base64.StdEncoding.EncodeToString(sum[:])})
	if err != nil {
		return "", err
	}
	if resp.StatusCode != 200 {
		return "", s3Failure(resp)
	}
	drain(resp)
	return "", nil
}

func (s *S3) Get(ctx context.Context, name, ref string) (io.ReadCloser, error) {
	if !validRel(name) {
		return nil, errf(CodeOther, "bad name")
	}
	resp, err := s.do(ctx, "GET", s.prefix+name, nil, nil, nil)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, s3Failure(resp)
	}
	return resp.Body, nil
}

func (s *S3) Delete(ctx context.Context, name, ref string) error {
	if !validRel(name) {
		return errf(CodeOther, "bad name")
	}
	resp, err := s.do(ctx, "DELETE", s.prefix+name, nil, nil, nil)
	if err != nil {
		return err
	}
	if resp.StatusCode == 200 || resp.StatusCode == 204 {
		drain(resp)
		return nil
	}
	err = s3Failure(resp)
	// The same keys wrote and read the file: a refused delete is the
	// bucket's object lock or retention (amendment 16).
	if c := CodeOf(err); c == CodeRefused || c == CodeConflict {
		return &Error{Code: CodeLocked, Err: err}
	}
	return err
}

// listResult is a ListObjectsV2 answer.
type listResult struct {
	IsTruncated           bool   `xml:"IsTruncated"`
	NextContinuationToken string `xml:"NextContinuationToken"`
	EncodingType          string `xml:"EncodingType"`
	Contents              []struct {
		Key          string `xml:"Key"`
		Size         int64  `xml:"Size"`
		LastModified string `xml:"LastModified"`
	} `xml:"Contents"`
}

func (s *S3) List(ctx context.Context, dir string) ([]Entry, error) {
	if dir != "" && !validRel(dir) {
		return nil, errf(CodeOther, "bad name")
	}
	pre := s.prefix
	if dir != "" {
		pre += dir + "/"
	}
	var out []Entry
	token := ""
	for page := 0; page < 1000; page++ {
		q := [][2]string{{"list-type", "2"}, {"prefix", pre}, {"delimiter", "/"}, {"encoding-type", "url"}}
		if token != "" {
			q = append(q, [2]string{"continuation-token", token})
		}
		resp, err := s.do(ctx, "GET", "", q, nil, nil)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != 200 {
			return nil, s3Failure(resp)
		}
		var lr listResult
		err = xml.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&lr)
		drain(resp)
		if err != nil {
			return nil, errf(CodeBadAnswer, "list: %v", err)
		}
		for _, c := range lr.Contents {
			key := c.Key
			if lr.EncodingType == "url" {
				if k, err := url.QueryUnescape(key); err == nil {
					key = k
				}
			}
			if !strings.HasPrefix(key, pre) {
				continue
			}
			name := strings.TrimPrefix(key, pre)
			if name == "" || strings.Contains(name, "/") {
				continue
			}
			e := Entry{Name: name, Size: c.Size}
			if t, err := time.Parse(time.RFC3339, c.LastModified); err == nil {
				e.Mod = t
			}
			out = append(out, e)
		}
		if !lr.IsTruncated || lr.NextContinuationToken == "" {
			sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
			return out, nil
		}
		token = lr.NextContinuationToken
	}
	return nil, errf(CodeBadAnswer, "list: too many pages")
}

func (s *S3) Check(ctx context.Context) error {
	// The bucket answers a listing first: a wrong region, bucket or key
	// says so before anything is written.
	if _, err := s.List(ctx, ""); err != nil {
		return err
	}
	return probe(ctx, s)
}
