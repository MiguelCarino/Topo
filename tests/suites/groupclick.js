// Groups, round 2 item 1 (Review-Packs/Topo-groups.md, "Round 2"): a click
// or tap on a collapsed group's node expands it (js/groupmap.js pressFold,
// the window's mousemove and mouseup in js/app.js). What is held here:
//   1. a tap (main button only: a right press is a rack's Open rack, and
//      leaves the group collapsed) is a tap while the pointer stays within
//      a few pixels: nothing moves, the group expands, no undo step, the
//      selection is as it was;
//   2. past that margin it is a drag: the devices move by whole grid steps
//      from where the pointer crossed nothing, one undo step, and the group
//      stays collapsed; a press from a touch gets a wider margin than a
//      mouse's;
//   3. the devices are still one gesture from selected: Shift on the node
//      (it stays collapsed), the Groups tab's Select members, an expanded
//      frame's tab; a whole selection holding the group's devices drags as
//      a set;
//   4. the second click of a habitual double-click lands where the node was
//      and drops no text note there;
//   5. an expanded frame keeps a visible ▾ to fold it again; link mode does
//      not expand; a read-only document expands on a tap and moves nothing;
//      the tooltips speak Spanish.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? false : null));

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = (v = DOC_VERSION) => ({ v,
    nodes: [
      N('a', 'switch', { x: 0, y: 0, group: 'lab', portCount: 4, interfaces: [] }),
      N('b', 'pc', { x: 200, y: 0, group: 'lab' }),
      N('c', 'pc', { x: 600, y: 300 })
    ],
    links: [{ id: 'l1', source: 'a', target: 'b', sourceIface: 'p1', targetIface: 'i1' },
            { id: 'l2', source: 'a', target: 'c', sourceIface: 'p2', targetIface: 'i1' }],
    groups: [{ id: 'lab', name: 'Lab', kind: 'room' }] });
  const open = (docId, v) => { replaceDocument(site(v), { origin: 'file', docId }); renderCanvasOnly(); };
  const block = (id) => el(`ui-group-${id}`);
  const frame = (id) => el('layer-groups').querySelector(`.grp-frame[data-grp="${id}"]`);
  const nodeEl = (id) => el(`ui-node-${id}`);
  const pos = () => json(state.nodes.map((n) => [n.id, n.x, n.y]));
  // Workspace point -> the client point a real pointer would be at.
  const at = (x, y, extra) => {
    const rect = el('networkCanvas').getBoundingClientRect();
    return Object.assign({ clientX: rect.left + state.camera.x + x * state.camera.zoom, clientY: rect.top + state.camera.y + y * state.camera.zoom, bubbles: true }, extra || {});
  };
  // Screen pixels from a workspace point.
  const off = (x, y, dx, dy, extra) => { const p = at(x, y, extra); p.clientX += dx; p.clientY += dy; return p; };
  const down = (target, init) => target.dispatchEvent(new MouseEvent('mousedown', init));
  const move = (init) => window.dispatchEvent(new MouseEvent('mousemove', init));
  const up = (init) => window.dispatchEvent(new MouseEvent('mouseup', init));

  try {
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    open('doc-click');
    state.camera.zoom = 1; applyCamera();
    const start = pos();

    // ---- 1: a tap ----
    setGroupCollapsed('lab', true);
    ok('collapsed, its node is at its devices\' centre', block('lab').getAttribute('transform') === 'translate(100, 0)');
    select('c', 'node');
    let undoAt = _undoStack.length;
    down(block('lab'), at(100, 0));
    move(off(100, 0, 3, -2));
    ok('a wobble within the margin moves nothing', pos() === start, pos());
    ok('and has not expanded it before the release', isGroupCollapsed('lab'));
    up(off(100, 0, 3, -2));
    ok('the release expands it', !isGroupCollapsed('lab') && !block('lab') && !!nodeEl('a') && !!nodeEl('b'));
    ok('every device is where it was', pos() === start, pos());
    ok('no undo step: collapsing is a view', _undoStack.length === undoAt);
    ok('the selection is as it was (a click no longer selects)', json(selectedOf('node')) === json(['c']));
    ok('nothing is left pressed', !isDraggingNode && dragGroup.length === 0);

    // ---- 1b: only the main button taps ----
    // A right press is a collapsed rack's Open rack shortcut (its
    // contextmenu); it must not also expand the group behind the view it
    // opens. A middle press is the browser's. Neither selects nor moves.
    setGroupCollapsed('lab', true);
    [[2, 'right'], [1, 'middle']].forEach(([button, name]) => {
      undoAt = _undoStack.length;
      down(block('lab'), at(100, 0, { button }));
      move(off(100, 0, 1, 1, { button }));
      up(at(100, 0, { button }));
      ok(`a ${name} press and release leaves it collapsed`, isGroupCollapsed('lab') && !!block('lab'));
      ok(`a ${name} press moves nothing, selects nothing, takes no undo step`,
        pos() === start && json(selectedOf('node')) === json(['c']) && _undoStack.length === undoAt && !isDraggingNode);
    });
    down(block('lab'), at(100, 0));
    up(at(100, 0));
    ok('a main-button tap after them still expands it', !isGroupCollapsed('lab'));

    // ---- 4: a habitual double-click ----
    const notes = state.annotations.length;
    el('networkCanvas').dispatchEvent(new MouseEvent('dblclick', at(100, 0)));
    ok('the second click of a double-click drops no text note where the node was', state.annotations.length === notes && groupTapJustExpanded());

    // ---- 2: a drag ----
    setGroupCollapsed('lab', true);
    select(null, null);
    undoAt = _undoStack.length;
    down(block('lab'), at(100, 0));
    move(off(100, 0, 3, 0));
    ok('within the margin it holds still', pos() === start);
    move(at(140, 40));
    ok('past it, it is a drag: the devices move by the same step', getNode('a').x === 40 && getNode('a').y === 40 && getNode('b').x === 240 && getNode('c').x === 600,
       pos());
    move(off(140, 40, 1, 0));
    ok('and once a drag, small moves keep moving it (no margin again)', getNode('a').x === 40);
    up(at(140, 40));
    ok('the release leaves it collapsed', isGroupCollapsed('lab') && !!block('lab'));
    ok('its node followed', block('lab').getAttribute('transform') === 'translate(140, 40)', block('lab').getAttribute('transform'));
    ok('one undo step', _undoStack.length === undoAt + 1);
    ok('a plain drag selects nothing', selectedOf('node').length === 0);
    undo();
    ok('undone, the devices are back and it is still collapsed', pos() === start && isGroupCollapsed('lab'));

    // A press from a finger: the mouse events Chromium makes from a tap say
    // so, and a finger gets more room than a mouse.
    let caps = null;
    try { caps = new InputDeviceCapabilities({ firesTouchEvents: true }); } catch (e) { /* not this engine */ }
    if (caps) {
      down(block('lab'), at(100, 0, { sourceCapabilities: caps }));
      move(off(100, 0, 7, 5, { sourceCapabilities: caps }));
      ok('a touch wobble past a mouse\'s margin is still a tap', pos() === start);
      up(off(100, 0, 7, 5, { sourceCapabilities: caps }));
      ok('and expands it', !isGroupCollapsed('lab'));
      setGroupCollapsed('lab', true);
    }
    down(block('lab'), at(100, 0));
    move(off(100, 0, 7, 5));
    up(off(100, 0, 7, 5));
    ok('the same wobble from a mouse is a drag, not a tap', GM_COARSE ? !isGroupCollapsed('lab') : isGroupCollapsed('lab'));
    if (!isGroupCollapsed('lab')) setGroupCollapsed('lab', true);
    if (pos() !== start) undo();
    ok('(undone)', pos() === start);

    // ---- 3: selecting the devices ----
    select(null, null);
    down(block('lab'), at(100, 0, { shiftKey: true }));
    up(at(100, 0));
    ok('Shift-click selects its devices', json(selectedOf('node').sort()) === json(['a', 'b']));
    ok('and leaves it collapsed', isGroupCollapsed('lab') && !!block('lab'));
    toggleSelected('node', 'c');
    ok('with another device added, all three are selected', selectedOf('node').length === 3);
    undoAt = _undoStack.length;
    down(block('lab'), at(100, 0));
    move(at(100, 60));
    up(at(100, 60));
    ok('a drag of the node moves the whole selection holding it', getNode('a').y === 60 && getNode('b').y === 60 && getNode('c').y === 360, pos());
    ok('in one undo step, still selected', _undoStack.length === undoAt + 1 && selectedOf('node').length === 3);
    undo();
    ok('(undone)', pos() === start);
    down(block('lab'), at(100, 0, { ctrlKey: true }));
    up(at(100, 0));
    ok('Ctrl-click takes its devices out again', json(selectedOf('node')) === json(['c']) && isGroupCollapsed('lab'));

    select(null, null);
    showConfigTab('groups'); renderGroupsPanel(true);
    el('groupList').querySelector('[data-act="members"][data-grp="lab"]').click();
    ok('the Groups tab\'s Select members still selects them (the way in on a phone)', json(selectedOf('node').sort()) === json(['a', 'b']));
    ok('and leaves it collapsed', isGroupCollapsed('lab'));

    // ---- 5: the expanded frame, link mode, read-only, language ----
    setGroupCollapsed('lab', false);
    select(null, null);
    const fold = frame('lab').querySelector('.grp-toggle');
    ok('an expanded frame keeps its ▾ to fold it again', !!fold && fold.querySelector('title').textContent === 'Collapse');
    const box = fold.getBoundingClientRect();
    ok('and the ▾ is drawn, a target a finger can hit', box.width >= 18 && box.height >= 18, json([box.width, box.height]));
    ok('its tab says a click selects the devices', /Click to select its devices\./.test(frame('lab').querySelector('.grp-tab > title').textContent));
    frame('lab').querySelector('.grp-tab').dispatchEvent(new MouseEvent('mousedown', at(14, -60)));
    up(at(14, -60));
    ok('and a click on the tab does', json(selectedOf('node').sort()) === json(['a', 'b']) && !isGroupCollapsed('lab'));
    fold.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('the ▾ folds it', isGroupCollapsed('lab') && !!block('lab'));

    state.linkSourceId = 'c';
    down(block('lab'), at(100, 0));
    up(at(100, 0));
    ok('in link mode a click on the node does not expand it', isGroupCollapsed('lab'));
    state.linkSourceId = null;

    open('doc-click-ro', DOC_VERSION + 1);
    setGroupCollapsed('lab', true);
    ok('a read-only document opens, and folds', !!state.readOnly && isGroupCollapsed('lab') && !!block('lab'));
    down(block('lab'), at(100, 0));
    move(at(160, 80));
    up(at(160, 80));
    ok('a drag there moves nothing', pos() === start, pos());
    ok('and a release that far from the press is not a tap', isGroupCollapsed('lab'));
    down(block('lab'), at(100, 0));
    up(at(100, 0));
    ok('a tap there expands it: a view, not an edit', !isGroupCollapsed('lab') && pos() === start);

    open('doc-click');
    setGroupCollapsed('lab', true);
    setLocale('es'); applyStaticI18n(); renderCanvasOnly();
    ok('es: the node\'s tooltip', /Haz clic para expandir\. Mayús\+clic selecciona sus dispositivos\./.test(block('lab').querySelector(':scope > title').textContent));
    setGroupCollapsed('lab', false);
    ok('es: the tab\'s', /Haz clic para seleccionar sus dispositivos\./.test(frame('lab').querySelector('.grp-tab > title').textContent));
    setLocale('en'); applyStaticI18n(); renderCanvasOnly();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
