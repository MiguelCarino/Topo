// The app's commands for "Connect to a Topo server" (docs/SCOPE.md D144,
// step 7c): what js/desktopclient.js calls, over src/client.rs.
//
//   client_info           the server this window is connected to (or none)
//   client_probe          is a Topo server at this address? its certificate's
//                         fingerprint when it signs its own (to compare)
//   client_connect        connect this window (pinning that fingerprint)
//   client_disconnect     forget the server and the session
//   client_request        one request to its /api/ (js/server.js's fetch)
//   client_events         the event stream, over a Channel (its EventSource)
//   client_events_close   stop one stream
//
// Kept on disk: <app config>/client.json (the address and the pin) and
// <app data>/client/session.json (the cookies, readable by this user only),
// so a restart keeps the person signed in, as a browser would. Both are
// written by src/client.rs Store (one at a time, whole or not at all),
// the same code the tests' bridge runs.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::client::{probe, Client, Probe, Store};

#[derive(Default)]
pub struct ClientState {
    loaded: AtomicBool,
    /// The files (src/client.rs Store), made at the first command.
    store: OnceLock<Store>,
    client: Mutex<Option<Arc<Client>>>,
    streams: Mutex<HashMap<u32, Arc<AtomicBool>>>,
    next: AtomicU32,
}

impl ClientState {
    /// Every stream stops (the page reloaded, or the server changed).
    pub fn close_all(&self) {
        if let Ok(mut s) = self.streams.lock() {
            for (_, stop) in s.drain() {
                stop.store(true, Ordering::SeqCst);
            }
        }
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    /// The server's origin, "" when this window is not connected.
    pub url: String,
    /// The pinned fingerprint ("" when its certificate needs none).
    pub pin: String,
}

fn info_of(c: &Client) -> Info {
    Info { url: c.origin.clone(), pin: c.pin.clone() }
}

/// <app config>/client.json and <app data>/client/session.json.
fn store<'a>(app: &AppHandle, st: &'a ClientState) -> Result<&'a Store, String> {
    if let Some(s) = st.store.get() {
        return Ok(s);
    }
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?.join("client.json");
    let session = app.path().app_data_dir().map_err(|e| e.to_string())?.join("client").join("session.json");
    let _ = st.store.set(Store::new(config, session));
    st.store.get().ok_or_else(|| "store".to_string())
}

/// The client for the saved server, made once (at the first command).
fn current(app: &AppHandle, st: &ClientState) -> Option<Arc<Client>> {
    if !st.loaded.swap(true, Ordering::SeqCst) {
        match store(app, st).and_then(|s| s.load()) {
            Ok(Some(c)) => *st.client.lock().unwrap() = Some(Arc::new(c)),
            Ok(None) => {}
            Err(e) => eprintln!("topo: the saved server address is not usable: {e}"),
        }
    }
    st.client.lock().unwrap().clone()
}

/// The connected server's client, for what the app does on its own (the
/// connection heartbeat, src/connwatch.rs).
pub fn current_client(app: &AppHandle) -> Option<Arc<Client>> {
    let st = app.state::<ClientState>();
    current(app, &st)
}

/// The connected server's address and pin, as kept (a site monitor copies
/// them when it is turned on, step 7h).
pub fn saved_server(app: &AppHandle) -> Option<(String, String)> {
    let st = app.state::<ClientState>();
    let s = store(app, &st).ok()?.saved();
    (!s.url.is_empty()).then(|| (s.url, s.pin))
}

fn keep_jar(app: &AppHandle, c: &Client) {
    let st = app.state::<ClientState>();
    if let Ok(s) = store(app, &st) {
        s.keep_jar(c);
    }
}

/// Runs blocking network work off the command thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn client_info(app: AppHandle, st: State<'_, ClientState>) -> Info {
    match current(&app, &st) {
        Some(c) => info_of(&c),
        None => Info::default(),
    }
}

#[tauri::command]
pub async fn client_probe(url: String, pin: Option<String>) -> Result<Probe, String> {
    blocking(move || probe(&url, pin.as_deref().unwrap_or(""))).await
}

/// Connects this window: the server must answer first (with this pin).
/// The same server again keeps its session; another starts signed out.
#[tauri::command]
pub async fn client_connect(app: AppHandle, url: String, pin: Option<String>) -> Result<Info, String> {
    let pin = pin.unwrap_or_default();
    let app2 = app.clone();
    blocking(move || {
        let st = app2.state::<ClientState>();
        let now = current(&app2, &st);
        let c = crate::client::connect(store(&app2, &st)?, now.as_deref(), &url, &pin)?;
        st.close_all();
        let info = info_of(&c);
        *st.client.lock().unwrap() = Some(Arc::new(c));
        Ok(info)
    })
    .await?
}

/// Forgets the server: the address, the pin and the session (the page signs
/// out first, while it still can).
#[tauri::command]
pub fn client_disconnect(app: AppHandle, st: State<'_, ClientState>) -> Result<Info, String> {
    current(&app, &st);
    // Forgetting the server is going away (D377), said while it still can be.
    crate::connwatch::away(&app);
    st.close_all();
    *st.client.lock().unwrap() = None;
    store(&app, &st)?.disconnect()?;
    Ok(Info::default())
}

/// One request (js/server.js api(), js/serverui.js rawGet): the status, the
/// type and the body (base64 when it is not text). Errors: "not-connected",
/// "offline", "pin-changed:<fp>", "untrusted:<fp>", "path", "method",
/// "too-large".
#[tauri::command]
pub async fn client_request(app: AppHandle, method: String, path: String, body: Option<String>) -> Result<Value, String> {
    let c = {
        let st = app.state::<ClientState>();
        current(&app, &st).ok_or("not-connected")?
    };
    let app2 = app.clone();
    blocking(move || {
        let r = c.request(&method.to_ascii_uppercase(), &path, body.as_deref());
        keep_jar(&app2, &c);
        r.map(|r| r.to_json())
    })
    .await?
}

/// The event stream at path, each message sent on on_event as
/// { kind: "open" | "event" | "error", event, data, closed }. -> its id.
#[tauri::command]
pub fn client_events(app: AppHandle, st: State<'_, ClientState>, path: String, on_event: Channel<Value>) -> Result<u32, String> {
    let c = current(&app, &st).ok_or("not-connected")?;
    let id = st.next.fetch_add(1, Ordering::SeqCst) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    st.streams.lock().unwrap().insert(id, stop.clone());
    let app2 = app.clone();
    std::thread::spawn(move || {
        c.events(&path, &stop, |ev| {
            keep_jar(&app2, &c);
            !stop.load(Ordering::SeqCst) && on_event.send(ev.to_json()).is_ok()
        });
        if let Ok(mut s) = app2.state::<ClientState>().streams.lock() {
            s.remove(&id);
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn client_events_close(st: State<'_, ClientState>, id: u32) {
    if let Some(stop) = st.streams.lock().unwrap().remove(&id) {
        stop.store(true, Ordering::SeqCst);
    }
}

// The files and the connect rule are src/client.rs Store, tested there
// (the_session_is_kept_across_restarts).
