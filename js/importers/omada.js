// ---- Omada to Topo (docs/SCOPE.md step 6, D114, D118) ----
// An Omada controller's backup (.cfg) is a locked file and is refused (D118).
// What is read is its Open API's JSON saved to files ({ errorCode: 0,
// result: { data: [...] } }, result as a list, or a bare list) and the
// controller's device and client lists exported as CSV:
//   - devices: gateways are routers, switches and access points with their
//     ports (when the file has them) as the port grid, model, firmware,
//     serial, and the uplink as a cable to the parent's port;
//   - clients: wired ones cabled to their switch port (with the port's
//     VLAN), wireless ones associated with their AP on their SSID;
//   - LAN networks (subnets with the gateway, VLAN and DHCP range) and
//     wireless networks (SSID, security, hidden) when the files have them.
// The field names are written from knowledge of the Omada Open API and its
// exports, not from a live controller (docs/SCOPE.md says so). Records keep
// Omada's id ('om-<id>'; a device or client with none, its MAC), so
// importing again updates them. Wireless clients start left out.

(function () {
'use strict';
const C = window.TopoImportCommon;
const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();

function kindOf(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return '';
    if ('gatewaySubnet' in r || ('purpose' in r && 'vlan' in r && 'dhcpSettings' in r)) return 'network';
    if (('ssid' in r || 'name' in r) && ('security' in r || 'broadcast' in r) && ('band' in r || 'vlanSetting' in r || 'wlanId' in r || 'pskSetting' in r)) return 'wlan';
    if ('mac' in r && ('firmwareVersion' in r || 'sn' in r || ('type' in r && /^(ap|switch|gateway|olt)$/i.test(String(r.type)) && 'model' in r))) return 'device';
    if ('mac' in r && ('apMac' in r || 'switchMac' in r || 'wireless' in r || 'connectType' in r || 'hostName' in r)) return 'client';
    return '';
}
function records(v, out = [], depth = 0) {
    if (depth > 5 || v == null) return out;
    if (Array.isArray(v)) { v.forEach((x) => { if (kindOf(x)) out.push(x); else if (x && typeof x === 'object') records(x, out, depth + 1); }); return out; }
    if (typeof v === 'object') {
        if (kindOf(v)) { out.push(v); return out; }
        Object.keys(v).forEach((k) => { if (v[k] && typeof v[k] === 'object') records(v[k], out, depth + 1); });
    }
    return out;
}
const CSV_ALIAS = {
    name: 'name', devicename: 'name', clientname: 'name', username: 'name', hostname: 'hostName', mac: 'mac', macaddress: 'mac', ip: 'ip', ipaddress: 'ip',
    model: 'model', firmware: 'firmwareVersion', firmwareversion: 'firmwareVersion', version: 'firmwareVersion', sn: 'sn', serial: 'sn', serialnumber: 'sn',
    type: 'type', devicetype: 'type', status: 'status', ssid: 'ssid', ssidnetwork: 'ssid', network: 'ssid', apname: 'apName', ap: 'apName',
    switchname: 'switchName', switch: 'switchName', connecteddevice: 'uplinkName', apswitch: 'uplinkName', uplinkdevice: 'uplinkName', port: 'port', switchport: 'port',
    vlan: 'vid', vid: 'vid', vendor: 'vendor', manufacturer: 'vendor', connectiontype: 'connectType', connecttype: 'connectType', wireless: 'wireless'
};
function csvKind(tbl) {
    const k = tbl.keys;
    if (!k.has('mac')) return '';
    if (k.has('model') && (k.has('firmwareVersion') || k.has('sn'))) return 'device';
    if (k.has('apName') || k.has('switchName') || k.has('uplinkName') || k.has('ssid') || k.has('connectType')) return 'client';
    return '';
}

function detect(file) {
    const vals = C.parseJsonValues(file.text);
    if (vals) {
        const recs = [];
        vals.forEach((v) => records(v, recs));
        if (!recs.length) return 0;
        const env = vals.some((v) => v && typeof v === 'object' && 'errorCode' in v && 'result' in v);
        return env ? 0.97 : 0.84;
    }
    if (!/[,;\t]/.test(String(file.text || '').split(/\r?\n/)[0] || '')) return 0;
    const tbl = C.aliasedTable(file.text, CSV_ALIAS);
    if (!tbl || !csvKind(tbl)) return 0;
    if (/omada|tp-?link/i.test(file.name || '')) return 0.9;
    const hk = new Set(tbl.headers.map(C.headerKey));
    const marks = ['apname', 'switchname', 'firmwareversion', 'ssidnetwork', 'connecteddevice'].filter((x) => hk.has(x)).length;
    return marks >= 2 ? 0.75 : marks ? 0.6 : 0;
}

// Omada's security, a number or words, as Topo's.
function security(w) {
    const s = lc(w.securityName || w.security);
    const ver = lc((w.pskSetting && w.pskSetting.versionPsk) || w.versionPsk || w.wpaVersion || '');
    if (s === '0' || /^(none|open)$/.test(s)) return 'open';
    if (s === '1' || /wep/.test(s)) return 'wep';
    if (s === '2' || /enterprise|eap|radius/.test(s)) return /wpa3/.test(s) || ver === '4' ? 'wpa3-ent' : 'wpa2-ent';
    if (s === '3' || /personal|psk|wpa/.test(s)) {
        if (/wpa2.*wpa3|wpa3.*wpa2/.test(s) || ver === '5') return 'wpa2/3';
        if (/wpa3/.test(s) || ver === '4') return 'wpa3';
        return 'wpa2';
    }
    return '';
}
const DEVICE_TYPE = { gateway: 'router', router: 'router', switch: 'switch', ap: 'ap', eap: 'ap', olt: 'switch' };
const BAND = { 0: '2.4', 1: '5', 2: '5', 3: '6', '2.4g': '2.4', '5g': '5', '6g': '6' };

function parse(files) {
    const b = C.builder();
    const warnings = [], notes = [];
    const all = { device: [], client: [], network: [], wlan: [] };
    let secrets = 0;
    files.forEach((f) => {
        const vals = C.parseJsonValues(f.text);
        if (vals) {
            vals.forEach((v) => {
                if (v && typeof v === 'object' && 'errorCode' in v && Number(v.errorCode) !== 0) warnings.push(C.issue('api-error', { file: f.name }, { msg: String(v.msg || v.errorCode).slice(0, 80) }));
                records(v).forEach((r, i) => all[kindOf(r)].push({ r, w: { file: f.name, row: i + 1 } }));
            });
            return;
        }
        const tbl = C.aliasedTable(f.text, CSV_ALIAS);
        const kind = tbl && csvKind(tbl);
        if (!kind) { warnings.push(C.issue('file-unknown', { file: f.name })); return; }
        secrets += tbl.secrets;
        tbl.rows.forEach(({ o, row }) => {
            const r = Object.assign({}, o);
            if (kind === 'client') {
                const ct = lc(o.connectType || o.wireless);
                r.wireless = o.ssid ? !/wired/.test(ct) : /wireless|wi-?fi|true|yes/.test(ct);
                if (o.uplinkName) { if (r.wireless) r.apName = r.apName || o.uplinkName; else r.switchName = r.switchName || o.uplinkName; }
            }
            all[kind].push({ r, w: { file: f.name, row } });
        });
        if (tbl.unread.length) notes.push(C.issue('columns-not-read', null, { list: tbl.unread.slice(0, 12).join(', ') }));
    });
    const idOf = (r, mac) => (r.id ? `om-${String(r.id).replace(/[^0-9A-Za-z_-]/g, '')}` : mac ? `om-${mac.replace(/:/g, '').toLowerCase()}` : undefined);

    // ---- Subnets and Wi-Fi ----
    const netById = new Map(), netByVid = new Map();
    all.network.forEach(({ r }) => {
        const sub = r.gatewaySubnet || r.subnet || '';
        if (!sub) return;
        const p = parseValidCIDR(String(sub));
        if (!p) { warnings.push(C.issue('prefix-bad', null, { prefix: sub })); return; }
        const d = r.dhcpSettings || {};
        const fields = { id: r.id ? `om-${r.id}` : undefined, name: r.name || undefined, gateway: String(p.ip) };
        const vid = asVlan(Number(r.vlan));
        if (vid && vid > 1) fields.vlan = vid;
        if (d.enable) { fields.dhcp = true; if (d.ipaddrStart) fields.dhcpFirst = d.ipaddrStart; if (d.ipaddrEnd) fields.dhcpLast = d.ipaddrEnd; }
        const dns = [d.priDns, d.sndDns].filter((x) => C.isIp(String(x || ''))).join(', ');
        if (dns) fields.dns = dns;
        const net = b.network(sub, fields);
        if (!net) return;
        if (r.id) netById.set(r.id, net);
        if (net.vlan) netByVid.set(net.vlan, net);
    });
    all.wlan.forEach(({ r }) => {
        if (r.pskSetting && r.pskSetting.securityKey) secrets++;
        if (r.securityKey || r.password) secrets++;
        const fields = { id: r.id ? `om-${r.id}` : undefined, security: security(r) || undefined, hidden: r.broadcast === false ? true : undefined };
        const vs = r.vlanSetting || {};
        const vid = asVlan(Number(vs.customConfig && vs.customConfig.vlanId || r.vlanId));
        const net = (vs.customConfig && netById.get(vs.customConfig.lanNetworkId)) || (vid && netByVid.get(vid));
        if (net) fields.network = net.id;
        b.wifi(r.ssid || r.name, fields);
    });

    // ---- Devices ----
    const devByMac = new Map(), devByName = new Map();
    all.device.forEach(({ r, w }) => {
        const mac = C.macText(r.mac);
        if (!mac) { warnings.push(C.issue('no-mac', w)); return; }
        const type = DEVICE_TYPE[lc(r.type)] || C.typeFromWords(`${r.type || ''} ${r.model || ''}`) || 'switch';
        const init = { id: idOf(r, mac), type, name: r.name || '', vendor: 'TP-Link' };
        if (r.model) init.model = String(r.model);
        if (r.firmwareVersion) init.os = `Omada ${String(r.firmwareVersion).split(' ')[0]}`;
        if (r.sn) init.serial = String(r.sn).toUpperCase();
        const n = b.node({ key: init.id, mac, name: init.name }, init);
        if (n.name === mac) n.name = `${r.model || 'Omada'} ${mac.slice(-5).replace(':', '')}`;
        devByMac.set(mac, n);
        devByName.set(lc(n.name), n);
        b.iface(n, { name: hasPortGrid(n) ? 'Management' : 'LAN', mac, ip: r.ip ? b.addr(r.ip) : undefined });
        const ports = Array.isArray(r.ports) ? r.ports : Array.isArray(r.portList) ? r.portList : [];
        ports.forEach((pt) => {
            const idx = Number(pt.port != null ? pt.port : pt.portId);
            if (!(idx >= 1)) return;
            const label = pt.name && !/^port\s*\d+$/i.test(pt.name) ? String(pt.name) : undefined;
            if (hasPortGrid(n)) {
                const attr = { label };
                const v = asVlan(Number(pt.nativeVlanId || pt.pvid));
                if (v && v > 1) attr.vlan = v;
                if (pt.poe === true || pt.poe === 1 || lc(pt.poe) === 'enable') attr.poe = 'at';
                b.port(n, idx, attr);
            } else b.iface(n, { name: pt.name || `Port ${idx}` })._idx = idx;
        });
        if (n.type === 'ap' && !n.interfaces.some((i) => i.wireless)) b.iface(n, { name: 'WLAN', wireless: true });
        if (lc(r.status) === 'pending' || lc(r.statusCategory) === 'pending') n.status = 'planned';
    });
    const portEnd = (n, idx) => {
        if (hasPortGrid(n)) return b.port(n, idx || 1);
        const hit = n.interfaces.find((i) => i._idx === Number(idx));
        return hit ? hit.id : b.iface(n, { name: `Port ${idx || 1}` }).id;
    };
    const wlanIface = (n) => (n.interfaces.find((i) => i.wireless) || b.iface(n, { name: 'WLAN', wireless: true })).id;
    all.device.forEach(({ r, w }) => {
        const n = devByMac.get(C.macText(r.mac));
        const pmac = C.macText(r.uplinkDeviceMac || r.uplinkMac);
        if (!n || !pmac) return;
        const parent = devByMac.get(pmac);
        if (!parent) { warnings.push(C.issue('uplink-unknown', w, { name: n.name })); return; }
        if (r.wirelessUplink === true || lc(r.uplinkType) === 'wireless') { b.link(parent, wlanIface(parent), n, wlanIface(n), { medium: 'wireless' }); return; }
        b.link(parent, portEnd(parent, Number(r.uplinkDevicePort || r.uplinkPort) || 1), n, portEnd(n, Number(r.uplinkLocalPort || r.linkPort) || 1), {});
    });

    // ---- Clients ----
    all.client.forEach(({ r, w }) => {
        const mac = C.macText(r.mac);
        if (!mac) { warnings.push(C.issue('no-mac', w)); return; }
        const vid = asVlan(Number(r.vid));
        const net = vid ? netByVid.get(vid) : null;
        const ip = r.ip ? b.addr(r.ip, net ? parseValidCIDR(net.cidr).prefix : undefined) : '';
        let vendor = r.vendor || '';
        if (!vendor && window.CarinoOUI) { const v = CarinoOUI.lookupVendor(CarinoOUI.normalizeMac(mac)); if (v && v.kind === 'oui') vendor = v.vendor; }
        const name = r.name && C.macText(r.name) !== mac ? r.name : r.hostName || '';
        let type = C.typeFromWords([r.deviceType, r.osName, name].filter(Boolean).join(' ')) || 'custom';
        if (type === 'cloud' || type === 'router') type = 'custom';
        const init = { id: idOf(r, mac), type, name: name || `${vendor || 'Client'} ${mac.slice(-5).replace(':', '')}` };
        if (vendor) init.vendor = vendor;
        const n = b.node({ key: init.id, mac, ip: r.ip, name }, init);
        const wireless = r.wireless === true || /true|yes/i.test(String(r.wireless)) || (!!(r.apMac || r.apName || r.ssid) && !r.switchMac);
        const ci = b.iface(n, { mac, ip: ip || undefined, wireless });
        b.part(wireless ? 'wireless' : 'wired', n);
        if (!wireless) {
            const sw = devByMac.get(C.macText(r.switchMac)) || devByName.get(lc(r.switchName));
            if (sw && r.port !== undefined && r.port !== '' && Number(r.port) >= 1) {
                const pid = portEnd(sw, Number(r.port));
                if (hasPortGrid(sw) && vid && vid > 1 && !((sw.portAttrs || {})[pid] || {}).vlan) b.port(sw, Number(r.port), { vlan: vid });
                b.link(sw, pid, n, ci.id, { medium: 'utp' });
            }
        } else {
            const ap = devByMac.get(C.macText(r.apMac)) || devByName.get(lc(r.apName));
            const wf = r.ssid ? b.wifi(r.ssid) : null;
            if (ap) {
                const wifi = {};
                if (wf) wifi.ssid = wf.id;
                const band = BAND[lc(r.radioId)] || '';
                if (band) wifi.band = band;
                const sig = Number(r.rssi);
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

const importer = { id: 'omada', label: 'Omada', family: 'omada', multi: true, detect, parse };
if (window.TopoImporters) TopoImporters.register(importer);
window.TopoImportOmada = { importer, kindOf, security };
})();
