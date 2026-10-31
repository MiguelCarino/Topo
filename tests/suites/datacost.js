// @realtime — what saving, the landing and the sheets cost (js/library.js,
// js/csv.js, js/bulk.js). Runs on Playwright's real clock, as idb.js does,
// because the library's IndexedDB store is part of it. Held here:
//   1. an autosave of one kept network among twenty large cards parses and
//      serializes that card, not the shelf: at most three large parses and
//      three large serializations, one put, the other cards' records left as
//      they were; and the text stored is byte for byte what the full rewrite
//      stores for the same save;
//   2. after a refused write the next save is the full rewrite again: every
//      card put and the refused delete repeated, the disk back in step;
//   3. the landing drawn a second time serializes no card (its summaries are
//      remembered by the card's stored text); an edited card's summary
//      follows the edit, and a new day recounts what has aged;
//   4. a stored document read inside an open lookup pass (withDoc,
//      canonicalDoc) is read as itself, not through the canvas's indexes;
//   5. cables.csv and devices.csv of 300 rows against the 300-device site
//      plan the same with and without the lookup pass (duplicate ids, a
//      self-loop, two cables between one pair told apart by port, a new
//      device over two rows), the cables plan reads the cable list a bounded
//      number of times, and each plan applied writes the same document,
//      inside a pass or not;
//   6. Re-cable onto a 48-port switch with 30 ports taken and a bond in the
//      set plans the same with and without the pass, in bounded scans, and
//      its write is the same inside a pass.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const settled = () => libraryWritesSettled().then(tick);
  const J = (x) => JSON.stringify(x);
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
  const rawCards = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(LIBRARY_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(LIBRARY_STORE, 'readonly');
      const st = tx.objectStore(LIBRARY_STORE);
      const keys = st.getAllKeys(); const vals = st.getAll();
      tx.oncomplete = () => { const o = {}; keys.result.forEach((k, i) => { o[k] = vals.result[i]; }); db.close(); resolve(o); };
    };
  });
  // Large parses and serializations while fn runs (over 10 KB: a card, not a field).
  const BIG = 10000;
  const spyJson = (fn) => {
    const rp = JSON.parse, rs = JSON.stringify;
    const c = { parse: 0, stringify: 0 };
    JSON.parse = function (s) { if (typeof s === 'string' && s.length > BIG) c.parse++; return rp.apply(this, arguments); };
    JSON.stringify = function () { const r = rs.apply(this, arguments); if (typeof r === 'string' && r.length > BIG) c.stringify++; return r; };
    try { fn(); } finally { JSON.parse = rp; JSON.stringify = rs; }
    return c;
  };
  // How many times the cable list is walked while fn runs (as perf.js counts).
  const SCANS = new Set(['filter', 'find', 'forEach', 'some', 'map', 'every', 'findIndex', 'reduce', 'flatMap']);
  const linkScans = (fn) => {
    const real = state.links;
    let n = 0;
    state.links = new Proxy(real, { get(target, key, recv) { if (SCANS.has(key)) n++; return Reflect.get(target, key, recv); } });
    try { fn(); } finally { state.links = real; }
    return n;
  };
  // The same new ids on every run: nextId is the clock plus a counter.
  const fixedIds = (fn) => {
    const realNow = Date.now, s0 = idSeq;
    Date.now = () => 1767225600000;
    idSeq = 50000;
    try { return fn(); } finally { Date.now = realNow; idSeq = Math.max(s0, idSeq); }
  };
  // fn with every lookup pass a plain call: the answers without the indexes.
  const realPass = window.withLookupPass;
  const unpassed = (fn) => {
    window.withLookupPass = (f) => f();
    try { return fn(); } finally { window.withLookupPass = realPass; }
  };

  const heldLib = loadLibrary();
  const adapter = libraryAdapter();
  const realWrite = adapter && adapter.write;
  const writes = [];
  const spyWrites = () => {
    adapter.write = function (w) {
      writes.push({ puts: [...w.puts.keys()], dels: [...w.dels], full: !!w.full });
      return realWrite.apply(this, arguments);
    };
  };
  try {
    ok('on a real clock the library opens in IndexedDB', libraryStoreKind() === 'idb', libraryStoreKind());
    if (libraryStoreKind() !== 'idb') throw new Error('no IndexedDB store');

    // ---- 1. One card written, the rest untouched ----
    // Twenty cards of about 200 KB each.
    const bigDoc = (k) => ({ v: DOC_VERSION, networks: [], links: [],
      nodes: Array.from({ length: 100 }, (_, i) => Object.assign({ id: `n${i}`, type: 'pc', name: `PC-${k}-${i}`, x: 40 * i, y: 60 * k,
        notes: `${k}/${i} `.padEnd(2000, 'x'), interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] },
        k === 1 && i === 0 ? { inService: '2024-01-01' } : {})) });
    const lib = {};
    for (let k = 0; k < 20; k++) lib[`dc${k}`] = { id: `dc${k}`, name: `Site ${k}`, doc: bigDoc(k), created: 1, updated: 1000 + k };
    persistLibrary(lib);
    await settled();
    let disk = await rawCards();
    ok('twenty large cards are on disk', Object.keys(disk).length === 20 && disk.dc0.length > 150000, `${Object.keys(disk).length} cards, ${disk.dc0 && disk.dc0.length} bytes`);

    replaceDocument(loadLibrary().dc0.doc, { libraryId: 'dc0', origin: 'library' });
    ok('the open network is the kept card', state.libraryId === 'dc0' && isKept(), String(state.libraryId));
    const diskBefore = await rawCards();
    spyWrites();
    state.nodes[0].name = 'Edited';
    save();
    writes.length = 0;
    const cost = spyJson(() => flushAutosave());
    ok('an autosave parses at most three large texts (not the shelf)', cost.parse <= 3, `${cost.parse} parsed`);
    ok('and serializes at most three (not the shelf)', cost.stringify <= 3, `${cost.stringify} serialized`);
    ok('it writes one card, in one put', writes.length === 1 && writes[0].puts.join() === 'dc0' && !writes[0].dels.length && !writes[0].full, J(writes));
    await settled();
    disk = await rawCards();
    ok('the card on disk is the text the library holds, with the edit',
      disk.dc0 === _cards.get('dc0') && JSON.parse(disk.dc0).doc.nodes[0].name === 'Edited');
    const others = Object.keys(diskBefore).filter((k) => k !== 'dc0');
    ok('the other nineteen records are as they were', others.length === 19 && others.every((k) => disk[k] === diskBefore[k]));

    // The same save down both paths: byte for byte the same text.
    {
      const realNow = Date.now;
      const T = Date.now() + 86400000;   // past every card's updated, so both stamp T
      const before = _cards.get('dc0');
      state.nodes[1].name = 'Twin';
      let one, full;
      Date.now = () => T;
      try {
        librarySave(null, 'dc0');
        one = _cards.get('dc0');
        _cards.set('dc0', before);           // as it was before that save
        _lastFailSeq = _writeSeq + 1;        // out of step: the next write is the full rewrite
        writes.length = 0;
        librarySave(null, 'dc0');
        full = _cards.get('dc0');
      } finally { Date.now = realNow; }
      ok('out of step, a save takes the full rewrite', writes.length === 1 && writes[0].full && writes[0].puts.length === 20, J(writes.map((w) => ({ n: w.puts.length, full: w.full }))));
      ok('and stores byte for byte what the one-card path stores', typeof one === 'string' && one === full, `${one && one.length} / ${full && full.length}`);
      await settled();
      ok('the full rewrite puts the disk back in step', !diskOutOfStep() && !storageFailed());
      disk = await rawCards();
      ok('with that text on disk', disk.dc0 === full);
    }

    // ---- 2. After a refusal, the full path and the deletes again ----
    adapter.write = () => Promise.resolve(false);
    libraryDelete('dc19');
    await settled();
    ok('a refused delete leaves the disk out of step', diskOutOfStep() && storageFailed());
    spyWrites();
    writes.length = 0;
    state.nodes[2].name = 'After the refusal';
    save();
    flushAutosave();
    ok('the next save is the full rewrite, repeating the delete',
      writes.length === 1 && writes[0].full && writes[0].dels.includes('dc19') && writes[0].puts.length === 19, J(writes.map((w) => ({ n: w.puts.length, dels: w.dels, full: w.full }))));
    await settled();
    disk = await rawCards();
    ok('and the disk has every card and not the deleted one', !('dc19' in disk) && Object.keys(disk).length === 19
      && Object.keys(disk).every((k) => disk[k] === _cards.get(k)) && !diskOutOfStep() && !storageFailed());
    writes.length = 0;
    state.nodes[3].name = 'In step again';
    save();
    flushAutosave();
    ok('back in step, a save is one card again', writes.length === 1 && writes[0].puts.join() === 'dc0' && !writes[0].full, J(writes));
    await settled();
    adapter.write = realWrite;

    // ---- 3. The landing's summaries ----
    renderLanding();
    const landing = spyJson(() => renderLanding());
    ok('the landing drawn again serializes no card', landing.stringify === 0, `${landing.stringify} serialized`);
    ok('it draws every card', document.querySelectorAll('#landingCards .landing-card').length === 19);
    const entry = (id) => libraryEntries().find((e) => e.id === id);
    ok('a card handed out carries the text it was read from', libraryRawOf(entry('dc1')) === _cards.get('dc1'));
    state.nodes.push({ id: 'extra', type: 'pc', name: 'Extra', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] });
    save();
    flushAutosave();
    await settled();
    renderLanding();
    {
      const e0 = entry('dc0');
      const s = librarySummary(e0.doc, libraryRawOf(e0));
      const stats = document.querySelector('#landingCards .landing-card[data-id="dc0"] .landing-card-stats');
      ok('an edited card’s summary follows the edit', s.devices === 101 && !!stats && stats.textContent.includes('101'), `${s.devices} / ${stats && stats.textContent}`);
    }
    {
      const e1 = entry('dc1'), raw1 = libraryRawOf(e1);
      const realToday = window.todayISO;
      const a0 = librarySummary(e1.doc, raw1).advisory, d0 = librarySummary(e1.doc).advisory;
      let a1, d1;
      window.todayISO = () => '2031-06-01';
      try { a1 = librarySummary(e1.doc, raw1).advisory; d1 = librarySummary(e1.doc).advisory; }
      finally { window.todayISO = realToday; }
      ok('a new day recounts what has aged, by the card’s text', a1 === a0 + 1, `${a0} -> ${a1}`);
      ok('and by the document’s, with no text given', d1 === d0 + 1 && d0 === a0, `${d0} -> ${d1}`);
      ok('and today again counts as today', librarySummary(e1.doc, raw1).advisory === a0);
    }
    {
      // A guest site with a library card's id: its own summary, not the card's.
      const e2 = entry('dc2');
      const guest = { id: 'dc2', name: 'Shared', doc: templatesData.errors, created: 1, updated: 1 };
      // The landing above has already summarised dc2's card by its text.
      const sc = librarySummary(e2.doc, libraryRawOf(e2)), want = templatesData.errors.nodes.length;
      const ownCount = (s) => !!s && new RegExp(`(^|\\D)${want} device`).test(s.textContent);
      try {
        setGuestBinder({ sites: [guest] });
        renderGuestSection();
        const gs = document.querySelector('#guestCards .landing-card[data-id="dc2"] .landing-card-stats');
        ok('a guest card is summarised by its own document', sc.devices !== want && ownCount(gs), `${gs && gs.textContent} / card ${sc.devices}`);
        const card = landingCard(guest, { guest: true }).querySelector('.landing-card-stats');
        ok('and so is one drawn on its own', ownCount(card), card && card.textContent);
      } finally {
        setGuestBinder(null);
        renderGuestSection();
      }
    }

    // ---- 4. A stored document inside an open pass ----
    {
      const other = templatesData.errors;
      const outside = J(withDoc(other, () => topologyFindings()));
      const inside = J(withLookupPass(() => withDoc(other, () => topologyFindings())));
      ok('withDoc inside a pass finds what it finds outside one', inside === outside && outside !== J(topologyFindings()));
      ok('canonicalDoc inside a pass writes what it writes outside one', J(withLookupPass(() => canonicalDoc(other))) === J(canonicalDoc(other)));
      _summaryMemo.clear();
      const summed = withLookupPass(() => librarySummary(other));
      _summaryMemo.clear();
      const plainSum = librarySummary(other);
      ok('so does a summary', J(summed) === J(plainSum) && summed.devices === other.nodes.length && !summed.unreadable, `${J(summed)} / ${J(plainSum)}`);
      ok('and the pass is closed afterwards', lookupPass === null);
    }
  } catch (e) {
    ok('the library half ran to the end', false, String(e && e.stack || e));
  } finally {
    if (adapter) adapter.write = realWrite;
    cancelAutosave();
  }

  try {
    // ---- 5. cables.csv and devices.csv at site scale ----
    await loadScript('tests/fixtures/site300.js');
    replaceDocument(topoSite300(), { origin: 'file' });
    // What a loaded document would not hold, put in as a sheet may meet it:
    // a second device under a taken id, a self-loop, a second cable between
    // the core and SW-ACC-1.
    state.nodes.push(Object.assign(cloneData(getNode('h150')), { name: 'DUP-150', x: 9000, y: 9000 }));
    state.links.push({ id: 'LSELF', source: 'sw3', target: 'sw3', sourceIface: 'p47', targetIface: 'p48' });
    state.links.push({ id: 'LPAR', source: 'core', target: 'sw1', sourceIface: 'p40', targetIface: 'p47' });
    const up = state.links.find((l) => l.id !== 'LPAR' && ((l.source === 'core' && l.target === 'sw1') || (l.source === 'sw1' && l.target === 'core')));
    const sheetOf = (rows) => csvSheet(csvParse(rows.map((r) => r.join(',')).join('\n')), true);

    const cab = [['id', 'source', 'source_port', 'target', 'target_port', 'label']];
    for (let k = 1; k <= 150; k++) cab.push([`L${k}`, '', '', '', '', `LBL-${k}`]);
    for (let k = 151; k <= 250; k++) {
      const l = getLink(`L${k}`);
      if (!l) continue;
      const end = (id) => (k % 3 ? id : (getNode(id).name || id));
      cab.push(['', end(l.source), l.sourceIface || '', end(l.target), l.targetIface || '', `PAIR-${k}`]);
    }
    cab.push(['', 'sw3', 'p47', 'sw3', 'p48', 'SELF']);
    cab.push(['', 'sw4', '', 'sw4', '', 'SELF-NEW']);
    cab.push(['', 'core', 'p40', 'sw1', 'p47', 'PAR-A']);
    if (up) cab.push(['', up.source, up.sourceIface || '', up.target, up.targetIface || '', 'PAR-B']);
    cab.push(['', 'core', '', 'sw1', '', 'PAR-?']);
    cab.push(['', 'h150', 'eth1', 'sw5', 'p44', 'DUP']);
    const hosts = state.nodes.filter((n) => /^h\d+$/.test(n.id));
    for (let j = 0; cab.length < 301; j++) cab.push(['', hosts[j % hosts.length].id, 'eth9', 'sw6', `p${1 + (j % 48)}`, `NEW-${j}`]);
    const cabMap = ['lk:id', 'lk:source', 'lk:sourceIface', 'lk:target', 'lk:targetIface', 'lk:cable.label'];
    const cabSheet = sheetOf(cab);
    ok('cables.csv has 300 rows', cabSheet.rows.length === 300, String(cabSheet.rows.length));

    const dev = [['name', 'type', 'ip', 'switch', 'port']];
    hosts.slice(0, 120).forEach((n, i) => dev.push([n.name, '', '', 'SW-ACC-2', String(1 + (i % 48))]));
    dev.push(['NEW-MULTI', 'server', '10.20.10.200/24', 'SW-ACC-3', '40']);
    dev.push(['NEW-MULTI', 'server', '10.20.10.201/24', 'SW-ACC-3', '41']);
    for (let j = 0; dev.length < 301; j++) dev.push([`NEW-${j}`, 'pc', `10.20.21.${1 + (j % 250)}/23`, 'SW-ACC-4', String(1 + (j % 48))]);
    const devSheet = sheetOf(dev);
    const devMap = csvAutoMap(devSheet);
    ok('devices.csv has 300 rows and a switch column', devSheet.rows.length === 300 && devMap.includes('cab:switch') && devMap.includes('cab:port'), devMap.join());

    const scratch = () => cloneData({ nodes: state.nodes, links: state.links, networks: state.networks, groups: state.groups, wifi: state.wifi });
    [['cables', cabSheet, cabMap], ['devices', devSheet, devMap]].forEach(([kind, sheet, map]) => {
      const realPlan = fixedIds(() => csvPlan(sheet, map));
      const plainPlan = unpassed(() => fixedIds(() => csvPlan(sheet, map)));
      ok(`${kind}.csv plans the same with and without the pass`, J(realPlan) === J(plainPlan) && realPlan.rows.length >= (kind === 'cables' ? 300 : 1) && !realPlan.errors.length,
        `${realPlan.rows.length} rows: ${J(realPlan.counts)}`);
      const a = scratch(), b = scratch(), c = scratch();
      fixedIds(() => csvWrite(realPlan, a));
      unpassed(() => fixedIds(() => csvWrite(plainPlan, b)));
      fixedIds(() => withLookupPass(() => csvWrite(realPlan, c)));
      ok(`${kind}.csv applied writes the same document on both paths`, J(a) === J(b) && J(a) !== J(scratch()));
      ok(`${kind}.csv applied inside an open pass writes the same document`, J(c) === J(a));
    });
    {
      const real = linkScans(() => fixedIds(() => csvPlan(cabSheet, cabMap)));
      const plain = unpassed(() => linkScans(() => fixedIds(() => csvPlan(cabSheet, cabMap))));
      ok('cables.csv reads the cable list a bounded number of times', real <= 10 && real < plain, `${real} scans (${plain} without the pass)`);
    }
    {
      const p = csvPlan(cabSheet, cabMap);
      const row = (label) => p.rows.find((r) => cab[r.index + 1] && cab[r.index + 1][5] === label);
      const self = row('SELF'), parA = row('PAR-A'), amb = row('PAR-?');
      ok('the self-loop row finds the self-loop', !!self && self.linkId === 'LSELF', self && `${self.status} ${self.linkId} ${self.why}`);
      ok('a port tells the two cables of one pair apart', !!parA && parA.linkId === 'LPAR', parA && `${parA.status} ${parA.linkId} ${parA.why}`);
      ok('and with no port the pair is a conflict', !!amb && amb.status === 'conflict', amb && amb.status);
      ok('the plans leave no pass open', lookupPass === null);
    }

    // ---- 6. Re-cable at switch scale ----
    const pc = (id, x) => ({ id, type: 'pc', name: id.toUpperCase(), x, y: 400, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] });
    const nodes = [
      { id: 'tsw', type: 'switch', name: 'SW-NEW', x: 600, y: 100, portCount: 48,
        interfaces: [{ id: 'p31', name: 'Po1', bond: { mode: '802.3ad', members: ['p35', 'p36'] } }] },
      { id: 'osw', type: 'switch', name: 'SW-OLD', x: 200, y: 100, portCount: 48, interfaces: [] },
      { id: 'srv', type: 'server', name: 'SRV', x: 300, y: 300, interfaces: [
        { id: 'e0', name: 'eth0', ip: '' }, { id: 'e1', name: 'eth1', ip: '' },
        { id: 'b0', name: 'bond0', ip: '10.0.0.5/24', bond: { mode: 'active-backup', members: ['e0', 'e1'] } }] }
    ];
    const links = [
      { id: 'ls0', source: 'osw', target: 'srv', sourceIface: 'p30', targetIface: 'e0' },
      { id: 'ls1', source: 'osw', target: 'srv', sourceIface: 'p31', targetIface: 'e1' }
    ];
    for (let i = 1; i <= 24; i++) { nodes.push(pc(`pc${i}`, 40 * i)); links.push({ id: `lp${i}`, source: 'osw', target: `pc${i}`, sourceIface: `p${i}`, targetIface: 'i1' }); }
    for (let i = 1; i <= 30; i++) { nodes.push(pc(`x${i}`, 40 * i)); links.push({ id: `lx${i}`, source: 'tsw', target: `x${i}`, sourceIface: `p${i}`, targetIface: 'i1' }); }
    for (let i = 1; i <= 3; i++) nodes.push(pc(`loose${i}`, 1200 + 40 * i));
    replaceDocument({ v: DOC_VERSION, networks: [], nodes, links }, { origin: 'file' });
    const ids = ['tsw', 'srv', 'loose1', 'loose2', 'loose3'].concat(Array.from({ length: 20 }, (_, i) => `pc${i + 1}`));
    const req = { action: 'recable', ids, recable: { target: 'tsw', from: '', order: 'port' } };
    const realPlan = fixedIds(() => bulkPlan(req));
    const plainPlan = unpassed(() => fixedIds(() => bulkPlan(req)));
    ok('Re-cable plans the same with and without the pass', J(realPlan) === J(plainPlan) && realPlan.rows.length === ids.length, J(realPlan.counts));
    const taken = new Set(Array.from({ length: 30 }, (_, i) => `p${i + 1}`));
    if (isBond(explicitIface(getNode('tsw'), 'p31'))) taken.add('p31');
    const given = realPlan.ops.map((op) => (op.addLink ? op.addLink.sourceIface : op.set && (op.set.sourceIface || op.set.targetIface))).filter(Boolean);
    ok('onto free ports only', given.length > 0 && given.every((p) => !taken.has(p)), given.join());
    {
      const real = linkScans(() => bulkPlanRecable(ids, req.recable));
      const plain = unpassed(() => linkScans(() => bulkPlanRecable(ids, req.recable)));
      ok('Re-cable reads the cable list a bounded number of times', real <= 8 && real < plain, `${real} scans (${plain} without the pass)`);
    }
    {
      const scratchB = () => cloneData({ nodes: state.nodes, links: state.links, networks: state.networks, groups: state.groups, wifi: state.wifi });
      const a = scratchB(), b = scratchB();
      fixedIds(() => bulkWrite(realPlan, a));
      fixedIds(() => withLookupPass(() => bulkWrite(realPlan, b)));
      ok('its write is the same inside an open pass', J(a) === J(b) && J(a) !== J(scratchB()));
    }
    ok('and no pass is left open', lookupPass === null && window.withLookupPass === realPass);
  } catch (e) {
    ok('the sheets half ran to the end', false, String(e && e.stack || e));
  } finally {
    window.withLookupPass = realPass;
    cancelAutosave();
    persistLibrary(heldLib);
    await settled();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 0); });
