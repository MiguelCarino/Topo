package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"

	"carino.systems/topo/server/internal/store"
)

// The weekly check (D104, A7): for each network, the newest encrypted
// backup on this destination is read back; its SHA-256 must be the one
// recorded, its ciphertext hash and revision signature must hold, and its
// revision number must be the row's. Then a probe file is written, read
// and deleted. The server cannot decrypt, so the owner's "Open the latest
// backup here" in the app is the full test.

func sha256hex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// CheckNow runs the check at once (the "Check now" button, backup-now
// --check). The caller holds the lease.
func (e *Engine) CheckNow(ctx context.Context) error {
	e.runMu.Lock()
	defer e.runMu.Unlock()
	cfg, err := store.GetBackupConfig(ctx, e.o.Store.R)
	if err != nil {
		return err
	}
	if !cfg.Enabled || cfg.Kind == "" {
		return nil
	}
	d, err := e.open(cfg, true)
	if err != nil {
		return e.failed(ctx, "backup-check-failed", CodeOf(err), err)
	}
	return e.check(ctx, d, cfg)
}

func (e *Engine) check(ctx context.Context, d Dest, cfg *store.BackupConfig) error {
	sums, err := store.BackupSummaries(ctx, e.o.Store.R, cfg.ConfigID)
	if err != nil {
		return err
	}
	now := e.o.Now()
	for _, s := range sums {
		rows, err := store.SiteBackups(ctx, e.o.Store.R, s.SiteID, "enc", cfg.ConfigID)
		if err != nil {
			return err
		}
		var newest *store.Backup
		for i := range rows {
			if !rows[i].Missing {
				newest = &rows[i]
				break
			}
		}
		if newest == nil {
			continue
		}
		gctx, cancel := context.WithTimeout(ctx, OpTimeout)
		body, err := ReadFile(gctx, d, FilePath(newest), newest.Ref)
		cancel()
		if err != nil {
			if CodeOf(err) == CodeNotFound {
				store.SetBackupFlags(ctx, e.o.Store.W, newest.ID, true, newest.DropPending)
			}
			return e.failed(ctx, "backup-check-failed", CodeOf(err), err)
		}
		if sha256hex(body) != newest.SHA256 {
			return e.failed(ctx, "backup-check-failed", CodeMismatch, errf(CodeMismatch, "the file read back is not the one written"))
		}
		if err := VerifySnapshot(body, newest.SiteID, newest.RevN); err != nil {
			return e.failed(ctx, "backup-check-failed", CodeOf(err), err)
		}
		if err := store.SetBackupChecked(ctx, e.o.Store.W, newest.ID, now.UnixMilli()); err != nil {
			return err
		}
	}
	pctx, cancel := context.WithTimeout(ctx, OpTimeout)
	err = d.Check(pctx)
	cancel()
	if err != nil {
		return e.failed(ctx, "backup-check-failed", CodeOf(err), err)
	}
	st, err := store.GetBackupState(ctx, e.o.Store.R)
	if err != nil {
		return err
	}
	st.LastCheckAt, st.LastCheckOK, st.LastCheckErr = now.UnixMilli(), true, ""
	return store.SetBackupState(ctx, e.o.Store.W, st)
}
