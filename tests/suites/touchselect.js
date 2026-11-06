// @realtime @touch
// Several devices selected by touch (Mobile batch 2; js/mobile.js the
// selection bar's Select more, js/ui.js selectMoreOn / pressNode, js/app.js
// the empty-map press). On a 390x844 touch screen through window.__touch
// (real touch input, run-cross.mjs):
//   1. with Select more on, three taps leave three devices selected, a tap on
//      a cable adds it and a second takes it out, a tap on one again removes
//      it, and a tap on empty map keeps the set; the bar says the count;
//   2. a finger drag on a member moves every member by the same step, as one
//      undo step, and one handy-bar Undo puts them all back;
//   3. a pinch and a pan on empty map still move the camera, the set and the
//      mode kept;
//   4. Edit opens the drawer with #multiSelectionPane in view, the touch hint
//      and the bulk panel (full mode);
//   5. Done keeps the selection and turns the mode off, so the next tap
//      selects one device alone;
//   6. Delete removes the set as one undo step and ends the mode;
//   7. an Esc a field, an overlay or an earlier handler took keeps the mode;
//      an Esc that reaches the map ends it; no horizontal scroll;
//   8. a collapsed group: a tap on its cable bundle adds the bundle's cables
//      and a second takes them out, a tap on its node gathers its devices
//      (not expanding it), a tap on a note's red leader keeps the set;
//   9. the Table view ends the mode;
//  10. the screen growing past 900px ends the mode, and a touch screen that
//      wide (no Select more) keeps the Shift-click hint.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(30); };
  const touch = (type, pts) => window.__touch(type, pts);
  // Past the card double-tap window (js/ui.js CARD_DOUBLE_TAP_MS), so two
  // taps in a row are two taps.
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); await settle(); await wait(560); };
  const swipe = async (x0, y0, x1, y1, steps = 10) => {
    await touch('touchStart', [{ x: x0, y: y0, id: 1 }]);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }]);
      await frame();
    }
    await touch('touchEnd', []);
    await settle();
  };
  const pinch = async (cx, cy, d0, d1, steps = 10) => {
    const at = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
    await touch('touchStart', at(d0));
    for (let i = 1; i <= steps; i++) { await touch('touchMove', at(d0 + (d1 - d0) * i / steps)); await frame(); }
    await touch('touchEnd', []);
    await settle();
  };
  const mid = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const tapEl = async (node) => { const p = mid(node); await tap(p.x, p.y); };
  const cardAt = (id) => mid(el('ui-node-' + id).querySelector('rect'));
  const tapNode = async (id) => { const p = cardAt(id); await tap(p.x, p.y); };
  const bar = (act) => el('selBar').querySelector(`[data-act="${act}"]`);
  const shown = (node) => !!node && !node.hidden && getComputedStyle(node).display !== 'none';
  const drawerOpen = () => document.querySelector('.ws').classList.contains('drawer-open');
  const sel = () => [...state.selection].map((e) => e.type[0] + ':' + e.id).sort();
  const cam = () => ({ x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom });
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  const D = (id, x, y, ip) => ({ id, type: 'pc', name: 'PC ' + id.toUpperCase(), x, y, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const doc = { v: DOC_VERSION,
    nodes: [D('a', 0, 0, '10.0.0.11/24'), D('b', 220, 0, '10.0.0.12/24'), D('c', 0, 240, '10.0.0.13/24'), D('d', 220, 240, '10.0.0.14/24')],
    links: [{ id: 'l1', source: 'c', target: 'd' }], annotations: [] };
  const home = () => { state.camera.x = 60; state.camera.y = 160; state.camera.zoom = 1; applyCamera(); };
  const EMPTY = { x: 170, y: 260 };   // between the two rows, clear of the cable

  try {
    ok('this page is on a touch screen', navigator.maxTouchPoints > 0 && typeof window.__touch === 'function');
    replaceDocument(doc, { origin: 'file', docId: 'touch-select' });
    setView('map');
    home();
    renderCanvasOnly();
    await settle();
    select(null, null);
    await settle();
    ok('the empty spot is empty map', document.elementFromPoint(EMPTY.x, EMPTY.y) === el('networkCanvas'), document.elementFromPoint(EMPTY.x, EMPTY.y) && document.elementFromPoint(EMPTY.x, EMPTY.y).id);

    // ---- 1. Taps add and take out ----
    await tapNode('a');
    ok('a tap selects one device', json(sel()) === json(['n:a']));
    ok('the bar offers Select more', !!bar('more') && shown(el('selBar')));
    await tapEl(bar('more'));
    ok('Select more turns the mode on', selectMoreOn() && el('selBar').dataset.more === 'on');
    ok('the bar then holds Edit, Delete and Done', json([...el('selBar').querySelectorAll('button')].map((b) => b.dataset.act)) === json(['edit', 'remove', 'done']));
    await tapNode('b');
    await tapNode('c');
    ok('three taps leave three devices selected', json(sel()) === json(['n:a', 'n:b', 'n:c']), json(sel()));
    ok('the bar says the count', /3 selected/.test(el('selBar').querySelector('.sel-bar-name').textContent), el('selBar').textContent);
    const lp = (() => { const a = cardAt('c'), b = cardAt('d'); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; })();
    await tap(lp.x, lp.y);
    ok('a tap on a cable adds it', json(sel()) === json(['l:l1', 'n:a', 'n:b', 'n:c']), json(sel()));
    await tap(lp.x, lp.y);
    ok('a second takes it out', json(sel()) === json(['n:a', 'n:b', 'n:c']), json(sel()));
    await tapNode('b');
    ok('a tap on one again removes it', json(sel()) === json(['n:a', 'n:c']), json(sel()));
    await tap(EMPTY.x, EMPTY.y);
    ok('a tap on empty map keeps the set', json(sel()) === json(['n:a', 'n:c']) && selectMoreOn(), json(sel()));
    const btns = [...el('selBar').querySelectorAll('button')];
    ok('every bar button is at least 44px', btns.length && btns.every((b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }), json(btns.map((b) => Math.round(b.getBoundingClientRect().width))));
    const sb = el('selBar').getBoundingClientRect();
    ok('the bar sits inside the screen', sb.left >= 0 && sb.right <= innerWidth && sb.bottom <= el('handyBar').getBoundingClientRect().top, json([sb.left, sb.right]));

    // ---- 2. A finger drag on a member moves the set ----
    const p0 = { a: [getNode('a').x, getNode('a').y], c: [getNode('c').x, getNode('c').y], b: [getNode('b').x, getNode('b').y] };
    const u0 = _undoStack.length;
    const s = cardAt('a');
    await swipe(s.x, s.y, s.x + 80, s.y + 40, 12);
    await wait(100);
    const da = [getNode('a').x - p0.a[0], getNode('a').y - p0.a[1]], dc = [getNode('c').x - p0.c[0], getNode('c').y - p0.c[1]];
    ok('a drag on a member moves it', da[0] !== 0 || da[1] !== 0, json(da));
    ok('and every member by the same step', json(da) === json(dc), json([da, dc]));
    ok('a device outside the set stays', json([getNode('b').x, getNode('b').y]) === json(p0.b));
    ok('as one undo step', _undoStack.length === u0 + 1, u0 + ' -> ' + _undoStack.length);
    ok('the set and the mode are kept', json(sel()) === json(['n:a', 'n:c']) && selectMoreOn(), json(sel()));
    el('handyUndo').click();
    await settle();
    ok('one handy-bar Undo puts them all back', json([getNode('a').x, getNode('a').y, getNode('c').x, getNode('c').y]) === json([...p0.a, ...p0.c]),
      json([getNode('a').x, getNode('a').y, getNode('c').x, getNode('c').y]));
    ok('and the set and the mode survive the Undo', json(sel()) === json(['n:a', 'n:c']) && selectMoreOn(), json(sel()) + ' more=' + selectMoreOn());

    // A drag on a device outside the set moves it alone and keeps the set.
    {
      const q0 = { a: [getNode('a').x, getNode('a').y], b: [getNode('b').x, getNode('b').y], c: [getNode('c').x, getNode('c').y] };
      const u2 = _undoStack.length;
      const sb2 = cardAt('b');
      await swipe(sb2.x, sb2.y, sb2.x + 30, sb2.y + 60, 12);
      await wait(100);
      ok('a drag on a device outside the set moves it', getNode('b').x !== q0.b[0] || getNode('b').y !== q0.b[1], json([getNode('b').x, getNode('b').y]));
      ok('and no member', json([getNode('a').x, getNode('a').y, getNode('c').x, getNode('c').y]) === json([...q0.a, ...q0.c]));
      ok('the set and the mode are kept after it', json(sel()) === json(['n:a', 'n:c']) && selectMoreOn(), json(sel()));
      ok('that drag is one undo step', _undoStack.length === u2 + 1, u2 + ' -> ' + _undoStack.length);
      el('handyUndo').click();
      await settle();
      ok('and Undo puts it back', json([getNode('b').x, getNode('b').y]) === json(q0.b));
    }

    // ---- 3. Pinch and pan still move the camera ----
    home(); await settle();
    let c0 = cam();
    await pinch(EMPTY.x, EMPTY.y, 80, 200);
    ok('a pinch on empty map zooms with the mode on', state.camera.zoom > c0.zoom * 1.8, json([c0, cam()]));
    ok('and keeps the set and the mode', json(sel()) === json(['n:a', 'n:c']) && selectMoreOn(), json(sel()));
    home(); await settle();
    c0 = cam();
    await swipe(EMPTY.x, EMPTY.y, EMPTY.x + 40, EMPTY.y + 50);
    ok('a pan on empty map moves the camera', Math.abs(state.camera.x - c0.x - 40) < 1.5 && Math.abs(state.camera.y - c0.y - 50) < 1.5, json([c0, cam()]));
    ok('and keeps the set and the mode', json(sel()) === json(['n:a', 'n:c']) && selectMoreOn(), json(sel()));
    home(); await settle();
    await wait(400);

    // ---- 4. Edit: the multi-selection pane ----
    await tapNode('d');
    ok('a third device joins', json(sel()) === json(['n:a', 'n:c', 'n:d']), json(sel()));
    await tapEl(bar('edit'));
    await wait(450);   // the drawer's slide
    ok('Edit opens the drawer', drawerOpen());
    const rail = document.querySelector('.topo-rail').getBoundingClientRect();
    const mp = el('multiSelectionPane');
    const mr = mp.getBoundingClientRect();
    ok('with the multi-selection pane in the rail\'s visible box', !mp.classList.contains('hidden') && mr.height > 0 && mr.top >= rail.top - 1 && mr.top < rail.bottom - 40, json([rail.top, rail.bottom, mr.top]));
    ok('the bulk panel is there (full mode)', !el('bulkPanel').classList.contains('hidden'));
    const fine = mp.querySelector('.hint-fine'), coarse = mp.querySelector('.hint-coarse');
    ok('the hint says to tap, not Shift-click', shown(coarse) && !shown(fine) && coarse.textContent === 'Tap devices to add or remove them.', coarse && coarse.textContent);
    ok('the bar steps aside under the drawer', !shown(el('selBar')));
    el('handyMenu').click();   // closes it (carino-ui.js)
    await wait(450);
    ok('closed again, the mode is still on', !drawerOpen() && selectMoreOn() && shown(el('selBar')));

    // ---- 5. Done ----
    await tapEl(bar('done'));
    ok('Done keeps the selection', json(sel()) === json(['n:a', 'n:c', 'n:d']), json(sel()));
    ok('and turns the mode off', !selectMoreOn() && el('selBar').dataset.more === 'off');
    ok('the set\'s bar offers Select more again', !!bar('more'));
    await tapNode('b');
    ok('the next tap selects one device alone', json(sel()) === json(['n:b']), json(sel()));

    // ---- 6. Delete ----
    await tapEl(bar('more'));
    await tapNode('a');
    ok('back on, a tap adds', json(sel()) === json(['n:a', 'n:b']) && selectMoreOn(), json(sel()));
    const n0 = state.nodes.length, u1 = _undoStack.length;
    await tapEl(bar('remove'));
    ok('Delete removes the set', state.nodes.length === n0 - 2 && !getNode('a') && !getNode('b'), String(state.nodes.length));
    ok('as one undo step', _undoStack.length === u1 + 1, u1 + ' -> ' + _undoStack.length);
    ok('and the emptied set ends the mode', !selectMoreOn() && !state.selection.size);
    el('handyUndo').click();
    await settle();
    ok('one Undo brings both back', !!getNode('a') && !!getNode('b') && state.nodes.length === n0);

    // ---- 7. Esc, width ----
    renderCanvasOnly(); await settle();
    await tapNode('c');
    await tapEl(bar('more'));
    ok('on again', selectMoreOn());
    const esc = () => (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    // An Esc a field takes (it blurs the field) is not the map's.
    const fld = document.createElement('input'); document.body.appendChild(fld); fld.focus();
    esc(); await settle();
    ok('Esc in a field keeps the mode', selectMoreOn() && json(sel()) === json(['n:c']), json(sel()));
    fld.remove();
    // An Esc spent already (the navbar's About window, a dialog's own).
    const spend = (e) => { if (e.key === 'Escape') e.preventDefault(); };
    window.addEventListener('keydown', spend, true);
    esc(); await settle();
    window.removeEventListener('keydown', spend, true);
    ok('an Esc already handled keeps the mode', selectMoreOn() && json(sel()) === json(['n:c']), json(sel()) + ' more=' + selectMoreOn());
    // An Esc that closes an overlay (the shortcut list) closes only it.
    toggleShortcutHelp(true); await settle();
    esc(); await settle();
    ok('an Esc that closes an overlay keeps the mode', !helpShown() && selectMoreOn() && json(sel()) === json(['n:c']), 'help=' + helpShown() + ' ' + json(sel()) + ' more=' + selectMoreOn());
    esc();
    await settle();
    ok('Esc on the map ends the mode', !selectMoreOn());
    ok('no horizontal scroll', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth} > ${innerWidth}`);


    // ---- 8. A collapsed group, a note's leader ----
    {
      const G = (id, x, y) => Object.assign(D(id, x, y, ''), { group: 'gx' });
      replaceDocument({ v: DOC_VERSION,
        nodes: [G('g1', 0, 0), G('g2', 0, 140), D('sw', 260, 70, '10.0.0.2/24'), D('e', 260, 300, '10.0.0.3/24')],
        links: [{ id: 'k1', source: 'g1', target: 'sw' }, { id: 'k2', source: 'g2', target: 'sw' }],
        groups: [{ id: 'gx', name: 'Office', kind: 'room' }],
        annotations: [{ id: 'nt', x: 40, y: 330, text: 'Spare', style: 'note', size: 12, targets: ['e'] }] }, { origin: 'file', docId: 'touch-select-groups' });
      setView('map'); home();
      setGroupCollapsed('gx', true);
      renderCanvasOnly(); await settle(); await wait(500);
      await tapNode('sw');
      await tapEl(bar('more'));
      ok('a set of one, the mode on', selectMoreOn() && json(sel()) === json(['n:sw']));
      const edge = el('layer-links').querySelector('.grp-edge[data-links="k1 k2"]') || el('layer-links').querySelector('.grp-edge');
      ok('the collapsed group draws one bundle', !!edge && /k1/.test(edge.getAttribute('data-links')) && /k2/.test(edge.getAttribute('data-links')), edge && edge.getAttribute('data-links'));
      if (edge) {
        // A spot on the line, a third of the way from the fold (the middle holds its count).
        const len = edge.getTotalLength(), q = edge.getPointAtLength(len * 0.3), m = edge.getScreenCTM();
        const p = { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
        const hitAt = document.elementFromPoint(p.x, p.y);
        ok('the spot is on the bundle', hitAt === edge, json(p) + ' ' + (hitAt ? hitAt.outerHTML.slice(0, 90) : 'nothing'));
        await tap(p.x, p.y);
        ok('a tap on the bundle adds its cables to the set', json(sel()) === json(['l:k1', 'l:k2', 'n:sw']) && selectMoreOn(), json(sel()));
        await tap(p.x, p.y);
        ok('a second takes them out', json(sel()) === json(['n:sw']) && selectMoreOn(), json(sel()));
      }
      const fold = el('ui-group-gx');
      ok('the collapsed node is drawn', !!fold);
      if (fold) {
        await tapEl(fold.querySelector('rect') || fold);
        await wait(300);
        ok('a tap on the collapsed node gathers its devices', json(sel()) === json(['n:g1', 'n:g2', 'n:sw']) && selectMoreOn(), json(sel()));
        ok('and leaves the group collapsed', isGroupCollapsed('gx'));
      }
      const hit = el('ui-annlinkhit-nt-e');
      ok('the note\'s red leader is drawn', !!hit);
      if (hit) {
        const hr = hit.getBoundingClientRect();
        await tap(hr.left + hr.width / 2, hr.top + hr.height / 2);
        ok('a tap on the leader keeps the set', json(sel()) === json(['n:g1', 'n:g2', 'n:sw']) && selectMoreOn(), json(sel()));
      }
      setGroupCollapsed('gx', false);
      await settle();

      // ---- 9. The Table view ends the mode ----
      ok('still on before the Table', selectMoreOn());
      setView('table'); await settle();
      ok('the Table view ends the mode', !selectMoreOn());
      setView('map'); await settle();
      ok('back on the map it is still off', !selectMoreOn());
    }

    // ---- 10. Past 900px ----
    if (typeof window.__viewport === 'function') {
      select('sw', 'node'); await settle();
      await tapEl(bar('more'));
      selectEntries([{ type: 'node', id: 'sw' }, { type: 'node', id: 'e' }]);
      await settle();
      ok('on, with a set of two', selectMoreOn());
      await window.__viewport(1180, 820);
      await settle(); await wait(200);
      ok('the screen grown past 900px ends the mode', matchMedia('(max-width: 900px)').matches === false && !selectMoreOn());
      const mp2 = el('multiSelectionPane');
      const f2 = mp2.querySelector('.hint-fine'), c2 = mp2.querySelector('.hint-coarse');
      ok('a touch screen that wide keeps the Shift-click hint', matchMedia('(pointer: coarse)').matches && getComputedStyle(f2).display !== 'none' && getComputedStyle(c2).display === 'none',
        getComputedStyle(f2).display + '/' + getComputedStyle(c2).display);
      await window.__viewport(390, 844);
      await settle(); await wait(200);
      ok('back at 390, the tap hint again', getComputedStyle(c2).display !== 'none' && getComputedStyle(f2).display === 'none');
    } else ok('the runner can resize the screen (window.__viewport)', false);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    if (typeof setSelectMore === 'function') setSelectMore(false);
    state.linkSourceId = null;
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
