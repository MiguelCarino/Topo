// Inventory, stage 5 (docs/BACKLOG.md feature 3, landing order step 13): the
// grouped inventory. What is held here:
//   1. reportInventory (js/report.js), pure: nothing typed is no inventory;
//      one row per vendor, model and firmware, compared without case and
//      with runs of space as one, shown in the most common spelling, counted
//      most first with the Not recorded row last; retired devices counted
//      apart; a model's firmware versions over its devices in service with
//      their counts, "v17.9.4" and "17.9.4" one version (one firmware row
//      too); a blank vendor joining the model's one vendor, apart under two;
//      the mismatch open while the firmware finding is, accepted once it is;
//      a vendor the MAC only suggests not counted;
//   2. the Table's Inventory tab: offered only while a device has a vendor,
//      model or firmware, giving way to Devices when the last one goes; the
//      By switch (Vendor, Model, Firmware / OS columns, per visit), rows
//      read-only, Not recorded muted, a mismatch marked as a finding, a
//      row click selecting its devices (the bulk panel's set), the search
//      keeping a row while one of its devices matches, no Paste a column,
//      Split model and firmware… offered here too, its own hint;
//   3. the report: an Inventory section after the device inventory, only
//      with data, three tables (By vendor, By model, By firmware / OS), the
//      mismatch marked, an accepted one said, no outside URL in it, the
//      same rows as the tab; Spanish headings;
//   4. the words in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const el = (id) => document.getElementById(id);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const open = (nodes) => { replaceDocument({ v: DOC_VERSION, links: [], nodes }, { origin: 'file' }); initHistory(); };
  let x = 0;
  const dev = (id, extra) => ({ id, type: 'switch', name: id.toUpperCase(), x: (x += 80), y: 0, interfaces: [], ...(extra || {}) });
  const rowsOf = (list) => list.map((r) => [r.value, r.count, r.retired]);
  setLocale('en');

  const fixture = () => [
    dev('sw-1', { vendor: 'Cisco', model: 'C9200L', os: '17.9.4' }),
    dev('sw-2', { vendor: 'cisco ', model: 'c9200l', os: 'v17.9.4' }),
    dev('sw-3', { vendor: 'Cisco', model: 'C9200L', os: '17.6.1' }),
    dev('sw-4', { model: 'C9200L', os: '17.9.4' }),                       // blank vendor: joins Cisco
    dev('sw-5', { vendor: 'Cisco', model: 'C9200L', os: '16.0', status: 'retired' }),
    dev('ap-1', { type: 'ap', vendor: 'Ubiquiti', model: 'U6 Lite', os: '6.5.55' }),
    dev('pc-1', { type: 'pc', os: 'Windows 11' }),
    dev('pc-2', { type: 'pc', interfaces: [{ id: 'i1', name: 'eth0', mac: '00:14:22:01:02:03' }] })   // a Dell MAC, no vendor typed
  ];

  try {
    // ---- 1. reportInventory ----
    open([dev('a'), dev('b')]);
    let inv = reportInventory();
    ok('nothing typed: no inventory', inv.any === false && !inv.vendors.length && !inv.models.length && !inv.firmware.length, show(inv));

    open(fixture());
    inv = reportInventory();
    ok('one row per vendor in its most common spelling, most first, Not recorded last, retired apart',
       show(rowsOf(inv.vendors)) === show([['Cisco', 3, 1], ['Ubiquiti', 1, 0], ['', 3, 0]]), show(rowsOf(inv.vendors)));
    const notRec = inv.vendors[inv.vendors.length - 1];
    ok('the Not recorded row holds every device with none, in the map\'s order', show(notRec.nodeIds) === show(['sw-4', 'pc-1', 'pc-2']), show(notRec.nodeIds));
    ok('a vendor the MAC only suggests is not counted', macVendorSuggestion(getNode('pc-2')) && !inv.vendors.some((r) => r.value === 'Dell'));
    ok('one row per model, a blank vendor joining the model\'s one vendor',
       show(inv.models.map((r) => [r.vendor, r.model, r.count, r.retired])) === show([['Cisco', 'C9200L', 4, 1], ['Ubiquiti', 'U6 Lite', 1, 0], ['', '', 2, 0]]),
       show(inv.models.map((r) => [r.vendor, r.model, r.count, r.retired])));
    const c9 = inv.models[0];
    ok('its value is vendor and model', c9.value === 'Cisco C9200L', c9.value);
    ok('its firmware versions over the devices in service, most first, v17.9.4 one with 17.9.4',
       show(c9.firmware) === show([{ value: '17.9.4', count: 3 }, { value: '17.6.1', count: 1 }]), show(c9.firmware));
    ok('the mismatch is open, as the firmware finding is', c9.mismatch === 'open' && inv.models[1].mismatch === '', show([c9.mismatch, inv.models[1].mismatch]));
    ok('one firmware row per version, v17.9.4 with 17.9.4',
       show(rowsOf(inv.firmware)) === show([['17.9.4', 3, 0], ['6.5.55', 1, 0], ['17.6.1', 1, 0], ['Windows 11', 1, 0], ['16.0', 0, 1], ['', 1, 0]]),
       show(rowsOf(inv.firmware)));
    ok('every row\'s ids name its devices', show(inv.firmware[0].nodeIds) === show(['sw-1', 'sw-2', 'sw-4']) && show(inv.firmware[0].names) === show(['SW-1', 'SW-2', 'SW-4']));

    // A model under two vendors: the blank one stays apart.
    open([dev('a', { vendor: 'Cisco', model: 'X1', os: '1' }), dev('b', { vendor: 'Acme', model: 'X1', os: '1' }), dev('c', { model: 'X1', os: '2' })]);
    inv = reportInventory();
    ok('under two vendors a blank vendor makes a model row of its own',
       show(inv.models.map((r) => [r.vendor, r.model, r.count])) === show([['Acme', 'X1', 1], ['Cisco', 'X1', 1], ['', 'X1', 1]]), show(inv.models.map((r) => [r.vendor, r.model, r.count])));

    // The blank vendor joins as the finding joins it: a second vendor only on
    // a device with no firmware, or a retired one, does not keep it apart.
    [['no firmware', { os: '' }], ['retired', { os: '3', status: 'retired' }]].forEach(([why, extra]) => {
      open([dev('a', { vendor: 'Cisco', model: 'X', os: '1' }), dev('b', { model: 'X', os: '2' }), dev('c', { vendor: 'Juniper', model: 'X', ...extra })]);
      const f = topologyFindings().filter((g) => g.key === 'firmware');
      const ms = reportInventory().models;
      const cx = ms.find((r) => r.value === 'Cisco X');
      ok('a second vendor on a device with ' + why + ': the blank one joins Cisco, as the finding does',
         f.length === 1 && show(f[0].nodeIds.slice().sort()) === show(['a', 'b']) && !!cx && cx.mismatch === 'open'
         && show(cx.firmware.map((v) => v.value).sort()) === show(['1', '2']) && show(cx.nodeIds) === show(['a', 'b'])
         && !ms.some((r) => r.value === 'X'),
         show(ms.map((r) => [r.value, r.firmware, r.mismatch])));
    });
    // A vendor or model with a "|" in it does not run into another pair.
    open([dev('p', { vendor: 'A|B', model: 'C' }), dev('q', { vendor: 'A', model: 'B|C' })]);
    ok('"A|B" "C" and "A" "B|C" are two models', show(reportInventory().models.map((r) => [r.vendor, r.model, r.count])) === show([['A', 'B|C', 1], ['A|B', 'C', 1]]),
       show(reportInventory().models.map((r) => [r.vendor, r.model, r.count])));

    // Accepted.
    open(fixture());
    acceptFindings(topologyFindings().filter((f) => f.key === 'firmware'), 'Upgrading in the spring');
    ok('an accepted firmware finding: the mismatch says accepted', reportInventory().models[0].mismatch === 'accepted', reportInventory().models[0].mismatch);

    // ---- 2. The Table's Inventory tab ----
    open([dev('a'), dev('b')]);
    setView('table'); showTableTab('devices');
    const tabBtn = () => document.querySelector('#tableView [data-tvtab="inventory"]');
    ok('not offered while no device has a vendor, model or firmware', tabBtn().classList.contains('hidden') && !tvTabOffered('inventory'));
    open(fixture());
    renderTableView(true);
    ok('offered once one has', !tabBtn().classList.contains('hidden') && tvTabOffered('inventory') && tabBtn().textContent === 'Inventory');
    showTableTab('inventory');
    const heads = () => [...el('tvGrid').querySelectorAll('thead th[data-col]')].map((th) => th.textContent.replace(/[▲▼]/g, '').trim());
    const cells = () => [...el('tvGrid').querySelectorAll('tbody tr[data-row]')].map((tr) => [...tr.querySelectorAll('td[data-col]')].map((td) => td.textContent));
    ok('By vendor first: Vendor, Devices, Retired, Members', show(heads()) === show(['Vendor', 'Devices', 'Retired', 'Members']), show(heads()));
    ok('the By switch shows, By vendor pressed', !el('tvInvBy').classList.contains('hidden')
       && el('tvInvBy').querySelector('[data-invby="vendor"]').getAttribute('aria-pressed') === 'true');
    ok('one row per vendor, as reportInventory counts them', show(cells().map((c) => c.slice(0, 3))) === show([['Cisco', '3', '1'], ['Ubiquiti', '1', '—'], ['Not recorded', '3', '—']]), show(cells()));
    ok('Not recorded is muted', el('tvGrid').querySelector('tbody tr:last-child td[data-col="inv:vendor"]').classList.contains('tv-muted'));
    ok('the Members cell lists the devices', cells()[0][3] === 'SW-1, SW-2, SW-3, SW-5', cells()[0][3]);
    ok('rows are read-only', !el('tvGrid').querySelector('tbody td.tv-edit'));
    ok('no Paste a column here, Split model and firmware… offered while there is text to split',
       el('tvPasteBtn').classList.contains('hidden') && el('tvColsBtn').classList.contains('hidden'));
    ok('its own hint', !el('tvInvHint').classList.contains('hidden') && el('tvHint').classList.contains('hidden'));

    el('tvInvBy').querySelector('[data-invby="model"]').click();
    ok('By model: Vendor, Model, Devices, Retired, Firmware / OS, Members', show(heads()) === show(['Vendor', 'Model', 'Devices', 'Retired', 'Firmware / OS', 'Members']), show(heads()));
    ok('the model rows with their versions', show(cells().map((c) => c.slice(0, 5))) === show([['Cisco', 'C9200L', '4', '1', '17.9.4 × 3; 17.6.1 × 1'], ['Ubiquiti', 'U6 Lite', '1', '—', '6.5.55 × 1'], ['—', 'Not recorded', '2', '—', '—']]), show(cells()));
    const vcell = el('tvGrid').querySelector('tbody tr:first-child td[data-col="inv:versions"]');
    ok('a mismatch is marked as a finding is', vcell.classList.contains('tv-sev') && vcell.classList.contains('warn') && !!vcell.title, vcell.className);
    ok('one with one version is not', !el('tvGrid').querySelector('tbody tr:nth-child(2) td[data-col="inv:versions"]').classList.contains('tv-sev'));

    el('tvInvBy').querySelector('[data-invby="firmware"]').click();
    ok('By firmware / OS: Firmware / OS, Devices, Retired, Members', show(heads()) === show(['Firmware / OS', 'Devices', 'Retired', 'Members']), show(heads()));
    ok('the firmware rows', cells()[0][0] === '17.9.4' && cells()[0][1] === '3' && cells().length === 6, show(cells()));

    // A row click selects its devices.
    el('tvInvBy').querySelector('[data-invby="vendor"]').click();
    const firstTd = el('tvGrid').querySelector('tbody tr:first-child td[data-col="inv:count"]');
    const undoBefore = _undoStack.length;
    firstTd.click();
    const sel = [...state.selection].filter((e) => e.type === 'node').map((e) => e.id).sort();
    ok('a row click selects its devices', show(sel) === show(['sw-1', 'sw-2', 'sw-3', 'sw-5']), show(sel));
    ok('which is the set Change all of them works on', bulkKind() === 'node' && bulkSet().length === 4, String(bulkKind()));
    ok('and writes nothing', _undoStack.length === undoBefore, String(_undoStack.length));

    // The search keeps a row while one of its devices matches.
    setQuery('type:ap');
    ok('the search keeps the rows one of whose devices matches', show(cells().map((c) => c[0])) === show(['Ubiquiti']), show(cells()));
    setQuery('');
    // vlan: asks a device, not a subnet: a row has no network of its own, so
    // only the device's own reading keeps it.
    replaceDocument({ v: DOC_VERSION, links: [], networks: [{ id: 'n20', cidr: '10.0.20.0/24', name: 'Voice', vlan: 20 }],
      nodes: [dev('v1', { vendor: 'Cisco', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.5' }] }), dev('v2', { vendor: 'Netgear' })] }, { origin: 'file' });
    initHistory();
    showTableTab('inventory');
    setQuery('vlan:20');
    ok('vlan: keeps the row whose device is on the VLAN, by the device', show(cells().map((c) => c[0])) === show(['Cisco']), show(cells()));
    setQuery('');

    // Sorting by a value column keeps Not recorded last, either way.
    open(fixture());
    showTableTab('inventory');
    const col0 = () => cells().map((c) => c[0]);
    _tv.sort.inventory = { col: 'inv:vendor', dir: 1 }; renderTableView(true);
    const up = col0();
    _tv.sort.inventory = { col: 'inv:vendor', dir: -1 }; renderTableView(true);
    const down = col0();
    ok('sorted by Vendor, Not recorded stays last both ways', show(up) === show(['Cisco', 'Ubiquiti', 'Not recorded']) && show(down) === show(['Ubiquiti', 'Cisco', 'Not recorded']), show([up, down]));
    el('tvInvBy').querySelector('[data-invby="model"]').click();
    _tv.sort.inventory = { col: 'inv:model', dir: -1 }; renderTableView(true);
    ok('sorted by Model, Not recorded stays last', show(cells().map((c) => c[1])) === show(['U6 Lite', 'C9200L', 'Not recorded']), show(cells()));
    _tv.sort.inventory = { col: 'inv:retired', dir: -1 }; renderTableView(true);
    ok('sorted by Retired, by the number', cells()[0][1] === 'C9200L', show(cells()));
    _tv.sort.inventory = null;
    el('tvInvBy').querySelector('[data-invby="vendor"]').click();

    // Ticked rows select their devices together.
    const top = () => _tv.rows.filter((r) => !r.sub);
    checkRows(top().slice(0, 2), true);
    const ticked = [...state.selection].filter((e) => e.type === 'node').map((e) => e.id).sort();
    ok('ticking two rows selects both rows\' devices, the set Change all of them works on',
       show(ticked) === show(['ap-1', 'sw-1', 'sw-2', 'sw-3', 'sw-5']) && bulkSet().length === 5, show(ticked));
    checkRows(top().slice(0, 1), false);
    ok('unticking one leaves the other\'s', show([...state.selection].map((e) => e.id)) === show(['ap-1']), show([...state.selection]));
    el('tvGrid').querySelector('tbody tr:first-child td[data-col="inv:count"]').click();
    ok('a plain click is a set of one row again', show([..._tv.checked.inventory]) === show([top()[0].key]) && state.selection.size === 4,
       show([..._tv.checked.inventory]));

    // The By choice is per visit; the tab gives way when the last value goes.
    el('tvInvBy').querySelector('[data-invby="model"]').click();
    ok('the By choice is not saved with the network', !JSON.stringify(serializeDoc()).includes('invBy') && !JSON.stringify(state.settings).includes('invBy'));
    open([dev('a', { os: 'X' })]);
    renderTableView(true);
    ok('a network with only firmware still offers it', _tv.tab === 'inventory');
    open([dev('a')]);
    renderTableView(true);
    ok('with none left the tab gives way to Devices', _tv.tab === 'devices' && tabBtn().classList.contains('hidden'));

    // Split model and firmware… on this tab too.
    open([dev('a', { os: 'C9200L-24P / IOS-XE 17.9.4' })]);
    showTableTab('inventory');
    ok('Split model and firmware… on the Inventory tab', !el('tvSplitBtn').classList.contains('hidden'));
    state.readOnly = true; renderTableView(true);
    ok('not on a read-only network', el('tvSplitBtn').classList.contains('hidden'));
    state.readOnly = false;
    showTableTab('devices');
    ok('back on Devices: Paste a column and the hint again', !el('tvPasteBtn').classList.contains('hidden') && !el('tvHint').classList.contains('hidden')
       && el('tvInvBy').classList.contains('hidden'));
    setView('map');

    // ---- 3. The report ----
    open([dev('a'), dev('b')]);
    let html = reportHtml(reportModel(), null, { technical: true });
    ok('no section with nothing typed', !html.includes('<h2>Inventory</h2>') && !reportModel().inventory.any);
    open(fixture());
    const model = reportModel();
    html = reportHtml(model, null, { technical: true });
    const at = html.indexOf('<h2>Inventory</h2>');
    ok('an Inventory section after the device inventory, before Connections', at > html.indexOf('<h2>Device inventory</h2>') && at < html.indexOf('<h2>Connections</h2>'), String(at));
    const part = html.slice(at, html.indexOf('<h2>', at + 5));
    ok('three tables: By vendor, By model, By firmware / OS', part.includes('<h3>By vendor</h3>') && part.includes('<h3>By model</h3>') && part.includes('<h3>By firmware / OS</h3>')
       && (part.match(/<table class="invsum">/g) || []).length === 3);
    ok('the model\'s versions, the mismatch marked', part.includes('<span class="sev warn">17.9.4 × 3; 17.6.1 × 1</span>'), part);
    ok('Not recorded and the retired count', part.includes('Not recorded') && part.includes('<td class="n"><span class="muted">1</span></td>'));
    ok('no outside URL and no link in it', !/https?:|<a\b|src=/.test(part));
    ok('a suggested vendor is not printed', !part.includes('Dell'));
    ok('the same rows as the tab', show(model.inventory.vendors.map((r) => r.value)) === show(reportInventory().vendors.map((r) => r.value)));
    acceptFindings(topologyFindings().filter((f) => f.key === 'firmware'), 'Spring');
    const accHtml = inventorySection(reportModel().inventory);
    ok('an accepted mismatch is said, not marked', !accHtml.includes('sev warn') && accHtml.includes('17.9.4 × 3; 17.6.1 × 1 <span class="muted">· Accepted</span>'), accHtml);
    ok('the summary alone prints no Inventory section', !reportHtml(reportModel(), null, { summary: true, technical: false }).includes('<h2>Inventory</h2>'));

    setLocale('es');
    const es = reportHtml(reportModel(), null, { technical: true });
    ok('Spanish headings', es.includes('<h2>Inventario</h2>') && es.includes('<h3>Por fabricante</h3>') && es.includes('<h3>Por modelo</h3>')
       && es.includes('<h3>Por firmware / SO</h3>') && es.includes('Sin registrar'));
    setLocale('en');

    // ---- 4. The words ----
    const keys = ['Inventory', 'By vendor', 'By model', 'By firmware / OS', 'Not recorded', 'Members', 'Retired', 'Accepted',
      'Click a row to select its devices, then use Change all of them to edit them together.',
      'Devices counts the ones in service or planned; retired ones are counted apart.'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((lang) => {
      setLocale(lang);
      const missing = keys.filter((k) => t(k) === k);
      ok(`${lang}: every new word translated`, !missing.length, show(missing));
    });
    setLocale('ja');
    ok('ja: By vendor says メーカー', t('By vendor').includes('メーカー'), t('By vendor'));
    setLocale('en');
  } catch (e) {
    ok('suite ran without throwing', false, e && e.stack);
  } finally {
    state.readOnly = false;
    setLocale('en');
    setDialogResponder(heldResponder);
  }

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
