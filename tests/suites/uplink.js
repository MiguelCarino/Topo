// The shared uplink helper, uplinkOf (js/model.js): where a device is patched
// in, which the devices sheet's switch/port columns (csvUplink, js/csv.js)
// and the bulk panel's "by switch port" order (patchPoint, js/bulk.js) both
// read, and which Locate and the history trail will read too (docs/BACKLOG.md,
// landing order step 1). What is held here:
//   1. the refactor changed nothing: on every bundled template and sample and
//      on the 300- and 400-device fixtures, devices.csv is byte for byte what
//      the old csvUplink wrote, BULK_ORDERS.port sorts as the old patchPoint
//      did, and csvUplink and patchPoint answer as their old selves for every
//      device (the old code is kept below, verbatim, as the reference);
//   2. a document's own lists ({links, nodes}, an array or a Map) give the
//      open document's answer, inside a lookup pass too, and a copy is read
//      without the open document being asked at all (its lists a counted
//      decoy cabled otherwise, the port's name and skipNoPort's wired-or-not
//      included), and the switch-port sort works out no port names;
//   3. the rule on cases built for it: the lowest-named faceplate peer by
//      natural order, then the lowest port; a bond's two cables; a VM on a
//      host (no cable of its own: none; the host's is the host's); a laptop
//      on Wi-Fi (no port at the AP, kept by skipNoPort); a wired cable with
//      no port (skipped by skipNoPort only); ties (same name, names equal in
//      any case, no names, nameOrId); the port's name from the scheme and the
//      device's own end.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });

  // ---- The reference: csvUplink and patchPoint as they were before uplinkOf (commit 1b3fe85) ----
  function legacyCsvUplink(node, forSheet = false) {
    let best = null;
    linksAtNode(node.id).forEach((l) => {
      const peerId = l.source === node.id ? l.target : l.source;
      const peer = getNode(peerId);
      if (!hasPortGrid(peer)) return;
      if (forSheet && !ifaceIdOn(l, peerId) && effectiveMedium(l, getNode(l.source), getNode(l.target)) !== 'wireless') return;
      const m = /^p(\d+)$/.exec(ifaceIdOn(l, peerId) || '');
      const at = { peer, link: l, port: m ? Number(m[1]) : Infinity };
      if (!best || naturalCompare(peer.name, best.peer.name) < 0 || (peer.name === best.peer.name && at.port < best.port)) best = at;
    });
    return best ? { peer: best.peer, port: ifaceLabel(best.peer, ifaceIdOn(best.link, best.peer.id)), own: ifaceIdOn(best.link, node.id) || null } : null;
  }
  function legacyPatchPoint(node) {
    let best = null;
    linksAtNode(node.id).forEach((l) => {
      const peerId = l.source === node.id ? l.target : l.source;
      const peer = getNode(peerId);
      if (!hasPortGrid(peer)) return;
      const m = /^p(\d+)$/.exec(ifaceIdOn(l, peerId) || '');
      const at = { peer: peer.name || peer.id, port: m ? Number(m[1]) : Infinity };
      if (!best || naturalCompare(at.peer, best.peer) < 0 || (at.peer === best.peer && at.port < best.port)) best = at;
    });
    return best;
  }
  // Runs fn with a global function swapped for another, then puts it back.
  const swapped = (name, by, fn) => {
    const real = window[name];
    window[name] = by;
    try { return fn(); } finally { window[name] = real; }
  };
  const heldIfaceLabel = window.ifaceLabel;
  const upSig = (u) => (u ? `${u.peer.id}|${u.port}|${u.own}` : '-');
  const fullSig = (u) => (u ? `${u.peer.id}|${u.link.id}|${u.portId}|${u.label}|${u.own}` : '-');

  try {
    await loadScript('tests/fixtures/site300.js');
    await loadScript('tests/fixtures/site400.js');

    // ---- 1. Byte-identical on every template, sample and fixture ----
    const docs = Object.keys(templatesData).map((k) => [k, () => cloneData(templatesData[k])]);
    docs.push(['site300', () => topoSite300()], ['site400', () => topoSite400()]);
    const bad = { sheet: [], order: [], csv: [], patch: [], doc: [], pass: [] };
    let patched = 0, skipped = 0;
    docs.forEach(([key, make]) => {
      replaceDocument(make(), { origin: 'file' });
      const now = csvText(csvDevicesSheet());
      const was = swapped('csvUplink', legacyCsvUplink, () => csvText(csvDevicesSheet()));
      if (now !== was) bad.sheet.push(key);
      const orderNow = bulkOrder(state.nodes, 'port').map((n) => n.id).join(',');
      const orderWas = swapped('patchPoint', legacyPatchPoint, () => bulkOrder(state.nodes, 'port').map((n) => n.id).join(','));
      if (orderNow !== orderWas) bad.order.push(key);
      const byId = new Map(state.nodes.map((n) => [n.id, n]));
      state.nodes.forEach((n) => {
        [false, true].forEach((sheet) => { if (upSig(csvUplink(n, sheet)) !== upSig(legacyCsvUplink(n, sheet))) bad.csv.push(`${key}:${n.id}:${sheet}`); });
        if (JSON.stringify(patchPoint(n)) !== JSON.stringify(legacyPatchPoint(n))) bad.patch.push(`${key}:${n.id}`);
        if (legacyPatchPoint(n)) patched++;
        if (legacyCsvUplink(n) && !legacyCsvUplink(n, true)) skipped++;
        [{}, { skipNoPort: true }, { nameOrId: true }].forEach((o) => {
          const live = fullSig(uplinkOf(n, o));
          const asArray = fullSig(uplinkOf(n, Object.assign({ links: state.links, nodes: state.nodes }, o)));
          const asMap = fullSig(uplinkOf(n, Object.assign({ links: state.links, nodes: byId }, o)));
          if (live !== asArray || live !== asMap) bad.doc.push(`${key}:${n.id}:${JSON.stringify(o)}`);
          if (withLookupPass(() => fullSig(uplinkOf(n, o))) !== live) bad.pass.push(`${key}:${n.id}`);
        });
      });
    });
    const list = (a) => a.slice(0, 4).join(' ; ');
    ok(`devices.csv is byte for byte the old one on every template, sample and fixture (${docs.length})`, !bad.sheet.length, list(bad.sheet));
    ok('the bulk panel\'s switch-port order is the old one on every template, sample and fixture', !bad.order.length, list(bad.order));
    ok('csvUplink answers as before for every device, for the sheet and not', !bad.csv.length, list(bad.csv));
    ok('patchPoint answers as before for every device', !bad.patch.length, list(bad.patch));
    ok('the documents exercise it: hundreds of patched devices', patched > 500, `${patched} patched, ${skipped} with a cable the sheet passes over`);
    ok('a document\'s own lists (an array or a Map) give the open document\'s answer', !bad.doc.length, list(bad.doc));
    ok('inside a lookup pass the answer is the same', !bad.pass.length, list(bad.pass));

    // ---- 2. A copy is read without the open document ----
    replaceDocument(cloneData(templatesData.house), { origin: 'file' });
    const N = (id, type, name, extra) => Object.assign({ id, type, name, x: 0, y: 0, interfaces: [] }, extra || {});
    const L = (id, source, target, sourceIface, targetIface, extra) => Object.assign({ id, source, target, sourceIface, targetIface }, extra || {});
    // The switch has no portCount, so its faceplate's size (the port name)
    // comes from cables, and the open document is swapped for a decoy whose
    // same ids are cabled otherwise: every read of it is counted (a Proxy,
    // since linksAtNode is a const and no window property to spy on), and
    // an answer taken from it would be the wrong one.
    const copy = {
      nodes: [N('pc', 'pc', 'PC', { interfaces: [{ id: 'i1', name: 'eth0' }] }), N('sw', 'switch', 'Desk SW', { portScheme: { prefix: 'ge-', start: 1 } }),
        N('lap', 'router', 'Edge', { interfaces: [{ id: 'w1', name: 'eth0' }] }), N('ap', 'ap', 'Hall AP')],
      links: [L('c1', 'pc', 'sw', 'i1', 'p5'), L('lw', 'lap', 'ap', 'w1', null)]
    };
    const decoy = {
      nodes: [N('pc', 'pc', 'PC', { interfaces: [{ id: 'i1', name: 'eth0' }] }), N('sw', 'switch', 'Other SW', { portCount: 4 }),
        N('lap', 'laptop', 'Laptop', { interfaces: [{ id: 'w1', name: 'wlan0' }] }), N('ap', 'ap', 'Hall AP')],
      links: [L('d1', 'pc', 'sw', 'i1', 'p2'), L('lw', 'lap', 'ap', 'w1', null)]
    };
    const heldDoc = { nodes: state.nodes, links: state.links };
    let asked = 0, askedCopy = -1, askedHalf = -1;
    const counted = (list) => new Proxy(list, { get(t, k, r) { asked++; return Reflect.get(t, k, r); } });
    const heldGet = window.getNode;
    let fromCopy, lapCopy, lapCopyKeep, lapDecoy, nodesOnly, linksOnly, labelCalls = 0;
    try {
      state.nodes = counted(decoy.nodes); state.links = counted(decoy.links);
      window.getNode = function () { asked++; return heldGet.apply(this, arguments); };
      fromCopy = uplinkOf(copy.nodes[0], { links: copy.links, nodes: copy.nodes });
      if (fromCopy) void fromCopy.label;
      // The copy's 'lap' is a router cabled (eth0) with no port at the AP:
      // the sheet passes over it, though the decoy's 'lap' is a laptop on a
      // radio (wlan0). The device itself is not in the nodes given: the one passed in is used.
      lapCopy = uplinkOf(copy.nodes[2], { links: copy.links, nodes: [copy.nodes[3]], skipNoPort: true });
      lapCopyKeep = uplinkOf(copy.nodes[2], { links: copy.links, nodes: [copy.nodes[3]] });
      askedCopy = asked;
      // Nodes alone (or links alone) is still a document: the open one's
      // cables (or nodes) are not mixed in.
      asked = 0;
      nodesOnly = uplinkOf(copy.nodes[0], { nodes: copy.nodes });
      linksOnly = uplinkOf(copy.nodes[0], { links: copy.links });
      askedHalf = asked;
      window.getNode = heldGet;
      lapDecoy = uplinkOf(getNode('lap'), { skipNoPort: true });
    } finally { window.getNode = heldGet; state.nodes = heldDoc.nodes; state.links = heldDoc.links; }
    ok('a copy\'s lists are read without asking the open document (its lists, getNode), its port name included', askedCopy === 0 && fromCopy && fromCopy.peer === copy.nodes[1] && fromCopy.label === 'ge-5',
      `asked ${askedCopy}, ${fullSig(fromCopy)}`);
    ok('a copy\'s own device decides wired or wireless for skipNoPort, not the open document\'s twin',
      lapCopy === null && lapCopyKeep && lapCopyKeep.link.id === 'lw' && lapDecoy && lapDecoy.link.id === 'lw', `${fullSig(lapCopy)} / ${fullSig(lapDecoy)}`);
    ok('nodes alone or links alone reads nothing of the open document, the other counting as empty', askedHalf === 0 && nodesOnly === null && linksOnly === null,
      `asked ${askedHalf}, ${fullSig(nodesOnly)} / ${fullSig(linksOnly)}`);
    // A port past an explicit faceplate keeps the name it was given; a bare
    // number on the faceplate reads by the scheme: the document form says
    // what ifaceLabel says.
    {
      const past = {
        nodes: [N('h', 'pc', 'H', { interfaces: [{ id: 'i1' }, { id: 'i2' }] }),
          N('s', 'switch', 'S', { portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 }, interfaces: [{ id: 'p30', name: '30' }, { id: 'p3', name: '3' }] })],
        links: [L('x1', 'h', 's', 'i1', 'p30'), L('x2', 'h', 's', 'i2', 'p3')]
      };
      const held3 = { nodes: state.nodes, links: state.links };
      let docAns, liveAns, liveLbl;
      try {
        docAns = ['p30', 'p3', 'p40', 'e9', null].map((pid) => docPortLabel(past.nodes[1], pid, past.links));
        state.nodes = past.nodes; state.links = past.links;
        liveAns = ['p30', 'p3', 'p40', 'e9', null].map((pid) => ifaceLabel(past.nodes[1], pid));
        liveLbl = uplinkOf(past.nodes[0]).label;
      } finally { state.nodes = held3.nodes; state.links = held3.links; }
      ok('the document form names a port as ifaceLabel does, on the faceplate and past it', JSON.stringify(docAns) === JSON.stringify(liveAns)
        && JSON.stringify(docAns) === '["30","Gi1/0/3","Gi1/0/40","e9","—"]' && liveLbl === 'Gi1/0/3', `${JSON.stringify(docAns)} vs ${JSON.stringify(liveAns)}`);
    }
    // The bulk panel's sort asks for the uplink on every comparison and never
    // for the port's name, so the name is not worked out for it.
    replaceDocument(topoSite300(), { origin: 'file' });
    swapped('ifaceLabel', function () { labelCalls++; return heldIfaceLabel.apply(this, arguments); }, () => bulkOrder(state.nodes, 'port'));
    ok('sorting by switch port works out no port names', labelCalls === 0, `${labelCalls} ifaceLabel calls`);
    replaceDocument(cloneData(templatesData.house), { origin: 'file' });
    ok('and the answer has peer, link, portId, label and own', fromCopy && fromCopy.link.id === 'c1' && fromCopy.portId === 'p5' && fromCopy.label === 'ge-5' && fromCopy.own === 'i1'
      && Object.keys(fromCopy).join() === 'peer,link,portId,label,own', fromCopy && Object.keys(fromCopy).join());
    ok('a node missing from a copy is no peer, and no node is no answer', uplinkOf(copy.nodes[0], { links: copy.links, nodes: [copy.nodes[0]] }) === null && uplinkOf(null) === null);

    // ---- 3. The rule, case by case (a document's own lists, then the open one) ----
    const lab = () => ({
      nodes: [
        N('sw10', 'switch', 'SW 10', { portCount: 24 }),
        N('sw2', 'switch', 'SW 2', { portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 } }),
        N('ap', 'ap', 'Hall AP', { interfaces: [{ id: 'w1', name: 'wlan0', kind: 'wireless' }] }),
        N('rt', 'router', 'Edge', { interfaces: [{ id: 'e1', name: 'eth1' }] }),
        // Two NICs bonded, one cable each to SW 2 (ports 7 and 3), one to SW 10 port 1.
        N('srv', 'server', 'Host', { interfaces: [{ id: 'n1', name: 'eno1' }, { id: 'n2', name: 'eno2' }, { id: 'n3', name: 'eno3' },
          { id: 'b0', name: 'bond0', bond: { mode: 'active-backup', members: ['n1', 'n2'] } }] }),
        N('vm', 'vm', 'Web VM', { host: 'srv', interfaces: [{ id: 'i1', name: 'eth0' }] }),
        N('lap', 'laptop', 'Laptop', { interfaces: [{ id: 'w1', name: 'wlan0', kind: 'wireless' }] }),
        N('nop', 'pc', 'Rack PC', { interfaces: [{ id: 'i1', name: 'eth0' }] }),
        N('pcr', 'pc', 'Behind router', { interfaces: [{ id: 'i1', name: 'eth0' }] }),
        // Ties.
        N('coreA', 'switch', 'Core', { portCount: 8 }), N('coreB', 'switch', 'Core', { portCount: 8 }),
        N('lowc', 'switch', 'core', { portCount: 8 }),
        N('anonZ', 'switch', '', { portCount: 8 }), N('anonA', 'switch', '', { portCount: 8 }),
        N('same', 'pc', 'Same name', { interfaces: [{ id: 'i1' }, { id: 'i2' }] }),
        N('cased', 'pc', 'Case only', { interfaces: [{ id: 'i1' }, { id: 'i2' }] }),
        N('anon', 'pc', 'Unnamed peers', { interfaces: [{ id: 'i1' }, { id: 'i2' }] }),
        N('twin', 'pc', 'Two loose cables', { interfaces: [{ id: 'i1' }, { id: 'i2' }] })
      ],
      links: [
        L('b1', 'srv', 'sw2', 'n1', 'p7'), L('b2', 'srv', 'sw2', 'n2', 'p3'), L('b3', 'sw10', 'srv', 'p1', 'n3'),
        L('w', 'lap', 'ap', 'w1', null, { medium: 'wireless' }),
        L('np', 'nop', 'sw2', 'i1', null), L('np2', 'nop', 'sw10', 'i1', 'p20'),
        L('rl', 'pcr', 'rt', 'i1', 'e1'),
        L('t1', 'same', 'coreB', 'i1', 'p6'), L('t2', 'same', 'coreA', 'i2', 'p2'),
        L('c1', 'cased', 'lowc', 'i1', 'p8'), L('c2', 'cased', 'coreA', 'i2', 'p1'),
        L('a1', 'anon', 'anonZ', 'i1', 'p4'), L('a2', 'anon', 'anonA', 'i2', 'p6'),
        L('z1', 'twin', 'coreB', 'i1', null), L('z2', 'twin', 'coreA', 'i2', null)
      ]
    });
    const runCases = (where, up) => {
      const at = (id, o) => up(id, o || {});
      const srv = at('srv');
      ok(`${where}: lowest-named faceplate peer first, by natural order (SW 2 before SW 10)`, srv && srv.peer.id === 'sw2', fullSig(srv));
      ok(`${where}: a bond's two cables onto one switch give the lower port, named by the scheme`, srv && srv.link.id === 'b2' && srv.portId === 'p3' && srv.label === 'Gi1/0/3' && srv.own === 'n2', fullSig(srv));
      ok(`${where}: a VM on a host has no cable of its own and no uplink; the host's is the host's`, at('vm') === null && at('vm', { skipNoPort: true }) === null);
      const lap = at('lap'), lapSheet = at('lap', { skipNoPort: true });
      ok(`${where}: a laptop on Wi-Fi is patched to its AP with no port, kept by skipNoPort`, lap && lap.peer.id === 'ap' && lap.portId === null && lap.label === '—' && lap.own === 'w1'
        && lapSheet && lapSheet.link.id === 'w', fullSig(lap) + ' / ' + fullSig(lapSheet));
      const nop = at('nop'), nopSheet = at('nop', { skipNoPort: true });
      ok(`${where}: a wired cable with no port counts, after no other rule`, nop && nop.link.id === 'np' && nop.portId === null, fullSig(nop));
      ok(`${where}: skipNoPort passes over it to the next one`, nopSheet && nopSheet.link.id === 'np2' && nopSheet.label === '20', fullSig(nopSheet));
      ok(`${where}: a router is no faceplate`, at('pcr') === null && at('pcr', { nameOrId: true }) === null);
      const same = at('same');
      ok(`${where}: two switches with the same name: the lower port, whichever switch`, same && same.peer.id === 'coreA' && same.portId === 'p2', fullSig(same));
      const cased = at('cased');
      ok(`${where}: names equal in any case but not the same text keep the first met`, cased && cased.link.id === 'c1' && cased.peer.id === 'lowc', fullSig(cased));
      const anon = at('anon'), anonId = at('anon', { nameOrId: true });
      ok(`${where}: unnamed peers tie on name, so the lower port wins`, anon && anon.link.id === 'a1', fullSig(anon));
      const twin = at('twin');
      ok(`${where}: a full tie (same name, no port on either) keeps the first cable met`, twin && twin.link.id === 'z1' && at('twin', { skipNoPort: true }) === null, fullSig(twin));
      ok(`${where}: nameOrId sorts them by id instead`, anonId && anonId.peer.id === 'anonA' && anonId.portId === 'p6', fullSig(anonId));
      ok(`${where}: a switch cabled only to a server has no faceplate peer`, at('sw10') === null && at('sw10', { nameOrId: true }) === null);
    };
    const doc = lab();
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    runCases('a document', (id, o) => uplinkOf(byId.get(id), Object.assign({ links: doc.links, nodes: doc.nodes }, o)));
    // The same document as the open one: the lists read raw, as loaded.
    const held = { nodes: state.nodes, links: state.links };
    const live = lab();
    state.nodes = live.nodes; state.links = live.links;
    try { runCases('the open document', (id, o) => uplinkOf(getNode(id), o)); } finally { state.nodes = held.nodes; state.links = held.links; }

    // patchPoint and csvUplink on the same cases: their own shapes from it.
    state.nodes = live.nodes; state.links = live.links;
    try {
      ok('patchPoint gives the peer\'s name (else id) and the port number', JSON.stringify(patchPoint(getNode('srv'))) === '{"peer":"SW 2","port":3}'
        && JSON.stringify(patchPoint(getNode('anon'))) === '{"peer":"anonA","port":6}' && patchPoint(getNode('lap')).port === Infinity, JSON.stringify(patchPoint(getNode('anon'))));
      ok('csvUplink gives the peer, the port\'s name and the own end, and the sheet skips a cable with no port',
        csvUplink(getNode('srv')).port === 'Gi1/0/3' && csvUplink(getNode('srv')).own === 'n2' && csvUplink(getNode('nop')).port === '—' && csvUplink(getNode('nop'), true).port === '20');
      ok('both agree with the old code on every case', live.nodes.every((n) => upSig(csvUplink(n)) === upSig(legacyCsvUplink(n)) && upSig(csvUplink(n, true)) === upSig(legacyCsvUplink(n, true))
        && JSON.stringify(patchPoint(n)) === JSON.stringify(legacyPatchPoint(n))));
    } finally { state.nodes = held.nodes; state.links = held.links; }
  } catch (e) {
    ok('the suite ran', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
});
