package backup

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"
)

// AWS Signature Version 4 for S3 (D111), by hand: the standard library's
// crypto/hmac and crypto/sha256, no SDK (D109). Checked against the
// GetObject example in AWS's documentation (sigv4_test.go).

// awsEncode is SigV4's URI encoding: the unreserved characters A-Z a-z 0-9
// - _ . ~ stay, everything else is %XX in upper case; "/" stays when
// keepSlash (an object key in the path).
func awsEncode(s string, keepSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case 'A' <= c && c <= 'Z', 'a' <= c && c <= 'z', '0' <= c && c <= '9', c == '-', c == '_', c == '.', c == '~':
			b.WriteByte(c)
		case c == '/' && keepSlash:
			b.WriteByte(c)
		default:
			const hexd = "0123456789ABCDEF"
			b.WriteByte('%')
			b.WriteByte(hexd[c>>4])
			b.WriteByte(hexd[c&15])
		}
	}
	return b.String()
}

// canonicalQuery encodes params the way SigV4 wants them: every name and
// value encoded, sorted by name then value. The same string is sent.
func canonicalQuery(params [][2]string) string {
	enc := make([]string, 0, len(params))
	for _, p := range params {
		enc = append(enc, awsEncode(p[0], false)+"="+awsEncode(p[1], false))
	}
	sort.Strings(enc)
	return strings.Join(enc, "&")
}

func hmacSHA256(key []byte, s string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(s))
	return m.Sum(nil)
}

func sha256Hex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// signHost is the Host as signed: without the scheme's default port.
func signHost(scheme, host string) string {
	h, p, err := net.SplitHostPort(host)
	if err != nil {
		return host
	}
	if (scheme == "https" && p == "443") || (scheme == "http" && p == "80") {
		if strings.Contains(h, ":") {
			return "[" + h + "]"
		}
		return h
	}
	return host
}

// signV4 signs req for service s3 in region at t. req.URL must already
// carry the canonical path (RawPath) and the canonical query (RawQuery).
// payloadHash is the hex SHA-256 of the body. Signed headers: host, and
// content-md5, content-type, range and every x-amz-* header present.
func signV4(req *http.Request, payloadHash, keyID, secret, region string, t time.Time) {
	amzDate := t.UTC().Format("20060102T150405Z")
	date := amzDate[:8]
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	host := signHost(req.URL.Scheme, req.URL.Host)
	req.Host = host

	hdr := map[string]string{"host": host}
	for k, vs := range req.Header {
		lk := strings.ToLower(k)
		if lk == "content-md5" || lk == "content-type" || lk == "range" || strings.HasPrefix(lk, "x-amz-") {
			vals := make([]string, len(vs))
			for i, v := range vs {
				vals[i] = strings.Join(strings.Fields(v), " ")
			}
			hdr[lk] = strings.Join(vals, ",")
		}
	}
	names := make([]string, 0, len(hdr))
	for k := range hdr {
		names = append(names, k)
	}
	sort.Strings(names)
	var ch strings.Builder
	for _, k := range names {
		ch.WriteString(k + ":" + hdr[k] + "\n")
	}
	signed := strings.Join(names, ";")
	uri := req.URL.EscapedPath()
	if uri == "" {
		uri = "/"
	}
	canon := strings.Join([]string{req.Method, uri, req.URL.RawQuery, ch.String(), signed, payloadHash}, "\n")
	scope := date + "/" + region + "/s3/aws4_request"
	sts := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + sha256Hex([]byte(canon))
	k := hmacSHA256([]byte("AWS4"+secret), date)
	k = hmacSHA256(k, region)
	k = hmacSHA256(k, "s3")
	k = hmacSHA256(k, "aws4_request")
	sig := hex.EncodeToString(hmacSHA256(k, sts))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+keyID+"/"+scope+", SignedHeaders="+signed+", Signature="+sig)
}
