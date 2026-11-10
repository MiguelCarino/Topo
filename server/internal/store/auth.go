package store

import (
	"context"
	"database/sql"
	"errors"
)

// ---- sessions ----

// SessionRow is one sessions row joined with its user.
type SessionRow struct {
	IDHash   []byte
	ID       string
	UserID   string
	DeviceID string
	Created  int64
	LastSeen int64
	Expires  int64
	IP       string
	UA       string
	User     *User
}

// InsertSession stores a new session.
func InsertSession(ctx context.Context, q Q, r *SessionRow) error {
	var dev any
	if r.DeviceID != "" {
		dev = r.DeviceID
	}
	_, err := q.ExecContext(ctx, "INSERT INTO sessions(id_hash, id, user_id, device_id, created, last_seen, expires, ip, ua) VALUES(?,?,?,?,?,?,?,?,?)",
		r.IDHash, r.ID, r.UserID, dev, r.Created, r.LastSeen, r.Expires, r.IP, r.UA)
	return err
}

// SessionByHash loads a session and its user by the SHA-256 of the cookie.
func SessionByHash(ctx context.Context, q Q, hash []byte) (*SessionRow, error) {
	r := &SessionRow{}
	var dev sql.NullString
	row := q.QueryRowContext(ctx, "SELECT s.id_hash, s.id, s.user_id, s.device_id, s.created, s.last_seen, s.expires, s.ip, s.ua, "+
		"u.id, u.email, u.email_norm, u.lang, u.server_role, coalesce(u.enc_pub,''), coalesce(u.sig_pub,''), coalesce(u.keys_at,0), u.escrow IS NOT NULL, u.notify, u.created, u.disabled "+
		"FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?", hash)
	u := &User{}
	err := row.Scan(&r.IDHash, &r.ID, &r.UserID, &dev, &r.Created, &r.LastSeen, &r.Expires, &r.IP, &r.UA,
		&u.ID, &u.Email, &u.EmailNorm, &u.Lang, &u.ServerRole, &u.EncPub, &u.SigPub, &u.KeysAt, &u.HasEscrow, &u.Notify, &u.Created, &u.Disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	r.DeviceID = dev.String
	r.User = u
	return r, nil
}

// TouchSession moves last_seen forward.
func TouchSession(ctx context.Context, q Q, hash []byte, now int64) error {
	_, err := q.ExecContext(ctx, "UPDATE sessions SET last_seen = ? WHERE id_hash = ?", now, hash)
	return err
}

// DeleteSessionByHash removes one session by cookie hash; it returns the
// public id ("" when there was none).
func DeleteSessionByHash(ctx context.Context, q Q, hash []byte) (string, error) {
	var id string
	err := q.QueryRowContext(ctx, "DELETE FROM sessions WHERE id_hash = ? RETURNING id", hash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// DeleteUserSession removes the user's session with public id; ErrNotFound
// when it is not theirs.
func DeleteUserSession(ctx context.Context, q Q, userID, id string) error {
	res, err := q.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ? AND id = ?", userID, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteUserSessions removes every session of the user except keep (a
// public id, or "" for all) and returns the ids removed.
func DeleteUserSessions(ctx context.Context, q Q, userID, keep string) ([]string, error) {
	rows, err := q.QueryContext(ctx, "DELETE FROM sessions WHERE user_id = ? AND id <> ? RETURNING id", userID, keep)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// UserSessions lists the user's sessions, newest first.
func UserSessions(ctx context.Context, q Q, userID string) ([]SessionRow, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, coalesce(device_id,''), created, last_seen, expires, ip, ua FROM sessions WHERE user_id = ? ORDER BY last_seen DESC, created DESC", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionRow
	for rows.Next() {
		var r SessionRow
		if err := rows.Scan(&r.ID, &r.DeviceID, &r.Created, &r.LastSeen, &r.Expires, &r.IP, &r.UA); err != nil {
			return nil, err
		}
		r.UserID = userID
		out = append(out, r)
	}
	return out, rows.Err()
}

// DeviceOwner returns the user id of a device; ErrNotFound when missing.
func DeviceOwner(ctx context.Context, q Q, deviceID string) (string, error) {
	var u string
	err := q.QueryRowContext(ctx, "SELECT user_id FROM devices WHERE id = ?", deviceID).Scan(&u)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return u, err
}

// ---- challenges ----

// Challenge is one sign-in request (a code plus a magic link).
type Challenge struct {
	ID        string
	EmailNorm string
	Real      bool
	CodeMAC   []byte
	LinkHash  []byte
	BindHash  []byte
	Lang      string
	Setup     bool
	InviteID  string
	Created   int64
	Expires   int64
	Tries     int
	Used      bool
	IP        string
}

const challengeCols = "id, email_norm, real, code_mac, link_hash, bind_hash, lang, setup, coalesce(invite_id,''), created, expires, tries, used, ip"

func scanChallenge(row interface{ Scan(...any) error }) (*Challenge, error) {
	c := &Challenge{}
	err := row.Scan(&c.ID, &c.EmailNorm, &c.Real, &c.CodeMAC, &c.LinkHash, &c.BindHash, &c.Lang, &c.Setup, &c.InviteID, &c.Created, &c.Expires, &c.Tries, &c.Used, &c.IP)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

// InsertChallenge stores c.
func InsertChallenge(ctx context.Context, q Q, c *Challenge) error {
	var inv any
	if c.InviteID != "" {
		inv = c.InviteID
	}
	_, err := q.ExecContext(ctx, "INSERT INTO challenges(id, email_norm, real, code_mac, link_hash, bind_hash, lang, setup, invite_id, created, expires, tries, used, ip) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,0,?)",
		c.ID, c.EmailNorm, c.Real, c.CodeMAC, c.LinkHash, c.BindHash, c.Lang, c.Setup, inv, c.Created, c.Expires, c.IP)
	return err
}

// SupersedeChallenges marks every open challenge for the address used: a
// newer request replaces the older code and link.
func SupersedeChallenges(ctx context.Context, q Q, norm string) error {
	_, err := q.ExecContext(ctx, "UPDATE challenges SET used = 1 WHERE email_norm = ? AND used = 0", norm)
	return err
}

// ChallengeByID loads one challenge.
func ChallengeByID(ctx context.Context, q Q, id string) (*Challenge, error) {
	return scanChallenge(q.QueryRowContext(ctx, "SELECT "+challengeCols+" FROM challenges WHERE id = ?", id))
}

// ChallengeByLink loads the challenge whose link token hashes to h.
func ChallengeByLink(ctx context.Context, q Q, h []byte) (*Challenge, error) {
	return scanChallenge(q.QueryRowContext(ctx, "SELECT "+challengeCols+" FROM challenges WHERE link_hash = ?", h))
}

// RecentChallengeByBind reports whether the browser holding the challenge
// cookie that hashes to bind asked for norm since `since` (amendment B2).
func RecentChallengeByBind(ctx context.Context, q Q, bind []byte, norm string, since int64) (bool, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM challenges WHERE bind_hash = ? AND email_norm = ? AND created > ?", bind, norm, since).Scan(&n)
	return n > 0, err
}

// AddTry counts one verify attempt.
func AddTry(ctx context.Context, q Q, id string) error {
	_, err := q.ExecContext(ctx, "UPDATE challenges SET tries = tries + 1 WHERE id = ?", id)
	return err
}

// UseChallenge marks a challenge consumed.
func UseChallenge(ctx context.Context, q Q, id string) error {
	_, err := q.ExecContext(ctx, "UPDATE challenges SET used = 1 WHERE id = ?", id)
	return err
}

// KillChallenges deletes every challenge of an address (a user disabled,
// keys reset: amendment B4).
func KillChallenges(ctx context.Context, q Q, norm string) error {
	_, err := q.ExecContext(ctx, "UPDATE challenges SET used = 1 WHERE email_norm = ?", norm)
	return err
}

// ---- rate counters ----

// RateWindow counts mail_rate rows of kind for norm after since, with the
// oldest such time (0 when none).
func RateWindow(ctx context.Context, q Q, norm, kind string, since int64) (n int, oldest int64, err error) {
	err = q.QueryRowContext(ctx, "SELECT count(*), coalesce(min(at),0) FROM mail_rate WHERE email_norm = ? AND kind = ? AND at > ?", norm, kind, since).Scan(&n, &oldest)
	return
}

// RateAdd records one sign-in request.
func RateAdd(ctx context.Context, q Q, norm, kind string, at int64) error {
	_, err := q.ExecContext(ctx, "INSERT INTO mail_rate(email_norm, kind, at) VALUES(?,?,?)", norm, kind, at)
	return err
}

// VerifyFails counts failed code verifies for norm after since (B1).
func VerifyFails(ctx context.Context, q Q, norm string, since int64) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM verify_fail WHERE email_norm = ? AND at > ?", norm, since).Scan(&n)
	return n, err
}

// VerifyFailAdd records one failed code verify.
func VerifyFailAdd(ctx context.Context, q Q, norm string, at int64) error {
	_, err := q.ExecContext(ctx, "INSERT INTO verify_fail(email_norm, at) VALUES(?,?)", norm, at)
	return err
}

// ---- outbox ----

// Mail is one outbox row.
type Mail struct {
	ID        string
	Kind      string
	To        string
	UserID    string
	SiteID    string
	Lang      string
	Data      string // JSON object
	Dedupe    string
	Count     int
	Created   int64
	SendAfter int64
	Sent      int64 // 0 = not yet; -1 failed for good; -2 decoy
	Tries     int
	Error     string
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// InsertMail queues m.
func InsertMail(ctx context.Context, q Q, m *Mail) error {
	if m.Count == 0 {
		m.Count = 1
	}
	var sent any
	if m.Sent != 0 {
		sent = m.Sent
	}
	_, err := q.ExecContext(ctx, "INSERT INTO outbox(id, kind, to_email, user_id, site_id, lang, data, dedupe, count, created, send_after, sent, tries) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)",
		m.ID, m.Kind, m.To, nullable(m.UserID), nullable(m.SiteID), m.Lang, m.Data, nullable(m.Dedupe), m.Count, m.Created, m.SendAfter, sent)
	return err
}

// DueMail returns up to limit unsent rows due at now, oldest first.
func DueMail(ctx context.Context, q Q, now int64, limit int) ([]Mail, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, kind, to_email, coalesce(user_id,''), coalesce(site_id,''), lang, data, coalesce(dedupe,''), count, created, send_after, tries FROM outbox WHERE sent IS NULL AND send_after <= ? ORDER BY send_after, created LIMIT ?", now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Mail
	for rows.Next() {
		var m Mail
		if err := rows.Scan(&m.ID, &m.Kind, &m.To, &m.UserID, &m.SiteID, &m.Lang, &m.Data, &m.Dedupe, &m.Count, &m.Created, &m.SendAfter, &m.Tries); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// NextMailDue is the earliest send_after of an unsent row (0 when none).
func NextMailDue(ctx context.Context, q Q) (int64, error) {
	var at int64
	err := q.QueryRowContext(ctx, "SELECT coalesce(min(send_after),0) FROM outbox WHERE sent IS NULL").Scan(&at)
	return at, err
}

// MailSent marks a row sent and blanks its data (codes and links leave the
// database as soon as the message is out).
func MailSent(ctx context.Context, q Q, id string, at int64) error {
	_, err := q.ExecContext(ctx, "UPDATE outbox SET sent = ?, data = '{}', error = NULL WHERE id = ?", at, id)
	return err
}

// MailRetry records a failed attempt: the row is tried again at next, or
// given up (sent = -1, data blanked) when next is 0.
func MailRetry(ctx context.Context, q Q, id string, next int64, msg string) error {
	if next == 0 {
		_, err := q.ExecContext(ctx, "UPDATE outbox SET tries = tries + 1, sent = -1, data = '{}', error = ? WHERE id = ?", msg, id)
		return err
	}
	_, err := q.ExecContext(ctx, "UPDATE outbox SET tries = tries + 1, send_after = ?, error = ? WHERE id = ?", next, msg, id)
	return err
}

// CountMail counts outbox rows of kind created after since, optionally for
// one recipient address or one user (empty = any).
func CountMail(ctx context.Context, q Q, kind, to, userID string, since int64) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM outbox WHERE kind = ? AND created > ? AND (? = '' OR to_email = ?) AND (? = '' OR user_id = ?)",
		kind, since, to, to, userID, userID).Scan(&n)
	return n, err
}

// ---- housekeeping ----

// HousekeepLimits are the windows Housekeep applies.
type HousekeepLimits struct {
	SessionIdleMs int64
}

// Housekeep deletes what has expired. It runs every 10 minutes and returns
// the public ids of the sessions it removed (their live streams end).
func (s *Store) Housekeep(ctx context.Context, now int64, l HousekeepLimits) ([]string, error) {
	var ids []string
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		day := int64(24 * 3600 * 1000)
		stmts := []struct {
			q    string
			args []any
		}{
			{"DELETE FROM challenges WHERE expires < ?", []any{now - day}},
			{"UPDATE link_requests SET status = 'expired' WHERE status = 'pending' AND expires < ?", []any{now}},
			{"DELETE FROM link_requests WHERE status <> 'pending' AND expires < ?", []any{now - day}},
			{"UPDATE invites SET status = 'expired' WHERE status = 'pending' AND expires < ?", []any{now}},
			{"DELETE FROM mail_rate WHERE at < ?", []any{now - day}},
			{"DELETE FROM verify_fail WHERE at < ?", []any{now - day}},
			{"DELETE FROM declared WHERE at < ?", []any{now - day}},
			{"DELETE FROM invite_sends WHERE at < ?", []any{now - day}},
			{"DELETE FROM outbox WHERE sent = -2 AND created < ?", []any{now - 3600*1000}},
			{"DELETE FROM outbox WHERE sent IS NOT NULL AND sent <> -2 AND created < ?", []any{now - 7*day}},
		}
		for _, st := range stmts {
			if _, err := tx.ExecContext(ctx, st.q, st.args...); err != nil {
				return err
			}
		}
		rows, err := tx.QueryContext(ctx, "DELETE FROM sessions WHERE expires <= ? OR last_seen + ? <= ? RETURNING id", now, l.SessionIdleMs, now)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	return ids, err
}
