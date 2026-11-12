// The monitor on this PC (docs/SCOPE.md D129, D155-D157, step 7f): the
// schedule, the states and root cause. No Tauri here, so the tests drive it
// with a stand-in for the checks.
//
// The page decides what to check (js/checks.js monitorPlan): each check
// block of the network being monitored, as an Item with its address, port
// and options, its interval, "slow above", the devices between this PC and
// it (its upstream chain, nearest to this PC first) and the groups it is in.
// This file runs the schedule on a background thread with at most 8 checks
// at once, keeps each item's state, works out the root cause, and hands each
// change to a sink (the app emits it to the page, src/monitorcmd.rs) and
// each sample to the statistics (src/stats.rs).
//
// States (D157):
//   down      after 3 failures in a row;
//   up        after 2 answers in a row;
//   slow      up, with the median of the last 5 answers above "slow above"
//             (at least 3 answers); shown, never an alarm;
//   flapping  4 changes between up and down in 30 minutes: a mark on the
//             state, not a state of its own;
//   quiet     a quiet window (maintenance) on the item, a group it is in,
//             or the whole site: no state change is an outage, the time is
//             maintenance;
//   unknown   not known yet, the check cannot be asked from this PC, or
//             this PC was off or asleep for more than 2.5 intervals.
// Root cause (D161): a down item whose upstream chain holds a device that is
// down too (every check of that device down) is down "because" the nearest
// such device to this PC.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::mpsc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering as AtomicOrdering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::checks::{self, Outcome, Spec};
use crate::stats::{Sample, Stats};

pub const INTERVAL_DEFAULT_S: u32 = 60;
pub const INTERVAL_MIN_S: u32 = 30;
pub const INTERVAL_MAX_S: u32 = 900;
/// At most this many checks at once (step 7f).
pub const AT_ONCE: usize = 8;
/// The most items one plan takes.
pub const ITEMS_MAX: usize = 4000;
pub const DOWN_AFTER: u32 = 3;
pub const UP_AFTER: u32 = 2;
pub const SLOW_WINDOW: usize = 5;
pub const SLOW_MIN_ANSWERS: usize = 3;
pub const FLAP_CHANGES: usize = 4;
pub const FLAP_WINDOW_MS: i64 = 30 * 60_000;
/// More than this many intervals without a result: unknown.
pub const STALE_INTERVALS: f64 = 2.5;

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// One check of one device, as the page plans it.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Item {
    /// "<device id>/<check id>".
    pub key: String,
    pub node_id: String,
    /// The device's name and the check's label, for the tray's tooltip.
    pub name: String,
    /// The device's name alone (an issue's, step 7g).
    pub node_name: String,
    pub spec: Spec,
    pub interval_s: u32,
    /// Milliseconds; 0 is no "slow above".
    pub slow_ms: u32,
    /// The devices between this PC and this one, nearest to this PC first.
    pub chain: Vec<String>,
    /// The groups it is in, innermost first (for their quiet windows).
    pub groups: Vec<String>,
    /// The interval in milliseconds (set by normalize; the tests shorten it).
    #[serde(skip)]
    pub interval_ms: i64,
}

/// The plan as the page sends it: the network watched and its checks.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Plan {
    pub network_id: String,
    pub network_name: String,
    pub items: Vec<Item>,
}

/// The items made safe: a known protocol, an interval within 30 s to
/// 15 min (60 s when none), one item per key, at most ITEMS_MAX.
pub fn normalize(items: Vec<Item>) -> Vec<Item> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for mut it in items {
        if it.key.is_empty() || it.key.len() > 200 || !seen.insert(it.key.clone()) {
            continue;
        }
        if !checks::PROTOCOLS.contains(&it.spec.proto.as_str()) {
            continue;
        }
        it.interval_s = if it.interval_s == 0 { INTERVAL_DEFAULT_S } else { it.interval_s.clamp(INTERVAL_MIN_S, INTERVAL_MAX_S) };
        it.interval_ms = it.interval_s as i64 * 1000;
        it.slow_ms = it.slow_ms.min(600_000);
        it.chain.truncate(64);
        it.groups.truncate(32);
        it.name.truncate(200);
        it.node_name.truncate(200);
        out.push(it);
        if out.len() >= ITEMS_MAX {
            break;
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Unknown,
    Up,
    Down,
}

/// One item's state, check by check.
#[derive(Clone, Debug)]
pub struct Track {
    pub phase: Phase,
    pub fails: u32,
    pub oks: u32,
    pub rtts: VecDeque<f64>,
    /// When the phase went between up and down (for flapping).
    pub changes: VecDeque<i64>,
    pub slow: bool,
    pub flapping: bool,
    /// When the phase started.
    pub since: i64,
    /// When the last result came.
    pub last_t: Option<i64>,
    pub last: Option<Outcome>,
}

impl Track {
    pub fn new(now: i64) -> Track {
        Track { phase: Phase::Unknown, fails: 0, oks: 0, rtts: VecDeque::new(), changes: VecDeque::new(), slow: false, flapping: false, since: now, last_t: None, last: None }
    }

    fn set_phase(&mut self, p: Phase, now: i64) {
        if p == self.phase {
            return;
        }
        if matches!((self.phase, p), (Phase::Up, Phase::Down) | (Phase::Down, Phase::Up)) {
            self.changes.push_back(now);
        }
        self.phase = p;
        self.since = now;
    }

    /// One result. `slow_ms` 0: no "slow above".
    pub fn apply(&mut self, o: &Outcome, now: i64, slow_ms: u32) {
        self.last_t = Some(now);
        self.last = Some(o.clone());
        if o.skipped {
            self.fails = 0;
            self.oks = 0;
            self.set_phase(Phase::Unknown, now);
        } else if o.ok {
            self.oks += 1;
            self.fails = 0;
            if let Some(r) = o.rtt_ms {
                self.rtts.push_back(r);
                while self.rtts.len() > SLOW_WINDOW {
                    self.rtts.pop_front();
                }
            }
            if self.phase != Phase::Up && self.oks >= UP_AFTER {
                self.set_phase(Phase::Up, now);
            }
        } else {
            self.fails += 1;
            self.oks = 0;
            if self.phase != Phase::Down && self.fails >= DOWN_AFTER {
                self.set_phase(Phase::Down, now);
            }
        }
        self.slow = slow_ms > 0 && self.rtts.len() >= SLOW_MIN_ANSWERS && median(&self.rtts) > slow_ms as f64;
        while self.changes.front().map(|t| now - t > FLAP_WINDOW_MS).unwrap_or(false) {
            self.changes.pop_front();
        }
        self.flapping = self.changes.len() >= FLAP_CHANGES;
    }

    /// No result for more than 2.5 intervals (this PC was off or asleep):
    /// unknown again, counting from scratch. True when it changed.
    pub fn stale(&mut self, now: i64, interval_ms: i64) -> bool {
        let Some(t) = self.last_t else { return false };
        if self.phase != Phase::Unknown && (now - t) as f64 > STALE_INTERVALS * interval_ms as f64 {
            self.fails = 0;
            self.oks = 0;
            self.rtts.clear();
            self.slow = false;
            self.set_phase(Phase::Unknown, now);
            return true;
        }
        false
    }
}

fn median(v: &VecDeque<f64>) -> f64 {
    let mut s: Vec<f64> = v.iter().copied().collect();
    s.sort_by(|a, b| a.total_cmp(b));
    let n = s.len();
    if n == 0 {
        return 0.0;
    }
    if n % 2 == 1 { s[n / 2] } else { (s[n / 2 - 1] + s[n / 2]) / 2.0 }
}

/// Quiet windows (maintenance): until when, unix ms, per device, group and
/// the whole site. Kept by this PC (D227).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Quiet {
    pub site: i64,
    pub nodes: HashMap<String, i64>,
    pub groups: HashMap<String, i64>,
}

impl Quiet {
    pub fn until(&self, it: &Item) -> i64 {
        let mut u = self.site;
        if let Some(t) = self.nodes.get(&it.node_id) {
            u = u.max(*t);
        }
        for g in &it.groups {
            if let Some(t) = self.groups.get(g) {
                u = u.max(*t);
            }
        }
        u
    }
    #[allow(dead_code)] // the issues (7g): no issue while quiet
    pub fn is_quiet(&self, it: &Item, now: i64) -> bool {
        self.until(it) > now
    }
    /// Ended windows go.
    pub fn prune(&mut self, now: i64) {
        if self.site <= now {
            self.site = 0;
        }
        self.nodes.retain(|_, t| *t > now);
        self.groups.retain(|_, t| *t > now);
    }
}

/// What the page is told about one item.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub key: String,
    pub node_id: String,
    /// up, down, unknown or quiet.
    pub state: String,
    pub slow: bool,
    pub flapping: bool,
    /// The device upstream this one is down because of.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
    pub since: i64,
    pub checked: Option<i64>,
    pub rtt_ms: Option<f64>,
    pub status: String,
    pub via: String,
    pub cert_not_after: Option<i64>,
    /// ntp: the clock offset of the last answer (step 7k).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_ms: Option<f64>,
    pub quiet_until: Option<i64>,
    /// Down, but its issue was closed as Expected (maintenance or planned
    /// work, step 7g): shown and recorded as quiet until it answers again.
    pub expected: bool,
}

impl Status {
    /// The state a sample records: quiet, slow (up and slow), up, down or
    /// unknown.
    pub fn sample_state(&self) -> &str {
        match self.state.as_str() {
            "up" if self.slow => "slow",
            s => s,
        }
    }
}

/// Root causes: for each down item, the nearest device in its chain whose
/// every check is down.
pub fn root_causes(items: &[Item], tracks: &HashMap<String, Track>) -> HashMap<String, String> {
    let mut node_all_down: HashMap<&str, bool> = HashMap::new();
    for it in items {
        let down = tracks.get(&it.key).map(|t| t.phase == Phase::Down).unwrap_or(false);
        let e = node_all_down.entry(it.node_id.as_str()).or_insert(true);
        *e = *e && down;
    }
    let mut out = HashMap::new();
    for it in items {
        if tracks.get(&it.key).map(|t| t.phase != Phase::Down).unwrap_or(true) {
            continue;
        }
        if let Some(c) = it.chain.iter().find(|c| c.as_str() != it.node_id && node_all_down.get(c.as_str()).copied().unwrap_or(false)) {
            out.insert(it.key.clone(), c.clone());
        }
    }
    // Never a loop (D237): a device is not down "because of" one that is
    // down because of it. Both are then their own outage.
    let node_cause: HashMap<String, String> = items
        .iter()
        .filter_map(|it| out.get(&it.key).map(|c| (it.node_id.clone(), c.clone())))
        .collect();
    out.retain(|key, cause| {
        let node = items.iter().find(|i| &i.key == key).map(|i| i.node_id.as_str()).unwrap_or("");
        node_cause.get(cause.as_str()).map(|s| s.as_str()) != Some(node)
    });
    out
}

#[allow(dead_code)] // the tests
pub fn status_of(it: &Item, t: &Track, cause: Option<&String>, quiet: &Quiet, now: i64) -> Status {
    status_masked(it, t, cause, quiet, false, now)
}

/// The status, with `expected`: the device's issue was closed as Expected
/// while its outage goes on, so down is quiet (maintenance, D158).
pub fn status_masked(it: &Item, t: &Track, cause: Option<&String>, quiet: &Quiet, expected: bool, now: i64) -> Status {
    let q = quiet.until(it);
    let masked = expected && t.phase == Phase::Down && q <= now;
    let state = if q > now || masked {
        "quiet"
    } else {
        match t.phase {
            Phase::Up => "up",
            Phase::Down => "down",
            Phase::Unknown => "unknown",
        }
    };
    let last = t.last.clone().unwrap_or_default();
    Status {
        key: it.key.clone(),
        node_id: it.node_id.clone(),
        state: state.into(),
        slow: t.slow && t.phase == Phase::Up,
        flapping: t.flapping,
        cause: if state == "down" { cause.cloned() } else { None },
        since: t.since,
        checked: t.last_t,
        rtt_ms: last.rtt_ms,
        status: last.status,
        via: last.via,
        cert_not_after: last.cert_not_after,
        offset_ms: last.offset_ms,
        quiet_until: if q > now { Some(q) } else { None },
        expected: masked,
    }
}

// ---- The schedule ----

pub type Runner = Arc<dyn Fn(&Spec) -> Outcome + Send + Sync>;
pub type Sink = Arc<dyn Fn(Vec<Status>) + Send + Sync>;

struct Inner {
    stop: bool,
    items: Vec<Item>,
    tracks: HashMap<String, Track>,
    due: HashMap<String, i64>,
    busy: HashSet<String>,
    quiet: Quiet,
    /// Devices whose issue was closed as Expected while still down (7g):
    /// each leaves the set when one of its checks answers again.
    expected: HashSet<String>,
    /// The last status sent per item (only changes are sent).
    sent: HashMap<String, Status>,
    last_rollup: i64,
    last_prune: i64,
    /// The most checks running at once so far (for the tests).
    peak: usize,
}

struct Shared {
    m: Mutex<Inner>,
    cv: Condvar,
    runner: Runner,
    sink: Sink,
    stats: Option<Arc<Mutex<Stats>>>,
    /// Days of hourly figures kept; 0 is Off (no sample is written). Read
    /// and changed under the statistics' lock, so Off and its clearing are
    /// never passed by a sample on its way (D238).
    retention: AtomicU32,
    jobs: Mutex<Option<mpsc::Sender<(String, Spec)>>>,
    /// Set by stop(): a check still running then writes no sample and
    /// sends no change when it finishes (Stop is final).
    stopped: AtomicBool,
}

/// The running monitor: a scheduler thread and AT_ONCE workers. Dropped or
/// stopped, every thread ends.
pub struct Monitor {
    shared: Arc<Shared>,
}

impl Monitor {
    pub fn start(runner: Runner, sink: Sink, stats: Option<Arc<Mutex<Stats>>>, retention_days: u32, quiet: Quiet) -> Monitor {
        let shared = Arc::new(Shared {
            m: Mutex::new(Inner {
                stop: false,
                items: Vec::new(),
                tracks: HashMap::new(),
                due: HashMap::new(),
                busy: HashSet::new(),
                quiet,
                expected: HashSet::new(),
                sent: HashMap::new(),
                last_rollup: 0,
                last_prune: 0,
                peak: 0,
            }),
            cv: Condvar::new(),
            runner,
            sink,
            stats,
            retention: AtomicU32::new(retention_days),
            jobs: Mutex::new(None),
            stopped: AtomicBool::new(false),
        });
        let (tx, rx) = mpsc::channel::<(String, Spec)>();
        *shared.jobs.lock().unwrap() = Some(tx);
        let rx = Arc::new(Mutex::new(rx));
        for _ in 0..AT_ONCE {
            let rx = rx.clone();
            let sh = shared.clone();
            thread::spawn(move || loop {
                let job = { rx.lock().ok().and_then(|r| r.recv().ok()) };
                let Some((key, spec)) = job else { break };
                let out = (sh.runner)(&spec);
                finish(&sh, &key, out);
            });
        }
        let sh = shared.clone();
        thread::spawn(move || schedule(sh));
        Monitor { shared }
    }

    /// A new plan: kept items keep their state, new ones start unknown and
    /// are spread over their first interval, gone ones are forgotten.
    pub fn set_items(&self, items: Vec<Item>) {
        let now = now_ms();
        let mut g = self.shared.m.lock().unwrap();
        let keys: HashSet<String> = items.iter().map(|i| i.key.clone()).collect();
        g.tracks.retain(|k, _| keys.contains(k));
        g.due.retain(|k, _| keys.contains(k));
        g.sent.retain(|k, _| keys.contains(k));
        let n = items.len().max(1) as i64;
        for (i, it) in items.iter().enumerate() {
            if !g.tracks.contains_key(&it.key) {
                g.tracks.insert(it.key.clone(), Track::new(now));
                // The first round spread over at most 15 s.
                let spread = it.interval_ms.min(15_000);
                g.due.insert(it.key.clone(), now + spread * i as i64 / n);
            }
        }
        g.items = items;
        drop(g);
        self.shared.cv.notify_all();
        self.emit_all();
    }

    pub fn set_quiet(&self, quiet: Quiet) {
        let mut g = self.shared.m.lock().unwrap();
        g.quiet = quiet;
        drop(g);
        self.emit_all();
    }

    /// The devices whose issue was closed as Expected (src/issues.rs
    /// expected_nodes): their down time is quiet until they answer again.
    pub fn set_expected(&self, nodes: HashSet<String>) {
        let mut g = self.shared.m.lock().unwrap();
        g.expected = nodes;
        drop(g);
        self.emit_all();
    }

    /// The retention (0: Off). The caller holds the statistics' lock when
    /// it clears them after Off, so no sample lands between.
    pub fn set_retention(&self, days: u32) {
        self.shared.retention.store(days, AtomicOrdering::SeqCst);
    }

    /// Every item's status now.
    pub fn statuses(&self) -> Vec<Status> {
        let g = self.shared.m.lock().unwrap();
        all_statuses(&g, now_ms())
    }

    fn emit_all(&self) {
        let changed = {
            let mut g = self.shared.m.lock().unwrap();
            changes(&mut g, now_ms())
        };
        if !changed.is_empty() && !self.shared.stopped.load(AtomicOrdering::SeqCst) {
            (self.shared.sink)(changed);
        }
    }

    /// The most checks that ran at once.
    #[allow(dead_code)] // the tests
    pub fn peak(&self) -> usize {
        self.shared.m.lock().unwrap().peak
    }

    pub fn stop(&self) {
        self.shared.stopped.store(true, AtomicOrdering::SeqCst);
        if let Ok(mut g) = self.shared.m.lock() {
            g.stop = true;
        }
        if let Ok(mut j) = self.shared.jobs.lock() {
            *j = None; // the workers' channel closes: they end
        }
        self.shared.cv.notify_all();
    }
}

impl Drop for Monitor {
    fn drop(&mut self) {
        self.stop();
    }
}

fn all_statuses(g: &Inner, now: i64) -> Vec<Status> {
    let causes = root_causes(&g.items, &g.tracks);
    g.items
        .iter()
        .filter_map(|it| g.tracks.get(&it.key).map(|t| status_masked(it, t, causes.get(&it.key), &g.quiet, g.expected.contains(&it.node_id), now)))
        .collect()
}

/// The statuses that differ from the last ones sent (recorded as sent).
fn changes(g: &mut Inner, now: i64) -> Vec<Status> {
    let all = all_statuses(g, now);
    let mut out = Vec::new();
    for s in all {
        if g.sent.get(&s.key) != Some(&s) {
            g.sent.insert(s.key.clone(), s.clone());
            out.push(s);
        }
    }
    out
}

fn schedule(sh: Arc<Shared>) {
    let mut g = sh.m.lock().unwrap();
    loop {
        if g.stop {
            return;
        }
        let now = now_ms();
        // Items with no result for 2.5 intervals: unknown.
        let mut stale = false;
        let items = g.items.clone();
        for it in &items {
            if let Some(t) = g.tracks.get_mut(&it.key) {
                stale |= t.stale(now, it.interval_ms);
            }
        }
        // Quiet windows that ended, and the hourly figures once a minute.
        let quiet_was = g.quiet.clone();
        g.quiet.prune(now);
        let quiet_changed = g.quiet != quiet_was;
        let roll = now - g.last_rollup > 60_000;
        if roll {
            g.last_rollup = now;
        }
        // Samples past 7 days and figures past the retention, once an hour
        // while it runs (D238).
        let prune = roll && now - g.last_prune > 3_600_000;
        if prune {
            g.last_prune = now;
        }
        // What is due, at most AT_ONCE running.
        let mut next = now + 1000;
        let jobs = sh.jobs.lock().ok().and_then(|j| j.clone());
        // Oldest due first (D239): under a backlog (many checks timing out
        // at once) every item gets its turn, not only the first in the plan.
        let mut ready: Vec<(i64, usize)> = Vec::new();
        for (i, it) in items.iter().enumerate() {
            let due = *g.due.get(&it.key).unwrap_or(&now);
            if due > now {
                next = next.min(due);
            } else if !g.busy.contains(&it.key) {
                ready.push((due, i));
            }
        }
        ready.sort();
        for (_, i) in ready {
            let it = &items[i];
            if g.busy.len() >= AT_ONCE {
                break;
            }
            let Some(tx) = jobs.as_ref() else { break };
            g.busy.insert(it.key.clone());
            g.peak = g.peak.max(g.busy.len());
            g.due.insert(it.key.clone(), now + it.interval_ms);
            let _ = tx.send((it.key.clone(), it.spec.clone()));
        }
        let changed = if stale || quiet_changed { changes(&mut g, now) } else { Vec::new() };
        if !changed.is_empty() || roll {
            drop(g);
            if !changed.is_empty() && !sh.stopped.load(AtomicOrdering::SeqCst) {
                (sh.sink)(changed);
            }
            if roll {
                if let Some(st) = &sh.stats {
                    if let Ok(st) = st.lock() {
                        let _ = st.rollup(now);
                        let days = sh.retention.load(AtomicOrdering::SeqCst);
                        if prune && days > 0 {
                            let _ = st.prune(now, days);
                        }
                    }
                }
            }
            g = sh.m.lock().unwrap();
            continue;
        }
        let wait = (next - now).clamp(50, 1000) as u64;
        g = sh.cv.wait_timeout(g, Duration::from_millis(wait)).unwrap().0;
    }
}

/// A worker's result: the state, the sample, the change sent.
fn finish(sh: &Arc<Shared>, key: &str, out: Outcome) {
    let now = now_ms();
    let (changed, sample) = {
        let mut g = sh.m.lock().unwrap();
        g.busy.remove(key);
        // Stopped while this check ran: its result is dropped (no state, no
        // sample, no change sent).
        if g.stop || sh.stopped.load(AtomicOrdering::SeqCst) {
            drop(g);
            sh.cv.notify_all();
            return;
        }
        let Some(it) = g.items.iter().find(|i| i.key == key).cloned() else {
            drop(g);
            sh.cv.notify_all();
            return;
        };
        let mut answered = false;
        if let Some(t) = g.tracks.get_mut(key) {
            t.apply(&out, now, it.slow_ms);
            answered = t.phase == Phase::Up;
        }
        // Answering again: an Expected outage is over.
        if answered {
            g.expected.remove(&it.node_id);
        }
        let changed = changes(&mut g, now);
        let sample = if sh.retention.load(AtomicOrdering::SeqCst) > 0 {
            g.sent.get(key).map(|s| Sample {
                t: now,
                ok: out.ok,
                rtt: out.rtt_ms,
                status: out.status.clone(),
                state: s.sample_state().to_string(),
                upstream: s.cause.is_some(),
                iv: it.interval_ms,
                via: out.via.clone(),
            })
        } else {
            None
        };
        (changed, sample)
    };
    sh.cv.notify_all();
    if let (Some(s), Some(st)) = (sample, &sh.stats) {
        if let Ok(st) = st.lock() {
            // Read again under the lock: Off or Stop may have come meanwhile
            // (whoever clears the samples after Stop holds this lock).
            if sh.retention.load(AtomicOrdering::SeqCst) > 0 && !sh.stopped.load(AtomicOrdering::SeqCst) {
                let _ = st.add_sample(key, &s);
            }
        }
    }
    if !changed.is_empty() && !sh.stopped.load(AtomicOrdering::SeqCst) {
        (sh.sink)(changed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn ok(rtt: f64) -> Outcome {
        Outcome { ok: true, rtt_ms: Some(rtt), status: "echo".into(), via: "icmp".into(), ..Default::default() }
    }
    fn fail() -> Outcome {
        Outcome { status: "timeout".into(), via: "icmp".into(), ..Default::default() }
    }
    fn item(key: &str, node: &str, chain: &[&str]) -> Item {
        let mut v = normalize(vec![Item {
            key: key.into(),
            node_id: node.into(),
            spec: Spec { proto: "ping".into(), host: "127.0.0.1".into(), ..Default::default() },
            chain: chain.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }]);
        v.remove(0)
    }

    #[test]
    fn thresholds() {
        let mut t = Track::new(0);
        assert_eq!(t.phase, Phase::Unknown);
        t.apply(&ok(5.0), 1, 0);
        assert_eq!(t.phase, Phase::Unknown, "one answer is not up yet");
        t.apply(&ok(5.0), 2, 0);
        assert_eq!(t.phase, Phase::Up);
        t.apply(&fail(), 3, 0);
        t.apply(&fail(), 4, 0);
        assert_eq!(t.phase, Phase::Up, "two failures are not down");
        t.apply(&ok(5.0), 5, 0);
        t.apply(&fail(), 6, 0);
        t.apply(&fail(), 7, 0);
        assert_eq!(t.phase, Phase::Up, "the count starts again after an answer");
        t.apply(&fail(), 8, 0);
        assert_eq!(t.phase, Phase::Down);
        assert_eq!(t.since, 8);
        t.apply(&ok(5.0), 9, 0);
        assert_eq!(t.phase, Phase::Down, "one answer is not up");
        t.apply(&ok(5.0), 10, 0);
        assert_eq!(t.phase, Phase::Up);
        // A check that cannot be asked here is unknown, never down.
        t.apply(&Outcome { skipped: true, status: "no-icmp".into(), ..Default::default() }, 11, 0);
        assert_eq!(t.phase, Phase::Unknown);
    }

    #[test]
    fn slow_is_the_median_of_five() {
        let mut t = Track::new(0);
        for (i, r) in [10.0, 10.0].iter().enumerate() {
            t.apply(&ok(*r), i as i64, 50);
        }
        assert!(!t.slow, "too few answers");
        t.apply(&ok(200.0), 3, 50);
        assert!(!t.slow, "median 10");
        t.apply(&ok(200.0), 4, 50);
        t.apply(&ok(200.0), 5, 50);
        assert!(t.slow, "median of 10,10,200,200,200 is 200");
        // One fast answer among slow ones does not end it; three do.
        t.apply(&ok(5.0), 6, 50);
        assert!(t.slow);
        t.apply(&ok(5.0), 7, 50);
        t.apply(&ok(5.0), 8, 50);
        assert!(!t.slow);
        // No "slow above": never slow.
        let mut t = Track::new(0);
        for i in 0..6 {
            t.apply(&ok(9999.0), i, 0);
        }
        assert!(!t.slow);
    }

    #[test]
    fn flapping_is_four_changes_in_30_minutes() {
        let mut t = Track::new(0);
        let min = 60_000;
        let mut now = 0;
        let mut step = |t: &mut Track, o: Outcome| {
            now += min;
            t.apply(&o, now, 0);
        };
        step(&mut t, ok(1.0));
        step(&mut t, ok(1.0)); // up (from unknown: not a change)
        for _ in 0..2 {
            for _ in 0..3 {
                step(&mut t, fail());
            }
            for _ in 0..2 {
                step(&mut t, ok(1.0));
            }
        }
        // down, up, down, up: four changes within 12 minutes.
        assert_eq!(t.changes.len(), 4);
        assert!(t.flapping);
        // Quiet for half an hour: the changes age out.
        let later = now + FLAP_WINDOW_MS + min;
        t.apply(&ok(1.0), later, 0);
        assert!(!t.flapping);
        assert!(t.changes.is_empty());
    }

    #[test]
    fn unknown_after_a_long_silence() {
        let mut t = Track::new(0);
        t.apply(&ok(1.0), 0, 0);
        t.apply(&ok(1.0), 60_000, 0);
        assert!(!t.stale(60_000 + 120_000, 60_000), "two intervals is not stale");
        assert!(t.stale(60_000 + 151_000, 60_000));
        assert_eq!(t.phase, Phase::Unknown);
        assert!(!t.stale(60_000 + 300_000, 60_000), "said once");
        // Unknown never counts as down: it starts counting again.
        t.apply(&fail(), 400_000, 0);
        t.apply(&fail(), 460_000, 0);
        assert_eq!(t.phase, Phase::Unknown);
    }

    #[test]
    fn quiet_windows() {
        let mut it = item("n1/c1", "n1", &[]);
        it.groups = vec!["g_room".into(), "g_floor".into()];
        let mut q = Quiet::default();
        assert!(!q.is_quiet(&it, 100));
        q.nodes.insert("n1".into(), 200);
        assert!(q.is_quiet(&it, 100));
        assert!(!q.is_quiet(&it, 200));
        q.groups.insert("g_floor".into(), 500);
        assert!(q.is_quiet(&it, 300));
        q.site = 900;
        assert_eq!(q.until(&it), 900);
        let mut t = Track::new(0);
        for i in 0..3 {
            t.apply(&fail(), i, 0);
        }
        let s = status_of(&it, &t, None, &q, 800);
        assert_eq!(s.state, "quiet");
        assert_eq!(s.quiet_until, Some(900));
        assert_eq!(s.sample_state(), "quiet");
        let s = status_of(&it, &t, None, &q, 950);
        assert_eq!(s.state, "down");
        q.prune(600);
        assert!(q.nodes.is_empty() && q.groups.is_empty() && q.site == 900);
    }

    #[test]
    fn root_cause_is_the_nearest_device_down() {
        // PC -> core switch sw1 -> router r1 -> switch sw2 -> printer p1.
        let items = vec![
            item("sw1/a", "sw1", &[]),
            item("r1/a", "r1", &["sw1"]),
            item("r1/web", "r1", &["sw1"]),
            item("sw2/a", "sw2", &["sw1", "r1"]),
            item("p1/a", "p1", &["sw1", "r1", "sw2"]),
        ];
        let mut tracks: HashMap<String, Track> = items.iter().map(|i| (i.key.clone(), Track::new(0))).collect();
        let down = |t: &mut Track| {
            for i in 0..3 {
                t.apply(&fail(), i, 0);
            }
        };
        let up = |t: &mut Track| {
            for i in 0..2 {
                t.apply(&ok(1.0), i, 0);
            }
        };
        for k in ["sw1/a", "r1/a", "r1/web"] {
            up(tracks.get_mut(k).unwrap());
        }
        for k in ["sw2/a", "p1/a"] {
            down(tracks.get_mut(k).unwrap());
        }
        let c = root_causes(&items, &tracks);
        assert_eq!(c.get("p1/a"), Some(&"sw2".to_string()));
        assert_eq!(c.get("sw2/a"), None, "nothing above it is down: its own outage");
        // The router's ping down but its web page answering: not down.
        down(tracks.get_mut("r1/a").unwrap());
        let c = root_causes(&items, &tracks);
        assert_eq!(c.get("p1/a"), Some(&"sw2".to_string()));
        // The router wholly down: the printer and sw2 are down because of
        // it (the nearest to this PC); the router is its own.
        down(tracks.get_mut("r1/web").unwrap());
        let c = root_causes(&items, &tracks);
        assert_eq!(c.get("p1/a"), Some(&"r1".to_string()));
        assert_eq!(c.get("sw2/a"), Some(&"r1".to_string()));
        assert_eq!(c.get("r1/a"), None);
        let q = Quiet::default();
        let s = status_of(&items[4], &tracks["p1/a"], c.get("p1/a"), &q, 10);
        assert_eq!(s.cause.as_deref(), Some("r1"));
        // A device up has no cause however its chain is.
        let s = status_of(&items[0], &tracks["sw1/a"], c.get("sw1/a"), &q, 10);
        assert_eq!((s.state.as_str(), s.cause.as_deref()), ("up", None));
    }

    #[test]
    fn expected_is_quiet_until_it_answers() {
        let runner: Runner = Arc::new(|_: &Spec| fail());
        let sink: Sink = Arc::new(|_| {});
        let stats = Arc::new(Mutex::new(Stats::memory().unwrap()));
        let mon = Monitor::start(runner, sink, Some(stats.clone()), 360, Quiet::default());
        let mut a = item("a/1", "a", &[]);
        a.interval_ms = 40;
        mon.set_items(vec![a]);
        thread::sleep(Duration::from_millis(400));
        assert_eq!(mon.statuses()[0].state, "down");
        mon.set_expected(["a".to_string()].into_iter().collect());
        let s = &mon.statuses()[0];
        assert_eq!((s.state.as_str(), s.expected, s.quiet_until), ("quiet", true, None));
        thread::sleep(Duration::from_millis(300));
        mon.stop();
        let samples = stats.lock().unwrap().samples("a/1", 0).unwrap();
        assert!(samples.iter().any(|x| x.state == "quiet"), "recorded as maintenance");
        // A device up is never masked.
        let mut t = Track::new(0);
        t.apply(&ok(1.0), 1, 0);
        t.apply(&ok(1.0), 2, 0);
        let it = item("b/1", "b", &[]);
        assert_eq!(status_masked(&it, &t, None, &Quiet::default(), true, 3).state, "up");
    }

    #[test]
    fn root_cause_never_loops() {
        // Two routers each other's chain (D237): both down, neither is
        // down "because of" the other.
        let items = vec![item("fw/a", "fw", &["l3"]), item("l3/a", "l3", &["fw"]), item("p/a", "p", &["l3"])];
        let mut tracks: HashMap<String, Track> = items.iter().map(|i| (i.key.clone(), Track::new(0))).collect();
        for t in tracks.values_mut() {
            for i in 0..3 {
                t.apply(&fail(), i, 0);
            }
        }
        let c = root_causes(&items, &tracks);
        assert_eq!(c.get("fw/a"), None);
        assert_eq!(c.get("l3/a"), None);
        assert_eq!(c.get("p/a"), Some(&"l3".to_string()), "a plain chain still has its cause");
    }

    #[test]
    fn a_backlog_is_served_oldest_first() {
        // 24 items always due, 8 workers busy 100 ms each: in plan order the
        // last ones would never run (D239).
        let per: Arc<Mutex<HashMap<String, usize>>> = Arc::new(Mutex::new(HashMap::new()));
        let p2 = per.clone();
        let runner: Runner = Arc::new(move |spec: &Spec| {
            *p2.lock().unwrap().entry(spec.host.clone()).or_insert(0) += 1;
            thread::sleep(Duration::from_millis(100));
            fail()
        });
        let sink: Sink = Arc::new(|_| {});
        let mon = Monitor::start(runner, sink, None, 0, Quiet::default());
        let items: Vec<Item> = (0..24).map(|i| {
            let mut it = item(&format!("n{i}/p"), &format!("n{i}"), &[]);
            it.spec.host = format!("h{i}");
            it.interval_ms = 50;
            it
        }).collect();
        mon.set_items(items);
        thread::sleep(Duration::from_millis(1500));
        mon.stop();
        let per = per.lock().unwrap();
        let least = (0..24).map(|i| per.get(&format!("h{i}")).copied().unwrap_or(0)).min().unwrap();
        assert!(least >= 3, "every item had its turn: {per:?}");
    }

    #[test]
    fn a_running_monitor_prunes() {
        // Samples past 7 days go while the monitor runs, not only at its
        // start (D238).
        let stats = Arc::new(Mutex::new(Stats::memory().unwrap()));
        let old = now_ms() - 8 * 86_400_000;
        let smp = |t: i64| Sample { t, ok: true, rtt: Some(1.0), status: "echo".into(), state: "up".into(), upstream: false, iv: 60_000, via: "icmp".into() };
        stats.lock().unwrap().add_sample("x/1", &smp(old)).unwrap();
        let runner: Runner = Arc::new(|_: &Spec| ok(1.0));
        let sink: Sink = Arc::new(|_| {});
        let mon = Monitor::start(runner, sink, Some(stats.clone()), 360, Quiet::default());
        thread::sleep(Duration::from_millis(300));
        assert_eq!(stats.lock().unwrap().samples("x/1", 0).unwrap().len(), 0);
        // Off while it runs: nothing more is written.
        mon.set_retention(0);
        let mut it = item("a/b", "a", &[]);
        it.interval_ms = 50;
        mon.set_items(vec![it]);
        thread::sleep(Duration::from_millis(300));
        mon.stop();
        assert_eq!(stats.lock().unwrap().counts().unwrap().0, 0);
    }

    #[test]
    fn plans_are_made_safe() {
        let raw = vec![
            Item { key: "a/1".into(), spec: Spec { proto: "ping".into(), ..Default::default() }, interval_s: 5, ..Default::default() },
            Item { key: "a/1".into(), spec: Spec { proto: "tcp".into(), ..Default::default() }, ..Default::default() },
            Item { key: "a/2".into(), spec: Spec { proto: "snmp".into(), ..Default::default() }, ..Default::default() },
            Item { key: "a/3".into(), spec: Spec { proto: "dicom".into(), ..Default::default() }, interval_s: 99_999, ..Default::default() },
            Item { key: "a/4".into(), spec: Spec { proto: "dns".into(), ..Default::default() }, ..Default::default() },
            Item { key: "".into(), spec: Spec { proto: "tcp".into(), ..Default::default() }, ..Default::default() },
        ];
        let v = normalize(raw);
        assert_eq!(v.iter().map(|i| i.key.as_str()).collect::<Vec<_>>(), vec!["a/1", "a/3", "a/4"]);
        assert_eq!(v[0].interval_s, INTERVAL_MIN_S);
        assert_eq!(v[1].interval_s, INTERVAL_MAX_S);
        assert_eq!(v[2].interval_s, INTERVAL_DEFAULT_S);
        assert_eq!(v[2].interval_ms, 60_000);
        let many: Vec<Item> = (0..ITEMS_MAX + 5).map(|i| Item { key: format!("n/{i}"), spec: Spec { proto: "tcp".into(), ..Default::default() }, ..Default::default() }).collect();
        assert_eq!(normalize(many).len(), ITEMS_MAX);
    }

    #[test]
    fn at_most_eight_at_once_and_states_reach_the_sink() {
        let running = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let calls = Arc::new(AtomicUsize::new(0));
        let (r2, m2, c2) = (running.clone(), most.clone(), calls.clone());
        let runner: Runner = Arc::new(move |spec: &Spec| {
            let n = r2.fetch_add(1, Ordering::SeqCst) + 1;
            m2.fetch_max(n, Ordering::SeqCst);
            c2.fetch_add(1, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(60));
            r2.fetch_sub(1, Ordering::SeqCst);
            if spec.host == "10.0.0.99" { fail() } else { ok(3.0) }
        });
        let seen: Arc<Mutex<Vec<Status>>> = Arc::new(Mutex::new(Vec::new()));
        let s2 = seen.clone();
        let sink: Sink = Arc::new(move |v: Vec<Status>| s2.lock().unwrap().extend(v));
        let stats = Arc::new(Mutex::new(Stats::memory().unwrap()));
        let mon = Monitor::start(runner, sink, Some(stats.clone()), 360, Quiet::default());
        let mut items: Vec<Item> = (0..20).map(|i| {
            let mut it = item(&format!("n{i}/p"), &format!("n{i}"), &[]);
            it.spec.host = if i == 7 { "10.0.0.99".into() } else { format!("10.0.0.{i}") };
            it
        }).collect();
        for it in &mut items {
            it.interval_ms = 150; // the tests' own pace
        }
        mon.set_items(items);
        thread::sleep(Duration::from_millis(1500));
        mon.stop();
        assert!(calls.load(Ordering::SeqCst) >= 40, "{} checks ran", calls.load(Ordering::SeqCst));
        assert!(most.load(Ordering::SeqCst) <= AT_ONCE, "{} at once", most.load(Ordering::SeqCst));
        assert!(mon.peak() <= AT_ONCE);
        assert!(most.load(Ordering::SeqCst) >= 2, "they ran side by side");
        let seen = seen.lock().unwrap();
        assert!(seen.iter().any(|s| s.key == "n3/p" && s.state == "up"));
        assert!(seen.iter().any(|s| s.key == "n7/p" && s.state == "down"));
        let st = mon.statuses();
        assert_eq!(st.len(), 20);
        // Samples were kept, with the state after each check.
        let samples = stats.lock().unwrap().samples("n7/p", 0).unwrap();
        assert!(samples.len() >= 3);
        assert!(samples.iter().any(|s| s.state == "down" && !s.ok));
    }

    #[test]
    fn off_keeps_no_sample() {
        let runner: Runner = Arc::new(|_: &Spec| ok(1.0));
        let sink: Sink = Arc::new(|_| {});
        let stats = Arc::new(Mutex::new(Stats::memory().unwrap()));
        let mon = Monitor::start(runner, sink, Some(stats.clone()), 0, Quiet::default());
        let mut it = item("a/b", "a", &[]);
        it.interval_ms = 50;
        mon.set_items(vec![it]);
        thread::sleep(Duration::from_millis(400));
        mon.stop();
        assert_eq!(mon.statuses()[0].state, "up", "status still works");
        assert_eq!(stats.lock().unwrap().counts().unwrap(), (0, 0));
    }

    #[test]
    fn a_new_plan_keeps_known_states() {
        let runner: Runner = Arc::new(|_: &Spec| fail());
        let sink: Sink = Arc::new(|_| {});
        let mon = Monitor::start(runner, sink, None, 0, Quiet::default());
        let mut a = item("a/1", "a", &[]);
        a.interval_ms = 40;
        mon.set_items(vec![a.clone()]);
        thread::sleep(Duration::from_millis(400));
        assert_eq!(mon.statuses()[0].state, "down");
        let mut b = item("b/1", "b", &[]);
        b.interval_ms = 10_000_000;
        mon.set_items(vec![a, b]);
        let st = mon.statuses();
        assert_eq!(st.iter().find(|s| s.key == "a/1").unwrap().state, "down");
        assert_eq!(st.iter().find(|s| s.key == "b/1").unwrap().state, "unknown");
        mon.set_items(vec![]);
        assert!(mon.statuses().is_empty());
        mon.stop();
    }
}
