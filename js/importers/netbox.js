// ---- NetBox to Topo (docs/SCOPE.md step 6, D116) ----
// Reads what NetBox gives out, all files of one import together:
//   - the REST API's JSON saved to files (/api/dcim/devices/?limit=0 and the
//     like): a page { count, next, previous, results }, a bare list, or
//     several pages in one file;
//   - CSV, either the list views' "Export" (verbose headers: "Device Type",
//     "Serial number") or the bulk-import form's field names (device_type);
//   - the set Topo's own "Export to NetBox" writes, whose topo_* custom fields
//     give the network back exactly (js/netboxexport.js).
// Mapping, briefly: sites (more than one) and locations are groups, racks are
// rack groups, devices and virtual machines are devices, interfaces (a
// switch's numbered ports become its port grid), addresses on interfaces,
// prefixes are subnets named by their VLANs, cables and wireless links are
// cables, wireless LANs are Wi-Fi networks, providers are providers, tags
// are a "Tags" column and custom fields are custom columns. A VLAN with no
// prefix is noted (it stays on its ports); an address on no interface is
// skipped and listed. Passwords and keys are never read.

(function () {
'use strict';
const C = window.TopoImportCommon;
const NBX = () => window.TopoNetbox || {};

const API_TYPES = {
    'dcim/devices': 'devices', 'dcim/interfaces': 'interfaces', 'dcim/cables': 'cables', 'ipam/ip-addresses': 'ips', 'ipam/prefixes': 'prefixes',
    'ipam/vlans': 'vlans', 'dcim/sites': 'sites', 'dcim/locations': 'locations', 'dcim/racks': 'racks', 'wireless/wireless-lans': 'wlans',
    'wireless/wireless-links': 'wlinks', 'circuits/providers': 'providers', 'virtualization/virtual-machines': 'vms', 'virtualization/interfaces': 'vmifaces',
    'dcim/mac-addresses': 'macs', 'extras/tags': 'skip', 'virtualization/clusters': 'clusters', 'extras/custom-fields': 'cfs', 'dcim/manufacturers': 'skip',
    'dcim/device-types': 'devicetypes', 'dcim/device-roles': 'skip', 'dcim/platforms': 'skip', 'virtualization/cluster-types': 'skip'
};
const FILE_TYPES = [[/custom.?fields?/, 'cfs'], [/vm.?interfaces?|virtualization.?interfaces?/, 'vmifaces'], [/virtual.?machines?/, 'vms'], [/mac.?addresses/, 'macs'],
    [/ip.?addresses/, 'ips'], [/interfaces?/, 'interfaces'], [/wireless.?links?/, 'wlinks'], [/wireless.?lans?/, 'wlans'], [/cables?/, 'cables'], [/prefixes/, 'prefixes'],
    [/vlans?/, 'vlans'], [/locations?/, 'locations'], [/racks?/, 'racks'], [/sites?/, 'sites'], [/providers?/, 'providers'], [/cluster.?types?/, 'skip'],
    [/clusters?/, 'clusters'], [/device.?types?/, 'devicetypes'], [/roles?/, 'skip'], [/manufacturers?/, 'skip'], [/platforms?/, 'skip'], [/tags?/, 'skip'],
    [/devices?/, 'devices']];
const ALIAS = {
    id: 'id', name: 'name', slug: 'slug', status: 'status', description: 'description', comments: 'comments', tags: 'tags', site: 'site', location: 'location',
    rack: 'rack', role: 'role', devicerole: 'role', manufacturer: 'manufacturer', devicetype: 'device_type', model: 'model', platform: 'platform', serial: 'serial',
    serialnumber: 'serial', assettag: 'asset_tag', position: 'position', positionu: 'position', face: 'face', rackface: 'face', cluster: 'cluster', device: 'device',
    virtualmachine: 'virtual_machine', label: 'label', type: 'type', enabled: 'enabled', mgmtonly: 'mgmt_only', managementonly: 'mgmt_only', macaddress: 'mac_address',
    primarymacaddress: 'mac_address', mode: 'mode', '8021qmode': 'mode', untaggedvlan: 'untagged_vlan', taggedvlans: 'tagged_vlans', lag: 'lag', parentlag: 'lag',
    poemode: 'poe_mode', poetype: 'poe_type', sideadevice: 'side_a_device', sideasite: 'side_a_site', sidebsite: 'side_b_site', sideatype: 'side_a_type', sideaname: 'side_a_name', terminationa: 'side_a_name',
    terminationsa: 'side_a_name', sidea: 'side_a_name', sidebdevice: 'side_b_device', sidebtype: 'side_b_type', sidebname: 'side_b_name', terminationb: 'side_b_name',
    terminationsb: 'side_b_name', sideb: 'side_b_name', devicea: 'device_a', deviceb: 'device_b', interfacea: 'interface_a', interfaceb: 'interface_b', color: 'color',
    colour: 'color', length: 'length', lengthunit: 'length_unit', address: 'address', ipaddress: 'address', interface: 'interface', assignedobject: 'interface',
    assigned: 'assigned', isprimary: 'is_primary', dnsname: 'dns_name', parent: 'parent', prefix: 'prefix', vlan: 'vlan', ispool: 'is_pool', vid: 'vid', vlanid: 'vid',
    uheight: 'u_height', height: 'u_height', heightu: 'u_height', width: 'width', outerdepth: 'outer_depth', outerunit: 'outer_unit', descunits: 'desc_units',
    descendingunits: 'desc_units', ssid: 'ssid', authtype: 'auth_type', authenticationtype: 'auth_type', objecttypes: 'object_types', contenttypes: 'object_types',
    vmrole: 'vm_role', vcpus: 'vcpus', memory: 'memory', memorymb: 'memory', facility: 'facility', accounts: 'accounts', tenant: 'tenant', vrf: 'vrf',
    scopetype: 'scope_type', isfulldepth: 'is_full_depth', primaryipv4: 'primary_ip', primaryip: 'primary_ip', primaryip4: 'primary_ip'
};
// Headers no other tool writes: a CSV needs one of them to be NetBox's.
const NB_ONLY = new Set(['device_type', 'role', 'side_a_device', 'side_b_device', 'u_height', 'vid', 'prefix', 'mgmt_only', 'untagged_vlan', 'tagged_vlans', 'dns_name',
    'vrf', 'tenant', 'object_types', 'desc_units', 'virtual_machine', 'scope_type', 'auth_type', 'interface_a', 'side_a_name', 'is_full_depth', 'vm_role', 'poe_mode', 'facility']);

const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();
const truthy = (v) => v === true || /^(true|yes|1|y|✓)$/i.test(String(v == null ? '' : v).trim());
const choice = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? (v.value !== undefined ? v.value : v.label) : v);

// ---- Reading the files ----
function typeOfUrl(url) {
    const m = /\/api\/([a-z-]+\/[a-z-]+)\//.exec(String(url || ''));
    return m ? (API_TYPES[m[1]] || 'other:' + m[1]) : '';
}
function typeOfName(name) {
    const s = lc(name).replace(/\.(csv|json|txt)$/, '');
    const hit = FILE_TYPES.find(([re]) => re.test(s));
    return hit ? hit[1] : '';
}
function typeOfHeaders(keys) {
    const h = new Set(keys);
    if (h.has('side_a_device') || h.has('side_a_name')) return 'cables';
    if (h.has('object_types')) return 'cfs';
    if (h.has('interface_a') || h.has('device_a')) return 'wlinks';
    if (h.has('ssid')) return 'wlans';
    if (h.has('prefix')) return 'prefixes';
    if (h.has('address') && (h.has('dns_name') || h.has('interface') || h.has('vrf') || h.has('assigned'))) return 'ips';
    if (h.has('vid')) return 'vlans';
    if (h.has('mac_address') && h.has('interface') && !h.has('name')) return 'macs';
    if (h.has('virtual_machine') && h.has('name')) return 'vmifaces';
    if (h.has('device') && h.has('name') && (h.has('type') || h.has('mgmt_only') || h.has('enabled') || h.has('mac_address'))) return 'interfaces';
    if (h.has('device_type') || (h.has('role') && (h.has('serial') || h.has('rack') || h.has('position') || h.has('platform')))) return 'devices';
    if (h.has('u_height') && h.has('width')) return 'racks';
    if (h.has('cluster') && (h.has('vcpus') || h.has('memory') || h.has('role'))) return 'vms';
    if (h.has('parent') && h.has('site') && h.has('name')) return 'locations';
    if (h.has('facility') || (h.has('slug') && h.has('name') && h.has('status') && h.size <= 8 && !h.has('color'))) return 'sites';
    return '';
}
const headerToKey = (h) => {
    const raw = String(h || '').trim();
    if (/^cf_/i.test(raw)) return 'cf:' + raw.slice(3).toLowerCase();
    if (/^topo_/i.test(raw)) return 'cf:' + raw.toLowerCase();
    if (C.isSecretKey(raw)) return '#secret';
    return ALIAS[C.headerKey(raw)] || '';
};

// One REST record as a flat row: choices to their value, references to a
// name (and their id beside it), lists of tags and VLANs to names and vids.
function flatRest(rec, type) {
    const out = { cf: {}, tags: [] };
    Object.keys(rec).forEach((k) => {
        const v = rec[k];
        if (v === null || v === undefined) return;
        if (k === 'custom_fields' && typeof v === 'object') { out.cf = Object.assign({}, v); return; }
        if (C.isSecretKey(k)) { if (v !== '') out._secrets = (out._secrets || 0) + 1; return; }
        if (k === 'tags' && Array.isArray(v)) { out.tags = v.map((x) => (x && typeof x === 'object' ? x.name || x.slug : String(x))).filter(Boolean); return; }
        if (k === 'tagged_vlans' && Array.isArray(v)) { out.tagged_vlans = v.map((x) => (x && typeof x === 'object' ? x.vid : x)).filter((x) => x != null).join(','); return; }
        if ((k === 'untagged_vlan' || k === 'vlan') && v && typeof v === 'object') { out[k] = v.vid != null ? String(v.vid) : ''; out[k + '_id'] = v.id; return; }
        if (Array.isArray(v)) return;
        if (v && typeof v === 'object') {
            if ('value' in v && ('label' in v || !('id' in v))) { out[k] = v.value; return; }
            out[k] = v.name != null ? v.name : v.model != null ? v.model : v.address != null ? v.address : v.mac_address != null ? v.mac_address : v.display != null ? v.display : '';
            if (v.id != null) out[k + '_id'] = v.id;
            return;
        }
        out[k] = v;
    });
    if (rec.device_role && !out.role) out.role = out.device_role;
    if (rec.device_type && typeof rec.device_type === 'object') {
        out.manufacturer = rec.device_type.manufacturer ? rec.device_type.manufacturer.name || '' : out.manufacturer || '';
        if (rec.device_type.u_height != null) out.u_height = rec.device_type.u_height;
    }
    if (rec.primary_ip4 && typeof rec.primary_ip4 === 'object') { out.primary_ip = rec.primary_ip4.address; out.primary_ip_id = rec.primary_ip4.id; }
    if (rec.primary_mac_address && typeof rec.primary_mac_address === 'object') out.mac_address = rec.primary_mac_address.mac_address;
    if (rec.virtual_machine && typeof rec.virtual_machine === 'object') out.virtual_machine = rec.virtual_machine.name;
    const end = (side, terms) => {
        const t0 = Array.isArray(terms) ? terms[0] : null;
        if (!t0) return;
        const o = t0.object || {};
        out[`side_${side}_type`] = t0.object_type || '';
        out[`side_${side}_name`] = o.name || '';
        out[`side_${side}_device`] = o.device ? o.device.name || '' : '';
        out[`side_${side}_device_id`] = o.device ? o.device.id : undefined;
        out[`side_${side}_iface_id`] = t0.object_id;
    };
    if (type === 'cables') { end('a', rec.a_terminations); end('b', rec.b_terminations); }
    if ((type === 'ips' || type === 'macs') && rec.assigned_object) {
        const a = rec.assigned_object;
        out.interface = a.name || '';
        out.iface_id = rec.assigned_object_id;
        out.iface_vm = /vminterface/.test(rec.assigned_object_type || '');
        if (a.device) { out.device = a.device.name; out.device_id = a.device.id; }
        if (a.virtual_machine) { out.virtual_machine = a.virtual_machine.name; out.device_id = a.virtual_machine.id; }
    }
    if (type === 'wlinks') ['a', 'b'].forEach((s) => {
        const i = rec['interface_' + s];
        if (i && typeof i === 'object') { out['interface_' + s] = i.name; out['iface_' + s + '_id'] = i.id; out['device_' + s] = i.device ? i.device.name : ''; }
    });
    return out;
}
// One CSV row as a flat row.
function flatCsv(headers, keys, cells, type) {
    const out = { cf: {}, tags: [] };
    keys.forEach((k, i) => {
        const v = cells[i] === undefined ? '' : String(cells[i]);
        if (!k) return;
        if (k === '#secret') { if (v.trim() !== '') out._secrets = (out._secrets || 0) + 1; return; }
        if (k.startsWith('cf:')) { if (v.trim() !== '') out.cf[k.slice(3)] = v; return; }
        if (k === 'tags') { out.tags = v.split(/\s*,\s*/).filter(Boolean); return; }
        if (v.trim() !== '' && out[k] === undefined) out[k] = v.trim();
    });
    if (type === 'devices' && out.type && !out.device_type) out.device_type = out.type;
    if (type === 'cables') {
        if (!out.side_a_device && out.device_a) out.side_a_device = out.device_a;
        if (!out.side_b_device && out.device_b) out.side_b_device = out.device_b;
        if (!out.side_a_name && out.interface_a) out.side_a_name = out.interface_a;
        if (!out.side_b_name && out.interface_b) out.side_b_name = out.interface_b;
    }
    if (type === 'ips' && out.parent && !out.device && !out.virtual_machine) out.device = out.parent;
    if (type === 'devicetypes' && out.model && !out.device_type) out.device_type = out.model;
    return out;
}
// The unread headers of a CSV file (said once).
const unreadHeaders = (headers, keys) => headers.filter((h, i) => !keys[i] && h.trim());

// files -> { rows: { type: [row] }, warnings, notRead: Map, unread: [], host }
function collect(files) {
    const rows = {}, warnings = [], notRead = new Map(), unread = new Set();
    let host = '';
    const add = (type, row) => { (rows[type] = rows[type] || []).push(row); };
    files.forEach((f) => {
        const values = C.parseJsonValues(f.text);
        if (values) {
            const recs = [];
            const take = (v) => {
                if (Array.isArray(v)) v.forEach(take);
                else if (v && typeof v === 'object' && Array.isArray(v.results)) v.results.forEach((r) => recs.push(r));
                else if (v && typeof v === 'object') recs.push(v);
            };
            values.forEach(take);
            const byName = typeOfName(f.name);
            recs.forEach((r, i) => {
                if (!r || typeof r !== 'object') return;
                if (!host && r.url) { const m = /^https?:\/\/([^/]+)/.exec(r.url); if (m) host = m[1]; }
                let type = typeOfUrl(r.url) || byName || typeOfHeaders(Object.keys(r));
                if (!type) { notRead.set('unknown', (notRead.get('unknown') || 0) + 1); return; }
                if (type.startsWith('other:')) { notRead.set(type.slice(6), (notRead.get(type.slice(6)) || 0) + 1); return; }
                if (type === 'skip') return;
                const row = flatRest(r, type);
                row._w = { file: f.name, row: i + 1 };
                add(type, row);
            });
            return;
        }
        const tbl = C.csvTable(f.text);
        if (!tbl) { warnings.push(C.issue('file-unknown', { file: f.name })); return; }
        const keys = tbl.headers.map(headerToKey);
        const type = typeOfName(f.name) && typeOfName(f.name) !== 'skip' ? typeOfName(f.name) : typeOfHeaders(keys.filter(Boolean));
        if (typeOfName(f.name) === 'skip') return;
        if (!type) { warnings.push(C.issue('file-unknown', { file: f.name })); return; }
        unreadHeaders(tbl.headers, keys).forEach((h) => unread.add(h));
        tbl.rows.forEach((r) => {
            const row = flatCsv(tbl.headers, keys, r.cells, type);
            row._w = { file: f.name, row: r.row };
            add(type, row);
        });
    });
    return { rows, warnings, notRead, unread: [...unread], host };
}

// ---- Detection ----
function detect(file) {
    const values = C.parseJsonValues(file.text);
    if (values) {
        let rec = null;
        const find = (v) => { if (rec) return; if (Array.isArray(v)) v.forEach(find); else if (v && typeof v === 'object') { if (Array.isArray(v.results)) v.results.forEach(find); else rec = v; } };
        values.forEach(find);
        if (!rec) return 0;
        if (typeOfUrl(rec.url) && !typeOfUrl(rec.url).startsWith('other:')) return 0.95;
        if (/\/api\/[a-z-]+\/[a-z-]+\//.test(String(rec.url || ''))) return 0.7;
        if ('display' in rec && (rec.device_type || rec.a_terminations || rec.assigned_object_type)) return 0.75;
        return 0;
    }
    const tbl = /^[^\r\n]*[,;\t]/.test(file.text || '') ? C.csvTable(file.text) : null;
    if (!tbl) return 0;
    const keys = tbl.headers.map(headerToKey);
    const nb = keys.filter((k) => NB_ONLY.has(k) || (k && k.startsWith('cf:topo_'))).length;
    const type = typeOfHeaders(keys.filter(Boolean)) || (typeOfName(file.name) !== 'skip' ? typeOfName(file.name) : '');
    if (keys.includes('cf:topo_id')) return 0.95;
    if (nb >= 2 && type) return 0.85;
    if (nb >= 1 && type && typeOfName(file.name)) return 0.75;
    if (typeOfName(file.name) === 'skip' && nb >= 1) return 0.6;
    return 0;
}

// ---- Building the network ----
const STATUS_IN = { active: 'active', planned: 'planned', staged: 'planned', inventory: 'planned', decommissioning: 'retired', offline: 'retired', failed: 'retired' };
const POE_IN = { 'type1-ieee802.3af': 'af', 'type2-ieee802.3at': 'at', 'type3-ieee802.3bt': 'bt3', 'type4-ieee802.3bt': 'bt4' };
const AUTH_IN = { open: 'open', wep: 'wep', 'wpa-personal': 'wpa2', 'wpa-enterprise': 'wpa2-ent' };
const CABLE_IN = (t) => (/^(cat|utp|stp|ftp|sftp)/i.test(t) ? 'utp' : /mmf|smf|fiber|fibre|aoc|om\d|os\d/i.test(t) ? 'fiber' : /power/i.test(t) ? 'powerline' : '');
const isWirelessType = (t) => /802\.11|ieee80211|wireless|wifi|wi-fi/i.test(String(t || ''));
const isLagType = (t) => /^lag$|link aggregation/i.test(String(t || '').trim());
const isVirtualIfType = (t) => /virtual|bridge|loopback/i.test(String(t || ''));
// A VLAN reference as its vid: "10", "Data (10)", or a VLAN's name.
function vidOf(text, vlanByName) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return undefined;
    if (/^\d+$/.test(s)) return asVlan(Number(s));
    const m = /\((\d{1,4})\)\s*$/.exec(s);
    if (m) return asVlan(Number(m[1]));
    return vlanByName.get(lc(s));
}
const moreOf = (cf) => {
    const v = cf && cf.topo_more;
    if (!v) return null;
    if (typeof v === 'object') return v;
    try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : null; } catch (e) { return null; }
};

function parse(files, opts = {}) {
    const got = collect(files);
    const R = got.rows, warnings = got.warnings.slice(), notes = [];
    const list = (k) => R[k] || [];
    const tid = C.idMaker();
    const siteNames = new Set();
    ['sites', 'devices', 'racks', 'locations', 'vms'].forEach((k) => list(k).forEach((r) => { if (r.site) siteNames.add(r.site); else if (k === 'sites' && r.name) siteNames.add(r.name); }));
    const src = C.sourceTag(got.host || [...siteNames].sort().join('|') || files.map((f) => f.name).join('|'));
    const nbId = (letter, r) => (r && r.id !== undefined && r.id !== '' && /^\d+$/.test(String(r.id)) ? `nb-${src}-${letter}${r.id}` : tid(letter));
    let secrets = 0;
    Object.values(R).forEach((rows) => rows.forEach((r) => { secrets += r._secrets || 0; }));
    const doc = { nodes: [], links: [], networks: [], groups: [], wifi: [], providers: [], columns: [] };

    // Custom fields and tags as columns.
    const cfDefs = new Map();
    list('cfs').forEach((r) => { if (r.name) cfDefs.set(lc(r.name), { label: r.label || r.name, type: lc(r.type) }); });
    const colByKey = new Map();
    let colsDropped = 0;
    const columnFor = (key, label, kind) => {
        if (colByKey.has(key)) return colByKey.get(key);
        if (doc.columns.length >= CUSTOM_MAX) { colsDropped++; colByKey.set(key, null); return null; }
        const topo = /^topo_c_(c[0-9a-z]{1,12})$/.exec(key);
        const col = { id: topo ? topo[1] : (key === '#tags' ? 'imp-ctags' : tid('c')), name: customName(label).slice(0, 60) || key, kind };
        doc.columns.push(col);
        colByKey.set(key, col);
        return col;
    };
    const kindOfValues = (vals) => {
        const v = vals.filter((x) => x !== '' && x != null);
        if (!v.length) return 'text';
        if (v.every((x) => typeof x === 'boolean' || /^(true|false)$/i.test(String(x)))) return 'yesno';
        if (v.every((x) => typeof x === 'number' || /^-?\d+(\.\d+)?$/.test(String(x)))) return 'number';
        if (v.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x)))) return 'date';
        return 'text';
    };
    // Topo's own custom columns (topo_c_<id>), named from the custom-fields file.
    cfDefs.forEach((d, name) => { if (/^topo_c_c[0-9a-z]{1,12}$/.test(name)) columnFor(name, d.label, (NBX().CF_CUSTOM_KIND || {})[d.type] || 'text'); });
    ['devices', 'vms'].forEach((k) => list(k).forEach((r) => Object.keys(r.cf).forEach((n) => { if (/^topo_c_c[0-9a-z]{1,12}$/.test(n)) columnFor(n, n.slice(7), 'text'); })));
    const cfValues = new Map();
    ['devices', 'vms'].forEach((k) => list(k).forEach((r) => Object.keys(r.cf).forEach((n) => {
        if (/^topo_/.test(n) && !/^topo_c_/.test(n)) return;
        const a = cfValues.get(n) || []; a.push(choice(r.cf[n])); cfValues.set(n, a);
    })));
    const applyExtra = (node, r) => {
        const extra = Object.assign({}, node.extra || {});
        Object.keys(r.cf).forEach((n) => {
            if (/^topo_/.test(n) && !/^topo_c_/.test(n)) return;
            let v = choice(r.cf[n]);
            if (v === null || v === undefined || v === '') return;
            if (C.isSecretKey(n)) { secrets++; return; }
            if (Array.isArray(v)) v = v.join(', ');
            if (typeof v === 'object') v = JSON.stringify(v);
            const def = cfDefs.get(n);
            const kind = def ? (NBX().CF_CUSTOM_KIND || {})[def.type] || 'text' : kindOfValues(cfValues.get(n) || []);
            const col = columnFor(n, def ? def.label : n.replace(/^topo_c_/, ''), kind);
            if (!col) return;
            const p = parseCustomValue(col, v);
            if (!p.error && p.value !== undefined) extra[col.id] = p.value;
        });
        if (r.tags && r.tags.length) {
            const col = columnFor('#tags', 'Tags', 'text');
            if (col) extra[col.id] = r.tags.join(', ');
        }
        if (Object.keys(extra).length) node.extra = extra;
    };

    // VLANs by name, for references that give a name.
    const vlanByName = new Map();
    list('vlans').forEach((r) => { const v = asVlan(Number(r.vid)); if (v && r.name) vlanByName.set(lc(r.name), v); });

    // ---- Sites, locations, racks ----
    const multiSite = siteNames.size > 1;
    const siteGroup = new Map();
    if (multiSite) {
        const rowOf = new Map(list('sites').map((r) => [lc(r.name), r]));
        [...siteNames].forEach((s) => {
            const g = { id: nbId('s', rowOf.get(lc(s))), name: s, kind: 'building' };
            doc.groups.push(g); siteGroup.set(lc(s), g);
        });
    }
    const groupByTopo = new Map(), locById = new Map(), locByName = new Map(), rackById = new Map(), rackByName = new Map();
    const locRows = list('locations');
    const hasChildren = new Set(locRows.map((r) => lc(r.parent)).filter(Boolean));
    locRows.forEach((r) => {
        const more = moreOf(r.cf);
        let g;
        if (more && more.t && r.cf.topo_id) g = Object.assign({}, more.t, { id: String(r.cf.topo_id) });
        else {
            if (!r.name) { warnings.push(C.issue('row-no-name', r._w)); return; }
            const kind = C.groupKindFromWords(r.name) || (hasChildren.has(lc(r.name)) ? (r.parent ? 'floor' : 'building') : 'room');
            g = { id: nbId('l', r), name: r.name, kind: kind === 'rack' ? 'room' : kind, _parent: r.parent || '', _parentId: r.parent_id, _site: r.site };
        }
        doc.groups.push(g);
        if (r.id !== undefined) locById.set(String(r.id), g);
        if (r.name) locByName.set(lc(r.name), g);
        groupByTopo.set(g.id, g);
    });
    list('racks').forEach((r) => {
        const more = moreOf(r.cf);
        let g;
        if (more && more.t && r.cf.topo_id) g = Object.assign({}, more.t, { id: String(r.cf.topo_id) });
        else {
            if (!r.name) { warnings.push(C.issue('row-no-name', r._w)); return; }
            g = { id: nbId('r', r), name: r.name, kind: 'rack', _parent: r.location || '', _parentId: r.location_id, _site: r.site };
            const uh = asUnits(r.u_height);
            if (uh) g.uHeight = uh;
            const w = String(r.width == null ? '' : r.width).replace(/[^0-9]/g, '');
            if (w === '21') { g.width = '19in'; warnings.push(C.issue('rack-width', r._w, { width: '21' })); } else if (w) g.width = `${w}in`;
            const d = Number(r.outer_depth);
            if (Number.isFinite(d) && d > 0) g.depthMm = Math.round(/^(in|inch|inches)$/i.test(String(choice(r.outer_unit) || '').trim()) ? d * 25.4 : d);
            if (truthy(r.desc_units)) g.numbering = 'top';
        }
        doc.groups.push(g);
        if (r.id !== undefined) rackById.set(String(r.id), g);
        if (r.name) rackByName.set(lc(r.name), g);
    });
    doc.groups.forEach((g) => {
        if (!('_parent' in g)) return;
        const p = (g._parentId !== undefined && locById.get(String(g._parentId))) || (g._parent && locByName.get(lc(g._parent)));
        if (p && p !== g) g.parent = p.id;
        else if (multiSite && g._site && siteGroup.get(lc(g._site))) g.parent = siteGroup.get(lc(g._site)).id;
        delete g._parent; delete g._parentId; delete g._site;
    });

    // ---- Devices and virtual machines ----
    const typeHeights = new Map();
    list('devicetypes').forEach((r) => { const h = asUnits(r.u_height); if (h && r.device_type) typeHeights.set(lc(r.device_type), h); });
    const nodeByNbId = new Map(), nodeByName = new Map(), nodeRow = new Map();
    const statusCol = () => columnFor('#nbstatus', 'NetBox status', 'text');
    const makeNode = (r, vm) => {
        const more = moreOf(r.cf);
        let n;
        if (more && more.t && r.cf.topo_id) {
            n = Object.assign({}, more.t, { id: String(r.cf.topo_id), interfaces: [] });
            const nat = (NBX().nbDeviceNative || (() => ({})))(more.t);
            // NetBox edits to its own columns are taken; the export's stand-ins are not.
            if (r.name && r.name !== (more.nb || more.t.name)) n.name = r.name;
            if (!vm) {
                if ((r.serial || '') !== (nat.serial || '')) n.serial = r.serial || undefined;
                // An asset tag the export left off (another device's in NetBox) is not an edit.
                if ((r.asset_tag || '') !== (nat.asset_tag || '') && !(more.noTag && !r.asset_tag)) n.assetTag = r.asset_tag || undefined;
                // Makes and models are compared without case: the export writes one spelling of each.
                if (r.manufacturer && lc(r.manufacturer) !== lc(nat.manufacturer)) n.vendor = r.manufacturer;
                if (r.device_type && lc(r.device_type) !== lc(nat.device_type)) n.model = r.device_type;
            }
            if ((r.comments || '') !== (more.t.notes || '')) n.notes = r.comments || '';
            if (lc(r.platform) !== lc(more.t.os)) n.os = r.platform || '';
            n._more = more;
        } else {
            if (!r.name) { warnings.push(C.issue('row-no-name', r._w)); return null; }
            const type = vm ? (/container|docker|lxc|pod/i.test(r.role || '') ? 'container' : 'vm') : (C.typeFromWords(r.role) || C.typeFromWords(r.device_type) || 'custom');
            n = { id: nbId(vm ? 'vm' : 'd', r), type, name: r.name, interfaces: [] };
            if (!vm && r.manufacturer) n.vendor = r.manufacturer;
            if (!vm && r.device_type) n.model = r.device_type;
            if (r.platform) n.os = r.platform;
            if (r.serial) n.serial = r.serial;
            if (r.asset_tag) n.assetTag = r.asset_tag;
            const st = lc(choice(r.status));
            if (STATUS_IN[st]) n.status = STATUS_IN[st];
            n.notes = [r.comments, r.description].filter(Boolean).join('\n');
            const rack = (r.rack_id !== undefined && rackById.get(String(r.rack_id))) || (r.rack && rackByName.get(lc(r.rack)));
            const loc = (r.location_id !== undefined && locById.get(String(r.location_id))) || (r.location && locByName.get(lc(r.location)));
            const grp = rack || loc || (multiSite && r.site && siteGroup.get(lc(r.site)));
            if (grp) n.group = grp.id;
            if (rack) {
                const h = asUnits(r.u_height) || typeHeights.get(lc(r.device_type)) || 1;
                if (h > 1) n.rackHeight = h;
                const pos = Number(r.position);
                if (Number.isFinite(pos) && pos >= 1) {
                    const H = rack.uHeight || RACK_U_DEFAULT;
                    n.rackU = rack.numbering === 'top' ? Math.round(H - pos - h + 2) : Math.floor(pos);
                }
                const face = lc(choice(r.face));
                if (face === 'front' || face === 'rear') n.rackFace = face;
            }
            applyExtra(n, r);
            if (['staged', 'inventory', 'offline', 'failed'].includes(st)) { const col = statusCol(); if (col) n.extra = Object.assign({}, n.extra, { [col.id]: st }); }
        }
        if (r.id !== undefined) nodeByNbId.set((vm ? 'v' : 'd') + r.id, n);
        // Names repeat across sites in NetBox: every device of a name is kept.
        if (r.name) nodeByName.set(lc(r.name), (nodeByName.get(lc(r.name)) || []).concat([n]));
        nodeRow.set(n, r);
        doc.nodes.push(n);
        return n;
    };
    list('devices').forEach((r) => makeNode(r, false));
    list('vms').forEach((r) => makeNode(r, true));
    // A virtual machine runs on the device its cluster names, when only one does.
    const byCluster = new Map();
    doc.nodes.forEach((n) => { const r = nodeRow.get(n); if (r && r.cluster && !isVirtualType(n.type)) { const k = lc(r.cluster); byCluster.set(k, (byCluster.get(k) || []).concat([n])); } });
    doc.nodes.forEach((n) => {
        const r = nodeRow.get(n);
        if (!isVirtualType(n.type) || n._more || !r || !r.cluster) return;
        const hosts = (byCluster.get(lc(r.cluster)) || []).filter(Boolean);
        if (hosts.length === 1) n.host = hosts[0].id;
        else notes.push(C.issue('vm-no-host', null, { name: n.name, cluster: r.cluster }));
    });
    // A row's device: by its NetBox id when the row has one, else by name; a
    // name several devices share (one per site) is told apart by the row's
    // site, and when it cannot be, the row is listed and left out rather
    // than hung on the wrong device.
    const ambiguous = new Set();   // rows already listed as ambiguous
    const findNode = (name, id, vm, row, site) => {
        const byId = id !== undefined && id !== '' && nodeByNbId.get((vm ? 'v' : 'd') + id);
        if (byId) return byId;
        if (!name) return null;
        const all = nodeByName.get(lc(name)) || [];
        const list = all.filter((n) => isVirtualType(n.type) === !!vm).length ? all.filter((n) => isVirtualType(n.type) === !!vm) : all;
        if (list.length <= 1) return list[0] || null;
        const where = lc(site !== undefined ? site : row && row.site);
        const here = where ? list.filter((n) => lc((nodeRow.get(n) || {}).site) === where) : [];
        if (here.length === 1) return here[0];
        if (row && !ambiguous.has(row)) { ambiguous.add(row); warnings.push(C.issue('device-ambiguous', row._w, { name })); }
        return null;
    };

    // ---- Interfaces ----
    // Per node: [{ row, iface | null (an implicit port), portId, gen }], and
    // lookups by NetBox id and by name for cables and addresses.
    const ifaceByNbId = new Map(), ifaceByName = new Map();
    const ifKey = (node, name) => node.id + '\u0000' + lc(name);
    const ifRowsOf = new Map();
    const ifaceRows = list('interfaces').map((r) => ({ r, vm: false })).concat(list('vmifaces').map((r) => ({ r, vm: true })));
    let disabled = 0;
    ifaceRows.forEach(({ r, vm }) => {
        const node = findNode(vm ? r.virtual_machine : r.device, r.device_id !== undefined ? r.device_id : r.virtual_machine_id, vm, r);
        if (!node) { if (!ambiguous.has(r)) warnings.push(C.issue('iface-no-device', r._w, { name: r.name || '' })); return; }
        const a = ifRowsOf.get(node) || [];
        a.push({ r, vm });
        ifRowsOf.set(node, a);
    });
    const macByIface = new Map();
    list('macs').forEach((r) => {
        const mac = C.macText(r.mac_address);
        if (!mac) return;
        if (r.iface_id !== undefined) macByIface.set((r.iface_vm ? 'v' : 'i') + r.iface_id, mac);
        const node = findNode(r.device || r.virtual_machine, undefined, !r.device && !!r.virtual_machine, r);
        if (node && r.interface) macByIface.set(ifKey(node, r.interface), mac);
    });
    doc.nodes.forEach((node) => {
        const rows = ifRowsOf.get(node) || [];
        const ref = (row, entry) => {
            if (row.r.id !== undefined) ifaceByNbId.set((row.vm ? 'v' : 'i') + row.r.id, Object.assign({ node }, entry));
            if (row.r.name) ifaceByName.set(ifKey(node, row.r.name), Object.assign({ node }, entry));
        };
        const macOf = (row) => C.macText(row.r.mac_address) || macByIface.get((row.vm ? 'v' : 'i') + row.r.id) || macByIface.get(ifKey(node, row.r.name));
        if (node._more) {
            const t = node._more.t;
            rows.forEach((row) => {
                const r = row.r, more = moreOf(r.cf);
                if (r.cf.topo_generated) { ref(row, { gen: String(r.cf.topo_generated) }); return; }
                if (r.cf.topo_id && more && more.t) {
                    const i = Object.assign({}, more.t, { id: String(r.cf.topo_id) });
                    if (r.name && r.name !== (more.nb || more.t.name || '')) i.name = r.name;
                    const mac = macOf(row);
                    if (mac && normMac(mac) !== normMac(more.t.mac)) i.mac = mac;
                    node.interfaces.push(i);
                    ref(row, { id: i.id });
                    return;
                }
                const port = Number(r.cf.topo_port);
                if (Number.isInteger(port) && port > 0) { ref(row, { id: `p${port}` }); return; }
                // An interface added in NetBox to a device that came from Topo.
                const i = { id: nbId('i', r), name: r.name || '' };
                const mac = macOf(row);
                if (mac) i.mac = mac;
                node.interfaces.push(i);
                ref(row, { id: i.id });
            });
            // The order Topo had them in.
            const order = Array.isArray(node._more.order) ? node._more.order : [];
            node.interfaces.sort((x, y) => { const a = order.indexOf(x.id), b = order.indexOf(y.id); return (a < 0 ? 1e6 : a) - (b < 0 ? 1e6 : b); });
            if (Array.isArray(node._more.links)) node._more.links.forEach((l) => doc.links.push(Object.assign({}, l)));
            delete node._more;
            void t;
            return;
        }
        // From NetBox itself. A switch's or an AP's numbered ports are its port grid.
        let grid = null;
        if (hasPortGrid(node)) {
            const groups = new Map();
            rows.forEach((row) => {
                const r = row.r;
                if (isWirelessType(r.type) || isLagType(r.type) || isVirtualIfType(r.type) || truthy(r.mgmt_only)) return;
                const m = /^(.*?)(\d+)$/.exec(r.name || '');
                if (!m || /\d$/.test(m[1]) || /^0\d/.test(m[2])) return;
                const g = groups.get(m[1]) || [];
                g.push({ row, n: Number(m[2]) });
                groups.set(m[1], g);
            });
            let best = null;
            groups.forEach((g, prefix) => { if (g.length >= 2 && new Set(g.map((x) => x.n)).size === g.length && (!best || g.length > best.g.length)) best = { prefix, g }; });
            if (best) {
                const start = Math.min(...best.g.map((x) => x.n));
                grid = { prefix: best.prefix, start, rows: new Map(best.g.map((x) => [x.row, x.n - start + 1])) };
                node.portScheme = { prefix: best.prefix, start };
                node.portCount = Math.max(...grid.rows.values());
            }
        }
        const lagMembers = new Map();
        rows.forEach((row) => { if (row.r.lag) { const k = lc(row.r.lag); lagMembers.set(k, (lagMembers.get(k) || []).concat([row])); } });
        const idOfRow = new Map();
        rows.forEach((row) => {
            const r = row.r;
            if (r.enabled !== undefined && !truthy(r.enabled) && String(r.enabled).trim() !== '') disabled++;
            const mode = lc(choice(r.mode));
            const untagged = vidOf(r.untagged_vlan, vlanByName);
            const tagged = mode.includes('all') ? 'all' : r.tagged_vlans ? asVlanList(String(r.tagged_vlans).split(/[,;\s]+/).map((x) => vidOf(x, vlanByName)).filter(Boolean)) : undefined;
            const mac = macOf(row);
            const n = grid && grid.rows.get(row);
            if (n) {
                const pid = `p${n}`;
                const attr = {};
                if (r.label) attr.label = r.label;
                if (untagged) attr.vlan = untagged;
                if (tagged) attr.tagged = tagged;
                if (lc(choice(r.poe_mode)) === 'pse') attr.poe = POE_IN[lc(choice(r.poe_type))] || 'at';
                if (Object.keys(attr).length) node.portAttrs = Object.assign({}, node.portAttrs, { [pid]: attr });
                if (mac) node.interfaces.push({ id: pid, name: r.name, mac });
                ref(row, { id: pid }); idOfRow.set(row, pid);
                return;
            }
            const i = { id: nbId(row.vm ? 'vi' : 'i', r), name: r.name || '' };
            if (mac) i.mac = mac;
            if (isWirelessType(r.type)) i.wireless = true;
            else {
                if (untagged) i.vlan = untagged;
                if (tagged) i.tagged = tagged;
            }
            node.interfaces.push(i);
            ref(row, { id: i.id }); idOfRow.set(row, i.id);
        });
        rows.forEach((row) => {
            if (!isLagType(row.r.type)) return;
            const members = (lagMembers.get(lc(row.r.name)) || []).map((m) => idOfRow.get(m)).filter(Boolean);
            const i = node.interfaces.find((x) => x.id === idOfRow.get(row));
            if (i && members.length) i.bond = { mode: '802.3ad', members };
        });
    });
    if (disabled) notes.push(C.issue('iface-disabled', null, { n: disabled }));

    // ---- Addresses ----
    const ipRows = list('ips').slice().sort((a, b) => (truthy(b.is_primary) ? 1 : 0) - (truthy(a.is_primary) ? 1 : 0));
    const primary = new Set(doc.nodes.map((n) => nodeRow.get(n)).filter((r) => r && r.primary_ip).map((r) => lc(r.primary_ip)));
    ipRows.sort((a, b) => (primary.has(lc(b.address)) ? 1 : 0) - (primary.has(lc(a.address)) ? 1 : 0));
    ipRows.forEach((r) => {
        const addr = C.cidrText(r.address);
        if (!addr) { warnings.push(C.issue('ip-bad', r._w, { address: r.address || '' })); return; }
        let hit = r.iface_id !== undefined ? ifaceByNbId.get((r.iface_vm ? 'v' : 'i') + r.iface_id) : null;
        if (!hit && r.interface) {
            const node = findNode(r.device || r.virtual_machine, undefined, !r.device && !!r.virtual_machine, r);
            hit = node ? ifaceByName.get(ifKey(node, r.interface)) : null;
        }
        if (ambiguous.has(r)) return;
        if (!hit || hit.gen) { warnings.push(C.issue('ip-unassigned', r._w, { address: addr })); return; }
        let i = hit.node.interfaces.find((x) => x.id === hit.id);
        if (!i && /^p\d+$/.test(hit.id)) { i = { id: hit.id, name: '' }; hit.node.interfaces.push(i); }
        if (!i) return;
        if (i.ip) { if (parseValidCIDR(i.ip) && String(parseValidCIDR(i.ip).ip) !== String(parseValidCIDR(addr).ip)) warnings.push(C.issue('ip-extra', r._w, { address: addr })); return; }
        i.ip = addr;
    });

    // ---- Subnets and VLANs ----
    const netByVid = new Map();
    list('prefixes').forEach((r) => {
        const more = moreOf(r.cf);
        let net;
        if (more && more.t && r.cf.topo_id) net = Object.assign({}, more.t, { id: String(r.cf.topo_id), _topo: true });
        else {
            const cidr = canonicalCidr(String(r.prefix || '').trim());
            if (!cidr) { warnings.push(C.issue('prefix-bad', r._w, { prefix: r.prefix || '' })); return; }
            net = { id: nbId('p', r), cidr };
            if (r.description) net.name = r.description;
            const vid = vidOf(r.vlan, vlanByName);
            if (vid) net.vlan = vid;
            if (r.role) net.purpose = r.role;
            if (r.cf.topo_gw) net.gateway = r.cf.topo_gw;
        }
        if (doc.networks.some((x) => x.cidr === net.cidr)) return;
        doc.networks.push(net);
        if (net.vlan) netByVid.set(net.vlan, net);
    });
    list('vlans').forEach((r) => {
        const vid = asVlan(Number(r.vid));
        if (!vid) return;
        const net = netByVid.get(vid);
        if (net) { if (!net.name && r.name && !net._topo) net.name = r.name; }
        else notes.push(C.issue('vlan-no-subnet', null, { vid, name: r.name || '' }));
    });

    doc.networks.forEach((n) => { delete n._topo; });

    // ---- Wi-Fi ----
    const wifiBySsid = new Map();
    list('wlans').forEach((r) => {
        const more = moreOf(r.cf);
        let w;
        if (more && more.t && r.cf.topo_id) w = Object.assign({}, more.t, { id: String(r.cf.topo_id) });
        else {
            if (!r.ssid) return;
            w = { id: nbId('w', r), ssid: r.ssid };
            const sec = AUTH_IN[lc(choice(r.auth_type))];
            if (sec) w.security = sec;
            const net = netByVid.get(vidOf(r.vlan, vlanByName));
            if (net) w.network = net.id;
        }
        doc.wifi.push(w);
        if (w.ssid) wifiBySsid.set(lc(w.ssid), w);
    });

    // ---- Cables and wireless links ----
    const endOf = (r, side) => {
        const kind = lc(r[`side_${side}_type`]);
        const id = r[`side_${side}_iface_id`];
        if (id !== undefined && /interface/.test(kind)) { const hit = ifaceByNbId.get('i' + id); if (hit) return hit; }
        const node = findNode(r[`side_${side}_device`], r[`side_${side}_device_id`], false, r, r[`side_${side}_site`]);
        if (!node) return null;
        const name = r[`side_${side}_name`];
        if (kind && !/interface|frontport|rearport|front-port|rear-port/.test(kind.replace(/\./g, ''))) return { node, skip: kind };
        if (!name) return { node, id: null };
        const hit = ifaceByName.get(ifKey(node, name));
        if (hit) return hit;
        // A front or rear port (a patch panel's) or one not listed: made an interface.
        const i = { id: tid('i'), name };
        node.interfaces.push(i);
        ifaceByName.set(ifKey(node, name), { node, id: i.id });
        return { node, id: i.id };
    };
    const linkFrom = (r, a, b, wireless) => {
        const more = moreOf(r.cf);
        const ifOf = (e) => (e.gen ? (e.gen === 'unbound' ? null : e.gen) : e.id || null);
        if (more && more.t && r.cf.topo_id) {
            const l = Object.assign({}, more.t, { id: String(r.cf.topo_id), source: a.node.id, target: b.node.id, sourceIface: ifOf(a), targetIface: ifOf(b) });
            const label = (more.t.cable && more.t.cable.label) || '';
            if (!wireless && (r.label || '') !== label) l.cable = Object.assign({}, l.cable, { label: r.label || undefined });
            return l;
        }
        const l = { id: nbId(wireless ? 'wl' : 'c', r), source: a.node.id, target: b.node.id, sourceIface: ifOf(a), targetIface: ifOf(b) };
        if (wireless) {
            l.medium = 'wireless';
            const w = r.ssid && wifiBySsid.get(lc(r.ssid));
            if (w) l.wifi = { ssid: w.id };
            return l;
        }
        const med = CABLE_IN(String(choice(r.type) || ''));
        if (med) l.medium = med;
        const cab = {};
        if (r.label) cab.label = r.label;
        if (r.color) cab.color = C.colorName(r.color);
        const len = Number(r.length);
        if (Number.isFinite(len) && len > 0) { const u = lc(choice(r.length_unit)) || 'm'; cab.length = `${len} ${u === 'meters' ? 'm' : u === 'feet' ? 'ft' : u}`; }
        if (Object.keys(cab).length) l.cable = cab;
        return l;
    };
    list('cables').forEach((r) => {
        const a = endOf(r, 'a'), b = endOf(r, 'b');
        if (!a || !b) { if (!ambiguous.has(r)) warnings.push(C.issue('cable-end', r._w)); return; }
        if (a.skip || b.skip) { warnings.push(C.issue('cable-not-iface', r._w, { kind: a.skip || b.skip })); return; }
        doc.links.push(linkFrom(r, a, b, false));
    });
    list('wlinks').forEach((r) => {
        const end = (s) => {
            const id = r[`iface_${s}_id`];
            if (id !== undefined && ifaceByNbId.get('i' + id)) return ifaceByNbId.get('i' + id);
            const node = findNode(r[`device_${s}`], undefined, false, r);
            return node ? ifaceByName.get(ifKey(node, r[`interface_${s}`])) || null : null;
        };
        const a = end('a'), b = end('b');
        if (!a || !b) { if (!ambiguous.has(r)) warnings.push(C.issue('cable-end', r._w)); return; }
        doc.links.push(linkFrom(r, a, b, true));
    });

    // ---- Providers ----
    list('providers').forEach((r) => {
        const more = moreOf(r.cf);
        let p;
        if (more && more.t && r.cf.topo_id) {
            p = Object.assign({}, more.t, { id: String(r.cf.topo_id) });
            if (r.name && r.name !== (more.nb || more.t.name)) p.name = r.name;
        } else {
            if (!r.name) return;
            p = { id: nbId('cp', r), name: r.name };
            const notesText = [r.description, r.comments].filter(Boolean).join('\n');
            if (notesText) p.notes = notesText;
            if (r.accounts) p.account = String(r.accounts).slice(0, 200);
        }
        doc.providers.push(p);
    });

    if (secrets) notes.push(C.issue('secrets', null, { n: secrets }));
    if (colsDropped) notes.push(C.issue('columns-max', null, { n: colsDropped }));
    got.notRead.forEach((n, type) => notes.push(C.issue('not-read', null, { type, n })));
    if (got.unread.length) notes.push(C.issue('columns-not-read', null, { list: got.unread.slice(0, 12).join(', ') }));
    const out = C.finish(doc);
    return { doc: out, warnings, notes, name: siteNames.size === 1 ? [...siteNames][0] : '', counts: { vlans: list('vlans').length || C.countDoc(out).vlans } };
}

const importer = { id: 'netbox', label: 'NetBox', family: 'netbox', multi: true, detect, parse };
if (window.TopoImporters) TopoImporters.register(importer);
window.TopoNetbox = Object.assign(window.TopoNetbox || {}, { importer, collect, typeOfHeaders, headerToKey });
})();
