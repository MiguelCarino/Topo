// ---- Connections: watched PCs and the server not answering (docs/SCOPE.md
// D376-D379, step 8f) ----
// On a Topo server, a desktop app can be marked **Watch this PC's
// connection** (Settings, Monitoring, under the site's monitor): its app
// sends the server a heartbeat every 60 s (desktop/src-tauri/src/
// connwatch.rs), with the window closed too. A browser tab never is.
//
//   lost       three beats missed: the server tells everyone who shares a
//              site with that PC (the event "connection" {lost}); every
//              signed-in page with a site open shows "{PC} lost its
//              connection to the server at 10:42" in the banner, and an app
//              with Show alarms on sends a notification (never the card: a
//              PC going home is not a device down). Back: "{PC} connected
//              again at 11:05 (23 min)", once. A PC that quit or signed out
//              said so first and is not lost.
//   silent     the other side: this app could not reach the server for 3
//              minutes ("topo-server-silent" from the app): "The Topo server
//              is not answering since 10:42" in this window's banner; when
//              it answers, "The Topo server is answering again" once, and
//              the gap is recorded on the server by this PC.
//   the report the Connections section of the monitoring report (site
//              scope on a server, js/reports.js): per watched PC and site
//              monitor, the time connected over the time watched, and each
//              gap with who saw it.
// Load order: ... -> monitors -> connections -> reports -> app

(function () {
'use strict';
const T = () => window.TopoServer;
const M = () => window.TopoMonitors;
const el = (id) => document.getElementById(id);
const _cn = {
    invoke: null,         // tests: stands in for window.__TAURI__.core.invoke
    lost: new Map(),      // device id -> { name, at }
    told: new Set(),      // what was notified already
    silentSince: 0,       // this app: the server not answering since (0: it answers)
    info: null,           // connection_watch_info's answer
    listening: false
};
function cnInvoke(cmd, args) {
    if (_cn.invoke) return Promise.resolve().then(() => _cn.invoke(cmd, args || {}));
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
const hasHost = () => !!_cn.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
const serverOn = () => !!(T() && T().ready && T().ready());
const clock = (at) => { try { return new Date(at).toLocaleTimeString((window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined), { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
const minutes = (ms) => Math.max(1, Math.round(ms / 60000));

// ---- The banner's lines (js/monitors.js renderBanner) ----
function bannerLines() {
    const out = [];
    if (_cn.silentSince) out.push({ text: t('The Topo server is not answering since {time}', { time: clock(_cn.silentSince) }), cls: 'srv-ib-down' });
    [..._cn.lost.values()].sort((a, b) => a.at - b.at)
        .forEach((x) => out.push({ text: t('{pc} lost its connection to the server at {time}', { pc: x.name, time: clock(x.at) }), cls: 'srv-ib-stale' }));
    return out;
}
function redraw() { if (M() && typeof M().renderBanner === 'function') M().renderBanner(); }
function notify(text) {
    const info = window.TopoChecks && TopoChecks.state.info;
    if (hasHost() && info && info.alarms) cnInvoke('alarm_notify', { text }).catch(() => {});
}

// ---- The server's events ----
function onConnection(d) {
    if (!d || !d.device) return;
    if (d.lost) {
        _cn.lost.set(d.device, { name: d.name || d.device, at: d.at || Date.now() });
        const key = 'lost|' + d.device + '|' + (d.at || 0);
        if (!_cn.told.has(key)) { _cn.told.add(key); notify(t('{pc} lost its connection to the server at {time}', { pc: d.name || d.device, time: clock(d.at || Date.now()) })); }
    } else if (d.back) {
        const was = _cn.lost.has(d.device);
        _cn.lost.delete(d.device);
        if (was || d.from) {
            showToast(t('{pc} connected again at {time} ({n} min)', { pc: d.name || d.device, time: clock(d.to || Date.now()), n: minutes((d.to || Date.now()) - (d.from || Date.now())) }), 'ok');
        }
    }
    redraw();
}
// What the server says now: the site's watched PCs that are lost.
async function loadSite(siteId) {
    if (!siteId || !serverOn()) return null;
    let got = null;
    try { got = await T().api('GET', `/api/sites/${siteId}/connections`); } catch (e) { return null; }
    (got && Array.isArray(got.clients) ? got.clients : []).forEach((c) => {
        if (c.kind !== 'pc') return;
        if (c.lost && !c.away) _cn.lost.set(c.id, { name: c.name || c.id, at: c.lastBeat || Date.now() });
        else _cn.lost.delete(c.id);
    });
    redraw();
    return got;
}
// The period's list for the report (js/reports.js gather): null when none.
async function siteConnections(siteId, from, to) {
    if (!siteId || !serverOn()) return null;
    const got = await T().api('GET', `/api/sites/${siteId}/connections?from=${Math.floor(from)}&to=${Math.floor(to)}`);
    return got && Array.isArray(got.clients) ? got.clients : null;
}

// ---- This app: the server not answering (D378) ----
function onSilent(since) {
    _cn.silentSince = since || Date.now();
    redraw();
}
function onBack(from, to) {
    const was = _cn.silentSince;
    _cn.silentSince = 0;
    if (was || from) showToast(t('The Topo server is answering again (not answering for {n} min).', { n: minutes((to || Date.now()) - (from || was || Date.now())) }), 'ok');
    redraw();
}

// ---- Settings: Watch this PC's connection ----
// The words the app says with no page open ({min}: minutes).
const appWords = () => ({ silent: t('The Topo server has not answered this PC for {min} min.'), back: t('The Topo server is answering again (not answering for {min} min).') });
async function refreshInfo() {
    if (!hasHost()) return null;
    try { _cn.info = await cnInvoke('connection_watch_info'); } catch (e) { _cn.info = null; }
    if (_cn.info && _cn.info.silentSince && !_cn.silentSince) _cn.silentSince = _cn.info.silentSince;
    return _cn.info;
}
function renderSettings() {
    const box = el('setConnWatch');
    if (!box) return;
    const show = hasHost() && serverOn();
    box.hidden = !show;
    if (!show) return;
    const on = !!(_cn.info && _cn.info.on);
    el('setConnWatchOn').checked = on;
    el('setConnWatchStatus').textContent = on
        ? t('Watched as "{name}". The people who share a site with you are told if it loses its connection; quitting or signing out is not losing it.', { name: _cn.info.name || '' })
        : t('Off. Turn it on for a PC that should always be connected (a reception desk, a modality\'s workstation). A browser tab is never watched.');
}
async function pcName() {
    try { const me = await cnInvoke('this_computer'); if (me && me.hostname) return me.hostname; } catch (e) { /* none */ }
    return (window.TopoChecks && TopoChecks.state.info && TopoChecks.state.info.monitorName) || t('This PC');
}
async function setWatch(on) {
    if (!hasHost()) return null;
    const args = Object.assign({ on, name: on ? await pcName() : '' }, appWords());
    try { _cn.info = await cnInvoke('connection_watch_set', { args }); }
    catch (e) { showToast(t('This PC\'s connection could not be watched: {error}', { error: String(e && e.message || e) }), 'err'); }
    renderSettings();
    return _cn.info;
}

// ---- Wiring ----
function listen() {
    if (_cn.listening) return;
    if (T() && T().on) { _cn.listening = true; T().on('event:connection', onConnection); }
    const ev = window.__TAURI__ && window.__TAURI__.event;
    if (ev && typeof ev.listen === 'function') {
        ev.listen('topo-server-silent', (e) => onSilent(e && e.payload && e.payload.since));
        ev.listen('topo-server-back', (e) => onBack(e && e.payload && e.payload.from, e && e.payload && e.payload.to));
    }
}
(function wire() {
    document.addEventListener('change', (e) => { if (e.target && e.target.id === 'setConnWatchOn') setWatch(e.target.checked); });
    if (hasHost()) refreshInfo().then(renderSettings);
    setTimeout(listen, 0);
})();

window.TopoConnections = {
    state: _cn, bannerLines, onConnection, onSilent, onBack, loadSite, siteConnections, refreshInfo, renderSettings, setWatch, listen, appWords
};
})();
