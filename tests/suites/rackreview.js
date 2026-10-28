// The whole-change review of round 2 (Review-Packs/Topo-groups.md, "Round
// 2"), its five findings held fixed. The suite runs in an 800px-wide window,
// the narrow layout (900px and below), where the first and the third were.
//   1. a device dragged up to the top units of a rack scrolled to its top
//      lands there: the two targets off the rack sit under the units' pane,
//      never over it, and a target that does end up over the pane gives way
//      to the units; a move or resize held near the pane's top or bottom
//      scrolls it, counting the units it scrolled, so a device reaches units
//      out of sight; one undo step;
//   2. the place dialog keeps a device's own depth unless its Full depth box
//      is changed by hand: a half-depth device picked on units free on both
//      faces stays half; a full-depth one behind a half-depth device goes in
//      at half; the row says "half depth" where the box says full; ticked by
//      hand, the box decides for whatever is picked;
//   3. narrow, the column scrolls as one with the units stuck to its top at
//      about a third of the window or more, so a list's rows come up under
//      them; a device tapped brings the column back up to its buttons;
//   4. a device dropped on the map into another rack's frame keeps its units
//      only where they are free there: taken, or past that rack's top, it
//      waits under Not placed yet, and the toast says so; one undo step;
//   5. on a rack numbered from the top, a device past the top is worded by
//      its bottom unit and how far above U1 it reaches (tests/suites/
//      racksize.js has the wording; here, that no "from U1 ... past U1").
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const view = () => el('rackView');
  const pane = () => view().querySelector('.rk-main');
  const body = () => el('rackBody');
  const dev = (id) => view().querySelector(`.rk-dev:not(.rk-back)[data-node="${id}"]`);
  const slots = (face) => view().querySelector(`.rk-slots[data-face="${face}"]`);
  const toast = () => el('topoToast').textContent;
  const clearToast = () => { el('topoToast').textContent = ''; };
  const mid = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const ptr = (type, target, x, y, extra = {}) => target.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7, pointerType: 'mouse', isPrimary: true }, extra)));
  const unitY = (face, u, top) => { const r = slots(face).getBoundingClientRect(); return r.top + r.height - (u - 0.5) * (r.height / top); };

  try {
    ok('the window is the narrow layout (900px and below)', window.matchMedia('(max-width: 900px)').matches, String(window.innerWidth));

    // ---- 1: up to the top units; the targets under the pane; autoscroll ----
    replaceDocument({ v: DOC_VERSION, nodes: [N('a', 'server', { group: 'rk', rackU: 40 }), N('b', 'server', { x: 100, group: 'rk', rackU: 2 })], links: [],
      groups: [{ id: 'rk', name: 'R', kind: 'rack', uHeight: 42 }] }, { origin: 'file', docId: 'rackreview-1' });
    openRackView('rk');
    select(null);
    renderRackView(true);
    pane().scrollTop = 0;
    let [x0, y0] = mid(dev('a'));
    const p = pane().getBoundingClientRect();
    let undoAt = _undoStack.length;
    ptr('pointerdown', dev('a'), x0, y0);
    ptr('pointermove', window, x0, y0 - 10);
    const dock = view().querySelector('.rk-dock');
    ok('dragged, the targets are open', !!dock);
    ok('narrow, they sit under the units\' pane, not over its top units', dock.getBoundingClientRect().top >= p.bottom - 1,
      `${dock.getBoundingClientRect().top} < ${p.bottom}`);
    const y42 = unitY('front', 42, 42), y41 = unitY('front', 41, 42);
    ok('U41 and U42 are in the pane, at its top', y42 > p.top && y41 < p.top + 70, `${y42} ${y41} ${p.top}`);
    ptr('pointermove', window, x0, y41);
    ok('over U41, no target is lit', !dock.querySelector('.rk-over') && !dev('a').classList.contains('rk-leaving'));
    ptr('pointerup', window, x0, y41);
    ok('let go over U41, it goes to U41 (it lost its units before)', getNode('a').rackU === 41 && getNode('a').group === 'rk', json(getNode('a')));
    ok('in one undo step', _undoStack.length === undoAt + 1);
    undo();
    // A target that ends up over the pane (a window too short for both)
    // gives way to the units under it.
    pane().scrollTop = 0;
    [x0, y0] = mid(dev('a'));
    ptr('pointerdown', dev('a'), x0, y0);
    ptr('pointermove', window, x0, y0 - 10);
    const d2 = view().querySelector('.rk-dock');
    d2.style.top = `${Math.round(p.top - view().getBoundingClientRect().top)}px`;   // forced over the top units
    const z = d2.querySelector('[data-zone="out"]').getBoundingClientRect();
    ok('rvZoneAt: over the pane, the units win', rvZoneAt(d2, z.left + 10, z.top + z.height / 2) === null);
    ptr('pointerup', window, x0, y0 - 10);
    if (getNode('a').rackU !== 40) undo();
    ok('(as it was)', getNode('a').rackU === 40);
    // Below the pane, the target still works.
    pane().scrollTop = 0;
    [x0, y0] = mid(dev('a'));
    undoAt = _undoStack.length;
    ptr('pointerdown', dev('a'), x0, y0);
    ptr('pointermove', window, x0, y0 + 10);
    const [ox, oy] = mid(view().querySelector('.rk-dock [data-zone="out"]'));
    ptr('pointermove', window, ox, oy);
    ok('under the pane, Not placed yet is lit', view().querySelector('.rk-dock [data-zone="out"]').classList.contains('rk-over'));
    ptr('pointerup', window, ox, oy);
    ok('let go there, it has no units, one undo step', !Number.isInteger(getNode('a').rackU) && getNode('a').group === 'rk' && _undoStack.length === undoAt + 1);
    undo();

    // Autoscroll: b at U2, the pane at its bottom; held at the pane's top.
    pane().scrollTop = pane().scrollHeight;
    const st0 = pane().scrollTop;
    ok('the pane scrolls (a 42U rack is taller than it)', st0 > 100, String(st0));
    [x0, y0] = mid(dev('b'));
    undoAt = _undoStack.length;
    ptr('pointerdown', dev('b'), x0, y0);
    const pr = pane().getBoundingClientRect();
    ptr('pointermove', window, x0, (y0 + pr.top) / 2);
    ptr('pointermove', window, x0, pr.top + 10);
    await wait(700);
    const st1 = pane().scrollTop;
    ok('a move held near the pane\'s top scrolls it, without moving the pointer', st1 < st0 - 100, `${st0} -> ${st1}`);
    const shown = Number(dev('b').style.getPropertyValue('--u'));
    // The box is where the pointer is on the units now: the unit under it.
    const under = rvUnitAt(slots('front'), pr.top + 10, 42);
    ok('the box follows the units that scrolled under the pointer', Math.abs(shown - under) <= 1, `box U${shown}, pointer U${under}`);
    ptr('pointerup', window, x0, pr.top + 10);
    ok('let go, it is placed that high, in one undo step', getNode('b').rackU === shown && shown > 10 && _undoStack.length === undoAt + 1, `${getNode('b').rackU}`);
    await wait(100);
    const st2 = pane().scrollTop;
    await wait(200);
    ok('let go, the pane stops scrolling', pane().scrollTop === st2);
    undo();
    ok('(undone)', getNode('b').rackU === 2);
    // A resize from the top edge, held at the top, scrolls too.
    pane().scrollTop = pane().scrollHeight;
    selectEntries([{ type: 'node', id: 'b' }]);
    renderRackView(true);
    const grip = dev('b').querySelector('.rk-grip');
    ok('the selected device has its grip', !!grip);
    if (grip) {
      const [gx, gy] = mid(grip);
      const s0 = pane().scrollTop;
      undoAt = _undoStack.length;
      ptr('pointerdown', grip, gx, gy);
      const r2 = pane().getBoundingClientRect();
      ptr('pointermove', window, gx, (gy + r2.top) / 2);
      ptr('pointermove', window, gx, r2.top + 10);
      await wait(400);
      ok('a resize held at the top scrolls the pane too', pane().scrollTop < s0, `${s0} -> ${pane().scrollTop}`);
      ptr('pointerup', window, gx, r2.top + 10);
      ok('let go, it is taller, one step', rackHeightOf(getNode('b')) > 5 && getNode('b').rackU === 2 && _undoStack.length === undoAt + 1, json(getNode('b')));
      undo();
    }
    select(null);

    // ---- 2: the place dialog keeps a device's own depth ----
    replaceDocument({ v: DOC_VERSION, nodes: [
      N('pp', 'server', { group: 'rk', rackDepth: 'half' }),
      N('srv', 'server', { x: 100, group: 'rk' }),
      N('hp', 'server', { x: 200, group: 'rk', rackU: 5, rackFace: 'rear', rackDepth: 'half' }),
      N('nas', 'server', { x: 300, group: 'rk', rackDepth: 'half' })
    ], links: [], groups: [{ id: 'rk', name: 'R', kind: 'rack', uHeight: 12 }] }, { origin: 'file', docId: 'rackreview-2' });
    openRackView('rk');
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 1, height: 1 });
    const item = (id) => [...el('rackPlaceList').querySelectorAll('.rkp-item')].find((b) => b.dataset.node === id);
    ok('on units free on both faces the box is ticked', el('rackPlaceFull').checked && /U1 front, full depth/.test(el('rackPlaceMsg').textContent));
    ok('a half-depth device\'s row says so', /half depth/.test(item('pp').textContent) && !/half depth/.test(item('srv').textContent), item('pp').textContent);
    undoAt = _undoStack.length;
    item('pp').click();
    ok('picked, the half-depth device stays half depth (it was made full)', getNode('pp').rackU === 1 && getNode('pp').rackDepth === 'half' && getNode('pp').rackFace === 'front', json(getNode('pp')));
    ok('one undo step', _undoStack.length === undoAt + 1);
    undo();
    // Behind the half-depth hp: a full-depth device goes in at half.
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 5, height: 1 });
    ok('behind a half-depth device the box unticks itself', !el('rackPlaceFull').checked);
    ok('both the half-depth and the full-depth device can be picked', !item('pp').disabled && !item('srv').disabled);
    item('srv').click();
    ok('a full-depth device goes in at half there', getNode('srv').rackU === 5 && getNode('srv').rackDepth === 'half', json(getNode('srv')));
    undo();
    // Ticked by hand: the box decides, for a device already on the map too.
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 8, height: 1 });
    el('rackPlaceFull').checked = false; el('rackPlaceFull').dispatchEvent(new Event('change', { bubbles: true }));
    el('rackPlaceFull').checked = true; el('rackPlaceFull').dispatchEvent(new Event('change', { bubbles: true }));
    ok('ticked by hand, no row says half depth', !/half depth/.test(item('nas').textContent));
    item('nas').click();
    ok('ticked by hand, the half-depth device is placed full depth', getNode('nas').rackU === 8 && !('rackDepth' in getNode('nas')), json(getNode('nas')));
    undo();
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 8, height: 1 });
    el('rackPlaceFull').checked = false; el('rackPlaceFull').dispatchEvent(new Event('change', { bubbles: true }));
    item('srv').click();
    ok('unticked by hand, a full-depth device is placed half', getNode('srv').rackU === 8 && getNode('srv').rackDepth === 'half');
    undo();
    // Create here still takes the box: a new one fills the depth.
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 9, height: 1 });
    el('rackPlaceType').value = 'switch';
    el('rackPlaceNewBtn').click();
    const made = state.nodes[state.nodes.length - 1];
    ok('a new device left ticked is full depth', made.type === 'switch' && made.rackU === 9 && !('rackDepth' in made));
    undo();
    ok('placeDepth in words: its own where it fits, half where one face is', json(placeDepth(groupById('rk'), { u: 1, height: 1, face: 'front', full: true, said: false }, getNode('pp'))) === json({ ok: true, full: undefined })
       && json(placeDepth(groupById('rk'), { u: 5, height: 1, face: 'front', full: false, said: false }, getNode('srv'))) === json({ ok: true, full: false }));

    // ---- 3: narrow, the column scrolls and the units stick ----
    const nodes3 = [];
    for (let i = 0; i < 10; i++) nodes3.push(N('x' + i, 'server', { x: i * 40, group: 'rk', rackU: i * 2 + 1 }));
    nodes3.push(N('u1', 'server', { group: 'rk' }), N('u2', 'server', { group: 'rk' }));
    for (let i = 0; i < 12; i++) nodes3.push(N('o' + i, 'pc', { x: i * 40, y: 400 }));
    replaceDocument({ v: DOC_VERSION, nodes: nodes3, links: [], groups: [{ id: 'rk', name: 'R', kind: 'rack', uHeight: 42 }] }, { origin: 'file', docId: 'rackreview-3' });
    openRackView('rk');
    _rv.othersOpen = true;
    selectEntries([{ type: 'node', id: 'x3' }]);
    renderRackView(true);
    const cs = getComputedStyle(pane());
    ok('the units stick to the column\'s top', cs.position === 'sticky' && getComputedStyle(body()).overflowY === 'auto');
    const ph = pane().getBoundingClientRect().height;
    // A third of the window or more, less where the column is too short for
    // that and a strip of rows under it (a phone turned on its side).
    const want = Math.max(80, Math.min(window.innerHeight * 0.36, body().clientHeight - 64));
    ok('with a device selected and Other devices open, the units keep about a third of the window or more', ph >= want - 2 && ph <= body().clientHeight,
      `${Math.round(ph)} of ${window.innerHeight}, column ${body().clientHeight}`);
    body().scrollTop = body().scrollHeight;
    await wait(50);
    const pb = pane().getBoundingClientRect(), bb = body().getBoundingClientRect();
    ok('scrolled to the lists, the units are still there, at the top', Math.abs(pb.top - bb.top) <= 1 && pb.height >= ph - 1,
      `${pb.top} ${bb.top} win ${window.innerWidth}x${window.innerHeight} body ${body().clientHeight}/${body().scrollHeight} st ${body().scrollTop} pane ${pb.height}`);
    const rowsInSight = [...view().querySelectorAll('.rk-others-list .rk-handle')].filter((h) => { const r = h.getBoundingClientRect(); return r.top >= pb.bottom - 1 && r.bottom <= bb.bottom + 1; }).length;
    ok('and Other devices\' rows are in sight under them', rowsInSight >= 1, String(rowsInSight));
    // A device tapped there: the column goes back up to its buttons.
    const box = dev('x1');
    box.scrollIntoView({ block: 'nearest' });
    rvSelect({ shiftKey: false, ctrlKey: false, metaKey: false }, getNode('x1'));
    await wait(0);
    const sel = view().querySelector('.rk-selbar');
    ok('a device tapped with the column scrolled: its buttons are in sight', !!sel && sel.getBoundingClientRect().top >= body().getBoundingClientRect().top - 1,
      sel && `${sel.getBoundingClientRect().top} ${body().getBoundingClientRect().top}`);
    select(null);
    _rv.othersOpen = false;

    // ---- 4: the map: into another rack, onto taken units ----
    setView('map');
    replaceDocument({ v: DOC_VERSION, nodes: [
      N('s1', 'server', { x: 0, y: 0, group: 'ra', rackU: 10 }),
      N('s3', 'server', { x: 100, y: 0, group: 'ra', rackU: 20 }),
      N('s4', 'server', { x: 0, y: 150, group: 'ra', rackU: 30 }),
      N('d', 'server', { x: 600, y: 0, group: 'rb', rackU: 10 }),
      N('d2', 'server', { x: 700, y: 0, group: 'rb', rackU: 2 })
    ], links: [], groups: [{ id: 'ra', name: 'Rack A', kind: 'rack', uHeight: 42 }, { id: 'rb', name: 'Rack B', kind: 'rack', uHeight: 24 }] }, { origin: 'file', docId: 'rackreview-4' });
    state.camera.zoom = 1; state.camera.x = 100; state.camera.y = 200; applyCamera(); renderCanvasOnly();
    const at = (x, y) => { const r = el('networkCanvas').getBoundingClientRect(); return { clientX: r.left + state.camera.x + x * state.camera.zoom, clientY: r.top + state.camera.y + y * state.camera.zoom, bubbles: true, button: 0 }; };
    const mdrag = (id, x, y) => {
      const n = getNode(id);
      el(`ui-node-${id}`).dispatchEvent(new MouseEvent('mousedown', at(n.x, n.y)));
      window.dispatchEvent(new MouseEvent('mousemove', at((n.x + x) / 2, (n.y + y) / 2)));
      window.dispatchEvent(new MouseEvent('mousemove', at(x, y)));
      window.dispatchEvent(new MouseEvent('mouseup', at(x, y)));
    };
    clearToast();
    undoAt = _undoStack.length;
    mdrag('s1', 650, 20);
    ok('dropped into Rack B, where U10 is taken, it is in Rack B', getNode('s1').group === 'rb');
    ok('with no units (no overlap made), its height and depth kept', !Number.isInteger(getNode('s1').rackU) && !('rackFace' in getNode('s1')) && rackOverlaps(groupById('rb')).length === 0, json(getNode('s1')));
    ok('and the toast says why', /S1 is in Rack B now\. Its units were taken there, or past the top, so it has none yet: Open rack places it\./.test(toast()), toast());
    ok('one undo step', _undoStack.length === undoAt + 1);
    undo();
    ok('(undone, units and all)', getNode('s1').group === 'ra' && getNode('s1').rackU === 10);
    clearToast();
    mdrag('s3', 650, 20);
    ok('where its units are free there, it keeps them', getNode('s3').group === 'rb' && getNode('s3').rackU === 20 && !/taken/.test(toast()), toast());
    undo();
    mdrag('s4', 650, 20);
    ok('past the new rack\'s top (U30 of 24), it waits under Not placed yet', getNode('s4').group === 'rb' && !Number.isInteger(getNode('s4').rackU) && placeFindings().length === 0, json(placeFindings()));
    undo();
    // A set: each checked in turn.
    clearToast();
    selectEntries([{ type: 'node', id: 's1' }, { type: 'node', id: 's3' }]);
    undoAt = _undoStack.length;
    mdrag('s1', 650, 20);
    ok('a set: the one whose units are taken waits, the other keeps its units', getNode('s1').group === 'rb' && getNode('s3').group === 'rb'
       && !Number.isInteger(getNode('s1').rackU) && getNode('s3').rackU === 20, json([getNode('s1'), getNode('s3')]));
    ok('the toast counts them', /2 devices are in Rack B now\. 1 of them had units that were taken there, or past the top/.test(toast()), toast());
    ok('one undo step for the set', _undoStack.length === undoAt + 1);
    undo();
    select(null);
    for (const [lang, word] of [['es', 'Sus unidades estaban ocupadas'], ['pt-BR', 'Suas unidades estavam ocupadas'], ['ru', 'Его юниты там заняты'], ['ja', '移動先ではそのユニット']]) {
      setLocale(lang);
      ok(`${lang}: the toast is translated`, t('Its units were taken there, or past the top, so it has none yet: Open rack places it.').startsWith(word));
    }
    setLocale('en'); applyStaticI18n();

    // ---- 5: a rack numbered from the top ----
    replaceDocument({ v: DOC_VERSION, nodes: [N('t', 'server', { group: 'rk', rackU: 42, rackHeight: 2 })], links: [],
      groups: [{ id: 'rk', name: 'R', kind: 'rack', uHeight: 42, numbering: 'top' }] }, { origin: 'file', docId: 'rackreview-5' });
    const f5 = placeFindings().map((f) => f.detail);
    ok('top-down, past the top: no "from U1, so it goes past U1"', f5.length === 1 && f5[0] === 'It is 2U tall with its bottom unit at U1, so it reaches 1U above U1, the top of R.', json(f5));
    for (const lang of ['es', 'pt-BR', 'ru', 'ja']) {
      setLocale(lang);
      const s = placeFindings()[0].detail;
      ok(`${lang}: that finding is translated`, !/bottom unit/.test(s) && /U1/.test(s), s);
    }
    setLocale('en'); applyStaticI18n();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { closePlaceDialog(); } catch (e) { /* not open */ }
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
