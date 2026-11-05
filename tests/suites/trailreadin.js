// Address history, stage 4: older back-ups read into the trail (docs/BACKLOG.md
// feature 5; js/trail.js insertObservation, readIntoTrail,
// offerOlderSitesToTrail; js/library.js askAboutKnownCopy, applyImportedBinder;
// js/app.js applyImportedDoc). Not tests/suites/history.js: that is the undo
// suite. Asserted here:
//   1. an older point at its place (mergeObservation): the same value across
//      it left alone, another value splitting the span around it, a value
//      missing at it splitting too, a neighbour with the same value extended
//      (the one before to T, the one after from T), two neighbours with it
//      joined, before the first point, the same time twice one point, the
//      newest names kept, a device only the older file holds recorded as
//      removed from the point after, a gone device seen again gone from the
//      point after it was last seen, an address handed between devices;
//   2. order does not matter: any point left out and inserted afterwards,
//      or every point recorded newest first, gives the trail recorded in order;
//   3. any document version, 1 to DOC_VERSION, is a source (a v1 file's bare
//      `ips` read as interfaces), one from a newer Topo is not; the 200-point
//      bound taking a too-old file straight back out says so;
//   4. Open a file with an older copy of a card: 'Add to its history' offered
//      between Open as a copy and Open mine (not with recording off, a file
//      with no time, a newer copy or one from a newer Topo), recording a
//      'file' point at the file's time with the card, the canvas, the undo
//      timeline and the landing left alone; the same file again already
//      there; the past value in the History section with its kind 'file';
//   5. a binder carrying older copies: one question after the merge, Not now
//      adding nothing, yes adding each one's point; a site the same as the
//      card, a newer one, a template's or a new network never asked about;
//   6. the strings in es, pt-BR, ja (PC, never コンピューター) and ru (counts
//      with no declension).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const T = window.CarinoTrail;
  const L = window.CarinoLibrary;
  const { LIBRARY_KEY, BINDER_EXPORT_KEY } = L;
  const held = [LIBRARY_KEY, BINDER_EXPORT_KEY].map((k) => [k, localStorage.getItem(k)]);
  const heldLib = L.loadLibrary();
  const heldSetting = state.settings.trailRecording;
  const heldToast = window.showToast;
  const toasts = [];
  let choose = null;
  let asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return req.kind === 'choice' ? choose : req.kind === 'confirm' ? true : undefined; });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const day = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  const D1 = day(2026, 3, 2), D2 = day(2026, 6, 1), D3 = day(2026, 9, 14);
  const spansOf = (rec, id, f, k = '') => ((rec.devices[id] || {}).spans || []).filter((s) => s.f === f && s.k === k)
    .sort((a, b) => a.first - b.first);
  const brief = (list) => list.map((s) => `${s.val}@${s.first}-${s.last}/${s.kind}`).join(' ');
  // A record in one order: devices by id, spans by (f, k, first).
  const norm = (rec) => {
    const devices = {};
    Object.keys(rec.devices).sort().forEach((id) => {
      const d = rec.devices[id];
      devices[id] = { name: d.name, gone: d.gone, spans: d.spans.slice().sort((a, b) => (a.f + a.k).localeCompare(b.f + b.k) || a.first - b.first) };
    });
    return JSON.stringify({ points: rec.points, devices });
  };

  const site = () => ({
    v: DOC_VERSION,
    nodes: [
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 }, interfaces: [] },
      { id: 'pc', type: 'pc', name: 'PC-1', x: 100, y: 200, group: 'r3',
        interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24', mac: 'aa-bb-cc-00-11-22' }] },
      { id: 'cam', type: 'camera', name: 'CAM-03', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.77/24' }] }
    ],
    links: [
      { id: 'a', source: 'sw', target: 'pc', sourceIface: 'p12', targetIface: 'i1' },
      { id: 'b', source: 'sw', target: 'cam', sourceIface: 'p5', targetIface: 'i1' }
    ],
    groups: [{ id: 'b1', name: 'Building A', kind: 'building' }, { id: 'r3', name: 'Rack 3', kind: 'rack', parent: 'b1' },
      { id: 'r4', name: 'Rack 4', kind: 'rack', parent: 'b1' }],
    networks: [{ id: 'lan', cidr: '192.168.1.0/24', name: 'LAN' }]
  });
  const withIp = (ip, d = site()) => { d.nodes[1].interfaces[0].ip = ip; return d; };
  const obsOf = (d) => T.observeDoc(d);
  const cards = [];

  try {
    setLocale('en');
    window.showToast = (m, kind) => toasts.push({ m, kind });
    state.settings.trailRecording = true;

    // ---- 1. An older point at its place ----
    const A = obsOf(site()), B = obsOf(withIp('192.168.1.99/24'));
    let tr = T.mergeObservation(null, A, 1000, 'backup');
    tr = T.mergeObservation(tr, A, 3000, 'report');
    let ins = T.mergeObservation(tr, A, 2000, 'file');
    ok('the same value across it: the span left as it is', brief(spansOf(ins, 'pc', 'ip', 'i1')) === '192.168.1.20/24@1000-3000/report', brief(spansOf(ins, 'pc', 'ip', 'i1')));
    ok('the point goes in at its place, in time order', ins.points.map((p) => `${p.at}:${p.kind}`).join() === '1000:backup,2000:file,3000:report', JSON.stringify(ins.points));
    ok('the input record is not changed', tr.points.length === 2);
    ins = T.mergeObservation(tr, B, 2000, 'file');
    ok('another value: the span split around it, the halves taking their points’ kinds',
      brief(spansOf(ins, 'pc', 'ip', 'i1')) === '192.168.1.20/24@1000-1000/backup 192.168.1.99/24@2000-2000/file 192.168.1.20/24@3000-3000/report', brief(spansOf(ins, 'pc', 'ip', 'i1')));
    ok('the values it shares extended through', brief(spansOf(ins, 'pc', 'mac', 'i1')) === 'AABBCC001122@1000-3000/report');
    const cleared = obsOf(withIp(''));
    ins = T.mergeObservation(tr, cleared, 2000, 'file');
    ok('a value missing at it: split, nothing new', brief(spansOf(ins, 'pc', 'ip', 'i1')) === '192.168.1.20/24@1000-1000/backup 192.168.1.20/24@3000-3000/report', brief(spansOf(ins, 'pc', 'ip', 'i1')));
    // Neighbours with another value either side.
    let ab = T.mergeObservation(T.mergeObservation(null, A, 1000, 'backup'), B, 3000, 'backup');
    ins = T.mergeObservation(ab, A, 2000, 'file');
    ok('the value of the point before: that span extended to it, with its kind',
      brief(spansOf(ins, 'pc', 'ip', 'i1')) === '192.168.1.20/24@1000-2000/file 192.168.1.99/24@3000-3000/backup', brief(spansOf(ins, 'pc', 'ip', 'i1')));
    ins = T.mergeObservation(ab, B, 2000, 'file');
    ok('the value of the point after: that span started at it, keeping its kind',
      brief(spansOf(ins, 'pc', 'ip', 'i1')) === '192.168.1.20/24@1000-1000/backup 192.168.1.99/24@2000-3000/backup', brief(spansOf(ins, 'pc', 'ip', 'i1')));
    ins = T.mergeObservation(ab, obsOf(withIp('192.168.1.50/24')), 2000, 'file');
    ok('a third value: a span of its own', brief(spansOf(ins, 'pc', 'ip', 'i1')) === '192.168.1.20/24@1000-1000/backup 192.168.1.50/24@2000-2000/file 192.168.1.99/24@3000-3000/backup');
    ins = T.mergeObservation(ab, B, 500, 'file');
    ok('before the first point: a span of its own', ins.points[0].at === 500 && brief(spansOf(ins, 'pc', 'ip', 'i1')).startsWith('192.168.1.99/24@500-500/file 192.168.1.20/24@1000'), brief(spansOf(ins, 'pc', 'ip', 'i1')));
    ins = T.mergeObservation(ab, A, 500, 'file');
    ok('or the first span started at it', brief(spansOf(ins, 'pc', 'ip', 'i1')).startsWith('192.168.1.20/24@500-1000/backup'), brief(spansOf(ins, 'pc', 'ip', 'i1')));
    // Two neighbours holding it (a record no recorder writes, but a bound can leave): one span.
    const split = T.mergeObservation(T.mergeObservation(null, A, 1000, 'backup'), A, 3000, 'backup');
    split.devices.pc.spans = split.devices.pc.spans.filter((s) => s.f !== 'ip').concat([
      { f: 'ip', k: 'i1', val: '192.168.1.20/24', txt: '192.168.1.20/24', first: 1000, last: 1000, kind: 'backup' },
      { f: 'ip', k: 'i1', val: '192.168.1.20/24', txt: '192.168.1.20/24', first: 3000, last: 3000, kind: 'report' }]);
    ins = T.mergeObservation(split, A, 2000, 'file');
    ok('both neighbours holding it: joined into one', brief(spansOf(ins, 'pc', 'ip', 'i1')) === '192.168.1.20/24@1000-3000/report', brief(spansOf(ins, 'pc', 'ip', 'i1')));
    ins = T.mergeObservation(ab, B, 2000, 'file');
    ok('the same time twice is one point', norm(T.mergeObservation(ins, A, 2000, 'file')) === norm(ins) && norm(T.mergeObservation(ins, B, 1000, 'file')) === norm(ins));
    const oldName = site(); oldName.nodes[1].name = 'PC-OLD';
    ins = T.mergeObservation(ab, obsOf(oldName), 2000, 'file');
    ok('the device keeps its newest name, the old one a span at its time', ins.devices.pc.name === 'PC-1'
      && brief(spansOf(ins, 'pc', 'name')) === 'PC-1@1000-1000/backup PC-OLD@2000-2000/file PC-1@3000-3000/backup', brief(spansOf(ins, 'pc', 'name')));
    // A device only the older file holds: removed since.
    const extra = site(); extra.nodes.push({ id: 'old', type: 'printer', name: 'Old printer', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.40/24' }] });
    ins = T.mergeObservation(ab, obsOf(extra), 2000, 'file');
    ok('a device only the older file holds is recorded as removed from the point after', !!ins.devices.old && ins.devices.old.gone === 3000
      && ins.devices.old.name === 'Old printer' && brief(spansOf(ins, 'old', 'ip', 'i1')) === '192.168.1.40/24@2000-2000/file', JSON.stringify(ins.devices.old));
    ok('the devices on the map now stay present', ins.devices.pc.gone === null && ins.devices.cam.gone === null);
    // A device absent from the older file while present either side: split.
    const noCam = site(); noCam.nodes.splice(2, 1); noCam.links.splice(1, 1);
    let cc = T.mergeObservation(T.mergeObservation(null, A, 1000, 'backup'), A, 3000, 'backup');
    ins = T.mergeObservation(cc, obsOf(noCam), 2000, 'file');
    ok('a device missing from the older file: its spans split, it stays present', brief(spansOf(ins, 'cam', 'ip', 'i1')) === '192.168.1.77/24@1000-1000/backup 192.168.1.77/24@3000-3000/backup' && ins.devices.cam.gone === null);
    // A gone device seen again at an older point.
    let gn = T.mergeObservation(null, A, 1000, 'backup');
    gn = T.mergeObservation(gn, obsOf(noCam), 3000, 'backup');
    gn = T.mergeObservation(gn, obsOf(noCam), 5000, 'backup');
    ok('(gone at the point it went)', gn.devices.cam.gone === 3000);
    ins = T.mergeObservation(gn, A, 4000, 'file');
    ok('a gone device seen at a later older point is gone from the point after it', ins.devices.cam.gone === 5000
      && brief(spansOf(ins, 'cam', 'ip', 'i1')) === '192.168.1.77/24@1000-1000/backup 192.168.1.77/24@4000-4000/file', brief(spansOf(ins, 'cam', 'ip', 'i1')));
    ins = T.mergeObservation(gn, A, 500, 'file');
    ok('and seen before it went, still gone from where it went', ins.devices.cam.gone === 3000 && brief(spansOf(ins, 'cam', 'ip', 'i1')) === '192.168.1.77/24@500-1000/backup');
    // A device already gone, missing at an older point between its last
    // sighting and its removal: it went there.
    let gb = T.mergeObservation(T.mergeObservation(null, A, 1000, 'backup'), obsOf(noCam), 3000, 'backup');
    ok('(gone at the later point)', gb.devices.cam.gone === 3000);
    ins = T.mergeObservation(gb, obsOf(noCam), 2000, 'file');
    const gbOrder = T.mergeObservation(T.mergeObservation(T.mergeObservation(null, A, 1000, 'backup'), obsOf(noCam), 2000, 'file'), obsOf(noCam), 3000, 'backup');
    ok('a device missing at an older point after it was last seen is gone from that point', ins.devices.cam.gone === 2000 && norm(ins) === norm(gbOrder),
      ins.devices.cam.gone + ' ' + norm(ins) + ' vs ' + norm(gbOrder));
    // A full record and a point older than all of it: nothing changes, not even
    // the span beside it (the bound takes the point straight back out).
    let fullRec = null;
    for (let i = 0; i < T.TRAIL_POINTS_MAX; i++) fullRec = T.mergeObservation(fullRec, A, 10000 + i * 10, 'backup');
    const fullOut = T.mergeObservation(fullRec, A, 5000, 'file');
    ok('a point older than a full record changes nothing in it', norm(fullOut) === norm(fullRec)
      && spansOf(fullOut, 'pc', 'ip', 'i1')[0].first === 10000 && spansOf(fullOut, 'pc', 'ip', 'i1')[0].kind === 'backup', brief(spansOf(fullOut, 'pc', 'ip', 'i1')));
    ok('nor with another value', norm(T.mergeObservation(fullRec, B, 5000, 'file')) === norm(fullRec));
    // An address handed from one device to another between the points.
    const swap = site(); swap.nodes[1].interfaces[0].ip = '192.168.1.77/24'; swap.nodes[2].interfaces[0].ip = '192.168.1.20/24';
    ins = T.mergeObservation(T.mergeObservation(T.mergeObservation(null, A, 1000, 'backup'), A, 3000, 'backup'), obsOf(swap), 2000, 'file');
    ok('two devices that swapped addresses at the older point: each holds the other’s there',
      brief(spansOf(ins, 'pc', 'ip', 'i1')).includes('192.168.1.77/24@2000-2000/file') && brief(spansOf(ins, 'cam', 'ip', 'i1')).includes('192.168.1.20/24@2000-2000/file'));

    // ---- 2. Order does not matter ----
    const seq = [];
    seq.push(site());
    seq.push(withIp('192.168.1.30/24'));
    { const d = withIp('192.168.1.30/24'); d.links[0].sourceIface = 'p7'; d.nodes[1].group = 'r4'; seq.push(d); }
    { const d = withIp('', site()); d.links[0].sourceIface = 'p7'; d.nodes.splice(2, 1); d.links.splice(1, 1); seq.push(d); }
    { const d = site(); d.nodes[1].interfaces[0].mac = 'aa:bb:cc:00:11:99'; seq.push(d); }
    { const d = site(); d.nodes[0].name = 'SW-02'; d.nodes.push({ id: 'new', type: 'pc', name: 'New', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.30/24' }] }); seq.push(d); }
    // And 'new' removed for good: missing from the last two points.
    seq.push(site());
    seq.push(withIp('192.168.1.31/24'));
    const kinds = ['backup', 'report', 'file', 'backup', 'report', 'backup', 'file', 'report'];
    const ats = seq.map((_, i) => 1000 * (i + 1));
    const inOrder = seq.reduce((rec, d, i) => T.mergeObservation(rec, obsOf(d), ats[i], kinds[i]), null);
    const misses = [];
    seq.forEach((_, j) => {
      let rec = null;
      seq.forEach((d, i) => { if (i !== j) rec = T.mergeObservation(rec, obsOf(d), ats[i], kinds[i]); });
      rec = T.mergeObservation(rec, obsOf(seq[j]), ats[j], kinds[j]);
      if (norm(rec) !== norm(inOrder)) misses.push(j);
    });
    ok('any one point left out and inserted afterwards gives the trail recorded in order', misses.length === 0, 'differs leaving out ' + misses.join());
    const reversed = seq.map((d, i) => i).reverse().reduce((rec, i) => T.mergeObservation(rec, obsOf(seq[i]), ats[i], kinds[i]), null);
    ok('(the sequence removes a device for good)', inOrder.devices.new && inOrder.devices.new.gone === ats[6], JSON.stringify(inOrder.devices.new));
    ok('every point recorded newest first gives it too', norm(reversed) === norm(inOrder), norm(reversed) + ' vs ' + norm(inOrder));

    // ---- 3. Any document version is a source ----
    replaceDocument(site(), { origin: 'file' });
    setView('map');
    const id = L.claimDocument('Clínica', null);
    cards.push(id);
    T.recordPoint(id, 'backup', serializeDoc(), D2);
    T.recordPoint(id, 'backup', serializeDoc(), D3);
    const versionMiss = [];
    for (let v = 1; v <= DOC_VERSION; v++) {
      let doc;
      if (v === 1) {
        // As v1 saved it: bare `ips`, and a cable naming no port, which the
        // v1->v2 step binds to the switch's first free port.
        doc = { v: 1, nodes: [{ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 24 },
          { id: 'pc', type: 'pc', name: 'PC-1', x: 100, y: 200, ips: ['192.168.1.' + (100 + v) + '/24'] }],
        links: [{ id: 'a', source: 'sw', target: 'pc' }] };
      } else {
        doc = withIp('192.168.1.' + (100 + v) + '/24'); doc.v = v;
      }
      const at = D1 + v * 60000;
      const res = T.readIntoTrail(id, doc, at);
      const rec = T.trailOf(id);
      const span = spansOf(rec, 'pc', 'ip', 'i1').find((s) => s.first <= at && s.last >= at);
      const port = spansOf(rec, 'pc', 'port').find((s) => s.first <= at && s.last >= at);
      const grp = spansOf(rec, 'pc', 'group').find((s) => s.first <= at && s.last >= at);
      const wantPort = v === 1 ? /^sw\|p\d+$/ : /^sw\|p12$/;
      if (res !== 'added' || !span || span.val !== '192.168.1.' + (100 + v) + '/24' || span.kind !== 'file'
        || !port || !wantPort.test(port.val) || (v > 1 && (!grp || grp.val !== 'r3')) || (v === 1 && grp))
        versionMiss.push(v + ':' + res + ':' + (span ? span.val : '-') + ':' + (port ? port.val : '-') + ':' + (grp ? grp.val : '-'));
    }
    ok(`every version 1 to ${DOC_VERSION} reads in as a 'file' point (v1's bare ips as interfaces)`, versionMiss.length === 0, versionMiss.join(' '));
    const newer = withIp('192.168.1.250/24'); newer.v = DOC_VERSION + 1;
    ok('one from a newer Topo cannot go in', T.trailCanReadIn(newer, D1 + 5) === false && T.readIntoTrail(id, newer, D1 + 5) === 'failed'
      && !T.trailOf(id).points.some((p) => p.at === D1 + 5));
    ok('nor one with no time to go in at', T.trailCanReadIn(site(), 0) === false && T.readIntoTrail(id, site(), 0) === 'failed');
    ok('the same file twice: already there', T.readIntoTrail(id, withIp('192.168.1.101/24'), D1 + 60000) === 'known');
    // A back-up's point is stamped when it went out, after the card's last
    // edit the file carries: that back-up read back is already held.
    const bk = L.claimDocument('Back-up card', null);
    cards.push(bk);
    T.recordPoint(bk, 'backup', withIp('192.168.1.60/24'), D2);
    T.recordPoint(bk, 'backup', withIp('192.168.1.61/24'), D3);
    const bkBefore = JSON.stringify(T.trailOf(bk));
    ok('the back-up a point was recorded for, read back at its earlier time: already there', T.readIntoTrail(bk, withIp('192.168.1.60/24'), D2 - 86400000) === 'known'
      && JSON.stringify(T.trailOf(bk)) === bkBefore);
    ok('one that differs from the point after it still goes in', T.readIntoTrail(bk, withIp('192.168.1.62/24'), D2 + 1000) === 'added' && T.trailOf(bk).points.length === 3);
    ok('the newest points are untouched by it', T.trailOf(id).points.slice(-2).map((p) => p.at + p.kind).join() === `${D2}backup,${D3}backup`);
    state.settings.trailRecording = false;
    ok('recording turned off: nothing can go in', T.trailCanReadIn(site(), D1) === false && T.readIntoTrail(id, site(), D1 - 1) === 'failed');
    state.settings.trailRecording = true;
    // The bound: a card with its 200 points, and a file older than all of them.
    const full = L.claimDocument('Full card', null);
    cards.push(full);
    for (let i = 0; i < T.TRAIL_POINTS_MAX; i++) T.recordPoint(full, 'backup', serializeDoc(), D2 + i * 1000);
    ok('(the full card holds 200 points)', T.trailOf(full).points.length === T.TRAIL_POINTS_MAX);
    const fullBefore = JSON.stringify(T.trailOf(full));
    ok('a file older than the 200 points kept: too old, nothing changed', T.readIntoTrail(full, withIp('192.168.1.9/24'), D1) === 'old'
      && JSON.stringify(T.trailOf(full)) === fullBefore);
    ok('one among them goes in, the oldest point making room', T.readIntoTrail(full, withIp('192.168.1.9/24'), D2 + 500) === 'added'
      && T.trailOf(full).points.length === T.TRAIL_POINTS_MAX && T.trailOf(full).points[0].at === D2 + 500 && T.trailOf(full).points[1].at === D2 + 1000);
    L.libraryDelete(full); cards.pop();
    ok('the toasts say which', T.readIntoTrailText('old', 'X') === 'This back-up is older than the history kept for "X", so nothing was added.'
      && T.readIntoTrailText('known', 'X') === 'This back-up is already in the history of "X".'
      && T.readIntoTrailText('failed', 'X') === 'Could not add this back-up to the history.');

    // ---- 4. Open a file: an older copy of a card ----
    T.dropTrail(id);
    replaceDocument(L.libraryEntry(id).doc, { libraryId: id, origin: 'library' });
    setView('map');
    T.recordPoint(id, 'backup', serializeDoc(), D2);
    T.recordPoint(id, 'report', serializeDoc(), D3);
    // The card is newer than both: its own time is now.
    const fileOf = (doc, updated) => ({ ...doc, id, updated });
    const olderFile = fileOf(withIp('192.168.1.31/24'), D1);
    const cardBefore = JSON.stringify(L.loadLibrary()[id]);
    const canvasBefore = JSON.stringify(serializeDoc());
    const undoBefore = el('undoBtn').disabled + '|' + el('undoBtn').title;
    asked = []; choose = 'history'; toasts.length = 0;
    const took = await applyImportedDoc(olderFile);
    const q = asked.find((r) => r.kind === 'choice');
    ok('an older copy offers Add to its history between Open as a copy and Open mine', !!q && q.choices.map((c) => c.id).join() === 'copy,history,mine'
      && q.choices[1].label === 'Add to its history' && /yours is newer/.test(q.message), q && JSON.stringify(q.choices));
    ok('Open mine stays the main answer', !!q && q.choices[2].primary === true && !q.choices[1].primary);
    const rec = T.trailOf(id);
    ok('it records a file point at the file’s time, before the card’s points', took === true
      && rec.points.map((p) => p.kind).join() === 'file,backup,report' && rec.points[0].at === D1, JSON.stringify(rec.points));
    ok('what the file held is the past there', brief(spansOf(rec, 'pc', 'ip', 'i1')) === `192.168.1.31/24@${D1}-${D1}/file 192.168.1.20/24@${D2}-${D3}/report`, brief(spansOf(rec, 'pc', 'ip', 'i1')));
    ok('the card is left as it was', JSON.stringify(L.loadLibrary()[id]) === cardBefore);
    ok('and the canvas, the open card and the undo timeline', JSON.stringify(serializeDoc()) === canvasBefore && state.libraryId === id
      && el('undoBtn').disabled + '|' + el('undoBtn').title === undoBefore);
    ok('a toast says so', toasts.some((x) => x.m === 'Added this back-up to the history of "Clínica". The network itself is not changed.' && x.kind === 'ok'), JSON.stringify(toasts));
    select('pc', 'node');
    el('historyGroup').open = true;
    const histText = el('historyBody').textContent;
    ok('the History section shows it as a past value read from a file', histText.includes('192.168.1.31/242026-03-02 file'), histText);
    toasts.length = 0;
    await applyImportedDoc(olderFile);
    ok('the same file again: already in its history, nothing added', T.trailOf(id).points.length === 3
      && toasts.some((x) => x.m === 'This back-up is already in the history of "Clínica".'), JSON.stringify(toasts));
    // Not offered.
    const offeredFor = async (file) => { asked = []; choose = null; await applyImportedDoc(file); const c = asked.find((r) => r.kind === 'choice'); return c ? c.choices.map((x) => x.id).join() : ''; };
    state.settings.trailRecording = false;
    ok('with recording off it is not offered', (await offeredFor(fileOf(withIp('192.168.1.32/24'), D1 + 1))) === 'copy,mine');
    state.settings.trailRecording = true;
    ok('nor for a file with no time', (await offeredFor(fileOf(withIp('192.168.1.32/24'), 0))) === 'copy,mine');
    ok('nor for a newer copy (that one is an update)', (await offeredFor(fileOf(withIp('192.168.1.32/24'), Date.now() + 86400000))) === 'copy,update');
    ok('a cancelled question records nothing', T.trailOf(id).points.length === 3);
    {
      const lib = L.loadLibrary(); const k = 'tplTrail2';
      lib[k] = { id: k, name: 'Plantilla 2', doc: site(), created: 1, updated: Date.now(), template: true }; persistLibrary(lib); cards.push(k);
      const offered = await offeredFor({ ...withIp('192.168.1.34/24'), id: k, updated: D1 });
      ok('an older file of a template: not offered (the binder does not ask either)', offered === 'copy,mine', offered);
      ok('and a template takes no read-in', T.readIntoTrail(k, withIp('192.168.1.34/24'), D1) === 'failed' && !T.hasTrail(k) && T.trailReadInCard(k) === false && T.trailReadInCard(id) === true);
    }
    // A v1 back-up of the same card.
    asked = []; choose = 'history';
    await applyImportedDoc({ v: 1, id, updated: D1 + 1000, nodes: [{ id: 'pc', type: 'pc', name: 'PC-1', x: 0, y: 0, ips: ['192.168.1.33/24'] }], links: [] });
    ok('a version 1 back-up of the card goes in too', T.trailOf(id).points.length === 4
      && spansOf(T.trailOf(id), 'pc', 'ip', 'i1').some((s) => s.first === D1 + 1000 && s.val === '192.168.1.33/24'));
    ok('was: finds the value only the older file held', (() => { setQuery('was:192.168.1.31'); const m = queryMapMatches(); const n = m ? [...m.nodes].join() : ''; setQuery(''); return n === 'pc'; })());

    // ---- 5. A binder carrying older copies ----
    const other = (() => { replaceDocument(site(), { origin: 'file' }); setView('map'); const k = L.claimDocument('Otra', null); cards.push(k); return k; })();
    const tpl = (() => {
      const lib = L.loadLibrary(); const k = 'tplTrail1';
      lib[k] = { id: k, name: 'Plantilla', doc: site(), created: 1, updated: Date.now(), template: true }; persistLibrary(lib); cards.push(k); return k;
    })();
    const entryOf = (k) => L.libraryEntry(k);
    const binder = (sites) => ({ kind: L.BINDER_KIND || 'nettopo-binder', exported: Date.now(), sites });
    const siteOf = (k, doc, updated) => ({ id: k, name: entryOf(k) ? entryOf(k).name : 'x', created: 1, updated, doc });
    const libBefore = JSON.stringify(L.loadLibrary());
    const pointsOf = (k) => (T.trailOf(k) || { points: [] }).points.length;
    const p0 = pointsOf(id), p1 = pointsOf(other);
    asked = []; choose = 'skip'; toasts.length = 0;
    applyImportedBinder(binder([siteOf(id, withIp('192.168.1.41/24'), D1 + 2000), siteOf(other, withIp('192.168.1.42/24'), D1),
      siteOf(tpl, withIp('192.168.1.43/24'), D1), siteOf('brandNew1', site(), D1)]));
    await tick(); await tick();
    const bq = asked.find((r) => r.kind === 'choice');
    ok('a binder with two older copies asks once, after the merge', !!bq && /^2 networks in this binder are older than yours here\. Add them to their history\?/.test(bq.message)
      && bq.choices.map((c) => c.id).join() === 'skip,history' && bq.choices[1].label === 'Add to their history' && asked.filter((r) => r.kind === 'choice').length === 1,
      bq && bq.message);
    ok('the merge itself is the binder’s: older copies kept as they were, the new network added', !!entryOf('brandNew1')
      && JSON.stringify(entryOf(id).doc) === JSON.stringify(JSON.parse(libBefore)[id].doc) && toasts.some((x) => /^Binder loaded: 1 added, 0 updated, 3 already up to date\./.test(x.m)), JSON.stringify(toasts));
    ok('Not now adds nothing', pointsOf(id) === p0 && pointsOf(other) === p1 && !T.hasTrail(tpl) && !T.hasTrail('brandNew1'));
    cards.push('brandNew1');
    asked = []; choose = 'history'; toasts.length = 0;
    applyImportedBinder(binder([siteOf(id, withIp('192.168.1.41/24'), D1 + 2000), siteOf(other, withIp('192.168.1.42/24'), D1)]));
    await tick(); await tick();
    ok('yes adds each one’s point at its own time', pointsOf(id) === p0 + 1 && pointsOf(other) === p1 + 1
      && T.trailOf(other).points[0].at === D1 && T.trailOf(other).points[0].kind === 'file', `${pointsOf(id)} ${pointsOf(other)}`);
    ok('and says how many', toasts.some((x) => x.m === '2 older back-ups added to the history.'), JSON.stringify(toasts));
    asked = []; toasts.length = 0;
    applyImportedBinder(binder([siteOf(id, withIp('192.168.1.41/24'), D1 + 2000), siteOf(other, withIp('192.168.1.42/24'), D1)]));
    await tick(); await tick();
    ok('the same binder opened again: nothing asked, nothing added', !asked.some((r) => r.kind === 'choice') && pointsOf(id) === p0 + 1 && pointsOf(other) === p1 + 1
      && !toasts.some((x) => /older back-ups? added/.test(x.m)), JSON.stringify(toasts));
    asked = [];
    applyImportedBinder(binder([siteOf(other, withIp('192.168.1.44/24'), D1 + 5)]));
    await tick(); await tick();
    const one = asked.find((r) => r.kind === 'choice');
    ok('one older copy: the singular', !!one && /^1 network in this binder is older than yours here\. Add it to its history\?/.test(one.message) && one.choices[1].label === 'Add to its history', one && one.message);
    asked = [];
    applyImportedBinder(binder([siteOf(other, JSON.parse(JSON.stringify(entryOf(other).doc)), D1 + 7), siteOf(other + 'x', site(), D1)]));
    await tick(); await tick();
    cards.push(other + 'x');
    ok('a copy the same as the card, or a network new here, is never asked about', !asked.some((r) => r.kind === 'choice'));

    // ---- 6. The words ----
    const keys = ['Add to its history', 'Add to their history', 'Not now',
      'Added this back-up to the history of "{name}". The network itself is not changed.',
      'This back-up is already in the history of "{name}".',
      'This back-up is older than the history kept for "{name}", so nothing was added.',
      'Could not add this back-up to the history.',
      '{n} network in this binder is older than yours here. Add it to its history? Yours stays as it is.',
      '{n} networks in this binder are older than yours here. Add them to their history? Yours stay as they are.',
      '{n} older back-up added to the history.', '{n} older back-ups added to the history.'];
    const { MESSAGES } = window.CarinoI18N;
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = keys.filter((k) => !MESSAGES[loc][k] || MESSAGES[loc][k] === k);
      ok(`${loc} carries every read-in string`, miss.length === 0, miss.join(' | '));
      const lost = keys.filter((k) => (k.match(/\{\w+\}/g) || []).some((p) => !MESSAGES[loc][k].includes(p)));
      ok(`${loc} keeps the placeholders`, lost.length === 0, lost.join(' | '));
    });
    ok('Japanese never says コンピューター in them', !keys.some((k) => /コンピューター/.test(MESSAGES.ja[k] || '')));
    ok('Russian counts read with any numeral (no declension)', /: \{n\}\.$/.test(MESSAGES.ru['{n} older back-up added to the history.'])
      && MESSAGES.ru['{n} older back-up added to the history.'] === MESSAGES.ru['{n} older back-ups added to the history.']);
    setLocale('es');
    ok('in Spanish', T.readIntoTrailText('added', 'Clínica') === 'Se añadió esta copia de seguridad al historial de «Clínica». La red no cambia.');
    setLocale('en');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    window.showToast = heldToast;
    state.settings.trailRecording = heldSetting;
    setDialogResponder(heldResponder);
    cards.forEach((k) => { try { T.dropTrail(k); } catch (e) { /* gone */ } });
    persistLibrary(heldLib);
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
