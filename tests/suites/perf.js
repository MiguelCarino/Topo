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
//      the firmware finding with a model and firmware on every device,
//      a trace, each table tab, the report, the bulk preview of each kind
//      over 90 devices, a drag step, the SVG export, locating every
//      device (locatePath, in a pass and on a copy) and the report with
//      30 saved searches printed (reportSearches), recording an address
//      history point of the whole site and a binder back-up of ten such
//      cards recording each (js/trail.js), and was:/has:history over the
//      site with a 20-point trail (js/query.js). Several times what
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
    // Its faults: the racks' untagged cables are an info note (Round 5).
    const keys = found.filter((f) => f.level !== 'info').map((f) => f.key + (f.accepted ? '+' : '')).sort().join(',');
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
    ok('and builds the diagnosis key a bounded number of times, not once per device', mapKeys <= 1, String(mapKeys));

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
      state.links.filter((l) => l.source === 'rt' && l.target === 'core').map((l) => linkGeometry(l).bow).sort((a, b) => a - b).join(',') === '-68,-34,0,34,68');

    // ---- 4. Time budgets ----
    within('the findings, from scratch,', median(() => diagnoseDoc(null)), 400);
    // The firmware finding (docs/BACKLOG.md feature 3 stage 4): every device
    // given a vendor, a model by its type and one of two firmwares
    // (taken in turn among the ones in service), so every model of two or
    // more such devices is a finding; then the whole diagnosis with them.
    {
      const held = state.nodes.map((n) => ({ n, vendor: n.vendor, model: n.model, os: n.os }));
      const seen = {};
      state.nodes.forEach((n) => { if (!isRetired(n)) seen[n.type] = (seen[n.type] || 0) + 1; n.vendor = 'Acme'; n.model = 'M-' + n.type; n.os = 'v1.' + (seen[n.type] % 2); });
      try {
        let fw = [];
        within('the firmware finding over 300 devices', median(() => { fw = firmwareFindings(); }), 60);
        const live = {};
        state.nodes.filter((n) => !isRetired(n)).forEach((n) => { live[n.type] = (live[n.type] || 0) + 1; });
        const want = Object.values(live).filter((k) => k > 1);
        ok('and it names every model of two or more devices, each with all of them', fw.length === want.length && fw.length > 3
           && fw.reduce((k, f) => k + f.nodeIds.length, 0) === want.reduce((a, b) => a + b, 0), fw.length + ' of ' + want.length);
        within('the findings with a model and firmware on every device', median(() => diagnoseDoc(null)), 400);
      } finally {
        held.forEach(({ n, vendor, model, os }) => {
          ['vendor', 'model', 'os'].forEach((k) => { const v = { vendor, model, os }[k]; if (v === undefined) delete n[k]; else n[k] = v; });
        });
        diagnosisMemo = null;
      }
    }
    // The PoE checks (docs/BACKLOG.md feature 4 stage 2b): every switch and
    // AP given a budget and PoE+ on every cabled port, every device cabled
    // into one given a draw, the budget a little under what they draw so
    // each box is over it; then the whole diagnosis with them.
    {
      const held = state.nodes.map((n) => ({ n, poeBudget: n.poeBudget, poeDraw: n.poeDraw, portAttrs: n.portAttrs ? JSON.parse(JSON.stringify(n.portAttrs)) : undefined }));
      const boxes = state.nodes.filter((n) => hasPortGrid(n));
      const fed = new Set();
      // What each box should be found drawing, counted here and not by
      // poeLoad: each device fed by a cabled PoE port once per box.
      const feeds = new Map();
      state.links.forEach((l) => {
        [[l.source, l.sourceIface, l.target], [l.target, l.targetIface, l.source]].forEach(([id, iface, farId]) => {
          const box = getNode(id), far = getNode(farId);
          if (!hasPortGrid(box) || !/^p\d+$/.test(iface || '') || !far || hasPortGrid(far) || !canDrawPoe(far.type)) return;
          if (!isExclusiveLink(l)) return;
          setPortAttr(box, iface, 'poe', 'at');
          far.poeDraw = 6.49; fed.add(far.id);
          if (!feeds.has(box.id)) feeds.set(box.id, new Set());
          if (!isRetired(far)) feeds.get(box.id).add(far.id);
        });
      });
      const expectedOver = new Set();
      boxes.forEach((b) => {
        const n = feeds.has(b.id) ? feeds.get(b.id).size : 0;
        const used = Math.round(n * 649) / 100;
        b.poeBudget = used > 2 ? Math.max(1, Math.floor(used) - 1) : 370;
        if (!isRetired(b) && used > b.poeBudget) expectedOver.add(b.id);
      });
      try {
        let pf = [];
        within('the PoE checks over 300 devices', median(() => { pf = withLookupPass(poeFindings); }), 60);
        const overFound = pf.filter((f) => f.key === 'poe-budget').map((f) => f.nodeIds[0]).sort();
        ok('and they find every box over its budget, and only those', expectedOver.size > 0 && JSON.stringify(overFound) === JSON.stringify([...expectedOver].sort()),
          overFound.length + ' found / ' + expectedOver.size + ' expected, fed ' + fed.size);
        within('the findings with PoE on every cabled port', median(() => diagnoseDoc(null)), 400);
      } finally {
        held.forEach(({ n, poeBudget, poeDraw, portAttrs }) => {
          if (poeBudget === undefined) delete n.poeBudget; else n.poeBudget = poeBudget;
          if (poeDraw === undefined) delete n.poeDraw; else n.poeDraw = poeDraw;
          if (portAttrs === undefined) delete n.portAttrs; else n.portAttrs = portAttrs;
        });
        diagnosisMemo = null;
      }
    }
    // The VLAN checks (docs/BACKLOG.md feature 4 stage 2a): every cable
    // between two switches or APs made a trunk of all five VLANs at both
    // ends, but the uplinks of the first access switch carrying only 10 and
    // 20, and every switch port with a device on it given that device's
    // subnet's VLAN; so every device in service behind that switch on VLAN
    // 30, 40 or 50 is a vlan-path finding (one per VLAN and cable), and the
    // per-cable vlan-mismatch and the vlanPath walks run on every cable.
    {
      const held = state.nodes.map((n) => ({ n, portAttrs: n.portAttrs ? JSON.parse(JSON.stringify(n.portAttrs)) : undefined }));
      const boxes = state.nodes.filter((n) => hasPortGrid(n));
      const first = boxes.find((b) => b.id !== 'core' && state.links.some((l) => (l.source === b.id || l.target === b.id) && [l.source, l.target].includes('core')));
      state.links.forEach((l) => {
        const a = getNode(l.source), b = getNode(l.target);
        if (!a || !b) return;
        if (hasPortGrid(a) && hasPortGrid(b)) {
          const list = first && (a.id === first.id || b.id === first.id) ? '10,20' : '10,20,30,40,50';
          [[a, l.sourceIface], [b, l.targetIface]].forEach(([n, pid]) => { if (/^p\d+$/.test(pid || '')) { setPortAttr(n, pid, 'vlan', ''); setPortAttr(n, pid, 'tagged', list); } });
          return;
        }
        [[a, l.sourceIface, b, l.targetIface], [b, l.targetIface, a, l.sourceIface]].forEach(([box, pid, dev, devIface]) => {
          if (!hasPortGrid(box) || !/^p\d+$/.test(pid || '') || hasPortGrid(dev) || !isExclusiveLink(l)) return;
          const own = portVlans(dev, devIface).untagged;
          setPortAttr(box, pid, 'tagged', '');
          if (own) setPortAttr(box, pid, 'vlan', own); else setPortAttr(box, pid, 'vlan', '');
        });
      });
      try {
        diagnosisMemo = null;
        let vf = [];
        within('the VLAN checks over 300 devices', median(() => { vf = withLookupPass(() => { const d = diagnoseDoc(null); return d.findings; }).filter((f) => /^vlan-/.test(f.key)); }), 400);
        const paths = vf.filter((f) => f.key === 'vlan-path');
        ok('and they find the VLANs the first access switch\'s uplinks do not carry, and nothing else', !!first && paths.length > 0
           && paths.every((f) => ['vlan:30', 'vlan:40', 'vlan:50'].includes(f.scope) && f.nodeIds.includes(first.id))
           && !vf.some((f) => f.key === 'vlan-subnet' || f.key === 'vlan-mismatch'),
          (first ? first.id : 'no switch') + ': ' + vf.map((f) => f.key + ' ' + f.scope + ' ' + f.line).join(' | '));
        // Worked out apart from the finders: the devices in service whose
        // gateway check is good, cabled to a port on VLAN 30, 40 or 50 of a
        // switch that reaches the core only through the first one, are the
        // devices the findings name; one finding per VLAN and stopping cable.
        const behind = new Set();
        {
          const viaCore = new Set(['core']), q = ['core'];
          while (q.length) {
            const id = q.shift();
            state.links.forEach((l) => {
              if (l.source !== id && l.target !== id) return;
              const o = l.source === id ? l.target : l.source;
              const on = getNode(o);
              if (o === first.id || viaCore.has(o) || !on || !hasPortGrid(on) || isRetired(on)) return;
              viaCore.add(o); q.push(o);
            });
          }
          boxes.forEach((b) => { if (!viaCore.has(b.id)) behind.add(b.id); });
        }
        const good = new Set(state.nodes.filter((n) => (nodeDiagnosis(n).checks.find((c) => c.key === 'gateway') || {}).level === 'good').map((n) => n.id));
        const expectHosts = new Set(), expectVlans = new Set();
        state.links.forEach((l) => [[l.source, l.sourceIface, l.target], [l.target, l.targetIface, l.source]].forEach(([bid, pid, hid]) => {
          const box = getNode(bid), host = getNode(hid);
          if (!behind.has(bid) || !host || hasPortGrid(host) || isRetired(host) || !good.has(hid) || isRoutingDevice(host.type) || !isExclusiveLink(l)) return;
          const v = portVlans(box, pid).untagged;
          if (![30, 40, 50].includes(v)) return;
          expectHosts.add(hid); expectVlans.add(v);
        }));
        const named = new Set(paths.flatMap((f) => f.nodeIds).filter((id) => !hasPortGrid(getNode(id)) && id !== 'rt' && !isRoutingDevice(getNode(id).type)));
        const stops = new Set(paths.map((f) => f.scope + '|' + f.linkIds[0]));
        ok('exactly the expected devices, one finding per VLAN and stopping cable', expectHosts.size > 0 && named.size === expectHosts.size && [...expectHosts].every((id) => named.has(id))
           && stops.size === paths.length && new Set(paths.map((f) => f.scope)).size === expectVlans.size,
          `expected ${expectHosts.size} devices on ${[...expectVlans].join(',')}; named ${named.size} in ${paths.length} findings (${[...stops].join(' ')})`);
        // The VLAN finders on their own, apart from the rest of the diagnosis.
        const everyId = new Set(state.nodes.map((n) => n.id));
        within('the VLAN finders alone over 300 devices', median(() => withLookupPass(() => vlanFindings(reachContext(), everyId))), 60);
        let walks = 0;
        within('vlanPath from every switch for every VLAN', median(() => { walks = 0; withLookupPass(() => boxes.forEach((b) => [10, 20, 30, 40, 50].forEach((v) => { vlanPath(b.id, v, 'rt'); walks++; }))); }), 150);
        ok('the walks ran', walks === boxes.length * 5, String(walks));
        // The VLAN-aware Trace (stage 3): one L2 domain per (node, VLAN) in
        // a walk, the router walking each of its five VLANs. From the router
        // and from every device, against the VLAN-blind trace; the devices
        // the router's VLAN-aware trace misses are exactly the ones the
        // vlan-path findings name (their VLAN stops at the first switch).
        let rtAware = null, rtBlind = null;
        within('the VLAN-aware trace from the router', median(() => { rtAware = withLookupPass(() => calculateReachability('rt', { port: '', vlan: true })); }), 100);
        rtBlind = withLookupPass(() => calculateReachability('rt', { port: '', vlan: false }));
        const missed = [...rtBlind.reachableNodes].filter((id) => !rtAware.reachableNodes.has(id) && !hasPortGrid(getNode(id)));
        // Besides them, the Wi-Fi laptops of the access points behind it (on
        // Wi-Fi, VLAN 50), which vlan-path does not judge here (their links
        // name no SSID) but the trace walks on their subnet's VLAN.
        const viaBehindAp = (id) => linksAtNode(id).some((l) => {
          if (effectiveMedium(l) !== 'wireless') return false;
          const ap = getNode(l.source === id ? l.target : l.source);
          return !!ap && ap.type === 'ap' && linksAtNode(ap.id).some((u) => behind.has(u.source === ap.id ? u.target : u.source));
        });
        const extra = missed.filter((id) => !expectHosts.has(id));
        ok('and it misses exactly the devices on VLAN 30-50 behind the first access switch, and the Wi-Fi laptops behind it',
          [...expectHosts].every((id) => missed.includes(id)) && extra.length > 0 && extra.every((id) => viaBehindAp(id) && vlanOfNet(getValidIps(getNode(id))[0].networkStr) === 50),
          missed.length + ' missed, ' + expectHosts.size + ' expected, extra ' + extra.join(' '));
        let traced = 0;
        const blindMs = median(() => withLookupPass(() => state.nodes.forEach((n) => calculateReachability(n.id, { port: '', vlan: false }))));
        const awareMs = median(() => { traced = 0; withLookupPass(() => state.nodes.forEach((n) => { calculateReachability(n.id, { port: '', vlan: true }); traced++; })); });
        within(`the VLAN-aware trace from every device (VLAN-blind: ${Math.round(blindMs)} ms)`, awareMs, 3000);
        ok('every device traced', traced === state.nodes.length, String(traced));
      } finally {
        held.forEach(({ n, portAttrs }) => { if (portAttrs === undefined) delete n.portAttrs; else n.portAttrs = portAttrs; });
        diagnosisMemo = null;
      }
    }
    within('a map redraw after an edit', median(() => { diagnosisMemo = null; renderCanvasOnly(); }), 500);
    within('a map redraw with nothing changed', median(() => renderCanvasOnly()), 300);
    // Locate (docs/BACKLOG.md, feature 1): where every device is plugged in,
    // in one lookup pass and in the document form (a copy's lists).
    within('locating every device', median(() => withLookupPass(() => state.nodes.forEach((n) => locatePath(n)))), 300);
    within('locating every device of a copy', median(() => {
      const doc = { nodes: state.nodes.slice(), links: state.links.slice(), groups: state.groups };
      doc.nodes.forEach((n) => locatePath(n, doc));
    }), 1500);
    // The address history (docs/BACKLOG.md, feature 5, js/trail.js): one
    // point recorded over the whole site, onto a trail already 20 points
    // long, and a binder back-up of ten such cards recording every one.
    {
      const T = window.CarinoTrail, L = window.CarinoLibrary;
      const site = serializeDoc();
      let trail = null;
      for (let i = 0; i < 20; i++) trail = T.mergeObservation(trail, T.observeDoc(site), 1000 + i, 'backup');
      let at = 2000;
      within('recording a point of the whole site', median(() => { T.mergeObservation(trail, T.observeDoc(site), at++, 'backup'); }), 30);
      const heldLib = L.loadLibrary(), heldExport = localStorage.getItem(L.BINDER_EXPORT_KEY);
      try {
        persistLibrary({});
        const ids = Array.from({ length: 10 }, (_, i) => L.librarySave('Site ' + i, null, { doc: site }));
        const t0 = performance.now();
        recordBinderExport();
        const ms = performance.now() - t0;
        ok('a binder back-up of ten 300-device cards records every one', ids.every((id) => (T.trailOf(id) || { points: [] }).points.length === 1));
        within('and the back-up with its recording', ms, 600);
      } finally {
        persistLibrary(heldLib);
        if (heldExport === null) localStorage.removeItem(L.BINDER_EXPORT_KEY); else localStorage.setItem(L.BINDER_EXPORT_KEY, heldExport);
      }
      // Search over the history (feature 5 stage 3): the open site kept, a
      // 20-point trail in which every address moved once, then was: and
      // has:history asked of all 300 devices, as the map's redraw asks.
      const heldLib2 = L.loadLibrary(), heldCard = { libraryId: state.libraryId, docId: state.docId };
      let card = null;
      try {
        persistLibrary({});
        card = L.claimDocument('Site 300', null);
        const doc = serializeDoc();
        for (let i = 0; i < 20; i++) {
          const pointDoc = cloneData(doc);
          if (i < 10) pointDoc.nodes.forEach((n) => (n.interfaces || []).forEach((f) => { if (f.ip) f.ip = '172.16.' + (i % 250) + '.' + (String(f.ip).split('/')[0].split('.').pop() || '1') + '/24'; }));
          T.recordPoint(card, 'backup', pointDoc, 5000 + i);
        }
        const text = 'was:172.16.3.0/24';
        const q = parseQuery(text);
        let hits = 0;
        within('a was: search over 300 devices with a 20-point trail', median(() => {
          hits = withLookupPass(() => state.nodes.filter((n) => queryMatch(q, 'node', n)).length);
        }), 150);
        ok('and it finds the devices that had an address there', hits > 100, String(hits));
        const qh = parseQuery('has:history');
        let histHits = 0;
        within('has:history over 300 devices', median(() => { histHits = withLookupPass(() => state.nodes.filter((n) => queryMatch(qh, 'node', n)).length); }), 150);
        ok('and has:history finds the devices whose address moved', histHits > 100, String(histHits));
        setQuery(text);
        within('a map redraw with a was: search on', median(() => renderCanvasOnly()), 500);
        setQuery('');
      } finally {
        setQuery('');
        if (card) T.dropTrail(card);
        persistLibrary(heldLib2);
        state.libraryId = heldCard.libraryId; state.docId = heldCard.docId;
      }
    }
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
    // Saved searches printed (docs/BACKLOG.md feature 6): the most a network
    // keeps, all marked to print, matched over every device in the report's
    // one lookup pass, O(searches × devices). Half print the Devices table's
    // own columns, a third are sorted, some ask has:finding.
    const heldSearches = state.searches;
    const kinds = ['type:pc', 'has:finding', 'has:ip -type:pc', 'type:switch', '10.20.', 'has:gateway has:dns'];
    state.searches = Array.from({ length: SEARCH_MAX }, (_, i) => ({ id: `sq_${i + 1}`, name: `Search ${i + 1}`, query: kinds[i % kinds.length], print: true,
      columns: i % 2 ? ['ifaces', 'gw', 'os', 'group', 'age'] : undefined, sort: i % 3 === 0 ? 'ifaces' : undefined }));
    let flagged = null;
    within(`the report model with ${SEARCH_MAX} saved searches printed`, median(() => { flagged = reportModel(); }), 600);
    ok('and every one of them is in it, with rows', flagged.searches.length === SEARCH_MAX && flagged.searches.filter((s) => s.rows.length).length >= SEARCH_MAX / 2,
       JSON.stringify(flagged.searches.map((s) => s.rows.length)));
    within('their sections drawn', median(() => searchesSection(flagged.searches)), 200);
    state.searches = heldSearches;

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
