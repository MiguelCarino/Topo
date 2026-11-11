// ---- Imports from other tools: the registry and the format detection (D114) ----
// Each importer registers { id, label, family, detect(file) -> 0..1,
// parse(files, opts) -> { doc, counts, warnings, notes, name } }. A file is
// { name, bytes (Uint8Array), text }. detect() scores one file; the best score
// over 0.5 wins, a tie or nothing asks (the manual picker in js/importui.js).
//
// Before any importer, Topo's own files keep their doors (amendment 35): a
// Topo .json (a network, a binder, a server backup) goes to Open a file, and
// one of Topo's own spreadsheets to the Spreadsheet dialog. Controller
// backups (UniFi .unf, Omada .cfg) are locked binary files and are refused
// with a sentence (D118).

(function () {
'use strict';
const C = window.TopoImportCommon;
const importers = [];

function register(imp) {
    if (!imp || !imp.id || importers.some((x) => x.id === imp.id)) return;
    importers.push(imp);
}
const list = () => importers.slice();
const get = (id) => importers.find((x) => x.id === id) || null;

// Topo's own spreadsheet columns that no other tool writes.
const TOPO_CSV_HEADERS = ['interface_id', 'first_port', 'allowed_ports', 'port_count', 'rack_u', 'from_device', 'to_device', 'cable_id', 'network_id', 'wifi_id', 'from_port', 'to_port', 'draw_zone', 'runs_on', 'service_every_months'];

// Whether a header row is one of Topo's own sheets (js/csv.js CSV_SHEETS):
// two columns no other tool writes, or most of one sheet's columns.
function isTopoSheet(headers) {
    const hs = headers.map((h) => String(h).trim().toLowerCase());
    if (TOPO_CSV_HEADERS.filter((h) => hs.includes(h)).length >= 2) return true;
    let sheets = [];
    try { sheets = (typeof CSV_SHEETS !== 'undefined' ? CSV_SHEETS : []).map((s) => s.build().headers.map((h) => String(h).toLowerCase())); } catch (e) { sheets = []; }
    return sheets.some((H) => {
        const common = hs.filter((h) => H.includes(h)).length;
        return common >= Math.min(3, H.length) && common / hs.length >= 0.6 && common / H.length >= 0.6;
    });
}

// A file as { name, bytes, text }, from a File (async).
async function readFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { name: file.name || '', bytes, text: C.looksBinary(bytes) ? '' : C.decodeText(bytes) };
}

// One file -> { kind: 'topo' | 'topo-csv' | 'refused' | 'import' | 'unknown',
// importer, score, reason, parsed }.
function sniff(file) {
    const name = String(file.name || '').toLowerCase();
    if (/\.unf$/.test(name)) return { kind: 'refused', reason: 'unifi-backup' };
    if (/\.cfg$/.test(name) && (C.looksBinary(file.bytes) || !file.text)) return { kind: 'refused', reason: 'omada-backup' };
    if (C.looksBinary(file.bytes)) return { kind: 'unknown', reason: 'binary' };
    const values = C.parseJsonValues(file.text);
    if (values && values.length === 1) {
        const p = values[0];
        const topo = (typeof isBackupFile === 'function' && isBackupFile(p)) || binderFromImported(p) || (p && !Array.isArray(p) && Array.isArray(p.nodes) && docFromImported(p))
            || (p && p.kind === 'nettopology' && docFromImported(p));
        if (topo) return { kind: 'topo', parsed: p };
    }
    if (!values) {
        const tbl = /^[^\r\n]*[,;\t]/.test(file.text) ? C.csvTable(file.text) : null;
        if (tbl && isTopoSheet(tbl.headers)) return { kind: 'topo-csv' };
    }
    let best = null, tie = false;
    importers.forEach((imp) => {
        let s = 0;
        try { s = Number(imp.detect(file)) || 0; } catch (e) { s = 0; }
        if (s <= 0.5) return;
        if (!best || s > best.score) { best = { importer: imp.id, score: s }; tie = false; } else if (s === best.score) tie = true;
    });
    if (best && !tie) return { kind: 'import', importer: best.importer, score: best.score };
    return { kind: 'unknown', reason: tie ? 'tie' : 'none' };
}

// The files of one importer parsed together (a NetBox set cross-references
// its files). -> the importer's result, with counts filled in.
function parse(id, files, opts = {}) {
    const imp = get(id);
    if (!imp) throw new Error('no importer ' + id);
    const res = imp.parse(files, opts) || {};
    res.importer = id;
    res.warnings = res.warnings || [];
    res.notes = res.notes || [];
    res.extraCounts = res.counts || {};
    res.full = res.doc || { nodes: [], links: [] };
    // Passing devices the user may leave out (amendment 36): wireless
    // clients and DHCP leases start left out, wired clients kept.
    res.parts = (res.parts || []).filter((p) => p.ids && p.ids.length).map((p) => Object.assign({ on: PART_DEFAULT[p.key] !== false }, p));
    return applyParts(res);
}
const PART_DEFAULT = { wired: true, wireless: false, leases: false };
// The document with the parts that are off left out, and its counts.
function applyParts(res) {
    const off = new Set();
    (res.parts || []).forEach((p) => { if (!p.on) p.ids.forEach((id) => off.add(id)); });
    res.doc = C.withoutNodes(res.full, off);
    res.counts = Object.assign(C.countDoc(res.doc), res.extraCounts || {});
    return res;
}

// What reaches a network that is opened as its own: transient ids lose their
// prefix (they are unique inside the document by construction). Only the
// ids themselves and the fields that refer to them change: a value is
// renamed when it is exactly one of the document's own transient ids and it
// is not in a field of words (a device called "imp-cons" keeps its name).
const TEXT_KEYS = new Set(['name', 'notes', 'label', 'comment', 'description', 'hostname', 'model', 'vendor', 'os', 'title', 'text', 'serial',
    'assetTag', 'location', 'ssid', 'owner', 'contact', 'email', 'phone', 'site', 'room', 'building', 'domain', 'dns', 'gateway', 'ip', 'mac', 'value', 'url']);
function withoutTransientIds(doc) {
    const ids = new Set();
    const collect = (v) => {
        if (Array.isArray(v)) { v.forEach(collect); return; }
        if (!v || typeof v !== 'object') return;
        Object.keys(v).forEach((k) => {
            if (k === 'id' && typeof v[k] === 'string' && v[k].startsWith('imp-') && v[k].length > 4) ids.add(v[k]);
            else collect(v[k]);
        });
    };
    collect(doc);
    const map = (x) => (typeof x === 'string' && ids.has(x) ? x.slice(4) : x);
    const walk = (v, key) => {
        if (Array.isArray(v)) return v.map((x) => walk(x, key));
        if (v && typeof v === 'object') {
            const out = {};
            // A custom column's values are keyed by its id (node.x[columnId]).
            Object.keys(v).forEach((k) => { out[map(k)] = walk(v[k], k); });
            return out;
        }
        return TEXT_KEYS.has(key) ? v : map(v);
    };
    return walk(JSON.parse(JSON.stringify(doc)), '');
}

window.TopoImporters = { register, list, get, sniff, parse, applyParts, readFile, withoutTransientIds, TOPO_CSV_HEADERS, PART_DEFAULT };
})();
