// ---- Groups on the map: frames and collapse (Review-Packs/Topo-groups.md, step B) ----
// Every group with devices in it draws a frame on the map: a rounded box round
// its members, dotted, with no fill, and a tab on its top edge with the
// group's kind, its name and how many devices it holds. A group inside another
// draws its frame inside the other's, so the tree reads off the map as it
// reads off the Groups tab. Frames are not zones: a zone is a subnet's bubble
// (tinted, dashed, labelled with an address), a frame is a place. They sit on
// a layer of their own between the zones and the cables, so neither hides a
// device, and a frame's box is padded wider than a zone's so its tab clears
// the zone's label when a room and a subnet hold the same devices.
//
// The tab's ▾ collapses the group: its devices are drawn as one node (the
// kind's icon, the name, the count) at the centre of where they are. A cable
// with one end inside and one outside is drawn once per outside end, "×3"
// when three cables run there; a cable with both ends inside is not drawn.
// A group inside a collapsed group is folded into the outermost one, and two
// collapsed groups cabled to each other share one line. The collapsed node
// carries its members' findings: the worst of them and how many, so a fault
// is never folded out of sight. Nothing else changes: the checks still run on
// every device, the table and the report still list them, and each device
// keeps its own x and y, so expanding puts every one back exactly where it
// was. A click or tap on the collapsed node, or its ▸, expands it; the
// expanded frame keeps its ▾ on the tab to fold it again.
//
// A click on the collapsed node opens the group rather than selecting it:
// that is what the owner reached for first (Review-Packs/Topo-groups.md,
// "Round 2"). A press that travels past a few pixels is a drag instead, and
// moves the group's devices, one undo step, through the same drag as any set
// (startDrag, js/ui.js); under that distance nothing moves, so a tap with a
// trembling finger never nudges the group a grid step on its way open.
// Selecting the devices is still a gesture away: Shift (Ctrl, Cmd) on the
// node adds them to the selection or takes them out, a press on an expanded
// frame's tab selects them and drags them, and the Groups tab has Select
// members, the way in on a phone, which has no Shift. Delete
// on a set holding devices hidden in a collapsed group asks first
// (deleteSelected, js/app.js): what is about to go is not on screen.
// A collapsed rack also has Open rack beside it (a right-click on it does the
// same), which shows it unit by unit in the rack view (js/rackview.js).
//
// Which groups are collapsed is a view, not the network: it is not in the
// document, the undo timeline, a file or a link (Review-Packs/Topo-groups.md,
// "Data model"). It is kept per document in this browser, under the
// document's id, beside the other view preferences in localStorage; a
// document with no id yet keeps it in memory until it gets one. A document
// drawn on a borrowed canvas (the binder report's pictures) and the reduced
// views draw no frames and collapse nothing.
//
// The drawing is the SVG the exports serialize (canvasSvgMarkup, js/app.js),
// so the PNG, the SVG and the report's diagram show the groups as they are on
// screen. That is why its colours are attributes, not classes: the export
// carries no stylesheet (the same rule the devices and cables follow). The ▾
// is a control, not the network, and is left out of the export.
//
// Its words are plain ones and translated (MESSAGES, js/i18n.js).
// Load order: ... networks -> groups -> groupmap -> table -> ... -> app

const GROUP_KIND_ICONS = {
    building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    floor: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    room: '<path d="M3 21h18M6 21V3h12v18"/><path d="M14 12h.01"/>',
    rack: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M4 7h16M4 12h16M4 17h16M7 4.5h.01M7 9.5h.01M7 14.5h.01M7 19.5h.01"/>',
    custom: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/>'
};

// ---- Which groups are collapsed: a view, per document ----
const COLLAPSED_KEY = 'nettopo_collapsed';
// The documents remembered, newest first; an old one past this is forgotten,
// which costs nothing but its groups opening expanded.
const COLLAPSED_DOCS_MAX = 40;
let _collapsedDoc = null;       // the document id the sets below belong to
let _collapsed = new Set();
// Hosts whose VMs and containers are folded into them ("Hosts on the map",
// below): the same kind of view, kept in the same record beside the groups.
let _foldedHosts = new Set();

function readCollapsedStore() {
    try {
        const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }   // blocked or damaged: everything expanded
}
function storedCollapsed(docId) {
    const rec = docId ? readCollapsedStore()[docId] : null;
    return rec && Array.isArray(rec.ids) ? new Set(rec.ids.filter((x) => typeof x === 'string')) : null;
}
// A record written before hosts folded has no `hosts`: none folded.
function storedHostFolds(docId) {
    const rec = docId ? readCollapsedStore()[docId] : null;
    return rec && Array.isArray(rec.hosts) ? new Set(rec.hosts.filter((x) => typeof x === 'string')) : null;
}
function writeCollapsedStore() {
    if (!_collapsedDoc) return;   // no id yet: in memory until it has one
    try {
        const all = readCollapsedStore();
        if (_collapsed.size || _foldedHosts.size) all[_collapsedDoc] = { ids: [..._collapsed], hosts: [..._foldedHosts], at: Date.now() };
        else delete all[_collapsedDoc];
        Object.keys(all).sort((a, b) => ((all[b] && all[b].at) || 0) - ((all[a] && all[a].at) || 0))
            .slice(COLLAPSED_DOCS_MAX).forEach((k) => { delete all[k]; });
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(all));
    } catch (e) { /* private mode: kept for this visit */ }
}

// Another document is on the canvas (replaceDocument, js/app.js): its own
// set, or none. Called on every replacement, so a template or a link with no
// id never inherits the groups the last one had collapsed.
function groupViewDocChanged() {
    _collapsedDoc = state.docId || null;
    _collapsed = storedCollapsed(_collapsedDoc) || new Set();
    _foldedHosts = storedHostFolds(_collapsedDoc) || new Set();
    pruneHostFolds();   // one kept by a build that let a fold outlive its guests
}
// The same document given an id where it stands (Keep this network, the
// first export or link): what it had collapsed goes with it.
function syncCollapsedDoc() {
    const id = state.docId || null;
    if (id === _collapsedDoc) return;
    const stored = storedCollapsed(id);
    _collapsedDoc = id;
    if (stored) { _collapsed = stored; _foldedHosts = storedHostFolds(id) || new Set(); } else writeCollapsedStore();
}

// The reduced views have no groups to speak of (the Groups tab is the full
// editor's), and a borrowed canvas is another document's picture.
const groupMapShown = () => !!(state.groups && state.groups.length) && !isReduced() && !canvasIsBorrowed();

function collapsedGroupIds() {
    if (!groupMapShown()) return new Set();
    syncCollapsedDoc();
    return _collapsed;
}
const isGroupCollapsed = (id) => collapsedGroupIds().has(id);

// Collapse or expand one group: the map and the Groups tab follow. Not an
// edit: no save(), no undo step, allowed on a read-only document.
function setGroupCollapsed(id, on) {
    if (!groupById(id)) return false;
    syncCollapsedDoc();
    // Where everything is drawn before the change, so its devices can fly in
    // or spread out (js/motion.js).
    const motion = mapMotionStart();
    if (on) _collapsed.add(id); else _collapsed.delete(id);
    writeCollapsedStore();
    renderCanvasOnly();
    mapMotionPlay(motion);
    renderGroupsPanel(true);
    return true;
}
const toggleGroupCollapsed = (id) => setGroupCollapsed(id, !isGroupCollapsed(id));

// ---- Hosts on the map (Review-Packs/Topo-groups.md, "Round 3", item 2) ----
// A device something runs on (node.host, js/model.js "Hosts") carries a
// badge on its card's bottom-left corner: how many VMs and containers run on
// it, a VM's containers counted in. The badge is the fold's control, as a
// frame's ▾ is a group's: a click or a tap on it folds them into the host,
// and on it again (▸) brings them back. Folded, they are drawn as the host,
// which shows a second card behind its own, and their cables are drawn to
// it, once per far end, "×N" when several run there; a cable between a guest
// and its own host is inside the box and not drawn. Like a collapsed group,
// that changes the drawing only: every guest keeps its own x and y and its
// cables, the checks, the table and the report still have each one, and the
// search, the trace, Zoom to matches and a table row reach a folded one
// through its host. A container on a folded VM folds into the VM, or into
// the server when that is folded too (the outermost wins, as with groups).
// A folded host follows a collapsed group's rules (the owner's correction,
// Round 3): a click or a tap on its card unfolds it and leaves the selection
// as it was, a drag moves it, and Shift/Ctrl/Cmd-click selects it
// (armHostFoldTap, the release in js/app.js). Unfolded, a click selects it as
// any device; its badge folds and unfolds it either way.
// Which hosts are folded is a view, kept beside the collapsed groups.
// Not in the reduced views and not on a borrowed canvas, as frames are not.
const hostFoldShown = () => !isReduced() && !canvasIsBorrowed();
function foldedHostIds() {
    if (!hostFoldShown()) return new Set();
    syncCollapsedDoc();
    return _foldedHosts;
}
const isHostFolded = (id) => foldedHostIds().has(id);
// Fold or unfold a host's guests: a view, so no save() and no undo step,
// allowed on a read-only document.
function setHostFolded(id, on) {
    if (!getNode(id)) return false;
    if (on && !state.nodes.some((n) => n && n.host === id)) return false;   // nothing to fold
    syncCollapsedDoc();
    const motion = mapMotionStart();
    if (on) _foldedHosts.add(id); else _foldedHosts.delete(id);
    writeCollapsedStore();
    renderCanvasOnly();
    mapMotionPlay(motion);
    return true;
}
const toggleHostFolded = (id) => setHostFolded(id, !isHostFolded(id));
// A fold lasts only while something runs on the host. Its last guest gone
// (the hosting undone, Runs on set to none or a chip dragged off it, the
// guest deleted or retyped), the host has no badge to unfold it with, yet a
// fold left in the set still made a click on its card unfold that instead of
// selecting it, and folded away out of sight the next VM dropped on it. So
// the set is pruned where the guests can change: save() after repairHosts,
// an undo or a redo (applyDoc, js/app.js), and a document read in. A redo
// that brings the guests back brings them back unfolded: a view, cheap to
// lose. -> true when one was dropped.
function pruneHostFolds(nodes = state.nodes) {
    if (!_foldedHosts.size) return false;   // the common case: no walk
    const hosts = new Set();
    nodes.forEach((n) => { if (n && n.host) hosts.add(n.host); });
    let dropped = false;
    _foldedHosts.forEach((id) => { if (!hosts.has(id)) { _foldedHosts.delete(id); dropped = true; } });
    if (dropped) writeCollapsedStore();
    return dropped;
}
// How many devices run on each host, at any depth: one walk of the devices.
// -> Map host id -> count; empty when nothing runs on anything.
function hostGuestCounts(nodes = state.nodes) {
    const byId = new Map();
    nodes.forEach((n) => { if (n && !byId.has(n.id)) byId.set(n.id, n); });
    const out = new Map();
    nodes.forEach((n) => {
        if (!n || !n.host) return;
        const seen = new Set([n.id]);
        for (let h = byId.get(n.host); h && !seen.has(h.id) && seen.size <= HOST_DEPTH_MAX; h = byId.get(h.host)) {
            seen.add(h.id);
            out.set(h.id, (out.get(h.id) || 0) + 1);
        }
    });
    return out;
}

// ---- What the map draws ----
// Pure over its arguments: which devices are hidden and in which collapsed
// group, the collapsed nodes, the frames and the cables folded together.
//   hidden   Map device id -> the outermost collapsed group it is folded into
//   folds    [{ group, members, x, y }] one per collapsed group drawn
//   frames   [{ group, members, depth, rect }] outermost first, so an inner
//            frame is drawn over the one round it
//   edges    [{ a, b, links }] a and b each { node } or { fold }: the lines
//            that stand for cables with an end in a collapsed group
//   covered  the cables not drawn as themselves (folded into an edge, or
//            with both ends inside one collapsed group)
//   guestHidden  Map device id -> the folded host it is drawn as (a VM or a
//            container folded into its host, "Hosts on the map" above)
//   hostFolds    Map host id -> the devices folded into it
// `folded` is the set of folded hosts. Null when there is nothing to draw.
//
// A frame's box is every visible member's box (the device, its name and two
// address lines under it) and every inner frame's, padded: the tab sits on
// the top edge, high enough above the devices to clear a zone's label.
const GROUP_FRAME = { SIDE: 58, TOP: 84, BOTTOM: 84, NEST_SIDE: 14, NEST_TOP: 30 };
function groupMapView(collapsed = collapsedGroupIds(), nodes = state.nodes, links = state.links, groups = state.groups, folded = new Set()) {
    groups = groups || [];
    if (!groups.length && !folded.size) return null;
    const byId = new Map(groups.map((g) => [g.id, g]));
    // Each group's chain, outermost first, walked once.
    const chains = new Map();
    const chain = (id) => {
        if (chains.has(id)) return chains.get(id);
        const out = [], seen = new Set();
        for (let g = byId.get(id); g && !seen.has(g.id); g = byId.get(g.parent)) { seen.add(g.id); out.unshift(g.id); }
        chains.set(id, out);
        return out;
    };
    const deep = new Map();          // group id -> its devices, at any depth
    const hidden = new Map();
    nodes.forEach((n) => {
        if (!n || !n.group || !byId.has(n.group)) return;
        const c = chain(n.group);
        c.forEach((gid) => { if (!deep.has(gid)) deep.set(gid, []); deep.get(gid).push(n); });
        const top = c.find((gid) => collapsed.has(gid));
        if (top) hidden.set(n.id, top);
    });
    // Guests folded into their host: the outermost folded host on screen.
    // One in a collapsed group is folded into the group already, and so is
    // its host (a guest is in its host's group, repairHosts).
    const guestHidden = new Map(), hostFolds = new Map();
    if (folded.size) {
        const nById = new Map();
        nodes.forEach((n) => { if (n && !nById.has(n.id)) nById.set(n.id, n); });
        nodes.forEach((n) => {
            if (!n || !n.host || hidden.has(n.id)) return;
            let into = null;
            const seen = new Set([n.id]);
            for (let h = nById.get(n.host); h && !seen.has(h.id) && seen.size <= HOST_DEPTH_MAX; h = nById.get(h.host)) {
                seen.add(h.id);
                if (folded.has(h.id)) into = h;
            }
            if (!into || hidden.has(into.id)) return;
            guestHidden.set(n.id, into.id);
            if (!hostFolds.has(into.id)) hostFolds.set(into.id, []);
            hostFolds.get(into.id).push(n);
        });
    }
    if (!deep.size && !guestHidden.size) return null;

    // The collapsed nodes: at the centre of their members' box, so a group
    // spread across the map folds to where it was, not to a corner of it.
    const folds = new Map();
    deep.forEach((members, gid) => {
        if (!collapsed.has(gid) || chain(gid).find((x) => collapsed.has(x)) !== gid) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        members.forEach((n) => { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); });
        folds.set(gid, { group: byId.get(gid), members, x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    });

    // The frames, innermost first, each handing its box to every group round it.
    const F = GROUP_FRAME;
    const framed = [...deep.keys()].filter((gid) => !chain(gid).some((x) => collapsed.has(x)))
        .sort((a, b) => chain(b).length - chain(a).length);
    const boxes = new Map();
    const grow = (gid, x0, y0, x1, y1) => {
        const b = boxes.get(gid);
        if (!b) boxes.set(gid, { x0, y0, x1, y1 });
        else { b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0); b.x1 = Math.max(b.x1, x1); b.y1 = Math.max(b.y1, y1); }
    };
    const framedSet = new Set(framed);
    // Visible devices go in every frame of their chain; a collapsed group's
    // node goes in every frame round it.
    deep.forEach((members, gid) => {
        if (!framedSet.has(gid)) return;
        members.forEach((n) => {
            if (hidden.has(n.id) || guestHidden.has(n.id)) return;
            grow(gid, n.x - F.SIDE, n.y - F.TOP, n.x + F.SIDE, n.y + F.BOTTOM);
        });
    });
    folds.forEach((b, gid) => chain(gid).slice(0, -1).forEach((outer) => {
        if (framedSet.has(outer)) grow(outer, b.x - F.SIDE, b.y - F.TOP, b.x + F.SIDE, b.y + F.BOTTOM);
    }));
    framed.forEach((gid) => {
        const b = boxes.get(gid);
        if (!b) return;
        chain(gid).slice(0, -1).forEach((outer) => {
            if (framedSet.has(outer)) grow(outer, b.x0 - F.NEST_SIDE, b.y0 - F.NEST_TOP, b.x1 + F.NEST_SIDE, b.y1 + F.NEST_SIDE);
        });
    });
    const frames = framed.filter((gid) => boxes.has(gid)).reverse().map((gid) => {
        const b = boxes.get(gid);
        return { group: byId.get(gid), members: deep.get(gid), depth: chain(gid).length - 1,
            rect: { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } };
    });

    // The cables. Nothing to fold while nothing is collapsed, and then the
    // cable list is not walked at all (a whole-site drag redraws the frames
    // on every step, tests/suites/perf.js).
    // A folded guest's end is its host's.
    const covered = new Set(), edges = new Map();
    if (hidden.size || guestHidden.size) {
        links.forEach((l) => {
            const ha = hidden.get(l.source), hb = hidden.get(l.target);
            const na = ha ? null : guestHidden.get(l.source), nb = hb ? null : guestHidden.get(l.target);
            if (!ha && !hb && !na && !nb) return;
            covered.add(l.id);
            const ka = ha ? `g\u0000${ha}` : `n\u0000${na || l.source}`, kb = hb ? `g\u0000${hb}` : `n\u0000${nb || l.target}`;
            if (ka === kb) return;   // wholly inside one collapsed group, or one host
            const key = ka < kb ? `${ka}\u0001${kb}` : `${kb}\u0001${ka}`;
            if (!edges.has(key)) edges.set(key, { a: ha ? { fold: ha } : { node: na || l.source }, b: hb ? { fold: hb } : { node: nb || l.target }, links: [] });
            edges.get(key).links.push(l);
        });
        // A folded host's own cable to where a folded guest's also runs
        // would be drawn twice, one line on the other: it joins that line,
        // which then counts both ("×2"). Its other cables stay its own.
        if (hostFolds.size) {
            links.forEach((l) => {
                if (covered.has(l.id) || !(hostFolds.has(l.source) || hostFolds.has(l.target))) return;
                const ka = `n\u0000${l.source}`, kb = `n\u0000${l.target}`;
                const e = edges.get(ka < kb ? `${ka}\u0001${kb}` : `${kb}\u0001${ka}`);
                if (!e) return;
                covered.add(l.id);
                e.links.push(l);
            });
        }
    }
    return { hidden, folds: [...folds.values()], frames, edges: [...edges.values()], covered, guestHidden, hostFolds };
}
// What the map draws now: the groups (while there are any) and the folded
// hosts (in any network the full editor shows).
const groupMapNow = () => (hostFoldShown() ? groupMapView(collapsedGroupIds(), state.nodes, state.links, state.groups, foldedHostIds()) : null);
// Whether a drag step redraws the overlay: frames, a fold, or a drop armed.
const mapOverlayLive = () => hostFoldShown() && (groupMapShown() || foldedHostIds().size > 0 || !!_gmDrop);

// ---- Drawing ----
const GM_NS = 'http://www.w3.org/2000/svg';
const gmEl = (tag, attrs) => {
    const el = document.createElementNS(GM_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
};
const gmIcon = (kind, size, stroke) => {
    const holder = document.createElementNS(GM_NS, 'g');
    holder.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="${stroke}" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round">${GROUP_KIND_ICONS[asGroupKind(kind)]}</svg>`;
    return holder.firstChild;
};
const GM_COARSE = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } })();
// The control on a tab and its hit area: a tap target, not the glyph's size.
// It is never drawn inside the element that a press selects (the tab, the
// collapsed node) but beside it: Chromium's touch adjustment drops a tap
// target that holds another one, so on a zoomed-out phone a tap meant for a
// frame's tab (which selects) snapped to its ▾ and folded the group.
function gmToggle(gid, collapsed, extra) {
    const g = gmEl('g', { class: extra ? `grp-toggle ${extra}` : 'grp-toggle', 'data-grp': gid, role: 'button' });
    // A wider target than the glyph, unpainted but pressable: a fingertip on
    // a phone, where the map is zoomed out and there is no hover to aim with.
    // Wider still on a touch screen. It grows away from what it sits on (up
    // and left of a node's card, left along a frame's edge), so it takes
    // almost none of the card or the tab a press should select.
    const side = GM_COARSE ? 40 : 30;
    g.appendChild(gmEl('rect', { x: 9 - side, y: collapsed ? 9 - side : -side / 2, width: side, height: side, fill: 'transparent', class: 'grp-toggle-hit' }));
    g.appendChild(gmEl('rect', { x: -9, y: -9, width: 18, height: 18, rx: 4, fill: '#f1f5f9', stroke: '#cbd5e1' }));
    // ▾ open, ▸ collapsed: drawn, not a character, so every engine agrees.
    g.appendChild(gmEl('path', { d: collapsed ? 'M-2 -4 L2 0 L-2 4' : 'M-4 -2 L0 2 L4 -2', fill: 'none', stroke: '#334155', 'stroke-width': 1.75,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const tip = gmEl('title');
    tip.textContent = t(collapsed ? 'Expand' : 'Collapse');
    g.appendChild(tip);
    g.addEventListener('mousedown', (e) => e.stopPropagation());   // no drag, no deselect
    g.addEventListener('click', (e) => { e.stopPropagation(); toggleGroupCollapsed(gid); });
    return g;
}

// Pressing a frame's tab (or Shift on a collapsed node): the group's devices
// are the selection, and a drag moves them. Shift/Ctrl/Cmd adds them or takes
// them out, as on one device.
function pressGroup(event, members) {
    event.stopPropagation();
    if (state.linkSourceId || !members.length) return;
    const entries = members.map((n) => ({ type: 'node', id: n.id }));
    const all = members.every((n) => inSelection('node', n.id));
    if (addsToSelection(event)) {
        const ids = new Set(members.map((n) => n.id));
        selectEntries(all ? [...state.selection].filter((e) => !(e.type === 'node' && ids.has(e.id))) : [...state.selection, ...entries]);
        return;
    }
    // Already the selection: leave it be, so the bulk panel's draft stays.
    if (!(all && state.selection.size === members.length)) selectEntries(entries);
    dragCollapse = null;
    startDrag(event, members, members[0]);
}

// A plain press on a collapsed node: a tap until the pointer travels past a
// few screen pixels, then a drag. A finger wobbles more than a mouse, so a
// press from a touch (Chromium marks the mouse events it makes from a tap
// with sourceCapabilities.firesTouchEvents) or on a coarse-pointer screen
// gets the wider margin.
let _gmFoldPress = null;        // { gid or host, x, y, slop, moved } while pressed
let _gmTapExpandedAt = -Infinity;
const GM_TAP_SLOP = { mouse: 4, touch: 10 };
const gmSlopOf = (event) => (GM_COARSE || (event.sourceCapabilities && event.sourceCapabilities.firesTouchEvents)
    ? GM_TAP_SLOP.touch : GM_TAP_SLOP.mouse);

function pressFold(event, group, members) {
    // Shift/Ctrl/Cmd: about the selection, as it is on a device.
    if (addsToSelection(event)) { _gmFoldPress = null; pressGroup(event, members); return; }
    event.stopPropagation();
    _gmFoldPress = null;
    // Only the main button taps or drags. A right press is the rack's Open
    // rack shortcut (its contextmenu, below), which must not also expand the
    // group behind the view it opens; a middle press is the browser's.
    if (event.button > 0) return;
    if (state.linkSourceId || !members.length) return;
    // Arm the drag (none in a read-only document: startDrag arms nothing
    // there, and the tap still opens the group, which is a view). The
    // selection is left as it is: a tap is not about it. When every device
    // in the group is selected among others, the whole selection moves, as a
    // press on one device of a set moves the set.
    const picked = selectedOf('node');
    const all = members.every((n) => inSelection('node', n.id));
    const set = all && picked.length > members.length ? picked.map(getNode).filter(Boolean) : members;
    dragCollapse = null;
    startDrag(event, set, members[0]);
    _gmFoldPress = { gid: group.id, x: event.clientX, y: event.clientY, slop: gmSlopOf(event), moved: false };
}

// A plain press on a folded host's card (js/ui.js): the same tap-or-drag as
// on a collapsed group's node. The caller has armed the drag (the host alone,
// or the set it is one of); this only arms the tap, which unfolds it.
function armHostFoldTap(event, id) {
    _gmFoldPress = { host: id, x: event.clientX, y: event.clientY, slop: gmSlopOf(event), moved: false };
}

// The drag's mousemove (js/app.js) asks this first: true while the press on a
// collapsed node is still a tap, so nothing moves yet.
function foldPressHolds(event) {
    const p = _gmFoldPress;
    if (!p || p.moved) return false;
    if (Math.hypot(event.clientX - p.x, event.clientY - p.y) <= p.slop) return true;
    p.moved = true;
    return false;
}

// The release (js/app.js): { gid } or { host } when the press was a tap, for
// the caller to expand or unfold, or null (no press on a collapsed node or a
// folded host, or a drag).
function takeFoldTap(event) {
    const p = _gmFoldPress;
    _gmFoldPress = null;
    if (!p || p.moved) return null;
    // A real release is held to the same margin as the moves; one with no
    // position (a synthetic event, 0,0) counts as where the press was.
    const placed = event && (event.clientX || event.clientY);
    if (placed && Math.hypot(event.clientX - p.x, event.clientY - p.y) > p.slop) return null;
    if (p.host) return getNode(p.host) && isHostFolded(p.host) ? { host: p.host } : null;
    return groupById(p.gid) ? { gid: p.gid } : null;
}

// A group opened by a tap. Its node is gone when the second click of a
// habitual double-click lands, so that click falls on whatever was under the
// node (empty canvas, often: the node sits at its members' centre) and must
// not count as a double-click there, which drops a text note (js/app.js).
// A folded host unfolds in place: the second click of a double-click lands
// on its card and selects it, as a click on an unfolded host does.
function expandFoldTapped(tap) {
    _gmTapExpandedAt = Date.now();
    if (tap.host) setHostFolded(tap.host, false);
    else setGroupCollapsed(tap.gid, false);
}
const groupTapJustExpanded = () => Date.now() - _gmTapExpandedAt < 600;

// ---- Drop in, drop out (Review-Packs/Topo-groups.md, "Round 2", item 2) ----
// A device dragged on the map and let go inside a group's frame goes into
// the innermost frame under the pointer; let go outside every frame, it is in
// no group; let go on a collapsed group's node, it goes into that group, which
// stays collapsed (the device is folded in with the rest). A drag that ends
// inside the frame of the group it is already in only moves it. The pointer
// decides, not the device's box: it is what the person aims with, and what
// the highlight follows.
//
// While the drag lasts, the frames hold still where they were when it
// started. Left to follow their members, as they did, the frame of the
// device being dragged would stretch after it and the pointer could never
// leave it. They are drawn afresh round where the devices are on release.
//
// A set dragged (several devices selected) goes in together. One exception
// keeps a whole-site drag (Ctrl+A) or a whole room's from emptying the tree:
// a group every one of whose devices is in the set travels with it, as its
// cargo. Its frame follows the drag, it is no target, and its devices keep
// their group. A device dragged alone is never cargo: that is how the last
// device leaves a group. Devices folded into a collapsed group that ride
// along in a selection only move: what is not on screen is not re-filed.
//
// The move and the membership are one undo step (the release's save()). Out
// of a rack, a device's units go with it (rackKeysLost, js/model.js); into a
// rack from anywhere else, it is in the rack without units yet, and the toast
// says so. Not in a read-only document (startDrag arms no drag there), not
// in the reduced views (no frames), and not for a collapsed node's or a
// tab's drag, which move a group and arm none of this.
//
// A finger drags a device as a mouse does (touchPressNode, js/app.js), with
// the same drops; the Group picker in its Asset section and Move to group
// are the other ways in.
//
// Onto a host ("Round 3", item 2): a VM or a container dragged (or a set of
// nothing but those) and let go on a device it may run on (canHost,
// js/model.js) runs on that device from then on: a guest. The device under
// the pointer is the target before any frame round it, and it is lit in its
// own way (a ring round the card and a label "Runs on Hyper-V 1" in the info
// colour, where a group's are the accent's), so the two drops never read
// alike. A guest is where its host is, so the save puts it in the host's
// group and the cue says nothing about groups. A guest dragged anywhere else
// only moves: its host, not the map, says where it is. The move and the new
// host are one undo step, the release's save().
//
// Onto another device ("Round 3", item 1): a device dragged (or a set) and let
// go on top of another device's card, one in no group or in the group they
// are all in, offers to make a new group of them (offerGroupFromPair, below).
// A host for a VM is asked first, so a VM let go on a server runs on it, as
// above; a device that is neither a host nor a partner leaves the frame round
// it to answer. Its own cue: a dashed ring in the ok colour and "New group
// with …", so the three drops never read alike.
let _gmDrop = null;   // { start, cargo, movers, guests, pairs, common, dragged, target, pt } while a device drag is armed
// Every drag starts disarmed (startDrag, js/ui.js): only a device's press arms it.
const clearGroupDrop = () => { _gmDrop = null; };

// Called by a device's press (js/ui.js) after startDrag, with what it moves.
function armGroupDrop(items) {
    _gmDrop = null;
    if (!isDraggingNode || !hostFoldShown()) return;
    const start = groupMapNow();
    const nodes = items.filter((it) => it && getNode(it.id) === it);
    const ids = new Set(nodes.map((n) => n.id));
    const hiddenNow = (id) => !!start && (start.hidden.has(id) || start.guestHidden.has(id));
    // Into a group: while there are frames or collapsed nodes to drop on.
    const cargo = new Set();
    let movers = [];
    if (start && groupMapShown() && (start.frames.length || start.folds.length)) {
        if (nodes.length > 1) {
            start.frames.forEach((f) => { if (f.members.every((m) => ids.has(m.id))) cargo.add(f.group.id); });
            start.folds.forEach((f) => { if (f.members.every((m) => ids.has(m.id))) cargo.add(f.group.id); });
        }
        // A VM on a host is where its host is (js/model.js "Hosts"): dragged, it
        // only moves on the map, and the host takes it into a group or out.
        movers = nodes.filter((n) => !hiddenNow(n.id) && !(n.group && cargo.has(n.group)) && !hostOf(n));
    }
    // Onto a host: every device dragged that is on screen is a VM or a container.
    const shown = nodes.filter((n) => !hiddenNow(n.id));
    const guests = shown.length && shown.every((n) => isVirtualType(n.type)) ? shown : [];
    // Onto another device, for a new group: the devices dragged that are on
    // screen and say where they are themselves (a guest's host does that for
    // it). Not while a whole group rides along as cargo, which keeps its
    // group, and not when every device on the map is dragged: there is
    // nothing left to let go on, and a whole-site drag stays cheap.
    const pairs = cargo.size || ids.size >= state.nodes.length ? [] : shown.filter((n) => !hostOf(n));
    // The group they are all in (null: none), or undefined when they differ.
    const gOf = (n) => (n.group && groupById(n.group) ? n.group : null);
    const common = pairs.length && pairs.every((n) => gOf(n) === gOf(pairs[0])) ? gOf(pairs[0]) : undefined;
    if (!movers.length && !guests.length && !pairs.length) return;
    _gmDrop = { start, cargo, movers, guests, pairs, common, dragged: ids, target: undefined, pt: null };
}

// The device under a workspace point that every guest dragged may run on, or
// null: the card (its name under it too, which the pointer often rests on),
// the one drawn last on top. A device dragged is never one; nor is one folded
// out of sight. A device under the pointer that cannot host them is no
// target, and the frame round it is asked instead.
const GM_HOST_HIT = { X: 28, TOP: 28, BOTTOM: 40 };
function hostDropTargetAt(pt, drop = _gmDrop) {
    if (!drop || !pt || !drop.guests.length) return null;
    const start = drop.start;
    let under = null;
    state.nodes.forEach((n) => {
        if (!n || drop.dragged.has(n.id) || (start && (start.hidden.has(n.id) || start.guestHidden.has(n.id)))) return;
        if (Math.abs(pt.x - n.x) <= GM_HOST_HIT.X && pt.y >= n.y - GM_HOST_HIT.TOP && pt.y <= n.y + GM_HOST_HIT.BOTTOM) under = n;
    });
    // Not onto one of their own guests (a VM's container under the VM dragged).
    if (!under || hostChainOf(under).some((h) => drop.dragged.has(h.id))) return null;
    return drop.guests.every((g) => canHost(g.type, under)) ? under : null;
}

// The device whose card is under a workspace point, that the devices dragged
// may make a new group with, or null: { pair, parent }, parent being the group
// the new one goes inside (null: at the top). The card itself, not its name
// under it: a device let go just beside another, to sit next to it, is an
// ordinary move and asks nothing. A partner is in no group, or in the one
// every device dragged is in, and then the new group goes inside that one.
// Not a guest, whose host says where it is; and not inside a rack, where
// devices sit in units, not in groups of their own.
const GM_PAIR_HIT = 26;
function pairDropTargetAt(pt, drop = _gmDrop) {
    if (!drop || !pt || !drop.pairs || !drop.pairs.length) return null;
    const start = drop.start;
    let under = null;
    state.nodes.forEach((n) => {
        if (!n || drop.dragged.has(n.id) || (start && (start.hidden.has(n.id) || start.guestHidden.has(n.id)))) return;
        if (Math.abs(pt.x - n.x) <= GM_PAIR_HIT && Math.abs(pt.y - n.y) <= GM_PAIR_HIT) under = n;
    });
    if (!under || hostOf(under)) return null;
    const parent = under.group && groupById(under.group) ? under.group : null;
    if (parent && parent !== drop.common) return null;
    if (isRackGroup(groupById(parent))) return null;
    return { pair: under.id, parent };
}

// What is under the pointer: { host } (a device to run on), { pair, parent }
// (a device to make a new group with), { gid, fold } (a group), or null (no
// group). A host first: a VM let go on a server runs on it.
function dropTargetAt(pt, drop = _gmDrop) {
    const host = hostDropTargetAt(pt, drop);
    if (host) return { host: host.id };
    return pairDropTargetAt(pt, drop) || groupDropTargetAt(pt, drop);
}

// The frame or collapsed node under a workspace point, innermost first:
// { gid, fold } or null. Cargo is never a target.
const GM_FOLD_HIT = { X: 34, TOP: 34, BOTTOM: 50 };   // the card, its name and its count
function groupDropTargetAt(pt, drop = _gmDrop) {
    if (!drop || !pt || !drop.movers.length) return null;
    const { start, cargo } = drop;
    for (let i = start.folds.length - 1; i >= 0; i--) {
        const f = start.folds[i];
        if (cargo.has(f.group.id)) continue;
        if (Math.abs(pt.x - f.x) <= GM_FOLD_HIT.X && pt.y >= f.y - GM_FOLD_HIT.TOP && pt.y <= f.y + GM_FOLD_HIT.BOTTOM) return { gid: f.group.id, fold: true };
    }
    let best = null;
    start.frames.forEach((f) => {
        if (cargo.has(f.group.id)) return;
        const r = f.rect;
        // The tab rides the top edge: a drop on it counts.
        if (pt.x < r.x || pt.x > r.x + r.w || pt.y < r.y - 10 || pt.y > r.y + r.h) return;
        if (!best || f.depth >= best.depth) best = f;   // the later of two equals is drawn on top
    });
    return best ? { gid: best.group.id, fold: false } : null;
}

// The devices a drop on `target` would change: the guests not already on
// that host, every device of a new group, or the devices whose group it
// would change.
const groupDropChanges = (drop, target) => (target && target.host
    ? drop.guests.filter((n) => n.host !== target.host)
    : target && target.pair ? drop.pairs.slice()
    : drop.movers.filter((n) => (n.group && groupById(n.group) ? n.group : null) !== (target ? target.gid : null)));

// The drag's mousemove (js/app.js), before the overlay is redrawn: what is
// under the pointer now.
function trackGroupDrop(event) {
    if (!_gmDrop) return;
    const pt = getWorkspacePoint(event.clientX, event.clientY);
    _gmDrop.pt = pt;
    _gmDrop.target = dropTargetAt(pt);
}

// The release (js/app.js): the drop to write, or null, and the drag forgotten
// either way. A release with no position (a synthetic one) counts as where
// the pointer last was.
function takeGroupDrop(event) {
    const drop = _gmDrop;
    _gmDrop = null;
    if (!drop) return null;
    const placed = event && (event.clientX || event.clientY);
    const target = placed ? dropTargetAt(getWorkspacePoint(event.clientX, event.clientY), drop) : drop.target;
    if (target === undefined) return null;   // it never moved
    const changes = groupDropChanges(drop, target);
    // Onto a host, the guests dragged that already run there are let go on
    // its card too, so they are set beside it as well (applyHostDrop).
    if (target && target.host) return changes.length || drop.guests.some((n) => n.host === target.host) ? { target, changes, guests: drop.guests } : null;
    return changes.length ? { target, changes } : null;
}

// Write a drop, inside the release's batch. -> what the toast says, or ''.
// A new group from two devices is not written here: it asks first
// (offerGroupFromPair), and the release hands it there.
function applyGroupDrop(drop) {
    if (!drop || (drop.target && drop.target.pair)) return '';
    if (drop.target && drop.target.host) return applyHostDrop(drop);
    const g = drop.target ? groupById(drop.target.gid) : null;
    if (drop.target && !g) return '';
    let unplaced = 0, bumped = 0, virtual = 0;
    drop.changes.forEach((n) => {
        rackKeysLost(n, g).forEach((k) => { delete n[k]; });
        if (g) n.group = g.id; else delete n.group;
        // From one rack into another it keeps its units (rackKeysLost), but
        // they are the old rack's numbers: where they are taken in this one,
        // or past its top, keeping them would make an overlap nobody was told
        // about. It goes to Not placed yet instead, keeping its height and
        // depth as Take out does (rackStep 'out', js/rackview.js), and the
        // toast says why. Checked one by one, so two devices of a set that
        // would land on each other are caught too.
        if (isRackGroup(g) && Number.isInteger(n.rackU)
            && !rackSpanCheck(g, rackFaceOf(n), n.rackU, rackHeightOf(n), n.id).ok) {
            delete n.rackU; delete n.rackFace;
            bumped++;
        }
        // A VM or a container takes no units (js/rackview.js): Open rack has
        // no place for it, so the toast points at its host instead.
        if (isRackGroup(g) && !Number.isInteger(n.rackU)) { if (isVirtualType(n.type)) virtual++; else unplaced++; }
    });
    const one = drop.changes.length === 1;
    const name = one ? (drop.changes[0].name || drop.changes[0].id) : '';
    const lines = [g
        ? t(one ? '{name} is in {group} now.' : '{n} devices are in {group} now.', { name, n: drop.changes.length, group: groupLabel(g) })
        : t(one ? '{name} is in no group now.' : '{n} devices are in no group now.', { name, n: drop.changes.length })];
    if (bumped) {
        lines.push(t(one ? 'Its units were taken there, or past the top, so it has none yet: Open rack places it.'
            : '{n} of them had units that were taken there, or past the top, so they have none yet: Open rack places them.', { n: bumped }));
    }
    if (unplaced > bumped) lines.push(t(unplaced - bumped === 1 ? 'It has no units in the rack yet: Open rack places it.' : 'They have no units in the rack yet: Open rack places them.'));
    if (virtual) lines.push(t(virtual === 1 ? 'A VM or a container takes no units: it is where the device it runs on is. Set that in its Runs on.'
        : 'VMs and containers take no units: each is where the device it runs on is. Set that in its Runs on.'));
    return lines.join(' ');
}

// A drop onto a host: each guest runs on it. The save() the release's batch
// ends with (repairHosts) puts them in the host's group. -> the toast.
function applyHostDrop(drop) {
    const host = getNode(drop.target.host);
    const guests = drop.changes.filter((n) => host && canHost(n.type, host) && n !== host);
    guests.forEach((n) => { n.host = host.id; });
    // Let go on the host's card, a guest would sit on it and hide it (and a
    // click there would reach the guest): each is set in the nearest free
    // place beside it instead, in the same undo step.
    if (host) gmSetBeside(host, (drop.guests || guests).filter((n) => n.host === host.id));
    if (!guests.length) return '';
    return t(guests.length === 1 ? '{name} runs on {host} now.' : '{n} devices run on {host} now.',
        { name: guests[0].name || guests[0].id, n: guests.length, host: host.name || host.id });
}

// Places round `host`, a card's width and a card-and-name's height apart,
// nearest first (right, below, left, above on a tie), on the grid; each of
// `nodes` takes the next one clear of every other card. A ring that is full
// sends it further out; past GM_SIDE_RINGS it stays where it was let go.
const GM_SIDE = { X: 100, Y: 110, CLEAR_X: 90, CLEAR_Y: 100 }, GM_SIDE_RINGS = 6;
function gmSetBeside(host, nodes) {
    if (!nodes.length) return;
    const moving = new Set(nodes.map((n) => n.id));
    const others = state.nodes.filter((n) => n && !moving.has(n.id));
    const free = (x, y) => others.every((o) => Math.abs(o.x - x) >= GM_SIDE.CLEAR_X || Math.abs(o.y - y) >= GM_SIDE.CLEAR_Y);
    const tie = (i, j) => (i > 0 && j === 0 ? 0 : j > 0 ? 1 : i < 0 ? 2 : 3);
    const spots = [];
    for (let i = -GM_SIDE_RINGS; i <= GM_SIDE_RINGS; i++) {
        for (let j = -GM_SIDE_RINGS; j <= GM_SIDE_RINGS; j++) if (i || j) spots.push({ i, j, d: Math.hypot(i, j) });
    }
    spots.sort((a, b) => a.d - b.d || tie(a.i, a.j) - tie(b.i, b.j));
    let k = 0;
    nodes.forEach((n) => {
        while (k < spots.length) {
            const x = Math.round((host.x + spots[k].i * GM_SIDE.X) / GRID_SNAP) * GRID_SNAP;
            const y = Math.round((host.y + spots[k].j * GM_SIDE.Y) / GRID_SNAP) * GRID_SNAP;
            k++;
            if (free(x, y)) { n.x = x; n.y = y; others.push(n); return; }
        }
    });
}

// ---- A new group from two devices ("Round 3", item 1) ----
// Let go on another device (pairDropTargetAt), the devices dragged have moved
// but nothing is filed yet: the release (js/app.js) hands the drop here and
// the question decides what the one undo step holds. Make group: a new group
// with the name and kind given, inside the group they share when they share
// one, holding the devices dragged and the one let go on, those dragged set
// beside it (gmSetBeside) rather than on top of it, the move and all of it
// one step. Cancel (or Esc): the move alone, as an ordinary drag, left where
// it was let go. A document that changed under the question (another one
// opened) is not written into.
//
// The kind is guessed from where the group goes: inside a building a floor,
// inside a floor a room, inside a room a rack when every device in it is the
// kind of gear a rack holds (else a group of the visitor's own), and a group
// of the visitor's own at the top. The name is the kind's word and the next
// free number ("Group 3", "Rack 2"), and follows the kind while it is not
// retyped (askPromptPick, js/dialog.js). -> a Promise of the group made, or null.
const GM_RACK_GUESS = new Set(['router', 'l3switch', 'switch', 'firewall', 'loadbalancer', 'edge', 'vpn', 'server']);
function guessPairKind(parent, devices) {
    if (!parent) return 'custom';
    const kind = CHILD_KIND[asGroupKind(parent.kind)] || 'custom';
    return kind === 'rack' && !devices.every((n) => GM_RACK_GUESS.has(n.type)) ? 'custom' : kind;
}
function nextGroupName(kind) {
    const base = groupKindName(kind);
    const taken = new Set((state.groups || []).map((g) => groupLabel(g).toLowerCase()));
    let i = 1;
    while (taken.has(`${base} ${i}`.toLowerCase())) i++;
    return `${base} ${i}`;
}
let _gmPairAsked = false;   // the pair question is open: its move waits to be one step with the group
async function offerGroupFromPair(drop) {
    const other = getNode(drop.target.pair);
    const parentId = drop.target.parent || null;
    const devices = drop.changes.filter((n) => n && n !== other);
    const fileMove = () => { save(); renderCanvasOnly(); return null; };
    if (!other || !devices.length || readOnlyRefuses()) return fileMove();
    const parent = groupById(parentId);
    const kind = guessPairKind(parent, devices.concat(other));
    const one = devices.length === 1;
    const name = (n) => n.name || n.id;
    const lines = [one ? t('Make a new group of {a} and {b}?', { a: name(devices[0]), b: name(other) })
        : t('Make a new group of {n} devices and {b}?', { n: devices.length, b: name(other) })];
    if (parent) lines.push(t('It goes inside {group}.', { group: groupLabel(parent) }));
    lines.push(t(one ? 'Cancel only moves {a}.' : 'Cancel only moves them.', { a: one ? name(devices[0]) : '' }));
    // While asked, the move is in the model unfiled (flushPendingSaves, js/app.js).
    _gmPairAsked = true;
    let answer = null;
    try {
        answer = await askPromptPick(lines.join('\n'), {
            title: t('New group'), ok: t('Make group'), value: nextGroupName(kind),
            pick: { label: t('Kind'), value: kind, options: GROUP_KINDS.map((k) => ({ id: k, label: groupKindName(k), text: nextGroupName(k) })) }
        });
    } finally { _gmPairAsked = false; }
    // Still the same document, devices and group as when it was asked?
    const here = (n) => getNode(n.id) === n;
    if (!answer || !here(other) || !devices.every(here) || (parentId && !groupById(parentId)) || state.readOnly) return fileMove();
    let g = null, said = '';
    // The devices step aside into place and the new frame fades in round them.
    const motion = mapMotionStart();
    batch(() => {
        g = makeGroup({ name: groupName(answer.value), kind: asGroupKind(answer.pick), parent: parentId });
        state.groups = state.groups.concat(g);
        gmSetBeside(other, devices);
        said = applyGroupDrop({ target: { gid: g.id, fold: false }, changes: devices.concat(other) });
        save(); renderCanvasOnly();
    });
    mapMotionPlay(motion, { pulse: g && g.id });
    refreshGroupViews(true);
    if (said) showToast(said, 'ok');
    return g;
}

// While a drop is armed, what the drag shows: the frames held where they
// were (cargo excepted, which follows), the target lit, and a label at the
// pointer saying where the devices go. Neither is ever exported: an export
// does not happen mid-drag.
function gmDropFrames(view) {
    const drop = _gmDrop;
    if (!drop || !view || !drop.start) return view;
    const held = new Map(drop.start.frames.map((f) => [f.group.id, f]));
    view.frames = view.frames.map((f) => (drop.cargo.has(f.group.id) ? f : held.get(f.group.id) || f));
    return view;
}
function drawGroupDropCue() {
    const drop = _gmDrop;
    if (!drop || drop.target === undefined || !drop.pt) return;
    const changes = groupDropChanges(drop, drop.target);
    if (!changes.length) return;
    if (drop.target && drop.target.host) { drawHostDropCue(drop, changes); return; }
    if (drop.target && drop.target.pair) { drawPairDropCue(drop); return; }
    const g = drop.target ? groupById(drop.target.gid) : null;
    if (g) {
        const lit = drop.target.fold ? document.getElementById(`ui-group-${g.id}`)
            : document.getElementById('layer-groups').querySelector(`.grp-frame[data-grp="${CSS.escape(g.id)}"]`);
        if (lit) lit.classList.add('grp-drop');
        // A collapsed node gets a ring under its cards, as the search's is.
        if (lit && drop.target.fold) lit.insertBefore(gmEl('rect', { class: 'grp-drop-ring', x: -36, y: -38, width: 76, height: 92, rx: 12 }), lit.firstChild);
    } else {
        // Out of every group: the frames being left say so.
        const from = new Set(changes.map((n) => n.group).filter(Boolean));
        document.querySelectorAll('#layer-groups .grp-frame').forEach((el) => { if (from.has(el.dataset.grp)) el.classList.add('grp-drop-out'); });
    }
    gmDropLabel(drop.pt, g ? t('Into {group}', { group: groupLabel(g) }) : t('Into no group'), 'grp-drop-cue');
}

// The label at the pointer: a pill with the words, sized to them.
function gmDropLabel(pt, text, cls) {
    const cue = gmEl('g', { class: `grp-drawn ${cls}`, transform: `translate(${pt.x + 14}, ${pt.y - 22})` });
    cue.style.pointerEvents = 'none';
    const pill = gmEl('rect', { class: 'grp-drop-pill', x: 0, y: -11, width: 40, height: 22, rx: 11 });
    const label = gmEl('text', { class: 'grp-drop-text', x: 10, y: 4, 'font-size': 11, 'font-family': 'sans-serif', 'font-weight': 600 });
    label.textContent = text;
    cue.appendChild(pill);
    cue.appendChild(label);
    document.getElementById('layer-nodes').appendChild(cue);
    let width = 20 + text.length * 6.5;
    try { const bb = label.getBBox(); if (bb.width) width = 20 + bb.width; } catch (e) { /* not laid out */ }
    pill.setAttribute('width', String(Math.round(width)));
}

// Onto a host: a ring round its card, under the card (as the search's ring
// is), and the label saying what the guests will run on. Its own colour
// (css/app.css .host-drop-*), so it is never read as a group's drop.
function drawHostDropCue(drop, changes) {
    const host = getNode(drop.target.host);
    const el = host && document.getElementById(`ui-node-${host.id}`);
    if (!el) return;
    el.insertBefore(gmEl('rect', { class: 'grp-drawn host-drop-ring', x: -32, y: -32, width: 64, height: 64, rx: 10 }), el.firstChild);
    const one = changes.length === 1;
    gmDropLabel(drop.pt, one ? t('Runs on {host}', { host: host.name || host.id })
        : t('{n} devices run on {host}', { n: changes.length, host: host.name || host.id }), 'grp-drop-cue host-drop-cue');
}

// Onto another device: a dashed ring round its card, a frame about to be
// drawn, and the label naming it (and the group the new one goes inside).
// Its own colour (css/app.css .pair-drop-*): neither a frame's nor a host's.
function drawPairDropCue(drop) {
    const other = getNode(drop.target.pair);
    const el = other && document.getElementById(`ui-node-${other.id}`);
    if (!el) return;
    el.insertBefore(gmEl('rect', { class: 'grp-drawn pair-drop-ring', x: -36, y: -36, width: 72, height: 72, rx: 12 }), el.firstChild);
    const parent = groupById(drop.target.parent);
    gmDropLabel(drop.pt, parent ? t('New group with {name}, inside {group}', { name: other.name || other.id, group: groupLabel(parent) })
        : t('New group with {name}', { name: other.name || other.id }), 'grp-drop-cue pair-drop-cue');
}

let _gmLast = { reach: null, qm: null, rollup: new Map() };
const GM_TAB_TOGGLE_W = 16;   // the room the ▾ takes at a frame tab's left end

function drawGroupFrames(view) {
    const layer = document.getElementById('layer-groups');
    if (!layer) return;
    layer.innerHTML = '';
    if (!view) return;
    const counts = new Map(view.frames.map((f) => [f.group.id, f.members.length]));
    view.frames.forEach(({ group, rect }) => {
        const g = gmEl('g', { class: 'grp-frame', 'data-grp': group.id });
        g.appendChild(gmEl('rect', { x: rect.x, y: rect.y, width: rect.w, height: rect.h, rx: 14,
            fill: 'none', stroke: '#64748b', 'stroke-opacity': 0.6, 'stroke-width': 1.5, 'stroke-dasharray': '1.5 4.5', 'stroke-linecap': 'round' }));
        // The tab: the control, the kind's icon, the name and the count, on
        // the top edge. Its own group so a press on it can be told from one
        // on the empty frame (which pans, as the canvas does).
        const tab = gmEl('g', { class: 'grp-tab', transform: `translate(${rect.x + 14}, ${rect.y})` });
        // The left GM_TAB_TOGGLE_W of the pill is the ▾'s seat; an export,
        // which leaves the ▾ out, closes it up (canvasSvgMarkup, js/app.js).
        const pill = gmEl('rect', { class: 'grp-tab-pill', x: 0, y: -10, width: 120, height: 20, rx: 10, fill: '#ffffff', stroke: '#94a3b8', 'stroke-width': 1 });
        tab.appendChild(pill);
        const icon = gmEl('g', { class: 'grp-tab-icon', transform: `translate(${8 + GM_TAB_TOGGLE_W}, -6)` });
        icon.appendChild(gmIcon(group.kind, 12, '#475569'));
        icon.style.pointerEvents = 'none';
        tab.appendChild(icon);
        const text = gmEl('text', { class: 'grp-tab-text', x: 24 + GM_TAB_TOGGLE_W, y: 3.5, 'font-size': 10, 'font-family': 'sans-serif', 'font-weight': 600, fill: '#334155' });
        text.textContent = `${groupLabel(group)} · ${counts.get(group.id)}`;
        text.style.pointerEvents = 'none';
        tab.appendChild(text);
        const tip = gmEl('title');
        tip.textContent = `${groupPath(group)}\n${devicesText(counts.get(group.id))}\n${t('Click to select its devices.')}`;
        tab.appendChild(tip);
        tab.addEventListener('mousedown', (e) => pressGroup(e, groupMembers(group.id, true)));
        g.appendChild(tab);
        // Over the tab's left end, but not in it (see gmToggle).
        const toggle = gmToggle(group.id, false);
        toggle.setAttribute('transform', `translate(${rect.x + 25}, ${rect.y})`);
        g.appendChild(toggle);
        layer.appendChild(g);
        // Sized to the words once they are laid out; a guess where they cannot be.
        let width = 46 + text.textContent.length * 6;
        try { const bb = text.getBBox(); if (bb.width) width = 46 + bb.width; } catch (e) { /* not laid out */ }
        pill.setAttribute('width', String(Math.round(width)));
    });
}

// The point a folded end is drawn at.
const gmEnd = (end, folds) => (end.fold ? folds.get(end.fold) : getNode(end.node));

function drawGroupEdges(view, ctx) {
    if (!view || !view.edges.length) return;
    const lLinks = document.getElementById('layer-links');
    const folds = new Map(view.folds.map((b) => [b.group.id, b]));
    const { reach, qm } = ctx;
    const selLinks = new Set(selectedOf('link'));   // once per call, not a walk of the selection per edge
    view.edges.forEach((edge) => {
        const a = gmEnd(edge.a, folds), b = gmEnd(edge.b, folds);
        if (!a || !b) return;
        const n = edge.links.length;
        // One medium for all of them keeps its colour; a mix is a plain line.
        const media = new Set(edge.links.map((l) => effectiveMedium(l, getNode(l.source), getNode(l.target))));
        const medium = media.size === 1 ? [...media][0] : 'utp';
        const colour = medium === 'wireless' ? wifiMapColours().line   // the --topo-wifi token (js/ui.js)
            : { fiber: '#06b6d4', powerline: '#eab308', vpn: '#14b8a6' }[medium] || '#94a3b8';
        const selected = edge.links.some((l) => selLinks.has(l.id));
        const lit = reach && edge.links.some((l) => reach.reachableLinks.has(l.id));
        const line = gmEl('path', { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, fill: 'none',
            stroke: lit ? '#f59e0b' : selected ? '#eab308' : colour,
            'stroke-width': (selected || lit ? 3 : 2) + Math.min(2, Math.log2(n)),
            class: `grp-drawn grp-edge cursor-pointer${reach && !lit ? ' fade-inactive' : ''}`,
            'data-links': edge.links.map((l) => l.id).join(' ') });
        if (medium === 'wireless') line.setAttribute('stroke-dasharray', '4 4');
        if (selected && !lit) restLook(line, { stroke: colour, 'stroke-width': String(2 + Math.min(2, Math.log2(n))) });   // the export draws it unselected (js/ui.js)
        if (qm && !edge.links.some((l) => qm.links.has(l.id))) line.classList.add('q-dim');
        const tip = gmEl('title');
        tip.textContent = t(n === 1 ? '{n} cable' : '{n} cables', { n });
        line.appendChild(tip);
        // A press selects the cables it stands for.
        line.addEventListener('mousedown', (event) => {
            event.stopPropagation();
            const entries = edge.links.map((l) => ({ type: 'link', id: l.id }));
            if (addsToSelection(event)) selectEntries([...state.selection, ...entries]);
            else selectEntries(entries);
        });
        lLinks.appendChild(line);
        if (n > 1) {
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const label = gmEl('text', { x: mx, y: my + 3.5, 'text-anchor': 'middle', 'font-size': 10, 'font-family': 'sans-serif',
                'font-weight': 700, fill: '#334155', 'paint-order': 'stroke', stroke: '#ffffff', 'stroke-width': 3,
                class: `grp-drawn grp-edge-count${qm && !edge.links.some((l) => qm.links.has(l.id)) ? ' q-dim' : ''}` });
            label.textContent = `×${n}`;
            label.style.pointerEvents = 'none';
            lLinks.appendChild(label);
        }
    });
}

// The findings of the devices folded into a group: the worst and how many.
// Every open finding that names one of them counts, its own (a port, a
// gateway) and the ones it shares (an address two devices hold), once each;
// an accepted one or an info one does not, as neither does on the pill or a
// device's badge.
// Read from the same diagnosis the badges read; a drag step reuses the last.
function groupRollup(members, diag) {
    const ids = new Set(members.map((n) => n.id));
    let worst = null, count = 0;
    (diag.findings || []).forEach((f) => {
        if (!isCountedFinding(f) || !(f.nodeIds || []).some((id) => ids.has(id))) return;
        count++;
        if (f.level === 'bad') worst = 'bad'; else if (!worst) worst = 'warn';
    });
    return { worst, count };
}

function drawGroupFolds(view, ctx) {
    if (!view || !view.folds.length) return;
    const lNodes = document.getElementById('layer-nodes');
    const { reach, qm, diag } = ctx;
    const sel = new Set(selectedOf('node'));   // once per call: a drag redraws this per mouse move
    view.folds.forEach((fold) => {
        const { group, members, x, y } = fold;
        const roll = diag ? groupRollup(members, diag) : (_gmLast.rollup.get(group.id) || { worst: null, count: 0 });
        _gmLast.rollup.set(group.id, roll);
        // Selected: all of it (pressed, or Select members), or some of it (a
        // device picked in the table or from a finding, whose own node is
        // folded in here: this node is where it is on the map).
        const picked = members.filter((n) => sel.has(n.id)).length;
        const selected = picked === members.length;
        const lit = reach && members.some((n) => reach.reachableNodes.has(n.id));
        // The trace starts inside: the device traced from is folded in here.
        const source = !!reach && members.some((n) => n.id === state.selectedId);
        // The search matches devices folded in here: the node lights for them
        // rather than dimming with the rest, and says how many.
        const hits = qm ? members.filter((n) => qm.nodes.has(n.id)).length : 0;
        const g = gmEl('g', { id: `ui-group-${group.id}`, transform: `translate(${x}, ${y})`, 'data-grp': group.id,
            class: `grp-drawn grp-node cursor-grab${reach && !lit ? ' fade-inactive' : ''}${qm && !hits ? ' q-dim' : ''}${hits ? ' q-hit' : ''}${source ? ' grp-trace-src' : ''}` });
        if (hits) {
            // A ring round the card in the search's colour: the node is a
            // match, though what matched is not drawn.
            g.appendChild(gmEl('rect', { x: -34, y: -36, width: 72, height: 66, rx: 11, fill: 'none', stroke: '#2563eb', 'stroke-width': 2.5, class: 'grp-node-hit' }));
        }
        if (members.every(isRetired)) { g.setAttribute('opacity', '0.4'); g.setAttribute('data-status', 'retired'); }
        // A second card behind the first: several devices, folded.
        g.appendChild(gmEl('rect', { x: -24, y: -30, width: 56, height: 48, rx: 7, fill: '#f1f5f9', stroke: '#94a3b8', 'stroke-width': 1.25 }));
        // At rest (traced through, a finding, plain), then what a selection
        // lays over it; the export puts the rest back (restLook, js/ui.js).
        const rest = lit ? ['#fffbeb', '#fcd34d', 2.5]
            : roll.worst === 'bad' ? ['#fef2f2', '#dc2626', 2]
            : roll.worst === 'warn' ? ['#fffbeb', '#d97706', 2]
            : ['#ffffff', '#64748b', 1.5];
        const [fill, stroke, width] = selected ? ['#fefce8', '#eab308', 2]
            : source ? ['#fef3c7', '#f59e0b', 3]
            : picked ? ['#ffffff', '#eab308', 2]
            : rest;
        const card = gmEl('rect', { x: -28, y: -24, width: 56, height: 48, rx: 7, fill, stroke, 'stroke-width': width });
        const someOf = picked && !selected && !source;
        if (someOf) card.setAttribute('stroke-dasharray', '5 3');   // some of it
        if (selected || source || picked) {
            const look = { fill: rest[0], stroke: rest[1], 'stroke-width': String(rest[2]) };
            if (someOf) look['stroke-dasharray'] = null;
            restLook(card, look);
        }
        g.appendChild(card);
        const icon = gmEl('g', { transform: 'translate(-12, -14)' });
        icon.appendChild(gmIcon(group.kind, 24, '#334155'));
        icon.style.pointerEvents = 'none';
        g.appendChild(icon);
        const name = gmEl('text', { 'text-anchor': 'middle', y: 36, 'font-size': 10, 'font-family': 'sans-serif', 'font-weight': 600, fill: '#334155' });
        name.textContent = groupLabel(group);
        name.style.pointerEvents = 'none';
        g.appendChild(name);
        const count = gmEl('text', { 'text-anchor': 'middle', y: 48, 'font-size': 8, 'font-family': 'sans-serif', fill: '#64748b', class: 'grp-node-count' });
        count.textContent = devicesText(members.length);
        count.style.pointerEvents = 'none';
        g.appendChild(count);
        if (roll.worst) {
            const badge = gmEl('g', { transform: 'translate(23, -19)', class: 'grp-node-badge', 'data-severity': roll.worst });
            badge.appendChild(gmEl('circle', { r: 8.5, fill: roll.worst === 'bad' ? '#dc2626' : '#d97706', stroke: '#ffffff', 'stroke-width': 1.5 }));
            const mark = gmEl('text', { 'text-anchor': 'middle', y: 3.5, 'font-size': roll.count > 9 ? 8 : 10, 'font-weight': 900, fill: '#ffffff', 'font-family': 'sans-serif' });
            mark.textContent = roll.count > 99 ? '99+' : String(roll.count);
            badge.appendChild(mark);
            g.appendChild(badge);
        }
        const tip = gmEl('title');
        const tipLines = (withPicked) => [groupPath(group), devicesText(members.length),
            roll.count ? t(roll.count === 1 ? '{n} finding' : '{n} findings', { n: roll.count }) : '',
            hits ? t(hits === 1 ? '{n} of them matches the search' : '{n} of them match the search', { n: hits }) : '',
            withPicked && picked && !selected ? t(picked === 1 ? '{n} of them is selected' : '{n} of them are selected', { n: picked }) : '',
            t('Click to expand. Shift-click selects its devices.')].filter(Boolean).join('\n');
        tip.textContent = tipLines(true);
        // The selected line is the editor's: the SVG export keeps titles, so
        // it puts this text back in (canvasSvgMarkup, js/app.js).
        if (picked && !selected) tip.setAttribute('data-rest-text', tipLines(false));
        g.appendChild(tip);
        // A tap expands, a drag moves (pressFold); the release decides, in
        // the window's mouseup (js/app.js), as it does for a device's drag.
        g.addEventListener('mousedown', (event) => pressFold(event, group, members));
        g.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });   // no cable from a group
        lNodes.appendChild(g);
        // The ▸ on the card's top-left corner, beside the node rather than in
        // it (see gmToggle); it dims and fades with the node it belongs to.
        const toggle = gmToggle(group.id, true, `grp-drawn${reach && !lit ? ' fade-inactive' : ''}${qm && !hits ? ' q-dim' : ''}`);
        toggle.setAttribute('transform', `translate(${x - 22}, ${y - 30})`);
        if (g.getAttribute('opacity')) toggle.setAttribute('opacity', g.getAttribute('opacity'));
        lNodes.appendChild(toggle);
        // A collapsed rack opens in the rack view (js/rackview.js), from a
        // control beside the card's right edge, for the same reason as the ▸.
        // A right-click on the card does the same, as a shortcut; the button
        // is the way that needs no mouse.
        if (isRackGroup(group)) {
            const open = gmRackOpen(group.id, `grp-drawn${reach && !lit ? ' fade-inactive' : ''}${qm && !hits ? ' q-dim' : ''}`);
            open.setAttribute('transform', `translate(${x + 42}, ${y + 6})`);
            if (g.getAttribute('opacity')) open.setAttribute('opacity', g.getAttribute('opacity'));
            lNodes.appendChild(open);
            g.addEventListener('contextmenu', () => openRackView(group.id));
        }
    });
}

// A host's badge (see "Hosts on the map"), on its card `g` (js/ui.js): a
// pill on the card's bottom-left corner with ▾ or ▸ and how many run on it,
// and, folded, a second card behind the host's own. The pill and the count
// are the drawing (a fact about the network, so in the exports, coloured
// by attributes); the chevron is the control's, left out of them
// (canvasSvgMarkup, js/app.js). A tap target round the pill, wider on a
// touch screen, grows out from the card's corner, away from the card a
// press selects, as gmToggle's does.
function drawHostBadge(g, node, count, folded) {
    if (folded) g.insertBefore(gmEl('rect', { class: 'host-fold-back', x: -20, y: -30, width: 48, height: 48, rx: 6,
        fill: '#f1f5f9', stroke: '#94a3b8', 'stroke-width': 1.25 }), g.firstChild);
    const badge = gmEl('g', { class: 'host-badge', transform: 'translate(-24, 20)', 'data-host': node.id, role: 'button' });
    const text = String(count > 99 ? '99+' : count);
    const w = 22 + text.length * 6;
    const extra = (GM_COARSE ? 40 : 30) - 14;
    badge.appendChild(gmEl('rect', { class: 'grp-toggle-hit', x: -w / 2 - extra, y: -7, width: w + extra, height: 14 + extra, fill: 'transparent' }));
    badge.appendChild(gmEl('rect', { x: -w / 2, y: -7, width: w, height: 14, rx: 7, fill: '#ffffff', stroke: '#64748b', 'stroke-width': 1.25 }));
    badge.appendChild(gmEl('path', { class: 'host-fold-chev', d: folded ? `M${-w / 2 + 6} -3 L${-w / 2 + 9} 0 L${-w / 2 + 6} 3` : `M${-w / 2 + 5} -1.5 L${-w / 2 + 8} 1.5 L${-w / 2 + 11} -1.5`,
        fill: 'none', stroke: '#334155', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const label = gmEl('text', { class: 'host-badge-count', x: 4, y: 3.5, 'text-anchor': 'middle', 'font-size': 9, 'font-family': 'sans-serif', 'font-weight': 700, fill: '#334155' });
    label.textContent = text;
    label.style.pointerEvents = 'none';
    badge.appendChild(label);
    const tip = gmEl('title');
    tip.textContent = [t(count === 1 ? '{n} device runs on it' : '{n} devices run on it', { n: count }),
        t(folded ? 'Click to show them.' : 'Click to fold them into it.')].join('\n');
    badge.appendChild(tip);
    badge.addEventListener('mousedown', (e) => e.stopPropagation());   // no drag, no select
    badge.addEventListener('click', (e) => { e.stopPropagation(); toggleHostFolded(node.id); });
    g.appendChild(badge);
}

// The collapsed rack's Open rack: the rack's own icon in a box, a tap target
// round it, as gmToggle draws its ▸. A control, left out of the exports.
function gmRackOpen(gid, extra) {
    const g = gmEl('g', { class: extra ? `grp-rack-open ${extra}` : 'grp-rack-open', 'data-grp': gid, role: 'button' });
    const side = GM_COARSE ? 40 : 30;
    g.appendChild(gmEl('rect', { x: -9, y: -side / 2, width: side, height: side, fill: 'transparent', class: 'grp-toggle-hit' }));
    g.appendChild(gmEl('rect', { x: -9, y: -9, width: 18, height: 18, rx: 4, fill: '#f1f5f9', stroke: '#cbd5e1' }));
    const icon = gmEl('g', { transform: 'translate(-6, -6)' });
    icon.appendChild(gmIcon('rack', 12, '#334155'));
    icon.style.pointerEvents = 'none';
    g.appendChild(icon);
    const tip = gmEl('title');
    tip.textContent = t('Open rack');
    g.appendChild(tip);
    g.addEventListener('mousedown', (e) => e.stopPropagation());
    g.addEventListener('click', (e) => { e.stopPropagation(); openRackView(gid); });
    return g;
}

// The whole of it, inside drawCanvas (js/ui.js): frames under the cables,
// folded cables with the cables, collapsed nodes with the devices.
function drawGroupMap(view, ctx) {
    _gmLast = { reach: ctx.reach, qm: ctx.qm, rollup: new Map() };
    drawGroupFrames(view);
    drawGroupEdges(view, ctx);
    drawGroupFolds(view, ctx);
}

// A drag step (js/app.js): the frames, the collapsed nodes and the folded
// cables follow the devices as they move, without a full redraw. The findings
// cannot change while dragging, so the last rollup stands.
function redrawGroupOverlay() {
    if (!hostFoldShown()) return;
    document.querySelectorAll('#layer-links > .grp-drawn, #layer-nodes > .grp-drawn, #layer-nodes .host-drop-ring, #layer-nodes .pair-drop-ring').forEach((el) => el.remove());
    const view = gmDropFrames(groupMapNow());
    const ctx = { reach: _gmLast.reach, qm: _gmLast.qm, diag: null };
    drawGroupFrames(view);
    drawGroupEdges(view, ctx);
    drawGroupFolds(view, ctx);
    drawGroupDropCue();
}

// The box the frames take, tabs included, or null: a frame reaches further
// out than its devices do, so framing the map (fitToView) and cropping an
// export (canvasSvgMarkup) take it in, or the outermost tab is cut off.
function groupFrameBounds(view = groupMapNow()) {
    if (!view || !view.frames.length) return null;
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    view.frames.forEach(({ rect }) => {
        b.minX = Math.min(b.minX, rect.x); b.minY = Math.min(b.minY, rect.y - 10);   // the tab rides the top edge
        b.maxX = Math.max(b.maxX, rect.x + rect.w); b.maxY = Math.max(b.maxY, rect.y + rect.h);
    });
    return b;
}

// Where devices are on screen: each one itself, or, folded, the collapsed
// node of its group, once per group. What frames or centres the map on
// devices goes through here (zoom to matches, a finding or a table row
// focused, a network's or a group's Select members), so it lands on what
// stands for them, not on the empty patch the folded ones keep their x and y
// in: a group spread wide folds to its middle, and its devices' own places
// can be well off the screen that holds its node.
function mapPointsOf(nodes, view = groupMapNow()) {
    if (!view || (!view.hidden.size && !view.guestHidden.size)) return nodes.slice();
    const folds = new Map(view.folds.map((b) => [b.group.id, b]));
    const out = [], seen = new Set();
    nodes.forEach((n) => {
        const gid = n && view.hidden.get(n.id);
        // A guest folded into its host: the host's card.
        const hid = n && !gid && view.guestHidden.get(n.id);
        if (hid) {
            const h = getNode(hid);
            if (h && !seen.has(`h:${hid}`)) { seen.add(`h:${hid}`); out.push(h); }
            return;
        }
        if (!gid) { if (n) out.push(n); return; }
        if (seen.has(gid)) return;
        seen.add(gid);
        const b = folds.get(gid);
        out.push({ x: b.x, y: b.y });
    });
    return out;
}
const mapPointOf = (node, view) => (node ? mapPointsOf([node], view)[0] : null);

// How many of the selected devices are folded out of sight, for Delete.
function selectedHiddenCount() {
    const view = groupMapNow();
    if (!view || (!view.hidden.size && !view.guestHidden.size)) return 0;
    return selectedOf('node').filter((id) => view.hidden.has(id) || view.guestHidden.has(id)).length;
}
// Of those, how many are folded into a host (Delete's question says so).
function selectedFoldedGuestCount() {
    const view = groupMapNow();
    return view ? selectedOf('node').filter((id) => view.guestHidden.has(id)).length : 0;
}
