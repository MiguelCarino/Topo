// Shared mutable state. Loaded first so nothing can touch it in the TDZ.
// Load order: state -> model -> data -> diagnostics -> ui -> app

const state = {
    // report: the survey header (site, client, who signed it). Null until the
    // report dialog is used, and serialized only when non-empty — see
    // serializeReportMeta() in js/report.js.
    // libraryId: the saved network (card) this document is kept as, or null
    // while it is not kept. A kept document saves itself into that card
    // (autosave, js/library.js); a demo, a template or a link someone sent is
    // not kept until the visitor says so. Outside serializeDoc(), so it is never
    // part of an undo step.
    // docId / docUpdated: the document's identity and when it last changed.
    // A kept document's id IS its card's id. They stay out of serializeDoc()
    // too (an identity is not an edit, and must not cost an undo step); they
    // are written into the document only where it leaves this tab, a build
    // file or a link (identifiedDoc in js/app.js), so that bringing the same
    // network back is recognised as that network instead of becoming a
    // second card.
    // docRev / docRevHash / docBase / docPrior: the rest of that identity
    // (document v17, js/revisions.js). docRev is the revision the document
    // carried when it last left (a file, a link, a binder) and docRevHash
    // the hash of its content then; docBase the revision it was started
    // from; docPrior the revisions it carried before docRev. A kept
    // document's are its card's. Identity like docId: never serialized
    // by serializeDoc(), never an undo step.
    // log: the network log (js/model.js "Network log"). Document:
    // serialized, an undo step (undoing a merge takes its entry back),
    // carried by files and links.
    // readOnly: null, or { doc } — the document exactly as it arrived, when it
    // was written by a newer Topo than this one (see replaceDocument() in
    // js/app.js). Also bookkeeping, also never serialized.
    // networks: the declared subnets (R7, js/model.js "Networks"). A device
    // belongs to one by address containment, never by a stored list, and takes
    // its gateway and DNS from it unless its own fields say otherwise.
    // groups: where devices sit (buildings, floors, rooms, racks; js/model.js
    // "Groups"). Document, like the networks: serialized, an undo step,
    // carried by files and links. Which of them are collapsed on the map is
    // a view, and is not kept here.
    // wifi: the Wi-Fi networks (SSIDs; js/model.js "Wi-Fi"), a list of
    // their own like the networks. Document: serialized, an undo step, carried
    // by files and links. No passphrase is ever kept.
    // columns, tableView: the custom columns a document defines and the
    // Devices table's order and hidden columns (js/model.js "Custom
    // columns"). Document: serialized, an undo step, carried by files and
    // links.
    // searches: the saved searches (js/model.js "Saved searches"). A view
    // of the register, but the document's: serialized, an undo step,
    // carried by files and links.
    // accepted: the findings accepted with a reason ({ check, nodeIds,
    // linkIds, reason, until? }, js/diagnostics.js "Accepted findings").
    // Document, so serialized, an undo step, and carried by files and links.
    // pinned: the findings pinned for the next visit ({ check, nodeIds,
    // linkIds, scope?, note? }, js/diagnostics.js "Pinned for the next
    // visit"). Document, like accepted.
    // expectedLife: how many years each type lasts in this network, where it
    // is not Topo's usual ({ type: years }, js/model.js "Age and upkeep").
    // Document, like accepted.
    // selection: what is selected, a Set of { type, id } (plan 3.1). Several
    // devices and cables can be selected at once (shift/ctrl-click, a
    // shift-drag box, Ctrl+A, a network's "Select members"); a text note or a
    // note's leader is only ever selected on its own. Entries are frozen and
    // added only through the helpers below, so one thing is never in it twice.
    // selectedId / selectedType are derived: the one thing selected, or null
    // when nothing or more than one is. Every editor that works on one device
    // or one cable reads them, and so does nothing for a set — the rail shows
    // the set's counts instead (renderSelection, js/ui.js). They can still be
    // assigned (older code and tests do): an id replaces the selection with
    // that one thing, null clears it.
    // Never serialized, never an undo step: undo, redo and replaceDocument()
    // drop the ids that are gone (pruneSelection, js/app.js).
    // query: what the search box over the map and the table holds (plan 3.3,
    // js/query.js). A view, like the trace: never serialized, never an undo
    // step, not kept between visits, and kept when another network is opened.
    nodes: [], links: [], networks: [], groups: [], wifi: [], providers: [], accepted: [], pinned: [], expectedLife: {}, columns: [], tableView: {}, searches: [], annotations: [], report: null, log: [], incidents: [], libraryId: null, docId: null, docUpdated: 0, docRev: null, docRevHash: null, docBase: null, docPrior: [], readOnly: null, linkSourceId: null,
    query: '',
    selection: new Set(),
    get selectedId() { const one = soleSelected(this.selection); return one ? one.id : null; },
    get selectedType() { const one = soleSelected(this.selection); return one ? one.type : null; },
    set selectedId(id) { this.selection = id == null ? new Set() : new Set([selEntry(this.selectedType || 'node', id)]); },
    set selectedType(type) {
        const one = soleSelected(this.selection);
        this.selection = type == null || !one ? new Set() : new Set([selEntry(type, one.id)]);
    },
    // traceMode / tracePort / tracePortOn: the trace (the node Diagnostics
    // tab, the T key, the phone's handy bar). They live here rather than in
    // the controls that show them, so the reachability walk and the Trace
    // Port row never read the page. Never persisted (saveSettings, js/app.js).
    // traceVlan: the Trace follows one VLAN at a time (the VLAN tick beside
    // Port filter, docs/BACKLOG.md feature 4 stage 3); on by default, and
    // like the rest of the trace not persisted, so every visit starts on.
    // subnetZones: the canvas draws the declared networks' zones at all (the
    // Subnets tab's "Subnet zones"). A view preference, so it is persisted
    // with the other settings and never travels with a document.
    // view: 'map', 'table' or 'rack' once the visitor has chosen (js/table.js;
    // 'rack' stands only while the document has a rack, js/rackview.js);
    // unset, a phone opens on the table and anything wider on the map.
    // Persisted the same way. Which rack is on show is not: a view of this visit.
    settings: { traceMode: false, tracePort: '', tracePortOn: false, traceVlan: true, profile: 'simple', advanced: true, subnetZones: true },
    camera: { x: 0, y: 0, zoom: 1 }
};

// ---- The selection set's helpers ----
// Function declarations, so the getters above can call them whatever order
// this file is read in.
function selEntry(type, id) { return Object.freeze({ type, id }); }
function soleSelected(set) { if (set.size !== 1) return null; for (const e of set) return e; return null; }
function inSelection(type, id) { for (const e of state.selection) if (e.type === type && e.id === id) return true; return false; }
// The ids of one type, in the order they were selected.
function selectedOf(type) { const out = []; state.selection.forEach((e) => { if (e.type === type) out.push(e.id); }); return out; }
// Replaces the whole set. Duplicates are folded, and only devices and cables
// can share it: a note or a leader in a list of several is left out.
function setSelectionEntries(entries) {
    const list = (entries || []).filter((e) => e && e.id != null && e.type);
    const multi = list.length > 1;
    const out = new Set(), seen = new Set();
    list.forEach((e) => {
        if (multi && e.type !== 'node' && e.type !== 'link') return;
        const k = `${e.type}\u0000${e.id}`;
        if (seen.has(k)) return;
        seen.add(k); out.add(selEntry(e.type, e.id));
    });
    state.selection = out;
}

// ---- Redraw coalescing ----
// The one throttle for redraws that follow typing (the search box, the
// fields). Only the pixels wait: the model write, saveTyping and save() run
// on every keystroke as before, and whoever calls ask() has already made them.
// ask() draws at once (the leading edge); a draw slower than REDRAW_SLOW_MS
// opens a window of REDRAW_WAIT_MS in which asks only mark the draw pending,
// and the window's end draws once more (and opens again if that was slow too),
// so a fast map never waits and a slow one draws at most once per window.
// flush() draws what is pending now and closes the window, for whatever acts
// on what is drawn (Enter, a button, leaving the field). cancel() drops it.
// waiting(): whether a draw is pending.
// Pending is cleared before draw() runs, and an ask or a flush during the
// draw (a rebuilt panel's focusout) only marks it pending again. A draw()
// that returns false (the canvas is on loan) stays pending and arms the
// timer, on every path: it is never dropped.
// Off under automation: the suites read the map right after an action.
// Playwright's Chromium reports navigator.webdriver; tests/run.sh's headless
// one does not, so its probe sets window.TOPO_COALESCE = false. Adaptive in a
// browser; a suite that wants to see the window sets it to true, which opens
// it after every draw, slow or not.
const REDRAW_WAIT_MS = 120;
const REDRAW_SLOW_MS = 24;
const coalesceOn = () => {
    if (typeof window.TOPO_COALESCE === 'boolean') return window.TOPO_COALESCE;
    return !navigator.webdriver;
};
// opts.settle (ms), for the fields' redraw: once a draw has been slow, a
// keystroke no longer draws at once and the window does not end while the
// keys keep coming: the draw waits until typing has paused for settle ms,
// and never longer than settle × SETTLE_MAX_FACTOR since the first key it
// holds. A whole redraw of a big site (its findings with it) is 100-200 ms;
// drawn on the leading edge and then every window, it took the main thread
// from under the typing, and the keys came out in bursts. The caller shows
// what must follow each key at once (renderTyped, js/ui.js). A fast draw
// clears the slow mark, so a small map draws on every key as before.
// opts.slow(), when given, says whether the map's last redraw of any kind was
// slow, so the first key of a burst waits too.
const SETTLE_MAX_FACTOR = 10;
function redrawCoalescer(draw, opts = {}) {
    let timer = null, pending = false, drawing = false, slow = false, heldSince = 0;
    const settle = opts.settle > 0 ? opts.settle : 0;
    const wait = () => {
        if (!settle || !slow) return REDRAW_WAIT_MS;
        const left = heldSince ? heldSince + settle * SETTLE_MAX_FACTOR - performance.now() : Infinity;
        return Math.max(0, Math.min(Math.max(REDRAW_WAIT_MS, settle), left));
    };
    const arm = () => { if (timer === null) timer = setTimeout(end, wait()); };
    const close = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
    // One draw. -> whether it was slow enough (or forced) to hold the window.
    const run = () => {
        pending = false;
        heldSince = 0;
        drawing = true;
        const t0 = performance.now();
        let out;
        try { out = draw(); } finally { drawing = false; }
        if (out === false) pending = true;
        const held = coalesceOn() && (window.TOPO_COALESCE === true || performance.now() - t0 > REDRAW_SLOW_MS);
        slow = held;
        return held;
    };
    // Settling: the draw is held, and its timer starts again from this key.
    const hold = () => {
        pending = true;
        if (!heldSince) heldSince = performance.now();
        close(); arm();
    };
    function end() {
        timer = null;
        if (!pending) return;
        if (run() || pending) arm();
    }
    return {
        ask() {
            if (drawing) { pending = true; return; }
            if (settle && coalesceOn() && (slow || (opts.slow && opts.slow()))) { slow = true; hold(); return; }
            if (timer !== null) { pending = true; return; }
            if (run() || pending) arm();
        },
        flush() {
            if (drawing) { pending = true; return; }
            close();
            if (!pending) return;
            run();
            if (pending) arm();
        },
        cancel() { pending = false; heldSince = 0; close(); },
        waiting: () => pending
    };
}

// ---- The phone's layouts, as media queries (Mobile batch 5, M31) ----
// The same strings as css/app.css's blocks, which cannot share a variable.
// DRAWER_MQ: the rail is a drawer, the handy bar and the bars over the map
// show: a window 900px wide or less, or a phone held sideways (a touch
// screen 500px tall or less and 932px wide or less, the widest phone on its
// side: wider is a tablet whose browser shrank the page for its keyboard,
// which keeps its docked rail).
// PHONE_LAYOUT_MQ: the phone's own layout (the rack's switches, the map's
// framing under the bars, the document bar's chip): 640px wide or less, or
// the same phone held sideways. phoneView() (js/table.js) stays width-only:
// it opens a phone on the Table and floors the first zoom, which a phone
// held sideways does better without.
const DRAWER_MQ = '(max-width: 900px), (max-height: 500px) and (max-width: 932px) and (pointer: coarse)';
const PHONE_LAYOUT_MQ = '(max-width: 640px), (max-height: 500px) and (max-width: 932px) and (pointer: coarse)';
// NAV_AWAY_MQ: a touch screen in the drawer's layout, where the fleet navbar
// waits above the top edge (js/mobile.js navReveal); a mouse keeps it pinned.
const NAV_AWAY_MQ = '(max-width: 900px) and (pointer: coarse), (max-height: 500px) and (max-width: 932px) and (pointer: coarse)';
function mqMatches(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }

// ---- Where this page lives, for links that leave it ----
// A share link or a label's QR code points at this page when it is served
// over http(s) (topo.carino.systems, or an intranet copy such as Offline's
// topo.carino.internal), so a link made on the intranet opens the intranet.
// Opened as a file (the offline zip) or inside the desktop app (tauri://, or
// http://tauri.localhost on Windows), the page has no address anyone else can
// open, so the link points at the public site instead. Either way a link
// keeps only the query that says which view it is (LINK_PARAMS): ?lang= and
// ?theme= are how this visitor reads the page, and a link that carried them
// would force the sender's language on whoever opens it (a client on
// ?lang=es sending a provider a Spanish page). The recipient's own applies.
const PUBLIC_BASE = 'https://topo.carino.systems/';
const LINK_PARAMS = ['profile', 'simple'];
const servedOverWeb = (loc) => (loc.protocol === 'http:' || loc.protocol === 'https:') && loc.hostname !== 'tauri.localhost';
function publicBaseFor(loc) {
    return servedOverWeb(loc) ? loc.origin + loc.pathname : PUBLIC_BASE;
}
function publicQueryFor(loc) {
    const from = new URLSearchParams(loc.search), keep = new URLSearchParams();
    LINK_PARAMS.forEach((k) => { if (from.has(k)) keep.set(k, from.get(k)); });
    const q = keep.toString();
    return q ? '?' + q : '';
}
const publicBase = () => publicBaseFor(location);
const publicQuery = () => publicQueryFor(location);

// ---- Saving a file ----
// One way to hand the visitor a file: a blob, an <a download> in the page, and
// the URL let go a minute later. WebKit (Safari, the macOS and Linux desktop
// apps) reads the blob after click() returns, so a URL revoked at once saves
// an empty file; a blob also spares a multi-MB data: navigation.
const SAVE_REVOKE_MS = 60000;
function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), SAVE_REVOKE_MS);
    return url;
}
// A data: URL as a Blob, decoded here: fetch() of a data: URL is a connect,
// and the CSP's connect-src does not allow data:.
function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const head = dataUrl.slice(5, comma), body = dataUrl.slice(comma + 1);
    const type = head.split(';')[0] || 'application/octet-stream';
    if (!/;base64$/i.test(head)) return new Blob([decodeURIComponent(body)], { type });
    const bin = atob(body), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
}
