// ---- Query (plan 3.3) ----
// One search box over the canvas pane, shared by the map and the table. It
// replaces "Filter canvas", which matched only a device's name and address,
// threw on an interface whose address was not a string (a hand-edited or
// foreign file), and set opacity on the drawn nodes directly, so the next
// redraw (any edit, any click) quietly undid it.
//
// What it understands. Words are ANDed; a leading - leaves out what follows.
//
//   plain text   any field the schema holds as text (NODE_FIELDS,
//                IFACE_FIELDS, LINK_FIELDS, NETWORK_FIELDS in js/model.js),
//                so a field added there is searchable without a line here;
//                a MAC matches whatever separators it was typed with
//   name:        the device's name
//   type:        the device type, by key (pc) or by name (Workstation)
//   ip:          an address (exact), a network (10.10.30.0/24: every address
//                inside it) or the start of one as typed so far (10.10.)
//   mac:         hex digits, separators ignored, or the vendor the OUI decodes
//   vlan:        the VLAN of a declared network the address is on, or the
//                access VLAN of a switch port (node.portAttrs): the switch
//                with such a port, and the device cabled into it
//   switch:      cabled straight into a switch of that name (and the switch)
//   loc:/status: the Asset group's location and status (js/assets.js):
//                status:retired, loc:"rack 2". loc: reads where the device
//                is as the table prints it: its group's path when it is in
//                one, and the free text it was given either way. A prefix
//                whose field the schema does not have is not understood, and
//                the box says so rather than matching nothing in silence.
//   group:       a group's name or a fragment of its path ("Rack 3",
//                group:"server room/rack"): the devices in that group or in
//                any group inside it, since a device in Rack 3 is in the
//                server room too
//   host:        what a VM or a container runs on, by the host's name or
//                id (host:esx-01): the devices on it, and a container on a
//                VM on it too, as group: takes the groups inside
//   tag:         the asset tag
//   ssid:        the SSID (or its id) an AP broadcasts or a client's link
//                is on, as inferred when nobody picked it (js/model.js
//                "Wi-Fi"): ssid:guest
//   band:        2.4, 5 or 6 (GHz optional): a radio that offers it, a link
//                on it (its own, or the best band both ends share)
//   wifi:        a radio's standard: wifi:6e, wifi:ax, wifi:7, wifi:5
//   channel:     a radio on that channel, and a link through it
//   has:         finding, critical, advisory, ip, mac, gateway, dns, os,
//                notes, tag, cable, group, host (runs on a device), guests
//                (something runs on it), wifi (a radio or an association)
//
// A cable's own facts (link.cable: its label, length, colour, via) are plain
// text of the cable, so "WS-3B" finds the run with that label. A port's
// label and name are plain text of its switch (and of its row on the
// table's Ports tab), so "Reception" finds the switch with that jack.
//
// Prefixes, field names and values are syntax, so they stay English like the
// rest of the full editor's vocabulary (see applyProfile, js/app.js); the
// box's sentences (placeholder, counts, the "not understood" line) are
// translated (MESSAGES, js/i18n.js).
//
// Where a match shows:
//   map    what does not match is dimmed (class q-dim, css/app.css), on every
//          redraw, because renderCanvasOnly asks queryMapMatches() each time.
//          A class rather than an inline opacity also keeps the dimming out of
//          the PNG export and the report's diagram, which serialize the SVG
//          without the stylesheet: a search is a view, not the document.
//          A cable stays lit when it matches itself (plain text, switch:) or
//          when one of its ends does.
//   table  rows that do not match are left out (queryKeepsRow, js/table.js),
//          on every tab: an interface row by its own address and MAC and its
//          device's other fields; a cable by its own fields or either end; a
//          subnet by its own fields or any device on it.
//   Select matches   the matching devices into the selection set (plan 3.1),
//          or, on the table's Cables tab, the matching cables.
//   Zoom to matches  the map framed on them (also Enter in the box).
//
// Kept in state.query: a view of the document, like the trace, so it is never
// serialized, never an undo step and not kept between visits. A reduced view
// has no box, so a query left from the full editor dims nothing there.
//
// Load order: ... networks -> table -> rackview -> query -> bulk -> app

// ---- Small readers that never throw ----
// A loaded file's fields have been through the schema, but a value can still
// be the wrong type in a document the schema let through as raw; every read
// here turns anything into a string first.
const qText = (v) => (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : ''));
const qLower = (v) => qText(v).toLowerCase();
const qHas = (hay, needle) => !!needle && qLower(hay).includes(needle);
const qHex = (v) => qLower(v).replace(/[^0-9a-f]/g, '');
const qIfaces = (node) => (node && Array.isArray(node.interfaces) ? node.interfaces.filter((i) => i && typeof i === 'object') : []);
// The address an interface holds, with or without its prefix length.
function qAddrOf(ipText) {
    if (typeof ipText !== 'string' || !ipText.trim()) return null;
    const p = parseValidCIDR(ipText);
    return p ? p.ip : parseIpText(ipText.split('/')[0]);
}
const qSameKind = (a, b) => !!a && !!b && a.kind() === b.kind();
const qInRange = (addr, p) => qSameKind(addr, p.ip) && addr.match(p.cidrObj);
const qPeer = (link, nodeId) => getNode(link.source === nodeId ? link.target : link.source);

// The schema's text fields, minus the ones that are bookkeeping, not data.
// A device's group is an id and its rack fields are numbers and a face: read
// as text, "12" would find every device in U12 and "front" every one on a
// front face. Where a device sits is searched by its path instead (plain
// text below, loc: and group:).
// A host is an id too: "s_lq3" would find its VMs by a string nobody reads.
const Q_SKIP = new Set(['id', 'x', 'y', 'interfaces', 'source', 'target', 'group', 'rackU', 'rackHeight', 'rackFace', 'rackDepth', 'portsFace', 'host']);
const qFieldsHave = (fields, rec, v) => !!rec && fields.some((f) => !Q_SKIP.has(f.key) && qHas(rec[f.key], v));

// A typed fragment that reads as part of a MAC (aa:bb, aa-bb-cc, or six or
// more hex digits) also matches a MAC stored with other separators.
const Q_MAC_FRAGMENT = /^(?:[0-9a-f]{2}[:-]){1,5}[0-9a-f]{0,2}$|^[0-9a-f]{6,12}$/i;

// ---- Plain text ----
function qNodeFieldText(node, q) {
    if (qFieldsHave(NODE_FIELDS, node, q.v)) return true;
    const name = typeName(node.type);
    return qHas(name, q.v) || qHas(t(name), q.v) || qHas(groupPathOf(node), q.v);
}
// A device's port labels too: an object of objects, which the schema walk
// reads as no text. Only while it has a faceplate: a switch retyped to a PC
// keeps them in memory, but the page no longer shows them, so a search must
// not find it by them either (qPortVlan's gate).
const qNodeOwnText = (node, q) => qNodeFieldText(node, q)
    || (hasPortGrid(node) && !!node.portAttrs && typeof node.portAttrs === 'object' && Object.keys(node.portAttrs).some((id) => qHas(portAttrOf(node, id).label, q.v)));
// A port row (the table's Ports tab): { node, portId, peer }. Its own label
// and name, then its switch's own fields (not the switch's other ports'
// labels, or a label would keep every port of its switch), then whatever is
// plugged into it.
const qPortText = (p, q) => qHas(portAttrOf(p.node, p.portId).label, q.v) || qHas(ifaceLabel(p.node, p.portId), q.v);
function qIfaceText(iface, q) {
    if (qFieldsHave(IFACE_FIELDS, iface, q.v)) return true;
    return !!q.hex && qHex(iface.mac).includes(q.hex);
}
const Q_PLAIN = {
    node: (n, q) => qNodeOwnText(n, q) || qIfaces(n).some((i) => qIfaceText(i, q)),
    // Its own label or name, then what it is on and what is plugged into it.
    port: (p, q) => qPortText(p, q) || qNodeFieldText(p.node, q) || qIfaces(p.node).some((i) => qIfaceText(i, q)) || (!!p.peer && Q_PLAIN.node(p.peer, q)),
    iface: (n, i, q) => qIfaceText(i, q) || qNodeOwnText(n, q),
    link: (l, q) => qFieldsHave(LINK_FIELDS, l, q.v) || qFieldsHave(CABLE_FIELDS, l.cable, q.v) || qHas(mediumName(effectiveMedium(l)), q.v)
        || (!!l.wifi || effectiveMedium(l) === 'wireless') && qLinkSsid(l, q.v)
        || [l.source, l.target].some((id) => { const n = getNode(id); return !!n && Q_PLAIN.node(n, q); }),
    // A Wi-Fi network (the table's Wi-Fi tab) by its own fields and its
    // security's name ("WPA3-Personal").
    wifi: (w, q) => qFieldsHave(WIFI_FIELDS, w, q.v) || qHas(wifiSecurityName(w.security), q.v),
    net: (s, q) => qFieldsHave(NETWORK_FIELDS, s.net, q.v) || qHas(s.cidr, q.v)
        || (s.net && s.net.vlan != null && qText(s.net.vlan) === q.v) || s.nodes.some((n) => Q_PLAIN.node(n, q))
};
const qPlainPrep = (v) => ({ v, hex: Q_MAC_FRAGMENT.test(v) ? qHex(v) : '' });

// ---- has: ----
// The worst finding that names a device or a cable: its own verdict (the
// badge) or a finding of the whole map naming it (an IP conflict names both
// holders, a loop its cables). One table per diagnosis, which is memoised
// per document (currentDiagnosis, js/diagnostics.js).
// Every match runs inside a lookup pass (the map, the buttons, the table's
// rows), and currentDiagnosis() keeps its answer on the pass, so asking it
// per device builds its whole-document key once.
const qDiag = () => currentDiagnosis();
let _qLevels = { diag: null, nodes: null, links: null };
function qLevels() {
    const diag = qDiag();
    if (_qLevels.diag === diag) return _qLevels;
    const nodes = new Map(), links = new Map();
    const worse = (m, id, level) => { if (m.get(id) !== 'bad') m.set(id, level === 'bad' ? 'bad' : 'warn'); };
    // Open findings only: has:finding is what still needs looking at, and a
    // finding accepted with a reason does not (the device's own verdict,
    // its badge, leaves accepted issues out the same way). Nor an info
    // one, a rack's untagged cables: a note on the register, no fault.
    diag.findings.filter(isCountedFinding).forEach((f) => {
        (f.nodeIds || []).forEach((id) => worse(nodes, id, f.level));
        (f.linkIds || []).forEach((id) => worse(links, id, f.level));
    });
    _qLevels = { diag, nodes, links };
    return _qLevels;
}
function qSeverity(n) {
    const own = nodeDiagnosis(n, qDiag()).severity;
    const named = qLevels().nodes.get(n.id);
    return own === 'bad' || named === 'bad' ? 'bad' : (own || named || null);
}
const qLinkSeverity = (l) => qLevels().links.get(l.id) || null;
const Q_HAS = {
    finding: (n) => !!qSeverity(n),
    critical: (n) => qSeverity(n) === 'bad',
    advisory: (n) => qSeverity(n) === 'warn',
    ip: (n) => qIfaces(n).some((i) => !!qAddrOf(i.ip)),
    mac: (n) => qIfaces(n).some((i) => hasMac(i)),
    gateway: (n) => !!effectiveGw(n),
    dns: (n) => !!effectiveDns(n),
    os: (n) => !isBlank(n.os),
    notes: (n) => !isBlank(n.notes),
    tag: (n) => !isBlank(n.assetTag),
    cable: (n) => linksAtNode(n.id).length > 0,
    group: (n) => !!groupOfNode(n),
    host: (n) => !!hostOf(n),
    guests: (n) => guestsOf(n).length > 0,
    // A radio, or an association: an AP, a laptop, a phone on Wi-Fi.
    wifi: (n) => qRadios(n).length > 0 || qWifiLinks(n).length > 0
};
const Q_HAS_ALIAS = { findings: 'finding', problem: 'finding', warning: 'advisory', gw: 'gateway', address: 'ip', cables: 'cable', note: 'notes', groups: 'group',
    guest: 'guests', 'wi-fi': 'wifi', wireless: 'wifi', radio: 'wifi' };
const Q_HAS_LINK = {
    finding: (l) => !!qLinkSeverity(l),
    critical: (l) => qLinkSeverity(l) === 'bad',
    advisory: (l) => qLinkSeverity(l) === 'warn',
    wifi: (l) => !!wifiLinkEnds(l)
};
// An interface row asks its own address and MAC, not its device's.
const Q_HAS_IFACE = { ip: (n, i) => !!qAddrOf(i.ip), mac: (n, i) => hasMac(i), wifi: (n, i) => ifaceIsWireless(i) };

// ---- ip: ----
function qIpPrep(v) {
    if (v.includes('/')) { const p = parseValidCIDR(v); return p ? { cidr: p } : { error: true }; }
    const addr = parseIpText(v);
    if (addr) return { addr };
    // The start of an address, as typed so far.
    return /^[0-9a-f:.]+$/i.test(v) ? { part: v } : { error: true };
}
function qIpMatch(ipText, q) {
    if (q.part) return qHas(ipText, q.part);
    const addr = qAddrOf(ipText);
    if (!addr) return false;
    if (q.cidr) return qInRange(addr, q.cidr);
    return qSameKind(addr, q.addr) && addr.toString() === q.addr.toString();
}
// A subnet matches a network it overlaps (either holds the other's start)
// and an address it holds.
function qIpNet(s, q) {
    if (q.part) return qHas(s.cidr, q.part);
    const p = parseValidCIDR(s.cidr);
    if (!p) return false;
    const start = parseIpText(p.networkStr.split('/')[0]);
    if (q.cidr) return qInRange(start, q.cidr) || qInRange(parseIpText(q.cidr.networkStr.split('/')[0]), p);
    return qInRange(q.addr, p);
}

// ---- mac: ----
function qMacPrep(v) {
    const hex = qHex(v);
    return /^[0-9a-f:.\-\s]+$/i.test(v) && hex ? { hex } : { vendor: v };
}
function qMacMatch(iface, q) {
    if (q.hex) return qHex(iface.mac).includes(q.hex);
    const api = window.CarinoOUI;
    if (!api || !hasMac(iface)) return false;
    const d = api.decodeMac(iface.mac);
    return !!(d && d.vendor && qHas(d.vendor.vendor, q.vendor));
}

// ---- vlan: and switch: ----
function qIfaceVlan(iface, vlan) {
    const addr = qAddrOf(iface.ip);
    const net = addr && networkOfIp(addr);
    return !!net && net.vlan === vlan;
}
// A port's access VLAN, and a device by the ports it holds or is cabled into.
const qPortVlan = (node, portId, vlan) => hasPortGrid(node) && portAttrOf(node, portId).vlan === vlan;
function qNodeVlan(n, vlan) {
    if (qIfaces(n).some((i) => qIfaceVlan(i, vlan))) return true;
    if (hasPortGrid(n) && n.portAttrs && Object.keys(n.portAttrs).some((id) => qPortVlan(n, id, vlan))) return true;
    return linksAtNode(n.id).some((l) => { const peer = qPeer(l, n.id); return !!peer && qPortVlan(peer, ifaceIdOn(l, peer.id), vlan); });
}
const Q_SWITCH_TYPES = ['switch', 'l3switch'];
const qIsSwitch = (n, v) => !!n && Q_SWITCH_TYPES.includes(n.type) && qHas(n.name, v);

// ---- ssid:, band:, wifi: and channel: (js/model.js "Wi-Fi") ----
// A device by its radios and its associations: an AP by what it broadcasts,
// a client by the SSID and band its link is on, as the editor infers them
// (linkWifiSsid, linkWifiBand), so a link nobody filled in still answers.
const qRadios = (n) => qIfaces(n).filter((i) => ifaceIsWireless(i));
const qWifiLinks = (n) => linksAtNode(n.id).filter((l) => !!wifiLinkEnds(l));
const qSsidHas = (id, v) => { const w = wifiById(id); return !!w && (qHas(w.ssid, v) || qLower(w.id) === v); };
const qLinkSsid = (l, v) => qSsidHas(linkWifiSsid(l), v);
// An AP's radios broadcast it, a client's link is on it.
const qNodeSsid = (n, v) => (n.type === 'ap' || isRoutingDevice(n.type)) && qRadios(n).some((i) => apSsids(radioOf(i)).some((id) => qSsidHas(id, v)))
    || qWifiLinks(n).some((l) => qLinkSsid(l, v));
const qRadioBand = (i, band) => (radioBands(radioOf(i)) || []).includes(band);
const qNodeBand = (n, band) => qRadios(n).some((i) => qRadioBand(i, band)) || qWifiLinks(n).some((l) => linkWifiBand(l) === band);
const qRadioChannel = (i, ch) => (radioOf(i) && radioOf(i).bands || []).some((b) => b.channel === ch);
// A link by the channel its AP is on, on the band the link is on.
function qLinkChannel(l, ch) {
    const e = wifiLinkEnds(l);
    const band = e && e.ap ? linkWifiBand(l) : null;
    const b = band ? radioBand(radioOf(e.ap.iface), band) : null;
    return !!b && b.channel === ch;
}

// ---- group: and loc: ----
// A group by its name, or by a fragment of its path however its slashes were
// spaced (placeKey, js/model.js). Its own path holds every ancestor's name,
// so a device matches through the group it is in and every group above it.
const qGroupHas = (g, v) => !!g && (qHas(groupLabel(g), v) || placeKey(groupPath(g)).includes(placeKey(v)));
const qNodeInGroup = (n, v) => qGroupHas(groupOfNode(n), v);
// Where it is: the path the table and the report print (nodePlaceText), and
// the free text, which a grouped device keeps and a search still finds.
const qNodeLoc = (n, v) => qHas(n.location, v) || qHas(nodePlaceText(n), v);

// The prefixes. A term defines what it can say about each kind of row; what
// it does not define falls back (qTerm* below): a device by its interfaces,
// an interface by its device, a cable by its two ends, a subnet by the
// devices on it. `field`: the prefix reads that node field and is only
// understood while the schema has it.
const Q_PREFIXES = {
    name: { node: (n, q) => qHas(n.name, q.v) },
    type: { node: (n, q) => qLower(n.type) === q.v || qHas(typeName(n.type), q.v) || qHas(t(typeName(n.type)), q.v) },
    ip: { prep: qIpPrep, iface: (n, i, q) => qIpMatch(i.ip, q), net: qIpNet },
    mac: { prep: qMacPrep, iface: (n, i, q) => qMacMatch(i, q), net: (s, q) => s.nodes.some((n) => qIfaces(n).some((i) => qMacMatch(i, q))) },
    vlan: { prep: (v) => { const vlan = asVlan(v); return vlan === undefined ? { error: true } : { vlan }; },
            node: (n, q) => qNodeVlan(n, q.vlan),
            iface: (n, i, q) => { if (qIfaceVlan(i, q.vlan)) return true; const l = linkOnIface(n.id, i.id); const peer = l && qPeer(l, n.id); return !!peer && qPortVlan(peer, ifaceIdOn(l, peer.id), q.vlan); },
            port: (p, q) => portAttrOf(p.node, p.portId).vlan === q.vlan,
            net: (s, q) => !!s.net && s.net.vlan === q.vlan },
    switch: { node: (n, q) => qIsSwitch(n, q.v) || linksAtNode(n.id).some((l) => qIsSwitch(qPeer(l, n.id), q.v)),
              iface: (n, i, q) => { if (qIsSwitch(n, q.v)) return true; const l = linkOnIface(n.id, i.id); return !!l && qIsSwitch(qPeer(l, n.id), q.v); },
              link: (l, q) => qIsSwitch(getNode(l.source), q.v) || qIsSwitch(getNode(l.target), q.v) },
    loc: { field: 'location', node: (n, q) => qNodeLoc(n, q.v), grp: (g, q) => qHas(groupPath(g), q.v) },
    group: { field: 'group', node: (n, q) => qNodeInGroup(n, q.v), grp: (g, q) => qGroupHas(g, q.v) },
    status: { field: 'status', node: (n, q) => qLower(n.status) === q.v || qHas(n.status, q.v) },
    tag: { field: 'assetTag', node: (n, q) => qHas(n.assetTag, q.v) },
    host: { field: 'host', node: (n, q) => hostChainOf(n).some((h) => qHas(h.name, q.v) || qLower(h.id) === q.v) },
    ssid: { node: (n, q) => qNodeSsid(n, q.v),
            iface: (n, i, q) => (ifaceIsWireless(i) && (n.type === 'ap' || isRoutingDevice(n.type)) && apSsids(radioOf(i)).some((id) => qSsidHas(id, q.v)))
                || linksAtNode(n.id).some((l) => ifaceIdOn(l, n.id) === i.id && !!wifiLinkEnds(l) && qLinkSsid(l, q.v)),
            link: (l, q) => qLinkSsid(l, q.v),
            wifi: (w, q) => qHas(w.ssid, q.v) },
    // 2.4, 5 or 6, with or without GHz.
    band: { prep: (v) => { const band = wifiBandKey(v); return band ? { band } : { error: true }; },
            node: (n, q) => qNodeBand(n, q.band),
            iface: (n, i, q) => qRadioBand(i, q.band) || linksAtNode(n.id).some((l) => ifaceIdOn(l, n.id) === i.id && linkWifiBand(l) === q.band),
            link: (l, q) => linkWifiBand(l) === q.band,
            wifi: (w, q) => wifiBandsOf(w).includes(q.band) },
    // The standard, as a key, its letters or its Wi-Fi name: wifi:6e, wifi:ax, wifi:7.
    wifi: { prep: (v) => { const std = wifiStandardKey(v); return std ? { std } : { error: true }; },
            node: (n, q) => qRadios(n).some((i) => (radioOf(i) || {}).standard === q.std),
            iface: (n, i, q) => (radioOf(i) || {}).standard === q.std,
            link: (l, q) => { const e = wifiLinkEnds(l); return !!e && e.ends.some((end) => (radioOf(end.iface) || {}).standard === q.std); } },
    channel: { prep: (v) => { const ch = asWifiChannel(v); return ch === undefined ? { error: true } : { ch }; },
               node: (n, q) => qRadios(n).some((i) => qRadioChannel(i, q.ch)),
               iface: (n, i, q) => qRadioChannel(i, q.ch),
               link: (l, q) => qLinkChannel(l, q.ch) },
    has: { prep: (v) => { const k = Q_HAS_ALIAS[v] || v; return Q_HAS[k] ? { has: k } : { error: true }; },
           node: (n, q) => Q_HAS[q.has](n),
           iface: (n, i, q) => (Q_HAS_IFACE[q.has] ? Q_HAS_IFACE[q.has](n, i) : Q_HAS[q.has](n)),
           // A cable by a finding naming it (a loop) or by either end.
           link: (l, q) => {
               const own = Q_HAS_LINK[q.has] && Q_HAS_LINK[q.has](l);
               return !!own || [l.source, l.target].some((id) => { const n = getNode(id); return !!n && Q_HAS[q.has](n); });
           } }
};
const Q_ALIAS = { location: 'loc', grp: 'group' };
const qKnown = (key) => {
    const k = Object.prototype.hasOwnProperty.call(Q_ALIAS, key) ? Q_ALIAS[key] : key;
    const def = k && Object.prototype.hasOwnProperty.call(Q_PREFIXES, k) ? Q_PREFIXES[k] : null;
    if (!def) return null;
    return def.field && !NODE_FIELDS.some((f) => f.key === def.field) ? { unavailable: true } : def;
};

// ---- Parsing ----
// Words split on spaces; "quoted words" (also after a prefix: type:"ip
// camera") stay together. A word is a prefix term only when what comes
// before its first colon is a known prefix: an IPv6 address or a MAC typed
// as plain text has colons too. A word-like prefix nobody knows (lco:) is
// reported rather than searched for as text, since it was plainly meant as
// a filter; one made only of hex digits (aa:bb) is a MAC fragment.
// -> { terms: [{ def, q, neg }], errors: [word] }
function parseQuery(text) {
    const words = String(text == null ? '' : text).match(/(?:[^\s"]+|"[^"]*"?)+/g) || [];
    const terms = [], errors = [];
    words.forEach((raw) => {
        let word = raw;
        const neg = /^[-!]./.test(word);
        if (neg) word = word.slice(1);
        const m = /^([a-z]+):(.*)$/i.exec(word);
        const key = m ? m[1].toLowerCase() : '';
        const def = m ? qKnown(key) : null;
        if (m && !def && /[g-z]/.test(key)) { errors.push(raw); return; }
        if (def && def.unavailable) { errors.push(raw); return; }
        const value = (def ? m[2] : word).replace(/"/g, '').trim().toLowerCase();
        if (!value) return;   // "type:" while it is being typed: nothing yet
        const q = def ? (def.prep ? def.prep(value) : { v: value }) : qPlainPrep(value);
        if (q.error) { errors.push(raw); return; }
        terms.push({ def: def || Q_PLAIN, q, neg });
    });
    return { terms, errors };
}

// ---- Matching ----
function qTermNode(term, n) {
    const d = term.def;
    if (d.node) return !!d.node(n, term.q);
    if (d.iface) return qIfaces(n).some((i) => d.iface(n, i, term.q));
    return false;
}
const qTermIface = (term, n, i) => (term.def.iface ? !!term.def.iface(n, i, term.q) : qTermNode(term, n));
function qTermLink(term, l) {
    if (term.def.link) return !!term.def.link(l, term.q);
    return [l.source, l.target].some((id) => { const n = getNode(id); return !!n && qTermNode(term, n); });
}
const qTermNet = (term, s) => (term.def.net ? !!term.def.net(s, term.q) : s.nodes.some((n) => qTermNode(term, n)));
// A port by what it says itself, else by its switch or what is plugged in.
const qTermPort = (term, p) => (term.def.port ? !!term.def.port(p, term.q)
    : qTermNode(term, p.node) || (!!p.peer && qTermNode(term, p.peer)));
// A group (the table's Groups tab) by what it says itself (its name and
// path, for plain text, loc: and group:), else by any device in it or below.
const qTermGrp = (term, g) => {
    if (term.def === Q_PLAIN && qHas(groupPath(g), term.q.v)) return true;
    if (term.def.grp && term.def.grp(g, term.q)) return true;
    return groupMembers(g.id, true).some((n) => qTermNode(term, n));
};
// A Wi-Fi network (the table's Wi-Fi tab) by what it says itself, else by
// any association on it.
const qTermWifi = (term, w) => {
    if (term.def.wifi && term.def.wifi(w, term.q)) return true;
    return state.links.some((l) => linkWifiSsid(l) === w.id && qTermLink(term, l));
};
// A device row (the map, the Devices tab) is also found by plain text naming
// an SSID, as ssid: finds it: an AP by what it broadcasts, a client by what
// its link is on, so "Staff" finds the devices on Staff and not only their
// links. Here, not in Q_PLAIN.node, which a cable, a port, a subnet and a
// Wi-Fi row ask about their devices: there it would light every cable of an
// AP for each SSID it broadcasts.
const qTermNodeRow = (term, n) => qTermNode(term, n)
    || (term.def === Q_PLAIN && !!(state.wifi || []).length && qNodeSsid(n, term.q.v));
const Q_SCOPES = { node: qTermNodeRow, iface: qTermIface, link: qTermLink, net: qTermNet, port: qTermPort, grp: qTermGrp, wifi: qTermWifi };

// kind: 'node' (n), 'iface' (n, iface), 'link' (l), 'net' ({ net, cidr,
// nodes }), 'port' ({ node, portId, peer }), 'grp' (g), 'wifi' (w). A query that was not
// understood matches nothing: showing everything would read as "all of these
// match".
function queryMatch(query, kind, ...args) {
    if (!args[0]) return false;
    if (query.errors.length) return false;
    const test = Q_SCOPES[kind];
    return query.terms.every((term) => test(term, ...args) !== term.neg);
}

let _queryMemo = { text: null, query: null };
// The query in force, or null when there is none to apply.
function activeQuery() {
    const text = typeof state.query === 'string' ? state.query.trim() : '';
    if (!text || isReduced()) return null;
    if (_queryMemo.text !== text) _queryMemo = { text, query: parseQuery(text) };
    const q = _queryMemo.query;
    return q.terms.length || q.errors.length ? q : null;
}

// For the map: which devices and cables stay lit. Null when nothing is
// filtered. One lookup pass, so a big map is indexed once per redraw.
let _queryLastMap = null;
function queryMapMatches() {
    const q = activeQuery();
    if (!q) { _queryLastMap = null; return null; }
    _queryLastMap = withLookupPass(() => ({
        nodes: new Set(state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id)),
        links: new Set(state.links.filter((l) => queryMatch(q, 'link', l)).map((l) => l.id))
    }));
    return _queryLastMap;
}

// For the table: whether a row stays. Rows come from the report model; the
// match is asked of the record each row is about.
function queryKeepsRow(row, q = activeQuery()) {
    if (!q) return true;
    if (row.rec === 'node') return queryMatch(q, 'node', getNode(row.ref.nodeId));
    if (row.rec === 'iface') {
        const n = getNode(row.ref.nodeId);
        const iface = qIfaces(n).find((i) => i.id === row.ref.ifaceId);
        return !!iface && queryMatch(q, 'iface', n, iface);
    }
    if (row.rec === 'link') return queryMatch(q, 'link', getLink(row.ref.linkId));
    if (row.rec === 'group') return queryMatch(q, 'grp', groupById(row.ref.groupId));
    if (row.rec === 'wifi') return queryMatch(q, 'wifi', wifiById(row.ref.wifiId));
    if (row.rec === 'port') {
        const node = getNode(row.ref.nodeId);
        return !!node && queryMatch(q, 'port', { node, portId: row.ref.portId, peer: row.data.peerId ? getNode(row.data.peerId) : null });
    }
    return queryMatch(q, 'net', { net: row.ref.netId ? networkById(row.ref.netId) : null, cidr: row.data.network,
        nodes: (row.data.nodeIds || []).map(getNode).filter(Boolean) });
}

// ---- The box ----
const qEl = (id) => document.getElementById(id);

function setQuery(text) {
    const value = String(text == null ? '' : text);
    if (value === (state.query || '')) { updateQueryBar(); return; }
    state.query = value;
    const input = qEl('queryInput');
    if (input && input.value !== value) input.value = value;
    renderCanvasOnly();   // which rebuilds the table too, while it shows
    updateQueryBar();
}

// What the matches are, for the buttons: devices (or, on the table's Cables
// tab, cables).
function queryMatchEntries() {
    const q = activeQuery();
    if (!q) return [];
    if (tableShown() && _tv.tab === 'cables') return withLookupPass(() => state.links.filter((l) => queryMatch(q, 'link', l)).map((l) => ({ type: 'link', id: l.id })));
    return withLookupPass(() => state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => ({ type: 'node', id: n.id })));
}

function selectQueryMatches() {
    const entries = queryMatchEntries();
    if (!entries.length) return;
    selectEntries(entries);
}

// A match folded into a collapsed group is framed by the group's node, which
// the map lights for it (mapPointsOf, js/groupmap.js).
function zoomToQueryMatches() {
    const nodes = queryMatchEntries().filter((e) => e.type === 'node').map((e) => getNode(e.id)).filter(Boolean);
    if (nodes.length) fitToView(mapPointsOf(nodes));
}

// The count, the buttons and the "not understood" line. Called after every
// map redraw and table rebuild, and when the view switches.
function updateQueryBar() {
    const bar = qEl('queryBar');
    if (!bar) return;
    const q = activeQuery();
    const tools = qEl('queryTools');
    bar.classList.toggle('q-on', !!q);
    tools.classList.toggle('q-on', !!q);
    const input = qEl('queryInput');
    if (input && document.activeElement !== input && input.value !== (state.query || '')) input.value = state.query || '';
    const count = qEl('queryCount'), err = qEl('queryError');
    const table = tableShown();
    let n = 0;
    if (!q) count.textContent = '';
    else if (table) {
        const total = _tv.total || 0;
        n = _tv.rows.filter((r) => !r.sub).length;
        count.textContent = t('Rows: {n} of {total}', { n, total });
    } else {
        n = _queryLastMap ? _queryLastMap.nodes.size : 0;
        count.textContent = t('Devices: {n} of {total}', { n, total: state.nodes.length });
    }
    tools.classList.toggle('q-none', !!q && !n);
    if (q && q.errors.length) {
        err.textContent = t('Not understood, so nothing matches: {terms}', { terms: q.errors.join(' ') });
        err.classList.remove('hidden');
        input.classList.add('bad');
    } else {
        err.textContent = '';
        err.classList.add('hidden');
        if (input) input.classList.remove('bad');
    }
    const any = !!q && n > 0;
    qEl('querySelectBtn').disabled = !any;
    qEl('queryZoomBtn').disabled = !any;
    // Nothing to zoom over the table or the rack view (js/rackview.js).
    qEl('queryZoomBtn').classList.toggle('hidden', table || rackShown());
    qEl('queryClearBtn').classList.toggle('hidden', !(state.query || '').length);
    syncTopbarHeight();
}

(function wireQuery() {
    const input = qEl('queryInput');
    if (!input) return;
    input.addEventListener('input', () => setQuery(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) {
            // A first Esc empties the box and keeps the focus in it; the
            // next one leaves it (the page's Esc, js/app.js).
            e.preventDefault(); e.stopPropagation();
            setQuery('');
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!tableShown()) zoomToQueryMatches();
        }
    });
    qEl('queryClearBtn').addEventListener('click', () => { setQuery(''); input.focus(); });
    qEl('querySelectBtn').addEventListener('click', selectQueryMatches);
    qEl('queryZoomBtn').addEventListener('click', zoomToQueryMatches);
})();

// How far down the pane the top row reaches, as --topbar-h on the body, for
// the findings panel and the table to start below (css/app.css). Measured,
// not guessed per breakpoint: the row's height depends on the pane's width,
// the language (Spanish buttons are longer) and whether the tools card or the
// "not understood" line is showing, and a fixed offset covered the panel's
// title or the table's tabs whenever the guess was wrong. Zero when the row is
// hidden (a reduced view). updateQueryBar() calls it straight after the tools
// card or the line appears, so the panel never waits a frame under the row;
// the observer catches the rest (a resized window, another language).
function syncTopbarHeight() {
    const bar = document.querySelector('.topo-topbar');
    if (!bar) return;
    const h = bar.offsetHeight ? bar.offsetTop + bar.offsetHeight : 0;
    document.body.style.setProperty('--topbar-h', `${h}px`);
}
(function watchTopbar() {
    const bar = document.querySelector('.topo-topbar');
    if (!bar) return;
    syncTopbarHeight();
    if (typeof ResizeObserver === 'function') new ResizeObserver(syncTopbarHeight).observe(bar);
})();
