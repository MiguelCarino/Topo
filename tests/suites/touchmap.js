// @realtime @touch
// The map under real fingers on a phone (Mobile batch 1; js/app.js
// mapTouchStart, css/app.css .topo-svg touch-action and html overscroll).
// run-cross.mjs opens this one on a 390x844 touch screen and hands it
// window.__touch, which sends real touch input through the browser's own
// gesture handling, so what is held here is what a phone does, not what a
// synthetic TouchEvent does:
//   1. a pinch on the map zooms the map, never the page (visualViewport.scale
//      stays 1), about the fingers' midpoint;
//   2. one finger dragged on empty map pans it by its travel; a tap on empty
//      map still deselects; a double-tap zooms in 2x and drops no note;
//   3. the drawer and the table still scroll under a finger, a pinch over an
//      open dialog leaves the map alone, and a panel's field still takes the
//      focus from a tap and takes typing;
//   4. How to use says how to move the map by touch on a touch screen;
//   5. a pinch on what sits on the map (zoom buttons, document bar) zooms the
//      map, and a pinch off the map (the table) still zooms the page.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(30); };
  const touch = (type, pts) => window.__touch(type, pts);
  // A finger from (x0, y0) to (x1, y1) in steps, then up.
  const swipe = async (x0, y0, x1, y1, steps = 10) => {
    await touch('touchStart', [{ x: x0, y: y0, id: 1 }]);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }]);
      await frame();
    }
    await touch('touchEnd', []);
    await settle();
  };
  // Two fingers about (cx, cy), from d0 apart to d1 apart, sideways.
  const pinch = async (cx, cy, d0, d1, steps = 10) => {
    const at = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
    await touch('touchStart', at(d0));
    for (let i = 1; i <= steps; i++) { await touch('touchMove', at(d0 + (d1 - d0) * i / steps)); await frame(); }
    await touch('touchEnd', []);
    await settle();
  };
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); await settle(); };
  const cam = () => ({ x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom });
  const vvScale = () => (window.visualViewport ? window.visualViewport.scale : 1);
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  // Enough devices that the table and the drawer have something to scroll.
  const N = (i) => ({ id: 'd' + i, type: 'pc', name: 'PC-' + i, x: (i % 3) * 120, y: Math.floor(i / 3) * 110, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.' + (i + 10) }] });
  const BX = -6000;
  const doc = { v: DOC_VERSION, nodes: Array.from({ length: 60 }, (_, i) => N(i)), links: [], annotations: [] };

  try {
    ok('this page is on a touch screen', navigator.maxTouchPoints > 0 && typeof window.__touch === 'function', String(navigator.maxTouchPoints));
    replaceDocument(doc, { origin: 'file', docId: 'touch-map' });
    setView('map');
    renderCanvasOnly();
    await settle();

    // An empty point of the map, clear of the overlays: the devices are put
    // far off to the left, since a finger near a card is the card's (the
    // browser's touch adjustment picks a target within the finger's reach).
    const cv = el('networkCanvas');
    const r = cv.getBoundingClientRect();
    const home = () => { state.camera.x = BX; state.camera.y = 40; state.camera.zoom = 1; applyCamera(); };
    home();
    await settle();
    const spot = { x: r.left + r.width / 2, y: r.top + r.height * 0.55 };
    ok('an empty point of the map was found', document.elementFromPoint(spot.x, spot.y) === cv, json(spot));
    const local = (p) => ({ x: p.x - r.left, y: p.y - r.top });
    const world = (p) => { const l = local(p); return { x: (l.x - state.camera.x) / state.camera.zoom, y: (l.y - state.camera.y) / state.camera.zoom }; };

    // ---- 1. A pinch ----
    let c0 = cam();
    const under = world(spot);
    await pinch(spot.x, spot.y, 80, 240);
    const after = world(spot);
    ok('a pinch on the map leaves the page at its own zoom', vvScale() === 1, String(vvScale()));
    ok('and zooms the map, about 3x for three times the spread', Math.abs(state.camera.zoom / c0.zoom - 3) < 0.15, json(cam()));
    ok('about the fingers\' midpoint', Math.abs(under.x - after.x) < 1 && Math.abs(under.y - after.y) < 1, json([under, after]));
    ok('a pinch filed nothing', !_undoStack.length, String(_undoStack.length));

    // A pinch whose first finger came down on a device, and dragged it: the
    // drag is let go, the device goes back, nothing is filed, the map zooms.
    state.camera.x = 20; state.camera.y = 380; state.camera.zoom = 1; applyCamera();
    await settle();
    const dEl = el('ui-node-d1');
    const db = dEl && dEl.getBoundingClientRect();
    const dx0 = db ? db.left + db.width / 2 : 0, dy0 = db ? db.top + db.height / 2 : 0;
    ok('the device is under the finger', !!db && dEl.contains(document.elementFromPoint(dx0, dy0)), db && json([dx0, dy0]));
    if (db) {
      const p0 = [getNode('d1').x, getNode('d1').y];
      c0 = cam();
      await touch('touchStart', [{ x: dx0, y: dy0, id: 1 }]);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: dx0 - 12 * i, y: dy0, id: 1 }]); await frame(); }
      const dragged = getNode('d1').x !== p0[0];
      const fx = dx0 - 72;
      for (let i = 0; i <= 8; i++) {
        await touch(i ? 'touchMove' : 'touchStart', [{ x: fx - 10 * i, y: dy0, id: 1 }, { x: fx + 40 + 10 * i, y: dy0, id: 2 }]);
        await frame();
      }
      await touch('touchEnd', []);
      await settle();
      ok('one finger on a device drags it first', dragged);
      ok('a second finger puts it back and files nothing', json([getNode('d1').x, getNode('d1').y]) === json(p0) && !_undoStack.length, json([p0, getNode('d1').x, getNode('d1').y, _undoStack.length]));
      ok('and the fingers zoom the map, not the page', state.camera.zoom > c0.zoom * 1.5 && vvScale() === 1, json([cam(), vvScale()]));
    }
    home();
    await settle();

    // ---- 2. One finger ----
    home();
    await settle();
    c0 = cam();
    await swipe(spot.x, spot.y, spot.x + 60, spot.y + 120);
    ok('one finger on empty map pans it by its travel', Math.abs(state.camera.x - c0.x - 60) < 1.5 && Math.abs(state.camera.y - c0.y - 120) < 1.5 && state.camera.zoom === c0.zoom, json([c0, cam()]));
    ok('and the page stays where it was', vvScale() === 1 && window.scrollY === 0 && document.scrollingElement.scrollTop === 0);
    home();
    await settle();
    select('d0', 'node');
    await swipe(spot.x, spot.y, spot.x - 50, spot.y);
    ok('a pan keeps the selection', state.selectedId === 'd0', state.selectedId);
    home();
    await settle();
    await tap(spot.x, spot.y);
    await wait(400);   // past a double-tap
    ok('a tap on empty map still deselects', !state.selectedId, state.selectedId);
    // A double-tap: zoom 2x about it, no note.
    c0 = cam();
    const anns = state.annotations.length;
    const tapAt = world(spot);
    await tap(spot.x, spot.y);
    await wait(60);
    await tap(spot.x, spot.y);
    await wait(100);
    const tapAfter = world(spot);
    ok('a double-tap zooms in 2x', Math.abs(state.camera.zoom - c0.zoom * 2) < 1e-6, json([c0, cam()]));
    ok('about where it tapped', Math.abs(tapAt.x - tapAfter.x) < 1 && Math.abs(tapAt.y - tapAfter.y) < 1, json([tapAt, tapAfter]));
    ok('and drops no note, no editor', state.annotations.length === anns && !el('annEditor'), String(state.annotations.length));
    await wait(400);

    // ---- 3. The rest of the page keeps its own touch ----
    // A pinch over an open dialog: neither the map nor the page.
    toggleShortcutHelp(true);
    await settle();
    const pop = el('cnAbout');
    const pr = pop && !pop.hidden ? pop.getBoundingClientRect() : null;
    ok('How to use is open', !!pr);
    if (pr) {
      ok('How to use says how to move the map by touch', !!el('touchHint') && /one finger/.test(el('touchHint').textContent) && /Pinch/.test(el('touchHint').textContent), el('shortcutBody').textContent.slice(0, 80));
      c0 = cam();
      const mx = pr.left + pr.width / 2, my = pr.top + Math.min(pr.height / 2, 200);
      const hit = document.elementFromPoint(mx, my);
      ok('the point is on the dialog', !!hit && pop.contains(hit), hit && hit.tagName);
      await touch('touchStart', [{ x: mx - 30, y: my, id: 1 }, { x: mx + 30, y: my, id: 2 }]);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: mx - 30 - i * 8, y: my, id: 1 }, { x: mx + 30 + i * 8, y: my, id: 2 }]); await frame(); }
      await touch('touchEnd', []);
      await settle();
      ok('a pinch over a dialog leaves the map alone', json(cam()) === json(c0), json([c0, cam()]));
      ok('and the page too (the dialog scrolls, it does not zoom)', vvScale() === 1, String(vvScale()));
    }
    toggleShortcutHelp(false);
    await settle();

    // What sits on the map (the zoom buttons, the document bar) is map: two
    // fingers there pinch the map, not the page.
    home();
    await settle();
    const over = [document.querySelector('#canvasContainer > .zoom-ctl'), el('docBar')].find((o) => {
      if (!o || o.classList.contains('hidden')) return false;
      const b = o.getBoundingClientRect();
      return b.width > 30 && b.height > 20 && o.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
    });
    ok('something sits on the map', !!over);
    if (over) {
      const b = over.getBoundingClientRect();
      const ox = b.left + b.width / 2, oy = b.top + Math.min(b.height / 2, 20);
      c0 = cam();
      await touch('touchStart', [{ x: ox - 8, y: oy, id: 1 }, { x: ox + 8, y: oy, id: 2 }]);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: ox - 8 - i * 8, y: oy, id: 1 }, { x: ox + 8 + i * 8, y: oy, id: 2 }]); await frame(); }
      await touch('touchEnd', []);
      await settle();
      ok('a pinch on ' + (over.id || over.className) + ' zooms the map, not the page', state.camera.zoom > c0.zoom * 1.5 && vvScale() === 1, json([cam(), vvScale()]));
    }
    home();
    await settle();

    // The table scrolls under a finger.
    setView('table');
    await settle();
    const scroller = (root) => [root, ...root.querySelectorAll('*')].find((e) => {
      const st = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      return /(auto|scroll)/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 80 && b.height > 150 && b.width > 150;
    });
    const tv = el('tableView') || document.querySelector('.table-view, #tablePane, .topo-table');
    const ts = tv && scroller(tv);
    ok('the table has a scroller', !!ts, tv ? tv.id || tv.className : 'no table');
    if (ts) {
      ts.scrollTop = 0;
      const b = ts.getBoundingClientRect();
      const x = b.left + Math.min(b.width / 2, 150), y0 = b.top + b.height * 0.75, y1 = b.top + b.height * 0.25;
      await swipe(x, y0, x, y1);
      await wait(200);
      ok('a swipe in the table scrolls it', ts.scrollTop > 20, String(ts.scrollTop));
    }
    setView('map');
    await settle();

    // The drawer scrolls under a finger, and its field takes a tap and typing.
    select('d0', 'node');
    const ws = document.querySelector('.ws');
    if (ws && !ws.classList.contains('drawer-open')) el('handyMenu').click();
    await wait(400);
    const rail = document.querySelector('.topo-rail');
    ok('the drawer is open', !!ws && ws.classList.contains('drawer-open'));
    const ds = rail && scroller(rail);
    ok('the drawer has a scroller', !!ds);
    if (ds) {
      ds.scrollTop = 0;
      const b = ds.getBoundingClientRect();
      const x = b.left + b.width / 2, y0 = b.top + b.height * 0.75, y1 = b.top + b.height * 0.3;
      await swipe(x, y0, x, y1);
      await wait(200);
      ok('a swipe in the drawer scrolls it', ds.scrollTop > 20, String(ds.scrollTop));
      ds.scrollTop = 0;
      await settle();
    }
    const field = el('propName');
    if (field) field.scrollIntoView({ block: 'center' });
    await settle();
    const fb = field && field.getBoundingClientRect();
    ok('the name field is on screen', !!fb && fb.height > 0 && document.elementFromPoint(fb.left + 10, fb.top + fb.height / 2) === field, fb && json([fb.left, fb.top]));
    if (fb) {
      await tap(fb.left + 10, fb.top + fb.height / 2);
      ok('a tap focuses a panel field', document.activeElement === field, document.activeElement && (document.activeElement.id || document.activeElement.tagName));
      field.select();
      await window.__type('Desk');
      await settle();
      ok('and it takes typing', field.value === 'Desk' && getNode('d0').name === 'Desk', field.value);
      field.blur();
    }
    ok('nothing zoomed the page', vvScale() === 1, String(vvScale()));

    // Off the map the page's own pinch zoom is still there (no
    // user-scalable=no): a pinch on the table zooms the page. Last, since
    // the page stays zoomed.
    setView('table');
    await settle();
    const tb = (el('tableView') || document.querySelector('.table-view, #tablePane, .topo-table'));
    const tr = tb && tb.getBoundingClientRect();
    ok('the table is on screen', !!tr && tr.height > 150);
    if (tr) {
      const c1 = cam();
      await pinch(tr.left + tr.width / 2, tr.top + tr.height / 2, 60, 220);
      await wait(200);
      ok('a pinch off the map still zooms the page', vvScale() > 1.2, String(vvScale()));
      ok('and not the map', json(cam()) === json(c1), json([c1, cam()]));
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
