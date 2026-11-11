// ---- Imports from other tools: shared helpers (docs/SCOPE.md step 6, D114-D115) ----
// Pure functions the importers in js/importers/*.js are built on. An importer
// reads files and returns a Topo document; it never touches `state`, the DOM
// (DOMParser is used only as an XML reader) or the network. What it could not
// read comes back as codes ({ code, file, row | line, params }), which
// js/importui.js turns into translated sentences: a parser has no t().
//
// Ids (D115): a record whose source has a stable key keeps it, prefixed with
// the source ('nb-<src>-d12'), so importing the same export again updates
// instead of duplicating. A record with none gets a transient id 'imp-<x>':
// the merge never treats one as an identity and gives it a fresh id when it
// is added (js/merge.js, TRANSIENT_ID_RE), and openImportedAsNew drops the
// prefix. Links name devices and interfaces by id, so an imported document
// cannot simply leave its ids out.
//
// Load order: ... model -> csv -> merge* -> importers/common -> importers/* ->
// netboxexport -> importui -> app.

(function () {
'use strict';

// Never imported (amendment 31): a key or column whose name says it holds a
// password, a pre-shared key or a private key. Counted, and said once.
const SECRET_KEY_RE = /pass|psk|secret|key$|community|x_passphrase|wpa.*key|authentication-key|private/i;
const isSecretKey = (k) => SECRET_KEY_RE.test(String(k || ''));

// A file's bytes as text: UTF-8, UTF-16 with a BOM, else the page language's
// Windows code page (csvDecode, js/csv.js: Excel's CSV).
function decodeText(bytes) {
    if (!bytes) return '';
    return csvDecode(bytes).text;
}
// Whether bytes look like a binary file (a controller backup): NULs or many
// control characters in the first 4 KB.
function looksBinary(bytes) {
    if (!bytes || !bytes.length) return false;
    const n = Math.min(bytes.length, 4096);
    let bad = 0;
    for (let i = 0; i < n; i++) {
        const b = bytes[i];
        if (b === 0) return true;
        if (b < 9 || (b > 13 && b < 32)) bad++;
    }
    return bad / n > 0.05;
}

// JSON, or several JSON values one after another (API pages saved into one
// file), or null.
function parseJsonValues(text) {
    const s = String(text || '').trim();
    if (!s || !'[{'.includes(s[0])) return null;
    try { return [JSON.parse(s)]; } catch (e) { /* maybe several */ }
    const out = [];
    let depth = 0, start = -1, inStr = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
        if (c === '"') { inStr = true; continue; }
        if (c === '{' || c === '[') { if (!depth) start = i; depth++; }
        else if (c === '}' || c === ']') {
            depth--;
            if (depth < 0) return null;
            if (!depth) { try { out.push(JSON.parse(s.slice(start, i + 1))); } catch (e) { return null; } }
        } else if (!depth && !/\s|,/.test(c)) return null;
    }
    return out.length && !depth ? out : null;
}

// A CSV file as { headers, rows: [{ cells, row }] } (row: the 1-based row of
// the file, the header being row 1), or null when it is not one.
function csvTable(text) {
    const p = csvParse(text);
    if (!p.rows.length) return null;
    const headers = p.rows[0].map((h) => String(h).trim());
    if (headers.length < 2) return null;
    return { sep: p.sep, headers, rows: p.rows.slice(1).map((cells, i) => ({ cells, row: i + 2 })) };
}
// A header as a lookup key: lower case, letters and digits only.
const headerKey = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A MAC as the colon form, or '' when it is not one.
function macText(v) {
    const hex = normMac(v);
    return /^[0-9A-F]{12}$/.test(hex) ? hex.match(/.{2}/g).join(':') : '';
}
// An address with its prefix as Topo stores it, or '' (amendment 29: never a
// bare address). `prefix` is used when the text has none.
function cidrText(v, prefix) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (s.includes('/')) return parseValidCIDR(s) ? s : '';
    if (prefix === undefined) return '';
    const t = `${s}/${prefix}`;
    return parseValidCIDR(t) ? t : '';
}

// Transient ids: 'imp-n1', 'imp-i3'... one counter per letter.
function idMaker() {
    const seq = {};
    return (letter) => { seq[letter] = (seq[letter] || 0) + 1; return `imp-${letter}${seq[letter]}`; };
}
// A short, stable tag of a source (a NetBox host, a site), so two instances'
// device 12 stay two devices: FNV-1a 32-bit, 6 base-36 characters.
function sourceTag(text) {
    let h = 0x811c9dc5;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36).padStart(7, '0').slice(-6);
}

// Places the devices that have no position: by group, 12 to a row, an
// uplinked device under the one it is cabled to when that is known. Pure.
function layout(doc) {
    const nodes = doc.nodes || [];
    const free = nodes.filter((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y));
    if (!free.length) return doc;
    const placed = nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
    let top = placed.length ? Math.max(...placed.map((n) => n.y)) + 160 : 120;
    const byGroup = new Map();
    free.forEach((n) => { const k = n.group || ''; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(n); });
    // Infrastructure first in each block, so the switches lead the rows.
    const rank = (n) => (['cloud', 'router', 'firewall', 'edge', 'vpn', 'loadbalancer', 'l3switch', 'switch', 'ap', 'server'].indexOf(n.type) + 1) || 99;
    byGroup.forEach((list) => {
        list.sort((a, b) => rank(a) - rank(b));
        list.forEach((n, i) => { n.x = 120 + (i % 12) * 140; n.y = top + Math.floor(i / 12) * 120; });
        top += (Math.floor((list.length - 1) / 12) + 1) * 120 + 60;
    });
    return doc;
}

// The finished document: the lists that hold something, the version, and a
// position for every device.
function finish(doc) {
    const out = { v: DOC_VERSION };
    ['nodes', 'links', 'networks', 'groups', 'wifi', 'providers', 'columns'].forEach((k) => {
        if (Array.isArray(doc[k]) && (doc[k].length || k === 'nodes' || k === 'links')) out[k] = doc[k];
    });
    if (doc.report) out.report = doc.report;
    return layout(out);
}

// What a document holds, for the "What was understood" step.
function countDoc(doc, extra = {}) {
    const groups = doc.groups || [];
    let ifaces = 0;
    (doc.nodes || []).forEach((n) => { ifaces += (n.interfaces || []).length; });
    const vlans = new Set();
    (doc.networks || []).forEach((n) => { if (n.vlan) vlans.add(n.vlan); });
    return Object.assign({
        devices: (doc.nodes || []).length,
        interfaces: ifaces,
        cables: (doc.links || []).length,
        subnets: (doc.networks || []).length,
        vlans: vlans.size,
        groups: groups.filter((g) => g.kind !== 'rack').length,
        racks: groups.filter((g) => g.kind === 'rack').length,
        wifi: (doc.wifi || []).length,
        providers: (doc.providers || []).length,
        columns: (doc.columns || []).length
    }, extra);
}

// A warning or note, as data.
const issue = (code, where, params) => Object.assign({ code }, where || {}, params ? { params } : {});

// A type from what a source calls it: Topo's key or palette name, then the
// words csvTypeParse knows, then a few more an inventory uses. '' when none.
const TYPE_MORE = [
    [/firewall|fortigate|palo ?alto|asa\b|pfsense|opnsense|sonicwall|utm/i, 'firewall'],
    [/l3 ?switch|core switch|layer ?3|distribution/i, 'l3switch'],
    [/switch/i, 'switch'],
    [/access ?point|\bap\b|wireless|wi-?fi|wlan/i, 'ap'],
    [/router|gateway|edge/i, 'router'],
    [/load ?balancer/i, 'loadbalancer'],
    [/vpn/i, 'vpn'],
    [/hypervisor|server|nas|storage|san\b|host/i, 'server'],
    [/virtual machine|\bvm\b/i, 'vm'],
    [/container|docker|pod\b/i, 'container'],
    [/workstation|desktop|laptop|notebook|\bpc\b|computer|thin client/i, 'pc'],
    [/phone|voip|sip/i, 'voip'],
    [/printer|mfp|copier|plotter/i, 'printer'],
    [/camera|cctv|nvr|dvr/i, 'camera'],
    [/modality|dicom|pacs|x-?ray|ultrasound|\bct\b|\bmri\b/i, 'dicom'],
    [/iot|sensor|tv|display|controller|ups|pdu|plc/i, 'iot'],
    [/cloud|internet|isp/i, 'cloud']
];
function typeFromWords(text) {
    const v = String(text || '').trim();
    if (!v) return '';
    const exact = csvTypeParse(v);
    if (!exact.error) return exact.value;
    const hit = TYPE_MORE.find(([re]) => re.test(v));
    return hit ? hit[1] : '';
}

// A group's kind from its name, in the five languages (D116).
function groupKindFromWords(text) {
    const v = String(text || '').toLowerCase();
    if (/floor|planta|piso|andar|этаж|階/.test(v)) return 'floor';
    if (/building|edificio|bloco|pr[eé]dio|здание|корпус|棟|ビル/.test(v)) return 'building';
    if (/rack|gabinete|bastidor|стойк|ラック/.test(v)) return 'rack';
    return '';
}

// A cable colour as words: a hex colour to the nearest common name.
const COLOR_NAMES = [['black', [0, 0, 0]], ['white', [255, 255, 255]], ['grey', [128, 128, 128]], ['red', [220, 30, 30]],
    ['orange', [255, 140, 0]], ['yellow', [240, 220, 0]], ['green', [30, 160, 60]], ['blue', [30, 90, 220]],
    ['purple', [130, 50, 180]], ['pink', [240, 130, 180]], ['brown', [130, 80, 30]], ['aqua', [0, 200, 210]]];
function colorName(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return String(hex || '').trim();
    const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    let best = '', d = Infinity;
    COLOR_NAMES.forEach(([name, c]) => {
        const e = c.reduce((s, x, i) => s + (x - rgb[i]) ** 2, 0);
        if (e < d) { d = e; best = name; }
    });
    return best;
}
const COLOR_HEX = Object.fromEntries(COLOR_NAMES.map(([n, c]) => [n, c.map((x) => x.toString(16).padStart(2, '0')).join('')]));
Object.assign(COLOR_HEX, { gray: COLOR_HEX.grey, violet: COLOR_HEX.purple, cyan: COLOR_HEX.aqua, azul: COLOR_HEX.blue, rojo: COLOR_HEX.red,
    verde: COLOR_HEX.green, amarillo: COLOR_HEX.yellow, naranja: COLOR_HEX.orange, blanco: COLOR_HEX.white, negro: COLOR_HEX.black, gris: COLOR_HEX.grey });
// A colour's hex for a tool that wants one ('' when the words name none).
const colorHex = (text) => COLOR_HEX[String(text || '').trim().toLowerCase()] || (/^#?[0-9a-f]{6}$/i.test(String(text || '').trim()) ? String(text).trim().replace('#', '').toLowerCase() : '');

// ---- A document builder for the inventory and discovery formats ----
// nmap, UniFi, Omada, MikroTik, Cisco, Lansweeper and phpIPAM all say the
// same few things: a device (found again by its source key, MAC, address or
// name), an interface on it, a numbered switch port, a cable between two
// ends, a subnet, a Wi-Fi network, a custom column. One device seen in two
// files (a MAC table and a CDP capture, a UniFi device list and its clients)
// stays one device. Pure, like the parsers that use it.
const isIp = (s) => typeof s === 'string' && (ipaddr.IPv4.isValidFourPartDecimal(s) || ipaddr.IPv6.isValid(s));
const lcKey = (s) => String(s == null ? '' : s).trim().toLowerCase();
function builder() {
    const doc = { nodes: [], links: [], networks: [], groups: [], wifi: [], providers: [], columns: [] };
    const tid = idMaker();
    const byKey = new Map(), byMac = new Map(), byIp = new Map(), byName = new Map();
    const netParsed = new Map();
    const parts = {};       // part key -> Set of node ids (wireless clients, leases...)
    const fallback = new Set();   // addresses written as /32 for want of a subnet
    const stats = { noPrefix: 0, secrets: 0 };
    const b = { doc, tid, stats, parts };

    // An address or a name is a weak match: it never joins a record that
    // carries its own source key or MAC to a device that has a different
    // one (two PCs that had the same address, two phones both called
    // "iPhone" with different MACs stay two devices).
    const clashes = (n, q, mac) => (q.key && n._key && n._key !== q.key)
        || (mac && !q.key && n.interfaces.some((i) => i.mac) && !n.interfaces.some((i) => i.mac === mac));
    b.findNode = (q) => {
        if (!q) return null;
        if (q.key && byKey.has(q.key)) return byKey.get(q.key);
        const mac = macText(q.mac);
        if (mac && byMac.has(mac)) return byMac.get(mac);
        const ip = q.ip ? String(q.ip).split('/')[0] : '';
        if (ip && byIp.has(ip) && !clashes(byIp.get(ip), q, mac)) return byIp.get(ip);
        if (q.name && byName.has(lcKey(q.name)) && !clashes(byName.get(lcKey(q.name)), q, mac)) return byName.get(lcKey(q.name));
        return null;
    };
    const indexNode = (n, q) => {
        if (q.key && !n._key) n._key = q.key;
        if (q.key && !byKey.has(q.key)) byKey.set(q.key, n);
        if (n.name && !byName.has(lcKey(n.name))) byName.set(lcKey(n.name), n);
    };
    // A device: found again, or made. `q` says how to find it ({ key, mac, ip,
    // name }), `init` what a new one is ({ id, type, name, ... }). Fields of
    // `init` fill only what the device does not say yet.
    b.node = (q, init = {}) => {
        let n = b.findNode(q);
        if (!n) {
            n = Object.assign({ id: tid('n'), type: 'custom', name: '' }, init, { interfaces: [] });
            if (!n.name) { n.name = q.name || q.ip || macText(q.mac) || 'Device'; n._autoName = n.name; }
            doc.nodes.push(n);
        } else {
            Object.keys(init).forEach((k) => {
                if (k === 'id' || k === 'interfaces') return;
                if (k === 'type') { if ((!n.type || n.type === 'custom' || n.type === 'pc') && init.type && init.type !== 'custom') n.type = init.type; return; }
                if (k === 'name') { if (!n.name || n.name === n._autoName) { n.name = init.name; } return; }
                if (n[k] === undefined || n[k] === '') n[k] = init[k];
            });
        }
        indexNode(n, q);
        return n;
    };
    // An interface of a device, found by name (or MAC, or address), else
    // made. A MAC or an address is indexed so the device is found by it.
    b.iface = (n, f = {}) => {
        const list = n.interfaces;
        const mac = macText(f.mac);
        const ipBare = f.ip ? String(f.ip).split('/')[0] : '';
        let i = (f.id && list.find((x) => x.id === f.id))
            || (f.name && list.find((x) => lcKey(x.name) === lcKey(f.name)))
            || (mac && list.find((x) => x.mac === mac))
            || (ipBare && list.find((x) => x.ip && x.ip.split('/')[0] === ipBare))
            || (!f.name && !f.id && f.ip && list.find((x) => !x.ip && !x.wireless === !f.wireless))
            || null;
        if (!i) {
            i = { id: f.id || tid('i'), name: f.name || '' };
            list.push(i);
        } else if (f.name && !i.name) i.name = f.name;
        if (mac && !i.mac) i.mac = mac;
        if (f.ip && !i.ip) i.ip = f.ip;
        if (f.wireless) i.wireless = true;
        if (f.vlan && !i.wireless && !i.vlan) i.vlan = f.vlan;
        if (f.tagged && !i.wireless && !i.tagged) i.tagged = f.tagged;
        if (f.bond) i.bond = f.bond;
        if (i.mac && !byMac.has(i.mac)) byMac.set(i.mac, n);
        if (i.ip) { const bare = i.ip.split('/')[0]; if (!byIp.has(bare)) byIp.set(bare, n); }
        return i;
    };
    // Port N of a switch's or an AP's grid ('pN'), growing the grid to hold it.
    b.port = (n, num, attr) => {
        const k = Math.floor(Number(num));
        if (!(k >= 1 && k <= 9999)) return null;
        if (!n.portCount || n.portCount < k) n.portCount = k;
        const pid = `p${k}`;
        if (attr) {
            const clean = {};
            Object.keys(attr).forEach((a) => { if (attr[a] !== undefined && attr[a] !== '' && attr[a] !== null) clean[a] = attr[a]; });
            if (Object.keys(clean).length) n.portAttrs = Object.assign({}, n.portAttrs, { [pid]: Object.assign({}, (n.portAttrs || {})[pid], clean) });
        }
        return pid;
    };
    // A cable or a wireless association. One per pair of ends: the same
    // cable seen from both of its switches (CDP on each) is one.
    b.link = (a, ai, z, zi, extra = {}) => {
        if (!a || !z || a === z) return null;
        const same = (l) => (l.source === a.id && l.target === z.id && (l.sourceIface || null) === (ai || null) && (l.targetIface || null) === (zi || null))
            || (l.source === z.id && l.target === a.id && (l.sourceIface || null) === (zi || null) && (l.targetIface || null) === (ai || null));
        let l = doc.links.find(same);
        if (!l && (ai || zi) && extra.medium !== 'wireless') {
            // An end already cabled is not cabled again (one cable per port).
            const busy = (n, i) => i && doc.links.some((x) => (x.source === n.id && x.sourceIface === i) || (x.target === n.id && x.targetIface === i));
            if (busy(a, ai) || busy(z, zi)) return null;
        }
        if (!l) {
            l = Object.assign({ id: extra.id || tid('l'), source: a.id, target: z.id, sourceIface: ai || null, targetIface: zi || null }, extra);
            if (!l.id) l.id = tid('l');
            doc.links.push(l);
        }
        return l;
    };
    // A subnet, by its network address (a host address is masked).
    b.network = (cidr, fields = {}) => {
        const p = parseValidCIDR(String(cidr || '').trim());
        if (!p) return null;
        const key = p.networkStr;
        let net = doc.networks.find((x) => x.cidr === key);
        if (!net) {
            net = { id: fields.id || tid('net'), cidr: key };
            doc.networks.push(net);
            netParsed.set(net, p);
        }
        Object.keys(fields).forEach((k) => { if (k !== 'id' && fields[k] !== undefined && fields[k] !== '' && net[k] === undefined) net[k] = fields[k]; });
        return net;
    };
    // The narrowest known subnet an address falls in.
    b.netOf = (ip) => {
        let addr;
        try { addr = ipaddr.parse(String(ip).split('/')[0]); } catch (e) { return null; }
        let best = null;
        doc.networks.forEach((net) => {
            const p = netParsed.get(net) || parseValidCIDR(net.cidr);
            if (p && addr.kind() === p.kind && addr.match(p.cidrObj) && (!best || p.prefix > best.p.prefix)) best = { net, p };
        });
        return best;
    };
    // An address as Topo stores it (amendment 29): its own prefix, else the
    // prefix of the subnet it falls in, else /32 (/128), counted for a note.
    b.addr = (text, prefix) => {
        const s = String(text == null ? '' : text).trim();
        if (!s) return '';
        if (s.includes('/')) return parseValidCIDR(s) ? s : '';
        if (!isIp(s)) return '';
        if (prefix !== undefined && prefix !== '' && parseValidCIDR(`${s}/${prefix}`)) return `${s}/${prefix}`;
        const hit = b.netOf(s);
        if (hit) return `${s}/${hit.p.prefix}`;
        const out = `${s}/${s.includes(':') ? 128 : 32}`;
        fallback.add(out);
        return out;
    };
    // Addresses written before their subnet was known get its prefix now.
    b.fixPrefixes = () => {
        doc.nodes.forEach((n) => n.interfaces.forEach((i) => {
            if (!i.ip || !fallback.has(i.ip)) return;
            const bare = i.ip.split('/')[0];
            const hit = b.netOf(bare);
            if (hit) i.ip = `${bare}/${hit.p.prefix}`;
        }));
    };
    b.wifi = (ssid, fields = {}) => {
        const s = String(ssid || '').trim();
        if (!s) return null;
        let w = doc.wifi.find((x) => x.ssid === s);
        if (!w) { w = { id: fields.id || tid('wf'), ssid: s }; doc.wifi.push(w); }
        Object.keys(fields).forEach((k) => { if (k !== 'id' && fields[k] !== undefined && fields[k] !== '' && w[k] === undefined) w[k] = fields[k]; });
        return w;
    };
    const colByName = new Map();
    b.column = (name, kind = 'text') => {
        const k = lcKey(name);
        if (colByName.has(k)) return colByName.get(k);
        if (doc.columns.length >= CUSTOM_MAX) return null;
        const col = { id: tid('c'), name: customName(name), kind };
        doc.columns.push(col);
        colByName.set(k, col);
        return col;
    };
    b.extra = (n, colName, value, kind) => {
        if (value === undefined || value === null || value === '') return;
        const col = b.column(colName, kind);
        if (!col) return;
        n.extra = Object.assign({}, n.extra, { [col.id]: typeof value === 'string' ? value.slice(0, CUSTOM_TEXT_MAX) : value });
    };
    const groupByPath = new Map();
    // A group by its path of names ("HQ / Floor 2"), each level made once.
    b.group = (path, kinds = []) => {
        const names = (Array.isArray(path) ? path : String(path || '').split(/\s*\/\s*/)).map((x) => String(x || '').trim()).filter(Boolean);
        let parent = null, key = '';
        names.forEach((name, depth) => {
            key += '/' + lcKey(name);
            let g = groupByPath.get(key);
            if (!g) {
                g = { id: tid('g'), name: name.slice(0, 120), kind: groupKindFromWords(name) || kinds[depth] || (depth === 0 && names.length > 1 ? 'building' : depth === 1 && names.length > 2 ? 'floor' : 'room') };
                if (parent) g.parent = parent.id;
                doc.groups.push(g);
                groupByPath.set(key, g);
            }
            parent = g;
        });
        return parent;
    };
    // Marks a device as part of something the user may leave out.
    b.part = (key, n) => { (parts[key] = parts[key] || new Set()).add(n.id); };
    // ...and takes it out again when a stronger source (a neighbour, a cable)
    // shows it is part of the network itself.
    b.unpart = (key, n) => { if (parts[key]) parts[key].delete(n.id); };
    b.notes = (notes) => {
        b.fixPrefixes();
        stats.noPrefix = 0;
        doc.nodes.forEach((n) => n.interfaces.forEach((i) => { if (i.ip && fallback.has(i.ip)) stats.noPrefix++; }));
        if (stats.noPrefix) notes.push(issue('no-prefix', null, { n: stats.noPrefix }));
        if (stats.secrets) notes.push(issue('secrets', null, { n: stats.secrets }));
        return notes;
    };
    // The finished document, and the parts as lists of ids.
    b.finish = () => {
        doc.nodes.forEach((n) => {
            delete n._autoName;
            delete n._key;
            if (!n.interfaces.length) delete n.interfaces;
        });
        doc.nodes.forEach((n) => { if (!n.interfaces) n.interfaces = []; });
        return finish(doc);
    };
    b.partList = () => Object.keys(parts).map((key) => ({ key, ids: [...parts[key]] }));
    return b;
}

// What is left of a document without some of its devices: they, their
// cables and nothing else. Pure.
function withoutNodes(doc, ids) {
    const drop = ids instanceof Set ? ids : new Set(ids);
    if (!drop.size) return doc;
    const out = Object.assign({}, doc);
    out.nodes = (doc.nodes || []).filter((n) => !drop.has(n.id));
    out.links = (doc.links || []).filter((l) => !drop.has(l.source) && !drop.has(l.target));
    return out;
}

// A date read from a column whose order is decided over the whole column
// (amendment 34): ISO always; d/m/y or m/d/y only when some value settles it
// (a first part over 12 is day-first, a second part over 12 month-first).
// -> { order: 'iso' | 'dmy' | 'mdy' | 'ambiguous', read(v) -> 'YYYY-MM-DD' | '' }
function dateColumn(values) {
    let dmy = false, mdy = false, any = false;
    values.forEach((v) => {
        const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(String(v || '').trim());
        if (!m) return;
        any = true;
        if (+m[1] > 12) dmy = true;
        if (+m[2] > 12) mdy = true;
    });
    const order = !any ? 'iso' : dmy && !mdy ? 'dmy' : mdy && !dmy ? 'mdy' : 'ambiguous';
    const pad = (x) => String(x).padStart(2, '0');
    const read = (v) => {
        const s = String(v == null ? '' : v).trim();
        const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
        if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
        const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
        if (!m || (order !== 'dmy' && order !== 'mdy')) return '';
        const [d, mo] = order === 'dmy' ? [m[1], m[2]] : [m[2], m[1]];
        const y = m[3].length === 2 ? '20' + m[3] : m[3];
        if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return '';
        return `${y}-${pad(mo)}-${pad(d)}`;
    };
    return { order, read };
}

// A CSV read through a header alias table: { rows: [{ get(key), row }], keys,
// unread, secrets }. `aliases` maps headerKey(header) to a field name.
function aliasedTable(text, aliases) {
    const tbl = csvTable(text);
    if (!tbl) return null;
    const keys = tbl.headers.map((h) => (isSecretKey(h) && !aliases[headerKey(h)] ? '#secret' : aliases[headerKey(h)] || ''));
    let secrets = 0;
    const rows = tbl.rows.filter((r) => r.cells.some((c) => String(c).trim() !== '')).map((r) => {
        const o = {};
        keys.forEach((k, i) => {
            const v = String(r.cells[i] == null ? '' : r.cells[i]).trim();
            if (!k || !v) return;
            if (k === '#secret') { secrets++; return; }
            if (o[k] === undefined) o[k] = v;
        });
        return { o, row: r.row };
    });
    return { rows, keys: new Set(keys.filter(Boolean)), unread: tbl.headers.filter((h, i) => !keys[i] && h.trim()), secrets, headers: tbl.headers };
}

// A dotted mask as a prefix length (255.255.255.0 -> 24), a plain number as
// itself, or undefined.
function maskBits(mask) {
    const s = String(mask == null ? '' : mask).trim().replace(/^\//, '');
    if (/^\d{1,3}$/.test(s)) return Number(s) <= 128 ? Number(s) : undefined;
    const p = s.split('.').map(Number);
    if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) return undefined;
    const bits = p.map((x) => x.toString(2).padStart(8, '0')).join('');
    if (!/^1*0*$/.test(bits)) return undefined;
    return bits.indexOf('0') < 0 ? 32 : bits.indexOf('0');
}

window.TopoImportCommon = {
    SECRET_KEY_RE, isSecretKey, decodeText, looksBinary, parseJsonValues, csvTable, headerKey, macText, cidrText,
    idMaker, sourceTag, layout, finish, countDoc, issue, typeFromWords, groupKindFromWords, colorName, colorHex,
    isIp, builder, withoutNodes, dateColumn, aliasedTable, maskBits
};
})();
