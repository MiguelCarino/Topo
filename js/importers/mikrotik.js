// ---- MikroTik /export to Topo (docs/SCOPE.md step 6, D114, amendment 33) ----
// One RouterOS configuration export (v6 or v7, terse or verbose) is one
// device: its name (/system identity), model, RouterOS version and serial
// from the header comments, and what the configuration says about the
// network around it:
//   - interfaces: ethernet (renamed ones keep their default name as the
//     match), bridges, VLAN interfaces (the VLAN carried tagged by their
//     parent), bonds with their members, wireless (v6 /interface wireless,
//     v7 /interface wifi) and the SSIDs they broadcast;
//   - a CRS or CSS switch's etherN ports are its port grid, with the bridge
//     port's PVID as the access VLAN and /interface bridge vlan's tagged
//     lists; a router's are interfaces with the same VLANs;
//   - /ip address on its interfaces; /ip dhcp-server network and /ip pool
//     as subnets with gateway, DNS and DHCP range;
//   - /ip dhcp-server lease as client devices, not cabled (they start left
//     out: amendment 36);
//   - the output of "/ip neighbor print detail" pasted into the same file:
//     the neighbours, cabled from the interface they were seen on.
// Passwords, pre-shared keys and secrets (v6 exports show them unless
// hide-sensitive was used) are never read. Sections it does not read are
// counted and named in a note; a line it cannot read is listed.

(function () {
'use strict';
const C = window.TopoImportCommon;
const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();

function detect(file) {
    const s = String(file.text || '').slice(0, 6000);
    if (/^#.*\bby RouterOS\b/m.test(s)) return 0.98;
    const hits = (s.match(/^\/(interface|ip|system|routing|tool|queue|user)\b/gm) || []).length;
    if (hits >= 2) return 0.9;
    if (/^\s*\d+\s+(?:[A-Z]+\s+)?interface=\S+.*\bmac-address=/m.test(s) && /identity=/.test(s)) return 0.85;
    return 0;
}

// Lines joined across "\" + newline (and the indentation after it).
function logicalLines(text) {
    const raw = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let cur = null, start = 0;
    raw.forEach((line, i) => {
        if (cur !== null) cur += line.replace(/^\s+/, '');
        else { cur = line; start = i + 1; }
        const m = /(\\+)$/.exec(cur);
        if (m && m[1].length % 2 === 1) { cur = cur.slice(0, -1); return; }
        out.push({ text: cur, line: start });
        cur = null;
    });
    if (cur !== null) out.push({ text: cur, line: start });
    return out;
}
// Words, with quotes and escapes (\" \\ \_ for a space, \XX bytes of
// UTF-8: "Dise\C3\B1o" is "Diseño") and [ find ... ] kept as one { find } word.
function hexRun(s, i) {
    const bytes = [];
    let j = i;
    while (j + 2 < s.length && s[j] === '\\' && /^[0-9A-F]{2}$/.test(s.slice(j + 1, j + 3))) { bytes.push(parseInt(s.slice(j + 1, j + 3), 16)); j += 3; }
    if (!bytes.length) return null;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); }
    catch (e) { text = String.fromCharCode(...bytes); }
    return { text, next: j };
}
function words(s) {
    const out = [];
    let i = 0;
    const esc = (c) => (c === '_' ? ' ' : c === 'n' ? '\n' : c === 't' ? '\t' : c);
    while (i < s.length) {
        if (/\s/.test(s[i])) { i++; continue; }
        if (s[i] === '[') {
            let depth = 0, j = i;
            for (; j < s.length; j++) { if (s[j] === '[') depth++; else if (s[j] === ']') { depth--; if (!depth) break; } }
            out.push({ find: s.slice(i + 1, j).trim() });
            i = j + 1;
            continue;
        }
        let w = '';
        while (i < s.length && !/\s/.test(s[i])) {
            if (s[i] === '"') {
                i++;
                while (i < s.length && s[i] !== '"') {
                    const hx = s[i] === '\\' ? hexRun(s, i) : null;
                    if (hx) { w += hx.text; i = hx.next; continue; }
                    if (s[i] === '\\' && i + 1 < s.length) { w += esc(s[i + 1]); i += 2; continue; }
                    w += s[i++];
                }
                i++;
                continue;
            }
            const hx = s[i] === '\\' ? hexRun(s, i) : null;
            if (hx) { w += hx.text; i = hx.next; continue; }
            if (s[i] === '\\' && i + 1 < s.length) { w += esc(s[i + 1]); i += 2; continue; }
            w += s[i++];
        }
        out.push(w);
    }
    return out;
}
// key=value words as an object (the first '=' splits).
function kv(list) {
    const o = {};
    list.forEach((w) => {
        if (typeof w !== 'string') return;
        const k = w.indexOf('=');
        if (k > 0) o[w.slice(0, k)] = w.slice(k + 1);
    });
    return o;
}
const VERBS = new Set(['add', 'set', 'remove', 'unset', 'enable', 'disable', 'print', 'edit', 'move', 'reset', 'comment']);
// The export as commands: { path, verb, args, find, target, line }.
function commands(text) {
    const out = [], unread = [];
    let path = '';
    logicalLines(text).forEach(({ text: raw, line }) => {
        const s = raw.trim();
        if (!s || s[0] === '#' || s[0] === ':') return;
        let ws = words(s);
        if (typeof ws[0] === 'string' && ws[0][0] === '/') {
            const p = [ws[0].slice(1)];
            let k = 1;
            while (k < ws.length && typeof ws[k] === 'string' && !ws[k].includes('=') && !VERBS.has(ws[k])) p.push(ws[k++]);
            path = p.join(' ').replace(/\//g, ' ').trim().replace(/\s+/g, ' ');
            ws = ws.slice(k);
            if (!ws.length) return;
        }
        const verb = typeof ws[0] === 'string' && VERBS.has(ws[0]) ? ws[0] : '';
        if (!verb) { unread.push(line); return; }
        if (verb === 'print') return;
        const rest = ws.slice(1);
        const findW = rest.find((w) => typeof w === 'object');
        const target = rest.find((w) => typeof w === 'string' && !w.includes('='));
        out.push({ path, verb, args: kv(rest), find: findW ? kv(words(findW.find.replace(/^find\s*(where\s*)?/, ''))) : null, target: target || '', line });
    });
    return { list: out, unread };
}
// "/ip neighbor print detail" output: numbered entries of key=value words.
function neighbours(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const used = new Set();
    let cur = null;
    lines.forEach((l, i) => {
        const m = /^\s*(\d+)\s+(?:[A-Z]+\s+)?(\S+=.*)$/.exec(l);
        if (m && /\binterface=/.test(m[2])) { cur = { line: i + 1, text: m[2] }; out.push(cur); used.add(i + 1); return; }
        if (cur && /^\s{2,}\S+=/.test(l) && !/^\s*\//.test(l)) { cur.text += ' ' + l.trim(); used.add(i + 1); return; }
        cur = null;
    });
    return { list: out.map((n) => Object.assign(kv(words(n.text)), { _line: n.line })), used };
}
// "10,20,100-110" -> [10, 20, 100, ..., 110], capped at 4094.
function vlanIds(text) {
    const out = [];
    String(text || '').split(',').forEach((part) => {
        const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
        if (!m) return;
        const a = Number(m[1]), z = Math.min(m[2] ? Number(m[2]) : a, 4094);
        for (let v = a; v <= z && out.length < 4094; v++) if (v >= 1) out.push(v);
    });
    return out;
}
const KNOWN = ['system identity', 'interface ethernet', 'interface bridge', 'interface bridge port', 'interface bridge vlan', 'interface vlan', 'interface bonding',
    'interface wireless', 'interface wifi', 'interface wireless security-profiles', 'interface wifi security', 'interface wifi configuration',
    'ip address', 'ip pool', 'ip dhcp-server', 'ip dhcp-server network', 'ip dhcp-server lease'];

function parseOne(b, f, warnings, notes, counters) {
    const text = String(f.text || '');
    const head = {};
    text.split(/\r?\n/).slice(0, 12).forEach((l) => {
        let m = /^#.*\bby RouterOS\s+(\S+)/.exec(l); if (m) head.version = m[1];
        m = /^#\s*model\s*=\s*(.+)$/.exec(l); if (m) head.model = m[1].trim();
        m = /^#\s*serial number\s*=\s*(.+)$/.exec(l); if (m) head.serial = m[1].trim();
    });
    const nb = neighbours(text);
    const { list, unread } = commands(text);
    unread.filter((line) => !nb.used.has(line)).forEach((line) => warnings.push(C.issue('line-unread', { file: f.name, line })));
    const sec = (p) => list.filter((c) => c.path === p);
    const notRead = new Map();
    list.forEach((c) => {
        // A section that is all secret (SNMP communities, PPP and user
        // accounts) counts once; elsewhere every secret key does.
        if (/community|ppp secret|^user$|user aaa/.test(c.path)) { if (c.verb === 'add' || c.verb === 'set') counters.secrets++; }
        else Object.keys(c.args).forEach((k) => { if (C.isSecretKey(k) && c.args[k] !== '') counters.secrets++; });
        if (!KNOWN.includes(c.path)) notRead.set(c.path, (notRead.get(c.path) || 0) + 1);
    });
    const identity = (sec('system identity').map((c) => c.args.name).filter(Boolean).pop()) || '';
    const model = head.model || '';
    const isSwitch = /^(CRS|CSS)/i.test(model);
    const init = { type: isSwitch ? 'switch' : 'router', name: identity || String(f.name || '').replace(/\.[^.]+$/, ''), vendor: 'MikroTik' };
    if (model) init.model = model;
    if (head.version) init.os = `RouterOS ${head.version}`;
    if (head.serial) init.serial = head.serial;
    const dev = b.node({ key: identity ? 'mt:' + lc(identity) : 'mt-file:' + f.name, name: identity }, init);

    // Interfaces by their current name; ethernet renames by default-name.
    const byName = new Map();
    const disabled = (a) => /^(yes|true)$/i.test(a.disabled || '');
    const eth = new Map();       // current name -> { def, args }
    const ethDefaults = new Set();
    sec('interface ethernet').forEach((c) => {
        const def = (c.find && (c.find['default-name'] || c.find.name)) || c.args['default-name'] || c.target || c.args.name;
        if (!def) return;
        ethDefaults.add(def);
        const name = c.args.name || def;
        eth.set(name, Object.assign({ def }, eth.get(def) || {}, c.args));
        if (name !== def) eth.delete(def);
        if (disabled(c.args)) counters.disabled++;
    });
    // Every name an ethernet port goes by in the rest of the export.
    const ethNames = () => [...eth.keys()];
    const grid = isSwitch;
    const portOf = (name) => {
        const e = eth.get(name);
        const def = e ? e.def : name;
        const m = /^ether(\d+)$/.exec(def);
        return grid && m ? Number(m[1]) : 0;
    };
    const ifaceOf = (name, extra = {}) => {
        if (!name) return null;
        if (byName.has(name)) return byName.get(name);
        const n = portOf(name);
        let ref;
        if (n) {
            if (!dev.portScheme) dev.portScheme = { prefix: 'ether', start: 1 };
            ref = { port: n, id: b.port(dev, n) };
        } else ref = { iface: b.iface(dev, Object.assign({ name }, extra)) };
        ref.id = ref.id || ref.iface.id;
        byName.set(name, ref);
        return ref;
    };
    const setPortAttr = (ref, attr) => {
        if (!ref) return;
        if (ref.port) b.port(dev, ref.port, attr);
        else {
            if (attr.label && !ref.iface.name) ref.iface.name = attr.label;
            if (attr.vlan && !ref.iface.vlan && !ref.iface.wireless) ref.iface.vlan = attr.vlan;
            if (attr.tagged && !ref.iface.wireless) ref.iface.tagged = attr.tagged;
        }
    };
    ethNames().forEach((name) => {
        const e = eth.get(name);
        const ref = ifaceOf(name);
        const mac = C.macText(e['mac-address'] || e['orig-mac-address']);
        if (ref.port) {
            const label = e.comment || (name !== e.def ? name : '');
            b.port(dev, ref.port, { label: label || undefined });
            if (mac) b.iface(dev, { id: ref.id, name, mac });
        } else if (mac) b.iface(dev, { name, mac });
    });
    // A switch's grid covers the ports its model has, at least the highest named.
    sec('interface bridge').forEach((c) => { if (c.args.name) ifaceOf(c.args.name); if (disabled(c.args)) counters.disabled++; });
    sec('interface bonding').forEach((c) => {
        if (!c.args.name) return;
        // A member that is a numbered port is kept as an interface on that port.
        const members = String(c.args.slaves || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
            const r = ifaceOf(s);
            if (r && r.port) b.iface(dev, { id: r.id, name: s });
            return r ? r.id : null;
        }).filter(Boolean);
        const ref = ifaceOf(c.args.name);
        if (ref.iface && members.length) ref.iface.bond = { mode: /802\.3ad|lacp/i.test(c.args.mode || '') ? '802.3ad' : c.args.mode === 'active-backup' ? 'active-backup' : '802.3ad', members };
    });
    const tagged = new Map();   // interface name -> Set of vids
    const addTagged = (name, vid) => { if (!name || !vid) return; const s = tagged.get(name) || new Set(); s.add(vid); tagged.set(name, s); };
    const vlanOfIface = new Map();
    sec('interface vlan').forEach((c) => {
        const vid = asVlan(Number(c.args['vlan-id']));
        if (!c.args.name) return;
        const ref = ifaceOf(c.args.name);
        if (vid) { vlanOfIface.set(c.args.name, vid); if (ref.iface) ref.iface.vlan = vid; addTagged(c.args.interface, vid); }
        if (disabled(c.args)) counters.disabled++;
    });
    const bridgeVlans = sec('interface bridge vlan');
    sec('interface bridge port').forEach((c) => {
        const name = c.args.interface;
        if (!name || /^(all|dynamic)$/.test(name)) return;
        const ref = ifaceOf(name);
        const pvid = asVlan(Number(c.args.pvid));
        if (pvid && pvid > 1) setPortAttr(ref, { vlan: pvid });
        if (disabled(c.args)) counters.disabled++;
    });
    bridgeVlans.forEach((c) => {
        const vids = vlanIds(c.args['vlan-ids']);
        String(c.args.tagged || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((name) => vids.forEach((v) => addTagged(name, v)));
        String(c.args.untagged || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((name) => {
            if (vids.length === 1 && vids[0] > 1) {
                const ref = ifaceOf(name);
                const cur = ref.port ? ((dev.portAttrs || {})[ref.id] || {}).vlan : ref.iface && ref.iface.vlan;
                if (!cur) setPortAttr(ref, { vlan: vids[0] });
            }
        });
    });
    tagged.forEach((set, name) => {
        const ref = ifaceOf(name);
        setPortAttr(ref, { tagged: asVlanList([...set].sort((a, z) => a - z)) });
    });

    // Wireless (v6 and v7) and its SSIDs.
    const profiles = new Map();
    sec('interface wireless security-profiles').forEach((c) => { if (c.args.name) profiles.set(c.args.name, c.args); });
    const secOf = (p) => {
        const t = lc((p && p['authentication-types']) || '');
        if (!t || lc(p && p.mode) === 'none') return p ? 'open' : '';
        if (/wpa3/.test(t) && /wpa2/.test(t)) return 'wpa2/3';
        if (/wpa3/.test(t)) return /eap/.test(t) ? 'wpa3-ent' : 'wpa3';
        if (/eap/.test(t)) return 'wpa2-ent';
        if (/wpa2/.test(t)) return 'wpa2';
        if (/wpa/.test(t)) return 'wpa';
        return '';
    };
    const wifiSec = new Map();
    sec('interface wifi security').forEach((c) => { if (c.args.name) wifiSec.set(c.args.name, c.args); });
    const wifiConf = new Map();
    sec('interface wifi configuration').forEach((c) => { if (c.args.name) wifiConf.set(c.args.name, c.args); });
    sec('interface wireless').concat(sec('interface wifi')).forEach((c) => {
        if (c.path === 'interface wireless security-profiles') return;
        const def = (c.find && (c.find['default-name'] || c.find.name)) || c.args['default-name'] || c.target;
        const name = c.args.name || def;
        if (!name) return;
        const ref = ifaceOf(name, { wireless: true });
        if (ref.iface) ref.iface.wireless = true;
        const conf = wifiConf.get(c.args.configuration) || {};
        const ssid = c.args.ssid || c.args['configuration.ssid'] || conf.ssid;
        const mode = lc(c.args.mode || c.args['configuration.mode'] || conf.mode || 'ap');
        if (ssid && /ap|bridge/.test(mode) && !/station/.test(mode)) {
            let security = '';
            if (c.path === 'interface wireless') security = secOf(profiles.get(c.args['security-profile'] || 'default'));
            else {
                const s = wifiSec.get(c.args.security || conf.security) || {};
                const t = lc(c.args['security.authentication-types'] || s['authentication-types']);
                security = !t ? '' : /wpa3/.test(t) && /wpa2/.test(t) ? 'wpa2/3' : /wpa3/.test(t) ? 'wpa3' : /eap/.test(t) ? 'wpa2-ent' : /wpa2/.test(t) ? 'wpa2' : '';
            }
            const bandText = lc(c.args.band || c.args['channel.band'] || '');
            const band = /2ghz/.test(bandText) ? '2.4' : /5ghz/.test(bandText) ? '5' : /6ghz/.test(bandText) ? '6' : '';
            const w = b.wifi(ssid, { security: security || undefined, hidden: /^yes$/i.test(c.args['hide-ssid'] || c.args['configuration.hide-ssid'] || '') ? true : undefined });
            if (w && band) w.bands = asWifiBands((wifiBandList(w.bands || []) || []).concat([band])) || w.bands;
        }
        if (disabled(c.args)) counters.disabled++;
    });

    // Addresses and subnets.
    sec('ip address').forEach((c) => {
        const a = c.args.address;
        const p = parseValidCIDR(String(a || ''));
        if (!p) { if (a) warnings.push(C.issue('ip-bad', { file: f.name, line: c.line }, { address: a })); return; }
        const ref = ifaceOf(c.args.interface);
        const vid = vlanOfIface.get(c.args.interface);
        b.network(a, { vlan: vid || undefined, name: c.args.comment && c.args.comment !== 'defconf' ? c.args.comment : undefined });
        if (!ref) return;
        if (ref.port) {
            const i = b.iface(dev, { id: ref.id, name: c.args.interface });
            if (!i.ip) i.ip = a;
        } else if (!ref.iface.ip) ref.iface.ip = a;
        else warnings.push(C.issue('ip-extra', { file: f.name, line: c.line }, { address: a }));
        if (disabled(c.args)) counters.disabled++;
    });
    const pools = new Map();
    sec('ip pool').forEach((c) => { if (c.args.name) pools.set(c.args.name, String(c.args.ranges || '').split(',')[0]); });
    const servers = sec('ip dhcp-server').filter((c) => c.args.name || c.args.interface);
    sec('ip dhcp-server network').forEach((c) => {
        const net = b.network(c.args.address, {});
        if (!net) return;
        net.dhcp = true;
        if (c.args.gateway && C.isIp(c.args.gateway)) net.gateway = c.args.gateway;
        const dns = String(c.args['dns-server'] || '').split(',').filter((x) => C.isIp(x.trim())).join(', ');
        if (dns) net.dns = dns;
        if (c.args.comment && c.args.comment !== 'defconf' && !net.name) net.name = c.args.comment;
        // The pool of the server on the interface whose address is in it.
        servers.forEach((s) => {
            const range = pools.get(s.args['address-pool']);
            const ref = byName.get(s.args.interface);
            const ip = ref && (ref.iface ? ref.iface.ip : (dev.interfaces.find((i) => i.id === ref.id) || {}).ip);
            const hit = ip && b.netOf(ip);
            if (range && hit && hit.net === net) {
                const [first, last] = range.split('-').map((x) => x.trim());
                if (C.isIp(first) && C.isIp(last || '')) { net.dhcpFirst = first; net.dhcpLast = last; }
            }
        });
    });
    // Leases: clients, not cabled.
    sec('ip dhcp-server lease').forEach((c) => {
        const mac = C.macText(c.args['mac-address']);
        const ip = c.args.address && C.isIp(c.args.address) ? c.args.address : '';
        if (!mac && !ip) { warnings.push(C.issue('no-address', { file: f.name, line: c.line })); return; }
        const name = c.args.comment || c.args['host-name'] || '';
        let vendor = '';
        if (mac && window.CarinoOUI) { const v = CarinoOUI.lookupVendor(CarinoOUI.normalizeMac(mac)); if (v && v.kind === 'oui') vendor = v.vendor; }
        const init = { type: C.typeFromWords(name) || 'custom', name: name || `${vendor || 'Client'} ${(mac || ip).slice(-5).replace(':', '')}` };
        if (init.type === 'cloud' || init.type === 'router') init.type = 'custom';
        if (vendor) init.vendor = vendor;
        const n = b.node({ mac, ip, name }, init);
        b.iface(n, { mac, ip: ip ? b.addr(ip) : undefined });
        b.part('leases', n);
        counters.leases++;
    });
    // Neighbours seen on an interface: devices, cabled to it.
    nb.list.forEach((x) => {
        const mac = C.macText(x['mac-address']);
        const ident = x.identity || '';
        if (!mac && !ident) return;
        const caps = lc(x['system-caps-enabled'] || x['system-caps'] || '');
        const board = x.board || '';
        let type = /CRS|CSS/i.test(board) ? 'switch' : C.typeFromWords(`${board} ${x.platform || ''}`);
        if (!type || type === 'cloud') type = /router/.test(caps) ? 'router' : /bridge/.test(caps) ? 'switch' : /wlan|access/.test(caps) ? 'ap' : /telephone/.test(caps) ? 'voip' : 'custom';
        const init = { type, name: ident };
        if (x.platform) init.vendor = x.platform === 'MikroTik' ? 'MikroTik' : x.platform;
        if (board) init.model = board;
        if (x.version) init.os = (x.platform === 'MikroTik' ? 'RouterOS ' : '') + String(x.version).replace(/\s*\(.*\)$/, '');
        const addr = String(x.address || x.address4 || '').split(',')[0].trim();
        const n = b.node({ key: ident ? 'mt:' + lc(ident) : undefined, mac, ip: addr, name: ident }, init);
        b.unpart('leases', n);   // a neighbour is part of the network, even when it also had a lease
        const their = x['interface-name'] || '';
        const ni = b.iface(n, { name: their || undefined, mac, ip: C.isIp(addr) ? b.addr(addr) : undefined });
        const localName = String(x.interface || '').split(',')[0].trim();
        const ref = ifaceOf(localName);
        if (ref) b.link(dev, ref.id, n, ni.id, {});
        counters.neighbours++;
    });
    if (notRead.size) notes.push(C.issue('sections-not-read', { file: f.name }, { list: [...notRead.keys()].slice(0, 12).map((p) => '/' + p).join(', ') }));
}

function parse(files) {
    const b = C.builder();
    const warnings = [], notes = [];
    const counters = { secrets: 0, disabled: 0, leases: 0, neighbours: 0 };
    files.forEach((f) => parseOne(b, f, warnings, notes, counters));
    if (counters.disabled) notes.push(C.issue('iface-disabled', null, { n: counters.disabled }));
    b.stats.secrets += counters.secrets;
    b.notes(notes);
    const doc = b.finish();
    return { doc, warnings, notes, name: files.length === 1 && doc.nodes[0] ? doc.nodes[0].name : '', parts: b.partList(), counts: { leases: counters.leases } };
}

const importer = { id: 'mikrotik', label: 'MikroTik /export', family: 'mikrotik', multi: true, detect, parse };
if (window.TopoImporters) TopoImporters.register(importer);
window.TopoImportMikrotik = { importer, logicalLines, words, commands, neighbours, vlanIds };
})();
