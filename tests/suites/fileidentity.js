// Self-identifying files (docs/FEATURES.md "File format"; js/model.js
// topoSchemaUrl, js/report.js topoFileStem):
//   1. every .json Topo writes opens with "$schema" (the schema address for
//      this document version, from one helper), then the envelope it always
//      had (kind, version, name, doc / exported, sites): the network back-up,
//      the binder download, the bound binder file and the restore downloads;
//   2. it is saved as application/vnd.carino.topo+json under a .json name,
//      the bound binder's picker offers that type with .json, and the file
//      input accepts it beside .json and .nettopo;
//   3. reading ignores "$schema": a file with it opens and one without
//      still opens, as a network and as a binder;
//   4. schema/topo-v<DOC_VERSION>.json parses, its $id is the helper's
//      address, and what Topo writes for every sample satisfies it (a small
//      hand-rolled check of type, const, required, properties, items, $ref
//      and anyOf; no dependency);
//   5. the names: topo_<organization>_<site>_<date>[_<kind>], parts slugged
//      with fileSlug and joined with "_", empty parts left out, "network"
//      when there is nothing, "networks" for a binder naming no single
//      organization; the same stem on every download of a network (JSON,
//      SVG, CSV, report, labels, locate) and on the restore downloads; a
//      file named that way, opened without a name of its own, names its card
//      after the site part.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const realSaveBlob = window.saveBlob;
  const realPicker = window.showSaveFilePicker;
  delete window.showSaveFilePicker;
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : req.kind === 'prompt' ? null : req.kind === 'choice' ? (req.kind === 'choice' && req.choices.some((c) => c.id === 'open') && req.choices.some((c) => c.id === 'merge') ? 'open' : null) : undefined));
  if (window.CarinoRestore) await CarinoRestore.openRestoreStore({ open: async () => [], readCards: async () => ({}), readDoc: async () => null, write: async () => true });
  const heldStore = loadLibrary();
  const heldExport = localStorage.getItem(BINDER_EXPORT_KEY);
  const saved = [];
  window.saveBlob = (blob, name) => { saved.push({ blob, name }); return 'blob:test'; };
  const lastJson = async () => JSON.parse(await saved[saved.length - 1].blob.text());
  const today = todayISO();
  try {
    persistLibrary({}); localStorage.removeItem(BINDER_EXPORT_KEY);

    // ---- 1. The helper ----
    ok('the schema address comes from DOC_VERSION', topoSchemaUrl() === `https://topo.carino.systems/schema/topo-v${DOC_VERSION}.json`, topoSchemaUrl());
    ok('the media type', TOPO_MEDIA_TYPE === 'application/vnd.carino.topo+json');
    const w = withTopoSchema({ kind: 'nettopology', version: 1, name: 'X', doc: { nodes: [] } });
    ok('withTopoSchema puts $schema first and keeps the rest in order', JSON.stringify(Object.keys(w)) === '["$schema","kind","version","name","doc"]', Object.keys(w).join());
    ok('a newer document is labelled with its own version', withTopoSchema({ kind: 'nettopology', doc: { v: DOC_VERSION + 1, nodes: [] } }).$schema === `https://topo.carino.systems/schema/topo-v${DOC_VERSION + 1}.json`
       && withTopoSchema({ kind: 'x', sites: [{ doc: { v: 3 } }, { doc: { v: DOC_VERSION + 2 } }] }).$schema.endsWith(`topo-v${DOC_VERSION + 2}.json`)
       && withTopoSchema({ kind: 'nettopology', doc: { v: 3 } }).$schema === topoSchemaUrl());
    ok('and an old $schema is replaced, still first', withTopoSchema({ $schema: 'x', kind: 'k' }).$schema === topoSchemaUrl()
       && Object.keys(withTopoSchema({ kind: 'k', $schema: 'x' }))[0] === '$schema');

    // ---- 5a. Names ----
    ok('organization, site, date', topoFileStem({ org: 'Acme', site: 'Casa Roma', date: '2026-11-09' }) === 'topo_acme_casa-roma_2026-11-09');
    ok('with a kind as the last part', topoFileName({ org: 'Acme', site: 'Casa Roma', date: '2026-11-09', kind: 'report' }, 'html') === 'topo_acme_casa-roma_2026-11-09_report.html');
    ok('an empty organization is left out', topoFileStem({ site: 'Casa Roma', date: '2026-11-09' }) === 'topo_casa-roma_2026-11-09');
    ok('an empty site too', topoFileStem({ org: 'Acme', date: '2026-11-09' }) === 'topo_acme_2026-11-09');
    ok('nothing at all says network', topoFileStem({ date: '2026-11-09' }) === 'topo_network_2026-11-09' && topoFileStem({ org: '  ', site: '—', date: '2026-11-09' }) === 'topo_network_2026-11-09');
    ok('a binder naming nobody says networks', topoFileStem({ date: '2026-11-09', fallback: 'networks' }) === 'topo_networks_2026-11-09');
    ok('an underscore inside a part is a hyphen', topoFileStem({ org: 'a_b', site: 'c__d', date: '2026-11-09', kind: 'x_y' }) === 'topo_a-b_c-d_2026-11-09_x-y');
    ok('accents fold, other scripts are kept, lowercase', topoFileStem({ org: 'Grupo Médico', site: 'Клиника 東京', date: '2026-11-09' }) === 'topo_grupo-medico_клиника-東京_2026-11-09',
       topoFileStem({ org: 'Grupo Médico', site: 'Клиника 東京', date: '2026-11-09' }));
    ok('a site that is the organization is not said twice', topoFileStem({ org: 'Acme', site: 'ACME', date: '2026-11-09' }) === 'topo_acme_2026-11-09');
    ok('no date given is today', topoFileStem({ site: 'x' }) === `topo_x_${today}`);
    ok('a name read back from a Topo file name is its site part', nameFromTopoFileName('topo_acme_casa-roma_2026-11-09') === 'casa-roma'
       && nameFromTopoFileName('topo_acme_2026-11-09') === 'acme' && nameFromTopoFileName('topo_network_2026-11-09') === ''
       && nameFromTopoFileName('topo_networks_2026-11-09') === '' && nameFromTopoFileName('topo_acme_casa-roma_2026-11-09_report') === 'casa-roma');
    ok('a browser\'s " (1)" on a repeated download is not part of the name', nameFromTopoFileName('topo_acme_2026-11-09 (1)') === 'acme'
       && nameFromTopoFileName('topo_acme_casa-roma_2026-11-09_report (12)') === 'casa-roma', nameFromTopoFileName('topo_acme_2026-11-09 (1)'));
    ok('a date that is not YYYY-MM-DD is today', topoFileStem({ org: 'Acme', site: 'x', date: '09/11/2026', kind: 'report' }) === `topo_acme_x_${today}_report`
       && topoFileStem({ site: 'x', date: '2026_11_09' }) === `topo_x_${today}` && topoFileStem({ site: 'x', date: ' 2026-01-02 ' }) === 'topo_x_2026-01-02');
    {
      const bytes = (x) => new TextEncoder().encode(x).length;
      const ru = 'Ж'.repeat(60), jp = '東'.repeat(60);
      const long = topoFileName({ org: ru, site: jp, date: '2026-11-09', kind: 'interfaces' }, 'csv');
      const [, o, si] = long.split('_');
      ok('organization and site stay within 180 bytes, the longer trimmed first', bytes(o) + bytes(si) + 1 <= 180 && bytes(long) <= 255
         && long.endsWith('_2026-11-09_interfaces.csv') && o.length > si.length, `${bytes(long)} B: ${long}`);
      ok('a short name is not trimmed', topoFileStem({ org: 'Ж'.repeat(20), site: 'x', date: '2026-11-09' }) === `topo_${'ж'.repeat(20)}_x_2026-11-09`);
      ok('nor does a trim leave a hyphen at the end', !/-_/.test(topoFileStem({ org: 'ab '.repeat(30), site: '東 '.repeat(30), date: '2026-11-09' })));
    }
    ok('and a name Topo did not write is not one', nameFromTopoFileName('casa-roma-2026-11-09') === null && nameFromTopoFileName('hosts') === null);

    // ---- 5b. Every download of a network carries the stem ----
    replaceDocument(templatesData.house, { origin: 'file' });
    state.report = Object.assign({}, state.report || {}, { site: 'Casa Roma', client: 'Grupo Acme, S.A.' });
    const stem = `topo_grupo-acme-s-a_casa-roma_${today}`;
    ok('docFileStem: client then site then today', docFileStem() === stem, docFileStem());
    ok('and with a kind', docFileStem('devices') === `${stem}_devices`);
    saved.length = 0; exportJsonFile();
    ok('the back-up is <stem>.json', saved.length === 1 && saved[0].name === `${stem}.json`, saved[0] && saved[0].name);
    ok('saved as the Topo media type', saved[0].blob.type === TOPO_MEDIA_TYPE, saved[0].blob.type);
    const net = await lastJson();
    ok('opening with $schema, then kind, version, name, doc', JSON.stringify(Object.keys(net)) === '["$schema","kind","version","name","doc"]'
       && net.$schema === topoSchemaUrl() && net.kind === 'nettopology' && net.version === 1 && net.doc.v === DOC_VERSION, Object.keys(net).join());
    saved.length = 0; exportSvgFile();
    ok('the SVG is <stem>.svg', saved.length === 1 && saved[0].name === `${stem}.svg`, saved[0] && saved[0].name);
    saved.length = 0; downloadCsv('devices');
    ok('a sheet is <stem>_<sheet>.csv', saved.length === 1 && saved[0].name === `${stem}_devices.csv`, saved[0] && saved[0].name);
    ok('a report is <stem>_report.html, dated by its header', reportFileName({ client: 'Grupo Acme, S.A.', site: 'Casa Roma', date: '2026-01-02' }, 'report') === 'topo_grupo-acme-s-a_casa-roma_2026-01-02_report.html');
    const siteMeta = siteReportMeta(state.report);
    ok('the site report\'s own meta names the client', reportFileName(siteMeta, 'summary') === `topo_grupo-acme-s-a_casa-roma_${siteMeta.date}_summary.html`, reportFileName(siteMeta, 'summary'));
    ok('the site report is named as the back-up is (no card, the Site header)', (await buildSiteReport(state.report, null)).meta.fileSite === 'Casa Roma');
    // A kept card whose name is not the report's Site: every download, the
    // report too, says the card's name; the report's body keeps its Site.
    {
      persistLibrary({});
      replaceDocument(templatesData.house, { origin: 'file' });
      state.report = { site: 'Torre Norte', client: 'Acme' };
      state.libraryId = librarySave('Casa Roma');
      const keptStem = `topo_acme_casa-roma_${today}`;
      saved.length = 0; exportJsonFile();
      ok('a kept card: the back-up says the card\'s name', saved[0] && saved[0].name === `${keptStem}.json`, saved[0] && saved[0].name);
      const b = await buildSiteReport(Object.assign({}, state.report, { date: today }), null);
      ok('and so does its report, whatever its Site says', reportFileName(b.meta, b.kind) === `${keptStem}_${b.kind}.html` && b.meta.site === 'Torre Norte', reportFileName(b.meta, b.kind));
      state.libraryId = null; persistLibrary({});
      replaceDocument(templatesData.house, { origin: 'file' });
      state.report = Object.assign({}, state.report || {}, { site: 'Casa Roma', client: 'Grupo Acme, S.A.' });
    }
    // Labels and the PNG carry the whole stem, not only its suffix.
    {
      const tagged = state.nodes.find((n) => n.type !== 'internet') || state.nodes[0];
      tagged.assetTag = 'A-0001';
      const lab = printAssetLabels([{ type: 'node', id: tagged.id }]);
      await new Promise((r) => setTimeout(r, 50));
      ok('the labels sheet is <stem>_labels.html', !!lab && el('sheetPreviewName').textContent === `${stem}_labels.html`, el('sheetPreviewName') && el('sheetPreviewName').textContent);
      if (typeof closeSheetPreview === 'function') closeSheetPreview();
      const realCapture = window.captureCanvasImage;
      window.captureCanvasImage = () => Promise.resolve({ url: 'data:image/png;base64,iVBORw0KGgo=', ext: 'png' });
      try {
        saved.length = 0; handleExport('png');
        await new Promise((r) => setTimeout(r, 50));
        ok('the PNG is <stem>.png', saved.length === 1 && saved[0].name === `${stem}.png`, saved[0] && saved[0].name);
      } finally { window.captureCanvasImage = realCapture; }
    }
    ok('an estate report naming nobody says networks', reportFileName({ site: '', date: '2026-01-02', binder: true }, 'report') === 'topo_networks_2026-01-02_report.html');
    const loc = printLocate([{ type: 'node', id: state.nodes[0].id }]);
    await new Promise((r) => setTimeout(r, 50));
    ok('the Locate sheet is <stem>_locate.html', !!loc && el('sheetPreviewName').textContent === `${stem}_locate.html`, el('sheetPreviewName') && el('sheetPreviewName').textContent);
    if (typeof closeSheetPreview === 'function') closeSheetPreview();

    // ---- 1/5c. The binder: download, bound file, picker ----
    persistLibrary({});
    loadDocState(templatesData.hospital); autoBindLinks(); state.report = { site: 'Torre A', client: 'Acme' }; librarySave('Torre A');
    loadDocState(templatesData.house); autoBindLinks(); state.report = { site: 'Casa', client: 'ACME' }; librarySave('Casa');
    ok('networks of one organization name it', binderOrganization(libraryEntries()) === 'Acme' || binderOrganization(libraryEntries()) === 'ACME', binderOrganization(libraryEntries()));
    saved.length = 0; downloadBinderFile(binderFile());
    ok('so the binder is topo_<organization>_<date>.json', saved.length === 1 && saved[0].name === `topo_acme_${today}.json`, saved[0] && saved[0].name);
    const bin = await lastJson();
    ok('the binder opens with $schema, then kind, version, exported, sites', JSON.stringify(Object.keys(bin)) === '["$schema","kind","version","exported","sites"]'
       && bin.kind === BINDER_KIND && saved[0].blob.type === TOPO_MEDIA_TYPE, Object.keys(bin).join());
    const sitesOf = (...clients) => clients.map((c, i) => ({ id: 's' + i, doc: { nodes: [], report: c === null ? undefined : { client: c } } }));
    ok('a network with no client does not count against it', binderOrganization(sitesOf('Acme', '', null)) === 'Acme');
    ok('several organizations name none', binderOrganization(sitesOf('Acme', 'Beta')) === '' && binderFileName(sitesOf('Acme', 'Beta'), '2026-11-09') === 'topo_networks_2026-11-09.json');
    ok('nor does a binder with no client at all', binderFileName(sitesOf('', null), '2026-11-09') === 'topo_networks_2026-11-09.json');
    ok('templates and blocks belong to no client', binderOrganization([...sitesOf('Acme'), { id: 't', template: true, doc: { nodes: [], report: { client: 'Beta' } } }]) === 'Acme');
    // The bound file: what is written opens with $schema too.
    let written = null;
    const handle = { name: 'estate.json', getFile: () => Promise.resolve({ text: () => Promise.resolve('') }),
      createWritable: () => Promise.resolve({ write: (t) => { written = t; return Promise.resolve(); }, close: () => Promise.resolve(), abort: () => Promise.resolve() }) };
    await writeBinderTo(handle, binderFile());
    const boundJson = JSON.parse(written);
    ok('the bound binder file opens with $schema', Object.keys(boundJson)[0] === '$schema' && boundJson.$schema === topoSchemaUrl() && boundJson.kind === BINDER_KIND);
    let pickerOpts = null;
    window.showSaveFilePicker = (o) => { pickerOpts = o; return Promise.reject(Object.assign(new Error('abort'), { name: 'AbortError' })); };
    await adoptBinderFile();
    const accept = pickerOpts && pickerOpts.types && pickerOpts.types[0].accept;
    ok('the bind picker suggests the scheme\'s name', !!pickerOpts && pickerOpts.suggestedName === `topo_acme_${today}.json`, pickerOpts && pickerOpts.suggestedName);
    ok('and offers the Topo media type, as .json', !!accept && JSON.stringify(accept) === JSON.stringify({ [TOPO_MEDIA_TYPE]: ['.json'] }), JSON.stringify(accept));
    delete window.showSaveFilePicker;
    // What the landing shows for a bound file comes from its handle
    // (refreshBinderBinding): its own name, the scheme's only when it has none.
    {
      const heldStore = setHandleStore({ get: () => Promise.resolve({ name: 'estate.json' }), put: () => Promise.resolve(), del: () => Promise.resolve() });
      const heldBinding = _binderBinding;
      window.showSaveFilePicker = () => Promise.reject(Object.assign(new Error('abort'), { name: 'AbortError' }));
      try {
        const b1 = await refreshBinderBinding();
        ok('a bound file keeps its own name on the landing', b1.bound === true && b1.name === 'estate.json' && binderBinding().name === 'estate.json', JSON.stringify(b1));
        setHandleStore({ get: () => Promise.resolve({}), put: () => Promise.resolve(), del: () => Promise.resolve() });
        const b2 = await refreshBinderBinding();
        ok('a handle with no name says the scheme\'s', b2.bound === true && b2.name === `topo_networks_${today}.json`, JSON.stringify(b2));
      } finally {
        setHandleStore(heldStore);
        _binderBinding = heldBinding;
        delete window.showSaveFilePicker;
      }
    }

    // ---- Restore downloads ----
    const card = libraryEntries().find((e) => e.name === 'Torre A');
    saved.length = 0; downloadRestoreBackup([card.id]);
    const rest = await lastJson();
    ok('a restore back-up of one card: topo_<client>_<card>_<date>.json, with $schema', saved[0].name === `topo_acme_torre-a_${today}.json`
       && Object.keys(rest)[0] === '$schema' && rest.kind === 'nettopology', saved[0].name);
    saved.length = 0; downloadRestoreBackup(libraryEntries().map((e) => e.id));
    ok('of several: the binder\'s name', saved[0].name === `topo_acme_${today}.json` && Object.keys(await lastJson())[0] === '$schema', saved[0].name);

    // ---- 2. The file input ----
    const acc = el('importFileInput').getAttribute('accept').split(',');
    ok('the file input accepts the media type beside .json and .nettopo', ['.json', '.nettopo', 'application/json', TOPO_MEDIA_TYPE].every((x) => acc.includes(x)), acc.join());

    // ---- 3. Reading ignores $schema ----
    const plain = { kind: 'nettopology', version: 1, name: 'P', doc: canonicalDoc(templatesData.house) };
    ok('a network with $schema is read', docFromImported(withTopoSchema(plain)) === plain.doc);
    ok('and one without still is', docFromImported(plain) === plain.doc);
    ok('a bare document with $schema is a document', !!docFromImported(withTopoSchema({ nodes: [], links: [] })));
    const binderPlain = { kind: BINDER_KIND, version: 1, exported: 'x', sites: [{ id: 'q', name: 'Q', doc: canonicalDoc(templatesData.house) }] };
    ok('a binder with $schema is a binder', (binderFromImported(withTopoSchema(binderPlain)) || {}).sites.length === 1);
    ok('and one without still is', (binderFromImported(binderPlain) || {}).sites.length === 1);
    ok('a network with $schema is not a binder', binderFromImported(withTopoSchema(plain)) === null);
    persistLibrary({});
    replaceDocument(templatesData.bank, { origin: 'file' });
    const opened = await applyImportedDoc(withTopoSchema({ kind: 'nettopology', version: 1, doc: canonicalDoc(templatesData.house) }), { fileName: 'topo_acme_casa-roma_2026-11-09.json' });
    const named = libraryEntries().find((e) => e.name === 'casa-roma');
    ok('a file with $schema opens, its card named after the file\'s site part', opened === true && !!named, libraryEntries().map((e) => e.name).join());
    const opened2 = await applyImportedDoc({ kind: 'nettopology', version: 1, doc: canonicalDoc(templatesData.bank) }, { fileName: 'Oficina.nettopo.json' });
    ok('a file without it still opens, under its own file name', opened2 === true && libraryEntries().some((e) => e.name === 'Oficina'), libraryEntries().map((e) => e.name).join());
    const opened3 = await applyImportedDoc(withTopoSchema({ kind: BINDER_KIND, version: 1, exported: 'x', sites: [{ id: 'bq1', name: 'Binder site', updated: 5, doc: canonicalDoc(templatesData.house) }] }), { fileName: 'topo_networks_2026-11-09.json' });
    ok('a binder with $schema opens', opened3 === true && !!libraryEntry('bq1'));

    // ---- 4. The schema file ----
    const res = await fetch(`schema/topo-v${DOC_VERSION}.json`);
    let schema = null;
    try { schema = JSON.parse(await res.text()); } catch (e) { /* asserted below */ }
    ok('schema/topo-v<DOC_VERSION>.json is there and parses', res.ok && !!schema);
    ok('its $id is the helper\'s address, draft 2020-12', !!schema && schema.$id === topoSchemaUrl() && schema.$schema === 'https://json-schema.org/draft/2020-12/schema');
    ok('titled, and says it is a draft pointing at SCOPE step 6', !!schema && schema.title === 'Topo network file' && /DRAFT/.test(schema.description) && /step 6 of docs\/SCOPE\.md/.test(schema.description));
    // A small validator: enough of 2020-12 for this schema.
    const typeOk = (t, v) => (Array.isArray(t) ? t : [t]).some((x) => (x === 'integer' ? Number.isInteger(v) : x === 'array' ? Array.isArray(v)
      : x === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : x === 'null' ? v === null : typeof v === x));
    const check = (s, v, path = '$') => {
      if (s.$ref) return check(s.$ref.replace('#/$defs/', '').split('/').reduce((o, k) => o[k], schema.$defs), v, path);
      if (s.anyOf) { const errs = s.anyOf.map((x) => check(x, v, path)); return errs.some((e) => !e.length) ? [] : errs.flat(); }
      if ('const' in s && v !== s.const) return [`${path}: not ${s.const}`];
      if (s.type && !typeOk(s.type, v)) return [`${path}: not ${s.type}`];
      const errs = [];
      (s.required || []).forEach((k) => { if (!(k in v)) errs.push(`${path}: no ${k}`); });
      if (s.properties) Object.keys(s.properties).forEach((k) => { if (v[k] !== undefined) errs.push(...check(s.properties[k], v[k], `${path}.${k}`)); });
      if (s.items && Array.isArray(v)) v.forEach((x, i) => errs.push(...check(s.items, x, `${path}[${i}]`)));
      if (s.additionalProperties === false && s.properties) Object.keys(v).forEach((k) => { if (!(k in s.properties)) errs.push(`${path}: extra ${k}`); });
      return errs;
    };
    if (schema) {
      ok('the validator rejects what is not a Topo file', check(schema, { hello: 1 }).length > 0 && check(schema, { kind: 'nettopology' }).length > 0
         && check(schema, { kind: BINDER_KIND, sites: {} }).length > 0);
      const serialized = canonicalDoc(templatesData.house);
      ok('the schema lists every top-level key serializeDoc can write', ['v', 'id', 'updated', 'rev', 'base', 'prior', 'nodes', 'links', 'networks', 'groups', 'wifi', 'providers', 'accepted', 'pinned', 'expectedLife', 'annotations', 'report', 'columns', 'tableView', 'searches', 'incidents', 'log']
         .every((k) => k in schema.$defs.document.properties) && Object.keys(serialized).every((k) => k in schema.$defs.document.properties), Object.keys(serialized).join());
      ok('a bare { nodes, links } document satisfies it', check(schema, { nodes: [], links: [] }).length === 0);
      const bad = [];
      persistLibrary({});
      for (const key of Object.keys(templatesData)) {
        replaceDocument(templatesData[key], { origin: 'file' });
        state.report = Object.assign({}, state.report || {}, { site: 'S ' + key });
        if (!state.nodes.length) continue;
        saved.length = 0; exportJsonFile();
        const f = await lastJson();
        const e = check(schema, f).concat(check(schema.$defs.networkFile, f));
        if (e.length || Object.keys(f)[0] !== '$schema') bad.push(`${key}: ${e.slice(0, 3).join('; ')}`);
        librarySave('S ' + key);
      }
      ok('the back-up Topo writes for every sample satisfies it', !bad.length, bad.slice(0, 4).join(' | '));
      saved.length = 0; downloadBinderFile(binderFile());
      const all = await lastJson();
      const be = check(schema, all).concat(check(schema.$defs.binderFile, all));
      ok('and so does the binder of them all', !be.length && all.sites.length > 5, be.slice(0, 3).join('; '));
      ok('with no organization named, the binder says networks', saved[0].name === `topo_networks_${today}.json`, saved[0].name);
    }
  } catch (e) {
    ok('the suite ran without throwing', false, String(e && e.stack || e));
  } finally {
    window.saveBlob = realSaveBlob;
    if (realPicker) window.showSaveFilePicker = realPicker;
    setDialogResponder(heldResponder);
    persistLibrary(heldStore);
    if (heldExport === null) localStorage.removeItem(BINDER_EXPORT_KEY); else localStorage.setItem(BINDER_EXPORT_KEY, heldExport);
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 300); });
