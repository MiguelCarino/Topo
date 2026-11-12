package tcrypto

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// Record is what a monitor or a person writes beside the document
// (docs/SCOPE.md D158, D159, step 7h): a monitor's status or statistics of
// a day, an issue, a person's act on one, a quiet window. Sealed with the
// site key of Epoch and signed by Author (js/servercrypto.js sealRecord,
// desktop/src-tauri/src/servercrypto.rs seal_record). The server checks the
// shape and the signature against the author's registered key; it never
// reads the plaintext.
type Record struct {
	V      int    `json:"v"`
	Site   string `json:"site"`
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Epoch  int64  `json:"epoch"`
	Author string `json:"author"`
	At     int64  `json:"at"`
	CTHash string `json:"ctHash"`
	Sig    string `json:"sig"`
	IV     string `json:"iv"`
	CT     string `json:"ct"`
}

// RecordKinds are the kinds a record may be.
var RecordKinds = map[string]bool{"status": true, "issue": true, "act": true, "quiet": true, "stats": true}

var recordIDRe = regexp.MustCompile(`^[A-Za-z0-9_|:.-]{1,160}$`)

// AAD is ["topo-record-v1", site, kind, id, epoch, author, at] joined by
// "\n"; the signed text adds the ciphertext hash as its last line.
func (r *Record) AAD() string {
	return strings.Join([]string{"topo-record-v1", r.Site, r.Kind, r.ID, strconv.FormatInt(r.Epoch, 10), r.Author, strconv.FormatInt(r.At, 10)}, "\n")
}

// SignedString is the AAD and the ciphertext hash.
func (r *Record) SignedString() string { return r.AAD() + "\n" + r.CTHash }

// ParseRecord decodes and shape-checks a record (the ciphertext hash
// included); Verify checks its signature.
func ParseRecord(raw []byte) (*Record, error) {
	var r Record
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, ErrShape
	}
	if r.V != 1 || !ValidSiteID(r.Site) || !RecordKinds[r.Kind] || !recordIDRe.MatchString(r.ID) || r.Epoch < 1 || r.At <= 0 ||
		!(ValidUserID(r.Author) || ValidMonitorID(r.Author)) {
		return nil, ErrShape
	}
	iv, err := DecodeB64(r.IV)
	if err != nil || len(iv) != 12 {
		return nil, ErrShape
	}
	ct, err := DecodeB64(r.CT)
	if err != nil || len(ct) < 16 {
		return nil, ErrShape
	}
	if CTHash(iv, ct) != r.CTHash {
		return nil, ErrShape
	}
	if sig, err := DecodeB64(r.Sig); err != nil || len(sig) != 64 {
		return nil, ErrShape
	}
	return &r, nil
}

// Verify checks the record's signature with the author's U_sig (or a
// monitor's device key), b64url raw.
func (r *Record) Verify(sigPubB64 string) error {
	return VerifyB64(sigPubB64, []byte(r.SignedString()), r.Sig)
}
