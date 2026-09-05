// ---- The library: the networks this browser remembers ----
// Topo's document has always been its URL, which is why there is no server and
// no account here either. But that leaves exactly one gap, and it is the one
// that loses work: close the tab without copying the link and the evening is
// gone. So a saved network is the *same* serialized document, parked in
// localStorage under a name, and the landing page is a list of them.
//
// Two rules follow, and both are load-bearing:
//
//   * The library is never a second source of truth. Opening a card loads the
//     document and lets save() write it into the hash exactly as a shared link
//     would, so the URL is still the document and a card is only a bookmark
//     that happens to remember its own contents. Nothing can drift, because
//     there is nothing to drift from.
//
//   * It is one browser on one machine, not an account. That has to be said in
//     words on the landing page rather than left for someone to discover with a
//     cleared cache halfway through an engagement — a card list looks exactly
//     like cloud storage, and people will trust it as if it were.
//
// An entry is {id, name, doc, created, updated}; `doc` is whatever
// serializeDoc() produced, so a card and a "Copy link" URL carry byte-identical
// payloads.
const LIBRARY_KEY = 'nettopo_library';

function loadLibrary() {
    try {
        const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '{}');
        // An array here would be an older or a corrupted store; treating it as
        // empty loses nothing that was readable anyway, and stops every caller
        // below having to re-check the shape.
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (e) { return {}; }
}

// The one guarded write, following persistUserTemplates(): Safari private mode
// throws on setItem and so does a full quota, and a saved network is the one
// place where failing silently would be worst — the user would close the tab
// believing the work was kept. Callers report the false.
function persistLibrary(lib) {
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); return true; }
    catch (e) { return false; }
}

// Most-recently-touched first: the card you want is nearly always the one you
// were just working on. Entries whose doc did not survive a bad write are
// dropped rather than rendered as a card that opens onto nothing.
function libraryEntries() {
    return Object.values(loadLibrary())
        .filter((e) => e && typeof e === 'object' && e.doc && Array.isArray(e.doc.nodes))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function libraryEntry(id) { return id ? loadLibrary()[id] || null : null; }

// Save the canvas as it stands. Passing an id updates that entry in place —
// which is what makes "Save" idempotent instead of breeding "Torre B (2)".
// `updated` is strictly increasing per entry, never merely Date.now(). Two saves
// inside the same millisecond would otherwise be indistinguishable, and three
// separate things read this field and get it wrong when it stands still: the
// binder's "newer wins" merge, the "changed since you exported" line, and the
// most-recent-first order of the cards.
function stampUpdated(previous) {
    const now = Date.now();
    return previous && previous.updated >= now ? previous.updated + 1 : now;
}

function librarySave(name, id) {
    const lib = loadLibrary();
    const key = (id && lib[id]) ? id : `n${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    lib[key] = {
        id: key,
        name: String(name || '').trim() || t('Untitled network'),
        doc: serializeDoc(),
        created: (lib[key] && lib[key].created) || Date.now(),
        updated: stampUpdated(lib[key])
    };
    return persistLibrary(lib) ? key : null;
}

function libraryDelete(id) {
    const lib = loadLibrary();
    if (!lib[id]) return false;
    delete lib[id];
    return persistLibrary(lib);
}

function libraryRename(id, name) {
    const lib = loadLibrary();
    if (!lib[id]) return false;
    const next = String(name || '').trim();
    if (!next || next === lib[id].name) return true;   // nothing changed; do not age the entry for it
    lib[id].name = next;
    // A rename is a change to the entry, so the exported binder no longer
    // matches it and the card has just been touched. Without this the landing
    // would go on saying the binder is current after the one edit most likely
    // to happen right before someone hands the file over.
    lib[id].updated = stampUpdated(lib[id]);
    return persistLibrary(lib);
}

// ---- The binder: the whole library as one file ----
// localStorage is where the library *lives*, and it is one browser on one
// machine. The binder is the copy that is not: the thing that goes in the
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
    return {
        kind: BINDER_KIND,
        version: BINDER_VERSION,
        exported: new Date().toISOString(),
        sites: libraryEntries().map((e) => ({ id: e.id, name: e.name, created: e.created, updated: e.updated, doc: e.doc }))
    };
}

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
        const id = typeof site.id === 'string' && site.id ? site.id : `n${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
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
// arrive without. Minted by position, which is stable for the life of a shelf.
function withGuestIds(sites) {
    return sites.map((site, i) => (site.id ? site : Object.assign({}, site, { id: `guest${i}` })));
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
    _guestError = '';
    try {
        const parsed = binderFromImported(JSON.parse(await decodeBinderFragment(frag)));
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
    if (!result) { alert(t('Could not save — browser storage is unavailable (private mode or full).')); return; }
    // Only the cards that were actually stored leave the shelf. One that lost
    // the newer-wins comparison, or that could not be read, was NOT kept — and
    // once the landing is dismissed the shelf is the only remaining copy, so
    // clearing it on the strength of having been asked would lose the document.
    const stored = new Set(result.storedIds);
    const left = guestSites().filter((x) => !stored.has(x.id));
    setGuestBinder(left.length ? { sites: left, exported: _guestBinder && _guestBinder.exported } : null);
    renderLanding();
    if (result.added + result.updated === 0) {
        alert(t('Nothing was kept — you already have a newer copy of {n} of these.', { n: result.kept }));
    }
}

// Open one shelved network without keeping it. pushState rather than replaceState
// so Back returns to the shelf: the visitor has not adopted anything, and losing
// the other sites by looking at one would be a trap.
function openGuestSite(id) {
    const site = guestSites().find((x) => x.id === id);
    if (!site) { renderLanding(); return; }
    if (!_landingBoot && state.nodes.length
        && !confirm(t('Replace the network on screen with "{name}"?', { name: site.name }))) return;
    state.libraryId = null;
    window.history.pushState(null, '', `#${encodeDoc(site.doc)}`);
    loadDocIntoCanvas(site.doc);
    landingHandledDocument();
}

// ---- Making one ----
async function copyBinderLink() {
    const file = binderFile();
    if (!file.sites.length) { alert(t('Nothing to share yet.')); return; }
    if (!canMakeBinderLink()) {
        if (confirm(t('This browser cannot make a binder link. Export the binder file instead?'))) exportBinder();
        return;
    }
    const frag = await encodeBinderFragment(JSON.stringify(file));
    if (frag.length > BINDER_URL_MAX) {
        if (confirm(t('These {n} networks are too much for one link. Export the binder file instead?', { n: file.sites.length }))) exportBinder();
        return;
    }
    const url = `${location.origin}${location.pathname}#${frag}`;
    try { await navigator.clipboard.writeText(url); alert(t('Binder link copied — {n} networks in one URL. Anyone with the link can open them.', { n: file.sites.length })); }
    catch (e) { prompt(t('Copy this binder link:'), url); }
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
function loadLastExport() {
    try {
        const v = JSON.parse(localStorage.getItem(BINDER_EXPORT_KEY) || 'null');
        return v && Number.isFinite(v.at) && v.seen && typeof v.seen === 'object' ? v : null;
    } catch (e) { return null; }
}
function recordBinderExport(sites) {
    const seen = {};
    (sites || libraryEntries()).forEach((e) => { seen[e.id] = e.updated || 0; });
    try { localStorage.setItem(BINDER_EXPORT_KEY, JSON.stringify({ at: Date.now(), seen })); } catch (e) { /* private mode */ }
}

// What the landing says under the cards. Deliberately silent about "0 changed":
// a line that appears when there is nothing to do trains people to ignore it.
function binderStatus() {
    const entries = libraryEntries();
    if (!entries.length) return null;
    const last = loadLastExport();
    if (!last) return t('Not exported yet — a build file is the only copy that survives a cleared cache.');
    const stale = entries.filter((e) => last.seen[e.id] !== (e.updated || 0)).length;
    if (!stale) return t('Binder exported {when}.', { when: libraryWhen(last.at) });
    return t(stale === 1
        ? 'Binder exported {when} — {n} network has changed since.'
        : 'Binder exported {when} — {n} networks have changed since.', { when: libraryWhen(last.at), n: stale });
}

// ---- Reading a document that is not the one on screen ----
// topologyFindings() and reportSubnets() read state.nodes and state.links and
// nothing else, so the honest way to ask them about a stored network is to *be*
// that network for the length of one synchronous call — no second copy of the
// checks to keep in step, and a card can never claim something the Diagnostics
// panel would contradict. Nothing in here touches the DOM, so no render can
// observe the swap, and the restore sits in a finally: a check that throws on a
// malformed stored doc must not strand the editor holding someone else's
// diagram.
function withDoc(doc, fn) {
    const held = { nodes: state.nodes, links: state.links, annotations: state.annotations, report: state.report };
    try {
        state.nodes = cloneData(doc.nodes || []).map(normalizeLoadedNode);
        state.links = cloneData(Array.isArray(doc.links) ? doc.links : []).map(normalizeLoadedLink)
            .filter((l) => getNode(l.source) && getNode(l.target));
        state.annotations = [];
        // The survey header is part of the stored document, and the binder
        // report reads it per site to print who each building was surveyed for.
        // Leaving it behind would have every site in the estate report carrying
        // the header of whatever happened to be on the canvas.
        state.report = doc.report && typeof doc.report === 'object' ? cloneData(doc.report) : null;
        autoBindLinks();
        return fn();
    } finally {
        state.nodes = held.nodes; state.links = held.links;
        state.annotations = held.annotations; state.report = held.report;
    }
}

// What a card says about a network. Deliberately not a thumbnail: a topology
// shrunk to 200px is a grey smudge, while the thing that actually tells you
// which card to open is the state you left it in — three errors outstanding, or
// none. Computed live rather than stored at save time, so a card cannot go
// stale against its own document.
function librarySummary(doc) {
    try {
        return withDoc(doc, () => {
            const findings = topologyFindings();
            return {
                devices: state.nodes.length,
                subnets: reportSubnets().length,
                critical: findings.filter((f) => f.level === 'bad').length,
                advisory: findings.filter((f) => f.level === 'warn').length
            };
        });
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
    if (window.location.hash) return false;
    const params = new URLSearchParams(window.location.search);
    // '?lang=' is presentation and stays on the landing — a Spanish reporter
    // opening the bare site gets a Spanish landing. '?profile=' and the legacy
    // '?simple' are routing: they name the job, so they skip it.
    return !(params.has('profile') || params.has('simple'));
}

function openLanding(fromBoot) {
    _landingBoot = !!fromBoot;
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
function closeLanding() {
    document.getElementById('landing').classList.add('hidden');
    document.body.classList.remove('landing-open');
    if (_landingBoot) { _landingBoot = false; save(); }
}

function landingIsOpen() { return !document.getElementById('landing').classList.contains('hidden'); }

// The landing stepping aside because a document arrived by another door — a
// card, a file, the example. Distinct from a plain dismissal, which still owes
// the blank canvas its save(); here the document has already been saved.
function landingHandledDocument() { _landingBoot = false; closeLanding(); }

function renderLanding() {
    const list = document.getElementById('landingCards');
    const entries = libraryEntries();
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
    entries.forEach((entry) => list.appendChild(landingCard(entry)));

    renderGuestSection();

    const target = document.getElementById('binderTarget');
    const bound = binderBinding();
    target.hidden = !bound.bound;
    if (bound.bound) {
        document.getElementById('binderTargetName').textContent = t('Saves to {name}', { name: bound.name });
    }

    const status = document.getElementById('binderStatus');
    const text = binderStatus();
    status.textContent = text || '';
    const last = loadLastExport();
    status.classList.toggle('stale', !!text && (!last || entries.some((e) => (e.updated || 0) > last.at)));
}

// ---- Binding the binder to a real file (File System Access API) ----
// After one save picker, "Export binder" writes to THAT file: no download
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
// in-memory store. That is not gratuitous seam-making: IndexedDB does not run
// under the headless runner's virtual clock (its callbacks never fire), and the
// logic worth asserting — when to bind, when to write, when to fall back to a
// download — all sits above the store rather than inside it. The IndexedDB
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
        if (unknown.length
            && confirm(t('That file already holds {n} networks you do not have. Add them to this browser?', { n: unknown.length }))) {
            importBinderSites(unknown);
        }
    }
    return handle;
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

function downloadBinderFile(file) {
    downloadJson(file, BINDER_FILENAME);
}

// Write the whole library to a file and remember that it happened — the
// remembering is the point, because it is what lets the landing say how long it
// has been rather than only that a button exists.
let _binderBusy = false;
async function exportBinder() {
    if (_binderBusy) return;
    if (!libraryEntries().length) { alert(t('Nothing to export yet.')); return; }
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
                const file = binderFile();
                try {
                    await writeBinderTo(handle, file);
                    await putBinderHandle(handle);
                    recordBinderExport(file.sites);
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
    if (!result) { alert(t('Could not save — browser storage is unavailable (private mode or full).')); return true; }
    if (landingIsOpen()) renderLanding();
    alert(t('Binder loaded: {added} added, {updated} updated, {kept} already up to date.', result)
        + (binder.dropped ? '\n' + t('{n} entry in the file could not be read and was skipped.', { n: binder.dropped }) : ''));
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
    const s = librarySummary(entry.doc);
    const card = document.createElement('div');
    card.className = `landing-card${opts.guest ? ' guest' : ''}`;
    card.dataset.id = entry.id;

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'landing-card-open';
    open.title = t('Open this network');
    const badges = s.unreadable
        ? `<span class="landing-badge warn">${escapeHtml(t('Could not read'))}</span>`
        : (s.critical || s.advisory
            ? `${s.critical ? `<span class="landing-badge bad">⛔ ${s.critical}</span>` : ''}${s.advisory ? `<span class="landing-badge warn">⚠ ${s.advisory}</span>` : ''}`
            : `<span class="landing-badge good">✓ ${escapeHtml(t('No findings'))}</span>`);
    open.innerHTML = `
        <span class="landing-card-name">${escapeHtml(entry.name)}</span>
        <span class="landing-card-stats">${escapeHtml(t(s.devices === 1 ? '{n} device' : '{n} devices', { n: s.devices }))} · ${escapeHtml(t(s.subnets === 1 ? '{n} subnet' : '{n} subnets', { n: s.subnets }))}</span>
        <span class="landing-card-badges">${badges}</span>
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

    // Rename and delete sit outside the open button because a button cannot
    // nest inside a button — and they stay reachable by keyboard rather than
    // appearing on hover alone.
    const tools = document.createElement('div');
    tools.className = 'landing-card-tools';
    const rename = document.createElement('button');
    rename.type = 'button'; rename.className = 'landing-tool'; rename.textContent = '✎';
    rename.title = t('Rename'); rename.setAttribute('aria-label', `${t('Rename')} — ${entry.name}`);
    rename.onclick = () => {
        const name = prompt(t('Rename network — new name:'), entry.name);
        if (name === null) return;
        if (!libraryRename(entry.id, name)) alert(t('Could not save — browser storage is unavailable (private mode or full).'));
        renderLanding();
    };
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'landing-tool'; del.textContent = '✕';
    del.title = t('Delete'); del.setAttribute('aria-label', `${t('Delete')} — ${entry.name}`);
    del.onclick = () => {
        if (!confirm(t('Delete saved network "{name}"? This cannot be undone.', { name: entry.name }))) return;
        libraryDelete(entry.id);
        if (state.libraryId === entry.id) state.libraryId = null;
        renderLanding();
    };
    tools.appendChild(rename); tools.appendChild(del);
    card.appendChild(tools);
    return card;
}

// ---- Acting on a card ----
// Every path below ends the same way: the document goes into state, save()
// writes it into the hash, and the network is a link again.
function loadDocIntoCanvas(doc) {
    loadTemplateState(doc); autoBindLinks();
    state.selectedId = null; state.selectedType = null; state.linkSourceId = null;
    select(null, null); save(); invalidateTidy();
    renderCanvasOnly(); fitToView(); initHistory();
}

function openFromLibrary(id) {
    const entry = libraryEntry(id);
    if (!entry) { renderLanding(); return; }
    // Nothing to lose behind the boot landing; from the menu there may be an
    // hour of unsaved work under the overlay.
    if (!_landingBoot && state.nodes.length
        && !confirm(t('Replace the network on screen with "{name}"?', { name: entry.name }))) return;
    state.libraryId = entry.id;
    loadDocIntoCanvas(entry.doc);
    landingHandledDocument();
}

// "Start a new network": a blank canvas that is a document from the first
// moment. save() gives it its own hash, so it can be shared, reloaded and
// bookmarked before a single device is placed.
function startNewNetwork() {
    state.libraryId = null;
    state.report = null;
    loadDocIntoCanvas({ nodes: [], links: [] });
    landingHandledDocument();
}

// Save the canvas into the library. A network opened from a card updates that
// card; anything else asks for a name, defaulting to the site already typed
// into the report header — by the time there is a report there is a name, and
// typing it twice is the kind of small friction that stops people saving.
function saveCurrentToLibrary() {
    if (!state.nodes.length) { alert(t('Nothing to save — add some devices first.')); return; }
    const existing = libraryEntry(state.libraryId);
    let name = existing && existing.name;
    if (!name) {
        const suggested = (state.report && state.report.site) || '';
        name = prompt(t('Name this network:'), suggested);
        if (name === null) return;
    }
    const id = librarySave(name, state.libraryId);
    if (!id) { alert(t('Could not save — browser storage is unavailable (private mode or full).')); return; }
    state.libraryId = id;
    alert(t('Saved "{name}" to your networks.', { name: libraryEntry(id).name }));
}

// Published for tests/suites/library.js, which needs the store without the DOM.
window.CarinoLibrary = { LIBRARY_KEY, BINDER_EXPORT_KEY, BINDER_KIND, GUEST_BINDER_KEY, loadLibrary, persistLibrary, libraryEntries, librarySave, libraryDelete,
    libraryRename, librarySummary, withDoc, binderFile, binderFromImported, importBinderSites, binderStatus, applyImportedBinder, binderCanBind, binderHandle, putBinderHandle, clearBinderHandle,
    ensureBinderPermission, writeBinderTo, readBinderFrom, adoptBinderFile, refreshBinderBinding, binderBinding,
    downloadBinderFile, BINDER_HANDLE_KEY, setHandleStore, guestSites, setGuestBinder, restoreGuestBinder, dismissGuestBinder, keepGuestSites, openBinderLink, copyBinderLink };
