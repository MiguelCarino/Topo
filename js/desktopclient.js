// ---- Connect to a Topo server (docs/SCOPE.md D144, step 7c) ----
// The desktop app's window as a client of a Topo server: a separate install
// or this PC's own built-in server (js/desktopserver.js). The page's server
// code (js/server.js, js/serversync.js, js/serverui.js) runs unchanged: this
// file gives it, through TopoServer._hooks, a fetch and an EventSource that
// call the app's commands (desktop/src-tauri/src/clientcmd.rs):
//
//   client_info          the server this window is connected to, if any
//   client_probe         is a Topo server at this address? (and the
//                        fingerprint of a certificate it signs itself)
//   client_connect       connect, pinning the fingerprint the person compared
//   client_disconnect    forget the server and the session
//   client_request       { method, path, body } -> { status, contentType,
//                        body, b64 }: the fetch
//   client_events        { path, onEvent: Channel } -> id: the EventSource
//   client_events_close  { id }
//
// So the webview never fetches the server (its CSP stays connect-src
// 'self'), the session cookie stays in the app, and only the connected
// server's /api/ can be reached. A server that signs its own certificate
// (TOPO_TLS_SELF, D113) is compared once by fingerprint and pinned; a
// different certificate later is refused, and said so here.
//
// The website and the offline zip have no window.__TAURI__: the section
// stays hidden and nothing here runs (D66 is unchanged for them).
//
// The address is also kept in this window's localStorage (MIRROR_KEY), so
// the hooks are in place before the boot (js/app.js) opens the server
// client; the app's own answer (client_info) is checked right after, and a
// difference reloads once. Connecting and disconnecting reload the page, so
// it always boots as what it now is.
// Load order: ... -> serverui -> backupfile -> desktopclient -> ... -> app -> settings

(function () {
'use strict';

const MIRROR_KEY = 'topo-desktop-client';
const RELOADED_KEY = 'topo-desktop-client-reloaded';
const _dc = {
    // Tests swap these in: (cmd, args) => Promise, the Channel class, reload.
    invoke: null, Channel: null, reload: null,
    info: null,           // { url, pin } from the app
    url: '',              // the server the hooks point at ('' when none)
    changed: '',          // a refused certificate's fingerprint
    changedKind: '',      // 'pin-changed' (not the pinned one) or 'untrusted'
                          // (no pin, and nobody vouches for it any more)
    told: false,          // the changed certificate was said once
    probe: null,          // { url, fingerprint } waiting for the person to compare
    note: '', noteErr: false, busy: false, retry: 0, retryMs: 5000,
};

function dcInvoke(cmd, args) {
    if (_dc.invoke) return _dc.invoke(cmd, args || {});
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
const dcHasHost = () => !!_dc.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
const ChannelClass = () => _dc.Channel || (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.Channel) || null;
const T = () => window.TopoServer || null;
const el = (id) => document.getElementById(id);
const errCode = (e) => String(e && e.message ? e.message : e || '');
function reload() { if (_dc.reload) _dc.reload(); else location.reload(); }

const mirror = () => { try { const v = JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null'); return v && typeof v.url === 'string' ? v.url : ''; } catch (e) { return ''; } };
function setMirror(url) {
    try { if (url) localStorage.setItem(MIRROR_KEY, JSON.stringify({ url })); else localStorage.removeItem(MIRROR_KEY); } catch (e) { /* the app's answer decides at the next start */ }
}

// The codes the app answers with, as sentences.
function dcErrText(code) {
    const c = errCode(code);
    if (c === 'address') return t('That is not a server address. Type it as the server shows it, for example https://192.168.1.20:7380.');
    if (c === 'needs-https') return t('Another PC\'s server needs https: sign-in would cross the network in clear. Type its https address.');
    if (c === 'offline' || c === 'not-connected') return t('No Topo server answered at that address. Check the address and that the server is running.');
    if (c === 'not-topo') return t('Something answered at that address, but it is not a Topo server.');
    if (c === 'fingerprint') return t('That fingerprint is not complete.');
    if (c.startsWith('pin-changed')) return t('The server\'s certificate changed since this window connected, so Topo refused it: it may not be your server. If the server made a new certificate, check it again and compare the new fingerprint.');
    if (c === 'untrusted-now') return t('The server\'s certificate cannot be checked any more, so Topo refused it: it may not be your server. Check the certificate again and compare its fingerprint with the one the server shows, or disconnect.');
    if (c.startsWith('untrusted')) return t('Compare the certificate first.');
    return t('Something went wrong: {why}', { why: c });
}

// ---- The transport js/server.js runs on ----
const b64Bytes = (s) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
// A refused certificate: kept, said once (a toast), and shown in Settings,
// which offers to check it again. Either kind: a pinned server showing
// another certificate ('pin-changed'), or a server with no pin whose
// certificate nobody vouches for any more ('untrusted': expired, a proxy's
// own, or someone in the way). Neither is retried: the person decides.
function certRefused(code) {
    const kind = code.slice(0, code.indexOf(':'));
    _dc.changed = code.slice(code.indexOf(':') + 1);
    _dc.changedKind = kind;
    clearTimeout(_dc.retry);
    if (!_dc.told) {
        _dc.told = true;
        if (typeof showToast === 'function') {
            showToast(kind === 'untrusted' ? t('The server\'s certificate could not be checked, so Topo did not connect to it. Open Settings, Connect to a Topo server.')
                : t('The server\'s certificate changed, so Topo did not connect to it. Open Settings, Connect to a Topo server.'), 'err');
        }
    }
    renderDesktopClientSettings();
}
// fetch(path, init) -> a Response, as js/server.js api() and js/serverui.js
// rawGet use it. No answer at all is a TypeError, as fetch's own.
async function hostFetch(path, init) {
    const i = init || {};
    let r;
    try {
        r = await dcInvoke('client_request', { method: String(i.method || 'GET').toUpperCase(), path: String(path), body: typeof i.body === 'string' ? i.body : null });
    } catch (e) {
        const c = errCode(e);
        if (c.startsWith('pin-changed:') || c.startsWith('untrusted:')) certRefused(c);
        throw new TypeError('offline');
    }
    if (_dc.changed) { _dc.changed = ''; _dc.changedKind = ''; _dc.told = false; renderDesktopClientSettings(); }
    const status = r && r.status >= 200 && r.status <= 599 ? r.status : 502;
    const empty = status === 204 || status === 205 || status === 304;
    const body = empty ? null : (r.b64 ? b64Bytes(r.body || '') : (r.body || ''));
    return new Response(body, { status, headers: { 'Content-Type': r.contentType || 'application/json' } });
}

// An EventSource on the app's stream: what js/server.js openStream uses
// (addEventListener per event, onopen, onerror, readyState, close). The
// app reconnects a dropped stream by itself (readyState 0 meanwhile), and
// a refused one is closed for good (2), as a browser's is.
class HostEventSource {
    constructor(path) {
        this.url = String(path);
        this.readyState = 0;
        this.onopen = null; this.onerror = null; this.onmessage = null;
        this._l = new Map();
        this._closed = false;
        const Ch = ChannelClass();
        if (!Ch) { this._id = Promise.resolve(null); setTimeout(() => this._fail(), 0); return; }
        const ch = new Ch();
        ch.onmessage = (m) => this._msg(m);
        this._id = dcInvoke('client_events', { path: this.url, onEvent: ch }).catch(() => { this._fail(); return null; });
    }
    addEventListener(name, fn) { if (!this._l.has(name)) this._l.set(name, new Set()); this._l.get(name).add(fn); }
    removeEventListener(name, fn) { const s = this._l.get(name); if (s) s.delete(fn); }
    close() {
        if (this._closed) return;
        this._closed = true;
        this.readyState = 2;
        this._id.then((id) => { if (id != null) dcInvoke('client_events_close', { id }).catch(() => {}); });
    }
    _fail() { if (this._closed) return; this._closed = true; this.readyState = 2; if (this.onerror) this.onerror({ type: 'error' }); }
    _msg(m) {
        if (this._closed || !m) return;
        if (m.kind === 'open') { this.readyState = 1; if (this.onopen) this.onopen({ type: 'open' }); return; }
        if (m.kind === 'event') {
            const ev = { type: m.event, data: m.data };
            (this._l.get(m.event) || []).forEach((fn) => { try { fn(ev); } catch (e) { console.warn('Topo: event', m.event, e); } });
            if (m.event === 'message' && this.onmessage) this.onmessage(ev);
            return;
        }
        if (m.kind === 'error') {
            if (m.closed) { this._closed = true; this.readyState = 2; } else this.readyState = 0;
            if (this.onerror) this.onerror({ type: 'error' });
        }
    }
}

// Points js/server.js at the server, before the boot opens it.
function attach(url) {
    const S = T();
    if (!S || !url) return false;
    _dc.url = url;
    // desktop: js/serverui.js words what only a browser can do (the email's
    // link, a backup provider's sign-in) for this window.
    Object.assign(S._hooks, { force: true, desktop: true, origin: url, fetch: hostFetch, EventSource: HostEventSource });
    return true;
}

// A server that does not answer yet (its PC is starting, the network is
// down): try again, a little less often each time, at most once a minute.
function retryLater() {
    clearTimeout(_dc.retry);
    if (_dc.changed) return;
    _dc.retry = setTimeout(async () => {
        const S = T();
        if (!S || !_dc.url || S.state.status !== 'unreachable') return;
        S.state.opening = null;
        _dc.retryMs = Math.min(_dc.retryMs * 2, 60000);
        const opened = await S.openServerClient();
        renderDesktopClientSettings();
        if (!opened && S.state.status === 'unreachable') retryLater();
    }, _dc.retryMs);
}
// At start: the mirror now (the boot opens the client with it), the app's
// own answer just after. A difference (connected or disconnected by another
// window, storage cleared) is put right with one reload.
async function boot() {
    if (!dcHasHost()) return;
    follow();
    const was = mirror();
    if (was) attach(was);
    let info = null;
    try { info = await dcInvoke('client_info'); } catch (e) { info = null; }
    // An app without these commands (an older build): nothing changes.
    if (!info || typeof info.url !== 'string') { if (was) { setMirror(''); detach(); } return; }
    _dc.info = info;
    if (info.url !== was) {
        setMirror(info.url);
        let again = false;
        try { again = sessionStorage.getItem(RELOADED_KEY) === info.url; sessionStorage.setItem(RELOADED_KEY, info.url); } catch (e) { again = true; }
        if (!again) { reload(); return; }
        // Reloaded once already: open it now rather than loop.
        if (info.url) { attach(info.url); if (typeof openServerClient === 'function') openServerClient(); } else detach();
    } else {
        try { sessionStorage.removeItem(RELOADED_KEY); } catch (e) { /* fine */ }
    }
    if (_dc.url) window.addEventListener('online', () => { if (T() && T().state.status === 'unreachable') { _dc.retryMs = 2500; retryLater(); } });
    renderDesktopClientSettings();
    if (_dc.url && T() && T().state.status === 'unreachable') retryLater();
}
function detach() {
    const S = T();
    _dc.url = '';
    if (S) Object.assign(S._hooks, { force: false, desktop: false, origin: null, fetch: null, EventSource: null });
}

// ---- Settings: Connect to a Topo server ----
function setNote(text, isErr) { _dc.note = text || ''; _dc.noteErr = !!isErr; renderDesktopClientSettings(); }

function renderDesktopClientSettings() {
    const sec = el('setDcSec');
    if (!sec) return;
    sec.hidden = !dcHasHost() || !_dc.info;
    if (sec.hidden) return;
    const url = _dc.info.url || '';
    const S = T();
    const st = S && url ? S.state.status : 'off';
    el('setDcForm').hidden = !!url || !!_dc.probe;
    el('setDcCompare').hidden = !_dc.probe;
    el('setDcOn').hidden = !url || !!_dc.probe;
    if (_dc.probe) el('setDcFp').textContent = _dc.probe.fingerprint;
    el('setDcAddr').textContent = url;
    el('setDcPinRow').hidden = !_dc.info.pin;
    el('setDcPin').textContent = _dc.info.pin || '';
    const status = el('setDcStatus');
    let line, isErr = false;
    if (_dc.note) { line = _dc.note; isErr = _dc.noteErr; }
    else if (!url) line = t('Not connected: the networks in this window stay on this PC.');
    else if (_dc.changed) { line = dcErrText(_dc.changedKind === 'untrusted' ? 'untrusted-now' : 'pin-changed'); isErr = true; }
    else if (st === 'checking' || st === 'off') line = t('Connecting…');
    else if (st === 'unreachable') { line = t('The server does not answer right now. Topo keeps trying.'); isErr = true; }
    else if (st === 'signed-out') line = t('Connected. Sign in to see the networks kept on this server.');
    else if (st === 'needs-keys' || st === 'locked') line = t('Connected and signed in. Finish setting up this PC on the start page.');
    else if (st === 'ready') line = t('Connected and signed in as {email}.', { email: (S.me() || {}).email || '' });
    else line = t('Connected.');
    status.textContent = line;
    status.classList.toggle('ds-err', isErr);
    el('setDcSignIn').hidden = !(url && st === 'signed-out' && !_dc.changed);
    el('setDcAgain').hidden = !(url && _dc.changed);
    el('setDcConnect').disabled = _dc.busy;
    el('setDcTrust').disabled = _dc.busy;
}

// Connect: the app asks the address first. A certificate it cannot check
// is shown to compare; anything else connects at once.
async function dcConnect(typed) {
    const url = String(typed != null ? typed : el('setDcUrl').value).trim();
    if (_dc.busy) return false;
    if (!url) { setNote(dcErrText('address'), true); return false; }
    _dc.busy = true;
    setNote(t('Looking for the server…'));
    try {
        const p = await dcInvoke('client_probe', { url, pin: null });
        if (p.error === 'untrusted') {
            _dc.probe = { url: p.url, fingerprint: p.fingerprint };
            _dc.busy = false;
            setNote('');
            const b = el('setDcTrust');
            if (b) b.focus({ preventScroll: true });
            return false;
        }
        if (p.error) { setNote(dcErrText(p.error), true); return false; }
        return await finishConnect(p.url, '');
    } catch (e) {
        setNote(dcErrText(e), true);
        return false;
    } finally { _dc.busy = false; renderDesktopClientSettings(); }
}
async function dcTrust() {
    const p = _dc.probe;
    if (!p || _dc.busy) return false;
    _dc.busy = true;
    try { return await finishConnect(p.url, p.fingerprint); }
    catch (e) { setNote(dcErrText(e), true); return false; }
    finally { _dc.busy = false; renderDesktopClientSettings(); }
}
function dcCancel() { _dc.probe = null; setNote(''); }
async function finishConnect(url, pin) {
    const info = await dcInvoke('client_connect', { url, pin: pin || null });
    _dc.info = info; _dc.probe = null; _dc.changed = ''; _dc.changedKind = '';
    setMirror(info.url);
    setNote(t('Connected. Opening…'));
    reload();
    return true;
}
const ownUrl = (port, lan) => (lan ? 'https' : 'http') + '://127.0.0.1:' + port;
// This PC's own server (js/desktopserver.js): at 127.0.0.1, its certificate
// read from the server's own files, so there is nothing to compare.
async function dcConnectOwn(port, lan, fingerprint) {
    const url = ownUrl(port, lan);
    if (_dc.busy) return false;
    _dc.busy = true;
    try { return await finishConnect(url, lan ? fingerprint : ''); }
    finally { _dc.busy = false; }
}
const connectedTo = () => (_dc.info && _dc.info.url) || '';

// The certificate changed: compare the new one (same address; the
// session stays if it is the same server).
function dcCheckAgain() { return dcConnect(connectedTo()); }

async function dcDisconnect() {
    const url = connectedTo();
    if (!url) return;
    const yes = await askConfirm(t('Disconnect this window from {server}? You are signed out here. The networks stay on the server, and the ones in this window stay on this PC.', { server: url }),
        { ok: t('Disconnect'), danger: true });
    if (!yes) return;
    const S = T();
    if (S && S.me()) { try { await S.signOut(); } catch (e) { /* forgotten here anyway */ } }
    try { await dcInvoke('client_disconnect'); } catch (e) { setNote(dcErrText(e), true); return; }
    setMirror('');
    _dc.info = { url: '', pin: '' };
    reload();
}

// The lock forgot the network (js/idlelock.js D346): the app's session and
// server go, with nothing asked and no reload (the unlock's boot follows).
async function dcForget() {
    if (!connectedTo()) return;
    try { await dcInvoke('client_disconnect'); } catch (e) { /* forgotten in the page anyway */ }
    setMirror('');
    _dc.info = { url: '', pin: '' };
}

(function wire() {
    if (!el('setDcSec')) return;
    el('setDcConnect').addEventListener('click', () => { dcConnect(); });
    el('setDcUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dcConnect(); } });
    el('setDcTrust').addEventListener('click', () => { dcTrust(); });
    el('setDcCancel').addEventListener('click', dcCancel);
    el('setDcDisconnect').addEventListener('click', () => { dcDisconnect(); });
    el('setDcAgain').addEventListener('click', () => { dcCheckAgain(); });
    el('setDcSignIn').addEventListener('click', () => {
        if (typeof closeSettings === 'function') closeSettings();
        if (window.TopoServerUI) TopoServerUI.openSignIn();
    });
})();

// Follow the server's state (from boot()): one that does not answer is
// tried again, and answering again starts the next outage's wait from 5 s.
function follow() {
    const S = T();
    if (!S) return;
    try { if (_dc.unfollow) _dc.unfollow(); } catch (e) { /* the listeners were reset */ }
    _dc.unfollow = S.on('changed', () => {
        renderDesktopClientSettings();
        const st = S.state.status;
        if (st !== 'unreachable' && st !== 'checking' && st !== 'off') _dc.retryMs = 5000;
        if (_dc.url && st === 'unreachable') retryLater();
    });
}

window.renderDesktopClientSettings = renderDesktopClientSettings;
window.CarinoDesktopClient = { state: _dc, boot, attach, detach, hostFetch, HostEventSource, dcErrText, dcConnect, dcTrust, dcCancel, dcDisconnect, dcForget, dcConnectOwn, dcCheckAgain, ownUrl, connectedTo, MIRROR_KEY };

// The mirror is read now, before js/app.js's boot opens the server client.
if (dcHasHost()) boot();
})();
