// ---- UniFi to Topo (docs/SCOPE.md step 6, D114, D118) ----
// A UniFi controller's backup (.unf) is a locked file and is refused (D118).
// What is read is what its API gives, saved to files:
//   - stat/device: gateways (ugw, udm, uxg) are routers, switches (usw) and
//     access points (uap) with their port table as the port grid (names that
//     are not "Port N" are labels, PoE, the native VLAN), model, firmware,
//     serial, and the uplink as a cable to the parent's port (a wireless
//     uplink, a mesh AP, as a wireless link);
//   - stat/sta: clients, wired ones cabled to their switch port, wireless
//     ones associated with their AP on their SSID with band and signal;
//   - rest/networkconf: subnets with the gateway, VLAN, DHCP and its range;
//   - rest/wlanconf: Wi-Fi networks, security, hidden, the subnet they put
//     clients on (the passphrase is never read);
//   - the Network application's client and device lists exported as CSV.
// Each response is { meta: { rc }, data: [...] }, a bare list, or one file
// holding several lists ({ devices, clients, networks, wlans }). Records
// keep UniFi's _id ('uf-<_id>'), so importing again updates them.
// Clients can be many passing phones: wireless ones start left out
// (amendment 36), the "What was understood" step has the ticks.

(function () {
'use strict';
const C = window.TopoImportCommon;
const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();

// What a record is, from its keys.
function kindOf(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return '';
    if ('port_table' in r || ('type' in r && /^(usw|uap|ugw|udm|uxg|ubb|uck)$/.test(r.type) && 'mac' in r)) return 'device';
    if ('ip_subnet' in r || ('purpose' in r && ('vlan_enabled' in r || 'dhcpd_enabled' in r || 'wan_type' in r))) return 'network';
    if ('wpa_mode' in r || 'x_passphrase' in r || ('security' in r && ('hide_ssid' in r || 'networkconf_id' in r || 'wlan_band' in r))) return 'wlan';
    if ('is_wired' in r || 'sw_mac' in r || 'ap_mac' in r || ('oui' in r && 'mac' in r && ('hostname' in r || 'first_seen' in r || 'last_seen' in r))) return 'client';
    return '';
}
// Every record in a JSON value, however the lists are wrapped.
function records(v, out = [], depth = 0) {
    if (depth > 4 || v == null) return out;
    if (Array.isArray(v)) { v.forEach((x) => { if (kindOf(x)) out.push(x); else if (x && typeof x === 'object') records(x, out, depth + 1); }); return out; }
    if (typeof v === 'object') {
        if (kindOf(v)) { out.push(v); return out; }
        Object.keys(v).forEach((k) => { if (k !== 'meta' && v[k] && typeof v[k] === 'object') records(v[k], out, depth + 1); });
    }
    return out;
}

// The Network application's CSV lists. Header words seen in its client and
// device exports; written from knowledge of them, not from a live controller.
const CSV_ALIAS = {
    name: 'name', alias: 'name', clientname: 'name', devicename: 'name', hostname: 'hostname', mac: 'mac', macaddress: 'mac', ip: 'ip', ipaddress: 'ip',
    network: 'network', vlan: 'vlan', connection: 'connection', connectiontype: 'connection', type: 'connection', ssid: 'essid', wifi: 'essid', wifinetwork: 'essid',
    uplink: 'uplink', connectedto: 'uplink', apswitch: 'uplink', accesspoint: 'uplink', port: 'port', switchport: 'port', manufacturer: 'vendor', vendor: 'vendor',
    model: 'model', version: 'version', firmware: 'version', firmwareversion: 'version', serial: 'serial', serialnumber: 'serial', signal: 'signal',
    experience: 'experience', wifiexperience: 'experience', devicetype: 'kind', category: 'kind', status: 'state'
};
function csvKind(tbl) {
    const k = tbl.keys;
    if (!k.has('mac')) return '';
    if (k.has('model') && (k.has('version') || k.has('serial'))) return 'device';
    if (k.has('uplink') || k.has('experience') || k.has('essid') || k.has('connection')) return 'client';
    return '';
}

function detect(file) {
    const vals = C.parseJsonValues(file.text);
    if (vals) {
        const recs = [];
        vals.forEach((v) => records(v, recs));
        if (!recs.length) return 0;
        const meta = vals.some((v) => v && v.meta && typeof v.meta === 'object' && 'rc' in v.meta);
        return meta ? 0.97 : 0.85;
    }
    if (!/[,;\t]/.test(String(file.text || '').split(/\r?\n/)[0] || '')) return 0;
    const tbl = C.aliasedTable(file.text, CSV_ALIAS);
    if (!tbl || !csvKind(tbl)) return 0;
    const named = /unifi|ubnt|ubiquiti/i.test(file.name || '');
    const marks = ['experience', 'uplink'].filter((x) => tbl.keys.has(x)).length;
    return named ? 0.9 : marks ? 0.62 + marks * 0.08 : 0;
}

// UniFi's security words as Topo's.
function security(w) {
    const sec = lc(w.security), mode = lc(w.wpa_mode);
    const wpa3 = !!w.wpa3_support, trans = !!w.wpa3_transition;
    if (sec === 'open') return w.owe || w.enhanced_open ? 'owe' : 'open';
    if (sec === 'wep') return 'wep';
    if (sec === 'wpaeap' || sec === 'wpa-eap') return wpa3 && !trans ? 'wpa3-ent' : 'wpa2-ent';
    if (sec === 'wpapsk' || sec === 'wpa-psk' || mode) {
        if (wpa3 && trans) return 'wpa2/3';
        if (wpa3) return 'wpa3';
        return mode === 'wpa1' ? 'wpa' : 'wpa2';
    }
    return '';
}
const BAND = { ng: '2.4', na: '5', '6e': '6', '2g': '2.4', '5g': '5', '6g': '6' };
const DEVICE_TYPE = { ugw: 'router', udm: 'router', uxg: 'router', usw: 'switch', uap: 'ap', ubb: 'ap', uck: 'server' };

function parse(files) {
    const b = C.builder();
    const warnings = [], notes = [];
    const all = { device: [], client: [], network: [], wlan: [] };
    let secrets = 0;
    files.forEach((f) => {
        const vals = C.parseJsonValues(f.text);
        if (vals) {
            vals.forEach((v) => {
                if (v && v.meta && v.meta.rc && v.meta.rc !== 'ok') warnings.push(C.issue('api-error', { file: f.name }, { msg: String(v.meta.msg || v.meta.rc).slice(0, 80) }));
                records(v).forEach((r, i) => all[kindOf(r)].push({ r, w: { file: f.name, row: i + 1 } }));
            });
            return;
        }
        const tbl = C.aliasedTable(f.text, CSV_ALIAS);
        const kind = tbl && csvKind(tbl);
        if (!kind) { warnings.push(C.issue('file-unknown', { file: f.name })); return; }
        secrets += tbl.secrets;
        tbl.rows.forEach(({ o, row }) => {
            const r = { mac: o.mac, ip: o.ip, name: o.name, hostname: o.hostname, oui: o.vendor, model: o.model, version: o.version, serial: o.serial, _csv: o };
            if (kind === 'device') {
                r.type = /switch/i.test(o.kind || o.model || '') ? 'usw' : /ap|access|u6|uap|nanohd|ac-/i.test(o.kind || o.model || '') ? 'uap' : /gateway|udm|usg|uxg|dream/i.test(o.kind || o.model || '') ? 'ugw' : '';
            } else {
                const conn = lc(o.connection);
                r.is_wired = conn ? /wire|ether|lan/.test(conn) && !/wireless|wi-?fi|wlan/.test(conn) : !o.essid;
                if (!r.is_wired) r.essid = o.essid || (/wireless|wi-?fi|wlan/.test(conn) ? '' : o.connection);
                r._uplink = o.uplink; r.sw_port = o.port; r.network = o.network; r.signal = o.signal;
            }
            all[kind].push({ r, w: { file: f.name, row } });
        });
        if (tbl.unread.length) notes.push(C.issue('columns-not-read', null, { list: tbl.unread.slice(0, 12).join(', ') }));
    });
    const id = (r) => (r._id ? `uf-${String(r._id).replace(/[^0-9A-Za-z_-]/g, '')}` : undefined);

    // ---- Subnets ----
    const netById = new Map();
    all.network.forEach(({ r }) => {
        if (r.x_passphrase || r.x_wan_password) secrets++;
        if (lc(r.purpose) === 'wan' || !r.ip_subnet) return;
        const p = parseValidCIDR(String(r.ip_subnet));
        if (!p) { warnings.push(C.issue('prefix-bad', null, { prefix: r.ip_subnet })); return; }
        const fields = { id: id(r), name: r.name || undefined, purpose: r.purpose && r.purpose !== 'corporate' ? r.purpose : undefined, gateway: String(p.ip) };
        if (r.vlan_enabled && Number(r.vlan) > 1) fields.vlan = asVlan(Number(r.vlan));
        if (r.dhcpd_enabled) { fields.dhcp = true; if (r.dhcpd_start) fields.dhcpFirst = r.dhcpd_start; if (r.dhcpd_stop) fields.dhcpLast = r.dhcpd_stop; }
        const dns = [r.dhcpd_dns_1, r.dhcpd_dns_2].filter((x) => C.isIp(String(x || ''))).join(', ');
        if (dns) fields.dns = dns;
        const net = b.network(r.ip_subnet, fields);
        if (net && r._id) netById.set(r._id, net);
    });
    // ---- Wi-Fi ----
    all.wlan.forEach(({ r }) => {
        if (r.x_passphrase || r.x_iapp_key || r.radius_secret) secrets++;
        const fields = { id: id(r), security: security(r) || undefined, hidden: r.hide_ssid ? true : undefined };
        const net = r.networkconf_id && netById.get(r.networkconf_id);
        if (net) fields.network = net.id;
        const band = lc(r.wlan_band);
        if (band === '2g') fields.bands = '2.4'; else if (band === '5g') fields.bands = '5';
        b.wifi(r.name || r.ssid, fields);
    });
    const vlanOfNet = (nid) => { const net = netById.get(nid); return net ? net.vlan : undefined; };

    // ---- Devices ----
    const devByMac = new Map();
    all.device.forEach(({ r, w }) => {
        const mac = C.macText(r.mac);
        if (!mac && !r.name) { warnings.push(C.issue('row-no-name', w)); return; }
        const type = DEVICE_TYPE[lc(r.type)] || C.typeFromWords(r.model) || 'switch';
        const init = { id: id(r), type, name: r.name || r.hostname || '', vendor: 'Ubiquiti' };
        if (r.model) init.model = String(r.model);
        if (r.version) init.os = `UniFi ${r.version}`;
        if (r.serial) init.serial = String(r.serial).toUpperCase();
        if (r.state !== undefined && Number(r.state) === 0 && r.adopted === false) init.status = 'planned';
        const n = b.node({ key: init.id, mac, name: init.name }, init);
        if (!n.name || n.name === mac) n.name = r.name || `${r.model || 'UniFi'} ${mac.slice(-5).replace(':', '')}`;
        devByMac.set(mac, n);
        // The management address on its own interface.
        if (r.ip || mac) b.iface(n, { name: hasPortGrid(n) ? 'Management' : 'LAN', mac, ip: r.ip ? b.addr(r.ip) : undefined });
        (Array.isArray(r.port_table) ? r.port_table : []).forEach((pt) => {
            const idx = Number(pt.port_idx);
            if (!(idx >= 1)) return;
            const label = pt.name && !/^port \d+$/i.test(pt.name) ? String(pt.name) : undefined;
            if (hasPortGrid(n)) {
                const attr = { label };
                const v = vlanOfNet(pt.native_networkconf_id);
                if (v) attr.vlan = v;
                if (pt.poe_enable || (pt.poe_mode && pt.poe_mode !== 'off' && pt.port_poe)) attr.poe = 'at';
                b.port(n, idx, attr);
            } else {
                const i = b.iface(n, { name: pt.name || `Port ${idx}` });
                i._idx = idx;
                if (pt.ip && /wan/i.test(pt.name || pt.ifname || '')) i.ip = b.addr(pt.ip, pt.netmask ? C.maskBits(pt.netmask) : undefined);
            }
        });
        if (n.type === 'ap' && !n.interfaces.some((i) => i.wireless)) b.iface(n, { name: 'WLAN', wireless: true });
    });
    // A gateway's port N: its interface of that index.
    const portEnd = (n, idx) => {
        if (!n) return null;
        if (hasPortGrid(n)) return b.port(n, idx || 1);
        const hit = n.interfaces.find((i) => i._idx === Number(idx));
        return hit ? hit.id : b.iface(n, { name: `Port ${idx || 1}` }).id;
    };
    const wlanIface = (n) => (n.interfaces.find((i) => i.wireless) || b.iface(n, { name: 'WLAN', wireless: true })).id;
    // Uplinks: a cable to the parent's port, or a mesh hop.
    all.device.forEach(({ r, w }) => {
        const n = devByMac.get(C.macText(r.mac));
        const up = r.uplink || {};
        const pmac = C.macText(up.uplink_mac || r.uplink_mac);
        if (!n || !pmac) return;
        const parent = devByMac.get(pmac);
        if (!parent) { warnings.push(C.issue('uplink-unknown', w, { name: n.name })); return; }
        if (lc(up.type) === 'wireless') {
            b.link(parent, wlanIface(parent), n, wlanIface(n), { medium: 'wireless' });
            return;
        }
        const local = portEnd(n, up.port_idx || up.local_port_idx || 1);
        const remote = portEnd(parent, up.uplink_remote_port || up.remote_port);
        const l = b.link(parent, remote, n, local, {});
        if (l && /^(10000|25000|40000)/.test(String(up.speed || '')) && up.media && /sfp/i.test(up.media)) l.medium = 'fiber';
    });

    // ---- Clients ----
    const devByName = new Map([...devByMac.values()].map((n) => [lc(n.name), n]));
    all.client.forEach(({ r, w }) => {
        const mac = C.macText(r.mac);
        if (!mac) { warnings.push(C.issue('no-mac', w)); return; }
        const net = r.network_id ? netById.get(r.network_id) : null;
        const ipText = r.use_fixedip && r.fixed_ip ? r.fixed_ip : r.ip;
        const ip = ipText ? b.addr(ipText, net ? parseValidCIDR(net.cidr).prefix : undefined) : '';
        let vendor = r.oui || '';
        if (!vendor && window.CarinoOUI) { const v = CarinoOUI.lookupVendor(CarinoOUI.normalizeMac(mac)); if (v && v.kind === 'oui') vendor = v.vendor; }
        const name = r.name || r.hostname || '';
        const init = { id: id(r), type: C.typeFromWords([r.dev_cat_name, r.dev_family, name].filter(Boolean).join(' ')) || 'custom', name: name || `${vendor || 'Client'} ${mac.slice(-5).replace(':', '')}` };
        if (vendor) init.vendor = vendor;
        if (init.type === 'cloud' || init.type === 'router') init.type = 'custom';
        const n = b.node({ key: init.id, mac, ip: ipText, name }, init);
        const wired = r.is_wired !== undefined ? !!r.is_wired : !r.ap_mac && !r.essid;
        const vlan = r.vlan ? asVlan(Number(r.vlan)) : net ? net.vlan : undefined;
        const ci = b.iface(n, { mac, ip: ip || undefined, wireless: !wired });
        b.part(wired ? 'wired' : 'wireless', n);
        if (wired) {
            const sw = devByMac.get(C.macText(r.sw_mac)) || (r._uplink && devByName.get(lc(r._uplink)));
            if (sw && r.sw_port !== undefined && r.sw_port !== '') {
                const pid = portEnd(sw, Number(r.sw_port));
                if (hasPortGrid(sw) && vlan && !((sw.portAttrs || {})[pid] || {}).vlan) b.port(sw, Number(r.sw_port), { vlan });
                b.link(sw, pid, n, ci.id, { medium: 'utp' });
            }
        } else {
            const ap = devByMac.get(C.macText(r.ap_mac)) || (r._uplink && devByName.get(lc(r._uplink)));
            const wf = r.essid ? b.wifi(r.essid) : null;
            if (ap) {
                const wifi = {};
                if (wf) wifi.ssid = wf.id;
                const band = BAND[lc(r.radio)] || BAND[lc(r.radio_proto)] || '';
                if (band) wifi.band = band;
                const sig = Number(r.signal);
                if (Number.isFinite(sig) && sig < 0) wifi.signal = sig;
                b.link(ap, wlanIface(ap), n, ci.id, Object.assign({ medium: 'wireless' }, Object.keys(wifi).length ? { wifi } : {}));
            }
        }
    });
    b.doc.nodes.forEach((n) => n.interfaces.forEach((i) => { delete i._idx; }));
    b.stats.secrets += secrets;
    b.notes(notes);
    return { doc: b.finish(), warnings, notes, name: '', parts: b.partList() };
}
const importer = { id: 'unifi', label: 'UniFi', family: 'unifi', multi: true, detect, parse };
if (window.TopoImporters) TopoImporters.register(importer);
window.TopoImportUnifi = { importer, kindOf, security };
})();
