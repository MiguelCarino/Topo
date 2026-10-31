// ---- The bulk panel (plan 3.4) ----
// Several devices selected (and nothing else), in the full editor: the rail
// offers to change all of them at once (several cables: see below). Four actions in the panel and a
// fifth on the button under it:
//
//   Set fields  the schema's bulk-editable fields (NODE_FIELDS rows marked
//               `bulk`, js/model.js), so a field added there with `bulk: true`
//               appears here with nothing else to write. A field the devices
//               disagree on says "mixed"; a field left blank, or as it was, is
//               not touched; Clear empties it on all of them (a gateway or DNS
//               override cleared is inherited from the network again).
//   Rename      one control for both ways of renaming: a pattern (CAM-{n:02},
//               counted in the order chosen: by name, by switch port or by
//               position on the map), or, with Find filled, find and replace
//               inside each name, the pattern being the replacement.
//   Move        to a declared network (R7): each device's address there is the
//               next free one, and its gateway and DNS then come from the
//               network by inheritance; nothing is copied onto the hosts.
//   Group       move them into a group (js/groups.js), or out of every one:
//               where they sit, not their addressing. A device moved
//               anywhere but a rack leaves its units there behind, as the
//               device editor's picker has it (rackKeysLost, js/model.js).
//               A VM on a host is left where it is: it goes where its host
//               goes (js/model.js "Hosts"), and a host moved takes its VMs.
//   Host        put the VMs and containers of the set on one device, or on
//               none (js/model.js "Hosts"): what each runs on, so where it
//               is. A device of the set that is not virtual, or a host it
//               may not run on (a VM on a VM), is refused on its row.
//   Wi-Fi       the SSID and the band of every device in the set that is on
//               Wi-Fi (Review-Packs/Topo-wifi.md, "Set Wi-Fi"): what its
//               association says (link.wifi), or Auto, which takes it back
//               to what Topo works out (js/model.js "Wi-Fi"). Offered only
//               while the set holds a device on Wi-Fi; a device that is not
//               is left as it is, and a band its two ends do not share is
//               refused on its row.
//   Re-cable    onto another switch or access point (phase 3): each device's
//               patch cable moves to the next free port there, from a port
//               given or the first, counted in the order chosen (by switch
//               port by default, so a run of desks keeps its order). Only the
//               switch end moves: the cable keeps its id, its medium, its
//               label, length and colour, and the device keeps its own port
//               and its address (Move is what changes addresses; a device
//               re-cabled into another subnet's switch says so in the
//               findings delta, as a cable subnet mismatch).
//   Delete      the existing Delete Selected button, which for such a set
//               shows the same preview first. The Delete key still deletes at
//               once: it is one undo step, and a key is not a place to ask.
//
// Several cables selected (and nothing else) get Set fields only, from
// LINK_FIELDS' bulk rows (today: Medium). Rename and Move are about devices,
// and a cable's Delete never asked before, so it still does not.
//
// Every action is planned first, purely (bulkPlanSet / bulkPlanRename /
// bulkPlanMove / bulkPlanRecable / bulkPlanDelete: no DOM, nothing written), and shown in a
// preview: what changes on which device, what stays, what is refused, and
// the findings delta, which is the pure findings engine (diagnoseDoc,
// js/diagnostics.js) run on a scratch copy with the same writes applied. That
// is what "conflicts" in the plan's draft turned into: "+2 IP conflicts,
// −24 gateway findings", from the same checks the panel and the report use.
// Apply re-plans from the same request (nothing can change under a modal, but
// a stale plan must never be what is written) and writes it as one batch():
// one undo step, one save, one redraw.
//
// The full editor's, like the table: technical vocabulary (Gateway, DNS,
// Model / firmware, IP / CIDR, NAT…) stays English, as the comment in
// applyProfile (js/app.js) explains; plain words and sentences are translated
// (MESSAGES, js/i18n.js). A reduced view never shows it (data-adv).
//
// What the user has typed into the panel is a draft held here, so adding one
// more device to the set (a shift-click) keeps it. It is dropped when the set
// ends (select() of one thing or nothing calls resetBulkDraft) and after an
// Apply, so the fields then show what the devices now hold.
//
// Load order: ... networks -> table -> query -> bulk -> app

const _bulk = {
    tab: 'set',
    kind: null,       // 'node' or 'link': the kind of set the draft was typed for
    draft: null,      // see bulkDraft()
    req: null         // the request the open preview was made from
};
const bulkEl = (id) => document.getElementById(id);
const bulkDraft = () => _bulk.draft || (_bulk.draft = {
    set: {},              // field key -> the text typed (only fields touched)
    unit: {},             // a length field's key -> the unit picked for it (CABLE_UNITS)
    clear: new Set(),     // fields to empty on every device
    rename: { find: '', pattern: '', order: 'name', start: '1' },
    move: { net: '' },
    recable: { target: '', from: '', order: 'port' },
    group: { target: '' },      // a group id, BULK_NO_GROUP for out of every one, '' for not picked
    host: { target: '' },       // a device id, BULK_NO_HOST for on none, '' for not picked
    wifi: { ssid: '', band: '' } // an SSID id or a band, BULK_WIFI_AUTO for automatic, '' for as it is
});
// Out of every group: a value no group id can be (ids are minted as g_…).
const BULK_NO_GROUP = '-';
// On no host: likewise no device id (ids are minted as n_…, s_…).
const BULK_NO_HOST = '-';
// Back to automatic: no SSID id (minted as wf_…) and no band.
const BULK_WIFI_AUTO = '-';
function resetBulkDraft() { _bulk.draft = null; }

// The panel applies to a set of two or more devices and no cables, or two or
// more cables and no devices, in the full editor: 'node', 'link' or null. A
// mixed set keeps what it had: counts, Delete, "Select only…".
function bulkKind() {
    if (isReduced()) return null;
    const nodes = selectedOf('node').length, links = selectedOf('link').length;
    if (nodes > 1 && !links) return 'node';
    if (links > 1 && !nodes) return 'link';
    return null;
}
const bulkApplies = () => !!bulkKind();
const bulkSet = (ids = selectedOf('node')) => ids.map((id) => getNode(id)).filter(Boolean);
const bulkLinks = (ids = selectedOf('link')) => ids.map((id) => getLink(id)).filter(Boolean);
// A cable by its two ends, as the table's Cables tab names it.
function bulkLinkName(link) {
    const end = (id) => { const n = getNode(id); return n ? (n.name || n.id) : id; };
    return `${end(link.source)} ↔ ${end(link.target)}`;
}

// ---- The fields ----
// The editor each bulk field gets, where plain text is not it. `can` says
// which devices a field means anything on: only a routing device does NAT,
// as the sidebar and the table already say.
const BULK_FIELD_OPTS = {
    type: { editor: 'type', plain: true },
    nat: { editor: 'bool', can: (node) => isRoutingDevice(node.type) },
    // Kept as typed, like the table's Notes cell; only blank space is nothing.
    notes: { plain: true, keepSpace: true },
    // The Asset group (js/assets.js): plain words, so translated. A status is
    // a pick of three, and has no Clear: unset and active read the same.
    location: { plain: true },
    status: { editor: 'status', plain: true, get: (node) => node.status || '' },
    // Age and upkeep (js/model.js): a set bought, or serviced, together.
    // Read by the field's fromText, so "03/2019" is set as 2019-03.
    inService: { plain: true, get: (node) => (node.inService == null ? '' : node.inService) },
    serviced: { plain: true, get: (node) => (node.serviced == null ? '' : node.serviced) },
    serviceEvery: { plain: true, get: (node) => (node.serviceEvery == null ? '' : node.serviceEvery) },
    lifeYears: { plain: true, get: (node) => (node.lifeYears == null ? '' : node.lifeYears) }
};
// A cable's medium is a pick of the five the canvas draws. It is compared as
// drawn (effectiveMedium), as the table's Medium column does: a cable never
// given one is drawn as UTP, and picking UTP for it is not a change. No Clear:
// "no medium" only means "guess", which the drawing already shows.
const BULK_LINK_FIELD_OPTS = {
    medium: { editor: 'medium', get: (link) => effectiveMedium(link) }
};
// A cable's own facts that a run of cables shares (CABLE_FIELDS' bulk rows:
// length, colour, via; never the label, which names one cable). They live in
// link.cable, so they are read and written through it (cableKey).
// The length is typed as a number beside the pick of its unit (unit: true),
// as in the side panel and the table.
const bulkCableFields = () => CABLE_FIELDS.filter((f) => f.bulk).map((f) => ({
    key: `cable.${f.key}`, cableKey: f.key, field: f, label: f.label, editor: 'text', plain: true, get: (link) => cableOf(link, f.key),
    unit: f.key === 'length'
}));
// The network's own columns (js/model.js "Custom columns"), after Topo's: a
// yes/no column is a Yes/No pick, the rest a text field read by the column's
// kind. Compared and shown as the table shows them (customText), so "1,5" in a
// number column is 1.5 and the same as the 1.5 a device holds already.
const bulkCustomFields = () => (state.columns || []).map((def) => ({
    key: `x:${def.id}`, custom: def, label: def.name, editor: def.kind === 'yesno' ? 'bool' : 'text',
    get: (node) => { const v = customValueOf(node, def.id); return def.kind === 'yesno' ? !!v : customText(def, v); }
}));
function bulkFields(kind = 'node') {
    const [fields, opts] = kind === 'link' ? [LINK_FIELDS, BULK_LINK_FIELD_OPTS] : [NODE_FIELDS, BULK_FIELD_OPTS];
    const rows = fields.filter((f) => f.bulk).map((f) => Object.assign({ key: f.key, field: f, label: f.label, editor: 'text' }, opts[f.key] || {}));
    return kind === 'link' ? rows.concat(bulkCableFields()) : rows.concat(bulkCustomFields());
}
const bulkFieldLabel = (bf) => (bf.plain ? t(bf.label) : bf.label);
const bulkCan = (bf, node) => !bf.can || bf.can(node);
function bulkGet(bf, rec) {
    if (bf.get) return bf.get(rec);
    return bf.editor === 'bool' ? !!rec[bf.key] : (rec[bf.key] == null ? '' : String(rec[bf.key]));
}
// A type by the name the report and the table give it (typeName, js/report.js);
// a medium likewise (MEDIUM_NAMES).
// What the field shows for one value ('' for nothing).
function bulkShow(bf, value) {
    if (bf.editor === 'bool') return value ? t('Yes') : t('No');
    if (bf.editor === 'type') return typeName(value);
    if (bf.editor === 'medium') return MEDIUM_NAMES[value] || String(value || '');
    if (bf.editor === 'status') return statusName(value);
    return value == null ? '' : String(value);
}

// The same, for one device: a blank gateway or DNS override is not nothing,
// it is the network's value, and the preview says so ("10.0.1.1 · from
// Office"), so clearing an override shows what the device will use instead.
function bulkShowOn(bf, node, value) {
    if ((bf.key !== 'gw' && bf.key !== 'dns') || !isBlank(value)) return bulkShow(bf, value);
    const net = inheritingNetwork(node, bf.key === 'gw' ? 'gateway' : 'dns');
    return net ? t('{value} · from {network}', { value: net[bf.key === 'gw' ? 'gateway' : 'dns'].trim(), network: networkLabel(net) }) : '';
}

// The value every device the field applies to agrees on, or `mixed`; null
// when it applies to none of them (NAT on a set with no router: not offered).
function bulkCommon(bf, nodes) {
    const on = nodes.filter((n) => bulkCan(bf, n));
    if (!on.length) return null;
    const seen = new Set(on.map((n) => JSON.stringify(bulkGet(bf, n))));
    return seen.size === 1 ? { value: bulkGet(bf, on[0]) } : { mixed: true };
}

// The text typed, read as a value for the field: { value } or { error }.
function bulkParse(bf, text) {
    if (bf.editor === 'bool') return { value: text === 'true' };
    if (bf.editor === 'type') return paletteDefs.some((p) => p.type === text) ? { value: text } : { error: true };
    if (bf.editor === 'medium') return Object.prototype.hasOwnProperty.call(FLOW_CLASS, text) ? { value: text } : { error: true };
    if (bf.editor === 'status') return asStatus(text) ? { value: asStatus(text) } : { error: true };
    if (bf.custom) { const r = parseCustomValue(bf.custom, text); return r.error ? r : { value: customText(bf.custom, r.value) }; }
    if (bf.field && bf.field.fromText) { const v = bf.field.fromText(text); return v === null ? { error: true } : { value: v }; }
    const v = bf.keepSpace ? String(text) : String(text).trim();
    if (bf.field.validate && !bf.field.validate(v.trim())) return { error: true };
    return { value: v };
}

// ---- Plans (pure) ----
// A plan is { action, rows, counts, ops, errors, notes } and nothing more:
//   rows    one per device and field: { nodeId, name, field, before, after,
//           status, why }. status is 'change', 'same' (it already holds
//           that), 'bad' (refused, with why) or 'skip' (the action does not
//           apply to this device, with why).
//   counts  per DEVICE, not per row: a device with any change is one change.
//   ops     what Apply writes, as data, so the same plan is written on a
//           scratch copy for the findings delta and on the live document:
//           { nodeId, set: { key: value }, drop: [keys], iface: { id, ip } },
//           or for a delete { deleteNodes: [ids] }. A set of cables has
//           linkId in place of nodeId, in its rows and its ops. A re-cable
//           writes { linkId, set: { source|target, sourceIface|targetIface } }
//           for a cable it moves, and { addLink: link } for a device that had
//           none (its own end left for the binder, as a drawn cable's is).
//   errors  messages that stop the whole action (a value no device can take).
//   notes   messages that do not (two devices that would share a name).
const BULK_STATUS_RANK = { bad: 3, change: 2, same: 1, skip: 0 };
function bulkFinish(action, rows, ops, extra = {}) {
    const byNode = new Map();
    rows.forEach((r) => {
        const key = r.nodeId || r.linkId;
        const was = byNode.get(key);
        if (!was || BULK_STATUS_RANK[r.status] > BULK_STATUS_RANK[was]) byNode.set(key, r.status);
    });
    const counts = { change: 0, same: 0, bad: 0, skip: 0 };
    byNode.forEach((s) => { counts[s]++; });
    return Object.assign({ action, rows, ops, counts, errors: [], notes: [] }, extra);
}

// edits: { key: { text } | { clear: true } }, as read from the panel. kind
// 'link' plans the same for a set of cables (ids are cable ids).
function bulkPlanSet(ids, edits, kind = 'node') {
    const rows = [], ops = [], errors = [];
    const wanted = [];
    bulkFields(kind).forEach((bf) => {
        const e = edits && edits[bf.key];
        if (!e) return;
        if (e.clear) {
            if (bf.editor !== 'text') return;   // a type or a yes/no has no "nothing"
            wanted.push({ bf, value: '' });
            return;
        }
        const res = bulkParse(bf, e.text);
        if (res.error) errors.push(t('{value} is not a valid {field}.', { value: String(e.text).trim() || '—', field: bulkFieldLabel(bf) }));
        else wanted.push({ bf, value: res.value });
    });
    if (kind === 'link') {
        if (!errors.length) bulkPlanSetLinks(bulkLinks(ids), wanted, rows, ops);
        return bulkFinish('set', rows, ops, { errors, kind });
    }
    const nodes = bulkSet(ids);
    if (!errors.length) {
        nodes.forEach((node) => {
            const op = { nodeId: node.id, set: {}, drop: [] };
            wanted.forEach(({ bf, value }) => {
                const row = { nodeId: node.id, name: node.name, field: bulkFieldLabel(bf), before: bulkShowOn(bf, node, bulkGet(bf, node)), after: bulkShowOn(bf, node, value) };
                if (!bulkCan(bf, node)) rows.push(Object.assign(row, { status: 'skip', after: '', why: t('Only a routing device does NAT.') }));
                else if (bulkGet(bf, node) === value) rows.push(Object.assign(row, { status: 'same' }));
                else {
                    rows.push(Object.assign(row, { status: 'change' }));
                    op.set[bf.key] = value;
                    // Only a cloud stands for another site: what stops being
                    // one stops pointing at one (the schema's siteRef reader
                    // would drop it on the next load; this drops it now).
                    if (bf.key === 'type' && value !== 'cloud' && node.siteRef) op.drop.push('siteRef');
                }
            });
            if (Object.keys(op.set).length) ops.push(op);
        });
    }
    return bulkFinish('set', rows, ops, { errors, kind: 'node' });
}
// The cables' half: every field applies to every cable, so nothing is skipped.
function bulkPlanSetLinks(links, wanted, rows, ops) {
    links.forEach((link) => {
        const op = { linkId: link.id, set: {} };
        wanted.forEach(({ bf, value }) => {
            const now = bulkGet(bf, link);
            const row = { linkId: link.id, name: bulkLinkName(link), field: bulkFieldLabel(bf), before: bulkShow(bf, now), after: bulkShow(bf, value) };
            if (now === value) rows.push(Object.assign(row, { status: 'same' }));
            else {
                rows.push(Object.assign(row, { status: 'change' }));
                // link.cable is one value: this fact laid over the others.
                if (bf.cableKey) op.set.cable = readCable(Object.assign({}, link.cable || {}, op.set.cable || {}, { [bf.cableKey]: value })) || null;
                else op.set[bf.key] = value;
            }
        });
        if (Object.keys(op.set).length) ops.push(op);
    });
}

// ---- Rename ----
const naturalCompare = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
// Where a device is patched: the switch (or AP) its first cable onto a
// faceplate lands on, and the port number there. Devices on no port sort
// after every patched one, by name.
function patchPoint(node) {
    let best = null;
    linksAtNode(node.id).forEach((l) => {
        const peerId = l.source === node.id ? l.target : l.source;
        const peer = getNode(peerId);
        if (!hasPortGrid(peer)) return;
        const m = /^p(\d+)$/.exec(ifaceIdOn(l, peerId) || '');
        const at = { peer: peer.name || peer.id, port: m ? Number(m[1]) : Infinity };
        if (!best || naturalCompare(at.peer, best.peer) < 0 || (at.peer === best.peer && at.port < best.port)) best = at;
    });
    return best;
}
// Rows of the map, top to bottom, then left to right. Half a node's height
// apart counts as one row, so a line of devices dragged by hand, a few pixels
// out of true, still reads left to right.
const ROW_BAND = 60;
const BULK_ORDERS = {
    name: (a, b) => naturalCompare(a.name, b.name),
    port: (a, b) => {
        const pa = patchPoint(a), pb = patchPoint(b);
        if (pa && pb) return naturalCompare(pa.peer, pb.peer) || (pa.port - pb.port) || naturalCompare(a.name, b.name);
        if (pa || pb) return pa ? -1 : 1;
        return naturalCompare(a.name, b.name);
    },
    position: (a, b) => (Math.round(a.y / ROW_BAND) - Math.round(b.y / ROW_BAND)) || (a.x - b.x) || naturalCompare(a.name, b.name)
};
function bulkOrder(nodes, order) { return nodes.slice().sort(BULK_ORDERS[order] || BULK_ORDERS.name); }

// {n} is the count, {n:02} the count padded with zeros to two digits (any
// width up to 9; {n:2} means the same, since nobody pads a name with
// spaces), {name} the device's current name.
const PATTERN_RE = /\{(n(?::0?(\d))?|name)\}/g;
function expandPattern(pattern, n, name) {
    return String(pattern).replace(PATTERN_RE, (all, tok, width) => {
        if (tok === 'name') return name;
        return width ? String(n).padStart(Number(width), '0') : String(n);
    });
}
const usesCount = (pattern) => /\{n(:0?\d)?\}/.test(String(pattern));
// Every occurrence of `find`, whatever its case, as typed (no patterns in it).
function replaceAnyCase(text, find, by) {
    const low = text.toLowerCase(), f = find.toLowerCase();
    let out = '', from = 0, at;
    while ((at = low.indexOf(f, from)) !== -1) { out += text.slice(from, at) + by; from = at + f.length; }
    return out + text.slice(from);
}

// req: { find, pattern, order, start }
function bulkPlanRename(ids, req) {
    const nodes = bulkSet(ids);
    const find = String(req.find || '');
    const pattern = String(req.pattern || '');
    const start = Number.isInteger(Number(req.start)) && String(req.start).trim() !== '' ? Number(req.start) : 1;
    const rows = [], ops = [];
    let n = start;
    bulkOrder(nodes, req.order).forEach((node) => {
        const name = node.name || '';
        const row = { nodeId: node.id, name, field: t('Name'), before: name };
        if (find && !name.toLowerCase().includes(find.toLowerCase())) { rows.push(Object.assign(row, { status: 'same', after: name, why: t('The name does not contain {text}.', { text: find }) })); return; }
        const by = expandPattern(pattern, n, name);
        n++;
        const next = (find ? replaceAnyCase(name, find, by) : by).trim();
        if (!next) { rows.push(Object.assign(row, { status: 'bad', after: '', why: t('A device needs a name.') })); return; }
        if (next === name) { rows.push(Object.assign(row, { status: 'same', after: next })); return; }
        rows.push(Object.assign(row, { status: 'change', after: next }));
        ops.push({ nodeId: node.id, set: { name: next } });
    });
    // Two devices called the same are allowed (it is a drawing), but a rename
    // that makes them is worth saying before it is applied.
    const finalName = new Map(state.nodes.map((nd) => [nd.id, nd.name]));
    ops.forEach((op) => finalName.set(op.nodeId, op.set.name));
    const tally = new Map();
    finalName.forEach((nm) => { const k = String(nm || '').trim().toLowerCase(); tally.set(k, (tally.get(k) || 0) + 1); });
    const twice = ops.filter((op) => tally.get(op.set.name.trim().toLowerCase()) > 1).length;
    const notes = [];
    if (twice) notes.push(t('Devices that would share a name with another: {n}', { n: twice }));
    if (!find && ops.length > 1 && !usesCount(pattern) && !/\{name\}/.test(pattern)) notes.push(t('Without {n} in the pattern, every device gets the same name.'));
    return bulkFinish('rename', rows, ops, { notes });
}

// ---- Move to a network ----
// The interface that gets the new address: the first one holding an address
// of the network's family, else the first one with none, a wired one before a
// radio (a laptop's eth0 before its wlan0; a phone with only wlan0 takes it).
// A bond's members carry no address of their own (the bond does), so they
// are passed over.
//
// A switch or an access point with no address is a layer-2 device, and is
// left so: giving one an address makes it a hop. On an AP that was its radio,
// and the findings engine duly reported every wireless client cut off from
// its gateway. Its management address, when it has one, moves like any host's.
function moveIface(node, kind) {
    const list = node.interfaces || [];
    const members = new Set();
    list.forEach((i) => { if (i.bond) (i.bond.members || []).forEach((id) => members.add(id)); });
    const usable = list.filter((i) => !members.has(i.id));
    const holding = usable.find((i) => { const p = parseValidCIDR(i.ip); return p && p.kind === kind; });
    if (holding || hasPortGrid(node)) return holding || null;
    const blank = usable.filter((i) => isBlank(i.ip));
    return blank.find((i) => !ifaceIsWireless(i)) || blank[0] || null;
}

function bulkPlanMove(ids, netId) {
    const net = networkById(netId);
    const p = net && parseValidCIDR(net.cidr);
    if (!p) return bulkFinish('move', [], [], { errors: [t('Pick a subnet to move them to.')] });
    const nodes = bulkOrder(bulkSet(ids), 'name');
    const rows = [], ops = [];
    // The free addresses, handed out in name order. Taken is everything on the
    // map plus the network's own gateway and resolvers (takenAddresses), and
    // grows as this plan hands addresses out.
    const taken = takenAddresses(net);
    const { first, last } = usableRange(p);
    let cursor = first, tries = 0;
    const nextFree = () => {
        for (; cursor <= last && tries < 65536; cursor++, tries++) {
            const ip = bigToIp(cursor, p.kind).toString();
            if (!taken.has(ip)) { taken.add(ip); cursor++; return ip; }
        }
        return null;
    };
    const label = networkLabel(net);
    const ipField = 'IP / CIDR';
    nodes.forEach((node) => {
        const base = { nodeId: node.id, name: node.name, field: ipField };
        const addrs = (node.interfaces || []).map((i) => i.ip).filter((ip) => parseValidCIDR(ip));
        // A router's addresses are its routing: moving one of them is a change
        // to the network's design, made on the router itself. A cloud stands
        // for the outside and has no address on this site's networks.
        if (isRoutingDevice(node.type)) { rows.push(Object.assign(base, { status: 'skip', before: addrs.join(', '), after: '', why: t('A router or firewall keeps its addresses: change them on the device.') })); return; }
        const here = getValidIps(node).find((x) => networkOfIp(x.ip) === net);
        if (here) { rows.push(Object.assign(base, { status: 'same', before: `${here.ip.toString()}/${here.prefix}`, after: `${here.ip.toString()}/${here.prefix}`, why: t('Already on {network}.', { network: label }) })); return; }
        const iface = moveIface(node, p.kind);
        if (!iface) {
            const why = hasPortGrid(node) ? t('A switch or access point with no address of its own stays without one.') : t('No interface to give an address to.');
            rows.push(Object.assign(base, { status: 'skip', before: addrs.join(', '), after: '', why }));
            return;
        }
        const ip = nextFree();
        if (!ip) { rows.push(Object.assign(base, { status: 'bad', before: iface.ip || '', after: '', why: t('No free address left in {network}.', { network: label }) })); return; }
        const cidr = `${ip}/${p.prefix}`;
        rows.push(Object.assign(base, { status: 'change', before: iface.ip || '', after: cidr }));
        const op = { nodeId: node.id, set: {}, iface: { id: iface.id, ip: cidr } };
        // The device's own gateway is an override; one outside the new network
        // cannot be its gateway there, so it goes and the network's applies.
        // Its own DNS goes when the new network names resolvers: they are what
        // a host there is handed. A DNS server it chose that the network does
        // not replace is left alone.
        const gw = parseIpText(node.gw);
        if (!isBlank(node.gw) && !(gw && networkOfIp(gw, [net]))) {
            op.set.gw = '';
            rows.push({ nodeId: node.id, name: node.name, field: 'Gateway', status: 'change', before: node.gw.trim(),
                after: isBlank(net.gateway) ? '' : t('{value} · from {network}', { value: net.gateway.trim(), network: label }) });
        }
        if (!isBlank(node.dns) && !isBlank(net.dns)) {
            op.set.dns = '';
            rows.push({ nodeId: node.id, name: node.name, field: 'DNS', status: 'change', before: node.dns.trim(),
                after: t('{value} · from {network}', { value: net.dns.trim(), network: label }) });
        }
        ops.push(op);
    });
    return bulkFinish('move', rows, ops, { network: net });
}

// ---- Re-cable onto another switch ----
// A device's patch cable: a cable whose other end is a numbered port of a
// switch or an access point. A switch in the set is moved by its own uplink,
// when it has one cable onto another switch's port and no more.
//
// A host on no switch port but with exactly one cable of its own (a PC
// plugged straight into the router, a camera into its recorder) has that one:
// moving it onto a switch is what re-cabling it means. A Wi-Fi association,
// a tunnel and a VM's bridge to its host are not cables (isExclusiveLink), so
// a wireless client or a VM is left as it is; so is a router or a switch with
// no faceplate cable, whose one cable is its uplink to somewhere else.
// -> { links, by: 'port' | 'cable' }
function patchCables(node) {
    const at = linksAtNode(node.id).filter((l) => (l.source === node.id ? l.target : l.source) !== node.id);
    const onPorts = at.filter((l) => {
        const peerId = l.source === node.id ? l.target : l.source;
        return hasPortGrid(getNode(peerId)) && /^p\d+$/.test(ifaceIdOn(l, peerId) || '');
    });
    if (onPorts.length || isRoutingDevice(node.type) || hasPortGrid(node)) return { links: onPorts, by: 'port' };
    return { links: at.filter((l) => isExclusiveLink(l) && l.attachment !== 'passthrough'), by: 'cable' };
}
const switchPort = (sw, portId) => `${sw.name || sw.id} · ${ifaceLabel(sw, portId)}`;

// req: { target, from, order }
function bulkPlanRecable(ids, req) {
    const target = getNode(req.target);
    if (!target || !hasPortGrid(target)) return bulkFinish('recable', [], [], { errors: [t('Pick a switch to move them to.')] });
    const label = target.name || target.id;
    const explicit = hasExplicitPortCount(target);
    const total = portCountOf(target);
    // From the port given (as the box names it, or its number), else port 1.
    let cursor = 1;
    const from = String(req.from || '').trim();
    if (from) {
        const id = portIdByText(target, from);
        if (!id || (explicit && Number(id.slice(1)) > total)) {
            return bulkFinish('recable', [], [], { errors: [t('{name} has no port {port}.', { name: label, port: from })], target });
        }
        cursor = Number(id.slice(1));
    }
    // The free ports, handed out in order. A switch nobody has given a size
    // grows as it is plugged into (DEFAULT_PORT_COUNT, js/model.js); one with
    // a faceplate does not, and past its last port nothing is free.
    const nextPort = () => {
        for (; cursor <= 9999; cursor++) {
            if (explicit && cursor > total) return null;
            const id = `p${cursor}`;
            if (ifaceIsOccupied(target.id, id) || isBond(explicitIface(target, id))) continue;
            cursor++;
            return id;
        }
        return null;
    };
    const rows = [], ops = [];
    // The cables already moved by a device earlier in the set. Two devices of
    // the set joined only to each other (two PCs on one cable, a camera and
    // its recorder, a switch and its uplink switch) share one cable: the
    // first moves it, from the other's end onto the target; planned again
    // for the second, it would come back from the target onto the target, a
    // cable from the switch to itself and neither device cabled. The second
    // is planned without it: with nothing else, it gets a cable of its own.
    const claimed = new Set();   // link ids
    bulkOrder(bulkSet(ids), req.order || 'port').forEach((node) => {
        const base = { nodeId: node.id, name: node.name, field: t('Switch port') };
        if (node.id === target.id) { rows.push(Object.assign(base, { status: 'skip', before: '', after: '', why: t('This is the switch they are moving to.') })); return; }
        const found = patchCables(node);
        const by = found.by;
        const patch = found.links.filter((l) => !claimed.has(l.id));
        const took = found.links.find((l) => claimed.has(l.id));
        const peerOf = (l) => (l.source === node.id ? l.target : l.source);
        const here = patch.find((l) => peerOf(l) === target.id);
        if (here) {
            const at = switchPort(target, ifaceIdOn(here, target.id));
            rows.push(Object.assign(base, { status: 'same', before: at, after: at, why: t('Already on {switch}.', { switch: label }) }));
            return;
        }
        if (patch.length > 1) {
            const why = by === 'port' ? t('Cabled to more than one switch: re-cable it by hand.') : t('More than one cable: re-cable it by hand.');
            rows.push(Object.assign(base, { status: 'skip', before: '', after: '', why }));
            return;
        }
        if (!patch.length && linksAtNode(node.id).some((l) => !claimed.has(l.id))) { rows.push(Object.assign(base, { status: 'skip', before: '', after: '', why: t('Not on a switch port: re-cable it by hand.') })); return; }
        const link = patch[0];
        const peer = link ? getNode(peerOf(link)) : null;
        // (One whose cable went with another device of the set says where it
        // was plugged in until now.)
        const was = took ? getNode(peerOf(took)) : null;
        const before = link ? switchPort(peer, ifaceIdOn(link, peer.id)) : (was ? switchPort(was, ifaceIdOn(took, was.id)) : t('No cable'));
        const port = nextPort();
        if (!port) { rows.push(Object.assign(base, { status: 'bad', before, after: '', why: t('No free port left on {switch}.', { switch: label }) })); return; }
        rows.push(Object.assign(base, { status: 'change', before, after: switchPort(target, port) }));
        if (link) {
            claimed.add(link.id);
            ops.push({ linkId: link.id, set: { [link.source === peer.id ? 'source' : 'target']: target.id, [ifaceKeyFor(link, peer.id)]: port } });
        } else {
            const bridged = isVirtualType(target.type) || isVirtualType(node.type);
            ops.push({ addLink: { id: nextId('l'), source: target.id, target: node.id, attachment: bridged ? 'bridged' : null, sourceIface: port, targetIface: null } });
        }
    });
    return bulkFinish('recable', rows, ops, { target });
}

// ---- Move to group ----
// Each device into the group picked (or out of every one), in name order.
// One already there is unchanged. Out of a rack into anything else, its
// units, height and face go with it (rackKeysLost): a U position in a room is
// a position nobody can find. Into a rack, a device that was in none is in it
// but not yet placed, which the preview says once.
function bulkPlanGroup(ids, target) {
    const none = target === BULK_NO_GROUP;
    const g = none ? null : groupById(target);
    if (!none && !g) return bulkFinish('group', [], [], { errors: [t('Pick a group to move them to.')] });
    const field = t('Group');
    const where = (node) => nodePlaceText(node) || '—';
    const rows = [], ops = [];
    let unplaced = 0, carried = 0;
    bulkOrder(bulkSet(ids), 'name').forEach((node) => {
        const before = groupOfNode(node) ? where(node) : '—';
        const base = { nodeId: node.id, name: node.name, field, before };
        // Where a VM on a host is, is the host's to say (repairHosts).
        const host = hostOf(node);
        if (host) {
            rows.push(Object.assign(base, { status: 'skip', after: before, why: t('It runs on {host} and goes where {host} goes.', { host: host.name || host.id }) }));
            return;
        }
        if ((node.group && groupById(node.group) ? node.group : null) === (g ? g.id : null)) {
            rows.push(Object.assign(base, { status: 'same', after: before, why: g ? t('Already in {group}.', { group: groupLabel(g) }) : '' }));
            return;
        }
        const op = { nodeId: node.id, set: {}, drop: rackKeysLost(node, g) };
        if (g) op.set.group = g.id; else op.drop.push('group');
        if (isRackGroup(g) && !Number.isInteger(node.rackU) && !isVirtualType(node.type)) unplaced++;
        carried += bulkGuestsDeep(node).length;
        rows.push(Object.assign(base, { status: 'change', after: g ? groupPath(g) : '—' }));
        ops.push(op);
    });
    const notes = [];
    if (carried) notes.push(t(carried === 1 ? 'One VM or container runs on them and goes with them.' : '{n} VMs and containers run on them and go with them.', { n: carried }));
    if (unplaced) notes.push(t(unplaced === 1 ? 'One of them goes in without a unit: set it in its Asset section.' : '{n} of them go in without a unit: set each one in its Asset section.', { n: unplaced }));
    const lost = ops.filter((op) => op.drop.some((k) => k !== 'group')).length;
    if (lost) notes.push(t(lost === 1 ? 'One of them leaves its units in the rack behind.' : '{n} of them leave their units in the rack behind.', { n: lost }));
    return bulkFinish('group', rows, ops, { group: g, none, notes });
}

// What runs on `host`, and what runs on that (a container on a VM).
const bulkGuestsDeep = (host) => guestsOf(host).reduce((all, g) => all.concat(g, guestsOf(g)), []);

// ---- Move to host ----
// Each VM and container of the set onto the device picked (or onto none), in
// name order. Its group becomes the host's (repairHosts), which the row says
// when it changes; its map position and its cables stay as they are. A device
// that is not virtual, the host itself, and a host it may not run on (a VM on
// a VM or on a switch, anything on a container) are refused on their rows,
// not dropped.
function bulkPlanHost(ids, target) {
    const none = target === BULK_NO_HOST;
    const host = none ? null : getNode(target);
    if (!none && !host) return bulkFinish('host', [], [], { errors: [t('Pick a device for them to run on.')] });
    const field = t('Runs on');
    const nameOf = (n) => (n ? n.name || n.id : '—');
    const rows = [], ops = [];
    let moved = 0;
    const into = host ? (groupOfNode(hostRootOf(host) || host) || null) : null;
    bulkOrder(bulkSet(ids), 'name').forEach((node) => {
        const was = hostOf(node);
        const base = { nodeId: node.id, name: node.name, field, before: nameOf(was) };
        if (!isVirtualType(node.type)) { rows.push(Object.assign(base, { status: 'skip', before: '', after: '', why: t('Only a VM or a container runs on another device.') })); return; }
        if (host && node.id === host.id) { rows.push(Object.assign(base, { status: 'skip', after: '', why: t('This is the device they are moving onto.') })); return; }
        if (host && !canHost(node.type, host)) {
            rows.push(Object.assign(base, { status: 'bad', after: '', why: t(node.type === 'vm' ? 'A VM runs on a server, a workstation or a custom device.' : 'A container runs on a server, a workstation, a custom device or a VM.') }));
            return;
        }
        if ((was ? was.id : null) === (host ? host.id : null)) {
            rows.push(Object.assign(base, { status: 'same', after: base.before, why: host ? t('Already on {host}.', { host: nameOf(host) }) : '' }));
            return;
        }
        ops.push(host ? { nodeId: node.id, set: { host: host.id }, drop: [] } : { nodeId: node.id, set: {}, drop: ['host'] });
        if (host && (node.group || null) !== (into ? into.id : null)) moved++;
        rows.push(Object.assign(base, { status: 'change', after: nameOf(host) }));
    });
    const notes = [];
    if (moved) notes.push(into ? t(moved === 1 ? 'One of them moves to {group}, where {host} is.' : '{n} of them move to {group}, where {host} is.', { n: moved, group: groupPath(into), host: nameOf(host) })
        : t(moved === 1 ? 'One of them leaves its group: {host} is in none.' : '{n} of them leave their groups: {host} is in none.', { n: moved, host: nameOf(host) }));
    return bulkFinish('host', rows, ops, { host, none, notes });
}

// ---- Set Wi-Fi ----
// The associations of a device it is the client of (an AP's own links to
// its clients are theirs to change, not its).
const bulkWifiLinks = (node) => linksAtNode(node.id).filter((l) => { const e = wifiLinkEnds(l); return !!e && !!e.client && e.client.node === node; });
const bulkOnWifi = (nodes) => withLookupPass(() => nodes.some((n) => bulkWifiLinks(n).length > 0));
// What a link's SSID or band reads as in the preview: its own, else "Auto"
// and what that works out to.
function bulkWifiText(link, key) {
    const own = linkWifiOf(link, key);
    const name = (v) => (key === 'ssid' ? wifiLabel(wifiById(v)) : wifiBandName(v));
    if (own) return name(own);
    const auto = key === 'ssid' ? linkWifiSsid(link) : linkWifiBand(link);
    return auto ? `${t('Auto')} · ${name(auto)}` : t('Auto');
}
// req: { ssid, band }, each an id or a band, BULK_WIFI_AUTO, or '' (as it is).
function bulkPlanWifi(ids, req) {
    const ssid = req && req.ssid, band = req && req.band;
    if (ssid && ssid !== BULK_WIFI_AUTO && !wifiById(ssid)) return bulkFinish('wifi', [], [], { errors: [t('Pick a Wi-Fi network.')] });
    const rows = [], ops = [];
    withLookupPass(() => bulkOrder(bulkSet(ids), 'name').forEach((node) => {
        const links = bulkWifiLinks(node);
        if (!links.length) { rows.push({ nodeId: node.id, name: node.name, field: '', before: '', after: '', status: 'skip', why: t('Not on Wi-Fi.') }); return; }
        links.forEach((link) => {
            const next = Object.assign({}, link.wifi || {});
            if (ssid) next.ssid = ssid === BULK_WIFI_AUTO ? undefined : ssid;
            if (band) next.band = band === BULK_WIFI_AUTO ? undefined : band;
            const after = Object.assign({}, link, { wifi: readLinkWifi(next) });
            const fields = [ssid && ['ssid', 'SSID'], band && ['band', 'Band']].filter(Boolean);
            let changed = false;
            fields.forEach(([key, label]) => {
                const row = { nodeId: node.id, name: node.name, field: label, before: bulkWifiText(link, key), after: bulkWifiText(after, key) };
                // A band picked must be one both ends have (unknown is no
                // objection), and an SSID one the client's AP broadcasts: the
                // same test the SSID check makes (js/diagnostics.js), so a
                // set the preview calls a change never lands as a warning.
                // Between two radio-serving devices (a backhaul) no SSID is
                // joined, and none is refused.
                const both = linkWifiChoices(link);
                if (key === 'band' && band !== BULK_WIFI_AUTO && both && !both.bands.includes(band)) {
                    rows.push(Object.assign(row, { status: 'bad', why: t('{band} is not a band both ends have.', { band: wifiBandName(band) }) }));
                    return;
                }
                const ap = both && both.e.ap;
                if (key === 'ssid' && ssid !== BULK_WIFI_AUTO && ap && !radioServes(both.e.client.node)
                    && !apSsids(radioOf(ap.iface)).includes(ssid)) {
                    rows.push(Object.assign(row, { status: 'bad', why: t('{ap} does not broadcast {ssid}.',
                        { ap: ap.node.name || ap.node.id, ssid: wifiLabel(wifiById(ssid)) }) }));
                    return;
                }
                if (linkWifiOf(link, key) === linkWifiOf(after, key)) rows.push(Object.assign(row, { status: 'same' }));
                else { rows.push(Object.assign(row, { status: 'change' })); changed = true; }
            });
            if (changed && !rows.some((r) => r.nodeId === node.id && r.status === 'bad')) ops.push({ linkId: link.id, set: { wifi: after.wifi } });
        });
    }));
    return bulkFinish('wifi', rows, ops, { ssid: wifiById(ssid), auto: ssid === BULK_WIFI_AUTO });
}

// ---- Delete ----
function bulkPlanDelete(ids) {
    const nodes = bulkSet(ids);
    const gone = new Set(nodes.map((n) => n.id));
    const cables = state.links.filter((l) => gone.has(l.source) || gone.has(l.target)).length;
    const rows = nodes.map((n) => ({ nodeId: n.id, name: n.name, field: '', before: typeName(n.type), after: '', status: 'change' }));
    return bulkFinish('delete', rows, nodes.length ? [{ deleteNodes: [...gone] }] : [], { cables });
}

// ---- Writing a plan ----
// Onto any document of the editor's shape: the live one (state) or a scratch
// copy. A delete on a scratch copy takes the cables with the devices, as
// deleteSelected() does on the live one.
function bulkWrite(plan, doc) {
    const added = [];
    plan.ops.forEach((op) => {
        if (op.addLink) { added.push(op.addLink); return; }
        if (op.deleteNodes) {
            const gone = new Set(op.deleteNodes);
            doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
            doc.links = doc.links.filter((l) => !gone.has(l.source) && !gone.has(l.target));
            return;
        }
        if (op.linkId) {
            const link = doc.links.find((l) => l.id === op.linkId);
            if (link) Object.assign(link, op.set || {});
            if (link && link.cable === null) delete link.cable;   // every fact cleared
            if (link && 'wifi' in link && !link.wifi) delete link.wifi;   // back to automatic
            return;
        }
        const node = doc.nodes.find((n) => n.id === op.nodeId);
        if (!node) return;
        Object.keys(op.set || {}).forEach((k) => {
            if (!/^x:/.test(k)) { node[k] = op.set[k]; return; }
            // A custom column's value, written as the column holds it (the
            // plan carries it as shown); No and blank are no value kept.
            const def = customColumnById(k.slice(2));
            if (!def) return;
            const v = op.set[k];
            setCustomValue(node, def.id, def.kind === 'yesno' ? (v ? true : undefined) : parseCustomValue(def, v).value);
        });
        (op.drop || []).forEach((k) => { delete node[k]; });
        if (op.iface) {
            const iface = (node.interfaces || []).find((i) => i.id === op.iface.id);
            if (iface) iface.ip = op.iface.ip;
        }
    });
    // The host rule over the result, as save() keeps it on the live one, so
    // the preview's findings see the VMs where their hosts put them.
    repairHosts(doc.nodes);
    if (!added.length) return;
    // A new cable's device end is the binder's pick, made on the document
    // being written: it is lent to the model's helpers for the length of the
    // bind (as csvWrite does), so a scratch copy's NICs are the ones looked at.
    const held = { nodes: state.nodes, links: state.links };
    state.nodes = doc.nodes; state.links = doc.links;
    try {
        added.forEach((l) => { if (getNode(l.source) && getNode(l.target)) doc.links.push(bindLink(cloneData(l))); });
    } finally {
        state.nodes = held.nodes; state.links = held.links;
    }
}

// The findings the plan would leave, against the ones there now.
function bulkFindingsDelta(plan) {
    if (!plan.ops.length || plan.errors.length) return [];
    const scratch = cloneData({ nodes: state.nodes, links: state.links, networks: state.networks, groups: state.groups, wifi: state.wifi });
    bulkWrite(plan, scratch);
    return findingsDelta(topologyFindings(), diagnoseDoc(scratch).findings);
}

function bulkPlan(req) {
    if (req.action === 'set') return bulkPlanSet(req.ids, req.edits, req.kind);
    if (req.action === 'rename') return bulkPlanRename(req.ids, req.rename);
    if (req.action === 'move') return bulkPlanMove(req.ids, req.net);
    if (req.action === 'recable') return bulkPlanRecable(req.ids, req.recable);
    if (req.action === 'group') return bulkPlanGroup(req.ids, req.group);
    if (req.action === 'host') return bulkPlanHost(req.ids, req.host);
    if (req.action === 'wifi') return bulkPlanWifi(req.ids, req.wifi);
    return bulkPlanDelete(req.ids);
}

// One transaction however many devices: one undo step, one redraw. -> the
// number of devices changed (or deleted).
function applyBulkPlan(plan) {
    if (!plan.ops.length || plan.errors.length || readOnlyRefuses()) return 0;
    const n = plan.counts.change;
    if (plan.action === 'delete') {
        setSelectionEntries(plan.ops[0].deleteNodes.map((id) => ({ type: 'node', id })));
        deleteSelected({ confirmed: true });   // the preview was the question
        showToast(t('Devices deleted: {n}', { n }), 'ok');
        return n;
    }
    batch(() => {
        bulkWrite(plan, state);
        save();
        renderCanvasOnly();
    });
    resetBulkDraft();
    renderSelection();
    renderBulkPanel(true);  // even with the focus in a field: see renderBulkFields
    if (plan.action === 'group' || plan.action === 'host') renderGroupsPanel();   // its counts
    if (plan.action === 'wifi') renderWifiPanel();   // its clients
    showToast(plan.kind === 'link' ? t('Cables changed: {n}', { n }) : t('Devices changed: {n}', { n }), 'ok');
    return n;
}

// The tab the user is looking at. _bulk.tab is the tab they chose and is
// kept, but the visible one can differ: cables have Set fields only, and
// Wi-Fi exists only for a set with a device on Wi-Fi in it. Rendering,
// Preview and Enter all read this one answer, so Preview never acts on a
// pane the user can no longer see; the chosen tab comes back with the set.
function bulkTab(kind = bulkKind(), onWifi) {
    if (kind === 'link') return 'set';
    if (_bulk.tab !== 'wifi') return _bulk.tab;
    if (onWifi === undefined) onWifi = kind === 'node' && bulkOnWifi(bulkSet());
    return onWifi ? 'wifi' : 'set';
}

// ---- The rail ----
// Built from the set each time the selection is drawn (renderSelection,
// js/ui.js), and kept out of the way of a field being typed into.
function renderBulkPanel(force) {
    const panel = bulkEl('bulkPanel');
    if (!panel) return;
    const kind = bulkKind();
    panel.classList.toggle('hidden', !kind);
    if (!kind) return;
    // A set that turned from devices into cables ("Select only cables") is
    // another set: what was typed for the devices does not carry over.
    if (_bulk.kind !== kind) { resetBulkDraft(); _bulk.kind = kind; }
    const recs = kind === 'link' ? bulkLinks() : bulkSet();
    const onWifi = kind === 'node' && bulkOnWifi(recs);
    const tab = bulkTab(kind, onWifi);
    const draft = bulkDraft();
    document.querySelectorAll('#bulkTabs [data-bulk]').forEach((b) => {
        const active = b.dataset.bulk === tab;
        b.classList.toggle('active', active);
        b.classList.toggle('hidden', (kind === 'link' && b.dataset.bulk !== 'set') || (b.dataset.bulk === 'wifi' && !onWifi));
        b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    ['set', 'rename', 'move', 'recable', 'group', 'host', 'wifi'].forEach((k) => bulkEl(`bulkPane-${k}`).classList.toggle('hidden', k !== tab));
    renderBulkFields(recs, draft, force, kind);
    // Rename and Move keep what was typed; only the network list is rebuilt.
    bulkEl('bulkFind').value = draft.rename.find;
    bulkEl('bulkPattern').value = draft.rename.pattern;
    bulkEl('bulkOrder').value = draft.rename.order;
    bulkEl('bulkStart').value = draft.rename.start;
    const nets = state.networks.slice().sort((a, b) => compareCidr(a.cidr, b.cidr));
    const pick = bulkEl('bulkNet');
    pick.innerHTML = nets.map((net) => {
        const vlan = net.vlan != null ? ` · VLAN ${net.vlan}` : '';
        const name = isBlank(net.name) ? net.cidr : `${net.name.trim()} · ${net.cidr}`;
        return `<option value="${escapeHtml(net.id)}">${escapeHtml(name + vlan)}</option>`;
    }).join('');
    if (nets.some((n) => n.id === draft.move.net)) pick.value = draft.move.net;
    else draft.move.net = pick.value || '';
    pick.classList.toggle('hidden', !nets.length);
    bulkEl('bulkNoNets').classList.toggle('hidden', !!nets.length);
    // Re-cable: every switch and access point, by name; one in the set is
    // still listed (the preview says it is the one they move to).
    const sws = state.nodes.filter(hasPortGrid).sort((a, b) => naturalCompare(a.name || a.id, b.name || b.id));
    const swPick = bulkEl('bulkSwitch');
    swPick.innerHTML = sws.map((sw) => `<option value="${escapeHtml(sw.id)}">${escapeHtml(`${sw.name || sw.id} · ${typeName(sw.type)}`)}</option>`).join('');
    if (sws.some((sw) => sw.id === draft.recable.target)) swPick.value = draft.recable.target;
    else draft.recable.target = swPick.value || '';
    swPick.classList.toggle('hidden', !sws.length);
    bulkEl('bulkNoSwitches').classList.toggle('hidden', !!sws.length);
    bulkEl('bulkFrom').value = draft.recable.from;
    bulkEl('bulkRecableOrder').value = draft.recable.order;
    // Group: the tree, as the device editor's picker shows it, and "out of
    // every group" at the end. Nothing is picked until somebody picks.
    const gPick = bulkEl('bulkGroup');
    const tree = groupTree();
    gPick.innerHTML = `<option value="">${escapeHtml(t('Pick a group'))}</option>`
        + tree.map((e) => `<option value="${escapeHtml(e.group.id)}">${escapeHtml(groupOptionIndent(e.depth) + groupLabel(e.group))}</option>`).join('')
        + `<option value="${BULK_NO_GROUP}">${escapeHtml(t('Out of every group'))}</option>`;
    if (draft.group.target !== BULK_NO_GROUP && !groupById(draft.group.target)) draft.group.target = '';
    gPick.value = draft.group.target;
    gPick.classList.toggle('hidden', !tree.length);
    bulkEl('bulkNoGroups').classList.toggle('hidden', !!tree.length);
    renderBulkHostPick(recs, draft);
    if (onWifi) renderBulkWifiPick(draft);
    updateBulkGo();
}

// Set Wi-Fi: every Wi-Fi network, and every band; "as it is" first, and
// Auto, which takes the links back to what Topo works out, last.
function renderBulkWifiPick(draft) {
    const opt = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    const ssid = bulkEl('bulkWifiSsid'), band = bulkEl('bulkWifiBand');
    ssid.innerHTML = opt('', t('Leave as is')) + (state.wifi || []).map((w) => opt(w.id, wifiLabel(w))).join('') + opt(BULK_WIFI_AUTO, t('Auto'));
    band.innerHTML = opt('', t('Leave as is')) + WIFI_BANDS.map((b) => opt(b, wifiBandName(b))).join('') + opt(BULK_WIFI_AUTO, t('Auto'));
    if (draft.wifi.ssid !== BULK_WIFI_AUTO && !wifiById(draft.wifi.ssid)) draft.wifi.ssid = '';
    ssid.value = draft.wifi.ssid;
    band.value = draft.wifi.band;
}

// Host: every device a container could run on (the widest rule; a VM's row
// refuses a VM), the ones VMs usually run on first, and "on none" at the end.
// Nothing is picked until somebody picks.
function renderBulkHostPick(nodes, draft) {
    const pick = bulkEl('bulkHost');
    if (!pick) return;
    const virt = nodes.filter((n) => isVirtualType(n.type));
    const probe = { id: '', type: virt.some((n) => n.type === 'container') ? 'container' : 'vm' };
    const list = hostCandidates(probe);
    const opt = (n) => `<option value="${escapeHtml(n.id)}">${escapeHtml(`${n.name || n.id} · ${typeName(n.type)}`)}</option>`;
    const first = list.filter((n) => isSuggestedHost(probe.type, n)), rest = list.filter((n) => !isSuggestedHost(probe.type, n));
    pick.innerHTML = `<option value="">${escapeHtml(t('Pick a device'))}</option>`
        + (first.length && rest.length ? `<optgroup label="${escapeHtml(t('Suggested'))}">${first.map(opt).join('')}</optgroup><optgroup label="${escapeHtml(t('Other devices'))}">${rest.map(opt).join('')}</optgroup>`
            : list.map(opt).join(''))
        + `<option value="${BULK_NO_HOST}">${escapeHtml(t('On no device'))}</option>`;
    if (draft.host.target !== BULK_NO_HOST && !list.some((n) => n.id === draft.host.target)) draft.host.target = '';
    pick.value = draft.host.target;
    bulkEl('bulkNoVirtual').classList.toggle('hidden', virt.length > 0);
}

function renderBulkFields(nodes, draft, force, kind = 'node') {
    const box = bulkEl('bulkFields');
    // Not under the cursor: a re-render while a field has the focus (a locale
    // switch, an undo) would take the field away mid-word. A Clear button
    // holding the focus is not typing, and its own click redraws the row.
    // A locale switch forces it (its labels and "mixed" are words): what was
    // typed is in the draft, and the same field gets the focus back. So does
    // an Apply: the modal hands the focus back to the field Enter was pressed
    // in, and skipping the redraw then left that field's data-initial (and
    // every "mixed") as they were before the write, so Preview offered the
    // value just applied again as a change.
    const focus = document.activeElement;
    const typing = box.contains(focus) && focus.matches('input, select');
    // Unless the rows are another kind's: a set that became cables from
    // devices (or back) while a field had the focus would otherwise keep
    // offering the devices' fields for the cables.
    if (!force && typing && box.dataset.kind === kind) return;
    const refocus = typing ? focus.dataset.key : null;
    box.innerHTML = '';
    box.dataset.kind = kind;
    bulkFields(kind).forEach((bf) => {
        const common = bulkCommon(bf, nodes);
        if (!common) return;
        const id = `bulkF-${bf.key}`;
        const cleared = draft.clear.has(bf.key);
        const touched = Object.prototype.hasOwnProperty.call(draft.set, bf.key);
        const row = document.createElement('div');
        row.className = 'bulk-field';
        row.dataset.key = bf.key;
        const head = document.createElement('div');
        head.className = 'bulk-field-head';
        const lbl = document.createElement('label');
        lbl.className = 'prop-lbl'; lbl.htmlFor = id; lbl.textContent = bulkFieldLabel(bf);
        head.appendChild(lbl);
        let input;
        if (bf.editor === 'text') {
            const clr = document.createElement('button');
            clr.type = 'button'; clr.className = 'link-btn quiet bulk-clear';
            clr.dataset.clear = bf.key;
            clr.textContent = cleared ? t('Leave as is') : t('Clear');
            clr.title = cleared ? t('Leave this field as each device has it') : t('Empty this field on every one of them');
            head.appendChild(clr);
            input = document.createElement('input');
            input.type = 'text'; input.className = 'input bulk-in';
            if (bf.key === 'gw' || bf.key === 'dns' || bf.key === 'ports') input.classList.add('mono');
            input.autocomplete = 'off'; input.spellcheck = false;
            let initial = common.mixed ? '' : common.value;
            if (bf.unit) {
                // The number alone in the field; the unit in the pick in front.
                const parts = cableLengthParts(initial);
                input.dataset.stored = initial;
                input.dataset.length = '1';
                input.inputMode = 'decimal';
                input.classList.add('mono');
                if (parts) initial = parts.n;
            }
            input.dataset.initial = initial;
            input.value = cleared ? '' : (touched ? draft.set[bf.key] : initial);
            input.placeholder = cleared ? t('will be cleared') : (common.mixed ? t('mixed') : '');
            input.disabled = cleared;
            row.classList.toggle('cleared', cleared);
        } else {
            input = document.createElement('select');
            input.className = 'select bulk-in';
            // A status none of them has said shows as "—", which asks for
            // nothing (readBulkEdits skips a blank).
            const opts = bf.editor === 'bool'
                ? [{ value: 'true', label: t('Yes') }, { value: 'false', label: t('No') }]
                : bf.editor === 'medium'
                    ? Object.keys(FLOW_CLASS).map((k) => ({ value: k, label: bulkShow(bf, k) }))
                    : bf.editor === 'status'
                        ? (common.mixed ? [] : [{ value: '', label: '—' }]).concat(STATUS_VALUES.map((k) => ({ value: k, label: statusName(k) })))
                        : paletteDefs.map((d) => ({ value: d.type, label: typeName(d.type) }));
            const initial = common.mixed ? '' : String(common.value);
            input.dataset.initial = initial;
            input.innerHTML = (common.mixed ? `<option value="">${escapeHtml(t('mixed'))}</option>` : '')
                + opts.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
            input.value = touched ? draft.set[bf.key] : initial;
        }
        input.id = id;
        input.dataset.key = bf.key;
        row.appendChild(head);
        row.appendChild(input);
        if (bf.unit) {
            const parts = cableLengthParts(common.mixed ? '' : common.value);
            const unit = wrapUnitField(input, draft.unit[bf.key] || (parts ? parts.unit : CABLE_UNIT_DEFAULT));
            unit.id = `bulkU-${bf.key}`;
            unit.dataset.unitFor = bf.key;
            unit.disabled = cleared;
        }
        if (bf.can) {
            const on = nodes.filter((n) => bulkCan(bf, n)).length;
            if (on < nodes.length) {
                const note = document.createElement('p');
                note.className = 'rail-note bulk-note';
                note.textContent = t('Applies to {n} of them.', { n: on });
                row.appendChild(note);
            }
        }
        box.appendChild(row);
    });
    // A forced redraw put a new field where the focused one was: give it the
    // focus back, so the next key still lands in the same field.
    const again = refocus && bulkEl('bulkF-' + refocus);
    if (again && !again.disabled) again.focus({ preventScroll: true });
}

// What the Set fields form asks for: { key: { text } | { clear: true } }. A
// field left blank, or showing what it showed, asks for nothing.
function readBulkEdits(kind = bulkKind() || 'node') {
    const draft = bulkDraft();
    const edits = {};
    bulkFields(kind).forEach((bf) => {
        if (draft.clear.has(bf.key)) { edits[bf.key] = { clear: true }; return; }
        const el = bulkEl(`bulkF-${bf.key}`);
        if (!el) return;
        const v = el.value;
        if (bf.unit && String(v).trim()) {
            // The number and the unit picked, unless together they are what
            // every one of them holds already.
            const unit = bulkEl(`bulkU-${bf.key}`);
            const text = `${v} ${unit ? unit.value : CABLE_UNIT_DEFAULT}`;
            if (cableLengthFromText(text) !== el.dataset.stored) edits[bf.key] = { text };
            return;
        }
        if (!String(v).trim() || v === el.dataset.initial) return;
        edits[bf.key] = { text: v };
    });
    return edits;
}

function bulkRequest(action = bulkTab()) {
    const draft = bulkDraft();
    if (bulkKind() === 'link') {
        // Cables: Set fields is all there is (a cable's Delete never asks).
        return action === 'set' ? { action, kind: 'link', ids: selectedOf('link'), edits: readBulkEdits('link') } : { action, kind: 'link', ids: [] };
    }
    const ids = selectedOf('node');
    if (action === 'set') return { action, kind: 'node', ids, edits: readBulkEdits('node') };
    if (action === 'rename') return { action, ids, rename: Object.assign({}, draft.rename) };
    if (action === 'move') return { action, ids, net: draft.move.net };
    if (action === 'recable') return { action, ids, recable: Object.assign({}, draft.recable) };
    if (action === 'group') return { action, ids, group: draft.group.target };
    if (action === 'host') return { action, ids, host: draft.host.target };
    if (action === 'wifi') return { action, ids, wifi: Object.assign({}, draft.wifi) };
    return { action: 'delete', ids };
}
// Preview is offered once the form asks for something.
function bulkAsksSomething(req) {
    if (req.kind === 'link' && req.action !== 'set') return false;
    if (req.action === 'set') return Object.keys(req.edits).length > 0;
    if (req.action === 'rename') return !!(req.rename.pattern.trim() || req.rename.find);
    if (req.action === 'move') return !!req.net;
    if (req.action === 'recable') return !!req.recable.target;
    if (req.action === 'group') return !!req.group;
    if (req.action === 'host') return !!req.host;
    if (req.action === 'wifi') return !!(req.wifi.ssid || req.wifi.band);
    return req.ids.length > 0;
}
function updateBulkGo() {
    const go = bulkEl('bulkPreviewBtn');
    if (go) go.disabled = !bulkAsksSomething(bulkRequest());
}

// ---- The preview ----
const BULK_TITLES = { set: 'Set fields', rename: 'Rename', move: 'Move', recable: 'Re-cable', group: 'Move to group', host: 'Move to host', wifi: 'Set Wi-Fi', delete: 'Delete' };
function openBulkPreview(action = bulkTab()) {
    if (!bulkApplies() || readOnlyRefuses()) return;
    const req = bulkRequest(bulkKind() === 'link' ? 'set' : action);
    if (!bulkAsksSomething(req)) return;
    _bulk.req = req;
    const plan = bulkPlan(req);
    renderBulkPreview(plan);
    const scrim = bulkEl('bulkDialog');
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onClose: () => { _bulk.req = null; } });
    else scrim.hidden = false;
}
function closeBulkPreview() {
    const scrim = bulkEl('bulkDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else { scrim.hidden = true; _bulk.req = null; }
}

function renderBulkPreview(plan) {
    const c = plan.counts;
    const action = plan.action;
    bulkEl('bulkTitle').textContent = action === 'move' && plan.network ? t('Move to {network}', { network: networkLabel(plan.network) })
        : action === 'recable' && plan.target ? t('Re-cable onto {switch}', { switch: plan.target.name || plan.target.id })
            : action === 'group' && plan.group ? t('Move to {group}', { group: groupLabel(plan.group) })
                : action === 'group' && plan.none ? t('Out of every group')
                    : action === 'host' && plan.host ? t('Run on {host}', { host: plan.host.name || plan.host.id })
                        : action === 'host' && plan.none ? t('On no device') : t(BULK_TITLES[action]);
    const blurb = {
        set: plan.kind === 'link' ? t('The same value on every cable.') : t('The same value on every device that can take it.'),
        rename: t('Numbered in the order shown.'),
        move: t('Each one takes the next free address there, and its gateway and DNS come from the subnet.'),
        recable: t('Each cable moves to the next free port there, in the order shown. The cable keeps its label, length and colour, and each device keeps its address.'),
        group: plan.none ? t('They stay on the map, in no group.') : t('Each one moves into the group; its addressing and cables stay as they are.'),
        host: plan.none ? t('They run on nothing in the register, and stay where they are.') : t('Each one runs on it and is where it is; its addressing, cables and place on the map stay as they are.'),
        wifi: t('Each device on Wi-Fi joins it; its address and its access point stay as they are.'),
        delete: t('Every cable on these devices goes with them.')
    }[action];
    bulkEl('bulkBlurb').textContent = blurb;
    const bits = action === 'delete'
        ? [[t('Devices to delete'), c.change], [t('Cables removed with them'), plan.cables]]
        : [[t('To change'), c.change], [t('Unchanged'), c.same], [t('Not valid'), c.bad], [t('Left as they are'), c.skip]];
    bulkEl('bulkCounts').innerHTML = bits.map(([label, n]) => `<span class="paste-count${n ? '' : ' zero'}"><b class="mono">${n}</b> ${escapeHtml(label)}</span>`).join('');
    const msgs = plan.errors.map((m) => `<div class="alert err">${escapeHtml(m)}</div>`)
        .concat(plan.notes.map((m) => `<div class="alert warn">${escapeHtml(m)}</div>`));
    bulkEl('bulkMsgs').innerHTML = msgs.join('');
    bulkEl('bulkMsgs').classList.toggle('hidden', !msgs.length);
    const mark = { change: action === 'delete' ? '✕' : '→', same: '=', bad: '✕', skip: '—' };
    bulkEl('bulkPreview').innerHTML = plan.rows.slice(0, 400).map((r) => `<tr class="paste-${r.status}">
            <td>${escapeHtml(r.name)}${r.field ? `<span class="bulk-what">${escapeHtml(r.field)}</span>` : ''}</td>
            <td class="mono">${escapeHtml(r.before)}</td>
            <td class="paste-mark" title="${escapeHtml(r.why || '')}">${mark[r.status]}</td>
            <td class="mono">${escapeHtml(r.status === 'skip' || r.status === 'bad' ? (r.why || '') : r.after)}</td>
        </tr>`).join('');
    bulkEl('bulkPreviewWrap').classList.toggle('hidden', !plan.rows.length);
    const apply = bulkEl('bulkApplyBtn');
    apply.disabled = !c.change || plan.errors.length > 0;
    apply.textContent = action === 'delete' ? t('Delete') : t('Apply');
    apply.classList.toggle('danger', action === 'delete');
    bulkEl('bulkDelta').innerHTML = findingsDeltaHtml(bulkFindingsDelta(plan), c.change > 0 && !plan.errors.length);
}

function applyBulkDialog() {
    if (!_bulk.req) return;
    const plan = bulkPlan(_bulk.req);
    if (!plan.counts.change || plan.errors.length) return;
    closeBulkPreview();
    applyBulkPlan(plan);
}

// The Delete Selected button: for a set the panel applies to, the same
// preview; otherwise (a mixed set, the reduced views) it deletes as before.
function deleteSelectionAsked() {
    if (bulkKind() === 'node') openBulkPreview('delete');
    else deleteSelected();
}

// ---- Wiring ----
(function wireBulkPanel() {
    const panel = bulkEl('bulkPanel');
    if (!panel) return;
    bulkEl('bulkTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-bulk]');
        if (!b) return;
        _bulk.tab = b.dataset.bulk;
        renderBulkPanel();
    });
    bulkEl('bulkFields').addEventListener('input', (e) => {
        const key = e.target.dataset && e.target.dataset.key;
        if (!key) return;
        if (e.target.dataset.length) filterLengthInput(e.target);
        bulkDraft().set[key] = e.target.value;
        updateBulkGo();
    });
    bulkEl('bulkFields').addEventListener('change', (e) => {
        const unitFor = e.target.dataset && e.target.dataset.unitFor;
        if (unitFor) { bulkDraft().unit[unitFor] = e.target.value; updateBulkGo(); return; }
        const key = e.target.dataset && e.target.dataset.key;
        if (key) { bulkDraft().set[key] = e.target.value; updateBulkGo(); }
    });
    bulkEl('bulkFields').addEventListener('click', (e) => {
        const b = e.target.closest('[data-clear]');
        if (!b) return;
        const draft = bulkDraft();
        const key = b.dataset.clear;
        if (draft.clear.has(key)) draft.clear.delete(key);
        else { draft.clear.add(key); delete draft.set[key]; }
        renderBulkPanel();
    });
    const renameField = (id, key) => bulkEl(id).addEventListener('input', (e) => { bulkDraft().rename[key] = e.target.value; updateBulkGo(); });
    renameField('bulkFind', 'find');
    renameField('bulkPattern', 'pattern');
    renameField('bulkStart', 'start');
    bulkEl('bulkOrder').addEventListener('change', (e) => { bulkDraft().rename.order = e.target.value; updateBulkGo(); });
    bulkEl('bulkNet').addEventListener('change', (e) => { bulkDraft().move.net = e.target.value; updateBulkGo(); });
    bulkEl('bulkSwitch').addEventListener('change', (e) => { bulkDraft().recable.target = e.target.value; updateBulkGo(); });
    bulkEl('bulkFrom').addEventListener('input', (e) => { bulkDraft().recable.from = e.target.value; updateBulkGo(); });
    bulkEl('bulkRecableOrder').addEventListener('change', (e) => { bulkDraft().recable.order = e.target.value; updateBulkGo(); });
    bulkEl('bulkGroup').addEventListener('change', (e) => { bulkDraft().group.target = e.target.value; updateBulkGo(); });
    bulkEl('bulkHost').addEventListener('change', (e) => { bulkDraft().host.target = e.target.value; updateBulkGo(); });
    bulkEl('bulkWifiSsid').addEventListener('change', (e) => { bulkDraft().wifi.ssid = e.target.value; updateBulkGo(); });
    bulkEl('bulkWifiBand').addEventListener('change', (e) => { bulkDraft().wifi.band = e.target.value; updateBulkGo(); });
    // Enter in any field of the panel is Preview.
    panel.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.matches('input')) return;
        e.preventDefault();
        openBulkPreview();
    });
    bulkEl('bulkPreviewBtn').addEventListener('click', () => openBulkPreview());
    bulkEl('bulkApplyBtn').addEventListener('click', applyBulkDialog);
})();
