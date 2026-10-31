// What a click, a keystroke and an undo cost (the map-rail speed work:
// js/app.js save/mapPointerUp/applyDoc/replaceDocument, js/ui.js
// startDrag/renderCanvasOnly/select and the typing coalescer). Counted by
// wrapping the classic-script globals the app calls through: drawCanvas,
// save, serializeDoc and updateOsDatalist. The suites' window.TOPO_CHECKS
// asserts serialize, so they are off inside each count. What is held here:
//   1. a click on a device, a text note or a group frame's tab draws once and
//      saves nothing: no undo step, the history entry byte-identical, an
//      off-grid device left where it is; a jitter of a pixel is still a
//      click; a real drag snaps, saves once, files one step, draws once more;
//   2. typing, then a click on another device: one undo step, the typing's;
//   3. a pan with nothing selected draws nothing, and moves the camera;
//   4. undo and redo draw once and serialize nothing; the entry is the
//      snapshot, and a no-op save after files nothing;
//   5. replaceDocument serializes once, with the timeline, the entry and the
//      read-only reading what they were; a 'live' reload of the same
//      document keeps the timeline;
//   6. a no-op save leaves the OS list alone, an edit of an OS rebuilds it;
//   7. typing with the coalescer forced on: one draw at the first keystroke,
//      one at the flush, the label as typed, one undo step at focusout;
//   8. a selection builds the diagnosis key once;
//   9. save() and saveTyping() inside a lookup pass throw (TOPO_CHECKS), and
//      the pass is put back;
//  10. the drawing's diagnosis is handed on only while nothing has saved,
//      and an unsaved edit is filed by flushPendingSaves.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const held = { coalesce: window.TOPO_COALESCE, checks: window.TOPO_CHECKS };

  // The spies: installed once, read through count().
  const SPIED = ['drawCanvas', 'save', 'serializeDoc', 'updateOsDatalist'];
  const calls = {};
  const real = {};
  SPIED.forEach((k) => {
    real[k] = window[k];
    calls[k] = 0;
    window[k] = function () { calls[k]++; return real[k].apply(this, arguments); };
  });
  const count = (fn) => {
    SPIED.forEach((k) => { calls[k] = 0; });
    const checks = window.TOPO_CHECKS;
    window.TOPO_CHECKS = false;
    try { fn(); } finally { window.TOPO_CHECKS = checks; }
    return Object.assign({}, calls);
  };
  const said = (c) => SPIED.map((k) => `${k} ${c[k]}`).join(', ');
  // How many times the diagnosis's memo key is built (as in perf.js).
  const keyBuilds = (fn) => {
    const realStr = JSON.stringify;
    let n = 0;
    JSON.stringify = function (v) { if (v === state.nodes) n++; return realStr.apply(this, arguments); };
    try { fn(); } finally { JSON.stringify = realStr; }
    return n;
  };

  const canvas = el('networkCanvas');
  const at = (x, y) => { const r = canvas.getBoundingClientRect(); return { clientX: r.left + state.camera.x + x * state.camera.zoom, clientY: r.top + state.camera.y + y * state.camera.zoom }; };
  const shift = (p, dx, dy) => ({ clientX: p.clientX + dx, clientY: p.clientY + dy });
  const centre = (node) => { const b = node.getBoundingClientRect(); return { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }; };
  const mouse = (target, type, pt) => target.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, pt)));
  const entry = () => json(history.state);
  const typeInto = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };

  const D = (id, x, y, ip, extra) => Object.assign({ id, type: 'pc', name: id.toUpperCase(), x, y, interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra || {});
  const lab = (v = DOC_VERSION) => ({ v, nodes: [
      { id: 'sw', type: 'switch', name: 'SW', x: 300, y: 100, portCount: 8, interfaces: [] },
      D('a', 13, 27, '10.0.0.11/24'),
      D('b', 500, 300, '10.0.0.12/24', { group: 'lab' }),
      D('c', 600, 300, '10.0.0.13/24', { group: 'lab' })
    ], links: [
      { id: 'la', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'lb', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'lc', source: 'sw', target: 'c', sourceIface: 'p3', targetIface: 'i1' }
    ], groups: [{ id: 'lab', name: 'Lab', kind: 'room' }],
    annotations: [{ id: 'note', x: 213, y: 307, text: 'Rack 2', targets: [] }] });
  const open = () => {
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    replaceDocument(lab(), { origin: 'file' });
    state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera();
    setGroupCollapsed('lab', false);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    flushLiveDoc();
  };
  const nodeA = () => getNode('a');

  try {
    open();

    // ---- 1: a click is a click ----
    select(null, null); flushLiveDoc();
    let steps = _undoStack.length, was = entry(), present = _present;
    let c = count(() => { mouse(el('ui-node-a'), 'mousedown', at(13, 27)); mouse(window, 'mouseup', at(13, 27)); });
    ok('a click on a device draws once and saves nothing', c.drawCanvas === 1 && c.save === 0 && c.serializeDoc === 0, said(c));
    ok('and selects it', state.selectedId === 'a' && state.selectedType === 'node');
    ok('no undo step, the timeline as it was', _undoStack.length === steps && _present === present);
    ok('the history entry byte-identical', entry() === was);
    ok('the off-grid device stays where it is', nodeA().x === 13 && nodeA().y === 27, json([nodeA().x, nodeA().y]));

    select(null, null); flushLiveDoc();
    steps = _undoStack.length; was = entry();
    c = count(() => {
      const p = at(13, 27);
      mouse(el('ui-node-a'), 'mousedown', p);
      mouse(window, 'mousemove', shift(p, 1, 0));
      mouse(window, 'mouseup', shift(p, 1, 0));
    });
    ok('a pixel of jitter is still a click: nothing snaps', nodeA().x === 13 && nodeA().y === 27, json([nodeA().x, nodeA().y]));
    ok('and nothing is saved', c.save === 0 && _undoStack.length === steps && entry() === was, said(c));

    select(null, null);
    steps = _undoStack.length;
    const p0 = at(13, 27);
    c = count(() => { mouse(el('ui-node-a'), 'mousedown', p0); mouse(window, 'mousemove', shift(p0, 30, 0)); });
    const pressDraws = c.drawCanvas;
    c = count(() => mouse(window, 'mouseup', shift(p0, 30, 0)));
    ok('a real drag snaps to the grid', nodeA().x % GRID_SNAP === 0 && nodeA().y % GRID_SNAP === 0 && nodeA().x !== 13, json([nodeA().x, nodeA().y]));
    ok('saves once and files one step', c.save === 1 && _undoStack.length === steps + 1, `${said(c)}; steps ${_undoStack.length - steps}`);
    ok('and draws once more on release', pressDraws === 1 && c.drawCanvas === 1, `${pressDraws} then ${c.drawCanvas}`);

    // A text note, off the grid too.
    select(null, null); flushLiveDoc();
    steps = _undoStack.length; was = entry(); present = _present;
    c = count(() => { mouse(el('ui-ann-note'), 'mousedown', at(213, 307)); mouse(window, 'mouseup', at(213, 307)); });
    const note = state.annotations.find((a) => a.id === 'note');
    ok('a click on a text note draws once and saves nothing', c.drawCanvas === 1 && c.save === 0 && c.serializeDoc === 0, said(c));
    ok('it is selected and has not moved', state.selectedId === 'note' && note.x === 213 && note.y === 307, json([state.selectedId, note.x, note.y]));
    ok('no step, the entry as it was', _undoStack.length === steps && _present === present && entry() === was);

    // A group frame's tab, from another selection (pressing it while its
    // devices are already the selection selects nothing new, and draws nothing).
    select('a', 'node'); flushLiveDoc();
    steps = _undoStack.length; was = entry(); present = _present;
    const tab = el('layer-groups').querySelector('.grp-frame[data-grp="lab"] .grp-tab');
    ok('the expanded group has a tab to press', !!tab);
    const tp = tab ? centre(tab) : { clientX: 0, clientY: 0 };
    const before = json(state.nodes.map((n) => [n.id, n.x, n.y]));
    c = count(() => { if (tab) mouse(tab, 'mousedown', tp); mouse(window, 'mouseup', tp); });
    ok('a click on a frame\'s tab selects its devices', json(selectedOf('node').sort()) === json(['b', 'c']), json(selectedOf('node')));
    ok('draws at most once and saves nothing', c.drawCanvas <= 1 && c.save === 0 && c.serializeDoc === 0, said(c));
    ok('no step, nothing moved, the entry as it was', _undoStack.length === steps && _present === present && entry() === was
      && json(state.nodes.map((n) => [n.id, n.x, n.y])) === before);

    // ---- 2: typing, then a click ----
    select('a', 'node');
    steps = _undoStack.length;
    typeInto(el('propName'), 'Typed');
    ok('the keystroke is not a step yet', _undoStack.length === steps && nodeA().name === 'Typed');
    mouse(el('ui-node-sw'), 'mousedown', at(300, 100)); mouse(window, 'mouseup', at(300, 100));
    ok('a click after typing files exactly one step, the typing', _undoStack.length === steps + 1 && _typingJson === null,
      String(_undoStack.length - steps));
    ok('and the step holds the name', JSON.parse(_present).nodes.find((n) => n.id === 'a').name === 'Typed');
    ok('the click selected the other device', state.selectedId === 'sw');

    // ---- 3: a pan over an unselected map ----
    select(null, null);
    const cam = state.camera.x;
    const cp = at(800, 600);
    c = count(() => {
      mouse(canvas, 'mousedown', cp);
      mouse(window, 'mousemove', shift(cp, 20, 0));
      mouse(window, 'mouseup', shift(cp, 20, 0));
    });
    ok('a pan with nothing selected draws nothing', c.drawCanvas === 0 && c.save === 0, said(c));
    ok('and moves the camera', state.camera.x === cam + 20, `${cam} -> ${state.camera.x}`);
    select('a', 'node');
    mouse(canvas, 'mousedown', cp); mouse(window, 'mouseup', cp);
    ok('a press on the canvas still clears a selection', state.selection.size === 0);

    // ---- 4: undo and redo ----
    open();
    select('a', 'node');
    ['one', 'two', 'three'].forEach((name) => { nodeA().name = name; save(); });
    steps = _undoStack.length;
    c = count(() => undo());
    flushLiveDoc();
    ok('undo draws once and serializes nothing', c.drawCanvas === 1 && c.serializeDoc === 0, said(c));
    ok('it took the step back', nodeA().name === 'two' && _undoStack.length === steps - 1);
    ok('the entry is the snapshot', history.state && history.state[LIVE_STATE_KEY] === _present);
    c = count(() => redo());
    flushLiveDoc();
    ok('redo draws once and serializes nothing', c.drawCanvas === 1 && c.serializeDoc === 0, said(c));
    ok('it put the step back', nodeA().name === 'three' && history.state[LIVE_STATE_KEY] === _present);
    steps = _undoStack.length;
    const redos = _redoStack.length;
    save();
    ok('a no-op save after files no step', _undoStack.length === steps && _redoStack.length === redos);
    let threw = null;
    try { undo(); redo(); } catch (e) { threw = e; }
    ok('a snapshot reloads as itself (TOPO_CHECKS)', !threw, threw && threw.message);

    // ---- 5: replaceDocument ----
    c = count(() => replaceDocument(lab(), { origin: 'file' }));
    flushLiveDoc();
    const now = JSON.stringify(serializeDoc());
    ok('opening a document serializes it once', c.serializeDoc === 1, said(c));
    ok('the timeline floor is the document', _present === now && _undoStack.length === 0 && _redoStack.length === 0);
    ok('so is the entry', history.state[LIVE_STATE_KEY] === now);
    ok('and it is not read-only', state.readOnly === null);
    nodeA().name = 'edited'; save();
    steps = _undoStack.length;
    replaceDocument(JSON.parse(_present), { origin: 'live' });
    ok('a live reload of the same document keeps the timeline', _undoStack.length === steps && steps > 0);
    const newer = lab(DOC_VERSION + 1);
    replaceDocument(newer, { origin: 'file' });
    flushLiveDoc();
    const ro = JSON.stringify(serializeDoc());
    ok('a newer document is read-only, read as this build reads it', !!state.readOnly && state.readOnly.loaded === ro && _present === ro);
    ok('and its entry is the document as it arrived', history.state[LIVE_STATE_KEY] === JSON.stringify(state.readOnly.doc)
      && JSON.parse(history.state[LIVE_STATE_KEY]).v === DOC_VERSION + 1);

    // ---- 6: the OS list ----
    open();
    c = count(() => save());
    ok('a no-op save leaves the OS list alone', c.updateOsDatalist === 0 && c.serializeDoc === 1, said(c));
    nodeA().os = 'Debian 13';
    c = count(() => save());
    ok('an edit of an OS rebuilds it', c.updateOsDatalist === 1, said(c));
    ok('with the new OS in it', [...el('osDatalist').options].some((o) => o.value === 'Debian 13'));

    // ---- 7: typing through the coalescer ----
    open();
    select('a', 'node');
    steps = _undoStack.length;
    window.TOPO_COALESCE = true;
    const word = 'abcdefghij';
    let pre = null;
    c = count(() => {
      for (let i = 1; i <= word.length; i++) typeInto(el('propName'), word.slice(0, i));
      pre = calls.drawCanvas;
      flushTypedRender();
    });
    ok('ten keystrokes in one task draw at most once before the flush', pre <= 1, String(pre));
    ok('and the flush draws once', c.drawCanvas - pre === 1, `${pre} then ${c.drawCanvas}`);
    ok('every keystroke is in the model', nodeA().name === word);
    ok('the map shows what was typed', el('ui-node-a').textContent.includes(word), el('ui-node-a').textContent);
    el('propName').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    flushLiveDoc();
    ok('leaving the field files one step', _undoStack.length === steps + 1 && _typingJson === null, String(_undoStack.length - steps));
    ok('and the entry holds all ten characters', JSON.parse(history.state[LIVE_STATE_KEY]).nodes.find((n) => n.id === 'a').name === word);
    cancelTypedRender();
    window.TOPO_COALESCE = held.coalesce;

    // ---- 8: a selection builds the diagnosis key once ----
    open();
    select('sw', 'node');
    const keys = keyBuilds(() => select('a', 'node'));
    ok('a selection on the map builds the diagnosis key once', keys === 1, String(keys));
    ok('and the panel diagnoses the device selected', !el('nodeDiagnosticsPanel').classList.contains('hidden'));

    // ---- 9: no write inside a lookup pass ----
    window.TOPO_CHECKS = true;
    const quiet = console.error; console.error = () => {};
    try {
      let t1 = null, t2 = null;
      try { withLookupPass(() => save()); } catch (e) { t1 = e; }
      ok('save() inside a lookup pass throws under TOPO_CHECKS', !!t1 && /inside a lookup pass/.test(t1.message), t1 && t1.message);
      ok('and the pass is put back', lookupPass === null);
      try { withLookupPass(() => saveTyping()); } catch (e) { t2 = e; }
      ok('so does saveTyping()', !!t2 && /inside a lookup pass/.test(t2.message), t2 && t2.message);
      ok('and the pass is put back after it too', lookupPass === null && _typingJson === null);
    } finally { console.error = quiet; window.TOPO_CHECKS = held.checks; }

    // ---- 10: the drawing's diagnosis, and the unload's safety net ----
    const live = renderCanvasOnly();
    ok('a render hands on its diagnosis', typeof live === 'function' && !!drawnDiag(live));
    save();
    ok('but not once anything has saved since', drawnDiag(live) === null);
    let inBatch;
    batch(() => { inBatch = renderCanvasOnly(); });
    ok('and none from inside a batch', inBatch === null);
    open();
    steps = _undoStack.length;
    nodeA().name = 'never saved';
    flushPendingSaves();
    ok('an edit that never saved is filed when the page goes away', JSON.parse(_present).nodes.find((n) => n.id === 'a').name === 'never saved'
      && _undoStack.length === steps + 1);
    steps = _undoStack.length;
    flushPendingSaves();
    ok('and nothing is filed when nothing changed', _undoStack.length === steps);
    // A move still under the finger, or waiting on the pair question, is one
    // step later: hidden now, the entry takes it and the undo stack does not.
    const present2 = _present;
    isDraggingNode = true; nodeA().x += 40;
    flushPendingSaves();
    ok('a drag hidden mid-gesture files no step', _undoStack.length === steps && _present === present2);
    ok('but the entry holds the move', JSON.parse(history.state[LIVE_STATE_KEY]).nodes.find((n) => n.id === 'a').x === nodeA().x);
    isDraggingNode = false;
    _gmPairAsked = true;
    flushPendingSaves();
    ok('nor a move waiting on the pair question', _undoStack.length === steps && _present === present2);
    _gmPairAsked = false;
    save();
    ok('which is one step when it is filed', _undoStack.length === steps + 1);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    SPIED.forEach((k) => { window[k] = real[k]; });
    window.TOPO_COALESCE = held.coalesce; window.TOPO_CHECKS = held.checks;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
