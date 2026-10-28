// A new group from two devices, round 3 item 1 (Review-Packs/Topo-groups.md,
// "Round 3"; js/groupmap.js "A new group from two devices", the release in
// js/app.js, the question in js/dialog.js askPromptPick). The gestures are the
// real handlers': a press on the device's own element, the window's mousemove
// and mouseup, and for a finger, touchstart, touchmove and touchend on the
// card it came down on. What is held here:
//   1. a device let go on another device in no group: the other ringed in its
//      own way and "New group with …" at the pointer while over it; on the
//      answer, a new group of both, with the name and kind given, the one
//      dragged set beside the other, all of it one undo step; Cancel is the
//      move alone, one step, left where it was let go;
//   2. the question: its title, its words, the name ("Group 1", the next
//      free one) and the kind (guessed: a group of one's own at the top, a
//      rack inside a room for rack gear, else a group of one's own) and the
//      real modal, where the name follows the kind until it is retyped;
//   3. both in the same group: the new group goes inside it; a device in
//      another group is no partner (its frame takes the drop); one in no
//      group is, from inside a group (the new group is at the top); two
//      devices in a rack are not offered one (it sits in units);
//   4. a VM let go on a host runs on it, asked nothing; on a device that is no
//      host, it is offered a group; a guest is no partner; a device let go
//      beside another card, not on it, only moves;
//   5. a selection goes in together; a document changed under the question
//      is not written into; read-only offers nothing;
//   6. a finger's drag does all of it as a mouse's does, and a finger's tap
//      drags nothing; the words are translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // The question, answered by `answer` (a function of the request) unless a
  // test drives the real modal; every request is kept to be read.
  let answer = () => null, asked = [];
  const responder = (req) => { asked.push(req); return answer(req); };
  const heldResponder = setDialogResponder(responder);

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  // Three devices in no group, a server room with two servers and a PC, a
  // rack in it, a lab of its own, and a hypervisor with a VM on it and one
  // VM on nothing.
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('a', 'pc', { x: 0, y: 0 }),
      N('b', 'pc', { x: 300, y: 0 }),
      N('c', 'switch', { x: 600, y: 0 }),
      N('s1', 'server', { x: 0, y: 400, group: 'room' }),
      N('s2', 'server', { x: 300, y: 400, group: 'room' }),
      N('p1', 'pc', { x: 600, y: 400, group: 'room' }),
      N('r1', 'server', { x: 0, y: 800, group: 'rk', rackU: 10 }),
      N('r2', 'server', { x: 300, y: 800, group: 'rk', rackU: 20 }),
      N('l1', 'pc', { x: 1200, y: 0, group: 'lab' }),
      N('hv', 'server', { x: 900, y: 400 }),
      N('vmh', 'vm', { x: 1200, y: 400, host: 'hv' }),
      N('vm1', 'vm', { x: 900, y: 0 })
    ],
    links: [],
    groups: [
      { id: 'room', name: 'Server room', kind: 'room' },
      { id: 'rk', name: 'Rack A', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'lab', name: 'Lab', kind: 'custom' }
    ] });
  const open = () => { replaceDocument(site(), { origin: 'file', docId: 'doc-pair' }); state.camera.zoom = 1; state.camera.x = 300; state.camera.y = 300; applyCamera(); renderCanvasOnly(); };
  const nodeEl = (id) => el(`ui-node-${id}`);
  const cue = () => document.querySelector('#layer-nodes > .grp-drop-cue');
  const ring = (id) => !!(nodeEl(id) && nodeEl(id).querySelector('.pair-drop-ring'));
  const toast = () => el('topoToast').textContent;
  const at = (x, y, extra) => {
    const rect = el('networkCanvas').getBoundingClientRect();
    return Object.assign({ clientX: rect.left + state.camera.x + x * state.camera.zoom, clientY: rect.top + state.camera.y + y * state.camera.zoom, bubbles: true, button: 0 }, extra || {});
  };
  const press = (id, extra) => { const n = getNode(id); nodeEl(id).dispatchEvent(new MouseEvent('mousedown', at(n.x, n.y, extra))); };
  const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', at(x, y)));
  const up = (x, y) => window.dispatchEvent(new MouseEvent('mouseup', at(x, y)));
  const drag = (id, x, y, hold) => {
    const n = getNode(id);
    press(id);
    move((n.x + x) / 2, (n.y + y) / 2);
    move(x, y);
    if (!hold) up(x, y);
  };
  // Let go, and the question answered (the release asks; the answer is in a
  // microtask, the write after it).
  const dropAt = async (x, y) => { up(x, y); await tick(); await tick(); };
  const newGroups = () => state.groups.filter((g) => !['room', 'rk', 'lab'].includes(g.id));
  const pos = (id) => json([getNode(id).x, getNode(id).y]);

  try {
    setView('map');
    open();

    // ---- 1: two devices in no group ----
    answer = () => ({ value: 'Desk pair', pick: 'custom' });
    asked = [];
    let undoAt = _undoStack.length;
    drag('a', 300, 0, true);
    ok('over another device: it is ringed in its own way', ring('b') && !nodeEl('b').querySelector('.host-drop-ring'));
    ok('and the label says what will happen', cue() && cue().classList.contains('pair-drop-cue') && cue().textContent === 'New group with B', cue() && cue().textContent);
    ok('no frame is lit for it', !document.querySelector('#layer-groups .grp-drop'));
    await dropAt(300, 0);
    let made = newGroups();
    ok('let go, it asks once', asked.length === 1 && asked[0].kind === 'prompt' && !!asked[0].pick, json(asked.map((r) => r.kind)));
    ok('the answer makes a group of both, named and of the kind given, at the top', made.length === 1 && made[0].name === 'Desk pair' && made[0].kind === 'custom' && !made[0].parent, json(made));
    ok('both are in it', made.length === 1 && getNode('a').group === made[0].id && getNode('b').group === made[0].id);
    ok('the one dragged is set beside the other, not on it', pos('a') === json([400, 0]), pos('a'));
    ok('the move and the group are one undo step', _undoStack.length === undoAt + 1, `${_undoStack.length - undoAt} steps`);
    ok('said in a toast', /2 devices are in Desk pair now\./.test(toast()), toast());
    ok('its frame is drawn round them', !!el('layer-groups').querySelector(`.grp-frame[data-grp="${made[0] && made[0].id}"]`));
    undo();
    ok('undone: no group, and it is back where it was', !newGroups().length && !getNode('a').group && !getNode('b').group && pos('a') === json([0, 0]), pos('a'));

    // ---- 2: the question ----
    const q = asked[0];
    ok('the question is titled and names both', q.title === 'New group' && /Make a new group of A and B\?/.test(q.message), json([q.title, q.message]));
    ok('it says what Cancel does', /Cancel only moves A\./.test(q.message), q.message);
    ok('the name is the next free one, the kind a group of one\'s own', q.value === 'Group 1' && q.pick.value === 'custom', json([q.value, q.pick.value]));
    ok('every kind is offered, each with the name it would suggest', json(q.pick.options.map((o) => o.id)) === json(GROUP_KINDS)
      && q.pick.options.find((o) => o.id === 'rack').text === 'Rack 1' && q.pick.options.find((o) => o.id === 'room').text === 'Room 1', json(q.pick.options));

    // Cancel: the move alone.
    answer = () => null;
    undoAt = _undoStack.length;
    drag('a', 300, 0);
    await tick(); await tick();
    ok('Cancel: no group, an ordinary move, left where it was let go', !newGroups().length && !getNode('a').group && pos('a') === json([300, 0]), pos('a'));
    ok('one undo step', _undoStack.length === undoAt + 1);
    undo();
    ok('undone, back', pos('a') === json([0, 0]));

    // The real modal: the name follows the kind until it is retyped.
    setDialogResponder(null);
    drag('a', 300, 0);
    await tick();
    const input = el('topoAskInput'), pick = el('topoAskPick');
    ok('the real modal shows the name and the kind', !el('topoAsk').hidden && !input.hidden && !el('topoAskPickRow').hidden
      && input.value === 'Group 1' && pick.value === 'custom' && pick.options.length === 5, json([input.value, pick.value]));
    ok('the kind is labelled', el('topoAskPickLabel').textContent === 'Kind');
    pick.value = 'room'; pick.dispatchEvent(new Event('change', { bubbles: true }));
    ok('another kind retypes the suggested name', input.value === 'Room 1', input.value);
    input.value = 'Reception';
    pick.value = 'floor'; pick.dispatchEvent(new Event('change', { bubbles: true }));
    ok('a name typed in stays when the kind changes', input.value === 'Reception', input.value);
    [...el('topoAskFoot').querySelectorAll('button')].find((b) => b.textContent === 'Make group').click();
    await tick(); await tick();
    made = newGroups();
    ok('Make group makes it as shown', made.length === 1 && made[0].name === 'Reception' && made[0].kind === 'floor', json(made));
    undo();
    const plain = askConfirm('?');
    await tick();
    ok('the list is hidden again for a plain question', !el('topoAsk').hidden && el('topoAskPickRow').hidden);
    [...el('topoAskFoot').querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    await plain;
    setDialogResponder(responder);
    answer = () => null;

    // ---- 3: groups ----
    answer = (req) => 'Inner';   // a string: the kind left as guessed
    asked = [];
    drag('s1', 300, 400, true);
    ok('two servers in a room: the label names the room', cue() && cue().textContent === 'New group with S2, inside Server room', cue() && cue().textContent);
    await dropAt(300, 400);
    made = newGroups();
    ok('the question says where it goes, and guesses a rack for servers in a room', /It goes inside Server room\./.test(asked[0].message) && asked[0].pick.value === 'rack' && asked[0].value === 'Rack 1', json([asked[0].message, asked[0].pick.value, asked[0].value]));
    ok('the new group is inside the room', made.length === 1 && made[0].parent === 'room' && made[0].kind === 'rack' && made[0].name === 'Inner', json(made));
    ok('both are in it', getNode('s1').group === made[0].id && getNode('s2').group === made[0].id);
    ok('a rack: the toast says they have no units yet', /no units in the rack yet/.test(toast()), toast());
    undo();
    ok('undone: in the room again', getNode('s1').group === 'room' && !newGroups().length);
    asked = [];
    answer = () => null;
    drag('p1', 300, 400);
    await tick(); await tick();
    ok('a PC with a server in a room: a group of one\'s own is guessed', asked.length === 1 && asked[0].pick.value === 'custom', asked[0] && asked[0].pick.value);
    undo();

    asked = [];
    drag('a', 600, 400, true);
    ok('a device in another group is no partner: its frame is the target', !ring('p1') && cue() && !cue().classList.contains('pair-drop-cue') && /Server room/.test(cue().textContent), cue() && cue().textContent);
    await dropAt(600, 400);
    ok('let go, it is in that group, and nothing was asked', getNode('a').group === 'room' && !asked.length && !newGroups().length);
    undo();

    answer = () => 'Top';
    drag('p1', 600, 0);
    await tick(); await tick();
    made = newGroups();
    ok('from inside a group onto one in none: the new group is at the top', made.length === 1 && !made[0].parent && getNode('p1').group === made[0].id && getNode('c').group === made[0].id, json(made));
    undo();

    asked = [];
    drag('r1', 300, 800, true);
    ok('two devices in a rack: no new group is offered', !ring('r2') && !(cue() && cue().classList.contains('pair-drop-cue')));
    await dropAt(300, 800);
    ok('let go, it only moves, still in the rack, nothing asked', getNode('r1').group === 'rk' && !asked.length && !newGroups().length);
    undo();

    // ---- 4: hosts, guests and near misses ----
    asked = [];
    drag('vm1', 900, 400, true);
    ok('a VM over a host: the host\'s cue, not a new group\'s', !!nodeEl('hv').querySelector('.host-drop-ring') && !ring('hv') && cue() && cue().textContent === 'Runs on HV', cue() && cue().textContent);
    await dropAt(900, 400);
    ok('let go, it runs on it, and nothing was asked', getNode('vm1').host === 'hv' && !asked.length);
    undo();
    drag('vm1', 600, 0, true);
    ok('a VM over a switch (no host): a new group is offered', ring('c') && cue() && cue().textContent === 'New group with C', cue() && cue().textContent);
    await dropAt(600, 0);
    ok('and asked', asked.length === 1);
    undo();
    asked = [];
    drag('a', 1200, 400, true);
    ok('a guest is no partner', !ring('vmh') && !(cue() && cue().classList.contains('pair-drop-cue')));
    await dropAt(1200, 400);
    ok('nothing asked', !asked.length);
    undo();
    drag('a', 340, 0, true);
    ok('let go beside a card, not on it: no new group', !ring('b') && !(cue() && cue().classList.contains('pair-drop-cue')));
    await dropAt(340, 0);
    ok('only moved, nothing asked', !asked.length && pos('a') === json([340, 0]), pos('a'));
    undo();

    // ---- 5: a set, a changed document, read-only ----
    answer = () => 'Trio';
    asked = [];
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    undoAt = _undoStack.length;
    drag('a', 600, 0);
    await tick(); await tick();
    made = newGroups();
    ok('a set let go on a device: "2 devices and C"', asked.length === 1 && /Make a new group of 2 devices and C\?/.test(asked[0].message) && /Cancel only moves them\./.test(asked[0].message), asked[0] && asked[0].message);
    ok('all three are in it, one undo step', made.length === 1 && ['a', 'b', 'c'].every((id) => getNode(id).group === made[0].id) && _undoStack.length === undoAt + 1);
    {
      const A = getNode('a'), B = getNode('b'), C = getNode('c');
      const clear = (p, r) => Math.abs(p.x - r.x) >= 90 || Math.abs(p.y - r.y) >= 100;
      ok('each set beside it, clear of it and of each other', clear(A, C) && clear(B, C) && clear(A, B), json([A.x, A.y, B.x, B.y]));
    }
    undo();
    select(null, null);

    answer = () => { state.nodes = state.nodes.filter((n) => n.id !== 'b'); return 'Gone'; };
    drag('a', 300, 0);
    await tick(); await tick();
    ok('the partner gone under the question: no group is made', !newGroups().length && !getNode('a').group);
    open();
    answer = () => 'X';

    asked = [];
    state.readOnly = true;
    drag('a', 300, 0);
    await tick(); await tick();
    ok('read-only: nothing moves, nothing is asked', !asked.length && pos('a') === json([0, 0]));
    state.readOnly = false;

    // ---- 6: a finger ----
    // Touch points on the card the finger came down on; the moves and the
    // lift go to that same element (a touch's target is where it started).
    const hasTouch = typeof Touch === 'function' && typeof TouchEvent === 'function';
    ok('this engine can make touch events', hasTouch);
    if (hasTouch) {
      const finger = (type, target, x, y) => {
        const p = at(x, y);
        const tp = new Touch({ identifier: 7, target, clientX: p.clientX, clientY: p.clientY });
        target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
          touches: type === 'touchend' ? [] : [tp], targetTouches: type === 'touchend' ? [] : [tp], changedTouches: [tp] }));
      };
      const fingerDrag = async (id, x, y) => {
        const n = getNode(id), card = nodeEl(id).querySelector('rect');
        finger('touchstart', card, n.x, n.y);
        finger('touchmove', card, n.x + 2, n.y + 1);          // inside the tap margin: nothing yet
        const still = pos(id);
        finger('touchmove', card, (n.x + x) / 2, (n.y + y) / 2);
        finger('touchmove', card, x, y);
        const seen = { still, ring: [...document.querySelectorAll('.pair-drop-ring')].map((r) => r.parentNode.id), cue: cue() && cue().textContent };
        finger('touchend', card, x, y);
        await tick(); await tick();
        return seen;
      };
      answer = () => ({ value: 'By hand', pick: 'room' });
      asked = [];
      undoAt = _undoStack.length;
      const seen = await fingerDrag('a', 300, 0);
      made = newGroups();
      ok('a finger within the tap margin moves nothing', seen.still === json([0, 0]), seen.still);
      ok('a finger\'s drag over a device: the same ring and label', json(seen.ring) === json(['ui-node-b']) && seen.cue === 'New group with B', json(seen));
      ok('let go, the same question and group, one undo step', asked.length === 1 && made.length === 1 && made[0].kind === 'room' && made[0].name === 'By hand'
        && getNode('a').group === made[0].id && getNode('b').group === made[0].id && _undoStack.length === undoAt + 1, json(made));
      undo();
      // A finger onto a host: the VM runs on it.
      answer = () => null;
      asked = [];
      await fingerDrag('vm1', 900, 400);
      ok('a finger drags a VM onto its host as a mouse does', getNode('vm1').host === 'hv' && !asked.length);
      undo();
      // A tap: the finger lifts where it came down, and nothing moves.
      const card = nodeEl('a').querySelector('rect');
      undoAt = _undoStack.length;
      finger('touchstart', card, 0, 0);
      finger('touchend', card, 0, 0);
      await tick();
      ok('a finger\'s tap drags nothing and files nothing', pos('a') === json([0, 0]) && _undoStack.length === undoAt && !isDraggingNode);
    }

    // ---- the words ----
    setLocale('es'); applyStaticI18n(); renderCanvasOnly();
    asked = [];
    answer = () => null;
    drag('a', 300, 0, true);
    ok('es: the label', cue() && cue().textContent === 'Grupo nuevo con B', cue() && cue().textContent);
    await dropAt(300, 0);
    ok('es: the question', asked[0] && asked[0].title === 'Grupo nuevo' && /¿Hacer un grupo nuevo con A y B\?/.test(asked[0].message) && asked[0].value === 'Grupo 1', asked[0] && json([asked[0].title, asked[0].message, asked[0].value]));
    undo();
    setLocale('en'); applyStaticI18n(); renderCanvasOnly();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    state.readOnly = false;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
