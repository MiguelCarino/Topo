// One lookup pass per render (js/model.js, withLookupPass) and the redraw
// coalescer (js/state.js, redrawCoalescer) the search box draws through.
// What is held here:
//   1. a nested pass over the same document reuses the open one, its indexes
//      and its diagnosis, so a render builds the diagnosis key once; a seed
//      is taken by a fresh pass only;
//   2. a swapped document (diagnoseDoc on a scratch copy) gets its own pass,
//      inside an open one too, and the same findings as outside one;
//   3. getLink in a pass answers as state.links.find (the first of two cables
//      with one id), and sees a cable csvWrite binds while its pass is open;
//   4. the memos keep only the document's own objects: a record a caller
//      built, changed inside one pass, gets the new answer;
//   5. assertNoLookupPass throws under TOPO_CHECKS, only logs without it, and
//      leaves the pass as it was;
//   6. withoutLookupPass hides the pass and puts it back, after a throw too;
//   7. the node panel with the render's diagnosis is the panel without it,
//      and the severities after an edit are a fresh diagnosis's;
//   8. a rack's cables in a pass are the plain answer, kept once per rack;
//   9. the coalescer: a leading draw, one more per window, a refused draw
//      kept, an ask during a draw kept; the search box through it, with
//      Enter, Esc and leaving the box acting on what is typed;
//  10. the top row is measured only when the bar changes shape.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const keyBuilds = (fn) => {
    const real = JSON.stringify;
    let n = 0;
    JSON.stringify = function (v) { if (v === state.nodes) n++; return real.apply(this, arguments); };
    try { fn(); } finally { JSON.stringify = real; }
    return n;
  };
  // Counts the calls to a global function while it is swapped for a spy.
  const spy = (name) => {
    const real = window[name];
    const s = { n: 0, restore: () => { window[name] = real; } };
    window[name] = function () { s.n++; return real.apply(this, arguments); };
    return s;
  };
  const dimmed = (id) => el(`ui-node-${id}`).classList.contains('q-dim');
  const lit = () => state.nodes.filter((n) => !dimmed(n.id)).map((n) => n.id).sort().join(',');
  const matches = (text) => { const q = parseQuery(text); return state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id).sort().join(','); };
  const input = () => el('queryInput');
  const typeOnly = (text) => { input().value = text; input().dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (k) => input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const held = { coalesce: window.TOPO_COALESCE, checks: window.TOPO_CHECKS };

  const D = (id, t, name, x, y, ifaces, extra) => Object.assign({ id, type: t, name, x, y, interfaces: ifaces }, extra || {});
  const I = (id, ip) => ({ id, name: id, ip });
  const lab = () => ({ v: DOC_VERSION,
    nodes: [
      D('r', 'router', 'Edge Router', 100, 100, [I('i1', '10.0.0.1/24')]),
      D('sw', 'switch', 'Core SW', 300, 100, [], { portCount: 8, group: 'rk', rackU: 20 }),
      D('srv', 'server', 'SRV', 300, 250, [I('i1', '10.0.0.10/24')], { group: 'rk', rackU: 10, rackHeight: 2 }),
      D('sw2', 'switch', 'Desk SW', 500, 100, [], { portCount: 8, group: 'rk2', rackU: 5 }),
      D('pc', 'pc', 'Reception', 500, 400, [I('i1', '10.0.0.50/24')], { gw: '10.0.0.1' }),
      // The same address as the PC: a duplicate-IP finding on both.
      D('dup', 'printer', 'Printer', 600, 400, [I('i1', '10.0.0.50/24')]),
      D('cam', 'camera', 'CAM-1', 700, 400, [I('i1', '10.0.0.60/24')])
    ],
    links: [
      { id: 'l1', source: 'sw', target: 'r', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'l2', source: 'sw', target: 'srv', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'l3', source: 'sw', target: 'sw2', sourceIface: 'p3', targetIface: 'p1' },
      { id: 'l4', source: 'sw2', target: 'pc', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'l5', source: 'sw2', target: 'dup', sourceIface: 'p3', targetIface: 'i1' }
    ],
    networks: [{ id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }],
    groups: [{ id: 'rk', name: 'Rack A', kind: 'rack', uHeight: 24 }, { id: 'rk2', name: 'Rack B', kind: 'rack', uHeight: 12 }] });

  try {
    window.TOPO_COALESCE = false;
    setView('map');
    replaceDocument(lab(), { origin: 'file' });
    setQuery('');
    renderCanvasOnly();

    // ---- 1: a nested pass reuses the open one ----
    const same = withLookupPass(() => {
      const p = lookupPass, d = currentDiagnosis();
      return withLookupPass(() => lookupPass === p && lookupPass.diag === d && currentDiagnosis() === d);
    });
    ok('a nested pass over the same document is the open pass, with its diagnosis', same === true);
    ok('and the outer pass is put back, then none', withLookupPass(() => { const p = lookupPass; withLookupPass(() => 0); return lookupPass === p; }) && lookupPass === null);
    setQuery('has:finding');
    const builds = keyBuilds(() => withLookupPass(() => { currentDiagnosis(); withLookupPass(currentDiagnosis); queryMapMatches(); reportModel(); }));
    ok('a render\'s diagnosis, query and report build the diagnosis key once', builds === 1, String(builds));
    const renderBuilds = keyBuilds(() => withLookupPass(drawCanvas));
    ok('so does the map\'s drawing with a has:finding search', renderBuilds === 1, String(renderBuilds));
    setQuery('');
    const seed = currentDiagnosis();
    ok('a fresh pass takes a seed as its diagnosis', withLookupPass(() => lookupPass.diag === seed && currentDiagnosis() === seed, seed));
    ok('a reused pass does not', withLookupPass(() => withLookupPass(() => lookupPass.diag, { findings: [], nodes: new Map() })) === null);

    // ---- 2: a swapped document gets its own pass ----
    const scratch = { nodes: cloneData(state.nodes).concat([D('only', 'pc', 'Scratch PC', 0, 0, [I('i1', '10.0.0.50/24')])]), links: cloneData(state.links), networks: cloneData(state.networks) };
    const realRun = window.runDiagnosis;
    let sawScratch = null, outerKept = null;
    window.runDiagnosis = function () { if (sawScratch === null) sawScratch = !!getNode('only'); return realRun.apply(this, arguments); };
    let inside, outside;
    try {
      inside = withLookupPass(() => { const p = lookupPass; const r = diagnoseDoc(scratch); outerKept = lookupPass === p && !getNode('only'); return r; });
      outside = diagnoseDoc(scratch);
    } finally { window.runDiagnosis = realRun; }
    ok('diagnoseDoc on a scratch copy inside an open pass reads the copy', sawScratch === true);
    ok('and the open pass is the live document\'s again afterwards', outerKept === true);
    const lines = (d) => d.findings.map((f) => f.line).join('|');
    ok('its findings are those of the same call outside a pass', lines(inside) === lines(outside) && /10\.0\.0\.50/.test(lines(inside)), lines(inside));

    // ---- 3: getLink ----
    const realLinks = state.links;
    const twin = Object.assign({}, realLinks[0], { target: 'cam', targetIface: 'i1' });
    state.links = realLinks.concat([twin]);
    let firstWins;
    try { firstWins = withLookupPass(() => getLink('l1')) === state.links.find((l) => l.id === 'l1') && withLookupPass(() => getLink('l1')) === realLinks[0]; }
    finally { state.links = realLinks; }
    ok('getLink in a pass is the first of two cables with one id, as find() is', firstWins === true);
    ok('and null for none', withLookupPass(() => getLink('nope')) === null);
    const csvDoc = { nodes: cloneData(state.nodes), links: cloneData(state.links), networks: cloneData(state.networks), groups: cloneData(state.groups), wifi: [] };
    const realBind = window.bindLink;
    let seenFirst = null;
    window.bindLink = function (l) { if (l.id === 'nl2') seenFirst = !!lookupPass && getLink('nl1') === csvDoc.links.find((x) => x.id === 'nl1'); return realBind.apply(this, arguments); };
    try {
      csvWrite({ ops: [{ link: { id: 'nl1', source: 'r', target: 'cam' } }, { link: { id: 'nl2', source: 'sw2', target: 'cam' } }] }, csvDoc);
    } finally { window.bindLink = realBind; }
    ok('a cable csvWrite binds inside its pass is found by getLink in it', seenFirst === true, String(seenFirst));
    ok('and both landed in the scratch document only', csvDoc.links.some((l) => l.id === 'nl2') && !state.links.some((l) => l.id === 'nl1'));

    // ---- 4: only the document's own objects are memoized ----
    const built = D('pc', 'pc', 'Copy of the PC', 0, 0, [I('i1', '10.0.0.70/24')]);
    const memoGate = withLookupPass(() => {
      const a = getValidIps(built).map((p) => p.ip.toString()).join(',');
      built.interfaces[0].ip = '10.0.0.71/24';
      const b = getValidIps(built).map((p) => p.ip.toString()).join(',');
      const g1 = effectiveGw(built);
      built.gw = '10.0.0.254';
      const g2 = effectiveGw(built);
      const x1 = explicitIface(built, 'i2');
      built.interfaces.push({ id: 'i2', name: 'eth1', ip: '' });
      const x2 = explicitIface(built, 'i2');
      return { a, b, g1, g2, x1, x2 };
    });
    ok('a caller-built record changed inside one pass gets the new addresses', memoGate.a === '10.0.0.70' && memoGate.b === '10.0.0.71', `${memoGate.a} / ${memoGate.b}`);
    ok('the new gateway', memoGate.g1 === '10.0.0.1' && memoGate.g2 === '10.0.0.254', `${memoGate.g1} / ${memoGate.g2}`);
    ok('and the new interface', memoGate.x1 === null && !!memoGate.x2);
    const docMemo = withLookupPass(() => getValidIps(getNode('pc')) === getValidIps(getNode('pc')) && effectiveOf(getNode('pc')) === effectiveOf(getNode('pc')));
    ok('the document\'s own devices are still asked once per pass', docMemo === true);

    // ---- 5: assertNoLookupPass ----
    const realErr = console.error;
    let logged = 0, threw = false, after = 'unset';
    console.error = () => { logged++; };
    try {
      window.TOPO_CHECKS = true;
      assertNoLookupPass('x');
      ok('outside a pass it says nothing', logged === 0);
      try { withLookupPass(() => assertNoLookupPass('x')); } catch (e) { threw = /x inside a lookup pass/.test(e.message); }
      after = lookupPass;
      ok('inside one it throws under TOPO_CHECKS', threw && logged === 1);
      ok('and the pass is gone afterwards', after === null);
      window.TOPO_CHECKS = false;
      let threwOff = false;
      try { withLookupPass(() => assertNoLookupPass('x')); } catch (e) { threwOff = true; }
      ok('without TOPO_CHECKS it only logs', !threwOff && logged === 2);
    } finally { console.error = realErr; window.TOPO_CHECKS = held.checks; }

    // ---- 6: withoutLookupPass ----
    const hidden = withLookupPass(() => { const p = lookupPass; const inner = withoutLookupPass(() => lookupPass); return inner === null && lookupPass === p; });
    ok('withoutLookupPass hides the open pass and puts it back', hidden === true);
    const afterThrow = withLookupPass(() => { const p = lookupPass; try { withoutLookupPass(() => { throw new Error('boom'); }); } catch (e) { /* expected */ } return lookupPass === p; });
    ok('after a throw too', afterThrow === true && lookupPass === null);

    // ---- 7: the node panel with the render's diagnosis ----
    select('pc', 'node');
    renderNodeDiagnostics(getNode('pc'));
    const plain = el('nodeDiagnosticsBody').innerHTML, plainPill = el('nodeDiagnosticsSummary').className;
    renderNodeDiagnostics(getNode('pc'), currentDiagnosis());
    ok('the node panel with the render\'s diagnosis is the panel without it', el('nodeDiagnosticsBody').innerHTML === plain && el('nodeDiagnosticsSummary').className === plainPill && plain.length > 0);
    refreshSelectedNodeDiagnostics(currentDiagnosis());
    ok('and so is the refresh', el('nodeDiagnosticsBody').innerHTML === plain);
    getNode('dup').interfaces[0].ip = '10.0.0.51/24'; save(); renderCanvasOnly();
    const fresh = diagnoseDoc(null), now = currentDiagnosis();
    const sev = state.nodes.filter((n) => (nodeDiagnosis(n, now).severity || '') !== ((fresh.nodes.get(n.id) || {}).severity || '')).map((n) => n.id);
    ok('after an edit and a render, every device\'s severity is a fresh diagnosis\'s', !sev.length && fresh.nodes.size === state.nodes.length, sev.join(','));
    select(null);

    // ---- 8: a rack's cables ----
    const ids = (list) => list.map((l) => l.id).join(',');
    const racks = state.groups.filter((g) => g.kind === 'rack');
    const plainRacks = racks.map((g) => ids(rackCableLinks(g)));
    const passRacks = withLookupPass(() => racks.map((g) => ids(rackCableLinks(g))));
    ok('a rack\'s cables in a pass are the plain answer, for every rack', plainRacks.join('|') === passRacks.join('|') && plainRacks[0].length > 0, plainRacks.join('|'));
    ok('and kept once per rack while the pass is open', withLookupPass(() => rackCableLinks(racks[0]) === rackCableLinks(racks[0]) && rackCableLinks(racks[0]) !== rackCableLinks(racks[1])));
    ok('but not over lists a caller passes', withLookupPass(() => rackCableLinks(racks[0], state.links.slice()) !== rackCableLinks(racks[0], state.links.slice())));

    // ---- 9: the coalescer ----
    let draws = 0, refuse = false, reenter = null;
    const co = redrawCoalescer(() => { draws++; if (reenter) { const f = reenter; reenter = null; f(); } if (refuse) return false; });
    window.TOPO_COALESCE = false;
    for (let i = 0; i < 5; i++) co.ask();
    ok('off, every ask draws at once', draws === 5 && !co.waiting());
    window.TOPO_COALESCE = true;
    draws = 0;
    for (let i = 0; i < 10; i++) co.ask();
    ok('on, the first ask draws at once and the rest wait', draws === 1 && co.waiting());
    await wait(REDRAW_WAIT_MS + 30);
    ok('the window\'s end draws once more', draws === 2 && !co.waiting(), String(draws));
    await wait(REDRAW_WAIT_MS + 30);
    ok('and an empty window draws nothing', draws === 2);
    co.ask(); co.ask(); co.flush();
    ok('flush draws what waits now', draws === 4 && !co.waiting(), String(draws));
    co.ask();
    ok('and closes the window: the next ask is a leading draw', draws === 5);
    co.ask(); co.cancel();
    await wait(REDRAW_WAIT_MS + 30);
    ok('cancel drops what waits', draws === 5 && !co.waiting());
    refuse = true;
    co.ask();
    ok('a refused draw stays waiting', draws === 6 && co.waiting());
    co.flush();
    ok('a flush while refused keeps it waiting', draws === 7 && co.waiting());
    refuse = false;
    await wait(REDRAW_WAIT_MS + 30);
    ok('and it is drawn once the canvas is back', draws === 8 && !co.waiting(), String(draws));
    co.cancel();
    await wait(REDRAW_WAIT_MS + 30);
    window.TOPO_COALESCE = false;
    draws = 0;
    reenter = () => { co.ask(); co.flush(); };
    co.ask();
    ok('an ask or a flush during a draw does not draw inside it', draws === 1 && co.waiting());
    await wait(REDRAW_WAIT_MS + 30);
    ok('it is drawn after, once', draws === 2 && !co.waiting(), String(draws));

    // The search box through it.
    replaceDocument(lab(), { origin: 'file' });
    setQuery(''); renderCanvasOnly();
    window.TOPO_COALESCE = true;
    let r = spy('renderCanvasOnly');
    const words = ['t', 'ty', 'typ', 'type', 'type:', 'type:p', 'type:pc', 'type:sw', 'type:swi', 'type:switch'];
    try { words.forEach(typeOnly); } finally { r.restore(); }
    ok('ten keystrokes in one task draw once before a flush', r.n === 1 && state.query === 't' && input().value === 'type:switch', `${r.n} draws, query ${state.query}`);
    r = spy('renderCanvasOnly');
    try { flushQuery(); } finally { r.restore(); }
    ok('and once at the flush', r.n === 1 && state.query === 'type:switch', String(r.n));
    ok('the lit devices are the final text\'s matches', lit() === matches('type:switch') && lit() === 'sw,sw2', lit());
    await wait(REDRAW_WAIT_MS + 30);
    const realFit = window.fitToView;
    let fitQuery = null, fitLit = null;
    window.fitToView = function () { fitQuery = state.query; fitLit = lit(); return realFit.apply(this, arguments); };
    try { words.slice(0, 4).forEach(typeOnly); typeOnly('cam-1'); key('Enter'); } finally { window.fitToView = realFit; }
    ok('Enter straight after the last keystroke zooms to its matches', fitQuery === 'cam-1' && fitLit === 'cam', `${fitQuery} / ${fitLit}`);
    await wait(REDRAW_WAIT_MS + 30);
    words.forEach(typeOnly);
    key('Escape');
    ok('Esc clears the dims and the count at once', state.query === '' && input().value === '' && !document.querySelector('#layer-nodes .q-dim') && el('queryCount').textContent === '');
    await wait(REDRAW_WAIT_MS + 30);
    ok('and nothing typed before it is drawn later', state.query === '' && input().value === '' && !document.querySelector('#layer-nodes .q-dim'));
    // The box's blur flushes only when the focus moves on within the page;
    // a tab or app switch (no page focus) leaves it to the timer.
    const realHasFocus = document.hasFocus;
    try {
      document.hasFocus = () => false;
      words.forEach(typeOnly);
      input().dispatchEvent(new Event('blur'));
      ok('a window switch does not redraw on the hide path', state.query === 't' && _queryDraw.waiting(), state.query);
      await wait(REDRAW_WAIT_MS + 30);
      ok('the timer draws it instead', state.query === 'type:switch' && !_queryDraw.waiting(), state.query);
      setQuery('');
      await wait(REDRAW_WAIT_MS + 30);
      document.hasFocus = () => true;
      words.forEach(typeOnly);
      input().dispatchEvent(new Event('blur'));
    } finally { document.hasFocus = realHasFocus; }
    ok('leaving the box draws what it holds', state.query === 'type:switch' && lit() === 'sw,sw2');
    await wait(REDRAW_WAIT_MS + 30);
    words.forEach(typeOnly);
    el('querySelectBtn').click();
    ok('Select matches acts on what is typed', state.query === 'type:switch' && selectedOf('node').sort().join(',') === 'sw,sw2', selectedOf('node').join(','));
    select(null);
    await wait(REDRAW_WAIT_MS + 30);
    typeOnly('type:sw');   // drawn at once, and the window opens
    typeOnly('type:pc');   // waiting
    ok('the box is ahead of the drawn query', state.query === 'type:sw' && _queryDraw.waiting(), state.query);
    renderCanvasOnly();   // another redraw while the box is ahead of state.query
    ok('a redraw while typing waits never puts the old text back', input().value === 'type:pc' && state.query === 'type:sw', input().value);
    flushQuery();
    ok('and the flush draws it', state.query === 'type:pc' && lit() === 'pc');
    select(null);
    await wait(REDRAW_WAIT_MS + 30);
    // A refused draw (the canvas on loan) leaves the buttons and Enter acting
    // on nothing, never on the old query.
    typeOnly('type:sw');
    typeOnly('type:pc');
    _borrowedCanvas++;
    const realFit2 = window.fitToView;
    let fits = 0;
    window.fitToView = function () { fits++; return realFit2.apply(this, arguments); };
    try {
      el('querySelectBtn').click();
      el('queryZoomBtn').click();
      key('Enter');
      ok('while the canvas is on loan nothing acts on the stale query', state.query === 'type:sw' && !selectedOf('node').length && fits === 0, `${state.query} / ${selectedOf('node').join(',')} / ${fits}`);
    } finally { _borrowedCanvas--; window.fitToView = realFit2; }
    ok('and the draw still waits', _queryDraw.waiting());
    el('querySelectBtn').click();
    ok('once it is back, Select acts on what is typed', state.query === 'type:pc' && selectedOf('node').join(',') === 'pc', selectedOf('node').join(','));
    select(null);
    window.TOPO_COALESCE = false;
    setQuery('');

    // ---- 10: the top row is measured when the bar changes shape ----
    renderCanvasOnly();
    let tb = spy('syncTopbarHeight');
    try { for (let i = 0; i < 10; i++) renderCanvasOnly(); } finally { tb.restore(); }
    ok('ten redraws with the same search measure the row 0 times', tb.n === 0, String(tb.n));
    tb = spy('syncTopbarHeight');
    try { setQuery('foo'); } finally { tb.restore(); }
    ok('a search starting measures it once', tb.n === 1, String(tb.n));
    ok('"lco:x" is a word it does not understand', parseQuery('lco:x').errors.length === 1);
    tb = spy('syncTopbarHeight');
    try { setQuery('lco:x'); } finally { tb.restore(); }
    ok('the "not understood" line appearing measures it once', tb.n === 1 && !el('queryError').classList.contains('hidden'), String(tb.n));
    tb = spy('syncTopbarHeight');
    try { setQuery('lco:y'); } finally { tb.restore(); }
    ok('another such word measures nothing', tb.n === 0, String(tb.n));
    setQuery('');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.TOPO_COALESCE = held.coalesce; window.TOPO_CHECKS = held.checks;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
