// A site monitor's link to its server (docs/SCOPE.md D146-D151, D158,
// D159, D161, D162, D227, step 7h).
//
// An owner turns this PC into a site monitor from the page (js/monitors.js):
// the app makes the device keys here (src/servercrypto.rs) and keeps them in
// the keychain (src/keystore.rs); the page registers them with the server,
// adds the monitor to the signed roster and wraps the site key for it, then
// hands the token and the roster it trusts back here (`monitor_enroll`).
// From then on this thread works alone, with no person signed in and no
// window open:
//
// - it walks the site's rosters forward from the one it was given, so it
//   knows which owners may wrap the site key for it, and opens the key of
//   each epoch (a revoke elsewhere rotates it, and the new wrap is opened
//   here);
// - every minute (sooner when a state changes) it seals and signs its
//   status: the heartbeat the server watches (D151);
// - each issue that changed goes as a signed issue record (D158);
// - the hourly figures of today (and yesterday, early in the day) go as one
//   blob per day (D161), unless the site keeps none (D162);
// - it reads the people's records: owners' acts close its issues, owners'
//   quiet windows reach its checks (D227). A provider's act is checked
//   against what they cover by the owners' browsers, which can read the
//   network; this PC cannot, so it takes a provider's act only once an
//   owner's browser has passed it on as an owner's (js/monitors.js);
// - it follows the site's Keep statistics;
// - it tells this PC (with Show alarms on) when another monitor of the site
//   stopped reporting (D151);
// - a credential the server no longer knows (401: revoked) turns the
//   monitor off here and forgets the keys.
//
// The I/O is behind two small traits so the logic is tested with a fake
// server (the tests below); the app's side is src/monitorcmd.rs.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::issues::{Act, Issue};
use crate::monitor::Status;
use crate::servercrypto::{self as sc, DeviceKeys, Record, RecordHead, Roster, Wrap};

/// The heartbeat (D151): the status goes at least this often.
pub const HEARTBEAT_MS: i64 = 60_000;
/// A changed state goes within this.
pub const SOON_MS: i64 = 5_000;
/// The statistics go this often.
pub const STATS_EVERY_MS: i64 = 10 * 60_000;
/// The site's settings, rosters and the other monitors are read this often.
pub const SITE_EVERY_MS: i64 = 60_000;
/// People's records are read this often.
pub const RECORDS_EVERY_MS: i64 = 15_000;
pub const DAY_MS: i64 = 86_400_000;

/// What the link keeps on disk (`<app config>/monitor-link.json`): no
/// secret (those are in the keychain).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LinkFile {
    pub origin: String,
    pub pin: String,
    pub site: String,
    pub monitor: String,
    pub name: String,
    pub by: String,
    pub enrolled_at: i64,
    /// The site's network (its library card id, D278): status, issues and
    /// statistics go only while this PC's monitor watches it, so another
    /// network kept here never reaches the site's members.
    pub network: String,
    /// The groups it checks (D150; none: the whole site). The page reads
    /// them to choose the checks it sends.
    pub groups: Vec<String>,
    /// The newest roster this PC trusts.
    pub roster: Option<Roster>,
    /// The last record read.
    pub last_n: i64,
    /// The site's Keep statistics last applied here (-1: not yet, so the
    /// first read always applies it).
    pub stats_days: i64,
    /// Where the secret is: "keychain" or "file" (Settings says which).
    pub key_kind: String,
    pub revoked: bool,
    /// The last thing that went wrong ("" when all is well).
    pub error: String,
    pub last_push: i64,
    /// Issue id -> the rev pushed.
    pub pushed: BTreeMap<String, u64>,
    /// The other monitors said to have stopped reporting (told once).
    pub stale_told: Vec<String>,
}

/// The secret: the device keys and the server credential.
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Secret {
    pub keys: String,
    pub token: String,
}

/// The server, as the link sees it.
pub trait Api {
    /// -> (status, body).
    fn call(&self, method: &str, path: &str, body: Option<&str>) -> Result<(u16, Vec<u8>), String>;
}

/// This PC's monitor, as the link sees it.
pub trait Host {
    /// The network this PC's monitor watches now ("" when none).
    fn network_id(&self) -> String;
    /// This PC's Keep statistics now (days, 0 = Off).
    fn current_retention(&self) -> u32;
    fn statuses(&self) -> Vec<Status>;
    fn issues(&self) -> Vec<Issue>;
    /// The hourly figures of one UTC day, per check, with each check's
    /// device; None when this PC keeps none.
    fn stats_day(&self, day: i64) -> Option<Value>;
    fn act(&self, issue: &str, a: Act);
    fn quiet(&self, scope: &str, id: &str, until: i64);
    fn retention(&self, days: u32);
    fn notify_stale(&self, name: &str);
    fn revoked(&self);
}

/// One run of the link (in memory: the keys opened, the timers).
pub struct Link {
    pub file: LinkFile,
    keys: DeviceKeys,
    /// Epoch -> the site key.
    site_keys: HashMap<i64, Vec<u8>>,
    epoch: i64,
    /// Every member's keys as the server gave them (checked against the
    /// trusted roster's fingerprints before use).
    pubs: HashMap<String, (String, String)>,
    last_status: i64,
    last_states: String,
    last_stats: i64,
    last_site: i64,
    last_records: i64,
    last_at: i64,
    /// 401s in a row: a revoke is taken only on the second (D279).
    unauthorized: u32,
    pub dirty: bool,
}

#[derive(Debug, PartialEq)]
pub enum TickError {
    Revoked,
    Other(String),
}

fn ok(status: u16) -> bool {
    (200..300).contains(&status)
}

/// A 401: the server's own answer (`{"error":"unauthorized"}`) may be a
/// revoke; anything else (a proxy's page) is a passing fault (D279).
fn unauthorized(body: &[u8]) -> TickError {
    match serde_json::from_slice::<Value>(body) {
        Ok(v) if v["error"] == "unauthorized" => TickError::Revoked,
        _ => TickError::Other("401 (not the server's answer)".into()),
    }
}

impl Link {
    pub fn new(file: LinkFile, keys: DeviceKeys) -> Link {
        Link {
            file,
            keys,
            site_keys: HashMap::new(),
            epoch: 0,
            pubs: HashMap::new(),
            last_status: 0,
            last_states: String::new(),
            last_stats: 0,
            last_site: 0,
            last_records: 0,
            last_at: 0,
            unauthorized: 0,
            dirty: false,
        }
    }

    fn get(&self, api: &dyn Api, path: &str) -> Result<Value, TickError> {
        let (st, body) = api.call("GET", path, None).map_err(TickError::Other)?;
        if st == 401 {
            return Err(unauthorized(&body));
        }
        if !ok(st) {
            return Err(TickError::Other(format!("{path}: {st}")));
        }
        serde_json::from_slice(&body).map_err(|_| TickError::Other(format!("{path}: not JSON")))
    }

    /// A strictly increasing time for this monitor's records (the server
    /// keeps only a newer one).
    fn at(&mut self, now: i64) -> i64 {
        self.last_at = now.max(self.last_at + 1);
        self.last_at
    }

    /// The owners of the trusted roster, with keys whose fingerprints are
    /// its lines'.
    fn owner_sig_pubs(&self) -> Vec<String> {
        let Some(r) = &self.file.roster else { return Vec::new() };
        r.members
            .iter()
            .filter(|m| m.role == "owner")
            .filter_map(|m| {
                let (_, sig) = self.pubs.get(&m.u)?;
                (sc::fp(sig).ok().as_deref() == Some(m.sig.as_str())).then(|| sig.clone())
            })
            .collect()
    }

    /// A member's ECDSA key, only when the trusted roster names them with
    /// that key, and their role there.
    fn trusted_member(&self, u: &str) -> Option<(String, String)> {
        let r = self.file.roster.as_ref()?;
        let line = r.member(u)?;
        let (_, sig) = self.pubs.get(u)?;
        (sc::fp(sig).ok().as_deref() == Some(line.sig.as_str())).then(|| (sig.clone(), line.role.clone()))
    }

    /// The site: its epoch, Keep statistics, the rosters since the trusted
    /// one (each checked as js/servercrypto.js acceptRoster does), and the
    /// site key of every epoch wrapped for this monitor.
    pub fn refresh_site(&mut self, host: &dyn Host, api: &dyn Api) -> Result<(), TickError> {
        let me = self.get(api, "/api/monitor")?;
        let epoch = me["epoch"].as_i64().unwrap_or(0);
        let roster_seq = me["rosterSeq"].as_i64().unwrap_or(0);
        let days = me["statsDays"].as_i64().unwrap_or(360).clamp(0, 3650);
        // The site's value is this PC's, whatever was set here since (D271).
        if days != self.file.stats_days || host.current_retention() as i64 != days {
            self.file.stats_days = days;
            self.dirty = true;
            host.retention(days as u32);
        }
        let site = self.file.site.clone();
        let have = self.file.roster.as_ref().map(|r| r.seq).unwrap_or(0);
        let got = self.get(api, &format!("/api/sites/{site}/rosters?since={}", have.saturating_sub(1).max(0)))?;
        if let Some(p) = got["pubs"].as_object() {
            for (u, k) in p {
                if let (Some(e), Some(s)) = (k["encPub"].as_str(), k["sigPub"].as_str()) {
                    self.pubs.insert(u.clone(), (e.to_string(), s.to_string()));
                }
            }
        }
        if roster_seq > have {
            let mut list: Vec<Roster> = got["rosters"]
                .as_array()
                .map(|a| a.iter().filter_map(|r| serde_json::from_value(r.clone()).ok()).collect())
                .unwrap_or_default();
            list.sort_by_key(|r| r.seq);
            for r in list.into_iter().filter(|r| r.seq > have) {
                let signer = self.pubs.get(&r.by).map(|p| p.1.clone()).unwrap_or_default();
                if !sc::accept_roster(&r, self.file.roster.as_ref(), &signer) {
                    return Err(TickError::Other(format!("roster {} not trusted", r.seq)));
                }
                self.file.roster = Some(r);
                self.dirty = true;
            }
        }
        if !self.file.roster.as_ref().map(|r| r.member(&self.file.monitor).is_some()).unwrap_or(false) {
            return Err(TickError::Other("not in the roster".into()));
        }
        if epoch != self.epoch || !self.site_keys.contains_key(&epoch) {
            let wraps = self.get(api, &format!("/api/sites/{site}/keys"))?;
            let signers = self.owner_sig_pubs();
            for w in wraps["wraps"].as_array().cloned().unwrap_or_default() {
                let e = w["epoch"].as_i64().unwrap_or(0);
                if self.site_keys.contains_key(&e) {
                    continue;
                }
                let Ok(wrap) = serde_json::from_value::<Wrap>(w["wrap"].clone()) else { continue };
                if let Ok(k) = sc::unwrap(&wrap, &self.keys, &sc::site_ctx(&site, e, &self.file.monitor), &signers) {
                    self.site_keys.insert(e, k);
                }
            }
            if !self.site_keys.contains_key(&epoch) {
                return Err(TickError::Other(format!("no key for epoch {epoch}")));
            }
            self.epoch = epoch;
        }
        Ok(())
    }

    fn seal(&mut self, kind: &str, id: &str, plain: &Value, now: i64) -> Result<Record, TickError> {
        let key = self.site_keys.get(&self.epoch).ok_or_else(|| TickError::Other("no key".into()))?.clone();
        let at = self.at(now);
        let h = RecordHead { site: &self.file.site, kind, id, epoch: self.epoch, author: &self.file.monitor, at };
        sc::seal_record(&h, &key, &self.keys, plain.to_string().as_bytes()).map_err(TickError::Other)
    }

    fn send(&mut self, api: &dyn Api, method: &str, path: &str, rec: &Record) -> Result<(), TickError> {
        let body = serde_json::to_string(rec).unwrap_or_default();
        let (st, out) = api.call(method, path, Some(&body)).map_err(TickError::Other)?;
        match st {
            401 => Err(unauthorized(&out)),
            409 if String::from_utf8_lossy(&out).contains("stale-epoch") => {
                // A rotation: the next refresh opens the new key.
                self.epoch = 0;
                Err(TickError::Other("stale-epoch".into()))
            }
            s if ok(s) => Ok(()),
            s => Err(TickError::Other(format!("{path}: {s} {}", String::from_utf8_lossy(&out).chars().take(120).collect::<String>()))),
        }
    }

    /// Does this PC watch the site's network now? (A link enrolled before
    /// the network was kept, "", takes any.)
    fn watching(&self, host: &dyn Host) -> bool {
        self.file.network.is_empty() || host.network_id() == self.file.network
    }

    /// The status: on a heartbeat, or soon after a state changed. While
    /// this PC watches another network the heartbeat still goes, with no
    /// items (D278).
    pub fn push_status(&mut self, host: &dyn Host, api: &dyn Api, now: i64) -> Result<bool, TickError> {
        let sts = if self.watching(host) { host.statuses() } else { Vec::new() };
        let states: String = sts.iter().map(|s| format!("{}={}{}{}{};", s.key, s.state, s.slow as u8, s.flapping as u8, s.cause.as_deref().unwrap_or(""))).collect();
        let due = now - self.last_status >= HEARTBEAT_MS || (states != self.last_states && now - self.last_status >= SOON_MS);
        if !due {
            return Ok(false);
        }
        let plain = json!({ "v": 1, "monitor": self.file.name, "at": now, "intervalMs": HEARTBEAT_MS, "items": sts });
        let id = self.file.monitor.clone();
        let rec = self.seal("status", &id, &plain, now)?;
        self.send(api, "PUT", &format!("/api/sites/{}/status?interval={HEARTBEAT_MS}", self.file.site), &rec)?;
        self.last_status = now;
        self.last_states = states;
        self.file.last_push = now;
        self.dirty = true;
        Ok(true)
    }

    /// Each issue whose rev changed since it was pushed.
    pub fn push_issues(&mut self, host: &dyn Host, api: &dyn Api, now: i64) -> Result<usize, TickError> {
        let mut n = 0;
        if !self.watching(host) {
            return Ok(0);
        }
        for i in host.issues() {
            if self.file.pushed.get(&i.id) == Some(&i.rev) {
                continue;
            }
            let mut plain = serde_json::to_value(&i).unwrap_or(Value::Null);
            plain["monitorId"] = json!(self.file.monitor);
            plain["monitor"] = json!(self.file.name);
            let rec = self.seal("issue", &i.id, &plain, now)?;
            self.send(api, "POST", &format!("/api/sites/{}/records", self.file.site), &rec)?;
            self.file.pushed.insert(i.id.clone(), i.rev);
            self.dirty = true;
            n += 1;
        }
        // Forget the revs of issues this PC no longer holds.
        let ids: HashSet<String> = host.issues().into_iter().map(|i| i.id).collect();
        self.file.pushed.retain(|k, _| ids.contains(k));
        Ok(n)
    }

    /// Today's hourly figures (and yesterday's in the first two hours).
    pub fn push_stats(&mut self, host: &dyn Host, api: &dyn Api, now: i64) -> Result<usize, TickError> {
        if self.file.stats_days == 0 || now - self.last_stats < STATS_EVERY_MS || !self.watching(host) {
            return Ok(0);
        }
        self.last_stats = now;
        let today = (now / DAY_MS) * DAY_MS;
        let mut days = vec![today];
        if now - today < 2 * 3_600_000 {
            days.insert(0, today - DAY_MS);
        }
        let mut n = 0;
        for day in days {
            let Some(fig) = host.stats_day(day) else { continue };
            let plain = json!({ "v": 1, "day": day, "monitor": self.file.name, "checks": fig });
            let id = format!("{}|{day}", self.file.monitor);
            let rec = self.seal("stats", &id, &plain, now)?;
            match self.send(api, "PUT", &format!("/api/sites/{}/stats/{day}", self.file.site), &rec) {
                Ok(()) => n += 1,
                // Off on the server (the owner just turned it off): nothing kept.
                Err(TickError::Other(e)) if e.contains("409") => {}
                Err(e) => return Err(e),
            }
        }
        Ok(n)
    }

    /// The people's records since the last read: owners' acts and quiet
    /// windows applied; anything else (a provider's, a forged one, another
    /// author's key) left to the owners' browsers. -> how many applied.
    ///
    /// A record whose author the trusted roster does not name yet, or whose
    /// epoch this PC holds no key for, may be from after a rotation or a new
    /// owner that the next site read brings: the site is read again at once
    /// (once per pull) and the record tried again, so it is not passed over
    /// for good (D280).
    pub fn pull_records(&mut self, host: &dyn Host, api: &dyn Api) -> Result<usize, TickError> {
        let mut applied = 0;
        let mut refreshed = false;
        loop {
            let got = self.get(api, &format!("/api/sites/{}/records?since={}", self.file.site, self.file.last_n))?;
            for x in got["records"].as_array().cloned().unwrap_or_default() {
                let n = x["n"].as_i64().unwrap_or(0);
                if let Ok(rec) = serde_json::from_value::<Record>(x["record"].clone()) {
                    if rec.site == self.file.site && (rec.kind == "act" || rec.kind == "quiet") {
                        let readable = |l: &Link| l.trusted_member(&rec.author).is_some() && l.site_keys.contains_key(&rec.epoch);
                        if !readable(self) && !refreshed {
                            refreshed = true;
                            if !self.site_keys.contains_key(&rec.epoch) {
                                self.epoch = 0; // the keys are read again
                            }
                            self.refresh_site(host, api)?;
                        }
                        if let Some((sig, role)) = self.trusted_member(&rec.author) {
                            if role == "owner" {
                                if let Some(key) = self.site_keys.get(&rec.epoch) {
                                    if let Ok(plain) = sc::open_record(&rec, key, &sig) {
                                        if let Ok(v) = serde_json::from_slice::<Value>(&plain) {
                                            if apply_record(host, &rec.kind, &v) {
                                                applied += 1;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if n > self.file.last_n {
                    self.file.last_n = n;
                    self.dirty = true;
                }
            }
            if !got["more"].as_bool().unwrap_or(false) {
                break;
            }
        }
        Ok(applied)
    }

    /// The other monitors: one that stopped reporting is said once.
    pub fn check_monitors(&mut self, host: &dyn Host, api: &dyn Api) -> Result<(), TickError> {
        let got = self.get(api, &format!("/api/sites/{}/monitors", self.file.site))?;
        let mut stale_now = Vec::new();
        for m in got["monitors"].as_array().cloned().unwrap_or_default() {
            let id = m["id"].as_str().unwrap_or("").to_string();
            if id == self.file.monitor || !m["stale"].as_bool().unwrap_or(false) {
                continue;
            }
            if !self.file.stale_told.contains(&id) {
                host.notify_stale(m["name"].as_str().unwrap_or(""));
            }
            stale_now.push(id);
        }
        if stale_now != self.file.stale_told {
            self.file.stale_told = stale_now;
            self.dirty = true;
        }
        Ok(())
    }

    /// One turn of the link. A revoked credential stops it for good.
    pub fn tick(&mut self, host: &dyn Host, api: &dyn Api, now: i64) -> Result<(), TickError> {
        let mut r = self.tick_inner(host, api, now);
        // A revoke is taken on the server's own 401 seen on two turns in a
        // row (D279); the first is only an error.
        if r == Err(TickError::Revoked) {
            self.unauthorized += 1;
            if self.unauthorized < 2 {
                r = Err(TickError::Other("unauthorized".into()));
            }
        } else {
            self.unauthorized = 0;
        }
        match &r {
            Err(TickError::Revoked) => {
                self.file.revoked = true;
                self.file.error = "revoked".into();
                self.dirty = true;
                host.revoked();
            }
            Err(TickError::Other(e)) => {
                if self.file.error != *e {
                    self.file.error = e.clone();
                    self.dirty = true;
                }
            }
            Ok(()) => {
                if !self.file.error.is_empty() {
                    self.file.error.clear();
                    self.dirty = true;
                }
            }
        }
        r
    }

    fn tick_inner(&mut self, host: &dyn Host, api: &dyn Api, now: i64) -> Result<(), TickError> {
        if self.epoch == 0 || now - self.last_site >= SITE_EVERY_MS {
            self.refresh_site(host, api)?;
            self.last_site = now;
            self.check_monitors(host, api)?;
        }
        // Each step runs whatever another one met (a full site refusing an
        // issue must not stop acts and statistics); a revoke stops at once.
        let mut first: Option<TickError> = None;
        let mut keep = |r: Result<(), TickError>| -> Result<(), TickError> {
            match r {
                Err(TickError::Revoked) => Err(TickError::Revoked),
                Err(e) => {
                    first.get_or_insert(e);
                    Ok(())
                }
                Ok(()) => Ok(()),
            }
        };
        keep(self.push_status(host, api, now).map(|_| ()))?;
        keep(self.push_issues(host, api, now).map(|_| ()))?;
        if now - self.last_records >= RECORDS_EVERY_MS {
            let r = self.pull_records(host, api).map(|_| ());
            if r.is_ok() {
                self.last_records = now;
            }
            keep(r)?;
        }
        keep(self.push_stats(host, api, now).map(|_| ()))?;
        match first {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}

/// An owner's record applied to this PC's monitor. -> whether it was one.
pub fn apply_record(host: &dyn Host, kind: &str, v: &Value) -> bool {
    match kind {
        "act" => {
            let (Some(issue), Some(act), Some(at)) = (v["issue"].as_str(), v["act"].as_str(), v["at"].as_i64()) else { return false };
            if !crate::issues::ACTS.contains(&act) {
                return false;
            }
            host.act(
                issue,
                Act {
                    act: act.into(),
                    at,
                    by: v["by"].as_str().unwrap_or("").into(),
                    note: v["note"].as_str().unwrap_or("").into(),
                    report_id: v["reportId"].as_str().unwrap_or("").into(),
                },
            );
            true
        }
        "quiet" => {
            let (Some(scope), Some(until)) = (v["scope"].as_str(), v["until"].as_i64()) else { return false };
            if !matches!(scope, "site" | "node" | "group") {
                return false;
            }
            host.quiet(scope, v["id"].as_str().unwrap_or(""), until);
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::sync::Mutex;

    /// A server that keeps what it is sent and answers what the test set.
    #[derive(Default)]
    struct FakeApi {
        gets: Mutex<HashMap<String, (u16, Value)>>,
        sent: Mutex<Vec<(String, String, Record)>>,
        status: Mutex<Option<u16>>,
        /// The body sent with `status` (the server's own 401 by default).
        status_body: Mutex<Option<String>>,
        /// Paths of POST/PUT answered with this status and body.
        refuse: Mutex<HashMap<String, (u16, String)>>,
    }
    impl FakeApi {
        fn answer(&self, path: &str, v: Value) {
            self.gets.lock().unwrap().insert(path.into(), (200, v));
        }
    }
    impl Api for FakeApi {
        fn call(&self, method: &str, path: &str, body: Option<&str>) -> Result<(u16, Vec<u8>), String> {
            if let Some(s) = *self.status.lock().unwrap() {
                let body = self.status_body.lock().unwrap().clone().unwrap_or_else(|| "{\"error\":\"unauthorized\"}".into());
                return Ok((s, body.into_bytes()));
            }
            if method == "GET" {
                let p = path.split('?').next().unwrap();
                let g = self.gets.lock().unwrap();
                let (s, v) = g.get(path).or_else(|| g.get(p)).cloned().unwrap_or((404, json!({})));
                return Ok((s, v.to_string().into_bytes()));
            }
            let p = path.split('?').next().unwrap();
            if let Some((s, b)) = self.refuse.lock().unwrap().get(p).cloned() {
                return Ok((s, b.into_bytes()));
            }
            let rec: Record = serde_json::from_str(body.unwrap()).unwrap();
            self.sent.lock().unwrap().push((method.into(), path.into(), rec));
            Ok((200, b"{\"n\":1}".to_vec()))
        }
    }

    #[derive(Default)]
    struct FakeHost {
        network: RefCell<String>,
        statuses: RefCell<Vec<Status>>,
        issues: RefCell<Vec<Issue>>,
        acts: RefCell<Vec<(String, Act)>>,
        quiets: RefCell<Vec<(String, String, i64)>>,
        retention: RefCell<Vec<u32>>,
        stale: RefCell<Vec<String>>,
        revoked: RefCell<bool>,
    }
    impl Host for FakeHost {
        fn network_id(&self) -> String {
            self.network.borrow().clone()
        }
        fn current_retention(&self) -> u32 {
            self.retention.borrow().last().copied().unwrap_or(360)
        }
        fn statuses(&self) -> Vec<Status> {
            self.statuses.borrow().clone()
        }
        fn issues(&self) -> Vec<Issue> {
            self.issues.borrow().clone()
        }
        fn stats_day(&self, day: i64) -> Option<Value> {
            Some(json!({ "n1/ping": { "node": "n1", "hours": [{ "hour": day, "checks": 60 }] } }))
        }
        fn act(&self, issue: &str, a: Act) {
            self.acts.borrow_mut().push((issue.into(), a));
        }
        fn quiet(&self, scope: &str, id: &str, until: i64) {
            self.quiets.borrow_mut().push((scope.into(), id.into(), until));
        }
        fn retention(&self, days: u32) {
            self.retention.borrow_mut().push(days);
        }
        fn notify_stale(&self, name: &str) {
            self.stale.borrow_mut().push(name.into());
        }
        fn revoked(&self) {
            *self.revoked.borrow_mut() = true;
        }
    }

    const SITE: &str = "s_SiteSiteSiteSiteSite01";
    const MON: &str = "m_0123456789abcdef012345";
    const OWNER: &str = "u_OwnerOwnerOwnerOwner01";
    const PROV: &str = "u_ProvProvProvProvProv01";

    struct World {
        owner: DeviceKeys,
        prov: DeviceKeys,
        mon: DeviceKeys,
        key1: Vec<u8>,
        r1: Roster,
        api: FakeApi,
    }

    fn line(u: &str, role: &str, k: &DeviceKeys, email: &str) -> sc::RosterMember {
        sc::RosterMember { u: u.into(), email: email.into(), role: role.into(), enc: sc::fp(&k.enc_pub()).unwrap(), sig: sc::fp(&k.sig_pub()).unwrap() }
    }

    fn signed(mut r: Roster, by: &DeviceKeys) -> Roster {
        r.members.sort_by(|a, b| a.u.cmp(&b.u));
        r.sig = by.sign(&sc::roster_canonical(&r));
        r
    }

    fn world() -> World {
        let owner = DeviceKeys::generate();
        let prov = DeviceKeys::generate();
        let mon = DeviceKeys::generate();
        let key1 = sc::random(32);
        let r1 = signed(
            Roster {
                v: 1,
                site: SITE.into(),
                seq: 2,
                epoch: 1,
                by: OWNER.into(),
                at: 1,
                members: vec![line(OWNER, "owner", &owner, "o@x.test"), line(PROV, "provider", &prov, "p@x.test"), line(MON, "monitor", &mon, MON)],
                sig: String::new(),
            },
            &owner,
        );
        let api = FakeApi::default();
        let pubs = json!({
            OWNER: { "encPub": owner.enc_pub(), "sigPub": owner.sig_pub() },
            PROV: { "encPub": prov.enc_pub(), "sigPub": prov.sig_pub() },
            MON: { "encPub": mon.enc_pub(), "sigPub": mon.sig_pub() },
        });
        api.answer("/api/monitor", json!({ "epoch": 1, "rosterSeq": 2, "statsDays": 360 }));
        api.answer(&format!("/api/sites/{SITE}/rosters"), json!({ "rosters": [r1], "pubs": pubs }));
        let w = sc::wrap(&mon.enc_pub(), &sc::site_ctx(SITE, 1, MON), &key1, OWNER, &owner).unwrap();
        api.answer(&format!("/api/sites/{SITE}/keys"), json!({ "wraps": [{ "epoch": 1, "wrap": w }] }));
        api.answer(&format!("/api/sites/{SITE}/monitors"), json!({ "monitors": [] }));
        api.answer(&format!("/api/sites/{SITE}/records"), json!({ "records": [] }));
        World { owner, prov, mon, key1, r1, api }
    }

    fn link(w: &World) -> Link {
        let f = LinkFile { site: SITE.into(), monitor: MON.into(), name: "Building B".into(), roster: Some(w.r1.clone()), stats_days: 360, ..Default::default() };
        Link::new(f, DeviceKeys::from_secret(&w.mon.to_secret()).unwrap())
    }

    fn status(key: &str, state: &str) -> Status {
        Status { key: key.into(), node_id: key.split('/').next().unwrap().into(), state: state.into(), ..Default::default() }
    }

    #[test]
    fn pushes_sealed_signed_status_issues_and_stats() {
        let w = world();
        let mut l = link(&w);
        let host = FakeHost::default();
        *host.statuses.borrow_mut() = vec![status("n1/ping", "down")];
        *host.issues.borrow_mut() = vec![Issue { id: "in0000000001".into(), node_id: "n1".into(), rev: 3, ..Default::default() }];
        let now = 1_762_900_000_000;
        l.tick(&host, &w.api, now).unwrap();
        let sent = w.api.sent.lock().unwrap().clone();
        let kinds: Vec<&str> = sent.iter().map(|(_, _, r)| r.kind.as_str()).collect();
        assert_eq!(kinds, vec!["status", "issue", "stats"]);
        for (_, path, r) in &sent {
            assert_eq!(r.author, MON);
            assert_eq!(r.epoch, 1);
            let plain: Value = serde_json::from_slice(&sc::open_record(r, &w.key1, &w.mon.sig_pub()).unwrap()).unwrap();
            match r.kind.as_str() {
                "status" => {
                    assert!(path.ends_with("/status?interval=60000"));
                    assert_eq!(plain["items"][0]["state"], "down");
                    assert_eq!(plain["monitor"], "Building B");
                }
                "issue" => {
                    assert_eq!(r.id, "in0000000001");
                    assert_eq!(plain["monitorId"], MON);
                }
                _ => {
                    assert_eq!(r.id, format!("{MON}|{}", (now / DAY_MS) * DAY_MS));
                    assert_eq!(plain["checks"]["n1/ping"]["node"], "n1");
                }
            }
        }
        // Nothing new: nothing sent; a changed state soon, the heartbeat later.
        w.api.sent.lock().unwrap().clear();
        l.tick(&host, &w.api, now + 1000).unwrap();
        assert!(w.api.sent.lock().unwrap().is_empty());
        *host.statuses.borrow_mut() = vec![status("n1/ping", "up")];
        l.tick(&host, &w.api, now + 2000).unwrap();
        assert!(w.api.sent.lock().unwrap().is_empty(), "within 5 s of the last");
        l.tick(&host, &w.api, now + 6000).unwrap();
        assert_eq!(w.api.sent.lock().unwrap().len(), 1);
        l.tick(&host, &w.api, now + 6000 + HEARTBEAT_MS).unwrap();
        assert_eq!(w.api.sent.lock().unwrap().len(), 2);
        // The issue's next rev goes again; the records' times only grow.
        host.issues.borrow_mut()[0].rev = 4;
        l.tick(&host, &w.api, now + 7000 + HEARTBEAT_MS).unwrap();
        let sent = w.api.sent.lock().unwrap().clone();
        assert_eq!(sent.last().unwrap().2.kind, "issue");
        let ats: Vec<i64> = sent.iter().map(|x| x.2.at).collect();
        assert!(ats.windows(2).all(|p| p[0] < p[1]));
    }

    fn record(by: &DeviceKeys, author: &str, kind: &str, id: &str, key: &[u8], plain: Value) -> Record {
        sc::seal_record(&RecordHead { site: SITE, kind, id, epoch: 1, author, at: 5 }, key, by, plain.to_string().as_bytes()).unwrap()
    }

    #[test]
    fn takes_owners_acts_and_quiet_only() {
        let w = world();
        let mut l = link(&w);
        let host = FakeHost::default();
        let act = json!({ "issue": "in0000000001", "act": "ack", "at": 9, "by": "Ana" });
        let mut forged = record(&w.prov, OWNER, "act", "f", &w.key1, act.clone());
        forged.id = "f".into();
        w.api.answer(
            &format!("/api/sites/{SITE}/records?since=0"),
            json!({ "records": [
                { "n": 1, "record": record(&w.owner, OWNER, "act", "in0000000001|ack|9", &w.key1, act.clone()) },
                { "n": 2, "record": record(&w.prov, PROV, "act", "in0000000001|ack|10", &w.key1, act.clone()) },
                { "n": 3, "record": forged },
                { "n": 4, "record": record(&w.owner, OWNER, "quiet", "q1", &w.key1, json!({ "scope": "node", "id": "n1", "until": 99 })) },
                { "n": 5, "record": record(&w.owner, OWNER, "act", "x", &sc::random(32), act.clone()) },
                { "n": 6, "record": record(&w.mon, MON, "issue", "in1", &w.key1, json!({})) },
            ], "more": false }),
        );
        l.tick(&host, &w.api, 1_000_000).unwrap();
        let acts = host.acts.borrow();
        assert_eq!(acts.len(), 1, "only the owner's act");
        assert_eq!(acts[0].0, "in0000000001");
        assert_eq!(acts[0].1.by, "Ana");
        assert_eq!(*host.quiets.borrow(), vec![("node".to_string(), "n1".to_string(), 99)]);
        assert_eq!(l.file.last_n, 6);
    }

    #[test]
    fn follows_a_rotation_and_the_retention() {
        let w = world();
        let mut l = link(&w);
        let host = FakeHost::default();
        l.tick(&host, &w.api, 1_000_000).unwrap();
        // An owner revokes another monitor: roster 3, epoch 2, a new wrap.
        let key2 = sc::random(32);
        let mut r3 = w.r1.clone();
        r3.seq = 3;
        r3.epoch = 2;
        let r3 = signed(r3, &w.owner);
        let pubs = json!({ OWNER: { "encPub": w.owner.enc_pub(), "sigPub": w.owner.sig_pub() }, MON: { "encPub": w.mon.enc_pub(), "sigPub": w.mon.sig_pub() } });
        w.api.answer(&format!("/api/sites/{SITE}/rosters"), json!({ "rosters": [w.r1, r3], "pubs": pubs }));
        w.api.answer("/api/monitor", json!({ "epoch": 2, "rosterSeq": 3, "statsDays": 30 }));
        let w1 = sc::wrap(&w.mon.enc_pub(), &sc::site_ctx(SITE, 1, MON), &w.key1, OWNER, &w.owner).unwrap();
        let w2 = sc::wrap(&w.mon.enc_pub(), &sc::site_ctx(SITE, 2, MON), &key2, OWNER, &w.owner).unwrap();
        w.api.answer(&format!("/api/sites/{SITE}/keys"), json!({ "wraps": [{ "epoch": 1, "wrap": w1 }, { "epoch": 2, "wrap": w2 }] }));
        *host.statuses.borrow_mut() = vec![status("n1/ping", "up")];
        l.tick(&host, &w.api, 1_000_000 + SITE_EVERY_MS).unwrap();
        assert_eq!(l.file.roster.as_ref().unwrap().seq, 3);
        assert_eq!(*host.retention.borrow(), vec![30]);
        let last = w.api.sent.lock().unwrap().last().cloned().unwrap();
        assert_eq!(last.2.epoch, 2);
        assert!(sc::open_record(&last.2, &key2, &w.mon.sig_pub()).is_ok());
        // A roster signed by someone the trusted one does not name an owner: refused.
        let mut bad = r3.clone();
        bad.seq = 4;
        bad.by = PROV.into();
        let bad = signed(bad, &w.prov);
        let pubs = json!({ OWNER: { "encPub": w.owner.enc_pub(), "sigPub": w.owner.sig_pub() }, PROV: { "encPub": w.prov.enc_pub(), "sigPub": w.prov.sig_pub() }, MON: { "encPub": w.mon.enc_pub(), "sigPub": w.mon.sig_pub() } });
        w.api.answer(&format!("/api/sites/{SITE}/rosters"), json!({ "rosters": [r3, bad], "pubs": pubs }));
        w.api.answer("/api/monitor", json!({ "epoch": 2, "rosterSeq": 4, "statsDays": 30 }));
        let e = l.tick(&host, &w.api, 1_000_000 + 2 * SITE_EVERY_MS).unwrap_err();
        assert_eq!(e, TickError::Other("roster 4 not trusted".into()));
        assert_eq!(l.file.roster.as_ref().unwrap().seq, 3);
    }

    #[test]
    fn says_once_that_another_monitor_stopped_and_stops_when_revoked() {
        let w = world();
        let mut l = link(&w);
        let host = FakeHost::default();
        w.api.answer(&format!("/api/sites/{SITE}/monitors"), json!({ "monitors": [
            { "id": MON, "name": "Building B", "stale": true },
            { "id": "m_aaaaaaaaaaaaaaaaaaaaaa", "name": "Building A", "stale": true },
        ] }));
        l.tick(&host, &w.api, 1_000_000).unwrap();
        l.tick(&host, &w.api, 1_000_000 + SITE_EVERY_MS).unwrap();
        assert_eq!(*host.stale.borrow(), vec!["Building A".to_string()]);
        // A 401 that is not the server's own answer (a proxy's page): never a revoke.
        *w.api.status.lock().unwrap() = Some(401);
        *w.api.status_body.lock().unwrap() = Some("<html>401</html>".into());
        for i in 0..3 {
            assert!(matches!(l.tick(&host, &w.api, 1_000_000 + (2 + i) * SITE_EVERY_MS), Err(TickError::Other(_))));
        }
        assert!(!*host.revoked.borrow());
        // The server's 401 once: an error only; twice in a row: revoked (D279).
        *w.api.status_body.lock().unwrap() = None;
        assert_eq!(l.tick(&host, &w.api, 1_000_000 + 6 * SITE_EVERY_MS), Err(TickError::Other("unauthorized".into())));
        assert!(!*host.revoked.borrow() && !l.file.revoked);
        assert_eq!(l.tick(&host, &w.api, 1_000_000 + 7 * SITE_EVERY_MS), Err(TickError::Revoked));
        assert!(*host.revoked.borrow());
        assert!(l.file.revoked);
    }

    #[test]
    fn a_passing_401_between_good_turns_is_not_a_revoke() {
        let w = world();
        let mut l = link(&w);
        let host = FakeHost::default();
        l.tick(&host, &w.api, 1_000_000).unwrap();
        *w.api.status.lock().unwrap() = Some(401);
        assert!(l.tick(&host, &w.api, 1_000_000 + SITE_EVERY_MS).is_err());
        *w.api.status.lock().unwrap() = None;
        l.tick(&host, &w.api, 1_000_000 + 2 * SITE_EVERY_MS).unwrap();
        *w.api.status.lock().unwrap() = Some(401);
        assert!(l.tick(&host, &w.api, 1_000_000 + 3 * SITE_EVERY_MS).is_err());
        assert!(!*host.revoked.borrow());
    }

    #[test]
    fn another_network_watched_sends_only_an_empty_heartbeat() {
        let w = world();
        let mut l = link(&w);
        l.file.network = "lib_site".into();
        let host = FakeHost::default();
        *host.network.borrow_mut() = "lib_home".into();
        *host.statuses.borrow_mut() = vec![status("n1/ping", "down")];
        *host.issues.borrow_mut() = vec![Issue { id: "in0000000001".into(), node_id: "n1".into(), rev: 1, ..Default::default() }];
        l.tick(&host, &w.api, 1_000_000).unwrap();
        let sent = w.api.sent.lock().unwrap().clone();
        assert_eq!(sent.iter().map(|x| x.2.kind.as_str()).collect::<Vec<_>>(), vec!["status"]);
        let plain: Value = serde_json::from_slice(&sc::open_record(&sent[0].2, &w.key1, &w.mon.sig_pub()).unwrap()).unwrap();
        assert_eq!(plain["items"], json!([]));
        // The site's network watched again: everything goes.
        *host.network.borrow_mut() = "lib_site".into();
        w.api.sent.lock().unwrap().clear();
        l.tick(&host, &w.api, 1_000_000 + HEARTBEAT_MS).unwrap();
        let mut kinds: Vec<String> = w.api.sent.lock().unwrap().iter().map(|x| x.2.kind.clone()).collect();
        kinds.dedup(); // early in the UTC day yesterday's figures go too
        assert_eq!(kinds, vec!["status", "issue", "stats"]);
    }

    #[test]
    fn a_full_site_refusing_issues_does_not_stop_acts_and_statistics() {
        let w = world();
        let mut l = link(&w);
        let host = FakeHost::default();
        *host.issues.borrow_mut() = vec![Issue { id: "in0000000001".into(), node_id: "n1".into(), rev: 1, ..Default::default() }];
        w.api.refuse.lock().unwrap().insert(format!("/api/sites/{SITE}/records"), (507, "{\"error\":\"records-full\"}".into()));
        let act = json!({ "issue": "in0000000001", "act": "ack", "at": 9 });
        w.api.answer(&format!("/api/sites/{SITE}/records?since=0"), json!({ "records": [
            { "n": 1, "record": record(&w.owner, OWNER, "act", "in0000000001|ack|9", &w.key1, act) } ], "more": false }));
        assert!(matches!(l.tick(&host, &w.api, 1_000_000), Err(TickError::Other(_))));
        assert_eq!(host.acts.borrow().len(), 1, "the act was still taken");
        assert!(w.api.sent.lock().unwrap().iter().any(|x| x.2.kind == "stats"), "statistics still went");
    }

    #[test]
    fn a_record_from_after_a_rotation_is_read_not_passed_over() {
        let w = world();
        let mut l = link(&w);
        let host = FakeHost::default();
        l.tick(&host, &w.api, 1_000_000).unwrap();
        // An owner rotates (epoch 2) and seals a quiet window at once; the
        // next pull comes before the next site read.
        let key2 = sc::random(32);
        let mut r3 = w.r1.clone();
        r3.seq = 3;
        r3.epoch = 2;
        let r3 = signed(r3, &w.owner);
        let pubs = json!({ OWNER: { "encPub": w.owner.enc_pub(), "sigPub": w.owner.sig_pub() }, MON: { "encPub": w.mon.enc_pub(), "sigPub": w.mon.sig_pub() } });
        w.api.answer(&format!("/api/sites/{SITE}/rosters"), json!({ "rosters": [w.r1, r3], "pubs": pubs }));
        w.api.answer("/api/monitor", json!({ "epoch": 2, "rosterSeq": 3, "statsDays": 360 }));
        let w2 = sc::wrap(&w.mon.enc_pub(), &sc::site_ctx(SITE, 2, MON), &key2, OWNER, &w.owner).unwrap();
        w.api.answer(&format!("/api/sites/{SITE}/keys"), json!({ "wraps": [{ "epoch": 2, "wrap": w2 }] }));
        let q = sc::seal_record(&RecordHead { site: SITE, kind: "quiet", id: "node|n1", epoch: 2, author: OWNER, at: 7 }, &key2, &w.owner,
            json!({ "scope": "node", "id": "n1", "until": 99 }).to_string().as_bytes()).unwrap();
        w.api.answer(&format!("/api/sites/{SITE}/records?since=0"), json!({ "records": [{ "n": 1, "record": q }], "more": false }));
        l.tick(&host, &w.api, 1_000_000 + RECORDS_EVERY_MS).unwrap();
        assert_eq!(*host.quiets.borrow(), vec![("node".to_string(), "n1".to_string(), 99)]);
        assert_eq!(l.file.last_n, 1);
    }

    #[test]
    fn enrolled_keep_statistics_is_applied_on_the_first_read() {
        let w = world();
        let mut l = link(&w);
        l.file.stats_days = -1;
        let host = FakeHost::default();
        host.retention.borrow_mut().push(0); // this PC kept none
        l.tick(&host, &w.api, 1_000_000).unwrap();
        assert_eq!(*host.retention.borrow(), vec![0, 360]);
        // Changed here later: the site's value comes back on the next read.
        host.retention.borrow_mut().push(30);
        l.tick(&host, &w.api, 1_000_000 + SITE_EVERY_MS).unwrap();
        assert_eq!(host.retention.borrow().last().copied(), Some(360));
    }

    #[test]
    fn statistics_off_sends_none() {
        let w = world();
        w.api.answer("/api/monitor", json!({ "epoch": 1, "rosterSeq": 2, "statsDays": 0 }));
        let mut l = link(&w);
        let host = FakeHost::default();
        l.tick(&host, &w.api, 1_000_000).unwrap();
        assert!(w.api.sent.lock().unwrap().iter().all(|(_, _, r)| r.kind != "stats"));
        assert_eq!(*host.retention.borrow(), vec![0]);
        assert!(w.api.sent.lock().unwrap().iter().any(|(_, _, r)| r.kind == "status"), "status still goes");
    }
}
