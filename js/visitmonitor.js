// ---- The visit monitor: "Monitor during this visit" (docs/SCOPE.md D148,
// D174, step 7i) ----
// In provider mode, on the desktop app, the provider may check the devices
// they cover while they work. It runs under their own sign-in (or none, for
// a link or a file): no device key, no monitor role, nothing sent to a
// server. The app (desktop/src-tauri/src/visitmon.rs, visitcmd.rs) runs the
// checks with the site monitor's schedule and states, keeps the samples in
// memory for this session only, and tells this page each change
// ("topo-visit-monitor"). This file is the page's side:
//
//   the plan      the check blocks of the devices the provider covers
//                 (providerCovers, the provider chosen in the report's tab),
//                 with the same upstream chains as the site monitor
//                 (js/checks.js monitorPlan);
//   the panel     a section of the report's tab: Start, the states, the
//                 outages seen, Stop; the map's dots follow it while it
//                 runs (js/checks.js statusOf). No issue for the client, no
//                 alarm, no notification: work in progress takes devices
//                 down on purpose (D148);
//   Record visit  the figures (per check: answered of asked, loss,
//                 availability with its coverage, median, 95th percentile,
//                 a chart) and the outages seen become the visit entry's
//                 `monitoring` (format v19, js/model.js visitMonitoring),
//                 which travels in the copy back (link, file, or the server's
//                 visit copy, 7b) and prints in its report; with a site
//                 monitor, each check is compared with that monitor's 7 days
//                 before the visit (the server's statistics, or this PC's own
//                 when it monitors the network). The session ends there: the
//                 app drops everything;
//   the end       Stop ends the checks and drops the samples, keeping the
//                 figures until Record visit (D174); signing out of the
//                 server, a new session, Discard, or leaving provider mode
//                 drops everything (D296). A session started under a
//                 sign-in is that person's only.
//
// With statistics Off (the site's Keep statistics on a server, else this
// PC's, D162) nothing is kept: the states show, and the visit gets no
// monitoring section. The website and the offline zip have no
// window.__TAURI__: nothing here shows and nothing is asked (D127).
//
// Translated: the provider and the client both read it.
// Load order: ... -> checks -> issues -> monitors -> visitmonitor -> app

(function () {
'use strict';
const _vm = {
    invoke: null,       // tests: stands in for window.__TAURI__.core.invoke
    listen: null,       // tests: stands in for window.__TAURI__.event.listen
    info: null,         // visit_monitor_info's answer
    statuses: new Map(),  // item key -> its latest status
    outages: [],
    listening: false,
    planTimer: 0,
    sent: '',
    told: new Set(),    // outages already said in a toast (node|from)
    busy: false
};
const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const BEFORE_DAYS = 7;
const ROWS_SHOWN = 30;
const PLAN_DELAY_MS = 800;
const vmEl = (id) => document.getElementById(id);

function vmInvoke(cmd, args) {
    if (_vm.invoke) return Promise.resolve().then(() => _vm.invoke(cmd, args || {}));
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
function vmListen(name, cb) {
    if (_vm.listen) return Promise.resolve(_vm.listen(name, cb));
    const ev = window.__TAURI__ && window.__TAURI__.event;
    if (!ev || typeof ev.listen !== 'function') return Promise.resolve(() => {});
    return ev.listen(name, cb);
}
const hasHost = () => !!_vm.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
const PM = () => window.TopoProviderMode;
const pmOn = () => !!(PM() && PM().state.on);
const selfId = () => (pmOn() ? PM().providerSelfOf(PM().state.docId) || '' : '');
const netId = () => state.docId || '';
const meta = () => (_vm.info && _vm.info.meta) || null;
// Whose the session is: one started under a server sign-in belongs to that
// person only (a later user of this PC neither sees nor records it, D296).
const whoNow = () => { const T = window.TopoServer; try { const me = T && T.me ? T.me() : null; return (me && me.id) || ''; } catch (e) { return ''; } };
const mine = () => !!meta() && (!meta().who || meta().who === whoNow());
// A session (running or stopped) for the open network, this person's.
const heldHere = () => mine() && meta().networkId === netId();
// Running for the open network: its states are the map's.
const active = () => heldHere() && !!_vm.info.running;

// ---- Formats (no language in the numbers, the words translated) ----
const msText = (v) => (v == null ? '—' : v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v)));
const pctText = (v) => {
    if (v == null) return '—';
    const p = v * 100;
    return (p >= 99.95 && p < 100 ? '99.9' : p === 100 || p === 0 ? String(p) : p.toFixed(p >= 10 ? 1 : 2).replace(/\.0+$/, '')) + ' %';
};
function timeText(ms) {
    const lang = window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined;
    try { return new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(ms).toTimeString().slice(0, 5); }
}
const minutesText = (ms) => t('{n} min', { n: Math.max(1, Math.round(ms / 60000)) });
const PROTO_LABELS = { ping: 'Ping', tcp: 'TCP', http: 'HTTP', https: 'HTTPS', dns: 'DNS', smtp: 'SMTP', dicom: 'DICOM C-ECHO', ntp: 'NTP', rtsp: 'RTSP', sip: 'SIP', mllp: 'HL7 MLLP', ipp: 'IPP', imap: 'IMAP', pop: 'POP' };
const protoLabel = (p) => PROTO_LABELS[p] || p || '';

// ---- The plan: the provider's checks ----

// The checks of the devices provider `pid` covers. -> the plan.
function planFor(pid) {
    const C = window.TopoChecks;
    if (!C || !pid || typeof providerCovers !== 'function') return { networkId: netId(), networkName: '', items: [] };
    const covered = new Set(providerCovers(pid).nodes.map((n) => n.id));
    return C.monitorPlan({ nodes: state.nodes, links: state.links, groups: state.groups },
        { me: C.meOnMap(state.nodes), networkId: netId(), networkName: (typeof docDisplayName === 'function' && docDisplayName()) || '', assigned: (n) => covered.has(n.id) });
}
// Statistics Off (D162): the site's Keep statistics on a server, else this
// PC's own setting. What is known now (the panel's note); a server site not
// read yet is not called Off here.
function statsOff() {
    const M = window.TopoMonitors;
    const site = M && M.siteOfOpen ? M.siteOfOpen() : null;
    if (site) return M.siteState(site).statsDays === 0;
    const info = window.TopoChecks && TopoChecks.state.info;
    return !!info && info.retentionDays === 0;
}
// The same before anything is kept (Start, Record visit): a server site's
// setting is read first when this page has not read it yet, and counts as
// Off when it cannot be read (D295: fail closed).
async function statsOffNow() {
    const M = window.TopoMonitors;
    const site = M && M.siteOfOpen ? M.siteOfOpen() : null;
    if (!site) return statsOff();
    const st = M.siteState(site);
    if (!st.statsAt) {
        try { await M.loadMonitors(site); } catch (e) { console.warn('Topo: the site\'s Keep statistics could not be read; nothing is kept.', e); return true; }
    }
    return !M.siteState(site).statsAt || M.siteState(site).statsDays === 0;
}

// ---- The app ----

function apply(info) {
    _vm.info = info && info.meta ? info : null;
    _vm.statuses.clear();
    ((info && info.statuses) || []).forEach((s) => { if (s && s.key) _vm.statuses.set(s.key, s); });
    _vm.outages = (info && Array.isArray(info.outages)) ? info.outages : [];
    _vm.outages.forEach((o) => _vm.told.add(o.nodeId + '|' + o.from));
    changed();
    return _vm.info;
}
function listen() {
    if (_vm.listening) return;
    _vm.listening = true;
    vmListen('topo-visit-monitor', (e) => onEvent(e && e.payload)).catch(() => { _vm.listening = false; });
}
function refresh() {
    if (!hasHost()) return Promise.resolve(null);
    listen();
    return vmInvoke('visit_monitor_info').then((info) => {
        apply(info);
        // Someone else is signed in now than who started it (the sign-out
        // was missed, the app closed meanwhile): it goes (D296).
        const m = meta();
        if (m && m.who && whoNow() && m.who !== whoNow()) return end();
        return _vm.info;
    }).catch((e) => { console.warn('Topo: the visit monitor did not answer:', e); return null; });
}
// A change from the app: the states, the outages; a new outage is said on
// this screen only (never an issue, never the alarm).
function onEvent(p) {
    if (!p || !_vm.info) return;
    // A late event of an earlier session (each carries its start).
    if (p.started && meta() && meta().started && p.started !== meta().started) return;
    (Array.isArray(p.statuses) ? p.statuses : []).forEach((s) => { if (s && s.key) _vm.statuses.set(s.key, s); });
    if (Array.isArray(p.outages)) {
        _vm.outages = p.outages;
        p.outages.forEach((o) => {
            const k = o.nodeId + '|' + o.from;
            if (_vm.told.has(k)) return;
            _vm.told.add(k);
            if (o.to == null && heldHere() && typeof showToast === 'function') showToast(t('{name} is not answering', { name: o.name || o.nodeId }), 'err');
        });
    }
    changed();
}
// The map's dots and the report's tab follow.
function changed() {
    if (window.TopoChecks && TopoChecks.redrawDots) TopoChecks.redrawDots();
    renderSection();
}

async function start() {
    if (!hasHost() || !pmOn() || _vm.busy) return null;
    const pid = selfId();
    if (!pid) { showToast(t('Choose which provider you are first.'), 'err'); return null; }
    const plan = planFor(pid);
    if (!plan.items.length) { showToast(t('None of the devices you look after has an answer check yet.'), 'err'); return null; }
    // Any session on this PC goes at a new start (D287): ask first when it
    // runs, or holds figures not recorded yet, and name its network when it
    // is another one (D297).
    if (!_vm.info) await refresh();
    const old = meta();
    if (old && (_vm.info.running || _vm.info.hasFigures)) {
        const other = old.networkId !== netId();
        const name = other ? otherNetworkName(old.networkId) : '';
        const q = other
            ? (_vm.info.running ? t('Monitoring is running for {name}. Stop it and start here? Its figures are dropped.', { name })
                : t('The figures of the last session, for {name}, are not recorded yet. Start here? They are dropped.', { name }))
            : t('Start again? The figures of the last session on this PC are dropped.');
        if (!(await askConfirm(q, { ok: t('Start again') }))) return null;
    }
    _vm.busy = true;
    _vm.told.clear();
    renderSection();
    try {
        listen();
        const s = PM().state.session || {};
        const kept = !(await statsOffNow());
        const info = await vmInvoke('visit_monitor_start', { plan, meta: { networkId: netId(), incidentId: s.incidentId || '', providerId: pid, kept, who: whoNow() } });
        _vm.sent = JSON.stringify(plan);
        return apply(info);
    } catch (e) {
        console.warn('Topo: the visit monitor could not start:', e);
        showToast(t('Monitoring could not start on this PC.'), 'err');
        return null;
    } finally { _vm.busy = false; renderSection(); }
}
async function stop() {
    if (!hasHost() || !_vm.info || !_vm.info.running) return null;
    try { return apply(await vmInvoke('visit_monitor_stop')); }
    catch (e) { console.warn('Topo: the visit monitor could not stop:', e); return null; }
}
// Another network's name, as the library lists it.
function otherNetworkName(id) {
    try {
        const r = typeof libraryEntry === 'function' ? libraryEntry(id) : null;
        if (r && r.name) return r.name;
    } catch (e) { /* not listed */ }
    return t('another network');
}
// Everything goes: the samples and the figures.
async function end() {
    if (!hasHost() || !_vm.info) return null;
    try { await vmInvoke('visit_monitor_end'); } catch (e) { console.warn('Topo: the visit monitor could not end:', e); }
    _vm.told.clear();
    return apply(null);
}
// The provider added or changed a check while it runs: the new list, a
// moment later, once.
function docChanged() {
    if (!active() || !hasHost()) return;
    clearTimeout(_vm.planTimer);
    _vm.planTimer = setTimeout(() => {
        if (!active()) return;
        const plan = planFor(meta().providerId);
        const json = JSON.stringify(plan);
        if (json === _vm.sent) return;
        _vm.sent = json;
        vmInvoke('visit_monitor_plan', { plan }).then((info) => { if (info && info.meta) { _vm.info = Object.assign({}, _vm.info, { count: info.count }); renderSection(); } }).catch(() => {});
    }, PLAN_DELAY_MS);
}
// The status a check shows while the visit monitor runs on the open
// network (js/checks.js statusOf), else null.
const statusOf = (key) => (active() ? _vm.statuses.get(key) || null : null);

// ---- The report's tab: Monitor during this visit ----

function vmNode(tag, cls, text) { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; }
function vmButton(text, cls, onClick) { const b = vmNode('button', cls || 'btn', text); b.type = 'button'; b.addEventListener('click', onClick); return b; }

function outageText(o) {
    const cause = o.cause ? getNode(o.cause) : null;
    const name = o.name || o.nodeId;
    const span = o.to != null ? t('{name}: not answering from {from} to {to} ({min})', { name, from: timeText(o.from), to: timeText(o.to), min: minutesText(o.to - o.from) })
        : t('{name}: not answering since {from}', { name, from: timeText(o.from) });
    return span + (cause ? ` · ${t('because {name} was not answering', { name: cause.name || cause.id })}` : '');
}

// The section, or null when it does not apply (the website, no provider
// mode). Built by renderProviderPanel (js/providermode.js).
function section() {
    if (!hasHost() || !pmOn()) return null;
    const box = vmNode('section', 'pm-visits vm-sec');
    box.id = 'vmSection';
    fillSection(box);
    return box;
}
function renderSection() {
    const box = vmEl('vmSection');
    if (box) fillSection(box);
}
function fillSection(box) {
    box.textContent = '';
    box.appendChild(vmNode('h4', 'pb-head', t('Monitor during this visit')));
    const pid = selfId();
    if (!pid) { box.appendChild(vmNode('p', 'dlg-dim', t('Choose which provider you are to check your devices while you work.'))); return; }
    const held = heldHere() ? _vm.info : null;
    const off = statsOff();
    const acts = vmNode('div', 'pb-acts');
    if (held && held.running) {
        box.appendChild(vmNode('p', 'dlg-dim vm-line', joinSentences([t('Checking since {time}.', { time: timeText(held.meta.started) }),
            tn(held.count, '{n} check.', '{n} checks.'), held.meta.kept ? '' : t('Statistics are off: nothing is kept.')])));
        const items = planFor(held.meta.providerId).items;
        const ul = vmNode('ul', 'vm-list');
        items.slice(0, ROWS_SHOWN).forEach((it) => {
            const s = _vm.statuses.get(it.key);
            const node = getNode(it.nodeId);
            const lk = window.TopoChecks ? TopoChecks.look(s) : 'unknown';
            const li = vmNode('li', 'vm-row');
            li.dataset.key = it.key;
            const dot = vmNode('span', 'ck-dot ck-' + lk);
            dot.setAttribute('aria-hidden', 'true');
            li.append(dot, vmNode('span', 'vm-name', `${it.nodeName} · ${protoLabel(it.spec.proto)}`),
                vmNode('span', 'vm-now dlg-dim', window.TopoChecks && node ? TopoChecks.nowText(s, node) : ''));
            ul.appendChild(li);
        });
        box.appendChild(ul);
        if (items.length > ROWS_SHOWN) box.appendChild(vmNode('p', 'dlg-dim', t('{n} more', { n: items.length - ROWS_SHOWN })));
        acts.appendChild(vmButton(`■ ${t('Stop monitoring')}`, 'btn', () => stop()));
    } else if (held) {
        box.appendChild(vmNode('p', 'dlg-dim vm-line', joinSentences([t('Stopped at {time}.', { time: timeText(held.stopped || Date.now()) }),
            held.hasFigures ? t('The figures are kept for Record visit.') : t('Nothing was kept.')])));
        acts.appendChild(vmButton(`▶ ${t('Start again')}`, 'btn', () => start()));
        acts.appendChild(vmButton(t('Discard'), 'btn', () => end()));
    } else {
        const n = planFor(pid).items.length;
        box.appendChild(vmNode('p', 'dlg-dim', joinSentences([t('Checks the devices you look after while you work, from this PC, for this visit only. The client gets no issue or alarm from it.'),
            n ? tn(n, '{n} check.', '{n} checks.') : t('None of the devices you look after has an answer check yet: add one in a device\'s Answer checks.')])));
        if (off) box.appendChild(vmNode('p', 'dlg-dim', t('Statistics are off for this network: the states show, but nothing is kept and the visit gets no monitoring section.')));
        const go = vmButton(`▶ ${t('Start monitoring')}`, 'btn btn-primary', () => start());
        go.disabled = !n || _vm.busy;
        acts.appendChild(go);
    }
    if (held && _vm.outages.length) {
        box.appendChild(vmNode('p', 'prop-lbl', t('Outages seen')));
        const ul = vmNode('ul', 'vm-outages');
        _vm.outages.slice(-10).forEach((o) => ul.appendChild(vmNode('li', o.to == null ? 'vm-out vm-out-on' : 'vm-out', outageText(o))));
        box.appendChild(ul);
    }
    box.appendChild(acts);
}

// ---- Record visit: the section of the entry ----

// The site monitor's hourly figures of the 7 days before `from`, for these
// keys: { hours: Map(key -> [hourly]) } or null when the site has no
// monitor this page can read.
// Only whole hours that ended by the visit's start count: the hour it starts
// in holds minutes of the visit itself (D294).
async function siteBefore(keys, from) {
    const end = Math.floor(from / HOUR_MS) * HOUR_MS;
    const start = end - BEFORE_DAYS * DAY_MS;
    const M = window.TopoMonitors;
    const site = M && M.siteOfOpen ? M.siteOfOpen() : null;
    const hours = new Map();
    const add = (k, list) => (list || []).forEach((h) => { if (h && h.hour >= start && h.hour + HOUR_MS <= from) { if (!hours.has(k)) hours.set(k, []); hours.get(k).push(h); } });
    if (site) {
        // Not read yet: read now. Unreadable: the caller says so, never
        // "no site monitor" (D295).
        if (!M.siteState(site).statsAt) await M.loadMonitors(site);
        const st = M.siteState(site);
        if (!st.monitors || !st.monitors.length) return null;
        const day = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;
        const got = await M.stats(site, day(start), day(from));
        got.forEach((x) => keys.forEach((k) => { if (x.checks && x.checks[k]) add(k, x.checks[k].hours); }));
        return { hours };
    }
    const C = window.TopoChecks;
    const info = C && C.state.info;
    if (!info || !info.on || !info.networkId || info.networkId !== state.libraryId || !info.retentionDays) return null;
    const got = await vmInvoke('monitor_figures', { keys, from: start, to: end });
    Object.keys(got || {}).forEach((k) => add(k, got[k]));
    return { hours };
}
// One check's figures over hourly figures: the medians and 95th
// percentiles of the hours weighted by their answers (as stats.rs daily
// does), availability up / (up + down) and the coverage of the 7 days.
function hoursFigures(list) {
    const weighted = (pick, p) => {
        const v = list.filter((h) => h[pick] != null && h.ok > 0).map((h) => [h[pick], h.ok]).sort((a, b) => a[0] - b[0]);
        if (!v.length) return undefined;
        const total = v.reduce((s, x) => s + x[1], 0);
        const want = Math.max(1, Math.ceil(p * total));
        let acc = 0;
        for (const [x, w] of v) { acc += w; if (acc >= want) return x; }
        return v[v.length - 1][0];
    };
    let up = 0, down = 0, maint = 0;
    list.forEach((h) => { up += (h.sUp || 0) + (h.sSlow || 0); down += h.sDown || 0; maint += h.sMaint || 0; });
    const out = {};
    const med = weighted('rttMed', 0.5), p95 = weighted('rttP95', 0.95);
    if (med !== undefined) out.med = med;
    if (p95 !== undefined) out.p95 = p95;
    if (up + down > 0) out.avail = up / (up + down);
    out.coverage = Math.min(1, (up + down + maint) / (BEFORE_DAYS * 86400));
    return out;
}
// The app's figures as the entry keeps them (js/model.js visitMonitoring),
// with the comparison when there is one. -> the section, or undefined.
async function sectionOf(fig) {
    if (!fig || !Array.isArray(fig.items)) return undefined;
    const name = (id, fallback) => { const n = getNode(id); return (n && (n.name || n.id)) || fallback || id; };
    const m = {
        from: fig.from, to: fig.to,
        items: fig.items.map((x) => ({ node: x.nodeId, check: x.checkId, name: name(x.nodeId, x.name), proto: x.proto, via: x.via || undefined,
            asked: x.asked, answered: x.answered, loss: x.loss, avail: x.avail, coverage: x.coverage, med: x.med, p95: x.p95, step: x.step, rtt: x.rtt, states: x.states })),
        outages: (fig.outages || []).map((o) => ({ node: o.nodeId, name: name(o.nodeId, o.name), from: o.from, to: o.to == null ? undefined : o.to,
            cause: o.cause || undefined, causeName: o.cause ? name(o.cause) : undefined }))
    };
    try {
        const b = await siteBefore(fig.items.map((x) => x.key), fig.from);
        if (b) {
            m.compared = true;
            m.items.forEach((x, i) => { const h = b.hours.get(fig.items[i].key); if (h && h.length) x.before = hoursFigures(h); });
        }
    } catch (e) {
        console.warn('Topo: the site monitor\'s figures could not be read; the visit goes without the comparison.', e);
        m.unread = true;
    }
    return visitMonitoring(m);
}
// Record visit opens: the section from this network's session, if any.
// -> { state: 'none' | 'off' | 'ok', monitoring, running }.
async function forVisit() {
    if (!hasHost()) return { state: 'none' };
    if (!_vm.info) await refresh();
    if (!heldHere()) return { state: 'none' };
    // Off now (the owner may have turned it off during the visit) or never
    // on: no section (D295).
    if (!meta().kept || (await statsOffNow())) return { state: 'off', running: !!_vm.info.running };
    let fig = null;
    try { fig = await vmInvoke('visit_monitor_figures'); } catch (e) { fig = null; }
    const monitoring = await sectionOf(fig);
    return monitoring ? { state: 'ok', monitoring, running: !!_vm.info.running } : { state: 'none' };
}
// The visit was saved: the session ends (D148), whatever it held.
async function visitRecorded() { if (heldHere()) await end(); }

// ---- The section in words, tables and charts ----

const STATE_FILL = { u: '#16a34a', s: '#d97706', d: '#dc2626', q: '#64748b', '-': '#d1d5db' };
// "R1's median went from 38 ms to 4 ms": one line per check compared.
function compareLines(m) {
    return (m.items || []).filter((x) => x.before && x.before.med != null && x.med != null).map((x) =>
        t('{name}: the median went from {before} ms to {now} ms.', { name: `${x.name || x.node} · ${protoLabel(x.proto)}`, before: msText(x.before.med), now: msText(x.med) }));
}
// One line for lists and messages.
function summaryText(m) {
    if (!m) return '';
    const n = (m.items || []).length + (m.more || 0);
    return joinSentences([tn(n, 'Monitored during the visit: {n} check.', 'Monitored during the visit: {n} checks.'),
        tn((m.outages || []).length, '{n} outage seen.', '{n} outages seen.')]);
}
function chartSvg(x) {
    if (!x.states) return '';
    const n = x.states.length, W = 240, H = 40;
    const vals = (x.rtt || []).filter((v) => v != null);
    const max = Math.max(1, ...vals);
    let path = '', pen = false;
    (x.rtt || []).forEach((v, i) => {
        if (v == null) { pen = false; return; }
        const px = ((i + 0.5) * W / n).toFixed(1), py = (H - 2 - (v / max) * (H - 6)).toFixed(1);
        path += `${pen ? 'L' : 'M'}${px} ${py}`;
        pen = true;
    });
    const bar = [...x.states].map((c, i) => `<rect x="${(i * W / n).toFixed(2)}" y="0" width="${(W / n + 0.05).toFixed(2)}" height="6" fill="${STATE_FILL[c] || STATE_FILL['-']}"/>`).join('');
    const label = escapeHtml(t('Response time and state during the visit: {name}', { name: x.name || x.node }));
    return `<figure class="vm-chart" style="margin:4px 0"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="${label}">`
        + `<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="#9ca3af" stroke-width="1"/><path d="${path}" fill="none" stroke="#2563eb" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`
        + `<svg viewBox="0 0 ${W} 6" width="100%" height="6" preserveAspectRatio="none" aria-hidden="true">${bar}</svg>`
        + `<figcaption style="font-size:11px;opacity:.75">${escapeHtml(t('Top: response time, up to {ms} ms. Bar: green answering, amber slow, red not answering, grey quiet or unknown.', { ms: msText(max) }))}</figcaption></figure>`;
}
// The section as HTML: what it covered, the comparison, a table of the
// checks, the outages, and (charts: true) a chart per check.
function sectionHtml(m, opts = {}) {
    if (!m) return '';
    const esc = escapeHtml;
    const head = joinSentences([t('From {from} to {to}.', { from: incidentWhen(m.from), to: incidentWhen(m.to) }), summaryText(m)]);
    const compared = m.compared ? compareLines(m) : [];
    const cmpNote = m.compared ? (compared.length ? '' : t('The site monitor has no figures for these checks in the 7 days before.'))
        : m.unread ? t('The site monitor\'s figures could not be read: no comparison.') : t('No site monitor: nothing to compare with.');
    const row = (x) => `<tr><td>${esc(`${x.name || x.node} · ${protoLabel(x.proto)}`)}${x.via === 'tcp' ? `<br><span class="muted">${esc(t('TCP, not ping'))}</span>` : ''}</td>`
        + `<td>${esc(t('{a} of {n}', { a: x.answered, n: x.asked }))}</td><td>${esc(pctText(x.loss))}</td>`
        + `<td>${esc(pctText(x.avail))}<br><span class="muted">${esc(t('{pct} measured', { pct: pctText(x.coverage) }))}</span></td>`
        + `<td>${esc(msText(x.med))}</td><td>${esc(msText(x.p95))}</td>`
        + (m.compared ? `<td>${x.before ? `${esc(`${msText(x.before.med)} · ${msText(x.before.p95)} · ${pctText(x.before.avail)}`)}<br><span class="muted vm-before-cov">${esc(t('{pct} measured', { pct: pctText(x.before.coverage) }))}</span>` : '—'}</td>` : '') + '</tr>';
    const table = `<table class="changes vm-table"><thead><tr><th>${esc(t('Device · check'))}</th><th>${esc(t('Answered'))}</th><th>${esc(t('Loss'))}</th><th>${esc(t('Availability'))}</th>`
        + `<th>${esc(t('Median (ms)'))}</th><th>${esc(t('95th percentile (ms)'))}</th>${m.compared ? `<th>${esc(t('7 days before: median · 95th · availability'))}</th>` : ''}</tr></thead>`
        + `<tbody>${(m.items || []).map(row).join('')}</tbody></table>`
        + (m.more ? `<p class="muted">${esc(tn(m.more, '{n} more check is not listed.', '{n} more checks are not listed.'))}</p>` : '');
    const outs = (m.outages || []).length
        ? `<table class="changes vm-table"><thead><tr><th>${esc(t('Device'))}</th><th>${esc(t('Not answering from'))}</th><th>${esc(t('To'))}</th><th>${esc(t('Down for'))}</th><th>${esc(t('Root cause'))}</th></tr></thead><tbody>`
            + m.outages.map((o) => `<tr><td>${esc(o.name || o.node)}</td><td>${esc(incidentWhen(o.from))}</td><td>${esc(o.to ? incidentWhen(o.to) : t('the end of the visit'))}</td>`
                + `<td>${esc(minutesText((o.to || m.to) - o.from))}</td><td>${esc(o.cause ? t('down because {name}', { name: o.causeName || o.cause }) : '—')}</td></tr>`).join('') + '</tbody></table>'
        : `<p class="muted">${esc(t('No outage was seen during the visit.'))}</p>`;
    const charts = opts.charts ? (m.items || []).filter((x) => x.states).map((x) => `<div class="vm-chart-item"><b>${esc(`${x.name || x.node} · ${protoLabel(x.proto)}`)}</b>${chartSvg(x)}</div>`).join('') : '';
    return `<div class="vm-report"><p>${esc(head)}</p>${compared.length ? `<ul>${compared.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${cmpNote ? `<p class="muted">${esc(cmpNote)}</p>` : ''}`
        + table + `<h4>${esc(t('Outages seen'))}</h4>` + outs + (charts ? `<h4>${esc(t('Response times'))}</h4>${charts}` : '') + '</div>';
}

// ---- The visit's report (the .rpv preview) ----

function visitReportHtml(e) {
    const esc = escapeHtml;
    const inc = e.incidentId && typeof incidentById === 'function' ? incidentById(e.incidentId) : null;
    const meta = typeof providerReportMeta === 'function' ? providerReportMeta(serializeDoc()) : { site: '', client: '', date: '' };
    const title = t('Visit report');
    const sub = [meta.site, meta.client, e.at ? incidentWhen(e.at) : ''].filter(Boolean).join(' · ');
    const line = typeof visitLineText === 'function' ? visitLineText(e) : e.summary || '';
    const facts = [
        inc ? [t('Problem'), `${symptomLabel(inc.symptom)} · ${TopoIncidents.incidentWhereText(inc)}`] : null,
        e.arrived ? [t('Arrived'), incidentWhen(e.arrived)] : null,
        e.left ? [t('Left'), incidentWhen(e.left)] : null
    ].filter(Boolean);
    const signoff = e.signoff ? `<p>${esc(t('Signed off by: {name}', { name: e.signoff }))}</p>` : '';
    const changes = e.changes && e.changes.counts ? t('{added} added, {changed} changed, {removed} removed', e.changes.counts) : '';
    const mon = e.monitoring ? `<section class="part"><h2>${esc(t('Monitoring during the visit'))}</h2><div class="dev-block">${sectionHtml(e.monitoring, { charts: true })}</div></section>` : '';
    return `<!doctype html><html lang="${esc(document.documentElement.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
@page { size: A4; margin: 16mm 14mm; }
:root { color-scheme: light dark; --bg: #f3f4f6; --card: #fff; --text: #111; --dim: #4b5563; --rule: #d1d5db; }
@media (prefers-color-scheme: dark) { :root { --bg: #111318; --card: #1b1e25; --text: #f3f4f6; --dim: #a1a7b3; --rule: #3a3f4b; } }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.4; color: var(--text); background: var(--bg); overflow-wrap: anywhere; }
.sheet { display: flex; flex-direction: column; gap: 12px; padding: 16px; max-width: 900px; }
.dev-block { background: var(--card); border: 1px solid var(--rule); border-radius: 8px; padding: 10px 14px; }
.part { display: flex; flex-direction: column; gap: 8px; }
h1 { font-size: 20px; margin: 0 0 2px; } .sub, .muted { color: var(--dim); } .sub { margin: 0 0 8px; }
h2 { font-size: 16px; margin: 8px 0 0; } h4 { font-size: 13px; margin: 10px 0 4px; }
dl { margin: 4px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px 14px; }
dt { font-size: 11.5px; color: var(--dim); } dd { margin: 0; }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin: 4px 0; }
th, td { text-align: left; vertical-align: top; padding: 3px 6px; border-bottom: 1px solid var(--rule); }
th { font-weight: 600; color: var(--dim); }
.vm-chart-item { break-inside: avoid; page-break-inside: avoid; margin: 6px 0; }
.notes { white-space: pre-wrap; }
@media print {
  :root { --bg: #fff; --card: #fff; --text: #000; --dim: #333; --rule: #999; color-scheme: light; }
  body { background: #fff; color: #000; font-size: 10.5pt; } .sheet { padding: 0; max-width: none; }
  .dev-block { border: 0; border-bottom: 1px solid #999; border-radius: 0; padding: 6pt 0; }
}
</style></head><body><div class="sheet">
<header class="dev-block"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}<p><b>${esc(line)}</b></p>
${facts.length ? `<dl>${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
${e.notes ? `<p class="notes">${esc(e.notes)}</p>` : ''}${signoff}${changes ? `<p class="muted">${esc(t('Changes to the network: {list}', { list: changes }))}</p>` : ''}</header>
${mon}</div></body></html>`;
}
// The visit entry's report in the print preview. -> what openSheetPreview
// returns.
function openVisitReport(e) {
    if (!e) return null;
    const kind = typeof providerSheetKind === 'function' ? providerSheetKind(t('Visit report')) : 'locate';
    const meta = typeof providerReportMeta === 'function' ? providerReportMeta(serializeDoc()) : {};
    return openSheetPreview({ kind, meta, build: () => visitReportHtml(e) });
}

// ---- Wiring ----

(function wire() {
    if (hasHost()) window.addEventListener('load', () => { setTimeout(refresh, 0); });
    // Signing out of the server ends the session (D148): the server's own
    // sign-out (js/server.js emits 'signed-out'), never a lock or a reload.
    const hook = () => {
        const T = window.TopoServer;
        if (!T || typeof T.on !== 'function') return false;
        T.on('signed-out', () => { if (_vm.info && meta() && meta().who) end(); });
        // Signing in as someone else: a session of the one before goes (D296).
        let was = whoNow();
        T.on('changed', () => { const w = whoNow(); if (w && w !== was) { was = w; refresh(); } else if (w) was = w; });
        return true;
    };
    if (!hook()) window.addEventListener('load', hook);
})();

window.TopoVisitMonitor = {
    state: _vm, hasHost, planFor, statsOff, statsOffNow, heldHere, refresh, start, stop, end, docChanged, statusOf, active, section, renderSection, onEvent,
    forVisit, sectionOf, hoursFigures, siteBefore, visitRecorded, summaryText, compareLines, sectionHtml, visitReportHtml, openVisitReport
};
})();
