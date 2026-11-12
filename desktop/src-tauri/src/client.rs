// The desktop app as a client of a Topo server (docs/SCOPE.md D144, step
// 7c). The page's own code (js/server.js, js/serversync.js) talks to the
// server exactly as it does in a browser, but every request and the event
// stream go through here: js/desktopclient.js gives js/server.js a fetch and
// an EventSource that call the app's commands (src/clientcmd.rs), and those
// call this file. So:
//
// - the webview never fetches the server: no CORS, and the page's CSP stays
//   connect-src 'self';
// - the session cookie lives here (and in a file only this user can read,
//   kept by Store below), never in the page: the page cannot read it, as in a
//   browser (HttpOnly);
// - only the connected server's /api/ is reachable: the page cannot use the
//   app to fetch anything else;
// - a server that signs its own certificate (TOPO_TLS_SELF, D113) is pinned
//   by the SHA-256 fingerprint of that certificate, compared once by the
//   person; a different certificate later is refused ("pin-changed"),
//   whatever else it says. A server with a certificate from a public
//   authority (webpki-roots) needs no pin;
// - plain http only to this PC (127.0.0.1, ::1, localhost), as the server
//   itself allows (D52).
//
// No Tauri here: the same file is the transport of the app and of
// examples/client-bridge.rs, the stand-in tests/desktop-client-e2e.mjs drives
// against the real topo-server.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::ThreadId;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, RootCertStore, SignatureScheme};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// The largest answer kept (a network's revision, a backup file).
pub const MAX_BODY: u64 = 256 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const IO_TIMEOUT: Duration = Duration::from_secs(120);
/// The server sends a comment every 20 s (server/internal/api/events.go):
/// three missed means the connection is gone.
const EVENTS_READ_TIMEOUT: Duration = Duration::from_secs(65);
const DEFAULT_RETRY_MS: u64 = 5000;

// ---- Addresses ----

/// The origin (scheme://host[:port]) of what the person typed: a bare
/// address means https. Errors: "address" (not one), "needs-https" (plain
/// http to another PC: sign-in would cross the network in clear).
pub fn normalize(input: &str) -> Result<String, String> {
    let s = input.trim();
    if s.is_empty() || s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("address".into());
    }
    let with = if s.contains("://") { s.to_string() } else { format!("https://{s}") };
    let u = url::Url::parse(&with).map_err(|_| "address".to_string())?;
    if !matches!(u.scheme(), "https" | "http") || !u.username().is_empty() || u.password().is_some() {
        return Err("address".into());
    }
    let host = u.host().ok_or("address")?;
    if u.scheme() == "http" && !loopback(&host) {
        return Err("needs-https".into());
    }
    Ok(u.origin().ascii_serialization())
}

fn loopback(h: &url::Host<&str>) -> bool {
    match h {
        url::Host::Ipv4(ip) => ip.is_loopback(),
        url::Host::Ipv6(ip) => ip.is_loopback(),
        url::Host::Domain(d) => d.eq_ignore_ascii_case("localhost"),
    }
}

/// Only the server's API, and only a plain path (no other host, no scheme,
/// nothing that would leave the origin).
pub fn api_path(p: &str) -> bool {
    p.starts_with("/api/")
        && p.len() <= 4096
        && !p.contains("..")
        && !p.contains('#')
        && !p.contains('\\')
        && !p.contains("//")
        && p.chars().all(|c| c.is_ascii_graphic())
}

/// SHA-256 of a DER certificate as browsers show it (AB:CD:…), the same as
/// server/internal/selfcert Fingerprint.
pub fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der).iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

/// A fingerprint as typed or pasted (spaces, lower case, no colons) in the
/// form above; "" when it is not 32 bytes of hex.
pub fn clean_fingerprint(s: &str) -> String {
    let hex: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_ascii_uppercase();
    if hex.len() != 64 || s.chars().any(|c| !(c.is_ascii_hexdigit() || matches!(c, ':' | ' ' | '-'))) {
        return String::new();
    }
    hex.as_bytes().chunks(2).map(|p| String::from_utf8_lossy(p).into_owned()).collect::<Vec<_>>().join(":")
}

// ---- The certificate check ----

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
enum Verdict {
    #[default]
    Fine,
    /// Not signed by a public authority, and no pin yet: the person compares.
    Untrusted,
    /// Pinned, and this is another certificate.
    Changed,
}

/// What the certificate check saw. A refusal is kept for the thread whose
/// handshake it was (ureq does the handshake on the calling thread), so a
/// page request and the event stream failing at the same moment each get
/// their own answer, never the other's.
#[derive(Default, Debug)]
struct Seen {
    /// The last certificate seen, by any thread.
    fp: String,
    failed: HashMap<ThreadId, (Verdict, String)>,
}

#[derive(Debug)]
struct Check {
    pin: String,
    roots: Arc<WebPkiServerVerifier>,
    provider: Arc<CryptoProvider>,
    seen: Arc<Mutex<Seen>>,
}

impl ServerCertVerifier for Check {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let fp = fingerprint(end_entity.as_ref());
        let verdict = if !self.pin.is_empty() {
            // Pinned: this certificate and no other. The name and dates do
            // not matter, as for a browser's exception (the self-signed
            // certificate lists the PC's LAN addresses, not 127.0.0.1).
            if fp == self.pin { Verdict::Fine } else { Verdict::Changed }
        } else if self.roots.verify_server_cert(end_entity, intermediates, server_name, ocsp, now).is_ok() {
            Verdict::Fine
        } else {
            Verdict::Untrusted
        };
        if let Ok(mut s) = self.seen.lock() {
            let me = std::thread::current().id();
            if verdict == Verdict::Fine {
                s.failed.remove(&me);
            } else {
                s.failed.insert(me, (verdict, fp.clone()));
            }
            s.fp = fp;
        }
        match verdict {
            Verdict::Fine => Ok(ServerCertVerified::assertion()),
            Verdict::Changed => Err(rustls::Error::General("topo: the certificate changed".into())),
            Verdict::Untrusted => Err(rustls::Error::General("topo: certificate not trusted yet".into())),
        }
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

// ---- The session cookie ----

/// The cookies one server set, by name: (value, expiry in unix seconds or 0
/// for "until signed out"). Only that server ever gets them back.
#[derive(Default, Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Jar {
    pub origin: String,
    pub cookies: BTreeMap<String, (String, u64)>,
    #[serde(skip)]
    dirty: bool,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl Jar {
    /// One Set-Cookie header: name=value and Max-Age (the server's only
    /// attributes that matter here; Path is "/" and the rest are for
    /// browsers). Max-Age <= 0 or an empty value deletes it.
    pub fn set(&mut self, header: &str, now: u64) {
        let mut parts = header.split(';');
        let Some((name, value)) = parts.next().and_then(|nv| nv.split_once('=')) else { return };
        let name = name.trim();
        let value = value.trim().trim_matches('"');
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_graphic() && c != '=') || !value.chars().all(|c| c.is_ascii_graphic() && c != ';') {
            return;
        }
        let mut expires = 0u64;
        let mut gone = value.is_empty();
        for a in parts {
            if let Some((k, v)) = a.split_once('=') {
                if k.trim().eq_ignore_ascii_case("max-age") {
                    match v.trim().parse::<i64>() {
                        Ok(n) if n > 0 => expires = now + n as u64,
                        Ok(_) => gone = true,
                        Err(_) => {}
                    }
                }
            }
        }
        if gone {
            if self.cookies.remove(name).is_some() {
                self.dirty = true;
            }
        } else if self.cookies.get(name) != Some(&(value.to_string(), expires)) {
            self.cookies.insert(name.to_string(), (value.to_string(), expires));
            self.dirty = true;
        }
    }

    /// The Cookie header, without expired ones ("" when none).
    pub fn header(&self, now: u64) -> String {
        self.cookies
            .iter()
            .filter(|(_, (_, exp))| *exp == 0 || *exp > now)
            .map(|(n, (v, _))| format!("{n}={v}"))
            .collect::<Vec<_>>()
            .join("; ")
    }
}

// ---- The event stream (text/event-stream) ----

/// What the stream says to the page, as a browser's EventSource would.
#[derive(Debug, Clone, PartialEq)]
pub enum Ev {
    Open,
    Event { name: String, data: String },
    /// closed: the server refused the stream (signed out, revoked): the page
    /// finds out why; otherwise it reconnects by itself, as a browser does.
    Error { closed: bool },
}

impl Ev {
    pub fn to_json(&self) -> Value {
        match self {
            Ev::Open => json!({ "kind": "open" }),
            Ev::Event { name, data } => json!({ "kind": "event", "event": name, "data": data }),
            Ev::Error { closed } => json!({ "kind": "error", "closed": closed }),
        }
    }
}

/// The lines of a stream, into events (the HTML standard's rules, for what
/// the server sends: event, data, retry and comments).
#[derive(Default, Debug)]
pub struct SseParser {
    event: String,
    data: Vec<String>,
    pub retry_ms: Option<u64>,
}

impl SseParser {
    pub fn line(&mut self, line: &str) -> Option<(String, String)> {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            let name = std::mem::take(&mut self.event);
            if self.data.is_empty() {
                return None;
            }
            let data = std::mem::take(&mut self.data).join("\n");
            return Some((if name.is_empty() { "message".into() } else { name }, data));
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => self.event = value.to_string(),
            "data" => self.data.push(value.to_string()),
            "retry" => {
                if let Ok(n) = value.parse::<u64>() {
                    self.retry_ms = Some(n);
                }
            }
            _ => {}
        }
        None
    }
}

// ---- The client ----

/// A server's answer, as the page's fetch gets it.
#[derive(Debug, Clone)]
pub struct Reply {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}

impl Reply {
    /// Text as text; anything else (not UTF-8) as base64.
    pub fn to_json(&self) -> Value {
        match std::str::from_utf8(&self.body) {
            Ok(s) => json!({ "status": self.status, "contentType": self.content_type, "body": s, "b64": false }),
            Err(_) => {
                use base64::Engine;
                json!({ "status": self.status, "contentType": self.content_type, "body": base64::engine::general_purpose::STANDARD.encode(&self.body), "b64": true })
            }
        }
    }
}

pub struct Client {
    pub origin: String,
    pub pin: String,
    agent: ureq::Agent,
    events_agent: ureq::Agent,
    jar: Mutex<Jar>,
    seen: Arc<Mutex<Seen>>,
    /// A site monitor's credential (step 7h, src/monitorlink.rs): sent as
    /// "Authorization: Topo-Monitor <token>" instead of any cookie.
    monitor_token: Mutex<String>,
}

fn agent(tls: Arc<rustls::ClientConfig>, read: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .tls_config(tls)
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(read)
        .timeout_write(IO_TIMEOUT)
        // Never somewhere else: a redirect is answered as it is.
        .redirects(0)
        .user_agent(concat!("Topo-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
}

impl Client {
    /// A client for one server. pin: the fingerprint the person compared
    /// ("" for a server whose certificate a public authority signed, or
    /// plain http on this PC). The cookies come from an earlier run.
    pub fn new(origin: &str, pin: &str, jar: Option<Jar>) -> Result<Client, String> {
        Self::with_roots(origin, pin, jar, RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() })
    }

    /// The same, trusting these authorities (the tests' own root).
    fn with_roots(origin: &str, pin: &str, jar: Option<Jar>, roots: RootCertStore) -> Result<Client, String> {
        let origin = normalize(origin)?;
        let pin = if pin.trim().is_empty() {
            String::new()
        } else {
            let p = clean_fingerprint(pin);
            if p.is_empty() {
                return Err("fingerprint".into());
            }
            p
        };
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let web = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider.clone()).build().map_err(|e| format!("tls:{e}"))?;
        let seen = Arc::new(Mutex::new(Seen::default()));
        let check = Check { pin: pin.clone(), roots: web, provider: provider.clone(), seen: seen.clone() };
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|e| format!("tls:{e}"))?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(check))
            .with_no_client_auth();
        let tls = Arc::new(tls);
        let jar = match jar {
            Some(j) if j.origin == origin => j,
            _ => Jar { origin: origin.clone(), ..Default::default() },
        };
        Ok(Client {
            agent: agent(tls.clone(), IO_TIMEOUT),
            events_agent: agent(tls, EVENTS_READ_TIMEOUT),
            origin,
            pin,
            jar: Mutex::new(jar),
            seen,
            monitor_token: Mutex::new(String::new()),
        })
    }

    /// Makes this the client of a site monitor: its token on every request.
    pub fn set_monitor_token(&self, token: &str) {
        if let Ok(mut t) = self.monitor_token.lock() {
            *t = token.to_string();
        }
    }

    /// The jar when it changed since the last call (to be written down).
    pub fn jar_if_changed(&self) -> Option<Jar> {
        let mut j = self.jar.lock().ok()?;
        if !j.dirty {
            return None;
        }
        j.dirty = false;
        Some(j.clone())
    }

    /// The cookies as they are now.
    pub fn jar(&self) -> Jar {
        self.jar.lock().map(|j| j.clone()).unwrap_or_default()
    }

    /// The fingerprint of the last certificate seen ("" over http).
    pub fn seen_fingerprint(&self) -> String {
        self.seen.lock().map(|s| s.fp.clone()).unwrap_or_default()
    }

    fn build(&self, a: &ureq::Agent, method: &str, path: &str) -> ureq::Request {
        let mut req = a
            .request(method, &format!("{}{}", self.origin, path))
            .set("X-Topo", "1")
            // What a browser says for the page's own requests: the server's
            // CSRF check (server/internal/api/middleware.go csrfMW) takes it
            // with no Origin. The app is not a web page another site can
            // drive, which is what that check is for.
            .set("Sec-Fetch-Site", "same-origin");
        let token = self.monitor_token.lock().map(|t| t.clone()).unwrap_or_default();
        if !token.is_empty() {
            // A monitor is not a person: its token, never a session cookie.
            return req.set("Authorization", &format!("Topo-Monitor {token}"));
        }
        let c = self.jar.lock().map(|j| j.header(now_secs())).unwrap_or_default();
        if !c.is_empty() {
            req = req.set("Cookie", &c);
        }
        req
    }

    fn keep_cookies(&self, res: &ureq::Response) {
        if let Ok(mut j) = self.jar.lock() {
            for h in res.all("set-cookie") {
                j.set(h, now_secs());
            }
        }
    }

    /// Why a request did not get an answer: "untrusted:<fp>" (a certificate
    /// to compare), "pin-changed:<fp>" (not the pinned one: refused), else
    /// "offline".
    fn why(&self) -> String {
        let mut s = match self.seen.lock() {
            Ok(s) => s,
            Err(_) => return "offline".into(),
        };
        match s.failed.remove(&std::thread::current().id()) {
            Some((Verdict::Changed, fp)) => format!("pin-changed:{fp}"),
            Some((Verdict::Untrusted, fp)) => format!("untrusted:{fp}"),
            _ => "offline".into(),
        }
    }

    /// One request to the server's API: any status is an answer (the page
    /// reads the error codes); only no answer at all is an error.
    pub fn request(&self, method: &str, path: &str, body: Option<&str>) -> Result<Reply, String> {
        if !matches!(method, "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
            return Err("method".into());
        }
        if !api_path(path) {
            return Err("path".into());
        }
        let req = self.build(&self.agent, method, path).set("Accept", "application/json");
        let sent = match body {
            Some(b) => req.set("Content-Type", "application/json").send_string(b),
            None if method == "GET" => req.call(),
            None => req.send_bytes(&[]),
        };
        let res = match sent {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(ureq::Error::Transport(_)) => return Err(self.why()),
        };
        self.keep_cookies(&res);
        let status = res.status();
        let content_type = res.header("content-type").unwrap_or("").to_string();
        let mut body = Vec::new();
        res.into_reader().take(MAX_BODY + 1).read_to_end(&mut body).map_err(|_| "offline".to_string())?;
        if body.len() as u64 > MAX_BODY {
            return Err("too-large".into());
        }
        Ok(Reply { status, content_type, body })
    }

    /// Is a Topo server there? -> Ok(fingerprint seen, "" over http) or the
    /// request's error; "not-topo" when something else answered.
    pub fn probe(&self) -> Result<String, String> {
        let r = self.request("GET", "/api/health", None)?;
        let v: Value = serde_json::from_slice(&r.body).unwrap_or(Value::Null);
        if r.status != 200 || v.get("server").and_then(Value::as_str) != Some("topo") {
            return Err("not-topo".into());
        }
        Ok(self.seen_fingerprint())
    }

    /// The event stream at path, until stop is set or sink answers false.
    /// Reconnects after the server's retry time when the connection drops;
    /// ends for good when the server refuses it (any status but 200).
    pub fn events(&self, path: &str, stop: &AtomicBool, mut sink: impl FnMut(Ev) -> bool) {
        if !api_path(path) {
            sink(Ev::Error { closed: true });
            return;
        }
        let mut retry = DEFAULT_RETRY_MS;
        let stopped = |stop: &AtomicBool| stop.load(Ordering::SeqCst);
        while !stopped(stop) {
            let res = self.build(&self.events_agent, "GET", path).set("Accept", "text/event-stream").set("Cache-Control", "no-store").call();
            match res {
                Ok(r) if r.status() == 200 => {
                    self.keep_cookies(&r);
                    if stopped(stop) || !sink(Ev::Open) {
                        return;
                    }
                    let mut p = SseParser::default();
                    let mut lines = BufReader::new(r.into_reader());
                    let mut line = String::new();
                    loop {
                        line.clear();
                        match lines.read_line(&mut line) {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        }
                        if stopped(stop) {
                            return;
                        }
                        if let Some((name, data)) = p.line(line.trim_end_matches('\n')) {
                            if !sink(Ev::Event { name, data }) {
                                return;
                            }
                        }
                        if let Some(ms) = p.retry_ms.take() {
                            retry = ms.clamp(500, 60_000);
                        }
                    }
                }
                Ok(r) => {
                    self.keep_cookies(&r);
                    sink(Ev::Error { closed: true });
                    return;
                }
                Err(ureq::Error::Status(_, r)) => {
                    self.keep_cookies(&r);
                    sink(Ev::Error { closed: true });
                    return;
                }
                Err(ureq::Error::Transport(_)) => {
                    // A certificate refused (changed, or one nobody vouches
                    // for any more) is not something to retry: the page's
                    // requests say why.
                    if self.why() != "offline" {
                        sink(Ev::Error { closed: true });
                        return;
                    }
                }
            }
            if stopped(stop) || !sink(Ev::Error { closed: false }) {
                return;
            }
            // Wait, a little at a time so a stop is not held up.
            let mut waited = 0;
            while waited < retry && !stopped(stop) {
                std::thread::sleep(Duration::from_millis(100));
                waited += 100;
            }
        }
    }
}

// ---- Connecting ----

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// The address as it will be kept (scheme://host:port).
    pub url: String,
    /// "" when a Topo server answered; else "untrusted" (compare the
    /// fingerprint), "pin-changed", "offline", "not-topo", "address",
    /// "needs-https", "fingerprint".
    pub error: String,
    /// The certificate's fingerprint (https only).
    pub fingerprint: String,
}

/// Splits "untrusted:<fp>" into its parts.
fn probe_result(url: String, r: Result<String, String>) -> Probe {
    match r {
        Ok(fp) => Probe { url, error: String::new(), fingerprint: fp },
        Err(e) => match e.split_once(':') {
            Some((code, fp)) if code == "untrusted" || code == "pin-changed" => Probe { url, error: code.into(), fingerprint: fp.into() },
            _ => Probe { url, error: e, fingerprint: String::new() },
        },
    }
}

/// Whether a Topo server answers at url, without connecting. pin: a
/// fingerprint already compared ("" to find out what the certificate is).
pub fn probe(url: &str, pin: &str) -> Probe {
    let origin = match normalize(url) {
        Ok(o) => o,
        Err(e) => return Probe { error: e, ..Default::default() },
    };
    match Client::new(&origin, pin, None) {
        Ok(c) => probe_result(origin, c.probe()),
        Err(e) => Probe { url: origin, error: e, ..Default::default() },
    }
}

// ---- What is kept on disk ----
//
// The app (src/clientcmd.rs) and the tests' bridge (examples/client-bridge.rs)
// both keep the server here, so what the tests run is what the app does:
// the address and the pin in one file, the cookies in another that only
// this user can read. Every write goes to a temporary file that is then
// renamed into place, one at a time, so two threads saving the cookies at
// once leave the newer jar, whole.

/// The connected server, as kept in client.json.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Saved {
    pub url: String,
    pub pin: String,
}

pub struct Store {
    config: PathBuf,
    session: PathBuf,
    /// The origin whose cookies may be written ("" once disconnected); held
    /// for every write, so writes happen one at a time and in order.
    active: Mutex<String>,
}

/// Writes data so only this user can read it, all or nothing (a temporary
/// file renamed into place).
pub fn write_private_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(d) = path.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    {
        let mut o = fs::OpenOptions::new();
        o.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o600);
        }
        let mut f = o.open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data).and_then(|_| f.sync_all()).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            e.to_string()
        })?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

impl Store {
    /// config: client.json (the address and the pin); session: the cookies.
    pub fn new(config: PathBuf, session: PathBuf) -> Store {
        Store { config, session, active: Mutex::new(String::new()) }
    }

    pub fn saved(&self) -> Saved {
        fs::read(&self.config).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    /// The client for the saved server with its cookies (None when there is
    /// none). A cookie file that cannot be read starts signed out.
    pub fn load(&self) -> Result<Option<Client>, String> {
        let s = self.saved();
        if s.url.is_empty() {
            return Ok(None);
        }
        let jar: Option<Jar> = fs::read(&self.session).ok().and_then(|b| serde_json::from_slice(&b).ok());
        let c = Client::new(&s.url, &s.pin, jar)?;
        *self.active.lock().map_err(|_| "lock")? = c.origin.clone();
        Ok(Some(c))
    }

    /// Writes the client's cookies when they changed (after each answer).
    /// Only for the connected server: a request of a server just left
    /// writes nothing.
    pub fn keep_jar(&self, c: &Client) {
        let Ok(active) = self.active.lock() else { return };
        if *active != c.origin {
            return;
        }
        if let Some(j) = c.jar_if_changed() {
            if let Ok(b) = serde_json::to_vec(&j) {
                if let Err(e) = write_private_atomic(&self.session, &b) {
                    eprintln!("topo: could not keep the session: {e}");
                }
            }
        }
    }

    /// Connects to origin with pin (already probed). The same server again
    /// (a new pin after it made a new certificate) keeps its session;
    /// another server starts signed out.
    pub fn connect(&self, now: Option<&Client>, origin: &str, pin: &str) -> Result<Client, String> {
        let mut active = self.active.lock().map_err(|_| "lock")?;
        let origin = normalize(origin)?;
        let kept = now.filter(|c| c.origin == origin).map(|c| c.jar());
        let c = Client::new(&origin, pin, kept.clone())?;
        let saved = serde_json::to_vec_pretty(&Saved { url: c.origin.clone(), pin: c.pin.clone() }).map_err(|e| e.to_string())?;
        write_private_atomic(&self.config, &saved)?;
        match kept {
            Some(j) => write_private_atomic(&self.session, &serde_json::to_vec(&j).map_err(|e| e.to_string())?)?,
            None => remove(&self.session)?,
        }
        *active = c.origin.clone();
        Ok(c)
    }

    /// Forgets the server: the address, the pin and the session.
    pub fn disconnect(&self) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|_| "lock")?;
        active.clear();
        remove(&self.session)?;
        remove(&self.config)
    }
}

fn remove(p: &Path) -> Result<(), String> {
    match fs::remove_file(p) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// client_connect: the server must answer first, with this pin; then it is
/// kept. Errors: the probe's codes, "untrusted:<fp>" and "pin-changed:<fp>"
/// with the fingerprint.
pub fn connect(store: &Store, now: Option<&Client>, url: &str, pin: &str) -> Result<Client, String> {
    let p = probe(url, pin);
    if !p.error.is_empty() {
        return Err(if p.fingerprint.is_empty() { p.error } else { format!("{}:{}", p.error, p.fingerprint) });
    }
    store.connect(now, &p.url, pin)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc;
    use std::thread;

    const CERT_A: &[u8] = include_bytes!("testdata/cert-a.der");
    const KEY_A: &[u8] = include_bytes!("testdata/key-a.der");
    const CERT_B: &[u8] = include_bytes!("testdata/cert-b.der");
    const KEY_B: &[u8] = include_bytes!("testdata/key-b.der");
    // openssl x509 -noout -fingerprint -sha256 of each (made for these tests).
    const FP_A: &str = "A6:08:2D:50:E7:2C:E3:6B:3E:2B:0F:A0:BF:6A:CF:18:EE:68:34:75:AA:29:1A:20:C4:CD:32:3B:30:CF:7B:6C";
    const FP_B: &str = "18:85:62:E8:D1:4F:9D:6C:AA:4B:4B:AE:36:3E:BE:EE:42:A2:76:5D:C7:7B:52:AA:0F:7E:23:01:44:11:9E:BA";

    #[test]
    fn addresses() {
        assert_eq!(normalize("192.168.1.20:7380").unwrap(), "https://192.168.1.20:7380");
        assert_eq!(normalize(" https://topo.example.com/some/page ").unwrap(), "https://topo.example.com");
        assert_eq!(normalize("https://topo.example.com:443").unwrap(), "https://topo.example.com");
        assert_eq!(normalize("http://127.0.0.1:7380").unwrap(), "http://127.0.0.1:7380");
        assert_eq!(normalize("http://localhost:7380/").unwrap(), "http://localhost:7380");
        assert_eq!(normalize("http://[::1]:7380").unwrap(), "http://[::1]:7380");
        assert_eq!(normalize("http://192.168.1.20:7380"), Err("needs-https".into()));
        assert_eq!(normalize("http://topo.example.com"), Err("needs-https".into()));
        for bad in ["", "   ", "ftp://x", "https://user:pw@x.com", "file:///etc/passwd", "a b", "https://"] {
            assert!(normalize(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn only_the_api() {
        for good in ["/api/health", "/api/sites/s_1/revs?after=3", "/api/events"] {
            assert!(api_path(good), "{good}");
        }
        for bad in ["/", "/index.html", "api/health", "/api/../x", "//evil.example/api/", "/api/x#y", "/api/\r\nX: y", "https://x/api/", "/api/a b"] {
            assert!(!api_path(bad), "{bad}");
        }
    }

    #[test]
    fn fingerprints() {
        // SHA-256 of "abc".
        assert!(fingerprint(b"abc").starts_with("BA:78:16:BF:8F:01:CF:EA"));
        assert_eq!(fingerprint(CERT_A), FP_A);
        assert_eq!(clean_fingerprint(&FP_A.to_lowercase()), FP_A);
        assert_eq!(clean_fingerprint(&FP_A.replace(':', "")), FP_A);
        assert_eq!(clean_fingerprint(&FP_A.replace(':', " ")), FP_A);
        assert_eq!(clean_fingerprint("AB:CD"), "");
        assert_eq!(clean_fingerprint(&format!("{FP_A}:ZZ")), "");
    }

    #[test]
    fn cookies() {
        let mut j = Jar::default();
        j.set("topo_c=abc; Path=/; Max-Age=600; HttpOnly; SameSite=Lax", 1000);
        j.set("__Host-topo_s=tok123; Path=/; Max-Age=86400; HttpOnly; Secure", 1000);
        assert_eq!(j.header(1000), "__Host-topo_s=tok123; topo_c=abc");
        assert!(j.dirty);
        // Expired ones are not sent.
        assert_eq!(j.header(1601), "__Host-topo_s=tok123");
        // Max-Age=0 (or negative) deletes, as the server's sign-out does.
        j.set("topo_c=; Path=/; Max-Age=0", 1000);
        j.set("__Host-topo_s=; Path=/; Max-Age=-1", 1000);
        assert_eq!(j.header(1000), "");
        // Nothing odd is kept.
        j.set("no equals sign", 1000);
        j.set("a b=c", 1000);
        j.set("x=y\r\nInjected: 1", 1000);
        assert!(j.cookies.is_empty());
        // The same value again does not count as a change.
        j.set("s=1; Max-Age=10", 5);
        j.dirty = false;
        j.set("s=1; Max-Age=10", 5);
        assert!(!j.dirty);
        let back: Jar = serde_json::from_str(&serde_json::to_string(&j).unwrap()).unwrap();
        assert_eq!(back.cookies, j.cookies);
    }

    #[test]
    fn event_lines() {
        let mut p = SseParser::default();
        let mut got = Vec::new();
        for l in ["retry: 5000", "", ": ping", "", "event: head", "data: {\"site\":\"s_1\",\"n\":3}", "", "data: a", "data: b", "", "event: x", "", "id: 7", "data:no-space", ""] {
            if let Some(e) = p.line(l) {
                got.push(e);
            }
        }
        assert_eq!(p.retry_ms, Some(5000));
        assert_eq!(got, vec![
            ("head".to_string(), "{\"site\":\"s_1\",\"n\":3}".to_string()),
            ("message".to_string(), "a\nb".to_string()),
            ("message".to_string(), "no-space".to_string()),
        ]);
    }

    // ---- Loopback servers ----

    /// Reads one HTTP request head (and its body, by Content-Length).
    fn read_request(s: &mut impl Read) -> String {
        let mut buf = Vec::new();
        let mut b = [0u8; 1];
        while !buf.ends_with(b"\r\n\r\n") {
            if s.read(&mut b).unwrap_or(0) == 0 {
                break;
            }
            buf.push(b[0]);
        }
        let head = String::from_utf8_lossy(&buf).to_string();
        let len = head
            .lines()
            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
            .unwrap_or(0);
        let mut body = vec![0u8; len];
        let _ = s.read_exact(&mut body);
        head + &String::from_utf8_lossy(&body)
    }

    /// An https server on 127.0.0.1 with the given certificate, answering
    /// each request with `reply` and sending what it got to the test.
    fn tls_server(cert: &'static [u8], key: &'static [u8], reply: &'static str) -> (u16, mpsc::Receiver<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let cfg = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![CertificateDer::from(cert)], rustls::pki_types::PrivateKeyDer::Pkcs8(key.into()))
            .unwrap();
        let cfg = Arc::new(cfg);
        thread::spawn(move || {
            for s in l.incoming() {
                let Ok(tcp) = s else { continue };
                let cfg = cfg.clone();
                let tx = tx.clone();
                thread::spawn(move || {
                    let conn = rustls::ServerConnection::new(cfg).unwrap();
                    let mut tls = rustls::StreamOwned::new(conn, tcp);
                    let req = read_request(&mut tls);
                    if req.is_empty() {
                        return;
                    }
                    let _ = tx.send(req);
                    let _ = tls.write_all(reply.as_bytes());
                    let _ = tls.flush();
                    tls.conn.send_close_notify();
                    let _ = tls.flush();
                });
            }
        });
        (port, rx)
    }

    const HEALTH: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: topo_c=chal; Path=/; Max-Age=600; HttpOnly\r\nContent-Length: 30\r\nConnection: close\r\n\r\n{\"ok\":true,\"server\":\"topo\"}\n\n\n";

    #[test]
    fn self_signed_asks_then_pins() {
        let (port, rx) = tls_server(CERT_A, KEY_A, HEALTH);
        let origin = format!("https://127.0.0.1:{port}");
        // No pin: refused, with the fingerprint to compare.
        let c = Client::new(&origin, "", None).unwrap();
        assert_eq!(c.probe(), Err(format!("untrusted:{FP_A}")));
        // Compared and pinned: it answers, and its cookie is kept.
        let c = Client::new(&origin, &FP_A.to_lowercase(), None).unwrap();
        assert_eq!(c.pin, FP_A);
        assert_eq!(c.probe(), Ok(FP_A.to_string()));
        assert_eq!(c.jar_if_changed().map(|j| j.header(now_secs())), Some("topo_c=chal".into()));
        assert!(c.jar_if_changed().is_none());
        let got = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(got.starts_with("GET /api/health HTTP/1.1"), "{got}");
        // Whatever the server's name says: the pin is the identity.
        let c = Client::new(&format!("https://localhost:{port}"), FP_A, None).unwrap();
        assert!(c.probe().is_ok());
    }

    #[test]
    fn changed_certificate_is_refused() {
        // Pinned to A; the server now shows B.
        let (port, _rx) = tls_server(CERT_B, KEY_B, HEALTH);
        let c = Client::new(&format!("https://127.0.0.1:{port}"), FP_A, None).unwrap();
        assert_eq!(c.request("GET", "/api/me", None).err(), Some(format!("pin-changed:{FP_B}")));
        // ... every time, and the stream gives up rather than retrying.
        assert_eq!(c.request("GET", "/api/me", None).err(), Some(format!("pin-changed:{FP_B}")));
        let stop = AtomicBool::new(false);
        let mut seen = Vec::new();
        c.events("/api/events", &stop, |e| {
            seen.push(e);
            true
        });
        assert_eq!(seen, vec![Ev::Error { closed: true }]);
    }

    /// A plain http server on 127.0.0.1 answering in turn from `replies`.
    fn http_server(replies: Vec<&'static [u8]>) -> (u16, mpsc::Receiver<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            for reply in replies {
                let Ok((mut s, _)) = l.accept() else { return };
                let req = read_request(&mut s);
                let _ = tx.send(req);
                let _ = s.write_all(reply);
                let _ = s.flush();
                drop::<TcpStream>(s);
            }
        });
        (port, rx)
    }

    #[test]
    fn requests_carry_the_session_and_no_origin() {
        let (port, rx) = http_server(vec![
            &b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: topo_s=sess1; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax\r\nContent-Length: 18\r\nConnection: close\r\n\r\n{\"user\":{\"id\":1}}\n"[..],
            &b"HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nContent-Length: 20\r\nConnection: close\r\n\r\n{\"error\":\"conflict\"}"[..],
            &b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 3\r\nConnection: close\r\n\r\n\xff\x00\x01"[..],
            &b"HTTP/1.1 204 No Content\r\nSet-Cookie: topo_s=; Path=/; Max-Age=0\r\nConnection: close\r\n\r\n"[..],
        ]);
        let c = Client::new(&format!("http://127.0.0.1:{port}"), "", None).unwrap();
        let r = c.request("POST", "/api/auth/verify", Some("{\"code\":\"123456\"}")).unwrap();
        assert_eq!(r.status, 200);
        let first = rx.recv().unwrap();
        let lower = first.to_ascii_lowercase();
        assert!(first.starts_with("POST /api/auth/verify HTTP/1.1"), "{first}");
        assert!(lower.contains("\r\nx-topo: 1\r\n") && lower.contains("\r\nsec-fetch-site: same-origin\r\n") && lower.contains("content-type: application/json"), "{first}");
        assert!(!lower.contains("\r\norigin:") && !lower.contains("\r\ncookie:"), "{first}");
        assert!(first.ends_with("{\"code\":\"123456\"}"), "{first}");
        // An error status is an answer, with the session cookie sent.
        let r = c.request("PUT", "/api/sites/s_1/name", Some("{}")).unwrap();
        assert_eq!((r.status, r.to_json()["body"].as_str()), (409, Some("{\"error\":\"conflict\"}")));
        assert!(rx.recv().unwrap().contains("\r\nCookie: topo_s=sess1\r\n"));
        // Bytes that are not text cross as base64.
        let r = c.request("GET", "/api/sites/s_1/backups/b_1", None).unwrap();
        assert_eq!((r.to_json()["b64"].as_bool(), r.to_json()["body"].as_str()), (Some(true), Some("/wAB")));
        rx.recv().unwrap();
        // The server's sign-out deletes the session here too.
        assert_eq!(c.request("POST", "/api/auth/signout", None).unwrap().status, 204);
        assert_eq!(c.jar_if_changed().map(|j| j.cookies.len()), Some(0));
        assert!(rx.recv().unwrap().starts_with("POST /api/auth/signout "));
        // Nothing outside the API, no odd methods; and nothing is sent.
        assert_eq!(c.request("GET", "/index.html", None).err(), Some("path".into()));
        assert_eq!(c.request("TRACE", "/api/health", None).err(), Some("method".into()));
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
    }

    #[test]
    fn nobody_there_is_offline() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let c = Client::new(&format!("http://127.0.0.1:{port}"), "", None).unwrap();
        assert_eq!(c.request("GET", "/api/health", None).err(), Some("offline".into()));
        // A pin that is not a fingerprint is refused before anything is sent.
        assert_eq!(Client::new(&format!("https://127.0.0.1:{port}"), "AB:CD", None).err(), Some("fingerprint".into()));
    }

    #[test]
    fn the_event_stream() {
        // Opens, says two things, drops; reconnects after its retry time;
        // then the server refuses (signed out): closed for good.
        let (port, rx) = http_server(vec![
            &b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\nretry: 500\n\n: ping\n\nevent: head\ndata: {\"site\":\"s_1\",\"n\":2}\n\nevent: me\ndata: {}\n\n"[..],
            &b"HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: 24\r\nConnection: close\r\n\r\n{\"error\":\"unauthorized\"}"[..],
        ]);
        let c = Client::new(&format!("http://127.0.0.1:{port}"), "", None).unwrap();
        let stop = AtomicBool::new(false);
        let mut seen = Vec::new();
        let t0 = std::time::Instant::now();
        c.events("/api/events", &stop, |e| {
            seen.push(e);
            true
        });
        assert_eq!(seen, vec![
            Ev::Open,
            Ev::Event { name: "head".into(), data: "{\"site\":\"s_1\",\"n\":2}".into() },
            Ev::Event { name: "me".into(), data: "{}".into() },
            Ev::Error { closed: false },
            Ev::Error { closed: true },
        ]);
        assert!(t0.elapsed() >= Duration::from_millis(450), "waited the server's retry time");
        let req = rx.recv().unwrap().to_ascii_lowercase();
        assert!(req.starts_with("get /api/events ") && req.contains("accept: text/event-stream"), "{req}");
        // Stopping: the sink's false ends it at once.
        let (port, _rx) = http_server(vec![&b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\nevent: a\ndata: 1\n\n"[..]]);
        let c = Client::new(&format!("http://127.0.0.1:{port}"), "", None).unwrap();
        let mut n = 0;
        c.events("/api/events", &stop, |_| {
            n += 1;
            false
        });
        assert_eq!(n, 1);
        // Outside the API: refused at once.
        let mut got = Vec::new();
        c.events("/elsewhere", &stop, |e| {
            got.push(e);
            true
        });
        assert_eq!(got, vec![Ev::Error { closed: true }]);
    }

    #[test]
    fn probe_words() {
        let p = probe_result("https://x".into(), Err("untrusted:AB:CD".into()));
        assert_eq!((p.error.as_str(), p.fingerprint.as_str()), ("untrusted", "AB:CD"));
        let p = probe_result("https://x".into(), Err("pin-changed:EF:01".into()));
        assert_eq!((p.error.as_str(), p.fingerprint.as_str()), ("pin-changed", "EF:01"));
        let p = probe_result("https://x".into(), Err("offline".into()));
        assert_eq!((p.error.as_str(), p.fingerprint.as_str()), ("offline", ""));
        let p = probe_result("https://x".into(), Ok("AB".into()));
        assert!(p.error.is_empty() && p.fingerprint == "AB");
        assert_eq!(probe("http://192.168.1.4:7380", "").error, "needs-https");
        assert_eq!(probe("", "").error, "address");
    }

    #[test]
    fn a_jar_from_another_server_is_not_used() {
        let mut j = Jar { origin: "https://a.example".into(), ..Default::default() };
        j.set("topo_s=x; Max-Age=60", now_secs());
        let c = Client::new("https://b.example", "", Some(j.clone())).unwrap();
        assert!(c.jar.lock().unwrap().cookies.is_empty());
        let c = Client::new("https://a.example", "", Some(j)).unwrap();
        assert_eq!(c.jar.lock().unwrap().cookies.len(), 1);
    }

    // ---- Review of 7c ----

    const CA_ROOT: &[u8] = include_bytes!("testdata/ca-root.der");
    const CERT_CA: &[u8] = include_bytes!("testdata/cert-ca.der");
    const KEY_CA: &[u8] = include_bytes!("testdata/key-ca.der");

    fn test_roots() -> RootCertStore {
        let mut r = RootCertStore::empty();
        r.add(CertificateDer::from(CA_ROOT)).unwrap();
        r
    }

    #[test]
    fn an_authority_signed_certificate_needs_no_question() {
        // D194: signed by an authority the client trusts: it connects with
        // no pin; with a pin, only that certificate is accepted, even one
        // an authority signed.
        let (port, _rx) = tls_server(CERT_CA, KEY_CA, HEALTH);
        let fp = fingerprint(CERT_CA);
        let c = Client::with_roots(&format!("https://127.0.0.1:{port}"), "", None, test_roots()).unwrap();
        assert_eq!(c.probe(), Ok(fp.clone()));
        let c = Client::with_roots(&format!("https://localhost:{port}"), "", None, test_roots()).unwrap();
        assert_eq!(c.probe(), Ok(fp.clone()));
        let c = Client::with_roots(&format!("https://127.0.0.1:{port}"), FP_A, None, test_roots()).unwrap();
        assert_eq!(c.request("GET", "/api/me", None).err(), Some(format!("pin-changed:{fp}")));
        // The same certificate with nobody vouching for it (the real roots):
        // asked, as any self-signed one.
        let c = Client::new(&format!("https://127.0.0.1:{port}"), "", None).unwrap();
        assert_eq!(c.request("GET", "/api/me", None).err(), Some(format!("untrusted:{fp}")));
        // ... and its event stream stops rather than retrying for ever.
        let stop = AtomicBool::new(false);
        let mut seen = Vec::new();
        c.events("/api/events", &stop, |e| {
            seen.push(e);
            true
        });
        assert_eq!(seen, vec![Ev::Error { closed: true }]);
    }

    #[test]
    fn a_refusal_is_told_to_every_thread_that_met_it() {
        // Many requests (and a stream) failing the handshake at once: each
        // gets "pin-changed", none "offline".
        let (port, _rx) = tls_server(CERT_B, KEY_B, HEALTH);
        let c = Arc::new(Client::new(&format!("https://127.0.0.1:{port}"), FP_A, None).unwrap());
        let want = format!("pin-changed:{FP_B}");
        let hs: Vec<_> = (0..8)
            .map(|_| {
                let c = c.clone();
                thread::spawn(move || c.request("GET", "/api/me", None).err())
            })
            .collect();
        for h in hs {
            assert_eq!(h.join().unwrap(), Some(want.clone()));
        }
    }

    #[test]
    fn a_redirect_is_answered_as_it_is() {
        // D195: never followed; the page gets the 302 and nothing else is
        // asked of anyone.
        let (port, rx) = http_server(vec![
            &b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/api/elsewhere\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"[..],
            &b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nno"[..],
        ]);
        let c = Client::new(&format!("http://127.0.0.1:{port}"), "", None).unwrap();
        let r = c.request("GET", "/api/health", None).unwrap();
        assert_eq!(r.status, 302);
        assert!(rx.recv_timeout(Duration::from_secs(5)).unwrap().starts_with("GET /api/health "));
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "a second request was made");
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("topo-client-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn store_in(d: &Path) -> Store {
        Store::new(d.join("config").join("client.json"), d.join("data").join("client").join("session.json"))
    }

    #[test]
    fn the_session_is_kept_across_restarts() {
        let d = scratch("restart");
        let st = store_in(&d);
        assert!(st.load().unwrap().is_none());
        let c = st.connect(None, "http://127.0.0.1:7380", "").unwrap();
        assert_eq!(st.saved(), Saved { url: "http://127.0.0.1:7380".into(), pin: String::new() });
        c.jar.lock().unwrap().set("topo_s=sess1; Path=/; Max-Age=3600", now_secs());
        st.keep_jar(&c);
        let file = d.join("data").join("client").join("session.json");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // A restart: a new store on the same files.
        let st = store_in(&d);
        let c = st.load().unwrap().unwrap();
        assert_eq!((c.origin.as_str(), c.jar().header(now_secs())), ("http://127.0.0.1:7380", "topo_s=sess1".to_string()));
        // The same server with a new pin keeps the session.
        let c2 = st.connect(Some(&c), "http://127.0.0.1:7380/", FP_A).unwrap();
        assert_eq!((c2.pin.as_str(), c2.jar().header(now_secs())), (FP_A, "topo_s=sess1".to_string()));
        assert_eq!(store_in(&d).load().unwrap().unwrap().jar().header(now_secs()), "topo_s=sess1");
        // Another server starts signed out, on disk too.
        let c3 = st.connect(Some(&c2), "http://localhost:7380", "").unwrap();
        assert!(c3.jar().cookies.is_empty() && !file.exists());
        // A late answer from the server left writes nothing.
        c2.jar.lock().unwrap().set("topo_s=late; Max-Age=60", now_secs());
        st.keep_jar(&c2);
        assert!(!file.exists());
        c3.jar.lock().unwrap().set("topo_s=s3; Max-Age=60", now_secs());
        st.keep_jar(&c3);
        assert!(file.exists());
        // Disconnect forgets both files; nothing is written after it.
        st.disconnect().unwrap();
        assert!(!file.exists() && !d.join("config").join("client.json").exists());
        c3.jar.lock().unwrap().set("topo_s=s4; Max-Age=60", now_secs());
        st.keep_jar(&c3);
        assert!(!file.exists());
        assert!(store_in(&d).load().unwrap().is_none());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn cookies_saved_at_once_leave_the_newest_whole() {
        let d = scratch("race");
        let st = Arc::new(store_in(&d));
        let c = Arc::new(st.connect(None, "http://127.0.0.1:7380", "").unwrap());
        let hs: Vec<_> = (0..16)
            .map(|i| {
                let (st, c) = (st.clone(), c.clone());
                thread::spawn(move || {
                    for k in 0..20 {
                        c.jar.lock().unwrap().set(&format!("c{i}={k}; Max-Age=600"), now_secs());
                        st.keep_jar(&c);
                    }
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }
        let on_disk: Jar = serde_json::from_slice(&fs::read(d.join("data").join("client").join("session.json")).unwrap()).unwrap();
        assert_eq!(on_disk.cookies, c.jar().cookies);
        assert_eq!(on_disk.cookies.len(), 16);
        let _ = fs::remove_dir_all(&d);
    }
}
