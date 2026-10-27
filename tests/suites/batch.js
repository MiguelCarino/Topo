// Transactions (R4): one operation is one undo step and one redraw, typing is
// one step per field edit, and the history entry is written at most once a
// second once its burst budget is spent, but never loses the last edit — not
// to a reload, and not to Back/Forward inside the tab. Everything here drives the real
// save()/undo()/batch() and the real sidebar fields, and counts the real
// history.replaceState calls, because the bug this replaced was a count: one
// address and one gateway spent 16 of the 100 undo steps, and WebKit stops
// honouring replaceState after about 100 calls in 30 seconds.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const undoBtn = () => document.getElementById('undoBtn');
  const redoBtn = () => document.getElementById('redoBtn');
  // How many undo steps the timeline holds, read off the button the visitor sees.
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  const fresh = (nodes = []) => {
    state.nodes = nodes.map(normalizeLoadedNode); state.links = []; state.annotations = [];
    select(null, null); initHistory();
  };
  // The budget, refilled or emptied instead of waited out: the suite runs on
  // an 8-second virtual-time budget. Real waits below prove the timer.
  const gapOver = () => { flushLiveDoc(); _liveTokens = LIVE_BURST; _liveTokensAt = Date.now(); };
  const dry = () => { flushLiveDoc(); _liveTokens = 0; _liveTokensAt = Date.now(); };
  const blurAll = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };
  const typeInto = (el, text) => {
    el.focus();
    for (let i = 1; i <= text.length; i++) { el.value = text.slice(0, i); el.dispatchEvent(new Event('input', { bubbles: true })); }
  };
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);

  // ---- batch(): one save and one redraw for the whole operation ----
  fresh();
  const realRender = window.renderCanvasOnly;
  let renders = 0;
  // Counted only when it really draws: inside the batch it is asked, and holds.
  window.renderCanvasOnly = function () { if (!_batchDepth) renders++; return realRender.apply(this, arguments); };
  try {
    batch(() => { spawnNode('pc'); spawnNode('pc'); spawnNode('server'); });
  } finally { window.renderCanvasOnly = realRender; }
  ok('three spawns in one batch are one undo step', state.nodes.length === 3 && steps() === 1, `${state.nodes.length} nodes, ${steps()} steps`);
  // select() redraws for the sidebar's sake on its own; what matters is that
  // the per-spawn redraws were held and ran once.
  ok('and the canvas is drawn once, when the batch ends', renders === 1, `${renders} renders`);
  ok('and every spawned device is on it', state.nodes.every((n) => document.getElementById(`ui-node-${n.id}`)));
  undo();
  ok('one undo takes all three back', state.nodes.length === 0, `${state.nodes.length} left`);

  fresh();
  spawnNode('pc'); spawnNode('pc');
  ok('outside a batch each spawn is still its own step', steps() === 2, `${steps()} steps`);

  fresh();
  batch(() => { spawnNode('pc'); batch(() => { spawnNode('pc'); spawnNode('pc'); }); ok('a nested batch holds the save until the outer one ends', steps() === 0, `${steps()}`); });
  ok('and folds into it: one step', steps() === 1 && state.nodes.length === 3, `${steps()} steps`);

  fresh();
  let threw = '';
  try { batch(() => { spawnNode('pc'); throw new Error('boom'); }); } catch (e) { threw = e.message; }
  ok('a batch that throws passes the error on', threw === 'boom');
  ok('and still saves what it changed', steps() === 1 && state.nodes.length === 1 && JSON.parse(liveDocJson()).nodes.length === 1);
  ok('and is not left open', (() => { spawnNode('pc'); return steps() === 2; })(), `${steps()} steps`);

  // ---- The operations that do many things at once ----
  fresh();
  const blockKey = Object.keys(SNIPPETS).find((k) => SNIPPETS[k].nodes.length > 1);
  insertBlock(builtinBlock(blockKey));
  ok(`stamping a block (${blockKey}, ${SNIPPETS[blockKey].nodes.length} devices) is one undo step`, steps() === 1, `${steps()} steps`);
  undo();
  ok('and one undo takes the whole block back', state.nodes.length === 0);

  fresh([{ id: 'r', type: 'router', name: 'R', x: 13, y: 7, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] },
         { id: 'a', type: 'pc', name: 'A', x: 900, y: 40, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.2/24' }] },
         { id: 'b', type: 'pc', name: 'B', x: -300, y: 600, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.3/24' }] }]);
  tidyLayout();
  ok('Tidy is one undo step', steps() === 1, `${steps()} steps`);
  // There is no Untidy any more: Undo is the way back, and a second press
  // tidies again rather than restoring a layout it kept on the side.
  const tidied = JSON.stringify(state.nodes.map((n) => [n.id, n.x, n.y]));
  tidyLayout();
  ok('a second Tidy is not an Untidy', JSON.stringify(state.nodes.map((n) => [n.id, n.x, n.y])) === tidied && steps() === 1,
     `${steps()} steps`);
  ok('the button keeps saying Tidy', /Tidy/.test(document.getElementById('tidyBtn').textContent)
     && !/Untidy/.test(document.getElementById('tidyBtn').textContent) && typeof invalidateTidy === 'undefined');
  undo();
  ok('and one undo puts every device back', getNode('a').x === 900 && getNode('b').y === 600 && getNode('r').x === 13);

  // ---- Typing: one step per field edit ----
  fresh([{ id: 'p', type: 'pc', name: 'Desk', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }]);
  select('p', 'node');
  const gw = document.getElementById('propGw');
  typeInto(gw, '192.168.10.1');
  ok('each keystroke reaches the model at once', getNode('p').gw === '192.168.10.1');
  ok('the undo button already offers the typing', steps() === 1 && !undoBtn().disabled, `${steps()} steps`);
  gw.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  ok('leaving the field files twelve keystrokes as one step', steps() === 1, `${steps()} steps`);
  const ip = [...document.querySelectorAll('#ifaceListContainer input.if-ip')][0];
  typeInto(ip, '192.168.10.20/24');
  ip.dispatchEvent(new Event('change', { bubbles: true }));
  ok('an address and a gateway are two steps, not 28', steps() === 2, `${steps()} steps`);
  undo();
  ok('undo takes the address back whole', getNode('p').interfaces[0].ip === '' && getNode('p').gw === '192.168.10.1',
     `${getNode('p').interfaces[0].ip} / ${getNode('p').gw}`);
  undo();
  ok('and then the gateway', getNode('p').gw === '', getNode('p').gw);

  // Undo straight out of a field: the typing is the newest step and is what goes.
  fresh([{ id: 'q', type: 'pc', name: 'Front', x: 0, y: 0, interfaces: [] }]);
  getNode('q').os = 'Linux'; save();
  select('q', 'node');
  typeInto(document.getElementById('propName'), 'Reception');
  ok('typing is not lost to an undo pressed before the field was left', (undo(), getNode('q').name === 'Front' && getNode('q').os === 'Linux'),
     `${getNode('q').name} / ${getNode('q').os}`);

  // Typing, then a different edit before the field is left: two steps, in order.
  fresh([{ id: 'w', type: 'pc', name: 'Lab', x: 0, y: 0, interfaces: [] }]);
  select('w', 'node');
  typeInto(document.getElementById('propOs'), 'Win');
  getNode('w').x = 400; save();
  ok('a typed edit and the edit after it stay two steps', steps() === 2, `${steps()} steps`);
  undo();
  ok('the later one is undone first', getNode('w').x === 0 && getNode('w').os === 'Win');
  undo();
  ok('then the typing', getNode('w').os === '');

  // Idle: half a second without a keystroke files it on its own.
  fresh([{ id: 'i', type: 'pc', name: 'Idle', x: 0, y: 0, interfaces: [] }]);
  select('i', 'node');
  typeInto(document.getElementById('propNotes'), 'Rack 3');
  await wait(TYPING_IDLE_MS + 150);
  ok('half a second idle files the typing without leaving the field', _undoStack.length === 1 && _typingJson === null,
     `${_undoStack.length} on the stack`);
  typeInto(document.getElementById('propNotes'), 'Rack 3, U12');
  ok('and typing on starts the next step', steps() === 2);
  blurAll(); await wait(0);

  // Redo is ended by a fresh edit, and typing is one even before it is filed.
  fresh([{ id: 'z', type: 'pc', name: 'Z0', x: 0, y: 0, interfaces: [] }]);
  getNode('z').x = 40; save(); undo();
  ok('there is a redo future', !redoBtn().disabled);
  select('z', 'node');
  typeInto(document.getElementById('propName'), 'Z1');
  ok('typing switches redo off at once', redoBtn().disabled);
  redo();
  ok('and redo cannot bring the old future back over it', getNode('z').name === 'Z1' && getNode('z').x === 0);
  blurAll();

  // A read-only document is put back at once, not after the idle wait.
  // (docpath.js owns the read-only rules; this is only the timing.)
  fresh([{ id: 'ro', type: 'pc', name: 'Kept', x: 0, y: 0, interfaces: [] }]);
  replaceDocument({ v: DOC_VERSION + 1, nodes: [{ id: 'ro', type: 'pc', name: 'Kept', x: 0, y: 0, interfaces: [] }], links: [] }, { origin: 'file' });
  select('ro', 'node');
  const roName = document.getElementById('propName');
  roName.value = 'Changed'; roName.dispatchEvent(new Event('input', { bubbles: true }));
  ok('typing into a read-only document is put back immediately', getNode('ro') && getNode('ro').name === 'Kept' && _typingJson === null,
     getNode('ro') && getNode('ro').name);
  blurAll();
  replaceDocument(EMPTY_DOC, { origin: 'new' });

  // ---- The live document: throttled, never stale, flushed on the way out ----
  fresh([{ id: 'h', type: 'pc', name: 'H0', x: 0, y: 0, interfaces: [] }]);
  gapOver();
  const realReplace = window.history.replaceState;
  let writes = 0;
  window.history.replaceState = function () { writes++; return realReplace.apply(window.history, arguments); };
  try {
    for (let i = 1; i <= 60; i++) { getNode('h').name = `H${i}`; save(); }
    ok(`60 saves in a burst write the entry ${LIVE_BURST} times, then wait`, writes === LIVE_BURST, `${writes} writes`);
    ok('the newest document waits for its turn', _livePending && JSON.parse(_livePending.json).nodes[0].name === 'H60');
    await wait(LIVE_REFILL_MS + 100);
    ok('and goes in after the refill on its own', writes === LIVE_BURST + 1 && JSON.parse(window.history.state.topoDoc).nodes[0].name === 'H60',
       `${writes} writes`);
    // WebKit's limit is about 100 in 30 s: the burst plus 30 s of refill stays under it.
    ok('the budget stays under WebKit\'s limit', LIVE_BURST + 30000 / LIVE_REFILL_MS <= 90, `${LIVE_BURST} + ${30000 / LIVE_REFILL_MS}`);

    // With budget left, an edit is in the entry at once, as before the budget.
    gapOver();
    getNode('h').name = 'At once'; save();
    ok('an ordinary edit is in the entry at once', _livePending === null && JSON.parse(window.history.state.topoDoc).nodes[0].name === 'At once');
    // A save that changes nothing the entry holds spends no call.
    const w0 = writes; save(); save();
    ok('a save with nothing new for the entry makes no call', writes === w0, `${writes - w0} calls`);

    // pagehide: a reload or a closed tab with a write still waiting keeps the last edit.
    dry();
    getNode('h').name = 'Last keystroke'; save();
    ok('with the budget spent, an edit waits', JSON.parse(window.history.state.topoDoc).nodes[0].name !== 'Last keystroke');
    window.dispatchEvent(new Event('pagehide'));
    ok('pagehide writes it', JSON.parse(window.history.state.topoDoc).nodes[0].name === 'Last keystroke');

    // Typing follows into the entry keystroke by keystroke; only the undo step waits.
    gapOver();
    select('h', 'node');
    typeInto(document.getElementById('propName'), 'Typed');
    ok('typing is in the entry before the field is left', JSON.parse(window.history.state.topoDoc).nodes[0].name === 'Typed'
       && _typingJson !== null, JSON.parse(window.history.state.topoDoc).nodes[0].name);
    const w1 = writes;
    window.dispatchEvent(new Event('pagehide'));
    ok('pagehide files a field still being typed into, with no second write', _typingJson === null && writes === w1, `${writes - w1} calls`);
    blurAll();

    // visibilitychange to hidden: a backgrounded mobile tab may never see pagehide.
    dry();
    getNode('h').name = 'Backgrounded'; save();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
    ok('going to the background writes it too', JSON.parse(window.history.state.topoDoc).nodes[0].name === 'Backgrounded');

    // Back/Forward: a write still waiting belongs to the entry that was left.
    // It is never written into the entry landed on, and is put back into its
    // own entry when Forward returns there. Real history traversal, so the
    // entries are really different ones.
    const navigated = () => new Promise((r) => window.addEventListener('popstate', () => setTimeout(r, 60), { once: true }));
    gapOver();
    getNode('h').name = 'three'; save();
    const homeEid = window.history.state.eid;
    dry();
    getNode('h').name = 'four'; save();
    ok('the edit before Back is waiting', _livePending && _livePending.eid === homeEid);
    const other = JSON.stringify({ v: DOC_VERSION, nodes: [{ id: 'o', type: 'pc', name: 'Other', x: 0, y: 0, interfaces: [] }], links: [] });
    // The entry before this one becomes another network's: Back lands there.
    const homeState = window.history.state;
    window.history.replaceState({ topoDoc: other, lib: null, eid: 'other-entry' }, '', window.location.pathname + window.location.search);
    window.history.pushState(homeState, '', window.location.pathname + window.location.search);
    let back = navigated(); window.history.back(); await back;
    const landed = JSON.parse(window.history.state.topoDoc);
    ok('after Back, the entry landed on keeps its own network', landed.nodes.length === 1 && landed.nodes[0].name === 'Other',
       String(window.history.state.topoDoc).slice(0, 60));
    ok('and that network is the one on screen', !!getNode('o') && !getNode('h'));
    ok('the waiting edit is parked for its entry, not lost', _liveParked.has(homeEid) && _livePending === null);
    let fwd = navigated(); window.history.forward(); await fwd;
    ok('Forward brings the edit made just before Back', getNode('h') && getNode('h').name === 'four'
       && JSON.parse(window.history.state.topoDoc).nodes[0].name === 'four', getNode('h') && getNode('h').name);
    ok('and it is no longer parked', !_liveParked.has(homeEid));

    // The verifier's case: type into a field, Back straight from it, Forward.
    gapOver();
    select('h', 'node');
    typeInto(document.getElementById('propName'), 'SecondEdited');
    typeInto(document.getElementById('propOs'), 'OSB');
    back = navigated(); window.history.back(); await back;
    fwd = navigated(); window.history.forward(); await fwd;
    ok('typing straight into Back and Forward is kept', getNode('h') && getNode('h').name === 'SecondEdited' && getNode('h').os === 'OSB',
       getNode('h') && `${getNode('h').name} / ${getNode('h').os}`);
    // And with the budget spent while typing.
    select('h', 'node');
    dry();
    typeInto(document.getElementById('propNotes'), 'dry run');
    back = navigated(); window.history.back(); await back;
    fwd = navigated(); window.history.forward(); await fwd;
    ok('typing held by a spent budget survives Back and Forward too', getNode('h') && getNode('h').notes === 'dry run',
       getNode('h') && getNode('h').notes);
    blurAll();
    gapOver();
    fresh([{ id: 'h', type: 'pc', name: 'H0', x: 0, y: 0, interfaces: [] }]);

    // A browser refusing the write (WebKit's throttle, a size limit) is retried, not lost.
    gapOver();
    let refuse = 1;
    window.history.replaceState = function () {
      writes++;
      if (refuse-- > 0) throw new DOMException('Attempt to use history.replaceState() more than 100 times per 30 seconds', 'SecurityError');
      return realReplace.apply(window.history, arguments);
    };
    const warn = console.warn; console.warn = () => {};
    let saveThrew = false;
    try { getNode('h').name = 'Refused once'; save(); } catch (e) { saveThrew = true; } finally { console.warn = warn; }
    ok('a refused write does not break the edit', !saveThrew && getNode('h').name === 'Refused once');
    ok('and is kept to try again', _livePending && JSON.parse(_livePending.json).nodes[0].name === 'Refused once');
    await wait(LIVE_REFILL_MS * 2 + 150);
    ok('which lands once the browser takes it', _livePending === null && JSON.parse(window.history.state.topoDoc).nodes[0].name === 'Refused once');
  } finally { window.history.replaceState = realReplace; }

  // The card a pending write belongs to is the one open when it was saved.
  gapOver();
  getNode('h').name = 'first'; save();
  state.libraryId = 'card-1'; getNode('h').name = 'second'; save();
  state.libraryId = null;
  flushLiveDoc();
  ok('a held write keeps the card it was saved under', window.history.state.lib === 'card-1');

  // ---- The setup intake (Add devices, new network): one build, no steps ----
  const wizardAt = state.nodes.length;
  openAddDevices({ mode: 'new' });
  const firstCount = document.querySelector('#addRows .add-count');
  if (firstCount) firstCount.value = '4';
  applyAddDevices();
  ok('the intake builds its devices', state.nodes.length >= 5, `${state.nodes.length} (was ${wizardAt})`);
  ok('and the build is the floor of the timeline, not a step per device', steps() === 0, `${steps()} steps`);

  // ---- Add devices into the open network: one step, however many ----
  const addAt = state.nodes.length, addSteps = steps();
  addDevices({ items: [{ type: 'voip', count: 40 }], pattern: 'Phone-{n:02}', targetId: state.nodes.find((n) => n.type === 'switch' || n.type === 'router').id });
  ok('forty devices added at once are one undo step', state.nodes.length === addAt + 40 && steps() === addSteps + 1, `${steps() - addSteps} steps`);
  undo();
  ok('and one Undo takes all forty back', state.nodes.length === addAt);
  state.settings.advanced = true; saveSettings(); applyProfile();

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 50); });
