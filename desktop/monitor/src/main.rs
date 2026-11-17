// topo-monitor: a site's monitor with no screen (docs/SCOPE.md D448,
// D455-D460, step 9k).
//
// The desktop app's "Monitor from this PC" as a program that needs no
// desktop: the same checks (ICMP and the other protocols), schedule, states,
// root cause, issues and statistics, and the same link to a Topo server,
// from the app's own source files. It signs in to the server as a monitor
// like any PC, and the people of the site see what it reports. The server
// still reads nothing: everything this program sends is sealed with the
// site key, which an owner's browser wrapped for it.
//
//   topo-monitor request [--name NAME]   makes this box's keys and prints
//                                        one line to paste in Topo
//                                        (Settings, Monitoring, Add a
//                                        monitor with no screen)
//   topo-monitor enroll FILE [--pin FP]  takes the file Topo gave back
//   topo-monitor run                     checks and reports until stopped
//   topo-monitor status                  what is kept here, in words
//   topo-monitor forget                  forgets the keys and the site here
//
//   topo-monitor --version               its version
//
//   --dir DIR (or TOPO_MONITOR_DIR)      where it keeps its files; else
//                                        /var/lib/topo-monitor when this
//                                        user may write there (the packaged
//                                        service's user), else
//                                        ~/.local/state/topo-monitor
//
// What it checks comes from the site: an owner's browser, with the network
// open, works the checks out and sends them through the server (src/parts.rs).
// Until one has, it reports that it is here and checks nothing. It keeps the
// last checks it was given, so it goes on with no browser open.
//
// Kept in DIR, readable by this user only: secret.json (its keys and the
// server's credential: there is no keychain on a box with no session),
// link.json, plan.json, parts.json, issues.json, local.json, stats.sqlite.
// No password of any device is asked for, kept or sent: the checks ask a
// device whether it answers, as the app's do.

#[path = "../../src-tauri/src/checks.rs"]
#[allow(dead_code)]
mod checks;
#[path = "../../src-tauri/src/client.rs"]
#[allow(dead_code)]
mod client;
#[path = "../../src-tauri/src/issues.rs"]
#[allow(dead_code)]
mod issues;
#[path = "../../src-tauri/src/monitor.rs"]
#[allow(dead_code)]
mod monitor;
#[path = "../../src-tauri/src/monitorlink.rs"]
#[allow(dead_code)]
mod monitorlink;
#[path = "../../src-tauri/src/servercrypto.rs"]
#[allow(dead_code)]
mod servercrypto;
#[path = "../../src-tauri/src/stats.rs"]
#[allow(dead_code)]
mod stats;
mod parts;

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use issues::{Act, Issue, Issues};
use monitor::{Monitor, Quiet, Status};
use monitorlink::{Api, Host, Link, LinkFile, Secret, TickError};
use parts::{Kept, Parts};
use servercrypto::{DeviceKeys, Roster};
use stats::{Stats, RETENTION_DEFAULT_DAYS, RETENTION_MAX_DAYS};

/// The version a release build is given (TOPO_MONITOR_VERSION, the
/// Makefile); a plain `cargo build` is a development build.
pub const VERSION: &str = match option_env!("TOPO_MONITOR_VERSION") {
    Some(v) => v,
    None => "0.0.0-dev",
};
/// Where the packaged service keeps its files (packaging/topo-monitor.service).
pub const SERVICE_DIR: &str = "/var/lib/topo-monitor";
pub const REQUEST_PREFIX: &str = "topo-monitor-request:";
pub const ENROLMENT_KIND: &str = "topo-monitor-enrolment";

// ---- Files ----

fn write_private(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
        }
    }
    let tmp = path.with_extension("tmp");
    {
        let mut o = fs::OpenOptions::new();
        o.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o600);
        }
        use std::io::Write;
        let mut f = o.open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}
fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<(), String> {
    write_private(path, &serde_json::to_string(v).map_err(|e| e.to_string())?)
}
fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// What this box sets for itself: the quiet windows and Keep statistics the
/// site's owners sent.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct Local {
    quiet: Quiet,
    retention_days: u32,
}
impl Default for Local {
    fn default() -> Local {
        Local { quiet: Quiet::default(), retention_days: RETENTION_DEFAULT_DAYS }
    }
}

// ---- The request and the enrolment ----

/// The line this box prints for an owner to paste in Topo: its name and the
/// public halves of its keys. Nothing secret.
pub fn request_line(name: &str, keys: &DeviceKeys) -> String {
    let v = json!({ "v": 1, "name": name.chars().take(120).collect::<String>(), "encPub": keys.enc_pub(), "sigPub": keys.sig_pub() });
    format!("{REQUEST_PREFIX}{}", servercrypto::b64u(v.to_string().as_bytes()))
}

/// What Topo gives back (js/monitors.js enrolHeadless): where the server
/// is, which monitor this is, its credential, and the roster the owner's
/// browser trusts.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Enrolment {
    pub v: u32,
    pub kind: String,
    pub origin: String,
    pub site: String,
    pub monitor: String,
    pub name: String,
    pub by: String,
    pub token: String,
    pub roster: Option<Roster>,
    pub groups: Vec<String>,
    pub network: String,
}

/// The enrolment checked against this box's keys -> the link's file. The
/// roster must name this monitor as a monitor, with this box's signing key:
/// an enrolment made for another box is refused.
pub fn link_from(e: Enrolment, keys: &DeviceKeys, origin: String, pin: &str, now: i64) -> Result<LinkFile, String> {
    if e.v != 1 || e.kind != ENROLMENT_KIND {
        return Err("This is not an enrolment file from Topo.".into());
    }
    if e.site.is_empty() || e.monitor.is_empty() || e.token.is_empty() || e.network.is_empty() || e.network.len() > 200 {
        return Err("The enrolment file is incomplete.".into());
    }
    let roster = e.roster.ok_or("The enrolment file has no roster.")?;
    let line = roster.member(&e.monitor).ok_or("The roster does not name this monitor.")?;
    if line.role != "monitor" || servercrypto::fp(&keys.sig_pub())? != line.sig {
        return Err("This enrolment was made for another box's keys. Run `topo-monitor request` here and paste that line in Topo.".into());
    }
    Ok(LinkFile {
        origin,
        pin: pin.to_string(),
        site: e.site,
        monitor: e.monitor,
        name: e.name.chars().take(120).collect(),
        by: e.by.chars().take(254).collect(),
        enrolled_at: now,
        roster: Some(roster),
        groups: e.groups.into_iter().filter(|g| !g.is_empty() && g.len() <= 64).take(200).collect(),
        network: e.network,
        stats_days: -1,
        key_kind: "file".into(),
        ..Default::default()
    })
}

// ---- The monitor, as the link sees it ----

#[derive(Default)]
struct Inner {
    all: HashMap<String, Status>,
    issues: Issues,
    names: HashMap<String, String>,
}

pub struct Headless {
    dir: PathBuf,
    monitor_id: String,
    name: String,
    network: String,
    groups: Vec<String>,
    mon: Monitor,
    stats: Option<Arc<Mutex<Stats>>>,
    inner: Arc<Mutex<Inner>>,
    local: Mutex<Local>,
    kept: Mutex<Kept>,
    parts: Mutex<Parts>,
    pub gone: AtomicBool,
}

fn node_names(k: &Kept) -> HashMap<String, String> {
    k.items.iter().map(|i| (i.node_id.clone(), if i.node_name.is_empty() { i.name.split(" · ").next().unwrap_or("").to_string() } else { i.node_name.clone() })).collect()
}

impl Headless {
    /// Starts the monitor with the checks kept in `dir`. `runner` runs one
    /// check (checks::run; the tests give a stand-in).
    pub fn start(dir: &Path, link: &LinkFile, runner: monitor::Runner) -> Headless {
        let local: Local = read_json(&dir.join("local.json")).unwrap_or_default();
        let mut kept: Kept = read_json(&dir.join("plan.json")).unwrap_or_default();
        kept.items = monitor::normalize(kept.items);
        let stats = match Stats::open(&dir.join("stats.sqlite")) {
            Ok(s) => {
                let _ = if local.retention_days > 0 { s.prune(monitor::now_ms(), local.retention_days).map(|_| ()) } else { s.clear() };
                Some(Arc::new(Mutex::new(s)))
            }
            Err(e) => {
                eprintln!("topo-monitor: the statistics could not be opened: {e}");
                None
            }
        };
        let inner = Arc::new(Mutex::new(Inner { all: HashMap::new(), issues: read_json(&dir.join("issues.json")).unwrap_or_default(), names: node_names(&kept) }));
        let (sink_inner, sink_dir, sink_net, sink_name) = (inner.clone(), dir.to_path_buf(), link.network.clone(), link.name.clone());
        let sink: monitor::Sink = Arc::new(move |changed: Vec<Status>| {
            let mut g = sink_inner.lock().unwrap();
            for s in &changed {
                g.all.insert(s.key.clone(), s.clone());
            }
            let Inner { all, issues, names } = &mut *g;
            let now = monitor::now_ms();
            let mut mint = issues::mint_id;
            let out = issues.update(&sink_net, &sink_name, all, names, now, &mut mint);
            if !out.is_empty() {
                issues.prune(now);
                if let Err(e) = write_json(&sink_dir.join("issues.json"), issues) {
                    eprintln!("topo-monitor: the issues could not be kept: {e}");
                }
                for (_, i) in &out {
                    eprintln!("topo-monitor: {} {}", i.name, if i.ongoing() { "is not answering" } else { "answers again" });
                }
            }
        });
        let mon = Monitor::start(runner, sink, stats.clone(), local.retention_days, local.quiet.clone());
        mon.set_expected(inner.lock().unwrap().issues.expected_nodes(&link.network));
        mon.set_items(kept.items.clone());
        Headless {
            dir: dir.to_path_buf(),
            monitor_id: link.monitor.clone(),
            name: link.name.clone(),
            network: link.network.clone(),
            groups: link.groups.clone(),
            mon,
            stats,
            inner,
            local: Mutex::new(local),
            kept: Mutex::new(kept),
            parts: Mutex::new(read_json(&dir.join("parts.json")).unwrap_or_default()),
            gone: AtomicBool::new(false),
        }
    }

    pub fn stop(&self) {
        self.mon.stop();
    }
    pub fn checks(&self) -> usize {
        self.kept.lock().unwrap().items.len()
    }
}

impl Host for Headless {
    fn network_id(&self) -> String {
        self.network.clone()
    }
    fn current_retention(&self) -> u32 {
        self.local.lock().unwrap().retention_days
    }
    fn statuses(&self) -> Vec<Status> {
        self.mon.statuses()
    }
    fn issues(&self) -> Vec<Issue> {
        self.inner.lock().unwrap().issues.list.iter().filter(|i| i.network_id == self.network).cloned().collect()
    }
    fn stats_day(&self, day: i64) -> Option<Value> {
        if self.current_retention() == 0 {
            return None;
        }
        let s = self.stats.as_ref()?.lock().ok()?;
        let mut out = serde_json::Map::new();
        for it in &self.kept.lock().unwrap().items {
            let hours = s.hours(&it.key, day, day + stats::DAY_MS).ok()?;
            if !hours.is_empty() {
                out.insert(it.key.clone(), json!({ "node": it.node_id, "name": it.name, "hours": hours }));
            }
        }
        Some(Value::Object(out))
    }
    fn act(&self, issue: &str, a: Act) {
        let (expected, at) = (a.act == "expected", a.at);
        let (issue, nodes) = {
            let mut g = self.inner.lock().unwrap();
            let before = g.issues.get(issue).map(|i| i.rev);
            let Some(issue) = g.issues.act(issue, a) else { return };
            if before == Some(issue.rev) {
                return;
            }
            let _ = write_json(&self.dir.join("issues.json"), &g.issues);
            (issue, g.issues.expected_nodes(&self.network))
        };
        if expected {
            // Its time down so far is maintenance, over every check of the device.
            let mut keys: BTreeSet<String> = issue.keys.iter().cloned().collect();
            keys.extend(self.kept.lock().unwrap().items.iter().filter(|i| i.node_id == issue.node_id).map(|i| i.key.clone()));
            let keys: Vec<String> = keys.into_iter().collect();
            if let Some(Ok(s)) = self.stats.as_ref().map(|s| s.lock()) {
                for o in &issue.outages {
                    let _ = s.mark_maintenance(&keys, o.from, o.to.unwrap_or(at).max(o.from));
                }
            }
        }
        self.mon.set_expected(nodes);
    }
    fn quiet(&self, scope: &str, id: &str, until: i64) {
        let now = monitor::now_ms();
        let until = if until > now { until.min(now + 366 * 86_400_000) } else { 0 };
        let mut c = self.local.lock().unwrap();
        match scope {
            "site" => c.quiet.site = until,
            "node" | "group" if !id.is_empty() && id.len() <= 200 => {
                let map = if scope == "node" { &mut c.quiet.nodes } else { &mut c.quiet.groups };
                if until > 0 {
                    map.insert(id.to_string(), until);
                } else {
                    map.remove(id);
                }
            }
            _ => return,
        }
        c.quiet.prune(now);
        let _ = write_json(&self.dir.join("local.json"), &*c);
        self.mon.set_quiet(c.quiet.clone());
    }
    fn retention(&self, days: u32) {
        let days = days.min(RETENTION_MAX_DAYS);
        let mut c = self.local.lock().unwrap();
        if c.retention_days == days {
            return;
        }
        c.retention_days = days;
        let _ = write_json(&self.dir.join("local.json"), &*c);
        self.mon.set_retention(days);
        if let Some(Ok(s)) = self.stats.as_ref().map(|s| s.lock()) {
            let _ = if days == 0 { s.clear() } else { s.prune(monitor::now_ms(), days).map(|_| ()) };
        }
    }
    fn notify_stale(&self, name: &str) {
        eprintln!("topo-monitor: the site's monitor \"{name}\" has stopped reporting");
    }
    fn revoked(&self) {
        // An owner revoked it: the keys and the credential are forgotten.
        let _ = fs::remove_file(self.dir.join("secret.json"));
        self.gone.store(true, Ordering::SeqCst);
    }
    fn status_extra(&self) -> Option<Value> {
        let k = self.kept.lock().unwrap();
        Some(json!({ "wantsPlan": true, "planHash": k.hash, "planRev": k.rev, "groups": self.groups, "program": "topo-monitor" }))
    }
    fn plan_part(&self, v: &Value) -> bool {
        let have = self.kept.lock().unwrap().rev;
        let mut parts = self.parts.lock().unwrap();
        let got = parts.add(&self.monitor_id, have, v);
        let _ = write_json(&self.dir.join("parts.json"), &*parts);
        let Some(mut kept) = got else { return false };
        kept.items = monitor::normalize(kept.items);
        if let Err(e) = write_json(&self.dir.join("plan.json"), &kept) {
            eprintln!("topo-monitor: the checks could not be kept: {e}");
        }
        {
            let mut g = self.inner.lock().unwrap();
            g.names = node_names(&kept);
            let keys: std::collections::HashSet<&String> = kept.items.iter().map(|i| &i.key).collect();
            g.all.retain(|k, _| keys.contains(k));
        }
        eprintln!("topo-monitor: {} checks from the site ({})", kept.items.len(), self.name);
        self.mon.set_items(kept.items.clone());
        *self.kept.lock().unwrap() = kept;
        true
    }
}

struct ClientApi(client::Client);
impl Api for ClientApi {
    fn call(&self, method: &str, path: &str, body: Option<&str>) -> Result<(u16, Vec<u8>), String> {
        self.0.request(method, path, body).map(|r| (r.status, r.body))
    }
}

// ---- The commands ----

/// May this user write in `dir`? (The packaged service's folder belongs to
/// its own user alone, so this is true for that user and nobody else.)
#[cfg(unix)]
fn writable(dir: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = std::ffi::CString::new(dir.as_os_str().as_bytes()) else { return false };
    dir.is_dir() && unsafe { libc::access(c.as_ptr(), libc::W_OK | libc::X_OK) } == 0
}
#[cfg(not(unix))]
fn writable(_dir: &Path) -> bool {
    false
}

/// The folder for one user's files, `service` being the packaged service's
/// (given so the tests need no /var/lib).
fn default_dir_with(service: &Path) -> PathBuf {
    if let Some(d) = std::env::var_os("TOPO_MONITOR_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(d);
    }
    // The packaged service's user: `sudo -u topo-monitor topo-monitor request`
    // lands where the service will look, with no --dir to remember.
    if writable(service) {
        return service.to_path_buf();
    }
    if let Some(d) = std::env::var_os("XDG_STATE_HOME").filter(|d| !d.is_empty()) {
        return PathBuf::from(d).join("topo-monitor");
    }
    if let Some(d) = std::env::var_os("LOCALAPPDATA").filter(|d| !d.is_empty()) {
        return PathBuf::from(d).join("topo-monitor");
    }
    match std::env::var_os("HOME").filter(|d| !d.is_empty()) {
        Some(h) => PathBuf::from(h).join(".local").join("state").join("topo-monitor"),
        None => PathBuf::from("topo-monitor-data"),
    }
}

fn default_dir() -> PathBuf {
    default_dir_with(Path::new(SERVICE_DIR))
}

fn host_name() -> String {
    let n = std::env::var("HOSTNAME").ok().or_else(|| fs::read_to_string("/etc/hostname").ok()).or_else(|| std::env::var("COMPUTERNAME").ok()).unwrap_or_default();
    let n = n.trim().split('.').next().unwrap_or("").to_string();
    if n.is_empty() { "Monitor".into() } else { n }
}

fn read_secret(dir: &Path) -> Option<Secret> {
    read_json(&dir.join("secret.json"))
}
fn read_link(dir: &Path) -> Option<LinkFile> {
    read_json(&dir.join("link.json"))
}

fn cmd_request(dir: &Path, name: Option<String>) -> Result<(), String> {
    if read_link(dir).map(|l| !l.revoked).unwrap_or(false) {
        return Err("This box is already a site's monitor. `topo-monitor forget` first, to make it another's.".into());
    }
    // The same keys until it is enrolled: asking twice prints the same line.
    let keys = match read_secret(dir).and_then(|s| DeviceKeys::from_secret(&s.keys).ok()) {
        Some(k) => k,
        None => DeviceKeys::generate(),
    };
    write_json(&dir.join("secret.json"), &Secret { keys: keys.to_secret(), token: String::new() })?;
    let _ = fs::remove_file(dir.join("link.json"));
    println!("{}", request_line(&name.unwrap_or_else(host_name), &keys));
    eprintln!("\nPaste the line above in Topo: Settings, Monitoring, Add a monitor with no screen.\nThen give the file Topo downloads to:  topo-monitor enroll FILE");
    Ok(())
}

fn cmd_enroll(dir: &Path, file: &str, pin: &str) -> Result<(), String> {
    let text = fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))?;
    let e: Enrolment = serde_json::from_str(&text).map_err(|_| "This is not an enrolment file from Topo.".to_string())?;
    let secret = read_secret(dir).ok_or("This box has no keys yet. Run `topo-monitor request` first.")?;
    let keys = DeviceKeys::from_secret(&secret.keys)?;
    let origin = client::normalize(&e.origin)?;
    let token = e.token.clone();
    let link = link_from(e, &keys, origin.clone(), pin, monitor::now_ms())?;
    // The server is asked once before anything is kept, so a wrong address
    // or a certificate nobody vouches for is said now.
    let c = client::Client::new(&origin, pin, None)?;
    if let Err(err) = c.probe() {
        let seen = c.seen_fingerprint();
        return Err(if !seen.is_empty() && pin.is_empty() {
            format!("{origin} did not answer with a certificate this box trusts ({err}).\nIts certificate's fingerprint is:\n  {seen}\nCompare it with the one the server's Settings shows. If they are the same, run this again with:  --pin {seen}")
        } else {
            format!("{origin} did not answer as a Topo server: {err}")
        });
    }
    write_json(&dir.join("secret.json"), &Secret { keys: secret.keys, token })?;
    write_json(&dir.join("link.json"), &link)?;
    for f in ["plan.json", "parts.json", "issues.json", "local.json"] {
        let _ = fs::remove_file(dir.join(f));
    }
    // The file holds the credential: it is not left lying where it was downloaded.
    let removed = fs::remove_file(file).is_ok();
    eprintln!("This box is now the monitor \"{}\" of the site, turned on by {}.", link.name, link.by);
    eprintln!("{}", if removed { "The enrolment file was deleted: its credential is kept here now." } else { "Delete the enrolment file: it holds this monitor's credential." });
    eprintln!("Start it with:  topo-monitor run");
    Ok(())
}

fn cmd_status(dir: &Path) -> Result<(), String> {
    println!("Files: {}", dir.display());
    let Some(l) = read_link(dir) else {
        println!("{}", if read_secret(dir).is_some() { "Keys made, not enrolled yet. Paste the line of `topo-monitor request` in Topo." } else { "Not set up. Start with `topo-monitor request`." });
        return Ok(());
    };
    println!("Monitor \"{}\" of a site on {}, turned on by {}.", l.name, l.origin, l.by);
    if l.revoked {
        println!("An owner revoked it. It reports nothing.");
    }
    let k: Kept = read_json(&dir.join("plan.json")).unwrap_or_default();
    println!("{}", if k.rev == 0 { "No checks yet: an owner must open the network in Topo once.".to_string() } else { format!("{} checks, from {}.", k.items.len(), if k.network_name.is_empty() { "the site" } else { &k.network_name }) });
    if l.last_push > 0 {
        println!("Last report {} s ago.", (monitor::now_ms() - l.last_push) / 1000);
    }
    if !l.error.is_empty() {
        println!("Not reporting: {}", l.error);
    }
    Ok(())
}

fn cmd_forget(dir: &Path) -> Result<(), String> {
    for f in ["secret.json", "link.json", "plan.json", "parts.json", "issues.json", "local.json"] {
        let _ = fs::remove_file(dir.join(f));
    }
    eprintln!("Forgotten here. The site still lists the monitor until an owner revokes it in the members list. The statistics file was left.");
    Ok(())
}

fn cmd_run(dir: &Path) -> Result<(), String> {
    let link = read_link(dir).ok_or("Not enrolled. Start with `topo-monitor request`.")?;
    if link.revoked {
        return Err("An owner revoked this monitor. `topo-monitor forget`, then `topo-monitor request` to enrol it again.".into());
    }
    let secret = read_secret(dir).filter(|s| !s.token.is_empty()).ok_or("The keys are missing. `topo-monitor forget`, then enrol again.")?;
    let keys = DeviceKeys::from_secret(&secret.keys)?;
    // One at a time per folder.
    let lock = fs::OpenOptions::new().create(true).truncate(false).write(true).open(dir.join("monitor.lock")).map_err(|e| e.to_string())?;
    if lock.try_lock().is_err() {
        return Err("Another topo-monitor is already running with these files.".into());
    }
    let c = client::Client::new(&link.origin, &link.pin, None)?;
    c.set_monitor_token(&secret.token);
    let api = ClientApi(c);
    let host = Headless::start(dir, &link, Arc::new(checks::run));
    eprintln!("topo-monitor: \"{}\" reporting to {} ({} checks kept)", link.name, link.origin, host.checks());
    let mut l = Link::new(link, keys);
    let mut said = String::new();
    loop {
        match l.tick(&host, &api, monitor::now_ms()) {
            Err(TickError::Revoked) => {
                let _ = write_json(&dir.join("link.json"), &l.file);
                host.stop();
                return Err("An owner revoked this monitor. Its keys were forgotten.".into());
            }
            Err(TickError::Other(e)) if e != said => {
                eprintln!("topo-monitor: not reporting: {e}");
                said = e;
            }
            Ok(()) if !said.is_empty() => {
                eprintln!("topo-monitor: reporting again");
                said.clear();
            }
            _ => {}
        }
        if l.dirty {
            l.dirty = false;
            let _ = write_json(&dir.join("link.json"), &l.file);
        }
        std::thread::sleep(std::time::Duration::from_secs(5));
    }
}

const USAGE: &str = "topo-monitor: a Topo site's monitor with no screen

  topo-monitor request [--name NAME]   make this box's keys; prints a line to paste in Topo
  topo-monitor enroll FILE [--pin FP]  take the enrolment file Topo gave back
  topo-monitor run                     check and report until stopped
  topo-monitor status                  what is kept here
  topo-monitor forget                  forget the keys and the site here
  topo-monitor --version

  --dir DIR   where its files are kept (or TOPO_MONITOR_DIR; else /var/lib/topo-monitor
              for the packaged service's user, else ~/.local/state/topo-monitor)";

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() == 1 && matches!(args[0].as_str(), "--version" | "-V" | "version") {
        println!("topo-monitor {VERSION}");
        return;
    }
    let mut take = |flag: &str| -> Option<String> {
        let i = args.iter().position(|a| a == flag)?;
        if i + 1 >= args.len() {
            return None;
        }
        args.remove(i);
        Some(args.remove(i))
    };
    let dir = take("--dir").map(PathBuf::from).unwrap_or_else(default_dir);
    let name = take("--name");
    let pin = take("--pin").unwrap_or_default();
    let r = match (args.first().map(String::as_str), args.get(1)) {
        (Some("request"), None) => cmd_request(&dir, name),
        (Some("enroll"), Some(file)) => cmd_enroll(&dir, file, pin.trim()),
        (Some("run"), None) => cmd_run(&dir),
        (Some("status"), None) => cmd_status(&dir),
        (Some("forget"), None) => cmd_forget(&dir),
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    };
    if let Err(e) = r {
        eprintln!("topo-monitor: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use checks::Outcome;
    use servercrypto::RosterMember;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("topo-monitor-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn roster_for(monitor: &str, keys: &DeviceKeys, role: &str) -> Roster {
        let m = RosterMember { u: monitor.into(), email: String::new(), role: role.into(), enc: String::new(), sig: servercrypto::fp(&keys.sig_pub()).unwrap() };
        Roster { v: 1, site: "s1".into(), seq: 2, epoch: 2, by: "u1".into(), at: 1, members: vec![m], sig: String::new() }
    }
    fn enrolment(keys: &DeviceKeys) -> Enrolment {
        Enrolment { v: 1, kind: ENROLMENT_KIND.into(), origin: "https://topo.example".into(), site: "s1".into(), monitor: "m1".into(), name: "Rack box".into(), by: "ana@example.com".into(),
            token: "tok".into(), roster: Some(roster_for("m1", keys, "monitor")), groups: vec!["g1".into(), String::new()], network: "card1".into() }
    }
    fn part(rev: i64, keys: &[&str]) -> Value {
        let items: Vec<Value> = keys.iter().map(|k| json!({ "key": k, "nodeId": k.split('/').next().unwrap(), "name": format!("{k} · ping"), "nodeName": k.split('/').next().unwrap(),
            "spec": { "proto": "ping", "host": "192.0.2.1" }, "intervalS": 30 })).collect();
        json!({ "v": 1, "monitor": "m1", "by": "u1", "rev": rev, "hash": format!("h{rev}"), "i": 0, "n": 1, "networkName": "Office", "items": items })
    }
    fn up() -> monitor::Runner {
        Arc::new(|_| Outcome::default())
    }

    #[test]
    fn the_request_line_carries_the_public_halves_only() {
        let keys = DeviceKeys::generate();
        let line = request_line("Rack box", &keys);
        let v: Value = serde_json::from_slice(&servercrypto::unb64u(line.strip_prefix(REQUEST_PREFIX).unwrap()).unwrap()).unwrap();
        assert_eq!((v["v"].as_i64(), v["name"].as_str(), v["encPub"].as_str(), v["sigPub"].as_str()), (Some(1), Some("Rack box"), Some(keys.enc_pub().as_str()), Some(keys.sig_pub().as_str())));
        assert_eq!(v.as_object().unwrap().len(), 4);
        assert!(!line.contains(&keys.to_secret()));
    }

    #[test]
    fn an_enrolment_is_checked_against_this_boxs_keys() {
        let keys = DeviceKeys::generate();
        let l = link_from(enrolment(&keys), &keys, "https://topo.example".into(), "", 7).unwrap();
        assert_eq!((l.site.as_str(), l.monitor.as_str(), l.network.as_str(), l.groups.clone(), l.stats_days, l.key_kind.as_str(), l.enrolled_at), ("s1", "m1", "card1", vec!["g1".to_string()], -1, "file", 7));
        // Made for another box.
        assert!(link_from(enrolment(&DeviceKeys::generate()), &keys, "o".into(), "", 7).unwrap_err().contains("another box"));
        // Named, but not as a monitor.
        let mut e = enrolment(&keys);
        e.roster = Some(roster_for("m1", &keys, "owner"));
        assert!(link_from(e, &keys, "o".into(), "", 7).is_err());
        for strip in ["kind", "token", "network", "roster"] {
            let mut e = enrolment(&keys);
            match strip {
                "kind" => e.kind = "x".into(),
                "token" => e.token.clear(),
                "network" => e.network.clear(),
                _ => e.roster = None,
            }
            assert!(link_from(e, &keys, "o".into(), "", 7).is_err(), "{strip}");
        }
    }

    #[test]
    fn it_asks_for_its_checks_takes_them_and_keeps_them() {
        let dir = tmp("plan");
        let keys = DeviceKeys::generate();
        let link = link_from(enrolment(&keys), &keys, "https://topo.example".into(), "", 7).unwrap();
        let h = Headless::start(&dir, &link, up());
        let x = h.status_extra().unwrap();
        assert_eq!((x["wantsPlan"].as_bool(), x["planHash"].as_str(), x["groups"][0].as_str(), x["program"].as_str()), (Some(true), Some(""), Some("g1"), Some("topo-monitor")));
        assert_eq!((h.network_id().as_str(), h.checks(), h.statuses().len()), ("card1", 0, 0));
        assert!(h.plan_part(&part(10, &["r1/c1", "sw/c1"])));
        assert_eq!((h.checks(), h.statuses().len()), (2, 2));
        assert_eq!(h.status_extra().unwrap()["planHash"], "h10");
        // The same plan again, and an older one: passed over.
        assert!(!h.plan_part(&part(10, &["r1/c1"])));
        assert!(!h.plan_part(&part(9, &["r1/c1"])));
        // Through the link's own reader, as a record's payload arrives.
        assert!(monitorlink::apply_record(&h, "plan", &part(11, &["r1/c1"])));
        assert_eq!(h.checks(), 1);
        h.stop();
        // Started again with no browser open: the checks are the ones kept.
        let again = Headless::start(&dir, &link, up());
        assert_eq!((again.checks(), again.status_extra().unwrap()["planRev"].as_i64()), (1, Some(11)));
        again.stop();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(dir.join("plan.json")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_owners_quiet_windows_and_keep_statistics_are_kept_here() {
        let dir = tmp("local");
        let keys = DeviceKeys::generate();
        let link = link_from(enrolment(&keys), &keys, "https://topo.example".into(), "", 7).unwrap();
        let h = Headless::start(&dir, &link, up());
        assert_eq!(h.current_retention(), RETENTION_DEFAULT_DAYS);
        let later = monitor::now_ms() + 3_600_000;
        assert!(monitorlink::apply_record(&h, "quiet", &json!({ "scope": "node", "id": "r1", "until": later })));
        h.quiet("nonsense", "x", later);
        h.retention(30);
        h.stop();
        let l: Local = read_json(&dir.join("local.json")).unwrap();
        assert_eq!((l.quiet.nodes.get("r1").copied(), l.quiet.nodes.len(), l.retention_days), (Some(later), 1, 30));
        let again = Headless::start(&dir, &link, up());
        assert_eq!(again.current_retention(), 30);
        again.retention(0);
        assert!(again.stats_day(0).is_none());
        again.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn the_packaged_services_folder_is_used_only_by_who_may_write_there() {
        use std::os::unix::fs::PermissionsExt;
        // TOPO_MONITOR_DIR is not set under `cargo test`; if a caller set it, this says nothing.
        if std::env::var_os("TOPO_MONITOR_DIR").is_some() {
            return;
        }
        let mine = tmp("service-dir");
        assert_eq!(default_dir_with(&mine), mine);
        // One this user may not write in (root may write anywhere: nothing to learn then).
        fs::set_permissions(&mine, fs::Permissions::from_mode(0o500)).unwrap();
        if unsafe { libc::geteuid() } != 0 {
            assert_ne!(default_dir_with(&mine), mine);
        }
        fs::set_permissions(&mine, fs::Permissions::from_mode(0o700)).unwrap();
        let _ = fs::remove_dir_all(&mine);
        // None there at all: the user's own folder.
        let gone = std::env::temp_dir().join("topo-monitor-test-no-such-folder");
        assert_ne!(default_dir_with(&gone), gone);
        assert!(!VERSION.is_empty());
    }

    #[test]
    fn a_revoke_forgets_the_keys() {
        let dir = tmp("revoke");
        let keys = DeviceKeys::generate();
        write_json(&dir.join("secret.json"), &Secret { keys: keys.to_secret(), token: "tok".into() }).unwrap();
        let link = link_from(enrolment(&keys), &keys, "https://topo.example".into(), "", 7).unwrap();
        let h = Headless::start(&dir, &link, up());
        h.revoked();
        assert!(h.gone.load(Ordering::SeqCst) && !dir.join("secret.json").exists());
        h.stop();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn request_keeps_the_same_keys_until_enrolled_and_refuses_once_enrolled() {
        let dir = tmp("request");
        cmd_request(&dir, Some("Box".into())).unwrap();
        let first = read_secret(&dir).unwrap().keys;
        cmd_request(&dir, None).unwrap();
        assert_eq!(read_secret(&dir).unwrap().keys, first);
        let keys = DeviceKeys::from_secret(&first).unwrap();
        write_json(&dir.join("link.json"), &link_from(enrolment(&keys), &keys, "o".into(), "", 7).unwrap()).unwrap();
        assert!(cmd_request(&dir, None).is_err());
        assert!(cmd_run(&tmp("empty")).unwrap_err().contains("Not enrolled"));
        cmd_forget(&dir).unwrap();
        assert!(read_secret(&dir).is_none() && read_link(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
