// VMs and containers on their hosts, on the map (Review-Packs/Topo-groups.md,
// "Round 3", item 2; js/groupmap.js "Hosts on the map" and "Onto a host").
// The gestures are the real handlers': a press on the device's element, the
// window's mousemove and mouseup, a click on the badge. What is held here:
//   1. a host carries a badge with how many run on it, a VM's containers
//      counted in; nothing else does;
//   2. a click on the badge folds them into the host: not drawn, their cables
//      drawn to the host once per far end (×N), one between a guest and its
//      own host not at all, the host's own cable to the same far end joined
//      to that line; a second card behind the host; the host is not
//      selected; again, they are back. A view: no undo step, kept per
//      document, not handed to another. A click or tap on a folded host's
//      card unfolds it, as on a collapsed group, and selects nothing; a
//      drag moves it, folded; Shift-click selects it;
//   3. folded, the search, Zoom to matches and a selection reach them
//      through the host; Delete on one asks first; the export keeps the
//      count and leaves the chevron out;
//   4. a VM dragged onto a server runs on it, in its group, one undo step,
//      the host ringed and "Runs on …" at the pointer while over it; a
//      device that cannot host it (a container) is no target, and the frame
//      round it is; a PC dragged over a server is not a guest; a set of VMs
//      goes together; a container onto a VM; the words are translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  let asked = 0;
  const heldResponder = setDialogResponder((req) => { if (req.kind === 'confirm') { asked++; return false; } return null; });

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('sw', 'switch', { x: 300, y: 0 }),
      N('hv', 'server', { x: 0, y: 200, group: 'room' }),
      N('hv2', 'server', { x: 600, y: 200 }),
      N('vm1', 'vm', { x: -100, y: 400, host: 'hv' }),
      N('vm2', 'vm', { x: 100, y: 400, host: 'hv' }),
      N('ct1', 'container', { x: 100, y: 600, host: 'vm2' }),
      N('vmf', 'vm', { x: 900, y: 400 }),
      N('vmg', 'vm', { x: 1000, y: 400 }),
      N('ctf', 'container', { x: 900, y: 600 }),
      N('ctx', 'container', { x: 1200, y: 200, group: 'room' }),
      N('pc', 'pc', { x: 1200, y: 600 })
    ],
    links: [
      { id: 'l1', source: 'sw', target: 'hv' },
      { id: 'l2', source: 'sw', target: 'vm1' },
      { id: 'l3', source: 'sw', target: 'vm2' },
      { id: 'l4', source: 'pc', target: 'ct1' },
      { id: 'l5', source: 'vm1', target: 'hv' }
    ],
    groups: [{ id: 'room', name: 'Server room', kind: 'room' }] });
  const open = (docId = 'doc-hostmap') => { replaceDocument(site(), { origin: 'file', docId }); state.camera.zoom = 1; state.camera.x = 300; state.camera.y = 300; applyCamera(); renderCanvasOnly(); };
  const nodeEl = (id) => el(`ui-node-${id}`);
  const badge = (id) => nodeEl(id) && nodeEl(id).querySelector('.host-badge');
  const count = (id) => { const b = badge(id); return b ? b.querySelector('.host-badge-count').textContent : null; };
  const edges = () => [...document.querySelectorAll('#layer-links > .grp-edge')].map((e) => e.dataset.links).sort();
  const cue = () => document.querySelector('#layer-nodes > .grp-drop-cue');
  const toast = () => el('topoToast').textContent;
  const at = (x, y, extra) => {
    const rect = el('networkCanvas').getBoundingClientRect();
    return Object.assign({ clientX: rect.left + state.camera.x + x * state.camera.zoom, clientY: rect.top + state.camera.y + y * state.camera.zoom, bubbles: true, button: 0 }, extra || {});
  };
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
  const clickBadge = (id) => { const b = badge(id); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); };

  try {
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    setView('map');
    open();

    // ---- 1: the badge ----
    ok('a host carries a badge: HV runs two VMs and, on one, a container', count('hv') === '3', count('hv'));
    ok('a VM with a container on it has one too', count('vm2') === '1', count('vm2'));
    ok('nothing else does', !badge('sw') && !badge('vm1') && !badge('hv2') && !badge('ct1'));
    ok('it says how many in words', /3 devices run on it/.test(badge('hv').querySelector('title').textContent), badge('hv').querySelector('title').textContent);

    // ---- 2: folding ----
    select(null, null);
    let undoAt = _undoStack.length;
    clickBadge('hv');
    ok('a click on the badge folds them in: none of the three is drawn', isHostFolded('hv') && !nodeEl('vm1') && !nodeEl('vm2') && !nodeEl('ct1') && !!nodeEl('hv'));
    ok('the host is not selected by it', state.selectedId !== 'hv' && !inSelection('node', 'hv'));
    ok('a second card behind the host, and the badge says ▸', !!nodeEl('hv').querySelector('.host-fold-back') && /M-?\d/.test(badge('hv').querySelector('.host-fold-chev').getAttribute('d')));
    ok('their cables are drawn to it, once per far end: the switch\'s three as one line (its own joined in)', json(edges()) === json(['l2 l3 l1', 'l4'].sort()) || json(edges().map((e) => e.split(' ').sort().join(' '))) === json(['l1 l2 l3', 'l4']), json(edges()));
    ok('the switch line counts ×3', [...document.querySelectorAll('#layer-links > .grp-edge-count')].some((t) => t.textContent === '×3'));
    ok('the cable between a guest and its own host is not drawn', !el('ui-link-l5') && !edges().some((e) => e.split(' ').includes('l5')));
    ok('nor the switch\'s own cable on its own, under the line', !el('ui-link-l1'));
    ok('folding is a view: no undo step', _undoStack.length === undoAt);
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}')['doc-hostmap'];
    ok('it is kept in this browser, per document', !!stored && json(stored.hosts) === json(['hv']), json(stored));

    // ---- 3: reached through the host ----
    ok('a folded guest is on the map where its host is', json(mapPointOf(getNode('ct1'))) === json({ x: getNode('hv').x, y: getNode('hv').y }) || (mapPointOf(getNode('ct1')).x === 0 && mapPointOf(getNode('ct1')).y === 200), json(mapPointOf(getNode('ct1'))));
    setQuery('VM1');
    ok('a search that matches a folded guest does not dim its host', !nodeEl('hv').classList.contains('q-dim') && nodeEl('sw').classList.contains('q-dim'));
    setQuery('');
    selectEntries([{ type: 'node', id: 'vm1' }]);
    ok('a folded guest selected (from the table) marks its host, dashed', nodeEl('hv').querySelector('rect:not(.host-fold-back)').getAttribute('stroke-dasharray') === '5 3');
    ok('Delete on it counts it as out of sight', selectedHiddenCount() === 1);
    asked = 0;
    deleteSelected();
    await new Promise((r) => setTimeout(r, 30));
    ok('and asks first (no: nothing goes)', asked === 1 && !!getNode('vm1'), `asked ${asked}`);
    select(null, null);
    const svg = new DOMParser().parseFromString(canvasSvgMarkup(1).markup, 'image/svg+xml');
    ok('the export keeps the count and the second card, not the chevron', !!svg.querySelector('.host-badge-count') && !svg.querySelector('.host-fold-chev') && !!svg.querySelector('.host-fold-back'));
    ok('the export has no folded guest', !svg.querySelector('#ui-node-vm1'));

    // A VM folded on its own: its container folds into it; the server folded
    // too takes them all.
    clickBadge('hv');
    ok('again, they are back', !isHostFolded('hv') && !!nodeEl('vm1') && !!nodeEl('ct1') && !!el('ui-link-l1') && !!el('ui-link-l5'));
    clickBadge('vm2');
    ok('a VM folded: its container is drawn as it, its cable to the PC with it', !nodeEl('ct1') && !!nodeEl('vm2') && json(edges()) === json(['l4']));
    clickBadge('hv');
    ok('the server folded too: the outermost takes them all', !nodeEl('vm2') && !nodeEl('ct1') && edges().some((e) => e.split(' ').includes('l4')));
    open('doc-hostmap-2');
    ok('another document has none folded', !isHostFolded('hv') && !!nodeEl('vm1'));
    open('doc-hostmap');
    ok('back to the first, they are folded again', isHostFolded('hv') && !nodeEl('vm1'));
    // A folded host's card follows a collapsed group's rules (the owner's
    // correction): a tap unfolds it and selects nothing, a drag moves it and
    // leaves it folded, Shift-click selects it. Unfolded, a click selects.
    select(null, null);
    undoAt = _undoStack.length;
    press('hv');
    up(getNode('hv').x + 1, getNode('hv').y);
    ok('a click on a folded host\'s card unfolds it', !isHostFolded('hv') && !!nodeEl('vm1') && !!nodeEl('vm2'));
    ok('and selects nothing, and is no undo step', !inSelection('node', 'hv') && state.selectedId !== 'hv' && _undoStack.length === undoAt);
    press('hv');
    up(getNode('hv').x, getNode('hv').y);
    ok('unfolded, a click on it selects it and folds nothing', inSelection('node', 'hv') && !isHostFolded('hv'));
    select(null, null);
    clickBadge('hv');
    drag('hv', 200, 300);
    ok('a drag on a folded host moves it, still folded, one undo step', isHostFolded('hv') && getNode('hv').x === 200 && getNode('hv').y === 300 && _undoStack.length === undoAt + 1, json([getNode('hv').x, getNode('hv').y]));
    undo();
    ok('undone, back where it was, still folded', getNode('hv').x === 0 && getNode('hv').y === 200 && isHostFolded('hv'));
    press('hv', { shiftKey: true });
    up(getNode('hv').x, getNode('hv').y);
    ok('Shift-click on a folded host selects it and leaves it folded', inSelection('node', 'hv') && isHostFolded('hv'));
    select(null, null);
    ok('the badge still unfolds it', (clickBadge('hv'), !isHostFolded('hv')));
    clickBadge('hv');
    clickBadge('hv'); clickBadge('vm2');

    // ---- 4: onto a host ----
    undoAt = _undoStack.length;
    drag('vmf', 600, 200, true);
    ok('a VM over a server: the server is ringed', !!nodeEl('hv2').querySelector('.host-drop-ring'));
    ok('and the label says what it will run on', cue() && cue().classList.contains('host-drop-cue') && cue().textContent === 'Runs on HV2', cue() && cue().textContent);
    up(600, 200);
    ok('let go, it runs on it', getNode('vmf').host === 'hv2', getNode('vmf').host);
    ok('one undo step for the move and the host', _undoStack.length === undoAt + 1);
    ok('said in a toast', /VMF runs on HV2 now\./.test(toast()), toast());
    ok('the server has a badge now', count('hv2') === '1');
    ok('it is set beside the host, not on its card: the nearest free place, to its right',
      getNode('vmf').x === 700 && getNode('vmf').y === 200, json([getNode('vmf').x, getNode('vmf').y]));
    undo();
    ok('undone: on nothing, back where it was', !getNode('vmf').host && getNode('vmf').x === 900 && !badge('hv2'));

    // Onto a host in a group: it is then in that group (repairHosts).
    drag('vmf', 0, 200);
    ok('onto a host in a room: it runs on it and is in the room', getNode('vmf').host === 'hv' && getNode('vmf').group === 'room');
    undo();
    ok('undone: in no group again', !getNode('vmf').group && !getNode('vmf').host);

    // A container is no host for a VM: the frame round it is the target.
    drag('vmf', 1200, 200, true);
    ok('a VM over a container: no ring, the room\'s frame is the target', !nodeEl('ctx').querySelector('.host-drop-ring') && cue() && !cue().classList.contains('host-drop-cue') && /Server room/.test(cue().textContent), cue() && cue().textContent);
    up(1200, 200);
    ok('let go, it is in the room and runs on nothing', getNode('vmf').group === 'room' && !getNode('vmf').host);
    undo();

    // A PC is not a guest: over a server it is no host drop. Since round 3
    // item 1 it is a new-group drop instead (js/groupmap.js, "A new group
    // from two devices"), which asks first: the responder declines, and the
    // move is filed once the answer is in, so the undo waits for it.
    drag('pc', 600, 200, true);
    ok('a PC over a server: no ring', !nodeEl('hv2').querySelector('.host-drop-ring') && !(cue() && cue().classList.contains('host-drop-cue')));
    ok('but the new-group cue instead', !!nodeEl('hv2').querySelector('.pair-drop-ring') && cue() && cue().classList.contains('pair-drop-cue'));
    up(600, 200);
    await new Promise((r) => setTimeout(r, 0));
    ok('it does not run on it', !getNode('pc').host);
    undo();

    // A set of VMs goes together.
    selectEntries([{ type: 'node', id: 'vmf' }, { type: 'node', id: 'vmg' }]);
    undoAt = _undoStack.length;
    drag('vmf', 600, 200, true);
    ok('two VMs over a server: "2 devices run on HV2"', cue() && cue().textContent === '2 devices run on HV2', cue() && cue().textContent);
    up(600, 200);
    ok('both run on it, one undo step', getNode('vmf').host === 'hv2' && getNode('vmg').host === 'hv2' && _undoStack.length === undoAt + 1);
    {
      const f = getNode('vmf'), g = getNode('vmg'), h = getNode('hv2');
      const clear = (a, b) => Math.abs(a.x - b.x) >= 90 || Math.abs(a.y - b.y) >= 100;
      ok('each is set beside it, clear of the host and of each other', clear(f, h) && clear(g, h) && clear(f, g)
        && Math.abs(f.x - h.x) <= 100 && Math.abs(g.y - h.y) <= 120, json([f.x, f.y, g.x, g.y]));
    }
    undo();
    select(null, null);

    // A container onto a VM: one level, allowed.
    drag('ctf', 900, 400);
    ok('a container onto a VM runs on it', getNode('ctf').host === 'vmf');
    undo();
    // A guest let go on its own host is set beside it too: nothing else changes.
    undoAt = _undoStack.length;
    drag('vm1', 0, 200);
    ok('a guest let go on its own host: still on it, set beside it, one undo step',
      getNode('vm1').host === 'hv' && getNode('vm1').x === 100 && getNode('vm1').y === 200 && _undoStack.length === undoAt + 1, json([getNode('vm1').x, getNode('vm1').y]));
    undo();
    // A guest dragged elsewhere only moves.
    drag('vm1', -300, 500);
    ok('a guest dragged off its host only moves: it still runs on it', getNode('vm1').host === 'hv' && getNode('vm1').x === -300);
    undo();

    // Into a rack without a host: a VM takes no units, so the toast points at
    // Runs on, not at Open rack (js/rackview.js refuses units for it).
    {
      let said = '';
      batch(() => {
        state.groups.push({ id: 'rk', name: 'Rack A', kind: 'rack', uHeight: 24 });
        said = applyGroupDrop({ target: { gid: 'rk', fold: false }, changes: [getNode('vmf'), getNode('pc')] });
        save();
      });
      ok('a VM let go into a rack: the toast says it takes no units and where to set its host',
        /A VM or a container takes no units: it is where the device it runs on is\. Set that in its Runs on\./.test(said)
        && /It has no units in the rack yet: Open rack places it\./.test(said), said);
      undo();
      ok('two VMs: the plural', /VMs and containers take no units/.test((() => { let w = ''; batch(() => {
        state.groups.push({ id: 'rk', name: 'Rack A', kind: 'rack', uHeight: 24 });
        w = applyGroupDrop({ target: { gid: 'rk', fold: false }, changes: [getNode('vmf'), getNode('vmg')] }); save(); }); undo(); return w; })()));
      ok('undone: no rack, the VMs in no group', !groupById('rk') && !getNode('vmf').group && !getNode('vmg').group);
    }

    // ---- read-only and the words ----
    state.readOnly = true;
    drag('vmf', 600, 200);
    ok('read-only: nothing runs on anything new', !getNode('vmf').host);
    clickBadge('hv');
    ok('read-only: folding is still allowed (a view)', isHostFolded('hv'));
    clickBadge('hv');
    state.readOnly = false;

    setLocale('es'); applyStaticI18n(); renderCanvasOnly();
    drag('vmf', 600, 200, true);
    ok('es: the label', cue() && cue().textContent === 'Se ejecuta en HV2', cue() && cue().textContent);
    up(600, 200);
    ok('es: the toast', /VMF se ejecuta ahora en HV2\./.test(toast()), toast());
    undo();
    ok('es: the badge\'s words', /3 dispositivos se ejecutan en él/.test(badge('hv').querySelector('title').textContent));
    setLocale('en'); applyStaticI18n(); renderCanvasOnly();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    state.readOnly = false;
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
