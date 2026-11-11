// ---- Cisco CDP and MAC table to Topo (docs/SCOPE.md step 6, D114, D119) ----
// Text captured from a Cisco switch (IOS, IOS-XE or NX-OS):
//   - "show cdp neighbors detail": the switch, its neighbours (type from
//     their capabilities, model from the platform, address, the serial NX-OS
//     puts in the Device ID) and a cable between the two named interfaces,
//     with the native VLAN on the local port;
//   - "show mac address-table": each address on an access port becomes a
//     device ("{vendor} {last 4}", from the address's maker) cabled to that
//     port, with the port's VLAN. The merge then finds the devices already
//     in the network by their MAC, which is the point.
// A port with more than 3 addresses, a port-channel, or a port with a CDP
// neighbour is an uplink: its addresses are left out and said (D119). A
// port seen in two VLANs (a phone and a PC behind it) takes the VLAN with
// more addresses; the other is carried tagged, and said.
// Interface names are written long (Gi1/0/1 is GigabitEthernet1/0/1) so the
// two captures agree. The switch's name comes from the prompt
// ("SW1#show cdp neighbors detail"); several prompts in one file are several
// switches. With no prompt, the dialog asks for it (opts.switchName).

(function () {
'use strict';
const C = window.TopoImportCommon;
const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();

const IF_NAMES = [['twe', 'TwentyFiveGigE'], ['tw', 'TwoGigabitEthernet'], ['te', 'TenGigabitEthernet'], ['fa', 'FastEthernet'], ['fi', 'FiveGigabitEthernet'],
    ['fo', 'FortyGigabitEthernet'], ['gi', 'GigabitEthernet'], ['hu', 'HundredGigE'], ['eth', 'Ethernet'], ['et', 'Ethernet'], ['po', 'Port-channel'],
    ['vl', 'Vlan'], ['mgmt', 'mgmt']];
// An interface name in its long form.
function ifName(text) {
    const s = String(text || '').trim();
    const m = /^([A-Za-z][A-Za-z-]*?)\s*(\d[\d/.:]*)$/.exec(s);
    if (!m) return s;
    const L = m[1].toLowerCase();
    const hit = L === 'port' ? null : IF_NAMES.find(([short, long]) => L === long.toLowerCase() || (L.startsWith(short) && long.toLowerCase().startsWith(L)));
    return hit ? hit[1] + m[2] : s;
}
const ifKey = (text) => lc(ifName(text));

function detect(file) {
    const s = String(file.text || '').slice(0, 20000);
    if (/Device ID\s*:/.test(s) && /Port ID \(outgoing port\)/.test(s)) return 0.96;
    if (/Mac Address Table/i.test(s) || /^\s*vlan\s+mac address\s+type\s+/im.test(s) || /^\s*VLAN\s+MAC Address\s+Type\s+age/im.test(s)) return 0.94;
    if (/show (cdp neighbors|mac address-table)/i.test(s)) return 0.8;
    return 0;
}

const PROMPT_RE = /^([A-Za-z0-9][\w.-]{0,62})(?:\([\w-]+\))?[#>]\s*(\S.*)?$/;
// The file in pieces, one per prompt: { host, cmd, lines: [{ text, line }] }.
function segments(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let cur = { host: '', cmd: '', lines: [] };
    out.push(cur);
    lines.forEach((t, i) => {
        const m = PROMPT_RE.exec(t.trim());
        if (m && (!m[2] || /^(sh|show|term|terminal)\b/i.test(m[2]))) {
            cur = { host: m[1], cmd: m[2] || '', lines: [] };
            out.push(cur);
            return;
        }
        cur.lines.push({ text: t, line: i + 1 });
    });
    return out.filter((s) => s.lines.some((l) => l.text.trim()));
}

// "show cdp neighbors detail" -> [{ id, name, serial, ip, platform, caps, local, remote, native, line }]
function cdpEntries(seg) {
    const blocks = [];
    let cur = null;
    seg.lines.forEach(({ text, line }) => {
        if (/^-{5,}\s*$/.test(text.trim())) { cur = null; return; }
        const m = /^\s*Device ID\s*:\s*(.+?)\s*$/.exec(text);
        if (m) { cur = { id: m[1], line, ips: [] }; blocks.push(cur); return; }
        if (!cur) return;
        let x;
        if ((x = /^\s*(?:IP address|IPv4 Address|IPv6 address)\s*:\s*(\S+)/i.exec(text))) { cur.ips.push(x[1]); return; }
        if ((x = /^\s*Platform\s*:\s*([^,]+?)\s*,\s*Capabilities\s*:\s*(.*)$/i.exec(text))) { cur.platform = x[1]; cur.caps = x[2].trim(); return; }
        if ((x = /^\s*Platform\s*:\s*(.+?)\s*$/i.exec(text))) { cur.platform = x[1]; return; }
        if ((x = /^\s*Capabilities\s*:\s*(.*)$/i.exec(text))) { cur.caps = x[1].trim(); return; }
        if ((x = /^\s*Interface\s*:\s*([^,]+?)\s*,\s*Port ID \(outgoing port\)\s*:\s*(.+?)\s*$/i.exec(text))) { cur.local = x[1]; cur.remote = x[2]; return; }
        if ((x = /^\s*Native VLAN\s*:\s*(\d+)/i.exec(text))) { cur.native = Number(x[1]); return; }
        if ((x = /^\s*System Name\s*:\s*(\S+)/i.exec(text))) { cur.sysName = x[1]; return; }
    });
    return blocks.map((bk) => {
        let name = bk.sysName || bk.id, serial = '';
        const ser = /^(.*?)\(([A-Za-z0-9]+)\)$/.exec(bk.id);
        if (ser) { name = bk.sysName || ser[1]; serial = ser[2]; }
        if (!C.isIp(name) && !/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(name)) name = name.split('.')[0];
        const ip = bk.ips.find((x) => C.isIp(x)) || '';
        return { id: bk.id, name, serial, ip, platform: bk.platform || '', caps: bk.caps || '', local: bk.local || '', remote: bk.remote || '', native: bk.native, line: bk.line };
    });
}

const SKIP_PORT = /^(cpu|router|drop|switch|sup-eth\S*|vpc\s*peer-link|vpc|peer-link|\(r\)|po\d.*|port-channel\S*)$/i;
// "show mac address-table" -> { rows: [{ vlan, mac, port, line }], unread: [line] }
function macRows(seg) {
    const rows = [], unread = [];
    let inTable = false;
    seg.lines.forEach(({ text, line }) => {
        const t = text.trim();
        if (!t) return;
        if (/mac address/i.test(t) && /vlan/i.test(t)) { inTable = true; return; }
        if (/^[-+\s]+$/.test(t) || /^Total Mac Addresses/i.test(t) || /^Legend/i.test(t) || /^\s*(age\b|G -|\(T\)|\* -|primary entry)/i.test(t) || /Mac Address Table/i.test(t)) return;
        if (/^(age -|g -|\(t\) -|\+ -|~ -|vpc|nb)/i.test(t) || /^\s*\S+\s+-\s+/.test(t) && !/[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}/i.test(t)) return;
        const tok = t.split(/\s+/);
        const mi = tok.findIndex((w) => /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(w) || /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(w));
        if (mi < 1) { if (inTable) unread.push(line); return; }
        const vlanTok = tok[mi - 1];
        if (!/^\d+$/.test(vlanTok)) return;   // "All" (the switch's own) and the like
        const mac = C.macText(tok[mi]);
        if (!mac) return;
        const after = tok.slice(mi + 1);
        const port = after[after.length - 1] || '';
        // Several ports (multicast): "Gi1/0/1,Gi1/0/2" or more than one port word.
        const portWords = after.filter((w) => /^[A-Za-z][A-Za-z-]*\d[\d/.:]*,?$/.test(w));
        if (/,/.test(port) || portWords.length > 1) return;
        rows.push({ vlan: Number(vlanTok), mac, port, line });
    });
    return { rows, unread };
}

const isMulticast = (mac) => (parseInt(mac.slice(0, 2), 16) & 1) === 1;

function typeOfCaps(caps, platform) {
    const c = lc(caps);
    if (/phone/.test(c)) return 'voip';
    if (/trans-bridge/.test(c) || /^air-|aironet|\bap\b|access point/i.test(platform)) return 'ap';
    if (/^(cisco\s+)?(ISR|ASR|C8\d{2,3}|C1\d{3}|CISCO\d{4})/i.test(platform)) return 'router';
    if (/router/.test(c) && /switch/.test(c)) return 'l3switch';
    if (/router/.test(c)) return 'router';
    if (/switch/.test(c)) return 'switch';
    if (/host/.test(c)) return 'server';
    return C.typeFromWords(platform) || 'custom';
}

function parse(files, opts = {}) {
    const b = C.builder();
    const warnings = [], notes = [];
    let askName = false;
    const fallbackName = String(opts.switchName || '').trim();
    // Phase 1: what each capture says.
    const devs = new Map();     // key -> { name, type, info, ifaces: Map(key -> long name) }
    const cables = [], macs = [], natives = [];
    const devOf = (name, info = {}) => {
        const key = lc(name);
        let d = devs.get(key);
        if (!d) { d = { name, ifaces: new Map(), info: {} }; devs.set(key, d); }
        Object.keys(info).forEach((k) => { if (info[k] && !d.info[k]) d.info[k] = info[k]; });
        return d;
    };
    const touch = (d, name) => { if (name) d.ifaces.set(ifKey(name), ifName(name)); };
    files.forEach((f) => {
        segments(f.text).forEach((seg) => {
            let host = seg.host;
            const isCdp = seg.lines.some((l) => /Device ID\s*:/.test(l.text));
            const isMac = seg.lines.some((l) => /[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}/i.test(l.text) && !/Device ID/.test(l.text));
            if (!isCdp && !isMac) return;   // a banner, a login line: nothing to name
            if (!host) {
                askName = true;
                host = fallbackName || String(f.name || 'Switch').replace(/\.[^.]+$/, '');
            }
            const local = devOf(host, { type: 'switch', local: true });
            local.info.local = true;
            if (isCdp) {
                cdpEntries(seg).forEach((e) => {
                    if (!e.local) { warnings.push(C.issue('line-unread', { file: f.name, line: e.line })); return; }
                    const type = typeOfCaps(e.caps, e.platform);
                    const model = e.platform.replace(/^cisco\s+/i, '').trim();
                    const vendor = /cisco|^N\dK|^WS-|^C9\d|^AIR-|^ISR|^IP Phone/i.test(e.platform) ? 'Cisco' : '';
                    // A Cisco phone's Device ID is SEP and its MAC.
                    const sep = /^SEP([0-9A-F]{12})$/i.exec(e.id);
                    const nd = devOf(e.name, { type, model, vendor, serial: e.serial, ip: e.ip, mac: sep ? C.macText(sep[1]) : '', fullId: e.id !== e.name ? e.id : '' });
                    touch(local, e.local);
                    touch(nd, e.remote);
                    cables.push({ a: local, ai: ifKey(e.local), z: nd, zi: ifKey(e.remote), infra: ['switch', 'l3switch', 'router', 'ap', 'firewall'].includes(type) });
                    if (e.native && e.native > 1) natives.push({ d: local, i: ifKey(e.local), vlan: e.native });
                });
            }
            if (isMac) {
                const r = macRows(seg);
                r.unread.forEach((line) => warnings.push(C.issue('line-unread', { file: f.name, line })));
                r.rows.forEach((row) => macs.push(Object.assign({ d: local, file: f.name }, row)));
            }
        });
    });

    // Uplinks (D119): a port-channel, a port with a CDP neighbour, a port with
    // more than 3 addresses.
    const perPort = new Map();      // dev key + port key -> rows
    macs.forEach((m) => {
        if (SKIP_PORT.test(m.port) || /^port-channel/i.test(ifName(m.port)) || isMulticast(m.mac)) return;
        const k = lc(m.d.name) + '|' + ifKey(m.port);
        const a = perPort.get(k) || [];
        a.push(m);
        perPort.set(k, a);
    });
    // Only a switch, router or AP behind a port makes it an uplink: a phone
    // with a PC behind it is an access port in two VLANs.
    const cdpPorts = new Set(cables.filter((c) => c.infra).map((c) => lc(c.a.name) + '|' + c.ai));
    const uplinks = [];
    const twoVlans = [];
    const access = [];
    perPort.forEach((rows, k) => {
        const uniq = new Set(rows.map((r) => r.mac));
        if (cdpPorts.has(k) || uniq.size > 3) { uplinks.push(`${rows[0].d.name} ${ifName(rows[0].port)}`); return; }
        const byVlan = new Map();
        rows.forEach((r) => byVlan.set(r.vlan, (byVlan.get(r.vlan) || 0) + 1));
        const vlans = [...byVlan.entries()].sort((a, z) => z[1] - a[1] || a[0] - z[0]);
        const vlan = vlans[0][0];
        const other = vlans.slice(1).map((x) => x[0]);
        if (other.length) twoVlans.push(`${rows[0].d.name} ${ifName(rows[0].port)}`);
        touch(rows[0].d, rows[0].port);
        access.push({ d: rows[0].d, port: ifKey(rows[0].port), vlan, tagged: other, macs: [...uniq] });
    });

    // Phase 2: devices, their port grids, interfaces, cables.
    const nodeOf = new Map();
    devs.forEach((d, key) => {
        const i = d.info;
        const init = { type: i.type || 'switch', name: d.name };
        if (i.model) init.model = i.model;
        if (i.vendor) init.vendor = i.vendor;
        if (i.serial) init.serial = i.serial;
        if (i.fullId) init.notes = `CDP Device ID: ${i.fullId}`;
        const n = b.node({ key: 'cisco:' + key, name: d.name, ip: i.ip, mac: i.mac }, init);
        nodeOf.set(d, n);
        // The grid: the prefix most of its named ports share.
        const ends = new Map();     // iface key -> id
        if (hasPortGrid(n)) {
            const groups = new Map();
            d.ifaces.forEach((long, k) => {
                const m = /^(.*?)(\d+)$/.exec(long);
                if (!m || /^(port-channel|vlan|mgmt)/i.test(long)) return;
                const g = groups.get(m[1]) || [];
                g.push({ k, num: Number(m[2]) });
                groups.set(m[1], g);
            });
            let best = null;
            groups.forEach((g, prefix) => { if (!best || g.length > best.g.length) best = { prefix, g }; });
            if (best) {
                n.portScheme = { prefix: best.prefix, start: 1 };
                best.g.forEach(({ k, num }) => ends.set(k, b.port(n, num)));
            }
        }
        d.ifaces.forEach((long, k) => { if (!ends.has(k)) ends.set(k, b.iface(n, { name: long }).id); });
        if (i.mac) b.iface(n, Object.assign({ mac: i.mac }, n.interfaces.length === 1 ? { id: n.interfaces[0].id } : { name: 'LAN' }));
        if (i.ip) {
            const mgmt = n.interfaces.find((x) => /^(vlan|mgmt)/i.test(x.name)) || b.iface(n, { name: n.type === 'voip' || n.type === 'ap' ? (n.interfaces[0] || {}).name || 'LAN' : 'Management' });
            if (!mgmt.ip) mgmt.ip = b.addr(i.ip);
        }
        d.ends = ends;
    });
    cables.forEach((c) => b.link(nodeOf.get(c.a), c.a.ends.get(c.ai), nodeOf.get(c.z), c.z.ends.get(c.zi), {}));
    const setAttr = (d, k, attr) => {
        const n = nodeOf.get(d), id = d.ends.get(k);
        const m = /^p(\d+)$/.exec(id || '');
        if (m && hasPortGrid(n)) b.port(n, Number(m[1]), attr);
        else {
            const i = n.interfaces.find((x) => x.id === id);
            if (i && attr.vlan && !i.vlan) i.vlan = attr.vlan;
            if (i && attr.tagged) i.tagged = attr.tagged;
        }
    };
    natives.forEach((x) => setAttr(x.d, x.i, { vlan: x.vlan }));
    let clients = 0;
    access.forEach((a) => {
        const sw = nodeOf.get(a.d);
        const attr = {};
        if (a.vlan > 1) attr.vlan = a.vlan;
        if (a.tagged.length) attr.tagged = asVlanList(a.tagged);
        if (Object.keys(attr).length) setAttr(a.d, a.port, attr);
        a.macs.forEach((mac) => {
            let vendor = '';
            if (window.CarinoOUI) { const v = CarinoOUI.lookupVendor(CarinoOUI.normalizeMac(mac)); if (v && v.kind === 'oui') vendor = v.vendor; }
            const init = { type: 'custom', name: `${vendor || 'Device'} ${mac.replace(/:/g, '').slice(-4)}` };
            if (vendor) init.vendor = vendor;
            const n = b.node({ mac }, init);
            const ni = b.iface(n, { mac });
            if (!b.doc.links.some((l) => (l.source === n.id || l.target === n.id))) b.link(sw, a.d.ends.get(a.port), n, ni.id, { medium: 'utp' });
            clients++;
        });
    });
    if (uplinks.length) notes.push(C.issue('uplinks-skipped', null, { n: uplinks.length, list: uplinks.slice(0, 12).join(', ') }));
    if (twoVlans.length) notes.push(C.issue('port-two-vlans', null, { list: twoVlans.slice(0, 12).join(', ') }));
    b.notes(notes);
    const doc = b.finish();
    const locals = [...devs.values()].filter((d) => d.info.local);
    return { doc, warnings, notes, name: locals.length === 1 ? locals[0].name : '', askName, switchName: fallbackName, counts: { macDevices: clients } };
}

const importer = { id: 'cisco', label: 'Cisco CDP / MAC table', family: 'cisco', multi: true, detect, parse };
if (window.TopoImporters) TopoImporters.register(importer);
window.TopoImportCisco = { importer, ifName, segments, cdpEntries, macRows };
})();
