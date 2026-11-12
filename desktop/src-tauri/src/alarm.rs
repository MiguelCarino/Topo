// The alarm card and the system notifications (docs/SCOPE.md D130, D160,
// D172, step 7g).
//
// When an issue opens (or an open one goes down again), and "Show alarms on
// this PC" is on, a card window (alarm.html, staged beside intro.html by
// desktop/stage.sh --desktop) opens on every monitor: full screen, always
// on top, focused, in Atrium's card() layout (emergency-alerts.py), amber.
// One card at a time; the next waits in the queue. The card asks for what
// it shows (alarm_current) and answers with:
//
//   later   it closes; the issue stays open (Escape does the same);
//   ack     Acknowledge, with an optional note, written on the record;
//   hand    Acknowledge or Report a problem while the window is locked, or
//           Report a problem at any time: the main window is shown and
//           told (the event "topo-alarm-act"), and asks to unlock first.
//
// A short chime plays in the first card window only (the page's Web Audio;
// the system volume is never touched, nothing is spoken). "Always on top"
// is not guaranteed on Wayland, so a system notification goes out too; a
// device answering again is a small notification only, never a card.
// Notifications are sent by the desktop's own tools (no crate): gdbus to
// org.freedesktop.Notifications on Linux, osascript on macOS, a PowerShell
// balloon on Windows. Each is fire and forget: if it fails, the card is
// still there.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::issues::Issue;

pub const DRILL: &str = "drill";
pub const EVENT_CARD: &str = "topo-alarm";
pub const EVENT_ACT: &str = "topo-alarm-act";
pub const WINDOW_PREFIX: &str = "alarm-";

/// What waits for the main window: an act asked for on the card.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub id: String,
    /// ack or report.
    pub act: String,
    /// Asked while the window was locked.
    pub locked: bool,
}

#[derive(Default)]
pub struct Queue {
    /// Issue ids (or DRILL), the one shown first.
    pub cards: Vec<String>,
    /// Ids whose chime has played.
    pub chimed: HashSet<String>,
    pub pending: Option<Pending>,
}

impl Queue {
    /// Adds a card; false when it is there already.
    pub fn push(&mut self, id: &str) -> bool {
        if self.cards.iter().any(|c| c == id) {
            return false;
        }
        if id == DRILL {
            self.chimed.remove(DRILL);
        }
        self.cards.push(id.to_string());
        true
    }
    /// Takes a card away; true when no card is left.
    pub fn remove(&mut self, id: &str) -> bool {
        self.cards.retain(|c| c != id);
        self.cards.is_empty()
    }
    /// Whether the chime plays for this card (once per card).
    pub fn chime(&mut self, id: &str) -> bool {
        self.chimed.insert(id.to_string())
    }
}

/// What the card shows.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
    pub drill: bool,
    pub name: String,
    /// When the outage began (unix ms); the card counts from it.
    pub since: i64,
    pub now: i64,
    /// How many devices are down behind it, and the first names.
    pub behind: usize,
    pub behind_names: Vec<String>,
    pub monitor: String,
    pub recovered: Option<i64>,
    pub flapping: bool,
    /// Cards waiting after this one.
    pub more: usize,
    pub lang: String,
    pub chime: bool,
}

/// The card's view of an issue (or the drill's), pure for the tests.
pub fn view(issue: Option<&Issue>, id: &str, names: &dyn Fn(&str) -> Option<String>, monitor: &str, now: i64, more: usize, lang: &str, chime: bool) -> Option<View> {
    if id == DRILL {
        return Some(View { id: DRILL.into(), drill: true, name: String::new(), since: now - 3 * 60_000, now, monitor: monitor.into(), more, lang: lang.into(), chime, ..Default::default() });
    }
    let i = issue?;
    let name = names(&i.node_id).filter(|n| !n.is_empty()).unwrap_or_else(|| if i.name.is_empty() { i.node_id.clone() } else { i.name.clone() });
    Some(View {
        id: i.id.clone(),
        drill: false,
        name,
        since: i.since(),
        now,
        behind: i.behind.len(),
        behind_names: i.behind.iter().take(3).map(|b| names(b).unwrap_or_else(|| b.clone())).collect(),
        monitor: i.monitor.clone(),
        recovered: i.recovered(),
        flapping: i.flapping,
        more,
        lang: lang.into(),
        chime,
    })
}

/// The card windows open now.
pub fn windows(app: &AppHandle) -> Vec<tauri::WebviewWindow> {
    app.webview_windows().into_iter().filter(|(l, _)| l.starts_with(WINDOW_PREFIX)).map(|(_, w)| w).collect()
}

/// Opens the card on every monitor, or tells the open ones to show the
/// first card again. Off the caller's thread: making a window waits for
/// the main thread.
pub fn show(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let open = windows(&app);
        if !open.is_empty() {
            for w in &open {
                let _ = w.emit(EVENT_CARD, ());
            }
            if let Some(w) = open.iter().find(|w| w.label() == "alarm-0").or(open.first()) {
                let _ = w.set_focus();
            }
            return;
        }
        let monitors = app.primary_monitor().ok().flatten().into_iter().chain(app.available_monitors().unwrap_or_default()).collect::<Vec<_>>();
        // The primary first, then the others, each once.
        let mut seen = HashSet::new();
        let monitors: Vec<_> = monitors.into_iter().filter(|m| seen.insert((m.position().x, m.position().y, m.size().width, m.size().height))).collect();
        let count = monitors.len().max(1);
        for i in 0..count {
            let mut b = WebviewWindowBuilder::new(&app, format!("{WINDOW_PREFIX}{i}"), WebviewUrl::App("alarm.html".into()))
                .title("Topo")
                .decorations(false)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .skip_taskbar(true)
                .resizable(false)
                .focused(i == 0)
                .background_color(tauri::window::Color(180, 83, 9, 255));
            if let Some(m) = monitors.get(i) {
                let scale = m.scale_factor().max(0.1);
                let p = m.position();
                let s = m.size();
                b = b.position(p.x as f64 / scale, p.y as f64 / scale).inner_size(s.width as f64 / scale, s.height as f64 / scale);
            } else {
                b = b.inner_size(960.0, 640.0).center();
            }
            match b.build() {
                Ok(w) => {
                    let _ = w.set_fullscreen(true);
                    if i == 0 {
                        let _ = w.set_focus();
                    }
                }
                Err(e) => eprintln!("topo: the alarm card could not open: {e}"),
            }
        }
    });
}

/// Closes every card window.
pub fn close_all(app: &AppHandle) {
    for w in windows(app) {
        let _ = w.destroy();
    }
}

// ---- System notifications ----

/// A GVariant string literal for gdbus: single quotes, \ and ' escaped,
/// control characters dropped.
pub fn gvariant_str(s: &str) -> String {
    let mut out = String::from("'");
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            c if c.is_control() => out.push(' '),
            c => out.push(c),
        }
    }
    out.push('\'');
    out
}

/// An AppleScript string literal.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // macOS (and the tests)
pub fn applescript_str(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c if c.is_control() => out.push(' '),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A notification: `urgent` for an outage (critical on Linux, so it stays
/// until seen), not for a device answering again. Fire and forget.
pub fn notify(title: &str, body: &str, urgent: bool) {
    let title: String = title.chars().take(120).collect();
    let body: String = body.chars().take(400).collect();
    std::thread::spawn(move || {
        if let Err(e) = send(&title, &body, urgent) {
            eprintln!("topo: no system notification: {e}");
        }
    });
}

#[cfg(target_os = "linux")]
fn send(title: &str, body: &str, urgent: bool) -> Result<(), String> {
    let hints = format!("{{'urgency': <byte {}>}}", if urgent { 2 } else { 1 });
    let out = std::process::Command::new("gdbus")
        .args([
            "call", "--session", "--dest=org.freedesktop.Notifications", "--object-path=/org/freedesktop/Notifications",
            "--method=org.freedesktop.Notifications.Notify", "'Topo'", "0", "'network-error'",
        ])
        .arg(gvariant_str(title))
        .arg(gvariant_str(body))
        .arg("[]")
        .arg(hints)
        .arg(if urgent { "0" } else { "8000" })
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

#[cfg(target_os = "macos")]
fn send(title: &str, body: &str, _urgent: bool) -> Result<(), String> {
    let script = format!("display notification {} with title {}", applescript_str(body), applescript_str(title));
    let out = std::process::Command::new("osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

#[cfg(windows)]
fn send(title: &str, body: &str, urgent: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // The words go in the environment, never in the script's text.
    let script = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; \
        $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Warning; $n.Visible = $true; \
        $n.ShowBalloonTip(8000, $env:TOPO_N_TITLE, $env:TOPO_N_BODY, $env:TOPO_N_KIND); Start-Sleep -Seconds 9; $n.Dispose()";
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script])
        .env("TOPO_N_TITLE", title)
        .env("TOPO_N_BODY", body)
        .env("TOPO_N_KIND", if urgent { "Warning" } else { "Info" })
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::issues::Outage;

    #[test]
    fn the_queue() {
        let mut q = Queue::default();
        assert!(q.push("in1") && !q.push("in1"), "one card per issue");
        assert!(q.push(DRILL));
        assert!(q.chime("in1") && !q.chime("in1"), "the chime plays once a card");
        assert!(!q.remove("in1"));
        assert!(q.remove(DRILL), "none left");
        q.chime(DRILL);
        q.push(DRILL);
        assert!(q.chime(DRILL), "a new drill chimes again");
    }

    #[test]
    fn the_cards_view() {
        let i = Issue {
            id: "inabc".into(),
            node_id: "r1".into(),
            name: "R1 then".into(),
            behind: vec!["sw".into(), "p1".into(), "p2".into(), "p3".into()],
            outages: vec![Outage { from: 100, to: None }],
            monitor: "Front desk PC".into(),
            ..Default::default()
        };
        let names = |id: &str| match id { "r1" => Some("Router R1".to_string()), "sw" => Some("Switch".to_string()), _ => None };
        let v = view(Some(&i), "inabc", &names, "here", 500, 2, "es", true).unwrap();
        assert_eq!(v.name, "Router R1", "the name now, from the plan");
        assert_eq!((v.since, v.now, v.behind, v.more), (100, 500, 4, 2));
        assert_eq!(v.behind_names, vec!["Switch".to_string(), "p1".to_string(), "p2".to_string()]);
        assert_eq!(v.monitor, "Front desk PC");
        assert_eq!((v.lang.as_str(), v.chime, v.drill), ("es", true, false));
        let none = |_: &str| None;
        assert_eq!(view(Some(&i), "inabc", &none, "here", 500, 0, "en", false).unwrap().name, "R1 then");
        assert!(view(None, "gone", &none, "here", 1, 0, "en", false).is_none());
        let d = view(None, DRILL, &none, "Desk", 1_000_000, 0, "ja", true).unwrap();
        assert!(d.drill && d.monitor == "Desk" && d.since < d.now);
    }

    #[test]
    fn notification_words_are_quoted() {
        assert_eq!(gvariant_str("R1's \\ <b>"), "'R1\\'s \\\\ <b>'");
        assert_eq!(gvariant_str("a\nb"), "'a b'");
        assert_eq!(applescript_str("say \"hi\" \\"), "\"say \\\"hi\\\" \\\\\"");
    }
}
