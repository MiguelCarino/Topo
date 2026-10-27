// ---- Spreadsheets: the CSV / TSV round-trip (plan 3.5) ----
// A register is kept in spreadsheets as often as in Topo, and a site arrives
// as one (an inventory, a DHCP export, a patch list) more often than as a
// drawing. This is the way across, both ways, in the full editor's File menu.
//
// Export: six sheets, each a UTF-8 CSV file with a byte-order mark (Excel
// reads a BOM-less UTF-8 file as the local code page, which turns "Cámara" and
// every Japanese name into mojibake), or the same rows as TSV on the clipboard
// to paste straight into an open sheet.
//
//   devices      one row per device: the NODE_FIELDS columns (js/model.js),
//                then one NIC (interface_id, interface, ip, mac) and where
//                it is patched (switch, port, and local_port, the device's
//                own end), so the common case, one address per device, is
//                one row. The NIC is the one the uplink is on, else the
//                first: a router's row is its LAN side.
//   interfaces   one row per interface, keyed by the device's id AND the
//                interface's: interface ids repeat across devices (every PC
//                has an i1), so the interface id alone names nothing. With
//                the device's type, and a row with blank interface cells for
//                a device with none (a switch that is all faceplate), so the
//                sheet names every device on the map.
//   cables       one row per cable: both ends by id and by name, the port on
//                each as the map labels it ("3", "eth0"), the medium, and the
//                cable's own facts (CABLE_FIELDS: label, length, colour, via).
//   ports        one row per faceplate port of every switch and access
//                point: the device, the port as the box names it
//                (node.portScheme: "Gi1/0/12"), its label and access VLAN
//                (node.portAttrs), and what is plugged into it, for reading.
//                The patch list a technician walks the rack with.
//   subnets      one row per declared network (doc.networks, the Subnets
//                tab): its CIDR, name, VLAN, purpose, gateway, DNS, DHCP and
//                zone. A device inherits its gateway and DNS from here (R7),
//                so devices.csv leaves those cells blank on a device that
//                inherits them; without this sheet a site came back from a
//                spreadsheet with every network gone and every inheriting
//                device with no gateway or DNS at all.
//   findings     the findings, as the panel and the report word them. Export
//                only: a finding is a conclusion, not a record.
//
// The headers are the schema's `csv` names, so a sheet exported here and
// imported again maps itself.
//
// Formula injection: a cell that starts with = + - @ (or a tab or a carriage
// return) is an instruction to a spreadsheet, not text, and a device name is
// whatever whoever typed it chose. Such a cell is written with a leading
// apostrophe, which every spreadsheet reads as "this is text" (OWASP's
// advice). A plain number is left alone: -40 is a coordinate, not a formula.
// Import takes the apostrophe off again, so the round-trip loses nothing; a
// value that really starts with an apostrophe and one of those characters gets
// a second one on the way out for the same reason.
//
// Import: a file, or rows pasted from a spreadsheet, in three steps.
//   1. Map the columns. Each column is matched to a field by its heading
//      (the schema's csv names and the usual spellings: "IP address",
//      "Hostname", "MAC address"…), or, with no heading row, by what its
//      values look like. Unmapped columns are ignored, as NetBox does: the
//      schema is the allowlist, and there is deliberately no free-form attrs
//      map to put the rest in (Review notes: it would carry any key into a
//      share link).
//   2. Each row is matched to a device by id, then asset tag (once that field
//      exists in NODE_FIELDS: the matcher is generated from it), then MAC,
//      then IP, then name, the first that finds exactly one device. A key
//      that finds two is a conflict, never a guess. Only mapped columns are
//      applied, and a blank cell leaves its field as it is (as in Paste a
//      column and the bulk panel: blank means "not saying", not "clear it").
//      A row that matches nothing becomes a new device, cabled to switch:port
//      when the sheet has those columns, and the new devices are laid out
//      among themselves, under the switch they hang off (a Tidy of the new
//      devices only: nothing already drawn moves). Rows of interfaces.csv
//      with the same unknown device id are one new device with several
//      interfaces.
//   3. Review: every row as added, changed, unchanged or conflict, with what
//      it changes and why a conflict is one, and the findings delta from the
//      pure engine on a scratch copy, as the bulk panel's preview has it.
//      Apply writes it as one transaction (batch: one undo step, one save,
//      one redraw), and every record it touched or made is read back through
//      the document's normalizer (readFields over NODE_FIELDS / LINK_FIELDS,
//      what replaceDocument and undo read through), so nothing the importer
//      wrote can be a shape a loaded document could not be.
//
// A row is applied whole or not at all: a value the schema refuses, a match
// that is ambiguous, a port already taken or a field another row sets
// differently makes the row a conflict, and nothing of it is written. What a
// row asks for that import does not do (moving a cable that is already
// plugged in elsewhere, NAT on a host) is said on the row and left as it is,
// and the rest of the row still applies.
//
// A sheet is devices (devices.csv, interfaces.csv, an inventory), cables
// (cables.csv, a patch list), ports (ports.csv) or subnets (subnets.csv): a
// heading row naming a network_id or a cidr column is read as subnets, every
// column against the network's fields (its "name" is the network's, not a
// device's). A subnet row is found by its id, then by its CIDR; an unknown
// one is a new network. Its CIDR is what it is found by, never rewritten:
// moving a network is Renumber, in the Subnets tab, which carries every
// member with it. Otherwise: mapping a cable_id,
// from_device or to_device column makes it cables, and a port label or access
// VLAN column makes it ports. A port row names its device (id, else name) and
// the port (as the box names it, or its number), and sets the label and the
// VLAN, blank leaving either as it is; it never cables anything. A cable row is matched by its id, then by its two
// ends; an unmatched one is a new cable between two devices already on the
// map; a matched one can change its medium and attachment. A port it names
// on a device without a faceplate that the device lacks is a NIC it gains.
//
// The round trip: devices.csv and interfaces.csv (in either order) and then
// cables.csv, imported into a blank map, rebuild it with every cable on the
// same ports, and subnets.csv, before them or after, gives back the networks
// and so every inherited gateway and DNS (tests/suites/csv.js runs it over
// every template). cables.csv joins devices already on the map, so it comes
// after one of the other two.
//
// The same box also takes an ARP table or a DHCP lease list pasted as it was
// printed, read by one tolerant extractor into rows of address, MAC and name
// ("Paste anything", below the plan's writer), into the same review.
//
// Nothing leaves the page: the file is read with FileReader, the export is a
// Blob download, and the clipboard is written only on a click.
//
// The full editor's, like the table and the bulk panel: technical vocabulary
// (IP / CIDR, MAC, Gateway, the csv names) stays English, as the comment in
// applyProfile (js/app.js) explains; plain words and sentences are translated
// (MESSAGES, js/i18n.js). A reduced view has no Export menu entry for it.
//
// Load order: ... bulk -> add -> csv -> app

// ============================================================================
// Encoding and parsing (pure)
// ============================================================================
const CSV_BOM = '﻿';
const CSV_TRIGGER_RE = /^[=+\-@\t\r]/;
const CSV_GUARDED_RE = /^'[=+\-@\t\r]/;
const CSV_NUMBER_RE = /^-?\d+(\.\d+)?$/;

// The formula guard: see the header.
function csvGuard(value) {
    const s = value == null ? '' : String(value);
    if (CSV_GUARDED_RE.test(s)) return `'${s}`;
    return CSV_TRIGGER_RE.test(s) && !CSV_NUMBER_RE.test(s) ? `'${s}` : s;
}
// One apostrophe off, when what follows is a trigger or a guarded one.
const csvUnguard = (s) => (/^'(?='?[=+\-@\t\r])/.test(s) ? s.slice(1) : s);

// RFC 4180: quoted when it holds the separator, a quote or a line break, and
// a quote inside is doubled. Spreadsheets parse TSV the same way, so a note
// with a line break survives a paste as one cell.
function csvCell(value, sep) {
    const s = csvGuard(value);
    return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvText(sheet, sep = ',') {
    const eol = sep === ',' ? '\r\n' : '\n';
    return [sheet.headers, ...sheet.rows].map((r) => r.map((c) => csvCell(c, sep)).join(sep)).join(eol) + eol;
}

// The separator of a pasted or opened sheet, from its first line: a tab when
// there is one (a spreadsheet's copy), a semicolon when there are more of
// those than commas (Excel's CSV wherever the comma is the decimal mark),
// else a comma.
function csvSniff(text) {
    const first = text.split(/\r\n|\n|\r/, 1)[0] || '';
    if (first.includes('\t')) return '\t';
    const count = (ch) => first.split(ch).length - 1;
    return count(';') > count(',') ? ';' : ',';
}

// -> { sep, rows: [[cell]] }. Quotes as RFC 4180 has them; a BOM is dropped;
// rows with nothing in them are left out; ragged rows are padded on reading.
function csvParse(text) {
    let s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    const sep = csvSniff(s);
    const rows = [];
    let row = [], cell = '', quoted = false, i = 0;
    const endCell = () => { row.push(cell); cell = ''; };
    const endRow = () => { endCell(); rows.push(row); row = []; };
    while (i < s.length) {
        const ch = s[i];
        if (quoted) {
            if (ch === '"') {
                if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
                quoted = false; i++; continue;
            }
            cell += ch; i++; continue;
        }
        if (ch === '"' && cell === '') { quoted = true; i++; continue; }
        if (ch === sep) { endCell(); i++; continue; }
        if (ch === '\r' || ch === '\n') { endRow(); i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1; continue; }
        cell += ch; i++;
    }
    if (cell !== '' || row.length) endRow();
    return { sep, rows: rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => r.map(csvUnguard)) };
}

// ============================================================================
// Export (pure: the sheets as { headers, rows })
// ============================================================================
// A schema value as a cell. Booleans are true/false (any spreadsheet, any
// language, reads them back); an unset count is blank.
function csvValue(field, v) {
    // A field whose value is not one cell of text (the port naming scheme)
    // says how it is written as one.
    if (field.toText) return field.toText(v);
    if (field.kind === 'bool' || field.kind === 'flag') return v ? 'true' : 'false';
    if (field.kind === 'tristate') return typeof v === 'boolean' ? String(v) : '';
    if (v == null) return '';
    return String(v);
}
// The device columns: every NODE_FIELDS row with a csv name, in table order.
// interfaces is a list, not a cell; it is the interfaces sheet.
const csvNodeFields = () => NODE_FIELDS.filter((f) => f.csv && f.key !== 'interfaces');
const csvIfaceField = (key) => IFACE_FIELDS.find((f) => f.key === key);

// Where a device is patched: its first cable onto a switch or an AP, the
// same choice the bulk panel's "by switch port" order makes (patchPoint).
// own is the device's end of that cable (an interface id), so a sheet can say
// which of its NICs the cable is on: a router's LAN cable is on eth1, and a
// row that left that to the binder put it on whatever NIC was free (the WAN).
function csvUplink(node) {
    let best = null;
    linksAtNode(node.id).forEach((l) => {
        const peerId = l.source === node.id ? l.target : l.source;
        const peer = getNode(peerId);
        if (!hasPortGrid(peer)) return;
        const m = /^p(\d+)$/.exec(ifaceIdOn(l, peerId) || '');
        const at = { peer, link: l, port: m ? Number(m[1]) : Infinity };
        if (!best || naturalCompare(peer.name, best.peer.name) < 0 || (peer.name === best.peer.name && at.port < best.port)) best = at;
    });
    return best ? { peer: best.peer, port: ifaceLabel(best.peer, ifaceIdOn(best.link, best.peer.id)), own: ifaceIdOn(best.link, node.id) || null } : null;
}

function csvDevicesSheet() {
    const fields = csvNodeFields();
    const headers = fields.map((f) => f.csv).concat(['interface_id', 'interface', 'ip', 'mac', 'switch', 'port', 'local_port']);
    const rows = state.nodes.map((node) => {
        const up = csvUplink(node);
        // The NIC the uplink is on, else the first: one row is one NIC and
        // where it is plugged in. A switch's own end is a faceplate port, not
        // a NIC, so its row keeps its first interface (a management VLAN).
        const list = node.interfaces || [];
        const nic = (up && up.own && list.find((i) => i.id === up.own)) || list[0] || null;
        // NAT means something only on a routing device (the sidebar, the
        // table and the bulk panel all say so); elsewhere the cell is blank.
        // Port names likewise only on a switch or an AP: one retyped to a PC
        // keeps its scheme in memory, but the file and the sealed link leave
        // it out (the schema's write), and a sheet that kept it would not
        // read back ("Only a switch or an access point has numbered ports").
        const cells = fields.map((f) => ((f.key === 'nat' && !isRoutingDevice(node.type)) || (f.key === 'portScheme' && !hasPortGrid(node)) ? '' : csvValue(f, node[f.key])));
        return cells.concat([nic ? nic.id : '', nic ? nic.name || '' : '', nic ? nic.ip || '' : '', nic && !isBlank(nic.mac) ? fmtColonSafe(nic.mac) : '',
            up ? up.peer.name || up.peer.id : '', up ? up.port : '', up && up.own ? ifaceLabel(node, up.own) : '']);
    });
    return { name: 'devices', headers, rows };
}

// A device with no interface of its own (a switch that is all faceplate) is
// a row too, with the interface cells blank: interfaces.csv alone then names
// every device, and its type, so cables.csv after it has both ends of every
// cable and a switch is a switch (with a port grid), not a custom box.
function csvInterfacesSheet() {
    const keys = ['id', 'name', 'ip', 'mac', 'wireless', 'bond'];
    const headers = ['device_id', 'device', 'type'].concat(keys.map((k) => csvIfaceField(k).csv));
    const rows = [];
    state.nodes.forEach((node) => {
        const head = [node.id, node.name || '', node.type || ''];
        const list = node.interfaces || [];
        if (!list.length) { rows.push(head.concat(keys.map(() => ''))); return; }
        list.forEach((iface) => {
            rows.push(head.concat(keys.map((k) => {
                if (k === 'mac') return isBlank(iface.mac) ? '' : fmtColonSafe(iface.mac);
                return csvValue(csvIfaceField(k), iface[k]);
            })));
        });
    });
    return { name: 'interfaces', headers, rows };
}

function csvCablesSheet() {
    const name = (id) => { const n = getNode(id); return n ? n.name || n.id : ''; };
    const port = (id, ifaceId) => { const n = getNode(id); return n && ifaceId ? ifaceLabel(n, ifaceId) : ''; };
    const headers = ['cable_id', 'from_device', 'from_name', 'from_port', 'to_device', 'to_name', 'to_port', 'medium', 'attachment']
        .concat(CABLE_FIELDS.map((f) => f.csv));
    const rows = state.links.filter((l) => getNode(l.source) && getNode(l.target)).map((l) => [
        l.id, l.source, name(l.source), port(l.source, l.sourceIface), l.target, name(l.target), port(l.target, l.targetIface),
        l.medium || '', l.attachment || ''].concat(CABLE_FIELDS.map((f) => cableOf(l, f.key))));
    return { name: 'cables', headers, rows };
}

// In the order the report lists them: critical first, then as the checks ran;
// the open ones, then those accepted with a reason, which the last column
// gives (empty on an open finding).
function csvFindingsSheet() {
    const order = (a, b) => (a.f.level === b.f.level ? a.seq - b.seq : (a.f.level === 'bad' ? -1 : 1));
    const all = topologyFindings().map((f, seq) => ({ f, seq }));
    const list = all.filter(({ f }) => !f.accepted).sort(order).concat(all.filter(({ f }) => f.accepted).sort(order));
    return { name: 'findings', headers: ['severity', 'subject', 'check', 'finding', 'accepted'],
        rows: list.map(({ f }) => [t(SEVERITY_NAMES[f.level] || f.level), f.subject || '', f.check || '', sentenceCase(f.detail || ''), f.accepted ? f.accepted.reason : '']) };
}

// Every faceplate port, free ones too: a free port with a label is the jack
// the next device goes in, and a free port with none is a free port, which
// is what the sheet is often wanted for. connected_device and
// connected_port are for reading; import ignores them (it never cables
// from this sheet), so their headings are not the ones the cabling columns
// answer to.
function csvPortsSheet() {
    const rows = [];
    state.nodes.filter(hasPortGrid).forEach((node) => {
        faceplatePortIds(node).forEach((id) => {
            const a = portAttrOf(node, id);
            const link = linkOnIface(node.id, id);
            const peerId = link ? (link.source === node.id ? link.target : link.source) : null;
            const peer = peerId ? getNode(peerId) : null;
            rows.push([node.id, node.name || '', ifaceLabel(node, id), a.label, a.vlan === null ? '' : String(a.vlan),
                peer ? peer.name || peer.id : '', peer ? ifaceLabel(peer, ifaceIdOn(link, peerId)) : '']);
        });
    });
    return { name: 'ports', headers: ['device_id', 'device', 'port', 'port_label', 'port_vlan', 'connected_device', 'connected_port'], rows };
}

// The declared networks, in the Subnets tab's order (numeric, IPv4 first):
// every NETWORK_FIELDS column, under its csv name.
function csvSubnetsSheet() {
    const nets = state.networks.slice().sort((a, b) => compareCidr(a.cidr, b.cidr));
    return { name: 'subnets', headers: NETWORK_FIELDS.map((f) => f.csv),
        rows: nets.map((net) => NETWORK_FIELDS.map((f) => csvValue(f, net[f.key]))) };
}

const CSV_SHEETS = [
    { key: 'devices', label: 'Devices', plain: true, build: csvDevicesSheet },
    { key: 'interfaces', label: 'Interfaces', build: csvInterfacesSheet },
    { key: 'cables', label: 'Cables', plain: true, build: csvCablesSheet },
    { key: 'ports', label: 'Ports', build: csvPortsSheet },
    { key: 'subnets', label: 'Subnets', build: csvSubnetsSheet },
    { key: 'findings', label: 'Findings', plain: true, build: csvFindingsSheet }
];
const csvSheetLabel = (s) => (s.plain ? t(s.label) : s.label);

function downloadCsv(key) {
    const sheet = CSV_SHEETS.find((s) => s.key === key);
    if (!sheet) return;
    const blob = new Blob([CSV_BOM + csvText(sheet.build(), ',')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${docFileStem()}-${key}.csv`; a.click();
    URL.revokeObjectURL(url);
}

async function copyTsv(key) {
    const sheet = CSV_SHEETS.find((s) => s.key === key);
    if (!sheet) return false;
    const text = csvText(sheet.build(), '\t');
    let done = false;
    try { await navigator.clipboard.writeText(text); done = true; } catch (e) { /* the fallback below */ }
    if (!done) {
        // A browser that refuses the async clipboard (an http page, an old
        // WebKit) still copies a selected textarea on a click.
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { done = document.execCommand('copy'); } catch (e) { done = false; }
        ta.remove();
    }
    showToast(done ? t('Copied {n} rows as TSV. Paste them into a sheet.', { n: sheet.build().rows.length }) : t('Could not copy to the clipboard.'), done ? 'ok' : 'err');
    return done;
}

// ============================================================================
// Import: the fields a column can be mapped to
// ============================================================================
// Generated from the schema: every NODE_FIELDS / IFACE_FIELDS / LINK_FIELDS row
// with a csv name is a target, under its csv name, its label and the usual
// spellings of it. A field added to the schema with a csv name can be imported
// with nothing else to write; the aliases are only extra spellings.
//   group  'device' | 'iface' | 'cabling' | 'cable': which records it writes,
//          and which kind of sheet it makes (see csvSheetKind).
//   parse  (text) -> { value } | { error } | { needsPrefix }
const csvNorm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_\-./]+/g, ' ').trim();
const CSV_ALIASES = {
    id: ['device id', 'node id', 'device_id'],
    name: ['device', 'device name', 'hostname', 'host name', 'host', 'nombre', 'nome', 'имя', '名前', 'ホスト名'],
    type: ['kind', 'role', 'device type', 'tipo', 'тип', '種類'],
    gw: ['gw', 'default gateway', 'puerta de enlace'],
    dns: ['dns server', 'dns servers', 'nameserver', 'resolver'],
    os: ['firmware', 'os firmware', 'model', 'modelo', 'operating system'],
    ports: ['ports', 'allowed ports', 'open ports', 'services'],
    notes: ['note', 'comment', 'comments', 'description', 'notas', 'observaciones', 'заметки', 'メモ'],
    portCount: ['port count', 'ports count'],
    portScheme: ['first port', 'port 1', 'port naming', 'port scheme', 'port names'],
    // A port's own facts (node.portAttrs): ports.csv.
    // Not a bare "vlan" or "jack": an inventory with a VLAN column (the
    // device's network) would turn into a sheet of ports and be refused.
    'pt:label': ['port label', 'port description', 'etiqueta del puerto'],
    'pt:vlan': ['port vlan', 'access vlan', 'port access vlan'],
    // The Asset group (js/assets.js).
    serial: ['serial', 'serial no', 'serial number', 's n', 'sn', 'número de serie', 'numero de serie', 'número de série', 'серийный номер', 'シリアル番号'],
    assetTag: ['asset', 'asset id', 'asset tag', 'asset number', 'tag', 'inventory number', 'etiqueta', 'patrimonio', 'patrimônio', 'инвентарный номер', '資産番号'],
    location: ['room', 'rack', 'site location', 'ubicación', 'ubicacion', 'localização', 'местоположение', '場所', '設置場所'],
    status: ['state', 'lifecycle', 'estado', 'situação', 'статус', 'ステータス'],
    'lk:cable.label': ['label', 'cable label', 'cable id label', 'etiqueta del cable'],
    'lk:cable.length': ['length', 'cable length', 'longitud'],
    'lk:cable.color': ['color', 'colour', 'cable color', 'cable colour'],
    'lk:cable.via': ['via', 'patch', 'patch panel', 'path', 'run'],
    'if:name': ['iface', 'nic', 'interface name'],
    'if:ip': ['ip address', 'ipv4', 'ipv4 address', 'address', 'ip cidr', 'ip_address', 'dirección ip', 'endereço ip', 'ip адрес', 'ipアドレス'],
    'if:mac': ['mac address', 'hw address', 'hwaddr', 'hardware address', 'physical address', 'dirección mac', 'endereço mac'],
    'cab:switch': ['switch', 'switch name', 'uplink', 'connected to', 'patched to'],
    'cab:port': ['port', 'switch port', 'switchport', 'switch_port'],
    'cab:local': ['local port', 'local interface', 'own port', 'device port'],
    'lk:source': ['from', 'source', 'a end', 'from device'],
    'lk:target': ['to', 'target', 'b end', 'to device'],
    'lk:sourceIface': ['from port', 'source port'],
    'lk:targetIface': ['to port', 'target port'],
    // A subnet's (subnets.csv). Guessed only in a sheet of subnets (see
    // csvAutoMap), so "name" and "gateway" there are the network's.
    'net:id': ['network id', 'subnet id'],
    'net:cidr': ['subnet', 'network', 'network address', 'prefix', 'red', 'rede', 'подсеть', 'サブネット'],
    'net:name': ['network name', 'subnet name', 'nombre', 'nome', 'имя', '名前'],
    'net:vlan': ['vlan id'],
    'net:gateway': ['gw', 'default gateway', 'router', 'puerta de enlace'],
    'net:dns': ['dns server', 'dns servers', 'nameserver', 'resolver'],
    'net:drawZone': ['zone', 'draw zone']
};

const csvTextParse = (field) => (text) => {
    const v = String(text).trim();
    return field && field.validate && !field.validate(v) ? { error: true } : { value: v };
};
const csvNumber = (text) => { const n = Number(String(text).trim()); return Number.isFinite(n) ? { value: n } : { error: true }; };

// A type by its key, its palette name, the Add devices kind name, or a common
// word for it ("laptop", "access point").
const CSV_TYPE_WORDS = { computer: 'pc', workstation: 'pc', desktop: 'pc', laptop: 'pc', notebook: 'pc', pc: 'pc', phone: 'voip', 'ip phone': 'voip',
    'access point': 'ap', wifi: 'ap', 'wi fi': 'ap', nas: 'server', modality: 'dicom', 'ip camera': 'camera', cctv: 'camera', 'smart tv': 'iot', tv: 'iot' };
function csvTypeParse(text) {
    const v = csvNorm(text);
    const def = paletteDefs.find((d) => d.type === v || csvNorm(d.name) === v);
    if (def) return { value: def.type };
    const kind = ADD_KINDS.concat([ADD_HUB]).find((k) => csvNorm(k.name) === v);
    if (kind) return { value: kind.type };
    return CSV_TYPE_WORDS[v] ? { value: CSV_TYPE_WORDS[v] } : { error: true };
}
// An address without a prefix takes the one of the network it falls in: a
// declared network first, then a subnet already drawn. With neither, it is
// refused rather than given a /24 nobody said.
function csvIpParse(text) {
    const v = String(text).trim();
    if (parseValidCIDR(v)) return { value: v };
    const ip = parseIpText(v);
    if (!ip) return { error: true };
    const net = networkOfIp(ip);
    if (net) return { value: `${ip.toString()}/${parseValidCIDR(net.cidr).prefix}` };
    for (const n of state.nodes) {
        const hit = getValidIps(n).find((p) => p.kind === ip.kind() && ip.match(p.cidrObj));
        if (hit) return { value: `${ip.toString()}/${hit.prefix}` };
    }
    return { error: true, needsPrefix: true };
}
function csvCountParse(text) {
    const n = Number(String(text).trim());
    return Number.isInteger(n) && n >= 1 && n <= 4096 ? { value: n } : { error: true };
}

// Per field, where the schema row's own validator is not the whole story.
const CSV_PARSERS = {
    type: csvTypeParse,
    name: (text) => (String(text).trim() ? { value: String(text).trim() } : { error: true }),
    nat: (text) => tvBoolParse(text),
    // Kept as typed, line breaks and all, as the table's Notes cell does.
    notes: (text) => ({ value: String(text) }),
    portCount: csvCountParse,
    // The name of port 1, as devices.csv writes it: "Gi1/0/1" is the prefix
    // Gi1/0/ counted from 1. "1" (or blank on a new device) is no scheme.
    // A prefix the scheme cannot hold is refused here, not cut down to one
    // it can: normalizePortScheme() keeps the first PORT_PREFIX_MAX
    // characters and drops a prefix ending in a digit, so a 40-character
    // cell came back as "no scheme" and the review showed a change that
    // wiped the switch's port names instead of a conflict.
    portScheme: (text) => {
        const sc = NODE_FIELDS.find((f) => f.key === 'portScheme').fromText(text);
        if (!sc) return { error: true };
        const prefix = String(sc.prefix).replace(/^\s+/, '');
        if (prefix.length > PORT_PREFIX_MAX || !portPrefixOk(prefix)) return { error: true };
        return { value: normalizePortScheme(sc) };
    },
    'pt:label': (text) => { const v = String(text).trim(); return fieldOk.tag(v) ? { value: v } : { error: true }; },
    'pt:vlan': (text) => { const n = asVlan(String(text).trim()); return n === undefined ? { error: true } : { value: n }; },
    // planned / active / retired, by key or by its name in the page's
    // language; a word that is none of them is refused, not blanked.
    status: (text) => { const r = tvStatusParse(text); return r.value === undefined ? { error: true } : r; },
    x: csvNumber, y: csvNumber,
    'if:ip': csvIpParse,
    'if:mac': (text) => { const r = csvTextParse(csvIfaceField('mac'))(text); return r.error ? r : { value: fmtColonSafe(r.value) }; },
    'if:wireless': (text) => tvBoolParse(text),
    // "802.3ad n1 n2": a mode Topo knows, then at least one member.
    'if:bond': (text) => { const b = csvIfaceField('bond').fromText(text); return b ? { value: b } : { error: true }; },
    'lk:medium': (text) => tvMediumParse(text),
    // The two the link's property panel offers; blank is the default.
    'lk:attachment': (text) => { const v = csvLower(text); return v === 'bridged' || v === 'passthrough' ? { value: v } : { error: true }; },
    // Held canonical, as the document holds it: "10.0.1.7/24" is 10.0.1.0/24.
    'net:cidr': (text) => { const v = canonicalCidr(String(text)); return v ? { value: v } : { error: true }; },
    'net:id': (text) => ({ value: String(text).trim() }),
    'net:vlan': (text) => { const n = asVlan(String(text).trim()); return n === undefined ? { error: true } : { value: n }; },
    'net:dhcp': (text) => tvBoolParse(text),
    'net:drawZone': (text) => tvBoolParse(text)
};

// Labels that are not a heading for their field: port count's label is
// "Ports", and a sheet's "Ports" column is the services list far more often.
const CSV_NOT_NAMES = { portCount: ['ports'] };

// Built once the schema exists (it is a classic script loaded before this one).
function csvBuildTargets() {
    const out = [];
    const add = (key, group, field, label, plain) => out.push({
        key, group, field, label: label || field.label, plain: !!plain,
        csv: field ? field.csv : null,
        parse: CSV_PARSERS[key] || csvTextParse(field),
        names: new Set([field && field.csv, field && field.label, label, ...(CSV_ALIASES[key] || [])].filter(Boolean).map(csvNorm)
            .filter((n) => !(CSV_NOT_NAMES[key] || []).includes(n)))
    });
    const PLAIN = new Set(['name', 'type', 'notes', 'serial', 'assetTag', 'location', 'status']);
    csvNodeFields().forEach((f) => add(f.key, 'device', f, null, PLAIN.has(f.key)));
    ['id', 'name', 'ip', 'mac', 'wireless', 'bond'].forEach((k) => add(`if:${k}`, 'iface', csvIfaceField(k)));
    add('cab:switch', 'cabling', null, 'Switch');
    add('cab:port', 'cabling', null, 'Switch port', true);
    add('cab:local', 'cabling', null, 'Port on the device', true);
    ['id', 'source', 'target', 'sourceIface', 'targetIface', 'medium', 'attachment'].forEach((k) => add(`lk:${k}`, 'cable', LINK_FIELDS.find((f) => f.key === k), null, k === 'source' || k === 'target'));
    // A cable's own facts, kept in link.cable (CABLE_FIELDS, js/model.js).
    CABLE_FIELDS.forEach((f) => add(`lk:cable.${f.key}`, 'cable', f, null, true));
    // A port's own facts, kept in node.portAttrs (js/model.js).
    add('pt:label', 'port', null, 'Port label', true);
    add('pt:vlan', 'port', null, 'Access VLAN');
    // A subnet's own fields (NETWORK_FIELDS, js/model.js): subnets.csv.
    NETWORK_FIELDS.forEach((f) => add(`net:${f.key}`, 'network', f, null, f.key === 'name' || f.key === 'purpose'));
    return out;
}
let _csvTargets = null;
const csvTargets = () => _csvTargets || (_csvTargets = csvBuildTargets());
const csvTarget = (key) => csvTargets().find((tg) => tg.key === key) || null;
const csvTargetLabel = (tg) => (tg.plain ? t(tg.label) : tg.label);

// What a column with this heading most likely is, or ''. A subnet's fields
// are guessed only in a sheet of subnets, and there only they are: "name",
// "gateway" and "dns" are a device's in every other sheet, and an inventory's
// VLAN or Network column must not turn it into a sheet of subnets.
function csvGuessByHeading(heading, subnets) {
    const h = csvNorm(heading);
    if (!h) return '';
    const hit = csvTargets().find((tg) => (tg.group === 'network') === !!subnets && tg.names.has(h));
    return hit ? hit.key : '';
}
// A sheet of subnets says so in its headings: a network_id or a cidr column
// (subnets.csv has both). No device sheet calls a column either.
const CSV_SUBNET_HEADINGS = new Set(['network id', 'cidr']);
const csvIsSubnetSheet = (sheet) => !!sheet.hasHeadings && sheet.headers.some((h) => CSV_SUBNET_HEADINGS.has(csvNorm(h)));
// With no heading row: what a column's values look like (most of them).
function csvGuessByValues(values) {
    const vals = values.map((v) => String(v).trim()).filter(Boolean);
    if (!vals.length) return '';
    const most = (test) => vals.filter(test).length >= Math.ceil(vals.length * 0.8);
    if (most((v) => normMac(v).length === 12 && /^[0-9a-f]{2}([:\-.]?[0-9a-f]{2}){5}$|^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(v))) return 'if:mac';
    if (most((v) => !!parseValidCIDR(v) || !!parseIpText(v))) return 'if:ip';
    return '';
}

// A heading row is there when one of its cells names a field and none of
// them is an address (a sheet with no headings whose first row happens to
// say "Printer" is still data).
function csvHasHeadingRow(rows) {
    const first = rows[0] || [];
    if (!first.some((c) => csvGuessByHeading(c) || CSV_SUBNET_HEADINGS.has(csvNorm(c)))) return false;
    return !first.some((c) => parseValidCIDR(String(c).trim()) || parseIpText(String(c).trim()) || normMac(c).length === 12 && /[:\-.]/.test(c));
}

// -> [targetKey | ''] per column. A field is mapped once: the first column
// that names it wins.
function csvAutoMap(sheet) {
    const used = new Set();
    const subnets = csvIsSubnetSheet(sheet);
    return sheet.headers.map((h, i) => {
        const key = sheet.hasHeadings ? csvGuessByHeading(h, subnets) : csvGuessByValues(sheet.rows.map((r) => r[i] || ''));
        if (!key || used.has(key)) return '';
        used.add(key);
        return key;
    });
}

// { headers, rows, hasHeadings } from parsed rows.
function csvSheet(parsed, hasHeadings) {
    const width = Math.max(0, ...parsed.rows.map((r) => r.length));
    const pad = (r) => Array.from({ length: width }, (_, i) => (r[i] == null ? '' : r[i]));
    const headers = hasHeadings ? pad(parsed.rows[0] || []).map((h, i) => h.trim() || t('Column {n}', { n: i + 1 }))
        : Array.from({ length: width }, (_, i) => t('Column {n}', { n: i + 1 }));
    return { headers, rows: parsed.rows.slice(hasHeadings ? 1 : 0).map(pad), hasHeadings };
}

// 'cables' when a column is mapped to a cable's own field, else 'devices';
// 'mixed' when both: a sheet is one or the other. 'ports' when a column is a
// port's label or VLAN; beside those a port sheet maps only what names the
// device (its id or name) and the port, and anything else is 'mixed-ports'.
const CSV_PORT_SHEET_KEYS = new Set(['id', 'name', 'cab:port']);
function csvSheetKind(mapping) {
    const keys = mapping.filter(Boolean);
    // 'subnets' when a column is a subnet's field, and then every one must be.
    if (keys.some((k) => csvTarget(k).group === 'network')) {
        return keys.every((k) => csvTarget(k).group === 'network') ? 'subnets' : 'mixed-subnets';
    }
    if (keys.some((k) => csvTarget(k).group === 'port')) {
        return keys.every((k) => csvTarget(k).group === 'port' || CSV_PORT_SHEET_KEYS.has(k)) ? 'ports' : 'mixed-ports';
    }
    const groups = new Set(keys.map((k) => csvTarget(k).group));
    const cable = groups.has('cable');
    if (cable && [...groups].some((g) => g !== 'cable')) return 'mixed';
    return cable ? 'cables' : 'devices';
}

// ============================================================================
// Import: the plan (pure: reads the map, writes nothing)
// ============================================================================
// A plan is { kind, rows, ops, counts, errors, newIds, touchedIds }:
//   rows   one per sheet row (in sheet order): { index, name, status, changes:
//          [{ field, before, after }], notes: [text], why }. status is 'add',
//          'change', 'same' or 'conflict'.
//   ops    what Apply writes, as data, so the same plan is written on a
//          scratch copy for the findings delta and on the live document:
//            { create: nodeRecord }
//            { nodeId, set: { key: value }, drop: [keys] }
//            { iface: { nodeId, id, name?, create: bool, set: { key: value } } }
//            { link: { id, source, target, sourceIface, targetIface, attachment, medium? } }
//            { linkId, set: { key: value } }
const csvLower = (s) => String(s || '').trim().toLowerCase();

// Lookups over the devices on the map, built once per plan: a sheet of 600
// rows must not walk 600 devices per row per key.
function csvIndex() {
    const byId = new Map(), byName = new Map(), byMac = new Map(), byIp = new Map(), byTag = new Map();
    const push = (m, k, id) => { if (!k) return; const a = m.get(k) || []; if (!a.includes(id)) a.push(id); m.set(k, a); };
    const tagField = NODE_FIELDS.find((f) => f.key === 'assetTag');
    state.nodes.forEach((n) => {
        byId.set(n.id, [n.id]);
        push(byName, csvLower(n.name), n.id);
        if (tagField) push(byTag, csvLower(n.assetTag), n.id);
        (n.interfaces || []).forEach((i) => {
            const mac = normMac(i.mac);
            if (mac.length === 12) push(byMac, mac, n.id);
            const p = parseValidCIDR(i.ip);
            if (p) push(byIp, p.ip.toString(), n.id);
        });
    });
    return { byId, byName, byMac, byIp, byTag, tagField };
}

// The matchers, strongest first. Each reads one cell of the row and answers
// the ids of the devices it names (none, one, or an ambiguous several).
function csvMatchers(ix) {
    const list = [
        { key: 'id', label: 'ID', find: (v) => ix.byId.get(String(v).trim()) || [] }
    ];
    if (ix.tagField) list.push({ key: 'assetTag', label: ix.tagField.label, find: (v) => ix.byTag.get(csvLower(v)) || [] });
    list.push(
        { key: 'if:mac', label: 'MAC', find: (v) => { const m = normMac(v); return m.length === 12 ? ix.byMac.get(m) || [] : []; } },
        { key: 'if:ip', label: 'IP', find: (v) => { const s = String(v).trim(); const p = parseValidCIDR(s); const ip = p ? p.ip : parseIpText(s); return ip ? ix.byIp.get(ip.toString()) || [] : []; } },
        { key: 'name', label: 'Name', plain: true, find: (v) => ix.byName.get(csvLower(v)) || [] }
    );
    return list;
}
function csvMatch(vals, matchers) {
    for (const m of matchers) {
        const v = vals[m.key];
        if (v == null || !String(v).trim()) continue;
        const hits = m.find(v);
        if (hits.length === 1) return { nodeId: hits[0], by: m };
        if (hits.length > 1) return { ambiguous: hits.length, by: m };
    }
    return null;
}

// Shown in the review as it would be on the map.
function csvShow(key, v) {
    if (key === 'portScheme' || key === 'if:bond') return csvTarget(key).field.toText(v);
    if (v === undefined || v === null) return '';
    if (key === 'type') return typeName(v);
    if (key === 'nat' || key === 'if:wireless') return v ? t('Yes') : t('No');
    if (key === 'lk:medium') return MEDIUM_NAMES[v] || String(v);
    return String(v);
}
// Equal as the field means it: two spellings of one MAC or one address are
// the same value.
function csvSame(key, a, b) {
    if (key === 'portScheme' || key === 'if:bond') { const f = csvTarget(key).field; return f.toText(a) === f.toText(b); }
    if (key === 'if:mac') return normMac(a) === normMac(b);
    if (key === 'if:ip') {
        const x = parseValidCIDR(String(a || '').trim()), y = parseValidCIDR(String(b || '').trim());
        if (x && y) return x.ip.toString() === y.ip.toString() && x.prefix === y.prefix;
    }
    if (key === 'nat' || key === 'if:wireless') return !!a === !!b;
    if (key === 'notes') return String(a || '') === String(b || '');
    return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
}

// A port on `node` as a sheet names it: an interface's name or id (a
// faceplate port's name follows the switch's scheme, "Gi1/0/12"), or, on a
// switch or AP, the number at the end of whatever the sheet calls it ("12",
// "port 12"), counted from the scheme's first number (portIdByText).
// -> { id } | { error } | { id: null } for blank.
function csvPortOn(node, text) {
    const v = String(text == null ? '' : text).trim();
    if (!v) return { id: null };
    const low = v.toLowerCase();
    const hit = getInterfaces(node).find((i) => i.id === v || String(i.name || '').toLowerCase() === low);
    if (hit) return { id: hit.id };
    const id = portIdByText(node, v);
    if (id) return { id };
    return { error: t('{name} has no port {port}.', { name: node.name || node.id, port: v }) };
}

// A faceplate port holds one cable. A NIC is not refused a second one: the
// map draws a router serving several hosts on one interface (a switch nobody
// drew) and an AP's radio serving every client, and a sheet that says so is
// read as it says.
const csvIsSocket = (node, id) => hasPortGrid(node) && /^p\d+$/.test(id || '');

// The interface in `list` holding the row's MAC, or else its address (the
// address alone, as the matcher compares it). -> { iface } | { split: true }
// when the MAC is on one interface and the address on another | {}.
function csvIfaceByAddress(list, v) {
    const mac = v['if:mac'] ? normMac(v['if:mac']) : '';
    const byMac = mac.length === 12 ? list.find((i) => normMac(i.mac) === mac) : null;
    const want = v['if:ip'] ? parseValidCIDR(String(v['if:ip']).trim()) : null;
    const byIp = want ? list.find((i) => { const p = parseValidCIDR(String(i.ip || '').trim()); return p && p.ip.toString() === want.ip.toString(); }) : null;
    if (byMac && byIp && byMac !== byIp) return { split: true };
    return { iface: byMac || byIp || null };
}

function csvPlan(sheet, mapping) {
    const kind = csvSheetKind(mapping);
    // observed: rows read out of an ARP table or a lease list (seenSheet),
    // whose names never rename a device on the map.
    const empty = { kind, rows: [], ops: [], counts: { add: 0, change: 0, same: 0, conflict: 0 }, errors: [], newIds: [], touchedIds: [], observed: !!sheet.observed };
    if (kind === 'mixed') return Object.assign(empty, { errors: [t('Map either device columns or cable columns: a sheet is one or the other.')] });
    if (kind === 'mixed-ports') return Object.assign(empty, { errors: [t(CSV_MIXED_PORTS)] });
    if (kind === 'mixed-subnets') return Object.assign(empty, { errors: [t(CSV_MIXED_SUBNETS)] });
    if (!mapping.some(Boolean)) return Object.assign(empty, { errors: [t('Pick what at least one column is.')] });
    // Each row as { key: text } over its mapped, non-blank cells, and the
    // mapped columns it leaves blank (blanks), which only a new device reads.
    const rows = sheet.rows.map((cells, index) => {
        const vals = {}, blanks = [];
        mapping.forEach((key, col) => {
            if (!key) return;
            const raw = cells[col] == null ? '' : String(cells[col]);
            if (raw.trim()) vals[key] = raw; else blanks.push(key);
        });
        return { index, vals, blanks };
    });
    if (kind === 'ports') return csvPlanPorts(rows, empty);
    if (kind === 'subnets') return csvPlanSubnets(rows, empty);
    return kind === 'cables' ? csvPlanCables(rows, empty) : csvPlanDevices(rows, empty);
}
const CSV_MIXED_PORTS = 'A sheet of ports maps the device, the port and its label or VLAN. Leave the other columns unmapped.';
const CSV_MIXED_SUBNETS = 'A sheet of subnets maps only what a subnet has: its CIDR, name, VLAN, gateway and so on. Leave the other columns unmapped.';

// Counted per thing, not per row: the three interfaces.csv rows of one new
// device are one device added.
function csvFinish(plan, results) {
    plan.rows = results.sort((a, b) => a.index - b.index);
    const seen = { add: new Set(), change: new Set(), same: new Set(), conflict: new Set() };
    plan.rows.forEach((r) => { seen[r.status].add(r.status === 'conflict' ? `row:${r.index}` : (r.newGroup || r.nodeId || r.linkId || (r.netId && `net:${r.netId}`) || `row:${r.index}`)); });
    Object.keys(seen).forEach((k) => { plan.counts[k] = seen[k].size; });
    return plan;
}

// ---- Devices ----
const CSV_IFACE_KEYS = ['if:id', 'if:name', 'if:ip', 'if:mac', 'if:wireless', 'if:bond'];

function csvPlanDevices(rows, plan) {
    const ix = csvIndex();
    // Addresses seen (plan.observed) are found by MAC or address only. A name
    // seen on the wire is not the register's: DHCP clients repeat theirs
    // (iPhone, android, raspberrypi), and one lease found by its name would
    // write its address and MAC over an unrelated device.
    const matchers = csvMatchers(ix).filter((m) => !(plan.observed && m.key === 'name'));
    // What earlier rows have already settled, so a later row that says
    // otherwise is a conflict rather than a silent overwrite.
    const nodeSets = new Map();     // nodeId -> { key: value } (existing devices)
    const ifaceOps = new Map();     // `${nodeId}\u0000${ifaceKey}` -> op.iface
    const fresh = new Map();        // group key -> { record, said: { key: value }, rows }
    const freshByName = new Map();  // lower name -> [group keys]
    const links = [];               // new cables
    const portsTaken = new Set();   // `${nodeId}\u0000${portId}` handed out by this plan
    const results = [];

    // ---- Pass 1: parse and match every row ----
    const parsed = rows.map(({ index, vals, blanks }) => {
        const r = { index, vals, blanks: blanks || [], values: {}, errors: [], notes: [] };
        Object.keys(vals).forEach((key) => {
            const tg = csvTarget(key);
            const res = tg.parse(vals[key]);
            if (res.error) {
                r.errors.push(res.needsPrefix
                    ? t('{value} needs its prefix (for example {value}/24): it is in no network on the map.', { value: String(vals[key]).trim() })
                    : t('{value} is not a valid {field}.', { value: String(vals[key]).trim() || '—', field: csvTargetLabel(tg) }));
            } else r.values[key] = res.value;
        });
        if (!Object.keys(vals).length) { r.blank = true; return r; }
        r.match = csvMatch(vals, matchers);
        if (plan.observed && !r.match && r.values.name && (ix.byName.get(csvLower(r.values.name)) || []).length) {
            r.notes.push(t('A device on the map is also called {name}: a name seen on the network is not used to find one.', { name: String(r.values.name).trim() }));
        }
        return r;
    });

    // The new devices the sheet names, before any is planned, so a device can
    // be cabled to a switch further down the same sheet.
    parsed.forEach((r) => {
        if (r.blank || r.match) return;
        const group = r.values.id ? `id:${r.values.id}` : `row:${r.index}`;
        r.group = group;
        if (r.values.name) {
            const k = csvLower(r.values.name);
            const list = freshByName.get(k) || [];
            if (!list.includes(group)) list.push(group);
            freshByName.set(k, list);
        }
    });
    const groupIds = new Set(parsed.filter((r) => r.group).map((r) => r.group));

    // An anchor (the switch column) is a device on the map or a new one in
    // the sheet: by id, then by name; two of either is ambiguous.
    const anchorOf = (text) => {
        const v = String(text).trim();
        if (ix.byId.has(v)) return { nodeId: v };
        if (groupIds.has(`id:${v}`)) return { group: `id:${v}` };
        const onMap = ix.byName.get(csvLower(v)) || [];
        const inSheet = freshByName.get(csvLower(v)) || [];
        if (onMap.length + inSheet.length > 1) return { error: t('{name} names more than one device.', { name: v }) };
        if (onMap.length) return { nodeId: onMap[0] };
        if (inSheet.length) return { group: inSheet[0] };
        return { error: t('No device called {name}.', { name: v }) };
    };

    // ---- Pass 2: plan each row, anchors before what hangs off them ----
    // A row is planned whole into a draft; only a row with no conflict is
    // committed. Rows whose switch is a new device still to be made wait for
    // it (in rounds), so the order of the sheet does not matter.
    const pending = parsed.filter((r) => !r.blank);
    // ifaceAlias: `${nodeId}\u0000${sheet's interface id}` -> the id the
    // device has for that port (found by its name), so a bond naming its
    // members by the sheet's ids names the device's own.
    const ctx = { ix, nodeSets, ifaceOps, fresh, links, portsTaken, late: [], observed: plan.observed, ifaceAlias: new Map() };
    while (pending.length) {
        let progress = true;
        while (pending.length && progress) {
            progress = false;
            for (let i = 0; i < pending.length; i++) {
                const r = pending[i];
                const sw = r.values['cab:switch'];
                const a = sw ? anchorOf(sw) : null;
                // Waits while its anchor is a new device not made yet but still
                // to come; a new device's own row never waits on itself.
                if (a && a.group && a.group !== r.group && !fresh.has(a.group) && pending.some((p) => p !== r && p.group === a.group)) continue;
                pending.splice(i, 1); i--;
                progress = true;
                results.push(csvPlanDeviceRow(r, a, ctx));
            }
        }
        if (!pending.length) break;
        // Only a cycle is left: new devices each waiting on another, as two
        // new switches cabled to each other are. The first is made now with
        // its cable put off, and the rest of the cycle follows from it.
        results.push(csvPlanDeviceRow(pending.shift(), { late: true }, ctx));
    }
    // The put-off cables, now that every device is made. Their rows are
    // committed already, so what stops one is said on the row.
    ctx.late.forEach(({ r, out, existing, record, type, own, selfName }) => {
        const sw = r.values['cab:switch'];
        const cab = csvCable(ctx, { anchor: sw ? anchorOf(sw) : null, v: r.values, existing, record, type, group: r.group, own, selfName });
        if (cab.why) { out.notes.push(cab.why); return; }
        out.notes.push(...cab.notes);
        if (cab.change) out.changes.push(cab.change);
        csvCommitCable(ctx, cab);
        if (existing && (cab.link || (cab.fills || []).length)) out.status = 'change';
    });

    // ---- The ops, from what was committed ----
    const records = [...fresh.values()].map((f) => f.record);
    csvLayout(records, links, new Set([...fresh.values()].filter((f) => f.placed).map((f) => f.record.id)));
    records.forEach((rec) => plan.ops.push({ create: rec }));
    nodeSets.forEach((set, nodeId) => {
        const node = getNode(nodeId);
        const keys = Object.keys(set).filter((k) => !csvSame(k, node[k], set[k]));
        if (!keys.length) return;
        const op = { nodeId, set: {}, drop: [] };
        keys.forEach((k) => { op.set[k] = set[k]; });
        if (op.set.type && op.set.type !== 'cloud' && node.siteRef) op.drop.push('siteRef');
        plan.ops.push(op);
    });
    ifaceOps.forEach((op) => {
        // A bond's members as this device calls them: cables.csv before
        // interfaces.csv makes the NAS's eno2 under an id of its own, and the
        // bond row still says n2.
        if (op.set.bond) op.set.bond = { mode: op.set.bond.mode, members: op.set.bond.members.map((m) => ctx.ifaceAlias.get(`${op.nodeId}\u0000${m}`) || m) };
        if (op.create || Object.keys(op.set).length) plan.ops.push({ iface: op });
    });
    links.forEach((l) => plan.ops.push({ link: l }));
    // The order of a device's interfaces, when the sheet names every one it
    // will have by id: interfaces.csv lists them in the device's order, and
    // that order means something (the first address is the one a switch
    // behind the device borrows, the first network the one it inherits
    // from). Imported after devices.csv, which brings only the uplink's NIC,
    // a router came back with its WAN first. Set last, once the NICs this
    // sheet adds exist.
    const named = new Map();
    results.forEach((res) => {
        if (res.status === 'conflict' || !res.nodeId || !res.ifaceId) return;
        const list = named.get(res.nodeId) || [];
        if (!list.includes(res.ifaceId)) list.push(res.ifaceId);
        named.set(res.nodeId, list);
    });
    named.forEach((ids, nodeId) => {
        const now = (getNode(nodeId).interfaces || []).map((i) => i.id);
        ifaceOps.forEach((op) => { if (op.nodeId === nodeId && op.create && !now.includes(op.id)) now.push(op.id); });
        if (ids.length < 2 || ids.length !== now.length || !ids.every((id) => now.includes(id)) || ids.join() === now.join()) return;
        plan.ops.push({ order: { nodeId, ids } });
    });
    plan.newIds = records.map((r) => r.id);
    plan.touchedIds = [...new Set(results.filter((r) => r.status === 'change').map((r) => r.nodeId).filter(Boolean))];
    return csvFinish(plan, results);
}

// A row found by a weak key (its address, or its name) that says, in the
// same breath, that it is some other box: an asset tag or a serial number
// that is not this device's, or, found by its address, two of another MAC,
// another name and another type. Followed, the row turned PC-13 into a new
// NAS-02 because the NAS had been given PC-13's old address, and its cable
// on PC-13's port came with it. A conflict instead, with what disagrees:
// the person reading the review knows which of the two is right. One of
// them alone is an edit, not another device: a NIC swapped for one with a
// new MAC, or a device renamed, keeps its address.
// -> the reason, or null when nothing contradicts the match.
function csvAnotherDevice(node, by, v) {
    if (by !== 'if:ip' && by !== 'name') return null;
    const differ = [];
    const textDiffers = (key) => !isBlank(v[key]) && !isBlank(node[key]) && csvLower(v[key]) !== csvLower(node[key]);
    if (textDiffers('assetTag')) differ.push(csvTargetLabel(csvTarget('assetTag')));
    if (textDiffers('serial')) differ.push(csvTargetLabel(csvTarget('serial')));
    if (by === 'if:ip') {
        const mac = v['if:mac'] ? normMac(v['if:mac']) : '';
        const macs = getInterfaces(node).map((i) => normMac(i.mac)).filter((m) => m.length === 12);
        const identity = [];
        if (mac.length === 12 && macs.length && !macs.includes(mac)) identity.push('MAC');
        if (v.name && csvLower(v.name) !== csvLower(node.name)) identity.push(t('Name'));
        if (v.type && v.type !== node.type) identity.push(t('Type'));
        if (identity.length >= 2) differ.push(...identity);
    }
    if (!differ.length) return null;
    return t('Found {name} by {key} only, but the row\'s {fields} belong to another device. Correct the sheet or the map so the two agree.',
        { name: node.name || node.id, key: by === 'name' ? t('Name') : 'IP', fields: differ.join(', ') });
}

// One row, planned into a draft and committed only when nothing in it is a
// conflict. -> the review row.
function csvPlanDeviceRow(r, anchor, ctx) {
    const { nodeSets, fresh } = ctx;
    const out = { index: r.index, name: r.vals.name ? String(r.vals.name).trim() : '', status: 'same', changes: [], notes: r.notes, why: '' };
    const conflict = (why) => Object.assign(out, { status: 'conflict', why });
    if (r.errors.length) return conflict(r.errors.join(' '));
    if (r.match && r.match.ambiguous) {
        const by = r.match.by.plain ? t(r.match.by.label) : r.match.by.label;
        return conflict(t('Matches {n} devices by {key}: add an id or a MAC to say which.', { n: r.match.ambiguous, key: by }));
    }

    const v = r.values;
    const existing = r.match ? getNode(r.match.nodeId) : null;
    let group = null, record;
    if (existing) {
        out.nodeId = existing.id;
        out.name = existing.name || existing.id;
        const other = ctx.observed ? null : csvAnotherDevice(existing, r.match.by.key, v);
        if (other) return conflict(other);
        record = existing;
    } else {
        group = fresh.get(r.group);
        if (!group) {
            const type = v.type || 'custom';
            const rec = newNodeRecord(type, 0, 0);
            // Only what the sheet says: the type's seed addresses were nobody's
            // answer (Add devices' rule), and its interfaces stay only when the
            // sheet does not list the device's own.
            rec.interfaces.forEach((f) => { f.ip = ''; });
            // And a column the sheet has but leaves blank is its answer too:
            // blank, not the type's seed. A camera exported with no allowed
            // ports came back allowing only 554 (p2-report's round trip).
            r.blanks.forEach((key) => {
                const tg = csvTarget(key);
                // (A blank name keeps the default one: a device needs a label.)
                if (tg && tg.group === 'device' && key !== 'name' && typeof rec[key] === 'string') rec[key] = '';
            });
            if (v.id) rec.id = String(v.id).trim();
            group = { record: rec, said: {}, rows: [], placed: Number.isFinite(v.x) && Number.isFinite(v.y), ownIfaces: false };
        }
        record = group.record;
        if (!r.vals.name && !group.said.name && !v['if:ip'] && !v['if:mac'] && !v.id) {
            return conflict(t('Nothing to find or name this device by: map a name, an address or an id.'));
        }
        out.name = v.name || record.name;
    }

    // ---- Device fields ----
    const draftSets = {};
    const said = existing ? (nodeSets.get(existing.id) || {}) : group.said;
    for (const key of Object.keys(v)) {
        const tg = csvTarget(key);
        // The id is what a row is matched on (or what a new device is
        // called inside), never something written over a device's own.
        if (tg.group !== 'device' || key === 'id') continue;
        // Matched by its name: the name is the key, and a sheet that spells
        // it in another case is not asking for a rename.
        if (key === 'name' && existing && r.match.by.key === 'name') continue;
        // A name seen on the wire is what the device calls itself, not what
        // the register calls it: said, never written over (see "Paste
        // anything" below).
        if (key === 'name' && existing && ctx.observed) {
            if (csvLower(v.name) !== csvLower(existing.name)) out.notes.push(t('Seen as {name}.', { name: String(v.name).trim() }));
            continue;
        }
        const value = v[key];
        if (Object.prototype.hasOwnProperty.call(said, key) && !csvSame(key, said[key], value)) {
            return conflict(t('Another row sets {field} to {value}.', { field: csvTargetLabel(tg), value: csvShow(key, said[key]) }));
        }
        const type = draftSets.type || said.type || record.type;
        if (key === 'nat' && !isRoutingDevice(type)) { out.notes.push(t('Only a routing device does NAT.')); continue; }
        if (key === 'portScheme' && !hasPortGrid({ type })) { if (value) out.notes.push(t('Only a switch or an access point has numbered ports.')); continue; }
        draftSets[key] = value;
        if (existing && !csvSame(key, existing[key], value)) out.changes.push({ field: csvTargetLabel(tg), before: csvShow(key, existing[key]), after: csvShow(key, value) });
    }

    // ---- The interface the row is about ----
    const ifaceVals = CSV_IFACE_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(v, k));
    let ifaceDraft = null;
    if (ifaceVals.length) {
        const list = existing ? (existing.interfaces || []) : record.interfaces;
        const named = v['if:name'] ? String(v['if:name']).trim() : '';
        // A new device whose rows name its interfaces has those, not its
        // type's: interfaces.csv rows for it rebuild it as it was.
        const ownList = !existing && (v['if:id'] || named);
        let iface = null, key;
        const pool = ownList && !group.ownIfaces ? [] : list;
        const byName = named ? pool.filter((i) => csvLower(i.name) === csvLower(named)) : [];
        if (v['if:id']) {
            iface = pool.find((i) => i.id === String(v['if:id']).trim()) || null;
            // An interface id this device lacks, but a name it has once: the
            // same port under the id another map gave it. devices.csv carries
            // the first interface's name and not its id, so a map rebuilt from
            // devices.csv then given interfaces.csv would otherwise grow a
            // second eth0 with the first one's address on every device.
            if (!iface && existing && byName.length === 1) {
                iface = byName[0];
                ctx.ifaceAlias.set(`${existing.id}\u0000${String(v['if:id']).trim()}`, iface.id);
            }
            key = `id:${String(v['if:id']).trim()}`;
        } else if (named) {
            iface = byName[0] || null;
            key = `name:${csvLower(named)}`;
        } else {
            // No interface named: the one the row's MAC or address is on (the
            // row may have been found by it), else the first. Writing the
            // second NIC's address onto the first would leave two NICs on one
            // address and lose the first one's.
            const on = csvIfaceByAddress(list, v);
            if (on.split) return conflict(t('{mac} and {ip} are on different interfaces of {name}: add the interface to say which.', { mac: fmtColonSafe(v['if:mac']), ip: String(v['if:ip']), name: record.name || record.id }));
            iface = on.iface || list[0] || null;
            key = iface ? `id:${iface.id}` : 'first';
        }
        // One key per interface of a device on the map, however the rows
        // name it, so two rows about one port meet in one op.
        if (existing && iface) key = `id:${iface.id}`;
        const nodeKey = existing ? existing.id : `new:${r.group}`;
        const held = ctx.ifaceOps.get(`${nodeKey}\u0000${key}`) || (iface && ctx.ifaceOps.get(`${nodeKey}\u0000id:${iface.id}`));
        ifaceDraft = { nodeId: existing ? existing.id : record.id, id: iface ? iface.id : (held ? held.id : (v['if:id'] ? String(v['if:id']).trim() : nextId('i'))),
            name: iface ? iface.name : (named || (held && held.name) || 'eth0'), create: !iface && !held, set: {}, key: `${nodeKey}\u0000${key}`, ownList };
        if (held) { ifaceDraft.create = held.create; ifaceDraft.id = held.id; }
        const ifLabel = ifaceDraft.name;
        for (const k of ifaceVals) {
            const field = k.slice(3);
            if (field === 'id') continue;
            const value = v[k];
            if (held && Object.prototype.hasOwnProperty.call(held.set, field) && !csvSame(k, held.set[field], value)) {
                return conflict(t('Another row sets {field} to {value}.', { field: `${ifLabel} ${csvTargetLabel(csvTarget(k))}`, value: csvShow(k, held.set[field]) }));
            }
            if (field === 'name' && iface && iface.name === value) continue;
            if (field === 'name' && !iface) continue;   // it names the interface being made
            const before = iface ? iface[field] : undefined;
            // A new device's interface was filled in by an earlier row of
            // the same device: saying otherwise now is the same conflict.
            if (!existing && iface && before !== undefined && !isBlank(String(before)) && !csvSame(k, before, value)) {
                return conflict(t('Another row sets {field} to {value}.', { field: `${ifLabel} ${csvTargetLabel(csvTarget(k))}`, value: csvShow(k, before) }));
            }
            if (iface && csvSame(k, before, value)) continue;
            ifaceDraft.set[field] = value;
            if (existing) out.changes.push({ field: `${ifLabel} · ${csvTargetLabel(csvTarget(k))}`, before: csvShow(k, before), after: csvShow(k, value) });
        }
        if (existing && ifaceDraft.create) out.changes.unshift({ field: csvTargetLabel(csvTarget('if:name')), before: '', after: ifLabel });
        // Named by its id (interfaces.csv): where it comes in the device's
        // list is the sheet's order (see csvPlanDevices' end).
        if (existing && v['if:id']) out.ifaceId = ifaceDraft.id;
    }

    // ---- Cabling ----
    // This device's end of the cable: the port the sheet names for it, else
    // the NIC the row is about. Left to the binder, a router's LAN cable
    // lands on whichever NIC is free, which is its WAN when the WAN cable is
    // still to come (cables.csv), and nothing would ever say so. A device
    // with a faceplate is the exception: its row's interface is a management
    // VLAN, not where a cable goes, so with no port named the binder picks.
    let own = null;
    if (v['cab:switch'] || v['cab:port']) {
        const grid = hasPortGrid({ type: draftSets.type || record.type });
        const text = v['cab:local'] ? String(v['cab:local']).trim() : '';
        if (text) {
            const low = text.toLowerCase();
            const pool = existing ? (existing.interfaces || []) : (ifaceDraft && ifaceDraft.ownList && !group.ownIfaces ? [] : record.interfaces);
            const hit = ifaceDraft && (ifaceDraft.id === text || csvLower(ifaceDraft.name) === low) ? { id: ifaceDraft.id }
                : pool.find((i) => i.id === text || csvLower(i.name) === low);
            // A faceplate port by its number, counted from this device's
            // own scheme (the one this row sets, else the one it has).
            const scheme = Object.prototype.hasOwnProperty.call(draftSets, 'portScheme') ? draftSets.portScheme : record.portScheme;
            const byNumber = !hit && grid ? portIdByText({ type: draftSets.type || record.type, portScheme: scheme }, text) : null;
            if (hit) own = hit.id;
            else if (byNumber) own = byNumber;
            else return conflict(t('{name} has no port {port}.', { name: draftSets.name || record.name || record.id, port: text }));
        } else if (ifaceDraft && !grid) own = ifaceDraft.id;
    }
    // A row whose switch is a new device still waiting on this one (two new
    // switches each naming the other, which is how devices.csv writes any two
    // cabled switches) is planned now and cabled once the other one is made.
    let cab = { notes: [] };
    if ((v['cab:switch'] || v['cab:port']) && anchor && anchor.late) {
        ctx.late.push({ r, out, existing, record, type: draftSets.type || record.type, own, selfName: draftSets.name || record.name });
    } else if (v['cab:switch'] || v['cab:port']) {
        cab = csvCable(ctx, { anchor, v, existing, record, type: draftSets.type || record.type, group: r.group, own, selfName: draftSets.name || record.name });
        if (cab.why) return conflict(cab.why);
    }
    out.notes.push(...cab.notes);
    if (cab.change) out.changes.push(cab.change);

    // ---- Status, and the commit ----
    if (!existing) {
        out.status = 'add';
        out.newGroup = r.group;
    } else {
        const anyDevice = Object.keys(draftSets).some((k) => !csvSame(k, existing[k], draftSets[k]));
        const anyIface = ifaceDraft && (ifaceDraft.create || Object.keys(ifaceDraft.set).length);
        out.status = anyDevice || anyIface || cab.link || (cab.fills || []).length ? 'change' : 'same';
    }
    if (existing) {
        nodeSets.set(existing.id, Object.assign(nodeSets.get(existing.id) || {}, draftSets));
    } else {
        Object.keys(draftSets).forEach((k) => {
            group.said[k] = draftSets[k];
            if (k === 'x' || k === 'y') record[k] = Math.round(draftSets[k]);
            else record[k] = draftSets[k];
        });
        group.placed = Number.isFinite(group.said.x) && Number.isFinite(group.said.y);
        group.rows.push(r.index);
        fresh.set(r.group, group);
        out.name = record.name;
    }
    if (ifaceDraft) {
        if (existing) {
            const prev = ctx.ifaceOps.get(ifaceDraft.key);
            ctx.ifaceOps.set(ifaceDraft.key, prev ? Object.assign(prev, { set: Object.assign(prev.set, ifaceDraft.set) })
                : { nodeId: ifaceDraft.nodeId, id: ifaceDraft.id, name: ifaceDraft.name, create: ifaceDraft.create, set: ifaceDraft.set });
        } else {
            // A new device's interfaces are written straight into its record.
            if (ifaceDraft.ownList && !group.ownIfaces) { record.interfaces = []; group.ownIfaces = true; }
            let iface = record.interfaces.find((i) => i.id === ifaceDraft.id);
            if (!iface) { iface = { id: ifaceDraft.id, name: ifaceDraft.name, ip: '' }; record.interfaces.push(iface); }
            Object.assign(iface, ifaceDraft.set);
            ctx.ifaceOps.set(ifaceDraft.key, { nodeId: record.id, id: iface.id, name: iface.name, create: false, set: {}, fresh: true });
        }
    }
    csvCommitCable(ctx, cab);
    if (!existing) {
        // What the new device will be, in one line for the review.
        const bits = [typeName(record.type)];
        record.interfaces.forEach((i) => { if (i.ip) bits.push(i.ip); if (!isBlank(i.mac)) bits.push(fmtColonSafe(i.mac)); });
        out.changes = [{ field: '', before: '', after: bits.join(' · ') }].concat(out.changes.filter((c) => c.field === t('Cable')));
    }
    return out;
}

// Where a row's device is cabled, planned and not yet committed. own is the
// device's end (an interface or port id), or null for the binder to pick.
// -> { why } when it makes the row a conflict, else { notes, change?, link?,
// fills? }: link a new cable; fills the ends of a cable an earlier row of
// this plan made that it left open (devices.csv writes a cable between two
// switches from each end, and each row knows one more port of it).
function csvCable(ctx, { anchor, v, existing, record, type, group, own, selfName }) {
    const { fresh, links, portsTaken } = ctx;
    const res = { notes: [] };
    const swText = v['cab:switch'];
    if (!swText) { res.notes.push(t('A port without a switch is left out.')); return res; }
    if (anchor && anchor.error) {
        if (existing) { res.notes.push(anchor.error); return res; }
        return { why: anchor.error };
    }
    const anchorNode = anchor.nodeId ? getNode(anchor.nodeId) : (fresh.get(anchor.group) || {}).record;
    const selfId = existing ? existing.id : record.id;
    if (!anchorNode) return { why: t('No device called {name}.', { name: String(swText).trim() }) };
    if (anchorNode.id === selfId || (anchor.group && anchor.group === group)) return { why: t('A device cannot be cabled to itself.') };
    const label = anchorNode.name || anchorNode.id;
    // A new device's name is written to its record only once its row commits.
    const selfLabel = selfName || record.name || record.id;
    const taken = (id) => csvIsSocket(anchorNode, id) && (portsTaken.has(`${anchorNode.id}\u0000${id}`) || (anchor.nodeId && ifaceIsOccupied(anchorNode.id, id)));
    const ownTaken = (id) => csvIsSocket(record, id) && (portsTaken.has(`${selfId}\u0000${id}`) || (existing && ifaceIsOccupied(selfId, id)));
    const already = existing && anchor.nodeId ? linksAtNode(existing.id).filter((l) => l.source === anchorNode.id || l.target === anchorNode.id) : [];
    const planned = links.find((l) => (l.source === anchorNode.id && l.target === selfId) || (l.target === anchorNode.id && l.source === selfId));
    const port = csvPortOn(anchorNode, v['cab:port']);
    if (port.error) return { why: port.error };
    const moved = (node, on) => t('Already cabled to {name} on port {port}: moving a cable is done on the map.', { name: node.name || node.id, port: on ? ifaceLabel(node, on) : '—' });
    // Patched into another switch already: the sheet says it moved,
    // and a second uplink would be a loop nobody drew. Said, not done.
    const elsewhere = existing && !already.length ? csvUplink(existing) : null;
    if (elsewhere) {
        res.notes.push(t('Already cabled to {name} on port {port}: moving a cable is done on the map.', { name: elsewhere.peer.name || elsewhere.peer.id, port: elsewhere.port }));
        return res;
    }
    if (already.length) {
        const on = ifaceIdOn(already[0], anchorNode.id), mine = ifaceIdOn(already[0], selfId);
        if (port.id && on !== port.id) res.notes.push(moved(anchorNode, on));
        else if (own && mine !== own) res.notes.push(moved(record, mine));
        return res;
    }
    if (planned) {
        // Each end of that cable, whichever way round it was made: a cable
        // this plan made from the other row has the other row's device as
        // its source. An end it left open is this row's to fill; an end it
        // set to another port is said, as a cable already plugged in is.
        res.fills = [];
        const ends = [[anchorNode, port.id, taken, label], [record, own, ownTaken, selfLabel]];
        for (const [node, want, isTaken, nodeLabel] of ends) {
            const side = planned.source === node.id ? 'sourceIface' : 'targetIface';
            const on = planned[side];
            if (!want) continue;
            if (!on) {
                if (isTaken(want)) return { why: t('Port {port} on {name} is taken.', { port: ifaceLabel(node, want), name: nodeLabel }) };
                res.fills.push({ link: planned, side, nodeId: node.id, id: want });
                if (node === anchorNode) {
                    res.change = { field: t('Cable'), before: '', after: t('{name} port {port}', { name: label, port: ifaceLabel(anchorNode, want) }) };
                    csvFaceplateNote(res, anchorNode, want);
                }
            } else if (on !== want) res.notes.push(moved(node, on));
        }
        return res;
    }
    if (own && ownTaken(own)) return { why: t('Port {port} on {name} is taken.', { port: ifaceLabel(record, own), name: selfLabel }) };
    // A device that joins an AP by radio takes no port: the AP's
    // faceplate is its uplink.
    const wireless = anchorNode.type === 'ap' && apMediumGuess(anchorNode, { type }) === 'wireless';
    let portId = port.id;
    if (portId && taken(portId) && !wireless) {
        return { why: t('Port {port} on {name} is taken.', { port: ifaceLabel(anchorNode, portId), name: label }) };
    }
    if (!portId && hasPortGrid(anchorNode) && !wireless) {
        if (anchor.nodeId) {
            const free = freePorts(anchorNode, portsTaken.size + 1).ids.find((id) => !taken(id));
            portId = free || null;
        } else {
            let p = 1; while (taken(`p${p}`)) p++;
            portId = `p${p}`;
        }
    }
    const bridged = isVirtualType(anchorNode.type) || isVirtualType(type);
    res.link = { id: nextId('l'), source: anchorNode.id, target: selfId, attachment: bridged ? 'bridged' : null,
        sourceIface: wireless ? null : portId, targetIface: own || null };
    const where = res.link.sourceIface ? t('{name} port {port}', { name: label, port: ifaceLabel(anchorNode, res.link.sourceIface) }) : label;
    res.change = { field: t('Cable'), before: '', after: where };
    if (!wireless) csvFaceplateNote(res, anchorNode, portId);
    return res;
}

// A port past a faceplate the user set is drawn as a port overflow (the
// diagnostics flag it): said on the row, as Add devices says it.
function csvFaceplateNote(res, node, portId) {
    const m = /^p(\d+)$/.exec(portId || '');
    if (!m || !hasExplicitPortCount(node) || Number(m[1]) <= node.portCount) return;
    res.notes.push(t('{name} has {ports} ports: port {port} is past its faceplate and shows as a port overflow.', { name: node.name || node.id, ports: node.portCount, port: ifaceLabel(node, portId) }));
}

function csvCommitCable(ctx, cab) {
    if (cab.link) {
        ctx.links.push(cab.link);
        if (cab.link.sourceIface) ctx.portsTaken.add(`${cab.link.source}\u0000${cab.link.sourceIface}`);
        if (cab.link.targetIface) ctx.portsTaken.add(`${cab.link.target}\u0000${cab.link.targetIface}`);
    }
    (cab.fills || []).forEach((f) => {
        f.link[f.side] = f.id;
        ctx.portsTaken.add(`${f.nodeId}\u0000${f.id}`);
    });
}

// The new devices, laid out among themselves: under the device they are
// cabled to, in rows of ADD_ROW as Add devices places them, below anything
// already hanging there; the ones on nothing beside the map, as a block goes.
// Nothing already drawn moves, and a device the sheet gave x and y keeps them.
function csvLayout(records, links, given) {
    const recById = new Map(records.map((r) => [r.id, r]));
    const anchorOf = new Map();
    links.forEach((l) => { if (recById.has(l.target) && !anchorOf.has(l.target)) anchorOf.set(l.target, l.source); });
    const placed = new Set(state.nodes.map((n) => n.id));
    const pos = (id) => recById.get(id) || getNode(id);
    records.forEach((r) => { if (given.has(r.id)) placed.add(r.id); });
    const kids = new Map();
    const loose = [];
    records.forEach((r) => {
        if (given.has(r.id)) return;
        const a = anchorOf.get(r.id);
        if (a) { const list = kids.get(a) || []; list.push(r); kids.set(a, list); } else loose.push(r);
    });
    const snap = (v) => Math.round(v / GRID_SNAP) * GRID_SNAP;
    const put = (list, at) => addSlots(list.length, at.x, at.y).forEach((s, i) => { list[i].x = snap(s.x); list[i].y = snap(s.y); placed.add(list[i].id); });
    if (loose.length) {
        const at = besideTheMap(addSlots(loose.length, 0, 0));
        if (!state.nodes.length) at.y -= Math.floor((loose.length - 1) / ADD_ROW) * ADD_ROWH / 2;
        put(loose, at);
    }
    // Breadth first from what is placed: a new switch's devices go under it
    // once it has a place.
    const everything = () => state.nodes.concat(records.filter((r) => placed.has(r.id)));
    let progress = true;
    while (progress && kids.size) {
        progress = false;
        [...kids.keys()].forEach((anchorId) => {
            if (!placed.has(anchorId)) return;
            const a = pos(anchorId);
            const list = kids.get(anchorId);
            kids.delete(anchorId);
            progress = true;
            const width = Math.min(ADD_ROW, list.length) * ADD_COLW;
            const inBand = everything().filter((n) => n !== a && n.y > a.y + 40 && Math.abs(n.x - a.x) <= width / 2 + ADD_COLW);
            put(list, { x: a.x, y: Math.max(a.y + 130, ...inBand.map((n) => n.y + 120)) });
        });
    }
    // Only a cycle of new devices is left: beside the map.
    kids.forEach((list) => put(list, besideTheMap(addSlots(list.length, 0, 0))));
}

// ---- Cables ----
function csvPlanCables(rows, plan) {
    const ix = csvIndex();
    const results = [];
    const portsTaken = new Set();
    const said = new Map();   // linkId -> { key: value }
    const cableSaid = new Map();   // linkId -> { label, length, color, via }: what the rows set of link.cable
    const madeIfaces = new Map();   // node id + NIC name -> the op that makes it
    const deviceOf = (text) => {
        const v = String(text).trim();
        if (ix.byId.has(v)) return { node: getNode(v) };
        const hits = ix.byName.get(csvLower(v)) || [];
        if (hits.length > 1) return { error: t('{name} names more than one device.', { name: v }) };
        return hits.length ? { node: getNode(hits[0]) } : { error: t('No device called {name}.', { name: v }) };
    };
    rows.forEach(({ index, vals }) => {
        if (!Object.keys(vals).length) return;
        const out = { index, name: '', status: 'same', changes: [], notes: [], why: '' };
        const conflict = (why) => { results.push(Object.assign(out, { status: 'conflict', why })); };
        const values = {}, errors = [];
        Object.keys(vals).forEach((key) => {
            const tg = csvTarget(key);
            if (tg.group !== 'cable') return;
            if (key === 'lk:source' || key === 'lk:target' || key === 'lk:sourceIface' || key === 'lk:targetIface' || key === 'lk:id') { values[key] = String(vals[key]).trim(); return; }
            const res = tg.parse(vals[key]);
            if (res.error) errors.push(t('{value} is not a valid {field}.', { value: String(vals[key]).trim(), field: csvTargetLabel(tg) }));
            else values[key] = res.value;
        });
        if (errors.length) return conflict(errors.join(' '));
        const ends = {};
        for (const k of ['lk:source', 'lk:target']) {
            if (!values[k]) continue;
            const d = deviceOf(values[k]);
            if (d.error) return conflict(d.error);
            ends[k] = d.node;
        }
        const nameOf = (n) => (n ? n.name || n.id : '—');
        out.name = `${nameOf(ends['lk:source'])} ↔ ${nameOf(ends['lk:target'])}`;
        let link = values['lk:id'] ? getLink(values['lk:id']) : null;
        if (link) {
            const a = ends['lk:source'], b = ends['lk:target'];
            const joins = (n) => !n || link.source === n.id || link.target === n.id;
            if (!joins(a) || !joins(b)) return conflict(t('Cable {id} joins other devices.', { id: link.id }));
        } else if (ends['lk:source'] && ends['lk:target']) {
            const a = ends['lk:source'].id, b = ends['lk:target'].id;
            const between = state.links.filter((l) => (l.source === a && l.target === b) || (l.source === b && l.target === a));
            // The cable whose ports are the ones the row gives (either end).
            const want = (l) => {
                const at = (k, node) => (values[k] ? csvPortOn(node, values[k]).id : null);
                const sp = at('lk:sourceIface', ends['lk:source']), tp = at('lk:targetIface', ends['lk:target']);
                const onA = l.source === a ? l.sourceIface : l.targetIface, onB = l.source === a ? l.targetIface : l.sourceIface;
                return (!sp || onA === sp) && (!tp || onB === tp);
            };
            if (between.length > 1) {
                const narrowed = between.filter(want);
                if (narrowed.length !== 1) return conflict(t('{n} cables join these two devices: add the cable id to say which.', { n: between.length }));
                link = narrowed[0];
            } else if (between.length && !want(between[0]) && values['lk:id']) {
                // A cable id the map does not have, on other ports than the
                // one cable there: a second cable between the two (a NAS on
                // two switch ports), not that one moved.
                link = null;
            } else link = between[0] || null;
        }
        if (link) {
            const src = getNode(link.source), tgt = getNode(link.target);
            out.name = `${nameOf(src)} ↔ ${nameOf(tgt)}`;
            out.linkId = link.id;
            const prev = said.get(link.id) || {};
            const draft = {};   // committed only when the whole row is good
            if (values['lk:medium'] !== undefined) {
                if (prev.medium !== undefined && prev.medium !== values['lk:medium']) return conflict(t('Another row sets {field} to {value}.', { field: 'Medium', value: csvShow('lk:medium', prev.medium) }));
                const now = effectiveMedium(link);
                if (now !== values['lk:medium']) {
                    out.changes.push({ field: 'Medium', before: csvShow('lk:medium', now), after: csvShow('lk:medium', values['lk:medium']) });
                    draft.medium = values['lk:medium'];
                }
            }
            if (values['lk:attachment'] !== undefined) {
                if (prev.attachment !== undefined && prev.attachment !== values['lk:attachment']) return conflict(t('Another row sets {field} to {value}.', { field: 'Attachment', value: prev.attachment }));
                if ((link.attachment || '') !== values['lk:attachment']) {
                    out.changes.push({ field: 'Attachment', before: link.attachment || '', after: values['lk:attachment'] });
                    draft.attachment = values['lk:attachment'];
                }
            }
            // The cable's own facts, field by field: a blank cell leaves one
            // as it is, and two rows that disagree about one are a conflict.
            const heldCable = cableSaid.get(link.id) || {};
            const cableDraft = {};
            for (const f of CABLE_FIELDS) {
                const k = `lk:cable.${f.key}`;
                if (values[k] === undefined) continue;
                const label = csvTargetLabel(csvTarget(k));
                if (heldCable[f.key] !== undefined && !csvSame(k, heldCable[f.key], values[k])) return conflict(t('Another row sets {field} to {value}.', { field: label, value: heldCable[f.key] }));
                if (!csvSame(k, cableOf(link, f.key), values[k])) {
                    out.changes.push({ field: label, before: cableOf(link, f.key), after: values[k] });
                    cableDraft[f.key] = values[k];
                }
            }
            if (Object.keys(cableDraft).length) cableSaid.set(link.id, Object.assign(heldCable, cableDraft));
            // Its ports are where it is plugged in; a sheet that says otherwise
            // is noted, not obeyed (moving a cable is done on the map).
            ['lk:sourceIface', 'lk:targetIface'].forEach((k) => {
                if (!values[k]) return;
                const endNode = k === 'lk:sourceIface' ? (ends['lk:source'] || src) : (ends['lk:target'] || tgt);
                const on = ifaceIdOn(link, endNode.id);
                const p = csvPortOn(endNode, values[k]);
                if (p.error || p.id !== on) out.notes.push(t('Already cabled to {name} on port {port}: moving a cable is done on the map.', { name: nameOf(endNode), port: on ? ifaceLabel(endNode, on) : '—' }));
            });
            if (Object.keys(draft).length) said.set(link.id, Object.assign(prev, draft));
            out.status = out.changes.length ? 'change' : 'same';
            results.push(out);
            return;
        }
        // A new cable needs both ends, and both on the map.
        if (!ends['lk:source'] || !ends['lk:target']) return conflict(t('A new cable needs both of its devices.'));
        const a = ends['lk:source'], b = ends['lk:target'];
        if (a.id === b.id) return conflict(t('A device cannot be cabled to itself.'));
        // A port the sheet names on a device without a faceplate that the
        // device does not have is a NIC it gains, under that name: devices.csv
        // carries one NIC per device, so a map rebuilt from it and then given
        // cables.csv has the router's LAN side and not yet its WAN one. Shown
        // in the review as a new interface, never done quietly.
        const pick = (node, text) => {
            let p = csvPortOn(node, text);
            if (p.error && !hasPortGrid(node)) {
                const name = String(text).trim();
                const key = `${node.id}\u0000${name.toLowerCase()}`;
                p = { id: madeIfaces.has(key) ? madeIfaces.get(key).id : nextId('i'), make: { nodeId: node.id, name, key } };
            }
            if (p.error) return p;
            const busy = p.id && (ifaceIsOccupied(node.id, p.id) || portsTaken.has(`${node.id}\u0000${p.id}`));
            if (busy && csvIsSocket(node, p.id)) return { error: t('Port {port} on {name} is taken.', { port: ifaceLabel(node, p.id), name: nameOf(node) }) };
            // A NIC with a cable on it already is how the map draws a router
            // serving hosts through a switch nobody drew, and a radio serves
            // every client in range: kept as the sheet has it, and said
            // when it is a host's NIC (the findings will say more).
            const nic = busy && (node.interfaces || []).find((i) => i.id === p.id);
            if (busy && !isRoutingDevice(node.type) && !(nic && ifaceIsWireless(nic))) {
                out.notes.push(t('{port} on {name} carries another cable too.', { port: p.make ? p.make.name : ifaceLabel(node, p.id), name: nameOf(node) }));
            }
            return p;
        };
        const sp = pick(a, values['lk:sourceIface']), tp = pick(b, values['lk:targetIface']);
        if (sp.error) return conflict(sp.error);
        if (tp.error) return conflict(tp.error);
        const id = values['lk:id'] && !getLink(values['lk:id']) && !plan.ops.some((o) => o.link && o.link.id === values['lk:id']) ? values['lk:id'] : nextId('l');
        const l = { id, source: a.id, target: b.id, attachment: values['lk:attachment'] || (isVirtualType(a.type) || isVirtualType(b.type) ? 'bridged' : null),
            sourceIface: sp.id, targetIface: tp.id };
        if (values['lk:medium'] !== undefined) l.medium = values['lk:medium'];
        const facts = {};
        CABLE_FIELDS.forEach((f) => { if (values[`lk:cable.${f.key}`] !== undefined) facts[f.key] = values[`lk:cable.${f.key}`]; });
        if (readCable(facts)) l.cable = readCable(facts);
        const portText = (node, p) => (p.make ? p.make.name : ifaceLabel(node, p.id));
        [[a, sp], [b, tp]].forEach(([node, p]) => {
            if (!p.make || madeIfaces.has(p.make.key)) return;
            const op = { nodeId: node.id, id: p.id, name: p.make.name, create: true, set: {} };
            madeIfaces.set(p.make.key, op);
            plan.ops.push({ iface: op });
            out.changes.push({ field: csvTargetLabel(csvTarget('if:name')), before: '', after: `${nameOf(node)} ${p.make.name}` });
        });
        if (sp.id) portsTaken.add(`${a.id}\u0000${sp.id}`);
        if (tp.id) portsTaken.add(`${b.id}\u0000${tp.id}`);
        plan.ops.push({ link: l });
        out.status = 'add';
        out.changes.unshift({ field: t('Cable'), before: '', after: [sp.id ? `${nameOf(a)} ${portText(a, sp)}` : nameOf(a), tp.id ? `${nameOf(b)} ${portText(b, tp)}` : nameOf(b)].join(' ↔ ') + (l.medium ? ` · ${csvShow('lk:medium', l.medium)}` : '') });
        results.push(out);
    });
    // link.cable is one value: what the rows said, laid over what it holds.
    cableSaid.forEach((facts, linkId) => {
        const link = getLink(linkId);
        const set = said.get(linkId) || {};
        set.cable = readCable(Object.assign({}, (link && link.cable) || {}, facts)) || null;
        said.set(linkId, set);
    });
    said.forEach((set, linkId) => plan.ops.push({ linkId, set }));
    return csvFinish(plan, results);
}

// ---- Ports ----
// One row per port: found by its device (id, then name; two devices of one
// name is a conflict, as everywhere here) and the port the row names, then its
// label and access VLAN set. A blank cell leaves that fact as it is. Nothing
// is created: a port sheet documents ports that are there, and a device it
// names that is not on the map is a conflict rather than a guess.
function csvPlanPorts(rows, plan) {
    const ix = csvIndex();
    const said = new Map();     // `${nodeId}\u0000${portId}` -> { label?, vlan? } from earlier rows
    const results = [];
    const touched = new Set();
    rows.forEach(({ index, vals }) => {
        if (!Object.keys(vals).length) return;
        const out = { index, name: '', status: 'same', changes: [], notes: [], why: '' };
        const conflict = (why) => { results.push(Object.assign(out, { status: 'conflict', why })); };
        const values = {}, errors = [];
        Object.keys(vals).forEach((key) => {
            const tg = csvTarget(key);
            if (tg.group !== 'port') { values[key] = String(vals[key]).trim(); return; }
            const res = tg.parse(vals[key]);
            if (res.error) errors.push(t('{value} is not a valid {field}.', { value: String(vals[key]).trim() || '—', field: csvTargetLabel(tg) }));
            else values[key] = res.value;
        });
        out.name = values.name || values.id || '';
        if (errors.length) { conflict(errors.join(' ')); return; }
        const byId = values.id ? ix.byId.get(values.id) || [] : [];
        const byName = !byId.length && values.name ? ix.byName.get(csvLower(values.name)) || [] : [];
        const hits = byId.length ? byId : byName;
        if (!values.id && !values.name) { conflict(t('Nothing to find or name this device by: map a name, an address or an id.')); return; }
        if (hits.length > 1) { conflict(t('{name} names more than one device.', { name: values.name })); return; }
        const node = hits.length ? getNode(hits[0]) : null;
        if (!node) { conflict(t('No device called {name}.', { name: values.name || values.id })); return; }
        out.name = node.name || node.id;
        out.nodeId = node.id;
        if (!hasPortGrid(node)) { conflict(t('Only a switch or an access point has numbered ports.')); return; }
        if (!values['cab:port']) { conflict(t('Say which port: map the port column.')); return; }
        const port = csvPortOn(node, values['cab:port']);
        if (port.error) { conflict(port.error); return; }
        // Only a port the box has: its faceplate, or one past it that a cable
        // or a label already holds (faceplatePortIds). A number past the
        // faceplate is a typo or the wrong box, and labelling it would make up
        // a port the list, the table and the report then all show.
        if (!PORT_ID_RE.test(port.id || '') || !faceplatePortIds(node).includes(port.id)) { conflict(t('{name} has no port {port}.', { name: out.name, port: values['cab:port'] })); return; }
        const portName = ifaceLabel(node, port.id);
        out.name = `${out.name} · ${portName}`;
        const now = portAttrOf(node, port.id);
        const key = `${node.id}\u0000${port.id}`;
        const before = said.get(key) || {};
        const set = {};
        for (const [k, field] of [['pt:label', 'label'], ['pt:vlan', 'vlan']]) {
            if (!Object.prototype.hasOwnProperty.call(values, k)) continue;
            const v = values[k];
            if (Object.prototype.hasOwnProperty.call(before, field) && String(before[field]) !== String(v)) {
                conflict(t('Another row sets {field} to {value}.', { field: csvTargetLabel(csvTarget(k)), value: String(before[field]) }));
                return;
            }
            set[field] = v;
            if (String(now[field] === null ? '' : now[field]) !== String(v)) {
                out.changes.push({ field: csvTargetLabel(csvTarget(k)), before: now[field] === null ? '' : String(now[field]), after: String(v) });
            }
        }
        said.set(key, Object.assign({}, before, set));
        if (out.changes.length) {
            out.status = 'change';
            touched.add(node.id);
            plan.ops.push({ port: { nodeId: node.id, id: port.id, set } });
        }
        results.push(out);
    });
    plan.touchedIds = [...touched];
    // Counted per port, not per device: csvFinish keys a change on nodeId,
    // which would fold a switch's twelve relabelled ports into one.
    csvFinish(plan, results);
    const portKey = (r) => `${r.nodeId}\u0000${r.name}`;
    plan.counts.change = new Set(results.filter((r) => r.status === 'change').map(portKey)).size;
    plan.counts.same = new Set(results.filter((r) => r.status === 'same').map(portKey)).size;
    return plan;
}

// ---- Subnets ----
// One row per network: found by its id, then by its CIDR (the same subnet
// under another id is the same network: containment could not tell two
// apart). Blank cells leave a field as it is, as everywhere here. A row
// matching nothing declares a new network, which needs its CIDR. The CIDR of
// a network found by its id is never rewritten: that is Renumber, which moves
// every member's address with it, and a sheet giving another range for it is
// a conflict, not a quiet move of the zone away from its devices.
function csvPlanSubnets(rows, plan) {
    const byId = new Map(state.networks.map((n) => [n.id, n]));
    const byCidr = new Map(state.networks.map((n) => [n.cidr, n]));
    const said = new Map();       // network id (or a new one's cidr) -> { key: value } from earlier rows
    const fresh = new Map();      // cidr -> the new network's record
    const results = [];
    const label = (key) => csvTargetLabel(csvTarget(`net:${key}`));
    rows.forEach(({ index, vals }) => {
        if (!Object.keys(vals).length) return;
        const out = { index, name: '', status: 'same', changes: [], notes: [], why: '' };
        const conflict = (why) => { results.push(Object.assign(out, { status: 'conflict', why })); };
        const values = {}, errors = [];
        Object.keys(vals).forEach((key) => {
            const tg = csvTarget(key);
            const res = tg.parse(vals[key]);
            if (res.error) errors.push(t('{value} is not a valid {field}.', { value: String(vals[key]).trim() || '—', field: csvTargetLabel(tg) }));
            else values[key.slice(4)] = res.value;
        });
        out.name = values.cidr || values.id || '';
        if (errors.length) { conflict(errors.join(' ')); return; }
        const named = values.id ? byId.get(values.id) || null : null;
        if (named && values.cidr && values.cidr !== named.cidr) {
            const other = byCidr.get(values.cidr);
            conflict(other ? t('{id} and {cidr} are two different subnets.', { id: values.id, cidr: values.cidr })
                : t('{cidr} is not the range of this subnet ({now}). Renumber it in the Subnets tab, which moves its devices with it.', { cidr: values.cidr, now: named.cidr }));
            return;
        }
        const net = named || (values.cidr ? byCidr.get(values.cidr) || null : null);
        const key = net ? net.id : values.cidr;
        if (!key) { conflict(t('A new subnet needs its CIDR, like 10.0.9.0/24.')); return; }
        const fields = Object.keys(values).filter((k) => k !== 'id' && k !== 'cidr');
        const before = said.get(key) || {};
        for (const k of fields) {
            if (Object.prototype.hasOwnProperty.call(before, k) && !csvSameNet(k, before[k], values[k])) {
                conflict(t('Another row sets {field} to {value}.', { field: label(k), value: csvShowNet(k, before[k]) }));
                return;
            }
        }
        said.set(key, Object.assign({}, before, ...fields.map((k) => ({ [k]: values[k] }))));
        if (!net) {
            let rec = fresh.get(values.cidr);
            if (!rec) {
                // The sheet's id when no network here has it, so a second
                // import of the same sheet finds it by id.
                rec = makeNetwork(values.cidr, values.id && !byId.has(values.id) ? values.id : null);
                fresh.set(values.cidr, rec);
                plan.ops.push({ net: { create: rec } });
                out.changes.push({ field: 'CIDR', before: '', after: values.cidr });
            }
            fields.forEach((k) => {
                rec[k] = values[k];
                out.changes.push({ field: label(k), before: '', after: csvShowNet(k, values[k]) });
            });
            Object.assign(out, { status: 'add', netId: rec.id, name: values.cidr });
            results.push(out);
            return;
        }
        out.netId = net.id;
        out.name = isBlank(net.name) ? net.cidr : `${net.cidr} · ${net.name.trim()}`;
        const set = {};
        fields.forEach((k) => {
            if (csvSameNet(k, net[k], values[k])) return;
            set[k] = values[k];
            out.changes.push({ field: label(k), before: csvShowNet(k, net[k]), after: csvShowNet(k, values[k]) });
        });
        if (Object.keys(set).length) {
            out.status = 'change';
            const op = plan.ops.find((o) => o.net && o.net.id === net.id);
            if (op) Object.assign(op.net.set, set); else plan.ops.push({ net: { id: net.id, set } });
        }
        results.push(out);
    });
    return csvFinish(plan, results);
}
// A subnet's value as the review shows it, and equal as the field means it.
function csvShowNet(key, v) {
    if (key === 'dhcp' || key === 'drawZone') return typeof v === 'boolean' ? t(v ? 'Yes' : 'No') : '';
    return v === undefined || v === null ? '' : String(v);
}
function csvSameNet(key, a, b) {
    if (key === 'dhcp') return !!a === !!b;
    if (key === 'drawZone') return (typeof a === 'boolean' ? a : null) === (typeof b === 'boolean' ? b : null);
    if (key === 'gateway') return (isBlank(a) && isBlank(b)) || sameIp(String(a || ''), String(b || ''));
    if (key === 'dns') return dnsKey(a) === dnsKey(b);
    return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
}

// ============================================================================
// Writing a plan
// ============================================================================
// Onto any document of the editor's shape: the live one (state) or a scratch
// copy. The document is lent to the model's helpers for the length of the
// write (as diagnoseDoc does), so bindLink() picks the interfaces of a cable
// the sheet gave no port for on the document being written, not the live one.
// Every record touched or made is then read back through the normalizer.
function csvWrite(plan, doc) {
    const held = { nodes: state.nodes, links: state.links, networks: state.networks };
    if (!Array.isArray(doc.networks)) doc.networks = [];
    state.nodes = doc.nodes; state.links = doc.links; state.networks = doc.networks;
    const touched = new Set(), newLinks = new Set();
    try {
        // Subnets first, each read back through NETWORK_FIELDS as a loaded
        // document's are, so what a device row in the same apply finds is
        // already the network a reload would read.
        plan.ops.forEach((op) => {
            if (!op.net) return;
            const read = (rec) => readFields(NETWORK_FIELDS, writeFields(NETWORK_FIELDS, rec));
            if (op.net.create) { doc.networks.push(read(cloneData(op.net.create))); return; }
            const at = doc.networks.findIndex((n) => n.id === op.net.id);
            if (at > -1) doc.networks[at] = read(Object.assign({}, doc.networks[at], op.net.set));
        });
        plan.ops.forEach((op) => {
            if (op.create) { const rec = cloneData(op.create); doc.nodes.push(rec); touched.add(rec.id); }
        });
        plan.ops.forEach((op) => {
            if (op.create || op.link || op.net) return;
            if (op.linkId) {
                const link = doc.links.find((l) => l.id === op.linkId);
                if (link) Object.assign(link, op.set);
                if (link && link.cable === null) delete link.cable;   // every fact cleared
                return;
            }
            if (op.order) {
                const node = doc.nodes.find((n) => n.id === op.order.nodeId);
                if (!node) return;
                const at = (i) => op.order.ids.indexOf(i.id);
                node.interfaces = (node.interfaces || []).slice().sort((a, b) => at(a) - at(b));
                touched.add(node.id);
                return;
            }
            if (op.port) {
                const node = doc.nodes.find((n) => n.id === op.port.nodeId);
                if (!node) return;
                Object.keys(op.port.set).forEach((k) => setPortAttr(node, op.port.id, k, op.port.set[k]));
                touched.add(node.id);
                return;
            }
            if (op.iface) {
                const node = doc.nodes.find((n) => n.id === op.iface.nodeId);
                if (!node) return;
                node.interfaces = node.interfaces || [];
                let iface = node.interfaces.find((i) => i.id === op.iface.id);
                if (!iface && op.iface.create) { iface = { id: op.iface.id, name: op.iface.name, ip: '' }; node.interfaces.push(iface); }
                if (iface) Object.assign(iface, op.iface.set);
                touched.add(node.id);
                return;
            }
            const node = doc.nodes.find((n) => n.id === op.nodeId);
            if (!node) return;
            Object.assign(node, op.set);
            (op.drop || []).forEach((k) => { delete node[k]; });
            touched.add(node.id);
        });
        // Bound in a lookup pass kept true as each cable lands: a thousand
        // devices hanging off one box without a faceplate is a thousand
        // binds, each asking which of the box's NICs are free, and unindexed
        // that froze the Review click for minutes.
        withLookupPass(() => plan.ops.forEach((op) => {
            if (!op.link) return;
            if (!getNode(op.link.source) || !getNode(op.link.target)) return;
            const link = bindLink(cloneData(op.link));
            doc.links.push(link);
            lookupPassAddLink(link);
            newLinks.add(link.id);
            touched.add(link.source); touched.add(link.target);
        }));
        // Through the normalizer: what a reload would read these records as.
        doc.nodes.forEach((n, i) => { if (touched.has(n.id)) doc.nodes[i] = normalizeLoadedNode(serializeNode(n)); });
        const setLinks = new Set(plan.ops.filter((op) => op.linkId).map((op) => op.linkId));
        doc.links.forEach((l, i) => { if (newLinks.has(l.id) || setLinks.has(l.id)) doc.links[i] = normalizeLoadedLink(serializeLink(l)); });
    } finally {
        state.nodes = held.nodes; state.links = held.links; state.networks = held.networks;
    }
}

// The findings the plan would leave, against the ones there now.
function csvFindingsDelta(plan) {
    if (!plan.ops.length || plan.errors.length) return [];
    const scratch = cloneData({ nodes: state.nodes, links: state.links, networks: state.networks });
    csvWrite(plan, scratch);
    return findingsDelta(topologyFindings(), diagnoseDoc(scratch).findings);
}

// One transaction however many rows: one undo step, one save, one redraw.
// The devices it added or changed are selected afterwards, so the next thing
// done (a bulk edit, a move) applies to them. -> { added, changed }.
function applyCsvPlan(plan) {
    const n = { added: plan.counts.add, changed: plan.counts.change };
    if (!plan.ops.length || plan.errors.length || readOnlyRefuses()) return { added: 0, changed: 0 };
    batch(() => {
        csvWrite(plan, state);
        pruneSelection();
        save();
        renderCanvasOnly();
    });
    const ids = plan.newIds.concat(plan.touchedIds).filter((id) => getNode(id));
    if (ids.length) {
        selectEntries(ids.map((id) => ({ type: 'node', id })));
        const rect = document.getElementById('networkCanvas').getBoundingClientRect();
        const { x, y, zoom } = state.camera;
        const added = plan.newIds.map(getNode).filter(Boolean);
        // Inset by a device's own size: one whose centre is on the edge, or
        // under the floating map controls, is not one anybody sees.
        const m = 70;
        if (added.some((nd) => nd.x * zoom + x < m || nd.x * zoom + x > rect.width - m || nd.y * zoom + y < m || nd.y * zoom + y > rect.height - m)) fitToView();
    } else renderSelection();
    showToast(t('Imported: {added} added, {changed} changed.', n), 'ok');
    return n;
}

// ============================================================================
// Paste anything: the addresses a network has seen (plan 3.5, phase 3)
// ============================================================================
// What a site has on hand is rarely a spreadsheet: it is the router's ARP
// table or the DHCP server's lease list, copied out of a terminal or a web
// page. Each vendor prints it its own way, and the draft's answer was a parser
// per family. This is one tolerant pass instead, because every one of them
// says the same thing: an address, the MAC that answered for it, and
// sometimes a name, on one line:
//
//   Linux     ip neigh         10.0.0.5 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
//             arp -a           pc1.lan (10.0.0.5) at aa:bb:cc:dd:ee:ff [ether] on eth0
//             /proc/net/arp    10.0.0.5  0x1  0x2  aa:bb:cc:dd:ee:ff  *  br-lan
//   macOS     arp -a           ? (10.0.0.5) at a:bb:c:dd:e:f on en0 ifscope [ethernet]
//   Windows   arp -a           10.0.0.5   aa-bb-cc-dd-ee-ff   dynamic
//             DHCP server      10.0.0.5  255.255.255.0  aa-bb-cc-dd-ee-ff  pc1.corp.local  Active
//   Cisco     show ip arp      Internet  10.0.0.5  3  aabb.ccdd.eeff  ARPA  Vlan10
//             show ip dhcp binding   10.0.0.5  01aa.bbcc.ddee.ff  Mar 01 2026 10:00 AM  Automatic
//   HP/Aruba  show arp         10.0.0.5  aabbcc-ddeeff  dynamic  12
//   Juniper   show arp         aa:bb:cc:dd:ee:ff 10.0.0.5 pc1.example.com ge-0/0/1.0 none
//   MikroTik  /ip arp print    0 DC 10.0.0.5 AA:BB:CC:DD:EE:FF ether2
//             lease print detail  address=10.0.0.5 mac-address=… host-name="pc1"
//   dnsmasq   leases file      1729900000 aa:bb:cc:dd:ee:ff 10.0.0.5 pc1 01:aa:bb:…
//   ISC       dhcpd.leases     lease 10.0.0.5 { hardware ethernet aa:…; client-hostname "pc1"; }
//
// So a line is cut into words and each word is asked what it is: a MAC in any
// of the spellings above (colons, dashes, Cisco's dots, HP's two halves, bare
// hex with a letter in it; a DHCP client id is the MAC behind a 01, the
// Ethernet hardware type), an address, a netmask (which then gives the
// address its prefix), or else maybe a name. A name is the value of a
// host-name key when the line has one, the word before "(address)" as
// Linux's arp writes it, or else the first word that is none of the vendors'
// own vocabulary (states, flags, interface names, dates, durations); only its
// first label is kept (pc1.corp.local is pc1). Two records that are one
// entry over several lines are joined first: an ISC lease block, and
// MikroTik's indented key=value continuation lines.
//
// Left out, and counted as such: an address with no MAC beside it (an
// incomplete ARP entry, a Windows "Interface:" heading), broadcast and
// multicast MACs and addresses, loopback, unspecified and link-local ones (a
// 169.254 address is a device that failed to get one, not a fact about the
// network). The same address and MAC seen twice is one observation.
//
// The observations become a sheet of three columns, IP, MAC and Hostname,
// mapped to the device's address, MAC and name, and go into the same mapping
// and review steps as a spreadsheet: matched by MAC, then IP, a
// new device for an address nobody has, conflicts said, the findings delta,
// Apply as one undo step. Two differences, marked on the sheet (observed): a
// row is found by its MAC or address, never by its name, and a name seen on
// the wire never renames a device that is already on the map.
// What a DHCP client calls itself (DESKTOP-8F3K2Q) is not what the register
// calls it (Reception PC); the review says "Seen as …" instead, and a new
// device still takes the name. An address with no prefix takes the one of
// the network it falls in, as any imported address does, and one in no
// network on the map is a conflict that says so, not a /24 nobody said.
//
// Nothing here goes anywhere: the text is read in the page and only what
// Apply writes is kept.
const SEEN_STOP = new Set(('at on dev lladdr via ether ethernet ifscope permanent static dynamic reachable stale delay probe failed '
    + 'incomplete noarp router proxy arpa internet hardware hwtype hwaddress hwaddr flags mask iface interface address addr type age complete '
    + 'published invalid yes no true false none null dhcp dhcpv4 dhcpv6 automatic manual auto online offline active inactive expired '
    + 'abandoned backup reserved reservation released bound free waiting offered authorized lease leases binding state uid client server '
    + 'ip ipv4 ipv6 mac host hostname name unknown infinite never expires ends starts cltt tstp tsfp atsfp next rewind vendor class set '
    + 'utc gmt am pm min mins sec secs days hours minutes local default other wired wireless connected disconnected self mgmt bridge '
    + 'arp rarp eui id vlan port ports entry entries total count drop reject allow other unicast multicast broadcast '
    + 'internal external lan wan dmz guest trusted untrusted outside inside '
    + 'unreachable activestore persistentstore '
    // The maker's name that lease pages (OPNsense, pfSense) print beside the
    // MAC, looked up from its first half: the OUI's owner is not the host.
    + 'intel apple samsung espressif realtek dell hewlett hewlett-packard cisco ubiquiti tp-link tplink microsoft amazon '
    + 'google sonos huawei xiaomi lenovo asustek asus giga-byte gigabyte super micro supermicro vmware proxmox raspberry '
    + 'murata liteon azurewave foxconn netgear synology qnap hikvision dahua brother canon epson mikrotik routerboard '
    + 'zyxel aruba juniper fortinet nintendo sony roku wistron compal quanta pegatron shenzhen hangzhou tuya '
    + 'corporate corporation corp inc ltd limited co gmbh technologies technology electronics communications networks international '
    + 'dynamique statique dynamisch statisch dinamico estatico dinamica estatica '
    + 'jan feb mar apr may jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun').split(' '));
// Interface names, as Linux, the BSDs, Cisco, Juniper, MikroTik and the
// firewalls print them: a known stem and a number (eth0, Gi1/0/2, ge-0/0/1.0,
// ether2, wan1), or OpenWrt's br-lan.
const SEEN_IFACE_RE = /^(?:eth|ens|enp|eno|enx|en|wlp|wlo|wlan|wl|br|bond|vlan|vl|ether|sfp|sfpplus|ge|xe|et|fa|gi|te|tw|hu|po|lo|bridge|tun|tap|wg|ppp|pppoe|ixl|igb|em|re|vmx|vtnet|mgmt|lan|wan|dmz|port|internal|dhcp|wifi|ath|ra)[-_]?\d[\w./:-]*$|^(?:gigabitethernet|fastethernet|tengigabitethernet|ethernet|port-channel)\d|^br-[\w-]+$/i;
// The keys a lease's name is written under (MikroTik, ISC, OPNsense…).
const SEEN_HOST_KEY_RE = /(?:^|[\s{;])(?:host-name|hostname|client-hostname|host_name|client-name)\s*[=:]?\s*(?:"([^"]*)"|([^\s;,"]*))/i;

// A word as a MAC: 12 hex digits, upper case, or ''. clientId: the 7-byte
// form a DHCP server keys a lease on (01 then the MAC).
function seenMac(word) {
    const w = String(word || '');
    const pad = (parts) => parts.map((p) => p.padStart(2, '0')).join('').toUpperCase();
    const parts = w.split(/[:-]/);
    if (/^[0-9a-f]{1,2}([:-][0-9a-f]{1,2}){5}$/i.test(w) && !/:.*-|-.*:/.test(w)) return { mac: pad(parts) };
    if (/^0?1([:-][0-9a-f]{1,2}){6}$/i.test(w) && !/:.*-|-.*:/.test(w)) return { mac: pad(parts.slice(1)), clientId: true };
    if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(w)) return { mac: w.replace(/\./g, '').toUpperCase() };
    if (/^01[0-9a-f]{2}\.[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{2}$/i.test(w)) return { mac: w.replace(/\./g, '').slice(2).toUpperCase(), clientId: true };
    if (/^[0-9a-f]{6}-[0-9a-f]{6}$/i.test(w)) return { mac: w.replace('-', '').toUpperCase() };
    if (/^[0-9a-f]{12}$/i.test(w) && /[a-f]/i.test(w)) return { mac: w.toUpperCase() };
    return null;
}
const seenMacUsable = (hex) => hex.length === 12 && hex !== 'FFFFFFFFFFFF' && hex !== '000000000000' && !(parseInt(hex.slice(0, 2), 16) & 1);
// A word as an address: { ip, prefix? } | { mask: prefix } | null.
function seenIp(word) {
    const m = /^([0-9a-f:.]+?)(?:\/(\d{1,3}))?$/i.exec(String(word || ''));
    if (!m || !isIpText(m[1])) return null;
    const ip = parseIpText(m[1]);
    if (!ip) return null;
    if (ip.kind() === 'ipv4' && m[2] === undefined && ip.octets[0] === 255) {
        const prefix = ip.prefixLengthFromSubnetMask();
        if (prefix !== null && prefix >= 8) return { mask: prefix };
    }
    return { ip, prefix: m[2] !== undefined ? Number(m[2]) : null };
}
// (Not 'reserved': that is where the documentation ranges are, 192.0.2.0/24
// and 2001:db8::/32, which labs and examples use as real networks.)
const SEEN_SKIP_RANGES = new Set(['unspecified', 'broadcast', 'multicast', 'loopback', 'linkLocal']);
// A word as a host name, or ''. named: the line says this word is the name
// (a host-name key, Linux's "name (address)"), so only its shape is checked;
// a word guessed by position must also be none of the vendors' vocabulary.
function seenHost(word, named) {
    const w = String(word || '').replace(/\.$/, '');
    if (w.length < 2 || w.length > 253 || !/^[a-z0-9][a-z0-9_.-]*$/i.test(w) || !/[a-z]/i.test(w)) return '';
    const label = w.split('.')[0];
    if (!label || !/[a-z]/i.test(label)) return '';
    if (named) return label;
    if (SEEN_STOP.has(w.toLowerCase()) || SEEN_STOP.has(label.toLowerCase()) || SEEN_IFACE_RE.test(w)) return '';
    // HP/Aruba's Port column: a module letter and a number (A1, B24), or a
    // trunk (Trk1).
    if (/^[a-z]\d{1,2}$/i.test(w) || /^trk\d+$/i.test(w)) return '';
    if (/^0x[0-9a-f]+$/i.test(w) || /^[A-Z]{1,3}$/.test(w) || /^\d+([smhdw]\d*)+$/i.test(w) || /^\d+(ms|us|ns)$/i.test(w)) return '';
    return label;
}

// The text as records: [{ text, line }] with the joins described above.
function seenRecords(text) {
    const lines = String(text == null ? '' : text).split(/\r\n|\n|\r/);
    const out = [];
    let block = null;
    lines.forEach((raw, i) => {
        const line = i + 1;
        if (block) {
            block.text += ' ' + raw;
            if (/^\s*\}/.test(raw)) { out.push(block); block = null; }
            return;
        }
        if (/\{\s*$/.test(raw)) { block = { text: raw, line, block: true }; return; }
        const prev = out[out.length - 1];
        if (prev && /^\s+\S/.test(raw) && /\S=/.test(raw) && /\S=/.test(prev.text) && !/^\s*\d+\s/.test(raw)) { prev.text += ' ' + raw; return; }
        out.push({ text: raw, line });
    });
    if (block) out.push(block);
    return out;
}

// -> { rows: [{ ip, mac, host, line }], skipped }. ip carries its prefix when
// the line gave one (a /n, or a netmask beside it).
function seenExtract(text) {
    const rows = [], byKey = new Map();
    let skipped = 0;
    seenRecords(text).forEach(({ text: rec, line, block }) => {
        // A bracket right after a MAC is its maker, as pfSense prints it
        // ("aa:bb:… (Raspberry Pi Trading Ltd)"), never the host's name.
        const words = rec.replace(/(\S+)\s*\(([^()]*)\)/g, (all, mac) => (seenMac(mac) ? mac : all))
            .split(/[\s,;()[\]{}"'=<>|]+/).filter(Boolean);
        let ip = null, prefix = null, mask = null, mac = null, idMac = null, sawIp = false;
        const used = new Set();
        words.forEach((w, i) => {
            const m = seenMac(w);
            if (m) {
                used.add(i);
                if (m.clientId) { if (!idMac) idMac = m.mac; } else if (!mac) mac = m.mac;
                return;
            }
            const a = seenIp(w);
            if (!a) return;
            used.add(i);
            if (a.mask !== undefined) { if (mask === null) mask = a.mask; return; }
            sawIp = true;
            if (!ip) { ip = a.ip; prefix = a.prefix; }
        });
        if (!sawIp) return;
        mac = mac || idMac;
        if (!ip || SEEN_SKIP_RANGES.has(ip.range()) || !mac || !seenMacUsable(mac)) { skipped++; return; }
        // The name: a key that says it, Linux's "name (address)", or the first
        // word that is nothing else. A key or a "?" that says there is none
        // is an answer, and no word is guessed in its place.
        let host = null;
        const keyed = SEEN_HOST_KEY_RE.exec(rec);
        if (keyed) host = seenHost(keyed[1] !== undefined ? keyed[1] : keyed[2], true);
        if (host === null) {
            const paren = /(\S+)\s+\(\s*([0-9a-f:.]+)\s*\)/i.exec(rec);
            if (paren && parseIpText(paren[2]) && parseIpText(paren[2]).toString() === ip.toString()) host = paren[1] === '?' ? '' : seenHost(paren[1], true);
        }
        // A record of keys and values (an ISC lease block, MikroTik's print
        // detail, Fortinet's index=5 ifname=…) names its host under a key or
        // not at all: guessed by position, its other keys and values would
        // be taken for names ("vendor-class-identifier", "mac-address").
        if (host === null && (block || /[\w-]=\S/.test(rec))) host = '';
        if (host === null) {
            host = '';
            for (let i = 0; i < words.length && !host; i++) if (!used.has(i)) host = seenHost(words[i]);
        }
        const p = prefix !== null ? prefix : (ip.kind() === 'ipv4' ? mask : null);
        const ipText = p !== null && p !== undefined ? `${ip.toString()}/${p}` : ip.toString();
        const key = `${ip.toString()}|${mac}`;
        const had = byKey.get(key);
        if (had) { if (!had.host && host) had.host = host; return; }
        const row = { ip: ipText, mac: fmtColonSafe(mac).toLowerCase(), host, line };
        byKey.set(key, row);
        rows.push(row);
    });
    return { rows, skipped };
}

// The observations as a sheet the import reads like any other: IP, MAC and,
// when any line had one, Hostname. lines: the text's line number per row,
// for the review. observed: see the header (no renames).
function seenSheet(found) {
    const named = found.rows.some((r) => r.host);
    return {
        headers: named ? ['IP', 'MAC', 'Hostname'] : ['IP', 'MAC'],
        rows: found.rows.map((r) => (named ? [r.ip, r.mac, r.host] : [r.ip, r.mac])),
        hasHeadings: false,
        observed: true,
        lines: found.rows.map((r) => r.line)
    };
}
const SEEN_MAPPING = ['if:ip', 'if:mac', 'name'];

// ============================================================================
// The dialog
// ============================================================================
const _csv = {
    tab: 'export',
    step: 'map',         // 'map' | 'review'
    parsed: null,        // csvParse() of the text
    headings: null,      // the user's "first row is headings", or null for the guess
    mapping: [],         // per column: target key or ''
    chosen: new Map(),   // heading (normalized) -> what the user picked for it
    plan: null,
    timer: 0,
    seen: null,          // seenExtract() of the text: the addresses it shows
    mode: null,          // what the user picked to read it as, or null for the guess
    autoMode: 'sheet'    // the guess: 'sheet' (spreadsheet rows) or 'seen'
};
// What the text is read as: the user's pick, else the guess (csvReparse).
const csvMode = () => (_csv.mode || _csv.autoMode);
const csvEl = (id) => document.getElementById(id);

function openCsvDialog(tab = 'export') {
    _csv.tab = tab;
    renderCsvDialog();
    const scrim = csvEl('csvDialog');
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onClose: () => { clearTimeout(_csv.timer); } });
    else scrim.hidden = false;
}
function closeCsvDialog() {
    const scrim = csvEl('csvDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
}

function renderCsvDialog() {
    document.querySelectorAll('#csvTabs [data-csvtab]').forEach((b) => {
        const on = b.dataset.csvtab === _csv.tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    csvEl('csvPane-export').classList.toggle('hidden', _csv.tab !== 'export');
    csvEl('csvPane-import').classList.toggle('hidden', _csv.tab !== 'import');
    if (_csv.tab === 'export') renderCsvExport(); else renderCsvImport();
    renderCsvFoot();
}

function renderCsvExport() {
    csvEl('csvExportRows').innerHTML = CSV_SHEETS.map((s) => {
        const count = s.build().rows.length;
        return `<div class="csv-sheet" data-sheet="${s.key}">
            <div class="csv-sheet-name"><b>${escapeHtml(csvSheetLabel(s))}</b> <span class="mono csv-sheet-file">${escapeHtml(s.key)}.csv</span>
                <span class="csv-sheet-count">${escapeHtml(t('Rows: {n}', { n: count }))}</span></div>
            <div class="csv-sheet-acts">
                <button type="button" class="btn" data-csv-download="${s.key}"${count ? '' : ' disabled'}>⤓ CSV</button>
                <button type="button" class="btn" data-csv-copy="${s.key}"${count ? '' : ' disabled'}>${escapeHtml(t('Copy as TSV'))}</button>
            </div>
        </div>`;
    }).join('');
}

// ---- Import ----
function csvCurrentSheet() {
    if (csvMode() === 'seen') return _csv.seen && _csv.seen.rows.length ? seenSheet(_csv.seen) : null;
    if (!_csv.parsed || !_csv.parsed.rows.length) return null;
    const headings = _csv.headings === null ? csvHasHeadingRow(_csv.parsed.rows) : _csv.headings;
    return csvSheet(_csv.parsed, headings);
}

// Re-read the text: the mapping is guessed again, except for the columns the
// user has already chosen for (kept by heading).
//
// And what it is read as: an ARP table or a lease list pasted as it was
// printed is one column of text to the spreadsheet reader, which then finds
// no address and no MAC in any column. So when the spreadsheet reading maps
// neither and the extractor found addresses with their MACs, the text is
// read as addresses seen; a sheet with an IP or a MAC column stays a sheet.
// The user can say otherwise either way (Read as).
function csvReparse() {
    const text = csvEl('csvText').value;
    _csv.parsed = text.trim() ? csvParse(text) : null;
    _csv.seen = text.trim() ? seenExtract(text) : null;
    let guess = 'sheet';
    if (_csv.seen && _csv.seen.rows.length) {
        const rows = _csv.parsed ? _csv.parsed.rows : [];
        const asSheet = rows.length ? csvSheet(_csv.parsed, csvHasHeadingRow(rows)) : null;
        const keys = asSheet ? csvAutoMap(asSheet) : [];
        if (!keys.includes('if:ip') && !keys.includes('if:mac')) guess = 'seen';
    }
    _csv.autoMode = guess;
    const sheet = csvCurrentSheet();
    if (!sheet) { _csv.mapping = []; return; }
    if (sheet.observed) {
        // Its columns are known; only what the user picked for them changes.
        _csv.mapping = sheet.headers.map((h, i) => (_csv.chosen.has(csvNorm(h)) ? _csv.chosen.get(csvNorm(h)) : SEEN_MAPPING[i]));
        return;
    }
    const auto = csvAutoMap(sheet);
    const used = new Set();
    _csv.mapping = sheet.headers.map((h, i) => {
        const k = csvNorm(h);
        const picked = _csv.chosen.has(k) ? _csv.chosen.get(k) : auto[i];
        if (!picked || used.has(picked)) return '';
        used.add(picked);
        return picked;
    });
}

function renderCsvImport() {
    const sheet = csvCurrentSheet();
    const review = _csv.step === 'review' && sheet;
    csvEl('csvSource').classList.toggle('hidden', !!review);
    csvEl('csvReview').classList.toggle('hidden', !review);
    csvEl('csvMapWrap').classList.toggle('hidden', !sheet || !!review);
    if (review) { renderCsvReview(); return; }
    // Read as: offered once the text shows an address with its MAC.
    const found = _csv.seen ? _csv.seen.rows.length : 0;
    csvEl('csvReadAs').classList.toggle('hidden', !found);
    csvEl('csvReadAs').querySelectorAll('[data-readas]').forEach((b) => {
        const on = b.dataset.readas === csvMode();
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (!sheet) return;
    csvEl('csvHasHeadings').checked = sheet.hasHeadings;
    csvEl('csvHasHeadings').closest('label').classList.toggle('hidden', !!sheet.observed);
    const kind = csvSheetKind(_csv.mapping);
    const seenLine = () => {
        const named = _csv.seen.rows.filter((r) => r.host).length;
        let line = t('Addresses seen with their MAC: {n}, with a name: {named}.', { n: found, named });
        if (_csv.seen.skipped) line += ' ' + t('Lines left out: {n} (no MAC beside the address, or a broadcast, multicast or link-local one).', { n: _csv.seen.skipped });
        return line;
    };
    csvEl('csvKind').textContent = kind === 'mixed' ? t('Map either device columns or cable columns: a sheet is one or the other.')
        : kind === 'mixed-ports' ? t(CSV_MIXED_PORTS)
        : kind === 'mixed-subnets' ? t(CSV_MIXED_SUBNETS)
            : sheet.observed && kind === 'devices' ? seenLine()
                : t(kind === 'cables' ? 'Rows of cables: {n}' : kind === 'ports' ? 'Rows of ports: {n}' : kind === 'subnets' ? 'Rows of subnets: {n}' : 'Rows of devices: {n}', { n: sheet.rows.length });
    csvEl('csvKind').classList.toggle('csv-kind-bad', /^mixed/.test(kind));
    // 'Ports' stays English here, like 'Interface': the full editor's
    // technical vocabulary (see the header).
    const groups = [['device', t('Device')], ['iface', 'Interface'], ['cabling', t('Cabling')], ['cable', t('Cables')], ['port', 'Ports'], ['network', 'Subnets']];
    const options = (sel) => `<option value="">${escapeHtml(t('Ignore'))}</option>` + groups.map(([g, label]) =>
        `<optgroup label="${escapeHtml(label)}">${csvTargets().filter((tg) => tg.group === g).map((tg) =>
            `<option value="${escapeHtml(tg.key)}"${tg.key === sel ? ' selected' : ''}>${escapeHtml(csvTargetLabel(tg))}${tg.csv && csvNorm(tg.csv) !== csvNorm(csvTargetLabel(tg)) ? ` · ${escapeHtml(tg.csv)}` : ''}</option>`).join('')}</optgroup>`).join('');
    csvEl('csvMap').innerHTML = sheet.headers.map((h, i) => {
        const samples = sheet.rows.slice(0, 3).map((r) => String(r[i] || '').trim()).filter(Boolean);
        return `<div class="csv-col${_csv.mapping[i] ? ' mapped' : ''}">
            <label for="csvCol-${i}"><b>${escapeHtml(h)}</b><span class="csv-sample mono">${escapeHtml(samples.join(' · ') || '—')}</span></label>
            <select id="csvCol-${i}" class="select" data-col="${i}">${options(_csv.mapping[i])}</select>
        </div>`;
    }).join('');
}

function renderCsvReview() {
    const plan = _csv.plan;
    const c = plan.counts;
    const bits = [[t('To add'), c.add], [t('To change'), c.change], [t('Unchanged'), c.same], [t('Conflicts'), c.conflict]];
    csvEl('csvCounts').innerHTML = bits.map(([label, n]) => `<span class="paste-count${n ? '' : ' zero'}"><b class="mono">${n}</b> ${escapeHtml(label)}</span>`).join('');
    const msgs = plan.errors.map((m) => `<div class="alert err">${escapeHtml(m)}</div>`);
    csvEl('csvMsgs').innerHTML = msgs.join('');
    csvEl('csvMsgs').classList.toggle('hidden', !msgs.length);
    const mark = { add: '+', change: '→', same: '=', conflict: '✕' };
    const cls = { add: 'change', change: 'change', same: 'same', conflict: 'bad' };
    const sheet = csvCurrentSheet();
    const first = sheet.hasHeadings ? 2 : 1;   // the sheet's own row numbers
    // Addresses seen are numbered by the line of the text they came from.
    const where = (r) => (sheet.lines ? t('Line {n}', { n: sheet.lines[r.index] }) : t('Row {n}', { n: r.index + first }));
    csvEl('csvPreview').innerHTML = plan.rows.slice(0, 500).map((r) => {
        const detail = r.status === 'conflict' ? escapeHtml(r.why)
            : r.changes.map((ch) => `${ch.field ? `<span class="bulk-what">${escapeHtml(ch.field)}</span>` : ''}${ch.before ? `${escapeHtml(ch.before)} → ` : ''}${escapeHtml(ch.after)}`).join('<br>')
              + r.notes.map((nt) => `<span class="csv-note">${escapeHtml(nt)}</span>`).join('');
        return `<tr class="paste-${cls[r.status]}">
            <td>${escapeHtml(r.name || '—')}<span class="bulk-what">${escapeHtml(where(r))}</span></td>
            <td class="paste-mark" title="${escapeHtml(r.why || '')}">${mark[r.status]}</td>
            <td class="mono">${detail || escapeHtml(t('Nothing to change.'))}</td>
        </tr>`;
    }).join('');
    csvEl('csvPreviewWrap').classList.toggle('hidden', !plan.rows.length);
    csvEl('csvDelta').innerHTML = findingsDeltaHtml(csvFindingsDelta(plan), (c.add + c.change) > 0 && !plan.errors.length);
}

function renderCsvFoot() {
    const importing = _csv.tab === 'import';
    const review = importing && _csv.step === 'review' && !!csvCurrentSheet();
    const sheet = csvCurrentSheet();
    csvEl('csvBackBtn').classList.toggle('hidden', !review);
    csvEl('csvReviewBtn').classList.toggle('hidden', !importing || review);
    csvEl('csvApplyBtn').classList.toggle('hidden', !review);
    csvEl('csvReviewBtn').disabled = !sheet || !_csv.mapping.some(Boolean) || /^mixed/.test(csvSheetKind(_csv.mapping));
    if (review) {
        const c = _csv.plan.counts;
        csvEl('csvApplyBtn').disabled = !(c.add + c.change) || _csv.plan.errors.length > 0;
    }
    csvEl('csvCloseBtn').textContent = importing ? t('Cancel') : t('Close');
}

function csvToReview() {
    const sheet = csvCurrentSheet();
    if (!sheet || readOnlyRefuses()) return;
    _csv.plan = csvPlan(sheet, _csv.mapping);
    _csv.step = 'review';
    renderCsvDialog();
}
function csvApplyDialog() {
    const sheet = csvCurrentSheet();
    if (!sheet) return;
    // Re-planned from the same sheet and mapping: a stale plan is never
    // what is written.
    const plan = csvPlan(sheet, _csv.mapping);
    if (!(plan.counts.add + plan.counts.change) || plan.errors.length) return;
    closeCsvDialog();
    applyCsvPlan(plan);
    _csv.step = 'map';
}

function csvLoadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        csvEl('csvText').value = String(reader.result || '');
        _csv.headings = null; _csv.mode = null; _csv.step = 'map'; _csv.chosen.clear();
        csvReparse(); renderCsvDialog();
    };
    reader.onerror = () => showToast(t('Could not read that file.'), 'err');
    reader.readAsText(file);
}

// ---- Wiring ----
(function wireCsvDialog() {
    const scrim = csvEl('csvDialog');
    if (!scrim) return;
    csvEl('csvMenuBtn').addEventListener('click', () => openCsvDialog('export'));
    csvEl('csvTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-csvtab]');
        if (!b) return;
        _csv.tab = b.dataset.csvtab;
        renderCsvDialog();
    });
    csvEl('csvExportRows').addEventListener('click', (e) => {
        const dl = e.target.closest('[data-csv-download]');
        if (dl) { downloadCsv(dl.dataset.csvDownload); return; }
        const cp = e.target.closest('[data-csv-copy]');
        if (cp) copyTsv(cp.dataset.csvCopy);
    });
    csvEl('csvText').addEventListener('input', () => {
        clearTimeout(_csv.timer);
        _csv.timer = setTimeout(() => { _csv.headings = null; _csv.mode = null; csvReparse(); renderCsvImport(); renderCsvFoot(); }, 200);
    });
    // Read as: spreadsheet rows or addresses seen. The columns differ, so
    // what was picked for the other reading's columns is let go.
    csvEl('csvReadAs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-readas]');
        if (!b || b.dataset.readas === csvMode()) return;
        _csv.mode = b.dataset.readas; _csv.chosen.clear();
        csvReparse(); renderCsvImport(); renderCsvFoot();
    });
    csvEl('csvFileBtn').addEventListener('click', () => csvEl('csvFileInput').click());
    csvEl('csvFileInput').addEventListener('change', (e) => { csvLoadFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    csvEl('csvHasHeadings').addEventListener('change', (e) => {
        _csv.headings = e.target.checked; _csv.chosen.clear();
        csvReparse(); renderCsvImport(); renderCsvFoot();
    });
    // A field is mapped once: picking it for a column takes it off another.
    csvEl('csvMap').addEventListener('change', (e) => {
        const col = e.target.dataset && e.target.dataset.col;
        if (col === undefined) return;
        const i = Number(col), key = e.target.value;
        const sheet = csvCurrentSheet();
        _csv.mapping = _csv.mapping.map((k, j) => (j === i ? key : (key && k === key ? '' : k)));
        // Held by heading, so editing the pasted text keeps what was picked.
        sheet.headers.forEach((h, j) => _csv.chosen.set(csvNorm(h), _csv.mapping[j]));
        renderCsvImport(); renderCsvFoot();
    });
    csvEl('csvReviewBtn').addEventListener('click', csvToReview);
    csvEl('csvBackBtn').addEventListener('click', () => { _csv.step = 'map'; renderCsvDialog(); });
    csvEl('csvApplyBtn').addEventListener('click', csvApplyDialog);
})();
