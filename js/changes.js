// ---- Changes since the last back-up ----
// "What changed since I last handed this over?" is the question a register is
// asked most often after "what is there?". A log of every edit written into
// the document would answer it, but a document travels: in every share link,
// every binder link and every file, carrying the names of who changed what,
// and a history the recipient was never meant to read. So the edits are not
// written into the document. Instead, at each back-up or report of a kept
// network, a copy of the document as it was is kept beside its card — one per
// card, the latest replacing the one before — and the changes are the
// difference between that copy and the card now, matched by id.
//
// The network log (doc.log, document v17, js/model.js "Network log") is the
// one exception, decided for the merge (docs/SCOPE.md section 3): it records
// only what came from outside (a merge: from which file or link, how many
// changes, the prepared-by name in Settings), not each edit, and it does
// travel with the document, so whoever receives a copy can see it.
// docChanges and docChangeParts leave it out.
//
// The copy is the baseline, nothing more. It is never in serializeDoc(), a
// card, the binder file or a link of either (they are built from the cards,
// and the copy is not in a card), so the history stays in this browser. What
// it produces goes to two places only: the card on the landing ("3 changes
// since the back-up", with the list a click away) and a section of the report,
// which is the document whose job is to say what was done.
//
// Where it is kept: IndexedDB, a database of its own (the library's schema
// stays as it is), one record per card id. Without IndexedDB the copies live
// for this tab only. The library's fallback is the single localStorage blob,
// about 5 MB for every card there is, and a second copy of each network would
// spend half of it on something that only ever answers a question; filling the
// quota with baselines would make the networks themselves fail to save.
//
// A baseline lost (storage refused, site data cleared) is not data lost: the
// card stops saying how much changed until the next back-up or report, and
// nothing else is affected. So a refused write is not the storage banner's
// business; the banner is for the networks.

const SNAPSHOT_DB = 'nettopo_snapshots';
const SNAPSHOT_STORE = 'snapshots';
const SNAPSHOT_KINDS = ['backup', 'report'];
const SNAPSHOT_OPEN_MS = 1000;

// card id -> { at, kind, doc }: the baseline as this tab holds it. Read
// synchronously (a card render, a report), written behind to the adapter.
const _snapshots = new Map();
let _snapAdapter = null;        // null: this tab only
let _snapChannel = null;        // other tabs' baselines

// A record read back from disk, or from another tab, is outside input like a
// file: an unusable one is skipped, never trusted into a diff.
function validSnapshot(rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (!Number.isFinite(rec.at) || !SNAPSHOT_KINDS.includes(rec.kind)) return null;
    if (!rec.doc || typeof rec.doc !== 'object' || !Array.isArray(rec.doc.nodes)) return null;
    return { at: rec.at, kind: rec.kind, doc: rec.doc };
}

// The IndexedDB store. Every call resolves rather than rejects, as the
// library's does: a baseline that cannot be stored is a missing line on a
// card, never a broken button.
function idbSnapshotAdapter() {
    let db = null;
    const request = (fn) => new Promise((resolve) => { try { fn(resolve); } catch (e) { resolve(null); } });
    const read = (ids) => request((resolve) => {
        if (!db) { resolve(null); return; }
        const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
        const store = tx.objectStore(SNAPSHOT_STORE);
        const out = {};
        if (ids) ids.forEach((id) => { const g = store.get(id); g.onsuccess = () => { out[id] = g.result === undefined ? null : g.result; }; });
        else {
            const keys = store.getAllKeys();
            const vals = store.getAll();
            tx.oncomplete = () => { keys.result.forEach((k, i) => { out[k] = vals.result[i]; }); resolve(out); };
        }
        if (ids) tx.oncomplete = () => resolve(out);
        tx.onerror = tx.onabort = () => resolve(null);
    });
    const write = (fn) => request((resolve) => {
        if (!db) { resolve(false); return; }
        const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
        fn(tx.objectStore(SNAPSHOT_STORE));
    }).then((ok) => ok === true);
    return {
        // -> { id: record } of every baseline, or null when IndexedDB cannot be used here.
        readAll() {
            return request((resolve) => {
                const req = indexedDB.open(SNAPSHOT_DB, 1);
                req.onupgradeneeded = () => { try { req.result.createObjectStore(SNAPSHOT_STORE); } catch (e) { /* already there */ } };
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

// Boot, once the library is open: what the disk holds comes into memory, and
// the landing redraws if it is up. Not awaited by boot: a card without its
// line for a moment is better than a page held up for it. A baseline taken in
// this tab before the store answered is newer than the disk's, and is written.
// `adapter` and `ms` are for the suites; boot passes neither.
function openSnapshotStore(adapter, ms = SNAPSHOT_OPEN_MS) {
    if (adapter === undefined) adapter = typeof indexedDB !== 'undefined' && indexedDB ? idbSnapshotAdapter() : null;
    if (!adapter) { _snapAdapter = null; return Promise.resolve('tab'); }
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ms));
    const opened = Promise.resolve().then(() => adapter.readAll()).catch(() => null);
    // Past the deadline the answer is still taken: only the wait is cut short.
    opened.then((disk) => { if (disk) adoptSnapshotStore(adapter, disk); });
    return Promise.race([opened, timeout]).then((disk) => (disk ? 'idb' : 'tab'));
}

function adoptSnapshotStore(adapter, disk) {
    const owed = [];
    Object.keys(disk).forEach((id) => {
        const rec = validSnapshot(disk[id]);
        if (!rec) return;
        const mine = _snapshots.get(id);
        if (mine && mine.at >= rec.at) { owed.push(id); return; }
        _snapshots.set(id, rec);
    });
    _snapshots.forEach((rec, id) => { if (!Object.prototype.hasOwnProperty.call(disk, id)) owed.push(id); });
    _snapAdapter = adapter;
    owed.forEach((id) => writeSnapshot(id));
    // A card deleted while this store was not listening (another tab, an old
    // build) leaves its baseline behind. Only pruned when the library itself
    // is on IndexedDB: on its fallback, a card missing from this tab's view
    // may still be on the disk this tab could not open.
    if (typeof libraryStoreKind === 'function' && libraryStoreKind() === 'idb') {
        const gone = [..._snapshots.keys()].filter((id) => !libraryEntry(id));
        if (gone.length) { gone.forEach((id) => _snapshots.delete(id)); Promise.resolve(adapter.del(gone)).catch(() => false); }
    }
    listenForSnapshots();
    _changesMemo.clear();
    changesStoreChanged();
}

// Back to this tab only. For the suites, which hand the page back as they found it.
function releaseSnapshotStore() {
    if (_snapChannel) { try { _snapChannel.close(); } catch (e) { /* closed */ } }
    _snapChannel = null; _snapAdapter = null;
}

function writeSnapshot(id) {
    const adapter = _snapAdapter;
    if (!adapter) return Promise.resolve(false);
    const rec = _snapshots.get(id);
    const pending = rec ? adapter.put(id, rec) : adapter.del([id]);
    return Promise.resolve(pending).catch(() => false).then((ok) => {
        if (!ok) console.warn('Topo: could not store the baseline for', id);
        else if (_snapChannel) { try { _snapChannel.postMessage({ ids: [id] }); } catch (e) { /* closed */ } }
        return ok;
    });
}

// Another tab took a baseline (or dropped one): read those ids from the disk.
// Nothing leaves the browser: a BroadcastChannel reaches only this origin's tabs.
function listenForSnapshots() {
    if (_snapChannel) { try { _snapChannel.close(); } catch (e) { /* closed */ } }
    _snapChannel = null;
    if (typeof BroadcastChannel !== 'function') return;
    try { _snapChannel = new BroadcastChannel(SNAPSHOT_DB); } catch (e) { return; }
    const adapter = _snapAdapter;
    _snapChannel.onmessage = (event) => {
        const ids = Array.isArray((event.data || {}).ids) ? event.data.ids.filter((id) => typeof id === 'string') : [];
        if (!ids.length) return;
        Promise.resolve(adapter.read(ids)).then((fresh) => {
            if (!fresh || adapter !== _snapAdapter) return;
            ids.forEach((id) => {
                const rec = validSnapshot(fresh[id]);
                if (rec) _snapshots.set(id, rec); else _snapshots.delete(id);
            });
            changesStoreChanged();
        }).catch(() => { /* the next message, or the next visit, catches up */ });
    };
}

function changesStoreChanged() {
    if (typeof landingIsOpen === 'function' && landingIsOpen()) renderLanding();
}

// The baseline for a card, or null. A copy: a caller changing it must not
// change the next caller's.
function snapshotOf(id) {
    const rec = id ? _snapshots.get(id) : null;
    return rec ? { at: rec.at, kind: rec.kind, doc: cloneData(rec.doc) } : null;
}

// A back-up or a report of card `id`, holding `doc` (as it went out). The
// document's travelling identity is not part of it: the card holds that.
function takeSnapshot(id, kind, doc) {
    if (!id || !SNAPSHOT_KINDS.includes(kind) || !doc || !Array.isArray(doc.nodes)) return false;
    let copy;
    try { copy = stripIdentity(cloneData(doc)); } catch (e) { return false; }
    const prev = _snapshots.get(id);
    // Strictly later, as a card's `updated` is: two in one millisecond must still be ordered.
    const now = Date.now();
    _snapshots.set(id, { at: prev && prev.at >= now ? prev.at + 1 : now, kind, doc: copy });
    writeSnapshot(id);
    // The same moment notes each device's addresses, switch port, group and
    // name in the card's trail (js/trail.js), so every back-up and report
    // caller records with no call of its own.
    if (typeof recordPoint === 'function') recordPoint(id, kind, doc);
    return true;
}

// The card is gone, so is its baseline: a deleted network's old copy has no
// business staying in the browser.
function dropSnapshot(id) {
    if (!id || !_snapshots.delete(id)) return false;
    writeSnapshot(id);
    return true;
}

// ---- The difference ----
// Both sides go through this build's serializer first (canonicalDoc), so a
// baseline written by an older build is migrated before it is compared, and a
// default filled in on load is not anybody's change. Matched by id, never by
// position or name: a device renamed is one device changed, not one removed
// and one added.
//
// -> { devices: { added, removed, changed, moved }, cables: { added, removed, changed },
//      subnets: { added, removed, changed }, groups: { added, removed, changed },
//      wifi: { added, removed, changed }, providers, columns, searches (each
//      { added, removed, changed }), expectedLife: [types], tableView: bool,
//      notes: { added, removed, changed }, accepted: { added, reopened },
//      pinned: { added, removed }, header: [labels], other: [{ key, id }], total }
// Every list holds { id, name, ... }; `changed` adds what changed, as field
// labels from the schema (js/model.js), the one list every other view reads,
// and `unlisted` (only when there is one) for what changed outside it.
//
// Complete by construction: every part docChangeCount counts (js/library.js
// docChangePartsOf: each top-level key of the document, per item for a list
// of ids) is said here. A kind says it in its own words; a field outside a
// kind's list is named as "changed: <field>" rather than left out; and a part
// that no kind said at all (an order of pins, a key a later build adds) is
// one row under `other`. Only the report's date is exempt, on purpose (below).
const DIFF_SKIP = new Set(['id', 'x', 'y', 'interfaces', 'cable']);
const sameValue = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const changedLabels = (fields, a, b) => fields.filter((f) => !DIFF_SKIP.has(f.key) && !sameValue(a[f.key], b[f.key])).map((f) => f.label);
// The keys of a record that differ, by the field's label where the list has
// one, else by the key as written. `ignore` are keys said elsewhere.
const differingKeys = (fields, a, b, ignore) => [...new Set(Object.keys(a || {}).concat(Object.keys(b || {})))]
    .filter((k) => !ignore.has(k) && !sameValue((a || {})[k], (b || {})[k]))
    .map((k) => { const f = fields.find((x) => x.key === k); return f && f.label ? f.label : k; });
// What a changed item says outside its kind's list: keys no field names (a
// later build's field, a hand-written key that survived), and, when nothing
// else was said about it, every key that differs, so a changed item always
// says something.
function unlistedOf(fields, a, b, said, ignore = new Set()) {
    const listed = new Set(fields.map((f) => f.key));
    const out = differingKeys(fields, a, b, new Set([...DIFF_SKIP, ...listed, ...ignore]));
    return out.length || said ? out : differingKeys(fields, a, b, new Set(['id', ...ignore]));
}
const setUnlisted = (c, list) => { if (list.length) c.unlisted = list; };

// The custom columns have no field list of their own in the schema (an id,
// a name and a kind); this is it, for the diff.
const CUSTOM_COLUMN_DIFF_FIELDS = [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'kind', label: 'Kind' }];
// Nor do the problem reports (v18, js/model.js "Problem reports"): their
// fields, as the merge review names them.
const INCIDENT_DIFF_FIELDS = [{ key: 'id', label: 'ID' }, { key: 'at', label: 'Reported on' }, { key: 'status', label: 'Status' }, { key: 'reopened', label: 'Status' },
    { key: 'symptom', label: 'Problem' }, { key: 'nodeIds', label: 'Devices' }, { key: 'groupId', label: 'Group' }, { key: 'text', label: 'What happened' },
    { key: 'reporter', label: 'Reported by' }, { key: 'routedTo', label: 'Sent to' }, { key: 'sentAt', label: 'Sent' }, { key: 'visits', label: 'Visits' },
    { key: 'closedAt', label: 'Closed' }, { key: 'closedNote', label: 'Closed' }];
// A problem report as a row names it: its symptom and the start of its words.
// The symptom by its label (translated, js/routing.js), never its key.
const incidentChangeName = (x) => [x.symptom && typeof symptomLabel === 'function' ? symptomLabel(x.symptom) : x.symptom, String(x.text || '').slice(0, 60)].filter(Boolean).join(': ') || x.id;

function customChanges(old, now, cur, base) {
    const a = old.extra || {}, b = now.extra || {};
    const name = (id) => { const c = (cur.columns || []).find((x) => x.id === id) || (base.columns || []).find((x) => x.id === id); return c ? c.name : id; };
    return [...new Set(Object.keys(a).concat(Object.keys(b)))].filter((id) => !sameValue(a[id], b[id])).map(name);
}

function docChanges(baseDoc, curDoc) {
    const base = canonicalDoc(baseDoc), cur = canonicalDoc(curDoc);
    const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
    const pair = (a, b, describe) => {
        const was = byId(a), now = byId(b);
        const out = { added: [], removed: [], changed: [] };
        now.forEach((x, id) => {
            const old = was.get(id);
            if (!old) out.added.push(describe(x, cur));
            else if (!sameValue(old, x)) out.changed.push({ ...describe(x, cur), old, now: x });
        });
        was.forEach((x, id) => { if (!now.has(id)) out.removed.push(describe(x, base)); });
        return out;
    };
    // A changed item's fields from its kind's list, a rename said as one
    // (named by `nameOf`, 'Name' then left out of the fields), and anything
    // else under `unlisted`. For the kinds with nothing more to them.
    const simple = (g, fields, nameOf) => {
        g.changed.forEach((c) => {
            const { old, now } = c;
            delete c.old; delete c.now;
            c.fields = changedLabels(fields, old, now);
            if (nameOf && nameOf(old) !== nameOf(now)) { c.fields = c.fields.filter((l) => l !== 'Name'); c.renamedFrom = nameOf(old); }
            setUnlisted(c, unlistedOf(fields, old, now, c.fields.length || c.renamedFrom !== undefined));
        });
        return g;
    };

    // Devices: what a moved-only device did is said once for all of them
    // (a Tidy moves every one), never as forty "changed" lines.
    const devices = pair(base.nodes, cur.nodes, (n) => ({ id: n.id, name: n.name, type: n.type }));
    devices.moved = [];
    const nodeFields = NODE_FIELDS.filter((f) => f.key !== 'extra');
    devices.changed = devices.changed.filter((c) => {
        const { old, now } = c;
        delete c.old; delete c.now;
        // The network's own columns by their names, not as one "Custom
        // columns": a name from the document as it is, else as it was.
        c.fields = changedLabels(nodeFields, old, now).concat(customChanges(old, now, cur, base));
        if (old.name !== now.name) { c.fields = c.fields.filter((l) => l !== 'Name'); c.renamedFrom = old.name; }
        c.interfaces = interfaceChanges(old.interfaces, now.interfaces);
        const said = c.fields.length || c.renamedFrom !== undefined || c.interfaces.length;
        // Moved only when only the place on the map differs: anything else
        // (interfaces reordered, a key no field names) is said as itself.
        setUnlisted(c, unlistedOf(nodeFields, old, now, said, new Set(['x', 'y', 'extra'])));
        if (said || c.unlisted) return true;
        devices.moved.push({ id: c.id, name: c.name, type: c.type });
        return false;
    });

    // A cable is named by its two ends as they are (or were, when it is gone).
    const nodeName = (doc, id) => { const n = (doc.nodes || []).find((x) => x.id === id); return n ? n.name : id; };
    const cables = pair(base.links, cur.links, (l, doc) => ({
        id: l.id, name: `${nodeName(doc, l.source)} ↔ ${nodeName(doc, l.target)}`, label: (l.cable && l.cable.label) || ''
    }));
    cables.changed.forEach((c) => {
        const { old, now } = c;
        delete c.old; delete c.now;
        const ca = old.cable || {}, cb = now.cable || {};
        c.fields = changedLabels(LINK_FIELDS, old, now).concat(changedLabels(CABLE_FIELDS, ca, cb));
        // Keys outside both lists; when nothing was said, every key that differs.
        const outside = unlistedOf(LINK_FIELDS, old, now, true).concat(unlistedOf(CABLE_FIELDS, ca, cb, true));
        setUnlisted(c, c.fields.length || outside.length ? outside
            : unlistedOf(LINK_FIELDS, old, now, false, new Set(['cable'])).concat(sameValue(ca, cb) ? [] : unlistedOf(CABLE_FIELDS, ca, cb, false)));
    });

    const subnets = simple(pair(base.networks, cur.networks, (n) => ({ id: n.id, name: n.name ? `${n.cidr} · ${n.name}` : n.cidr })), NETWORK_FIELDS);

    // Wi-Fi networks by their SSID, as a subnet is by its CIDR: adding a
    // guest network or opening one up is a change to the register like any
    // other (the radios and links that name it are counted on their own).
    const wifi = simple(pair(base.wifi, cur.wifi, (w) => ({ id: w.id, name: w.ssid || w.id })), WIFI_FIELDS);

    // Groups by their path as it is (or was): a restructure in the Groups tab
    // is a change to the register even when no device field moved. A rename
    // is said as one, like a device's; a new parent reads as "Inside", the
    // word the Groups tab uses for it. A name set to what the group was
    // already called by default (its kind's name), or cleared back to it,
    // reads as the same label, so it is said as its Name field.
    const groups = pair(base.groups, cur.groups, (g, doc) => ({ id: g.id, name: groupPath(g, doc.groups || []) }));
    groups.changed.forEach((c) => {
        const { old, now } = c;
        delete c.old; delete c.now;
        c.fields = changedLabels(GROUP_FIELDS, old, now).filter((l) => l !== 'Name').map((l) => (l === 'Parent' ? 'Inside' : l));
        if (groupLabel(old) !== groupLabel(now)) c.renamedFrom = groupLabel(old);
        else if ((old.name || '') !== (now.name || '')) c.fields.unshift('Name');
        setUnlisted(c, unlistedOf(GROUP_FIELDS, old, now, c.fields.length || c.renamedFrom !== undefined));
    });

    // The providers, the custom columns and the saved searches, as the
    // others: by name, a rename said as one. A saved search is part of the
    // register, not only a view: the ones marked to print are a section of
    // the site report, and every one travels in the file.
    const providers = simple(pair(base.providers, cur.providers, (p) => ({ id: p.id, name: p.name || p.id })), PROVIDER_FIELDS, (p) => p.name || p.id);
    const columns = simple(pair(base.columns, cur.columns, (c) => ({ id: c.id, name: c.name })), CUSTOM_COLUMN_DIFF_FIELDS, (c) => c.name);
    const searches = simple(pair(base.searches, cur.searches, (s) => ({ id: s.id, name: s.name || s.id })), SEARCH_FIELDS, (s) => s.name || s.id);
    // The problem reports (v18): reported, sent, visited, closed.
    const incidents = simple(pair(base.incidents, cur.incidents, (x) => ({ id: x.id, name: incidentChangeName(x) })), INCIDENT_DIFF_FIELDS);
    incidents.changed.forEach((c) => { c.fields = [...new Set(c.fields)]; });

    // The expected lives by type: the types whose years differ (set, changed
    // or cleared back to Topo's usual), said in one row.
    const lifeWas = base.expectedLife || {}, lifeNow = cur.expectedLife || {};
    const expectedLife = [...new Set(Object.keys(lifeWas).concat(Object.keys(lifeNow)))].filter((k) => !sameValue(lifeWas[k], lifeNow[k]));
    // The Devices table's arrangement (order, hidden columns): one row.
    const tableView = !sameValue(base.tableView, cur.tableView);

    // Text notes are counted, not listed: their text is the whole of them.
    const notes = pair(base.annotations, cur.annotations, (a) => ({ id: a.id }));
    notes.changed.forEach((c) => { delete c.old; delete c.now; });

    // An accepted finding is the check and what it was accepted on, until
    // when; a pin the check and what it was pinned on, with what to look at.
    // A new reason or date reads as one reopened and one accepted, as a new
    // note on a pin reads as one unpinned and one pinned.
    const noteKey = (a, extra) => JSON.stringify([a.check, a.scope || '', [...(a.nodeIds || [])].sort(), [...(a.linkIds || [])].sort(), ...extra.map((k) => a[k])]);
    const notesDiff = (was, now, extra) => {
        const a = new Set((was || []).map((x) => noteKey(x, extra))), b = new Set((now || []).map((x) => noteKey(x, extra)));
        return { added: [...b].filter((k) => !a.has(k)).length, removed: [...a].filter((k) => !b.has(k)).length };
    };
    const acc = notesDiff(base.accepted, cur.accepted, ['reason', 'until']);
    const accepted = { added: acc.added, reopened: acc.removed };
    const pinned = notesDiff(base.pinned, cur.pinned, ['note']);

    // The report header by field name, never by value: the values (who
    // signed it) are printed on the report already, and are not history.
    // Except the date: it is when a report was issued, not something about
    // the network, and the report dialog seeds today's into an empty header
    // and stores it (normalizeReportMeta, commitReportMeta). Counting it made
    // the first report after a back-up say the header changed when nobody
    // had touched it, and the card counted it as soon as the dialog opened.
    const hWas = base.report || {}, hNow = cur.report || {};
    const header = REPORT_FIELDS.filter(({ key }) => key !== 'date' && (hWas[key] || '') !== (hNow[key] || '')).map(({ label }) => label);

    const out = { devices, cables, subnets, wifi, groups, providers, columns, searches, incidents, expectedLife, tableView, notes, accepted, pinned, header };
    out.other = unsaidParts(base, cur, out);

    const count = (g) => g.added.length + g.removed.length + g.changed.length;
    out.total = count(devices) + devices.moved.length + count(cables) + count(subnets) + count(wifi) + count(groups)
        + count(providers) + count(columns) + count(searches) + count(incidents) + (expectedLife.length ? 1 : 0) + (tableView ? 1 : 0) + count(notes)
        + accepted.added + accepted.reopened + pinned.added + pinned.removed + (header.length ? 1 : 0) + out.other.length;
    return out;
}

// The kind that says each top-level key, and the word for it when a part of
// it is said under `other`.
const CHANGE_KINDS = {
    nodes: { kind: 'devices', what: 'Device' }, links: { kind: 'cables', what: 'Cable' }, networks: { kind: 'subnets', what: 'Subnet' },
    groups: { kind: 'groups', what: 'Group' }, wifi: { kind: 'wifi', what: 'Wi-Fi network' }, providers: { kind: 'providers', what: 'Provider' },
    columns: { kind: 'columns', what: 'Custom column' }, searches: { kind: 'searches', what: 'Saved search' }, incidents: { kind: 'incidents', what: 'Problem report' },
    annotations: { kind: 'notes', what: 'Text notes' }, accepted: { what: 'Accepted findings' }, pinned: { what: 'Pinned findings' },
    expectedLife: { what: 'Expected life by type' }, tableView: { what: 'Table layout' }, report: { what: 'Report header' }
};
// The parts docChangeCount counts that no kind said: [{ key, id }] (id only
// for an item of a list). The report's date alone is no change (above).
function unsaidParts(base, cur, ch) {
    if (typeof docChangePartsOf !== 'function') return [];
    const ids = (g) => new Set([...g.added, ...g.removed, ...g.changed, ...(g.moved || [])].map((x) => x.id));
    const saidIds = {};
    Object.keys(CHANGE_KINDS).forEach((key) => { const k = CHANGE_KINDS[key].kind; if (k) saidIds[key] = ids(ch[k]); });
    const saidWhole = {
        accepted: ch.accepted.added + ch.accepted.reopened > 0, pinned: ch.pinned.added + ch.pinned.removed > 0,
        expectedLife: ch.expectedLife.length > 0, tableView: ch.tableView, report: ch.header.length > 0
    };
    const dateless = (r) => { const x = Object.assign({}, r || {}); delete x.date; return x; };
    const out = [];
    docChangePartsOf(base, cur).forEach((part) => {
        const cut = part.indexOf(':');
        const key = cut < 0 ? part : part.slice(0, cut), id = cut < 0 ? '' : part.slice(cut + 1);
        if (id && saidIds[key]) { if (!saidIds[key].has(id) && !saidIds[key].has(Number(id))) out.push({ key, id }); return; }
        if (saidIds[key]) { if (!saidIds[key].size) out.push({ key }); return; }
        if (key === 'report' && sameValue(dateless(base.report), dateless(cur.report))) return;
        if (!saidWhole[key]) out.push(id ? { key, id } : { key });
    });
    return out;
}

// A device's interfaces, matched by id: added, removed, or what changed on one.
function interfaceChanges(was = [], now = []) {
    const old = new Map(was.map((i) => [i.id, i]));
    const out = [];
    const seen = new Set();
    now.forEach((i) => {
        seen.add(i.id);
        const o = old.get(i.id);
        if (!o) out.push({ name: i.name, added: true });
        else if (!sameValue(o, i)) {
            const fields = changedLabels(IFACE_FIELDS, o, i);
            const item = { name: i.name, fields };
            setUnlisted(item, unlistedOf(IFACE_FIELDS, o, i, fields.length > 0));
            out.push(item);
        }
    });
    was.forEach((i) => { if (!seen.has(i.id)) out.push({ name: i.name, removed: true }); });
    return out;
}

// The changes as rows, in reading order, for the card's list and the report's
// table alike: { op, what, name, detail }, op and what already in words.
// The sentences around them are translated; a field's own label is the
// schema's, which t() translates where the report already does (Gateway, DNS,
// MAC…) and otherwise leaves as the technical term it is.
function changeRows(ch) {
    const rows = [];
    const labels = (list) => list.map((l) => t(l)).join(', ');
    const unlisted = (x) => (x.unlisted && x.unlisted.length ? [t('changed: {field}', { field: labels(x.unlisted) })] : []);
    // A changed item's detail: renamed, its fields, then what was outside them.
    const detailOf = (x, more = []) => {
        const parts = [];
        if (x.renamedFrom !== undefined) parts.push(t('renamed from {name}', { name: x.renamedFrom }));
        if (x.fields && x.fields.length) parts.push(labels(x.fields));
        return parts.concat(more, unlisted(x)).join('; ');
    };
    const typeOf = (x) => (x.type ? t(typeName(x.type)) : '');
    ch.devices.added.forEach((d) => rows.push({ op: t('Added'), what: t('Device'), name: d.name, detail: typeOf(d) }));
    ch.devices.removed.forEach((d) => rows.push({ op: t('Removed'), what: t('Device'), name: d.name, detail: typeOf(d) }));
    ch.devices.changed.forEach((d) => {
        const ifaces = d.interfaces.map((i) => (i.added ? t('{name} added', { name: i.name })
            : i.removed ? t('{name} removed', { name: i.name })
                : `${i.name}: ${[labels(i.fields)].concat(unlisted(i)).filter(Boolean).join(', ')}`));
        rows.push({ op: t('Changed'), what: t('Device'), name: d.name, detail: detailOf(d, ifaces) });
    });
    if (ch.devices.moved.length) {
        rows.push({ op: t('Moved'), what: t(ch.devices.moved.length === 1 ? '{n} device' : '{n} devices', { n: ch.devices.moved.length }),
            name: '', detail: t('On the map only, nothing else changed.') });
    }
    const cableName = (c) => (c.label ? `${c.name} (${c.label})` : c.name);
    ch.cables.added.forEach((c) => rows.push({ op: t('Added'), what: t('Cable'), name: cableName(c), detail: '' }));
    ch.cables.removed.forEach((c) => rows.push({ op: t('Removed'), what: t('Cable'), name: cableName(c), detail: '' }));
    ch.cables.changed.forEach((c) => rows.push({ op: t('Changed'), what: t('Cable'), name: cableName(c), detail: detailOf(c) }));
    // Older callers' change sets (a test's, a cached one) have only some kinds.
    const empty = { added: [], removed: [], changed: [] };
    const listed = (g, what) => {
        (g || empty).added.forEach((x) => rows.push({ op: t('Added'), what: t(what), name: x.name, detail: '' }));
        (g || empty).removed.forEach((x) => rows.push({ op: t('Removed'), what: t(what), name: x.name, detail: '' }));
        (g || empty).changed.forEach((x) => rows.push({ op: t('Changed'), what: t(what), name: x.name, detail: detailOf(x) }));
    };
    listed(ch.subnets, 'Subnet');
    listed(ch.wifi, 'Wi-Fi network');
    listed(ch.groups, 'Group');
    listed(ch.providers, 'Provider');
    listed(ch.columns, 'Custom column');
    listed(ch.searches, 'Saved search');
    listed(ch.incidents, 'Problem report');
    if (ch.expectedLife && ch.expectedLife.length) {
        rows.push({ op: t('Changed'), what: t('Expected life by type'), name: '', detail: ch.expectedLife.map((k) => t(typeName(k))).join(', ') });
    }
    if (ch.tableView) rows.push({ op: t('Changed'), what: t('Table layout'), name: '', detail: '' });
    const n = ch.notes;
    if (n.added.length + n.removed.length + n.changed.length) {
        rows.push({ op: t('Changed'), what: t('Text notes'), name: '',
            detail: t('{added} added, {removed} removed, {changed} edited', { added: n.added.length, removed: n.removed.length, changed: n.changed.length }) });
    }
    if (ch.accepted.added + ch.accepted.reopened) {
        rows.push({ op: t('Changed'), what: t('Accepted findings'), name: '',
            detail: t('{added} accepted, {reopened} reopened', ch.accepted) });
    }
    if (ch.pinned && ch.pinned.added + ch.pinned.removed) {
        rows.push({ op: t('Changed'), what: t('Pinned findings'), name: '',
            detail: t('{added} pinned, {removed} unpinned', ch.pinned) });
    }
    if (ch.header.length) rows.push({ op: t('Changed'), what: t('Report header'), name: '', detail: labels(ch.header) });
    // What no kind said: by the key's word, and the item's id when it is one.
    (ch.other || []).forEach((o) => {
        const k = CHANGE_KINDS[o.key];
        rows.push({ op: t('Changed'), what: k ? t(k.what) : o.key, name: o.id || '', detail: '' });
    });
    return rows;
}

// The local calendar date of a timestamp, as the report prints its own date.
function localDateOf(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Compared with the back-up of 2026-10-12." — the baseline named by what it
// was, since a report is a baseline too.
const baselineSentence = (snap) => t(snap.kind === 'report' ? 'Compared with the report of {date}.' : 'Compared with the back-up of {date}.', { date: localDateOf(snap.at) });

// ---- A card's changes ----
// Asked on every landing render for every card, and a diff serializes both
// documents, so it is remembered by what it depends on: the card's version
// and the baseline's. An edited card or a new baseline is a new key.
const _changesMemo = new Map();
const CHANGES_MEMO_MAX = 64;

// entry (a library card) -> { snap, changes } or null when it has no baseline
// (never backed up or reported here) or cannot be compared.
function cardChanges(entry) {
    if (!entry || !entry.id || !entry.doc) return null;
    const rec = _snapshots.get(entry.id);
    if (!rec) return null;
    const key = `${entry.id}|${entry.updated || 0}|${rec.at}`;
    if (_changesMemo.has(key)) return _changesMemo.get(key);
    let out = null;
    try { out = { snap: { at: rec.at, kind: rec.kind }, changes: docChanges(rec.doc, entry.doc) }; }
    catch (e) { out = null; }   // a document too broken to serialize: no line, rather than a wrong one
    if (_changesMemo.size >= CHANGES_MEMO_MAX) _changesMemo.delete(_changesMemo.keys().next().value);
    _changesMemo.set(key, out);
    return out;
}

// What the card says. Silent at zero, like the back-up line under the cards:
// a line that is there when there is nothing to do trains people to skip it.
function cardChangesText(cc) {
    if (!cc || !cc.changes.total) return '';
    const n = cc.changes.total;
    if (cc.snap.kind === 'report') return t(n === 1 ? '{n} change since the last report' : '{n} changes since the last report', { n });
    return t(n === 1 ? '{n} change since the last back-up' : '{n} changes since the last back-up', { n });
}

// The list behind the card's line, in the page's own dialog.
function showCardChanges(entry) {
    const cc = cardChanges(entry);
    if (!cc) return Promise.resolve();
    const rows = changeRows(cc.changes);
    const LIMIT = 40;
    const lines = rows.slice(0, LIMIT).map((r) => `${r.op} · ${r.what}${r.name ? ` ${r.name}` : ''}${r.detail ? ` — ${r.detail}` : ''}`);
    if (rows.length > LIMIT) lines.push(t('…and {n} more.', { n: rows.length - LIMIT }));
    return tell(`${baselineSentence(cc.snap)}\n\n${lines.join('\n')}`, { title: entry.name });
}

// ---- In the report ----
// The open network (or a binder's site) against its baseline, for the
// report's section: null when it is not kept or has no baseline, and then the
// report has no section at all, byte for byte the report it was.
function reportChanges(id, doc) {
    const rec = id ? _snapshots.get(id) : null;
    if (!rec || !doc) return null;
    try {
        const changes = docChanges(rec.doc, doc);
        return { at: rec.at, kind: rec.kind, total: changes.total, rows: changeRows(changes) };
    } catch (e) { return null; }
}

function changesSection(ch) {
    const lead = `<p class="muted">${escapeHtml(baselineSentence(ch))}</p>`;
    if (!ch.rows.length) return `${lead}<p>${escapeHtml(t('Nothing has changed since then.'))}</p>`;
    const rows = ch.rows.map((r) => `<tr>
        <td>${escapeHtml(r.op)}</td>
        <td><span class="muted">${escapeHtml(r.what)}</span>${r.name ? ` <b>${escapeHtml(r.name)}</b>` : ''}</td>
        <td>${escapeHtml(r.detail) || '<span class="muted">—</span>'}</td>
    </tr>`).join('');
    return `${lead}<table class="changes">
        <thead><tr><th>${escapeHtml(t('Change'))}</th><th>${escapeHtml(t('Item'))}</th><th>${escapeHtml(t('Detail'))}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// Published for tests/suites/changes.js.
window.CarinoChanges = { SNAPSHOT_DB, SNAPSHOT_STORE, idbSnapshotAdapter, openSnapshotStore, releaseSnapshotStore, snapshotOf, takeSnapshot, dropSnapshot,
    docChanges, changeRows, cardChanges, cardChangesText, showCardChanges, reportChanges, changesSection, localDateOf };
