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
    // network back is recognised and merged newer-wins instead of becoming a
    // second card.
    // readOnly: null, or { doc } — the document exactly as it arrived, when it
    // was written by a newer Topo than this one (see replaceDocument() in
    // js/app.js). Also bookkeeping, also never serialized.
    // networks: the declared subnets (R7, js/model.js "Networks"). A device
    // belongs to one by address containment, never by a stored list, and takes
    // its gateway and DNS from it unless its own fields say otherwise.
    // accepted: the findings accepted with a reason ({ check, nodeIds,
    // linkIds, reason }, js/diagnostics.js "Accepted findings"). Document, so
    // serialized, an undo step, and carried by files and links.
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
    nodes: [], links: [], networks: [], accepted: [], annotations: [], report: null, libraryId: null, docId: null, docUpdated: 0, readOnly: null, linkSourceId: null,
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
    // subnetZones: the canvas draws the declared networks' zones at all (the
    // Subnets tab's "Subnet zones"). A view preference, so it is persisted
    // with the other settings and never travels with a document.
    // view: 'map' or 'table' once the visitor has chosen (js/table.js);
    // unset, a phone opens on the table and anything wider on the map.
    // Persisted the same way.
    settings: { traceMode: false, tracePort: '', tracePortOn: false, profile: 'simple', advanced: true, subnetZones: true },
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
