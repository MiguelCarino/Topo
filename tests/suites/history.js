// Undo/redo rides the one chokepoint every mutation already calls — save(). This
// suite drives the real undo()/redo()/save() the app uses, not a copy, so it
// proves the timeline the toolbar buttons and Ctrl+Z act on. It also pins the
// thing that made undo cheap to build: "save as template" and the URL hash now
// share a single serializer, so they cannot drift apart again.
window.addEventListener('load', () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const undoBtn = () => document.getElementById('undoBtn');
  const redoBtn = () => document.getElementById('redoBtn');

  // ---- One serializer, not two ----
  // templateSnapshot() used to keep its own shorter allowlist and silently drop
  // portCount / socket bindings / nat. It is now just serializeDoc(), so the two
  // are the same bytes by construction.
  state.nodes = [normalizeLoadedNode({ id: 'r', type: 'router', name: 'R', x: 0, y: 0, nat: true, portCount: undefined,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] }),
    normalizeLoadedNode({ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 24, interfaces: [] })];
  state.links = [normalizeLoadedLink({ id: 'x', source: 'r', target: 'sw', sourceIface: 'i1', targetIface: 'p3' })];
  ok('templateSnapshot() is exactly serializeDoc()',
     JSON.stringify(templateSnapshot()) === JSON.stringify(serializeDoc()));
  ok('the shared serializer keeps portCount and socket bindings',
     serializeDoc().nodes[1].portCount === 24 && serializeDoc().links[0].targetIface === 'p3');

  // ---- The timeline rides save() ----
  state.nodes = [normalizeLoadedNode({ id: 'a', type: 'pc', name: 'Alpha', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.2/24' }] })];
  state.links = [];
  initHistory();
  ok('a freshly loaded document has nothing to undo', undoBtn().disabled === true);
  ok('and nothing to redo', redoBtn().disabled === true);

  getNode('a').name = 'Renamed'; save();
  ok('an edit enables undo', undoBtn().disabled === false);

  state.nodes.push(normalizeLoadedNode({ id: 'b', type: 'server', name: 'Bravo', x: 100, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.3/24' }] }));
  save();
  ok('a second edit adds a node', state.nodes.length === 2);

  undo();
  ok('undo removes the added node', !getNode('b') && state.nodes.length === 1, state.nodes.map((n) => n.id).join(','));
  ok('undo leaves the earlier edit standing', getNode('a').name === 'Renamed', getNode('a').name);
  ok('undo enables redo', redoBtn().disabled === false);

  undo();
  ok('a second undo reverts the rename', getNode('a').name === 'Alpha', getNode('a').name);
  ok('at the floor of the timeline, undo is disabled again', undoBtn().disabled === true);

  redo();
  ok('redo restores the rename', getNode('a').name === 'Renamed', getNode('a').name);
  redo();
  ok('redo restores the added node', !!getNode('b') && state.nodes.length === 2, state.nodes.map((n) => n.id).join(','));
  ok('with the redo future exhausted, redo is disabled', redoBtn().disabled === true);

  // ---- A fresh edit forks the timeline, discarding the redo future ----
  undo(); // drop node b again, so a redo future exists
  ok('there is a redo future to discard', redoBtn().disabled === false);
  getNode('a').name = 'Forked'; save();
  ok('a new edit clears the redo future', redoBtn().disabled === true);
  ok('and the forked edit is itself undoable', undoBtn().disabled === false);

  // ---- An identical save() must not stack a phantom step ----
  state.nodes = [normalizeLoadedNode({ id: 'c', type: 'pc', name: 'Solo', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.4/24' }] })];
  state.links = [];
  initHistory();
  getNode('c').name = 'SoloEdited'; save();
  save(); save(); // same document three times — only the first is a real change
  undo();
  ok('repeated identical saves add no extra undo steps', getNode('c').name === 'Solo', getNode('c').name);
  ok('so one undo reaches the floor', undoBtn().disabled === true);

  // ---- Undo genuinely brings a deleted node back, links and all ----
  state.nodes = [
    normalizeLoadedNode({ id: 'keep', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] }),
    normalizeLoadedNode({ id: 'doomed', type: 'pc', name: 'Doomed', x: 100, y: 0, gw: '10.0.0.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] })
  ];
  state.links = [normalizeLoadedLink({ id: 'l1', source: 'keep', target: 'doomed', sourceIface: 'i1', targetIface: 'i1' })];
  autoBindLinks();
  initHistory();
  state.selectedId = 'doomed'; state.selectedType = 'node';
  deleteSelected();
  ok('deleting a node drops it and its cable', !getNode('doomed') && state.links.length === 0);
  undo();
  ok('undo brings the deleted node back', !!getNode('doomed'), state.nodes.map((n) => n.id).join(','));
  ok('and reconnects its cable', state.links.length === 1 && state.links[0].source === 'keep' && state.links[0].target === 'doomed');

  // ---- Ctrl+Z / Ctrl+Shift+Z act on the canvas (not inside a field) ----
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  state.nodes = [normalizeLoadedNode({ id: 'k', type: 'pc', name: 'K0', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.9/24' }] })];
  state.links = [];
  initHistory();
  getNode('k').name = 'K1'; save();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  ok('Ctrl+Z undoes from the canvas', getNode('k') && getNode('k').name === 'K0', getNode('k') && getNode('k').name);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
  ok('Ctrl+Shift+Z redoes', getNode('k') && getNode('k').name === 'K1', getNode('k') && getNode('k').name);

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
