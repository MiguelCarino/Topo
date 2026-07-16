// The engine: interfaces/ports, link geometry, L2 analysis, parsing.
// No DOM.
// Load order: state -> model -> data -> diagnostics -> ui -> app

const GRID_SNAP = 20;

// Virtual endpoints (VM/container) get the bridged/host attachment on their links.
const isVirtualType = (t) => t === 'vm' || t === 'container';

// Architecture Helpers — routing family now includes the L3 derivatives.
const isDumbDevice = (node) => ['switch', 'ap'].includes(node.type) && getValidIps(node).length === 0;
const isRoutingDevice = (type) => ['router', 'firewall', 'cloud', 'loadbalancer', 'vpn', 'l3switch', 'edge'].includes(type);

// ---- Interface / port binding model ----
// A link binds to a specific interface on each end (link.sourceIface /
// link.targetIface hold interface ids). Both are optional: diagrams saved
// before this existed load as unbound and get auto-bound on load.

// Switch/AP faceplates are implicit: a 24-port switch stores `portCount: 24`,
// not 24 interface objects, so the shared URL hash stays small. A port only
// materializes into node.interfaces once it gets a name or an IP (a mgmt VLAN).
const DEFAULT_PORT_COUNT = { switch: 8, ap: 1 };
const hasPortGrid = (node) => !!node && (node.type === 'switch' || node.type === 'ap');
const portCountOf = (node) => Number.isFinite(node?.portCount) ? node.portCount : (DEFAULT_PORT_COUNT[node?.type] ?? 0);

// Wirelessness is a property of the interface, not the node: an AP uplinks to a
// switch by cable and serves clients by radio. Names follow the kernel's
// conventions — wl* covers wlan0/wlp1s0/wlo1, plus the older ath*/ra*.
const WIRELESS_NAME_RE = /^(wl|wifi|wi-fi|ath|ra\d)/i;
// Default wired names only: a deliberately named interface is left alone.
const WIRED_DEFAULT_RE = /^(eth|eno|enp|ens|enx|em|igb|ix|bge|re)\d/i;

// Explicit flag wins, else infer from the name — the same tri-state as drawZone.
const ifaceIsWireless = (iface) => !iface ? false
    : (iface.wireless !== undefined ? !!iface.wireless : WIRELESS_NAME_RE.test(iface.name || ''));

// Date.now() alone collides when a node + link + iface are created in one tick.
let idSeq = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}${(idSeq++).toString(36)}`;

// Every interface on a node: materialized ones, plus the implicit faceplate
// ports for switches/APs. Implicit entries are flagged so the editor knows
// they aren't in node.interfaces yet.
function getInterfaces(node) {
    if (!node) return [];
    const explicit = (node.interfaces || []).map((i) => ({ ...i, implicit: false }));
    if (!hasPortGrid(node)) return explicit;

    const byId = new Map(explicit.map((i) => [i.id, i]));
    const out = [];
    for (let p = 1; p <= portCountOf(node); p++) {
        const id = `p${p}`;
        out.push(byId.get(id) || { id, name: String(p), ip: '', implicit: true });
        byId.delete(id);
    }
    byId.forEach((i) => out.push(i)); // extras (mgmt VLAN) sit after the faceplate
    return out;
}

function ifaceOn(node, ifaceId) { return getInterfaces(node).find((i) => i.id === ifaceId) || null; }
function ifaceLabel(node, ifaceId) { return ifaceOn(node, ifaceId)?.name || ifaceId || '—'; }

// Give a node somewhere to plug a link in. opts.wireless yields a radio, since a
// Wi-Fi association cannot land on a socket. Otherwise opts.grow gains a switch a
// faceplate port, and everything else gains an addressed NIC — a switch's
// management VLAN is a NIC, not a port.
function createIfaceFor(node, opts = {}) {
    node.interfaces = node.interfaces || [];
    const taken = new Set(node.interfaces.map((i) => i.name));
    const nextName = (stem) => { let n = 0; while (taken.has(`${stem}${n}`)) n++; return `${stem}${n}`; };

    if (opts.wireless) {
        const radio = { id: nextId('i'), name: nextName('wlan'), ip: '' };
        node.interfaces.push(radio);
        return radio;
    }
    if (opts.grow && hasPortGrid(node)) {
        node.portCount = portCountOf(node) + 1;
        return { id: `p${node.portCount}`, name: String(node.portCount), ip: '', implicit: true };
    }
    const iface = { id: nextId('i'), name: nextName('eth'), ip: '' };
    node.interfaces.push(iface);
    return iface;
}

// ---- Bonds ----
// A bond is a virtual interface that owns member NICs. The bond carries the
// address; its members carry none. Cables still plug into the members, because
// a bond has no socket to plug into — which is the whole point of the shape:
// two cables, two NICs, one MAC and one IP, so nothing has cause to ARP twice.
// That is why bonding cures the flapping that evaluateMultiHoming reports.
const BOND_MODES = {
    'active-backup': 'Active-Backup',   // one link carries traffic, the other waits — works to two switches
    '802.3ad': 'LACP (802.3ad)'         // both links carry traffic — needs one switch, or MLAG/stacking
};
const isBond = (iface) => !!(iface && iface.bond);
const bondOf = (node, ifaceId) =>
    (node?.interfaces || []).find((i) => isBond(i) && (i.bond.members || []).includes(ifaceId)) || null;
const isBondMember = (node, ifaceId) => !!bondOf(node, ifaceId);
const bondMembers = (node, bond) => (bond?.bond?.members || []).map((id) => ifaceOn(node, id)).filter(Boolean);
// The interface whose address applies to a cable landing here: a member defers
// to its bond, everything else speaks for itself.
const l3IfaceFor = (node, ifaceId) => bondOf(node, ifaceId) || ifaceOn(node, ifaceId);

// Fold every free wired NIC on `node` into one bond. This is the remedy the
// MAC-flapping diagnostic names, so it has to move the address off the members
// and onto the bond — leaving it behind is the misconfiguration, not the fix.
function createBond(node, opts = {}) {
    if (!node) return null;
    const candidates = getInterfaces(node).filter(
        (i) => !i.implicit && !isBond(i) && !isBondMember(node, i.id) && !ifaceIsWireless(i));
    if (candidates.length < 2) return null;

    const donor = candidates.find((i) => parseValidCIDR(i.ip)) || candidates[0];
    const bond = {
        id: nextId('b'),
        name: opts.name || `bond${(node.interfaces || []).filter(isBond).length}`,
        ip: donor.ip || '',
        drawZone: donor.drawZone,
        bond: { mode: opts.mode || 'active-backup', members: candidates.map((i) => i.id) }
    };
    candidates.forEach((i) => {
        const real = (node.interfaces || []).find((x) => x.id === i.id);
        if (real) { real.ip = ''; delete real.drawZone; }
    });
    node.interfaces.push(bond);
    return bond;
}

// Dissolve a bond, handing its address back to the first member so the node does
// not silently lose its L3 identity. If the bond has already been emptied, fall
// back to any plain NIC rather than bin the address: losing a node's only
// address is the one outcome this function exists to prevent, so it should not
// depend on the caller unlisting members in the right order.
function removeBond(node, bondId) {
    const bond = (node?.interfaces || []).find((i) => i.id === bondId && isBond(i));
    if (!bond) return false;
    const heir = bondMembers(node, bond)[0]
        || getInterfaces(node).find((i) => !isBond(i) && !i.implicit && !parseValidCIDR(i.ip));
    if (heir) {
        const real = node.interfaces.find((x) => x.id === heir.id);
        if (real) { real.ip = bond.ip || ''; if (bond.drawZone !== undefined) real.drawZone = bond.drawZone; }
    }
    node.interfaces = node.interfaces.filter((i) => i.id !== bondId);
    return true;
}

// Deleting a NIC takes its cables with it: a cable into a socket that no longer
// exists is not a cable. Node deletion already drops attached links this way.
// Without it the link keeps a dangling interface id, and the node badges red
// over a NIC the sidebar can no longer show you.
function deleteIface(node, ifaceId) {
    if (!node) return;
    const bond = bondOf(node, ifaceId);
    if (bond) {
        bond.bond.members = (bond.bond.members || []).filter((id) => id !== ifaceId);
        if (!bond.bond.members.length) removeBond(node, bond.id);
    }
    state.links = state.links.filter((l) => !(
        (l.source === node.id && l.sourceIface === ifaceId) ||
        (l.target === node.id && l.targetIface === ifaceId)));
    node.interfaces = (node.interfaces || []).filter((i) => i.id !== ifaceId);
}

// Which interface a link lands on at a given node.
const ifaceKeyFor = (link, nodeId) => (link.source === nodeId ? 'sourceIface' : 'targetIface');
const ifaceIdOn = (link, nodeId) => link[ifaceKeyFor(link, nodeId)] || null;

// What an unlabelled link touching an AP most likely is. An AP uplinks to
// infrastructure by cable (often PoE) and serves endpoints by radio; two APs
// are a mesh backhaul.
function apMediumGuess(src, tgt) {
    const ap = src.type === 'ap' ? src : tgt.type === 'ap' ? tgt : null;
    if (!ap) return 'utp';
    const other = ap === src ? tgt : src;
    if (other.type === 'ap') return 'wireless';
    if (other.type === 'switch' || isRoutingDevice(other.type)) return 'utp';
    return 'wireless';
}

// Cheap lookup that skips implicit faceplate ports — they are never radios.
const explicitIface = (node, ifaceId) => (node?.interfaces || []).find((i) => i.id === ifaceId) || null;

function effectiveMedium(link, src, tgt) {
    if (link.medium) return link.medium;
    src = src || getNode(link.source);
    tgt = tgt || getNode(link.target);
    if (!src || !tgt) return 'utp';
    // A link landing on a radio is wireless whatever the node types suggest.
    if (ifaceIsWireless(explicitIface(src, link.sourceIface)) || ifaceIsWireless(explicitIface(tgt, link.targetIface))) return 'wireless';
    return apMediumGuess(src, tgt);
}

// A cable owns its port; a radio, a tunnel and a bridge do not.
function isExclusiveLink(link) {
    const medium = effectiveMedium(link);
    if (medium === 'wireless' || medium === 'vpn') return false;
    return link.attachment !== 'bridged';
}

const linksAtNode = (nodeId) => state.links.filter((l) => l.source === nodeId || l.target === nodeId);
const linkOnIface = (nodeId, ifaceId) => linksAtNode(nodeId).find((l) => ifaceIdOn(l, nodeId) === ifaceId) || null;

function ifaceIsOccupied(nodeId, ifaceId, excludeLinkId) {
    return linksAtNode(nodeId).some((l) => l.id !== excludeLinkId && ifaceIdOn(l, nodeId) === ifaceId && isExclusiveLink(l));
}

// Pick the interface on `node` that should carry a link to `otherNode`.
//
// On a routing device, subnet agreement outranks availability: a router drawn
// with several hosts on one interface is shorthand for an unmodelled switch,
// and binding those cables to a free-but-wrong-subnet NIC would be a worse lie
// than sharing the right one. On a host, an interface is a physical socket, so
// a free NIC outranks the right subnet — a second cable means a second NIC.
function autoPickIface(node, otherNode, opts = {}) {
    // Kind comes first and is non-negotiable: a Wi-Fi association belongs on a
    // radio and a cable belongs on a socket, whatever the addressing says.
    const wantWireless = opts.medium === 'wireless';
    // A bond is not a socket: it has no faceplate, so a cable cannot land on it.
    // Its members are the real NICs, and they stay pickable.
    const interfaces = getInterfaces(node).filter((i) => !isBond(i) && ifaceIsWireless(i) === wantWireless);
    if (!interfaces.length) return createIfaceFor(node, { grow: true, wireless: wantWireless }).id;

    const isFree = (i) => !ifaceIsOccupied(node.id, i.id, opts.excludeLinkId);
    const otherNets = new Set(getValidIps(otherNode).map((i) => i.networkStr));
    const onOtherSubnet = (i) => {
        // A member holds no address of its own; ask the bond it answers to.
        const parsed = parseValidCIDR((l3IfaceFor(node, i.id) || i).ip);
        return parsed && otherNets.has(parsed.networkStr);
    };

    const matching = interfaces.filter(onOtherSubnet);
    const match = matching.find(isFree) || (isRoutingDevice(node.type) ? matching[0] : null);
    if (match) return match.id;

    const free = interfaces.filter(isFree);
    const bare = free.find((i) => !i.ip || !i.ip.trim());
    if (bare) return bare.id;
    if (free.length) return free[0].id;

    return createIfaceFor(node, { grow: true, wireless: wantWireless }).id;
}

// Bind both ends of a link, skipping ends that are already bound.
function bindLink(link) {
    const src = getNode(link.source), tgt = getNode(link.target);
    if (!src || !tgt) return link;
    const medium = effectiveMedium(link, src, tgt);
    if (!link.sourceIface) link.sourceIface = autoPickIface(src, tgt, { excludeLinkId: link.id, medium });
    if (!link.targetIface) link.targetIface = autoPickIface(tgt, src, { excludeLinkId: link.id, medium });
    return link;
}

// Migration: a single-NIC device associated to an AP by radio has a wireless NIC
// whatever the seed data called it. Rename rather than invent a second interface,
// so the address stays on the interface that actually carries the traffic. Only
// touches default kernel-style wired names, never one the user chose.
function reconcileWirelessNames() {
    state.nodes.forEach((node) => {
        if (hasPortGrid(node) || isRoutingDevice(node.type)) return;
        const interfaces = node.interfaces || [];
        if (interfaces.length !== 1) return;
        const only = interfaces[0];
        if (ifaceIsWireless(only) || !WIRED_DEFAULT_RE.test(only.name || '')) return;

        const links = linksAtNode(node.id);
        if (links.length !== 1 || effectiveMedium(links[0]) !== 'wireless') return;
        only.name = 'wlan0';
    });
}

// Migration for diagrams drawn before links carried interface refs.
function autoBindLinks() {
    reconcileWirelessNames();
    state.links.forEach(bindLink);
}

// ---- Link geometry ----
// Redundant cables between the same pair would stack into one invisible line,
// so parallel runs bow apart. Shared by the renderer and the drag handler so a
// bowed link keeps its shape while you move its endpoints.
const PARALLEL_BOW = 34;

// Trace-flow animation per medium; see the keyframes in <style>. FLOW_DASH mirrors
// each class's stroke-dasharray as an attribute: exported SVG/PNG carries no
// stylesheet, so without it a traced link rasterises as a plain solid line.
const FLOW_CLASS = { utp: 'flow-utp', fiber: 'flow-fiber', wireless: 'flow-wireless', powerline: 'flow-powerline', vpn: 'flow-vpn' };
const FLOW_DASH = { utp: '7 5', fiber: '22 8', wireless: 'none', powerline: '9 3 2 3 2 3', vpn: '12 4 2 4' };

// One ")))" wave repeat, and its measured width in px (filled on first use).
const WAVE_UNIT = ')  ';
let waveAdvance = 0;

function linkGeometry(link) {
    const src = getNode(link.source), tgt = getNode(link.target);
    if (!src || !tgt) return null;

    const siblings = state.links
        .filter((l) => (l.source === link.source && l.target === link.target) || (l.source === link.target && l.target === link.source))
        .map((l) => l.id);
    const rank = siblings.indexOf(link.id);
    // Fan symmetrically around the straight path, so a lone link stays straight.
    const bow = siblings.length > 1 ? (rank - (siblings.length - 1) / 2) * PARALLEL_BOW : 0;

    const dx = tgt.x - src.x, dy = tgt.y - src.y;
    const len = Math.hypot(dx, dy) || 1;
    const ctrl = { x: (src.x + tgt.x) / 2 + (-dy / len) * bow, y: (src.y + tgt.y) / 2 + (dx / len) * bow };

    return {
        src, tgt, ctrl, bow,
        // With ctrl at the midpoint this reduces to the straight-line point,
        // so labels use one formula either way.
        pointAt: (t) => ({
            x: (1 - t) * (1 - t) * src.x + 2 * (1 - t) * t * ctrl.x + t * t * tgt.x,
            y: (1 - t) * (1 - t) * src.y + 2 * (1 - t) * t * ctrl.y + t * t * tgt.y
        })
    };
}

function applyLinkGeometry(el, geo) {
    el.setAttribute('d', `M ${geo.src.x} ${geo.src.y} Q ${geo.ctrl.x} ${geo.ctrl.y} ${geo.tgt.x} ${geo.tgt.y}`);
}

// ---- L2 topology analysis ----

// Broadcast domain reachable from a node by hopping dumb switches/APs and
// VM passthrough links. Mirrors getL2Domain() inside calculateReachability(),
// but callable from diagnostics.
function l2DomainOf(originId) {
    const nodes = new Set([originId]), queue = [originId], seen = new Set();
    while (queue.length) {
        const currentId = queue.shift();
        if (seen.has(currentId)) continue;
        seen.add(currentId);

        linksAtNode(currentId).forEach((link) => {
            if (effectiveMedium(link) === 'vpn') return; // overlay, not physical adjacency
            const nextNodeId = link.source === currentId ? link.target : link.source;
            const next = getNode(nextNodeId);
            if (!next) return;
            if (isDumbDevice(next) || link.attachment === 'passthrough') {
                if (!nodes.has(nextNodeId)) { nodes.add(nextNodeId); queue.push(nextNodeId); }
            }
        });
    }
    return nodes;
}

// Canonical id for the broadcast segment a link drops into, seen from one end.
// Through a dumb switch it is the whole switched fabric (so two NICs landing on
// trunked switches share a key); on a direct cable it is just that cable.
function segmentKeyOf(link, fromNodeId) {
    const otherId = link.source === fromNodeId ? link.target : link.source;
    const other = getNode(otherId);
    if (!other || !isDumbDevice(other)) return `link:${link.id}`;
    return `seg:${[...l2DomainOf(otherId)].sort().join(',')}`;
}


function isPrivateIP(ipObj) {
    if (ipObj.kind() !== 'ipv4') return false;
    const octets = ipObj.octets;
    if (octets[0] === 10) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    return false;
}

function cloneData(data) { return JSON.parse(JSON.stringify(data)); }

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function getNode(id) { return state.nodes.find((n) => n.id === id) || null; }
function getLink(id) { return state.links.find((l) => l.id === id) || null; }

function findNodeByIp(ipString) {
    const clean = String(ipString || '').trim();
    if (!clean) return null;

    try {
        const targetIp = ipaddr.parse(clean).toString();
        return state.nodes.find((node) =>
            getValidIps(node).some((ipData) => ipData.ip.toString() === targetIp)
        ) || null;
    } catch (e) {
        return null;
    }
}

function parseDnsList(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function getValidIps(node) {
    if (!node || !node.interfaces) return [];
    return node.interfaces.map(iface => parseValidCIDR(iface.ip)).filter(Boolean);
}

function parseValidCIDR(cidrStr) {
    try {
        if (!cidrStr || !cidrStr.includes('/')) return null;
        const [ipStr, prefixStr] = cidrStr.split('/');
        const prefix = Number.parseInt(prefixStr, 10);
        const ip = ipaddr.parse(ipStr.trim());
        if (Number.isNaN(prefix)) return null;
        if (ip.kind() === 'ipv4' && (prefix < 0 || prefix > 32)) return null;
        if (ip.kind() === 'ipv6' && (prefix < 0 || prefix > 128)) return null;
        const cidrObj = ipaddr.parseCIDR(`${ip.toString()}/${prefix}`);
        let networkStr = `${ip.toString()}/${prefix}`;
        if (ip.kind() === 'ipv4') {
            const octets = ip.octets;
            const ipNum = ((octets[0] << 24) >>> 0) | (octets[1] << 16) | (octets[2] << 8) | octets[3];
            const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
            const netNum = (ipNum & mask) >>> 0;
            networkStr = `${[(netNum >>> 24) & 255, (netNum >>> 16) & 255, (netNum >>> 8) & 255, netNum & 255].join('.')}/${prefix}`;
        }
        return { ip, prefix, kind: ip.kind(), cidrObj, networkStr, isPrivate: isPrivateIP(ip) };
    } catch (e) { return null; }
}

function normalizePortToken(token) {
    const aliases = {
        http: '80',
        https: '443',
        ssh: '22',
        dns: '53',
        rdp: '3389',
        smb: '445',
        ldap: '389',
        ldaps: '636',
        mysql: '3306',
        postgres: '5432',
        postgresql: '5432',
        dicom: '104',
        dicomweb: '443',
        pacs: '11112',
        hl7: '2575',
        mqtt: '1883',
        rtsp: '554',
        ipp: '631',
        jetdirect: '9100'
    };

    let raw = String(token || '').trim().toLowerCase();
    if (!raw) return [];

    let proto = null;

    if (raw.includes('/')) {
        const parts = raw.split('/');
        if (parts.length === 2) {
            proto = parts[0].trim();
            raw = parts[1].trim();
        }
    }

    if (aliases[raw]) raw = aliases[raw];

    // Special case: DICOM commonly uses both 104 and 11112.
    if (String(token || '').trim().toLowerCase() === 'dicom') {
        return [
            { proto, start: 104, end: 104, label: '104' },
            { proto, start: 11112, end: 11112, label: '11112' }
        ];
    }

    if (raw.includes('-')) {
        const [startRaw, endRaw] = raw.split('-');
        const start = Number.parseInt(startRaw, 10);
        const end = Number.parseInt(endRaw, 10);

        if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start && end <= 65535) {
            return [{ proto, start, end, label: `${start}-${end}` }];
        }
    }

    const port = Number.parseInt(raw, 10);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
        return [{ proto, start: port, end: port, label: String(port) }];
    }

    return [];
}

function parsePortExpression(value) {
    return String(value || '')
        .split(',')
        .map((token) => normalizePortToken(token))
        .flat();
}

function portEntriesMatch(queryEntry, allowedEntry) {
    if (!queryEntry || !allowedEntry) return false;

    if (queryEntry.proto && allowedEntry.proto && queryEntry.proto !== allowedEntry.proto) {
        return false;
    }

    return queryEntry.start >= allowedEntry.start && queryEntry.start <= allowedEntry.end;
}

function acceptsPort(node, portQuery) {
    return getPortStatus(node, portQuery).ok;
}

function getPortStatus(node, portQuery) {
    const query = String(portQuery || '').trim();

    if (!query) {
        return {
            ok: true,
            level: 'info',
            text: 'No trace port requested.'
        };
    }

    const queryPorts = parsePortExpression(query);

    if (!queryPorts.length) {
        return {
            ok: false,
            level: 'bad',
            text: `Invalid trace port: ${query}`
        };
    }

    if (!node || isDumbDevice(node) || isRoutingDevice(node.type)) {
        return {
            ok: true,
            level: 'info',
            text: 'Transit device; service port is not evaluated as an endpoint.'
        };
    }

    if (!node.ports || node.ports.trim() === '') {
        return {
            ok: true,
            level: 'warn',
            text: 'No allowed ports defined; treating as open.'
        };
    }

    const allowedPorts = parsePortExpression(node.ports);

    if (!allowedPorts.length) {
        return {
            ok: false,
            level: 'bad',
            text: `Allowed Ports field is invalid: ${node.ports}`
        };
    }

    const match = queryPorts.some((queryEntry) =>
        allowedPorts.some((allowedEntry) => portEntriesMatch(queryEntry, allowedEntry))
    );

    return {
        ok: match,
        level: match ? 'good' : 'bad',
        text: match
            ? `Port ${query} is allowed by this node.`
            : `Port ${query} is not listed in this node's Allowed Ports.`
    };
}
