// The patch schedule (Review-Packs/Topo-groups.md, "Round 5", R5b;
// rackSchedule in js/model.js, "The patch schedule" in js/rackview.js, the
// Racks section in js/report.js). What is held here:
//   1. the rows, pure: a row per cable that touches the rack, read from the
//      higher end, in the rack's order (the device's top unit, then its
//      ports in order, a cable with no port last); a guest named on its
//      host; a cable out of the rack saying where it goes;
//   2. the panel: beside the rack, a row each with the device and its port,
//      the tag ("no tag" when none), the far end, the colour, the length
//      and the via; sorted by any column, again for the other way, blanks
//      last whichever way, a view (no undo step, nothing in the document);
//   3. a row: a click selects its cable, the filter goes to One cable (kept
//      in this browser), the cable is the one drawn bold and the rest faint,
//      and the elevation scrolls its end into sight; a cable selected on the
//      elevation lights its row, a selected device marks its rows;
//   4. the report: after each elevation, the rack's patch schedule in the
//      rack's order, an untagged cable saying so; the elevation drawn with
//      ports;
//   5. the CSV: the cables sheet carries every column of the schedule, and
//      the sheets read into a blank map give the same schedule back;
//   6. Spanish.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  const held = {};
  try { ['topo.rackZoom', 'topo.rackCables'].forEach((k) => { held[k] = localStorage.getItem(k); localStorage.removeItem(k); }); } catch (e) { /* blocked */ }
  _rv.zoom = 1; _rv.cables = 'sel';
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };

  const NIC = (...names) => names.map((name, k) => ({ id: `e${k + 1}`, name, ip: '' }));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [], group: 'rk' }, extra);
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('sw', 'switch', { rackU: 20, rackDepth: 'half', portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 } }),
      N('srv', 'server', { rackU: 10, rackHeight: 2, interfaces: NIC('eno1', 'eno2') }),
      N('hv', 'server', { rackU: 14, rackHeight: 2, interfaces: NIC('eth0') }),
      N('vm1', 'vm', { host: 'hv', interfaces: [{ id: 'v1', name: 'eth0', ip: '' }] }),
      N('nas', 'server', { interfaces: NIC('eth0') }),
      N('pc', 'pc', { group: 'off', interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] })
    ],
    links: [
      { id: 'c1', source: 'sw', target: 'srv', sourceIface: 'p1', targetIface: 'e1', cable: { label: 'A-01', color: 'blue', length: '2 m', via: 'PP-1:1' } },
      { id: 'c2', source: 'srv', target: 'sw', sourceIface: 'e2', targetIface: 'p2', cable: { label: 'A-02', color: 'red', length: '10 m' } },
      { id: 'c3', source: 'vm1', target: 'sw', sourceIface: 'v1', targetIface: 'p3', cable: { label: 'B-07', length: '1 m', via: 'PP-1:3' } },
      { id: 'c4', source: 'pc', target: 'sw', sourceIface: 'i1', targetIface: 'p24', cable: { color: 'green' } },
      { id: 'c5', source: 'nas', target: 'sw', sourceIface: 'e1', targetIface: 'p5', cable: { via: 'PP-2:5' } },
      // No port picked at the switch.
      { id: 'c6', source: 'hv', target: 'sw', sourceIface: 'e1' }
    ],
    groups: [{ id: 'room', name: 'Server room', kind: 'room' }, { id: 'rk', name: 'Rack S', kind: 'rack', parent: 'room', uHeight: 24 },
      { id: 'off', name: 'Office', kind: 'room' }] });
  const open = () => { replaceDocument(site(), { origin: 'file', docId: 'rack-schedule' }); initHistory(); setView('rack'); openRackView('rk'); select(null); renderRackView(true); };
  const view = () => el('rackView');
  const panel = () => view().querySelector('.rk-sched');
  const rowIds = () => [...view().querySelectorAll('.rk-srow')].map((r) => r.dataset.link).join();
  const cells = (id) => { const r = view().querySelector(`.rk-srow[data-link="${id}"]`); return r ? [...r.cells].map((c) => c.textContent.trim()) : []; };
  const head = (key) => view().querySelector(`[data-rk-sort="${key}"]`);
  const sig = () => rackSchedule(groupById('rk')).map((r) => [rackScheduleEnd(r), rackScheduleEnd(r, true), r.where, r.tag, r.color, r.length, r.via].join('|')).join('\n');

  try {
    // ---- 1: the rows, pure ----
    open();
    const rk = groupById('rk');
    const sch = rackSchedule(rk);
    ok('a row per cable that touches the rack, in the rack\'s order: the switch on top, its ports in order, no port last',
       sch.map((r) => r.link.id).join() === 'c1,c2,c3,c5,c4,c6', sch.map((r) => r.link.id).join());
    ok('read from the higher end, the port as the faceplate names it', rackScheduleEnd(sch[1]) === 'SW · Gi1/0/2' && rackScheduleEnd(sch[1], true) === 'SRV · eno2');
    ok('a guest named on its host', rackScheduleEnd(sch[2], true) === 'VM1 on HV · eth0' && sch[2].farBox.id === 'hv' && sch[2].farIn);
    ok('a cable out of the rack says where it goes', !sch[4].farIn && sch[4].where === 'Office');
    ok('no port picked says so', rackScheduleEnd(sch[5]) === 'SW · no port' && sch[5].port === '');
    ok('each row\'s tag, colour, length and via', json([sch[0].tag, sch[0].color, sch[0].length, sch[0].via]) === json(['A-01', 'blue', '2 m', 'PP-1:1']));

    // ---- 2: the panel ----
    ok('the panel is beside the rack, a row per cable', !!panel() && !!panel().closest('.rk-side') && rowIds() === 'c1,c2,c3,c5,c4,c6', rowIds());
    ok('the heads: device and port, tag, far end, colour, length, via', [...panel().querySelectorAll('thead .rk-sort')].map((b) => b.textContent.replace(/[▲▼]/g, '').trim()).join('|')
       === 'Device · port|Tag|Far end|Colour|Length|Via');
    ok('a row says it all', json(cells('c1')) === json(['SW · Gi1/0/1', 'A-01', 'SRV · eno1', 'blue', 'Length: 2 m', 'Via: PP-1:1'])
       || json(cells('c1').map((c) => c.replace(/^(Length|Via): /, ''))) === json(['SW · Gi1/0/1', 'A-01', 'SRV · eno1', 'blue', '2 m', 'PP-1:1']), json(cells('c1')));
    ok('the colour has its swatch', !!view().querySelector('.rk-srow[data-link="c1"] .rk-swatch'));
    ok('an untagged cable says no tag', ['c4', 'c5', 'c6'].every((id) => cells(id)[1] === 'no tag') && cells('c4')[2].includes('Office'));
    ok('sorted by device by default, marked', head('dev').classList.contains('active') && head('dev').closest('th').getAttribute('aria-sort') === 'ascending');
    const depth = _undoStack.length;
    const sortBy = (key) => { head(key).click(); return rowIds(); };
    const orders = {};
    orders.devDown = sortBy('dev');
    orders.tag = sortBy('tag');
    orders.tagDown = sortBy('tag');
    orders.far = sortBy('far');
    orders.color = sortBy('color');
    orders.length = sortBy('length');
    orders.via = sortBy('via');
    ok('the device again: from the bottom up', orders.devDown === 'c6,c4,c5,c3,c2,c1', orders.devDown);
    ok('by tag, untagged last; the other way, still last', orders.tag === 'c1,c2,c3,c5,c4,c6' && orders.tagDown === 'c3,c2,c1,c5,c4,c6', `${orders.tag} / ${orders.tagDown}`);
    ok('by far end', orders.far === 'c6,c5,c4,c1,c2,c3', orders.far);
    ok('by colour', orders.color === 'c1,c4,c2,c3,c5,c6', orders.color);
    ok('by length, numbers in order (2 m before 10 m)', orders.length === 'c3,c1,c2,c5,c4,c6', orders.length);
    ok('by via', orders.via === 'c1,c3,c5,c2,c4,c6', orders.via);
    ok('the head says which, and which way', head('via').classList.contains('active') && head('via').closest('th').getAttribute('aria-sort') === 'ascending'
       && head('dev').closest('th').getAttribute('aria-sort') === 'none');
    ok('sorting is a view: no undo step, nothing in the document', _undoStack.length === depth && !json(serializeDoc()).includes('"sort"'));
    head('dev').click();

    // ---- 3: a row ----
    ok('the filter starts on Selected', _rv.cables === 'sel');
    // The units three times as tall, scrolled to the bottom: the switch
    // near the top is out of the pane until the row brings it in.
    setRackZoom(3);
    rvPane().scrollTop = rvPane().scrollHeight;
    // The pane is asked for afresh: a rebuild makes a new one.
    const inPane = (id) => { const b = view().querySelector(`.rk-dev:not(.rk-back)[data-node="${id}"]`), p = rvPane().getBoundingClientRect(); if (!b) return false; const r = b.getBoundingClientRect(); return r.bottom > p.top && r.top < p.bottom; };
    const wasOut = !inPane('sw');
    view().querySelector('.rk-srow[data-link="c2"] .rk-stag').click();
    let lit = [...view().querySelectorAll('.rk-wiring .rk-cable')];
    ok('a row\'s click selects its cable', json([...state.selection]) === json([{ type: 'link', id: 'c2' }]), json([...state.selection]));
    // For this visit only: a row is not the filter, so the one the person
    // keeps (here the default) is what a reload opens on.
    ok('and traces it in One cable mode, for this visit only', _rv.cables === 'one' && view().querySelector('#rackCables [data-cables="one"]').classList.contains('active')
       && (() => { try { return localStorage.getItem('topo.rackCables') === null && rvLoadCables() === 'sel'; } catch (e) { return true; } })());
    ok('the one cable bold, the rest faint', lit.filter((g) => g.classList.contains('rk-wsel')).map((g) => g.dataset.key).join() === 'c2'
       && lit.filter((g) => g.dataset.key !== 'c2').every((g) => g.classList.contains('rk-faint')), lit.map((g) => `${g.dataset.key}:${g.getAttribute('class')}`).join(' '));
    ok('its row lit', view().querySelector('.rk-srow[data-link="c2"]').classList.contains('rk-ssel') && view().querySelectorAll('.rk-srow.rk-ssel').length === 1);
    ok('the elevation brings its end into sight', wasOut && inPane('sw'), `${wasOut} ${inPane('sw')}`);
    ok('the rail shows the cable', state.selectedType === 'link' && state.selectedId === 'c2');
    ok('a row is no undo step', _undoStack.length === depth);
    // The row's button, from the keyboard.
    const btn = view().querySelector('.rk-srow[data-link="c5"] .rk-slink');
    btn.focus();
    btn.click();
    ok('its button does the same, and keeps the focus', state.selectedId === 'c5' && document.activeElement && document.activeElement.dataset.rkSched === 'c5');
    setRackZoom(1);
    // A cable selected on the elevation lights its row; a device its rows.
    selectEntries([{ type: 'link', id: 'c4' }]);
    ok('a cable selected elsewhere lights its row', view().querySelector('.rk-srow[data-link="c4"]').classList.contains('rk-ssel'));
    setRackCables('sel');
    select('srv', 'node');
    ok('a selected device marks its rows', [...view().querySelectorAll('.rk-srow.rk-smine')].map((r) => r.dataset.link).join() === 'c1,c2');
    select('hv', 'node');
    ok('a host marks its guest\'s rows too', [...view().querySelectorAll('.rk-srow.rk-smine')].map((r) => r.dataset.link).join() === 'c3,c6');
    select(null);

    // ---- 4: the report ----
    const doc = new DOMParser().parseFromString(reportHtml(reportModel(), null), 'text/html');
    const patch = doc.querySelector('.rack table.patch');
    const prows = patch ? [...patch.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent.trim())) : [];
    ok('the report has the rack\'s patch schedule after its elevation', !!patch && !!patch.previousElementSibling && patch.closest('.rack').querySelector('.elevs')
       && patch.compareDocumentPosition(patch.closest('.rack').querySelector('.elevs')) & Node.DOCUMENT_POSITION_PRECEDING);
    ok('a row per cable, in the rack\'s order, every column', prows.length === 6 && json(prows[0]) === json(['SW · Gi1/0/1', 'A-01', 'SRV · eno1', 'blue', '2 m', 'PP-1:1']), json(prows[0]));
    ok('a guest on its host, a cable out of the rack, an untagged one', prows[2][2] === 'VM1 on HV · eth0' && prows[4][2] === 'PC · eth0 (Office)' && prows[4][1] === 'no tag' && prows[5][0] === 'SW · no port');
    const cellOf = (face, name) => [...doc.querySelectorAll('table.elev')][face === 'rear' ? 1 : 0].querySelectorAll('td.rs')
      && [...[...doc.querySelectorAll('table.elev')][face === 'rear' ? 1 : 0].querySelectorAll('td.rs')].find((td) => td.querySelector('b') && td.querySelector('b').textContent === name);
    const swCell = cellOf('front', 'SW'), srvBack = cellOf('rear', 'SRV');
    ok('the elevation draws the switch\'s ports at the front, the cabled filled', !!swCell && swCell.querySelectorAll('.pm').length === 24 && swCell.querySelectorAll('.pm.on').length === 5);
    ok('and a server\'s at its back, where its ports are', !!srvBack && srvBack.classList.contains('back') && srvBack.querySelectorAll('.pm.on').length === 2
       && !cellOf('front', 'SRV').querySelector('.pstrip'));

    // ---- 5: the CSV ----
    const want = sig();
    const cables = csvCablesSheet();
    ok('the cables sheet has a column for everything the schedule shows', ['from_name', 'from_port', 'to_name', 'to_port', 'cable_label', 'cable_color', 'cable_length', 'cable_via'].every((h) => cables.headers.includes(h)), cables.headers.join());
    const sheets = [csvGroupsSheet(), csvDevicesSheet(), csvInterfacesSheet(), cables].map((s) => csvText(s));
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file', docId: 'rack-schedule-blank' });
    const conflicts = [];
    sheets.forEach((text) => {
      const s = sheetOf(text);
      const plan = csvPlan(s, csvAutoMap(s), { createGroups: true });
      plan.rows.filter((r) => r.status === 'conflict').forEach((r) => conflicts.push(`${r.name}: ${r.why}`));
      applyCsvPlan(plan);
    });
    const got = sig();
    ok('the devices sheet writes no "—" for a port nobody picked (the import refused the row)', !sheets[1].includes('—') && /\nhv,server,HV,/.test(sheets[1]));
    ok('read into a blank map, the schedule comes back the same', !conflicts.length && got === want, `${conflicts.slice(0, 2).join(' | ')} :: ${got.split('\n').filter((l, i) => l !== want.split('\n')[i]).slice(0, 2).join(' ; ')}`);

    // A patch list's blank port: none at a faceplate, the NIC at a host.
    open();
    batch(() => { state.links = state.links.filter((l) => l.id !== 'c6'); save(); });
    const blank = sheetOf('from_device,from_port,to_device,to_port\nhv,,sw,');
    const bplan = csvPlan(blank, csvAutoMap(blank));
    applyCsvPlan(bplan);
    const made = state.links.find((l) => l.source === 'hv' && l.target === 'sw');
    ok('a new cable with a blank faceplate port has no port there; a host\'s blank one is its NIC', !!made && made.targetIface == null && made.sourceIface === 'e1', json(made));

    // ---- 6: Spanish ----
    open();
    setLocale('es');
    renderRackView(true);
    ok('in Spanish: the heads and no tag', head('tag').textContent.includes('Etiqueta') && head('far').textContent.includes('Otro extremo')
       && cells('c4')[1] === 'sin etiqueta' && panel().querySelector('.rk-sub').textContent.includes('Lista de conexiones'));
    setLocale('en');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    setDialogResponder(heldResponder);
    _rv.zoom = 1; _rv.cables = 'sel'; _rv.sort = { key: 'dev', dir: 1 };
    try { Object.entries(held).forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }); } catch (e) { /* blocked */ }
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
