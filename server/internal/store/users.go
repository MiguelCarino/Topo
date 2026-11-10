package store

import (
	"context"
	"database/sql"
	"errors"
)

// Q is what both *sql.DB and *sql.Tx offer, so one query function serves
// inside and outside a transaction.
type Q interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// User is one row of users.
type User struct {
	ID         string
	Email      string
	EmailNorm  string
	Lang       string
	ServerRole string
	EncPub     string // "" until key setup
	SigPub     string
	KeysAt     int64
	HasEscrow  bool
	Notify     string // JSON
	Created    int64
	Disabled   bool
}

const userCols = "id, email, email_norm, lang, server_role, coalesce(enc_pub,''), coalesce(sig_pub,''), coalesce(keys_at,0), escrow IS NOT NULL, notify, created, disabled"

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	u := &User{}
	err := row.Scan(&u.ID, &u.Email, &u.EmailNorm, &u.Lang, &u.ServerRole, &u.EncPub, &u.SigPub, &u.KeysAt, &u.HasEscrow, &u.Notify, &u.Created, &u.Disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

// UserByEmail finds a user by normalised email (disabled ones included).
func UserByEmail(ctx context.Context, q Q, norm string) (*User, error) {
	return scanUser(q.QueryRowContext(ctx, "SELECT "+userCols+" FROM users WHERE email_norm = ?", norm))
}

// UserByID finds a user by id.
func UserByID(ctx context.Context, q Q, id string) (*User, error) {
	return scanUser(q.QueryRowContext(ctx, "SELECT "+userCols+" FROM users WHERE id = ?", id))
}

// CreateUser inserts u (ID, Email, EmailNorm, Lang, ServerRole, Created).
func CreateUser(ctx context.Context, q Q, u *User) error {
	if u.Notify == "" {
		u.Notify = "{}"
	}
	_, err := q.ExecContext(ctx, "INSERT INTO users(id, email, email_norm, lang, server_role, notify, created) VALUES(?,?,?,?,?,?,?)",
		u.ID, u.Email, u.EmailNorm, u.Lang, u.ServerRole, u.Notify, u.Created)
	return err
}

// SetServerRole changes a user's server role; becoming owner also marks
// meta owner_exists.
func SetServerRole(ctx context.Context, q Q, id, role string) error {
	if _, err := q.ExecContext(ctx, "UPDATE users SET server_role = ? WHERE id = ?", role, id); err != nil {
		return err
	}
	if role == "owner" {
		_, err := q.ExecContext(ctx, "INSERT INTO meta(key, value) VALUES('owner_exists','1') ON CONFLICT(key) DO UPDATE SET value = '1'")
		return err
	}
	return nil
}

// CountOwners counts enabled server owners.
func CountOwners(ctx context.Context, q Q) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE server_role = 'owner' AND disabled = 0").Scan(&n)
	return n, err
}

// PendingInvite reports whether norm has an unexpired pending invite.
func PendingInvite(ctx context.Context, q Q, norm string, now int64) (bool, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM invites WHERE email_norm = ? AND status = 'pending' AND expires > ?", norm, now).Scan(&n)
	return n > 0, err
}

// EnsureOwnerEmail promotes the configured owner email to server owner if
// that user exists (D53: it can promote, never demote). It reports whether a
// user was promoted.
func (s *Store) EnsureOwnerEmail(ctx context.Context, norm string) (bool, error) {
	promoted := false
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		u, err := UserByEmail(ctx, tx, norm)
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if u.ServerRole == "owner" && !u.Disabled {
			return nil
		}
		if _, err := tx.ExecContext(ctx, "UPDATE users SET disabled = 0 WHERE id = ?", u.ID); err != nil {
			return err
		}
		promoted = true
		return SetServerRole(ctx, tx, u.ID, "owner")
	})
	return promoted, err
}
