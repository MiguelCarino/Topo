package store

import (
	"context"
	"database/sql"
	"errors"
)

// BackupConfig is the one backup destination (D99). Fields is JSON of the
// non-secret fields; SecretCt the sealed secrets (internal/backup).
type BackupConfig struct {
	Enabled         bool
	Kind            string
	Fields          string
	SecretCt        string
	ConfigID        string
	DailyAt         string
	ReadableAllowed bool
	OAuthRef        string
	// MarkerOwed: a folder destination saved with "Save anyway" (the disk
	// not plugged in yet) has no .topo-backups marker; runs refuse it until
	// a save finds the folder and writes the marker (amendment 13).
	MarkerOwed bool
	Updated    int64
	UpdatedBy  string
}

// GetBackupConfig reads the destination row.
func GetBackupConfig(ctx context.Context, q Q) (*BackupConfig, error) {
	c := &BackupConfig{}
	err := q.QueryRowContext(ctx, `SELECT enabled, kind, fields, coalesce(secret_ct,''), config_id, daily_at, readable_allowed,
		coalesce(oauth_ref,''), marker_owed, updated, coalesce(updated_by,'') FROM backup_config WHERE id = 1`).
		Scan(&c.Enabled, &c.Kind, &c.Fields, &c.SecretCt, &c.ConfigID, &c.DailyAt, &c.ReadableAllowed, &c.OAuthRef, &c.MarkerOwed, &c.Updated, &c.UpdatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// SetBackupConfig replaces the destination row.
func SetBackupConfig(ctx context.Context, q Q, c *BackupConfig) error {
	_, err := q.ExecContext(ctx, `UPDATE backup_config SET enabled = ?, kind = ?, fields = ?, secret_ct = ?, config_id = ?, daily_at = ?,
		readable_allowed = ?, oauth_ref = ?, marker_owed = ?, updated = ?, updated_by = ? WHERE id = 1`,
		c.Enabled, c.Kind, c.Fields, nullable(c.SecretCt), c.ConfigID, c.DailyAt, c.ReadableAllowed, nullable(c.OAuthRef), c.MarkerOwed, c.Updated, nullable(c.UpdatedBy))
	return err
}

// UpdateBackupSecrets stores sealed secrets and oauth_ref for the
// destination configID, only while it is still the saved one (a rotated
// refresh token, a Drive folder id; 5c). It reports nothing when the
// destination changed meanwhile.
func UpdateBackupSecrets(ctx context.Context, q Q, configID, secretCt, oauthRef string) error {
	_, err := q.ExecContext(ctx, `UPDATE backup_config SET secret_ct = ?, oauth_ref = ? WHERE id = 1 AND config_id = ?`,
		nullable(secretCt), nullable(oauthRef), configID)
	return err
}

// OAuthState is a Connect in progress (5c, D110): single use, 10 minutes,
// bound to the session that started it, the provider, the app's client id
// and the redirect address (amendment 20).
type OAuthState struct {
	State        string // SHA-256 hex of the state sent to the provider
	Provider     string
	SessHash     string
	Verifier     string
	ClientIDHash string
	RedirectURI  string
	PendingCt    string // the settings typed before Connect, sealed
	Created      int64
}

// InsertOAuthState stores a Connect in progress.
func InsertOAuthState(ctx context.Context, q Q, s *OAuthState) error {
	_, err := q.ExecContext(ctx, `INSERT INTO oauth_states(state, provider, sess_hash, verifier, client_id_hash, redirect_uri, pending_ct, created)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, s.State, s.Provider, s.SessHash, s.Verifier, s.ClientIDHash, s.RedirectURI, s.PendingCt, s.Created)
	return err
}

// TakeOAuthState reads and deletes a Connect in progress (single use).
func TakeOAuthState(ctx context.Context, q Q, state string) (*OAuthState, error) {
	s := &OAuthState{}
	err := q.QueryRowContext(ctx, `DELETE FROM oauth_states WHERE state = ? RETURNING state, provider, sess_hash, verifier, client_id_hash,
		redirect_uri, coalesce(pending_ct,''), created`, state).
		Scan(&s.State, &s.Provider, &s.SessHash, &s.Verifier, &s.ClientIDHash, &s.RedirectURI, &s.PendingCt, &s.Created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// BackupState is what the engine last did (the status in settings).
type BackupState struct {
	LastOK         int64
	LastErrAt      int64
	LastErr        string
	LastDailyDate  string
	LastCheckAt    int64
	LastCheckOK    bool
	LastCheckErr   string
	MailedFailDay  string
	MailedCheckDay string
	BackoffStep    int
	BackoffUntil   int64
	DropNote       string
	RunOwner       string
	RunUntil       int64
}

// GetBackupState reads the state row.
func GetBackupState(ctx context.Context, q Q) (*BackupState, error) {
	s := &BackupState{}
	err := q.QueryRowContext(ctx, `SELECT coalesce(last_ok,0), coalesce(last_err_at,0), coalesce(last_err,''), coalesce(last_daily_date,''),
		coalesce(last_check_at,0), coalesce(last_check_ok,0), coalesce(last_check_err,''), coalesce(mailed_fail_day,''), coalesce(mailed_check_day,''),
		backoff_step, backoff_until, coalesce(drop_note,''), coalesce(run_owner,''), run_until FROM backup_state WHERE id = 1`).
		Scan(&s.LastOK, &s.LastErrAt, &s.LastErr, &s.LastDailyDate, &s.LastCheckAt, &s.LastCheckOK, &s.LastCheckErr,
			&s.MailedFailDay, &s.MailedCheckDay, &s.BackoffStep, &s.BackoffUntil, &s.DropNote, &s.RunOwner, &s.RunUntil)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// SetBackupState writes the state row (the lease columns are left alone:
// AcquireBackupLease and ReleaseBackupLease own them).
func SetBackupState(ctx context.Context, q Q, s *BackupState) error {
	_, err := q.ExecContext(ctx, `UPDATE backup_state SET last_ok = ?, last_err_at = ?, last_err = ?, last_daily_date = ?, last_check_at = ?,
		last_check_ok = ?, last_check_err = ?, mailed_fail_day = ?, mailed_check_day = ?, backoff_step = ?, backoff_until = ?, drop_note = ? WHERE id = 1`,
		nullInt(s.LastOK), nullInt(s.LastErrAt), nullable(s.LastErr), nullable(s.LastDailyDate), nullInt(s.LastCheckAt),
		s.LastCheckOK, nullable(s.LastCheckErr), nullable(s.MailedFailDay), nullable(s.MailedCheckDay), s.BackoffStep, s.BackoffUntil, nullable(s.DropNote))
	return err
}

func nullInt(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}

// AcquireBackupLease takes or renews the engine lease for owner until
// until. It fails (false) while someone else holds an unexpired lease.
func AcquireBackupLease(ctx context.Context, q Q, owner string, now, until int64) (bool, error) {
	res, err := q.ExecContext(ctx, "UPDATE backup_state SET run_owner = ?, run_until = ? WHERE id = 1 AND (run_owner = ? OR run_owner IS NULL OR run_until < ?)",
		owner, until, owner, now)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// ReleaseBackupLease gives the lease up (only when owner holds it).
func ReleaseBackupLease(ctx context.Context, q Q, owner string) error {
	_, err := q.ExecContext(ctx, "UPDATE backup_state SET run_owner = NULL, run_until = 0 WHERE id = 1 AND run_owner = ?", owner)
	return err
}

// Backup is one file Topo wrote to a destination.
type Backup struct {
	ID          string
	SiteID      string
	ConfigID    string
	Kind        string // enc | readable
	Name        string
	Ref         string
	RevN        int64
	At          int64
	Size        int64
	SHA256      string
	CheckedAt   int64
	Missing     bool
	DropPending bool
}

const backupCols = "id, site_id, config_id, kind, name, coalesce(ref,''), rev_n, at, size, sha256, coalesce(checked_at,0), missing, drop_pending"

func scanBackups(rows *sql.Rows, err error) ([]Backup, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Backup
	for rows.Next() {
		var b Backup
		if err := rows.Scan(&b.ID, &b.SiteID, &b.ConfigID, &b.Kind, &b.Name, &b.Ref, &b.RevN, &b.At, &b.Size, &b.SHA256, &b.CheckedAt, &b.Missing, &b.DropPending); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// InsertBackup records a written file.
func InsertBackup(ctx context.Context, q Q, b *Backup) error {
	_, err := q.ExecContext(ctx, "INSERT INTO backups(id, site_id, config_id, kind, name, ref, rev_n, at, size, sha256, checked_at, missing, drop_pending) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
		b.ID, b.SiteID, b.ConfigID, b.Kind, b.Name, nullable(b.Ref), b.RevN, b.At, b.Size, b.SHA256, nullInt(b.CheckedAt), b.Missing, b.DropPending)
	return err
}

// BackupByID loads one row.
func BackupByID(ctx context.Context, q Q, id string) (*Backup, error) {
	bs, err := scanBackups(q.QueryContext(ctx, "SELECT "+backupCols+" FROM backups WHERE id = ?", id))
	if err != nil {
		return nil, err
	}
	if len(bs) == 0 {
		return nil, ErrNotFound
	}
	return &bs[0], nil
}

// SiteBackups lists a site's rows, newest first. kind and configID may be
// "" (any).
func SiteBackups(ctx context.Context, q Q, site, kind, configID string) ([]Backup, error) {
	return scanBackups(q.QueryContext(ctx, "SELECT "+backupCols+" FROM backups WHERE site_id = ? AND (? = '' OR kind = ?) AND (? = '' OR config_id = ?) ORDER BY at DESC, id",
		site, kind, kind, configID, configID))
}

// DeleteBackupRow forgets a file (after it was deleted at the destination).
func DeleteBackupRow(ctx context.Context, q Q, id string) error {
	_, err := q.ExecContext(ctx, "DELETE FROM backups WHERE id = ?", id)
	return err
}

// SetBackupFlags sets the missing and drop_pending marks of a row.
func SetBackupFlags(ctx context.Context, q Q, id string, missing, dropPending bool) error {
	_, err := q.ExecContext(ctx, "UPDATE backups SET missing = ?, drop_pending = ? WHERE id = ?", missing, dropPending, id)
	return err
}

// SetBackupChecked records a successful read-back.
func SetBackupChecked(ctx context.Context, q Q, id string, at int64) error {
	_, err := q.ExecContext(ctx, "UPDATE backups SET checked_at = ?, missing = 0 WHERE id = ?", at, id)
	return err
}

// ChangedSites lists the sites whose head is newer than their newest
// encrypted backup on configID (every site with a head when configID has
// none), oldest change first.
func ChangedSites(ctx context.Context, q Q, configID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT s.id FROM sites s WHERE s.head_n > 0 AND s.head_n > coalesce(
		(SELECT max(b.rev_n) FROM backups b WHERE b.site_id = s.id AND b.kind = 'enc' AND b.config_id = ? AND b.missing = 0), 0) ORDER BY s.updated, s.id`, configID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// BackupSummary is one site's line in the server owner's sheet.
type BackupSummary struct {
	SiteID  string
	Name    string // only when the owner shows it in clear
	Count   int
	Last    int64
	Missing int
	Deleted bool // the network itself is gone
}

// BackupSummaries counts each site's files on configID ("" = any).
func BackupSummaries(ctx context.Context, q Q, configID string) ([]BackupSummary, error) {
	rows, err := q.QueryContext(ctx, `SELECT b.site_id, coalesce(CASE WHEN s.show_name = 1 THEN s.name_clear END, ''), count(*), max(b.at),
		coalesce(sum(b.missing),0), s.id IS NULL FROM backups b LEFT JOIN sites s ON s.id = b.site_id
		WHERE (? = '' OR b.config_id = ?) GROUP BY b.site_id ORDER BY max(b.at) DESC`, configID, configID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BackupSummary
	for rows.Next() {
		var s BackupSummary
		if err := rows.Scan(&s.SiteID, &s.Name, &s.Count, &s.Last, &s.Missing, &s.Deleted); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// CountOtherConfigBackups is the number of rows written to an earlier
// destination.
func CountOtherConfigBackups(ctx context.Context, q Q, configID string) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM backups WHERE config_id <> ?", configID).Scan(&n)
	return n, err
}

// SiteBackupInfo is what the backup engine reads of a site.
type SiteBackupInfo struct {
	ID        string
	HeadN     int64
	ShowName  bool
	NameClear string
	NameSlug  string
	NameCt    string
	Readable  bool
}

// SiteForBackup loads the backup view of a site.
func SiteForBackup(ctx context.Context, q Q, id string) (*SiteBackupInfo, error) {
	s := &SiteBackupInfo{}
	err := q.QueryRowContext(ctx, "SELECT id, head_n, show_name, coalesce(name_clear,''), coalesce(name_slug,''), coalesce(name_ct,''), backup_readable FROM sites WHERE id = ?", id).
		Scan(&s.ID, &s.HeadN, &s.ShowName, &s.NameClear, &s.NameSlug, &s.NameCt, &s.Readable)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// SetSiteBackupReadable sets the network's readable-copy opt-in.
func SetSiteBackupReadable(ctx context.Context, q Q, id string, on bool) error {
	_, err := q.ExecContext(ctx, "UPDATE sites SET backup_readable = ? WHERE id = ?", on, id)
	return err
}

// SetSiteNameSlug stores the file-name form of the clear name ("" clears).
func SetSiteNameSlug(ctx context.Context, q Q, id, slug string) error {
	_, err := q.ExecContext(ctx, "UPDATE sites SET name_slug = ? WHERE id = ?", nullable(slug), id)
	return err
}

// RosterAt returns the roster blob with seq, or ErrNotFound.
func RosterAt(ctx context.Context, q Q, site string, seq int64) (string, error) {
	var r string
	err := q.QueryRowContext(ctx, "SELECT roster FROM site_rosters WHERE site_id = ? AND seq = ?", site, seq).Scan(&r)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return r, err
}

// LatestRoster returns the newest roster blob of a site.
func LatestRoster(ctx context.Context, q Q, site string) (string, error) {
	var r string
	err := q.QueryRowContext(ctx, "SELECT roster FROM site_rosters WHERE site_id = ? ORDER BY seq DESC LIMIT 1", site).Scan(&r)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return r, err
}

// OwnerKey is a granted owner's keys, escrow and wrap for one epoch.
type OwnerKey struct {
	UserID string
	EncPub string
	SigPub string
	Escrow string // JSON or ""
	Wrap   string // JSON or "" (none for that epoch)
}

// SiteOwnerKeys lists the granted owners of a site with their wrap for
// epoch.
func SiteOwnerKeys(ctx context.Context, q Q, site string, epoch int64) ([]OwnerKey, error) {
	rows, err := q.QueryContext(ctx, `SELECT u.id, coalesce(u.enc_pub,''), coalesce(u.sig_pub,''), coalesce(u.escrow,''), coalesce(w.wrap,'')
		FROM members m JOIN users u ON u.id = m.user_id
		LEFT JOIN site_wraps w ON w.site_id = m.site_id AND w.user_id = m.user_id AND w.epoch = ?
		WHERE m.site_id = ? AND m.role = 'owner' AND m.status = 'granted' ORDER BY u.id`, epoch, site)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OwnerKey
	for rows.Next() {
		var o OwnerKey
		if err := rows.Scan(&o.UserID, &o.EncPub, &o.SigPub, &o.Escrow, &o.Wrap); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// UserPubs returns the current public keys of the users (missing users are
// left out).
func UserPubs(ctx context.Context, q Q, ids []string) (map[string][2]string, error) {
	out := map[string][2]string{}
	for _, id := range ids {
		var enc, sig string
		err := q.QueryRowContext(ctx, "SELECT coalesce(enc_pub,''), coalesce(sig_pub,'') FROM users WHERE id = ?", id).Scan(&enc, &sig)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if enc != "" && sig != "" {
			out[id] = [2]string{enc, sig}
		}
	}
	return out, nil
}

// OwnedSites lists the sites where user is a granted owner.
func OwnedSites(ctx context.Context, q Q, user string) ([]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT site_id FROM members WHERE user_id = ? AND role = 'owner'", user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ServerOwners lists the enabled server owners' addresses and languages.
func ServerOwners(ctx context.Context, q Q) ([][3]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, email_norm, lang FROM users WHERE server_role = 'owner' AND disabled = 0 ORDER BY created")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][3]string
	for rows.Next() {
		var r [3]string
		if err := rows.Scan(&r[0], &r[1], &r[2]); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
