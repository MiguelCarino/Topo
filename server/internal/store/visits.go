package store

import (
	"context"
	"database/sql"
	"errors"
)

// VisitCopy is one provider's visit waiting for an owner (migration 0004,
// docs/SCOPE.md D154). The server holds it sealed; it cannot read it.
type VisitCopy struct {
	ID        string
	SiteID    string
	Author    string
	Device    string
	Slot      string
	BaseN     int64
	Epoch     int64
	RSeq      int64
	At        int64
	Received  int64
	Replaced  int64
	Size      int64
	CTHash    string
	Sig       string
	IV        string
	CT        []byte // empty when listed
	State     string // waiting | approved | rejected
	DecidedAt int64
	DecidedBy string
	DecidedN  int64
}

const visitCols = "id, site_id, author, device, slot, base_n, epoch, rseq, at, received, replaced, size, ct_hash, sig, iv, state, coalesce(decided_at,0), coalesce(decided_by,''), coalesce(decided_n,0)"

func scanVisit(row interface{ Scan(...any) error }, withCT bool) (*VisitCopy, error) {
	v := &VisitCopy{}
	dst := []any{&v.ID, &v.SiteID, &v.Author, &v.Device, &v.Slot, &v.BaseN, &v.Epoch, &v.RSeq, &v.At, &v.Received, &v.Replaced, &v.Size,
		&v.CTHash, &v.Sig, &v.IV, &v.State, &v.DecidedAt, &v.DecidedBy, &v.DecidedN}
	if withCT {
		dst = append(dst, &v.CT)
	}
	err := row.Scan(dst...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

// PutVisit stores v, replacing the copy the same author has waiting for
// the same slot; v.Replaced is set to how many copies the new one replaced
// in all. A copy already decided stays until its author takes the answer
// and deletes it (D191): an owner reviewing the new copy still sees what
// was rejected, and the provider is still offered it as a file. -> the id
// of the copy replaced, or "".
func PutVisit(ctx context.Context, tx *sql.Tx, v *VisitCopy) (string, error) {
	var oldID string
	var oldReplaced int64
	err := tx.QueryRowContext(ctx, "SELECT id, replaced FROM visit_copies WHERE site_id = ? AND author = ? AND slot = ? AND state = 'waiting'", v.SiteID, v.Author, v.Slot).Scan(&oldID, &oldReplaced)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		v.Replaced = 0
	case err != nil:
		return "", err
	default:
		if _, err := tx.ExecContext(ctx, "DELETE FROM visit_copies WHERE id = ?", oldID); err != nil {
			return "", err
		}
		v.Replaced = oldReplaced + 1
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO visit_copies(id, site_id, author, device, slot, base_n, epoch, rseq, at, received, replaced, size, ct_hash, sig, iv, ct, state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'waiting')",
		v.ID, v.SiteID, v.Author, v.Device, v.Slot, v.BaseN, v.Epoch, v.RSeq, v.At, v.Received, v.Replaced, v.Size, v.CTHash, v.Sig, v.IV, v.CT)
	if err != nil {
		return "", err
	}
	v.State = "waiting"
	return oldID, nil
}

// DropUserVisits deletes every visit copy `user` has on `site` (removed,
// left, or no longer a provider: D191). -> nothing; the count is not used.
func DropUserVisits(ctx context.Context, q Q, site, user string) error {
	_, err := q.ExecContext(ctx, "DELETE FROM visit_copies WHERE site_id = ? AND author = ?", site, user)
	return err
}

// CountWaitingVisits counts a site's copies still waiting.
func CountWaitingVisits(ctx context.Context, q Q, site string) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM visit_copies WHERE site_id = ? AND state = 'waiting'", site).Scan(&n)
	return n, err
}

// SiteVisits lists a site's copies (author "" for every author), oldest
// first, without their ciphertext.
func SiteVisits(ctx context.Context, q Q, site, author string) ([]VisitCopy, error) {
	query := "SELECT " + visitCols + " FROM visit_copies WHERE site_id = ?"
	args := []any{site}
	if author != "" {
		query += " AND author = ?"
		args = append(args, author)
	}
	rows, err := q.QueryContext(ctx, query+" ORDER BY received, id", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VisitCopy
	for rows.Next() {
		v, err := scanVisit(rows, false)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// VisitByID loads one copy with its ciphertext.
func VisitByID(ctx context.Context, q Q, site, id string) (*VisitCopy, error) {
	return scanVisit(q.QueryRowContext(ctx, "SELECT "+visitCols+", ct FROM visit_copies WHERE site_id = ? AND id = ?", site, id), true)
}

// DecideVisit records an owner's answer on a waiting copy. ErrNotFound when
// there is no such copy waiting.
func DecideVisit(ctx context.Context, tx *sql.Tx, site, id, state, by string, n, at int64) error {
	res, err := tx.ExecContext(ctx, "UPDATE visit_copies SET state = ?, decided_at = ?, decided_by = ?, decided_n = ? WHERE site_id = ? AND id = ? AND state = 'waiting'",
		state, at, by, n, site, id)
	if err != nil {
		return err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteVisit removes one copy. ErrNotFound when there is none.
func DeleteVisit(ctx context.Context, q Q, site, id string) error {
	res, err := q.ExecContext(ctx, "DELETE FROM visit_copies WHERE site_id = ? AND id = ?", site, id)
	if err != nil {
		return err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return ErrNotFound
	}
	return nil
}

// visitBasesHeld is the revisions whose bodies a waiting copy is reviewed
// against: Prune never drops them (the owner's review is three-way).
func visitBasesHeld(ctx context.Context, tx *sql.Tx, site string) (map[int64]bool, error) {
	rows, err := tx.QueryContext(ctx, "SELECT DISTINCT base_n FROM visit_copies WHERE site_id = ? AND state = 'waiting'", site)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var n int64
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out[n] = true
	}
	return out, rows.Err()
}
