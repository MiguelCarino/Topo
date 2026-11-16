// The palette's click with several things selected (js/app.js
// spawnForSelection, js/groupmap.js pickedGroups):
//   1. one device selected: as before, one new device cabled to it, in its
//      group, and selected;
//   2. several devices selected: one new device cabled to each, one undo
//      step, the selection kept, so the next click adds one more to each;
//   3. a group picked by its tab: one new device inside it, uncabled, the
//      group still whole and picked; Shift on another tab: one in each;
//   4. groups and devices together: one in each group, one cabled to each
//      device outside them;
//   5. a group's devices selected one by one are devices, not the group;
//      the Groups tab's Select members picks the group (the outer one, not
//      the groups inside it); a single selection forgets what was picked;
//   6. a read-only document adds nothing; the string in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('a', 'switch', { x: 0, y: 0, group: 'lab', portCount: 8, interfaces: [] }),
      N('b', 'pc', { x: 200, y: 0, group: 'lab' }),
      N('c', 'pc', { x: 0, y: 400 }),
      N('f', 'pc', { x: 300, y: 400 }),
      N('d', 'pc', { x: 700, y: 0, group: 'store' }),
      N('e', 'pc', { x: 900, y: 0, group: 'cage' })
    ],
    links: [{ id: 'l1', source: 'a', target: 'b', sourceIface: 'p1', targetIface: 'i1' }],
    groups: [{ id: 'lab', name: 'Lab', kind: 'room' }, { id: 'store', name: 'Store', kind: 'room' }, { id: 'cage', name: 'Cage', kind: 'custom', parent: 'store' }] });
  const fresh = () => { replaceDocument(site(), { origin: 'file', docId: 'doc-palettemany' }); state.camera.zoom = 1; applyCamera(); renderCanvasOnly(); };
  const tab = (id) => el('layer-groups').querySelector(`.grp-frame[data-grp="${id}"] .grp-tab`);
  const pressTab = (id, extra) => {
    tab(id).dispatchEvent(new MouseEvent('mousedown', Object.assign({ bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 }, extra || {})));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 }));
  };
  const add = (type) => document.querySelector(`#nodePalette .palette-item[data-type="${type || 'pc'}"]`).click();
  const sel = () => selectedOf('node').slice().sort().join();
  const cabled = (x, y) => state.links.some((l) => (l.source === x && l.target === y) || (l.source === y && l.target === x));
  const newOnes = (n0) => state.nodes.slice(n0);
  try {
    setLocale('en');
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }

    // ---- 1: one device ----
    fresh(); await tick();
    let n0 = state.nodes.length, l0 = state.links.length;
    select('a', 'node'); add(); await tick();
    let made = newOnes(n0);
    ok('one device selected: one new device, cabled to it, in its group, selected', made.length === 1 && cabled('a', made[0].id) && made[0].group === 'lab'
      && state.links.length === l0 + 1 && sel() === made[0].id, json([made.map((n) => n.id), sel()]));

    // ---- 2: several devices ----
    fresh(); await tick();
    selectEntries([{ type: 'node', id: 'c' }, { type: 'node', id: 'f' }]);
    let undoAt = _undoStack.length;
    add(); await tick();
    made = newOnes(n0);
    ok('two devices selected: a new device cabled to each', made.length === 2 && state.links.length === l0 + 2 && cabled('c', made[0].id) && cabled('f', made[1].id)
      && !made.some((n) => n.group), json(state.links.slice(l0)));
    ok('…as one undo step, the selection kept', _undoStack.length === undoAt + 1 && sel() === 'c,f', `${_undoStack.length - undoAt} ${sel()}`);
    ok('…it is said once', /^2 devices added\.$/.test(el('topoToast').textContent), el('topoToast').textContent);
    add(); await tick();
    ok('…the next click adds one more to each', state.nodes.length === n0 + 4 && state.links.length === l0 + 4 && state.links.filter((l) => l.source === 'c' || l.target === 'c').length === 2);
    undo(); await tick(); undo(); await tick();
    ok('…two undos take both clicks back', state.nodes.length === n0 && state.links.length === l0);

    // ---- 3: groups ----
    fresh(); await tick();
    pressTab('lab'); await tick();
    ok('a press on a tab picks the group', sel() === 'a,b' && pickedGroups().map((g) => g.id).join() === 'lab');
    undoAt = _undoStack.length;
    add(); await tick();
    made = newOnes(n0);
    ok('a group picked: one new device inside it, no cable', made.length === 1 && made[0].group === 'lab' && state.links.length === l0, json([made, state.links.slice(l0)]));
    ok('…beside its rightmost device, one undo step', made[0].x > 200 && made[0].x <= 320 && made[0].y === 0 && _undoStack.length === undoAt + 1, json([made[0].x, made[0].y]));
    ok('…the group still whole and picked', sel() === ['a', 'b', made[0].id].sort().join() && pickedGroups().map((g) => g.id).join() === 'lab', sel());
    add(); await tick();
    ok('…the next click adds one more, still uncabled', groupMembers('lab').length === 4 && state.links.length === l0 && state.nodes.length === n0 + 2);
    fresh(); await tick();
    pressTab('lab'); await tick(); pressTab('cage', { shiftKey: true }); await tick();
    ok('Shift on another tab picks both', pickedGroups().map((g) => g.id).sort().join() === 'cage,lab' && sel() === 'a,b,e', sel());
    undoAt = _undoStack.length;
    add('camera'); await tick();
    made = newOnes(n0);
    ok('two groups picked: one in each, no cable, one undo step', made.length === 2 && made.map((n) => n.group).sort().join() === 'cage,lab' && made.every((n) => n.type === 'camera')
      && state.links.length === l0 && _undoStack.length === undoAt + 1, json(made.map((n) => n.group)));
    undo(); await tick();
    ok('…undone at once', state.nodes.length === n0 && state.links.length === l0);

    // ---- 4: groups and devices ----
    fresh(); await tick();
    pressTab('lab'); await tick();
    selectEntries([...state.selection, { type: 'node', id: 'c' }, { type: 'node', id: 'f' }]);
    add(); await tick();
    made = newOnes(n0);
    ok('a group and two devices: one in the group uncabled, one cabled to each device', made.length === 3 && made[0].group === 'lab' && !cabled('a', made[0].id) && !cabled('b', made[0].id)
      && cabled('c', made[1].id) && cabled('f', made[2].id) && state.links.length === l0 + 2, json([made.map((n) => n.group), state.links.slice(l0)]));
    ok('…the selection is the group whole and the two devices', sel() === ['a', 'b', 'c', 'f', made[0].id].sort().join(), sel());

    // ---- 5: what counts as a group ----
    fresh(); await tick();
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    add(); await tick();
    made = newOnes(n0);
    ok('a group\'s devices selected one by one are devices: a cabled one each, in their group', made.length === 2 && cabled('a', made[0].id) && cabled('b', made[1].id) && made.every((n) => n.group === 'lab'));
    fresh(); await tick();
    selectGroupMembers('store'); await tick();
    add(); await tick();
    made = newOnes(n0);
    ok('Select members picks the group: one in it, not in the group inside it', made.length === 1 && made[0].group === 'store' && state.links.length === l0 && sel() === ['d', 'e', made[0].id].sort().join(), json(made));
    select('c', 'node'); await tick();
    ok('a single selection forgets the groups picked', pickedGroups().length === 0);
    fresh(); await tick();
    pressTab('lab'); await tick(); pressTab('lab', { shiftKey: true }); await tick();
    ok('Shift on a picked tab takes it out', sel() === '' && pickedGroups().length === 0);
    add(); await tick();
    ok('nothing selected: one device, as before', state.nodes.length === n0 + 1 && state.links.length === l0);

    // ---- 6: read only, the string ----
    fresh(); await tick();
    selectEntries([{ type: 'node', id: 'c' }, { type: 'node', id: 'f' }]);
    state.readOnly = { doc: cloneData(serializeDoc()), loaded: JSON.stringify(serializeDoc()) };
    add(); await tick();
    ok('read only: nothing is added', state.nodes.length === n0 && state.links.length === l0);
    state.readOnly = null;
    const { has, locales } = window.CarinoI18N;
    locales.forEach((loc) => ok(`${loc} carries the string`, has(loc, '{n} devices added.')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    state.readOnly = null;
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
