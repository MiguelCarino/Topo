// @realtime — what an edit costs at site scale (the speed plan's benchmark).
// A time budget means nothing on run.sh's virtual clock, so this runs on
// Playwright's real clock (tests/README.md). Times are printed, not leaned on:
//   cd tests && TOPO_ENGINES=chromium TOPO_PERF=1 node run-cross.mjs perfedit
//
// On the 400-device, 600-cable fixture (tests/fixtures/site400.js):
//   1. a click on a device without a move: one draw, no save, no serialize,
//      the diagnosis key built once, the timeline and the entry untouched;
//   2. a keystroke in the name field: one serialize, the key at most twice;
//      ten keystrokes with the coalescer forced on draw at most once before
//      the flush and once at it, the label as typed, one step at focusout;
//   3. a keystroke in the search box: the key at most once; ten with the
//      coalescer on render at most once before flushQuery();
//   4. each table tab: the key at most once, the cables and the devices each
//      walked at most twelve times;
//   5. each rack, front and rear: the key at most once, the cables walked at
//      most twenty times;
//   6. a whole redraw with the table, then the rack, shown, a has:finding
//      search and a device selected: the key once;
//   7. an undo step: one draw, no serialize.
// Only those counts pass or fail on their own, and they are the same on any
// machine. The times (one warm-up, then the median of five) carry budgets of
// about five times a laptop's, so only an order-of-magnitude regression fails
// them; each is printed as 'PERF :: name :: ms' (run-cross shows those on
// TOPO_PERF=1) and kept in window.__topoPerf.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const held = { coalesce: window.TOPO_COALESCE, checks: window.TOPO_CHECKS, view: state.settings.view };
  const perf = window.__topoPerf = {};
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
  // One warm-up, then the median of five; before() runs untimed ahead of each.
  const median = (fn, before) => {
    const times = [];
    for (let i = 0; i < 6; i++) {
      if (before) before(i);
      const t0 = performance.now(); fn(i); const ms = performance.now() - t0;
      if (i) times.push(ms);
    }
    return times.sort((a, b) => a - b)[2];
  };
  const within = (name, ms, budget) => {
    const r = Math.round(ms * 10) / 10;
    perf[name] = r;
    out.push(`PERF :: ${name} :: ${r}`);
    ok(`${name} within ${budget} ms`, ms <= budget, `${r} ms`);
  };

  // The spies, as clickcost.js has them.
  const SPIED = ['drawCanvas', 'save', 'serializeDoc'];
  const calls = {}, real = {};
  SPIED.forEach((k) => {
    real[k] = window[k]; calls[k] = 0;
    window[k] = function () { calls[k]++; return real[k].apply(this, arguments); };
  });
  const count = (fn) => { SPIED.forEach((k) => { calls[k] = 0; }); fn(); return Object.assign({}, calls); };
  const said = (c) => SPIED.map((k) => `${k} ${c[k]}`).join(', ');
  const SCANS = new Set(['filter', 'find', 'forEach', 'some', 'map', 'every', 'findIndex', 'reduce', 'flatMap']);
  const scansOf = (key) => (fn) => {
    const was = state[key];
    let n = 0;
    state[key] = new Proxy(was, { get(target, k, recv) { if (SCANS.has(k)) n++; return Reflect.get(target, k, recv); } });
    try { fn(); } finally { state[key] = was; }
    return n;
  };
  const linkScans = scansOf('links'), nodeScans = scansOf('nodes');
  const keyBuilds = (fn) => {
    const realStr = JSON.stringify;
    let n = 0;
    JSON.stringify = function (v) { if (v === state.nodes) n++; return realStr.apply(this, arguments); };
    try { fn(); } finally { JSON.stringify = realStr; }
    return n;
  };

  const canvas = el('networkCanvas');
  const at = (n) => { const r = canvas.getBoundingClientRect(); return { clientX: r.left + state.camera.x + n.x * state.camera.zoom, clientY: r.top + state.camera.y + n.y * state.camera.zoom }; };
  const mouse = (target, type, pt) => target.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, pt)));
  const typeInto = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const click = (id) => { const p = at(getNode(id)); mouse(el(`ui-node-${id}`), 'mousedown', p); mouse(window, 'mouseup', p); };

  try {
    // Its asserts serialize, which would count here and cost time.
    window.TOPO_CHECKS = false;
    window.TOPO_COALESCE = false;
    await loadScript('tests/fixtures/site400.js');
    replaceDocument(topoSite400(), { origin: 'file' });
    setView('map');
    renderCanvasOnly();

    // ---- The fixture ----
    ok('the fixture is 400 devices and 600 cables', state.nodes.length === 400 && state.links.length === 600,
      `${state.nodes.length} / ${state.links.length}`);
    const found = topologyFindings();
    const keys = found.filter((f) => f.level !== 'info').map((f) => f.key + (f.accepted ? '+' : '')).sort();
    ok('it raises its faults: the duplicate address, the gateway, the accepted ring',
      keys.includes('ip-conflict') && keys.includes('gateway') && keys.filter((k) => k === 'loop+').length === 1 && !keys.includes('loop'),
      keys.join(','));
    ok('the map draws every device and every cable',
      document.querySelectorAll('#layer-nodes > g[id^="ui-node-"]').length === 400
      && document.querySelectorAll('#layer-links > path[id^="ui-link-"]').length === 600);
    ok('ten groups, two of them racks', state.groups.length === 10 && state.groups.filter((g) => g.kind === 'rack').length === 2);

    // ---- 1. A click without a move ----
    select(null, null); flushLiveDoc();
    const steps0 = _undoStack.length, entry0 = json(history.state);
    let kb = 0;
    const c1 = count(() => { kb = keyBuilds(() => click('h10')); });
    flushLiveDoc();
    ok('a click on a device draws once, saves and serializes nothing', c1.drawCanvas === 1 && c1.save === 0 && c1.serializeDoc === 0, said(c1));
    ok('and builds the diagnosis key once', kb === 1, String(kb));
    ok('it selects the device, the timeline and the entry as they were',
      state.selectedId === 'h10' && _undoStack.length === steps0 && json(history.state) === entry0);
    within('a click without move', median(() => click('h20'), () => select(null, null)), 250);

    // ---- 2. A keystroke in a field ----
    select('h10', 'node');
    const name = el('propName');
    const steps1 = _undoStack.length;
    let kb2 = 0;
    const c2 = count(() => { kb2 = keyBuilds(() => typeInto(name, 'PC-TYPED')); });
    ok('a keystroke serializes once', c2.serializeDoc === 1, said(c2));
    ok('and builds the diagnosis key at most twice', kb2 <= 2, String(kb2));
    within('a keystroke in the name field', median((i) => typeInto(name, `PC-TYPED-${i}`)), 400);
    name.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    ok('the typing is one step', _undoStack.length === steps1 + 1, String(_undoStack.length - steps1));

    select('h11', 'node');
    const steps2 = _undoStack.length;
    window.TOPO_COALESCE = true;
    const word = 'abcdefghij';
    let pre = null;
    const c3 = count(() => {
      for (let i = 1; i <= word.length; i++) typeInto(el('propName'), word.slice(0, i));
      pre = calls.drawCanvas;
      flushTypedRender();
    });
    ok('ten keystrokes, coalesced, draw at most once before the flush', pre <= 1, String(pre));
    ok('and once at it', c3.drawCanvas - pre === 1, `${pre} then ${c3.drawCanvas}`);
    ok('the label is what was typed', getNode('h11').name === word && el('ui-node-h11').textContent.includes(word), el('ui-node-h11').textContent);
    el('propName').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    ok('one step at focusout', _undoStack.length === steps2 + 1, String(_undoStack.length - steps2));
    cancelTypedRender();
    window.TOPO_COALESCE = false;
    select(null, null);

    // ---- 3. A keystroke in the search box ----
    const box = el('queryInput');
    ['type:pc', 'has:finding'].forEach((q) => {
      setQuery('');
      const k = keyBuilds(() => typeInto(box, q));
      ok(`a search keystroke (${q}) builds the diagnosis key at most once`, k <= 1, String(k));
      ok(`and it is the search (${q})`, state.query === q, state.query);
      within(`a search keystroke (${q})`, median(() => typeInto(box, q), () => setQuery('')), 300);
    });
    setQuery('');
    window.TOPO_COALESCE = true;
    let preQ = null;
    const c4 = count(() => {
      const q = 'type:printer';
      for (let i = 1; i <= q.length; i++) typeInto(box, q.slice(0, i));
      preQ = calls.drawCanvas;
    });
    ok('ten search keystrokes, coalesced, render at most once before flushQuery()', preQ <= 1, `${preQ} (${said(c4)})`);
    ok('and flushQuery() leaves the search as typed', flushQuery() && state.query === 'type:printer', state.query);
    window.TOPO_COALESCE = false;
    setQuery('');

    // ---- 4. The table ----
    setView('table');
    const tabs = TV_TABS.map((tb) => tb.key).filter(tvTabOffered);
    const tcost = {};
    tabs.forEach((tab) => {
      showTableTab(tab);
      tcost[tab] = { keys: keyBuilds(() => renderTableView(true)), links: linkScans(() => renderTableView(true)), nodes: nodeScans(() => renderTableView(true)) };
    });
    const tj = json(tcost);
    ok('each table tab builds the diagnosis key at most once', Object.values(tcost).every((c) => c.keys <= 1), tj);
    ok('and walks the cables at most twelve times', Object.values(tcost).every((c) => c.links <= 12), tj);
    ok('and the devices at most twelve times', Object.values(tcost).every((c) => c.nodes <= 12), tj);
    tabs.forEach((tab) => {
      showTableTab(tab);
      within(`the table's ${tab} tab`, median(() => renderTableView(true)), 400);
    });
    showTableTab('devices');

    // ---- 5. The racks ----
    const rcost = {};
    ['g-ra', 'g-rb'].forEach((id) => {
      openRackView(id);
      ['front', 'rear'].forEach((face) => {
        _rv.face = face;
        rcost[`${id}/${face}`] = { keys: keyBuilds(() => renderRackView(true)), links: linkScans(() => renderRackView(true)) };
        within(`the rack ${id}, ${face}`, median(() => renderRackView(true)), 400);
      });
    });
    _rv.face = 'front';
    const rj = json(rcost);
    ok('each rack render builds the diagnosis key at most once', Object.values(rcost).every((c) => c.keys <= 1), rj);
    ok('and walks the cables at most twenty times', Object.values(rcost).every((c) => c.links <= 20), rj);
    ok('and drew the rack', !!el('rackBody').querySelector('.rk-dev'));

    // ---- 6. A whole redraw ----
    setQuery('has:finding');
    select('h7', 'node');
    const whole = {};
    setView('table'); whole.table = keyBuilds(() => renderCanvasOnly());
    openRackView('g-ra'); whole.rack = keyBuilds(() => renderCanvasOnly());
    setView('map'); whole.map = keyBuilds(() => renderCanvasOnly());
    ok('a whole redraw (a search, a selection, the table or the rack shown) builds the diagnosis key once',
      whole.table === 1 && whole.rack === 1 && whole.map === 1, json(whole));
    setView('table');
    within('a whole redraw with the table shown', median(() => renderCanvasOnly()), 500);
    openRackView('g-ra');
    within('a whole redraw with the rack shown', median(() => renderCanvasOnly()), 500);
    setView('map');
    within('a whole redraw of the map', median(() => renderCanvasOnly()), 500);
    setQuery('');
    select(null, null);

    // ---- 7. An undo step ----
    const edit = (i) => { getNode('h12').name = `EDIT-${i}`; save(); };
    edit('a');
    const c5 = count(() => undo());
    ok('an undo step draws once and serializes nothing', c5.drawCanvas === 1 && c5.serializeDoc === 0, said(c5));
    ok('and takes the edit back', getNode('h12').name !== 'EDIT-a', getNode('h12').name);
    within('an undo step', median(() => undo(), (i) => edit(i)), 400);
  } catch (e) {
    ok('the suite ran to the end', false, String(e && (e.stack || e.message) || e));
  } finally {
    SPIED.forEach((k) => { window[k] = real[k]; });
    window.TOPO_COALESCE = held.coalesce; window.TOPO_CHECKS = held.checks;
    try { setQuery(''); setView(held.view === 'table' ? 'table' : 'map'); } catch (e) { /* the run is over */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
