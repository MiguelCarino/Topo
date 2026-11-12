// The app's commands for "Monitor from this PC" (docs/SCOPE.md D131,
// step 7f): what js/checks.js calls, over src/monitor.rs, src/checks.rs and
// src/stats.rs.
//
//   monitor_info     the switch, the network watched, the retention, the
//                    tray and sign-in choices, the quiet windows
//   monitor_set      turn it on or off; the tray icon, Open Topo at
//                    sign-in, the retention (Off keeps nothing), the
//                    words the tray uses (the page's language)
//   monitor_plan     the checks of the network watched (from the page)
//   monitor_status   every item's state now
//   monitor_history  one item's samples of the last hours (its Check
//                    section's 24 h)
//   monitor_quiet    a quiet window (maintenance) on a device, a group or
//                    the whole site, or its end
//   monitor_older    what a shorter retention would delete (to confirm)
//   monitor_figures  some checks' hourly figures over a span (the visit
//                    monitor's before-and-after, step 7i)
//
// Issues and the alarm (step 7g, src/issues.rs, src/alarm.rs):
//
//   monitor_issues         the issue records kept on this PC
//   monitor_issue_act      Acknowledge, Report a problem or Expected on one
//                          (Expected: its down time becomes maintenance)
//   monitor_issues_folded  the records the page folded into the document
//   alarm_current          what the card window shows
//   alarm_answer           the card's Later, or its Acknowledge with a note
//   alarm_hand             the card hands an act to the main window
//   alarm_take             the main window takes what was handed to it
//   alarm_test             Test the alarm: the card marked DRILL
//
// Monitors through the server (step 7h, src/monitorlink.rs):
//
//   monitor_device_key  this PC's device keys, made and kept in the
//                       keychain (the public halves to the page)
//   monitor_enroll      the server's token and the roster the page trusts:
//                       this PC is the site's monitor from now on
//   monitor_link_info   what Settings shows (the site, the key's place, the
//                       last report, what went wrong, revoked)
//   monitor_unenroll    forget it here (the page revokes it on the server)
//
// The issues are worked out from every status change (the sink below) and
// kept in <app data>/monitor/issues.json; each change goes to the page as
// the event "topo-issues". With Show alarms on this PC on (off as shipped,
// D131), an issue opening (or going down again, unless it flaps) raises the
// card and a system notification; answering again, a small notification.
//
// Each state change is emitted to the page as the event "topo-monitor".
// Kept on disk: <app config>/monitor.json (the switch and the choices),
// <app data>/monitor/plan.json (the checks, so monitoring starts again
// with no window: Open Topo at sign-in starts the app with --background)
// and <app data>/monitor/stats.sqlite (src/stats.rs). One Topo at a time
// runs the monitor: <app data>/monitor/monitor.lock; a second window says
// the monitor runs in the other. The two files are read again when they
// change (every 2 s, D240): what the other Topo's window sets (the switch,
// the retention, a quiet window, the checks, the tray's words) reaches the
// one that monitors, and a Topo whose monitor is on takes it over when the
// other quits.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::alarm::{self, Pending, Queue, DRILL};
use crate::checks;
use crate::issues::{self, Act, Change, Issue, Issues};
use crate::monitor::{self, Monitor, Plan, Quiet, Status};
use crate::keystore::{self, KeyStore};
use crate::monitorlink::{Api, Host, Link, LinkFile, Secret};
use crate::servercrypto::{DeviceKeys, Roster};
use crate::stats::{Older, Sample, Stats, RETENTION_DEFAULT_DAYS, RETENTION_MAX_DAYS};

pub const EVENT: &str = "topo-monitor";
pub const EVENT_ISSUES: &str = "topo-issues";
/// The site monitor's link: revoked, another monitor stopped (step 7h).
pub const EVENT_LINK: &str = "topo-monitor-link";
pub const BACKGROUND_ARG: &str = "--background";

/// The words the tray uses, in the page's language.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Labels {
    pub open: String,
    pub quit: String,
    /// The tooltip when everything answers ("Topo: checking 12").
    pub tip: String,
    /// When some do not ("Topo: {n} not answering").
    pub tip_down: String,
    /// The page's language (the alarm card's).
    pub lang: String,
    /// Who acts from the card (the name Settings keeps, else "").
    pub by: String,
    /// The notifications (step 7g): a device not answering, with devices
    /// behind it, answering again, the drill.
    pub alarm: String,
    pub alarm_behind: String,
    /// One device behind it ("{name} and 1 device behind it …").
    pub alarm_behind_one: String,
    pub recovered: String,
    pub drill: String,
    /// Another monitor of the site stopped reporting (step 7h, D151).
    pub stale: String,
}

impl Default for Labels {
    fn default() -> Self {
        Labels {
            open: "Open Topo".into(),
            quit: "Quit Topo".into(),
            tip: "Topo: monitoring".into(),
            tip_down: "Topo: {n} not answering".into(),
            lang: "en".into(),
            by: String::new(),
            alarm: "{name} is not answering".into(),
            alarm_behind: "{name} and {n} devices behind it are not answering".into(),
            alarm_behind_one: "{name} and 1 device behind it are not answering".into(),
            recovered: "{name} is answering again (down {min} min)".into(),
            drill: "Test of the alarm: nothing is down".into(),
            stale: "Monitor at {name} stopped reporting".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub on: bool,
    /// Days of hourly figures kept; 0 is Off (nothing kept, D162).
    pub retention_days: u32,
    pub tray: bool,
    pub autostart: bool,
    pub quiet: Quiet,
    pub labels: Labels,
    /// Show alarms on this PC: the card and the notifications (D131, off
    /// as shipped).
    pub alarms: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config { on: false, retention_days: RETENTION_DEFAULT_DAYS, tray: false, autostart: false, quiet: Quiet::default(), labels: Labels::default(), alarms: false }
    }
}

/// The issues' side: every item's latest status, the records, the plan's
/// device names and network (kept from the plan, so the sink never copies
/// the plan).
#[derive(Default)]
pub struct IssueState {
    all: std::collections::HashMap<String, Status>,
    issues: Issues,
    loaded: bool,
    /// The file's time when last read or written: a change made by the other
    /// Topo on this PC (D240) is read again before anything is added.
    at: Option<SystemTime>,
    names: std::collections::HashMap<String, String>,
    network_id: String,
}

#[derive(Default)]
pub struct MonitorState {
    /// Each with the file's time when read: read again once it changed.
    cfg: Mutex<Option<(Option<SystemTime>, Config)>>,
    plan: Mutex<Option<(Option<SystemTime>, Plan)>>,
    mon: Mutex<Option<Monitor>>,
    stats: OnceLock<Option<Arc<Mutex<Stats>>>>,
    lock: Mutex<Option<fs::File>>,
    /// The monitor is on, but runs in another Topo on this PC.
    elsewhere: Mutex<bool>,
    tray: Mutex<Option<TrayIcon>>,
    /// The items not answering, kept from the events (the tray's tooltip).
    down: Mutex<std::collections::HashSet<String>>,
    watching: std::sync::atomic::AtomicBool,
    issues: Mutex<IssueState>,
    alarm: Mutex<Queue>,
    /// The site monitor's link thread runs (step 7h).
    linking: std::sync::atomic::AtomicBool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub on: bool,
    pub running: bool,
    pub elsewhere: bool,
    pub retention_days: u32,
    pub tray: bool,
    pub autostart: bool,
    pub network_id: String,
    pub network_name: String,
    pub count: usize,
    pub quiet: Quiet,
    pub platform: String,
    /// Where the statistics are kept ("" when they could not be opened).
    pub stats_file: String,
    /// Show alarms on this PC (step 7g).
    pub alarms: bool,
    /// The name the issues give this monitor ("Checked by monitor …").
    pub monitor_name: String,
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("monitor.json"))
}
fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("monitor"))
}
fn plan_path(app: &AppHandle) -> Option<PathBuf> {
    data_dir(app).map(|d| d.join("plan.json"))
}
fn issues_path(app: &AppHandle) -> Option<PathBuf> {
    data_dir(app).map(|d| d.join("issues.json"))
}

/// This PC's name, as the issues say "Checked by monitor …" (D158); the
/// monitor's own name from 7h.
pub fn monitor_name() -> String {
    static NAME: OnceLock<String> = OnceLock::new();
    NAME.get_or_init(|| crate::thiscomputer::read().map(|t| t.hostname).unwrap_or_default().chars().take(120).collect()).clone()
}
fn mtime(p: &Option<PathBuf>) -> Option<SystemTime> {
    p.as_ref().and_then(|p| fs::metadata(p).ok()).and_then(|m| m.modified().ok())
}

/// Whole or not at all: a temporary file, then a rename.
fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}
fn read_json<T: for<'de> Deserialize<'de> + Default>(path: Option<PathBuf>) -> T {
    path.and_then(|p| fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn cfg(app: &AppHandle, st: &MonitorState) -> Config {
    let path = config_path(app);
    let at = mtime(&path);
    let mut g = st.cfg.lock().unwrap();
    if g.as_ref().map(|(t, _)| *t != at).unwrap_or(true) {
        let mut c: Config = read_json(path);
        c.retention_days = c.retention_days.min(RETENTION_MAX_DAYS);
        *g = Some((at, c));
    }
    g.as_ref().unwrap().1.clone()
}
fn save_cfg(app: &AppHandle, st: &MonitorState, c: Config) -> Result<(), String> {
    let path = config_path(app);
    if let Some(p) = &path {
        write_json(p, &c)?;
    }
    *st.cfg.lock().unwrap() = Some((mtime(&path), c));
    Ok(())
}
fn plan(app: &AppHandle, st: &MonitorState) -> Plan {
    let path = plan_path(app);
    let at = mtime(&path);
    let mut g = st.plan.lock().unwrap();
    if g.as_ref().map(|(t, _)| *t != at).unwrap_or(true) {
        let mut p: Plan = read_json(path);
        p.items = monitor::normalize(p.items);
        plan_names(app, st, &p);
        *g = Some((at, p));
    }
    g.as_ref().unwrap().1.clone()
}

/// The plan's network and device names, for the issues; statuses of items
/// no longer planned are forgotten. Another network watched now: the old
/// one's outages still going on end unseen (D253), and the page is told.
fn plan_names(app: &AppHandle, st: &MonitorState, p: &Plan) {
    let ended = {
        let mut g = st.issues.lock().unwrap();
        g.network_id = p.network_id.clone();
        g.names = p.items.iter().map(|i| (i.node_id.clone(), if i.node_name.is_empty() { i.name.split(" · ").next().unwrap_or("").to_string() } else { i.node_name.clone() })).collect();
        let keys: std::collections::HashSet<&String> = p.items.iter().map(|i| &i.key).collect();
        g.all.retain(|k, _| keys.contains(k));
        load_issues(app, &mut g);
        let ended = g.issues.end_others(&p.network_id, monitor::now_ms());
        if !ended.is_empty() {
            save_issues(app, &mut g);
        }
        ended
    };
    if !ended.is_empty() {
        let list: Vec<&Issue> = ended.iter().map(|(_, i)| i).collect();
        let _ = app.emit(EVENT_ISSUES, &list);
    }
}

// ---- Issues (step 7g) ----

fn load_issues(app: &AppHandle, g: &mut IssueState) {
    let path = issues_path(app);
    let at = mtime(&path);
    if !g.loaded || at != g.at {
        g.loaded = true;
        g.at = at;
        g.issues = read_json(path);
    }
}
fn save_issues(app: &AppHandle, g: &mut IssueState) {
    let path = issues_path(app);
    if let Some(p) = &path {
        if let Err(e) = write_json(p, &g.issues) {
            eprintln!("topo: the issues could not be kept: {e}");
        }
    }
    g.at = mtime(&path);
}

/// A status change from the monitor: the issues worked out again, kept,
/// sent to the page, and the alarm raised when it is on.
fn on_statuses(app: &AppHandle, changed: &[Status]) {
    let st = app.state::<MonitorState>();
    let raised: Vec<(Change, Issue)> = {
        let mut g = st.issues.lock().unwrap();
        load_issues(app, &mut g);
        for s in changed {
            g.all.insert(s.key.clone(), s.clone());
        }
        let IssueState { all, issues, names, network_id, .. } = &mut *g;
        let mut mint = issues::mint_id;
        let out = issues.update(network_id, &monitor_name(), all, names, monitor::now_ms(), &mut mint);
        if !out.is_empty() {
            g.issues.prune(monitor::now_ms());
            save_issues(app, &mut g);
        }
        out
    };
    if raised.is_empty() {
        return;
    }
    let list: Vec<&Issue> = raised.iter().map(|(_, i)| i).collect();
    let _ = app.emit(EVENT_ISSUES, &list);
    let c = cfg(app, &st);
    let mut show = false;
    for r in to_raise(&raised, c.alarms, &c.labels) {
        match r {
            Raise::Card { id, body } => {
                if st.alarm.lock().unwrap().push(&id) {
                    show = true;
                    alarm::notify("Topo", &body, true);
                }
            }
            Raise::Note { body } => alarm::notify("Topo", &body, false),
        }
    }
    if show {
        alarm::show(app);
    }
}

/// What a set of issue changes raises on this PC.
#[derive(Clone, Debug, PartialEq)]
pub enum Raise {
    /// A card (and its system notification, unless the card is queued
    /// already).
    Card { id: String, body: String },
    /// A small notification only: a device answering again.
    Note { body: String },
}

/// Pure, for the tests: with Show alarms on this PC off, nothing; an issue
/// opening, or an open one going down again (not while it flaps, D244), a
/// card; a closed issue, none; answering again, a small notification (D250).
pub fn to_raise(changes: &[(Change, Issue)], alarms_on: bool, labels: &Labels) -> Vec<Raise> {
    if !alarms_on {
        return Vec::new();
    }
    let mut out = Vec::new();
    for (ch, i) in changes {
        match ch {
            Change::Opened | Change::Repeated if !(*ch == Change::Repeated && i.flapping) && i.is_open() => {
                let body = match i.behind.len() {
                    0 => labels.alarm.replace("{name}", &i.name),
                    1 => labels.alarm_behind_one.replace("{name}", &i.name),
                    n => labels.alarm_behind.replace("{name}", &i.name).replace("{n}", &n.to_string()),
                };
                out.push(Raise::Card { id: i.id.clone(), body });
            }
            Change::Recovered => {
                let min = i.recovered().map(|r| ((r - i.since()) as f64 / 60_000.0).round().max(1.0) as i64).unwrap_or(0);
                out.push(Raise::Note { body: labels.recovered.replace("{name}", &i.name).replace("{min}", &min.to_string()) });
            }
            _ => {}
        }
    }
    out
}
/// The retention applied: the running monitor told first, then what is
/// past it deleted, under the statistics' lock (D238), so no sample lands
/// after Off cleared the file.
fn apply_retention(app: &AppHandle, st: &MonitorState, days: u32) -> Result<(), String> {
    let s = stats(app, st);
    let guard = s.as_ref().map(|s| s.lock());
    if let Some(m) = st.mon.lock().unwrap().as_ref() {
        m.set_retention(days);
    }
    if let Some(Ok(s)) = guard.as_ref() {
        if days == 0 {
            s.clear().map_err(|e| e.to_string())?;
        } else {
            s.prune(monitor::now_ms(), days).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn stats(app: &AppHandle, st: &MonitorState) -> Option<Arc<Mutex<Stats>>> {
    st.stats
        .get_or_init(|| {
            let path = data_dir(app)?.join("stats.sqlite");
            match Stats::open(&path) {
                Ok(s) => Some(Arc::new(Mutex::new(s))),
                Err(e) => {
                    eprintln!("topo: the monitor's statistics could not be opened: {e}");
                    None
                }
            }
        })
        .clone()
}

fn info(app: &AppHandle, st: &MonitorState) -> Info {
    let c = cfg(app, st);
    let p = plan(app, st);
    Info {
        on: c.on,
        running: st.mon.lock().unwrap().is_some(),
        elsewhere: *st.elsewhere.lock().unwrap(),
        retention_days: c.retention_days,
        tray: c.tray,
        autostart: c.autostart,
        network_id: p.network_id,
        network_name: p.network_name,
        count: p.items.len(),
        quiet: c.quiet,
        alarms: c.alarms,
        monitor_name: monitor_name(),
        platform: std::env::consts::OS.to_string(),
        stats_file: data_dir(app).map(|d| d.join("stats.sqlite").to_string_lossy().into_owned()).unwrap_or_default(),
    }
}

// ---- One monitor per PC ----

#[cfg(unix)]
fn try_lock(path: &Path) -> Option<fs::File> {
    use std::os::unix::io::AsRawFd;
    let _ = fs::create_dir_all(path.parent()?);
    let f = fs::OpenOptions::new().create(true).truncate(false).write(true).open(path).ok()?;
    // SAFETY: flock on a descriptor this File owns.
    let r = unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if r == 0 { Some(f) } else { None }
}
#[cfg(windows)]
fn try_lock(path: &Path) -> Option<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    let _ = fs::create_dir_all(path.parent()?);
    fs::OpenOptions::new().create(true).truncate(false).write(true).share_mode(0).open(path).ok()
}

/// Starts the monitor here, if it is on and no other Topo runs it.
fn start(app: &AppHandle, st: &MonitorState) {
    let c = cfg(app, st);
    if !c.on || st.mon.lock().unwrap().is_some() {
        return;
    }
    let Some(dir) = data_dir(app) else { return };
    let Some(lock) = try_lock(&dir.join("monitor.lock")) else {
        *st.elsewhere.lock().unwrap() = true;
        return;
    };
    *st.elsewhere.lock().unwrap() = false;
    *st.lock.lock().unwrap() = Some(lock);
    let s = stats(app, st);
    if let Some(s) = &s {
        if let Ok(s) = s.lock() {
            let _ = if c.retention_days > 0 { s.prune(monitor::now_ms(), c.retention_days).map(|_| ()) } else { s.clear() };
        }
    }
    let emit_app = app.clone();
    let sink: monitor::Sink = Arc::new(move |changed: Vec<Status>| {
        let _ = emit_app.emit(EVENT, &changed);
        {
            let st = emit_app.state::<MonitorState>();
            let mut d = st.down.lock().unwrap();
            for s in &changed {
                if s.state == "down" {
                    d.insert(s.key.clone());
                } else {
                    d.remove(&s.key);
                }
            }
        }
        tray_tip(&emit_app);
        on_statuses(&emit_app, &changed);
    });
    let runner: monitor::Runner = Arc::new(checks::run);
    let m = Monitor::start(runner, sink, s, c.retention_days, c.quiet.clone());
    let expected = {
        let mut g = st.issues.lock().unwrap();
        load_issues(app, &mut g);
        g.issues.expected_nodes(&g.network_id)
    };
    m.set_expected(expected);
    m.set_items(plan(app, st).items);
    *st.mon.lock().unwrap() = Some(m);
}

fn stop(st: &MonitorState) {
    if let Some(m) = st.mon.lock().unwrap().take() {
        m.stop();
    }
    st.down.lock().unwrap().clear();
    *st.lock.lock().unwrap() = None;
}

/// At the app's start: the monitor if it is on, the tray if chosen.
/// Returns whether the app should open no window (--background, and a
/// monitor to run).
pub fn on_start(app: &AppHandle) -> bool {
    let st = app.state::<MonitorState>();
    start(app, &st);
    // A site monitor reports to its server with no window and no one
    // signed in (step 7h).
    link_thread(app);
    let c = cfg(app, &st);
    // The tray belongs to the Topo that monitors: a second one shows none.
    if c.on && c.tray && st.mon.lock().unwrap().is_some() {
        set_tray(app, true);
    }
    watch(app);
    let background = std::env::args().any(|a| a == BACKGROUND_ARG);
    // No window only when the tray icon is really there to open one.
    background && c.on && c.tray && st.mon.lock().unwrap().is_some() && st.tray.lock().unwrap().is_some()
}

/// Every 2 s: the files read again if they changed (the other Topo's window
/// wrote them, D240), and what changed applied to the monitor running here;
/// a monitor that is on but ran elsewhere is taken over once that one quits.
fn watch(app: &AppHandle) {
    let st = app.state::<MonitorState>();
    if st.watching.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let st = app.state::<MonitorState>();
        let was_cfg = st.cfg.lock().unwrap().as_ref().map(|(_, c)| c.clone());
        let was_plan = st.plan.lock().unwrap().as_ref().map(|(_, p)| p.clone());
        let c = cfg(&app, &st);
        let p = plan(&app, &st);
        let running = st.mon.lock().unwrap().is_some();
        if !running {
            if c.on {
                start(&app, &st);
                if st.mon.lock().unwrap().is_some() {
                    let a = app.clone();
                    let tray = c.tray;
                    let _ = app.run_on_main_thread(move || set_tray(&a, tray));
                }
            }
            continue;
        }
        if !c.on {
            stop(&st);
            let a = app.clone();
            let _ = app.run_on_main_thread(move || set_tray(&a, false));
            continue;
        }
        if let Some(w) = &was_cfg {
            if w.retention_days != c.retention_days {
                let _ = apply_retention(&app, &st, c.retention_days);
            }
            if w.quiet != c.quiet {
                if let Some(m) = st.mon.lock().unwrap().as_ref() {
                    m.set_quiet(c.quiet.clone());
                }
            }
            if w.tray != c.tray || w.labels != c.labels {
                let a = app.clone();
                let tray = c.tray;
                let _ = app.run_on_main_thread(move || set_tray(&a, tray));
            }
        }
        if was_plan.as_ref().map(|w| w.items != p.items).unwrap_or(false) {
            {
                let keys: std::collections::HashSet<&String> = p.items.iter().map(|i| &i.key).collect();
                st.down.lock().unwrap().retain(|k| keys.contains(k));
            }
            if let Some(m) = st.mon.lock().unwrap().as_ref() {
                m.set_items(p.items.clone());
            }
            tray_tip(&app);
        }
    });
}

/// Closing the last window keeps the app (and the monitor) running when the
/// tray icon is there to bring it back.
pub fn keeps_running(app: &AppHandle) -> bool {
    let st = app.state::<MonitorState>();
    let c = cfg(app, &st);
    let running = st.mon.lock().unwrap().is_some();
    c.on && c.tray && running && st.tray.lock().unwrap().is_some()
}

// ---- The tray ----

fn set_tray(app: &AppHandle, on: bool) {
    let st = app.state::<MonitorState>();
    if !on {
        if let Some(t) = st.tray.lock().unwrap().take() {
            let _ = t.set_visible(false);
        }
        return;
    }
    let l = cfg(app, &st).labels;
    let menu = || -> tauri::Result<Menu<tauri::Wry>> {
        let open = MenuItem::with_id(app, "topo-open", &l.open, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "topo-quit", &l.quit, true, None::<&str>)?;
        Menu::with_items(app, &[&open, &quit])
    };
    let had = st.tray.lock().unwrap().clone();
    if let Some(t) = had {
        // The menu made again: the words follow the page's language (D235).
        if let Ok(m) = menu() {
            let _ = t.set_menu(Some(m));
        }
        tray_tip(app);
        return;
    }
    let built = (|| -> tauri::Result<TrayIcon> {
        let menu = menu()?;
        let mut b = TrayIconBuilder::with_id("topo-monitor").menu(&menu).tooltip(&l.tip).on_menu_event(|app, ev| match ev.id().as_ref() {
            "topo-open" => crate::show_main_window(app),
            "topo-quit" => app.exit(0),
            _ => {}
        });
        if let Some(icon) = app.default_window_icon() {
            b = b.icon(icon.clone());
        }
        b.build(app)
    })();
    match built {
        Ok(t) => *st.tray.lock().unwrap() = Some(t),
        Err(e) => eprintln!("topo: no tray icon: {e}"),
    }
    tray_tip(app);
}

fn tray_tip(app: &AppHandle) {
    let st = app.state::<MonitorState>();
    let Some(t) = st.tray.lock().unwrap().clone() else { return };
    let l = cfg(app, &st).labels;
    let down = st.down.lock().unwrap().len();
    let tip = if down > 0 { l.tip_down.replace("{n}", &down.to_string()) } else { l.tip.clone() };
    let _ = t.set_tooltip(Some(tip));
}

// ---- Open Topo at sign-in (hand-written, no plugin) ----

pub const AUTOSTART_ID: &str = "systems.carino.topo";

/// The program the sign-in starts: the AppImage itself when run from one.
fn program() -> Option<PathBuf> {
    if let Some(a) = std::env::var_os("APPIMAGE") {
        return Some(PathBuf::from(a));
    }
    std::env::current_exe().ok()
}

/// A desktop entry's Exec value: the path quoted as the spec asks.
pub fn desktop_entry(exe: &Path) -> String {
    let p = exe.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"").replace('`', "\\`").replace('$', "\\$");
    format!(
        "[Desktop Entry]\nType=Application\nName=Topo\nComment=Checks the network's devices from this PC (Monitor from this PC)\nExec=\"{p}\" {BACKGROUND_ARG}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
    )
}

pub fn launch_agent(exe: &Path) -> String {
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>Label</key><string>{AUTOSTART_ID}</string>\n  <key>ProgramArguments</key>\n  <array><string>{}</string><string>{BACKGROUND_ARG}</string></array>\n  <key>RunAtLoad</key><true/>\n</dict>\n</plist>\n",
        esc(&exe.to_string_lossy())
    )
}

/// Linux: <config>/autostart/systems.carino.topo.desktop; macOS:
/// ~/Library/LaunchAgents/systems.carino.topo.plist; written or removed.
pub fn autostart_file(base: &Path, on: bool, exe: &Path, macos: bool) -> Result<(), String> {
    let (dir, name, text) = if macos {
        (base.join("Library").join("LaunchAgents"), format!("{AUTOSTART_ID}.plist"), launch_agent(exe))
    } else {
        (base.join("autostart"), format!("{AUTOSTART_ID}.desktop"), desktop_entry(exe))
    };
    let path = dir.join(name);
    if on {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(&path, text).map_err(|e| e.to_string())
    } else {
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

fn set_autostart(on: bool) -> Result<(), String> {
    let exe = program().ok_or("no program")?;
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .ok_or("no home")?;
        autostart_file(&base, on, &exe, false)
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from).ok_or("no home")?;
        autostart_file(&home, on, &exe, true)
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        let mut cmd = std::process::Command::new("reg");
        if on {
            let value = format!("\"{}\" {BACKGROUND_ARG}", exe.display());
            cmd.args(["add", key, "/v", "Topo", "/t", "REG_SZ", "/d", &value, "/f"]);
        } else {
            cmd.args(["delete", key, "/v", "Topo", "/f"]);
        }
        let out = cmd.creation_flags(CREATE_NO_WINDOW).output().map_err(|e| e.to_string())?;
        if out.status.success() || !on { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).into_owned()) }
    }
}

// ---- The commands ----

// ---- Monitors through the server (step 7h) ----

fn link_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("monitor-link.json"))
}
fn keystore(app: &AppHandle) -> Option<KeyStore> {
    data_dir(app).map(KeyStore::new)
}
fn read_link(app: &AppHandle) -> Option<LinkFile> {
    let p = link_path(app)?;
    let b = fs::read(p).ok()?;
    serde_json::from_slice(&b).ok()
}
fn write_link(app: &AppHandle, f: &LinkFile) -> Result<(), String> {
    match link_path(app) {
        Some(p) => write_json(&p, f),
        None => Err("path".into()),
    }
}
fn read_secret(app: &AppHandle) -> Option<(Secret, keystore::Kind)> {
    let (s, kind) = keystore(app)?.get()?;
    serde_json::from_str::<Secret>(&s).ok().map(|x| (x, kind))
}

/// This PC as the link sees it.
struct AppHost {
    app: AppHandle,
}

impl Host for AppHost {
    fn network_id(&self) -> String {
        let st = self.app.state::<MonitorState>();
        plan(&self.app, &st).network_id
    }
    fn current_retention(&self) -> u32 {
        let st = self.app.state::<MonitorState>();
        cfg(&self.app, &st).retention_days
    }
    fn statuses(&self) -> Vec<Status> {
        let st = self.app.state::<MonitorState>();
        let g = st.mon.lock().unwrap();
        g.as_ref().map(|m| m.statuses()).unwrap_or_default()
    }
    fn issues(&self) -> Vec<Issue> {
        let st = self.app.state::<MonitorState>();
        let mut g = st.issues.lock().unwrap();
        load_issues(&self.app, &mut g);
        let net = g.network_id.clone();
        g.issues.list.iter().filter(|i| i.network_id == net).cloned().collect()
    }
    fn stats_day(&self, day: i64) -> Option<serde_json::Value> {
        let st = self.app.state::<MonitorState>();
        if cfg(&self.app, &st).retention_days == 0 {
            return None;
        }
        let s = stats(&self.app, &st)?;
        let s = s.lock().ok()?;
        let mut out = serde_json::Map::new();
        for it in plan(&self.app, &st).items {
            let hours = s.hours(&it.key, day, day + crate::stats::DAY_MS).ok()?;
            if hours.is_empty() {
                continue;
            }
            out.insert(it.key.clone(), serde_json::json!({ "node": it.node_id, "name": it.name, "hours": hours }));
        }
        Some(serde_json::Value::Object(out))
    }
    fn act(&self, issue: &str, a: Act) {
        let st = self.app.state::<MonitorState>();
        act_on(&self.app, &st, issue, a);
    }
    fn quiet(&self, scope: &str, id: &str, until: i64) {
        let st = self.app.state::<MonitorState>();
        let _ = set_quiet(&self.app, &st, scope, id, until);
    }
    fn retention(&self, days: u32) {
        let st = self.app.state::<MonitorState>();
        let mut c = cfg(&self.app, &st);
        let days = days.min(RETENTION_MAX_DAYS);
        if c.retention_days != days {
            c.retention_days = days;
            if save_cfg(&self.app, &st, c).is_ok() {
                let _ = apply_retention(&self.app, &st, days);
            }
        }
    }
    fn notify_stale(&self, name: &str) {
        let st = self.app.state::<MonitorState>();
        let c = cfg(&self.app, &st);
        if c.alarms {
            alarm::notify("Topo", &c.labels.stale.replace("{name}", name), true);
        }
        let _ = self.app.emit(EVENT_LINK, serde_json::json!({ "stale": name }));
    }
    fn revoked(&self) {
        let st = self.app.state::<MonitorState>();
        let mut c = cfg(&self.app, &st);
        c.on = false;
        let _ = save_cfg(&self.app, &st, c);
        stop(&st);
        if let Some(k) = keystore(&self.app) {
            k.delete();
        }
        let _ = self.app.emit(EVENT_LINK, serde_json::json!({ "revoked": true }));
    }
}

struct ClientApi(crate::client::Client);
impl Api for ClientApi {
    fn call(&self, method: &str, path: &str, body: Option<&str>) -> Result<(u16, Vec<u8>), String> {
        self.0.request(method, path, body).map(|r| (r.status, r.body))
    }
}

/// The link's thread: one per app, every 5 s, while this PC is a site
/// monitor that runs here (the Topo that holds the monitor's lock).
fn link_thread(app: &AppHandle) {
    let st = app.state::<MonitorState>();
    if st.linking.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut cur: Option<(Link, ClientApi)> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let st = app.state::<MonitorState>();
            let Some(file) = read_link(&app) else {
                cur = None;
                continue;
            };
            if file.revoked || st.mon.lock().unwrap().is_none() {
                cur = None;
                continue;
            }
            let same = cur.as_ref().map(|(l, _)| l.file.monitor == file.monitor && l.file.site == file.site).unwrap_or(false);
            if !same {
                let Some((secret, _)) = read_secret(&app) else { continue };
                let Ok(keys) = DeviceKeys::from_secret(&secret.keys) else { continue };
                let Ok(client) = crate::client::Client::new(&file.origin, &file.pin, None) else { continue };
                client.set_monitor_token(&secret.token);
                cur = Some((Link::new(file, keys), ClientApi(client)));
            }
            let (link, api) = cur.as_mut().unwrap();
            let host = AppHost { app: app.clone() };
            let _ = link.tick(&host, api, monitor::now_ms());
            if link.dirty {
                link.dirty = false;
                // What the page set since (nothing it sets here) is kept:
                // the link owns this file while enrolled.
                let _ = write_link(&app, &link.file);
            }
        }
    });
}

/// The keys for the page to register (made once; kept while not enrolled).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceKeyInfo {
    pub enc_pub: String,
    pub sig_pub: String,
    /// "keychain" or "file" (a file only this user can read, D146).
    pub key_kind: String,
    pub name: String,
}

#[tauri::command]
pub fn monitor_device_key(app: AppHandle) -> Result<DeviceKeyInfo, String> {
    if read_link(&app).map(|f| !f.revoked).unwrap_or(false) {
        return Err("enrolled".into());
    }
    let ks = keystore(&app).ok_or("path")?;
    let keys = match read_secret(&app).and_then(|(s, _)| DeviceKeys::from_secret(&s.keys).ok()) {
        Some(k) => k,
        None => DeviceKeys::generate(),
    };
    let kind = ks.put(&serde_json::to_string(&Secret { keys: keys.to_secret(), token: String::new() }).map_err(|e| e.to_string())?)?;
    Ok(DeviceKeyInfo { enc_pub: keys.enc_pub(), sig_pub: keys.sig_pub(), key_kind: kind.as_str().into(), name: monitor_name() })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollArgs {
    pub site: String,
    pub monitor: String,
    pub name: String,
    pub by: String,
    pub token: String,
    pub roster: Roster,
    /// The groups it checks (D150); none: the whole site.
    #[serde(default)]
    pub groups: Vec<String>,
    /// The site's network (its library card id, D278).
    #[serde(default)]
    pub network: String,
}

#[tauri::command]
pub fn monitor_enroll(app: AppHandle, st: State<'_, MonitorState>, args: EnrollArgs) -> Result<LinkInfo, String> {
    let (origin, pin) = crate::clientcmd::saved_server(&app).ok_or("not-connected")?;
    // This PC's monitor watching another network would report it to the
    // site (D278): refused until it watches the site's.
    if args.network.is_empty() || args.network.len() > 200 {
        return Err("network".into());
    }
    if !enroll_network_ok(&plan(&app, &st).network_id, &args.network) {
        return Err("other-network".into());
    }
    let (secret, _) = read_secret(&app).ok_or("no-keys")?;
    let keys = DeviceKeys::from_secret(&secret.keys)?;
    let line = args.roster.member(&args.monitor).ok_or("roster")?;
    if line.role != "monitor" || crate::servercrypto::fp(&keys.sig_pub())? != line.sig {
        return Err("roster".into());
    }
    let kind = keystore(&app).ok_or("path")?.put(&serde_json::to_string(&Secret { keys: secret.keys, token: args.token }).map_err(|e| e.to_string())?)?;
    let f = LinkFile {
        origin,
        pin,
        site: args.site,
        monitor: args.monitor,
        name: args.name.chars().take(120).collect(),
        by: args.by.chars().take(254).collect(),
        enrolled_at: monitor::now_ms(),
        roster: Some(args.roster),
        groups: args.groups.into_iter().filter(|g| !g.is_empty() && g.len() <= 64).take(200).collect(),
        network: args.network,
        // Never the site's value: the first read applies it (D271).
        stats_days: -1,
        key_kind: kind.as_str().into(),
        ..Default::default()
    };
    write_link(&app, &f)?;
    link_thread(&app);
    Ok(link_info_of(Some(f)))
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    pub enrolled: bool,
    pub origin: String,
    pub site: String,
    pub monitor: String,
    pub name: String,
    pub by: String,
    pub enrolled_at: i64,
    pub key_kind: String,
    pub last_push: i64,
    pub stats_days: i64,
    pub error: String,
    pub revoked: bool,
    pub groups: Vec<String>,
    pub network: String,
}

/// May a PC whose monitor watches `watched` ("" = none yet) enroll for the
/// site whose network is `site_net`?
pub fn enroll_network_ok(watched: &str, site_net: &str) -> bool {
    watched.is_empty() || watched == site_net
}

fn link_info_of(f: Option<LinkFile>) -> LinkInfo {
    match f {
        None => LinkInfo::default(),
        Some(f) => LinkInfo {
            enrolled: !f.revoked,
            origin: f.origin,
            site: f.site,
            monitor: f.monitor,
            name: f.name,
            by: f.by,
            enrolled_at: f.enrolled_at,
            key_kind: f.key_kind,
            last_push: f.last_push,
            stats_days: f.stats_days,
            error: f.error,
            revoked: f.revoked,
            groups: f.groups,
            network: f.network,
        },
    }
}

#[tauri::command]
pub fn monitor_link_info(app: AppHandle) -> LinkInfo {
    link_info_of(read_link(&app))
}

/// A notification with the page's words, when Show alarms on this PC is on
/// (another monitor of the site stopped reporting, D151).
#[tauri::command]
pub fn alarm_notify(app: AppHandle, st: State<'_, MonitorState>, text: String) {
    if cfg(&app, &st).alarms {
        alarm::notify("Topo", &text.chars().take(300).collect::<String>(), true);
    }
}

#[tauri::command]
pub fn monitor_unenroll(app: AppHandle) -> Result<LinkInfo, String> {
    if let Some(p) = link_path(&app) {
        let _ = fs::remove_file(p);
    }
    if let Some(k) = keystore(&app) {
        k.delete();
    }
    Ok(LinkInfo::default())
}

#[tauri::command]
pub fn monitor_info(app: AppHandle, st: State<'_, MonitorState>) -> Info {
    info(&app, &st)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SetArgs {
    pub on: Option<bool>,
    pub tray: Option<bool>,
    pub autostart: Option<bool>,
    pub retention_days: Option<u32>,
    pub labels: Option<Labels>,
    pub alarms: Option<bool>,
}

#[tauri::command]
pub fn monitor_set(app: AppHandle, st: State<'_, MonitorState>, args: SetArgs) -> Result<Info, String> {
    let mut c = cfg(&app, &st);
    if let Some(l) = args.labels {
        c.labels = l;
    }
    if let Some(d) = args.retention_days {
        c.retention_days = d.min(RETENTION_MAX_DAYS);
        apply_retention(&app, &st, c.retention_days)?;
    }
    let mut autostart_err = None;
    if let Some(a) = args.autostart {
        match set_autostart(a) {
            Ok(()) => c.autostart = a,
            Err(e) => autostart_err = Some(e),
        }
    }
    if let Some(t) = args.tray {
        c.tray = t;
    }
    if let Some(a) = args.alarms {
        c.alarms = a;
        if !a {
            // The cards shown go too (the drill may stay); the card windows
            // close, or show what is left.
            let empty = {
                let mut q = st.alarm.lock().unwrap();
                q.cards.retain(|x| x == DRILL);
                q.cards.is_empty()
            };
            if empty {
                alarm::close_all(&app);
            } else {
                alarm::show(&app);
            }
        }
    }
    if let Some(on) = args.on {
        c.on = on;
        if !on && c.autostart {
            // Nothing to start at sign-in for.
            if set_autostart(false).is_ok() {
                c.autostart = false;
            }
        }
    }
    save_cfg(&app, &st, c.clone())?;
    if c.on {
        start(&app, &st);
    } else {
        stop(&st);
        *st.elsewhere.lock().unwrap() = false;
    }
    let here = st.mon.lock().unwrap().is_some();
    set_tray(&app, c.on && c.tray && here);
    if let Some(e) = autostart_err {
        return Err(format!("autostart: {e}"));
    }
    Ok(info(&app, &st))
}

#[tauri::command]
pub fn monitor_plan(app: AppHandle, st: State<'_, MonitorState>, plan: Plan) -> Result<Info, String> {
    let mut p = plan;
    p.network_id.truncate(200);
    p.network_name.truncate(200);
    p.items = monitor::normalize(p.items);
    let path = plan_path(&app);
    if let Some(pp) = &path {
        write_json(pp, &p)?;
    }
    {
        let keys: std::collections::HashSet<&String> = p.items.iter().map(|i| &i.key).collect();
        st.down.lock().unwrap().retain(|k| keys.contains(k));
    }
    if let Some(m) = st.mon.lock().unwrap().as_ref() {
        m.set_items(p.items.clone());
    }
    plan_names(&app, &st, &p);
    if let Some(m) = st.mon.lock().unwrap().as_ref() {
        let g = st.issues.lock().unwrap();
        m.set_expected(g.issues.expected_nodes(&g.network_id));
    }
    *st.plan.lock().unwrap() = Some((mtime(&path), p));
    tray_tip(&app);
    Ok(info(&app, &st))
}

#[tauri::command]
pub fn monitor_status(st: State<'_, MonitorState>) -> Vec<Status> {
    st.mon.lock().unwrap().as_ref().map(|m| m.statuses()).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    /// Off: nothing is kept, so there is nothing to show.
    pub kept: bool,
    pub samples: Vec<Sample>,
}

#[tauri::command]
pub fn monitor_history(app: AppHandle, st: State<'_, MonitorState>, key: String, hours: Option<u32>) -> History {
    let c = cfg(&app, &st);
    if c.retention_days == 0 {
        return History { kept: false, samples: Vec::new() };
    }
    let since = monitor::now_ms() - hours.unwrap_or(24).clamp(1, 168) as i64 * 3_600_000;
    let samples = stats(&app, &st).and_then(|s| s.lock().ok().and_then(|s| s.samples(&key, since).ok())).unwrap_or_default();
    History { kept: true, samples }
}

/// The hourly figures of some checks over [from, to) (the visit monitor's
/// before-and-after, step 7i, when this PC monitors the visit's network).
/// Off: none.
#[tauri::command]
pub fn monitor_figures(app: AppHandle, st: State<'_, MonitorState>, keys: Vec<String>, from: i64, to: i64) -> std::collections::HashMap<String, Vec<crate::stats::Hourly>> {
    let retention = cfg(&app, &st).retention_days;
    if retention == 0 {
        return std::collections::HashMap::new();
    }
    let Some(s) = stats(&app, &st) else { return std::collections::HashMap::new() };
    let Ok(g) = s.lock() else { return std::collections::HashMap::new() };
    figures_in(&g, retention, keys, from, to)
}

/// This PC's hourly figures of `keys` over whole hours inside [from, to):
/// an hour that ends after `to` is left out, so the hour a visit starts in
/// never counts as before it (D290, D294). Retention 0 (Off): nothing.
fn figures_in(g: &crate::stats::Stats, retention: u32, keys: Vec<String>, from: i64, to: i64) -> std::collections::HashMap<String, Vec<crate::stats::Hourly>> {
    let mut out = std::collections::HashMap::new();
    let to = crate::stats::floor_hour(to);
    if retention == 0 || to <= from {
        return out;
    }
    for k in keys.into_iter().take(1000) {
        if let Ok(h) = g.hours(&k, from, to) {
            if !h.is_empty() {
                out.insert(k, h);
            }
        }
    }
    out
}

#[tauri::command]
pub fn monitor_quiet(app: AppHandle, st: State<'_, MonitorState>, scope: String, id: Option<String>, until: i64) -> Result<Info, String> {
    set_quiet(&app, &st, &scope, &id.unwrap_or_default(), until)?;
    Ok(info(&app, &st))
}

/// A quiet window set here, or by an owner through the server (D227).
fn set_quiet(app: &AppHandle, st: &MonitorState, scope: &str, id: &str, until: i64) -> Result<(), String> {
    let mut c = cfg(app, st);
    let id = id.to_string();
    let until = if until > monitor::now_ms() { until.min(monitor::now_ms() + 366 * 86_400_000) } else { 0 };
    match scope {
        "site" => c.quiet.site = until,
        "node" | "group" if !id.is_empty() && id.len() <= 200 => {
            let map = if scope == "node" { &mut c.quiet.nodes } else { &mut c.quiet.groups };
            if until > 0 {
                map.insert(id, until);
            } else {
                map.remove(&id);
            }
        }
        _ => return Err("scope".into()),
    }
    c.quiet.prune(monitor::now_ms());
    save_cfg(app, st, c.clone())?;
    if let Some(m) = st.mon.lock().unwrap().as_ref() {
        m.set_quiet(c.quiet.clone());
    }
    Ok(())
}

#[tauri::command]
pub fn monitor_older(app: AppHandle, st: State<'_, MonitorState>, days: u32) -> Result<Older, String> {
    match stats(&app, &st) {
        Some(s) => s.lock().map_err(|e| e.to_string())?.older(monitor::now_ms(), days.min(RETENTION_MAX_DAYS)).map_err(|e| e.to_string()),
        None => Ok(Older::default()),
    }
}

// ---- Issues and the alarm (step 7g) ----

#[tauri::command]
pub fn monitor_issues(app: AppHandle, st: State<'_, MonitorState>) -> Vec<Issue> {
    let mut g = st.issues.lock().unwrap();
    load_issues(&app, &mut g);
    g.issues.list.clone()
}

/// Acknowledge, Report a problem or Expected, from the page (its own act,
/// or one the document holds that this PC's record lacks).
fn act_on(app: &AppHandle, st: &MonitorState, id: &str, a: Act) -> Option<Issue> {
    let expected = a.act == "expected";
    let at = a.at;
    let (issue, nodes) = {
        let mut g = st.issues.lock().unwrap();
        load_issues(app, &mut g);
        let before = g.issues.get(id).map(|i| i.rev);
        let issue = g.issues.act(id, a)?;
        if before == Some(issue.rev) {
            return Some(issue);
        }
        save_issues(app, &mut g);
        let nodes = g.issues.expected_nodes(&g.network_id);
        (issue, nodes)
    };
    if expected {
        // The issue's down time so far is maintenance, every outage on it
        // (repeats too, D245), over every check of the device; what follows
        // is shown quiet.
        let mut keys: std::collections::BTreeSet<String> = issue.keys.iter().cloned().collect();
        keys.extend(plan(app, st).items.into_iter().filter(|i| i.node_id == issue.node_id).map(|i| i.key));
        let keys: Vec<String> = keys.into_iter().collect();
        if let Some(s) = stats(app, st) {
            if let Ok(s) = s.lock() {
                for (from, to) in maintenance_spans(&issue, at) {
                    let _ = s.mark_maintenance(&keys, from, to);
                }
            }
        }
    }
    if let Some(m) = st.mon.lock().unwrap().as_ref() {
        m.set_expected(nodes);
    }
    let _ = app.emit(EVENT_ISSUES, vec![&issue]);
    // A card for it goes.
    let empty = st.alarm.lock().unwrap().remove(id);
    if empty {
        alarm::close_all(app);
    } else {
        alarm::show(app);
    }
    Some(issue)
}

/// Expected: the spans relabelled as maintenance, every outage of the issue
/// (one still going on, up to the act).
pub fn maintenance_spans(issue: &Issue, at: i64) -> Vec<(i64, i64)> {
    issue.outages.iter().map(|o| (o.from, o.to.unwrap_or(at).max(o.from))).collect()
}

#[tauri::command]
pub fn monitor_issue_act(app: AppHandle, st: State<'_, MonitorState>, id: String, act: Act) -> Option<Issue> {
    act_on(&app, &st, &id, act)
}

#[tauri::command]
pub fn monitor_issues_folded(app: AppHandle, st: State<'_, MonitorState>, done: Vec<(String, u64)>, dropped: Option<Vec<String>>) -> usize {
    let mut g = st.issues.lock().unwrap();
    load_issues(&app, &mut g);
    let n = g.issues.folded(&done, &dropped.unwrap_or_default());
    if n > 0 {
        save_issues(&app, &mut g);
    }
    n
}

#[tauri::command]
pub fn alarm_current(app: AppHandle, window: tauri::WebviewWindow, st: State<'_, MonitorState>) -> Option<alarm::View> {
    let c = cfg(&app, &st);
    let (id, more) = {
        let q = st.alarm.lock().unwrap();
        (q.cards.first().cloned()?, q.cards.len().saturating_sub(1))
    };
    let chime = window.label() == "alarm-0" && st.alarm.lock().unwrap().chime(&id);
    let mut g = st.issues.lock().unwrap();
    load_issues(&app, &mut g);
    let names = g.names.clone();
    let lookup = move |n: &str| names.get(n).cloned();
    alarm::view(g.issues.get(&id), &id, &lookup, &monitor_name(), monitor::now_ms(), more, &c.labels.lang, chime)
}

/// The card's own answers: "later" (Escape too), or "ack" with a note.
#[tauri::command]
pub fn alarm_answer(app: AppHandle, st: State<'_, MonitorState>, id: String, answer: String, note: Option<String>) -> Result<(), String> {
    match answer.as_str() {
        "later" => {}
        "ack" if id != DRILL => {
            let by = cfg(&app, &st).labels.by;
            act_on(&app, &st, &id, Act { act: "ack".into(), at: monitor::now_ms(), by, note: note.unwrap_or_default(), report_id: String::new() });
        }
        "ack" => {}
        _ => return Err("answer".into()),
    }
    let empty = st.alarm.lock().unwrap().remove(&id);
    if empty {
        alarm::close_all(&app);
    } else {
        alarm::show(&app);
    }
    Ok(())
}

/// Acknowledge or Report a problem, handed to the main window (which asks
/// to unlock first when it is locked).
#[tauri::command]
pub fn alarm_hand(app: AppHandle, st: State<'_, MonitorState>, id: String, act: String, locked: Option<bool>) -> Result<(), String> {
    if act != "ack" && act != "report" {
        return Err("act".into());
    }
    let p = Pending { id: id.clone(), act, locked: locked.unwrap_or(false) };
    let empty = {
        let mut q = st.alarm.lock().unwrap();
        q.pending = Some(p.clone());
        q.remove(&id)
    };
    if empty {
        alarm::close_all(&app);
    } else {
        alarm::show(&app);
    }
    crate::show_main_window(&app);
    let _ = app.emit_to("main", alarm::EVENT_ACT, &p);
    Ok(())
}

#[tauri::command]
pub fn alarm_take(st: State<'_, MonitorState>) -> Option<Pending> {
    st.alarm.lock().unwrap().pending.take()
}

/// Test the alarm: the card, marked DRILL, and a notification.
#[tauri::command]
pub fn alarm_test(app: AppHandle, st: State<'_, MonitorState>) {
    st.alarm.lock().unwrap().push(DRILL);
    let c = cfg(&app, &st);
    alarm::notify("Topo", &c.labels.drill, false);
    alarm::show(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn figures_for_the_visit_comparison() {
        use crate::stats::{Sample, Stats};
        const H: i64 = 3_600_000;
        let st = Stats::memory().unwrap();
        let t0 = 1_700_000_000_000 / H * H;
        // A sample a minute for 4 hours.
        for i in 0..240 {
            let t = t0 + i * 60_000;
            st.add_sample("r1/c", &Sample { t, ok: true, rtt: Some(5.0), status: "echo".into(), state: "up".into(), upstream: false, iv: 60_000, via: "icmp".into() }).unwrap();
        }
        st.rollup(t0 + 5 * H).unwrap();
        let keys = vec!["r1/c".to_string(), "none/c".to_string()];
        // A visit that starts at 10:40 of the fourth hour: that hour is out.
        let visit = t0 + 3 * H + 40 * 60_000;
        let got = figures_in(&st, 360, keys.clone(), t0, visit);
        let hours: Vec<i64> = got.get("r1/c").unwrap().iter().map(|h| h.hour).collect();
        assert_eq!(hours, vec![t0, t0 + H, t0 + 2 * H], "only whole hours before the visit");
        assert!(!got.contains_key("none/c"), "a check with no figures is left out");
        // From a later start: only the hours inside the span.
        let got = figures_in(&st, 360, keys.clone(), t0 + H, visit);
        assert_eq!(got.get("r1/c").unwrap().len(), 2);
        // Statistics Off: nothing.
        assert!(figures_in(&st, 0, keys.clone(), t0, visit).is_empty());
        // A span inside one hour: nothing.
        assert!(figures_in(&st, 360, keys, t0 + 10 * 60_000, t0 + 50 * 60_000).is_empty());
    }

    #[test]
    fn sign_in_files() {
        let base = std::env::temp_dir().join(format!("topo-autostart-{}", std::process::id()));
        let exe = Path::new("/opt/Topo $x/topo \"bin\"");
        autostart_file(&base, true, exe, false).unwrap();
        let f = base.join("autostart").join("systems.carino.topo.desktop");
        let text = fs::read_to_string(&f).unwrap();
        assert!(text.contains("Exec=\"/opt/Topo \\$x/topo \\\"bin\\\"\" --background\n"), "{text}");
        assert!(text.starts_with("[Desktop Entry]\n"));
        autostart_file(&base, false, exe, false).unwrap();
        assert!(!f.exists());
        // Removing what is not there is fine.
        autostart_file(&base, false, exe, false).unwrap();
        autostart_file(&base, true, Path::new("/Applications/Topo.app/Contents/MacOS/topo"), true).unwrap();
        let p = fs::read_to_string(base.join("Library/LaunchAgents/systems.carino.topo.plist")).unwrap();
        assert!(p.contains("<string>/Applications/Topo.app/Contents/MacOS/topo</string><string>--background</string>"));
        assert!(p.contains("<key>RunAtLoad</key><true/>"));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn enrolls_only_for_the_network_watched() {
        assert!(enroll_network_ok("", "lib_a"));
        assert!(enroll_network_ok("lib_a", "lib_a"));
        assert!(!enroll_network_ok("lib_b", "lib_a"));
    }

    #[test]
    fn config_defaults() {
        let c: Config = serde_json::from_str("{}").unwrap();
        assert!(!c.on, "off as shipped (D131)");
        assert_eq!(c.retention_days, 360);
        assert!(!c.tray && !c.autostart);
        assert!(!c.alarms, "Show alarms on this PC is off as shipped (D131)");
        assert_eq!(c.labels.lang, "en");
        let c: Config = serde_json::from_str(r#"{"on":true,"retentionDays":0}"#).unwrap();
        assert!(c.on);
        assert_eq!(c.retention_days, 0);
    }

    #[cfg(unix)]
    #[test]
    fn one_monitor_per_pc() {
        let p = std::env::temp_dir().join(format!("topo-lock-{}", std::process::id())).join("monitor.lock");
        let a = try_lock(&p);
        assert!(a.is_some());
        assert!(try_lock(&p).is_none(), "a second Topo does not run it too");
        drop(a);
        assert!(try_lock(&p).is_some());
        let _ = fs::remove_dir_all(p.parent().unwrap());
    }

    fn issue(id: &str, behind: usize, flapping: bool, closed: bool, outages: Vec<(i64, Option<i64>)>) -> Issue {
        Issue {
            id: id.into(),
            name: "R1".into(),
            behind: (0..behind).map(|k| format!("n{k}")).collect(),
            flapping,
            closed: if closed { Some(5) } else { None },
            outages: outages.into_iter().map(|(from, to)| issues::Outage { from, to }).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn what_a_change_raises() {
        let l = Labels::default();
        let open = issue("in1", 0, false, false, vec![(0, None)]);
        let ch = vec![(Change::Opened, open.clone())];
        assert!(to_raise(&ch, false, &l).is_empty(), "Show alarms on this PC off: nothing");
        assert_eq!(to_raise(&ch, true, &l), vec![Raise::Card { id: "in1".into(), body: "R1 is not answering".into() }]);
        // One device behind it reads as one, more as a number.
        let r = to_raise(&[(Change::Opened, issue("in2", 1, false, false, vec![(0, None)]))], true, &l);
        assert_eq!(r, vec![Raise::Card { id: "in2".into(), body: "R1 and 1 device behind it are not answering".into() }]);
        let r = to_raise(&[(Change::Opened, issue("in3", 12, false, false, vec![(0, None)]))], true, &l);
        assert_eq!(r, vec![Raise::Card { id: "in3".into(), body: "R1 and 12 devices behind it are not answering".into() }]);
        // A repeat on an open issue raises again, unless it flaps (D244).
        assert_eq!(to_raise(&[(Change::Repeated, open.clone())], true, &l).len(), 1);
        assert!(to_raise(&[(Change::Repeated, issue("in4", 0, true, false, vec![(0, Some(1)), (2, None)]))], true, &l).is_empty());
        // A closed issue raises no card; an update raises nothing.
        assert!(to_raise(&[(Change::Opened, issue("in5", 0, false, true, vec![(0, None)]))], true, &l).is_empty());
        assert!(to_raise(&[(Change::Updated, open)], true, &l).is_empty());
        // Answering again: a small notification only (D250).
        let back = issue("in6", 0, false, false, vec![(0, Some(14 * 60_000))]);
        assert_eq!(to_raise(&[(Change::Recovered, back.clone())], true, &l), vec![Raise::Note { body: "R1 is answering again (down 14 min)".into() }]);
        assert!(to_raise(&[(Change::Recovered, back)], false, &l).is_empty());
    }

    #[test]
    fn expected_marks_every_outage_of_the_issue() {
        let i = issue("in1", 0, false, false, vec![(100, Some(200)), (300, Some(400)), (500, None)]);
        assert_eq!(maintenance_spans(&i, 900), vec![(100, 200), (300, 400), (500, 900)]);
        // An act stamped before the outage began (clocks) never makes a
        // backwards span.
        assert_eq!(maintenance_spans(&issue("in2", 0, false, false, vec![(500, None)]), 10), vec![(500, 500)]);
    }
}
