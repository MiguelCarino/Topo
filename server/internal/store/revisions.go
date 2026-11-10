package store

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
)

// Rev is one revision header (the body lives in Blobs, amendment D3).
type Rev struct {
	SiteID   string
	N        int64
	Base     int64
	Prev     string
	Epoch    int64
	RSeq     int64
	Author   string
	Device   string
	At       int64
	Received int64
	Size     int64
	CTHash   string
	Sig      string
	H        string
	Pruned   bool
}

const revCols = "site_id, n, base, prev, epoch, rseq, author, device, at, received, size, ct_hash, sig, h, pruned"

func scanRev(row interface{ Scan(...any) error }) (*Rev, error) {
	r := &Rev{}
	err := row.Scan(&r.SiteID, &r.N, &r.Base, &r.Prev, &r.Epoch, &r.RSeq, &r.Author, &r.Device, &r.At, &r.Received, &r.Size, &r.CTHash, &r.Sig, &r.H, &r.Pruned)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return r, err
}

// InsertRev stores a header and moves the site's head to it.
func InsertRev(ctx context.Context, q Q, r *Rev) error {
	if _, err := q.ExecContext(ctx, "INSERT INTO revisions("+revCols+") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
		r.SiteID, r.N, r.Base, r.Prev, r.Epoch, r.RSeq, r.Author, r.Device, r.At, r.Received, r.Size, r.CTHash, r.Sig, r.H); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, "UPDATE sites SET head_n = ?, head_h = ?, updated = ?, bytes = bytes + ? WHERE id = ?", r.N, r.H, r.Received, r.Size, r.SiteID)
	return err
}

// RevsSince lists up to limit headers with n > since, ascending.
func RevsSince(ctx context.Context, q Q, site string, since int64, limit int) ([]Rev, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+revCols+" FROM revisions WHERE site_id = ? AND n > ? ORDER BY n LIMIT ?", site, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Rev
	for rows.Next() {
		r, err := scanRev(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// RevByN loads one header.
func RevByN(ctx context.Context, q Q, site string, n int64) (*Rev, error) {
	return scanRev(q.QueryRowContext(ctx, "SELECT "+revCols+" FROM revisions WHERE site_id = ? AND n = ?", site, n))
}

// Prune drops the oldest stored bodies of a site, never the head's, until
// at most keep bodies remain (keep 0 = no count limit) and the stored bytes
// plus incoming fit in maxBytes (0 = no byte limit). It reports whether the
// byte limit is met afterwards.
func Prune(ctx context.Context, tx *sql.Tx, b Blobs, site string, head int64, keep int, maxBytes, incoming int64) (bool, error) {
	var count int
	var stored int64
	if err := tx.QueryRowContext(ctx, "SELECT count(*), coalesce(sum(size),0) FROM revisions WHERE site_id = ? AND pruned = 0", site).Scan(&count, &stored); err != nil {
		return false, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT n, size FROM revisions WHERE site_id = ? AND pruned = 0 AND n <> ? ORDER BY n", site, head)
	if err != nil {
		return false, err
	}
	type ns struct{ n, size int64 }
	var cands []ns
	for rows.Next() {
		var c ns
		if err := rows.Scan(&c.n, &c.size); err != nil {
			rows.Close()
			return false, err
		}
		cands = append(cands, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return false, err
	}
	var drop []int64
	var freed int64
	for _, c := range cands {
		overCount := keep > 0 && count-len(drop) > keep
		overBytes := maxBytes > 0 && stored-freed+incoming > maxBytes
		if !overCount && !overBytes {
			break
		}
		drop = append(drop, c.n)
		freed += c.size
	}
	if len(drop) > 0 {
		if err := b.Drop(ctx, tx, site, drop); err != nil {
			return false, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE sites SET bytes = bytes - ? WHERE id = ?", freed, site); err != nil {
			return false, err
		}
	}
	return maxBytes == 0 || stored-freed+incoming <= maxBytes, nil
}

// DBBlobs keeps revision bodies in the rev_bodies table (5a). 5b/5c add
// other stores behind the Blobs interface.
type DBBlobs struct{ R *sql.DB }

// Put stores a body inside the push transaction.
func (DBBlobs) Put(ctx context.Context, tx *sql.Tx, site string, n int64, iv string, ct []byte) error {
	_, err := tx.ExecContext(ctx, "INSERT INTO rev_bodies(site_id, n, iv, ct) VALUES(?,?,?,?)", site, n, iv, ct)
	return err
}

// Get reads a body; ErrNotFound when missing (never stored or pruned).
func (b DBBlobs) Get(ctx context.Context, site string, n int64) (string, io.ReadCloser, int64, error) {
	var iv string
	var ct []byte
	err := b.R.QueryRowContext(ctx, "SELECT iv, ct FROM rev_bodies WHERE site_id = ? AND n = ?", site, n).Scan(&iv, &ct)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, 0, ErrNotFound
	}
	if err != nil {
		return "", nil, 0, err
	}
	return iv, io.NopCloser(bytes.NewReader(ct)), int64(len(ct)), nil
}

// Drop removes bodies and marks their headers pruned.
func (DBBlobs) Drop(ctx context.Context, tx *sql.Tx, site string, ns []int64) error {
	for _, n := range ns {
		if _, err := tx.ExecContext(ctx, "DELETE FROM rev_bodies WHERE site_id = ? AND n = ?", site, n); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE revisions SET pruned = 1 WHERE site_id = ? AND n = ?", site, n); err != nil {
			return err
		}
	}
	return nil
}

// DropSite removes every body of a site.
func (DBBlobs) DropSite(ctx context.Context, tx *sql.Tx, site string) error {
	_, err := tx.ExecContext(ctx, "DELETE FROM rev_bodies WHERE site_id = ?", site)
	return err
}
