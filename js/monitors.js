// ---- Monitors through the server (docs/SCOPE.md D146-D162, step 7h) ----
// A PC turned into a site monitor reports to the site's Topo server
// (desktop/src-tauri/src/monitorlink.rs): its status (the heartbeat), its
// issues and its statistics, each a small record sealed with the site key
// and signed with the PC's device key. People's acts on the issues go the
// same way, signed with their user key. This file is the page's side, on
// the website, the offline zip served by a server and the app alike:
//
//   reading   the records of the open network's site, each checked before
//             it is used: its signature against the key the trusted roster
//             names for its author, and the author's role (only a monitor
//             writes a status or an issue; owners and providers act; a
//             provider's act counts only on the devices the provider whose
//             email is theirs covers). A forged or out-of-scope record is
//             dropped and listed for the owners (D159).
//   folding   the issues go to js/issues.js as records of this site: the
//             next owner's page that is open folds them into the document
//             (D158); the server is told which are in it, so they leave its
//             backups and go after 30 days. An act the document holds and
//             the monitor's record lacks (a provider's, checked here) is
//             passed on signed by the owner, which is what the monitor
//             takes (it cannot read the network to check a provider).
//   acting    Acknowledge, Report a problem and Expected on a site's outage
//             are pushed as act records, as well as written in the document.
//   status    every monitor's latest status: the map's dots and the device
//             panel on any signed-in page; one device down from one monitor
//             and up from another says so ("down from A, up from B": the path
//             between them, not the device).
//   banner    a signed-in page shows the open issues (and a monitor that
//             stopped reporting) as a banner at the top; the card is the
//             desktop app's (D160).
//   heartbeat a monitor that missed 3 intervals is "Monitor at X stopped
//             reporting" in the banner, and on every app with Show alarms on
//             this PC (a system notification, D151).
//   statistics the hourly figures any member can pull (D161); Keep
//             statistics is the site's, set by an owner (D162).
//   turning a PC on  the app's Settings: the device keys made by the app,
//             registered as a monitor, given access (the signed roster names
//             it, the site key is wrapped to it) and handed to the app with
//             the roster this page trusts. Off again: revoked (a new key
//             epoch, wrapped for every member left, the other monitors too).
// Load order: ... -> serversync -> serverui -> ... -> checks -> issues -> monitors -> app

(function () {
'use strict';
const C = window.TopoServerCrypto;
const T = () => window.TopoServer;
const Y = () => window.TopoServerSync;
const _m = {
    invoke: null,        // tests: stands in for window.__TAURI__.core.invoke
    sites: new Map(),    // siteId -> what was read of it
    loading: new Map(),  // siteId -> the load running
    link: null,          // monitor_link_info's answer (the app)
    listening: false,
    stalesTold: new Set(),
    // Act record ids this page pushed or passed on (D277): each once per
    // page, so a fold that still finds the monitor's record lacking an act
    // does not send it again and again.
    sentActs: new Set(),
    timer: 0
};
const el = (id) => document.getElementById(id);
const RELOAD_MS = 60000;
const MISSED = 3;

function mInvoke(cmd, args) {
    if (_m.invoke) return Promise.resolve().then(() => _m.invoke(cmd, args || {}));
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
const hasHost = () => !!_m.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
const serverOn = () => !!(T() && Y() && T().ready && T().ready());
// The open network's server record ({ siteId, role, ... }) or null.
const openRec = () => (serverOn() && state.libraryId ? Y().rec(state.libraryId) : null);
const siteOfOpen = () => { const r = openRec(); return r && r.siteId ? r.siteId : null; };
const isOwnerOf = (siteId) => { const r = serverOn() && Y().recBySite(siteId); return !!r && r.role === 'owner'; };

function siteState(siteId) {
    let s = _m.sites.get(siteId);
    if (!s) {
        s = { lastN: 0, status: new Map(), issues: new Map(), acts: new Map(), quiet: new Map(), refused: new Map(),
            monitors: [], statsDays: 360, statsAt: 0, skew: 0, loadedAt: 0 };
        _m.sites.set(siteId, s);
    }
    return s;
}

// ---- Reading the records ----
// The roster line that names u, newest first (a revoked monitor's issues
// are still checked against the roster that named it).
const lineOf = (t, u) => { for (let i = t.rosters.length - 1; i >= 0; i--) { const m = C.rosterMember(t.rosters[i], u); if (m) return m; } return null; };
const KIND_ROLES = { status: ['monitor'], issue: ['monitor'], act: ['owner', 'provider'], quiet: ['owner'] };

// One record checked and opened. -> { ok, kind, id, author, role, email, payload } or { ok: false, why }.
async function openOne(siteId, t, x) {
    const r = x && x.record;
    if (!r || r.site !== siteId || !KIND_ROLES[r.kind]) return { ok: false, why: 'shape' };
    const line = lineOf(t, r.author);
    const pub = t.pubs && t.pubs[r.author];
    if (!line || !pub || !pub.sigPub || (await C.fp(pub.sigPub)) !== line.sig) return { ok: false, why: 'unknown-author', r };
    if (!KIND_ROLES[r.kind].includes(line.role)) return { ok: false, why: 'role', r, role: line.role };
    let key;
    try { key = await Y().siteKey(siteId, r.epoch); } catch (e) { return { ok: false, why: 'no-key', r }; }
    let plain;
    try { plain = await C.openRecord(r, key, pub.sigPub); } catch (e) { return { ok: false, why: 'forged', r }; }
    let payload;
    try { payload = JSON.parse(C.fromUtf8(plain)); } catch (e) { return { ok: false, why: 'shape', r }; }
    if (!payload || typeof payload !== 'object') return { ok: false, why: 'shape', r };
    return { ok: true, kind: r.kind, id: r.id, author: r.author, role: line.role, email: line.email, at: r.at, n: x.n, folded: !!x.folded, payload };
}

// Reads what is new on a site. -> its state.
function load(siteId, opts = {}) {
    if (_m.loading.get(siteId)) return _m.loading.get(siteId);
    const run = (async () => {
        const s = siteState(siteId);
        const mons = await T().api('GET', `/api/sites/${siteId}/monitors`);
        s.monitors = (mons && mons.monitors) || [];
        s.statsDays = mons && Number.isFinite(mons.statsDays) ? mons.statsDays : 360;
        s.statsAt = Date.now();
        s.skew = mons && mons.now ? mons.now - Date.now() : 0;
        const t = await Y().walkRosters(siteId);
        for (let page = 0; page < 50; page++) {
            const got = await T().api('GET', `/api/sites/${siteId}/records?since=${s.lastN}`);
            for (const x of (got && got.records) || []) {
                s.lastN = Math.max(s.lastN, x.n || 0);
                const o = await openOne(siteId, t, x);
                const key = (x.record && x.record.kind) + '|' + (x.record && x.record.id);
                if (!o.ok) { s.refused.set(key, { why: o.why, author: x.record && x.record.author, kind: x.record && x.record.kind, at: x.record && x.record.at }); continue; }
                s.refused.delete(key);
                if (o.kind === 'status') s.status.set(o.author, o);
                else if (o.kind === 'issue') s.issues.set(o.id, o);
                else if (o.kind === 'act') s.acts.set(o.id, o);
                else if (o.kind === 'quiet') s.quiet.set(o.id, o);
            }
            if (!got || !got.more) break;
        }
        // A revoked monitor's last status goes with it (the server deleted it).
        for (const id of [...s.status.keys()]) if (!s.monitors.some((m) => m.id === id)) s.status.delete(id);
        s.loadedAt = Date.now();
        if (!opts.quiet) afterLoad(siteId);
        return s;
    })().finally(() => _m.loading.delete(siteId));
    _m.loading.set(siteId, run);
    return run;
}

// ---- Acts and their scope ----
const ACTS = ['ack', 'report', 'expected'];
// May this act count? Owners always; a provider only on devices the
// provider whose email is theirs covers (in this document).
function actInScope(o, nodeId, doc) {
    if (o.role === 'owner') return true;
    if (o.role !== 'provider' || !nodeId) return false;
    const email = String(o.email || '').toLowerCase();
    const provs = ((doc && doc.providers) || state.providers || []).filter((p) => p && String(p.email || '').trim().toLowerCase() === email && email);
    const ctx = doc ? { nodes: doc.nodes || [], links: doc.links || [], groups: doc.groups || [], providers: doc.providers || [] } : {};
    return provs.some((p) => (typeof providerCovers === 'function' ? providerCovers(p.id, ctx).nodes : []).some((n) => n.id === nodeId));
}
const actOf = (p) => {
    const a = { act: p.act, at: p.at };
    if (p.by) a.by = String(p.by).slice(0, 120);
    if (p.note) a.note = String(p.note).slice(0, 2000);
    if (p.reportId) a.reportId = String(p.reportId);
    return a;
};
// The site's issues as js/issues.js records: the monitor's own, its acts
// and the people's acts in scope; the ones out of scope are refused.
function issueRecords(siteId, cardId) {
    const s = siteState(siteId);
    const out = [];
    for (const o of s.issues.values()) {
        const p = o.payload;
        if (!p || typeof p.nodeId !== 'string') continue;
        const own = (Array.isArray(p.acts) ? p.acts : []).filter((a) => a && ACTS.includes(a.act) && Number.isFinite(a.at)).map(actOf);
        const acts = own.slice();
        for (const a of s.acts.values()) {
            const q = a.payload;
            if (!q || q.issue !== o.id || !ACTS.includes(q.act) || !Number.isFinite(q.at)) continue;
            if (!actInScope(a, p.nodeId)) { s.refused.set('act|' + a.id, { why: 'scope', author: a.author, kind: 'act', at: a.at, email: a.email }); continue; }
            acts.push(actOf(q));
        }
        out.push({
            id: o.id, server: siteId, n: o.n, rev: 's' + o.n + '.' + acts.length, networkId: cardId, nodeId: p.nodeId, name: p.name || '',
            keys: p.keys || [], behind: Array.isArray(p.behind) ? p.behind : [], outages: Array.isArray(p.outages) ? p.outages : [],
            flapping: !!p.flapping, monitor: p.monitor || '', monitorId: p.monitorId || o.author, gone: !!p.gone, acts, ownActs: own
        });
    }
    return out;
}

function afterLoad(siteId) {
    const cardId = state.libraryId;
    foldEndedQuiet(siteId);
    if (siteOfOpen() === siteId && window.TopoIssues && TopoIssues.onServerRecords) TopoIssues.onServerRecords(siteId, issueRecords(siteId, cardId));
    if (window.TopoChecks && TopoChecks.serverStatusChanged) TopoChecks.serverStatusChanged();
    renderBanner();
    notifyStale(siteId);
    renderSiteMonitorSettings();
}

// An outage of this site whose record lacks an act the document holds:
// passed on signed by this owner, so the monitor takes it (D247 through the
// server). id: the act's own id and "|o"; its time is the act's, so a
// repeat is an older record the server refuses quietly (no new event).
// Not when an owner's own record of that act is there (the monitor takes
// those itself), when this page sent it already, or while the issue's
// monitor is revoked or stopped reporting (it would not take it anyway).
async function relayAct(siteId, issueId, a) {
    if (!isOwnerOf(siteId)) return false;
    const base = `${issueId}|${a.act}|${a.at}`.slice(0, 160);
    if (_m.sentActs.has(base) || _m.sentActs.has(base + '|o')) return false;
    const s = siteState(siteId);
    const own = s.acts.get(base);
    if (own && own.role === 'owner') return false;
    const iss = s.issues.get(issueId);
    const mon = iss && s.monitors.find((m) => m.id === iss.author);
    if (!mon || mon.stale) return false;
    return pushAct(siteId, issueId, a, '|o');
}
// One person's act on a site's outage, as a signed record (D158).
async function pushAct(siteId, issueId, a, suffix = '') {
    const id = `${issueId}|${a.act}|${a.at}${suffix}`.slice(0, 160);
    if (_m.sentActs.has(id)) return true;
    _m.sentActs.add(id);
    try {
        const K = T().keys(), me = T().me();
        if (!K || !me) return false;
        const t = await Y().walkRosters(siteId);
        const last = t.rosters[t.rosters.length - 1];
        const epoch = last ? last.epoch : 1;
        const key = await Y().siteKey(siteId, epoch);
        const payload = Object.assign({ issue: issueId }, actOf(a));
        const asProv = window.TopoProviderMode ? TopoProviderMode.providerSelfOf(state.docId || state.libraryId) : '';
        if (asProv) payload.as = asProv;
        const rec = await C.sealRecord({ site: siteId, kind: 'act', id, epoch, author: me.id, at: suffix ? a.at : Date.now() },
            key, K.uSig, C.utf8(JSON.stringify(payload)));
        await T().api('POST', `/api/sites/${siteId}/records`, rec);
        return true;
    } catch (e) {
        // Someone else passed it on first (not-author), or an older one: fine.
        if (e && (e.code === 'not-author' || e.code === 'older-record')) return true;
        _m.sentActs.delete(id);   // tried again on a later fold
        console.warn('Topo: the act did not reach the server:', e);
        return false;
    }
}
// A quiet window (maintenance) set by an owner, as a signed record the
// site's monitors take (D227, D265). scope: 'site', 'node' or 'group';
// until 0 ends it. One record per scope and id (a newer one replaces it).
async function pushQuiet(siteId, scope, id, until) {
    if (!isOwnerOf(siteId) || !['site', 'node', 'group'].includes(scope)) return false;
    const K = T().keys(), me = T().me();
    if (!K || !me) return false;
    const t = await Y().walkRosters(siteId);
    const last = t.rosters[t.rosters.length - 1];
    const epoch = last ? last.epoch : 1;
    const key = await Y().siteKey(siteId, epoch);
    const payload = { scope, id: scope === 'site' ? '' : String(id || ''), until: Math.max(0, Math.round(Number(until) || 0)) };
    const rec = await C.sealRecord({ site: siteId, kind: 'quiet', id: `${scope}|${payload.id}`.slice(0, 160), epoch, author: me.id, at: Date.now() },
        key, K.uSig, C.utf8(JSON.stringify(payload)));
    await T().api('POST', `/api/sites/${siteId}/records`, rec);
    await load(siteId, { quiet: true }).catch(() => {});
    return true;
}
// The site's quiet windows now, from the owners' records:
// { site, nodes: { id: until }, groups: { id: until } } (as the app's info.quiet).
function siteQuiet(siteId, now = Date.now()) {
    const out = { site: 0, nodes: {}, groups: {} };
    if (!siteId) return out;
    for (const o of siteState(siteId).quiet.values()) {
        const p = o.payload || {};
        if (o.role !== 'owner' || !Number.isFinite(p.until) || p.until <= now) continue;
        if (p.scope === 'site') out.site = Math.max(out.site, p.until);
        else if (p.scope === 'node' && p.id) out.nodes[p.id] = Math.max(out.nodes[p.id] || 0, p.until);
        else if (p.scope === 'group' && p.id) out.groups[p.id] = Math.max(out.groups[p.id] || 0, p.until);
    }
    return out;
}
// Quiet windows that ended are in no one's way: folded, so they leave the
// backups and go after 30 days (the monitors read them by number all the same).
function foldEndedQuiet(siteId) {
    if (!isOwnerOf(siteId)) return;
    const s = siteState(siteId);
    const now = Date.now() + (s.skew || 0);
    const ns = [...s.quiet.values()].filter((o) => !o.folded && o.n && !(o.payload && Number.isFinite(o.payload.until) && o.payload.until > now)).map((o) => o.n);
    if (!ns.length) return;
    T().api('POST', `/api/sites/${siteId}/records/folded`, { ns })
        .then(() => { for (const o of s.quiet.values()) if (ns.includes(o.n)) o.folded = true; }, () => {});
}
// The records an owner's page folded (or found folded) in the document:
// the issues, and the acts on them (in the document now, or refused as out
// of scope), so they leave the backups and go after 30 days (D277). The
// server folds an issue's acts with it too; this covers an act that came
// after its issue was folded.
async function folded(siteId, ids) {
    const s = siteState(siteId);
    if (!isOwnerOf(siteId)) return 0;
    const set = new Set(ids);
    const objs = ids.map((id) => s.issues.get(id)).filter((o) => o && !o.folded);
    for (const a of s.acts.values()) if (!a.folded && a.n && a.payload && set.has(a.payload.issue)) objs.push(a);
    if (!objs.length) return 0;
    try {
        await T().api('POST', `/api/sites/${siteId}/records/folded`, { ns: objs.map((o) => o.n) });
        objs.forEach((o) => { o.folded = true; });
        return objs.length;
    } catch (e) { return 0; }
}
const mayFold = (siteId) => isOwnerOf(siteId) && siteOfOpen() === siteId;

// ---- Status ----
// Every monitor's state of each check of node, newest first: { monitor, name, s }.
function serverStatusesOf(node) {
    const siteId = siteOfOpen();
    if (!siteId || !node) return [];
    const s = siteState(siteId);
    const out = [];
    for (const o of s.status.values()) {
        const items = Array.isArray(o.payload.items) ? o.payload.items : [];
        const mon = s.monitors.find((m) => m.id === o.author);
        if (!mon) continue;   // revoked: its last word no longer counts
        items.filter((x) => x && x.nodeId === node.id).forEach((x) => out.push({ monitor: o.author, name: (mon && mon.name) || o.payload.monitor || '', stale: !!(mon && mon.stale), s: x }));
    }
    return out;
}
// One status per check key for the map: the worst, and "split" when one
// monitor says down and another up (D150's two monitors on one item).
function combinedStatus(node) {
    const map = new Map();
    serverStatusesOf(node).forEach((x) => {
        if (x.stale) return;
        const k = x.s.key;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(x);
    });
    const out = [];
    for (const [k, xs] of map) {
        const down = xs.filter((x) => x.s.state === 'down'), up = xs.filter((x) => x.s.state === 'up');
        const base = Object.assign({}, (down[0] || xs[0]).s, { key: k });
        if (down.length && up.length) Object.assign(base, { split: { down: down.map((x) => x.name), up: up.map((x) => x.name) } });
        out.push(base);
    }
    return out;
}
// The split of a device now (one monitor says down, another up), or null.
function splitOf(nodeId) {
    const node = nodeId && typeof getNode === 'function' ? getNode(nodeId) : null;
    if (!node) return null;
    const x = combinedStatus(node).find((c) => c.split);
    return x ? x.split : null;
}
function splitText(sp) {
    return t('Not answering from {a}, answering from {b}: look at the path between them, not the device.', { a: sp.down.join(', '), b: sp.up.join(', ') });
}

// ---- The banner (signed-in pages, D158) ----
function openIssues(siteId) {
    const docOut = new Map((state.incidents || []).filter((i) => i && i.kind === 'outage').map((i) => [i.id, i]));
    const since = (r) => (r.outages[0] ? r.outages[0].from : 0);
    return issueRecords(siteId, state.libraryId)
        .filter((r) => !r.acts.length && !r.gone && !(docOut.get(r.id) && docOut.get(r.id).status === 'closed'))
        .sort((a, b) => since(a) - since(b));
}
function staleMonitors(siteId) {
    const s = siteState(siteId);
    const now = Date.now() + s.skew;
    return s.monitors.filter((m) => m.stale || (m.lastReport && now - m.lastReport > MISSED * (m.intervalMs || 60000)));
}
function nodeName(id) { const n = typeof getNode === 'function' ? getNode(id) : null; return n ? (typeof locPlainName === 'function' ? locPlainName(n) : n.name || id) : id; }
function renderBanner() {
    const box = el('srvIssueBanner');
    if (!box) return;
    const siteId = siteOfOpen();
    if (window.TopoLock && TopoLock.isLocked && TopoLock.isLocked()) { box.hidden = true; box.textContent = ''; return; }
    // The connections (step 8f, js/connections.js): this app's server not
    // answering, the watched PCs that lost theirs; with or without a site open.
    const conn = window.TopoConnections ? TopoConnections.bannerLines() : [];
    if (!siteId) { drawBannerLines(box, conn); return; }
    const issues = openIssues(siteId);
    const stale = staleMonitors(siteId);
    const lines = conn.slice();
    if (issues.length) {
        const first = issues[0];
        const since = first.outages.length ? first.outages[first.outages.length - 1].from : 0;
        const answering = first.outages.length && Number.isFinite(first.outages[first.outages.length - 1].to);
        const sp = splitOf(first.nodeId);
        let text = answering ? t('{name} is answering again, still waiting for someone to act.', { name: nodeName(first.nodeId) })
            : sp ? `${nodeName(first.nodeId)}: ${splitText(sp)}`
            : first.behind.length ? tn(first.behind.length, '{name} and {n} device behind it are not answering', '{name} and {n} devices behind it are not answering', { name: nodeName(first.nodeId) })
                : t('{name} is not answering', { name: nodeName(first.nodeId) });
        if (since && !answering) text += ' · ' + t('since {time}', { time: new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        if (issues.length > 1) text += ' · ' + tn(issues.length - 1, '{n} more', '{n} more');
        lines.push({ text, cls: answering ? 'srv-ib-soft' : 'srv-ib-down' });
    }
    stale.forEach((m) => lines.push({ text: t('Monitor at {name} stopped reporting', { name: m.name }), cls: 'srv-ib-stale' }));
    const s = siteState(siteId);
    if (isOwnerOf(siteId) && s.refused.size) {
        const n = [...s.refused.values()].filter((x) => x.why !== 'no-key').length;
        if (n) lines.push({ text: tn(n, '{n} record was refused: not signed by a member allowed to write it.', '{n} records were refused: not signed by a member allowed to write them.'), cls: 'srv-ib-refused' });
    }
    drawBannerLines(box, lines);
}
function drawBannerLines(box, lines) {
    box.hidden = !lines.length;
    box.innerHTML = '';
    lines.forEach((l) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'srv-ib-line ' + l.cls;
        b.textContent = l.text;
        b.addEventListener('click', () => { if (typeof openIncidentsView === 'function') openIncidentsView(); });
        box.appendChild(b);
    });
}

// A monitor that stopped reporting, on an app with Show alarms on (D151).
function notifyStale(siteId) {
    const info = window.TopoChecks && TopoChecks.state.info;
    staleMonitors(siteId).forEach((m) => {
        const key = m.id + '|' + (m.lastReport || 0);
        if (_m.stalesTold.has(key)) return;
        _m.stalesTold.add(key);
        if (hasHost() && info && info.alarms) mInvoke('alarm_notify', { text: t('Monitor at {name} stopped reporting', { name: m.name }) }).catch(() => {});
    });
}

// ---- Live: the server's events ----
function onEvent(name, data) {
    if (!data || !data.site) return;
    if (siteOfOpen() !== data.site) { if (name === 'monitor' && data.stale) load(data.site).catch(() => {}); return; }
    clearTimeout(_m.timer);
    _m.timer = setTimeout(() => { load(data.site).catch((e) => console.warn('Topo: the monitors\' records could not be read:', e)); }, 200);
}
function listen() {
    if (_m.listening || !T() || !T().on) return;
    _m.listening = true;
    ['monitor-status', 'record', 'monitor', 'monitors'].forEach((n) => T().on('event:' + n, (d) => onEvent(n, d)));
}
// The open network changed, or a minute went by.
function refresh() {
    listen();
    const siteId = siteOfOpen();
    if (window.TopoConnections) { TopoConnections.listen(); if (siteId) TopoConnections.loadSite(siteId); }
    if (!siteId) { renderBanner(); return Promise.resolve(null); }
    return load(siteId).catch((e) => { console.warn('Topo: the monitors\' records could not be read:', e); return null; });
}

// Every redraw asks (js/checks.js checksDocChanged): another site opened,
// or none read for a minute, reads it; else the banner follows the document.
let _lastSite = null;
function maybeRefresh() {
    const siteId = siteOfOpen();
    if (siteId !== _lastSite) {
        _lastSite = siteId;
        if (!siteId) { renderBanner(); if (window.TopoChecks && TopoChecks.serverStatusChanged) TopoChecks.serverStatusChanged(); return; }
        refresh();
        return;
    }
    if (siteId && Date.now() - siteState(siteId).loadedAt > RELOAD_MS && !_m.loading.get(siteId)) { refresh(); return; }
    renderBanner();
}

// ---- Statistics (D161, D162) ----
// The hourly figures of the days from..to (UTC day starts), every monitor:
// [{ monitor, name, day, checks: { key: { node, name, hours } } }].
// The server answers at most 400 blobs at once (oldest day first): a long
// period (a quarter's report, step 7j) is read on from the last day it
// answered, each monitor and day once.
const STATS_PAGE = 400;
async function stats(siteId, from, to) {
    const all = [], seen = new Set();
    let at = from;
    for (let page = 0; page < 40; page++) {
        const got = await T().api('GET', `/api/sites/${siteId}/stats?from=${at}&to=${to}`);
        const list = (got && got.stats) || [];
        let fresh = 0;
        list.forEach((x) => { const k = `${x.monitor}|${x.day}`; if (!seen.has(k)) { seen.add(k); all.push(x); fresh++; } });
        if (list.length < STATS_PAGE || !fresh) break;
        at = list[list.length - 1].day;
    }
    const t = await Y().walkRosters(siteId);
    const out = [];
    for (const x of all) {
        const r = x.record;
        const line = lineOf(t, r.author), pub = t.pubs[r.author];
        if (!line || line.role !== 'monitor' || !pub || (await C.fp(pub.sigPub)) !== line.sig) continue;
        try {
            const key = await Y().siteKey(siteId, r.epoch);
            const p = JSON.parse(C.fromUtf8(await C.openRecord(r, key, pub.sigPub)));
            out.push({ monitor: r.author, name: p.monitor || '', day: x.day, checks: p.checks || {} });
        } catch (e) { /* forged or another key: left out */ }
    }
    return out;
}
// Availability over hourly figures: up / (up + down), maintenance and
// unknown left out, with the coverage (D163).
function availability(hours, spanS) {
    let up = 0, down = 0;
    // sDown already holds sUpstream (stats.rs add_state): counted once (D290).
    hours.forEach((h) => { up += (h.sUp || 0) + (h.sSlow || 0); down += h.sDown || 0; });
    const measured = up + down;
    return { availability: measured ? up / measured : null, coverage: spanS ? Math.min(1, measured / spanS) : 0 };
}
async function setStatsDays(siteId, days) {
    try { return await T().api('PATCH', `/api/sites/${siteId}/stats-days`, { days }); }
    catch (e) {
        if (e && e.code === 'confirm') {
            const n = (e.data && e.data.deletes) || (e.extra && e.extra.deletes) || 0;
            const msg = days === 0 ? tn(n, 'Turn statistics off? {n} day of figures kept on the server will be deleted.', 'Turn statistics off? {n} days of figures kept on the server will be deleted.')
                : tn(n, 'Keep statistics {days} days? {n} day of figures kept on the server will be deleted.', 'Keep statistics {days} days? {n} days of figures kept on the server will be deleted.', { days });
            if (!(await askConfirm(msg, { ok: t('Delete'), danger: true }))) return null;
            return T().api('PATCH', `/api/sites/${siteId}/stats-days`, { days, confirm: true });
        }
        throw e;
    }
}

// ---- This PC as the site's monitor (the app) ----
async function linkInfo() {
    if (!hasHost()) return null;
    try { _m.link = await mInvoke('monitor_link_info'); } catch (e) { _m.link = null; }
    return _m.link;
}
// Turns this PC into the open network's site monitor (D146). groups: the
// group ids it checks ([] = the whole site).
// The network is the open one (its library card): this PC's monitor must
// watch it or none yet, so another network kept here never reaches the
// site (D278). A step that fails after the server made the monitor takes
// it away again, so no monitor is left that can never report.
async function turnOn(siteId, groups = []) {
    const me = T().me();
    const network = state.libraryId;
    const info = window.TopoChecks && TopoChecks.state.info;
    if (!network) throw new Error(t('Keep this network in My networks first: the monitor checks a kept network.'));
    if (info && info.on && info.networkId && info.networkId !== network) {
        throw new Error(t('This PC monitors another network: {name}. Monitor this network first, then make it the site\'s monitor.', { name: info.networkName || '' }));
    }
    const key = await mInvoke('monitor_device_key');
    const name = (key.name || t('This PC')).slice(0, 120);
    const res = await T().api('POST', `/api/sites/${siteId}/monitors`, { name, encPub: key.encPub, sigPub: key.sigPub });
    const mid = res.monitor.id;
    try {
        // Given access as any member (the roster names it 'monitor', the site
        // key is wrapped to it). Its keys came from this PC: nothing to compare.
        await Y().grant(siteId, [mid], { checked: true, history: false });
        const tr = await Y().walkRosters(siteId);
        const roster = tr.rosters[tr.rosters.length - 1];
        _m.link = await mInvoke('monitor_enroll', { args: { site: siteId, monitor: mid, name, by: me.email, token: res.token, roster, groups, network } });
    } catch (e) {
        try { await Y().removeMember(siteId, mid); } catch (e2) { console.warn('Topo: the half-made monitor could not be taken away:', e2); }
        throw e;
    }
    await load(siteId);
    return _m.link;
}
// Off on this PC: revoked on the server (a new epoch for everyone left),
// then forgotten here.
// Signed out (or not an owner there) the server cannot be told: the page
// asks with other words first (onSiteMonClick), and only this PC forgets.
const canRevokeHere = (l) => !!(l && l.site && serverOn() && isOwnerOf(l.site));
async function turnOff() {
    const l = await linkInfo();
    if (canRevokeHere(l) && l.monitor) {
        try { await Y().removeMember(l.site, l.monitor); } catch (e) { if (!(e && (e.code === 'not-found' || e.status === 404))) throw e; }
    }
    _m.link = await mInvoke('monitor_unenroll');
    return _m.link;
}
// Which check blocks this PC checks as the site's monitor (D150): a block
// naming monitors, only if it names this one; else the devices in the
// monitor's groups (all when it has none).
function assigned(node, c, link) {
    if (!link || !link.enrolled) return true;
    if (Array.isArray(c.monitors) && c.monitors.length) return c.monitors.includes(link.monitor);
    const gs = Array.isArray(link.groups) ? link.groups : [];
    if (!gs.length) return true;
    const g = node.group && typeof groupById === 'function' ? groupById(node.group) : null;
    const ids = new Set(g ? groupChain(g).map((x) => x.id) : []);
    return gs.some((g) => ids.has(g));
}

const keyWords = (k) => (k === 'keychain' ? t('Its key is in this PC\'s keychain.') : t('This PC has no keychain service: its key is in a file only you can read.'));
function renderSiteMonitorSettings() {
    const box = el('setSiteMon');
    if (!box) return;
    const siteId = siteOfOpen();
    const l = _m.link;
    const show = hasHost() && serverOn() && (!!siteId || (l && l.enrolled));
    box.hidden = !show;
    if (!show) return;
    const st = el('setSiteMonStatus');
    const go = el('setSiteMonOn'), off = el('setSiteMonOff'), gbox = el('setSiteMonGroups');
    if (l && l.enrolled) {
        const parts = [t('This PC is the site\'s monitor "{name}", turned on by {by} on {date}.', { name: l.name, by: l.by, date: new Date(l.enrolledAt).toLocaleDateString() }), keyWords(l.keyKind)];
        if (l.lastPush) parts.push(t('Last report: {time}.', { time: new Date(l.lastPush).toLocaleTimeString() }));
        if (l.error) parts.push(t('Not reporting: {error}', { error: l.error }));
        st.textContent = parts.join(' ');
        go.hidden = true; off.hidden = false; gbox.hidden = true;
    } else {
        st.textContent = l && l.revoked ? t('An owner revoked this PC as the site\'s monitor.') : isOwnerOf(siteId)
            ? t('As the site\'s monitor this PC keeps checking and reporting with no one signed in. Owners see it in the members list and can revoke it.')
            : t('Only an owner can make this PC the site\'s monitor.');
        go.hidden = !isOwnerOf(siteId); off.hidden = true;
        gbox.hidden = !isOwnerOf(siteId);
        // The groups of the network open now (another one opened: again).
        if (!gbox.hidden && gbox.dataset.site !== siteId) {
            gbox.dataset.site = siteId;
            gbox.textContent = '';
            const tops = (state.groups || []).filter((g) => !g.parent);
            tops.forEach((g) => {
                const lab = document.createElement('label');
                lab.className = 'set-row';
                const cb = document.createElement('input');
                cb.type = 'checkbox'; cb.value = g.id; cb.className = 'site-mon-group';
                const sp = document.createElement('span'); sp.textContent = g.name || g.id;
                lab.append(cb, sp);
                gbox.appendChild(lab);
            });
            if (!tops.length) { const p = document.createElement('p'); p.className = 'dlg-dim set-note'; p.textContent = t('It checks every device of the network.'); gbox.appendChild(p); }
        }
    }
}
async function onSiteMonClick(e) {
    const id = e.target && e.target.id;
    if (id === 'setSiteMonOn') {
        const siteId = siteOfOpen();
        if (!siteId) return;
        const groups = [...document.querySelectorAll('.site-mon-group')].filter((c) => c.checked).map((c) => c.value);
        try {
            await turnOn(siteId, groups);
            showToast(t('This PC is now the site\'s monitor.'), 'ok');
            if (window.TopoChecks && TopoChecks.state.info && !TopoChecks.state.info.on) showToast(t('Turn on Monitor from this PC above to start checking.'), 'ok');
        } catch (err) { showToast(t('This PC could not be made the site\'s monitor: {error}', { error: String(err && err.message || err) }), 'warn'); }
        renderSiteMonitorSettings();
        if (window.TopoChecks && TopoChecks.pushPlanNow) TopoChecks.pushPlanNow();
    } else if (id === 'setSiteMonOff') {
        const ask = canRevokeHere(_m.link)
            ? askConfirm(t('Stop this PC being the site\'s monitor? Its credential is revoked and the network key changes for everyone left.'), { ok: t('Revoke'), danger: true })
            : askConfirm(t('You are not signed in here as an owner of the site, so its server cannot be told. This PC forgets its monitor keys, but the site lists the monitor (stopped reporting) until an owner revokes it in the members list. Forget it here?'), { ok: t('Forget here'), danger: true });
        if (!(await ask)) return;
        try { await turnOff(); showToast(t('This PC is no longer the site\'s monitor.'), 'ok'); }
        catch (err) { showToast(String(err && err.message || err), 'warn'); }
        renderSiteMonitorSettings();
        if (window.TopoChecks && TopoChecks.pushPlanNow) TopoChecks.pushPlanNow();
    }
}

// ---- The members list: monitors (D147, D149) ----
// "Monitor: PC name (turned on by X on date)", and when it last reported.
function memberMonitorText(siteId, userId) {
    const s = _m.sites.get(siteId);
    const m = s && s.monitors.find((x) => x.id === userId);
    if (!m) return null;
    const title = t('Monitor: {name} (turned on by {by} on {date})', { name: m.name, by: m.byEmail || '', date: new Date(m.created).toLocaleDateString() });
    const now = Date.now() + (s.skew || 0);
    const last = !m.lastReport ? t('Has not reported yet')
        : m.stale || now - m.lastReport > MISSED * (m.intervalMs || 60000) ? t('Stopped reporting · last report {time}', { time: new Date(m.lastReport).toLocaleString() })
            : t('Last report {time}', { time: new Date(m.lastReport).toLocaleTimeString() });
    return { title, last, stale: !!m.stale };
}
async function loadMonitors(siteId) {
    const s = siteState(siteId);
    const mons = await T().api('GET', `/api/sites/${siteId}/monitors`);
    s.monitors = (mons && mons.monitors) || [];
    s.statsDays = mons && Number.isFinite(mons.statsDays) ? mons.statsDays : 360;
    s.statsAt = Date.now();
    s.skew = mons && mons.now ? mons.now - Date.now() : 0;
    return s;
}

// ---- A backup's records (D159): folded into the restored network ----
// rec: the file's records; key: CryptoKey by epoch (async fn); rosters and
// pubs: the file's; doc: the restored document (a provider's act counts on
// the devices it says they cover). -> issue records for js/issues.js, with
// the people's acts not yet folded (unchecked ones left out).
async function backupIssues(records, keyOf, rosters, pubs, cardId, doc) {
    const t = { rosters: rosters || [], pubs: pubs || {} };
    const out = [], acts = [];
    for (const r of records || []) {
        if (!r || !KIND_ROLES[r.kind] || (r.kind !== 'issue' && r.kind !== 'act')) continue;
        const line = lineOf(t, r.author), pub = t.pubs[r.author];
        if (!line || !KIND_ROLES[r.kind].includes(line.role) || !pub || (await C.fp(pub.sigPub)) !== line.sig) continue;
        try {
            const p = JSON.parse(C.fromUtf8(await C.openRecord(r, await keyOf(r.epoch), pub.sigPub)));
            if (r.kind === 'act') { acts.push({ role: line.role, email: line.email, p }); continue; }
            out.push({ id: r.id, networkId: cardId, nodeId: p.nodeId, name: p.name || '', behind: p.behind || [], outages: p.outages || [], flapping: !!p.flapping, monitor: p.monitor || '', gone: !!p.gone, acts: (p.acts || []).map(actOf), rev: 'b' + r.at });
        } catch (e) { /* not this key, or forged */ }
    }
    acts.forEach((a) => {
        const q = a.p;
        if (!q || !ACTS.includes(q.act) || !Number.isFinite(q.at)) return;
        const iss = out.find((x) => x.id === q.issue);
        if (!iss || !actInScope(a, iss.nodeId, doc || null)) return;
        const x = actOf(q);
        if (!iss.acts.some((y) => y.act === x.act && y.at === x.at)) iss.acts.push(x);
    });
    return out;
}

window.addEventListener('topo:ready', () => {
    listen();
    linkInfo().then(() => renderSiteMonitorSettings());
    setInterval(() => { if (siteOfOpen()) refresh(); }, RELOAD_MS);
    document.addEventListener('click', (e) => { if (e.target && /^setSiteMon(On|Off)$/.test(e.target.id)) onSiteMonClick(e); });
    const ev = window.__TAURI__ && window.__TAURI__.event;
    if (ev && typeof ev.listen === 'function') ev.listen('topo-monitor-link', () => linkInfo().then(renderSiteMonitorSettings)).catch(() => {});
});

window.renderSiteMonitorSettings = renderSiteMonitorSettings;
window.TopoMonitors = {
    state: _m, hasHost, siteState, openOne, load, refresh, issueRecords, actInScope, pushAct, relayAct, pushQuiet, siteQuiet, folded, mayFold, isOwnerOf,
    serverStatusesOf, combinedStatus, splitOf, splitText, openIssues, staleMonitors, renderBanner, stats, availability, setStatsDays,
    linkInfo, turnOn, turnOff, assigned, maybeRefresh, renderSiteMonitorSettings, memberMonitorText, loadMonitors, backupIssues, siteOfOpen, onEvent
};
})();
