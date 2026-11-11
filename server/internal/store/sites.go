package store

import (
	"context"
	"database/sql"
	"errors"
)

// Site is one Topo network on the server (a document's encrypted history).
type Site struct {
	ID        string
	Created   int64
	CreatedBy string
	Epoch     int64
	HeadN     int64
	HeadH     string
	RosterSeq int64
	NameCt    string // JSON or ""
	NameClear string
	ShowName  bool
	Updated   int64
	Bytes     int64
}

const siteCols = "id, created, created_by, epoch, head_n, head_h, roster_seq, coalesce(name_ct,''), coalesce(name_clear,''), show_name, updated, bytes"

func scanSite(row interface{ Scan(...any) error }) (*Site, error) {
	s := &Site{}
	err := row.Scan(&s.ID, &s.Created, &s.CreatedBy, &s.Epoch, &s.HeadN, &s.HeadH, &s.RosterSeq, &s.NameCt, &s.NameClear, &s.ShowName, &s.Updated, &s.Bytes)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// SiteByID loads a site.
func SiteByID(ctx context.Context, q Q, id string) (*Site, error) {
	return scanSite(q.QueryRowContext(ctx, "SELECT "+siteCols+" FROM sites WHERE id = ?", id))
}

// InsertSite stores a new site.
func InsertSite(ctx context.Context, q Q, s *Site) error {
	_, err := q.ExecContext(ctx, `INSERT INTO sites(id, created, created_by, epoch, head_n, head_h, roster_seq, name_ct, name_clear, show_name, updated, bytes)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`, s.ID, s.Created, s.CreatedBy, s.Epoch, s.HeadN, s.HeadH, s.RosterSeq,
		nullable(s.NameCt), nullable(s.NameClear), s.ShowName, s.Updated)
	return err
}

// SetSiteName updates the encrypted name and the clear-name setting.
func SetSiteName(ctx context.Context, q Q, id, nameCt string, showName bool, nameClear string, now int64) error {
	if !showName {
		nameClear = ""
	}
	_, err := q.ExecContext(ctx, "UPDATE sites SET name_ct = ?, show_name = ?, name_clear = ?, updated = ? WHERE id = ?",
		nullable(nameCt), showName, nullable(nameClear), now, id)
	return err
}

// SetRoster bumps a site's roster seq and epoch (and the name, which is
// re-encrypted at every rotation).
func SetRoster(ctx context.Context, q Q, id string, seq, epoch int64, nameCt string, now int64) error {
	if nameCt != "" {
		_, err := q.ExecContext(ctx, "UPDATE sites SET roster_seq = ?, epoch = ?, name_ct = ?, updated = ? WHERE id = ?", seq, epoch, nameCt, now, id)
		return err
	}
	_, err := q.ExecContext(ctx, "UPDATE sites SET roster_seq = ?, epoch = ?, updated = ? WHERE id = ?", seq, epoch, now, id)
	return err
}

// DeleteSite removes a site and everything that hangs from it (rosters,
// members, wraps, invites, revisions and bodies cascade), plus its unsent
// mail and the files it carries.
func DeleteSite(ctx context.Context, q Q, id string) error {
	if _, err := q.ExecContext(ctx, "DELETE FROM outbox WHERE site_id = ? AND sent IS NULL", id); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, "DELETE FROM mail_files WHERE site_id = ?", id); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, "DELETE FROM sites WHERE id = ?", id)
	return err
}

// ---- members ----

// Member is one membership joined with the person's account.
type Member struct {
	SiteID   string
	UserID   string
	Role     string
	Status   string // granted | waiting
	Added    int64
	Granted  int64
	Muted    bool
	Email    string // normalised
	Lang     string
	EncPub   string
	SigPub   string
	KeysAt   int64
	Notify   string
	Disabled bool
}

const memberCols = `m.site_id, m.user_id, m.role, m.status, m.added, coalesce(m.granted,0), m.muted,
	u.email_norm, u.lang, coalesce(u.enc_pub,''), coalesce(u.sig_pub,''), coalesce(u.keys_at,0), u.notify, u.disabled`

func scanMember(row interface{ Scan(...any) error }) (*Member, error) {
	m := &Member{}
	err := row.Scan(&m.SiteID, &m.UserID, &m.Role, &m.Status, &m.Added, &m.Granted, &m.Muted,
		&m.Email, &m.Lang, &m.EncPub, &m.SigPub, &m.KeysAt, &m.Notify, &m.Disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// MemberOf loads one membership; ErrNotFound when the user is not a member.
func MemberOf(ctx context.Context, q Q, site, user string) (*Member, error) {
	return scanMember(q.QueryRowContext(ctx, "SELECT "+memberCols+" FROM members m JOIN users u ON u.id = m.user_id WHERE m.site_id = ? AND m.user_id = ?", site, user))
}

// SiteMembers lists a site's members, oldest first.
func SiteMembers(ctx context.Context, q Q, site string) ([]Member, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+memberCols+" FROM members m JOIN users u ON u.id = m.user_id WHERE m.site_id = ? ORDER BY m.added, m.user_id", site)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// UserSites lists the user's memberships with their sites.
func UserSites(ctx context.Context, q Q, user string) ([]Site, []Member, error) {
	rows, err := q.QueryContext(ctx, "SELECT s.id, s.created, s.created_by, s.epoch, s.head_n, s.head_h, s.roster_seq, coalesce(s.name_ct,''), coalesce(s.name_clear,''), s.show_name, s.updated, s.bytes, "+
		memberCols+" FROM members m JOIN sites s ON s.id = m.site_id JOIN users u ON u.id = m.user_id WHERE m.user_id = ? ORDER BY s.updated DESC", user)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var ss []Site
	var ms []Member
	for rows.Next() {
		var s Site
		var m Member
		if err := rows.Scan(&s.ID, &s.Created, &s.CreatedBy, &s.Epoch, &s.HeadN, &s.HeadH, &s.RosterSeq, &s.NameCt, &s.NameClear, &s.ShowName, &s.Updated, &s.Bytes,
			&m.SiteID, &m.UserID, &m.Role, &m.Status, &m.Added, &m.Granted, &m.Muted,
			&m.Email, &m.Lang, &m.EncPub, &m.SigPub, &m.KeysAt, &m.Notify, &m.Disabled); err != nil {
			return nil, nil, err
		}
		ss = append(ss, s)
		ms = append(ms, m)
	}
	return ss, ms, rows.Err()
}

// InsertMember adds a membership.
func InsertMember(ctx context.Context, q Q, site, user, role, status string, now int64) error {
	var granted any
	if status == "granted" {
		granted = now
	}
	_, err := q.ExecContext(ctx, "INSERT INTO members(site_id, user_id, role, status, added, granted) VALUES(?,?,?,?,?,?)", site, user, role, status, now, granted)
	return err
}

// GrantMember sets a waiting member granted.
func GrantMember(ctx context.Context, q Q, site, user string, now int64) error {
	_, err := q.ExecContext(ctx, "UPDATE members SET status = 'granted', granted = ? WHERE site_id = ? AND user_id = ?", now, site, user)
	return err
}

// SetMemberRole changes a member's role.
func SetMemberRole(ctx context.Context, q Q, site, user, role string) error {
	_, err := q.ExecContext(ctx, "UPDATE members SET role = ? WHERE site_id = ? AND user_id = ?", role, site, user)
	return err
}

// SetMemberMuted sets the per-site notification mute.
func SetMemberMuted(ctx context.Context, q Q, site, user string, muted bool) error {
	_, err := q.ExecContext(ctx, "UPDATE members SET muted = ? WHERE site_id = ? AND user_id = ?", muted, site, user)
	return err
}

// DeleteMember removes a membership and every wrap the person had.
func DeleteMember(ctx context.Context, q Q, site, user string) error {
	if _, err := q.ExecContext(ctx, "DELETE FROM site_wraps WHERE site_id = ? AND user_id = ?", site, user); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, "DELETE FROM members WHERE site_id = ? AND user_id = ?", site, user)
	return err
}

// ---- rosters and wraps ----

// InsertRoster stores a roster blob.
func InsertRoster(ctx context.Context, q Q, site string, seq, epoch int64, by, roster string, now int64) error {
	_, err := q.ExecContext(ctx, "INSERT INTO site_rosters(site_id, seq, epoch, by_user, roster, created) VALUES(?,?,?,?,?,?)", site, seq, epoch, by, roster, now)
	return err
}

// RostersSince lists the roster blobs with seq > since, ascending.
func RostersSince(ctx context.Context, q Q, site string, since int64) ([]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT roster FROM site_rosters WHERE site_id = ? AND seq > ? ORDER BY seq", site, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// InsertWrap stores a site key wrapped for one member and epoch (replacing
// an older one for the same key).
func InsertWrap(ctx context.Context, q Q, site string, epoch int64, user, wrap, by string, now int64) error {
	_, err := q.ExecContext(ctx, `INSERT INTO site_wraps(site_id, epoch, user_id, wrap, by_user, created) VALUES(?,?,?,?,?,?)
		ON CONFLICT(site_id, epoch, user_id) DO UPDATE SET wrap = excluded.wrap, by_user = excluded.by_user, created = excluded.created`,
		site, epoch, user, wrap, by, now)
	return err
}

// EpochWrap is one wrapped site key.
type EpochWrap struct {
	Epoch int64
	Wrap  string
}

// UserWraps lists a member's wraps for a site, every epoch.
func UserWraps(ctx context.Context, q Q, site, user string) ([]EpochWrap, error) {
	rows, err := q.QueryContext(ctx, "SELECT epoch, wrap FROM site_wraps WHERE site_id = ? AND user_id = ? ORDER BY epoch", site, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EpochWrap
	for rows.Next() {
		var w EpochWrap
		if err := rows.Scan(&w.Epoch, &w.Wrap); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// ResetUserKeys is the database side of "Reset my keys" (design §4.4): every
// other device loses its wrap, every site wrap of the user goes, and every
// membership waits for an owner again. It returns the sites concerned.
func ResetUserKeys(ctx context.Context, q Q, user, keepDevice string) ([]string, error) {
	if _, err := q.ExecContext(ctx, "UPDATE devices SET wrap = NULL, wrapped_by = NULL WHERE user_id = ? AND id <> ?", user, keepDevice); err != nil {
		return nil, err
	}
	if _, err := q.ExecContext(ctx, "UPDATE link_requests SET status = 'expired' WHERE user_id = ? AND status = 'pending'", user); err != nil {
		return nil, err
	}
	if _, err := q.ExecContext(ctx, "DELETE FROM site_wraps WHERE user_id = ?", user); err != nil {
		return nil, err
	}
	rows, err := q.QueryContext(ctx, "UPDATE members SET status = 'waiting', granted = NULL WHERE user_id = ? RETURNING site_id", user)
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
