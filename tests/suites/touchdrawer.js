// @realtime @touch
// The phone's drawer as one scroller, its close button and the palette on a
// phone (Mobile batch 2; css/app.css "The phone's drawer as one scroller",
// js/mobile.js the drawer header and phonePalette*, js/ui.js the palette).
// On a 390x844 touch screen through window.__touch (real touch input,
// run-cross.mjs):
//   1. with the drawer open and nothing selected, the rail is the only box in
//      it that scrolls (textareas aside), and a swipe over the palette
//      scrolls the rail;
//   2. with a 48-port switch selected, a swipe over its port list scrolls the
//      rail, never the list on its own;
//   3. the drawer header stays at the rail's top, and the panel tabs stay
//      just under it, after a scroll;
//   4. the header's ✕ is at least 44x44 and closes the drawer;
//   5. a Note palette tap closes the drawer and opens the note's editor
//      inside the uncovered map;
//   6. a Switch palette tap with a device selected keeps the drawer open,
//      adds the switch connected to it (one undo step), and lands its Name
//      field inside the rail's visible box below the tabs, unfocused; closing
//      the drawer then pans the new switch into the uncovered map;
//   7. the end of the rail is reachable by finger: swiped to the end, its
//      last control is inside the rail's box; no horizontal scroll
//      (touchdrawer360 does the same on 360x780);
//   8. review fixes: a scrollIntoView in the rail lands below the header and
//      tabs (the rail's scroll-padding); a tab tapped deep in a long panel
//      shows its own panel from the top; with the library not kept open, two
//      Switch taps in a row work (the palette is not folded away while the
//      drawer is open) and it folds again on close; a stale add is not
//      panned to again on a later open and close;
//   9. My networks (from the drawer's Export menu) opens the landing and
//      closes the drawer, which would otherwise stay over it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(30); };
  const touch = (type, pts) => window.__touch(type, pts);
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); await settle(); await wait(350); };
  const mid = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const tapEl = async (node) => { const p = mid(node); await tap(p.x, p.y); };
  const swipe = async (x0, y0, x1, y1, steps = 10) => {
    await touch('touchStart', [{ x: x0, y: y0, id: 1 }]);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }]);
      await frame();
    }
    await touch('touchEnd', []);
    await settle();
    await wait(250);   // the fling's momentum
  };
  const ws = document.querySelector('.ws');
  const rail = document.querySelector('.topo-rail');
  const drawerOpen = () => ws.classList.contains('drawer-open');
  const openDrawer = async () => { if (!drawerOpen()) { el('handyMenu').click(); } await wait(350); await settle(); };
  const closeDrawer = async () => { if (drawerOpen()) el('handyMenu').click(); await wait(350); await settle(); };
  const box = () => rail.getBoundingClientRect();
  // Brings a control inside the rail into view by scrolling the rail only.
  const into = async (node, at = 0.5) => {
    const r = box();
    rail.scrollTop += node.getBoundingClientRect().top - r.top - r.height * at;
    await settle();
  };
  const scrollers = () => [rail, ...rail.querySelectorAll('*')].filter((e) => {
    if (e.tagName === 'TEXTAREA') return false;
    const st = getComputedStyle(e);
    return st.display !== 'none' && /(auto|scroll)/.test(st.overflowY) && e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1;
  });
  const describe = (list) => list.map((e) => (e.id || e.className || e.tagName) + ' ' + e.clientHeight + '/' + e.scrollHeight).join(', ');
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  const savedPin = libraryPinned();

  const D = (id, type, x, y, ip) => ({ id, type, name: type.toUpperCase() + ' ' + id, x, y, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: ip ? [{ id: 'i1', name: 'eth0', ip }] : [] });
  const doc = { v: DOC_VERSION, nodes: [D('a', 'pc', 0, 0, '10.0.0.11/24'), D('b', 'pc', 220, 0, '10.0.0.12/24'),
    Object.assign(D('s', 'switch', 110, 200, ''), { portCount: 8 })], links: [], annotations: [] };

  try {
    ok('this page is on a touch screen', navigator.maxTouchPoints > 0 && typeof window.__touch === 'function');
    setLibraryPinned(false);
    replaceDocument(doc, { origin: 'file', docId: 'touch-drawer' });
    setView('map');
    state.camera.x = 80; state.camera.y = 220; state.camera.zoom = 1; applyCamera();
    renderCanvasOnly();
    select(null, null);
    await settle();

    // ---- 1. Nothing selected ----
    await openDrawer();
    ok('the drawer is open', drawerOpen());
    rail.scrollTop = 0;
    await settle();
    let list = scrollers();
    ok('the rail is the only box in it that scrolls', list.length === 1 && list[0] === rail, describe(list));
    const pal = el('nodePalette');
    const pr = pal.getBoundingClientRect(), r0 = box();
    const sx = pr.left + pr.width / 2;
    const sy0 = Math.min(pr.bottom, r0.bottom) - 40;
    ok('the palette is under the finger', pal.contains(document.elementFromPoint(sx, sy0)), json([sx, sy0]));
    await swipe(sx, sy0, sx, sy0 - 260);
    ok('a swipe over the palette scrolls the rail', rail.scrollTop > 40, String(rail.scrollTop));

    // ---- 3 (first half). The header and tabs after a scroll ----
    const head = el('railHead');
    ok('the drawer header is shown', !!head && getComputedStyle(head).display !== 'none');
    ok('and stays at the rail\'s top', !!head && Math.abs(head.getBoundingClientRect().top - box().top) <= 1, head && json([head.getBoundingClientRect().top, box().top]));

    // ---- 2. A 48-port switch ----
    select('s', 'node');
    await settle();
    const cnt = el('portCountInput');
    ok('the switch shows its port count', !!cnt);
    if (cnt) { cnt.value = '48'; cnt.dispatchEvent(new Event('input', { bubbles: true })); }
    if (el('portCountInput')) el('portCountInput').blur();
    await settle();
    const det = document.querySelector('.port-attrs');
    if (det) det.open = true;
    await settle();
    const pl = document.querySelector('.port-attr-list');
    ok('its port list is there, 48 ports long', !!pl && pl.querySelectorAll('.port-attr').length >= 48, pl && String(pl.querySelectorAll('.port-attr').length));
    list = scrollers();
    ok('still the rail is the only scroller', list.length === 1 && list[0] === rail, describe(list));
    if (pl) {
      await into(pl, 0.2);
      const lb = pl.getBoundingClientRect(), rb = box();
      const px = lb.left + lb.width / 2;
      const py0 = Math.min(lb.bottom, rb.bottom) - 60;
      const t0 = rail.scrollTop;
      ok('the port list is under the finger', pl.contains(document.elementFromPoint(px, py0)), json([px, py0]));
      await swipe(px, py0, px, py0 - 220);
      ok('a swipe over the port list scrolls the rail', rail.scrollTop - t0 > 60, `${t0} -> ${rail.scrollTop}`);
      ok('and the list does not scroll on its own', pl.scrollTop === 0, String(pl.scrollTop));

      // ---- 8a. scrollIntoView clears the header and tabs ----
      const tabsEl = document.querySelector('.rail-props .cfg-tabs');
      const line = pl.querySelector('.port-attr[data-port]');
      rail.scrollTop = rail.scrollHeight;
      await settle();
      line.scrollIntoView({ block: 'nearest' });
      await settle();
      const lnb = line.getBoundingClientRect(), tbb = tabsEl.getBoundingClientRect();
      ok('a port line scrolled into view from below lands under the tabs, not behind them',
        lnb.top >= tbb.bottom - 1 && lnb.bottom <= box().bottom + 0.5, json([lnb.top, tbb.bottom]));

      // ---- 8b. A tab tapped deep in a long panel ----
      await into(pl, 0.2);
      const rp = document.querySelector('.rail-props');
      ok('the rail is scrolled past the panel\'s start', rp.getBoundingClientRect().top < box().top - 100, json([rp.getBoundingClientRect().top, box().top]));
      // As long as the port list's panel (the content here is short, and a
      // short one only hides the bug: the rail clamps to its new end).
      const dp = el('cfgPanel-diagnostics');
      dp.style.minHeight = '2400px';
      await tapEl(el('diagTabBtn'));
      const dpb = dp.getBoundingClientRect(), tb3 = tabsEl.getBoundingClientRect();
      ok('a Diagnostics tap there shows that tab', !dp.classList.contains('hidden'));
      ok('from its top, just under the tabs', dpb.top >= tb3.bottom - 1 && dpb.top <= tb3.bottom + 24, json([dpb.top, tb3.bottom]));
      rail.scrollTop += 1500;
      await settle();
      await tapEl(el('configTabBtn'));
      dp.style.minHeight = '';
      const cpb = el('cfgPanel-config').getBoundingClientRect(), tb4 = tabsEl.getBoundingClientRect();
      ok('and Configuration, tapped deep in that, comes back from its top', !el('cfgPanel-config').classList.contains('hidden')
        && cpb.top >= tb4.bottom - 1 && cpb.top <= tb4.bottom + 24, json([cpb.top, tb4.bottom]));
    }

    // ---- 3. The tabs stay under the header ----
    const tabs = document.querySelector('.rail-props .cfg-tabs');
    rail.scrollTop = rail.scrollHeight;
    await settle();
    const hb = head.getBoundingClientRect(), tb = tabs.getBoundingClientRect();
    ok('the rail has scrolled well past the tabs\' place', rail.scrollTop > 400, String(rail.scrollTop));
    ok('the header is still at the rail\'s top', Math.abs(hb.top - box().top) <= 1, json([hb.top, box().top]));
    ok('and the tabs just under it', Math.abs(tb.top - hb.bottom) <= 1.5 && tb.height > 20, json([tb.top, hb.bottom, tb.height]));
    const topTab = document.elementFromPoint(tb.left + 40, tb.top + 12);
    ok('the tabs are on top of what scrolls under them', !!topTab && tabs.contains(topTab), topTab && (topTab.id || topTab.className));

    // ---- 7. The end is reachable ----
    const lastControl = () => [...rail.querySelectorAll('button, input, select, textarea, summary, a[href]')]
      .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
      .sort((p, q) => q.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom)[0];
    const endCheck = async (label) => {
      // By finger, as a person would: swipe up over the rail until it stops.
      rail.scrollTop = 0;
      await settle();
      for (let i = 0, last = -1; i < 30 && rail.scrollTop !== last; i++) {
        last = rail.scrollTop;
        const rb = box();
        await swipe(rb.left + rb.width * 0.7, rb.bottom - 60, rb.left + rb.width * 0.7, rb.top + 140, 8);
      }
      const lc = lastControl();
      const lb = lc && lc.getBoundingClientRect();
      ok(label + ': a finger reaches the rail\'s very end', Math.abs(rail.scrollTop + rail.clientHeight - rail.scrollHeight) <= 1, json([rail.scrollTop, rail.clientHeight, rail.scrollHeight]));
      ok(label + ': and its last control is inside the rail', !!lb && lb.bottom <= box().bottom + 0.5 && lb.top >= box().top, lc && `${lc.id || lc.className} ${lb.bottom} / ${box().bottom}`);
    };
    await endCheck('a switch selected');
    if (det) det.open = false;
    select(null, null);
    await settle();
    await endCheck('nothing selected');
    ok('no horizontal scroll with the drawer open', document.documentElement.scrollWidth <= window.innerWidth, `${document.documentElement.scrollWidth} > ${window.innerWidth}`);

    // ---- 4. The close button ----
    const x = el('railClose');
    const xb = x && x.getBoundingClientRect();
    ok('the close button is at least 44x44', !!xb && xb.width >= 44 && xb.height >= 44, xb && json([xb.width, xb.height]));
    ok('it says what it does', !!x && x.getAttribute('aria-label') === 'Close controls' && x.title === 'Close controls', x && x.getAttribute('aria-label'));
    rail.scrollTop = 0;
    await settle();
    if (x) await tapEl(x);
    ok('a tap on it closes the drawer', !drawerOpen());
    ok('and the ☰ says so', el('handyMenu').getAttribute('aria-expanded') === 'false', el('handyMenu').getAttribute('aria-expanded'));
    rail.scrollTop = 300;
    await openDrawer();
    rail.scrollTop = 300;
    await settle();
    const xb2 = x.getBoundingClientRect();
    ok('scrolled, it is still in reach', document.elementFromPoint(xb2.left + xb2.width / 2, xb2.top + xb2.height / 2) === x || x.contains(document.elementFromPoint(xb2.left + xb2.width / 2, xb2.top + xb2.height / 2)));
    await tapEl(x);
    ok('and still closes the drawer', !drawerOpen());

    // ---- 5. Note ----
    await openDrawer();
    const noteBtn = [...pal.querySelectorAll('.palette-item')].find((b) => !b.dataset.type && /Note/.test(b.textContent));
    ok('the palette has Note', !!noteBtn);
    if (noteBtn) {
      await into(noteBtn);
      const a0 = state.annotations.length;
      await tapEl(noteBtn);
      await wait(300);
      ok('a Note tap closes the drawer', !drawerOpen());
      const ed = el('annEditor');
      ok('and opens the new note\'s editor', state.annotations.length === a0 + 1 && !!ed, String(state.annotations.length - a0));
      if (ed) {
        const v = mapViewport(), cr = el('networkCanvas').getBoundingClientRect(), eb = ed.getBoundingClientRect();
        const inside = eb.left >= cr.left + v.left && eb.right <= cr.left + v.left + v.width && eb.top >= cr.top + v.top && eb.bottom <= cr.top + v.top + v.height;
        ok('inside the uncovered map', inside, json([eb.left, eb.top, eb.right, eb.bottom, v, cr.top]));
        ok('where nothing covers it', ed.contains(document.elementFromPoint(eb.left + eb.width / 2, eb.top + eb.height / 2)));
        ok('with the focus, for typing', document.activeElement === ed, document.activeElement && (document.activeElement.id || document.activeElement.tagName));
        await window.__type('Rack B');
        ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();
        ok('Escape drops it, as on a desktop', !el('annEditor'));
      }
    }

    // ---- 8c. The library not kept open: two device taps in a row ----
    select(null, null);
    setLibraryPinned(false);
    await settle();
    await openDrawer();
    rail.scrollTop = 0;
    await settle();
    {
      const sw = pal.querySelector('.palette-item[data-type="switch"]');
      const n0 = state.nodes.length;
      await into(sw);
      await tapEl(sw);
      await settle();
      const first = state.nodes[state.nodes.length - 1];
      ok('unpinned, a Switch tap adds a switch and keeps the drawer open', state.nodes.length === n0 + 1 && drawerOpen());
      ok('and the library is not folded away under the finger', !rail.classList.contains('lib-wrapped') && pal.getBoundingClientRect().height > 0,
        rail.className);
      await into(sw);
      await tapEl(sw);
      await settle();
      const second = state.nodes[state.nodes.length - 1];
      ok('so a second tap adds another switch', state.nodes.length === n0 + 2 && second.type === 'switch', String(state.nodes.length - n0));
      ok('connected to the first', state.links.some((l) => (l.source === first.id && l.target === second.id) || (l.source === second.id && l.target === first.id)));
      await closeDrawer();
      ok('closed, the library folds again (something is selected)', rail.classList.contains('lib-wrapped'));
    }

    // ---- 6. A device ----
    select('a', 'node');
    await settle();
    await openDrawer();
    rail.scrollTop = 0;
    await settle();
    // The library is folded while something is selected; Keep open unfolds it.
    const wrapRow = el('libWrapRow');
    if (rail.classList.contains('lib-wrapped')) await tapEl(wrapRow);
    ok('the library is open with a device selected', !rail.classList.contains('lib-wrapped') && state.selectedId === 'a');
    const swBtn = pal.querySelector('.palette-item[data-type="switch"]');
    ok('the palette has Switch', !!swBtn);
    if (swBtn) {
      await into(swBtn);
      const n0 = state.nodes.length, l0 = state.links.length, u0 = _undoStack.length;
      await tapEl(swBtn);
      await wait(200);
      await settle();
      const nn = state.nodes[state.nodes.length - 1];
      ok('a Switch tap adds a switch', state.nodes.length === n0 + 1 && nn.type === 'switch', String(state.nodes.length - n0));
      ok('connected to the selected device, in one undo step', state.links.length === l0 + 1 && _undoStack.length === u0 + 1, `${state.links.length - l0} / ${_undoStack.length - u0}`);
      ok('the drawer stays open', drawerOpen());
      ok('the new switch is selected', state.selectedId === nn.id, state.selectedId);
      const name = el('propName');
      const nb = name.getBoundingClientRect(), tb2 = tabs.getBoundingClientRect(), rb = box();
      ok('its Name field is inside the rail\'s visible box', nb.height > 0 && nb.top >= tb2.bottom - 1 && nb.bottom <= rb.bottom, json([nb.top, nb.bottom, tb2.bottom, rb.bottom]));
      ok('near the top, under the tabs', nb.top - tb2.bottom < 120, json([nb.top, tb2.bottom]));
      ok('and is not focused (no keyboard)', document.activeElement !== name);
      ok('it holds the new switch\'s name', name.value === nn.name, name.value);
      // Off the map's view (130 below its parent): closing pans it in.
      state.camera.x = 80; state.camera.y = -200; applyCamera();
      await settle();
      await tapEl(el('railClose'));
      await wait(100);
      await settle();
      const v = mapViewport(), z = state.camera.zoom;
      const sxn = nn.x * z + state.camera.x, syn = nn.y * z + state.camera.y;
      ok('closing the drawer pans the new switch into view', sxn > v.left && sxn < v.left + v.width && syn > v.top && syn < v.top + v.height, json([sxn, syn, v]));
      ok('by a small pan, the zoom as it was', state.camera.zoom === z && state.camera.y > -200 && state.camera.y < 200, json([state.camera]));
    }
    // ---- 8d. A stale reveal ----
    await closeDrawer();
    window.phonePaletteDevice('pc', null);
    await settle();
    state.camera.x = 4000; state.camera.y = 4000; applyCamera();
    await settle();
    const cam0 = json([state.camera.x, state.camera.y]);
    await openDrawer();
    await closeDrawer();
    await wait(50);
    ok('a device added with the drawer closed is not panned to again on a later open and close', json([state.camera.x, state.camera.y]) === cam0, json([state.camera.x, state.camera.y]) + ' vs ' + cam0);
    ok('no horizontal scroll', document.documentElement.scrollWidth <= window.innerWidth);
    // ---- 9. My networks from the drawer ----
    // The landing opened from the drawer's Export menu is not left under
    // the open drawer: the drawer closes, as its ✕ does.
    await openDrawer();
    el('myNetworksBtn').click();
    await settle();
    ok('9 My networks opens the landing and closes the drawer', landingIsOpen() && !drawerOpen() && el('handyMenu').getAttribute('aria-expanded') === 'false',
       json([landingIsOpen(), drawerOpen(), el('handyMenu').getAttribute('aria-expanded')]));
    closeLanding();
    await settle();
    // 9b. The same through the drawer header's 🗂️ (step 3): in sight, 44x44, a tap.
    await openDrawer();
    const nb9 = el('drawerNetworksBtn').getBoundingClientRect();
    ok('9b My networks is in the drawer header, 44x44', nb9.width >= 44 && nb9.height >= 44 && nb9.right <= el('railClose').getBoundingClientRect().left + 1
       && el('drawerNetworksBtn').getAttribute('aria-label') === 'My networks', json([nb9.width, nb9.height]));
    await tapEl(el('drawerNetworksBtn'));
    await settle();
    ok('9b its tap opens the landing and closes the drawer', landingIsOpen() && !drawerOpen(), json([landingIsOpen(), drawerOpen()]));
    closeLanding();
    await settle();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLibraryPinned(savedPin);
    setDialogResponder(heldResponder);
    if (drawerOpen()) el('handyMenu').click();
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
