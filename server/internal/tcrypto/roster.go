package tcrypto

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

// RosterMember is one line of a roster.
type RosterMember struct {
	U     string `json:"u"`
	Email string `json:"email"`
	Role  string `json:"role"`
	Enc   string `json:"enc"` // fingerprint of the member's U_enc
	Sig   string `json:"sig"` // fingerprint of the member's U_sig
}

// Roster is a site's signed member list (design §5.6). The server keeps it
// as an opaque blob after these checks; browsers walk and pin the chain.
type Roster struct {
	V       int            `json:"v"`
	Site    string         `json:"site"`
	Seq     int64          `json:"seq"`
	Epoch   int64          `json:"epoch"`
	By      string         `json:"by"`
	At      int64          `json:"at"`
	Members []RosterMember `json:"members"`
	Sig     string         `json:"sig"`
}

// MaxRosterMembers bounds a roster (and so a site's granted members).
const MaxRosterMembers = 200

var (
	userIDRe = regexp.MustCompile(`^u_[A-Za-z0-9_-]{22}$`)
	siteIDRe = regexp.MustCompile(`^s_[A-Za-z0-9_-]{22}$`)
)

// ValidUserID and ValidSiteID check the id shapes (prefix + 16 random bytes
// in base64url).
func ValidUserID(s string) bool { return userIDRe.MatchString(s) }
func ValidSiteID(s string) bool { return siteIDRe.MatchString(s) }

// ValidRole is owner, provider or viewer.
func ValidRole(r string) bool { return r == "owner" || r == "provider" || r == "viewer" }

// ParseRoster decodes and shape-checks a roster. It does not verify the
// signature (Verify does, with the signer's key).
func ParseRoster(raw []byte) (*Roster, error) {
	var r Roster
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, ErrShape
	}
	if r.V != 1 || !ValidSiteID(r.Site) || r.Seq < 1 || r.Epoch < 1 || !ValidUserID(r.By) || r.At <= 0 ||
		len(r.Members) == 0 || len(r.Members) > MaxRosterMembers {
		return nil, ErrShape
	}
	if sig, err := DecodeB64(r.Sig); err != nil || len(sig) != 64 {
		return nil, ErrShape
	}
	seen := map[string]bool{}
	for _, m := range r.Members {
		if !ValidUserID(m.U) || seen[m.U] || !ValidRole(m.Role) || !ValidFingerprint(m.Enc) || !ValidFingerprint(m.Sig) ||
			m.Email == "" || len(m.Email) > 254 || m.Email != strings.ToLower(m.Email) || strings.ContainsAny(m.Email, "|\n\r") {
			return nil, ErrShape
		}
		seen[m.U] = true
	}
	return &r, nil
}

// Canonical is the signed text: ["topo-roster-v1", site, seq, epoch, by,
// at, ...members sorted by u as u|email|role|enc|sig] joined by "\n".
func (r *Roster) Canonical() string {
	ms := append([]RosterMember(nil), r.Members...)
	sort.Slice(ms, func(i, j int) bool { return ms[i].U < ms[j].U })
	lines := []string{"topo-roster-v1", r.Site, i64(r.Seq), i64(r.Epoch), r.By, i64(r.At)}
	for _, m := range ms {
		lines = append(lines, m.U+"|"+m.Email+"|"+m.Role+"|"+m.Enc+"|"+m.Sig)
	}
	return strings.Join(lines, "\n")
}

// Verify checks the roster's signature against the signer's U_sig.
func (r *Roster) Verify(sigPubB64 string) error {
	return VerifyB64(sigPubB64, []byte(r.Canonical()), r.Sig)
}

// Member returns the line for user u, or nil.
func (r *Roster) Member(u string) *RosterMember {
	for i := range r.Members {
		if r.Members[i].U == u {
			return &r.Members[i]
		}
	}
	return nil
}
