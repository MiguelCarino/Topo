package backup

import (
	"fmt"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"carino.systems/topo/server/internal/config"
)

// Settings are a destination as the server owner typed it: the kind, its
// plain fields and its secrets (D99, D105).
type Settings struct {
	Kind    string
	Fields  map[string]string
	Secrets map[string]string
}

// kindSpec says what each kind takes.
type kindSpec struct {
	fields   []string // plain fields (stored as JSON, returned to the browser)
	required []string
	secrets  []string // sealed, never returned
	// hostFields: changing one of these without typing the secret again
	// clears the stored secret, so a password cannot be sent to a new host.
	hostFields []string
	// serverSecrets are sealed like secrets but only the server sets them
	// (the drive's refresh token, D110): never typed, never returned.
	serverSecrets []string
	// ticks are fields that are "1" or empty.
	ticks []string
}

var kinds = map[string]kindSpec{
	"folder": {fields: []string{"path"}, required: []string{"path"}},
	"webdav": {fields: []string{"url", "user", "fingerprint"}, required: []string{"url", "user"}, secrets: []string{"password"}, hostFields: []string{"url"}},
	// 5c (D110, D111).
	"s3": {fields: []string{"endpoint", "region", "bucket", "prefix", "keyId", "pathStyle", "fingerprint"}, required: []string{"endpoint", "bucket", "keyId"},
		secrets: []string{"secret"}, hostFields: []string{"endpoint", "keyId"}, ticks: []string{"pathStyle"}},
	"gdrive": {fields: []string{"clientId"}, required: []string{"clientId"}, secrets: []string{"clientSecret"}, serverSecrets: []string{"refreshToken"},
		hostFields: []string{"clientId"}},
	"onedrive": {fields: []string{"clientId", "tenant"}, required: []string{"clientId"}, secrets: []string{"clientSecret"}, serverSecrets: []string{"refreshToken"},
		hostFields: []string{"clientId", "tenant"}},
}

// OAuthKind reports whether kind signs in with OAuth (Connect, D110).
func OAuthKind(kind string) bool { return kind == "gdrive" || kind == "onedrive" }

// Kinds are the destination kinds this build knows.
func Kinds() []string {
	var out []string
	for k := range kinds {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// KnownKind reports whether kind is a destination kind.
func KnownKind(kind string) bool { _, ok := kinds[kind]; return ok }

// SecretNames are the secret fields of kind the owner types.
func SecretNames(kind string) []string { return kinds[kind].secrets }

// allSecrets are the typed and the server-only secrets of kind.
func allSecrets(kind string) []string {
	return append(append([]string{}, kinds[kind].secrets...), kinds[kind].serverSecrets...)
}

// HostFields are the fields whose change clears a stored secret.
func HostFields(kind string) []string { return kinds[kind].hostFields }

// FieldError is a setting that does not validate: the field and a code the
// browser translates (missing, bad, not-allowed).
type FieldError struct {
	Field string
	Code  string
}

func (e *FieldError) Error() string { return e.Field + ": " + e.Code }

// Normalize trims the fields of s, drops unknown ones and normalises the
// certificate fingerprint. It does not check them (Validate does).
func Normalize(s Settings) Settings {
	spec := kinds[s.Kind]
	out := Settings{Kind: s.Kind, Fields: map[string]string{}, Secrets: map[string]string{}}
	for _, f := range spec.fields {
		v := strings.TrimSpace(s.Fields[f])
		switch f {
		case "fingerprint":
			v = normFingerprint(v)
		case "prefix":
			if s.Kind == "s3" {
				v = s3Prefix(v)
			}
		case "tenant":
			if v == "" {
				v = "common"
			}
		case "region":
			v = strings.ToLower(v)
		}
		for _, tk := range spec.ticks {
			if f == tk {
				if v == "1" || v == "true" || v == "on" {
					v = "1"
				} else {
					v = ""
				}
			}
		}
		if v != "" {
			out.Fields[f] = v
		}
	}
	for _, f := range allSecrets(s.Kind) {
		if v, ok := s.Secrets[f]; ok && v != "" {
			out.Secrets[f] = v
		}
	}
	return out
}

func normFingerprint(s string) string {
	s = strings.ToLower(strings.NewReplacer(":", "", " ", "", "-", "").Replace(s))
	s = strings.TrimPrefix(s, "sha256")
	return s
}

var (
	hex64    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	reRegion = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)
	reBucket = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$`)
	reKeyID  = regexp.MustCompile(`^[A-Za-z0-9+/=._-]{1,256}$`)
	rePrefix = regexp.MustCompile(`^[A-Za-z0-9._ -]+(/[A-Za-z0-9._ -]+)*/$`)
	reClient = regexp.MustCompile(`^[A-Za-z0-9._-]{1,256}$`)
	reTenant = regexp.MustCompile(`^[A-Za-z0-9.-]{1,100}$`)
)

// Validate checks normalised settings; roots are TOPO_BACKUP_FOLDERS.
func Validate(s Settings, roots []string) error {
	spec, ok := kinds[s.Kind]
	if !ok {
		return &FieldError{"kind", "bad"}
	}
	for _, f := range spec.required {
		if s.Fields[f] == "" {
			return &FieldError{f, "missing"}
		}
	}
	for _, f := range spec.fields {
		if len(s.Fields[f]) > 2048 {
			return &FieldError{f, "bad"}
		}
	}
	switch s.Kind {
	case "folder":
		if _, err := allowedFolder(s.Fields["path"], roots); err != nil {
			return err
		}
	case "webdav":
		if _, err := davBase(s.Fields["url"]); err != nil {
			return &FieldError{"url", "bad"}
		}
		if strings.ContainsAny(s.Fields["user"], ":\r\n") {
			return &FieldError{"user", "bad"}
		}
	case "s3":
		if _, err := s3Endpoint(s.Fields["endpoint"]); err != nil {
			return &FieldError{"endpoint", "bad"}
		}
		if r := s.Fields["region"]; r != "" && !reRegion.MatchString(r) {
			return &FieldError{"region", "bad"}
		}
		if !reBucket.MatchString(s.Fields["bucket"]) || strings.Contains(s.Fields["bucket"], "..") {
			return &FieldError{"bucket", "bad"}
		}
		if p := s.Fields["prefix"]; p != "" && (!rePrefix.MatchString(p) || strings.Contains("/"+p, "/../") || strings.Contains("/"+p, "/./")) {
			return &FieldError{"prefix", "bad"}
		}
		if !reKeyID.MatchString(s.Fields["keyId"]) {
			return &FieldError{"keyId", "bad"}
		}
	case "gdrive", "onedrive":
		if !reClient.MatchString(s.Fields["clientId"]) {
			return &FieldError{"clientId", "bad"}
		}
		if t := s.Fields["tenant"]; s.Kind == "onedrive" && !reTenant.MatchString(t) {
			return &FieldError{"tenant", "bad"}
		}
	}
	if fp := s.Fields["fingerprint"]; fp != "" && !hex64.MatchString(fp) {
		return &FieldError{"fingerprint", "bad"}
	}
	for _, f := range allSecrets(s.Kind) {
		if strings.ContainsAny(s.Secrets[f], "\r\n") || len(s.Secrets[f]) > 8192 {
			return &FieldError{f, "bad"}
		}
	}
	return nil
}

// davBase parses a WebDAV folder address: https, or http on a loopback
// host only (the password would cross the network in clear, D52's spirit).
// It returns the address with exactly one trailing slash.
func davBase(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("bad address")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !config.IsLoopbackHost(u.Hostname()) {
			return nil, fmt.Errorf("http only on this machine")
		}
	default:
		return nil, fmt.Errorf("bad scheme")
	}
	p := path.Clean("/" + u.Path)
	if p != "/" {
		p += "/"
	}
	u.Path, u.RawPath = p, ""
	return u, nil
}

// ParseDailyAt checks an HH:MM time of day.
func ParseDailyAt(s string) (int, int, bool) {
	t, err := time.Parse("15:04", s)
	if err != nil || len(s) != 5 {
		return 0, 0, false
	}
	return t.Hour(), t.Minute(), true
}
