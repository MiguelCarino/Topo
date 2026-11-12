// Watch this PC's connection (docs/SCOPE.md step 8f, D376-D378).
//
// Off as shipped. Turned on (Settings, Topo server), this PC's app sends the
// server a heartbeat every 60 s from here, with the window closed too (the
// tray keeps the app running, as monitoring does). The server sees each
// beat without reading anything; three missed and the people who share a
// site with this PC are told it lost its connection (the server's side,
// server/internal/api/connections.go).
//
// The other side (D378): a beat that cannot reach the server for 3 minutes
// makes this PC say "The Topo server is not answering" (the event
// "topo-server-silent" to the page, and with Show alarms on a notification);
// when it answers again, "topo-server-back", and the gap goes to the server
// with the next beat, so a server that was down is recorded by the PCs that
// saw it. Quitting, signing out and forgetting the server say "going away"
// first, so the silence that follows is not a lost connection.
//
// A beat refused because nobody is signed in (401, 403) is no failure of
// the server: nothing is said, nothing is counted.

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

pub const BEAT_MS: i64 = 60_000;
/// Not answering this long: said (D378).
pub const SILENT_AFTER_MS: i64 = 180_000;
/// Gaps kept to tell the server, at most.
pub const PENDING_MAX: usize = 20;

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// What is kept: on or off, the PC's name as the others see it, and the
/// page's words for the notifications ({min}: minutes).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub on: bool,
    pub name: String,
    pub silent: String,
    pub back: String,
}

/// The pure part: what each beat's outcome changes.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Beat {
    /// The first failure of the run of failures going on.
    pub fail_since: Option<i64>,
    /// "Not answering" was said for this run.
    pub silent: bool,
    /// Gaps this PC saw, to tell the server with the next beat that reaches it.
    pub pending: Vec<(i64, i64)>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    /// The server has not answered since then.
    Silent(i64),
    /// It answers again: not answering from, to.
    Back(i64, i64),
}

impl Beat {
    /// A beat reached the server (ok) or did not. -> what to say.
    pub fn result(&mut self, ok: bool, now: i64) -> Option<Change> {
        if ok {
            let from = self.fail_since.take()?;
            let was = std::mem::replace(&mut self.silent, false);
            // Only a gap long enough to have been said is a gap: a beat
            // that failed once is a hiccup, not an outage.
            if now - from >= SILENT_AFTER_MS {
                self.pending.push((from, now));
                if self.pending.len() > PENDING_MAX {
                    let cut = self.pending.len() - PENDING_MAX;
                    self.pending.drain(0..cut);
                }
            }
            return if was { Some(Change::Back(from, now)) } else { None };
        }
        let from = *self.fail_since.get_or_insert(now);
        if !self.silent && now - from >= SILENT_AFTER_MS {
            self.silent = true;
            return Some(Change::Silent(from));
        }
        None
    }
}

/// The words with the minutes put in.
pub fn words(template: &str, from: i64, to: i64) -> String {
    let min = ((to - from) as f64 / 60_000.0).round().max(1.0) as i64;
    template.replace("{min}", &min.to_string())
}

#[derive(Default)]
pub struct ConnState {
    cfg: Mutex<Option<Config>>,
    beat: Arc<Mutex<Beat>>,
    started: Mutex<bool>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub on: bool,
    pub name: String,
    /// Since when the server has not answered this PC (0: it answers).
    pub silent_since: i64,
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("connection.json"))
}
fn cfg(app: &AppHandle, st: &ConnState) -> Config {
    let mut g = st.cfg.lock().unwrap();
    if g.is_none() {
        *g = Some(path(app).and_then(|p| fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default());
    }
    g.clone().unwrap_or_default()
}
fn info(app: &AppHandle, st: &ConnState) -> Info {
    let c = cfg(app, st);
    let b = st.beat.lock().unwrap();
    Info { on: c.on, name: c.name, silent_since: if b.silent { b.fail_since.unwrap_or(0) } else { 0 } }
}

/// One beat now. -> Some(true) reached, Some(false) the server did not
/// answer, None nobody signed in (or no server).
fn beat_once(app: &AppHandle, c: &Config, pending: &[(i64, i64)]) -> Option<bool> {
    let client = crate::clientcmd::current_client(app)?;
    let gaps: Vec<_> = pending.iter().map(|(f, t)| json!({ "from": f, "to": t })).collect();
    let body = json!({ "name": c.name, "intervalMs": BEAT_MS, "gaps": gaps }).to_string();
    match client.request("POST", "/api/connection/beat", Some(&body)) {
        Ok(r) if r.status == 200 => Some(true),
        Ok(r) if r.status == 401 || r.status == 403 => None,
        Ok(r) if r.status < 500 => Some(true),
        _ => Some(false),
    }
}

fn say(app: &AppHandle, c: &Config, ch: &Change) {
    let (event, text, payload) = match ch {
        Change::Silent(from) => ("topo-server-silent", words(&c.silent, *from, now_ms()), json!({ "since": from })),
        Change::Back(from, to) => ("topo-server-back", words(&c.back, *from, *to), json!({ "from": from, "to": to })),
    };
    let _ = app.emit(event, payload);
    if !text.is_empty() && crate::monitorcmd::alarms_on(app) {
        crate::alarm::notify("Topo", &text, matches!(ch, Change::Silent(_)));
    }
}

/// The heartbeat, for the app's life (started once at setup).
pub fn start(app: AppHandle) {
    let st = app.state::<ConnState>();
    {
        let mut s = st.started.lock().unwrap();
        if *s {
            return;
        }
        *s = true;
    }
    std::thread::spawn(move || {
        // A first beat soon after start, then every BEAT_MS.
        std::thread::sleep(Duration::from_secs(5));
        loop {
            let st = app.state::<ConnState>();
            let c = cfg(&app, &st);
            if c.on && !c.name.is_empty() {
                let pending = st.beat.lock().unwrap().pending.clone();
                if let Some(ok) = beat_once(&app, &c, &pending) {
                    if ok && !pending.is_empty() {
                        let mut b = st.beat.lock().unwrap();
                        b.pending.retain(|g| !pending.contains(g));
                    }
                    let ch = st.beat.lock().unwrap().result(ok, now_ms());
                    if let Some(ch) = ch {
                        say(&app, &c, &ch);
                        // The gap goes now, not in a minute.
                        if let Change::Back(..) = ch {
                            let pend = st.beat.lock().unwrap().pending.clone();
                            if beat_once(&app, &c, &pend) == Some(true) {
                                st.beat.lock().unwrap().pending.retain(|g| !pend.contains(g));
                            }
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(BEAT_MS as u64));
        }
    });
}

/// Going away (quit, forgetting the server): said to the server, briefly,
/// when this PC is watched.
pub fn away(app: &AppHandle) {
    let st = app.state::<ConnState>();
    if !cfg(app, &st).on {
        return;
    }
    if let Some(client) = crate::clientcmd::current_client(app) {
        let _ = client.request("POST", "/api/connection/away", Some("{}"));
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SetArgs {
    pub on: bool,
    pub name: String,
    pub silent: String,
    pub back: String,
}

#[tauri::command]
pub fn connection_watch_info(app: AppHandle, st: State<'_, ConnState>) -> Info {
    info(&app, &st)
}

/// Turned on or off (or the words changed). Off tells the server to stop
/// watching this PC.
#[tauri::command]
pub fn connection_watch_set(app: AppHandle, st: State<'_, ConnState>, args: SetArgs) -> Result<Info, String> {
    let was = cfg(&app, &st);
    let name: String = args.name.trim().chars().take(120).collect();
    if args.on && name.is_empty() {
        return Err("name".into());
    }
    let next = Config { on: args.on, name: if name.is_empty() { was.name.clone() } else { name }, silent: args.silent, back: args.back };
    let p = path(&app).ok_or("config")?;
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    fs::write(&p, serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    *st.cfg.lock().unwrap() = Some(next.clone());
    if was.on && !next.on {
        *st.beat.lock().unwrap() = Beat::default();
        let a = app.clone();
        std::thread::spawn(move || {
            if let Some(client) = crate::clientcmd::current_client(&a) {
                let _ = client.request("DELETE", "/api/connection", None);
            }
        });
    } else if next.on && !was.on {
        let a = app.clone();
        let c = next.clone();
        std::thread::spawn(move || {
            beat_once(&a, &c, &[]);
        });
    }
    Ok(info(&app, &st))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silent_after_three_minutes_then_back_with_its_gap() {
        let mut b = Beat::default();
        assert_eq!(b.result(true, 0), None, "answering: nothing to say");
        assert_eq!(b.result(false, 60_000), None);
        assert_eq!(b.result(false, 120_000), None);
        assert_eq!(b.result(false, 180_000), None, "2 minutes: not yet");
        assert_eq!(b.result(false, 240_000), Some(Change::Silent(60_000)), "3 minutes: said, from the first failure");
        assert_eq!(b.result(false, 300_000), None, "said once");
        assert_eq!(b.result(true, 420_000), Some(Change::Back(60_000, 420_000)));
        assert_eq!(b.pending, vec![(60_000, 420_000)], "the gap goes to the server");
        assert!(!b.silent && b.fail_since.is_none());
    }

    #[test]
    fn a_hiccup_is_no_gap() {
        let mut b = Beat::default();
        assert_eq!(b.result(false, 0), None);
        assert_eq!(b.result(true, 60_000), None);
        assert!(b.pending.is_empty(), "one failed beat is not an outage");
    }

    #[test]
    fn pending_gaps_are_bounded_and_worded() {
        let mut b = Beat::default();
        for i in 0..30 {
            let t = i * 1_000_000;
            b.result(false, t);
            b.result(false, t + SILENT_AFTER_MS);
            b.result(true, t + SILENT_AFTER_MS + 1);
        }
        assert_eq!(b.pending.len(), PENDING_MAX);
        assert_eq!(words("not answering for {min} min", 0, 23 * 60_000), "not answering for 23 min");
        assert_eq!(words("{min}", 0, 1), "1", "never 0 min");
    }
}
