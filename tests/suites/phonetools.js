// @realtime @touch 360x780
// Mobile review batch 5, the tools on a phone (docs/MOBILE.md M35, M36, M37,
// the merge review's head, provider mode on the map), at 360x780 and then
// 390x844, with real touch:
//   1. the search tools (M36): one row under the box, the count and a ⋯
//      whose items press the card's own buttons (Zoom to matches moves the
//      camera, Select matches selects, Save search opens its dialog); the
//      view switch says Map / Table / Rack with a glyph, still named by its
//      word; the rack view's box keeps 140px or more;
//   2. the rack (M35): Elevation / Patch schedule, each the full height,
//      the units with the lists to drag in from, the schedule from its top;
//      another rack starts on the units;
//   3. the merge review (Mobile leftovers): its head compact, so the first
//      row shows whole on the first screen, the file's name as it is;
//   4. provider mode: on the map, not the phone's table, the report's
//      devices ringed and in view, the drawer opening on the report's tab
//      (the library folded); leaving gives the table back; nothing saved;
//   5. M37 (owner decision 2026-11-10): a reduced view's first view
//      is the whole map when it fits at 0.33 or more, else the 0.7 floor.
// No sideways scroll, no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(40); };
  const tap = async (x, y) => {
    await window.__touch('touchStart', [{ x, y, id: 1 }]);
    await window.__touch('touchEnd', []);
    await settle(); await wait(150);
  };
  const tapEl = async (e) => { const r = e.getBoundingClientRect(); await tap(r.left + r.width / 2, r.top + r.height / 2); };
  const shown = (e) => !!e && !e.classList.contains('hidden') && !e.hidden && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  const rect = (e) => e.getBoundingClientRect();
  const json = (v) => JSON.stringify(v);
  const ws = document.querySelector('.ws');
  const drawerOpen = () => ws.classList.contains('drawer-open');
  const typeQuery = async (q) => {
    const input = el('queryInput');
    input.value = q; input.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof flushQuery === 'function') flushQuery();
    await settle(); await wait(120);
  };
  const heldSettings = JSON.parse(JSON.stringify(state.settings));
  const heldLib = CarinoLibrary.loadLibrary();

  const phone = async (size) => {
    const W = innerWidth;
    // ---- 1. The search tools (M36) ----
    replaceDocument(templatesData.house, { origin: 'template' });
    setView('map'); select(null, null); await settle();
    const vs = el('viewSwitch');
    const mapBtn = vs.querySelector('[data-view="map"]');
    ok(`${size}: the view switch is glyphs a finger wide, still named Map and Table`, rect(mapBtn).width >= 44 && rect(mapBtn).width <= 52 && rect(mapBtn).height >= 44
      && mapBtn.textContent.trim() === 'Map' && vs.querySelector('[data-view="table"]').textContent.trim() === 'Table'
      && getComputedStyle(mapBtn, '::before').content.includes('🗺'), json(rect(mapBtn)));
    const pcs = state.nodes.filter((n) => n.type === 'pc' || n.type === 'iot');
    await typeQuery(pcs.length ? `type:${pcs[0].type}` : 'type:router');
    const tools = el('queryTools'), more = el('queryMoreBtn');
    ok(`${size}: the search tools are one row: the count and ⋯`, shown(tools) && rect(tools).height <= 54 && shown(more)
      && ['queryZoomBtn', 'querySelectBtn', 'queryLocateBtn', 'querySaveBtn'].every((id) => !shown(el(id))), json(rect(tools)));
    ok(`${size}: ⋯ is 44x44`, rect(more).width >= 44 && rect(more).height >= 44, json(rect(more)));
    const tb = rect(document.querySelector('.topo-topbar'));
    ok(`${size}: the top bar is two rows at most`, tb.bottom <= 12 + 52 + 8 + 52 + 2, String(tb.bottom));
    const item = (id) => el('queryMorePanel').querySelector(`[data-q-proxy="${id}"]`);
    const openMore = async () => { await tapEl(more); await settle(); return shown(el('queryMorePanel')); };
    const mr = rect(more), hit = document.elementFromPoint(mr.left + mr.width / 2, mr.top + mr.height / 2);
    ok(`${size}: ⋯ opens its menu, on the screen`, await openMore() && rect(el('queryMorePanel')).left >= 0 && rect(el('queryMorePanel')).right <= W + 0.5,
      json(rect(el('queryMorePanel'))) + ' hit=' + (hit && (hit.id || hit.className)) + ' ' + json(mr));
    ok(`${size}: its items are 44 tall, Save's words the button's`, ['queryZoomBtn', 'querySelectBtn', 'querySaveBtn'].every((id) => shown(item(id)) && rect(item(id)).height >= 44)
      && item('querySaveBtn').textContent === el('querySaveBtn').textContent);
    state.camera.x += 400; applyCamera();
    const camBefore = json(state.camera);
    await tapEl(item('queryZoomBtn'));
    ok(`${size}: Zoom to matches frames the matches, and the menu closes`, json(state.camera) !== camBefore && !shown(el('queryMorePanel')));
    await openMore();
    await tapEl(item('querySelectBtn'));
    ok(`${size}: Select matches selects them`, state.selection.size > 0, String(state.selection.size));
    select(null, null); await settle();
    await openMore();
    await tapEl(item('querySaveBtn')); await wait(150);
    ok(`${size}: Save search opens its dialog`, shown(el('searchDialog')));
    const sx = el('searchDialog').querySelector('.modal-x');
    if (sx) await tapEl(sx);
    ok(`${size}: and its ✕ closes it`, !shown(el('searchDialog')));
    await typeQuery('');
    ok(`${size}: no search, no card`, !shown(tools));

    // ---- 2. The rack (M35), Datacenter A01 ----
    replaceDocument(templatesData.datacenter, { origin: 'template' });
    await settle();
    setView('rack'); await settle(); await wait(200);
    const pick = el('rackPicker');
    const racks = [...pick.options];
    const a01 = racks.find((o) => /A01/.test(o.textContent));
    pick.value = a01.value; pick.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(); await wait(200);
    ok(`${size}: the rack view's search box keeps 140px or more`, rect(el('queryInput')).width >= 140, String(rect(el('queryInput')).width));
    const psw = el('rackPaneSwitch');
    ok(`${size}: the rack has the Elevation / Patch schedule switch, 44 tall`, shown(psw) && [...psw.querySelectorAll('button')].every((b) => rect(b).height >= 44),
      psw && json(rect(psw)));
    const main = () => document.querySelector('.rk-main'), sched = () => document.querySelector('.rk-sched');
    const head = rect(document.querySelector('.rk-head')), hb = rect(el('handyBar'));
    ok(`${size}: Elevation is on, the schedule is not`, el('rackView').dataset.pane === 'elev' && shown(main()) && !shown(sched()));
    ok(`${size}: the units take 60% or more of the height under the head`, rect(main()).height >= 0.6 * (hb.top - head.bottom), json([rect(main()).height, head.bottom, hb.top]));
    ok(`${size}: the devices to drag in from are under them`, shown(document.querySelector('.rk-body .rk-unplaced')));
    await tapEl(psw.querySelector('[data-pane="sched"]'));
    const body = document.querySelector('.rk-body');
    ok(`${size}: Patch schedule shows the schedule from its top, not the units`, el('rackView').dataset.pane === 'sched' && shown(sched()) && !shown(main())
      && body.scrollTop === 0 && Math.abs(rect(sched()).top - rect(body).top) <= 12, json([rect(sched()).top, rect(body).top, body.scrollTop]));
    ok(`${size}: the face, the zoom and the cables wait in the units' pane`, !shown(el('rackFaceSwitch')) && !shown(el('rackZoom')) && !shown(document.querySelector('.rk-cablectl')));
    ok(`${size}: the switch says which pane is on`, psw.querySelector('[data-pane="sched"]').getAttribute('aria-pressed') === 'true' && psw.querySelector('[data-pane="elev"]').getAttribute('aria-pressed') === 'false');
    const other = racks.find((o) => o !== a01);
    if (other) {
      pick.value = other.value; pick.dispatchEvent(new Event('change', { bubbles: true }));
      await settle(); await wait(150);
      ok(`${size}: another rack starts on its units`, el('rackView').dataset.pane === 'elev' && shown(main()));
    }
    ok(`${size}: the rack view has no sideways scroll`, document.scrollingElement.scrollWidth <= W, String(document.scrollingElement.scrollWidth));
    setView('map'); await settle();

    // ---- 3. The merge review's head ----
    const FILE = 'topo_clinica-sol_reception_2026-11-10.json';
    const nic = (id, ip) => ({ id, name: 'eth0', ip });
    const dev = (id, name, o = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [] }, o);
    const D = (o = {}) => Object.assign({ v: DOC_VERSION, nodes: [], links: [] }, o);
    const nodes = (notes) => [dev('a', 'Router', { type: 'router', interfaces: [nic('i1', '10.0.0.1/24')], notes }), dev('b', 'PC-1', { x: 120, interfaces: [nic('i1', '10.0.0.11/24')] }),
      ...Array.from({ length: 8 }, (_, i) => dev('p' + i, 'Desk PC ' + i, { x: i * 80, y: 200, interfaces: [nic('i1', '10.0.0.' + (30 + i) + '/24')] }))];
    const MINE = D({ report: { client: 'Clinica Sol', site: 'Reception' }, nodes: nodes('mine'), links: [{ id: 'l1', source: 'a', target: 'b' }] });
    const THEIRS = D({ report: { client: 'Clinica Sol', site: 'Reception' }, nodes: [...nodes('theirs').map((n) => (n.id === 'b' ? Object.assign(n, { name: 'PC-1 front' }) : n)), dev('c', 'Printer', { x: 240, interfaces: [nic('i1', '10.0.0.12/24')] })],
      links: [{ id: 'l1', source: 'a', target: 'b' }, { id: 'l2', source: 'a', target: 'c' }] });
    CarinoLibrary.persistLibrary({ m1: { id: 'm1', name: 'Reception', doc: JSON.parse(JSON.stringify(MINE)), created: 1, updated: 1000 } });
    const merging = TopoMergeDoors.mergeFileIntoCard('m1', THEIRS, FILE);
    for (let i = 0; i < 100 && el('mergeDialog').hidden; i++) await wait(30);
    await settle(); await wait(150);
    ok(`${size}: the merge review is open`, !el('mergeDialog').hidden);
    const first = document.querySelector('#mergeList > li.merge-row');
    const foot = rect(document.querySelector('#mergeDialog .modal-foot'));
    ok(`${size}: its first row shows whole on the first screen`, !!first && rect(first).top <= 420 && rect(first).bottom <= foot.top + 0.5, first && json([rect(first).top, rect(first).bottom, foot.top]));
    const fname = el('mergeTitle').querySelector('.fname');
    ok(`${size}: the file's name is as it is, not upper-cased`, !!fname && fname.textContent === FILE && getComputedStyle(fname).textTransform === 'none', fname && getComputedStyle(fname).textTransform);
    ok(`${size}: the title reads whole`, el('mergeTitle').textContent === `Merge ${FILE} into Reception`, el('mergeTitle').textContent);
    const counts = el('mergeCounts');
    ok(`${size}: the counts are one row that scrolls sideways`, rect(counts).height <= 46 && getComputedStyle(counts).overflowX === 'auto', json(rect(counts)));
    ok(`${size}: Use mine / theirs for all share the kind's row`, Math.abs(rect(el('mergeAllMine')).top - rect(el('mergeKind')).top) < 2 && Math.abs(rect(el('mergeAllTheirs')).top - rect(el('mergeKind')).top) < 2
      && rect(el('mergeAllTheirs')).right <= W, json([rect(el('mergeKind')).top, rect(el('mergeAllMine')).top, rect(el('mergeAllTheirs')).right]));
    const mode = el('mergeMode'), folded = rect(mode).height;
    await tapEl(mode);
    ok(`${size}: a tap on the mode's two lines shows the rest`, mode.classList.contains('open') && rect(mode).height > folded, json([folded, rect(mode).height]));
    await tapEl(mode);
    ok(`${size}: the merge review has no sideways scroll`, document.scrollingElement.scrollWidth <= W);
    await tapEl(el('mergeDialog').querySelector('.modal-x'));
    ok(`${size}: its ✕ closes it`, el('mergeDialog').hidden && (await merging) === null || el('mergeDialog').hidden);
    CarinoLibrary.persistLibrary({});

    // ---- 4. Provider mode, on the map ----
    const PM = window.TopoProviderMode, TI = window.TopoIncidents;
    delete state.settings.view; _tv.defaultView = null; applyView();
    const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    const many = [N('isp', 'cloud', { name: 'Internet' }), N('rt', 'router', { name: 'Router', y: 100 }), N('sw', 'switch', { name: 'Switch', y: 200 })];
    for (let i = 0; i < 12; i++) many.push(N('d' + i, 'pc', { name: 'Desk ' + i, x: -600 + i * 110, y: 340 + (i % 3) * 90 }));
    many.push(N('pc', 'pc', { name: 'Reception PC', x: 900, y: 900 }));
    replaceDocument({ v: DOC_VERSION, report: { client: 'Clinica Sol', site: 'Reception' }, nodes: many,
      links: [{ id: 'l1', source: 'isp', target: 'rt' }, { id: 'l2', source: 'rt', target: 'sw' }, { id: 'l3', source: 'sw', target: 'pc' }] }, { origin: 'link', docId: 'pt-net' });
    await settle();
    ok(`${size}: a phone's first view is the table`, effectiveView() === 'table' && document.body.classList.contains('table-view'));
    const incId = await TI.createIncident({ symptom: 'internet', nodeIds: ['pc'], text: 'Nothing loads.', name: 'Ana', phone: '555-1', remember: false });
    PM.enterProviderMode(incId);
    await settle(); await wait(250); await settle();
    ok(`${size}: provider mode opens on the map`, effectiveView() === 'map' && !document.body.classList.contains('table-view'));
    ok(`${size}: without saving the view`, state.settings.view === undefined, String(state.settings.view));
    const ring = el('ui-node-pc');
    ok(`${size}: the report's device is ringed`, !!ring && ring.classList.contains('inc-hit'));
    const v = mapViewport(), cv = rect(el('networkCanvas')), nr = ring && rect(ring);
    ok(`${size}: and in view`, !!nr && nr.left >= cv.left + v.left && nr.right <= cv.left + v.left + v.width && nr.top >= cv.top + v.top && nr.bottom <= cv.top + v.top + v.height,
      nr && json([nr.left, nr.top, nr.right, nr.bottom, v]));
    await tapEl(el('handyMenu')); await wait(250);
    const vt = el('visitTabBtn');
    ok(`${size}: the drawer opens with the library folded, the report's tab near its top`, drawerOpen() && document.querySelector('.topo-rail').classList.contains('lib-wrapped')
      && shown(vt) && rect(vt).top < 420, json(rect(vt)));
    await tapEl(el('railClose')); await wait(200);
    PM.leaveProviderMode(); await settle();
    ok(`${size}: leaving gives the phone's table back, the library unfolded`, effectiveView() === 'table' && !document.querySelector('.topo-rail').classList.contains('lib-wrapped'));

    // ---- 5. M37: a reduced view's first view ----
    state.settings.advanced = false; state.settings.profile = 'simple'; applyProfile();
    replaceDocument(templatesData.hospital, { origin: 'template' });
    await settle(); await wait(120);
    const hz = state.camera.zoom;
    ok(`${size}: Simple opens the Hospital whole (it fits at 0.33 or more)`, hz < 0.7 && hz >= SIMPLE_OVERVIEW_ZOOM, String(hz));
    replaceDocument(templatesData.datacenter, { origin: 'template' });
    await settle(); await wait(120);
    const dz = state.camera.zoom;
    ok(`${size}: Simple opens the Datacenter whole too (it fits at 0.35 to 0.39)`, dz < 0.7 && dz >= SIMPLE_OVERVIEW_ZOOM, String(dz));
    state.settings.advanced = true; applyProfile();
    replaceDocument(templatesData.hospital, { origin: 'template' });
    await settle(); await wait(120);
    ok(`${size}: the full editor keeps the 0.7 floor for the Hospital`, state.camera.zoom === 0.7, String(state.camera.zoom));
    setView('map');
  };

  try {
    await __media('reduce');
    await document.fonts.ready;
    ok('this page is a 360x780 touch screen', navigator.maxTouchPoints > 0 && innerWidth === 360, `${innerWidth}x${innerHeight}`);
    if (document.body.classList.contains('landing-open')) closeLanding();
    await phone('360x780');
    await __viewport(390, 844); await wait(300); await settle();
    await phone('390x844');
    ok('no console error', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('the suite ran to its end', false, (e && e.stack) || String(e));
  } finally {
    try { if (window.TopoProviderMode.state.on) window.TopoProviderMode.leaveProviderMode(); } catch (e) { /* off */ }
    try { Object.keys(sessionStorage).filter((k) => /^topo_(provider|incbanner)_/.test(k)).forEach((k) => sessionStorage.removeItem(k)); } catch (e) { /* none */ }
    CarinoLibrary.persistLibrary(heldLib);
    Object.keys(state.settings).forEach((k) => { delete state.settings[k]; });
    Object.assign(state.settings, heldSettings);
    try { saveSettings(); applyProfile(); } catch (e) { /* as it was */ }
  }
  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
