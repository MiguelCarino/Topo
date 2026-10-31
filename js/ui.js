// Everything that draws: palette, canvas, sidebar, faceplate.
// Load order: state -> model -> data -> diagnostics -> ui -> app

const iconPaths = {
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    router: '<circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/>',
    firewall: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    switch: '<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 12h4m4 0h4"/>',
    server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    pc: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    ap: '<path d="M12 20h.01M8.5 16.5a5 5 0 0 1 7 0M6 14a8 8 0 0 1 12 0M3.5 11.5a11.5 11.5 0 0 1 17 0"/>',
    vm: '<rect x="2" y="2" width="20" height="20" rx="2" stroke-dasharray="4 4"/><path d="M12 8v8M8 12h8"/>',
    iot: '<path d="M4.9 19.1C3.1 17.3 2 14.8 2 12s1.1-5.3 2.9-7.1M19.1 4.9C20.9 6.7 22 9.2 22 12s-1.1 5.3-2.9 7.1M8.5 15.5c-1-1-1.6-2.4-1.6-3.5s.6-2.5 1.6-3.5M15.5 8.5c1 1 1.6 2.4 1.6 3.5s-.6 2.5-1.6 3.5"/><circle cx="12" cy="12" r="2"/>',
    dicom: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    container: '<rect x="2" y="7" width="20" height="12" rx="1"/><path d="M6 7v12M10 7v12M14 7v12M18 7v12"/>',
    loadbalancer: '<circle cx="12" cy="4" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="12" cy="20" r="2"/><circle cx="19" cy="20" r="2"/><path d="M12 6v3M12 9l-7 9M12 9v9M12 9l7 9"/>',
    l3switch: '<rect x="2" y="9" width="20" height="7" rx="2"/><path d="M6 12.5h12"/><path d="M8 6l3-3 3 3M8 19l3 3 3-3"/>',
    edge: '<rect x="5" y="9" width="14" height="7" rx="1.5"/><path d="M9 9V4M15 9V4M12 16v4"/><path d="M6 4h6M12 4h6"/>',
    vpn: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/><path d="M12 16v2"/>',
    voip: '<path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    custom: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'
};

// Palette order: each base type is followed by its L3 derivatives, so
// Router → Load Balancer / L3 Switch / Edge, and Firewall → VPN Gateway.
// simple: shown in Simple mode — the devices a non-technical person recognizes
// from their own home. Everything else is Advanced-only (hidden by CSS, so the
// palette never re-renders and existing nodes of any type keep working).
const paletteDefs = [
    { type: 'cloud', name: 'Cloud', simple: true }, { type: 'router', name: 'Router', simple: true }, { type: 'loadbalancer', name: 'Load Balancer' },
    { type: 'l3switch', name: 'L3 Switch' }, { type: 'edge', name: 'Edge Gateway' }, { type: 'firewall', name: 'Firewall' },
    { type: 'vpn', name: 'VPN Gateway' }, { type: 'switch', name: 'Switch', simple: true }, { type: 'ap', name: 'Wireless AP', simple: true },
    { type: 'server', name: 'Server' }, { type: 'vm', name: 'VM' }, { type: 'container', name: 'Container' },
    { type: 'pc', name: 'Workstation', simple: true }, { type: 'voip', name: 'VoIP Phone' }, { type: 'iot', name: 'IoT Device', simple: true },
    { type: 'printer', name: 'Printer', simple: true }, { type: 'camera', name: 'IP Camera', simple: true }, { type: 'dicom', name: 'DICOM' },
    { type: 'custom', name: 'Custom Node' }
];

const lZones = document.getElementById('layer-zones'), lLinks = document.getElementById('layer-links'), lNodes = document.getElementById('layer-nodes'), lAnn = document.getElementById('layer-annotations');
let isDraggingCanvas = false, isDraggingNode = false, draggedNode = null, dragOffset = { x: 0, y: 0 }, lastMouse = { x: 0, y: 0 };
// dragGroup: everything a press moves, each with its offset from the pointer
// and where it started — the pressed device alone, or every selected device
// when the press lands on one of a set (plan 3.1). The mousemove handler in
// js/app.js moves them all; the mouseup saves once, however many moved.
// dragCollapse: a plain press on one device of a set keeps the set (it may be
// the start of a drag), and a release that moved nothing narrows the
// selection to that device, as a file manager does.
// _dragPress: where the press came down and the tap margin it must travel
// past (gmSlopOf, js/groupmap.js) before anything moves; started once it has.
// The mouseup reads it: a release that never started is a click, not a drag.
let dragGroup = [], dragCollapse = null, _dragPress = null;
function startDrag(event, items, pressed) {
    // A read-only document can be inspected but not rearranged: the press
    // selects and arms no drag, so nothing moves only to snap back on release.
    isDraggingNode = !state.readOnly; draggedNode = state.readOnly ? null : pressed;
    _dragPress = { x: event.clientX, y: event.clientY, slop: gmSlopOf(event), started: false };
    const pt = getWorkspacePoint(event.clientX, event.clientY);
    dragOffset.x = pt.x - pressed.x; dragOffset.y = pt.y - pressed.y;
    dragGroup = state.readOnly ? [] : items.map((item) => ({ item, dx: pt.x - item.x, dy: pt.y - item.y, x0: item.x, y0: item.y }));
    // A drop into a group is a device's press's to arm (js/groupmap.js), after this.
    if (typeof clearGroupDrop === 'function') clearGroupDrop();
}
// Shift, Ctrl or Cmd held: the press adds to the selection or takes out of it.
const addsToSelection = (event) => !!(event.shiftKey || event.ctrlKey || event.metaKey);

// A press on a device's card: a mouse's, or a finger's once it has travelled
// past a tap (touchPressNode, js/app.js), which hands over where it came down.
function pressNode(event, node) {
    event.stopPropagation();
    if (state.linkSourceId) return;
    // Shift/Ctrl/Cmd edits the set and arms no drag: the press was
    // about what is selected, not about where it is.
    if (addsToSelection(event)) { toggleSelected('node', node.id); return; }
    // One of a set: the whole set moves (startDrag), and a release
    // that moved nothing selects this one alone (dragCollapse).
    const ofSet = state.selection.size > 1 && inSelection('node', node.id);
    startDrag(event, ofSet ? selectedOf('node').map(getNode).filter(Boolean) : [node], node);
    // Let go in a group's frame, it goes into that group; on a host, it runs
    // on it; on another device, a new group is offered (js/groupmap.js).
    armGroupDrop(dragGroup.map((g) => g.item));
    dragCollapse = ofSet ? node.id : null;
    // A folded host: a tap unfolds it, as one on a collapsed
    // group's node expands the group, and selects nothing; a drag
    // moves it (js/groupmap.js, "Hosts on the map").
    if (!event.button && isHostFolded(node.id)) armHostFoldTap(event, node.id);
    else if (!ofSet) select(node.id, 'node');
}

const paletteContainer = document.getElementById('nodePalette');
paletteDefs.forEach((d) => {
    const btn = document.createElement('button');
    btn.className = 'palette-item';
    if (!d.simple) btn.setAttribute('data-adv', ''); // hidden in reduced profiles (the one data-adv rule, css/app.css)
    btn.dataset.type = d.type; // profile CSS overrides + purpose renames key off this
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${iconPaths[d.type]}</svg><span>${d.name}</span>`;
    btn.title = 'Click to add (connects to the selected node) — or drag onto the canvas';
    btn.setAttribute('data-i18n-title', ''); // translated by applyLocale(), which runs after the locale is known
    // Click: add connected to the current selection (fast tree building)
    btn.onclick = () => spawnNode(d.type, { connectTo: (state.selectedType === 'node' && state.selectedId) ? state.selectedId : null });
    // Drag: drop onto the canvas at the cursor
    btn.setAttribute('draggable', 'true');
    btn.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/carino-node', d.type); e.dataTransfer.effectAllowed = 'copy'; });
    paletteContainer.appendChild(btn);
});

// Text & Note tools — document furniture, not devices: they spawn annotations,
// so they sit outside paletteDefs (no interfaces, no auto-IP, no network links).
// Text = borderless words on the canvas; Note = the coloured sticky card.
[
    { style: 'plain', name: 'Text', title: 'Click or drag to place borderless text — double-clicking empty canvas also works',
      icon: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>' },
    { style: 'note', name: 'Note', title: 'Click or drag to place a coloured sticky note — right-click it to link it to a node',
      icon: '<path d="M4 4h16v12l-4 4H4z" fill="#fef9c3" stroke="#ca8a04"/><path d="M16 20v-4h4" fill="none" stroke="#ca8a04"/>' },
].forEach((d) => {
    const btn = document.createElement('button');
    btn.className = 'palette-item';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${d.icon}</svg><span data-i18n>${d.name}</span>`;
    btn.title = d.title; btn.setAttribute('data-i18n-title', ''); // applyLocale() translates both
    btn.onclick = () => spawnAnnotation({ style: d.style, edit: true });
    btn.setAttribute('draggable', 'true');
    btn.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/carino-annotation', d.style); e.dataTransfer.effectAllowed = 'copy'; });
    paletteContainer.appendChild(btn);
});

// ---- Text annotations: render + inline editor ----
const getAnnotation = (id) => state.annotations.find((a) => a.id === id);

// Leader geometry: border to border. The line leaves the card where the ray
// to the node exits the rectangle and stops at the node's halo. Card size
// comes from the transient _w/_h stamped at render time. Null = shapes overlap.
// A leader target may be a node (rect exit → node halo) or another note
// (rect exit → rect exit). Annotations are told apart by their `text` field.
function noteLinkGeometry(a, t) {
    const w = a._w || 44, h = a._h || 26;
    const cx = a.x + w / 2, cy = a.y + h / 2;
    const tIsNote = typeof t.text === 'string' && t.interfaces === undefined;
    const tw = t._w || 44, th = t._h || 26;
    const tcx = tIsNote ? t.x + tw / 2 : t.x, tcy = tIsNote ? t.y + th / 2 : t.y;
    const dx = tcx - cx, dy = tcy - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const rectExit = (hw, hh) => Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity,
                                          dy !== 0 ? hh / Math.abs(dy) : Infinity);
    const tA = rectExit(w / 2, h / 2);
    const sx = cx + dx * tA, sy = cy + dy * tA;
    let ex, ey;
    if (tIsNote) { const tB = rectExit(tw / 2, th / 2); ex = tcx - dx * tB; ey = tcy - dy * tB; }
    else { ex = tcx - (dx / dist) * 30; ey = tcy - (dy / dist) * 30; }
    if ((ex - sx) * dx + (ey - sy) * dy <= 0) return null;
    return { sx, sy, ex, ey };
}

function applyNoteLinkGeometry(el, geo) {
    if (!geo) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.setAttribute('x1', geo.sx); el.setAttribute('y1', geo.sy);
    el.setAttribute('x2', geo.ex); el.setAttribute('y2', geo.ey);
}

const noteLinkTarget = (tid) => getNode(tid) || getAnnotation(tid);

// Toggle a leader between a note and a node or another note. The pairing is
// stored on whichever note initiated it, so unlinking checks both directions.
function toggleNoteLink(a, targetId) {
    a.targets = a.targets || [];
    const other = getAnnotation(targetId);
    const i = a.targets.indexOf(targetId);
    if (i >= 0) a.targets.splice(i, 1);
    else if (other && other.targets && other.targets.includes(a.id)) other.targets = other.targets.filter((t) => t !== a.id);
    else a.targets.push(targetId);
    state.linkSourceId = null;
    save(); renderCanvasOnly();
}

// Remove one leader by its composite selection id nl:<noteId>:<targetId>.
function removeNoteLink(selId) {
    const [, aid, tid] = selId.split(':');
    const a = getAnnotation(aid);
    if (a && a.targets) a.targets = a.targets.filter((t) => t !== tid);
}

function renderAnnotation(a) {
    const NS = 'http://www.w3.org/2000/svg';

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('id', `ui-ann-${a.id}`);
    g.setAttribute('transform', `translate(${a.x}, ${a.y})`);
    g.style.cursor = 'move';
    if (state.linkSourceId === a.id) g.setAttribute('class', 'linking-glow');
    const selected = inSelection('annotation', a.id);

    const rect = document.createElementNS(NS, 'rect');
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('font-size', String(a.size || 12));
    text.setAttribute('font-family', "'IBM Plex Sans', sans-serif");
    text.setAttribute('fill', '#1e293b');
    (a.text || ' ').split('\n').forEach((ln) => {
        const ts = document.createElementNS(NS, 'tspan');
        ts.setAttribute('x', 10); ts.setAttribute('dy', '1.35em');
        ts.textContent = ln === '' ? ' ' : ln;   // keep blank lines from collapsing
        text.appendChild(ts);
    });
    g.appendChild(rect); g.appendChild(text);
    lAnn.appendChild(g);   // must be in the DOM before getBBox works

    const bb = text.getBBox();
    const cardW = Math.max(bb.width + 20, 44), cardH = Math.max(bb.height + 12, 26);
    a._w = cardW; a._h = cardH;   // transient, for live leader updates during drags
    rect.setAttribute('x', 0); rect.setAttribute('y', 0); rect.setAttribute('rx', 4);
    rect.setAttribute('width', cardW);
    rect.setAttribute('height', cardH);

    rect.setAttribute('stroke-width', selected ? 2 : 1);
    if (a.style === 'plain') {
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('stroke', selected ? '#eab308' : 'transparent');
        rect.setAttribute('stroke-dasharray', '4 3');
    } else {
        rect.setAttribute('fill', '#fef9c3');
        rect.setAttribute('stroke', selected ? '#ca8a04' : '#eab308');
    }
    if (selected) restLook(rect, a.style === 'plain' ? { 'stroke-width': '1', stroke: 'transparent' } : { 'stroke-width': '1', stroke: '#eab308' });

    // Selected: the same little ✕ nodes get (top-left, suppressed in link mode).
    if (selected && !state.linkSourceId) {
        const del = document.createElementNS(NS, 'g');
        del.setAttribute('class', 'node-delete');
        const disc = document.createElementNS(NS, 'circle');
        disc.setAttribute('r', '7.5');
        disc.setAttribute('fill', '#dc2626'); disc.setAttribute('stroke', '#ffffff'); disc.setAttribute('stroke-width', '1.5');
        del.appendChild(disc);
        const mark = document.createElementNS(NS, 'text');
        mark.setAttribute('text-anchor', 'middle'); mark.setAttribute('y', '3');
        mark.setAttribute('font-size', '9'); mark.setAttribute('font-weight', '900'); mark.setAttribute('fill', '#ffffff');
        mark.setAttribute('font-family', 'sans-serif');
        mark.textContent = '✕'; mark.style.pointerEvents = 'none';
        del.appendChild(mark);
        const tip = document.createElementNS(NS, 'title');
        tip.textContent = t('Delete note');
        del.appendChild(tip);
        del.addEventListener('mousedown', (e) => e.stopPropagation()); // no drag from the ✕
        del.addEventListener('click', (e) => { e.stopPropagation(); deleteSelected(); });
        g.appendChild(del);

        // Size controls, top-right: A− / A+ discs mirror the ✕'s look. They
        // adjust the note's font size in 2px steps (10–36) and the card
        // re-measures itself around the new text box. The pair is pinned in
        // place from the first click until the pointer leaves it — otherwise
        // every click would grow the card and slide the buttons out from
        // under a user who wants to press them repeatedly.
        const ctlX = a._ctlPin !== undefined ? a._ctlPin : cardW;
        const ctlWrap = document.createElementNS(NS, 'g');
        ctlWrap.setAttribute('transform', `translate(${ctlX}, 0)`);
        [
            { glyph: 'A−', dx: -18, step: -2, tipTxt: t('Smaller text') },
            { glyph: 'A+', dx: 0,  step: 2,  tipTxt: t('Larger text') },
        ].forEach((b) => {
            const ctl = document.createElementNS(NS, 'g');
            ctl.setAttribute('transform', `translate(${b.dx}, 0)`);
            ctl.setAttribute('class', 'node-delete');
            const disc2 = document.createElementNS(NS, 'circle');
            disc2.setAttribute('r', '7.5');
            disc2.setAttribute('fill', '#334155'); disc2.setAttribute('stroke', '#ffffff'); disc2.setAttribute('stroke-width', '1.5');
            ctl.appendChild(disc2);
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('y', '2.5');
            lbl.setAttribute('font-size', '7'); lbl.setAttribute('font-weight', '900'); lbl.setAttribute('fill', '#ffffff');
            lbl.setAttribute('font-family', 'sans-serif');
            lbl.textContent = b.glyph; lbl.style.pointerEvents = 'none';
            ctl.appendChild(lbl);
            const tip2 = document.createElementNS(NS, 'title');
            tip2.textContent = b.tipTxt;
            ctl.appendChild(tip2);
            ctl.addEventListener('mousedown', (e) => e.stopPropagation()); // no drag from the controls
            ctl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (a._ctlPin === undefined) a._ctlPin = ctlX;   // freeze where the buttons are now
                a.size = Math.min(36, Math.max(10, (a.size || 12) + b.step));
                save(); renderCanvasOnly();
            });
            ctlWrap.appendChild(ctl);
        });
        // Pointer left the pair → let them snap to the card's new corner.
        ctlWrap.addEventListener('mouseleave', () => {
            if (a._ctlPin !== undefined) { delete a._ctlPin; renderCanvasOnly(); }
        });
        g.appendChild(ctlWrap);
    }

    // While this note's editor is open, any re-render (selection, mouseup,
    // leader updates) must keep the card hidden — the overlay IS the card.
    const openEd = document.getElementById('annEditor');
    if (openEd && openEd.dataset.annId === a.id) g.style.visibility = 'hidden';

    // Same drag contract as nodes: shared isDraggingNode/draggedNode globals,
    // the mousemove handler finds this group via the ui-ann-<id> fallback.
    g.addEventListener('mousedown', (event) => {
        event.stopPropagation();
        // Second press of a double-click: straight into typing. Handled here on
        // mousedown (event.detail) rather than dblclick, because the first
        // press re-renders the canvas and replaces this element mid-gesture —
        // and it must not arm a drag either.
        if (event.detail > 1) { openAnnotationEditor(a); return; }
        if (state.linkSourceId) {
            // Armed from a node or another note → complete a red leader onto
            // this card. Armed from this same note → cancel.
            const srcNode = getNode(state.linkSourceId);
            if (srcNode) { toggleNoteLink(a, srcNode.id); return; }
            const srcAnn = getAnnotation(state.linkSourceId);
            if (srcAnn && srcAnn.id !== a.id) { toggleNoteLink(srcAnn, a.id); return; }
            state.linkSourceId = null; renderCanvasOnly(); return;
        }
        delete a._ctlPin;   // moving the card ends any pinned size-control run
        // A note is only ever selected (and dragged) on its own.
        dragCollapse = null; startDrag(event, [a], a);
        select(a.id, 'annotation');
    });
    // Right-click arms link mode from this note, mirroring nodes: the next
    // node clicked gets (or loses) the red leader.
    g.addEventListener('contextmenu', (event) => {
        event.preventDefault(); event.stopPropagation();
        state.linkSourceId = a.id;
        renderCanvasOnly();
    });
}

// In-place editing: no floating window — a contenteditable overlay dressed as
// the note itself sits exactly on the card. Enter breaks the line (that is how
// width is defined — there is no auto-wrap), clicking elsewhere commits,
// Escape cancels. A note left empty deletes itself.
function openAnnotationEditor(a) {
    const cc = document.getElementById('canvasContainer');
    const old = document.getElementById('annEditor'); if (old) old.remove();
    const gEl = document.getElementById(`ui-ann-${a.id}`);
    if (gEl) gEl.style.visibility = 'hidden';   // the overlay replaces the card while typing

    const z = state.camera.zoom;
    const ed = document.createElement('div');
    ed.id = 'annEditor';
    ed.dataset.annId = a.id;   // renderAnnotation keeps the card hidden while this is open
    ed.contentEditable = 'plaintext-only';
    ed.spellcheck = false;
    ed.className = 'ann-editor';
    ed.style.left = `${a.x * z + state.camera.x}px`;
    ed.style.top = `${a.y * z + state.camera.y}px`;
    ed.style.font = `${(a.size || 12) * z}px 'IBM Plex Sans', sans-serif`;
    ed.style.lineHeight = '1.35';
    ed.style.whiteSpace = 'pre';
    ed.style.color = '#1e293b';
    ed.style.padding = `${6 * z}px ${10 * z}px`;
    ed.style.minWidth = `${44 * z}px`;
    ed.style.minHeight = `${26 * z}px`;
    ed.style.borderRadius = `${4 * z}px`;
    if (a.style === 'note') { ed.style.background = '#fef9c3'; ed.style.border = `${Math.max(1, z)}px solid #ca8a04`; }
    else { ed.style.background = 'rgba(255,255,255,0.92)'; ed.style.border = `${Math.max(1, z)}px dashed #eab308`; }
    ed.innerText = a.text;

    let closed = false;
    const finish = (commitText) => {
        if (closed) return; closed = true;
        window.removeEventListener('mousedown', outside, true);
        window.removeEventListener('wheel', outside, true);
        if (commitText) a.text = ed.innerText.replace(/\n+$/, '');
        ed.remove();
        // the card may have been re-rendered since we opened — unhide whatever
        // element currently represents this note (renderCanvasOnly follows anyway)
        const cur = document.getElementById(`ui-ann-${a.id}`);
        if (cur) cur.style.visibility = '';
        if (!a.text.trim()) { state.annotations = state.annotations.filter((x) => x.id !== a.id); if (inSelection('annotation', a.id)) state.selection = new Set(); }
        save(); renderCanvasOnly();
    };
    const outside = (e) => { if (!ed.contains(e.target)) finish(true); };
    ed.addEventListener('keydown', (e) => {
        e.stopPropagation();   // typing must never trigger canvas shortcuts
        if (e.key === 'Escape') finish(false);
    });

    cc.appendChild(ed);
    ed.focus();
    // caret at the end, ready to keep typing
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    // Deferred so the click/drop that opened the editor can't instantly close it.
    setTimeout(() => { window.addEventListener('mousedown', outside, true); window.addEventListener('wheel', outside, true); }, 0);
}

// Second pass, after every card has stamped its _w/_h: leaders can then hit
// both borders — including note↔note lines whose far end is another card.
// The group sits first in the layer, so lines render under every card.
function renderNoteLeaders() {
    const NS = 'http://www.w3.org/2000/svg';
    const grp = document.createElementNS(NS, 'g');
    lAnn.insertBefore(grp, lAnn.firstChild);
    state.annotations.forEach((a) => {
        (a.targets || []).forEach((tid) => {
            // Not named t: that is the translator, which the ✕'s tip below calls.
            const target = noteLinkTarget(tid); if (!target) return;   // dangling: skip, self-heals
            const selId = `nl:${a.id}:${tid}`;
            const isSel = inSelection('notelink', selId);
            const geo = noteLinkGeometry(a, target);
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('id', `ui-annlink-${a.id}-${tid}`);
            line.setAttribute('stroke', '#ef4444');
            line.setAttribute('stroke-width', isSel ? '2.5' : '1.5');
            line.setAttribute('opacity', isSel ? '1' : '0.85');
            if (isSel) restLook(line, { 'stroke-width': '1.5', opacity: '0.85' });
            line.style.pointerEvents = 'none';
            applyNoteLinkGeometry(line, geo);
            grp.appendChild(line);
            // fat invisible twin: the click target (a 1.5px line is unhittable)
            const hit = document.createElementNS(NS, 'line');
            hit.setAttribute('id', `ui-annlinkhit-${a.id}-${tid}`);
            hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '12');
            hit.style.cursor = 'pointer';
            applyNoteLinkGeometry(hit, geo);
            hit.addEventListener('mousedown', (e) => { e.stopPropagation(); select(selId, 'notelink'); });
            grp.appendChild(hit);
            // selected → a midpoint ✕, same affordance as everywhere else
            if (isSel && geo) {
                const del = document.createElementNS(NS, 'g');
                del.setAttribute('transform', `translate(${(geo.sx + geo.ex) / 2}, ${(geo.sy + geo.ey) / 2})`);
                del.setAttribute('class', 'node-delete');
                const disc = document.createElementNS(NS, 'circle');
                disc.setAttribute('r', '7.5');
                disc.setAttribute('fill', '#dc2626'); disc.setAttribute('stroke', '#ffffff'); disc.setAttribute('stroke-width', '1.5');
                del.appendChild(disc);
                const mark = document.createElementNS(NS, 'text');
                mark.setAttribute('text-anchor', 'middle'); mark.setAttribute('y', '3');
                mark.setAttribute('font-size', '9'); mark.setAttribute('font-weight', '900'); mark.setAttribute('fill', '#ffffff');
                mark.setAttribute('font-family', 'sans-serif');
                mark.textContent = '✕'; mark.style.pointerEvents = 'none';
                del.appendChild(mark);
                const tip = document.createElementNS(NS, 'title');
                tip.textContent = t('Delete note link');
                del.appendChild(tip);
                del.addEventListener('mousedown', (e) => e.stopPropagation());
                del.addEventListener('click', (e) => { e.stopPropagation(); deleteSelected(); });
                grp.appendChild(del);
            }
        });
    });
}

// ---- Subnet zones ----
// A zone is a network's (R7): it used to be one checkbox per interface, so a
// /24 of forty hosts had forty switches for one bubble. Now a declared
// network says: drawZone true draws it, false never does, and unset (auto)
// draws a private network and not a public one, as before. A subnet the
// addressing uses that nobody has declared (undeclaredSubnets: a device
// dropped on the canvas and given an address by hand, a seeded profile's
// drawing) draws as an auto zone too, the way every inferred subnet always
// did; declaring it is what gives it a name, a VLAN and a say over its zone.
// The "Subnet zones" switch in the Subnets tab turns them all off.
//
// A zone's box is drawn round its own devices. A device on several of the
// drawn networks (the router with a leg on each) is left out of their boxes
// while each still has a device of its own: it belongs to all of them, so it
// placed every bubble's corner on itself, and after Tidy, with the router at
// the top and each network's hosts in their own block, the bubbles of every
// LAN swallowed one another and their labels stacked on that corner.
//
// An auto zone is also left out when its devices interleave with another
// zone's: two bubbles each reaching across the other's devices say nothing
// about which device is where, and a bubble that lies is worse than none.
// Interleaving is mutual — each zone's box holds a device of the other that is
// not its own — so a small zone sitting inside a big one is still drawn. A
// network set to draw is drawn regardless; that was asked for.
// Read-only, so it runs in a lookup pass: the membership test parses every
// address against every network, and the pass parses each once.
//
// A device folded into a collapsed group (js/groupmap.js) is not on the map:
// the zone is drawn round the group's node instead, which stands for it, so a
// zone never frames an empty patch of canvas where folded devices sit.
// `gv` is the drawing's group view (groupMapNow()), passed in by drawCanvas.
function zonesToDraw(gv = groupMapNow()) {
    if (state.settings.subnetZones === false) return [];
    return withLookupPass(() => zonesNow(gv));
}
function zonesNow(gv) {
    const zones = [];
    // One stand-in per collapsed group, at its node, under an id no device has.
    const stand = new Map();
    const shown = (n) => {
        const gid = gv && gv.hidden.get(n.id);
        // A guest folded into its host is drawn as the host.
        const hid = !gid && gv && gv.guestHidden.get(n.id);
        if (hid) return getNode(hid) || n;
        if (!gid) return n;
        if (!stand.has(gid)) {
            const b = gv.folds.find((x) => x.group.id === gid);
            stand.set(gid, { id: `group:${gid}`, x: b ? b.x : n.x, y: b ? b.y : n.y });
        }
        return stand.get(gid);
    };
    const visible = (list) => (gv && (gv.hidden.size || gv.guestHidden.size) ? [...new Set(list.map(shown))] : list);
    state.networks.forEach((net) => {
        const p = parseValidCIDR(net.cidr);
        if (!p || net.drawZone === false) return;
        if (net.drawZone !== true && !p.isPrivate) return;
        const nodes = visible(networkMembers(net).map((m) => m.node).filter((n) => n.type !== 'cloud'));
        if (nodes.length) zones.push({ net, nodes, auto: net.drawZone !== true });
    });
    // The undeclared ones: an auto zone each, private ranges only, under a
    // stand-in record with nothing but the address (the label says just that).
    undeclaredSubnets().forEach((u) => {
        if (!u.isPrivate) return;
        const nodes = visible(u.nodeIds.map(getNode).filter(Boolean));
        if (nodes.length) zones.push({ net: { id: `undeclared:${u.cidr}`, cidr: u.cidr }, nodes, auto: true });
    });
    const count = new Map();
    zones.forEach((z) => z.nodes.forEach((n) => count.set(n.id, (count.get(n.id) || 0) + 1)));
    zones.forEach((z) => {
        const own = z.nodes.filter((n) => count.get(n.id) === 1);
        const framed = own.length ? own : z.nodes;
        const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        framed.forEach((n) => {
            box.minX = Math.min(box.minX, n.x); box.minY = Math.min(box.minY, n.y);
            box.maxX = Math.max(box.maxX, n.x); box.maxY = Math.max(box.maxY, n.y);
        });
        Object.assign(z, { box, framed, ids: new Set(z.nodes.map((n) => n.id)) });
    });
    // Inclusive: a row of hosts has no height, and two networks alternating
    // along one row is the commonest interleave there is. What counts is a
    // stranger inside the box as drawn: one of the other zone's framed
    // devices that is not on this network at all.
    const holdsStranger = (a, b) => b.framed.some((n) => !a.ids.has(n.id)
        && n.x >= a.box.minX && n.x <= a.box.maxX && n.y >= a.box.minY && n.y <= a.box.maxY);
    return zones.filter((z) => !z.auto || !zones.some((o) => o !== z && holdsStranger(z, o) && holdsStranger(o, z)));
}

// The drawing is one lookup pass (js/model.js): every cable asks for its two
// devices, its fan of parallel cables and both ends' interfaces, and every
// device for its diagnosis and its addresses, so without the indexes a
// redraw was a scan of the document per cable and per device. Drawing only
// reads the document (the listeners it attaches run later, outside the
// pass). The panels after it are not drawn in it: they open passes of their
// own and the table can write.
// The drawing's diagnosis is handed on to the views and to the caller, so
// none of them builds the memo key again, but only while nothing has saved
// since the drawing: a panel rebuilt here can fire a field's blur-commit,
// whose save() changes the document (repairHosts, pruneFindingNotes) and
// bumps _docSeq (js/app.js). -> live(): that diagnosis, or null once
// anything has saved; null itself under batch(). Resolve it where it is
// used (drawnDiag), not before more panels are rebuilt.
let _canvasRendering = 0;
function renderCanvasOnly() {
    if (holdRender()) return null;   // inside batch() (js/app.js): drawn once, when it ends
    _canvasRendering++;
    try {
        const seq = _docSeq;
        const { reach, diag } = withLookupPass(drawCanvas);
        const live = () => (_docSeq === seq ? diag : null);
        updateTraceStatus(reach);
        validateTopology(diag);
        renderNetworksPanel();   // js/networks.js: the Subnets tab's counts follow the drawing
        renderGroupsPanel();     // js/groups.js: so do the Groups tab's
        renderWifiPanel();       // js/wifi.js: and the Wi-Fi tab's, and whether it is offered
        renderTableView(false, live());   // js/table.js: so does the table view, while it shows
        renderRackView(false, live());    // js/rackview.js: and the rack view, and the switch's Rack
        if (typeof updateQueryBar === 'function') updateQueryBar();   // js/query.js: the match count
        return live;
    } finally { _canvasRendering--; }
}
// renderCanvasOnly()'s answer -> the drawing's diagnosis, if still true now.
const drawnDiag = (live) => (live ? live() : null);

// ---- Typing redraws ----
// Keystrokes write the model and saveTyping() at once, and only the drawing
// waits while a big map is slow (redrawCoalescer, js/state.js). The pending
// draw renders the selection's diagnostics as they are when it runs, never a
// device captured at the keystroke. While the binder report has the canvas on
// loan it stays pending. A flush asked while a drawing is under way (a
// rebuilt panel's focusout), or inside a lookup pass, leaves it to the
// coalescer's timer: a nested render there would write under open indexes.
const typedDraw = redrawCoalescer(() => {
    if (canvasIsBorrowed()) return false;
    refreshSelectedNodeDiagnostics(drawnDiag(renderCanvasOnly()));
});
function renderTyped() { typedDraw.ask(); }
function flushTypedRender() { if (!_canvasRendering && !lookupPass) typedDraw.flush(); }
function cancelTypedRender() { typedDraw.cancel(); }

// A device's glyph on the map: parsed once per type and cloned for each
// device, rather than parsed from markup per device on every redraw. Built
// inside an SVG <g> so the markup is read as SVG.
const _canvasIcons = new Map();
function canvasIcon(type) {
    const key = iconPaths[type] ? type : 'custom';
    if (!_canvasIcons.has(key)) {
        const holder = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        holder.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="#334155" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${iconPaths[key]}</svg>`;
        _canvasIcons.set(key, holder.firstChild);
    }
    return _canvasIcons.get(key).cloneNode(true);
}

// The map's Wi-Fi colours are tokens (css/app.css, --topo-wifi*), read here
// and written onto the SVG as plain values: the PNG export and the report's
// diagram serialize the drawing without the stylesheet, so a var() would
// come out black. Read afresh per redraw (cheap: one computed style) so a
// theme switch is picked up; the fallbacks are the tokens' own values, for
// a page that has not loaded app.css.
function mapToken(name, fallback) {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    } catch (e) { return fallback; }
}
function wifiMapColours() {
    return {
        line: mapToken('--topo-wifi', '#8b5cf6'),
        halo: mapToken('--topo-wifi-halo', '#ffffff')
    };
}

// Where a wireless link's band chip goes: ON its own line (so nobody has to
// guess which of an AP's fanned-out links it belongs to), toward the client
// end first (links leaving one AP are furthest apart there), and off the
// midpoint, where a selected link's ✕ sits. Each place is tried in turn and
// the first that clears every box in `avoid` (zone and group name tabs,
// devices, other chips and cable labels, a selected link's port labels and
// ✕) wins; when
// none does, the first is used: a crowded map still gets its label.
// `fromAp` is true when the AP is the link's source end. Returns the chip's
// centre and its box (which the caller adds to `avoid`).
const WIFI_CHIP_AT = [0.7, 0.3, 0.8, 0.2, 0.6, 0.4];
function wifiChipPlace(geo, fromAp, w, h, avoid) {
    const hit = (b) => avoid.some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1);
    let first = null;
    for (const t of WIFI_CHIP_AT) {
        const p = geo.pointAt(fromAp ? t : 1 - t);
        const box = { x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2 };
        if (!first) first = { p, box };
        if (!hit(box)) return { p, box };
    }
    return first;
}

// The look an element has when nothing is selected, kept on it so the export
// (canvasSvgMarkup, js/app.js) draws the map unselected from its copy, with no
// redraw. rest: attribute -> value; null = not set at rest. Set only where the
// drawn look differs; what exists only for a selection or link mode carries
// data-sel-only instead, and the export drops it.
function restLook(el, rest) { el.setAttribute('data-rest', JSON.stringify(rest)); }

function drawCanvas() {
    lZones.innerHTML = ''; lLinks.innerHTML = ''; lNodes.innerHTML = ''; lAnn.innerHTML = '';
    state.annotations.forEach(renderAnnotation);
    renderNoteLeaders();
    document.getElementById('networkCanvas').className = `topo-svg${state.linkSourceId ? ' linking' : ''}`;

    // Groups on the map (js/groupmap.js): which devices a collapsed group
    // folds out of sight and which cables it stands for. Null with no groups.
    const gv = groupMapNow();

    // 1. Zone bubbles, one per network drawn (zonesToDraw above).
    let labelOffsets = {};
    // Where each zone's label tab landed, so a Wi-Fi band chip (below) can
    // keep off it: the chip is drawn over the zones and would bury the name.
    const zoneTagBoxes = [];
    zonesToDraw(gv).forEach(({ net, nodes, box }) => {
        const subnet = net.cidr;
        const { minX, minY, maxX, maxY } = box;

        const padX = 45, padTop = 45, padBottom = 80;
        const hue = Array.from(subnet).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'zone-bubble');

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', minX - padX); rect.setAttribute('y', minY - padTop);
        rect.setAttribute('width', maxX - minX + padX * 2); rect.setAttribute('height', maxY - minY + padTop + padBottom);
        rect.setAttribute('rx', '16');
        rect.setAttribute('fill', `hsla(${hue}, 70%, 50%, 0.06)`); rect.setAttribute('stroke', `hsla(${hue}, 70%, 50%, 0.3)`);
        rect.setAttribute('stroke-dasharray', '8 4'); rect.setAttribute('stroke-width', '2');
        g.appendChild(rect);

        // Label sits as a "tab" ABOVE the zone's top edge so it is never
        // hidden behind a node; stacked subnets at the same corner rise upward.
        const labelPosKey = `${minX}_${minY}`;
        const offsetIndex = labelOffsets[labelPosKey] || 0;
        labelOffsets[labelPosKey] = offsetIndex + 1;

        const lx = minX - padX + 6;
        const ly = minY - padTop - 8 - (offsetIndex * 17);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', lx); text.setAttribute('y', ly);
        text.setAttribute('font-size', '11'); text.setAttribute('font-family', 'monospace');
        text.setAttribute('font-weight', 'bold'); text.setAttribute('fill', `hsla(${hue}, 70%, 34%, 1)`);
        // The address, and the name and VLAN when the network has them.
        text.textContent = [isBlank(net.name) ? '' : net.name.trim(), subnet, Number.isInteger(net.vlan) ? `VLAN ${net.vlan}` : '']
            .filter(Boolean).join(' · ');
        g.appendChild(text);
        lZones.appendChild(g);
        // Backdrop behind the text so crossing links don't bleed through it.
        try {
            const bb = text.getBBox();
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('x', bb.x - 5); bg.setAttribute('y', bb.y - 2);
            bg.setAttribute('width', bb.width + 10); bg.setAttribute('height', bb.height + 4);
            bg.setAttribute('rx', '3');
            bg.setAttribute('fill', '#f8fafc'); bg.setAttribute('fill-opacity', '0.9');
            bg.setAttribute('stroke', `hsla(${hue}, 70%, 50%, 0.35)`); bg.setAttribute('stroke-width', '1');
            g.insertBefore(bg, text);
            zoneTagBoxes.push({ x1: bb.x - 5, y1: bb.y - 2, x2: bb.x + bb.width + 5, y2: bb.y + bb.height + 2 });
        } catch (e) { /* getBBox unavailable */ }
    });

    const reach = state.settings.traceMode && state.selectedId && state.selectedType === 'node' ? calculateReachability(state.selectedId) : null;
    // One findings pass for the whole render: the badges below and the alert
    // panel at the end read the same verdicts (js/diagnostics.js).
    const diag = currentDiagnosis();
    // The devices pinned for the next visit: a pin under the badge.
    const pinnedIds = pinnedNodeIds();
    // The search box (js/query.js): what does not match is dimmed, asked
    // afresh on every redraw so an edit or a click never undoes it. A class,
    // not an inline opacity, so the PNG export and the report's diagram
    // (which serialize the SVG without the stylesheet) are never dimmed.
    const qm = typeof queryMapMatches === 'function' ? queryMapMatches() : null;

    // 2. Render Links
    // What a Wi-Fi band chip must not cover (wifiChipPlace): the zone name
    // tabs, every device drawn (its glyph and the name under it), the group
    // frames' name tabs, and each chip and cable label as it is placed. The
    // devices and tabs are listed only when the first chip asks, so a wired
    // map pays nothing for it.
    const wifiInk = wifiMapColours();
    const chipAvoid = zoneTagBoxes.slice();
    let chipNodesIn = false;
    const chipAvoidNodes = () => {
        if (chipNodesIn) return;
        chipNodesIn = true;
        // A device: its 48px glyph and the name and address under it.
        state.nodes.forEach((n) => {
            if (gv && (gv.hidden.has(n.id) || gv.guestHidden.has(n.id))) return;
            chipAvoid.push({ x1: n.x - 46, y1: n.y - 28, x2: n.x + 46, y2: n.y + 54 });
        });
        // A group frame's name tab (js/groupmap.js drawGroupFrames, drawn
        // after the links): its size as that function first guesses it.
        ((gv && gv.frames) || []).forEach(({ group, rect, members }) => {
            const words = `${groupLabel(group)} · ${(members || []).length}`;
            chipAvoid.push({ x1: rect.x + 14, y1: rect.y - 10, x2: rect.x + 14 + 46 + words.length * 6, y2: rect.y + 10 });
        });
    };
    state.links.forEach((link) => {
        const src = getNode(link.source), tgt = getNode(link.target);
        if (!src || !tgt) return;
        if (gv && gv.covered.has(link.id)) return;   // drawn folded, or inside a collapsed group

        const geo = linkGeometry(link);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('fill', 'none');
        applyLinkGeometry(line, geo);
        line.setAttribute('id', `ui-link-${link.id}`);

        const isSelected = inSelection('link', link.id);
        const medium = effectiveMedium(link, src, tgt);

        let defaultColor = '#94a3b8'; // utp
        let dashArray = null;
        let baseWidth = 2;

        // A wireless link's band (link.wifi, else the inference the link panel
        // shows: js/model.js "Wi-Fi"), for its label below and its look: 6 GHz
        // is drawn in a finer dash of the same purple (WIFI_6G_DASH) with a
        // filled chip, so a 6E/7 association reads apart from 2.4 and 5 GHz at
        // a glance and in a PNG. The purple is the --topo-wifi token.
        const wifiBand = medium === 'wireless' ? linkWifiBand(link) : null;

        if (medium === 'fiber') defaultColor = '#06b6d4';
        else if (medium === 'wireless') { defaultColor = wifiInk.line; dashArray = wifiBand === '6' ? WIFI_6G_DASH : '4 4'; }
        else if (medium === 'powerline') { defaultColor = '#eab308'; dashArray = '8 4 2 4'; }
        else if (medium === 'vpn') { defaultColor = '#14b8a6'; dashArray = '10 6'; baseWidth = 2.5; } // secure overlay tunnel

        if (link.attachment === 'passthrough') { defaultColor = '#a855f7'; dashArray = '4 4'; }

        if (reach && reach.reachableLinks.has(link.id)) {
            // Amber still means "reachable"; the flow pattern keeps the medium
            // readable while tracing, which the old single animation lost.
            line.setAttribute('stroke', '#f59e0b');
            line.setAttribute('stroke-width', medium === 'fiber' ? '3.5' : medium === 'wireless' ? '2.5' : '3');
            line.setAttribute('stroke-dasharray', FLOW_DASH[medium] || FLOW_DASH.utp);
            line.setAttribute('class', `${FLOW_CLASS[medium] || FLOW_CLASS.utp} cursor-pointer`);
        } else {
            line.setAttribute('stroke', isSelected ? '#eab308' : defaultColor);
            line.setAttribute('stroke-width', isSelected ? '3' : baseWidth);
            if (isSelected) restLook(line, { stroke: defaultColor, 'stroke-width': String(baseWidth) });
            line.setAttribute('class', reach ? 'fade-inactive cursor-pointer' : 'cursor-pointer transition-colors');
            if (dashArray) line.setAttribute('stroke-dasharray', dashArray);
        }
        line.addEventListener('mousedown', (event) => {
            event.stopPropagation();
            if (addsToSelection(event)) toggleSelected('link', link.id); else select(link.id, 'link');
        });
        if (qm && !qm.links.has(link.id)) line.classList.add('q-dim');
        lLinks.appendChild(line);

        // The cable's own label (link.cable, js/assets.js), lifted off the
        // stroke at the middle of the run, where the selected cable's ✕ is not:
        // the ✕ sits on the stroke, the label beside it. Explicit fonts and a
        // white halo because the PNG export carries no stylesheet; data-adv so
        // the reduced views (which hide cable details) leave it out.
        // A radio or a tunnel is no cable: its stored cable facts are kept but
        // not shown (Review-Packs/Topo-wifi.md), and a wireless link carries
        // its band instead, as a chip on its line (below).
        const cableLabel = medium === 'wireless' || medium === 'vpn' ? '' : cableOf(link, 'label').trim();
        if (cableLabel) {
            const mid = geo.pointAt(0.5);
            const span = Math.hypot(tgt.x - src.x, tgt.y - src.y) || 1;
            const nx = -(tgt.y - src.y) / span, ny = (tgt.x - src.x) / span;
            const tag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            tag.setAttribute('class', qm && !qm.links.has(link.id) ? 'cable-label q-dim' : 'cable-label');
            tag.setAttribute('data-adv', '');
            tag.setAttribute('x', String(mid.x + nx * 16));
            tag.setAttribute('y', String(mid.y + ny * 16 + 3));
            tag.setAttribute('text-anchor', 'middle');
            tag.setAttribute('font-size', '8');
            tag.setAttribute('font-family', 'monospace');
            tag.setAttribute('font-weight', '700');
            tag.setAttribute('fill', '#334155');
            tag.setAttribute('paint-order', 'stroke');
            tag.setAttribute('stroke', '#ffffff');
            tag.setAttribute('stroke-width', '3');
            tag.textContent = cableLabel;
            tag.style.pointerEvents = 'none';
            lLinks.appendChild(tag);
            const cx = mid.x + nx * 16, cy = mid.y + ny * 16, half = cableLabel.length * 2.5 + 2;
            chipAvoid.push({ x1: cx - half, y1: cy - 6, x2: cx + half, y2: cy + 6 });
        }

        // The band ("5 GHz") as a small chip sitting on the link's own line
        // (wifiChipPlace says where), outlined in the link's colour; a 6 GHz
        // link's chip is filled, which with its finer dash is the 6E/7 look.
        // The SSID and the signal are its tooltip, and a press on the chip
        // (or the transparent margin round it, a finger-sized target) selects
        // the link as a press on the line does, so on a phone the link panel,
        // which shows them, is one tap away. Full editor only (data-adv).
        if (wifiBand) {
            const text = wifiBandName(wifiBand);
            const w = text.length * 4.9 + 8, h = 12;
            chipAvoidNodes();
            if (isSelected && state.selection.size === 1) {
                // This link's ✕ and port labels, drawn further down and placed
                // there the same way.
                const m = geo.pointAt(0.5);
                chipAvoid.push({ x1: m.x - 9, y1: m.y - 9, x2: m.x + 9, y2: m.y + 9 });
                const span = Math.hypot(tgt.x - src.x, tgt.y - src.y) || 1;
                const off = Math.min(0.42, Math.max(0.15, 66 / span));
                const pnx = -(tgt.y - src.y) / span, pny = (tgt.x - src.x) / span;
                [[src, link.sourceIface, off, 1], [tgt, link.targetIface, 1 - off, -1]].forEach(([node, ifaceId, at, side]) => {
                    const q = geo.pointAt(at), half = (ifaceId ? ifaceLabel(node, ifaceId) : 'unbound').length * 2.5 + 2;
                    const cx = q.x + pnx * 10 * side, cy = q.y + pny * 10 * side;
                    chipAvoid.push({ x1: cx - half, y1: cy - 6, x2: cx + half, y2: cy + 6 });
                });
            }
            const ends = wifiLinkEnds(link, src, tgt);
            const fromAp = !ends || !ends.ap || ends.ap.node === src;
            const { p, box } = wifiChipPlace(geo, fromAp, w, h, chipAvoid);
            chipAvoid.push(box);
            const six = wifiBand === '6';
            const chip = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            chip.setAttribute('class', qm && !qm.links.has(link.id) ? 'wifi-band-chip q-dim' : 'wifi-band-chip');
            chip.setAttribute('data-adv', '');
            chip.setAttribute('data-link', link.id);
            chip.setAttribute('transform', 'translate(' + p.x + ', ' + p.y + ')');
            const pad = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            pad.setAttribute('x', String(-w / 2 - 6)); pad.setAttribute('y', String(-h / 2 - 6));
            pad.setAttribute('width', String(w + 12)); pad.setAttribute('height', String(h + 12));
            pad.setAttribute('fill', 'transparent');
            chip.appendChild(pad);
            const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            pill.setAttribute('x', String(-w / 2)); pill.setAttribute('y', String(-h / 2));
            pill.setAttribute('width', String(w)); pill.setAttribute('height', String(h)); pill.setAttribute('rx', String(h / 2));
            pill.setAttribute('fill', six ? defaultColor : wifiInk.halo);
            pill.setAttribute('stroke', defaultColor); pill.setAttribute('stroke-width', '1');
            chip.appendChild(pill);
            const tag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            tag.setAttribute('class', 'wifi-band-label');
            tag.setAttribute('data-link', link.id);
            tag.setAttribute('y', '2.8');
            tag.setAttribute('text-anchor', 'middle');
            tag.setAttribute('font-size', '8');
            tag.setAttribute('font-family', 'monospace');
            tag.setAttribute('font-weight', '700');
            tag.setAttribute('fill', six ? wifiInk.halo : defaultColor);
            tag.textContent = text;
            chip.appendChild(tag);
            const ssid = linkWifiSsid(link), signal = linkWifiOf(link, 'signal');
            const tip = [ssid ? wifiLabel(wifiById(ssid)) : '', text, signal !== undefined ? signal + ' dBm' : ''].filter(Boolean).join(' · ');
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = tip;
            chip.appendChild(title);
            chip.addEventListener('mousedown', (event) => {
                event.stopPropagation();
                if (addsToSelection(event)) toggleSelected('link', link.id); else select(link.id, 'link');
            });
            lLinks.appendChild(chip);
        }

        // Radio does not march down a wire, so a traced wireless link emits ")))"
        // arcs that ride the link itself — textPath rotates each glyph to follow
        // the path, so they stay square-on to the direction of travel even on a
        // bowed run.
        if (reach && reach.reachableLinks.has(link.id) && medium === 'wireless') {
            const waves = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            waves.setAttribute('class', qm && !qm.links.has(link.id) ? 'flow-wave q-dim' : 'flow-wave');
            waves.setAttribute('font-family', 'monospace');
            waves.setAttribute('font-size', '13');
            waves.setAttribute('font-weight', '700');
            waves.setAttribute('fill', '#f59e0b');
            waves.setAttribute('dominant-baseline', 'middle');

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
            path.setAttribute('href', `#ui-link-${link.id}`);

            // Measure the glyph advance once rather than assuming it: the loop has
            // to close on exactly one repeat or the arcs visibly jump. It only
            // depends on the font and size, both fixed, so every later link reuses
            // it and skips the layout flush entirely.
            const total = line.getTotalLength();
            const reps = waveAdvance ? Math.ceil(total / waveAdvance) + 2 : Math.max(3, Math.ceil(total / 8) + 3);
            path.textContent = WAVE_UNIT.repeat(reps);
            waves.appendChild(path);
            lLinks.appendChild(waves);

            if (!waveAdvance) waveAdvance = waves.getComputedTextLength() / reps;
            const advance = waveAdvance;
            if (advance > 0) {
                // Run from -advance to 0: starting at 0 would leave a bare gap at
                // the head of the link for one whole cycle.
                const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                anim.setAttribute('attributeName', 'startOffset');
                anim.setAttribute('from', String(-advance));
                anim.setAttribute('to', '0');
                anim.setAttribute('dur', '1.2s');
                anim.setAttribute('repeatCount', 'indefinite');
                path.appendChild(anim);
            }
        }

        // Port labels would bury the canvas if always on, so they ride the
        // selection — of this one cable: a set (Ctrl+A) would bury it again.
        // So does its ✕, which deletes the selection: on one cable of a set it
        // would delete the whole set (the rail and the Del key do that).
        if (isSelected && state.selection.size === 1) {
            // Place labels a fixed distance out rather than a fixed fraction, so
            // they clear the node's glyph and IP text on a short link without
            // drifting to the midpoint on a long one.
            const span = Math.hypot(tgt.x - src.x, tgt.y - src.y) || 1;
            const off = Math.min(0.42, Math.max(0.15, 66 / span));
            // Perpendicular offset lifts labels off the stroke; opposite sides so
            // the two names never collide with each other or the midpoint ✕ on a
            // short link, where both ride near the centre.
            const pnx = -(tgt.y - src.y) / span, pny = (tgt.x - src.x) / span;

            [[src, link.sourceIface, off, 1], [tgt, link.targetIface, 1 - off, -1]].forEach(([node, ifaceId, t, side]) => {
                const name = ifaceId ? ifaceLabel(node, ifaceId) : 'unbound';
                const at = geo.pointAt(t);
                const portLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                portLabel.setAttribute('class', 'port-label'); portLabel.setAttribute('data-adv', ''); // hidden in the reduced views (css/app.css)
                portLabel.setAttribute('data-sel-only', '');   // drawn for the selected cable only, so never exported
                portLabel.setAttribute('x', String(at.x + pnx * 10 * side));
                portLabel.setAttribute('y', String(at.y + pny * 10 * side + 2.5));
                portLabel.setAttribute('text-anchor', 'middle');
                portLabel.setAttribute('font-size', '8');
                portLabel.setAttribute('font-family', 'monospace');
                portLabel.setAttribute('font-weight', '700');
                portLabel.setAttribute('fill', ifaceId ? '#a16207' : '#dc2626');
                portLabel.setAttribute('paint-order', 'stroke');
                portLabel.setAttribute('stroke', '#ffffff');
                portLabel.setAttribute('stroke-width', '3');
                portLabel.textContent = name;
                portLabel.style.pointerEvents = 'none';
                lLinks.appendChild(portLabel);
            });

            // Midpoint ✕ — same affordance as nodes and note leaders
            const mid = geo.pointAt(0.5);
            const del = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            del.setAttribute('transform', `translate(${mid.x}, ${mid.y})`);
            del.setAttribute('class', 'node-delete');
            const disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            disc.setAttribute('r', '7.5');
            disc.setAttribute('fill', '#dc2626'); disc.setAttribute('stroke', '#ffffff'); disc.setAttribute('stroke-width', '1.5');
            del.appendChild(disc);
            const mark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            mark.setAttribute('text-anchor', 'middle'); mark.setAttribute('y', '3');
            mark.setAttribute('font-size', '9'); mark.setAttribute('font-weight', '900'); mark.setAttribute('fill', '#ffffff');
            mark.setAttribute('font-family', 'sans-serif');
            mark.textContent = '✕'; mark.style.pointerEvents = 'none';
            del.appendChild(mark);
            const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            tip.textContent = t('Delete link');
            del.appendChild(tip);
            del.addEventListener('mousedown', (e) => e.stopPropagation());
            del.addEventListener('click', (e) => { e.stopPropagation(); deleteSelected(); });
            lLinks.appendChild(del);
        }
    });

    // 3. Render Nodes
    // How many VMs and containers run on each host, for its badge (js/groupmap.js).
    const guestCounts = hostFoldShown() ? hostGuestCounts() : null;
    state.nodes.forEach((node) => {
        if (gv && gv.hidden.has(node.id)) return;   // folded into its collapsed group
        if (gv && gv.guestHidden.has(node.id)) return;   // folded into its host
        // The guests folded into this host: it stands for them on the map, as
        // a collapsed group's node does for its devices, so a search match, a
        // trace or a selection among them shows on it.
        const inFold = (gv && gv.hostFolds.get(node.id)) || null;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('id', `ui-node-${node.id}`);
        g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

        const isSelected = inSelection('node', node.id);
        const isLinkSource = state.linkSourceId === node.id;
        const isReachable = reach && (reach.reachableNodes.has(node.id) || (!!inFold && inFold.some((x) => reach.reachableNodes.has(x.id))));
        const foldPicked = !isSelected && !!inFold && inFold.some((x) => inSelection('node', x.id));
        const foldHit = !!qm && !!inFold && inFold.some((x) => qm.nodes.has(x.id));
        const isInactiveTraceNode = reach && !isReachable;
        const severity = nodeSeverity(node, diag);

        let classes = state.linkSourceId ? (isLinkSource ? 'linking-glow cursor-crosshair' : 'cursor-crosshair') : 'cursor-grab active:cursor-grabbing';
        if (isInactiveTraceNode) classes += ' fade-inactive';
        if (qm && !qm.nodes.has(node.id) && !foldHit) classes += ' q-dim';
        g.setAttribute('class', classes);
        // Retired (js/assets.js): still in the register, no longer on the
        // network. An attribute, not a class, because it is a fact about the
        // device and the PNG export and the report's diagram should show it.
        if (isRetired(node)) {
            g.setAttribute('opacity', '0.4');
            g.setAttribute('data-status', 'retired');
        }

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '-24'); rect.setAttribute('y', '-24'); rect.setAttribute('width', '48'); rect.setAttribute('height', '48'); rect.setAttribute('rx', '6');

        // The look at rest first (traced, a finding, plain), then what the
        // link mode or a selection lays over it; the export puts the rest
        // back (restLook).
        const [restFill, restStroke, restWidth] = isReachable ? ['#fffbeb', '#fcd34d', '2.5']
            : severity === 'bad' ? ['#fef2f2', '#dc2626', '2']
            : severity === 'warn' ? ['#fffbeb', '#d97706', '2']
            : ['#ffffff', '#cbd5e1', '1.5'];
        const restDash = isVirtualType(node.type) ? '4 3' : null;
        const [fill, stroke, width] = isLinkSource ? ['#fefce8', '#ca8a04', '2']
            : isSelected ? ['#fefce8', '#eab308', '2']
            : [restFill, restStroke, restWidth];
        rect.setAttribute('fill', fill); rect.setAttribute('stroke', stroke); rect.setAttribute('stroke-width', width);
        if (restDash) rect.setAttribute('stroke-dasharray', restDash);
        // Some of what is folded into it is selected (a table row, a finding).
        const foldLook = foldPicked && !isLinkSource;
        if (foldLook) { rect.setAttribute('stroke', '#eab308'); rect.setAttribute('stroke-width', '2'); rect.setAttribute('stroke-dasharray', '5 3'); }
        if (isLinkSource || isSelected || foldLook) restLook(rect, { fill: restFill, stroke: restStroke, 'stroke-width': restWidth, 'stroke-dasharray': restDash });
        rect.style.transition = 'all 0.1s ease'; g.appendChild(rect);

        const iconG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        iconG.setAttribute('transform', 'translate(-12, -14)');
        iconG.appendChild(canvasIcon(node.type));
        iconG.style.pointerEvents = 'none'; g.appendChild(iconG);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('text-anchor', 'middle'); label.setAttribute('y', '36'); label.setAttribute('font-size', '10');
        // Explicit generic family so the PNG/WEBP export — rasterized without the
        // page's CSS — renders in sans, not each engine's default serif.
        label.setAttribute('font-family', 'sans-serif');
        label.setAttribute('font-weight', '600'); label.setAttribute('fill', '#334155'); label.textContent = node.name; label.style.pointerEvents = 'none';
        g.appendChild(label);

        // "↗ Torre A" under a cloud that stands for another site. Drawn exactly
        // the same whether or not the reference resolves in this browser: the
        // drawing is the deliverable and it is read by people with no library
        // at all, so it must not say two different things to two readers.
        if (node.siteRef && (node.siteRef.name || node.siteRef.id)) {
            const ref = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            ref.setAttribute('text-anchor', 'middle'); ref.setAttribute('y', '48'); ref.setAttribute('font-size', '9');
            ref.setAttribute('font-family', 'sans-serif');   // exported PNGs carry no stylesheet
            ref.setAttribute('fill', '#64748b');
            ref.textContent = `↗ ${node.siteRef.name || node.siteRef.id}`;
            ref.style.pointerEvents = 'none';
            g.appendChild(ref);
        }

        // Badge rides on top of selection/trace styling, so a flapping node stays
        // visible even while it is selected or lit up by a trace.
        if (severity) {
            const issues = nodeDiagnosis(node, diag).issues;
            const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badge.setAttribute('transform', 'translate(19, -19)');

            const disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            disc.setAttribute('r', '7.5');
            disc.setAttribute('fill', severity === 'bad' ? '#dc2626' : '#d97706');
            disc.setAttribute('stroke', '#ffffff');
            disc.setAttribute('stroke-width', '1.5');
            badge.appendChild(disc);

            const mark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            mark.setAttribute('text-anchor', 'middle'); mark.setAttribute('y', '3.5');
            mark.setAttribute('font-size', '10'); mark.setAttribute('font-weight', '900'); mark.setAttribute('fill', '#ffffff');
            mark.setAttribute('font-family', 'sans-serif');
            mark.textContent = '!';
            badge.appendChild(mark);

            const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            tip.textContent = issues.map((i) => `${i.label}: ${i.text}`).join('\n\n');
            badge.appendChild(tip); // needs pointer events for the tooltip; clicks bubble to the node

            g.appendChild(badge);
        }

        // Pinned for the next visit (js/diagnostics.js): a small pin at the
        // bottom-right corner, clear of the badge and the ✕ above. Explicit
        // colours and fonts, as the badge's: a PNG export has no stylesheet.
        if (pinnedIds.has(node.id)) {
            const pin = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            pin.setAttribute('transform', 'translate(19, 15)');
            pin.setAttribute('class', 'node-pin');
            const disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            disc.setAttribute('r', '7');
            disc.setAttribute('fill', '#7c3aed'); disc.setAttribute('stroke', '#ffffff'); disc.setAttribute('stroke-width', '1.5');
            pin.appendChild(disc);
            // A pushpin: its head, the collar flaring out, and the needle.
            const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            head.setAttribute('d', 'M-2.2 -4.6 H2.2 L1.4 -1.6 L3.3 0.6 H-3.3 L-1.4 -1.6 Z'); head.setAttribute('fill', '#ffffff');
            pin.appendChild(head);
            const needle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            needle.setAttribute('d', 'M0 0.6 L0 4.6'); needle.setAttribute('stroke', '#ffffff'); needle.setAttribute('stroke-width', '1.4'); needle.setAttribute('stroke-linecap', 'round');
            pin.appendChild(needle);
            const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            tip.textContent = t('Pinned: to check on the next visit');
            pin.appendChild(tip);
            g.appendChild(pin);
        }

        // Little ✕ on the selected node — the touch twin of the Delete key and
        // the sidebar's Delete button. Top-LEFT corner: the severity badge owns
        // the top-right, and a warning must never hide behind a delete control.
        // Suppressed while link mode is armed so a mis-tap cannot destroy the
        // node someone is aiming a cable at. One device selected only: the ✕
        // deletes the selection, and on one device of a set it would take
        // them all (the rail's Delete and the Del key say so plainly).
        if (isSelected && state.selection.size === 1 && !state.linkSourceId) {
            const del = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            del.setAttribute('transform', 'translate(-19, -19)');
            del.setAttribute('class', 'node-delete');

            const disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            disc.setAttribute('r', '7.5');
            disc.setAttribute('fill', '#dc2626'); disc.setAttribute('stroke', '#ffffff'); disc.setAttribute('stroke-width', '1.5');
            del.appendChild(disc);

            const mark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            mark.setAttribute('text-anchor', 'middle'); mark.setAttribute('y', '3');
            mark.setAttribute('font-size', '9'); mark.setAttribute('font-weight', '900'); mark.setAttribute('fill', '#ffffff');
            mark.setAttribute('font-family', 'sans-serif');
            mark.textContent = '✕'; mark.style.pointerEvents = 'none';
            del.appendChild(mark);

            const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            tip.textContent = t('Delete node');
            del.appendChild(tip);

            del.addEventListener('mousedown', (e) => e.stopPropagation()); // no drag from the ✕
            del.addEventListener('click', (e) => { e.stopPropagation(); deleteSelected(); });
            g.appendChild(del);
        }

        if (isLinkSource) {
            const hint = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            hint.setAttribute('text-anchor', 'middle'); hint.setAttribute('y', '-34'); hint.setAttribute('font-size', '9');
            hint.setAttribute('font-family', 'sans-serif'); hint.setAttribute('data-sel-only', '');
            hint.setAttribute('font-weight', '700'); hint.setAttribute('fill', '#ca8a04'); hint.textContent = t('LINK TARGET...'); hint.style.pointerEvents = 'none';
            g.appendChild(hint);
        }

        if (!isDumbDevice(node) && node.interfaces && node.interfaces.length > 0) {
            const validDisplayIps = node.interfaces.map(i=>i.ip).filter((i) => typeof i === 'string' && i.trim() !== '');
            validDisplayIps.slice(0, 2).forEach((ip, idx) => {
                const ipLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                ipLabel.setAttribute('class', 'node-ip'); ipLabel.setAttribute('data-adv', ''); // hidden in the reduced views (css/app.css)
                ipLabel.setAttribute('text-anchor', 'middle'); ipLabel.setAttribute('y', String(48 + idx * 10));
                ipLabel.setAttribute('font-size', '8'); ipLabel.setAttribute('font-family', 'monospace'); ipLabel.setAttribute('fill', '#64748b');
                let text = ip; if (idx === 1 && validDisplayIps.length > 2) { text += ` (+${validDisplayIps.length - 2})`; }
                ipLabel.textContent = text; ipLabel.style.pointerEvents = 'none'; g.appendChild(ipLabel);
            });
        }

        // Something runs on it: its badge, which folds them in (js/groupmap.js).
        if (guestCounts && guestCounts.get(node.id)) drawHostBadge(g, node, guestCounts.get(node.id), isHostFolded(node.id));

        // Interactions
        g.addEventListener('mousedown', (event) => pressNode(event, node));
        // A finger that drags it: the same press, once it has travelled
        // (touchPressNode, js/app.js). Passive: a tap stays the browser's.
        g.addEventListener('touchstart', (event) => touchPressNode(event, node), { passive: true });

        g.addEventListener('click', (event) => {
            event.stopPropagation();
            if (state.linkSourceId) {
                // Armed from a text note → complete the red leader here instead
                // of a network link; the note owns the pairing (see toggleNoteLink).
                const srcAnn = getAnnotation(state.linkSourceId);
                if (srcAnn) { toggleNoteLink(srcAnn, node.id); return; }
                // The armed node can be gone by now — loading a shared URL swaps
                // state.nodes out from under link mode without disarming it — and
                // a null here would throw and leave the canvas stuck in crosshair.
                if (state.linkSourceId !== node.id && getNode(state.linkSourceId)) {
                    const sNode = getNode(state.linkSourceId);
                    // A second cable between the same pair is legitimate (redundant
                    // NICs, LAG), so only an identical port-to-port run is a duplicate.
                    const link = { id: nextId('l'), source: state.linkSourceId, target: node.id, attachment: (isVirtualType(sNode.type) || isVirtualType(node.type)) ? 'bridged' : null };
                    bindLink(link);
                    const duplicate = state.links.some((l) =>
                        (l.source === link.source && l.target === link.target && l.sourceIface === link.sourceIface && l.targetIface === link.targetIface) ||
                        (l.source === link.target && l.target === link.source && l.sourceIface === link.targetIface && l.targetIface === link.sourceIface));
                    if (!duplicate) state.links.push(link);
                }
                state.linkSourceId = null; save();
                renderCanvasOnly();
                // Show the diagnostics for whatever is actually selected. Link
                // mode does not change the selection, so linking B to A while C
                // is selected would otherwise put A's verdicts under C's details.
                // Re-render the sidebar too: binding the link can have grown this
                // node a NIC, which would not show until it was reselected.
                if (state.selectedType === 'node' && state.selectedId) {
                    const selected = getNode(state.selectedId);
                    if (selected) renderSidebarData(selected);
                }
                refreshSelectedNodeDiagnostics();
            }
        });

        g.addEventListener('contextmenu', (event) => {
            event.preventDefault(); // Stops browser menu
            event.stopPropagation();
            state.linkSourceId = node.id;
            renderCanvasOnly();
        });

        lNodes.appendChild(g);
    });
    // 4. Groups: frames on their own layer under the cables, the folded
    // cables and the collapsed nodes over everything drawn above.
    drawGroupMap(gv, { reach, qm, diag });
    return { reach, diag };
}

// Switch/AP faceplate: how many ports the device has, and what is in them.
// Ports stay implicit unless one is given a name or IP, so a 48-port switch
// costs one number in the URL hash rather than 48 objects.
function renderFaceplate(node, container) {
    const wrap = document.createElement('div');
    wrap.className = 'faceplate';

    const head = document.createElement('div');
    head.className = 'prop-headrow';
    head.innerHTML = '<span class="prop-lbl">Physical Ports</span>';

    const count = document.createElement('input');
    count.id = 'portCountInput';
    count.type = 'number'; count.min = '0'; count.max = '96';
    count.value = String(portCountOf(node));
    count.className = 'if-in faceplate-count';
    // Lowering the count under a port that has a cable in it is refused rather
    // than applied: the cable would be left on a port the switch no longer has,
    // which is a fault Topo made up, not one the network has. The field keeps
    // what was typed, so the "2" on the way to "24" is only refused, never
    // undone, and the next digit lands. Leaving the field puts the real count
    // back.
    const cabledUpTo = () => linksAtNode(node.id).reduce((max, l) => {
        const m = /^p(\d+)$/.exec(ifaceIdOn(l, node.id) || '');
        return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const refusal = document.createElement('div');
    refusal.className = 'faceplate-refusal';
    refusal.id = 'portCountRefusal';
    refusal.hidden = true;
    const refuse = (n) => {
        count.classList.add('bad');
        refusal.textContent = t('Port {n} has a cable in it. Move that cable before going below {n} ports.', { n });
        refusal.hidden = false;
    };
    count.onblur = () => {
        if (refusal.hidden) return;
        count.value = String(portCountOf(node));
        count.classList.remove('bad');
        refusal.hidden = true;
    };
    count.oninput = (e) => {
        const next = parseInt(e.target.value, 10);
        if (!Number.isFinite(next) || next < 0) return;
        const cabled = cabledUpTo();
        if (next < cabled) { refuse(cabled); return; }
        const caret = e.target.selectionStart;
        node.portCount = Math.min(next, 96);
        saveTyping(); renderCanvasOnly(); renderSidebarData(node); renderNodeDiagnostics(node);
        // Redrawing the faceplate destroys the very field being typed into, so
        // focus lands on <body> and the second digit of "24" goes nowhere. Put
        // the cursor back on the replacement.
        const live = document.getElementById('portCountInput');
        if (live) { live.focus(); try { live.setSelectionRange(caret, caret); } catch (err) { /* number inputs */ } }
    };
    head.appendChild(count);
    wrap.appendChild(head);
    wrap.appendChild(refusal);
    wrap.appendChild(renderPortScheme(node));

    const grid = document.createElement('div');
    grid.className = 'chip-row';
    const ports = getInterfaces(node).filter((i) => /^p\d+$/.test(i.id));
    // Cables past an explicit faceplate (port overflow, see js/model.js) are
    // drawn after it and marked, so the finding has something to point at.
    const total = portCountOf(node);
    const over = [...new Set(linksAtNode(node.id).map((l) => ifaceIdOn(l, node.id))
        .filter((id) => /^p\d+$/.test(id || '') && Number(id.slice(1)) > total))]
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

    if (!ports.length) {
        grid.innerHTML = '<span class="rail-none">No ports. Raise the count above.</span>';
    }

    // The faceplate shows positions (1, 2, 3…), as the hardware is printed;
    // the name the scheme gives a port, its label and its VLAN are in the
    // chip's tooltip and in the list below. A dot marks a port with a label
    // or a VLAN.
    ports.forEach((port) => {
        const link = linkOnIface(node.id, port.id);
        const neighbour = link ? getNode(link.source === node.id ? link.target : link.source) : null;
        const chip = document.createElement('button');
        chip.className = 'port-chip' + (neighbour ? ' on' : '') + (hasPortAttrs(node, port.id) ? ' noted' : '');
        chip.dataset.port = port.id;
        // (A port given a name of its own, an uplink called sfp1, shows it.)
        const n = Number(port.id.slice(1));
        chip.textContent = port.name && port.name !== portNameOf(node, n) ? port.name : String(n);
        chip.title = portChipTitle(node, port.id);
        // A cabled port jumps to its cable; a free one opens its line in the
        // list, to label it.
        chip.onclick = link ? () => select(link.id, 'link') : () => openPortAttr(node, port.id);
        grid.appendChild(chip);
    });
    over.forEach((id) => {
        const link = linkOnIface(node.id, id);
        const chip = document.createElement('button');
        chip.className = 'port-chip on over' + (hasPortAttrs(node, id) ? ' noted' : '');
        chip.dataset.port = id;
        chip.textContent = id.slice(1);
        chip.title = portChipTitle(node, id);
        if (link) chip.onclick = () => select(link.id, 'link');
        grid.appendChild(chip);
    });

    wrap.appendChild(grid);
    wrap.appendChild(renderPortAttrs(node));
    container.appendChild(wrap);
}

// One port as a tooltip: its name, its label and VLAN, what is in it, and
// whether it sits past the faceplate.
function portChipTitle(node, portId) {
    const a = portAttrOf(node, portId);
    const link = linkOnIface(node.id, portId);
    const neighbour = link ? getNode(link.source === node.id ? link.target : link.source) : null;
    const head = [ifaceLabel(node, portId), a.label, a.vlan !== null ? `VLAN ${a.vlan}` : ''].filter(Boolean).join(' · ');
    const title = neighbour ? t('Port {port} → {name}', { port: head, name: neighbour.name || neighbour.id }) : t('Port {port}: free', { port: head });
    const total = portCountOf(node);
    return Number(portId.slice(1)) > total ? `${title}\n${t('Past the {total}-port faceplate', { total })}` : title;
}

// What the faceplate says about its ports, brought up to date in place after
// a label, a VLAN or the scheme is typed: the chips' dots and tooltips and
// the list's count. Typing never redraws the faceplate (the field being typed
// into would go), so without this they caught up only when the device was
// selected again.
function refreshPortMarks(node) {
    const wrap = document.querySelector('#ifaceListContainer .faceplate');
    if (!wrap) return;
    wrap.querySelectorAll('.port-chip[data-port]').forEach((chip) => {
        chip.classList.toggle('noted', hasPortAttrs(node, chip.dataset.port));
        chip.title = portChipTitle(node, chip.dataset.port);
    });
    const sum = wrap.querySelector('#portAttrBox > summary');
    if (sum) sum.textContent = portAttrsSummary(node);
}
function portAttrsSummary(node) {
    const noted = faceplatePortIds(node).filter((id) => hasPortAttrs(node, id)).length;
    return noted ? `${t('Port labels and VLANs')} (${noted})` : t('Port labels and VLANs');
}

// ---- Port names, labels and access VLANs (node.portScheme, node.portAttrs) ----
// The vocabulary is the full editor's (Physical Ports, VLAN stay English);
// the words around it are translated. Each field typed into is one undo step
// (saveTyping), and typing never redraws the field being typed into.

// How the box names its ports: a prefix and the number port 1 is called.
// "Gi1/0/" from 1 names port 12 Gi1/0/12. Only the names change: cables stay
// on the same positions.
function renderPortScheme(node) {
    const row = document.createElement('div');
    row.className = 'port-scheme';
    const cap = document.createElement('span');
    cap.className = 'prop-lbl';
    cap.textContent = t('Port names');
    const scheme = node.portScheme || {};
    const prefix = document.createElement('input');
    prefix.type = 'text'; prefix.id = 'portPrefixInput';
    prefix.className = 'if-in port-prefix';
    prefix.value = typeof scheme.prefix === 'string' ? scheme.prefix : '';
    prefix.placeholder = t('Prefix, e.g. Gi1/0/');
    prefix.setAttribute('aria-label', t('Prefix'));
    prefix.maxLength = PORT_PREFIX_MAX;
    const start = document.createElement('input');
    start.type = 'number'; start.id = 'portStartInput';
    start.min = '0'; start.max = '9999';
    start.className = 'if-in port-start';
    start.value = String(Number.isInteger(scheme.start) ? scheme.start : 1);
    start.title = t('The number port 1 is called');
    start.setAttribute('aria-label', t('The number port 1 is called'));
    const preview = document.createElement('div');
    preview.className = 'port-scheme-preview';
    const showPreview = () => {
        const total = portCountOf(node);
        preview.textContent = total > 1 ? `${portNameOf(node, 1)} … ${portNameOf(node, total)}` : portNameOf(node, 1);
    };
    // Each field is checked on its own, so a bad one never holds up the
    // other: a start of -1 does not stop the prefix being written, and the
    // other way round. A bad field writes what the scheme said when the
    // field was entered (as the port VLAN does), not the keystroke before
    // it: "Port " on the way to "Port 0" was never meant. Leaving it shows
    // what is kept.
    let entered = null;
    const stored = () => ({ prefix: typeof (node.portScheme || {}).prefix === 'string' ? node.portScheme.prefix : '',
        start: Number.isInteger((node.portScheme || {}).start) ? node.portScheme.start : 1 });
    const mark = (input, bad, why) => {
        input.classList.toggle('bad', bad);
        if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
        if (why) input.title = bad ? why : (input === start ? t('The number port 1 is called') : '');
    };
    const apply = () => {
        // Typed into without being entered (a script): the scheme as it is.
        const was = entered || stored();
        const n = start.value.trim() === '' ? 1 : Number(start.value);
        const startOk = Number.isInteger(n) && n >= 0 && n <= 9999;
        const prefixOk = portPrefixOk(prefix.value);
        mark(start, !startOk);
        const why = t('A prefix cannot end in a digit: the port number would run into it. End it with a separator, such as / or a space.');
        mark(prefix, !prefixOk, why);
        const next = normalizePortScheme({ prefix: prefixOk ? prefix.value : was.prefix, start: startOk ? n : was.start });
        if (next) node.portScheme = next; else delete node.portScheme;
        showPreview();
        preview.classList.toggle('bad', !prefixOk);
        if (!prefixOk) preview.textContent = why;
        // The chips' tooltips, the list's names, the canvas port labels and
        // the link panel all read the new names; the two fields stay.
        const list = document.getElementById('portAttrList');
        if (list) list.querySelectorAll('[data-port-name]').forEach((el) => { el.textContent = ifaceLabel(node, el.dataset.portName); });
        refreshPortMarks(node);
        // Held until the field is left: "Port " on the way to "Port 0/" is a
        // scheme nobody chose, and an idle pause must not make it an undo step.
        saveTyping(true); renderTyped();
    };
    prefix.addEventListener('input', apply);
    start.addEventListener('input', apply);
    [prefix, start].forEach((input) => {
        input.addEventListener('focus', () => { entered = stored(); });
        input.addEventListener('blur', () => {
            entered = null;
            if (!input.classList.contains('bad')) return;
            const now = stored();
            input.value = input === prefix ? now.prefix : String(now.start);
            mark(input, false, true);
            if (input === prefix) { preview.classList.remove('bad'); showPreview(); }
        });
    });
    showPreview();
    const fields = document.createElement('div');
    fields.className = 'port-scheme-fields';
    fields.appendChild(prefix); fields.appendChild(start);
    row.appendChild(cap); row.appendChild(fields); row.appendChild(preview);
    return row;
}

// Every faceplate port, one line each: its name, a label and an access VLAN.
// Folded by default (a 48-port switch is 48 lines); open stays open while
// the panel is redrawn, for as long as the page is.
let _portAttrsOpen = false;
function renderPortAttrs(node) {
    const box = document.createElement('details');
    box.className = 'port-attrs';
    box.id = 'portAttrBox';
    box.open = _portAttrsOpen;
    box.addEventListener('toggle', () => { _portAttrsOpen = box.open; });
    const ids = faceplatePortIds(node);
    const sum = document.createElement('summary');
    sum.textContent = portAttrsSummary(node);
    box.appendChild(sum);
    const list = document.createElement('div');
    list.className = 'port-attr-list';
    list.id = 'portAttrList';
    ids.forEach((id) => {
        const a = portAttrOf(node, id);
        const line = document.createElement('div');
        line.className = 'port-attr';
        line.dataset.port = id;
        const name = document.createElement('span');
        name.className = 'port-attr-name mono';
        name.dataset.portName = id;
        name.textContent = ifaceLabel(node, id);
        const label = document.createElement('input');
        label.type = 'text'; label.className = 'if-in port-attr-label';
        label.value = a.label;
        label.placeholder = t('Label');
        label.maxLength = 64;
        label.setAttribute('aria-label', `${t('Label')} · ${ifaceLabel(node, id)}`);
        label.addEventListener('input', () => {
            setPortAttr(node, id, 'label', label.value);
            refreshPortMarks(node);
            saveTyping(); renderTyped();
        });
        const vlan = document.createElement('input');
        vlan.type = 'text'; vlan.inputMode = 'numeric'; vlan.className = 'if-in port-attr-vlan';
        vlan.value = a.vlan === null ? '' : String(a.vlan);
        vlan.placeholder = 'VLAN';
        vlan.setAttribute('aria-label', `VLAN · ${ifaceLabel(node, id)}`);
        // 1-4094 or nothing. Anything else is marked and not written, as a
        // half-typed address is: the field keeps it, the document does not.
        // Typed digit by digit, "5000" passes through 5, 50 and 500, so a
        // refused value also puts back what the port held when the field was
        // entered; otherwise its last valid prefix (500, a VLAN nobody meant)
        // would stay in the document, the report and the link. Leaving a
        // refused field shows that value again.
        let held = a.vlan === null ? undefined : a.vlan;
        const vlanNow = () => { const v = portAttrOf(node, id).vlan; return v === null ? undefined : v; };
        vlan.addEventListener('focus', () => { held = vlanNow(); });
        vlan.addEventListener('input', () => {
            const v = vlan.value.trim();
            const n = v ? asVlan(v) : undefined;
            const bad = !!v && n === undefined;
            vlan.classList.toggle('bad', bad);
            const want = bad ? held : n;
            if (vlanNow() === want) return;
            setPortAttr(node, id, 'vlan', want);
            refreshPortMarks(node);
            saveTyping(); renderTyped();
        });
        vlan.addEventListener('blur', () => {
            if (!vlan.classList.contains('bad')) return;
            const now = vlanNow();
            vlan.value = now === undefined ? '' : String(now);
            vlan.classList.remove('bad');
        });
        const link = linkOnIface(node.id, id);
        const peer = link ? getNode(link.source === node.id ? link.target : link.source) : null;
        const where = document.createElement('span');
        where.className = 'port-attr-peer';
        where.textContent = peer ? `→ ${peer.name || peer.id}` : '';
        line.appendChild(name); line.appendChild(label); line.appendChild(vlan); line.appendChild(where);
        list.appendChild(line);
    });
    box.appendChild(list);
    return box;
}

// A free port's chip: the list opens on that port's label.
function openPortAttr(node, portId) {
    const box = document.getElementById('portAttrBox');
    if (!box) return;
    box.open = true; _portAttrsOpen = true;
    const line = box.querySelector(`.port-attr[data-port="${portId}"]`);
    const input = line && line.querySelector('.port-attr-label');
    if (input) { input.focus(); line.scrollIntoView({ block: 'nearest' }); }
}

function renderSidebarData(node) {
    const ifCont = document.getElementById('ifaceListContainer'); ifCont.innerHTML = '';
    node.interfaces = node.interfaces || [];

    if (hasPortGrid(node)) renderFaceplate(node, ifCont);

    // The bond button only makes sense with two wired NICs to fold together.
    const bondBtn = document.getElementById('bondIfaceBtn');
    if (bondBtn) {
        const bondable = bondCandidates(node);
        bondBtn.classList.toggle('hidden', bondable.length < 2);
        // When the NICs carry different addresses, createBond() refuses to
        // pick which one the bond keeps (js/model.js), so the button opens
        // that choice instead. A listener of its own, beside app.js's
        // onclick: that one bonds when there is nothing to choose, and does
        // nothing when there is.
        if (!bondBtn.dataset.choiceWired) {
            bondBtn.dataset.choiceWired = '1';
            bondBtn.addEventListener('click', () => {
                const sel = state.selectedType === 'node' ? getNode(state.selectedId) : null;
                if (!sel || bondAddresses(sel).length < 2) return;
                bondChoiceFor = sel.id;
                renderSidebarData(sel);
            });
        }
        const addresses = bondable.length < 2 ? [] : bondAddresses(node);
        if (bondChoiceFor === node.id && addresses.length > 1) renderBondChoice(node, addresses, ifCont);
        else bondChoiceFor = null;
    }

    if (!node.interfaces.length) {
        if (!hasPortGrid(node)) ifCont.innerHTML = '<span class="rail-none">No interfaces defined.</span>';
    }
    else {
        node.interfaces.forEach((iface, i) => {
            // Members are drawn beneath the bond that owns them, not in place.
            if (isBondMember(node, iface.id)) return;

            const div = document.createElement('div'); div.className = 'if-row';
            const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = iface.name; nameInp.placeholder = 'eth0';
            nameInp.className = 'if-in if-name';
            nameInp.addEventListener('input', (e) => { node.interfaces[i].name = e.target.value; saveTyping(); renderTyped(); });

            const ipInp = document.createElement('input'); ipInp.type = 'text'; ipInp.value = iface.ip; ipInp.placeholder = 'CIDR';
            ipInp.className = 'if-in if-ip';
            // A full /24 CIDR needs ~146px and the row can spare ~102, so a long
            // address scrolls out of sight — and "192.168.1.70/24" clipped to
            // "192.168.1.7" reads as a different, entirely valid address. Until
            // the row earns more width, the hover says what it really holds.
            ipInp.title = iface.ip || '';
            if (iface.ip.trim() !== '' && !parseValidCIDR(iface.ip)) ipInp.classList.add('bad');
            // The "Zone" checkbox that sat here is the network's now (the
            // Subnets tab): one switch per subnet rather than one per host,
            // and the address field gets its width back.

            // Wirelessness is normally read off the name (wlan0, wlp1s0), but that
            // inference cannot see every case — macOS calls its Wi-Fi NIC en0,
            // which reads as wired — so it has to be overridable. A rarely-used
            // control does not get to cost 25px of the address field, so this is
            // one button cycling inferred -> radio -> wired, rather than a
            // checkbox and a label. Dimmed means inferred; solid means you said so.
            const kindBtn = document.createElement('button');
            kindBtn.className = 'if-ico';
            const explicit = iface.wireless !== undefined;
            kindBtn.textContent = ifaceIsWireless(iface) ? '📡' : '🔌';
            kindBtn.style.opacity = explicit ? '1' : '0.35';
            kindBtn.title = explicit
                ? `Forced ${iface.wireless ? 'wireless' : 'wired'} — click to cycle (inferred / radio / cable)`
                : `Inferred ${ifaceIsWireless(iface) ? 'wireless' : 'wired'} from the name — click to override (macOS names Wi-Fi en0)`;
            kindBtn.onclick = () => {
                iface.wireless = iface.wireless === undefined ? true : (iface.wireless ? false : undefined);
                // Kind decides what may land here, so a flip can invalidate a
                // cable. Re-render the diagnostics rather than let it pass quietly.
                save(); const d = renderCanvasOnly(); renderSidebarData(node); renderNodeDiagnostics(node, drawnDiag(d));
            };

            ipInp.addEventListener('input', (e) => { 
                node.interfaces[i].ip = e.target.value;
                ipInp.title = e.target.value; 
                const parsedData = parseValidCIDR(e.target.value);
                if (e.target.value.trim() !== '' && !parsedData) ipInp.classList.add('bad');
                else ipInp.classList.remove('bad');
                // A new address can mean a new network to inherit from.
                refreshInheritance(node);

                saveTyping();   // one undo step per address, taken when the field is left
                renderTyped();
            });

            const del = document.createElement('button'); del.innerHTML = '✖'; del.className = 'if-del';
            del.title = isBond(iface) ? `Unbond ${iface.name} (members keep their cables)` : `Delete ${iface.name || 'interface'} and any cable in it`;
            del.onclick = () => {
                // Unbonding is not deletion: the members outlive it, so the
                // address has to be handed back rather than dropped.
                if (isBond(iface)) removeBond(node, iface.id);
                else deleteIface(node, iface.id);
                save();
                const d = renderCanvasOnly();
                renderSidebarData(node);
                renderNodeDiagnostics(node, drawnDiag(d));
            };

            // Show what is plugged into this interface, so the ARP-flux warning
            // can be traced back to a specific cable without hunting the canvas.
            const link = linkOnIface(node.id, iface.id);
            const peer = link ? getNode(link.source === node.id ? link.target : link.source) : null;
            const wire = document.createElement('button');
            const radio = ifaceIsWireless(iface);
            wire.className = 'if-ico ' + (peer ? 'linked' : 'free');
            wire.textContent = peer ? (radio ? '📶' : '🔌') : (radio ? '📡' : '○');
            wire.title = peer ? `${radio ? 'Associated' : 'Linked'} to ${peer.name}` : `${radio ? 'Radio' : 'Interface'} not linked`;
            if (link) wire.onclick = () => select(link.id, 'link');

            div.appendChild(nameInp); div.appendChild(ipInp);

            // A bond has no socket and no antenna: neither the cable indicator
            // nor the radio override means anything on it.
            if (isBond(iface)) {
                nameInp.classList.add('bond');
            } else {
                div.appendChild(kindBtn); div.appendChild(wire);
            }
            div.appendChild(del); ifCont.appendChild(div);

            // The MAC line is opened for the whole node from the header button,
            // not per row: every control in that row is already fighting for a
            // 281px sidebar, and the address field is documented above as being
            // 44px short as it is. An interface already holding an address shows
            // it regardless — hiding a value that exists is how a drawing starts
            // lying about itself.
            if (node.macOpen || hasMac(iface)) ifCont.appendChild(renderMacLine(node, iface));

            // What the radio is (iface.radio, js/wifi.js): folded to one line
            // under it, since most of the time the line is all anyone needs.
            if (!isBond(iface) && ifaceIsWireless(iface)) ifCont.appendChild(radioBlock(node, iface));

            if (isBond(iface)) {
                // The mode gets its own line. It will not fit beside the address
                // in a 281px sidebar, and squeezing the CIDR down to "10" to make
                // room is how the interface fields became unreadable last time.
                ifCont.appendChild(renderBondMode(node, iface));
                bondMembers(node, iface).forEach((m) => renderBondMember(node, m, iface, ifCont));
            }
        });
    }
}

// The bond's mode, on its own line beneath it. Active-backup and LACP differ in
// one way that matters on a diagram: whether the members may land on two
// different switches, which is what evaluateBond checks.
// A MAC never fits beside a CIDR in this sidebar, so it gets the line under
// its interface — same shape as the bond mode below.
//
// The read-out is deliberately about what the ADDRESS says, not what the vendor
// table says: the universal/local bit is the one that matters on a network map,
// because a locally-administered address is randomised and any inventory keyed
// on it is fiction. The vendor is a nice-to-have on top of that.
function fmtColonSafe(v) {
    const hex = (window.CarinoOUI ? window.CarinoOUI.normalizeMac(v) : String(v || ''));
    return hex.length === 12 ? hex.match(/.{2}/g).join(':') : String(v || '');
}

function renderMacLine(node, iface) {
    const row = document.createElement('div');
    row.className = 'if-mac';

    const top = document.createElement('div');
    top.className = 'if-row';

    const tick = document.createElement('span');
    tick.className = 'if-tick'; tick.textContent = '↳';

    const label = document.createElement('span');
    label.className = 'if-tick'; label.textContent = 'mac';

    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = iface.mac || '';
    inp.placeholder = 'AA:BB:CC:DD:EE:FF';
    inp.className = 'if-in if-ip';

    const out = document.createElement('div');
    out.className = 'if-mac-out';

    // Pasting is the normal way an address gets here — off a label, a DHCP
    // lease, `ip link`. Normalising on paste means every one of those formats
    // (colons, hyphens, Cisco dotted quads, bare hex) lands the same way.
    function paint() {
        const raw = inp.value.trim();
        inp.classList.remove('bad', 'warn');
        if (!raw) { out.innerHTML = ''; return; }
        const api = window.CarinoOUI;
        if (!api) { out.innerHTML = ''; return; }
        const d = api.decodeMac(raw);
        if (d.error) {
            inp.classList.add('bad');
            out.innerHTML = `<span class="bad">${escapeHtml(d.error)}</span>`;
            return;
        }
        const bits = [];
        if (d.isBroadcast) bits.push('<b class="bad">broadcast</b>');
        else if (d.isMulticast) bits.push('<b class="bad">multicast</b>');
        else bits.push('unicast');

        if (d.isLocal) {
            inp.classList.add('warn');
            bits.push('<b class="warn">locally administered</b>');
        } else {
            bits.push('universal');
        }

        const v = d.vendor;
        const vendor = v.vendor
            ? `<b>${escapeHtml(v.vendor)}</b>`
            : '<span class="muted">OUI not in the built-in table</span>';

        // A duplicate is the reason this field exists at all: the flapping
        // diagnostic could only ever guess at it from IP co-location.
        const dupes = (typeof duplicateMacs === 'function' ? duplicateMacs(state.nodes) : [])
            .find((x) => x.hex === api.normalizeMac(raw));
        // "Is this holder me?" is a question about node AND interface: an
        // interface id is only unique inside its node (every spawned device
        // starts with i1, every AP with w1), so comparing ids alone dropped the
        // most common duplicate of all, two fresh devices given the same MAC.
        const others = dupes ? dupes.holders.filter((h) => !(h.node.id === node.id && h.iface.id === iface.id)) : [];
        if (others.length) inp.classList.add('bad');

        out.innerHTML =
            `<div>${vendor} · ${bits.join(' · ')}</div>` +
            (d.isLocal && !d.isMulticast && !d.isBroadcast
                ? '<div class="warn">Randomised or hand-set — the vendor prefix means nothing here.</div>' : '') +
            (others.length
                // Names come from the document, which may be a stranger's
                // shared link or file: escaped, as every other name in here is.
                ? `<div class="bad">Also on ${others.map((h) => `${escapeHtml(h.node.name)} / ${escapeHtml(h.iface.name)}`).join(', ')} — two interfaces cannot share an address on one L2 domain.</div>`
                : '') +
            `<div class="muted">link-local ${escapeHtml(d.ll)}</div>`;
    }

    inp.addEventListener('input', () => {
        iface.mac = inp.value;
        paint();
        saveTyping();
        renderNodeDiagnostics(node);
    });
    // Leaving the field is when a half-typed address becomes a stored one, so
    // that is where it gets tidied into one canonical form.
    inp.addEventListener('blur', () => {
        const api = window.CarinoOUI;
        if (api && api.normalizeMac(inp.value).length === 12) {
            iface.mac = fmtColonSafe(inp.value);
            inp.value = iface.mac;
            // Still the typing's step: blur runs before the focusout that
            // files it, so the tidied form is what gets filed, as one step.
            saveTyping();
        }
    });

    const clear = document.createElement('button');
    clear.innerHTML = '✖';
    clear.className = 'if-del';
    clear.title = 'Clear this address';
    clear.onclick = () => {
        iface.mac = '';
        save(); renderSidebarData(node); renderNodeDiagnostics(node);
    };

    top.appendChild(tick); top.appendChild(label); top.appendChild(inp); top.appendChild(clear);
    row.appendChild(top); row.appendChild(out);
    paint();
    return row;
}

// Which node's sidebar has the bond's address choice open. Sidebar state, not
// document state: it is never saved, and selecting another device closes it.
let bondChoiceFor = null;

// The NICs about to be bonded carry different addresses, and a bond holds one.
// Clearing the others used to happen silently (a NAS bonded from .10 and .11
// came out as .10, and whatever pointed at .11 broke without a word), so the
// person picks the one to keep, seeing which NIC has each.
function renderBondChoice(node, addresses, container) {
    const box = document.createElement('div');
    box.className = 'rail-note';
    box.id = 'bondChoice';

    const why = document.createElement('div');
    why.textContent = t('These NICs carry {n} different addresses, and a bond holds one. Pick the one it keeps; the others are cleared.', { n: addresses.length });
    box.appendChild(why);

    addresses.forEach((a) => {
        const keep = document.createElement('button');
        keep.className = 'link-btn';
        keep.textContent = t('Bond, keeping {ip}', { ip: a.ip });
        keep.title = t('Now on {names}', { names: a.names.join(', ') });
        keep.onclick = () => {
            if (!createBond(node, { keep: a.ip })) return;
            bondChoiceFor = null;
            save(); const d = renderCanvasOnly(); renderSidebarData(node); renderNodeDiagnostics(node, drawnDiag(d));
        };
        const line = document.createElement('div');
        line.appendChild(keep);
        box.appendChild(line);
    });

    const cancel = document.createElement('button');
    cancel.className = 'link-btn quiet';
    cancel.textContent = t('Cancel');
    cancel.onclick = () => { bondChoiceFor = null; renderSidebarData(node); };
    const last = document.createElement('div');
    last.appendChild(cancel);
    box.appendChild(last);

    container.appendChild(box);
}

function renderBondMode(node, bond) {
    const row = document.createElement('div');
    row.className = 'if-row if-sub';

    const tick = document.createElement('span');
    tick.className = 'if-tick bond'; tick.textContent = '↳';

    const label = document.createElement('span');
    label.className = 'if-tick'; label.textContent = 'mode';

    const mode = document.createElement('select');
    mode.className = 'if-select';
    mode.title = 'Active-Backup survives a switch failure; LACP needs both cables on one switch (or MLAG)';
    Object.entries(BOND_MODES).forEach(([value, text]) => {
        const opt = document.createElement('option'); opt.value = value; opt.textContent = text;
        if (bond.bond.mode === value) opt.selected = true;
        mode.appendChild(opt);
    });
    mode.onchange = (e) => {
        bond.bond.mode = e.target.value;
        save(); renderNodeDiagnostics(node, drawnDiag(renderCanvasOnly()));
    };

    row.appendChild(tick); row.appendChild(label); row.appendChild(mode);
    return row;
}

// One member of a bond. It gets no IP field on purpose: the address lives on
// the bond, and offering a box here would invite the exact misconfiguration
// evaluateBond exists to catch.
function renderBondMember(node, member, bond, container) {
    const row = document.createElement('div');
    row.className = 'if-row if-sub';

    const tick = document.createElement('span');
    tick.className = 'if-tick bond'; tick.textContent = '↳';

    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.value = member.name; nameInp.placeholder = 'eno1';
    nameInp.className = 'if-in if-name';
    nameInp.addEventListener('input', (e) => {
        const real = node.interfaces.find((x) => x.id === member.id);
        if (real) real.name = e.target.value;
        saveTyping(); renderTyped();
    });

    const note = document.createElement('span');
    note.className = 'if-note';
    note.textContent = `member of ${bond.name}`;

    const link = linkOnIface(node.id, member.id);
    const peer = link ? getNode(link.source === node.id ? link.target : link.source) : null;
    const wire = document.createElement('button');
    wire.className = 'if-ico ' + (peer ? 'linked' : 'free');
    wire.textContent = peer ? '🔌' : '○';
    wire.title = peer ? `Linked to ${peer.name}` : 'Not linked';
    if (link) wire.onclick = () => select(link.id, 'link');

    const pull = document.createElement('button');
    pull.innerHTML = '✖'; pull.className = 'if-del';
    pull.title = `Remove ${member.name} from ${bond.name}`;
    pull.onclick = () => {
        const remaining = (bond.bond.members || []).filter((id) => id !== member.id);
        if (remaining.length) {
            bond.bond.members = remaining;
        } else {
            // Last one out. Dissolve before unlisting, so removeBond still has a
            // member to hand the address to — unlist first and it goes in the bin.
            removeBond(node, bond.id);
        }
        save(); const d = renderCanvasOnly(); renderSidebarData(node); renderNodeDiagnostics(node, drawnDiag(d));
    };

    row.appendChild(tick); row.appendChild(nameInp); row.appendChild(note);
    row.appendChild(wire); row.appendChild(pull);
    container.appendChild(row);
}

// Interface picker for a selected link: one row per end, chips for each
// interface. Occupied chips are marked but still selectable — conflicts are
// reported, not blocked, so you can draw a network to document that it is wrong.
function renderLinkPorts(link) {
    const panel = document.getElementById('linkPortProps');
    const body = document.getElementById('linkPortBody');
    const src = getNode(link.source), tgt = getNode(link.target);
    if (!src || !tgt) { panel.classList.add('hidden'); return; }

    body.innerHTML = '';
    [[src, tgt], [tgt, src]].forEach(([node, other]) => {
        const key = ifaceKeyFor(link, node.id);
        const row = document.createElement('div');

        const head = document.createElement('div');
        head.className = 'port-end-head';
        head.innerHTML = `<span class="port-end-name">${escapeHtml(node.name)}</span>`;

        const addBtn = document.createElement('button');
        addBtn.className = 'link-btn';
        addBtn.textContent = hasPortGrid(node) ? '+ Port' : '+ NIC';
        addBtn.onclick = () => {
            link[key] = createIfaceFor(node, { grow: true, user: true }).id;
            save(); renderCanvasOnly(); renderLinkPorts(link);
        };
        head.appendChild(addBtn);
        row.appendChild(head);

        const chips = document.createElement('div');
        chips.className = 'chip-row';

        const interfaces = getInterfaces(node);
        if (!interfaces.length) {
            chips.innerHTML = '<span class="rail-none">No interfaces — add one.</span>';
        }

        interfaces.forEach((iface) => {
            const selected = link[key] === iface.id;
            const takenBy = linksAtNode(node.id).find((l) => l.id !== link.id && ifaceIdOn(l, node.id) === iface.id && isExclusiveLink(l));
            const chip = document.createElement('button');
            chip.className = 'port-chip' + (selected ? ' picked' : takenBy ? ' taken' : '');
            chip.textContent = iface.name || iface.id;
            // A faceplate port's label is what the person at the rack is
            // looking for ("Reception 2"), so it is on the chip itself; its
            // VLAN is in the tooltip.
            const attr = hasPortGrid(node) ? portAttrOf(node, iface.id) : { label: '', vlan: null };
            if (attr.label) {
                const sub = document.createElement('small');
                sub.className = 'port-chip-sub';
                sub.textContent = attr.label;
                chip.appendChild(sub);
            }
            const facts = [attr.label, attr.vlan !== null ? `VLAN ${attr.vlan}` : ''].filter(Boolean).join(' · ');

            if (takenBy) {
                const neighbour = getNode(takenBy.source === node.id ? takenBy.target : takenBy.source);
                chip.title = [facts, neighbour ? t('In use by {name}', { name: neighbour.name || neighbour.id }) : t('In use by another cable')].filter(Boolean).join('\n');
            } else if (iface.ip || facts) {
                chip.title = [iface.ip, facts].filter(Boolean).join('\n');
            }

            chip.onclick = () => {
                // Picking an implicit faceplate port keeps it implicit until it
                // needs a name or IP, so the URL hash stays small.
                link[key] = iface.id;
                save(); renderCanvasOnly(); renderLinkPorts(link);
            };
            chips.appendChild(chip);
        });

        // A cable past an explicit faceplate (port overflow, see js/model.js)
        // is on a port getInterfaces() does not list. Show it, picked and
        // marked like the faceplate's own overflow chip, so the panel does not
        // claim this end of the cable is plugged in nowhere.
        const current = link[key];
        if (hasPortGrid(node) && /^p\d+$/.test(current || '') && !interfaces.some((i) => i.id === current)) {
            const chip = document.createElement('button');
            chip.className = 'port-chip picked over';
            chip.textContent = ifaceLabel(node, current);
            chip.title = t('Past the {total}-port faceplate', { total: portCountOf(node) });
            chips.appendChild(chip);
        }

        row.appendChild(chips);
        body.appendChild(row);
    });

    panel.classList.remove('hidden');
}

function clearPropertyInputs() {
    document.getElementById('propName').value = '';
    document.getElementById('propGw').value = '';
    document.getElementById('propDns').value = '';
    document.getElementById('propOs').value = '';
    document.getElementById('propPorts').value = '';
    document.getElementById('propNotes').value = '';
    renderAssetFields(null);   // js/assets.js
    renderCableFields(null);
    document.getElementById('ifaceListContainer').innerHTML = '';
    document.getElementById('jumpGwBtn').classList.add('hidden');
    refreshNetcfgLink(null);
    renderSiteRef(null);
    renderNodeDiagnostics(null);
}

// ---- Inter-site links ----
// A picker rather than a text field, because it is the only control that can
// capture the binder id AND the name together and guarantee the id came from a
// real card. A typed name would produce name-only references by construction —
// the degraded case — and could never be opened.
const SITE_REF_UNRESOLVED = '__unresolved__';

function renderSiteRef(node) {
    const block = document.getElementById('siteRefBlock');
    const sel = document.getElementById('propSiteRef');
    const hint = document.getElementById('siteRefHint');
    const open = document.getElementById('openSiteRefBtn');
    if (!node || node.type !== 'cloud') { block.classList.add('hidden'); return; }
    block.classList.remove('hidden');

    const ref = node.siteRef || null;
    const entry = ref && ref.id ? libraryEntry(ref.id) : null;
    sel.innerHTML = '';
    // The sentinel is load-bearing, not cosmetic: a <select> whose value is not
    // among its options silently resets to index 0. Without it, clicking a
    // cloud on a link someone sent you and then touching any other field would
    // destroy the reference the sender wrote.
    if (ref && !entry) sel.appendChild(new Option(ref.name || '(unnamed site)', SITE_REF_UNRESOLVED));
    sel.appendChild(new Option('— not a site —', ''));
    libraryNetworks()   // a saved template is not a site
        .filter((e) => e.id !== state.libraryId)   // a site cannot stand for itself
        .forEach((e) => sel.appendChild(new Option(e.name, e.id)));
    sel.value = entry ? entry.id : (ref ? SITE_REF_UNRESOLVED : '');

    hint.classList.toggle('hidden', !(ref && !entry));
    if (ref && !entry) hint.textContent = 'Not in this browser — import the binder that holds it to link them.';
    open.classList.toggle('hidden', !entry);
    if (entry) {
        open.textContent = `↗ Open ${entry.name}`;
        open.className = 'rail-btn go';
        open.onclick = () => openFromLibrary(entry.id);
    }

    sel.onchange = () => {
        const v = sel.value;
        if (v === SITE_REF_UNRESOLVED) return;            // already the current value
        if (!v) delete node.siteRef;
        else {
            const picked = libraryEntry(v);
            if (!picked) return;
            node.siteRef = { id: picked.id, name: picked.name };
            // Only rename a cloud still carrying its spawn default: a cloud
            // someone deliberately called "ISP" must not be renamed out from
            // under them because they also said which site it reaches. The
            // default is derived from paletteDefs the same way spawnNode()
            // builds it, so renaming the palette entry cannot quietly turn this
            // into a check against a string nothing produces any more.
            const def = paletteDefs.find((pd) => pd.type === node.type);
            const base = def ? def.name : 'Node';
            if (node.name === `New ${base}` || node.name === t(base)) node.name = picked.name; // Advanced / reduced spawn names
        }
        save(); renderCanvasOnly(); renderSiteRef(node);
        document.getElementById('propName').value = node.name;
    };
}

// ---- Netplan hand-off (docs/netplan-bridge-design.md) ----
// "Open in Netplan ↗" is offered on the host types: the devices that run a
// general-purpose OS whose network config is a file someone writes. It used to
// be a stored per-node checkbox (netcfg) on every type, with an advisory on
// the firmware ones; a setting that only ever revealed a link was one more
// field to carry, so the link is now just there where it makes sense. Old
// documents that carry `netcfg: true` still open; the key is no longer kept
// (NODE_FIELDS, js/model.js).
const NETPLAN_HOST_TYPES = ['pc', 'server', 'vm', 'container'];

// The link is a plain <a href> pre-encoded ahead of the click — encoding is
// async (CompressionStream), and a popup opened after an await would be eaten
// by the blocker. Refreshed on select and on any sidebar edit; the sequence
// counter drops stale encodings that resolve out of order.
let _netcfgSeq = 0;
function refreshNetcfgLink(node) {
    const a = document.getElementById('openNetcfgBtn');
    _netcfgSeq++;
    if (!node || !NETPLAN_HOST_TYPES.includes(node.type)) { a.classList.add('hidden'); a.removeAttribute('href'); return; }
    const intent = bridgeIntent(node);
    // A node whose ports are all implicit faceplate slots or bonded members
    // projects to nothing — landing the user on an empty generator would only
    // confuse. Keep the link away until a real interface exists.
    if (!intent.ifaces.length) { a.classList.add('hidden'); a.removeAttribute('href'); return; }
    a.classList.remove('hidden');
    a.removeAttribute('href'); // a tap during the re-encode must do nothing, not open the OLD node's config
    const seq = _netcfgSeq;
    encodeShareFragment(JSON.stringify(intent)).then((frag) => {
        if (seq !== _netcfgSeq) return; // superseded by a newer refresh
        a.href = `https://netplan.carino.systems/#${frag}`;
    }).catch(() => { a.classList.add('hidden'); }); // never leave a stale href behind a failed encode
}

// Keep the pre-encoded link fresh while the user edits the selected node.
// Two event kinds cover every sidebar edit: text edits arrive as 'input';
// structural edits (add/delete interface, wired/wireless kind toggle, bonding)
// are button clicks that fire no input event — the pane-level bubble listener
// runs after the button's own handler has mutated the node, so the re-encode
// always sees fresh state.
function _netcfgSidebarChanged() {
    if (state.selectedType !== 'node' || !state.selectedId) return;
    const node = getNode(state.selectedId);
    if (node) refreshNetcfgLink(node);
}
const _propsPane = document.getElementById('propertiesPane');
_propsPane.addEventListener('input', _netcfgSidebarChanged);
_propsPane.addEventListener('click', (e) => {
    // Not on the link itself: yanking its href mid-dispatch would cancel the
    // very navigation the user just asked for.
    if (e.target.closest && e.target.closest('#openNetcfgBtn')) return;
    _netcfgSidebarChanged();
});

// The gateway and DNS hints, and the line under them naming the network a
// blank field inherits from (a button: it opens that network in the Subnets
// tab). Called on select and whenever an address of the device changes.
function refreshInheritance(node) {
    if (!node) return;
    const hints = fieldHints(node);
    document.getElementById('propGw').placeholder = hints.gw;
    document.getElementById('propDns').placeholder = hints.dns;
    document.getElementById('propGw').title = hints.gwFrom;
    document.getElementById('propDns').title = hints.dnsFrom;
    const note = document.getElementById('inheritNote');
    if (!note) return;
    const nets = [];
    getValidIps(node).forEach((p) => { const net = networkOfIp(p.ip); if (net && !nets.includes(net)) nets.push(net); });
    note.classList.toggle('hidden', !nets.length);
    note.innerHTML = nets.length ? `${escapeHtml(t('Blank fields use the network\'s:'))} ${nets.map((net) =>
        `<button type="button" class="link-btn" data-net="${escapeHtml(net.id)}">${escapeHtml(networkLabel(net))}</button>`).join(' ')}` : '';
    note.querySelectorAll('[data-net]').forEach((b) => { b.onclick = () => openNetworkInTab(b.dataset.net); });
}

// Centre the canvas on a device, or on the middle of a cable, and select it:
// what a click on a finding in the Findings tab does, and the gateway jump.
// target: { type: 'node' | 'link', id }.
function focusOnMap(target) {
    if (!target) return false;
    // A device folded into a collapsed group is pointed at by the group's
    // node (mapPointOf, js/groupmap.js), which shows it holds the selection.
    let at = null;
    if (target.type === 'node') at = mapPointOf(getNode(target.id));
    else if (target.type === 'link') {
        const link = getLink(target.id);
        const a = link && mapPointOf(getNode(link.source)), b = link && mapPointOf(getNode(link.target));
        if (a && b) at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    if (!at) return false;
    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    state.camera.x = (rect.width / 2) - at.x * state.camera.zoom; state.camera.y = (rect.height / 2) - at.y * state.camera.zoom;
    applyCamera(); select(target.id, target.type);
    return true;
}

// ---- The selection set (plan 3.1) ----
// select() above is "this one thing"; these work on the set in
// state.selection (js/state.js). Whatever the set holds, renderSelection()
// draws the rail for it: nothing, the one thing's editor, or — for several —
// their counts, Delete, and a way to narrow a mixed set to one kind; a set of
// devices alone, or of cables alone, also gets the bulk panel (js/bulk.js).
function renderSelection() {
    const one = soleSelected(state.selection);
    if (state.selection.size <= 1) { select(one ? one.id : null, one ? one.type : null); return; }
    state.linkSourceId = null;
    clearPropertyInputs();
    document.getElementById('propertiesPane').classList.add('hidden');
    document.getElementById('noSelectionPane').classList.add('hidden');
    const pane = document.getElementById('multiSelectionPane');
    pane.classList.remove('hidden');
    const nodes = selectedOf('node').length, links = selectedOf('link').length;
    const row = (label, n) => `<div class="sel-count"><dt>${escapeHtml(t(label))}</dt><dd class="mono">${n}</dd></div>`;
    document.getElementById('selCounts').innerHTML = (nodes ? row('Devices', nodes) : '') + (links ? row('Cables', links) : '');
    // Mixed: what applies to a device does not apply to a cable, so a set of
    // both offers only Delete and the way to make it one kind.
    document.getElementById('selOnlyRow').classList.toggle('hidden', !(nodes && links));
    // Devices only or cables only, in the full editor: change all of them at once (js/bulk.js).
    if (typeof renderBulkPanel === 'function') renderBulkPanel();
    refreshSelectedNodeDiagnostics();   // which says to select one device
    renderCanvasOnly();
}

function selectEntries(entries) { setSelectionEntries(entries); renderSelection(); }

// Shift/Ctrl/Cmd-click: in or out of the set. A note or a leader cannot share
// a set, so one selected before is let go (setSelectionEntries).
function toggleSelected(type, id) {
    const entries = [...state.selection];
    const at = entries.findIndex((e) => e.type === type && e.id === id);
    if (at >= 0) entries.splice(at, 1); else entries.push({ type, id });
    selectEntries(entries);
}

// Ctrl+A: every device and every cable.
function selectAll() {
    selectEntries([...state.nodes.map((n) => ({ type: 'node', id: n.id })), ...state.links.map((l) => ({ type: 'link', id: l.id }))]);
}

// Narrow a mixed set to one kind.
function selectOnly(type) { selectEntries(selectedOf(type).map((id) => ({ type, id }))); }

// Undo, redo and a reverted read-only edit rebuild the model from a snapshot:
// what was selected and is still there stays selected (as the new objects),
// what is gone is dropped. Nothing else is kept from before.
function pruneSelection() {
    const alive = (e) => {
        if (e.type === 'node') return !!getNode(e.id);
        if (e.type === 'link') return !!getLink(e.id);
        if (e.type === 'annotation') return !!getAnnotation(e.id);
        if (e.type === 'notelink') {
            const [, aid, tid] = String(e.id).split(':');
            const a = getAnnotation(aid);
            return !!(a && (a.targets || []).includes(tid) && noteLinkTarget(tid));
        }
        return false;
    };
    const kept = [...state.selection].filter(alive);
    if (kept.length !== state.selection.size) state.selection = new Set(kept);
}

// Centre the map on a group of devices, zooming out only as far as it takes
// to show them all (never in: the visitor chose this zoom). A network's
// "Select members" lands here.
function centreOnNodes(nodes) {
    if (!nodes.length) return;
    nodes = mapPointsOf(nodes);   // folded ones: their collapsed group's node (js/groupmap.js)
    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); });
    const PAD = 120;
    if (rect.width && rect.height) {
        const fit = Math.min((rect.width - PAD) / ((maxX - minX) || 1), (rect.height - PAD) / ((maxY - minY) || 1));
        state.camera.zoom = Math.max(0.2, Math.min(state.camera.zoom, fit));
    }
    state.camera.x = rect.width / 2 - ((minX + maxX) / 2) * state.camera.zoom;
    state.camera.y = rect.height / 2 - ((minY + maxY) / 2) * state.camera.zoom;
    applyCamera();
}

function select(id, type) {
    setSelectionEntries(id ? [{ type, id }] : []); state.linkSourceId = null;
    // The set has ended: what was typed into the bulk panel for it goes too.
    if (typeof resetBulkDraft === 'function') resetBulkDraft();
    document.getElementById('multiSelectionPane').classList.add('hidden');
    const pPane = document.getElementById('propertiesPane'), nPane = document.getElementById('noSelectionPane');
    const netProps = document.getElementById('nodeNetworkProps'), generalProps = document.getElementById('nodeGeneralProps'), linkProps = document.getElementById('linkProps');
    const nameInput = document.getElementById('propName'), jumpGwBtn = document.getElementById('jumpGwBtn');

    if (!id) { clearPropertyInputs(); pPane.classList.add('hidden'); nPane.classList.remove('hidden'); renderCanvasOnly(); return; }
    nPane.classList.add('hidden'); pPane.classList.remove('hidden');
    // A device's tag and QR, or a cable's label (js/assets.js); a note has none.
    document.getElementById('printLabelBtn').classList.toggle('hidden', type !== 'node' && type !== 'link');
    if (type !== 'link') { renderCableFields(null); renderLinkWifi(null); }

    if (type === 'node') {
        const node = getNode(id); if (!node) return;
        nameInput.value = node.name || ''; nameInput.disabled = false; generalProps.classList.remove('hidden'); linkProps.classList.add('hidden');
        if (document.getElementById('linkMediumProps')) document.getElementById('linkMediumProps').classList.add('hidden');
        document.getElementById('linkPortProps').classList.add('hidden');
        document.getElementById('propOs').value = node.os || ''; document.getElementById('propPorts').value = node.ports || '';
        document.getElementById('propNotes').value = node.notes || '';
        renderAssetFields(node);   // serial, asset tag, location, status (js/assets.js)
        // Hints, not values: what a type default would have written is shown
        // greyed out and stays out of the document (fieldHints in js/app.js).
        // The gateway and DNS fields hold this device's own values, which
        // override its network's (R7); left blank, the hint shows what it
        // inherits and from which network.
        refreshInheritance(node);
        document.getElementById('propOs').placeholder = fieldHints(node).os;

        netProps.classList.remove('hidden');
        document.getElementById('propGw').value = node.gw || ''; document.getElementById('propDns').value = node.dns || '';
        // NAT toggle — only meaningful on routing devices
        const natRow = document.getElementById('natRow'), propNat = document.getElementById('propNat');
        if (isRoutingDevice(node.type)) {
            natRow.classList.remove('hidden');
            propNat.checked = !!node.nat;
            propNat.onchange = (e) => { node.nat = e.target.checked; save(); renderNodeDiagnostics(node, drawnDiag(renderCanvasOnly())); };
        } else { natRow.classList.add('hidden'); }
        refreshNetcfgLink(node); // "Open in Netplan ↗", host types only
        renderSiteRef(node);
        if (effectiveGw(node)) {
            jumpGwBtn.classList.remove('hidden');
            jumpGwBtn.onclick = () => {
                const gwIpStr = effectiveGw(node), targetNode = state.nodes.find((n) => getValidIps(n).some((ipData) => ipData.ip.toString() === gwIpStr));
                if (targetNode) {
                    focusOnMap({ type: 'node', id: targetNode.id });
                } else { showToast(`Gateway node (${gwIpStr}) not found in the topology.`); }
            };
        } else { jumpGwBtn.classList.add('hidden'); }
        renderSidebarData(node);
    } else if (type === 'notelink') {
        nameInput.value = t('Note link'); nameInput.disabled = true;
        netProps.classList.add('hidden'); generalProps.classList.add('hidden'); linkProps.classList.add('hidden');
        if (document.getElementById('linkMediumProps')) document.getElementById('linkMediumProps').classList.add('hidden');
        document.getElementById('linkPortProps').classList.add('hidden');
        jumpGwBtn.classList.add('hidden');
    } else if (type === 'annotation') {
        nameInput.value = t('Text note'); nameInput.disabled = true;
        netProps.classList.add('hidden'); generalProps.classList.add('hidden'); linkProps.classList.add('hidden');
        if (document.getElementById('linkMediumProps')) document.getElementById('linkMediumProps').classList.add('hidden');
        document.getElementById('linkPortProps').classList.add('hidden');
        jumpGwBtn.classList.add('hidden');
    } else if (type === 'link') {
        const link = getLink(id); if (!link) return;
        const a = getNode(link.source), b = getNode(link.target);
        nameInput.value = `${a?.name || link.source} ↔ ${b?.name || link.target}`; nameInput.disabled = true;
        netProps.classList.add('hidden'); generalProps.classList.add('hidden');

        if (link.attachment !== undefined && link.attachment !== null) {
            linkProps.classList.remove('hidden');
            document.getElementById('propAttachment').value = link.attachment;
            document.getElementById('propAttachment').onchange = (e) => { link.attachment = e.target.value; save(); renderCanvasOnly(); };
        } else { linkProps.classList.add('hidden'); }

        renderLinkPorts(link);
        // A cable's facts (label, length, colour, via: js/assets.js), or, on a
        // wireless link, its SSID, band and signal instead (js/wifi.js). A VPN
        // link has neither. Nor a label to print: there is no cable to stick
        // one on.
        const linkFacts = () => {
            renderCableFields(link);
            renderLinkWifi(link);
            const m = effectiveMedium(link);
            document.getElementById('printLabelBtn').classList.toggle('hidden', m === 'wireless' || m === 'vpn');
        };
        linkFacts();

        const linkMediumProps = document.getElementById('linkMediumProps');
        linkMediumProps.classList.remove('hidden');
        // As drawn: a link onto a radio is wireless though it never said so.
        document.getElementById('propMedium').value = effectiveMedium(link);
        document.getElementById('propMedium').onchange = (e) => { link.medium = e.target.value; save(); renderCanvasOnly(); renderLinkPorts(link); linkFacts(); };
    }
    // The device's diagnosis after the drawing, from the drawing's own.
    const drawn = renderCanvasOnly();
    if (type === 'node') refreshSelectedNodeDiagnostics(drawnDiag(drawn));
}

// ---- A length and its unit (CABLE_UNITS, js/model.js) ----
// The pick of the unit in front of a length field, wrapped with the field
// so the two read as one (.unit-field, css/app.css). The units are written
// as the file writes them ("m", "ft") in every language. -> the select.
function makeUnitPick(unit) {
    const sel = document.createElement('select');
    sel.className = 'unit-pick';
    sel.setAttribute('aria-label', t('Unit'));
    sel.title = t('Unit');
    CABLE_UNITS.forEach((u) => { const o = document.createElement('option'); o.value = u; o.textContent = u; sel.appendChild(o); });
    sel.value = CABLE_UNITS.includes(unit) ? unit : CABLE_UNIT_DEFAULT;
    return sel;
}
// Puts `input` in a .unit-field with a unit pick in front of it. -> the select.
function wrapUnitField(input, unit, extraClass) {
    const box = document.createElement('div');
    box.className = 'unit-field' + (extraClass ? ' ' + extraClass : '');
    const sel = makeUnitPick(unit);
    input.parentNode.insertBefore(box, input);
    box.appendChild(sel);
    box.appendChild(input);
    return sel;
}
// Keeps only what a length can be while it is typed (cableLengthTyped),
// the caret where it was.
function filterLengthInput(input) {
    const kept = cableLengthTyped(input.value);
    if (kept === input.value) return kept;
    const at = Math.max(0, (input.selectionStart || 0) - (input.value.length - kept.length));
    input.value = kept;
    try { input.setSelectionRange(at, at); } catch (e) { /* not a text field */ }
    return kept;
}
