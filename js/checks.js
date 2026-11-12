// ---- Answer checks: Monitor from this PC (docs/SCOPE.md D127-D131, D155-D157,
// D161-D163, step 7f; D227-D236) ----
// The desktop app only. A device's check blocks (node.checks, document v19,
// "Answer checks" in js/model.js) say what to ask it; this file is the
// page's side of the monitor:
//
//   the plan      the checks of the network this PC monitors, each with its
//                 address, port and options, its interval and "slow above",
//                 the devices between this PC and it (its upstream chain,
//                 nearest to this PC first, for root cause) and the groups
//                 it is in (for their quiet windows); sent to the app
//                 (`monitor_plan`) whenever it changes. The app runs the
//                 schedule, does the network I/O, keeps the states and the
//                 statistics (desktop/src-tauri/src/monitor.rs, checks.rs,
//                 stats.rs), and sends each change back ("topo-monitor").
//   the map       a status dot on each checked device of the network this
//                 PC monitors: answering, slow, not answering (or not
//                 answering because of a device upstream), flapping, quiet,
//                 unknown. A class of its own, so no export carries it.
//   Answer checks the device panel's section (Full editor): its checks, each
//                 with what it asks, how it is now and its last 24 h (a
//                 response-time chart over the state bar, and the numbers in
//                 a line beside it); Add a check; the availability target;
//                 Quiet for… on the device or its group.
//   Settings      Monitor from this PC (off as shipped, D131): turning it on
//                 offers the tray icon and Open Topo at sign-in (both ticked,
//                 so it keeps checking with the window closed); the network
//                 monitored; quiet the whole site; Keep statistics (360 days,
//                 Off keeps nothing, a shorter period deletes after saying
//                 how much).
//
// The website and the offline zip have no window.__TAURI__: nothing here
// shows and nothing is asked of anyone (D127). The checks stay in the
// document either way, for the app that monitors.
// Load order: ... -> importui -> thiscomputer -> checks -> app -> settings

(function () {
'use strict';
const _ck = {
    invoke: null,     // tests: stands in for window.__TAURI__.core.invoke
    listen: null,     // tests: stands in for window.__TAURI__.event.listen
    info: null,       // monitor_info's answer
    status: new Map(),  // item key -> its latest status
    hist: new Map(),    // item key -> { at, samples, kept }
    listening: false,
    planTimer: 0,
    sent: '',           // the last plan sent, as JSON
    macs: null,         // this PC's MACs (to find it on the map), once
    dots: '',           // the dots last drawn, to redraw only on a change
    redraw: 0
};
const el = (id) => document.getElementById(id);
const PLAN_DELAY_MS = 800;
const HISTORY_FRESH_MS = 60000;
const BUCKET_MS = 5 * 60000;
const DAY_MS = 24 * 3600000;

function ckInvoke(cmd, args) {
    if (_ck.invoke) return Promise.resolve().then(() => _ck.invoke(cmd, args || {}));
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
function ckListen(name, cb) {
    if (_ck.listen) return Promise.resolve(_ck.listen(name, cb));
    const ev = window.__TAURI__ && window.__TAURI__.event;
    if (!ev || typeof ev.listen !== 'function') return Promise.resolve(() => {});
    return ev.listen(name, cb);
}
const hasHost = () => !!_ck.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');

const PROTO_LABELS = { ping: 'Ping', tcp: 'TCP', http: 'HTTP', https: 'HTTPS', dns: 'DNS', smtp: 'SMTP', dicom: 'DICOM C-ECHO', ntp: 'NTP', rtsp: 'RTSP', sip: 'SIP', mllp: 'HL7 MLLP', ipp: 'IPP', imap: 'IMAP', pop: 'POP', tls: 'TLS certificate' };
const protoLabel = (p) => PROTO_LABELS[p] || p;
const INTERVALS = [30, 60, 120, 300, 600, 900];
const RETENTIONS = [0, 30, 90, 180, 360, 720, 3650];

function timeText(ms) {
    const lang = window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined;
    try { return new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(ms).toTimeString().slice(0, 5); }
}
function dateTimeText(ms) {
    const lang = window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined;
    const sameDay = new Date(ms).toDateString() === new Date().toDateString();
    if (sameDay) return timeText(ms);
    try { return new Date(ms).toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(ms).toString().slice(0, 21); }
}
const msText = (v) => (v == null ? '' : v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v)));
const pctText = (v) => {
    const p = v * 100;
    return (p >= 99.95 && p < 100 ? '99.9' : p.toFixed(p >= 99 || p === 0 ? 1 : p >= 10 ? 1 : 2).replace(/\.0$/, '')) + ' %';
};
// The Every list: the usual ones, and the check's own when a file brought
// another (45 s shows as 45 s, not as the first choice).
const intervalChoices = (cur) => (INTERVALS.includes(cur) ? INTERVALS : INTERVALS.concat([cur]).sort((a, b) => a - b));
const intervalText = (s) => (s < 60 || s % 60 ? t('{n} s', { n: s }) : t('{n} min', { n: s / 60 }));

// ---- Where things are ----

// Is the open network the one this PC monitors (and is it on)?
const monitorOn = () => !!(_ck.info && _ck.info.on);
const watching = () => monitorOn() && !!_ck.info.networkId && _ck.info.networkId === state.libraryId;
// The states come only to the Topo that runs the monitor: a second Topo
// on this PC shows none (no dots, no "not checked yet"); what it sets still
// reaches the running one through the files (D240).
const live = () => watching() && !_ck.info.elsewhere;

// This PC on the map: the device holding one of its MACs (D166), or null.
function meOnMap(nodes) {
    if (!_ck.macs || !_ck.macs.size) return null;
    const hit = nodes.find((n) => n && (n.interfaces || []).some((i) => i && _ck.macs.has(normMac(i.mac))));
    return hit ? hit.id : null;
}
function readMacs() {
    if (_ck.macs) return Promise.resolve(_ck.macs);
    return ckInvoke('this_computer').then((info) => {
        _ck.macs = new Set((info && info.interfaces || []).map((i) => normMac(i.mac)).filter((m) => m.length === 12));
        return _ck.macs;
    }).catch(() => { _ck.macs = new Set(); return _ck.macs; });
}

// The upstream chains (D161, D228): for each target device, the devices
// between this PC and it, nearest to this PC first, by the cables (VPN
// tunnels and retired devices carry nothing). With this PC on the map, the
// path from it; without, the path from the target's own router (the
// nearest routing device, not the Internet cloud), which is where this PC
// reaches it from. A routing device itself then has no chain (D237): a
// search with no direction would hand it a neighbouring router, maybe one
// behind it. -> Map(target id -> [ids]).
function monitorChains(nodes, links, meId, targetIds) {
    const byId = new Map(nodes.filter(Boolean).map((n) => [n.id, n]));
    const adj = new Map();
    const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
    (links || []).forEach((l) => {
        if (!l || l.medium === 'vpn' || l.source === l.target) return;
        const a = byId.get(l.source), b = byId.get(l.target);
        if (!a || !b) return;
        add(a.id, b.id); add(b.id, a.id);
    });
    adj.forEach((list) => list.sort());
    const passes = (id) => { const n = byId.get(id); return !!n && !isRetired(n); };
    const bfs = (from, stop) => {
        const parent = new Map([[from, null]]);
        const queue = [from];
        while (queue.length) {
            const id = queue.shift();
            if (stop && id !== from && stop(id)) return { parent, found: id };
            if (id !== from && !passes(id)) continue;
            (adj.get(id) || []).forEach((nx) => { if (!parent.has(nx)) { parent.set(nx, id); queue.push(nx); } });
        }
        return { parent, found: null };
    };
    const out = new Map();
    if (meId && byId.has(meId)) {
        const { parent } = bfs(meId, null);
        targetIds.forEach((id) => {
            const chain = [];
            if (parent.has(id)) for (let p = parent.get(id); p && p !== meId; p = parent.get(p)) chain.unshift(p);
            out.set(id, chain);
        });
        return out;
    }
    const isGate = (id) => { const n = byId.get(id); return !!n && !isRetired(n) && n.type !== 'cloud' && isRoutingDevice(n.type); };
    targetIds.forEach((id) => {
        if (isGate(id)) { out.set(id, []); return; }
        const { parent, found } = bfs(id, isGate);
        const chain = [];
        // From the router back to the target: the router first.
        for (let p = found; p && p !== id; p = parent.get(p)) chain.push(p);
        out.set(id, chain);
    });
    return out;
}

// The groups a device is in, innermost first.
function groupIdsOf(node, groups) {
    const g = node && node.group ? groupById(node.group, groups) : null;
    return g ? groupChain(g, groups).map((x) => x.id).reverse() : [];
}

// The address a check asks: its own pick among the device's addresses, else
// the device's first.
function checkHost(node, c) {
    const ips = getValidIps(node).map((p) => p.ip.toString());
    if (c.ip && ips.includes(c.ip)) return c.ip;
    return ips[0] || '';
}
// The TCP port a ping asks where this PC may not ping: its own, else the
// first single TCP port the device documents.
function fallbackPort(node, c) {
    if (c.port) return c.port;
    const e = parsePortExpression(node.ports || '').find((x) => (!x.proto || x.proto === 'tcp') && x.start === x.end);
    return e ? e.start : 0;
}
const inService = (n) => !!n && n.status !== 'retired' && n.status !== 'planned';
// SMTP is checked only where the device documents it (D155, D241): the
// check's port (25 unless set) among its Allowed ports, over TCP.
const SMTP_PORTS = [25, 587, 465];
const documentsPort = (node, port) => parsePortExpression(node.ports || '')
    .some((e) => (!e.proto || e.proto === 'tcp') && port >= e.start && port <= e.end);
const smtpPortsOf = (node) => SMTP_PORTS.filter((p) => documentsPort(node, p));
const smtpDocumented = (node, c) => documentsPort(node, checkPortOf(c));

// The plan for a document's lists: { networkId, networkName, items }.
function monitorPlan(doc, opts = {}) {
    const nodes = doc.nodes || [], links = doc.links || [], groups = doc.groups || [];
    const targets = nodes.filter((n) => inService(n) && Array.isArray(n.checks) && n.checks.length);
    // The watched addresses (v20, D371): each checked one, reached through
    // a device on the map (its chain, then that device) or straight.
    const watched = (doc.watch || []).filter((w) => w && w.address && Array.isArray(w.checks) && w.checks.length);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const viaOf = (w) => (w.via && byId.has(w.via) && inService(byId.get(w.via)) ? w.via : null);
    const chainIds = targets.map((n) => n.id).concat(watched.map(viaOf).filter(Boolean));
    const chains = monitorChains(nodes, links, opts.me || null, [...new Set(chainIds)]);
    const items = [];
    targets.forEach((n) => {
        const gids = groupIdsOf(n, groups);
        n.checks.forEach((c) => {
            if (c.proto === 'smtp' && !smtpDocumented(n, c)) return;
            // A site monitor checks what it was given (D150, step 7h).
            if (opts.assigned && !opts.assigned(n, c)) return;
            items.push({
                key: `${n.id}/${c.id}`, nodeId: n.id, name: `${n.name || ''} · ${protoLabel(c.proto)}`, nodeName: n.name || n.id,
                spec: {
                    proto: c.proto, host: checkHost(n, c), port: c.proto === 'ping' ? 0 : (c.port || 0),
                    fallbackPort: c.proto === 'ping' ? fallbackPort(n, c) : 0,
                    path: c.path || '', name: c.name || '', starttls: c.starttls === true,
                    calledAe: c.calledAe || '', callingAe: c.callingAe || '',
                    tls: c.tls || '', transport: c.transport || ''
                },
                intervalS: c.interval || CHECK_INTERVAL_DEFAULT, slowMs: c.slowMs || 0,
                chain: chains.get(n.id) || [], groups: gids, recordOnly: nodeRecordsOnly(n)
            });
        });
    });
    watched.forEach((w) => {
        const wid = watchItemId(w.id);
        const as = { id: wid, name: watchLabel(w), group: w.group, checks: w.checks };
        const gids = w.group ? groupIdsOf(as, groups) : [];
        const via = viaOf(w);
        const chain = via ? (chains.get(via) || []).concat([via]) : [];
        w.checks.forEach((c) => {
            if (opts.assigned && !opts.assigned(as, c)) return;
            items.push({
                key: `${wid}/${c.id}`, nodeId: wid, name: `${watchLabel(w)} · ${protoLabel(c.proto)}`, nodeName: watchLabel(w),
                spec: {
                    proto: c.proto, host: w.address, port: c.proto === 'ping' ? 0 : (c.port || 0),
                    fallbackPort: c.proto === 'ping' ? (c.port || 0) : 0,
                    path: c.path || '', name: c.name || '', starttls: c.starttls === true,
                    calledAe: c.calledAe || '', callingAe: c.callingAe || '',
                    tls: c.tls || '', transport: c.transport || ''
                },
                intervalS: c.interval || CHECK_INTERVAL_DEFAULT, slowMs: c.slowMs || 0,
                chain, groups: gids, recordOnly: watchRecordsOnly(w)
            });
        });
    });
    return { networkId: opts.networkId || '', networkName: opts.networkName || '', items };
}

const networkName = () => (typeof docDisplayName === 'function' && docDisplayName()) || t('Untitled network');
// When this PC is the site's monitor (js/monitors.js), the blocks it was
// given; otherwise every block (a PC with no server checks them all).
function assignedNow() {
    const M = window.TopoMonitors;
    const link = M && M.state.link;
    if (!link || !link.enrolled) return null;
    const site = M.siteOfOpen();
    if (site && link.site !== site) return null;
    return (n, c) => M.assigned(n, c, link);
}

// The open network's plan, sent when it changed. `force`: even if the same.
function pushPlan(force) {
    if (!hasHost() || !watching()) return Promise.resolve(false);
    return readMacs().then(() => {
        if (!watching()) return false;
        const plan = monitorPlan({ nodes: state.nodes, links: state.links, groups: state.groups, watch: state.watch },
            { me: meOnMap(state.nodes), networkId: state.libraryId, networkName: networkName(), assigned: assignedNow() });
        const json = JSON.stringify(plan);
        if (!force && json === _ck.sent) return false;
        _ck.sent = json;
        return ckInvoke('monitor_plan', { plan }).then((info) => { if (info) _ck.info = info; renderMonitorSettings(); return true; });
    }).catch((e) => { console.warn('Topo: the checks could not be sent to the monitor:', e); return false; });
}
// Every redraw of the map asks; the plan is worked out a moment later, once.
function checksDocChanged() {
    // Issue records waiting for this network are folded (js/issues.js).
    if (typeof issuesDocChanged === 'function') issuesDocChanged();
    // The site monitors' records, on a server's site (js/monitors.js).
    if (window.TopoMonitors) TopoMonitors.maybeRefresh();
    // A check added during a visit joins the visit monitor (step 7i).
    if (window.TopoVisitMonitor) TopoVisitMonitor.docChanged();
    // The Watched tab (js/watch.js) follows the document.
    if (window.TopoWatch) TopoWatch.docChanged();
    if (!hasHost() || !monitorOn()) return;
    clearTimeout(_ck.planTimer);
    _ck.planTimer = setTimeout(() => { pushPlan(false); }, PLAN_DELAY_MS);
}

// ---- States ----

// This PC's states while it monitors the open network; otherwise, on a
// server's site, the site monitors' (step 7h, js/monitors.js).
const serverMode = () => !live() && !!window.TopoMonitors && !!TopoMonitors.siteOfOpen();
function serverStatus(node, key) { return serverMode() ? TopoMonitors.combinedStatus(node).find((x) => x.key === key) || null : null; }
// While "Monitor during this visit" runs on the open network (step 7i,
// js/visitmonitor.js), the provider's own checks show its states.
const visitStatus = (key) => (window.TopoVisitMonitor ? TopoVisitMonitor.statusOf(key) : null);
const visitLive = () => !!(window.TopoVisitMonitor && TopoVisitMonitor.active());
const statusOf = (node, key) => visitStatus(key) || (serverMode() ? serverStatus(node, key) : _ck.status.get(key));
const statusesOf = (node) => (node && Array.isArray(node.checks) ? node.checks.map((c) => statusOf(node, `${node.id}/${c.id}`)).filter(Boolean) : []);
// How a status reads in one word: up, slow, down, cause (down because of a
// device upstream), flapping, quiet, unknown.
function look(s) {
    if (!s) return 'unknown';
    if (s.split) return 'split';
    if (s.state === 'quiet') return 'quiet';
    if (s.state === 'down') return s.cause ? 'cause' : 'down';
    if (s.flapping) return 'flapping';
    if (s.state === 'up') return s.slow ? 'slow' : 'up';
    return 'unknown';
}
const LOOK_RANK = { down: 8, split: 7, cause: 6, flapping: 5, slow: 4, unknown: 3, quiet: 2, up: 1 };
const LOOK_FILL = { up: '#16a34a', slow: '#d97706', down: '#dc2626', split: '#9333ea', cause: '#c2410c', flapping: '#db2777', quiet: '#64748b', unknown: '#94a3b8' };
const LOOK_WORDS = {
    up: 'Answering', slow: 'Slow', down: 'Not answering', cause: 'Not answering because of a device upstream',
    split: 'Not answering from one monitor, answering from another',
    flapping: 'Flapping', quiet: 'Quiet (maintenance)', unknown: 'Not known yet'
};
function nodeLook(node) {
    const ss = statusesOf(node);
    if (!ss.length) return null;
    return ss.map(look).sort((a, b) => LOOK_RANK[b] - LOOK_RANK[a])[0];
}

// The dot on the map (drawCanvas, js/ui.js): the worst of the device's
// checks, top centre. Only for the network this PC monitors, in the app.
function checkMarkEl(node) {
    if (!node || !Array.isArray(node.checks) || !node.checks.length) return null;
    if (!(hasHost() && live()) && !(serverMode() && statusesOf(node).length) && !(visitLive() && statusesOf(node).length)) return null;
    const lk = nodeLook(node) || 'unknown';
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('transform', 'translate(0, -27)');
    g.setAttribute('class', 'node-status ck-' + lk);
    g.setAttribute('data-look', lk);
    const disc = document.createElementNS(ns, 'circle');
    disc.setAttribute('r', '5.5');
    if (lk === 'unknown') { disc.setAttribute('fill', '#ffffff'); disc.setAttribute('stroke', LOOK_FILL.unknown); disc.setAttribute('stroke-width', '2'); }
    else { disc.setAttribute('fill', LOOK_FILL[lk]); disc.setAttribute('stroke', '#ffffff'); disc.setAttribute('stroke-width', '1.5'); }
    g.appendChild(disc);
    if (lk === 'flapping') {
        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('r', '8.5'); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', LOOK_FILL.flapping);
        ring.setAttribute('stroke-width', '1.2'); ring.setAttribute('stroke-dasharray', '2 2');
        g.appendChild(ring);
    }
    const tip = document.createElementNS(ns, 'title');
    tip.textContent = statusesOf(node).map((s) => {
        const c = node.checks.find((x) => `${node.id}/${x.id}` === s.key);
        return `${c ? protoLabel(c.proto) : ''}: ${nowText(s, node)}`;
    }).join('\n') || t(LOOK_WORDS.unknown);
    g.appendChild(tip);
    return g;
}

// What one check says now, in a line.
function nowText(s, node) {
    if (!s) return t('Not checked yet');
    if (s.split && window.TopoMonitors) return TopoMonitors.splitText(s.split);
    const parts = [];
    const lk = look(s);
    if (lk === 'quiet' && s.expected) parts.push(t('Expected (maintenance): quiet until it answers again'));
    else if (lk === 'quiet') parts.push(t('Quiet until {time}', { time: dateTimeText(s.quietUntil) }));
    else if (lk === 'up' || lk === 'slow' || (lk === 'flapping' && s.state === 'up')) {
        parts.push(s.rttMs != null ? t('Answering · {ms} ms', { ms: msText(s.rttMs) }) : t('Answering'));
        if (s.slow) parts.push(t('Slow'));
        const pr = printerOf(s);
        if (pr) parts.push(pr);
    } else if (s.state === 'down') {
        const cause = s.cause ? getNode(s.cause) : null;
        parts.push(cause ? t('Not answering since {time}, because {name} is not answering', { time: dateTimeText(s.since), name: cause.name || cause.id })
            : t('Not answering since {time}', { time: dateTimeText(s.since) }));
        if (s.status === 'resolve') parts.push(t('The name does not resolve from this PC.'));
        else if (s.status) parts.push(s.status);
    } else {
        const why = { 'no-icmp': 'This PC may not ping, and the device documents no TCP port to ask instead.', resolve: 'The name does not resolve from this PC.',
            address: 'The device has no address to ask.', 'no-name': 'Give the name to ask.', 'no-port': 'Give the port to ask.' }[s.status];
        parts.push(why ? t(why) : s.checked ? t('Answering again: not sure yet') : t('Not checked yet'));
    }
    if (s.flapping) parts.push(t('Flapping: 4 changes in 30 min'));
    if (s.via === 'tcp' && !s.status.startsWith('no-')) parts.push(t('TCP, not ping'));
    if (s.offsetMs != null && Number.isFinite(s.offsetMs)) parts.push(offsetText(s.offsetMs));
    if (s.certNotAfter) {
        const days = Math.floor((s.certNotAfter * 1000 - Date.now()) / DAY_MS);
        parts.push(days < 0 ? t('The certificate ended {n} days ago', { n: -days })
            : tn(days, 'The certificate ends in {n} day', 'The certificate ends in {n} days'));
    }
    return parts.join(' · ');
}
const certWarn = (s) => !!(s && s.certNotAfter && (s.certNotAfter * 1000 - Date.now()) / DAY_MS <= 14);
// NTP (step 7k, D155): the clock's offset, a warning above 1 s either way.
const NTP_WARN_MS = 1000;
const offsetWarn = (s) => !!(s && s.offsetMs != null && Math.abs(s.offsetMs) > NTP_WARN_MS);
function offsetText(ms) {
    if (Math.abs(ms) > NTP_WARN_MS) {
        const lang = window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined;
        const sec = (Math.round(Math.abs(ms) / 100) / 10).toLocaleString(lang);
        return ms > 0 ? t('This PC\'s clock is {s} s behind this server', { s: sec }) : t('This PC\'s clock is {s} s ahead of this server', { s: sec });
    }
    return t('Clock offset {ms} ms', { ms: (ms > 0 ? '+' : '') + msText(ms) });
}
// IPP (step 7k): the printer's state from the status ("0000 stopped
// media-empty-error"); its reasons stay the printer's own keywords.
const PRINTER_WORDS = { idle: 'Printer idle', processing: 'Printer printing', stopped: 'Printer stopped' };
function printerOf(s) {
    const m = /^[0-9A-F]{4} (idle|processing|stopped)(?: ([a-z0-9,-]+))?$/.exec((s && s.status) || '');
    if (!m) return '';
    return t(PRINTER_WORDS[m[1]]) + (m[2] ? ' (' + m[2].split(',').join(', ') + ')' : '');
}
const warnOf = (s) => certWarn(s) || offsetWarn(s) || /^[0-9A-F]{4} stopped/.test((s && s.status) || '');

// A change from the app: kept, and the map and the open panel follow.
function onStatuses(list) {
    (Array.isArray(list) ? list : []).forEach((s) => { if (s && s.key) _ck.status.set(s.key, s); });
    const dots = state.nodes.map((n) => (Array.isArray(n.checks) && n.checks.length ? n.id + ':' + (nodeLook(n) || '') : '')).join('|');
    if (dots !== _ck.dots) {
        _ck.dots = dots;
        clearTimeout(_ck.redraw);
        _ck.redraw = setTimeout(() => { if (typeof renderCanvasOnly === 'function') renderCanvasOnly(); }, 250);
    }
    refreshOpenSection(list);
    if (window.TopoWatch) TopoWatch.statusesChanged();
    renderMonitorSettingsStatus();
}

// ---- The app's answers ----

// The words the app uses with no page to ask: the tray's, and the alarm's
// notifications and card (step 7g), in the page's language.
function labels() {
    const lang = window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : 'en';
    const by = window.TopoIssues ? TopoIssues.whoActs() : '';
    return { open: t('Open Topo'), quit: t('Quit Topo'), tip: t('Topo: monitoring'), tipDown: t('Topo: {n} not answering', { n: '{n}' }),
        lang, by,
        alarm: t('{name} is not answering', { name: '{name}' }),
        alarmBehind: t('{name} and {n} devices behind it are not answering', { name: '{name}', n: '{n}' }),
        alarmBehindOne: t('{name} and 1 device behind it are not answering', { name: '{name}' }),
        recovered: t('{name} is answering again (down {min} min)', { name: '{name}', min: '{min}' }),
        drill: t('Test of the alarm: nothing is down.'),
        stale: t('Monitor at {name} stopped reporting', { name: '{name}' }) };
}
function refreshInfo() {
    if (!hasHost()) return Promise.resolve(null);
    return ckInvoke('monitor_info').then((info) => {
        _ck.info = info || null;
        if (!monitorOn()) { _ck.status.clear(); return info; }
        if (!_ck.listening) {
            _ck.listening = true;
            ckListen('topo-monitor', (e) => onStatuses(e && e.payload)).catch(() => { _ck.listening = false; });
        }
        return ckInvoke('monitor_status').then((list) => { _ck.status.clear(); onStatuses(list); return info; });
    }).then((info) => { renderMonitorSettings(); rerenderSelected(); pushPlan(false); return info; })
        .catch((e) => { console.warn('Topo: the monitor did not answer:', e); return null; });
}
function setMonitor(args) {
    return ckInvoke('monitor_set', { args: Object.assign({ labels: labels() }, args) }).then((info) => {
        _ck.info = info;
        return refreshInfo();
    });
}

// ---- The device panel: Answer checks ----

function rerenderSelected() {
    const n = state.selectedType === 'node' && state.selectedId ? getNode(state.selectedId) : null;
    renderCheckSection(n);
}
let _sectionNode = null;
function renderCheckSection(node) {
    const box = el('checkGroup');
    if (!box) return;
    // On a server's site any signed-in page shows what its monitors say
    // (read only, step 7h); the app shows the whole section.
    const show = !!node && !isReduced() && (hasHost() || (serverMode() && Array.isArray(node.checks) && node.checks.length > 0));
    box.hidden = !show;
    _sectionNode = show ? node.id : null;
    if (!show) { el('checkBody').innerHTML = ''; el('checkSummary').textContent = ''; return; }
    const checks = Array.isArray(node.checks) ? node.checks : [];
    const lk = live() || serverMode() ? nodeLook(node) : null;
    el('checkSummary').textContent = checks.length ? `${checks.length} · ${lk ? t(LOOK_WORDS[lk]) : protoLabel(checks[0].proto)}` : '';
    if (!box.open) { el('checkBody').innerHTML = ''; return; }
    drawSection(node);
}

// The website's (or an app's not monitoring it) read-only section: each
// check as every site monitor sees it (D150: "down from A, up from B").
function drawServerSection(node) {
    const body = el('checkBody');
    const all = window.TopoMonitors ? TopoMonitors.serverStatusesOf(node) : [];
    let html = `<p class="rail-note ck-note ck-rule">${escapeHtml(t(NOT_CHECKED_RULE))}</p><p class="rail-note ck-note">${escapeHtml(t('As the site\'s monitors see it:'))}</p>`;
    (node.checks || []).forEach((c) => {
        const key = `${node.id}/${c.id}`;
        const comb = serverStatus(node, key);
        const lk = comb ? look(comb) : 'unknown';
        html += `<div class="ck-card" data-key="${escapeHtml(key)}"><div class="ck-head"><span class="ck-dot ck-${lk}" aria-hidden="true"></span><b>${escapeHtml(protoLabel(c.proto))}</b>`
            + `<span class="ck-port mono">${escapeHtml(checkHost(node, c) || '')}${c.proto !== 'ping' && checkPortOf(c) ? ':' + checkPortOf(c) : ''}</span></div>`;
        if (comb && comb.split) html += `<p class="ck-now ck-now-split">${escapeHtml(TopoMonitors.splitText(comb.split))}</p>`;
        const mine = all.filter((x) => x.s.key === key);
        if (!mine.length) html += `<p class="ck-now">${escapeHtml(t('Not checked yet'))}</p>`;
        mine.forEach((x) => {
            html += `<p class="ck-now ck-now-${look(x.s)}"><b>${escapeHtml(x.name)}</b>: ${escapeHtml(x.stale ? t('Stopped reporting') : nowText(Object.assign({}, x.s, { split: null }), node))}</p>`;
        });
        html += '</div>';
    });
    if ((node.checks || []).length && ownerOfSite()) html += quietHtml(node);
    html += reportLinkHtml(node);
    body.innerHTML = html;
}
// The device's full report: availability, response times and outages over a
// period (js/reports.js, step 7j), wherever the section shows.
function reportLinkHtml(node) {
    if (!window.TopoReports || !(node.checks || []).length) return '';
    return `<button type="button" class="btn ck-report" data-ck="report">${escapeHtml(t('📈 Full report…'))}</button>`;
}

// On a server's site, an owner's quiet window goes to the site's monitors
// as a signed record (D227, D265), from the website too.
const siteOpen = () => (window.TopoMonitors ? TopoMonitors.siteOfOpen() : null);
const ownerOfSite = () => { const s = siteOpen(); return !!s && !state.readOnly && TopoMonitors.isOwnerOf(s); };
// This PC's quiet windows and the site's, the later of each.
function quietNow() {
    const mine = (_ck.info && _ck.info.quiet) || {};
    const site = window.TopoMonitors ? TopoMonitors.siteQuiet(siteOpen()) : { site: 0, nodes: {}, groups: {} };
    const max = (a, b) => { const o = Object.assign({}, a || {}); Object.keys(b || {}).forEach((k) => { o[k] = Math.max(o[k] || 0, b[k]); }); return o; };
    return { site: Math.max(mine.site || 0, site.site || 0), nodes: max(mine.nodes, site.nodes), groups: max(mine.groups, site.groups) };
}
function sendQuiet(scope, id, until) {
    const site = siteOpen();
    if (!site || !ownerOfSite()) return Promise.resolve(false);
    return TopoMonitors.pushQuiet(site, scope, id, until).catch((err) => {
        showToast(t('The quiet window did not reach the site\'s monitors: {error}', { error: String(err && err.message || err) }), 'warn');
        return false;
    });
}

// The owner's rule (2026-11-12, D380): checking is opt-in; what is not
// checked has no state at all, never "down" or "unknown".
const NOT_CHECKED_RULE = 'Topo checks only what you ask it to. Anything not checked has no state.';
function drawSection(node) {
    if (!hasHost()) { drawServerSection(node); return; }
    const body = el('checkBody');
    const checks = Array.isArray(node.checks) ? node.checks : [];
    const ro = !!state.readOnly;
    let html = `<p class="rail-note ck-note ck-rule">${escapeHtml(t(NOT_CHECKED_RULE))}</p>`;
    if (!monitorOn()) {
        html += `<p class="rail-note ck-note">${escapeHtml(t('Monitor from this PC is off: these checks run once it is on, in Settings.'))}</p>`;
        html += `<button type="button" class="btn ck-settings" data-ck="settings">${escapeHtml(t('Settings…'))}</button>`;
    } else if (_ck.info.elsewhere) {
        html += `<p class="rail-note ck-note">${escapeHtml(t('The monitor runs in the other Topo window on this PC.'))}</p>`;
    } else if (!watching()) {
        html += `<p class="rail-note ck-note">${escapeHtml(t('This PC monitors another network: {name}.', { name: _ck.info.networkName || '' }))}</p>`;
    }
    checks.forEach((c) => { html += checkCardHtml(node, c, ro); });
    if (!checks.length) html += `<p class="rail-none">${escapeHtml(t('No answer checks. Add one to ask this device "are you answering?" from a PC that monitors.'))}</p>`;
    if (!ro && checks.length < CHECKS_MAX) html += `<button type="button" class="btn ck-add" data-ck="add">${escapeHtml(t('＋ Add a check'))}</button>`;
    // The availability target and the quiet window.
    html += `<div class="ck-row"><label class="prop-lbl" for="ckTarget">${escapeHtml(t('Availability target (%)'))}</label>`
        + `<input type="text" id="ckTarget" class="input mono ck-target" inputmode="decimal" maxlength="7" autocomplete="off" placeholder="99.5" value="${escapeHtml(node.target != null ? String(node.target) : '')}"${ro ? ' disabled' : ''}></div>`;
    if (checks.length && (monitorOn() || ownerOfSite())) html += quietHtml(node);
    html += reportLinkHtml(node);
    body.innerHTML = html;
    checks.forEach((c) => loadHistory(node, c));
}

// What a check asks and never does, said under the protocols of step 7k
// (D155, D322).
const CHECK_NOTES = {
    ntp: 'One time request: the server\'s stratum and how far this PC\'s clock is from it (a warning above 1 s).',
    rtsp: 'One OPTIONS request: the status code only. No video is opened.',
    sip: 'One OPTIONS request: the status code only. Never a call or a registration.',
    mllp: 'Connects and leaves: no message is sent, so nothing can reach the RIS.',
    ipp: 'Asks only the printer\'s state and its reasons. Never a print job.',
    imap: 'Reads the greeting, then LOGOUT. Never a login; with encryption, also the certificate\'s end date.',
    pop: 'Reads the greeting, then QUIT. Never a login; with encryption, also the certificate\'s end date.',
    // D375 (step 8e): LDAPS, RDP, a PACS's DICOM TLS, any port.
    tls: 'One handshake on this port: the certificate\'s end date (a warning 14 days before). Nothing is sent after it.'
};

function checkCardHtml(node, c, ro) {
    const key = `${node.id}/${c.id}`;
    const s = live() ? _ck.status.get(key) : null;
    const lk = s ? look(s) : 'unknown';
    const id = (k) => `ck_${k}_${c.id}`;
    const dis = ro ? ' disabled' : '';
    const opt = (v, label, cur) => `<option value="${escapeHtml(String(v))}"${String(v) === String(cur) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const ips = node.address ? [] : getValidIps(node).map((p) => p.ip.toString());
    let h = `<div class="ck-card" data-key="${escapeHtml(key)}" data-check="${escapeHtml(c.id)}">`;
    h += `<div class="ck-head"><span class="ck-dot ck-${lk}" aria-hidden="true"></span><b>${escapeHtml(protoLabel(c.proto))}</b>`
        + `<span class="ck-port mono">${escapeHtml(node.address || checkHost(node, c) || '')}${c.proto !== 'ping' && checkPortOf(c) ? ':' + checkPortOf(c) : ''}</span>`
        + (ro ? '' : `<button type="button" class="if-del ck-del" data-ck="del" title="${escapeHtml(t('Remove this check'))}" aria-label="${escapeHtml(t('Remove this check'))}">✕</button>`) + '</div>';
    h += `<p class="ck-now ck-now-${lk}${warnOf(s) ? ' ck-warn' : ''}" aria-live="polite">${escapeHtml(live() ? nowText(s, node) : '')}</p>`;
    h += '<div class="prop-grid ck-grid">';
    h += `<div><label class="prop-lbl" for="${id('proto')}">${escapeHtml(t('Asks'))}</label><select id="${id('proto')}" class="select" data-f="proto"${dis}>`
        + CHECK_PROTOCOLS.filter((p) => p !== 'smtp' || c.proto === 'smtp' || !!node.address || smtpPortsOf(node).length)
            .map((p) => opt(p, protoLabel(p), c.proto)).join('') + '</select></div>';
    h += `<div><label class="prop-lbl" for="${id('port')}">${escapeHtml(c.proto === 'ping' ? t('TCP port if this PC may not ping') : t('Port'))}</label>`
        + `<input type="text" id="${id('port')}" class="input mono" inputmode="numeric" maxlength="5" autocomplete="off" data-f="port" placeholder="${escapeHtml(String((c.tls === 'implicit' && CHECK_TLS_PORTS[c.proto]) || CHECK_PORTS[c.proto] || ''))}" value="${escapeHtml(c.port ? String(c.port) : '')}"${dis}></div>`;
    if (ips.length > 1) {
        h += `<div><label class="prop-lbl" for="${id('ip')}">${escapeHtml(t('Address'))}</label><select id="${id('ip')}" class="select mono" data-f="ip"${dis}>`
            + ips.map((ip, i) => opt(i === 0 ? '' : ip, ip, c.ip && ips.includes(c.ip) ? c.ip : '')).join('') + '</select></div>';
    }
    if (c.proto === 'http' || c.proto === 'https') {
        h += `<div><label class="prop-lbl" for="${id('path')}">${escapeHtml(t('Page'))}</label><input type="text" id="${id('path')}" class="input mono" maxlength="512" autocomplete="off" spellcheck="false" data-f="path" placeholder="/" value="${escapeHtml(c.path || '')}"${dis}></div>`;
    }
    if (c.proto === 'rtsp' || c.proto === 'ipp') {
        const ipp = c.proto === 'ipp';
        h += `<div><label class="prop-lbl" for="${id('path')}">${escapeHtml(t(ipp ? 'Printer path' : 'Stream path'))}</label><input type="text" id="${id('path')}" class="input mono" maxlength="512" autocomplete="off" spellcheck="false" data-f="path" placeholder="${ipp ? '/ipp/print' : '/'}" value="${escapeHtml(c.path || '')}"${dis}></div>`;
    }
    if (c.proto === 'sip') {
        h += `<div><label class="prop-lbl" for="${id('transport')}">${escapeHtml(t('Over'))}</label><select id="${id('transport')}" class="select" data-f="transport"${dis}>`
            + opt('', 'UDP', c.transport || '') + opt('tcp', 'TCP', c.transport || '') + '</select></div>';
    }
    if (c.proto === 'imap' || c.proto === 'pop') {
        h += `<div><label class="prop-lbl" for="${id('tls')}">${escapeHtml(t('Encryption'))}</label><select id="${id('tls')}" class="select" data-f="tls"${dis}>`
            + opt('', t('None'), c.tls || '') + opt('starttls', c.proto === 'pop' ? 'STLS' : 'STARTTLS', c.tls || '') + opt('implicit', t('TLS from the start'), c.tls || '') + '</select></div>';
    }
    if (c.proto === 'dns') {
        h += `<div><label class="prop-lbl" for="${id('name')}">${escapeHtml(t('Name to ask'))}</label><input type="text" id="${id('name')}" class="input mono" maxlength="253" autocomplete="off" spellcheck="false" data-f="name" placeholder="pacs.clinic.local" value="${escapeHtml(c.name || '')}"${dis}></div>`;
    }
    if (c.proto === 'dicom') {
        h += `<div><label class="prop-lbl" for="${id('called')}">${escapeHtml(t('Called AE title'))}</label><input type="text" id="${id('called')}" class="input mono" maxlength="16" autocomplete="off" spellcheck="false" data-f="calledAe" placeholder="ANY-SCP" value="${escapeHtml(c.calledAe || '')}"${dis}></div>`;
        h += `<div><label class="prop-lbl" for="${id('calling')}">${escapeHtml(t('Calling AE title'))}</label><input type="text" id="${id('calling')}" class="input mono" maxlength="16" autocomplete="off" spellcheck="false" data-f="callingAe" placeholder="TOPO" value="${escapeHtml(c.callingAe || '')}"${dis}></div>`;
    }
    h += `<div><label class="prop-lbl" for="${id('every')}">${escapeHtml(t('Every'))}</label><select id="${id('every')}" class="select" data-f="interval"${dis}>`
        + intervalChoices(c.interval || CHECK_INTERVAL_DEFAULT).map((s2) => opt(s2, intervalText(s2), c.interval || CHECK_INTERVAL_DEFAULT)).join('') + '</select></div>';
    h += `<div><label class="prop-lbl" for="${id('slow')}">${escapeHtml(t('Slow above (ms)'))}</label><input type="text" id="${id('slow')}" class="input mono" inputmode="numeric" maxlength="6" autocomplete="off" data-f="slowMs" placeholder="—" value="${escapeHtml(c.slowMs ? String(c.slowMs) : '')}"${dis}></div>`;
    h += '</div>';
    h += monitorsChoiceHtml(c, dis);
    if (c.proto === 'smtp' && !node.address && !smtpDocumented(node, c)) {
        h += '<p class="rail-note ck-note ck-warn">' + escapeHtml(t('This device does not document SMTP on port {port} (Allowed ports), so this check is not run.', { port: checkPortOf(c) })) + '</p>';
    }
    const note = CHECK_NOTES[c.proto];
    if (note) h += `<p class="rail-note ck-note">${escapeHtml(t(note))}</p>`;
    if (c.proto === 'smtp') {
        h += `<label class="ck-tick"><input type="checkbox" data-f="starttls"${c.starttls ? ' checked' : ''}${dis}> <span>${escapeHtml(t('STARTTLS, to read the certificate\'s end date (never a login, never a message)'))}</span></label>`;
    }
    h += `<div class="ck-day" data-day="${escapeHtml(key)}"></div>`;
    h += '</div>';
    return h;
}

// Which of the site's monitors check this block (D150): those whose groups
// hold the device (as shipped), or the ones picked here, two of them to
// compare ("down from A, up from B"). Only on a server's site with monitors.
function monitorsChoiceHtml(c, dis) {
    const M = window.TopoMonitors;
    const site = M && M.siteOfOpen();
    const mons = site ? M.siteState(site).monitors : [];
    if (!mons.length) return '';
    const picked = Array.isArray(c.monitors) ? c.monitors : [];
    let h = `<fieldset class="ck-mons"><legend class="prop-lbl">${escapeHtml(t('Checked by'))}</legend>`;
    h += `<p class="dlg-dim ck-note">${escapeHtml(picked.length ? t('Only the monitors ticked. Tick two to compare where it answers from.') : t('The monitors whose groups hold this device. Tick monitors to choose.'))}</p>`;
    mons.forEach((m) => {
        h += `<label class="ck-tick"><input type="checkbox" data-f="monitors" value="${escapeHtml(m.id)}"${picked.includes(m.id) ? ' checked' : ''}${dis}> <span>${escapeHtml(m.name)}</span></label>`;
    });
    return h + '</fieldset>';
}

function quietHtml(node) {
    const g = node.group ? groupById(node.group) : null;
    const q = quietNow();
    const nodeUntil = (q.nodes || {})[node.id] || 0;
    const groupUntil = g ? ((q.groups || {})[g.id] || 0) : 0;
    let h = '<div class="ck-row">';
    h += `<label class="prop-lbl" for="ckQuiet">${escapeHtml(t('Quiet (maintenance)'))}</label>`;
    h += '<select id="ckQuiet" class="select">';
    h += `<option value="">${escapeHtml(t('Quiet for…'))}</option>`;
    h += `<optgroup label="${escapeHtml(t('This device'))}">${QUIET_FOR.map((x) => `<option value="node:${x}">${escapeHtml(t(QUIET_WORDS[x]))}</option>`).join('')}`
        + (nodeUntil > Date.now() ? `<option value="node:end">${escapeHtml(t('End the quiet'))}</option>` : '') + '</optgroup>';
    if (g) {
        h += `<optgroup label="${escapeHtml(groupLabel(g))}">${QUIET_FOR.map((x) => `<option value="group:${x}">${escapeHtml(t(QUIET_WORDS[x]))}</option>`).join('')}`
            + (groupUntil > Date.now() ? `<option value="group:end">${escapeHtml(t('End the quiet'))}</option>` : '') + '</optgroup>';
    }
    h += '</select>';
    const lines = [];
    if (nodeUntil > Date.now()) lines.push(t('This device is quiet until {time}.', { time: dateTimeText(nodeUntil) }));
    if (groupUntil > Date.now()) lines.push(t('{group} is quiet until {time}.', { group: groupLabel(g), time: dateTimeText(groupUntil) }));
    if ((q.site || 0) > Date.now()) lines.push(t('The whole site is quiet until {time}.', { time: dateTimeText(q.site) }));
    if (lines.length) h += `<p class="rail-note ck-note">${escapeHtml(joinSentences(lines))}</p>`;
    return h + '</div>';
}
const QUIET_FOR = ['1h', '4h', 'morning', '24h'];
const QUIET_WORDS = { '1h': 'For 1 hour', '4h': 'For 4 hours', morning: 'Until 08:00 tomorrow', '24h': 'For 24 hours' };
function quietUntil(what, now = Date.now()) {
    if (what === '1h') return now + 3600000;
    if (what === '4h') return now + 4 * 3600000;
    if (what === '24h') return now + DAY_MS;
    if (what === 'morning') { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); }
    return 0;
}

// One edit, one undo step: the node's list changed, saved, drawn.
function editChecks(node, fn) {
    if (!node || state.readOnly) return;
    const list = Array.isArray(node.checks) ? node.checks.map((c) => Object.assign({}, c)) : [];
    fn(list);
    const next = asChecks(list, true);
    if (next) node.checks = next; else delete node.checks;
    save();
    renderCanvasOnly();
    drawSection(node);
    renderCheckSummaryOnly(node);
}
function renderCheckSummaryOnly(node) {
    const checks = Array.isArray(node.checks) ? node.checks : [];
    const lk = live() ? nodeLook(node) : null;
    el('checkSummary').textContent = checks.length ? `${checks.length} · ${lk ? t(LOOK_WORDS[lk]) : protoLabel(checks[0].proto)}` : '';
}
// A watched address as the check cards read a device: its "w:" id (the
// monitor's, the statistics'), its address, its group and its checks.
function watchHolder(w) {
    return { id: watchItemId(w.id), type: 'watch', name: watchLabel(w), address: w.address, group: w.group, checks: Array.isArray(w.checks) ? w.checks : [], interfaces: [] };
}
// Its state now, as a device's dot: null when it is not checked or no
// state is known here (D380: nothing is said of it then).
function holderLook(h) {
    if (!h || !h.checks.length) return null;
    if (!(hasHost() && live()) && !serverMode() && !visitLive()) return null;
    return nodeLook(h) || 'unknown';
}
// What a new check asks first: what the device is for.
function firstCheckFor(node) {
    if (node.type === 'dicom') return { proto: 'dicom' };
    const ports = parsePortExpression(node.ports || '').map((e) => e.start);
    if (ports.includes(104) || ports.includes(11112)) return { proto: 'dicom', port: ports.includes(104) ? undefined : 11112 };
    // Step 7k (D323): a printer, a camera or a phone system by the port it
    // documents.
    if (node.type === 'printer' && documentsPort(node, 631)) return { proto: 'ipp' };
    if (node.type === 'camera' && documentsPort(node, 554)) return { proto: 'rtsp' };
    if (node.type === 'voip') {
        const udp = parsePortExpression(node.ports || '').some((e) => (!e.proto || e.proto === 'udp') && 5060 >= e.start && 5060 <= e.end);
        if (udp) return { proto: 'sip' };
        if (documentsPort(node, 5060)) return { proto: 'sip', transport: 'tcp' };
    }
    return { proto: 'ping' };
}

function onSectionInput(e) {
    const node = _sectionNode ? getNode(_sectionNode) : null;
    if (!node) return;
    const target = e.target;
    if (target.id === 'ckTarget') {
        if (e.type !== 'change') return;
        const v = target.value.trim();
        const n = v === '' ? undefined : asTarget(v);
        if (v !== '' && n === undefined) { target.classList.add('bad'); return; }
        target.classList.remove('bad');
        if (n === node.target || (n === undefined && node.target === undefined)) return;
        if (n === undefined) delete node.target; else node.target = n;
        save();
        return;
    }
    if (target.id === 'ckQuiet') {
        if (e.type !== 'change' || !target.value) return;
        const [scope, what] = target.value.split(':');
        const g = node.group ? groupById(node.group) : null;
        const id = scope === 'group' ? (g && g.id) : node.id;
        quietItem(scope, id, what === 'end' ? 0 : quietUntil(what)).then(() => drawSection(node));
        return;
    }
    const card = target.closest('.ck-card');
    const f = target.dataset.f;
    if (!card || !f || e.type !== 'change') return;
    const cid = card.dataset.check;
    let bad = false;
    editChecks(node, (list) => {
        const c = list.find((x) => x.id === cid);
        if (c) bad = applyCheckField(node, c, target, card);
    });
    if (bad) {
        const again = document.getElementById(target.id);
        if (again) { again.classList.add('bad'); again.value = target.value; }
    }
}
// A quiet window on one item (a device, a watched address's "w:" id) or a
// group, here and on the site's monitors. -> a promise.
function quietItem(scope, id, until) {
    const toSite = sendQuiet(scope, id, until);
    if (!hasHost() || !monitorOn()) return toSite;
    return ckInvoke('monitor_quiet', { scope, id, until })
        .then((info) => { _ck.info = info; return ckInvoke('monitor_status'); })
        .then((list) => { onStatuses(list); })
        .catch((err) => console.warn('Topo: quiet not set:', err));
}
// One field of a check card (its data-f) onto check `c`. -> true when the
// value was refused (marked, not written).
function applyCheckField(node, c, target, card) {
    const f = target.dataset.f;
    let bad = false;
    {
        const v = target.type === 'checkbox' ? target.checked : target.value.trim();
        if (f === 'proto') {
            Object.keys(c).forEach((k) => { if (k !== 'id' && k !== 'interval' && k !== 'slowMs' && k !== 'ip' && k !== 'monitors') delete c[k]; });
            c.proto = v;
            if (v === 'smtp' && !node.address) { const sp = smtpPortsOf(node); if (sp.length && !sp.includes(25)) c.port = sp[0]; }
        } else if (f === 'port' || f === 'slowMs') {
            const n = f === 'port' ? asCheckPort(v) : asCheckSlow(v);
            if (v !== '' && n === undefined) { bad = true; return bad; }
            c[f] = n;
        } else if (f === 'interval') c.interval = Number(v);
        else if (f === 'starttls') c.starttls = v === true;
        else if (f === 'tls') c.tls = CHECK_TLS_MODES.includes(v) ? v : undefined;
        else if (f === 'transport') c.transport = v === 'tcp' ? 'tcp' : undefined;
        else if (f === 'calledAe' || f === 'callingAe') { const a = asCheckAe(v); if (v !== '' && !a) { bad = true; return bad; } c[f] = a; }
        else if (f === 'name') { const a = asCheckName(v); if (v !== '' && !a) { bad = true; return bad; } c.name = a; }
        else if (f === 'path') { const a = asCheckPath(v); if (v !== '' && v !== '/' && !a) { bad = true; return bad; } c.path = a; }
        else if (f === 'ip') c.ip = v || undefined;
        else if (f === 'monitors') {
            const ticked = [...card.querySelectorAll('input[data-f="monitors"]')].filter((x) => x.checked).map((x) => x.value);
            c.monitors = asCheckMonitors(ticked);
        }
    }
    return bad;
}
function onSectionClick(e) {
    const b = e.target.closest('[data-ck]');
    if (!b) return;
    const node = _sectionNode ? getNode(_sectionNode) : null;
    if (!node) return;
    const what = b.dataset.ck;
    if (what === 'settings') { if (typeof openSettings === 'function') openSettings('setMonOn'); return; }
    if (what === 'report') { TopoReports.openMonitoringReport({ scope: 'node', id: node.id, period: 'week' }).catch((err) => console.warn('Monitoring report:', err)); return; }
    if (what === 'add') { editChecks(node, (list) => list.push(firstCheckFor(node))); return; }
    if (what === 'del') {
        const cid = b.closest('.ck-card').dataset.check;
        editChecks(node, (list) => { const i = list.findIndex((x) => x.id === cid); if (i >= 0) list.splice(i, 1); });
    }
}

// A status change while the section shows its device: the line and the dot
// follow; the 24 h at most once a minute.
function refreshOpenSection(list) {
    const node = _sectionNode ? getNode(_sectionNode) : null;
    if (!node || !el('checkGroup') || !el('checkGroup').open) return;
    (Array.isArray(list) ? list : []).forEach((s) => {
        if (!s || !s.key.startsWith(node.id + '/')) return;
        const card = el('checkBody').querySelector(`.ck-card[data-key="${CSS.escape(s.key)}"]`);
        if (!card) return;
        const lk = look(s);
        const now = card.querySelector('.ck-now');
        now.textContent = nowText(s, node);
        now.className = `ck-now ck-now-${lk}${warnOf(s) ? ' ck-warn' : ''}`;
        card.querySelector('.ck-dot').className = `ck-dot ck-${lk}`;
        const c = node.checks.find((x) => `${node.id}/${x.id}` === s.key);
        if (c) loadHistory(node, c);
    });
    renderCheckSummaryOnly(node);
}

// ---- The last 24 h ----

function loadHistory(node, c, root) {
    const key = `${node.id}/${c.id}`;
    const where = () => root || el('checkBody');
    const box = () => where() && where().querySelector(`[data-day="${CSS.escape(key)}"]`);
    const draw = (h) => { const b = box(); if (b) b.innerHTML = dayHtml(h, c); };
    if (!watching()) { const b = box(); if (b) b.innerHTML = ''; return; }
    const had = _ck.hist.get(key);
    if (had) draw(had);
    if (had && Date.now() - had.at < HISTORY_FRESH_MS) return;
    ckInvoke('monitor_history', { key, hours: 24 }).then((h) => {
        const got = { at: Date.now(), kept: !!(h && h.kept), samples: (h && Array.isArray(h.samples)) ? h.samples : [] };
        _ck.hist.set(key, got);
        draw(got);
    }).catch(() => {});
}

// 288 five-minute buckets: the median answer time of each, and its worst
// state (down over slow over quiet over up; none: unknown).
function dayBuckets(samples, now = Date.now()) {
    const start = now - DAY_MS;
    const n = DAY_MS / BUCKET_MS;
    const out = Array.from({ length: n }, () => ({ rtts: [], state: null }));
    const rank = { down: 4, slow: 3, quiet: 2, up: 1, unknown: 0 };
    samples.forEach((s) => {
        const i = Math.floor((s.t - start) / BUCKET_MS);
        if (i < 0 || i >= n) return;
        const b = out[i];
        if (s.ok && s.rtt != null) b.rtts.push(s.rtt);
        if (b.state === null || (rank[s.state] || 0) > (rank[b.state] || 0)) b.state = s.state;
    });
    return out.map((b) => {
        const r = b.rtts.sort((x, y) => x - y);
        return { med: r.length ? r[Math.ceil(r.length / 2) - 1] : null, state: b.state || 'none' };
    });
}
// The day's numbers: answered of asked, the median and 95th percentile of
// the answers, and the availability with its coverage (D163).
function daySummary(samples, now = Date.now()) {
    const inDay = samples.filter((s) => s.t >= now - DAY_MS);
    const ok = inDay.filter((s) => s.ok);
    const r = ok.filter((s) => s.rtt != null).map((s) => s.rtt).sort((a, b) => a - b);
    const pick = (p) => (r.length ? r[Math.max(1, Math.ceil(p * r.length)) - 1] : null);
    // Time in each state, as the hourly figures count it (stats.rs).
    let up = 0, down = 0, measured = 0;
    inDay.forEach((s, i) => {
        const next = inDay[i + 1] ? inDay[i + 1].t : now;
        const span = Math.min(next - s.t, next - s.t <= 2.5 * s.iv ? next - s.t : s.iv);
        if (s.state === 'up' || s.state === 'slow') up += span;
        else if (s.state === 'down') down += span;
        if (s.state !== 'unknown') measured += span;
    });
    return { asked: inDay.length, answered: ok.length, med: pick(0.5), p95: pick(0.95),
        avail: up + down > 0 ? up / (up + down) : null, coverage: Math.min(1, measured / DAY_MS) };
}
function dayHtml(h, c) {
    if (!h.kept) return `<p class="rail-note ck-note">${escapeHtml(t('Statistics are off on this PC: nothing is kept.'))}</p>`;
    if (!h.samples.length) return `<p class="rail-note ck-note">${escapeHtml(t('Nothing recorded in the last 24 h yet.'))}</p>`;
    const now = Date.now();
    const b = dayBuckets(h.samples, now);
    const max = Math.max(1, ...b.map((x) => x.med || 0));
    const W = 288, H = 44;
    let path = '', pen = false;
    b.forEach((x, i) => {
        if (x.med == null) { pen = false; return; }
        const y = (H - 2 - (x.med / max) * (H - 6)).toFixed(1);
        path += `${pen ? 'L' : 'M'}${i + 0.5} ${y}`;
        pen = true;
    });
    const bar = b.map((x, i) => `<rect x="${i}" y="0" width="1" height="6" class="ck-bar-${x.state}"/>`).join('');
    const sum = daySummary(h.samples, now);
    const parts = [t('{a} of {n} answered', { a: sum.answered, n: sum.asked })];
    if (sum.med != null) parts.push(t('median {ms} ms', { ms: msText(sum.med) }), t('95th {ms} ms', { ms: msText(sum.p95) }));
    if (sum.avail != null) parts.push(t('availability {pct} ({cov} measured)', { pct: pctText(sum.avail), cov: pctText(sum.coverage) }));
    const via = h.samples.some((s) => s.via === 'tcp') && c.proto === 'ping' ? ` · ${t('TCP, not ping')}` : '';
    return `<div class="ck-day-head"><span>${escapeHtml(t('Last 24 h'))}</span><span class="mono">${escapeHtml(t('{ms} ms', { ms: msText(max) }))}</span></div>`
        + `<svg class="ck-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(t('Response time over the last 24 h'))}">`
        + `<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" class="ck-axis"/><path d="${path}" class="ck-line"/></svg>`
        + `<svg class="ck-bar" viewBox="0 0 ${W} 6" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(t('State over the last 24 h'))}">${bar}</svg>`
        + `<div class="ck-day-axis"><span>${escapeHtml(t('24 h ago'))}</span><span>${escapeHtml(t('now'))}</span></div>`
        + `<p class="ck-day-sum">${escapeHtml(parts.join(' · ') + via)}</p>`;
}

// ---- Settings: Monitor from this PC ----

function renderMonitorSettings() {
    const sec = el('setMonSec');
    if (!sec) return;
    sec.hidden = !hasHost();
    if (sec.hidden) return;
    const info = _ck.info;
    const on = !!(info && info.on);
    if (el('setMonOffer').hidden) el('setMonOn').checked = on;
    el('setMonOnBox').hidden = !on;
    if (info) {
        el('setMonTray').checked = !!info.tray;
        el('setMonAuto').checked = !!info.autostart;
        const keep = el('setMonKeep');
        const d = RETENTIONS.includes(info.retentionDays) ? info.retentionDays : null;
        if (d === null && !keep.querySelector(`option[value="${info.retentionDays}"]`)) {
            const o = document.createElement('option'); o.value = String(info.retentionDays); keep.appendChild(o);
        }
        keep.querySelectorAll('option').forEach((o) => { o.textContent = keepText(Number(o.value)); });
        keep.value = String(info.retentionDays);
        // The site's monitor follows the site's Keep statistics (D271):
        // set by its owners in the members list, not here.
        const link = window.TopoMonitors && TopoMonitors.state.link;
        const bySite = !!(link && link.enrolled);
        keep.disabled = bySite;
        const why = el('setMonKeepSite');
        if (why) {
            why.hidden = !bySite;
            if (bySite) why.textContent = t('Set by the site\'s owners while this PC is the site\'s monitor: {value}.', { value: keepText(info.retentionDays) });
        }
        el('setMonOther').hidden = !on || !state.libraryId || info.networkId === state.libraryId;
        const q = el('setMonQuiet');
        q.value = '';
        const qEnd = q.querySelector('option[value="end"]');
        if (qEnd) qEnd.hidden = !((info.quiet && info.quiet.site) > Date.now());
    }
    renderMonitorSettingsStatus();
    if (typeof renderAlarmSettings === 'function') renderAlarmSettings();
    // This PC as the site's monitor (js/monitors.js, step 7h).
    if (typeof renderSiteMonitorSettings === 'function') renderSiteMonitorSettings();
}
const keepText = (d) => (d === 0 ? t('Off: keep nothing') : d >= 3650 ? t('10 years') : d === 360 ? t('360 days (default)') : t('{n} days', { n: d }));
function renderMonitorSettingsStatus() {
    const line = el('setMonStatus');
    if (!line || !_ck.info) return;
    const info = _ck.info;
    if (!info.on) { line.textContent = t('Off. Nothing is checked from this PC.'); return; }
    if (info.elsewhere) { line.textContent = t('On: the monitor runs in the other Topo window on this PC.'); return; }
    const down = [..._ck.status.values()].filter((s) => s.state === 'down').length;
    const parts = [tn(info.count, 'Monitoring {name}: {n} check.', 'Monitoring {name}: {n} checks.', { name: info.networkName || t('Untitled network') })];
    if (down) parts.push(tn(down, '{n} not answering.', '{n} not answering.'));
    if (info.quiet && info.quiet.site > Date.now()) parts.push(t('The whole site is quiet until {time}.', { time: dateTimeText(info.quiet.site) }));
    line.textContent = joinSentences(parts);
}

// Ticking Monitor from this PC opens the offer under it (D131, D230): the
// network it checks, and the tray icon and Open Topo at sign-in, both
// ticked, since monitoring with the window closed needs them. Turn on
// sends the plan first, then switches it on.
function openOffer() {
    const box = el('setMonOn');
    if (!state.libraryId) {
        box.checked = false;
        tell(t('Keep this network in My networks first: the monitor checks a kept network.'));
        return;
    }
    el('setMonOfferText').textContent = t('It checks {name}. To keep checking with the window closed:', { name: networkName() });
    el('setMonOfferTray').checked = true;
    el('setMonOfferAuto').checked = true;
    el('setMonOffer').hidden = false;
    el('setMonOfferGo').focus();
}
function closeOffer() {
    el('setMonOffer').hidden = true;
    el('setMonOn').checked = monitorOn();
}
async function turnOn() {
    const tray = el('setMonOfferTray').checked, autostart = el('setMonOfferAuto').checked;
    el('setMonOffer').hidden = true;
    try {
        _ck.sent = '';
        await readMacs();
        await ckInvoke('monitor_plan', { plan: monitorPlan({ nodes: state.nodes, links: state.links, groups: state.groups },
            { me: meOnMap(state.nodes), networkId: state.libraryId, networkName: networkName(), assigned: assignedNow() }) });
        await setMonitor({ on: true, tray, autostart });
        await pushPlan(true);
        if (typeof renderCanvasOnly === 'function') renderCanvasOnly();
    } catch (e) {
        showToast(t('The monitor could not be turned on: {error}', { error: String(e && e.message || e) }), 'warn');
        refreshInfo();
    }
}

async function onSettingsInput(e) {
    const id = e.target.id;
    if (!hasHost()) return;
    try {
        if (id === 'setMonOn') {
            if (e.target.checked) openOffer();
            else {
                el('setMonOffer').hidden = true; await setMonitor({ on: false }); _ck.status.clear(); _ck.sent = ''; if (typeof renderCanvasOnly === 'function') renderCanvasOnly(); }
        } else if (id === 'setMonTray') await setMonitor({ tray: e.target.checked });
        else if (id === 'setMonAuto') await setMonitor({ autostart: e.target.checked });
        else if (id === 'setMonKeep') {
            const link = window.TopoMonitors && TopoMonitors.state.link;
            if (link && link.enrolled) { renderMonitorSettings(); return; }
            await changeRetention(Number(e.target.value));
        }
        else if (id === 'setMonQuiet') {
            const v = e.target.value;
            if (!v) return;
            const until = v === 'end' ? 0 : quietUntil(v);
            sendQuiet('site', '', until);
            _ck.info = await ckInvoke('monitor_quiet', { scope: 'site', id: null, until });
            onStatuses(await ckInvoke('monitor_status'));
            renderMonitorSettings();
            rerenderSelected();
        }
    } catch (err) {
        showToast(t('The monitor did not take the change: {error}', { error: String(err && err.message || err) }), 'warn');
        refreshInfo();
    }
}
// Keep statistics: a shorter period (or Off) deletes, said first (D162).
async function changeRetention(days) {
    const was = _ck.info ? _ck.info.retentionDays : 360;
    if (days === was) return;
    if (days === 0 || days < was) {
        const older = await ckInvoke('monitor_older', { days });
        const gone = older && (older.hours || older.samples);
        if (gone) {
            const msg = days === 0
                ? t('Turn statistics off? Nothing more is kept, and what this PC holds now is deleted: {hours} hourly figures of {items} checks and {samples} samples. The checks and their states go on.', { hours: older.hours, items: older.items, samples: older.samples })
                : t('Keep {days} days? {hours} hourly figures of {items} checks are older than that and are deleted now.', { days, hours: older.hours, items: older.items });
            const yes = await askConfirm(msg, { ok: days === 0 ? t('Turn off and delete') : t('Delete them'), danger: true });
            if (!yes) { el('setMonKeep').value = String(was); return; }
        }
    }
    await setMonitor({ retentionDays: days });
    _ck.hist.clear();
    rerenderSelected();
}

(function wire() {
    const body = el('checkBody');
    if (body) {
        body.addEventListener('change', onSectionInput);
        body.addEventListener('click', onSectionClick);
    }
    const group = el('checkGroup');
    if (group) group.addEventListener('toggle', () => { if (group.open) rerenderSelected(); });
    ['setMonOn', 'setMonTray', 'setMonAuto', 'setMonKeep', 'setMonQuiet'].forEach((id) => { const x = el(id); if (x) x.addEventListener('change', onSettingsInput); });
    const go = el('setMonOfferGo');
    if (go) go.addEventListener('click', () => { turnOn(); });
    const cancel = el('setMonOfferCancel');
    if (cancel) cancel.addEventListener('click', closeOffer);
    const other = el('setMonOther');
    if (other) other.addEventListener('click', async () => {
        const ok = await askConfirm(t('Monitor {name} instead? The checks of {old} stop on this PC.', { name: networkName(), old: (_ck.info && _ck.info.networkName) || '' }), { ok: t('Monitor this network') });
        if (!ok) return;
        _ck.status.clear(); _ck.hist.clear();
        await ckInvoke('monitor_plan', { plan: monitorPlan({ nodes: state.nodes, links: state.links, groups: state.groups },
            { me: meOnMap(state.nodes), networkId: state.libraryId, networkName: networkName() }) });
        await refreshInfo();
        await pushPlan(true);
        if (typeof renderCanvasOnly === 'function') renderCanvasOnly();
    });
    if (hasHost()) window.addEventListener('load', () => { setTimeout(refreshInfo, 0); });
})();

window.checkMarkEl = checkMarkEl;
window.checksDocChanged = checksDocChanged;
window.renderCheckSection = renderCheckSection;
window.renderMonitorSettings = renderMonitorSettings;
// The site monitors' states changed (js/monitors.js): the dots and the
// open section follow.
function redrawDots() {
    const dots = state.nodes.map((n) => (Array.isArray(n.checks) && n.checks.length ? n.id + ':' + (nodeLook(n) || '') : '')).join('|');
    if (dots !== _ck.dots) {
        _ck.dots = dots;
        clearTimeout(_ck.redraw);
        _ck.redraw = setTimeout(() => { if (typeof renderCanvasOnly === 'function') renderCanvasOnly(); }, 250);
    }
}
function serverStatusChanged() {
    const dots = state.nodes.map((n) => (Array.isArray(n.checks) && n.checks.length ? n.id + ':' + (nodeLook(n) || '') : '')).join('|');
    if (dots !== _ck.dots) {
        _ck.dots = dots;
        clearTimeout(_ck.redraw);
        _ck.redraw = setTimeout(() => { if (typeof renderCanvasOnly === 'function') renderCanvasOnly(); }, 250);
    }
    if (!live()) rerenderSelected();
}
window.TopoChecks = { state: _ck, hasHost, monitorPlan, monitorChains, refreshInfo, onStatuses, look, nodeLook, nowText,
    watchHolder, holderLook, checkCardHtml, applyCheckField, loadHistory, quietItem, quietNow, quietUntil, QUIET_FOR, QUIET_WORDS, LOOK_WORDS, NOT_CHECKED_RULE,
    monitorOn, live, watching, serverMode, protoLabel, warnOf, ownerOfSite,
    dayBuckets, daySummary, quietUntil, pushPlan, firstCheckFor, labels, meOnMap, serverStatusChanged, statusesOf, redrawDots,
    pushPlanNow: () => { _ck.sent = ''; return pushPlan(true); } };
})();
