// The app's commands for "Monitor during this visit" (docs/SCOPE.md D148,
// D174, step 7i), over src/visitmon.rs. What js/visitmonitor.js calls:
//
//   visit_monitor_start    the provider's checks (a plan, from the page)
//                          and who it is for; ends any earlier session
//   visit_monitor_plan     a new list of checks while it runs
//   visit_monitor_info     running or stopped, the states, the outages
//   visit_monitor_figures  the figures for Record visit (None with
//                          statistics Off)
//   visit_monitor_stop     Stop: the checks end, the samples go, the
//                          figures stay until the end (D174)
//   visit_monitor_end      the end (Record visit saved, sign-out, leaving
//                          for good): everything goes
//
// Each change goes to the page as the event "topo-visit-monitor": the
// statuses that changed and, when they changed, the outages. Never an
// issue record, an alarm card or a notification: a visit's outages stay
// on the provider's screen (D148).
//
// The samples are kept in memory only. The figures Stop kept are also
// written to <app data>/monitor/visit.json (readable by this user only),
// so a Topo closed between Stop and Record visit still has them; that file
// goes at the end.

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::checks;
use crate::monitor::{self, Plan, Status};
use crate::visitmon::{Figures, Meta, Notify, Outage, Session};

pub const EVENT: &str = "topo-visit-monitor";

#[derive(Default)]
pub struct VisitState {
    s: Mutex<Option<Session>>,
    /// Stop's figures read back from the file after a restart.
    kept: Mutex<Option<Kept>>,
}

/// What the file holds after Stop.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Kept {
    pub meta: Meta,
    pub stopped: i64,
    pub figures: Option<Figures>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct VisitInfo {
    pub running: bool,
    /// None: no session (nothing running, nothing kept).
    pub meta: Option<Meta>,
    pub stopped: Option<i64>,
    pub count: usize,
    pub statuses: Vec<Status>,
    pub outages: Vec<Outage>,
    /// Stop kept figures (or they can be made now).
    pub has_figures: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Event {
    /// The session's start (0: the end): the page drops a late event of an
    /// earlier session.
    started: i64,
    statuses: Vec<Status>,
    #[serde(skip_serializing_if = "Option::is_none")]
    outages: Option<Vec<Outage>>,
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("monitor").join("visit.json"))
}

fn write_private(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new().create(true).truncate(true).write(true).mode(0o600).open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Writes what Stop kept, readable by this user only. With statistics Off
/// nothing is written (D288): there are no figures to keep.
fn save_kept_at(p: &PathBuf, k: &Kept) -> Result<bool, String> {
    if !k.meta.kept || k.figures.is_none() {
        let _ = fs::remove_file(p);
        return Ok(false);
    }
    let b = serde_json::to_vec(k).map_err(|e| e.to_string())?;
    write_private(p, &b)?;
    Ok(true)
}
fn load_kept_at(p: &PathBuf) -> Option<Kept> {
    fs::read(p).ok().and_then(|b| serde_json::from_slice::<Kept>(&b).ok())
}
fn drop_kept_at(p: &PathBuf) {
    let _ = fs::remove_file(p);
    let _ = fs::remove_file(p.with_extension("json.tmp"));
}

fn save_kept(app: &AppHandle, k: &Kept) {
    if let Some(p) = file(app) {
        if let Err(e) = save_kept_at(&p, k) {
            eprintln!("topo: the visit's figures could not be kept: {e}");
        }
    }
}
fn drop_kept(app: &AppHandle, st: &VisitState) {
    *st.kept.lock().unwrap() = None;
    if let Some(p) = file(app) {
        drop_kept_at(&p);
    }
}
fn load_kept(app: &AppHandle, st: &VisitState) -> Option<Kept> {
    let mut g = st.kept.lock().unwrap();
    if g.is_none() {
        *g = file(app).and_then(|p| load_kept_at(&p));
    }
    g.clone()
}

fn info_of(app: &AppHandle, st: &VisitState) -> VisitInfo {
    let g = st.s.lock().unwrap();
    if let Some(s) = g.as_ref() {
        return VisitInfo {
            running: s.running(),
            meta: Some(s.meta.clone()),
            stopped: s.stopped,
            count: s.items().len(),
            statuses: s.statuses(),
            outages: s.outages(),
            has_figures: s.meta.kept && (s.running() || s.figures.is_some()),
        };
    }
    drop(g);
    match load_kept(app, st) {
        Some(k) => VisitInfo {
            running: false,
            stopped: Some(k.stopped),
            outages: k.figures.as_ref().map(|f| f.outages.clone()).unwrap_or_default(),
            has_figures: k.figures.is_some(),
            count: k.figures.as_ref().map(|f| f.items.len()).unwrap_or(0),
            meta: Some(k.meta),
            statuses: Vec::new(),
        },
        None => VisitInfo::default(),
    }
}

#[tauri::command]
pub fn visit_monitor_start(app: AppHandle, st: State<'_, VisitState>, plan: Plan, meta: Meta) -> VisitInfo {
    // A new session drops the last one, its figures too (D174).
    *st.s.lock().unwrap() = None;
    drop_kept(&app, &st);
    let mut meta = meta;
    meta.started = monitor::now_ms();
    if meta.network_id.is_empty() {
        meta.network_id = plan.network_id.clone();
    }
    let emit_app = app.clone();
    let started = meta.started;
    let notify: Notify = Arc::new(move |statuses: Vec<Status>, outages: Option<Vec<Outage>>| {
        let _ = emit_app.emit(EVENT, Event { started, statuses, outages });
    });
    let s = Session::start(Arc::new(checks::run), plan.items, meta, notify);
    *st.s.lock().unwrap() = Some(s);
    info_of(&app, &st)
}

#[tauri::command]
pub fn visit_monitor_plan(app: AppHandle, st: State<'_, VisitState>, plan: Plan) -> VisitInfo {
    if let Some(s) = st.s.lock().unwrap().as_mut() {
        if s.running() && (plan.network_id.is_empty() || plan.network_id == s.meta.network_id) {
            s.set_items(plan.items);
        }
    }
    info_of(&app, &st)
}

#[tauri::command]
pub fn visit_monitor_info(app: AppHandle, st: State<'_, VisitState>) -> VisitInfo {
    info_of(&app, &st)
}

#[tauri::command]
pub fn visit_monitor_figures(app: AppHandle, st: State<'_, VisitState>) -> Option<Figures> {
    if let Some(s) = st.s.lock().unwrap().as_ref() {
        return s.figures(monitor::now_ms());
    }
    load_kept(&app, &st).and_then(|k| k.figures)
}

#[tauri::command]
pub fn visit_monitor_stop(app: AppHandle, st: State<'_, VisitState>) -> VisitInfo {
    let kept = {
        let mut g = st.s.lock().unwrap();
        match g.as_mut() {
            Some(s) if s.running() => {
                let now = monitor::now_ms();
                s.stop(now);
                Some(Kept { meta: s.meta.clone(), stopped: now, figures: s.figures.clone() })
            }
            _ => None,
        }
    };
    if let Some(k) = kept {
        save_kept(&app, &k);
        if k.meta.kept {
            *st.kept.lock().unwrap() = Some(k);
        }
    }
    info_of(&app, &st)
}

#[tauri::command]
pub fn visit_monitor_end(app: AppHandle, st: State<'_, VisitState>) -> VisitInfo {
    *st.s.lock().unwrap() = None;
    drop_kept(&app, &st);
    let _ = app.emit(EVENT, Event { started: 0, statuses: Vec::new(), outages: Some(Vec::new()) });
    VisitInfo::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::visitmon::ItemFigures;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("topo-visit-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }
    fn kept(on: bool) -> Kept {
        Kept {
            meta: Meta { network_id: "net".into(), provider_id: "p1".into(), who: "u1".into(), kept: on, started: 1000, ..Default::default() },
            stopped: 5000,
            figures: if on { Some(Figures { from: 1000, to: 5000, items: vec![ItemFigures { key: "r1/c".into(), node_id: "r1".into(), asked: 3, answered: 3, ..Default::default() }], outages: Vec::new() }) } else { None },
        }
    }

    #[test]
    fn stop_keeps_the_figures_private_and_the_end_removes_them() {
        let d = dir("kept");
        let p = d.join("monitor").join("visit.json");
        assert!(save_kept_at(&p, &kept(true)).unwrap());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600, "readable by this user only");
        }
        // A restart reads them back.
        let back = load_kept_at(&p).expect("read back");
        assert_eq!(back.meta.who, "u1");
        assert_eq!(back.figures.unwrap().items[0].answered, 3);
        // The end (Record visit, Discard, sign-out, a new start) removes it.
        drop_kept_at(&p);
        assert!(!p.exists());
        assert!(load_kept_at(&p).is_none());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn statistics_off_writes_nothing_at_stop() {
        let d = dir("off");
        let p = d.join("monitor").join("visit.json");
        assert!(!save_kept_at(&p, &kept(false)).unwrap());
        assert!(!p.exists(), "no file with statistics Off");
        // And an earlier file is not left behind.
        save_kept_at(&p, &kept(true)).unwrap();
        save_kept_at(&p, &kept(false)).unwrap();
        assert!(!p.exists());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn a_damaged_file_is_nothing() {
        let d = dir("bad");
        let p = d.join("visit.json");
        fs::create_dir_all(&d).unwrap();
        fs::write(&p, b"{not json").unwrap();
        assert!(load_kept_at(&p).is_none());
        let _ = fs::remove_dir_all(d);
    }
}
