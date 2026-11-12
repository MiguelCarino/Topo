package backup

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"time"

	"carino.systems/topo/server/internal/store"
	"carino.systems/topo/server/internal/tcrypto"
)

// SchemaURL names the backup file format (schema/topo-backup-v1.json).
const SchemaURL = "https://topo.carino.systems/schema/topo-backup-v1.json"

// The backup file, topo-backup v1 (D100, A3 and amendments 1-3): the head
// revision exactly as stored (header, iv, ct) and what an owner needs to
// open it:
//   - rosters: the roster in force for the head (seq = rev.rseq) and the
//     newest roster, as stored (signed). Not every roster from seq 1: the
//     server keeps only current keys, so an older roster signed by someone
//     who reset keys since could never be checked (amendment 1);
//   - pubs: the current public keys of the people those rosters name, only
//     where the key still matches their line (a reset key is left out);
//   - owners: each owner granted now, with their site-key wrap for the
//     head's epoch and their locked recovery copy (escrow), or null.
//
// No email outside the rosters and no server address: originHash (SHA-256
// of the server's origin) is enough for a browser to know it is on the same
// server. The name in clear only when the owner shows it. JSON keys are
// sorted (encoding/json sorts map keys), and the SHA-256 of the exact
// bytes is recorded in the backups table.

// Snapshot is the parsed file (check.go reads one back).
type Snapshot struct {
	Kind       string            `json:"kind"`
	V          int               `json:"v"`
	Site       string            `json:"site"`
	Made       string            `json:"made"`
	OriginHash string            `json:"originHash"`
	Name       *string           `json:"name"`
	NameCt     json.RawMessage   `json:"nameCt"`
	Rev        SnapRev           `json:"rev"`
	Rosters    []json.RawMessage `json:"rosters"`
	Pubs       map[string]struct {
		EncPub string `json:"encPub"`
		SigPub string `json:"sigPub"`
	} `json:"pubs"`
	Owners []struct {
		U      string          `json:"u"`
		Wrap   json.RawMessage `json:"wrap"`
		Escrow json.RawMessage `json:"escrow"`
	} `json:"owners"`
	// Records not yet folded (step 7h), absent when there are none.
	Records []json.RawMessage `json:"records,omitempty"`
}

// SnapRev is the revision inside a backup.
type SnapRev struct {
	N      int64  `json:"n"`
	Base   int64  `json:"base"`
	Prev   string `json:"prev"`
	Epoch  int64  `json:"epoch"`
	RSeq   int64  `json:"rseq"`
	Author string `json:"author"`
	Dev    string `json:"dev"`
	At     int64  `json:"at"`
	CTHash string `json:"ctHash"`
	Sig    string `json:"sig"`
	H      string `json:"h"`
	IV     string `json:"iv"`
	CT     string `json:"ct"`
}

// OriginHash is b64url(SHA-256(origin)).
func OriginHash(origin string) string {
	s := sha256.Sum256([]byte(origin))
	return tcrypto.B64.EncodeToString(s[:])
}

// Built is a snapshot ready to write.
type Built struct {
	Body   []byte
	SHA256 string
	RevN   int64
	Slug   string // the name part (Stem input), "" when the name is not shown
}

// errNothing means the site has no revision yet (nothing to back up).
var errNothing = errors.New("no revision yet")

// BuildSnapshot reads one site in a short read transaction (the body comes
// from blobs right after) and makes its file. No transaction is held while
// a destination is written (amendment 8).
func BuildSnapshot(ctx context.Context, st *store.Store, blobs store.Blobs, site, origin string, now time.Time) (*Built, error) {
	tx, err := st.R.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	info, err := store.SiteForBackup(ctx, tx, site)
	if err != nil {
		return nil, err
	}
	if info.HeadN == 0 {
		return nil, errNothing
	}
	rev, err := store.RevByN(ctx, tx, site, info.HeadN)
	if err != nil {
		return nil, err
	}
	var rosters []string
	headRoster, err := store.RosterAt(ctx, tx, site, rev.RSeq)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	if headRoster != "" {
		rosters = append(rosters, headRoster)
	}
	latest, err := store.LatestRoster(ctx, tx, site)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	if latest != "" && latest != headRoster {
		rosters = append(rosters, latest)
	}
	// The people the rosters name, with the fingerprints of their lines.
	lines := map[string][][2]string{}
	var ids []string
	for _, raw := range rosters {
		r, err := tcrypto.ParseRoster([]byte(raw))
		if err != nil {
			continue
		}
		for _, m := range r.Members {
			if _, seen := lines[m.U]; !seen {
				ids = append(ids, m.U)
			}
			lines[m.U] = append(lines[m.U], [2]string{m.Enc, m.Sig})
		}
	}
	cur, err := store.UserPubs(ctx, tx, ids)
	if err != nil {
		return nil, err
	}
	pubs := map[string]any{}
	for _, u := range ids {
		k, ok := cur[u]
		if !ok {
			continue
		}
		fe, fs := tcrypto.FingerprintB64(k[0]), tcrypto.FingerprintB64(k[1])
		for _, l := range lines[u] {
			if l[0] == fe && l[1] == fs {
				pubs[u] = map[string]string{"encPub": k[0], "sigPub": k[1]}
				break
			}
		}
	}
	owners, err := store.SiteOwnerKeys(ctx, tx, site, rev.Epoch)
	if err != nil {
		return nil, err
	}
	// Records not yet folded into the document (issues, acts, quiet
	// windows; docs/SCOPE.md D159): beside it, so a restore loses no open
	// issue. Encrypted and signed as stored.
	unfolded, err := store.UnfoldedRecords(ctx, tx, site, 5000)
	if err != nil {
		return nil, err
	}
	tx.Rollback()

	iv, rc, _, err := blobs.Get(ctx, site, rev.N)
	if err != nil {
		return nil, err
	}
	ct, err := io.ReadAll(io.LimitReader(rc, MaxFile+1))
	rc.Close()
	if err != nil {
		return nil, err
	}
	if len(ct) > MaxFile {
		return nil, errf(CodeTooLarge, "%d bytes", len(ct))
	}

	ownerList := []any{}
	for _, o := range owners {
		if o.Wrap == "" {
			continue // no key for the head's epoch: this owner cannot open it
		}
		var escrow any
		if o.Escrow != "" {
			escrow = json.RawMessage(o.Escrow)
		}
		ownerList = append(ownerList, map[string]any{"u": o.UserID, "wrap": json.RawMessage(o.Wrap), "escrow": escrow})
	}
	rosterList := []any{}
	for _, r := range rosters {
		rosterList = append(rosterList, json.RawMessage(r))
	}
	var name, nameCt any
	slug := ""
	if info.ShowName && info.NameClear != "" {
		name = info.NameClear
		slug = info.NameSlug
	}
	if info.NameCt != "" {
		nameCt = json.RawMessage(info.NameCt)
	}
	doc := map[string]any{
		"$schema":    SchemaURL,
		"kind":       "topo-backup",
		"v":          1,
		"site":       site,
		"made":       now.UTC().Format("2006-01-02T15:04:05.000Z"),
		"originHash": OriginHash(origin),
		"name":       name,
		"nameCt":     nameCt,
		"rev": map[string]any{
			"n": rev.N, "base": rev.Base, "prev": rev.Prev, "epoch": rev.Epoch, "rseq": rev.RSeq, "author": rev.Author,
			"dev": rev.Device, "at": rev.At, "ctHash": rev.CTHash, "sig": rev.Sig, "h": rev.H,
			"iv": iv, "ct": tcrypto.B64.EncodeToString(ct),
		},
		"rosters": rosterList,
		"pubs":    pubs,
		"owners":  ownerList,
	}
	if len(unfolded) > 0 {
		recs := make([]any, 0, len(unfolded))
		for _, r := range unfolded {
			recs = append(recs, json.RawMessage(r))
		}
		doc["records"] = recs
	}
	body, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	body = append(body, '\n')
	if len(body) > MaxFile {
		return nil, errf(CodeTooLarge, "%d bytes", len(body))
	}
	sum := sha256.Sum256(body)
	return &Built{Body: body, SHA256: hex.EncodeToString(sum[:]), RevN: rev.N, Slug: slug}, nil
}

// VerifySnapshot checks a backup file read back (the weekly check, D104):
// it parses, ctHash = SHA-256(iv || ct), and the revision signature holds
// under the author's key when the file carries it (a key reset since is
// not a failure, amendment 1). The server cannot decrypt, so this is as far
// as it can see; "Open the latest backup here" in the app does the rest.
func VerifySnapshot(body []byte, wantSite string, wantN int64) error {
	var s Snapshot
	if err := json.Unmarshal(body, &s); err != nil {
		return errf(CodeDamaged, "not JSON")
	}
	if s.Kind != "topo-backup" || s.V != 1 || s.Site != wantSite || s.Rev.N != wantN {
		return errf(CodeDamaged, "not this network's backup")
	}
	iv, err1 := tcrypto.DecodeB64(s.Rev.IV)
	ct, err2 := tcrypto.DecodeB64(s.Rev.CT)
	if err1 != nil || err2 != nil || tcrypto.CTHash(iv, ct) != s.Rev.CTHash {
		return errf(CodeDamaged, "the ciphertext hash does not match")
	}
	hdr := &tcrypto.RevHeader{Site: s.Site, N: s.Rev.N, Base: s.Rev.Base, Prev: s.Rev.Prev, Epoch: s.Rev.Epoch, RSeq: s.Rev.RSeq,
		Author: s.Rev.Author, Dev: s.Rev.Dev, At: s.Rev.At, CTHash: s.Rev.CTHash}
	signed := hdr.SignedString()
	if tcrypto.ChainHash(signed, s.Rev.Sig) != s.Rev.H {
		return errf(CodeDamaged, "the chain hash does not match")
	}
	// The author's key counts only when it is the one on the author's line
	// of the roster in force for the head (after a reset and a new grant it
	// matches a newer roster but did not sign this revision).
	if p, ok := s.Pubs[s.Rev.Author]; ok && p.SigPub != "" && authorLineMatches(s, p.SigPub) {
		if tcrypto.VerifyB64(p.SigPub, []byte(signed), s.Rev.Sig) != nil {
			return errf(CodeDamaged, "the signature does not verify")
		}
	}
	return nil
}

func authorLineMatches(s Snapshot, sigPub string) bool {
	fp := tcrypto.FingerprintB64(sigPub)
	for _, raw := range s.Rosters {
		r, err := tcrypto.ParseRoster(raw)
		if err != nil || r.Seq != s.Rev.RSeq {
			continue
		}
		m := r.Member(s.Rev.Author)
		return m != nil && m.Sig == fp
	}
	return false
}
