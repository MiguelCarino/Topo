// @realtime @touch
// A phone's setup build on a real touch screen (Mobile batch 1; js/add.js
// addSlots, phoneAddColumns, addColumns, buildNewNetwork). run-cross.mjs
// opens this on a 390x844 touch screen, DPR 2, with window.__touch for real
// touch input (see tests/suites/touchmap.js). What is held here:
//   1. the setup intake ('#setup': Add devices in its new-network mode, simple
//      view after) with 23 devices counted, Build tapped: 24 devices, no row
//      longer than 4 (a row takes what fits across the visible map at the
//      readable zoom), every row centred under its parent;
//   2. the first view is at the readable zoom (0.7) or more, the router's card
//      inside the visible map (mapViewport), the names in view 7px or more;
//   3. a small build (5) fits whole, readable; a build whose infrastructure
//      wraps onto two rows keeps the hosts below it, no cards overlapping;
//      Add devices onto a drawn map frames what it added, readable;
//   4. no horizontal scroll, and the page never zoomed.
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
  const savedView = state.settings.view, savedAdvanced = state.settings.advanced;
  const cv = el('networkCanvas');
  const viewBox = () => { const r = cv.getBoundingClientRect(), v = mapViewport(); return { left: r.left + v.left, top: r.top + v.top, right: r.left + v.left + v.width, bottom: r.top + v.top + v.height }; };
  const within = (b, v) => b.left >= v.left - 0.5 && b.right <= v.right + 0.5 && b.top >= v.top - 0.5 && b.bottom <= v.bottom + 0.5;
  const cardBox = (id) => { const g = el('ui-node-' + id); const rect = g && g.querySelector('rect'); return rect ? rect.getBoundingClientRect() : null; };
  const rows = () => { const m = new Map(); state.nodes.forEach((n) => m.set(n.y, (m.get(n.y) || []).concat(n))); return [...m.values()]; };
  const build = async (counts) => {
    openAddDevices({ mode: 'new', simpleAfter: true });
    await settle();
    Object.entries(counts).forEach(([type, v]) => {
      const i = document.querySelector(`#addRows input.add-count[data-type="${type}"]`);
      i.value = String(v); i.dispatchEvent(new Event('input'));
    });
    document.querySelectorAll('#addRows input.add-count').forEach((i) => {
      if (!(i.dataset.type in counts) && i.value !== '0') { i.value = '0'; i.dispatchEvent(new Event('input')); }
    });
    await settle();
    await tapEl(el('addApplyBtn'));
    await wait(200); await settle();
  };

  try {
    ok('this page is a phone', phoneView() && navigator.maxTouchPoints > 0 && innerWidth === 390, `${innerWidth} ${navigator.maxTouchPoints}`);
    setView('map');
    await settle();
    ok('a row here takes 4', addColumns() === 4, String(addColumns()));

    // ---- 1. Twenty-three devices ----
    await build({ pc: 12, iot: 2, printer: 2, camera: 4, ap: 2, switch: 1 });
    ok('the dialog closed on Build', el('addDevices').hidden);
    ok('24 devices with the router', state.nodes.length === 24, String(state.nodes.length));
    const rs = rows();
    ok('no row longer than 4', rs.every((r) => r.length <= 4), json(rs.map((r) => r.length)));
    ok('the computers, printers, cameras and smart devices are 5 rows of 4', rs.filter((r) => r.length === 4).length === 5, json(rs.map((r) => r.length)));
    const sw = state.nodes.find((n) => n.type === 'switch');
    // The switch's own rows, by their links to it (not by height: a wrapped
    // infrastructure row also sits below the switch).
    const onSw = new Set(linksAtNode(sw.id).map((l) => (l.source === sw.id ? l.target : l.source)));
    const under = rs.filter((r) => r[0].y > sw.y && r.every((n) => onSw.has(n.id)));
    // Centred to the grid: newNodeRecord snaps each card to GRID_SNAP (20), so
    // an even row's half-column offsets land up to 10 units to one side.
    ok('each row under the switch is centred under it (to the grid snap)',
       under.length > 0 && under.every((r) => Math.abs((Math.min(...r.map((n) => n.x)) + Math.max(...r.map((n) => n.x))) / 2 - sw.x) <= GRID_SNAP / 2),
       json(under.map((r) => r.map((n) => n.x))));

    // ---- 2. Its first view ----
    ok('the map is shown', effectiveView() === 'map', effectiveView());
    ok('it opens at the readable zoom or more', state.camera.zoom >= 0.7, json(state.camera));
    const router = state.nodes.find((n) => n.type === 'router');
    const v = viewBox();
    const rb = router && cardBox(router.id);
    ok("the router's card is inside the visible map", !!rb && within(rb, v), json([rb, v]));
    const names = [...document.querySelectorAll('#layer-nodes text[font-size="10"]')].map((x) => x.getBoundingClientRect()).filter((b) => b.height > 0 && b.bottom > v.top && b.top < v.bottom);
    const lh = names.length ? Math.min(...names.map((b) => b.height)) : 0;
    ok('the device names in view are 7px tall or more (to 0.01px)', names.length > 0 && lh >= 6.99, `${names.length} names, ${lh}px`);
    const wide = state.nodes.filter((n) => { const b = cardBox(n.id); return b && (b.left < v.left - 0.5 || b.right > v.right + 0.5); }).map((n) => n.name);
    ok('nothing is cut off at the sides', wide.length === 0, json(wide));
    ok('no horizontal scroll after the big build', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth}`);

    // ---- 3. Five devices ----
    await build({ pc: 3, printer: 1, switch: 1 });
    ok('6 devices with the router', state.nodes.length === 6, String(state.nodes.length));
    ok('no row longer than 4 (small)', rows().every((r) => r.length <= 4), json(rows().map((r) => r.length)));
    const v3 = viewBox();
    const outside = state.nodes.filter((n) => { const b = cardBox(n.id); return !b || !within(b, v3); }).map((n) => n.name);
    ok('a small build is all inside the visible map', outside.length === 0, json(outside));
    ok('at the readable zoom or more (small)', state.camera.zoom >= 0.7, json(state.camera));

    // ---- 3b. Infrastructure that wraps (switch 1, AP 4: two rows of it) ----
    const clash = () => {
      const bad = [];
      state.nodes.forEach((p, i) => state.nodes.slice(i + 1).forEach((q) => {
        if (Math.abs(p.x - q.x) < 60 && Math.abs(p.y - q.y) < 60) bad.push(p.name + '/' + q.name);
      }));
      return bad;
    };
    await build({ switch: 1, ap: 4, pc: 4 });
    ok('10 devices with the router (wrapped infrastructure)', state.nodes.length === 10, String(state.nodes.length));
    ok('no two cards overlap (wrapped infrastructure)', clash().length === 0, json(clash()));
    const apLow = Math.max(...state.nodes.filter((n) => n.type === 'ap').map((n) => n.y));
    ok('the computers sit below the last AP row', state.nodes.filter((n) => n.type === 'pc').every((n) => n.y >= apLow + 110),
       json(state.nodes.map((n) => n.type + ':' + n.x + ',' + n.y)));

    // ---- 3c. Add devices onto a drawn map: framed readable ----
    // Onto the switch: Add devices onto the router would look only at the
    // router's own children (addDevicesNow's floor), a separate matter.
    const sw3 = state.nodes.find((n) => n.type === 'switch');
    state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera(); fitToView(null, { initial: true }); await settle();
    const got = addDevices({ items: [{ type: 'pc', count: 23 }], targetId: sw3.id });
    await settle();
    ok('Add devices: 23 added', got.length === 23, String(got.length));
    ok('Add devices: no row longer than 4', rows().every((r) => r.length <= 4), json(rows().map((r) => r.length)));
    ok('Add devices: no two cards overlap', clash().length === 0, json(clash()));
    ok('Add devices: framed at the readable zoom or more', state.camera.zoom >= 0.7, json(state.camera));
    const va = viewBox();
    const top = got.filter((n) => n.y === Math.min(...got.map((m) => m.y)));
    ok("Add devices: the added devices' first row is inside the visible map", top.every((n) => { const b = cardBox(n.id); return b && within(b, va); }),
       json(top.map((n) => cardBox(n.id))));

    // ---- 4. The page ----
    ok('no horizontal scroll', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth}`);
    ok('the page never zoomed', !window.visualViewport || window.visualViewport.scale === 1, String(window.visualViewport && window.visualViewport.scale));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    if (!el('addDevices').hidden) closeAddDevices();
    state.settings.advanced = savedAdvanced; saveSettings(); applyProfile();
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
