package backup

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// The GetObject example of AWS's documentation ("Signature Calculations
// for the Authorization Header: Transferring Payload in a Single Chunk"):
// GET /test.txt from examplebucket with Range: bytes=0-9 on 24 May 2013.
func TestSigV4AWSExample(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	req.Header.Set("Range", "bytes=0-9")
	empty := sha256Hex(nil)
	signV4(req, empty, "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC))
	want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got := req.Header.Get("Authorization"); got != want {
		t.Fatalf("Authorization:\n got %s\nwant %s", got, want)
	}
}

func TestAWSEncode(t *testing.T) {
	cases := map[string]string{"a b+c/d=e~f": "a%20b%2Bc%2Fd%3De~f", "é": "%C3%A9"}
	for in, want := range cases {
		if got := awsEncode(in, false); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
	if got := awsEncode("topo/s 1/x.json", true); got != "topo/s%201/x.json" {
		t.Errorf("key: %q", got)
	}
	if q := canonicalQuery([][2]string{{"prefix", "topo/a/"}, {"list-type", "2"}, {"continuation-token", "a+b/c="}}); q != "continuation-token=a%2Bb%2Fc%3D&list-type=2&prefix=topo%2Fa%2F" {
		t.Errorf("query: %s", q)
	}
	if h := signHost("https", "minio.lan:9000"); h != "minio.lan:9000" {
		t.Errorf("port kept: %s", h)
	}
	if h := signHost("https", "s3.example.com:443"); h != "s3.example.com" {
		t.Errorf("default port dropped: %s", h)
	}
}

// Virtual-host and path style, and a dotted bucket forced to path style
// (its name would not match the certificate as a host name, amendment 16).
func TestS3URLs(t *testing.T) {
	mk := func(endpoint, bucket, path string) *S3 {
		s, err := NewS3(Settings{Kind: "s3", Fields: map[string]string{"endpoint": endpoint, "bucket": bucket, "keyId": "k", "pathStyle": path}, Secrets: map[string]string{"secret": "s"}}, nil)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	if u := mk("https://s3.us-west-004.backblazeb2.com", "my-bucket", "").objectURL("topo/a b.json"); u.String() != "https://my-bucket.s3.us-west-004.backblazeb2.com/topo/a%20b.json" {
		t.Errorf("virtual host: %s", u)
	}
	if u := mk("https://minio.lan:9000/", "backups", "1").objectURL("topo/x.json"); u.String() != "https://minio.lan:9000/backups/topo/x.json" {
		t.Errorf("path style: %s", u)
	}
	if u := mk("https://s3.example.com", "my.bucket", "").objectURL("k"); !strings.HasPrefix(u.String(), "https://s3.example.com/my.bucket/") {
		t.Errorf("dotted bucket: %s", u)
	}
}
