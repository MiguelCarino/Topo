// ---- Restore points ----
// Before anything replaces or changes a kept network from outside (a file
// opened onto its card, a binder that updates it, a link kept over it, a sheet
// applied to it), the card as it was is kept here: a restore point. A
// network's card lists them (Restore points), and each can be put back or
// downloaded as a back-up. Undo cannot do this: it does not survive a reload,
// and opening a file starts a new undo timeline.
//
// Like the baselines (js/changes.js) and the address history (js/trail.js),
// a restore point is never in serializeDoc(), a card, a binder or a link: it
// stays in this browser. Kept in a database of its own, so restore points can
// never take the space the networks themselves need, and capped: at most
// RESTORE_LIMITS.perCard per card and RESTORE_LIMITS.totalBytes across all
// cards, the oldest dropped first (the newest one is always kept).
//
// Two object stores, one record each per point: 'points' holds what the list
// shows ({ id, cardId, at, reason, fileName?, bytes, devices, name, updated })
// with an index on cardId, and 'docs' holds { id, doc }, the card's whole
// stored document before the change. The list is read at boot; a document
// only when it is restored or downloaded, so fifty megabytes of old copies
// are never held in a tab's memory. Without IndexedDB (or until a write is
// confirmed) the document is held in this tab.
//
// Unlike a baseline, a restore point that cannot be stored matters: the
// change it was taken for cannot be taken back. So writes report whether
// they reached the disk, and keepRestorePoints() asks before going ahead
// when one did not: download a back-up first, continue without, or cancel.
//
// The reason is kept as its English key ('Before opening {file}') with the
// file name beside it, and translated when shown, so a point taken in one
// language reads in the next.

const RESTORE_DB = 'nettopo_restore';
const RESTORE_STORE = 'points';
const RESTORE_DOCS = 'docs';
const RESTORE_OPEN_MS = 1000;
// Mutable for the suites (CarinoRestore.RESTORE_LIMITS); nothing else changes them.
const RESTORE_LIMITS = { perCard: 20, totalBytes: 50 * 1024 * 1024, writeMs: 4000 };
const RESTORE_REASONS = ['Before opening {file}', 'Before opening a file', 'Before importing {file}', 'Before importing a binder',
    'Before importing pasted rows', 'Before updating from a link', 'Before restoring'];

// card id -> [meta], oldest first: what this tab knows of the points.
const _restore = new Map();
// point id -> doc, for points not (yet) confirmed on disk.
const _restoreDocs = new Map();
let _restoreAdapter = null;     // null: this tab only
let _restoreChannel = null;     // other tabs' points
let _restoreOpening = null;     // the boot open, while it runs (cut short at RESTORE_OPEN_MS)
let _restoreAdopting = null;    // the boot open's adoption itself, however long it takes
// Point ids a keepRestorePoints() call has taken and is still waiting on: the
// caps never drop them, so one card of a batch cannot push out another's.
const _restoreHeld = new Set();
let _restoreSeq = 0;

function restoreBytes(doc) {
    try { return new Blob([JSON.stringify(doc)]).size; } catch (e) { return 0; }
}

// A record read back from disk or from another tab is outside input: an
// unusable one is skipped.
function validRestoreMeta(rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (typeof rec.id !== 'string' || !rec.id || typeof rec.cardId !== 'string' || !rec.cardId) return null;
    if (!Number.isFinite(rec.at) || typeof rec.reason !== 'string') return null;
    const out = {
        id: rec.id, cardId: rec.cardId, at: rec.at, reason: rec.reason.slice(0, 200),
        bytes: Number.isFinite(rec.bytes) && rec.bytes >= 0 ? rec.bytes : 0,
        devices: Number.isFinite(rec.devices) && rec.devices >= 0 ? rec.devices : 0,
        name: typeof rec.name === 'string' ? rec.name.slice(0, 200) : '',
        updated: Number.isFinite(rec.updated) ? rec.updated : 0
    };
    if (typeof rec.fileName === 'string' && rec.fileName) out.fileName = rec.fileName.slice(0, 200);
    return out;
}
const validRestoreDoc = (doc) => (doc && typeof doc === 'object' && Array.isArray(doc.nodes) ? doc : null);

// The IndexedDB store. Every call resolves, never rejects.
function idbRestoreAdapter() {
    let db = null;
    const request = (fn) => new Promise((resolve) => { try { fn(resolve); } catch (e) { resolve(null); } });
    return {
        // -> [meta] of every point, or null when IndexedDB cannot be used here.
        open() {
            return request((resolve) => {
                const req = indexedDB.open(RESTORE_DB, 1);
                req.onupgradeneeded = () => {
                    try {
                        const s = req.result.createObjectStore(RESTORE_STORE, { keyPath: 'id' });
                        s.createIndex('cardId', 'cardId');
                        req.result.createObjectStore(RESTORE_DOCS, { keyPath: 'id' });
                    } catch (e) { /* already there */ }
                };
                req.onerror = req.onblocked = () => resolve(null);
                req.onsuccess = () => {
                    db = req.result;
                    db.onversionchange = () => { try { db.close(); } catch (e) { /* closed */ } db = null; };
                    const tx = db.transaction(RESTORE_STORE, 'readonly');
                    const all = tx.objectStore(RESTORE_STORE).getAll();
                    tx.oncomplete = () => resolve(all.result || []);
                    tx.onerror = tx.onabort = () => resolve(null);
                };
            });
        },
        // -> { cardId: [meta] } for those cards, or null.
        readCards(cardIds) {
            return request((resolve) => {
                if (!db) { resolve(null); return; }
                const tx = db.transaction(RESTORE_STORE, 'readonly');
                const idx = tx.objectStore(RESTORE_STORE).index('cardId');
                const out = {};
                cardIds.forEach((id) => { const g = idx.getAll(id); g.onsuccess = () => { out[id] = g.result || []; }; });
                tx.oncomplete = () => resolve(out);
                tx.onerror = tx.onabort = () => resolve(null);
            });
        },
        // -> the document of one point, or null.
        readDoc(id) {
            return request((resolve) => {
                if (!db) { resolve(null); return; }
                const tx = db.transaction(RESTORE_DOCS, 'readonly');
                const g = tx.objectStore(RESTORE_DOCS).get(id);
                tx.oncomplete = () => resolve(g.result ? g.result.doc : null);
                tx.onerror = tx.onabort = () => resolve(null);
            });
        },
        // put: [{ meta, doc }], del: [point id]. One transaction. -> true when it committed.
        write(ops) {
            return request((resolve) => {
                if (!db) { resolve(false); return; }
                const tx = db.transaction([RESTORE_STORE, RESTORE_DOCS], 'readwrite');
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => resolve(false);
                const metas = tx.objectStore(RESTORE_STORE), docs = tx.objectStore(RESTORE_DOCS);
                (ops.put || []).forEach((p) => { metas.put(p.meta); docs.put({ id: p.meta.id, doc: p.doc }); });
                (ops.del || []).forEach((id) => { metas.delete(id); docs.delete(id); });
            }).then((ok) => ok === true);
        },
        // Every point of a card on disk, with its document, whoever wrote it
        // (another tab's too, before this one heard of it). -> true when it committed.
        dropCard(cardId) {
            return request((resolve) => {
                if (!db) { resolve(false); return; }
                const tx = db.transaction([RESTORE_STORE, RESTORE_DOCS], 'readwrite');
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => resolve(false);
                const metas = tx.objectStore(RESTORE_STORE), docs = tx.objectStore(RESTORE_DOCS);
                const keys = metas.index('cardId').getAllKeys(cardId);
                keys.onsuccess = () => (keys.result || []).forEach((id) => { metas.delete(id); docs.delete(id); });
            }).then((ok) => ok === true);
        }
    };
}

// Boot, once the library is open. Not awaited by boot; a point taken before
// the disk answered waits for it (restorePointStored). `adapter` and `ms` are
// for the suites.
function openRestoreStore(adapter, ms = RESTORE_OPEN_MS) {
    if (adapter === undefined) adapter = typeof indexedDB !== 'undefined' && indexedDB ? idbRestoreAdapter() : null;
    if (!adapter) { _restoreAdapter = null; _restoreOpening = null; _restoreAdopting = null; return Promise.resolve('tab'); }
    const seq = ++_restoreSeq;
    // This tab only until the disk is adopted: nothing goes to a store
    // opened before (the suites switch stores).
    _restoreAdapter = null;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ms));
    const opened = Promise.resolve().then(() => adapter.open()).catch(() => null);
    // Past the deadline the answer is still taken: only the wait is cut short.
    const adopted = opened.then((disk) => (disk && seq === _restoreSeq ? adoptRestoreStore(adapter, disk) : null));
    const done = Promise.race([adopted.then(() => true), timeout]);
    _restoreOpening = done;
    _restoreAdopting = adopted;
    done.then(() => { if (_restoreOpening === done) _restoreOpening = null; });
    adopted.then(() => { if (_restoreAdopting === adopted) _restoreAdopting = null; });
    return Promise.race([opened, timeout]).then((disk) => (disk ? 'idb' : 'tab'));
}

// The disk's points join this tab's; the ones only this tab holds are
// written; the caps apply to the whole; a card that is gone loses its points.
function adoptRestoreStore(adapter, disk) {
    const onDisk = new Set();
    (Array.isArray(disk) ? disk : []).forEach((rec) => {
        const meta = validRestoreMeta(rec);
        if (!meta) return;
        onDisk.add(meta.id);
        const list = _restore.get(meta.cardId) || [];
        if (!list.some((m) => m.id === meta.id)) list.push(meta);
        _restore.set(meta.cardId, list);
    });
    _restore.forEach((list) => list.sort((a, b) => a.at - b.at));
    _restoreAdapter = adapter;
    const del = enforceRestoreCaps(null);
    if (typeof libraryStoreKind === 'function' && libraryStoreKind() === 'idb') {
        [..._restore.keys()].filter((id) => !libraryEntry(id)).forEach((id) => {
            _restore.get(id).forEach((m) => { del.push(m.id); _restoreDocs.delete(m.id); });
            _restore.delete(id);
        });
    }
    const put = [];
    _restore.forEach((list) => list.forEach((m) => { if (!onDisk.has(m.id) && _restoreDocs.has(m.id)) put.push(m.id); }));
    listenForRestorePoints();
    restoreStoreChanged();
    const dels = del.filter((id) => onDisk.has(id));
    return put.length || dels.length ? writeRestorePoints(put, dels) : Promise.resolve(true);
}

// Back to this tab only. For the suites, which hand the page back as they found it.
function releaseRestoreStore() {
    if (_restoreChannel) { try { _restoreChannel.close(); } catch (e) { /* closed */ } }
    _restoreChannel = null; _restoreAdapter = null; _restoreOpening = null; _restoreAdopting = null; _restoreSeq++;
}

// Drops the oldest points past the caps, never `keepId` nor a point a
// keepRestorePoints() call is still waiting on. -> the dropped ids.
function enforceRestoreCaps(keepId) {
    const kept = (id) => id === keepId || _restoreHeld.has(id);
    const dropped = [];
    const drop = (list, i) => { const [m] = list.splice(i, 1); dropped.push(m.id); _restoreDocs.delete(m.id); };
    _restore.forEach((list, cardId) => {
        while (list.length > RESTORE_LIMITS.perCard) {
            const i = list.findIndex((m) => !kept(m.id));
            if (i < 0) break;
            drop(list, i);
        }
        if (!list.length) _restore.delete(cardId);
    });
    let total = 0;
    _restore.forEach((list) => list.forEach((m) => { total += m.bytes; }));
    while (total > RESTORE_LIMITS.totalBytes) {
        let oldest = null;
        _restore.forEach((list) => list.forEach((m, i) => {
            if (!kept(m.id) && (!oldest || m.at < oldest.m.at)) oldest = { m, list, i };
        }));
        if (!oldest) break;
        total -= oldest.m.bytes;
        drop(oldest.list, oldest.i);
        if (!oldest.list.length) _restore.delete(oldest.m.cardId);
    }
    return dropped;
}

function restoreMetaById(id) {
    for (const list of _restore.values()) { const m = list.find((x) => x.id === id); if (m) return m; }
    return null;
}

// -> a promise of whether every put reached the disk (false with no store,
// a refused write, or no answer in RESTORE_LIMITS.writeMs).
function writeRestorePoints(putIds, delIds) {
    const adapter = _restoreAdapter;
    if (!adapter) return Promise.resolve(false);
    const put = putIds.map((id) => ({ meta: restoreMetaById(id), doc: _restoreDocs.get(id) })).filter((p) => p.meta && p.doc);
    if (!put.length && !delIds.length) return Promise.resolve(putIds.length === 0);
    const cardIds = [...new Set(put.map((p) => p.meta.cardId))];
    const write = Promise.resolve().then(() => adapter.write({ put, del: delIds })).catch(() => false).then((ok) => {
        if (!ok) { console.warn('Topo: could not store the restore points', putIds); return false; }
        // On disk now: the document no longer has to be held here.
        put.forEach((p) => { if (adapter === _restoreAdapter) _restoreDocs.delete(p.meta.id); });
        if (_restoreChannel) { try { _restoreChannel.postMessage({ cardIds: cardIds.length ? cardIds : null }); } catch (e) { /* closed */ } }
        return true;
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), RESTORE_LIMITS.writeMs));
    return Promise.race([write, timeout]).then((ok) => ok && put.length === putIds.length);
}

// Another tab took or dropped points: read those cards' lists from the disk.
function listenForRestorePoints() {
    if (_restoreChannel) { try { _restoreChannel.close(); } catch (e) { /* closed */ } }
    _restoreChannel = null;
    if (typeof BroadcastChannel !== 'function') return;
    try { _restoreChannel = new BroadcastChannel(RESTORE_DB); } catch (e) { return; }
    const adapter = _restoreAdapter;
    _restoreChannel.onmessage = (event) => {
        const data = event.data || {};
        const cardIds = Array.isArray(data.cardIds) ? data.cardIds.filter((id) => typeof id === 'string') : [];
        if (!cardIds.length) return;
        Promise.resolve(adapter.readCards(cardIds)).then((fresh) => {
            if (!fresh || adapter !== _restoreAdapter) return;
            cardIds.forEach((cardId) => {
                // Points of this tab's still on their way to the disk stay.
                const pending = (_restore.get(cardId) || []).filter((m) => _restoreDocs.has(m.id));
                const list = (fresh[cardId] || []).map(validRestoreMeta).filter(Boolean);
                pending.forEach((m) => { if (!list.some((x) => x.id === m.id)) list.push(m); });
                list.sort((a, b) => a.at - b.at);
                if (list.length) _restore.set(cardId, list); else _restore.delete(cardId);
            });
            restoreStoreChanged();
        }).catch(() => { /* the next message, or the next visit, catches up */ });
    };
}

function restoreStoreChanged() {
    if (typeof landingIsOpen === 'function' && landingIsOpen()) renderLanding();
    if (typeof renderDocBar === 'function') renderDocBar();
    if (restoreDialogCard()) renderRestoreDialog();
}

// ---- Reading ----
// A card's points, newest first, as copies (no documents).
function restorePointsOf(cardId) {
    return (_restore.get(cardId) || []).slice().reverse().map((m) => Object.assign({}, m));
}
const hasRestorePoints = (cardId) => !!cardId && (_restore.get(cardId) || []).length > 0;

// -> a copy of a point's document, or null.
function restorePointDoc(pointId) {
    const held = _restoreDocs.get(pointId);
    if (held) return Promise.resolve(cloneData(held));
    const adapter = _restoreAdapter;
    if (!adapter || !restoreMetaById(pointId)) return Promise.resolve(null);
    return Promise.resolve().then(() => adapter.readDoc(pointId)).catch(() => null).then(validRestoreDoc);
}

function restoreReasonText(meta) {
    return t(meta.reason, { file: meta.fileName || '' });
}

// ---- Taking one ----
// The card `cardId` as it is stored now, kept as a point. Synchronous: the
// point is in this tab at once, its write follows. -> { id, stored } where
// stored is a promise of whether it reached the disk, or null when there is
// no such card.
function recordRestorePoint(cardId, reason, opts = {}) {
    const entry = typeof libraryEntry === 'function' ? libraryEntry(cardId) : null;
    if (!entry || !entry.doc || !Array.isArray(entry.doc.nodes)) return null;
    let doc;
    try { doc = cloneData(entry.doc); } catch (e) { return null; }
    const list = _restore.get(cardId) || [];
    const last = list.length ? list[list.length - 1].at : 0;
    const now = Date.now();
    const at = now > last ? now : last + 1;
    const meta = {
        id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        cardId, at, reason: String(reason || ''), bytes: restoreBytes(doc), devices: doc.nodes.length,
        name: entry.name || '', updated: Number.isFinite(entry.updated) ? entry.updated : 0
    };
    if (opts.fileName) meta.fileName = String(opts.fileName).slice(0, 200);
    list.push(meta);
    _restore.set(cardId, list);
    _restoreDocs.set(meta.id, doc);
    // Points taken together (one binder over several cards) are all kept:
    // the caps drop older ones, never another of the same batch.
    if (opts.batch instanceof Set) { opts.batch.add(meta.id); opts.batch.forEach((id) => _restoreHeld.add(id)); }
    const dropped = enforceRestoreCaps(meta.id);
    if (opts.batch instanceof Set) opts.batch.forEach((id) => _restoreHeld.delete(id));
    let stored;
    if (_restoreAdapter || !_restoreAdopting) stored = writeRestorePoints([meta.id], dropped);
    else {
        // The store is still opening: adopting it writes this point with the
        // rest. Waited for itself, not the boot's cut-short wait, so a slow
        // open is not taken for a failed one (bounded by writeMs all the same).
        const adopting = _restoreAdopting;
        const timeout = new Promise((resolve) => setTimeout(() => resolve(false), RESTORE_LIMITS.writeMs));
        stored = Promise.race([adopting.then(() => (_restoreAdapter
            ? (_restoreDocs.has(meta.id) ? writeRestorePoints([meta.id], []) : !!restoreMetaById(meta.id)) : false)), timeout]);
    }
    restoreStoreChanged();
    return { id: meta.id, stored };
}

// The guard every outside change goes through. Takes a point of each card
// in `cardIds` and waits for them to reach the disk; when one cannot, asks
// whether to download a back-up first, go ahead without, or cancel.
// -> true to go ahead, false to stop. Nothing kept here: true at once.
async function keepRestorePoints(cardIds, reason, opts = {}) {
    const ids = [...new Set(cardIds || [])].filter((id) => typeof id === 'string' && libraryEntry(id));
    if (!ids.length) return true;
    // The open card's last edit belongs in its point.
    if (typeof isKept === 'function' && isKept() && ids.includes(state.libraryId)) flushAutosave();
    const batch = new Set();
    const made = ids.map((id) => recordRestorePoint(id, reason, Object.assign({}, opts, { batch })));
    batch.forEach((id) => _restoreHeld.add(id));
    let results;
    try { results = await Promise.all(made.map((m) => (m ? m.stored : Promise.resolve(false)))); }
    finally { batch.forEach((id) => _restoreHeld.delete(id)); }
    // A point no longer listed (dropped since) is not kept, whatever its write said.
    const failed = ids.filter((_, i) => !results[i] || !made[i] || !restoreMetaById(made[i].id));
    if (!failed.length) return true;
    const one = failed.length === 1 ? libraryEntry(failed[0]) : null;
    const message = (one
        ? t('A restore point of "{name}" could not be saved in this browser, so this change could not be taken back.', { name: one.name })
        : t('Restore points of {n} networks could not be saved in this browser, so this change could not be taken back.', { n: failed.length }))
        + '\n\n' + t('Download a back-up first to keep a copy of how it is now.');
    const choice = await askChoice(message, {
        title: t('Restore points'),
        choices: [{ id: 'continue', label: t('Continue without') }, { id: 'download', label: t('Download a back-up first'), primary: true }]
    });
    if (choice === 'download') { downloadRestoreBackup(failed); return true; }
    return choice === 'continue';
}

// The usual back-up of the cards as they are stored now: one network's
// .json, or a binder of several.
function downloadRestoreBackup(cardIds) {
    const entries = cardIds.map((id) => libraryEntry(id)).filter(Boolean);
    if (!entries.length) return;
    if (entries.length === 1) {
        const e = entries[0];
        downloadNetworkJson(e.name, e.id, e.updated, e.doc, todayISO());
        return;
    }
    const sites = entries.map((e) => Object.assign({ id: e.id, name: e.name, created: e.created, updated: e.updated, doc: e.doc },
        e.template ? { template: true } : {}, e.block ? { block: true } : {}));
    downloadJson({ kind: BINDER_KIND, version: 1, exported: Date.now(), sites }, binderDownloadName(sites));
}

// The same envelope exportJsonFile() writes, for a stored document.
function downloadNetworkJson(name, id, updated, doc, day) {
    const rest = stripIdentity(cloneData(doc));
    const out = Object.assign(rest.v !== undefined ? { v: rest.v } : {}, { id, updated }, rest);
    downloadJson(Object.assign({ kind: 'nettopology', version: 1 }, name ? { name } : {}, { doc: out }), topoFileName({ org: (doc && doc.report && typeof doc.report.client === 'string' && doc.report.client) || '', site: name, date: day }, 'json'));
}

// Drop a deleted card's points: the ones this tab lists and, on disk, every
// one under the card, so a point another tab wrote that this one has not
// heard of yet goes too. While the store is still opening, the disk is
// cleared once it has opened. -> whether this tab listed any.
function dropRestorePoints(cardId) {
    if (!cardId) return false;
    const list = _restore.get(cardId) || [];
    _restore.delete(cardId);
    list.forEach((m) => _restoreDocs.delete(m.id));
    const ids = list.map((m) => m.id);
    const fromDisk = () => {
        const adapter = _restoreAdapter;
        if (!adapter) return;
        // Adopting the disk may have listed the card's points again.
        const again = _restore.get(cardId);
        if (again) { again.forEach((m) => { _restoreDocs.delete(m.id); if (!ids.includes(m.id)) ids.push(m.id); }); _restore.delete(cardId); restoreStoreChanged(); }
        Promise.resolve().then(() => (typeof adapter.dropCard === 'function'
            ? Promise.all([adapter.dropCard(cardId), ids.length ? adapter.write({ put: [], del: ids }) : true]).then((r) => r.every(Boolean))
            : adapter.write({ put: [], del: ids }))).catch(() => false).then((ok) => {
            if (ok && _restoreChannel) { try { _restoreChannel.postMessage({ cardIds: [cardId] }); } catch (e) { /* closed */ } }
        });
    };
    if (_restoreAdapter) fromDisk();
    else if (_restoreAdopting) _restoreAdopting.then(fromDisk);
    if (list.length) restoreStoreChanged();
    return list.length > 0;
}

// ---- Using one ----
// Puts a point back: first a point of the card as it is now ("Before
// restoring", so this can be taken back the same way), then the card holds
// the point's document and opens. -> whether it was restored.
async function restoreFromPoint(cardId, pointId) {
    const meta = (_restore.get(cardId) || []).find((m) => m.id === pointId);
    if (!meta || !libraryEntry(cardId)) return false;
    const doc = await restorePointDoc(pointId);
    if (!doc) { restorePointUnreadable(); return false; }
    // Shut before keepRestorePoints, which may ask a question: the question
    // must not open under this dialog.
    closeRestoreDialog();
    if (!(await keepRestorePoints([cardId], 'Before restoring'))) return false;
    const lib = loadLibrary();
    const cur = lib[cardId];
    if (!cur) return false;
    lib[cardId] = Object.assign({}, cur, { doc, updated: Math.max(Date.now(), (cur.updated || 0) + 1) });
    if (!persistLibrary(lib)) { showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err'); return false; }
    closeRestoreDialog();
    const entry = libraryEntry(cardId);
    if (state.libraryId === cardId && !state.readOnly) {
        replaceDocument(entry.doc, { libraryId: cardId, origin: 'library' });
        if (typeof landingIsOpen === 'function' && landingIsOpen()) landingHandledDocument();
    } else await openFromLibrary(cardId);
    showToast(t('Restored "{name}". How it was just before is kept as a restore point.', { name: entry.name }), 'ok');
    return true;
}

// A point as a normal back-up file of its network, under the card's id and
// the time the card had then, so opening it later is recognised as an older
// copy of that card. Not a back-up of the card as it is: no baseline taken.
async function downloadRestorePoint(cardId, pointId) {
    const meta = (_restore.get(cardId) || []).find((m) => m.id === pointId);
    if (!meta) return false;
    const doc = await restorePointDoc(pointId);
    if (!doc) { restorePointUnreadable(); return false; }
    const entry = libraryEntry(cardId);
    downloadNetworkJson((entry && entry.name) || meta.name, cardId, meta.updated || meta.at, doc, todayISO(new Date(meta.at)));
    return true;
}

// A point that cannot be read. Said in the dialog when it is open (a toast
// would be drawn under its scrim), else as a toast.
function restorePointUnreadable() {
    const msg = t('That restore point could not be read.');
    const status = restoreEl('restoreStatus');
    if (status && restoreDialogCard()) { status.textContent = msg; status.classList.remove('hidden'); return; }
    showToast(msg, 'err');
}

// ---- The dialog ----
let _restoreDialogCard = null;
let _restoreBusy = false;       // a Restore or Download still running: the buttons wait
const restoreEl = (id) => document.getElementById(id);
const restoreDialogCard = () => (_restoreDialogCard && restoreEl('restoreDialog') && !restoreEl('restoreDialog').hidden ? _restoreDialogCard : null);

function restoreWhenText(at) {
    const lang = document.documentElement.lang || undefined;
    try { return new Date(at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return new Date(at).toLocaleString(); }
}

function renderRestoreDialog() {
    const cardId = _restoreDialogCard;
    const entry = cardId ? libraryEntry(cardId) : null;
    restoreEl('restoreName').textContent = entry ? entry.name : '';
    const list = restoreEl('restoreList');
    list.textContent = '';
    list.setAttribute('aria-busy', _restoreBusy ? 'true' : 'false');
    const points = restorePointsOf(cardId);
    restoreEl('restoreEmpty').classList.toggle('hidden', points.length > 0);
    points.forEach((m) => {
        const li = document.createElement('li');
        li.className = 'restore-row';
        li.dataset.id = m.id;
        const text = document.createElement('div');
        text.className = 'restore-text';
        const when = document.createElement('span');
        when.className = 'restore-when';
        when.textContent = restoreWhenText(m.at);
        const why = document.createElement('span');
        why.className = 'restore-why';
        why.textContent = restoreReasonText(m);
        const n = document.createElement('span');
        n.className = 'restore-n';
        n.textContent = t(m.devices === 1 ? '{n} device' : '{n} devices', { n: m.devices });
        text.append(when, why, n);
        const acts = document.createElement('div');
        acts.className = 'restore-acts';
        const restore = document.createElement('button');
        restore.type = 'button'; restore.className = 'btn btn-primary'; restore.dataset.restore = m.id;
        restore.textContent = t('Restore');
        restore.disabled = _restoreBusy;
        const dl = document.createElement('button');
        dl.type = 'button'; dl.className = 'btn'; dl.dataset.download = m.id;
        dl.textContent = t('Download');
        dl.disabled = _restoreBusy;
        acts.append(restore, dl);
        li.append(text, acts);
        list.appendChild(li);
    });
}

function openRestoreDialog(cardId) {
    if (!cardId || !libraryEntry(cardId)) return;
    _restoreDialogCard = cardId;
    const status = restoreEl('restoreStatus');
    if (status) { status.textContent = ''; status.classList.add('hidden'); }
    const scrim = restoreEl('restoreDialog');
    if (window.CarinoUI) CarinoUI.modal.open(scrim, {});
    else scrim.hidden = false;
    renderRestoreDialog();
}
function closeRestoreDialog() {
    const scrim = restoreEl('restoreDialog');
    if (!scrim) return;
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
}

(function wireRestoreDialog() {
    const scrim = restoreEl('restoreDialog');
    if (!scrim) return;
    scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeRestoreDialog));
    restoreEl('restoreList').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || !_restoreDialogCard || _restoreBusy) return;
        const run = b.dataset.restore ? () => restoreFromPoint(_restoreDialogCard, b.dataset.restore)
            : b.dataset.download ? () => downloadRestorePoint(_restoreDialogCard, b.dataset.download) : null;
        if (!run) return;
        // One at a time: a double tap must not restore twice.
        const status = restoreEl('restoreStatus');
        if (status) { status.textContent = ''; status.classList.add('hidden'); }
        _restoreBusy = true;
        renderRestoreDialog();
        Promise.resolve().then(run).catch(() => false).then(() => {
            _restoreBusy = false;
            if (restoreDialogCard()) renderRestoreDialog();
        });
    });
})();

// Published for tests/suites/restore.js.
window.CarinoRestore = { RESTORE_DB, RESTORE_LIMITS, RESTORE_REASONS, openRestoreStore, releaseRestoreStore, idbRestoreAdapter,
    recordRestorePoint, keepRestorePoints, restorePointsOf, hasRestorePoints, restorePointDoc, dropRestorePoints,
    restoreFromPoint, downloadRestorePoint, openRestoreDialog, closeRestoreDialog, restoreReasonText,
    _reset() { _restore.clear(); _restoreDocs.clear(); } };
