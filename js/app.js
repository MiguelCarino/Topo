// Wiring: node creation, persistence, shortcuts, event handlers, boot.
// Load order: state -> model -> data -> diagnostics -> ui -> app

// Create a node. opts.at = {x,y} drop point; opts.connectTo = node id to
// link to (and inherit its subnet for auto-IP).
function spawnNode(type, opts = {}) {
    const defs = initialDataDefaults[type] || { os: '', ports: '', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.50/24'}] };
    const palette = paletteDefs.find((p) => p.type === type);
    const connectTo = opts.connectTo ? getNode(opts.connectTo) : null;
    let x, y;
    if (opts.at) {
        x = opts.at.x; y = opts.at.y;
    } else if (connectTo) {
        const degree = state.links.filter(l => l.source === connectTo.id || l.target === connectTo.id).length;
        x = connectTo.x + ((degree % 2 === 0 ? -1 : 1) * (70 + Math.floor(degree / 2) * 80));
        y = connectTo.y + 130;
    } else {
        const rect = document.getElementById('networkCanvas').getBoundingClientRect();
        x = (rect.width / 2 - state.camera.x) / state.camera.zoom + (state.nodes.length % 6) * 20;
        y = (rect.height / 2 - state.camera.y) / state.camera.zoom + (state.nodes.length % 6) * 20;
    }
    x = Math.round(x / GRID_SNAP) * GRID_SNAP;
    y = Math.round(y / GRID_SNAP) * GRID_SNAP;

    const node = { id: nextId('n'), type, name: `New ${palette?.name || 'Node'}`, x, y, gw: defs.gw || '', dns: defs.dns || '', os: defs.os || '', ports: defs.ports || '', notes: '', nat: !!defs.nat, interfaces: cloneData(defs.interfaces) };

    // Spawned onto an AP by radio: the seed data's eth0 is the wrong hardware,
    // so rename before it inherits an address.
    if (connectTo && node.interfaces.length && apMediumGuess(connectTo, node) === 'wireless'
        && !node.interfaces.some(ifaceIsWireless) && WIRED_DEFAULT_RE.test(node.interfaces[0].name || '')) {
        node.interfaces[0].name = 'wlan0';
    }

    // Subnet-aware auto-IP: when connecting into an existing subnet, hand the
    // new node the next free host address + that subnet's gateway.
    if (connectTo && node.interfaces.length) {
        const ctx = subnetContext(connectTo);
        if (ctx) {
            const free = nextFreeHost(ctx.networkStr, ctx.prefix);
            if (free) { node.interfaces[0].ip = free; if (ctx.gatewayIp) node.gw = ctx.gatewayIp; }
        }
    }

    state.nodes.push(node);
    if (connectTo && connectTo.id !== node.id) {
        const isVirtual = isVirtualType(connectTo.type) || isVirtualType(type);
        state.links.push(bindLink({ id: nextId('l'), source: connectTo.id, target: node.id, attachment: isVirtual ? 'bridged' : null }));
    }
    select(node.id, 'node'); save();
    renderCanvasOnly();
    renderNodeDiagnostics(node);
}

// ---- Subnet / auto-IP helpers (IPv4) ----
function ipToNum(ip) { const o = ip.split('.').map(Number); return (((o[0] << 24) >>> 0) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0; }
function numToIp(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }

function subnetContext(node) {
    const own = getValidIps(node).filter(i => i.kind === 'ipv4');
    if (own.length) return { networkStr: own[0].networkStr, prefix: own[0].prefix, gatewayIp: gatewayForSubnet(own[0].networkStr) };
    // dumb device (switch/ap): borrow a subnet from an IP-bearing neighbor
    const neighborIds = state.links.filter(l => l.source === node.id || l.target === node.id).map(l => l.source === node.id ? l.target : l.source);
    for (const nid of neighborIds) {
        const nb = getNode(nid); if (!nb) continue;
        const ips = getValidIps(nb).filter(i => i.kind === 'ipv4');
        if (ips.length) return { networkStr: ips[0].networkStr, prefix: ips[0].prefix, gatewayIp: gatewayForSubnet(ips[0].networkStr) };
    }
    return null;
}

function gatewayForSubnet(networkStr) {
    for (const n of state.nodes) {
        const ips = getValidIps(n).filter(i => i.kind === 'ipv4' && i.networkStr === networkStr);
        if (ips.length && isRoutingDevice(n.type)) return ips[0].ip.toString();
    }
    for (const n of state.nodes) {
        const ips = getValidIps(n).filter(i => i.kind === 'ipv4' && i.networkStr === networkStr);
        if (ips.length && n.gw) return n.gw;
    }
    const [base] = networkStr.split('/');
    return numToIp(ipToNum(base) + 1);
}

function nextFreeHost(networkStr, prefix) {
    if (!networkStr || prefix >= 31) return null;
    const [base] = networkStr.split('/');
    const netNum = ipToNum(base);
    const broadcast = netNum + 2 ** (32 - prefix) - 1;
    const used = new Set();
    state.nodes.forEach(n => getValidIps(n).forEach(i => { if (i.kind === 'ipv4') used.add(ipToNum(i.ip.toString())); }));
    for (let h = netNum + 1; h < broadcast; h++) if (!used.has(h)) return `${numToIp(h)}/${prefix}`;
    return null;
}

// ---- Auto-layout: tiered top-down tree (barycenter-ordered), toggleable ----
let _tidyBackup = null;
function setTidyLabel() { const b = document.getElementById('tidyBtn'); if (b) b.innerHTML = _tidyBackup ? '↺ Untidy' : '⤢ Tidy'; }
function invalidateTidy() { if (_tidyBackup) { _tidyBackup = null; setTidyLabel(); } }
function tidyLayout() {
    if (!state.nodes.length) return;
    // Second press → restore the layout captured before the last Tidy.
    if (_tidyBackup) {
        const byId = {}; state.nodes.forEach(n => byId[n.id] = n);
        _tidyBackup.forEach(p => { if (byId[p.id]) { byId[p.id].x = p.x; byId[p.id].y = p.y; } });
        _tidyBackup = null; setTidyLabel();
        save(); renderCanvasOnly(); fitToView();
        return;
    }
    _tidyBackup = state.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })); // snapshot for undo
    setTidyLabel();
    const adj = {}; state.nodes.forEach(n => adj[n.id] = []);
    state.links.forEach(l => { if (adj[l.source] && adj[l.target]) { adj[l.source].push(l.target); adj[l.target].push(l.source); } });
    const roots = state.nodes.filter(n => n.type === 'cloud').map(n => n.id);
    if (!roots.length) { const r = state.nodes.find(n => isRoutingDevice(n.type)); roots.push((r || state.nodes[0]).id); }
    const depth = {}, q = [...roots]; roots.forEach(id => depth[id] = 0);
    while (q.length) { const cur = q.shift(); adj[cur].forEach(nb => { if (depth[nb] === undefined) { depth[nb] = depth[cur] + 1; q.push(nb); } }); }
    let maxD = Math.max(0, ...Object.values(depth));
    state.nodes.forEach(n => { if (depth[n.id] === undefined) depth[n.id] = ++maxD; }); // disconnected → own rows
    const tiers = {}; state.nodes.forEach(n => (tiers[depth[n.id]] ||= []).push(n));
    const COLW = 150, ROWH = 130, startX = 140, startY = 120;
    Object.keys(tiers).map(Number).sort((a, b) => a - b).forEach(d => {
        const row = tiers[d];
        if (d > 0) row.sort((a, b) => barycenter(a, adj, depth) - barycenter(b, adj, depth));
        row.forEach((n, i) => { n.x = Math.round((startX + i * COLW) / GRID_SNAP) * GRID_SNAP; n.y = Math.round((startY + d * ROWH) / GRID_SNAP) * GRID_SNAP; });
    });
    save(); renderCanvasOnly(); fitToView();
}
function barycenter(node, adj, depth) {
    const parents = adj[node.id].filter(id => depth[id] === depth[node.id] - 1).map(id => getNode(id)).filter(p => p && Number.isFinite(p.x));
    return parents.length ? parents.reduce((a, p) => a + p.x, 0) / parents.length : 0;
}

function stampSnippet(key) {
    const snip = SNIPPETS[key]; if (!snip) return;
    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    const cx = (rect.width / 2 - state.camera.x) / state.camera.zoom;
    const cy = (rect.height / 2 - state.camera.y) / state.camera.zoom;
    // nextId, not Date.now(): two blocks stamped in the same millisecond would
    // otherwise be handed identical node ids and merge into each other.
    const idMap = {}; const newIds = [];
    snip.nodes.forEach((n) => {
        const nid = nextId('s'); idMap[n.tid] = nid; newIds.push(nid);
        state.nodes.push(normalizeLoadedNode({ ...cloneData(n), id: nid,
            x: Math.round((cx + n.dx) / GRID_SNAP) * GRID_SNAP, y: Math.round((cy + n.dy) / GRID_SNAP) * GRID_SNAP }));
    });
    // Push every link before binding: naming a stamped AP client's radio depends
    // on seeing its link, which does not exist until the whole block is in.
    // s/t are template-local node ids; si/ti pin a link to a specific interface
    // (needed when a block means to show a *wrong* binding, which auto-bind
    // would otherwise quietly correct).
    snip.links.forEach((l) => state.links.push({ id: nextId('sl'), source: idMap[l.s], target: idMap[l.t], attachment: l.attachment || null, medium: l.medium, sourceIface: l.si || null, targetIface: l.ti || null }));
    autoBindLinks();
    save(); invalidateTidy(); renderCanvasOnly();
}

// ---- User-saved templates (localStorage) ----
// UI preferences live in localStorage, not the URL hash — a shared diagram should
// not carry the sharer's panel state. traceMode is deliberately not persisted:
// reopening into an active trace with nothing selected is confusing.
const SETTINGS_KEY = 'nettopo_settings';

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
        state.settings.alertsHidden = !!saved.alertsHidden;
        if (['nodes', 'templates', 'blocks'].includes(saved.libraryTab)) state.settings.libraryTab = saved.libraryTab;
    } catch (e) { /* first run or blocked storage */ }
}

function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ alertsHidden: !!state.settings.alertsHidden, libraryTab: state.settings.libraryTab })); } catch (e) { /* private mode */ }
}

const USER_TPL_KEY = 'nettopo_user_templates';
function loadUserTemplates() { try { return JSON.parse(localStorage.getItem(USER_TPL_KEY) || '{}'); } catch (e) { return {}; } }
// The one guarded write for saved templates. Safari private browsing throws on
// setItem (as does a full quota); returning a boolean lets callers report the
// failure instead of dying on an uncaught exception mid-alert.
function persistUserTemplates(tpls) {
    try { localStorage.setItem(USER_TPL_KEY, JSON.stringify(tpls)); return true; }
    catch (e) { return false; }
}
// What "save as template" actually stores. Split out from saveUserTemplate so it
// can be tested without a prompt() in the way — the round trip is the part that
// can lose your network, not the naming. It is the same serializer save() uses,
// so the two cannot drift: templateSnapshot once carried a shorter allowlist of
// its own and quietly dropped three things — portCount (a 24-port switch came
// back with 8, and auto-bind re-grew it to fit whatever cables landed),
// sourceIface/targetIface (every cable re-guessed into a different socket, the
// thing shipped templates set explicitly to avoid), and nat — which did not
// merely reset but inverted, since normalizeLoadedNode reapplies the type
// default when nat is undefined. Now there is one list, in serializeDoc().
function templateSnapshot() { return serializeDoc(); }

function saveUserTemplate() {
    if (!state.nodes.length) { alert('Nothing to save — add some nodes first.'); return; }
    const name = prompt('Save current canvas as template — name:'); if (!name) return;
    const tpls = loadUserTemplates();
    tpls[name.trim()] = templateSnapshot();
    if (!persistUserTemplates(tpls)) { alert('Could not save — browser storage is unavailable (private mode or full).'); return; }
    renderUserTemplates();
    alert(`Saved template "${name.trim()}".`);
}

function getWorkspacePoint(clientX, clientY) {
    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    return { x: (clientX - rect.left - state.camera.x) / state.camera.zoom, y: (clientY - rect.top - state.camera.y) / state.camera.zoom };
}

function applyCamera() {
    document.getElementById('workspace').setAttribute('transform', `translate(${state.camera.x}, ${state.camera.y}) scale(${state.camera.zoom})`);
    const backgroundSize = GRID_SNAP * state.camera.zoom, canvasContainer = document.getElementById('canvasContainer');
    canvasContainer.style.backgroundSize = `${backgroundSize}px ${backgroundSize}px`; canvasContainer.style.backgroundPosition = `${state.camera.x}px ${state.camera.y}px`;
}

// Frame the whole topology in the viewport (centered + zoomed to fit).
function fitToView() {
    if (!state.nodes.length) { state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera(); return; }
    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    if (!rect.width || !rect.height) { requestAnimationFrame(fitToView); return; }
    const NODE = 30, LABEL = 46; // node half-box + label allowance below
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.nodes.forEach((n) => {
        minX = Math.min(minX, n.x - NODE); minY = Math.min(minY, n.y - NODE);
        maxX = Math.max(maxX, n.x + NODE); maxY = Math.max(maxY, n.y + NODE + LABEL);
    });
    const PAD = 80;
    const w = (maxX - minX) || 1, h = (maxY - minY) || 1;
    const zoom = Math.min(1.4, Math.max(0.2, Math.min((rect.width - PAD * 2) / w, (rect.height - PAD * 2) / h)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    state.camera.zoom = zoom;
    state.camera.x = rect.width / 2 - cx * zoom;
    state.camera.y = rect.height / 2 - cy * zoom;
    applyCamera();
}

function updateOsDatalist() {
    const dl = document.getElementById('osDatalist'); dl.innerHTML = '';
    new Set(state.nodes.map((n) => n.os).filter(Boolean)).forEach((os) => { dl.appendChild(new Option(os, os)); });
}

// ---- The one document serializer ----
// Everything that persists the canvas — the URL hash, "save as template", and
// undo/redo — goes through here, so there is a single allowlist to keep honest.
// Any node/link/interface field not named here is dropped on the next save.
function serializeNode(n) {
    return { id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, gw: n.gw || '', dns: n.dns || '', os: n.os || '', ports: n.ports || '', notes: n.notes || '', nat: !!n.nat, portCount: Number.isFinite(n.portCount) ? n.portCount : undefined, interfaces: (n.interfaces || []).map((i) => ({ id: i.id, name: i.name, ip: i.ip, drawZone: i.drawZone, wireless: i.wireless, bond: i.bond })) };
}
function serializeLink(l) {
    return { id: l.id, source: l.source, target: l.target, attachment: l.attachment, medium: l.medium, sourceIface: l.sourceIface || undefined, targetIface: l.targetIface || undefined };
}
function serializeDoc() {
    return { nodes: state.nodes.map(serializeNode), links: state.links.map(serializeLink) };
}
function encodeDoc(doc) { return btoa(encodeURIComponent(JSON.stringify(doc))); }

function save() {
    try {
        const doc = serializeDoc();
        recordHistory(JSON.stringify(doc));            // ride the one chokepoint every mutation already calls
        window.history.replaceState(null, '', `#${encodeDoc(doc)}`);
        updateOsDatalist();
    } catch (err) { console.warn('Could not save diagram state:', err); }
}

// ---- Undo / redo ----
// The document is exactly {nodes, links}, and save() already reserializes it
// after every mutation — while camera pans and selection clicks never reach
// save(). So history rides that chokepoint: we hold the last committed snapshot
// (_present, a JSON string) plus a stack of prior ones and a stack of undone
// ones. A save() whose JSON equals _present is a no-op (e.g. a redundant save)
// and does not push a duplicate step; a save() that differs forks the timeline,
// discarding any redo future.
const UNDO_LIMIT = 100;
let _present = null;
let _undoStack = [];
let _redoStack = [];

// Call once the initial document is on screen: makes the loaded state the floor
// of the timeline without itself being an undoable step.
function initHistory() {
    _present = JSON.stringify(serializeDoc());
    _undoStack = []; _redoStack = [];
    updateUndoButtons();
}

function recordHistory(json) {
    if (_present === null) { _present = json; updateUndoButtons(); return; }
    if (json === _present) return;                     // nothing about the document changed
    _undoStack.push(_present);
    if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
    _present = json;
    _redoStack = [];                                   // a fresh edit invalidates the redo future
    updateUndoButtons();
}

// Rebuild the canvas from a snapshot without touching the history stacks — undo
// and redo move _present themselves. Mirrors load()'s reset of transient ids so
// a stale selection or armed link cannot survive the swap.
function applyDoc(json) {
    const parsed = JSON.parse(json);
    state.selectedId = null; state.selectedType = null; state.linkSourceId = null;
    state.nodes = (parsed.nodes || []).map(normalizeLoadedNode);
    state.links = (Array.isArray(parsed.links) ? parsed.links : []).map(normalizeLoadedLink).filter((l) => getNode(l.source) && getNode(l.target));
    autoBindLinks();
    window.history.replaceState(null, '', `#${encodeDoc(serializeDoc())}`);
    updateOsDatalist();
    select(null, null); invalidateTidy();
    renderCanvasOnly();
    updateUndoButtons();
}

function undo() {
    if (!_undoStack.length) return;
    _redoStack.push(_present);
    _present = _undoStack.pop();
    applyDoc(_present);
}
function redo() {
    if (!_redoStack.length) return;
    _undoStack.push(_present);
    _present = _redoStack.pop();
    applyDoc(_present);
}

function updateUndoButtons() {
    const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
    if (u) { u.disabled = !_undoStack.length; u.title = _undoStack.length ? `Undo (${_undoStack.length}) — Ctrl+Z` : 'Nothing to undo'; }
    if (r) { r.disabled = !_redoStack.length; r.title = _redoStack.length ? `Redo (${_redoStack.length}) — Ctrl+Shift+Z` : 'Nothing to redo'; }
}

function normalizeLoadedNode(node) {
    const def = initialDataDefaults[node.type] || { interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] };
    let normalizedInterfaces = Array.isArray(node.interfaces) ? node.interfaces : cloneData(def.interfaces);
    // Legacy converter from ips to interfaces
    if (node.ips && Array.isArray(node.ips) && node.ips.length > 0) {
        normalizedInterfaces = node.ips.map((ip, idx) => ({ id: `i_${Date.now()}_${idx}`, name: idx === 0 ? 'eth0' : `eth${idx}`, ip }));
    } else if (node.ips && Array.isArray(node.ips) && node.ips.length === 0) {
        normalizedInterfaces = [];
    }
    // An AP without a radio cannot serve anyone; older diagrams stored none, so
    // its clients would otherwise all land in the uplink socket.
    if (node.type === 'ap' && !normalizedInterfaces.some(ifaceIsWireless)) {
        normalizedInterfaces = [{ id: 'w1', name: 'wlan0', ip: '' }, ...normalizedInterfaces];
    }

    const normalized = { id: node.id || `n_${Date.now()}_${Math.random().toString(16).slice(2)}`, type: node.type || 'custom', name: node.name || 'Unnamed Node', x: Number.isFinite(node.x) ? node.x : 200, y: Number.isFinite(node.y) ? node.y : 200, gw: node.gw || '', dns: node.dns || '', os: node.os || '', ports: node.ports || '', notes: node.notes || '', nat: !!(node.nat || (initialDataDefaults[node.type] && initialDataDefaults[node.type].nat && node.nat === undefined)), interfaces: normalizedInterfaces };
    if (Number.isFinite(node.portCount)) normalized.portCount = node.portCount;
    return normalized;
}

// Links from older diagrams carry no interface refs; keep them optional here and
// let autoBindLinks() fill them in once every node is loaded.
function normalizeLoadedLink(link) {
    return { id: link.id || nextId('l'), source: link.source, target: link.target, attachment: link.attachment, medium: link.medium, sourceIface: link.sourceIface || null, targetIface: link.targetIface || null };
}

function loadTemplateState(tpl) {
    state.nodes = cloneData(tpl.nodes).map(normalizeLoadedNode);
    state.links = cloneData(tpl.links).map(normalizeLoadedLink).filter((l) => getNode(l.source) && getNode(l.target));
}

function load() {
    // Every node about to be replaced, so any id still held is about to dangle.
    // popstate reaches here without a reload — paste a shared URL while link mode
    // is armed and the next canvas click looked up a node that no longer exists.
    state.selectedId = null; state.selectedType = null; state.linkSourceId = null;
    const hash = window.location.hash.substring(1);
    if (!hash) { loadTemplateState(templatesData.house); autoBindLinks(); updateOsDatalist(); return; }
    try {
        const parsed = JSON.parse(decodeURIComponent(atob(hash)));
        state.nodes = (parsed.nodes || []).map(normalizeLoadedNode);
        state.links = (Array.isArray(parsed.links) ? parsed.links : []).map(normalizeLoadedLink).filter((l) => getNode(l.source) && getNode(l.target));
    } catch (e) {
        loadTemplateState(templatesData.house);
    }
    autoBindLinks();
    updateOsDatalist();
}

function deleteSelected() {
    if (!state.selectedId) return;
    if (state.selectedType === 'node') { state.nodes = state.nodes.filter((n) => n.id !== state.selectedId); state.links = state.links.filter((l) => l.source !== state.selectedId && l.target !== state.selectedId); } 
    else if (state.selectedType === 'link') { state.links = state.links.filter((l) => l.id !== state.selectedId); }
    select(null, null); save();
    renderCanvasOnly();
}

window.addEventListener('mousedown', (event) => {
    if (event.target.id === 'networkCanvas' && (event.button === 1 || event.button === 0)) {
        isDraggingCanvas = true; lastMouse = { x: event.clientX, y: event.clientY };
        if (event.button === 0 && !isDraggingNode) select(null, null);
    }
});

window.addEventListener('mousemove', (event) => {
    if (isDraggingCanvas && !isDraggingNode) {
        state.camera.x += event.clientX - lastMouse.x; state.camera.y += event.clientY - lastMouse.y;
        lastMouse = { x: event.clientX, y: event.clientY }; applyCamera();
    } else if (isDraggingNode && draggedNode) {
        const pt = getWorkspacePoint(event.clientX, event.clientY);
        draggedNode.x = Math.round((pt.x - dragOffset.x) / GRID_SNAP) * GRID_SNAP; 
        draggedNode.y = Math.round((pt.y - dragOffset.y) / GRID_SNAP) * GRID_SNAP;

        // Direct DOM update (Zero RAM overhead)
        const nodeEl = document.getElementById(`ui-node-${draggedNode.id}`);
        if (nodeEl) nodeEl.setAttribute('transform', `translate(${draggedNode.x}, ${draggedNode.y})`);

        state.links.forEach(l => {
            if (l.source === draggedNode.id || l.target === draggedNode.id) {
                const lineEl = document.getElementById(`ui-link-${l.id}`);
                const geo = lineEl && linkGeometry(l);
                if (geo) applyLinkGeometry(lineEl, geo);
            }
        });
    }
});

window.addEventListener('mouseup', () => { 
    isDraggingCanvas = false; 
    if (isDraggingNode) {
        isDraggingNode = false; draggedNode = null; save(); invalidateTidy(); // manual move → next Tidy re-tidies
        renderCanvasOnly(); // Render zones/traces only ONCE when mouse is released
    }
});

window.addEventListener('mouseup', () => { isDraggingCanvas = false; if (isDraggingNode) { isDraggingNode = false; draggedNode = null; save(); } });
document.getElementById('networkCanvas').addEventListener('wheel', (event) => {
    event.preventDefault(); const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    const mx = event.clientX - rect.left, my = event.clientY - rect.top, nextZoom = Math.min(Math.max(0.2, state.camera.zoom * Math.exp(-event.deltaY * 0.001)), 5);
    state.camera.x = mx - (mx - state.camera.x) * (nextZoom / state.camera.zoom); state.camera.y = my - (my - state.camera.y) * (nextZoom / state.camera.zoom); state.camera.zoom = nextZoom; applyCamera();
}, { passive: false });

// ---- Keyboard shortcuts ----
// The handler and the on-screen cheatsheet are generated from this one table, so
// the documented keys cannot drift away from the ones that actually fire.
function setTraceMode(on) {
    const box = document.getElementById('toggleTrace');
    box.checked = on;
    box.dispatchEvent(new Event('change')); // reuse the checkbox's own logic
}

function toggleShortcutHelp(force) {
    const panel = document.getElementById('shortcutHelp');
    const show = force !== undefined ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
}

const SHORTCUTS = [
    { keys: ['T'], label: 'Toggle trace mode', test: (e) => e.key.toLowerCase() === 't',
      run: () => setTraceMode(!state.settings.traceMode) },
    { keys: ['F'], label: 'Fit the diagram to the view', test: (e) => e.key.toLowerCase() === 'f',
      run: () => fitToView() },
    { keys: ['A'], label: 'Show / hide validation alerts', test: (e) => e.key.toLowerCase() === 'a',
      run: () => { state.settings.alertsHidden = !state.settings.alertsHidden; saveSettings(); validateTopology(); } },
    { keys: ['L'], label: 'Link from the selected node', test: (e) => e.key.toLowerCase() === 'l',
      run: () => { if (state.selectedType === 'node' && state.selectedId) { state.linkSourceId = state.selectedId; renderCanvasOnly(); } } },
    { keys: ['1'], label: 'Nodes tab', test: (e) => e.key === '1', run: () => showLibraryTab('nodes') },
    { keys: ['2'], label: 'Networks tab', test: (e) => e.key === '2', run: () => showLibraryTab('templates') },
    { keys: ['3'], label: 'Blocks tab', test: (e) => e.key === '3', run: () => showLibraryTab('blocks') },
    { keys: ['/'], label: 'Search the canvas', test: (e) => e.key === '/',
      run: () => { const f = document.getElementById('canvasFilter'); f.focus(); f.select(); } },
    { keys: ['0'], label: 'Reset zoom to 1:1', test: (e) => e.key === '0',
      run: () => document.getElementById('zoomResetBtn').click() },
    { keys: ['+', '−'], label: 'Zoom in / out', test: (e) => ['+', '=', '-', '_'].includes(e.key),
      run: (e) => document.getElementById(['+', '='].includes(e.key) ? 'zoomInBtn' : 'zoomOutBtn').click() },
    { keys: ['Del'], label: 'Delete the selection', test: (e) => e.key === 'Delete' || e.key === 'Backspace',
      run: () => deleteSelected() },
    { keys: ['Esc'], label: 'Cancel link mode / deselect', test: (e) => e.key === 'Escape',
      run: () => { toggleShortcutHelp(false); state.linkSourceId = null; select(null, null); renderCanvasOnly(); } },
    { keys: ['?'], label: 'Show this list', test: (e) => e.key === '?', run: () => toggleShortcutHelp() }
];

window.addEventListener('keydown', (event) => {
    const activeTag = document.activeElement?.tagName || '';
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag);

    // Undo/redo are the exception to "leave Ctrl/Cmd combos alone" below. Inside a
    // field we defer to the browser's own text undo; on the canvas they act on the
    // diagram. Ctrl+Z, and either Ctrl+Shift+Z or Ctrl+Y to redo.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !inField) {
        const k = event.key.toLowerCase();
        if (k === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
        if (k === 'y') { event.preventDefault(); redo(); return; }
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return; // leave browser/OS combos alone

    const tag = document.activeElement?.tagName || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        // Escape is the way out of a field; every other key belongs to the field.
        if (event.key === 'Escape') document.activeElement.blur();
        return;
    }

    const hit = SHORTCUTS.find((sc) => sc.test(event));
    if (!hit) return;
    event.preventDefault();
    hit.run(event);
});

// Mouse interactions used to live at the bottom of the Nodes palette, where they
// were easy to miss and took space from the palette. They belong here, in the
// one help surface, reachable from the ? button and the ? key.
const MOUSE_HINTS = [
    { icon: '🖱️', verb: 'Click', text: 'Select a node or link to edit it.' },
    { icon: '✋', verb: 'Drag', text: 'Move a node, or pan the empty canvas.' },
    { icon: '⚡', verb: 'Right-click', text: 'Link mode — then click another node to connect.' }
];

function renderShortcutHelp() {
    const subhead = (t) => `<div class="text-[9px] font-bold uppercase tracking-wider mb-1.5 mt-1" style="color: var(--cs-text-muted)">${t}</div>`;
    const mouse = MOUSE_HINTS.map((h) => `
        <div class="flex items-baseline gap-2 py-1">
            <span class="shrink-0">${h.icon}</span>
            <span style="color: var(--cs-text-sec)"><span class="font-bold" style="color: var(--cs-text)">${escapeHtml(h.verb)}:</span> ${escapeHtml(h.text)}</span>
        </div>`).join('');
    const keys = SHORTCUTS.map((sc) => `
        <div class="shortcut-row flex items-center justify-between gap-3 py-1">
            <span style="color: var(--cs-text-sec)">${escapeHtml(sc.label)}</span>
            <span class="flex gap-1 shrink-0">${sc.keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</span>
        </div>`).join('');
    document.getElementById('shortcutBody').innerHTML =
        subhead('Mouse') + mouse +
        `<div class="mt-2 pt-2" style="border-top: 1px solid var(--cs-border)">${subhead('Keyboard')}${keys}</div>`;
}

// ---- Library tabs ----
function showLibraryTab(name) {
    state.settings.libraryTab = name;
    saveSettings();
    document.querySelectorAll('.lib-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll('.lib-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tabPanel-${name}`));
}
document.querySelectorAll('.lib-tab').forEach((t) => { t.onclick = () => showLibraryTab(t.dataset.tab); });

function libraryItem({ icon, name, blurb }, onPick, onDelete) {
    const row = document.createElement('div');
    row.className = 'lib-item';
    const btn = document.createElement('button');
    btn.className = 'flex items-start gap-2 flex-1 min-w-0 bg-transparent border-0 p-0 text-left cursor-pointer';
    btn.innerHTML = `<span class="lib-item-icon">${icon}</span><span class="min-w-0"><span class="lib-item-name block truncate">${escapeHtml(name)}</span><span class="lib-item-blurb block">${escapeHtml(blurb)}</span></span>`;
    btn.onclick = onPick;
    row.appendChild(btn);
    if (onDelete) {
        const del = document.createElement('button');
        del.className = 'lib-item-del shrink-0'; del.textContent = '✖'; del.title = `Delete "${name}"`;
        del.onclick = (e) => { e.stopPropagation(); onDelete(); };
        row.appendChild(del);
    }
    return row;
}

function applyTemplate(template) {
    if (!template) return;
    if (!confirm('Replace current workspace with this network?')) return;
    loadTemplateState(template); autoBindLinks();
    state.selectedId = null; state.selectedType = null; state.linkSourceId = null;
    select(null, null); save(); invalidateTidy();
    renderCanvasOnly();
    fitToView();
}

function renderLibrary() {
    const tplList = document.getElementById('templateList');
    tplList.innerHTML = '';
    TEMPLATE_META.forEach((meta) => {
        if (!templatesData[meta.key]) return; // meta without data would render a dead row
        tplList.appendChild(libraryItem(meta, () => applyTemplate(templatesData[meta.key])));
    });

    const blockList = document.getElementById('blockList');
    blockList.innerHTML = '';
    SNIPPET_META.forEach((meta) => {
        if (!SNIPPETS[meta.key]) return;
        blockList.appendChild(libraryItem(meta, () => { stampSnippet(meta.key); showLibraryTab('nodes'); }));
    });

    renderUserTemplates();
}

function renderUserTemplates() {
    const section = document.getElementById('userTemplateSection');
    const list = document.getElementById('userTemplateList');
    const saved = loadUserTemplates();
    const names = Object.keys(saved);
    list.innerHTML = '';
    section.classList.toggle('hidden', !names.length);
    names.forEach((name) => {
        list.appendChild(libraryItem(
            { icon: '💾', name, blurb: `${(saved[name].nodes || []).length} nodes · saved locally` },
            () => applyTemplate(saved[name]),
            () => {
                if (!confirm(`Delete saved network "${name}"?`)) return;
                const all = loadUserTemplates(); delete all[name];
                persistUserTemplates(all);
                renderUserTemplates();
            }
        ));
    });
}

document.getElementById('tidyBtn').onclick = tidyLayout;
document.getElementById('saveTemplateBtn').onclick = saveUserTemplate;
document.getElementById('undoBtn').onclick = undo;
document.getElementById('redoBtn').onclick = redo;

// Drag a palette item and drop it onto the canvas at the cursor
(function () {
    const cc = document.getElementById('canvasContainer');
    cc.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/carino-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    cc.addEventListener('drop', (e) => {
        const type = e.dataTransfer.getData('text/carino-node'); if (!type) return;
        e.preventDefault(); spawnNode(type, { at: getWorkspacePoint(e.clientX, e.clientY) });
    });
})();

const propertyBindings = [
    { key: 'name', id: 'propName' },
    { key: 'gw', id: 'propGw' },
    { key: 'dns', id: 'propDns' },
    { key: 'os', id: 'propOs' },
    { key: 'ports', id: 'propPorts' },
    { key: 'notes', id: 'propNotes' }
];

propertyBindings.forEach((binding) => {
    document.getElementById(binding.id).addEventListener('input', (event) => {
        if (!state.selectedId || state.selectedType !== 'node') return;

        const node = getNode(state.selectedId);
        if (!node) return;

        node[binding.key] = event.target.value;

        save();
        renderCanvasOnly();
        renderNodeDiagnostics(node);
    });
});

document.getElementById('addIfaceBtn').onclick = () => { if (!state.selectedId || state.selectedType !== 'node') return; const node = getNode(state.selectedId); if (!node) return; createIfaceFor(node); renderSidebarData(node); save();
renderCanvasOnly();
renderNodeDiagnostics(node); };
document.getElementById('bondIfaceBtn').onclick = () => {
    if (!state.selectedId || state.selectedType !== 'node') return;
    const node = getNode(state.selectedId); if (!node) return;
    if (!createBond(node)) return;
    renderSidebarData(node); save(); renderCanvasOnly(); renderNodeDiagnostics(node);
};
document.getElementById('deleteElementBtn').onclick = deleteSelected;
document.getElementById('zoomInBtn').onclick = () => { state.camera.zoom = Math.min(5, state.camera.zoom * 1.2); applyCamera(); };
document.getElementById('zoomOutBtn').onclick = () => { state.camera.zoom = Math.max(0.2, state.camera.zoom / 1.2); applyCamera(); };
document.getElementById('zoomResetBtn').onclick = () => { state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 1; applyCamera(); };
document.getElementById('clearCanvasBtn').onclick = () => { if (!confirm('Clear canvas?')) return; state.nodes = []; state.links = []; state.selectedId = null; state.selectedType = null; state.linkSourceId = null; save(); invalidateTidy(); select(null, null); renderCanvasOnly(); };
document.getElementById('copyUrlBtn').onclick = async () => { save(); try { await navigator.clipboard.writeText(window.location.href); alert('URL copied.'); } catch (e) { prompt('Copy this URL:', window.location.href); } };

document.getElementById('toggleTrace').addEventListener('change', (event) => {
    state.settings.traceMode = event.target.checked;
    // On first activation, if nothing is selected, pick a sensible start
    // node (prefer a router/firewall gateway) so the trace lights up right away.
    if (state.settings.traceMode && (!state.selectedId || state.selectedType !== 'node')) {
        const start = state.nodes.find((n) => isRoutingDevice(n.type)) || state.nodes.find((n) => n.type !== 'cloud') || state.nodes[0];
        if (start) { select(start.id, 'node'); return; } // select() re-renders
    }
    renderCanvasOnly();
});
// Dim the port field when a port is typed but the filter is switched off, so the
// "typed but ignored" state is visible rather than a silent no-op.
function updateTracePortUi() {
    const box = document.getElementById('tracePortToggle');
    const port = document.getElementById('tracePort');
    if (!box || !port) return;
    const suspended = !box.checked && port.value.trim() !== '';
    port.style.opacity = suspended ? '0.45' : '1';
    port.title = suspended
        ? 'Port filter is off — this port is ignored. Toggle Port on to apply it.'
        : 'Port to test when the Port filter is on';
}
function onTraceControlsChanged() {
    updateTracePortUi();
    if (state.settings.traceMode) renderCanvasOnly();
    refreshSelectedNodeDiagnostics();
}
document.getElementById('tracePort').addEventListener('input', (event) => {
    // Typing a port arms the filter; emptying it disarms. The toggle then only
    // suspends/resumes, so you never lose what you typed.
    const box = document.getElementById('tracePortToggle');
    if (box) box.checked = event.target.value.trim() !== '';
    onTraceControlsChanged();
});
document.getElementById('tracePortToggle').addEventListener('change', onTraceControlsChanged);

// Encode a canvas to the requested image type, but name the file for what the
// canvas ACTUALLY produced. Safari gained canvas WebP only in v17 (2023); older
// WebKit silently hands back a PNG data URL for an unsupported type, so a naive
// "webp" export would save a PNG under a .webp name that some tools then refuse.
// Trust the returned MIME, not the request.
function encodeCanvas(canvas, requested) {
    const url = canvas.toDataURL(`image/${requested}`);
    const got = /^data:image\/([a-z0-9.+-]+)/i.exec(url);
    const actual = got ? got[1].toLowerCase() : 'png';
    return { url, ext: actual === 'jpeg' ? 'jpg' : actual };
}

function handleExport(format) {
    if (!state.nodes.length) { alert('Nothing to export. Add at least one node first.'); return; }
    const PADDING = 90, NODE_HALF_SIZE = 24, LABEL_EXTRA_BOTTOM = 42, SCALE = 4;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    state.nodes.forEach((node) => {
        minX = Math.min(minX, node.x - NODE_HALF_SIZE); minY = Math.min(minY, node.y - NODE_HALF_SIZE);
        maxX = Math.max(maxX, node.x + NODE_HALF_SIZE); maxY = Math.max(maxY, node.y + NODE_HALF_SIZE + LABEL_EXTRA_BOTTOM);
    });

    minX -= PADDING; minY -= PADDING; maxX += PADDING; maxY += PADDING;
    const exportWidth = Math.max(1, Math.ceil(maxX - minX)), exportHeight = Math.max(1, Math.ceil(maxY - minY));
    const originalCamera = { x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom };

    const svg = document.getElementById('networkCanvas'), workspace = document.getElementById('workspace');
    workspace.setAttribute('transform', `translate(${-minX}, ${-minY}) scale(1)`);
    svg.setAttribute('width', exportWidth * SCALE); svg.setAttribute('height', exportHeight * SCALE); svg.setAttribute('viewBox', `0 0 ${exportWidth} ${exportHeight}`);

    let serialized = new XMLSerializer().serializeToString(svg);
    svg.removeAttribute('width'); svg.removeAttribute('height'); svg.removeAttribute('viewBox');
    state.camera = originalCamera; applyCamera(); renderCanvasOnly();

    if (!serialized.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) serialized = serialized.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');

    const url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })), img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
        canvas.width = exportWidth * SCALE; canvas.height = exportHeight * SCALE;
        ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f8fafc'; ctx.scale(SCALE, SCALE);
        for (let x = ((-minX) % GRID_SNAP + GRID_SNAP) % GRID_SNAP; x < exportWidth; x += GRID_SNAP) {
            for (let y = ((-minY) % GRID_SNAP + GRID_SNAP) % GRID_SNAP; y < exportHeight; y += GRID_SNAP) {
                ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(img, 0, 0, exportWidth * SCALE, exportHeight * SCALE);
        const out = encodeCanvas(canvas, format);
        const a = document.createElement('a'); a.href = out.url; a.download = `network-diagram.${out.ext}`; a.click();
        URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Could not export image.'); };
    img.src = url;
}

document.getElementById('canvasFilter').addEventListener('input', (event) => {
    const term = event.target.value.toLowerCase().trim();
    state.nodes.forEach(node => {
        const el = document.getElementById(`ui-node-${node.id}`);
        if (!el) return;

        if (term === '') {
            el.style.opacity = '1';
            return;
        }

        const matchName = (node.name || '').toLowerCase().includes(term);
        const matchIp = (node.interfaces || []).some(i => i.ip.includes(term));

        el.style.opacity = (matchName || matchIp) ? '1' : '0.15';
    });
});

document.getElementById('exportPngBtn').onclick = () => handleExport('png');
document.getElementById('exportWebpBtn').onclick = () => handleExport('webp');

// Browser back/forward swaps the document wholesale (a shared URL, say), so the
// edit timeline for the old document no longer applies — start a fresh one.
window.addEventListener('popstate', () => { load(); renderCanvasOnly(); fitToView(); initHistory(); });

document.getElementById('conflictHideBtn').onclick = () => {
    state.settings.alertsHidden = true; saveSettings(); validateTopology();
};
document.getElementById('conflictPill').onclick = () => {
    state.settings.alertsHidden = false; saveSettings(); validateTopology();
};

document.getElementById('helpBtn').onclick = () => toggleShortcutHelp();
document.getElementById('shortcutClose').onclick = () => toggleShortcutHelp(false);
document.getElementById('shortcutHelp').onclick = (e) => {
    if (e.target.id === 'shortcutHelp') toggleShortcutHelp(false); // click the backdrop to dismiss
};

renderLibrary();
renderShortcutHelp();
loadSettings();
showLibraryTab(state.settings.libraryTab || 'nodes');
load(); renderCanvasOnly(); fitToView();
initHistory(); // the loaded document is the floor of the undo timeline, not a step
updateTracePortUi();
