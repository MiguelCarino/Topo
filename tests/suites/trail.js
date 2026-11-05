// Address and location history, stage 1: the trail store (docs/BACKLOG.md,
// feature 5; js/trail.js). Not tests/suites/history.js: that is the undo suite.
// Asserted here:
//   1. observeDoc: per device, ip and mac per interface id (the MAC
//      normalised), the switch port as peerId|pN read as "SW · Gi1/0/12" (the
//      devices sheet's uplinkOf, skipNoPort), the group as its id read as its
//      path, the name; the open document never read;
//   2. the spans: an unchanged value extends `last`, a changed one starts a
//      new span; a switch renamed is not a move (the txt keeps the old label);
//      a device removed is gone, one back clears it; a value missing at a
//      point and back later is a new span, never the old one stretched over
//      its absence; ids naming Object.prototype members are devices like any
//      other; the same point twice changes nothing, an older one goes in first;
//   3. the bounds: 17 changes keep 16 spans, 201 points keep 200 and drop the
//      spans that ended before, a gone device pruned after 400 days, the
//      6,000-span cap taking gone devices first, then the oldest spans, and
//      never a value held at the newest point;
//   4. validTrail: a record from disk cleaned, junk refused;
//   5. the hooks: Back up this network, Back up all (every card) and a report
//      handed over each record exactly one point of the right kind; a report
//      only previewed, a network that is not kept, a read-only one, a card
//      from a newer Topo (open or not) and the setting off record none; deleting a card drops its trail; undo and
//      redo leave it as it was and the undo timeline holds none of it;
//   6. privacy: a value only the trail holds is in no document, link, card,
//      binder, back-up file, CSV sheet, localStorage key or history entry;
//   7. the store: a disk's trails adopted (junk skipped, a newer one here
//      written over the disk's), writes and deletes reaching it, points
//      recorded while the store opens joined to the disk's history, this
//      tab only without IndexedDB (as here).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const T = window.CarinoTrail;
  const L = window.CarinoLibrary;
  const C = window.CarinoChanges;
  const { LIBRARY_KEY, BINDER_EXPORT_KEY } = L;
  const held = [LIBRARY_KEY, BINDER_EXPORT_KEY].map((k) => [k, localStorage.getItem(k)]);
  const heldLib = L.loadLibrary();
  const heldResponder = setDialogResponder(() => undefined);
  const realDownload = window.downloadJson, realDeliver = window.deliverReport, realCapture = window.captureCanvasImage;
  const heldSetting = state.settings.trailRecording;
  let downloads = [];
  window.downloadJson = (payload, name) => { downloads.push({ payload: JSON.parse(JSON.stringify(payload)), name }); };
  let handOver = true;
  window.deliverReport = (html, meta, kind, onKept) => { if (handOver && onKept) onKept(); return { opened: true }; };
  window.captureCanvasImage = async () => null;
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const site = () => ({
    v: DOC_VERSION,
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 24, interfaces: [{ id: 'p12', name: 'Gi1/0/12' }] },
      { id: 'pc', type: 'pc', name: 'PC-1', x: 100, y: 200, group: 'r3',
        interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24', mac: 'aa-bb-cc-00-11-22' }, { id: 'i2', name: 'wlan0', ip: '' }] },
      { id: 'cam', type: 'camera', name: 'CAM-TRAIL-ONLY-5521', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.77/24' }] }
    ],
    links: [
      { id: 'up', source: 'rt', target: 'sw', sourceIface: 'e0', targetIface: 'p24' },
      { id: 'a', source: 'sw', target: 'pc', sourceIface: 'p12', targetIface: 'i1' },
      { id: 'b', source: 'sw', target: 'cam', sourceIface: 'p5', targetIface: 'i1' }
    ],
    groups: [{ id: 'b1', name: 'Building A', kind: 'building' }, { id: 'r3', name: 'Rack 3', kind: 'rack', parent: 'b1' }],
    networks: [{ id: 'lan', cidr: '192.168.1.0/24', name: 'LAN' }]
  });
  const spansOf = (trail, id, f, k = '') => ((trail.devices[id] || {}).spans || []).filter((s) => s.f === f && s.k === k);

  try {
    setLocale('en');
    // ---- 1. observeDoc ----
    const openBefore = JSON.stringify(serializeDoc());
    const obs = T.observeDoc(site());
    ok('the open document is not changed by it', JSON.stringify(serializeDoc()) === openBefore);
    const pcObs = obs.pc.values;
    const val = (f, k = '') => pcObs.find((v) => v.f === f && v.k === k);
    ok('an address per interface id, as typed', !!val('ip', 'i1') && val('ip', 'i1').val === '192.168.1.20/24' && val('ip', 'i1').txt === '192.168.1.20/24', JSON.stringify(pcObs));
    ok('a blank address is not a value', !val('ip', 'i2'));
    ok('the MAC normalised, read in colons', !!val('mac', 'i1') && val('mac', 'i1').val === 'AABBCC001122' && val('mac', 'i1').txt === 'AA:BB:CC:00:11:22', JSON.stringify(val('mac', 'i1')));
    ok('the switch port as peerId|pN', !!val('port') && val('port').val === 'sw|p12', JSON.stringify(val('port')));
    ok('read as the switch and the port’s name', val('port').txt === 'SW · Gi1/0/12', val('port').txt);
    ok('the group by id, read as its path', !!val('group') && val('group').val === 'r3' && val('group').txt === 'Building A / Rack 3', JSON.stringify(val('group')));
    ok('the name', !!val('name') && val('name').val === 'PC-1' && obs.pc.name === 'PC-1');
    ok('the port is the devices sheet’s', (() => {
      replaceDocument(site(), { origin: 'file' });
      const up = csvUplink(getNode('pc'), true);
      return up && `${up.peer.name} · ${up.port}` === val('port').txt;
    })());
    replaceDocument(JSON.parse(openBefore), { origin: 'file' });
    ok('a switch cabled only to a router has no port span (a router has no faceplate)', !obs.sw.values.some((v) => v.f === 'port'));
    ok('every device observed', Object.keys(obs).sort().join() === 'cam,pc,rt,sw');
    // An older build's copy reads as this build's (canonicalDoc).
    const old = site(); delete old.v;
    ok('an older copy reads the same', JSON.stringify(T.observeDoc(old)) === JSON.stringify(obs));

    // ---- 2. The spans ----
    let tr = T.mergeObservation(null, obs, 1000, 'backup');
    ok('a first point starts a span per value', spansOf(tr, 'pc', 'ip', 'i1').length === 1 && spansOf(tr, 'pc', 'ip', 'i1')[0].first === 1000
       && spansOf(tr, 'pc', 'ip', 'i1')[0].last === 1000 && tr.points.length === 1 && tr.points[0].kind === 'backup', JSON.stringify(tr.points));
    const same = T.mergeObservation(tr, obs, 2000, 'report');
    const ipSame = spansOf(same, 'pc', 'ip', 'i1');
    ok('an unchanged value only extends last', ipSame.length === 1 && ipSame[0].first === 1000 && ipSame[0].last === 2000 && ipSame[0].kind === 'report', JSON.stringify(ipSame));
    ok('the input record is not changed', spansOf(tr, 'pc', 'ip', 'i1')[0].last === 1000);
    const moved = site(); moved.nodes[2].interfaces[0].ip = '192.168.1.30/24';
    tr = T.mergeObservation(same, T.observeDoc(moved), 3000, 'backup');
    const ipMoved = spansOf(tr, 'pc', 'ip', 'i1');
    ok('a changed address starts a new span', ipMoved.length === 2 && ipMoved[0].val === '192.168.1.20/24' && ipMoved[0].last === 2000
       && ipMoved[1].val === '192.168.1.30/24' && ipMoved[1].first === 3000 && ipMoved[1].last === 3000, JSON.stringify(ipMoved));
    ok('the other values extended', spansOf(tr, 'pc', 'mac', 'i1').length === 1 && spansOf(tr, 'pc', 'mac', 'i1')[0].last === 3000);
    // Back to the first address: a new span, not the old one stretched.
    tr = T.mergeObservation(tr, T.observeDoc(site()), 4000, 'backup');
    ok('a value back again is a third span', spansOf(tr, 'pc', 'ip', 'i1').length === 3 && spansOf(tr, 'pc', 'ip', 'i1')[2].val === '192.168.1.20/24');
    // A switch renamed is not a move.
    const renamed = site(); renamed.nodes[1].name = 'SW-02';
    tr = T.mergeObservation(tr, T.observeDoc(renamed), 5000, 'backup');
    const port = spansOf(tr, 'pc', 'port');
    ok('a switch renamed is not a port change', port.length === 1 && port[0].val === 'sw|p12' && port[0].last === 5000, JSON.stringify(port));
    ok('the text keeps how it read', port[0].txt === 'SW · Gi1/0/12');
    ok('the switch’s own name is a new span', spansOf(tr, 'sw', 'name').map((s) => s.val).join() === 'SW,SW-02');
    // Replugged: a new port span.
    const repl = site(); repl.links[1].sourceIface = 'p7';
    tr = T.mergeObservation(tr, T.observeDoc(repl), 6000, 'report');
    ok('a device replugged is a new port span', spansOf(tr, 'pc', 'port').map((s) => s.val).join() === 'sw|p12,sw|p7');
    // Removed, then back.
    const without = site(); without.nodes.splice(3, 1); without.links.splice(2, 1);
    tr = T.mergeObservation(tr, T.observeDoc(without), 7000, 'backup');
    ok('a device removed is gone', tr.devices.cam && tr.devices.cam.gone === 7000, JSON.stringify(tr.devices.cam && tr.devices.cam.gone));
    ok('its spans kept', spansOf(tr, 'cam', 'ip', 'i1').length === 1 && spansOf(tr, 'cam', 'ip', 'i1')[0].last === 6000);
    tr = T.mergeObservation(tr, T.observeDoc(without), 7500, 'backup');
    ok('and stays gone from when it went', tr.devices.cam.gone === 7000);
    tr = T.mergeObservation(tr, T.observeDoc(site()), 8000, 'backup');
    ok('a device back clears gone', tr.devices.cam.gone === null);
    const camBack = spansOf(tr, 'cam', 'ip', 'i1');
    ok('and its values held again are new spans, not the old ones stretched over its absence', camBack.length === 2
       && camBack[0].first === 1000 && camBack[0].last === 6000 && camBack[1].first === 8000 && camBack[1].last === 8000, JSON.stringify(camBack));
    const twice = T.mergeObservation(tr, T.observeDoc(moved), 8000, 'backup');
    ok('the same point twice is one point', JSON.stringify(twice) === JSON.stringify(tr));
    const older = T.mergeObservation(tr, T.observeDoc(moved), 10, 'file');
    ok('an older point goes in first (stage 4, tests/suites/trailreadin.js)', older.points[0].at === 10 && older.points[0].kind === 'file'
       && older.points.length === tr.points.length + 1 && spansOf(older, 'pc', 'ip', 'i1').some((s) => s.first === 10 && s.last === 10 && s.val === '192.168.1.30/24'), JSON.stringify(older.points.slice(0, 2)));
    ok('a point of no known kind changes nothing', JSON.stringify(T.mergeObservation(tr, obs, 9000, 'nonsense')) === JSON.stringify(tr));
    ok('the points stay sorted', tr.points.every((p, i) => i === 0 || tr.points[i - 1].at < p.at));
    // A value missing at a middle point (cleared, unplugged) and back: two spans.
    const cleared = site(); cleared.nodes[2].interfaces[0].ip = ''; cleared.links.splice(1, 1);
    let gap = T.mergeObservation(null, obs, 1, 'backup');
    gap = T.mergeObservation(gap, T.observeDoc(cleared), 2, 'backup');
    gap = T.mergeObservation(gap, obs, 3, 'backup');
    const gapIp = spansOf(gap, 'pc', 'ip', 'i1'), gapPort = spansOf(gap, 'pc', 'port');
    ok('an address cleared at a point and typed again is two spans', gapIp.length === 2 && gapIp[0].first === 1 && gapIp[0].last === 1
       && gapIp[1].first === 3 && gapIp[1].last === 3, JSON.stringify(gapIp));
    ok('a cable unplugged at a point and plugged back into the same port is two spans', gapPort.length === 2 && gapPort[0].last === 1 && gapPort[1].first === 3, JSON.stringify(gapPort));
    ok('a value held at every point is still one span', spansOf(gap, 'pc', 'mac', 'i1').length === 1 && spansOf(gap, 'pc', 'mac', 'i1')[0].first === 1
       && spansOf(gap, 'pc', 'mac', 'i1')[0].last === 3);
    // Two devices never both hold one address at one point through a stretched span.
    const handed = site(); handed.nodes[2].interfaces[0].ip = ''; handed.nodes[3].interfaces[0].ip = '192.168.1.20/24';
    let reuse = T.mergeObservation(null, obs, 1, 'backup');
    reuse = T.mergeObservation(reuse, T.observeDoc(handed), 2, 'backup');
    reuse = T.mergeObservation(reuse, obs, 3, 'backup');
    const holdsAt = (dev, at) => spansOf(reuse, dev, 'ip', 'i1').some((s) => s.val === '192.168.1.20/24' && s.first <= at && s.last >= at);
    ok('an address handed to another device for a point is held by one device at that point', holdsAt('cam', 2) && !holdsAt('pc', 2) && holdsAt('pc', 3));
    // Device ids from a file that name Object.prototype members are devices like any other.
    const protoDoc = { v: DOC_VERSION, nodes: [
      { id: 'constructor', type: 'pc', name: 'PC-C', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.1/24' }] },
      { id: '__proto__', type: 'pc', name: 'PC-P', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.2/24' }] },
      { id: 'toString', type: 'pc', name: 'PC-T', x: 0, y: 0, interfaces: [] }], links: [] };
    const protoObs = T.observeDoc(protoDoc);
    ok('ids such as constructor and __proto__ are observed', Object.keys(protoObs).sort().join() === '__proto__,constructor,toString', Object.keys(protoObs).join());
    let protoTr = T.mergeObservation(null, protoObs, 1, 'backup');
    protoTr = T.mergeObservation(protoTr, protoObs, 2, 'backup');
    ok('and recorded, nothing global touched', spansOf(protoTr, 'constructor', 'ip', 'i1').length === 1 && spansOf(protoTr, 'constructor', 'ip', 'i1')[0].last === 2
       && spansOf(protoTr, '__proto__', 'ip', 'i1').length === 1 && spansOf(protoTr, 'toString', 'name').length === 1 && !('gone' in Object), JSON.stringify(protoTr));
    const protoBack = T.validTrail(JSON.parse(JSON.stringify(protoTr)));
    ok('and they read back from disk', !!protoBack && Object.keys(protoBack.devices).sort().join() === '__proto__,constructor,toString');
    protoTr = T.mergeObservation(protoTr, T.observeDoc({ v: DOC_VERSION, nodes: [], links: [] }), 3, 'backup');
    ok('and go when removed', protoTr.devices.constructor.gone === 3 && protoTr.devices.__proto__.gone === 3, JSON.stringify(protoTr.devices));

    // ---- 3. The bounds ----
    let many = null;
    for (let i = 0; i < 17; i++) {
      const d = site(); d.nodes[2].interfaces[0].ip = `192.168.1.${100 + i}/24`;
      many = T.mergeObservation(many, T.observeDoc(d), 10000 + i, 'backup');
    }
    const kept16 = spansOf(many, 'pc', 'ip', 'i1');
    ok('17 changes keep 16 spans', kept16.length === T.TRAIL_SPANS_PER_KEY && kept16.length === 16, String(kept16.length));
    ok('the oldest dropped first', !kept16.some((s) => s.val === '192.168.1.100/24') && kept16.some((s) => s.val === '192.168.1.116/24'));
    // 201 points: the first one's only span ends before the oldest kept point.
    let pts = T.mergeObservation(null, T.observeDoc(moved), 1, 'backup');
    for (let i = 0; i < 200; i++) pts = T.mergeObservation(pts, obs, 100 + i, 'backup');
    ok('201 points keep 200', pts.points.length === 200 && pts.points[0].at === 100, `${pts.points.length} ${pts.points[0].at}`);
    ok('and the spans that ended before the oldest are dropped', !spansOf(pts, 'pc', 'ip', 'i1').some((s) => s.val === '192.168.1.30/24')
       && spansOf(pts, 'pc', 'ip', 'i1').length === 1, JSON.stringify(spansOf(pts, 'pc', 'ip', 'i1')));
    ok('a span that ran into the kept points stays', spansOf(pts, 'pc', 'mac', 'i1').length === 1 && spansOf(pts, 'pc', 'mac', 'i1')[0].first === 1);
    // A gone device is pruned 400 days after its last span.
    const day = 24 * 60 * 60 * 1000;
    let aged = T.mergeObservation(null, obs, day, 'backup');
    aged = T.mergeObservation(aged, T.observeDoc(without), 2 * day, 'backup');
    const at399 = T.mergeObservation(aged, T.observeDoc(without), 400 * day, 'backup');
    ok('a gone device is kept within 400 days', !!at399.devices.cam);
    const at402 = T.mergeObservation(at399, T.observeDoc(without), 402 * day, 'backup');
    ok('and pruned after them', !at402.devices.cam && !!at402.devices.pc);
    // The card's cap: gone devices first.
    // A newest point at 3 that saw none of them: every span is past.
    const big = { v: 1, points: [{ at: 1, kind: 'backup' }, { at: 2, kind: 'backup' }, { at: 3, kind: 'backup' }], devices: {} };
    for (let n = 0; n < 400; n++) {
      const spans = [];
      for (let s = 0; s < 16; s++) spans.push({ f: 'ip', k: 'i' + s, val: `10.${n}.${s}.1`, txt: `10.${n}.${s}.1`, first: 1, last: 2, kind: 'backup' });
      big.devices['n' + n] = { name: 'N' + n, gone: n < 20 ? 2 : null, spans };
    }
    const capped = T.pruneTrail(JSON.parse(JSON.stringify(big)), 4);
    const count = (t) => Object.values(t.devices).reduce((m, d) => m + d.spans.length, 0);
    ok('the 6,000-span cap holds', count(capped) <= T.TRAIL_SPANS_MAX && count(capped) === 6000, String(count(capped)));
    ok('gone devices go first', Array.from({ length: 20 }, (_, n) => 'n' + n).every((id) => !capped.devices[id]), Object.keys(capped.devices).slice(0, 3).join());
    // Over the cap with no gone device left: the oldest spans.
    const big2 = JSON.parse(JSON.stringify(big));
    Object.values(big2.devices).forEach((d, n) => { d.gone = null; d.spans.forEach((s) => { s.last = n < 10 ? 1 : 2; }); });
    const capped2 = T.pruneTrail(big2, 4);
    ok('then the oldest spans', count(capped2) === 6000 && !capped2.devices.n0 && !!capped2.devices.n399, String(count(capped2)));
    // A present over the cap: the past goes, every value held now stays with its `first`.
    const huge = { v: 1, points: [{ at: 1, kind: 'backup' }, { at: 2, kind: 'backup' }, { at: 3, kind: 'backup' }], devices: {} };
    for (let n = 0; n < 1300; n++) {
      const spans = ['ip', 'mac', 'port', 'group', 'name'].map((f) => ({ f, k: f === 'ip' || f === 'mac' ? 'i1' : '', val: f + n, txt: f + n, first: n < 650 ? 1 : 2, last: 3, kind: 'backup' }));
      spans.push({ f: 'name', k: '', val: 'old' + n, txt: 'old' + n, first: 1, last: 1, kind: 'backup' });
      huge.devices['h' + n] = { name: 'H' + n, gone: null, spans };
    }
    const cappedNow = T.pruneTrail(huge, 4);
    const nowSpans = Object.values(cappedNow.devices).reduce((m, d) => m + d.spans.filter((s) => s.last === 3).length, 0);
    ok('a present over the cap keeps every value held now', nowSpans === 6500 && Object.keys(cappedNow.devices).length === 1300, String(nowSpans));
    ok('with its first seen kept', cappedNow.devices.h0.spans.find((s) => s.f === 'ip').first === 1 && cappedNow.devices.h1299.spans.find((s) => s.f === 'ip').first === 2);
    ok('and the past dropped for it', count(cappedNow) === 6500, String(count(cappedNow)));

    // ---- 4. validTrail ----
    ok('junk is no record', T.validTrail(null) === null && T.validTrail('x') === null && T.validTrail({ v: 2, points: [], devices: {} }) === null
       && T.validTrail({ v: 1, points: {}, devices: {} }) === null && T.validTrail({ v: 1, points: [], devices: [] }) === null);
    const dirty = { v: 1, points: [{ at: 5, kind: 'backup' }, { at: 'x', kind: 'backup' }, { at: 3, kind: 'nope' }, { at: 2, kind: 'report' }],
      devices: { a: { name: 'A', gone: null, spans: [{ f: 'ip', k: 'i1', val: '1.1.1.1', txt: '1.1.1.1', first: 2, last: 5, kind: 'backup' },
        { f: 'evil', k: 'i1', val: 'x', txt: 'x', first: 1, last: 2, kind: 'backup' }, { f: 'ip', k: 'i1', val: 'x', txt: 'x', first: 9, last: 2, kind: 'backup' }] },
        b: { name: 'B', spans: [] }, c: 'junk' } };
    const clean = T.validTrail(dirty);
    ok('a dirty record is cleaned', !!clean && clean.points.map((p) => p.at).join() === '2,5' && Object.keys(clean.devices).join() === 'a'
       && clean.devices.a.spans.length === 1, JSON.stringify(clean));
    ok('a clean record reads back as itself', JSON.stringify(T.validTrail(tr)) === JSON.stringify(tr));

    // ---- 5. The hooks ----
    persistLibrary({});
    localStorage.removeItem(BINDER_EXPORT_KEY);
    replaceDocument(site(), { origin: 'file' });
    const id = L.claimDocument('Clínica', null);
    ok('a kept network starts with no trail', !!id && T.trailOf(id) === null);
    downloads = []; exportJsonFile();
    let t1 = T.trailOf(id);
    ok('Back up this network records one point', !!t1 && t1.points.length === 1 && t1.points[0].kind === 'backup', JSON.stringify(t1 && t1.points));
    ok('of the document as it went out', !!t1 && spansOf(t1, 'pc', 'port')[0].txt === 'SW · Gi1/0/12' && spansOf(t1, 'pc', 'group')[0].txt === 'Building A / Rack 3');
    t1.points = [];
    ok('a reader gets a copy', T.trailOf(id).points.length === 1);
    ok('one device’s part', T.deviceTrail(id, 'pc').name === 'PC-1' && T.deviceTrail(id, 'nope') === null);

    // Undo and redo leave it alone, and the timeline holds none of it.
    getNode('pc').name = 'PC-RENAMED'; save();
    const before = JSON.stringify(T.trailOf(id));
    undo(); redo(); undo();
    ok('undo and redo leave the trail as it was', JSON.stringify(T.trailOf(id)) === before);
    ok('the undo timeline holds no trail', !JSON.stringify(_undoStack).includes('"spans"') && !JSON.stringify(_undoStack).includes('"points"'));

    // A report handed over records one; one only previewed none.
    handOver = false;
    await generateSiteReport();
    ok('a report only previewed records none', T.trailOf(id).points.length === 1);
    handOver = true;
    await generateSiteReport();
    ok('a report handed over records one, of kind report', T.trailOf(id).points.length === 2 && T.trailOf(id).points[1].kind === 'report', JSON.stringify(T.trailOf(id).points));

    // Read-only and the setting off: none.
    const roHeld = state.readOnly;
    state.readOnly = { doc: serializeDoc() };
    ok('a read-only network records none', C.takeSnapshot(id, 'backup', serializeDoc()) && T.trailOf(id).points.length === 2);
    state.readOnly = roHeld;
    state.settings.trailRecording = false;
    ok('the setting off records none', !T.trailRecordingOn() && C.takeSnapshot(id, 'backup', serializeDoc()) && T.trailOf(id).points.length === 2);
    delete state.settings.trailRecording;
    ok('recording is on by default', T.trailRecordingOn());
    ok('a network that is not a card records none', T.recordPoint('no-such-card', 'backup', site()) === false && T.trailOf('no-such-card') === null);
    ok('a bad document records none and does not throw', T.recordPoint(id, 'backup', { nodes: 'x' }) === false && T.recordPoint(id, 'backup', null) === false);

    // Not kept: no trail for the open id.
    replaceDocument(templatesData.house, { origin: 'template' });
    downloads = []; exportJsonFile();
    await generateSiteReport();
    ok('a network that is not kept records none', T.trailOf(state.docId) === null && T.trailOf(null) === null);

    // Back up all: one point per card.
    const other = L.librarySave('Bodega', null, { doc: site() });
    const n0 = T.trailOf(id).points.length;
    downloads = [];
    await exportBinder();
    ok('Back up all records one point for every card', T.trailOf(id).points.length === n0 + 1 && T.trailOf(other) && T.trailOf(other).points.length === 1
       && T.trailOf(other).points[0].kind === 'backup');
    // The binder report: every site's card.
    await generateBinderReport({}, { images: false });
    ok('a binder report handed over records one per site', T.trailOf(other).points.length === 2 && T.trailOf(other).points[1].kind === 'report');

    // A card from a newer Topo (read-only in this build) records none, open or not.
    const newer = site(); newer.v = DOC_VERSION + 1;
    const newerId = L.librarySave('Newer', null, { doc: newer });
    downloads = [];
    await exportBinder();
    ok('Back up all records none for a card from a newer Topo that is not open', !!newerId && T.trailOf(newerId) === null && T.trailOf(other).points.length === 3);
    ok('nor directly', T.recordPoint(newerId, 'backup', newer) === false && T.trailOf(newerId) === null);
    L.libraryDelete(newerId);

    // Deleting a card drops its trail.
    L.libraryDelete(other);
    ok('deleting a card drops its trail', T.trailOf(other) === null);

    // ---- 6. Privacy ----
    // The camera, backed up and then removed: after the next back-up only the trail holds it.
    replaceDocument(L.libraryEntry(id).doc, { libraryId: id, origin: 'library' });
    const camAt = state.nodes.findIndex((n) => n.id === 'cam');
    if (camAt >= 0) { state.nodes.splice(camAt, 1); state.links = state.links.filter((l) => l.source !== 'cam' && l.target !== 'cam'); save(); flushAutosave(); }
    downloads = []; exportJsonFile();
    const MARK = 'CAM-TRAIL-ONLY-5521';
    ok('the trail holds the removed device', JSON.stringify(T.trailOf(id)).includes(MARK) && T.trailOf(id).devices.cam.gone != null);
    const none = (label, value) => ok(`${label} carries no trail`, !JSON.stringify(value).includes(MARK) && !JSON.stringify(value).includes('"spans"'));
    none('the open document', serializeDoc());
    none('a document link’s payload', identifiedDoc(serializeDoc()));
    none('the cards', L.loadLibrary());
    none('the binder file', L.binderFile());
    none('a binder link’s payload', L.binderLinkFile().file);
    none('the back-up file', downloads[0].payload);
    none('the baseline', C.snapshotOf(id));
    none('the spreadsheet', [csvDevicesSheet(), csvInterfacesSheet(), csvCablesSheet(), csvPortsSheet(), csvSubnetsSheet(), csvGroupsSheet(), csvFindingsSheet()]);
    ok('nothing in localStorage holds it', !Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(MARK)));
    ok('nor the history entry', !JSON.stringify(window.history.state || {}).includes(MARK));
    ok('the document version is untouched by it', serializeDoc().v === DOC_VERSION);

    // ---- 7. The store ----
    ok('here (no IndexedDB) the trails are this tab’s', await T.openTrailStore() === 'tab');
    const disk = {
      d1: { v: 1, points: [{ at: 5, kind: 'backup' }], devices: { a: { name: 'A', gone: null, spans: [{ f: 'name', k: '', val: 'A', txt: 'A', first: 5, last: 5, kind: 'backup' }] } } },
      d2: { v: 9, points: [], devices: {} },
      d3: 'junk',
      [id]: { v: 1, points: [{ at: 1, kind: 'backup' }], devices: {} }
    };
    const puts = [], dels = [];
    const fake = {
      readAll: async () => disk,
      read: async (ids) => Object.fromEntries(ids.map((x) => [x, disk[x] || null])),
      put: async (k, rec) => { puts.push(k); disk[k] = rec; return true; },
      del: async (ids) => { dels.push(...ids); ids.forEach((k) => delete disk[k]); return true; }
    };
    ok('a store that answers is adopted', await T.openTrailStore(fake) === 'idb');
    await tick();
    ok('its trails arrive', !!T.trailOf('d1') && T.trailOf('d1').devices.a.name === 'A');
    ok('junk is skipped', T.trailOf('d2') === null && T.trailOf('d3') === null);
    ok('a newer one recorded here wins and is written', T.trailOf(id).points.length > 1 && puts.includes(id) && disk[id].points.length > 1, puts.join());
    ok('with the library on its fallback nothing is pruned', !dels.length && !!T.trailOf('d1'));
    puts.length = 0;
    downloads = []; exportJsonFile();
    await tick();
    ok('a new point reaches the store', puts.includes(id) && disk[id].points.length === T.trailOf(id).points.length);
    T.dropTrail('d1');
    await tick();
    ok('a dropped one leaves it', dels.includes('d1') && !('d1' in disk));
    // A store that refuses a write only warns: the back-up still goes.
    const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
    fake.put = async () => false;
    downloads = []; exportJsonFile();
    await tick(); await tick();
    console.warn = warn;
    ok('a refused write only warns, and the back-up still goes', warned >= 1 && downloads.length === 1);
    // A point recorded while the store is still opening joins the disk's history, never replaces it.
    T.releaseTrailStore();
    const early = L.librarySave('Early', null, { doc: site() });
    const diskPts = [{ at: 10, kind: 'backup' }, { at: 20, kind: 'report' }, { at: 30, kind: 'backup' }];
    const slowDisk = { [early]: { v: 1, points: diskPts, devices: { pc: { name: 'PC-1', gone: null, spans: [
      { f: 'ip', k: 'i1', val: '192.168.1.9/24', txt: '192.168.1.9/24', first: 10, last: 30, kind: 'backup' }] } } } };
    let answer;
    const slowPuts = [];
    const slowFake = {
      readAll: () => new Promise((r) => { answer = r; }),
      read: async (ids) => Object.fromEntries(ids.map((x) => [x, slowDisk[x] || null])),
      put: async (k, rec) => { slowPuts.push(k); slowDisk[k] = JSON.parse(JSON.stringify(rec)); return true; },
      del: async () => true
    };
    const opening = T.openTrailStore(slowFake, 5);
    await tick();
    ok('a point can be recorded while the store opens', T.recordPoint(early, 'backup', site(), 40) && T.trailOf(early).points.length === 1);
    ok('past the deadline it is this tab’s for now', await opening === 'tab');
    ok('a second point too', T.recordPoint(early, 'report', site(), 50));
    answer(slowDisk);
    await tick(); await tick();
    const joined = T.trailOf(early);
    ok('once the disk answers, its history is kept and the points join it', !!joined && joined.points.map((p) => p.at).join() === '10,20,30,40,50', JSON.stringify(joined && joined.points));
    ok('the disk’s old address stays a past span', spansOf(joined, 'pc', 'ip', 'i1').map((s) => s.val + '@' + s.first + '-' + s.last).join() === '192.168.1.9/24@10-30,192.168.1.20/24@40-50', JSON.stringify(spansOf(joined, 'pc', 'ip', 'i1')));
    ok('and the joined record is what is written', slowPuts.includes(early) && slowDisk[early].points.length === 5);
    T.dropTrail(early); L.libraryDelete(early);
    T.releaseTrailStore();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.downloadJson = realDownload; window.deliverReport = realDeliver; window.captureCanvasImage = realCapture;
    if (heldSetting === undefined) delete state.settings.trailRecording; else state.settings.trailRecording = heldSetting;
    setDialogResponder(heldResponder);
    persistLibrary(heldLib);
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
