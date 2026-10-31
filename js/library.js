// ---- The library: the networks this browser remembers ----
// Topo has no server and no account, which leaves exactly one gap, and it is
// the one that loses work: close the tab without keeping a copy and the
// evening is gone. So a kept network is the *same* serialized document,
// parked in this browser's storage under a name (IndexedDB, with localStorage
// as the fallback — see "Where the library is kept"), and the landing page is
// a list of them.
//
// Two rules follow, and both are load-bearing:
//
//   * A kept network saves itself. The live document sits in history.state
//     (never in the URL — see topo-link privacy), and once it is a card every
//     change is written back to that card (autosave: debounced, and flushed on
//     pagehide, export and when the document is replaced). The example, a
//     template opened to start from and links someone sent are not cards until "Keep this network" says so,
//     so opening one never quietly fills the shelf.
//
//   * It is one browser on one machine, not an account. That has to be said in
//     words on the landing page rather than left for someone to discover with a
//     cleared cache halfway through an engagement — a card list looks exactly
//     like cloud storage, and people will trust it as if it were. Back up is
//     the answer to that, and a refused write says so in a banner.
//
// An entry is {id, name, doc, created, updated}, plus `template: true` on a
// saved template (and `block: true` as well on a saved selection, js/add.js) and `nameAuto: true` on a card whose name nobody typed (it
// follows the report header's site until someone does). `doc` is whatever
// serializeDoc() produced, so a card and a "Copy link" URL carry the same
// network.
//
// A card's id is also the document's identity (state.docId): a build file or
// a link carries it, which is how bringing the same network back is recognised
// as that card, newer-wins, rather than becoming a second card.
const LIBRARY_KEY = 'nettopo_library';

// Time plus 64 random bits. The time keeps ids roughly ordered for a human
// reading a binder file; the randomness is what keeps two machines (or two
// templates migrated in the same millisecond) from ever sharing one. The old
// 1296-way suffix was enough for one person clicking Save, not for a loop.
function mintLibraryId() {
    const rand = Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join('');
    return `n${Date.now().toString(36)}${rand}`;
}

// ---- Where the library is kept ----
// IndexedDB, one record per card, with localStorage as the fallback. The
// library began as one localStorage blob, and that store has two limits that
// stop being theoretical once networks save themselves: about 5 MB for the
// whole origin, which a large estate reaches, and a write that rewrites every
// card to change one, on every autosave. IndexedDB has room (a share of the
// disk) and takes a card at a time.
//
// The library is still read synchronously everywhere — a card list, the doc
// bar, the binder, a merge — so in IndexedDB mode the cards are held in memory
// (_cards, id -> the card's JSON) and every change is written behind: the
// change is in the library at once, and the disk follows a moment later. A
// write the disk refuses (the quota, or storage cleared under an open tab)
// cannot be reported to a caller that has already returned, so it is reported
// the way autosave's failures already were: the storage banner goes up and
// stays until a write gets through, the doc bar says "Not saved", and
// flushAutosave() answers false so a kept network is asked about before it is
// replaced. Back up all still has everything: it reads the memory, not the disk.
// After a refused write the disk no longer matches what this tab thinks is on
// it, so the next write puts every card this tab holds and repeats the deletes
// that were refused, in one transaction (all or none — a refused one leaves
// the disk as it was). Not a clear-and-rewrite: that would also remove a card
// another tab added that this one has not heard about.
//
// localStorage keeps two jobs, both under the old key:
//   * The fallback. Where IndexedDB cannot be opened (blocked storage, an
//     older private mode, a browser without it), the library is the one
//     localStorage blob it always was — read through on every call, written
//     whole, a refused write returning false. Nothing above this layer changes.
//   * The way in. Whatever the key holds when IndexedDB opens is merged into it,
//     card by card, newer `updated` wins, and the key is removed once the disk
//     has it. That is the one-time migration of an existing library, and the
//     same rule picks up a session that ran on the fallback, the cards a tab
//     still running the old code wrote, and the journal below. If IndexedDB
//     refuses the merge, the key stays, so nothing is lost by trying.
//
// Two edges that a write-behind store has and a synchronous one did not:
//   * Leaving the page. A transaction still in flight when the tab closes may
//     not finish, so on pagehide (flushPendingSaves, js/app.js) the cards with
//     a write outstanding are copied into the old key as a journal, which the
//     next visit merges. A delete still in flight is not journalled: at worst
//     a card deleted in the last instant before closing comes back.
//   * Other tabs. With localStorage every read went to the store, so a second
//     tab saw the first one's cards. Held in memory it would not, and its next
//     write would be made against a stale list — so writes go per card (one
//     tab's save never rewrites another's cards), and each committed write is
//     announced on a BroadcastChannel; the other tabs re-read those cards and
//     redraw. Nothing leaves the browser: a BroadcastChannel reaches only this
//     origin's own tabs.
const LIBRARY_DB = 'nettopo_library';
const LIBRARY_STORE = 'cards';
// How long boot waits for IndexedDB before drawing on the fallback. Opening it
// takes milliseconds; the deadline is for the browser where it does not answer
// (an open held up by another tab, a storage layer that hangs), so the page is
// never left blank waiting on it. If it answers later after all, it is adopted
// then — see openLibraryStore().
const LIBRARY_OPEN_MS = 1000;

let _libStore = 'pending';     // 'pending' until boot decides, then 'idb' or 'local'
let _cards = null;             // 'idb': Map id -> card JSON, the library as this tab holds it
let _libAdapter = null;        // 'idb': the store the cards are written to
let _libChannel = null;        // 'idb': other tabs' committed writes
// Write bookkeeping. Each write has a sequence number; the disk is out of step
// while some write has failed and no full rewrite issued after it has
// succeeded. Writes on one IndexedDB store commit in the order they were
// issued, which is what makes a later full rewrite cover an earlier failure.
let _writeSeq = 0, _lastFailSeq = 0, _lastFullSeq = 0, _writesOut = 0;
const _cardsInFlight = new Map();   // id -> how many unsettled writes carry it
const _refusedDels = new Map();     // id -> seq of the refused write that deleted it
// Cards this tab put whose write was refused: in the library, not on the disk,
// until a later write of them (or a full rewrite) lands. Another tab reading
// the disk must not take them for deleted — see applyOtherTabCards().
const _refusedPuts = new Map();     // id -> seq of the refused write that put it
// The old key's contents this tab merged or journalled, removed once settled.
let _absorbedRaw = null;
const libraryStoreKind = () => _libStore;
const libraryAdapter = () => _libAdapter;
const diskOutOfStep = () => _lastFailSeq > _lastFullSeq;

// -> Promise<true> once every write issued so far has reached the store and
// the store is in step; false when one was refused. The fallback's writes are
// synchronous, so it answers at once. For what may only be thrown away after
// the library is safely stored — the old template store, below.
const _settledWaiters = [];
function libraryWritesSettled() {
    if (_libStore !== 'idb' || !_writesOut) return Promise.resolve(_libStore === 'idb' ? !diskOutOfStep() : !_storageFailed);
    return new Promise((resolve) => _settledWaiters.push(resolve));
}

// The fallback's read: the old blob, as it always was.
function readLocalLibrary() {
    try {
        const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '{}');
        // An array here would be an older or a corrupted store; treating it as
        // empty loses nothing that was readable anyway, and stops every caller
        // below having to re-check the shape.
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (e) { return {}; }
}

// A fresh object on every call, in both modes: callers change what they get
// and persist it, and a change that is never persisted must not leak into the
// next caller's copy.
function loadLibrary() {
    if (_libStore !== 'idb') return readLocalLibrary();
    const lib = {};
    _cards.forEach((json, id) => {
        try { lib[id] = JSON.parse(json); } catch (e) { return; /* unreadable: as the blob's junk was */ }
        if (lib[id] && typeof lib[id] === 'object') _cardRaw.set(lib[id], json);
    });
    return lib;
}
// Each card object loadLibrary handed out -> the text it was parsed from, for
// the landing's summary memo (librarySummary): the text is the card, so a
// summary keyed by it cannot belong to another. Only true while the object is
// as handed out, which is how renderLanding uses it.
const _cardRaw = new WeakMap();
const libraryRawOf = (entry) => (entry && _cardRaw.get(entry)) || undefined;

// The one guarded write. Safari private mode throws on setItem and so does a
// full quota, and a saved network is the one place where failing silently
// would be worst — the user would close the tab believing the work was kept.
// Callers report the false, and the outcome is remembered: with autosave there
// is often no caller watching, so the storage banner (renderDocBar) says it
// instead, and stays until a write gets through.
//
// In IndexedDB mode the answer is always true — the change is in the library —
// and whether the disk took it arrives later, through the same banner.
let _storageFailed = false;
const storageFailed = () => _storageFailed;
function setStorageFailed(failed) {
    if (failed === _storageFailed) return;
    _storageFailed = failed;
    renderDocBar();
}
function persistLibrary(lib) {
    if (_libStore === 'idb') { writeCards(lib); return true; }
    let ok = true;
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); }
    catch (e) { ok = false; }
    setStorageFailed(!ok);
    return ok;
}

// lib -> the cards that differ from what this tab last wrote, written as one
// transaction. Out of step after a refused write, it rewrites them all.
function writeCards(lib) {
    const next = new Map();
    Object.keys(lib).forEach((id) => {
        let json;
        try { json = JSON.stringify(lib[id]); } catch (e) { return; }
        if (json !== undefined) next.set(id, json);   // what JSON.stringify(lib) would have dropped
    });
    const full = diskOutOfStep();
    const puts = new Map();
    const dels = [];
    next.forEach((json, id) => { if (full || _cards.get(id) !== json) puts.set(id, json); });
    _cards.forEach((json, id) => { if (!next.has(id)) dels.push(id); });
    if (full) _refusedDels.forEach((seq, id) => { if (!next.has(id) && !dels.includes(id)) dels.push(id); });
    _cards = next;
    if (full || puts.size || dels.length) issueWrite(puts, dels, full);
}

// Issued synchronously, so transactions open (and so commit) in call order.
function issueWrite(puts, dels, full) {
    const seq = ++_writeSeq;
    const ids = [...puts.keys(), ...dels];
    _writesOut++;
    ids.forEach((id) => _cardsInFlight.set(id, (_cardsInFlight.get(id) || 0) + 1));
    let pending;
    try { pending = Promise.resolve(_libAdapter.write({ puts, dels, full })); }
    catch (e) { pending = Promise.resolve(false); }
    const adapter = _libAdapter;
    pending.catch(() => false).then((ok) => {
        // Released (a test putting the fallback back) or replaced meanwhile:
        // this write's outcome belongs to a store that is no longer in use.
        if (adapter !== _libAdapter) return;
        _writesOut--;
        ids.forEach((id) => {
            const n = (_cardsInFlight.get(id) || 1) - 1;
            if (n) _cardsInFlight.set(id, n); else _cardsInFlight.delete(id);
        });
        if (!ok) {
            _lastFailSeq = Math.max(_lastFailSeq, seq);
            dels.forEach((id) => { _refusedDels.set(id, seq); _refusedPuts.delete(id); });
            puts.forEach((json, id) => _refusedPuts.set(id, Math.max(_refusedPuts.get(id) || 0, seq)));
        } else {
            dels.forEach((id) => { _refusedDels.delete(id); _refusedPuts.delete(id); });
            // A later put of the card covers an earlier refusal of it, not a later one.
            puts.forEach((json, id) => { if ((_refusedPuts.get(id) || 0) < seq) _refusedPuts.delete(id); });
            if (full) {
                _lastFullSeq = Math.max(_lastFullSeq, seq);
                // Every card was put, so only a write refused after it is still owed.
                _refusedDels.forEach((at, id) => { if (at < seq) _refusedDels.delete(id); });
                _refusedPuts.forEach((at, id) => { if (at < seq) _refusedPuts.delete(id); });
            }
            if (_libChannel) { try { _libChannel.postMessage(full ? { all: true } : { ids }); } catch (e) { /* closed */ } }
        }
        setStorageFailed(diskOutOfStep());
        settleAbsorbed();
        if (!_writesOut) _settledWaiters.splice(0).forEach((resolve) => resolve(!diskOutOfStep()));
    });
}

// The old key's merged contents (or this tab's journal) go once the disk has
// everything this tab wrote. Only if the key still holds exactly that: anything
// else was written by someone else since, and is the next visit's to merge.
function settleAbsorbed() {
    if (_absorbedRaw === null || _writesOut || diskOutOfStep()) return;
    try { if (localStorage.getItem(LIBRARY_KEY) === _absorbedRaw) localStorage.removeItem(LIBRARY_KEY); }
    catch (e) { /* blocked: harmless, the next visit merges it again and changes nothing */ }
    _absorbedRaw = null;
}

// pagehide (js/app.js): the cards whose write has not committed, copied into
// the old key so the next visit can merge them. Added to whatever the key
// already holds, never replacing it — that may be cards not yet merged.
function journalUnsettledCards() {
    if (_libStore !== 'idb' || (!_writesOut && !diskOutOfStep())) return;
    const ids = diskOutOfStep() ? [..._cards.keys()] : [..._cardsInFlight.keys()].filter((id) => _cards.has(id));
    if (!ids.length) return;
    let before = null;
    try { before = localStorage.getItem(LIBRARY_KEY); } catch (e) { return; }
    // Whether the key is ours to remove once the writes land: only when it
    // held nothing, or only what this tab put there. Cards someone else left
    // in it (a tab on the fallback, an old Topo) are not in IndexedDB yet, and
    // removing them with the journal would lose them; the next visit merges.
    const ours = before === null || before === _absorbedRaw;
    const journal = readLocalLibrary();
    ids.forEach((id) => {
        try {
            const card = JSON.parse(_cards.get(id));
            const there = journal[id];
            if (!there || typeof there !== 'object' || (card && card.updated || 0) >= (there.updated || 0)) journal[id] = card;
        } catch (e) { /* unreadable: nothing to journal */ }
    });
    try {
        const raw = JSON.stringify(journal);
        localStorage.setItem(LIBRARY_KEY, raw);
        _absorbedRaw = ours ? raw : null;
    } catch (e) { /* full or blocked: the in-flight write is the only chance, as it was */ }
}

// A card from the old key worth merging: the same test libraryEntries() uses
// to decide what is a card at all.
const isCardShape = (e) => !!e && typeof e === 'object' && !!e.doc && Array.isArray(e.doc.nodes);

// The IndexedDB store: a database of its own (the binder's file handle keeps
// its separate one), one record per card, keyed by the card's id and holding
// its JSON — the same text the blob held, so nothing about a card changes on
// the way in or out. Every call resolves rather than rejects.
function idbLibraryAdapter() {
    let db = null;
    const request = (fn) => new Promise((resolve) => {
        try { fn(resolve); } catch (e) { resolve(null); }
    });
    return {
        // -> { id: json } of every card, or null when IndexedDB cannot be used here.
        readAll() {
            return request((resolve) => {
                const req = indexedDB.open(LIBRARY_DB, 1);
                req.onupgradeneeded = () => { try { req.result.createObjectStore(LIBRARY_STORE); } catch (e) { /* already there */ } };
                req.onerror = () => resolve(null);
                req.onsuccess = () => {
                    db = req.result;
                    // Another tab upgrading the schema, or the user clearing
                    // site data: let go, and let the writes fail into the banner.
                    db.onversionchange = () => { try { db.close(); } catch (e) { /* closed */ } };
                    this.readCards(null).then(resolve);
                };
            });
        },
        // ids (or null for all) -> { id: json }, with null for an id the store does not hold.
        readCards(ids) {
            return request((resolve) => {
                if (!db) { resolve(null); return; }
                const tx = db.transaction(LIBRARY_STORE, 'readonly');
                const store = tx.objectStore(LIBRARY_STORE);
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
        },
        // { puts: Map id -> json, dels: [id] } -> committed? (`full` marks the
        // rewrite after a refusal; to the store it is just a bigger write.)
        write({ puts, dels }) {
            return request((resolve) => {
                if (!db) { resolve(false); return; }
                const tx = db.transaction(LIBRARY_STORE, 'readwrite');
                const store = tx.objectStore(LIBRARY_STORE);
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => resolve(false);
                puts.forEach((json, id) => store.put(json, id));
                dels.forEach((id) => store.delete(id));
            }).then((ok) => ok === true);
        }
    };
}

// Boot awaits this before anything reads the library. -> the store in use.
// Whatever the deadline decides, IndexedDB answering later is still adopted,
// and the page redraws what reads the library. `adapter` and `ms` are for the
// store suite; boot passes neither.
function openLibraryStore(adapter = idbLibraryAdapter(), ms = LIBRARY_OPEN_MS) {
    let timer = 0, late = false;
    const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
            late = true;
            if (_libStore === 'pending') _libStore = 'local';
            resolve(_libStore);
        }, ms);
    });
    const opened = Promise.resolve()
        .then(() => adapter.readAll())   // null: no IndexedDB here
        .then((disk) => (disk ? adoptLibraryStore(adapter, disk) : null))
        .catch(() => null)
        .then(() => {
            clearTimeout(timer);
            if (_libStore === 'pending') _libStore = 'local';
            // Drawn from the fallback while it was being waited for: draw again.
            if (late && _libAdapter === adapter) libraryStoreChanged();
            return _libStore;
        });
    return Promise.race([opened, deadline]);
}

// Switch to IndexedDB: the disk's cards, plus the old key's merged in, newer
// `updated` wins. -> 'idb'. Also the seam the store suite drives with a store
// of its own.
function adoptLibraryStore(adapter, disk) {
    const cards = new Map();
    Object.keys(disk || {}).forEach((id) => {
        const v = disk[id];
        if (typeof v === 'string') cards.set(id, v);
        else if (v !== null && v !== undefined) { try { cards.set(id, JSON.stringify(v)); } catch (e) { /* unstorable */ } }
    });
    let raw = null;
    try { raw = localStorage.getItem(LIBRARY_KEY); } catch (e) { raw = null; }
    const leftovers = raw === null ? {} : readLocalLibrary();
    const puts = new Map();
    Object.keys(leftovers).forEach((id) => {
        const theirs = leftovers[id];
        if (!isCardShape(theirs)) return;
        let mine = null;
        try { mine = cards.has(id) ? JSON.parse(cards.get(id)) : null; } catch (e) { mine = null; }
        if (mine && (theirs.updated || 0) <= (mine.updated || 0)) return;
        const json = JSON.stringify(theirs);
        cards.set(id, json);
        puts.set(id, json);
    });
    _libAdapter = adapter;
    _cards = cards;
    _libStore = 'idb';
    _writeSeq = _lastFailSeq = _lastFullSeq = _writesOut = 0;
    _cardsInFlight.clear(); _refusedDels.clear(); _refusedPuts.clear();
    _absorbedRaw = raw;
    // The banner, if a fallback write raised it, stays: what that write held
    // is not stored yet, and the next write that gets through takes it down.
    listenToOtherTabs();
    if (puts.size) issueWrite(puts, [], false);
    else settleAbsorbed();   // nothing new in it (or unreadable): it can go now
    return 'idb';
}

// Back to the fallback, holding whatever this tab had. For the store suite,
// which has to hand the page back as it found it.
function releaseLibraryStore() {
    if (_libStore !== 'idb') return;
    const lib = loadLibrary();
    if (_libChannel) { try { _libChannel.close(); } catch (e) { /* closed */ } }
    _libChannel = null; _libAdapter = null; _cards = null; _libStore = 'local';
    _writesOut = 0; _cardsInFlight.clear(); _refusedDels.clear(); _refusedPuts.clear(); _absorbedRaw = null;
    _settledWaiters.splice(0).forEach((resolve) => resolve(false));
    persistLibrary(lib);
}

function listenToOtherTabs() {
    if (_libChannel) { try { _libChannel.close(); } catch (e) { /* closed */ } }
    _libChannel = null;
    if (typeof BroadcastChannel !== 'function') return;
    try { _libChannel = new BroadcastChannel(LIBRARY_DB); } catch (e) { return; }
    const adapter = _libAdapter;
    _libChannel.onmessage = (event) => {
        const msg = event.data || {};
        const ids = Array.isArray(msg.ids) ? msg.ids.filter((id) => typeof id === 'string') : null;
        if (!msg.all && !ids) return;
        Promise.resolve(adapter.readCards(msg.all ? null : ids)).then((fresh) => {
            if (!fresh || adapter !== _libAdapter) return;
            applyOtherTabCards(fresh, !!msg.all);
        }).catch(() => { /* the next message, or the next visit, catches up */ });
    };
}

// Another tab's committed cards into this tab's memory. A card this tab is
// itself still writing is left alone: its own write lands after and wins, as
// the later write always did with the blob.
//
// So is a card whose write the disk refused here. It is missing from the disk
// (or there in an older version) only because of that refusal — and quota is
// the whole site's, so the other tab's full rewrite is exactly when this
// happens. Taking the disk's word would drop the card from memory, from Back
// up all and from this tab's next rewrite, without a word. It stays, and the
// next write that gets through puts it. The one exception: the other tab's
// version is newer than ours (it edited the card after we did), and then
// theirs is the later write and wins. A delete refused here is the same: the
// card the disk still holds is not brought back.
function applyOtherTabCards(fresh, all) {
    const ids = all ? new Set([..._cards.keys(), ...Object.keys(fresh)]) : new Set(Object.keys(fresh));
    const updatedOf = (json) => { try { return (JSON.parse(json) || {}).updated || 0; } catch (e) { return 0; } };
    let changed = false;
    ids.forEach((id) => {
        if (_cardsInFlight.has(id) || _refusedDels.has(id)) return;
        const v = Object.prototype.hasOwnProperty.call(fresh, id) ? fresh[id] : null;
        if (_refusedPuts.has(id)) {
            if (typeof v !== 'string' || !_cards.has(id) || updatedOf(v) <= updatedOf(_cards.get(id))) return;
            _refusedPuts.delete(id);
        }
        if (typeof v === 'string') { if (_cards.get(id) !== v) { _cards.set(id, v); changed = true; } }
        else if (_cards.delete(id)) changed = true;
    });
    if (changed) libraryStoreChanged();
}

// Redraw what reads the library, after cards arrived from somewhere other than
// this tab's own calls (another tab, or IndexedDB adopted after the deadline).
function libraryStoreChanged() {
    if (landingIsOpen()) renderLanding();
    renderUserTemplates();
    renderDocBar();
}

// Most-recently-touched first: the card you want is nearly always the one you
// were just working on. Entries whose doc did not survive a bad write are
// dropped rather than rendered as a card that opens onto nothing.
function libraryEntries() {
    return Object.values(loadLibrary())
        .filter((e) => e && typeof e === 'object' && e.doc && Array.isArray(e.doc.nodes))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

// One card. In IndexedDB mode only that card is parsed: the doc bar asks for
// the open network's card on every render, and an estate is many cards.
function libraryEntry(id) {
    if (!id) return null;
    if (_libStore !== 'idb') return readLocalLibrary()[id] || null;
    if (!_cards.has(id)) return null;
    try { return JSON.parse(_cards.get(id)) || null; } catch (e) { return null; }
}

// The two kinds of card. Templates travel in the binder and the back-up like
// any card (they are the user's own work), but they are not sites: the estate
// report and a cloud's "stands for another site" list leave them out.
const libraryNetworks = () => libraryEntries().filter((e) => !e.template);
// A block (a saved selection, js/add.js) is a template card too, so it is
// never a site; it is inserted into a network, not opened as one, so the
// Networks tab's "My templates" leaves it out and the Blocks tab lists it.
const libraryTemplates = () => libraryEntries().filter((e) => e.template && !e.block);

// Save the canvas as it stands. Passing an id updates that entry in place —
// which is what makes "Save" idempotent instead of breeding "Torre B (2)" —
// or creates it under that id, which is how a kept network's first autosave
// lands on the id it already has.
//
// The name: one passed in wins. Without one (autosave) the card keeps its
// name, unless nobody ever typed one (nameAuto), in which case it follows the
// site in the report header — the one place a site name has already been
// typed — and only falls back to "Untitled network".
// `updated` is strictly increasing per entry, never merely Date.now(). Two saves
// inside the same millisecond would otherwise be indistinguishable, and three
// separate things read this field and get it wrong when it stands still: the
// binder's "newer wins" merge, the "changed since you exported" line, and the
// most-recent-first order of the cards.
function stampUpdated(previous) {
    const now = Date.now();
    return previous && previous.updated >= now ? previous.updated + 1 : now;
}

// opts.doc: what to store instead of the canvas (a block: the selection).
//
// In IndexedDB mode, with the disk in step, only this card is read and
// written: an autosave of one network no longer parses and re-serializes
// every card on the shelf. The rest are left untouched, which also leaves an
// unreadable one where it is (the full path drops it, as loadLibrary skips it
// and writeCards then deletes it), so this loses less. A disk out of step
// still takes the full path: only writeCards replays the refused puts and
// deletes, in one rewrite of every card.
function librarySave(name, id, opts = {}) {
    if (state.readOnly) return null;   // keepThisNetwork says why
    if (_libStore === 'idb' && !diskOutOfStep()) {
        const held = id ? libraryEntry(id) : null;
        const prev = held && typeof held === 'object' ? held : null;
        const key = id || mintLibraryId();
        let json;
        try { json = JSON.stringify(libraryEntryFor(key, name, prev, opts)); } catch (e) { return null; }
        // The same text writeCards would hold and put for it.
        if (_cards.get(key) !== json) { _cards.set(key, json); issueWrite(new Map([[key, json]]), [], false); }
        return key;
    }
    const lib = loadLibrary();
    const prev = id && lib[id] && typeof lib[id] === 'object' ? lib[id] : null;
    const key = id || mintLibraryId();
    lib[key] = libraryEntryFor(key, name, prev, opts);
    return persistLibrary(lib) ? key : null;
}
// The card librarySave stores, built the same on both of its paths.
function libraryEntryFor(key, name, prev, opts) {
    const given = String(name || '').trim();
    const nameAuto = given ? !!opts.nameAuto : (prev ? !!prev.nameAuto : true);
    const site = state.report && typeof state.report.site === 'string' ? state.report.site.trim() : '';
    const entry = {
        id: key,
        name: given || (nameAuto && site) || (prev && prev.name) || t('Untitled network'),
        // Never the read-only passthrough: a card is what a binder file and a
        // binder link copy, so it holds only what the allowlist lets through.
        doc: opts.doc || serializeDoc(),
        created: (prev && prev.created) || Date.now(),
        updated: stampUpdated(prev)
    };
    if (opts.template || (prev && prev.template)) entry.template = true;
    if (opts.block || (prev && prev.block)) entry.block = true;
    if (nameAuto) entry.nameAuto = true;
    return entry;
}

// A second card holding the same network: how a new survey starts from an old
// one, or from a saved template. Always a network, never a template — using a
// template is what duplicating one is for. The document is copied as stored.
function libraryDuplicate(id) {
    const lib = loadLibrary();
    const src = lib[id];
    if (!src || !src.doc) return null;
    const key = mintLibraryId();
    const now = Date.now();
    lib[key] = { id: key, name: t('{name} (copy)', { name: src.name }), doc: cloneData(src.doc), created: now, updated: now };
    return persistLibrary(lib) ? key : null;
}

function libraryDelete(id) {
    const lib = loadLibrary();
    if (!lib[id]) return false;
    delete lib[id];
    const ok = persistLibrary(lib);
    // Its baseline goes with it (js/changes.js): an old copy of a network
    // somebody deleted has no business staying in the browser.
    if (ok) dropSnapshot(id);
    return ok;
}

function libraryRename(id, name) {
    const lib = loadLibrary();
    if (!lib[id]) return false;
    const next = String(name || '').trim();
    if (!next || next === lib[id].name) return true;   // nothing changed; do not age the entry for it
    lib[id].name = next;
    delete lib[id].nameAuto;   // somebody typed it: it no longer follows the report header
    // A rename is a change to the entry, so the exported binder no longer
    // matches it and the card has just been touched. Without this the landing
    // would go on saying the binder is current after the one edit most likely
    // to happen right before someone hands the file over.
    lib[id].updated = stampUpdated(lib[id]);
    return persistLibrary(lib);
}

// ---- The binder: the whole library as one file ----
// This browser's storage is where the library *lives*, and it is one browser
// on one machine. The binder is the copy that is not: the thing that goes in the
// client folder, into git, onto a second laptop, or into an email when the
// engagement is handed over. Same envelope idea as the single-network .nettopo
// build file, one level up — a `kind` so the file can be recognised on the way
// back in, and a `version` so it can grow a schema later.
//
// Entries keep their ids in the file, which is what makes re-importing your own
// binder a no-op instead of a second copy of everything. Ids are minted from a
// timestamp plus randomness, so two machines colliding would take a deliberate
// effort.
const BINDER_KIND = 'nettopo-binder';
const BINDER_VERSION = 1;
const BINDER_FILENAME = 'networks.nettopo-binder.json';

function binderFile() {
    // The open network's last edits belong in any copy of the library. When
    // the browser refuses the write (a full quota — the storage banner's case,
    // which is exactly when someone reaches for Back up all) the card still
    // holds the older copy, or no copy at all if the first write already
    // failed, so the live document goes into the file in its place.
    const flushed = flushAutosave();
    const live = !flushed && isKept() && !state.readOnly ? state.libraryId : null;
    const sites = libraryEntries().map((e) => Object.assign({ id: e.id, name: e.name, created: e.created, updated: e.updated, doc: e.doc },
        e.template ? { template: true } : {}, e.block ? { block: true } : {}));
    if (live) {
        const now = Date.now();
        const at = sites.findIndex((x) => x.id === live);
        if (at >= 0) sites[at] = { ...sites[at], doc: serializeDoc(), updated: Math.max(now, sites[at].updated || 0) };
        else {
            const site = (state.report && typeof state.report.site === 'string' && state.report.site.trim()) || '';
            sites.unshift({ id: live, name: site || t('Untitled network'), created: now, updated: now, doc: serializeDoc() });
        }
    }
    return {
        kind: BINDER_KIND,
        version: BINDER_VERSION,
        exported: new Date().toISOString(),
        sites
    };
}

// The binder as it may go into a URL. binderFile() hands each card's doc over
// as stored, which is right for the file (a copy of this browser's own
// library), but a card can hold a document this build did not write: one kept
// from a colleague's binder file or link is stored as it arrived, and so is one
// from a newer Topo. A link is where the serializer's allowlist matters most,
// so every site is rewritten through it here, and a site from a newer Topo,
// which the serializer would trim, is left out and counted instead
// (copyShareLink offers the binder file for those).
//   -> { file, newer }
function binderLinkFile() {
    const file = binderFile();
    let newer = 0;
    file.sites = file.sites.filter((s) => {
        if (migrateDoc(s.doc).newer) { newer++; return false; }
        return true;
    }).map((s) => ({ ...s, doc: canonicalDoc(s.doc) }));
    return { file, newer };
}

// doc -> the same document as this build's serializer writes it. Borrows the
// canvas the way withDoc() does, but keeps the notes and the report header,
// which withDoc() drops because a summary has no use for them.
// Out of any lookup pass its caller has open: loadDocState filters the
// borrowed document's cables with getNode, which inside one would answer from
// the live document's index.
function canonicalDoc(doc) {
    return withoutLookupPass(() => {
        const held = { nodes: state.nodes, links: state.links, networks: state.networks, groups: state.groups, wifi: state.wifi, accepted: state.accepted, pinned: state.pinned, expectedLife: state.expectedLife, columns: state.columns, tableView: state.tableView, annotations: state.annotations, report: state.report };
        _borrowedState++;
        try {
            loadDocState(doc);
            return serializeDoc();
        } finally {
            _borrowedState--;
            state.nodes = held.nodes; state.links = held.links; state.networks = held.networks; state.groups = held.groups; state.wifi = held.wifi; state.accepted = held.accepted; state.pinned = held.pinned; state.expectedLife = held.expectedLife;
            state.columns = held.columns; state.tableView = held.tableView;
            state.annotations = held.annotations; state.report = held.report;
        }
    });
}
// Nonzero while canonicalDoc() or withDoc() has another document in state.
// An autosave that ran then would write that document into the open card.
let _borrowedState = 0;

// Recognise a binder without mistaking it for a single build. Checked by shape
// as well as by `kind`, so a file hand-assembled from the docs still opens; the
// `kind` is what stops a one-network .nettopo being read as an empty binder.
function binderFromImported(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.kind !== BINDER_KIND || !Array.isArray(parsed.sites)) return null;
    const sites = parsed.sites.filter((s) => s && typeof s === 'object' && s.doc && Array.isArray(s.doc.nodes));
    return { sites, exported: parsed.exported || null, dropped: parsed.sites.length - sites.length };
}

// Merge, never replace. Someone importing a colleague's binder is adding sites
// to their own work, not throwing it away, and a binder that overwrote the
// library would be one misclick from destroying an engagement. Same id means
// the same network, and the newer `updated` wins — so a binder round-tripped
// through a second machine converges instead of forking.
function importBinderSites(sites) {
    const lib = loadLibrary();
    const result = { added: 0, updated: 0, kept: 0, skipped: 0, storedIds: [] };
    sites.forEach((site) => {
        // binderFromImported filters the file path, but this is also the door
        // the guest shelf's Keep comes through, and that input has not been
        // re-validated. One unusable entry must cost that entry, never the
        // whole merge — the same rule the file path already follows.
        if (!site || typeof site !== 'object' || !site.doc || !Array.isArray(site.doc.nodes)) { result.skipped++; return; }
        const id = typeof site.id === 'string' && site.id ? site.id : mintLibraryId();
        const mine = lib[id];
        const theirs = {
            id,
            name: String(site.name || '').trim() || t('Untitled network'),
            doc: site.doc,
            created: Number.isFinite(site.created) ? site.created : Date.now(),
            // 0, not Date.now(): an untimestamped site is the least you can know
            // about recency, and stamping it "now" made it beat — and silently
            // replace — every real local entry with the same id. A hand-written
            // file is an expected input, and so is a stranger's link.
            updated: Number.isFinite(site.updated) ? site.updated : 0
        };
        if (site.template === true) theirs.template = true;
        if (site.template === true && site.block === true) theirs.block = true;
        if (!mine) { lib[id] = theirs; result.added++; result.storedIds.push(id); return; }
        if ((theirs.updated || 0) > (mine.updated || 0)) { lib[id] = theirs; result.updated++; result.storedIds.push(id); return; }
        result.kept++;
    });
    return persistLibrary(lib) ? result : null;
}

// ---- The guest shelf: a binder someone sent you ----
// A binder link arrives by someone else's click, so nothing it carries enters
// this browser's library until the visitor says so. It decodes onto a shelf
// rendered beside the saved networks — same card renderer, different section —
// and each card, or the whole shelf, can be Kept, which runs the same
// importBinderSites() merge the file drop does. Three doors, one merge.
//
// sessionStorage, not localStorage: the shelf has to survive a refresh (a link
// is often reloaded before it is read) without ever becoming permanent. Closing
// the tab is the same as dismissing it, which is the correct default for
// something a stranger sent.
const GUEST_BINDER_KEY = 'nettopo_guest_binder';
let _guestBinder = null;
let _guestError = '';

const guestSites = () => (_guestBinder && _guestBinder.sites) || [];
const guestError = () => _guestError;

function setGuestBinder(binder) {
    _guestBinder = binder;
    try {
        if (binder) sessionStorage.setItem(GUEST_BINDER_KEY, JSON.stringify(binder));
        else sessionStorage.removeItem(GUEST_BINDER_KEY);
    } catch (e) { /* private mode: the shelf simply will not survive a refresh */ }
}

// Re-validated through binderFromImported rather than trusted: sessionStorage is
// writable by anything else running on this origin, and this is the one place a
// stranger's payload is read back.
function restoreGuestBinder() {
    try {
        const raw = sessionStorage.getItem(GUEST_BINDER_KEY);
        if (!raw) return;
        const parsed = binderFromImported(JSON.parse(raw));
        if (parsed && parsed.sites.length) _guestBinder = { sites: withGuestIds(parsed.sites), exported: parsed.exported };
    } catch (e) { /* unreadable: no shelf, no error — the link is simply gone */ }
}

// Cards are addressed by id — Keep, open, and the removal above all key on it —
// but the file format does not require one, so a hand-assembled binder can
// arrive without.
//
// Minted from the site's content, not its position. Keep stores the card under
// this id, so a positional 'guest0' became a permanent library id that the
// next id-less binder minted again for a different network: keeping that one
// either overwrote the first or was refused as "already have a newer copy".
// A content id is stable for the life of the shelf (the shelf stores the
// minted ids), and two shelves only share one when they carry the same network,
// where newer-wins treating them as one is the right answer.
//
// The same network twice on one shelf would share an id and so a card, so a
// repeat gets its position appended.
function withGuestIds(sites) {
    const used = new Set();
    return sites.map((site, i) => {
        if (typeof site.id === 'string' && site.id) { used.add(site.id); return site; }
        let id = `guest-${contentHash(JSON.stringify([site.name || '', site.doc]))}`;
        if (used.has(id)) id += `-${i}`;
        used.add(id);
        return Object.assign({}, site, { id });
    });
}

// Two FNV-1a passes with different offsets, so the id is 64 bits rather than
// 32: plenty to keep unrelated networks apart, with no async crypto needed.
function contentHash(text) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193);
        b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
    }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

function dismissGuestBinder() {
    _guestError = '';
    setGuestBinder(null);
    if (landingIsOpen()) renderLanding();
}

// Open a 'b~' link. Nothing here may alert(): boot awaits load() before the
// editor is revealed, so a modal would freeze a blank page. Failures render
// into the shelf's own status line instead.
async function openBinderLink(frag) {
    let json = null;
    try { json = await decodeBinderFragment(frag); } catch (e) { /* reported below as unreadable */ }
    openBinderPayload(json);
}

// The shelf half of a binder link, shared with a sealed one (js/share.js),
// which arrives here already decrypted and decompressed.
function openBinderPayload(json) {
    _guestError = '';
    try {
        const parsed = binderFromImported(JSON.parse(json));
        if (!parsed) _guestError = t('That binder link could not be read.');
        else if (!parsed.sites.length) _guestError = t('That binder link carried no networks.');
        else setGuestBinder({ sites: withGuestIds(parsed.sites), exported: parsed.exported });
    } catch (e) {
        _guestError = t('That binder link could not be read.');
    }
    // A failed link must not leave the previous one's shelf standing under an
    // error message about this one.
    if (_guestError) setGuestBinder(null);
    // The canvas is whatever it was — empty on a fresh boot. Dismissing the
    // landing from here therefore means "start empty", exactly as a bare URL does.
    openLanding(state.nodes.length === 0);
}

function keepGuestSites(sites) {
    const result = importBinderSites(sites);
    if (!result) { showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err'); return; }
    // Only the cards that were actually stored leave the shelf. One that lost
    // the newer-wins comparison, or that could not be read, was NOT kept — and
    // once the landing is dismissed the shelf is the only remaining copy, so
    // clearing it on the strength of having been asked would lose the document.
    const stored = new Set(result.storedIds);
    const left = guestSites().filter((x) => !stored.has(x.id));
    setGuestBinder(left.length ? { sites: left, exported: _guestBinder && _guestBinder.exported } : null);
    renderLanding();
    if (result.added + result.updated === 0) {
        showToast(t('Nothing was kept — you already have a newer copy of {n} of these.', { n: result.kept }));
    }
}

// Open one shelved network without keeping it. pushState rather than replaceState
// so Back returns to the shelf: the visitor has not adopted anything, and losing
// the other sites by looking at one would be a trap.
//
// Not kept, so not autosaved: the shelf's Keep, or Keep this network on the
// canvas, is the visitor saying so. The site's id comes along as the
// document's identity, so keeping it from the canvas is the same card Keep on
// the shelf would have made.
async function openGuestSite(id) {
    const site = guestSites().find((x) => x.id === id);
    if (!site) { renderLanding(); return; }
    if (!_landingBoot && !(await okToReplace(t('Replace the network on screen with "{name}"?', { name: site.name })))) return;
    replaceDocument(site.doc, { origin: 'guest', push: true, docId: site.id, docUpdated: site.updated });
    landingHandledDocument();
}

// ---- Making one ----
// The link itself is built by the share dialog (js/share.js), which offers to
// seal it first. What stays here is the part only a binder has: whether this
// browser can compress one at all.
async function copyBinderLink() {
    const file = binderFile();
    if (!file.sites.length) { showToast(t('Nothing to share yet.')); return; }
    if (!canMakeBinderLink()) {
        if (await askConfirm(t('This browser cannot make a binder link. Export the binder file instead?'), { ok: t('Back up all') })) exportBinder();
        return;
    }
    openShareDialog('binder');
}

// ---- "You have not backed this up" ----
// The honest counterweight to a card list that looks exactly like cloud
// storage. Not a modal and not a nag: a line on the landing that can say how
// long it has been and how many networks have changed since, which is the only
// form of this warning anyone reads twice.
const BINDER_EXPORT_KEY = 'nettopo_binder_exported';

// The record is {at, seen}, where `seen` maps each exported network's id to the
// `updated` it had at the time. Deliberately not a bare timestamp compared
// against each entry: two saves and an export inside the same millisecond are
// indistinguishable by time, and whichever way the comparison is written it is
// wrong half of the time — it either nags immediately after an export or misses
// a save made right after one. Naming what went into the file answers the
// question exactly, and it also gets a network *added* since the export right,
// which a timestamp cannot tell from one that was in it.
//
// One Back up, two sizes. The binder file backs up every card; a network's own
// build file (Export > Back up this network) backs up that one. Either counts:
// they used to be tracked apart, so a network just exported on its own still
// read as "changed since" on the landing. A build file is recorded in `files`,
// never in `seen`: `seen` is also what binderPayloadOver() reads to tell a
// network deleted here from one added elsewhere, and only a binder export
// knows what went into the binder.
function loadLastExport() {
    try {
        const v = JSON.parse(localStorage.getItem(BINDER_EXPORT_KEY) || 'null');
        if (!(v && Number.isFinite(v.at) && v.seen && typeof v.seen === 'object')) return null;
        if (!v.files || typeof v.files !== 'object' || Array.isArray(v.files)) v.files = {};
        return v;
    } catch (e) { return null; }
}
function writeLastExport(record) {
    try { localStorage.setItem(BINDER_EXPORT_KEY, JSON.stringify(record)); } catch (e) { /* private mode */ }
}
// Each network that went into the file is also its card's new baseline for
// "changes since the last back-up" (js/changes.js): what went in the file,
// which is the open network's live edits when storage refused them.
function recordBinderExport(sites) {
    const seen = {};
    (sites || libraryEntries()).forEach((e) => { seen[e.id] = e.updated || 0; takeSnapshot(e.id, 'backup', e.doc); });
    const last = loadLastExport();
    writeLastExport({ at: Date.now(), seen, files: last ? last.files : {} });
}
function recordBuildExport(id, updated) {
    if (!id) return;
    const last = loadLastExport();
    writeLastExport({ at: Date.now(), seen: last ? last.seen : {}, files: Object.assign({}, last && last.files, { [id]: updated || 0 }) });
}
// Backed up when the version on record is the version the card holds now.
const isBackedUp = (e, last) => {
    const u = e.updated || 0;
    return last.seen[e.id] === u || last.files[e.id] === u;
};

// What the landing says under the cards, and whether it is a nudge. Silent
// about "0 changed": a line that appears when there is nothing to do trains
// people to ignore it. `stale` is worked out from the same count as the
// words — it used to compare against the export time instead, so the line
// could be highlighted while saying everything was backed up.
function backupStatus() {
    const entries = libraryEntries();
    if (!entries.length) return null;
    const last = loadLastExport();
    if (!last) return { text: t('Not backed up yet — a back-up file is the only copy that survives a cleared cache.'), stale: true };
    const stale = entries.filter((e) => !isBackedUp(e, last)).length;
    if (!stale) return { text: t('Backed up {when}.', { when: libraryWhen(last.at) }), stale: false };
    return { text: t(stale === 1
        ? 'Backed up {when} — {n} network has changed since.'
        : 'Backed up {when} — {n} networks have changed since.', { when: libraryWhen(last.at), n: stale }), stale: true };
}
function binderStatus() { const s = backupStatus(); return s ? s.text : null; }

// ---- Reading a document that is not the one on screen ----
// topologyFindings() and reportSubnets() read state.nodes and state.links and
// nothing else, so the honest way to ask them about a stored network is to *be*
// that network for the length of one synchronous call — no second copy of the
// checks to keep in step, and a card can never claim something the Diagnostics
// panel would contradict. Nothing in here touches the DOM, so no render can
// observe the swap, and the restore sits in a finally: a check that throws on a
// malformed stored doc must not strand the editor holding someone else's
// diagram.
//
// Out of any lookup pass the caller has open (withoutLookupPass, js/model.js):
// inside one, getNode and currentDiagnosis would answer from the canvas's
// indexes and diagnosis, not this document's. fn may open its own over the
// borrowed arrays. The state goes back first, then the pass.
function withDoc(doc, fn) {
    return withoutLookupPass(() => {
        const held = { nodes: state.nodes, links: state.links, networks: state.networks, groups: state.groups, wifi: state.wifi, accepted: state.accepted, pinned: state.pinned, expectedLife: state.expectedLife, columns: state.columns, tableView: state.tableView, annotations: state.annotations, report: state.report };
        _borrowedState++;
        try {
            // The same reader replaceDocument() uses, so a stored v1 card is
            // migrated here exactly as it would be on opening, and a current one
            // only normalized. The survey header comes along: the binder report
            // reads it per site to print who each building was surveyed for, and
            // leaving it behind would have every site carry the header of
            // whatever happened to be on the canvas.
            if (!isDocShape(doc)) throw new Error('not a document');
            loadDocState(doc);
            state.annotations = [];
            return fn();
        } finally {
            _borrowedState--;
            state.nodes = held.nodes; state.links = held.links; state.networks = held.networks; state.groups = held.groups; state.wifi = held.wifi; state.accepted = held.accepted; state.pinned = held.pinned; state.expectedLife = held.expectedLife;
            state.columns = held.columns; state.tableView = held.tableView;
            state.annotations = held.annotations; state.report = held.report;
        }
    });
}

// What a card says about a network. Deliberately not a thumbnail: a topology
// shrunk to 200px is a grey smudge, while the thing that actually tells you
// which card to open is the state you left it in — three errors outstanding, or
// none. Computed live rather than stored at save time, so a card cannot go
// stale against its own document.
//
// Remembered by the document's own text, though: the cards are re-read from
// storage on every render, so the same document arrives as a new object each
// time, and a card stored by an older build is migrated (js/model.js
// MIGRATIONS) every time it is summarised. Keyed by content, a remembered
// summary cannot belong to a different document, and an edited card is a new
// key. The findings read nothing but the document (the checks never see the
// trace port), so the answer is the same however often it is asked that day.
//
// raw: the stored text of the card the doc came from (libraryRawOf), which a
// library card on the landing passes so that a remembered summary costs no
// serializing at all; the card's text is the key as it is. A shared (guest)
// site passes none: its id may be a library card's, its text is not. Without
// it the key is the document serialized. Both are remembered for one day
// (todayISO): what has lapsed and what is due are counted by the date, so a
// summary from yesterday is not today's. Kept apart, so a card's text can
// never be taken for a document's.
const _summaryMemo = new Map();      // doc JSON -> { day, out }
const _summaryRawMemo = new Map();   // card text -> { day, out }
const SUMMARY_MEMO_MAX = 48;
function librarySummary(doc, raw) {
    const day = todayISO();
    const memo = typeof raw === 'string' ? _summaryRawMemo : _summaryMemo;
    let key = typeof raw === 'string' ? raw : null;
    if (key === null) { try { key = JSON.stringify(doc); } catch (e) { key = null; } }
    const hit = key !== null ? memo.get(key) : null;
    if (hit && hit.day === day) return { ...hit.out };
    try {
        // One pass over the borrowed document, opened inside the swap (never
        // around withDoc, which closes the caller's): the findings and the
        // subnets share its indexes.
        const out = withDoc(doc, () => withLookupPass(() => {
            // What is open: a finding accepted with a reason is not counted
            // on the card, as it is not in the tab or the report's totals.
            const c = findingCounts(topologyFindings());
            return {
                devices: state.nodes.length,
                subnets: reportSubnets().length,
                critical: c.critical,
                advisory: c.advisory
            };
        }));
        if (key !== null) {
            memo.delete(key);
            if (memo.size >= SUMMARY_MEMO_MAX) memo.delete(memo.keys().next().value);
            memo.set(key, { day, out });
        }
        return { ...out };
    } catch (e) {
        // A stored doc old enough or broken enough to fail the checks should
        // still be openable — it just cannot be summarised.
        return { devices: (doc.nodes || []).length, subnets: 0, critical: 0, advisory: 0, unreadable: true };
    }
}

// Coarse on purpose: "3d ago" is what you need to pick a card, and an exact
// timestamp is noise. Past a month the date is more use than a running count.
function libraryWhen(ts) {
    if (!ts) return '';
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return t('just now');
    if (mins < 60) return t('{n}m ago', { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('{n}h ago', { n: hours });
    const days = Math.floor(hours / 24);
    if (days < 30) return t('{n}d ago', { n: days });
    return new Date(ts).toLocaleDateString();
}

// ---- The landing page ----
// Shown on a bare URL only. Every other way in — a shared "#~" link, a mid-edit
// reload, '#simple' / '#setup', an intake link carrying '?profile=' — is
// someone arriving with a document or a job already chosen, and putting a menu
// in front of them would be pure obstruction. See shouldShowLanding().
//
// It lives inside the editor page rather than at its own URL: the chrome, the
// locale and the whole app are already booted, so opening a card is a state
// change and not a page load, and there is only one place where "the link is
// the document" has to be true.
let _landingBoot = false;   // opened by boot (dismissing means "start empty"), vs. opened from the menu

function shouldShowLanding() {
    if (window.location.hash || liveEntry()) return false;
    const params = new URLSearchParams(window.location.search);
    // '?lang=' is presentation and stays on the landing — a Spanish reporter
    // opening the bare site gets a Spanish landing. '?profile=' and the legacy
    // '?simple' are routing: they name the job, so they skip it.
    return !(params.has('profile') || params.has('simple'));
}

function openLanding(fromBoot) {
    _landingBoot = !!fromBoot;
    flushAutosave();   // the open network's card shows its last edit
    renderLanding();
    // Asking IndexedDB is async and renderLanding() is not, so the binding line
    // arrives a tick late rather than holding the page up for it.
    refreshBinderBinding().then(() => { if (landingIsOpen()) renderLanding(); });
    document.getElementById('landing').classList.remove('hidden');
    document.body.classList.add('landing-open');
    const first = document.querySelector('#landing .landing-drop-btn.primary');
    if (first) first.focus();
}

// Dismissing without choosing is itself a choice: at boot there is no document
// behind the overlay, so it means "start empty" and the blank canvas gets its
// own link like any other. Opened from the menu it is only a switcher, and the
// diagram already on screen must survive being looked away from.
//
// "Start empty" is starting a network here, so it is kept, like New network:
// its first device makes it a card (claimEmptyDocument in js/app.js).
function closeLanding() {
    document.getElementById('landing').classList.add('hidden');
    document.body.classList.remove('landing-open');
    if (_landingBoot) { _landingBoot = false; claimEmptyDocument(); save(); renderDocBar(); }
}

function landingIsOpen() { return !document.getElementById('landing').classList.contains('hidden'); }

// The landing stepping aside because a document arrived by another door — a
// card, a file, the example. Distinct from a plain dismissal, which still owes
// the blank canvas its save(); here the document has already been saved.
function landingHandledDocument() { _landingBoot = false; closeLanding(); }

function renderLanding() {
    const list = document.getElementById('landingCards');
    const tplList = document.getElementById('landingTemplateCards');
    const entries = libraryEntries();
    const networks = entries.filter((e) => !e.template);
    const templates = entries.filter((e) => e.template);
    // With nothing saved, the section and its storage warning would both be
    // talking about an empty grid; one muted line under the chips says the same
    // thing and teaches that saving exists. Once there are cards, the warning
    // is no longer premature and belongs under them.
    document.getElementById('landingEmpty').classList.toggle('hidden', entries.length > 0);
    document.getElementById('landingSaved').classList.toggle('hidden', entries.length === 0);
    // Reorders and compacts the page for someone who came back for their own
    // work rather than for the pitch — see .has-saved in css/app.css.
    document.getElementById('landing').classList.toggle('has-saved', entries.length > 0 || guestSites().length > 0);
    list.innerHTML = '';
    networks.forEach((entry) => list.appendChild(landingCard(entry)));
    tplList.innerHTML = '';
    templates.forEach((entry) => tplList.appendChild(landingCard(entry)));
    document.getElementById('landingTemplatesHead').classList.toggle('hidden', !templates.length);

    renderGuestSection();
    renderUserTemplates();   // the rail's list reads the same store

    const target = document.getElementById('binderTarget');
    const bound = binderBinding();
    target.hidden = !bound.bound;
    if (bound.bound) {
        document.getElementById('binderTargetName').textContent = t('Saves to {name}', { name: bound.name });
    }

    const status = document.getElementById('binderStatus');
    const backup = backupStatus();
    status.textContent = backup ? backup.text : '';
    status.classList.toggle('stale', !!backup && backup.stale);
}

// ---- Binding the binder to a real file (File System Access API) ----
// After one save picker, "Back up all" writes to THAT file: no download
// folder, no "networks (3).json". Chrome and Edge only — Firefox does not
// implement it, and Safari exposes only the origin-private filesystem, which is
// invisible to the user and no safer than localStorage. So this is a pure
// enhancement: every browser without it behaves exactly as it did, with no dead
// control and no error, because downloadBinderFile() is the floor of every path.
//
// The handle goes in IndexedDB because localStorage can only hold strings and a
// FileSystemFileHandle is a live object. Every wrapper below RESOLVES rather
// than rejects — a browser with IndexedDB blocked must degrade to "not bound",
// never to a broken button.
const HANDLE_DB = 'nettopo_handles';
const HANDLE_STORE = 'handles';
const BINDER_HANDLE_KEY = 'binder';

// The timeout is not paranoia: an upgrade held open by another tab fires
// neither success nor error, and without a deadline exportBinder() would await
// forever with _binderBusy stuck true — the button dead for the rest of the
// session. Giving up resolves to "not bound", which is already the designed
// fallback, so the worst case is a download instead of a write.
const HANDLE_DB_TIMEOUT = 1500;
function _handleDb() {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };
        setTimeout(() => done(null), HANDLE_DB_TIMEOUT);
        let req;
        try { req = indexedDB.open(HANDLE_DB, 1); } catch (e) { done(null); return; }
        req.onupgradeneeded = () => { try { req.result.createObjectStore(HANDLE_STORE); } catch (e) { /* already there */ } };
        req.onsuccess = () => done(req.result);
        req.onerror = () => done(null);
        req.onblocked = () => done(null);
    });
}
function _idb(mode, fn) {
    return _handleDb().then((db) => {
        if (!db) return null;
        return new Promise((resolve) => {
            let tx;
            try { tx = db.transaction(HANDLE_STORE, mode); } catch (e) { resolve(null); return; }
            const req = fn(tx.objectStore(HANDLE_STORE));
            if (!req) { tx.oncomplete = () => resolve(null); tx.onerror = () => resolve(null); return; }
            req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
            req.onerror = () => resolve(null);
        });
    }).catch(() => null);
}
// The three operations go through one object so a test can substitute an
// in-memory store. That is not gratuitous seam-making: the headless runner
// gives its pages no IndexedDB (tests/README.md), and the logic worth
// asserting — when to bind, when to write, when to fall back to a download —
// all sits above the store rather than inside it. The IndexedDB
// implementation itself is hand-verified; see tests/README.md.
let _handleStore = {
    get: () => _idb('readonly', (st) => st.get(BINDER_HANDLE_KEY)),
    put: (h) => _idb('readwrite', (st) => st.put(h, BINDER_HANDLE_KEY)),
    del: () => _idb('readwrite', (st) => st.delete(BINDER_HANDLE_KEY)),
};
const setHandleStore = (store) => { const prev = _handleStore; _handleStore = store; return prev; };

const binderHandle = () => Promise.resolve(_handleStore.get()).catch(() => null);
const putBinderHandle = (h) => Promise.resolve(_handleStore.put(h)).catch(() => null);
const clearBinderHandle = () => Promise.resolve(_handleStore.del()).catch(() => null);

// Read at call time, never captured: a test that stubs the picker away has to
// be able to, and so does a browser that gains the API mid-session.
const binderCanBind = () => typeof window.showSaveFilePicker === 'function';

// A user gesture is required to re-request, so this is only ever reached from a
// click — never from a page load, which is why nothing here runs at boot.
async function ensureBinderPermission(handle) {
    if (!handle || typeof handle.queryPermission !== 'function') return false;
    try {
        if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
        return await handle.requestPermission({ mode: 'readwrite' }) === 'granted';
    } catch (e) { return false; }
}

async function writeBinderTo(handle, payload) {
    const w = await handle.createWritable();
    try { await w.write(JSON.stringify(payload, null, 2)); await w.close(); return true; }
    catch (e) { try { await w.abort(); } catch (e2) { /* already gone */ } throw e; }
}

async function readBinderFrom(handle) {
    try {
        const text = await (await handle.getFile()).text();
        if (!text.trim()) return null;
        return binderFromImported(JSON.parse(text));
    } catch (e) { return null; }
}

// Pick a file to bind to. If it already holds someone's binder, that binder is
// merged in first rather than overwritten: the user asked where to keep their
// networks, not to destroy what was already there.
async function adoptBinderFile() {
    let handle;
    try {
        handle = await window.showSaveFilePicker({
            suggestedName: BINDER_FILENAME,
            types: [{ description: 'Topo binder', accept: { 'application/json': ['.json'] } }],
        });
    } catch (e) { return null; }   // AbortError: the user changed their mind, which is not a failure
    const existing = await readBinderFrom(handle);
    if (existing && existing.sites.length) {
        const mine = new Set(Object.keys(loadLibrary()));
        const unknown = existing.sites.filter((x) => !mine.has(x.id));
        const known = existing.sites.filter((x) => mine.has(x.id));
        // Networks already in this library are merged unconditionally, on the
        // same newer-wins rule as every other door: they cannot overwrite
        // anything newer, and skipping them was how a file edited on another
        // machine got silently replaced by this one's older copy. Only ADDING
        // networks the user has never seen is a question worth asking.
        if (known.length) importBinderSites(known);
        // Declining (or a merge that could not be stored) leaves them out of
        // the LIBRARY, never out of the FILE: exportBinder() writes through
        // binderPayloadOver(), which carries them across. Returning the handle
        // and letting binderFile() overwrite the file was how "no, do not add
        // them here" came to mean "delete them from disk".
        if (unknown.length
            && await askConfirm(t('That file already holds {n} networks you do not have. Add them to this browser?', { n: unknown.length }), { ok: t('Add them') })) {
            importBinderSites(unknown);
        }
    }
    return handle;
}

// What to write over a file that may already hold networks. The library is the
// base; on top of it, every network the file holds that this browser does not
// is carried through untouched. Without this the bound file was overwritten
// blind on every export, so a network another machine had added to the same
// (synced) file was deleted by the next export from this one.
//
// The one network NOT carried is one this browser deliberately deleted: it was
// in this browser's last export, the file still holds that exact version, and
// the library no longer has it. Carrying it would make deleting a network
// impossible once a binder is bound. A copy edited elsewhere since then is a
// different version, so it is carried: an edit somebody else made outranks a
// delete made before it.
//
// Networks the file holds that the library ALSO holds go through the usual
// newer-wins merge first, so a newer copy from the file is read in rather than
// overwritten by this browser's older one: the same rule adoptBinderFile()
// applies when it binds.
//
// If that merge cannot be stored, the newer file copy is still what goes back
// into the file: a full quota must not turn an export into an overwrite.
//
// Returns the payload and, separately, the sites that came from the library, so
// the export record names only what this browser wrote. Recording the carried
// ones too would make them look like "exported, then deleted here" next time,
// and they would be dropped.
function binderPayloadOver(existing) {
    if (existing && existing.sites.length) {
        const mine = loadLibrary();
        const known = existing.sites.filter((x) => typeof x.id === 'string' && Object.prototype.hasOwnProperty.call(mine, x.id));
        if (known.length) importBinderSites(known);
    }
    const file = binderFile();
    const ownSites = file.sites.slice();
    if (existing && existing.sites.length) {
        const have = new Set(ownSites.map((x) => x.id));
        const last = loadLastExport();
        const deletedHere = (x) => !!last && typeof x.id === 'string'
            && Object.prototype.hasOwnProperty.call(last.seen, x.id)
            && last.seen[x.id] === (Number.isFinite(x.updated) ? x.updated : 0);
        const updatedOf = (x) => (Number.isFinite(x.updated) ? x.updated : 0);
        const at = new Map(file.sites.map((x, i) => [x.id, i]));
        const replaced = new Set();
        existing.sites.forEach((x) => {
            if (typeof x.id === 'string' && have.has(x.id)) {
                // The merge above should already have read a newer file copy
                // in. When it could not be stored (a full quota), the library
                // still holds the older one, and writing that would overwrite
                // the newer copy on disk. Newer-wins applies to the file even
                // when the library could not keep up.
                const i = at.get(x.id);
                if (updatedOf(x) > updatedOf(file.sites[i])) { file.sites[i] = x; replaced.add(x.id); }
                return;
            }
            if (deletedHere(x)) return;
            file.sites.push(x);
        });
        // Not written by this browser, so not recorded as exported by it.
        if (replaced.size) return { file, ownSites: ownSites.filter((x) => !replaced.has(x.id)) };
    }
    return { file, ownSites };
}

// What the landing says about where the binder goes. Cached, because
// renderLanding() is synchronous and asking IndexedDB is not.
let _binderBinding = { bound: false, name: '' };
async function refreshBinderBinding() {
    if (!binderCanBind()) { _binderBinding = { bound: false, name: '' }; return _binderBinding; }
    const h = await binderHandle();
    _binderBinding = h ? { bound: true, name: h.name || BINDER_FILENAME } : { bound: false, name: '' };
    return _binderBinding;
}
const binderBinding = () => _binderBinding;

// Dated, like every download (docFileStem in js/app.js): a folder of back-ups
// sorts by day instead of collecting "networks (7).json". The bound file keeps
// the name it was given, because it is written over in place.
const binderDownloadName = () => BINDER_FILENAME.replace(/^networks/, `networks-${todayISO()}`);
function downloadBinderFile(file) {
    downloadJson(file, binderDownloadName());
}

// Write the whole library to a file and remember that it happened — the
// remembering is the point, because it is what lets the landing say how long it
// has been rather than only that a button exists.
let _binderBusy = false;
async function exportBinder() {
    if (_binderBusy) return;
    // binderFile() flushes, and counts the open network even when storage
    // refused it, so a library that could not be written can still be backed up.
    if (!binderFile().sites.length) { showToast(t('Nothing to export yet.')); return; }
    _binderBusy = true;
    try {
        // Three paths, and the download is the floor of all of them: a browser
        // without the API, a permission that was refused, a write that failed —
        // all still hand over the file.
        if (binderCanBind()) {
            let handle = await binderHandle();
            // adoptBinderFile() may merge the picked file's own networks into
            // the library, so the snapshot to write CANNOT be taken before it:
            // doing that wrote a pre-merge binder back over the file and
            // deleted from it exactly the networks that had just been read in.
            if (!handle) handle = await adoptBinderFile();
            if (handle && await ensureBinderPermission(handle)) {
                // Read at write time, every time: the file may have changed
                // since it was bound (another machine, a synced folder).
                const { file, ownSites } = binderPayloadOver(await readBinderFrom(handle));
                try {
                    await writeBinderTo(handle, file);
                    await putBinderHandle(handle);
                    recordBinderExport(ownSites);
                    await refreshBinderBinding();
                    if (landingIsOpen()) renderLanding();
                    return;
                } catch (e) { console.warn('Binder: could not write to the bound file; falling back to a download.', e); }
            }
        }
        const file = binderFile();
        downloadBinderFile(file);
        recordBinderExport(file.sites);   // what went in the file, not what the library holds now
        if (landingIsOpen()) renderLanding();
    } finally { _binderBusy = false; }
}

// Change where the binder goes, or bind one for the first time. Without this
// there is no way out of a binding short of clearing site data.
async function rebindBinderFile() {
    if (!binderCanBind()) return;
    const handle = await adoptBinderFile();
    if (!handle) return;
    await putBinderHandle(handle);
    await refreshBinderBinding();
    if (landingIsOpen()) renderLanding();
}

// A binder arriving from a file. Merging, not replacing — see importBinderSites.
// Returns whether the file was a binder at all, so the single-build path can
// take over when it was not.
function applyImportedBinder(parsed) {
    const binder = binderFromImported(parsed);
    if (!binder) return false;
    const result = importBinderSites(binder.sites);
    if (!result) { showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err'); return true; }
    if (landingIsOpen()) renderLanding();
    renderUserTemplates();
    showToast(t('Binder loaded: {added} added, {updated} updated, {kept} already up to date.', result)
        + (binder.dropped ? ' ' + t('{n} entry in the file could not be read and was skipped.', { n: binder.dropped }) : ''), 'ok');
    return true;
}

function renderGuestSection() {
    const section = document.getElementById('landingShared');
    const list = document.getElementById('guestCards');
    const status = document.getElementById('guestBinderStatus');
    const sites = guestSites();
    section.classList.toggle('hidden', !sites.length && !_guestError);
    list.innerHTML = '';
    sites.forEach((site) => list.appendChild(landingCard(site, { guest: true })));
    status.textContent = _guestError || t(sites.length === 1
        ? '{n} network was shared with you — it stays in this tab only until you keep it.'
        : '{n} networks were shared with you — they stay in this tab only until you keep them.', { n: sites.length });
    document.getElementById('guestKeepAllBtn').classList.toggle('hidden', sites.length < 2);
}

function landingCard(entry, opts = {}) {
    const s = librarySummary(entry.doc, opts.guest ? undefined : libraryRawOf(entry));
    // What changed since this card's last back-up or report (js/changes.js).
    // A shared card has no baseline here: it was never backed up from here.
    const changed = opts.guest ? '' : cardChangesText(cardChanges(entry));
    const card = document.createElement('div');
    card.className = `landing-card${opts.guest ? ' guest' : ''}${entry.template ? ' template' : ''}${changed ? ' has-changes' : ''}`;
    card.dataset.id = entry.id;

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'landing-card-open';
    open.title = entry.block ? t('Open this block to edit it') : entry.template ? t('Open this template to edit it') : t('Open this network');
    // A block is a piece of a network: its gateway is usually outside it, so
    // its own findings would only say that. It shows what it is, not those.
    const badges = (entry.template ? `<span class="landing-badge tpl">${escapeHtml(entry.block ? t('Block') : t('Template'))}</span>` : '') + (entry.block ? '' : s.unreadable
        ? `<span class="landing-badge warn">${escapeHtml(t('Could not read'))}</span>`
        : (s.critical || s.advisory
            ? `${s.critical ? `<span class="landing-badge bad">⛔ ${s.critical}</span>` : ''}${s.advisory ? `<span class="landing-badge warn">⚠ ${s.advisory}</span>` : ''}`
            : `<span class="landing-badge good">✓ ${escapeHtml(t('No findings'))}</span>`));
    open.innerHTML = `
        <span class="landing-card-name">${escapeHtml(entry.name)}</span>
        <span class="landing-card-stats">${escapeHtml(t(s.devices === 1 ? '{n} device' : '{n} devices', { n: s.devices }))} · ${escapeHtml(t(s.subnets === 1 ? '{n} subnet' : '{n} subnets', { n: s.subnets }))}</span>
        <span class="landing-card-badges">${badges}</span>${changed ? `
        <span class="landing-card-changes">± ${escapeHtml(changed)}</span>` : ''}
        <span class="landing-card-when">${escapeHtml(libraryWhen(entry.updated))}</span>`;
    open.onclick = () => (opts.guest ? openGuestSite(entry.id) : openFromLibrary(entry.id));
    card.appendChild(open);

    if (opts.guest) {
        const tools = document.createElement('div');
        tools.className = 'landing-card-tools guest';
        const keep = document.createElement('button');
        keep.type = 'button'; keep.className = 'landing-tool wide';
        keep.textContent = t('Keep');
        keep.title = t('Keep in this browser');
        keep.onclick = () => keepGuestSites([entry]);
        tools.appendChild(keep);
        card.appendChild(tools);
        return card;
    }

    // Rename, duplicate and delete sit outside the open button because a
    // button cannot nest inside a button — and they stay reachable by keyboard
    // rather than appearing on hover alone.
    const tools = document.createElement('div');
    tools.className = 'landing-card-tools';
    const tool = (glyph, label, onclick) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'landing-tool'; b.textContent = glyph;
        b.title = label; b.setAttribute('aria-label', `${label} — ${entry.name}`);
        b.onclick = onclick;
        tools.appendChild(b);
        return b;
    };
    // The list behind the card's "± n changes" line. A tool rather than a
    // tooltip on the line: a tooltip never opens on a phone.
    if (changed) tool('±', t('What changed'), () => showCardChanges(entry));
    tool('✎', t('Rename'), async () => {
        const name = await askPrompt(t('Rename network — new name:'), { title: t('Rename'), value: entry.name, ok: t('Rename') });
        if (name === null) return;
        if (!libraryRename(entry.id, name)) showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err');
        renderLanding(); renderDocBar();
    });
    // A template is used by duplicating it, so on its card this is the main
    // action, worded as such; on a network card it starts the next survey
    // from this one.
    // A block is a piece of a network, used from the Blocks tab: a network
    // made of it alone is not what anybody keeps it for.
    if (!entry.block) tool('⧉', entry.template ? t('New network from this template') : t('Duplicate'), () => {
        const id = libraryDuplicate(entry.id);
        if (!id) { showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err'); return; }
        renderLanding();
        showToast(t('Added "{name}" to your networks.', { name: libraryEntry(id).name }), 'ok');
    });
    tool('✕', t('Delete'), async () => {
        if (!(await askConfirm(t('Delete saved network "{name}"? This cannot be undone.', { name: entry.name }), { ok: t('Delete'), danger: true }))) return;
        libraryDelete(entry.id);
        // The network on screen stays, no longer kept: it stops saving into a
        // card that is gone, and the bar offers to keep it again.
        if (state.libraryId === entry.id) releaseDocument();
        renderLanding();
    });
    card.appendChild(tools);
    return card;
}

// ---- Acting on a card ----
// Every path below goes through replaceDocument() (js/app.js), which puts the
// document in state, writes the history entry and starts a fresh undo
// timeline. A card is a kept network, so it opens kept: it saves itself.
async function openFromLibrary(id) {
    const entry = libraryEntry(id);
    if (!entry) { renderLanding(); return; }
    // The card already open: nothing to replace, and replacing it would throw
    // its undo history away for nothing.
    if (state.libraryId === id && !state.readOnly && !_landingBoot) { landingHandledDocument(); return; }
    // Nothing to lose behind the boot landing; from the menu there may be an
    // hour of work under the overlay, unless it is kept (and so saved).
    if (!_landingBoot && !(await okToReplace(t('Replace the network on screen with "{name}"?', { name: entry.name })))) return;
    replaceDocument(entry.doc, { libraryId: entry.id, origin: 'library' });
    landingHandledDocument();
}

// "Start a new network": a blank canvas that is a document from the first
// moment, and kept: its first device makes it a card. replaceDocument() gives
// it its own history entry, so it can be shared and reloaded before a single
// device is placed. The File menu's New network (newNetwork in js/app.js) is
// the same thing.
function startNewNetwork() {
    replaceDocument(EMPTY_DOC, { origin: 'new', claim: true });
    landingHandledDocument();
}

// May the canvas be replaced without asking? Yes when there is nothing on it,
// or when it is kept and its last edit has just been written. Otherwise the
// visitor is asked, because closing it would lose it.
async function okToReplace(message) {
    if (!docHasContent()) return true;
    if (isKept() && flushAutosave()) return true;
    return askConfirm(message, { ok: t('Replace') });
}

// ---- Keeping a network ----
// "Save this network" used to be the only way to keep anything, two levels
// down in the File menu, and until someone found it the work lived only in
// this tab. Now most networks are kept from the start, and this is the one
// step left for the ones that are not: the example, a template, a link
// someone sent. It names the network, makes it a card, and from then on it
// saves itself.
//
// A network that already is a card here (a link of your own network, opened
// from the shelf or sent back by a colleague) is the same network, so the
// question is the merge question, not a name.
async function keepThisNetwork() {
    // A newer Topo's document is not re-saved through this build's serializer
    // (it would lose what this build does not know) nor stored raw (see
    // outgoingDoc). The build file is the way to keep a copy.
    if (readOnlyRefuses()) return null;
    if (!docHasContent()) { showToast(t('Nothing to keep yet — add some devices first.')); return null; }
    if (isKept()) {
        const ok = flushAutosave();
        showToast(ok ? t('This network is kept: it saves itself.') : t('Could not save — browser storage is unavailable (private mode or full).'), ok ? 'ok' : 'err');
        return ok ? state.libraryId : null;
    }
    let suggested = (state.report && typeof state.report.site === 'string' && state.report.site.trim()) || '';
    const known = state.docId && libraryEntry(state.docId);
    if (known) {
        const choice = await askAboutKnownCopy({ doc: serializeDoc(), updated: state.docUpdated }, known,
            { title: t('Keep this network'), copyLabel: t('Keep as a copy') });
        if (!choice) return null;
        if (choice === 'mine') { replaceDocument(known.doc, { libraryId: known.id, origin: 'library' }); return known.id; }
        if (choice === 'same' || choice === 'update') {
            const id = claimDocument(null, known.id);
            if (id) showToast(t('Kept "{name}". From now on it saves itself.', { name: libraryEntry(id).name }), 'ok');
            return id;
        }
        // A copy is a different network from here on: its own id, its own card.
        // The id is only let go once a name is given — cancelling the name
        // must leave this the same network it was, still recognised as that
        // card by a later Keep, export or link.
        suggested = t('{name} (copy)', { name: known.name });
    }
    const name = await askPrompt(t('Name this network:'), { title: t('Keep this network'), value: suggested, ok: t('Keep') });
    if (name === null) return null;
    const id = claimDocument(name, known ? null : state.docId);
    if (!id) { showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err'); return null; }
    showToast(t('Kept "{name}". From now on it saves itself.', { name: libraryEntry(id).name }), 'ok');
    return id;
}

// Make the open network a card under `id` (a new one when null) and keep it.
// -> the id, or null when it could not be stored.
function claimDocument(name, id, opts = {}) {
    if (state.readOnly) return null;
    const key = librarySave(name, id || null, opts);
    if (!key) return null;
    state.libraryId = state.docId = key;
    state.docUpdated = libraryEntry(key).updated;
    _docOrigin = 'kept';
    cancelAutosave();
    refreshLiveEntry();   // a reload must come back kept, under this card
    renderDocBar();
    return key;
}

// The open network stops being kept (its card was deleted): it stays on screen
// and in this tab, and the bar offers to keep it again.
function releaseDocument() {
    state.libraryId = null;
    _docOrigin = 'released';
    cancelAutosave();
    refreshLiveEntry();
    renderDocBar();
}

// ---- Bringing back a network you already have ----
// A build file, a link and the canvas's Keep can all carry a network whose id
// is already a card here: your own file re-imported, or a colleague's edit of
// a network you sent them. A .nettopo file is a binder of one site, so the
// rule is the binder's: same id, same network, and the newer one is offered
// as the update. Never silently: a single file is opened by hand, and the
// visitor can always take it as a copy instead.
//
// incoming = { doc, updated }. -> 'same' (nothing differs: just open the card),
// 'update', 'copy', 'mine', or null (cancelled).
async function askAboutKnownCopy(incoming, entry, opts = {}) {
    const changes = docChangeCount(entry.doc, incoming.doc);
    if (!changes) return 'same';
    const name = entry.name;
    const copy = { id: 'copy', label: opts.copyLabel || t('Open as a copy') };
    if ((incoming.updated || 0) > (entry.updated || 0)) {
        return askChoice(t('You already have "{name}" in this browser. This copy is newer.', { name }), {
            title: opts.title || '',
            choices: [copy, { id: 'update', primary: true,
                label: t(changes === 1 ? 'Update "{name}" ({n} change)' : 'Update "{name}" ({n} changes)', { name, n: changes }) }]
        });
    }
    return askChoice(t('You already have "{name}" in this browser, and yours is newer than this copy.', { name }), {
        title: opts.title || '',
        choices: [copy, { id: 'mine', label: t('Open mine'), primary: true }]
    });
}

// How many devices, cables and notes differ between two documents, matched by
// id, plus one for a changed report header: the "(n changes)" on Update. Both
// sides go through the serializer first, so a key order or a default filled
// in on load is not counted as somebody's change.
function docChangeCount(a, b) {
    const ca = canonicalDoc(a), cb = canonicalDoc(b);
    let n = 0;
    const diff = (xs = [], ys = []) => {
        const mine = new Map(xs.map((x) => [x.id, JSON.stringify(x)]));
        const seen = new Set();
        ys.forEach((y) => { if (mine.get(y.id) !== JSON.stringify(y)) n++; seen.add(y.id); });
        mine.forEach((_, id) => { if (!seen.has(id)) n++; });
    };
    diff(ca.nodes, cb.nodes); diff(ca.links, cb.links); diff(ca.annotations, cb.annotations);
    if (JSON.stringify(ca.report || null) !== JSON.stringify(cb.report || null)) n++;
    if (JSON.stringify(ca.accepted || null) !== JSON.stringify(cb.accepted || null)) n++;   // the accepted findings, as one
    return n;
}

// A document's identity as it travelled (identifiedDoc in js/app.js writes
// it). Read defensively: a file is outside input, and an id is about to be
// used as a library key.
function docIdentity(doc) {
    const id = doc && typeof doc.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(doc.id) ? doc.id : null;
    const updated = doc && Number.isFinite(doc.updated) && doc.updated > 0 ? doc.updated : 0;
    return { id, updated };
}
// The same document without it, for storing in a card, where the entry holds
// the identity instead.
function stripIdentity(doc) {
    const out = Object.assign({}, doc);
    delete out.id; delete out.updated;
    return out;
}

// ---- Autosave: a kept network keeps itself ----
// A kept network is written into its card AUTOSAVE_MS after its last change,
// and never later than AUTOSAVE_MAX_MS after the first unsaved one, so a long
// spell of typing is not one long risk. Leaving the page, going to the
// background, opening the landing, exporting, or replacing the document
// writes it at once (flushAutosave). The live history entry still follows
// every keystroke on its own (js/app.js); this is the copy that survives the
// tab closing.
//
// Only a kept network. A plain visit opens the example and a client's sealed
// link opens their network: autosaving either would fill the library with
// copies of the demo, or keep a client's addressing plan in this browser
// without anyone deciding to. Kept means started here (New network, the
// setup wizard, a dismissed landing), opened from a file or a card, or kept
// with Keep this network.
const AUTOSAVE_MS = 800;
const AUTOSAVE_MAX_MS = 5000;
let _autosaveTimer = 0, _autosaveDueSince = 0, _lastDocJson = null;
// Where the open document came from, for the bar's wording (replaceDocument).
let _docOrigin = 'default';
const isKept = () => !!state.libraryId && !state.readOnly;
const docHasContent = () => state.nodes.length > 0 || state.annotations.length > 0;
const autosavePending = () => _autosaveDueSince > 0;

// replaceDocument(): this is the document as it was opened, not a change.
function noteDocLoaded(json, origin) {
    _lastDocJson = json;
    _docOrigin = origin || 'file';
    cancelAutosave();
}

// Every save (js/app.js), each keystroke, and undo/redo report the document
// here. Only a real difference counts: many paths save without changing
// anything, and an unchanged document must not age its card.
function noteDocChanged(json) {
    if (json === _lastDocJson) return;
    _lastDocJson = json;
    state.docUpdated = Math.max(Date.now(), (state.docUpdated || 0) + 1);
    if (!isKept()) return;
    const now = Date.now();
    if (!_autosaveDueSince) {
        _autosaveDueSince = now;
        const status = document.getElementById('docBarStatus');
        if (status && !_storageFailed) status.textContent = t('Saving…');
    }
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(flushAutosave, Math.max(0, Math.min(AUTOSAVE_MS, _autosaveDueSince + AUTOSAVE_MAX_MS - now)));
}

function cancelAutosave() { clearTimeout(_autosaveTimer); _autosaveTimer = 0; _autosaveDueSince = 0; }

// Write a pending autosave now. -> false when the network is kept but could
// not be stored, so a caller about to close it knows to ask.
function flushAutosave() {
    clearTimeout(_autosaveTimer); _autosaveTimer = 0;
    if (!_autosaveDueSince) return !_storageFailed;
    // The canvas is on loan (the binder report's image sweep) or another
    // document is in state for one call: what is in state is not this
    // network. Later, when it is back.
    if (canvasIsBorrowed() || _borrowedState) { _autosaveTimer = setTimeout(flushAutosave, AUTOSAVE_MS); return false; }
    _autosaveDueSince = 0;
    if (!isKept()) { renderDocBar(); return true; }
    // A new network becomes a card with its first device, not before: New
    // network pressed twice must not leave two empty cards behind.
    if (!docHasContent() && !libraryEntry(state.libraryId)) { renderDocBar(); return true; }
    const id = librarySave(null, state.libraryId);
    if (id) state.docUpdated = libraryEntry(id).updated;
    renderDocBar();
    // In IndexedDB mode the card always takes the edit and the disk follows;
    // while the disk is refusing, this network is no safer than the tab.
    return !!id && !_storageFailed;
}

// ---- The bar on the canvas ----
// Kept: the network's name (click to rename) and "Saved · just now". Not
// kept: what it is and why it is not saved, with Keep this network. Hidden
// for a read-only document, whose banner sits in the same place, and for an
// empty network that is not kept, which has nothing to keep.
function renderDocBar() {
    const banner = document.getElementById('storageBanner');
    if (banner) banner.classList.toggle('hidden', !_storageFailed);
    // Back up now hands over the open network; when other cards live here too
    // they are just as unprotected by a full store, so the banner offers the
    // whole binder beside it (binderFile() puts the unsaved edits in).
    const all = document.getElementById('storageBackupAllBtn');
    if (all) all.classList.toggle('hidden', !_storageFailed || !libraryEntries().some((e) => e.id !== state.libraryId));
    const bar = document.getElementById('docBar');
    if (!bar) return;
    const kept = isKept();
    const keepItem = document.getElementById('saveNetworkBtn');
    if (keepItem) keepItem.classList.toggle('hidden', kept || !!state.readOnly);
    if (state.readOnly || (!kept && !docHasContent())) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.classList.toggle('unkept', !kept);
    const nameEl = document.getElementById('docBarName');
    const status = document.getElementById('docBarStatus');
    const keep = document.getElementById('docBarKeep');
    status.classList.toggle('failed', kept && _storageFailed);
    keep.hidden = kept;
    nameEl.hidden = !kept;
    if (!kept) {
        status.textContent = ['default', 'template'].includes(_docOrigin)
            ? t('An example: changes stay in this tab until you keep it.')
            : ['link', 'guest'].includes(_docOrigin)
                ? t('Opened from a link: not kept in this browser until you keep it.')
                : t('Not kept in this browser.');
        return;
    }
    const entry = libraryEntry(state.libraryId);
    nameEl.textContent = entry ? entry.name : t('Untitled network');
    nameEl.disabled = !entry;
    status.textContent = _storageFailed ? t('Not saved')
        : autosavePending() ? t('Saving…')
        : entry ? t('Saved · {when}', { when: libraryWhen(entry.updated) })
        : t('Saves itself once you add something.');
}

async function renameOpenNetwork() {
    const entry = isKept() && libraryEntry(state.libraryId);
    if (!entry) return;
    const name = await askPrompt(t('Rename network — new name:'), { title: t('Rename'), value: entry.name, ok: t('Rename') });
    if (name === null) return;
    if (!libraryRename(entry.id, name)) showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err');
    renderDocBar();
}

// ---- Saved templates: cards in the same library ----
// "Save as template" used to write a store of its own (nettopo_user_templates),
// listed under a second "My networks" heading in the Networks tab, never in
// the binder, the back-up or the landing. A template is now a card flagged
// `template`: it travels with the binder, shows on the landing under
// Templates, and Duplicate on its card starts a network from it. The Networks
// tab lists the same cards as starting points.
const USER_TPL_KEY = 'nettopo_user_templates';

// Once, at boot: the old store moves into the library and is removed. If the
// library cannot take it (a full quota), the old store stays for next time
// rather than being lost. With IndexedDB the library takes it at once and the
// disk a moment later, so the old store goes only when the disk has it — and
// a template's id comes from its name and content, so a boot that has to move
// the same store again lands on the same cards instead of doubling them.
function migrateUserTemplates() {
    let old = null;
    try { old = JSON.parse(localStorage.getItem(USER_TPL_KEY) || 'null'); } catch (e) { old = null; }
    if (!old || typeof old !== 'object' || Array.isArray(old)) {
        if (old !== null) { try { localStorage.removeItem(USER_TPL_KEY); } catch (e) { /* blocked */ } }
        return 0;
    }
    const lib = loadLibrary();
    const now = Date.now();
    let moved = 0;
    Object.keys(old).forEach((name) => {
        const doc = old[name];
        if (!isDocShape(doc) || !Array.isArray(doc.nodes)) return;
        const key = 't' + contentHash(JSON.stringify([name, doc]));
        lib[key] = { id: key, name: String(name).trim() || t('Untitled network'), doc, created: now, updated: now + moved, template: true };
        moved++;
    });
    if (!persistLibrary(lib)) return -1;
    const raw = localStorage.getItem(USER_TPL_KEY);
    libraryWritesSettled().then((stored) => {
        if (!stored) return;
        // Only what was moved: a store rewritten since (an old tab) is the next boot's.
        try { if (localStorage.getItem(USER_TPL_KEY) === raw) localStorage.removeItem(USER_TPL_KEY); }
        catch (e) { /* blocked: harmless, the next boot moves the same cards onto themselves */ }
    });
    return moved;
}

// Save the canvas as a template card. A template of the same name is updated
// rather than doubled, as the old store (keyed by name) did.
async function saveAsTemplate() {
    if (!docHasContent()) { showToast(t('Nothing to save — add some nodes first.')); return null; }
    if (readOnlyRefuses()) return null;
    const name = await askPrompt(t('Save current canvas as template — name:'), { title: t('Save as template'), ok: t('Save') });
    if (name === null || !name.trim()) return null;
    const same = libraryTemplates().find((e) => e.name === name.trim());
    const id = librarySave(name.trim(), same ? same.id : null, { template: true });
    if (!id) { showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err'); return null; }
    renderUserTemplates();
    if (landingIsOpen()) renderLanding();
    showToast(t('Saved template "{name}".', { name: name.trim() }), 'ok');
    return id;
}

// The Networks tab's "My templates": picking one starts from a copy of it,
// as a shipped template does (applyTemplate, js/app.js).
function renderUserTemplates() {
    // The Blocks tab reads the same store (js/add.js, which loads after this
    // file: during this file's own boot it is not there yet).
    if (typeof renderBlocks === 'function') renderBlocks();
    const section = document.getElementById('userTemplateSection');
    const list = document.getElementById('userTemplateList');
    if (!section || !list) return;
    const tpls = libraryTemplates();
    list.innerHTML = '';
    section.classList.toggle('hidden', !tpls.length);
    tpls.forEach((e) => {
        list.appendChild(libraryItem(
            { icon: '📐', name: e.name, blurb: t('{n} nodes · reusable template', { n: (e.doc.nodes || []).length }) },
            () => applyTemplate(e.doc),
            async () => {
                if (!(await askConfirm(t('Delete template "{name}"?', { name: e.name }), { ok: t('Delete'), danger: true }))) return;
                libraryDelete(e.id);
                renderUserTemplates();
                if (landingIsOpen()) renderLanding();
            }
        ));
    });
}

// Published for tests/suites/library.js, which needs the store without the DOM.
window.CarinoLibrary = { LIBRARY_KEY, LIBRARY_DB, LIBRARY_STORE, libraryStoreKind, openLibraryStore, adoptLibraryStore, releaseLibraryStore,
    idbLibraryAdapter, libraryAdapter, libraryWritesSettled, journalUnsettledCards, storageFailed, libraryEntry, BINDER_EXPORT_KEY, BINDER_KIND, GUEST_BINDER_KEY, USER_TPL_KEY, loadLibrary, persistLibrary, libraryEntries, librarySave, libraryDelete,
    libraryRename, libraryDuplicate, librarySummary, withDoc, binderFile, binderLinkFile, canonicalDoc, binderFromImported, importBinderSites, binderStatus, backupStatus, applyImportedBinder, binderCanBind, binderHandle, putBinderHandle, clearBinderHandle,
    ensureBinderPermission, writeBinderTo, readBinderFrom, adoptBinderFile, refreshBinderBinding, binderBinding,
    downloadBinderFile, BINDER_HANDLE_KEY, setHandleStore, guestSites, setGuestBinder, restoreGuestBinder, dismissGuestBinder, keepGuestSites, openBinderLink, copyBinderLink,
    keepThisNetwork, claimDocument, flushAutosave, migrateUserTemplates, saveAsTemplate, docChangeCount, docIdentity, recordBuildExport };
