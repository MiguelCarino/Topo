// A tile from the node grid, straight into a group (D436; js/groupmap.js
// "A tile from the node grid", spawnNode in js/app.js, the canvas's drop in
// js/app.js). What is held here:
//   1. a tile let go inside a group's frame adds the device in that group,
//      where it was dropped, as one undo step, and a toast says so;
//   2. the innermost frame wins: on a rack inside a room it is in the rack,
//      with no units, and the toast says Open rack places it;
//   3. let go on a collapsed group's node it goes into that group; outside
//      every frame it is in no group, as before;
//   4. while the tile is over a frame the frame is lit and a label names it;
//      leaving the map clears both;
//   5. a click on a tile with a device selected adds the new one connected
//      to it and in its group; with nothing selected, in no group;
//   6. a read-only network adds nothing; the tile's hint says all this.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? false : null));
  const heldView = state.settings.view;
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('s1', 'server', { x: 0, y: 0, group: 'rk', rackU: 10 }),
      N('s2', 'server', { x: 100, y: 0, group: 'rk', rackU: 12 }),
      N('p1', 'pc', { x: 0, y: 300, group: 'srv' }),
      N('pc1', 'pc', { x: 600, y: 0, group: 'off' }),
      N('pc2', 'pc', { x: 700, y: 0, group: 'off' }),
      N('l1', 'pc', { x: 600, y: 500 })
    ],
    links: [],
    groups: [
      { id: 'srv', name: 'Server room', kind: 'room' },
      { id: 'rk', name: 'Rack 3', kind: 'rack', parent: 'srv', uHeight: 42 },
      { id: 'off', name: 'Office', kind: 'room' }
    ] });
  const open = () => { replaceDocument(site(), { origin: 'file', docId: 'doc-griddrop' }); state.camera.zoom = 1; state.camera.x = 300; state.camera.y = 300; applyCamera(); renderCanvasOnly(); };
  const cc = el('canvasContainer');
  // A drag from the grid, as the browser sends it: types on dragover, data on drop.
  const dt = (type) => { const d = new DataTransfer(); d.setData('text/carino-node', type); return d; };
  const at = (x, y) => { const rect = el('networkCanvas').getBoundingClientRect(); return { clientX: rect.left + state.camera.x + x * state.camera.zoom, clientY: rect.top + state.camera.y + y * state.camera.zoom }; };
  const over = (type, x, y) => cc.dispatchEvent(new DragEvent('dragover', Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt(type) }, at(x, y))));
  const drop = (type, x, y) => cc.dispatchEvent(new DragEvent('drop', Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt(type) }, at(x, y))));
  const frame = (id) => el('layer-groups').querySelector(`.grp-frame[data-grp="${id}"]`);
  const cue = () => document.querySelector('#layer-nodes > .tile-drop-cue');
  const toast = () => el('topoToast').textContent;
  const clearToast = () => { el('topoToast').textContent = ''; };
  const idsNow = () => new Set(state.nodes.map((n) => n.id));
  const fresh = (before) => state.nodes.filter((n) => !before.has(n.id));

  try {
    setView('map');
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    open();

    // ---- 4: the cue while it is over a frame ----
    over('pc', 650, 40);
    ok('a tile over the Office frame lights it', frame('off').classList.contains('grp-drop'));
    ok('and a label at the pointer says where it would go', !!cue() && cue().textContent === 'Into Office', cue() && cue().textContent);
    ok('no other frame is lit', document.querySelectorAll('#layer-groups .grp-drop').length === 1);
    over('pc', 300, 620);
    ok('over empty map, nothing is lit and nothing is said', !document.querySelector('#layer-groups .grp-drop') && !cue());
    over('pc', 650, 40);
    cc.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: document.body }));
    ok('leaving the map clears the cue', !frame('off').classList.contains('grp-drop') && !cue());

    // ---- 1: dropped inside a frame ----
    let before = idsNow(), undoAt = _undoStack.length;
    clearToast();
    over('printer', 650, 40);
    drop('printer', 650, 40);
    let made = fresh(before);
    ok('let go inside the Office frame, a device is added', made.length === 1 && made[0].type === 'printer');
    ok('in the Office', made[0].group === 'off', made[0] && made[0].group);
    ok('where it was dropped, on the grid', made[0].x === 660 && made[0].y === 40, json([made[0].x, made[0].y]));
    ok('selected, the cue gone', state.selectedId === made[0].id && !cue() && !document.querySelector('#layer-groups .grp-drop'));
    ok('one undo step', _undoStack.length === undoAt + 1);
    ok('a toast says where it is', new RegExp(`${made[0].name} is in Office now\\.`).test(toast()), toast());
    ok('the frame counts it', /Office · 3/.test(frame('off').textContent), frame('off').textContent);
    undo();
    ok('undone, it is gone', state.nodes.length === 6);

    // ---- 2: the innermost frame; a rack ----
    before = idsNow(); clearToast();
    drop('server', 50, 0);
    made = fresh(before);
    ok('dropped on the rack inside the room, it is in the rack', made.length === 1 && made[0].group === 'rk');
    ok('with no units yet, and the toast says Open rack places it', made[0].rackU === undefined && /is in Rack 3 now\./.test(toast()) && /Open rack places it/.test(toast()), toast());
    undo();
    before = idsNow();
    drop('pc', 40, 300);
    ok('dropped in the room beside the rack, it is in the room', fresh(before)[0].group === 'srv');
    undo();

    // ---- 3: a collapsed group; no group ----
    toggleGroupCollapsed('off'); renderCanvasOnly();
    const fold = el('ui-group-off'), fx = Number(/translate\(([-\d.]+)/.exec(fold.getAttribute('transform'))[1]), fy = Number(/translate\([-\d.]+,?\s*([-\d.]+)/.exec(fold.getAttribute('transform'))[1]);
    over('pc', fx, fy);
    ok('a tile over a collapsed group lights its node', fold.classList.contains('grp-drop') && !!cue() && cue().textContent === 'Into Office');
    before = idsNow(); clearToast();
    drop('pc', fx, fy);
    made = fresh(before);
    ok('let go there, the device is in that group, which stays collapsed', made.length === 1 && made[0].group === 'off' && collapsedGroupIds().has('off') && /is in Office now\./.test(toast()), toast());
    undo();
    toggleGroupCollapsed('off'); renderCanvasOnly();
    before = idsNow(); clearToast();
    drop('pc', 300, 620);
    made = fresh(before);
    ok('let go outside every frame, it is in no group, and nothing is said of groups', made.length === 1 && !made[0].group && !/is in/.test(toast()), toast());
    undo();

    // ---- 5: a click on a tile ----
    select('pc1', 'node');
    before = idsNow(); undoAt = _undoStack.length;
    spawnNode('pc', { connectTo: 'pc1' });
    made = fresh(before);
    ok('added by a click beside a selected device, it is connected to it and in its group', made.length === 1 && made[0].group === 'off' && state.links.some((l) => l.source === 'pc1' && l.target === made[0].id));
    ok('as one undo step', _undoStack.length === undoAt + 1);
    undo();
    select('s1', 'node');
    before = idsNow();
    spawnNode('server', { connectTo: 's1' });
    ok('beside a device in a rack, it is in the rack with no units', fresh(before)[0].group === 'rk' && fresh(before)[0].rackU === undefined);
    undo();
    select('l1', 'node');
    before = idsNow();
    spawnNode('pc', { connectTo: 'l1' });
    ok('beside a device in no group, it is in none', !fresh(before)[0].group);
    undo();
    select(null, null);
    before = idsNow();
    spawnNode('pc', {});
    ok('with nothing selected, it is in no group', !fresh(before)[0].group);
    undo();
    before = idsNow();
    spawnNode('pc', { at: { x: 40, y: 300 } });
    ok('placed at a point by code, with no group named, it is in none', !fresh(before)[0].group);
    undo();

    // ---- 6: read-only; the hint ----
    state.readOnly = { doc: site() };
    before = idsNow();
    over('pc', 650, 40);
    ok('a read-only network lights nothing', !frame('off').classList.contains('grp-drop') && !cue());
    drop('pc', 650, 40);
    ok('and adds nothing', fresh(before).length === 0);
    state.readOnly = null;
    const tile = document.querySelector('#paletteContainer [data-type="pc"], [data-type="pc"][draggable="true"]');
    ok('the tile\'s hint says it can be dropped on a group', !!tile && /onto a group to add it there/.test(tile.title), tile && tile.title);
    setLocale('es'); applyStaticI18n();
    over('pc', 650, 40);
    ok('the label is translated', !!cue() && /Office/.test(cue().textContent) && cue().textContent !== 'Into Office', cue() && cue().textContent);
    clearPaletteDropCue();
    setLocale('en'); applyStaticI18n(); renderCanvasOnly();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    if (heldView && heldView !== state.settings.view) setView(heldView);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
