// The visit monitor (docs/SCOPE.md D148, D174, step 7i): "Monitor during
// this visit", in provider mode on the desktop app. No Tauri here, so the
// tests drive it with a stand-in for the checks (src/visitcmd.rs is the
// app's side).
//
// It runs the same schedule and states as the site monitor (src/monitor.rs)
// over the checks of the devices the provider covers, which the page works
// out (js/visitmonitor.js), under the provider's own sign-in: no device key,
// no monitor role, nothing sent to a server. What differs:
//
//   - the samples live in memory only (an in-memory SQLite, src/stats.rs),
//     for this session: never on disk, never pushed;
//   - no issue record and no alarm: work in progress takes devices down on
//     purpose, so the outages seen are kept here for the visit's report
//     (each device's down time, with the device upstream it was down
//     because of, if any);
//   - the figures (per check: answered of asked, loss, availability with
//     its coverage, median, 95th percentile, and a series of at most 48
//     points for the report's chart) are worked out from the samples when
//     the page asks for them (Record visit) or at Stop;
//   - Stop ends the checks and drops the samples, keeping the figures
//     (D174); the end (Record visit taken, sign-out, a new session) drops
//     everything.
//
// With statistics Off (the site's Keep statistics, or this PC's, D162) no
// sample is kept at all: the states and the outages still show while it
// runs, and there are no figures.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::monitor::{self, Item, Monitor, Quiet, Runner, Status};
use crate::stats::{percentile, Sample, Stats};

/// The most checks one visit asks (a provider's part of a site).
pub const ITEMS_MAX: usize = 400;
/// The most outages one visit keeps (the oldest go first).
pub const OUTAGES_MAX: usize = 100;
/// The most points of a check's chart.
pub const SERIES_MAX: usize = 48;
/// A gap longer than this many intervals is unknown, as the hourly figures
/// count it (src/stats.rs).
const GAP_INTERVALS: f64 = 2.5;
/// Days of samples the in-memory store keeps (a visit is far shorter).
const MEMORY_DAYS: u32 = 7;

/// One device's time not answering during the visit.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Outage {
    pub node_id: String,
    pub name: String,
    pub from: i64,
    /// None while it goes on.
    pub to: Option<i64>,
    /// The device upstream it was down because of (every check of it that
    /// was down had that cause).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
}

/// The outages, worked out from the status changes: a device is down while
/// any of its checks is down.
#[derive(Default, Debug)]
pub struct Outages {
    pub list: Vec<Outage>,
    /// device -> its checks down now, with their cause.
    down: HashMap<String, HashMap<String, Option<String>>>,
}

impl Outages {
    /// A batch of changes. `names`: device id -> name. -> whether the list
    /// changed.
    pub fn update(&mut self, changed: &[Status], names: &HashMap<String, String>, now: i64) -> bool {
        let mut touched: Vec<(String, bool, i64)> = Vec::new();
        for s in changed {
            let was = self.down.get(&s.node_id).map(|m| !m.is_empty()).unwrap_or(false);
            let e = self.down.entry(s.node_id.clone()).or_default();
            if s.state == "down" {
                e.insert(s.key.clone(), s.cause.clone());
            } else {
                e.remove(&s.key);
            }
            if !touched.iter().any(|t| t.0 == s.node_id) {
                touched.push((s.node_id.clone(), was, if s.state == "down" { s.since } else { now }));
            } else if s.state == "down" {
                if let Some(t) = touched.iter_mut().find(|t| t.0 == s.node_id) {
                    t.2 = t.2.min(s.since);
                }
            }
        }
        let mut changed_any = false;
        for (node, was, at) in touched {
            let downs = self.down.get(&node).cloned().unwrap_or_default();
            let is = !downs.is_empty();
            // The cause: one device upstream named by every check down.
            let causes: HashSet<Option<String>> = downs.values().cloned().collect();
            let cause = if causes.len() == 1 { causes.into_iter().next().flatten() } else { None };
            if is && !was {
                self.list.push(Outage { node_id: node.clone(), name: names.get(&node).cloned().unwrap_or_default(), from: at.min(now), to: None, cause });
                if self.list.len() > OUTAGES_MAX {
                    self.list.remove(0);
                }
                changed_any = true;
            } else if !is && was {
                if let Some(o) = self.list.iter_mut().rev().find(|o| o.node_id == node && o.to.is_none()) {
                    o.to = Some(now);
                    changed_any = true;
                }
            } else if is {
                if let Some(o) = self.list.iter_mut().rev().find(|o| o.node_id == node && o.to.is_none()) {
                    if o.cause != cause {
                        o.cause = cause;
                        changed_any = true;
                    }
                }
            }
            if !is {
                self.down.remove(&node);
            }
        }
        changed_any
    }

    /// Checks that left the plan (`keep`: the keys still asked) no longer
    /// hold a device down: a device left with none down ends its outage at
    /// `now`. -> whether the list changed.
    pub fn forget(&mut self, keep: &HashSet<String>, now: i64) -> bool {
        let mut changed_any = false;
        let nodes: Vec<String> = self.down.keys().cloned().collect();
        for node in nodes {
            let Some(m) = self.down.get_mut(&node) else { continue };
            let before = m.len();
            m.retain(|k, _| keep.contains(k));
            if m.len() == before {
                continue;
            }
            let open = self.list.iter_mut().rev().find(|o| o.node_id == node && o.to.is_none());
            if m.is_empty() {
                self.down.remove(&node);
                if let Some(o) = open {
                    o.to = Some(now);
                    changed_any = true;
                }
            } else {
                let causes: HashSet<Option<String>> = m.values().cloned().collect();
                let cause = if causes.len() == 1 { causes.into_iter().next().flatten() } else { None };
                if let Some(o) = open {
                    if o.cause != cause {
                        o.cause = cause;
                        changed_any = true;
                    }
                }
            }
        }
        changed_any
    }

    /// Every outage still going on ends at `now` (Stop).
    pub fn close(&mut self, now: i64) {
        for o in self.list.iter_mut().filter(|o| o.to.is_none()) {
            o.to = Some(now);
        }
        self.down.clear();
    }
}

/// One check's figures during the visit.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemFigures {
    pub key: String,
    pub node_id: String,
    pub check_id: String,
    /// The device's name.
    pub name: String,
    pub proto: String,
    /// "tcp" when a ping was asked over TCP ("TCP, not ping").
    pub via: String,
    pub asked: u32,
    pub answered: u32,
    /// Unanswered of asked (0..1); None when nothing was asked.
    pub loss: Option<f64>,
    /// up / (up + down), quiet and unknown time left out (D163).
    pub avail: Option<f64>,
    /// The share of the visit actually measured.
    pub coverage: f64,
    pub med: Option<f64>,
    pub p95: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// The chart: `rtt` and `states` hold one point per `step` ms from the
    /// visit's start; `states` one character each: u up, s slow, d down,
    /// q quiet, - unknown.
    pub step: i64,
    pub rtt: Vec<Option<f64>>,
    pub states: String,
}

/// The visit's figures: per check, and the outages seen.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Figures {
    pub from: i64,
    pub to: i64,
    pub items: Vec<ItemFigures>,
    pub outages: Vec<Outage>,
}

fn round(x: f64, places: i32) -> f64 {
    let m = 10f64.powi(places);
    (x * m).round() / m
}

fn state_char(state: &str) -> char {
    match state {
        "up" => 'u',
        "slow" => 's',
        "down" => 'd',
        "quiet" => 'q',
        _ => '-',
    }
}
fn char_rank(c: char) -> u8 {
    match c {
        'd' => 4,
        's' => 3,
        'q' => 2,
        'u' => 1,
        _ => 0,
    }
}

/// The figures of one check from its samples (oldest first), over
/// [from, to).
pub fn item_figures(it: &Item, samples: &[Sample], from: i64, to: i64) -> ItemFigures {
    let to = to.max(from + 1);
    let inside: Vec<&Sample> = samples.iter().filter(|s| s.t >= from && s.t < to).collect();
    let mut f = ItemFigures {
        key: it.key.clone(),
        node_id: it.node_id.clone(),
        check_id: it.key.strip_prefix(&format!("{}/", it.node_id)).unwrap_or(&it.key).to_string(),
        name: if it.node_name.is_empty() { it.node_id.clone() } else { it.node_name.clone() },
        proto: it.spec.proto.clone(),
        via: if it.spec.proto == "ping" && inside.iter().any(|s| s.via == "tcp") { "tcp".into() } else { String::new() },
        ..Default::default()
    };
    f.asked = inside.len() as u32;
    f.answered = inside.iter().filter(|s| s.ok).count() as u32;
    if f.asked > 0 {
        f.loss = Some(round(1.0 - f.answered as f64 / f.asked as f64, 4));
    }
    let mut rtts: Vec<f64> = inside.iter().filter(|s| s.ok).filter_map(|s| s.rtt).collect();
    rtts.sort_by(|a, b| a.total_cmp(b));
    f.med = percentile(&rtts, 50.0).map(|x| round(x, 1));
    f.p95 = percentile(&rtts, 95.0).map(|x| round(x, 1));
    f.min = rtts.first().map(|x| round(*x, 1));
    f.max = rtts.last().map(|x| round(*x, 1));
    // Time in each state, as the hourly figures count it: a sample's state
    // until the next one, or for one interval when the next is further than
    // 2.5 intervals away (the rest unknown).
    let (mut up, mut down, mut maint) = (0i64, 0i64, 0i64);
    for (i, s) in inside.iter().enumerate() {
        let next = inside.get(i + 1).map(|n| n.t).unwrap_or(to);
        let gap = next - s.t;
        let span = if gap as f64 <= GAP_INTERVALS * s.iv as f64 { gap } else { s.iv.min(gap) };
        match s.state.as_str() {
            "up" | "slow" => up += span,
            "down" => down += span,
            "quiet" => maint += span,
            _ => {}
        }
    }
    if up + down > 0 {
        f.avail = Some(round(up as f64 / (up + down) as f64, 6));
    }
    f.coverage = round(((up + down + maint) as f64 / (to - from) as f64).min(1.0), 4);
    // The chart: at most SERIES_MAX points, each no shorter than the check's
    // interval, a whole number of seconds.
    let span = to - from;
    let iv = it.interval_ms.max(1000);
    let mut step = ((span + SERIES_MAX as i64 - 1) / SERIES_MAX as i64).max(iv);
    step = ((step + 999) / 1000) * 1000;
    let n = ((span + step - 1) / step).clamp(1, SERIES_MAX as i64) as usize;
    f.step = step;
    let mut rtt = Vec::with_capacity(n);
    let mut states = String::with_capacity(n);
    let mut last: Option<(&Sample, i64)> = None;
    let mut idx = 0;
    for b in 0..n {
        let b0 = from + b as i64 * step;
        let b1 = b0 + step;
        let mut vals: Vec<f64> = Vec::new();
        let mut worst: Option<char> = None;
        while idx < inside.len() && inside[idx].t < b1 {
            let s = inside[idx];
            if s.ok {
                if let Some(r) = s.rtt {
                    vals.push(r);
                }
            }
            let c = state_char(&s.state);
            if worst.map(|w| char_rank(c) > char_rank(w)).unwrap_or(true) {
                worst = Some(c);
            }
            // How far its state reaches, as the time in each state counts it.
            let next = inside.get(idx + 1).map(|n| n.t).unwrap_or(to);
            let reach = if (next - s.t) as f64 <= GAP_INTERVALS * s.iv as f64 { next } else { s.t + s.iv };
            last = Some((s, reach));
            idx += 1;
        }
        let c = match worst {
            Some(c) => c,
            None => match last {
                // The state carries on until the next sample, unless the
                // gap is too long.
                Some((s, reach)) if b0 < reach => state_char(&s.state),
                _ => '-',
            },
        };
        vals.sort_by(|a, b| a.total_cmp(b));
        rtt.push(percentile(&vals, 50.0).map(|x| round(x, 1)));
        states.push(c);
    }
    f.rtt = rtt;
    f.states = states;
    f
}

/// The visit's figures from every check's samples.
pub fn summarize(items: &[Item], samples: &HashMap<String, Vec<Sample>>, outages: &[Outage], from: i64, to: i64) -> Figures {
    let empty = Vec::new();
    Figures {
        from,
        to,
        items: items.iter().map(|it| item_figures(it, samples.get(&it.key).unwrap_or(&empty), from, to)).collect(),
        outages: outages.to_vec(),
    }
}

/// Who started it and for what (the page's, kept to check that the figures
/// go to the visit they belong to).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Meta {
    /// The network (the page's docId).
    pub network_id: String,
    pub incident_id: String,
    pub provider_id: String,
    /// Statistics on: samples are kept (in memory) and figures made.
    pub kept: bool,
    /// The server user it was started under ("" with no sign-in): it ends
    /// when they sign out.
    pub who: String,
    pub started: i64,
}

pub type Notify = Arc<dyn Fn(Vec<Status>, Option<Vec<Outage>>) + Send + Sync>;

/// One visit's monitoring: running, or stopped with its figures.
pub struct Session {
    pub meta: Meta,
    mon: Option<Monitor>,
    stats: Option<Arc<Mutex<Stats>>>,
    items: Vec<Item>,
    names: Arc<Mutex<HashMap<String, String>>>,
    outages: Arc<Mutex<Outages>>,
    statuses: Arc<Mutex<HashMap<String, Status>>>,
    /// Set at Stop (and when dropped): a check that finishes late changes
    /// nothing and tells nobody.
    ended: Arc<AtomicBool>,
    notify: Notify,
    /// When Stop came; the figures it kept.
    pub stopped: Option<i64>,
    pub figures: Option<Figures>,
}

fn names_of(items: &[Item]) -> HashMap<String, String> {
    items.iter().map(|i| (i.node_id.clone(), if i.node_name.is_empty() { i.node_id.clone() } else { i.node_name.clone() })).collect()
}

impl Session {
    /// Starts the checks. `notify` hears every change (the statuses that
    /// changed, and the outages when they changed).
    pub fn start(runner: Runner, items: Vec<Item>, meta: Meta, notify: Notify) -> Session {
        let mut items = monitor::normalize(items);
        items.truncate(ITEMS_MAX);
        Session::start_items(runner, items, meta, notify)
    }

    /// The same with items already made safe (the tests shorten their
    /// intervals).
    fn start_items(runner: Runner, items: Vec<Item>, mut meta: Meta, notify: Notify) -> Session {
        if meta.started == 0 {
            meta.started = monitor::now_ms();
        }
        let stats = if meta.kept { Stats::memory().ok().map(|s| Arc::new(Mutex::new(s))) } else { None };
        let names = Arc::new(Mutex::new(names_of(&items)));
        let outages = Arc::new(Mutex::new(Outages::default()));
        let statuses: Arc<Mutex<HashMap<String, Status>>> = Arc::new(Mutex::new(HashMap::new()));
        let ended = Arc::new(AtomicBool::new(false));
        let (o2, n2, s2, e2, notify2) = (outages.clone(), names.clone(), statuses.clone(), ended.clone(), notify.clone());
        let sink: monitor::Sink = Arc::new(move |changed: Vec<Status>| {
            if e2.load(AtomicOrdering::SeqCst) {
                return;
            }
            {
                let mut g = s2.lock().unwrap();
                for s in &changed {
                    g.insert(s.key.clone(), s.clone());
                }
            }
            let names = n2.lock().unwrap().clone();
            let list = {
                let mut o = o2.lock().unwrap();
                // Read again under the outages' lock: Stop sets the flag
                // before it closes them, so nothing opens after.
                if e2.load(AtomicOrdering::SeqCst) {
                    return;
                }
                if o.update(&changed, &names, monitor::now_ms()) { Some(o.list.clone()) } else { None }
            };
            if e2.load(AtomicOrdering::SeqCst) {
                return;
            }
            notify2(changed, list);
        });
        // Retention 0 is Off: no sample is written (monitor.rs finish).
        let retention = if stats.is_some() { MEMORY_DAYS } else { 0 };
        let mon = Monitor::start(runner, sink, stats.clone(), retention, Quiet::default());
        mon.set_items(items.clone());
        Session { meta, mon: Some(mon), stats, items, names, outages, statuses, ended, notify, stopped: None, figures: None }
    }

    pub fn running(&self) -> bool {
        self.mon.is_some()
    }

    /// A new list of checks while it runs (the provider added one).
    pub fn set_items(&mut self, items: Vec<Item>) {
        let Some(m) = &self.mon else { return };
        let mut items = monitor::normalize(items);
        items.truncate(ITEMS_MAX);
        *self.names.lock().unwrap() = names_of(&items);
        self.items = items.clone();
        let keys: HashSet<String> = items.iter().map(|i| i.key.clone()).collect();
        self.statuses.lock().unwrap().retain(|k, _| keys.contains(k));
        m.set_items(items);
        // A check that left the plan while down (the device deleted or
        // replaced, the check removed, no longer covered) ends its outage
        // now: no "up" will ever come for it.
        let list = {
            let mut o = self.outages.lock().unwrap();
            if o.forget(&keys, monitor::now_ms()) { Some(o.list.clone()) } else { None }
        };
        if let Some(list) = list {
            (self.notify)(Vec::new(), Some(list));
        }
    }

    pub fn items(&self) -> &[Item] {
        &self.items
    }

    pub fn statuses(&self) -> Vec<Status> {
        match &self.mon {
            Some(m) => m.statuses(),
            None => Vec::new(),
        }
    }

    pub fn outages(&self) -> Vec<Outage> {
        if self.mon.is_none() {
            if let Some(f) = &self.figures {
                return f.outages.clone();
            }
        }
        self.outages.lock().unwrap().list.clone()
    }

    /// How many samples it holds (the tests: none after Stop).
    #[allow(dead_code)] // the tests
    pub fn sample_count(&self) -> u64 {
        self.stats.as_ref().and_then(|s| s.lock().ok().and_then(|s| s.counts().ok())).map(|c| c.0).unwrap_or(0)
    }

    /// The figures now: from the samples while it runs, the kept ones once
    /// stopped. None with statistics Off.
    pub fn figures(&self, now: i64) -> Option<Figures> {
        if !self.meta.kept {
            return None;
        }
        if self.mon.is_none() {
            return self.figures.clone();
        }
        let st = self.stats.as_ref()?;
        let g = st.lock().ok()?;
        let mut samples = HashMap::new();
        for it in &self.items {
            samples.insert(it.key.clone(), g.samples(&it.key, self.meta.started).unwrap_or_default());
        }
        drop(g);
        Some(summarize(&self.items, &samples, &self.outages(), self.meta.started, now))
    }

    /// Stop: the checks end, the samples go, the figures stay (D174).
    pub fn stop(&mut self, now: i64) {
        if self.mon.is_none() {
            return;
        }
        self.ended.store(true, AtomicOrdering::SeqCst);
        let figures = self.figures(now);
        if let Some(m) = self.mon.take() {
            m.stop();
        }
        let closed = {
            let mut o = self.outages.lock().unwrap();
            o.close(now);
            o.list.clone()
        };
        self.figures = figures.map(|f| f.with_outages(closed));
        if let Some(st) = self.stats.take() {
            if let Ok(s) = st.lock() {
                let _ = s.clear();
            }
        }
        self.stopped = Some(now);
    }
}

impl Figures {
    fn with_outages(mut self, outages: Vec<Outage>) -> Figures {
        self.outages = outages;
        self
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.ended.store(true, AtomicOrdering::SeqCst);
        if let Some(m) = self.mon.take() {
            m.stop();
        }
        if let Some(st) = self.stats.take() {
            if let Ok(s) = st.lock() {
                let _ = s.clear();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checks::{Outcome, Spec};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    fn sample(t: i64, ok: bool, rtt: f64, state: &str) -> Sample {
        Sample { t, ok, rtt: if ok { Some(rtt) } else { None }, status: String::new(), state: state.into(), upstream: false, iv: 60_000, via: "icmp".into() }
    }
    fn item(key: &str, node: &str) -> Item {
        let mut v = monitor::normalize(vec![Item {
            key: key.into(),
            node_id: node.into(),
            node_name: node.to_uppercase(),
            spec: Spec { proto: "ping".into(), host: "127.0.0.1".into(), ..Default::default() },
            ..Default::default()
        }]);
        v.remove(0)
    }
    fn status(key: &str, node: &str, state: &str, since: i64, cause: Option<&str>) -> Status {
        Status { key: key.into(), node_id: node.into(), state: state.into(), since, cause: cause.map(|s| s.into()), ..Default::default() }
    }

    #[test]
    fn figures_from_known_samples() {
        let it = item("r1/c1", "r1");
        let min = 60_000;
        // 10 minutes: 8 answers (10..80 ms), 2 failures, the last 3 minutes down.
        let mut s = Vec::new();
        for i in 0..7 {
            s.push(sample(i * min, true, 10.0 * (i + 1) as f64, "up"));
        }
        s.push(sample(7 * min, false, 0.0, "down"));
        s.push(sample(8 * min, false, 0.0, "down"));
        s.push(sample(9 * min, true, 80.0, "down"));
        let f = item_figures(&it, &s, 0, 10 * min);
        assert_eq!(f.check_id, "c1");
        assert_eq!(f.name, "R1");
        assert_eq!((f.asked, f.answered), (10, 8));
        assert_eq!(f.loss, Some(0.2));
        assert_eq!(f.med, Some(40.0), "nearest rank of 10,20,..,70,80");
        assert_eq!(f.p95, Some(80.0));
        assert_eq!((f.min, f.max), (Some(10.0), Some(80.0)));
        assert_eq!(f.avail, Some(0.7), "7 minutes up, 3 down");
        assert_eq!(f.coverage, 1.0);
        assert_eq!(f.step, 60_000, "a point per interval when the visit is short");
        assert_eq!(f.states, "uuuuuuuddd");
        assert_eq!(f.rtt.len(), 10);
        assert_eq!(f.rtt[0], Some(10.0));
        assert_eq!(f.rtt[7], None, "no answer in that minute");
    }

    #[test]
    fn quiet_and_unknown_are_left_out() {
        let it = item("a/c", "a");
        let min = 60_000;
        // Up 2 min, quiet 2 min, then nothing for 6 min (the PC asleep).
        let s = vec![sample(0, true, 5.0, "up"), sample(min, true, 5.0, "up"), sample(2 * min, true, 5.0, "quiet"), sample(3 * min, true, 5.0, "quiet")];
        let f = item_figures(&it, &s, 0, 10 * min);
        assert_eq!(f.avail, Some(1.0), "quiet is maintenance, not down");
        assert_eq!(f.coverage, 0.4, "4 of 10 minutes measured");
        assert_eq!(f.states, "uuqq------", "the last state reaches one interval past it, as the coverage counts");
    }

    #[test]
    fn a_long_visit_has_at_most_48_points() {
        let it = item("a/c", "a");
        let min = 60_000;
        let s: Vec<Sample> = (0..300).map(|i| sample(i * min, true, (i % 7) as f64, "up")).collect();
        let f = item_figures(&it, &s, 0, 300 * min);
        assert!(f.rtt.len() <= SERIES_MAX && f.states.len() == f.rtt.len(), "{}", f.rtt.len());
        assert_eq!(f.step % 1000, 0);
        assert!(f.step as usize * f.rtt.len() >= 300 * min as usize);
        // Nothing asked: no loss, no availability, nothing measured.
        let none = item_figures(&it, &[], 0, 10 * min);
        assert_eq!((none.loss, none.avail, none.med, none.coverage), (None, None, None, 0.0));
        assert_eq!(none.states, "-".repeat(10));
    }

    #[test]
    fn a_tcp_ping_says_so() {
        let it = item("a/c", "a");
        let mut s = sample(0, true, 1.0, "up");
        s.via = "tcp".into();
        assert_eq!(item_figures(&it, &[s], 0, 60_000).via, "tcp");
    }

    #[test]
    fn outages_per_device_with_root_cause() {
        let mut o = Outages::default();
        let names: HashMap<String, String> = [("r1".to_string(), "R1".to_string()), ("sw".to_string(), "SW".to_string())].into_iter().collect();
        assert!(o.update(&[status("r1/p", "r1", "down", 100, None)], &names, 150));
        assert!(o.update(&[status("sw/p", "sw", "down", 120, Some("r1"))], &names, 160));
        assert_eq!(o.list.len(), 2);
        assert_eq!((o.list[0].name.as_str(), o.list[0].from, o.list[0].to), ("R1", 100, None));
        assert_eq!(o.list[1].cause.as_deref(), Some("r1"));
        // A second check of R1 down: still one outage.
        assert!(!o.update(&[status("r1/h", "r1", "down", 130, None)], &names, 170));
        assert_eq!(o.list.len(), 2);
        // One check of R1 answers: R1 is still down (its web page is not).
        assert!(!o.update(&[status("r1/p", "r1", "up", 200, None)], &names, 200));
        // Both answer: the outage ends.
        assert!(o.update(&[status("r1/h", "r1", "up", 210, None)], &names, 210));
        assert_eq!(o.list[0].to, Some(210));
        // Down again: a new outage.
        assert!(o.update(&[status("r1/p", "r1", "down", 300, None)], &names, 300));
        assert_eq!(o.list.len(), 3);
        // Stop closes what goes on.
        o.close(400);
        assert!(o.list.iter().all(|x| x.to.is_some()));
        assert_eq!(o.list[1].to, Some(400));
        // Unknown or quiet are not outages.
        let mut q = Outages::default();
        assert!(!q.update(&[status("a/p", "a", "unknown", 0, None), status("b/p", "b", "quiet", 0, None)], &names, 10));
        assert!(q.list.is_empty());
    }

    fn wait_for(cond: impl Fn() -> bool, ms: u64) -> bool {
        let end = Instant::now() + Duration::from_millis(ms);
        while Instant::now() < end {
            if cond() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        cond()
    }

    fn fast(key: &str, node: &str) -> Item {
        let mut it = item(key, node);
        it.interval_ms = 30;
        it
    }

    #[test]
    fn a_session_checks_keeps_figures_at_stop_and_drops_the_samples() {
        let down = Arc::new(AtomicBool::new(false));
        let d2 = down.clone();
        let runner: Runner = Arc::new(move |spec: &Spec| {
            if spec.host == "10.0.0.2" && d2.load(Ordering::SeqCst) {
                Outcome { status: "timeout".into(), via: "icmp".into(), ..Default::default() }
            } else {
                Outcome { ok: true, rtt_ms: Some(3.0), status: "echo".into(), via: "icmp".into(), ..Default::default() }
            }
        });
        let heard: Arc<Mutex<Vec<Outage>>> = Arc::new(Mutex::new(Vec::new()));
        let h2 = heard.clone();
        let notify: Notify = Arc::new(move |_s, o| {
            if let Some(o) = o {
                *h2.lock().unwrap() = o;
            }
        });
        let a = fast("r1/p", "r1");
        let mut b = fast("sw/p", "sw");
        b.spec.host = "10.0.0.2".into();
        let meta = Meta { network_id: "net".into(), kept: true, ..Default::default() };
        let mut s = Session::start_items(runner, vec![a, b], meta, notify);
        assert!(wait_for(|| s.statuses().iter().filter(|x| x.state == "up").count() == 2, 3000), "both up");
        down.store(true, Ordering::SeqCst);
        assert!(wait_for(|| heard.lock().unwrap().iter().any(|o| o.node_id == "sw" && o.to.is_none()), 3000), "the switch's outage heard");
        assert!(s.sample_count() > 4);
        let live = s.figures(monitor::now_ms()).expect("figures while it runs");
        assert_eq!(live.items.len(), 2);
        assert!(live.items.iter().all(|i| i.asked > 0));
        assert_eq!(live.outages.len(), 1);
        s.stop(monitor::now_ms());
        assert!(!s.running());
        assert_eq!(s.sample_count(), 0, "the samples are gone at Stop");
        let kept = s.figures(monitor::now_ms()).expect("the figures stay after Stop");
        assert!(kept.items.iter().any(|i| i.node_id == "sw" && i.loss.unwrap_or(0.0) > 0.0));
        assert!(kept.outages.iter().all(|o| o.to.is_some()), "Stop ends the outages");
    }

    #[test]
    fn a_check_leaving_the_plan_ends_its_outage() {
        let mut o = Outages::default();
        let names: HashMap<String, String> = [("sw".to_string(), "SW".to_string()), ("r1".to_string(), "R1".to_string())].into_iter().collect();
        o.update(&[status("sw/p", "sw", "down", 100, None), status("sw/h", "sw", "down", 100, Some("r1")), status("r1/p", "r1", "down", 100, None)], &names, 110);
        assert_eq!(o.list.len(), 2);
        // sw/p goes: sw is still down through sw/h, now with its cause.
        let keep: HashSet<String> = ["sw/h".to_string(), "r1/p".to_string()].into_iter().collect();
        assert!(o.forget(&keep, 200));
        let sw = o.list.iter().find(|x| x.node_id == "sw").unwrap();
        assert_eq!((sw.to, sw.cause.as_deref()), (None, Some("r1")));
        // The switch is replaced: its last check goes, its outage ends now.
        let keep: HashSet<String> = ["r1/p".to_string()].into_iter().collect();
        assert!(o.forget(&keep, 300));
        assert_eq!(o.list.iter().find(|x| x.node_id == "sw").unwrap().to, Some(300));
        assert_eq!(o.list.iter().find(|x| x.node_id == "r1").unwrap().to, None, "R1 still down");
        // Nothing gone: nothing changes.
        assert!(!o.forget(&keep, 400));
        // Stop later does not stretch the switch's outage to the end.
        o.close(900);
        assert_eq!(o.list.iter().find(|x| x.node_id == "sw").unwrap().to, Some(300));
    }

    #[test]
    fn a_device_removed_while_down_in_a_session() {
        let runner: Runner = Arc::new(|spec: &Spec| {
            if spec.host == "10.0.0.2" {
                Outcome { status: "timeout".into(), via: "icmp".into(), ..Default::default() }
            } else {
                Outcome { ok: true, rtt_ms: Some(2.0), status: "echo".into(), via: "icmp".into(), ..Default::default() }
            }
        });
        let heard: Arc<Mutex<Vec<Outage>>> = Arc::new(Mutex::new(Vec::new()));
        let h2 = heard.clone();
        let notify: Notify = Arc::new(move |_s, o| {
            if let Some(o) = o {
                *h2.lock().unwrap() = o;
            }
        });
        let a = fast("r1/p", "r1");
        let mut b = fast("sw/p", "sw");
        b.spec.host = "10.0.0.2".into();
        let mut s = Session::start_items(runner, vec![a.clone(), b], Meta { kept: true, ..Default::default() }, notify);
        assert!(wait_for(|| heard.lock().unwrap().iter().any(|o| o.node_id == "sw" && o.to.is_none()), 3000), "the switch down");
        s.set_items(vec![a]);
        assert!(heard.lock().unwrap().iter().any(|o| o.node_id == "sw" && o.to.is_some()), "its outage ended when it left");
        let ended_at = s.outages().iter().find(|o| o.node_id == "sw").unwrap().to;
        std::thread::sleep(Duration::from_millis(60));
        s.stop(monitor::now_ms());
        let f = s.figures(monitor::now_ms()).unwrap();
        assert_eq!(f.outages.iter().find(|o| o.node_id == "sw").unwrap().to, ended_at, "Stop does not stretch it");
    }

    #[test]
    fn nothing_after_stop() {
        // A check still running at Stop finishes later: no sample, no
        // change, no outage, nothing told.
        let gate = Arc::new(AtomicBool::new(false));
        let started = Arc::new(AtomicBool::new(false));
        let (g2, st2) = (gate.clone(), started.clone());
        let runner: Runner = Arc::new(move |_spec: &Spec| {
            st2.store(true, Ordering::SeqCst);
            while !g2.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(5));
            }
            Outcome { status: "timeout".into(), via: "icmp".into(), ..Default::default() }
        });
        let told = Arc::new(Mutex::new(0usize));
        let t2 = told.clone();
        let notify: Notify = Arc::new(move |s, o| {
            if !s.is_empty() || o.is_some() {
                *t2.lock().unwrap() += 1;
            }
        });
        let mut s = Session::start_items(runner, vec![fast("a/p", "a")], Meta { kept: true, ..Default::default() }, notify);
        assert!(wait_for(|| started.load(Ordering::SeqCst), 3000), "a check is running");
        s.stop(monitor::now_ms());
        let before = *told.lock().unwrap();
        gate.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(*told.lock().unwrap(), before, "nothing told after Stop");
        assert_eq!(s.sample_count(), 0);
        assert!(s.outages().is_empty(), "no outage opened after Stop");
        assert!(s.statuses.lock().unwrap().values().all(|x| x.state != "down"));
    }

    #[test]
    fn a_visit_session_never_reaches_the_issues_or_the_alarm() {
        // Its only way out is the page's event (D148, D291): no issue
        // record, no alarm card, no notification, nothing pushed.
        for (name, src) in [("visitmon.rs", include_str!("visitmon.rs")), ("visitcmd.rs", include_str!("visitcmd.rs"))] {
            let code: String = src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
            let code = code.split("#[cfg(test)]").next().unwrap_or("");
            for bad in ["issues::", "alarm::", "monitorlink::", "client::", "notification", "IssueStore", "show_alarm"] {
                assert!(!code.contains(bad), "{name} uses {bad}");
            }
        }
    }

    #[test]
    fn statistics_off_keeps_no_sample_and_no_figures() {
        let runner: Runner = Arc::new(|_spec: &Spec| Outcome { ok: true, rtt_ms: Some(1.0), status: "echo".into(), via: "icmp".into(), ..Default::default() });
        let notify: Notify = Arc::new(|_s, _o| {});
        let a = fast("a/p", "a");
        let mut s = Session::start_items(runner, vec![a], Meta { kept: false, ..Default::default() }, notify);
        assert!(wait_for(|| s.statuses().iter().any(|x| x.state == "up"), 3000), "the states still show");
        assert_eq!(s.sample_count(), 0);
        assert!(s.figures(monitor::now_ms()).is_none());
        s.stop(monitor::now_ms());
        assert!(s.figures(monitor::now_ms()).is_none());
    }
}
