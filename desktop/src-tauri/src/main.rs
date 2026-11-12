// Topo as a desktop app: the website's own files (staged by desktop/stage.sh
// into desktop/dist) in the system webview, with nothing added to the page.
// The window opens on intro.html (desktop/intro.html, staged with
// --desktop), a short animation that hands over to index.html.
// What the app does here is what a browser does for the website and a bare
// webview does not: links that leave the app open in the default browser,
// downloads land in the Downloads folder, and on macOS a report prints from
// the default browser (see host_print).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// "This PC as the server" (D113, D125): the bundled topo-server, off by
// default; as a service that starts with the computer, or only while the
// app is open.
mod server;
// "Connect to a Topo server" (D144): the window as a client of a server,
// with every request and the event stream going through Rust.
mod client;
mod clientcmd;
// "Add this computer" (D166, step 7d): this PC's own interfaces, gateways
// and DNS servers, read and never sent anywhere.
mod thiscomputer;
// "Monitor from this PC" (D131, step 7f): the answer checks, their schedule
// and states, and the statistics, on this PC with no server.
mod checks;
mod monitor;
mod monitorcmd;
mod visitcmd;
mod visitmon;
mod stats;
// Issues and the alarm (step 7g): outages become issue records, a person
// acts on them, and the alarm card opens on every monitor.
mod alarm;
mod issues;
// Monitors through the server (step 7h): the device key in the keychain,
// js/servercrypto.js in Rust, and the monitor's link to the site.
mod keystore;
mod monitorlink;
mod servercrypto;

// The download handler (and its helpers) is not built on Windows; see main.
#[cfg(not(target_os = "windows"))]
use std::path::{Path, PathBuf};

#[cfg(not(target_os = "windows"))]
use tauri::webview::DownloadEvent;
use tauri::webview::NewWindowResponse;
use tauri::Manager;
use tauri::window::Color;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

use tauri_plugin_opener::OpenerExt;

/// The page's own addresses: the bundled files (tauri:// on macOS and Linux,
/// http(s)://tauri.localhost on Windows), and the frames and files it makes
/// itself (blob:, data:, about:srcdoc).
fn stays_in_app(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "blob" | "data" | "about" => true,
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

/// An address the default browser (or mail app, or dialer) should have.
fn opens_outside(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto" | "tel")
}

fn open_outside(app: &AppHandle, url: &Url) {
    if let Err(e) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("topo: could not open {url}: {e}");
    }
}

/// A file name the page asked for, with no folder in it.
#[cfg(not(target_os = "windows"))]
fn clean_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':'))
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        "download".to_string()
    } else {
        cleaned
    }
}

/// `name` in `dir`, or `name (1)`, `name (2)`, ... when it is taken, as a
/// browser does.
#[cfg(not(target_os = "windows"))]
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let as_path = Path::new(name);
    let stem = as_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string());
    let ext = as_path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for n in 1..=9999 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    first
}

/// macOS cannot print the report's preview frame (WKWebView prints only the
/// main frame), so the report is written to a file and opened in the default
/// browser, where its own Print button works (a saved file has no CSP).
/// Everywhere else this answers false and the page prints its preview; the
/// page asks host_prints first, so it sends the report only to macOS.
#[tauri::command]
fn host_print(app: AppHandle, html: String, name: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let mut safe: String = name
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ' ' | '-'))
            .collect();
        safe = safe.trim().trim_start_matches('.').to_string();
        if safe.is_empty() {
            safe = "report".to_string();
        }
        if !safe.to_ascii_lowercase().ends_with(".html") {
            safe.push_str(".html");
        }
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("print");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(safe);
        std::fs::write(&path, html).map_err(|e| e.to_string())?;
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, html, name);
        Ok(false)
    }
}

/// Whether host_print prints (macOS only). The page asks once, so on Windows
/// and Linux a Print never sends the whole report across IPC.
#[tauri::command]
fn host_prints() -> bool {
    cfg!(target_os = "macos")
}

/// The app's one window, on `page` (intro.html at the start, index.html
/// when the tray's Open Topo brings it back).
fn main_window(app: &AppHandle, page: &str) -> tauri::Result<()> {
    let nav_handle = app.clone();
    let win_handle = app.clone();
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(page.into()))
        .title("Topo")
        // The intro's own near-black, so the window never flashes
        // white before the first paint.
        .background_color(Color(5, 5, 5, 255))
        .inner_size(1280.0, 800.0)
        .min_inner_size(360.0, 560.0)
        .center()
        // The page takes its own drops (the palette, files dropped on
        // the landing page); the native handler would swallow them.
        .disable_drag_drop_handler()
        // The same window: the app's own pages stay, a link to the
        // web (the brand, Legal) opens in the default browser.
        .on_navigation(move |url| {
            if stays_in_app(url) {
                return true;
            }
            if opens_outside(url) {
                open_outside(&nav_handle, url);
            }
            false
        })
        // target="_blank" (GitHub, Issues, the licence, Netplan) opens
        // in the default browser; window.open(blob:) of Print labels
        // gets null back and the page saves the labels as a file.
        .on_new_window(move |url, _features| {
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                open_outside(&win_handle, &url);
            }
            NewWindowResponse::Deny
        });
    // macOS and Linux: a bare webview has no download list, so a file
    // the page saves goes to Downloads under its own name (name (1)
    // when taken), as a browser would. Windows gets no handler at
    // all: WebView2 then saves to Downloads itself and shows its own
    // downloads flyout, which a handler would hide (wry marks the
    // download handled).
    #[cfg(not(target_os = "windows"))]
    let builder = builder.on_download(|webview, event| match event {
        DownloadEvent::Requested { destination, .. } => {
            let asked = destination
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let name = clean_file_name(&asked);
            if let Ok(dir) = webview.path().download_dir() {
                *destination = unique_path(&dir, &name);
            }
            true
        }
        DownloadEvent::Finished { success, url, .. } => {
            if !success {
                eprintln!("topo: a download did not finish: {url}");
            }
            true
        }
        _ => true,
    });
    builder.build()?;
    Ok(())
}

/// The tray's Open Topo: the window shown and focused, made again when it
/// was closed.
pub fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if let Err(e) = main_window(app, "index.html") {
        eprintln!("topo: could not open the window: {e}");
    }
}

fn main() {
    // WebKitGTK's DMA-BUF renderer draws a blank window on NVIDIA's driver
    // and inside many AppImage setups. Only when nobody chose otherwise.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
            && (std::env::var_os("APPIMAGE").is_some()
                || Path::new("/proc/driver/nvidia").exists())
        {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    tauri::Builder::default()
        // Links are opened from the handlers below, so the plugin's own
        // click listener (which goes through IPC) stays off.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(server::ServerState::default())
        .manage(clientcmd::ClientState::default())
        .manage(monitorcmd::MonitorState::default())
        .manage(visitcmd::VisitState::default())
        // A page that reloads or leaves drops its event streams with it.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                if let Some(st) = webview.try_state::<clientcmd::ClientState>() {
                    st.close_all();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            host_prints,
            host_print,
            server::server_info,
            server::server_save,
            server::server_start,
            server::server_stop,
            server::server_open,
            server::server_service_install,
            server::server_service_remove,
            server::server_question,
            server::server_question_done,
            server::server_signin_code,
            clientcmd::client_info,
            clientcmd::client_probe,
            clientcmd::client_connect,
            clientcmd::client_disconnect,
            clientcmd::client_request,
            clientcmd::client_events,
            clientcmd::client_events_close,
            thiscomputer::this_computer,
            monitorcmd::monitor_info,
            monitorcmd::monitor_set,
            monitorcmd::monitor_plan,
            monitorcmd::monitor_status,
            monitorcmd::monitor_history,
            monitorcmd::monitor_quiet,
            monitorcmd::monitor_older,
            monitorcmd::monitor_issues,
            monitorcmd::monitor_issue_act,
            monitorcmd::monitor_issues_folded,
            monitorcmd::alarm_current,
            monitorcmd::alarm_answer,
            monitorcmd::alarm_hand,
            monitorcmd::alarm_take,
            monitorcmd::alarm_test,
            monitorcmd::monitor_device_key,
            monitorcmd::monitor_enroll,
            monitorcmd::monitor_link_info,
            monitorcmd::monitor_unenroll,
            monitorcmd::alarm_notify,
            monitorcmd::monitor_figures,
            visitcmd::visit_monitor_start,
            visitcmd::visit_monitor_plan,
            visitcmd::visit_monitor_info,
            visitcmd::visit_monitor_figures,
            visitcmd::visit_monitor_stop,
            visitcmd::visit_monitor_end
        ])
        .setup(|app| {
            // Off the main thread: starting waits a moment for a refusal.
            let server_handle = app.handle().clone();
            std::thread::spawn(move || server::autostart(&server_handle));
            // Open Topo at sign-in starts it with --background: the monitor
            // and the tray, no window until the tray's Open Topo.
            if !monitorcmd::on_start(app.handle()) {
                main_window(app.handle(), "intro.html")?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Topo")
        // A server the app started itself stops with it (a service does not).
        .run(|handle, event| match event {
            // The window closed while this PC monitors with its tray icon:
            // the app stays (the tray's Quit Topo ends it).
            RunEvent::ExitRequested { code: None, api, .. } if monitorcmd::keeps_running(handle) => api.prevent_exit(),
            RunEvent::Exit => server::on_exit(handle),
            _ => {}
        });
}
