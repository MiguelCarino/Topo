// ---- Map | Table (plan 3.2) ----
// The same document as the map, as rows: Devices (each one's interfaces fold
// open beneath it), Interfaces, Cables, Ports (every faceplate port of every
// switch and AP, with its label and access VLAN) and Subnets. It is the register's other
// face. A site of sixty devices is read and corrected far faster down a column
// than one device at a time in a 340px rail, which clipped a /24 CIDR out of
// sight (js/ui.js, renderSidebarData).
//
// Where things come from, and where they go:
//
//   rows      reportDevices(), reportConnections(), reportPorts() and reportSubnets() in
//             js/report.js: the pure report model, so the table, the printed
//             inventory and the cards cannot disagree. Those rows are derived
//             and read-only (a decoded vendor, a gateway inherited from the
//             network, a usage count), so nothing is ever written into them.
//   columns   the field schema (NODE_FIELDS, IFACE_FIELDS, LINK_FIELDS,
//             NETWORK_FIELDS in js/model.js): a column's header is its row's
//             label, its `table` says whether it may be typed into, and its
//             `validate` decides what is accepted. Which columns a tab shows,
//             and in what order, is chosen here.
//   edits     written to the record in state (the node, the interface, the
//             cable, the network), never to the row, after the schema's
//             validator has said yes. A value it refuses is not written at all
//             (the sidebar keeps a half-typed address and marks it red; a
//             table cell is one finished value, so it is refused instead).
//             Each edit is one batch(): one undo step, one redraw.
//
// Paste a column: N lines pasted over N rows, each line checked on its own,
// shown first (what changes, what stays, what is refused, and what the
// findings would become, from the pure engine run on a scratch copy), then
// applied as one transaction. It covers "set these twenty IPs / names /
// firmware" without a bulk action of its own.
//
// Keyboard: the arrows, Tab, Home/End and Page Up/Down move between cells;
// Enter, F2, a double click or a typed character starts an edit; Enter or Tab
// keeps it, Esc throws it away. While a cell has the focus the map's
// single-key shortcuts (T, F, Delete…) stay quiet: the keys belong to the
// table.
//
// The full editor's, like the Subnets tab: technical vocabulary (Interfaces,
// Subnets, Gateway, IP / CIDR…) stays English, as the comment in applyProfile
// (js/app.js) explains; plain words and sentences are translated (MESSAGES,
// js/i18n.js). A reduced view never shows it. On a phone it is what opens
// first, because a map is the hardest thing there is to edit with a thumb.
//
// Like the Subnets tab, it is rebuilt from the document after anything
// changes (renderCanvasOnly calls renderTableView), only while it shows, and
// never under a cell being edited or a pointer still pressed on it: a rebuild
// there would take the field, or the row about to be clicked, away.
//
// Load order: ... ui -> dialog -> report -> library -> share -> networks -> table -> query -> bulk -> app

const TV_TABS = [
    { key: 'devices', label: 'Devices', plain: true },
    { key: 'interfaces', label: 'Interfaces' },
    { key: 'cables', label: 'Cables', plain: true },
    { key: 'ports', label: 'Ports' },
    { key: 'subnets', label: 'Subnets' }
];

const _tv = {
    tab: 'devices',
    sort: {},                       // tab -> { col, dir: 1 | -1 }
    expanded: new Set(),            // device ids whose interfaces are open
    // Interfaces and subnets are not things the map can select, so their rows
    // are ticked here; devices and cables are ticked in state.selection.
    checked: { interfaces: new Set(), ports: new Set(), subnets: new Set() },
    anchor: null,                   // the last row ticked, for shift-range
    cursor: { row: null, col: null },
    rows: [],                       // on screen, in display order (after the search)
    total: 0,                       // top-level rows on the tab before the search
    editor: null,                   // { el, td, row, col, done }
    dirty: true,
    pointerDown: false,
    downOnCursor: false,
    // Whether the cursor stands where the user put it. A freshly drawn table
    // parks it on the first cell only so the keyboard has somewhere to start;
    // a click there must still select the row, not open an editor on it.
    cursorChosen: false,
    followSelection: false,   // set when the table is shown: see placeCursor
    keepFocus: false,
    defaultView: null               // decided once, at the first look
};

const tvEl = () => document.getElementById('tableView');
const tableShown = () => { const v = tvEl(); return !!v && !v.classList.contains('hidden'); };

// ---- Map | Table ----
// The visitor's choice is remembered (state.settings.view, a per-browser
// preference like the library tab). Until there is one, a phone opens on the
// table and anything wider on the map. That is decided once, so turning a
// phone sideways does not swap the view out from under a thumb.
const PHONE_MQ = '(max-width: 640px)';
function effectiveView() {
    if (isReduced()) return 'map';
    if (state.settings.view === 'map' || state.settings.view === 'table') return state.settings.view;
    if (_tv.defaultView === null) _tv.defaultView = window.matchMedia && window.matchMedia(PHONE_MQ).matches ? 'table' : 'map';
    return _tv.defaultView;
}

function setView(view) {
    if (view !== 'map' && view !== 'table') return;
    state.settings.view = view;
    saveSettings();
    applyView();
}

function applyView() {
    const view = tvEl();
    if (!view) return;
    const table = effectiveView() === 'table';
    if (!table) cancelEdit();
    view.classList.toggle('hidden', !table);
    document.body.classList.toggle('table-view', table);
    document.querySelectorAll('#viewSwitch [data-view]').forEach((b) => {
        const on = b.dataset.view === (table ? 'table' : 'map');
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    if (table) {
        // A device picked on the map while the table was away wins over a
        // cursor left from the last visit: the cursor goes to the selection,
        // so a paste or an edit lands on the row that is plainly selected.
        _tv.followSelection = true;
        renderTableView(true);
    }
    // The search box counts rows over the table and devices over the map.
    if (typeof updateQueryBar === 'function') updateQueryBar();
}

function showTableTab(key) {
    if (!TV_TABS.some((tb) => tb.key === key)) return;
    cancelEdit();
    if (_tv.tab !== key) { _tv.tab = key; _tv.cursor = { row: null, col: null }; _tv.cursorChosen = false; _tv.anchor = null; }
    renderTableView(true);
}

// ---- Columns ----
const tvField = (fields, key) => fields.find((f) => f.key === key);
const tvLabel = (col) => (col.plain ? t(col.label) : col.label);

// Values as typed: trimmed, and checked by the schema row. `field` is the
// schema row the column is made from.
const tvTextParse = (field) => (text) => {
    const v = String(text == null ? '' : text).trim();
    if (field && field.validate && !field.validate(v)) return { error: true };
    return { value: v };
};
const YES_RE = /^(1|y|yes|true|on|x|✓|si|sí|sim|да|はい)$/i;
const NO_RE = /^(0|n|no|false|off|não|nao|нет|いいえ)$/i;
const tvBoolParse = (text) => {
    const v = String(text == null ? '' : text).trim();
    if (YES_RE.test(v)) return { value: true };
    if (NO_RE.test(v)) return { value: false };
    return { error: true };
};
// A medium by its key or the name the report gives it ("fiber", "Fibre
// optic", "wifi").
const MEDIUM_WORDS = { copper: 'utp', ethernet: 'utp', cable: 'utp', fibre: 'fiber', wifi: 'wireless', 'wi-fi': 'wireless', radio: 'wireless', tunnel: 'vpn' };
function tvMediumParse(text) {
    const v = String(text == null ? '' : text).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(FLOW_CLASS, v)) return { value: v };
    if (MEDIUM_WORDS[v]) return { value: MEDIUM_WORDS[v] };
    const byName = Object.keys(MEDIUM_NAMES).find((k) => MEDIUM_NAMES[k].toLowerCase() === v);
    if (byName) return { value: byName };
    const first = v.split(/\s+/)[0];
    if (MEDIUM_WORDS[first] || Object.prototype.hasOwnProperty.call(FLOW_CLASS, first)) return { value: MEDIUM_WORDS[first] || first };
    return { error: true };
}

const same = (a, b) => (a == null ? '' : String(a)) === (b == null ? '' : String(b));
const shown = (text, extra) => Object.assign({ text: text == null ? '' : String(text) }, extra || {});
// One line in a cell: a newline in the notes reads as a pause, not a break.
const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ' · ');

// A column made from a schema row. rec says which record a row's edit lands
// on: 'node', 'iface', 'link' or 'net'.
function schemaColumn(fields, key, rec, opts) {
    const f = tvField(fields, key);
    const editable = f.table === 'edit';
    return Object.assign({
        key, rec, field: f, label: f.label,
        editor: editable ? 'text' : null,
        parse: tvTextParse(f),
        get: (target) => target[key],
        set: (target, value) => { target[key] = value; },
        same,
        show: (row) => shown(row.data[key])
    }, opts);
}

// What a node's own gateway or DNS field holds, and what it uses: a blank one
// shows the network's, greyed, so the column reads as configured.
function inheritedCell(row, key, reportKey) {
    const node = getNode(row.ref.nodeId);
    const own = node && !isBlank(node[key]) ? node[key].trim() : '';
    const field = tvField(NODE_FIELDS, key);
    if (own) return shown(own, { bad: !!(field.validate && !field.validate(own)) });
    const used = row.data[reportKey];
    if (!used) return shown('');
    const src = key === 'gw' ? gatewaySource(node) : dnsSource(node);
    return shown(used, { muted: true, title: src && src.network ? t('{value} · from {network}', { value: used, network: networkLabel(src.network) }) : '' });
}

const SEV_WORD = { bad: 'Critical', warn: 'Advisory' };

// The Asset group's text fields (js/assets.js): left off the record when
// emptied, as the side panel does, so an emptied serial is no key at all.
function assetColumn(key, opts) {
    return schemaColumn(NODE_FIELDS, key, 'node', Object.assign({ plain: true, sort: 'text',
        set: (target, value) => { if (isBlank(value)) delete target[key]; else target[key] = value; },
        show: (row) => shown(row.data[key]) }, opts));
}
// A status by its key or its name in the page's language; blank is unset.
function tvStatusParse(text) {
    const v = String(text == null ? '' : text).trim().toLowerCase();
    if (!v || v === '—') return { value: undefined };
    const key = asStatus(v) || Object.keys(STATUS_NAMES).find((k) => statusName(k).toLowerCase() === v);
    return key ? { value: key } : { error: true };
}
// A cable's own facts (CABLE_FIELDS, js/model.js), kept in link.cable.
function cableColumn(key, opts) {
    return schemaColumn(CABLE_FIELDS, key, 'link', Object.assign({ key: `cable:${key}`, plain: true, sort: 'text',
        get: (target) => cableOf(target, key),
        set: (target, value) => { setCableField(target, key, value); },
        show: (row) => shown(row.data[key]) }, opts));
}

// A port's own facts (node.portAttrs, js/model.js). The record a port row's
// edit lands on is { node, portId } (findTarget), and these read and write
// through the model's helpers, so an emptied label is no entry at all.
function portColumn(key, opts) {
    return Object.assign({ key: `port:${key}`, rec: 'port', editor: 'text', sort: 'text', same,
        get: (target) => { const v = portAttrOf(target.node, target.portId)[key]; return v === null ? '' : v; },
        set: (target, value) => { setPortAttr(target.node, target.portId, key, value); },
        show: (row) => shown(row.data[key] === null ? '' : row.data[key]) }, opts);
}

const TV_COLS = {
    devices: [
        schemaColumn(NODE_FIELDS, 'name', 'node', { plain: true, sort: 'text' }),
        schemaColumn(NODE_FIELDS, 'type', 'node', { plain: true, sort: 'text', show: (row) => shown(row.data.typeName) }),
        { key: 'ifaces', label: 'Interfaces', rec: 'node', editor: null, mono: true, sort: 'ip',
          show: (row) => {
              const ips = row.data.interfaces.map((i) => i.ip).filter(Boolean);
              return ips.length ? shown(ips.length > 2 ? `${ips.slice(0, 2).join(', ')} +${ips.length - 2}` : ips.join(', '), { title: ips.join('\n') })
                  : shown(row.data.ports ? `${row.data.ports.used}/${row.data.ports.total}` : '', { muted: true });
          } },
        schemaColumn(NODE_FIELDS, 'gw', 'node', { mono: true, sort: 'ip', show: (row) => inheritedCell(row, 'gw', 'gw') }),
        schemaColumn(NODE_FIELDS, 'dns', 'node', { mono: true, sort: 'ip', show: (row) => inheritedCell(row, 'dns', 'dns') }),
        schemaColumn(NODE_FIELDS, 'os', 'node', { sort: 'text' }),
        assetColumn('assetTag', { mono: true }),
        assetColumn('serial', { mono: true }),
        assetColumn('location'),
        assetColumn('status', { editor: 'select', parse: tvStatusParse,
            options: () => [{ value: '', label: '—' }].concat(STATUS_VALUES.map((k) => ({ value: k, label: statusName(k) }))),
            get: (target) => target.status || '',
            edit: (row) => row.data.status || '',
            show: (row) => shown(statusName(row.data.status), row.data.status === 'retired' ? { muted: true } : {}) }),
        schemaColumn(NODE_FIELDS, 'ports', 'node', { mono: true, sort: 'text', show: (row) => shown(row.data.allowedPorts) }),
        // Only a routing device does NAT (the sidebar shows the switch only
        // there), so the cell is a dash anywhere else.
        schemaColumn(NODE_FIELDS, 'nat', 'node', { label: 'NAT', editor: 'bool', sort: 'text', parse: tvBoolParse,
            can: (row) => { const n = getNode(row.ref.nodeId); return !!n && isRoutingDevice(n.type); },
            get: (target) => !!target.nat, set: (target, v) => { target.nat = !!v; }, same: (a, b) => !!a === !!b,
            show: (row) => { const n = getNode(row.ref.nodeId); return n && isRoutingDevice(n.type) ? shown(row.data.nat ? '✓' : '') : shown('—', { muted: true }); } }),
        schemaColumn(NODE_FIELDS, 'notes', 'node', { plain: true, editor: 'textarea', sort: 'text', wide: true,
            // Kept as typed, line breaks and all; only blank space is nothing.
            parse: (text) => ({ value: String(text == null ? '' : text).trim() ? String(text) : '' }),
            show: (row) => shown(oneLine(row.data.notes), { title: row.data.notes }) }),
        { key: 'severity', label: 'Findings', plain: true, rec: 'node', editor: null, sort: 'sev',
          show: (row) => (row.data.severity ? shown(t(SEV_WORD[row.data.severity]), { sev: row.data.severity }) : shown('')) }
    ],
    interfaces: [
        { key: 'device', label: 'Device', plain: true, rec: 'node', editor: null, sort: 'text', show: (row) => shown(row.device.name) },
        schemaColumn(IFACE_FIELDS, 'name', 'iface', { sort: 'text' }),
        schemaColumn(IFACE_FIELDS, 'ip', 'iface', { mono: true, sort: 'ip' }),
        schemaColumn(IFACE_FIELDS, 'mac', 'iface', { mono: true, sort: 'text',
            // Kept in one canonical form, as the sidebar does when its field is
            // left: AA:BB:CC:DD:EE:FF, whatever was pasted.
            parse: (text) => { const r = tvTextParse(tvField(IFACE_FIELDS, 'mac'))(text); return r.error || !r.value ? r : { value: fmtColonSafe(r.value) }; },
            show: (row) => macCell(row) }),
        { key: 'vendor', label: 'Vendor', rec: 'iface', editor: null, sort: 'text', show: (row) => shown(row.data.vendor) },
        schemaColumn(IFACE_FIELDS, 'wireless', 'iface', { sort: 'text', show: (row) => shown(row.data.wireless ? '✓' : '') }),
        { key: 'cable', label: 'Cable', plain: true, rec: 'iface', editor: null, sort: 'text', show: (row) => cableCell(row) },
        { key: 'subnet', label: 'Subnet', rec: 'iface', editor: null, mono: true, sort: 'ip', show: (row) => subnetCell(row) }
    ],
    cables: [
        schemaColumn(LINK_FIELDS, 'source', 'link', { label: 'From', plain: true, sort: 'text', show: (row) => shown(row.data.from) }),
        schemaColumn(LINK_FIELDS, 'sourceIface', 'link', { mono: true, sort: 'text', show: (row) => shown(row.data.fromIface) }),
        schemaColumn(LINK_FIELDS, 'target', 'link', { label: 'To', plain: true, sort: 'text', show: (row) => shown(row.data.to) }),
        schemaColumn(LINK_FIELDS, 'targetIface', 'link', { mono: true, sort: 'text', show: (row) => shown(row.data.toIface) }),
        schemaColumn(LINK_FIELDS, 'medium', 'link', { editor: 'select', sort: 'text', parse: tvMediumParse,
            options: () => Object.keys(FLOW_CLASS).map((k) => ({ value: k, label: MEDIUM_NAMES[k] || k })),
            // Compared as drawn: picking the medium a cable is already drawn
            // in is not an edit, even when the document never said it.
            get: (target) => effectiveMedium(target),
            edit: (row) => row.data.mediumKey,
            show: (row) => shown(row.data.medium) }),
        cableColumn('label', { mono: true }),
        cableColumn('length'),
        cableColumn('color'),
        cableColumn('via', { mono: true })
    ],
    // Ports, Port and VLAN stay English (technical vocabulary); Device,
    // Label, Connected to and Cable are plain words.
    ports: [
        { key: 'device', label: 'Device', plain: true, rec: 'port', editor: null, sort: 'text', show: (row) => shown(row.data.device) },
        { key: 'port', label: 'Port', rec: 'port', editor: null, mono: true, sort: 'port',
          show: (row) => shown(row.data.port, row.data.over ? { bad: true, title: t('Past the {total}-port faceplate', { total: portCountOf(getNode(row.ref.nodeId)) }) } : {}) },
        portColumn('label', { label: 'Label', plain: true,
            parse: (text) => { const v = String(text == null ? '' : text).trim(); return fieldOk.tag(v) ? { value: v } : { error: true }; } }),
        portColumn('vlan', { label: 'VLAN', mono: true, sort: 'num',
            parse: (text) => { const v = String(text == null ? '' : text).trim(); if (!v) return { value: undefined }; const n = asVlan(v); return n === undefined ? { error: true } : { value: n }; } }),
        { key: 'peer', label: 'Connected to', plain: true, rec: 'port', editor: null, sort: 'text',
          show: (row) => (row.data.peer ? shown(`${row.data.peer} · ${row.data.peerIface}`) : shown(t('Free'), { muted: true })) },
        { key: 'cable', label: 'Cable', plain: true, rec: 'port', editor: null, mono: true, sort: 'text', show: (row) => shown(row.data.cable) }
    ],
    subnets: [
        schemaColumn(NETWORK_FIELDS, 'cidr', 'net', { mono: true, sort: 'ip', show: (row) => shown(row.data.network, row.data.declared ? {} : { muted: true, title: t('Not declared: implied by the addresses') }) }),
        schemaColumn(NETWORK_FIELDS, 'name', 'net', { plain: true, sort: 'text' }),
        schemaColumn(NETWORK_FIELDS, 'vlan', 'net', { mono: true, sort: 'num',
            parse: (text) => { const v = String(text == null ? '' : text).trim(); if (!v) return { value: undefined }; const n = asVlan(v); return n === undefined ? { error: true } : { value: n }; },
            show: (row) => shown(row.data.vlan == null ? '' : row.data.vlan) }),
        schemaColumn(NETWORK_FIELDS, 'purpose', 'net', { plain: true, sort: 'text' }),
        schemaColumn(NETWORK_FIELDS, 'gateway', 'net', { mono: true, sort: 'ip' }),
        schemaColumn(NETWORK_FIELDS, 'dns', 'net', { mono: true, sort: 'ip' }),
        schemaColumn(NETWORK_FIELDS, 'dhcp', 'net', { editor: 'bool', sort: 'text', parse: tvBoolParse,
            get: (target) => !!target.dhcp, set: (target, v) => { target.dhcp = v ? true : undefined; }, same: (a, b) => !!a === !!b,
            show: (row) => shown(row.data.dhcp ? '✓' : '') }),
        { key: 'members', label: 'Devices', plain: true, rec: 'net', editor: null, sort: 'num', mono: true,
          show: (row) => shown(row.data.devices.length, { title: row.data.devices.join(', ') }) },
        // An undeclared subnet is one Enter (or click) from being a network.
        { key: 'declare', label: '', rec: 'net', editor: null, action: true,
          show: (row) => (row.data.declared ? shown('') : shown(t('Declare'), { action: 'declare' })) }
    ]
};
// Only a declared network has a record to edit.
TV_COLS.subnets.forEach((c) => { if (c.editor && !c.can) c.can = (row) => !!row.ref.netId; });

// The interface rows that open beneath a device: the same columns as the
// Interfaces tab, laid under the device's (name under Name, the address under
// Type and Interfaces, the MAC under Gateway and DNS).
const TV_SUB_COLS = [
    Object.assign({}, TV_COLS.interfaces[1], { key: 'if:name', span: 1 }),
    Object.assign({}, TV_COLS.interfaces[2], { key: 'if:ip', span: 2 }),
    Object.assign({}, TV_COLS.interfaces[3], { key: 'if:mac', span: 2 }),
    { key: 'if:info', label: 'Cable', plain: true, rec: 'iface', editor: null, span: 0,
      show: (row) => { const c = cableCell(row); const v = row.data.vendor; return shown([v, c.text].filter(Boolean).join(' · '), { muted: true }); } }
];

function macCell(row) {
    const iface = findTarget('iface', row.ref);
    const raw = iface && !isBlank(iface.mac) ? iface.mac.trim() : '';
    // The report shows only a MAC that decodes; a broken one is still data,
    // and hiding it is how a register starts lying about itself.
    if (raw && !row.data.mac) return shown(raw, { bad: true });
    return shown(row.data.mac);
}
function cableCell(row) {
    const link = linkOnIface(row.ref.nodeId, row.ref.ifaceId);
    if (!link) return shown('');
    const peerId = link.source === row.ref.nodeId ? link.target : link.source;
    const peer = getNode(peerId);
    return peer ? shown(`${peer.name || peer.id} · ${ifaceLabel(peer, ifaceIdOn(link, peerId))}`) : shown('');
}
function subnetCell(row) {
    const p = row.data.ip ? parseValidCIDR(row.data.ip) : null;
    if (!p) return shown('');
    const net = networkOfIp(p.ip);
    return net ? shown(networkLabel(net)) : shown(p.networkStr, { muted: true, title: t('Not declared: implied by the addresses') });
}

const colsOf = (row) => (row.sub ? TV_SUB_COLS : TV_COLS[_tv.tab]);
const colByKey = (row, key) => colsOf(row).find((c) => c.key === key) || null;
const canEdit = (row, col) => !!(row && col && col.editor && (!col.can || col.can(row)));

// ---- Rows ----
// The record a row is about, in the live document or in a scratch copy of it
// (the paste preview runs its writes on one).
function findTarget(rec, ref, doc = state) {
    if (rec === 'node' || rec === 'iface') {
        const node = (doc.nodes || []).find((n) => n.id === ref.nodeId);
        if (rec === 'node' || !node) return node || null;
        return (node.interfaces || []).find((i) => i.id === ref.ifaceId) || null;
    }
    if (rec === 'link') return (doc.links || []).find((l) => l.id === ref.linkId) || null;
    // A port is not a record of its own: its facts live on its switch.
    if (rec === 'port') {
        const node = (doc.nodes || []).find((n) => n.id === ref.nodeId);
        return node && hasPortGrid(node) ? { node, portId: ref.portId } : null;
    }
    if (rec === 'net') return ref.netId ? (doc.networks || []).find((n) => n.id === ref.netId) || null : null;
    return null;
}

function tvBuildRows(tab) {
    if (tab === 'devices') return reportDevices().map((d) => ({ key: `n:${d.id}`, rec: 'node', ref: { nodeId: d.id }, data: d }));
    if (tab === 'interfaces') {
        const out = [];
        reportDevices().forEach((d) => d.interfaces.forEach((i) => out.push({ key: `i:${d.id}:${i.id}`, rec: 'iface', ref: { nodeId: d.id, ifaceId: i.id }, data: i, device: d })));
        return out;
    }
    if (tab === 'cables') return reportConnections().map((c) => ({ key: `l:${c.id}`, rec: 'link', ref: { linkId: c.id }, data: c }));
    if (tab === 'ports') return reportPorts().map((p) => ({ key: `p:${p.nodeId}:${p.portId}`, rec: 'port', ref: { nodeId: p.nodeId, portId: p.portId }, data: p }));
    return reportSubnets().map((s) => ({ key: `s:${s.network}`, rec: 'net', ref: { netId: s.id }, data: s }));
}

// Sorting: numbers as numbers, addresses as addresses (10.0.0.9 before
// 10.0.0.10), blanks last whichever way.
function ipSortKey(text) {
    const first = String(text || '').split(/[,\s]/)[0].split('/')[0];
    const ip = parseIpText(first);
    if (!ip) return null;
    return { kind: ip.kind() === 'ipv4' ? 0 : 1, n: ipToBig(ip) };
}
const SEV_RANK = { bad: 2, warn: 1 };
function compareRows(col, a, b) {
    if (col.sort === 'sev') return (SEV_RANK[a.data.severity] || 0) - (SEV_RANK[b.data.severity] || 0);
    const va = col.show(a).text, vb = col.show(b).text;
    if (!va || !vb) return !va && !vb ? 0 : (!va ? 1 : -1) * _tvSortDir;
    if (col.sort === 'ip') {
        const x = ipSortKey(va), y = ipSortKey(vb);
        if (x && y) return x.kind - y.kind || (x.n < y.n ? -1 : x.n > y.n ? 1 : 0);
        if (x || y) return x ? -1 : 1;
    }
    if (col.sort === 'num') return Number(va) - Number(vb);
    // By the switch, then by position: Gi1/0/2 before Gi1/0/10, and a
    // scheme counted from 0 sorts as the faceplate does.
    if (col.sort === 'port') return a.data.device.localeCompare(b.data.device, undefined, { numeric: true, sensitivity: 'base' }) || a.data.number - b.data.number;
    return va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
}
let _tvSortDir = 1;   // so a blank stays last when the order is reversed

function tvSortedRows(tab) {
    const rows = tvBuildRows(tab);
    const s = _tv.sort[tab];
    const col = s && TV_COLS[tab].find((c) => c.key === s.col);
    if (col) {
        _tvSortDir = s.dir;
        rows.forEach((r, i) => { r.seq = i; });
        rows.sort((a, b) => (compareRows(col, a, b) * s.dir) || (a.seq - b.seq));
    }
    if (tab !== 'devices') return rows;
    // A device's interfaces follow it, whatever the order.
    const out = [];
    rows.forEach((r) => {
        out.push(r);
        if (!_tv.expanded.has(r.ref.nodeId)) return;
        r.data.interfaces.forEach((i) => out.push({ key: `d:${r.ref.nodeId}:${i.id}`, sub: true, rec: 'iface', ref: { nodeId: r.ref.nodeId, ifaceId: i.id }, data: i, device: r.data }));
    });
    return out;
}

const rowByKey = (key) => _tv.rows.find((r) => r.key === key) || null;
function rowChecked(row) {
    if (row.sub) return false;
    if (row.rec === 'node') return inSelection('node', row.ref.nodeId);
    if (row.rec === 'link') return inSelection('link', row.ref.linkId);
    return !!(_tv.checked[_tv.tab] && _tv.checked[_tv.tab].has(row.key));
}
// The selected device's own interface rows are marked too, more quietly.
const rowOn = (row) => row.rec === 'iface' && inSelection('node', row.ref.nodeId);
function rowName(row) {
    if (row.rec === 'node') return row.data.name;
    if (row.rec === 'iface') return `${row.device.name} / ${row.data.name}`;
    if (row.rec === 'link') return `${row.data.from} ↔ ${row.data.to}`;
    if (row.rec === 'port') return `${row.data.device} / ${row.data.port}`;
    return row.data.network;
}

// ---- Drawing ----
function renderTableView(force) {
    const view = tvEl();
    if (!view) return;
    if (!tableShown()) { _tv.dirty = true; return; }
    if (_tv.editor || _tv.pointerDown) {
        if (!force) { _tv.dirty = true; return; }
        cancelEdit(true);
    }
    _tv.dirty = false;
    const hadFocus = _tv.keepFocus || view.contains(document.activeElement);
    _tv.keepFocus = false;

    document.querySelectorAll('#tableView [data-tvtab]').forEach((b) => {
        const on = b.dataset.tvtab === _tv.tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });

    const tab = _tv.tab;
    // The search box (js/query.js) narrows the rows: a device's interfaces
    // folded open beneath it stay with it. The rows on screen are the ones
    // everything else here works on (tick all, paste a column, the cursor),
    // so a paste down a column runs through the matches only.
    const query = typeof activeQuery === 'function' ? activeQuery() : null;
    let total = 0, all = [];
    const rows = withLookupPass(() => {
        all = tvSortedRows(tab);
        total = all.filter((r) => !r.sub).length;
        if (!query) return all;
        const kept = new Set();
        return all.filter((r) => {
            if (r.sub) return kept.has(r.ref.nodeId);
            if (!queryKeepsRow(r, query)) return false;
            if (r.rec === 'node') kept.add(r.ref.nodeId);
            return true;
        });
    });
    _tv.rows = rows;
    _tv.total = total;
    // What the last document held and this one does not is let go: this
    // tab's ticks only, checked against every row the tab has, not just the
    // ones the search leaves on screen. A tick the search hides comes back
    // when the search is cleared, as a selected device does; nothing acts on
    // it meanwhile, because everything here works on the rows shown. (The
    // other tabs' ticks are pruned when those tabs are drawn: their keys are
    // never in this tab's rows.)
    const alive = new Set(all.map((r) => r.key));
    const tabTicks = _tv.checked[tab];
    if (tabTicks) [...tabTicks].forEach((k) => { if (!alive.has(k)) tabTicks.delete(k); });
    [..._tv.expanded].forEach((id) => { if (!getNode(id)) _tv.expanded.delete(id); });

    const cols = TV_COLS[tab];
    const top = rows.filter((r) => !r.sub);
    const ticked = top.filter(rowChecked).length;
    const sort = _tv.sort[tab];
    const head = `<thead><tr>
        <th class="tv-chk"><input type="checkbox" data-check-all tabindex="-1"${top.length && ticked === top.length ? ' checked' : ''}
            aria-label="${escapeHtml(t('Select every row'))}" title="${escapeHtml(t('Select every row'))}"></th>
        ${tab === 'devices' ? '<th class="tv-exp" aria-hidden="true"></th>' : ''}
        ${cols.map((c) => {
            const dir = sort && sort.col === c.key ? sort.dir : 0;
            const label = escapeHtml(tvLabel(c));
            return `<th data-col="${c.key}"${dir ? ` aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c.sort
                ? `<button type="button" class="tv-sort" data-sort="${c.key}" tabindex="-1">${label}<span class="tv-arrow" aria-hidden="true">${dir > 0 ? '▲' : dir < 0 ? '▼' : ''}</span></button>`
                : label}</th>`;
        }).join('')}
    </tr></thead>`;

    const cell = (row, c) => {
        const v = c.show(row);
        const cls = ['tv-cell', c.mono ? 'mono' : '', c.wide ? 'tv-wide' : '', canEdit(row, c) ? 'tv-edit' : '',
            v.muted ? 'tv-muted' : '', v.bad ? 'tv-bad' : '', v.sev ? `tv-sev ${v.sev}` : ''].filter(Boolean).join(' ');
        const span = c.span === 0 ? ` colspan="${Math.max(1, cols.length - 5)}"` : c.span > 1 ? ` colspan="${c.span}"` : '';
        const cap = row.sub ? ` data-cap="${escapeHtml(tvLabel(c))}"` : '';
        const title = v.title ? ` title="${escapeHtml(v.title)}"` : (v.text.length > 24 ? ` title="${escapeHtml(v.text)}"` : '');
        const body = v.action ? `<span class="tv-action" data-act="${v.action}">${escapeHtml(v.text)}</span>` : escapeHtml(v.text);
        return `<td data-col="${c.key}" tabindex="-1" class="${cls}"${span}${cap}${title}>${body}</td>`;
    };
    const body = rows.map((row) => {
        if (row.sub) {
            return `<tr data-row="${escapeHtml(row.key)}" class="tv-sub${rowOn(row) ? ' tv-on' : ''}">
                <td class="tv-chk"></td><td class="tv-exp tv-muted" aria-hidden="true">↳</td>
                ${TV_SUB_COLS.map((c) => cell(row, c)).join('')}</tr>`;
        }
        const on = rowChecked(row);
        const n = row.rec === 'node' ? row.data.interfaces.length : 0;
        const open = row.rec === 'node' && _tv.expanded.has(row.ref.nodeId);
        return `<tr data-row="${escapeHtml(row.key)}" class="${on ? 'tv-sel' : ''}${rowOn(row) ? ' tv-on' : ''}" aria-selected="${on}">
            <td class="tv-chk"><input type="checkbox" data-check tabindex="-1"${on ? ' checked' : ''} aria-label="${escapeHtml(rowName(row))}"></td>
            ${tab === 'devices' ? `<td class="tv-exp">${n ? `<button type="button" class="tv-twist" data-expand tabindex="-1" aria-expanded="${open}"
                title="${escapeHtml(t(open ? 'Hide interfaces' : 'Show interfaces'))}">${open ? '▾' : '▸'}</button>` : ''}</td>` : ''}
            ${cols.map((c) => cell(row, c)).join('')}</tr>`;
    }).join('');

    const scroller = document.getElementById('tvScroll');
    const sx = scroller.scrollLeft, sy = scroller.scrollTop;
    document.getElementById('tvGrid').innerHTML = head + `<tbody>${body}</tbody>`;
    const empty = document.getElementById('tvEmpty');
    empty.classList.toggle('hidden', rows.length > 0);
    empty.textContent = query && total ? t('No rows match the search.') : t('Nothing here yet.');
    scroller.scrollLeft = sx; scroller.scrollTop = sy;
    // "Rows: 7", not "7 rows": a label and a number need no plural forms.
    document.getElementById('tvCount').textContent = ticked
        ? `${t('Rows: {n}', { n: top.length })} · ${t('Selected: {n}', { n: ticked })}` : t('Rows: {n}', { n: top.length });
    document.getElementById('tvPasteBtn').disabled = !rows.length || !!state.readOnly;

    placeCursor(hadFocus);
    if (typeof updateQueryBar === 'function') updateQueryBar();
}

// The cursor is a (row, column) pair, so it survives a rebuild, a sort and an
// undo; when its row is gone it falls back to the first cell. Until the user
// has put it somewhere it follows the selection (a device picked on the map),
// so the cell a paste starts from is the row that shows as selected.
function cursorCell() {
    const grid = document.getElementById('tvGrid');
    if (!grid || !_tv.cursor.row) return null;
    const tr = [...grid.querySelectorAll('tbody tr[data-row]')].find((r) => r.dataset.row === _tv.cursor.row);
    if (!tr) return null;
    return [...tr.querySelectorAll('td[data-col]')].find((td) => td.dataset.col === _tv.cursor.col) || tr.querySelector('td[data-col]');
}
function placeCursor(focus) {
    const grid = document.getElementById('tvGrid');
    grid.querySelectorAll('td[tabindex="0"]').forEach((td) => td.setAttribute('tabindex', '-1'));
    if (_tv.followSelection) {
        _tv.followSelection = false;
        const cur = rowByKey(_tv.cursor.row);
        if (!(cur && rowChecked(cur)) && _tv.rows.some((r) => !r.sub && rowChecked(r))) _tv.cursorChosen = false;
    }
    if (!_tv.cursorChosen) {
        const sel = _tv.rows.find((r) => !r.sub && rowChecked(r));
        if (sel && sel.key !== _tv.cursor.row) _tv.cursor = { row: sel.key, col: _tv.cursor.col };
    }
    let td = cursorCell();
    if (!td) {
        td = grid.querySelector('tbody td[data-col]');
        _tv.cursor = td ? { row: td.parentElement.dataset.row, col: td.dataset.col } : { row: null, col: null };
        _tv.cursorChosen = false;
    }
    if (!td) return;
    td.setAttribute('tabindex', '0');
    td.classList.add('tv-cur');
    if (focus) { td.focus({ preventScroll: true }); scrollCellIntoView(td); }
}
function scrollCellIntoView(td) {
    if (td.scrollIntoView) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function setCursor(rowKey, colKey, focus) {
    _tv.cursor = { row: rowKey, col: colKey };
    _tv.cursorChosen = true;
    const grid = document.getElementById('tvGrid');
    grid.querySelectorAll('td.tv-cur').forEach((td) => td.classList.remove('tv-cur'));
    placeCursor(focus);
}

// ---- Moving ----
// Rows are not all the same shape (an interface row under a device has its
// own cells, an address spanning two of the device's columns), so a move up
// or down keeps the column where the next row has it and otherwise lands on
// the cell drawn under it. After an edit (`editable`) it lands on the nearest
// cell that can be typed into instead: Enter is how a column gets filled in,
// and stopping on a read-only Type cell would end that for no reason.
function gridSpan(td) {
    let at = 0;
    for (const c of td.parentElement.querySelectorAll('td')) {
        if (c === td) return [at, at + (c.colSpan || 1)];
        at += c.colSpan || 1;
    }
    return [at, at + 1];
}
function moveFrom(td, dir, editable) {
    const tr = td.parentElement;
    const cells = [...tr.querySelectorAll('td[data-col]')];
    const at = cells.indexOf(td);
    const rowsEls = [...tr.parentElement.querySelectorAll('tr[data-row]')];
    const r = rowsEls.indexOf(tr);
    const pick = (row, col) => {
        const list = [...row.querySelectorAll('td[data-col]')];
        const same = list.find((c) => c.dataset.col === col);
        if (same) return same;
        const [a, b] = gridSpan(td);
        const mid = (a + b) / 2;
        const under = list.find((c) => { const [x, y] = gridSpan(c); return x < b && y > a; }) || list[list.length - 1];
        if (!editable || under.classList.contains('tv-edit')) return under;
        let best = null, gap = Infinity;
        list.filter((c) => c.classList.contains('tv-edit')).forEach((c) => {
            const [x, y] = gridSpan(c);
            const d = Math.abs((x + y) / 2 - mid);
            if (d < gap) { gap = d; best = c; }
        });
        return best || under;
    };
    if (dir === 'left') return cells[at - 1] || null;
    if (dir === 'right') return cells[at + 1] || null;
    if (dir === 'home') return cells[0];
    if (dir === 'end') return cells[cells.length - 1];
    if (dir === 'next') return cells[at + 1] || (rowsEls[r + 1] && rowsEls[r + 1].querySelector('td[data-col]')) || null;
    if (dir === 'prev') {
        if (cells[at - 1]) return cells[at - 1];
        const up = rowsEls[r - 1];
        if (!up) return null;
        const list = up.querySelectorAll('td[data-col]');
        return list[list.length - 1];
    }
    const step = { up: -1, down: 1, pgup: -10, pgdn: 10 }[dir];
    if (!step) return null;
    const to = rowsEls[Math.max(0, Math.min(rowsEls.length - 1, r + step))];
    return to && to !== tr ? pick(to, td.dataset.col) : null;
}
function goTo(td) {
    if (!td) return false;
    setCursor(td.parentElement.dataset.row, td.dataset.col, true);
    return true;
}

// ---- Editing ----
function startEdit(td, seed) {
    const tr = td && td.parentElement;
    const row = tr && rowByKey(tr.dataset.row);
    const col = row && colByKey(row, td.dataset.col);
    if (!canEdit(row, col)) return false;
    if (readOnlyRefuses()) return false;
    setCursor(row.key, col.key);
    if (col.editor === 'bool') {
        // A tick has two values: Enter, Space or a click flips it, in one step.
        const target = findTarget(col.rec, row.ref);
        if (target) commitValue(row, col, !col.get(target), true);
        return true;
    }
    const el = document.createElement(col.editor === 'select' ? 'select' : col.editor === 'textarea' ? 'textarea' : 'input');
    el.className = `tv-in${col.mono ? ' mono' : ''}`;
    if (col.editor === 'select') {
        el.innerHTML = col.options().map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    } else {
        el.setAttribute('autocomplete', 'off'); el.setAttribute('spellcheck', 'false');
        if (col.editor === 'textarea') el.rows = 1; else el.type = 'text';
    }
    const target = findTarget(col.rec, row.ref);
    const current = col.edit ? col.edit(row) : (target && col.get(target) != null ? String(col.get(target)) : '');
    el.value = seed !== undefined ? seed : current;
    el.setAttribute('aria-label', tvLabel(col));
    td.classList.add('tv-editing');
    td.textContent = '';
    td.appendChild(el);
    _tv.editor = { el, td, rowKey: row.key, colKey: col.key, done: false };
    el.addEventListener('blur', () => finishEdit('blur'));
    el.focus();
    if (seed === undefined && el.select) el.select();
    else if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length);
    return true;
}

// Leaves the cell as it was. `quiet`: a rebuild is about to redraw it anyway.
function cancelEdit(quiet) {
    const ed = _tv.editor;
    if (!ed) return;
    ed.done = true;
    _tv.editor = null;
    if (quiet) return;
    const td = ed.td;
    if (td.isConnected) {
        _tv.keepFocus = true;
        renderTableView(true);
    }
}

const tvInvalid = (col, text) => t('{value} is not a valid {field}.', { value: String(text).trim() || '—', field: tvLabel(col) });

// how: 'enter' | 'tab' | 'blur' | 'arrow'. move: where the cursor goes after.
function finishEdit(how, move) {
    const ed = _tv.editor;
    if (!ed || ed.done) return true;
    const row = rowByKey(ed.rowKey);
    const col = row && colByKey(row, ed.colKey);
    if (!row || !col) { cancelEdit(); return true; }
    const text = ed.el.value;
    const res = col.parse(text, row);
    if (res.error) {
        if (how !== 'blur') {
            // Stays open, marked, so the value can be corrected.
            ed.el.classList.add('bad');
            ed.el.title = tvInvalid(col, text);
            showToast(tvInvalid(col, text));
            return false;
        }
        // The focus has gone somewhere else: the value is not kept, and that
        // is said rather than left to be discovered.
        showToast(`${tvInvalid(col, text)} ${t('Nothing was changed.')}`);
        ed.done = true; _tv.editor = null;
        renderTableView();
        return false;
    }
    ed.done = true; _tv.editor = null;
    if (move) { const next = moveFrom(ed.td, move, true); if (next) { _tv.cursor = { row: next.parentElement.dataset.row, col: next.dataset.col }; _tv.cursorChosen = true; } }
    _tv.keepFocus = how !== 'blur';
    // A committed edit has redrawn the table already (renderCanvasOnly);
    // an unchanged one still has to put the cell back.
    if (!commitValue(row, col, res.value)) renderTableView(how !== 'blur');
    return true;
}

// One edit, one transaction: written to the record through the column's
// setter (the value has passed the schema's validator), saved once, drawn
// once. A value equal to what is there already is not an edit at all and
// costs no undo step.
function commitValue(row, col, value, keepFocus) {
    if (readOnlyRefuses()) return false;
    const target = findTarget(col.rec, row.ref);
    if (!target || col.same(col.get(target), value)) { if (keepFocus) { _tv.keepFocus = true; renderTableView(true); } return false; }
    if (keepFocus) _tv.keepFocus = true;
    batch(() => { col.set(target, value); save(); afterTableEdit(); });
    return true;
}

// What else shows the record: the map, the rail's editor for the one thing
// selected (its fields are filled when it is drawn), the device's own
// diagnostics and the Subnets tab. Called inside the edit's batch(), so the
// map and this table are drawn once however many of these ask.
function afterTableEdit() {
    renderCanvasOnly();
    if (state.selection.size === 1) renderSelection();
    else refreshSelectedNodeDiagnostics();
    renderNetworksPanel();
}

// ---- Selecting ----
// A row is the thing on the map: clicking one selects it there and centres
// the map on it, as a finding in the Findings tab does.
function focusRow(row) {
    if (!row) return;
    if (row.rec === 'node' || row.rec === 'iface') { focusOnMap({ type: 'node', id: row.ref.nodeId }); return; }
    if (row.rec === 'link') { focusOnMap({ type: 'link', id: row.ref.linkId }); return; }
    // A port: the cable in it, else its switch.
    if (row.rec === 'port') { focusOnMap(row.data.linkId ? { type: 'link', id: row.data.linkId } : { type: 'node', id: row.ref.nodeId }); return; }
    if (row.ref.netId) { selectNetworkMembers(row.ref.netId); return; }
    const nodes = row.data.nodeIds.map(getNode).filter(Boolean);
    selectEntries(nodes.map((n) => ({ type: 'node', id: n.id })));
    centreOnNodes(nodes);
}

// The tick box, with shift for a range. Devices and cables are ticked in the
// selection set itself, so the map, the rail and the table agree on what is
// selected; interfaces and subnets are ticked here.
function checkRows(rows, on) {
    if (_tv.tab === 'devices' || _tv.tab === 'cables') {
        const type = _tv.tab === 'devices' ? 'node' : 'link';
        const idOf = (r) => (type === 'node' ? r.ref.nodeId : r.ref.linkId);
        const keep = [...state.selection].filter((e) => !(e.type === type && rows.some((r) => idOf(r) === e.id)));
        selectEntries(on ? keep.concat(rows.map((r) => ({ type, id: idOf(r) }))) : keep);
        return;
    }
    const set = _tv.checked[_tv.tab];
    rows.forEach((r) => { if (on) set.add(r.key); else set.delete(r.key); });
    renderTableView();
}
function checkRow(row, on, range) {
    if (!row || row.sub) return;
    const top = _tv.rows.filter((r) => !r.sub);
    let rows = [row];
    if (range && _tv.anchor) {
        const a = top.findIndex((r) => r.key === _tv.anchor), b = top.indexOf(row);
        if (a >= 0 && b >= 0) rows = top.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
    _tv.anchor = row.key;
    checkRows(rows, on);
}

function toggleExpand(nodeId) {
    if (_tv.expanded.has(nodeId)) _tv.expanded.delete(nodeId); else _tv.expanded.add(nodeId);
    renderTableView(true);
}

async function declareFromRow(row) {
    if (!row || row.rec !== 'net' || row.ref.netId || readOnlyRefuses()) return;
    declareAndShow([row.data.network]);
}

// ---- Paste a column ----
// The rows a paste goes into: two or more ticked ones, in the order shown;
// otherwise the cursor's row and those below it. One ticked row is not a set:
// on Devices and Cables a click ticks the row it selects, so "the selected
// rows" would otherwise always be just the row clicked, and a pasted list
// would land in one cell on those tabs but run down the column on the other
// two. The start is the cursor's row, not the ticked one, because that is
// where a one-line paste goes too (the arrows move the cursor and leave the
// selection where it was); the cursor follows the selection until the user
// moves it, so a row picked on the map is still where the paste starts.
const pasteTicked = () => _tv.rows.filter((r) => !r.sub && rowChecked(r));
function pasteTargets() {
    const top = _tv.rows.filter((r) => !r.sub);
    const ticked = pasteTicked();
    if (ticked.length > 1) return { rows: ticked, mode: 'selected' };
    const cur = rowByKey(_tv.cursor.row) || ticked[0];
    const key = cur && cur.sub ? `n:${cur.ref.nodeId}` : (cur && cur.key);
    const at = Math.max(0, top.findIndex((r) => r.key === key));
    return { rows: top.slice(at), mode: 'down', from: top[at] || null };
}
const pasteColumns = (tab = _tv.tab) => TV_COLS[tab].filter((c) => c.editor);

// A pasted block: one value per line. A spreadsheet ends its copy with a line
// break and puts a tab between columns, so the last empty line is dropped and
// only the first column of a wider copy is read.
function pasteLines(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    return lines.length === 1 && lines[0] === '' ? [] : lines.map((l) => l.split('\t')[0]);
}

// Pure: what the paste would do, cell by cell, without doing it.
//   change  a valid value that differs from what is there
//   same    a valid value equal to what is there
//   bad     refused by the schema's validator (left as it is)
//   skip    a blank line, or a column this row does not have (NAT on a
//           switch, a subnet nobody declared): left as it is
function planPaste(colKey, text, targets = pasteTargets(), tab = _tv.tab) {
    const col = TV_COLS[tab].find((c) => c.key === colKey);
    const lines = pasteLines(text);
    const cells = [];
    let extra = 0;
    lines.forEach((line, i) => {
        const row = targets.rows[i];
        if (!row) { extra++; return; }
        const target = col && findTarget(col.rec, row.ref);
        const now = col ? col.show(row).text : '';
        if (!col || !line.trim() || !canEdit(row, col) || !target) { cells.push({ row, status: 'skip', now, text: line }); return; }
        const res = col.parse(line, row);
        if (res.error) { cells.push({ row, status: 'bad', now, text: line, why: tvInvalid(col, line) }); return; }
        cells.push({ row, status: col.same(col.get(target), res.value) ? 'same' : 'change', now, text: line, value: res.value });
    });
    const count = (s) => cells.filter((c) => c.status === s).length;
    return { tab, colKey, col, cells, extra, unfilled: targets.mode === 'selected' ? Math.max(0, targets.rows.length - lines.length) : 0,
        counts: { change: count('change'), same: count('same'), bad: count('bad'), skip: count('skip') } };
}

// The findings the change would leave, against the ones there now: the pure
// engine (diagnoseDoc, js/diagnostics.js) run on a scratch copy with the same
// writes applied. -> [{ key, check, diff }], biggest change first.
function pasteFindingsDelta(plan) {
    const changes = plan.cells.filter((c) => c.status === 'change');
    if (!changes.length) return [];
    const scratch = cloneData({ nodes: state.nodes, links: state.links, networks: state.networks });
    changes.forEach((c) => { const target = findTarget(plan.col.rec, c.row.ref, scratch); if (target) plan.col.set(target, c.value); });
    return findingsDelta(topologyFindings(), diagnoseDoc(scratch).findings);
}
// Open findings only: one accepted with a reason is not counted anywhere, so
// it is not a change either way.
function findingsDelta(before, after) {
    const tally = (list, sign, into) => list.filter(isOpenFinding).forEach((f) => {
        const e = into.get(f.key) || { key: f.key, check: f.check, diff: 0 };
        e.diff += sign; into.set(f.key, e);
    });
    const m = new Map();
    tally(before, -1, m); tally(after, 1, m);
    return [...m.values()].filter((e) => e.diff).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

// The delta as the paste preview and the bulk panel's preview (js/bulk.js)
// both say it: "+2 Duplicate IP · −24 Gateway". Nothing when nothing would
// change.
function findingsDeltaHtml(delta, changes) {
    if (!changes) return '';
    if (!delta.length) return escapeHtml(t('The findings stay the same.'));
    return `${escapeHtml(t('Findings after this change:'))} ${delta.map((e) => `<span class="paste-delta-${e.diff > 0 ? 'up' : 'down'}">${e.diff > 0 ? '+' : '−'}${Math.abs(e.diff)} ${escapeHtml(e.check)}</span>`).join(' · ')}`;
}

// The same, as plain text, for a question asked in words (the Renumber
// confirmation, js/networks.js).
function findingsDeltaText(delta) {
    if (!delta.length) return t('The findings stay the same.');
    return `${t('Findings after this change:')} ${delta.map((e) => `${e.diff > 0 ? '+' : '−'}${Math.abs(e.diff)} ${e.check}`).join(' · ')}`;
}

// One transaction however many cells: one undo step, one redraw.
function applyPastePlan(plan) {
    const changes = plan.cells.filter((c) => c.status === 'change');
    if (!changes.length || readOnlyRefuses()) return 0;
    batch(() => {
        changes.forEach((c) => { const target = findTarget(plan.col.rec, c.row.ref); if (target) plan.col.set(target, c.value); });
        save(); afterTableEdit();
    });
    showToast(t('Cells changed: {n}', { n: changes.length }), 'ok');
    return changes.length;
}

let _paste = null;   // { targets, plan, timer }
const pasteEl = (id) => document.getElementById(id);

function openPasteColumn(opts = {}) {
    if (!tableShown() || readOnlyRefuses()) return;
    const cols = pasteColumns();
    if (!cols.length || !_tv.rows.length) return;
    cancelEdit(true);
    const cur = rowByKey(_tv.cursor.row);
    const curCol = cur && !cur.sub ? cols.find((c) => c.key === _tv.cursor.col) : null;
    const select = pasteEl('pasteColumn');
    select.innerHTML = cols.map((c) => `<option value="${c.key}">${escapeHtml(tvLabel(c))}</option>`).join('');
    select.value = (opts.col && cols.some((c) => c.key === opts.col)) ? opts.col : (curCol ? curCol.key : cols[0].key);
    pasteEl('pasteText').value = opts.text || '';
    _paste = { targets: pasteTargets(), plan: null, timer: 0 };
    const tg = _paste.targets;
    pasteEl('pasteTarget').textContent = tg.mode === 'selected'
        ? `${t('Into the selected rows, in the order shown.')} ${t('Rows: {n}', { n: tg.rows.length })}`
        : t('Into the rows from {name} down, in the order shown.', { name: tg.from ? rowName(tg.from) : '—' });
    refreshPastePreview(true);
    const scrim = pasteEl('pasteDialog');
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onClose: () => { _paste = null; _tv.keepFocus = true; renderTableView(true); } });
    else scrim.hidden = false;
    if (!opts.text) pasteEl('pasteText').focus();
}
function closePasteColumn() {
    const scrim = pasteEl('pasteDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else { scrim.hidden = true; _paste = null; }
}

const PASTE_MARK = { change: '→', same: '=', bad: '✕', skip: '—' };
// The counts and the rows are redrawn on every keystroke; the findings, which
// diagnose a whole scratch document, a moment after typing stops.
function refreshPastePreview(now) {
    if (!_paste) return;
    const plan = _paste.plan = planPaste(pasteEl('pasteColumn').value, pasteEl('pasteText').value, _paste.targets);
    const c = plan.counts;
    const bits = [[t('To change'), c.change], [t('Unchanged'), c.same], [t('Not valid'), c.bad], [t('Left as they are'), c.skip + plan.unfilled]];
    if (plan.extra) bits.push([t('Lines with no row'), plan.extra]);
    pasteEl('pasteCounts').innerHTML = bits.map(([label, n]) => `<span class="paste-count${n ? '' : ' zero'}"><b class="mono">${n}</b> ${escapeHtml(label)}</span>`).join('');
    pasteEl('pastePreview').innerHTML = plan.cells.slice(0, 400).map((cell) => `<tr class="paste-${cell.status}">
            <td>${escapeHtml(rowName(cell.row))}</td>
            <td class="mono">${escapeHtml(cell.now)}</td>
            <td class="paste-mark" title="${escapeHtml(cell.why || '')}">${PASTE_MARK[cell.status]}</td>
            <td class="mono">${escapeHtml(cell.status === 'skip' ? '' : cell.text.trim())}</td>
        </tr>`).join('');
    pasteEl('pastePreviewWrap').classList.toggle('hidden', !plan.cells.length);
    pasteEl('pasteApplyBtn').disabled = !c.change;
    clearTimeout(_paste.timer);
    const delta = () => {
        if (!_paste || _paste.plan !== plan) return;
        pasteEl('pasteDelta').innerHTML = findingsDeltaHtml(pasteFindingsDelta(plan), c.change > 0);
    };
    if (now) delta(); else _paste.timer = setTimeout(delta, 200);
}

function applyPasteDialog() {
    if (!_paste) return;
    const plan = planPaste(pasteEl('pasteColumn').value, pasteEl('pasteText').value, _paste.targets);
    if (!plan.counts.change) return;
    closePasteColumn();
    applyPastePlan(plan);
}

// Ctrl+V on a cell. One line into one cell is an edit like any other; a
// column of them, or any paste over ticked rows, goes through the preview.
function onTablePaste(e) {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;   // a cell being edited takes it as text
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!text) return;
    e.preventDefault();
    const lines = pasteLines(text);
    const td = cursorCell();
    const row = td && rowByKey(td.parentElement.dataset.row);
    const col = row && colByKey(row, td.dataset.col);
    if (lines.length <= 1 && pasteTicked().length < 2) {
        if (!canEdit(row, col) || col.editor === 'bool' && !lines.length) return;
        if (readOnlyRefuses()) return;
        const res = col.parse(lines[0] || '', row);
        if (res.error) { showToast(tvInvalid(col, lines[0] || '')); return; }
        _tv.keepFocus = true;
        commitValue(row, col, res.value, true);
        return;
    }
    openPasteColumn({ col: col && !row.sub ? col.key : null, text });
}

// ---- Wiring ----
function onTableKey(e) {
    const ed = _tv.editor;
    if (ed && e.target === ed.el) {
        // Every key typed into the cell is the cell's; the map's shortcuts
        // never see it.
        e.stopPropagation();
        const k = e.key;
        if (k === 'Escape') { e.preventDefault(); cancelEdit(); return; }
        if (k === 'Enter' && !(ed.el.tagName === 'TEXTAREA' && e.shiftKey)) { e.preventDefault(); finishEdit('enter', e.shiftKey ? 'up' : 'down'); return; }
        if (k === 'Tab') { e.preventDefault(); finishEdit('tab', e.shiftKey ? 'prev' : 'next'); return; }
        if ((k === 'ArrowUp' || k === 'ArrowDown') && ed.el.tagName === 'INPUT') { e.preventDefault(); finishEdit('arrow', k === 'ArrowUp' ? 'up' : 'down'); }
        return;
    }
    const td = e.target.closest && e.target.closest('td[data-col]');
    if (!td || !tvEl().contains(td)) return;
    // Undo, redo, Ctrl+A and the browser's own combinations pass through.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const row = rowByKey(td.parentElement.dataset.row);
    const col = row && colByKey(row, td.dataset.col);
    const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end', PageUp: 'pgup', PageDown: 'pgdn' }[k];
    if (nav) { e.preventDefault(); e.stopPropagation(); goTo(moveFrom(td, nav)); return; }
    if (k === 'Tab') {
        // Off the last cell, Tab leaves the table like it leaves anything else.
        const next = moveFrom(td, e.shiftKey ? 'prev' : 'next');
        if (next) { e.preventDefault(); e.stopPropagation(); goTo(next); }
        return;
    }
    if (k === 'Escape') return;   // the map's Esc: deselect
    e.stopPropagation();
    if (k === 'Enter' || k === 'F2') {
        e.preventDefault();
        if (col && col.action && row && !row.data.declared) { declareFromRow(row); return; }
        if (!startEdit(td) && k === 'Enter') focusRow(row);
        return;
    }
    if (k === ' ') { e.preventDefault(); if (row && !row.sub) checkRow(row, !rowChecked(row), e.shiftKey); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (canEdit(row, col) && col.editor !== 'bool' && col.editor !== 'select') startEdit(td, ''); return; }
    // A typed character starts an edit with it, as a spreadsheet does.
    if (k.length === 1 && canEdit(row, col) && col.editor !== 'bool' && col.editor !== 'select') { e.preventDefault(); startEdit(td, k); }
}

function onTableClick(e) {
    const t0 = e.target;
    const tabBtn = t0.closest('[data-tvtab]');
    if (tabBtn) { showTableTab(tabBtn.dataset.tvtab); return; }
    const sortBtn = t0.closest('[data-sort]');
    if (sortBtn) {
        const key = sortBtn.dataset.sort, s = _tv.sort[_tv.tab];
        // Ascending, descending, then back to the document's own order.
        _tv.sort[_tv.tab] = !s || s.col !== key ? { col: key, dir: 1 } : s.dir === 1 ? { col: key, dir: -1 } : null;
        renderTableView(true);
        return;
    }
    if (t0.matches('input[data-check-all]')) {
        const top = _tv.rows.filter((r) => !r.sub);
        checkRows(top, !(top.length && top.every(rowChecked)));
        return;
    }
    const tr = t0.closest('tr[data-row]');
    const row = tr && rowByKey(tr.dataset.row);
    if (!row) return;
    if (t0.matches('input[data-check]')) { checkRow(row, t0.checked, e.shiftKey); return; }
    if (t0.closest('[data-expand]')) { toggleExpand(row.ref.nodeId); return; }
    const td = t0.closest('td[data-col]');
    if (!td || td.contains(_tv.editor && _tv.editor.el)) return;
    const col = colByKey(row, td.dataset.col);
    if (t0.closest('[data-act="declare"]')) { declareFromRow(row); return; }
    const again = _tv.downOnCursor;
    _tv.downOnCursor = false;
    setCursor(row.key, td.dataset.col, true);
    if (e.shiftKey || e.ctrlKey || e.metaKey) { if (!row.sub) checkRow(row, !rowChecked(row), e.shiftKey); return; }
    // A second click on the cell the cursor is already on edits it, which is
    // also how a phone, with no double click to speak of, gets into a cell.
    if (again && canEdit(row, col)) { startEdit(td); return; }
    focusRow(row);
}

(function wireTableView() {
    const view = tvEl();
    if (!view) return;
    view.addEventListener('click', onTableClick);
    view.addEventListener('dblclick', (e) => {
        const td = e.target.closest('td[data-col]');
        if (td && !_tv.editor) { const row = rowByKey(td.parentElement.dataset.row); const col = row && colByKey(row, td.dataset.col); if (col && col.editor !== 'bool') startEdit(td); }
    });
    view.addEventListener('keydown', onTableKey);
    view.addEventListener('paste', onTablePaste);
    view.addEventListener('focusin', (e) => {
        const td = e.target.closest && e.target.closest('td[data-col]');
        // Focus landing on the cell the cursor already marks (the table taking
        // focus back after a rebuild, or a Tab in from outside) does not count
        // as choosing it; only a move to another cell does.
        if (!td || (_tv.editor && _tv.editor.td === td)) return;
        if (td.parentElement.dataset.row === _tv.cursor.row && td.dataset.col === _tv.cursor.col) return;
        setCursor(td.parentElement.dataset.row, td.dataset.col);
    });
    // Held while a pointer is down on the table, so the row under it is still
    // there when the click lands; caught up the moment it is let go.
    view.addEventListener('pointerdown', (e) => {
        const td = e.target.closest && e.target.closest('td[data-col]');
        _tv.downOnCursor = !!td && _tv.cursorChosen && td.parentElement.dataset.row === _tv.cursor.row && td.dataset.col === _tv.cursor.col;
        _tv.pointerDown = true;
    }, true);
    const release = () => {
        if (!_tv.pointerDown) return;
        setTimeout(() => { _tv.pointerDown = false; if (_tv.dirty && !_tv.editor) renderTableView(); }, 0);
    };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);

    document.querySelectorAll('#viewSwitch [data-view]').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
    document.getElementById('tvPasteBtn').onclick = () => openPasteColumn();
    pasteEl('pasteText').addEventListener('input', () => refreshPastePreview());
    pasteEl('pasteColumn').addEventListener('change', () => refreshPastePreview(true));
    pasteEl('pasteApplyBtn').addEventListener('click', applyPasteDialog);
})();
