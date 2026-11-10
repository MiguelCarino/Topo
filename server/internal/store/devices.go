package store

import (
	"context"
	"database/sql"
	"errors"
)

// Device is one browser's key (D58): its public ECDH key and, once linked,
// the user's key bundle wrapped to it.
type Device struct {
	ID        string
	UserID    string
	DevPub    string
	Label     string
	Created   int64
	LastSeen  int64
	Wrap      string // "" until linked
	WrappedBy string
}

const deviceCols = "id, user_id, dev_pub, label, created, last_seen, coalesce(wrap,''), coalesce(wrapped_by,'')"

func scanDevice(row interface{ Scan(...any) error }) (*Device, error) {
	d := &Device{}
	err := row.Scan(&d.ID, &d.UserID, &d.DevPub, &d.Label, &d.Created, &d.LastSeen, &d.Wrap, &d.WrappedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

// InsertDevice stores a new, unlinked device.
func InsertDevice(ctx context.Context, q Q, d *Device) error {
	_, err := q.ExecContext(ctx, "INSERT INTO devices(id, user_id, dev_pub, label, created, last_seen) VALUES(?,?,?,?,?,?)",
		d.ID, d.UserID, d.DevPub, d.Label, d.Created, d.LastSeen)
	return err
}

// DeviceByID loads a device.
func DeviceByID(ctx context.Context, q Q, id string) (*Device, error) {
	return scanDevice(q.QueryRowContext(ctx, "SELECT "+deviceCols+" FROM devices WHERE id = ?", id))
}

// UserDevices lists a user's devices, newest first.
func UserDevices(ctx context.Context, q Q, user string) ([]Device, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+deviceCols+" FROM devices WHERE user_id = ? ORDER BY created DESC", user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Device
	for rows.Next() {
		d, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

// CountDevices counts a user's devices.
func CountDevices(ctx context.Context, q Q, user string) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM devices WHERE user_id = ?", user).Scan(&n)
	return n, err
}

// BindSession binds a session (by public id) to a device.
func BindSession(ctx context.Context, q Q, sessionID, deviceID string) error {
	_, err := q.ExecContext(ctx, "UPDATE sessions SET device_id = ? WHERE id = ?", deviceID, sessionID)
	return err
}

// DeleteDevice removes the user's device with its wrap, link requests and
// sessions, and returns the public ids of those sessions; ErrNotFound when
// the device is not the user's.
func DeleteDevice(ctx context.Context, q Q, user, id string) ([]string, error) {
	rows, err := q.QueryContext(ctx, "DELETE FROM sessions WHERE device_id = ? AND user_id = ? RETURNING id", id, user)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	res, err := q.ExecContext(ctx, "DELETE FROM devices WHERE id = ? AND user_id = ?", id, user)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return ids, nil
}

// SetDeviceWrap stores the user bundle wrapped to a device.
func SetDeviceWrap(ctx context.Context, q Q, id, wrap, by string) error {
	_, err := q.ExecContext(ctx, "UPDATE devices SET wrap = ?, wrapped_by = ? WHERE id = ?", wrap, by, id)
	return err
}

// TouchDevice moves a device's last_seen forward.
func TouchDevice(ctx context.Context, q Q, id string, now int64) error {
	_, err := q.ExecContext(ctx, "UPDATE devices SET last_seen = ? WHERE id = ?", now, id)
	return err
}

// ---- link requests ----

// LinkRequest is a new device asking an existing one for the user bundle.
type LinkRequest struct {
	ID       string
	UserID   string
	DeviceID string
	Created  int64
	Expires  int64
	Status   string
	DevPub   string
	Label    string
}

// InsertLinkRequest stores a pending request; older pending requests of
// the same device expire.
func InsertLinkRequest(ctx context.Context, q Q, l *LinkRequest) error {
	if _, err := q.ExecContext(ctx, "UPDATE link_requests SET status = 'expired' WHERE device_id = ? AND status = 'pending'", l.DeviceID); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, "INSERT INTO link_requests(id, user_id, device_id, created, expires, status) VALUES(?,?,?,?,?,'pending')",
		l.ID, l.UserID, l.DeviceID, l.Created, l.Expires)
	return err
}

// LinkRequestByID loads a request with its device's key and label.
func LinkRequestByID(ctx context.Context, q Q, id string) (*LinkRequest, error) {
	l := &LinkRequest{}
	err := q.QueryRowContext(ctx, `SELECT l.id, l.user_id, l.device_id, l.created, l.expires, l.status, d.dev_pub, d.label
		FROM link_requests l JOIN devices d ON d.id = l.device_id WHERE l.id = ?`, id).
		Scan(&l.ID, &l.UserID, &l.DeviceID, &l.Created, &l.Expires, &l.Status, &l.DevPub, &l.Label)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return l, err
}

// PendingLinkRequests lists the user's unexpired pending requests.
func PendingLinkRequests(ctx context.Context, q Q, user string, now int64) ([]LinkRequest, error) {
	rows, err := q.QueryContext(ctx, `SELECT l.id, l.user_id, l.device_id, l.created, l.expires, l.status, d.dev_pub, d.label
		FROM link_requests l JOIN devices d ON d.id = l.device_id
		WHERE l.user_id = ? AND l.status = 'pending' AND l.expires > ? ORDER BY l.created`, user, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LinkRequest
	for rows.Next() {
		var l LinkRequest
		if err := rows.Scan(&l.ID, &l.UserID, &l.DeviceID, &l.Created, &l.Expires, &l.Status, &l.DevPub, &l.Label); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// SetLinkStatus records approved or denied.
func SetLinkStatus(ctx context.Context, q Q, id, status string) error {
	_, err := q.ExecContext(ctx, "UPDATE link_requests SET status = ? WHERE id = ?", status, id)
	return err
}

// ---- user keys ----

// SetUserKeys records a user's public keys (and the escrow, which may be
// NULL when skipped).
func SetUserKeys(ctx context.Context, q Q, user, encPub, sigPub string, at int64, escrow *string) error {
	_, err := q.ExecContext(ctx, "UPDATE users SET enc_pub = ?, sig_pub = ?, keys_at = ?, escrow = ? WHERE id = ?", encPub, sigPub, at, escrow, user)
	return err
}

// GetEscrow returns the user's escrow blob; ErrNotFound when none.
func GetEscrow(ctx context.Context, q Q, user string) (string, error) {
	var e sql.NullString
	err := q.QueryRowContext(ctx, "SELECT escrow FROM users WHERE id = ?", user).Scan(&e)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !e.Valid) {
		return "", ErrNotFound
	}
	return e.String, err
}

// SetEscrow replaces the escrow blob.
func SetEscrow(ctx context.Context, q Q, user, escrow string) error {
	_, err := q.ExecContext(ctx, "UPDATE users SET escrow = ? WHERE id = ?", escrow, user)
	return err
}
