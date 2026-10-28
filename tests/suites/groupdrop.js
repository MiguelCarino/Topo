// Groups, round 2 item 2 (Review-Packs/Topo-groups.md, "Round 2"): drop in
// and drop out on the map (js/groupmap.js "Drop in, drop out"; the device's
// press in js/ui.js, the window's mousemove and mouseup in js/app.js). The
// gestures are the real handlers', pressed on the device's own element and
// moved and released on the window, as a mouse does. What is held here:
//   1. a device let go inside another group's frame goes into it; while it
//      is dragged that frame is lit and a label at the pointer names it; the
//      move and the membership are one undo step;
//   2. a drag that ends inside its own frame only moves it, with no label;
//      the frames hold still while a device is dragged; let go outside every
//      frame, it is in no group (the frame it leaves fades);
//   3. the innermost frame under the pointer wins: a room's device dropped
//      on a rack's frame goes into the rack, with no units yet (said); a
//      rack's device dropped beside the rack, in the room, leaves its units;
//      one dropped in another rack keeps them (rackKeysLost); the last
//      device of a group can leave it;
//   4. a device let go on a collapsed group's node goes into that group,
//      which stays collapsed, the node lit while it is over it;
//   5. a selection goes in together; a whole-site drag (Ctrl+A), whose
//      groups all travel as cargo, changes no group;
//   6. a click moves nothing and files nothing; a frame's tab drag and a
//      read-only document file nothing; the words are translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? false : null));

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  // A building with a server room and a rack in it, an office, a second
  // rack on its own, and two devices in no group.
  const site = (v = DOC_VERSION) => ({ v,
    nodes: [
      N('s1', 'server', { x: 0, y: 0, group: 'rk', rackU: 10 }),
      N('s2', 'server', { x: 100, y: 0, group: 'rk', rackU: 12, rackHeight: 2 }),
      N('p1', 'pc', { x: 0, y: 300, group: 'srv' }),
      N('pc1', 'pc', { x: 600, y: 0, group: 'off' }),
      N('pc2', 'pc', { x: 700, y: 0, group: 'off' }),
      N('l1', 'pc', { x: 600, y: 500 }),
      N('l2', 'pc', { x: 800, y: 500 }),
      N('r2', 'server', { x: 1200, y: 0, group: 'rk2', rackU: 5 })
    ],
    links: [],
    groups: [
      { id: 'bld', name: 'Building A', kind: 'building' },
      { id: 'srv', name: 'Server room', kind: 'room', parent: 'bld' },
      { id: 'rk', name: 'Rack 3', kind: 'rack', parent: 'srv', uHeight: 42 },
      { id: 'off', name: 'Office', kind: 'room' },
      { id: 'rk2', name: 'Rack 4', kind: 'rack', uHeight: 24 }
    ] });
  const open = (docId = 'doc-drop', v) => { replaceDocument(site(v), { origin: 'file', docId }); state.camera.zoom = 1; state.camera.x = 300; state.camera.y = 300; applyCamera(); renderCanvasOnly(); };
  const frame = (id) => el('layer-groups').querySelector(`.grp-frame[data-grp="${id}"]`);
  const nodeEl = (id) => el(`ui-node-${id}`);
  const fold = (id) => el(`ui-group-${id}`);
  const cue = () => document.querySelector('#layer-nodes > .grp-drop-cue');
  const groupsOf = () => json(state.nodes.map((n) => [n.id, n.group || null]));
  const toast = () => el('topoToast').textContent;
  const clearToast = () => { el('topoToast').textContent = ''; };
  const at = (x, y, extra) => {
    const rect = el('networkCanvas').getBoundingClientRect();
    return Object.assign({ clientX: rect.left + state.camera.x + x * state.camera.zoom, clientY: rect.top + state.camera.y + y * state.camera.zoom, bubbles: true, button: 0 }, extra || {});
  };
  // Press on the device's element, move the pointer in two steps, and (unless
  // told to hold) let go there: the way a hand does it.
  const press = (id, extra) => { const n = getNode(id); nodeEl(id).dispatchEvent(new MouseEvent('mousedown', at(n.x, n.y, extra))); };
  const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', at(x, y)));
  const up = (x, y) => window.dispatchEvent(new MouseEvent('mouseup', x === undefined ? { bubbles: true } : at(x, y)));
  const drag = (id, x, y, hold) => {
    const n = getNode(id);
    press(id);
    move((n.x + x) / 2, (n.y + y) / 2);
    move(x, y);
    if (!hold) up(x, y);
  };

  try {
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    open();
    const start = groupsOf();

    // ---- 1: into another group's frame ----
    let undoAt = _undoStack.length;
    drag('l1', 650, 30, true);
    ok('dragged over the Office frame, it is lit', frame('off').classList.contains('grp-drop'));
    ok('and a label at the pointer says where it goes', !!cue() && cue().textContent === 'Into Office', cue() && cue().textContent);
    ok('no other frame is lit', document.querySelectorAll('#layer-groups .grp-drop').length === 1);
    ok('nothing is filed before the release', !getNode('l1').group);
    up(650, 30);
    ok('let go there, it is in the Office', getNode('l1').group === 'off');
    ok('and where it was let go', getNode('l1').x !== 600 && getNode('l1').y !== 500);
    ok('the label and the light are gone', !cue() && !el('layer-groups').querySelector('.grp-drop'));
    ok('a toast says so', /L1 is in Office now\./.test(toast()), toast());
    ok('the move and the membership are one undo step', _undoStack.length === undoAt + 1);
    undo();
    ok('undone, both go back at once', !getNode('l1').group && getNode('l1').x === 600 && getNode('l1').y === 500);

    // ---- 2: inside its own frame; held frames; out of every frame ----
    clearToast();
    undoAt = _undoStack.length;
    drag('pc1', 620, 40, true);
    ok('dragged inside its own frame, nothing is lit', !el('layer-groups').querySelector('.grp-drop') && !cue());
    up(620, 40);
    ok('let go there, it only moved', getNode('pc1').group === 'off' && getNode('pc1').y === 40 && !toast());
    ok('one undo step for the move', _undoStack.length === undoAt + 1);
    undo();

    const offBox = frame('off').querySelector('rect').getAttribute('x');
    drag('pc1', 900, 300, true);
    ok('while dragged the frames hold still, so it can leave its own', frame('off').querySelector('rect').getAttribute('x') === offBox);
    ok('outside every frame the label says no group', cue() && cue().textContent === 'Into no group');
    ok('and the frame it would leave fades', frame('off').classList.contains('grp-drop-out'));
    up(900, 300);
    ok('let go there, it is in no group', !getNode('pc1').group);
    ok('and the frame is drawn round what it holds now', frame('off').querySelector('rect').getAttribute('x') !== offBox);
    undo();
    ok('(undone)', getNode('pc1').group === 'off' && getNode('pc1').x === 600);

    // ---- 3: the innermost frame; racks ----
    clearToast();
    drag('l1', 30, 200);
    ok('in the server room\'s frame but not the rack\'s, it goes into the room', getNode('l1').group === 'srv');
    undo();
    drag('l1', 50, 0);
    ok('over the rack\'s frame, inside the room\'s and the building\'s, the rack wins', getNode('l1').group === 'rk');
    ok('in the rack with no units yet, as the toast says', !Number.isInteger(getNode('l1').rackU) && /no units in the rack yet: Open rack places it/.test(toast()), toast());
    undo();
    drag('s1', 0, 250);
    ok('a rack\'s device dropped in the room beside the rack goes into the room', getNode('s1').group === 'srv');
    ok('and leaves its units behind', !hasRackFields(getNode('s1')));
    undo();
    ok('(undone, units and all)', getNode('s1').group === 'rk' && getNode('s1').rackU === 10);
    drag('s2', 1200, 20);
    ok('dropped in another rack\'s frame, it moves there', getNode('s2').group === 'rk2');
    ok('keeping its units, as Move to group does (rackKeysLost)', getNode('s2').rackU === 12 && getNode('s2').rackHeight === 2);
    undo();
    drag('r2', 1500, 500);
    ok('the last device of a group can leave it', !getNode('r2').group && !hasRackFields(getNode('r2')));
    undo();
    ok('(undone)', groupsOf() === start, groupsOf());

    // ---- 4: onto a collapsed group's node ----
    setGroupCollapsed('off', true);
    const centre = fold('off').getAttribute('transform');
    undoAt = _undoStack.length;
    drag('l2', 650, 0, true);
    ok('over a collapsed node, the node is lit', fold('off').classList.contains('grp-drop') && !!fold('off').querySelector('.grp-drop-ring'));
    ok('and the label names its group', cue() && cue().textContent === 'Into Office');
    up(650, 0);
    ok('let go on it, it joins the group', getNode('l2').group === 'off');
    ok('which stays collapsed, the device folded in', isGroupCollapsed('off') && !nodeEl('l2') && /3 devices/.test(fold('off').textContent));
    ok('one undo step', _undoStack.length === undoAt + 1);
    ok('dropped on its middle, the node stays where it was', fold('off').getAttribute('transform') === centre, fold('off').getAttribute('transform'));
    undo();
    ok('undone, it is out and drawn again', !getNode('l2').group && !!nodeEl('l2') && isGroupCollapsed('off'));
    setGroupCollapsed('off', false);

    // ---- 5: a selection; a whole-site drag ----
    selectEntries([{ type: 'node', id: 'l1' }, { type: 'node', id: 'l2' }]);
    undoAt = _undoStack.length;
    drag('l1', 650, 30);
    ok('a selection let go in a frame goes in together', getNode('l1').group === 'off' && getNode('l2').group === 'off');
    ok('one undo step for all of it', _undoStack.length === undoAt + 1);
    ok('a toast counts them', /2 devices are in Office now\./.test(toast()), toast());
    undo();
    ok('(undone)', groupsOf() === start);

    selectAll();
    undoAt = _undoStack.length;
    drag('s1', 2000, 2000);
    ok('a whole-site drag far off moves everything', getNode('pc1').x === 2600 && getNode('r2').x === 3200, json([getNode('pc1').x, getNode('r2').x]));
    ok('and files nothing: every group travelled with it', groupsOf() === start, groupsOf());
    ok('one undo step', _undoStack.length === undoAt + 1);
    undo();
    // Every device of the office with one loose one: the office travels, the
    // loose one is let go in a frame and goes in.
    selectEntries([{ type: 'node', id: 'pc1' }, { type: 'node', id: 'pc2' }, { type: 'node', id: 'l1' }]);
    drag('l1', 0, 280);
    ok('a whole group in a selection keeps its group; the rest go where they were let go',
      getNode('pc1').group === 'off' && getNode('pc2').group === 'off' && getNode('l1').group === 'srv', groupsOf());
    undo();
    select(null, null);

    // ---- 6: a click; a tab's drag; read-only; language ----
    undoAt = _undoStack.length;
    press('l1');
    up(600, 500);
    ok('a click files nothing and takes no undo step', !getNode('l1').group && _undoStack.length === undoAt);
    const tab = frame('off').querySelector('.grp-tab');
    tab.dispatchEvent(new MouseEvent('mousedown', at(556, -84)));
    move(300, 200); move(0, 250);
    ok('a frame\'s tab dragged lights no target', !cue() && !el('layer-groups').querySelector('.grp-drop'));
    up(0, 250);
    ok('and files nothing: it moves the group', getNode('pc1').group === 'off' && getNode('pc1').x !== 600);
    undo();
    select(null, null);

    open('doc-drop-ro', DOC_VERSION + 1);
    ok('a read-only document opens', !!state.readOnly);
    drag('l1', 650, 30);
    ok('a drag there moves nothing and files nothing', !getNode('l1').group && getNode('l1').x === 600);

    open();
    setLocale('es'); applyStaticI18n(); renderCanvasOnly();
    clearToast();
    drag('l1', 650, 30, true);
    ok('es: the label', cue() && cue().textContent === 'A Office', cue() && cue().textContent);
    up(650, 30);
    ok('es: the toast', /L1 está ahora en Office\./.test(toast()), toast());
    undo();
    drag('pc1', 900, 300, true);
    ok('es: out of every group', cue() && cue().textContent === 'A ningún grupo');
    up(900, 300);
    undo();
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
