// @realtime @touch 780x360
// A phone held sideways (Mobile review M31): the phone's layout under
// "(max-height: 500px) and (max-width: 932px) and (pointer: coarse)" as well
// as at 900px and below (DRAWER_MQ, PHONE_LAYOUT_MQ in js/state.js; css/app.css).
// At 780x360: the navbar waits above the top edge; the drawer opens from the
// handy bar's ☰ and closes from its ✕; the bars at the bottom are one row
// (the handy bar on the right, the document or selection bar on its left),
// 40% of the height or less; the zoom column is wholly on screen and clear
// of the handy bar; the table's rows get 150px or more, the rack's body too;
// the map frames into the strip the bars leave; the rack has its pane
// switch (M35) and the report its finger-sized ✕ over an opaque foot of
// Print and Download (M34). Then 932x430 (a large phone
// on its side, past carino-ui's 900px drawer): the drawer is Topo's copy of
// it, the handy bar shows, the navbar is hidden. In both, with findings, a
// search on and provider mode, the findings pill leaves every zoom button
// its centre. Then 960x430, a tablet typing: its rail stays docked. No
// sideways scroll, no console error.
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
  const navAway = () => {
    const nav = el('carinoNav');
    const h = getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim();
    return (h === '0px' || h === '0') && (!nav || rect(nav).bottom <= 0 || getComputedStyle(nav).visibility === 'hidden');
  };
  const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  const sideways = async (size) => {
    const W = innerWidth, H = innerHeight;
    replaceDocument(templatesData.house, { origin: 'template' });
    setView('map'); select(null, null);
    fitToView(null, { initial: true });
    await settle(); await wait(150);
    ok(`${size}: the drawer's layout and the phone's are on`, mqMatches(DRAWER_MQ) && mqMatches(PHONE_LAYOUT_MQ) && !phoneView(), `${W}x${H}`);
    ok(`${size}: the navbar waits above the top edge`, navAway(), getComputedStyle(document.documentElement).getPropertyValue('--nav-h'));
    ok(`${size}: the map is the first view (not the phone's table)`, !document.body.classList.contains('table-view'));
    const hb = rect(el('handyBar')), zc = rect(document.querySelector('.zoom-ctl'));
    ok(`${size}: the handy bar shows, on the right`, shown(el('handyBar')) && hb.left > W / 2 - 40 && hb.bottom <= H, json(hb));
    ok(`${size}: the zoom column is wholly on screen`, zc.top >= 0 && zc.bottom <= H && zc.right <= W, json([zc.top, zc.bottom]));
    ok(`${size}: the zoom column is clear of the handy bar`, !overlap(zc, hb), json([zc.left, hb.right]));
    const v = mapViewport();
    ok(`${size}: the map frames above the bars`, v.top > 0 && v.top + v.height <= rect(el('handyBar')).top - rect(el('networkCanvas')).top + 0.5, json(v));
    // The findings pill and the zoom column: with findings, a search on
    // and provider mode's strip pushing the pill down, every zoom button
    // still owns its centre (the pill sits left of the column).
    const zoomStolen = () => [...document.querySelectorAll('.zoom-ctl button')].filter(shown).map((b) => {
      const r = rect(b), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return b.contains(h) ? null : `${b.id}->${h ? (h.closest('[id]') || h).id || h.tagName : 'none'}`;
    }).filter(Boolean);
    const broken = state.nodes.find((n) => (n.interfaces || []).length);
    broken.interfaces[0].ip = 'not-an-ip';
    validateTopology(); await settle();
    ok(`${size}: with findings the pill shows`, shown(el('conflictPill')));
    ok(`${size}: with findings, every zoom button owns its centre`, !zoomStolen().length, json(zoomStolen()));
    const q = el('queryInput');
    q.value = 'type:switch'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(); await wait(120);
    ok(`${size}: a search on, every zoom button owns its centre`, !zoomStolen().length, json([zoomStolen(), rect(el('conflictPill'))]));
    q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const PM = window.TopoProviderMode, TI = window.TopoIncidents;
    if (PM && TI) {
      const incId = await TI.createIncident({ symptom: 'internet', nodeIds: [broken.id], text: 'No internet', name: 'Ana', phone: '555-1', remember: false });
      PM.enterProviderMode(incId); await settle(); await wait(200);
      if (drawerOpen()) el('railClose').click();
      await settle(); await wait(150);
      ok(`${size}: provider mode, the pill shows`, shown(el('conflictPill')) && document.body.classList.contains('pm-bar'), document.body.className);
      ok(`${size}: provider mode, every zoom button owns its centre`, !zoomStolen().length, json([zoomStolen(), rect(el('conflictPill'))]));
      PM.leaveProviderMode(); await settle(); await wait(100);
    }
    replaceDocument(templatesData.house, { origin: 'template' });
    setView('map'); select(null, null);
    await settle(); await wait(100);
    ok(`${size}: the document bar is on the handy bar's row, left of it`, shown(el('docBar')) && rect(el('docBar')).right <= hb.left && Math.abs(rect(el('docBar')).bottom - hb.bottom) < 2, json(rect(el('docBar'))));

    // A device tapped: one row of bars.
    const dev = state.nodes.find((n) => n.type === 'router');
    const g = el('ui-node-' + dev.id);
    await tapEl(g);
    ok(`${size}: a device tapped shows the selection bar`, shown(el('selBar')), el('selBar').hidden);
    const sb = rect(el('selBar'));
    ok(`${size}: the selection bar shares the handy bar's row`, sb.right <= hb.left + 0.5 && Math.abs(sb.bottom - hb.bottom) < 4, json([sb.right, sb.bottom, hb.left, hb.bottom]));
    const tops = ['docBar', 'selBar', 'handyBar'].map(el).filter(shown).map((e) => rect(e).top);
    const share = (H - Math.min(...tops)) / H;
    ok(`${size}: the bars cover 40% of the height or less`, share <= 0.4, share.toFixed(3));
    const btns = [...el('selBar').querySelectorAll('button')].filter(shown);
    ok(`${size}: the selection bar's buttons are 44x44 and inside it`, btns.length > 0 && btns.every((b) => rect(b).height >= 44 && rect(b).width >= 44 && rect(b).right <= sb.right + 0.5), String(btns.length));
    select(null, null); await settle();

    // The drawer, from ☰ and back with ✕.
    await tapEl(el('handyMenu'));
    await wait(300);
    const rail = document.querySelector('.topo-rail');
    ok(`${size}: ☰ opens the drawer`, drawerOpen() && getComputedStyle(rail).position === 'fixed' && rect(rail).left >= -0.5 && rect(rail).width <= 341, json(rect(rail)));
    ok(`${size}: the drawer has the whole height`, Math.abs(rect(rail).top) < 1 && Math.abs(rect(rail).bottom - H) < 1, json([rect(rail).top, rect(rail).bottom]));
    await tapEl(el('railClose'));
    await wait(300);
    ok(`${size}: ✕ closes it`, !drawerOpen());

    // The table: its rows get the height.
    setView('table'); await settle(); await wait(120);
    const sc = rect(el('tvScroll'));
    ok(`${size}: the table's rows get 150px or more`, sc.height >= 150 && sc.bottom <= rect(el('handyBar')).top + 0.5, json([sc.top, sc.bottom]));
    ok(`${size}: the table's head is one row`, rect(document.querySelector('.tv-tabs')).top === rect(document.querySelector('.tv-head')).top || Math.abs(rect(el('tvPasteBtn')).top - rect(document.querySelector('.tv-tabs')).top) < 8,
      json([rect(document.querySelector('.tv-tabs')).top, rect(el('tvPasteBtn')).top]));
    setView('map'); await settle();

    ok(`${size}: no sideways scroll`, document.scrollingElement.scrollWidth <= W, String(document.scrollingElement.scrollWidth));
  };

  try {
    await __media('reduce');
    await document.fonts.ready;
    ok('this page is a 780x360 touch screen', navigator.maxTouchPoints > 0 && innerWidth === 780 && innerHeight === 360, `${innerWidth}x${innerHeight}`);
    if (document.body.classList.contains('landing-open')) closeLanding();
    await sideways('780x360');

    // The rack: Datacenter, A01. Its body (elevation and schedule) gets the height.
    replaceDocument(templatesData.datacenter, { origin: 'template' });
    await settle();
    setView('rack'); await settle(); await wait(200);
    ok('780x360: the rack view is on', document.body.classList.contains('rack-view'));
    // The pane scrolls as one: a swipe on its head brings the whole body on
    // screen, between the top bar and the handy bar's row.
    const body = document.querySelector('.rk-body'), pane = document.querySelector('.topo-rack');
    const bb = body && rect(body);
    ok('780x360: the rack\'s body is 150px tall or more', !!bb && bb.height >= 150, bb && json([bb.top, bb.bottom]));
    pane.scrollTop = pane.scrollHeight; await settle();
    const bb2 = rect(body), tb = rect(document.querySelector('.topo-topbar'));
    ok('780x360: scrolled, the rack\'s body is wholly between the top bar and the bars', bb2.top >= tb.bottom - 0.5 && bb2.bottom <= rect(el('handyBar')).top + 0.5, json([bb2.top, bb2.bottom, tb.bottom]));
    pane.scrollTop = 0;
    // M35: one face and one pane at a time on its side too, the pane switch
    // beside the picker; the schedule's pane hides the units.
    const psw = el('rackPaneSwitch');
    ok('780x360: the rack has the pane switch, beside the picker', shown(psw) && Math.abs(rect(psw).top - rect(el('rackPicker')).top) < 8, psw && json(rect(psw)));
    ok('780x360: one face shows', [...document.querySelectorAll('.rk-face')].filter(shown).length === 1);
    await tapEl(psw.querySelector('[data-pane="sched"]'));
    ok('780x360: Patch schedule shows the schedule, not the units', shown(document.querySelector('.rk-sched')) && !shown(document.querySelector('.rk-main')));
    await tapEl(psw.querySelector('[data-pane="elev"]'));
    ok('780x360: Elevation brings the units back', shown(document.querySelector('.rk-main')) && !shown(document.querySelector('.rk-sched')));
    setView('map'); await settle();

    // M34: the report dialog on its side. The ✕ a finger's size, Print and
    // Download on screen without scrolling the questions, on an opaque foot.
    openReportDialog('site'); await settle(); await wait(400);
    const x = document.querySelector('#reportDialog .rpv-x');
    ok('780x360: the report\'s ✕ is 44x44 or more', !!x && rect(x).width >= 44 && rect(x).height >= 44, x && json(rect(x)));
    const acts = document.querySelector('#reportDialog .rpv-actions');
    const pb = [...acts.children].filter(shown);
    ok('780x360: Print and Download are on screen, 44 tall', pb.length === 2 && pb.every((b) => rect(b).top >= 0 && rect(b).bottom <= 360 && rect(b).height >= 44), json(pb.map((b) => [rect(b).top, rect(b).bottom])));
    const bg = getComputedStyle(acts).backgroundColor;
    ok('780x360: on an opaque foot', /^rgb\(/.test(bg) || /, 1\)$/.test(bg), bg);
    await tapEl(x); await wait(200);
    ok('780x360: the ✕ closes it', !shown(el('reportDialog')));

    // The merge review on its side: the head one line, the counts beside
    // the kind and Use … for all, so a conflict row is above the foot.
    if (window.TopoMergeDoors) {
      const heldLib = loadLibrary();
      const nic = (id, ip) => ({ id, name: 'eth0', ip });
      const dev = (id, name, o = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [] }, o);
      const D = (o = {}) => Object.assign({ v: DOC_VERSION, nodes: [], links: [] }, o);
      const nodes = (notes) => [dev('a', 'Router', { type: 'router', interfaces: [nic('i1', '10.0.0.1/24')], notes }), dev('b', 'PC-1', { x: 120, interfaces: [nic('i1', '10.0.0.11/24')] }),
        ...Array.from({ length: 6 }, (_, i) => dev('p' + i, 'Desk PC ' + i, { x: i * 80, y: 200, interfaces: [nic('i1', '10.0.0.' + (30 + i) + '/24')] }))];
      const MINE = D({ report: { client: 'Clinica Sol', site: 'Reception' }, nodes: nodes('mine'), links: [{ id: 'l1', source: 'a', target: 'b' }] });
      const THEIRS = D({ report: { client: 'Clinica Sol', site: 'Reception' }, nodes: nodes('theirs').map((n) => (n.id === 'b' ? Object.assign(n, { name: 'PC-1 front' }) : n)), links: [{ id: 'l1', source: 'a', target: 'b' }] });
      persistLibrary({ m1: { id: 'm1', name: 'Reception', doc: JSON.parse(JSON.stringify(MINE)), created: 1, updated: 1000 } });
      const done = TopoMergeDoors.mergeFileIntoCard('m1', THEIRS, 'topo_clinica-sol_reception_2026-11-10.json');
      for (let i = 0; i < 40 && el('mergeDialog').hidden; i++) await wait(100);
      await settle(); await wait(150);
      const first = document.querySelector('#mergeList > li.merge-row');
      const foot = document.querySelector('#mergeDialog .modal-foot');
      ok('780x360: the merge review shows a conflict row above its foot', !!first && rect(first).top + 44 <= rect(foot).top, first && json([rect(first).top, rect(foot).top]));
      document.querySelector('#mergeDialog .modal-x').click();
      await settle(); await wait(150);
      await Promise.resolve(done).catch(() => {});
      persistLibrary(heldLib || {});
    }

    // A large phone on its side: past carino-ui's 900px drawer.
    await __viewport(932, 430); await wait(400); await settle();
    ok('the screen is now 932x430', innerWidth === 932 && innerHeight === 430, `${innerWidth}x${innerHeight}`);
    await sideways('932x430');

    // A tablet on its side whose browser shrank the page for its keyboard
    // (960x430: wider than any phone): the side panel stays docked.
    await __viewport(960, 430); await wait(400); await settle();
    const rl = document.querySelector('.topo-rail');
    ok('960x430 (a tablet typing): not the drawer\'s layout, the rail stays docked', !mqMatches(DRAWER_MQ) && getComputedStyle(rl).position !== 'fixed' && rect(rl).width > 0 && rect(rl).left >= -0.5, json([getComputedStyle(rl).position, rect(rl).left]));

    ok('no console error', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('the suite ran to its end', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
