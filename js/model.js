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
// Whether an interface is a physical socket that takes one cable: a switch or
// AP faceplate port, or a NIC on a device that does not route. A router's L3
// interface is a subnet gateway, and diagrams routinely hang several hosts off
// one (the switch is simply not drawn, as autoPickIface reads it), so two
// cables there are shorthand, not a fault. The cabling check (js/diagnostics.js)
// and the rack view's and the report's port rings (rackPortsOf's `doubled`)
// ask this one question, so a port is never ringed red where Findings is clean.
const isSocketPort = (node, ifaceId) => hasPortGrid(node) ? /^p\d+$/.test(ifaceId) : !isRoutingDevice(node && node.type);
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
// A wireless link at rest is dashed 4 4; one on 6 GHz is a finer 2 3 of the
// same purple, so the band reads off the line itself (js/ui.js). Traced, every
// radio link drops its dash for the ))) arcs, as before.
const WIFI_6G_DASH = '2 3';

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
// The readers of a device's group and rack fields (NODE_FIELDS), here ahead of
// the table that names them. The group itself is GROUP_FIELDS, further down.
// A rack is at most RACK_U_MAX units: real ones stop near 58, so anything past
// this is a typing slip, not a rack.
const RACK_U_MAX = 99;
const RACK_U_DEFAULT = 42;
const RACK_FACES = ['front', 'rear'];
// A whole number of units, or a string of digits (a hand-edited file, a
// typed field); anything else is not one.
const asUnits = (v) => {
    const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
    return Number.isInteger(n) ? n : undefined;
};
const asGroupRef = (v) => { const s = asOptionalText(v); return s && s.trim() ? s.trim() : undefined; };
// Kept rather than dropped or pulled into range: U 0 or U 120 in a typed field
// or a hand-edited file is a slip somebody has to see, and the out-of-rack
// finding says so once the rack is known (placeFindings, js/diagnostics.js).
// Bounded only to +/-RACK_U_MAX, so a stray 1e9 cannot make a rack view or a
// span text absurd. Unlike a count, a unit may be typed with a minus sign.
const asRackU = (v) => {
    const n = typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v;
    return Number.isInteger(n) ? Math.min(RACK_U_MAX, Math.max(-RACK_U_MAX, n)) : undefined;
};
// One unit is the default and is not stored.
const asRackHeight = (v) => { const n = asUnits(v); return n === undefined || n <= 1 ? undefined : Math.min(RACK_U_MAX, n); };
const asRackFace = (v) => { const s = typeof v === 'string' ? v.trim().toLowerCase() : ''; return RACK_FACES.includes(s) ? s : undefined; };
// How deep it is, front to back. A device in a rack fills its depth unless
// it is set to one face: a long server, a UPS, a switch with its PSUs at the
// back all take their units on both faces, so nothing can hang on the rear
// behind them, and the owner wants that as the default (Review-Packs/
// Topo-groups.md, "Round 2", item 3), so full is not stored. 'half' is a
// device on one face only (a patch panel, a shallow switch, a PDU at the
// back), which leaves the other face's units free. rackFace is the face its
// front is on either way (the agreed scope). Before v8 the stored value was
// the other way round ('full', shallow by default); that step drops it.
// "half", "half depth", "shallow", "one face" and false are read as half;
// anything else, "full" included, is the default.
const asRackDepth = (v) => {
    if (v === false) return 'half';
    const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s_-]+/g, ' ') : '';
    return ['half', 'half depth', 'shallow', 'one face', 'single face'].includes(s) ? 'half' : undefined;
};
// Which side of the box its ports are on (Review-Packs/Topo-groups.md,
// "Round 5"; document v11): 'front' or 'rear' of the DEVICE, not of the
// rack, so a server keeps its ports on its back whichever face it is
// mounted on, and the rack view finds the rack face from that (rackPortsFace
// below). Network gear has its ports on its front and everything else on its
// back: that is the default, by type, and is not stored, so only a device
// that differs from its type carries the key (a server with front ports, a
// switch mounted ports-to-the-back). Read through the type, the value the
// type already says is dropped, so a sheet or a file that spells every
// device's face out comes back as the same document as one that says none.
// A VM or a container has no box and no ports of its own: never kept.
const PORTS_FRONT_TYPES = ['switch', 'l3switch', 'router', 'edge', 'firewall', 'vpn', 'ap', 'loadbalancer'];
const defaultPortsFace = (type) => (PORTS_FRONT_TYPES.includes(type) ? 'front' : 'rear');
const asPortsFace = (v, src) => {
    const f = asRackFace(v);
    return !f || !src || isVirtualType(src.type) || f === defaultPortsFace(src.type) ? undefined : f;
};

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
      } },
    // The radio's standard, bands, channels and broadcast SSIDs ("Wi-Fi"
    // below; document v12). Read and written on a wireless interface only,
    // as a faceplate's port names are only a switch's: a NIC made wired in
    // this session keeps it in memory, but it does not leave in a file or a
    // sealed link. In a spreadsheet it is several columns (RADIO_CSV_PARTS).
    { key: 'radio', kind: 'raw', omit: true, label: 'Radio',
      read: (v, src) => (ifaceIsWireless(src) ? normalizeRadio(v) : undefined),
      write: (v, rec) => (rec && ifaceIsWireless(rec) ? normalizeRadio(v) : undefined) }
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
      validate: (v) => isBlank(v) || asStatus(v) !== undefined, report: { key: 'status' } },
    // ---- Age and upkeep (document v14, "Age and upkeep" below) ----
    // When the box went into service (as much of the date as is known: a
    // year will do), when it was last serviced, and how often it should be,
    // in months. The age and the next service are worked out from these and
    // today's date, never stored. fromText reads what is typed or imported.
    { key: 'inService', kind: 'raw', read: asLooseDate, write: asLooseDate, label: 'In service since', csv: 'in_service', bulk: true,
      fromText: looseDateFromText },
    { key: 'serviced', kind: 'raw', read: asLooseDate, write: asLooseDate, label: 'Last serviced', csv: 'last_serviced', bulk: true,
      fromText: looseDateFromText },
    { key: 'serviceEvery', kind: 'raw', read: asServiceMonths, write: asServiceMonths, label: 'Service every (months)', csv: 'service_every_months', bulk: true,
      fromText: serviceMonthsFromText },
    // How many years this one is expected to last, when not its type's
    // (EXPECTED_LIFE_YEARS below): a server bought with a long contract.
    { key: 'lifeYears', kind: 'raw', read: asLifeYears, write: asLifeYears, label: 'Expected life (years)', csv: 'expected_life_years', bulk: true,
      fromText: lifeYearsFromText },
    // ---- Groups and racks (document v7, "Groups" below) ----
    // The group a device sits in, by id; its ancestors follow from the
    // group's parent chain, so nothing else is stored. A reference to a group
    // the document does not hold is dropped by normalizeGroupRefs() on load,
    // which, unlike this reader, can see the whole document.
    //
    // In a spreadsheet (devices.csv) the group is its path, not its id: an id
    // means nothing to the person filling in a sheet, and "Building A /
    // Server room / Rack 3" is what they would type. Import resolves the
    // path back to a group (findGroupByPath below), and makes the ones the
    // map lacks only when the review says so (js/csv.js). The table and the
    // bulk panel show the path too; neither reads this raw field as text.
    // ---- Custom columns (document v13, "Custom columns" below) ----
    // A device's values for the columns the document defines (doc.columns),
    // by column id. Read here as plain values only; which keys are kept and
    // what each must be is the document's to say (normalizeCustomRefs), as a
    // device's group is checked against the groups.
    { key: 'extra', kind: 'raw', label: 'Custom columns', read: asCustomBag, write: asCustomBag },
    { key: 'group', kind: 'raw', label: 'Group', read: asGroupRef, write: asGroupRef, csv: 'group',
      toText: (v) => { const g = groupById(v); return g ? groupPath(g) : ''; } },
    // Where in its rack: the lowest unit it occupies (1-based, counted from
    // the bottom as the rails are numbered), how many units it takes (1 is
    // the default and is not stored) and which face it is mounted on. Only
    // meaningful while node.group is a rack; kept otherwise, so a finding can
    // say so rather than the fields vanishing (placeFindings, js/diagnostics.js).
    // rackU is counted from the bottom even in a rack numbered from the top
    // (rack.numbering), and so is the spreadsheet's rack_u: the numbering
    // is how the rails are printed, not where a device is ("How a rack's
    // units are numbered", below), so a sheet means the same unit whichever
    // way the rack is numbered when it comes back.
    { key: 'rackU', kind: 'count', label: 'Rack U', read: asRackU, write: asRackU, csv: 'rack_u' },
    { key: 'rackHeight', kind: 'count', label: 'Rack height', read: asRackHeight, write: asRackHeight, csv: 'rack_height' },
    { key: 'rackFace', kind: 'raw', label: 'Rack face', read: asRackFace, write: asRackFace, csv: 'rack_face' },
    // 'half' or nothing (full depth, the default): asRackDepth above.
    { key: 'rackDepth', kind: 'raw', label: 'Rack depth', read: asRackDepth, write: asRackDepth, csv: 'rack_depth' },
    // The side of the device its ports are on, when it is not its type's
    // (asPortsFace above; document v11). The box's own fact, not its place,
    // so it is not one of RACK_KEYS: a switch taken out of a rack and put in
    // another still has its ports where they were. ports_face in a sheet
    // says the face whatever it is (csvPortsFace, js/csv.js).
    { key: 'portsFace', kind: 'raw', label: 'Ports face', read: asPortsFace, write: asPortsFace, csv: 'ports_face' },
    // ---- The device a VM or a container runs on (document v10, "Hosts" below) ----
    // Its host's id, read and written only on a virtual device (isVirtualType),
    // as siteRef is only a cloud's: a server that "runs on" another server is
    // not a thing this register can draw. Which hosts are allowed, and what
    // follows from having one (no units of its own, its host's group), needs
    // the whole document, so repairHosts() keeps it, on load and on every save.
    //
    // In a spreadsheet the host is its name (its id when two devices share the
    // name), under `runs_on`, not `host`: "Host" heads the hostname column of
    // half the inventories there are (CSV_ALIASES.name, js/csv.js).
    { key: 'host', kind: 'raw', label: 'Runs on', csv: 'runs_on',
      read: (v, src) => (isVirtualType(src.type) ? asGroupRef(v) : undefined),
      write: (v, src) => (src && isVirtualType(src.type) ? asGroupRef(v) : undefined),
      toText: (v) => hostRefText(v) }
];

// A cable's own facts (link.cable, plan section 4): the label on both ends of
// the run, its length and colour as written on the reel or the plan, and what
// it runs through, as free text ("PP-A:12 > WJ-3B"), because patch panels and
// wall jacks are not drawn as devices. Nested like a node's interfaces are, and
// read and written through this table the same way.
//
// The length is a number in metres or feet: typed as the number alone ("3",
// "2.5", "2,5") beside a pick of the unit (metres unless said otherwise),
// and kept as "2.5 m" or "8 ft", the text it always was, so files from
// before and builds from before read it unchanged. One written some other
// way in an older file ("about 3") is kept as it is until it is typed over.
const CABLE_UNITS = ['m', 'ft'];
const CABLE_UNIT_DEFAULT = 'm';
const CABLE_UNIT_WORDS = {
    m: ['m', 'mt', 'mts', 'meter', 'meters', 'metre', 'metres', 'metro', 'metros', 'м', 'метр', 'метра', 'метров', 'メートル'],
    ft: ['ft', 'feet', 'foot', "'", 'pie', 'pies', 'pé', 'pés', 'фут', 'фута', 'футов', 'フィート']
};
const CABLE_LENGTH_MAX = 10000;
const cableUnitOf = (word) => CABLE_UNITS.find((u) => CABLE_UNIT_WORDS[u].includes(String(word).toLowerCase())) || null;
// Typed or imported -> "2.5 m" / "8 ft", or null. A unit written after the
// number is that unit; with none, `unit` (the one picked beside the field).
function cableLengthFromText(text, unit = CABLE_UNIT_DEFAULT) {
    const r = /^(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:([^\d\s.,]+)\.?)?$/.exec(String(text == null ? '' : text).trim());
    if (!r) return null;
    const u = r[2] ? cableUnitOf(r[2]) : (CABLE_UNITS.includes(unit) ? unit : null);
    const n = Number(r[1].replace(',', '.'));
    return u && n > 0 && n <= CABLE_LENGTH_MAX ? String(n) + ' ' + u : null;
}
// A length kept as "2.5 m" or "8 ft" -> { n: '2.5', unit: 'm' }, or null
// for one written some other way.
function cableLengthParts(v) {
    const r = /^(\d+(?:\.\d+)?) (m|ft)$/.exec(String(v == null ? '' : v).trim());
    return r ? { n: r[1], unit: r[2] } : null;
}
const cableLengthNumber = (v) => { const p = cableLengthParts(v); return p ? p.n : null; };
// For sorting and adding up: the length in metres, or null.
const cableLengthMetres = (v) => { const p = cableLengthParts(v); return p ? Number(p.n) * (p.unit === 'ft' ? 0.3048 : 1) : null; };
// What a length field lets through as it is typed: digits and one decimal
// point or comma, nothing else (the unit is picked, never typed).
const cableLengthTyped = (text) => String(text == null ? '' : text).replace(/[^\d.,]/g, '')
    .replace(/^([^.,]*[.,])(.*)$/, (all, head, rest) => head + rest.replace(/[.,]/g, ''));
const CABLE_FIELDS = [
    { key: 'label', kind: 'text', omit: true, read: asOmittedText, label: 'Cable label', csv: 'cable_label', table: 'edit', validate: fieldOk.tag },
    { key: 'length', kind: 'text', omit: true, read: asOmittedText, label: 'Length', csv: 'cable_length', bulk: true, table: 'edit',
      fromText: cableLengthFromText },
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
    { key: 'cable', kind: 'raw', label: 'Cable', read: readCable, write: writeCable },
    // What a wireless association is: its SSID, band and signal ("Wi-Fi"
    // below; document v12). readLinkWifi both ways, so only those three
    // keys ever leave.
    { key: 'wifi', kind: 'raw', label: 'Wi-Fi', read: readLinkWifi, write: readLinkWifi }
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
// Wi-Fi (Review-Packs/Topo-wifi.md, document v12)
// ============================================================================
// Three records, each where the fact lives:
//   iface.radio   what a wireless interface's radio is: its standard and the
//                 bands it works on, with an AP's channel, width and power
//                 per band and the SSIDs it broadcasts there. { standard,
//                 bands: [{ band, channel, width, power, ssids }] }, every
//                 key optional. Kept on a wireless interface only (the
//                 IFACE_FIELDS row reads and writes it through
//                 ifaceIsWireless), so a NIC turned into a wired one does not
//                 carry a radio into a file or a sealed link.
//   doc.wifi      the Wi-Fi networks, a list of their own like the subnets:
//                 { id, ssid, security, bands, network, hidden }
//                 (WIFI_FIELDS). `network` is a declared subnet, which gives
//                 the VLAN through that subnet. There is no passphrase or PSK
//                 field, and there never will be (the owner's decision): a
//                 document travels in files and links, and a key written into
//                 one is a key given to everyone who ever holds it.
//   link.wifi     what one association is: { ssid, band, signal }, the SSID
//                 by its id in doc.wifi, the band, and the signal in dBm.
//
// Defaults and inference come before fields, so very little of it needs
// typing (the owner: "simplify the UI wherever possible"):
//   - a radio with no bands listed offers its standard's bands; with no
//     standard either it is unknown, and unknown is never a fault;
//   - an AP broadcasts on each band every SSID whose own bands include that
//     band, unless the band lists its SSIDs (apBandSsids);
//   - a Wi-Fi network is on every band unless it says otherwise;
//   - a link's SSID is the AP's only one when it broadcasts exactly one, and
//     its band the best band the client, the AP and the SSID all have
//     (linkWifiSsid, linkWifiBand). Neither is stored until somebody picks.
// Nothing here is checked: the checks are the diagnostics' (W2), which read
// these helpers, so a band the editor shows and a band a finding names are
// one answer.
//
// The vocabulary is the trade's and stays English in the full editor (SSID,
// WPA3, 5 GHz, 802.11ax, dBm): a standard is shown by its Wi-Fi Alliance
// name with the IEEE letters, "Wi-Fi 6 (802.11ax)".

// n, ac, ax, ax on 6 GHz (6E) and be, in the order they arrived. 'axe' is
// 6E: the same 802.11ax, and the one generation the letters cannot tell
// apart, so it has a key of its own.
const WIFI_STANDARDS = ['n', 'ac', 'ax', 'axe', 'be'];
const WIFI_STANDARD_INFO = {
    n: { name: 'Wi-Fi 4', ieee: '802.11n', bands: ['2.4', '5'], maxWidth: 40 },
    // An 802.11ac radio is 5 GHz only, but every Wi-Fi 5 access point and
    // card sold has an 802.11n radio beside it on 2.4 GHz, and that pair is
    // what "Wi-Fi 5" means on a box.
    ac: { name: 'Wi-Fi 5', ieee: '802.11ac', bands: ['2.4', '5'], maxWidth: 160 },
    ax: { name: 'Wi-Fi 6', ieee: '802.11ax', bands: ['2.4', '5'], maxWidth: 160 },
    axe: { name: 'Wi-Fi 6E', ieee: '802.11ax', bands: ['2.4', '5', '6'], maxWidth: 160 },
    be: { name: 'Wi-Fi 7', ieee: '802.11be', bands: ['2.4', '5', '6'], maxWidth: 320 }
};
// "Wi-Fi 6 (802.11ax)", or '' for no standard.
const wifiStandardName = (key) => { const s = WIFI_STANDARD_INFO[key]; return s ? s.name + ' (' + s.ieee + ')' : ''; };
// "Wi-Fi 6": the summary line's short form.
const wifiStandardShort = (key) => { const s = WIFI_STANDARD_INFO[key]; return s ? s.name : ''; };
// A standard however it is written: its key, its IEEE letters (802.11ax),
// its Wi-Fi name (Wi-Fi 6, wifi6e, 6E, 7), or the whole label this page
// prints. '' when it is none of them.
// Controllers also write "11ax" and the PHY names: HT, VHT, HE, EHT.
const WIFI_STANDARD_WORDS = { n: 'n', 4: 'n', ac: 'ac', 5: 'ac', ax: 'ax', 6: 'ax', axe: 'axe', '6e': 'axe', ax6e: 'axe', be: 'be', 7: 'be',
    ht: 'n', vht: 'ac', he: 'ax', eht: 'be' };
function wifiStandardWord(t) {
    const s = t.replace(/wi-?fi|802\.11|ieee|[\s_-]+/g, '').replace(/^11(?=[a-z])/, '');
    return Object.prototype.hasOwnProperty.call(WIFI_STANDARD_WORDS, s) ? WIFI_STANDARD_WORDS[s] : '';
}
function wifiStandardKey(v) {
    // "Wi-Fi 6E (802.11ax)": the name before the brackets says which, as
    // the letters inside cannot for 6 and 6E. Written the other way round,
    // "802.11ax (Wi-Fi 6E)", the letters outside read as plain 6, so a 6E
    // in the brackets wins: it is the more exact of the two answers.
    const t = asText(v).toLowerCase();
    const outside = wifiStandardWord(t.replace(/\(.*\)/, ''));
    const inner = t.match(/\((.*)\)/);
    return outside === 'ax' && inner && wifiStandardWord(inner[1]) === 'axe' ? 'axe' : outside;
}
const standardBands = (key) => (WIFI_STANDARD_INFO[key] ? WIFI_STANDARD_INFO[key].bands.slice() : null);

// The bands, low to high, and best first: a link left to its default goes on
// the highest band every side has, which is the faster and the less crowded.
const WIFI_BANDS = ['2.4', '5', '6'];
const WIFI_BANDS_BEST = ['6', '5', '2.4'];
const wifiBandName = (band) => (WIFI_BANDS.includes(band) ? band + ' GHz' : '');
// A band however it is written: 2.4, "2.4 GHz", 2g, 2, 24, 5g, 6e...
function wifiBandKey(v) {
    const s = asText(v).toLowerCase().replace(/\s+/g, '').replace(/ghz$|g$|e$/, '');
    if (['2.4', '2', '24', '2,4'].includes(s)) return '2.4';
    if (s === '5' || s === '6') return s;
    return '';
}
// A list of bands, from a list or from one cell ("2.4 5", "2.4 GHz, 5 GHz"):
// each once, low to high. An unknown word makes it null, so a cell that says
// something else is refused rather than read as fewer bands.
// "2,4 GHz" is 2.4 written with a decimal comma (Spanish, Portuguese,
// Russian), and is read as one band before the commas between bands are.
function wifiBandList(v) {
    const words = Array.isArray(v) ? v : asText(v).replace(/(^|[^\d.])2,4(?!\d)/g, '$12.4').replace(/ghz/gi, ' ').split(/[\s,;/+&]+/).filter(Boolean);
    const keys = words.map(wifiBandKey);
    if (keys.some((k) => !k)) return null;
    return WIFI_BANDS.filter((b) => keys.includes(b));
}

// A 20 MHz channel is the unit everything below counts in. Wider ones are
// bonded blocks of them, and two radios on overlapping blocks share the air.
const WIFI_WIDTHS = [20, 40, 80, 160, 320];
// A whole number, or a string of one with its unit around it ("80 MHz").
const asWifiNumber = (v, unit) => {
    const s = typeof v === 'string' ? v.trim().toLowerCase().replace(unit, '').trim() : v;
    const n = typeof s === 'string' && /^-?\d+$/.test(s) ? Number(s) : s;
    return Number.isInteger(n) ? n : undefined;
};
// Kept when it is a channel number at all, valid for its band or not: a 5
// GHz channel 13 is a slip somebody has to see, and the channel check says so
// (wifiChannelValid). Blank or 0 is "auto", which is no value.
const asWifiChannel = (v) => { const n = asWifiNumber(v, /^ch(annel)?\s*/); return n !== undefined && n >= 1 && n <= 255 ? n : undefined; };
// One of the widths, or none ("auto").
const asWifiWidth = (v) => { const n = asWifiNumber(v, /\s*mhz$/); return WIFI_WIDTHS.includes(n) ? n : undefined; };
// Transmit power in dBm, as a controller shows it: optional, a whole number.
const asWifiPower = (v) => { const n = asWifiNumber(v, /\s*dbm$/); return n !== undefined && n >= -20 && n <= 40 ? n : undefined; };
// The signal of an association in dBm, -100 to 0. A signal is never
// positive, so a 67 typed without its sign is -67, not a refusal.
const asWifiSignal = (v) => {
    let n = asWifiNumber(v, /\s*dbm$/);
    if (n !== undefined && n > 0 && n <= 100) n = -n;
    return n !== undefined && n >= -100 && n <= 0 ? n : undefined;
};

// 2.4 GHz: 1 to 14. 5 GHz: the 20 MHz channels a regulator has ever opened,
// 36 to 177. 6 GHz: 1 to 233 in steps of 4 (1, 5, 9...).
const WIFI_5G_CHANNELS = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144,
    149, 153, 157, 161, 165, 169, 173, 177];
function wifiChannelValid(band, channel) {
    if (!Number.isInteger(channel)) return false;
    if (band === '2.4') return channel >= 1 && channel <= 14;
    if (band === '5') return WIFI_5G_CHANNELS.includes(channel);
    if (band === '6') return channel >= 1 && channel <= 233 && (channel - 1) % 4 === 0;
    return false;
}
// 2.4 GHz is at most 40 MHz wide, 320 MHz is 6 GHz only, and a standard is
// at most as wide as it can bond (Wi-Fi 4: 40, Wi-Fi 5 and 6: 160, Wi-Fi 7:
// 320). No width is auto, and no standard is unknown: neither is a fault.
function wifiWidthValid(band, width, standard) {
    if (width === undefined || width === null) return true;
    if (!WIFI_WIDTHS.includes(width)) return false;
    if (band === '2.4' && width > 40) return false;
    if (width === 320 && band !== '6') return false;
    const s = WIFI_STANDARD_INFO[standard];
    return !s || width <= s.maxWidth;
}
// The frequencies a channel of this width takes, [low, high] in MHz, or null
// when the channel is unknown or invalid. 2.4 GHz channels are 5 MHz apart
// and 22 MHz wide, which is why only 1, 6 and 11 stay clear of each other; a
// 40 MHz one there bonds the channel four above it (four below from 8 up,
// where above would leave the band). On 5 and 6 GHz a wide channel is the
// aligned block its primary falls in: 36-48 for 80 MHz on 36, 40, 44 or 48,
// and from 149 up the blocks start again at 149.
function wifiChannelSpan(band, channel, width) {
    if (!wifiChannelValid(band, channel)) return null;
    const w = WIFI_WIDTHS.includes(width) ? width : 20;
    if (band === '2.4') {
        const centre = channel === 14 ? 2484 : 2407 + 5 * channel;
        if (w < 40) return [centre - 11, centre + 11];
        const mid = channel <= 7 ? centre + 10 : centre - 10;
        return [mid - 20, mid + 20];
    }
    const block = 4 * (w / 20);
    const base = band === '5' ? (channel >= 149 ? 149 : 36) : 1;
    const lo = base + Math.floor((channel - base) / block) * block;
    const hi = lo + block - 4;
    const f0 = band === '5' ? 5000 : 5950;
    return [f0 + 5 * lo - 10, f0 + 5 * hi + 10];
}
// Two radios' channels share air: the same band and overlapping spans. a and
// b are { band, channel, width }; an unknown channel overlaps nothing.
function wifiChannelsOverlap(a, b) {
    if (!a || !b || a.band !== b.band) return false;
    const x = wifiChannelSpan(a.band, a.channel, a.width), y = wifiChannelSpan(b.band, b.channel, b.width);
    return !!x && !!y && x[0] < y[1] && y[0] < x[1];
}

// Security, by key. WEP and WPA (TKIP) are here only so that a real site can
// be written down as it is and then flagged.
const WIFI_SECURITY = ['open', 'owe', 'wpa2', 'wpa3', 'wpa2/3', 'wpa2-ent', 'wpa3-ent', 'wep', 'wpa'];
const WIFI_SECURITY_NAMES = { open: 'Open', owe: 'OWE (Enhanced Open)', wpa2: 'WPA2-Personal', wpa3: 'WPA3-Personal', 'wpa2/3': 'WPA2/WPA3-Personal',
    'wpa2-ent': 'WPA2-Enterprise', 'wpa3-ent': 'WPA3-Enterprise', wep: 'WEP', wpa: 'WPA (TKIP)' };
const wifiSecurityName = (key) => WIFI_SECURITY_NAMES[key] || '';
// A security mode however a controller or a person writes it: its key, its
// name, WPA2-PSK, SAE, "WPA2/WPA3", "Enhanced Open"... '' when none of them.
const WIFI_SECURITY_WORDS = {
    open: 'open', none: 'open', opn: 'open', owe: 'owe', enhancedopen: 'owe', oweenhancedopen: 'owe',
    wpa2: 'wpa2', wpa2personal: 'wpa2', wpa2psk: 'wpa2', wpa3: 'wpa3', wpa3personal: 'wpa3', wpa3sae: 'wpa3', sae: 'wpa3',
    'wpa2/3': 'wpa2/3', 'wpa2/wpa3': 'wpa2/3', 'wpa2/wpa3personal': 'wpa2/3', wpa2wpa3: 'wpa2/3', wpa3transition: 'wpa2/3', 'wpa2/3personal': 'wpa2/3',
    wpa2ent: 'wpa2-ent', wpa2enterprise: 'wpa2-ent', wpa2eap: 'wpa2-ent', wpa3ent: 'wpa3-ent', wpa3enterprise: 'wpa3-ent', wpa3eap: 'wpa3-ent',
    wep: 'wep', wpa: 'wpa', wpapsk: 'wpa', wpatkip: 'wpa', wpa1: 'wpa', wpapersonal: 'wpa',
    // WPA/WPA2 mixed still lets TKIP clients on: it is as weak as WPA.
    'wpa/wpa2': 'wpa', 'wpa/wpa2personal': 'wpa', wpawpa2: 'wpa', 'wpapsk/wpa2psk': 'wpa',
    'wpa2psk/wpa3sae': 'wpa2/3', 'wpa2/wpa3sae': 'wpa2/3',
    noencryption: 'open', unencrypted: 'open', unsecured: 'open', disabled: 'open'
};
// The cipher and the "mixed" a controller adds after the mode say nothing
// the mode does not ("WPA2 PSK AES", "WPA2/WPA3 Personal Mixed").
const WIFI_SECURITY_NOISE = /aes|ccmp(128|256)?|gcmp(128|256)?|mixed|mode/g;
function wifiSecurityKey(v) {
    const t = asText(v).toLowerCase();
    // As written first ("OWE (Enhanced Open)"), then without what the
    // brackets add ("WPA2-Personal (AES)", "Open (no encryption)"), then
    // without the cipher too.
    const tries = [t, t.replace(/\(.*?\)/g, '')].map((x) => x.replace(/[\s_()-]+/g, ''));
    tries.push(...tries.map((x) => x.replace(WIFI_SECURITY_NOISE, '')));
    const hit = tries.find((x) => x && Object.prototype.hasOwnProperty.call(WIFI_SECURITY_WORDS, x));
    if (hit) return WIFI_SECURITY_WORDS[hit];
    // WPA3 "transition" mode is WPA2/WPA3 however it is dressed: "WPA3
    // Transition", "WPA2/WPA3 Transitional", "WPA3-Personal Transition".
    return tries.some((x) => /^(wpa2\/?(wpa)?|wpa)3(personal|sae|psk)*transition(al)?$/.test(x)) ? 'wpa2/3' : '';
}

// ---- iface.radio ----
// Rebuilt key by key, as a bond is: nothing a hand-edited file puts inside
// it rides along. Bands once each, low to high. Left off altogether when it
// says nothing, so a radio nobody described carries no key.
function normalizeRadio(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const standard = wifiStandardKey(v.standard);
    const bands = [];
    (Array.isArray(v.bands) ? v.bands : []).forEach((b) => {
        const entry = b && typeof b === 'object' ? b : { band: b };
        const band = wifiBandKey(entry.band);
        if (!band || bands.some((x) => x.band === band)) return;
        const out = { band };
        const channel = asWifiChannel(entry.channel), width = asWifiWidth(entry.width), power = asWifiPower(entry.power);
        if (channel !== undefined) out.channel = channel;
        if (width !== undefined) out.width = width;
        if (power !== undefined) out.power = power;
        // Which SSIDs this band broadcasts, by id. Absent is the default
        // (every SSID on the band); an empty list is a band that broadcasts
        // none (a mesh backhaul), and is kept.
        if (Array.isArray(entry.ssids)) out.ssids = [...new Set(entry.ssids.map(asGroupRef).filter(Boolean))];
        bands.push(out);
    });
    bands.sort((a, b) => WIFI_BANDS.indexOf(a.band) - WIFI_BANDS.indexOf(b.band));
    if (!standard && !bands.length) return undefined;
    const out = {};
    if (standard) out.standard = standard;
    if (bands.length) out.bands = bands;
    return out;
}
// A new access point's radio: Wi-Fi 6 on 2.4 and 5 GHz, channel and width
// left to auto (the agreed default). A new client's radio is left blank:
// unknown, and never flagged.
const defaultApRadio = () => ({ standard: 'ax', bands: [{ band: '2.4' }, { band: '5' }] });
const radioOf = (iface) => (iface && iface.radio && typeof iface.radio === 'object' ? iface.radio : null);
const radioBand = (radio, band) => (radio && Array.isArray(radio.bands) ? radio.bands.find((b) => b && b.band === band) || null : null);
// The bands a radio offers: the ones it lists, else its standard's, else
// null (unknown, which every check reads as "could be any").
function radioBands(radio) {
    if (radio && Array.isArray(radio.bands) && radio.bands.length) return WIFI_BANDS.filter((b) => radio.bands.some((x) => x && x.band === b));
    return radio ? standardBands(radio.standard) : null;
}
// The bands two radios (or any two band lists) have in common, best first;
// one unknown side leaves the other's, and both unknown is null.
function commonWifiBands(a, b) {
    if (!a && !b) return null;
    return WIFI_BANDS_BEST.filter((x) => (!a || a.includes(x)) && (!b || b.includes(x)));
}

// ---- doc.wifi ----
const WIFI_SSID_MAX = 64;
// One line, trimmed. An SSID is at most 32 bytes on the air; the record keeps
// a little more rather than cut a name somebody typed in another script.
const wifiSsidText = (v) => portText(v).trim().slice(0, WIFI_SSID_MAX);
// Every band is the default and is not stored, nor is a list that names none.
const asWifiBands = (v) => { const l = wifiBandList(v); return l && l.length && l.length < WIFI_BANDS.length ? l : undefined; };
const asWifiSecurity = (v) => wifiSecurityKey(v) || undefined;

// The order is the key order of the JSON (see the schema's header).
const WIFI_FIELDS = [
    // Links and radios name a network by id, so a missing one is minted.
    { key: 'id', kind: 'raw', read: (v) => asGroupRef(v) || nextId('wf'), label: 'ID', csv: 'wifi_id' },
    { key: 'ssid', kind: 'raw', read: wifiSsidText, write: wifiSsidText, label: 'SSID', csv: 'ssid', table: 'edit' },
    { key: 'security', kind: 'raw', read: asWifiSecurity, write: asWifiSecurity, label: 'Security', csv: 'security', table: 'edit',
      validate: (v) => isBlank(v) || !!wifiSecurityKey(v) },
    { key: 'bands', kind: 'raw', read: asWifiBands, write: asWifiBands, label: 'Bands', csv: 'bands', table: 'edit',
      validate: (v) => isBlank(v) || !!(wifiBandList(v) || []).length },
    // A declared subnet, by id (normalizeWifiRefs drops one the document
    // does not hold). In a spreadsheet it is the subnet's CIDR.
    { key: 'network', kind: 'raw', read: asGroupRef, write: asGroupRef, label: 'Subnet', csv: 'subnet' },
    { key: 'hidden', kind: 'flag', label: 'Hidden network', csv: 'hidden', table: 'edit' }
];
// Load: coerced through the table, one record per id (a repeated id is
// reminted, as a network's is). Mutates nothing it is given.
function normalizeWifi(list) {
    const ids = new Set();
    return (Array.isArray(list) ? list : [])
        .filter((w) => w && typeof w === 'object' && !Array.isArray(w))
        .map((w) => readFields(WIFI_FIELDS, w))
        .map((w) => { if (ids.has(w.id)) w.id = nextId('wf'); ids.add(w.id); return w; });
}
// Save: no key at all when there are none, so a document that never had a
// Wi-Fi network serializes as it did before they existed.
const serializeWifi = (list) => (list && list.length ? list.map((w) => writeFields(WIFI_FIELDS, w)) : undefined);
const makeWifi = (fields) => readFields(WIFI_FIELDS, Object.assign({ id: nextId('wf') }, fields));
// Every reference into doc.wifi and out of it must name a record the
// document holds: a network's subnet, a link's SSID, a radio band's SSID
// list. One that does not is dropped (the default answers instead). A band
// whose whole list named networks that are gone goes back to the default
// too: the list said nothing about the networks that are left. In place; on
// every load, and what the editor runs after deleting a Wi-Fi network or a
// subnet.
function normalizeWifiRefs(nodes = state.nodes, links = state.links, networks = state.networks, wifi = state.wifi) {
    const nets = new Set((networks || []).map((n) => n.id)), ids = new Set((wifi || []).map((w) => w.id));
    (wifi || []).forEach((w) => { if (w.network !== undefined && !nets.has(w.network)) delete w.network; });
    (links || []).forEach((l) => {
        if (!l || !l.wifi || l.wifi.ssid === undefined || ids.has(l.wifi.ssid)) return;
        delete l.wifi.ssid;
        if (!Object.keys(l.wifi).length) delete l.wifi;
    });
    (nodes || []).forEach((n) => (n && Array.isArray(n.interfaces) ? n.interfaces : []).forEach((i) => {
        const radio = radioOf(i);
        (radio && Array.isArray(radio.bands) ? radio.bands : []).forEach((b) => {
            if (!Array.isArray(b.ssids)) return;
            const kept = b.ssids.filter((id) => ids.has(id));
            if (kept.length === b.ssids.length) return;
            if (kept.length) b.ssids = kept; else delete b.ssids;
        });
    }));
}
const wifiById = (id, wifi = state.wifi) => (id ? (wifi || []).find((w) => w.id === id) || null : null);
// What a network is called where it is listed: its SSID, or a plain word
// while it has none.
const wifiLabel = (w) => (w ? (w.ssid || t('Wi-Fi network')) : '');
const wifiBandsOf = (w) => (w && Array.isArray(w.bands) && w.bands.length ? w.bands.slice() : WIFI_BANDS.slice());

// ---- What an access point broadcasts ----
// The SSIDs one band of a radio broadcasts: the ones it lists (those that
// still exist), else every network whose own bands include the band, so
// nobody has to tick boxes for the common case.
function apBandSsids(radio, band, wifi = state.wifi) {
    const entry = radioBand(radio, band);
    if (entry && Array.isArray(entry.ssids)) return entry.ssids.filter((id) => !!wifiById(id, wifi));
    return (wifi || []).filter((w) => wifiBandsOf(w).includes(band)).map((w) => w.id);
}
// Every SSID a radio broadcasts on any of its bands, in the list's order. A
// radio whose bands are unknown is taken to have them all.
function apSsids(radio, wifi = state.wifi) {
    const bands = radioBands(radio) || WIFI_BANDS;
    const on = new Set();
    bands.forEach((b) => apBandSsids(radio, b, wifi).forEach((id) => on.add(id)));
    return (wifi || []).filter((w) => on.has(w.id)).map((w) => w.id);
}

// The access points (and home routers) broadcasting a network: the Wi-Fi
// tab's "Broadcast by", and the devices a security finding names.
function wifiBroadcasters(id, nodes = state.nodes, wifi = state.wifi) {
    return nodes.filter((n) => radioServes(n)
        && (n.interfaces || []).some((i) => ifaceIsWireless(i) && apSsids(radioOf(i), wifi).includes(id)));
}

// ---- link.wifi ----
// Kept on any link, as a cable's facts are kept on a radio link: the editor
// shows it on a wireless one only, and a link turned back into a cable keeps
// it for when it is turned round again.
function readLinkWifi(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    const ssid = asGroupRef(v.ssid), band = wifiBandKey(v.band), signal = asWifiSignal(v.signal);
    if (ssid) out.ssid = ssid;
    if (band) out.band = band;
    if (signal !== undefined) out.signal = signal;
    return Object.keys(out).length ? out : undefined;
}
const linkWifiOf = (link, key) => (link && link.wifi && link.wifi[key] !== undefined ? link.wifi[key] : undefined);
// Sets one fact, dropping the object when it ends up empty. Returns the link.
function setLinkWifi(link, key, value) {
    link.wifi = readLinkWifi(Object.assign({}, link.wifi || {}, { [key]: value }));
    if (!link.wifi) delete link.wifi;
    return link;
}
// A device that serves clients by radio: an AP, or a router, firewall or the
// like with a radio of its own (a home router). wifiLinkEnds below ranks the
// two ends of an association the same way. The Wi-Fi tab (js/wifi.js) and
// the checks (js/diagnostics.js) both ask it who broadcasts a network.
const radioServes = (node) => !!node && (node.type === 'ap' || isRoutingDevice(node.type));
// The two ends of a wireless link, and which of them is the access point:
// an AP, else a router, firewall or the like with a radio (a home router),
// else neither (two clients, or a bridge). Between two APs (a mesh
// backhaul) the source is taken as the AP. Null for a link that is not
// wireless. -> { ends: [end, end], ap, client }, an end being { node, iface }.
function wifiLinkEnds(link, src, tgt) {
    src = src || getNode(link && link.source);
    tgt = tgt || getNode(link && link.target);
    if (!src || !tgt || effectiveMedium(link, src, tgt) !== 'wireless') return null;
    const a = { node: src, iface: explicitIface(src, link.sourceIface) }, b = { node: tgt, iface: explicitIface(tgt, link.targetIface) };
    const rank = (e) => (e.node.type === 'ap' ? 2 : isRoutingDevice(e.node.type) ? 1 : 0);
    if (!rank(a) && !rank(b)) return { ends: [a, b], ap: null, client: null };
    return rank(b) > rank(a) ? { ends: [a, b], ap: b, client: a } : { ends: [a, b], ap: a, client: b };
}
// The SSID a link is on: the one it names, else the AP's only one when it
// broadcasts exactly one, else the one of those whose subnet holds the
// client's address (a phone on 10.2.0.21 is on Guest, 10.2.0.0/24), else
// null (not known). The client's address is the one on its end of the link,
// else any of its own, but only when they all point at the same SSID.
// Between two devices that both serve radio (a mesh backhaul, an AP on a
// home router's radio) nothing is worked out: the far one is not a client
// joining a network, and taking the first AP's SSID would count it among
// that network's clients and test its management address against the
// SSID's subnet.
function linkWifiSsid(link, wifi = state.wifi) {
    const own = linkWifiOf(link, 'ssid');
    if (own && wifiById(own, wifi)) return own;
    const e = wifiLinkEnds(link);
    if (!e || !e.ap || radioServes(e.client.node)) return null;
    const all = apSsids(radioOf(e.ap.iface), wifi);
    if (all.length < 2) return all.length ? all[0] : null;
    const bySubnet = all.filter((id) => { const w = wifiById(id, wifi); return !!w && !!w.network; });
    if (!bySubnet.length) return null;
    const endIp = e.client.iface && parseValidCIDR(e.client.iface.ip);
    const ips = endIp ? [endIp] : getValidIps(e.client.node);
    const hits = new Set();
    ips.forEach((p) => {
        const net = networkOfIp(p.ip);
        if (net) bySubnet.forEach((id) => { if (wifiById(id, wifi).network === net.id) hits.add(id); });
    });
    return hits.size === 1 ? [...hits][0] : null;
}
// The band a link is on: the one it names, else the best band every side
// that is known has: the client's radio, the AP's radio (only the bands it
// broadcasts the link's SSID on, when that is known) and the SSID's own
// bands. Null when nothing is known, or when the sides have no band in
// common (a finding's business, not a guess's).
function linkWifiBand(link, wifi = state.wifi) {
    const e = wifiLinkEnds(link);
    if (!e) return null;
    const own = linkWifiOf(link, 'band');
    if (own) return own;
    const ssid = linkWifiSsid(link, wifi);
    const net = ssid ? wifiById(ssid, wifi) : null;
    const sides = e.ends.map((end) => {
        const radio = radioOf(end.iface);
        const bands = radioBands(radio);
        return bands && net && end === e.ap ? bands.filter((b) => apBandSsids(radio, b, wifi).includes(ssid)) : bands;
    });
    if (net) sides.push(wifiBandsOf(net));
    const known = sides.filter(Boolean);
    if (!known.length) return null;
    return WIFI_BANDS_BEST.find((b) => known.every((s) => s.includes(b))) || null;
}

// The radio in one line, for the collapsed editor and the table: "Wi-Fi 6 ·
// 2.4 GHz ch 6 · 5 GHz ch 36/80 · Staff, Guest". The SSIDs only on an AP
// (withSsids), where they are what it broadcasts. '' for a radio that says
// nothing.
function radioSummary(radio, withSsids = false, wifi = state.wifi) {
    if (!radio) return '';
    const parts = [];
    if (radio.standard) parts.push(wifiStandardShort(radio.standard));
    (radio.bands || []).forEach((b) => {
        const width = b.width ? '/' + b.width : '';
        const ch = b.channel !== undefined ? ' ch ' + b.channel + width : (b.width ? ' ' + b.width + ' MHz' : '');
        parts.push(wifiBandName(b.band) + ch);
    });
    if (withSsids) {
        const names = apSsids(radio, wifi).map((id) => wifiLabel(wifiById(id, wifi)));
        if (names.length) parts.push(names.join(', '));
    }
    return parts.join(' · ');
}

// ---- In a spreadsheet (interfaces.csv) ----
// A radio is one value and a row is cells, so it travels as parts: the
// standard, the bands it lists, and per band its channel, width, power and
// the SSIDs it broadcasts (ch_2g, width_5g, ssids_6g...). A blank cell says
// nothing, as everywhere in a sheet; a band's SSIDs are written by name
// ("none" for a band that broadcasts none, blank for the default).
const WIFI_BAND_CSV = { '2.4': '2g', 5: '5g', 6: '6g' };
const RADIO_CSV_PARTS = [
    { part: 'standard', csv: 'standard', label: 'Wi-Fi standard' },
    { part: 'bands', csv: 'bands', label: 'Bands' }
].concat(...[['channel', 'ch', 'Channel'], ['width', 'width', 'Width'], ['power', 'power', 'Power (dBm)'], ['ssids', 'ssids', 'SSID list']]
    .map(([attr, stem, label]) => WIFI_BANDS.map((band) => {
        const name = stem + '_' + WIFI_BAND_CSV[band];
        return { part: name, csv: name, label: label + ' ' + band + ' GHz', band, attr };
    })));
const radioCsvPart = (part) => RADIO_CSV_PARTS.find((p) => p.part === part) || null;
// The part's value as stored: the standard's key, the bands as "2.4 5", a
// band's number, or its SSID ids (an array). Undefined when it says nothing.
function radioPartValue(radio, part) {
    const p = radioCsvPart(part);
    if (!p || !radio) return undefined;
    if (part === 'standard') return radio.standard || undefined;
    if (part === 'bands') return radio.bands && radio.bands.length ? radio.bands.map((b) => b.band).join(' ') : undefined;
    const b = radioBand(radio, p.band);
    return b ? b[p.attr] : undefined;
}
// A radio with parts laid over it: the standard; the bands (those it lists
// now, keeping what each already says); then each band's facts, which list
// their band if it was not. -> the normalized radio, or undefined.
function applyRadioParts(radio, parts) {
    const r = cloneData(radio || {});
    r.bands = Array.isArray(r.bands) ? r.bands : [];
    if (parts.standard !== undefined) r.standard = parts.standard;
    if (parts.bands !== undefined) {
        const want = wifiBandList(parts.bands) || [];
        r.bands = want.map((band) => r.bands.find((b) => b.band === band) || { band });
    }
    RADIO_CSV_PARTS.forEach((p) => {
        if (!p.attr || parts[p.part] === undefined) return;
        let b = r.bands.find((x) => x.band === p.band);
        if (!b) { b = { band: p.band }; r.bands.push(b); }
        b[p.attr] = parts[p.part];
    });
    return normalizeRadio(r);
}

// ============================================================================
// Groups (Review-Packs/Topo-groups.md, document v7)
// ============================================================================
// Where devices physically or administratively sit: a building, a floor, a
// room, a rack, or a group of the user's own. A group is a record of its own,
// doc.groups, like a network, and a device names the one it is in
// (node.group); a group names its parent, so "Building A / Server room /
// Rack 3" is three records and one reference on the device. A device is in at
// most one group, and is in every ancestor of it by the chain.
//
// The words are chosen around the ones already taken: a "zone" is the subnet
// bubble on the map, a "block" a saved selection, a "network" the document.
//
// Collapsing a group on the map is a view, not data, and is not stored here.
// One card per site: groups go from the building down inside one document,
// and several sites stay the library's cards and the binder.
//
// A rack adds its size ("Round 2", item 4): its height in units (uHeight, 42
// by default), its width (10", 19" or 23"; 19" by default), how deep it is in
// millimetres (depthMm, optional: informative, printed in the rack view's
// head and the report, never checked against anything, since no device
// carries a depth to check) and which way its units are numbered (numbering
// 'top' for top-down; bottom-up, the default, is not stored). A device in one
// adds where it sits (rackU, rackHeight, rackFace, rackDepth in NODE_FIELDS).
const GROUP_KINDS = ['building', 'floor', 'room', 'rack', 'custom'];
const RACK_WIDTHS = ['10in', '19in', '23in'];
const RACK_WIDTH_DEFAULT = '19in';
// The heights racks are sold in, offered first; any other is a custom one.
const RACK_U_PRESETS = [4, 6, 9, 12, 18, 24, 27, 42, 45, 47, 48];
// A depth in mm: a wall box is about 300, a deep server rack 1200. Past this
// it is a slip (a depth typed in cm twice over), not a rack.
const RACK_DEPTH_MM_MAX = 3000;
const GROUP_NAME_MAX = 80;
const asGroupKind = (v) => { const s = typeof v === 'string' ? v.trim().toLowerCase() : ''; return GROUP_KINDS.includes(s) ? s : 'custom'; };
const isRackGroup = (g) => !!g && g.kind === 'rack';
// One line, as a path is printed on a report and a label.
const groupName = (v) => portText(v).trim().slice(0, GROUP_NAME_MAX);
// The rack fields are read off a rack and written only for one: a rack turned
// into a room in this session keeps its height in memory (turning it back
// gives it back), as a switch keeps its port labels.
const rackOnly = (fn) => (v, src) => (src && asGroupKind(src.kind) === 'rack' ? fn(v) : undefined);
const asRackSize = (v) => { const n = asUnits(v); return n === undefined ? RACK_U_DEFAULT : Math.min(RACK_U_MAX, Math.max(1, n)); };
// '19in', or the way a sheet or a person writes it: 19, 19", 19 in, 19″,
// 19 inch. Anything else is the default.
const rackWidthKey = (v) => {
    const s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '').replace(/(["″”]|inch(es)?)$/, 'in');
    const k = /^\d+$/.test(s) ? `${s}in` : s;
    return RACK_WIDTHS.includes(k) ? k : undefined;
};
const asRackWidth = (v) => rackWidthKey(v) || RACK_WIDTH_DEFAULT;
// A whole number of millimetres, or nothing: a blank, a zero or a word is
// no depth given (it is optional), not a depth of zero.
const asRackDepthMm = (v) => { const n = asUnits(v); return n === undefined || n < 1 ? undefined : Math.min(RACK_DEPTH_MM_MAX, n); };
// Top-down is stored as 'top'; bottom-up, as the rails of most racks are
// printed, is the default and is not. "top down", "top-down", "descending"
// and the like are read as top; anything else is bottom-up.
const asRackNumbering = (v) => {
    const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s_-]+/g, ' ') : '';
    return ['top', 'top down', 'from the top', 'descending', 'top to bottom'].includes(s) ? 'top' : undefined;
};

// Every field is `omit` in spirit: a group that is not a rack carries no
// rack keys, and one at the top carries no parent.
const GROUP_FIELDS = [
    // Devices name a group by id, so a missing one is minted, as an
    // interface's is.
    { key: 'id', kind: 'raw', read: (v) => asGroupRef(v) || nextId('g'), label: 'ID', csv: 'group_id' },
    // A blank name reads as the kind ("Rack"; groupLabel) and is not stored.
    { key: 'name', kind: 'raw', read: groupName, write: (v) => groupName(v) || undefined, label: 'Name', csv: 'name' },
    { key: 'kind', kind: 'raw', read: asGroupKind, write: asGroupKind, label: 'Kind', csv: 'kind',
      validate: (v) => isBlank(v) || GROUP_KINDS.includes(String(v).trim().toLowerCase()) },
    // Held as null at the top, written only when there is one (the way a
    // cable's port is). normalizeGroups() drops one that names no group or
    // closes a loop.
    { key: 'parent', kind: 'raw', read: (v) => asGroupRef(v) || null, write: (v) => v || undefined, label: 'Parent', csv: 'parent' },
    { key: 'uHeight', kind: 'count', read: rackOnly(asRackSize), write: rackOnly(asRackSize), label: 'Height (U)', csv: 'u_height' },
    { key: 'width', kind: 'raw', read: rackOnly(asRackWidth), write: rackOnly(asRackWidth), label: 'Width', csv: 'width' },
    { key: 'depthMm', kind: 'count', read: rackOnly(asRackDepthMm), write: rackOnly(asRackDepthMm), label: 'Depth (mm)', csv: 'depth_mm' },
    { key: 'numbering', kind: 'raw', read: rackOnly(asRackNumbering), write: rackOnly(asRackNumbering), label: 'Numbering', csv: 'numbering' }
];

// Load: coerced through the table, one record per id (a repeated id is
// reminted, as a network's is: the first keeps its devices), and the parent
// chains made sound. A parent that is not a group is dropped, and a chain
// that comes back to itself is cut where it closes, walking the list in
// order so the same document always comes out the same. Mutates nothing
// it is given.
function normalizeGroups(list) {
    const ids = new Set();
    const out = (Array.isArray(list) ? list : [])
        .filter((g) => g && typeof g === 'object' && !Array.isArray(g))
        .map((g) => readFields(GROUP_FIELDS, g))
        .map((g) => { if (ids.has(g.id)) g.id = nextId('g'); ids.add(g.id); return g; });
    return repairGroupParents(out);
}
// The parent rule on its own, in place: no parent that is not in `groups`,
// none that is the group itself, and no loop. Returns the list. Every edit
// that re-parents asks groupParentOk() first, so in the editor this only
// ever has work to do on a document that arrived broken.
function repairGroupParents(groups) {
    const byId = new Map(groups.map((g) => [g.id, g]));
    groups.forEach((g) => { if (g.parent && (!byId.has(g.parent) || g.parent === g.id)) g.parent = null; });
    groups.forEach((g) => {
        const seen = new Set([g.id]);
        let cur = g;
        while (cur.parent) {
            if (seen.has(cur.parent)) { cur.parent = null; break; }
            seen.add(cur.parent);
            cur = byId.get(cur.parent);
        }
    });
    return groups;
}
// Each device's group must be one the document holds; a reference to one that
// is gone is dropped (the device is ungrouped, its rack fields kept for the
// finding to name). In place; `nodes` and `groups` as loaded.
function normalizeGroupRefs(nodes, groups) {
    const ids = new Set((groups || []).map((g) => g.id));
    (nodes || []).forEach((n) => { if (n && n.group !== undefined && !ids.has(n.group)) delete n.group; });
}
// Save: left out altogether when there are none, so a document that never
// made a group serializes as it did before groups existed.
const serializeGroups = (list) => (list && list.length ? list.map((g) => writeFields(GROUP_FIELDS, g)) : undefined);
const makeGroup = (fields) => readFields(GROUP_FIELDS, Object.assign({ id: nextId('g') }, fields));

// ---- Reading the tree ----
// `groups` defaults to the live list; the report and the binder pass their
// own. Every walk is bounded by a seen set, so even a list that skipped the
// normalizer (a scratch copy) cannot hang one.
const groupById = (id, groups = state.groups) => (id ? (groups || []).find((g) => g.id === id) || null : null);
// The group and its ancestors, outermost first.
function groupChain(group, groups = state.groups) {
    const out = [];
    const seen = new Set();
    for (let g = group; g && !seen.has(g.id); g = groupById(g.parent, groups)) { seen.add(g.id); out.unshift(g); }
    return out;
}
// What a group is called on screen: its name, else its kind ("Rack").
const GROUP_KIND_NAMES = { building: 'Building', floor: 'Floor', room: 'Room', rack: 'Rack', custom: 'Group' };
const groupKindName = (kind) => t(GROUP_KIND_NAMES[asGroupKind(kind)]);
const groupLabel = (g) => (g ? (g.name || groupKindName(g.kind)) : '');
// "Building A / Server room / Rack 3".
const groupPath = (group, groups = state.groups) => groupChain(group, groups).map(groupLabel).join(' / ');
// Every group below this one (not itself), at any depth.
function groupDescendantIds(id, groups = state.groups) {
    const out = new Set();
    let frontier = [id];
    while (frontier.length) {
        const next = [];
        (groups || []).forEach((g) => { if (g.parent && frontier.includes(g.parent) && !out.has(g.id) && g.id !== id) { out.add(g.id); next.push(g.id); } });
        frontier = next;
    }
    return out;
}
// Would `parentId` be a sound parent for group `id`? Not itself, not one of
// its own descendants (that is the loop), and a group that exists. null (the
// top) always is.
function groupParentOk(id, parentId, groups = state.groups) {
    if (!parentId) return true;
    if (parentId === id || !groupById(parentId, groups)) return false;
    return !groupDescendantIds(id, groups).has(parentId);
}
// The devices in a group: its own, and with `deep` those of every group below.
function groupMembers(id, deep = true, nodes = state.nodes, groups = state.groups) {
    const ids = deep ? groupDescendantIds(id, groups) : new Set();
    ids.add(id);
    return (nodes || []).filter((n) => n && n.group && ids.has(n.group));
}
// The tree in display order: each group followed by its children, by name,
// with its depth. A group whose parent is missing shows at the top.
function groupTree(groups = state.groups) {
    const list = groups || [];
    const ids = new Set(list.map((g) => g.id));
    const kids = new Map();
    list.forEach((g) => {
        const p = g.parent && ids.has(g.parent) && g.parent !== g.id ? g.parent : '';
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p).push(g);
    });
    const byName = (a, b) => groupLabel(a).localeCompare(groupLabel(b), undefined, { numeric: true, sensitivity: 'base' });
    const out = [];
    const seen = new Set();
    const walk = (p, depth) => (kids.get(p) || []).slice().sort(byName).forEach((g) => {
        if (seen.has(g.id)) return;
        seen.add(g.id);
        out.push({ group: g, depth });
        walk(g.id, depth + 1);
    });
    walk('', 0);
    // A loop nothing above reaches (only in an unrepaired scratch list) is
    // still listed, at the top.
    list.forEach((g) => { if (!seen.has(g.id)) { seen.add(g.id); out.push({ group: g, depth: 0 }); walk(g.id, 1); } });
    return out;
}

// ---- A device's place ----
// The group a device is in, or null.
const groupOfNode = (node, groups = state.groups) => (node && node.group ? groupById(node.group, groups) : null);
// Its rack, when the group it is in is one.
const rackOfNode = (node, groups = state.groups) => { const g = groupOfNode(node, groups); return isRackGroup(g) ? g : null; };
const rackHeightOf = (node) => (node && Number.isInteger(node.rackHeight) && node.rackHeight > 1 ? node.rackHeight : 1);
const rackFaceOf = (node) => (node && node.rackFace === 'rear' ? 'rear' : 'front');
const hasRackFields = (node) => !!node && (node.rackU !== undefined || node.rackHeight !== undefined || node.rackFace !== undefined || node.rackDepth !== undefined);
// Full depth is the default; a device set to one face says 'half'.
const rackFullDepth = (node) => !!node && node.rackDepth !== 'half';

// ---- A device's ports in the rack (Review-Packs/Topo-groups.md, "Round 5") ----
// The side of the device its ports are on: its own, or its type's.
const portsFaceOf = (node) => (node && asRackFace(node.portsFace)) || defaultPortsFace(node && node.type);
// The rack face they are drawn on. A device that fills the depth has a box on
// both faces, its front on rackFace and its back on the other: its ports are
// on whichever its ports face says. A half-depth one has the one face only,
// so its ports are there whatever the field says (a half-depth server mounted
// at the back shows them on the rear).
function rackPortsFace(node) {
    const face = rackFaceOf(node);
    if (!rackFullDepth(node) || portsFaceOf(node) === 'front') return face;
    return face === 'rear' ? 'front' : 'rear';
}
// What the rack view draws as the device's ports, in order (the agreed
// scope: evenly spaced, in order, never at a faceplate position; there is no
// device-model library to know one):
//   a switch or an AP   its faceplate, port 1 up (faceplatePortIds: past the
//                       count too, where a cable or a label sits), named by
//                       its scheme and carrying its label and access VLAN
//                       (portNameOf, portAttrOf), as the map and the port
//                       picker name them;
//   anything else       its interfaces, in their order, but radios (a Wi-Fi
//                       association is not a socket in the rack) and bonds
//                       (a bond has no socket: its members are where the
//                       cables go). A bond's members are drawn together where
//                       the first of them is, marked with the bond, so the
//                       pair reads as one.
// Each: { id, name, label, vlan, links (the cables on it: isExclusiveLink,
// so not a radio's association, a VPN riding a cable, nor a VM's bridge onto
// its host's NIC), past (a faceplate port beyond the count), bond: { id,
// name } | null }. Pure but for the document it reads.
function rackPortsOf(node) {
    if (!node || isVirtualType(node.type)) return [];
    const at = new Map();
    linksAtNode(node.id).forEach((l) => {
        if (!isExclusiveLink(l)) return;
        const id = ifaceIdOn(l, node.id);
        if (!id) return;
        if (!at.has(id)) at.set(id, []);
        at.get(id).push(l);
    });
    const cables = (id) => at.get(id) || [];
    // Two cables on a socket (isSocketPort): the cabling check's own rule.
    const doubled = (id) => cables(id).length > 1 && isSocketPort(node, id);
    if (hasPortGrid(node)) {
        const total = portCountOf(node);
        return faceplatePortIds(node).map((id) => {
            const n = Number(id.slice(1));
            const a = portAttrOf(node, id);
            return { id, name: ifaceLabel(node, id), label: a.label, vlan: a.vlan, links: cables(id), past: n > total, doubled: doubled(id), bond: null };
        });
    }
    const list = getInterfaces(node).filter((i) => !ifaceIsWireless(i));
    const out = [];
    const done = new Set();
    const one = (i, bond) => {
        if (done.has(i.id)) return;
        done.add(i.id);
        out.push({ id: i.id, name: i.name || i.id, label: '', vlan: null, links: cables(i.id), past: false, doubled: doubled(i.id), bond });
    };
    list.forEach((i) => {
        if (isBond(i)) return;
        const bond = bondOf(node, i.id);
        if (!bond) { one(i, null); return; }
        const tag = { id: bond.id, name: bond.name || bond.id };
        bondMembers(node, bond).filter((m) => !ifaceIsWireless(m)).forEach((m) => one(m, tag));
    });
    return out;
}
// ---- How a rack's units are numbered ----
// Stored, a unit is always counted from the bottom: rackU is a device's
// lowest unit, 1 the bottom one, and every check, every drag and the CSV's
// rack_u read it so. Top-down numbering ("Round 2", item 4) is only how the
// rack's rails are printed, so it changes what is shown (the numbers beside
// the units, a device's "U12", the path text, the findings, the report) and
// nothing that is stored: turning a rack's numbering round moves no device,
// and a file or a sheet means the same unit whichever way the rack is
// numbered when it is read back. The fields where a unit is typed (the
// device editor's U, the place dialog's) take and show the printed number
// and convert (rackStartNo, rackUnitFromNo).
const rackTopDown = (rack) => !!rack && rack.numbering === 'top';
// The number unit `u` (from the bottom) is printed with on this rack.
const rackUnitNo = (rack, u) => (rackTopDown(rack) ? rackTop(rack) - u + 1 : u);
// "U12–U13", "U7": a run of units lo..hi (from the bottom) as the rack's
// rails print them, the smaller number first either way.
function rackUnitsText(rack, lo, hi = lo) {
    const a = rackUnitNo(rack, lo), b = rackUnitNo(rack, hi);
    const x = Math.min(a, b), y = Math.max(a, b);
    return y > x ? `U${x}–U${y}` : `U${x}`;
}
// Where a device of `height` units starts, as the fields that take a unit
// say it: the smallest printed number it covers. That is its lowest unit on
// a rack numbered from the bottom, and its top one on a rack numbered from
// the top, where U1 is the top unit and a device "at U3" is the one whose
// first unit, reading down, is U3.
const rackStartNo = (rack, lo, height = 1) => (rackTopDown(rack) ? rackUnitNo(rack, lo + height - 1) : lo);
// And back: the printed start of a device of `height` units -> its lowest
// unit as stored. The inverse of rackStartNo.
const rackUnitFromNo = (rack, no, height = 1) => (rackTopDown(rack) ? rackTop(rack) - no - height + 2 : no);
const rackWidthInches = (rack) => Number(asRackWidth(rack && rack.width).replace('in', ''));
const rackWidthLabel = (w) => `${asRackWidth(w).replace('in', '')}″`;
// "42U · 19″ · 1000 mm": a rack's size on one line (the Groups tab's card,
// the rack view's head, the report). The depth only when one was given.
const rackSizeText = (rack) => [`${rackTop(rack)}U`, rackWidthLabel(rack && rack.width),
    rack && Number.isInteger(rack.depthMm) ? `${rack.depthMm} mm` : ''].filter(Boolean).join(' · ');

// "U12–U13 front", "U7 rear", "U1 rear, half depth": where in its rack, or ''
// when it is not in one or has no unit yet. Full depth is what every device
// is unless it says otherwise, so only the exception is spelled out. The
// units as the rack prints them (rackUnitsText).
// A VM or a container on a host has no units of its own: it is where its
// host is (repairHosts), so it reads its outermost host's.
function rackSpanText(node, groups = state.groups) {
    node = hostRootOf(node) || node;
    const rack = rackOfNode(node, groups);
    if (!rack || !Number.isInteger(node.rackU)) return '';
    const span = rackUnitsText(rack, node.rackU, node.rackU + rackHeightOf(node) - 1);
    return `${span} ${t(rackFaceOf(node) === 'rear' ? 'rear' : 'front')}${rackFullDepth(node) ? '' : `, ${t('half depth')}`}`;
}

// ---- A rack's units (step C: the rack view, js/rackview.js) ----
// Pure over their arguments, so the rack view's refusals and, later, the
// overlap findings read the same answer. A unit range is lo..hi, both
// counted from the bottom and inclusive, on one face. Front and rear are
// separate columns of units: a half-depth switch at the back does not take
// the units of a half-depth patch panel at the front. A device that fills the
// whole depth (the default; rackDepth 'half' is the exception) is filed under
// the face its front is on (the agreed scope) and takes its units on both: it
// clashes with anything on either.
// The units a placed device takes, or null while it has no unit.
function rackSpanOf(node) {
    if (!node || !Number.isInteger(node.rackU)) return null;
    return { lo: node.rackU, hi: node.rackU + rackHeightOf(node) - 1, face: rackFaceOf(node) };
}
const rackTop = (rack) => (rack && Number.isInteger(rack.uHeight) ? rack.uHeight : RACK_U_DEFAULT);
// Inside the rack: unit 1 at the bottom to its height at the top.
const rackSpanInside = (rack, lo, hi) => Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && lo <= hi && hi <= rackTop(rack);
// The devices this rack holds itself (not those of a group inside it, which
// a rack does not have in practice), placed or not.
const rackMembers = (rack, nodes = state.nodes) => (rack ? (nodes || []).filter((n) => n && n.group === rack.id) : []);
// Whether two placed spans are in each other's way: overlapping units on the
// same face, or on either face when one of them is full depth.
const rackSpansMeet = (a, fullA, b, fullB) => !!a && !!b && (a.face === b.face || fullA || fullB) && a.lo <= b.hi && b.lo <= a.hi;
// The first device already in units lo..hi on `face` of the rack, or null.
// exceptId is the device being moved, which is never in its own way. `full`
// is whether the one being placed fills the depth; left out, it is what the
// device named by exceptId says, and a new one fills it, as every device does
// until it is set to one face.
function rackClash(rack, face, lo, hi, exceptId, nodes = state.nodes, full) {
    const me = exceptId ? (nodes || []).find((n) => n && n.id === exceptId) : null;
    const self = full !== undefined ? !!full : !me || rackFullDepth(me);
    const want = { lo, hi, face };
    return rackMembers(rack, nodes).find((n) => n.id !== exceptId && rackSpansMeet(want, self, rackSpanOf(n), rackFullDepth(n))) || null;
}
// Whether `height` units from `lo` on `face` are free: inside the rack and
// clear of every other device. -> { ok, clash, outside }.
function rackSpanCheck(rack, face, lo, height, exceptId, nodes = state.nodes, full) {
    const hi = lo + height - 1;
    if (!rackSpanInside(rack, lo, hi)) return { ok: false, clash: null, outside: true };
    const clash = rackClash(rack, face, lo, hi, exceptId, nodes, full);
    return { ok: !clash, clash, outside: false };
}
// The lowest unit where `height` units are free on `face`, or null when no
// run is that tall.
function rackFirstFree(rack, face, height, exceptId, nodes = state.nodes, full) {
    for (let lo = 1; lo + height - 1 <= rackTop(rack); lo++) {
        if (rackSpanCheck(rack, face, lo, height, exceptId, nodes, full).ok) return lo;
    }
    return null;
}
// Every two placed devices of a rack in each other's way, once per pair,
// lowest first. The rack view refuses to make one, but a spreadsheet, a
// hand-edited file or the device editor's fields can say so, and the findings
// (placeFindings, js/diagnostics.js) and the drawing name them.
// -> [{ a, b, full, both }], full when they meet because one of them fills
// the depth, which with full depth the default is most overlaps; false when
// both are half depth on the same face. both: on opposite faces and both
// full depth (a v7 front and rear pair after the v8 step), where making one
// of them half depth is not enough: both have to be.
function rackOverlaps(rack, nodes = state.nodes) {
    const placed = rackMembers(rack, nodes).filter((n) => rackSpanOf(n))
        .sort((x, y) => x.rackU - y.rackU || String(x.id).localeCompare(String(y.id)));
    const out = [];
    for (let i = 0; i < placed.length; i++) {
        const a = placed[i], sa = rackSpanOf(a), fa = rackFullDepth(a);
        for (let j = i + 1; j < placed.length; j++) {
            const b = placed[j], sb = rackSpanOf(b);
            if (sb.lo > sa.hi) break;   // sorted by lowest unit: nothing further up reaches a
            const fb = rackFullDepth(b);
            if (rackSpansMeet(sa, fa, sb, fb)) out.push({ a, b, full: fa || fb, both: fa && fb && sa.face !== sb.face });
        }
    }
    return out;
}

// ---- A rack's cables (step C; port to port since "Round 5") ----
// The first build drew one line per device pair and gathered the cables out
// of the rack into stubs by far device (rackCables, gone with that drawing on
// the owner's call). A rack's cables are now listed one by one: rackCableLinks
// below, which the rack view draws and the finding counts, and rackSchedule,
// the patch schedule the rack view's panel and the report print.

// One cable as the person at the rack reads it, from `from`'s end: its port
// there, its port at the other end, and its label and colour when set.
// -> { ports: 'eth0 ↔ Gi0/1', label: 'C-12', color: 'blue' }
function rackCableText(link, from) {
    const other = link.source === from.id ? link.target : link.source;
    const far = getNode(other);
    return { ports: `${ifaceLabel(from, ifaceIdOn(link, from.id))} ↔ ${far ? ifaceLabel(far, ifaceIdOn(link, other)) : '—'}`,
        label: cableOf(link, 'label').trim(), color: cableOf(link, 'color').trim() };
}
// The cables of a rack one by one, as the rack view draws them port to port
// ("Round 5", R5a) and as the untagged-cables finding counts them: every
// cable with an end on one of the rack's devices (a VM or a container is in
// its host's group, so its cables count where its host stands). Not a radio's
// association nor a VPN (neither is a cable in a rack), and not a guest's
// bridge onto its own host: that runs inside the host's box, with nothing to
// draw or tag. In the document's order. Pure over its arguments but for the
// lookups the medium and the hosts read.
function rackCableLinks(rack, links = state.links, nodes = state.nodes) {
    if (!rack) return [];
    const byId = new Map();
    (nodes || []).forEach((n) => { if (n) byId.set(n.id, n); });
    const inRack = (n) => n.group === rack.id;
    const onOwnHost = (a, b) => hostChainOf(a).includes(b) || hostChainOf(b).includes(a);
    return (links || []).filter((l) => {
        if (!l || l.source === l.target) return false;
        const s = byId.get(l.source), d = byId.get(l.target);
        if (!s || !d || !(inRack(s) || inRack(d))) return false;
        const medium = effectiveMedium(l, s, d);
        return medium !== 'wireless' && medium !== 'vpn' && !onOwnHost(s, d);
    });
}

// ---- A rack's patch schedule (Review-Packs/Topo-groups.md, "Round 5", R5b) ----
// The list a person patching the rack works from: one row per cable that
// touches it (rackCableLinks, so the same cables the rack view draws and the
// untagged-cables finding counts), read from the rack's end: the device here
// and its port, the cable's tag, the far device and its port (and where it
// is, when that is not this rack), the colour, the length and the via. A
// cable between two devices of this rack is read from the one higher up, so
// the rows run down the rack as it is read; a VM's or a container's cable is
// at its host's place and names it "guest on host", as the rack view's tags
// do. In the rack's order: the device's top unit, highest first (a member
// with no units yet after every placed one), then the device's order in the
// document (two devices beside each other, front and rear), then the port's
// place on its faceplate or among its interfaces, then the cables' order.
// The rack view's Schedule panel sorts it again by any column; the report
// prints it in this order after the rack's elevation. Every field of it is a
// column of the cables sheet (from and to name and port, label, colour,
// length, via: js/csv.js), which tests/suites/rackschedule.js holds by a
// round trip through a blank map. Pure but for the lookups the ports read.
// -> [{ link, node, box, port, far, farBox, farPort, farIn, where, tag,
//       color, length, via }]: node and far are the cable's devices, box and
//    farBox the device each is drawn in (its host's for a guest, else itself);
//    port and farPort the ports' names, '' where none was picked; farIn
//    whether the far device is in this rack; where, the far device's place
//    when it is not.
function rackSchedule(rack, links = state.links, nodes = state.nodes) {
    if (!rack) return [];
    const byId = new Map(), at = new Map();
    (nodes || []).forEach((n, i) => { if (n && !byId.has(n.id)) { byId.set(n.id, n); at.set(n.id, i); } });
    const inRack = (n) => !!n && n.group === rack.id;
    const boxOf = (n) => hostRootOf(n) || n;
    // The top unit of the box a device is drawn in; -1 with no units here.
    const level = (n) => { const b = boxOf(n); return inRack(b) && Number.isInteger(b.rackU) ? rackSpanOf(b).hi : -1; };
    const portOrder = new Map();
    const portAt = (n, id) => {
        if (!portOrder.has(n.id)) portOrder.set(n.id, new Map(rackPortsOf(n).map((p, k) => [p.id, k])));
        const k = id ? portOrder.get(n.id).get(id) : undefined;
        return k === undefined ? Number.MAX_SAFE_INTEGER : k;
    };
    const rows = rackCableLinks(rack, links, nodes).map((link, i) => {
        const s = byId.get(link.source), d = byId.get(link.target);
        const [a, b] = inRack(s) && inRack(d) ? (level(d) > level(s) ? [d, s] : [s, d]) : inRack(s) ? [s, d] : [d, s];
        const pa = ifaceIdOn(link, a.id), pb = ifaceIdOn(link, b.id);
        return { link, node: a, box: boxOf(a), port: pa ? ifaceLabel(a, pa) : '',
            far: b, farBox: boxOf(b), farPort: pb ? ifaceLabel(b, pb) : '', farIn: inRack(b), where: inRack(b) ? '' : nodePlaceText(b),
            tag: cableOf(link, 'label').trim(), color: cableOf(link, 'color').trim(), length: cableOf(link, 'length').trim(), via: cableOf(link, 'via').trim(),
            key: [-level(a), at.get(boxOf(a).id) ?? 0, at.get(a.id) ?? 0, portAt(a, pa), i] };
    });
    rows.sort((x, y) => { for (let k = 0; k < x.key.length; k++) if (x.key[k] !== y.key[k]) return x.key[k] - y.key[k]; return 0; });
    rows.forEach((r) => { delete r.key; });
    return rows;
}
// A schedule row's end as a person reads it: "SW-1 · 24", "Web 1 on HV-1 ·
// eth0", "PC-12 · no port". far: the far end, else the rack's.
function rackScheduleEnd(row, far = false) {
    const n = far ? row.far : row.node, box = far ? row.farBox : row.box;
    const name = (x) => (x.name && String(x.name).trim()) || x.id;
    const who = box && box !== n ? t('{guest} on {host}', { guest: name(n), host: name(box) }) : name(n);
    return `${who} · ${(far ? row.farPort : row.port) || t('no port')}`;
}
// "Building A / Server room / Rack 3", or '' when it is in no group.
const groupPathOf = (node, groups = state.groups) => { const g = groupOfNode(node, groups); return g ? groupPath(g, groups) : ''; };
// Where a device is, as one line: its group's path (and its units, in a
// rack), else the free-text location it was given. Every place that showed
// node.location shows this instead, so the text a person typed before groups
// existed stays readable on a device nobody has grouped yet.
function nodePlaceText(node, groups = state.groups) {
    const path = groupPathOf(node, groups);
    if (!path) return node && typeof node.location === 'string' ? node.location.trim() : '';
    const span = rackSpanText(node, groups);
    return span ? `${path} · ${span}` : path;
}

// ---- Places typed as text ----
// A place written on one line: the free-text location a register held before
// groups ("Building A / Server room / Rack 3", "HQ > IT", "Floor 2, Room 4"),
// a spreadsheet's group column, a pasted table cell. Split on " / ", ">" or
// "," (the agreed scope): a slash needs its spaces, so "Rack A/B" is one name.
const PLACE_SPLIT_RE = /\s+\/\s+|\s*>\s*|\s*,\s*/;
const splitPlacePath = (text) => String(text == null ? '' : text).split(PLACE_SPLIT_RE).map(groupName).filter(Boolean);
// Compared the way a person reads them: case aside, a run of spaces as one,
// and " / " however it was spaced, so "server room/rack 3" finds the path.
const placeKey = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').replace(/ ?\/ ?/g, ' / ').toLowerCase();

// A unit range at the end of a location ("U12", "U12-U13", "u 7–8"): where
// in its rack a device sits, not a group of its own. -> { u, height } | null.
const RACK_SPAN_RE = /^u\s?(\d{1,2})(?:\s*[-–]\s*u?\s?(\d{1,2}))?$/i;
function parseRackSpan(text) {
    const m = RACK_SPAN_RE.exec(String(text == null ? '' : text).trim());
    if (!m) return null;
    const u = Number(m[1]), top = m[2] === undefined ? u : Number(m[2]);
    if (u < 1 || top < u) return null;
    return { u, height: top - u + 1 };
}

// The kind a group named like this most likely is ("Rack 3" a rack, "2nd
// floor" a floor), in the languages Topo speaks, else custom. Only a guess,
// made where groups are made from text (Make groups from locations, a
// spreadsheet's group column); the kind is one change away in the Groups
// tab. Whole words, not substrings: "Storage" is no rack for holding "rack".
const GROUP_KIND_WORDS = [
    ['rack', /(?<![\p{L}\p{N}])(rack|cabinet|gabinete|bastidor|armário|armario|стойка|шкаф)(?!\p{L})|ラック/iu],
    ['floor', /(?<![\p{L}\p{N}])(floor|level|storey|piso|planta|andar|nivel|этаж)(?!\p{L})|階|フロア/iu],
    ['room', /(?<![\p{L}\p{N}])(room|sala|cuarto|closet|idf|mdf|office|oficina|escritório|escritorio|помещение|комната|серверная|кабинет)(?!\p{L})|室|部屋/iu],
    // A site is filed as a building: Topo has no kind above one, and the
    // top of a location path is the place somebody drives to.
    ['building', /(?<![\p{L}\p{N}])(building|bldg|edificio|edifício|prédio|predio|torre|tower|hq|headquarters|site|campus|branch|sede|matriz|sucursal|filial|здание|корпус|кампус|филиал)(?!\p{L})|棟|ビル|本社|支社|支店|拠点/iu]
];
// `fallback` is the kind when no word matches: 'custom', except where the
// caller knows more (the top of a typed path is nearly always a site).
function guessGroupKind(name, fallback = 'custom') {
    const hit = GROUP_KIND_WORDS.find(([, re]) => re.test(String(name || '')));
    return hit ? hit[0] : fallback;
}

// A place typed as text, against the groups: the group it names, or why not.
// Tried first as a whole path, as groupPath() prints it, so a name holding a
// separator ("Smith, J.") still finds its group; then as a group id (what a
// select hands over); then segment by segment. The first segment may be any
// group of that name (one, or it is ambiguous), and each one after it a group
// inside the one before. -> { group } | { ambiguous: n } | { missing:
// [segments still to make], parent: the deepest group found, or null } |
// { none: true } for blank.
function findGroupByPath(text, groups = state.groups) {
    const list = groups || [];
    const whole = placeKey(text);
    if (!whole) return { none: true };
    const byPath = list.filter((g) => placeKey(groupPath(g, list)) === whole);
    if (byPath.length === 1) return { group: byPath[0] };
    if (byPath.length > 1) return { ambiguous: byPath.length };
    const byId = groupById(String(text).trim(), list);
    if (byId) return { group: byId };
    const parts = splitPlacePath(text);
    if (!parts.length) return { none: true };
    const named = (seg, inside) => list.filter((g) => placeKey(groupLabel(g)) === placeKey(seg) && (inside === undefined || (g.parent || null) === inside));
    const first = named(parts[0]);
    if (first.length > 1) return { ambiguous: first.length };
    if (!first.length) return { missing: parts, parent: null };
    let cur = first[0];
    for (let i = 1; i < parts.length; i++) {
        const next = named(parts[i], cur.id);
        if (next.length > 1) return { ambiguous: next.length };
        if (!next.length) return { missing: parts.slice(i), parent: cur };
        cur = next[0];
    }
    return { group: cur };
}

// Paths resolved against `groups` and the groups this maker has planned to
// make, so a sheet naming "Building A / Rack 3" on ten rows makes each group
// once. Pure: nothing is added to `groups`; `made` is the list to add, in
// order, every parent ahead of its children. resolve(text, create) ->
// { group, made: n } | { ambiguous: n } | { missing: path } | { none: true }.
function groupPathMaker(groups = state.groups) {
    const made = [];
    const all = () => (groups || []).concat(made);
    // The top of a path with more below it ("HQ / Floor 2 / Sales") is a
    // site whatever it is called, so a name that says nothing is a building
    // there. A lone name ("Sales") is not known to be one, until a later
    // path puts something inside it: the order the paths come in does not
    // decide the kind.
    const loneTops = new Set();
    const resolve = (text, create) => {
        const r = findGroupByPath(text, all());
        if (!r.missing) return Object.assign({ made: 0 }, r);
        if (!create) return { missing: (r.parent ? [groupPath(r.parent, all())] : []).concat(r.missing).join(' / ') };
        let parent = r.parent;
        if (parent && loneTops.delete(parent.id) && parent.kind === 'custom') parent.kind = 'building';
        r.missing.forEach((seg, i) => {
            const said = guessGroupKind(seg, '');
            const top = !parent;
            const g = makeGroup({ name: seg, kind: said || (top && i < r.missing.length - 1 ? 'building' : 'custom'), parent: parent ? parent.id : null });
            if (top && !said && i === r.missing.length - 1) loneTops.add(g.id);
            made.push(g);
            parent = g;
        });
        return { group: parent, made: r.missing.length };
    };
    return { made, resolve, all };
}

// A device moved into another group: what it keeps of its place in a rack.
// Into a rack it keeps it all (moving a rack's contents to another keeps
// their units and faces), anywhere else it loses the lot, as the device
// editor's picker has it (setNodeGroup, js/groups.js). -> the keys to drop.
const RACK_KEYS = ['rackU', 'rackHeight', 'rackFace', 'rackDepth'];
const rackKeysLost = (node, toGroup) => (isRackGroup(toGroup) ? [] : RACK_KEYS.filter((k) => node && node[k] !== undefined));

// ============================================================================
// Hosts: the device a VM or a container runs on (Review-Packs/Topo-groups.md,
// "Round 3", item 2; document v10)
// ============================================================================
// node.host names, by id, the device a virtual one (isVirtualType) runs on. A
// VM runs on a computer (HOST_TYPES): a server (a hypervisor or a NAS is
// drawn as one), a workstation running a desktop hypervisor, or a custom
// device, the appliance Topo has no type for; a container runs on one of
// those or on a VM. That is the whole nesting: a container in a VM, one
// level, and no VM in a VM or anything in a container (the owner's rule).
// Network gear, phones, printers, cameras and the rest are not hosts: the
// rack view lights a host under a dragged VM and takes the drop, and a VM
// let go over the core switch must not end up running on it. A cloud stands
// for the internet or another site, not a box, so nothing runs on one.
//
// What follows from it, kept by repairHosts():
//   - a guest takes no rack units of its own: in a rack it is where its host
//     is (rackSpanText reads the host's units for it), so a VM never claims,
//     or overlaps on, a unit of the rack;
//   - its group is its host's (the outermost host's, for a container in a
//     VM): a VM sits in the room its hypervisor sits in. Moving a host into
//     another group takes its guests with it; a guest's own Group picker,
//     its table cell and the bulk panel's Move to group leave it to its host.
// Its map position and its cables are its own and stay as they are.
//
// The host types offered first by the pickers (the device editor's Runs on,
// the table, the bulk panel); any other device that canHost() is still a
// host, listed after them, since a PC can run containers too.
const HOST_SUGGESTED = { vm: ['server'], container: ['server', 'vm'] };
// May a device of guestType run on `host`? Types only: whether the host is
// itself on something is the next level's question, and the two rules
// together stop at one level.
const HOST_TYPES = ['server', 'pc', 'custom'];
function canHost(guestType, host) {
    if (!host || !isVirtualType(guestType)) return false;
    return HOST_TYPES.includes(host.type) || (guestType === 'container' && host.type === 'vm');
}
// How deep the chain may go: a container on a VM on a server. A walk stops
// there whatever a scratch copy that skipped the repair says.
const HOST_DEPTH_MAX = 2;
// The device it runs on, or null. Read through getNode, so a borrowed
// document (the report's binder sweep, a scratch copy) answers for itself.
const hostOf = (node) => (node && node.host ? getNode(node.host) || null : null);
// Its hosts, innermost first: [VM, server] for a container in a VM.
function hostChainOf(node) {
    const out = [];
    const seen = new Set([node && node.id]);
    for (let h = hostOf(node); h && !seen.has(h.id) && out.length < HOST_DEPTH_MAX; h = hostOf(h)) { seen.add(h.id); out.push(h); }
    return out;
}
// The outermost host, the one that is somewhere: null when it runs on nothing.
const hostRootOf = (node) => { const c = hostChainOf(node); return c.length ? c[c.length - 1] : null; };
// What runs on `host` itself (not on its guests), in document order.
const guestsOf = (host, nodes = state.nodes) => (host ? (nodes || []).filter((n) => n && n.host === host.id && n !== host) : []);
// Everything that runs on `host`, a VM's containers straight after the VM:
// what the rack view draws in its box and the report lists beside it.
const guestTreeOf = (host, nodes = state.nodes) => guestsOf(host, nodes).flatMap((g) => [g, ...guestsOf(g, nodes).filter((c) => c !== host)]);
// The devices `guest` may run on, suggested types first, then by name.
function hostCandidates(guest, nodes = state.nodes) {
    if (!guest || !isVirtualType(guest.type)) return [];
    const first = HOST_SUGGESTED[guest.type] || [];
    const rank = (n) => (first.includes(n.type) ? 0 : 1);
    return (nodes || []).filter((n) => n && n !== guest && n.id !== guest.id && canHost(guest.type, n))
        .sort((a, b) => rank(a) - rank(b) || String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, { numeric: true, sensitivity: 'base' }));
}
const isSuggestedHost = (guestType, host) => !!host && (HOST_SUGGESTED[guestType] || []).includes(host.type);
// The host as a spreadsheet cell: its name, or its id when another device
// has the same name (an import would find two and refuse the row).
function hostRefText(id, nodes = state.nodes) {
    const h = id ? (nodes || []).find((n) => n && n.id === id) : null;
    if (!h) return '';
    const name = String(h.name || '').trim();
    const key = name.toLowerCase();
    return name && (nodes || []).filter((n) => n && String(n.name || '').trim().toLowerCase() === key).length === 1 ? name : h.id;
}

// The host rule, in place, on a list of devices as loaded or as edited:
//   1. a host that is not in the list, is the device itself or is not one
//      this device may run on (canHost) is dropped, and so is the host of a
//      device that is not virtual (the schema's reader drops that on load;
//      a VM retyped to a server in this session still holds it);
//   2. a chain that comes back round is cut where it closes (the type rule
//      makes one impossible, but a walk must never depend on that);
//   3. a virtual device keeps no rack units, host or not;
//   4. a guest's group is its outermost host's, or none.
// Runs on load (loadDocState), on every save() (so an edit anywhere, a
// host moved into a room, a host deleted, a guest retyped to a server,
// leaves the document sound without each path knowing the rule) and after
// the spreadsheet and the bulk panel write a scratch copy. The first device
// holding an id is the one a host reference means, as everywhere else.
// Returns the list.
function repairHosts(nodes) {
    const list = Array.isArray(nodes) ? nodes : [];
    const byId = new Map();
    list.forEach((n) => { if (n && typeof n === 'object' && !byId.has(n.id)) byId.set(n.id, n); });
    list.forEach((n) => {
        if (!n || typeof n !== 'object' || n.host === undefined) return;
        const h = isVirtualType(n.type) && typeof n.host === 'string' ? byId.get(n.host) : null;
        if (!h || h === n || !canHost(n.type, h)) delete n.host;
    });
    list.forEach((n) => {
        if (!n || !n.host) return;
        const seen = new Set([n]);
        for (let h = byId.get(n.host); h && h.host; h = byId.get(h.host)) {
            if (seen.has(h) || seen.size > HOST_DEPTH_MAX) { delete n.host; break; }
            seen.add(h);
        }
    });
    list.forEach((n) => {
        if (!n || !isVirtualType(n.type)) return;
        RACK_KEYS.forEach((k) => { if (n[k] !== undefined) delete n[k]; });
        if (!n.host) return;
        let root = byId.get(n.host);
        for (let i = 0; root && root.host && i < HOST_DEPTH_MAX; i++) root = byId.get(root.host) || root;
        if (root && root.group) { if (n.group !== root.group) n.group = root.group; } else if (n.group !== undefined) delete n.group;
    });
    return list;
}

// ---- A rack's height changed ("Round 2", item 4) ----
// A new height keeps every device on the units printed beside it. On a rack
// numbered from the bottom the units come and go at the top and nothing
// stored moves. On one numbered from the top they come and go at the bottom,
// so every device's stored unit (counted from the bottom, see "How a rack's
// units are numbered") moves by the change and "U3" is still U3: a rack
// drawn at the default 42U and corrected to the 24U it really is keeps the
// devices placed at its top where they were. A device that was inside the
// rack and would not be any more loses its unit and face (it stays in the
// rack, under Not placed yet, with its height and depth, as Clear its units
// leaves it) rather than hang outside as a finding; every way of changing
// the height asks first, naming them. One already outside is left outside,
// still a finding. Pure: -> { shift, lost: [node] }.
function rackResizePlan(rack, height, nodes = state.nodes) {
    const shift = rackTopDown(rack) ? height - rackTop(rack) : 0;
    const lost = rackMembers(rack, nodes).filter((n) => {
        const s = rackSpanOf(n);
        return s && rackSpanInside(rack, s.lo, s.hi) && !(s.lo + shift >= 1 && s.hi + shift <= height);
    });
    return { shift, lost };
}
// Writes it, in place, on `rack` and `nodes`: the caller's batch() makes it
// one undo step. -> the plan it followed.
function applyRackHeight(rack, height, nodes = state.nodes) {
    const plan = rackResizePlan(rack, height, nodes);
    const lost = new Set(plan.lost);
    rackMembers(rack, nodes).forEach((n) => {
        if (!Number.isInteger(n.rackU)) return;
        if (lost.has(n)) { delete n.rackU; delete n.rackFace; return; }
        if (plan.shift) n.rackU = asRackU(n.rackU + plan.shift);
    });
    rack.uHeight = height;
    return plan;
}
// The question asked before: which devices lose their units, by name and
// where they are now. '' when none does (a taller rack, or free units).
const RACK_LOST_LIST_MAX = 12;
function rackShrinkQuestion(rack, height, nodes = state.nodes, groups = state.groups) {
    const { lost } = rackResizePlan(rack, height, nodes);
    if (!lost.length) return '';
    const lines = lost.slice(0, RACK_LOST_LIST_MAX).map((n) => `• ${n.name || n.id} (${rackSpanText(n, groups)})`);
    if (lost.length > RACK_LOST_LIST_MAX) lines.push(t('…and {n} more.', { n: lost.length - RACK_LOST_LIST_MAX }));
    return [t(lost.length === 1
        ? '{rack} becomes {h}U. This device is in units it loses, so it loses its place and waits under Not placed yet:'
        : '{rack} becomes {h}U. These {n} devices are in units it loses, so they lose their places and wait under Not placed yet:',
    { rack: groupLabel(rack), h: height, n: lost.length }), ...lines].join('\n');
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
//   v 7             groups (doc.groups, a tree of buildings, floors, rooms
//                   and racks) and a device's place in one (node.group,
//                   rackU, rackHeight, rackFace, rackDepth). Nothing to convert:
//                   the free-text location stays as it was, and making groups
//                   from it is a step the user confirms. A v6 build would
//                   drop the whole tree on its next save.
//   v 8             full depth is the default in a rack (Review-Packs/
//                   Topo-groups.md, "Round 2", item 3): rackDepth is 'half'
//                   for a device on one face and absent for one that fills
//                   the depth. v7 stored it the other way round ('full', and
//                   absent for shallow); the owner wants every existing rack
//                   device full depth, so the step drops rackDepth from
//                   every device, which makes them all full. A v7 build
//                   would read 'half' as nothing and absent as shallow, so
//                   it opens a v8 document read-only.
//   v 9             a rack's size ("Round 2", item 4): widths of 10" and
//                   23" beside 19", a depth in mm (rack.depthMm) and top-down
//                   numbering (rack.numbering 'top'). Nothing to convert; a
//                   v8 build would read 10" and 23" as 19" and drop the
//                   depth and the numbering on its next save.
//   v 10            the device a VM or a container runs on (node.host;
//                   "Hosts" above, "Round 3", item 2). Nothing to convert:
//                   no document before it said what runs where, and a
//                   virtual device's rack units, which it no longer keeps,
//                   are the normalizer's to drop (repairHosts), as a
//                   loaded document's every other unsound reference is. A
//                   v9 build would drop every host on its next save.
//   v 11            the side of a device its ports are on (node.portsFace,
//                   "Round 5": the rack view draws ports). Nothing to
//                   convert: absent is the type's side, which is what every
//                   device before it had. A v10 build would drop it.
//   v 13            custom columns ("Custom columns" above): the columns a
//                   document defines (doc.columns), each device's values for
//                   them (node.extra), and the Devices table's order and
//                   hidden columns (doc.tableView). Nothing to convert; a
//                   v12 build would drop all three on its next save.
//   v 12            Wi-Fi ("Wi-Fi" above, Review-Packs/Topo-wifi.md): the
//                   networks (doc.wifi), a wireless interface's radio
//                   (iface.radio) and an association's SSID, band and
//                   signal (link.wifi), and an accepted finding's scope
//                   (accepted[].scope: the network or band it was accepted
//                   on). Nothing to convert: an AP from before has no radio
//                   described, which reads as unknown and is never a fault,
//                   and an entry with no scope matches as before. A v11
//                   build would drop all four.
//   v 14            age and upkeep ("Age and upkeep" above): when a device
//                   went into service, when it was last serviced and how
//                   often it should be (node.inService, serviced,
//                   serviceEvery), and how long it is expected to last
//                   when not its type's usual (node.lifeYears); findings
//                   pinned for the next visit (doc.pinned) and an accepted
//                   finding's end date (accepted[].until, a schedule), and
//                   how long each type lasts in this network when not
//                   Topo's usual (doc.expectedLife).
//                   Nothing to convert; a v13 build would drop all of it on
//                   its next save, and read a schedule as accepted for good.
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
// ---- Custom columns (document v13) ----
// The columns a register needs and Topo has no field for: who uses the PC,
// the warranty date, the cost centre. The document defines them (doc.columns,
// a list of { id, name, kind }) and each device holds its values under the
// column's id (node.extra). A column is a document's, not a browser's: it
// travels in the file, the sealed link and the binder, so the technician who
// opens the client's file sees the client's columns.
//
// Four kinds, each held as the plain value a spreadsheet would hold:
//   text    a string, kept as typed (trimmed)
//   number  a finite number ("1,5" is read as 1.5: the decimal comma)
//   date    an ISO date, YYYY-MM-DD. Typed or imported as D/M/YYYY in every
//           language but English, which reads M/D/YYYY; written ISO always.
//   yesno   true or false, read from the same words as any tick (YES_RE)
// A value its kind refuses is not kept: what a column holds is always
// something it can show and export.
//
// The view of the table (doc.tableView: which Devices columns show, in what
// order) is the document's too, so the client's arrangement opens the same
// on the technician's screen. It is only a view: the spreadsheet export and
// import keep one order whatever it says (Topo's own columns, then the
// custom ones in the order they were made), so a sheet always reads back.
const CUSTOM_KINDS = ['text', 'number', 'date', 'yesno'];
const CUSTOM_MAX = 40;          // columns in one document
const CUSTOM_NAME_MAX = 60;
const CUSTOM_TEXT_MAX = 2000;   // one cell; notes are where long text goes
const asCustomKind = (v) => (CUSTOM_KINDS.includes(v) ? v : 'text');
const customName = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, CUSTOM_NAME_MAX);
const CUSTOM_ID_RE = /^c[0-9a-z]{1,12}$/;

// A device's bag of values as plain data: string keys, primitive values.
// Which keys mean anything is the document's (normalizeCustomRefs).
function asCustomBag(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    Object.keys(v).forEach((k) => {
        const x = v[k];
        if (CUSTOM_ID_RE.test(k) && (typeof x === 'string' || typeof x === 'boolean' || Number.isFinite(x))) out[k] = x;
    });
    return Object.keys(out).length ? out : undefined;
}

// The column definitions: an id each (unique), a name each (unique in any
// case), a kind. A damaged entry is dropped, never guessed at.
function normalizeCustomColumns(v) {
    const out = [], ids = new Set(), names = new Set();
    (Array.isArray(v) ? v : []).forEach((c) => {
        if (!c || typeof c !== 'object' || out.length >= CUSTOM_MAX) return;
        const id = typeof c.id === 'string' ? c.id : '';
        const name = customName(c.name);
        if (!CUSTOM_ID_RE.test(id) || ids.has(id) || !name || names.has(name.toLowerCase())) return;
        ids.add(id); names.add(name.toLowerCase());
        out.push({ id, name, kind: asCustomKind(c.kind) });
    });
    return out;
}
// No key when there are none; text, the default kind, is not written.
function serializeCustomColumns(list) {
    const l = normalizeCustomColumns(list);
    return l.length ? l.map((c) => ({ id: c.id, name: c.name, kind: c.kind === 'text' ? undefined : c.kind })) : undefined;
}
const customColumnById = (id, list = state.columns) => (list || []).find((c) => c.id === id) || null;
// The next id: c1, c2… past every id the list has, so the same list always
// mints the same id (an import is planned twice, once to review and once
// to apply, and both must name the new column alike).
function nextCustomId(list = state.columns) {
    let n = 0;
    (list || []).forEach((c) => { const m = /^c(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1])); });
    return `c${n + 1}`;
}

// A date typed or imported -> 'YYYY-MM-DD', or null. Day-first unless the
// page is in English (see the header); a date that is not one (31/02) is
// refused rather than rolled over.
function customDate(text) {
    const v = String(text == null ? '' : text).trim();
    let y, m, d, r;
    if ((r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(v))) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v))) {
        const monthFirst = !window.CarinoI18N || window.CarinoI18N.current() === 'en';
        y = +r[3]; m = monthFirst ? +r[1] : +r[2]; d = monthFirst ? +r[2] : +r[1];
    } else return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// A number typed or imported: "12", "-3.5", "1,5" (decimal comma), "1 200".
function customNumber(text) {
    if (typeof text === 'number') return Number.isFinite(text) ? text : null;
    const v = String(text == null ? '' : text).trim().replace(/[\s ]/g, '');
    if (!/^-?\d+(?:[.,]\d+)?$/.test(v)) return null;
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}
const CUSTOM_YES_RE = /^(1|y|yes|true|on|x|✓|si|sí|sim|да|はい)$/i;
const CUSTOM_NO_RE = /^(0|n|no|false|off|não|nao|нет|いいえ)$/i;

// What a column holds for a value typed, pasted or imported: { value } (blank
// is { value: undefined }, nothing kept) or { error: true }.
function parseCustomValue(col, raw) {
    if (raw === undefined || raw === null) return { value: undefined };
    if (typeof raw === 'boolean') return col.kind === 'yesno' ? { value: raw } : { error: true };
    const text = String(raw);
    if (!text.trim()) return { value: undefined };
    if (col.kind === 'number') { const n = customNumber(raw); return n === null ? { error: true } : { value: n }; }
    if (col.kind === 'date') { const d = customDate(text); return d ? { value: d } : { error: true }; }
    if (col.kind === 'yesno') {
        const v = text.trim();
        return CUSTOM_YES_RE.test(v) ? { value: true } : CUSTOM_NO_RE.test(v) ? { value: false } : { error: true };
    }
    return { value: text.trim().slice(0, CUSTOM_TEXT_MAX) };
}
// A value as one cell of text: what the table shows and the export writes.
function customText(col, v) {
    if (v === undefined || v === null || v === '') return '';
    if (col.kind === 'yesno') return v ? 'yes' : 'no';
    return String(v);
}
// One device's value for a column, and setting it (undefined clears it).
const customValueOf = (node, id) => (node && node.extra && Object.prototype.hasOwnProperty.call(node.extra, id) ? node.extra[id] : undefined);
function setCustomValue(node, id, value) {
    if (value === undefined || value === null || value === '') {
        if (node.extra) { delete node.extra[id]; if (!Object.keys(node.extra).length) delete node.extra; }
        return;
    }
    node.extra = Object.assign({}, node.extra, { [id]: value });
}

// Every device's values against the columns the document defines: a value
// for a column that is not there, or one its kind refuses, is dropped (a
// hand-edited file, or a column deleted in another copy). In place.
function normalizeCustomRefs(nodes, columns) {
    const byId = new Map((columns || []).map((c) => [c.id, c]));
    (nodes || []).forEach((n) => {
        if (!n.extra) return;
        const out = {};
        Object.keys(n.extra).forEach((k) => {
            const col = byId.get(k);
            if (!col) return;
            const r = parseCustomValue(col, n.extra[k]);
            if (!r.error && r.value !== undefined) out[k] = r.value;
        });
        if (Object.keys(out).length) n.extra = out; else delete n.extra;
    });
}

// ---- Age and upkeep (document v14) ----
// A device's age is from node.inService to today; its next service is
// node.serviceEvery months after it was last serviced (node.serviced), or
// after it went into service when it never was. Both are worked out from
// the clock of whoever has the file open, and are never stored: the file
// does not change by itself, and a copy opened next year is a year older.
//
// The dates are as much as is known: '2019', '2019-03' or '2019-03-15'.
// Clients often only know the year. A year alone counts from the middle of
// it (July 1st) and its age reads "about", a month from its first day.
const LOOSE_DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const LOOSE_YEAR_MIN = 1950, LOOSE_YEAR_MAX = 2199;
const SERVICE_MONTHS_MAX = 240;
function asLooseDate(v) {
    const m = LOOSE_DATE_RE.exec(typeof v === 'string' ? v.trim() : '');
    if (!m || +m[1] < LOOSE_YEAR_MIN || +m[1] > LOOSE_YEAR_MAX) return undefined;
    if (m[3]) return customDate(m[0]) || undefined;
    if (m[2] && (+m[2] < 1 || +m[2] > 12)) return undefined;
    return m[0];
}
// Typed or imported -> a loose date, or null: what customDate reads, a year
// ("2019"), or a month ("2019-03", "03/2019").
function looseDateFromText(text) {
    const v = String(text == null ? '' : text).trim();
    let r;
    if ((r = /^(\d{4})$/.exec(v))) return asLooseDate(r[1]) || null;
    if ((r = /^(\d{4})[-/.](\d{1,2})$/.exec(v))) return asLooseDate(`${r[1]}-${r[2].padStart(2, '0')}`) || null;
    if ((r = /^(\d{1,2})[-/.](\d{4})$/.exec(v))) return asLooseDate(`${r[2]}-${r[1].padStart(2, '0')}`) || null;
    const d = customDate(v);
    return d ? asLooseDate(d) || null : null;
}
function asServiceMonths(v) {
    return Number.isInteger(v) && v >= 1 && v <= SERVICE_MONTHS_MAX ? v : undefined;
}
// "12", "12 months", "1 year", "2 años" -> months, or null.
const SERVICE_YEAR_WORDS = /^(y|yr|yrs|year|years|a|año|años|ano|anos|г|год|года|лет|年)$/i;
const SERVICE_MONTH_WORDS = /^(m|mo|mos|month|months|mes|meses|mês|мес|месяц|месяца|месяцев|か月|ヶ月|ヵ月|月)$/i;
function serviceMonthsFromText(text) {
    const r = /^(\d{1,3})\s*([^\d\s.]*)\.?$/.exec(String(text == null ? '' : text).trim());
    if (!r) return null;
    const n = +r[1] * (SERVICE_YEAR_WORDS.test(r[2]) ? 12 : 1);
    if (r[2] && !SERVICE_YEAR_WORDS.test(r[2]) && !SERVICE_MONTH_WORDS.test(r[2])) return null;
    return asServiceMonths(n) || null;
}

// Today as 'YYYY-MM-DD', by the LOCAL clock. toISOString() is UTC, so from
// late afternoon on in Mexico (UTC-6) every report, and its filename, was
// dated tomorrow. A parameter wherever an age is read, so the tests (and a
// report, as of its date) can set it.
function todayISO(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
// A loose date as { y, m, d, approx }: the day it counts from.
function looseDateParts(v) {
    const s = asLooseDate(v);
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return m ? { y, m, d: d || 1, approx: false } : { y, m: 7, d: 1, approx: true };
}
// Whole months from a to b (parts), counting a month only once its day is reached.
const monthsBetween = (a, b) => (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);

// A device's age: { months, approx }, or null when it has no start date or
// starts after today (a planned device, or a typo the panel shows as is).
function deviceAge(node, today = todayISO()) {
    const from = node && looseDateParts(node.inService);
    if (!from) return null;
    const months = monthsBetween(from, looseDateParts(today));
    return months < 0 ? null : { months, approx: from.approx };
}
// "6 y 2 m", "about 7 y", "5 m", "under a month".
function ageText(age) {
    if (!age) return '';
    const y = Math.floor(age.months / 12), m = age.months % 12;
    if (age.approx) return y ? t('about {y} y', { y }) : t('under a year');
    if (!y) return m ? t('{m} m', { m }) : t('under a month');
    return m ? t('{y} y {m} m', { y, m }) : t('{y} y', { y });
}
// The date the next service falls due ('YYYY-MM-DD'), or null when the
// device has no interval, or nothing to count it from.
function nextServiceDate(node) {
    const every = node && asServiceMonths(node.serviceEvery);
    const from = every && looseDateParts(node.serviced || node.inService);
    if (!from) return null;
    const total = from.y * 12 + (from.m - 1) + every;
    const y = Math.floor(total / 12), m = total % 12 + 1;
    // The 31st of a month that has none is its last day.
    const d = Math.min(from.d, new Date(Date.UTC(y, m, 0)).getUTCDate());
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// How long a device of each type usually lasts, in years: when one in
// service longer is worth replacing (the Age finding, js/diagnostics.js).
// A rule of thumb, not a warranty: node.lifeYears says otherwise for one
// device. A type not listed (a VM, a container, a cloud, a custom box) has
// no expected life, so it is never "too old".
const EXPECTED_LIFE_YEARS = {
    pc: 5, ap: 5, iot: 5, printer: 6, camera: 6, voip: 7,
    switch: 8, l3switch: 8, router: 7, edge: 7, firewall: 6, vpn: 6, loadbalancer: 7, server: 7, dicom: 10
};
const LIFE_YEARS_MAX = 50;
function asLifeYears(v) {
    return Number.isInteger(v) && v >= 1 && v <= LIFE_YEARS_MAX ? v : undefined;
}
// "7", "7 years", "7 años" -> 7, or null.
function lifeYearsFromText(text) {
    const r = /^(\d{1,2})\s*([^\d\s.]*)\.?$/.exec(String(text == null ? '' : text).trim());
    if (!r || (r[2] && !SERVICE_YEAR_WORDS.test(r[2]))) return null;
    return asLifeYears(+r[1]) || null;
}
// What this network says a type lasts, where it says otherwise than Topo's
// usual (doc.expectedLife, { type: years }): a client who replaces every PC
// at four years. Only the types that have a usual life, each read as
// lifeYears is; nothing is no key.
function normalizeExpectedLife(v) {
    const out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.keys(EXPECTED_LIFE_YEARS).forEach((type) => { const y = asLifeYears(v[type]); if (y) out[type] = y; });
    }
    return out;
}
function serializeExpectedLife(v) {
    const out = normalizeExpectedLife(v);
    return Object.keys(out).length ? out : undefined;
}
// A type's life in this network: its own setting, else Topo's usual, else null.
const typeLifeOf = (type) => ((state.expectedLife && asLifeYears(state.expectedLife[type])) || EXPECTED_LIFE_YEARS[type] || null);
// The device's own, else its type's in this network, else null.
const expectedLifeOf = (node) => (node && (asLifeYears(node.lifeYears) || typeLifeOf(node.type))) || null;

// Whole days from a to b ('YYYY-MM-DD'); negative when b is before a.
const isoDayUtc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((isoDayUtc(b) - isoDayUtc(a)) / 86400000);
const SERVICE_SOON_DAYS = 30;
// Where a device stands today, for the findings, the table and the panel:
//   old       { months, life } when it has been in service its expected
//             life or longer, else null;
//   service   null (no next date), or { due, days } (days until it is due,
//             negative once overdue) and `level`: 'bad' when a whole
//             interval has gone by since it was due (a service missed
//             twice over), 'warn' when overdue, 'info' when due within
//             SERVICE_SOON_DAYS, else null.
// A retired device is past caring, and a planned one not in service yet:
// neither is old nor due.
function upkeepState(node, today = todayISO()) {
    const out = { old: null, service: null };
    if (!node || isRetired(node) || node.status === 'planned') return out;
    const age = deviceAge(node, today), life = expectedLifeOf(node);
    if (age && life && age.months >= life * 12) out.old = { months: age.months, approx: age.approx, life };
    const due = nextServiceDate(node);
    if (due) {
        const days = daysBetween(today, due);
        const every = asServiceMonths(node.serviceEvery);
        const missedTwice = days < 0 && monthsBetween(looseDateParts(due), looseDateParts(today)) >= every;
        out.service = { due, days, level: missedTwice ? 'bad' : days < 0 ? 'warn' : days <= SERVICE_SOON_DAYS ? 'info' : null };
    }
    return out;
}

// The table's view of the Devices tab: { order: [column keys], hidden:
// [column keys] }, both optional. Only well-formed keys are kept; a key for a
// column that no longer exists is harmless and is dropped when it is drawn.
const TABLE_VIEW_KEY_RE = /^[A-Za-z][\w:.-]{0,40}$/;
function normalizeTableView(v) {
    const keys = (l) => [...new Set((Array.isArray(l) ? l : []).filter((k) => typeof k === 'string' && TABLE_VIEW_KEY_RE.test(k)))].slice(0, 120);
    const d = v && typeof v === 'object' && v.devices && typeof v.devices === 'object' ? v.devices : {};
    const order = keys(d.order), hidden = keys(d.hidden);
    return order.length || hidden.length ? { devices: { order: order.length ? order : undefined, hidden: hidden.length ? hidden : undefined } } : {};
}
function serializeTableView(v) {
    const n = normalizeTableView(v);
    return n.devices ? n : undefined;
}

const DOC_VERSION = 14;

// A document's outline: an object whose lists, where present, are lists. The
// loader tolerates a missing list (a bare { nodes } file is a document), but a
// list that is something else is a damaged document, and saying so beats
// reading it as an empty, finding-free network.
const isDocShape = (doc) => !!doc && typeof doc === 'object' && !Array.isArray(doc)
    && ['nodes', 'links', 'networks', 'groups', 'wifi', 'annotations', 'columns', 'pinned'].every((k) => doc[k] === undefined || Array.isArray(doc[k]));

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
    { from: 5, to: 6, run: (doc) => ({ ...doc, v: 6 }) },
    // Groups and the rack fields are new keys, not a new shape.
    { from: 6, to: 7, run: (doc) => ({ ...doc, v: 7 }) },
    // Full depth becomes the default: v7's 'full' and v7's absent (shallow)
    // both become absent, full depth. Copies only the devices that carried
    // the key, so the rest of the document is passed through untouched.
    {
        from: 7, to: 8,
        run: (doc) => ({ ...doc, v: 8,
            nodes: Array.isArray(doc.nodes) ? doc.nodes.map((n) => {
                if (!n || typeof n !== 'object' || !Object.prototype.hasOwnProperty.call(n, 'rackDepth')) return n;
                const out = { ...n };
                delete out.rackDepth;
                return out;
            }) : doc.nodes })
    },
    // A rack's width, depth and numbering are new values and keys, not a
    // new shape.
    { from: 8, to: 9, run: (doc) => ({ ...doc, v: 9 }) },
    // A virtual device's host is a new key, not a new shape.
    { from: 9, to: 10, run: (doc) => ({ ...doc, v: 10 }) },
    // A device's ports face is a new key, not a new shape.
    { from: 10, to: 11, run: (doc) => ({ ...doc, v: 11 }) },
    // Wi-Fi networks, radios and associations are new keys, not a new shape.
    { from: 11, to: 12, run: (doc) => ({ ...doc, v: 12 }) },
    // Custom columns and the table's view are new keys, not a new shape.
    { from: 12, to: 13, run: (doc) => ({ ...doc, v: 13 }) },
    // A device's service dates and interval are new keys, not a new shape.
    { from: 13, to: 14, run: (doc) => ({ ...doc, v: 14 }) }
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
