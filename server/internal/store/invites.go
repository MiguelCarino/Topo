package store

import (
	"context"
	"database/sql"
	"errors"
)

// Invite is one invitation to a site, by email.
type Invite struct {
	ID         string
	SiteID     string
	EmailNorm  string
	Role       string
	Lang       string
	TokenHash  []byte
	Status     string // pending | accepted | revoked | expired
	InvitedBy  string
	Created    int64
	Expires    int64
	AcceptedBy string
	AcceptedAt int64
}

const inviteCols = "id, site_id, email_norm, role, lang, token_hash, status, invited_by, created, expires, coalesce(accepted_by,''), coalesce(accepted_at,0)"

func scanInvite(row interface{ Scan(...any) error }) (*Invite, error) {
	i := &Invite{}
	err := row.Scan(&i.ID, &i.SiteID, &i.EmailNorm, &i.Role, &i.Lang, &i.TokenHash, &i.Status, &i.InvitedBy, &i.Created, &i.Expires, &i.AcceptedBy, &i.AcceptedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return i, err
}

// InviteByID loads an invitation.
func InviteByID(ctx context.Context, q Q, id string) (*Invite, error) {
	return scanInvite(q.QueryRowContext(ctx, "SELECT "+inviteCols+" FROM invites WHERE id = ?", id))
}

// PendingInviteFor finds the pending invitation of an address to a site.
func PendingInviteFor(ctx context.Context, q Q, site, norm string) (*Invite, error) {
	return scanInvite(q.QueryRowContext(ctx, "SELECT "+inviteCols+" FROM invites WHERE site_id = ? AND email_norm = ? AND status = 'pending'", site, norm))
}

// SiteInvites lists a site's pending invitations.
func SiteInvites(ctx context.Context, q Q, site string, now int64) ([]Invite, error) {
	return listInvites(ctx, q, "SELECT "+inviteCols+" FROM invites WHERE site_id = ? AND status = 'pending' AND expires > ? ORDER BY created", site, now)
}

// EmailInvites lists the pending invitations addressed to norm.
func EmailInvites(ctx context.Context, q Q, norm string, now int64) ([]Invite, error) {
	return listInvites(ctx, q, "SELECT "+inviteCols+" FROM invites WHERE email_norm = ? AND status = 'pending' AND expires > ? ORDER BY created", norm, now)
}

func listInvites(ctx context.Context, q Q, query string, args ...any) ([]Invite, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Invite
	for rows.Next() {
		i, err := scanInvite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *i)
	}
	return out, rows.Err()
}

// InsertInvite stores a pending invitation.
func InsertInvite(ctx context.Context, q Q, i *Invite) error {
	_, err := q.ExecContext(ctx, "INSERT INTO invites(id, site_id, email_norm, role, lang, token_hash, status, invited_by, created, expires) VALUES(?,?,?,?,?,?,'pending',?,?,?)",
		i.ID, i.SiteID, i.EmailNorm, i.Role, i.Lang, i.TokenHash, i.InvitedBy, i.Created, i.Expires)
	return err
}

// RenewInvite gives a pending invitation a new token, role, language and
// expiry (a re-invite or a resend).
func RenewInvite(ctx context.Context, q Q, id string, tokenHash []byte, role, lang string, expires int64) error {
	_, err := q.ExecContext(ctx, "UPDATE invites SET token_hash = ?, role = ?, lang = ?, expires = ? WHERE id = ?", tokenHash, role, lang, expires, id)
	return err
}

// SetInviteStatus records accepted (with who and when) or revoked.
func SetInviteStatus(ctx context.Context, q Q, id, status, by string, at int64) error {
	if status == "accepted" {
		_, err := q.ExecContext(ctx, "UPDATE invites SET status = 'accepted', accepted_by = ?, accepted_at = ? WHERE id = ?", by, at, id)
		return err
	}
	_, err := q.ExecContext(ctx, "UPDATE invites SET status = ? WHERE id = ?", status, id)
	return err
}

// CountPendingInvites counts a site's unexpired pending invitations.
func CountPendingInvites(ctx context.Context, q Q, site string, now int64) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM invites WHERE site_id = ? AND status = 'pending' AND expires > ?", site, now).Scan(&n)
	return n, err
}

// InviteSendCounts counts invitation emails since `since`: by this
// inviter, to this address, and for this invitation (amendment B8).
func InviteSendCounts(ctx context.Context, q Q, inviter, norm, invite string, since int64) (byInviter, toEmail, forInvite int, err error) {
	err = q.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM invite_sends WHERE inviter = ? AND at > ?),
		(SELECT count(*) FROM invite_sends WHERE email_norm = ? AND at > ?),
		(SELECT count(*) FROM invite_sends WHERE invite_id = ? AND at > ?)`,
		inviter, since, norm, since, invite, since).Scan(&byInviter, &toEmail, &forInvite)
	return
}

// AddInviteSend records one invitation email.
func AddInviteSend(ctx context.Context, q Q, inviter, site, invite, norm string, at int64) error {
	_, err := q.ExecContext(ctx, "INSERT INTO invite_sends(inviter, site_id, invite_id, email_norm, at) VALUES(?,?,?,?,?)", inviter, site, invite, norm, at)
	return err
}

// ---- declared events (amendment F2) ----

// CountDeclared counts an author's declarations of kind to one recipient on
// a site since `since`.
func CountDeclared(ctx context.Context, q Q, site, author, kind, to string, since int64) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM declared WHERE site_id = ? AND author = ? AND kind = ? AND to_user = ? AND at > ?", site, author, kind, to, since).Scan(&n)
	return n, err
}

// AddDeclared records one declaration.
func AddDeclared(ctx context.Context, q Q, site, author, kind, to string, at int64) error {
	_, err := q.ExecContext(ctx, "INSERT INTO declared(site_id, author, kind, to_user, at) VALUES(?,?,?,?,?)", site, author, kind, to, at)
	return err
}

// ---- notification bookkeeping ----

// MergeMail adds one event to the unsent row with this dedupe key; it
// reports false when there is none.
func MergeMail(ctx context.Context, q Q, dedupe string) (bool, error) {
	res, err := q.ExecContext(ctx, "UPDATE outbox SET count = count + 1 WHERE dedupe = ? AND sent IS NULL", dedupe)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// CountSiteMail counts the rows of the given kinds queued for a user about
// a site since `since` (the per-recipient hourly cap).
func CountSiteMail(ctx context.Context, q Q, user, site string, kinds []string, since int64) (int, error) {
	total := 0
	for _, k := range kinds {
		var n int
		if err := q.QueryRowContext(ctx, "SELECT coalesce(sum(count),0) FROM outbox WHERE user_id = ? AND site_id = ? AND kind = ? AND created > ? AND sent IS NOT -2", user, site, k, since).Scan(&n); err != nil {
			return 0, err
		}
		total += n
	}
	return total, nil
}

// LastSent is when kind was last sent to a user about a site (0 = never).
func LastSent(ctx context.Context, q Q, user, site, kind string) (int64, error) {
	var at int64
	err := q.QueryRowContext(ctx, "SELECT at FROM last_sent WHERE user_id = ? AND site_id = ? AND kind = ?", user, site, kind).Scan(&at)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return at, err
}

// SetLastSent records a send.
func SetLastSent(ctx context.Context, q Q, user, site, kind string, at int64) error {
	_, err := q.ExecContext(ctx, "INSERT INTO last_sent(user_id, site_id, kind, at) VALUES(?,?,?,?) ON CONFLICT(user_id, site_id, kind) DO UPDATE SET at = excluded.at", user, site, kind, at)
	return err
}

// MailSkipped marks a row that was not sent on purpose (the person was
// online when a revision digest came due): sent = -3, data blanked.
func MailSkipped(ctx context.Context, q Q, id string) error {
	_, err := q.ExecContext(ctx, "UPDATE outbox SET sent = -3, data = '{}' WHERE id = ?", id)
	return err
}

// SiteNameClear is the clear name of a site when its owner allows it in
// emails ("" otherwise, or when the site is gone).
func SiteNameClear(ctx context.Context, q Q, site string) (string, error) {
	var name string
	err := q.QueryRowContext(ctx, "SELECT coalesce(name_clear,'') FROM sites WHERE id = ? AND show_name = 1", site).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return name, err
}
