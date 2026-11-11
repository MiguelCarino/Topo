// ---- A Topo server: detection, transport, account, keys (docs/SCOPE.md step 5a) ----
// The same app, served by a Topo server (server/, docs/SERVER.md), keeps
// networks on that server as well as in this browser: signed in by email,
// encrypted end to end (js/servercrypto.js), kept in step by
// js/serversync.js, shown by js/serverui.js.
//
// Inert anywhere else (decision D66). The server marks the page it serves
// with <meta name="topo-server" content="1">; without it nothing in these
// files makes a request, adds a listener or shows anything, and the
// '#signin=' and '#invite=' fragments mean what they always meant (E1).
//
// What this file holds: the transport (same origin, a custom header for
// CSRF, JSON errors as ServerError), the session and the account (/api/me),
// the sign-in steps, this browser's keys (set up, linked from another
// browser, recovered with the recovery key, reset), and the live events
// (one tab per browser holds the stream and relays it, amendment C8).
//
// Tests replace the network and the clock through TopoServer._hooks.

(function () {
'use strict';

const C = window.TopoServerCrypto;
const _hooks = { force: false, fetch: null, EventSource: null, BroadcastChannel: undefined, locks: undefined, now: () => Date.now(), origin: null, navigate: null };
const S = {
    on: false,          // a Topo server served this page (or a test said so)
    status: 'off',      // off | checking | insecure | unreachable | signed-out | needs-keys | locked | ready
    health: null, me: null, keys: null,
    sites: [], invites: [], arrival: null, link: null,
    es: null, bc: null, leader: false, release: null, evStarted: false,
    listeners: new Map(), opening: null
};
const origin = () => _hooks.origin || location.origin;
const recKey = (userId) => origin() + '|' + userId;

// ---- Detection ----
const serverMarked = () => _hooks.force || !!document.querySelector('meta[name="topo-server"]');

// ---- Transport ----
class ServerError extends Error {
    constructor(status, code, data) { super(code); this.status = status; this.code = code; this.data = data || {}; this.offline = status === 0; }
}
async function api(method, path, body) {
    const f = _hooks.fetch || window.fetch.bind(window);
    const init = { method, credentials: 'same-origin', headers: { 'X-Topo': '1' } };
    if (method !== 'GET') {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body === undefined ? {} : body);
    }
    let res;
    try { res = await f(path, init); }
    catch (e) { throw new ServerError(0, 'offline'); }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new ServerError(res.status, (data && data.error) || 'error', data);
    return data;
}

// ---- Events (in this tab) ----
function on(name, fn) {
    if (!S.listeners.has(name)) S.listeners.set(name, new Set());
    S.listeners.get(name).add(fn);
    return () => S.listeners.get(name).delete(fn);
}
function emit(name, data) {
    (S.listeners.get(name) || []).forEach((fn) => { try { fn(data); } catch (e) { console.warn('Topo server: listener', name, e); } });
    (S.listeners.get('*') || []).forEach((fn) => { try { fn(name, data); } catch (e) { /* a view */ } });
}
const ui = () => window.TopoServerUI || null;
const sync = () => window.TopoServerSync || null;
function changed() { emit('changed'); if (ui()) ui().render(); }
function setStatus(st) { if (S.status !== st) { S.status = st; changed(); } }

// ---- Boot ----
// Called by the boot (js/app.js) without waiting. Nothing at all without the marker.
function openServerClient() {
    if (!serverMarked()) return Promise.resolve(false);
    if (S.opening) return S.opening;
    S.opening = (async () => {
        S.on = true;
        setStatus('checking');
        try { S.health = await api('GET', '/api/health'); }
        catch (e) { S.health = null; }
        if (!S.health || S.health.server !== 'topo') { setStatus('unreachable'); return false; }
        if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) { setStatus('insecure'); return false; }
        await C.openKeyStore();
        if (sync()) await sync().open();
        if (S.health.signedIn !== false) await refreshMe();
        if (S.me) await afterSignIn(false);
        else setStatus('signed-out');
        takeArrival();
        listenToPage();
        return true;
    })();
    return S.opening;
}

// Arrived with a link: the sign-in link or an invitation (taken off the URL by load()).
function takeArrival() {
    const a = S.arrival;
    S.arrival = null;
    if (!a || !ui()) return;
    if (a.kind === 'signin') ui().linkArrived(a.token);
    else if (a.kind === 'invite') ui().inviteArrived(a.token);
    else if (a.kind === 'backup-connect') ui().backupConnectArrived(a.token);
}

// load() (js/app.js) hands the fragment over before anything else reads it.
// -> true when it was a server link (consumed: the caller cleans the URL);
// false without the marker, so a static page reads it exactly as before.
function serverHashToken(hash) {
    if (!serverMarked() || typeof hash !== 'string') return false;
    // '#backup-connect=': back from Google or Microsoft after Connect in
    // Account, Backups (D110); the sign-in answer, URL-encoded.
    const m = /^(signin|invite)=([A-Za-z0-9_.-]{8,200})$/.exec(hash) || /^(backup-connect)=([A-Za-z0-9_.%~+-]{1,9000})$/.exec(hash);
    if (!m) return false;
    S.arrival = { kind: m[1], token: m[2] };
    // Typed over a page already open: handled now, not at the next boot.
    if (S.opening && S.status !== 'checking') setTimeout(() => { if (S.status !== 'unreachable' && S.status !== 'insecure') takeArrival(); }, 0);
    return true;
}

// The page coming back, the network coming back: catch up.
let _pageWired = false;
function listenToPage() {
    if (_pageWired) return;
    _pageWired = true;
    window.addEventListener('online', () => { if (S.status === 'ready') { startEvents(); emit('online'); } });
    window.addEventListener('offline', () => emit('offline'));
    document.addEventListener('visibilitychange', () => { if (S.status === 'ready') emit(document.hidden ? 'hidden' : 'visible'); });
    window.addEventListener('pagehide', () => { if (S.status === 'ready') emit('hidden'); });
}

// ---- The account ----
async function refreshMe() {
    try { S.me = await api('GET', '/api/me'); }
    catch (e) {
        if (e.status === 401) { S.me = null; }
        else if (!e.offline) console.warn('Topo server: /api/me', e.code);
    }
    return S.me;
}
async function refreshSites() {
    if (!S.me) { S.sites = []; S.invites = []; return; }
    try {
        const r = await api('GET', '/api/sites');
        S.sites = Array.isArray(r.sites) ? r.sites : [];
        S.invites = Array.isArray(r.invites) ? r.invites : [];
    } catch (e) {
        if (e.status === 401) { await signedOutHere(); return; }
    }
    changed();
}
const site = (id) => S.sites.find((x) => x.id === id) || null;

async function afterSignIn(interactive) {
    const ready = await ensureKeys(interactive);
    await refreshSites();
    startEvents();
    if (ready && sync()) sync().syncAll();
    changed();
    return ready;
}
async function signedOutHere() {
    stopEvents();
    S.me = null; S.keys = null; S.sites = []; S.invites = [];
    if (sync()) sync().signedOut();
    setStatus('signed-out');
}

// ---- Sign-in (design §6, D54) ----
const PENDING_EMAIL_KEY = 'topo-server-signin';
const deviceLabel = () => {
    const ua = navigator.userAgent || '';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return [browser, os].filter(Boolean).join(' · ');
};
const lang = () => (window.CarinoI18N ? CarinoI18N.current() : 'en');
async function requestCode(email, opts = {}) {
    const body = { email: String(email || '').trim(), lang: lang() };
    if (opts.setupToken) body.setupToken = String(opts.setupToken).trim();
    if (opts.invite) body.invite = opts.invite;
    const r = await api('POST', '/api/auth/request', body);
    try { localStorage.setItem(PENDING_EMAIL_KEY, body.email.toLowerCase()); } catch (e) { /* the device is found another way */ }
    return r.challenge;
}
// The device this browser already holds for that address, so the new
// session is bound to it (a session can only be bound at sign-in).
async function knownDevice(email) {
    const e = String(email || '').toLowerCase();
    const all = (await C.ksAll('keys')).filter((r) => r && r.origin === origin() && r.deviceId);
    const hit = all.filter((r) => !e || r.email === e).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    return hit ? hit.deviceId : undefined;
}
const pendingEmail = () => { try { return localStorage.getItem(PENDING_EMAIL_KEY) || ''; } catch (e) { return ''; } };
async function verifyCode(challenge, code, email) {
    const r = await api('POST', '/api/auth/verify', { challenge, code: String(code || '').replace(/\D/g, ''), deviceId: await knownDevice(email || pendingEmail()) });
    return signedIn(r.user);
}
async function signInWithLink(token) {
    const r = await api('POST', '/api/auth/link', { token, deviceId: await knownDevice(pendingEmail()) });
    return signedIn(r.user);
}
async function signedIn(me) {
    try { localStorage.removeItem(PENDING_EMAIL_KEY); } catch (e) { /* fine */ }
    S.me = me;
    await afterSignIn(true);
    return S.me;
}
async function signOut() {
    try { await api('POST', '/api/auth/signout'); } catch (e) { /* signed out here anyway */ }
    await signedOutHere();
}

// ---- This browser's keys (design §9.1, D58, A2) ----
// The record kept for (server, person): the device key, the user keys,
// their public halves as this browser pinned them.
async function myRecord() { return S.me ? C.ksGet('keys', recKey(S.me.id)) : null; }
async function saveRecord(rec) { rec.at = _hooks.now(); await C.ksPut('keys', recKey(rec.userId), rec); return rec; }
const keysMatch = (rec, me) => !!(rec && rec.uEnc && rec.uSig && me && me.keys && rec.encPub === me.keys.encPub && rec.sigPub === me.keys.sigPub);

async function ensureDevice() {
    let rec = await myRecord();
    if (S.me.device && rec && rec.deviceId === S.me.device.id && rec.devPriv) return rec;
    // A new device for this browser: the session is bound to it.
    const dev = await C.newDevice();
    const r = await api('POST', '/api/devices', { devPub: dev.pub, label: deviceLabel() });
    rec = { origin: origin(), userId: S.me.id, email: String(S.me.email).toLowerCase(), deviceId: r.id, devPriv: dev.priv, devPub: dev.pub };
    await saveRecord(rec);
    await refreshMe();
    return rec;
}
// -> true when this browser can read and write: keys set up and unlocked here.
// interactive: right after signing in, a first setup asks its questions.
async function ensureKeys(interactive) {
    if (!S.me) return false;
    let rec = await myRecord();
    if (keysMatch(rec, S.me) && S.me.device && rec.deviceId === S.me.device.id) { S.keys = rec; setStatus('ready'); return true; }
    try { rec = await ensureDevice(); }
    catch (e) { console.warn('Topo server: device', e.code || e); setStatus('locked'); return false; }
    if (!S.me.keys) {
        if (!interactive || !ui()) { setStatus('needs-keys'); return false; }
        return setUpKeys(false);
    }
    if (keysMatch(rec, S.me)) { S.keys = rec; setStatus('ready'); return true; }
    // A linked device that lost its user keys: its own wrap brings them back.
    if (S.me.device && S.me.device.linked) {
        try { await adoptBundle(await ownBundle(rec, S.me.keys.sigPub), rec); return true; } catch (e) { /* locked: link or recover */ }
    }
    S.keys = null;
    setStatus('locked');
    return false;
}
// The user keys, from a bundle this browser just unwrapped or recovered:
// pinned only when their public halves are the ones the account has (A2).
async function adoptBundle(bundle, rec) {
    const k = await C.importBundle(bundle);
    if (!S.me.keys || k.encPub !== S.me.keys.encPub || k.sigPub !== S.me.keys.sigPub) { const e = new Error('untrusted-wrap'); e.code = 'untrusted-wrap'; throw e; }
    Object.assign(rec, { uEnc: k.enc, uSig: k.sig, encPub: k.encPub, sigPub: k.sigPub });
    await saveRecord(rec);
    S.keys = rec;
    await pinPerson(S.me.id, k.encPub, k.sigPub);
    setStatus('ready');
    if (sync()) sync().syncAll();
    return rec;
}
// This device's own copy of the bundle on the server, unwrapped (briefly:
// to link another device, make a new recovery key). signedBy: the U_sig
// the wrap must be signed with (this browser's pinned one when it has it).
async function ownBundle(rec = S.keys, signedBy = rec && rec.sigPub) {
    const r = await api('GET', `/api/devices/${rec.deviceId}/wrap`);
    return C.unwrap(r.wrap, { priv: rec.devPriv, pub: rec.devPub, ctx: C.deviceCtx(S.me.id, rec.deviceId), signers: [signedBy] });
}
// First setup, or a reset (D77): new user keys, wrapped to this device,
// escrowed under a new recovery key the person is shown once.
async function setUpKeys(reset) {
    const rec = await ensureDevice();
    const u = await C.newUser();
    const code = await C.newRecoveryCode();
    const required = S.me.serverRole === 'owner' || S.me.serverRole === 'staff';
    const answer = ui() ? await ui().showRecoveryCode(code.text, { required, email: S.me.email, first: !reset }) : 'ok';
    if (!answer) { setStatus(reset ? S.status : 'needs-keys'); return false; }
    const escrow = answer === 'skip' ? null : await C.sealEscrow(code.symbols, u.bundle, S.me.id);
    const deviceWrap = await C.wrap({ toPub: rec.devPub, ctx: C.deviceCtx(S.me.id, rec.deviceId), plaintext: u.bundle, by: S.me.id, sigPriv: u.sig });
    S.me = await api('PUT', '/api/me/keys', { encPub: u.encPub, sigPub: u.sigPub, deviceWrap, escrow, reset: !!reset });
    Object.assign(rec, { uEnc: u.enc, uSig: u.sig, encPub: u.encPub, sigPub: u.sigPub });
    await saveRecord(rec);
    S.keys = rec;
    await pinPerson(S.me.id, u.encPub, u.sigPub);
    setStatus('ready');
    if (reset && sync()) sync().keysReset();
    await refreshSites();
    if (sync()) sync().syncAll();
    return true;
}
const resetKeys = () => setUpKeys(true);

// A new browser asks one already open to let it in (design §9.1 3a, A2).
// -> { id, code, done }: show the code; done resolves when approved (true),
// denied or expired (false).
async function startLink() {
    const rec = await ensureDevice();
    const r = await api('POST', '/api/link-requests');
    const code = await C.linkCode(rec.devPub, S.me.keys.encPub, S.me.keys.sigPub);
    if (S.link && S.link.timer) clearInterval(S.link.timer);
    const link = S.link = { id: r.id, code, expires: r.expires, resolve: null, timer: 0 };
    link.done = new Promise((resolve) => { link.resolve = resolve; });
    // The live event says so; polling covers a stream that is not up yet.
    link.timer = setInterval(() => { if (S.link === link) finishLink(link, true); }, 4000);
    return link;
}
async function finishLink(link, polling) {
    if (S.link !== link || link.finishing) return;
    link.finishing = true;
    try {
        const rec = await myRecord();
        const r = await api('GET', `/api/devices/${rec.deviceId}/wrap`).catch((e) => { if (e.status === 404 && polling) return null; throw e; });
        if (!r) return;
        const bundle = await C.unwrap(r.wrap, { priv: rec.devPriv, pub: rec.devPub, ctx: C.deviceCtx(S.me.id, rec.deviceId), signers: [S.me.keys.sigPub] });
        await adoptBundle(bundle, rec);
        endLink(link, true);
    } catch (e) {
        if (e.code === 'untrusted-wrap') endLink(link, false);
    } finally { link.finishing = false; }
}
function endLink(link, ok) {
    clearInterval(link.timer);
    if (S.link === link) S.link = null;
    link.resolve(ok);
    changed();
}
function cancelLink() { if (S.link) endLink(S.link, false); }

// The other side: requests waiting for this browser to approve.
async function linkRequests() {
    if (S.status !== 'ready') return [];
    const r = await api('GET', '/api/link-requests');
    const out = [];
    for (const q of r.requests || []) out.push(Object.assign({}, q, { code: await C.linkCode(q.devPub, S.keys.encPub, S.keys.sigPub) }));
    return out;
}
async function approveLink(req) {
    const bundle = await ownBundle();
    const w = await C.wrap({ toPub: req.devPub, ctx: C.deviceCtx(S.me.id, req.deviceId), plaintext: bundle, by: S.me.id, sigPriv: S.keys.uSig });
    await api('POST', `/api/link-requests/${req.id}/approve`, { wrap: w });
    await refreshMe(); changed();
}
async function denyLink(req) { await api('POST', `/api/link-requests/${req.id}/deny`); await refreshMe(); changed(); }

// The recovery key typed in (design §5.4): the escrow opened, the keys
// checked against the account's, then wrapped to this device.
// -> 'ok', or an error code: 'alphabet' | 'length' | 'checksum' | 'wrong' | 'no-escrow' | 'untrusted-wrap'.
async function recover(text) {
    const p = await C.parseRecoveryCode(text);
    if (!p.ok) return p.error;
    const rec = await ensureDevice();
    let escrow;
    try { escrow = (await api('GET', '/api/me/escrow')).escrow; }
    catch (e) { if (e.status === 404) return 'no-escrow'; throw e; }
    const bundle = await C.openEscrow(p.symbols, escrow, S.me.id);
    if (!bundle) return 'wrong';
    try {
        const k = await C.importBundle(bundle);
        if (k.encPub !== S.me.keys.encPub || k.sigPub !== S.me.keys.sigPub) return 'untrusted-wrap';
        const w = await C.wrap({ toPub: rec.devPub, ctx: C.deviceCtx(S.me.id, rec.deviceId), plaintext: bundle, by: S.me.id, sigPriv: k.sig });
        await api('POST', '/api/me/devices/self-wrap', { wrap: w });
        await adoptBundle(bundle, rec);
    } catch (e) { if (e.code === 'untrusted-wrap') return 'untrusted-wrap'; throw e; }
    await refreshMe(); await refreshSites();
    return 'ok';
}
// A new recovery key replaces the old one (the old stops working).
async function newRecoveryKey() {
    const bundle = await ownBundle();
    const code = await C.newRecoveryCode();
    const answer = ui() ? await ui().showRecoveryCode(code.text, { required: true, email: S.me.email, first: false }) : 'ok';
    if (answer !== 'ok') return false;
    await api('PUT', '/api/me/escrow', { escrow: await C.sealEscrow(code.symbols, bundle, S.me.id) });
    await refreshMe(); changed();
    return true;
}

// ---- People's keys, as this browser first saw them (A1, A6) ----
const PINS_KEY = () => origin() + '|pins';
async function pins() { return (await C.ksGet('trust', PINS_KEY())) || {}; }
async function pinPerson(user, encPub, sigPub, checked) {
    const all = await pins();
    const enc = await C.fp(encPub), sig = await C.fp(sigPub);
    const was = all[user];
    const same = was && was.enc === enc && was.sig === sig;
    all[user] = { enc, sig, at: same ? was.at : _hooks.now(), checked: same ? (checked === undefined ? !!was.checked : !!checked || !!was.checked) : !!checked };
    await C.ksPut('trust', PINS_KEY(), all);
    return all[user];
}
// -> { state: 'new' | 'same' | 'changed', at, checked } for a person's keys now.
async function personKeys(user, encPub, sigPub) {
    if (!encPub || !sigPub) return { state: 'none' };
    const all = await pins();
    const p = all[user];
    if (!p) return { state: 'new' };
    const same = p.enc === await C.fp(encPub) && p.sig === await C.fp(sigPub);
    return { state: same ? 'same' : 'changed', at: p.at, checked: !!p.checked };
}

// ---- The live stream (D65, C8) ----
const EVENT_NAMES = ['head', 'roster', 'epoch', 'invite-accepted', 'granted', 'site-removed', 'site-added', 'link-request', 'link-approved', 'link-denied', 'keys-changed', 'roster-needed', 'me'];
function startEvents() {
    if (!S.me || S.evStarted) return;
    S.evStarted = true;
    const BC = _hooks.BroadcastChannel !== undefined ? _hooks.BroadcastChannel : (window.BroadcastChannel || null);
    const locks = _hooks.locks !== undefined ? _hooks.locks : (navigator.locks || null);
    if (BC) {
        try {
            S.bc = new BC('topo-server');
            S.bc.onmessage = (e) => { const m = e.data; if (!S.leader && m && typeof m.ev === 'string') handleEvent(m.ev, m.data); };
        } catch (e) { S.bc = null; }
    }
    if (locks && S.bc) {
        locks.request('topo-server-leader', () => new Promise((resolve) => {
            S.release = resolve;
            if (!S.evStarted) { resolve(); return; }
            S.leader = true;
            openStream();
        })).catch(() => {});
    } else { S.leader = true; openStream(); }
}
function openStream() {
    const ES = _hooks.EventSource || window.EventSource;
    if (!ES || S.es) return;
    let es;
    try { es = new ES('/api/events'); } catch (e) { return; }
    S.es = es;
    EVENT_NAMES.forEach((name) => es.addEventListener(name, (e) => {
        let data = {};
        try { data = JSON.parse(e.data || '{}'); } catch (x) { /* empty */ }
        handleEvent(name, data);
        if (S.bc) { try { S.bc.postMessage({ ev: name, data }); } catch (x) { /* closed */ } }
    }));
    es.onopen = () => { handleEvent('open', {}); if (S.bc) { try { S.bc.postMessage({ ev: 'open', data: {} }); } catch (x) { /* closed */ } } };
    // A stream the server closed for good (signed out elsewhere, a revoked
    // session): find out why, and come back if the account still is.
    es.onerror = () => {
        if (es.readyState !== 2) return;
        if (S.es === es) S.es = null;
        setTimeout(async () => { await refreshMe(); if (S.me) { if (S.leader && !S.es) openStream(); } else signedOutHere(); }, 5000);
    };
}
function stopEvents() {
    S.evStarted = false;
    if (S.es) { try { S.es.close(); } catch (e) { /* closed */ } S.es = null; }
    if (S.bc) { try { S.bc.close(); } catch (e) { /* closed */ } S.bc = null; }
    if (S.release) { S.release(); S.release = null; }
    S.leader = false;
}
async function handleEvent(name, data) {
    switch (name) {
        case 'open': await refreshMe(); await refreshSites(); if (sync()) sync().syncAll(); break;
        case 'head': if (sync()) sync().onHead(data.site, data.n); break;
        case 'roster': case 'epoch': if (sync()) sync().onRoster(data.site); break;
        case 'invite-accepted': await refreshSites(); await refreshMe(); if (ui()) ui().waitingArrived(data.site, data.user); break;
        case 'granted': await refreshSites(); if (sync()) sync().onGranted(data.site); break;
        case 'site-removed': await refreshSites(); if (sync()) sync().onRemoved(data.site); break;
        case 'site-added': await refreshSites(); break;
        case 'link-request': await refreshMe(); changed(); if (ui()) ui().linkRequested(); break;
        case 'link-approved': if (S.link) finishLink(S.link, false); break;
        case 'link-denied': if (S.link) endLink(S.link, false); break;
        case 'keys-changed': await refreshSites(); changed(); break;
        case 'roster-needed': await refreshSites(); changed(); break;
        case 'me': await refreshMe(); changed(); break;
        default: break;
    }
    emit('event:' + name, data);
}

// ---- Account settings ----
async function patchMe(patch) { S.me = await api('PATCH', '/api/me', patch); changed(); return S.me; }

// Tests: back to the state of a page with no server.
function _reset() {
    stopEvents();
    if (S.link) { clearInterval(S.link.timer); S.link = null; }
    Object.assign(S, { on: false, status: 'off', health: null, me: null, keys: null, sites: [], invites: [], arrival: null, opening: null });
    S.listeners = new Map();
}

window.serverHashToken = serverHashToken;
window.openServerClient = openServerClient;
window.TopoServer = {
    _hooks, _reset, state: S, api, ServerError, on, emit, changed, serverMarked, openServerClient, serverHashToken,
    refreshMe, refreshSites, site, requestCode, verifyCode, signInWithLink, signOut, ensureKeys, setUpKeys, resetKeys,
    startLink, cancelLink, linkRequests, approveLink, denyLink, recover, newRecoveryKey, ownBundle, myRecord,
    pins, pinPerson, personKeys, patchMe, startEvents, stopEvents, handleEvent, deviceLabel,
    ready: () => S.status === 'ready', me: () => S.me, keys: () => S.keys
};
})();
