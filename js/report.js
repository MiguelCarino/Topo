// The engagement deliverable: everything on the canvas, as a document someone
// can hand to a hospital's director and keep in a file.
//
// The diagram was always exportable; the findings never were. Every check in
// diagnostics.js already computes the sentence a consultant would write by
// hand — this file only collects them, adds the inventory the diagram implies,
// and lays the result out for paper. No new analysis lives here, deliberately:
// if the report and the Diagnostics panel ever disagree, one of them is lying.
//
// The document is standalone by construction — one HTML file with its styles
// inline and the diagram embedded as a data URI — so it survives being emailed,
// archived or opened on a machine that has never heard of this tool. Printing
// it to PDF is the browser's job, which is why there is no PDF library here.
//
// Load order: state -> i18n -> model -> data -> diagnostics -> ui -> report -> app

// ---- Metadata ----
// Who the survey was for, and who signed it. Held on the document rather than in
// settings so it rides the share URL and the .nettopo file: one link is then the
// whole engagement, not just the picture.
const REPORT_FIELDS = [
    { key: 'site', label: 'Site', placeholder: 'Hospital San José — Torre B' },
    { key: 'client', label: 'Client', placeholder: 'Grupo Médico del Norte, S.A. de C.V.' },
    { key: 'engineer', label: 'Prepared by', placeholder: 'Miguel Carino — Carino Systems' },
    { key: 'ref', label: 'Reference', placeholder: 'CS-2026-014' },
    { key: 'date', label: 'Date', placeholder: '' },
    { key: 'scope', label: 'Scope & notes', placeholder: 'What was surveyed, what was not, and anything the reader needs to know.', multiline: true }
];

// The LOCAL calendar date. toISOString() is UTC, so from late afternoon on in
// Mexico (UTC-6) every report, and its filename, was dated tomorrow. Every
// download is named <slug>-<this date> (docFileStem in js/app.js).
const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// A name as the first half of a filename. Accents fold to their letter
// ("José" -> "jose") and every run of anything else becomes one hyphen, but a
// letter is kept in any script: an ASCII-only slug turned every Japanese or
// Russian site name into the same "network".
function fileSlug(text, fallback = 'network') {
    // NFKD then NFC: accents on a Latin letter are taken off in between, and
    // any other mark (Japanese voicing, the breve of Russian й) goes back on
    // its letter.
    const slug = String(text || '').normalize('NFKD').replace(/([A-Za-z])[\u0300-\u036f]+/g, '$1').normalize('NFC').toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return slug || fallback;
}

function normalizeReportMeta(meta) {
    const m = meta || {};
    const out = {};
    REPORT_FIELDS.forEach(({ key }) => { out[key] = typeof m[key] === 'string' ? m[key] : ''; });
    if (!out.date) out.date = todayISO();
    return out;
}

// The name the open network is kept under (its library card), or ''. A
// report whose Site field was left blank is headed with it: the downloads
// were already named after the card ("oficina-reforma-2026-10-26…") while
// the report itself said "Site not named", one network under two names.
// Only the report reads it; nothing is written into the header, so the
// field stays blank (its placeholder says the name) and a later rename of
// the card is what the next report says.
function keptSiteName() {
    const card = state.libraryId && typeof libraryEntry === 'function' ? libraryEntry(state.libraryId) : null;
    return card && typeof card.name === 'string' ? card.name.trim() : '';
}
function siteReportMeta(meta) {
    const out = normalizeReportMeta(meta);
    if (!out.site.trim()) out.site = keptSiteName();
    return out;
}

// A document that has never had the dialog opened must serialize as if this
// feature did not exist — same trick annotations use, so untouched diagrams stay
// byte-identical in the URL hash.
function serializeReportMeta(meta) {
    if (!meta) return undefined;
    const kept = {};
    REPORT_FIELDS.forEach(({ key }) => { if (meta[key]) kept[key] = meta[key]; });
    return Object.keys(kept).length ? kept : undefined;
}

// ---- Vocabulary ----
// paletteDefs is the one place a type gets a human name; reading it here means a
// new device type appears in the inventory without being registered twice.
const NODE_TYPE_NAMES = Object.fromEntries(paletteDefs.map((d) => [d.type, d.name]));
const typeName = (type) => NODE_TYPE_NAMES[type] || type || 'Unknown';

const MEDIUM_NAMES = { utp: 'UTP copper', fiber: 'Fibre optic', wireless: 'Wireless', powerline: 'Powerline', vpn: 'VPN tunnel' };
const mediumName = (m) => MEDIUM_NAMES[m] || m || 'Unspecified';

const SEVERITY_NAMES = { bad: 'Critical', warn: 'Advisory' };

// A finding's detail is written to follow its panel prefix ("L2 loop: the link
// between …"), so on its own in a table cell it starts mid-sentence. Only the
// first letter moves, and only for display — the panel keeps its own wording.
const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---- The model ----
// Pure: no DOM, no formatting. The tests assert against this rather than against
// the rendered HTML, so a layout change cannot quietly break the content.

// Faceplate usage, counted the way evaluatePorts() counts it — sockets only, so
// an AP's wireless clients are not reported as cables in a port.
function portUsage(node) {
    if (!hasPortGrid(node)) return null;
    const total = portCountOf(node);
    const used = new Set(linksAtNode(node.id)
        .map((l) => ifaceIdOn(l, node.id))
        .filter((id) => /^p\d+$/.test(id))).size;
    return { used, total };
}

function reportInterface(node, iface) {
    const api = window.CarinoOUI;
    const decoded = hasMac(iface) && api ? api.decodeMac(iface.mac) : null;
    return {
        // The interface's id, so a view built on these rows (the table,
        // js/table.js) can find the interface it is about. Unique only inside
        // its device, like every interface id.
        id: iface.id,
        name: iface.name || iface.id,
        ip: iface.ip || '',
        mac: decoded && !decoded.error ? api.fmtColon(decoded.hex) : '',
        vendor: decoded && decoded.vendor && decoded.vendor.vendor ? decoded.vendor.vendor : '',
        wireless: ifaceIsWireless(iface),
        bond: isBond(iface) ? (BOND_MODES[iface.bond.mode] || iface.bond.mode) : '',
        member: isBondMember(node, iface.id)
    };
}

function reportDevices() {
    return state.nodes.map((node) => ({
        // Which device the row is about: the table view (js/table.js) selects
        // and edits by it. The rows themselves are never written back to.
        id: node.id,
        name: node.name || node.id,
        type: node.type,
        typeName: typeName(node.type),
        // The badge's severity: the engine's, so an issue accepted with a
        // reason is not flagged here either.
        severity: nodeDiagnosis(node).severity,
        // Explicit interfaces only. A 24-port switch would otherwise contribute
        // 24 blank rows to the inventory, which is noise, not documentation —
        // the faceplate is reported as a count instead.
        interfaces: (node.interfaces || []).map((iface) => reportInterface(node, iface)),
        ports: portUsage(node),
        // gw, dns, os, allowedPorts, nat, notes: whatever NODE_FIELDS marks
        // for the report (js/model.js), so a field added there reaches the
        // inventory without being listed a second time here.
        ...reportFieldsOf(node),
        // Where it is (Review-Packs/Topo-groups.md, "Location"): its group's
        // path and, in a rack, its units, else the free text it was given
        // (nodePlaceText). `location` above stays the free text, which is
        // what its table cell edits.
        place: nodePlaceText(node),
        groupId: groupOfNode(node) ? node.group : '',
        rackSpan: rackSpanText(node),
        // What it runs on (js/model.js "Hosts"): the table's Runs on column,
        // and the inventory lists it under its host.
        hostId: hostOf(node) ? node.host : '',
        host: hostOf(node) ? (hostOf(node).name || node.host) : ''
    }));
}

// The groups, in tree order (groupTree): each with its path, its kind, its
// parent's path and how many devices it holds itself (own) and with the
// groups inside it (deep). The table's Groups tab reads these rows, and the
// report's inventory is laid out under them.
function reportGroups() {
    const counts = new Map(), deep = new Map();
    const byId = new Map(state.groups.map((g) => [g.id, g]));
    state.nodes.forEach((n) => {
        if (!n.group || !byId.has(n.group)) return;
        counts.set(n.group, (counts.get(n.group) || 0) + 1);
        const seen = new Set();
        for (let g = byId.get(n.group); g && !seen.has(g.id); g = byId.get(g.parent)) { seen.add(g.id); deep.set(g.id, (deep.get(g.id) || 0) + 1); }
    });
    return groupTree().map(({ group: g, depth }) => {
        const parent = groupById(g.parent);
        return {
            id: g.id, depth,
            name: groupLabel(g),
            kind: g.kind,
            kindName: groupKindName(g.kind),
            path: groupPath(g),
            parentId: parent ? parent.id : '',
            parent: parent ? groupPath(parent) : '',
            uHeight: isRackGroup(g) ? (g.uHeight || RACK_U_DEFAULT) : null,
            // A rack's size (the table's Groups tab): its width, its depth
            // in mm when one was given, and its numbering ('bottom'|'top').
            width: isRackGroup(g) ? asRackWidth(g.width) : null,
            depthMm: isRackGroup(g) && Number.isInteger(g.depthMm) ? g.depthMm : null,
            numbering: isRackGroup(g) ? (rackTopDown(g) ? 'top' : 'bottom') : null,
            own: counts.get(g.id) || 0,
            deep: deep.get(g.id) || 0
        };
    });
}

// Derived and read-only: these rows are built for reading, and nothing ever
// writes back through them. A text field reads as '' when unset, a boolean as
// true or false. The gateway and DNS are the ones in force (R7): a device
// that inherits its network's is configured with it, and the inventory says
// what the device uses, not which field it was typed into.
const REPORT_EFFECTIVE = { gw: effectiveGw, dns: effectiveDns };
function reportFieldsOf(node) {
    const out = {};
    NODE_FIELDS.forEach((f) => {
        if (!f.report) return;
        const v = REPORT_EFFECTIVE[f.key] ? REPORT_EFFECTIVE[f.key](node) : node[f.key];
        out[f.report.key] = f.kind === 'bool' ? !!v : asText(v);
    });
    return out;
}

function reportConnections() {
    return state.links.map((link) => {
        const src = getNode(link.source), tgt = getNode(link.target);
        return {
            id: link.id,
            from: src ? (src.name || src.id) : '—',
            fromIface: src ? ifaceLabel(src, link.sourceIface) : '—',
            to: tgt ? (tgt.name || tgt.id) : '—',
            toIface: tgt ? ifaceLabel(tgt, link.targetIface) : '—',
            medium: mediumName(effectiveMedium(link)),
            mediumKey: effectiveMedium(link) || '',
            // The cable's own facts (link.cable, CABLE_FIELDS in js/model.js).
            label: cableOf(link, 'label').trim(),
            length: cableOf(link, 'length').trim(),
            color: cableOf(link, 'color').trim(),
            via: cableOf(link, 'via').trim()
        };
    }).filter((c) => c.from !== '—' && c.to !== '—');
}

// One row per network: the declared ones (R7) with what they say about
// themselves (name, VLAN, gateway, DNS, DHCP), even with nobody on them yet,
// then any subnet the addressing implies that nobody has declared. This is
// the table an auditor asks for and the one nobody has written down.
// `network`, `kind`, `isPrivate` and `devices` are what the estate report
// compares across sites.
function reportSubnets() {
    const byNet = new Map();
    state.networks.forEach((net) => {
        const p = parseValidCIDR(net.cidr);
        if (!p || byNet.has(net.cidr)) return;
        byNet.set(net.cidr, { id: net.id, network: net.cidr, kind: p.kind, isPrivate: p.isPrivate, declared: true,
            name: asText(net.name).trim(), vlan: Number.isInteger(net.vlan) ? net.vlan : null, purpose: asText(net.purpose).trim(),
            gateway: asText(net.gateway).trim(), dns: asText(net.dns).trim(), dhcp: !!net.dhcp, devices: [], nodeIds: [] });
    });
    state.nodes.forEach((node) => {
        getValidIps(node).forEach((parsed) => {
            const net = networkOfIp(parsed.ip);
            const key = net ? net.cidr : parsed.networkStr;
            if (!byNet.has(key)) {
                byNet.set(key, { id: null, network: key, kind: parsed.kind, isPrivate: parsed.isPrivate, declared: false,
                    name: '', vlan: null, purpose: '', gateway: '', dns: '', dhcp: false, devices: [], nodeIds: [] });
            }
            const entry = byNet.get(key);
            const name = node.name || node.id;
            if (!entry.devices.includes(name)) entry.devices.push(name);
            // By id as well as by name: two devices may share a name, and the
            // table view selects a network's devices from this list.
            if (!entry.nodeIds.includes(node.id)) entry.nodeIds.push(node.id);
        });
    });
    return [...byNet.values()].sort((a, b) => a.network.localeCompare(b.network));
}

// Every faceplate port of every switch and access point, cabled or free, in
// port order: its name as the box gives it (node.portScheme), what is written
// about it (node.portAttrs: a label, an access VLAN) and what is plugged in.
// The rows of the table's Ports tab (js/table.js); derived, like every row
// here, so an edit there is written to the node, never to the row.
function reportPorts() {
    const out = [];
    state.nodes.filter(hasPortGrid).forEach((node) => {
        const total = portCountOf(node);
        faceplatePortIds(node).forEach((id) => {
            const a = portAttrOf(node, id);
            const n = Number(id.slice(1));
            const link = linkOnIface(node.id, id);
            const peerId = link ? (link.source === node.id ? link.target : link.source) : null;
            const peer = peerId ? getNode(peerId) : null;
            const peerIface = peer ? ifaceIdOn(link, peerId) : null;
            out.push({ nodeId: node.id, portId: id, number: n, device: node.name || node.id, port: ifaceLabel(node, id),
                label: a.label, vlan: a.vlan, over: n > total,
                peerId: peer ? peer.id : null, peer: peer ? peer.name || peer.id : '', peerIface: peer ? ifaceLabel(peer, peerIface) : '',
                linkId: link && peer ? link.id : null, cable: link ? cableOf(link, 'label').trim() : '' });
        });
    });
    return out;
}

// Each rack as it would be drawn on the door (Review-Packs/Topo-groups.md,
// step C): its units from the top down, front and rear, each run of units
// one device or empty, then the devices in it with no unit yet, and its
// cables as the rack view has them (rackCables, js/model.js): one line per
// pair of its devices, and each cable out of it by the device it goes to.
// A unit two devices claim (a sheet can say so; the rack view cannot) is a
// row of its own naming both, marked, as the finding names them. A device
// whose units are outside the rack is listed under the rack, not drawn in it.
// Racks in the Groups tab's order; a rack nobody put anything in is left out
// (an empty frame is a page of nothing).
function reportRacks() {
    return groupTree().map((e) => e.group).filter(isRackGroup).map((rack) => {
        const top = rackTop(rack);
        const members = rackMembers(rack);
        if (!members.length) return null;
        const placed = members.filter((n) => rackSpanOf(n));
        const name = (n) => n.name || n.id;
        const faces = RACK_FACES.map((face) => {
            // Who is in each unit on this face: its own devices, and the
            // backs of the full-depth ones mounted on the other.
            const at = Array.from({ length: top + 1 }, () => []);
            placed.forEach((n) => {
                const s = rackSpanOf(n);
                const back = s.face !== face;
                if (back && !rackFullDepth(n)) return;
                for (let u = Math.max(1, s.lo); u <= Math.min(top, s.hi); u++) at[u].push({ n, back });
            });
            const rows = [];
            for (let u = top; u >= 1;) {
                const here = at[u];
                if (!here.length) { rows.push({ u, span: 1, empty: true }); u--; continue; }
                const one = here.length === 1 ? here[0] : null;
                const s = one ? rackSpanOf(one.n) : null;
                // A device alone in all of its units is one cell over them.
                let span = 1;
                if (one) {
                    const lo = Math.max(1, s.lo);
                    if (Math.min(top, s.hi) === u && [...Array(u - lo + 1).keys()].every((k) => at[u - k].length === 1 && at[u - k][0].n === one.n)) span = u - lo + 1;
                }
                rows.push({ u, span, clash: here.length > 1,
                    items: here.map(({ n, back }) => ({ name: name(n), type: n.type, typeName: typeName(n.type),
                        units: (() => { const x = rackSpanOf(n); return rackUnitsText(rack, x.lo, x.hi); })(),
                        back, full: rackFullDepth(n), status: n.status === 'planned' || n.status === 'retired' ? n.status : '',
                        // What runs on it, on the face it is mounted on (its back is its units only).
                        guests: back ? [] : guestTreeOf(n).map(name) })) });
                u -= span;
            }
            return { face, rows };
        });
        const outside = placed.filter((n) => !rackSpanInside(rack, rackSpanOf(n).lo, rackSpanOf(n).hi)).map((n) => `${name(n)} (${rackSpanText(n)})`);
        // A VM or a container on a host is listed in its host's units, not here.
        const unplaced = members.filter((n) => !rackSpanOf(n) && !hostOf(n)).map(name);
        const { pairs, stubs } = rackCables(rack);
        const cableText = (links, from) => links.map((l) => { const x = rackCableText(l, from); return [x.ports, x.label, x.color].filter(Boolean).join(' · '); }).join('; ');
        return {
            // Its size as one line, and which way its units are numbered:
            // the rows stay counted from the bottom (u), and the printed
            // number of each is racksSection's to work out (topDown).
            id: rack.id, path: groupPath(rack), top, size: rackSizeText(rack), topDown: rackTopDown(rack), inches: rackWidthInches(rack), faces, outside, unplaced,
            // Each placed host and what runs on it, in full: a 1U box's cell
            // has room for a few names at most, and cuts the rest.
            hosts: placed.map((n) => ({ name: name(n), guests: guestTreeOf(n).map(name) })).filter((h) => h.guests.length),
            pairs: pairs.map((pr) => ({ a: name(pr.a), b: name(pr.b), count: pr.links.length, text: cableText(pr.links, pr.a) })),
            stubs: stubs.map((st) => ({ node: name(st.node), far: name(st.far), where: nodePlaceText(st.far), count: st.links.length, text: cableText(st.links, st.node) }))
        };
    }).filter(Boolean);
}

// Every device with a faceplate (a switch, an access point) and what is in
// each of its ports, in port order: the page a technician tracing a cable at
// the rack wants, which the connections table (one row per cable, in the
// order they were drawn) is not. Named interfaces (an uplink called sfp1, an
// AP's radio) follow the numbered ports, in name order; the free ports are
// written as ranges ("3, 5–8") rather than as rows, except a free port
// somebody labelled or gave a VLAN, which is a row of its own: that is the
// jack the next device goes in. Ports read as the box names them
// (node.portScheme), and the Label and VLAN columns appear on a switch whose
// ports carry them.
function reportPortMaps() {
    const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });
    return state.nodes.filter(hasPortGrid).map((node) => {
        const rows = [];
        linksAtNode(node.id).forEach((link) => {
            const mine = ifaceIdOn(link, node.id);
            const peerId = link.source === node.id ? link.target : link.source;
            const peerIface = link.source === node.id ? link.targetIface : link.sourceIface;
            const peer = getNode(peerId);
            if (!peer) return;
            const m = /^p(\d+)$/.exec(mine || '');
            const a = portAttrOf(node, mine);
            rows.push({ port: m ? Number(m[1]) : null, label: ifaceLabel(node, mine), linkId: link.id, peerId: peer.id,
                peer: peer.name || peer.id, peerIface: ifaceLabel(peer, peerIface), ip: asText(ifaceOn(peer, peerIface)?.ip),
                cable: cableOf(link, 'label').trim(), medium: mediumName(effectiveMedium(link)),
                portLabel: a.label, vlan: a.vlan, free: false });
        });
        // Free ports with something written about them.
        const cabled = new Set(rows.filter((r) => r.port !== null).map((r) => r.port));
        Object.keys(node.portAttrs || {}).forEach((id) => {
            const m = /^p(\d+)$/.exec(id);
            if (!m || cabled.has(Number(m[1])) || !hasPortAttrs(node, id)) return;
            const a = portAttrOf(node, id);
            rows.push({ port: Number(m[1]), label: ifaceLabel(node, id), linkId: null, peerId: null, peer: '', peerIface: '', ip: '',
                cable: '', medium: '', portLabel: a.label, vlan: a.vlan, free: true });
        });
        rows.sort((a, b) => ((a.port === null) - (b.port === null)) || (a.port !== null ? a.port - b.port : 0)
            || byName(a.label, b.label) || byName(a.peer, b.peer));
        const total = portCountOf(node);
        const taken = new Set(rows.filter((r) => r.port !== null && !r.free).map((r) => r.port));
        const listed = new Set(rows.filter((r) => r.port !== null).map((r) => r.port));
        const free = [];
        for (let i = 1; i <= total; i++) {
            if (listed.has(i)) continue;
            const last = free[free.length - 1];
            if (last && last[1] === i - 1) last[1] = i; else free.push([i, i]);
        }
        const name = (n) => portNameOf(node, n);
        return { id: node.id, name: node.name || node.id, typeName: typeName(node.type), total, used: taken.size, rows,
            hasLabels: rows.some((r) => r.portLabel), hasVlans: rows.some((r) => r.vlan !== null),
            free: free.map(([a, b]) => (a === b ? name(a) : `${name(a)}–${name(b)}`)).join(', ') };
    }).filter((m) => m.rows.length)
        .sort((a, b) => byName(a.name, b.name));
}

// Past this many devices the diagram no longer reads at the width of a page
// of text, and it pushed the inventory pages down behind it: it goes to an
// appendix at the end, on a page of its own, and the report says so where it
// would have been.
const REPORT_DIAGRAM_INLINE_MAX = 40;

// Read-only, so the whole model is built in one lookup pass (js/model.js):
// every device's row asks its diagnosis, its effective gateway and DNS and
// its addresses, and the pass answers each from one index instead of a scan
// or a whole-document key per device. withDoc() (binderSiteModels below)
// swaps the document in first, so the pass indexes the site being reported.
function reportModel() { return withLookupPass(reportModelNow); }
function reportModelNow() {
    // Severity order, then the order the checks ran in. topologyFindings() walks
    // nodes before links, so ties keep the reading order of the Findings tab
    // rather than whatever the sort happens to do with equal keys.
    // A finding accepted with a reason (js/diagnostics.js) is printed in a
    // section of its own, "Known / accepted", with the reason, and is not
    // counted: the totals are what is still open.
    const all = topologyFindings()
        .map((f, seq) => ({ ...f, seq }))
        .sort((a, b) => (a.level === b.level ? a.seq - b.seq : (a.level === 'bad' ? -1 : 1)));
    const findings = all.filter((f) => !f.accepted);
    const accepted = all.filter((f) => f.accepted);

    const devices = reportDevices();
    const connections = reportConnections();
    const subnets = reportSubnets();
    const groups = reportGroups();
    const racks = reportRacks();

    return {
        meta: siteReportMeta(state.report),
        findings,
        accepted,
        devices,
        groups,
        racks,
        connections,
        subnets,
        portMaps: reportPortMaps(),
        counts: {
            devices: devices.length,
            connections: connections.length,
            subnets: subnets.length,
            critical: findings.filter((f) => f.level === 'bad').length,
            advisory: findings.filter((f) => f.level === 'warn').length,
            accepted: accepted.length
        }
    };
}

// ============================================================================
// The estate: every saved network as one document
// ============================================================================
// The same rule as the rest of this file, one level up. Nothing here is a new
// check. Every number on the cover is an aggregation of what withDoc() +
// reportModel() already say about each stored network, so a card, a site report
// and the estate report cannot disagree by construction.
//
// The one thing this document can show that a single-site report structurally
// cannot is a subnet used in two buildings. It is printed as a FACT with a
// count and no severity — never as a finding — because topologyFindings() has
// no cross-site check, and a report that graded it would be asserting something
// the Diagnostics panel can never confirm.

// A stable per-site anchor for the index links. Entry ids are minted locally
// and are already id-safe, but a binder that arrived from elsewhere is not
// trusted to have kept that property.
const siteAnchor = (id, i) => (/^[A-Za-z0-9_-]+$/.test(id || '') ? `site-${id}` : `site-s${i}`);

function binderSiteModels(entries) {
    return entries.map((e, i) => {
        const base = { id: e.id, name: e.name, updated: e.updated, anchor: siteAnchor(e.id, i) };
        try {
            // withDoc lends the stored document AND its survey header, so
            // reportModel().meta below is this site's header, not the canvas's.
            const model = withDoc(e.doc, () => reportModel());
            // rawMeta is the header as stored, unnormalized. The normalized one
            // has a date invented for it, so comparing sheets against the cover
            // on model.meta printed today's date on every site — a value none of
            // them recorded, contradicting the cover of the same deliverable.
            return Object.assign(base, { model, meta: model.meta, rawMeta: (e.doc && e.doc.report) || {}, counts: model.counts, siteRefs: withDoc(e.doc, () => state.nodes.filter((n) => n.siteRef).map((n) => ({ from: n.name, ref: n.siteRef }))) });
        } catch (err) {
            // A stored document too old or too broken to model still gets a
            // sheet: leaving it out silently would understate the estate.
            return Object.assign(base, { unreadable: true, siteRefs: [], rawMeta: (e.doc && e.doc.report) || {},
                counts: { devices: (e.doc.nodes || []).length, connections: 0, subnets: 0, critical: 0, advisory: 0 } });
        }
    }).sort((a, b) => a.name.localeCompare(b.name));   // stable across regenerations, unlike libraryEntries()
}

// Every finding in the estate, worst first, each carrying the site it came
// from. Ties keep per-site check order, then site name, so two runs over an
// unchanged binder produce the same register.
function estateFindingRows(sites) {
    const rows = [];
    sites.forEach((s) => {
        if (!s.model) return;
        s.model.findings.forEach((f) => rows.push(Object.assign({}, f, { site: s.name })));
    });
    return rows.sort((a, b) => (a.level === b.level
        ? (a.site === b.site ? a.seq - b.seq : a.site.localeCompare(b.site))
        : (a.level === 'bad' ? -1 : 1)));
}

// Addressing across the estate. Exact network-string equality only: the report
// says "this network appears in two buildings", which is a fact it can prove
// from two documents. Deciding whether a /16 at HQ overlapping a /24 at a
// branch is a fault needs to know whether the two are routed together, which
// the survey does not record — so it is not claimed.
function estateSubnets(sites) {
    const byNet = new Map();
    sites.forEach((s) => {
        if (!s.model) return;
        s.model.subnets.forEach((sub) => {
            if (!byNet.has(sub.network)) {
                byNet.set(sub.network, { network: sub.network, kind: sub.kind, isPrivate: sub.isPrivate, sites: [] });
            }
            byNet.get(sub.network).sites.push({ site: s.name, devices: sub.devices });
        });
    });
    return [...byNet.values()]
        .map((r) => Object.assign(r, { devices: r.sites.reduce((n, x) => n + x.devices.length, 0) }))
        // Shared networks first — they are the reason this table exists — then
        // alphabetically, so the ordering never depends on library order.
        .sort((a, b) => (b.sites.length - a.sites.length) || a.network.localeCompare(b.network));
}

// The estate graph, from the siteRef a cloud carries. Ranks by longest path to
// a sink so hubs sit above branches; the relaxation is capped at one pass per
// site, which is what stops a reference cycle (Torre A -> Torre B -> Torre A,
// which a user can absolutely draw) from hanging the tab. Names within a rank
// are sorted, so an unchanged binder draws the same picture tomorrow.
function estateGraph(sites) {
    const byId = new Map(sites.map((s) => [s.id, s]));
    const nodes = sites.map((s) => ({ id: s.id, name: s.name }));
    const edges = [];
    sites.forEach((s) => {
        (s.siteRefs || []).forEach((r) => {
            const target = r.ref.id && byId.get(r.ref.id);
            edges.push({ from: s.id, fromName: s.name, toId: target ? target.id : null,
                toName: target ? target.name : (r.ref.name || ''), via: r.from, resolved: !!target });
        });
    });
    const rank = new Map(nodes.map((n) => [n.id, 0]));
    for (let pass = 0; pass < nodes.length; pass++) {
        let moved = false;
        edges.forEach((e) => {
            if (!e.resolved) return;
            if (rank.get(e.from) <= rank.get(e.toId)) { rank.set(e.from, rank.get(e.toId) + 1); moved = true; }
        });
        if (!moved) break;
    }
    // Ascending: rank 0 is a site nothing of this estate reaches through — the
    // hub — and it belongs at the TOP, the way upstream sits at the top of the
    // canvas itself. Emitting maxRank first put the branch offices above their
    // own HQ and pointed every arrow downward at a leaf.
    const maxRank = Math.max(0, ...nodes.map((n) => rank.get(n.id)));
    const rows = [];
    for (let r = 0; r <= maxRank; r++) {
        const row = nodes.filter((n) => rank.get(n.id) === r).sort((a, b) => a.name.localeCompare(b.name));
        if (row.length) rows.push(row);
    }
    return { rows, edges, nodes };
}

// What the estate header offers as a starting point: for each field, the value
// the most sites already agree on. The engineer confirms or overrides it in the
// dialog, and the answer is used for this one document and persisted nowhere —
// an estate header is a property of a deliverable, not of any saved network.
function binderHeaderDefaults(sites) {
    const out = {};
    REPORT_FIELDS.forEach(({ key }) => {
        if (key === 'site') return;   // the estate's own name is always typed
        const tally = new Map();
        sites.forEach((s) => {
            const v = s.rawMeta && s.rawMeta[key];   // what was recorded, not what was defaulted
            if (typeof v === 'string' && v) tally.set(v, (tally.get(v) || 0) + 1);
        });
        let best = '', bestN = 0;
        tally.forEach((n, v) => { if (n > bestN) { best = v; bestN = n; } });
        if (best) out[key] = best;
    });
    return out;
}

function binderModel(entries, estateMeta) {
    const sites = binderSiteModels(entries);
    const findings = estateFindingRows(sites);
    const subnets = estateSubnets(sites);
    return {
        meta: normalizeReportMeta(estateMeta),
        sites, findings, subnets,
        graph: estateGraph(sites),
        counts: {
            sites: sites.length,
            devices: sites.reduce((n, s) => n + s.counts.devices, 0),
            connections: sites.reduce((n, s) => n + s.counts.connections, 0),
            // Distinct across the estate, never the sum: the same network in two
            // buildings is one network, and a total that double-counted it would
            // contradict the table directly underneath.
            subnets: subnets.length,
            critical: findings.filter((f) => f.level === 'bad').length,
            advisory: findings.filter((f) => f.level === 'warn').length,
        },
    };
}

// ---- The document ----
// Print-first: A4 with real margins, tables that break across pages without
// losing their headers, and nothing that depends on a screen being present.
function reportStyles() {
    return `
    /* Margins only, and deliberately no paper size. Forcing A4 makes a Letter/Carta
       printer scale the page, and Carta is what most of this report's readers
       have loaded. The screen view still uses A4 proportions; print fills
       whatever paper the dialog is set to. */
    @page { margin: 16mm 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #f1f5f9; color: #0f172a;
           font: 13px/1.5 "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 18mm 16mm; box-shadow: 0 1px 3px rgba(15,23,42,0.15); }
    /* Only the estate report ever has a second sheet; a single-site document is
       unaffected because the selector never matches. */
    .sheet + .sheet { margin-top: 18px; page-break-before: always; break-before: page; }
    h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -0.01em; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569;
         margin: 26px 0 8px; padding-bottom: 5px; border-bottom: 1px solid #e2e8f0; page-break-after: avoid; }
    p { margin: 0 0 8px; }
    .sub { color: #64748b; font-size: 12px; margin: 0 0 14px; }
    .rule { height: 3px; background: #eab308; margin: 0 0 14px; }

    .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; margin-bottom: 6px; }
    .meta div { display: flex; gap: 8px; font-size: 12px; border-bottom: 1px dotted #e2e8f0; padding: 3px 0; }
    .meta dt { color: #64748b; min-width: 92px; margin: 0; }
    .meta dd { margin: 0; font-weight: 600; }

    /* Grid, not flex: five flex items with min-width:auto can total wider than
       the page box and put the last tile's border under the margin. A grid of
       equal fractions cannot overflow, and it still reflows on a narrow screen. */
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 8px; margin: 12px 0 4px; }
    .stat { border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; min-width: 0; }
    .stat b { display: block; font-size: 20px; line-height: 1.1; }
    .stat span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: #64748b; }
    .stat.crit { border-color: #fecaca; background: #fef2f2; } .stat.crit b { color: #b91c1c; }
    .stat.adv  { border-color: #fde68a; background: #fffbeb; } .stat.adv b { color: #b45309; }

    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 4px; }
    thead { display: table-header-group; }
    th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em;
         color: #475569; border-bottom: 1.5px solid #cbd5e1; padding: 5px 6px; }
    td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tr { page-break-inside: avoid; }
    /* Breaking anywhere belongs on addresses, which are long and unbreakable,
       and nowhere else: applied to prose it splits Cyrillic words mid-syllable
       and hands a CJK column one character per line. */
    .mono { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; overflow-wrap: anywhere; }
    .muted { color: #94a3b8; }
    .num { width: 26px; color: #94a3b8; }
    /* Fixed columns for the findings table. Left to itself the browser gives the
       narrow columns whatever the widest sentence does not want, and the check
       name — the shortest cell and the one that names the problem — loses. */
    .findings { table-layout: fixed; }
    .findings th:nth-child(1), .findings td:nth-child(1) { width: 26px; }
    .findings th:nth-child(2), .findings td:nth-child(2) { width: 82px; }
    .findings th:nth-child(3), .findings td:nth-child(3) { width: 17%; }
    .findings th:nth-child(4), .findings td:nth-child(4) { width: 15%; }
    /* The estate register inserts Site at column 3, so everything after it
       shifts one place right. */
    .findings.estate th:nth-child(3), .findings.estate td:nth-child(3) { width: 15%; }
    .findings.estate th:nth-child(4), .findings.estate td:nth-child(4) { width: 15%; }
    .findings.estate th:nth-child(5), .findings.estate td:nth-child(5) { width: 14%; }
    /* Estate extras: the shared-network tint, the site index, the graph. */
    tr.multi td { background: #fffbeb; }
    .idx td:first-child a { color: #0f172a; text-decoration: none; border-bottom: 1px solid #cbd5e1; }
    .estate-graph { width: 100%; height: auto; margin: 4px 0 10px; }
    .estate-graph text { font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

    .sev { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9.5px;
           font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
    .sev.bad { background: #fee2e2; color: #991b1b; }
    .sev.warn { background: #fef3c7; color: #92400e; }

    .clean { border: 1px solid #a7f3d0; background: #ecfdf5; color: #065f46; border-radius: 4px; padding: 10px 12px; }
    .figure { margin: 10px 0 4px; text-align: center; page-break-inside: avoid; }
    .figure img { max-width: 100%; border: 1px solid #e2e8f0; border-radius: 4px; }
    .caption { font-size: 10px; color: #64748b; margin-top: 5px; }

    /* The compact inventory: one line per interface. A device's first line
       carries its name and its own fields; the lines after it only the
       interface, without the rule between them, so a device reads as one block. */
    .inv td { padding: 3px 6px; }
    .inv tr.cont td { border-top: 0; }
    .inv tr.dev td { border-top: 1px solid #e2e8f0; }
    .inv tr.guest > td:first-child { padding-left: calc(6px + var(--guest, 1) * 14px); }
    .inv tr.grp td { border-top: 1px solid #cbd5e1; padding-top: 8px; background: #f8fafc; }
    .inv tbody tr:first-child td { border-top: 0; }
    /* The switch port map: one small table per switch, headed by its name. */
    h3 { font-size: 12px; margin: 14px 0 4px; page-break-after: avoid; }
    h3 .muted { font-weight: 400; }
    .ports td:first-child, .ports th:first-child { width: 52px; }
    .free { font-size: 10.5px; margin: 2px 0 8px; }
    /* The changes table (js/changes.js): the change and the item stay narrow. */
    .changes td:first-child { width: 70px; white-space: nowrap; }
    .changes td:nth-child(2) { width: 34%; }
    /* The accepted findings: the reason is the column that matters. */
    .accepted td:last-child { color: #334155; }
    .appendix { page-break-before: always; break-before: page; }
    /* The rack elevations: front and rear side by side, a unit a row, so a
       42U rack is a third of a page and never splits. */
    .rack { page-break-inside: avoid; break-inside: avoid; margin-bottom: 14px; }
    .elevs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .elev { table-layout: fixed; border: 1.5px solid #64748b; }
    .elev th { text-align: center; }
    .elev td { padding: 0 6px; height: 13px; line-height: 12px; font-size: 9px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
    .elev col.ruc { width: 30px; }
    .elev td.ru { text-align: right; color: #94a3b8; font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; border-right: 1.5px solid #64748b; }
    .elev td.rs { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .elev td.rs:not(.empty) { background: #f1f5f9; border: 1px solid #94a3b8; }
    .elev td.back { background: repeating-linear-gradient(135deg, #fff 0 4px, #e2e8f0 4px 5px); }
    .elev td.retired { color: #94a3b8; }
    .elev td.clash { background: #fef2f2; border-color: #b91c1c; color: #991b1b; }
    .elev .guests { color: #475569; font-style: italic; }
    .rackcab td:first-child { width: 42%; }

    .note { font-size: 10.5px; color: #475569; background: #f8fafc; border-left: 3px solid #cbd5e1;
            padding: 9px 12px; margin: 8px 0; white-space: pre-wrap; }
    footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e2e8f0;
             font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; gap: 12px; }

    .toolbar { max-width: 210mm; margin: 0 auto 12px; display: flex; justify-content: flex-end; }
    .toolbar button { background: #0f172a; color: #fff; border: 0; border-radius: 4px;
                      padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; }

    @media print {
        body { background: #fff; padding: 0; }
        .sheet { box-shadow: none; max-width: none; padding: 0; }
        /* On paper the page break IS the separation; the screen gap would print
           as a stripe of dead space at the top of every site's first page. */
        .sheet + .sheet { margin-top: 0; }
        .toolbar { display: none; }
        h2 { margin-top: 18px; }
    }`;
}

function findingsSection(findings, opts = {}) {
    if (!findings.length && opts.accepted) {
        return `<div class="clean"><b>${escapeHtml(t('No open findings: every one raised is accepted, with its reason, below.'))}</b></div>`;
    }
    if (!findings.length) {
        return `<div class="clean"><b>${t('No faults were raised by the documented configuration.')}</b><br>
            ${escapeHtml(t('Every automated check passed against the topology as recorded. That is a statement about the drawing, not a clean bill of health for the network — see Scope and method.'))}</div>`;
    }
    // The estate register is the same table with the site named — one renderer,
    // so the register and a site's own findings can never word a finding
    // differently.
    const rows = findings.map((f, i) => `
        <tr>
            <td class="num">${i + 1}</td>
            <td><span class="sev ${f.level}">${escapeHtml(t(SEVERITY_NAMES[f.level] || f.level))}</span></td>
            ${opts.site ? `<td><b>${escapeHtml(f.site || '—')}</b></td>` : ''}
            <td><b>${escapeHtml(f.subject || '—')}</b></td>
            <td class="muted">${escapeHtml(f.check)}</td>
            <td>${escapeHtml(sentenceCase(f.detail))}</td>
        </tr>`).join('');
    return `<table class="findings${opts.site ? ' estate' : ''}">
        <thead><tr><th></th><th>${t('Severity')}</th>${opts.site ? `<th>${t('Site')}</th>` : ''}<th>${t('Device')}</th><th>${t('Check')}</th><th>${t('Finding')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// Known / accepted: what was raised and accepted, with who-knows-why written
// down. The same columns as the findings, the reason in place of a severity.
function acceptedSection(accepted) {
    const rows = accepted.map((f, i) => `
        <tr>
            <td class="num">${i + 1}</td>
            <td><b>${escapeHtml(f.subject || '—')}</b></td>
            <td class="muted">${escapeHtml(f.check)}</td>
            <td>${escapeHtml(sentenceCase(f.detail))}</td>
            <td>${escapeHtml(f.accepted.reason)}</td>
        </tr>`).join('');
    return `<p class="muted">${escapeHtml(t('Raised by the checks and accepted as known, for the reason given. They are not counted in the summary.'))}</p>
        <table class="accepted">
        <thead><tr><th></th><th>${t('Device')}</th><th>${t('Check')}</th><th>${t('Finding')}</th><th>${t('Reason')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// One small table per switch or access point, in port order. The Label and
// VLAN columns are there only on a switch whose ports carry them, so a
// report of a site nobody labelled reads as it always did.
// The racks: per rack, its path and height, front and rear side by side as
// two columns of units, then what is not drawn in them and its cables.
function racksSection(racks) {
    const face = (f, rack) => {
        // The number printed beside unit u: from the top on a rack set so.
        const no = (u) => (rack.topDown ? rack.top - u + 1 : u);
        const rows = f.rows.map((r) => {
            const unit = Array.from({ length: r.span }, (_, k) => r.u - k);
            if (r.empty) return `<tr><td class="ru">${no(r.u)}</td><td class="rs empty"></td></tr>`;
            const cell = r.items.map((it) => `<b>${escapeHtml(it.name)}</b>`
                + ` <span class="muted">${escapeHtml([t(it.typeName), it.units, it.back ? t('back') : it.full ? '' : t('half depth'), it.status ? statusName(it.status) : ''].filter(Boolean).join(' · '))}</span>`
                + (it.guests && it.guests.length ? ` <span class="guests">${escapeHtml(t('Runs here: {names}', { names: it.guests.join(', ') }))}</span>` : '')).join(' / ');
            const cls = ['rs', r.clash ? 'clash' : '', r.items.every((it) => it.back) ? 'back' : '',
                r.items.some((it) => it.status === 'retired') ? 'retired' : ''].filter(Boolean).join(' ');
            return unit.map((u, k) => `<tr><td class="ru">${no(u)}</td>${k === 0 ? `<td class="${cls}" rowspan="${r.span}">${cell}</td>` : ''}</tr>`).join('');
        }).join('');
        // As wide as the rack against a 19" one, as the rack view draws it
        // (a 23" one fills its half of the page too: there is no wider).
        const pct = Math.round(Math.min(1, (rack.inches || 19) / 19) * 100);
        return `<table class="elev"${pct < 100 ? ` style="width:${pct}%"` : ''}><colgroup><col class="ruc"><col></colgroup><thead><tr><th colspan="2">${escapeHtml(t(f.face === 'rear' ? 'Rear' : 'Front'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    return racks.map((rack) => {
        const notes = [
            rack.outside.length ? `<p class="free"><b>${escapeHtml(t('Outside its units'))}:</b> ${escapeHtml(rack.outside.join(', '))}</p>` : '',
            rack.unplaced.length ? `<p class="free"><b>${escapeHtml(t('Not placed yet'))}:</b> ${escapeHtml(rack.unplaced.join(', '))}</p>` : '',
            ...(rack.hosts || []).map((h) => `<p class="free"><b>${escapeHtml(t('Runs on {host}', { host: h.name }))}:</b> ${escapeHtml(h.guests.join(', '))}</p>`)
        ].join('');
        const cables = rack.pairs.map((c) => `<tr><td>${escapeHtml(c.a)} ↔ ${escapeHtml(c.b)}${c.count > 1 ? ` <span class="muted">×${c.count}</span>` : ''}</td><td class="mono">${escapeHtml(c.text)}</td></tr>`)
            .concat(rack.stubs.map((c) => `<tr><td>${escapeHtml(c.node)} → ${escapeHtml(c.far)}${c.where ? ` <span class="muted">(${escapeHtml(c.where)})</span>` : ''}${c.count > 1 ? ` <span class="muted">×${c.count}</span>` : ''}</td><td class="mono">${escapeHtml(c.text)}</td></tr>`)).join('');
        return `<div class="rack">
        <h3>${escapeHtml(rack.path)} <span class="muted">${escapeHtml(rack.size || `${rack.top}U`)}${rack.topDown ? ` · ${escapeHtml(t('numbered from the top'))}` : ''}</span></h3>
        <div class="elevs">${rack.faces.map((f) => face(f, rack)).join('')}</div>
        ${notes}
        ${cables ? `<table class="rackcab"><thead><tr><th>${escapeHtml(t('Cable'))}</th><th>${escapeHtml(t('Ports'))}</th></tr></thead><tbody>${cables}</tbody></table>` : ''}
    </div>`;
    }).join('');
}

function portMapsSection(maps) {
    return maps.map((m) => `
        <h3>${escapeHtml(m.name)} <span class="muted">· ${escapeHtml(t(m.typeName))} · ${escapeHtml(t('{used} of {total} ports used', { used: m.used, total: m.total }))}</span></h3>
        <table class="ports">
        <thead><tr><th>${t('Port')}</th>${m.hasLabels ? `<th>${t('Label')}</th>` : ''}${m.hasVlans ? '<th>VLAN</th>' : ''}<th>${t('Device')}</th><th>${t('Interface')}</th><th>${t('Address')}</th><th>${t('Cable')}</th></tr></thead>
        <tbody>${m.rows.map((r) => `<tr${r.free ? ' class="free-port"' : ''}>
            <td class="mono"><b>${escapeHtml(r.label)}</b></td>
            ${m.hasLabels ? `<td>${escapeHtml(r.portLabel)}</td>` : ''}
            ${m.hasVlans ? `<td class="mono">${r.vlan === null ? '' : r.vlan}</td>` : ''}
            ${r.free ? `<td class="muted" colspan="4">${escapeHtml(t('Free'))}</td>` : `
            <td><b>${escapeHtml(r.peer)}</b></td>
            <td class="mono muted">${escapeHtml(r.peerIface)}</td>
            <td class="mono">${escapeHtml(r.ip) || '<span class="muted">—</span>'}</td>
            <td>${r.cable ? `<span class="mono">${escapeHtml(r.cable)}</span> · ` : ''}<span class="muted">${escapeHtml(t(r.medium))}</span></td>`}
        </tr>`).join('')}</tbody></table>
        ${m.free ? `<p class="free muted">${escapeHtml(t('Free: {ports}', { ports: m.free }))}</p>` : ''}`).join('');
}

// An interface's own line: its name and what kind of port it is, then its
// address and MAC in columns of their own.
function ifaceNameCell(iface) {
    const kind = iface.bond ? `${t('bond')} · ${iface.bond}` : iface.member ? t('bond member') : iface.wireless ? t('radio') : '';
    return `<b>${escapeHtml(iface.name)}</b>${kind ? ` <span class="muted">${escapeHtml(kind)}</span>` : ''}`;
}

// The compact inventory: one line per interface, so a site of three hundred
// devices is a few pages a technician can scan down, not a stack of cells. A
// device's name, type, gateway, DNS and model are on its first line; a device
// with no interface recorded still gets one line, which says so.
//
// With groups (reportGroups), the inventory is laid out under them in tree
// order: a heading line per group that holds devices itself, its path and
// kind, then those devices, and the devices in no group last under a heading
// of their own. A device under its group's heading says only its units, if
// any; the path is the heading. A site with no groups prints as before.
// A host's guests listed straight under it, and a container in a VM under
// the VM, each marked with its depth (d.guest), in the order given otherwise.
// Only within `list`: a guest whose host is under another heading (a scratch
// copy that skipped repairHosts) keeps its own place. Pure.
function hostOrdered(list) {
    const here = new Set(list.map((d) => d.id));
    const under = (d) => !!d.hostId && d.hostId !== d.id && here.has(d.hostId);
    const kids = new Map();
    list.forEach((d) => { if (under(d)) { if (!kids.has(d.hostId)) kids.set(d.hostId, []); kids.get(d.hostId).push(d); } });
    if (!kids.size) return list;
    const out = [];
    const seen = new Set();
    const walk = (d, depth) => {
        if (seen.has(d)) return;
        seen.add(d);
        out.push(depth ? Object.assign({}, d, { guest: depth }) : d);
        (kids.get(d.id) || []).forEach((k) => walk(k, depth + 1));
    };
    list.forEach((d) => { if (!under(d)) walk(d, 0); });
    list.forEach((d) => walk(d, 0));   // a loop nothing outside reaches (never after repairHosts)
    return out;
}

function devicesSection(devices, groups) {
    // Gateway, DNS, Model / firmware: the schema rows that carry a report column.
    const cols = reportColumns();
    const empty = '<span class="muted">—</span>';
    const known = new Set((groups || []).map((g) => g.id));
    const grouped = known.size > 0 && devices.some((d) => d.groupId && known.has(d.groupId));
    const deviceRows = (d) => {
        const extra = [
            d.ports ? `${escapeHtml(t('Ports'))}: ${d.ports.used}/${d.ports.total}` : '',
            d.nat ? escapeHtml(t('NAT')) : '',
            d.allowedPorts ? `${escapeHtml(t('Allowed'))}: ${escapeHtml(d.allowedPorts)}` : ''
        ].filter(Boolean).join(' · ');
        // The Asset group (js/assets.js): the tag, serial and place under the
        // name, and a status other than in service, which a reader of the
        // register has to see.
        const where = grouped && d.groupId ? d.rackSpan : (d.place !== undefined ? d.place : d.location);
        const asset = [d.assetTag ? `${t('Asset tag')} ${d.assetTag}` : '', d.serial ? `${t('Serial number')} ${d.serial}` : '', where]
            .filter(Boolean).join(' · ');
        const status = d.status && d.status !== 'active' ? ` <span class="muted">(${escapeHtml(statusName(d.status))})</span>` : '';
        // A guest, under its host: stepped in, and saying what it runs on.
        const runs = d.hostId ? `<br><span class="muted">${escapeHtml(t('Runs on {host}', { host: d.host }))}</span>` : '';
        const guestCls = d.guest ? ` guest" style="--guest:${Math.min(d.guest, HOST_DEPTH_MAX)}` : '';
        const ifaces = d.interfaces.length ? d.interfaces : [null];
        return ifaces.map((iface, i) => {
            const first = i === 0;
            const own = iface
                ? `<td>${ifaceNameCell(iface)}</td>
            <td class="mono">${escapeHtml(iface.ip) || empty}</td>
            <td class="mono">${iface.mac ? `${escapeHtml(iface.mac)}${iface.vendor ? ` <span class="muted">· ${escapeHtml(iface.vendor)}</span>` : ''}` : empty}</td>`
                : `<td colspan="3"><span class="muted">${escapeHtml(t('none recorded'))}</span></td>`;
            if (!first) return `<tr class="cont"><td></td><td></td>${own}${cols.map(() => '<td></td>').join('')}</tr>`;
            return `<tr class="dev${guestCls}">
            <td>${d.guest ? '<span class="muted">↳ </span>' : ''}<b>${escapeHtml(d.name)}</b>${status}${runs}${asset ? `<br><span class="muted">${escapeHtml(asset)}</span>` : ''}${d.notes ? `<br><span class="muted">${escapeHtml(d.notes)}</span>` : ''}</td>
            <td>${escapeHtml(t(d.typeName))}${extra ? `<br><span class="muted">${extra}</span>` : ''}</td>
            ${own}
            ${cols.map((f) => `<td${f.report.mono ? ' class="mono"' : ''}>${escapeHtml(d[f.report.key]) || empty}</td>`).join('\n            ')}
        </tr>`;
        }).join('');
    };
    const width = 5 + cols.length;
    const heading = (title, note) => `<tr class="grp"><td colspan="${width}"><b>${escapeHtml(title)}</b>${note ? ` <span class="muted">· ${escapeHtml(note)}</span>` : ''}</td></tr>`;
    let rows;
    if (!grouped) rows = hostOrdered(devices).map(deviceRows).join('');
    else {
        const by = new Map();
        devices.forEach((d) => { const k = d.groupId && known.has(d.groupId) ? d.groupId : ''; if (!by.has(k)) by.set(k, []); by.get(k).push(d); });
        const count = (n) => t(n === 1 ? '{n} device' : '{n} devices', { n });
        rows = groups.filter((g) => by.has(g.id)).map((g) => heading(g.path, `${g.kindName}${g.uHeight ? ` ${g.uHeight}U` : ''} · ${count(by.get(g.id).length)}`)
            + hostOrdered(by.get(g.id)).map(deviceRows).join('')).join('')
            + (by.has('') ? heading(t('Not in a group'), count(by.get('').length)) + hostOrdered(by.get('')).map(deviceRows).join('') : '');
    }
    return `<table class="inv">
        <thead><tr><th>${t('Device')}</th><th>${t('Type')}</th><th>${t('Interface')}</th><th>${t('Address')}</th><th>${t('MAC')}</th>${cols.map((f) => `<th>${t(f.report.column)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// The Cable column (label, length, colour, via) appears only when some cable
// says something about itself, so a drawing that never used it reports as
// it did before the column existed.
function connectionsSection(connections) {
    if (!connections.length) return `<p class="muted">${escapeHtml(t('No connections recorded.'))}</p>`;
    const withCable = connections.some((c) => c.label || c.length || c.color || c.via);
    const cableCell = (c) => {
        const facts = [c.length, c.color].filter(Boolean).join(' · ');
        return [c.label ? `<b class="mono">${escapeHtml(c.label)}</b>` : '', facts ? `<span class="muted">${escapeHtml(facts)}</span>` : '',
            c.via ? `<span class="mono muted">${escapeHtml(c.via)}</span>` : ''].filter(Boolean).join('<br>');
    };
    const rows = connections.map((c) => `<tr>
        <td><b>${escapeHtml(c.from)}</b></td>
        <td class="mono muted">${escapeHtml(c.fromIface)}</td>
        <td><b>${escapeHtml(c.to)}</b></td>
        <td class="mono muted">${escapeHtml(c.toIface)}</td>
        <td>${escapeHtml(t(c.medium))}</td>${withCable ? `
        <td>${cableCell(c)}</td>` : ''}
    </tr>`).join('');
    return `<table>
        <thead><tr><th>${t('From')}</th><th>${t('Interface')}</th><th>${t('To')}</th><th>${t('Interface')}</th><th>${t('Medium')}</th>${withCable ? `<th>${t('Cable')}</th>` : ''}</tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// A declared network prints its name, VLAN, purpose, gateway, DNS and DHCP
// under its address; one only implied by the addressing says so, since
// nobody has said what it is for.
function subnetsSection(subnets) {
    if (!subnets.length) return `<p class="muted">${escapeHtml(t('No addressing recorded.'))}</p>`;
    const muted = (text) => `<span class="muted">${escapeHtml(text)}</span>`;
    const rows = subnets.map((s) => {
        const about = s.declared
            ? [s.name ? `<b>${escapeHtml(s.name)}</b>` : '', s.vlan ? escapeHtml(`VLAN ${s.vlan}`) : '', s.purpose ? muted(s.purpose) : '']
            : [muted(t('Not declared: implied by the addresses'))];
        const service = [
            s.gateway ? `${escapeHtml(t('Gateway'))} <span class="mono">${escapeHtml(s.gateway)}</span>` : '',
            s.dns ? `${escapeHtml(t('DNS'))} <span class="mono">${escapeHtml(s.dns)}</span>` : '',
            s.dhcp ? escapeHtml(t('DHCP')) : ''
        ].filter(Boolean);
        return `<tr>
        <td><span class="mono"><b>${escapeHtml(s.network)}</b></span>${about.filter(Boolean).map((x) => `<br>${x}`).join('')}</td>
        <td>${escapeHtml(s.kind === 'ipv6' ? 'IPv6' : 'IPv4')} · ${escapeHtml(t(s.isPrivate ? 'Private' : 'Public / routable'))}${service.length ? `<br>${service.join(' · ')}` : ''}</td>
        <td>${s.devices.length}</td>
        <td>${escapeHtml(s.devices.join(', '))}</td>
    </tr>`;
    }).join('');
    return `<table>
        <thead><tr><th>${t('Network')}</th><th>${t('Kind')}</th><th>${t('Devices')}</th><th>${t('Members')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// The estate's table of contents. In-document anchors only — no scheme, no
// host — so the document still passes the "pulls nothing over the network"
// assertion that makes it safe to email.
function siteIndexSection(sites) {
    const rows = sites.map((s) => `<tr>
        <td><a href="#${escapeHtml(s.anchor)}"><b>${escapeHtml(s.name)}</b></a></td>
        ${s.unreadable
            ? `<td>${s.counts.devices}</td><td colspan="3" class="muted">${escapeHtml(t('This network could not be read.'))}</td>`
            : `<td>${s.counts.devices}</td><td>${s.counts.subnets}</td>
               <td>${s.counts.critical ? `<span class="sev bad">${s.counts.critical}</span>` : '<span class="muted">—</span>'}</td>
               <td>${s.counts.advisory ? `<span class="sev warn">${s.counts.advisory}</span>` : '<span class="muted">—</span>'}</td>`}
    </tr>`).join('');
    return `<table class="idx">
        <thead><tr><th>${t('Site')}</th><th>${t('Devices')}</th><th>${t('Subnets')}</th><th>${t('Critical')}</th><th>${t('Advisory')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// Addressing across the estate. A network in more than one building is tinted
// and counted, and the paragraph underneath says what that does and does not
// mean — because the document is not in a position to know.
function estateSubnetsSection(rows) {
    if (!rows.length) return `<p class="muted">${escapeHtml(t('No addressing recorded.'))}</p>`;
    const body = rows.map((r) => `<tr${r.sites.length > 1 ? ' class="multi"' : ''}>
        <td class="mono"><b>${escapeHtml(r.network)}</b></td>
        <td>${escapeHtml(r.kind === 'ipv6' ? 'IPv6' : 'IPv4')} · ${escapeHtml(t(r.isPrivate ? 'Private' : 'Public / routable'))}</td>
        <td>${r.sites.length}</td>
        <td>${r.devices}</td>
        <td>${r.sites.map((x) => `<b>${escapeHtml(x.site)}</b> <span class="muted">${escapeHtml(x.devices.slice(0, 8).join(', '))}${x.devices.length > 8 ? ` ${t('+{n} more', { n: x.devices.length - 8 })}` : ''}</span>`).join('<br>')}</td>
    </tr>`).join('');
    const shared = rows.filter((r) => r.sites.length > 1).length;
    return `<table>
        <thead><tr><th>${t('Network')}</th><th>${t('Kind')}</th><th>${t('Sites')}</th><th>${t('Devices')}</th><th>${t('Used in')}</th></tr></thead>
        <tbody>${body}</tbody></table>
        ${shared ? `<p class="muted">${escapeHtml(t('A highlighted network is documented in more than one site. Whether that is a conflict depends on whether those sites are routed together, which this survey does not record — it is stated here as a fact, not as a finding.'))}</p>` : ''}`;
}

// The estate graph, drawn as inline SVG because a report must pull nothing over
// the network and therefore cannot use a layout library. The Sites table below
// restates every edge in words: the picture is never the only place a link is
// stated, which is what makes this safe for a text-only reader or a printer
// that drops images.
function estateGraphSvg(graph) {
    if (!graph.edges.length) return '';
    const BOX_W = 150, BOX_H = 34, GAP_X = 22, GAP_Y = 56;
    // Width follows the widest rank rather than a constant: a fixed 720 clipped
    // every box past the fifth in a row straight off the viewBox, and an
    // omitted site in an estate report is worse than an ugly one. The SVG
    // scales to the page, so a wide estate simply draws smaller.
    const widest = Math.max(1, ...graph.rows.map((r) => r.length));
    const W = Math.max(720, widest * BOX_W + (widest - 1) * GAP_X + 20);
    const pos = new Map();
    graph.rows.forEach((row, r) => {
        const totalW = row.length * BOX_W + (row.length - 1) * GAP_X;
        row.forEach((n, i) => {
            pos.set(n.id, { x: (W - totalW) / 2 + i * (BOX_W + GAP_X), y: 10 + r * (BOX_H + GAP_Y), name: n.name });
        });
    });
    const H = 20 + graph.rows.length * (BOX_H + GAP_Y);
    const boxes = [...pos.entries()].map(([, p]) => `
        <rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="4" fill="#f8fafc" stroke="#94a3b8"/>
        <text x="${p.x + BOX_W / 2}" y="${p.y + BOX_H / 2 + 4}" text-anchor="middle" font-size="11" fill="#0f172a">${escapeHtml(p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name)}</text>`).join('');
    const lines = graph.edges.filter((e) => e.resolved && pos.has(e.from) && pos.has(e.toId)).map((e) => {
        const a = pos.get(e.from), b = pos.get(e.toId);
        // The referencing site sits BELOW the one it reaches, so the line leaves
        // its top edge and the arrowhead lands on the target's bottom.
        return `<line x1="${a.x + BOX_W / 2}" y1="${a.y}" x2="${b.x + BOX_W / 2}" y2="${b.y + BOX_H}" stroke="#94a3b8" stroke-width="1.4" marker-end="url(#arrow)"/>`;
    }).join('');
    return `<svg class="estate-graph" viewBox="0 0 ${W} ${H}" role="img">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker></defs>
        ${lines}${boxes}
    </svg>`;
}

// Every site reference in the estate, in words. The degradation path for the
// SVG above, and the only place an UNRESOLVED reference appears at all — a
// reference naming a site this binder does not hold is the normal state of a
// diagram someone was sent, so it is reported as a fact and never as a fault.
function siteLinksSection(graph) {
    if (!graph.edges.length) return `<p class="muted">${escapeHtml(t('No site names another site.'))}</p>`;
    const rows = graph.edges.slice().sort((a, b) => a.fromName.localeCompare(b.fromName) || a.toName.localeCompare(b.toName))
        .map((e) => `<tr>
            <td><b>${escapeHtml(e.fromName)}</b></td>
            <td class="muted">${escapeHtml(e.via)}</td>
            <td><b>${escapeHtml(e.toName || '—')}</b>${e.resolved ? '' : ` <span class="muted">${escapeHtml(t('(not in this binder)'))}</span>`}</td>
        </tr>`).join('');
    return `<table>
        <thead><tr><th>${t('Site')}</th><th>${t('Via')}</th><th>${t('Reaches')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// The paragraph that keeps this document honest. A drawing is a model of a
// network, and every finding above is a statement about the model. Saying so in
// the deliverable is not a disclaimer — it is the difference between a survey
// report and a scan someone might mistake it for.
function methodSection(meta) {
    const scope = meta.scope
        ? `<div class="note">${escapeHtml(meta.scope)}</div>`
        : '';
    return `${scope}
        <p>${escapeHtml(t('This report describes the network as documented during the survey. Findings are derived from the recorded topology, addressing and interface configuration — no device was scanned, probed or logged into to produce them, and nothing here was measured against live traffic.'))}</p>
        <p>${escapeHtml(t('A finding therefore means the configuration as recorded would cause the described behaviour. Where the documentation is incomplete, the corresponding check is silent rather than passing.'))}</p>`;
}

const stat = (value, label, cls) => `<div class="stat${cls ? ' ' + cls : ''}"><b>${value}</b><span>${escapeHtml(t(label))}</span></div>`;

// ---- The document shell, and one sheet inside it ----
// Split so the estate report can put N sheets in one document without a second
// copy of any of this. The split is the whole anti-drift argument: there is one
// stylesheet, one findings renderer, one inventory renderer, and a binder sheet
// is the same function call a single-site report makes.
function reportDocument(title, body) {
    return `<!DOCTYPE html>
<html lang="${escapeHtml(document.documentElement.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${reportStyles()}</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">${escapeHtml(t('Print / Save as PDF'))}</button></div>
${body}
</body>
</html>`;
}

// One site's sheet. opts.title/subtitle/anchorId let the estate report label a
// sheet by site and link to it from its index; every default reproduces the
// single-site document exactly, byte for byte.
function reportSheet(model, image, opts = {}) {
    const { meta, counts } = model;

    const metaRows = REPORT_FIELDS
        .filter(({ key, multiline }) => !multiline && meta[key])
        .map(({ key, label }) => `<div><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(meta[key])}</dd></div>`)
        .join('');
    const accepted = model.accepted || [];
    const portMaps = model.portMaps || [];
    // A large site's diagram goes to an appendix (REPORT_DIAGRAM_INLINE_MAX).
    const appendix = !!image && counts.devices > REPORT_DIAGRAM_INLINE_MAX;
    const figure = image ? `<div class="figure">
        <img src="${image.url}" alt="${escapeHtml(t('Network topology diagram'))}">
        <div class="caption">${escapeHtml(meta.site ? `${t('Topology')} — ${meta.site}` : t('Topology'))}</div>
    </div>` : '';

    return `<div class="sheet"${opts.anchorId ? ` id="${escapeHtml(opts.anchorId)}"` : ''}>
    <div class="rule"></div>
    <h1>${escapeHtml(opts.title || t('Network documentation report'))}</h1>
    <p class="sub">${escapeHtml(opts.subtitle !== undefined ? opts.subtitle : (meta.site || t('Site not named')))}</p>
    <dl class="meta">${metaRows}</dl>

    <h2>${escapeHtml(t('Summary'))}</h2>
    <div class="stats">
        ${stat(counts.devices, 'Devices')}
        ${stat(counts.connections, 'Connections')}
        ${stat(counts.subnets, 'Subnets')}
        ${stat(counts.critical, 'Critical', 'crit')}
        ${stat(counts.advisory, 'Advisory', 'adv')}${accepted.length ? `
        ${stat(accepted.length, 'Accepted')}` : ''}
    </div>

    <h2>${escapeHtml(t('Findings'))}</h2>
    ${findingsSection(model.findings, { accepted: accepted.length > 0 })}
${accepted.length ? `
    <h2>${escapeHtml(t('Known / accepted'))}</h2>
    ${acceptedSection(accepted)}
` : ''}
    ${image ? `<h2>${escapeHtml(t('Topology'))}</h2>
    ${appendix ? `<p class="muted">${escapeHtml(t('At {n} devices the diagram needs a page of its own: it is in the appendix at the end.', { n: counts.devices }))}</p>` : figure}` : ''}

    <h2>${escapeHtml(t('Device inventory'))}</h2>
    ${devicesSection(model.devices, model.groups)}
${(model.racks || []).length ? `
    <h2>${escapeHtml(t('Racks'))}</h2>
    ${racksSection(model.racks)}
` : ''}${portMaps.length ? `
    <h2>${escapeHtml(t('Switch ports'))}</h2>
    ${portMapsSection(portMaps)}
` : ''}
    <h2>${escapeHtml(t('Connections'))}</h2>
    ${connectionsSection(model.connections)}

    <h2>${escapeHtml(t('Addressing'))}</h2>
    ${subnetsSection(model.subnets)}

${model.changes ? `
    <h2>${escapeHtml(t(model.changes.kind === 'report' ? 'Changes since the last report' : 'Changes since the last back-up'))}</h2>
    ${changesSection(model.changes)}
` : ''}
    <h2>${escapeHtml(t('Scope and method'))}</h2>
    ${methodSection(meta)}
${appendix ? `
    <div class="appendix">
    <h2>${escapeHtml(t('Appendix: topology diagram'))}</h2>
    ${figure}
    </div>
` : ''}
    <footer>
        <span>${escapeHtml(meta.ref || '')}</span>
        <span>${escapeHtml(t('Generated with Topo · topo.carino.systems'))}</span>
    </footer>
</div>`;
}

// The single-site report: one sheet, one document. Signature unchanged.
function reportHtml(model, image) {
    const title = model.meta.site
        ? `${model.meta.site} — ${t('Network documentation report')}`
        : t('Network documentation report');
    return reportDocument(title, reportSheet(model, image));
}

// The cover: what the whole engagement adds up to, before any one building.
function binderCoverSheet(binder) {
    const { meta, counts } = binder;
    const metaRows = REPORT_FIELDS
        .filter(({ key, multiline }) => !multiline && key !== 'site' && meta[key])
        .map(({ key, label }) => `<div><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(meta[key])}</dd></div>`)
        .join('');
    return `<div class="sheet">
    <div class="rule"></div>
    <h1>${escapeHtml(t('Estate documentation report'))}</h1>
    <p class="sub">${escapeHtml(meta.site || t('Estate not named'))}</p>
    <dl class="meta">${metaRows}</dl>

    <h2>${escapeHtml(t('Summary'))}</h2>
    <div class="stats">
        ${stat(counts.sites, 'Sites')}
        ${stat(counts.devices, 'Devices')}
        ${stat(counts.connections, 'Connections')}
        ${stat(counts.subnets, 'Subnets')}
        ${stat(counts.critical, 'Critical', 'crit')}
        ${stat(counts.advisory, 'Advisory', 'adv')}
    </div>

    <h2>${escapeHtml(t('Sites'))}</h2>
    ${siteIndexSection(binder.sites)}

    <h2>${escapeHtml(t('Findings across the estate'))}</h2>
    ${findingsSection(binder.findings, { site: true })}

    <h2>${escapeHtml(t('Estate addressing'))}</h2>
    ${estateSubnetsSection(binder.subnets)}

    <h2>${escapeHtml(t('Estate topology'))}</h2>
    ${estateGraphSvg(binder.graph)}
    ${siteLinksSection(binder.graph)}

    <h2>${escapeHtml(t('Scope and method'))}</h2>
    ${methodSection(meta)}

    <footer>
        <span>${escapeHtml(meta.ref || '')}</span>
        <span>${escapeHtml(t('Generated with Topo · topo.carino.systems'))}</span>
    </footer>
</div>`;
}

// The cover, then every site as the same sheet a single-site report produces.
// A site's own header rows are printed only where they DIFFER from the cover's,
// so a binder whose sites all name the same client says it once.
function binderHtml(binder, images = {}) {
    const title = binder.meta.site
        ? `${binder.meta.site} — ${t('Estate documentation report')}`
        : t('Estate documentation report');
    const sheets = binder.sites.map((s) => {
        if (!s.model) {
            return `<div class="sheet" id="${escapeHtml(s.anchor)}">
                <div class="rule"></div><h1>${escapeHtml(s.name)}</h1>
                <p class="muted">${escapeHtml(t('This network could not be read.'))}</p></div>`;
        }
        // Built up from blank rather than filtered down from the site's own
        // header: starting from s.meta and deleting the matches leaves every
        // agreeing field still in the object, and reportSheet prints whatever
        // is truthy — so the client's name reappeared on every sheet.
        // normalizeReportMeta is deliberately not used here either; it defaults
        // the date to today, which would then differ from the cover's and print
        // on every sheet for that reason instead.
        const sheetMeta = {};
        REPORT_FIELDS.forEach(({ key }) => { sheetMeta[key] = ''; });
        // The name the DOCUMENT records wins over the library card's label: the
        // single-site report of the same document prints that name, and the two
        // must not contradict each other. The card name is the sheet's heading
        // and its index entry, which is how the reader finds it.
        // Printed only when it says something the heading does not. The card is
        // usually named after the site, and a "Site: Bodega Sur" row under a
        // heading reading "Bodega Sur" is a line the reader has to check to
        // discover it was not worth reading. Where the two DIFFER — saving
        // before filling the header is the ordinary way that happens — the
        // document's own name is the one that prints, because the single-site
        // report of the same document prints it too.
        // rawMeta is the stored header exactly as the document carried it, and
        // a binder or library doc is outside input: a non-string field must
        // cost that field, not throw and abort the whole estate report.
        const str = (v) => (typeof v === 'string' ? v : '');
        const recordedSite = str(s.rawMeta.site).trim();
        sheetMeta.site = recordedSite && recordedSite !== s.name ? recordedSite : '';
        sheetMeta.scope = str(s.rawMeta.scope);   // each building's own scope note always stands
        REPORT_FIELDS.forEach(({ key }) => {
            if (key === 'site' || key === 'scope') return;
            const recorded = str(s.rawMeta[key]).trim();
            if (recorded && recorded !== binder.meta[key]) sheetMeta[key] = recorded;
        });
        const sheetModel = Object.assign({}, s.model, { meta: sheetMeta });
        return reportSheet(sheetModel, images[s.id] || null, { title: s.name, subtitle: '', anchorId: s.anchor });
    }).join('');
    return reportDocument(title, binderCoverSheet(binder) + sheets);
}

// ---- Delivering it ----
// A new tab is the useful default: the report is read and printed far more often
// than it is filed. Popup blockers are common enough that the download has to be
// a real fallback rather than an error message, and both paths hand over the
// same bytes. The object URL outlives the call because revoking it immediately
// leaves the new tab pointed at nothing.
// `kind` names the download ('report', or 'labels' for Print labels in
// js/assets.js, which is delivered the same way).
function deliverReport(html, meta, kind = 'report') {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const name = `${fileSlug(meta.site)}-${kind}-${meta.date || todayISO()}.html`;

    const tab = window.open(url, '_blank');
    // A blob: page inherits this page's CSP, which forbids inline handlers, so
    // the toolbar's onclick is dead in the tab. It stays in the markup for the
    // downloaded file, which has no CSP; the tab is same-origin, so it is wired
    // from here instead.
    if (tab) tab.addEventListener('load', () => {
        const btn = tab.document.querySelector('.toolbar button');
        if (btn) btn.onclick = () => tab.print();
    });
    if (!tab) {
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { url, name, opened: !!tab };
}

// `meta` overrides the stored header for this one report: a read-only document
// cannot keep what was typed into the dialog (commitReportMeta), but the report
// the visitor asked for still carries it.
//
// A kept network's report says what changed since its last back-up or report
// (js/changes.js), and is then its new baseline: the next report says what
// changed since this one. Worked out before the baseline moves, or every
// report would say nothing had changed.
async function generateSiteReport(meta) {
    const model = reportModel();
    if (meta) model.meta = siteReportMeta(meta);
    const keptId = isKept() ? state.libraryId : null;
    const doc = keptId ? serializeDoc() : null;
    if (keptId) model.changes = reportChanges(keptId, doc);
    let image = null;
    try { image = await captureCanvasImage('png'); }
    catch (e) { console.warn('Report: could not rasterise the diagram; continuing without it.', e); }
    const out = deliverReport(reportHtml(model, image), model.meta);
    if (keptId) takeSnapshot(keptId, 'report', doc);
    return out;
}

// Draw a stored document onto the real canvas so it can be rasterised, then put
// the editor back exactly as it was. withDoc() cannot do this: it is a pure
// model swap that never renders, and it deliberately drops annotations — which
// captureCanvasImage measures when it crops. Never calls save(), so the URL
// and the undo timeline are untouched: the user asked for a report, not for
// their canvas to be edited.
async function withDocRendered(doc, fn) {
    const held = {
        nodes: state.nodes, links: state.links, networks: state.networks, groups: state.groups, accepted: state.accepted, annotations: state.annotations, report: state.report,
        camera: { x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom },
        selection: state.selection,   // the whole set: a getter pair would lose a set of several
    };
    borrowCanvas(true);   // save() refuses while the canvas is not the user's document
    try {
        state.selection = new Set();
        loadDocState(doc || {});   // migrates a v1 card, as opening it would
        renderCanvasOnly();
        return await fn();
    } finally {
        state.nodes = held.nodes; state.links = held.links; state.networks = held.networks; state.groups = held.groups; state.accepted = held.accepted;
        state.annotations = held.annotations; state.report = held.report;
        state.camera = held.camera;
        state.selection = held.selection;
        borrowCanvas(false);
        applyCamera(); renderCanvasOnly();
    }
}

// One picture per site, captured in turn. At the export's 4x a twelve-building
// estate is an enormous file for images printed two to a page, so these go in
// at 2x. A site that will not rasterise is skipped rather than failing the
// document — a report with one picture missing beats no report.
async function captureBinderImages(sites, onProgress, capture) {
    const grab = capture || ((doc) => withDocRendered(doc, () => captureCanvasImage('png', 2)));
    const images = {};
    for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        if (onProgress) onProgress(i + 1, sites.length);
        if (!s.model || !s.doc) continue;
        try { const img = await grab(s.doc); if (img) images[s.id] = img; }
        catch (e) { console.warn('Binder report: could not rasterise', s.name, e); }
    }
    return images;
}

async function generateBinderReport(estateMeta, opts = {}) {
    // Sites only: a saved template is a starting point, not a building.
    flushAutosave();
    const entries = libraryNetworks();
    if (!entries.length) { showToast(t('Nothing to report on yet — save a network first.')); return null; }
    const binder = binderModel(entries, estateMeta);
    // binderSiteModels drops the document once it has the model; the image
    // sweep needs it back, and matching by id keeps that lookup honest.
    const byId = new Map(entries.map((e) => [e.id, e.doc]));
    binder.sites.forEach((s) => { s.doc = byId.get(s.id); });
    // Each site's sheet says what changed since that card's baseline, and the
    // estate report is then every card's new one, as a site report is.
    binder.sites.forEach((s) => { if (s.model) s.model.changes = reportChanges(s.id, s.doc); });
    const images = opts.images === false ? {} : await captureBinderImages(binder.sites, opts.onProgress, opts.capture);
    const out = deliverReport(binderHtml(binder, images), { site: binder.meta.site || 'estate', date: binder.meta.date, ref: binder.meta.ref });
    entries.forEach((e) => takeSnapshot(e.id, 'report', e.doc));
    return out;
}

// ---- The dialog ----
// Rendered from REPORT_FIELDS rather than written into index.html, so adding a
// field to the document adds it to the form and nowhere else.
// One dialog, two subjects: the network on screen, or the whole binder. A mode
// rather than a second modal, because the questions are identical — who the
// survey was for — and two dialogs would be two places to keep REPORT_FIELDS
// honest.
let _reportMode = 'site';

function renderReportFields(seed) {
    const host = document.getElementById('reportFields');
    if (!host) return;
    const meta = normalizeReportMeta(seed || state.report);
    host.innerHTML = '';

    REPORT_FIELDS.forEach(({ key, label, placeholder, multiline }) => {
        const wrap = document.createElement('label');
        wrap.className = 'field';
        const cap = document.createElement('span');
        cap.className = 'prop-lbl';
        cap.textContent = t(label);
        const input = document.createElement(multiline ? 'textarea' : 'input');
        if (!multiline) input.type = 'text';
        else input.rows = 3;
        input.id = `report-${key}`;
        input.className = multiline ? 'textarea' : 'input';
        input.placeholder = (key === 'site' && _reportMode === 'site' && keptSiteName()) || t(placeholder) || '';
        input.value = meta[key];
        wrap.append(cap, input);
        host.appendChild(wrap);
    });
}

// Read the form back onto the document. Only called when the report is actually
// generated, so opening the dialog and thinking better of it changes nothing.
function readReportFields() {
    const meta = {};
    REPORT_FIELDS.forEach(({ key }) => {
        const el = document.getElementById(`report-${key}`);
        if (el) meta[key] = el.value.trim();
    });
    return meta;
}

// A read-only document (one from a newer Topo) is never written, so its header
// is read for this report and not stored; the dialog's blurb says so up front,
// rather than save() reverting it with the generic read-only toast.
function commitReportMeta() {
    if (state.readOnly) return normalizeReportMeta(readReportFields());
    state.report = readReportFields();
    save();
    return normalizeReportMeta(state.report);
}

// The wording, the images row and the seed all follow the mode. Called on open
// and again from applyLocale(), because applyStaticI18n() resets the title and
// the blurb to their captured site-report keys — without this a locale switch
// would silently turn a binder dialog into a site-report dialog that still
// generates a binder.
function renderReportDialog() {
    const binder = _reportMode === 'binder';
    const entries = binder ? libraryNetworks() : [];
    const title = document.getElementById('reportDialogTitle');
    const blurb = document.getElementById('reportDialogBlurb');
    const build = document.getElementById('reportBuildBtn');
    const images = document.getElementById('reportImagesRow');
    if (title) title.textContent = binder ? t('Binder report') : t('Site report');
    if (blurb) {
        blurb.textContent = binder
            ? t('Every saved network as one document: the estate totals, the findings across all sites, the addressing they share, then each network in full.')
            : t('The findings, the inventory and the diagram as one printable document. Everything here is optional — it only fills in the header.')
                + (state.readOnly ? ` ${t('This network is read-only, so the header is used for this report and not kept.')}` : '');
    }
    if (build) build.textContent = binder ? `📋 ${t('Open binder report')}` : `📋 ${t('Open report')}`;
    // The report prints every device's notes: a password in one is named
    // here, before the document is handed to anyone (js/assets.js).
    renderSecretLint(document.getElementById('reportLint'), secretHitsFor(binder ? 'binder-report' : 'doc'), binder ? null : closeReportDialog);
    if (images) {
        images.classList.toggle('hidden', !binder);
        // On by default up to eight sites. Past that the sweep is slow and the
        // file is enormous, and the estate cover is the part being read anyway.
        const cb = document.getElementById('reportImages');
        if (cb && binder) cb.checked = entries.length <= 8;
    }
    renderReportFields(binder ? Object.assign({ site: '' }, binderHeaderDefaults(binderSiteModels(entries))) : null);
}

function openReportDialog(mode) {
    const dialog = document.getElementById('reportDialog');
    if (!dialog) return;
    _reportMode = mode === 'binder' ? 'binder' : 'site';
    renderReportDialog();
    dialog.classList.remove('hidden');
    document.getElementById('report-site')?.focus();
}

function openBinderReportDialog() {
    if (!libraryNetworks().length) { showToast(t('Nothing to report on yet — save a network first.')); return; }
    openReportDialog('binder');
}

const reportMode = () => _reportMode;

function closeReportDialog() {
    document.getElementById('reportDialog')?.classList.add('hidden');
}
