package store

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"testing"
)

// Prune drops the oldest bodies, never the head's, keeps every header, and
// keeps sites.bytes equal to what is stored.
func TestPruneKeepsHeadAndHeaders(t *testing.T) {
	s := open(t, t.TempDir())
	defer s.Close()
	ctx := context.Background()
	b := DBBlobs{R: s.R}
	site := "s_aaaaaaaaaaaaaaaaaaaaaa"
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec("INSERT INTO users(id, email, email_norm, created) VALUES('u_1','a@x','a@x',1)"); err != nil {
			return err
		}
		if err := InsertSite(ctx, tx, &Site{ID: site, Created: 1, CreatedBy: "u_1", Epoch: 1, HeadH: "g", RosterSeq: 1, Updated: 1}); err != nil {
			return err
		}
		for n := int64(1); n <= 6; n++ {
			if err := InsertRev(ctx, tx, &Rev{SiteID: site, N: n, Base: n - 1, Prev: "p", Epoch: 1, RSeq: 1, Author: "u_1", Device: "d", At: n, Received: n, Size: 100, CTHash: "c", Sig: "s", H: "h"}); err != nil {
				return err
			}
			if err := b.Put(ctx, tx, site, n, "iv", make([]byte, 100)); err != nil {
				return err
			}
		}
		// Count limit 2.
		if _, err := Prune(ctx, tx, b, site, 6, 2, 0, 0); err != nil {
			return err
		}
		// A byte limit that even the head alone cannot meet with 500 more.
		fits, err := Prune(ctx, tx, b, site, 6, 0, 550, 500)
		if err != nil {
			return err
		}
		if fits {
			t.Error("fits with head 100 + 500 > 550")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var bodies, headers, pruned int
	var bytes int64
	s.R.QueryRow("SELECT count(*) FROM rev_bodies").Scan(&bodies)
	s.R.QueryRow("SELECT count(*), sum(pruned) FROM revisions").Scan(&headers, &pruned)
	s.R.QueryRow("SELECT bytes FROM sites").Scan(&bytes)
	if bodies != 1 || headers != 6 || pruned != 5 || bytes != 100 {
		t.Fatalf("bodies %d headers %d pruned %d bytes %d", bodies, headers, pruned, bytes)
	}
	iv, rc, size, err := b.Get(ctx, site, 6)
	if err != nil || iv != "iv" || size != 100 {
		t.Fatalf("head body: %v", err)
	}
	ct, _ := io.ReadAll(rc)
	if len(ct) != 100 {
		t.Fatal("head body bytes")
	}
	if _, _, _, err := b.Get(ctx, site, 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("pruned body: %v", err)
	}
	// Deleting the site removes headers and bodies.
	if err := s.Tx(ctx, func(tx *sql.Tx) error { return DeleteSite(ctx, tx, site) }); err != nil {
		t.Fatal(err)
	}
	s.R.QueryRow("SELECT count(*) FROM rev_bodies").Scan(&bodies)
	s.R.QueryRow("SELECT count(*) FROM revisions").Scan(&headers)
	if bodies+headers != 0 {
		t.Fatal("site delete left revisions")
	}
}
