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
//      of their own;
//   3. the map under one or two fingers (mapTouchStart, Mobile batch 1): one
//      finger pans 1:1 past the tap margin, a tap is still the browser's (and
//      deselects), a pan never does; two pinch about their midpoint within
//      0.2 and 5, two to one carries on as a pan with no jump; a second finger
//      during a device's drag puts it back with no undo step and pinches; a
//      finger's double-tap zooms 2x and makes no note, a mouse's double-click
//      still drops one; the mouse's pan is unchanged.
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

      // ---- 3. The map under one or two fingers (mapTouchStart) ----
      const cv = el('networkCanvas');
      const R = () => cv.getBoundingClientRect();
      const T = (id, target, x, y) => new Touch({ identifier: id, target, clientX: x, clientY: y });
      // changed: the touches this event is about; touches: every finger still down.
      const fire = (type, target, changed, touches) => {
        const ev = new TouchEvent(type, { bubbles: true, cancelable: true, touches,
          targetTouches: touches.filter((x) => x.target === target), changedTouches: changed });
        target.dispatchEvent(ev);
        return ev;
      };
      const camOf = () => ({ x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom });
      const close = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);
      select(null, null); setGroupCollapsed('lab', false);
      setCamera(0, 0, 1);
      let r = R(), sx = r.left + 150, sy = r.top + 200;

      // One finger: nothing inside the tap margin, then 1:1.
      select('c', 'node');
      let c0 = camOf();
      let f = T(1, cv, sx, sy);
      fire('touchstart', cv, [f], [f]);
      f = T(1, cv, sx + 6, sy + 5); fire('touchmove', cv, [f], [f]);
      ok('one finger inside the tap margin does not pan', json(camOf()) === json(c0), json(camOf()));
      f = T(1, cv, sx + 60, sy + 120);
      let mv = fire('touchmove', cv, [f], [f]);
      ok('past it the map pans by the finger\'s whole travel', close(state.camera.x, c0.x + 60) && close(state.camera.y, c0.y + 120) && state.camera.zoom === c0.zoom, json(camOf()));
      ok('the pan\'s move is the page\'s', mv.defaultPrevented);
      f = T(1, cv, sx + 70, sy + 100); fire('touchmove', cv, [f], [f]);
      ok('and it keeps following', close(state.camera.x, c0.x + 70) && close(state.camera.y, c0.y + 100), json(camOf()));
      let up = fire('touchend', cv, [f], []);
      ok('its lift is the page\'s too (no tap, no click after a pan)', up.defaultPrevented);
      ok('a pan does not deselect', state.selectedId === 'c', state.selectedId);
      // A touch that never travels is the browser's tap, as before.
      c0 = camOf();
      f = T(2, cv, sx, sy);
      const tdown = fire('touchstart', cv, [f], [f]);
      f = T(2, cv, sx + 3, sy + 2); fire('touchmove', cv, [f], [f]);
      up = fire('touchend', cv, [f], []);
      ok('a tap on empty map moves nothing and is left to the browser', json(camOf()) === json(c0) && !tdown.defaultPrevented && !up.defaultPrevented, json(camOf()));
      // The browser's mouse events for that tap.
      cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx + 3, clientY: sy + 2, button: 0 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: sx + 3, clientY: sy + 2, button: 0 }));
      ok('and the tap still deselects', !state.selectedId, state.selectedId);
      ok('nothing is left pressed', _mapTouch === null && _touchPress === null);

      // Two fingers: the world point under their midpoint stays under it.
      setCamera(40, 30, 1);
      r = R();
      const loc = (x, y) => ({ x: x - r.left, y: y - r.top });
      let A = T(3, cv, r.left + 100, r.top + 200), B = T(4, cv, r.left + 200, r.top + 200);
      fire('touchstart', cv, [A], [A]);
      fire('touchstart', cv, [B], [A, B]);
      let under = world(150, 200);
      A = T(3, cv, r.left + 50, r.top + 260); B = T(4, cv, r.left + 250, r.top + 260);
      mv = fire('touchmove', cv, [A, B], [A, B]);
      let after = world(150, 260);
      ok('a pinch doubles the zoom for twice the spread', close(state.camera.zoom, 2), state.camera.zoom);
      ok('and the world point under the midpoint follows it', near(under, after), json([under, after]));
      ok('the pinch\'s move is the page\'s', mv.defaultPrevented);
      // Down to one finger: the pan carries on from there, no jump.
      let cBefore = camOf();
      fire('touchend', cv, [B], [A]);
      ok('lifting one finger moves nothing', json(cBefore) === json(camOf()), json([cBefore, camOf()]));
      A = T(3, cv, r.left + 80, r.top + 270);
      fire('touchmove', cv, [A], [A]);
      ok('the other one pans from where it is', close(state.camera.x, cBefore.x + 30) && close(state.camera.y, cBefore.y + 10) && state.camera.zoom === cBefore.zoom, json([cBefore, camOf()]));
      // And back up to two mid-pan: a pinch again.
      B = T(5, cv, r.left + 180, r.top + 270);
      fire('touchstart', cv, [B], [A, B]);
      under = world(130, 270);
      A = T(3, cv, r.left + 105, r.top + 270); B = T(5, cv, r.left + 155, r.top + 270);
      fire('touchmove', cv, [A, B], [A, B]);
      ok('a second finger mid-pan pinches', close(state.camera.zoom, 1) && near(under, world(130, 270)), json([camOf(), under, world(130, 270)]));
      fire('touchend', cv, [A, B], []);
      ok('every finger up ends the gesture', _mapTouch === null);
      // The first finger lifts and the second stays: the pan follows the
      // second's own travel, not the gap between the two.
      setCamera(40, 30, 1);
      A = T(3, cv, r.left + 100, r.top + 200); B = T(4, cv, r.left + 300, r.top + 200);
      fire('touchstart', cv, [A], [A]);
      fire('touchstart', cv, [B], [A, B]);
      A = T(3, cv, r.left + 90, r.top + 210); B = T(4, cv, r.left + 310, r.top + 210);
      fire('touchmove', cv, [A, B], [A, B]);
      cBefore = camOf();
      fire('touchend', cv, [A], [B]);
      ok('lifting the first finger moves nothing', json(cBefore) === json(camOf()), json([cBefore, camOf()]));
      B = T(4, cv, r.left + 330, r.top + 205);
      fire('touchmove', cv, [B], [B]);
      ok('the second one pans by its own travel only', close(state.camera.x, cBefore.x + 20) && close(state.camera.y, cBefore.y - 5) && state.camera.zoom === cBefore.zoom, json([cBefore, camOf()]));
      fire('touchend', cv, [B], []);
      ok('(that gesture ended)', _mapTouch === null);

      // A pinch reads the canvas's corner once, at the touchdown, not on
      // every move (each read after applyCamera forced a style pass).
      setCamera(0, 0, 1);
      A = T(3, cv, r.left + 100, r.top + 200); B = T(4, cv, r.left + 200, r.top + 200);
      fire('touchstart', cv, [A, B], [A, B]);
      let rectReads = 0;
      const realRect = cv.getBoundingClientRect;
      cv.getBoundingClientRect = function () { rectReads++; return realRect.call(this); };
      try {
        for (let i = 1; i <= 3; i++) {
          A = T(3, cv, r.left + 100 - 10 * i, r.top + 200); B = T(4, cv, r.left + 200 + 10 * i, r.top + 200);
          fire('touchmove', cv, [A, B], [A, B]);
        }
      } finally { delete cv.getBoundingClientRect; }
      ok('a pinch\'s moves do not read the canvas\'s rect', rectReads === 0, String(rectReads));
      ok('(and still zoom)', close(state.camera.zoom, 160 / 100), state.camera.zoom);
      fire('touchend', cv, [A, B], []);

      // A finger on a cable pans (its moves are heard on the cable and again
      // on the canvas as they bubble, and handled once).
      setCamera(0, 0, 1); select(null, null); renderCanvasOnly();
      const lineEl = el('layer-links') && el('layer-links').querySelector('path, line');
      ok('a cable to put a finger on', !!lineEl);
      if (lineEl) {
        let L = T(11, lineEl, r.left + 50, r.top + 50);
        fire('touchstart', lineEl, [L], [L]);
        L = T(11, lineEl, r.left + 80, r.top + 90); fire('touchmove', lineEl, [L], [L]);
        L = T(11, lineEl, r.left + 100, r.top + 100); fire('touchmove', lineEl, [L], [L]);
        fire('touchend', lineEl, [L], []);
        ok('a finger on a cable pans the map by its travel', close(state.camera.x, 50) && close(state.camera.y, 50), json(camOf()));
      }

      // Two fingers on what sits on the map (the zoom buttons) pinch the map.
      const zc = document.querySelector('#canvasContainer > .zoom-ctl');
      ok('the zoom buttons take no pan or pinch of the browser\'s', zc && getComputedStyle(zc).touchAction === 'none', zc && getComputedStyle(zc).touchAction);
      if (zc) {
        setCamera(0, 0, 1);
        const zb = zc.getBoundingClientRect();
        A = T(12, zc, zb.left + 5, zb.top + 10); B = T(13, zc, zb.left + 15, zb.top + 10);
        fire('touchstart', zc, [A, B], [A, B]);
        A = T(12, zc, zb.left - 5, zb.top + 10); B = T(13, zc, zb.left + 25, zb.top + 10);
        const zm = fire('touchmove', zc, [A, B], [A, B]);
        fire('touchend', zc, [A, B], []);
        ok('a pinch on the zoom buttons zooms the map', close(state.camera.zoom, 3) && zm.defaultPrevented, json(camOf()));
      }

      // Safari's GestureEvent (a Mac trackpad's pinch): zooms the map about
      // the pointer, as Ctrl-wheel does elsewhere, and never the page.
      const gesture = (type, scale, x, y) => {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        ev.scale = scale; ev.clientX = x; ev.clientY = y;
        cv.dispatchEvent(ev);
        return ev;
      };
      setCamera(0, 0, 1);
      under = world(200, 150);
      const gs = gesture('gesturestart', 1, r.left + 200, r.top + 150);
      gesture('gesturechange', 1.5, r.left + 200, r.top + 150);
      const gc = gesture('gesturechange', 2, r.left + 200, r.top + 150);
      gesture('gestureend', 2, r.left + 200, r.top + 150);
      ok('a Safari pinch zooms the map from where it started', close(state.camera.zoom, 2) && near(under, world(200, 150)), json([camOf(), under, world(200, 150)]));
      ok('and is never the page\'s', gs.defaultPrevented && gc.defaultPrevented);
      setCamera(0, 0, 1);
      A = T(14, cv, r.left + 100, r.top + 200); B = T(15, cv, r.left + 200, r.top + 200);
      fire('touchstart', cv, [A, B], [A, B]);
      gesture('gesturestart', 1, r.left + 150, r.top + 200);
      gesture('gesturechange', 3, r.left + 150, r.top + 200);
      fire('touchend', cv, [A, B], []);
      ok('under fingers the touch pinch is the one that zooms', state.camera.zoom === 1, json(camOf()));

      // The limits: 5 and 0.2, as the wheel and the buttons.
      const pinch = (z, k) => {
        setCamera(0, 0, z);
        let a = T(6, cv, r.left + 150, r.top + 200), b = T(7, cv, r.left + 160, r.top + 200);
        fire('touchstart', cv, [a, b], [a, b]);
        a = T(6, cv, r.left + 155 - 5 * k, r.top + 200); b = T(7, cv, r.left + 155 + 5 * k, r.top + 200);
        fire('touchmove', cv, [a, b], [a, b]);
        fire('touchend', cv, [a, b], []);
        return state.camera.zoom;
      };
      ok('a pinch out stops at 5', pinch(4, 8) === 5, state.camera.zoom);
      ok('a pinch in stops at 0.2', pinch(0.25, 1 / 8) === 0.2, state.camera.zoom);
      // The maths alone.
      const pc = pinchCamera({ x: 10, y: 20, zoom: 1 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 0 }, { x: 150, y: 0 }, { min: 0.2, max: 5 });
      ok('pinchCamera: twice the spread about a fixed midpoint', close(pc.zoom, 2) && close((50 - pc.x) / pc.zoom, (50 - 10) / 1) && close((0 - pc.y) / pc.zoom, (0 - 20) / 1), json(pc));
      const pp = panCamera({ x: 1, y: 2, zoom: 3 }, 10, -5);
      ok('panCamera moves by the delta and keeps the zoom', json(pp) === json({ x: 11, y: -3, zoom: 3 }), json(pp));
      const pz = pinchCamera({ x: 0, y: 0, zoom: 0.15 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 101, y: 0 }, { min: 0.2, max: 5 });
      ok('a camera outside the limits is not jumped back in', pz.zoom > 0.15 && pz.zoom < 0.2, json(pz));

      // A second finger during a device's drag: the drag is abandoned.
      setCamera(0, 0, 1); select(null, null); renderCanvasOnly();
      const cEl = el('ui-node-c').querySelector('rect') || el('ui-node-c');
      const cp = middle(cEl), c00 = pos('c');
      undoAt = _undoStack.length;
      const timeline = json(_undoStack.length) + json(_redoStack.length);
      let F1 = T(8, cEl, cp.x, cp.y);
      fire('touchstart', cEl, [F1], [F1]);
      F1 = T(8, cEl, cp.x + 70, cp.y + 40); fire('touchmove', cEl, [F1], [F1]);
      ok('one finger on a device drags it', json(pos('c')) !== json(c00), json([c00, pos('c')]));
      let F2 = T(9, cv, cp.x + 110, cp.y + 40);
      c0 = camOf();
      fire('touchstart', cv, [F2], [F1, F2]);
      ok('a second finger puts it back', json(pos('c')) === json(c00), json([c00, pos('c')]));
      ok('and drops the drag', !isDraggingNode && !dragGroup.length && _touchPress === null);
      const nodeEl = el('ui-node-c');
      ok('the card is drawn back where it was', nodeEl && nodeEl.getAttribute('transform') === `translate(${c00[0]}, ${c00[1]})`, nodeEl && nodeEl.getAttribute('transform'));
      F1 = T(8, cEl, cp.x + 30, cp.y + 40); F2 = T(9, cv, cp.x + 150, cp.y + 40);
      fire('touchmove', cEl, [F1], [F1, F2]);
      fire('touchmove', cv, [F2], [F1, F2]);
      ok('then the fingers pinch the map', state.camera.zoom > c0.zoom && json(pos('c')) === json(c00), json([camOf(), pos('c')]));
      fire('touchend', cEl, [F1], [F2]);
      fire('touchend', cv, [F2], []);
      await tick();
      ok('nothing is saved: the undo timeline is as it was', json(_undoStack.length) + json(_redoStack.length) === timeline && json(pos('c')) === json(c00), json([_undoStack.length - undoAt, pos('c')]));
      ok('and no drop cue is left', !el('layer-groups').querySelector('.grp-drop-cue, .pair-drop-cue, .host-drop-cue'));

      // A device that goes away under the finger before it travels: the
      // press is let go without a drag, and the finger pans the map instead.
      setCamera(0, 0, 1); select(null, null); renderCanvasOnly();
      const gEl = el('ui-node-c').querySelector('rect') || el('ui-node-c');
      const gp = middle(gEl);
      const keepNodes = state.nodes;
      let G = T(10, gEl, gp.x, gp.y);
      fire('touchstart', gEl, [G], [G]);
      state.nodes = keepNodes.filter((n) => n.id !== 'c');
      try {
        G = T(10, gEl, gp.x + 40, gp.y + 30); fire('touchmove', gEl, [G], [G]);
        G = T(10, gEl, gp.x + 50, gp.y + 30); fire('touchmove', gEl, [G], [G]);
      } finally { state.nodes = keepNodes; }
      ok('a press let go without a drag hands the finger to the map', _touchPress === null && close(state.camera.x, 50) && close(state.camera.y, 30), json(camOf()));
      fire('touchend', gEl, [G], []);
      ok('(nothing left pressed)', _mapTouch === null && _touchPress === null && !isDraggingNode);
      renderCanvasOnly();

      // A finger's double-tap zooms; a mouse's double-click drops a note.
      setCamera(0, 0, 1); select(null, null);
      r = R();
      const annsAt = state.annotations.length;
      const caps = typeof InputDeviceCapabilities === 'function' ? new InputDeviceCapabilities({ firesTouchEvents: true }) : null;
      ok('this engine can mark a double-click as a finger\'s', !!caps);
      if (caps) {
        under = world(200, 150);
        cv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top + 150, sourceCapabilities: caps }));
        ok('a double-tap zooms in 2x about where it tapped', close(state.camera.zoom, 2) && near(under, world(200, 150)), json([camOf(), under, world(200, 150)]));
        ok('and makes no note', state.annotations.length === annsAt && !el('annEditor'), state.annotations.length);
      }
      setCamera(0, 0, 1);
      undoAt = _undoStack.length;
      cv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top + 150 }));
      ok('a mouse double-click still drops a note, editor open', state.annotations.length === annsAt + 1 && !!el('annEditor') && state.camera.zoom === 1, state.annotations.length);
      const ed = el('annEditor');
      const dropped = state.annotations[state.annotations.length - 1];
      ok('on a mouse\'s screen the note editor is the card\'s own size, unscaled', !!ed && !!dropped && ed.style.transform === '' && Math.abs(parseFloat(getComputedStyle(ed).fontSize) - (dropped.size || 12) * state.camera.zoom) < 0.01, ed && json([ed.style.transform, getComputedStyle(ed).fontSize]));
      if (ed) ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      while (_undoStack.length > undoAt) undo();
      ok('(the note undone)', state.annotations.length === annsAt, state.annotations.length);

      // The mouse's pan is the mouse's.
      setCamera(10, 10, 1); select(null, null);
      cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.left + 150, clientY: r.top + 200, button: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 180, clientY: r.top + 220 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 180, clientY: r.top + 220, button: 0 }));
      ok('a mouse drag on empty map still pans by its travel', close(state.camera.x, 40) && close(state.camera.y, 30) && state.camera.zoom === 1, json(camOf()));

      // The page never pans, zooms or reloads from the map.
      ok('the map takes no pan or pinch of the browser\'s', getComputedStyle(cv).touchAction === 'none', getComputedStyle(cv).touchAction);
      ok('the page has no pull-to-refresh', getComputedStyle(document.documentElement).overscrollBehaviorY === 'none', getComputedStyle(document.documentElement).overscrollBehaviorY);
      ok('but keeps a touchpad\'s swipe back and forward', getComputedStyle(document.documentElement).overscrollBehaviorX === 'auto' && getComputedStyle(document.body).overscrollBehaviorX === 'auto', getComputedStyle(document.documentElement).overscrollBehaviorX);
      const rail = document.querySelector('.topo-rail');
      ok('the panels keep their own touch-action', rail && getComputedStyle(rail).touchAction === 'auto', rail && getComputedStyle(rail).touchAction);
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
