// "This computer" (docs/SCOPE.md D166, step 7d): what the page's "Add this
// computer" (js/thiscomputer.js) reads about the PC the app runs on, and
// nothing else:
//
//   this_computer   -> { hostname, os, platform, interfaces, gateways, dns,
//                        vendor, model, serial }
//   this_computer_serial -> the serial number, Linux only, through the
//                        administrator prompt (pkexec), when the person asks
//                        (D431); "cancelled", "not-authorized", "none".
//
// Everything comes from this PC's own tables: its interfaces (names, MACs,
// IPv4 and IPv6 addresses with their prefixes, MTU), its default gateways
// and its DNS servers. Nothing is sent onto the network: no socket is opened,
// no name is looked up, nothing is asked of the gateway or the DNS servers.
//
//   Linux    getifaddrs (IPv4), /proc/net/if_inet6 (IPv6 with its flags, so a
//            temporary privacy address is known), /sys/class/net (MAC, MTU,
//            physical or virtual, wireless), /proc/net/route and
//            /proc/net/ipv6_route (the default gateways), /etc/resolv.conf
//            (the DNS servers; systemd-resolved's own list behind its
//            127.0.0.53 stub).
//   macOS    getifaddrs (addresses, the MAC from the link entry, the MTU),
//            `route -n get default`, `scutil --dns`, `ifconfig -a` (media
//            status, temporary IPv6 addresses) and `networksetup
//            -listallhardwareports` (which card is Wi-Fi): local commands
//            that read this PC's own tables (D209).
//   Windows  GetAdaptersAddresses (iphlpapi), declared here: adapters,
//            addresses, prefixes, DNS servers and gateways in one call.
//
// Who made the PC, its model and its serial number (D430):
//
//   Linux    /sys/class/dmi/id (sys_vendor, product_name, product_version,
//            board_vendor, board_name; product_serial and board_serial,
//            which only an administrator may read, so as a rule blank).
//   macOS    `system_profiler SPHardwareDataType` (Model Name, Model
//            Identifier, Serial Number).
//   Windows  GetSystemFirmwareTable('RSMB'): the SMBIOS table, its system
//            (type 1) and board (type 2) records; and the registry's
//            ProductName, DisplayVersion and CurrentBuild for the system's
//            name ("Windows 11 Pro 24H2").
//
// The firmware's placeholders ("To Be Filled By O.E.M.", "System Product
// Name", "Default string") are never written; a home-built PC whose system
// record says nothing has its board's model instead.
//
// The parsers are plain functions over text, tested below on samples; the
// Windows and macOS readers are built only there (D204).

// Each OS uses only its own parsers; all of them are tested everywhere.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Addr {
    /// The address, as text ("192.168.1.20", "2001:db8::5").
    pub ip: String,
    /// Its prefix length (24, 64...).
    pub prefix: u8,
    /// An IPv6 privacy address the system makes and changes on its own.
    pub temporary: bool,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Iface {
    /// The system's name (eth0, en0, or the adapter's name on Windows).
    pub name: String,
    /// The name people see when it differs (Windows: "Ethernet", "Wi-Fi").
    pub label: String,
    /// The hardware address as AA:BB:CC:DD:EE:FF, "" when it has none.
    pub mac: String,
    pub mtu: Option<u32>,
    /// Connected: switched on AND with a link (a cable plugged in, Wi-Fi
    /// joined), not only switched on (D209). Linux and macOS: IFF_UP with
    /// IFF_RUNNING (macOS also its media status); Windows: OperStatus up.
    pub up: bool,
    pub loopback: bool,
    /// A real network card (false for bridges, containers' links, tunnels).
    pub physical: bool,
    pub wireless: bool,
    pub addresses: Vec<Addr>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Gateway {
    pub ip: String,
    /// The interface it is reached through ("" when the system does not say).
    pub iface: String,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThisComputer {
    pub hostname: String,
    pub os: String,
    /// "linux", "macos" or "windows".
    pub platform: String,
    pub interfaces: Vec<Iface>,
    pub gateways: Vec<Gateway>,
    pub dns: Vec<String>,
    /// Who made it, its model and its serial number ("" when unknown, D430).
    pub vendor: String,
    pub model: String,
    pub serial: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Hardware {
    pub vendor: String,
    pub model: String,
    pub serial: String,
}

/// A firmware string worth writing, or "": the placeholders boards ship
/// with, and serials of zeros, ones or Fs, are nothing.
pub fn clean_hw(s: &str) -> String {
    let v = s.trim().trim_matches(char::from(0)).trim();
    let low = v.to_ascii_lowercase();
    const NOTHING: &[&str] = &[
        "to be filled by o.e.m.", "to be filled by oem", "default string", "system product name", "system version",
        "system manufacturer", "system serial number", "base board product name", "base board serial number",
        "chassis serial number", "not specified", "not applicable", "not available", "none", "n/a", "na", "o.e.m.", "oem",
        "invalid", "default", "unknown", "x.x", "type1productconfigid", "type2 - board product name1",
        "0123456789", "123456789", "1234567890", "serial", "manufacturer", "product name",
    ];
    if v.is_empty() || NOTHING.contains(&low.as_str()) {
        return String::new();
    }
    if v.chars().all(|c| matches!(c, '0' | '1' | 'f' | 'F' | ' ' | '.' | '-' | '_' | 'x' | 'X')) && v.chars().filter(|c| c.is_ascii_hexdigit()).count() > 0
        && v.chars().filter(|c| c.is_ascii_hexdigit()).collect::<std::collections::BTreeSet<_>>().len() <= 1
    {
        return String::new();
    }
    v.chars().take(120).collect()
}

/// The firmware's system and board records -> who, what and which one.
/// Lenovo names the model in the version ("ThinkPad T14 Gen 3"), its product
/// name being a type number; a PC whose system record is empty is named by
/// its board.
pub fn pick_hardware(sys_vendor: &str, product: &str, version: &str, board_vendor: &str, board: &str, serials: &[&str]) -> Hardware {
    let vendor = match clean_hw(sys_vendor) {
        v if !v.is_empty() => v,
        _ => clean_hw(board_vendor),
    };
    let (p, ver) = (clean_hw(product), clean_hw(version));
    let model = if vendor.to_ascii_lowercase().contains("lenovo") && !ver.is_empty() && ver.chars().any(|c| c.is_ascii_alphabetic()) {
        ver
    } else if !p.is_empty() {
        p
    } else {
        clean_hw(board)
    };
    let serial = serials.iter().map(|s| clean_hw(s)).find(|s| !s.is_empty()).unwrap_or_default();
    Hardware { vendor, model, serial }
}

/// The SMBIOS structure table (Windows' RSMB data after its 8-byte header,
/// or Linux's /sys/firmware/dmi/tables/DMI): the system (type 1) and board
/// (type 2) records' manufacturer, product, version and serial.
pub fn parse_smbios(t: &[u8]) -> Hardware {
    let mut sys: [String; 4] = Default::default();
    let mut board: [String; 4] = Default::default();
    let mut i = 0usize;
    while i + 4 <= t.len() {
        let (kind, len) = (t[i], t[i + 1] as usize);
        if len < 4 || i + len > t.len() {
            break;
        }
        // The strings follow the formatted part, each NUL-ended, the set
        // ended by a second NUL.
        let mut strings: Vec<String> = Vec::new();
        let mut j = i + len;
        if j + 1 < t.len() && t[j] == 0 && t[j + 1] == 0 {
            j += 2;
        } else {
            while j < t.len() && t[j] != 0 {
                let start = j;
                while j < t.len() && t[j] != 0 {
                    j += 1;
                }
                strings.push(String::from_utf8_lossy(&t[start..j]).into_owned());
                j += 1;
            }
            j += 1;
        }
        let at = |off: usize| -> String {
            if off >= len {
                return String::new();
            }
            let n = t[i + off] as usize;
            if n == 0 { String::new() } else { strings.get(n - 1).cloned().unwrap_or_default() }
        };
        if kind == 1 && sys[0].is_empty() && sys[1].is_empty() {
            sys = [at(4), at(5), at(6), at(7)];
        } else if kind == 2 && board[0].is_empty() && board[1].is_empty() {
            board = [at(4), at(5), at(6), at(7)];
        } else if kind == 127 {
            break;
        }
        i = j;
    }
    pick_hardware(&sys[0], &sys[1], &sys[2], &board[0], &board[1], &[&sys[3], &board[3]])
}

/// `system_profiler SPHardwareDataType` -> Apple, "MacBook Pro
/// (MacBookPro18,3)", its serial.
pub fn parse_system_profiler(text: &str) -> Hardware {
    let field = |name: &str| -> String {
        text.lines()
            .filter_map(|l| l.trim().strip_prefix(name))
            .filter_map(|r| r.trim_start().strip_prefix(':'))
            .map(|v| v.trim().to_string())
            .next()
            .unwrap_or_default()
    };
    let (name, id) = (clean_hw(&field("Model Name")), clean_hw(&field("Model Identifier")));
    let model = match (name.is_empty(), id.is_empty()) {
        (false, false) => format!("{name} ({id})"),
        (false, true) => name,
        _ => id,
    };
    let serial = clean_hw(&field("Serial Number (system)"));
    let serial = if serial.is_empty() { clean_hw(&field("Serial Number")) } else { serial };
    let vendor = if model.is_empty() && serial.is_empty() { String::new() } else { "Apple".to_string() };
    Hardware { vendor, model, serial }
}

/// The registry's ProductName, DisplayVersion and CurrentBuild -> the name
/// Windows shows. ProductName still says "Windows 10" on Windows 11 (build
/// 22000 and later).
pub fn windows_os_name(product: &str, display: &str, build: &str) -> String {
    let mut name = product.trim().to_string();
    if name.is_empty() {
        name = "Windows".to_string();
    }
    if build.trim().parse::<u32>().map(|b| b >= 22000).unwrap_or(false) && name.starts_with("Windows 10") {
        name = name.replacen("Windows 10", "Windows 11", 1);
    }
    let d = display.trim();
    if d.is_empty() { name } else { format!("{name} {d}") }
}

/// The first serial worth writing in what `cat product_serial
/// board_serial` printed, or "".
pub fn first_serial(text: &str) -> String {
    text.lines().map(clean_hw).find(|s| !s.is_empty()).unwrap_or_default()
}

/// Linux: the system's and the board's serials, which only an administrator
/// may read, through pkexec's prompt, asked for by the person in the review
/// (D431). Elsewhere the serial is read with the rest.
#[tauri::command]
pub async fn this_computer_serial() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(elevated_serial).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "linux")]
fn elevated_serial() -> Result<String, String> {
    use std::process::{Command, Stdio};
    if !std::path::Path::new("/usr/bin/pkexec").exists() {
        return Err("no-pkexec".into());
    }
    let o = Command::new("/usr/bin/pkexec")
        .args(["/usr/bin/cat", "/sys/class/dmi/id/product_serial", "/sys/class/dmi/id/board_serial"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    match o.status.code() {
        Some(126) => return Err("cancelled".into()),
        Some(127) => return Err("not-authorized".into()),
        _ => {}
    }
    // cat says 1 when one of the two is missing, and prints the other.
    match first_serial(&String::from_utf8_lossy(&o.stdout)) {
        s if !s.is_empty() => Ok(s),
        _ => Err("none".into()),
    }
}

#[cfg(not(target_os = "linux"))]
fn elevated_serial() -> Result<String, String> {
    Err("not-needed".into())
}

/// The page's "Add this computer": this PC's own interfaces, gateways and
/// DNS servers. Reading only; nothing goes onto the network.
#[tauri::command]
pub fn this_computer() -> Result<ThisComputer, String> {
    read()
}

pub fn read() -> Result<ThisComputer, String> {
    let mut out = platform::read()?;
    out.platform = std::env::consts::OS.to_string();
    let hw = platform::hardware();
    out.vendor = hw.vendor;
    out.model = hw.model;
    out.serial = hw.serial;
    for i in out.interfaces.iter_mut() {
        i.addresses.sort_by_key(|a| (a.ip.contains(':'), a.temporary));
        i.addresses.dedup();
    }
    out.interfaces.sort_by(|a, b| a.name.cmp(&b.name));
    let mut seen = std::collections::HashSet::new();
    out.dns.retain(|d| seen.insert(d.clone()));
    Ok(out)
}

// ---- Text parsers (every platform; tested below) ----

/// A MAC from its bytes, "" when it is all zero or not six bytes.
pub fn mac_text(bytes: &[u8]) -> String {
    if bytes.len() != 6 || bytes.iter().all(|b| *b == 0) {
        return String::new();
    }
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

/// /sys/class/net/<if>/address ("aa:bb:cc:dd:ee:ff\n") as AA:BB:CC:DD:EE:FF.
pub fn mac_from_sys(text: &str) -> String {
    let bytes: Vec<u8> = text
        .trim()
        .split(':')
        .filter_map(|h| u8::from_str_radix(h, 16).ok())
        .collect();
    if text.trim().split(':').count() != bytes.len() {
        return String::new();
    }
    mac_text(&bytes)
}

/// The prefix length of a netmask given as bytes (255.255.255.0 -> 24).
/// None when the ones are not contiguous.
pub fn prefix_of_mask(mask: &[u8]) -> Option<u8> {
    let mut n: u32 = 0;
    let mut ended = false;
    for b in mask {
        for bit in (0..8).rev() {
            let on = (b >> bit) & 1 == 1;
            if on && ended {
                return None;
            }
            if on {
                n += 1;
            } else {
                ended = true;
            }
        }
    }
    u8::try_from(n).ok()
}

/// The DNS servers of a resolv.conf: its `nameserver` lines, in order.
pub fn parse_resolv_conf(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.split(['#', ';']).next().unwrap_or("").trim();
        let mut words = line.split_whitespace();
        if words.next() != Some("nameserver") {
            continue;
        }
        if let Some(addr) = words.next() {
            // "fe80::1%eth0": the zone stays out of the address.
            let bare = addr.split('%').next().unwrap_or("");
            if bare.parse::<std::net::IpAddr>().is_ok() {
                out.push(bare.to_string());
            }
        }
    }
    out
}

/// Only systemd-resolved's stub (127.0.0.53, 127.0.0.54) is listed.
pub fn only_resolved_stub(servers: &[String]) -> bool {
    !servers.is_empty() && servers.iter().all(|s| is_resolved_stub(s))
}

fn is_resolved_stub(s: &str) -> bool {
    s == "127.0.0.53" || s == "127.0.0.54"
}

/// The DNS servers this PC asks (Linux, D210): resolv.conf's, with
/// systemd-resolved's stub replaced by resolved's own list. The stub itself
/// is never given as the PC's DNS server, even when that list cannot be read.
pub fn linux_dns(resolv: &str, resolved: Option<&str>) -> Vec<String> {
    let mut dns = parse_resolv_conf(resolv);
    if only_resolved_stub(&dns) {
        if let Some(t) = resolved {
            let real = parse_resolv_conf(t);
            if !real.is_empty() {
                dns = real;
            }
        }
    }
    dns.retain(|s| !is_resolved_stub(s));
    dns
}

/// A DNS server worth naming (D210): not loopback or unspecified, and not
/// one of the fec0:0:0:ffff::1/2/3 placeholders Windows lists on adapters
/// that have no IPv6 DNS server of their own.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn real_dns_server(ip: &std::net::IpAddr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return false;
    }
    if let std::net::IpAddr::V6(v6) = ip {
        let s = v6.segments();
        if s[..7] == [0xfec0, 0, 0, 0xffff, 0, 0, 0] && (1..=3).contains(&s[7]) {
            return false;
        }
    }
    true
}

/// NL_SUFFIX_ORIGIN (Windows nldef.h): Other 0, Manual 1, WellKnown 2,
/// Dhcp 3, LinkLayerAddress 4, Random 5. Only Random is a temporary
/// privacy address; a DHCPv6 one (3) is stable.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const NLSO_RANDOM: i32 = 5;

/// Windows: an IPv6 address is temporary when its suffix is random.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn windows_temporary(is_ipv6: bool, suffix_origin: i32) -> bool {
    is_ipv6 && suffix_origin == NLSO_RANDOM
}

/// Linux: an address under a label ("eth0:1", `ip addr add ... label
/// eth0:1`) belongs to the card before the colon (D211).
pub fn base_iface_name(name: &str) -> &str {
    name.split(':').next().unwrap_or(name)
}

/// What `ifconfig -a` says of one interface (macOS): its media status
/// (`status: active` / `inactive`, None when it prints none) and its
/// temporary IPv6 addresses.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct IfconfigFacts {
    pub active: Option<bool>,
    pub temporary: Vec<String>,
}

/// `ifconfig -a` (macOS), by interface (D209).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_ifconfig(text: &str) -> std::collections::BTreeMap<String, IfconfigFacts> {
    let mut out: std::collections::BTreeMap<String, IfconfigFacts> = std::collections::BTreeMap::new();
    let mut cur: Option<String> = None;
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        if !line.starts_with([' ', '\t']) {
            // "en0: flags=8863<UP,...> mtu 1500"
            cur = line.split_once(':').map(|(n, _)| n.trim().to_string()).filter(|n| !n.is_empty());
            if let Some(n) = &cur {
                out.entry(n.clone()).or_default();
            }
            continue;
        }
        let Some(name) = &cur else { continue };
        let words: Vec<&str> = line.split_whitespace().collect();
        let facts = out.entry(name.clone()).or_default();
        match words.first().copied() {
            Some("status:") => facts.active = words.get(1).map(|w| *w == "active"),
            Some("inet6") if words.contains(&"temporary") => {
                let bare = words.get(1).and_then(|a| a.split('%').next()).unwrap_or("");
                if let Ok(ip) = bare.parse::<std::net::Ipv6Addr>() {
                    facts.temporary.push(ip.to_string());
                }
            }
            _ => {}
        }
    }
    out
}

/// The Wi-Fi devices of `networksetup -listallhardwareports` (macOS):
/// the "Device:" after a "Hardware Port: Wi-Fi" (or the older "AirPort").
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_hardware_ports(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut wifi = false;
    for line in text.lines() {
        let line = line.trim();
        if let Some(port) = line.strip_prefix("Hardware Port:") {
            let port = port.trim();
            wifi = port == "Wi-Fi" || port == "AirPort";
        } else if let Some(dev) = line.strip_prefix("Device:") {
            if wifi && !dev.trim().is_empty() {
                out.push(dev.trim().to_string());
            }
            wifi = false;
        }
    }
    out
}

/// The IPv4 default gateways of /proc/net/route: destination and mask
/// 0.0.0.0, the gateway flag (0x2) set. The addresses are little-endian hex.
pub fn parse_proc_route(text: &str) -> Vec<Gateway> {
    let mut out = Vec::new();
    for line in text.lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 8 {
            continue;
        }
        let (iface, dest, gw, flags, mask) = (f[0], f[1], f[2], f[3], f[7]);
        let flags = u32::from_str_radix(flags, 16).unwrap_or(0);
        if dest != "00000000" || mask != "00000000" || flags & 0x2 == 0 || flags & 0x1 == 0 {
            continue;
        }
        let Ok(g) = u32::from_str_radix(gw, 16) else { continue };
        if g == 0 {
            continue;
        }
        let ip = std::net::Ipv4Addr::from(g.to_le_bytes());
        out.push(Gateway { ip: ip.to_string(), iface: iface.to_string() });
    }
    out
}

fn hex16(s: &str) -> Option<[u8; 16]> {
    if s.len() != 32 {
        return None;
    }
    let mut b = [0u8; 16];
    for (i, out) in b.iter_mut().enumerate() {
        *out = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(b)
}

/// The IPv6 default gateways of /proc/net/ipv6_route: destination ::/0 with
/// a next hop that is not ::.
pub fn parse_ipv6_route(text: &str) -> Vec<Gateway> {
    let mut out = Vec::new();
    for line in text.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 10 {
            continue;
        }
        let (Some(dest), Some(hop)) = (hex16(f[0]), hex16(f[4])) else { continue };
        if dest != [0u8; 16] || f[1] != "00" || hop == [0u8; 16] {
            continue;
        }
        let flags = u32::from_str_radix(f[8], 16).unwrap_or(0);
        // RTF_UP (0x1), and not a rejected route (RTF_REJECT 0x200).
        if flags & 0x1 == 0 || flags & 0x200 != 0 {
            continue;
        }
        let g = Gateway { ip: std::net::Ipv6Addr::from(hop).to_string(), iface: f[9].to_string() };
        if !out.contains(&g) {
            out.push(g);
        }
    }
    out
}

/// One line of /proc/net/if_inet6: (interface, address with prefix and
/// whether it is temporary). Deprecated and tentative addresses are left out.
pub fn parse_if_inet6(text: &str) -> Vec<(String, Addr)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 6 {
            continue;
        }
        let Some(bytes) = hex16(f[0]) else { continue };
        let Ok(prefix) = u8::from_str_radix(f[2], 16) else { continue };
        let flags = u32::from_str_radix(f[4], 16).unwrap_or(0);
        // IFA_F_TEMPORARY 0x01, IFA_F_TENTATIVE 0x40, IFA_F_DEPRECATED 0x20.
        if flags & 0x60 != 0 {
            continue;
        }
        out.push((
            f[5].to_string(),
            Addr { ip: std::net::Ipv6Addr::from(bytes).to_string(), prefix, temporary: flags & 0x01 != 0 },
        ));
    }
    out
}

/// The DNS servers of `scutil --dns` (macOS): the "nameserver[n] : x" lines
/// of its resolvers, the first resolver's first.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_scutil_dns(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("nameserver[") {
            continue;
        }
        if let Some((_, v)) = line.split_once(':') {
            let v = v.trim().split('%').next().unwrap_or("").to_string();
            if v.parse::<std::net::IpAddr>().is_ok() && !out.contains(&v) {
                out.push(v);
            }
        }
    }
    out
}

/// The default gateway of `route -n get default` (macOS).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_route_get(text: &str) -> Option<Gateway> {
    let mut ip = String::new();
    let mut iface = String::new();
    for line in text.lines() {
        if let Some((k, v)) = line.trim().split_once(':') {
            match k.trim() {
                "gateway" => ip = v.trim().split('%').next().unwrap_or("").to_string(),
                "interface" => iface = v.trim().to_string(),
                _ => {}
            }
        }
    }
    if ip.parse::<std::net::IpAddr>().is_ok() {
        Some(Gateway { ip, iface })
    } else {
        None
    }
}

/// PRETTY_NAME of /etc/os-release ("Fedora Linux 44 (Workstation Edition)").
pub fn parse_os_release(text: &str) -> Option<String> {
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("PRETTY_NAME=") {
            let v = v.trim().trim_matches('"').trim_matches('\'').trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

// ---- getifaddrs (Linux and macOS) ----

#[cfg(unix)]
mod ifaddrs {
    use super::{prefix_of_mask, Addr};
    use std::collections::BTreeMap;
    use std::ffi::CStr;

    #[derive(Default, Debug)]
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub struct Entry {
        pub up: bool,
        pub loopback: bool,
        pub addresses: Vec<Addr>,
        /// macOS: the MAC and the MTU from the link entry.
        pub mac: String,
        pub mtu: Option<u32>,
    }

    fn mask_bytes(sa: *const libc::sockaddr, len: usize, off: usize) -> Option<Vec<u8>> {
        if sa.is_null() {
            return None;
        }
        // SAFETY: getifaddrs gives a netmask of the address's own family.
        let p = sa as *const u8;
        Some((0..len).map(|i| unsafe { *p.add(off + i) }).collect())
    }

    /// Switched on and with a link (D209): IFF_UP and IFF_RUNNING. Linux sets
    /// IFF_RUNNING only when the card's operational state is up (a cable
    /// plugged in, Wi-Fi joined), so NetworkManager's unplugged cards, which
    /// it keeps IFF_UP, are not connected.
    pub fn connected(flags: libc::c_uint) -> bool {
        let need = (libc::IFF_UP | libc::IFF_RUNNING) as libc::c_uint;
        flags & need == need
    }

    /// Every interface getifaddrs lists, by name.
    pub fn list() -> Result<BTreeMap<String, Entry>, String> {
        let mut out: BTreeMap<String, Entry> = BTreeMap::new();
        let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
        // SAFETY: getifaddrs fills `head` with a list freed by freeifaddrs.
        if unsafe { libc::getifaddrs(&mut head) } != 0 {
            return Err(format!("getifaddrs: {}", std::io::Error::last_os_error()));
        }
        let mut cur = head;
        while !cur.is_null() {
            // SAFETY: `cur` is an element of the list getifaddrs made.
            let ifa = unsafe { &*cur };
            cur = ifa.ifa_next;
            if ifa.ifa_name.is_null() {
                continue;
            }
            let name = unsafe { CStr::from_ptr(ifa.ifa_name) }.to_string_lossy().into_owned();
            // Linux lists a labelled address ("eth0:1") under its label.
            #[cfg(target_os = "linux")]
            let name = super::base_iface_name(&name).to_string();
            let e = out.entry(name).or_default();
            e.up |= connected(ifa.ifa_flags as libc::c_uint);
            e.loopback |= ifa.ifa_flags & (libc::IFF_LOOPBACK as libc::c_uint) != 0;
            if ifa.ifa_addr.is_null() {
                continue;
            }
            let family = i32::from(unsafe { (*ifa.ifa_addr).sa_family });
            if family == libc::AF_INET {
                let sin = unsafe { &*(ifa.ifa_addr as *const libc::sockaddr_in) };
                let ip = std::net::Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr));
                let off = std::mem::offset_of!(libc::sockaddr_in, sin_addr);
                let prefix = mask_bytes(ifa.ifa_netmask, 4, off).and_then(|m| prefix_of_mask(&m)).unwrap_or(32);
                e.addresses.push(Addr { ip: ip.to_string(), prefix, temporary: false });
            } else if family == libc::AF_INET6 {
                let sin6 = unsafe { &*(ifa.ifa_addr as *const libc::sockaddr_in6) };
                let ip = std::net::Ipv6Addr::from(sin6.sin6_addr.s6_addr);
                let off = std::mem::offset_of!(libc::sockaddr_in6, sin6_addr);
                let prefix = mask_bytes(ifa.ifa_netmask, 16, off).and_then(|m| prefix_of_mask(&m)).unwrap_or(128);
                e.addresses.push(Addr { ip: ip.to_string(), prefix, temporary: false });
            }
            #[cfg(target_os = "macos")]
            if family == libc::AF_LINK {
                let dl = unsafe { &*(ifa.ifa_addr as *const libc::sockaddr_dl) };
                let start = dl.sdl_nlen as usize;
                let n = dl.sdl_alen as usize;
                if n == 6 {
                    let base = dl.sdl_data.as_ptr() as *const u8;
                    // SAFETY: sdl_data runs on past its declared 12 bytes
                    // for sdl_len bytes; the name then the address.
                    let bytes: Vec<u8> = (0..6).map(|i| unsafe { *base.add(start + i) }).collect();
                    e.mac = super::mac_text(&bytes);
                }
                if !ifa.ifa_data.is_null() {
                    // struct if_data: eight one-byte fields, then ifi_mtu.
                    let p = ifa.ifa_data as *const u8;
                    e.mtu = Some(unsafe { std::ptr::read_unaligned(p.add(8) as *const u32) });
                }
            }
        }
        // SAFETY: the list getifaddrs made, freed once.
        unsafe { libc::freeifaddrs(head) };
        Ok(out)
    }

    /// This PC's name.
    pub fn hostname() -> String {
        let mut buf = [0u8; 256];
        // SAFETY: a buffer of its stated length.
        if unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) } != 0 {
            return String::new();
        }
        let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[..end]).into_owned()
    }
}

// ---- Linux ----

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::fs;
    use std::path::Path;

    pub fn read() -> Result<ThisComputer, String> {
        let list = ifaddrs::list()?;
        let v6 = fs::read_to_string("/proc/net/if_inet6").map(|t| parse_if_inet6(&t)).ok();
        let mut interfaces = Vec::new();
        for (name, e) in list {
            let sys = Path::new("/sys/class/net").join(&name);
            let read = |f: &str| fs::read_to_string(sys.join(f)).unwrap_or_default();
            let mut addresses: Vec<Addr> = e.addresses.into_iter().filter(|a| !a.ip.contains(':') || v6.is_none()).collect();
            if let Some(v6) = &v6 {
                addresses.extend(v6.iter().filter(|(n, _)| *n == name).map(|(_, a)| a.clone()));
            }
            interfaces.push(Iface {
                label: String::new(),
                mac: mac_from_sys(&read("address")),
                mtu: read("mtu").trim().parse().ok(),
                up: e.up,
                loopback: e.loopback,
                // A card has a device behind it; bridges, veth and tunnels do not.
                physical: sys.join("device").exists(),
                wireless: sys.join("wireless").exists() || sys.join("phy80211").exists(),
                addresses,
                name,
            });
        }
        let mut gateways = fs::read_to_string("/proc/net/route").map(|t| parse_proc_route(&t)).unwrap_or_default();
        gateways.extend(fs::read_to_string("/proc/net/ipv6_route").map(|t| parse_ipv6_route(&t)).unwrap_or_default());
        // systemd-resolved: the servers it asks are in its own file.
        let resolved = fs::read_to_string("/run/systemd/resolve/resolv.conf").ok();
        let dns = linux_dns(&fs::read_to_string("/etc/resolv.conf").unwrap_or_default(), resolved.as_deref());
        let os = fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|t| parse_os_release(&t))
            .unwrap_or_else(|| "Linux".to_string());
        Ok(ThisComputer { hostname: ifaddrs::hostname(), os, platform: String::new(), interfaces, gateways, dns, ..Default::default() })
    }

    /// /sys/class/dmi/id; the serials need an administrator, so are as a
    /// rule unreadable and left blank.
    pub fn hardware() -> Hardware {
        let dmi = |f: &str| fs::read_to_string(Path::new("/sys/class/dmi/id").join(f)).unwrap_or_default();
        pick_hardware(&dmi("sys_vendor"), &dmi("product_name"), &dmi("product_version"), &dmi("board_vendor"), &dmi("board_name"),
            &[&dmi("product_serial"), &dmi("board_serial")])
    }
}

// ---- macOS ----

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::process::Command;

    fn run(cmd: &str, args: &[&str]) -> String {
        Command::new(cmd)
            .args(args)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default()
    }

    pub fn read() -> Result<ThisComputer, String> {
        let list = ifaddrs::list()?;
        // The media status and the temporary IPv6 addresses (getifaddrs
        // says neither), and which cards are Wi-Fi (D209).
        let facts = parse_ifconfig(&run("/sbin/ifconfig", &["-a"]));
        let wifi = parse_hardware_ports(&run("/usr/sbin/networksetup", &["-listallhardwareports"]));
        let mut interfaces = Vec::new();
        for (name, mut e) in list {
            let f = facts.get(&name).cloned().unwrap_or_default();
            for a in e.addresses.iter_mut() {
                a.temporary = a.ip.contains(':') && f.temporary.contains(&a.ip);
            }
            // en* are the cards (Ethernet and Wi-Fi); utun, bridge, awdl,
            // llw, gif, stf, anpi and ap are the system's own links.
            let physical = name.starts_with("en") && !e.loopback;
            interfaces.push(Iface {
                label: String::new(),
                mac: e.mac,
                mtu: e.mtu,
                // An unused port or Wi-Fi not joined says "status: inactive".
                up: e.up && f.active != Some(false),
                loopback: e.loopback,
                physical,
                wireless: wifi.contains(&name),
                addresses: e.addresses,
                name,
            });
        }
        let mut gateways: Vec<Gateway> = parse_route_get(&run("/sbin/route", &["-n", "get", "default"])).into_iter().collect();
        if let Some(g6) = parse_route_get(&run("/sbin/route", &["-n", "get", "-inet6", "default"])) {
            gateways.push(g6);
        }
        let dns = parse_scutil_dns(&run("/usr/sbin/scutil", &["--dns"]));
        let ver = run("/usr/bin/sw_vers", &["-productVersion"]);
        let os = if ver.trim().is_empty() { "macOS".to_string() } else { format!("macOS {}", ver.trim()) };
        Ok(ThisComputer { hostname: ifaddrs::hostname(), os, platform: String::new(), interfaces, gateways, dns, ..Default::default() })
    }

    pub fn hardware() -> Hardware {
        parse_system_profiler(&run("/usr/sbin/system_profiler", &["SPHardwareDataType"]))
    }
}

// ---- Windows: GetAdaptersAddresses ----
// Declared here (no crate): the structures as iphlpapi.h lays them out, up
// to the last field read. Built and run only on Windows (D204).

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::ffi::c_void;

    #[repr(C)]
    struct SocketAddress {
        sockaddr: *const u8,
        len: i32,
    }
    #[repr(C)]
    struct Unicast {
        alignment: u64,
        next: *const Unicast,
        address: SocketAddress,
        prefix_origin: i32,
        suffix_origin: i32,
        dad_state: i32,
        valid_lifetime: u32,
        preferred_lifetime: u32,
        lease_lifetime: u32,
        on_link_prefix_length: u8,
    }
    /// IP_ADAPTER_DNS_SERVER_ADDRESS and IP_ADAPTER_GATEWAY_ADDRESS.
    #[repr(C)]
    struct Listed {
        alignment: u64,
        next: *const Listed,
        address: SocketAddress,
    }
    #[repr(C)]
    struct Adapter {
        alignment: u64,
        next: *const Adapter,
        adapter_name: *const u8,
        first_unicast: *const Unicast,
        first_anycast: *const c_void,
        first_multicast: *const c_void,
        first_dns: *const Listed,
        dns_suffix: *const u16,
        description: *const u16,
        friendly_name: *const u16,
        physical_address: [u8; 8],
        physical_address_length: u32,
        flags: u32,
        mtu: u32,
        if_type: u32,
        oper_status: i32,
        ipv6_if_index: u32,
        zone_indices: [u32; 16],
        first_prefix: *const c_void,
        transmit_link_speed: u64,
        receive_link_speed: u64,
        first_wins: *const c_void,
        first_gateway: *const Listed,
    }

    #[link(name = "iphlpapi")]
    extern "system" {
        fn GetAdaptersAddresses(family: u32, flags: u32, reserved: *const c_void, addresses: *mut Adapter, size: *mut u32) -> u32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemFirmwareTable(provider: u32, id: u32, buffer: *mut c_void, size: u32) -> u32;
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(key: isize, subkey: *const u16, value: *const u16, flags: u32, kind: *mut u32, data: *mut c_void, size: *mut u32) -> i32;
    }
    const HKEY_LOCAL_MACHINE: isize = 0x8000_0002u32 as i32 as isize;
    const RRF_RT_REG_SZ: u32 = 0x2;
    const RSMB: u32 = 0x5253_4D42;

    fn wz(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    /// A string value under HKEY_LOCAL_MACHINE, "" when it is not there.
    fn reg_text(subkey: &str, value: &str) -> String {
        let (k, v) = (wz(subkey), wz(value));
        let mut buf = vec![0u16; 256];
        let mut size = (buf.len() * 2) as u32;
        // SAFETY: the buffer and its size in bytes, as RegGetValueW takes them.
        let r = unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, k.as_ptr(), v.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr() as *mut c_void, &mut size) };
        if r != 0 {
            return String::new();
        }
        let n = (size as usize / 2).min(buf.len());
        let end = buf[..n].iter().position(|&c| c == 0).unwrap_or(n);
        String::from_utf16_lossy(&buf[..end])
    }
    fn os_name() -> String {
        let k = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        windows_os_name(&reg_text(k, "ProductName"), &reg_text(k, "DisplayVersion"), &reg_text(k, "CurrentBuild"))
    }

    /// The SMBIOS table: RawSMBIOSData's 8-byte header, then the records.
    pub fn hardware() -> Hardware {
        // SAFETY: a null buffer asks for the size.
        let size = unsafe { GetSystemFirmwareTable(RSMB, 0, std::ptr::null_mut(), 0) };
        if size < 8 {
            return Hardware::default();
        }
        let mut buf = vec![0u8; size as usize];
        let got = unsafe { GetSystemFirmwareTable(RSMB, 0, buf.as_mut_ptr() as *mut c_void, size) };
        if got < 8 || got > size {
            return Hardware::default();
        }
        let len = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]) as usize;
        let end = (8 + len).min(got as usize);
        parse_smbios(&buf[8..end])
    }

    const AF_UNSPEC: u32 = 0;
    const AF_INET: u16 = 2;
    const AF_INET6: u16 = 23;
    const GAA_FLAG_SKIP_ANYCAST: u32 = 0x2;
    const GAA_FLAG_SKIP_MULTICAST: u32 = 0x4;
    const GAA_FLAG_INCLUDE_GATEWAYS: u32 = 0x80;
    const ERROR_BUFFER_OVERFLOW: u32 = 111;
    const IF_TYPE_ETHERNET: u32 = 6;
    const IF_TYPE_LOOPBACK: u32 = 24;
    const IF_TYPE_WIFI: u32 = 71;
    const OPER_UP: i32 = 1;

    fn wide(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut n = 0;
        // SAFETY: a NUL-terminated wide string from the adapter list.
        while unsafe { *p.add(n) } != 0 && n < 1024 {
            n += 1;
        }
        String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(p, n) })
    }
    fn narrow(p: *const u8) -> String {
        if p.is_null() {
            return String::new();
        }
        unsafe { std::ffi::CStr::from_ptr(p as *const std::ffi::c_char) }.to_string_lossy().into_owned()
    }
    /// A SOCKET_ADDRESS as an address, None for another family.
    fn ip_of(a: &SocketAddress) -> Option<std::net::IpAddr> {
        if a.sockaddr.is_null() {
            return None;
        }
        // SAFETY: the address's own length, as the list gives it.
        let bytes = unsafe { std::slice::from_raw_parts(a.sockaddr, a.len.max(0) as usize) };
        if bytes.len() < 2 {
            return None;
        }
        let family = u16::from_le_bytes([bytes[0], bytes[1]]);
        if family == AF_INET && bytes.len() >= 8 {
            Some(std::net::IpAddr::from([bytes[4], bytes[5], bytes[6], bytes[7]]))
        } else if family == AF_INET6 && bytes.len() >= 24 {
            let mut b = [0u8; 16];
            b.copy_from_slice(&bytes[8..24]);
            Some(std::net::IpAddr::from(b))
        } else {
            None
        }
    }

    pub fn read() -> Result<ThisComputer, String> {
        let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_INCLUDE_GATEWAYS;
        let mut size: u32 = 16 * 1024;
        let mut buf: Vec<u64> = Vec::new();
        let mut ok = false;
        for _ in 0..4 {
            buf = vec![0u64; (size as usize).div_ceil(8)];
            let r = unsafe { GetAdaptersAddresses(AF_UNSPEC, flags, std::ptr::null(), buf.as_mut_ptr() as *mut Adapter, &mut size) };
            if r == 0 {
                ok = true;
                break;
            }
            if r != ERROR_BUFFER_OVERFLOW {
                return Err(format!("GetAdaptersAddresses: {r}"));
            }
        }
        if !ok {
            return Err("GetAdaptersAddresses: the list kept growing".into());
        }
        let mut interfaces = Vec::new();
        let mut gateways = Vec::new();
        let mut dns: Vec<String> = Vec::new();
        let mut dns_cards: Vec<String> = Vec::new();
        let mut cur = buf.as_ptr() as *const Adapter;
        while !cur.is_null() {
            // SAFETY: an element of the list GetAdaptersAddresses wrote.
            let a = unsafe { &*cur };
            cur = a.next;
            let label = wide(a.friendly_name);
            let mut addresses = Vec::new();
            let mut u = a.first_unicast;
            while !u.is_null() {
                let ua = unsafe { &*u };
                u = ua.next;
                if let Some(ip) = ip_of(&ua.address) {
                    addresses.push(Addr { ip: ip.to_string(), prefix: ua.on_link_prefix_length, temporary: windows_temporary(ip.is_ipv6(), ua.suffix_origin) });
                }
            }
            let up = a.oper_status == OPER_UP;
            // Hyper-V's switches are Ethernet too, named vEthernet.
            let physical = (a.if_type == IF_TYPE_ETHERNET || a.if_type == IF_TYPE_WIFI) && !label.starts_with("vEthernet");
            if up {
                let mut d = a.first_dns;
                while !d.is_null() {
                    let da = unsafe { &*d };
                    d = da.next;
                    if let Some(ip) = ip_of(&da.address) {
                        if real_dns_server(&ip) {
                            // The cards' servers first, then other adapters' (D210).
                            if physical { dns_cards.push(ip.to_string()) } else { dns.push(ip.to_string()) }
                        }
                    }
                }
                let mut g = a.first_gateway;
                while !g.is_null() {
                    let ga = unsafe { &*g };
                    g = ga.next;
                    if let Some(ip) = ip_of(&ga.address) {
                        if !ip.is_unspecified() {
                            gateways.push(Gateway { ip: ip.to_string(), iface: label.clone() });
                        }
                    }
                }
            }
            let mac_len = (a.physical_address_length as usize).min(8);
            interfaces.push(Iface {
                name: narrow(a.adapter_name),
                mac: mac_text(&a.physical_address[..mac_len]),
                mtu: if a.mtu == u32::MAX { None } else { Some(a.mtu) },
                up,
                loopback: a.if_type == IF_TYPE_LOOPBACK,
                physical,
                wireless: a.if_type == IF_TYPE_WIFI,
                addresses,
                label,
            });
        }
        // A card's DNS servers, else (a VPN only, say) the other adapters'.
        let dns = if dns_cards.is_empty() { dns } else { dns_cards };
        let host = std::env::var("COMPUTERNAME").unwrap_or_default();
        Ok(ThisComputer { hostname: host, os: os_name(), platform: String::new(), interfaces, gateways, dns, ..Default::default() })
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;
    pub fn read() -> Result<ThisComputer, String> {
        Err("unsupported".into())
    }
    pub fn hardware() -> Hardware {
        Hardware::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macs() {
        assert_eq!(mac_text(&[0x3c, 0xa9, 0xf4, 0, 0x33, 1]), "3C:A9:F4:00:33:01");
        assert_eq!(mac_text(&[0; 6]), "");
        assert_eq!(mac_text(&[1, 2, 3]), "");
        assert_eq!(mac_from_sys("d0:67:e5:10:20:01\n"), "D0:67:E5:10:20:01");
        assert_eq!(mac_from_sys("00:00:00:00:00:00\n"), "");
        assert_eq!(mac_from_sys(""), "");
        // An InfiniBand address (20 bytes) is not a MAC.
        assert_eq!(mac_from_sys("80:00:02:08:fe:80:00:00:00:00:00:00:00:02:c9:03:00:0f:bb:01"), "");
    }

    #[test]
    fn masks() {
        assert_eq!(prefix_of_mask(&[255, 255, 255, 0]), Some(24));
        assert_eq!(prefix_of_mask(&[255, 255, 252, 0]), Some(22));
        assert_eq!(prefix_of_mask(&[0, 0, 0, 0]), Some(0));
        assert_eq!(prefix_of_mask(&[255, 0, 255, 0]), None);
        let mut v6 = [0u8; 16];
        v6[..8].fill(255);
        assert_eq!(prefix_of_mask(&v6), Some(64));
    }

    #[test]
    fn resolv_conf() {
        let t = "# Generated by NetworkManager\nsearch lan\nnameserver 192.168.1.1\nnameserver  fe80::1%wlp3s0 \n;nameserver 9.9.9.9\nnameserver bogus\noptions edns0\nnameserver 2001:db8::53 # comment\n";
        assert_eq!(parse_resolv_conf(t), vec!["192.168.1.1", "fe80::1", "2001:db8::53"]);
        assert!(only_resolved_stub(&parse_resolv_conf("nameserver 127.0.0.53\noptions edns0 trust-ad\n")));
        assert!(!only_resolved_stub(&parse_resolv_conf("nameserver 127.0.0.53\nnameserver 1.1.1.1\n")));
        assert!(!only_resolved_stub(&[]));
    }

    #[test]
    fn dns_never_the_stub() {
        let stub = "nameserver 127.0.0.53\noptions edns0 trust-ad\n";
        assert_eq!(linux_dns(stub, Some("nameserver 192.168.1.1\nnameserver 1.1.1.1\n")), vec!["192.168.1.1", "1.1.1.1"]);
        // resolved's list missing or empty: no DNS server, never the stub.
        assert!(linux_dns(stub, None).is_empty());
        assert!(linux_dns(stub, Some("# nothing\n")).is_empty());
        assert_eq!(linux_dns("nameserver 127.0.0.53\nnameserver 9.9.9.9\n", None), vec!["9.9.9.9"]);
        assert_eq!(linux_dns("nameserver 10.0.0.1\n", Some("nameserver 1.1.1.1\n")), vec!["10.0.0.1"]);
        let ip = |s: &str| s.parse::<std::net::IpAddr>().unwrap();
        for s in ["fec0:0:0:ffff::1", "fec0:0:0:ffff::2", "fec0:0:0:ffff::3", "127.0.0.1", "::1", "0.0.0.0"] {
            assert!(!real_dns_server(&ip(s)), "{s}");
        }
        for s in ["192.168.1.1", "2001:db8::53", "fec0:0:0:ffff::4", "fe80::1"] {
            assert!(real_dns_server(&ip(s)), "{s}");
        }
    }

    #[test]
    fn windows_suffix_origin() {
        // nldef.h: NlsoDhcp = 3, NlsoLinkLayerAddress = 4, NlsoRandom = 5.
        assert_eq!(NLSO_RANDOM, 5);
        assert!(windows_temporary(true, 5));
        assert!(!windows_temporary(true, 3), "a DHCPv6 address is stable");
        assert!(!windows_temporary(true, 4));
        assert!(!windows_temporary(true, 1));
        assert!(!windows_temporary(false, 5));
    }

    #[test]
    fn labels() {
        assert_eq!(base_iface_name("eth0:1"), "eth0");
        assert_eq!(base_iface_name("enp3s0"), "enp3s0");
        assert_eq!(base_iface_name("br-lan:backup"), "br-lan");
    }

    #[cfg(unix)]
    #[test]
    fn connected_flags() {
        let f = |x: libc::c_int| x as libc::c_uint;
        // <NO-CARRIER,BROADCAST,MULTICAST,UP>: switched on, not connected.
        assert!(!ifaddrs::connected(f(libc::IFF_UP | libc::IFF_BROADCAST | libc::IFF_MULTICAST)));
        assert!(ifaddrs::connected(f(libc::IFF_UP | libc::IFF_RUNNING | libc::IFF_BROADCAST)));
        assert!(!ifaddrs::connected(f(libc::IFF_RUNNING)));
        assert!(!ifaddrs::connected(0));
    }

    #[test]
    fn macos_ifconfig() {
        let t = "lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384\n\
                 \tinet 127.0.0.1 netmask 0xff000000\n\
                 en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500\n\
                 \tether 3c:a9:f4:00:33:01\n\
                 \tinet6 fe80::1c2b:3d4e:5f60:7182%en0 prefixlen 64 secured scopeid 0x6\n\
                 \tinet 192.168.1.20 netmask 0xffffff00 broadcast 192.168.1.255\n\
                 \tinet6 2001:db8:0:1:0:0:0:5 prefixlen 64 autoconf secured\n\
                 \tinet6 2001:db8:0:1:a1b2:c3d4:e5f6:718 prefixlen 64 autoconf temporary\n\
                 \tmedia: autoselect\n\
                 \tstatus: active\n\
                 en1: flags=8963<UP,BROADCAST,SMART,RUNNING,PROMISC,SIMPLEX,MULTICAST> mtu 1500\n\
                 \tmedia: autoselect <full-duplex>\n\
                 \tstatus: inactive\n";
        let r = parse_ifconfig(t);
        assert_eq!(r["lo0"].active, None);
        assert_eq!(r["en0"].active, Some(true));
        assert_eq!(r["en0"].temporary, vec!["2001:db8:0:1:a1b2:c3d4:e5f6:718".to_string()]);
        assert_eq!(r["en1"], IfconfigFacts { active: Some(false), temporary: vec![] });
        let ports = "\nHardware Port: Ethernet\nDevice: en0\nEthernet Address: 3c:a9:f4:00:33:01\n\n\
                     Hardware Port: Wi-Fi\nDevice: en1\nEthernet Address: 70:9c:d1:22:44:66\n\n\
                     Hardware Port: Thunderbolt Bridge\nDevice: bridge0\nEthernet Address: N/A\n";
        assert_eq!(parse_hardware_ports(ports), vec!["en1"]);
    }

    #[test]
    fn proc_route() {
        let t = "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n\
                 wlp3s0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0\n\
                 wlp3s0\t0001A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0\n\
                 docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n\
                 tun0\t00000000\t00000000\t0001\t0\t0\t50\t00000000\t0\t0\t0\n";
        assert_eq!(parse_proc_route(t), vec![Gateway { ip: "192.168.1.1".into(), iface: "wlp3s0".into() }]);
        assert!(parse_proc_route("Iface\tDestination\n").is_empty());
    }

    #[test]
    fn ipv6_route() {
        let t = "00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe80000000000000021122fffe334455 00000400 00000001 00000000 00000003 wlp3s0\n\
                 20010db8000000000000000000000000 40 00000000000000000000000000000000 00 00000000000000000000000000000000 00000100 00000001 00000000 00000001 wlp3s0\n\
                 00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 ffffffff 00000001 00000000 00200200 lo\n";
        assert_eq!(parse_ipv6_route(t), vec![Gateway { ip: "fe80::211:22ff:fe33:4455".into(), iface: "wlp3s0".into() }]);
    }

    #[test]
    fn if_inet6() {
        let t = "00000000000000000000000000000001 01 80 10 80       lo\n\
                 20010db8000000010000000000000005 03 40 00 00   wlp3s0\n\
                 20010db800000001a1b2c3d4e5f60718 03 40 00 01   wlp3s0\n\
                 20010db800000001000000000000dead 03 40 00 20   wlp3s0\n\
                 fe800000000000000211 03 40 20 80 broken\n";
        let r = parse_if_inet6(t);
        assert_eq!(r.len(), 3);
        assert_eq!(r[0], ("lo".to_string(), Addr { ip: "::1".into(), prefix: 128, temporary: false }));
        assert_eq!(r[1], ("wlp3s0".to_string(), Addr { ip: "2001:db8:0:1::5".into(), prefix: 64, temporary: false }));
        assert!(r[2].1.temporary, "the privacy address is marked temporary");
    }

    #[test]
    fn macos_text() {
        let dns = "DNS configuration\n\nresolver #1\n  search domain[0] : lan\n  nameserver[0] : 192.168.1.1\n  nameserver[1] : fe80::1%en0\n  if_index : 6 (en0)\n\nresolver #2\n  domain   : local\n  nameserver[0] : 192.168.1.1\n  options  : mdns\n";
        assert_eq!(parse_scutil_dns(dns), vec!["192.168.1.1", "fe80::1"]);
        let route = "   route to: default\ndestination: default\n       mask: default\n    gateway: 10.0.0.1\n  interface: en0\n      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING>\n";
        assert_eq!(parse_route_get(route), Some(Gateway { ip: "10.0.0.1".into(), iface: "en0".into() }));
        assert_eq!(parse_route_get("route: writing to routing socket: not in table\n"), None);
    }

    #[test]
    fn hardware_names() {
        assert_eq!(clean_hw("To Be Filled By O.E.M."), "");
        assert_eq!(clean_hw("System Product Name\n"), "");
        assert_eq!(clean_hw("0000000000"), "");
        assert_eq!(clean_hw("FFFFFFFF"), "");
        assert_eq!(clean_hw(" PF3ABC12 \n"), "PF3ABC12");
        // A home-built PC: the board names it.
        let h = pick_hardware("ASUS\n", "System Product Name\n", "System Version\n", "ASUSTeK COMPUTER INC.\n", "ROG STRIX B550-F GAMING (WI-FI)\n", &["", ""]);
        assert_eq!(h, Hardware { vendor: "ASUS".into(), model: "ROG STRIX B550-F GAMING (WI-FI)".into(), serial: "".into() });
        // Lenovo: the model is in the version.
        let h = pick_hardware("LENOVO", "21AH00BQUS", "ThinkPad T14 Gen 3", "LENOVO", "21AH00BQUS", &["PF3ABC12", ""]);
        assert_eq!((h.model.as_str(), h.serial.as_str()), ("ThinkPad T14 Gen 3", "PF3ABC12"));
        let h = pick_hardware("Dell Inc.", "OptiPlex 7090", "", "Dell Inc.", "0K6D2T", &["Default string", "7XYZ123"]);
        assert_eq!(h, Hardware { vendor: "Dell Inc.".into(), model: "OptiPlex 7090".into(), serial: "7XYZ123".into() });
    }

    #[test]
    fn serial_lines() {
        assert_eq!(first_serial("System Serial Number\nMB-7X91234\n"), "MB-7X91234");
        assert_eq!(first_serial("Default string\nDefault string\n"), "");
        assert_eq!(first_serial(""), "");
    }

    #[test]
    fn smbios_table() {
        // Type 0 (BIOS), type 1 (system), type 2 (board), type 127 (end).
        let mut t: Vec<u8> = vec![0, 4, 0, 0];
        t.extend(b"\0\0");
        t.extend([1u8, 8, 1, 0, 1, 2, 0, 3]);
        t.extend(b"HP\0HP EliteDesk 800 G6\0CZC1234XYZ\0\0");
        t.extend([2u8, 8, 2, 0, 1, 2, 0, 0]);
        t.extend(b"HP\08767\0\0");
        t.extend([127u8, 4, 3, 0]);
        t.extend(b"\0\0");
        assert_eq!(parse_smbios(&t), Hardware { vendor: "HP".into(), model: "HP EliteDesk 800 G6".into(), serial: "CZC1234XYZ".into() });
        assert_eq!(parse_smbios(&[]), Hardware::default());
        assert_eq!(parse_smbios(&[1, 200, 0]), Hardware::default());
    }

    #[test]
    fn mac_hardware() {
        let text = "Hardware:\n\n    Hardware Overview:\n\n      Model Name: MacBook Pro\n      Model Identifier: MacBookPro18,3\n      Chip: Apple M1 Pro\n      Serial Number (system): C02XL0ABCD12\n      Hardware UUID: 1234\n";
        assert_eq!(parse_system_profiler(text), Hardware { vendor: "Apple".into(), model: "MacBook Pro (MacBookPro18,3)".into(), serial: "C02XL0ABCD12".into() });
        assert_eq!(parse_system_profiler(""), Hardware::default());
    }

    #[test]
    fn windows_names() {
        assert_eq!(windows_os_name("Windows 10 Pro", "24H2", "26100"), "Windows 11 Pro 24H2");
        assert_eq!(windows_os_name("Windows 10 Pro", "22H2", "19045"), "Windows 10 Pro 22H2");
        assert_eq!(windows_os_name("", "", ""), "Windows");
    }

    #[test]
    fn os_release() {
        assert_eq!(parse_os_release("NAME=\"Fedora Linux\"\nPRETTY_NAME=\"Fedora Linux 44 (Workstation Edition)\"\n").as_deref(), Some("Fedora Linux 44 (Workstation Edition)"));
        assert_eq!(parse_os_release("NAME=x\n"), None);
    }

    /// This PC, read for real: it answers, with at least the loopback
    /// interface, and every address has a prefix in range.
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn reads_this_pc() {
        let r = read().expect("this PC is read");
        assert!(!r.hostname.is_empty());
        assert_eq!(r.platform, std::env::consts::OS);
        assert!(r.interfaces.iter().any(|i| i.loopback), "{:?}", r.interfaces);
        for i in &r.interfaces {
            for a in &i.addresses {
                let ip: std::net::IpAddr = a.ip.parse().expect("an address");
                assert!(a.prefix <= if ip.is_ipv6() { 128 } else { 32 });
            }
        }
        // IPv4 addresses come before IPv6 ones on each interface.
        for i in &r.interfaces {
            let first6 = i.addresses.iter().position(|a| a.ip.contains(':')).unwrap_or(i.addresses.len());
            assert!(i.addresses[first6..].iter().all(|a| a.ip.contains(':')));
        }
        let json = serde_json::to_value(&r).unwrap();
        assert!(json.get("interfaces").is_some() && json.get("gateways").is_some() && json.get("dns").is_some());
    }
}
