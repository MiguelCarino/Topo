// The remaining answer checks (docs/SCOPE.md D155, step 7k, D315-D324):
// NTP, RTSP, SIP, HL7 MLLP, IPP, IMAP and POP. A child of checks.rs, whose
// helpers (connect, the TLS handshake that reads the certificate's end
// date, the line reader, the outcomes) they share. Each is one request and
// its reply, and keeps only the outcome. None takes a password, and none
// ever sends a login, a message or a print job.

use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

/// ntp: a clock further off than this, either way, is a warning (D155).
#[allow(dead_code)] // the page says it; kept here beside the check
pub const NTP_WARN_MS: f64 = 1000.0;
/// Seconds from 1900-01-01 (NTP's era 0) to 1970-01-01.
const NTP_UNIX: u64 = 2_208_988_800;
/// The printer path asked when the owner gives none (IPP Everywhere's).
pub const IPP_PATH_DEFAULT: &str = "/ipp/print";

fn hex<const N: usize>() -> String {
    random_bytes::<N>().iter().map(|b| format!("{b:02x}")).collect()
}

/// "ip" or "[ip]", with ":port" unless it is `default`.
fn authority(ip: IpAddr, port: u16, default: u16) -> String {
    let h = match ip {
        IpAddr::V4(a) => a.to_string(),
        IpAddr::V6(a) => format!("[{a}]"),
    };
    if port == default { h } else { format!("{h}:{port}") }
}

// ---- NTP ----

/// A time as NTP writes it: seconds since 1900 (mod 2^32) and a fraction.
pub fn ntp_stamp(t: SystemTime) -> u64 {
    let d = t.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = (d.as_secs() + NTP_UNIX) & 0xffff_ffff;
    let frac = ((d.subsec_nanos() as u64) << 32) / 1_000_000_000;
    (secs << 32) | frac
}

/// The client's request: leap 0, version 4, mode 3 (client), everything
/// zero but the transmit time, which is random (RFC 9109: it is only how
/// the reply is matched, and says nothing of this PC's clock).
pub fn ntp_request(xmit: &[u8; 8]) -> [u8; 48] {
    let mut p = [0u8; 48];
    p[0] = (4 << 3) | 3;
    p[40..48].copy_from_slice(xmit);
    p
}

/// What a server's reply says.
#[derive(Debug, PartialEq)]
pub struct NtpReply {
    pub leap: u8,
    pub stratum: u8,
    /// The kiss code when the stratum is 0 ("RATE", "DENY"...).
    pub refid: [u8; 4],
    pub receive: u64,
    pub transmit: u64,
}

/// The reply to our request (mode 4, its origin our transmit time), or None.
pub fn ntp_reply(buf: &[u8], xmit: &[u8; 8]) -> Option<NtpReply> {
    if buf.len() < 48 || buf[0] & 0x07 != 4 || &buf[24..32] != xmit {
        return None;
    }
    let u64at = |i: usize| u64::from_be_bytes(buf[i..i + 8].try_into().unwrap());
    Some(NtpReply { leap: buf[0] >> 6, stratum: buf[1], refid: buf[12..16].try_into().unwrap(), receive: u64at(32), transmit: u64at(40) })
}

/// Whether a reply serves time: Err(its status) for a kiss-o'-death
/// (stratum 0), an unsynchronised server (leap 3 or stratum 16 and up),
/// or receive or transmit times of zero (RFC 5905's sanity check: a broken
/// or still-starting server; its offset would be the whole era, D325).
pub fn ntp_serves(r: &NtpReply) -> Result<(), String> {
    if r.stratum == 0 {
        let code: String = r.refid.iter().filter(|c| c.is_ascii_alphanumeric()).map(|&c| c as char).collect();
        return Err(format!("KoD {code}").trim().to_string());
    }
    if r.leap == 3 || r.stratum >= 16 {
        return Err("unsynchronized".into());
    }
    if r.receive == 0 || r.transmit == 0 {
        return Err("bad-reply".into());
    }
    Ok(())
}

/// The clock offset in milliseconds, ((T2 - T1) + (T3 - T4)) / 2, from
/// 64-bit NTP times; the differences are taken as signed, so it holds
/// across the 2036 era change.
pub fn ntp_offset_ms(t1: u64, t2: u64, t3: u64, t4: u64) -> f64 {
    let d = |a: u64, b: u64| a.wrapping_sub(b) as i64 as f64 / 4_294_967_296.0;
    ((d(t2, t1) + d(t3, t4)) / 2.0 * 1000.0 * 100.0).round() / 100.0
}

pub(super) fn ntp(ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    let bind: SocketAddr = if ip.is_ipv6() { "[::]:0".parse().unwrap() } else { "0.0.0.0:0".parse().unwrap() };
    let sock = match UdpSocket::bind(bind) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    let xmit: [u8; 8] = random_bytes();
    let req = ntp_request(&xmit);
    if let Err(e) = sock.connect(SocketAddr::new(ip, spec.port())) {
        return Outcome::fail(io_status(&e));
    }
    let wall = SystemTime::now();
    let t = Instant::now();
    if let Err(e) = sock.send(&req) {
        return Outcome::fail(io_status(&e));
    }
    let mut buf = [0u8; 512];
    loop {
        let left = timeout.saturating_sub(t.elapsed());
        if left.is_zero() {
            return Outcome::fail("timeout");
        }
        let _ = sock.set_read_timeout(Some(left));
        let n = match sock.recv(&mut buf) {
            Ok(n) => n,
            Err(e) => return Outcome::fail(io_status(&e)),
        };
        let Some(r) = ntp_reply(&buf[..n], &xmit) else { continue };
        let elapsed = t.elapsed();
        let rtt = ms_since(t);
        if let Err(status) = ntp_serves(&r) {
            return Outcome { rtt_ms: Some(rtt), status, ..Default::default() };
        }
        // T1 and T4 from one wall-clock reading and the monotonic time
        // between them, so a clock step during the check does not count.
        let t1 = ntp_stamp(wall);
        let t4 = ntp_stamp(wall + elapsed);
        return Outcome {
            ok: true,
            rtt_ms: Some(rtt),
            status: format!("stratum {}", r.stratum),
            offset_ms: Some(ntp_offset_ms(t1, r.receive, r.transmit, t4)),
            ..Default::default()
        };
    }
}

// ---- RTSP ----

/// "RTSP/1.0 200 OK" -> 200.
pub fn rtsp_status(line: &str) -> Option<u16> {
    status_of(line, "RTSP/")
}

/// "SIP/2.0 200 OK" -> 200.
pub fn sip_status(line: &str) -> Option<u16> {
    status_of(line, "SIP/2.0")
}

fn status_of(line: &str, version: &str) -> Option<u16> {
    let mut parts = line.split_whitespace();
    if !parts.next()?.starts_with(version) {
        return None;
    }
    let code = parts.next()?;
    if code.len() != 3 {
        return None;
    }
    code.parse().ok().filter(|c| (100..700).contains(c))
}

pub(super) fn rtsp(ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    let port = spec.port();
    let t = Instant::now();
    let mut s = match connect_bounded(ip, port, t, timeout) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    let req = format!(
        "OPTIONS rtsp://{}{} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: Topo answer check\r\n\r\n",
        authority(ip, port, 554),
        http_path(&spec.path)
    );
    if let Err(e) = s.write_all(req.as_bytes()) {
        return Outcome::fail(io_status(&e));
    }
    match read_line_limited(&mut s) {
        Ok(l) => match rtsp_status(&l) {
            Some(code) => Outcome { ok: code < 500, rtt_ms: Some(ms_since(t)), status: code.to_string(), ..Default::default() },
            None => Outcome::fail("bad-reply"),
        },
        Err(e) => Outcome::fail(io_status(&e)),
    }
}

// ---- SIP ----

/// SIP's final answers: 2xx-4xx (a 404 or 401 is the phone system saying
/// so) and 6xx; 5xx (503 above all) is not answering.
pub fn sip_answers(code: u16) -> bool {
    (200..500).contains(&code) || code >= 600
}

/// The OPTIONS request: our own address in Via, From and Call-ID (the
/// reply comes back to it), random branch, tag and Call-ID, no body.
pub fn sip_options(ip: IpAddr, port: u16, local: SocketAddr, tcp: bool, branch: &str, tag: &str, call_id: &str) -> String {
    let target = authority(ip, port, 0);
    let me = match local.ip() {
        IpAddr::V4(a) => a.to_string(),
        IpAddr::V6(a) => format!("[{a}]"),
    };
    format!(
        "OPTIONS sip:{target} SIP/2.0\r\n\
         Via: SIP/2.0/{} {me}:{};branch=z9hG4bK{branch};rport\r\n\
         Max-Forwards: 70\r\n\
         From: <sip:topo@{me}>;tag={tag}\r\n\
         To: <sip:{target}>\r\n\
         Call-ID: {call_id}\r\n\
         CSeq: 1 OPTIONS\r\n\
         User-Agent: Topo answer check\r\n\
         Content-Length: 0\r\n\r\n",
        if tcp { "TCP" } else { "UDP" },
        local.port()
    )
}

/// The Call-ID of a response (long or compact form).
fn sip_call_id(head: &str) -> Option<&str> {
    head.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        let k = k.trim();
        (k.eq_ignore_ascii_case("call-id") || k == "i").then(|| v.trim())
    })
}

pub(super) fn sip(ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    let port = spec.port();
    let (branch, tag) = (hex::<8>(), hex::<4>());
    let t = Instant::now();
    if spec.transport == "tcp" {
        let mut s = match connect_bounded(ip, port, t, timeout) {
            Ok(s) => s,
            Err(e) => return Outcome::fail(io_status(&e)),
        };
        let local = s.local_addr().unwrap_or_else(|_| SocketAddr::new(IpAddr::from([127, 0, 0, 1]), 0));
        let call_id = format!("{}@topo", hex::<12>());
        if let Err(e) = s.write_all(sip_options(ip, port, local, true, &branch, &tag, &call_id).as_bytes()) {
            return Outcome::fail(io_status(&e));
        }
        // Responses in order; provisional ones (1xx, no body) are passed.
        for _ in 0..8 {
            let line = match read_line_limited(&mut s) {
                Ok(l) => l,
                Err(e) => return Outcome::fail(io_status(&e)),
            };
            let Some(code) = sip_status(&line) else { return Outcome::fail("bad-reply") };
            let mut length = 0usize;
            for _ in 0..64 {
                match read_line_limited(&mut s) {
                    Ok(h) if h.is_empty() => break,
                    Ok(h) => {
                        if let Some((k, v)) = h.split_once(':') {
                            let k = k.trim();
                            if k.eq_ignore_ascii_case("content-length") || k == "l" {
                                length = v.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    Err(e) => return Outcome::fail(io_status(&e)),
                }
            }
            if code < 200 {
                if length > 0 {
                    let mut skip = vec![0u8; length.min(65_536)];
                    if s.read_exact(&mut skip).is_err() {
                        return Outcome::fail("bad-reply");
                    }
                }
                continue;
            }
            return Outcome { ok: sip_answers(code), rtt_ms: Some(ms_since(t)), status: code.to_string(), ..Default::default() };
        }
        return Outcome::fail("bad-reply");
    }
    // The socket is left unconnected (D325): a phone system may answer from
    // another address or port (multi-homed, or another socket), and a
    // connected socket would drop that answer. The random Call-ID is the
    // match. Which of this PC's addresses goes to the phone system comes
    // from a second socket's connect, which sends nothing.
    let any: SocketAddr = if ip.is_ipv6() { "[::]:0".parse().unwrap() } else { "0.0.0.0:0".parse().unwrap() };
    let route = UdpSocket::bind(any).and_then(|r| r.connect(SocketAddr::new(ip, port)).and_then(|_| r.local_addr()));
    let from_ip = match route {
        Ok(a) => a.ip(),
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    let sock = match UdpSocket::bind(SocketAddr::new(from_ip, 0)) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    let local = sock.local_addr().unwrap_or_else(|_| SocketAddr::new(from_ip, 0));
    let call_id = format!("{}@topo", hex::<12>());
    let t = Instant::now();
    if let Err(e) = sock.send_to(sip_options(ip, port, local, false, &branch, &tag, &call_id).as_bytes(), SocketAddr::new(ip, port)) {
        return Outcome::fail(io_status(&e));
    }
    let mut buf = [0u8; 4096];
    loop {
        let left = timeout.saturating_sub(t.elapsed());
        if left.is_zero() {
            return Outcome::fail("timeout");
        }
        let _ = sock.set_read_timeout(Some(left));
        let n = match sock.recv_from(&mut buf) {
            Ok((n, _)) => n,
            Err(e) => return Outcome::fail(io_status(&e)),
        };
        let text = String::from_utf8_lossy(&buf[..n]);
        let head = text.split("\r\n\r\n").next().unwrap_or("");
        let Some(code) = head.lines().next().and_then(sip_status) else { continue };
        if sip_call_id(head) != Some(call_id.as_str()) || code < 200 {
            continue; // another's reply, or 100 Trying
        }
        return Outcome { ok: sip_answers(code), rtt_ms: Some(ms_since(t)), status: code.to_string(), ..Default::default() };
    }
}

// ---- HL7 MLLP ----

/// A connect and nothing more: no byte is written or read, and the
/// connection is closed at once (D155: a test message could reach a RIS).
pub(super) fn mllp(ip: IpAddr, port: u16, timeout: Duration) -> Outcome {
    let t = Instant::now();
    match TcpStream::connect_timeout(&SocketAddr::new(ip, port), timeout) {
        Ok(s) => {
            let out = Outcome::answered("open", t);
            let _ = s.shutdown(std::net::Shutdown::Both);
            out
        }
        Err(e) => Outcome::fail(io_status(&e)),
    }
}

// ---- IPP ----

/// The printer's path: the owner's, else IPP Everywhere's /ipp/print.
pub fn ipp_path(p: &str) -> String {
    if p.trim().is_empty() { IPP_PATH_DEFAULT.into() } else { http_path(p) }
}

/// Get-Printer-Attributes (IPP/1.1, operation 0x000B) asking for
/// printer-state and printer-state-reasons only.
pub fn ipp_request(printer_uri: &str, request_id: u32) -> Vec<u8> {
    fn attr(b: &mut Vec<u8>, tag: u8, name: &str, value: &[u8]) {
        b.push(tag);
        b.extend_from_slice(&(name.len() as u16).to_be_bytes());
        b.extend_from_slice(name.as_bytes());
        b.extend_from_slice(&(value.len() as u16).to_be_bytes());
        b.extend_from_slice(value);
    }
    let mut b = vec![1, 1, 0x00, 0x0b];
    b.extend_from_slice(&request_id.to_be_bytes());
    b.push(0x01); // operation attributes
    attr(&mut b, 0x47, "attributes-charset", b"utf-8");
    attr(&mut b, 0x48, "attributes-natural-language", b"en");
    attr(&mut b, 0x45, "printer-uri", printer_uri.as_bytes());
    attr(&mut b, 0x44, "requested-attributes", b"printer-state");
    attr(&mut b, 0x44, "", b"printer-state-reasons");
    b.push(0x03); // end
    b
}

/// What an IPP response says: its status, the printer's state (idle,
/// processing, stopped) and its reasons (keywords, "none" left out).
#[derive(Debug, Default, PartialEq)]
pub struct IppReply {
    pub status: u16,
    pub state: String,
    pub reasons: Vec<String>,
}

pub fn ipp_reply(b: &[u8], request_id: u32) -> Option<IppReply> {
    if b.len() < 9 || b[0] == 0 || u32::from_be_bytes(b[4..8].try_into().ok()?) != request_id {
        return None;
    }
    let mut out = IppReply { status: u16::from_be_bytes([b[2], b[3]]), ..Default::default() };
    let mut i = 8usize;
    let mut name = String::new();
    while i < b.len() {
        let tag = b[i];
        i += 1;
        if tag == 0x03 {
            return Some(out);
        }
        if tag < 0x10 {
            continue; // a group's delimiter
        }
        let nl = u16::from_be_bytes([*b.get(i)?, *b.get(i + 1)?]) as usize;
        let n = b.get(i + 2..i + 2 + nl)?;
        i += 2 + nl;
        let vl = u16::from_be_bytes([*b.get(i)?, *b.get(i + 1)?]) as usize;
        let v = b.get(i + 2..i + 2 + vl)?;
        i += 2 + vl;
        if nl > 0 {
            name = String::from_utf8_lossy(n).into_owned();
        }
        if name == "printer-state" && tag == 0x23 && vl == 4 {
            out.state = match u32::from_be_bytes(v.try_into().ok()?) {
                3 => "idle".into(),
                4 => "processing".into(),
                5 => "stopped".into(),
                _ => String::new(),
            };
        } else if name == "printer-state-reasons" && tag == 0x44 && out.reasons.len() < 4 {
            let k: String = String::from_utf8_lossy(v).chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(48).collect();
            if !k.is_empty() && k != "none" {
                out.reasons.push(k);
            }
        }
    }
    None
}

/// The body of an HTTP response read from `s`: by Content-Length,
/// chunked, or to the end; at most 64 KiB. Interim responses (1xx, such
/// as the "100 Continue" some printers send before every answer) are
/// passed, up to 4 of them (D325).
fn http_body<S: Read>(s: &mut S) -> Result<(u16, Vec<u8>), String> {
    const MAX: usize = 65_536;
    let mut interim = 0;
    let (code, length, chunked) = loop {
        let line = read_line_limited(s).map_err(|e| io_status(&e))?;
        let code = http_status(&line).ok_or_else(|| "bad-reply".to_string())?;
        let (mut length, mut chunked) = (None, false);
        for _ in 0..100 {
            let h = read_line_limited(s).map_err(|e| io_status(&e))?;
            if h.is_empty() {
                break;
            }
            if let Some((k, v)) = h.split_once(':') {
                let k = k.trim();
                if k.eq_ignore_ascii_case("content-length") {
                    length = v.trim().parse::<usize>().ok();
                } else if k.eq_ignore_ascii_case("transfer-encoding") && v.to_ascii_lowercase().contains("chunked") {
                    chunked = true;
                }
            }
        }
        if !(100..200).contains(&code) {
            break (code, length, chunked);
        }
        interim += 1;
        if interim > 4 {
            return Err("bad-reply".into());
        }
    };
    let mut body = Vec::new();
    if chunked {
        loop {
            let size_line = read_line_limited(s).map_err(|e| io_status(&e))?;
            let size = usize::from_str_radix(size_line.split(';').next().unwrap_or("").trim(), 16).map_err(|_| "bad-reply".to_string())?;
            if size == 0 || body.len() + size > MAX {
                break;
            }
            let mut chunk = vec![0u8; size];
            s.read_exact(&mut chunk).map_err(|e| io_status(&e))?;
            body.extend(chunk);
            let _ = read_line_limited(s);
        }
    } else if let Some(n) = length {
        body = vec![0u8; n.min(MAX)];
        s.read_exact(&mut body).map_err(|e| io_status(&e))?;
    } else {
        let _ = s.take(MAX as u64).read_to_end(&mut body);
    }
    Ok((code, body))
}

pub(super) fn ipp(ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    let port = spec.port();
    let path = ipp_path(&spec.path);
    let t = Instant::now();
    let mut s = match connect_bounded(ip, port, t, timeout) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    let rid = u32::from_be_bytes(random_bytes::<4>()) & 0x7fff_ffff | 1;
    let body = ipp_request(&format!("ipp://{}{}", authority(ip, port, 631), path), rid);
    let head = format!(
        "POST {path} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/ipp\r\nContent-Length: {}\r\nUser-Agent: Topo answer check\r\nConnection: close\r\n\r\n",
        authority(ip, port, 80),
        body.len()
    );
    let mut req = head.into_bytes();
    req.extend(body);
    if let Err(e) = s.write_all(&req) {
        return Outcome::fail(io_status(&e));
    }
    let (code, body) = match http_body(&mut s) {
        Ok(x) => x,
        Err(e) => return Outcome::fail(e),
    };
    let rtt = ms_since(t);
    if code != 200 {
        // The web server answered, and said no (a 401 or 404 answers, as an
        // HTTP check's would; a 5xx does not).
        return Outcome { ok: code < 500, rtt_ms: Some(rtt), status: format!("http {code}"), ..Default::default() };
    }
    let Some(r) = ipp_reply(&body, rid) else { return Outcome::fail("bad-reply") };
    let mut status = format!("{:04X}", r.status);
    if !r.state.is_empty() {
        status.push(' ');
        status.push_str(&r.state);
    }
    if !r.reasons.is_empty() {
        status.push(' ');
        status.push_str(&r.reasons.join(","));
    }
    Outcome { ok: r.status < 0x0500, rtt_ms: Some(rtt), status, ..Default::default() }
}

// ---- IMAP and POP ----

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mail {
    Imap,
    Pop,
}

/// The greeting: (answers, its word). IMAP: OK or PREAUTH answer, BYE does
/// not; POP: +OK answers, -ERR does not.
pub fn mail_greeting(kind: Mail, line: &str) -> Option<(bool, &'static str)> {
    let u = line.trim_start().to_ascii_uppercase();
    match kind {
        Mail::Imap => {
            let rest = u.strip_prefix("* ")?;
            let word = rest.split(|c: char| c == ' ' || c == '[').next().unwrap_or("");
            match word {
                "OK" => Some((true, "OK")),
                "PREAUTH" => Some((true, "PREAUTH")),
                "BYE" => Some((false, "BYE")),
                _ => None,
            }
        }
        Mail::Pop => {
            if u.starts_with("+OK") {
                Some((true, "+OK"))
            } else if u.starts_with("-ERR") {
                Some((false, "-ERR"))
            } else {
                None
            }
        }
    }
}

/// Reads to the tagged reply `tag` (IMAP), past any untagged lines; its
/// word ("OK", "NO", "BAD").
fn imap_tagged<S: Read>(s: &mut S, tag: &str) -> Result<String, String> {
    for _ in 0..64 {
        let l = read_line_limited(s).map_err(|e| io_status(&e))?;
        if let Some(rest) = l.strip_prefix(tag).and_then(|r| r.strip_prefix(' ')) {
            return Ok(rest.split_whitespace().next().unwrap_or("").to_ascii_uppercase());
        }
    }
    Err("bad-reply".into())
}

/// Asks to start TLS: Ok(true) when the server agreed.
fn mail_starttls<S: Read + Write>(s: &mut S, kind: Mail) -> Result<bool, String> {
    match kind {
        Mail::Imap => {
            s.write_all(b"a1 STARTTLS\r\n").map_err(|e| io_status(&e))?;
            Ok(imap_tagged(s, "a1")? == "OK")
        }
        Mail::Pop => {
            s.write_all(b"STLS\r\n").map_err(|e| io_status(&e))?;
            let l = read_line_limited(s).map_err(|e| io_status(&e))?;
            Ok(l.to_ascii_uppercase().starts_with("+OK"))
        }
    }
}

/// LOGOUT or QUIT, and its answer waited for briefly.
fn mail_quit<S: Read + Write>(s: &mut S, kind: Mail) {
    match kind {
        Mail::Imap => {
            if s.write_all(b"a2 LOGOUT\r\n").and_then(|_| s.flush()).is_ok() {
                let _ = imap_tagged(s, "a2");
            }
        }
        Mail::Pop => {
            if s.write_all(b"QUIT\r\n").and_then(|_| s.flush()).is_ok() {
                let _ = read_line_limited(s);
            }
        }
    }
}

fn mail_greet<S: Read>(s: &mut S, kind: Mail) -> Result<(bool, &'static str), String> {
    let l = read_line_limited(s).map_err(|e| io_status(&e))?;
    mail_greeting(kind, &l).ok_or_else(|| "bad-reply".to_string())
}

pub(super) fn mail(ip: IpAddr, spec: &Spec, kind: Mail, timeout: Duration) -> Outcome {
    let t = Instant::now();
    let tcp = match connect_bounded(ip, spec.port(), t, timeout) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    if spec.tls == "implicit" {
        let (mut s, cert) = match tls_over(tcp, ip, &spec.host) {
            Ok(x) => x,
            Err(e) => return Outcome::fail(e),
        };
        let (ok, word) = match mail_greet(&mut s, kind) {
            Ok(x) => x,
            Err(e) => return Outcome::fail(e),
        };
        let rtt = ms_since(t);
        mail_quit(&mut s, kind);
        s.conn.send_close_notify();
        let _ = s.flush();
        return Outcome { ok, rtt_ms: Some(rtt), status: word.into(), cert_not_after: cert, ..Default::default() };
    }
    let mut s = tcp;
    let (ok, word) = match mail_greet(&mut s, kind) {
        Ok(x) => x,
        Err(e) => return Outcome::fail(e),
    };
    let rtt = ms_since(t);
    if !ok || spec.tls != "starttls" {
        mail_quit(&mut s, kind);
        return Outcome { ok, rtt_ms: Some(rtt), status: word.into(), ..Default::default() };
    }
    match mail_starttls(&mut s, kind) {
        Ok(true) => {
            // Nothing was read past the server's yes (lines are read a byte
            // at a time), so the handshake goes on the same socket.
            let (mut tls, cert) = match tls_over(s, ip, &spec.host) {
                Ok(x) => x,
                Err(e) => return Outcome::fail(e),
            };
            mail_quit(&mut tls, kind);
            tls.conn.send_close_notify();
            let _ = tls.flush();
            Outcome { ok: true, rtt_ms: Some(rtt), status: word.into(), cert_not_after: cert, ..Default::default() }
        }
        Ok(false) => {
            mail_quit(&mut s, kind);
            let no = if kind == Mail::Imap { "no STARTTLS" } else { "no STLS" };
            Outcome { ok: true, rtt_ms: Some(rtt), status: format!("{word} {no}"), ..Default::default() }
        }
        Err(e) => Outcome::fail(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    const CERT_A: &[u8] = include_bytes!("testdata/cert-a.der");
    const KEY_A: &[u8] = include_bytes!("testdata/key-a.der");
    const CERT_A_END: i64 = 4_948_022_421;
    const CERT_ENDED: &[u8] = include_bytes!("testdata/cert-ended.der");
    const KEY_ENDED: &[u8] = include_bytes!("testdata/key-ended.der");
    const CERT_ENDED_END: i64 = 1_772_323_200;

    fn spec(proto: &str, port: u16) -> Spec {
        Spec { proto: proto.into(), host: "127.0.0.1".into(), port, timeout_ms: 2000, ..Default::default() }
    }
    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }
    fn tls_cfg(cert: &'static [u8], key: &'static [u8]) -> Arc<rustls::ServerConfig> {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        Arc::new(
            rustls::ServerConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_no_client_auth()
                .with_single_cert(vec![CertificateDer::from(cert)], rustls::pki_types::PrivateKeyDer::Pkcs8(key.into()))
                .unwrap(),
        )
    }

    #[test]
    fn the_new_protocols_are_known_with_their_ports() {
        for p in ["ntp", "rtsp", "sip", "mllp", "ipp", "imap", "pop"] {
            assert!(PROTOCOLS.contains(&p), "{p}");
        }
        let port = |p: &str, tls: &str| Spec { proto: p.into(), tls: tls.into(), ..Default::default() }.port();
        assert_eq!((port("ntp", ""), port("rtsp", ""), port("sip", ""), port("mllp", ""), port("ipp", "")), (123, 554, 5060, 2575, 631));
        assert_eq!((port("imap", ""), port("imap", "starttls"), port("imap", "implicit")), (143, 143, 993));
        assert_eq!((port("pop", ""), port("pop", "starttls"), port("pop", "implicit")), (110, 110, 995));
        assert_eq!(Spec { proto: "imap".into(), tls: "implicit".into(), port: 1993, ..Default::default() }.port(), 1993);
        assert_eq!(spec("imap", 1).timeout(), Duration::from_millis(2000));
        assert_eq!(Spec { proto: "pop".into(), ..Default::default() }.timeout(), Duration::from_millis(LONG_TIMEOUT_MS));
        assert_eq!(Spec { proto: "ntp".into(), ..Default::default() }.timeout(), Duration::from_millis(DEFAULT_TIMEOUT_MS));
    }

    // ---- NTP ----

    /// An NTP server on 127.0.0.1: answers each request with `stratum`, a
    /// clock `ahead_ms` ahead of this PC's, and `leap`. A stray reply (not
    /// to our transmit time) goes first. It sends what it got.
    fn ntp_fake(stratum: u8, leap: u8, ahead_ms: i64, refid: &'static [u8; 4]) -> (u16, mpsc::Receiver<Vec<u8>>) {
        let s = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = s.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut buf = [0u8; 512];
            while let Ok((n, from)) = s.recv_from(&mut buf) {
                let q = buf[..n].to_vec();
                let _ = tx.send(q.clone());
                let now = SystemTime::now();
                let at = if ahead_ms >= 0 { now + Duration::from_millis(ahead_ms as u64) } else { now - Duration::from_millis((-ahead_ms) as u64) };
                let mut r = [0u8; 48];
                r[0] = (leap << 6) | (4 << 3) | 4;
                r[1] = stratum;
                r[12..16].copy_from_slice(refid);
                r[24..32].copy_from_slice(&q[40..48]);
                r[32..40].copy_from_slice(&ntp_stamp(at).to_be_bytes());
                r[40..48].copy_from_slice(&ntp_stamp(at).to_be_bytes());
                let mut stray = r;
                stray[24] ^= 0xff;
                let _ = s.send_to(&stray, from);
                let _ = s.send_to(&r, from);
            }
        });
        (port, rx)
    }

    #[test]
    fn ntp_stratum_and_offset() {
        let (port, rx) = ntp_fake(2, 0, 0, b"\x7f\0\0\x01");
        let o = run(&spec("ntp", port));
        assert!(o.ok, "{o:?}");
        assert_eq!(o.status, "stratum 2");
        assert!(o.offset_ms.unwrap().abs() < 100.0, "{o:?}");
        assert!(o.rtt_ms.is_some());
        // One request of 48 bytes, client mode, version 4, nothing else set
        // but the transmit time.
        let q = rx.recv().unwrap();
        assert_eq!(q.len(), 48);
        assert_eq!(q[0], 0x23);
        assert!(q[1..40].iter().all(|&b| b == 0), "only the transmit time is set");
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err(), "asked once");
        // A clock 3 s off: still answering; the page warns above 1 s.
        let (port, _rx) = ntp_fake(1, 0, 3000, b"GPS\0");
        let o = run(&spec("ntp", port));
        assert!(o.ok && o.status == "stratum 1", "{o:?}");
        let off = o.offset_ms.unwrap();
        assert!((off - 3000.0).abs() < 100.0 && off.abs() > NTP_WARN_MS, "{off}");
        let (port, _rx) = ntp_fake(3, 0, -2500, b"\0\0\0\0");
        let off = run(&spec("ntp", port)).offset_ms.unwrap();
        assert!((off + 2500.0).abs() < 100.0, "{off}");
        // A kiss-o'-death and an unsynchronised server serve no time.
        let (port, _rx) = ntp_fake(0, 0, 0, b"RATE");
        let o = run(&spec("ntp", port));
        assert!(!o.ok && o.status == "KoD RATE" && o.rtt_ms.is_some() && o.offset_ms.is_none(), "{o:?}");
        let (port, _rx) = ntp_fake(16, 3, 0, b"INIT");
        let o = run(&spec("ntp", port));
        assert!(!o.ok && o.status == "unsynchronized", "{o:?}");
        let (port, _rx) = ntp_fake(4, 3, 0, b"\0\0\0\0");
        assert_eq!(run(&spec("ntp", port)).status, "unsynchronized");
        // A server that answers with zero times (broken, or still starting)
        // serves no time: not answering, and no era-long offset (D325).
        let zero = UdpSocket::bind("127.0.0.1:0").unwrap();
        let zport = zero.local_addr().unwrap().port();
        thread::spawn(move || {
            let mut buf = [0u8; 512];
            if let Ok((n, from)) = zero.recv_from(&mut buf) {
                let mut r = [0u8; 48];
                r[0] = (4 << 3) | 4;
                r[1] = 2;
                r[24..32].copy_from_slice(&buf[40..n.min(48)]);
                let _ = zero.send_to(&r, from);
            }
        });
        let o = run(&spec("ntp", zport));
        assert!(!o.ok && o.status == "bad-reply" && o.offset_ms.is_none(), "{o:?}");
        // Nobody answering: asked once in all that time, never again.
        let quiet = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mut s = spec("ntp", quiet.local_addr().unwrap().port());
        s.timeout_ms = 1200;
        let o = run(&s);
        assert!(!o.ok && !o.skipped && o.status == "timeout", "{o:?}");
        assert_eq!(datagrams(&quiet), vec![48], "one request, never resent");
    }

    /// The sizes of the datagrams waiting on `s`.
    fn datagrams(s: &UdpSocket) -> Vec<usize> {
        s.set_read_timeout(Some(Duration::from_millis(100))).unwrap();
        let mut buf = [0u8; 4096];
        let mut got = Vec::new();
        while let Ok(n) = s.recv(&mut buf) {
            got.push(n);
        }
        got
    }

    #[test]
    fn ntp_arithmetic() {
        let base = ntp_stamp(UNIX_EPOCH + Duration::from_secs(1_800_000_000));
        let sec = 1u64 << 32;
        // Server 1 s ahead, 20 ms each way.
        let t1 = base;
        let t2 = base + sec + sec / 50;
        let t3 = t2;
        let t4 = base + sec / 25;
        assert_eq!(ntp_offset_ms(t1, t2, t3, t4), 1000.0);
        // Across the 2036 era change (seconds wrap past 2^32).
        let t1 = (0xffff_ffffu64 << 32) | (sec / 2);
        let t2 = t1.wrapping_add(2 * sec);
        assert_eq!(ntp_offset_ms(t1, t2, t2, t1), 2000.0);
        assert_eq!(ntp_stamp(UNIX_EPOCH) >> 32, NTP_UNIX);
        // What serves time (D316, D325).
        let r = |leap, stratum, refid: &[u8; 4], receive, transmit| NtpReply { leap, stratum, refid: *refid, receive, transmit };
        assert_eq!(ntp_serves(&r(0, 2, b"\0\0\0\0", base, base)), Ok(()));
        assert_eq!(ntp_serves(&r(0, 0, b"DENY", base, base)), Err("KoD DENY".into()));
        assert_eq!(ntp_serves(&r(3, 2, b"\0\0\0\0", base, base)), Err("unsynchronized".into()));
        assert_eq!(ntp_serves(&r(0, 16, b"\0\0\0\0", base, base)), Err("unsynchronized".into()));
        assert_eq!(ntp_serves(&r(0, 2, b"\0\0\0\0", 0, base)), Err("bad-reply".into()));
        assert_eq!(ntp_serves(&r(0, 2, b"\0\0\0\0", base, 0)), Err("bad-reply".into()));
        // Not ours: wrong mode, wrong origin, short.
        let x = [1u8; 8];
        let mut r = [0u8; 48];
        r[0] = 0x24;
        r[24..32].copy_from_slice(&x);
        assert!(ntp_reply(&r, &x).is_some());
        assert!(ntp_reply(&r, &[2u8; 8]).is_none());
        assert!(ntp_reply(&r[..40], &x).is_none());
        r[0] = 0x23;
        assert!(ntp_reply(&r, &x).is_none(), "a client's request is not a reply");
    }

    // ---- RTSP ----

    /// A one-request text server (RTSP, SIP over TCP, IPP): reads the head
    /// (and a body by Content-Length), sends it to the test, writes `reply`.
    fn text_fake(reply: Vec<u8>) -> (u16, mpsc::Receiver<Vec<u8>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let Ok((mut s, _)) = l.accept() else { return };
            let mut got = Vec::new();
            let mut b = [0u8; 1];
            while !got.ends_with(b"\r\n\r\n") && got.len() < 16_384 {
                match s.read(&mut b) {
                    Ok(1) => got.push(b[0]),
                    _ => break,
                }
            }
            let head = String::from_utf8_lossy(&got).to_string();
            let len = head.lines().find_map(|l| l.strip_prefix("Content-Length: ")).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
            let mut body = vec![0u8; len];
            let _ = s.read_exact(&mut body);
            got.extend(body);
            let _ = tx.send(got);
            let _ = s.write_all(&reply);
            let _ = s.flush();
        });
        (port, rx)
    }

    #[test]
    fn rtsp_options_status_only() {
        let (port, rx) = text_fake(b"RTSP/1.0 200 OK\r\nCSeq: 1\r\nPublic: OPTIONS, DESCRIBE, PLAY\r\n\r\n".to_vec());
        let o = run(&spec("rtsp", port));
        assert!(o.ok && o.status == "200" && o.rtt_ms.is_some(), "{o:?}");
        let req = String::from_utf8(rx.recv().unwrap()).unwrap();
        assert_eq!(req, format!("OPTIONS rtsp://127.0.0.1:{port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: Topo answer check\r\n\r\n"));
        // A camera that wants a login answers; one in trouble does not.
        let (port, _rx) = text_fake(b"RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\n\r\n".to_vec());
        assert!(run(&spec("rtsp", port)).ok);
        let (port, _rx) = text_fake(b"RTSP/1.0 503 Service Unavailable\r\nCSeq: 1\r\n\r\n".to_vec());
        let o = run(&spec("rtsp", port));
        assert!(!o.ok && o.status == "503", "{o:?}");
        let (port, _rx) = text_fake(b"HTTP/1.1 200 OK\r\n\r\n".to_vec());
        assert_eq!(run(&spec("rtsp", port)).status, "bad-reply");
        // The path asked, when given.
        let (port, rx) = text_fake(b"RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n".to_vec());
        let mut s = spec("rtsp", port);
        s.path = "/stream1".into();
        assert!(run(&s).ok);
        assert!(String::from_utf8(rx.recv().unwrap()).unwrap().starts_with(&format!("OPTIONS rtsp://127.0.0.1:{port}/stream1 RTSP/1.0\r\n")));
        assert_eq!(run(&spec("rtsp", free_port())).status, "refused");
    }

    // ---- SIP ----

    fn sip_reply(req: &str, code: &str) -> String {
        let via = req.lines().find(|l| l.starts_with("Via: ")).unwrap();
        let call = req.lines().find(|l| l.starts_with("Call-ID: ")).unwrap();
        format!("SIP/2.0 {code}\r\n{via}\r\nFrom: <sip:topo@x>;tag=1\r\nTo: <sip:pbx>;tag=2\r\n{call}\r\nCSeq: 1 OPTIONS\r\nContent-Length: 0\r\n\r\n")
    }

    /// A SIP server over UDP: 100 Trying, a reply with another Call-ID, then
    /// `code`. It sends what it got.
    fn sip_udp_fake(code: &'static str) -> (u16, mpsc::Receiver<String>) {
        let s = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = s.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok((n, from)) = s.recv_from(&mut buf) {
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = tx.send(req.clone());
                let _ = s.send_to(sip_reply(&req, "100 Trying").as_bytes(), from);
                let _ = s.send_to(sip_reply(&req, "200 OK").replace("Call-ID: ", "Call-ID: other-").as_bytes(), from);
                let _ = s.send_to(sip_reply(&req, code).as_bytes(), from);
            }
        });
        (port, rx)
    }

    fn sip_request_is_options_only(req: &str) {
        assert!(req.starts_with("OPTIONS sip:127.0.0.1:"), "{req}");
        assert!(req.ends_with("Content-Length: 0\r\n\r\n"), "no body: {req}");
        for h in ["Via: SIP/2.0/", "Max-Forwards: 70", "From: <sip:topo@", "To: <sip:127.0.0.1:", "Call-ID: ", "CSeq: 1 OPTIONS"] {
            assert!(req.contains(h), "{h}: {req}");
        }
        assert!(!req.contains("REGISTER") && !req.contains("INVITE") && !req.contains("Authorization"), "{req}");
    }

    #[test]
    fn sip_options_over_udp() {
        let (port, rx) = sip_udp_fake("200 OK");
        let o = run(&spec("sip", port));
        assert!(o.ok && o.status == "200", "{o:?}");
        let req = rx.recv().unwrap();
        sip_request_is_options_only(&req);
        assert!(req.contains("Via: SIP/2.0/UDP 127.0.0.1:"), "{req}");
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "one datagram, never resent");
        // A phone system that does not know us still answers; 503 does not;
        // 6xx is a final answer.
        let (port, _rx) = sip_udp_fake("404 Not Found");
        assert!(run(&spec("sip", port)).ok);
        let (port, _rx) = sip_udp_fake("503 Service Unavailable");
        let o = run(&spec("sip", port));
        assert!(!o.ok && o.status == "503" && o.rtt_ms.is_some(), "{o:?}");
        let (port, _rx) = sip_udp_fake("603 Decline");
        assert!(run(&spec("sip", port)).ok);
        // A phone system that answers from another socket (another port, as
        // a multi-homed one may answer from another address): still matched
        // by its Call-ID (D325).
        let ask = UdpSocket::bind("127.0.0.1:0").unwrap();
        let aport = ask.local_addr().unwrap().port();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            if let Ok((n, from)) = ask.recv_from(&mut buf) {
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let other = UdpSocket::bind("127.0.0.1:0").unwrap();
                let _ = other.send_to(sip_reply(&req, "200 OK").as_bytes(), from);
            }
        });
        let o = run(&spec("sip", aport));
        assert!(o.ok && o.status == "200", "{o:?}");
        // Nobody there: one OPTIONS in all that time (past RFC 3261's T1 of
        // 500 ms, when a resend would have gone), never again.
        let quiet = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mut s = spec("sip", quiet.local_addr().unwrap().port());
        s.timeout_ms = 1200;
        let o = run(&s);
        assert!(!o.ok && !o.skipped && o.status == "timeout", "{o:?}");
        assert_eq!(datagrams(&quiet).len(), 1, "one datagram, never resent");
    }

    #[test]
    fn sip_options_over_tcp() {
        // The fake reads the request first, so its reply is built from it.
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let Ok((mut s, _)) = l.accept() else { return };
            let mut got = Vec::new();
            let mut b = [0u8; 1];
            while !got.ends_with(b"\r\n\r\n") {
                match s.read(&mut b) {
                    Ok(1) => got.push(b[0]),
                    _ => break,
                }
            }
            let req = String::from_utf8_lossy(&got).to_string();
            let _ = s.write_all(sip_reply(&req, "100 Trying").as_bytes());
            let _ = s.write_all(sip_reply(&req, "200 OK").as_bytes());
            let _ = tx.send(req);
        });
        let mut sp = spec("sip", port);
        sp.transport = "tcp".into();
        let o = run(&sp);
        assert!(o.ok && o.status == "200", "{o:?}");
        let req = rx.recv().unwrap();
        sip_request_is_options_only(&req);
        assert!(req.contains("Via: SIP/2.0/TCP 127.0.0.1:"), "{req}");
        let mut gone = spec("sip", free_port());
        gone.transport = "tcp".into();
        assert_eq!(run(&gone).status, "refused");
        let (port, _rx) = text_fake(b"SIP/2.0 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n".to_vec());
        let mut sp = spec("sip", port);
        sp.transport = "tcp".into();
        assert!(!run(&sp).ok);
        assert!(sip_status("SIP/2.0 99 x").is_none() && sip_status("HTTP/1.1 200 OK").is_none() && sip_status("SIP/2.0 486 Busy") == Some(486));
    }

    // ---- HL7 MLLP ----

    /// An MLLP listener that fails the test if it receives any byte: it
    /// sends Ok(()) when the client closed having sent nothing.
    fn mllp_fake() -> (u16, mpsc::Receiver<Result<(), String>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let Ok((mut s, _)) = l.accept() else { return };
            s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut buf = [0u8; 64];
            let r = match s.read(&mut buf) {
                Ok(0) => Ok(()),
                Ok(n) => Err(format!("received {n} bytes: {:?}", &buf[..n])),
                Err(e) => Err(format!("the client did not close: {e}")),
            };
            let _ = tx.send(r);
        });
        (port, rx)
    }

    #[test]
    fn mllp_connects_and_sends_nothing() {
        let (port, rx) = mllp_fake();
        let o = run(&spec("mllp", port));
        assert!(o.ok && o.status == "open" && o.rtt_ms.is_some(), "{o:?}");
        rx.recv().unwrap().unwrap();
        // Its own port when none is given is 2575; nobody listening.
        assert_eq!(Spec::default_port("mllp"), 2575);
        let o = run(&spec("mllp", free_port()));
        assert!(!o.ok && o.status == "refused", "{o:?}");
    }

    // ---- IPP ----

    fn ipp_response(rid: u32, status: u16, state: Option<u32>, reasons: &[&str]) -> Vec<u8> {
        let mut b = vec![1, 1];
        b.extend_from_slice(&status.to_be_bytes());
        b.extend_from_slice(&rid.to_be_bytes());
        b.push(0x01);
        let attr = |b: &mut Vec<u8>, tag: u8, name: &str, v: &[u8]| {
            b.push(tag);
            b.extend_from_slice(&(name.len() as u16).to_be_bytes());
            b.extend_from_slice(name.as_bytes());
            b.extend_from_slice(&(v.len() as u16).to_be_bytes());
            b.extend_from_slice(v);
        };
        attr(&mut b, 0x47, "attributes-charset", b"utf-8");
        b.push(0x04); // printer attributes
        if let Some(st) = state {
            attr(&mut b, 0x23, "printer-state", &st.to_be_bytes());
        }
        for (i, r) in reasons.iter().enumerate() {
            attr(&mut b, 0x44, if i == 0 { "printer-state-reasons" } else { "" }, r.as_bytes());
        }
        b.push(0x03);
        b
    }

    /// An IPP printer: reads the POST, answers with the response its
    /// request id asks for, by Content-Length or chunked.
    fn ipp_fake(status: u16, state: Option<u32>, reasons: &'static [&'static str], chunked: bool) -> (u16, mpsc::Receiver<Vec<u8>>) {
        ipp_fake_after(b"", status, state, reasons, chunked)
    }
    /// ipp_fake, sending `pre` (an interim response) before its answer.
    fn ipp_fake_after(pre: &'static [u8], status: u16, state: Option<u32>, reasons: &'static [&'static str], chunked: bool) -> (u16, mpsc::Receiver<Vec<u8>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let Ok((mut s, _)) = l.accept() else { return };
            let mut got = Vec::new();
            let mut b = [0u8; 1];
            while !got.ends_with(b"\r\n\r\n") {
                match s.read(&mut b) {
                    Ok(1) => got.push(b[0]),
                    _ => break,
                }
            }
            let head = String::from_utf8_lossy(&got).to_string();
            let len: usize = head.lines().find_map(|l| l.strip_prefix("Content-Length: ")).unwrap().trim().parse().unwrap();
            let mut body = vec![0u8; len];
            s.read_exact(&mut body).unwrap();
            let rid = u32::from_be_bytes(body[4..8].try_into().unwrap());
            got.extend(&body);
            let _ = tx.send(got);
            let _ = s.write_all(pre);
            let r = ipp_response(rid, status, state, reasons);
            if chunked {
                let (a, z) = r.split_at(r.len() / 2);
                let mut out = b"HTTP/1.1 200 OK\r\nContent-Type: application/ipp\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
                for part in [a, z] {
                    out.extend(format!("{:x}\r\n", part.len()).as_bytes());
                    out.extend(part);
                    out.extend(b"\r\n");
                }
                out.extend(b"0\r\n\r\n");
                let _ = s.write_all(&out);
            } else {
                let mut out = format!("HTTP/1.1 200 OK\r\nContent-Type: application/ipp\r\nContent-Length: {}\r\n\r\n", r.len()).into_bytes();
                out.extend(r);
                let _ = s.write_all(&out);
            }
        });
        (port, rx)
    }

    #[test]
    fn ipp_asks_the_state_only() {
        let (port, rx) = ipp_fake(0, Some(3), &["none"], false);
        let o = run(&spec("ipp", port));
        assert!(o.ok && o.status == "0000 idle", "{o:?}");
        let got = rx.recv().unwrap();
        let split = got.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        let head = String::from_utf8_lossy(&got[..split]).to_string();
        assert!(head.starts_with("POST /ipp/print HTTP/1.1\r\n"), "{head}");
        assert!(head.contains("Content-Type: application/ipp\r\n"), "{head}");
        let body = &got[split..];
        assert_eq!(&body[..4], &[1, 1, 0, 0x0b], "IPP/1.1 Get-Printer-Attributes");
        let text = String::from_utf8_lossy(body);
        assert!(text.contains(&format!("ipp://127.0.0.1:{port}/ipp/print")), "{text}");
        assert!(text.contains("requested-attributes") && text.contains("printer-state") && text.contains("printer-state-reasons"));
        // Only those two are asked for; nothing that names a person or a job.
        let asked: Vec<&str> = ["printer-name", "printer-location", "job", "requesting-user-name", "all", "document"].into_iter().filter(|w| text.contains(w)).collect();
        assert!(asked.is_empty(), "{asked:?}");
        assert_eq!(ipp_request("ipp://x/", 7), {
            let mut b = vec![1, 1, 0, 0x0b, 0, 0, 0, 7, 1];
            for (tag, n, v) in [(0x47u8, "attributes-charset", "utf-8"), (0x48, "attributes-natural-language", "en"), (0x45, "printer-uri", "ipp://x/"), (0x44, "requested-attributes", "printer-state"), (0x44, "", "printer-state-reasons")] {
                b.push(tag);
                b.extend((n.len() as u16).to_be_bytes());
                b.extend(n.as_bytes());
                b.extend((v.len() as u16).to_be_bytes());
                b.extend(v.as_bytes());
            }
            b.push(3);
            b
        });
        // A stopped printer still answers, and says why; chunked replies.
        let (port, _rx) = ipp_fake(0, Some(5), &["media-empty-error", "toner-low-report"], true);
        let o = run(&spec("ipp", port));
        assert!(o.ok && o.status == "0000 stopped media-empty-error,toner-low-report", "{o:?}");
        // A "100 Continue" first (some printers send one before every
        // answer): passed, and the answer after it read (D325).
        let (port, _rx) = ipp_fake_after(b"HTTP/1.1 100 Continue\r\n\r\n", 0, Some(5), &["media-empty-error"], false);
        let o = run(&spec("ipp", port));
        assert!(o.ok && o.status == "0000 stopped media-empty-error", "{o:?}");
        let (port, _rx) = ipp_fake_after(b"HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 102 Processing\r\nX: y\r\n\r\n", 0, Some(3), &[], true);
        assert_eq!(run(&spec("ipp", port)).status, "0000 idle");
        let (port, _rx) = text_fake(b"HTTP/1.1 100 Continue\r\n\r\n".repeat(5));
        assert_eq!(run(&spec("ipp", port)).status, "bad-reply", "no end of interim answers");
        // The path given; a client error answers (the IPP service spoke), a
        // server error does not.
        let (port, rx) = ipp_fake(0x0406, None, &[], false);
        let mut s = spec("ipp", port);
        s.path = "/printers/front".into();
        let o = run(&s);
        assert!(o.ok && o.status == "0406", "{o:?}");
        assert!(rx.recv().unwrap().starts_with(b"POST /printers/front HTTP/1.1\r\n"));
        let (port, _rx) = ipp_fake(0x0502, Some(3), &[], false);
        let o = run(&spec("ipp", port));
        assert!(!o.ok && o.status == "0502 idle", "{o:?}");
        // The web server in front: a 401 answers, a 503 does not.
        let (port, _rx) = text_fake(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n".to_vec());
        let o = run(&spec("ipp", port));
        assert!(o.ok && o.status == "http 401", "{o:?}");
        let (port, _rx) = text_fake(b"HTTP/1.1 503 Busy\r\nContent-Length: 0\r\n\r\n".to_vec());
        assert!(!run(&spec("ipp", port)).ok);
        // Not IPP inside a 200.
        let (port, _rx) = text_fake(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello".to_vec());
        assert_eq!(run(&spec("ipp", port)).status, "bad-reply");
        assert!(ipp_reply(&[1, 1, 0, 0, 0, 0, 0, 9, 3], 8).is_none(), "another request's reply");
        assert!(ipp_reply(&[1, 1, 0, 0, 0, 0, 0, 9, 0x04, 0x23, 0, 50], 9).is_none(), "cut short");
        assert_eq!(ipp_path(""), "/ipp/print");
        assert_eq!(ipp_path("/x y"), "/");
    }

    // ---- IMAP and POP ----

    /// A mail server (IMAP or POP): greets, offers STARTTLS/STLS when asked,
    /// answers LOGOUT/QUIT, and records every line. Any other command (a
    /// login above all) is recorded and fails the test.
    fn mail_fake(kind: Mail, greeting: &'static str, offer_tls: bool, implicit: bool, cfg: Arc<rustls::ServerConfig>) -> (u16, mpsc::Receiver<Vec<String>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let Ok((tcp, _)) = l.accept() else { return };
            tcp.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut seen = Vec::new();
            fn serve<S: Read + Write>(s: &mut S, kind: Mail, offer_tls: bool, seen: &mut Vec<String>, prefix: &str) -> bool {
                // true: STARTTLS agreed, go on over TLS.
                while let Ok(line) = read_line_limited(s) {
                    seen.push(format!("{prefix}{line}"));
                    let mut words = line.split_whitespace();
                    let (tag, cmd) = match kind {
                        Mail::Imap => (words.next().unwrap_or("").to_string(), words.next().unwrap_or("").to_ascii_uppercase()),
                        Mail::Pop => (String::new(), words.next().unwrap_or("").to_ascii_uppercase()),
                    };
                    match (kind, cmd.as_str()) {
                        (Mail::Imap, "STARTTLS") if offer_tls => {
                            let _ = s.write_all(format!("{tag} OK Begin TLS now\r\n").as_bytes());
                            return true;
                        }
                        (Mail::Imap, "STARTTLS") => {
                            let _ = s.write_all(format!("{tag} BAD not here\r\n").as_bytes());
                        }
                        (Mail::Imap, "LOGOUT") => {
                            let _ = s.write_all(format!("* BYE\r\n{tag} OK LOGOUT done\r\n").as_bytes());
                            return false;
                        }
                        (Mail::Pop, "STLS") if offer_tls => {
                            let _ = s.write_all(b"+OK begin TLS\r\n");
                            return true;
                        }
                        (Mail::Pop, "QUIT") => {
                            let _ = s.write_all(b"+OK bye\r\n");
                            return false;
                        }
                        _ => {
                            let _ = s.write_all(if kind == Mail::Imap { format!("{tag} BAD no\r\n") } else { "-ERR no\r\n".into() }.as_bytes());
                        }
                    }
                }
                false
            }
            if implicit {
                let mut tls = rustls::StreamOwned::new(rustls::ServerConnection::new(cfg).unwrap(), tcp);
                let _ = tls.write_all(greeting.as_bytes());
                let _ = tls.flush();
                serve(&mut tls, kind, false, &mut seen, "tls:");
            } else {
                let mut tcp = tcp;
                let _ = tcp.write_all(greeting.as_bytes());
                if serve(&mut tcp, kind, offer_tls, &mut seen, "") {
                    let mut tls = rustls::StreamOwned::new(rustls::ServerConnection::new(cfg).unwrap(), tcp);
                    serve(&mut tls, kind, false, &mut seen, "tls:");
                    let _ = tls.flush();
                }
            }
            let _ = tx.send(seen);
        });
        (port, rx)
    }

    /// Never a login: only STARTTLS/STLS and LOGOUT/QUIT were sent.
    fn never_a_login(seen: &[String]) {
        for l in seen {
            let u = l.trim_start_matches("tls:").to_ascii_uppercase();
            for w in ["LOGIN", "AUTHENTICATE", "AUTH", "USER", "PASS", "APOP", "SELECT", "RETR", "LIST"] {
                assert!(!u.split_whitespace().any(|x| x == w), "sent {w}: {l}");
            }
            assert!(["A1 STARTTLS", "A2 LOGOUT", "STLS", "QUIT"].contains(&u.as_str()), "sent more than the check needs: {l}");
        }
    }

    #[test]
    fn imap_greeting_and_logout() {
        let cfg = tls_cfg(CERT_A, KEY_A);
        let (port, rx) = mail_fake(Mail::Imap, "* OK [CAPABILITY IMAP4rev1 STARTTLS] ready\r\n", true, false, cfg.clone());
        let o = run(&spec("imap", port));
        assert!(o.ok && o.status == "OK" && o.cert_not_after.is_none(), "{o:?}");
        let seen = rx.recv().unwrap();
        assert_eq!(seen, vec!["a2 LOGOUT".to_string()]);
        never_a_login(&seen);
        // STARTTLS for the certificate's end date, then LOGOUT inside it.
        let (port, rx) = mail_fake(Mail::Imap, "* OK ready\r\n", true, false, cfg.clone());
        let mut s = spec("imap", port);
        s.tls = "starttls".into();
        let o = run(&s);
        assert!(o.ok && o.status == "OK" && o.cert_not_after == Some(CERT_A_END), "{o:?}");
        let seen = rx.recv().unwrap();
        assert_eq!(seen, vec!["a1 STARTTLS".to_string(), "tls:a2 LOGOUT".to_string()]);
        never_a_login(&seen);
        // Asked for, refused: it answers, and says so.
        let (port, rx) = mail_fake(Mail::Imap, "* OK ready\r\n", false, false, cfg.clone());
        let mut s = spec("imap", port);
        s.tls = "starttls".into();
        let o = run(&s);
        assert!(o.ok && o.status == "OK no STARTTLS", "{o:?}");
        never_a_login(&rx.recv().unwrap());
        // TLS from the start (993), with a certificate that has ended: still
        // answering, its date read.
        let (port, rx) = mail_fake(Mail::Imap, "* OK ready\r\n", false, true, tls_cfg(CERT_ENDED, KEY_ENDED));
        let mut s = spec("imap", port);
        s.tls = "implicit".into();
        let o = run(&s);
        assert!(o.ok && o.cert_not_after == Some(CERT_ENDED_END), "{o:?}");
        assert_eq!(rx.recv().unwrap(), vec!["tls:a2 LOGOUT".to_string()]);
        // PREAUTH answers; BYE does not; something else is not IMAP.
        let (port, _rx) = mail_fake(Mail::Imap, "* PREAUTH welcome\r\n", false, false, cfg.clone());
        assert_eq!(run(&spec("imap", port)).status, "PREAUTH");
        let (port, rx) = mail_fake(Mail::Imap, "* BYE too busy\r\n", false, false, cfg.clone());
        let o = run(&spec("imap", port));
        assert!(!o.ok && o.status == "BYE" && o.rtt_ms.is_some(), "{o:?}");
        never_a_login(&rx.recv().unwrap());
        let (port, _rx) = mail_fake(Mail::Imap, "220 smtp here\r\n", false, false, cfg);
        assert_eq!(run(&spec("imap", port)).status, "bad-reply");
        assert_eq!(run(&spec("imap", free_port())).status, "refused");
    }

    #[test]
    fn pop_greeting_and_quit() {
        let cfg = tls_cfg(CERT_A, KEY_A);
        let (port, rx) = mail_fake(Mail::Pop, "+OK POP3 ready\r\n", true, false, cfg.clone());
        let o = run(&spec("pop", port));
        assert!(o.ok && o.status == "+OK", "{o:?}");
        let seen = rx.recv().unwrap();
        assert_eq!(seen, vec!["QUIT".to_string()]);
        never_a_login(&seen);
        let (port, rx) = mail_fake(Mail::Pop, "+OK POP3 ready\r\n", true, false, cfg.clone());
        let mut s = spec("pop", port);
        s.tls = "starttls".into();
        let o = run(&s);
        assert!(o.ok && o.cert_not_after == Some(CERT_A_END), "{o:?}");
        let seen = rx.recv().unwrap();
        assert_eq!(seen, vec!["STLS".to_string(), "tls:QUIT".to_string()]);
        never_a_login(&seen);
        let (port, rx) = mail_fake(Mail::Pop, "+OK POP3 ready\r\n", false, false, cfg.clone());
        let mut s = spec("pop", port);
        s.tls = "starttls".into();
        let o = run(&s);
        assert!(o.ok && o.status == "+OK no STLS", "{o:?}");
        never_a_login(&rx.recv().unwrap());
        let (port, rx) = mail_fake(Mail::Pop, "+OK ready\r\n", false, true, cfg.clone());
        let mut s = spec("pop", port);
        s.tls = "implicit".into();
        let o = run(&s);
        assert!(o.ok && o.cert_not_after == Some(CERT_A_END), "{o:?}");
        assert_eq!(rx.recv().unwrap(), vec!["tls:QUIT".to_string()]);
        let (port, _rx) = mail_fake(Mail::Pop, "-ERR not now\r\n", false, false, cfg);
        let o = run(&spec("pop", port));
        assert!(!o.ok && o.status == "-ERR", "{o:?}");
        assert_eq!(mail_greeting(Mail::Pop, "+ok hi"), Some((true, "+OK")));
        assert_eq!(mail_greeting(Mail::Imap, "* ok hi"), Some((true, "OK")));
        assert_eq!(mail_greeting(Mail::Imap, "+OK"), None);
    }

    // ---- One deadline per check ----

    /// A device that sends one byte every 100 ms and never a whole line.
    fn drip_fake() -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        thread::spawn(move || {
            let Ok((mut s, _)) = l.accept() else { return };
            while s.write_all(b"x").is_ok() {
                thread::sleep(Duration::from_millis(100));
            }
        });
        port
    }

    #[test]
    fn a_dripping_device_cannot_hold_a_check() {
        // Each read gets an answer within its timeout, so only a deadline
        // for the whole check ends it (D325).
        for (proto, tls, transport) in [("rtsp", "", ""), ("sip", "", "tcp"), ("ipp", "", ""), ("imap", "", ""), ("pop", "starttls", ""), ("smtp", "", "")] {
            let mut s = spec(proto, drip_fake());
            s.tls = tls.into();
            s.transport = transport.into();
            s.timeout_ms = 600;
            let t = Instant::now();
            let o = run(&s);
            let took = t.elapsed();
            assert!(!o.ok && o.status == "timeout", "{proto}: {o:?}");
            assert!(took < Duration::from_millis(1500), "{proto} took {took:?}");
        }
    }
}
