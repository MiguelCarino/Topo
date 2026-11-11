// ---- Import… : files from other tools, through the merge (docs/SCOPE.md step 6, D114) ----
// One entry for every format the importers in js/importers/*.js read:
//   1. Choose files (several at once: an export is often a set). Each file
//      shows the format it was read as, with a "Not right?" picker; a Topo
//      file or spreadsheet is sent to its own door; a locked controller
//      backup is refused with a sentence.
//   2. What was understood: counts, what could not be read (the first 50,
//      then "and N more"), notes, and where it goes: merged into the open
//      network, merged into another, or opened as its own network.
//   3. Continue: the merge review (mergeCopyInto) as a copy of a network, so
//      everything is reviewed, a restore point is taken first, the log says
//      where it came from and it is one undo step. Importing never deletes.
// The parsers return codes; the sentences are here, translated.

(function () {
'use strict';
const el = (id) => document.getElementById(id);
const esc = (s) => escapeHtml(String(s == null ? '' : s));
const WARN_SHOWN = 50;

const WARN_TEXT = {
    'file-unknown': '{file}: not a format Topo reads.',
    'bad-json': '{file}: not valid JSON.',
    'row-no-name': '{where}: no name, left out.',
    'iface-no-device': '{where}: interface "{name}" names no device in these files, left out.',
    'device-ambiguous': '{where}: several devices are called "{name}" (one per site) and this row does not say which, left out.',
    'ip-unassigned': '{where}: {address} is on no interface, so it was skipped (Topo keeps addresses on interfaces).',
    'ip-extra': '{where}: {address} is a second address on its interface, skipped.',
    'ip-bad': '{where}: "{address}" is not an address.',
    'prefix-bad': '{where}: "{prefix}" is not a subnet.',
    'cable-end': '{where}: a cable end names a device or interface not in these files, left out.',
    'cable-not-iface': '{where}: a cable to something that is not an interface ({kind}), left out.',
    'rack-width': '{where}: a 21-inch rack is drawn as a 19-inch one.',
    'no-address': '{where}: no address, left out.',
    'line-unread': '{where}: not understood, left out.',
    'bad-xml': '{file}: not a readable nmap XML file.',
    'host-no-address': '{file}: host {n} has no address, left out.',
    'api-error': '{file}: the export holds an error from the controller ({msg}).',
    'uplink-unknown': '{where}: "{name}" is uplinked to a device not in these files, so that cable was left out.',
    'no-mac': '{where}: no MAC address, left out.'
};
const NOTE_TEXT = {
    'vlan-no-subnet': 'VLAN {vid} has no subnet: it stays on its ports.',
    'vm-no-host': '"{name}": its cluster "{cluster}" has no single device, so it runs on no host.',
    'iface-disabled': '{n} interfaces are turned off at the source; they are imported as they are.',
    'secrets': '{n} passwords and keys were left out.',
    'columns-max': '{n} custom fields were left out: a network holds at most 40 columns.',
    'not-read': 'Not read: {n} records of type {type}.',
    'columns-not-read': 'Columns not read: {list}.',
    'no-prefix': '{n} addresses had no subnet; written as /32.',
    'hosts-down': '{n} hosts that were down in the scan were left out.',
    'sections-not-read': '{file}: sections not read: {list}.',
    'uplinks-skipped': '{n} ports look like uplinks (more than 3 addresses, a port-channel or a CDP neighbour), so their addresses were left out: {list}.',
    'port-two-vlans': 'Ports seen in two VLANs take the VLAN with more addresses; the other is carried tagged: {list}.',
    'dates-ambiguous': '{file}: the dates in "{column}" could be day-first or month-first, so they were left empty.'
};
const PART_LABELS = { wired: 'Clients (wired)', wireless: 'Clients (wireless)', leases: 'DHCP leases' };
const REFUSED_TEXT = {
    'unifi-backup': 'A UniFi controller backup (.unf) is a locked file Topo cannot read. Export the devices and clients from the controller instead.',
    'omada-backup': 'An Omada controller backup (.cfg) is a locked file Topo cannot read. Export the device and client lists instead.',
    binary: 'Not a file Topo can read.'
};
const COUNT_LABELS = [['devices', 'Devices'], ['interfaces', 'Interfaces'], ['cables', 'Cables'], ['subnets', 'Subnets'], ['vlans', 'VLANs'], ['groups', 'Groups'],
    ['racks', 'Racks'], ['wifi', 'Wi-Fi networks'], ['providers', 'Providers'], ['columns', 'Custom columns']];

// The sentence of a warning or note.
function issueText(x) {
    const p = Object.assign({}, x.params || {});
    if (x.row !== undefined) p.where = t('{file}, row {row}', { file: x.file || '', row: x.row });
    else if (x.line !== undefined) p.where = t('{file}, line {line}', { file: x.file || '', line: x.line });
    if (x.file !== undefined && p.file === undefined) p.file = x.file;
    const key = WARN_TEXT[x.code] || NOTE_TEXT[x.code];
    return key ? t(key, p) : `${x.code}`;
}

let _imp = null;   // { files: [{ file, sniff, choice }], step, results, target }

function scrim() { return el('importDialog'); }
function openDialog() {
    const s = scrim();
    if (!s) return;
    if (window.CarinoUI) { if (!CarinoUI.modal.isOpen(s)) CarinoUI.modal.open(s, { onClose: () => { _imp = null; } }); } else s.hidden = false;
}
function closeImportDialog() {
    const s = scrim();
    if (!s) return;
    if (window.CarinoUI && CarinoUI.modal.isOpen(s)) CarinoUI.modal.close(s, 'answered');
    else s.hidden = true;
    _imp = null;
}
// Import… : the dialog, empty, or with files already chosen (File objects or
// { name, text } / { name, bytes } for tests).
async function openImport(files) {
    _imp = { files: [], step: 1, results: null, target: '' };
    openDialog();
    render();
    if (files && files.length) await addFiles(files);
}
async function addFiles(files) {
    if (!_imp) _imp = { files: [], step: 1, results: null, target: '' };
    for (const f of files) {
        let file;
        if (typeof File !== 'undefined' && f instanceof Blob) file = await TopoImporters.readFile(f);
        else file = { name: f.name || '', bytes: f.bytes || new TextEncoder().encode(f.text || ''), text: f.text !== undefined ? f.text : TopoImportCommon.decodeText(f.bytes) };
        file.blob = (typeof Blob !== 'undefined' && f instanceof Blob) ? f : null;
        // A zip (Topo's own NetBox export, a set saved together): its files.
        if (/\.zip$/i.test(file.name) && window.TopoNetbox && TopoNetbox.unzip) {
            const inner = await TopoNetbox.unzip(file.bytes).catch(() => null);
            if (inner && inner.length) {
                inner.filter((x) => !/readme/i.test(x.name)).forEach((x) => {
                    const g = { name: x.name, bytes: x.bytes, text: TopoImportCommon.looksBinary(x.bytes) ? '' : TopoImportCommon.decodeText(x.bytes) };
                    const sn = TopoImporters.sniff(g);
                    _imp.files.push({ file: g, sniff: sn, choice: sn.kind === 'import' ? sn.importer : '' });
                });
                continue;
            }
        }
        const sn = TopoImporters.sniff(file);
        _imp.files.push({ file, sniff: sn, choice: sn.kind === 'import' ? sn.importer : '' });
    }
    _imp.step = 1; _imp.results = null;
    render();
}

const importerLabel = (id) => { const imp = TopoImporters.get(id); return imp ? imp.label : id; };

function renderFiles() {
    const imps = TopoImporters.list();
    const rows = _imp.files.map((f, i) => {
        const sn = f.sniff;
        let status = '', control = '';
        if (sn.kind === 'topo') { status = t('A Topo file: it opens as a network.'); control = `<button type="button" class="btn" data-imp-open="${i}">${esc(t('Open it'))}</button>`; }
        else if (sn.kind === 'topo-csv') { status = t('A Topo spreadsheet: it opens in Spreadsheet.'); control = `<button type="button" class="btn" data-imp-csv="${i}">${esc(t('Open in Spreadsheet'))}</button>`; }
        else if (sn.kind === 'refused') status = t(REFUSED_TEXT[sn.reason] || REFUSED_TEXT.binary);
        else {
            status = sn.kind === 'import' ? t('Read as {format}', { format: importerLabel(sn.importer) }) : t('Not recognised: pick its format.');
            const opts = [`<option value="">${esc(t('Leave it out'))}</option>`].concat(imps.map((x) => `<option value="${esc(x.id)}"${f.choice === x.id ? ' selected' : ''}>${esc(x.label)}</option>`));
            control = `<label class="imp-pick"><span>${esc(t('Not right?'))}</span><select class="select" data-imp-choice="${i}" aria-label="${esc(t('Format of {file}', { file: f.file.name }))}">${opts.join('')}</select></label>`;
        }
        return `<li class="imp-file${sn.kind === 'refused' ? ' refused' : ''}"><div class="imp-file-name mono">${esc(f.file.name)}</div>
            <div class="imp-file-status">${esc(status)}</div>${control}</li>`;
    });
    return `<p class="ask-msg">${esc(t('Files exported from NetBox and other network tools. Choose several at once when an export is a set of files.'))}</p>
        <p class="ask-msg imp-never">${esc(t('Importing adds and updates; it never deletes.'))}</p>
        <div id="importDrop" class="imp-drop"><button type="button" id="importChooseBtn" class="btn">${esc(t('Choose files…'))}</button>
        <span class="imp-drop-hint">${esc(t('or drop them here'))}</span></div>
        ${rows.length ? `<ul class="imp-files">${rows.join('')}</ul>` : ''}`;
}

function renderUnderstood() {
    const parts = _imp.results.map((res) => {
        const c = res.counts || {};
        const counts = COUNT_LABELS.filter(([k]) => c[k]).map(([k, label]) => `<div class="imp-count"><b>${esc(c[k])}</b> <span>${esc(t(label))}</span></div>`);
        const warns = res.warnings || [];
        const shown = warns.slice(0, WARN_SHOWN).map((w) => `<li>${esc(issueText(w))}</li>`);
        const more = warns.length > WARN_SHOWN ? `<li class="imp-more">${esc(t('and {n} more', { n: warns.length - WARN_SHOWN }))}</li>` : '';
        const notes = (res.notes || []).map((n) => `<li>${esc(issueText(n))}</li>`);
        const ri = _imp.results.indexOf(res);
        const ticks = (res.parts || []).map((p) => `<label class="check imp-part"><input type="checkbox" data-imp-part="${ri}:${esc(p.key)}"${p.on ? ' checked' : ''}> <span>${esc(t(PART_LABELS[p.key] || p.key))} (${p.ids.length})</span></label>`);
        const ask = res.askName ? `<label class="imp-ask"><span class="prop-lbl">${esc(t('This switch\'s name'))}</span><input type="text" class="input" data-imp-name="${ri}" value="${esc(res.switchName || '')}" autocomplete="off" placeholder="${esc(t('As its prompt shows it'))}"></label>` : '';
        return `<section class="imp-res" data-imp-res="${esc(res.importer)}"><h3 class="imp-res-head">${esc(importerLabel(res.importer))}
            <span class="imp-res-files">${esc(res.files.join(', '))}</span></h3>
            ${counts.length ? `<div class="imp-counts">${counts.join('')}</div>` : `<p class="ask-msg">${esc(t('Nothing was understood in these files.'))}</p>`}
            ${warns.length ? `<p class="imp-warn-head">${esc(t('Not read: {n}', { n: warns.length }))}</p><ul class="imp-warns">${shown.join('')}${more}</ul>` : ''}
            ${notes.length ? `<ul class="imp-notes">${notes.join('')}</ul>` : ''}
            ${ticks.length ? `<fieldset class="imp-parts"><legend class="prop-lbl">${esc(t('Include'))}</legend>${ticks.join('')}</fieldset>` : ''}${ask}</section>`;
    });
    const here = isKept() && !state.readOnly && state.libraryId && libraryEntry(state.libraryId);
    const target = _imp.target || (here ? 'here' : 'new');
    _imp.target = target;
    const opt = (id, label) => `<label class="check imp-target"><input type="radio" name="impTarget" value="${id}"${target === id ? ' checked' : ''}> <span>${esc(label)}</span></label>`;
    const targets = [here ? opt('here', t('Merge into "{name}"', { name: here.name })) : '', opt('other', t('Merge into another network…')), opt('new', t('Open as its own network'))].join('');
    return parts.join('') + `<fieldset class="imp-targets"><legend class="prop-lbl">${esc(t('Where it goes'))}</legend>${targets}</fieldset>
        <p class="ask-msg imp-never">${esc(t('The merge shows every change before anything is kept. Importing adds and updates; it never deletes.'))}</p>`;
}

function render() {
    const body = el('importBody');
    if (!body || !_imp) return;
    body.innerHTML = _imp.step === 2 && _imp.results ? renderUnderstood() : renderFiles();
    const next = el('importNextBtn'), back = el('importBackBtn');
    const usable = _imp.files.some((f) => f.choice);
    if (_imp.step === 2) {
        next.textContent = t('Continue');
        next.disabled = !_imp.results.some((r) => (r.doc.nodes || []).length || (r.doc.networks || []).length || (r.doc.groups || []).length);
        back.classList.remove('hidden');
    } else {
        next.textContent = t('Read the files');
        next.disabled = !usable;
        back.classList.add('hidden');
    }
    const choose = el('importChooseBtn');
    if (choose) choose.onclick = () => { const inp = el('importAnyInput'); inp.value = ''; inp.click(); };
    const drop = el('importDrop');
    if (drop) {
        drop.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        drop.addEventListener('drop', (e) => { e.preventDefault(); const fl = e.dataTransfer.files; if (fl && fl.length) addFiles([...fl]); });
    }
    body.querySelectorAll('[data-imp-choice]').forEach((s) => s.addEventListener('change', () => { _imp.files[Number(s.dataset.impChoice)].choice = s.value; render(); }));
    body.querySelectorAll('[data-imp-open]').forEach((b) => b.addEventListener('click', () => {
        const f = _imp.files[Number(b.dataset.impOpen)];
        closeImportDialog();
        applyImportedDoc(f.sniff.parsed, { fileName: f.file.name });
    }));
    body.querySelectorAll('[data-imp-csv]').forEach((b) => b.addEventListener('click', () => {
        const f = _imp.files[Number(b.dataset.impCsv)];
        closeImportDialog();
        openCsvDialog('import');
        csvLoadFile(f.file.blob || new File([f.file.bytes], f.file.name, { type: 'text/csv' }));
    }));
    body.querySelectorAll('[data-imp-part]').forEach((c) => c.addEventListener('change', () => {
        const [ri, key] = c.dataset.impPart.split(':');
        const res = _imp.results[Number(ri)];
        const part = res && (res.parts || []).find((p) => p.key === key);
        if (!part) return;
        part.on = c.checked;
        TopoImporters.applyParts(res);
        render();
    }));
    body.querySelectorAll('[data-imp-name]').forEach((inp) => inp.addEventListener('change', () => {
        const ri = Number(inp.dataset.impName);
        const old = _imp.results[ri];
        const files = _imp.files.filter((f) => f.choice === old.importer).map((f) => f.file);
        const res = parseFamily(old.importer, files, { switchName: inp.value.trim() });
        (res.parts || []).forEach((p) => { const was = (old.parts || []).find((x) => x.key === p.key); if (was) p.on = was.on; });
        TopoImporters.applyParts(res);
        _imp.results[ri] = res;
        render();
    }));
    body.querySelectorAll('input[name="impTarget"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) _imp.target = r.value; }));
}

// One importer's files parsed together; a parser that throws is said.
function parseFamily(id, files, opts) {
    let res;
    try { res = TopoImporters.parse(id, files, opts); } catch (e) {
        console.warn('import failed', e);
        res = { doc: { nodes: [], links: [] }, full: { nodes: [], links: [] }, warnings: [{ code: 'file-unknown', file: files.map((f) => f.name).join(', ') }], notes: [], counts: {}, parts: [] };
    }
    res.importer = id;
    res.files = files.map((f) => f.name);
    return res;
}
// Step 1 -> 2: each importer's files parsed together.
function readFiles() {
    if (!_imp) return null;
    const fam = new Map();
    _imp.files.forEach((f) => { if (f.choice) { const a = fam.get(f.choice) || []; a.push(f.file); fam.set(f.choice, a); } });
    _imp.results = [...fam.entries()].map(([id, files]) => parseFamily(id, files, {}));
    _imp.step = 2;
    render();
    return _imp.results;
}

// Step 2 -> the merge, one importer's result after another.
async function continueImport() {
    if (!_imp || !_imp.results) return [];
    const { results, target } = _imp;
    let targetId = target === 'here' ? state.libraryId : null;
    if (target === 'other') {
        targetId = await pickMergeTarget(null, t('Merge the import into which network?'));
        if (!targetId) return [];
    }
    closeImportDialog();
    const out = [];
    for (const res of results) {
        if (!(res.doc.nodes || []).length && !(res.doc.networks || []).length && !(res.doc.groups || []).length) continue;
        // The merge keeps a source's last path part (mergeSourceName), so a
        // label's "/" ("Cisco CDP / MAC table", "MikroTik /export") is the
        // look-alike U+2215, or the title would read "MAC table: …".
        const label = `${importerLabel(res.importer).replace(/\//g, '∕')}: ${res.files.join(', ')}`.slice(0, 200);
        const fileName = res.files.length === 1 ? res.files[0] : label;
        if (target === 'new') {
            const name = res.name || String(res.files[0] || '').replace(/\.[^.]+$/, '') || importerLabel(res.importer);
            out.push(openImportedAsNewCard(TopoImporters.withoutTransientIds(res.doc), name, null));
        } else {
            out.push(await mergeCopyInto(targetId, res.doc, { source: label, fileName, reason: 'Before importing {file}', name: label }));
        }
    }
    return out;
}

// For the tests: the dialog's state, and the steps without clicks.
const _state = () => _imp;

(function wire() {
    const s = scrim();
    if (!s) return;
    s.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeImportDialog));
    el('importNextBtn').addEventListener('click', () => { if (!_imp) return; if (_imp.step === 2) continueImport(); else readFiles(); });
    el('importBackBtn').addEventListener('click', () => { if (!_imp) return; _imp.step = 1; _imp.results = null; render(); });
    el('importAnyInput').addEventListener('change', (e) => { const fl = e.target.files; if (fl && fl.length) addFiles([...fl]); e.target.value = ''; });
    const btn = el('importAnyBtn');
    if (btn) btn.addEventListener('click', () => openImport());
    const nb = el('exportNetboxBtn');
    if (nb) nb.addEventListener('click', () => TopoNetbox.exportNetbox());
})();

window.TopoImportUI = { openImport, addFiles, readFiles, continueImport, closeImportDialog, issueText, WARN_TEXT, NOTE_TEXT, REFUSED_TEXT, COUNT_LABELS, PART_LABELS, _state };
})();
