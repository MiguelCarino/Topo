package backup

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"time"
)

// certError is a certificate the far end presented that is not trusted
// (not the pinned one, or not valid under the system roots).
type certError struct {
	fingerprint string
	err         error
}

func (e *certError) Error() string { return "certificate not trusted: " + e.err.Error() }

// Fingerprint is the SHA-256 of a certificate's DER bytes, lowercase hex.
func Fingerprint(der []byte) string {
	s := sha256.Sum256(der)
	return hex.EncodeToString(s[:])
}

// newHTTPClient is the client every remote destination uses:
//   - redirects are never followed (amendment 12): Go turns a PUT that gets
//     a 301/302/303 into a GET answering 200, which would report a lost
//     upload as a success; a 3xx is a bad answer;
//   - with pin (a SHA-256 fingerprint, amendment 15) exactly that leaf
//     certificate is accepted and nothing else; without it the system roots
//     decide. Either way a refusal carries the presented fingerprint, so the
//     owner can compare it and paste it.
func newHTTPClient(pin string) *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.Proxy = nil // a backup goes to the address typed, not through a proxy
	tr.DialContext = (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	tr.ResponseHeaderTimeout = 60 * time.Second
	tr.TLSClientConfig = &tls.Config{
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: true, // verified below, by pin or by the system roots
		VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return &certError{err: errors.New("no certificate")}
			}
			leaf := cs.PeerCertificates[0]
			fp := Fingerprint(leaf.Raw)
			if pin != "" {
				if fp != pin {
					return &certError{fingerprint: fp, err: errors.New("not the saved fingerprint")}
				}
				return nil
			}
			opts := x509.VerifyOptions{DNSName: cs.ServerName, Intermediates: x509.NewCertPool()}
			for _, c := range cs.PeerCertificates[1:] {
				opts.Intermediates.AddCert(c)
			}
			if _, err := leaf.Verify(opts); err != nil {
				return &certError{fingerprint: fp, err: err}
			}
			return nil
		},
	}
	return &http.Client{
		Transport:     tr,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// netErr maps a transport error to a destination error.
func netErr(err error) error {
	var ce *certError
	if errors.As(err, &ce) {
		return &Error{Code: CodeCertificate, Err: err, Fingerprint: ce.fingerprint}
	}
	return &Error{Code: CodeUnreachable, Err: err}
}

// statusErr maps an HTTP status that is not a success.
func statusErr(code int) error {
	c := CodeBadAnswer
	switch {
	case code == 401 || code == 403:
		c = CodeRefused
	case code == 404 || code == 410:
		c = CodeNotFound
	case code == 409 || code == 412 || code == 423:
		c = CodeConflict
	case code == 413:
		c = CodeTooLarge
	case code == 507:
		c = CodeFull
	case code == 502 || code == 503 || code == 504 || code == 408 || code == 429:
		c = CodeUnreachable
	}
	return errf(c, "HTTP %d", code)
}
