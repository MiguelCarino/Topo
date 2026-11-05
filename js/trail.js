// ---- Address and location history: the trail (docs/BACKLOG.md, feature 5) ----
// "Which device had 192.168.1.20 in March?", "where was this camera plugged in
// before the move?" A register answers what is there now; the trail answers
// what was there at each hand-over. Like the change baseline (js/changes.js),
// it is never written into the document: a document travels in every link,
// file and binder, and a history of who had which address is not something a
// recipient was meant to read. So it is kept beside the card, in this browser
// only, and nothing that leaves the browser (serializeDoc, a card, a binder,
// a link, a sheet, a report) carries any of it, but for a report whose
// Address history tick the user turns on (stage 5, off by default:
// trailReportHistory below). DOC_VERSION is untouched.
//
// When it is written: each time takeSnapshot() runs (js/changes.js), that is
// at a back-up (one network or the binder) and when a report of a kept
// network is handed over. Those are the moments the document went out as a
// fact; edits between them are not recorded, so typing an address and undoing
// it leaves no trace, and undo never changes the trail.
//
// What is noted, per device of the document as it went out (canonicalDoc, so
// an older build's copy reads as this build's):
//   ip     each interface's address as typed (CIDR included), keyed by the
//          interface id, so a NIC's history follows the NIC;
//   mac    each interface's MAC (normMac), keyed the same way;
//   port   the switch and port it is plugged into, uplinkOf with skipNoPort as
//          the devices sheet reads it (csvUplink), so the sheet's switch/port
//          and the trail's cannot drift apart; compared as peerId|portId, so a
//          switch renamed is not a move;
//   group  the group id, read as its path at the time;
//   name   the name.
//
// The record, one per card id:
//   { v: 1, points: [{ at, kind }],
//     devices: { [nodeId]: { name, gone: at|null, spans: [{ f, k, val, txt, first, last, kind }] } } }
// A span is one value held from the point `first` to the point `last`; kind
// is the kind of `last` ('backup' | 'report' | 'file'). Recording a point at
// T: for each (device, f, k) seen, the newest span is extended to T when it
// has the same val and was seen at the point just before T; else a new span
// starts at T. So a value missing at a point (an address cleared, a cable
// unplugged, the device gone) and back later is two spans, never one stretched
// over the points it was not held at. A device missing from the document gets
// gone = T; one that comes back clears it.
//
// Bounded: at most 200 points (dropping the oldest drops the spans that ended
// before the oldest kept one), 16 spans per (device, f, k), a gone device
// pruned 400 days after its last span, and 6,000 spans per card (gone devices
// go first, then the oldest spans). The values held at the newest point are
// never what the cap drops: on a card whose present alone is over it, the
// past goes and the present stays whole, so no value's `first` is reset.
//
// Where it is kept: IndexedDB, a database of its own ('nettopo_trail'), the
// library's and the baselines' schemas untouched. Without IndexedDB it lives
// for this tab only, never in localStorage: that fallback is the library's,
// and a trail filling its quota would make the networks fail to save. A trail
// that cannot be written only warns; the storage banner is for the networks.
// Load order: ... -> library -> changes -> trail

const TRAIL_DB = 'nettopo_trail';
const TRAIL_STORE = 'trails';
const TRAIL_VERSION = 1;
const TRAIL_KINDS = ['backup', 'report', 'file'];
const TRAIL_FIELDS = ['ip', 'mac', 'port', 'group', 'name'];
const TRAIL_OPEN_MS = 1000;
const TRAIL_POINTS_MAX = 200;
const TRAIL_SPANS_PER_KEY = 16;
const TRAIL_SPANS_MAX = 6000;
const TRAIL_GONE_MS = 400 * 24 * 60 * 60 * 1000;
// Text from a file is outside input: no span's value or text runs away.
const TRAIL_TEXT_MAX = 512;

// card id -> record, as this tab holds it. Read synchronously, written behind.
const _trails = new Map();
let _trailAdapter = null;       // null: this tab only
let _trailChannel = null;       // other tabs' trails
// While a store is opening, each point recorded is also queued here (card id
// -> [{ obs, at, kind }]) so that, once the disk answers, it is replayed onto
// the disk's record rather than a record of that one point replacing it.
let _trailPending = null;       // null: no store opening
let _trailOpenSeq = 0;          // only the latest open is adopted

// This browser's preference (Settings), on unless turned off. Off stops
// recording and keeps what is there.
const trailRecordingOn = () => !(state.settings && state.settings.trailRecording === false);

// Device ids come from files: a map keyed by them has no prototype, so an id
// such as 'constructor' or '__proto__' is a device like any other.
const idMap = (from) => { const m = Object.create(null); if (from) Object.keys(from).forEach((k) => { m[k] = from[k]; }); return m; };
const emptyTrail = () => ({ v: TRAIL_VERSION, points: [], devices: idMap() });
const trailText = (v) => String(v == null ? '' : v).slice(0, TRAIL_TEXT_MAX);
const spanKey = (f, k) => f + '\u0000' + k;

// ---- Reading a record ----
// A record read back from disk, or from another tab, is outside input like a
// file: what is unusable in it is dropped, and a record that is not one at
// all is skipped. -> a clean record, or null.
function validTrail(rec) {
    if (!rec || typeof rec !== 'object' || rec.v !== TRAIL_VERSION) return null;
    if (!Array.isArray(rec.points) || !rec.devices || typeof rec.devices !== 'object' || Array.isArray(rec.devices)) return null;
    const points = rec.points
        .filter((p) => p && Number.isFinite(p.at) && TRAIL_KINDS.includes(p.kind))
        .map((p) => ({ at: p.at, kind: p.kind }))
        .sort((a, b) => a.at - b.at)
        .filter((p, i, list) => i === 0 || list[i - 1].at !== p.at);
    const devices = idMap();
    Object.keys(rec.devices).forEach((id) => {
        const d = rec.devices[id];
        if (!d || typeof d !== 'object' || !Array.isArray(d.spans)) return;
        const spans = d.spans.filter((s) => s && TRAIL_FIELDS.includes(s.f) && typeof s.k === 'string'
                && typeof s.val === 'string' && typeof s.txt === 'string'
                && Number.isFinite(s.first) && Number.isFinite(s.last) && s.first <= s.last && TRAIL_KINDS.includes(s.kind))
            .map((s) => ({ f: s.f, k: trailText(s.k), val: trailText(s.val), txt: trailText(s.txt), first: s.first, last: s.last, kind: s.kind }));
        if (!spans.length) return;
        devices[id] = { name: trailText(typeof d.name === 'string' ? d.name : ''), gone: Number.isFinite(d.gone) ? d.gone : null, spans };
    });
    return { v: TRAIL_VERSION, points, devices };
}

// ---- What a document says, per device (pure) ----
const portVal = (peer, portId) => peer.id + '|' + (portId || '');
const portTxt = (peer, portId, label) => {
    const name = (peer.name && String(peer.name).trim()) || peer.id;
    return portId ? name + ' · ' + label : name;
};
// Every uplink uplinkOf chooses from, by its rules (a faceplate peer; with
// skipNoPort, a cable on no port only when it is wireless), as [{ val, txt }].
function uplinkAlts(node, opts = {}) {
    const inDoc = !!(opts.links || opts.nodes);
    const docLinks = opts.links || [], docNodes = opts.nodes || [];
    const nodeOf = !inDoc ? getNode : docNodes instanceof Map ? (id) => docNodes.get(id) : (id) => docNodes.find((n) => n.id === id);
    const at = inDoc ? docLinks.filter((l) => l.source === node.id || l.target === node.id) : linksAtNode(node.id);
    const out = [];
    at.forEach((l) => {
        const peerId = l.source === node.id ? l.target : l.source;
        const peer = nodeOf(peerId);
        if (!peer || !hasPortGrid(peer)) return;
        const portId = ifaceIdOn(l, peerId);
        if (opts.skipNoPort && !portId && effectiveMedium(l, l.source === node.id ? node : peer, l.target === node.id ? node : peer) !== 'wireless') return;
        const label = portId ? (inDoc ? docPortLabel(peer, portId, docLinks) : ifaceLabel(peer, portId)) : '';
        out.push({ val: trailText(portVal(peer, portId)), txt: trailText(portTxt(peer, portId, label)) });
    });
    return out;
}
// The alternative of `v` that the span `held` already holds (see
// observeNode), or null when v has none or holds that value itself.
const heldAlt = (v, held) => (v && v.alts && held && held.val !== v.val ? v.alts.find((a) => a.val === held.val) || null : null);
// One device's values: { name, values: [{ f, k, val, txt }] }. `up` is the
// uplinkOf options: a document's own lists (observeDoc), or { skipNoPort }
// alone for the open network (the History section's "now").
function observeNode(node, groups, up) {
    const values = [];
    const add = (f, k, val, txt) => { if (val) values.push({ f, k, val: trailText(val), txt: trailText(txt) }); };
    (node.interfaces || []).forEach((i) => {
        if (!i || !i.id) return;
        const ip = String(i.ip || '').trim();
        if (ip) add('ip', i.id, ip.replace(/\s+/g, '').toLowerCase(), ip);
        const mac = String(i.mac || '').trim();
        if (mac) add('mac', i.id, normMac(mac), fmtColonSafe(mac));
    });
    const link = uplinkOf(node, up);
    if (link) {
        add('port', '', portVal(link.peer, link.portId), portTxt(link.peer, link.portId, link.label));
        // Two or more uplinks (a bond, a dual-homed server): which one uplinkOf
        // reads follows the switches' names, so a switch renamed could swap it.
        // The others go along as `alts`, and the recorder (and the History
        // section) keep the one already held while it is still cabled: a
        // switch renamed is not a move.
        const alts = uplinkAlts(node, up);
        const last = values[values.length - 1];
        if (alts.length > 1 && last && last.f === 'port') last.alts = alts;
    }
    if (node.group && groups.some((g) => g && g.id === node.group)) add('group', '', node.group, groupPathOf(node, groups) || node.group);
    const name = String(node.name || '').trim();
    add('name', '', name, name);
    return { name, values };
}
// -> { [nodeId]: { name, values: [{ f, k, val, txt }] } } for the document as
// this build reads it. Nothing of the open document is read: uplinkOf gets
// the document's own lists.
function observeDoc(doc, canonical) {
    const canon = canonical || canonicalDoc(doc);
    const nodes = Array.isArray(canon.nodes) ? canon.nodes : [];
    const links = Array.isArray(canon.links) ? canon.links : [];
    const groups = Array.isArray(canon.groups) ? canon.groups : [];
    const byId = new Map();
    nodes.forEach((n) => { if (n && n.id && !byId.has(n.id)) byId.set(n.id, n); });
    const out = idMap();
    byId.forEach((node, id) => { out[id] = observeNode(node, groups, { skipNoPort: true, links, nodes: byId }); });
    return out;
}

// ---- One point into a record (pure) ----
// A copy of `trail` with the observation `obs` recorded as a point at `at` of
// `kind`, pruned. A point at a time the record already holds changes nothing
// (the same point twice is one point). A point older than the newest one (an
// older back-up read in, stage 4) goes in at its place: insertObservation.
function mergeObservation(trail, obs, at, kind) {
    const base = trail ? cloneData(trail) : emptyTrail();
    if (trail) base.devices = idMap(base.devices);
    if (!Number.isFinite(at) || !TRAIL_KINDS.includes(kind) || !obs || typeof obs !== 'object') return base;
    const newest = base.points.length ? base.points[base.points.length - 1].at : -Infinity;
    if (base.points.some((p) => p.at === at)) return base;
    // Older than every point of a full record: the bound would take it
    // straight back out, so it changes nothing (not even the spans beside it).
    if (at < newest && base.points.length >= TRAIL_POINTS_MAX && at < base.points[0].at) return base;
    if (at < newest) return insertObservation(base, obs, at, kind);
    const prevAt = base.points.length ? base.points[base.points.length - 1].at : null;
    base.points.push({ at, kind });
    Object.keys(obs).forEach((id) => {
        const seen = obs[id];
        let dev = base.devices[id];
        if (!dev) dev = base.devices[id] = { name: '', gone: null, spans: [] };
        dev.name = trailText(seen.name);
        dev.gone = null;
        // The newest span per (f, k), found once.
        const latest = new Map();
        dev.spans.forEach((s) => { const key = spanKey(s.f, s.k); const cur = latest.get(key); if (!cur || s.last >= cur.last) latest.set(key, s); });
        (seen.values || []).forEach((v) => {
            const key = spanKey(v.f, v.k);
            const last = latest.get(key);
            if (last && last.last === prevAt) { const alt = heldAlt(v, last); if (alt) v = { f: v.f, k: v.k, val: alt.val, txt: alt.txt }; }
            // Held at the point before, so held through to this one.
            if (last && last.val === v.val && last.last === prevAt) { last.last = at; last.kind = kind; return; }
            const span = { f: v.f, k: v.k, val: v.val, txt: v.txt, first: at, last: at, kind };
            dev.spans.push(span);
            latest.set(key, span);
        });
    });
    Object.keys(base.devices).forEach((id) => {
        if (!Object.prototype.hasOwnProperty.call(obs, id) && base.devices[id].gone == null) base.devices[id].gone = at;
    });
    return pruneTrail(base, at);
}

// An older point, in place into `base` (a copy mergeObservation made), at
// `at` between the points before and after it. The rule is the recorder's,
// worked at that place: a span is a value held at every point from `first`
// to `last`, so for each (device, f, k):
//   - a span running across T (held at the points either side) with the
//     same value is left as it is; with another value, or none at T, it is
//     split around T: up to the point before (taking that point's kind) and
//     from the point after;
//   - else a span ending at the point before with the same value is extended
//     to T, one starting at the point after is started at T instead (and
//     reads as it read at T), and when both hold it they become one span;
//     with neither, a new span at T.
// A split span's later half keeps the text of its first point: how it read
// at the point after T is not kept, only how it read when first seen.
// A device the file holds that the trail has no record of is a removed one,
// gone from the point after T; a gone device seen at T is gone from the
// first point after it was last seen. Names stay the newest ones. -> base, pruned.
function insertObservation(base, obs, at, kind) {
    const pts = base.points;
    let i = pts.findIndex((p) => p.at > at);
    if (i < 0) i = pts.length;
    const prev = i > 0 ? pts[i - 1] : null, next = i < pts.length ? pts[i] : null;
    pts.splice(i, 0, { at, kind });
    const prevAt = prev ? prev.at : null, nextAt = next ? next.at : null;
    const firstAfter = (t0) => { const p = pts.find((x) => x.at > t0); return p ? p.at : null; };
    const ids = new Set([...Object.keys(base.devices), ...Object.keys(obs)]);
    ids.forEach((id) => {
        const seen = Object.prototype.hasOwnProperty.call(obs, id) ? obs[id] : null;
        let dev = base.devices[id];
        if (!dev && !seen) return;
        const fresh = !dev;
        if (fresh) dev = base.devices[id] = { name: trailText(seen.name), gone: null, spans: [] };
        // The value at T per (f, k), and every key either side holds.
        const want = new Map();
        if (seen) (seen.values || []).forEach((v) => { const key = spanKey(v.f, v.k); if (!want.has(key)) want.set(key, v); });
        const keys = new Set(want.keys());
        dev.spans.forEach((s) => keys.add(spanKey(s.f, s.k)));
        const drop = new Set();
        keys.forEach((key) => {
            const list = dev.spans.filter((s) => spanKey(s.f, s.k) === key);
            const across = prevAt != null && nextAt != null ? list.find((s) => s.first <= prevAt && s.last >= nextAt) || null : null;
            const before = !across && prevAt != null ? list.find((s) => s.last === prevAt) || null : null;
            const after = !across && nextAt != null ? list.find((s) => s.first === nextAt) || null : null;
            let v = want.get(key) || null;
            // A device on two switches: the uplink a neighbour holds, while cabled.
            if (v) { const alt = heldAlt(v, across || before || after); if (alt) v = { f: v.f, k: v.k, val: alt.val, txt: alt.txt }; }
            if (across) {
                if (v && across.val === v.val) return;
                dev.spans.push({ f: across.f, k: across.k, val: across.val, txt: across.txt, first: nextAt, last: across.last, kind: across.kind });
                across.last = prevAt; across.kind = prev.kind;
                if (v) dev.spans.push({ f: v.f, k: v.k, val: v.val, txt: v.txt, first: at, last: at, kind });
                return;
            }
            if (!v) return;
            const b = before && before.val === v.val ? before : null;
            const a = after && after.val === v.val ? after : null;
            if (b && a) { b.last = a.last; b.kind = a.kind; drop.add(a); return; }
            if (b) { b.last = at; b.kind = kind; return; }
            // It now starts at T, so it reads as it read at T (as `txt` reads at `first`).
            if (a) { a.first = at; a.txt = v.txt; return; }
            dev.spans.push({ f: v.f, k: v.k, val: v.val, txt: v.txt, first: at, last: at, kind });
        });
        if (drop.size) dev.spans = dev.spans.filter((s) => !drop.has(s));
        if (fresh) dev.gone = nextAt;
        else if (seen && dev.gone != null) dev.gone = firstAfter(dev.spans.reduce((m, s) => Math.max(m, s.last), at)) || dev.gone;
        // Missing at T, after it was last seen and before the point it went
        // at: it went at T (the first point it is missing from).
        else if (!seen && dev.gone != null && at < dev.gone && dev.spans.every((s) => s.last < at)) dev.gone = at;
    });
    return pruneTrail(base, pts[pts.length - 1].at);
}

// The bounds, in place. `now` is the time the gone-device age is read at.
function pruneTrail(trail, now = Date.now()) {
    if (!trail) return trail;
    const lastOf = (dev) => dev.spans.reduce((m, s) => Math.max(m, s.last), -Infinity);
    // Points: the newest 200, and the spans that ended before the oldest kept.
    if (trail.points.length > TRAIL_POINTS_MAX) {
        trail.points = trail.points.slice(trail.points.length - TRAIL_POINTS_MAX);
        const oldest = trail.points[0].at;
        Object.values(trail.devices).forEach((dev) => { dev.spans = dev.spans.filter((s) => s.last >= oldest); });
    }
    // Per (device, f, k): the newest 16.
    Object.values(trail.devices).forEach((dev) => {
        const groups = new Map();
        dev.spans.forEach((s) => { const key = spanKey(s.f, s.k); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(s); });
        let drop = null;
        groups.forEach((list) => {
            if (list.length <= TRAIL_SPANS_PER_KEY) return;
            list.sort((a, b) => a.first - b.first || a.last - b.last);
            drop = drop || new Set();
            list.slice(0, list.length - TRAIL_SPANS_PER_KEY).forEach((s) => drop.add(s));
        });
        if (drop) dev.spans = dev.spans.filter((s) => !drop.has(s));
    });
    // Devices with nothing left, and gone ones past their age.
    Object.keys(trail.devices).forEach((id) => {
        const dev = trail.devices[id];
        if (!dev.spans.length || (dev.gone != null && now - lastOf(dev) > TRAIL_GONE_MS)) delete trail.devices[id];
    });
    // The card's cap: gone devices first (the longest gone first), then the oldest spans.
    let total = Object.values(trail.devices).reduce((n, dev) => n + dev.spans.length, 0);
    if (total > TRAIL_SPANS_MAX) {
        const gone = Object.keys(trail.devices).filter((id) => trail.devices[id].gone != null)
            .sort((a, b) => trail.devices[a].gone - trail.devices[b].gone || lastOf(trail.devices[a]) - lastOf(trail.devices[b]));
        for (const id of gone) {
            if (total <= TRAIL_SPANS_MAX) break;
            total -= trail.devices[id].spans.length;
            delete trail.devices[id];
        }
    }
    if (total > TRAIL_SPANS_MAX) {
        // Only the past: a span seen at the newest point is a value held now.
        const nowAt = trail.points.length ? trail.points[trail.points.length - 1].at : null;
        const all = [];
        Object.values(trail.devices).forEach((dev) => dev.spans.forEach((s) => { if (s.last !== nowAt) all.push(s); }));
        all.sort((a, b) => a.last - b.last || a.first - b.first);
        const drop = new Set(all.slice(0, Math.min(all.length, total - TRAIL_SPANS_MAX)));
        Object.keys(trail.devices).forEach((id) => {
            const dev = trail.devices[id];
            dev.spans = dev.spans.filter((s) => !drop.has(s));
            if (!dev.spans.length) delete trail.devices[id];
        });
    }
    return trail;
}

// ---- The store ----
// The IndexedDB store. Every call resolves rather than rejects, as the
// baselines' does: a trail that cannot be stored is a missing history, never
// a broken back-up.
function idbTrailAdapter() {
    let db = null;
    const request = (fn) => new Promise((resolve) => { try { fn(resolve); } catch (e) { resolve(null); } });
    const read = (ids) => request((resolve) => {
        if (!db) { resolve(null); return; }
        const tx = db.transaction(TRAIL_STORE, 'readonly');
        const store = tx.objectStore(TRAIL_STORE);
        const out = {};
        if (ids) {
            ids.forEach((id) => { const g = store.get(id); g.onsuccess = () => { out[id] = g.result === undefined ? null : g.result; }; });
            tx.oncomplete = () => resolve(out);
        } else {
            const keys = store.getAllKeys();
            const vals = store.getAll();
            tx.oncomplete = () => { keys.result.forEach((k, i) => { out[k] = vals.result[i]; }); resolve(out); };
        }
        tx.onerror = tx.onabort = () => resolve(null);
    });
    const write = (fn) => request((resolve) => {
        if (!db) { resolve(false); return; }
        const tx = db.transaction(TRAIL_STORE, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
        fn(tx.objectStore(TRAIL_STORE));
    }).then((ok) => ok === true);
    return {
        // -> { id: record } of every trail, or null when IndexedDB cannot be used here.
        readAll() {
            return request((resolve) => {
                const req = indexedDB.open(TRAIL_DB, 1);
                req.onupgradeneeded = () => { try { req.result.createObjectStore(TRAIL_STORE); } catch (e) { /* already there */ } };
                req.onerror = req.onblocked = () => resolve(null);
                req.onsuccess = () => {
                    db = req.result;
                    db.onversionchange = () => { try { db.close(); } catch (e) { /* closed */ } db = null; };
                    read(null).then(resolve);
                };
            });
        },
        read,
        put: (id, rec) => write((store) => store.put(rec, id)),
        del: (ids) => write((store) => ids.forEach((id) => store.delete(id)))
    };
}

// Boot, once the library is open. Not awaited: nothing on screen waits for a
// trail. `adapter` and `ms` are for the suites; boot passes neither.
function openTrailStore(adapter, ms = TRAIL_OPEN_MS) {
    if (adapter === undefined) adapter = typeof indexedDB !== 'undefined' && indexedDB ? idbTrailAdapter() : null;
    const seq = ++_trailOpenSeq;
    if (!adapter) { _trailAdapter = null; _trailPending = null; return Promise.resolve('tab'); }
    _trailPending = new Map();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ms));
    const opened = Promise.resolve().then(() => adapter.readAll()).catch(() => null);
    // Past the deadline the answer is still taken: only the wait is cut short,
    // and points recorded meanwhile stay queued for it.
    opened.then((disk) => {
        if (seq !== _trailOpenSeq) return;
        if (disk) adoptTrailStore(adapter, disk);
        else _trailPending = null;
    });
    return Promise.race([opened, timeout]).then((disk) => (disk ? 'idb' : 'tab'));
}

const newestPoint = (rec) => (rec && rec.points.length ? rec.points[rec.points.length - 1].at : -Infinity);

// What the disk holds comes in. A point recorded while the store was opening
// is replayed onto the disk's record of that card (mergeObservation), so the
// history already there is kept and the point is added to it. A record this
// tab held otherwise (no store before), newer than the disk's, is written
// over it. Two tabs recording at once may lose one point, the accepted cost
// (docs/BACKLOG.md).
function adoptTrailStore(adapter, disk) {
    const owed = [];
    const pending = _trailPending || new Map();
    _trailPending = null;
    Object.keys(disk).forEach((id) => {
        if (pending.has(id)) return;
        const rec = validTrail(disk[id]);
        if (!rec) return;
        const mine = _trails.get(id);
        if (mine && newestPoint(mine) >= newestPoint(rec)) { owed.push(id); return; }
        _trails.set(id, rec);
    });
    pending.forEach((list, id) => {
        const from = Object.prototype.hasOwnProperty.call(disk, id) ? validTrail(disk[id]) : null;
        const rec = list.reduce(replayTrailOp, from);
        if (rec) _trails.set(id, rec); else _trails.delete(id);
        owed.push(id);   // written, or (dropped) deleted from the disk
    });
    _trails.forEach((rec, id) => { if (!Object.prototype.hasOwnProperty.call(disk, id) && !pending.has(id)) owed.push(id); });
    _trailAdapter = adapter;
    owed.forEach((id) => writeTrail(id));
    // A card deleted while this store was not listening leaves its trail
    // behind. Pruned only when the library itself is on IndexedDB, as the
    // baselines are (js/changes.js adoptSnapshotStore).
    if (typeof libraryStoreKind === 'function' && libraryStoreKind() === 'idb') {
        const gone = [..._trails.keys()].filter((id) => !libraryEntry(id));
        if (gone.length) { gone.forEach((id) => _trails.delete(id)); Promise.resolve(adapter.del(gone)).catch(() => false); }
    }
    listenForTrails();
    trailChangedHere();
    refreshLandingForTrails();
}

// The landing's cards offer Clear history only when they have a trail, so a
// landing drawn before the trails arrived (or another tab's) is drawn again,
// as the baselines' adopt does (js/changes.js changesStoreChanged).
function refreshLandingForTrails() {
    try { if (typeof landingIsOpen === 'function' && landingIsOpen()) renderLanding(); } catch (e) { /* the next landing draws it */ }
}

// Back to this tab only. For the suites, which hand the page back as they found it.
function releaseTrailStore() {
    if (_trailChannel) { try { _trailChannel.close(); } catch (e) { /* closed */ } }
    _trailChannel = null; _trailAdapter = null; _trailPending = null; _trailOpenSeq++;
}

function writeTrail(id) {
    const adapter = _trailAdapter;
    if (!adapter) return Promise.resolve(false);
    let pending;
    try { const rec = _trails.get(id); pending = rec ? adapter.put(id, rec) : adapter.del([id]); } catch (e) { pending = false; }
    return Promise.resolve(pending).catch(() => false).then((ok) => {
        if (!ok) console.warn('Topo: could not store the address history for', id);
        else if (_trailChannel) { try { _trailChannel.postMessage({ ids: [id] }); } catch (e) { /* closed */ } }
        return ok;
    });
}

// Another tab recorded (or dropped) a trail: read those ids from the disk.
// Nothing leaves the browser: a BroadcastChannel reaches only this origin's tabs.
function listenForTrails() {
    if (_trailChannel) { try { _trailChannel.close(); } catch (e) { /* closed */ } }
    _trailChannel = null;
    if (typeof BroadcastChannel !== 'function') return;
    try { _trailChannel = new BroadcastChannel(TRAIL_DB); } catch (e) { return; }
    const adapter = _trailAdapter;
    _trailChannel.onmessage = (event) => {
        const ids = Array.isArray((event.data || {}).ids) ? event.data.ids.filter((id) => typeof id === 'string') : [];
        if (!ids.length) return;
        Promise.resolve(adapter.read(ids)).then((fresh) => {
            if (!fresh || adapter !== _trailAdapter) return;
            ids.forEach((id) => {
                const rec = validTrail(fresh[id]);
                if (rec) _trails.set(id, rec); else _trails.delete(id);
            });
            if (ids.includes(state.libraryId)) trailChangedHere();
            refreshLandingForTrails();
        }).catch(() => { /* the next message, or the next visit, catches up */ });
    };
}

// ---- The hook and the readers ----
// A back-up or a report of card `id`, holding `doc` as it went out
// (takeSnapshot calls this). Nothing is recorded for a network that is not a
// card here, for a document this build would open read-only (one from a
// newer Topo: takeSnapshot does not check that, and canonicalDoc can only
// read it the way this build reads it), for the open network while it is
// read-only, or with recording turned off. Never throws: a trail that
// cannot be worked out must not stop the back-up it rides on.
// -> true when a point was recorded.
function recordPoint(id, kind, doc, at) {
    try {
        if (!id || !TRAIL_KINDS.includes(kind) || !doc || !Array.isArray(doc.nodes)) return false;
        if (!trailRecordingOn()) return false;
        if (docVersionOf(doc) > DOC_VERSION) return false;
        if (state.readOnly && id === state.libraryId) return false;
        if (typeof libraryEntry === 'function' && !libraryEntry(id)) return false;
        const prev = _trails.get(id) || null;
        const newest = newestPoint(prev);
        let when = Number.isFinite(at) ? at : Date.now();
        // Strictly later, as a baseline's `at` is, unless a time was given:
        // an older back-up read in (stage 4) goes in at its own time.
        if (!Number.isFinite(at) && when <= newest) when = newest + 1;
        if (prev && prev.points.some((p) => p.at === when)) return false;
        const obs = observeDoc(doc);
        const next = mergeObservation(prev, obs, when, kind);
        // Older than the 200 points kept: the bound takes it straight back out.
        if (!next.points.some((p) => p.at === when)) return false;
        _trails.set(id, next);
        queueTrailOp(id, { obs, at: when, kind });
        writeTrail(id);
        if (id === state.libraryId) trailChangedHere();
        return true;
    } catch (e) {
        console.warn('Topo: could not record the address history for', id, e);
        return false;
    }
}

// While a store is opening, what this tab does to a card's trail is queued
// in order (a point { obs, at, kind }, a device forgotten { forget }, the
// card's trail dropped { drop }) and replayed onto the disk's record once it
// answers (adoptTrailStore), so a forget or a clear made meanwhile reaches
// the history on disk too: it neither brings a cleared trail back nor lets
// this tab's few points replace the rest. -> whether it was queued.
function queueTrailOp(id, op) {
    if (!_trailPending || _trailAdapter || !id) return false;
    // A drop wipes what came before it: the replay starts from nothing.
    let list = op.drop ? [] : (_trailPending.get(id) || []);
    list.push(op);
    if (list.length > TRAIL_POINTS_MAX) {
        // Over the cap, the oldest point goes, never a forget or a drop.
        const i = list.findIndex((o) => o.obs);
        if (i >= 0) list.splice(i, 1);
    }
    _trailPending.set(id, list);
    return true;
}
// One queued op onto a record (null: none). -> the record, or null.
function replayTrailOp(rec, op) {
    if (op.drop) return null;
    if (op.forget) {
        if (!rec || !Object.prototype.hasOwnProperty.call(rec.devices, op.forget)) return rec;
        const next = cloneData(rec);
        next.devices = idMap(next.devices);
        delete next.devices[op.forget];
        return next;
    }
    return mergeObservation(rec, op.obs, op.at, op.kind);
}

// The card is gone, so is its trail.
function dropTrail(id) {
    const queued = queueTrailOp(id, { drop: true });
    if (!id || !_trails.delete(id)) return queued;
    writeTrail(id);
    if (id === state.libraryId) trailChangedHere();
    return true;
}

// The record for a card, or null. A copy: a caller changing it must not change the next caller's.
function trailOf(id) {
    const rec = id ? _trails.get(id) : null;
    return rec ? cloneData(rec) : null;
}
// One device's part of it, or null.
function deviceTrail(id, nodeId) {
    const rec = id ? _trails.get(id) : null;
    const dev = rec && nodeId ? rec.devices[nodeId] : null;
    return dev ? cloneData(dev) : null;
}

// Has this card any history here? (the landing card's Clear history tool)
function hasTrail(id) {
    const rec = id ? _trails.get(id) : null;
    return !!rec && (rec.points.length > 0 || Object.keys(rec.devices).length > 0);
}
// One device's history forgotten (the History section's button). The card
// and its document are untouched, and it is no undo step. -> true when
// there was something to forget.
function forgetDevice(id, nodeId) {
    if (!id || !nodeId) return false;
    // Queued even when this tab holds nothing of it yet: the disk may.
    queueTrailOp(id, { forget: nodeId });
    const rec = _trails.get(id);
    if (!rec || !Object.prototype.hasOwnProperty.call(rec.devices, nodeId)) return false;
    _trails.set(id, replayTrailOp(rec, { forget: nodeId }));
    writeTrail(id);
    if (id === state.libraryId) refreshTrailQuery();
    return true;
}

// ---- The History section (feature 5, stage 2) ----
// The Full editor's device panel, after Locate (Asset, Locate, History): what
// this device held at earlier back-ups and reports, read from the trail and
// never from the document. One block per value that has a past: the value
// now (from the document, as it is on screen), then each past one, newest
// first, with the dates it was seen and how it was recorded. When another
// device on this network held this device's address or MAC before, a hint
// line says whose it was: a hint only, never a finding (findings are worked
// out from the document, so a recipient of the file sees the same ones).
// The note at the foot says plainly that this lives in this browser only.
// The reduced views drop it (data-adv), and a multi-selection hides the
// panel it is in; they may show the plain lines below instead.
const trailEl = (id) => document.getElementById(id);
const HISTORY_OPEN_KEY = 'nettopo_history_open';
const HISTORY_KIND_WORDS = { backup: 'back-up', report: 'report', file: 'file' };

// Which card's history the open network reads, or null when none can be
// kept for it: a network not kept in this browser, or a read-only one.
function historyCardId() {
    const id = state.libraryId;
    if (!id || state.readOnly) return null;
    if (typeof libraryEntry === 'function' && !libraryEntry(id)) return null;
    return id;
}

// The blocks for one device: [{ f, k, label, now, past: [span], reuse: [text] }],
// in the panel's order (each NIC's address then its MAC, then the switch
// port, the group, the name). Pure apart from reading the open network.
function historyBlocks(node, dev, rec) {
    const now = observeNode(node, state.groups || [], { skipNoPort: true });
    const nowOf = new Map(now.values.map((v) => [spanKey(v.f, v.k), v]));
    const keys = [];
    const seen = new Set();
    const push = (f, k) => { const key = spanKey(f, k); if (!seen.has(key)) { seen.add(key); keys.push({ f, k }); } };
    const spans = dev ? dev.spans : [];
    const ifaceIds = (node.interfaces || []).filter((i) => i && i.id).map((i) => i.id);
    spans.forEach((s) => { if ((s.f === 'ip' || s.f === 'mac') && !ifaceIds.includes(s.k)) ifaceIds.push(s.k); });
    ifaceIds.forEach((k) => { push('ip', k); push('mac', k); });
    ['port', 'group', 'name'].forEach((f) => push(f, ''));
    const ifName = (k) => { const i = (node.interfaces || []).find((x) => x && x.id === k); return i ? (String(i.name || '').trim() || k) : t('removed interface'); };
    const label = (f, k) => (f === 'ip' ? `${t('IP / CIDR')} (${ifName(k)})` : f === 'mac' ? `${t('MAC')} (${ifName(k)})`
        : f === 'port' ? t('Switch port') : f === 'group' ? t('Group') : t('Name'));
    // Address reuse: another device here, on the map now, whose past holds
    // a value this one holds now (and which no longer holds it itself).
    // An address is compared by its host part: '192.168.1.20/24', '/16' and
    // a bare '192.168.1.20' are the same address on the wire.
    const hostOf = (v) => String(v || '').replace(/\s+/g, '').toLowerCase().split('/')[0];
    const reuseOf = (f, val) => {
        if (!rec || !val) return [];
        const want = f === 'ip' ? hostOf(val) : val;
        if (!want) return [];
        const same = (v) => (f === 'ip' ? hostOf(v) === want : v === want);
        const hits = [];
        Object.keys(rec.devices).forEach((otherId) => {
            if (otherId === node.id) return;
            const other = getNode(otherId);
            if (!other) return;
            const until = rec.devices[otherId].spans.filter((s) => s.f === f && same(s.val)).reduce((m, s) => Math.max(m, s.last), -Infinity);
            if (!Number.isFinite(until)) return;
            // Both holding it now is a duplicate (a finding), not a reuse.
            const held = (other.interfaces || []).some((i) => i && (f === 'ip' ? !!String(i.ip || '').trim() && same(i.ip) : !!i.mac && normMac(i.mac) === want));
            if (!held) hits.push({ name: String(other.name || '').trim() || other.id, until });
        });
        return hits.sort((a, b) => b.until - a.until)
            .map((h) => t("Was {name}'s until {date}", { name: h.name, date: localDateOf(h.until) }));
    };
    const newestAt = rec && rec.points.length ? rec.points[rec.points.length - 1].at : null;
    const out = [];
    keys.forEach(({ f, k }) => {
        const key = spanKey(f, k);
        let cur = nowOf.get(key) || null;
        const list = spans.filter((s) => s.f === f && s.k === k).sort((a, b) => b.last - a.last || b.first - a.first);
        // A device on two switches reads as the uplink it was recorded on,
        // while that cable is still there (observeNode's alts).
        const alt = list.length && list[0].last === newestAt ? heldAlt(cur, list[0]) : null;
        if (alt) cur = { f, k, val: alt.val, txt: alt.txt };
        // The newest span is the present one when it was held at the newest
        // point and holds the value now. A value missing at that point (a
        // cable unplugged, an address cleared) and back since is held now,
        // not held throughout: it reads as now, the span below it as past.
        const present = list.length && cur && list[0].val === cur.val && list[0].last === newestAt ? list[0] : null;
        const past = present ? list.slice(1) : list;
        const reuse = (f === 'ip' || f === 'mac') && cur ? reuseOf(f, cur.val) : [];
        if (!past.length && !reuse.length) return;
        out.push({ f, k, label: label(f, k), now: cur ? cur.txt : '', since: present ? present.first : null, past, reuse });
    });
    return out;
}
// The search a past value puts in the box: an address without its prefix (a
// /24 would read as the whole network), a MAC as shown, else the text quoted.
function historyWasQuery(s) {
    const txt = String(s.txt || s.val || '').replace(/"/g, '').trim();
    if (s.f === 'ip') return `was:${txt.split('/')[0].replace(/\s+/g, '')}`;
    if (s.f === 'mac') return `was:${txt.replace(/\s+/g, '')}`;
    return `was:"${txt}"`;
}
const historyRange = (s) => (s.first === s.last ? localDateOf(s.first) : t('{from} → {to}', { from: localDateOf(s.first), to: localDateOf(s.last) }));

function historyBodyHtml(node) {
    const esc = escapeHtml;
    // Off (Settings) records nothing new: the note and the empty line say so
    // rather than promise a recording that will not come.
    const on = trailRecordingOn();
    const note = `<p class="hist-note">${esc(on ? t('Recorded at back-ups and reports, and kept in this browser only: it does not travel with files, links or binders.')
        : t('Address history is turned off in Settings: back-ups and reports record nothing new. What is here is kept in this browser only: it does not travel with files, links or binders.'))}</p>`;
    const id = historyCardId();
    if (!id) return { html: `<p class="hist-empty">${esc(t('History is kept only for networks kept in this browser.'))}</p>${note}`, count: 0 };
    const rec = _trails.get(id) || null;
    const dev = rec ? rec.devices[node.id] || null : null;
    const blocks = historyBlocks(node, dev, rec);
    const count = blocks.reduce((n, b) => n + b.past.length, 0);
    const parts = [];
    if (!dev && !blocks.length) {
        parts.push(`<p class="hist-empty">${esc(on ? t("Nothing recorded yet: Topo notes this device's addresses, MAC, switch port and group each time the network is backed up or reported.")
            : t('Nothing recorded: address history is turned off in Settings.'))}</p>`);
    } else if (!blocks.length) {
        const first = dev.spans.reduce((m, s) => Math.min(m, s.first), Infinity);
        parts.push(`<p class="hist-empty">${esc(t('No changes recorded since {date}.', { date: localDateOf(first) }))}</p>`);
    }
    blocks.forEach((b) => {
        const lines = [];
        lines.push(`<li class="hist-line hist-now"><span class="hist-val">${esc(b.now || '—')}</span>`
            + `<span class="hist-when">${esc(b.since != null ? t('since {date}', { date: localDateOf(b.since) }) : t('now'))}</span></li>`);
        b.reuse.forEach((r) => lines.push(`<li class="hist-reuse">${esc(r)}</li>`));
        // A past value is a button: was: with it in the search box (stage 3).
        b.past.forEach((s) => lines.push(`<li class="hist-line" data-f="${esc(s.f)}"><button type="button" class="hist-val hist-was" data-was="${esc(historyWasQuery(s))}"`
            + ` title="${esc(t('Search for the devices that had this'))}">${esc(s.txt || s.val)}</button>`
            + `<span class="hist-when">${esc(historyRange(s))} <span class="hist-kind">${esc(t(HISTORY_KIND_WORDS[s.kind] || s.kind))}</span></span></li>`));
        parts.push(`<div class="hist-block" data-f="${esc(b.f)}" data-k="${esc(b.k)}"><p class="hist-label">${esc(b.label)}</p><ul class="hist-lines">${lines.join('')}</ul></div>`);
    });
    parts.push(note);
    if (dev) parts.push(`<div class="hist-acts"><button type="button" class="cs-btn hist-forget" data-hist-forget>${esc(t("Forget this device's history"))}</button></div>`);
    return { html: parts.join(''), count };
}

// ---- Address history in the Simple views (the owner, 2026-11-05) ----
// "Add optional history on simple view." Off unless Settings' Show address
// history in Simple view is ticked (state.settings.trailSimple, kept only
// when on). Then the reduced views' device panel gains a few plain lines
// under the Locate sentence (#historySimple), read from the same blocks as
// the Full section: the address, the switch it was plugged into, the place
// and the name it had, newest first, one sentence each. Read only: no was:
// buttons, no Forget, no MAC, no NIC names, no kinds; drawing it is no edit
// and no undo step. Off, the element stays empty and the panel is as before.
const HISTORY_SIMPLE_MAX = 4;
const trailSimpleOn = () => !!(state.settings && state.settings.trailSimple === true);
const HISTORY_SIMPLE_WORDS = { ip: 'Was {value} until {date}.', port: 'Was connected to {value} until {date}.',
    group: 'Was in {value} until {date}.', name: 'Was called {value} until {date}.' };
// A past uplink in the Locate sentence's words. The span keeps the structured
// 'peerId|portId' (portVal) beside its text 'name · port' (portTxt). With no
// port it was a radio link: the recorder (skipNoPort) keeps a portless link
// only when it is wireless, so 'On Wi-Fi through {ap}', never "plugged in".
// With a port, a radio interface on the peer (as the map holds it now) is
// Wi-Fi too; anything else is the switch and its socket. The name is split
// from the port label by what the map holds now (the port's label, or the
// peer's name, either of which may itself hold ' · '), else at the first
// ' · ' (the name as it was is not held apart).
function historySimplePort(s, value, date) {
    const val = String(s.val || '');
    const bar = val.indexOf('|');
    const peerId = bar >= 0 ? val.slice(0, bar) : '';
    const portId = bar >= 0 ? val.slice(bar + 1) : '';
    if (bar >= 0 && !portId) return t('Was on Wi-Fi through {ap} until {date}.', { ap: value, date });
    const peer = peerId ? getNode(peerId) : null;
    const SEP = ' · ';
    let cut = -1;
    if (peer && portId) {
        const label = String(ifaceLabel(peer, portId) || '');
        const name = (peer.name && String(peer.name).trim()) || peer.id;
        if (label && value.endsWith(SEP + label) && value.length > label.length + SEP.length) cut = value.length - label.length - SEP.length;
        else if (value.startsWith(name + SEP) && value.length > name.length + SEP.length) cut = name.length;
    }
    if (cut < 0) cut = value.indexOf(SEP);
    const sw = cut > 0 ? value.slice(0, cut) : value;
    if (peer && portId && ifaceIsWireless(explicitIface(peer, portId))) return t('Was on Wi-Fi through {ap} until {date}.', { ap: sw, date });
    return cut > 0 ? t('Was plugged into {switch}, socket {port} until {date}.', { switch: sw, port: value.slice(cut + SEP.length), date })
        : t(HISTORY_SIMPLE_WORDS.port, { value, date });
}
// The lines for one device: [text], newest first. Pure apart from reading the
// open network and its trail.
function historySimpleLines(node) {
    const id = historyCardId();
    if (!id) return [t('History is kept only for networks kept in this browser.')];
    const rec = _trails.get(id) || null;
    const dev = rec ? rec.devices[node.id] || null : null;
    const past = [];
    // The Full section keeps one block per NIC and labels it; these lines
    // name no NIC, so an address the device holds now on any NIC (moved to
    // a bond, a replacement NIC, two NICs swapped) is no past address, and
    // one address held on two NICs before is one line (its newest).
    const hostOf = (v) => String(v || '').replace(/\s+/g, '').toLowerCase().split('/')[0];
    const heldNow = new Set((node.interfaces || []).map((i) => (i ? hostOf(i.ip) : '')).filter(Boolean));
    historyBlocks(node, dev, rec).forEach((b) => {
        if (!HISTORY_SIMPLE_WORDS[b.f]) return;
        b.past.forEach((s) => {
            const raw = String(s.txt || s.val || '').trim();
            // An address without its prefix: '192.168.1.20', not '/24'.
            const value = b.f === 'ip' ? raw.split('/')[0].replace(/\s+/g, '') : raw;
            if (!value) return;
            if (b.f === 'ip' && heldNow.has(hostOf(value))) return;
            const date = localDateOf(s.last);
            const text = b.f === 'port' ? historySimplePort(s, value, date) : t(HISTORY_SIMPLE_WORDS[b.f], { value, date });
            past.push({ at: s.last, first: s.first, text, ip: b.f === 'ip' ? hostOf(value) : '' });
        });
    });
    past.sort((a, b) => b.at - a.at || b.first - a.first);
    const seenIp = new Set();
    for (let i = 0; i < past.length; i++) {
        if (!past[i].ip) continue;
        if (seenIp.has(past[i].ip)) { past.splice(i, 1); i--; } else seenIp.add(past[i].ip);
    }
    if (!past.length) return [!dev && !trailRecordingOn() ? t('Nothing recorded: address history is turned off in Settings.') : t('No earlier addresses recorded.')];
    const lines = past.slice(0, HISTORY_SIMPLE_MAX).map((p) => p.text);
    if (past.length > HISTORY_SIMPLE_MAX) lines.more = true;
    return lines;
}
function historySimpleHtml(node) {
    if (!node || !trailSimpleOn()) return '';
    const lines = historySimpleLines(node);
    return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')
        + (lines.more ? `<p class="hist-simple-more">${escapeHtml(t('Earlier changes are in the Full editor.'))}</p>` : '');
}
function renderHistorySimple(node) {
    const box = trailEl('historySimple');
    if (!box) return;
    const html = node && typeof isReduced === 'function' && isReduced() ? historySimpleHtml(node) : '';
    if (box._histHtml !== html) { box.innerHTML = html; box._histHtml = html; }
}

// Never lets a drawing fault reach the store's work.
function refreshHistoryPanelSafe() { try { refreshHistoryPanel(); } catch (e) { /* the next select draws it */ } }
// The open network's trail changed: its History section and any search
// answered from it (not on an edit, which redraws both itself).
function trailChangedHere() {
    refreshHistoryPanelSafe();
    refreshTrailQuery();
}
// A was: or has:history search in force answers from the trail, so a trail
// changed under it (a point recorded, a history forgotten or cleared, the
// store arriving, another tab) redraws the map's highlights, the count and
// the line under the box. Nothing for any other search.
function refreshTrailQuery() {
    try {
        const q = typeof activeQuery === 'function' ? activeQuery() : null;
        if (!q || typeof qQueryIsLocal !== 'function' || !qQueryIsLocal(q)) return;
        if (typeof renderCanvasOnly === 'function') renderCanvasOnly();
        if (typeof updateQueryBar === 'function') updateQueryBar();
    } catch (e) { /* the next redraw draws it */ }
}

// The section for the selected device (null: none, or not a device).
function renderHistoryFields(node) {
    const group = trailEl('historyGroup');
    if (!group) return;
    const body = trailEl('historyBody'), sum = trailEl('historySummary');
    const reduced = typeof isReduced === 'function' && isReduced();
    renderHistorySimple(node);
    if (!node || reduced) { body.innerHTML = ''; sum.textContent = ''; body._histHtml = ''; return; }
    const { html, count } = historyBodyHtml(node);
    // Redrawn on every edit (js/library.js noteDocChanged): the DOM is only
    // touched when what it says changed, so a keystroke or a drag elsewhere
    // costs one device's reading and no reflow.
    if (body._histHtml !== html) { body.innerHTML = html; body._histHtml = html; }
    const text = count ? t(count === 1 ? '{n} past value' : '{n} past values', { n: count }) : '';
    if (sum.textContent !== text) sum.textContent = text;
}
// The open network's selected device, drawn again (a point recorded, a
// trail from another tab, a history forgotten or cleared).
function refreshHistoryPanel() {
    if (!trailEl('historyGroup')) return;
    const node = state.selectedType === 'node' && state.selectedId && state.selection && state.selection.size <= 1 ? getNode(state.selectedId) : null;
    renderHistoryFields(node);
}

// Open state: a view preference of this browser, like the Asset and Locate groups'. Closed by default.
function restoreHistoryGroup() {
    const group = trailEl('historyGroup');
    if (!group) return;
    let open = false;
    try { open = localStorage.getItem(HISTORY_OPEN_KEY) === '1'; } catch (e) { /* storage blocked: closed */ }
    group.open = open;
}
if (trailEl('historyGroup')) {
    trailEl('historyGroup').addEventListener('toggle', () => {
        try { localStorage.setItem(HISTORY_OPEN_KEY, trailEl('historyGroup').open ? '1' : '0'); } catch (e) { /* storage blocked */ }
    });
    trailEl('historyBody').addEventListener('click', async (e) => {
        const was = e.target.closest('button[data-was]');
        if (was) { if (typeof setQuery === 'function') setQuery(was.dataset.was); return; }
        const b = e.target.closest('button[data-hist-forget]');
        if (!b) return;
        const id = historyCardId();
        const node = state.selectedType === 'node' && state.selectedId ? getNode(state.selectedId) : null;
        if (!id || !node) return;
        const name = String(node.name || '').trim() || node.id;
        const yes = await askConfirm(t('Forget the history recorded for {name} in this browser? The device itself is not changed. This cannot be undone.', { name }),
            { ok: t('Forget'), danger: true });
        if (!yes) return;
        forgetDevice(id, node.id);
        refreshHistoryPanel();
    });
    restoreHistoryGroup();
}

// The landing card's Clear history: every device's history of one card.
async function clearCardHistory(entry) {
    if (!entry || !hasTrail(entry.id)) return false;
    const yes = await askConfirm(t('Clear the address history kept for "{name}" in this browser? The network itself is not changed. This cannot be undone.', { name: entry.name }),
        { ok: t('Clear history'), danger: true });
    if (!yes) return false;
    dropTrail(entry.id);
    if (entry.id === state.libraryId) refreshHistoryPanel();
    return true;
}

// ---- Reading older back-ups in (feature 5, stage 4) ----
// A back-up file, or a binder's site, of a card whose own copy here is newer:
// what it held then goes into the card's history as a 'file' point at the
// time the file says it was saved (its `updated`), in its place among the
// points already there. The card, the canvas and the document are left as
// they are: only the trail changes. Any document version this build reads
// (1 to DOC_VERSION) is a source, read through canonicalDoc as everything
// else is; one from a newer Topo is not (recordPoint).
//
// May this copy be offered for the history of a card? It needs a time to go
// in at, a version this build reads, and recording turned on.
function trailCanReadIn(doc, updated) {
    return trailRecordingOn() && Number.isFinite(updated) && updated > 0
        && !!doc && Array.isArray(doc.nodes) && docVersionOf(doc) <= DOC_VERSION;
}
// A card whose history a copy can go into: a network kept here, not a
// template or a block (those are not surveyed networks). Both doors (Open a
// file, a binder) ask this.
function trailReadInCard(id) {
    const entry = id && typeof libraryEntry === 'function' ? libraryEntry(id) : null;
    return !!entry && !entry.template && !entry.block;
}
// Does `rec` already hold the copy observed as `obs`, saved at `at`? Yes
// with a point at that time (the same file read twice), and yes when the
// first point after it holds exactly what the copy holds: a back-up's own
// point is stamped when it went out, after the card's last edit that the
// file carries as its time, so reading that back-up back is not a new point.
function trailHoldsCopy(rec, obs, at) {
    if (!rec || !obs) return false;
    if (rec.points.some((p) => p.at === at)) return true;
    const next = rec.points.find((p) => p.at > at);
    if (!next) return false;
    const t = next.at;
    const liveOf = (dev) => (dev ? dev.spans.filter((s) => s.first <= t && s.last >= t) : []);
    for (const id of Object.keys(rec.devices)) {
        if (!Object.prototype.hasOwnProperty.call(obs, id) && liveOf(rec.devices[id]).length) return false;
    }
    for (const id of Object.keys(obs)) {
        const held = new Map();
        liveOf(rec.devices[id]).forEach((s) => held.set(spanKey(s.f, s.k), s));
        const want = new Map();
        ((obs[id] && obs[id].values) || []).forEach((v) => { const key = spanKey(v.f, v.k); if (!want.has(key)) want.set(key, v); });
        if (want.size !== held.size) return false;
        for (const [key, v] of want) {
            const s = held.get(key);
            if (!s || (s.val !== v.val && !heldAlt(v, s))) return false;
        }
    }
    return true;
}
// One copy in. -> 'added', 'known' (already held: the same file read twice,
// or a back-up whose own point holds what it holds, trailHoldsCopy), 'old' (older than the points kept, so the bound
// takes it straight back out) or 'failed' (not a copy that can go in).
function readIntoTrail(id, doc, updated) {
    if (!id || !trailCanReadIn(doc, updated) || !trailReadInCard(id)) return 'failed';
    const rec = _trails.get(id) || null;
    if (trailHoldsCopy(rec, observeDoc(doc), updated)) return 'known';
    if (recordPoint(id, 'file', doc, updated)) return 'added';
    if (rec && rec.points.length >= TRAIL_POINTS_MAX && updated < rec.points[0].at) return 'old';
    return 'failed';
}
// The toast for one copy read into the card named `name`.
function readIntoTrailText(result, name) {
    if (result === 'added') return t('Added this back-up to the history of "{name}". The network itself is not changed.', { name });
    if (result === 'known') return t('This back-up is already in the history of "{name}".', { name });
    if (result === 'old') return t('This back-up is older than the history kept for "{name}", so nothing was added.', { name });
    return t('Could not add this back-up to the history.');
}
// The binder's door: the sites whose card here is newer than the binder's
// copy, offered in one question after the merge. sites: [{ id, doc, updated }].
// -> how many went in.
async function offerOlderSitesToTrail(sites) {
    // Only the ones that would go in: never a template's, nor one already
    // held (the same binder opened again asks nothing), nor one older than
    // a full history keeps.
    const list = (sites || []).filter((s) => {
        if (!s || !s.id || !trailCanReadIn(s.doc, s.updated) || !trailReadInCard(s.id)) return false;
        const rec = _trails.get(s.id) || null;
        if (rec && rec.points.length >= TRAIL_POINTS_MAX && s.updated < rec.points[0].at) return false;
        return !trailHoldsCopy(rec, observeDoc(s.doc), s.updated);
    });
    if (!list.length) return 0;
    const n = list.length;
    const choice = await askChoice(t(n === 1
        ? '{n} network in this binder is older than yours here. Add it to its history? Yours stays as it is.'
        : '{n} networks in this binder are older than yours here. Add them to their history? Yours stay as they are.', { n }), {
        title: t('History'),
        choices: [{ id: 'skip', label: t('Not now') }, { id: 'history', primary: true, label: t(n === 1 ? 'Add to its history' : 'Add to their history') }]
    });
    if (choice !== 'history') return 0;
    const added = list.filter((s) => readIntoTrail(s.id, s.doc, s.updated) === 'added').length;
    showToast(t(added === 1 ? '{n} older back-up added to the history.' : '{n} older back-ups added to the history.', { n: added }), added ? 'ok' : undefined);
    if (typeof landingIsOpen === 'function' && landingIsOpen()) renderLanding();
    return added;
}

// ---- The report's Address history (feature 5, stage 5) ----
// An optional section of the technical sheet (REPORT_SECTIONS 'history', off
// unless ticked; an owner request, 2026-11-05): per device, the values its
// trail holds that changed since the previous report point (the newest
// 'report' point; the whole trail when there is none), the value in the
// document now first, then each past one with the dates it was seen and how
// it was recorded. A device whose values were the same throughout is left
// out; a removed one is listed with the date it went. Read from this
// browser's trail and the document handed in, never the open network, so a
// binder site reads its own card's trail. The Simple summary never prints
// it. -> null when the card has no trail (nothing recorded), else
// { since, first, devices: [{ id, name, gone, blocks: [{ f, k, label, now, since, past: [span] }] }] }
// where since is the previous report point's time (null: none) and first the
// oldest point's.
function trailReportHistory(id, doc) {
    const rec = id ? _trails.get(id) : null;
    if (!rec || !rec.points.length || !doc || !Array.isArray(doc.nodes)) return null;
    let canon, obs;
    try { canon = canonicalDoc(doc); obs = observeDoc(doc, canon); } catch (e) { return null; }
    const reports = rec.points.filter((p) => p.kind === 'report');
    const since = reports.length ? reports[reports.length - 1].at : null;
    const from = since === null ? -Infinity : since;
    const newestAt = rec.points[rec.points.length - 1].at;
    const nodes = new Map();
    (Array.isArray(canon.nodes) ? canon.nodes : []).forEach((n) => { if (n && n.id && !nodes.has(n.id)) nodes.set(n.id, n); });
    const deviceOf = (devId, dev) => {
        const node = nodes.get(devId) || null;
        const now = obs[devId] ? obs[devId].values : [];
        const nowOf = new Map(now.map((v) => [spanKey(v.f, v.k), v]));
        const spans = dev.spans.filter((s) => s.last >= from);
        if (!spans.length) return null;
        const keys = [];
        const seen = new Set();
        const push = (f, k) => { const key = spanKey(f, k); if (!seen.has(key)) { seen.add(key); keys.push({ f, k }); } };
        const ifaceIds = node ? (node.interfaces || []).filter((i) => i && i.id).map((i) => i.id) : [];
        spans.forEach((s) => { if ((s.f === 'ip' || s.f === 'mac') && !ifaceIds.includes(s.k)) ifaceIds.push(s.k); });
        ifaceIds.forEach((k) => { push('ip', k); push('mac', k); });
        ['port', 'group', 'name'].forEach((f) => push(f, ''));
        // A NIC the document no longer holds has no name to print: on a
        // removed device each reads 'interface {n}', on a current one
        // 'removed interface' ('removed interface {n}' when there are
        // several), numbered in the order the trail first saw them.
        const nowIfaces = node ? (node.interfaces || []).filter((i) => i && i.id) : [];
        const lost = [];
        spans.slice().sort((a, b) => a.first - b.first).forEach((s) => {
            if ((s.f === 'ip' || s.f === 'mac') && !nowIfaces.some((i) => i.id === s.k) && !lost.includes(s.k)) lost.push(s.k);
        });
        const ifName = (k) => {
            const i = nowIfaces.find((x) => x.id === k);
            if (i) return String(i.name || '').trim() || k;
            const n = lost.indexOf(k) + 1;
            if (!node) return lost.length > 1 ? t('interface {n}', { n }) : '';
            return lost.length > 1 ? t('removed interface {n}', { n }) : t('removed interface');
        };
        const label = (f, k) => {
            const nic = (f === 'ip' || f === 'mac') ? ifName(k) : '';
            const word = f === 'ip' ? t('Address') : f === 'mac' ? t('MAC') : f === 'port' ? t('Switch port') : f === 'group' ? t('Group') : t('Name');
            return nic ? `${word} (${nic})` : word;
        };
        const blocks = [];
        const added = [];
        keys.forEach(({ f, k }) => {
            const list = spans.filter((s) => s.f === f && s.k === k).sort((a, b) => b.last - a.last || b.first - a.first);
            if (!list.length) return;
            let cur = node ? nowOf.get(spanKey(f, k)) || null : null;
            // A device on two switches reads as the uplink it was recorded
            // on while that cable is still there, as the History section does.
            const alt = list[0].last === newestAt ? heldAlt(cur, list[0]) : null;
            if (alt) cur = { f, k, val: alt.val, txt: alt.txt };
            const present = cur && list[0].val === cur.val && list[0].last === newestAt ? list[0] : null;
            // The value now is the newest one recorded, typed back after a
            // point that held none: it reads as now, not twice.
            const back = !present && cur && list[0].val === cur.val;
            const past = present || back ? list.slice(1) : list;
            const block = { f, k, label: label(f, k), now: cur ? cur.txt : '', since: present ? present.first : null,
                past: past.map((s) => ({ f: s.f, val: s.val, txt: s.txt, first: s.first, last: s.last, kind: s.kind })) };
            if (!past.length) {
                // A NIC added in the window: kept aside, printed only beside
                // a removed one (a swapped NIC), so the address it took shows.
                if ((f === 'ip' || f === 'mac') && cur && present && present.first > from && node) added.push(block);
                return;
            }
            blocks.push(block);
        });
        added.forEach((b) => {
            if (!blocks.some((x) => x.f === b.f && lost.includes(x.k))) return;
            const at = blocks.findIndex((x) => x.f === b.f);
            blocks.splice(at < 0 ? blocks.length : at, 0, b);
        });
        if (!blocks.length) return null;
        const name = node ? (String(node.name || '').trim() || devId) : (dev.name || devId);
        // Removed since the newest point: no point has noted it missing, so
        // it went after that point's date.
        const gone = node ? null : (Number.isFinite(dev.gone) ? dev.gone : null);
        return { id: devId, name, gone, goneAfter: !node && gone === null ? newestAt : null, blocks };
    };
    const devices = [];
    nodes.forEach((node, devId) => {
        const dev = Object.prototype.hasOwnProperty.call(rec.devices, devId) ? rec.devices[devId] : null;
        const d = dev ? deviceOf(devId, dev) : null;
        if (d) devices.push(d);
    });
    const removed = [];
    Object.keys(rec.devices).forEach((devId) => {
        if (nodes.has(devId)) return;
        const d = deviceOf(devId, rec.devices[devId]);
        if (d) removed.push(d);
    });
    removed.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { since, first: rec.points[0].at, devices: devices.concat(removed) };
}

// Published for tests/suites/trail.js.
window.CarinoTrail = { TRAIL_DB, TRAIL_STORE, TRAIL_KINDS, TRAIL_POINTS_MAX, TRAIL_SPANS_PER_KEY, TRAIL_SPANS_MAX, TRAIL_GONE_MS,
    validTrail, observeDoc, observeNode, mergeObservation, pruneTrail, idbTrailAdapter, openTrailStore, adoptTrailStore, releaseTrailStore,
    recordPoint, dropTrail, trailOf, deviceTrail, trailRecordingOn, hasTrail, forgetDevice, historyBlocks, renderHistoryFields,
    refreshHistoryPanel, clearCardHistory, trailSimpleOn, historySimpleLines, historySimpleHtml, renderHistorySimple, HISTORY_SIMPLE_MAX, restoreHistoryGroup, queueTrailOp, HISTORY_OPEN_KEY, historyWasQuery, refreshTrailQuery,
    insertObservation, trailCanReadIn, readIntoTrail, readIntoTrailText, offerOlderSitesToTrail, trailReadInCard, trailHoldsCopy, trailReportHistory };
