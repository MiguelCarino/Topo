// A host's fold lasts only while something runs on it (js/groupmap.js,
// pruneHostFolds), and the last loose ends of Round 3 item 2. Found with a
// real mouse by the whole-change review: a folded host whose last guest went
// (the hosting undone, Runs on set to none, the guest deleted or retyped)
// kept its fold out of sight, so the next click on its card selected nothing
// (it unfolded the invisible fold) and the next VM dropped on it vanished
// into it. What is held here:
//   1. undone hosting: the fold goes with the guest; a click on the host's
//      card selects it; redone, the guest is back and drawn;
//   2. Runs on set to none: no fold; a VM dropped on the host afterwards is
//      drawn, the badge says 1 and ▾ (unfolded);
//   3. the guest deleted, or retyped to a server: no fold;
//   4. a fold stored by an older build for a host with nothing on it is
//      dropped as the document is read, and from the stored record too;
//      a host with nothing on it cannot be folded;
//   5. the rack's place dialog offers no VM or container as a new type;
//   6. the Homelab block lands with its VMs and container on its hypervisor.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('sw', 'switch', { x: 300, y: 0 }),
      N('hv', 'server', { x: 0, y: 200 }),
      N('vma', 'vm', { x: 600, y: 200 }),
      N('vmb', 'vm', { x: 800, y: 200 })
    ],
    links: [{ id: 'l1', source: 'sw', target: 'hv' }],
    groups: [] });
  const open = (docId = 'doc-hostfold') => { replaceDocument(site(), { origin: 'file', docId }); state.camera.zoom = 1; state.camera.x = 300; state.camera.y = 300; applyCamera(); renderCanvasOnly(); };
  const nodeEl = (id) => el(`ui-node-${id}`);
  const badge = (id) => nodeEl(id) && nodeEl(id).querySelector('.host-badge');
  const count = (id) => { const b = badge(id); return b ? b.querySelector('.host-badge-count').textContent : null; };
  const at = (x, y, extra) => {
    const rect = el('networkCanvas').getBoundingClientRect();
    return Object.assign({ clientX: rect.left + state.camera.x + x * state.camera.zoom, clientY: rect.top + state.camera.y + y * state.camera.zoom, bubbles: true, button: 0 }, extra || {});
  };
  const press = (id) => { const n = getNode(id); nodeEl(id).dispatchEvent(new MouseEvent('mousedown', at(n.x, n.y))); };
  const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', at(x, y)));
  const up = (x, y) => window.dispatchEvent(new MouseEvent('mouseup', at(x, y)));
  const drag = (id, x, y) => { const n = getNode(id); press(id); move((n.x + x) / 2, (n.y + y) / 2); move(x, y); up(x, y); };
  const click = (id) => { const n = getNode(id); press(id); up(n.x, n.y); };
  const clickBadge = (id) => { const b = badge(id); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); };
  const stored = (docId) => { try { const r = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}')[docId]; return r ? r.hosts || [] : null; } catch (e) { return 'blocked'; } };
  const host = () => getNode('hv');

  try {
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    setView('map');
    open();

    // ---- 1: the hosting undone ----
    drag('vma', host().x, host().y);
    ok('(VMA dragged onto HV runs on it)', getNode('vma').host === 'hv' && count('hv') === '1', json([getNode('vma').host, count('hv')]));
    clickBadge('hv');
    ok('(folded: VMA not drawn)', isHostFolded('hv') && !nodeEl('vma'));
    undo();
    ok('undone: VMA on nothing and HV no longer folded', !getNode('vma').host && !isHostFolded('hv') && !badge('hv') && !!nodeEl('vma'));
    ok('and the stored view forgot it', json(stored('doc-hostfold') || []) === '[]', json(stored('doc-hostfold')));
    select(null, null);
    click('hv');
    ok('a click on HV\'s card then selects it', inSelection('node', 'hv'), json([...state.selection]));
    redo();
    ok('redone: VMA runs on HV again, drawn (the fold is not brought back)', getNode('vma').host === 'hv' && !isHostFolded('hv') && !!nodeEl('vma'));

    // ---- 2: Runs on set to none, then another VM dropped on it ----
    clickBadge('hv');
    ok('(folded again)', isHostFolded('hv'));
    batch(() => { getNode('vma').host = null; save(); renderCanvasOnly(); });
    ok('Runs on set to none: HV is not folded', !isHostFolded('hv') && !!nodeEl('vma'));
    drag('vmb', host().x, host().y);
    ok('VMB dropped on HV afterwards runs on it and stays drawn', getNode('vmb').host === 'hv' && !!nodeEl('vmb') && !isHostFolded('hv'));
    ok('the badge says 1, unfolded', count('hv') === '1' && !nodeEl('hv').querySelector('.host-fold-back'), count('hv'));

    // ---- 3: the guest deleted, or retyped ----
    clickBadge('hv');
    ok('(folded with VMB in it)', isHostFolded('hv') && !nodeEl('vmb'));
    batch(() => { state.nodes = state.nodes.filter((n) => n.id !== 'vmb'); save(); renderCanvasOnly(); });
    ok('its only guest deleted: HV is not folded', !isHostFolded('hv') && !badge('hv'));
    undo();
    ok('(undone: VMB back on HV, drawn)', getNode('vmb').host === 'hv' && !!nodeEl('vmb'));
    clickBadge('hv');
    batch(() => { getNode('vmb').type = 'server'; save(); renderCanvasOnly(); });
    ok('its only guest retyped to a server: on nothing, HV not folded', !getNode('vmb').host && !isHostFolded('hv'));
    undo();

    // ---- 4: a stale fold from storage; folding nothing ----
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ 'doc-stale': { ids: [], hosts: ['hv', 'sw'], at: Date.now() } }));
    } catch (e) { /* blocked */ }
    open('doc-stale');
    ok('a stored fold on a host with nothing on it is dropped on reading', !isHostFolded('hv') && !isHostFolded('sw'));
    ok('and from the stored record', stored('doc-stale') === null || json(stored('doc-stale')) === '[]', json(stored('doc-stale')));
    ok('a host with nothing on it cannot be folded', setHostFolded('hv', true) === false && !isHostFolded('hv'));
    select(null, null);
    click('hv');
    ok('so a click on it selects it', inSelection('node', 'hv'));

    // ---- 5: the rack's place dialog ----
    batch(() => {
      state.groups.push({ id: 'rk', name: 'Rack A', kind: 'rack', uHeight: 24 });
      save();
    });
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 5, height: 1 });
    const types = [...el('rackPlaceType').options].map((o) => o.value);
    ok('the place dialog offers no VM or container as a new device', !types.some(isVirtualType) && types.includes('server'), json(types));
    ok('a server is still what it starts on', el('rackPlaceType').value === 'server', el('rackPlaceType').value);
    closePlaceDialog();
    undo();

    // ---- 6: the Homelab block ----
    open('doc-homelab');
    const before = new Set(state.nodes.map((n) => n.id));
    insertBlockNow(builtinBlock('homelab'), { at: { x: 0, y: 1200 } });
    const added = state.nodes.filter((n) => !before.has(n.id));
    const hv = added.find((n) => n.name === 'Hypervisor (PVE)');
    const guests = added.filter((n) => isVirtualType(n.type));
    ok('the Homelab block\'s VMs and container run on its own hypervisor', hv && guests.length === 3 && guests.every((g) => g.host === hv.id), json(guests.map((g) => [g.name, g.host])));
    ok('which shows a badge of 3', hv && count(hv.id) === '3', hv && count(hv.id));
    ok('nothing else in the block runs on anything', added.filter((n) => !isVirtualType(n.type)).every((n) => !n.host));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
