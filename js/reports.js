// ---- Reports: availability, response times and outages (docs/SCOPE.md
// D163, D164, step 7j; D298-D314) ----
// What the answer checks saw, on paper: the monitoring report, through the
// fleet's report preview (.rpv, js/sheetpreview.js) with Print, Download and
// CSV, its choices in the left column:
//
//   on what     the whole network, a group, a device or a provider
//               (their devices: providerCovers);
//   period      the last 24 hours, 7 days, 30 days or 91 days (a quarter),
//               or since the last visit, each ending at the last whole hour
//               (an hour's figures are made once it has ended);
//   hours       around the clock, or only during the provider's support
//               hours when the provider asks for that (v19 `targetHours`) and
//               their hours read;
//   what goes in  availability, response times, outages (all three).
//
// The figures are the hourly ones (desktop/src-tauri/src/stats.rs): from the
// site's monitors through the Topo server when the open network is a
// server's site (TopoMonitors.stats, any signed-in page, the website too,
// which asks nothing of any device, D127), else from this PC's own monitor
// when it monitors the open network (`monitor_figures`, the desktop app with
// no server). Without either, the report says why and still lists the
// outages, which the document holds (its incidents of kind "outage").
//
//   availability   answering ÷ (answering + not answering), maintenance and
//                  unknown time left out, the share measured printed beside
//                  every figure (D163); per check, and pooled per device
//                  group, provider and the whole report; against the
//                  device's target, else its provider's (v19); the time down
//                  because of a device upstream named ("down because R1",
//                  from the outages whose devices behind them hold it) and
//                  left out of the figure the target is judged on (D300).
//   response times the median and 95th percentile over the period per
//                  check, as a chart with its table beside it (Branding's
//                  Data Viz: an inline SVG, no library, the numbers always
//                  in a table), loss, jitter and the slow hours of the day.
//   outages        each issue with its start, how long it was down, its root
//                  cause, who acted and how long that took; the mean time to
//                  repair (MTTR) and between failures (MTBF) per device.
//
// Also here: the provider's section of their report (js/providerreport.js,
// which a Report a problem attaches), the outage block of the network
// report's Problems and visits (js/incidents.js), and the device's Answer
// checks link to its full report (js/checks.js).
//
// Everything a person reads is translated; the CSV's column names and the
// file names stay English, as Topo's other files do.
// Load order: ... -> checks -> issues -> monitors -> visitmonitor -> reports -> app

(function () {
'use strict';
const HOUR = 3600000, DAY = 24 * HOUR;
const PERIOD_MS = { day: DAY, week: 7 * DAY, month: 30 * DAY, quarter: 91 * DAY };
const PERIODS = ['day', 'week', 'month', 'quarter', 'visit'];
const PERIOD_WORDS = { day: 'Last 24 hours', week: 'Last 7 days', month: 'Last 30 days', quarter: 'Last 91 days (a quarter)', visit: 'Since the last visit' };
const PARTS = ['availability', 'response', 'outages', 'connections'];
const PART_WORDS = { availability: 'Availability', response: 'Response times', outages: 'Outages', connections: 'Connections' };
const SCOPES = ['site', 'group', 'node', 'provider'];
const SCOPE_WORDS = { site: 'Whole network', group: 'A group', node: 'A device', provider: 'A provider' };
const STEPS = [HOUR, 6 * HOUR, DAY, 7 * DAY];
const MAX_BUCKETS = 31;
const KEYS_MAX = 1000;
const GROUPS_MAX = 50;
const PROTO_LABELS = { ping: 'Ping', tcp: 'TCP', http: 'HTTP', https: 'HTTPS', dns: 'DNS', smtp: 'SMTP', dicom: 'DICOM C-ECHO', ntp: 'NTP', rtsp: 'RTSP', sip: 'SIP', mllp: 'HL7 MLLP', ipp: 'IPP', imap: 'IMAP', pop: 'POP' };
const protoLabel = (p) => PROTO_LABELS[p] || p || '';
const STATE_FILL = { u: '#16a34a', s: '#d97706', d: '#dc2626', q: '#64748b', '-': '#d1d5db' };
const ACT_WORDS = { ack: 'Acknowledged', report: 'Problem reported', expected: 'Expected (maintenance)' };
const KIND = 'monitoring';

const _rp = {
    invoke: null,      // tests: stands in for window.__TAURI__.core.invoke
    now: null,         // tests: the clock
    opts: null,        // the open report's choices
    data: null,        // what was read for them
    dataKey: '',
    seq: 0
};

function rpInvoke(cmd, args) {
    if (_rp.invoke) return Promise.resolve().then(() => _rp.invoke(cmd, args || {}));
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
const hasHost = () => !!_rp.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
const nowMs = () => (_rp.now ? _rp.now() : Date.now());
const floorHour = (ms) => Math.floor(ms / HOUR) * HOUR;
const ceilHour = (ms) => Math.ceil(ms / HOUR) * HOUR;
const dayOf = (ms) => Math.floor(ms / DAY) * DAY;

// ---- Formats (no language in the numbers, the words translated) ----
const msText = (v) => (v == null ? '—' : v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v)));
const pctText = (v) => {
    if (v == null) return '—';
    const p = v * 100;
    return (p >= 99.95 && p < 100 ? '99.9' : p === 100 || p === 0 ? String(p) : p.toFixed(p >= 10 ? 1 : 2).replace(/\.0+$/, '')) + ' %';
};
// A length of time in words: minutes, hours and minutes, days and hours.
function durText(ms) {
    if (ms == null || !Number.isFinite(ms)) return '—';
    const min = Math.max(0, Math.round(ms / 60000));
    if (min < 60) return t('{n} min', { n: min });
    if (min < 48 * 60) return t('{h} h {m} min', { h: Math.floor(min / 60), m: min % 60 });
    return t('{d} d {h} h', { d: Math.floor(min / 1440), h: Math.floor((min % 1440) / 60) });
}
function whenText(ms) { return typeof incidentWhen === 'function' ? incidentWhen(ms) : new Date(ms).toLocaleString(); }
const isoOf = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : '');
const round = (x, d = 3) => (x == null || !Number.isFinite(x) ? '' : String(Math.round(x * 10 ** d) / 10 ** d));

// ---- The period ----
// The last visit's end: the newest `visit` log entry (of these providers
// when given), its `left` else its time. -> ms or null.
function lastVisitAt(doc, providerIds) {
    const ids = providerIds && providerIds.length ? new Set(providerIds) : null;
    let at = null;
    (doc.log || []).forEach((e) => {
        if (!e || e.kind !== 'visit' || (ids && !ids.has(e.providerId))) return;
        const x = Number.isFinite(e.left) ? e.left : e.at;
        if (Number.isFinite(x) && (at === null || x > at)) at = x;
    });
    return at;
}
// -> { kind, from, to, now, visitAt? } or { kind, none: 'visit' | 'soon' }:
// whole hours, the last ending at the last whole hour; since a visit, from
// the first whole hour after it.
function periodRange(kind, opts = {}) {
    const now = Number.isFinite(opts.now) ? opts.now : nowMs();
    const to = floorHour(now);
    if (kind === 'visit') {
        const at = lastVisitAt(opts.doc || {}, opts.providerIds);
        if (at === null) return { kind, none: 'visit', now, to };
        const from = ceilHour(at);
        if (from >= to) return { kind, none: 'soon', now, to, visitAt: at };
        return { kind, from, to, now, visitAt: at };
    }
    const span = PERIOD_MS[kind] || PERIOD_MS.week;
    return { kind: PERIOD_MS[kind] ? kind : 'week', from: to - span, to, now };
}
// The step of the response-time charts: the shortest that gives at most 31
// points (an hour for a day, 6 hours for a week, a day for 30 days, a week
// for a quarter).
function stepFor(range) {
    const span = range.to - range.from;
    return STEPS.find((s) => span / s <= MAX_BUCKETS) || STEPS[STEPS.length - 1];
}

// ---- What is in the report ----
function docCtx(doc) { return { nodes: doc.nodes || [], links: doc.links || [], groups: doc.groups || [], providers: doc.providers || [] }; }
const hasChecks = (n) => !!n && Array.isArray(n.checks) && n.checks.length > 0;
// The watched addresses (v20, D371) as the report reads a device: their
// "w:" id (the statistics' and the outages'), name, group, providers,
// target and checks. Only the checked ones: one with no check has no state
// and is never in a figure (D380).
function watchItems(doc) {
    return (doc.watch || []).filter((w) => w && w.address && hasChecks(w)).map((w) => ({
        id: watchItemId(w.id), name: watchLabel(w), type: 'watch', group: w.group, providers: w.providers,
        target: w.target, checks: w.checks, interfaces: [], watch: true
    }));
}
// The document with its checked watched addresses among the devices.
const withWatchItems = (doc) => Object.assign({}, doc, { nodes: (doc.nodes || []).concat(watchItems(doc)) });
// The item an outage is about: its device, or its watched address's "w:" id.
const outageRoot = (inc) => (inc.nodeIds || [])[0] || ((inc.watchIds || [])[0] ? watchItemId(inc.watchIds[0]) : '');
// Every group a device is in, outermost first.
function groupsOfNode(n, groups) {
    const g = n && n.group ? groupById(n.group, groups) : null;
    return g ? groupChain(g, groups) : [];
}
function providersOf(doc, ids) {
    return (Array.isArray(ids) ? ids : [ids]).map((id) => (doc.providers || []).find((p) => p && p.id === id)).filter(Boolean);
}
function coveredIds(doc, providerIds) {
    const out = new Set();
    if (typeof providerCovers !== 'function') return out;
    (Array.isArray(providerIds) ? providerIds : [providerIds]).forEach((id) => {
        try { providerCovers(id, docCtx(doc)).nodes.forEach((n) => out.add(n.id)); } catch (e) { /* not a provider */ }
    });
    return out;
}
// The devices of the scope (all of them, checked or not: outages need the
// devices with no figure too).
function scopeNodes(doc, scope, id) {
    const nodes = doc.nodes || [];
    if (scope === 'node') return nodes.filter((n) => n.id === id);
    if (scope === 'group') return nodes.filter((n) => groupsOfNode(n, doc.groups || []).some((g) => g.id === id));
    if (scope === 'provider') { const c = coveredIds(doc, id); return nodes.filter((n) => c.has(n.id)); }
    return nodes.slice();
}
// The keys this network's checks are known by: "<device>/<check>".
function checkKeys(doc) {
    const out = [];
    withWatchItems(doc).nodes.forEach((n) => { if (hasChecks(n)) n.checks.forEach((c) => out.push(`${n.id}/${c.id}`)); });
    return out.slice(0, KEYS_MAX);
}

// ---- Support hours (D299) ----
// The hours a provider asks to be judged on: their support hours, when
// `targetHours` is set and the hours read. -> parsed hours or null.
function serviceHoursOf(p) {
    if (!p || !p.targetHours || !p.hours || typeof parseHours !== 'function') return null;
    const parsed = parseHours(p.hours);
    return parsed && !parsed.always ? parsed : null;
}
// Their support hours read as around the clock ("24/7"): judged on every
// hour, and said so, not called unreadable.
function hoursAlways(p) {
    if (!p || !p.hours || typeof parseHours !== 'function') return false;
    const parsed = parseHours(p.hours);
    return !!(parsed && parsed.always);
}
// Is the hour starting at h inside them (its middle, in this browser's time)?
const hourOpen = (parsed, h) => hoursOpenAt(parsed, new Date(h + HOUR / 2)) === true;

// ---- Figures ----
// Hourly figures summed: the checks, answered and failed, the seconds in
// each state, the median and 95th percentile of the hours weighted by their
// answers (as stats.rs daily), the jitter weighted the same, the extremes.
// spanS: the seconds that could have been measured (the period, or its
// support hours, times the monitors). -> the figures.
function sumHours(hours, spanS) {
    const f = { checks: 0, ok: 0, fail: 0, up: 0, slow: 0, down: 0, upstream: 0, maint: 0, unknown: 0, tcp: 0, min: null, max: null, med: null, p95: null, jitter: null, hours: 0 };
    const meds = [], p95s = [];
    let jw = 0, js = 0;
    hours.forEach((h) => {
        f.hours++;
        f.checks += h.checks || 0; f.ok += h.ok || 0; f.fail += h.fail || 0; f.tcp += h.tcp || 0;
        f.up += h.sUp || 0; f.slow += h.sSlow || 0; f.down += h.sDown || 0; f.upstream += h.sUpstream || 0;
        f.maint += h.sMaint || 0; f.unknown += h.sUnknown || 0;
        if (h.rttMin != null) f.min = f.min == null ? h.rttMin : Math.min(f.min, h.rttMin);
        if (h.rttMax != null) f.max = f.max == null ? h.rttMax : Math.max(f.max, h.rttMax);
        if (h.rttMed != null && h.ok > 0) meds.push([h.rttMed, h.ok]);
        if (h.rttP95 != null && h.ok > 0) p95s.push([h.rttP95, h.ok]);
        if (h.jitter != null && h.ok > 0) { js += h.jitter * h.ok; jw += h.ok; }
    });
    const weighted = (v, p) => {
        if (!v.length) return null;
        v.sort((a, b) => a[0] - b[0]);
        const total = v.reduce((s, x) => s + x[1], 0);
        const want = Math.max(1, Math.ceil(p * total));
        let acc = 0;
        for (const [x, w] of v) { acc += w; if (acc >= want) return x; }
        return v[v.length - 1][0];
    };
    f.med = weighted(meds, 0.5);
    f.p95 = weighted(p95s, 0.95);
    if (jw > 0) f.jitter = Math.round((js / jw) * 100) / 100;
    finishFigures(f, spanS);
    return f;
}
// Availability as seen (every second down), the device's own (the time down
// because of a device upstream left out, D300), the loss and the coverage.
function finishFigures(f, spanS) {
    const up = f.up + f.slow;
    f.avail = up + f.down > 0 ? up / (up + f.down) : null;
    const own = f.down - f.upstream;
    f.ownAvail = up + own > 0 ? up / (up + own) : null;
    f.loss = f.checks > 0 ? f.fail / f.checks : null;
    f.measured = up + f.down + f.maint;
    f.spanS = spanS;
    f.coverage = spanS > 0 ? Math.min(1, f.measured / spanS) : 0;
    return f;
}
// Several rows' figures pooled (a device, a group, a provider, the report):
// the seconds and checks added, the coverage over all their spans.
function pool(list) {
    const f = { checks: 0, ok: 0, fail: 0, up: 0, slow: 0, down: 0, upstream: 0, maint: 0, unknown: 0, rows: 0 };
    let span = 0;
    list.forEach((x) => {
        ['checks', 'ok', 'fail', 'up', 'slow', 'down', 'upstream', 'maint', 'unknown'].forEach((k) => { f[k] += x[k] || 0; });
        span += x.spanS || 0;
        f.rows++;
    });
    return finishFigures(f, span);
}
// The worst state of a bucket: down, slow, answering, quiet, unknown.
function bucketState(f) {
    if (f.down > 0) return 'd';
    if (f.slow > 0) return 's';
    if (f.up > 0) return 'u';
    if (f.maint > 0) return 'q';
    return '-';
}
// The Expected act of an issue (any of its acts: the monitor marks the
// time as maintenance whenever Expected is chosen), or null.
const expectedAct = (inc) => (inc.acts || []).find((a) => a && a.act === 'expected') || null;
// "down because R1": which outages had this device behind their root
// cause during an hour. -> the root's device id, or '' when none says.
function causeAt(outages, nodeId, from, to) {
    for (const inc of outages) {
        if (!(inc.behind || []).includes(nodeId)) continue;
        if ((inc.outages || []).some((o) => o.from < to && (o.to == null ? Infinity : o.to) > from)) return (inc.nodeIds || [])[0] || '';
    }
    return '';
}

// ---- The model ----
// opts: { scope, id, period, basis ('all' | 'hours'), parts, range }.
// data: { source, streams: [{ key, monitor, name, hours }], statsDays, off,
// error }. Numbers and names only: the words are put on when it is drawn,
// so a language switch redraws the same model.
function buildModel(docIn, data, opts) {
    // The checked watched addresses are rows like the devices (D371).
    const doc = withWatchItems(docIn);
    const scope = SCOPES.includes(opts.scope) ? opts.scope : 'site';
    const range = opts.range;
    const ok = !!range && !range.none;
    const outagesAll = (doc.incidents || []).filter((x) => typeof isOutage === 'function' ? isOutage(x) : x && x.kind === 'outage');
    const nodes = scopeNodes(doc, scope, opts.id);
    const inScope = new Set(nodes.map((n) => n.id));
    const nameOf = (id) => { const n = (doc.nodes || []).find((x) => x.id === id); return n ? (typeof locPlainName === 'function' ? locPlainName(n) : n.name || n.id) : id; };
    const provs = scope === 'provider' ? providersOf(doc, opts.id) : [];
    // One provider's report: theirs is the report's target and hours. A
    // report on several (a Report a problem sent to more than one) judges
    // each device on its own provider and pools nothing against one
    // provider's target (D312).
    const prov = provs.length === 1 ? provs[0] : null;
    const covCache = new Map();
    const covers = (pid, nid) => { if (!covCache.has(pid)) covCache.set(pid, coveredIds(doc, pid)); return covCache.get(pid).has(nid); };
    // Support hours only for one provider's report, when they ask for it and
    // their hours read (D299).
    const parsed = scope === 'provider' && opts.basis === 'hours' ? serviceHoursOf(prov) : null;
    const hourIn = (h) => (!parsed || hourOpen(parsed, h));
    let spanHours = 0;
    if (ok) for (let h = range.from; h < range.to; h += HOUR) if (hourIn(h)) spanHours++;
    const spanS = spanHours * 3600;
    // Expected outages are maintenance (D158, D245). This PC's monitor
    // rewrites its own hours when Expected is chosen (stats.rs
    // mark_maintenance), but a blob it pushed to the server on an earlier
    // day keeps the time as down; so the device's own time down inside an
    // Expected outage moves to maintenance here, as mark_maintenance does
    // (the root device's checks, never the upstream time). An hour already
    // rewritten has no own time down left, so nothing moves twice (D313).
    const expSpans = new Map();
    outagesAll.forEach((inc) => {
        const ex = expectedAct(inc);
        const root = outageRoot(inc);
        if (!ex || !root) return;
        if (!expSpans.has(root)) expSpans.set(root, []);
        (inc.outages || []).forEach((o) => expSpans.get(root).push([o.from, Math.max(o.from, Number.isFinite(o.to) ? o.to : ex.at)]));
    });
    const asMaint = (key, h) => {
        const spans = expSpans.get(key.slice(0, key.lastIndexOf('/')));
        if (!spans) return h;
        const own = (h.sDown || 0) - (h.sUpstream || 0);
        if (!(own > 0)) return h;
        const over = spans.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, h.hour + HOUR) - Math.max(a, h.hour)), 0) / 1000;
        const move = Math.min(own, over);
        return move > 0 ? Object.assign({}, h, { sDown: h.sDown - move, sMaint: (h.sMaint || 0) + move }) : h;
    };
    // The streams of each check, this period's hours only.
    const byKey = new Map();
    ((data && data.streams) || []).forEach((s) => {
        const hours = ok ? (s.hours || []).filter((h) => h && h.hour >= range.from && h.hour < range.to && hourIn(h.hour)).map((h) => asMaint(s.key || '', h)) : [];
        if (!byKey.has(s.key)) byKey.set(s.key, []);
        byKey.get(s.key).push({ monitor: s.monitor, name: s.name || '', hours });
    });
    const step = ok ? stepFor(range) : HOUR;
    const rows = [];
    nodes.filter(hasChecks).forEach((n) => {
        n.checks.forEach((c) => {
            const key = `${n.id}/${c.id}`;
            const streams = (byKey.get(key) || []).filter((s) => s.hours.length);
            const all = [].concat(...streams.map((s) => s.hours));
            const fig = sumHours(all, spanS * Math.max(1, streams.length));
            // The target: the device's, else its provider's (the first of
            // the report's providers that covers it and has one, else any
            // provider covering it that has one; never a provider that does
            // not cover it, D312).
            let target = Number.isFinite(n.target) ? n.target : null, targetFrom = target != null ? 'device' : '';
            if (target == null) {
                const has = (p) => p && Number.isFinite(p.target) && covers(p.id, n.id);
                const tp = provs.find(has) || (doc.providers || []).find(has);
                if (tp) { target = tp.target; targetFrom = 'provider'; }
            }
            // Down because of a device upstream, by cause (D161).
            const causes = new Map();
            all.forEach((h) => {
                if (!(h.sUpstream > 0)) return;
                const cid = causeAt(outagesAll, n.id, h.hour, h.hour + HOUR);
                causes.set(cid, (causes.get(cid) || 0) + h.sUpstream);
            });
            // The chart's buckets.
            const series = [];
            if (ok) {
                for (let b = range.from; b < range.to; b += step) {
                    const hs = all.filter((h) => h.hour >= b && h.hour < b + step);
                    let bSpan = 0;
                    for (let h = b; h < Math.min(b + step, range.to); h += HOUR) if (hourIn(h)) bSpan += 3600;
                    const bf = sumHours(hs, bSpan * Math.max(1, streams.length));
                    series.push({ from: b, to: Math.min(b + step, range.to), med: bf.med, p95: bf.p95, loss: bf.loss, avail: bf.avail, coverage: bf.coverage, state: bucketState(bf), checks: bf.checks });
                }
            }
            // The slow time by hour of the day (this browser's time).
            const slowByHour = new Array(24).fill(0);
            all.forEach((h) => { if (h.sSlow > 0) slowByHour[new Date(h.hour).getHours()] += h.sSlow; });
            rows.push(Object.assign(fig, {
                key, node: n.id, check: c.id, name: nameOf(n.id), proto: c.proto, slowMs: c.slowMs || null,
                via: c.proto === 'ping' && fig.tcp > 0 ? 'tcp' : '',
                monitors: streams.map((s) => s.name || s.monitor).filter(Boolean),
                target, targetFrom, met: target != null && fig.ownAvail != null ? fig.ownAvail * 100 >= target - 1e-9 : null,
                causes: [...causes.entries()].map(([id, s]) => ({ id, name: id ? nameOf(id) : '', s })).sort((a, b) => b.s - a.s),
                series, slowByHour
            }));
        });
    });
    // Pooled: per device, per group, per provider, the report.
    const devices = [];
    nodes.filter(hasChecks).forEach((n) => {
        const mine = rows.filter((r) => r.node === n.id);
        const f = pool(mine);
        const tg = mine.length ? mine[0].target : null;
        devices.push(Object.assign(f, { node: n.id, name: nameOf(n.id), target: tg, met: tg != null && f.ownAvail != null ? f.ownAvail * 100 >= tg - 1e-9 : null }));
    });
    const total = pool(rows);
    if (scope === 'provider' && prov && Number.isFinite(prov.target)) { total.target = prov.target; total.met = total.ownAvail != null ? total.ownAvail * 100 >= prov.target - 1e-9 : null; }
    else if (scope === 'node' && rows.length && rows[0].target != null) { total.target = rows[0].target; total.met = total.ownAvail != null ? total.ownAvail * 100 >= total.target - 1e-9 : null; }
    let groups = [], providers = [];
    if (scope === 'site' || scope === 'group') {
        const gl = doc.groups || [];
        const seen = new Map();
        rows.forEach((r) => {
            const n = (doc.nodes || []).find((x) => x.id === r.node);
            const chain = groupsOfNode(n, gl);
            // A group's report lists the groups inside it only: never itself
            // or the groups it is in, whose rows would hold only its devices.
            const at = scope === 'group' ? chain.findIndex((g) => g.id === opts.id) : -1;
            chain.slice(at + 1).forEach((g) => {
                if (!seen.has(g.id)) seen.set(g.id, []);
                seen.get(g.id).push(r);
            });
        });
        groups = [...seen.entries()].slice(0, GROUPS_MAX).map(([id, list]) => {
            const g = groupById(id, gl);
            return Object.assign(pool(list), { id, name: g ? groupPath(g, gl) : id });
        });
    }
    // Per provider: the whole network's report, and a report on several
    // providers. One judged only in their support hours gets no verdict on
    // around-the-clock figures: their own report gives it (D312).
    if (scope === 'site' || (scope === 'provider' && provs.length > 1)) {
        providers = (scope === 'site' ? doc.providers || [] : provs).map((p) => {
            const list = rows.filter((r) => covers(p.id, r.node));
            if (!list.length) return null;
            const f = pool(list);
            const tg = Number.isFinite(p.target) ? p.target : null;
            const hoursOnly = !!serviceHoursOf(p);
            return Object.assign(f, { id: p.id, name: typeof providerLabel === 'function' ? providerLabel(p) : p.name || p.id, target: tg,
                met: tg != null && !hoursOnly && f.ownAvail != null ? f.ownAvail * 100 >= tg - 1e-9 : null, hoursOnly });
        }).filter(Boolean);
    }
    // The outages: every issue of a device in scope (its own, or one it was
    // behind) with a time down in the period, which for the outages runs on
    // to now, so one going on in this hour is listed (the report says so).
    // No period (no visit yet, or less than an hour since): none (D314).
    const outs = [];
    const lo = ok ? range.from : Infinity, hi = ok ? range.now : -Infinity;
    if (ok) outagesAll.forEach((inc) => {
        const root = outageRoot(inc);
        const behindHere = (inc.behind || []).filter((id) => inScope.has(id));
        if (!inScope.has(root) && !behindHere.length) return;
        const spans = (inc.outages || []).filter((o) => o.from < hi && (o.to == null ? Infinity : o.to) > lo);
        if (!spans.length) return;
        const clip = (o) => Math.max(0, Math.min(o.to == null ? hi : o.to, hi) - Math.max(o.from, lo));
        const firstAct = (inc.acts || [])[0] || null;
        const first = (inc.outages || [])[0];
        const ex = expectedAct(inc);
        outs.push({
            id: inc.id, node: root, name: nameOf(root), own: inScope.has(root),
            behind: (inc.behind || []).map(nameOf), behindHere: behindHere.map(nameOf),
            from: spans[0].from, to: spans[spans.length - 1].to == null ? null : spans[spans.length - 1].to,
            downMs: spans.reduce((s, o) => s + clip(o), 0), times: spans.length,
            flapping: !!inc.flapping, gone: !!inc.gone, monitor: inc.monitor || '',
            expected: !!ex, recordOnly: !!inc.recordOnly,
            acts: (inc.acts || []).map((a) => ({ act: a.act, at: a.at, by: a.by || '', note: a.note || '' })),
            ackMs: firstAct && first ? Math.max(0, firstAct.at - first.from) : null
        });
    });
    outs.sort((a, b) => a.from - b.from);
    // MTTR and MTBF per device in scope, from its own outages (Expected is
    // maintenance, not a failure, D303): the spans that started in the
    // period; repair is a span's length, the time between failures the
    // period's time up divided by them.
    const reliab = [];
    if (ok) {
        const periodMs = range.now - range.from;
        nodes.forEach((n) => {
            const spans = [];
            outagesAll.forEach((inc) => {
                if (outageRoot(inc) !== n.id) return;
                if (expectedAct(inc)) return;
                (inc.outages || []).forEach((o) => { if (o.from >= range.from && o.from < range.now) spans.push(o); });
            });
            if (!spans.length) return;
            const ended = spans.filter((o) => Number.isFinite(o.to));
            const down = spans.reduce((s, o) => s + Math.max(0, Math.min(Number.isFinite(o.to) ? o.to : range.now, range.now) - o.from), 0);
            reliab.push({ node: n.id, name: nameOf(n.id), failures: spans.length, downMs: down,
                mttr: ended.length ? ended.reduce((s, o) => s + (o.to - o.from), 0) / ended.length : null,
                mtbf: Math.max(0, periodMs - down) / spans.length });
        });
    }
    // The slow hours of the day, every check together.
    const slowByHour = new Array(24).fill(0);
    rows.forEach((r) => r.slowByHour.forEach((s, i) => { slowByHour[i] += s; }));
    const meta = typeof providerReportMeta === 'function' ? providerReportMeta(doc) : { site: '', client: '', date: '' };
    const connections = scope === 'site' && ok && data && Array.isArray(data.connections) ? connectionRows(data.connections, range) : null;
    return {
        connections,
        scope, id: opts.id || null, period: range ? range.kind : opts.period, range, basis: parsed ? 'hours' : 'all',
        hoursAsked: scope === 'provider' && opts.basis === 'hours', hoursRead: !!parsed, hoursAlways: scope === 'provider' && opts.basis === 'hours' && hoursAlways(prov),
        several: provs.length > 1,
        provider: prov ? { id: prov.id, name: typeof providerLabel === 'function' ? providerLabel(prov) : prov.name || prov.id, hours: prov.hours || '', target: Number.isFinite(prov.target) ? prov.target : null, targetHours: !!prov.targetHours } : null,
        scopeName: scope === 'node' ? nameOf(opts.id) : scope === 'group' ? (groupById(opts.id, doc.groups || []) ? groupPath(groupById(opts.id, doc.groups || []), doc.groups || []) : opts.id)
            : scope === 'provider' ? provs.map((p) => (typeof providerLabel === 'function' ? providerLabel(p) : p.name)).join(', ') : '',
        parts: (opts.parts || PARTS).filter((p) => PARTS.includes(p)),
        source: (data && data.source) || 'none', off: !!(data && data.off), error: !!(data && data.error), statsDays: data && Number.isFinite(data.statsDays) ? data.statsDays : null,
        checked: nodes.filter(hasChecks).length, step,
        // What was checked, named (D380): devices and watched addresses apart.
        checkedDevices: nodes.filter((n) => hasChecks(n) && !n.watch).length, checkedWatch: nodes.filter((n) => hasChecks(n) && n.watch).length,
        rows, devices, groups, providers, total, outages: outs, reliability: reliab, slowByHour, meta
    };
}

// The Connections section's rows (D379): per watched PC and site monitor,
// the time connected over the time watched in the period (from when it was
// first watched), and each gap clipped to the period with who saw it.
function connectionRows(clients, range) {
    const lo = range.from, hi = range.now || range.to;
    return clients.map((c) => {
        const from = Math.max(lo, Number(c.since) || lo);
        const span = Math.max(0, hi - from);
        const gaps = (Array.isArray(c.gaps) ? c.gaps : []).map((g) => {
            const a = Math.max(from, g.from), b = Math.min(hi, g.to || hi);
            return b > a ? { from: g.from, to: g.to || null, ms: b - a, seenBy: g.seenBy === 'client' ? 'client' : 'server' } : null;
        }).filter(Boolean);
        // The server's view: the time it saw no beat (the PC's own gaps are
        // the server not answering it, listed, not counted twice).
        const down = gaps.filter((g) => g.seenBy === 'server').reduce((s, g) => s + g.ms, 0);
        return { id: c.id, kind: c.kind === 'monitor' ? 'monitor' : 'pc', name: c.name || c.id, email: c.email || '', lost: !!c.lost, away: !!c.away,
            connected: span > 0 ? Math.max(0, span - down) / span : null, watchedMs: span, gaps };
    });
}

// ---- Reading the figures ----
// -> { source: 'server' | 'local' | 'none', streams, statsDays, off, error }.
// A server's site: its monitors' blobs (any signed-in page); else this PC's
// own monitor when it monitors the open network; else nothing (D298).
async function gather(range, doc) {
    if (!range || range.none) return { source: 'none', streams: [] };
    const M = window.TopoMonitors;
    const site = M && typeof M.siteOfOpen === 'function' ? M.siteOfOpen() : null;
    if (site) {
        let st;
        try { st = await M.loadMonitors(site); } catch (e) { return { source: 'server', streams: [], error: true }; }
        // The connections (step 8f, D379): the site's watched PCs and monitors.
        let connections = null;
        if (window.TopoConnections) { try { connections = await TopoConnections.siteConnections(site, range.from, range.to); } catch (e) { connections = null; } }
        if (st.statsDays === 0) return { source: 'server', streams: [], off: true, statsDays: 0, connections };
        const names = new Map((st.monitors || []).map((m) => [m.id, m.name || '']));
        let blobs;
        try { blobs = await M.stats(site, dayOf(range.from), dayOf(range.to - 1)); } catch (e) { return { source: 'server', streams: [], error: true, statsDays: st.statsDays }; }
        const by = new Map();
        blobs.forEach((b) => Object.keys(b.checks || {}).forEach((key) => {
            const id = `${key}|${b.monitor}`;
            if (!by.has(id)) by.set(id, { key, monitor: b.monitor, name: b.name || names.get(b.monitor) || '', hours: [] });
            const x = b.checks[key];
            if (x && Array.isArray(x.hours)) by.get(id).hours.push(...x.hours);
        }));
        return { source: 'server', streams: [...by.values()], statsDays: st.statsDays, connections };
    }
    if (hasHost()) {
        const C = window.TopoChecks;
        let info = C && C.state.info;
        if (!info && C && typeof C.refreshInfo === 'function') { try { await C.refreshInfo(); info = C.state.info; } catch (e) { info = null; } }
        if (info && info.networkId && info.networkId === state.libraryId) {
            if (!info.retentionDays) return { source: 'local', streams: [], off: true, statsDays: 0 };
            let got = {};
            try { got = (await rpInvoke('monitor_figures', { keys: checkKeys(doc), from: range.from, to: range.to })) || {}; }
            catch (e) { return { source: 'local', streams: [], error: true, statsDays: info.retentionDays }; }
            const name = info.monitorName || t('This PC');
            return { source: 'local', streams: Object.keys(got).map((key) => ({ key, monitor: 'local', name, hours: got[key] || [] })), statsDays: info.retentionDays };
        }
    }
    return { source: 'none', streams: [] };
}

// ---- Drawing ----
const esc = (s) => escapeHtml(String(s == null ? '' : s));
// The chart of one check: the median (solid) and the 95th percentile
// (dashed) over the period, the state of each step under it (Branding Data
// Viz: an inline SVG with no library; green answering, amber slow, red
// down, grey quiet or unknown), its scale said under it.
function chartSvg(r, label) {
    const s = r.series || [];
    if (!s.length) return '';
    const W = 300, H = 64, n = s.length;
    const max = Math.max(1, ...s.map((b) => b.p95 || b.med || 0));
    const line = (pick) => {
        let d = '', pen = false;
        s.forEach((b, i) => {
            const v = b[pick];
            if (v == null) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${((i + 0.5) * W / n).toFixed(1)} ${(H - 2 - (v / max) * (H - 8)).toFixed(1)}`;
            pen = true;
        });
        return d;
    };
    const bar = s.map((b, i) => `<rect x="${(i * W / n).toFixed(2)}" y="0" width="${(W / n + 0.05).toFixed(2)}" height="7" fill="${STATE_FILL[b.state] || STATE_FILL['-']}"/>`).join('');
    return `<figure class="mr-chart"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">`
        + `<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="#9ca3af" stroke-width="1" vector-effect="non-scaling-stroke"/>`
        + `<path d="${line('p95')}" fill="none" stroke="#2563eb" stroke-opacity=".55" stroke-width="1.2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`
        + `<path d="${line('med')}" fill="none" stroke="#2563eb" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`
        + `<svg viewBox="0 0 ${W} 7" width="100%" height="7" preserveAspectRatio="none" aria-hidden="true">${bar}</svg>`
        + `<figcaption>${esc(t('Solid: median; dashed: 95th percentile; up to {ms} ms. Bar: green answering, amber slow, red not answering, grey quiet or unknown.', { ms: msText(max) }))}</figcaption></figure>`;
}
// A figure with how much of the period was measured under it (D163).
const withCov = (f) => `${esc(pctText(f.avail))}<br><span class="dim">${esc(t('{pct} measured', { pct: pctText(f.coverage) }))}</span>`;
function targetCell(f) {
    if (f.target == null) return '—';
    const verdict = f.met == null ? '' : f.met ? t('met') : t('missed');
    return `${esc(t('{pct} %', { pct: f.target }))}${verdict ? `<br><span class="${f.met ? 'ok' : 'bad'}">${esc(verdict)}</span>` : ''}`;
}
function ownCell(f) {
    if (!(f.upstream > 0)) return esc(pctText(f.ownAvail));
    return `${esc(pctText(f.ownAvail))}<br><span class="dim">${esc(t('{time} down because of a device upstream left out', { time: durText(f.upstream * 1000) }))}</span>`;
}
const rowName = (r) => `${r.name} · ${protoLabel(r.proto)}`;
function causeLines(r) {
    if (!r.causes || !r.causes.length) return '';
    return r.causes.map((c) => `<br><span class="dim">${esc(c.id ? t('down because {name}: {time}', { name: c.name, time: durText(c.s * 1000) }) : t('down because of a device upstream: {time}', { time: durText(c.s * 1000) }))}</span>`).join('');
}
function periodText(m) {
    const r = m.range || {};
    if (r.none === 'visit') return t('No visit has been recorded on this network yet.');
    if (r.none === 'soon') return t('The last visit ended less than an hour ago: there is no whole hour since.');
    const line = t('{period}: {from} to {to}.', { period: t(PERIOD_WORDS[m.period] || PERIOD_WORDS.week), from: whenText(r.from), to: whenText(r.to) });
    return m.parts.includes('outages') ? line + ' ' + t('The outages are listed up to {time}.', { time: whenText(r.now) }) : line;
}
// What the figures are about, never more (D380): "Checked: 12 devices and 3
// watched addresses". Nothing unchecked is counted or said to be down.
function checkedText(m) {
    const d = m.checkedDevices || 0, w = m.checkedWatch || 0;
    if (!d && !w) return '';
    const dev = tn(d, '{n} device', '{n} devices'), wat = tn(w, '1 watched address', '{n} watched addresses');
    const what = d && w ? t('{list} and {last}', { list: dev, last: wat }) : d ? dev : wat;
    return t('Checked: {what}. Anything not checked has no figures here.', { what });
}
function sourceText(m) {
    if (m.off) return t('Statistics are off for this network: no figures are kept. The outages below come from the network itself.');
    if (m.error) return m.source === 'server' ? t('The site\'s figures could not be read from the server. The outages below come from the network itself.')
        : t('This PC\'s figures could not be read. The outages below come from the network itself.');
    if (m.source === 'server') return t('Figures: the site\'s monitors, through the Topo server.');
    if (m.source === 'local') return t('Figures: this PC\'s monitor.');
    return hasHost() ? t('No figures: this PC does not monitor this network, and it is not a Topo server\'s site. Turn on Monitor from this PC in Settings to collect them.')
        : t('No figures: statistics are collected by a Topo desktop app that monitors this network, and read here when the network is opened from its Topo server.');
}
function keptNote(m) {
    const r = m.range;
    if (!r || r.none || !m.statsDays || m.off) return '';
    return r.from < r.to - m.statsDays * DAY ? t('Statistics are kept {n} days, so the start of this period has no figures.', { n: m.statsDays }) : '';
}
function basisText(m) {
    if (m.scope !== 'provider') return '';
    if (m.basis === 'hours') return t('Only during their support hours ({hours}), in this PC\'s time.', { hours: m.provider ? m.provider.hours : '' });
    if (m.several) return t('Around the clock; each device is judged on its own provider\'s target.');
    if (m.hoursAsked && m.hoursAlways) return t('Around the clock: their support hours are {hours}.', { hours: m.provider ? m.provider.hours : '' });
    if (m.hoursAsked && !m.hoursRead) return t('Their support hours do not read as days and times, so the whole day counts.');
    return t('Around the clock.');
}
const SCOPE_TITLE = { site: 'Monitoring report', group: 'Monitoring report: {name}', node: 'Monitoring report: {name}', provider: 'Monitoring report: {name}' };
function titleOf(m) { return t(SCOPE_TITLE[m.scope] || SCOPE_TITLE.site, { name: m.scopeName }); }

// The stat tiles at the top (Branding .stat-tile): availability with its
// coverage, the target, the outages, the median.
function tilesHtml(m) {
    const f = m.total;
    const tile = (label, value, sub, cls = '') => `<div class="tile ${cls}"><div class="tl">${esc(label)}</div><div class="tv">${esc(value)}</div>${sub ? `<div class="ts">${esc(sub)}</div>` : ''}</div>`;
    const meds = m.rows.filter((r) => r.med != null).map((r) => [r.med, r.ok]);
    const med = sumHours(m.rows.filter((r) => r.med != null).map((r) => ({ rttMed: r.med, ok: r.ok })), 0).med;
    const out = [
        tile(t('Availability'), pctText(f.avail), t('{pct} measured', { pct: pctText(f.coverage) })),
        f.target != null ? tile(t('Target'), t('{pct} %', { pct: f.target }), f.met == null ? '' : f.met ? t('met') : t('missed'), f.met === false ? 'bad' : f.met ? 'ok' : '') : '',
        tile(t('Outages'), String(m.outages.filter((o) => !o.expected).length), m.outages.some((o) => o.expected) ? tn(m.outages.filter((o) => o.expected).length, '{n} expected (maintenance)', '{n} expected (maintenance)') : ''),
        meds.length ? tile(t('Median'), t('{ms} ms', { ms: msText(med) }), '') : ''
    ];
    return `<div class="tiles">${out.join('')}</div>`;
}
function availabilityHtml(m) {
    if (!m.rows.length) return `<p class="dim">${esc(m.checked ? '' : t('No device here has an answer check: add one in a device\'s Answer checks.'))}</p>`;
    const head = `<thead><tr><th>${esc(t('Device · check'))}</th><th>${esc(t('Availability'))}</th><th>${esc(t('Not counting upstream'))}</th><th>${esc(t('Target'))}</th><th>${esc(t('Down'))}</th><th>${esc(t('Maintenance'))}</th><th>${esc(t('Loss'))}</th></tr></thead>`;
    const row = (r) => `<tr><td>${esc(rowName(r))}${r.via ? `<br><span class="dim">${esc(t('TCP, not ping'))}</span>` : ''}${r.monitors.length > 1 || m.source === 'server' && r.monitors.length ? `<br><span class="dim">${esc(t('Checked by {names}', { names: r.monitors.join(', ') }))}</span>` : ''}${causeLines(r)}</td>`
        + `<td>${withCov(r)}</td><td>${ownCell(r)}</td><td>${targetCell(r)}</td><td>${esc(r.hours ? durText(r.down * 1000) : '—')}</td><td>${esc(r.hours ? durText(r.maint * 1000) : '—')}</td><td>${esc(pctText(r.loss))}</td></tr>`;
    let html = `<table>${head}<tbody>${m.rows.map(row).join('')}</tbody></table>`;
    const pooled = (title, list, nameKey = 'name') => (list.length ? `<h3>${esc(title)}</h3><table><thead><tr><th></th><th>${esc(t('Availability'))}</th><th>${esc(t('Not counting upstream'))}</th><th>${esc(t('Target'))}</th><th>${esc(t('Down'))}</th></tr></thead><tbody>`
        + list.map((x) => `<tr><td>${esc(x[nameKey])}${x.hoursOnly ? `<br><span class="dim">${esc(t('Their target counts during their support hours: see their own report.'))}</span>` : ''}</td><td>${withCov(x)}</td><td>${ownCell(x)}</td><td>${targetCell(x)}</td><td>${esc(durText(x.down * 1000))}</td></tr>`).join('') + '</tbody></table>' : '');
    if (m.devices.length > 1 && m.devices.length < m.rows.length) html += pooled(t('Per device'), m.devices);
    html += pooled(t('Per group'), m.groups);
    html += pooled(t('Per provider'), m.providers);
    return html;
}
function responseHtml(m, opts = {}) {
    const rows = m.rows.filter((r) => r.checks > 0);
    if (!rows.length) return `<p class="dim">${esc(t('No response times in this period.'))}</p>`;
    const sum = `<table><thead><tr><th>${esc(t('Device · check'))}</th><th>${esc(t('Median (ms)'))}</th><th>${esc(t('95th percentile (ms)'))}</th><th>${esc(t('Jitter (ms)'))}</th><th>${esc(t('Fastest · slowest (ms)'))}</th><th>${esc(t('Loss'))}</th><th>${esc(t('Slow'))}</th></tr></thead><tbody>`
        + rows.map((r) => `<tr><td>${esc(rowName(r))}${r.via ? `<br><span class="dim">${esc(t('TCP, not ping'))}</span>` : ''}</td><td>${esc(msText(r.med))}</td><td>${esc(msText(r.p95))}</td><td>${esc(msText(r.jitter))}</td>`
            + `<td>${esc(`${msText(r.min)} · ${msText(r.max)}`)}</td><td>${esc(pctText(r.loss))}</td><td>${esc(r.slow > 0 ? durText(r.slow * 1000) : '—')}</td></tr>`).join('') + '</tbody></table>';
    if (opts.compact) return sum;
    const stepWord = m.step >= 7 * DAY ? t('a week') : m.step >= DAY ? t('a day') : m.step >= 6 * HOUR ? t('6 hours') : t('an hour');
    const charts = rows.map((r) => `<div class="mr-item"><h3>${esc(rowName(r))}</h3><div class="mr-pair">${chartSvg(r, t('Response time over the period: {name}', { name: rowName(r) }))}`
        + `<table class="mr-steps"><thead><tr><th>${esc(t('From'))}</th><th>${esc(t('Median (ms)'))}</th><th>${esc(t('95th percentile (ms)'))}</th><th>${esc(t('Loss'))}</th></tr></thead><tbody>`
        + r.series.map((b) => `<tr><td>${esc(whenText(b.from))}</td><td>${esc(msText(b.med))}</td><td>${esc(msText(b.p95))}</td><td>${esc(pctText(b.loss))}</td></tr>`).join('') + '</tbody></table></div></div>').join('');
    const slowAny = m.slowByHour.some((s) => s > 0);
    const slow = slowAny ? `<h3>${esc(t('Slow hours of the day'))}</h3><p class="dim">${esc(t('The time every check was slower than its "slow above", by the hour of the day it fell in (this PC\'s time).'))}</p>`
        + `<table><thead><tr><th>${esc(t('Hour'))}</th><th>${esc(t('Slow'))}</th></tr></thead><tbody>`
        + m.slowByHour.map((s, h) => (s > 0 ? `<tr><td>${esc(`${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`)}</td><td>${esc(durText(s * 1000))}</td></tr>` : '')).join('') + '</tbody></table>'
        : `<p class="dim">${esc(t('No check was slow in this period.'))}</p>`;
    return sum + `<p class="dim">${esc(t('Each point of the charts is {step}.', { step: stepWord }))}</p>` + charts + slow;
}
function connectionsHtml(m) {
    const list = m.connections || [];
    if (!list.length) return `<p class="dim">${esc(t('No PC\'s connection is watched on this site, and it has no monitor.'))}</p>`;
    const kindWord = (r) => t(r.kind === 'monitor' ? 'Site monitor' : 'Watched PC');
    const seen = (g) => t(g.seenBy === 'client' ? 'the PC: the server not answering' : 'the server: lost');
    return `<table><thead><tr><th>${esc(t('PC'))}</th><th>${esc(t('Connected'))}</th><th>${esc(t('Gaps'))}</th></tr></thead><tbody>`
        + list.map((r) => `<tr><td>${esc(r.name)}<br><span class="dim">${esc([kindWord(r), r.email].filter(Boolean).join(' · '))}</span>${r.lost ? `<br><span class="bad">${esc(t('lost its connection'))}</span>` : ''}</td>`
            + `<td>${esc(r.connected == null ? '—' : pctText(r.connected))}</td>`
            + `<td>${r.gaps.length ? r.gaps.map((g) => esc(t('{from}, {time}, seen by {who}', { from: whenText(g.from), time: durText(g.ms), who: seen(g) }))).join('<br>') : esc(t('None'))}</td></tr>`).join('')
        + '</tbody></table>';
}
function actText(a) {
    const what = t(ACT_WORDS[a.act] || 'Acknowledged');
    return a.by ? t('{what} by {name}, {time}', { what, name: a.by, time: whenText(a.at) }) : t('{what}, {time}', { what, time: whenText(a.at) });
}
function outagesHtml(m, opts = {}) {
    const list = m.outages;
    let html = list.length ? `<table><thead><tr><th>${esc(t('Device'))}</th><th>${esc(t('Not answering from'))}</th><th>${esc(t('Down for'))}</th><th>${esc(t('Root cause'))}</th><th>${esc(t('Who acted'))}</th><th>${esc(t('Time to acknowledge'))}</th></tr></thead><tbody>`
        + list.map((o) => {
            const cause = o.own ? (o.behind.length ? tn(o.behind.length, 'Its own; {n} device behind it', 'Its own; {n} devices behind it') : t('Its own')) : t('down because {name}', { name: o.name });
            const who = o.acts.length ? o.acts.map(actText).map(esc).join('<br>') : esc(o.recordOnly ? '—' : t('Nobody yet'));
            const extra = [o.recordOnly ? t('Recorded only: no issue was raised.') : '', o.times > 1 ? t('Went down {n} times while open.', { n: o.times }) : '', o.flapping ? t('It keeps going down and coming back (flapping).') : '', o.gone ? t('No longer checked.') : '', o.monitor ? t('Checked by monitor {pc}.', { pc: o.monitor }) : ''].filter(Boolean);
            return `<tr><td>${esc(o.own ? o.name : o.behindHere.join(', '))}${extra.length ? `<br><span class="dim">${esc(extra.join(' '))}</span>` : ''}</td>`
                + `<td>${esc(whenText(o.from))}${o.to == null ? `<br><span class="bad">${esc(t('still not answering'))}</span>` : ''}</td><td>${esc(durText(o.downMs))}</td><td>${esc(cause)}</td><td>${who}</td><td>${esc(o.ackMs == null ? '—' : durText(o.ackMs))}</td></tr>`;
        }).join('') + '</tbody></table>'
        : `<p class="dim">${esc(t('No outage in this period.'))}</p>`;
    if (!opts.compact && m.reliability.length) {
        html += `<h3>${esc(t('Time to repair and between failures'))}</h3><p class="dim">${esc(t('Per device, from its own outages in this period (Expected ones are maintenance, not failures). MTTR: the mean time down; MTBF: the time answering divided by the failures.'))}</p>`
            + `<table><thead><tr><th>${esc(t('Device'))}</th><th>${esc(t('Failures'))}</th><th>${esc(t('Down'))}</th><th>MTTR</th><th>MTBF</th></tr></thead><tbody>`
            + m.reliability.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.failures}</td><td>${esc(durText(x.downMs))}</td><td>${esc(durText(x.mttr))}</td><td>${esc(durText(x.mtbf))}</td></tr>`).join('') + '</tbody></table>';
    }
    return html;
}
const SECTION_CSS = `.mr table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin: 4px 0 8px; font-variant-numeric: tabular-nums; }
.mr th, .mr td { text-align: left; vertical-align: top; padding: 3px 6px; border-bottom: 1px solid var(--rule, #d1d5db); }
.mr th { font-weight: 600; color: var(--dim, #4b5563); }
.mr .dim { color: var(--dim, #4b5563); } .mr .ok { color: #15803d; font-weight: 600; } .mr .bad { color: #b91c1c; font-weight: 600; }
.mr h3 { font-size: 13.5px; margin: 10px 0 4px; }
.mr .tiles { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; }
.mr .tile { border: 1px solid var(--rule, #d1d5db); border-radius: 6px; padding: 6px 10px; min-width: 120px; flex: 1 1 120px; }
.mr .tile .tl { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--dim, #4b5563); }
.mr .tile .tv { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mr .tile .ts { font-size: 11.5px; color: var(--dim, #4b5563); } .mr .tile.ok .ts { color: #15803d; } .mr .tile.bad .ts { color: #b91c1c; font-weight: 600; }
.mr .mr-item { break-inside: avoid; page-break-inside: avoid; margin: 8px 0; }
.mr .mr-pair { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 10px; align-items: start; }
.mr .mr-chart { margin: 0; } .mr figcaption { font-size: 11px; color: var(--dim, #4b5563); }
.mr .mr-steps { font-size: 11.5px; }
@media (max-width: 560px) { .mr .mr-pair { grid-template-columns: minmax(0, 1fr); } .mr table { font-size: 11.5px; } .mr th, .mr td { padding: 3px 4px; } }`;

// The report's body: the lines that say what it covers, the tiles and the
// parts asked for. opts.compact: the provider's section (no charts, no
// MTTR table).
function bodyHtml(m, opts = {}) {
    const lines = [periodText(m), basisText(m), sourceText(m), checkedText(m), keptNote(m)].filter(Boolean);
    const sec = (key, inner) => (m.parts.includes(key) ? `<section class="part"><h2>${esc(t(PART_WORDS[key]))}</h2><div class="dev-block">${inner}</div></section>` : '');
    const head = `<div class="mr-lines">${lines.map((l) => `<p class="dim">${esc(l)}</p>`).join('')}</div>`;
    if (opts.compact) {
        return `<div class="mr">${head}${m.rows.length ? tilesHtml(m) : ''}${m.parts.includes('availability') ? `<h3>${esc(t('Availability'))}</h3>${availabilityHtml(m)}` : ''}`
            + `${m.parts.includes('response') ? `<h3>${esc(t('Response times'))}</h3>${responseHtml(m, { compact: true })}` : ''}${m.parts.includes('outages') ? `<h3>${esc(t('Outages'))}</h3>${outagesHtml(m, { compact: true })}` : ''}</div>`;
    }
    return { head, tiles: m.rows.length ? tilesHtml(m) : '', parts: sec('availability', availabilityHtml(m)) + sec('response', responseHtml(m)) + sec('outages', outagesHtml(m))
        + (m.connections ? sec('connections', connectionsHtml(m)) : '') };
}
const FOOT = 'Availability is the time answering divided by the time answering and not answering: maintenance (quiet windows, Expected) and unknown time (the monitor off or not reporting) are left out, and how much of the period was measured is printed beside every figure. A target is judged without the time a device was down only because a device upstream was.';
function reportHtml(m) {
    const b = bodyHtml(m);
    const title = titleOf(m);
    const sub = [m.meta.site, m.meta.client, m.meta.date].filter(Boolean).join(' · ');
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
h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: var(--dim); margin: 0 0 6px; }
h2 { font-size: 16px; margin: 8px 0 0; break-after: avoid; page-break-after: avoid; }
.mr-lines p { margin: 2px 0; }
.foot { font-size: 11.5px; color: var(--dim); }
${SECTION_CSS}
@media print {
  :root { --bg: #fff; --card: #fff; --text: #000; --dim: #333; --rule: #999; color-scheme: light; }
  body { background: #fff; color: #000; font-size: 10.5pt; } .sheet { padding: 0; max-width: none; }
  .dev-block { border: 0; border-bottom: 1px solid #999; border-radius: 0; padding: 6pt 0; }
}
</style></head><body><div class="sheet mr">
<header class="dev-block"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}${b.head}${b.tiles}</header>
${b.parts}<p class="foot">${esc(t(FOOT))}</p></div></body></html>`;
}

// ---- The spreadsheet (D305) ----
// One file, a `section` column saying what each row is: availability (per
// check, device, group, provider, and the report's total), response (per
// check per step of the chart) and outage. English column names, numbers
// with a dot, times as ISO 8601 (UTC).
const CSV_HEADERS = ['section', 'device', 'device_id', 'check', 'check_id', 'protocol', 'via', 'monitors', 'from', 'to', 'checks', 'answered', 'loss',
    'availability', 'availability_without_upstream', 'coverage', 'target', 'target_met', 'median_ms', 'p95_ms', 'jitter_ms', 'min_ms', 'max_ms',
    'up_s', 'slow_s', 'down_s', 'down_upstream_s', 'maintenance_s', 'unknown_s', 'down_because', 'outage_to', 'down_for_s', 'root_cause', 'behind', 'acted', 'acted_by', 'acted_at', 'time_to_acknowledge_s'];
function csvOf(m) {
    const r0 = m.range || {};
    const rows = [];
    const put = (o) => rows.push(CSV_HEADERS.map((h) => (o[h] === undefined || o[h] === null ? '' : String(o[h]))));
    const figs = (f) => ({ checks: f.checks, answered: f.ok, loss: round(f.loss, 4), availability: round(f.avail, 5), availability_without_upstream: round(f.ownAvail, 5),
        coverage: round(f.coverage, 4), target: f.target == null ? '' : f.target, target_met: f.met == null ? '' : String(f.met),
        up_s: round(f.up, 0), slow_s: round(f.slow, 0), down_s: round(f.down, 0), down_upstream_s: round(f.upstream, 0), maintenance_s: round(f.maint, 0), unknown_s: round(f.unknown, 0) });
    const span = { from: isoOf(r0.from), to: isoOf(r0.to) };
    if (m.parts.includes('availability')) {
        m.rows.forEach((r) => put(Object.assign({ section: 'availability', device: r.name, device_id: r.node, check: protoLabel(r.proto), check_id: r.check, protocol: r.proto, via: r.via,
            monitors: r.monitors.join('; '), median_ms: round(r.med, 2), p95_ms: round(r.p95, 2), jitter_ms: round(r.jitter, 2), min_ms: round(r.min, 2), max_ms: round(r.max, 2),
            down_because: r.causes.map((c) => `${c.name || 'upstream'}=${Math.round(c.s)}`).join('; ') }, span, figs(r))));
        if (m.devices.length > 1) m.devices.forEach((d) => put(Object.assign({ section: 'availability-device', device: d.name, device_id: d.node }, span, figs(d))));
        m.groups.forEach((g) => put(Object.assign({ section: 'availability-group', device: g.name, device_id: g.id }, span, figs(g))));
        m.providers.forEach((p) => put(Object.assign({ section: 'availability-provider', device: p.name, device_id: p.id }, span, figs(p))));
        put(Object.assign({ section: 'availability-total', device: m.scopeName || '' }, span, figs(m.total)));
    }
    if (m.parts.includes('response')) {
        m.rows.forEach((r) => r.series.forEach((b) => put({ section: 'response', device: r.name, device_id: r.node, check: protoLabel(r.proto), check_id: r.check, protocol: r.proto, via: r.via,
            from: isoOf(b.from), to: isoOf(b.to), checks: b.checks, loss: round(b.loss, 4), availability: round(b.avail, 5), coverage: round(b.coverage, 4), median_ms: round(b.med, 2), p95_ms: round(b.p95, 2) })));
    }
    if (m.parts.includes('outages')) {
        m.outages.forEach((o) => {
            // Every act, in order, joined with '; ' in each of the three
            // cells (an act with no name keeps its place empty), D305.
            const acts = o.acts;
            put({ section: 'outage', device: o.name, device_id: o.node, from: isoOf(o.from), outage_to: o.to == null ? '' : isoOf(o.to), down_for_s: Math.round(o.downMs / 1000),
                root_cause: o.own ? 'own' : o.name, behind: o.behind.join('; '), acted: acts.map((a) => a.act).join('; '), acted_by: acts.length ? acts.map((a) => a.by || '').join('; ') : '',
                acted_at: acts.map((a) => isoOf(a.at)).join('; '),
                time_to_acknowledge_s: o.ackMs == null ? '' : Math.round(o.ackMs / 1000) });
        });
    }
    const meta = m.meta || {};
    const name = topoFileName({ org: meta.client, site: typeof meta.fileSite === 'string' ? meta.fileSite : meta.site, date: meta.date || todayISO(), kind: KIND, fallback: 'network' }, 'csv');
    const text = (typeof CSV_BOM === 'string' ? CSV_BOM : '') + csvText({ headers: CSV_HEADERS, rows }, ',');
    return { text, name, rows: rows.length };
}

// ---- The preview and its choices ----
function normalizeOpts(o, doc) {
    const x = Object.assign({ scope: 'site', id: null, period: 'week', basis: 'all', parts: PARTS.slice() }, o || {});
    if (!SCOPES.includes(x.scope)) x.scope = 'site';
    if (!PERIODS.includes(x.period)) x.period = 'week';
    if (x.scope !== 'site' && !x.id) {
        const first = x.scope === 'node' ? (doc.nodes || []).find(hasChecks) : x.scope === 'group' ? (doc.groups || [])[0] : (doc.providers || [])[0];
        if (first) x.id = first.id; else x.scope = 'site';
    }
    if (x.scope === 'site') x.id = null;
    if (x.scope === 'provider' && (!o || o.basis === undefined)) { const p = providersOf(doc, x.id)[0]; x.basis = p && p.targetHours ? 'hours' : 'all'; }
    if (x.basis !== 'hours') x.basis = 'all';
    x.parts = (Array.isArray(x.parts) ? x.parts : PARTS).filter((p) => PARTS.includes(p));
    if (!x.parts.length) x.parts = PARTS.slice();
    return x;
}
function rangeFor(o, doc) {
    const pids = o.scope === 'provider' && o.id ? [o.id] : null;
    return periodRange(o.period, { now: nowMs(), doc, providerIds: pids });
}
// Reads the figures for the choices (again only when the period moved).
async function load(o, doc) {
    const range = rangeFor(o, doc);
    const key = `${range.from}|${range.to}|${range.none || ''}|${state.libraryId || ''}`;
    if (_rp.data && _rp.dataKey === key) return { range, data: _rp.data };
    const data = await gather(range, doc);
    _rp.data = data;
    _rp.dataKey = key;
    return { range, data };
}
function currentModel() {
    const doc = serializeDoc();
    const o = _rp.opts;
    return buildModel(doc, _rp.data || { source: 'none', streams: [] }, Object.assign({}, o, { range: rangeFor(o, doc) }));
}
// Connections only for the whole site on a Topo server (D379).
const connectionsOffered = (o) => o.scope === 'site' && !!(window.TopoMonitors && TopoMonitors.siteOfOpen && TopoMonitors.siteOfOpen());
// The left column: on what, the period, the hours and what goes in.
function controlsInto(box) {
    const o = _rp.opts;
    if (!o) { box.innerHTML = ''; return; }
    const doc = { nodes: state.nodes, groups: state.groups || [], providers: state.providers || [] };
    const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
    let h = `<label class="prop-lbl" for="rpScope">${esc(t('Report on'))}</label><select id="rpScope" class="select" data-rp="scope">`
        + SCOPES.map((s) => opt(s, t(SCOPE_WORDS[s]), o.scope)).join('') + '</select>';
    if (o.scope !== 'site') {
        const list = o.scope === 'node' ? doc.nodes.filter(hasChecks).map((n) => [n.id, typeof locPlainName === 'function' ? locPlainName(n) : n.name || n.id])
            : o.scope === 'group' ? doc.groups.map((g) => [g.id, groupPath(g, doc.groups)])
                : doc.providers.map((p) => [p.id, typeof providerLabel === 'function' ? providerLabel(p) : p.name || p.id]);
        h += `<label class="prop-lbl" for="rpWhich">${esc(t(o.scope === 'node' ? 'Device' : o.scope === 'group' ? 'Group' : 'Provider'))}</label><select id="rpWhich" class="select" data-rp="id">`
            + list.map(([id, name]) => opt(id, name, o.id)).join('') + '</select>';
    }
    h += `<label class="prop-lbl" for="rpPeriod">${esc(t('Period'))}</label><select id="rpPeriod" class="select" data-rp="period">`
        + PERIODS.map((p) => opt(p, t(PERIOD_WORDS[p]), o.period)).join('') + '</select>';
    const p = o.scope === 'provider' ? providersOf(doc, o.id)[0] : null;
    if (p && p.hours) {
        h += `<fieldset><legend>${esc(t('Hours'))}</legend>`
            + `<label><input type="radio" name="rpBasis" value="all" data-rp="basis"${o.basis !== 'hours' ? ' checked' : ''}> <span>${esc(t('Around the clock'))}</span></label>`
            + `<label><input type="radio" name="rpBasis" value="hours" data-rp="basis"${o.basis === 'hours' ? ' checked' : ''}> <span>${esc(t('Only during their support hours'))}</span></label></fieldset>`;
    }
    h += `<fieldset><legend>${esc(t('What goes in'))}</legend>`
        + PARTS.filter((k) => k !== 'connections' || connectionsOffered(o))
            .map((k) => `<label><input type="checkbox" value="${k}" data-rp="part"${o.parts.includes(k) ? ' checked' : ''}> <span>${esc(t(PART_WORDS[k]))}</span></label>`).join('') + '</fieldset>';
    box.innerHTML = h;
}
async function onControl(e) {
    const x = e.target.closest('[data-rp]');
    if (!x || !_rp.opts) return;
    const o = Object.assign({}, _rp.opts);
    const k = x.dataset.rp;
    if (k === 'scope') { o.scope = x.value; o.id = null; delete o.basis; }
    else if (k === 'id') { o.id = x.value; if (o.scope === 'provider') delete o.basis; }
    else if (k === 'period') o.period = x.value;
    else if (k === 'basis') o.basis = x.value;
    else if (k === 'part') {
        const set = new Set(o.parts);
        if (x.checked) set.add(x.value); else if (set.size > 1) set.delete(x.value); else x.checked = true;
        o.parts = PARTS.filter((p) => set.has(p));
    }
    const doc = serializeDoc();
    // A provider newly chosen starts on what they ask for (normalizeOpts).
    _rp.opts = normalizeOpts(o, doc);
    const seq = ++_rp.seq;
    if (typeof sheetPreviewStatus === 'function') sheetPreviewStatus(t('Reading the figures…'));
    await load(_rp.opts, doc);
    if (seq !== _rp.seq || !sheetPreviewOpen()) return;
    // Rebuilt with the new choices; the left column is drawn again when the
    // person is not in it (k: a select keeps its focus).
    const box = document.getElementById('sheetPreviewControls');
    if (box && (k === 'scope' || k === 'id')) controlsInto(box);
    refreshSheetPreview();
}

// Opens the report in the preview. opts: { scope, id, period, basis, parts }.
// -> what openSheetPreview returns, once the figures are read.
async function openMonitoringReport(opts = {}) {
    const doc = serializeDoc();
    _rp.opts = normalizeOpts(opts, doc);
    _rp.data = null; _rp.dataKey = '';
    const seq = ++_rp.seq;
    await load(_rp.opts, doc);
    if (seq !== _rp.seq) return null;
    SHEET_PREVIEW[KIND] = SHEET_PREVIEW.locate;
    const meta = typeof providerReportMeta === 'function' ? providerReportMeta(doc) : { site: '', client: '', date: todayISO() };
    return openSheetPreview({ kind: KIND, meta, build: () => reportHtml(currentModel()), controls: controlsInto, csv: () => csvOf(currentModel()) });
}

// ---- The provider's section of their report (D304) ----
// Their devices only, availability against their target, their outages and
// response times; since their last visit when it is within 91 days, else
// the last 30 days. null when none of their devices has a check.
async function providerMonitoring(doc, providerIds) {
    const ids = (Array.isArray(providerIds) ? providerIds : [providerIds]).filter(Boolean);
    if (!ids.length) return null;
    const covered = coveredIds(doc, ids);
    if (![...covered].some((id) => hasChecks((doc.nodes || []).find((n) => n.id === id)))) return null;
    let range = periodRange('visit', { now: nowMs(), doc, providerIds: ids });
    if (range.none || range.to - range.from > 91 * DAY) range = periodRange('month', { now: nowMs() });
    let data;
    try { data = await gather(range, doc); } catch (e) { data = { source: 'none', streams: [], error: true }; }
    // Their support hours only when the report is one provider's (D312).
    const p = ids.length === 1 ? providersOf(doc, ids[0])[0] : null;
    return buildModel(doc, data, { scope: 'provider', id: ids.length === 1 ? ids[0] : ids, period: range.kind, range, basis: p && p.targetHours ? 'hours' : 'all', parts: PARTS });
}
// Its HTML in their report (no charts: their report is phone-first).
function providerSectionHtml(m) {
    if (!m) return '';
    return `<style>${SECTION_CSS}</style>${bodyHtml(m, { compact: true })}`;
}

// ---- An outage in the network report (Problems and visits, D306) ----
// Its own block instead of the problem report's fields: when it went down
// each time and for how long, the devices behind it, the monitor, who acted
// and how long that took.
function outageReportBlock(inc, doc) {
    const d = doc || { nodes: state.nodes };
    const nameOf = (id) => { const n = (d.nodes || []).find((x) => x.id === id); return n ? (typeof locPlainName === 'function' ? locPlainName(n) : n.name || n.id) : id; };
    const root = nameOf((inc.nodeIds || [])[0]);
    const spans = inc.outages || [];
    const end = (o) => (Number.isFinite(o.to) ? o.to : null);
    const total = spans.reduce((s, o) => s + Math.max(0, (end(o) == null ? nowMs() : end(o)) - o.from), 0);
    const first = (inc.acts || [])[0];
    const status = first ? t(ACT_WORDS[first.act] || 'Acknowledged') : spans.length && end(spans[spans.length - 1]) != null && !inc.gone ? t('Answering again') : t('Not answering');
    const rows = [
        [t('Status'), status],
        [t('Device'), root],
        (inc.behind || []).length ? [t('Behind it'), inc.behind.map(nameOf).join(', ')] : null,
        [t('Down in all'), durText(total)],
        inc.monitor ? [t('Checked by'), inc.monitor] : null,
        first && spans[0] ? [t('Time to acknowledge'), durText(Math.max(0, first.at - spans[0].from))] : null,
        inc.flapping ? [t('Note'), t('It keeps going down and coming back (flapping).')] : null
    ].filter(Boolean);
    const times = spans.map((o) => `<li>${esc(end(o) == null ? t('From {from}, still not answering', { from: whenText(o.from) })
        : t('From {from} to {to} ({down})', { from: whenText(o.from), to: whenText(end(o)), down: durText(end(o) - o.from) }))}</li>`).join('');
    const acts = (inc.acts || []).map((a) => `<li>${esc(actText(a))}${a.note ? ` · ${esc(a.note)}` : ''}</li>`).join('');
    return `<h3>${esc(t('Not answering: {name}', { name: root }))}</h3>
        <table class="changes"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
        ${times ? `<p class="muted">${esc(t('Times down'))}</p><ul>${times}</ul>` : ''}${acts ? `<p class="muted">${esc(t('Who acted'))}</p><ul>${acts}</ul>` : `<p class="muted">${esc(t('Nobody has acted on it yet.'))}</p>`}`;
}

// ---- Wiring ----
(function wire() {
    const box = document.getElementById('sheetPreviewControls');
    if (box) box.addEventListener('change', onControl);
    const btn = document.getElementById('monitorReportBtn');
    if (btn) btn.addEventListener('click', () => {
        if (typeof closeConfigMenu === 'function') closeConfigMenu();
        openMonitoringReport({ scope: 'site', period: 'week' }).catch((e) => { console.warn('Monitoring report:', e); showToast(t('Could not build the report.'), 'err'); });
    });
})();

window.TopoReports = {
    state: _rp, PERIODS, PARTS, periodRange, stepFor, lastVisitAt, sumHours, pool, buildModel, gather, reportHtml, csvOf,
    openMonitoringReport, providerMonitoring, providerSectionHtml, outageReportBlock, serviceHoursOf, durText, CSV_HEADERS
};
})();
