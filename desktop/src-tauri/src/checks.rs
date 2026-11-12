// The answer checks (docs/SCOPE.md D128, D155, step 7f): each asks one
// device or service already in the document one question, "are you
// answering?", and keeps only the outcome: answered or not, the time taken,
// the reply's status code, and for TLS the day the certificate ends.
//
//   ping    ICMP echo: an unprivileged datagram ICMP socket on Linux and
//           macOS, IcmpSendEcho on Windows. Where the system refuses ICMP,
//           a TCP connect to a port the item documents, said as "TCP, not
//           ping" (`via: "tcp"`): a refused connection is an answer there,
//           since the device itself said no.
//   tcp     a TCP connect to the port; a refusal is no answer.
//   http(s) GET of one path (/ unless given), the status line only, no
//           redirect followed: 2xx, 3xx and 4xx answer (a login page says
//           401), 5xx does not. HTTPS reads the certificate's end date
//           (a warning at 14 days, D155) and does not judge the
//           certificate: trust is not what the check asks, and it sends
//           nothing secret.
//   dns     one query (A, recursion desired) for the name the owner gave;
//           answered when the reply is NOERROR with an answer.
//   smtp    the 220 greeting, EHLO, then QUIT; with STARTTLS asked for and
//           offered, STARTTLS and the handshake (the certificate's end
//           date), then QUIT. Never AUTH, never MAIL FROM: nothing is sent.
//   dicom   A-ASSOCIATE-RQ with Verification (1.2.840.10008.1.1) between
//           the calling and called AE titles (calling "TOPO" by default),
//           C-ECHO-RQ, then A-RELEASE-RQ. Hand-written PDUs.
//
// Step 7k, the remaining checks (D315-D324):
//   ntp     one client request (48 bytes, version 4, a random transmit
//           time); the stratum and the clock offset (a warning above 1 s).
//           A kiss-o'-death (stratum 0) or an unsynchronised server (leap
//           3, stratum 16 or more) is not answering: it serves no time.
//   rtsp    OPTIONS, the status line only: 2xx-4xx answer, 5xx does not.
//   sip     OPTIONS over UDP (as shipped) or TCP, the final status only
//           (provisional 1xx waited past): 2xx-4xx and 6xx answer, 5xx
//           does not. One datagram, never retransmitted.
//   mllp    HL7 MLLP: a TCP connect and nothing else. No byte is sent, so
//           no test message can reach a real RIS.
//   ipp     Get-Printer-Attributes asking only for printer-state and
//           printer-state-reasons, over HTTP (ipp://, port 631). The IPP
//           status, the printer's state and up to 4 reasons (keywords) are
//           the status; 5xx or an IPP server error does not answer.
//   imap    the greeting (OK or PREAUTH answers, BYE does not), optionally
//           STARTTLS or TLS from the start for the certificate's end date,
//           then LOGOUT. Never LOGIN or AUTHENTICATE.
//   pop     the greeting (+OK answers, -ERR does not), optionally STLS or
//           TLS from the start, then QUIT. Never USER, PASS, APOP or AUTH.
//
// Addresses are the document's IP literals: no name is ever looked up.
// No crate beyond what the app has: rustls (for TLS), ring (for random
// ids), libc (the ICMP socket on Linux and macOS); Windows declares its
// two ICMP calls itself.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::{Deserialize, Serialize};

pub const PROTOCOLS: [&str; 15] = ["ping", "tcp", "http", "https", "dns", "smtp", "dicom", "ntp", "rtsp", "sip", "mllp", "ipp", "imap", "pop", "tls"];
pub const DEFAULT_TIMEOUT_MS: u64 = 5000;
/// DICOM and SMTP say more than one thing before they are done.
pub const LONG_TIMEOUT_MS: u64 = 10_000;
pub const CALLING_AE_DEFAULT: &str = "TOPO";
/// A greeting, a reply or an HTTP status line longer than this is not one.
const LINE_MAX: usize = 4096;

/// What to ask, as the page sends it (js/checks.js monitorPlan).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Spec {
    pub proto: String,
    /// The device's address, an IP literal; or a watched address's host name
    /// (step 8d), looked up once per check and sent as the TLS server name
    /// and the HTTP Host.
    pub host: String,
    /// 0: the protocol's own (80, 443, 53, 25, 104).
    pub port: u16,
    /// ping only: the TCP port asked instead where the system refuses ICMP
    /// (0: none documented, and the check cannot run on this PC).
    pub fallback_port: u16,
    /// http(s), rtsp: the path asked for ("/" when empty); ipp: the
    /// printer's path ("/ipp/print" when empty).
    pub path: String,
    /// dns: the name asked for.
    pub name: String,
    /// smtp: STARTTLS (to read the certificate's end date).
    pub starttls: bool,
    /// dicom: the AE titles ("" calling: TOPO; "" called: ANY-SCP).
    pub called_ae: String,
    pub calling_ae: String,
    /// imap, pop: "starttls" (STARTTLS or STLS), "implicit" (TLS from the
    /// start, ports 993 and 995), or "" (neither).
    pub tls: String,
    /// sip: "tcp", or "" for UDP.
    pub transport: String,
    /// 0: DEFAULT_TIMEOUT_MS (LONG_TIMEOUT_MS for smtp and dicom).
    pub timeout_ms: u64,
}

impl Spec {
    pub fn default_port(proto: &str) -> u16 {
        match proto {
            "http" => 80,
            "https" => 443,
            "dns" => 53,
            "smtp" => 25,
            "dicom" => 104,
            "ntp" => 123,
            "rtsp" => 554,
            "sip" => 5060,
            "mllp" => 2575,
            "ipp" => 631,
            "imap" => 143,
            "pop" => 110,
            "tls" => 443,
            _ => 0,
        }
    }
    pub fn port(&self) -> u16 {
        if self.port != 0 {
            return self.port;
        }
        match (self.proto.as_str(), self.tls.as_str()) {
            ("imap", "implicit") => 993,
            ("pop", "implicit") => 995,
            (p, _) => Spec::default_port(p),
        }
    }
    pub fn timeout(&self) -> Duration {
        let ms = if self.timeout_ms > 0 {
            self.timeout_ms.min(60_000)
        } else if matches!(self.proto.as_str(), "smtp" | "dicom" | "imap" | "pop") {
            LONG_TIMEOUT_MS
        } else {
            DEFAULT_TIMEOUT_MS
        };
        Duration::from_millis(ms)
    }
}

/// What came back. `skipped`: the check could not be asked from this PC
/// (no ICMP and no TCP port documented, an address that is not one), which
/// counts as unknown, never as down.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub ok: bool,
    pub skipped: bool,
    /// Milliseconds to the answer (the connect for tcp, the echo for ping,
    /// the greeting or status line otherwise). None without an answer.
    pub rtt_ms: Option<f64>,
    /// The reply's status: "echo", "open", "200", "NOERROR", "220",
    /// "0000" (DICOM success), or what failed: "timeout", "refused",
    /// "unreachable", "rejected 1/1/7", "bad-reply", "address"...
    pub status: String,
    /// "icmp", or "tcp" for a ping that fell back to TCP ("TCP, not ping").
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub via: String,
    /// The TLS certificate's end, unix seconds (https, smtp STARTTLS).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cert_not_after: Option<i64>,
    /// ntp: this PC's clock against the server's, in milliseconds (the
    /// server ahead is positive); a warning above 1 s either way.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub offset_ms: Option<f64>,
}

impl Outcome {
    fn fail(status: impl Into<String>) -> Outcome {
        Outcome { status: status.into(), ..Default::default() }
    }
    fn skip(status: impl Into<String>) -> Outcome {
        Outcome { skipped: true, status: status.into(), ..Default::default() }
    }
    fn answered(status: impl Into<String>, started: Instant) -> Outcome {
        Outcome { ok: true, rtt_ms: Some(ms_since(started)), status: status.into(), ..Default::default() }
    }
}

fn ms_since(t: Instant) -> f64 {
    (t.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0
}

/// Days until a certificate ends, counted from `now` (unix seconds); the
/// day it ends counts as 0, an ended one is negative.
#[allow(dead_code)] // the reports (7j) and the alarm (7g) say it; the page counts it today
pub fn cert_days_left(not_after: i64, now: i64) -> i64 {
    (not_after - now).div_euclid(86_400)
}
/// D155: a warning when it ends within 14 days.
#[allow(dead_code)]
pub const CERT_WARN_DAYS: i64 = 14;

/// A host name as a watched address may hold one (letters, digits, dots,
/// hyphens and underscores, at most 253): never a URL, a list or a range.
fn host_name_ok(h: &str) -> bool {
    !h.is_empty() && h.len() <= 253 && h.chars().any(|c| c.is_ascii_alphabetic())
        && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        && !h.starts_with('.') && !h.contains("..")
}
/// A host name's address, looked up by the system (an IPv4 one first, as
/// most of what a site checks answers there). None when it does not resolve.
pub fn resolve(name: &str) -> Option<IpAddr> {
    use std::net::ToSocketAddrs;
    let all: Vec<IpAddr> = (name, 0u16).to_socket_addrs().ok()?.map(|a| a.ip()).collect();
    all.iter().find(|ip| ip.is_ipv4()).or_else(|| all.first()).copied()
}

/// Runs one check. Never panics on what a device sends.
pub fn run(spec: &Spec) -> Outcome {
    let host = spec.host.trim();
    let ip = match host.parse::<IpAddr>() {
        Ok(ip) => ip,
        // A watched address's host name (step 8d): looked up now; one that
        // does not resolve is not answering, as far as this PC can tell.
        Err(_) if host_name_ok(host) => match resolve(host) {
            Some(ip) => ip,
            None => return Outcome::fail("resolve"),
        },
        Err(_) => return Outcome::skip("address"),
    };
    let timeout = spec.timeout();
    match spec.proto.as_str() {
        "ping" => ping(ip, spec, timeout),
        "tcp" => {
            if spec.port == 0 {
                return Outcome::skip("no-port");
            }
            tcp(ip, spec.port, timeout)
        }
        "http" => http(ip, spec, false, timeout),
        "https" => http(ip, spec, true, timeout),
        "dns" => dns(ip, spec, timeout),
        "smtp" => smtp(ip, spec, timeout),
        "dicom" => dicom(ip, spec, timeout),
        "ntp" => ntp(ip, spec, timeout),
        "rtsp" => rtsp(ip, spec, timeout),
        "sip" => sip(ip, spec, timeout),
        "mllp" => mllp(ip, spec.port(), timeout),
        "ipp" => ipp(ip, spec, timeout),
        "imap" => mail(ip, spec, Mail::Imap, timeout),
        "pop" => mail(ip, spec, Mail::Pop, timeout),
        "tls" => tls_cert(ip, spec, timeout),
        _ => Outcome::skip("protocol"),
    }
}

fn io_status(e: &std::io::Error) -> String {
    use std::io::ErrorKind as K;
    match e.kind() {
        K::TimedOut | K::WouldBlock => "timeout".into(),
        K::ConnectionRefused => "refused".into(),
        K::ConnectionReset | K::ConnectionAborted | K::BrokenPipe | K::UnexpectedEof => "closed".into(),
        _ => match e.raw_os_error() {
            Some(c) if is_unreachable(c) => "unreachable".into(),
            _ => "error".into(),
        },
    }
}

#[cfg(unix)]
fn is_unreachable(code: i32) -> bool {
    code == libc::ENETUNREACH || code == libc::EHOSTUNREACH || code == libc::EHOSTDOWN || code == libc::ENETDOWN
}
#[cfg(windows)]
fn is_unreachable(code: i32) -> bool {
    // WSAENETDOWN, WSAENETUNREACH, WSAEHOSTDOWN, WSAEHOSTUNREACH.
    matches!(code, 10050 | 10051 | 10064 | 10065)
}

fn connect(ip: IpAddr, port: u16, timeout: Duration) -> std::io::Result<TcpStream> {
    let s = TcpStream::connect_timeout(&SocketAddr::new(ip, port), timeout)?;
    s.set_read_timeout(Some(timeout))?;
    s.set_write_timeout(Some(timeout))?;
    s.set_nodelay(true)?;
    Ok(s)
}

/// A TCP stream with one deadline for the whole check, not one per read
/// (D325): before each read or write its timeout is set to the time left,
/// and once that is gone every read and write is a timeout. A device that
/// sends a byte every few seconds cannot hold a check (and one of the
/// monitor's few workers) past it.
pub(super) struct Bounded {
    s: TcpStream,
    end: Instant,
}

impl Bounded {
    /// `s` bound to end at `started + timeout`.
    fn new(s: TcpStream, started: Instant, timeout: Duration) -> Bounded {
        Bounded { s, end: started + timeout }
    }
    fn left(&self) -> std::io::Result<Duration> {
        let left = self.end.saturating_duration_since(Instant::now());
        if left.is_zero() { Err(std::io::ErrorKind::TimedOut.into()) } else { Ok(left) }
    }
    fn try_clone(&self) -> std::io::Result<Bounded> {
        Ok(Bounded { s: self.s.try_clone()?, end: self.end })
    }
    fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.s.local_addr()
    }
}

impl Read for Bounded {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let left = self.left()?;
        self.s.set_read_timeout(Some(left))?;
        self.s.read(buf)
    }
}

impl Write for Bounded {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let left = self.left()?;
        self.s.set_write_timeout(Some(left))?;
        self.s.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.s.flush()
    }
}

/// connect(), its stream bound to end at `started + timeout`.
fn connect_bounded(ip: IpAddr, port: u16, started: Instant, timeout: Duration) -> std::io::Result<Bounded> {
    Ok(Bounded::new(connect(ip, port, timeout)?, started, timeout))
}

// ---- TCP ----

fn tcp(ip: IpAddr, port: u16, timeout: Duration) -> Outcome {
    let t = Instant::now();
    match TcpStream::connect_timeout(&SocketAddr::new(ip, port), timeout) {
        Ok(_) => Outcome::answered("open", t),
        Err(e) => Outcome::fail(io_status(&e)),
    }
}

// ---- Ping ----

/// What the system said to an ICMP socket.
#[derive(Debug, PartialEq)]
pub enum Icmp {
    /// The echo came back after this many milliseconds.
    Reply(f64),
    /// No echo in time, or the network said the host is unreachable.
    NoReply(String),
    /// This PC does not allow it (no unprivileged ICMP): ask TCP instead.
    Refused,
}

fn ping(ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    ping_with(icmp_echo, ip, spec, timeout)
}

/// The ping with its ICMP step given (the tests give a refusing one, so the
/// "TCP, not ping" fallback runs here whatever this PC allows).
fn ping_with(icmp: impl Fn(IpAddr, Duration) -> Icmp, ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    match icmp(ip, timeout) {
        Icmp::Reply(ms) => Outcome { ok: true, rtt_ms: Some(ms), status: "echo".into(), via: "icmp".into(), ..Default::default() },
        Icmp::NoReply(why) => Outcome { status: why, via: "icmp".into(), ..Default::default() },
        Icmp::Refused => {
            if spec.fallback_port == 0 {
                return Outcome { skipped: true, status: "no-icmp".into(), via: "tcp".into(), ..Default::default() };
            }
            let t = Instant::now();
            let mut out = match TcpStream::connect_timeout(&SocketAddr::new(ip, spec.fallback_port), timeout) {
                Ok(_) => Outcome::answered("open", t),
                // The device itself answered "no": it is there.
                Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => Outcome::answered("refused", t),
                Err(e) => Outcome::fail(io_status(&e)),
            };
            out.via = "tcp".into();
            out
        }
    }
}

fn random_bytes<const N: usize>() -> [u8; N] {
    use ring::rand::SecureRandom;
    let mut b = [0u8; N];
    if ring::rand::SystemRandom::new().fill(&mut b).is_err() {
        // Not a secret: only a way to tell our reply from another's.
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        for (i, x) in b.iter_mut().enumerate() {
            *x = (n >> ((i % 16) * 8)) as u8;
        }
    }
    b
}

/// The Internet checksum (RFC 1071).
pub fn inet_checksum(data: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i + 1 < data.len() {
        sum += u16::from_be_bytes([data[i], data[i + 1]]) as u32;
        i += 2;
    }
    if i < data.len() {
        sum += (data[i] as u32) << 8;
    }
    while sum >> 16 != 0 {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    !(sum as u16)
}

/// An echo request: type, code 0, checksum, identifier, sequence, payload.
/// On Linux the kernel sets the identifier (the socket's own) and the
/// checksum again; macOS takes them as given.
pub fn echo_request(v6: bool, ident: u16, seq: u16, payload: &[u8]) -> Vec<u8> {
    let mut p = vec![if v6 { 128 } else { 8 }, 0, 0, 0];
    p.extend_from_slice(&ident.to_be_bytes());
    p.extend_from_slice(&seq.to_be_bytes());
    p.extend_from_slice(payload);
    if !v6 {
        let c = inet_checksum(&p);
        p[2..4].copy_from_slice(&c.to_be_bytes());
    }
    p
}

/// Is this datagram the echo reply to ours? macOS hands an IPv4 ICMP
/// socket the IP header too; Linux does not.
pub fn is_echo_reply(buf: &[u8], v6: bool, seq: u16, payload: &[u8]) -> bool {
    let mut b = buf;
    if !v6 && !b.is_empty() && b[0] >> 4 == 4 {
        let ihl = ((b[0] & 0x0f) as usize) * 4;
        if b.len() < ihl {
            return false;
        }
        b = &b[ihl..];
    }
    if b.len() < 8 + payload.len() {
        return false;
    }
    let want = if v6 { 129 } else { 0 };
    b[0] == want && b[1] == 0 && u16::from_be_bytes([b[6], b[7]]) == seq && &b[8..8 + payload.len()] == payload
}

#[cfg(unix)]
fn icmp_echo(ip: IpAddr, timeout: Duration) -> Icmp {
    use std::mem::{size_of, zeroed};
    let v6 = ip.is_ipv6();
    let (domain, proto) = if v6 { (libc::AF_INET6, libc::IPPROTO_ICMPV6) } else { (libc::AF_INET, libc::IPPROTO_ICMP) };
    // SAFETY: plain socket calls on a descriptor this function owns and
    // closes; every buffer passed is sized by its own length.
    unsafe {
        let fd = libc::socket(domain, libc::SOCK_DGRAM, proto);
        if fd < 0 {
            return Icmp::Refused;
        }
        struct Closer(i32);
        impl Drop for Closer {
            fn drop(&mut self) {
                // SAFETY: the descriptor was opened above and is closed once.
                unsafe { libc::close(self.0) };
            }
        }
        let _c = Closer(fd);
        let tv = libc::timeval { tv_sec: timeout.as_secs() as _, tv_usec: timeout.subsec_micros() as _ };
        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_RCVTIMEO, &tv as *const _ as *const libc::c_void, size_of::<libc::timeval>() as libc::socklen_t);
        let r: [u8; 10] = random_bytes();
        let ident = u16::from_be_bytes([r[0], r[1]]);
        let seq = u16::from_be_bytes([r[2], r[3]]);
        let payload: Vec<u8> = b"topo".iter().chain(r[4..].iter()).copied().collect();
        let pkt = echo_request(v6, ident, seq, &payload);
        let sent = match ip {
            IpAddr::V4(a) => {
                let mut sa: libc::sockaddr_in = zeroed();
                sa.sin_family = libc::AF_INET as _;
                sa.sin_addr = libc::in_addr { s_addr: u32::from_ne_bytes(a.octets()) };
                libc::sendto(fd, pkt.as_ptr() as *const libc::c_void, pkt.len(), 0, &sa as *const _ as *const libc::sockaddr, size_of::<libc::sockaddr_in>() as libc::socklen_t)
            }
            IpAddr::V6(a) => {
                let mut sa: libc::sockaddr_in6 = zeroed();
                sa.sin6_family = libc::AF_INET6 as _;
                sa.sin6_addr = libc::in6_addr { s6_addr: a.octets() };
                libc::sendto(fd, pkt.as_ptr() as *const libc::c_void, pkt.len(), 0, &sa as *const _ as *const libc::sockaddr, size_of::<libc::sockaddr_in6>() as libc::socklen_t)
            }
        };
        let t = Instant::now();
        if sent < 0 {
            let e = std::io::Error::last_os_error();
            return match e.raw_os_error() {
                Some(c) if c == libc::EACCES || c == libc::EPERM => Icmp::Refused,
                _ => Icmp::NoReply(io_status(&e)),
            };
        }
        let mut buf = [0u8; 1500];
        loop {
            let left = timeout.saturating_sub(t.elapsed());
            if left.is_zero() {
                return Icmp::NoReply("timeout".into());
            }
            let tv = libc::timeval { tv_sec: left.as_secs() as _, tv_usec: left.subsec_micros().max(1000) as _ };
            libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_RCVTIMEO, &tv as *const _ as *const libc::c_void, size_of::<libc::timeval>() as libc::socklen_t);
            let n = libc::recv(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len(), 0);
            if n < 0 {
                let e = std::io::Error::last_os_error();
                if e.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Icmp::NoReply(io_status(&e));
            }
            if is_echo_reply(&buf[..n as usize], v6, seq, &payload) {
                return Icmp::Reply(ms_since(t));
            }
        }
    }
}

#[cfg(windows)]
fn icmp_echo(ip: IpAddr, timeout: Duration) -> Icmp {
    use std::ffi::c_void;
    // IPv6 echo (Icmp6SendEcho2) is not asked: TCP instead, said as such.
    let IpAddr::V4(a) = ip else { return Icmp::Refused };
    #[repr(C)]
    struct IpOptionInformation {
        ttl: u8,
        tos: u8,
        flags: u8,
        options_size: u8,
        options_data: *mut u8,
    }
    #[repr(C)]
    struct IcmpEchoReply {
        address: u32,
        status: u32,
        round_trip_time: u32,
        data_size: u16,
        reserved: u16,
        data: *mut c_void,
        options: IpOptionInformation,
    }
    #[link(name = "iphlpapi")]
    extern "system" {
        fn IcmpCreateFile() -> isize;
        fn IcmpCloseHandle(handle: isize) -> i32;
        fn IcmpSendEcho(handle: isize, dest: u32, request: *const c_void, request_size: u16, options: *const c_void, reply: *mut c_void, reply_size: u32, timeout: u32) -> u32;
    }
    let r: [u8; 8] = random_bytes();
    let payload: Vec<u8> = b"topo".iter().chain(r.iter()).copied().collect();
    let size = std::mem::size_of::<IcmpEchoReply>() + payload.len() + 8 + 64;
    let mut reply = vec![0u8; size];
    // SAFETY: the handle is closed once below; the reply buffer is larger
    // than one ICMP_ECHO_REPLY with the payload, as the API asks.
    unsafe {
        let h = IcmpCreateFile();
        if h == -1 || h == 0 {
            return Icmp::Refused;
        }
        let t = Instant::now();
        let n = IcmpSendEcho(
            h,
            u32::from_ne_bytes(a.octets()),
            payload.as_ptr() as *const c_void,
            payload.len() as u16,
            std::ptr::null(),
            reply.as_mut_ptr() as *mut c_void,
            reply.len() as u32,
            timeout.as_millis().min(u32::MAX as u128) as u32,
        );
        let elapsed = ms_since(t);
        IcmpCloseHandle(h);
        if n == 0 {
            return Icmp::NoReply("timeout".into());
        }
        let rep = &*(reply.as_ptr() as *const IcmpEchoReply);
        match rep.status {
            0 => Icmp::Reply(if rep.round_trip_time == 0 { elapsed.min(1.0) } else { rep.round_trip_time as f64 }),
            // IP_DEST_NET_UNREACHABLE, IP_DEST_HOST_UNREACHABLE.
            11002 | 11003 => Icmp::NoReply("unreachable".into()),
            11010 => Icmp::NoReply("timeout".into()),
            _ => Icmp::NoReply("error".into()),
        }
    }
}

// ---- TLS: the certificate's end date, not its trust ----

/// Accepts any certificate and keeps the server's own (the first), so its
/// end date can be read. The check sends nothing secret over it.
#[derive(Debug)]
struct Keep {
    provider: Arc<CryptoProvider>,
    cert: Mutex<Option<Vec<u8>>>,
}

impl ServerCertVerifier for Keep {
    fn verify_server_cert(&self, end_entity: &CertificateDer<'_>, _: &[CertificateDer<'_>], _: &ServerName<'_>, _: &[u8], _: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
        if let Ok(mut c) = self.cert.lock() {
            *c = Some(end_entity.as_ref().to_vec());
        }
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

type Tls<S = TcpStream> = rustls::StreamOwned<rustls::ClientConnection, S>;

/// The handshake over `tcp`; the stream and the certificate's end date.
fn tls_over<S: Read + Write>(tcp: S, ip: IpAddr, host: &str) -> Result<(Tls<S>, Option<i64>), String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let keep = Arc::new(Keep { provider: provider.clone(), cert: Mutex::new(None) });
    let cfg = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|_| "tls".to_string())?
        .dangerous()
        .with_custom_certificate_verifier(keep.clone())
        .with_no_client_auth();
    // A host name goes as the server name (SNI), so a service behind a
    // shared address shows its own certificate; an address goes as itself.
    let name = match host.trim().parse::<IpAddr>() {
        Ok(_) => ServerName::IpAddress(ip.into()),
        Err(_) => ServerName::try_from(host.trim().to_string()).unwrap_or(ServerName::IpAddress(ip.into())),
    };
    let conn = rustls::ClientConnection::new(Arc::new(cfg), name).map_err(|_| "tls".to_string())?;
    let mut tls = rustls::StreamOwned::new(conn, tcp);
    while tls.conn.is_handshaking() {
        if let Err(e) = tls.conn.complete_io(&mut tls.sock) {
            return Err(if e.kind() == std::io::ErrorKind::InvalidData { "tls".into() } else { io_status(&e) });
        }
    }
    let der = keep.cert.lock().ok().and_then(|c| c.clone());
    Ok((tls, der.as_deref().and_then(cert_not_after)))
}

/// A certificate's notAfter (unix seconds), read from its DER:
/// Certificate { tbsCertificate { [0] version?, serial, signature, issuer,
/// validity { notBefore, notAfter }, ... }, ... }.
pub fn cert_not_after(der: &[u8]) -> Option<i64> {
    fn tlv(b: &[u8]) -> Option<(u8, &[u8], &[u8])> {
        let tag = *b.first()?;
        let first = *b.get(1)?;
        let (len, head) = if first < 0x80 {
            (first as usize, 2)
        } else {
            let n = (first & 0x7f) as usize;
            if n == 0 || n > 4 {
                return None;
            }
            let mut l = 0usize;
            for i in 0..n {
                l = (l << 8) | *b.get(2 + i)? as usize;
            }
            (l, 2 + n)
        };
        let body = b.get(head..head.checked_add(len)?)?;
        Some((tag, body, &b[head + len..]))
    }
    let (t, cert, _) = tlv(der)?;
    if t != 0x30 {
        return None;
    }
    let (t, tbs, _) = tlv(cert)?;
    if t != 0x30 {
        return None;
    }
    let mut rest = tbs;
    let (t, _, r) = tlv(rest)?;
    if t == 0xa0 {
        rest = r; // the version
    }
    let (_, _, r) = tlv(rest)?; // serial
    let (_, _, r) = tlv(r)?; // signature algorithm
    let (_, _, r) = tlv(r)?; // issuer
    let (t, validity, _) = tlv(r)?;
    if t != 0x30 {
        return None;
    }
    let (_, _, r) = tlv(validity)?; // notBefore
    let (t, na, _) = tlv(r)?;
    asn1_time(t, std::str::from_utf8(na).ok()?)
}

/// UTCTime (YYMMDDHHMMSSZ, 1950-2049) or GeneralizedTime (YYYYMMDDHHMMSSZ).
fn asn1_time(tag: u8, s: &str) -> Option<i64> {
    let s = s.strip_suffix('Z')?;
    let (y, rest) = match tag {
        0x17 if s.len() == 12 => {
            let yy: i64 = s[..2].parse().ok()?;
            (if yy < 50 { 2000 + yy } else { 1900 + yy }, &s[2..])
        }
        0x18 if s.len() == 14 => (s[..4].parse().ok()?, &s[4..]),
        _ => return None,
    };
    let n = |a: usize| rest.get(a..a + 2).and_then(|x| x.parse::<i64>().ok());
    let (mo, d, h, mi, se) = (n(0)?, n(2)?, n(4)?, n(6)?, n(8)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    Some(days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se)
}

/// Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

// ---- HTTP(S) ----

/// The Host a request names: a watched address's host name as given, an
/// address as host_header writes it.
fn host_header_for(host: &str, ip: IpAddr, port: u16, tls: bool) -> String {
    let h = host.trim();
    if h.parse::<IpAddr>().is_ok() || h.is_empty() {
        return host_header(ip, port, tls);
    }
    if (tls && port == 443) || (!tls && port == 80) { h.to_string() } else { format!("{h}:{port}") }
}
fn host_header(ip: IpAddr, port: u16, tls: bool) -> String {
    let h = match ip {
        IpAddr::V4(a) => a.to_string(),
        IpAddr::V6(a) => format!("[{a}]"),
    };
    if (tls && port == 443) || (!tls && port == 80) { h } else { format!("{h}:{port}") }
}

/// The path asked for: "/" unless the owner gave one; never a whole URL,
/// never anything that could split the request.
pub fn http_path(p: &str) -> String {
    let p = p.trim();
    if p.is_empty() || !p.starts_with('/') || p.starts_with("//") || p.len() > 512 || p.chars().any(|c| c.is_control() || c == ' ') {
        return "/".into();
    }
    p.to_string()
}

/// "HTTP/1.1 200 OK" -> 200.
pub fn http_status(line: &str) -> Option<u16> {
    let mut parts = line.split_whitespace();
    let v = parts.next()?;
    if !v.starts_with("HTTP/") {
        return None;
    }
    let code = parts.next()?;
    if code.len() != 3 {
        return None;
    }
    code.parse().ok()
}

fn read_line_limited<R: Read>(r: &mut R) -> std::io::Result<String> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    while buf.len() < LINE_MAX {
        let n = r.read(&mut byte)?;
        if n == 0 {
            if buf.is_empty() {
                return Err(std::io::ErrorKind::UnexpectedEof.into());
            }
            break;
        }
        if byte[0] == b'\n' {
            break;
        }
        buf.push(byte[0]);
    }
    if buf.last() == Some(&b'\r') {
        buf.pop();
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// TLS certificate (docs/SCOPE.md D375, step 8e): on any port, one
/// handshake, the certificate's end date read, then closed. Nothing is sent
/// after the handshake but the close (no request, no login).
fn tls_cert(ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    let t = Instant::now();
    let tcp = match connect(ip, spec.port(), timeout) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    match tls_over(tcp, ip, &spec.host) {
        Ok((mut s, cert)) => {
            let rtt = ms_since(t);
            s.conn.send_close_notify();
            let _ = s.flush();
            Outcome { ok: true, rtt_ms: Some(rtt), status: "TLS".into(), cert_not_after: cert, ..Default::default() }
        }
        Err(e) => Outcome::fail(e),
    }
}

fn http(ip: IpAddr, spec: &Spec, tls: bool, timeout: Duration) -> Outcome {
    let port = spec.port();
    let t = Instant::now();
    let tcp = match connect(ip, port, timeout) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    let req = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: Topo answer check\r\nAccept: */*\r\nConnection: close\r\n\r\n",
        http_path(&spec.path),
        host_header_for(&spec.host, ip, port, tls)
    );
    let ask = |s: &mut dyn ReadWrite| -> Result<String, String> {
        s.write_all(req.as_bytes()).map_err(|e| io_status(&e))?;
        s.flush().map_err(|e| io_status(&e))?;
        let mut r = BufReader::new(s);
        read_line_limited(&mut r).map_err(|e| io_status(&e))
    };
    let (line, cert) = if tls {
        match tls_over(tcp, ip, &spec.host) {
            Ok((mut s, cert)) => {
                let line = ask(&mut s);
                s.conn.send_close_notify();
                let _ = s.flush();
                (line, cert)
            }
            Err(e) => return Outcome::fail(e),
        }
    } else {
        let mut s = tcp;
        (ask(&mut s), None)
    };
    let mut out = match line {
        Ok(l) => match http_status(&l) {
            Some(code) => Outcome { ok: code < 500, rtt_ms: Some(ms_since(t)), status: code.to_string(), ..Default::default() },
            None => Outcome::fail("bad-reply"),
        },
        Err(e) => Outcome::fail(e),
    };
    out.cert_not_after = cert;
    out
}

trait ReadWrite: Read + Write {}
impl<T: Read + Write> ReadWrite for T {}

// ---- DNS ----

/// A query for `name` (type A, class IN, recursion desired), or None when
/// the name is not one (empty, a label over 63, the whole over 253).
pub fn dns_query(id: u16, name: &str) -> Option<Vec<u8>> {
    let name = name.trim().trim_end_matches('.');
    if name.is_empty() || name.len() > 253 {
        return None;
    }
    let mut q = Vec::with_capacity(18 + name.len());
    q.extend_from_slice(&id.to_be_bytes());
    q.extend_from_slice(&[0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
    for label in name.split('.') {
        if label.is_empty() || label.len() > 63 || !label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
            return None;
        }
        q.push(label.len() as u8);
        q.extend_from_slice(label.as_bytes());
    }
    q.extend_from_slice(&[0, 0, 1, 0, 1]);
    Some(q)
}

pub fn rcode_name(rc: u8) -> String {
    match rc {
        0 => "NOERROR".into(),
        1 => "FORMERR".into(),
        2 => "SERVFAIL".into(),
        3 => "NXDOMAIN".into(),
        4 => "NOTIMP".into(),
        5 => "REFUSED".into(),
        n => format!("RCODE{n}"),
    }
}

/// Is `reply` the answer to query `id`? Some((answered, rcode name)).
pub fn dns_reply(reply: &[u8], id: u16) -> Option<(bool, String)> {
    if reply.len() < 12 || u16::from_be_bytes([reply[0], reply[1]]) != id || reply[2] & 0x80 == 0 {
        return None;
    }
    let rc = reply[3] & 0x0f;
    let truncated = reply[2] & 0x02 != 0;
    let answers = u16::from_be_bytes([reply[6], reply[7]]);
    Some((rc == 0 && (answers > 0 || truncated), rcode_name(rc)))
}

fn dns(ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    let r: [u8; 2] = random_bytes();
    let id = u16::from_be_bytes(r);
    let Some(q) = dns_query(id, &spec.name) else { return Outcome::skip("no-name") };
    let bind: SocketAddr = if ip.is_ipv6() { "[::]:0".parse().unwrap() } else { "0.0.0.0:0".parse().unwrap() };
    let sock = match UdpSocket::bind(bind) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    let t = Instant::now();
    if let Err(e) = sock.connect(SocketAddr::new(ip, spec.port())).and_then(|_| sock.send(&q)) {
        return Outcome::fail(io_status(&e));
    }
    let mut buf = [0u8; 1500];
    loop {
        let left = timeout.saturating_sub(t.elapsed());
        if left.is_zero() {
            return Outcome::fail("timeout");
        }
        let _ = sock.set_read_timeout(Some(left));
        match sock.recv(&mut buf) {
            Ok(n) => {
                if let Some((ok, rc)) = dns_reply(&buf[..n], id) {
                    let rtt = ms_since(t);
                    return Outcome { ok, rtt_ms: Some(rtt), status: if ok || rc != "NOERROR" { rc } else { "NOANSWER".into() }, ..Default::default() };
                }
            }
            Err(e) => return Outcome::fail(io_status(&e)),
        }
    }
}

// ---- SMTP ----

/// One reply: its code and its lines ("250-SIZE", "250 STARTTLS"...).
fn smtp_reply<R: BufRead>(r: &mut R) -> Result<(u16, Vec<String>), String> {
    let mut lines = Vec::new();
    loop {
        let l = read_line_limited(r).map_err(|e| io_status(&e))?;
        if l.len() < 3 || lines.len() > 64 {
            return Err("bad-reply".into());
        }
        let code: u16 = l[..3].parse().map_err(|_| "bad-reply".to_string())?;
        let more = l.as_bytes().get(3) == Some(&b'-');
        lines.push(l);
        if !more {
            return Ok((code, lines));
        }
    }
}

/// What EHLO says about us: our own address literal, nothing more.
pub fn ehlo_line(local: IpAddr) -> String {
    match local {
        IpAddr::V4(a) => format!("EHLO [{a}]\r\n"),
        IpAddr::V6(a) => format!("EHLO [IPv6:{a}]\r\n"),
    }
}

fn smtp(ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    let t = Instant::now();
    let tcp = match connect_bounded(ip, spec.port(), t, timeout) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    let local = tcp.local_addr().map(|a| a.ip()).unwrap_or(IpAddr::from([127, 0, 0, 1]));
    let mut r = BufReader::new(match tcp.try_clone() {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    });
    let mut w = tcp;
    let greet = match smtp_reply(&mut r) {
        Ok((c, _)) => c,
        Err(e) => return Outcome::fail(e),
    };
    let rtt = ms_since(t);
    if greet != 220 {
        let _ = w.write_all(b"QUIT\r\n");
        return Outcome { rtt_ms: Some(rtt), status: greet.to_string(), ..Default::default() };
    }
    if let Err(e) = w.write_all(ehlo_line(local).as_bytes()) {
        return Outcome::fail(io_status(&e));
    }
    let (code, lines) = match smtp_reply(&mut r) {
        Ok(x) => x,
        Err(e) => return Outcome::fail(e),
    };
    if code != 250 {
        let _ = w.write_all(b"QUIT\r\n");
        return Outcome { rtt_ms: Some(rtt), status: code.to_string(), ..Default::default() };
    }
    let offered = lines.iter().any(|l| l.get(4..).map(|x| x.trim().eq_ignore_ascii_case("STARTTLS")).unwrap_or(false));
    if spec.starttls && offered {
        if let Err(e) = w.write_all(b"STARTTLS\r\n") {
            return Outcome::fail(io_status(&e));
        }
        match smtp_reply(&mut r) {
            Ok((220, _)) => {}
            Ok((c, _)) => {
                let _ = w.write_all(b"QUIT\r\n");
                return Outcome { ok: true, rtt_ms: Some(rtt), status: format!("250 STARTTLS {c}"), ..Default::default() };
            }
            Err(e) => return Outcome::fail(e),
        }
        // Nothing is buffered past the 220 (the server waits for the
        // handshake), so the TLS goes on the same socket.
        drop(r);
        let (mut s, cert) = match tls_over(w, ip, &spec.host) {
            Ok(x) => x,
            Err(e) => return Outcome::fail(e),
        };
        let _ = s.write_all(b"QUIT\r\n");
        let _ = s.flush();
        let _ = smtp_reply(&mut BufReader::new(&mut s));
        return Outcome { ok: true, rtt_ms: Some(rtt), status: "250".into(), cert_not_after: cert, ..Default::default() };
    }
    let _ = w.write_all(b"QUIT\r\n");
    let _ = smtp_reply(&mut r);
    Outcome {
        ok: true,
        rtt_ms: Some(rtt),
        status: if spec.starttls && !offered { "250 no STARTTLS".into() } else { "250".into() },
        ..Default::default()
    }
}

// ---- DICOM C-ECHO ----

pub const VERIFICATION: &str = "1.2.840.10008.1.1";
const APP_CONTEXT: &str = "1.2.840.10008.3.1.1.1";
const IMPLICIT_LE: &str = "1.2.840.10008.1.2";
/// Topo's implementation class UID (a 2.25 UUID-derived UID, fixed).
const IMPL_CLASS: &str = "2.25.226147031542330418924395622498102497793";
const IMPL_VERSION: &str = "TOPO_CHECK";

/// An AE title as the PDU carries it: 16 bytes, space padded; only
/// printable ASCII without backslash, at most 16.
pub fn ae_title(s: &str, fallback: &str) -> [u8; 16] {
    let clean: String = s.trim().chars().filter(|c| c.is_ascii_graphic() && *c != '\\' || *c == ' ').take(16).collect();
    let clean = if clean.trim().is_empty() { fallback.to_string() } else { clean };
    let mut out = [b' '; 16];
    for (i, b) in clean.bytes().take(16).enumerate() {
        out[i] = b;
    }
    out
}

fn item(kind: u8, body: &[u8]) -> Vec<u8> {
    let mut v = vec![kind, 0];
    v.extend_from_slice(&(body.len() as u16).to_be_bytes());
    v.extend_from_slice(body);
    v
}

fn pdu(kind: u8, body: &[u8]) -> Vec<u8> {
    let mut v = vec![kind, 0];
    v.extend_from_slice(&(body.len() as u32).to_be_bytes());
    v.extend_from_slice(body);
    v
}

/// The A-ASSOCIATE-RQ: Verification only, Implicit VR Little Endian.
pub fn associate_rq(called: &[u8; 16], calling: &[u8; 16]) -> Vec<u8> {
    let mut b = vec![0, 1, 0, 0];
    b.extend_from_slice(called);
    b.extend_from_slice(calling);
    b.extend_from_slice(&[0u8; 32]);
    b.extend(item(0x10, APP_CONTEXT.as_bytes()));
    let mut pc = vec![1, 0, 0, 0];
    pc.extend(item(0x30, VERIFICATION.as_bytes()));
    pc.extend(item(0x40, IMPLICIT_LE.as_bytes()));
    b.extend(item(0x20, &pc));
    let mut ui = item(0x51, &16_384u32.to_be_bytes());
    ui.extend(item(0x52, IMPL_CLASS.as_bytes()));
    ui.extend(item(0x55, IMPL_VERSION.as_bytes()));
    b.extend(item(0x50, &ui));
    pdu(0x01, &b)
}

/// An element in Implicit VR Little Endian.
fn element(group: u16, elem: u16, value: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(8 + value.len());
    v.extend_from_slice(&group.to_le_bytes());
    v.extend_from_slice(&elem.to_le_bytes());
    v.extend_from_slice(&(value.len() as u32).to_le_bytes());
    v.extend_from_slice(value);
    v
}

/// The C-ECHO-RQ in a P-DATA-TF (one PDV, a command, its last fragment).
pub fn echo_rq(message_id: u16) -> Vec<u8> {
    let mut uid = VERIFICATION.as_bytes().to_vec();
    if uid.len() % 2 == 1 {
        uid.push(0);
    }
    let mut rest = element(0x0000, 0x0002, &uid);
    rest.extend(element(0x0000, 0x0100, &0x0030u16.to_le_bytes()));
    rest.extend(element(0x0000, 0x0110, &message_id.to_le_bytes()));
    rest.extend(element(0x0000, 0x0800, &0x0101u16.to_le_bytes()));
    let mut cmd = element(0x0000, 0x0000, &(rest.len() as u32).to_le_bytes());
    cmd.extend(rest);
    let mut pdv = Vec::new();
    pdv.extend_from_slice(&((cmd.len() + 2) as u32).to_be_bytes());
    pdv.push(1); // the presentation context
    pdv.push(0x03); // a command, the last fragment
    pdv.extend(cmd);
    pdu(0x04, &pdv)
}

/// One PDU: (type, body), at most 1 MB.
pub fn read_pdu<R: Read>(r: &mut R) -> Result<(u8, Vec<u8>), String> {
    let mut head = [0u8; 6];
    r.read_exact(&mut head).map_err(|e| io_status(&e))?;
    let len = u32::from_be_bytes([head[2], head[3], head[4], head[5]]) as usize;
    if len > 1 << 20 {
        return Err("bad-reply".into());
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).map_err(|e| io_status(&e))?;
    Ok((head[0], body))
}

/// Whether an A-ASSOCIATE-AC accepted our one presentation context.
pub fn ac_accepts(body: &[u8]) -> bool {
    let mut i = 68usize; // version, reserved, AE titles, reserved
    while i + 4 <= body.len() {
        let kind = body[i];
        let len = u16::from_be_bytes([body[i + 2], body[i + 3]]) as usize;
        let start = i + 4;
        if start + len > body.len() {
            return false;
        }
        if kind == 0x21 && len >= 4 {
            return body[start] == 1 && body[start + 2] == 0;
        }
        i = start + len;
    }
    false
}

/// The status (0000,0900) of a C-ECHO-RSP in a P-DATA-TF body.
pub fn echo_rsp_status(body: &[u8]) -> Option<u16> {
    let mut i = 0usize;
    while i + 6 <= body.len() {
        let len = u32::from_be_bytes([body[i], body[i + 1], body[i + 2], body[i + 3]]) as usize;
        let start = i + 6;
        let end = (i + 4).checked_add(len)?;
        if len < 2 || end > body.len() {
            return None;
        }
        let mut j = start;
        while j + 8 <= end {
            let g = u16::from_le_bytes([body[j], body[j + 1]]);
            let e = u16::from_le_bytes([body[j + 2], body[j + 3]]);
            let l = u32::from_le_bytes([body[j + 4], body[j + 5], body[j + 6], body[j + 7]]) as usize;
            let v = j + 8;
            if v + l > end {
                break;
            }
            if g == 0 && e == 0x0900 && l == 2 {
                return Some(u16::from_le_bytes([body[v], body[v + 1]]));
            }
            j = v + l;
        }
        i = end;
    }
    None
}

fn dicom(ip: IpAddr, spec: &Spec, timeout: Duration) -> Outcome {
    let called = ae_title(&spec.called_ae, "ANY-SCP");
    let calling = ae_title(&spec.calling_ae, CALLING_AE_DEFAULT);
    let t = Instant::now();
    let mut s = match connect(ip, spec.port(), timeout) {
        Ok(s) => s,
        Err(e) => return Outcome::fail(io_status(&e)),
    };
    if let Err(e) = s.write_all(&associate_rq(&called, &calling)) {
        return Outcome::fail(io_status(&e));
    }
    match read_pdu(&mut s) {
        Ok((0x02, body)) => {
            if !ac_accepts(&body) {
                let _ = s.write_all(&pdu(0x05, &[0, 0, 0, 0]));
                return Outcome { rtt_ms: Some(ms_since(t)), status: "no-verification".into(), ..Default::default() };
            }
        }
        // A-ASSOCIATE-RJ: result, source, reason (PS3.8 9.3.4); an AE title
        // not recognised is 1/1/7 (called) or 1/1/3 (calling).
        Ok((0x03, body)) if body.len() >= 4 => {
            return Outcome { rtt_ms: Some(ms_since(t)), status: format!("rejected {}/{}/{}", body[1], body[2], body[3]), ..Default::default() };
        }
        Ok((0x07, _)) => return Outcome::fail("aborted"),
        Ok(_) => return Outcome::fail("bad-reply"),
        Err(e) => return Outcome::fail(e),
    }
    if let Err(e) = s.write_all(&echo_rq(1)) {
        return Outcome::fail(io_status(&e));
    }
    let status = match read_pdu(&mut s) {
        Ok((0x04, body)) => match echo_rsp_status(&body) {
            Some(st) => st,
            None => return Outcome::fail("bad-reply"),
        },
        Ok((0x07, _)) => return Outcome::fail("aborted"),
        Ok(_) => return Outcome::fail("bad-reply"),
        Err(e) => return Outcome::fail(e),
    };
    let rtt = ms_since(t);
    // A-RELEASE-RQ; the A-RELEASE-RP is waited for briefly, not required.
    let _ = s.write_all(&pdu(0x05, &[0, 0, 0, 0]));
    let _ = s.set_read_timeout(Some(Duration::from_millis(1000)));
    let _ = read_pdu(&mut s);
    Outcome { ok: status == 0, rtt_ms: Some(rtt), status: format!("{status:04X}"), ..Default::default() }
}

// The checks of step 7k, beside these (they use this file's helpers).
#[path = "checks_more.rs"]
mod more;
use more::{mail, ipp, mllp, ntp, rtsp, sip, Mail};

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    const CERT_A: &[u8] = include_bytes!("testdata/cert-a.der");
    const KEY_A: &[u8] = include_bytes!("testdata/key-a.der");
    /// cert-a.der's notAfter: 2126-10-18 18:40:21 UTC.
    const CERT_A_END: i64 = 4_948_022_421;
    /// A certificate that has already ended (2026-03-01 00:00:00 UTC): a
    /// check still answers, and reads the date (certificates are never
    /// judged, D232). Made once with `openssl req -x509 ... -not_after`.
    const CERT_ENDED: &[u8] = include_bytes!("testdata/cert-ended.der");
    const KEY_ENDED: &[u8] = include_bytes!("testdata/key-ended.der");
    const CERT_ENDED_END: i64 = 1_772_323_200;

    fn spec(proto: &str, port: u16) -> Spec {
        Spec { proto: proto.into(), host: "127.0.0.1".into(), port, timeout_ms: 2000, ..Default::default() }
    }

    fn free_port() -> u16 {
        // Bound and let go: nothing listens there now.
        TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    fn server_tls() -> Arc<rustls::ServerConfig> {
        server_tls_with(CERT_A, KEY_A)
    }
    fn server_tls_with(cert: &'static [u8], key: &'static [u8]) -> Arc<rustls::ServerConfig> {
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
    fn certificate_end_dates() {
        assert_eq!(cert_not_after(CERT_A), Some(CERT_A_END));
        assert_eq!(cert_not_after(b"not a certificate"), None);
        assert_eq!(cert_not_after(&[]), None);
        assert_eq!(asn1_time(0x17, "491231235959Z"), Some(days_from_civil(2049, 12, 31) * 86_400 + 86_399));
        assert_eq!(asn1_time(0x17, "500101000000Z"), Some(days_from_civil(1950, 1, 1) * 86_400));
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2026, 11, 11), 20_768);
        // Near the end: a warning at 14 days (D155), counted from now.
        assert_eq!(cert_days_left(CERT_A_END, CERT_A_END - 10 * 86_400), 10);
        assert!(cert_days_left(CERT_A_END, CERT_A_END - 10 * 86_400) <= CERT_WARN_DAYS);
        assert_eq!(cert_days_left(CERT_A_END, CERT_A_END - 30 * 86_400), 30);
        assert_eq!(cert_days_left(CERT_A_END, CERT_A_END + 1), -1);
    }

    #[test]
    fn tcp_open_closed() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let o = run(&spec("tcp", port));
        assert!(o.ok, "{o:?}");
        assert_eq!(o.status, "open");
        assert!(o.rtt_ms.is_some());
        drop(l);
        let o = run(&spec("tcp", free_port()));
        assert!(!o.ok && !o.skipped);
        assert_eq!(o.status, "refused");
        // No port: cannot be asked.
        assert!(run(&spec("tcp", 0)).skipped);
        // A name is looked up (a watched address's, step 8d: the page sends a
        // device's addresses only); one that does not resolve is not answering.
        let mut s = spec("tcp", 80);
        s.host = "printer.invalid".into();
        let o = run(&s);
        assert!(!o.skipped);
        assert_eq!(o.status, "resolve");
    }

    /// An http server answering one request per connection with `reply`,
    /// sending what it got to the test.
    fn http_fake(reply: &'static str, tls: bool) -> (u16, mpsc::Receiver<String>) {
        http_fake_with(reply, tls, server_tls())
    }
    fn http_fake_with(reply: &'static str, tls: bool, cfg: Arc<rustls::ServerConfig>) -> (u16, mpsc::Receiver<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            for s in l.incoming() {
                let Ok(tcp) = s else { continue };
                let tx = tx.clone();
                let cfg = cfg.clone();
                thread::spawn(move || {
                    let mut stream: Box<dyn ReadWrite> = if tls {
                        Box::new(rustls::StreamOwned::new(rustls::ServerConnection::new(cfg).unwrap(), tcp))
                    } else {
                        Box::new(tcp)
                    };
                    let mut got = Vec::new();
                    let mut b = [0u8; 1];
                    while !got.ends_with(b"\r\n\r\n") && got.len() < 8192 {
                        match stream.read(&mut b) {
                            Ok(1) => got.push(b[0]),
                            _ => break,
                        }
                    }
                    let _ = tx.send(String::from_utf8_lossy(&got).into_owned());
                    let _ = stream.write_all(reply.as_bytes());
                    let _ = stream.flush();
                });
            }
        });
        (port, rx)
    }

    #[test]
    fn http_status_codes() {
        let (port, rx) = http_fake("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok", false);
        let mut s = spec("http", port);
        s.path = "/status".into();
        let o = run(&s);
        assert!(o.ok, "{o:?}");
        assert_eq!(o.status, "200");
        assert!(o.cert_not_after.is_none());
        let req = rx.recv().unwrap();
        assert!(req.starts_with("GET /status HTTP/1.1\r\n"), "{req}");
        assert!(req.contains(&format!("Host: 127.0.0.1:{port}\r\n")), "{req}");
        // A login page answers; a server error does not; a redirect is not
        // followed.
        let (port, _rx) = http_fake("HTTP/1.1 401 Unauthorized\r\n\r\n", false);
        let o = run(&spec("http", port));
        assert!(o.ok && o.status == "401", "{o:?}");
        let (port, _rx) = http_fake("HTTP/1.0 503 Service Unavailable\r\n\r\n", false);
        let o = run(&spec("http", port));
        assert!(!o.ok && o.status == "503" && o.rtt_ms.is_some(), "{o:?}");
        let (port, rx) = http_fake("HTTP/1.1 302 Found\r\nLocation: http://192.0.2.1/\r\n\r\n", false);
        let o = run(&spec("http", port));
        assert!(o.ok && o.status == "302", "{o:?}");
        assert!(rx.recv().is_ok());
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err(), "the redirect was followed");
        // Not HTTP at all.
        let (port, _rx) = http_fake("SSH-2.0-OpenSSH\r\n", false);
        assert_eq!(run(&spec("http", port)).status, "bad-reply");
        // A path that could split the request is not sent.
        assert_eq!(http_path("/a b"), "/");
        assert_eq!(http_path("/x\r\nHost: evil"), "/");
        assert_eq!(http_path("http://elsewhere/"), "/");
        assert_eq!(http_path("//elsewhere/"), "/");
        assert_eq!(http_path("/ok?x=1"), "/ok?x=1");
    }

    #[test]
    fn https_reads_the_certificate_end() {
        let (port, rx) = http_fake("HTTP/1.1 204 No Content\r\n\r\n", true);
        let o = run(&spec("https", port));
        assert!(o.ok, "{o:?}");
        assert_eq!(o.status, "204");
        assert_eq!(o.cert_not_after, Some(CERT_A_END));
        assert!(rx.recv().unwrap().starts_with("GET / HTTP/1.1"));
        // Plain http on the https check: no handshake, no answer.
        let (port, _rx) = http_fake("HTTP/1.1 200 OK\r\n\r\n", false);
        let o = run(&spec("https", port));
        assert!(!o.ok, "{o:?}");
    }

    // TLS certificate (D375): one handshake, the end date, nothing sent after.
    #[test]
    fn tls_reads_the_end_date_and_sends_nothing() {
        let (port, rx) = http_fake("HTTP/1.1 200 OK\r\n\r\n", true);
        let o = run(&spec("tls", port));
        assert!(o.ok && o.status == "TLS", "{o:?}");
        assert_eq!(o.cert_not_after, Some(CERT_A_END));
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), "", "nothing sent after the handshake");
        // Plain TCP on the port: no handshake, not answering.
        let (port, _rx) = http_fake("HTTP/1.1 200 OK\r\n\r\n", false);
        assert!(!run(&spec("tls", port)).ok);
        // Nothing listening.
        let o = run(&spec("tls", free_port()));
        assert!(!o.ok && o.status == "refused", "{o:?}");
        assert_eq!(Spec::default_port("tls"), 443);
        assert!(PROTOCOLS.contains(&"tls"));
    }

    // A watched address's host name (step 8d): looked up, sent as the
    // server name and the Host; one that does not resolve is not answering.
    #[test]
    fn a_host_name_is_looked_up() {
        assert_eq!(resolve("localhost"), Some("127.0.0.1".parse().unwrap()));
        let (port, rx) = http_fake("HTTP/1.1 204 No Content\r\n\r\n", false);
        let mut s = spec("http", port);
        s.host = "localhost".into();
        let o = run(&s);
        assert!(o.ok && o.status == "204", "{o:?}");
        assert!(rx.recv().unwrap().contains(&format!("Host: localhost:{port}\r\n")));
        s.host = "no-such-host.invalid".into();
        let o = run(&s);
        assert!(!o.ok && !o.skipped && o.status == "resolve", "{o:?}");
        // Never a range or a URL.
        for bad in ["10.0.0.1-20", "http://x.example", "a b", "", "10.0.0.*"] {
            s.host = bad.into();
            assert!(run(&s).skipped, "{bad}");
        }
        assert!(host_name_ok("pacs.clinic.local") && !host_name_ok("1.2.3") && !host_name_ok("x..y"));
        assert_eq!(host_header_for("app.example.com", "10.0.0.1".parse().unwrap(), 443, true), "app.example.com");
        assert_eq!(host_header_for("10.0.0.1", "10.0.0.1".parse().unwrap(), 8443, true), "10.0.0.1:8443");
    }

    #[test]
    fn an_ended_certificate_still_answers() {
        // The plan's "TLS with a certificate near expiry", end to end: one
        // that ended already, over HTTPS and SMTP STARTTLS.
        assert_eq!(cert_not_after(CERT_ENDED), Some(CERT_ENDED_END));
        let (port, _rx) = http_fake_with("HTTP/1.1 200 OK\r\n\r\n", true, server_tls_with(CERT_ENDED, KEY_ENDED));
        let o = run(&spec("https", port));
        assert!(o.ok && o.status == "200", "{o:?}");
        assert_eq!(o.cert_not_after, Some(CERT_ENDED_END));
        let (port, _rx) = smtp_fake_with("220 ready\r\n", true, server_tls_with(CERT_ENDED, KEY_ENDED));
        let mut s = spec("smtp", port);
        s.starttls = true;
        let o = run(&s);
        assert!(o.ok, "{o:?}");
        assert_eq!(o.cert_not_after, Some(CERT_ENDED_END));
        // Ten days before its end: inside the 14-day warning.
        assert!(cert_days_left(CERT_ENDED_END, CERT_ENDED_END - 10 * 86_400) <= CERT_WARN_DAYS);
        assert!(cert_days_left(CERT_ENDED_END, CERT_ENDED_END + 86_400) < 0);
    }

    /// A DNS server on 127.0.0.1 answering with `rcode` and `answers`.
    fn dns_fake(rcode: u8, answers: u16) -> (u16, mpsc::Receiver<Vec<u8>>) {
        let s = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = s.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut buf = [0u8; 512];
            while let Ok((n, from)) = s.recv_from(&mut buf) {
                let q = buf[..n].to_vec();
                let _ = tx.send(q.clone());
                let mut r = q.clone();
                r[2] = 0x81;
                r[3] = 0x80 | rcode;
                r[6..8].copy_from_slice(&answers.to_be_bytes());
                if answers > 0 {
                    r.extend_from_slice(&[0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 7]);
                }
                // A stray reply with another id first: ignored.
                let mut stray = r.clone();
                stray[0] ^= 0xff;
                let _ = s.send_to(&stray, from);
                let _ = s.send_to(&r, from);
            }
        });
        (port, rx)
    }

    #[test]
    fn dns_answers() {
        let (port, rx) = dns_fake(0, 1);
        let mut s = spec("dns", port);
        s.name = "pacs.clinic.local".into();
        let o = run(&s);
        assert!(o.ok, "{o:?}");
        assert_eq!(o.status, "NOERROR");
        let q = rx.recv().unwrap();
        assert_eq!(&q[12..], b"\x04pacs\x06clinic\x05local\x00\x00\x01\x00\x01");
        assert_eq!(q[2] & 0x01, 1, "recursion desired");
        let (port, _rx) = dns_fake(3, 0);
        let mut s = spec("dns", port);
        s.name = "nowhere.local".into();
        let o = run(&s);
        assert!(!o.ok && o.status == "NXDOMAIN" && o.rtt_ms.is_some(), "{o:?}");
        let (port, _rx) = dns_fake(0, 0);
        let mut s = spec("dns", port);
        s.name = "empty.local".into();
        assert_eq!(run(&s).status, "NOANSWER");
        // No name: cannot be asked; a name that is not one is not sent.
        assert!(run(&spec("dns", port)).skipped);
        assert!(dns_query(1, "a..b").is_none());
        assert!(dns_query(1, &"x".repeat(64)).is_none());
        assert!(dns_query(1, "bad name").is_none());
        // Nobody there: no answer in time (UDP has no refusal to wait for
        // on every system).
        let quiet = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mut s = spec("dns", quiet.local_addr().unwrap().port());
        s.name = "x.local".into();
        s.timeout_ms = 300;
        let o = run(&s);
        assert!(!o.ok && !o.skipped, "{o:?}");
    }

    /// An SMTP server: greets, answers EHLO (offering STARTTLS when asked),
    /// STARTTLS and QUIT, and records every line the client sends. Any
    /// other command fails the test (it would be a message, or a login).
    fn smtp_fake(greeting: &'static str, offer_tls: bool) -> (u16, mpsc::Receiver<Vec<String>>) {
        smtp_fake_with(greeting, offer_tls, server_tls())
    }
    fn smtp_fake_with(greeting: &'static str, offer_tls: bool, cfg: Arc<rustls::ServerConfig>) -> (u16, mpsc::Receiver<Vec<String>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        
        thread::spawn(move || {
            let Ok((mut tcp, _)) = l.accept() else { return };
            let mut seen = Vec::new();
            let _ = tcp.write_all(greeting.as_bytes());
            let mut r = BufReader::new(tcp.try_clone().unwrap());
            loop {
                let Ok(line) = read_line_limited(&mut r) else { break };
                seen.push(line.clone());
                let cmd = line.split_whitespace().next().unwrap_or("").to_ascii_uppercase();
                match cmd.as_str() {
                    "EHLO" => {
                        let _ = tcp.write_all(if offer_tls { b"250-fake.local\r\n250-SIZE 1000\r\n250 STARTTLS\r\n" as &[u8] } else { b"250-fake.local\r\n250 SIZE 1000\r\n" });
                    }
                    "STARTTLS" => {
                        let _ = tcp.write_all(b"220 go ahead\r\n");
                        let mut tls = rustls::StreamOwned::new(rustls::ServerConnection::new(cfg.clone()).unwrap(), tcp.try_clone().unwrap());
                        let mut tr = BufReader::new(&mut tls);
                        while let Ok(l2) = read_line_limited(&mut tr) {
                            seen.push(format!("tls:{l2}"));
                            if l2.eq_ignore_ascii_case("QUIT") {
                                drop(tr);
                                let _ = tls.write_all(b"221 bye\r\n");
                                let _ = tls.flush();
                                break;
                            }
                        }
                        break;
                    }
                    "QUIT" => {
                        let _ = tcp.write_all(b"221 bye\r\n");
                        break;
                    }
                    _ => {
                        let _ = tcp.write_all(b"502 no\r\n");
                    }
                }
            }
            let _ = tx.send(seen);
        });
        (port, rx)
    }

    fn only_ehlo_and_quit(seen: &[String]) {
        for l in seen {
            let u = l.trim_start_matches("tls:").to_ascii_uppercase();
            assert!(u.starts_with("EHLO [") || u == "STARTTLS" || u == "QUIT", "sent more than a greeting needs: {l}");
            assert!(!u.contains("AUTH") && !u.contains("MAIL") && !u.contains("RCPT") && !u.contains("DATA"), "{l}");
        }
    }

    #[test]
    fn smtp_greeting_ehlo_quit() {
        let (port, rx) = smtp_fake("220-fake.local ESMTP\r\n220 ready\r\n", false);
        let o = run(&spec("smtp", port));
        assert!(o.ok, "{o:?}");
        assert_eq!(o.status, "250");
        assert!(o.cert_not_after.is_none());
        let seen = rx.recv().unwrap();
        assert_eq!(seen, vec!["EHLO [127.0.0.1]".to_string(), "QUIT".to_string()]);
        only_ehlo_and_quit(&seen);
        // A server that will not talk now.
        let (port, rx) = smtp_fake("554 not now\r\n", false);
        let o = run(&spec("smtp", port));
        assert!(!o.ok && o.status == "554", "{o:?}");
        assert_eq!(rx.recv().unwrap(), vec!["QUIT".to_string()]);
    }

    #[test]
    fn smtp_starttls_reads_the_certificate() {
        let (port, rx) = smtp_fake("220 ready\r\n", true);
        let mut s = spec("smtp", port);
        s.starttls = true;
        let o = run(&s);
        assert!(o.ok, "{o:?}");
        assert_eq!(o.cert_not_after, Some(CERT_A_END));
        let seen = rx.recv().unwrap();
        assert_eq!(seen, vec!["EHLO [127.0.0.1]".to_string(), "STARTTLS".to_string(), "tls:QUIT".to_string()]);
        only_ehlo_and_quit(&seen);
        // Asked for, not offered: it answers, and says so.
        let (port, rx) = smtp_fake("220 ready\r\n", false);
        let mut s = spec("smtp", port);
        s.starttls = true;
        let o = run(&s);
        assert!(o.ok && o.status == "250 no STARTTLS" && o.cert_not_after.is_none(), "{o:?}");
        only_ehlo_and_quit(&rx.recv().unwrap());
    }

    /// A DICOM SCP: accepts an association to `ae` (or rejects it as the
    /// standard does, 1/1/7), answers C-ECHO with `status` and the release.
    /// It sends what it saw: the called and calling AE, the commands.
    fn dicom_fake(ae: &'static str, status: u16) -> (u16, mpsc::Receiver<Vec<String>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let Ok((mut s, _)) = l.accept() else { return };
            let mut seen = Vec::new();
            let Ok((kind, body)) = read_pdu(&mut s) else { return };
            assert_eq!(kind, 0x01);
            let called = String::from_utf8_lossy(&body[4..20]).trim().to_string();
            let calling = String::from_utf8_lossy(&body[20..36]).trim().to_string();
            seen.push(format!("assoc {called} {calling}"));
            let text = String::from_utf8_lossy(&body);
            assert!(text.contains(VERIFICATION) && text.contains(APP_CONTEXT) && text.contains(IMPLICIT_LE));
            if called != ae {
                let _ = s.write_all(&pdu(0x03, &[0, 1, 1, 7]));
                let _ = tx.send(seen);
                return;
            }
            // The AC echoes the RQ's head, then the context accepted.
            let mut ac = body[..68].to_vec();
            ac.extend(item(0x10, APP_CONTEXT.as_bytes()));
            let mut pc = vec![1, 0, 0, 0];
            pc.extend(item(0x40, IMPLICIT_LE.as_bytes()));
            ac.extend(item(0x21, &pc));
            ac.extend(item(0x50, &item(0x51, &16_384u32.to_be_bytes())));
            let _ = s.write_all(&pdu(0x02, &ac));
            loop {
                let Ok((kind, body)) = read_pdu(&mut s) else { break };
                match kind {
                    0x04 => {
                        // The command field (0000,0100) of the RQ.
                        let cmd = body.windows(10).find(|w| w[..4] == [0, 0, 0, 1] && w[4..8] == [2, 0, 0, 0]).map(|w| u16::from_le_bytes([w[8], w[9]]));
                        seen.push(format!("command {:04X}", cmd.unwrap_or(0)));
                        let mut rest = element(0x0000, 0x0002, b"1.2.840.10008.1.1\0");
                        rest.extend(element(0x0000, 0x0100, &0x8030u16.to_le_bytes()));
                        rest.extend(element(0x0000, 0x0120, &1u16.to_le_bytes()));
                        rest.extend(element(0x0000, 0x0800, &0x0101u16.to_le_bytes()));
                        rest.extend(element(0x0000, 0x0900, &status.to_le_bytes()));
                        let mut cmd = element(0x0000, 0x0000, &(rest.len() as u32).to_le_bytes());
                        cmd.extend(rest);
                        let mut pdv = ((cmd.len() + 2) as u32).to_be_bytes().to_vec();
                        pdv.extend_from_slice(&[1, 3]);
                        pdv.extend(cmd);
                        let _ = s.write_all(&pdu(0x04, &pdv));
                    }
                    0x05 => {
                        seen.push("release".into());
                        let _ = s.write_all(&pdu(0x06, &[0, 0, 0, 0]));
                        break;
                    }
                    k => seen.push(format!("pdu {k}")),
                }
            }
            let _ = tx.send(seen);
        });
        (port, rx)
    }

    #[test]
    fn dicom_echo() {
        let (port, rx) = dicom_fake("PACS", 0);
        let mut s = spec("dicom", port);
        s.called_ae = "PACS".into();
        let o = run(&s);
        assert!(o.ok, "{o:?}");
        assert_eq!(o.status, "0000");
        assert_eq!(rx.recv().unwrap(), vec!["assoc PACS TOPO".to_string(), "command 0030".to_string(), "release".to_string()]);
        // The calling AE per item.
        let (port, rx) = dicom_fake("PACS", 0);
        let mut s = spec("dicom", port);
        s.called_ae = "PACS".into();
        s.calling_ae = "WARD3".into();
        assert!(run(&s).ok);
        assert_eq!(rx.recv().unwrap()[0], "assoc PACS WARD3");
        // A called AE the SCP does not know: rejected, said as such.
        let (port, rx) = dicom_fake("PACS", 0);
        let mut s = spec("dicom", port);
        s.called_ae = "WRONG".into();
        let o = run(&s);
        assert!(!o.ok && !o.skipped, "{o:?}");
        assert_eq!(o.status, "rejected 1/1/7");
        assert_eq!(rx.recv().unwrap(), vec!["assoc WRONG TOPO".to_string()]);
        // An echo answered with a failure status.
        let (port, _rx) = dicom_fake("PACS", 0x0211);
        let mut s = spec("dicom", port);
        s.called_ae = "PACS".into();
        let o = run(&s);
        assert!(!o.ok && o.status == "0211", "{o:?}");
        // Nobody listening.
        let o = run(&spec("dicom", free_port()));
        assert!(!o.ok && o.status == "refused", "{o:?}");
    }

    #[test]
    fn dicom_pdus() {
        assert_eq!(&ae_title("pacs", "X"), b"pacs            ");
        assert_eq!(&ae_title("", "TOPO"), b"TOPO            ");
        assert_eq!(&ae_title("A\\B", "X"), b"AB              ");
        assert_eq!(&ae_title("ABCDEFGHIJKLMNOPQRS", "X"), b"ABCDEFGHIJKLMNOP");
        let rq = associate_rq(&ae_title("PACS", ""), &ae_title("", "TOPO"));
        assert_eq!(rq[0], 0x01);
        assert_eq!(u32::from_be_bytes([rq[2], rq[3], rq[4], rq[5]]) as usize, rq.len() - 6);
        let echo = echo_rq(7);
        assert_eq!(echo[0], 0x04);
        assert_eq!(u32::from_be_bytes([echo[2], echo[3], echo[4], echo[5]]) as usize, echo.len() - 6);
        // Group length (0000,0000) says how long the rest of the command is.
        let pdv_len = u32::from_be_bytes([echo[6], echo[7], echo[8], echo[9]]) as usize;
        assert_eq!(pdv_len, echo.len() - 10);
        let gl = u32::from_le_bytes([echo[20], echo[21], echo[22], echo[23]]) as usize;
        assert_eq!(gl, echo.len() - 24);
        assert!(echo_rsp_status(&[0, 0, 0, 1]).is_none());
    }

    #[test]
    fn ping_packets() {
        let p = echo_request(false, 0x1234, 7, b"topo");
        assert_eq!(inet_checksum(&p), 0, "a correct checksum sums to zero");
        let mut reply = p.clone();
        reply[0] = 0;
        assert!(is_echo_reply(&reply, false, 7, b"topo"));
        assert!(!is_echo_reply(&reply, false, 8, b"topo"));
        assert!(!is_echo_reply(&p, false, 7, b"topo"), "our own request is not the reply");
        // macOS: the IP header comes first.
        let mut with_ip = vec![0x45u8; 1];
        with_ip.extend_from_slice(&[0; 19]);
        with_ip.extend_from_slice(&reply);
        assert!(is_echo_reply(&with_ip, false, 7, b"topo"));
        let p6 = echo_request(true, 1, 9, b"x");
        assert_eq!(p6[0], 128);
        let mut r6 = p6.clone();
        r6[0] = 129;
        assert!(is_echo_reply(&r6, true, 9, b"x"));
    }

    /// ICMP on 127.0.0.1 where this system allows unprivileged ICMP (Linux
    /// with ping_group_range covering this user, macOS, Windows); said and
    /// skipped where it does not, and then the TCP fallback is checked.
    #[test]
    fn ping_loopback() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let mut s = spec("ping", 0);
        s.fallback_port = port;
        let o = run(&s);
        match icmp_echo("127.0.0.1".parse().unwrap(), Duration::from_secs(2)) {
            Icmp::Refused => {
                eprintln!("ping_loopback: this system refuses unprivileged ICMP; the TCP fallback was checked instead");
                assert!(o.ok && o.via == "tcp", "{o:?}");
            }
            Icmp::Reply(ms) => {
                assert!(ms >= 0.0);
                assert!(o.ok && o.via == "icmp" && o.status == "echo", "{o:?}");
            }
            Icmp::NoReply(why) => panic!("127.0.0.1 did not answer ICMP: {why}"),
        }
    }

    #[test]
    fn ping_fallback_is_tcp_not_ping() {
        // Forced: what ping does when the system refuses ICMP.
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        let fall = |fallback: u16| -> Outcome {
            let s = Spec { fallback_port: fallback, ..spec("ping", 0) };
            // ping()'s own code, with a system that refuses ICMP.
            ping_with(|_, _| Icmp::Refused, ip, &s, s.timeout())
        };
        let o = fall(port);
        assert!(o.ok && o.via == "tcp" && o.status == "open");
        drop(l);
        // A refusal is the device answering.
        let o = fall(free_port());
        assert!(o.ok && o.via == "tcp" && o.status == "refused", "{o:?}");
        // No port documented: unknown, never down.
        let o = fall(0);
        assert!(o.skipped && !o.ok);
    }

    /// The by-hand cross-check against a real DICOM SCP (docs/SCOPE.md,
    /// step 7f's Tests): run an SCP on 127.0.0.1 (Carino DICOM's
    /// `./run.sh receive --port <port>`, or pynetdicom's), then
    /// `TOPO_DICOM_PORT=<port> TOPO_DICOM_AE=<its AE> cargo test dicom_cross_check -- --ignored --nocapture`.
    /// A wrong called AE must be rejected by it.
    #[test]
    #[ignore]
    fn dicom_cross_check() {
        let port: u16 = std::env::var("TOPO_DICOM_PORT").expect("TOPO_DICOM_PORT").parse().unwrap();
        let ae = std::env::var("TOPO_DICOM_AE").unwrap_or_else(|_| "ANY-SCP".into());
        let mut s = spec("dicom", port);
        s.called_ae = ae.clone();
        let o = run(&s);
        eprintln!("C-ECHO to {ae} on {port}: {o:?}");
        assert!(o.ok && o.status == "0000", "{o:?}");
        s.called_ae = "NOT-ITS-AE".into();
        let o = run(&s);
        eprintln!("C-ECHO to NOT-ITS-AE on {port}: {o:?}");
        assert!(!o.ok && o.status.starts_with("rejected"), "{o:?}");
    }

    #[test]
    fn unknown_protocol_is_not_asked() {
        assert!(run(&spec("snmp", 161)).skipped);
    }
}
