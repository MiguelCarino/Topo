// ---- Merge: two copies of one network made one (docs/SCOPE.md section 3, step 2) ----
// A technician maps part of a site in a fresh session and someone merges
// their file into the site's network (two-way: there is no copy both started
// from). A copy goes out and comes back edited while the network here was
// edited too (three-way: the copy it was taken from, its base, is in the
// revision store, js/revisions.js). Both sides' edits must survive.
//
// This file is the engine and only the engine: pure functions over three
// documents, no DOM, no writes to `state`. It reads the open document only
// through the borrows every reader of another document uses (canonicalDoc
// and withDoc, js/library.js), which put the open one back.
//
//   planMerge(mine, theirs, base|null, opts?) -> plan
//       Every item of every kind with its status (added, changed, unchanged,
//       removed, conflict) and, for one in both, its differing fields, each
//       with the side it takes by default. Deterministic: the same three
//       documents give the same plan, ids and all.
//   applyMergePlan(mine, plan, choices?) -> { doc, counts, notes }
//       The merged document, read back through the same normalizers as a
//       load. choices: { [item.key + '#' + field]: 'mine' | 'theirs',
//       [item.key]: 'keep' | 'remove' | candidate id | 'add' | 'skip' };
//       a conflict with no choice takes its default, so {} is "the defaults".
//   mergeFindingsDelta(mine, result) -> what the findings would do.
//   The network log: unionLogs, mergeLogEntry, appendLogEntry, verifyLog.
//
// Matching theirs to mine (strongest first; an ambiguous match is a
// conflict, never a guess):
//   devices        id, asset tag, serial, MAC, IP, name
//   interfaces     (inside a matched device) id, MAC, IP, a unique name
//   cables         id (when its ends are the same two devices), then both
//                  ends and their ports, whichever way round it was drawn
//   subnets        id, range (never relocated, as a block's are)
//   groups         id, path (Building / Floor / Room / Rack)
//   Wi-Fi          id, SSID;  providers  id, name
//   problem reports id only (a random token: the same id is the same report)
//   notes          id, the same text on the same things
//   saved searches id, name;  custom columns  id, name
//   accepted findings and pins: by check, scope and what they name
//   the report header, expected lives: per field; the table view: mine
//   wins, unless only theirs changed it (three-way).
//
// An id is an identity only when the document carried it: canonicalDoc mints
// the same n_00, l_01... for records with none in both copies, and those
// must not pair unrelated records (rawIds). In two-way, an id match is also
// checked for contradiction, because ids repeat across unrelated documents:
// the templates' fixed device and interface ids (h1, i1) and providers
// (pv_isp), custom columns c1, c2..., searches sq_1. A contradicted id (other
// name, SSID, kind...) is "unrelated": theirs gets a new id and goes on to the
// other matchers (docs/SCOPE.md D30).
//
// Rules. Two-way: only in theirs = added; only in mine = kept (two-way
// never removes); in both and different = changed, every differing field a
// conflict defaulting to mine, except a field empty in mine and filled in
// theirs, which takes theirs, and a field empty in theirs, which keeps mine
// without asking (D32). Three-way, per field: changed on one side
// only takes that side, the same on both is fine, different on both is a
// conflict defaulting to mine; per item: removed on one side and untouched
// on the other is removed, removed on one side and edited on the other is a
// conflict defaulting to keep; added on both with the same match is
// two-way for that item. An edit to a device's interfaces or cables is an
// edit to the device for the removal rules (docs: A10); a reference to a
// group, column, provider, Wi-Fi network or subnet added or changed is an
// edit to it, a cable plugged into an interface an edit to the interface, and
// a cable removed only with its device follows that device (D27). A range or
// name that must stay unique never takes theirs where it would be there twice
// (D28).
//
// Sets (v18, docs/SCOPE.md D37): an item's providers, and a problem report's
// devices, providers sent to and visits, merge as sets and never ask:
// two-way their union, three-way per element (added on either side is in,
// removed on one side and not added on the other is out). The field row
// takes 'merged' with the result in `value`. Removing a provider the other
// side relies on stays a conflict (refsEdited). A problem report's status
// only moves forward (open < sent < visited < closed, a reopen one round
// up: incidentRank), so the later one is taken without asking, its close
// date and note with it; its first send is the earliest. A report is never
// removed by a merge: only the cap drops them (D39).
// An outage (v19, step 7g) merges without asking too: its acts and its
// times down are unions (an act is the same act by its kind, time and
// author; a time down by its start, its end the later one known), the
// devices behind it a set, and two installs that closed it at once keep
// both acts and the earlier close.
//
// Ids: matched items keep mine's; theirs' that are free keep theirs; one
// taken by an unrelated item of mine gets mintMergeId (theirs id + 'm' + k),
// a custom column the next c<N>; every reference in theirs follows.
// Positions are never conflicts: matched devices stay where mine has them,
// added ones go inside their group, or beside the device they are cabled
// to, or beside the map (placeAdded).

class MergeRefused extends Error {
    constructor(reason) { super(`merge refused: ${reason}`); this.name = 'MergeRefused'; this.reason = reason; }
}

// The order the plan lists items in (the review's), and the order kinds are
// matched in (a kind after every kind its records name).
const MERGE_KINDS = ['nodes', 'links', 'networks', 'groups', 'wifi', 'providers', 'incidents', 'annotations', 'searches', 'columns', 'accepted', 'pinned', 'report', 'expectedLife', 'tableView'];
const MERGE_LIST_KINDS = ['nodes', 'links', 'networks', 'groups', 'wifi', 'providers', 'incidents', 'annotations', 'searches', 'columns'];
const MERGE_NOTE_KINDS = ['accepted', 'pinned'];
const MERGE_STATUSES = ['added', 'changed', 'unchanged', 'removed', 'conflict'];
// What a record of each kind holds that is not compared field by field: its
// id, a device's place on the map (never a conflict), its interfaces (child
// items) and the bags split into one field each (portAttrs, extra, cable).
const MERGE_SKIP = {
    nodes: ['id', 'x', 'y', 'interfaces', 'portAttrs', 'extra'], links: ['id', 'cable'], ifaces: ['id'],
    networks: ['id'], groups: ['id'], wifi: ['id'], providers: ['id'], incidents: ['id', 'status', 'reopened', 'closedAt', 'closedNote'], annotations: ['id', 'x', 'y'],
    searches: ['id'], columns: ['id'], accepted: ['check', 'scope', 'nodeIds', 'linkIds'], pinned: ['check', 'scope', 'nodeIds', 'linkIds'],
    report: [], expectedLife: []
};
// Findings whose scope names a subnet (diagnostics.js address-capacity,
// dhcp-pool) or a Wi-Fi network (wifi-security), so it is remapped with it.
const MERGE_SCOPE_REFS = { 'address-capacity': 'networks', 'dhcp-pool': 'networks', 'wifi-security': 'wifi' };
const MERGE_STEP_MAX = 40;        // placeAdded: grid steps tried right, then down
const MERGE_BESIDE_GAP = 160;     // as besideTheMap (js/add.js)

// ---- Small pure helpers ----
const mgClone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
function mgSorted(v) {
    if (Array.isArray(v)) return v.map(mgSorted);
    if (v && typeof v === 'object') {
        const o = {};
        Object.keys(v).sort().forEach((k) => { if (v[k] !== undefined) o[k] = mgSorted(v[k]); });
        return o;
    }
    return v;
}
// Equal as stored: key order does not matter, undefined and null are both
// "nothing".
const mgKey = (v) => JSON.stringify(mgSorted(v === undefined ? null : v));
const mgSame = (a, b) => mgKey(a) === mgKey(b);
const mgEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim())
    || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const mgLower = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();

// A new id for a theirs record whose own is taken: its id with 'm' and the
// smallest number that is free. Deterministic, no clock, and the prefix (n_,
// l_, net_, i...) is kept for whatever reads it.
function mintMergeId(id, taken) {
    let k = 1;
    while (taken.has(`${id}m${k}`)) k++;
    return `${id}m${k}`;
}

// ---- The inputs ----
// The ids each record carried as given, before canonicalDoc mints any (A6).
// An id an importer made up for a record its source has no key for
// (js/importers/common.js, docs/SCOPE.md D115): never an identity, and never
// kept when the record is added (mergeAssignIds gives it one of its own).
const TRANSIENT_ID_RE = /^imp-/;
const isTransientId = (id) => typeof id === 'string' && TRANSIENT_ID_RE.test(id);
// Its id once adopted: the prefix off, or a fresh one when that is taken.
const adoptedId = (id, taken) => { const s = id.slice(4) || 'x'; return taken.has(s) ? mintMergeId(s, taken) : s; };
function mergeRawIds(doc) {
    const ids = (list) => new Set((Array.isArray(list) ? list : []).filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id && !isTransientId(r.id)).map((r) => r.id));
    const out = {};
    MERGE_LIST_KINDS.forEach((k) => { out[k] = ids(doc[k]); });
    out.ifaces = new Map();
    (Array.isArray(doc.nodes) ? doc.nodes : []).forEach((n) => {
        if (n && typeof n.id === 'string' && !out.ifaces.has(n.id)) out.ifaces.set(n.id, ids(n.interfaces));
    });
    return out;
}
// One side, canonical (migrated, normalized, identity stripped), its log
// apart: the log is unioned, never reviewed.
function mergeInput(doc) {
    if (!isDocShape(doc)) throw new MergeRefused('shape');
    if (migrateDoc(doc).newer) throw new MergeRefused('newer');
    const raw = mergeRawIds(doc);
    const canon = canonicalDoc(doc);
    // A provider's part marks the ports its left-out cables use (D364); the
    // client's network has those cables, never the mark.
    (Array.isArray(canon.nodes) ? canon.nodes : []).forEach((n) => {
        if (!n || !n.portAttrs || typeof n.portAttrs !== 'object') return;
        Object.keys(n.portAttrs).forEach((k) => {
            const a = n.portAttrs[k];
            if (!a || a.partUsed === undefined) return;
            delete a.partUsed;
            if (!Object.keys(a).length) delete n.portAttrs[k];
        });
        if (!Object.keys(n.portAttrs).length) delete n.portAttrs;
    });
    const log = Array.isArray(canon.log) ? canon.log : [];
    delete canon.log;
    const rev = typeof doc.rev === 'string' ? doc.rev : null;
    return { doc: canon, raw, log, rev };
}
const mgList = (doc, kind) => (Array.isArray(doc[kind]) ? doc[kind] : []);

// ---- Fields ----
// A record as the fields it is compared by: one value each, a device's port
// facts one per port ('port p3') and its custom values one per column
// ('x:c2'), a cable's facts one per key ('cable.label').
function mergeFlat(kind, rec) {
    const out = {};
    if (!rec || typeof rec !== 'object') return out;
    const skip = MERGE_SKIP[kind] || ['id'];
    Object.keys(rec).forEach((k) => { if (!skip.includes(k) && rec[k] !== undefined) out[k] = rec[k]; });
    if (kind === 'nodes') {
        Object.keys(rec.portAttrs || {}).forEach((p) => { out[`port ${p}`] = rec.portAttrs[p]; });
        Object.keys(rec.extra || {}).forEach((c) => { out[`x:${c}`] = rec.extra[c]; });
    }
    if (kind === 'links') Object.keys(rec.cable || {}).forEach((k) => { out[`cable.${k}`] = rec.cable[k]; });
    // A problem report's state is one field: its status, the reopen count
    // and the closure, which follow the status that wins.
    if (kind === 'incidents') {
        const st = {};
        MERGE_INCIDENT_STATE.forEach((k) => { if (rec[k] !== undefined) st[k] = rec[k]; });
        if (rec.kind === 'outage') st.outage = true;
        out.state = st;
    }
    return out;
}
const MERGE_INCIDENT_STATE = ['status', 'reopened', 'closedAt', 'closedNote'];
// The fields merged as sets, per kind (D37).
const MERGE_SET_FIELDS = { nodes: ['providers'], links: ['providers'], groups: ['providers'], incidents: ['nodeIds', 'routedTo', 'visits', 'behind'] };
// The lists of records merged as unions by a key (an outage's acts and its
// times down, step 7g): never a question, nothing taken away.
const MERGE_UNION_FIELDS = { incidents: { acts: (a) => outageActKey(a), outages: (o) => String(o && o.from) } };
function mergeUnionValue(field, mine, theirs) {
    const key = MERGE_UNION_FIELDS.incidents[field];
    const out = mgArr(mine).map(mgClone);
    mgArr(theirs).forEach((x) => {
        const i = out.findIndex((y) => key(y) === key(x));
        if (i < 0) { out.push(mgClone(x)); return; }
        // The same time down: its end the later one known.
        if (field === 'outages' && Number.isFinite(x.to) && !(Number.isFinite(out[i].to) && out[i].to >= x.to)) out[i].to = x.to;
    });
    const by = field === 'acts' ? (a) => a.at : (o) => o.from;
    return out.sort((a, b) => by(a) - by(b));
}
const mgArr = (v) => (Array.isArray(v) ? v : []);
// A set field merged: two-way the union, three-way per element. In mine's
// order, then what theirs adds.
function mergeSetValue(mine, theirs, base) {
    const M = mgArr(mine), T = mgArr(theirs);
    if (base === null) return M.concat(T.filter((x) => !M.includes(x)));
    const B = mgArr(base);
    const gone = B.filter((x) => !T.includes(x));
    return M.concat(T.filter((x) => !B.includes(x) && !M.includes(x))).filter((x) => !gone.includes(x));
}
// Sets one of those fields on a record (undefined: takes it away).
function mergeSetFlat(kind, rec, field, value) {
    const bag = (key, sub) => {
        const b = Object.assign({}, rec[key] || {});
        if (value === undefined) delete b[sub]; else b[sub] = mgClone(value);
        if (Object.keys(b).length) rec[key] = b; else delete rec[key];
    };
    if (kind === 'nodes' && field.startsWith('port ')) return bag('portAttrs', field.slice(5));
    if (kind === 'nodes' && field.startsWith('x:')) return bag('extra', field.slice(2));
    if (kind === 'links' && field.startsWith('cable.')) return bag('cable', field.slice(6));
    if (kind === 'incidents' && field === 'state') {
        MERGE_INCIDENT_STATE.forEach((k) => { if (value && value[k] !== undefined) rec[k] = mgClone(value[k]); else delete rec[k]; });
        return undefined;
    }
    // A set emptied is no key, as the normalizers write it.
    if (Array.isArray(value) && !value.length && (MERGE_SET_FIELDS[kind] || []).includes(field) && kind !== 'incidents') { delete rec[field]; return undefined; }
    if (value === undefined) delete rec[field]; else rec[field] = mgClone(value);
    return undefined;
}
// The fields that differ, each with the side it takes and whether it is a
// conflict. fb null: two-way rules; an object: three-way. kind, when given,
// names the record's kind for the fields with rules of their own: the sets
// (take 'merged', the result in value) and a problem report's state and
// first send.
function mergeFields(fm, ft, fb, kind) {
    const keys = [...new Set([...Object.keys(fm), ...Object.keys(ft), ...Object.keys(fb || {})])];
    const out = [];
    const sets = MERGE_SET_FIELDS[kind] || [];
    keys.forEach((field) => {
        const mine = fm[field], theirs = ft[field];
        if (mgSame(mine, theirs)) return;
        const row = { field, mine: mgClone(mine), theirs: mgClone(theirs) };
        if (fb) row.base = mgClone(fb[field]);
        if (sets.includes(field)) {
            const value = mergeSetValue(mine, theirs, fb ? fb[field] : null);
            const same = (a, b) => mgArr(a).length === mgArr(b).length && mgArr(a).every((x) => mgArr(b).includes(x));
            if (same(value, mine)) return;
            out.push(Object.assign(row, same(value, theirs) ? { take: 'theirs', conflict: false } : { take: 'merged', value, conflict: false }));
            return;
        }
        const unions = MERGE_UNION_FIELDS[kind] || {};
        if (unions[field]) {
            const value = mergeUnionValue(field, mine, theirs);
            if (mgSame(value, mine)) return;
            out.push(Object.assign(row, mgSame(value, theirs) ? { take: 'theirs', conflict: false } : { take: 'merged', value, conflict: false }));
            return;
        }
        if (kind === 'incidents' && field === 'state') {
            const rm = incidentRank(mine), rt = incidentRank(theirs);
            if (rm > rt) return;                                 // mine is later: it stays
            if (rt > rm) { out.push(Object.assign(row, { take: 'theirs', conflict: false })); return; }
            // An outage closed on both sides at once: the earlier close.
            if (mine && theirs && mine.outage && theirs.outage && Number.isFinite(mine.closedAt) && Number.isFinite(theirs.closedAt)) {
                if (theirs.closedAt < mine.closedAt) out.push(Object.assign(row, { take: 'theirs', conflict: false }));
                return;
            }
        }
        if (kind === 'incidents' && field === 'sentAt' && Number.isFinite(mine) && Number.isFinite(theirs)) {
            if (theirs < mine) out.push(Object.assign(row, { take: 'theirs', conflict: false }));
            return;
        }
        if (!fb) {
            if (mgEmpty(mine) && !mgEmpty(theirs)) out.push(Object.assign(row, { take: 'theirs', conflict: false }));
            // Blank in theirs, filled in mine: a partial copy (a technician's
            // file) says nothing about that field, so mine stays, quietly
            // (docs/SCOPE.md D32).
            else if (mgEmpty(theirs)) return;
            else out.push(Object.assign(row, { take: 'mine', conflict: true }));
            return;
        }
        const base = fb[field];
        if (mgSame(theirs, base)) return;                      // only mine changed it: mine stays
        if (mgSame(mine, base)) out.push(Object.assign(row, { take: 'theirs', conflict: false }));
        else out.push(Object.assign(row, { take: 'mine', conflict: true }));
    });
    return out;
}

// ---- Matching ----
// Runs `finders` (strongest first) over the theirs records not matched yet,
// one finder over all of them before the next, so a strong match claims its
// record before a weak one can. A finder answers the mine records a theirs
// record names (none when the match is contradicted: no match by this key).
// One hit among the unclaimed pairs; several are ambiguous.
//   -> { pair: Map(theirsRec -> { mine, by }), ambiguous: Map(theirsRec -> { candidates, by }) }
function mergeMatchPasses(theirsList, finders, claimed, out) {
    // A weak key (an asset tag, an address, a name, a place) that hits a
    // record another provider's copy added (f.others, mergePartPool,
    // D152.2): held back until every finder has run, so a later strong key
    // (serial, MAC) still pairs it; else asked, Add as new by default (D179).
    // The weak finders after it do not pair it either.
    const pending = new Map();
    finders.forEach((f) => {
        theirsList.forEach((t) => {
            if (out.pair.has(t) || out.ambiguous.has(t) || out.done.has(t)) return;
            if (f.others && pending.has(t)) return;
            const hits = (f.find(t) || []).filter((m) => !claimed.has(m));
            if (!hits.length) return;
            if (f.others && hits.some(f.others)) { pending.set(t, { hits, by: f.by }); return; }
            if (hits.length > 1) { out.ambiguous.set(t, { candidates: hits.map((m) => m.id), by: f.by }); return; }
            out.pair.set(t, { mine: hits[0], by: f.by });
            claimed.add(hits[0]);
        });
    });
    pending.forEach((p, t) => {
        if (out.pair.has(t) || out.ambiguous.has(t) || out.done.has(t)) return;
        const left = p.hits.filter((m) => !claimed.has(m));
        if (left.length) out.ambiguous.set(t, { candidates: left.map((m) => m.id), by: p.by, other: true });
    });
}
// The skeleton every list kind is matched with. kind's finders are built by
// the caller over `pool` (the mine records a two-way match may take).
//   three-way: base <-> mine and base <-> theirs by id first; what is new on
//   both sides is then matched two-way among themselves.
function mergeMatchKind(kind, ctx, finders, opts = {}) {
    const mine = opts.mine || mgList(ctx.M.doc, kind), theirs = opts.theirs || mgList(ctx.T.doc, kind);
    const rawM = opts.rawMine || ctx.M.raw[kind], rawT = opts.rawTheirs || ctx.T.raw[kind];
    const base = ctx.B ? (opts.base || mgList(ctx.B.doc, kind)) : null;
    const rawB = ctx.B ? (opts.rawBase || ctx.B.raw[kind]) : null;
    const out = { pair: new Map(), ambiguous: new Map(), done: new Set(), baseOf: new Map(), removedTheirs: new Set(), removedMine: new Map() };
    const claimed = new Set();
    const mineById = new Map(mine.filter((m) => rawM.has(m.id)).map((m) => [m.id, m]));
    if (base) {
        const baseById = new Map(base.filter((b) => rawB.has(b.id)).map((b) => [b.id, b]));
        theirs.forEach((t) => {
            const b = rawT.has(t.id) ? baseById.get(t.id) : null;
            if (!b) return;
            const m = mineById.get(t.id);
            if (m) { out.pair.set(t, { mine: m, by: 'id', base: b }); claimed.add(m); } else out.removedMine.set(t, b);
            out.done.add(t);
        });
        mine.forEach((m) => {
            const b = rawM.has(m.id) ? baseById.get(m.id) : null;
            if (!b) return;
            out.baseOf.set(m, b);
            if (!claimed.has(m)) { out.removedTheirs.add(m); claimed.add(m); }
        });
    }
    // Forced by a choice in the review (an ambiguous match answered).
    theirs.forEach((t) => {
        const f = ctx.force[`${kind}:${t.id}`];
        if (f === undefined || out.done.has(t)) return;
        const m = f === 'add' ? null : mine.find((x) => x.id === f && !claimed.has(x));
        if (m) { out.pair.set(t, { mine: m, by: 'chosen' }); claimed.add(m); }
        // The one chosen was already chosen for another of theirs: still a
        // question, never added as new behind the answer's back.
        else if (f !== 'add') out.ambiguous.set(t, { candidates: [f], by: 'chosen', taken: true });
        out.done.add(t);
    });
    mergeMatchPasses(theirs, finders(claimed), claimed, out);
    return out;
}
// Two-way id finder: the same id, carried by both, and not contradicted.
const mgIdFinder = (ctx, kind, mine, rawM, rawT, contradicts) => {
    const byId = new Map(mine.filter((m) => rawM.has(m.id)).map((m) => [m.id, m]));
    return { by: 'id', find: (t) => {
        const m = rawT.has(t.id) ? byId.get(t.id) : null;
        return m && !(contradicts && contradicts(m, t)) ? [m] : [];
    } };
};
const mgByKey = (by, mine, keyOf) => {
    const map = new Map();
    mine.forEach((m) => { const k = keyOf(m); if (!k) return; const a = map.get(k) || []; a.push(m); map.set(k, a); });
    return { by, find: (t) => { const k = keyOf(t); return k ? map.get(k) || [] : []; } };
};

// A device's MACs (normalized) and addresses, from its interfaces.
const mgMacs = (n) => [...new Set((n.interfaces || []).map((i) => normMac(i.mac)).filter((m) => m.length === 12))];
const mgIps = (n) => [...new Set((n.interfaces || []).map((i) => { const p = parseValidCIDR(i.ip); return p ? p.ip.toString() : ''; }).filter(Boolean))];
const mgName = (n) => { const s = mgLower(n.name); return s && s !== 'unnamed node' ? s : ''; };
// A match that says, in the same breath, that it is another box (A7, and the
// importer's csvAnotherDevice, js/csv.js). By id: an asset tag or a serial
// that differs, MACs on both that share none, or both the name and the type
// differ. By IP: a tag or serial that differs, or two of another MAC, name
// and type. By name: a tag or serial that differs, or another MAC and type.
function mergeContradicts(m, t, by) {
    const differs = (k) => !isBlank(m[k]) && !isBlank(t[k]) && mgLower(m[k]) !== mgLower(t[k]);
    if (differs('assetTag') || differs('serial')) return true;
    const mm = mgMacs(m), tm = mgMacs(t);
    const macDisjoint = mm.length > 0 && tm.length > 0 && !tm.some((x) => mm.includes(x));
    const nameDiffers = mgLower(m.name) !== mgLower(t.name), typeDiffers = m.type !== t.type;
    if (by === 'id') return macDisjoint || (nameDiffers && typeDiffers);
    if (by === 'ip') return [macDisjoint, nameDiffers, typeDiffers].filter(Boolean).length >= 2;
    if (by === 'name') return macDisjoint && typeDiffers;
    return false;
}

// ---- Result ids ----
// Matched: mine's. Unmatched: theirs' own when no record of mine (nor an
// earlier unmatched one) has it, else mintMergeId; minted after every free
// one is kept, so a minted id never takes one theirs still needs. Custom
// columns keep their c<N> shape (nextCustomId over everything taken).
function mergeAssignIds(kind, mine, theirs, match, extraTaken) {
    const map = {};
    const taken = new Set(mine.map((m) => m.id));
    (extraTaken || []).forEach((id) => taken.add(id));
    const rest = [];
    theirs.forEach((t) => {
        const p = match.pair.get(t);
        if (p) { map[t.id] = p.mine.id; return; }
        rest.push(t);
    });
    const later = [];
    rest.forEach((t) => {
        if (isTransientId(t.id) && kind !== 'columns') { later.push(t); return; }
        if (!taken.has(t.id) && !(kind === 'columns' && !CUSTOM_ID_RE.test(t.id))) { map[t.id] = t.id; taken.add(t.id); } else later.push(t);
    });
    later.forEach((t) => {
        const id = kind === 'columns' ? nextCustomId([...taken].map((x) => ({ id: x }))) : isTransientId(t.id) ? adoptedId(t.id, taken) : mintMergeId(t.id, taken);
        map[t.id] = id; taken.add(id);
    });
    return map;
}

// ---- References: theirs in the result's ids ----
const mgRef = (ctx, kind, id) => (id == null ? id : Object.prototype.hasOwnProperty.call(ctx.maps[kind] || {}, id) ? ctx.maps[kind][id] : id);
const mgColKey = (ctx, k) => (typeof k === 'string' && k.startsWith('x:') ? 'x:' + mgRef(ctx, 'columns', k.slice(2)) : k);
const mgIfaceRef = (ctx, theirsNodeId, ifaceId) => {
    const m = ctx.ifaceMaps.get(theirsNodeId);
    return ifaceId && m && Object.prototype.hasOwnProperty.call(m, ifaceId) ? m[ifaceId] : ifaceId;
};
function mergeScopeRef(ctx, check, scope) {
    const kind = MERGE_SCOPE_REFS[check];
    if (!kind || typeof scope !== 'string' || !scope) return scope;
    const i = scope.indexOf(':');
    const head = i < 0 ? scope : scope.slice(0, i), tail = i < 0 ? '' : scope.slice(i);
    return mgRef(ctx, kind, head) + tail;
}
// A deep copy of a theirs record with every id and reference it holds in
// the result's ids.
function mergeRemap(ctx, kind, rec) {
    const r = mgClone(rec);
    if (MERGE_LIST_KINDS.includes(kind)) r.id = mgRef(ctx, kind, rec.id);
    if (kind === 'nodes') {
        ['group'].forEach((k) => { if (r[k] !== undefined) r[k] = mgRef(ctx, 'groups', r[k]); });
        if (Array.isArray(r.providers)) r.providers = r.providers.map((x) => mgRef(ctx, 'providers', x));
        if (r.host !== undefined) r.host = mgRef(ctx, 'nodes', r.host);
        if (r.extra) { const e = {}; Object.keys(r.extra).forEach((c) => { e[mgRef(ctx, 'columns', c)] = r.extra[c]; }); r.extra = e; }
        (r.interfaces || []).forEach((i) => {
            i.id = mgIfaceRef(ctx, rec.id, i.id);
            if (i.bond && Array.isArray(i.bond.members)) i.bond.members = i.bond.members.map((x) => mgIfaceRef(ctx, rec.id, x));
            const radio = i.radio;
            (radio && Array.isArray(radio.bands) ? radio.bands : []).forEach((b) => { if (Array.isArray(b.ssids)) b.ssids = b.ssids.map((x) => mgRef(ctx, 'wifi', x)); });
        });
    } else if (kind === 'links') {
        r.source = mgRef(ctx, 'nodes', rec.source); r.target = mgRef(ctx, 'nodes', rec.target);
        if (r.sourceIface) r.sourceIface = mgIfaceRef(ctx, rec.source, rec.sourceIface);
        if (r.targetIface) r.targetIface = mgIfaceRef(ctx, rec.target, rec.targetIface);
        if (r.wifi && r.wifi.ssid !== undefined) r.wifi.ssid = mgRef(ctx, 'wifi', r.wifi.ssid);
        if (Array.isArray(r.providers)) r.providers = r.providers.map((x) => mgRef(ctx, 'providers', x));
    } else if (kind === 'groups') {
        if (r.parent) r.parent = mgRef(ctx, 'groups', r.parent);
        if (Array.isArray(r.providers)) r.providers = r.providers.map((x) => mgRef(ctx, 'providers', x));
    } else if (kind === 'incidents') {
        // Its visits name log entries, whose ids are global: never remapped.
        if (Array.isArray(r.nodeIds)) r.nodeIds = r.nodeIds.map((x) => mgRef(ctx, 'nodes', x));
        if (Array.isArray(r.behind)) r.behind = r.behind.map((x) => mgRef(ctx, 'nodes', x));
        if (r.groupId !== undefined) r.groupId = mgRef(ctx, 'groups', r.groupId);
        if (Array.isArray(r.routedTo)) r.routedTo = r.routedTo.map((x) => mgRef(ctx, 'providers', x));
    } else if (kind === 'wifi') {
        if (r.network !== undefined) r.network = mgRef(ctx, 'networks', r.network);
    } else if (kind === 'annotations') {
        r.targets = (r.targets || []).map((x) => (ctx.T.nodeIds.has(x) ? mgRef(ctx, 'nodes', x) : mgRef(ctx, 'annotations', x)));
    } else if (kind === 'searches') {
        if (Array.isArray(r.columns)) r.columns = r.columns.map((k) => mgColKey(ctx, k));
        if (r.sort !== undefined) r.sort = mgColKey(ctx, r.sort);
    } else if (MERGE_NOTE_KINDS.includes(kind)) {
        if (r.nodeIds) r.nodeIds = r.nodeIds.map((x) => mgRef(ctx, 'nodes', x));
        if (r.linkIds) r.linkIds = r.linkIds.map((x) => mgRef(ctx, 'links', x));
        if (r.scope !== undefined) r.scope = mergeScopeRef(ctx, r.check, r.scope);
    } else if (kind === 'tableView') {
        const d = r && r.devices;
        if (d) ['order', 'hidden'].forEach((k) => { if (Array.isArray(d[k])) d[k] = d[k].map((x) => mgColKey(ctx, x)); });
    }
    return r;
}
// A cable turned to face the way `ref` faces (its source is ref's source),
// when it was drawn the other way round.
function mergeOrient(link, ref) {
    if (!link || !ref || link.source === ref.source || link.source !== ref.target || link.target !== ref.source) return link;
    const r = Object.assign({}, link, { source: link.target, target: link.source, sourceIface: link.targetIface, targetIface: link.sourceIface });
    Object.keys(r).forEach((k) => { if (r[k] === undefined || r[k] === null) delete r[k]; });
    return r;
}
// A finding note's identity: its check, its scope and what it names.
const mergeNoteKey = (a) => [a.check, a.scope || '', [...(a.nodeIds || [])].sort().join(','), [...(a.linkIds || [])].sort().join(',')].join('|');
const mgPairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

// ---- Labels (as the item is called in the review; not translated) ----
function mergeLabel(kind, rec, names) {
    if (!rec) return '';
    switch (kind) {
    case 'nodes': return rec.name || rec.id;
    case 'links': return `${names.get(rec.source) || rec.source} — ${names.get(rec.target) || rec.target}`;
    case 'networks': return rec.name ? `${rec.cidr} (${rec.name})` : rec.cidr;
    case 'groups': return rec.name || rec.kind || rec.id;
    case 'wifi': return rec.ssid || rec.id;
    case 'providers': return rec.name || rec.service || rec.id;
    case 'incidents': return [rec.symptom, String(rec.text || '').slice(0, 60)].filter(Boolean).join(': ') || rec.id;
    case 'annotations': return String(rec.text || '').slice(0, 60) || rec.id;
    case 'searches': case 'columns': return rec.name || rec.id;
    case 'accepted': case 'pinned': return rec.check;
    case 'ifaces': return rec.name || rec.id;
    default: return kind;
    }
}

// ---- The plan ----
function planMerge(mine, theirs, base, opts = {}) {
    const M = mergeInput(mine), T = mergeInput(theirs), B = base ? mergeInput(base) : null;
    const ctx = { M, T, B, force: Object.assign({}, opts.force || {}), maps: {}, ifaceMaps: new Map(), notes: [], part: mergePartInfo(opts.part) };
    T.nodeIds = new Set(mgList(T.doc, 'nodes').map((n) => n.id));
    const matches = {};

    // Columns, providers, subnets, Wi-Fi: nothing they name is matched later.
    const simple = (kind, keyOf, byKey, idOk) => {
        const mineL = mgList(M.doc, kind);
        matches[kind] = mergeMatchKind(kind, ctx, (claimed) => {
            const pool = mineL.filter((m) => !claimed.has(m));
            return [mgIdFinder(ctx, kind, pool, M.raw[kind], T.raw[kind], idOk), mgByKey(byKey, pool, keyOf)];
        });
        ctx.maps[kind] = mergeAssignIds(kind, mineL, mgList(T.doc, kind), matches[kind]);
    };
    simple('columns', (c) => mgLower(c.name), 'name', (m, t) => mgLower(m.name) !== mgLower(t.name));
    // An id match is contradicted by another name (providers: the templates'
    // pv_isp is a different ISP in each), another SSID, another room.
    const differ = (x, y) => !!x && !!y && x !== y;
    simple('providers', (p) => mgLower(p.name || p.service), 'name', (m, t) => differ(mgLower(m.name || m.service), mgLower(t.name || t.service)));
    simple('networks', (n) => mgLower(n.cidr), 'range');
    simple('wifi', (w) => w.ssid || '', 'ssid', (m, t) => differ(m.ssid || '', t.ssid || ''));

    // Groups: by path (Building / Floor / Room / Rack: names only, so it
    // needs no ids mapped first).
    {
        const mineL = mgList(M.doc, 'groups'), theirsL = mgList(T.doc, 'groups');
        // A room renamed under its id is the same room (its name a conflict);
        // another kind, or another name somewhere else, is another group.
        const parentName = (g, list) => { const p = g.parent ? list.find((x) => x.id === g.parent) : null; return p ? mgLower(p.name) : ''; };
        matches.groups = mergeMatchKind('groups', ctx, (claimed) => {
            const pool = mineL.filter((m) => !claimed.has(m));
            const byPath = new Map();
            mergePartPool(ctx, pool).forEach((m) => { const k = placeKey(groupPath(m, mineL)); const a = byPath.get(k) || []; a.push(m); byPath.set(k, a); });
            return [mgIdFinder(ctx, 'groups', pool, M.raw.groups, T.raw.groups, (m, t) => m.kind !== t.kind
                || (differ(mgLower(m.name), mgLower(t.name)) && parentName(m, mineL) !== parentName(t, theirsL))),
                { by: 'path', find: (t) => byPath.get(placeKey(groupPath(t, theirsL))) || [], others: mergePartOther(ctx) }];
        });
        ctx.maps.groups = mergeAssignIds('groups', mineL, theirsL, matches.groups);
    }

    // Devices.
    {
        const mineL = mgList(M.doc, 'nodes'), theirsL = mgList(T.doc, 'nodes');
        matches.nodes = mergeMatchKind('nodes', ctx, (claimed) => {
            const pool = mineL.filter((m) => !claimed.has(m));
            const keyPool = mergePartPool(ctx, pool);
            const ix = csvIndex(keyPool);
            const poolById = new Map(keyPool.map((m) => [m.id, m]));
            const byIds = (ids) => (ids || []).map((id) => poolById.get(id)).filter(Boolean);
            const multi = (keys, map) => { const s = new Set(); keys.forEach((k) => (map.get(k) || []).forEach((id) => s.add(id))); return byIds([...s]); };
            const guard = (by, find) => ({ by, find: (t) => { const hits = find(t); return hits.length === 1 && mergeContradicts(hits[0], t, by) ? [] : hits; } });
            // Id, serial and MAC match another provider's new record; the
            // asset tag, the address and the name only ask (D152.2, D177).
            const others = mergePartOther(ctx);
            return [
                mgIdFinder(ctx, 'nodes', pool, M.raw.nodes, T.raw.nodes, (m, t) => mergeContradicts(m, t, 'id')),
                { by: 'assetTag', find: (t) => (isBlank(t.assetTag) ? [] : byIds(ix.byTag.get(csvLower(t.assetTag)))), others },
                { by: 'serial', find: (t) => (isBlank(t.serial) ? [] : byIds(ix.bySerial.get(csvLower(t.serial)))) },
                { by: 'mac', find: (t) => multi(mgMacs(t), ix.byMac) },
                Object.assign(guard('ip', (t) => multi(mgIps(t), ix.byIp)), { others }),
                Object.assign(guard('name', (t) => (mgName(t) ? byIds(ix.byName.get(csvLower(t.name))) : [])), { others })
            ];
        });
        ctx.maps.nodes = mergeAssignIds('nodes', mineL, theirsL, matches.nodes);
        // Interfaces, inside each pair (and the ids of an added device's).
        theirsL.forEach((t) => {
            const p = matches.nodes.pair.get(t);
            const map = {};
            if (!p) {
                const own = new Set((t.interfaces || []).map((i) => i.id).filter((id) => !isTransientId(id)));
                (t.interfaces || []).forEach((i) => { if (isTransientId(i.id)) { map[i.id] = adoptedId(i.id, own); own.add(map[i.id]); } else map[i.id] = i.id; });
                ctx.ifaceMaps.set(t.id, map); return;
            }
            const im = mergeMatchIfaces(ctx, p.mine, t, p.base || null);
            p.ifaceMatch = im;
            ctx.ifaceMaps.set(t.id, mergeAssignIds('ifaces', p.mine.interfaces || [], t.interfaces || [], im));
        });
    }

    // Cables: the devices are mapped now.
    {
        const mineL = mgList(M.doc, 'links'), theirsL = mgList(T.doc, 'links');
        const theirsPairCount = new Map();
        theirsL.forEach((t) => { const k = mgPairKey(mgRef(ctx, 'nodes', t.source), mgRef(ctx, 'nodes', t.target)); theirsPairCount.set(k, (theirsPairCount.get(k) || 0) + 1); });
        matches.links = mergeMatchKind('links', ctx, (claimed) => {
            const pool = mineL.filter((m) => !claimed.has(m));
            const byPair = new Map();
            mergePartPool(ctx, pool).forEach((m) => { const k = mgPairKey(m.source, m.target); const a = byPair.get(k) || []; a.push(m); byPair.set(k, a); });
            const ends = (t) => ({ s: mgRef(ctx, 'nodes', t.source), tg: mgRef(ctx, 'nodes', t.target),
                si: mgIfaceRef(ctx, t.source, t.sourceIface) || null, ti: mgIfaceRef(ctx, t.target, t.targetIface) || null });
            const idF = mgIdFinder(ctx, 'links', pool, M.raw.links, T.raw.links, (m, t) => {
                const e = ends(t);
                return mgPairKey(e.s, e.tg) !== mgPairKey(m.source, m.target);
            });
            const portOk = (a, b) => !a || !b || a === b;
            return [idF, { by: 'ends', others: mergePartOther(ctx), find: (t) => {
                const e = ends(t);
                const k = mgPairKey(e.s, e.tg);
                const hits = byPair.get(k) || [];
                const fit = hits.filter((m) => (m.source === e.s
                    ? portOk(m.sourceIface, e.si) && portOk(m.targetIface, e.ti)
                    : portOk(m.sourceIface, e.ti) && portOk(m.targetIface, e.si)));
                if (fit.length) return fit;
                // Replugged: the only cable between the two on each side.
                return hits.length === 1 && theirsPairCount.get(k) === 1 && mineL.filter((m) => mgPairKey(m.source, m.target) === k).length === 1 ? hits : [];
            } }];
        });
        ctx.maps.links = mergeAssignIds('links', mineL, theirsL, matches.links);
    }

    // Notes: by text and what they point at.
    {
        const mineL = mgList(M.doc, 'annotations'), theirsL = mgList(T.doc, 'annotations');
        ctx.maps.annotations = {};
        theirsL.forEach((t) => { ctx.maps.annotations[t.id] = t.id; });
        matches.annotations = mergeMatchKind('annotations', ctx, (claimed) => {
            const pool = mineL.filter((m) => !claimed.has(m));
            const keyOf = (a, remap) => mgKey({ text: a.text, targets: [...(remap ? mergeRemap(ctx, 'annotations', a).targets : a.targets || [])].sort() });
            const byKey = new Map();
            pool.forEach((m) => { const k = keyOf(m, false); const a = byKey.get(k) || []; a.push(m); byKey.set(k, a); });
            return [mgIdFinder(ctx, 'annotations', pool, M.raw.annotations, T.raw.annotations),
                { by: 'text', find: (t) => byKey.get(keyOf(t, true)) || [] }];
        });
        ctx.maps.annotations = mergeAssignIds('annotations', mineL, theirsL, matches.annotations);
    }

    // Saved searches: by name (an id match needs the same name: sq_1 is in
    // every document).
    {
        const mineL = mgList(M.doc, 'searches');
        matches.searches = mergeMatchKind('searches', ctx, (claimed) => {
            const pool = mineL.filter((m) => !claimed.has(m));
            return [mgIdFinder(ctx, 'searches', pool, M.raw.searches, T.raw.searches, (m, t) => mgLower(m.name) !== mgLower(t.name)),
                mgByKey('name', pool, (s) => mgLower(s.name))];
        });
        ctx.maps.searches = mergeAssignIds('searches', mineL, mgList(T.doc, 'searches'), matches.searches);
    }

    // Problem reports: by id alone, never contradicted (a random token, so
    // the same id is the same report wherever it travelled).
    {
        const mineL = mgList(M.doc, 'incidents');
        matches.incidents = mergeMatchKind('incidents', ctx, (claimed) => [mgIdFinder(ctx, 'incidents', mineL.filter((m) => !claimed.has(m)), M.raw.incidents, T.raw.incidents)]);
        ctx.maps.incidents = mergeAssignIds('incidents', mineL, mgList(T.doc, 'incidents'), matches.incidents);
    }

    // ---- Items ----
    const names = new Map();
    mgList(M.doc, 'nodes').forEach((n) => names.set(n.id, n.name || n.id));
    mgList(T.doc, 'nodes').forEach((n) => { const id = mgRef(ctx, 'nodes', n.id); if (!names.has(id)) names.set(id, n.name || n.id); });
    const items = [];
    const removalSig = ctx.B ? mergeRemovalSigs(ctx) : null;
    ctx.sigs = removalSig;
    MERGE_KINDS.forEach((kind) => {
        if (MERGE_LIST_KINDS.includes(kind)) items.push(...mergeListItems(ctx, kind, matches[kind], names, removalSig));
        else if (MERGE_NOTE_KINDS.includes(kind)) items.push(...mergeNoteItems(ctx, kind));
        else { const it = mergeObjectItem(ctx, kind); if (it) items.push(it); }
    });
    mergeCablesFollow(ctx, items);
    mergeUniqueKeys(ctx, items);

    // Caps: what would not fit is not added (a note says so).
    mergeIncidentCap(ctx, items);
    const caps = { providers: PROVIDER_MAX, searches: SEARCH_MAX, columns: CUSTOM_MAX };
    Object.keys(caps).forEach((kind) => {
        let room = caps[kind] - mgList(M.doc, kind).length;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.kind !== kind || it.status !== 'added') continue;
            if (room > 0) { room--; continue; }
            ctx.notes.push({ key: 'Not added: this network already has as many as it can hold.', args: { kind, label: it.label } });
            items.splice(i--, 1);
        }
    });

    mergeScopeMark(items, mergeScopeInfo(opts.scope));

    const counts = { added: 0, changed: 0, unchanged: 0, removed: 0, conflicts: 0 };
    items.forEach((it) => { if (it.status === 'conflict') counts.conflicts++; else counts[it.status]++; });
    // Where the devices both have are in theirs, for placing what is added.
    const anchors = {};
    mgList(T.doc, 'nodes').forEach((t) => { const p = matches.nodes.pair.get(t); if (p) anchors[p.mine.id] = { x: t.x, y: t.y }; });
    const theirsEdges = mgList(T.doc, 'links').map((l) => [mgRef(ctx, 'nodes', l.source), mgRef(ctx, 'nodes', l.target)])
        .concat(mgList(T.doc, 'nodes').filter((n) => n.host).map((n) => [mgRef(ctx, 'nodes', n.id), mgRef(ctx, 'nodes', n.host)]));
    const ifaces = {};
    ctx.ifaceMaps.forEach((m, tid) => { ifaces[mgRef(ctx, 'nodes', tid)] = m; });
    return {
        mode: B ? 'three-way' : 'two-way',
        mineRev: M.rev, theirsRev: T.rev, baseRev: B ? B.rev : null,
        items, counts,
        idMap: Object.assign({}, ctx.maps, { ifaces }),
        notes: ctx.notes,
        anchors, theirsEdges,
        theirsLog: T.log,
        force: ctx.force,
        part: opts.part || null,
        scope: opts.scope || null,
        inputs: { theirs: mgClone(theirs), base: base ? mgClone(base) : null }
    };
}
// A provider's visit copy from a server (docs/SCOPE.md D154): the provider
// held the whole site, so what they changed outside their own items is
// marked `outside`, and left out unless the owner applies it
// (choices[key + '@outside'] === 'apply'). scope: { name, nodes, links,
// groups, incidents, providers } (ids inside: what they cover, the reports
// routed to them, their own provider record; Sets or lists), or null.
// Inside: the devices, cables and groups they cover, and anything new they
// add of those kinds; the reports routed to them and the new ones; their own
// provider record. Outside: an existing device, cable or group they do not
// cover, another provider, and every other kind (subnets, Wi-Fi, notes,
// columns, searches, findings, the report header, the lives, the table view).
// scope.rejected: 'kind:id' of changes a rejected copy of the same provider
// made and this one still carries (js/visits.js visitRejectedKeys, D191):
// marked `rejectedBefore`, and left out unless applied, inside or not.
function mergeScopeInfo(scope) {
    if (!scope || typeof scope !== 'object') return null;
    const set = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : []));
    return { nodes: set(scope.nodes), links: set(scope.links), groups: set(scope.groups), incidents: set(scope.incidents), providers: set(scope.providers), rejected: set(scope.rejected) };
}
function mergeScopeMark(items, sc) {
    if (!sc) return;
    const has = (set, it) => set.has(it.mineId) || set.has(it.theirsId);
    items.forEach((it) => {
        if (it.status === 'unchanged') return;
        let inside;
        if (['nodes', 'links', 'groups', 'incidents'].includes(it.kind)) inside = it.status === 'added' || has(sc[it.kind], it);
        else if (it.kind === 'providers') inside = has(sc.providers, it);
        else inside = false;
        if (!inside) it.outside = true;
        if (sc.rejected.has(`${it.kind}:${it.theirsId || it.mineId}`)) { it.outside = true; it.rejectedBefore = true; }
    });
}
// A provider's part coming back (js/providerpart.js partMergeInfo, D93):
// { nodes, groups } its context (the devices and groups the provider only
// saw), known: every record id a revision of this network held. Lists or
// Sets; null when the copy is not a part.
// The mine records a part's new record may be matched with by anything but
// its id (path, name, address, ends): a provider only saw the part, so a
// record it added is never one of yours it could not see. Records a full
// revision of this network held are out (those inside the part were matched
// by id already); what you added since stays in, so the same new device
// added on both sides is still one. What another provider's copy, merged
// back since this part left, added (part.others, partMergeInfo) is in too,
// but only a strong key (serial, MAC) pairs with it: a name, an address, a
// place or an asset tag is a question whose default is Add as new
// (mergePartOther), so two providers' "AP-9"s are never one by their name
// (D152.2, D177).
function mergePartPool(ctx, pool) {
    return ctx.part ? pool.filter((m) => !ctx.part.known.has(m.id) || ctx.part.others.has(m.id)) : pool;
}
// -> a test of whether a mine record is another provider's new one, or null.
function mergePartOther(ctx) {
    return ctx.part && ctx.part.others.size ? (m) => ctx.part.others.has(m.id) : null;
}
function mergePartInfo(part) {
    if (!part || typeof part !== 'object') return null;
    const set = (v) => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : []));
    return { nodes: set(part.nodes), groups: set(part.groups), known: set(part.known), others: set(part.others) };
}
// What an ambiguous match takes with no answer: Add as new for one that may
// be another provider's new record (D152.2), else Skip.
const mergeAmbiguousDefault = (item) => (item && item.conflict && item.conflict.other ? 'add' : 'skip');

// Problem reports over the cap (INCIDENT_MAX): one of theirs that the cap
// would drop again from the result (an old closed one mine had already let
// go) is not added, quietly: it would come back and go in the same breath.
function mergeIncidentCap(ctx, items) {
    const mine = mgList(ctx.M.doc, 'incidents');
    const adds = items.filter((it) => it.kind === 'incidents' && it.status === 'added');
    if (!adds.length || mine.length + adds.length <= INCIDENT_MAX) return;
    const kept = new Set(capIncidents(mine.concat(adds.map((it) => it.theirs))));
    adds.forEach((it) => { if (!kept.has(it.theirs)) items.splice(items.indexOf(it), 1); });
}
// A cable one side removed only along with its device follows that device
// when the device is a conflict: kept, its cables stay (or come back with
// it); removed, they go with it (applyMergePlan's cascade).
function mergeCablesFollow(ctx, items) {
    const kept = new Map(), back = new Map();
    items.forEach((it) => {
        if (it.kind !== 'nodes' || !it.conflict) return;
        if (it.conflict.type === 'removed-theirs-edited-mine') kept.set(it.mineId, it.key);
        else if (it.conflict.type === 'removed-mine-edited-theirs' && it.theirs) back.set(it.theirs.id, it.key);
    });
    if (!kept.size && !back.size) return;
    const mineLinks = new Map(mgList(ctx.M.doc, 'links').map((l) => [l.id, l]));
    items.forEach((it) => {
        if (it.kind !== 'links') return;
        if (it.status === 'removed') {
            const l = mineLinks.get(it.mineId);
            const k = l && (kept.get(l.source) || kept.get(l.target));
            if (k) { it.status = 'unchanged'; it.follows = k; }
        } else if (it.status === 'unchanged' && it.gone && it.theirs) {
            const k = back.get(it.theirs.source) || back.get(it.theirs.target);
            if (k) it.follows = k;
        }
    });
}
// Names and ranges that must stay unique (a subnet's range, a saved
// search's or a custom column's name): the normalizers keep the first of
// two and drop the other. Taking theirs' new value where it would meet one
// the result already has is a conflict defaulting to mine; a record of
// theirs to add whose value one of yours has is not added (a note says so).
const MERGE_UNIQUE = {
    networks: { field: 'cidr', key: mgLower },
    searches: { field: 'name', key: mgLower },
    columns: { field: 'name', key: mgLower }
};
function mergeUniqueKeys(ctx, items) {
    Object.keys(MERGE_UNIQUE).forEach((kind) => {
        const { field, key } = MERGE_UNIQUE[kind];
        const mineById = new Map(mgList(ctx.M.doc, kind).map((r) => [r.id, r]));
        for (let round = 0; round < 50; round++) {
            const own = [];
            items.forEach((it) => {
                if (it.kind !== kind) return;
                const type = it.conflict && it.conflict.type;
                if (it.mineId && it.status !== 'removed') {
                    const f = it.fields.find((x) => x.field === field);
                    own.push({ it, f, k: key(f && f.take === 'theirs' ? f.theirs : (mineById.get(it.mineId) || {})[field]) });
                } else if (!it.mineId && (it.status === 'added' || type === 'removed-mine-edited-theirs')) {
                    own.push({ it, f: null, k: key((it.theirs || {})[field]), add: true });
                }
            });
            const seen = new Map();
            own.forEach((o) => { if (o.k) seen.set(o.k, (seen.get(o.k) || 0) + 1); });
            const clash = own.filter((o) => o.k && seen.get(o.k) > 1);
            const flip = clash.find((o) => o.f && o.f.take === 'theirs');
            if (flip) {
                Object.assign(flip.f, { take: 'mine', conflict: true, collides: true });
                flip.it.status = 'conflict';
                flip.it.conflict = { type: 'fields' };
                continue;
            }
            const extra = clash.find((o) => o.add);
            if (!extra) break;
            ctx.notes.push({ key: 'Not added: one of yours has the same name or range.', args: { kind, label: extra.it.label } });
            items.splice(items.indexOf(extra.it), 1);
        }
    });
}

const mgBlankIface = (i) => !!i && mgEmpty(i.name) && mgEmpty(i.ip) && !hasMac(i);
// Interfaces of a matched device: base by id (three-way), then id (carried
// by both, no other MAC), MAC, IP, a name only one has.
function mergeMatchIfaces(ctx, m, t, b) {
    const mine = m.interfaces || [], theirs = t.interfaces || [];
    const rawM = ctx.M.raw.ifaces.get(m.id) || new Set(), rawT = ctx.T.raw.ifaces.get(t.id) || new Set();
    const rawB = b ? ctx.B.raw.ifaces.get(b.id) || new Set() : null;
    const sub = { M: { raw: { ifaces: rawM } }, T: { raw: { ifaces: rawT } }, B: b ? { raw: { ifaces: rawB } } : null, force: {} };
    const cabled = new Set();
    mgList(ctx.M.doc, 'links').forEach((l) => {
        if (l.source === m.id && l.sourceIface) cabled.add(l.sourceIface);
        if (l.target === m.id && l.targetIface) cabled.add(l.targetIface);
    });
    return mergeMatchKind('ifaces', sub, (claimed) => {
        const pool = mine.filter((i) => !claimed.has(i));
        const ip = (i) => { const p = parseValidCIDR(i.ip); return p ? p.ip.toString() : ''; };
        const unique = (f) => ({ by: f.by, find: (x) => { const h = f.find(x); return h.length === 1 ? h : []; } });
        return [
            mgIdFinder(sub, 'ifaces', pool, rawM, rawT, (a, c) => hasMac(a) && hasMac(c) && normMac(a.mac) !== normMac(c.mac)),
            unique(mgByKey('mac', pool, (i) => (hasMac(i) ? normMac(i.mac) : ''))),
            unique(mgByKey('ip', pool, ip)),
            unique(mgByKey('name', pool, (i) => mgLower(i.name))),
            // Two-way only: an interface of theirs with no name, address or
            // MAC is the device's next interface of mine with no cable, not an
            // extra one (docs/SCOPE.md D33).
            { by: 'blank', find: (x) => {
                if (b || !mgBlankIface(x)) return [];
                const next = mine.find((i) => !claimed.has(i) && !cabled.has(i.id));
                return next ? [next] : [];
            } }
        ];
    }, { mine, theirs, base: b ? b.interfaces || [] : null, rawMine: rawM, rawTheirs: rawT, rawBase: rawB });
}

// Whether one side edited a device since the base, for the removal rules:
// its fields (not its place), its interfaces, or a cable at it that the
// side added or changed (A10). A cable the side removed is no edit: the
// other side removing the device took it too.
function mergeRemovalSigs(ctx) {
    const baseLinks = new Map(mgList(ctx.B.doc, 'links').filter((l) => ctx.B.raw.links.has(l.id)).map((l) => [l.id, l]));
    const edited = (doc, node, b) => {
        if (!node || !b) return true;
        const strip = (n) => ({ f: mergeFlat('nodes', n), i: mgSorted(n.interfaces || []) });
        if (!mgSame(strip(node), strip(b))) return true;
        return mgList(doc, 'links').some((l) => {
            if (l.source !== node.id && l.target !== node.id) return false;
            const bl = baseLinks.get(l.id);
            return !bl || !mgSame(mergeFlat('links', mergeOrient(l, bl)), mergeFlat('links', bl));
        });
    };
    // A record of another kind is edited by a side that started pointing at
    // it, or changed what it holds there (a custom column's value), since
    // the base: removing it on the other side would drop that edit.
    const refs = { mine: mergeRefSigs(ctx.M.doc), theirs: mergeRefSigs(ctx.T.doc), base: mergeRefSigs(ctx.B.doc) };
    const refsEdited = (side, kind, id, baseId) => {
        const s = refs[side][kind] && refs[side][kind].get(id);
        if (!s) return false;
        const b = refs.base[kind].get(baseId) || new Set();
        for (const e of s) if (!b.has(e)) return true;
        return false;
    };
    // An interface is edited by a side that plugged a cable into it, or
    // changed one there, since the base.
    const ifaceCabled = (side, nodeId, ifaceId) => mgList(side === 'mine' ? ctx.M.doc : ctx.T.doc, 'links').some((l) => {
        if (!((l.source === nodeId && l.sourceIface === ifaceId) || (l.target === nodeId && l.targetIface === ifaceId))) return false;
        const bl = baseLinks.get(l.id);
        return !bl || !mgSame(mergeFlat('links', mergeOrient(l, bl)), mergeFlat('links', bl));
    });
    return { mine: (m, b) => edited(ctx.M.doc, m, b), theirs: (t, b) => edited(ctx.T.doc, t, b), refsEdited, ifaceCabled };
}
// Who points at the records of the kinds that are not devices, by the id
// they name: one entry per reference ('n:<device>', 'l:<cable>',
// 'g:<group>', 'w:<Wi-Fi>', 's:<search>', 'i:<device>/<interface>'), a
// custom value with the value it holds.
function mergeRefSigs(doc) {
    const out = { groups: new Map(), columns: new Map(), providers: new Map(), wifi: new Map(), networks: new Map() };
    const put = (kind, id, entry) => {
        if (typeof id !== 'string' || !id) return;
        const s = out[kind].get(id) || new Set();
        s.add(entry);
        out[kind].set(id, s);
    };
    const colRef = (k) => (typeof k === 'string' && k.startsWith('x:') ? k.slice(2) : null);
    mgList(doc, 'nodes').forEach((n) => {
        if (n.group) put('groups', n.group, `n:${n.id}`);
        mgArr(n.providers).forEach((p) => put('providers', p, `n:${n.id}`));
        Object.keys(n.extra || {}).forEach((c) => put('columns', c, `n:${n.id}=${mgKey(n.extra[c])}`));
        (n.interfaces || []).forEach((i) => {
            const r = i.radio;
            (r && Array.isArray(r.bands) ? r.bands : []).forEach((b) => (Array.isArray(b.ssids) ? b.ssids : []).forEach((s) => put('wifi', s, `i:${n.id}/${i.id}`)));
        });
    });
    mgList(doc, 'links').forEach((l) => {
        mgArr(l.providers).forEach((p) => put('providers', p, `l:${l.id}`));
        if (l.wifi && l.wifi.ssid) put('wifi', l.wifi.ssid, `l:${l.id}`);
    });
    mgList(doc, 'groups').forEach((g) => {
        if (g.parent) put('groups', g.parent, `g:${g.id}`);
        mgArr(g.providers).forEach((p) => put('providers', p, `g:${g.id}`));
    });
    // A problem report relies on the providers it was sent to and its group.
    mgList(doc, 'incidents').forEach((x) => {
        mgArr(x.routedTo).forEach((p) => put('providers', p, `in:${x.id}`));
        if (x.groupId) put('groups', x.groupId, `in:${x.id}`);
    });
    mgList(doc, 'wifi').forEach((w) => { if (w.network) put('networks', w.network, `w:${w.id}`); });
    mgList(doc, 'searches').forEach((s) => {
        [...(Array.isArray(s.columns) ? s.columns : []), s.sort].map(colRef).filter(Boolean).forEach((c) => put('columns', c, `s:${s.id}`));
    });
    return out;
}

// One item per record of a list kind: mine's in mine's order (matched or
// not), then theirs' that are not mine's in theirs' order.
function mergeListItems(ctx, kind, match, names, sigs) {
    const mine = mgList(ctx.M.doc, kind), theirs = mgList(ctx.T.doc, kind);
    const pairOfMine = new Map();
    match.pair.forEach((p, t) => pairOfMine.set(p.mine, Object.assign({ theirs: t }, p)));
    const items = [];
    const eq = (side, rec, b) => {
        if (kind === 'nodes') return !sigs[side](rec, b);
        if (sigs.refsEdited(side, kind, rec.id, b.id)) return false;
        const r = side === 'theirs' ? mergeRemap(ctx, kind, rec) : rec;
        return mgSame(mergeFlat(kind, kind === 'links' ? mergeOrient(r, b) : r), mergeFlat(kind, b));
    };
    mine.forEach((m) => {
        const p = pairOfMine.get(m);
        if (p) { items.push(mergePairItem(ctx, kind, m, p.theirs, p.base || null, p.by, names, p.ifaceMatch)); return; }
        const b = match.baseOf.get(m);
        const item = { key: `${kind}:${m.id}`, kind, mineId: m.id, theirsId: null, label: mergeLabel(kind, m, names), matchedBy: null, fields: [], conflict: null };
        // A problem report missing from theirs was trimmed (the cap, a
        // link), never deleted: it stays (D39).
        if (kind === 'incidents') item.status = 'unchanged';
        else if (b && match.removedTheirs.has(m)) {
            // A part's context device or group, gone from theirs: the
            // provider only saw it, so the removal is asked, kept by default.
            if (ctx.part && ((kind === 'nodes' && ctx.part.nodes.has(m.id)) || (kind === 'groups' && ctx.part.groups.has(m.id)))) {
                item.status = 'conflict'; item.conflict = { type: 'removed-theirs-edited-mine' };
            } else if (eq('mine', m, b)) item.status = 'removed';
            else { item.status = 'conflict'; item.conflict = { type: 'removed-theirs-edited-mine' }; }
        } else item.status = 'unchanged';
        items.push(item);
    });
    // A part: a record only theirs holds that this network once held (an
    // older full copy the provider still had) was removed here since; it
    // does not come back, nor do its cables.
    const mineIds = ctx.part ? new Set(mgList(ctx.M.doc, 'nodes').map((n) => n.id)) : null;
    const goneHere = (t) => !!ctx.part && ['nodes', 'links', 'groups'].includes(kind) && (ctx.part.known.has(t.id)
        || (kind === 'links' && [t.source, t.target].some((id) => ctx.part.known.has(id) && !mineIds.has(id))));
    theirs.forEach((t) => {
        if (match.pair.has(t)) return;
        const r = mergeRemap(ctx, kind, t);
        const item = { key: `${kind}:${r.id}`, kind, mineId: null, theirsId: t.id, label: mergeLabel(kind, r, names), matchedBy: null, fields: [], conflict: null, theirs: r };
        const amb = match.ambiguous.get(t);
        const b = match.removedMine.get(t);
        if (amb) {
            item.status = 'conflict';
            item.conflict = { type: 'ambiguous', candidates: amb.candidates, by: amb.by };
            if (amb.taken) item.conflict.taken = true;
            if (amb.other) item.conflict.other = true;
        } else if (b && kind === 'incidents') {
            // One mine let go (the cap): not brought back.
            item.status = 'unchanged'; item.gone = true;
        } else if (b) {
            if (eq('theirs', t, b)) { item.status = 'unchanged'; item.gone = true; } else { item.status = 'conflict'; item.conflict = { type: 'removed-mine-edited-theirs' }; }
        } else if (goneHere(t)) { item.status = 'unchanged'; item.gone = true; } else item.status = 'added';
        items.push(item);
    });
    return items;
}
function mergePairItem(ctx, kind, m, t, b, by, names, ifaceMatch) {
    let r = mergeRemap(ctx, kind, t);
    if (kind === 'links') r = mergeOrient(r, m);
    const bb = kind === 'links' && b ? mergeOrient(b, m) : b;
    const fields = mergeFields(mergeFlat(kind, m), mergeFlat(kind, r), bb ? mergeFlat(kind, bb) : null, kind);
    const item = { key: `${kind}:${m.id}`, kind, mineId: m.id, theirsId: t.id, label: mergeLabel(kind, m, names), matchedBy: by, fields, conflict: null, theirs: r };
    if (kind === 'nodes') item.children = mergeIfaceItems(ctx, m, t, r, ifaceMatch);
    const kids = item.children || [];
    const open = fields.some((f) => f.conflict) || kids.some((c) => c.status === 'conflict');
    const taken = fields.some((f) => f.take === 'theirs' || f.take === 'merged') || kids.some((c) => c.status !== 'unchanged');
    if (open) { item.status = 'conflict'; item.conflict = { type: 'fields' }; } else item.status = taken ? 'changed' : 'unchanged';
    return item;
}
// A device's interfaces as child items, by the same rules one level down.
function mergeIfaceItems(ctx, m, t, r, im) {
    const mine = m.interfaces || [], out = [];
    const remapped = new Map((t.interfaces || []).map((i, k) => [i, (r.interfaces || [])[k]]));
    const pairOfMine = new Map();
    im.pair.forEach((p, ti) => pairOfMine.set(p.mine, Object.assign({ theirs: ti }, p)));
    const key = (id) => `ifaces:${m.id}/${id}`;
    mine.forEach((mi) => {
        const p = pairOfMine.get(mi);
        if (p) {
            const ri = remapped.get(p.theirs);
            const fields = mergeFields(mergeFlat('ifaces', mi), mergeFlat('ifaces', ri), p.base ? mergeFlat('ifaces', p.base) : null);
            const open = fields.some((f) => f.conflict), taken = fields.some((f) => f.take === 'theirs');
            out.push({ key: key(mi.id), kind: 'ifaces', nodeId: m.id, mineId: mi.id, theirsId: p.theirs.id, label: mergeLabel('ifaces', mi), matchedBy: p.by, fields,
                status: open ? 'conflict' : taken ? 'changed' : 'unchanged', conflict: open ? { type: 'fields' } : null, theirs: ri });
            return;
        }
        const bi = im.baseOf.get(mi);
        const item = { key: key(mi.id), kind: 'ifaces', nodeId: m.id, mineId: mi.id, theirsId: null, label: mergeLabel('ifaces', mi), matchedBy: null, fields: [], conflict: null };
        if (bi && im.removedTheirs.has(mi)) {
            if (mgSame(mi, bi) && !ctx.sigs.ifaceCabled('mine', m.id, mi.id)) item.status = 'removed';
            else { item.status = 'conflict'; item.conflict = { type: 'removed-theirs-edited-mine' }; }
        } else item.status = 'unchanged';
        out.push(item);
    });
    (t.interfaces || []).forEach((ti) => {
        if (im.pair.has(ti)) return;
        const ri = remapped.get(ti);
        const item = { key: key(ri.id), kind: 'ifaces', nodeId: m.id, mineId: null, theirsId: ti.id, label: mergeLabel('ifaces', ri), matchedBy: null, fields: [], conflict: null, theirs: ri };
        const bi = im.removedMine.get(ti);
        if (bi) {
            if (mgSame(ri, bi) && !ctx.sigs.ifaceCabled('theirs', t.id, ti.id)) { item.status = 'unchanged'; item.gone = true; }
            else { item.status = 'conflict'; item.conflict = { type: 'removed-mine-edited-theirs' }; }
        } else item.status = 'added';
        out.push(item);
    });
    return out;
}
// Accepted findings and pins: one item per key; two-way is their union.
function mergeNoteItems(ctx, kind) {
    const mine = mgList(ctx.M.doc, kind), theirs = mgList(ctx.T.doc, kind).map((a) => mergeRemap(ctx, kind, a));
    const base = ctx.B ? mgList(ctx.B.doc, kind) : null;
    const byKey = (list) => { const m = new Map(); (list || []).forEach((a) => { const k = mergeNoteKey(a); if (!m.has(k)) m.set(k, a); }); return m; };
    const tk = byKey(theirs), bk = base ? byKey(base) : null, mk = byKey(mine);
    const items = [];
    const item = (k, rec, extra) => Object.assign({ key: `${kind}:${k}`, kind, noteKey: k, label: rec.check, matchedBy: null, fields: [], conflict: null }, extra);
    mine.forEach((m) => {
        const k = mergeNoteKey(m);
        if (items.some((i) => i.noteKey === k)) return;
        const t = tk.get(k), b = bk ? bk.get(k) : null;
        if (t) {
            const fields = mergeFields(mergeFlat(kind, m), mergeFlat(kind, t), b ? mergeFlat(kind, b) : null);
            const open = fields.some((f) => f.conflict), taken = fields.some((f) => f.take === 'theirs');
            items.push(item(k, m, { mineId: k, theirsId: k, matchedBy: 'key', fields, theirs: t, status: open ? 'conflict' : taken ? 'changed' : 'unchanged', conflict: open ? { type: 'fields' } : null }));
        } else if (b) {
            const same = mgSame(mergeFlat(kind, m), mergeFlat(kind, b));
            items.push(item(k, m, { mineId: k, theirsId: null, status: same ? 'removed' : 'conflict', conflict: same ? null : { type: 'removed-theirs-edited-mine' } }));
        } else items.push(item(k, m, { mineId: k, theirsId: null, status: 'unchanged' }));
    });
    theirs.forEach((t) => {
        const k = mergeNoteKey(t);
        if (mk.has(k) || items.some((i) => i.noteKey === k)) return;
        const b = bk ? bk.get(k) : null;
        if (b) {
            const same = mgSame(mergeFlat(kind, t), mergeFlat(kind, b));
            items.push(item(k, t, { mineId: null, theirsId: k, theirs: t, status: same ? 'unchanged' : 'conflict', gone: same || undefined, conflict: same ? null : { type: 'removed-mine-edited-theirs' } }));
        } else items.push(item(k, t, { mineId: null, theirsId: k, theirs: t, status: 'added' }));
    });
    return items;
}
// The report header and the expected lives: one item, field by field. The
// table view: mine's, unless only theirs changed it (three-way).
function mergeObjectItem(ctx, kind) {
    const get = (side) => (side ? side.doc[kind] : undefined);
    const m = get(ctx.M), t = kind === 'tableView' ? mergeRemap(ctx, kind, get(ctx.T) || {}) : get(ctx.T), b = ctx.B ? get(ctx.B) : null;
    if (mgEmpty(m) && mgEmpty(t) && mgEmpty(b)) return null;      // nothing on any side: no item
    const item = { key: `${kind}:${kind}`, kind, mineId: kind, theirsId: kind, label: kind, matchedBy: 'key', fields: [], conflict: null, status: 'unchanged' };
    if (kind === 'tableView') {
        if (ctx.B && mgSame(m, b) && !mgSame(t, b)) {
            item.fields = [{ field: 'tableView', mine: mgClone(m), theirs: mgClone(t), base: mgClone(b), take: 'theirs', conflict: false }];
            item.status = 'changed';
        }
        return item;
    }
    const flat = (x) => (x && typeof x === 'object' ? Object.assign({}, x) : {});
    item.fields = mergeFields(flat(m), flat(t), ctx.B ? flat(b) : null);
    if (item.fields.some((f) => f.conflict)) { item.status = 'conflict'; item.conflict = { type: 'fields' }; } else if (item.fields.length) item.status = 'changed';
    return item;
}

// ---- Applying ----
// The choice a conflict takes: the one given, else its default.
function mergeTake(choices, key, field) {
    const c = choices[`${key}#${field.field}`];
    return field.conflict && (c === 'mine' || c === 'theirs') ? c : field.take;
}
function mergeItemChoice(choices, item) {
    const c = choices[item.key];
    const type = item.conflict && item.conflict.type;
    if (type === 'removed-theirs-edited-mine' || type === 'removed-mine-edited-theirs') return c === 'remove' ? 'remove' : 'keep';
    if (type === 'ambiguous') return typeof c === 'string' && c ? c : mergeAmbiguousDefault(item);
    return null;
}

function applyMergePlan(mine, plan, choices = {}) {
    // An ambiguous match answered with a device (or "add as new") is planned
    // again as that match: its fields then follow the rules as any match's.
    const force = Object.assign({}, plan.force || {});
    let again = false;
    plan.items.forEach((it) => {
        if (!it.conflict || it.conflict.type !== 'ambiguous') return;
        const c = mergeItemChoice(choices, it);
        const k = `${it.kind}:${it.theirsId}`;
        if (c !== 'skip' && force[k] === undefined) { force[k] = c === 'add' ? 'add' : c; again = true; }
    });
    if (again) return applyMergePlan(mine, planMerge(mine, plan.inputs.theirs, plan.inputs.base, { force, part: plan.part, scope: plan.scope }), choices);

    const M = mergeInput(mine);
    const out = mgClone(M.doc);
    MERGE_LIST_KINDS.concat(MERGE_NOTE_KINDS).forEach((k) => { if (!Array.isArray(out[k])) out[k] = []; });
    const byId = {};
    MERGE_LIST_KINDS.forEach((k) => { byId[k] = new Map(out[k].map((r) => [r.id, r])); });
    const notesByKey = {};
    MERGE_NOTE_KINDS.forEach((k) => { notesByKey[k] = new Map(out[k].map((a) => [mergeNoteKey(a), a])); });
    const added = new Set();
    const changed = new Set();
    const drop = { };
    MERGE_LIST_KINDS.concat(MERGE_NOTE_KINDS).forEach((k) => { drop[k] = new Set(); });
    const notes = plan.notes.slice();
    // Each ambiguous match answered (planned again as forced) was a conflict.
    let conflicts = Object.keys(plan.force || {}).length;

    const setFields = (kind, rec, item) => {
        let took = false;
        item.fields.forEach((f) => {
            const take = mergeTake(choices, item.key, f);
            if (take === 'theirs') { mergeSetFlat(kind, rec, f.field, f.theirs); took = true; }
            else if (take === 'merged') { mergeSetFlat(kind, rec, f.field, f.value); took = true; }
        });
        return took;
    };
    const applyChildren = (node, item) => {
        let took = false;
        const list = node.interfaces || (node.interfaces = []);
        (item.children || []).forEach((c) => {
            const ch = mergeItemChoice(choices, c);
            if (c.status === 'added' || (c.conflict && c.conflict.type === 'removed-mine-edited-theirs' && ch === 'keep')) { list.push(mgClone(c.theirs)); took = true; return; }
            if (c.status === 'removed' || (c.conflict && c.conflict.type === 'removed-theirs-edited-mine' && ch === 'remove')) {
                const i = list.findIndex((x) => x.id === c.mineId); if (i >= 0) { list.splice(i, 1); took = true; }
                return;
            }
            if (c.mineId && c.fields.length) { const rec = list.find((x) => x.id === c.mineId); if (rec && setFields('ifaces', rec, c)) took = true; }
        });
        return took;
    };

    plan.items.forEach((it) => {
        const kind = it.kind;
        const ch = mergeItemChoice(choices, it);
        // Outside what the provider covers (D154): left out unless applied.
        if (it.outside && choices[it.key + '@outside'] !== 'apply') return;
        if (it.status === 'conflict') conflicts++;
        if (kind === 'tableView') {
            if (it.fields.length && mergeTake(choices, it.key, it.fields[0]) === 'theirs') { out.tableView = mgClone(it.fields[0].theirs); changed.add(it.key); }
            return;
        }
        if (kind === 'report' || kind === 'expectedLife') {
            const rec = Object.assign({}, out[kind] || {});
            if (setFields(kind, rec, it)) { out[kind] = rec; changed.add(it.key); }
            return;
        }
        const note = MERGE_NOTE_KINDS.includes(kind);
        const insert = () => {
            if (note) { out[kind].push(mgClone(it.theirs)); notesByKey[kind].set(it.noteKey, out[kind][out[kind].length - 1]); return; }
            const rec = mgClone(it.theirs);
            out[kind].push(rec); byId[kind].set(rec.id, rec); added.add(`${kind}:${rec.id}`);
        };
        const remove = () => { drop[kind].add(note ? it.noteKey : it.mineId); };
        if (it.status === 'added') return insert();
        if (it.status === 'removed') return remove();
        if (it.conflict && it.conflict.type === 'removed-theirs-edited-mine') return ch === 'remove' ? remove() : undefined;
        if (it.conflict && it.conflict.type === 'removed-mine-edited-theirs') return ch === 'keep' ? insert() : undefined;
        if (it.conflict && it.conflict.type === 'ambiguous') {
            notes.push({ key: it.conflict.taken ? 'Skipped: the one of yours chosen for it was chosen for another too.'
                : it.conflict.other ? 'Skipped: it may be one another provider added since.'
                    : 'Skipped: it matches more than one of yours.', args: { kind, label: it.label } });
            return undefined;
        }
        // A cable mine removed only with its device comes back with it.
        if (it.gone && it.follows) {
            const dev = plan.items.find((x) => x.key === it.follows);
            if (dev && mergeItemChoice(choices, dev) === 'keep') insert();
            return undefined;
        }
        if (!it.mineId) return undefined;
        const rec = note ? notesByKey[kind].get(it.noteKey) : byId[kind].get(it.mineId);
        if (!rec) return undefined;
        let took = setFields(kind, rec, it);
        if (kind === 'nodes' && applyChildren(rec, it)) took = true;
        if (took) changed.add(it.key);
        return undefined;
    });

    MERGE_LIST_KINDS.forEach((k) => { if (drop[k].size) out[k] = out[k].filter((r) => !drop[k].has(r.id)); });
    MERGE_NOTE_KINDS.forEach((k) => { if (drop[k].size) out[k] = out[k].filter((a) => !drop[k].has(mergeNoteKey(a))); });
    // A range or name the normalizers would find twice (theirs chosen where
    // the plan said it meets another): yours stays, and nothing of yours is
    // dropped behind the counts' back.
    Object.keys(MERGE_UNIQUE).forEach((kind) => {
        const { field, key } = MERGE_UNIQUE[kind];
        const mineById = new Map(mgList(M.doc, kind).map((r) => [r.id, r]));
        const moved = (r) => { const m = mineById.get(r.id); return !!m && key(m[field]) !== key(r[field]); };
        const still = (r) => mineById.has(r.id) && !moved(r);
        const taken = new Set(out[kind].filter(still).map((r) => key(r[field])));
        out[kind] = out[kind].filter((r) => {
            if (still(r)) return true;
            const k = key(r[field]);
            if (!k || !taken.has(k)) { if (k) taken.add(k); return true; }
            if (moved(r)) {
                mergeSetFlat(kind, r, field, mineById.get(r.id)[field]);
                notes.push({ key: 'Kept yours: another one already has that name or range.', args: { kind, label: mergeLabel(kind, r, new Map()) } });
                return true;
            }
            notes.push({ key: 'Not added: one of yours has the same name or range.', args: { kind, label: mergeLabel(kind, r, new Map()) } });
            added.delete(`${kind}:${r.id}`);
            return false;
        });
    });
    // A removed device takes its cables with it (A10); one that was being
    // added says so rather than vanishing in the normalizers.
    const nodeIds = new Set(out.nodes.map((n) => n.id));
    const names = new Map(out.nodes.map((n) => [n.id, n.name || n.id]));
    out.links = out.links.filter((l) => {
        if (nodeIds.has(l.source) && nodeIds.has(l.target)) return true;
        if (added.has(`links:${l.id}`)) notes.push({ key: 'Dropped: its device was removed.', args: { kind: 'links', label: mergeLabel('links', l, names) } });
        return false;
    });

    // Positions: the devices added, placed.
    const addedNodes = new Set(out.nodes.filter((n) => added.has(`nodes:${n.id}`)).map((n) => n.id));
    placeAdded(out.nodes, addedNodes, plan.anchors || {}, plan.theirsEdges || []);
    out.log = unionLogs(M.log, plan.theirsLog || []);
    if (!out.log.length) delete out.log;
    MERGE_LIST_KINDS.concat(MERGE_NOTE_KINDS).forEach((k) => { if (!out[k].length) delete out[k]; });

    // Read back as a load reads it: the same normalizers, every reference
    // checked. What it changed is what the counts count.
    const doc = canonicalDoc(out);
    const counts = mergeCountResult(M.doc, doc, plan, changed, conflicts);
    return { doc, counts, notes };
}
// The counts as the result has them: added and removed by what is there
// and was not (and the reverse), changed by the items that took a field of
// theirs and are still there, conflicts by the conflicts met.
function mergeCountResult(before, after, plan, changed, conflicts) {
    let added = 0, removed = 0;
    MERGE_LIST_KINDS.forEach((k) => {
        const a = new Set(mgList(before, k).map((r) => r.id)), b = new Set(mgList(after, k).map((r) => r.id));
        b.forEach((id) => { if (!a.has(id)) added++; });
        a.forEach((id) => { if (!b.has(id)) removed++; });
    });
    MERGE_NOTE_KINDS.forEach((k) => {
        const a = new Set(mgList(before, k).map(mergeNoteKey)), b = new Set(mgList(after, k).map(mergeNoteKey));
        b.forEach((x) => { if (!a.has(x)) added++; });
        a.forEach((x) => { if (!b.has(x)) removed++; });
    });
    let ch = 0;
    changed.forEach((key) => {
        const [kind, ...rest] = key.split(':');
        const id = rest.join(':');
        if (!MERGE_LIST_KINDS.includes(kind) || mgList(after, kind).some((r) => r.id === id)) ch++;
    });
    void plan;
    return { added, changed: ch, removed, conflicts };
}

// ---- Positions ----
// Matched devices stay where mine has them. The added ones are placed one
// connected group at a time (cables and hosts among them), keeping theirs'
// drawing of the group, by the first rule that applies (A20):
//   1. its group: a group mine has devices in; it lands among them, so the
//      frame (a box round the members) grows round it rather than across
//      the map;
//   2. its cable: the first cable in theirs to a device mine has;
//   3. beside the map: right of everything, top edges level (besideTheMap).
// A single device is set in the nearest free place round its anchor
// (gmSetBeside's rings); a larger group is shifted by where its anchor is
// in mine against where it is in theirs, and steps right, then down, a grid
// step at a time until it is clear of every placed device. Snapped to the
// grid. Pure: `nodes` (the result's) are moved in place.
function placeAdded(nodes, addedIds, anchors, edges) {
    const adds = nodes.filter((n) => addedIds.has(n.id));
    if (!adds.length) return;
    const snap = (v) => Math.round((Number(v) || 0) / GRID_SNAP) * GRID_SNAP;
    const placed = nodes.filter((n) => !addedIds.has(n.id));
    if (!placed.length) { adds.forEach((n) => { n.x = snap(n.x); n.y = snap(n.y); }); return; }
    const side = typeof GM_SIDE === 'object' ? GM_SIDE : { X: 100, Y: 110, CLEAR_X: 90, CLEAR_Y: 100 };
    const rings = typeof GM_SIDE_RINGS === 'number' ? GM_SIDE_RINGS : 6;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Connected groups of added devices, in the order they come.
    const root = new Map(adds.map((n) => [n.id, n.id]));
    const find = (x) => { while (root.get(x) !== x) x = root.get(x); return x; };
    edges.forEach(([a, b]) => { if (root.has(a) && root.has(b)) { const ra = find(a), rb = find(b); if (ra !== rb) root.set(rb, ra); } });
    const comps = [];
    const compOf = new Map();
    adds.forEach((n) => { const r = find(n.id); if (!compOf.has(r)) { compOf.set(r, []); comps.push(compOf.get(r)); } compOf.get(r).push(n); });
    const clear = (x, y, others) => others.every((o) => Math.abs(o.x - x) >= side.CLEAR_X || Math.abs(o.y - y) >= side.CLEAR_Y);
    const compClear = (comp, dx, dy) => comp.every((n) => clear(snap(n.x + dx), snap(n.y + dy), placed));
    const beside = (comp) => {
        const right = Math.max(...placed.map((n) => n.x)), top = Math.min(...placed.map((n) => n.y));
        const minX = Math.min(...comp.map((n) => n.x)), minY = Math.min(...comp.map((n) => n.y));
        return { dx: right + MERGE_BESIDE_GAP - minX, dy: top - minY };
    };
    const ring = (host, comp) => {
        const tie = (i, j) => (i > 0 && j === 0 ? 0 : j > 0 ? 1 : i < 0 ? 2 : 3);
        const spots = [];
        for (let i = -rings; i <= rings; i++) for (let j = -rings; j <= rings; j++) if (i || j) spots.push({ i, j, d: Math.hypot(i, j) });
        spots.sort((a, b) => a.d - b.d || tie(a.i, a.j) - tie(b.i, b.j));
        const others = placed.slice();
        const at = [];
        let k = 0;
        for (const n of comp) {
            let spot = null;
            while (k < spots.length && !spot) {
                const x = snap(host.x + spots[k].i * side.X), y = snap(host.y + spots[k].j * side.Y);
                k++;
                if (clear(x, y, others)) spot = { x, y };
            }
            if (!spot) return false;          // the rings are full: beside the map instead
            at.push(spot); others.push(spot);
        }
        comp.forEach((n, i) => { n.x = at[i].x; n.y = at[i].y; });
        return true;
    };
    comps.forEach((comp) => {
        const ids = new Set(comp.map((n) => n.id));
        let anchor = null;
        // 1. Its group.
        for (const n of comp) {
            if (!n.group) continue;
            const member = placed.find((p) => p.group === n.group);
            if (member) { anchor = member; break; }
        }
        // 2. Its cable (or the device it runs on).
        if (!anchor) {
            for (const [a, b] of edges) {
                const other = ids.has(a) && !ids.has(b) ? b : ids.has(b) && !ids.has(a) ? a : null;
                const o = other && !addedIds.has(other) ? byId.get(other) : null;
                if (o) { anchor = o; break; }
            }
        }
        let done = false;
        if (anchor && (comp.length === 1 || !anchors[anchor.id])) done = ring(anchor, comp);
        else if (anchor) {
            const dx = anchor.x - anchors[anchor.id].x, dy = anchor.y - anchors[anchor.id].y;
            let step = null;
            if (compClear(comp, dx, dy)) step = { dx, dy };
            for (let k = 1; !step && k <= MERGE_STEP_MAX; k++) if (compClear(comp, dx + GRID_SNAP * k, dy)) step = { dx: dx + GRID_SNAP * k, dy };
            for (let k = 1; !step && k <= MERGE_STEP_MAX; k++) if (compClear(comp, dx, dy + GRID_SNAP * k)) step = { dx, dy: dy + GRID_SNAP * k };
            if (step) { comp.forEach((n) => { n.x = snap(n.x + step.dx); n.y = snap(n.y + step.dy); }); done = true; }
        }
        if (!done) {
            const s = beside(comp);
            comp.forEach((n) => { n.x = snap(n.x + s.dx); n.y = snap(n.y + s.dy); });
        }
        placed.push(...comp);
    });
}

// ---- What the findings would do ----
// Open findings now against those the merged network would have, as the
// paste and bulk previews say it (findingsDelta, js/table.js).
function mergeFindingsDelta(mine, result) {
    const findings = (doc) => withDoc(doc, () => withLookupPass(() => topologyFindings()));
    return findingsDelta(findings(mine), findings(result));
}

// ---- The network log ----
// Union by entry id: mine's in their order, then theirs' that mine has not
// in theirs' order, the newest LOG_MAX kept. An entry brought in from theirs
// loses its prev: it is chained again in this document (appendLogEntry).
function unionLogs(mineLog, theirsLog) {
    const out = normalizeLog(mineLog, Infinity);
    const ids = new Set(out.map((e) => e.id));
    normalizeLog(theirsLog, Infinity).forEach((e) => {
        if (ids.has(e.id)) return;
        ids.add(e.id);
        const c = Object.assign({}, e);
        delete c.prev;
        out.push(c);
    });
    return out.length > LOG_MAX ? out.slice(out.length - LOG_MAX) : out;
}
// The merge's own entry. id and at come from the caller (the clock and the
// random token are not the engine's), so a suite's entry is the same each run.
function mergeLogEntry({ id, at, source, by, counts, mode, rev }) {
    const c = counts || {};
    const n = (k) => (Number.isInteger(c[k]) && c[k] >= 0 ? c[k] : 0);
    const summary = `Merged ${source || 'a copy'}: ${n('added')} added, ${n('changed')} changed, ${n('removed')} removed, ${n('conflicts')} ${n('conflicts') === 1 ? 'conflict' : 'conflicts'}.`;
    return normalizeLogEntry({ id, at, kind: 'merge', source, by, counts: c, summary, mode, rev });
}
// SHA-256 of the entry before, as 64 hex, or null when there is no Web
// Crypto (or it does not answer within a second): the entry then goes
// without prev. setDigest gives the suites a digest of their own.
let _mergeDigest = null;
function setMergeDigest(fn) { const was = _mergeDigest; _mergeDigest = typeof fn === 'function' ? fn : null; return was; }
const mergeEntryText = (e) => mgKey(e);
async function mergeDigest(text) {
    if (_mergeDigest) return _mergeDigest(text);
    if (!(window.crypto && crypto.subtle)) return null;
    try {
        const timeout = new Promise((r) => setTimeout(() => r(null), 1000));
        const buf = await Promise.race([crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)), timeout]);
        return buf ? Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('') : null;
    } catch (e) {
        return null;
    }
}
// Every entry after the first that has no prev gets one. The first entry
// present starts the chain: its prev may name one trimmed away (A21).
async function chainLog(log) {
    const out = log.map((e) => Object.assign({}, e));
    for (let i = 1; i < out.length; i++) {
        if (out[i].prev) continue;
        const d = await mergeDigest(mergeEntryText(out[i - 1]));
        if (d && LOG_HASH_RE.test(d)) out[i].prev = d;
    }
    return out;
}
// A copy of `doc` with `entry` last in its log (union already made by
// applyMergePlan), chained, the newest LOG_MAX kept.
async function appendLogEntry(doc, entry) {
    const e = normalizeLogEntry(entry);
    if (!e) throw new Error('not a log entry');
    const log = normalizeLog(doc && doc.log, Infinity).filter((x) => x.id !== e.id).concat([e]);
    const kept = log.length > LOG_MAX ? log.slice(log.length - LOG_MAX) : log;
    return Object.assign({}, doc, { log: await chainLog(kept) });
}
// The index of the first entry whose prev does not match the entry before
// it (edited outside Topo), or -1. Entries without prev are not checked,
// nor is the first (A21); nor is anything when there is no digest.
async function verifyLog(log) {
    const list = Array.isArray(log) ? log : [];
    for (let i = 1; i < list.length; i++) {
        if (!list[i] || !list[i].prev) continue;
        const d = await mergeDigest(mergeEntryText(list[i - 1]));
        if (d && d !== list[i].prev) return i;
    }
    return -1;
}

window.TopoMerge = {
    planMerge, applyMergePlan, mergeFindingsDelta, placeAdded, mintMergeId, MergeRefused,
    unionLogs, mergeLogEntry, appendLogEntry, verifyLog, chainLog, setDigest: setMergeDigest, digest: mergeDigest,
    MERGE_KINDS, MERGE_STATUSES
};
