// Inventory, stage 1 (docs/BACKLOG.md feature 3, landing order step 12): a
// device's vendor and model (NODE_FIELDS vendor, model, just before os) and
// the old OS field relabelled "Firmware / OS", folded into document version
// 16 beside the DHCP pool and the saved searches. What is held here:
//   1. the format: vendor and model are written before os, as typed, and
//      left out when blank, so a device without them serializes byte for
//      byte as a v15 one did; a v15 document whose os holds "Model /
//      firmware" text opens editable with that text where it was and no
//      vendor or model; the 15 to 16 step changes nothing but v; a newer
//      document opens read-only; every template opens through the step
//      unchanged, and loads and saves its devices stamped v15 as at v16;
//      the schema's labels;
//   2. the device editor: Vendor, Model and Firmware / OS in the Asset
//      group, filled from the device, typing one undo step, a blank one
//      dropped from the record; the vendor and model suggestions from what
//      the map holds, the models only the typed vendor's;
//   3. the table: Vendor and Model columns just before Firmware / OS, a
//      cell edit one undo step, an emptied cell no key;
//   4. devices.csv: vendor, model, then os; headings "Model", "Manufacturer",
//      "Make", "Brand" and the old "Model / firmware" land where they
//      should; two rows of one name that disagree on the model stay two
//      devices; every template, given vendors and models, round-trips
//      through a blank map with every field; a v15 custom column called "Vendor"
//      beside Topo's vendor reads back into its own;
//   5. search: vendor:, model:, fw: (and make:, firmware:, os:), has:vendor,
//      has:model, has:fw, a leading -, vendor: matching only what was typed
//      while mac:dell still finds the Dell NIC;
//   6. the report's Model column joining vendor and model, Firmware / OS
//      beside it, both translated; a QR label's model text;
//   7. Change all lists Vendor and Model and sets them in one undo step;
//      the changes since the last back-up name Model;
//   8. the words in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const typeInto = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const steps = () => _undoStack.length;
  const sw = (id, name, extra) => ({ id, type: 'switch', name, x: 0, y: 0, portCount: 24, interfaces: [], ...(extra || {}) });
  const pc = (id, name, ip, extra) => ({ id, type: 'pc', name, x: 0, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip }], ...(extra || {}) });
  const lab = () => ({ v: DOC_VERSION, links: [],
    networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1' }],
    nodes: [
      sw('s1', 'SW-1', { vendor: 'Cisco', model: 'C9200L-24P', os: 'IOS-XE 17.9.4' }),
      sw('s2', 'SW-2', { vendor: 'Cisco', model: 'C9300-48P', os: 'IOS-XE 17.6.1' }),
      sw('s3', 'SW-3', { vendor: 'Aruba', model: '2930F', os: 'WC.16.11' }),
      pc('p1', 'PC-1', '10.0.1.10/24', { os: 'Windows 11' }),
      // A Dell NIC (OUI 00:14:22) with no vendor typed.
      { id: 'p2', type: 'pc', name: 'PC-2', x: 100, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.11/24', mac: '00:14:22:AA:BB:CC' }] }
    ] });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); initHistory(); };
  const saved = () => JSON.parse(JSON.stringify(serializeDoc()));
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
  const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
  setLocale('en');

  try {
    // ---- 1. The format ----
    ok('the document is version 16 or later', DOC_VERSION >= 16);
    open();
    let s1 = saved().nodes.find((n) => n.id === 's1');
    const keys = Object.keys(s1);
    ok('vendor and model are written as typed, just before os', s1.vendor === 'Cisco' && s1.model === 'C9200L-24P' && s1.os === 'IOS-XE 17.9.4'
       && keys.indexOf('vendor') === keys.indexOf('model') - 1 && keys.indexOf('model') === keys.indexOf('os') - 1, keys.join(','));
    const p1 = saved().nodes.find((n) => n.id === 'p1');
    ok('a device without them carries no key for them', !('vendor' in p1) && !('model' in p1) && p1.os === 'Windows 11', Object.keys(p1).join(','));
    open(Object.assign(lab(), { nodes: [sw('s1', 'SW-1', { vendor: '   ', model: '' })] }));
    ok('blank space is no value', !/vendor|model/.test(show(saved().nodes[0])), show(saved().nodes[0]));
    const v15 = { v: 15, links: [], nodes: [{ id: 'a', type: 'switch', name: 'A', x: 0, y: 0, gw: '', dns: '', os: 'C9200L-24P / IOS-XE 17.9.4', ports: '', notes: '', nat: false, portCount: 24, interfaces: [] }] };
    open(cloneData(v15));
    const back = serializeDoc();
    ok('a v15 file opens editable', !state.readOnly);
    ok('its "Model / firmware" text stays in os, with no vendor or model', getNode('a').os === 'C9200L-24P / IOS-XE 17.9.4' && getNode('a').vendor === undefined && getNode('a').model === undefined);
    ok('and saves byte for byte but for v', show({ ...back, v: 15 }.nodes) === show(v15.nodes) && back.v === DOC_VERSION, show(back.nodes));
    const step = migrateDoc(cloneData(v15)).doc;
    ok('the 15 to 16 step changes nothing but v', show({ ...step, v: 15 }) === show(v15));
    replaceDocument({ v: DOC_VERSION + 1, nodes: [sw('s1', 'SW-1', { vendor: 'Cisco', model: 'X', poeBudget: 370 })], links: [] }, { origin: 'file' });
    ok('a newer document opens read-only', !!state.readOnly);
    const odd = [];
    Object.keys(templatesData).forEach((k) => {
      const doc = cloneData(templatesData[k]);
      const m = migrateDoc({ ...doc, v: 15 });
      if (show({ ...m.doc, v: doc.v }) !== show(doc)) odd.push(k);
    });
    ok('every template opens through the v16 step unchanged', !odd.length, odd.join(', '));
    // And through the load and save path: a template stamped v15 opens and
    // saves its devices as the same template stamped v16 does, and no device
    // gains a vendor or model key (written blank, or put out of order).
    const oddSave = [];
    Object.keys(templatesData).forEach((k) => {
      const nodesAt = (v) => { replaceDocument({ ...cloneData(templatesData[k]), v }, { origin: 'file' }); return saved().nodes; };
      const a = nodesAt(15), b = nodesAt(DOC_VERSION);
      if (show(a) !== show(b) || a.some((n) => 'vendor' in n || 'model' in n)) oddSave.push(k);
    });
    ok('every template stamped v15 loads and saves its devices as at v16, with no vendor or model key', !oddSave.length, oddSave.join(', '));
    const f = (k) => NODE_FIELDS.find((x) => x.key === k);
    ok('the schema: Vendor and Model, omitted when blank, in devices.csv, Change all and the table',
       ['vendor', 'model'].every((k) => f(k).omit && f(k).csv === k && f(k).bulk && f(k).table === 'edit') && f('vendor').label === 'Vendor' && f('model').label === 'Model');
    ok('os keeps its key and csv name, relabelled Firmware / OS', f('os').csv === 'os' && f('os').label === 'Firmware / OS' && f('os').report.column === 'Firmware / OS');

    // ---- 2. The device editor ----
    open();
    select('s1', 'node');
    ok('Vendor, Model and Firmware / OS are in the Asset group', ['propVendor', 'propModel', 'propOs'].every((id) => el('assetGroup').contains(el(id))));
    ok('filled from the device', el('propVendor').value === 'Cisco' && el('propModel').value === 'C9200L-24P' && el('propOs').value === 'IOS-XE 17.9.4');
    const opts = (id) => [...el(id).options].map((o) => o.value).sort().join('|');
    ok('the vendor suggestions are the vendors on this map', opts('vendorDatalist') === 'Aruba|Cisco', opts('vendorDatalist'));
    ok('the model suggestions are the typed vendor\'s', opts('modelDatalist') === 'C9200L-24P|C9300-48P', opts('modelDatalist'));
    let n0 = steps();
    typeInto(el('propModel'), 'C9200L-48P');
    commitTyping();
    ok('typing a model sets it, as one undo step', getNode('s1').model === 'C9200L-48P' && steps() === n0 + 1, `${getNode('s1').model} ${steps() - n0}`);
    undo();
    ok('undo puts the model back', getNode('s1').model === 'C9200L-24P');
    select('p1', 'node');
    ok('a device with none shows empty fields', el('propVendor').value === '' && el('propModel').value === '');
    ok('and every model as a suggestion while its vendor is blank', opts('modelDatalist') === '2930F|C9200L-24P|C9300-48P', opts('modelDatalist'));
    typeInto(el('propVendor'), 'aruba ');
    ok('typing a vendor narrows the models to that vendor\'s, any case', opts('modelDatalist') === '2930F', opts('modelDatalist'));
    commitTyping();
    select('s3', 'node');
    n0 = steps();
    typeInto(el('propVendor'), '  ');
    commitTyping();
    ok('a vendor emptied is no key at all, one undo step', !('vendor' in getNode('s3')) && steps() === n0 + 1);

    // ---- 3. The table ----
    open();
    setView('table'); showTableTab('devices');
    const heads = [...el('tvGrid').querySelectorAll('thead th[data-col]')].map((th) => th.dataset.col);
    ok('the Devices table has Vendor and Model just before Firmware / OS', heads.indexOf('vendor') === heads.indexOf('os') - 2 && heads.indexOf('model') === heads.indexOf('os') - 1, heads.join(','));
    const cellEl = (row, col) => { const r = el('tvGrid').querySelector(`tbody tr[data-row="${row}"]`); return r && r.querySelector(`td[data-col="${col}"]`); };
    ok('the cells show them', cellEl('n:s1', 'vendor').textContent === 'Cisco' && cellEl('n:s1', 'model').textContent === 'C9200L-24P');
    const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    n0 = steps();
    cellEl('n:p1', 'vendor').focus(); key(cellEl('n:p1', 'vendor'), 'Enter');
    _tv.editor.el.value = 'Dell'; key(_tv.editor.el, 'Enter');
    ok('a Vendor cell edits the device, one undo step', getNode('p1').vendor === 'Dell' && steps() === n0 + 1);
    cellEl('n:s1', 'model').focus(); key(cellEl('n:s1', 'model'), 'Enter');
    _tv.editor.el.value = ''; key(_tv.editor.el, 'Enter');
    ok('an emptied Model cell leaves no key', !('model' in getNode('s1')));
    setLocale('es'); applyLocale(); renderTableView();
    const headText = (col) => el('tvGrid').querySelector(`thead th[data-col="${col}"]`).textContent;
    ok('the headings are translated, Firmware / OS stays English', /Fabricante/.test(headText('vendor')) && /Modelo/.test(headText('model')) && /Firmware \/ OS/.test(headText('os')),
       `${headText('vendor')} | ${headText('model')} | ${headText('os')}`);
    setLocale('en'); applyLocale();
    setView('map');

    // ---- 4. devices.csv ----
    open();
    const dev = csvDevicesSheet();
    const at = (h) => dev.headers.indexOf(h);
    ok('devices.csv has vendor, model, then os', at('vendor') >= 0 && at('model') === at('vendor') + 1 && at('os') === at('model') + 1, dev.headers.join(','));
    const s1row = dev.rows[state.nodes.findIndex((n) => n.id === 's1')];
    ok('with the values as typed', s1row[at('vendor')] === 'Cisco' && s1row[at('model')] === 'C9200L-24P' && s1row[at('os')] === 'IOS-XE 17.9.4', s1row.join('|'));
    const devPlan = planOf(csvText(dev));
    ok('imported straight back it changes nothing', devPlan.rows.every((r) => r.status === 'same'), devPlan.rows.map((r) => `${r.name}:${r.status}:${r.why}`).join(' | '));
    const mapped = (text) => { const s = sheetOf(text); return csvAutoMap(s); };
    ok('a "Model" heading lands in model, not os', show(mapped('name,Model\nPC-1,OptiPlex 7010')) === show(['name', 'model']), show(mapped('name,Model\nPC-1,OptiPlex 7010')));
    ok('"Manufacturer", "Make" and "Brand" land in vendor', ['Manufacturer', 'Make', 'Brand', 'Fabricante', 'メーカー'].every((h) => mapped(`name,${h}\nPC-1,Dell`)[1] === 'vendor'),
       ['Manufacturer', 'Make', 'Brand', 'Fabricante', 'メーカー'].map((h) => mapped(`name,${h}\nPC-1,Dell`)[1]).join(','));
    ok('the old "Model / firmware" heading still lands in os', mapped('name,Model / firmware\nPC-1,X')[1] === 'os' && mapped('name,Firmware / OS\nPC-1,X')[1] === 'os'
       && mapped('name,Firmware version\nPC-1,X')[1] === 'os', show(mapped('name,Model / firmware\nPC-1,X')));
    let plan = planOf('name,vendor,model\nPC-1,Dell,OptiPlex 7010');
    applyCsvPlan(plan);
    ok('an import sets them on the device', getNode('p1').vendor === 'Dell' && getNode('p1').model === 'OptiPlex 7010');
    open(Object.assign(lab(), { nodes: [] }));
    plan = planOf('name,model,ip\nNAS,DS920+,10.0.1.20/24\nNAS,DS1621+,10.0.1.21/24');
    applyCsvPlan(plan);
    ok('two rows of one name that disagree on the model stay two devices', state.nodes.filter((n) => n.name === 'NAS').length === 2, show(state.nodes.map((n) => [n.name, n.model])));
    open(Object.assign(lab(), { nodes: [] }));
    plan = planOf('name,model,ip\nNAS,DS920+,10.0.1.20/24\nNAS,DS920+,10.0.1.21/24');
    applyCsvPlan(plan);
    ok('and rows that agree are one device with two NICs', state.nodes.filter((n) => n.name === 'NAS').length === 1 && getNode(state.nodes[0].id).interfaces.length === 2);
    // Every template, a vendor and a model on each device (some only one),
    // back through a blank map whole.
    const blank = () => replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    const devSig = () => state.nodes.map((n) => { const o = serializeNode(n); if (o.group) o.group = groupPathOf(n); return JSON.stringify(o); }).sort().join('\n');
    const lost = [];
    Object.keys(templatesData).forEach((k) => {
      loadDocState(cloneData(templatesData[k])); autoBindLinks();
      state.nodes.forEach((n, i) => { if (i % 3 !== 2) n.vendor = `Vendor "${i}", Inc`; if (i % 3 !== 1) n.model = `=M-${i} / rev 2`; });
      save();
      const want = devSig();
      const sheets = { P: csvText(csvProvidersSheet()), S: csvText(csvSubnetsSheet()), G: csvText(csvGroupsSheet()), W: csvText(csvWifiSheet()), D: csvText(csvDevicesSheet()), I: csvText(csvInterfacesSheet()), C: csvText(csvCablesSheet()), T: csvText(csvPortsSheet()) };
      // ports.csv last where a template records port facts (the Showcase's
      // PoE since VLAN/PoE stage 2b).
      const order = ((state.providers || []).length ? 'P' : '') + ((state.wifi || []).length ? 'SWGDIC' : 'SGDIC') + (state.nodes.some((n) => n.portAttrs) ? 'T' : '');
      blank();
      const why = [];
      [...order].forEach((s) => { const sh = sheetOf(sheets[s]); const pl = csvPlan(sh, csvAutoMap(sh), { createGroups: true });
        pl.rows.filter((r) => r.status === 'conflict').forEach((r) => why.push(`${r.name}: ${r.why}`)); applyCsvPlan(pl); });
      const got = devSig();
      if (got !== want || why.length) {
        const a = want.split('\n'), b = got.split('\n'); const i = a.findIndex((x, j) => x !== b[j]);
        lost.push(`${k}: ${why.slice(0, 1).join('')} ${i >= 0 ? `${a[i]} ≠ ${b[i]}`.slice(0, 300) : ''}`);
      }
    });
    ok('every template with vendors and models round-trips through a blank map with every field', !lost.length, lost.slice(0, 2).join(' ; '));
    // A v15 network could have a column of its own called "Vendor" (no field
    // or heading of Topo's was named so before v16). Its devices.csv now has
    // Topo's vendor heading and that column's beside it: each reads back
    // into its own, both from Topo's sheet and from one whose custom
    // column is spelt exactly as Topo's heading.
    ['Vendor', 'vendor'].forEach((name) => {
      open({ v: 15, links: [], columns: [{ id: 'c1', name, kind: 'text' }],
        nodes: [sw('s1', 'SW-1', { extra: { c1: 'Cisco Systems' } }), sw('s2', 'SW-2', { extra: { c1: 'Aruba Networks' } })] });
      ok(`a v15 custom column "${name}" survives the upgrade`, (state.columns || []).length === 1 && customValueOf(getNode('s1'), 'c1') === 'Cisco Systems');
      getNode('s1').vendor = 'Cisco'; save();
      const sheet = csvDevicesSheet();
      const keys = mapped(csvText(sheet));
      ok(`beside a custom "${name}", devices.csv's vendor heading maps to vendor and the column's to it`,
         keys[sheet.headers.indexOf('vendor')] === 'vendor' && keys[sheet.headers.lastIndexOf(name)] === 'x:c1', show(sheet.headers.map((h, i) => `${h}=${keys[i]}`)));
      const p = planOf(csvText(sheet));
      ok(`and imported straight back it changes nothing (custom "${name}")`, p.rows.every((r) => r.status === 'same'), p.rows.map((r) => `${r.name}:${r.status}:${r.why || ''}`).join(' | '));
      applyCsvPlan(p);
      ok(`both values kept (custom "${name}")`, getNode('s1').vendor === 'Cisco' && customValueOf(getNode('s1'), 'c1') === 'Cisco Systems' && customValueOf(getNode('s2'), 'c1') === 'Aruba Networks' && !getNode('s2').vendor);
    });
    // A sheet with only one such heading means the network's column, as before.
    open({ v: 15, links: [], columns: [{ id: 'c1', name: 'Vendor', kind: 'text' }], nodes: [sw('s1', 'SW-1')] });
    ok('alone, a "Vendor" heading still means the network\'s own column', mapped('name,Vendor\nSW-1,Acme')[1] === 'x:c1', show(mapped('name,Vendor\nSW-1,Acme')));

    // ---- 5. Search ----
    open();
    const matches = (text) => { const q = parseQuery(text); return state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id).sort().join(','); };
    ok('vendor:cisco', matches('vendor:cisco') === 's1,s2', matches('vendor:cisco'));
    ok('make: is vendor:', matches('make:aruba') === 's3');
    ok('model:c9200', matches('model:c9200') === 's1');
    ok('fw:17.9, and firmware: and os: the same', matches('fw:17.9') === 's1' && matches('firmware:17.9') === 's1' && matches('os:windows') === 'p1', `${matches('fw:17.9')} ${matches('os:windows')}`);
    ok('has:vendor and has:model', matches('has:vendor') === 's1,s2,s3' && matches('has:model') === 's1,s2,s3');
    ok('has:fw is has:os', matches('has:fw') === matches('has:os') && matches('has:fw') === 'p1,s1,s2,s3', matches('has:fw'));
    ok('-vendor:cisco leaves them out', matches('-vendor:cisco') === 'p1,p2,s3', matches('-vendor:cisco'));
    ok('vendor: matches only what was typed, mac:dell still finds the Dell NIC', matches('vendor:dell') === '' && matches('mac:dell') === 'p2', `${matches('vendor:dell')} | ${matches('mac:dell')}`);
    ok('plain words find a vendor and a model', matches('aruba') === 's3' && matches('C9300') === 's2');
    ok('the box\'s tooltip names vendor:, model: and fw:', /vendor:, model:, fw:/.test(el('queryInput').title), el('queryInput').title);

    // ---- 6. The report and labels ----
    open();
    const html = devicesSection(reportDevices());
    ok('the inventory\'s Model column joins vendor and model, Firmware / OS beside it', /<th>Model<\/th><th>Firmware \/ OS<\/th>/.test(html)
       && /<td>Cisco C9200L-24P<\/td>\s*<td>IOS-XE 17\.9\.4<\/td>/.test(html), html.slice(html.indexOf('SW-1'), html.indexOf('SW-1') + 600));
    ok('a device with only firmware prints a dash under Model', /<td><span class="muted">—<\/span><\/td>\s*<td>Windows 11<\/td>/.test(html));
    setLocale('es');
    const es = devicesSection(reportDevices());
    ok('the headings are translated', /<th>Modelo<\/th><th>Firmware \/ SO<\/th>/.test(es));
    setLocale('en');
    getNode('s1').assetTag = 'CS-1'; getNode('p1').assetTag = 'CS-2';
    getNode('s2').assetTag = 'CS-3'; delete getNode('s2').vendor;
    const tags = labelsFor([{ type: 'node', id: 's1' }, { type: 'node', id: 'p1' }, { type: 'node', id: 's2' }]).devices;
    ok('a QR label prints vendor and model, else the firmware', show(tags.map((d) => d.model)) === show(['Cisco C9200L-24P', 'Windows 11', 'C9300-48P']), show(tags.map((d) => d.model)));

    // ---- 7. Change all, changes ----
    open();
    selectEntries([{ type: 'node', id: 'p1' }, { type: 'node', id: 'p2' }]);
    ok('Change all lists Vendor and Model', !!el('bulkF-vendor') && !!el('bulkF-model'));
    el('bulkF-vendor').value = 'Dell'; el('bulkF-vendor').dispatchEvent(new Event('input', { bubbles: true }));
    n0 = steps();
    el('bulkPreviewBtn').click();
    el('bulkApplyBtn').click();
    ok('and sets the vendor on both in one undo step', getNode('p1').vendor === 'Dell' && getNode('p2').vendor === 'Dell' && steps() === n0 + 1);
    selectEntries([]);
    const C = window.CarinoChanges;
    const before = lab(), after = lab();
    after.nodes[0].model = 'C9200L-48P';
    after.nodes[3].vendor = 'Dell';
    const ch = C.docChanges(before, after);
    const names = ch.devices.changed.map((d) => `${d.name}:${d.fields.join('+')}`).sort().join(' ');
    ok('the changes since the last back-up name Model and Vendor', names === 'PC-1:Vendor SW-1:Model', names);

    // ---- 8. Words ----
    const { MESSAGES } = window.CarinoI18N;
    const want = { es: ['Fabricante', 'Modelo', 'Firmware / SO'], 'pt-BR': ['Fabricante', 'Modelo', 'Firmware / SO'],
      ja: ['メーカー', 'モデル', 'ファームウェア / OS'], ru: ['Производитель', 'Модель', 'Прошивка / ОС'] };
    Object.keys(want).forEach((loc) => {
      const got = ['Vendor', 'Model', 'Firmware / OS'].map((k) => MESSAGES[loc][k]);
      ok(`${loc} carries Vendor, Model and Firmware / OS`, show(got) === show(want[loc]), show(got));
      ok(`${loc} no longer carries the old label`, !('Model / firmware' in MESSAGES[loc]));
    });
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 50); });
