package store

import (
	"context"
	"database/sql"
	"errors"
)

// Connections (docs/SCOPE.md step 8f, D376-D379, migration 0006): the
// desktop apps whose connection is watched, and the gaps in it. Server
// metadata (when a PC reported), never site data.

// Connection is one watched PC.
type Connection struct {
	DeviceID   string
	UserID     string
	Email      string
	Name       string
	Since      int64
	IntervalMs int64
	LastBeat   int64 // 0 = never
	Lost       bool
	Away       bool
}

// Gap is a time a PC or a monitor was not connected, as one side saw it.
type Gap struct {
	ClientID string
	From     int64
	To       int64 // 0 = goes on
	SeenBy   string
}

// ConnectionBeat is a watched PC's heartbeat: watched from now when it was
// not, last_beat now, back from away, lost cleared (its open server gap
// closed now). -> whether it was lost, and when that gap began.
func ConnectionBeat(ctx context.Context, q Q, device, user, name string, now, intervalMs int64) (bool, int64, error) {
	var lost bool
	var last sql.NullInt64
	err := q.QueryRowContext(ctx, "SELECT lost, last_beat FROM connections WHERE device_id = ? AND user_id = ?", device, user).Scan(&lost, &last)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		_, err = q.ExecContext(ctx, "INSERT INTO connections(device_id, user_id, name, since, interval_ms, last_beat) VALUES(?,?,?,?,?,?)",
			device, user, name, now, intervalMs, now)
		return false, 0, err
	case err != nil:
		return false, 0, err
	}
	if _, err = q.ExecContext(ctx, "UPDATE connections SET name = ?, interval_ms = ?, last_beat = ?, lost = 0, away = 0 WHERE device_id = ?",
		name, intervalMs, now, device); err != nil {
		return false, 0, err
	}
	if !lost {
		return false, 0, nil
	}
	var from int64
	err = q.QueryRowContext(ctx, `UPDATE connection_gaps SET to_ms = ? WHERE id = (SELECT id FROM connection_gaps
		WHERE client_id = ? AND seen_by = 'server' AND to_ms IS NULL ORDER BY from_ms DESC LIMIT 1) RETURNING from_ms`, now, device).Scan(&from)
	if errors.Is(err, sql.ErrNoRows) {
		return true, last.Int64, nil
	}
	return true, from, err
}

// ConnectionAway: the PC said it is going (quit, signed out): its silence
// is not lost until it beats again. Nothing when it is not watched.
func ConnectionAway(ctx context.Context, q Q, device string) error {
	_, err := q.ExecContext(ctx, "UPDATE connections SET away = 1 WHERE device_id = ?", device)
	return err
}

// DeleteConnection stops watching a PC (its gaps stay for the reports).
func DeleteConnection(ctx context.Context, q Q, device, user string) error {
	_, err := q.ExecContext(ctx, "DELETE FROM connections WHERE device_id = ? AND user_id = ?", device, user)
	return err
}

// AddGap records a gap (a client's own, told when it could reach the
// server again; or a server's).
func AddGap(ctx context.Context, q Q, g Gap) error {
	var to any
	if g.To > 0 {
		to = g.To
	}
	_, err := q.ExecContext(ctx, "INSERT INTO connection_gaps(client_id, from_ms, to_ms, seen_by) VALUES(?,?,?,?)", g.ClientID, g.From, to, g.SeenBy)
	return err
}

// CloseGap ends a client's open server gap now (a monitor reporting again).
func CloseGap(ctx context.Context, q Q, client string, now int64) error {
	_, err := q.ExecContext(ctx, "UPDATE connection_gaps SET to_ms = ? WHERE client_id = ? AND seen_by = 'server' AND to_ms IS NULL", now, client)
	return err
}

// LostConnections marks the watched PCs that missed `missed` intervals (and
// did not say they were going), opens a server gap for each from its last
// beat, and returns them.
func LostConnections(ctx context.Context, q Q, now, missed int64) ([]Connection, error) {
	rows, err := q.QueryContext(ctx, `UPDATE connections SET lost = 1 WHERE lost = 0 AND away = 0
		AND coalesce(last_beat, since) + interval_ms * ? < ?
		RETURNING device_id, user_id, name, coalesce(last_beat, since)`, missed, now)
	if err != nil {
		return nil, err
	}
	var out []Connection
	for rows.Next() {
		var c Connection
		if err := rows.Scan(&c.DeviceID, &c.UserID, &c.Name, &c.LastBeat); err != nil {
			rows.Close()
			return nil, err
		}
		c.Lost = true
		out = append(out, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, c := range out {
		if err := AddGap(ctx, q, Gap{ClientID: c.DeviceID, From: c.LastBeat, SeenBy: "server"}); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// GrantedSiteIDs is every site a person is a granted member of.
func GrantedSiteIDs(ctx context.Context, q Q, user string) ([]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT site_id FROM members WHERE user_id = ? AND status = 'granted'", user)
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

// SiteConnections is the watched PCs of the site's granted members.
func SiteConnections(ctx context.Context, q Q, site string) ([]Connection, error) {
	rows, err := q.QueryContext(ctx, `SELECT c.device_id, c.user_id, coalesce(u.email, ''), c.name, c.since, c.interval_ms, coalesce(c.last_beat, 0), c.lost, c.away
		FROM connections c JOIN users u ON u.id = c.user_id
		WHERE c.user_id IN (SELECT user_id FROM members WHERE site_id = ? AND status = 'granted')
		ORDER BY c.name, c.device_id`, site)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Connection
	for rows.Next() {
		var c Connection
		if err := rows.Scan(&c.DeviceID, &c.UserID, &c.Email, &c.Name, &c.Since, &c.IntervalMs, &c.LastBeat, &c.Lost, &c.Away); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GapsOf is a client's gaps that touch [from, to), oldest first, at most limit.
func GapsOf(ctx context.Context, q Q, client string, from, to int64, limit int) ([]Gap, error) {
	rows, err := q.QueryContext(ctx, `SELECT client_id, from_ms, coalesce(to_ms, 0), seen_by FROM connection_gaps
		WHERE client_id = ? AND from_ms < ? AND (to_ms IS NULL OR to_ms > ?) ORDER BY from_ms LIMIT ?`, client, to, from, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Gap
	for rows.Next() {
		var g Gap
		if err := rows.Scan(&g.ClientID, &g.From, &g.To, &g.SeenBy); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// PruneGaps drops gaps that ended before `before`.
func PruneGaps(ctx context.Context, q Q, before int64) (int64, error) {
	r, err := q.ExecContext(ctx, "DELETE FROM connection_gaps WHERE to_ms IS NOT NULL AND to_ms < ?", before)
	if err != nil {
		return 0, err
	}
	return r.RowsAffected()
}
