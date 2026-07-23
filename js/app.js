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
    // netcfg rides the same `|| undefined` trick as sourceIface: JSON.stringify
    // drops it, so documents that never touch the netplan toggle stay
    // byte-identical to what they were before the field existed.
    return { id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, gw: n.gw || '', dns: n.dns || '', os: n.os || '', ports: n.ports || '', notes: n.notes || '', nat: !!n.nat, netcfg: n.netcfg || undefined, portCount: Number.isFinite(n.portCount) ? n.portCount : undefined, interfaces: (n.interfaces || []).map((i) => ({ id: i.id, name: i.name, ip: i.ip, drawZone: i.drawZone, wireless: i.wireless, bond: i.bond })) };
}
function serializeLink(l) {
    return { id: l.id, source: l.source, target: l.target, attachment: l.attachment, medium: l.medium, sourceIface: l.sourceIface || undefined, targetIface: l.targetIface || undefined };
}
function serializeDoc() {
    return { nodes: state.nodes.map(serializeNode), links: state.links.map(serializeLink) };
}
function encodeDoc(doc) { return btoa(encodeURIComponent(JSON.stringify(doc))); }

// ---- URL fragment codec ----
// The diagram rides in the URL fragment: never sent to a server (so no proxy
// length cap, and private by construction — it stays out of logs and Referer).
// Its one weakness is size, so the *shareable* form (Copy URL) is compressed.
// Two fragment formats, told apart by a leading marker so old links keep opening:
//   ~<base64url>   deflate-raw compressed  — 7–10x smaller, the form Copy URL emits
//   <base64>       legacy btoa(encodeURIComponent(json)) — what save() writes live
// "~" is unreserved in URLs and absent from both base64 alphabets, so it is an
// unambiguous discriminator. Compression is async (native CompressionStream), so
// only the compressed path awaits; the legacy path stays synchronous, which is
// why load() can still be called synchronously with a legacy hash.
const FRAG_SCHEME = '~';
const _canCompress = typeof CompressionStream !== 'undefined';
const _canDecompress = typeof DecompressionStream !== 'undefined';

function _b64urlFromBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _bytesFromB64url(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
async function _pipeStream(stream, bytes) {
    const w = stream.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

// json string -> the compact shareable fragment (no leading '#'). Falls back to
// the legacy encoding on a browser without CompressionStream, or whenever the
// compressed form would somehow be larger (tiny docs can inflate under deflate).
async function encodeShareFragment(json) {
    const legacy = btoa(encodeURIComponent(json));
    if (!_canCompress) return legacy;
    const packed = await _pipeStream(new CompressionStream('deflate-raw'), new TextEncoder().encode(json));
    const compressed = FRAG_SCHEME + _b64urlFromBytes(packed);
    return compressed.length < legacy.length + 1 ? compressed : legacy;
}
// fragment (no '#') -> json string. Async only for the compressed form.
async function decodeFragment(frag) {
    if (frag[0] === FRAG_SCHEME) {
        if (!_canDecompress) throw new Error('This link is compressed, but this browser cannot decompress it.');
        return new TextDecoder().decode(await _pipeStream(new DecompressionStream('deflate-raw'), _bytesFromB64url(frag.slice(1))));
    }
    return decodeURIComponent(atob(frag)); // legacy
}

// ---- Topology → netplan bridge ----
// Projects a node onto netplan.carino.systems' interface-intent model, computed
// fresh every time so the link always reflects the node as it is *now* — the
// toggle stores one boolean, never a config snapshot. Wire format is the same
// fragment codec above wrapped in a {v:1, ifaces, fam} envelope; the receiver
// keeps a byte-identical decoder. Full rationale: docs/netplan-bridge-design.md.
function bridgeIntent(node) {
    // Faceplate ports and bonded members are topology bookkeeping, not hosts'
    // configurable interfaces — netplan would render nonsense for them.
    const bondMembers = new Set();
    (node.interfaces || []).forEach((i) => { if (i.bond && Array.isArray(i.bond.members)) i.bond.members.forEach((m) => bondMembers.add(m)); });
    const real = (node.interfaces || []).filter((i) => !i.implicit && !bondMembers.has(i.id));

    // The node-level gateway/DNS belong to exactly one interface on the netplan
    // side: the one whose subnet contains the gateway, else the first addressed
    // one. A heuristic — the hydrated form is meant to be reviewed, not applied.
    let gwOwner = null;
    if (node.gw && node.gw.trim()) {
        const gwStr = node.gw.trim();
        gwOwner = real.find((i) => {
            const parsed = parseValidCIDR(i.ip);
            try { return parsed && ipaddr.parse(gwStr).match(parsed.cidrObj); } catch (e) { return false; }
        }) || real.find((i) => i.ip) || real[0] || null;
    }

    const ifaces = real.map((i) => {
        const wifi = ifaceIsWireless(i);
        const entry = {
            name: i.name || 'eth0',
            type: wifi ? 'wifi' : 'ethernet',
            dhcp4: !i.ip,                                              // blank IP → assume a DHCP client
            dhcp6: false,
            addr: i.ip ? (i.ip.includes('/') ? i.ip : `${i.ip}${i.ip.includes(':') ? '/64' : '/24'}`) : '', // prefix-less topology IPs get a guessed /24 (v4) or /64 (v6)
            gw: i === gwOwner ? node.gw.trim() : '',
            dns: i === gwOwner ? (node.dns || '') : '',
            search: '',
            routes: [],
        };
        // SSID is a placeholder from the node name; the passphrase never rides
        // a URL — fragments land in browser history.
        if (wifi) entry.ssid = node.name || 'MyWiFi';
        return entry;
    });
    const anyV6 = ifaces.some((i) => i.addr.includes(':'));
    return { v: 1, ifaces, fam: [true, anyV6] };
}

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
    if (node.netcfg) normalized.netcfg = true;
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

// Async so it can decompress a shared "~" link, but the legacy path evaluates no
// await — an async function runs synchronously until its first awaited expression
// — so load() with a legacy hash still completes in one tick, and callers that do
// `save(); load();` keep working without change.
async function load() {
    // Every node about to be replaced, so any id still held is about to dangle.
    // popstate reaches here without a reload — paste a shared URL while link mode
    // is armed and the next canvas click looked up a node that no longer exists.
    state.selectedId = null; state.selectedType = null; state.linkSourceId = null;
    const hash = window.location.hash.substring(1);
    if (!hash) { loadTemplateState(templatesData.house); autoBindLinks(); updateOsDatalist(); return; }
    try {
        const json = hash[0] === FRAG_SCHEME ? await decodeFragment(hash) : decodeURIComponent(atob(hash));
        const parsed = JSON.parse(json);
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

// The selection panel splits into Configuration (primary) and Diagnostics tabs.
// Purely presentational — it flips which panel shows; the panes inside keep their
// own selected/empty states, so no render logic needs to know which tab is up.
function showConfigTab(name) {
    document.querySelectorAll('.cfg-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.cfgtab === name)));
    document.querySelectorAll('.cfg-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `cfgPanel-${name}`));
}
document.querySelectorAll('.cfg-tab').forEach((t) => { t.onclick = () => showConfigTab(t.dataset.cfgtab); });

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
// Copy URL is the share path, so it emits the compressed "~" fragment (7–10x
// shorter) and writes it to the address bar too, so what you copy and what you
// see match. Live editing keeps the fast uncompressed hash; this upgrades it.
document.getElementById('copyUrlBtn').onclick = async () => {
    save();
    try {
        const frag = await encodeShareFragment(JSON.stringify(serializeDoc()));
        window.history.replaceState(null, '', `#${frag}`);
    } catch (e) { /* fall back to whatever save() already wrote */ }
    const url = window.location.href;
    try { await navigator.clipboard.writeText(url); alert('Shareable URL copied.'); }
    catch (e) { prompt('Copy this URL:', url); }
};

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

// ---- Portable build files (.nettopo) ----
// The escape hatch for builds too big or too archival for a URL: a file has no
// length ceiling, travels as an email/chat attachment, and diffs in git. Same
// serializer as everything else, wrapped in a tiny self-identifying envelope so
// the file can be recognised and can carry a schema version later.
function exportJsonFile() {
    if (!state.nodes.length) { alert('Nothing to export. Add at least one node first.'); return; }
    const payload = { kind: 'nettopology', version: 1, doc: serializeDoc() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'network-build.nettopo.json'; a.click();
    URL.revokeObjectURL(url);
}

// Accept both the enveloped file we write and a bare { nodes, links } — the same
// shape a decoded share URL holds — so a build is importable however it was saved.
function docFromImported(parsed) {
    if (parsed && parsed.doc && Array.isArray(parsed.doc.nodes)) return parsed.doc;
    if (parsed && Array.isArray(parsed.nodes)) return parsed;
    return null;
}

// Load a parsed build object onto the canvas. Split from the file reading so the
// swap logic is testable without a FileReader in the way. Returns whether it took.
function applyImportedDoc(parsed) {
    const doc = docFromImported(parsed);
    if (!doc) { alert('That file does not look like a NetTopology build.'); return false; }
    if (state.nodes.length && !confirm('Replace the current canvas with this build?')) return false;
    loadTemplateState(doc); autoBindLinks();
    state.selectedId = null; state.selectedType = null; state.linkSourceId = null;
    select(null, null); save(); invalidateTidy();
    renderCanvasOnly(); fitToView();
    return true;
}

function importJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        let parsed;
        try { parsed = JSON.parse(reader.result); } catch (e) { alert('That file is not valid JSON.'); return; }
        applyImportedDoc(parsed);
    };
    reader.onerror = () => alert('Could not read that file.');
    reader.readAsText(file);
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
document.getElementById('exportJsonBtn').onclick = exportJsonFile;
document.getElementById('importFileBtn').onclick = () => document.getElementById('importFileInput').click();

// Export/share/import dropdown: open on the trigger, close on choosing an item,
// clicking away, or Escape. Items keep their own handlers (wired just above); the
// menu only governs visibility.
(function () {
    const btn = document.getElementById('exportMenuBtn');
    const menu = document.getElementById('exportMenu');
    if (!btn || !menu) return;
    const isOpen = () => !menu.classList.contains('hidden');
    const close = () => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
    const open = () => { menu.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); isOpen() ? close() : open(); });
    menu.addEventListener('click', (e) => { if (e.target.closest('.cs-menu-item')) close(); });
    document.addEventListener('click', (e) => { if (isOpen() && !menu.contains(e.target) && e.target !== btn) close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { close(); btn.focus(); } });
})();
document.getElementById('importFileInput').onchange = (event) => {
    const file = event.target.files[0];
    if (file) importJsonFile(file);
    event.target.value = ''; // let the same file be re-picked
};

// Browser back/forward swaps the document wholesale (a shared URL, say), so the
// edit timeline for the old document no longer applies — start a fresh one.
window.addEventListener('popstate', async () => { await load(); renderCanvasOnly(); fitToView(); initHistory(); });

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
// Boot may need to decompress a shared "~" link, so await it before drawing.
(async () => {
    await load(); renderCanvasOnly(); fitToView();
    initHistory(); // the loaded document is the floor of the undo timeline, not a step
    updateTracePortUi();
})();
