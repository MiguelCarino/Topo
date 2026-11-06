// @realtime @touch
// A phone's framing of the map on a real touch screen (Mobile batch 1;
// js/app.js mapViewport, frameCamera, fitToView, the Fit button; js/ui.js
// focusOnMap). run-cross.mjs opens this on a 390x844 touch screen, DPR 2,
// with window.__touch for real touch input (see tests/suites/touchmap.js).
// What is held here:
//   1. the example opened (on the table, as a phone opens) and then the Map
//      tab: the zoom is 0.7 or more, the router's card is inside the visible
//      map (mapViewport: under the top bar, over the document and handy
//      bars), and the device names show at 7px or more;
//   2. the Full Showcase: a tap on the Fit button leaves every device inside
//      the visible map, under 0.2;
//   3. a table row tapped and then the Map tab: the device is inside the
//      visible map at 0.7 or more;
//   4. after a zoom in, 1:1 is zoom 1 about the middle of the visible map;
//   5. no horizontal scroll, and the page never zoomed.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const touch = (type, pts) => window.__touch(type, pts);
  const tapEl = async (node) => {
    const b = node.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []);
    await wait(120); await settle();
  };
  const heldResponder = setDialogResponder(() => true);
  const savedView = state.settings.view;
  const cv = el('networkCanvas');
  // A card's box on the screen, against the visible map in client pixels.
  const viewBox = () => { const r = cv.getBoundingClientRect(), v = mapViewport(); return { left: r.left + v.left, top: r.top + v.top, right: r.left + v.left + v.width, bottom: r.top + v.top + v.height }; };
  const within = (b, v) => b.left >= v.left - 0.5 && b.right <= v.right + 0.5 && b.top >= v.top - 0.5 && b.bottom <= v.bottom + 0.5;
  const cardBox = (id) => { const g = el('ui-node-' + id); const rect = g && g.querySelector('rect'); return rect ? rect.getBoundingClientRect() : null; };
  const mapTab = () => document.querySelector('#viewSwitch [data-view="map"]');
  const tableTab = () => document.querySelector('#viewSwitch [data-view="table"]');

  try {
    ok('this page is a phone', phoneView() && navigator.maxTouchPoints > 0 && innerWidth === 390, `${innerWidth} ${navigator.maxTouchPoints}`);

    // ---- 1. The example, then Map ----
    setView('table');
    await settle();
    replaceDocument(cloneData(templatesData.house), { origin: 'template' });
    await settle();
    await tapEl(mapTab());
    ok('the Map tab is on', effectiveView() === 'map', effectiveView());
    const v = viewBox();
    ok('the visible map leaves out the top bar', v.top >= document.querySelector('#canvasContainer > .topo-topbar').getBoundingClientRect().bottom - 0.5, json(v));
    const docBar = el('docBar');
    if (!docBar.classList.contains('hidden')) ok('and the document bar', v.bottom <= docBar.getBoundingClientRect().top + 0.5, json(v));
    ok('the example opens at the readable zoom or more', state.camera.zoom >= 0.7, json(state.camera));
    const router = state.nodes.find((n) => n.type === 'router');
    const rb = router && cardBox(router.id);
    ok("the router's card is inside the visible map", !!rb && within(rb, v), json([rb, v]));
    const names = [...document.querySelectorAll('#layer-nodes text[font-size="10"]')].map((x) => x.getBoundingClientRect()).filter((b) => b.height > 0 && b.bottom > v.top && b.top < v.bottom);
    const lh = names.length ? Math.min(...names.map((b) => b.height)) : 0;
    ok('the device names in view are 7px tall or more (to 0.01px)', names.length > 0 && lh >= 6.99, `${names.length} names, ${lh}px`);

    // ---- 4. 1:1 after a zoom in ----
    const mid = { x: (v.left + v.right) / 2 - cv.getBoundingClientRect().left, y: (v.top + v.bottom) / 2 - cv.getBoundingClientRect().top };
    const worldAt = (p) => ({ x: (p.x - state.camera.x) / state.camera.zoom, y: (p.y - state.camera.y) / state.camera.zoom });
    await tapEl(el('zoomInBtn'));
    const w0 = worldAt(mid);
    await tapEl(el('zoomResetBtn'));
    const w1 = worldAt(mid);
    ok('1:1 is zoom 1', state.camera.zoom === 1, json(state.camera));
    ok('about the middle of the visible map', Math.abs(w0.x - w1.x) < 1e-6 && Math.abs(w0.y - w1.y) < 1e-6, json([w0, w1]));
    ok('with the router still on the map', (() => { const b = cardBox(router.id); return b && within(b, viewBox()); })(), json(cardBox(router.id)));

    // ---- 2. The Showcase's Fit ----
    replaceDocument(cloneData(templatesData.showcase), { origin: 'template' });
    await settle();
    ok('a first view of the Showcase is readable', state.camera.zoom >= 0.7, json(state.camera));
    await tapEl(el('zoomFitBtn'));
    ok('the Fit button frames it under 0.2', state.camera.zoom < 0.2 && state.camera.zoom >= 0.1, json(state.camera));
    const v2 = viewBox();
    const out2 = state.nodes.filter((n) => { const b = cardBox(n.id); return b && !within(b, v2); }).map((n) => n.id);
    const drawn = state.nodes.filter((n) => cardBox(n.id)).length;
    ok('every device is inside the visible map', drawn > 0 && out2.length === 0, `${drawn} drawn, out: ${out2.join(',')}`);

    // ---- 3. A table row, then Map ----
    await tapEl(tableTab());
    ok('on the table', effectiveView() === 'table', effectiveView());
    const row = [...document.querySelectorAll('#tableView tbody tr[data-row], .tv-grid tbody tr[data-row], tbody tr[data-row]')].find((r) => r.getBoundingClientRect().height > 0);
    const cell = row && (row.querySelector('td[data-col]') || row.querySelector('td'));
    if (cell) await tapEl(cell);
    const picked = [...state.selection].filter((k) => k && k.type === 'node').map((k) => k.id);
    ok('a row was picked', !!row && state.selection.size > 0, json(picked));
    await tapEl(mapTab());
    const v3 = viewBox();
    const sel = state.nodes.filter((n) => picked.includes(n.id) && cardBox(n.id));
    ok('the picked device is inside the visible map', sel.length > 0 && sel.every((n) => within(cardBox(n.id), v3)), json([picked, sel.map((n) => [n.id, cardBox(n.id)]), v3]));
    ok('at the readable zoom or more', state.camera.zoom >= 0.7, json(state.camera));

    // ---- 6. Boot's first view ----
    // A reload fits while body.chrome-pending still hides the bars; it is
    // put back here, as boot has it, around boot's own calls.
    setView('map');
    replaceDocument(cloneData(templatesData.showcase), { origin: 'template', fit: false });
    await settle();
    document.body.classList.add('chrome-pending');
    fitToView(null, { initial: true });
    document.body.classList.remove('chrome-pending');
    await settle();
    const v6 = viewBox();
    ok('boot\'s first view is readable', state.camera.zoom >= 0.7, json(state.camera));
    const top = state.nodes.reduce((a, n) => (a && a.y <= n.y ? a : n), null);
    const tb6 = top && cardBox(top.id);
    ok('with the top device inside the visible map, not under the top bar', !!tb6 && tb6.top >= v6.top - 0.5 && tb6.bottom <= v6.bottom + 0.5, json([top && top.id, tb6, v6]));
    // And a '#asset' arrival (applyArrivalFocus -> focusOnMap) during boot.
    const far = state.nodes.reduce((a, n) => (a && a.y >= n.y ? a : n), null);
    document.body.classList.add('chrome-pending');
    focusOnMap({ type: 'node', id: far.id });
    document.body.classList.remove('chrome-pending');
    await settle();
    const fb6 = cardBox(far.id);
    ok('an arrival focused during boot is inside the visible map', !!fb6 && within(fb6, viewBox()), json([fb6, viewBox()]));

    // ---- 5. The page ----
    ok('no horizontal scroll', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth}`);
    ok('the page never zoomed', !window.visualViewport || window.visualViewport.scale === 1, String(window.visualViewport && window.visualViewport.scale));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
