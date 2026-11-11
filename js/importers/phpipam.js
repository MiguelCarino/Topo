// ---- phpIPAM to Topo (docs/SCOPE.md step 6, D114) ----
// What phpIPAM gives out:
//   - its CSV exports of subnets (Subnet, Mask, Description, VLAN, Section),
//     addresses (IP address, Hostname, MAC, Description, Owner, Device, Port,
//     Note, the state or tag) and VLANs (Number, Name);
//   - its API's JSON saved to files ({ code, success, data }) for
//     /subnets/, /addresses/, /vlan/ (and /tools/devices/ for the switches
//     addresses name).
// Subnets are subnets (the VLAN by its number); addresses are devices (the
// host name, else the address) with that address and MAC, in their subnet's
// prefix; an address marked as the gateway is its subnet's gateway; Device
// and Port cable it to that switch's port. Tags: Offline is retired,
// Reserved planned, Used and DHCP active. A VLAN with no subnet is said.
// Records keep phpIPAM's ids ('ip-<src>-s12' subnets, 'ip-<src>-a7'
// addresses), so importing again updates them.

(function () {
'use strict';
const C = window.TopoImportCommon;
const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();

const ALIAS = {
    id: 'id', subnet: 'subnet', mask: 'mask', description: 'description', vlan: 'vlan', vlanid: 'vlanId', section: 'section', sectionname: 'section',
    ipaddress: 'ip', ip: 'ip', ipaddr: 'ip', hostname: 'hostname', mac: 'mac', macaddress: 'mac', owner: 'owner', device: 'device',
    port: 'port', note: 'note', tag: 'tag', ipstate: 'tag', gateway: 'gateway', isgateway: 'isGateway', number: 'number', name: 'name',
    domain: 'domain', l2domain: 'domain', subnetid: 'subnetId', vrf: 'vrf', mastersubnet: 'master', firewallobject: 'fwObject', lastseen: 'lastSeen'
};

function csvKind(keys) {
    if (keys.has('ip') && (keys.has('hostname') || keys.has('tag') || keys.has('owner') || keys.has('fwObject'))) return 'address';
    if (keys.has('subnet') && keys.has('mask')) return 'subnet';
    if (keys.has('number') && keys.has('name') && !keys.has('ip')) return 'vlan';
    return '';
}
function apiKind(r) {
    if (!r || typeof r !== 'object') return '';
    if ('subnet' in r && 'mask' in r) return 'subnet';
    if ('ip' in r && ('subnetId' in r || 'is_gateway' in r)) return 'address';
    if ('vlanId' in r && 'number' in r) return 'vlan';
    if ('hostname' in r && 'ip_addr' in r && !('subnetId' in r)) return 'device';
    return '';
}

function detect(file) {
    const vals = C.parseJsonValues(file.text);
    if (vals) {
        const env = vals.some((v) => v && typeof v === 'object' && 'success' in v && 'data' in v && 'code' in v);
        const recs = vals.flatMap((v) => (v && Array.isArray(v.data) ? v.data : Array.isArray(v) ? v : []));
        if (!recs.some((r) => apiKind(r))) return 0;
        return env ? 0.96 : 0.7;
    }
    const first = String(file.text || '').split(/\r?\n/)[0] || '';
    if (!/[,;\t]/.test(first)) return 0;
    const tbl = C.csvTable(String(file.text).split(/\r?\n/).slice(0, 3).join('\n'));
    if (!tbl) return 0;
    const keys = new Set(tbl.headers.map((h) => ALIAS[C.headerKey(h)]).filter(Boolean));
    const kind = csvKind(keys);
    if (!kind) return 0;
    const hk = tbl.headers.map(C.headerKey);
    if (/phpipam/i.test(file.name || '')) return 0.92;
    if (kind === 'address') return hk.includes('ipstate') || hk.includes('firewallobject') ? 0.88 : hk.includes('owner') && hk.includes('port') ? 0.75 : 0.55;
    if (kind === 'subnet') return hk.includes('section') || hk.includes('mastersubnet') ? 0.85 : 0.6;
    return hk.includes('domain') || hk.includes('l2domain') ? 0.7 : 0;
}

const TAG = { 1: 'retired', 2: 'active', 3: 'planned', 4: 'active', offline: 'retired', used: 'active', reserved: 'planned', dhcp: 'active' };
const truthy = (v) => v === true || /^(1|true|yes)$/i.test(String(v == null ? '' : v).trim());

function parse(files) {
    const b = C.builder();
    const warnings = [], notes = [];
    const all = { subnet: [], address: [], vlan: [], device: [] };
    let secrets = 0;
    const unread = new Set();
    files.forEach((f) => {
        const vals = C.parseJsonValues(f.text);
        if (vals) {
            vals.forEach((v) => {
                if (v && typeof v === 'object' && v.success === false) warnings.push(C.issue('api-error', { file: f.name }, { msg: String(v.message || v.code).slice(0, 80) }));
                const recs = v && Array.isArray(v.data) ? v.data : Array.isArray(v) ? v : v && v.data && typeof v.data === 'object' ? [v.data] : [];
                recs.forEach((r, i) => { const k = apiKind(r); if (k) all[k].push({ r, w: { file: f.name, row: i + 1 } }); });
            });
            return;
        }
        const tbl = C.aliasedTable(f.text, ALIAS);
        const kind = tbl && csvKind(tbl.keys);
        if (!kind) { warnings.push(C.issue('file-unknown', { file: f.name })); return; }
        secrets += tbl.secrets;
        tbl.unread.forEach((h) => unread.add(h));
        tbl.rows.forEach(({ o, row }) => all[kind].push({ r: o, w: { file: f.name, row }, csv: true }));
    });
    const src = C.sourceTag(all.subnet.concat(all.address).map((x) => x.r.sectionId || x.r.section || '').find(Boolean) || 'phpipam');
    const id = (letter, r) => (r.id !== undefined && /^\d+$/.test(String(r.id)) ? `ip-${src}-${letter}${r.id}` : undefined);

    // VLANs: by phpIPAM id and by number.
    const vlanById = new Map(), vlanNames = new Map();
    all.vlan.forEach(({ r }) => {
        const vid = asVlan(Number(r.number));
        if (!vid) return;
        if (r.vlanId !== undefined) vlanById.set(String(r.vlanId), vid);
        vlanNames.set(vid, r.name || '');
    });
    const vlanOf = (r) => {
        if (r.vlanId !== undefined && r.vlanId !== null && vlanById.has(String(r.vlanId))) return vlanById.get(String(r.vlanId));
        const m = /^\s*(\d{1,4})\b/.exec(String(r.vlan || ''));
        return m ? asVlan(Number(m[1])) : undefined;
    };
    // Subnets.
    const netById = new Map();
    const usedVlans = new Set();
    all.subnet.forEach(({ r, w }) => {
        const bits = C.maskBits(r.mask);
        const base = String(r.subnet || '').split('/')[0].trim();
        const cidr = bits !== undefined ? `${base}/${bits}` : String(r.subnet || '');
        if (!parseValidCIDR(cidr)) { warnings.push(C.issue('prefix-bad', w, { prefix: [r.subnet, r.mask].filter(Boolean).join('/') })); return; }
        const fields = { id: id('s', r), name: r.description || undefined };
        const vid = vlanOf(r);
        if (vid) { fields.vlan = vid; usedVlans.add(vid); }
        const gw = r.gateway && typeof r.gateway === 'object' ? r.gateway.ip_addr : r.gateway;
        if (gw && C.isIp(String(gw))) fields.gateway = String(gw);
        if (!fields.name && vid && vlanNames.get(vid)) fields.name = vlanNames.get(vid);
        const net = b.network(cidr, fields);
        if (net && r.id !== undefined) netById.set(String(r.id), net);
    });
    vlanNames.forEach((name, vid) => { if (!usedVlans.has(vid)) notes.push(C.issue('vlan-no-subnet', null, { vid, name })); });
    // The switches addresses name, by id (API) or by name (CSV).
    const devById = new Map();
    all.device.forEach(({ r }) => { if (r.id !== undefined) devById.set(String(r.id), r); });
    const switchNode = (name, r) => {
        const init = { id: r && r.id !== undefined ? `ip-${src}-d${r.id}` : undefined, type: C.typeFromWords(r && (r.type || r.description)) || 'switch', name };
        if (!init.id) delete init.id;
        const n = b.node({ key: init.id || 'ipdev:' + lc(name), name }, init);
        if (r && r.ip_addr && C.isIp(String(r.ip_addr)) && !n.interfaces.some((i) => i.ip)) b.iface(n, { name: 'Management', ip: b.addr(r.ip_addr) });
        return n;
    };
    // Addresses.
    all.address.forEach(({ r, w }) => {
        const ipText = String(r.ip || '').trim();
        if (!C.isIp(ipText)) { warnings.push(C.issue('ip-bad', w, { address: ipText })); return; }
        const net = (r.subnetId !== undefined && netById.get(String(r.subnetId))) || (b.netOf(ipText) || {}).net;
        const ip = b.addr(ipText, net ? parseValidCIDR(net.cidr).prefix : undefined);
        const gateway = truthy(r.is_gateway) || truthy(r.isGateway) || /gateway/i.test(String(r.tag || ''));
        if (gateway && net && !net.gateway) net.gateway = ipText;
        const host = String(r.hostname || '').trim();
        const mac = C.macText(r.mac);
        const tag = lc(r.tag);
        const init = { id: id('a', r), type: C.typeFromWords(`${host} ${r.description || ''}`) || 'custom', name: host || ipText };
        if (gateway && init.type === 'custom') init.type = 'router';
        if (!init.id) delete init.id;
        if (TAG[tag]) init.status = TAG[tag];
        const notesText = [r.description, r.note].filter(Boolean).join('\n');
        if (notesText) init.notes = notesText;
        const n = b.node({ key: init.id, mac, ip: ipText, name: host }, init);
        if (r.owner) b.extra(n, 'Owner', String(r.owner));
        const ni = b.iface(n, { mac, ip });
        const devRow = r.deviceId !== undefined && r.deviceId !== null && String(r.deviceId) !== '0' ? devById.get(String(r.deviceId)) : null;
        const devName = devRow ? devRow.hostname : String(r.device || '').trim();
        const port = String(r.port || '').trim();
        if (devName && port) {
            const sw = switchNode(devName, devRow);
            if (sw === n) return;
            let end;
            const num = /^(?:port\s*)?(\d+)$/i.exec(port);
            if (num && hasPortGrid(sw)) end = b.port(sw, Number(num[1]));
            else end = b.iface(sw, { name: port }).id;
            b.link(sw, end, n, ni.id, { medium: 'utp' });
        }
    });
    if (unread.size) notes.push(C.issue('columns-not-read', null, { list: [...unread].slice(0, 12).join(', ') }));
    b.stats.secrets += secrets;
    b.notes(notes);
    return { doc: b.finish(), warnings, notes, name: '' };
}

const importer = { id: 'phpipam', label: 'phpIPAM', family: 'phpipam', multi: true, detect, parse };
if (window.TopoImporters) TopoImporters.register(importer);
window.TopoImportPhpipam = { importer };
})();
