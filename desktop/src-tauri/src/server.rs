// "This PC as the server" (docs/SCOPE.md D113, D125): the desktop app
// bundles topo-server (desktop/sidecar.sh, tauri.conf.json externalBin, as
// topo-desktop-server), so a PC on site can be the Topo server for the
// others. Two ways to run it:
//
// - As a service (the default once chosen, D125): the Windows installer's
//   tick box, or the app's first-run question, installs it to start with
//   the computer, whether or not Topo is open or anyone is signed in. The
//   app then only talks to it through the bundled binary's `service`
//   commands: status, the address to share and the certificate's
//   fingerprint without an administrator; install, settings, start and stop
//   through the OS's administrator prompt (UAC, pkexec, an osascript
//   prompt). Its data is the service's own (%ProgramData%\Topo,
//   /var/lib/topo, /Library/Application Support/Topo/data).
// - Only while the app is open (D113): the app starts the binary as its
//   own child process with its data in <app data>/server, and stops it when
//   it closes.
//
// Who can open it, either way:
// - "This PC only": http://127.0.0.1:<port>, which D52 allows (a loopback
//   address is a secure context).
// - "Other PCs on this network": https on every address with a certificate
//   the server signs itself (TOPO_TLS_SELF), covering every LAN address of
//   the PC; the address and the certificate's fingerprint are shown so the
//   other PCs can compare before they accept it. Sign-in then needs email,
//   so "No email" is refused here.
//
// Only the standard library and what the app already depends on (no new
// crate). The app's own window reaches it like any other server, through
// src/client.rs at 127.0.0.1 (D144, step 7c): its CSP stays connect-src
// 'self'.
//
// Settings live in <app config>/server.json; the SMTP password in
// <app data>/server/smtp.pass (0600, the child's) or handed to the service
// once through a temporary file (the service keeps its own copy), never in
// the JSON and never sent back to the page.

use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

const LOG_LINES: usize = 300;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Only while the app is open: start the server when the app starts.
    pub enabled: bool,
    pub port: u16,
    /// Other PCs on this network (https, self-signed) instead of this PC only.
    pub lan: bool,
    /// The LAN address to give people (the public URL in sign-in links);
    /// "" picks the first the server lists (real network cards before
    /// virtual ones: WSL, Hyper-V, Docker, VPNs).
    pub share_address: String,
    pub owner_email: String,
    /// "smtp", or "none" (codes in the log below; this PC only).
    pub mail: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: String,
    pub smtp_user: String,
    pub smtp_from: String,
    /// The service holds an SMTP password the app gave it (kept by the app,
    /// never set by the page).
    pub service_smtp_pass: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            enabled: false,
            port: 7380,
            lan: false,
            share_address: String::new(),
            owner_email: String::new(),
            mail: "none".into(),
            smtp_host: String::new(),
            smtp_port: 587,
            smtp_security: "starttls".into(),
            smtp_user: String::new(),
            smtp_from: String::new(),
            service_smtp_pass: false,
        }
    }
}

/// What `topo-desktop-server service status --port N` answers.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct ServiceInfo {
    /// This copy of the app can set up the service (see service_here).
    pub supported: bool,
    /// Set up to start with the computer.
    pub installed: bool,
    pub running: bool,
    pub answering: bool,
    pub tls: bool,
    pub fingerprint: String,
    /// Where its settings and its log are (to say so).
    pub config: String,
    pub log: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The bundled binary was found.
    pub available: bool,
    /// "service" when the service is set up (the app talks to it), else
    /// "app" (a child of the app, only while it is open).
    pub mode: String,
    pub service: ServiceInfo,
    pub running: bool,
    pub pid: u32,
    /// Addresses to share: the first is the one to give people.
    pub urls: Vec<String>,
    /// SHA-256 of the self-signed certificate (LAN mode).
    pub fingerprint: String,
    /// An error code from the last start or exit ("" when none).
    pub error: String,
    pub log: Vec<String>,
    pub lan_addresses: Vec<String>,
    pub has_smtp_pass: bool,
    pub settings: Settings,
}

struct Running {
    child: Child,
    urls: Vec<String>,
}

#[derive(Default)]
pub struct ServerState {
    running: Mutex<Option<Running>>,
    log: Arc<Mutex<VecDeque<String>>>,
    error: Mutex<String>,
    /// One administrator prompt at a time.
    elevating: Mutex<()>,
}

fn binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // Not "topo-server": the topo-server rpm/deb owns /usr/bin/topo-server,
    // where Tauri's Linux bundle puts its sidecars too.
    let name = if cfg!(windows) { "topo-desktop-server.exe" } else { "topo-desktop-server" };
    let p = exe.parent()?.join(name);
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("server"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("server.json"))
}

fn question_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("server-question.json"))
}

fn pass_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("smtp.pass"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(p) = path.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window flashes up.
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// The chosen address first (when the PC still has it), the rest in the
/// server's order.
fn share_first(mut addrs: Vec<String>, want: &str) -> Vec<String> {
    if let Some(i) = addrs.iter().position(|a| a == want) {
        let a = addrs.remove(i);
        addrs.insert(0, a);
    }
    addrs
}

/// The PC's LAN IPv4 addresses, as the server sees them (the same list its
/// certificate covers).
fn lan_addresses(bin: &Path) -> Vec<String> {
    let out = hidden(Command::new(bin).arg("lan-addresses")).stdin(Stdio::null()).output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// Whether pid is a live topo-server (the bundled one), so a stale
/// server.pid after a crash is told apart from a server still running.
fn alive_as(pid: u32, bin: &Path) -> bool {
    #[cfg(target_os = "linux")]
    {
        let want = fs::canonicalize(bin).unwrap_or_else(|_| bin.to_path_buf());
        match fs::read_link(format!("/proc/{pid}/exe")) {
            Ok(p) => p == want,
            Err(_) => false,
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = bin;
        Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "comm="])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("topo-"))
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        let _ = bin;
        hidden(Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"]))
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_ascii_lowercase().contains("topo-desktop-server"))
            .unwrap_or(false)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = (pid, bin);
        false
    }
}

fn read_pid(dir: &Path) -> Option<u32> {
    fs::read_to_string(dir.join("server.pid")).ok()?.trim().parse().ok()
}

/// Asks a server to stop: SIGTERM where there is one (a graceful stop that
/// closes the database), else terminate.
fn terminate(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
    #[cfg(windows)]
    {
        let _ = hidden(Command::new("taskkill").args(["/PID", &pid.to_string(), "/F"])).status();
    }
}

fn valid_email(s: &str) -> bool {
    let s = s.trim();
    match s.split_once('@') {
        Some((a, b)) => !a.is_empty() && b.contains('.') && !s.contains(char::is_whitespace) && !s.contains(['<', '>', ',']),
        None => false,
    }
}

/// Checks settings before they are saved or used. The codes are translated
/// by the page (js/desktopserver.js).
fn validate(s: &Settings) -> Result<(), String> {
    if s.port < 1024 {
        return Err("port".into());
    }
    if !valid_email(&s.owner_email) {
        return Err("owner-email".into());
    }
    match s.mail.as_str() {
        "none" => {
            if s.lan {
                return Err("lan-needs-email".into());
            }
        }
        "smtp" => {
            if s.smtp_host.trim().is_empty() || s.smtp_from.trim().is_empty() || s.smtp_port == 0 {
                return Err("smtp".into());
            }
            if !matches!(s.smtp_security.as_str(), "starttls" | "tls" | "none") {
                return Err("smtp".into());
            }
            let ctl = |v: &str| v.chars().any(char::is_control);
            if ctl(&s.smtp_from) || ctl(&s.smtp_host) || ctl(&s.smtp_user) {
                return Err("smtp".into());
            }
        }
        _ => return Err("mail".into()),
    }
    if s.share_address.chars().any(|c| !(c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-'))) {
        return Err("share".into());
    }
    Ok(())
}

/// Where the server listens and the addresses it answers on, from the
/// settings and the PC's LAN addresses.
struct Plan {
    listen: String,
    public: String,
    urls: Vec<String>,
    allowed: String,
}

fn plan(s: &Settings, lan: Vec<String>) -> Result<Plan, String> {
    let port = s.port;
    if s.lan {
        if lan.is_empty() {
            return Err("no-lan".into());
        }
        let addrs = share_first(lan, s.share_address.trim());
        let urls: Vec<String> = addrs.iter().map(|a| format!("https://{a}:{port}")).collect();
        Ok(Plan { listen: format!("0.0.0.0:{port}"), public: urls[0].clone(), allowed: addrs[1..].join(","), urls })
    } else {
        let u = format!("http://127.0.0.1:{port}");
        Ok(Plan { listen: format!("127.0.0.1:{port}"), public: u.clone(), urls: vec![u], allowed: String::new() })
    }
}

/// The server's settings (TOPO_*), the same for the child's environment
/// and the service's settings file. The data folder and the password file
/// are added by whoever runs it.
fn server_vars(s: &Settings, p: &Plan) -> Vec<(&'static str, String)> {
    let mut v = vec![
        ("TOPO_LISTEN", p.listen.clone()),
        ("TOPO_PUBLIC_URL", p.public.clone()),
        ("TOPO_OWNER_EMAIL", s.owner_email.trim().to_string()),
    ];
    if !p.allowed.is_empty() {
        v.push(("TOPO_ALLOWED_HOSTS", p.allowed.clone()));
    }
    if s.lan {
        v.push(("TOPO_TLS_SELF", "1".into()));
    }
    if s.mail == "smtp" {
        v.push(("TOPO_MAIL", "smtp".into()));
        v.push(("TOPO_SMTP_HOST", s.smtp_host.trim().to_string()));
        v.push(("TOPO_SMTP_PORT", s.smtp_port.to_string()));
        v.push(("TOPO_SMTP_SECURITY", s.smtp_security.clone()));
        v.push(("TOPO_SMTP_FROM", s.smtp_from.trim().to_string()));
        if !s.smtp_user.trim().is_empty() {
            v.push(("TOPO_SMTP_USER", s.smtp_user.trim().to_string()));
        }
    } else {
        v.push(("TOPO_MAIL", "log".into()));
    }
    v
}

/// The settings file `service configure` reads (KEY=VALUE lines).
fn conf_text(vars: &[(&'static str, String)]) -> String {
    let mut out = String::from("# Written by the Topo app for `topo-desktop-server service configure`.\n");
    for (k, v) in vars {
        out.push_str(k);
        out.push('=');
        out.push_str(v);
        out.push('\n');
    }
    out
}

fn push_log(log: &Arc<Mutex<VecDeque<String>>>, line: String) {
    if let Ok(mut l) = log.lock() {
        l.push_back(line);
        while l.len() > LOG_LINES {
            l.pop_front();
        }
    }
}

fn pipe_lines<R: Read + Send + 'static>(r: R, log: Arc<Mutex<VecDeque<String>>>) {
    thread::spawn(move || {
        for line in BufReader::new(r).lines() {
            match line {
                Ok(l) => push_log(&log, l),
                Err(_) => break,
            }
        }
    });
}

// ---- The service (D125) ----

/// Whether this copy of the app may set up the service: the binary must
/// stay where the service manager will look for it.
/// - Linux: the rpm/deb layout (/usr/bin, with pkexec), not an AppImage
///   (whose files vanish when it closes).
/// - macOS: inside /Applications (not a disk image or a translocated copy).
/// - Windows: always (the installer is per-machine, in Program Files).
fn service_here(bin: &Path) -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_none()
            && bin == Path::new("/usr/bin/topo-desktop-server")
            && Path::new("/usr/bin/pkexec").exists()
    }
    #[cfg(target_os = "macos")]
    {
        bin.starts_with("/Applications/")
    }
    #[cfg(windows)]
    {
        let _ = bin;
        true
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = bin;
        false
    }
}

fn service_info(bin: &Path, port: u16) -> ServiceInfo {
    let out = hidden(Command::new(bin).args(["service", "status", "--port", &port.to_string()]))
        .stdin(Stdio::null())
        .output();
    let mut info: ServiceInfo = match out {
        Ok(o) => serde_json::from_slice(&o.stdout).unwrap_or_default(),
        Err(_) => ServiceInfo::default(),
    };
    info.supported = info.supported && service_here(bin);
    info
}

fn service_log(bin: &Path) -> Vec<String> {
    hidden(Command::new(bin).args(["service", "log", "--lines", "150"]))
        .stdin(Stdio::null())
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(str::to_string).collect())
        .unwrap_or_default()
}

/// A word for the shell (POSIX single quotes).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// A string literal for AppleScript.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', r"\\").replace('"', "\\\""))
}

/// An argument for a Windows command line (CommandLineToArgvW rules).
#[cfg_attr(not(windows), allow(dead_code))]
fn win_arg(s: &str) -> String {
    if !s.is_empty() && !s.contains([' ', '\t', '"']) {
        return s.to_string();
    }
    let mut out = String::from("\"");
    let mut slashes = 0;
    for c in s.chars() {
        match c {
            '\\' => slashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(slashes));
                out.push(c);
                slashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(slashes * 2));
    out.push('"');
    out
}

/// Runs `bin service <args>` as an administrator: the OS asks the person
/// (UAC, the polkit prompt, the macOS password prompt). Errors: "cancelled"
/// (the person said no), "not-authorized", or "service:<what it said>".
fn elevated(bin: &Path, args: &[String], tmp: &Path) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let _ = tmp;
        let o = Command::new("pkexec").arg(bin).arg("service").args(args).stdin(Stdio::null()).output().map_err(|e| format!("service:{e}"))?;
        let text = String::from_utf8_lossy(&o.stdout).to_string();
        match o.status.code() {
            Some(0) => Ok(text),
            Some(126) => Err("cancelled".into()),
            Some(127) => Err("not-authorized".into()),
            _ => Err(format!("service:{}", last_line(&String::from_utf8_lossy(&o.stderr)))),
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = tmp;
        let mut cmd = sh_quote(&bin.to_string_lossy());
        cmd.push_str(" service");
        for a in args {
            cmd.push(' ');
            cmd.push_str(&sh_quote(a));
        }
        // The prompt's own message ("Topo wants to make changes").
        let script = format!("do shell script {} with administrator privileges", applescript_string(&format!("{cmd} 2>&1")));
        let o = Command::new("osascript").args(["-e", &script]).stdin(Stdio::null()).output().map_err(|e| format!("service:{e}"))?;
        if o.status.success() {
            return Ok(String::from_utf8_lossy(&o.stdout).to_string());
        }
        let err = String::from_utf8_lossy(&o.stderr).to_string();
        if err.contains("-128") {
            return Err("cancelled".into());
        }
        Err(format!("service:{}", last_line(&err)))
    }
    #[cfg(windows)]
    {
        // UAC gives the elevated process no pipe back: it writes its outcome
        // to a file (--report), and PowerShell's Start-Process waits for it.
        fs::create_dir_all(tmp).map_err(|e| format!("service:{e}"))?;
        let report = tmp.join("service-report.txt");
        let _ = fs::remove_file(&report);
        let mut line: Vec<String> = vec!["service".into()];
        line.extend(args.iter().cloned());
        line.push("--report".into());
        line.push(report.to_string_lossy().into_owned());
        let arg_line = line.iter().map(|a| win_arg(a)).collect::<Vec<_>>().join(" ");
        let ps = format!(
            "$ErrorActionPreference='Stop'; try {{ $p = Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode }} catch {{ [Console]::Error.WriteLine($_.Exception.Message); exit 1223 }}",
            ps_string(&bin.to_string_lossy()),
            ps_string(&arg_line)
        );
        let o = hidden(Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &ps]))
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("service:{e}"))?;
        let rep = fs::read_to_string(&report).unwrap_or_default();
        let _ = fs::remove_file(&report);
        let code = o.status.code().unwrap_or(-1);
        if code == 1223 && rep.is_empty() {
            // ERROR_CANCELLED: the person said no to UAC.
            return Err("cancelled".into());
        }
        match rep.split_once('\n') {
            Some(("ok", rest)) => Ok(rest.to_string()),
            Some(("error", rest)) => Err(format!("service:{}", last_line(rest))),
            _ if code == 0 => Ok(String::new()),
            _ => Err(format!("service:{}", last_line(&String::from_utf8_lossy(&o.stderr)))),
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = (bin, args, tmp);
        Err("no-service".into())
    }
}

/// A PowerShell single-quoted string.
#[cfg_attr(not(windows), allow(dead_code))]
fn ps_string(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn last_line(s: &str) -> String {
    s.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string()
}

/// Writes the service's settings (and a typed SMTP password) to private
/// temporary files for the elevated command, which copies them into the
/// service's own folder; the files are deleted right after.
struct Handover {
    files: Vec<PathBuf>,
    args: Vec<String>,
}

impl Drop for Handover {
    fn drop(&mut self) {
        for f in &self.files {
            let _ = fs::remove_file(f);
        }
    }
}

fn handover(app: &AppHandle, bin: &Path, s: &Settings, pass: Option<&str>) -> Result<Handover, String> {
    let lan = if s.lan { lan_addresses(bin) } else { Vec::new() };
    let p = plan(s, lan)?;
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conf = dir.join("service-settings.conf");
    write_private(&conf, conf_text(&server_vars(s, &p)).as_bytes())?;
    let mut h = Handover { files: vec![conf.clone()], args: vec!["--config".into(), conf.to_string_lossy().into_owned()] };
    if let Some(pw) = pass.filter(|p| !p.is_empty()) {
        if pw.contains(['\r', '\n']) {
            return Err("smtp".into());
        }
        let pf = dir.join("service-smtp.pass");
        write_private(&pf, pw.as_bytes())?;
        h.files.push(pf.clone());
        h.args.push("--smtp-pass".into());
        h.args.push(pf.to_string_lossy().into_owned());
    }
    Ok(h)
}

fn status(app: &AppHandle, st: &ServerState) -> Status {
    let settings = load_settings(app);
    let bin = binary();
    let dir = data_dir(app).ok();
    let mut s = Status {
        available: bin.is_some(),
        mode: "app".into(),
        has_smtp_pass: pass_path(app).map(|p| p.is_file()).unwrap_or(false),
        ..Default::default()
    };
    if let Some(b) = &bin {
        s.service = service_info(b, settings.port);
        s.lan_addresses = lan_addresses(b);
    }
    if s.service.installed {
        // The service: the app only reports on it.
        s.mode = "service".into();
        s.running = s.service.running || s.service.answering;
        s.has_smtp_pass = settings.service_smtp_pass;
        if s.running {
            if let Ok(p) = plan(&settings, s.lan_addresses.clone()) {
                s.urls = p.urls;
            }
            if settings.lan {
                s.fingerprint = s.service.fingerprint.clone();
            }
        }
        if let Some(b) = &bin {
            s.log = service_log(b);
        }
        s.error = st.error.lock().unwrap().clone();
        s.settings = settings;
        return s;
    }
    {
        let mut guard = st.running.lock().unwrap();
        let mut exited = None;
        if let Some(r) = guard.as_mut() {
            match r.child.try_wait() {
                Ok(None) => {
                    s.running = true;
                    s.pid = r.child.id();
                    s.urls = r.urls.clone();
                }
                Ok(Some(code)) => exited = Some(code.code().unwrap_or(-1)),
                Err(_) => exited = Some(-1),
            }
        }
        if let Some(code) = exited {
            *guard = None;
            if let Some(d) = &dir {
                let _ = fs::remove_file(d.join("server.pid"));
            }
            *st.error.lock().unwrap() = format!("exited:{code}");
        }
    }
    // A server this app did not start (a crash left it running).
    if !s.running {
        if let (Some(b), Some(d)) = (&bin, &dir) {
            if let Some(pid) = read_pid(d) {
                if alive_as(pid, b) {
                    s.pid = pid;
                    s.error = "already-running".into();
                }
            }
        }
    }
    if s.error.is_empty() {
        s.error = st.error.lock().unwrap().clone();
    }
    if settings.lan {
        if let Some(d) = &dir {
            s.fingerprint = fs::read_to_string(d.join("tls").join("cert.sha256")).unwrap_or_default().trim().to_string();
        }
    }
    s.log = st.log.lock().map(|l| l.iter().cloned().collect()).unwrap_or_default();
    s.settings = settings;
    s
}

fn service_installed() -> bool {
    binary().map(|b| service_info(&b, 0).installed).unwrap_or(false)
}

fn start(app: &AppHandle, st: &ServerState) -> Result<(), String> {
    if st.running.lock().unwrap().is_some() {
        if status(app, st).running {
            return Ok(());
        }
    }
    let settings = load_settings(app);
    validate(&settings)?;
    let bin = binary().ok_or("no-binary")?;
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("data:{e}"))?;
    if let Some(pid) = read_pid(&dir) {
        if alive_as(pid, &bin) {
            return Err("already-running".into());
        }
    }
    let lan = if settings.lan { lan_addresses(&bin) } else { Vec::new() };
    let p = plan(&settings, lan)?;

    let mut cmd = Command::new(&bin);
    cmd.arg("serve");
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().starts_with("TOPO_") {
            cmd.env_remove(&k);
        }
    }
    cmd.env("TOPO_DATA", &dir);
    for (k, v) in server_vars(&settings, &p) {
        cmd.env(k, v);
    }
    if settings.mail == "smtp" && !settings.smtp_user.trim().is_empty() {
        let pass = pass_path(app)?;
        if pass.is_file() {
            cmd.env("TOPO_SMTP_PASS_FILE", &pass);
        }
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = hidden(&mut cmd).spawn().map_err(|e| format!("start:{e}"))?;
    if let Some(o) = child.stdout.take() {
        pipe_lines(o, st.log.clone());
    }
    if let Some(e) = child.stderr.take() {
        pipe_lines(e, st.log.clone());
    }
    let _ = fs::write(dir.join("server.pid"), child.id().to_string());
    *st.error.lock().unwrap() = String::new();
    // A setting the server refuses ends it at once: say so now.
    thread::sleep(Duration::from_millis(400));
    if let Ok(Some(code)) = child.try_wait() {
        let _ = fs::remove_file(dir.join("server.pid"));
        let msg = format!("exited:{}", code.code().unwrap_or(-1));
        *st.error.lock().unwrap() = msg.clone();
        return Err(msg);
    }
    *st.running.lock().unwrap() = Some(Running { child, urls: p.urls });
    Ok(())
}

fn stop(app: &AppHandle, st: &ServerState) {
    let dir = data_dir(app).ok();
    let taken = st.running.lock().unwrap().take();
    if let Some(mut r) = taken {
        terminate(r.child.id());
        let until = Instant::now() + Duration::from_secs(10);
        while Instant::now() < until {
            if let Ok(Some(_)) = r.child.try_wait() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if let Ok(None) = r.child.try_wait() {
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
    } else if let (Some(b), Some(d)) = (binary(), &dir) {
        // Left running by an earlier run of the app.
        if let Some(pid) = read_pid(d) {
            if alive_as(pid, &b) {
                terminate(pid);
            }
        }
    }
    if let Some(d) = dir {
        let _ = fs::remove_file(d.join("server.pid"));
    }
    *st.error.lock().unwrap() = String::new();
}

/// Runs one elevated `service` command, keeping its error for the status.
fn service_run(app: &AppHandle, st: &ServerState, args: Vec<String>) -> Result<(), String> {
    let bin = binary().ok_or("no-binary")?;
    let _one = st.elevating.lock().unwrap();
    let tmp = data_dir(app)?;
    let r = elevated(&bin, &args, &tmp);
    // Saying no to the prompt is not an error worth keeping.
    *st.error.lock().unwrap() = match &r {
        Err(e) if e != "cancelled" => e.clone(),
        _ => String::new(),
    };
    r.map(|_| ())
}

#[tauri::command]
pub fn server_info(app: AppHandle, st: State<'_, ServerState>) -> Status {
    status(&app, &st)
}

/// Saves the settings (and the SMTP password when one is typed: never sent
/// back). A running child restarts with them; a service gets them through
/// the administrator prompt (and restarts if it runs).
#[tauri::command]
pub fn server_save(app: AppHandle, st: State<'_, ServerState>, settings: Settings, smtp_pass: Option<String>) -> Result<Status, String> {
    validate(&settings)?;
    let mut settings = settings;
    let old = load_settings(&app);
    settings.service_smtp_pass = old.service_smtp_pass;
    if service_installed() {
        let bin = binary().ok_or("no-binary")?;
        let h = handover(&app, &bin, &settings, smtp_pass.as_deref())?;
        let mut args = vec!["configure".to_string()];
        args.extend(h.args.iter().skip(1).cloned());
        service_run(&app, &st, args)?;
        if smtp_pass.as_deref().map(|p| !p.is_empty()).unwrap_or(false) {
            settings.service_smtp_pass = true;
        }
        save_settings(&app, &settings)?;
        return Ok(status(&app, &st));
    }
    save_settings(&app, &settings)?;
    if let Some(pass) = smtp_pass.filter(|p| !p.is_empty()) {
        let dir = data_dir(&app)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        write_private(&dir.join("smtp.pass"), pass.as_bytes())?;
    }
    let was = st.running.lock().unwrap().is_some();
    if was {
        stop(&app, &st);
        start(&app, &st)?;
    }
    Ok(status(&app, &st))
}

#[tauri::command]
pub fn server_start(app: AppHandle, st: State<'_, ServerState>) -> Result<Status, String> {
    if service_installed() {
        service_run(&app, &st, vec!["start".into()])?;
    } else {
        start(&app, &st)?;
    }
    Ok(status(&app, &st))
}

#[tauri::command]
pub fn server_stop(app: AppHandle, st: State<'_, ServerState>) -> Result<Status, String> {
    if service_installed() {
        service_run(&app, &st, vec!["stop".into()])?;
    } else {
        stop(&app, &st);
    }
    Ok(status(&app, &st))
}

/// Sets this PC up as the server for good: the service, with the settings
/// on screen, started now and at every start of the computer (D125). One
/// administrator prompt. A server the app was running itself stops first
/// (the service has its own data folder and the same port).
#[tauri::command]
pub fn server_service_install(app: AppHandle, st: State<'_, ServerState>, settings: Settings, smtp_pass: Option<String>) -> Result<Status, String> {
    validate(&settings)?;
    let bin = binary().ok_or("no-binary")?;
    let info = service_info(&bin, 0);
    if !info.supported {
        return Err("no-service".into());
    }
    let mut settings = settings;
    settings.enabled = false;
    settings.service_smtp_pass = load_settings(&app).service_smtp_pass;
    let h = handover(&app, &bin, &settings, smtp_pass.as_deref())?;
    if st.running.lock().unwrap().is_some() {
        stop(&app, &st);
    }
    let mut args: Vec<String> = if info.installed {
        let mut a = vec!["configure".to_string()];
        a.extend(h.args.iter().skip(1).cloned());
        a
    } else {
        let mut a = vec!["install".to_string()];
        a.extend(h.args.iter().cloned());
        a
    };
    args.push("--start".into());
    service_run(&app, &st, args)?;
    if smtp_pass.as_deref().map(|p| !p.is_empty()).unwrap_or(false) {
        settings.service_smtp_pass = true;
    }
    save_settings(&app, &settings)?;
    // The service takes a moment to answer.
    thread::sleep(Duration::from_millis(800));
    Ok(status(&app, &st))
}

/// Stops using this PC as the server: the service is removed (its data
/// stays, D125).
#[tauri::command]
pub fn server_service_remove(app: AppHandle, st: State<'_, ServerState>) -> Result<Status, String> {
    service_run(&app, &st, vec!["uninstall".into()])?;
    let mut s = load_settings(&app);
    s.service_smtp_pass = false;
    save_settings(&app, &s)?;
    Ok(status(&app, &st))
}

/// The first-run question (D125): asked once, on a computer that can run
/// the service and does not yet, unless the Windows installer already asked.
#[tauri::command]
pub fn server_question(app: AppHandle) -> bool {
    if question_path(&app).map(|p| p.is_file()).unwrap_or(true) {
        return false;
    }
    if installer_asked() {
        return false;
    }
    match binary() {
        Some(b) => {
            let i = service_info(&b, 0);
            i.supported && !i.installed
        }
        None => false,
    }
}

/// Whatever the answer, the question is not asked again.
#[tauri::command]
pub fn server_question_done(app: AppHandle, answer: String) -> Result<(), String> {
    let p = question_path(&app)?;
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let a = if answer == "yes" { "yes" } else { "no" };
    fs::write(p, format!("{{\"answer\":\"{a}\"}}\n")).map_err(|e| e.to_string())
}

/// The Windows installer writes ServerQuestion=asked when it showed its
/// tick box (desktop/src-tauri/windows/hooks.nsh).
fn installer_asked() -> bool {
    #[cfg(windows)]
    {
        ["/reg:64", "/reg:32"].iter().any(|view| {
            hidden(Command::new("reg").args(["query", r"HKLM\Software\Carino Systems\Topo", "/v", "ServerQuestion", *view]))
                .stdin(Stdio::null())
                .output()
                .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).contains("asked"))
                .unwrap_or(false)
        })
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Opens one of the running server's own addresses in the system browser.
#[tauri::command]
pub fn server_open(app: AppHandle, st: State<'_, ServerState>, url: String) -> Result<(), String> {
    let mine = st.running.lock().unwrap().as_ref().map(|r| r.urls.contains(&url)).unwrap_or(false);
    let ok = mine || {
        let s = status(&app, &st);
        s.mode == "service" && s.urls.contains(&url)
    };
    if !ok {
        return Err("not-ours".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

pub(crate) fn write_private(path: &Path, data: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| e.to_string())?;
        f.write_all(data).map_err(|e| e.to_string())
    }
    #[cfg(not(unix))]
    {
        fs::write(path, data).map_err(|e| e.to_string())
    }
}

/// At app start: start the server as the app's child when the owner chose
/// that (never when the service is set up: it runs by itself).
pub fn autostart(app: &AppHandle) {
    if load_settings(app).enabled && !service_installed() {
        let st = app.state::<ServerState>();
        if let Err(e) = start(app, &st) {
            eprintln!("topo: the built-in server did not start: {e}");
        }
    }
}

/// At app exit: a child server stops with the app (the service does not).
pub fn on_exit(app: &AppHandle) {
    let st = app.state::<ServerState>();
    if st.running.lock().unwrap().is_some() {
        stop(app, &st);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation() {
        let mut s = Settings { owner_email: "it@example.com".into(), ..Default::default() };
        assert_eq!(validate(&s), Ok(()));
        s.lan = true;
        assert_eq!(validate(&s), Err("lan-needs-email".into()));
        s.mail = "smtp".into();
        assert_eq!(validate(&s), Err("smtp".into()));
        s.smtp_host = "smtp.example.com".into();
        s.smtp_from = "Topo <topo@example.com>".into();
        assert_eq!(validate(&s), Ok(()));
        s.smtp_host = "smtp.example.com\nTOPO_DATA=/tmp".into();
        assert_eq!(validate(&s), Err("smtp".into()));
        s.smtp_host = "smtp.example.com".into();
        s.share_address = "10.0.0.1\nX".into();
        assert_eq!(validate(&s), Err("share".into()));
        s.share_address = String::new();
        s.port = 80;
        assert_eq!(validate(&s), Err("port".into()));
        s.port = 7380;
        s.owner_email = "nobody".into();
        assert_eq!(validate(&s), Err("owner-email".into()));
    }

    #[test]
    fn share_address_first() {
        let l = vec!["172.22.0.1".to_string(), "192.168.1.20".to_string()];
        assert_eq!(share_first(l.clone(), "192.168.1.20"), vec!["192.168.1.20", "172.22.0.1"]);
        assert_eq!(share_first(l.clone(), ""), l);
        assert_eq!(share_first(l.clone(), "10.9.9.9"), l);
    }

    #[test]
    fn settings_json() {
        let s: Settings = serde_json::from_str(r#"{"lan":true,"ownerEmail":"a@b.co"}"#).unwrap();
        assert!(s.lan && !s.enabled && s.port == 7380 && s.mail == "none" && s.owner_email == "a@b.co" && !s.service_smtp_pass);
        let back = serde_json::to_string(&s).unwrap();
        assert!(back.contains("\"ownerEmail\"") && !back.contains("\"smtpPass\""));
    }

    // The same settings go to the child's environment and to the service's
    // settings file (only the keys `service configure` accepts).
    #[test]
    fn plan_and_vars() {
        let mut s = Settings { owner_email: "it@example.com".into(), ..Default::default() };
        let p = plan(&s, vec![]).unwrap();
        assert_eq!(p.urls, vec!["http://127.0.0.1:7380"]);
        let conf = conf_text(&server_vars(&s, &p));
        assert!(conf.contains("TOPO_LISTEN=127.0.0.1:7380\n") && conf.contains("TOPO_MAIL=log\n") && !conf.contains("TOPO_TLS_SELF"));

        s.lan = true;
        s.share_address = "192.168.1.20".into();
        assert_eq!(plan(&s, vec![]).err(), Some("no-lan".into()));
        let p = plan(&s, vec!["172.22.0.1".into(), "192.168.1.20".into()]).unwrap();
        assert_eq!(p.public, "https://192.168.1.20:7380");
        assert_eq!(p.allowed, "172.22.0.1");
        s.mail = "smtp".into();
        s.smtp_host = "smtp.example.com".into();
        s.smtp_from = "Topo <topo@example.com>".into();
        s.smtp_user = "topo@example.com".into();
        let conf = conf_text(&server_vars(&s, &p));
        for want in [
            "TOPO_LISTEN=0.0.0.0:7380\n",
            "TOPO_PUBLIC_URL=https://192.168.1.20:7380\n",
            "TOPO_ALLOWED_HOSTS=172.22.0.1\n",
            "TOPO_TLS_SELF=1\n",
            "TOPO_SMTP_FROM=Topo <topo@example.com>\n",
            "TOPO_SMTP_USER=topo@example.com\n",
        ] {
            assert!(conf.contains(want), "{want} missing from\n{conf}");
        }
        assert!(!conf.contains("TOPO_DATA") && !conf.contains("PASS"));
    }

    #[test]
    fn quoting() {
        assert_eq!(sh_quote("/Applications/Topo.app/x"), "'/Applications/Topo.app/x'");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert_eq!(applescript_string(r#"a "b" \c"#), r#""a \"b\" \\c""#);
        assert_eq!(win_arg("install"), "install");
        assert_eq!(win_arg(r"C:\Users\Jo Smith\a.conf"), r#""C:\Users\Jo Smith\a.conf""#);
        assert_eq!(win_arg(r"C:\dir with space\"), r#""C:\dir with space\\""#);
        assert_eq!(win_arg(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(win_arg(""), r#""""#);
        assert_eq!(ps_string("it's"), "'it''s'");
        assert_eq!(last_line("a\nb\n\n"), "b");
    }

    #[test]
    fn service_info_json() {
        let i: ServiceInfo = serde_json::from_str(r#"{"supported":true,"installed":true,"running":false,"answering":true,"tls":true,"fingerprint":"AB:CD"}"#).unwrap();
        assert!(i.installed && i.answering && i.fingerprint == "AB:CD");
        let none: ServiceInfo = serde_json::from_str("{}").unwrap();
        assert!(!none.supported && !none.installed);
    }
}
