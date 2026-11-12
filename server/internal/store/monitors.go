package store

import (
	"context"
	"database/sql"
	"errors"
)

// Monitors through the server (docs/SCOPE.md step 7h, migration 0005).

// Monitor is one site monitor: a PC an owner turned on.
type Monitor struct {
	ID         string // m_…, also its users and members rows
	SiteID     string
	Name       string
	ByUser     string
	ByEmail    string
	Created    int64
	IntervalMs int64
	LastReport int64 // 0 = never
	Stale      bool
	EncPub     string
	SigPub     string
}

const monitorCols = `m.id, m.site_id, m.name, m.by_user, coalesce(b.email_norm,''), m.created, m.interval_ms, coalesce(m.last_report,0), m.stale,
	coalesce(u.enc_pub,''), coalesce(u.sig_pub,'')`
const monitorFrom = ` FROM monitors m JOIN users u ON u.id = m.id LEFT JOIN users b ON b.id = m.by_user`

func scanMonitor(row interface{ Scan(...any) error }) (*Monitor, error) {
	m := &Monitor{}
	err := row.Scan(&m.ID, &m.SiteID, &m.Name, &m.ByUser, &m.ByEmail, &m.Created, &m.IntervalMs, &m.LastReport, &m.Stale, &m.EncPub, &m.SigPub)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// IsMonitorID tells a monitor's id from a person's.
func IsMonitorID(id string) bool { return len(id) > 2 && id[:2] == "m_" }

// InsertMonitor adds the monitor's users row (its keys), its waiting
// membership as 'monitor' (an owner's browser grants it with the roster and
// its wrap) and its monitors row with the token's hash.
func InsertMonitor(ctx context.Context, q Q, m *Monitor, tokenHash []byte) error {
	if _, err := q.ExecContext(ctx, "INSERT INTO users(id, email, email_norm, lang, server_role, enc_pub, sig_pub, keys_at, created) VALUES(?,?,?,?,?,?,?,?,?)",
		m.ID, m.ID, m.ID, "en", "member", m.EncPub, m.SigPub, m.Created, m.Created); err != nil {
		return err
	}
	if err := InsertMember(ctx, q, m.SiteID, m.ID, "monitor", "waiting", m.Created); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, "INSERT INTO monitors(id, site_id, name, by_user, created, token_hash, interval_ms) VALUES(?,?,?,?,?,?,?)",
		m.ID, m.SiteID, m.Name, m.ByUser, m.Created, tokenHash, m.IntervalMs)
	return err
}

// MonitorByToken finds the monitor whose credential this is.
func MonitorByToken(ctx context.Context, q Q, hash []byte) (*Monitor, error) {
	return scanMonitor(q.QueryRowContext(ctx, "SELECT "+monitorCols+monitorFrom+" WHERE m.token_hash = ? AND u.disabled = 0", hash))
}

// MonitorByID loads one monitor of a site.
func MonitorByID(ctx context.Context, q Q, site, id string) (*Monitor, error) {
	return scanMonitor(q.QueryRowContext(ctx, "SELECT "+monitorCols+monitorFrom+" WHERE m.site_id = ? AND m.id = ?", site, id))
}

// SiteMonitors lists a site's monitors, oldest first.
func SiteMonitors(ctx context.Context, q Q, site string) ([]Monitor, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+monitorCols+monitorFrom+" WHERE m.site_id = ? ORDER BY m.created, m.id", site)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Monitor
	for rows.Next() {
		m, err := scanMonitor(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// RevokeMonitor ends a monitor's credential (inside the rotation's
// transaction): its monitors row and its status go, its users row stays
// disabled, so the records it signed can still be checked.
func RevokeMonitor(ctx context.Context, q Q, site, id string) error {
	if _, err := q.ExecContext(ctx, "DELETE FROM monitors WHERE site_id = ? AND id = ?", site, id); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, "DELETE FROM site_records WHERE site_id = ? AND kind = 'status' AND author = ?", site, id); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, "UPDATE users SET disabled = 1 WHERE id = ?", id)
	return err
}

// MonitorReported is the heartbeat: last_report now, stale cleared.
// -> whether it was stale (so its return is announced once).
func MonitorReported(ctx context.Context, q Q, id string, now, intervalMs int64) (bool, error) {
	var stale bool
	err := q.QueryRowContext(ctx, "SELECT stale FROM monitors WHERE id = ?", id).Scan(&stale)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	_, err = q.ExecContext(ctx, "UPDATE monitors SET last_report = ?, interval_ms = CASE WHEN ? > 0 THEN ? ELSE interval_ms END, stale = 0 WHERE id = ?", now, intervalMs, intervalMs, id)
	return stale, err
}

// StaleMonitors marks the monitors that missed `missed` intervals (and had
// reported at least once, or were made that long ago) and returns them. A
// monitor never granted (its PC's enrolment did not finish) is not one
// that stopped reporting: it never started.
func StaleMonitors(ctx context.Context, q Q, now int64, missed int64) ([]Monitor, error) {
	rows, err := q.QueryContext(ctx, `UPDATE monitors SET stale = 1 WHERE stale = 0 AND coalesce(last_report, created) + interval_ms * ? < ?
		AND id IN (SELECT user_id FROM members WHERE site_id = monitors.site_id AND status = 'granted')
		RETURNING id, site_id`, missed, now)
	if err != nil {
		return nil, err
	}
	var ids [][2]string
	for rows.Next() {
		var id, site string
		if err := rows.Scan(&id, &site); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, [2]string{id, site})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []Monitor
	for _, p := range ids {
		m, err := MonitorByID(ctx, q, p[1], p[0])
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, nil
}

// ---- Records ----

// Record is one row of site_records.
type Record struct {
	N        int64
	SiteID   string
	Kind     string
	ID       string
	Author   string
	Epoch    int64
	At       int64
	Received int64
	Folded   bool
	Body     string // the record's JSON as sent
}

// ErrNotAuthor means a record with that key exists from someone else.
var ErrNotAuthor = errors.New("store: another author's record")

// ErrOlder means the record is not newer than the one kept.
var ErrOlder = errors.New("store: not newer than the record kept")

// PutRecord keeps r, replacing the one with its key when it is the same
// author's and newer (a new n, folded cleared). -> the new n.
func PutRecord(ctx context.Context, q Q, r *Record) (int64, error) {
	var author string
	var at int64
	err := q.QueryRowContext(ctx, "SELECT author, at FROM site_records WHERE site_id = ? AND kind = ? AND id = ?", r.SiteID, r.Kind, r.ID).Scan(&author, &at)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return 0, err
	case author != r.Author:
		return 0, ErrNotAuthor
	case r.At <= at:
		return 0, ErrOlder
	default:
		if _, err := q.ExecContext(ctx, "DELETE FROM site_records WHERE site_id = ? AND kind = ? AND id = ?", r.SiteID, r.Kind, r.ID); err != nil {
			return 0, err
		}
	}
	var n int64
	err = q.QueryRowContext(ctx, `INSERT INTO site_records(site_id, kind, id, author, epoch, at, received, record) VALUES(?,?,?,?,?,?,?,?) RETURNING n`,
		r.SiteID, r.Kind, r.ID, r.Author, r.Epoch, r.At, r.Received, r.Body).Scan(&n)
	return n, err
}

// RecordsSince lists a site's records with n > since, oldest first, of the
// kinds given (all when none), at most limit.
func RecordsSince(ctx context.Context, q Q, site string, since int64, unfoldedOnly bool, limit int) ([]Record, error) {
	query := "SELECT n, site_id, kind, id, author, epoch, at, received, folded, record FROM site_records WHERE site_id = ? AND n > ?"
	if unfoldedOnly {
		query += " AND folded = 0 AND kind <> 'status'"
	}
	query += " ORDER BY n LIMIT ?"
	rows, err := q.QueryContext(ctx, query, site, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Record
	for rows.Next() {
		var r Record
		if err := rows.Scan(&r.N, &r.SiteID, &r.Kind, &r.ID, &r.Author, &r.Epoch, &r.At, &r.Received, &r.Folded, &r.Body); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CountRecords counts a site's records other than status.
func CountRecords(ctx context.Context, q Q, site string) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM site_records WHERE site_id = ? AND kind <> 'status'", site).Scan(&n)
	return n, err
}

// FoldRecords marks records folded, each only while still the n given (a
// newer record of the same key was not folded). An issue folded takes the
// acts on it along (an act's id is "<issue>|<act>|<at>[|o]"). -> how many
// of the ns given.
func FoldRecords(ctx context.Context, q Q, site string, ns []int64) (int, error) {
	done := 0
	for _, n := range ns {
		var kind, id string
		err := q.QueryRowContext(ctx, "SELECT kind, id FROM site_records WHERE site_id = ? AND n = ? AND kind <> 'status'", site, n).Scan(&kind, &id)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return done, err
		}
		res, err := q.ExecContext(ctx, "UPDATE site_records SET folded = 1 WHERE site_id = ? AND n = ?", site, n)
		if err != nil {
			return done, err
		}
		k, _ := res.RowsAffected()
		done += int(k)
		if kind == "issue" {
			if _, err := q.ExecContext(ctx, "UPDATE site_records SET folded = 1 WHERE site_id = ? AND kind = 'act' AND folded = 0 AND substr(id, 1, ?) = ?",
				site, len(id)+1, id+"|"); err != nil {
				return done, err
			}
		}
	}
	return done, nil
}

// DropOldestFolded deletes up to n of a site's folded records, oldest
// first (the document holds them): room under the cap. -> how many.
func DropOldestFolded(ctx context.Context, q Q, site string, n int) (int64, error) {
	if n <= 0 {
		return 0, nil
	}
	res, err := q.ExecContext(ctx, `DELETE FROM site_records WHERE n IN (SELECT n FROM site_records WHERE site_id = ? AND folded = 1 AND kind <> 'status' ORDER BY n LIMIT ?)`, site, n)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ---- Statistics ----

// PutStats keeps a monitor's blob for a day (replacing the one there).
func PutStats(ctx context.Context, q Q, site, monitor string, day, now int64, body string) error {
	_, err := q.ExecContext(ctx, `INSERT INTO monitor_stats(site_id, monitor_id, day, received, record) VALUES(?,?,?,?,?)
		ON CONFLICT(site_id, monitor_id, day) DO UPDATE SET received = excluded.received, record = excluded.record`, site, monitor, day, now, body)
	return err
}

// StatsBlob is one stored day.
type StatsBlob struct {
	Monitor string
	Day     int64
	Body    string
}

// SiteStats lists the blobs of days from..to (inclusive), oldest first.
func SiteStats(ctx context.Context, q Q, site string, from, to int64, limit int) ([]StatsBlob, error) {
	rows, err := q.QueryContext(ctx, "SELECT monitor_id, day, record FROM monitor_stats WHERE site_id = ? AND day >= ? AND day <= ? ORDER BY day, monitor_id LIMIT ?", site, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StatsBlob
	for rows.Next() {
		var b StatsBlob
		if err := rows.Scan(&b.Monitor, &b.Day, &b.Body); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// SiteStatsDays is the site's Keep statistics (0 = Off).
func SiteStatsDays(ctx context.Context, q Q, site string) (int64, error) {
	var d int64
	err := q.QueryRowContext(ctx, "SELECT stats_days FROM sites WHERE id = ?", site).Scan(&d)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return d, err
}

// SetSiteStatsDays changes it and deletes what falls outside (D162).
// -> the blobs deleted.
func SetSiteStatsDays(ctx context.Context, q Q, site string, days, now int64) (int64, error) {
	if _, err := q.ExecContext(ctx, "UPDATE sites SET stats_days = ? WHERE id = ?", days, site); err != nil {
		return 0, err
	}
	return PruneStats(ctx, q, site, now)
}

const dayMs = int64(24 * 3600 * 1000)

// StatsOlder counts the blobs a period of `days` would delete now.
func StatsOlder(ctx context.Context, q Q, site string, days, now int64) (int64, error) {
	var n int64
	cut := (now/dayMs)*dayMs - days*dayMs
	if days == 0 {
		cut = 1 << 62
	}
	err := q.QueryRowContext(ctx, "SELECT count(*) FROM monitor_stats WHERE site_id = ? AND day < ?", site, cut).Scan(&n)
	return n, err
}

// PruneStats applies the retention: days older than stats_days (counted
// from today's start) go, and everything when it is Off. site "" = all.
func PruneStats(ctx context.Context, q Q, site string, now int64) (int64, error) {
	today := (now / dayMs) * dayMs
	query := `DELETE FROM monitor_stats WHERE site_id IN (SELECT id FROM sites WHERE (? = '' OR id = ?))
		AND day < (SELECT CASE WHEN s.stats_days = 0 THEN 1 << 62 ELSE ? - s.stats_days * ? END FROM sites s WHERE s.id = monitor_stats.site_id)`
	res, err := q.ExecContext(ctx, query, site, site, today, dayMs)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// HousekeepRecords drops folded records after 30 days, and the statistics
// past each site's retention.
func HousekeepRecords(ctx context.Context, q Q, now int64) error {
	if _, err := q.ExecContext(ctx, "DELETE FROM site_records WHERE folded = 1 AND received < ?", now-30*dayMs); err != nil {
		return err
	}
	_, err := PruneStats(ctx, q, "", now)
	return err
}

// UnfoldedRecords is what a backup carries beside the document (D159).
func UnfoldedRecords(ctx context.Context, q Q, site string, limit int) ([]string, error) {
	rs, err := RecordsSince(ctx, q, site, 0, true, limit)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rs))
	for _, r := range rs {
		out = append(out, r.Body)
	}
	return out, nil
}
