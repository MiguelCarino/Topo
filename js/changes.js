// ---- Changes since the last back-up ----
// "What changed since I last handed this over?" is the question a register is
// asked most often after "what is there?". A change log written into the
// document (the draft's doc.log) would answer it, but a document travels: in
// every share link, every binder link and every file, carrying the names of
// who changed what, and a history the recipient was never meant to read. So
// nothing is written into the document. Instead, at each back-up or report of
// a kept network, a copy of the document as it was is kept beside its card —
// one per card, the latest replacing the one before — and the changes are the
// difference between that copy and the card now, matched by id.
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
//      subnets: { added, removed, changed }, notes: { added, removed, changed },
//      accepted: { added, reopened }, header: [labels], total }
// Every list holds { id, name, ... }; `changed` adds what changed, as field
// labels from the schema (js/model.js), the one list every other view reads.
const DIFF_SKIP = new Set(['id', 'x', 'y', 'interfaces', 'cable']);
const sameValue = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const changedLabels = (fields, a, b) => fields.filter((f) => !DIFF_SKIP.has(f.key) && !sameValue(a[f.key], b[f.key])).map((f) => f.label);

function docChanges(baseDoc, curDoc) {
    const base = canonicalDoc(baseDoc), cur = canonicalDoc(curDoc);
    const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
    const pair = (a, b, describe) => {
        const was = byId(a), now = byId(b);
        const out = { added: [], removed: [], changed: [] };
        now.forEach((x, id) => {
            const old = was.get(id);
            if (!old) out.added.push(describe(x, cur));
            else if (!sameValue(old, x)) out.changed.push({ ...describe(x, cur), old });
        });
        was.forEach((x, id) => { if (!now.has(id)) out.removed.push(describe(x, base)); });
        return out;
    };

    // Devices: what a moved-only device did is said once for all of them
    // (a Tidy moves every one), never as forty "changed" lines.
    const devices = pair(base.nodes, cur.nodes, (n) => ({ id: n.id, name: n.name, type: n.type }));
    const nodesNow = byId(cur.nodes);
    devices.moved = [];
    devices.changed = devices.changed.filter((c) => {
        const old = c.old, now = nodesNow.get(c.id);
        delete c.old;
        c.fields = changedLabels(NODE_FIELDS, old, now);
        if (old.name !== now.name) { c.fields = c.fields.filter((l) => l !== 'Name'); c.renamedFrom = old.name; }
        c.interfaces = interfaceChanges(old.interfaces, now.interfaces);
        if (c.fields.length || c.renamedFrom !== undefined || c.interfaces.length) return true;
        devices.moved.push({ id: c.id, name: c.name, type: c.type });
        return false;
    });

    // A cable is named by its two ends as they are (or were, when it is gone).
    const nodeName = (doc, id) => { const n = (doc.nodes || []).find((x) => x.id === id); return n ? n.name : id; };
    const cables = pair(base.links, cur.links, (l, doc) => ({
        id: l.id, name: `${nodeName(doc, l.source)} ↔ ${nodeName(doc, l.target)}`, label: (l.cable && l.cable.label) || ''
    }));
    const linksNow = byId(cur.links);
    cables.changed.forEach((c) => {
        const old = c.old, now = linksNow.get(c.id);
        delete c.old;
        c.fields = changedLabels(LINK_FIELDS, old, now).concat(changedLabels(CABLE_FIELDS, old.cable || {}, now.cable || {}));
    });
    cables.changed = cables.changed.filter((c) => c.fields.length);

    const subnets = pair(base.networks, cur.networks, (n) => ({ id: n.id, name: n.name ? `${n.cidr} · ${n.name}` : n.cidr }));
    const netsNow = byId(cur.networks);
    subnets.changed.forEach((c) => {
        const old = c.old;
        delete c.old;
        c.fields = changedLabels(NETWORK_FIELDS, old, netsNow.get(c.id));
    });
    subnets.changed = subnets.changed.filter((c) => c.fields.length);

    // Text notes are counted, not listed: their text is the whole of them.
    const notes = pair(base.annotations, cur.annotations, (a) => ({ id: a.id }));

    // An accepted finding is the check and what it was accepted on.
    const acceptKey = (a) => JSON.stringify([a.check, [...(a.nodeIds || [])].sort(), [...(a.linkIds || [])].sort(), a.reason]);
    const accWas = new Set((base.accepted || []).map(acceptKey)), accNow = new Set((cur.accepted || []).map(acceptKey));
    const accepted = { added: [...accNow].filter((k) => !accWas.has(k)).length, reopened: [...accWas].filter((k) => !accNow.has(k)).length };

    // The report header by field name, never by value: the values (who
    // signed it) are printed on the report already, and are not history.
    // Except the date: it is when a report was issued, not something about
    // the network, and the report dialog seeds today's into an empty header
    // and stores it (normalizeReportMeta, commitReportMeta). Counting it made
    // the first report after a back-up say the header changed when nobody
    // had touched it, and the card counted it as soon as the dialog opened.
    const hWas = base.report || {}, hNow = cur.report || {};
    const header = REPORT_FIELDS.filter(({ key }) => key !== 'date' && (hWas[key] || '') !== (hNow[key] || '')).map(({ label }) => label);

    const count = (g) => g.added.length + g.removed.length + g.changed.length;
    const total = count(devices) + devices.moved.length + count(cables) + count(subnets) + count(notes)
        + accepted.added + accepted.reopened + (header.length ? 1 : 0);
    return { devices, cables, subnets, notes, accepted, header, total };
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
        else {
            const fields = changedLabels(IFACE_FIELDS, o, i);
            if (fields.length) out.push({ name: i.name, fields });
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
    const typeOf = (x) => (x.type ? t(typeName(x.type)) : '');
    ch.devices.added.forEach((d) => rows.push({ op: t('Added'), what: t('Device'), name: d.name, detail: typeOf(d) }));
    ch.devices.removed.forEach((d) => rows.push({ op: t('Removed'), what: t('Device'), name: d.name, detail: typeOf(d) }));
    ch.devices.changed.forEach((d) => {
        const parts = [];
        if (d.renamedFrom !== undefined) parts.push(t('renamed from {name}', { name: d.renamedFrom }));
        if (d.fields.length) parts.push(labels(d.fields));
        d.interfaces.forEach((i) => parts.push(i.added ? t('{name} added', { name: i.name })
            : i.removed ? t('{name} removed', { name: i.name })
                : `${i.name}: ${labels(i.fields)}`));
        rows.push({ op: t('Changed'), what: t('Device'), name: d.name, detail: parts.join('; ') });
    });
    if (ch.devices.moved.length) {
        rows.push({ op: t('Moved'), what: t(ch.devices.moved.length === 1 ? '{n} device' : '{n} devices', { n: ch.devices.moved.length }),
            name: '', detail: t('On the map only, nothing else changed.') });
    }
    const cableName = (c) => (c.label ? `${c.name} (${c.label})` : c.name);
    ch.cables.added.forEach((c) => rows.push({ op: t('Added'), what: t('Cable'), name: cableName(c), detail: '' }));
    ch.cables.removed.forEach((c) => rows.push({ op: t('Removed'), what: t('Cable'), name: cableName(c), detail: '' }));
    ch.cables.changed.forEach((c) => rows.push({ op: t('Changed'), what: t('Cable'), name: cableName(c), detail: labels(c.fields) }));
    ch.subnets.added.forEach((s) => rows.push({ op: t('Added'), what: t('Subnet'), name: s.name, detail: '' }));
    ch.subnets.removed.forEach((s) => rows.push({ op: t('Removed'), what: t('Subnet'), name: s.name, detail: '' }));
    ch.subnets.changed.forEach((s) => rows.push({ op: t('Changed'), what: t('Subnet'), name: s.name, detail: labels(s.fields) }));
    const n = ch.notes;
    if (n.added.length + n.removed.length + n.changed.length) {
        rows.push({ op: t('Changed'), what: t('Text notes'), name: '',
            detail: t('{added} added, {removed} removed, {changed} edited', { added: n.added.length, removed: n.removed.length, changed: n.changed.length }) });
    }
    if (ch.accepted.added + ch.accepted.reopened) {
        rows.push({ op: t('Changed'), what: t('Accepted findings'), name: '',
            detail: t('{added} accepted, {reopened} reopened', ch.accepted) });
    }
    if (ch.header.length) rows.push({ op: t('Changed'), what: t('Report header'), name: '', detail: labels(ch.header) });
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
