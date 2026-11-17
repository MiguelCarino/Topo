// "Open a device" in the desktop app (docs/SCOPE.md D446, D450, D452, step
// 9m): the page's SSH, Remote Desktop, VNC and Telnet buttons
// (js/reach.js) start this computer's own program for it.
//
//   reach_clients  -> { ssh, rdp, vnc, telnet }: the program found for each
//                     way in, by its name, or null. Looking is a name on the
//                     PATH or in the few folders these install to: no
//                     program is run and nothing is asked of the network.
//   reach_open     starts it. "bad-address" when the address is not an IP
//                     address, the port not a port or the user name not
//                     plain characters; "none" when no program was found;
//                     "no-terminal" when SSH or Telnet has no terminal to
//                     open in (Linux).
//
// Topo is never between the person and their credentials: no password or
// key is taken, kept or passed, and the program asks for them itself. The
// address, port and user name go as separate arguments, never through a
// shell. Nothing is installed: when a program is missing the page links to
// software.carino.systems (D451).
//
// What starts what (D450) is plan(), a plain function over the system's
// name and a "is this program here?" answer, so the three systems' plans
// are tested on any of them. Only looking (find) and starting (start) touch
// the computer; the Windows and macOS halves of those are built only there
// and were not run here.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use serde::Serialize;
use std::net::IpAddr;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Windows,
    Mac,
    Linux,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Ssh,
    Rdp,
    Vnc,
    Telnet,
}

impl Kind {
    fn parse(s: &str) -> Option<Kind> {
        match s {
            "ssh" => Some(Kind::Ssh),
            "rdp" => Some(Kind::Rdp),
            "vnc" => Some(Kind::Vnc),
            "telnet" => Some(Kind::Telnet),
            _ => None,
        }
    }
    fn port(self) -> u16 {
        match self {
            Kind::Ssh => 22,
            Kind::Rdp => 3389,
            Kind::Vnc => 5900,
            Kind::Telnet => 23,
        }
    }
}

/// Where a way in leads, checked: an IP address, a port, a plain user name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub ip: IpAddr,
    pub port: u16,
    pub user: String,
}

impl Target {
    /// "192.168.1.10" or "[2001:db8::10]".
    fn host(&self) -> String {
        match self.ip {
            IpAddr::V4(a) => a.to_string(),
            IpAddr::V6(a) => format!("[{a}]"),
        }
    }
    fn host_port(&self) -> String {
        format!("{}:{}", self.host(), self.port)
    }
    /// "user@" or nothing.
    fn at(&self) -> String {
        if self.user.is_empty() {
            String::new()
        } else {
            format!("{}@", self.user)
        }
    }
}

/// A user name as the document keeps it: letters, digits and . _ - @ \ $,
/// at most 64, never starting with a dash (it would read as an option).
fn user_ok(user: &str) -> bool {
    user.chars().count() <= 64
        && !user.starts_with('-')
        && user.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | '@' | '\\' | '$'))
}

pub fn target(kind: Kind, host: &str, port: Option<u32>, user: Option<&str>) -> Option<Target> {
    let ip: IpAddr = host.trim().trim_start_matches('[').trim_end_matches(']').parse().ok()?;
    let port = match port {
        None => kind.port(),
        Some(p) if (1..=65535).contains(&p) => p as u16,
        Some(_) => return None,
    };
    let user = user.unwrap_or("").trim();
    // A VNC viewer takes no user name.
    let user = if kind == Kind::Vnc { "" } else { user };
    if !user_ok(user) {
        return None;
    }
    Some(Target { ip, port, user: user.to_string() })
}

/// What to start.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    /// The program, by the name it was found under.
    pub program: String,
    pub args: Vec<String>,
    /// It talks in a terminal: its own console on Windows, the desktop's
    /// terminal on Linux.
    pub terminal: bool,
    /// The text of a .rdp file to write first; its path is then the last
    /// argument.
    pub rdp_file: Option<String>,
    /// The name the page shows ("Remmina").
    pub label: &'static str,
}

/// What a Remote Desktop client reads, as js/reach.js writes it for the
/// website. It asks for the password itself.
pub fn rdp_text(t: &Target) -> String {
    let mut lines = vec![format!(
        "full address:s:{}{}",
        t.host(),
        if t.port == 3389 { String::new() } else { format!(":{}", t.port) }
    )];
    if !t.user.is_empty() {
        lines.push(format!("username:s:{}", t.user));
    }
    lines.push("prompt for credentials:i:1".into());
    lines.push(String::new());
    lines.join("\r\n")
}

/// The programs each way in may use, best first: (the name looked for, the
/// name shown). macOS's "open" stands for the built-in Terminal and Screen
/// Sharing; "Windows App" and "Microsoft Remote Desktop" are looked for in
/// /Applications.
pub fn candidates(os: Os, kind: Kind) -> &'static [(&'static str, &'static str)] {
    match (os, kind) {
        (Os::Windows, Kind::Ssh) => &[("ssh", "OpenSSH"), ("putty", "PuTTY")],
        (Os::Windows, Kind::Rdp) => &[("mstsc", "Remote Desktop Connection")],
        (Os::Windows, Kind::Vnc) => &[("vncviewer", "VNC viewer")],
        (Os::Windows, Kind::Telnet) => &[("telnet", "Telnet"), ("putty", "PuTTY")],
        (Os::Mac, Kind::Ssh) => &[("open", "Terminal")],
        (Os::Mac, Kind::Rdp) => &[("Windows App", "Windows App"), ("Microsoft Remote Desktop", "Microsoft Remote Desktop")],
        (Os::Mac, Kind::Vnc) => &[("open", "Screen Sharing")],
        (Os::Mac, Kind::Telnet) => &[("telnet", "Telnet")],
        (Os::Linux, Kind::Ssh) => &[("ssh", "OpenSSH")],
        (Os::Linux, Kind::Rdp) => &[
            ("remmina", "Remmina"),
            ("org.remmina.Remmina", "Remmina"),
            ("krdc", "KRDC"),
            ("gnome-connections", "Connections"),
            ("xfreerdp3", "FreeRDP"),
            ("xfreerdp", "FreeRDP"),
        ],
        (Os::Linux, Kind::Vnc) => &[
            ("remmina", "Remmina"),
            ("org.remmina.Remmina", "Remmina"),
            ("krdc", "KRDC"),
            ("gnome-connections", "Connections"),
            ("vncviewer", "VNC viewer"),
        ],
        (Os::Linux, Kind::Telnet) => &[("telnet", "Telnet")],
    }
}

/// The first program of the list this computer has.
pub fn chosen(os: Os, kind: Kind, has: &dyn Fn(&str) -> bool) -> Option<(&'static str, &'static str)> {
    candidates(os, kind).iter().copied().find(|(name, _)| has(name))
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

pub fn plan(os: Os, kind: Kind, t: &Target, has: &dyn Fn(&str) -> bool) -> Option<Plan> {
    let (name, label) = chosen(os, kind, has)?;
    let port = t.port.to_string();
    let bare = t.ip.to_string();
    let mk = |args: Vec<String>, terminal: bool, rdp_file: Option<String>| Plan { program: name.to_string(), args, terminal, rdp_file, label };
    Some(match (os, kind, name) {
        // OpenSSH and telnet take the address without brackets.
        (Os::Windows | Os::Linux, Kind::Ssh, "ssh") => mk(s(&["-p", &port, &format!("{}{}", t.at(), bare)]), true, None),
        (Os::Windows, Kind::Ssh, _) => {
            let mut a = s(&["-ssh", "-P", &port]);
            if !t.user.is_empty() {
                a.extend(s(&["-l", &t.user]));
            }
            a.push(bare);
            mk(a, false, None)
        }
        (Os::Windows | Os::Linux, Kind::Telnet, "telnet") => mk(s(&[&bare, &port]), true, None),
        (Os::Windows, Kind::Telnet, _) => mk(s(&["-telnet", "-P", &port, &bare]), false, None),
        (Os::Windows, Kind::Rdp, _) => mk(vec![], false, Some(rdp_text(t))),
        // TigerVNC and its kin: host::port is a port, host:n a display.
        (Os::Windows | Os::Linux, Kind::Vnc, "vncviewer") => mk(vec![format!("{}::{}", t.host(), t.port)], false, None),
        (Os::Mac, Kind::Ssh, _) => mk(vec![format!("ssh://{}{}", t.at(), t.host_port())], false, None),
        (Os::Mac, Kind::Vnc, _) => mk(vec![format!("vnc://{}", t.host_port())], false, None),
        // Terminal answers telnet:// by running telnet, which is why it is looked for.
        (Os::Mac, Kind::Telnet, _) => Plan { program: "open".into(), args: vec![format!("telnet://{}{}", t.at(), t.host_port())], terminal: false, rdp_file: None, label },
        (Os::Mac, Kind::Rdp, app) => Plan { program: "open".into(), args: s(&["-a", app]), terminal: false, rdp_file: Some(rdp_text(t)), label },
        (Os::Linux, Kind::Rdp | Kind::Vnc, "remmina" | "org.remmina.Remmina") => {
            let scheme = if kind == Kind::Rdp { "rdp" } else { "vnc" };
            mk(s(&["-c", &format!("{scheme}://{}{}", t.at(), t.host_port())]), false, None)
        }
        (Os::Linux, Kind::Rdp | Kind::Vnc, "krdc") => {
            let scheme = if kind == Kind::Rdp { "rdp" } else { "vnc" };
            mk(vec![format!("{scheme}://{}{}", t.at(), t.host_port())], false, None)
        }
        (Os::Linux, Kind::Rdp | Kind::Vnc, "gnome-connections") => {
            let scheme = if kind == Kind::Rdp { "rdp" } else { "vnc" };
            mk(vec![format!("{scheme}://{}", t.host_port())], false, None)
        }
        // FreeRDP asks for the password where it was started: a terminal.
        (Os::Linux, Kind::Rdp, _) => {
            let mut a = vec![format!("/v:{}", t.host_port())];
            if !t.user.is_empty() {
                a.push(format!("/u:{}", t.user));
            }
            mk(a, true, None)
        }
        _ => return None,
    })
}

/// Linux: the terminals looked for, best first, with what goes between the
/// terminal's name and the command it runs.
pub const TERMINALS: &[(&str, &[&str])] = &[
    ("xdg-terminal-exec", &[]),
    ("ptyxis", &["--"]),
    ("kgx", &["--"]),
    ("gnome-terminal", &["--"]),
    ("konsole", &["-e"]),
    ("kitty", &[]),
    ("foot", &[]),
    ("alacritty", &["-e"]),
    ("wezterm", &["start", "--"]),
    ("xfce4-terminal", &["-x"]),
    ("xterm", &["-e"]),
];

/// The whole command line of a plan that needs a terminal on Linux:
/// the terminal, its own words, the program and its arguments.
pub fn in_terminal(plan: &Plan, has: &dyn Fn(&str) -> bool) -> Option<Vec<String>> {
    let (term, pre) = TERMINALS.iter().find(|(name, _)| has(name))?;
    let mut line = vec![term.to_string()];
    line.extend(pre.iter().map(|x| x.to_string()));
    line.push(plan.program.clone());
    line.extend(plan.args.iter().cloned());
    Some(line)
}

// ---- Looking and starting: this computer ----

#[cfg(target_os = "windows")]
const THIS_OS: Os = Os::Windows;
#[cfg(target_os = "macos")]
const THIS_OS: Os = Os::Mac;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
const THIS_OS: Os = Os::Linux;

/// The folders looked in besides the PATH.
fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if THIS_OS == Os::Windows {
        if let Some(root) = std::env::var_os("SystemRoot") {
            let root = PathBuf::from(root);
            dirs.push(root.join("System32").join("OpenSSH"));
            dirs.push(root.join("System32"));
        }
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(pf) = std::env::var_os(var) {
                let pf = PathBuf::from(pf);
                for sub in ["PuTTY", "TigerVNC", "RealVNC\\VNC Viewer", "TightVNC", "uvnc bvba\\UltraVNC"] {
                    dirs.push(pf.join(sub));
                }
            }
        }
    } else if THIS_OS == Os::Linux {
        // Where Flatpak puts an app's command, when the session's PATH lacks it.
        dirs.push(PathBuf::from("/var/lib/flatpak/exports/bin"));
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join(".local/share/flatpak/exports/bin"));
        }
    }
    dirs
}

/// Where a program is, or None. macOS: "open" is the system's, and an app
/// by its name is looked for in /Applications.
pub fn find(name: &str) -> Option<PathBuf> {
    if THIS_OS == Os::Mac && (name == "Windows App" || name == "Microsoft Remote Desktop") {
        let app = PathBuf::from("/Applications").join(format!("{name}.app"));
        return app.exists().then_some(app);
    }
    // Windows: the viewers install under their own names.
    let names: Vec<String> = if THIS_OS == Os::Windows {
        let mut v = vec![format!("{name}.exe")];
        if name == "vncviewer" {
            v.extend(["tvnviewer.exe".to_string(), "vncviewer64.exe".to_string()]);
        }
        v
    } else {
        vec![name.to_string()]
    };
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path).chain(extra_dirs()).flat_map(|dir| names.iter().map(move |n| dir.join(n)).collect::<Vec<_>>()).find(|p| p.is_file())
}

fn has(name: &str) -> bool {
    find(name).is_some()
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq, Default)]
pub struct Clients {
    pub ssh: Option<String>,
    pub rdp: Option<String>,
    pub vnc: Option<String>,
    pub telnet: Option<String>,
}

pub fn clients_with(os: Os, has: &dyn Fn(&str) -> bool) -> Clients {
    let one = |kind: Kind| -> Option<String> {
        let (_, label) = chosen(os, kind, has)?;
        // Linux: SSH, Telnet and FreeRDP open in a terminal; with none, there is nothing to start.
        let needs_term = os == Os::Linux && matches!(label, "OpenSSH" | "Telnet" | "FreeRDP");
        if needs_term && !TERMINALS.iter().any(|(t, _)| has(t)) {
            return None;
        }
        Some(label.to_string())
    };
    Clients { ssh: one(Kind::Ssh), rdp: one(Kind::Rdp), vnc: one(Kind::Vnc), telnet: one(Kind::Telnet) }
}

#[tauri::command]
pub fn reach_clients() -> Clients {
    clients_with(THIS_OS, &has)
}

/// The .rdp file a plan asks for, in the temporary folder: one file, written
/// over each time, readable by this user only where the system has modes.
fn write_rdp(text: &str) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join("topo-reach.rdp");
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(path)
}

fn start(plan: &Plan) -> Result<(), String> {
    let mut line: Vec<String> = if plan.terminal && THIS_OS == Os::Linux {
        in_terminal(plan, &has).ok_or("no-terminal")?
    } else {
        let mut v = vec![plan.program.clone()];
        v.extend(plan.args.iter().cloned());
        v
    };
    if let Some(text) = &plan.rdp_file {
        line.push(write_rdp(text)?.to_string_lossy().into_owned());
    }
    // The program by where it was found, so one in a folder off the PATH starts too.
    let program = if line[0] == "open" { PathBuf::from("open") } else { find(&line[0]).ok_or("none")? };
    let mut cmd = std::process::Command::new(program);
    cmd.args(&line[1..]);
    #[cfg(target_os = "windows")]
    if plan.terminal {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE
    }
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    // Nobody waits on it: reap it when it ends, so it leaves no zombie.
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });
    Ok(())
}

#[tauri::command]
pub fn reach_open(kind: String, host: String, port: Option<u32>, user: Option<String>) -> Result<String, String> {
    let kind = Kind::parse(&kind).ok_or("bad-address")?;
    let t = target(kind, &host, port, user.as_deref()).ok_or("bad-address")?;
    let plan = plan(THIS_OS, kind, &t, &has).ok_or("none")?;
    start(&plan)?;
    Ok(plan.label.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn only<'a>(names: &'a [&'a str]) -> impl Fn(&str) -> bool + 'a {
        move |n| names.contains(&n)
    }
    fn t(kind: Kind, host: &str, port: Option<u32>, user: Option<&str>) -> Target {
        target(kind, host, port, user).expect("a target")
    }

    #[test]
    fn a_target_is_an_ip_a_port_and_a_plain_user() {
        let a = t(Kind::Ssh, "192.168.1.10", None, Some(" admin "));
        assert_eq!((a.host(), a.port, a.user.as_str()), ("192.168.1.10".into(), 22, "admin"));
        assert_eq!(t(Kind::Rdp, "[2001:db8::10]", Some(3390), Some("CORP\\ana")).host_port(), "[2001:db8::10]:3390");
        assert_eq!(t(Kind::Vnc, "10.0.0.5", None, Some("ignored")).user, "");
        for bad in ["nas.local", "10.0.0.5; rm -rf ~", "-oProxyCommand=x", "", "10.0.0.5 -l x", "$(id)"] {
            assert!(target(Kind::Ssh, bad, None, None).is_none(), "{bad}");
        }
        for bad in ["-oProxyCommand=id", "a b", "a;b", "a`b`", "x\"y", "a/b", "a&b"] {
            assert!(target(Kind::Ssh, "10.0.0.5", None, Some(bad)).is_none(), "{bad}");
        }
        assert!(target(Kind::Ssh, "10.0.0.5", Some(0), None).is_none());
        assert!(target(Kind::Ssh, "10.0.0.5", Some(65536), None).is_none());
        assert!(target(Kind::Ssh, "10.0.0.5", None, Some(&"a".repeat(65))).is_none());
    }

    #[test]
    fn the_rdp_file_is_the_websites() {
        assert_eq!(rdp_text(&t(Kind::Rdp, "192.168.1.10", Some(3390), Some("Admin"))), "full address:s:192.168.1.10:3390\r\nusername:s:Admin\r\nprompt for credentials:i:1\r\n");
        assert_eq!(rdp_text(&t(Kind::Rdp, "2001:db8::10", None, None)), "full address:s:[2001:db8::10]\r\nprompt for credentials:i:1\r\n");
    }

    #[test]
    fn linux_plans() {
        let all = |_: &str| true;
        let ssh = plan(Os::Linux, Kind::Ssh, &t(Kind::Ssh, "192.168.1.10", Some(2222), Some("admin")), &all).unwrap();
        assert_eq!((ssh.program.as_str(), ssh.args.clone(), ssh.terminal), ("ssh", s(&["-p", "2222", "admin@192.168.1.10"]), true));
        let v6 = plan(Os::Linux, Kind::Ssh, &t(Kind::Ssh, "2001:db8::10", None, None), &all).unwrap();
        assert_eq!(v6.args, s(&["-p", "22", "2001:db8::10"]));
        let tel = plan(Os::Linux, Kind::Telnet, &t(Kind::Telnet, "192.168.1.1", None, None), &all).unwrap();
        assert_eq!((tel.args.clone(), tel.terminal), (s(&["192.168.1.1", "23"]), true));
        let rdp = plan(Os::Linux, Kind::Rdp, &t(Kind::Rdp, "192.168.1.20", None, Some("ana")), &all).unwrap();
        assert_eq!((rdp.program.as_str(), rdp.args.clone(), rdp.terminal, rdp.label), ("remmina", s(&["-c", "rdp://ana@192.168.1.20:3389"]), false, "Remmina"));
        let flat = plan(Os::Linux, Kind::Vnc, &t(Kind::Vnc, "192.168.1.20", None, None), &only(&["org.remmina.Remmina"])).unwrap();
        assert_eq!((flat.program.as_str(), flat.args.clone()), ("org.remmina.Remmina", s(&["-c", "vnc://192.168.1.20:5900"])));
        let krdc = plan(Os::Linux, Kind::Rdp, &t(Kind::Rdp, "192.168.1.20", None, None), &only(&["krdc"])).unwrap();
        assert_eq!(krdc.args, s(&["rdp://192.168.1.20:3389"]));
        let gc = plan(Os::Linux, Kind::Vnc, &t(Kind::Vnc, "192.168.1.20", Some(5901), None), &only(&["gnome-connections"])).unwrap();
        assert_eq!(gc.args, s(&["vnc://192.168.1.20:5901"]));
        let free = plan(Os::Linux, Kind::Rdp, &t(Kind::Rdp, "2001:db8::10", None, Some("ana")), &only(&["xfreerdp"])).unwrap();
        assert_eq!((free.program.as_str(), free.args.clone(), free.terminal), ("xfreerdp", s(&["/v:[2001:db8::10]:3389", "/u:ana"]), true));
        let tiger = plan(Os::Linux, Kind::Vnc, &t(Kind::Vnc, "192.168.1.20", None, None), &only(&["vncviewer"])).unwrap();
        assert_eq!(tiger.args, s(&["192.168.1.20::5900"]));
        assert!(plan(Os::Linux, Kind::Rdp, &t(Kind::Rdp, "192.168.1.20", None, None), &only(&["ssh"])).is_none());
    }

    #[test]
    fn windows_plans() {
        let all = |_: &str| true;
        let ssh = plan(Os::Windows, Kind::Ssh, &t(Kind::Ssh, "192.168.1.10", None, Some("admin")), &all).unwrap();
        assert_eq!((ssh.program.as_str(), ssh.args.clone(), ssh.terminal), ("ssh", s(&["-p", "22", "admin@192.168.1.10"]), true));
        let putty = plan(Os::Windows, Kind::Ssh, &t(Kind::Ssh, "192.168.1.10", Some(2222), Some("admin")), &only(&["putty"])).unwrap();
        assert_eq!((putty.program.as_str(), putty.args.clone(), putty.terminal), ("putty", s(&["-ssh", "-P", "2222", "-l", "admin", "192.168.1.10"]), false));
        let tel = plan(Os::Windows, Kind::Telnet, &t(Kind::Telnet, "192.168.1.1", None, None), &only(&["putty"])).unwrap();
        assert_eq!(tel.args, s(&["-telnet", "-P", "23", "192.168.1.1"]));
        let rdp = plan(Os::Windows, Kind::Rdp, &t(Kind::Rdp, "192.168.1.20", None, Some("ana")), &all).unwrap();
        assert_eq!((rdp.program.as_str(), rdp.args.len(), rdp.rdp_file.is_some()), ("mstsc", 0, true));
        let vnc = plan(Os::Windows, Kind::Vnc, &t(Kind::Vnc, "192.168.1.20", Some(5901), None), &all).unwrap();
        assert_eq!(vnc.args, s(&["192.168.1.20::5901"]));
        assert!(plan(Os::Windows, Kind::Vnc, &t(Kind::Vnc, "192.168.1.20", None, None), &only(&["ssh", "mstsc"])).is_none());
    }

    #[test]
    fn mac_plans() {
        let builtin = only(&["open"]);
        let ssh = plan(Os::Mac, Kind::Ssh, &t(Kind::Ssh, "192.168.1.10", Some(2222), Some("admin")), &builtin).unwrap();
        assert_eq!((ssh.program.as_str(), ssh.args.clone()), ("open", s(&["ssh://admin@192.168.1.10:2222"])));
        let vnc = plan(Os::Mac, Kind::Vnc, &t(Kind::Vnc, "2001:db8::10", None, None), &builtin).unwrap();
        assert_eq!(vnc.args, s(&["vnc://[2001:db8::10]:5900"]));
        assert!(plan(Os::Mac, Kind::Rdp, &t(Kind::Rdp, "192.168.1.20", None, None), &builtin).is_none());
        assert!(plan(Os::Mac, Kind::Telnet, &t(Kind::Telnet, "192.168.1.1", None, None), &builtin).is_none());
        let rdp = plan(Os::Mac, Kind::Rdp, &t(Kind::Rdp, "192.168.1.20", None, None), &only(&["open", "Windows App"])).unwrap();
        assert_eq!((rdp.program.as_str(), rdp.args.clone(), rdp.rdp_file.is_some()), ("open", s(&["-a", "Windows App"]), true));
        let tel = plan(Os::Mac, Kind::Telnet, &t(Kind::Telnet, "192.168.1.1", None, None), &only(&["open", "telnet"])).unwrap();
        assert_eq!((tel.program.as_str(), tel.args.clone()), ("open", s(&["telnet://192.168.1.1:23"])));
    }

    #[test]
    fn a_terminal_wraps_the_command() {
        let ssh = plan(Os::Linux, Kind::Ssh, &t(Kind::Ssh, "192.168.1.10", None, Some("admin")), &|_| true).unwrap();
        assert_eq!(in_terminal(&ssh, &only(&["gnome-terminal", "xterm"])).unwrap(), s(&["gnome-terminal", "--", "ssh", "-p", "22", "admin@192.168.1.10"]));
        assert_eq!(in_terminal(&ssh, &only(&["kitty"])).unwrap(), s(&["kitty", "ssh", "-p", "22", "admin@192.168.1.10"]));
        assert_eq!(in_terminal(&ssh, &only(&["wezterm"])).unwrap()[..3], s(&["wezterm", "start", "--"])[..]);
        assert!(in_terminal(&ssh, &only(&["ssh"])).is_none());
    }

    #[test]
    fn what_is_found_is_named_and_what_is_not_is_none() {
        let c = clients_with(Os::Linux, &only(&["ssh", "kitty", "krdc"]));
        assert_eq!(c, Clients { ssh: Some("OpenSSH".into()), rdp: Some("KRDC".into()), vnc: Some("KRDC".into()), telnet: None });
        // SSH with no terminal to open in is nothing to start.
        assert_eq!(clients_with(Os::Linux, &only(&["ssh", "xfreerdp"])), Clients::default());
        let w = clients_with(Os::Windows, &only(&["ssh", "mstsc"]));
        assert_eq!((w.ssh.as_deref(), w.rdp.as_deref(), w.vnc, w.telnet), (Some("OpenSSH"), Some("Remote Desktop Connection"), None, None));
        let m = clients_with(Os::Mac, &only(&["open"]));
        assert_eq!((m.ssh.as_deref(), m.rdp, m.vnc.as_deref(), m.telnet), (Some("Terminal"), None, Some("Screen Sharing"), None));
    }

    #[test]
    fn this_computer_is_looked_at_without_starting_anything() {
        // Whatever is here, looking answers and names only what plan() can start.
        let c = reach_clients();
        for (kind, found) in [(Kind::Ssh, &c.ssh), (Kind::Rdp, &c.rdp), (Kind::Vnc, &c.vnc), (Kind::Telnet, &c.telnet)] {
            if found.is_some() {
                assert!(plan(THIS_OS, kind, &t(kind, "192.0.2.1", None, None), &has).is_some());
            }
        }
        assert!(find("a-program-nobody-has-7f3a").is_none());
        assert_eq!(reach_open("ssh".into(), "nas.local".into(), None, None), Err("bad-address".into()));
        assert_eq!(reach_open("ftp".into(), "192.0.2.1".into(), None, None), Err("bad-address".into()));
    }
}
