// ---- Map | Table (plan 3.2) ----
// The same document as the map, as rows: Devices (each one's interfaces fold
// open beneath it), Interfaces, Cables, Ports (every faceplate port of every
// switch and AP, with its label and access VLAN), Subnets and Groups (where
// devices sit: js/groups.js). It is the register's other
// face. A site of sixty devices is read and corrected far faster down a column
// than one device at a time in a 340px rail, which clipped a /24 CIDR out of
// sight (js/ui.js, renderSidebarData).
//
// Where things come from, and where they go:
//
//   rows      reportDevices(), reportConnections(), reportPorts(), reportSubnets() and reportGroups() in
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
// Load order: ... ui -> dialog -> report -> library -> share -> networks -> table -> rackview -> query -> bulk -> app

const TV_TABS = [
    { key: 'devices', label: 'Devices', plain: true },
    { key: 'interfaces', label: 'Interfaces' },
    { key: 'cables', label: 'Cables', plain: true },
    { key: 'ports', label: 'Ports' },
    { key: 'subnets', label: 'Subnets' },
    { key: 'groups', label: 'Groups', plain: true },
    // Only while the network has something wireless (wifiOffered, js/wifi.js).
    { key: 'wifi', label: 'Wi-Fi', when: () => wifiOffered() }
];
const tvTabOffered = (key) => { const tb = TV_TABS.find((x) => x.key === key); return !!tb && (!tb.when || tb.when()); };

const _tv = {
    tab: 'devices',
    sort: {},                       // tab -> { col, dir: 1 | -1 }
    expanded: new Set(),            // device ids whose interfaces are open
    // Interfaces and subnets are not things the map can select, so their rows
    // are ticked here; devices and cables are ticked in state.selection.
    checked: { interfaces: new Set(), ports: new Set(), subnets: new Set(), groups: new Set(), wifi: new Set() },
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

// ---- Map | Table | Rack ----
// The visitor's choice is remembered (state.settings.view, a per-browser
// preference like the library tab). Until there is one, a phone opens on the
// table and anything wider on the map. That is decided once, so turning a
// phone sideways does not swap the view out from under a thumb.
// Rack (js/rackview.js) is offered only while the document has a rack: a
// visitor who left on it and opens a network without one gets the view the
// width decides, and the rack view again on the next network that has one.
const PHONE_MQ = '(max-width: 640px)';
function effectiveView() {
    if (isReduced()) return 'map';
    if (state.settings.view === 'rack' && rackViewOffered()) return 'rack';
    if (state.settings.view === 'map' || state.settings.view === 'table') return state.settings.view;
    if (_tv.defaultView === null) _tv.defaultView = window.matchMedia && window.matchMedia(PHONE_MQ).matches ? 'table' : 'map';
    return _tv.defaultView;
}

function setView(view) {
    if (view !== 'map' && view !== 'table' && !(view === 'rack' && rackViewOffered())) return;
    state.settings.view = view;
    saveSettings();
    applyView();
}

function applyView() {
    const view = tvEl();
    if (!view) return;
    const shown = effectiveView();
    const table = shown === 'table';
    if (!table) cancelEdit();
    view.classList.toggle('hidden', !table);
    document.body.classList.toggle('table-view', table);
    // The rack view lies over the map the same way (js/rackview.js).
    showRackView(shown === 'rack');
    document.querySelectorAll('#viewSwitch [data-view]').forEach((b) => {
        const on = b.dataset.view === shown;
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
    if (!tvTabOffered(key)) return;
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
// A device's service dates and interval (js/model.js "Age and upkeep"):
// read by the field's fromText, so "03/2019" is kept as 2019-03; left off
// the record when emptied.
function upkeepColumn(key, opts) {
    const f = tvField(NODE_FIELDS, key);
    return schemaColumn(NODE_FIELDS, key, 'node', Object.assign({ plain: true, mono: true, sort: 'text', editor: 'text',
        parse: (text) => { const v = String(text == null ? '' : text).trim(); if (!v || v === '—') return { value: undefined }; const r = f.fromText(v); return r === null ? { error: true } : { value: r }; },
        set: (target, value) => { if (value === undefined || value === null || value === '') delete target[key]; else target[key] = value; },
        show: (row) => { const n = getNode(row.ref.nodeId); return shown(n && n[key] !== undefined ? String(n[key]) : ''); } }, opts));
}
// A status by its key or its name in the page's language; blank is unset.
function tvStatusParse(text) {
    const v = String(text == null ? '' : text).trim().toLowerCase();
    if (!v || v === '—') return { value: undefined };
    const key = asStatus(v) || Object.keys(STATUS_NAMES).find((k) => statusName(k).toLowerCase() === v);
    return key ? { value: key } : { error: true };
}
// A cable's own facts (CABLE_FIELDS, js/model.js), kept in link.cable.
// A wireless or a VPN link has no cable: a dash, and nothing to type (what
// it may hold stays stored, as the link panel keeps it).
function cableColumn(key, opts) {
    return schemaColumn(CABLE_FIELDS, key, 'link', Object.assign({ key: `cable:${key}`, plain: true, sort: 'text',
        get: (target) => cableOf(target, key),
        set: (target, value) => { setCableField(target, key, value); },
        can: (row) => !tvNoCable(row),
        show: (row) => (tvNoCable(row) ? shown('—', { muted: true }) : shown(row.data[key])) }, opts));
}
const tvLinkOf = (row) => getLink(row.ref.linkId);
const tvNoCable = (row) => { const l = tvLinkOf(row); const m = l ? effectiveMedium(l) : ''; return m === 'wireless' || m === 'vpn'; };

// ---- Wi-Fi (js/model.js "Wi-Fi", js/wifi.js) ----
// A radio's standard and bands on the Interfaces tab, its channels read
// there too (they are picked in the device editor's radio block, from the
// ones valid for the band); a link's SSID, band and signal on the Cables
// tab; the networks themselves on a Wi-Fi tab of their own. A dash where it
// does not apply: a wired interface has no radio, a cable no SSID. What is
// inferred rather than said (a link's SSID and band, a client's bands from
// its standard) is greyed, as an inherited gateway is.
const tvIfaceOf = (row) => findTarget('iface', row.ref);
const tvIsRadio = (row) => ifaceIsWireless(tvIfaceOf(row));
const tvWifiLink = (row) => { const l = tvLinkOf(row); return !!l && !!wifiLinkEnds(l); };
const tvBlank = (text) => { const v = String(text == null ? '' : text).trim(); return !v || v === '—' || v.toLowerCase() === t('Auto').toLowerCase() ? '' : v; };
const tvDash = () => shown('—', { muted: true });
// An SSID by its id or its name (one network with it); '' is automatic.
function tvSsidParse(text) {
    const v = tvBlank(text);
    if (!v) return { value: '' };
    if (wifiById(v)) return { value: v };
    const hits = (state.wifi || []).filter((w) => String(w.ssid || '').toLowerCase() === v.toLowerCase());
    return hits.length === 1 ? { value: hits[0].id } : { error: true };
}
function tvSetRadio(iface, parts) {
    const r = applyRadioParts(radioOf(iface), parts);
    if (r) iface.radio = r; else delete iface.radio;
}
// "2.4: ch 6 · 5: ch 36/80": the bands that say a channel or a width.
function tvChannelsText(radio) {
    return (radio && radio.bands || []).filter((b) => b.channel !== undefined || b.width).map((b) =>
        `${b.band}: ${b.channel !== undefined ? 'ch ' + b.channel : t('Auto').toLowerCase()}${b.width ? '/' + b.width : ''}`).join(' · ');
}
function wifiColumn(key, opts) {
    return Object.assign({ key: `wf:${key}`, rec: 'wifi', editor: 'text', sort: 'text', same,
        get: (w) => w[key], set: (w, v) => { if (v === '' || v === undefined || v === false) delete w[key]; else w[key] = v; },
        show: (row) => shown(row.data[key]) }, opts);
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

// ---- Groups (js/groups.js) ----
// A device's group, typed or picked: a path ("Building A / Rack 3"), a name
// one group has, or blank for none. A path the map does not have is refused,
// not made: making groups is the Groups tab's (or the spreadsheet import's,
// after its review), and a typing slip in a cell must not grow the tree.
function tvGroupParse(text) {
    const v = String(text == null ? '' : text).trim();
    if (!v || v === '—') return { value: '' };
    const r = findGroupByPath(v);
    return r.group ? { value: r.group.id } : { error: true };
}
// Into a group: as the device editor's picker does (setNodeGroup), it leaves
// a rack's units behind when it goes anywhere but a rack.
function tvSetGroup(node, id, groups = state.groups) {
    const g = groupById(id, groups);
    rackKeysLost(node, g).forEach((k) => { delete node[k]; });
    if (g) node.group = g.id; else delete node.group;
}
// ---- Runs on (js/model.js "Hosts") ----
// A VM's or a container's host, picked or typed: a device's name or id, or
// blank for none. Only a device it may run on (canHost) is taken; a name two
// devices share is refused, as the spreadsheet refuses it.
function tvHostParse(text, row) {
    const v = String(text == null ? '' : text).trim();
    if (!v || v === '—') return { value: '' };
    const guest = row && getNode(row.ref.nodeId);
    const low = v.toLowerCase();
    const byId = state.nodes.find((n) => n.id === v);
    const byName = byId ? [byId] : state.nodes.filter((n) => String(n.name || '').trim().toLowerCase() === low);
    if (byName.length !== 1 || !guest || byName[0] === guest || !canHost(guest.type, byName[0])) return { error: true };
    return { value: byName[0].id };
}
// Written as the device editor's picker writes it, then the host rule over
// the document the cell is on (the live one, or a paste's scratch copy, so
// its preview counts the group the VM follows its host into).
function tvSetHost(node, id, doc) {
    if (id) node.host = id; else delete node.host;
    repairHosts(doc ? doc.nodes : state.nodes);
}
const tvHostOptions = (row) => {
    const guest = row && getNode(row.ref.nodeId);
    return [{ value: '', label: t('— None') }].concat(hostCandidates(guest).map((n) => ({ value: n.id, label: `${n.name || n.id} · ${typeName(n.type)}` })));
};

const tvGroupOptions = (exclude) => groupTree()
    .filter((e) => !exclude || exclude(e.group))
    .map((e) => ({ value: e.group.id, label: groupOptionIndent(e.depth) + groupLabel(e.group) }));

// A group's own fields, on the Groups tab. Its record is the group itself
// (findTarget 'group'), so an edit is one batch() like any other cell.
function groupColumn(key, opts) {
    return Object.assign({ key: `g:${key}`, rec: 'group', editor: 'text', sort: 'text', same,
        get: (g) => g[key], set: (g, v) => { g[key] = v; }, show: (row) => shown(row.data[key]) }, opts);
}
// A rack turned into anything else takes its devices' places in it with it;
// the rail asks first (changeGroupKind, js/groups.js), and so does a cell.
function tvKindQuestion(g, kind) {
    if (!isRackGroup(g) || kind === 'rack') return '';
    const placed = groupMembers(g.id, false).filter(hasRackFields).length;
    if (!placed) return '';
    return t(placed === 1 ? '{name} stops being a rack. Its one placed device loses its unit, height and face.'
        : '{name} stops being a rack. Its {n} placed devices lose their units, heights and faces.', { name: groupLabel(g), n: placed });
}
function tvSetKind(g, kind, nodes = state.nodes) {
    if (isRackGroup(g) && kind !== 'rack') nodes.forEach((n) => { if (n.group === g.id) RACK_KEYS.forEach((k) => { delete n[k]; }); });
    g.kind = kind;
    if (kind === 'rack') {
        if (!Number.isInteger(g.uHeight)) g.uHeight = RACK_U_DEFAULT;
        if (!g.width) g.width = RACK_WIDTH_DEFAULT;
    }
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
        // Where it is: its group's path (and units, in a rack), picked from
        // the tree or typed as a path. Beside it the free-text location,
        // which stays as typed and is greyed once a group says where the
        // device is (Review-Packs/Topo-groups.md, "Location").
        { key: 'group', label: 'Group', plain: true, rec: 'node', editor: 'select', sort: 'text', same,
          parse: tvGroupParse,
          options: () => [{ value: '', label: t('— None') }].concat(tvGroupOptions()),
          get: (target) => (target.group && groupById(target.group) ? target.group : ''),
          edit: (row) => row.data.groupId || '',
          set: (target, value, doc) => tvSetGroup(target, value, doc ? doc.groups : undefined),
          // A VM on a host is where its host is: its group is the host's,
          // and changes with it, so its cell is not a place to set one.
          can: (row) => state.groups.length > 0 && !(row && row.data.hostId),
          show: (row) => (row.data.groupId ? shown(row.data.place, row.data.hostId ? { muted: true, title: t('Where {host} is: it runs on it.', { host: row.data.host }) } : {}) : shown('')) },
        // What a VM or a container runs on; a dash on anything else, which
        // runs on nothing.
        { key: 'host', label: 'Runs on', plain: true, rec: 'node', editor: 'select', sort: 'text', same,
          parse: tvHostParse,
          options: tvHostOptions,
          get: (target) => target.host || '',
          edit: (row) => row.data.hostId || '',
          set: (target, value, doc) => tvSetHost(target, value, doc),
          can: (row) => { const n = getNode(row.ref.nodeId); return !!n && isVirtualType(n.type); },
          show: (row) => { const n = getNode(row.ref.nodeId); return n && isVirtualType(n.type) ? shown(row.data.host) : shown('—', { muted: true }); } },
        assetColumn('location', {
            show: (row) => (row.data.groupId && row.data.location
                ? shown(row.data.location, { muted: true, title: t('Kept as typed. Where it is now is its group: {path}', { path: row.data.place }) })
                : shown(row.data.location)) }),
        assetColumn('status', { editor: 'select', parse: tvStatusParse,
            options: () => [{ value: '', label: '—' }].concat(STATUS_VALUES.map((k) => ({ value: k, label: statusName(k) }))),
            get: (target) => target.status || '',
            edit: (row) => row.data.status || '',
            show: (row) => shown(statusName(row.data.status), row.data.status === 'retired' ? { muted: true } : {}) }),
        upkeepColumn('inService'),
        upkeepColumn('serviced'),
        upkeepColumn('serviceEvery', { sort: 'num' }),
        // Blank is its type's usual life, shown greyed.
        upkeepColumn('lifeYears', { sort: 'num',
            sortKey: (row) => expectedLifeOf(getNode(row.ref.nodeId)),
            show: (row) => {
                const n = getNode(row.ref.nodeId);
                if (n && n.lifeYears !== undefined && n.lifeYears !== '') return shown(String(n.lifeYears));
                // Its type's in this network: set for it, or Topo's usual.
                const usual = n ? typeLifeOf(n.type) : null;
                const own = n && state.expectedLife && state.expectedLife[n.type];
                return usual ? shown(String(usual), { muted: true, title: t(own ? 'Set for its type in this network' : 'Usual for its type') }) : shown('');
            } }),
        // Worked out, never typed: from today's date (js/model.js "Age and upkeep").
        { key: 'age', label: 'Age', plain: true, rec: 'node', editor: null, sort: 'num', mono: true,
          sortKey: (row) => { const a = deviceAge(getNode(row.ref.nodeId)); return a ? a.months : null; },
          show: (row) => {
              const n = getNode(row.ref.nodeId);
              const old = upkeepState(n).old;
              return shown(ageText(deviceAge(n)), old ? { sev: 'warn', title: t('Past its expected life ({n} years)', { n: old.life }) } : {});
          } },
        // Coloured as its finding is: overdue (warn), missed twice over (bad).
        { key: 'nextService', label: 'Next service', plain: true, rec: 'node', editor: null, sort: 'text', mono: true,
          show: (row) => {
              const n = getNode(row.ref.nodeId), due = nextServiceDate(n);
              if (!due) return shown('');
              const s = upkeepState(n).service;
              const level = s && (s.level === 'bad' || s.level === 'warn') ? s.level : '';
              return shown(due, level ? { sev: level, title: t('Overdue') } : {});
          } },
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
        { key: 'subnet', label: 'Subnet', rec: 'iface', editor: null, mono: true, sort: 'ip', show: (row) => subnetCell(row) },
        { key: 'radio:standard', label: 'Wi-Fi standard', rec: 'iface', editor: 'select', sort: 'text', same, when: () => wifiOffered(),
          can: tvIsRadio,
          options: () => [{ value: '', label: '—' }].concat(WIFI_STANDARDS.map((k) => ({ value: k, label: wifiStandardName(k) }))),
          parse: (text) => { const v = tvBlank(text); if (!v) return { value: '' }; const k = wifiStandardKey(v); return k ? { value: k } : { error: true }; },
          get: (i) => (radioOf(i) || {}).standard || '',
          set: (i, v) => tvSetRadio(i, { standard: v }),
          show: (row) => (tvIsRadio(row) ? shown(wifiStandardName((radioOf(tvIfaceOf(row)) || {}).standard)) : tvDash()) },
        { key: 'radio:bands', label: 'Bands', rec: 'iface', editor: 'text', mono: true, sort: 'text', same, when: () => wifiOffered(),
          can: tvIsRadio,
          parse: (text) => { const v = tvBlank(text); if (!v) return { value: '' }; const l = wifiBandList(v); return l && l.length ? { value: l.join(' ') } : { error: true }; },
          get: (i) => radioPartValue(radioOf(i), 'bands') || '',
          set: (i, v) => tvSetRadio(i, { bands: v }),
          show: (row) => {
              if (!tvIsRadio(row)) return tvDash();
              const radio = radioOf(tvIfaceOf(row));
              const own = radioPartValue(radio, 'bands');
              if (own) return shown(wifiBandsText(own.split(' ')));
              const std = radio && standardBands(radio.standard);
              return std ? shown(wifiBandsText(std), { muted: true, title: t('From the standard') }) : shown('');
          } },
        { key: 'radio:channels', label: 'Channels', rec: 'iface', editor: null, mono: true, sort: 'text', when: () => wifiOffered(),
          show: (row) => (tvIsRadio(row) ? shown(tvChannelsText(radioOf(tvIfaceOf(row)))) : tvDash()) }
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
        // A number in metres or feet (cableLengthFromText, js/model.js): the
        // cell is edited as "2.5" beside the pick of its unit, and shows
        // "2.5 m". Sorted by the length itself, feet and metres together.
        cableColumn('length', { mono: true, sort: 'num', unit: true,
            sortKey: (row) => { const l = tvLinkOf(row); return l && !tvNoCable(row) ? cableLengthMetres(cableOf(l, 'length')) : null; },
            parse: (text, row, unit) => { const v = String(text == null ? '' : text).trim(); if (!v) return { value: '' }; const r = cableLengthFromText(v, typeof unit === 'string' ? unit : undefined); return r === null ? { error: true } : { value: r }; },
            unitOf: (row) => { const l = tvLinkOf(row); const p = l ? cableLengthParts(cableOf(l, 'length')) : null; return p ? p.unit : CABLE_UNIT_DEFAULT; },
            edit: (row) => { const l = tvLinkOf(row); const v = l ? cableOf(l, 'length') : ''; const n = cableLengthNumber(v); return n === null ? v : n; } }),
        cableColumn('color'),
        cableColumn('via', { mono: true }),
        { key: 'wifi:ssid', label: 'SSID', rec: 'link', editor: 'select', sort: 'text', same, when: () => wifiOffered(),
          can: tvWifiLink,
          options: (row) => {
              const l = tvLinkOf(row);
              const c = l ? linkWifiChoices(l) : null;
              return [{ value: '', label: t('Auto') }].concat((c ? c.ssids : []).map((id) => ({ value: id, label: wifiLabel(wifiById(id)) })));
          },
          parse: tvSsidParse,
          get: (l) => linkWifiOf(l, 'ssid') || '',
          set: (l, v) => { setLinkWifi(l, 'ssid', v || undefined); },
          show: (row) => {
              const l = tvLinkOf(row);
              if (!l || !wifiLinkEnds(l)) return tvDash();
              const own = linkWifiOf(l, 'ssid');
              if (own) return shown(wifiLabel(wifiById(own)));
              const auto = linkWifiSsid(l);
              return auto ? shown(wifiLabel(wifiById(auto)), { muted: true, title: t('Worked out by Topo') }) : shown('');
          } },
        { key: 'wifi:band', label: 'Band', rec: 'link', editor: 'select', mono: true, sort: 'text', same, when: () => wifiOffered(),
          can: tvWifiLink,
          options: (row) => {
              const l = tvLinkOf(row);
              const c = l ? linkWifiChoices(l) : null;
              return [{ value: '', label: t('Auto') }].concat((c ? c.bands : WIFI_BANDS).map((b) => ({ value: b, label: wifiBandName(b) })));
          },
          parse: (text) => { const v = tvBlank(text); if (!v) return { value: '' }; const b = wifiBandKey(v); return b ? { value: b } : { error: true }; },
          get: (l) => linkWifiOf(l, 'band') || '',
          set: (l, v) => { setLinkWifi(l, 'band', v || undefined); },
          show: (row) => {
              const l = tvLinkOf(row);
              if (!l || !wifiLinkEnds(l)) return tvDash();
              const own = linkWifiOf(l, 'band');
              if (own) return shown(wifiBandName(own));
              const auto = linkWifiBand(l);
              return auto ? shown(wifiBandName(auto), { muted: true, title: t('Worked out by Topo') }) : shown('');
          } },
        { key: 'wifi:signal', label: 'Signal (dBm)', rec: 'link', editor: 'text', mono: true, sort: 'num', same, when: () => wifiOffered(),
          can: tvWifiLink,
          parse: (text) => { const v = String(text == null ? '' : text).trim(); if (!v) return { value: undefined }; const n = asWifiSignal(v); return n === undefined ? { error: true } : { value: n }; },
          get: (l) => linkWifiOf(l, 'signal'),
          set: (l, v) => { setLinkWifi(l, 'signal', v); },
          show: (row) => { const l = tvLinkOf(row); if (!l || !wifiLinkEnds(l)) return tvDash(); const v = linkWifiOf(l, 'signal'); return shown(v === undefined ? '' : v); } }
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
    ],
    // The rail's Groups tab as rows (js/groups.js): plain words, translated,
    // except U, the rack unit. In tree order until a column is sorted; the
    // name is stepped in by depth so the tree still reads.
    groups: [
        groupColumn('name', { label: 'Name', plain: true,
            parse: (text) => ({ value: groupName(text) }),
            get: (g) => g.name || '',
            set: (g, v) => { if (v) g.name = v; else delete g.name; },
            show: (row) => shown(`${row.data.depth && !_tv.sort.groups ? '\u2002'.repeat(Math.min(row.data.depth, GROUP_INDENT_MAX)) + '\u2514\u00a0' : ''}${row.data.name}`, { title: row.data.path }) }),
        groupColumn('kind', { label: 'Kind', plain: true, editor: 'select',
            options: () => GROUP_KINDS.map((k) => ({ value: k, label: groupKindName(k) })),
            parse: (text) => {
                const v = String(text == null ? '' : text).trim().toLowerCase();
                const k = GROUP_KINDS.find((x) => x === v || groupKindName(x).toLowerCase() === v);
                return k ? { value: k } : { error: true };
            },
            edit: (row) => row.data.kind,
            ask: (g, v) => tvKindQuestion(g, v),
            loses: (g, v) => (isRackGroup(g) && v !== 'rack' ? groupMembers(g.id, false).filter(hasRackFields).length : 0),
            set: (g, v, doc) => tvSetKind(g, v, doc ? doc.nodes : undefined),
            show: (row) => shown(row.data.kindName) }),
        groupColumn('parent', { label: 'Inside', plain: true, editor: 'select',
            // Not itself and nothing below it: that would be a loop.
            options: (row) => [{ value: '', label: t('— (top)') }].concat(tvGroupOptions((g) => groupParentOk(row.ref.groupId, g.id))),
            // `work` is the paste's working tree: a pasted column is checked
            // row by row against the moves above it in the same paste, or two
            // rows could each be sound alone and make a loop together.
            parse: (text, row, work = state.groups) => {
                const v = String(text == null ? '' : text).trim();
                if (!v || v === '—') return { value: null };
                const r = findGroupByPath(v);
                return r.group && groupParentOk(row.ref.groupId, r.group.id, work) ? { value: r.group.id } : { error: true };
            },
            chain: {
                start: () => (state.groups || []).map((g) => ({ id: g.id, parent: g.parent })),
                apply: (work, row, v) => { const g = work.find((x) => x.id === row.ref.groupId); if (g) g.parent = v || undefined; }
            },
            get: (g) => g.parent || null,
            edit: (row) => row.data.parentId,
            same: (a, b) => (a || null) === (b || null),
            show: (row) => shown(row.data.parent) }),
        // A rack's size ("Round 2", item 4), as the rail's fields have it.
        // The height keeps every device on its printed units and asks first
        // when some would lose theirs (applyRackHeight, js/model.js).
        groupColumn('uHeight', { label: 'Height (U)', plain: true, mono: true, sort: 'num',
            can: (row) => !!row.data.uHeight,
            parse: (text) => { const n = asUnits(String(text == null ? '' : text).trim().replace(/\s*u$/i, '')); return n !== undefined && n >= 1 && n <= RACK_U_MAX ? { value: n } : { error: true }; },
            ask: (g, v) => { const message = rackShrinkQuestion(g, v); return message ? { message, ok: t('Make it {h}U', { h: v }) } : ''; },
            loses: (g, v) => rackResizePlan(g, v).lost.length,
            set: (g, v, doc) => applyRackHeight(g, v, doc ? doc.nodes : state.nodes),
            show: (row) => (row.data.uHeight ? shown(row.data.uHeight) : shown('—', { muted: true })) }),
        groupColumn('width', { label: 'Width', plain: true, mono: true, editor: 'select',
            can: (row) => !!row.data.width,
            options: () => RACK_WIDTHS.map((w) => ({ value: w, label: rackWidthLabel(w) })),
            parse: (text) => { const w = rackWidthKey(text); return w ? { value: w } : { error: true }; },
            get: (g) => asRackWidth(g.width),
            edit: (row) => row.data.width,
            show: (row) => (row.data.width ? shown(rackWidthLabel(row.data.width)) : shown('—', { muted: true })) }),
        // Optional: a blank cell takes it away.
        groupColumn('depthMm', { label: 'Depth (mm)', plain: true, mono: true, sort: 'num',
            can: (row) => !!row.data.width,
            parse: (text) => {
                const v = String(text == null ? '' : text).trim().replace(/\s*mm$/i, '');
                if (!v) return { value: undefined };
                const n = asRackDepthMm(v);
                return n !== undefined && String(n) === String(Number(v)) ? { value: n } : { error: true };
            },
            get: (g) => g.depthMm,
            set: (g, v) => { if (v === undefined) delete g.depthMm; else g.depthMm = v; },
            show: (row) => (row.data.depthMm ? shown(row.data.depthMm) : shown('—', { muted: true })) }),
        // Only the printed numbers turn round; no device moves.
        groupColumn('numbering', { label: 'Numbering', plain: true, editor: 'select',
            can: (row) => !!row.data.numbering,
            options: () => [{ value: 'bottom', label: t('Bottom up') }, { value: 'top', label: t('Top down') }],
            parse: (text) => {
                const v = String(text == null ? '' : text).trim();
                const low = v.toLowerCase();
                if (low === 'bottom' || low === t('Bottom up').toLowerCase() || /^bottom[\s_-]*up$/i.test(v)) return { value: 'bottom' };
                if (asRackNumbering(v) || low === t('Top down').toLowerCase()) return { value: 'top' };
                return { error: true };
            },
            get: (g) => (rackTopDown(g) ? 'top' : 'bottom'),
            set: (g, v) => { if (v === 'top') g.numbering = 'top'; else delete g.numbering; },
            edit: (row) => row.data.numbering,
            show: (row) => (row.data.numbering ? shown(t(row.data.numbering === 'top' ? 'Top down' : 'Bottom up')) : shown('—', { muted: true })) }),
        { key: 'g:deep', label: 'Devices', plain: true, rec: 'group', editor: null, mono: true, sort: 'num',
          show: (row) => shown(row.data.deep, row.data.own && row.data.own !== row.data.deep ? { title: t('{n} here', { n: row.data.own }) } : {}) }
    ],
    // The rail's Wi-Fi tab as rows (js/wifi.js). The trade's words, English,
    // but for the hidden flag, the access points and the clients.
    wifi: [
        wifiColumn('ssid', { label: 'SSID',
            parse: (text) => { const v = wifiSsidText(text); return v ? { value: v } : { error: true }; } }),
        wifiColumn('security', { label: 'Security', editor: 'select',
            options: () => [{ value: '', label: '—' }].concat(WIFI_SECURITY.map((k) => ({ value: k, label: wifiSecurityName(k) }))),
            parse: (text) => { const v = tvBlank(text); if (!v) return { value: '' }; const k = wifiSecurityKey(v); return k ? { value: k } : { error: true }; },
            get: (w) => w.security || '',
            show: (row) => shown(row.data.securityName) }),
        // Every band is the default, and is no value: "2.4 5 6" reads back as ''.
        wifiColumn('bands', { label: 'Bands', mono: true,
            parse: (text) => { const v = tvBlank(text); if (!v) return { value: '' }; const l = wifiBandList(v); return l && l.length ? { value: (asWifiBands(l) || []).join(' ') } : { error: true }; },
            get: (w) => (asWifiBands(w.bands) || []).join(' '),
            set: (w, v) => { if (v) w.bands = v.split(' '); else delete w.bands; },
            edit: (row) => row.data.bands.join(' '),
            show: (row) => shown(row.data.bandsText) }),
        wifiColumn('network', { label: 'Subnet', editor: 'select', mono: true,
            options: () => [{ value: '', label: t('— None') }].concat(state.networks.slice().sort((a, b) => compareCidr(a.cidr, b.cidr))
                .map((n) => ({ value: n.id, label: networkLabel(n) + (Number.isInteger(n.vlan) ? ` · VLAN ${n.vlan}` : '') }))),
            parse: (text) => {
                const v = tvBlank(text);
                if (!v) return { value: '' };
                const net = networkById(v) || state.networks.find((n) => n.cidr === canonicalCidr(v) || networkLabel(n).toLowerCase() === v.toLowerCase());
                return net ? { value: net.id } : { error: true };
            },
            get: (w) => w.network || '',
            edit: (row) => row.data.networkId,
            show: (row) => shown(row.data.subnet + (row.data.vlan != null ? ` · VLAN ${row.data.vlan}` : '')) }),
        wifiColumn('hidden', { label: 'Hidden network', plain: true, editor: 'bool', parse: tvBoolParse,
            get: (w) => !!w.hidden, same: (a, b) => !!a === !!b,
            set: (w, v) => { if (v) w.hidden = true; else delete w.hidden; },
            show: (row) => shown(row.data.hidden ? '✓' : '') }),
        { key: 'wf:aps', label: 'Access points', plain: true, rec: 'wifi', editor: null, sort: 'text',
          show: (row) => shown(row.data.aps.join(', ')) },
        { key: 'wf:clients', label: 'Clients', plain: true, rec: 'wifi', editor: null, mono: true, sort: 'num',
          show: (row) => shown(row.data.clients.length, { title: row.data.clients.join(', ') }) }
    ]
};
// ---- Custom columns (js/model.js "Custom columns") ----
// The document's own columns, after Topo's on the Devices tab. Their names
// are the user's words, shown as typed (never translated). A cell is typed
// into like any other and checked by the column's kind; a yes/no column is a
// tick, flipped by Enter, Space or a click.
function customColumn(def) {
    const yesno = def.kind === 'yesno';
    return {
        key: `x:${def.id}`, custom: def.id, label: def.name, rec: 'node',
        editor: yesno ? 'bool' : 'text', mono: def.kind === 'number' || def.kind === 'date',
        sort: def.kind === 'number' ? 'num' : 'text',
        parse: (text) => parseCustomValue(def, text),
        get: (node) => customValueOf(node, def.id),
        set: (node, value) => setCustomValue(node, def.id, yesno ? (value ? true : undefined) : value),
        same: yesno ? (a, b) => !!a === !!b : (a, b) => customText(def, a) === customText(def, b),
        show: (row) => {
            const v = customValueOf(getNode(row.ref.nodeId), def.id);
            return shown(yesno ? (v ? '✓' : '') : customText(def, v));
        }
    };
}

// The Devices tab as the document arranges it (state.tableView.devices):
// Topo's columns and the custom ones, in the saved order, without the hidden
// ones. Name always shows, and always first: it is what a row is. A column
// the saved order does not name (a custom one added since) goes where it
// would by default, after the ones it names.
const TV_FIXED_COL = 'name';
const tvDevicesView = () => (state.tableView && state.tableView.devices) || {};
// Every column but Name, in the saved order, hidden ones included (the
// Columns dialog lists them all).
function tvDevicesOrder() {
    const all = TV_COLS.devices.concat((state.columns || []).map(customColumn)).filter((c) => c.key !== TV_FIXED_COL);
    const rank = new Map((tvDevicesView().order || []).map((k, i) => [k, i]));
    const known = all.filter((c) => rank.has(c.key)).sort((a, b) => rank.get(a.key) - rank.get(b.key));
    return known.concat(all.filter((c) => !rank.has(c.key)));
}
function tvDevicesArranged() {
    const hidden = new Set(tvDevicesView().hidden || []);
    return [TV_COLS.devices.find((c) => c.key === TV_FIXED_COL)].concat(tvDevicesOrder().filter((c) => !hidden.has(c.key)));
}
// Built once per arrangement: the cells ask for their columns many times a
// draw, and the custom ones are made from the document's definitions.
let _tvArranged = { sig: null, cols: null };
function tvDevicesCols() {
    const sig = JSON.stringify([state.columns || [], state.tableView || {}]);
    if (_tvArranged.sig !== sig) _tvArranged = { sig, cols: tvDevicesArranged() };
    return _tvArranged.cols;
}

// The columns a tab shows now: a column with `when` only while it applies
// (the Wi-Fi ones while the network has something wireless).
const tvCols = (tab) => (tab === 'devices' ? tvDevicesCols() : TV_COLS[tab]).filter((c) => !c.when || c.when());
// Only a declared network has a record to edit.
TV_COLS.subnets.forEach((c) => { if (c.editor && !c.can) c.can = (row) => !!row.ref.netId; });

// The interface rows that open beneath a device: the same columns as the
// Interfaces tab, laid under the device's (name under Name, the address under
// Type and Interfaces, the MAC under Gateway and DNS).
const TV_SUB_COLS = [
    Object.assign({}, TV_COLS.interfaces[1], { key: 'if:name' }),
    Object.assign({}, TV_COLS.interfaces[2], { key: 'if:ip' }),
    Object.assign({}, TV_COLS.interfaces[3], { key: 'if:mac' }),
    { key: 'if:info', label: 'Cable', plain: true, rec: 'iface', editor: null,
      show: (row) => { const c = cableCell(row); const v = row.data.vendor; return shown([v, c.text].filter(Boolean).join(' · '), { muted: true }); } }
];

// How wide an interface row's cells are under `n` device columns: the name
// one, the address and the MAC two each while there is room, and the rest
// to the last. With columns hidden there may be fewer than the six the
// default lays them under; the row still spans the table exactly.
function tvSubSpan(c, n) {
    const ip = n >= 4 ? 2 : 1, mac = n >= 6 ? 2 : 1;
    const w = c.key === 'if:name' ? 1 : c.key === 'if:ip' ? ip : c.key === 'if:mac' ? mac : Math.max(1, n - 1 - ip - mac);
    return w > 1 ? ` colspan="${w}"` : '';
}

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

const colsOf = (row) => (row.sub ? TV_SUB_COLS : tvCols(_tv.tab));
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
    if (rec === 'group') return (doc.groups || []).find((g) => g.id === ref.groupId) || null;
    if (rec === 'wifi') return (doc.wifi || []).find((w) => w.id === ref.wifiId) || null;
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
    if (tab === 'groups') return reportGroups().map((g) => ({ key: `g:${g.id}`, rec: 'group', ref: { groupId: g.id }, data: g }));
    if (tab === 'wifi') return reportWifi().map((w) => ({ key: `w:${w.id}`, rec: 'wifi', ref: { wifiId: w.id }, data: w }));
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
    if (col.sortKey) {
        const x = col.sortKey(a), y = col.sortKey(b);
        if (x === null || y === null) return x === null && y === null ? 0 : (x === null ? 1 : -1) * _tvSortDir;
        return x - y;
    }
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
    const col = s && tvCols(tab).find((c) => c.key === s.col);
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
    if (row.rec === 'group') return row.data.path;
    if (row.rec === 'wifi') return row.data.ssid || t('Wi-Fi network');
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

    // A tab that stopped applying (the last AP deleted) gives way to Devices.
    if (!tvTabOffered(_tv.tab)) { _tv.tab = 'devices'; _tv.cursor = { row: null, col: null }; _tv.cursorChosen = false; _tv.anchor = null; }
    document.querySelectorAll('#tableView [data-tvtab]').forEach((b) => {
        b.classList.toggle('hidden', !tvTabOffered(b.dataset.tvtab));
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

    const cols = tvCols(tab);
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
        const span = row.sub ? tvSubSpan(c, cols.length) : '';
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
    document.getElementById('tvColsBtn').classList.toggle('hidden', tab !== 'devices');

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
        el.innerHTML = col.options(row).map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
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
    // A length: its unit picked in front of the number (makeUnitPick,
    // js/ui.js). Moving between the two is still editing the cell; leaving
    // both is a blur.
    let unitEl = null;
    // A length kept from an older file as free text ("15 feet", "about 3")
    // opens as it is written, not filtered down to its digits: filtered, and
    // with the unit pick on m, an Enter or a blur would have rewritten it to
    // "15 m" without anyone asking. What is typed is filtered as ever, and
    // the text left as it was is no edit at all (finishEdit).
    let legacy;
    if (col.unit) {
        const stored = target ? col.get(target) : '';
        if (seed === undefined && String(stored == null ? '' : stored).trim() && !cableLengthParts(stored)) legacy = el.value;
        unitEl = wrapUnitField(el, col.unitOf(row), 'tv-unit');
        if (legacy === undefined) filterLengthInput(el);
        el.addEventListener('input', () => filterLengthInput(el));
        unitEl.addEventListener('change', () => el.focus());
        unitEl.addEventListener('blur', (e) => { if (e.relatedTarget !== el) finishEdit('blur'); });
    }
    _tv.editor = { el, unitEl, td, rowKey: row.key, colKey: col.key, done: false, legacy, legacyUnit: unitEl ? unitEl.value : undefined };
    el.addEventListener('blur', (e) => { if (!unitEl || e.relatedTarget !== unitEl) finishEdit('blur'); });
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
    // An old free-text length left as it opened, its unit pick not moved
    // either, asks for nothing. Parsed, "15 feet" would come back "15 ft"
    // and "about 3" would be refused, neither of which anyone asked for.
    if (ed.legacy !== undefined && text === ed.legacy && (!ed.unitEl || ed.unitEl.value === ed.legacyUnit)) {
        ed.done = true; _tv.editor = null;
        if (move) { const next = moveFrom(ed.td, move, true); if (next) { _tv.cursor = { row: next.parentElement.dataset.row, col: next.dataset.col }; _tv.cursorChosen = true; } }
        _tv.keepFocus = how !== 'blur';
        renderTableView(how !== 'blur');
        return true;
    }
    const res = col.parse(text, row, ed.unitEl ? ed.unitEl.value : undefined);
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
    // A column whose value costs something else (a rack turned into a room
    // loses its devices' units) asks first, as the rail does. No is no edit.
    // A question is its text (the kind's, answered Change kind) or
    // { message, ok } (a rack's height, answered Make it 24U).
    const q = col.ask ? col.ask(target, value) : '';
    const question = typeof q === 'string' ? q : q.message;
    if (question) {
        askConfirm(question, { ok: typeof q === 'string' ? t('Change kind') : q.ok, danger: true }).then((yes) => {
            const again = findTarget(col.rec, row.ref);
            if (yes && again && !readOnlyRefuses()) batch(() => { col.set(again, value); save(); afterTableEdit(); });
            else { _tv.keepFocus = true; renderTableView(true); }
        });
        return true;
    }
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
    renderGroupsPanel();
    renderWifiPanel();
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
    if (row.rec === 'group') { selectGroupMembers(row.ref.groupId); return; }
    // A Wi-Fi network: its clients, as its card's Select clients does.
    if (row.rec === 'wifi') { selectWifiClients(row.ref.wifiId); return; }
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
const pasteColumns = (tab = _tv.tab) => tvCols(tab).filter((c) => c.editor);

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
    const col = tvCols(tab).find((c) => c.key === colKey);
    const lines = pasteLines(text);
    const cells = [];
    let extra = 0;
    // A column whose rows depend on each other (a group's parent) carries a
    // working copy that each accepted cell is written into before the next
    // is read.
    const work = col && col.chain ? col.chain.start() : undefined;
    lines.forEach((line, i) => {
        const row = targets.rows[i];
        if (!row) { extra++; return; }
        const target = col && findTarget(col.rec, row.ref);
        const now = col ? col.show(row).text : '';
        if (!col || !line.trim() || !canEdit(row, col) || !target) { cells.push({ row, status: 'skip', now, text: line }); return; }
        // A length pasted as a bare number is in the unit the cable is kept
        // in: "25" over an 8 ft cable is 25 ft, not 25 m.
        const res = col.parse(line, row, work !== undefined ? work : col.unit ? col.unitOf(row) : undefined);
        if (res.error) { cells.push({ row, status: 'bad', now, text: line, why: tvInvalid(col, line) }); return; }
        if (work) col.chain.apply(work, row, res.value);
        const cell = { row, status: col.same(col.get(target), res.value) ? 'same' : 'change', now, text: line, value: res.value };
        // A cell whose column asks before an edit (a rack made shorter than
        // its devices, a rack made a room) keeps its question, so a paste
        // asks it too: the findings delta cannot say it, because a device
        // that loses its units waits under Not placed yet with no finding.
        if (cell.status === 'change' && col.ask) {
            const q = col.ask(target, res.value);
            if (q) { cell.ask = typeof q === 'string' ? q : q.message; cell.loses = col.loses ? col.loses(target, res.value) : 0; }
        }
        cells.push(cell);
    });
    const count = (s) => cells.filter((c) => c.status === s).length;
    return { tab, colKey, col, cells, extra, unfilled: targets.mode === 'selected' ? Math.max(0, targets.rows.length - lines.length) : 0,
        counts: { change: count('change'), same: count('same'), bad: count('bad'), skip: count('skip') },
        loses: cells.reduce((sum, c) => sum + (c.loses || 0), 0) };
}

// The findings the change would leave, against the ones there now: the pure
// engine (diagnoseDoc, js/diagnostics.js) run on a scratch copy with the same
// writes applied. -> [{ key, check, diff }], biggest change first.
function pasteFindingsDelta(plan) {
    const changes = plan.cells.filter((c) => c.status === 'change');
    if (!changes.length) return [];
    const scratch = cloneData({ nodes: state.nodes, links: state.links, networks: state.networks, groups: state.groups, wifi: state.wifi });
    changes.forEach((c) => { const target = findTarget(plan.col.rec, c.row.ref, scratch); if (target) plan.col.set(target, c.value, scratch); });
    return findingsDelta(topologyFindings(), diagnoseDoc(scratch).findings);
}
// Open findings only: one accepted with a reason is not counted anywhere, so
// it is not a change either way; nor is an info one (isCountedFinding).
function findingsDelta(before, after) {
    const tally = (list, sign, into) => list.filter(isCountedFinding).forEach((f) => {
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

// The one question a paste asks for every cell that asks one, in the order
// the rows are: each in full while there are few, so every device that loses
// its place is named; '' when none asks.
const PASTE_ASK_MAX = 4;
function pasteQuestion(plan) {
    const asks = plan.cells.filter((c) => c.status === 'change' && c.ask).map((c) => c.ask);
    if (asks.length <= 1) return asks[0] || '';
    const shown = asks.slice(0, PASTE_ASK_MAX);
    if (asks.length > PASTE_ASK_MAX) shown.push(t('…and {n} more.', { n: asks.length - PASTE_ASK_MAX }));
    return [t('{n} of the rows this paste changes ask first:', { n: asks.length }), ...shown].join('\n\n');
}

// One transaction however many cells: one undo step, one redraw. It does not
// ask: the dialog that calls it has (applyPasteDialog).
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
    // Devices that would lose their place are said here too (the findings
    // never count them), and Apply asks before it takes them.
    const loses = plan.loses ? ` <span class="paste-delta-up">${escapeHtml(t('Devices that lose their place in a rack: {n}. Apply asks first.', { n: plan.loses }))}</span>` : '';
    const delta = () => {
        if (!_paste || _paste.plan !== plan) return;
        pasteEl('pasteDelta').innerHTML = findingsDeltaHtml(pasteFindingsDelta(plan), c.change > 0) + loses;
    };
    if (now) delta(); else _paste.timer = setTimeout(delta, 200);
}

function applyPasteDialog() {
    if (!_paste) return;
    const text = pasteEl('pasteText').value;
    const plan = planPaste(pasteEl('pasteColumn').value, text, _paste.targets);
    if (!plan.counts.change) return;
    closePasteColumn();
    // Rows that ask first are asked about together, as one cell would be
    // (commitValue). No applies nothing and brings the paste back as it was.
    const question = pasteQuestion(plan);
    if (!question) { applyPastePlan(plan); return; }
    askConfirm(question, { ok: t('Apply'), danger: true }).then((yes) => {
        if (yes) applyPastePlan(plan);
        else openPasteColumn({ col: plan.colKey, text });
    });
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
        // A bare number pasted as a length takes the cable's own unit, as in
        // the preview (planPaste).
        const res = col.parse(lines[0] || '', row, col.unit ? col.unitOf(row) : undefined);
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
    if (ed && (e.target === ed.el || (ed.unitEl && e.target === ed.unitEl))) {
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

// ---- The Columns dialog (Devices tab) ----
// Which columns show and in what order, and the document's own columns:
// added, renamed and deleted here. Each change is one batch(): one undo
// step, saved with the document, so the arrangement travels with the file.
// It is only a view: the spreadsheet keeps its own order (js/csv.js).
const colsEl = (id) => document.getElementById(id);
const CUSTOM_KIND_NAMES = { text: 'Text', number: 'Number', date: 'Date', yesno: 'Yes / no' };

// Why a name cannot be a custom column's, or ''. Another custom column's in
// any case, or one of Topo's own (its label in English or the page's
// language, or a heading the spreadsheet import reads as one of its fields):
// the import must never have to guess which of two columns a heading meant.
function customNameProblem(name, exceptId) {
    const v = customName(name);
    if (!v) return t('A column needs a name.');
    const low = v.toLowerCase();
    if ((state.columns || []).some((c) => c.id !== exceptId && c.name.toLowerCase() === low)) return t('There is a column called {name} already.', { name: v });
    const topo = TV_COLS.devices.some((c) => c.label && (c.label.toLowerCase() === low || tvLabel(c).toLowerCase() === low));
    if (topo || (typeof csvGuessByHeading === 'function' && csvGuessByHeading(v))) return t('Topo has a column called {name} already.', { name: v });
    return '';
}

function tvSetDevicesView(change) {
    const d = Object.assign({}, tvDevicesView());
    change(d);
    state.tableView = normalizeTableView({ devices: d });
}
function tvColumnsEdit(fn) {
    if (readOnlyRefuses()) return;
    batch(() => { fn(); save(); renderCanvasOnly(); });
    renderColumnsDialog();
}

function addCustomColumn(name, kind) {
    if (readOnlyRefuses()) return null;
    const why = customNameProblem(name);
    if (why) { showToast(why, 'err'); return null; }
    if ((state.columns || []).length >= CUSTOM_MAX) { showToast(t('A network can have at most {n} columns of its own.', { n: CUSTOM_MAX }), 'err'); return null; }
    const col = { id: nextCustomId(), name: customName(name), kind: asCustomKind(kind) };
    tvColumnsEdit(() => { state.columns = (state.columns || []).concat(col); });
    return col;
}
function renameCustomColumn(id, name) {
    const col = customColumnById(id);
    if (!col || customName(name) === col.name) return true;
    const why = customNameProblem(name, id);
    if (why) { showToast(why, 'err'); return false; }
    tvColumnsEdit(() => { state.columns = state.columns.map((c) => (c.id === id ? Object.assign({}, c, { name: customName(name) }) : c)); });
    return true;
}
// Gone with every device's value for it; a column that holds something asks
// first, as deleting a group with devices in it does.
function deleteCustomColumn(id) {
    const col = customColumnById(id);
    if (!col || readOnlyRefuses()) return Promise.resolve(false);
    const n = state.nodes.filter((nd) => customValueOf(nd, id) !== undefined).length;
    const go = () => {
        tvColumnsEdit(() => {
            state.columns = state.columns.filter((c) => c.id !== id);
            state.nodes.forEach((nd) => setCustomValue(nd, id, undefined));
            tvSetDevicesView((d) => {
                d.order = (d.order || []).filter((k) => k !== `x:${id}`);
                d.hidden = (d.hidden || []).filter((k) => k !== `x:${id}`);
            });
        });
        return true;
    };
    if (!n) return Promise.resolve(go());
    return askConfirm(t(n === 1 ? 'Delete the column {name}? One device loses what it holds.' : 'Delete the column {name}? {n} devices lose what it holds.', { name: col.name, n }),
        { ok: t('Delete column'), danger: true }).then((yes) => (yes ? go() : false));
}
// Another kind: every value is read again as the new kind reads it, from the
// text it shows now (a yes is "yes", a date its ISO form), so text takes
// anything and a number column turned to text keeps every number. Values the
// new kind refuses are lost, and the question says how many first.
function changeCustomKind(id, kind) {
    const col = customColumnById(id);
    if (!col || col.kind === kind || !CUSTOM_KINDS.includes(kind) || readOnlyRefuses()) return Promise.resolve(false);
    const next = Object.assign({}, col, { kind });
    const held = state.nodes.filter((nd) => customValueOf(nd, id) !== undefined);
    const lost = held.filter((nd) => parseCustomValue(next, customText(col, customValueOf(nd, id))).error).length;
    const go = () => {
        tvColumnsEdit(() => {
            held.forEach((nd) => setCustomValue(nd, id, parseCustomValue(next, customText(col, customValueOf(nd, id))).value));
            state.columns = state.columns.map((c) => (c.id === id ? next : c));
        });
        return true;
    };
    if (!lost) return Promise.resolve(go());
    return askConfirm(t(lost === 1 ? 'One device holds a value in {name} that is not a {kind}: it will be lost.' : '{n} devices hold a value in {name} that is not a {kind}: they will be lost.',
        { name: col.name, kind: t(CUSTOM_KIND_NAMES[kind]).toLowerCase(), n: lost }), { ok: t('Change kind'), danger: true })
        .then((yes) => { if (yes) return go(); renderColumnsDialog(); return false; });
}
function setColumnShown(key, on) {
    if (key === TV_FIXED_COL) return;
    tvColumnsEdit(() => tvSetDevicesView((d) => {
        const hidden = new Set(d.hidden || []);
        if (on) hidden.delete(key); else hidden.add(key);
        d.hidden = [...hidden];
    }));
}
// One place along, among every column but Name (hidden ones included, so a
// hidden column keeps its place for when it is shown again).
function moveColumn(key, step) {
    const keys = tvDevicesOrder().map((c) => c.key);
    const at = keys.indexOf(key), to = at + step;
    if (at < 0 || to < 0 || to >= keys.length) return;
    [keys[at], keys[to]] = [keys[to], keys[at]];
    tvColumnsEdit(() => tvSetDevicesView((d) => { d.order = keys; }));
}
function resetColumns() {
    tvColumnsEdit(() => { state.tableView = {}; });
}

function renderColumnsDialog() {
    const list = colsEl('colsList');
    if (!list || colsEl('colsDialog').hidden) return;
    const hidden = new Set(tvDevicesView().hidden || []);
    const order = tvDevicesOrder();
    const row = (c, i) => {
        const custom = c.custom ? customColumnById(c.custom) : null;
        const label = custom ? custom.name : tvLabel(c);
        const fixed = c.key === TV_FIXED_COL;
        const nameCell = custom
            ? `<input type="text" class="input cols-name" data-rename="${escapeHtml(custom.id)}" value="${escapeHtml(custom.name)}" maxlength="${CUSTOM_NAME_MAX}" aria-label="${escapeHtml(t('Column name'))}">
               <select class="select cols-kind" data-kind="${escapeHtml(custom.id)}" aria-label="${escapeHtml(t('Kind'))}">${CUSTOM_KINDS.map((k) =>
                   `<option value="${k}"${k === custom.kind ? ' selected' : ''}>${escapeHtml(t(CUSTOM_KIND_NAMES[k]))}</option>`).join('')}</select>`
            : `<span class="cols-label">${escapeHtml(label)}</span>`;
        return `<li class="cols-row${custom ? ' cols-custom' : ''}" data-key="${escapeHtml(c.key)}">
            <input type="checkbox" data-show="${escapeHtml(c.key)}"${fixed || !hidden.has(c.key) ? ' checked' : ''}${fixed ? ' disabled' : ''}
                aria-label="${escapeHtml(t('Show {name}', { name: label }))}">
            ${nameCell}
            <span class="cols-acts">${fixed ? '' : `
                <button type="button" class="cs-btn cols-mv" data-move="-1" data-key="${escapeHtml(c.key)}"${i === 0 ? ' disabled' : ''} title="${escapeHtml(t('Move up'))}" aria-label="${escapeHtml(t('Move up'))}">↑</button>
                <button type="button" class="cs-btn cols-mv" data-move="1" data-key="${escapeHtml(c.key)}"${i === order.length - 1 ? ' disabled' : ''} title="${escapeHtml(t('Move down'))}" aria-label="${escapeHtml(t('Move down'))}">↓</button>`}
                ${custom ? `<button type="button" class="cs-btn cols-del" data-delete="${escapeHtml(custom.id)}" title="${escapeHtml(t('Delete column'))}" aria-label="${escapeHtml(t('Delete column'))}">✕</button>` : ''}
            </span>
        </li>`;
    };
    list.innerHTML = row(TV_COLS.devices.find((c) => c.key === TV_FIXED_COL), -1) + order.map(row).join('');
    const full = (state.columns || []).length >= CUSTOM_MAX;
    colsEl('colsAddBtn').disabled = full || !!state.readOnly;
    colsEl('colsResetBtn').disabled = !tvDevicesView().order && !tvDevicesView().hidden;
}

function openColumnsDialog() {
    if (!tableShown()) return;
    cancelEdit(true);
    const scrim = colsEl('colsDialog');
    colsEl('colsNewName').value = '';
    colsEl('colsNewKind').value = 'text';
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onClose: () => { _tv.keepFocus = true; renderTableView(true); } });
    else scrim.hidden = false;
    renderColumnsDialog();
}
function closeColumnsDialog() {
    const scrim = colsEl('colsDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
}

(function wireColumnsDialog() {
    const scrim = colsEl('colsDialog');
    if (!scrim) return;
    colsEl('tvColsBtn').onclick = () => openColumnsDialog();
    const list = colsEl('colsList');
    list.addEventListener('change', (e) => {
        const key = e.target.dataset && e.target.dataset.show;
        if (key) setColumnShown(key, e.target.checked);
        const kindOf = e.target.dataset && e.target.dataset.kind;
        if (kindOf) changeCustomKind(kindOf, e.target.value);
    });
    list.addEventListener('click', (e) => {
        const mv = e.target.closest('[data-move]');
        if (mv) { moveColumn(mv.dataset.key, Number(mv.dataset.move)); return; }
        const del = e.target.closest('[data-delete]');
        if (del) deleteCustomColumn(del.dataset.delete);
    });
    // A name is kept when the field is left or Enter is pressed; one that is
    // refused goes back to what it was.
    const rename = (input) => { if (!renameCustomColumn(input.dataset.rename, input.value)) renderColumnsDialog(); };
    list.addEventListener('focusout', (e) => { if (e.target.dataset && e.target.dataset.rename) rename(e.target); });
    list.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.dataset && e.target.dataset.rename) { e.preventDefault(); rename(e.target); }
    });
    const add = () => {
        if (addCustomColumn(colsEl('colsNewName').value, colsEl('colsNewKind').value)) {
            colsEl('colsNewName').value = '';
            colsEl('colsNewName').focus();
        }
    };
    colsEl('colsAddBtn').addEventListener('click', add);
    colsEl('colsNewName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    colsEl('colsResetBtn').addEventListener('click', resetColumns);
})();

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
