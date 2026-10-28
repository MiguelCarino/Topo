// @realtime — Topo at site scale (plan, "Scale hygiene"). A time budget means
// nothing on run.sh's virtual clock, which does not move while a script runs,
// so this suite runs on Playwright's real clock (tests/README.md).
//
// The 300-device fixture (tests/fixtures/site300.js) is loaded, and then:
//   1. it is what it says (300 devices, the faults it carries are found, the
//      accepted loop stays accepted), and the map, the table and the report
//      draw all of it;
//   2. the indexes hold: the map's redraw, a whole-site drag step, the
//      table and the report each read the cable list and build the
//      diagnosis's whole-document key a bounded number of times, not once
//      per cable or per device. These counts are exact whatever the machine,
//      so they catch a scan creeping back into a hot loop that a generous
//      time budget would let through (the table took 200 ms, the report
//      145 ms, both well inside any budget that is not flaky);
//   3. the indexed answers are the plain ones: every cable's fan (parallel
//      runs between the same two devices) is the same with and without a
//      lookup pass;
//   4. time budgets, median of three, for what a person waits on: the
//      findings, the map redraw (after an edit, and with nothing changed),
//      a trace, each table tab, the report, the bulk preview of each kind
//      over 90 devices, a drag step and the SVG export. Several times what
//      a laptop takes, so a busy machine does not fail them; a quadratic
//      loop at 300 devices does.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const finish = () => {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  };
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
  const median = (fn, runs = 3) => {
    const times = [];
    for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); times.push(performance.now() - t0); }
    return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
  };
  const within = (name, ms, budget) => ok(`${name} within ${budget} ms`, ms <= budget, `${Math.round(ms)} ms`);

  // How many times the cable list is walked while fn runs. A Proxy over the
  // array: every method a scan starts with is counted.
  const SCANS = new Set(['filter', 'find', 'forEach', 'some', 'map', 'every', 'findIndex', 'reduce', 'flatMap']);
  const linkScans = (fn) => {
    const real = state.links;
    let n = 0;
    state.links = new Proxy(real, { get(target, key, recv) { if (SCANS.has(key)) n++; return Reflect.get(target, key, recv); } });
    try { fn(); } finally { state.links = real; }
    return n;
  };
  // How many times the diagnosis's memo key (the whole document, serialized)
  // is built while fn runs: counted at JSON.stringify(state.nodes), which is
  // what building it costs, so the count does not depend on which function
  // happens to build it.
  const keyBuilds = (fn) => {
    const real = JSON.stringify;
    let n = 0;
    JSON.stringify = function (v) { if (v === state.nodes) n++; return real.apply(this, arguments); };
    try { fn(); } finally { JSON.stringify = real; }
    return n;
  };

  try {
    await loadScript('tests/fixtures/site300.js');
    replaceDocument(topoSite300(), { origin: 'file' });
    renderCanvasOnly();

    // ---- 1. The fixture ----
    ok('the fixture is 300 devices and 305 cables', state.nodes.length === 300 && state.links.length === 305,
      `${state.nodes.length} / ${state.links.length}`);
    const found = topologyFindings();
    const keys = found.map((f) => f.key + (f.accepted ? '+' : '')).sort().join(',');
    ok('it raises exactly the faults it carries', keys === 'dns,gateway,ip-conflict,ip-conflict,loop+,loop+,mac-conflict', keys);
    ok('the replacement of the retired PC is not a conflict', !found.some((f) => f.key === 'ip-conflict' && f.nodeIds.includes('h201')));
    ok('the map draws every device and every cable',
      document.querySelectorAll('#layer-nodes > g[id^="ui-node-"]').length === 300
      && document.querySelectorAll('#layer-links > path[id^="ui-link-"]').length === 305);
    // Twenty groups (js/groupmap.js): a frame for each, nothing collapsed.
    ok('it holds twenty groups, each drawn as a frame', state.groups.length === 20
      && document.querySelectorAll('#layer-groups > .grp-frame').length === 20,
      `${state.groups.length} / ${document.querySelectorAll('#layer-groups > .grp-frame').length}`);

    // ---- 2. Bounded work ----
    const mapScans = linkScans(() => renderCanvasOnly());
    ok('a map redraw walks the cable list a bounded number of times, not once per cable', mapScans <= 20, `${mapScans} walks for 305 cables`);
    const mapKeys = keyBuilds(() => renderCanvasOnly());
    ok('and builds the diagnosis key a bounded number of times, not once per device', mapKeys <= 3, String(mapKeys));

    setView('table');
    const tableKeys = {};
    ['devices', 'interfaces', 'cables', 'ports', 'subnets'].forEach((tab) => {
      showTableTab(tab);
      tableKeys[tab] = keyBuilds(() => renderTableView(true));
    });
    ok('each table tab builds the diagnosis key at most once', Object.values(tableKeys).every((n) => n <= 1), JSON.stringify(tableKeys));
    showTableTab('devices'); renderTableView(true);
    ok('the Devices tab lists every device', _tv.rows.filter((r) => !r.sub).length === 300, String(_tv.rows.filter((r) => !r.sub).length));
    setView('map');

    const reportKeys = keyBuilds(() => reportModel());
    ok('the report builds the diagnosis key once, not once per device', reportKeys <= 1, String(reportKeys));
    const model = reportModel();
    ok('the report lists every device and keeps the accepted loop out of its totals',
      model.devices.length === 300 && model.counts.accepted === 2 && model.counts.critical === 5, JSON.stringify(model.counts));

    // A whole-site drag step: every cable reshapes.
    selectAll();
    const pressed = getNode('core');
    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    const at = (n, dx) => ({ clientX: rect.left + state.camera.x + (n.x + dx) * state.camera.zoom, clientY: rect.top + state.camera.y + n.y * state.camera.zoom });
    startDrag(at(pressed, 0), selectedOf('node').map(getNode), pressed);
    const before = { x: getNode('h5').x, y: getNode('h5').y };
    let dragMs = 0;
    const dragScans = linkScans(() => {
      const t0 = performance.now();
      window.dispatchEvent(new MouseEvent('mousemove', at(pressed, 40)));
      dragMs = performance.now() - t0;
    });
    ok('a whole-site drag step moves everything', getNode('h5').x === before.x + 40 && getNode('h5').y === before.y,
      `${getNode('h5').x - before.x}`);
    ok('and walks the cable list a bounded number of times', dragScans <= 3, String(dragScans));
    const pathOk = (() => {
      const l = state.links.find((x) => x.source === 'sw1' && x.target === 'h1');
      const d = document.getElementById(`ui-link-${l.id}`).getAttribute('d');
      return d.startsWith(`M ${getNode('sw1').x} ${getNode('sw1').y} `);
    })();
    ok('the cables follow the devices while dragging', pathOk);
    window.dispatchEvent(new MouseEvent('mouseup'));
    within('a whole-site drag step', dragMs, 150);
    undo();
    ok('the drag was one undo step', getNode('h5').x === before.x);
    select(null, null);

    // ---- 3. The indexed answers are the plain ones ----
    const fans = () => state.links.map((l) => { const g = linkGeometry(l); return `${l.id}:${g.bow}`; }).join('|');
    const plain = fans();
    const indexed = withLookupPass(fans);
    ok('every cable fans out the same with and without the indexes', plain === indexed);
    ok('the five router legs on the core fan out around the straight line',
      state.links.filter((l) => l.source === 'rt' && l.target === 'core').map((l) => linkGeometry(l).bow).join(',') === '-68,-34,0,34,68');

    // ---- 4. Time budgets ----
    within('the findings, from scratch,', median(() => diagnoseDoc(null)), 400);
    within('a map redraw after an edit', median(() => { diagnosisMemo = null; renderCanvasOnly(); }), 500);
    within('a map redraw with nothing changed', median(() => renderCanvasOnly()), 300);
    // The six IDF rooms collapsed: 258 devices folded into six nodes.
    const idfs = ['g-idf1', 'g-idf2', 'g-idf3', 'g-idf4', 'g-idf5', 'g-idf6'];
    idfs.forEach((id) => setGroupCollapsed(id, true));
    ok('six rooms collapsed: six nodes for their devices, one line per far end (the core, four APs, the ring)',
      document.querySelectorAll('#layer-nodes > .grp-node').length === 6
      && document.querySelectorAll('#layer-nodes > g[id^="ui-node-"]').length === 300 - 6 * 43
      && document.querySelectorAll('#layer-links > .grp-edge').length === 11,
      `${document.querySelectorAll('#layer-nodes > .grp-node').length} / ${document.querySelectorAll('#layer-nodes > g[id^="ui-node-"]').length} / ${document.querySelectorAll('#layer-links > .grp-edge').length}`);
    const foldScans = linkScans(() => renderCanvasOnly());
    ok('a redraw with groups collapsed still walks the cable list a bounded number of times', foldScans <= 22, String(foldScans));
    within('a map redraw with six groups collapsed, after an edit', median(() => { diagnosisMemo = null; renderCanvasOnly(); }), 500);
    within('a map redraw with six groups collapsed', median(() => renderCanvasOnly()), 300);
    idfs.forEach((id) => setGroupCollapsed(id, false));
    // Tidy with twenty groups: each a block, none on another (js/app.js,
    // tidyPositionsGrouped), in the time a whole-site Tidy is given.
    within('a whole-site Tidy with twenty groups', median(() => { tidyLayout(); undo(); }), 1500);
    tidyLayout();
    {
      const fv = groupMapView(new Set());
      const r = new Map(fv.frames.map((f) => [f.group.id, f.rect]));
      const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y - 10 < b.y + b.h && b.y - 10 < a.y + a.h;
      const clash = [];
      fv.frames.forEach((a, i) => fv.frames.slice(i + 1).forEach((b) => {
        if ((a.group.parent || null) === (b.group.parent || null) && hit(a.rect, b.rect)) clash.push(`${a.group.id}/${b.group.id}`);
      }));
      ok('tidied, no group\'s frame lands on another\'s', clash.length === 0 && r.size === 20, `${r.size} frames; ${clash.join(' ')}`);
    }
    undo();
    select('h5', 'node');
    setTraceMode(true);
    within('a map redraw tracing from a desk PC', median(() => renderCanvasOnly()), 500);
    ok('and the trace reaches across the site', /→ \d{3} devices/.test(document.getElementById('traceStatus').textContent),
      document.getElementById('traceStatus').textContent);
    setTraceMode(false);
    select(null, null);
    setView('table');
    ['devices', 'interfaces', 'cables', 'ports', 'subnets'].forEach((tab) => {
      showTableTab(tab);
      within(`the table's ${tab} tab`, median(() => renderTableView(true)), 400);
    });
    setView('map');
    within('the report model', median(() => reportModel()), 300);

    const pcs = state.nodes.filter((n) => n.type === 'pc' && !/^LAPTOP/.test(n.name)).slice(0, 90).map((n) => n.id);
    ok('the bulk set is 90 desk PCs', pcs.length === 90, String(pcs.length));
    setSelectionEntries(pcs.map((id) => ({ type: 'node', id })));
    const requests = {
      set: { action: 'set', kind: 'node', ids: pcs, edits: { gw: { text: '10.20.20.1' } } },
      rename: { action: 'rename', ids: pcs, rename: { pattern: 'WS-{n:03}', start: 1, order: 'name' } },
      move: { action: 'move', ids: pcs, net: 'net-voip' },
      recable: { action: 'recable', ids: pcs.slice(0, 30), recable: { target: 'core', from: '' } },
      delete: { action: 'delete', ids: pcs }
    };
    Object.entries(requests).forEach(([kind, req]) => {
      let plan = null;
      const ms = median(() => { plan = bulkPlan(req); renderBulkPreview(plan); });
      within(`the bulk ${kind} preview over ${req.ids.length} devices`, ms, 600);
      ok(`and the ${kind} preview changes every one of them`, plan && !plan.errors.length && plan.counts.change === req.ids.length,
        plan ? JSON.stringify(plan.counts) + plan.errors.join(' ') : 'no plan');
    });
    select(null, null);

    let svgText = '';
    within('the SVG export', median(() => { svgText = canvasSvgFile(); }), 500);
    const svgDoc = new DOMParser().parseFromString(svgText || '', 'image/svg+xml');
    ok('and it holds the whole site', svgDoc.querySelectorAll('g[id^="ui-node-"]').length === 300
      && svgDoc.querySelectorAll('path[id^="ui-link-"]').length === 305 && !svgDoc.querySelector('parsererror'));
  } catch (e) {
    ok('the suite ran without throwing', false, String(e && (e.stack || e.message) || e));
  }
  finish();
}, 50); });
