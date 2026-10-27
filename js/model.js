// The engine: interfaces/ports, link geometry, L2 analysis, parsing.
// No DOM.
// Load order: state -> model -> data -> diagnostics -> ui -> app

const GRID_SNAP = 20;

// The open read-only lookup pass, or null. See withLookupPass() below.
let lookupPass = null;
const NO_LINKS = Object.freeze([]);

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
//
// Two kinds of count, and they behave differently when one more cable arrives:
//   - Explicit (node.portCount is a number: typed into the faceplate field, or
//     stored by a template or an older build). It describes real hardware, so
//     it is never grown behind the user's back. A 33rd cable on a 32-port
//     switch is still accepted, because Topo documents networks as they are,
//     and it lands on a port past the faceplate, which evaluatePorts() reports
//     as a finding.
//   - Implicit (no portCount: a switch dropped from the palette). Nobody has
//     said how big it is yet, so it is the default size or as many ports as
//     are in use, whichever is larger. It grows by being plugged into, and
//     stores nothing, so it stays implicit and keeps growing.
// Growing used to store the grown number, which turned an implicit count into
// an explicit one and made every count silently elastic.
const DEFAULT_PORT_COUNT = { switch: 8, ap: 1 };
const hasPortGrid = (node) => !!node && (node.type === 'switch' || node.type === 'ap');
const hasExplicitPortCount = (node) => Number.isFinite(node?.portCount);
const portCountOf = (node) => hasExplicitPortCount(node) ? node.portCount
    : Math.max(DEFAULT_PORT_COUNT[node?.type] ?? 0, hasPortGrid(node) ? highestPortInUse(node) : 0);

// The highest faceplate port anything sits on: a cable bound to pN, or a port
// materialized into node.interfaces because it was given a name or an address.
function highestPortInUse(node) {
    let max = 0;
    const take = (id) => { const m = /^p(\d+)$/.exec(id || ''); if (m) max = Math.max(max, Number(m[1])); };
    (node.interfaces || []).forEach((i) => take(i.id));
    (lookupPass ? linksAtNode(node.id) : (state.links || [])).forEach((l) => {
        if (l.source === node.id) take(l.sourceIface);
        if (l.target === node.id) take(l.targetIface);
    });
    return max;
}

// Wirelessness is a property of the interface, not the node: an AP uplinks to a
// switch by cable and serves clients by radio. Names follow the kernel's
// conventions — wl* covers wlan0/wlp1s0/wlo1, plus the older ath*/ra*.
const WIRELESS_NAME_RE = /^(wl|wifi|wi-fi|ath|ra\d)/i;
// Default wired names only: a deliberately named interface is left alone.
const WIRED_DEFAULT_RE = /^(eth|eno|enp|ens|enx|em|igb|ix|bge|re)\d/i;

// Explicit flag wins, else infer from the name — the same tri-state as a
// network's drawZone.
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
    // Once, not in the loop condition: an implicit count scans every link
    // (highestPortInUse), and this runs for every ifaceOn() on every render.
    const total = portCountOf(node);
    for (let p = 1; p <= total; p++) {
        const id = `p${p}`;
        // A port materialized with no name of its own (or its bare number)
        // still answers to the switch's naming scheme (portNameOf).
        const own = byId.get(id);
        out.push(own ? (own.name && own.name !== String(p) ? own : { ...own, name: portNameOf(node, p) })
            : { id, name: portNameOf(node, p), ip: '', implicit: true });
        byId.delete(id);
    }
    byId.forEach((i) => out.push(i)); // extras (mgmt VLAN) sit after the faceplate
    return out;
}

function ifaceOn(node, ifaceId) { return getInterfaces(node).find((i) => i.id === ifaceId) || null; }
// A cable past an explicit faceplate (port overflow) sits on a pN that
// getInterfaces() does not list; it is still a numbered socket, so it reads
// "33" like every other port rather than leaking its id "p33".
function ifaceLabel(node, ifaceId) {
    const own = ifaceOn(node, ifaceId)?.name;
    if (own) return own;
    const port = hasPortGrid(node) && /^p(\d+)$/.exec(ifaceId || '');
    return port ? portNameOf(node, Number(port[1])) : ifaceId || '—';
}

// ---- Port names, labels and access VLANs (plan section 4, document v6) ----
// A port is stored by its position, pN, and that never changes: a cable
// names p12 whatever the box calls it. What the box calls it is the scheme,
// node.portScheme { prefix, start }: "Gi1/0/" from 1 reads p12 as Gi1/0/12,
// "ge-0/0/" from 0 reads it as ge-0/0/11. No scheme reads as the bare number,
// as every port did before. Only the name changes, so a switch renamed this
// way keeps every cable on the port it was on.
//
// What is written on or about one port is node.portAttrs, sparse, keyed by
// pN: { label, vlan }. The label is the jack or the desk at the other end of
// the run ("Reception 2", "PP-A:12"); the VLAN is the port's access VLAN, a
// fact for the register and the report. Trunks, tagged VLANs and PoE are not
// modelled, and nothing splits the L2 analysis by VLAN (plan, "Cut"): a
// port's VLAN is what the technician wrote down, not something Topo reasons
// with. A port nobody said anything about has no entry, so a 48-port switch
// with three labels carries three.
const PORT_ID_RE = /^p([1-9]\d{0,3})$/;
const PORT_PREFIX_MAX = 32;
// One line, control characters out: it is printed on a report and a label.
const portText = (v) => asText(v).replace(/[\u0000-\u001f\u007f]+/g, ' ');
// A prefix may not end in a digit. The name is prefix + number, so "Port 0"
// counted from 1 would print "Port 01", and that text reads back as "Port "
// counted from 1: devices.csv's first_port would not survive its own round
// trip, and nothing can tell the two apart. Where a box really names its
// ports with a padded number, the scheme cannot say so (README, "Ports").
const portPrefixOk = (prefix) => !/\d$/.test(String(prefix == null ? '' : prefix));
function normalizePortScheme(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const prefix = portText(v.prefix).replace(/^\s+/, '').slice(0, PORT_PREFIX_MAX);
    // Only a hand-edited file gets here with one (both editors refuse it):
    // the scheme is dropped rather than guessed at, so the ports read by
    // their numbers, and the page says nothing it cannot write back.
    if (!portPrefixOk(prefix)) return undefined;
    const n = typeof v.start === 'string' && /^\s*\d+\s*$/.test(v.start) ? Number(v.start) : v.start;
    const start = Number.isInteger(n) && n >= 0 && n <= 9999 ? n : 1;
    // The default scheme is no scheme: nothing to store.
    return prefix || start !== 1 ? { prefix, start } : undefined;
}
function normalizePortAttrs(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    Object.keys(v).filter((k) => PORT_ID_RE.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).forEach((k) => {
        const a = v[k];
        if (!a || typeof a !== 'object' || Array.isArray(a)) return;
        const rec = {};
        const label = portText(a.label).trim().slice(0, 64);
        if (label) rec.label = label;
        const vlan = asVlan(a.vlan);
        if (vlan !== undefined) rec.vlan = vlan;
        if (Object.keys(rec).length) out[k] = rec;
    });
    return Object.keys(out).length ? out : undefined;
}
// Port n (its 1-based position) as the box names it.
function portNameOf(node, n) {
    const s = node && node.portScheme;
    if (!s || typeof s !== 'object') return String(n);
    const start = Number.isInteger(s.start) ? s.start : 1;
    return (typeof s.prefix === 'string' ? s.prefix : '') + String(start + n - 1);
}
// What is written about one port: { label: '', vlan: null } when nothing is.
function portAttrOf(node, portId) {
    const own = node && node.portAttrs && PORT_ID_RE.test(portId || '') && Object.prototype.hasOwnProperty.call(node.portAttrs, portId);
    const a = own ? node.portAttrs[portId] : null;
    const vlan = a ? asVlan(a.vlan) : undefined;
    return { label: a && typeof a.label === 'string' ? a.label : '', vlan: vlan === undefined ? null : vlan };
}
const hasPortAttrs = (node, portId) => { const a = portAttrOf(node, portId); return !!a.label || a.vlan !== null; };
// Sets (or, with a blank value, clears) one fact of one port; the entry, and
// then the whole map, go when they end up saying nothing.
function setPortAttr(node, portId, key, value) {
    if (!node || !PORT_ID_RE.test(portId || '') || (key !== 'label' && key !== 'vlan')) return node;
    const next = Object.assign({}, node.portAttrs || {});
    next[portId] = Object.assign({}, next[portId] || {}, { [key]: value });
    const norm = normalizePortAttrs(next);
    if (norm) node.portAttrs = norm; else delete node.portAttrs;
    return node;
}
// The port a person or a sheet names: the scheme's name ("Gi1/0/12"), a bare
// number ("12") or a plain "port 12", counted from the scheme's first number.
// -> 'pN' | null.
//
// Once a box has a prefix, whatever stands before the number has to be that
// prefix (or a plain word for "port"). Reading only the trailing number would
// put a stacked switch's "Gi2/0/5" on this member's Gi1/0/5 without a word;
// refusing it lets the sheet's review say so. A box with no prefix reads any
// name by its number, as it always did ("Gi1/0/12" is port 12).
const PORT_WORD_RE = /^(?:ports?|p|puerto|porta|порт|ポート)?\s*[#.:-]?$/i;
const portTextKey = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
function portIdByText(node, text) {
    const v = String(text == null ? '' : text).trim();
    if (!v || !hasPortGrid(node)) return null;
    const m = /(\d+)\s*$/.exec(v);
    if (!m) return null;
    const s = node.portScheme;
    const start = s && Number.isInteger(s.start) ? s.start : 1;
    const prefix = s && typeof s.prefix === 'string' ? s.prefix : '';
    const rest = v.slice(0, m.index).trim();
    if (prefix.trim() && rest && !PORT_WORD_RE.test(rest) && portTextKey(rest) !== portTextKey(prefix)) return null;
    const n = Number(m[1]) - start + 1;
    return Number.isInteger(n) && n >= 1 && n <= 9999 ? 'p' + n : null;
}
// Every faceplate port worth listing, in port order: the faceplate itself,
// then any port past it that a cable sits on or that something is written
// about (a count lowered under a labelled port keeps the label in view).
function faceplatePortIds(node) {
    if (!hasPortGrid(node)) return [];
    const total = portCountOf(node);
    const extra = new Set();
    const take = (id) => { const m = PORT_ID_RE.exec(id || ''); if (m && Number(m[1]) > total) extra.add(Number(m[1])); };
    linksAtNode(node.id).forEach((l) => take(ifaceIdOn(l, node.id)));
    Object.keys(node.portAttrs || {}).forEach(take);
    const out = [];
    for (let p = 1; p <= total; p++) out.push('p' + p);
    [...extra].sort((a, b) => a - b).forEach((p) => out.push('p' + p));
    return out;
}

// Give a node somewhere to plug a link in. opts.wireless yields a radio, since a
// Wi-Fi association cannot land on a socket. Otherwise opts.grow gains a switch a
// faceplate port, and everything else gains an addressed NIC — a switch's
// management VLAN is a NIC, not a port.
//
// On a switch the port handed back is the next one past everything in use. An
// explicit count is only raised when opts.user says a person asked for the port
// ("+ Port"); auto-binding a cable never raises it (see DEFAULT_PORT_COUNT).
function createIfaceFor(node, opts = {}) {
    node.interfaces = node.interfaces || [];
    const taken = new Set(node.interfaces.map((i) => i.name));
    const nextName = (stem) => { let n = 0; while (taken.has(`${stem}${n}`)) n++; return `${stem}${n}`; };

    if (opts.wireless) {
        const radio = { id: nextId('i'), name: nextName('wlan'), ip: '' };
        node.interfaces.push(radio);
        if (lookupPass) lookupPass.ifx.delete(node);
        return radio;
    }
    if (opts.grow && hasPortGrid(node)) {
        const next = Math.max(portCountOf(node), highestPortInUse(node)) + 1;
        if (hasExplicitPortCount(node) && opts.user) node.portCount = next;
        return { id: `p${next}`, name: portNameOf(node, next), ip: '', implicit: true };
    }
    const iface = { id: nextId('i'), name: nextName('eth'), ip: '', mac: '' };
    node.interfaces.push(iface);
    if (lookupPass) lookupPass.ifx.delete(node);
    return iface;
}

// ---- MAC addresses ----
// Topo has always TALKED about MACs — the flapping diagnostic, the bond's "one
// MAC, one address" — while inferring all of it from IP co-location. An
// interface can now hold the real address, which makes two things checkable
// that inference never could: who the vendor is, and whether the same address
// appears twice on the drawing.
const normMac = (v) => String(v || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
const hasMac = (iface) => normMac(iface && iface.mac).length === 12;

// Every (node, iface) holding a given address. A duplicate is a fact about the
// whole map, not about either interface, so this is keyed across all nodes.
function macIndex(nodes) {
    const seen = new Map();
    (nodes || []).forEach((n) => (n.interfaces || []).forEach((i) => {
        if (!hasMac(i)) return;
        const k = normMac(i.mac);
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k).push({ node: n, iface: i });
    }));
    return seen;
}
// Broadcast and multicast addresses are SUPPOSED to repeat — an interface
// configured with one is its own error, reported separately, and counting it as
// a duplicate would bury the real ones.
function duplicateMacs(nodes) {
    const out = [];
    macIndex(nodes).forEach((holders, hex) => {
        if (holders.length < 2) return;
        if (parseInt(hex.slice(0, 2), 16) & 0x01) return;
        out.push({ hex, holders });
    });
    return out;
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
        bond: { mode: opts.mode || 'active-backup', members: candidates.map((i) => i.id) }
    };
    candidates.forEach((i) => {
        const real = (node.interfaces || []).find((x) => x.id === i.id);
        if (real) real.ip = '';
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
        if (real) real.ip = bond.ip || '';
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
// Inside a lookup pass, indexed once per node: every cable's medium asks it,
// and a node with a NIC per cable made that a walk per cable per cable.
// createIfaceFor() drops the index of a node it adds to.
const explicitIface = (node, ifaceId) => {
    if (!node) return null;
    if (lookupPass) {
        let ix = lookupPass.ifx.get(node);
        if (!ix) {
            ix = new Map();
            (node.interfaces || []).forEach((i) => { if (!ix.has(i.id)) ix.set(i.id, i); });   // find() returns the first
            lookupPass.ifx.set(node, ix);
        }
        return ix.get(ifaceId) || null;
    }
    return (node.interfaces || []).find((i) => i.id === ifaceId) || null;
};

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

// In a pass the indexed list itself, not a copy: callers filter and iterate
// it, none of them changes it.
const linksAtNode = (nodeId) => lookupPass ? (lookupPass.at.get(nodeId) || NO_LINKS)
    : state.links.filter((l) => l.source === nodeId || l.target === nodeId);
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

    // ifaceIsOccupied() for every interface, read off the node's cables once:
    // asked per interface it walked every cable per interface, so a node
    // that gains a NIC per cable (a sheet hanging 1000 devices off one
    // custom box, js/csv.js) bound its cables in cubic time.
    const busy = new Set();
    linksAtNode(node.id).forEach((l) => { if (l.id !== opts.excludeLinkId && isExclusiveLink(l)) busy.add(ifaceIdOn(l, node.id)); });
    const isFree = (i) => !busy.has(i.id);
    const otherNets = new Set(getValidIps(otherNode).map((i) => i.networkStr));
    // l3IfaceFor() for each interface, from one walk of the bonds: asked per
    // interface it listed every interface per interface (the same cubic bind).
    const bondFor = new Map();
    (node.interfaces || []).forEach((b) => { if (isBond(b)) (b.bond.members || []).forEach((m) => { if (!bondFor.has(m)) bondFor.set(m, b); }); });
    const onOtherSubnet = (i) => {
        // A member holds no address of its own; ask the bond it answers to.
        const parsed = parseValidCIDR((bondFor.get(i.id) || i).ip);
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

// A single-NIC device associated to an AP by radio has a wireless NIC whatever
// the seed data called it. Rename rather than invent a second interface, so the
// address stays on the interface that actually carries the traffic. Only
// touches default kernel-style wired names, never one the user chose.
//
// This and autoBindLinks() below used to run on every load, every undo and
// every withDoc(), guessing from the document's shape each time — so a NIC the
// user had deliberately named eth0 on a radio link was renamed wlan0 again on
// the next reload. They are now the v1 -> v2 step of MIGRATIONS (end of this
// file), which runs once per old document, plus construction: a stamped block
// binds its own new cables (insertBlock, js/add.js), and `nodeIds` limits the rename to
// the nodes it just placed.
function reconcileWirelessNames(nodeIds) {
    state.nodes.forEach((node) => {
        if (nodeIds && !nodeIds.has(node.id)) return;
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

// Bind every cable that names no interface — diagrams drawn before links
// carried interface refs. With `nodeIds`, only those nodes are renamed and only
// the cables touching them are bound.
function autoBindLinks(nodeIds) {
    reconcileWirelessNames(nodeIds);
    state.links.forEach((l) => { if (!nodeIds || nodeIds.has(l.source) || nodeIds.has(l.target)) bindLink(l); });
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

    const siblings = linkSiblings(link);
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

// The ids of every cable between the same two devices, either way round, in
// document order (their rank is their place in the fan). Asked for every
// cable on every redraw and every drag step: a scan of all cables each time
// made a redraw quadratic in cables. Inside a lookup pass the pairs are
// indexed once, on first use, so a pass that never draws pays nothing.
const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
function linkSiblings(link) {
    if (lookupPass) {
        if (!lookupPass.pairs) {
            const pairs = new Map();
            state.links.forEach((l) => {
                const k = pairKey(l.source, l.target);
                if (pairs.has(k)) pairs.get(k).push(l.id); else pairs.set(k, [l.id]);
            });
            lookupPass.pairs = pairs;
        }
        return lookupPass.pairs.get(pairKey(link.source, link.target)) || [link.id];
    }
    return state.links
        .filter((l) => (l.source === link.source && l.target === link.target) || (l.source === link.target && l.target === link.source))
        .map((l) => l.id);
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

// ---- Read-only lookup pass ----
// The findings engine (js/diagnostics.js) runs every check on every device,
// and each check asks the same questions over and over: which node has this
// id, which links touch it, what does this "ip/prefix" parse to. Unindexed,
// a 500-device map made that quadratic per reachability walk. A pass builds
// the indexes once and the lookups below consult them while it is open.
//
// Only valid while nothing changes the document, which is why the engine is
// the only thing that opens one: it reads and never writes. Every call builds
// its own indexes, even inside another pass, because a nested call may be
// reading a different document (diagnoseDoc() on a scratch copy); the finally
// puts the outer pass back, so a throwing check cannot leave stale indexes
// behind for the editor. (lookupPass itself is declared at the top of this
// file, ahead of the helpers that read it.)
function withLookupPass(fn) {
    const outer = lookupPass;
    const byId = new Map();
    state.nodes.forEach((n) => { if (!byId.has(n.id)) byId.set(n.id, n); }); // find() returns the first
    const at = new Map();
    const touch = (id, l) => { if (!at.has(id)) at.set(id, []); at.get(id).push(l); };
    state.links.forEach((l) => { touch(l.source, l); if (l.target !== l.source) touch(l.target, l); });
    // nets: the declared networks, parsed and ordered most specific first
    // (networkTable); eff: each device's effective gateway and DNS. Both are
    // asked on every step of every reachability walk (isGatewayOf, natInfo).
    // pairs: the cables between each two devices (linkSiblings), built on
    // first use. diag: the document's diagnosis (currentDiagnosis, in
    // js/diagnostics.js), whose memo key serializes the whole document, so
    // it is asked once per pass rather than once per row or badge.
    lookupPass = { byId, at, cidr: new Map(), ips: new Map(), nets: null, eff: new Map(), ifx: new Map(), pairs: null, diag: null };
    try { return fn(); } finally { lookupPass = outer; }
}
// The one write a pass may outlive: binding new cables (js/csv.js, csvWrite).
// A cable pushed while the pass is open is entered here, so `at` stays true;
// binding only ever adds blank interfaces (no address, no gateway), so the
// address, network and gateway memos stay true as well. The two that a new
// cable does change, the pairs and the diagnosis, are dropped to be rebuilt
// if asked. Anything else that writes closes the pass first.
function lookupPassAddLink(l) {
    if (!lookupPass) return;
    lookupPass.pairs = null;
    lookupPass.diag = null;
    const touch = (id) => { const list = lookupPass.at.get(id); if (list) list.push(l); else lookupPass.at.set(id, [l]); };
    touch(l.source);
    if (l.target !== l.source) touch(l.target);
}

function getNode(id) {
    if (lookupPass) return lookupPass.byId.get(id) || null;
    return state.nodes.find((n) => n.id === id) || null;
}
function getLink(id) { return state.links.find((l) => l.id === id) || null; }

function findNodeByIp(ipString) {
    const clean = String(ipString || '').trim();
    if (!clean) return null;

    try {
        const targetIp = ipaddr.parse(clean).toString();
        const holders = state.nodes.filter((node) =>
            getValidIps(node).some((ipData) => ipData.ip.toString() === targetIp));
        // A retired device hands its address back (STATUS_VALUES): when its
        // replacement holds the same one, the replacement is who answers,
        // wherever either sits in document order.
        return holders.find((node) => !isRetired(node)) || holders[0] || null;
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

// Inside a lookup pass, once per node: isDumbDevice() asks it of every
// neighbour on every step of every walk. Shared like parseValidCIDR()'s
// results, so callers only read it.
function getValidIps(node) {
    if (!node || !node.interfaces) return [];
    if (lookupPass) {
        const memo = lookupPass.ips;
        if (!memo.has(node)) memo.set(node, node.interfaces.map(iface => parseValidCIDR(iface.ip)).filter(Boolean));
        return memo.get(node);
    }
    return node.interfaces.map(iface => parseValidCIDR(iface.ip)).filter(Boolean);
}

// Inside a lookup pass the same string parses once. The result is shared, so
// nothing may mutate it — nothing does: every caller reads ip, prefix, kind,
// cidrObj and networkStr.
function parseValidCIDR(cidrStr) {
    if (lookupPass && typeof cidrStr === 'string') {
        const memo = lookupPass.cidr;
        if (!memo.has(cidrStr)) memo.set(cidrStr, parseCIDRNow(cidrStr));
        return memo.get(cidrStr);
    }
    return parseCIDRNow(cidrStr);
}
function parseCIDRNow(cidrStr) {
    try {
        if (!cidrStr || !cidrStr.includes('/')) return null;
        const [ipStr, prefixStr] = cidrStr.split('/');
        const prefix = Number.parseInt(prefixStr, 10);
        const ip = ipaddr.parse(ipStr.trim());
        if (Number.isNaN(prefix)) return null;
        if (ip.kind() === 'ipv4' && (prefix < 0 || prefix > 32)) return null;
        if (ip.kind() === 'ipv6' && (prefix < 0 || prefix > 128)) return null;
        // The family is known by now, so its own parser: ipaddr.parseCIDR()
        // tries IPv6 first and catches the throw, and for every IPv4 address
        // that throw was most of the cost of reading one (a fifth of a
        // 300-device report).
        const cidrObj = (ip.kind() === 'ipv6' ? ipaddr.IPv6 : ipaddr.IPv4).parseCIDR(`${ip.toString()}/${prefix}`);
        // The masked network, in both families. IPv6 used to keep the host
        // address here ("2001:db8::5/64"), so two hosts on one /64 never
        // compared equal: every IPv6 cable was a subnet mismatch and every
        // IPv6 host its own row in the report's addressing table.
        let networkStr;
        if (ip.kind() === 'ipv6') {
            networkStr = `${ipaddr.IPv6.networkAddressFromCIDR(`${ip.toString()}/${prefix}`).toString()}/${prefix}`;
        } else {
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

    // Special case: DICOM commonly uses both 104 and 11112. Tested on the
    // service name after the protocol is split off, and before the alias table
    // turns it into 104 alone, so 'tcp/dicom' means both ports as 'dicom' does.
    if (raw === 'dicom') {
        return [
            { proto, start: 104, end: 104, label: '104' },
            { proto, start: 11112, end: 11112, label: '11112' }
        ];
    }

    if (aliases[raw]) raw = aliases[raw];

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
            text: t('No trace port requested.')
        };
    }

    const queryPorts = parsePortExpression(query);

    if (!queryPorts.length) {
        return {
            ok: false,
            level: 'bad',
            text: t('Invalid trace port: {port}', { port: query })
        };
    }

    if (!node || isDumbDevice(node) || isRoutingDevice(node.type)) {
        return {
            ok: true,
            level: 'info',
            text: t('Transit device; service port is not evaluated as an endpoint.')
        };
    }

    if (!node.ports || node.ports.trim() === '') {
        return {
            ok: true,
            level: 'warn',
            text: t('No allowed ports defined; treating as open.')
        };
    }

    const allowedPorts = parsePortExpression(node.ports);

    if (!allowedPorts.length) {
        return {
            ok: false,
            level: 'bad',
            text: t('Allowed Ports field is invalid: {ports}', { ports: node.ports })
        };
    }

    const match = queryPorts.some((queryEntry) =>
        allowedPorts.some((allowedEntry) => portEntriesMatch(queryEntry, allowedEntry))
    );

    return {
        ok: match,
        level: match ? 'good' : 'bad',
        text: t(match
            ? 'Port {port} is allowed by this node.'
            : "Port {port} is not listed in this node's Allowed Ports.", { port: query })
    };
}

// ============================================================================
// The field schema
// ============================================================================
// One table per record kind, and every reader that used to list the fields by
// hand reads the table instead: the serializer and the normalizer in app.js,
// the inventory rows in report.js, the table view (js/table.js) and (later)
// the CSV headers. Four hand-kept lists had already drifted apart — the serializer
// dropped `mac` while the sidebar, the report and the duplicate-MAC check all
// used it, and the normalizer passed `node.interfaces` through unchecked, so a
// number in an `ip` crashed the sidebar, the filter and the gateway jump.
//
// A row is { key, kind, omit, label, report, csv, bulk, table, validate }:
//   kind      how the value is read on load and written on save (FIELD_KINDS).
//   omit      the `|| undefined` rule: written only when it holds something, so
//             a document that never used the field serializes exactly as it did
//             before the field existed. Fields that were ALWAYS written (gw,
//             dns, os, ports, notes, nat) keep being written even when empty —
//             dropping them now would change the bytes of every saved
//             document, every undo comparison and every test fixture. Every
//             field added from now on is `omit: true`.
//   label     the English key for t(). Technical vocabulary stays English in
//             the full editor (see applyProfile in app.js); the label is still
//             passed through t() so a non-technical one can be translated.
//   report    { key, column?, mono? }: the property on reportDevices()' rows,
//             and when `column` is set, a column of the inventory table.
//   csv       the header this field round-trips under. Unmapped CSV columns
//             are ignored on import, as NetBox does: the schema is the
//             allowlist, and there is deliberately no free-form attrs map.
//   bulk      whether the bulk panel may set it on many records at once.
//   table     'edit' or 'show': a column of the table view (js/table.js),
//             edited in place there or only shown. Its header is the label,
//             and an edit is accepted only when `validate` says yes. Which
//             columns a tab shows, and in what order, is the table's choice;
//             whether one may be typed into is this table's.
//   validate  (value) => true when the value is acceptable (empty always is:
//             an empty field means "unknown", never "wrong").
//
// The order of each table is the key order of the serialized JSON, and that
// order is part of the byte-identity promise above. Append; never reorder.

// Present-but-wrong-type is coerced; text is never invented. A number typed
// into a hand-edited file becomes its digits, anything else becomes empty.
const asText = (v) => (typeof v === 'string' ? v : (Number.isFinite(v) ? String(v) : ''));
const asOptionalText = (v) => (typeof v === 'string' ? v : (Number.isFinite(v) ? String(v) : undefined));
const isBlank = (v) => typeof v !== 'string' || v.trim() === '';

// read(value, source) runs on load; write(value) runs on save and returns
// undefined to leave the key out. `raw` exists for ids and references: an id
// that is coerced stops matching every link that names it.
const FIELD_KINDS = {
    raw: { read: (v) => v, write: (v) => v },
    text: { read: asText, write: (v) => v || '' },
    bool: { read: (v) => !!v, write: (v) => !!v },
    // true or absent, never `false`.
    flag: { read: (v) => (v ? true : undefined), write: (v) => (v ? true : undefined) },
    // The interface tri-states (drawZone, wireless): unset means "infer it".
    tristate: { read: (v) => (typeof v === 'boolean' ? v : undefined), write: (v) => (typeof v === 'boolean' ? v : undefined) },
    count: { read: (v) => (Number.isFinite(v) ? v : undefined), write: (v) => (Number.isFinite(v) ? v : undefined) },
    coord: { read: (v) => (Number.isFinite(v) ? v : 200), write: (v) => v }
};

// Four dotted decimals, not ipaddr.isValid(): that also accepts "10" and
// "10.1" as IPv4 shorthands, which nobody means in a gateway field.
const isIpText = (s) => ipaddr.IPv4.isValidFourPartDecimal(s) || ipaddr.IPv6.isValid(s);
const fieldOk = {
    any: () => true,
    ip: (v) => isBlank(v) || isIpText(String(v).trim()),
    ipList: (v) => isBlank(v) || parseDnsList(v).every(isIpText),
    cidr: (v) => isBlank(v) || !!parseValidCIDR(String(v).trim()),
    ports: (v) => isBlank(v) || String(v).split(',').map((tok) => tok.trim()).filter(Boolean)
        .every((tok) => normalizePortToken(tok).length > 0),
    mac: (v) => isBlank(v) || normMac(v).length === 12,
    // An identifier written on a sticker (an asset tag, a serial, a cable
    // label): one line, and short enough to print. What it says is the
    // owner's business; `#asset/<tag>` carries any of it, URL-encoded.
    tag: (v) => isBlank(v) || (String(v).trim().length <= 64 && !/[\u0000-\u001f\u007f]/.test(String(v)))
};

// A text field that is left out of the record when it says nothing, so a
// device that never had a serial does not carry `serial: ''` in memory or in
// the file. Every field added from the Asset group on reads this way.
const asOmittedText = (v) => { const s = asText(v); return isBlank(s) ? undefined : s; };

// A device's life cycle (plan section 4). Unset means nobody said, which reads
// as in service. A retired device is kept for the register (where it was, its
// serial, its tag) but is no longer on the network: the canvas dims it and the
// reachability walk neither reaches it nor goes through it (js/diagnostics.js).
const STATUS_VALUES = ['planned', 'active', 'retired'];
const asStatus = (v) => { const s = typeof v === 'string' ? v.trim().toLowerCase() : ''; return STATUS_VALUES.includes(s) ? s : undefined; };
const isRetired = (node) => !!node && node.status === 'retired';

// A site reference is a caption with a pointer attached, in that order of
// importance: `id` only resolves in the browser that holds that binder card,
// while `name` is what the recipient of a shared link has to read. So a ref
// with neither is not a claim about anything and is dropped, and a ref with
// only a name is still perfectly good — it says what the cloud stands for,
// which is more than the bare "cloud named Torre A" it replaces.
function normalizeSiteRef(v) {
    if (!v || typeof v !== 'object') return null;
    const id = typeof v.id === 'string' ? v.id.trim() : '';
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    return (id || name) ? { id, name } : null;
}

// A bond is rebuilt field by field, like siteRef: it used to be copied whole,
// which let any key a hand-edited file put inside it ride into the URL.
function normalizeBondSpec(v) {
    if (!v || typeof v !== 'object') return undefined;
    return {
        mode: typeof v.mode === 'string' && v.mode ? v.mode : 'active-backup',
        members: Array.isArray(v.members) ? v.members.map(asOptionalText).filter((id) => id !== undefined) : []
    };
}

const IFACE_FIELDS = [
    // A link names an interface by id, so a missing id is minted rather than
    // left blank: two blank ids on one node would bind the same cable twice.
    { key: 'id', kind: 'raw', read: (v) => asOptionalText(v) || nextId('i'), label: 'Interface ID', csv: 'interface_id' },
    { key: 'name', kind: 'text', label: 'Interface', csv: 'interface', table: 'edit', write: (v) => v },
    { key: 'ip', kind: 'text', label: 'IP / CIDR', csv: 'ip', bulk: false, table: 'edit', validate: fieldOk.cidr, write: (v) => v },
    // mac was the field the hand-kept list forgot. Omitted when empty, so a
    // document that never held a MAC serializes exactly as it did before.
    { key: 'mac', kind: 'text', omit: true, label: 'MAC', csv: 'mac', table: 'edit', validate: fieldOk.mac,
      read: (v) => (typeof v === 'string' ? v : undefined) },
    // drawZone used to sit here, one flag per interface, so a /24 of forty
    // hosts had forty switches for one bubble. It belongs to the network now
    // (NETWORK_FIELDS); the v2 -> v3 migration moves it there, and an
    // interface no longer carries it.
    { key: 'wireless', kind: 'tristate', label: 'Wireless', csv: 'wireless', table: 'show' },
    // In a spreadsheet (interfaces.csv) one cell: the mode, then the member
    // interfaces by id, "802.3ad n1 n2" (the ids the sheet's interface_id
    // column gives them). Without it a bonded NAS came back from the
    // spreadsheet as two NICs and an address on a third, and flapping.
    { key: 'bond', kind: 'raw', omit: true, label: 'Bond', csv: 'bond', read: normalizeBondSpec,
      write: (v) => (v ? { mode: v.mode, members: v.members } : undefined),
      toText: (v) => (v ? [v.mode].concat(v.members || []).join(' ') : ''),
      fromText: (text) => {
          const [mode, ...members] = String(text == null ? '' : text).trim().split(/[\s,;]+/).filter(Boolean);
          return mode && Object.prototype.hasOwnProperty.call(BOND_MODES, mode) && members.length ? { mode, members } : null;
      } }
];

const NODE_FIELDS = [
    { key: 'id', kind: 'raw', read: (v) => v || `n_${Date.now()}_${Math.random().toString(16).slice(2)}`, label: 'ID', csv: 'id' },
    { key: 'type', kind: 'raw', read: (v) => asOptionalText(v) || 'custom', label: 'Type', csv: 'type', bulk: true, table: 'show' },
    { key: 'name', kind: 'raw', read: (v) => asText(v) || 'Unnamed Node', label: 'Name', csv: 'name', table: 'edit' },
    { key: 'x', kind: 'coord', label: 'X', csv: 'x' },
    { key: 'y', kind: 'coord', label: 'Y', csv: 'y' },
    { key: 'gw', kind: 'text', label: 'Gateway', csv: 'gateway', bulk: true, table: 'edit', validate: fieldOk.ip,
      report: { key: 'gw', column: 'Gateway', mono: true } },
    { key: 'dns', kind: 'text', label: 'DNS', csv: 'dns', bulk: true, table: 'edit', validate: fieldOk.ipList,
      report: { key: 'dns', column: 'DNS', mono: true } },
    // Relabelled "Model / firmware" with the Asset group (plan section 4): it
    // was always where people wrote the model as well as the OS. The key and
    // the csv name stay `os`, so files and sheets from before still read.
    { key: 'os', kind: 'text', label: 'Model / firmware', csv: 'os', bulk: true, table: 'edit',
      report: { key: 'os', column: 'Model / firmware' } },
    { key: 'ports', kind: 'text', label: 'Allowed Ports', csv: 'allowed_ports', bulk: true, table: 'edit', validate: fieldOk.ports,
      report: { key: 'allowedPorts' } },
    { key: 'notes', kind: 'text', label: 'Notes', csv: 'notes', bulk: true, table: 'edit', report: { key: 'notes' } },
    // A routing type's NAT default applies only when the document never said
    // either way, so an explicit `nat: false` on a firewall stays false.
    { key: 'nat', kind: 'bool', label: 'NAT / Masquerade', csv: 'nat', bulk: true, table: 'edit', report: { key: 'nat' },
      read: (v, src) => !!(v || (initialDataDefaults[src.type] && initialDataDefaults[src.type].nat && v === undefined)) },
    // netcfg (the "Network config file" checkbox) is gone: the Netplan
    // hand-off is an action on the host types now (js/ui.js). A document
    // that carries `netcfg: true` still opens as before, and the key is
    // dropped on its next save like any other this table does not name.

    // The single enforcement point for "only a cloud stands for another site",
    // so every reader downstream — the canvas, the panel, the estate report —
    // may assume it without re-checking. A workstation that "is" another site
    // would be a lie: it still counts in this drawing's device total, its
    // subnet table and its findings.
    { key: 'siteRef', kind: 'raw', label: 'Stands for another site',
      read: (v, src) => (src.type === 'cloud' && normalizeSiteRef(v)) || undefined,
      write: (v) => (v ? { id: v.id, name: v.name } : undefined) },
    { key: 'portCount', kind: 'count', label: 'Ports', csv: 'port_count' },
    // Document v6 (see "Port names, labels and access VLANs" above). Only a
    // device with a faceplate has numbered ports, so only one keeps these.
    // The scheme is one spreadsheet cell, the name of port 1 ("Gi1/0/1"):
    // the prefix is what comes before its number, and the number is where
    // counting starts (toText / fromText, read by js/csv.js).
    { key: 'portScheme', kind: 'raw', label: 'Port names', csv: 'first_port',
    // Written only while the device still has a faceplate: a switch turned
    // into a PC in this session keeps them in memory (turning it back gives
    // them back), but its port labels are free text the page no longer
    // shows, so they must not leave in a file or a sealed link either.
      read: (v, src) => (hasPortGrid(src) ? normalizePortScheme(v) : undefined),
      write: (v, src) => (hasPortGrid(src) ? normalizePortScheme(v) : undefined),
      toText: (v) => { const sc = normalizePortScheme(v); return sc ? portNameOf({ portScheme: sc }, 1) : ''; },
      // The inverse of toText, and only of it: a number with a leading zero
      // ("Port 01") is a name no scheme prints, so it is refused rather than
      // read as a different one.
      fromText: (text) => {
          const m = /^(.*?)(\d+)\s*$/.exec(String(text == null ? '' : text));
          return m && !/^0\d/.test(m[2]) ? { prefix: m[1], start: Number(m[2]) } : null;
      } },
    { key: 'portAttrs', kind: 'raw', label: 'Port labels and VLANs',
      read: (v, src) => (hasPortGrid(src) ? normalizePortAttrs(v) : undefined),
      write: (v, src) => (hasPortGrid(src) ? normalizePortAttrs(v) : undefined) },
    { key: 'interfaces', kind: 'raw', label: 'Interfaces', read: (v, src) => normalizeNodeInterfaces(src),
      write: (list) => (list || []).map((i) => writeFields(IFACE_FIELDS, i)) },
    // ---- The Asset group (plan section 4, document v4) ----
    // What a register holds about the box rather than its addressing. The
    // model is `os` above; the notes are `notes`. All omitted when empty, so a
    // device that never used them serializes as it did before they existed.
    // Serial and asset tag name one box each, so the bulk panel does not set
    // them on many (a duplicate tag is a finding instead); location and status
    // are what a set of devices often shares.
    { key: 'serial', kind: 'text', omit: true, read: asOmittedText, label: 'Serial number', csv: 'serial', table: 'edit',
      validate: fieldOk.tag, report: { key: 'serial' } },
    // The id on the sticker, and the key of the `#asset/<tag>` route
    // (js/assets.js): a printed QR label opens this device.
    { key: 'assetTag', kind: 'text', omit: true, read: asOmittedText, label: 'Asset tag', csv: 'asset_tag', table: 'edit',
      validate: fieldOk.tag, report: { key: 'assetTag' } },
    // Room / rack / U, as text: Topo draws no racks (plan, "Not doing").
    { key: 'location', kind: 'text', omit: true, read: asOmittedText, label: 'Location', csv: 'location', bulk: true, table: 'edit',
      report: { key: 'location' } },
    { key: 'status', kind: 'raw', read: asStatus, write: asStatus, label: 'Status', csv: 'status', bulk: true, table: 'edit',
      validate: (v) => isBlank(v) || asStatus(v) !== undefined, report: { key: 'status' } }
];

// A cable's own facts (link.cable, plan section 4): the label on both ends of
// the run, its length and colour as written on the reel or the plan, and what
// it runs through, as free text ("PP-A:12 > WJ-3B"), because patch panels and
// wall jacks are not drawn as devices. Nested like a node's interfaces are, and
// read and written through this table the same way.
const CABLE_FIELDS = [
    { key: 'label', kind: 'text', omit: true, read: asOmittedText, label: 'Cable label', csv: 'cable_label', table: 'edit', validate: fieldOk.tag },
    { key: 'length', kind: 'text', omit: true, read: asOmittedText, label: 'Length', csv: 'cable_length', bulk: true, table: 'edit' },
    { key: 'color', kind: 'text', omit: true, read: asOmittedText, label: 'Colour', csv: 'cable_color', bulk: true, table: 'edit' },
    { key: 'via', kind: 'text', omit: true, read: asOmittedText, label: 'Via', csv: 'cable_via', bulk: true, table: 'edit' }
];
// Left off the link altogether when none of them says anything.
function readCable(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const c = readFields(CABLE_FIELDS, v);
    return Object.keys(c).length ? c : undefined;
}
function writeCable(v) {
    if (!v || typeof v !== 'object') return undefined;
    const c = writeFields(CABLE_FIELDS, v);
    Object.keys(c).forEach((k) => { if (c[k] === undefined) delete c[k]; });
    return Object.keys(c).length ? c : undefined;
}
// One fact of a cable, '' when unset: every reader (the canvas, the table,
// the CSV, the findings) asks this rather than reaching into link.cable.
const cableOf = (link, key) => (link && link.cable && typeof link.cable[key] === 'string' ? link.cable[key] : '');
// Sets one fact, dropping the object when it ends up empty. Returns the link.
function setCableField(link, key, value) {
    const next = Object.assign({}, link.cable || {}, { [key]: value });
    link.cable = readCable(next);
    if (!link.cable) delete link.cable;
    return link;
}

const LINK_FIELDS = [
    { key: 'id', kind: 'raw', read: (v) => v || nextId('l'), label: 'Cable ID', csv: 'cable_id' },
    { key: 'source', kind: 'raw', label: 'From', csv: 'from_device', table: 'show' },
    { key: 'target', kind: 'raw', label: 'To', csv: 'to_device', table: 'show' },
    { key: 'attachment', kind: 'raw', label: 'Attachment', csv: 'attachment' },
    { key: 'medium', kind: 'raw', label: 'Medium', csv: 'medium', bulk: true, table: 'edit',
      // The five media the canvas can draw (FLOW_CLASS); unset is "guess".
      validate: (v) => isBlank(v) || Object.prototype.hasOwnProperty.call(FLOW_CLASS, v) },
    // Optional on load: links from older diagrams carry no interface refs, and
    // autoBindLinks() fills them in once every node is loaded. Held as null,
    // written only when bound.
    { key: 'sourceIface', kind: 'raw', label: 'From port', csv: 'from_port', table: 'show',
      read: (v) => asOptionalText(v) || null, write: (v) => v || undefined },
    { key: 'targetIface', kind: 'raw', label: 'To port', csv: 'to_port', table: 'show',
      read: (v) => asOptionalText(v) || null, write: (v) => v || undefined },
    // CABLE_FIELDS above; document v4.
    { key: 'cable', kind: 'raw', label: 'Cable', read: readCable, write: writeCable }
];

const fieldRead = (f) => f.read || FIELD_KINDS[f.kind].read;
const fieldWrite = (f) => f.write || FIELD_KINDS[f.kind].write;

// Save: every field in table order. JSON.stringify drops the undefineds, which
// is the whole of the `omit` rule for kinds whose writer already returns
// undefined when empty; text fields marked omit need the explicit test.
function writeFields(fields, rec) {
    const out = {};
    fields.forEach((f) => {
        const v = rec[f.key];
        out[f.key] = f.omit && f.kind === 'text' ? (isBlank(v) ? undefined : v) : fieldWrite(f)(v, rec);
    });
    return out;
}

// Load: every field in table order, coerced. A key whose reader returns
// undefined is left out of the record altogether rather than held as
// `key: undefined`, so `'portCount' in node` means what it says.
function readFields(fields, src) {
    const out = {};
    fields.forEach((f) => {
        const v = fieldRead(f)(src[f.key], src);
        if (v !== undefined) out[f.key] = v;
    });
    return out;
}

// Interfaces need the whole node: one that arrived with no interface list gets
// its type's. The two legacy shapes this used to convert on every load (`ips`,
// an AP with no radio) are the v1 -> v2 migration now; see legacyNodeShape().
function normalizeNodeInterfaces(node) {
    const def = initialDataDefaults[node.type] || { interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] };
    const list = Array.isArray(node.interfaces) ? node.interfaces : cloneData(def.interfaces);
    // Every entry is coerced, including the strings: this list used to be
    // passed through unchecked, and an `ip` that was a number reached
    // `iface.ip.trim()` in the sidebar.
    return list.filter((i) => i && typeof i === 'object').map((i) => readFields(IFACE_FIELDS, i));
}

// The schema rows that become columns of the report's inventory table, in
// table order, after the fixed Device / Type / Interfaces columns.
const reportColumns = () => NODE_FIELDS.filter((f) => f.report && f.report.column);

// ============================================================================
// Networks (R7)
// ============================================================================
// Subnets used to exist only as something inferred from host addresses, and
// the gateway and DNS server of a subnet were copied onto every host on it:
// forty hosts, forty copies, and changing the gateway meant editing forty
// devices (or, more often, thirty-eight). A network is now a record of its
// own, doc.networks, and a device belongs to one by containment: an address
// inside the network's CIDR makes it a member. Nothing stores a member list,
// so moving a device to another address moves it to another network.
//
// A device's own gateway and DNS fields are overrides now, empty by default.
// Every reader — the diagnostics, the trace, the report, the Netplan
// hand-off — asks effectiveGw()/effectiveDns(), never node.gw or node.dns,
// so an override and an inherited value cannot be read two different ways.

// Held canonical, the masked network ("10.0.1.0/24", not "10.0.1.7/24"), so two
// spellings of one subnet are one network and containment is a comparison. A
// row whose cidr does not parse is not a network, and normalizeNetworks() drops
// it.
const canonicalCidr = (v) => {
    const p = typeof v === 'string' && v.includes('/') ? parseValidCIDR(v.trim()) : null;
    return p ? p.networkStr : undefined;
};
// 802.1Q's usable range. A string of digits (a hand-edited file, a typed
// field) is read as its number; anything else is no VLAN rather than a guess.
const asVlan = (v) => {
    const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
    return Number.isInteger(n) && n >= 1 && n <= 4094 ? n : undefined;
};
const parseIpText = (s) => {
    const text = typeof s === 'string' ? s.trim() : '';
    if (!text || !isIpText(text)) return null;
    try { return ipaddr.parse(text); } catch (e) { return null; }
};
const sameIp = (a, b) => { const x = parseIpText(a), y = parseIpText(b); return !!(x && y && x.kind() === y.kind() && x.toString() === y.toString()); };
const dnsKey = (v) => parseDnsList(v).map((s) => (parseIpText(s) || { toString: () => s }).toString()).join(',');

// Every field added here is `omit: true` (see the schema's header): a
// network that never said its VLAN does not carry `vlan` at all.
const NETWORK_FIELDS = [
    { key: 'id', kind: 'raw', read: (v) => asOptionalText(v) || nextId('net'), label: 'ID', csv: 'network_id' },
    { key: 'cidr', kind: 'raw', read: canonicalCidr, label: 'CIDR', csv: 'cidr', table: 'show', validate: fieldOk.cidr },
    { key: 'name', kind: 'text', omit: true, label: 'Name', csv: 'name', table: 'edit' },
    { key: 'vlan', kind: 'count', read: asVlan, write: asVlan, label: 'VLAN', csv: 'vlan', table: 'edit',
      validate: (v) => v === undefined || isBlank(String(v)) || asVlan(v) !== undefined },
    { key: 'purpose', kind: 'text', omit: true, label: 'Purpose', csv: 'purpose', table: 'edit' },
    { key: 'gateway', kind: 'text', omit: true, label: 'Gateway', csv: 'gateway', table: 'edit', validate: fieldOk.ip },
    { key: 'dns', kind: 'text', omit: true, label: 'DNS', csv: 'dns', table: 'edit', validate: fieldOk.ipList },
    // DHCP is served on this network: a fact for the register and the report.
    // Nothing infers addresses from it.
    { key: 'dhcp', kind: 'flag', label: 'DHCP', csv: 'dhcp', table: 'edit' },
    // Tri-state, as the interface flag it replaces was: unset draws the zone
    // of a private network and not of a public one.
    { key: 'drawZone', kind: 'tristate', label: 'Zone', csv: 'draw_zone' }
];

// Load: coerced through the table, and one record per subnet. A second row
// for a CIDR already declared is dropped (containment could not tell the two
// apart), and a repeated id is reminted rather than left to alias.
function normalizeNetworks(list) {
    const cidrs = new Set(), ids = new Set();
    return (Array.isArray(list) ? list : [])
        .filter((n) => n && typeof n === 'object')
        .map((n) => readFields(NETWORK_FIELDS, n))
        .filter((n) => {
            if (!n.cidr || cidrs.has(n.cidr)) return false;
            cidrs.add(n.cidr);
            if (ids.has(n.id)) n.id = nextId('net');
            ids.add(n.id);
            return true;
        });
}
// Save: left out altogether when there are none, so a document that never
// declared a network serializes as it did before networks existed.
const serializeNetworks = (list) => (list && list.length ? list.map((n) => writeFields(NETWORK_FIELDS, n)) : undefined);
const makeNetwork = (cidr, id) => readFields(NETWORK_FIELDS, { id: id || nextId('net'), cidr });

// Parsed, and ordered most specific first, so the first network that contains
// an address is the one it belongs to: a /24 declared inside a /16 keeps its
// own hosts. Cached for the length of a lookup pass when it is the live list.
//
// Outside a pass it is cached too, per list, for as long as the list still
// holds the same network objects with the same cidrs. Every membership
// question (networkOfIp, so effectiveGw, the library card summary and the
// v2 -> v3 migration) comes here, and rebuilding means parsing every cidr and
// sorting: done per address it made opening a 600-device file take seconds.
// The check is a walk of the list comparing references, far cheaper than the
// parse it saves, and it notices a push, a removal, a replaced entry or an
// edited cidr, so nothing has to remember to invalidate it.
const _netTables = new WeakMap();
function networkTable(networks = state.networks) {
    const list = networks || [];
    const build = () => list
        .map((net) => ({ net, p: parseValidCIDR(net.cidr) }))
        .filter((e) => e.p)
        .sort((a, b) => b.p.prefix - a.p.prefix);
    if (lookupPass && networks === state.networks) return lookupPass.nets || (lookupPass.nets = build());
    if (!Array.isArray(networks)) return build();
    const hit = _netTables.get(networks);
    if (hit && hit.nets.length === list.length
        && hit.nets.every((n, i) => n === list[i] && hit.cidrs[i] === (n && n.cidr))) return hit.table;
    const table = build();
    _netTables.set(networks, { nets: list.slice(), cidrs: list.map((n) => n && n.cidr), table });
    return table;
}
const ipInParsed = (ip, p) => !!ip && ip.kind() === p.kind && ip.match(p.cidrObj);
function networkOfIp(ip, networks = state.networks) {
    const addr = typeof ip === 'string' ? parseIpText(ip) : ip;
    if (!addr) return null;
    const hit = networkTable(networks).find((e) => ipInParsed(addr, e.p));
    return hit ? hit.net : null;
}
const networkById = (id) => state.networks.find((n) => n.id === id) || null;

// The network a device's gateway or DNS ('gateway' | 'dns') comes from: the
// first of its addresses, in interface order, whose network names one. A
// network this device is itself the gateway of is skipped: nothing routes
// through itself.
//
// A routing device (router, firewall, L3 switch…) inherits neither. Its
// gateway is its own default route and its DNS its own upstream resolver:
// configuration of the device, not something a network hands it. Inherited,
// it depended on which of its networks happened to come first (a router whose
// LAN names a firewall as gateway took the LAN's, not its uplink's), and
// editing a LAN's gateway silently moved the router's own default route off
// the internet. So a router keeps what it says, the migration leaves it on
// the router (clearInherited asks this function), and a blank one is blank.
function inheritingNetwork(node, key, networks = state.networks) {
    if (!node || isRoutingDevice(node.type)) return null;
    const own = getValidIps(node);
    if (!own.length) return null;
    const mine = new Set(own.map((p) => p.ip.toString()));
    for (const p of own) {
        const net = networkOfIp(p.ip, networks);
        if (!net) continue;
        const gw = parseIpText(net.gateway);
        if (gw && mine.has(gw.toString())) continue;
        if (!isBlank(net[key])) return net;
    }
    return null;
}
// The first network the device is a client of (not its gateway), named or
// not: where its DNS vote goes in adoptSubnets().
function clientNetwork(node, networks = state.networks) {
    const own = getValidIps(node);
    const mine = new Set(own.map((p) => p.ip.toString()));
    for (const p of own) {
        const net = networkOfIp(p.ip, networks);
        const gw = net && parseIpText(net.gateway);
        if (net && !(gw && mine.has(gw.toString()))) return net;
    }
    return null;
}

// { value, network }: the value in force and where it came from (network is
// null for the device's own override, or when there is none).
function gatewaySource(node, networks = state.networks) {
    const own = asText(node && node.gw).trim();
    if (own) return { value: own, network: null };
    const net = node ? inheritingNetwork(node, 'gateway', networks) : null;
    return { value: net ? net.gateway.trim() : '', network: net };
}
function dnsSource(node, networks = state.networks) {
    const own = asText(node && node.dns).trim();
    if (own) return { value: own, network: null };
    const net = node ? inheritingNetwork(node, 'dns', networks) : null;
    return { value: net ? net.dns.trim() : '', network: net };
}
function effectiveOf(node) {
    if (!node) return { gw: '', dns: '' };
    const memo = lookupPass && lookupPass.eff;
    if (memo && memo.has(node)) return memo.get(node);
    const out = { gw: gatewaySource(node).value, dns: dnsSource(node).value };
    if (memo) memo.set(node, out);
    return out;
}
// The one way to ask what gateway / DNS servers a device uses.
const effectiveGw = (node) => effectiveOf(node).gw;
const effectiveDns = (node) => effectiveOf(node).dns;

// Who is on a network, and with which addresses: every device holding an
// address whose most specific declared network is this one.
function networkMembers(net, nodes = state.nodes, networks = state.networks) {
    const out = [];
    nodes.forEach((node) => {
        const addrs = getValidIps(node).filter((p) => networkOfIp(p.ip, networks) === net);
        if (addrs.length) out.push({ node, addrs });
    });
    return out;
}

// The subnets the addressing implies that no declared network covers, in the
// order they are first met: what a migration declares, and what the Subnets
// tab offers to declare. A cloud stands for the outside (the internet, an ISP,
// another site), so its address says nothing about this site's networks; it
// never drew a zone either.
function undeclaredSubnets(nodes = state.nodes, networks = state.networks) {
    const out = new Map();
    nodes.forEach((node) => {
        if (!node || node.type === 'cloud') return;
        getValidIps(node).forEach((p) => {
            if (networkOfIp(p.ip, networks)) return;
            if (!out.has(p.networkStr)) out.set(p.networkStr, { cidr: p.networkStr, kind: p.kind, isPrivate: p.isPrivate, nodeIds: [] });
            const entry = out.get(p.networkStr);
            if (!entry.nodeIds.includes(node.id)) entry.nodeIds.push(node.id);
        });
    });
    return [...out.values()];
}

// Declare a network for every subnet the addressing implies and nothing covers
// yet, give each new one the gateway and DNS its devices agree on, and clear
// the device copies that are now simply inherited. The migration runs it over
// a whole old document; a stamped block and the setup wizard run it over the
// devices they just placed (opts.nodeIds), so what they bring in is described
// the same way an old document is.
//
// Agreement is a majority, ties to the first device drawn. A gateway votes
// only for a network of the device that contains it (one outside every
// subnet of its device is a fault, and stays on that device for the
// diagnostics to report). DNS votes come from clients only: a router's DNS
// field is its own upstream resolver, not what a client behind it is handed
// (the rule dnsForSubnet() in js/app.js always applied). Only new networks
// take votes: a network somebody declared says what it says.
//
// What a device keeps is exactly what differs from what it would inherit, so
// its effective gateway and DNS are unchanged — except on a device that had
// none, which now has its network's. That is the point of declaring one.
// A routing device inherits nothing (inheritingNetwork), so its gateway and
// DNS stay on it as written; its gateway still votes for its uplink network.
//
// Mutates `nodes` and `networks` in place (plain documents and live state
// alike). opts.mint names new networks (the migration's are deterministic).
function adoptSubnets(nodes, networks, opts = {}) {
    const mint = opts.mint || (() => nextId('net'));
    const inScope = (n) => n && typeof n === 'object' && (!opts.nodeIds || opts.nodeIds.has(n.id));
    const scoped = nodes.filter(inScope);
    const fresh = undeclaredSubnets(scoped, networks).map((s) => makeNetwork(s.cidr, mint()));
    networks.push(...fresh);
    voteNetworks(scoped, networks, new Set(fresh));
    clearInherited(scoped, networks);
    return fresh;
}

// The votes: each network in `fresh` takes the gateway and the DNS its
// devices (`nodes`) agree on. See adoptSubnets() for who votes for what.
function voteNetworks(nodes, networks, fresh) {
    const tally = (votes, net, value) => {
        if (!votes.has(net)) votes.set(net, new Map());
        const box = votes.get(net);
        box.set(value, (box.get(value) || 0) + 1);
    };
    const winner = (box) => {
        let best = '', most = 0;
        box.forEach((count, value) => { if (count > most) { best = value; most = count; } });
        return best;
    };

    const gwVotes = new Map();
    nodes.forEach((n) => {
        const gw = parseIpText(n.gw);
        if (!gw) return;
        const own = getValidIps(n);
        if (own.some((p) => p.ip.toString() === gw.toString())) return;   // its own address: a fault, not a gateway
        const net = own.map((p) => networkOfIp(p.ip, networks)).find((x) => x && fresh.has(x) && networkOfIp(gw, [x]));
        if (net) tally(gwVotes, net, gw.toString());
    });
    gwVotes.forEach((box, net) => { net.gateway = winner(box); });

    const dnsVotes = new Map();
    nodes.forEach((n) => {
        if (isRoutingDevice(n.type) || isBlank(n.dns)) return;
        const net = clientNetwork(n, networks);
        if (net && fresh.has(net)) tally(dnsVotes, net, parseDnsList(n.dns).join(', '));
    });
    dnsVotes.forEach((box, net) => { net.dns = winner(box); });
}

// Each device keeps a gateway or DNS of its own only where it differs from
// what it would inherit; a copy of its network's is cleared.
function clearInherited(nodes, networks) {
    nodes.forEach((n) => {
        if (!isBlank(n.gw)) {
            const from = inheritingNetwork(n, 'gateway', networks);
            if (from && sameIp(from.gateway, n.gw)) n.gw = '';
        }
        if (!isBlank(n.dns)) {
            const from = inheritingNetwork(n, 'dns', networks);
            if (from && dnsKey(from.dns) === dnsKey(n.dns)) n.dns = '';
        }
    });
}

// Declare one subnet ("10.0.1.0/24") as a network on the live document, the
// way adoptSubnets() would: the gateway and DNS its devices agree on, and
// their copies cleared. When no device names a gateway, a routing device on
// the subnet is the one the drawing says, as gatewayForSubnet() in js/app.js
// always took it. The Subnets tab's Declare and a device spawned onto an
// undeclared subnet both come here. Returns the network (an existing one when
// the subnet is already declared), or null for something that is not a subnet.
function declareSubnet(cidr) {
    const p = typeof cidr === 'string' ? parseValidCIDR(cidr) : null;
    if (!p) return null;
    const have = state.networks.find((n) => n.cidr === p.networkStr);
    if (have) return have;
    const onIt = state.nodes.filter((n) => n.type !== 'cloud' && getValidIps(n).some((x) => x.networkStr === p.networkStr));
    const net = makeNetwork(p.networkStr);
    voteNetworks(onIt, state.networks.concat(net), new Set([net]));
    if (isBlank(net.gateway)) {
        const router = onIt.find((n) => isRoutingDevice(n.type));
        const at = router && getValidIps(router).find((x) => x.networkStr === p.networkStr);
        if (at) net.gateway = at.ip.toString();
    }
    state.networks.push(net);
    clearInherited(onIt, state.networks);
    return net;
}

// What a network is called on screen: its name, else its address.
const networkLabel = (net) => (net ? (isBlank(net.name) ? net.cidr : net.name.trim()) : '');

// ---- Addresses as numbers ----
// BigInt, so one piece of arithmetic serves IPv4 and IPv6: a renumber keeps
// host bits, and the next free address counts up from the network address.
const ipToBig = (ip) => ip.toByteArray().reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
function bigToIp(big, kind) {
    const bytes = [];
    for (let i = 0; i < (kind === 'ipv6' ? 16 : 4); i++) { bytes.unshift(Number(big & 255n)); big >>= 8n; }
    return ipaddr.fromByteArray(bytes);
}
const hostBits = (p) => (p.kind === 'ipv6' ? 128 : 32) - p.prefix;
// The network address as a number. Not cidrObj[0]: a CIDR parsed from a host
// address ("10.0.1.7/24") keeps the host there.
const netBase = (p) => ipToBig(ipaddr.parse(p.networkStr.split('/')[0]));
// The addresses a host may hold: all but the network and broadcast addresses
// of an IPv4 subnet, except on a /31 or /32 (RFC 3021), where every one is a
// host. IPv6 has no broadcast; its subnet-router anycast (the all-zero host)
// is left out the same way.
function usableRange(p) {
    const base = netBase(p);
    const size = 1n << BigInt(hostBits(p));
    if (p.kind === 'ipv4' && p.prefix >= 31) return { first: base, last: base + size - 1n, size };
    if (p.kind === 'ipv6') return { first: base + 1n, last: base + size - 1n, size: size - 1n };
    return { first: base + 1n, last: base + size - 2n, size: size - 2n };
}

// The addresses taken anywhere on the map, plus a network's own gateway and
// resolvers: the gateway is often not drawn, and handing its address to the
// next device would be a conflict nobody could see. A retired device's address
// is not taken: it is off the network, and its address is the one its
// replacement is meant to get (the conflict findings agree, js/diagnostics.js).
function takenAddresses(net) {
    const taken = new Set();
    state.nodes.forEach((n) => { if (!isRetired(n)) getValidIps(n).forEach((p) => taken.add(p.ip.toString())); });
    if (net) [net.gateway, ...parseDnsList(net.dns)].forEach((s) => { const ip = parseIpText(s); if (ip) taken.add(ip.toString()); });
    return taken;
}

// The first free host address in a subnet ("10.0.1.0/24" or a declared
// network's cidr), or null when it is full. Bounded, so a /8 with nothing
// free near the bottom cannot hang the tab.
function nextFreeAddress(cidr, net = networkOfIp(String(cidr || '').split('/')[0])) {
    return freeAddresses(cidr, 1, net)[0] || null;
}
// The first `count` free host addresses, in order: what "Add devices" hands a
// dozen new phones (js/add.js). Fewer come back when the subnet runs out, and
// the same bound applies, counted over every address looked at.
function freeAddresses(cidr, count, net = networkOfIp(String(cidr || '').split('/')[0])) {
    const p = parseValidCIDR(cidr);
    if (!p || !(count > 0)) return [];
    const { first, last } = usableRange(p);
    const taken = takenAddresses(net && net.cidr === p.networkStr ? net : null);
    const out = [];
    let tries = 0;
    for (let h = first; h <= last && out.length < count && tries < 65536; h++, tries++) {
        const ip = bigToIp(h, p.kind).toString();
        if (!taken.has(ip)) out.push(ip);
    }
    return out;
}

// The next `count` faceplate ports a new cable could take on a switch or an
// AP, in port order: the free ones on the faceplate first, then the ones past
// it. `past` is how many of those lie beyond an explicit faceplate, which the
// findings report as a port overflow; an implicit faceplate grows by being
// plugged into (DEFAULT_PORT_COUNT), so nothing is past it.
function freePorts(node, count) {
    const ids = [];
    if (!hasPortGrid(node) || !(count > 0)) return { ids, past: 0 };
    const total = portCountOf(node);
    for (let p = 1; p <= total && ids.length < count; p++) {
        const id = `p${p}`;
        if (!ifaceIsOccupied(node.id, id) && !isBond(explicitIface(node, id))) ids.push(id);
    }
    let next = Math.max(total, highestPortInUse(node));
    let past = 0;
    while (ids.length < count) { ids.push(`p${++next}`); if (hasExplicitPortCount(node)) past++; }
    return { ids, past };
}

// The numbers the Subnets tab shows for one network.
function networkStats(net) {
    const p = parseValidCIDR(net.cidr);
    const members = networkMembers(net);
    const used = new Set();
    // Used and free count what is in service: a retired member is still
    // listed, but its address is free again (takenAddresses).
    members.forEach((m) => { if (!isRetired(m.node)) m.addrs.forEach((a) => used.add(a.ip.toString())); });
    const range = p ? usableRange(p) : null;
    // IPv6 sizes are not counts anyone reads: a /64 is shown as 2^64.
    const countable = range && range.size <= 1n << 24n;
    return {
        parsed: p, members, used: used.size,
        size: countable ? Number(range.size) : null,
        free: countable ? Math.max(0, Number(range.size) - used.size) : null,
        bits: p ? hostBits(p) : 0,
        next: p ? nextFreeAddress(net.cidr, net) : null
    };
}

// ---- Renumber ----
// Moving a whole network to another range is one operation on the network,
// not an edit to each of its devices: every member keeps its host bits
// (10.0.1.37 in 10.0.1.0/24 becomes 10.0.9.37 in 10.0.9.0/24), and every
// reference into the old range — device gateway and DNS overrides, every
// network's gateway and DNS — is rewritten the same way, so nothing is left
// pointing at the old addresses.
//
// planRenumber() only looks: it returns what would change and why it cannot,
// and the Subnets tab (js/networks.js) applies the plan as one batch, one
// undo step. Refused, with every reason, when the new range is not a network
// of the same family, overlaps another declared network, would leave a
// network declared inside this one behind, cannot hold a member's host bits,
// would turn a member into the network or broadcast address, or would give a
// member, or a gateway or DNS reference, an address another device already
// holds.
function planRenumber(netId, cidrText) {
    const net = networkById(netId);
    const from = net && parseValidCIDR(net.cidr);
    const text = String(cidrText || '').trim();
    const to = text.includes('/') ? parseValidCIDR(text) : null;
    const errors = [];
    const plan = { net, from, to, errors, ifaces: [], refs: [] };
    if (!from) { errors.push(t('That subnet no longer exists.')); return plan; }
    if (!to) { errors.push(t('{cidr} is not a subnet with a prefix, like 10.0.9.0/24.', { cidr: text || '—' })); return plan; }
    if (to.kind !== from.kind) { errors.push(t('{cidr} is not the same address family as {from}.', { cidr: to.networkStr, from: from.networkStr })); return plan; }
    if (to.networkStr === from.networkStr) { errors.push(t('{cidr} is already this subnet\'s address.', { cidr: to.networkStr })); return plan; }

    const contains = (outer, inner) => outer.kind === inner.kind && outer.prefix <= inner.prefix
        && ipaddr.parse(inner.networkStr.split('/')[0]).match(outer.cidrObj);
    state.networks.forEach((other) => {
        const o = other === net ? null : parseValidCIDR(other.cidr);
        if (!o) return;
        // Exactly another network's range is its own refusal: "overlaps
        // itself" read as nonsense, and a parent network containing both
        // ranges would otherwise let two networks share one cidr.
        if (o.networkStr === to.networkStr) errors.push(t('{cidr} is already declared.', { cidr: to.networkStr }));
        else if (contains(from, o)) errors.push(t('{other} is declared inside this subnet and would be left behind.', { other: o.networkStr }));
        else if ((contains(o, to) || contains(to, o)) && !(contains(o, from) && contains(o, to))) {
            errors.push(t('{cidr} overlaps {other}, which is already declared.', { cidr: to.networkStr, other: o.networkStr }));
        }
    });

    const fromBase = netBase(from), toBase = netBase(to);
    const room = 1n << BigInt(hostBits(to));
    const toRange = usableRange(to);
    const moved = new Map();   // old address -> new address, both as text
    const move = (ip) => {
        const key = ip.toString();
        if (moved.has(key)) return moved.get(key);
        const offset = ipToBig(ip) - fromBase;
        let out = null;
        if (offset >= room) errors.push(t('{ip} does not fit in {cidr}.', { ip: key, cidr: to.networkStr }));
        else {
            const big = toBase + offset;
            if (big < toRange.first || big > toRange.last) errors.push(t('{ip} would become the network or broadcast address of {cidr}.', { ip: key, cidr: to.networkStr }));
            else out = bigToIp(big, to.kind).toString();
        }
        moved.set(key, out);
        return out;
    };
    const inFrom = (ip) => !!ip && ipInParsed(ip, from);

    // The members' interfaces. A member whose own prefix is the network's
    // takes the new prefix with it; one written with another prefix keeps
    // its own, as it was.
    const memberIps = new Set();
    networkMembers(net).forEach(({ node }) => (node.interfaces || []).forEach((iface) => {
        const p = parseValidCIDR(iface.ip);
        if (!p || networkOfIp(p.ip) !== net) return;
        memberIps.add(p.ip.toString());
        const ip = move(p.ip);
        if (ip) plan.ifaces.push({ node, iface, ip: `${ip}/${p.prefix === from.prefix ? to.prefix : p.prefix}` });
    }));
    // Somebody else already there.
    const holders = new Map();
    state.nodes.forEach((n) => getValidIps(n).forEach((p) => { if (!memberIps.has(p.ip.toString())) holders.set(p.ip.toString(), n); }));
    plan.ifaces.forEach((c) => {
        const clash = holders.get(c.ip.split('/')[0]);
        if (clash) errors.push(t('{ip} is already used by {name}.', { ip: c.ip.split('/')[0], name: clash.name || clash.id }));
    });

    // References into the old range, wherever they are.
    const refText = (value, list) => {
        const parts = list ? parseDnsList(value) : [String(value || '').trim()];
        let changed = false;
        const out = parts.map((s) => {
            const ip = parseIpText(s);
            if (!inFrom(ip)) return s;
            const to2 = move(ip);
            if (!to2) return s;
            changed = true;
            return to2;
        });
        return changed ? out.join(', ') : null;
    };
    const ref = (obj, key, list) => {
        if (isBlank(obj[key])) return;
        const v = refText(obj[key], list);
        if (v !== null) plan.refs.push({ obj, key, value: v });
    };
    state.nodes.forEach((n) => { ref(n, 'gw', false); ref(n, 'dns', true); });
    state.networks.forEach((n) => { ref(n, 'gateway', false); ref(n, 'dns', true); });
    // A rewritten reference can land on somebody too: a gateway nobody drew
    // (10.0.1.1) moves to 10.0.9.1, which a device outside the network may
    // already hold. Members' own addresses were checked above; this is every
    // other address the plan moves.
    moved.forEach((ip, old) => {
        if (!ip || memberIps.has(old)) return;
        const clash = holders.get(ip);
        if (clash) errors.push(t('{ip} is already used by {name}.', { ip, name: clash.name || clash.id }));
    });

    // One reason once: two members that both do not fit say so twice.
    plan.errors = [...new Set(errors)];
    return plan;
}

// ============================================================================
// Document versions and migrations
// ============================================================================
// The document carries its own schema version, `v`. Before it did, every load,
// undo and withDoc() re-ran a set of shape-guessing conversions (`ips` into
// interfaces, a radio for an AP with none, the wlan0 rename, binding unbound
// cables), and each one could undo something the user had done on purpose.
// Now the conversions are steps of one ordered chain that runs once, on a
// document older than this build; what comes out is stamped DOC_VERSION on its
// first save (serializeDoc) and from then on is only normalized.
//
//   v absent or 1   everything written before the version existed.
//   v 2             interfaces only (no `ips`), every cable bound to a port.
//   v 3             declared networks (doc.networks): every subnet the
//                   addressing implied is a network, gateway and DNS live on
//                   it and only differences stay on the devices, and the zone
//                   flag is the network's, not each interface's.
//   v 4             the Asset group (serial, assetTag, location, status on a
//                   device) and a cable's own facts (link.cable). Nothing to
//                   convert; the step exists so a v3 build, which would drop
//                   them on its next save, opens such a document read-only.
//   v 5             accepted findings (doc.accepted: { check, nodeIds,
//                   linkIds, reason }). Nothing to convert either; a v4 build
//                   would drop the reasons and count the findings again.
//   v 6             port names and port facts on a switch or an AP
//                   (node.portScheme, node.portAttrs). Nothing to convert; a
//                   v5 build would drop every label and VLAN on its next save.
//
// A document with a higher `v` was written by a newer Topo. Its unknown fields
// cannot be kept — the serializer is an allowlist, and that is a privacy rule,
// not a convenience — and re-saving it through this build would silently drop
// them. So migrateDoc() says so (`newer`), and replaceDocument() opens it
// read-only: it can be looked at and exported exactly as it arrived.
//
// Adding a version: append a step { from: N, to: N + 1, run } and raise
// DOC_VERSION. A step takes a plain document and returns one, and never
// mutates its input. Never edit a shipped step: documents in the wild were
// read by it.
const DOC_VERSION = 6;

// A document's outline: an object whose lists, where present, are lists. The
// loader tolerates a missing list (a bare { nodes } file is a document), but a
// list that is something else is a damaged document, and saying so beats
// reading it as an empty, finding-free network.
const isDocShape = (doc) => !!doc && typeof doc === 'object' && !Array.isArray(doc)
    && ['nodes', 'links', 'networks', 'annotations'].every((k) => doc[k] === undefined || Array.isArray(doc[k]));

const docVersionOf = (doc) => (doc && Number.isInteger(doc.v) && doc.v >= 1 ? doc.v : 1);

// The two node-level shapes older builds wrote. `ips` (a bare list of
// addresses) replaced whatever interface list sat beside it, as the old
// normalizer did; the ids are i1, i2… rather than the timestamps it minted, so
// migrating the same document twice gives the same document, and the shipped
// templates could be converted to exactly what this produces.
function legacyNodeShape(node) {
    const out = { ...node };
    if (Array.isArray(out.ips)) {
        out.interfaces = out.ips.map((ip, idx) => ({ id: `i${idx + 1}`, name: `eth${idx}`, ip }));
    }
    delete out.ips;
    // An AP without a radio cannot serve anyone; older diagrams stored none, so
    // its clients would otherwise all land in the uplink socket.
    if (out.type === 'ap' && Array.isArray(out.interfaces)
        && !out.interfaces.some((i) => i && typeof i === 'object' && ifaceIsWireless(i))) {
        out.interfaces = [{ id: 'w1', name: 'wlan0', ip: '' }, ...out.interfaces];
    }
    return out;
}

const MIGRATIONS = [
    {
        from: 1, to: 2,
        // The cable binding and the rename read the whole drawing (which
        // cable is radio, which port is free), so they run against state for
        // the length of the step and state is put back in the finally, the
        // way withDoc() borrows it.
        run(doc) {
            const held = { nodes: state.nodes, links: state.links };
            try {
                state.nodes = (Array.isArray(doc.nodes) ? doc.nodes : [])
                    .map((n) => readFields(NODE_FIELDS, n && typeof n === 'object' ? legacyNodeShape(n) : {}));
                state.links = (Array.isArray(doc.links) ? doc.links : [])
                    .map((l) => readFields(LINK_FIELDS, l && typeof l === 'object' ? l : {}))
                    .filter((l) => getNode(l.source) && getNode(l.target));
                autoBindLinks();
                // The interface zone flag is v2 data, and the next step reads
                // it. The interface table no longer names it (it moved to the
                // network in v3), so it is carried across by hand: this step's
                // output is what it was when it shipped. Nodes map one to one.
                const src = Array.isArray(doc.nodes) ? doc.nodes : [];
                return { ...doc, v: 2,
                    nodes: state.nodes.map((n, i) => withLegacyZones(writeFields(NODE_FIELDS, n), src[i])),
                    links: state.links.map((l) => writeFields(LINK_FIELDS, l)) };
            } finally {
                state.nodes = held.nodes; state.links = held.links;
            }
        }
    },

    {
        from: 2, to: 3,
        // Declares a network for every subnet the drawing uses, moves the
        // gateway and DNS its devices agree on into it, and keeps on each
        // device only what differs (adoptSubnets). Pure: works on a copy of
        // the plain document, and names the new networks net1, net2… so the
        // same document always migrates to the same document.
        run(doc) {
            // Copies, and only the interface entries the loader would keep
            // (it drops anything that is not an object), so a hand-edited
            // file's junk cannot trip the address reads below.
            const nodes = (Array.isArray(doc.nodes) ? doc.nodes : []).map((n) => (n && typeof n === 'object'
                ? { ...n, interfaces: Array.isArray(n.interfaces) ? n.interfaces.filter((i) => i && typeof i === 'object').map((i) => ({ ...i })) : undefined }
                : n));
            const networks = normalizeNetworks(doc.networks);
            const taken = new Set(networks.map((n) => n.id));
            let seq = 0;
            const mint = () => { let id; do { seq += 1; id = 'net' + seq; } while (taken.has(id)); return id; };
            const fresh = adoptSubnets(nodes, networks, { mint });
            // The zone: drawn before if any member interface drew it (unset
            // meant "if private"), so the network keeps that answer, and
            // stays unset when that is what unset would say anyway. One walk
            // over the interfaces, not one per network: per network it grew
            // with networks x devices.
            const drawn = new Set();
            nodes.forEach((n) => {
                if (!n || typeof n !== 'object' || n.type === 'cloud' || !Array.isArray(n.interfaces)) return;
                n.interfaces.forEach((i) => {
                    const ip = i && parseValidCIDR(i.ip);
                    if (ip && (typeof i.drawZone === 'boolean' ? i.drawZone : ip.isPrivate)) drawn.add(networkOfIp(ip.ip, networks));
                });
            });
            fresh.forEach((net) => {
                const p = parseValidCIDR(net.cidr);
                if (drawn.has(net) !== p.isPrivate) net.drawZone = drawn.has(net);
            });
            nodes.forEach((n) => (n && Array.isArray(n.interfaces) ? n.interfaces : []).forEach((i) => { if (i && typeof i === 'object') delete i.drawZone; }));
            return { ...doc, v: 3, nodes, networks: serializeNetworks(networks) };
        }
    },
    // The asset fields and link.cable are new keys, not a new shape.
    { from: 3, to: 4, run: (doc) => ({ ...doc, v: 4 }) },
    // Accepted findings are a new key, not a new shape.
    { from: 4, to: 5, run: (doc) => ({ ...doc, v: 5 }) },
    // Port names and port facts are new keys, not a new shape.
    { from: 5, to: 6, run: (doc) => ({ ...doc, v: 6 }) }
];

// The v2 interface zone flags of `src`, put back on the same node as written.
function withLegacyZones(out, src) {
    const zones = new Map();
    (src && Array.isArray(src.interfaces) ? src.interfaces : []).forEach((i) => {
        if (i && typeof i === 'object' && typeof i.drawZone === 'boolean') zones.set(i.id, i.drawZone);
    });
    if (zones.size) (out.interfaces || []).forEach((i) => { if (zones.has(i.id)) i.drawZone = zones.get(i.id); });
    return out;
}

// doc -> { doc, from, newer }. The returned doc is at DOC_VERSION, or is the
// input untouched when it is newer than this build (or not a document at all).
function migrateDoc(doc) {
    if (!doc || typeof doc !== 'object') return { doc: { nodes: [], links: [] }, from: DOC_VERSION, newer: false };
    const from = docVersionOf(doc);
    if (from > DOC_VERSION) return { doc, from, newer: true };
    let out = doc, v = from;
    MIGRATIONS.forEach((m) => { if (m.from === v) { out = m.run(out); v = m.to; } });
    return { doc: out, from, newer: false };
}
