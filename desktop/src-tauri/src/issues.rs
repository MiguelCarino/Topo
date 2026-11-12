// Issues: what an outage becomes (docs/SCOPE.md D132, D158, D173, step
// 7g). No Tauri here, so the tests drive it with statuses made by hand.
//
// The monitor (src/monitor.rs) says how each check is; this file turns the
// statuses into issue records, one per root-cause outage:
//
//   opened     a device with a check down and no device upstream down
//              (its own outage, D161) gets an issue, unless one is still
//              open for it: then the outage is added to that one (a
//              repeat). A device down because of one upstream gets none;
//              it is listed on the upstream device's issue ("R1 and 12
//              items behind it").
//   recovered  every check of the device answers again (none down, one
//              up): the outage ends, "answering again since", but the
//              issue stays open until a person acts (D132). Unknown or
//              quiet is not answering again.
//   acted      Acknowledge, Report a problem or Expected closes it, with
//              who, when and the note; a second act (two installs at once)
//              is kept beside the first, and the first closes it. After an
//              act the outage that is still going on stays on that issue
//              (no new alarm) until the device answers again.
//   expected   while an issue closed as Expected has its outage going on,
//              the device's down state is shown and recorded as quiet
//              (maintenance), and the time since the outage began is
//              relabelled as maintenance in the statistics (D158).
//
// Records are this PC's (D173): the page folds them into the document's
// incidents (kind "outage") when the monitored network is open, and says
// which it folded; a closed record whose outage has ended goes once folded.
// Kept in <app data>/monitor/issues.json by src/monitorcmd.rs.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::monitor::Status;

/// At most this many outages on one issue (the oldest go).
pub const OUTAGES_MAX: usize = 50;
/// At most this many acts on one issue.
pub const ACTS_MAX: usize = 20;
/// At most this many records kept (the oldest closed go first).
pub const ISSUES_MAX: usize = 500;
/// A closed record is kept at most this long, folded or not.
pub const CLOSED_KEEP_MS: i64 = 30 * 86_400_000;
pub const ACTS: [&str; 3] = ["ack", "report", "expected"];
/// Who acted, in characters (js/issues.js whoActs).
pub const BY_MAX: usize = 120;
/// An act's note, in characters (js/incidents.js INCIDENT_TEXT_MAX).
pub const NOTE_MAX: usize = 2000;

/// The first `n` characters (never a cut inside one, as String::truncate
/// would panic on).
pub fn cut_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Outage {
    pub from: i64,
    /// When it answered again; None while it goes on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<i64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Act {
    /// ack, report or expected.
    pub act: String,
    pub at: i64,
    pub by: String,
    pub note: String,
    /// Report a problem: the report's id in the document.
    pub report_id: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Issue {
    /// "in" and 10 base-36 characters: the incident's id when folded.
    pub id: String,
    pub network_id: String,
    pub node_id: String,
    /// The device's name when it opened (the card's, with no window open).
    pub name: String,
    /// Its checks that were down, the latest outage.
    pub keys: Vec<String>,
    /// The devices down because of it, the latest outage.
    pub behind: Vec<String>,
    pub outages: Vec<Outage>,
    pub flapping: bool,
    /// Which monitor saw it (this PC's name, D158).
    pub monitor: String,
    pub acts: Vec<Act>,
    /// When the first act closed it.
    pub closed: Option<i64>,
    /// The device left the plan while down: its outage ended unseen.
    pub gone: bool,
    /// Bumped on every change (the page folds a record once per rev).
    pub rev: u64,
}

impl Issue {
    pub fn ongoing(&self) -> bool {
        self.outages.last().map(|o| o.to.is_none()).unwrap_or(false)
    }
    /// Answering again since (the last outage ended), while it waits.
    pub fn recovered(&self) -> Option<i64> {
        if self.gone {
            return None;
        }
        self.outages.last().and_then(|o| o.to)
    }
    /// When the outage now (or the last one) began.
    pub fn since(&self) -> i64 {
        self.outages.last().map(|o| o.from).unwrap_or(0)
    }
    pub fn is_open(&self) -> bool {
        self.closed.is_none()
    }
    pub fn expected(&self) -> bool {
        self.acts.iter().any(|a| a.act == "expected")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    Opened,
    Repeated,
    Recovered,
    Updated,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Issues {
    pub list: Vec<Issue>,
}

#[derive(Default)]
struct NodeNow {
    root_down: bool,
    any_up: bool,
    any_down: bool,
    flapping: bool,
    since: Option<i64>,
    keys: BTreeSet<String>,
}

impl Issues {
    pub fn get(&self, id: &str) -> Option<&Issue> {
        self.list.iter().find(|i| i.id == id)
    }

    /// The devices of the network watched whose issue was closed as
    /// Expected while the outage goes on: their down time is maintenance.
    /// Another network's (a copy can share node ids) masks nothing here.
    pub fn expected_nodes(&self, network_id: &str) -> HashSet<String> {
        self.list.iter().filter(|i| i.network_id == network_id && !i.is_open() && i.expected() && i.ongoing()).map(|i| i.node_id.clone()).collect()
    }

    /// The monitor now watches `network_id` (or nothing): the outages of
    /// every other network that are still going on end unseen, as for a
    /// device taken out of the plan (D243, D253), so none stays "not
    /// answering" for ever and the closed ones can go.
    pub fn end_others(&mut self, network_id: &str, now: i64) -> Vec<(Change, Issue)> {
        let mut out = Vec::new();
        for i in self.list.iter_mut().filter(|i| i.network_id != network_id && i.ongoing()) {
            if let Some(o) = i.outages.last_mut() {
                o.to = Some(now.max(o.from));
            }
            i.gone = true;
            i.rev += 1;
            out.push((Change::Updated, i.clone()));
        }
        out
    }

    /// The statuses now (every item of the plan) -> what changed.
    /// `names`: node id -> its name; `mint` makes a new id.
    pub fn update(
        &mut self,
        network_id: &str,
        monitor: &str,
        statuses: &HashMap<String, Status>,
        names: &HashMap<String, String>,
        now: i64,
        mint: &mut dyn FnMut() -> String,
    ) -> Vec<(Change, Issue)> {
        let mut nodes: HashMap<&str, NodeNow> = HashMap::new();
        let mut behind: HashMap<&str, BTreeSet<String>> = HashMap::new();
        for s in statuses.values() {
            let n = nodes.entry(s.node_id.as_str()).or_default();
            n.flapping |= s.flapping;
            match s.state.as_str() {
                "up" => n.any_up = true,
                "down" => {
                    n.any_down = true;
                    match &s.cause {
                        Some(c) if c != &s.node_id => {
                            behind.entry(c.as_str()).or_default().insert(s.node_id.clone());
                        }
                        _ => {
                            n.root_down = true;
                            n.keys.insert(s.key.clone());
                            n.since = Some(n.since.map(|x| x.min(s.since)).unwrap_or(s.since));
                        }
                    }
                }
                _ => {}
            }
        }
        // A device that is itself down because of another: not "behind" it
        // when it is also its own outage.
        let mut out: Vec<(Change, Issue)> = Vec::new();
        let mut touched: HashMap<String, Change> = HashMap::new();
        let mark = |touched: &mut HashMap<String, Change>, id: &str, c: Change| {
            let e = touched.entry(id.to_string()).or_insert(c);
            if c != Change::Updated {
                *e = c;
            }
        };

        // Devices down on their own.
        let mut down_nodes: Vec<(&str, &NodeNow)> = nodes.iter().filter(|(_, n)| n.root_down).map(|(k, v)| (*k, v)).collect();
        down_nodes.sort_by_key(|(k, _)| k.to_string());
        for (node, n) in down_nodes {
            let since = n.since.unwrap_or(now);
            let keys: Vec<String> = n.keys.iter().cloned().collect();
            let bh: Vec<String> = behind.get(node).map(|b| b.iter().filter(|x| x.as_str() != node).cloned().collect()).unwrap_or_default();
            // Still the same outage (open or already acted on).
            if let Some(i) = self.list.iter_mut().rev().find(|i| i.network_id == network_id && i.node_id == node && i.ongoing()) {
                let mut changed = false;
                if i.keys != keys {
                    i.keys = keys;
                    changed = true;
                }
                if i.behind != bh {
                    i.behind = bh;
                    changed = true;
                }
                if n.flapping && !i.flapping {
                    i.flapping = true;
                    changed = true;
                }
                if changed {
                    i.rev += 1;
                    mark(&mut touched, &i.id.clone(), Change::Updated);
                }
                continue;
            }
            // A repeat while its issue is open.
            if let Some(i) = self.list.iter_mut().rev().find(|i| i.network_id == network_id && i.node_id == node && i.is_open()) {
                i.outages.push(Outage { from: since, to: None });
                if i.outages.len() > OUTAGES_MAX {
                    let cut = i.outages.len() - OUTAGES_MAX;
                    i.outages.drain(0..cut);
                }
                i.keys = keys;
                i.behind = bh;
                i.flapping |= n.flapping;
                i.gone = false;
                i.rev += 1;
                mark(&mut touched, &i.id.clone(), Change::Repeated);
                continue;
            }
            let issue = Issue {
                id: mint(),
                network_id: network_id.to_string(),
                node_id: node.to_string(),
                name: names.get(node).cloned().unwrap_or_default(),
                keys,
                behind: bh,
                outages: vec![Outage { from: since, to: None }],
                flapping: n.flapping,
                monitor: monitor.to_string(),
                acts: Vec::new(),
                closed: None,
                gone: false,
                rev: 1,
            };
            mark(&mut touched, &issue.id, Change::Opened);
            self.list.push(issue);
        }

        // Outages going on whose device is not down on its own any more.
        for i in self.list.iter_mut().filter(|i| i.network_id == network_id && i.ongoing()) {
            let node = i.node_id.as_str();
            match nodes.get(node) {
                Some(n) if n.root_down => {}
                Some(n) if n.any_up && !n.any_down => {
                    if let Some(o) = i.outages.last_mut() {
                        o.to = Some(now);
                    }
                    i.rev += 1;
                    mark(&mut touched, &i.id.clone(), Change::Recovered);
                }
                Some(n) => {
                    // Down because of a device upstream now, quiet or not
                    // known: the outage goes on; who is behind it may change.
                    let bh: Vec<String> = behind.get(node).map(|b| b.iter().cloned().collect()).unwrap_or_default();
                    let mut changed = false;
                    if i.behind != bh && n.any_down {
                        i.behind = bh;
                        changed = true;
                    }
                    if changed {
                        i.rev += 1;
                        mark(&mut touched, &i.id.clone(), Change::Updated);
                    }
                }
                None => {
                    // Gone from the plan: its outage ends, unseen.
                    if let Some(o) = i.outages.last_mut() {
                        o.to = Some(now);
                    }
                    i.gone = true;
                    i.rev += 1;
                    mark(&mut touched, &i.id.clone(), Change::Updated);
                }
            }
        }
        for i in &self.list {
            if let Some(c) = touched.get(&i.id) {
                out.push((*c, i.clone()));
            }
        }
        out
    }

    /// A person acts on an issue. Returns the issue as it is now, or None
    /// when there is no such issue or the act is not one.
    pub fn act(&mut self, id: &str, a: Act) -> Option<Issue> {
        if !ACTS.contains(&a.act.as_str()) || a.at <= 0 {
            return None;
        }
        let i = self.list.iter_mut().find(|i| i.id == id)?;
        // Cut by characters, as the page does (whoActs 120, the note
        // INCIDENT_TEXT_MAX), and before the comparison: a cut act matches
        // its source, so the page's act|at|by key is the same on both sides.
        let mut a = a;
        a.by = cut_chars(&a.by, BY_MAX);
        a.note = cut_chars(&a.note, NOTE_MAX);
        a.report_id = cut_chars(&a.report_id, 64);
        let same = i.acts.iter().any(|x| x.act == a.act && x.at == a.at && x.by == a.by);
        if !same {
            i.acts.push(a);
            i.acts.sort_by_key(|x| x.at);
            i.acts.truncate(ACTS_MAX);
            i.closed = i.acts.first().map(|x| x.at);
            i.rev += 1;
        }
        Some(i.clone())
    }

    /// The page found these (id, rev) in the document as the record says
    /// (D254: in a document it did not fold them into this session, so no
    /// undo can take them back out): a closed record whose outage has ended
    /// goes; the rest stay until they change again. `dropped`: records whose
    /// device is no longer in the document; they go once their outage is
    /// over (one still going on ends as "gone" when the plan loses the
    /// device, and goes at the next fold).
    pub fn folded(&mut self, done: &[(String, u64)], dropped: &[String]) -> usize {
        let before = self.list.len();
        let done: HashMap<&str, u64> = done.iter().map(|(i, r)| (i.as_str(), *r)).collect();
        let dropped: HashSet<&str> = dropped.iter().map(|x| x.as_str()).collect();
        self.list.retain(|i| {
            let ended = !i.ongoing();
            !((done.get(i.id.as_str()) == Some(&i.rev) && !i.is_open() && ended) || (dropped.contains(i.id.as_str()) && ended))
        });
        before - self.list.len()
    }

    /// Old closed records and the cap.
    pub fn prune(&mut self, now: i64) {
        self.list.retain(|i| !(i.closed.map(|c| now - c > CLOSED_KEEP_MS).unwrap_or(false) && !i.ongoing()));
        while self.list.len() > ISSUES_MAX {
            let at = self.list.iter().position(|i| !i.is_open()).unwrap_or(0);
            self.list.remove(at);
        }
    }
}

/// A new issue id: "in" and 10 base-36 characters (the incidents' form).
pub fn mint_id() -> String {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut b = [0u8; 10];
    let _ = SystemRandom::new().fill(&mut b);
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut s = String::from("in");
    for x in b {
        s.push(digits[(x % 36) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(key: &str, node: &str, state: &str, cause: Option<&str>, since: i64) -> Status {
        Status { key: key.into(), node_id: node.into(), state: state.into(), cause: cause.map(|c| c.to_string()), since, ..Default::default() }
    }
    fn map(v: Vec<Status>) -> HashMap<String, Status> {
        v.into_iter().map(|s| (s.key.clone(), s)).collect()
    }
    fn names() -> HashMap<String, String> {
        [("r1", "Router R1"), ("sw", "Switch"), ("p1", "Printer"), ("p2", "Camera")].iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }
    fn minter() -> impl FnMut() -> String {
        let mut n = 0;
        move || {
            n += 1;
            format!("in{n:010}")
        }
    }
    fn act(kind: &str, at: i64, by: &str) -> Act {
        Act { act: kind.into(), at, by: by.into(), note: String::new(), report_id: String::new() }
    }

    #[test]
    fn opened_once_per_outage_with_the_items_behind() {
        let mut is = Issues::default();
        let mut mint = minter();
        let all_up = map(vec![st("r1/p", "r1", "up", None, 0), st("sw/p", "sw", "up", None, 0), st("p1/p", "p1", "up", None, 0)]);
        assert!(is.update("net", "pc", &all_up, &names(), 10, &mut mint).is_empty());
        // R1 down, the switch and the printer behind it.
        let down = map(vec![st("r1/p", "r1", "down", None, 100), st("r1/w", "r1", "down", None, 110), st("sw/p", "sw", "down", Some("r1"), 120), st("p1/p", "p1", "down", Some("r1"), 130)]);
        let ch = is.update("net", "pc", &down, &names(), 140, &mut mint);
        assert_eq!(ch.len(), 1, "one issue, the root cause's: {ch:?}");
        let (c, i) = &ch[0];
        assert_eq!(*c, Change::Opened);
        assert_eq!(i.node_id, "r1");
        assert_eq!(i.name, "Router R1");
        assert_eq!(i.behind, vec!["p1".to_string(), "sw".to_string()]);
        assert_eq!(i.keys, vec!["r1/p".to_string(), "r1/w".to_string()]);
        assert_eq!(i.since(), 100, "when it was first seen down");
        assert_eq!(i.monitor, "pc");
        assert!(i.id.starts_with("in"));
        // The same statuses again: nothing new.
        assert!(is.update("net", "pc", &down, &names(), 150, &mut mint).is_empty());
        assert_eq!(is.list.len(), 1);
    }

    #[test]
    fn recovery_leaves_it_open_and_a_repeat_joins_it() {
        let mut is = Issues::default();
        let mut mint = minter();
        let down = map(vec![st("p1/p", "p1", "down", None, 100)]);
        is.update("net", "pc", &down, &names(), 100, &mut mint);
        let up = map(vec![st("p1/p", "p1", "up", None, 200)]);
        let ch = is.update("net", "pc", &up, &names(), 200, &mut mint);
        assert_eq!(ch[0].0, Change::Recovered);
        let i = &is.list[0];
        assert!(i.is_open(), "recovery does not close it (D132)");
        assert_eq!(i.recovered(), Some(200));
        // Unknown or quiet is not answering again.
        let mut is2 = Issues::default();
        is2.update("net", "pc", &down, &names(), 100, &mut mint);
        assert!(is2.update("net", "pc", &map(vec![st("p1/p", "p1", "unknown", None, 150)]), &names(), 150, &mut mint).is_empty());
        assert!(is2.list[0].ongoing());
        // Down again while open: the same issue, a second outage.
        let ch = is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 300)]), &names(), 300, &mut mint);
        assert_eq!(ch.len(), 1);
        assert_eq!(ch[0].0, Change::Repeated);
        assert_eq!(is.list.len(), 1);
        assert_eq!(is.list[0].outages.len(), 2);
        assert_eq!(is.list[0].recovered(), None);
        assert_eq!(is.list[0].since(), 300);
    }

    #[test]
    fn each_act_closes_it_and_is_recorded() {
        for kind in ACTS {
            let mut is = Issues::default();
            let mut mint = minter();
            is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 100)]), &names(), 100, &mut mint);
            let id = is.list[0].id.clone();
            let mut a = act(kind, 500, "Ana");
            a.note = "on it".into();
            let i = is.act(&id, a).unwrap();
            assert_eq!(i.closed, Some(500), "{kind}");
            assert_eq!(i.acts.len(), 1);
            assert_eq!(i.acts[0].by, "Ana");
            assert_eq!(i.acts[0].note, "on it");
            assert_eq!(i.expected(), kind == "expected");
            assert_eq!(is.expected_nodes("net").contains("p1"), kind == "expected", "Expected masks the outage going on");
            // Still down after the act: no new issue, no alarm.
            assert!(is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 100)]), &names(), 600, &mut mint).is_empty());
            // It answers: the outage ends on the closed issue.
            let ch = is.update("net", "pc", &map(vec![st("p1/p", "p1", "up", None, 700)]), &names(), 700, &mut mint);
            assert_eq!(ch[0].0, Change::Recovered);
            assert!(is.expected_nodes("net").is_empty());
            // Down again: a new issue.
            let ch = is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 800)]), &names(), 800, &mut mint);
            assert_eq!(ch[0].0, Change::Opened, "{kind}");
            assert_eq!(is.list.len(), 2);
        }
        let mut is = Issues::default();
        assert!(is.act("nope", act("ack", 1, "x")).is_none());
        let mut mint = minter();
        is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 1)]), &names(), 1, &mut mint);
        let id = is.list[0].id.clone();
        assert!(is.act(&id, act("close", 5, "x")).is_none(), "not an act");
    }

    #[test]
    fn two_installs_acting_at_once() {
        let mut is = Issues::default();
        let mut mint = minter();
        is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 1)]), &names(), 1, &mut mint);
        let id = is.list[0].id.clone();
        is.act(&id, act("ack", 900, "B")).unwrap();
        let i = is.act(&id, act("expected", 800, "A")).unwrap();
        assert_eq!(i.acts.iter().map(|a| a.by.as_str()).collect::<Vec<_>>(), vec!["A", "B"], "both kept, oldest first");
        assert_eq!(i.closed, Some(800), "the first closes it");
        let rev = i.rev;
        let i = is.act(&id, act("ack", 900, "B")).unwrap();
        assert_eq!((i.acts.len(), i.rev), (2, rev), "the same act twice is one");
    }

    #[test]
    fn root_cause_moves_and_flapping_and_gone() {
        let mut is = Issues::default();
        let mut mint = minter();
        // The printer down alone: its own issue.
        is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 1), st("r1/p", "r1", "up", None, 0)]), &names(), 1, &mut mint);
        // Then R1 goes down too: R1 gets an issue listing the printer; the
        // printer's own outage goes on (not recovered).
        let ch = is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", Some("r1"), 1), st("r1/p", "r1", "down", None, 5)]), &names(), 5, &mut mint);
        assert!(ch.iter().any(|(c, i)| *c == Change::Opened && i.node_id == "r1" && i.behind == vec!["p1".to_string()]));
        assert!(is.list.iter().find(|i| i.node_id == "p1").unwrap().ongoing());
        // Flapping marks it, stays one issue.
        let mut s = st("r1/p", "r1", "down", None, 5);
        s.flapping = true;
        let ch = is.update("net", "pc", &map(vec![s]), &names(), 6, &mut mint);
        assert!(ch.iter().any(|(_, i)| i.node_id == "r1" && i.flapping));
        assert_eq!(is.list.iter().filter(|i| i.node_id == "r1").count(), 1);
        // Taken out of the plan: the outage ends unseen, not "answering again".
        let ch = is.update("net", "pc", &HashMap::new(), &names(), 9, &mut mint);
        assert!(ch.iter().all(|(c, i)| *c == Change::Updated && i.gone && i.recovered().is_none()));
        // Another network's statuses do not touch these.
        let mut is2 = Issues::default();
        is2.update("a", "pc", &map(vec![st("p1/p", "p1", "down", None, 1)]), &names(), 1, &mut mint);
        let ch = is2.update("b", "pc", &map(vec![st("p1/p", "p1", "down", None, 1)]), &names(), 2, &mut mint);
        assert_eq!(ch[0].0, Change::Opened);
        assert_eq!(is2.list.len(), 2);
    }

    #[test]
    fn folded_closed_records_go() {
        let mut is = Issues::default();
        let mut mint = minter();
        is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 1)]), &names(), 1, &mut mint);
        let id = is.list[0].id.clone();
        let r = is.list[0].rev;
        assert_eq!(is.folded(&[(id.clone(), r)], &[]), 0, "open: kept");
        is.act(&id, act("ack", 5, "A"));
        let r = is.list[0].rev;
        assert_eq!(is.folded(&[(id.clone(), r)], &[]), 0, "closed but still down: kept");
        is.update("net", "pc", &map(vec![st("p1/p", "p1", "up", None, 9)]), &names(), 9, &mut mint);
        assert_eq!(is.folded(&[(id.clone(), r)], &[]), 0, "an older rev: kept");
        let r = is.list[0].rev;
        assert_eq!(is.folded(&[(id, r)], &[]), 1);
        assert!(is.list.is_empty());
        // The cap and the age.
        for k in 0..(ISSUES_MAX + 3) {
            let mut i = Issue { id: format!("in{k:010}"), closed: Some(1), outages: vec![Outage { from: 0, to: Some(1) }], ..Default::default() };
            if k == 0 {
                i.closed = None;
            }
            is.list.push(i);
        }
        is.prune(2);
        assert_eq!(is.list.len(), ISSUES_MAX);
        assert!(is.list.iter().any(|i| i.is_open()), "an open one stays");
        is.prune(2 + CLOSED_KEEP_MS);
        assert_eq!(is.list.len(), 1);
        // Kept on disk and read back the same.
        let json = serde_json::to_string(&is).unwrap();
        assert_eq!(serde_json::from_str::<Issues>(&json).unwrap(), is);
        assert!(mint_id().len() == 12 && mint_id().starts_with("in") && mint_id() != mint_id());
    }

    #[test]
    fn long_names_and_notes_are_cut_by_characters() {
        let mut is = Issues::default();
        let mut mint = minter();
        is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 1)]), &names(), 1, &mut mint);
        let id = is.list[0].id.clone();
        // Cyrillic and Japanese: 2 and 3 bytes a character; a byte cut would
        // land inside one and panic (with the issues' lock held).
        let by: String = "Ж".repeat(130);
        let mut a = act("ack", 5, &by);
        a.note = "障".repeat(2100) + "x";
        let i = is.act(&id, a.clone()).expect("no panic");
        assert_eq!(i.acts[0].by.chars().count(), BY_MAX);
        assert_eq!(i.acts[0].note.chars().count(), NOTE_MAX);
        // The same act sent again uncut (the page's copy, or the card's) is
        // the same act: no second one, no new rev, so no fold loop.
        let rev = i.rev;
        let i = is.act(&id, a).unwrap();
        assert_eq!((i.acts.len(), i.rev), (1, rev));
        // And as the page cuts it (120 characters) it is the same too.
        let i = is.act(&id, act("ack", 5, &"Ж".repeat(120))).unwrap();
        assert_eq!((i.acts.len(), i.rev), (1, rev));
        assert_eq!(cut_chars("añ", 2), "añ");
    }

    #[test]
    fn another_network_watched_ends_the_old_outages() {
        let mut is = Issues::default();
        let mut mint = minter();
        is.update("a", "pc", &map(vec![st("p1/p", "p1", "down", None, 1), st("p2/p", "p2", "down", None, 1)]), &names(), 1, &mut mint);
        let p2 = is.list.iter().find(|i| i.node_id == "p2").unwrap().id.clone();
        is.act(&p2, act("expected", 3, "A"));
        assert!(is.expected_nodes("a").contains("p2"));
        assert!(is.expected_nodes("b").is_empty(), "a copy with the same ids is not masked");
        // The plan moves to network b.
        let ch = is.end_others("b", 10);
        assert_eq!(ch.len(), 2);
        assert!(ch.iter().all(|(c, i)| *c == Change::Updated && i.gone && !i.ongoing() && i.recovered().is_none()));
        assert!(is.expected_nodes("a").is_empty(), "nothing masked once it ended");
        assert!(is.end_others("b", 11).is_empty(), "once");
        // The closed one can go now; the open one waits for a person.
        let r = is.get(&p2).unwrap().rev;
        assert_eq!(is.folded(&[(p2.clone(), r)], &[]), 1);
        assert_eq!(is.list.len(), 1);
        assert!(is.list[0].is_open());
        is.prune(11 + CLOSED_KEEP_MS * 2);
        assert_eq!(is.list.len(), 1, "an open record is never aged out");
    }

    #[test]
    fn a_record_whose_device_left_the_document_goes_once_ended() {
        let mut is = Issues::default();
        let mut mint = minter();
        is.update("net", "pc", &map(vec![st("p1/p", "p1", "down", None, 1)]), &names(), 1, &mut mint);
        let id = is.list[0].id.clone();
        assert_eq!(is.folded(&[], &[id.clone()]), 0, "still going on: kept until the plan loses it");
        is.update("net", "pc", &HashMap::new(), &names(), 5, &mut mint);
        assert!(is.list[0].gone);
        assert_eq!(is.folded(&[], &[id]), 1, "open, but its device is gone from the document");
    }
}
