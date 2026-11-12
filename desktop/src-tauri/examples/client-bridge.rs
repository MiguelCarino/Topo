// A stand-in for the desktop app's window, for tests only
// (tests/desktop-client-e2e.mjs): the same transport (src/client.rs) the
// app's commands use (src/clientcmd.rs), driven over stdin and stdout, so
// the page in Playwright runs js/server.js through Rust against the real
// topo-server. Not part of the app: an example is never bundled.
//
// In, one JSON per line: {"id":1,"cmd":"client_request","args":{...}}.
// Out, one JSON per line: {"id":1,"ok":true,"result":...} or
// {"id":1,"ok":false,"error":"..."}; a stream's messages as
// {"stream":7,"msg":{"kind":"event",...}}.
// The commands and their answers are the app's (client_info, client_probe,
// client_connect, client_disconnect, client_request, client_events,
// client_events_close). The server and the session are kept in files
// in the folder given as the first argument, by the app's own code
// (src/client.rs Store), so a new bridge on the same folder is the app
// restarted.
//
//   client-bridge <folder>

#[path = "../src/client.rs"]
#[allow(dead_code)]
mod client;

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

struct Bridge {
    store: Arc<client::Store>,
    loaded: bool,
    client: Option<Arc<client::Client>>,
    streams: HashMap<u64, Arc<AtomicBool>>,
    next: u64,
}

fn say(out: &Arc<Mutex<std::io::Stdout>>, v: Value) {
    let mut o = out.lock().unwrap();
    let _ = writeln!(o, "{v}");
    let _ = o.flush();
}

fn s(args: &Value, k: &str) -> String {
    args.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

fn main() {
    let dir = std::path::PathBuf::from(std::env::args().nth(1).expect("usage: client-bridge <folder>"));
    let store = client::Store::new(dir.join("client.json"), dir.join("client").join("session.json"));
    let out = Arc::new(Mutex::new(std::io::stdout()));
    let b = Arc::new(Mutex::new(Bridge { store: Arc::new(store), loaded: false, client: None, streams: HashMap::new(), next: 0 }));
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let cmd = s(&msg, "cmd");
        let args = msg.get("args").cloned().unwrap_or(json!({}));
        let (out2, b2) = (out.clone(), b.clone());
        // Each command on its own thread, as the app's are: a request never
        // waits behind another.
        std::thread::spawn(move || {
            let r: Result<Value, String> = run(&b2, &out2, &cmd, &args);
            say(&out2, match r {
                Ok(v) => json!({ "id": id, "ok": true, "result": v }),
                Err(e) => json!({ "id": id, "ok": false, "error": e }),
            });
        });
    }
}

fn info(c: &Option<Arc<client::Client>>) -> Value {
    match c {
        Some(c) => json!({ "url": c.origin, "pin": c.pin }),
        None => json!({ "url": "", "pin": "" }),
    }
}

fn close_all(b: &mut Bridge) {
    for (_, stop) in b.streams.drain() {
        stop.store(true, Ordering::SeqCst);
    }
}

/// The saved server, read once (the app's clientcmd.rs current()).
fn load(g: &mut Bridge) {
    if !g.loaded {
        g.loaded = true;
        match g.store.load() {
            Ok(c) => g.client = c.map(Arc::new),
            Err(e) => eprintln!("bridge: the saved server is not usable: {e}"),
        }
    }
}

fn run(b: &Arc<Mutex<Bridge>>, out: &Arc<Mutex<std::io::Stdout>>, cmd: &str, args: &Value) -> Result<Value, String> {
    load(&mut b.lock().unwrap());
    match cmd {
        "client_info" => Ok(info(&b.lock().unwrap().client)),
        "client_probe" => Ok(serde_json::to_value(client::probe(&s(args, "url"), &s(args, "pin"))).unwrap()),
        "client_connect" => {
            let (store, now) = {
                let g = b.lock().unwrap();
                (g.store.clone(), g.client.clone())
            };
            let c = client::connect(&store, now.as_deref(), &s(args, "url"), &s(args, "pin"))?;
            let mut g = b.lock().unwrap();
            close_all(&mut g);
            g.client = Some(Arc::new(c));
            Ok(info(&g.client))
        }
        "client_disconnect" => {
            let mut g = b.lock().unwrap();
            close_all(&mut g);
            g.client = None;
            g.store.disconnect()?;
            Ok(info(&None))
        }
        // A page that reloads: its streams end (the app's on_page_load).
        "page_load" => {
            close_all(&mut b.lock().unwrap());
            Ok(Value::Null)
        }
        "client_request" => {
            let c = b.lock().unwrap().client.clone().ok_or("not-connected")?;
            let body = args.get("body").and_then(Value::as_str).map(str::to_string);
            let r = c.request(&s(args, "method").to_ascii_uppercase(), &s(args, "path"), body.as_deref());
            let store = b.lock().unwrap().store.clone();
            store.keep_jar(&c);
            r.map(|r| r.to_json())
        }
        "client_events" => {
            let (c, id, stop) = {
                let mut g = b.lock().unwrap();
                let c = g.client.clone().ok_or("not-connected")?;
                g.next += 1;
                let id = g.next;
                let stop = Arc::new(AtomicBool::new(false));
                g.streams.insert(id, stop.clone());
                (c, id, stop)
            };
            let path = s(args, "path");
            let (out2, b2) = (out.clone(), b.clone());
            std::thread::spawn(move || {
                c.events(&path, &stop, |ev| {
                    let store = b2.lock().unwrap().store.clone();
                    store.keep_jar(&c);
                    if stop.load(Ordering::SeqCst) {
                        return false;
                    }
                    say(&out2, json!({ "stream": id, "msg": ev.to_json() }));
                    true
                });
                b2.lock().unwrap().streams.remove(&id);
            });
            Ok(json!(id))
        }
        "client_events_close" => {
            let id = args.get("id").and_then(Value::as_u64).unwrap_or(0);
            if let Some(stop) = b.lock().unwrap().streams.remove(&id) {
                stop.store(true, Ordering::SeqCst);
            }
            Ok(Value::Null)
        }
        _ => Err(format!("unknown command {cmd}")),
    }
}
