// A site monitor's link (src/monitorlink.rs) run against a real topo-server,
// for tests only (tests/server-e2e.mjs step 15k): the same link, crypto
// (src/servercrypto.rs) and transport (src/client.rs) the app runs, with a
// stand-in for this PC's monitor (the statuses and issues given). Not part
// of the app: an example is never bundled.
//
//   monitor-link keys              -> {"encPub","sigPub","secret"}
//   monitor-link tick <config.json> -> what the link did
//
// config: { origin, pin, token, secret, site, monitor, name, network,
//           roster, watched, statuses: [{key,nodeId,state}],
//           issues: [{id,nodeId,name}], ticks }

#[path = "../src/checks.rs"]
#[allow(dead_code)]
mod checks;
#[path = "../src/client.rs"]
#[allow(dead_code)]
mod client;
#[path = "../src/issues.rs"]
#[allow(dead_code)]
mod issues;
#[path = "../src/monitor.rs"]
#[allow(dead_code)]
mod monitor;
#[path = "../src/monitorlink.rs"]
#[allow(dead_code)]
mod monitorlink;
#[path = "../src/servercrypto.rs"]
#[allow(dead_code)]
mod servercrypto;
#[path = "../src/stats.rs"]
#[allow(dead_code)]
mod stats;

use std::cell::RefCell;

use serde_json::{json, Value};

use issues::{Act, Issue, Outage};
use monitor::Status;
use monitorlink::{Api, Host, Link, LinkFile};
use servercrypto::{DeviceKeys, Roster};

struct Calls(RefCell<Vec<(String, String, u16)>>);

struct ClientApi {
    client: client::Client,
    calls: Calls,
}
impl Api for ClientApi {
    fn call(&self, method: &str, path: &str, body: Option<&str>) -> Result<(u16, Vec<u8>), String> {
        let r = self.client.request(method, path, body).map(|r| (r.status, r.body));
        let st = r.as_ref().map(|x| x.0).unwrap_or(0);
        self.calls.0.borrow_mut().push((method.into(), path.split('?').next().unwrap_or("").into(), st));
        r
    }
}

#[derive(Default)]
struct TestHost {
    network: String,
    statuses: Vec<Status>,
    issues: Vec<Issue>,
    acts: RefCell<Vec<Value>>,
    quiets: RefCell<Vec<Value>>,
    retention: RefCell<Vec<u32>>,
    stale: RefCell<Vec<String>>,
    revoked: RefCell<bool>,
}
impl Host for TestHost {
    fn network_id(&self) -> String {
        self.network.clone()
    }
    fn current_retention(&self) -> u32 {
        self.retention.borrow().last().copied().unwrap_or(360)
    }
    fn statuses(&self) -> Vec<Status> {
        self.statuses.clone()
    }
    fn issues(&self) -> Vec<Issue> {
        self.issues.clone()
    }
    fn stats_day(&self, day: i64) -> Option<Value> {
        let key = self.statuses.first().map(|s| s.key.clone()).unwrap_or_default();
        let node = self.statuses.first().map(|s| s.node_id.clone()).unwrap_or_default();
        Some(json!({ key: { "node": node, "name": "from Rust", "hours": [{ "hour": day, "checks": 60, "ok": 59, "fail": 1 }] } }))
    }
    fn act(&self, issue: &str, a: Act) {
        self.acts.borrow_mut().push(json!({ "issue": issue, "act": a.act, "at": a.at, "by": a.by }));
    }
    fn quiet(&self, scope: &str, id: &str, until: i64) {
        self.quiets.borrow_mut().push(json!({ "scope": scope, "id": id, "until": until }));
    }
    fn retention(&self, days: u32) {
        self.retention.borrow_mut().push(days);
    }
    fn notify_stale(&self, name: &str) {
        self.stale.borrow_mut().push(name.into());
    }
    fn revoked(&self) {
        *self.revoked.borrow_mut() = true;
    }
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("keys") => {
            let k = DeviceKeys::generate();
            println!("{}", json!({ "encPub": k.enc_pub(), "sigPub": k.sig_pub(), "secret": k.to_secret() }));
        }
        Some("tick") => {
            let cfg: Value = serde_json::from_slice(&std::fs::read(args.get(2).expect("config")).expect("read config")).expect("config json");
            let keys = DeviceKeys::from_secret(&s(&cfg, "secret")).expect("keys");
            let roster: Roster = serde_json::from_value(cfg["roster"].clone()).expect("roster");
            let file = LinkFile {
                origin: s(&cfg, "origin"),
                pin: s(&cfg, "pin"),
                site: s(&cfg, "site"),
                monitor: s(&cfg, "monitor"),
                name: s(&cfg, "name"),
                network: s(&cfg, "network"),
                roster: Some(roster),
                stats_days: -1,
                ..Default::default()
            };
            let client = client::Client::new(&file.origin, &file.pin, None).expect("client");
            client.set_monitor_token(&s(&cfg, "token"));
            let api = ClientApi { client, calls: Calls(RefCell::new(Vec::new())) };
            let now = monitor::now_ms();
            let statuses = cfg["statuses"].as_array().cloned().unwrap_or_default().iter().map(|x| Status {
                key: s(x, "key"),
                node_id: s(x, "nodeId"),
                state: s(x, "state"),
                since: now - 120_000,
                checked: Some(now),
                via: "icmp".into(),
                ..Default::default()
            }).collect();
            let issues = cfg["issues"].as_array().cloned().unwrap_or_default().iter().map(|x| Issue {
                id: s(x, "id"),
                network_id: s(&cfg, "network"),
                node_id: s(x, "nodeId"),
                name: s(x, "name"),
                outages: vec![Outage { from: now - 120_000, to: None }],
                monitor: s(&cfg, "name"),
                rev: 1,
                ..Default::default()
            }).collect();
            let host = TestHost { network: s(&cfg, "watched"), statuses, issues, ..Default::default() };
            let mut link = Link::new(file, keys);
            let ticks = cfg["ticks"].as_u64().unwrap_or(1).max(1);
            let mut errors = Vec::new();
            for i in 0..ticks {
                if let Err(e) = link.tick(&host, &api, now + i as i64 * monitorlink::RECORDS_EVERY_MS) {
                    errors.push(format!("{e:?}"));
                }
            }
            let calls: Vec<Value> = api.calls.0.borrow().iter().map(|(m, p, st)| json!([m, p, st])).collect();
            println!("{}", json!({
                "errors": errors,
                "calls": calls,
                "acts": *host.acts.borrow(),
                "quiets": *host.quiets.borrow(),
                "retention": *host.retention.borrow(),
                "revoked": *host.revoked.borrow(),
                "epoch": link.file.roster.as_ref().map(|r| r.epoch).unwrap_or(0),
                "lastN": link.file.last_n,
            }));
        }
        _ => {
            eprintln!("usage: monitor-link keys | monitor-link tick <config.json>");
            std::process::exit(2);
        }
    }
}
