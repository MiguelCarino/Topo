// The statistics of the answer checks on this PC (docs/SCOPE.md D161-D163,
// step 7f): a local SQLite file (rusqlite with SQLite bundled) holding
//
//   samples  one per check: when, answered or not, the round-trip time, the
//            reply's status, the state after it (up, slow, down, quiet,
//            unknown), whether the state was down because of something
//            upstream, the check's interval and how it was asked (icmp, or
//            tcp for "TCP, not ping"). Kept 7 days whatever the setting:
//            they are the source of the hourly figures.
//   hourly   per item, monitor and hour: checks, answered, failed (loss),
//            the minimum, median, 95th percentile and maximum round-trip
//            time, the jitter (the mean difference between consecutive
//            round-trip times), and the seconds in each state: up, slow,
//            down (and of those, down because of something upstream),
//            maintenance (quiet) and unknown, and how many of the checks
//            were a ping asked over TCP ("TCP, not ping", which the reports
//            say, step 7j). Kept for the retention setting (360 days by
//            default, D135, D162).
//
// The figures are worked out by plain functions (hourly, daily,
// availability), tested on known samples below. The time between two
// samples belongs to the state of the first, unless the gap is longer than
// 2.5 intervals (the PC was off or asleep): then one interval is that state
// and the rest is unknown. Unknown time never counts as down (D157), and
// availability leaves out maintenance and unknown time, with the coverage
// beside it (D163).
//
// "Off" (retention 0) keeps nothing: the monitor writes no sample (it
// never calls add_sample) and turning it off empties this file.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub const HOUR_MS: i64 = 3_600_000;
pub const DAY_MS: i64 = 24 * HOUR_MS;
/// Samples stay this long, whatever the retention (D162).
pub const SAMPLE_DAYS: i64 = 7;
pub const RETENTION_DEFAULT_DAYS: u32 = 360;
/// The longest retention offered (ten years).
pub const RETENTION_MAX_DAYS: u32 = 3650;
/// This PC, until it is a monitor with a name of its own (7h).
pub const LOCAL_MONITOR: &str = "local";
/// A gap longer than this many intervals is the PC away, not the state.
const GAP_INTERVALS: f64 = 2.5;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    /// Unix milliseconds.
    pub t: i64,
    pub ok: bool,
    pub rtt: Option<f64>,
    pub status: String,
    /// up, slow, down, quiet or unknown, after this check.
    pub state: String,
    /// Down because of a device upstream (root cause, D161).
    pub upstream: bool,
    /// The check's interval, milliseconds.
    pub iv: i64,
    /// "icmp", "tcp" (a ping asked over TCP) or "".
    pub via: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hourly {
    /// The hour's start, unix milliseconds (the day's, for daily figures).
    pub hour: i64,
    pub checks: u32,
    pub ok: u32,
    pub fail: u32,
    pub rtt_min: Option<f64>,
    pub rtt_med: Option<f64>,
    pub rtt_p95: Option<f64>,
    pub rtt_max: Option<f64>,
    pub jitter: Option<f64>,
    pub s_up: f64,
    pub s_slow: f64,
    pub s_down: f64,
    pub s_upstream: f64,
    pub s_maint: f64,
    pub s_unknown: f64,
    /// How many of the checks were a ping asked over TCP (D155: "TCP, not
    /// ping" wherever it shows, the reports too). Left out when none.
    #[serde(skip_serializing_if = "is_zero")]
    pub tcp: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

pub fn floor_hour(t: i64) -> i64 {
    t.div_euclid(HOUR_MS) * HOUR_MS
}

/// The nearest-rank percentile of sorted values (p in 0..=100).
pub fn percentile(sorted: &[f64], p: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let rank = ((p / 100.0) * sorted.len() as f64).ceil() as usize;
    Some(sorted[rank.clamp(1, sorted.len()) - 1])
}

fn add_state(h: &mut Hourly, state: &str, upstream: bool, secs: f64) {
    if secs <= 0.0 {
        return;
    }
    match state {
        "up" => h.s_up += secs,
        "slow" => h.s_slow += secs,
        "down" => {
            h.s_down += secs;
            if upstream {
                h.s_upstream += secs;
            }
        }
        "quiet" => h.s_maint += secs,
        _ => h.s_unknown += secs,
    }
}

/// The figures of one hour of one item. `prev`: the last sample before the
/// hour; `inside`: the hour's samples, oldest first; `next_t`: when the
/// first sample after the hour was taken, else `now` bounds the last one.
pub fn hourly(hour: i64, prev: Option<&Sample>, inside: &[Sample], next_t: Option<i64>, now: i64) -> Hourly {
    let end = hour + HOUR_MS;
    let mut h = Hourly { hour, ..Default::default() };
    // The checks and their round-trip times.
    h.checks = inside.len() as u32;
    h.ok = inside.iter().filter(|s| s.ok).count() as u32;
    h.fail = h.checks - h.ok;
    h.tcp = inside.iter().filter(|s| s.via == "tcp").count() as u32;
    let rtts: Vec<f64> = inside.iter().filter(|s| s.ok).filter_map(|s| s.rtt).collect();
    if !rtts.is_empty() {
        let mut sorted = rtts.clone();
        sorted.sort_by(|a, b| a.total_cmp(b));
        h.rtt_min = sorted.first().copied();
        h.rtt_max = sorted.last().copied();
        h.rtt_med = percentile(&sorted, 50.0);
        h.rtt_p95 = percentile(&sorted, 95.0);
        if rtts.len() > 1 {
            let d: f64 = rtts.windows(2).map(|w| (w[1] - w[0]).abs()).sum();
            h.jitter = Some(round2(d / (rtts.len() - 1) as f64));
        }
    }
    // The seconds in each state, segment by segment.
    let points: Vec<&Sample> = prev.into_iter().chain(inside.iter()).collect();
    let first_t = points.first().map(|s| s.t.max(hour)).unwrap_or(end);
    if points.first().map(|s| s.t > hour).unwrap_or(true) {
        add_state(&mut h, "unknown", false, (first_t.min(end) - hour) as f64 / 1000.0);
    }
    for (i, s) in points.iter().enumerate() {
        let seg_end = points.get(i + 1).map(|n| n.t).or(next_t).unwrap_or(now).max(s.t);
        let reach = s.t + (if (seg_end - s.t) as f64 <= GAP_INTERVALS * s.iv as f64 { seg_end - s.t } else { s.iv });
        // [s.t, reach) is the sample's state, [reach, seg_end) unknown.
        let clip = |a: i64, b: i64| (b.min(end) - a.max(hour)).max(0) as f64 / 1000.0;
        add_state(&mut h, &s.state, s.upstream, clip(s.t, reach));
        add_state(&mut h, "unknown", false, clip(reach, seg_end));
    }
    // What no sample reaches (the hour still running is cut at now).
    let counted = h.s_up + h.s_slow + h.s_down + h.s_maint + h.s_unknown;
    let span = ((end.min(now.max(hour))) - hour) as f64 / 1000.0;
    if span > counted {
        h.s_unknown += span - counted;
    }
    h
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// A day (or any span) from its hours: sums, the extremes, and the medians
/// and 95th percentiles of the hours weighted by their answered checks (the
/// samples behind them are gone after 7 days).
#[allow(dead_code)] // the server blobs (7h) and the reports (7j)
pub fn daily(day: i64, hours: &[Hourly]) -> Hourly {
    let mut d = Hourly { hour: day, ..Default::default() };
    let mut meds = Vec::new();
    let mut p95s = Vec::new();
    let mut jit = (0.0, 0u32);
    for h in hours {
        d.checks += h.checks;
        d.ok += h.ok;
        d.fail += h.fail;
        d.tcp += h.tcp;
        d.rtt_min = match (d.rtt_min, h.rtt_min) { (Some(a), Some(b)) => Some(a.min(b)), (a, b) => a.or(b) };
        d.rtt_max = match (d.rtt_max, h.rtt_max) { (Some(a), Some(b)) => Some(a.max(b)), (a, b) => a.or(b) };
        if let Some(m) = h.rtt_med {
            meds.push((m, h.ok));
        }
        if let Some(p) = h.rtt_p95 {
            p95s.push((p, h.ok));
        }
        if let Some(j) = h.jitter {
            jit.0 += j * h.ok as f64;
            jit.1 += h.ok;
        }
        d.s_up += h.s_up;
        d.s_slow += h.s_slow;
        d.s_down += h.s_down;
        d.s_upstream += h.s_upstream;
        d.s_maint += h.s_maint;
        d.s_unknown += h.s_unknown;
    }
    let weighted = |mut v: Vec<(f64, u32)>, p: f64| -> Option<f64> {
        v.retain(|x| x.1 > 0);
        if v.is_empty() {
            return None;
        }
        v.sort_by(|a, b| a.0.total_cmp(&b.0));
        let total: u32 = v.iter().map(|x| x.1).sum();
        let want = ((p / 100.0) * total as f64).ceil().max(1.0) as u32;
        let mut acc = 0;
        for (x, w) in &v {
            acc += w;
            if acc >= want {
                return Some(*x);
            }
        }
        v.last().map(|x| x.0)
    };
    d.rtt_med = weighted(meds, 50.0);
    d.rtt_p95 = weighted(p95s, 95.0);
    if jit.1 > 0 {
        d.jitter = Some(round2(jit.0 / jit.1 as f64));
    }
    d
}

/// Availability = up / (up + down), maintenance and unknown time left out
/// (slow is up); the coverage is the share of `span_s` that was measured
/// (hours with no figures at all count as unknown). (None, 0) when nothing
/// was measured.
#[allow(dead_code)] // the reports (7j)
pub fn availability(hours: &[Hourly], span_s: f64) -> (Option<f64>, f64) {
    let up: f64 = hours.iter().map(|h| h.s_up + h.s_slow).sum();
    let down: f64 = hours.iter().map(|h| h.s_down).sum();
    let maint: f64 = hours.iter().map(|h| h.s_maint).sum();
    let measured = up + down + maint;
    let coverage = if span_s > 0.0 { (measured / span_s).min(1.0) } else { 0.0 };
    let avail = if up + down > 0.0 { Some(up / (up + down)) } else { None };
    (avail, coverage)
}

// ---- The file ----

pub struct Stats {
    conn: Connection,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS samples (
  key TEXT NOT NULL, t INTEGER NOT NULL, ok INTEGER NOT NULL, rtt REAL,
  status TEXT NOT NULL, state TEXT NOT NULL, upstream INTEGER NOT NULL,
  iv INTEGER NOT NULL, via TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS samples_kt ON samples (key, t);
CREATE TABLE IF NOT EXISTS hourly (
  monitor TEXT NOT NULL, key TEXT NOT NULL, hour INTEGER NOT NULL,
  checks INTEGER NOT NULL, ok INTEGER NOT NULL, fail INTEGER NOT NULL,
  rtt_min REAL, rtt_med REAL, rtt_p95 REAL, rtt_max REAL, jitter REAL,
  s_up REAL NOT NULL, s_slow REAL NOT NULL, s_down REAL NOT NULL,
  s_upstream REAL NOT NULL, s_maint REAL NOT NULL, s_unknown REAL NOT NULL,
  tcp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor, key, hour)
);
CREATE TABLE IF NOT EXISTS rolled (key TEXT PRIMARY KEY, until INTEGER NOT NULL);
";
/// The file's version: 1 (7f), 2 (7j: hourly.tcp).
const SCHEMA_VERSION: i64 = 2;

/// Makes the tables, and brings a file from an earlier version up to this
/// one: version 1 had no `tcp` column (its hours read 0, which is what they
/// knew).
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)?;
    let has_tcp = {
        let mut st = conn.prepare("SELECT name FROM pragma_table_info('hourly')")?;
        let names = st.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        names.iter().any(|n| n == "tcp")
    };
    if !has_tcp {
        conn.execute_batch("ALTER TABLE hourly ADD COLUMN tcp INTEGER NOT NULL DEFAULT 0;")?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

fn sample_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Sample> {
    Ok(Sample {
        t: r.get(0)?,
        ok: r.get::<_, i64>(1)? != 0,
        rtt: r.get(2)?,
        status: r.get(3)?,
        state: r.get(4)?,
        upstream: r.get::<_, i64>(5)? != 0,
        iv: r.get(6)?,
        via: r.get(7)?,
    })
}
const SAMPLE_COLS: &str = "t, ok, rtt, status, state, upstream, iv, via";

#[allow(dead_code)]
fn hourly_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Hourly> {
    Ok(Hourly {
        hour: r.get(0)?,
        checks: r.get(1)?,
        ok: r.get(2)?,
        fail: r.get(3)?,
        rtt_min: r.get(4)?,
        rtt_med: r.get(5)?,
        rtt_p95: r.get(6)?,
        rtt_max: r.get(7)?,
        jitter: r.get(8)?,
        s_up: r.get(9)?,
        s_slow: r.get(10)?,
        s_down: r.get(11)?,
        s_upstream: r.get(12)?,
        s_maint: r.get(13)?,
        s_unknown: r.get(14)?,
        tcp: r.get(15)?,
    })
}

/// How much a shorter retention would delete (D162's confirmation).
#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Older {
    /// Hourly figures older than the new period.
    pub hours: u64,
    /// The items they are of.
    pub items: u64,
    /// The oldest figure kept now (unix ms), if any.
    pub oldest: Option<i64>,
    /// Samples (only counted for Off, which deletes them too).
    pub samples: u64,
}

impl Stats {
    pub fn open(path: &Path) -> rusqlite::Result<Stats> {
        // Readable by this user only (D234): the folder 0700 and the file
        // made 0600 before SQLite opens it, so its -wal and -shm (which
        // SQLite creates with the database's mode) are private too.
        #[cfg(unix)]
        {
            use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
            if let Some(dir) = path.parent() {
                let _ = std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir);
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
            let _ = std::fs::OpenOptions::new().create(true).truncate(false).write(true).mode(0o600).open(path);
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
            for side in ["-wal", "-shm"] {
                let mut p = path.as_os_str().to_owned();
                p.push(side);
                let _ = std::fs::set_permissions(std::path::Path::new(&p), std::fs::Permissions::from_mode(0o600));
            }
        }
        #[cfg(not(unix))]
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        migrate(&conn)?;
        Ok(Stats { conn })
    }

    #[allow(dead_code)] // the tests
    pub fn memory() -> rusqlite::Result<Stats> {
        let conn = Connection::open_in_memory()?;
        migrate(&conn)?;
        Ok(Stats { conn })
    }

    pub fn add_sample(&self, key: &str, s: &Sample) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO samples (key, t, ok, rtt, status, state, upstream, iv, via) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![key, s.t, s.ok as i64, s.rtt, s.status, s.state, s.upstream as i64, s.iv, s.via],
        )?;
        Ok(())
    }

    /// One item's samples from `since` (unix ms), oldest first.
    pub fn samples(&self, key: &str, since: i64) -> rusqlite::Result<Vec<Sample>> {
        let mut st = self.conn.prepare_cached(&format!("SELECT {SAMPLE_COLS} FROM samples WHERE key = ?1 AND t >= ?2 ORDER BY t"))?;
        let rows = st.query_map(params![key, since], sample_row)?;
        rows.collect()
    }

    #[allow(dead_code)] // the reports (7j)
    pub fn hours(&self, key: &str, from: i64, to: i64) -> rusqlite::Result<Vec<Hourly>> {
        let mut st = self.conn.prepare_cached(
            "SELECT hour, checks, ok, fail, rtt_min, rtt_med, rtt_p95, rtt_max, jitter, s_up, s_slow, s_down, s_upstream, s_maint, s_unknown, tcp
             FROM hourly WHERE monitor = ?1 AND key = ?2 AND hour >= ?3 AND hour < ?4 ORDER BY hour",
        )?;
        let rows = st.query_map(params![LOCAL_MONITOR, key, from, to], hourly_row)?;
        rows.collect()
    }

    fn put_hour(&self, key: &str, h: &Hourly) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO hourly (monitor, key, hour, checks, ok, fail, rtt_min, rtt_med, rtt_p95, rtt_max, jitter, s_up, s_slow, s_down, s_upstream, s_maint, s_unknown, tcp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![LOCAL_MONITOR, key, h.hour, h.checks, h.ok, h.fail, h.rtt_min, h.rtt_med, h.rtt_p95, h.rtt_max, h.jitter, h.s_up, h.s_slow, h.s_down, h.s_upstream, h.s_maint, h.s_unknown, h.tcp],
        )?;
        Ok(())
    }

    /// Works out the hourly figures of every hour that has ended since the
    /// last time, from the samples. An hour that no sample reaches is not
    /// written (a report counts a missing hour as unknown). Returns how many
    /// hours were written.
    pub fn rollup(&self, now: i64) -> rusqlite::Result<usize> {
        let current = floor_hour(now);
        let keys: Vec<(String, i64)> = {
            let mut st = self.conn.prepare("SELECT key, MIN(t) FROM samples GROUP BY key")?;
            let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let mut written = 0;
        for (key, first) in keys {
            let from: i64 = self
                .conn
                .query_row("SELECT until FROM rolled WHERE key = ?1", params![key], |r| r.get(0))
                .optional()?
                .unwrap_or_else(|| floor_hour(first));
            if from >= current {
                continue;
            }
            let tx = self.conn.unchecked_transaction()?;
            let mut hour = from;
            while hour < current {
                let prev = self
                    .conn
                    .query_row(&format!("SELECT {SAMPLE_COLS} FROM samples WHERE key = ?1 AND t < ?2 ORDER BY t DESC LIMIT 1"), params![key, hour], sample_row)
                    .optional()?;
                let inside = {
                    let mut st = self.conn.prepare_cached(&format!("SELECT {SAMPLE_COLS} FROM samples WHERE key = ?1 AND t >= ?2 AND t < ?3 ORDER BY t"))?;
                    let rows = st.query_map(params![key, hour, hour + HOUR_MS], sample_row)?;
                    rows.collect::<rusqlite::Result<Vec<_>>>()?
                };
                let next_t: Option<i64> = self
                    .conn
                    .query_row("SELECT MIN(t) FROM samples WHERE key = ?1 AND t >= ?2", params![key, hour + HOUR_MS], |r| r.get(0))
                    .optional()?
                    .flatten();
                let h = hourly(hour, prev.as_ref(), &inside, next_t, now);
                if !inside.is_empty() || h.s_unknown < 3600.0 {
                    self.put_hour(&key, &h)?;
                    written += 1;
                }
                hour += HOUR_MS;
            }
            self.conn.execute("INSERT OR REPLACE INTO rolled (key, until) VALUES (?1, ?2)", params![key, current])?;
            tx.commit()?;
        }
        Ok(written)
    }

    /// Samples older than 7 days and figures older than `retention_days`
    /// go. Returns (samples, hours) deleted.
    pub fn prune(&self, now: i64, retention_days: u32) -> rusqlite::Result<(usize, usize)> {
        let s = self.conn.execute("DELETE FROM samples WHERE t < ?1", params![now - SAMPLE_DAYS * DAY_MS])?;
        let h = self.conn.execute("DELETE FROM hourly WHERE hour < ?1", params![now - retention_days as i64 * DAY_MS])?;
        Ok((s, h))
    }

    /// What a retention of `days` would delete now (0: Off, everything).
    pub fn older(&self, now: i64, days: u32) -> rusqlite::Result<Older> {
        let cut = if days == 0 { i64::MAX } else { now - days as i64 * DAY_MS };
        let (hours, items): (i64, i64) = self.conn.query_row("SELECT COUNT(*), COUNT(DISTINCT key) FROM hourly WHERE hour < ?1", params![cut], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let oldest: Option<i64> = self.conn.query_row("SELECT MIN(hour) FROM hourly", [], |r| r.get(0))?;
        let samples: i64 = if days == 0 { self.conn.query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))? } else { 0 };
        Ok(Older { hours: hours as u64, items: items as u64, oldest, samples: samples as u64 })
    }

    /// Expected (an issue's act, step 7g, D158): the down time of these
    /// checks from `from` to `to` becomes maintenance. The samples are
    /// relabelled and their hours worked out again; hours older than the
    /// samples kept (7 days) have their down seconds moved to maintenance
    /// as they stand. Down because of a device upstream is left as it is.
    /// Returns the samples relabelled.
    pub fn mark_maintenance(&self, keys: &[String], from: i64, to: i64) -> rusqlite::Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        let mut n = 0;
        for key in keys {
            n += self.conn.execute(
                "UPDATE samples SET state = 'quiet' WHERE key = ?1 AND t >= ?2 AND t <= ?3 AND state = 'down' AND upstream = 0",
                params![key, from, to],
            )?;
            // The last sample before the outage began carries its state
            // into the hour too: the hours are worked out again from there.
            let h0 = floor_hour(from);
            let first: Option<i64> = self.conn.query_row("SELECT MIN(t) FROM samples WHERE key = ?1", params![key], |r| r.get(0))?;
            let kept_from = first.map(floor_hour).unwrap_or(i64::MAX).max(h0);
            // Hours older than the samples kept: only those the span covers
            // (an issue's outages are marked one by one, D255).
            let old_until = kept_from.min(floor_hour(to).saturating_add(HOUR_MS));
            self.conn.execute(
                "UPDATE hourly SET s_maint = s_maint + (s_down - s_upstream), s_down = s_upstream WHERE monitor = ?1 AND key = ?2 AND hour >= ?3 AND hour < ?4",
                params![LOCAL_MONITOR, key, h0, old_until],
            )?;
            self.conn.execute("UPDATE rolled SET until = MIN(until, ?2) WHERE key = ?1", params![key, kept_from])?;
        }
        tx.commit()?;
        Ok(n)
    }

    /// Off: nothing is kept.
    pub fn clear(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch("DELETE FROM samples; DELETE FROM hourly; DELETE FROM rolled;")?;
        let _ = self.conn.execute_batch("VACUUM;");
        Ok(())
    }

    #[allow(dead_code)] // the tests
    pub fn counts(&self) -> rusqlite::Result<(u64, u64)> {
        let s: i64 = self.conn.query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))?;
        let h: i64 = self.conn.query_row("SELECT COUNT(*) FROM hourly", [], |r| r.get(0))?;
        Ok((s as u64, h as u64))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_800_000_000_000 - (1_800_000_000_000 % HOUR_MS); // an hour's start
    const IV: i64 = 60_000;

    fn s(t: i64, ok: bool, rtt: Option<f64>, state: &str) -> Sample {
        Sample { t, ok, rtt, status: if ok { "echo".into() } else { "timeout".into() }, state: state.into(), upstream: false, iv: IV, via: "icmp".into() }
    }

    #[test]
    fn hour_from_known_samples() {
        // Every minute: up with 10, 20, 30, 40 ms, then two failures, then
        // down for the rest of the hour (54 more failures).
        let mut v = vec![s(T0, true, Some(10.0), "up"), s(T0 + IV, true, Some(20.0), "up"), s(T0 + 2 * IV, true, Some(30.0), "up"), s(T0 + 3 * IV, true, Some(40.0), "up")];
        v.push(s(T0 + 4 * IV, false, None, "up"));
        v.push(s(T0 + 5 * IV, false, None, "up"));
        for i in 6..60 {
            v.push(s(T0 + i * IV, false, None, "down"));
        }
        let h = hourly(T0, None, &v, Some(T0 + HOUR_MS), T0 + 2 * HOUR_MS);
        assert_eq!((h.checks, h.ok, h.fail), (60, 4, 56));
        assert_eq!(h.rtt_min, Some(10.0));
        assert_eq!(h.rtt_max, Some(40.0));
        assert_eq!(h.rtt_med, Some(20.0)); // nearest rank: the 2nd of 4
        assert_eq!(h.rtt_p95, Some(40.0));
        assert_eq!(h.jitter, Some(10.0));
        assert_eq!(h.s_up, 6.0 * 60.0);
        assert_eq!(h.s_down, 54.0 * 60.0);
        assert_eq!(h.s_unknown, 0.0);
        let total = h.s_up + h.s_slow + h.s_down + h.s_maint + h.s_unknown;
        assert_eq!(total, 3600.0);
    }

    #[test]
    fn gaps_are_unknown_never_down() {
        // Down at :00, then the PC sleeps until :30 (one interval counts as
        // down, the rest unknown), then up.
        let mut v = vec![s(T0, false, None, "down")];
        for i in 30..60 {
            v.push(s(T0 + i * IV, true, Some(5.0), "up"));
        }
        let h = hourly(T0, None, &v, Some(T0 + HOUR_MS), T0 + 2 * HOUR_MS);
        assert_eq!(h.s_down, 60.0);
        assert_eq!(h.s_unknown, 29.0 * 60.0);
        assert_eq!(h.s_up, 30.0 * 60.0);
        // Nothing before the first sample of the first hour: unknown.
        let v = vec![s(T0 + 10 * IV, true, Some(5.0), "up")];
        let h = hourly(T0, None, &v, Some(T0 + HOUR_MS + IV), T0 + 2 * HOUR_MS);
        assert_eq!(h.s_unknown, 10.0 * 60.0 + 49.0 * 60.0);
        assert_eq!(h.s_up, 60.0);
        // The previous hour's last sample reaches into this one.
        let prev = s(T0 - 30_000, true, Some(5.0), "up");
        let v = vec![s(T0 + 30_000, true, Some(5.0), "up")];
        let h = hourly(T0, Some(&prev), &v, Some(T0 + 90_000), T0 + 2 * HOUR_MS);
        assert_eq!(h.s_up, 90.0);
        assert_eq!(h.s_unknown, 3600.0 - 90.0);
    }

    #[test]
    fn maintenance_slow_and_upstream() {
        // A check every 10 minutes.
        let at = |m: i64, ok: bool, state: &str| Sample { iv: 10 * IV, ..s(T0 + m * IV, ok, if ok { Some(5.0) } else { None }, state) };
        let mut down_up = at(20, false, "down");
        down_up.upstream = true;
        let v = vec![at(0, true, "slow"), at(10, true, "quiet"), down_up, at(30, true, "up"), at(40, true, "up"), at(50, true, "up")];
        let h = hourly(T0, None, &v, Some(T0 + HOUR_MS), T0 + 2 * HOUR_MS);
        assert_eq!(h.s_slow, 600.0);
        assert_eq!(h.s_maint, 600.0);
        assert_eq!(h.s_down, 600.0);
        assert_eq!(h.s_upstream, 600.0);
        assert_eq!(h.s_up, 1800.0);
        // Availability leaves out maintenance and unknown; slow is up.
        let (a, cov) = availability(&[h], 3600.0);
        assert_eq!(a, Some(2400.0 / 3000.0));
        assert_eq!(cov, 1.0);
    }

    #[test]
    fn availability_and_coverage() {
        let h = Hourly { s_up: 3564.0, s_down: 36.0, ..Default::default() };
        let gone = Hourly { s_unknown: 3600.0, ..Default::default() };
        // One measured hour out of a day: 99 % with 1/24 coverage.
        let (a, cov) = availability(&[h.clone()], 86_400.0);
        assert_eq!(a, Some(0.99));
        assert!((cov - 1.0 / 24.0).abs() < 1e-9);
        let (a2, cov2) = availability(&[h, gone], 7200.0);
        assert_eq!(a2, Some(0.99));
        assert_eq!(cov2, 0.5);
        // Nothing measured: no availability at all, never 100 %.
        assert_eq!(availability(&[], 3600.0), (None, 0.0));
        let maint = Hourly { s_maint: 3600.0, ..Default::default() };
        assert_eq!(availability(&[maint], 3600.0), (None, 1.0));
    }

    #[test]
    fn daily_from_hours() {
        let a = Hourly { checks: 60, ok: 60, rtt_min: Some(2.0), rtt_med: Some(5.0), rtt_p95: Some(9.0), rtt_max: Some(12.0), jitter: Some(1.0), s_up: 3600.0, ..Default::default() };
        let b = Hourly { checks: 60, ok: 20, fail: 40, rtt_min: Some(1.0), rtt_med: Some(50.0), rtt_p95: Some(90.0), rtt_max: Some(99.0), jitter: Some(4.0), s_up: 1200.0, s_down: 2400.0, ..Default::default() };
        let d = daily(T0, &[a, b]);
        assert_eq!((d.checks, d.ok, d.fail), (120, 80, 40));
        assert_eq!(d.rtt_min, Some(1.0));
        assert_eq!(d.rtt_max, Some(99.0));
        assert_eq!(d.rtt_med, Some(5.0)); // 60 of 80 answers had 5
        assert_eq!(d.rtt_p95, Some(90.0));
        assert_eq!(d.jitter, Some(1.75));
        assert_eq!(d.s_down, 2400.0);
    }

    #[test]
    fn percentiles() {
        let v = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        assert_eq!(percentile(&v, 50.0), Some(5.0));
        assert_eq!(percentile(&v, 95.0), Some(10.0));
        assert_eq!(percentile(&v, 0.0), Some(1.0));
        assert_eq!(percentile(&[], 50.0), None);
        assert_eq!(percentile(&[7.0], 95.0), Some(7.0));
    }

    #[test]
    fn rollup_prune_and_retention() {
        let st = Stats::memory().unwrap();
        // Two hours of samples, one a minute.
        for i in 0..120 {
            st.add_sample("n1/c1", &s(T0 + i * IV, true, Some(10.0 + (i % 3) as f64), "up")).unwrap();
        }
        assert_eq!(st.rollup(T0 + 2 * HOUR_MS + 5 * IV).unwrap(), 2);
        // Nothing new to roll.
        assert_eq!(st.rollup(T0 + 2 * HOUR_MS + 6 * IV).unwrap(), 0);
        let hs = st.hours("n1/c1", T0, T0 + 3 * HOUR_MS).unwrap();
        assert_eq!(hs.len(), 2);
        assert_eq!(hs[0].checks, 60);
        assert_eq!(hs[0].s_up, 3600.0);
        // The second hour's last sample reaches only one interval past its
        // end (nothing after it, "now" is later): it is all up.
        assert_eq!(hs[1].s_up, 3600.0);
        assert_eq!(st.samples("n1/c1", T0 + HOUR_MS).unwrap().len(), 60);
        // A day later the samples are still there; 8 days later they go,
        // the figures stay.
        let (gone_s, gone_h) = st.prune(T0 + 8 * DAY_MS, RETENTION_DEFAULT_DAYS).unwrap();
        assert_eq!((gone_s, gone_h), (120, 0));
        assert_eq!(st.counts().unwrap(), (0, 2));
        // Shortening: what would go is counted first (the confirmation).
        let later = T0 + 40 * DAY_MS;
        let o = st.older(later, 30).unwrap();
        assert_eq!((o.hours, o.items, o.oldest), (2, 1, Some(T0)));
        assert_eq!(st.older(later, 360).unwrap().hours, 0);
        let (_, h) = st.prune(later, 30).unwrap();
        assert_eq!(h, 2);
        // Off: everything.
        st.add_sample("n1/c1", &s(later, true, Some(1.0), "up")).unwrap();
        assert_eq!(st.older(later, 0).unwrap().samples, 1);
        st.clear().unwrap();
        assert_eq!(st.counts().unwrap(), (0, 0));
    }

    #[test]
    fn file_on_disk() {
        let dir = std::env::temp_dir().join(format!("topo-stats-{}", std::process::id()));
        let path = dir.join("stats.sqlite");
        {
            let st = Stats::open(&path).unwrap();
            st.add_sample("a/b", &s(T0, true, Some(1.0), "up")).unwrap();
        }
        let st = Stats::open(&path).unwrap();
        assert_eq!(st.samples("a/b", 0).unwrap().len(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&path), 0o600);
            // The write-ahead log holds the latest samples: private too.
            st.add_sample("a/b", &s(T0 + 1, true, Some(1.0), "up")).unwrap();
            assert_eq!(mode(&dir.join("stats.sqlite-wal")), 0o600);
            assert_eq!(mode(&dir.join("stats.sqlite-shm")), 0o600);
            assert_eq!(mode(&dir), 0o700);
        }
        drop(st);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn tcp_not_ping_is_counted_and_carried() {
        // A ping that this PC could only ask over TCP (D155): the hour says
        // how many of its checks were, a day sums them, and the figure goes
        // out (monitor_figures, the server's blobs) only when there were any.
        let st = Stats::memory().unwrap();
        for i in 0..60 {
            let mut x = s(T0 + i * IV, true, Some(3.0), "up");
            if i >= 20 {
                x.via = "tcp".into();
            }
            st.add_sample("r/p", &x).unwrap();
        }
        st.add_sample("r/p", &s(T0 + HOUR_MS, true, Some(3.0), "up")).unwrap();
        st.rollup(T0 + HOUR_MS + IV).unwrap();
        let h = st.hours("r/p", T0, T0 + HOUR_MS).unwrap();
        assert_eq!((h[0].checks, h[0].tcp), (60, 40));
        assert_eq!(daily(T0, &[h[0].clone(), h[0].clone()]).tcp, 80);
        let json = serde_json::to_value(&h[0]).unwrap();
        assert_eq!(json["tcp"], 40);
        let none = serde_json::to_value(Hourly::default()).unwrap();
        assert!(none.get("tcp").is_none(), "{none}");
    }

    #[test]
    fn a_version_1_file_is_brought_up() {
        // A file from 7f (user_version 1, no tcp column) opens, keeps its
        // figures (read as 0 over TCP) and takes new ones.
        let dir = std::env::temp_dir().join(format!("topo-stats-v1-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("stats.sqlite");
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE samples (key TEXT NOT NULL, t INTEGER NOT NULL, ok INTEGER NOT NULL, rtt REAL, status TEXT NOT NULL, state TEXT NOT NULL, upstream INTEGER NOT NULL, iv INTEGER NOT NULL, via TEXT NOT NULL);
                 CREATE TABLE hourly (monitor TEXT NOT NULL, key TEXT NOT NULL, hour INTEGER NOT NULL, checks INTEGER NOT NULL, ok INTEGER NOT NULL, fail INTEGER NOT NULL,
                   rtt_min REAL, rtt_med REAL, rtt_p95 REAL, rtt_max REAL, jitter REAL, s_up REAL NOT NULL, s_slow REAL NOT NULL, s_down REAL NOT NULL,
                   s_upstream REAL NOT NULL, s_maint REAL NOT NULL, s_unknown REAL NOT NULL, PRIMARY KEY (monitor, key, hour));
                 CREATE TABLE rolled (key TEXT PRIMARY KEY, until INTEGER NOT NULL);
                 PRAGMA user_version = 1;",
            )
            .unwrap();
            c.execute(
                "INSERT INTO hourly VALUES ('local', 'a/b', ?1, 60, 60, 0, 1, 2, 3, 4, 0.5, 3600, 0, 0, 0, 0, 0)",
                params![T0],
            )
            .unwrap();
        }
        let st = Stats::open(&path).unwrap();
        let h = st.hours("a/b", T0, T0 + HOUR_MS).unwrap();
        assert_eq!((h.len(), h[0].checks, h[0].tcp), (1, 60, 0));
        let v: i64 = st.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        drop(st);
        // Opened again: nothing to do, nothing lost.
        let st = Stats::open(&path).unwrap();
        assert_eq!(st.hours("a/b", T0, T0 + HOUR_MS).unwrap().len(), 1);
        drop(st);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn expected_becomes_maintenance() {
        let st = Stats::memory().unwrap();
        let h = 1_000 * HOUR_MS;
        let smp = |t: i64, state: &str, ok: bool| Sample { t, ok, rtt: if ok { Some(1.0) } else { None }, status: String::new(), state: state.into(), upstream: false, iv: 60_000, via: String::new() };
        // Up for 10 minutes, down for 20, up again, all in one hour.
        for m in 0..10 { st.add_sample("k", &smp(h + m * 60_000, "up", true)).unwrap(); }
        for m in 10..30 { st.add_sample("k", &smp(h + m * 60_000, "down", false)).unwrap(); }
        for m in 30..60 { st.add_sample("k", &smp(h + m * 60_000, "up", true)).unwrap(); }
        st.add_sample("k", &smp(h + HOUR_MS + 60_000, "up", true)).unwrap();
        st.rollup(h + 2 * HOUR_MS).unwrap();
        let before = st.hours("k", h, h + HOUR_MS).unwrap();
        assert!((before[0].s_down - 1200.0).abs() < 1.0, "{before:?}");
        let n = st.mark_maintenance(&["k".to_string()], h + 10 * 60_000, h + 29 * 60_000).unwrap();
        assert_eq!(n, 20);
        st.rollup(h + 2 * HOUR_MS).unwrap();
        let after = st.hours("k", h, h + HOUR_MS).unwrap();
        assert!(after[0].s_down.abs() < 1.0 && (after[0].s_maint - 1200.0).abs() < 1.0, "{after:?}");
        let (av, _) = availability(&after, 3600.0);
        assert_eq!(av, Some(1.0), "maintenance is left out of availability");
    }

}
