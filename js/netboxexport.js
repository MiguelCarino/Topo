// ---- Topo to NetBox (docs/SCOPE.md step 6, D117) ----
// One click writes the network as NetBox's own bulk-import CSV files, one per
// object type, numbered in the order NetBox must import them, with a
// README.txt, in one zip: topo_<org>_<site>_<date>_netbox.zip.
//
// What NetBox holds goes in its own columns (names, roles, makes and models,
// platforms, serials, asset tags, statuses, racks and positions, interfaces
// with MACs and VLANs, addresses, prefixes, VLANs, cables with label, colour
// and length, Wi-Fi networks, providers, virtual machines). What it does not
// rides in custom fields named topo_*: a few readable ones (position on the
// map, gateway, DNS, service dates...) and topo_more, the record exactly as
// Topo holds it (JSON), so Topo -> NetBox -> Topo loses nothing. Edits made
// in NetBox to names, serials, asset tags, comments, platforms, makes,
// models, MACs and cable labels are read back (js/importers/netbox.js); the
// rest comes from topo_more.
//
// NetBox refuses what Topo allows (amendments 37-41), so the export:
//   - makes names unique where NetBox needs them so (devices and virtual
//     machines per site, interfaces per device, locations, racks, providers),
//     keeping the original in topo_more;
//   - gives a second cable on one interface, and a cable end bound to no
//     interface, a generated interface ("to <peer>", topo_generated);
//   - keeps links NetBox cannot hold as cables (VPN links, links to virtual
//     machines and containers, a wired link on a wireless interface) in the
//     device's topo_more, and lists them in the README;
//   - writes positions from the rack's numbering and the device's height.
// The header lists target NetBox 4.1 (MACs on the interface) and 4.2-4.4
// (MACs in their own file, prefixes without a site); they are written from
// NetBox's import forms as documented, not checked against a live NetBox.

(function () {
'use strict';
const C = window.TopoImportCommon;

const NB_VERSIONS = ['4.2', '4.1'];
const ALL_TYPES = ['dcim.device', 'virtualization.virtualmachine', 'dcim.interface', 'virtualization.vminterface', 'dcim.cable', 'dcim.location',
    'dcim.rack', 'ipam.prefix', 'wireless.wirelesslan', 'wireless.wirelesslink', 'circuits.provider'];
const NODE_TYPES = ['dcim.device', 'virtualization.virtualmachine'];
// The custom fields: [name, label, type, object types].
const TOPO_FIELDS = [
    ['topo_id', 'Topo ID', 'text', ALL_TYPES],
    ['topo_more', 'Topo record', 'json', ALL_TYPES],
    ['topo_x', 'Topo map X', 'decimal', NODE_TYPES],
    ['topo_y', 'Topo map Y', 'decimal', NODE_TYPES],
    ['topo_gw', 'Gateway', 'text', NODE_TYPES.concat(['ipam.prefix'])],
    ['topo_dns', 'DNS', 'text', NODE_TYPES.concat(['ipam.prefix'])],
    ['topo_nat', 'NAT', 'boolean', NODE_TYPES],
    ['topo_allowed_ports', 'Allowed ports', 'text', NODE_TYPES],
    ['topo_location', 'Location (text)', 'text', NODE_TYPES],
    ['topo_in_service', 'In service since', 'text', NODE_TYPES],
    ['topo_serviced', 'Last serviced', 'text', NODE_TYPES],
    ['topo_service_every', 'Service every (months)', 'integer', NODE_TYPES],
    ['topo_life', 'Expected life (years)', 'integer', NODE_TYPES],
    ['topo_poe_budget', 'PoE budget (W)', 'decimal', NODE_TYPES],
    ['topo_poe_draw', 'PoE draw (W)', 'decimal', NODE_TYPES],
    ['topo_providers', 'Providers', 'text', NODE_TYPES.concat(['dcim.cable', 'dcim.location', 'dcim.rack'])],
    ['topo_port', 'Topo port', 'integer', ['dcim.interface']],
    ['topo_generated', 'Made by the Topo export for', 'text', ['dcim.interface']],
    ['topo_medium', 'Medium', 'text', ['dcim.cable']],
    ['topo_dhcp', 'DHCP', 'boolean', ['ipam.prefix']],
    ['topo_dhcp_first', 'DHCP first', 'text', ['ipam.prefix']],
    ['topo_dhcp_last', 'DHCP last', 'text', ['ipam.prefix']],
    ['topo_kind', 'Topo group kind', 'text', ['dcim.location', 'dcim.rack']]
];
const CUSTOM_CF_TYPE = { text: 'text', number: 'decimal', date: 'date', yesno: 'boolean' };
const CF_CUSTOM_KIND = { text: 'text', longtext: 'text', url: 'text', select: 'text', multiselect: 'text', integer: 'number', decimal: 'number', date: 'date', datetime: 'text', boolean: 'yesno' };

// The interface types and statuses both ways.
const STATUS_TO_NB = { planned: 'planned', active: 'active', retired: 'decommissioning' };
const MEDIUM_TO_CABLE = { utp: 'cat6', fiber: 'mmf', powerline: 'power' };
const POE_TO_NB = { af: 'type1-ieee802.3af', at: 'type2-ieee802.3at', bt3: 'type3-ieee802.3bt', bt4: 'type4-ieee802.3bt' };
const RADIO_TO_NB = { n: 'ieee802.11n', ac: 'ieee802.11ac', ax: 'ieee802.11ax', axe: 'ieee802.11ax', be: 'ieee802.11be' };
const WIFI_AUTH = { open: 'open', owe: 'open', wep: 'wep', wpa: 'wpa-personal', wpa2: 'wpa-personal', wpa3: 'wpa-personal', 'wpa2/3': 'wpa-personal', 'wpa2-ent': 'wpa-enterprise', 'wpa3-ent': 'wpa-enterprise' };
const TAGGED_MAX = 256;   // VLANs written out one by one; past it, the list rides in topo_more

const without = (rec, keys) => { const o = Object.assign({}, rec); keys.forEach((k) => delete o[k]); return o; };
const slugify = (s, id) => {
    const base = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const tail = String(id || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 20);
    return [base || 'x', tail].filter(Boolean).join('-').slice(0, 100);
};
// Slugs made unique in a scope: "cisco", "cisco-2"...
function slugUniquer() {
    const seen = new Set();
    return (slug) => {
        let s = slug, k = 2;
        while (seen.has(s)) s = `${slug.slice(0, 96)}-${k++}`;
        seen.add(s);
        return s;
    };
}
// A CSV for NetBox: quoted as RFC 4180 wants, but never with the
// spreadsheet guard (an apostrophe before - + = @), which NetBox would keep
// as part of the value. These files are for NetBox's import, not a spreadsheet.
function nbCsvText(sheet) {
    const cell = (v) => { const t = v == null ? '' : String(v); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    return [sheet.headers, ...sheet.rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
// Names made unique in a scope, case-insensitively: "AP", "AP (2)"...
function uniquer() {
    const seen = new Set();
    return (name) => {
        let n = String(name || '').trim() || 'x', k = 2;
        const base = n;
        while (seen.has(n.toLowerCase())) n = `${base} (${k++})`;
        seen.add(n.toLowerCase());
        return n;
    };
}
const typeLabel = (type) => { const d = (typeof paletteDefs !== 'undefined' ? paletteDefs : []).find((x) => x.type === type); return d ? d.name : type; };
const json = (v) => JSON.stringify(v);
const num = (v) => (v === undefined || v === null || v === '' ? '' : String(v));
const bool = (v) => (typeof v === 'boolean' ? String(v) : '');

// What the export writes in NetBox's own columns for a device, from Topo's
// record: the importer compares with this to tell a NetBox edit from the
// export's own stand-ins (an unknown make is "Unknown").
function nbDeviceNative(n) {
    return {
        manufacturer: n.vendor || 'Unknown',
        device_type: n.model || `Generic ${typeLabel(n.type)}`,
        platform: n.os || '',
        serial: n.serial || '',
        asset_tag: n.assetTag || '',
        comments: n.notes || ''
    };
}
// A cable's length as NetBox columns, or null when the text is not "n unit".
function nbLength(text) {
    const m = /^(\d+(?:\.\d+)?)\s*(m|ft|cm|in|km|mi)$/.exec(String(text || '').trim());
    return m ? { length: m[1], unit: m[2] } : null;
}

// The doc -> { files: [{ name, text }], readme, notCarried: {...} }. Pure but
// for withDoc, which borrows `state` to read the port grid as the editor does.
function buildNetboxSet(doc, opts = {}) {
    const version = NB_VERSIONS.includes(opts.version) ? opts.version : '4.2';
    const v42 = version !== '4.1';
    const canon = canonicalDoc(doc);
    return withDoc(canon, () => buildFrom(canon, { version, v42, siteName: String(opts.siteName || '').trim() || 'Topo' }));
}

function buildFrom(doc, o) {
    const nodes = doc.nodes || [], links = doc.links || [], groups = doc.groups || [], networks = doc.networks || [];
    const wifi = doc.wifi || [], providers = doc.providers || [], columns = doc.columns || [];
    const site = o.siteName, siteSlug = slugify(site, 'topo');
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const isVm = (n) => !!n && isVirtualType(n.type);
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const notCarried = { links: [], annotations: (doc.annotations || []).length, incidents: (doc.incidents || []).length, searches: (doc.searches || []).length, log: (doc.log || []).length };

    // ---- Names ----
    const nodeName = new Map();
    { const u = uniquer(); nodes.forEach((n) => nodeName.set(n.id, u(n.name || `${typeLabel(n.type)} ${n.id}`))); }
    const groupName = new Map();
    { const u = uniquer(), ur = uniquer(); groups.forEach((g) => groupName.set(g.id, (g.kind === 'rack' ? ur : u)(g.name || `${g.kind || 'group'} ${g.id}`))); }
    const providerName = new Map();
    { const u = uniquer(); providers.forEach((p) => providerName.set(p.id, u(p.name || `Provider ${p.id}`))); }

    // ---- Interfaces, per node: the rows NetBox gets, in order ----
    // { name, iface (Topo's, or null for an implicit port), port (n), generated, wireless }
    const ifRows = new Map();
    const ifUniq = new Map();
    const ifaceRowOf = new Map();   // nodeId -> Map(ifaceId -> row)
    nodes.forEach((n) => {
        const live = getNode(n.id);
        const u = uniquer(); ifUniq.set(n.id, u);
        const rows = [], byId = new Map();
        const own = new Map((n.interfaces || []).map((i) => [i.id, i]));
        getInterfaces(live).forEach((li) => {
            const i = own.get(li.id) || null;
            const pm = /^p(\d+)$/.exec(li.id);
            const port = hasPortGrid(n) && pm && Number(pm[1]) <= portCountOf(live) ? Number(pm[1]) : 0;
            const name = u(li.name || li.id);
            const row = { name, iface: i, id: li.id, port, wireless: ifaceIsWireless(i || li) };
            rows.push(row); byId.set(li.id, row);
        });
        ifRows.set(n.id, rows); ifaceRowOf.set(n.id, byId);
    });

    // ---- Links: cables, wireless links, or kept on the device ----
    const cabled = new Set();
    const cables = [], wlinks = [], kept = new Map();
    const keep = (l, why) => {
        const k = kept.get(l.source) || [];
        k.push(l); kept.set(l.source, k);
        notCarried.links.push({ id: l.id, why, from: nodeName.get(l.source), to: nodeName.get(l.target) });
    };
    const generated = (nodeId, forId, peerId, wireless) => {
        const row = { name: ifUniq.get(nodeId)(`to ${nodeName.get(peerId) || peerId}`), iface: null, id: '', port: 0, generated: forId || 'unbound', wireless };
        ifRows.get(nodeId).push(row);
        return row;
    };
    links.forEach((l) => {
        const a = nodeById.get(l.source), b = nodeById.get(l.target);
        if (!a || !b) return;
        if (l.medium === 'vpn') return keep(l, 'vpn');
        if (isVm(a) || isVm(b)) return keep(l, 'virtual');
        const wireless = l.medium === 'wireless';
        const end = (node, ifaceId, peer) => {
            const row = ifaceId ? ifaceRowOf.get(node.id).get(ifaceId) : null;
            if (row && row.wireless !== wireless) return null;
            if (row && !cabled.has(row)) { cabled.add(row); return row; }
            return generated(node.id, ifaceId, peer.id, wireless);
        };
        const ra = end(a, l.sourceIface, b), rb = end(b, l.targetIface, a);
        if (!ra || !rb) return keep(l, 'wireless-mismatch');
        (wireless ? wlinks : cables).push({ link: l, ra, rb });
    });

    // ---- VLANs: every one in use ----
    const vids = new Set();
    const addVids = (text) => { const l = parseVlanList(text); if (l && !l.all && l.size <= TAGGED_MAX) l.forEach((x) => vids.add(x)); };
    networks.forEach((n) => { if (n.vlan) vids.add(n.vlan); });
    nodes.forEach((n) => {
        (n.interfaces || []).forEach((i) => { if (i.vlan) vids.add(i.vlan); addVids(i.tagged); });
        Object.values(n.portAttrs || {}).forEach((a) => { if (a.vlan) vids.add(a.vlan); addVids(a.tagged); });
    });
    const vlanName = (vid) => { const n = networks.find((x) => x.vlan === vid && x.name); return n ? n.name : `VLAN ${vid}`; };
    const vlanCols = (untagged, tagged) => {
        const l = tagged ? parseVlanList(tagged) : null;
        if (l && l.all) return { mode: 'tagged-all', untagged_vlan: num(untagged), tagged_vlans: '' };
        if (l && l.size <= TAGGED_MAX) return { mode: 'tagged', untagged_vlan: num(untagged), tagged_vlans: [...l].sort((x, y) => x - y).join(',') };
        if (l) return { mode: 'tagged', untagged_vlan: num(untagged), tagged_vlans: '' };
        return untagged ? { mode: 'access', untagged_vlan: String(untagged), tagged_vlans: '' } : { mode: '', untagged_vlan: '', tagged_vlans: '' };
    };

    // ---- Sheets ----
    const sheets = [];
    const sheet = (file, headers, rows) => { if (rows.length) sheets.push({ file, headers, rows }); };
    const usedCustom = columns.map((c) => [`topo_c_${c.id}`, c.name, CUSTOM_CF_TYPE[c.kind || 'text'] || 'text', NODE_TYPES]);
    sheet('custom-fields', ['name', 'label', 'type', o.v42 ? 'object_types' : 'object_types', 'description'],
        TOPO_FIELDS.concat(usedCustom).map(([name, label, type, types]) => [name, label, type, types.join(','), name.startsWith('topo_c_') ? 'A Topo custom column' : 'Written by Topo']));
    sheet('sites', ['name', 'slug', 'status'], [[site, siteSlug, 'active']]);

    // Locations, parents before children; racks after.
    const depth = (g) => { let d = 0, p = g; const seen = new Set(); while (p && p.parent && !seen.has(p.id)) { seen.add(p.id); p = groupById.get(p.parent); d++; } return d; };
    const locGroups = groups.filter((g) => g.kind !== 'rack').sort((a, b) => depth(a) - depth(b));
    const locParent = (g) => { const p = g.parent ? groupById.get(g.parent) : null; return p && p.kind !== 'rack' ? groupName.get(p.id) : ''; };
    const groupMore = (g) => json({ t: without(g, ['id']) });
    sheet('locations', ['name', 'slug', 'site', 'parent', 'status', 'cf_topo_id', 'cf_topo_kind', 'cf_topo_providers', 'cf_topo_more'],
        locGroups.map((g) => [groupName.get(g.id), slugify(groupName.get(g.id), g.id), site, locParent(g), 'active', g.id, g.kind || '', (g.providers || []).join(' '), groupMore(g)]));
    const racks = groups.filter((g) => g.kind === 'rack');
    const widthNb = (w) => String(parseInt(w || '19', 10) || 19);
    sheet('racks', ['name', 'site', 'location', 'status', 'width', 'u_height', 'desc_units', 'outer_depth', 'outer_unit', 'cf_topo_id', 'cf_topo_kind', 'cf_topo_providers', 'cf_topo_more'],
        racks.map((g) => [groupName.get(g.id), site, locParent(g), 'active', widthNb(g.width), num(g.uHeight || RACK_U_DEFAULT), g.numbering === 'top' ? 'true' : 'false',
            num(g.depthMm), g.depthMm ? 'mm' : '', g.id, 'rack', (g.providers || []).join(' '), groupMore(g)]));

    // Makes, roles, models, platforms.
    const devs = nodes.filter((n) => !isVm(n)), vms = nodes.filter(isVm);
    const makers = new Map(), roles = new Map(), types = new Map(), platforms = new Map();
    // One spelling per make, model and platform (the first met, compared
    // without case: NetBox's names are unique that way), used in every row
    // that names it; the importer compares without case too.
    const nativeOf = new Map(nodes.map((n) => [n.id, Object.assign({}, nbDeviceNative(n))]));
    devs.forEach((n) => {
        const nat = nativeOf.get(n.id);
        const mk = nat.manufacturer.toLowerCase();
        if (!makers.has(mk)) makers.set(mk, nat.manufacturer);
        nat.manufacturer = makers.get(mk);
        const tk = `${mk}\u0000${nat.device_type.toLowerCase()}`;
        if (!types.has(tk)) types.set(tk, { manufacturer: nat.manufacturer, model: nat.device_type, uh: n.rackHeight || 1, half: n.rackDepth === 'half' });
        nat.device_type = types.get(tk).model;
    });
    nodes.forEach((n) => {
        if (!roles.has(n.type)) roles.set(n.type, { name: typeLabel(n.type), vm: isVm(n) });
        if (n.os && !platforms.has(n.os.toLowerCase())) platforms.set(n.os.toLowerCase(), n.os);
    });
    const platformOf = (os) => (os ? platforms.get(os.toLowerCase()) || os : '');
    nodes.forEach((n) => { nativeOf.get(n.id).platform = platformOf(n.os); });
    { const u = uniquer(); roles.forEach((r) => { r.name = u(r.name); }); }
    // Asset tags are unique in NetBox: a repeated one is written only on its
    // first device (the others keep theirs in topo_more) and named in the README.
    const tagSeen = new Set(), tagDropped = new Set();
    devs.forEach((n) => {
        const nat = nativeOf.get(n.id), k = nat.asset_tag.toLowerCase();
        if (!k) return;
        if (tagSeen.has(k)) { tagDropped.add(n.id); notCarried.assetTags = (notCarried.assetTags || []).concat([{ tag: nat.asset_tag, device: nodeName.get(n.id) }]); nat.asset_tag = ''; }
        else tagSeen.add(k);
    });
    { const su = slugUniquer(); sheet('manufacturers', ['name', 'slug'], [...makers.values()].map((m) => [m, su(slugify(m))])); }
    sheet('device-roles', ['name', 'slug', 'color', 'vm_role'], [...roles.entries()].map(([type, r]) => [r.name, slugify(type), '9e9e9e', r.vm ? 'true' : 'false']));
    { const su = slugUniquer(); sheet('device-types', ['manufacturer', 'model', 'slug', 'u_height', 'is_full_depth'],
        [...types.values()].map((t) => [t.manufacturer, t.model, su(slugify(`${t.manufacturer} ${t.model}`)), String(t.uh), t.half ? 'false' : 'true'])); }
    { const su = slugUniquer(); sheet('platforms', ['name', 'slug'], [...platforms.values()].map((p) => [p, su(slugify(p))])); }

    // The device's own columns, devices and VMs alike.
    const colCells = (n) => columns.map((c) => { const v = (n.extra || {})[c.id]; return v === undefined ? '' : typeof v === 'boolean' ? String(v) : String(v); });
    const nodeCf = (n) => [n.id, num(n.x), num(n.y), n.gw || '', n.dns || '', bool(n.nat), n.ports || '', n.location || '', n.inService || '', n.serviced || '',
        num(n.serviceEvery), num(n.lifeYears), num(n.poeBudget), num(n.poeDraw), (n.providers || []).join(' ')];
    const nodeCfHeads = ['cf_topo_id', 'cf_topo_x', 'cf_topo_y', 'cf_topo_gw', 'cf_topo_dns', 'cf_topo_nat', 'cf_topo_allowed_ports', 'cf_topo_location', 'cf_topo_in_service',
        'cf_topo_serviced', 'cf_topo_service_every', 'cf_topo_life', 'cf_topo_poe_budget', 'cf_topo_poe_draw', 'cf_topo_providers'].concat(columns.map((c) => `cf_topo_c_${c.id}`), ['cf_topo_more']);
    const nodeMore = (n) => {
        const m = { t: without(n, ['id', 'interfaces']), order: (n.interfaces || []).map((i) => i.id) };
        if (nodeName.get(n.id) !== n.name) m.nb = nodeName.get(n.id);
        if (tagDropped.has(n.id)) m.noTag = true;   // its asset tag is another device's in NetBox
        if (kept.has(n.id)) m.links = kept.get(n.id);
        return json(m);
    };
    const clusterOf = new Map();   // host node id -> cluster name
    vms.forEach((v) => { const h = v.host && nodeById.get(v.host); if (h && !isVm(h)) clusterOf.set(h.id, nodeName.get(h.id)); });
    const rackPos = (n) => {
        const g = n.group && groupById.get(n.group);
        if (!g || g.kind !== 'rack' || !Number.isInteger(n.rackU)) return '';
        const H = g.uHeight || RACK_U_DEFAULT, h = n.rackHeight || 1, u = n.rackU;
        if (u < 1 || u + h - 1 > H) return '';
        return String(g.numbering === 'top' ? H - u - h + 2 : u);
    };
    const placeOf = (n) => {
        const g = n.group && groupById.get(n.group);
        if (!g) return { location: '', rack: '' };
        if (g.kind === 'rack') return { location: locParent(g), rack: groupName.get(g.id) };
        return { location: groupName.get(g.id), rack: '' };
    };
    sheet('devices', ['name', 'role', 'manufacturer', 'device_type', 'platform', 'site', 'location', 'rack', 'position', 'face', 'serial', 'asset_tag', 'status', 'cluster', 'comments'].concat(nodeCfHeads),
        devs.map((n) => {
            const nat = nativeOf.get(n.id), p = placeOf(n), pos = rackPos(n);
            return [nodeName.get(n.id), roles.get(n.type).name, nat.manufacturer, nat.device_type, nat.platform, site, p.location, p.rack, pos, pos ? (n.rackFace || 'front') : '',
                nat.serial, nat.asset_tag, STATUS_TO_NB[n.status] || 'active', clusterOf.get(n.id) || '', nat.comments].concat(nodeCf(n), colCells(n), [nodeMore(n)]);
        }));
    const clusters = [...new Set(clusterOf.values())];
    if (clusters.length) sheet('cluster-types', ['name', 'slug'], [['Topo host', 'topo-host']]);
    sheet('clusters', o.v42 ? ['name', 'type', 'status'] : ['name', 'type', 'site', 'status'], clusters.map((c) => (o.v42 ? [c, 'Topo host', 'active'] : [c, 'Topo host', site, 'active'])));
    sheet('virtual-machines', ['name', 'status', 'role', 'site', 'cluster', 'platform', 'serial', 'comments'].concat(nodeCfHeads),
        vms.map((n) => [nodeName.get(n.id), STATUS_TO_NB[n.status] === 'decommissioning' ? 'decommissioning' : STATUS_TO_NB[n.status] || 'active', roles.get(n.type).name, site,
            (n.host && clusterOf.get(n.host)) || '', platformOf(n.os), n.serial || '', n.notes || ''].concat(nodeCf(n), colCells(n), [nodeMore(n)])));

    // Interfaces (and VM interfaces), then the MACs of 4.2.
    const macRows = [];
    const ifaceMore = (r, n) => {
        if (r.generated) return '';
        const m = {};
        if (r.iface) { m.t = without(r.iface, ['id']); if (r.name !== (r.iface.name || '')) m.nb = r.name; }
        return Object.keys(m).length ? json(m) : '';
    };
    const ifaceType = (r, n) => {
        if (r.wireless) return RADIO_TO_NB[(r.iface && r.iface.radio && r.iface.radio.standard) || 'ax'] || 'ieee802.11ax';
        if (r.iface && r.iface.bond) return 'lag';
        return '1000base-t';
    };
    const lagOf = (n, ifaceId) => { const b = (n.interfaces || []).find((i) => i.bond && (i.bond.members || []).includes(ifaceId)); return b ? ifaceRowOf.get(n.id).get(b.id) : null; };
    const ifHeads = ['device', 'name', 'label', 'type', 'enabled', 'mgmt_only'].concat(o.v42 ? [] : ['mac_address'], ['mode', 'untagged_vlan', 'tagged_vlans', 'lag', 'poe_mode', 'poe_type',
        'cf_topo_id', 'cf_topo_port', 'cf_topo_generated', 'cf_topo_more']);
    const vifHeads = ['virtual_machine', 'name', 'enabled'].concat(o.v42 ? [] : ['mac_address'], ['mode', 'untagged_vlan', 'tagged_vlans', 'cf_topo_id', 'cf_topo_more']);
    const ifCells = (n, r) => {
        const attr = r.port ? (n.portAttrs || {})[`p${r.port}`] || {} : null;
        const mac = r.iface && hasMac(r.iface) ? C.macText(r.iface.mac) : '';
        if (mac) macRows.push([mac, isVm(n) ? '' : nodeName.get(n.id), isVm(n) ? nodeName.get(n.id) : '', r.name]);
        const vl = attr ? vlanCols(attr.vlan, attr.tagged) : r.iface && !r.wireless ? vlanCols(r.iface.vlan, r.iface.tagged) : vlanCols();
        const lag = !r.generated && lagOf(n, r.id);
        const poe = attr && attr.poe !== undefined ? attr.poe : undefined;
        return { mac, vl, lag: lag ? lag.name : '', label: attr && attr.label ? attr.label : '', poeMode: poe !== undefined ? 'pse' : '', poeType: typeof poe === 'string' ? POE_TO_NB[poe] || '' : '' };
    };
    const ifSheet = [], vifSheet = [];
    // A LAG before its members: NetBox reads the rows in order, and a member
    // names its LAG (topo_more keeps Topo's own order).
    const lagFirst = (rows) => rows.filter((r) => r.iface && r.iface.bond).concat(rows.filter((r) => !(r.iface && r.iface.bond)));
    nodes.forEach((n) => lagFirst(ifRows.get(n.id) || []).forEach((r) => {
        const c = ifCells(n, r);
        const id = r.iface ? r.id : '';
        if (isVm(n)) {
            vifSheet.push([nodeName.get(n.id), r.name, 'true'].concat(o.v42 ? [] : [c.mac], [c.vl.mode, c.vl.untagged_vlan, c.vl.tagged_vlans, id, ifaceMore(r, n)]));
        } else {
            ifSheet.push([nodeName.get(n.id), r.name, c.label, ifaceType(r, n), 'true', 'false'].concat(o.v42 ? [] : [c.mac], [c.vl.mode, c.vl.untagged_vlan, c.vl.tagged_vlans, c.lag,
                c.poeMode, c.poeType, id, r.port ? String(r.port) : '', r.generated || '', ifaceMore(r, n)]));
        }
    }));
    // VLANs first: both interface files name them.
    sheet('vlans', ['vid', 'name', 'site', 'status'], [...vids].sort((a, b) => a - b).map((v) => [String(v), vlanName(v), site, 'active']));
    sheet('vm-interfaces', vifHeads, vifSheet);
    sheet('interfaces', ifHeads, ifSheet);
    if (o.v42) sheet('mac-addresses', ['mac_address', 'device', 'virtual_machine', 'interface'], macRows);

    // Prefixes and addresses.
    sheet('prefixes', ['prefix', 'status', 'vlan', 'vlan_site'].concat(o.v42 ? [] : ['site'], ['description', 'cf_topo_id', 'cf_topo_gw', 'cf_topo_dns', 'cf_topo_dhcp', 'cf_topo_dhcp_first', 'cf_topo_dhcp_last', 'cf_topo_more']),
        networks.filter((n) => parseValidCIDR(n.cidr)).map((n) => [n.cidr, 'active', num(n.vlan), n.vlan ? site : ''].concat(o.v42 ? [] : [site], [n.name || '', n.id, n.gateway || '', n.dns || '',
            bool(n.dhcp), n.dhcpFirst || '', n.dhcpLast || '', json({ t: without(n, ['id']) })])));
    const notPrefix = networks.filter((n) => !parseValidCIDR(n.cidr));
    const ipRows = [];
    nodes.forEach((n) => (ifRows.get(n.id) || []).forEach((r) => {
        if (!r.iface || !parseValidCIDR(r.iface.ip)) return;
        ipRows.push([r.iface.ip, 'active', isVm(n) ? '' : nodeName.get(n.id), isVm(n) ? nodeName.get(n.id) : '', r.name, 'false']);
    }));
    sheet('ip-addresses', ['address', 'status', 'device', 'virtual_machine', 'interface', 'is_primary'], ipRows);

    // Cables and wireless.
    const linkMore = (l) => json({ t: without(l, ['id', 'source', 'target', 'sourceIface', 'targetIface']) });
    sheet('cables', ['side_a_device', 'side_a_type', 'side_a_name', 'side_b_device', 'side_b_type', 'side_b_name', 'type', 'status', 'label', 'color', 'length', 'length_unit',
        'cf_topo_id', 'cf_topo_medium', 'cf_topo_providers', 'cf_topo_more'],
        cables.map(({ link: l, ra, rb }) => {
            const cab = l.cable || {}, len = nbLength(cab.length);
            return [nodeName.get(l.source), 'dcim.interface', ra.name, nodeName.get(l.target), 'dcim.interface', rb.name, MEDIUM_TO_CABLE[l.medium] || '', 'connected',
                cab.label || '', C.colorHex(cab.color), len ? len.length : '', len ? len.unit : '', l.id, l.medium || '', (l.providers || []).join(' '), linkMore(l)];
        }));
    const wifiSsid = new Map(wifi.map((w) => [w.id, w.ssid || '']));
    sheet('wireless-lans', ['ssid', 'status', 'vlan', 'auth_type', 'description', 'cf_topo_id', 'cf_topo_more'],
        wifi.map((w) => {
            const net = w.network && networks.find((x) => x.id === w.network);
            return [w.ssid || `Wi-Fi ${w.id}`, 'active', net && net.vlan ? String(net.vlan) : '', WIFI_AUTH[w.security] || '', '', w.id, json({ t: without(w, ['id']) })];
        }));
    sheet('wireless-links', ['device_a', 'interface_a', 'device_b', 'interface_b', 'ssid', 'status', 'cf_topo_id', 'cf_topo_more'],
        wlinks.map(({ link: l, ra, rb }) => [nodeName.get(l.source), ra.name, nodeName.get(l.target), rb.name, (l.wifi && wifiSsid.get(l.wifi.ssid)) || '', 'connected', l.id, linkMore(l)]));
    sheet('providers', ['name', 'slug', 'description', 'comments', 'cf_topo_id', 'cf_topo_more'],
        providers.map((p) => [providerName.get(p.id), slugify(providerName.get(p.id), p.id), [p.contact, p.phone, p.email].filter(Boolean).join(' · ').slice(0, 200), p.notes || '', p.id,
            json({ t: without(p, ['id']), nb: providerName.get(p.id) !== p.name ? providerName.get(p.id) : undefined })]));

    // Numbered in the order they must be imported.
    const files = sheets.map((s, i) => ({ name: `${String(i + 1).padStart(2, '0')}-${s.file}.csv`, text: nbCsvText({ headers: s.headers, rows: s.rows }) }));
    notCarried.networks = notPrefix.map((n) => n.cidr);
    const readme = netboxReadme(files.map((f) => f.name), o, notCarried);
    return { files: [{ name: 'README.txt', text: readme }].concat(files), notCarried, version: o.version };
}

function netboxReadme(names, o, nc) {
    const lines = [
        'Topo to NetBox',
        '==============',
        '',
        `Written by Topo for NetBox ${o.v42 ? '4.2 to 4.4' : '4.1'}. The column lists follow NetBox's bulk-import forms as`,
        'documented; they were not checked against a live NetBox, so check the first file before the rest.',
        '',
        'Import the files in this order, each in NetBox under its own object type, Import, CSV:',
        ''
    ].concat(names.map((n) => `  ${n}`), [
        '',
        '01-custom-fields.csv makes the topo_* custom fields first: every later file uses them.',
        o.v42 ? 'NetBox 4.2 and later keep MAC addresses in their own list (mac-addresses). For NetBox 4.1, export again'
            : 'NetBox 4.1 keeps MAC addresses on the interface. For NetBox 4.2 and later, export again and pick 4.2 to 4.4.',
        o.v42 ? 'and pick NetBox 4.1: the MACs then sit in the interfaces file.' : '',
        '',
        'What NetBox changes, so it is not counted as a difference: MAC addresses are written in capitals with',
        'colons; subnets and addresses as NetBox prints them.',
        '',
        'Names NetBox needs unique (devices and virtual machines, interfaces on one device, locations, racks,',
        'providers) are made unique here ("AP (2)"); the original is kept in topo_more. A make, model or',
        'platform spelled two ways ("Cisco", "CISCO") is written the first way met everywhere.',
        '',
        'The files are written exactly as the values are, for NetBox: a value that starts with - + = or @',
        'is not guarded for spreadsheets, so open them in NetBox rather than a spreadsheet.',
        '',
        'topo_more holds each record exactly as Topo holds it, so importing these files back into Topo',
        '(Import..., all the files at once) gives the same network. Changes made in NetBox to names, serial',
        'numbers, asset tags, comments, platforms, makes, models, MAC addresses and cable labels are read back.',
        '',
        'Not carried: notes and drawings on the map, the report header, saved searches, the table layout,',
        'accepted findings and pins, problem reports, the network log and its history, expected lives.',
        `(This network has ${nc.annotations} map notes, ${nc.searches} saved searches, ${nc.incidents} problem reports and ${nc.log} log entries.)`
    ]);
    if (nc.links.length) {
        lines.push('', 'Links NetBox cannot hold as cables (VPN links, links to virtual machines and containers, a wired', 'link on a wireless interface). They are kept in the device\'s topo_more:');
        nc.links.forEach((l) => lines.push(`  ${l.from} - ${l.to} (${l.why})`));
    }
    if (nc.networks.length) {
        lines.push('', 'Subnets whose range is not valid, kept out of the prefixes:');
        nc.networks.forEach((c) => lines.push(`  ${c}`));
    }
    if (nc.assetTags && nc.assetTags.length) {
        lines.push('', 'Asset tags NetBox needs unique, written only on the first device that has them (the others keep', 'theirs in topo_more):');
        nc.assetTags.forEach((a) => lines.push(`  ${a.tag}: ${a.device}`));
    }
    return lines.join('\r\n') + '\r\n';
}

// ---- A zip with no compression (stored), CRC-32 ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// files: [{ name, text }] -> Uint8Array. Names are UTF-8 (flag bit 11).
function zipStore(files, when = new Date()) {
    const enc = new TextEncoder();
    const dosTime = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xFFFF;
    const parts = [], central = [];
    let offset = 0;
    files.forEach((f) => {
        const name = enc.encode(f.name), data = typeof f.text === 'string' ? enc.encode(f.text) : f.bytes, crc = crc32(data);
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
        h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
        h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
        parts.push(new Uint8Array(h.buffer), name, data);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
        c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
        c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
        central.push(new Uint8Array(c.buffer), name);
        offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let at = 0;
    all.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
}
// The other way, for the importer: a stored or deflated zip -> [{ name, bytes }]
// (deflate through DecompressionStream; async).
async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return null;
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = [];
    for (let k = 0; k < count; k++) {
        if (dv.getUint32(p, true) !== 0x02014b50) return null;
        const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
        const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
        const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        const raw = bytes.subarray(start, start + size);
        let data = null;
        if (method === 0) data = raw.slice();
        else if (method === 8 && typeof DecompressionStream !== 'undefined') {
            data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        }
        if (data && !name.endsWith('/')) out.push({ name: name.split('/').pop(), bytes: data });
        p += 46 + nlen + xlen + clen;
    }
    return out;
}

// ---- The menu item ----
async function exportNetbox() {
    if (!state.nodes.length) { showToast(t('Nothing to export. Add at least one node first.')); return null; }
    const version = await askChoice(t('Which NetBox will import it?'), {
        title: t('Export to NetBox'),
        choices: [{ id: '4.2', label: t('NetBox 4.2 to 4.4'), primary: true }, { id: '4.1', label: t('NetBox 4.1') }]
    });
    if (!version) return null;
    const doc = state.readOnly ? outgoingDoc() : serializeDoc();
    const set = buildNetboxSet(doc, { version, siteName: docDisplayName() || (state.report && state.report.site) || 'Topo' });
    const zip = zipStore(set.files);
    const name = `${docFileStem('netbox')}.zip`;
    saveBlob(new Blob([zip], { type: 'application/zip' }), name);
    showToast(t('Saved {file}: import its files into NetBox in the order of their numbers (README.txt).', { file: name }));
    return set;
}

window.TopoNetbox = Object.assign(window.TopoNetbox || {}, {
    buildNetboxSet, zipStore, unzip, crc32, exportNetbox, nbDeviceNative, nbLength, typeLabel, slugify,
    STATUS_TO_NB, POE_TO_NB, TOPO_FIELDS, CF_CUSTOM_KIND, NB_VERSIONS
});
})();
