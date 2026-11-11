// ---- Lansweeper asset CSV to Topo (docs/SCOPE.md step 6, D114) ----
// An asset list exported from Lansweeper (Classic reports or Sites): each
// asset is a device with its name, type (from the asset type and OS words),
// address, MAC, maker, model, serial, OS and version, description as notes,
// where it is (Building and Location as nested groups, or a location text),
// state (Active is active; Non-active, Stock, Broken and the like retired;
// Planned or Ordered planned; anything but Active also kept in a "Lansweeper
// state" column), purchase date as "In service since" and warranty end as a
// date column. Dates written the local way (31/12/2026, 12/31/2026) are read
// once the column settles the order; a column that never does is left empty
// and said (amendment 34). Assets keep their AssetID ('ls-<src>-<id>'), so
// importing again updates them. No cables: an inventory does not say them.

(function () {
'use strict';
const C = window.TopoImportCommon;
const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();

// Header words of Lansweeper Classic and Sites exports.
const ALIAS = {
    assetname: 'name', name: 'name', computername: 'name', assettype: 'type', type: 'type', assettypename: 'type', ipaddress: 'ip', ip: 'ip', mac: 'mac', macaddress: 'mac',
    manufacturer: 'vendor', make: 'vendor', model: 'model', serialnumber: 'serial', serial: 'serial', serialno: 'serial', os: 'os', osname: 'os', operatingsystem: 'os',
    osversion: 'osVersion', version: 'osVersion', description: 'description', comments: 'description', location: 'location', building: 'building',
    department: 'department', branchoffice: 'branch', state: 'state', assetstate: 'state', status: 'state', purchasedate: 'purchase', purchased: 'purchase',
    warrantydate: 'warranty', warrantyenddate: 'warranty', warrantyend: 'warranty', warrantyexpirationdate: 'warranty', assetid: 'id', assetkey: 'id', id: 'id',
    lastseen: 'lastSeen', site: 'site', sitename: 'site', domain: 'domain', fqdn: 'fqdn', barcode: 'assetTag', assettag: 'assetTag', custom1: 'custom1'
};
const MARKS = ['assetname', 'assettype', 'assetid', 'assetkey', 'lastseen', 'osname', 'serialnumber', 'warrantydate', 'branchoffice', 'assettypename'];

function detect(file) {
    if (C.parseJsonValues(file.text)) return 0;
    const first = String(file.text || '').split(/\r?\n/)[0] || '';
    if (!/[,;\t]/.test(first)) return 0;
    const tbl = C.csvTable(String(file.text).split(/\r?\n/).slice(0, 3).join('\n'));
    if (!tbl) return 0;
    const hk = tbl.headers.map(C.headerKey);
    const marks = MARKS.filter((m) => hk.includes(m)).length;
    if (/lansweeper/i.test(file.name || '') && (hk.includes('assetname') || hk.includes('name'))) return 0.92;
    if (hk.includes('assetname') && (hk.includes('assettype') || hk.includes('assetid'))) return 0.9;
    return marks >= 3 ? 0.7 : 0;
}

// An asset type, with its OS, as a Topo type.
function typeOf(type, os) {
    const t = lc(type), o = lc(os);
    if (/vmware guest|hyper-?v guest|virtual machine|\bvm\b/.test(t)) return 'vm';
    if (/windows|apple mac|macos|chromebook|workstation|laptop|desktop/.test(t)) return /server/.test(o) || /server/.test(t) ? 'server' : 'pc';
    if (/^linux|unix|esxi|vmware|nas|san\b/.test(t)) return 'server';
    if (/ip phone|voip/.test(t)) return 'voip';
    if (/monitor|mobile|smartphone|tablet|ups|tv/.test(t)) return /ups/.test(t) ? 'iot' : 'custom';
    return C.typeFromWords(type) || (/server/.test(o) ? 'server' : /windows|mac os|macos/.test(o) ? 'pc' : 'custom');
}
const STATE = { active: 'active', 'non-active': 'retired', nonactive: 'retired', inactive: 'retired', stock: 'retired', 'in stock': 'retired', broken: 'retired',
    sold: 'retired', stolen: 'retired', old: 'retired', retired: 'retired', disposed: 'retired', 'in repair': 'active', planned: 'planned', ordered: 'planned' };

function parse(files) {
    const b = C.builder();
    const warnings = [], notes = [];
    let secrets = 0;
    const unread = new Set();
    files.forEach((f) => {
        const tbl = C.aliasedTable(f.text, ALIAS);
        if (!tbl || !tbl.keys.has('name')) { warnings.push(C.issue('file-unknown', { file: f.name })); return; }
        secrets += tbl.secrets;
        tbl.unread.forEach((h) => unread.add(h));
        const dates = {};
        ['purchase', 'warranty', 'lastSeen'].forEach((k) => {
            dates[k] = C.dateColumn(tbl.rows.map((r) => r.o[k]).filter(Boolean));
            if (dates[k].order === 'ambiguous') notes.push(C.issue('dates-ambiguous', { file: f.name }, { column: tbl.headers[tbl.headers.findIndex((h) => ALIAS[C.headerKey(h)] === k)] || k }));
        });
        tbl.rows.forEach(({ o, row }) => {
            const w = { file: f.name, row };
            if (!o.name) { warnings.push(C.issue('row-no-name', w)); return; }
            const src = C.sourceTag(lc(o.site) || 'lansweeper');
            const ips = String(o.ip || '').split(/[\s,;]+/).filter((x) => C.isIp(x));
            const macs = String(o.mac || '').split(/[\s,;]+/).map(C.macText).filter(Boolean);
            if (o.ip && !ips.length) warnings.push(C.issue('ip-bad', w, { address: o.ip }));
            const init = { id: o.id && /^[\w-]+$/.test(o.id) ? `ls-${src}-${o.id}` : undefined, type: typeOf(o.type, o.os), name: o.name };
            if (o.vendor) init.vendor = o.vendor;
            if (o.model) init.model = o.model;
            if (o.serial && !/^(to be filled|default string|none$|n\/a$|0+$)/i.test(o.serial)) init.serial = o.serial.slice(0, 120);
            if (o.assetTag) init.assetTag = o.assetTag.slice(0, 120);
            const os = [o.os, o.osVersion && !String(o.os || '').includes(o.osVersion) ? o.osVersion : ''].filter(Boolean).join(' ');
            if (os) init.os = os;
            if (o.description) init.notes = o.description;
            const st = STATE[lc(o.state)];
            if (st) init.status = st;
            const bought = dates.purchase.read(o.purchase);
            if (bought) init.inService = bought;
            if (!init.id) delete init.id;
            const n = b.node({ key: init.id, mac: macs[0], ip: ips[0], name: o.name }, init);
            if (o.state && lc(o.state) !== 'active') b.extra(n, 'Lansweeper state', o.state);
            const warr = dates.warranty.read(o.warranty);
            if (warr) b.extra(n, 'Warranty', warr, 'date');
            const seen = dates.lastSeen.read(o.lastSeen);
            if (seen) b.extra(n, 'Last seen', seen, 'date');
            if (o.department) b.extra(n, 'Department', o.department);
            // Where it is.
            const loc = String(o.location || '').trim();
            const path = [o.branch, o.building].filter(Boolean);
            if (loc && /\s\/\s|\\/.test(loc)) path.push(...loc.split(/\s*[/\\]\s*/));
            else if (loc && path.length) path.push(loc);
            else if (loc) n.location = loc;
            if (path.length && !n.group) { const g = b.group(path); if (g) n.group = g.id; }
            const count = Math.max(ips.length, macs.length, 1);
            for (let i = 0; i < count; i++) {
                if (!ips[i] && !macs[i]) continue;
                b.iface(n, { mac: macs[i], ip: ips[i] ? b.addr(ips[i]) : undefined });
            }
        });
    });
    if (unread.size) notes.push(C.issue('columns-not-read', null, { list: [...unread].slice(0, 12).join(', ') }));
    b.stats.secrets += secrets;
    b.notes(notes);
    return { doc: b.finish(), warnings, notes, name: '' };
}

const importer = { id: 'lansweeper', label: 'Lansweeper', family: 'lansweeper', multi: true, detect, parse };
if (window.TopoImporters) TopoImporters.register(importer);
window.TopoImportLansweeper = { importer, typeOf };
})();
