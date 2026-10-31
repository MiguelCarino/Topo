// The map's gestures (js/app.js zoomCameraAt and touchPress, js/groupmap.js
// pressFold and pressGroup, js/ui.js pressAnnotation, css/app.css). What is
// held here:
//   1. the zoom buttons (and the + key, which clicks them) zoom about the
//      middle of the view, so the point there stays put; at the limits they
//      change nothing; the wheel still zooms about the pointer, with Ctrl too
//      (a trackpad's pinch);
//   2. a finger drags a collapsed group, a frame's tab and a note as it does a
//      device: nothing within the tap margin, then the mouse's drag, on the
//      grid, one undo step; a touch that never travels does nothing; not in
//      link mode nor in a read-only document; the three take no pan or pinch
//      of their own.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const heldResponder = setDialogResponder(() => null);
  const savedCamera = Object.assign({}, state.camera);
  const savedView = state.settings.view;

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const doc = () => ({ v: DOC_VERSION,
    nodes: [N('a', 'switch', { x: 0, y: 0, group: 'lab', portCount: 4, interfaces: [] }),
      N('b', 'pc', { x: 200, y: 0, group: 'lab' }),
      N('c', 'pc', { x: 600, y: 300 })],
    links: [{ id: 'l1', source: 'a', target: 'b', sourceIface: 'p1', targetIface: 'i1' }],
    groups: [{ id: 'lab', name: 'Lab', kind: 'room' }],
    annotations: [{ id: 'note', x: 400, y: 400, text: 'Rack 2', targets: [] }] });
  const setCamera = (x, y, zoom) => { state.camera.x = x; state.camera.y = y; state.camera.zoom = zoom; applyCamera(); };
  // The workspace point under a point of #networkCanvas.
  const world = (sx, sy) => ({ x: (sx - state.camera.x) / state.camera.zoom, y: (sy - state.camera.y) / state.camera.zoom });
  const near = (p, q) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  const centre = () => { const r = el('networkCanvas').getBoundingClientRect(); return world(r.width / 2, r.height / 2); };
  const cam = () => json([state.camera.x, state.camera.y, state.camera.zoom]);

  try {
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    replaceDocument(doc(), { origin: 'file', docId: 'map-gestures' });
    setView('map');
    renderCanvasOnly();

    // ---- 1. Zoom ----
    setCamera(100, 50, 1);
    let mid = centre();
    el('zoomInBtn').click();
    ok('zoom in keeps the point at the middle of the view', near(centre(), mid) && Math.abs(state.camera.zoom - 1.2) < 1e-9, json([mid, centre(), state.camera.zoom]));
    el('zoomOutBtn').click();
    ok('zoom out comes back to 1 about the same middle', near(centre(), mid) && Math.abs(state.camera.zoom - 1) < 1e-9, json([mid, centre(), state.camera.zoom]));
    setCamera(100, 50, 1);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }));
    ok('the + key keeps the middle too', near(centre(), mid) && state.camera.zoom > 1, json([mid, centre(), state.camera.zoom]));
    setCamera(100, 50, 5);
    let was = cam();
    el('zoomInBtn').click();
    ok('at 5 zoom in changes nothing', cam() === was, cam());
    setCamera(100, 50, 0.2);
    was = cam();
    el('zoomOutBtn').click();
    ok('at 0.2 zoom out changes nothing', cam() === was, cam());
    const wheelAt = (extra) => {
      setCamera(100, 50, 1);
      const r = el('networkCanvas').getBoundingClientRect();
      const under = world(200, 120);
      el('networkCanvas').dispatchEvent(new WheelEvent('wheel', Object.assign({ clientX: r.left + 200, clientY: r.top + 120, deltaY: -100, bubbles: true, cancelable: true }, extra || {})));
      return { under, after: world(200, 120), zoom: state.camera.zoom };
    };
    let w = wheelAt();
    ok('the wheel keeps the point under the pointer', near(w.under, w.after) && w.zoom > 1, json(w));
    w = wheelAt({ ctrlKey: true });
    ok('so does a pinch (the wheel with Ctrl)', near(w.under, w.after) && w.zoom > 1, json(w));
    setCamera(0, 0, 1);

    // ---- 2. A finger ----
    const hasTouch = typeof Touch === 'function' && typeof TouchEvent === 'function';
    ok('this engine can make touch events', hasTouch);
    if (hasTouch) {
      // A touch point in client pixels; the moves and the lift go to the
      // element the finger came down on, as a real touch's do.
      const finger = (type, target, x, y) => {
        const tp = new Touch({ identifier: 9, target, clientX: x, clientY: y });
        const ev = new TouchEvent(type, { bubbles: true, cancelable: true,
          touches: type === 'touchend' ? [] : [tp], targetTouches: type === 'touchend' ? [] : [tp], changedTouches: [tp] });
        target.dispatchEvent(ev);
        return ev;
      };
      const middle = (target) => { const r = target.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      // Down, a wobble inside the tap margin, then out to (dx, dy) and up.
      const drag = async (target, dx, dy) => {
        const p = middle(target);
        finger('touchstart', target, p.x, p.y);
        finger('touchmove', target, p.x + 2, p.y + 1);
        const still = posAll();
        const started = finger('touchmove', target, p.x + dx, p.y + dy);
        finger('touchend', target, p.x + dx, p.y + dy);
        await tick(); await tick();
        return { still, prevented: started.defaultPrevented };
      };
      const pos = (id) => { const n = getNode(id); return [n.x, n.y]; };
      const posAll = () => json(state.nodes.map((n) => [n.id, n.x, n.y]).concat(state.annotations.map((a) => [a.id, a.x, a.y])));
      const fold = () => el('ui-group-lab');
      const tab = () => el('layer-groups').querySelector('.grp-frame[data-grp="lab"] .grp-tab');
      const note = () => el('ui-ann-note');

      // A collapsed group.
      setGroupCollapsed('lab', true);
      let start = posAll(), a0 = pos('a'), b0 = pos('b');
      let undoAt = _undoStack.length;
      let seen = await drag(fold().querySelector('rect'), 60, 40);
      const da = [pos('a')[0] - a0[0], pos('a')[1] - a0[1]], db = [pos('b')[0] - b0[0], pos('b')[1] - b0[1]];
      ok('a collapsed group: inside the tap margin nothing moves', seen.still === start, seen.still);
      ok('past it the devices move together, on the grid', json(da) === json(db) && (da[0] || da[1]) && da.every((d) => d % GRID_SNAP === 0), json([da, db]));
      ok('one undo step, still collapsed', _undoStack.length === undoAt + 1 && isGroupCollapsed('lab'), _undoStack.length - undoAt);
      ok('the move that starts the drag is the page\'s', seen.prevented);
      undo();
      // A touch that never travels: the browser's tap, nothing of ours.
      start = posAll(); undoAt = _undoStack.length;
      let target = fold().querySelector('rect'), p = middle(target);
      finger('touchstart', target, p.x, p.y);
      finger('touchend', target, p.x, p.y);
      await tick();
      ok('a touch with no move does nothing', posAll() === start && _undoStack.length === undoAt && isGroupCollapsed('lab') && !isDraggingNode);

      // A frame's tab.
      setGroupCollapsed('lab', false);
      select('c', 'node');
      a0 = pos('a'); b0 = pos('b'); undoAt = _undoStack.length;
      seen = await drag(tab().querySelector('rect') || tab(), 60, 40);
      ok('a frame\'s tab: the devices move together, one undo step', json([pos('a')[0] - a0[0], pos('a')[1] - a0[1]]) === json([pos('b')[0] - b0[0], pos('b')[1] - b0[1]])
        && pos('a')[0] !== a0[0] && _undoStack.length === undoAt + 1, json([a0, pos('a'), b0, pos('b')]));
      ok('and they are the selection', json(selectedOf('node').sort()) === json(['a', 'b']), json(selectedOf('node')));
      undo();

      // A note.
      select(null, null);
      const n0 = [getAnnotation('note').x, getAnnotation('note').y];
      undoAt = _undoStack.length;
      target = note().querySelector('rect') || note(); p = middle(target);
      finger('touchstart', target, p.x, p.y);
      finger('touchmove', target, p.x + 3, p.y + 2);
      finger('touchend', target, p.x + 3, p.y + 2);
      await tick();
      ok('a note: a small move does nothing', json([getAnnotation('note').x, getAnnotation('note').y]) === json(n0) && _undoStack.length === undoAt);
      seen = await drag(note().querySelector('rect') || note(), 60, 40);
      const nn = [getAnnotation('note').x, getAnnotation('note').y];
      ok('a large move takes it, on the grid, one undo step', json(nn) !== json(n0) && nn.every((v) => v % GRID_SNAP === 0) && _undoStack.length === undoAt + 1, json([n0, nn]));
      ok('and selects it', state.selectedType === 'annotation' && state.selectedId === 'note', json([state.selectedType, state.selectedId]));
      undo();
      select(null, null);

      // Link mode and a read-only document: no drag.
      setGroupCollapsed('lab', true);
      start = posAll(); undoAt = _undoStack.length;
      state.linkSourceId = 'c';
      await drag(fold().querySelector('rect'), 60, 40);
      await drag(note().querySelector('rect') || note(), 60, 40);
      ok('in link mode nothing moves', posAll() === start && _undoStack.length === undoAt, posAll());
      state.linkSourceId = null; renderCanvasOnly();
      state.readOnly = true;
      await drag(fold().querySelector('rect'), 60, 40);
      await drag(note().querySelector('rect') || note(), 60, 40);
      ok('in a read-only document nothing moves', posAll() === start && _undoStack.length === undoAt, posAll());
      state.readOnly = false;

      // No pan or pinch of their own.
      const fNone = getComputedStyle(fold()).touchAction;
      setGroupCollapsed('lab', false);
      const tNone = getComputedStyle(tab()).touchAction, nNone = getComputedStyle(note()).touchAction;
      ok('the fold, the tab and the note take no pan or pinch', fNone === 'none' && tNone === 'none' && nNone === 'none', [fNone, tNone, nNone].join());
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    state.linkSourceId = null; state.readOnly = false;
    setDialogResponder(heldResponder);
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    Object.assign(state.camera, savedCamera); applyCamera();
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
