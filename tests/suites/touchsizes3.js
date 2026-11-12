// @realtime @touch 360x780
// Touch targets on a phone, part 3 of 3 (Mobile review M60, batch 4 M25, M29):
// the dialogs (Settings, the report, Add devices, the merge review, Restore
// points, Report a problem, Record visit), each closed by a tap on its ✕;
// provider mode (the arrival banner, the provider strip, the drawer's Problem
// report tab); the Simple view's map and drawer; then the same chrome at 390x844
// and on two tablets (1024x768, 1366x1024: a touch screen of any width gets
// the targets, and nothing there scrolls sideways or wraps the top bar past
// two rows). Through tests/fixtures/touchaudit.js, as tests/suites/touchsizes.js
// says.
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
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
  const tap = async (x, y) => {
    await window.__touch('touchStart', [{ x, y, id: 1 }]);
    await window.__touch('touchEnd', []);
    await settle(); await wait(120);
  };
  const tapEl = async (e) => { const r = e.getBoundingClientRect(); await tap(r.left + r.width / 2, r.top + r.height / 2); };
  const shown = (d) => !!d && !d.hidden && !d.classList.contains('hidden') && d.getClientRects().length > 0;
  const ws = document.querySelector('.ws');
  const rail = document.querySelector('.topo-rail');
  const drawerOpen = () => ws.classList.contains('drawer-open');
  const screen = async (label, scroller) => {
    await document.fonts.ready; await settle();
    const lines = new Set();
    let measured = 0;
    const once = () => { const r = window.touchAudit(label); r.lines.filter((l) => !/^screen not reached/.test(l)).forEach((l) => lines.add(l)); measured += r.measured; };
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
      const top = scroller.scrollTop;
      const step = Math.max(80, scroller.clientHeight - 160);
      for (let y = 0, i = 0; i < 40; y += step, i++) {
        scroller.scrollTop = y; await settle();
        once();
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) break;
      }
      scroller.scrollTop = top; await settle();
    } else once();
    if (!measured) lines.add('screen not reached: no control measured');
    ok(label + ': every target 44x44, every field 16px and 44 tall, nothing past the edge', !lines.size, [...lines].slice(0, 12).join(' | '));
  };
  // The dialog's scroller: its tallest box that scrolls.
  const scrollerIn = (root) => [root, ...root.querySelectorAll('*')]
    .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1)
    .sort((a, b) => b.clientHeight - a.clientHeight)[0] || null;
  // A dialog: measured, then closed by a tap on its ✕.
  const dialog = async (label, id, x) => {
    const d = el(id);
    ok(label + ' opens', shown(d));
    if (!shown(d)) return;
    await screen(label, scrollerIn(d));
    const close = x ? d.querySelector(x) : d.querySelector('.modal-head .modal-x, .modal-x, .rpv-x');
    const cb = close && close.getBoundingClientRect();
    ok(label + ': its ✕ is 44x44 or more', !!cb && cb.width >= 44 && cb.height >= 44, cb && `${cb.width}x${cb.height}`);
    if (close) await tapEl(close);
    await wait(150);
    ok(label + ': a tap on its ✕ closes it', !shown(d));
  };
  // Settings shows one section tab at a time (D361): each tab with
  // something in it is measured on its own (D362).
  const settingsTabKeys = async () => {
    openSettings(); await settle();
    const keys = [...document.querySelectorAll('#settingsDialog .set-tab')].filter((x) => !x.hidden).map((x) => x.dataset.tab);
    closeSettings(); await settle();
    return keys;
  };
  const settingsDialogs = async (label) => {
    const keys = await settingsTabKeys();
    ok(label + ': its tabs found', keys.length >= 3, keys.join());
    for (const k of keys) {
      openSettings(k); await settle();
      await dialog(`${label}, ${k}`, 'settingsDialog');
    }
  };

  try {
    await __media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    ok('this page is a 360x780 touch screen', navigator.maxTouchPoints > 0 && innerWidth === 360 && innerHeight === 780, `${innerWidth}x${innerHeight}`);
    const heldLib = loadLibrary();
    replaceDocument(templatesData.house, { origin: 'template' });
    setView('map'); select(null, null);
    await settle();

    // ---- Dialogs ----
    await settingsDialogs('Settings');
    // The probe's own check: a dialog's foot button shrunk to 26px fails,
    // though the document bar (behind the dialog's scrim) is under its box.
    openSettings(); await settle();
    {
      const st = document.createElement('style');
      st.textContent = '.modal-foot .btn { height: 26px !important; min-height: 26px !important; }';
      document.head.appendChild(st); await settle();
      const r = window.touchAudit('self-test: a small dialog foot');
      st.remove(); await settle();
      ok('self-test: the probe fails a dialog\'s foot button shrunk to 26px', r.lines.some((l) => /settingsDoneBtn/.test(l)), JSON.stringify(r.lines.slice(0, 3)));
    }
    el('settingsDialog').querySelector('.modal-x').click(); await settle();
    openReportDialog('site'); await settle(); await wait(300);
    await dialog('the report dialog', 'reportDialog', '#reportCancelBtn');
    openAddDevices(); await settle();
    await dialog('Add devices', 'addDevices');

    // The merge review: a kept network and a copy of it with changes.
    const nic = (id, ip) => ({ id, name: 'eth0', ip });
    const dev = (id, name, o = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [] }, o);
    const D = (o = {}) => Object.assign({ v: DOC_VERSION, nodes: [], links: [] }, o);
    const MINE = D({ nodes: [dev('a', 'Router', { type: 'router', interfaces: [nic('i1', '10.0.0.1/24')], notes: 'mine', vendor: 'MikroTik' }), dev('b', 'PC-1', { x: 120, interfaces: [nic('i1', '10.0.0.11/24')] })], links: [{ id: 'l1', source: 'a', target: 'b' }] });
    const THEIRS = D({ nodes: [dev('a', 'Router', { type: 'router', interfaces: [nic('i1', '10.0.0.1/24')], notes: 'theirs', vendor: 'Ubiquiti', serial: 'SN-9' }), dev('b', 'PC-1', { x: 120, interfaces: [nic('i1', '10.0.0.12/24')] }), dev('c', 'Printer', { x: 240, interfaces: [nic('i1', '10.0.0.13/24')] })],
      links: [{ id: 'l1', source: 'a', target: 'b' }, { id: 'l2', source: 'a', target: 'c' }] });
    // Stores of our own (no IndexedDB waits), and any question answered yes.
    const memAdapter = (disk) => ({
      open: async () => [...disk.values()].map((r) => clone(r.meta)),
      readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = [...disk.values()].filter((r) => r.meta.cardId === id).map((r) => clone(r.meta)); }); return o; },
      readDoc: async (id) => (disk.has(id) ? clone(disk.get(id).doc) : null),
      write: (ops) => { ops.put.forEach((p) => disk.set(p.meta.id, { meta: clone(p.meta), doc: clone(p.doc) })); ops.del.forEach((id) => disk.delete(id)); return Promise.resolve(true); },
      dropCard: async () => true
    });
    const R = window.CarinoRestore, RV = window.CarinoRevisions;
    if (R) { R._reset(); await R.openRestoreStore(memAdapter(new Map())); }
    if (RV) { RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(memAdapter(new Map())); }
    const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : req.kind === 'choice' ? null : undefined));
    persistLibrary({ m1: { id: 'm1', name: 'Reception', doc: clone(MINE), created: 1, updated: 1000 } });
    await openFromLibrary('m1');
    setDialogResponder(heldResponder);
    if (typeof flushAutosave === 'function') flushAutosave();
    openMergeReview({ targetId: 'm1', theirs: clone(THEIRS), base: null, source: 'topo_clinica-sol_reception_2026-11-10.json' });
    await settle(); await wait(200);
    await dialog('the merge review', 'mergeDialog');

    // Restore points: one point on the card, in the store above.
    if (R) {
      await R.keepRestorePoints(['m1'], 'Before restoring');
      R.openRestoreDialog('m1'); await settle(); await wait(200);
      await dialog('Restore points', 'restoreDialog');
    } else ok('the restore store is loaded', false);

    // Report a problem, the form.
    openProblemDialog(); await settle(); await wait(150);
    await dialog('Report a problem', 'problemDialog');
    // Tap it on the map, in Russian: the pill's Cancel (ОТМЕНА would run
    // past the pill's edge upper-cased) is a 44px target inside the pill.
    setLocale('ru');
    openProblemDialog(); await settle();
    startProblemPick(); await settle();
    const pill = el('problemPickBanner'), pc0 = pill && pill.querySelector('.pb-pick-cancel');
    const pr = pill && pill.getBoundingClientRect(), cr = pc0 && pc0.getBoundingClientRect();
    ok('the pick pill\'s Cancel is inside the pill and on the screen', !!cr && cr.right <= pr.right + 0.5 && pr.right <= innerWidth && cr.height >= 44 && cr.width >= 44,
      cr && `${pc0.textContent} ${cr.left}-${cr.right} in ${pr.left}-${pr.right}`);
    ok('the pill\'s Cancel is not upper-cased', !!pc0 && getComputedStyle(pc0).textTransform === 'none');
    await screen('the pick pill (ru)');
    await tapEl(pc0); await settle();
    if (el('problemDialog') && !el('problemDialog').hidden) closeProblemDialog();
    setLocale('en'); await settle();

    // ---- Provider mode ----
    const PM = window.TopoProviderMode, TI = window.TopoIncidents;
    const router = state.nodes.find((n) => n.type === 'router') || state.nodes[0];
    // Routed to a provider, so the send step shows what the link carries (D95).
    const routed = (state.providers || []).slice(0, 1).map((p) => p.id);
    const incId = TI && await TI.createIncident({ symptom: 'internet', nodeIds: [router.id], text: 'No internet since this morning', name: 'Ana', phone: '555-1', remember: false, routedTo: routed });
    ok('a problem report is filed', typeof incId === 'string');
    if (incId && typeof openIncidentSend === 'function') {
      openIncidentSend(incId); await settle(); await wait(150);
      if (routed.length) ok('the send step shows what the link carries', shown(el('problemScopeRow')));
      await dialog('Report a problem, its send step', 'problemDialog', '.modal-head .modal-x');
    }
    if (PM && incId) {
      PM.state.arrival = { docId: state.docId || null, ids: [incId], kind: 'sent' };
      PM.renderIncidentBanner(); await settle();
      ok('the arrival banner shows', shown(el('incidentBanner')));
      await screen('provider: the arrival banner');
      PM.state.arrival = null; PM.renderIncidentBanner();
      PM.enterProviderMode(incId); await settle(); await wait(150);
      if (drawerOpen()) el('railClose').click();
      await settle(); await wait(100);
      await screen('provider: the strip over the map');
      PM.openProviderPanel(); await settle(); await wait(150);
      ok('the drawer opens on the Problem report tab', drawerOpen() && shown(el('cfgPanel-visit')));
      await screen('provider: the drawer\'s Problem report tab', rail);
      if (drawerOpen()) el('railClose').click();
      await settle();
      PM.openVisitDialog(); await settle(); await wait(300);
      await dialog('Record visit', 'visitDialog');
      PM.leaveProviderMode(); await settle();
    }

    // ---- The Simple view ----
    const heldAdv = state.settings.advanced, heldProf = state.settings.profile;
    state.settings.advanced = false; state.settings.profile = 'simple';
    applyProfile();
    replaceDocument(templatesData.house, { origin: 'template' });
    setView('map'); select(null, null); await settle(); await wait(150);
    ok('the Simple view is on', document.body.classList.contains('simple-mode'));
    const nh = el('navHandle').getBoundingClientRect();
    ok('in Simple the navbar handle is a 44px target', nh.height >= 44 && nh.width >= 44, `${nh.width}x${nh.height}`);
    await screen('Simple: the map');
    const pc = state.nodes.find((n) => n.type === 'pc') || state.nodes[0];
    select(pc.id, 'node'); await settle();
    await tapEl(el('handyMenu')); await wait(120);
    ok('Simple: the drawer opens', drawerOpen());
    await screen('Simple: the drawer with a device selected', rail);
    select(null, null); await settle();
    await screen('Simple: the drawer, "Something missing?"', rail);
    // My networks in sight in Simple (step 3): the drawer header's 🗂️.
    const netBtn = el('drawerNetworksBtn');
    const nbr = netBtn.getBoundingClientRect();
    ok('Simple: My networks is in the drawer header, 44x44, on screen', shown(netBtn) && nbr.width >= 44 && nbr.height >= 44 && nbr.right <= innerWidth, `${nbr.width}x${nbr.height} r${nbr.right}`);
    setLocale('ja'); applyStaticI18n();
    ok('Simple: its label is translated', netBtn.getAttribute('aria-label') === 'マイネットワーク', netBtn.getAttribute('aria-label'));
    setLocale('en'); applyStaticI18n();
    await tapEl(netBtn); await settle(); await wait(120);
    ok('Simple: its tap opens My networks and closes the drawer', landingIsOpen() && !drawerOpen(), JSON.stringify([landingIsOpen(), drawerOpen(), document.elementFromPoint(nbr.left + 22, nbr.top + 22)?.id, document.documentElement.className]));
    closeLanding(); await settle();
    state.settings.advanced = heldAdv; state.settings.profile = heldProf;
    applyProfile();

    // ---- 390x844: the same chrome, a wider phone ----
    await __viewport(390, 844); await wait(250); await settle();
    replaceDocument(templatesData.house, { origin: 'template' });
    setView('map'); select(null, null); await settle();
    await screen('390: the map');
    await tapEl(el('handyMenu')); await wait(120);
    el('configTabBtn').click();
    await screen('390: the drawer', rail);
    el('railClose').click(); await settle();
    setView('table'); await settle();
    await screen('390: the table', el('tvScroll'));
    setView('map');
    await settingsDialogs('390: Settings');

    // ---- 320x640: the narrowest phone ----
    // The drawer's tabs in provider mode (nine of them, three rows) are each
    // 44x44; the rack's head leaves the units the height.
    await __viewport(320, 640); await wait(250); await settle();
    replaceDocument(templatesData.house, { origin: 'template' });
    setView('map'); select(null, null); await settle();
    {
      const PM3 = window.TopoProviderMode, TI3 = window.TopoIncidents;
      const r0 = state.nodes.find((n) => n.type === 'router') || state.nodes[0];
      const inc3 = TI3 && await TI3.createIncident({ symptom: 'internet', nodeIds: [r0.id], text: 'No internet', name: 'Ana', phone: '555-1', remember: false });
      if (PM3 && inc3) { PM3.enterProviderMode(inc3); await settle(); await wait(150); }
      if (!drawerOpen()) await tapEl(el('handyMenu'));
      await wait(150); await settle();
      rail.scrollTop = 0; await settle();
      const small = [...rail.querySelectorAll('.cfg-tab, .lib-tab')].filter(shown)
        .map((b) => [b.id || b.dataset.tab || b.textContent.trim(), b.getBoundingClientRect()]).filter(([, r]) => r.width < 43.5 || r.height < 43.5)
        .map(([n, r]) => `${n} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
      ok('320x640: every drawer tab is 44x44 or more (provider mode, nine tabs)', !small.length, small.join(' | '));
      await screen('320x640: the drawer\'s tabs', rail);
      if (drawerOpen()) el('railClose').click();
      await settle();
      if (PM3 && inc3) { PM3.leaveProviderMode(); await settle(); }
    }
    replaceDocument(templatesData.datacenter, { origin: 'template' });
    setView('rack'); await settle(); await wait(250);
    {
      const head = document.querySelector('.rk-head').getBoundingClientRect();
      const main = document.querySelector('.rk-main').getBoundingClientRect();
      const body = document.querySelector('.rk-body').getBoundingClientRect();
      const top = document.querySelector('.topo-topbar').getBoundingClientRect().bottom;
      const foot = el('handyBar').getBoundingClientRect().top;
      ok('320x640: the rack\'s head is three rows or fewer', head.height <= 3 * 60, `${head.top}-${head.bottom}`);
      ok('320x640: the elevation pane is half the height between the top bar and the handy bar, the units 200px or more', body.height >= (foot - top) / 2 && main.height >= 200,
        `${body.height.toFixed(0)} of ${(foot - top).toFixed(0)}, units ${main.height.toFixed(0)}`);
      const bar = el('docBar');
      ok('320x640: the rack view folds the network\'s banner into its chip', !shown(bar) || bar.classList.contains('docbar-chip'), bar && bar.className);
      const vc = document.querySelector('.rk-viewctl');
      ok('320x640: face, zoom and cables share one row that scrolls sideways', !!vc && getComputedStyle(vc).display === 'flex' && vc.scrollWidth > vc.clientWidth && vc.getBoundingClientRect().height <= 50, vc && `${vc.scrollWidth}/${vc.clientWidth} h${vc.getBoundingClientRect().height}`);
      await screen('320x640: the rack\'s elevation');
    }
    setView('map'); await settle();

    // ---- Tablets: a touch screen of any width ----
    for (const [w, h] of [[1024, 768], [1366, 1024]]) {
      await __viewport(w, h); await wait(300); await settle();
      setView('map'); select(null, null); await settle();
      await screen(`${w}x${h}: the map`);
      const bar = document.querySelector('.topo-topbar').getBoundingClientRect();
      const row = el('viewSwitch').getBoundingClientRect().height;
      ok(`${w}x${h}: the top bar is two rows at most`, bar.height <= row * 2 + 24, `${bar.height} / ${row}`);
      setView('table'); await settle();
      ok(`${w}x${h}: the table does not scroll the page sideways`, document.scrollingElement.scrollWidth <= innerWidth);
      await screen(`${w}x${h}: the table`, el('tvScroll'));
      setView('map');
      await settingsDialogs(`${w}x${h}: Settings`);
      // The bulk panel's Fill vendor from MAC: a button on its own line,
      // 44 tall on a tablet's touch screen too (not a link in a sentence).
      const two = state.nodes.filter((n) => n.type !== 'cloud').slice(0, 2);
      two.forEach((n) => { n.vendor = ''; });
      selectEntries(two.map((n) => ({ type: 'node', id: n.id })));
      showConfigTab('config'); await settle(); await wait(100);
      const vb = el('bulkVendorMacBtn');
      const vr = vb && vb.getBoundingClientRect();
      ok(`${w}x${h}: Fill vendor from MAC is 44 tall`, !!vr && shown(el('bulkVendorMac')) && vr.height >= 43.5 && vr.width >= 44, vr && `${vr.width.toFixed(1)}x${vr.height.toFixed(1)}`);
      select(null, null); await settle();
    }
    await __viewport(360, 780); await wait(200);
    persistLibrary(heldLib || {});

    ok('no console error', !errors.length, errors.slice(0, 4).join(' | '));
  } catch (e) {
    ok('the suite ran to its end', false, String(e && e.stack || e).slice(0, 300));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 400); });
