// The selection set (plan 3.1, Review-Packs/Topo-proposal.md). state.selection
// holds { type, id } entries; selectedId / selectedType are derived from it and
// name the one thing selected, or nothing when several are. What is held here:
//   1. the derived getters, and the setters older code and tests still use;
//   2. the ways in, through the real handlers: shift/ctrl-click on a device or
//      a cable, the shift-drag box, Ctrl+A, a network's Select members;
//   3. the rail: one thing shows its editor, several show counts and Delete,
//      a mixed set adds "Select only devices / cables";
//   4. a set dragged moves as one and is one save, one undo step; a press on
//      one of a set that moves nothing narrows the selection to it;
//   5. Delete takes the set and every cable on its devices in one undo step;
//   6. coherence: undo and redo drop the ids that are gone and keep the rest,
//      bound to the snapshot's objects; replaceDocument() drops everything.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const shown = (id) => !el(id).classList.contains('hidden');
  const canvas = el('networkCanvas');
  // Client coordinates of a workspace point (getWorkspacePoint, inverted).
  const at = (x, y) => { const r = canvas.getBoundingClientRect(); return { clientX: r.left + state.camera.x + x * state.camera.zoom, clientY: r.top + state.camera.y + y * state.camera.zoom }; };
  const mouse = (target, type, pt, extra = {}) => target.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, pt, extra)));
  const press = (id, extra) => { const n = getNode(id); mouse(el(`ui-node-${id}`), 'mousedown', at(n.x, n.y), extra); };
  const release = (pt = { clientX: 0, clientY: 0 }) => mouse(window, 'mouseup', pt);
  const key = (k, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
  const ids = (type) => selectedOf(type).slice().sort().join(',');

  const D = (id, x, y, ip) => ({ id, type: 'pc', name: id.toUpperCase(), x, y, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const lab = () => ({ v: DOC_VERSION, nodes: [
      { id: 'sw', type: 'switch', name: 'SW', x: 300, y: 100, portCount: 8, interfaces: [] },
      D('a', 100, 300, '10.0.0.11/24'), D('b', 200, 300, '10.0.0.12/24'), D('c', 300, 300, '10.0.0.13/24'), D('far', 900, 900, '10.0.0.14/24')
    ], links: [
      { id: 'la', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'lb', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'lc', source: 'sw', target: 'c', sourceIface: 'p3', targetIface: 'i1' }
    ], annotations: [{ id: 'note', x: 600, y: 100, text: 'Rack 2', targets: ['a'] }] });
  const open = () => {
    replaceDocument(lab(), { origin: 'file' });
    state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };

  try {
    open();

    // ---- 1: derived getters ----
    ok('nothing selected: no id, no type', state.selection.size === 0 && state.selectedId === null && state.selectedType === null);
    select('a', 'node');
    ok('one selected: the getters name it', state.selection.size === 1 && state.selectedId === 'a' && state.selectedType === 'node');
    ok('and it keeps its own delete ✕', !!el('ui-node-a').querySelector('.node-delete'));
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }, { type: 'node', id: 'a' }]);
    ok('several: the getters name nothing, and nothing is in twice', state.selection.size === 2 && state.selectedId === null && state.selectedType === null);
    state.selectedId = 'c'; state.selectedType = 'node';
    ok('assigning an id still selects that one thing', state.selection.size === 1 && state.selectedId === 'c' && state.selectedType === 'node');
    state.selectedId = null;
    ok('and assigning null clears', state.selection.size === 0);
    selectEntries([{ type: 'annotation', id: 'note' }, { type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    ok('a note cannot share a set', ids('annotation') === '' && ids('node') === 'a,b');

    // ---- 2: shift/ctrl-click, through the real handlers ----
    select(null, null);
    press('a'); release();
    press('b', { shiftKey: true }); release();
    ok('shift-click adds a device', ids('node') === 'a,b', ids('node'));
    press('c', { ctrlKey: true }); release();
    ok('so does ctrl-click', ids('node') === 'a,b,c', ids('node'));
    press('b', { shiftKey: true }); release();
    ok('shift-click on a selected one takes it out', ids('node') === 'a,c', ids('node'));
    ok('a modified press arms no drag', isDraggingNode === false && dragGroup.length === 0);
    mouse(el('ui-link-lb'), 'mousedown', at(250, 200), { shiftKey: true }); release();
    ok('shift-click on a cable adds the cable', ids('link') === 'lb' && ids('node') === 'a,c');
    ok('no member of a set carries its own delete ✕ (it would delete them all)', !el('ui-node-a').querySelector('.node-delete') && !document.querySelector('#layer-links .node-delete'));
    ok('the canvas marks every one of them', el('ui-node-a').querySelector('rect').getAttribute('stroke') === '#eab308'
       && el('ui-node-c').querySelector('rect').getAttribute('stroke') === '#eab308' && el('ui-link-lb').getAttribute('stroke') === '#eab308');

    // ---- 3: the rail ----
    ok('a set shows counts, not an editor', shown('multiSelectionPane') && !shown('propertiesPane') && !shown('noSelectionPane'));
    ok('counted by kind', /Devices\s*2/.test(el('selCounts').textContent) && /Cables\s*1/.test(el('selCounts').textContent), el('selCounts').textContent);
    ok('a mixed set offers to make it one kind', shown('selOnlyRow'));
    el('selOnlyNodesBtn').click();
    ok('"Select only devices" drops the cables', ids('node') === 'a,c' && ids('link') === '');
    ok('and a set of one kind does not offer it', !shown('selOnlyRow'));
    selectEntries([{ type: 'node', id: 'a' }, { type: 'link', id: 'la' }]);
    el('selOnlyLinksBtn').click();
    ok('"Select only cables" drops the devices, and one left is edited as one', ids('node') === '' && state.selectedId === 'la' && state.selectedType === 'link'
       && shown('propertiesPane') && !shown('multiSelectionPane'));
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    ok('the Diagnostics tab shows no one device\'s verdicts', shown('diagNoSelection') && el('nodeDiagnosticsBody').innerHTML === '');
    key('Escape');
    ok('Esc clears the set', state.selection.size === 0 && shown('noSelectionPane') && !shown('multiSelectionPane'));

    // ---- 2 (cont.): Ctrl+A ----
    key('a', { ctrlKey: true });
    ok('Ctrl+A selects every device and cable', ids('node') === 'a,b,c,far,sw' && ids('link') === 'la,lb,lc', `${ids('node')} | ${ids('link')}`);
    ok('Cmd+A as well', (select(null, null), key('a', { metaKey: true }), state.selection.size === 8));
    select(null, null);
    el('queryInput').focus();
    key('a', { ctrlKey: true });
    ok('Ctrl+A in a field is the field\'s', state.selection.size === 0);
    el('queryInput').blur();
    // A Topo overlay covering the map (here the site report) leaves Ctrl+A to
    // the browser — select the dialog's text, not the hidden map — and Del with
    // it, so Ctrl+A then Del cannot wipe a map nobody can see.
    openReportDialog(); document.activeElement.blur();
    const caOverlay = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(caOverlay);
    ok('Ctrl+A behind the report dialog selects nothing on the map', state.selection.size === 0);
    ok('and is left to the browser (not prevented)', !caOverlay.defaultPrevented);
    select('a', 'node'); key('Delete');
    ok('Del behind the report dialog deletes nothing', !!getNode('a') && state.selectedId === 'a');
    closeReportDialog(); select(null, null);
    toggleShortcutHelp(true); key('a', { ctrlKey: true });
    ok('nor behind the shortcut list', state.selection.size === 0);
    toggleShortcutHelp(false);
    key('a', { ctrlKey: true });
    ok('with the overlay closed, Ctrl+A is select-all again', state.selection.size === 8);
    select(null, null);
    const findingsWere = findingsTabShown();
    key('a');
    ok('a plain A is still the findings key, not select-all', state.selection.size === 0 && findingsTabShown() !== findingsWere);
    key('a');
    ok('the cheatsheet lists it', [...document.querySelectorAll('#shortcutBody .sc-row')].some((r) => /Ctrl\s*A/.test(r.querySelector('.sc-keys').textContent)));
    ok('and the mouse hints say how to add one and draw a box', /Shift-click/.test(el('shortcutBody').textContent) && /Shift-drag/.test(el('shortcutBody').textContent));

    // ---- 2 (cont.): the shift-drag box ----
    select('far', 'node');
    mouse(canvas, 'mousedown', at(50, 250), { shiftKey: true });
    ok('shift-drag on the empty canvas draws a box, and does not pan or deselect', !!el('selectionBox') && isDraggingCanvas === false && state.selectedId === 'far');
    mouse(window, 'mousemove', at(250, 350));
    const box = el('selectionBox');
    ok('the box follows the pointer', +box.getAttribute('width') === 200 && +box.getAttribute('height') === 100, `${box.getAttribute('width')}x${box.getAttribute('height')}`);
    release(at(250, 350));
    ok('every device inside joins the selection', ids('node') === 'a,b,far', ids('node'));
    ok('devices only: the cables under it are not taken', ids('link') === '');
    ok('and the box is gone', !el('selectionBox'));
    mouse(canvas, 'mousedown', at(700, 700), { shiftKey: true }); mouse(window, 'mousemove', at(701, 701)); release(at(701, 701));
    ok('a box too small to mean anything keeps the selection', ids('node') === 'a,b,far');
    mouse(canvas, 'mousedown', at(700, 700), { ctrlKey: true }); release(at(700, 700));
    ok('a Ctrl-press on the empty canvas keeps it too, as Shift does', ids('node') === 'a,b,far');
    mouse(canvas, 'mousedown', at(700, 700), { metaKey: true }); release(at(700, 700));
    ok('and a Cmd-press', ids('node') === 'a,b,far');
    mouse(canvas, 'mousedown', at(700, 700)); release(at(700, 700));
    ok('a plain press on the empty canvas still clears it', state.selection.size === 0);

    // ---- 4: dragging a set ----
    open();
    initHistory();
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    let saves = 0;
    const realSave = save;
    window.save = function () { saves++; return realSave.apply(this, arguments); };
    press('a');
    ok('a press on one of a set keeps the set', ids('node') === 'a,b');
    mouse(window, 'mousemove', at(140, 300)); mouse(window, 'mousemove', at(160, 340));
    ok('the whole set moves, keeping its shape', getNode('a').x === 160 && getNode('a').y === 340 && getNode('b').x === 260 && getNode('b').y === 340,
       `a ${getNode('a').x},${getNode('a').y} b ${getNode('b').x},${getNode('b').y}`);
    ok('the others stay', getNode('c').x === 300 && getNode('c').y === 300);
    ok('their cables follow while dragging', el('ui-link-lb').getAttribute('d').includes('260'));
    release(at(160, 340));
    window.save = realSave;
    ok('saved once, on release', saves === 1, `${saves} saves`);
    ok('and still selected as a set', ids('node') === 'a,b');
    undo();
    ok('one undo puts the whole set back', getNode('a').x === 100 && getNode('a').y === 300 && getNode('b').x === 200 && getNode('b').y === 300);
    ok('and the selection survives the undo', ids('node') === 'a,b' && shown('multiSelectionPane'));
    press('b'); release(at(getNode('b').x, getNode('b').y));
    ok('a press on one of a set that moved nothing selects it alone', state.selectedId === 'b' && state.selection.size === 1 && shown('propertiesPane'));
    // Off the grid (the shipped example has Home PC at x=350): the set takes
    // one shared step, so its gaps survive. Snapping each member on its own
    // turned a 150 gap into 140.
    open();
    getNode('a').x = 350; getNode('a').y = 350; getNode('b').x = 500; getNode('b').y = 350;
    renderCanvasOnly();
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    press('b'); mouse(window, 'mousemove', at(560, 290)); release(at(560, 290));
    ok('an off-grid set keeps its gaps', getNode('b').x - getNode('a').x === 150 && getNode('b').y === getNode('a').y,
       `a ${getNode('a').x},${getNode('a').y} b ${getNode('b').x},${getNode('b').y}`);
    ok('and the pressed one lands on the grid', getNode('b').x % GRID_SNAP === 0 && getNode('b').y % GRID_SNAP === 0, `b ${getNode('b').x},${getNode('b').y}`);
    select('a', 'node');
    press('a'); mouse(window, 'mousemove', at(372, 351)); release(at(372, 351));
    ok('a lone device still snaps to the grid', getNode('a').x % GRID_SNAP === 0 && getNode('a').y % GRID_SNAP === 0, `a ${getNode('a').x},${getNode('a').y}`);

    // ---- 5: Delete ----
    open();
    initHistory();
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }, { type: 'link', id: 'lc' }]);
    key('Delete');
    ok('Delete takes every selected device', !getNode('a') && !getNode('b') && !!getNode('c'));
    ok('every cable on them, and the selected cable', state.links.length === 0, state.links.map((l) => l.id).join(','));
    ok('and the note leader that pointed at one', getAnnotation('note').targets.length === 0);
    ok('the selection is empty after', state.selection.size === 0);
    undo();
    ok('one undo brings all of it back', !!getNode('a') && !!getNode('b') && state.links.length === 3 && getAnnotation('note').targets[0] === 'a');
    ok('Undo has no second step to take', el('undoBtn').disabled === true);

    // ---- 6: coherence on undo, redo and replace ----
    open();
    initHistory();
    batch(() => { state.nodes.push(normalizeLoadedNode(D('x', 500, 500, '10.0.0.40/24'))); save(); renderCanvasOnly(); });
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'x' }]);
    undo();
    ok('undo drops a selected device it took away', ids('node') === 'a', ids('node'));
    ok('and what is left is the one thing selected, with its editor', state.selectedId === 'a' && shown('propertiesPane') && el('propName').value === 'A');
    getNode('a').name = 'After';
    ok('bound to the snapshot\'s object, not the old one', select('a', 'node') === undefined && el('propName').value === 'After');
    getNode('a').name = 'A';
    redo();
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'x' }]);
    undo(); redo();
    ok('redo keeps what is still there', ids('node') === 'a');
    selectEntries([{ type: 'node', id: 'a' }, { type: 'link', id: 'la' }]);
    replaceDocument(templatesData.house, { origin: 'template' });
    ok('opening another document drops the whole set', state.selection.size === 0 && !shown('multiSelectionPane'));

    // Read-only: a set can be selected and looked at, not deleted.
    replaceDocument(Object.assign(lab(), { v: DOC_VERSION + 1 }), { origin: 'file' });
    key('a', { ctrlKey: true });
    ok('a newer document can still be selected', state.selection.size === 8);
    key('Delete');
    ok('but its set is not deleted', state.nodes.length === 5 && state.links.length === 3);
    replaceDocument(lab(), { origin: 'file' });

    // ---- The pane is translated ----
    const es = window.CarinoI18N.MESSAGES.es;
    ok('the pane and the hints are in every locale', ['Selected', 'Cables', 'Select only devices', 'Select only cables', 'Shift-click',
      'Select every device and cable', 'Select every device on this subnet and show them on the map']
      .every((k) => window.CarinoI18N.locales.every((l) => window.CarinoI18N.MESSAGES[l][k])) && es['Select only cables'] !== 'Select only cables');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
