// Address history, stage 2, the edges of the History section and its store
// (js/trail.js; tests/suites/trailpanel.js covers the section itself):
//   1. the open state read back (restoreHistoryGroup): no key closed, '1'
//      open, '0' closed;
//   2. a forget or a clear made while the store is still opening reaches the
//      disk's record: Forget drops that device and keeps every other device's
//      history, Clear history does not come back when the disk answers;
//   3. the landing drawn before the trails arrived gains Clear history when
//      they do, and when another tab's trail arrives over the channel;
//   4. "now" follows what is typed into the panel (name, address, group)
//      without the device being selected again, the reuse hint too;
//   5. the reuse hint reads an address by its host part: the same address
//      with another prefix (or none) held now by both is no hint, and one
//      reused under another prefix is;
//   6. a value missing at the newest point and back since (a cable unplugged
//      at a back-up, plugged back in after) reads as now, its span as past;
//   7. a device on two switches: a switch renamed is no port change, at the
//      next point or before it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const T = window.CarinoTrail;
  const L = window.CarinoLibrary;
  const { LIBRARY_KEY, BINDER_EXPORT_KEY } = L;
  const held = [LIBRARY_KEY, BINDER_EXPORT_KEY, T.HISTORY_OPEN_KEY].map((k) => [k, localStorage.getItem(k)]);
  const heldLib = L.loadLibrary();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const body = () => el('historyBody');
  const block = (f, k = '') => body().querySelector(`.hist-block[data-f="${f}"][data-k="${k}"]`);
  const lines = (b) => (b ? [...b.querySelectorAll('.hist-line')].map((li) => [...li.children].map((c) => c.textContent).join(' ').replace(/\s+/g, ' ').trim()) : []);
  const day = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  const D1 = day(2026, 3, 2), D2 = day(2026, 9, 14);
  const spansOf = (rec, dev, f) => ((rec && rec.devices[dev]) ? rec.devices[dev].spans.filter((s) => s.f === f) : []);
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
  const record = (id, kind, at) => T.recordPoint(id, kind, serializeDoc(), at);
  const cards = [];
  const openKept = (doc, name) => { replaceDocument(doc, { origin: 'file' }); setView('map'); const id = L.claimDocument(name, null); cards.push(id); return id; };
  const slowStore = (disk) => {
    const s = { puts: [], dels: [], answer: null, disk };
    s.adapter = {
      readAll: () => new Promise((r) => { s.answer = () => r(disk); }),
      read: async (ids) => Object.fromEntries(ids.map((x) => [x, disk[x] || null])),
      put: async (k, rec) => { s.puts.push(k); disk[k] = JSON.parse(JSON.stringify(rec)); return true; },
      del: async (ids) => { s.dels.push(...ids); ids.forEach((k) => delete disk[k]); return true; }
    };
    return s;
  };
  const diskRec = () => ({ v: 1, points: [{ at: 10, kind: 'backup' }, { at: 20, kind: 'report' }, { at: 30, kind: 'backup' }], devices: {
    pc: { name: 'PC-1', gone: null, spans: [{ f: 'ip', k: 'i1', val: '192.168.1.9/24', txt: '192.168.1.9/24', first: 10, last: 30, kind: 'backup' }] },
    cam: { name: 'CAM-03', gone: null, spans: [{ f: 'ip', k: 'i1', val: '192.168.1.8/24', txt: '192.168.1.8/24', first: 10, last: 30, kind: 'backup' }] } } });

  try {
    setLocale('en');
    persistLibrary({});
    T.releaseTrailStore();

    // ---- 1. The open state read back ----
    localStorage.removeItem(T.HISTORY_OPEN_KEY);
    el('historyGroup').open = true; T.restoreHistoryGroup();
    ok('no key: closed', el('historyGroup').open === false);
    localStorage.setItem(T.HISTORY_OPEN_KEY, '1'); T.restoreHistoryGroup();
    ok("'1': open", el('historyGroup').open === true);
    localStorage.setItem(T.HISTORY_OPEN_KEY, '0'); T.restoreHistoryGroup();
    ok("'0': closed", el('historyGroup').open === false);

    // ---- 2. Forget and clear while the store opens ----
    const early = L.librarySave('Early', null, { doc: site() }); cards.push(early);
    const s1 = slowStore({ [early]: diskRec() });
    T.openTrailStore(s1.adapter, 5);
    await tick();
    ok('a point recorded while the store opens', T.recordPoint(early, 'backup', site(), 40));
    T.forgetDevice(early, 'pc');
    s1.answer(); await tick(); await tick();
    const joined = T.trailOf(early);
    ok('a device forgotten meanwhile: the disk’s points are kept with the new one', !!joined && joined.points.map((p) => p.at).join() === '10,20,30,40', JSON.stringify(joined && joined.points));
    ok('every other device keeps its history from the disk', spansOf(joined, 'cam', 'ip').map((s) => s.val + '@' + s.first + '-' + s.last).join() === '192.168.1.8/24@10-30,192.168.1.77/24@40-40', JSON.stringify(spansOf(joined, 'cam', 'ip')));
    ok('the forgotten one is gone from it, the disk’s past too', !joined.devices.pc);
    ok('and that is what is written', s1.puts.includes(early) && !s1.disk[early].devices.pc && s1.disk[early].points.length === 4);
    T.releaseTrailStore();

    const s2 = slowStore({ [early]: diskRec() });
    T.openTrailStore(s2.adapter, 5);
    await tick();
    T.recordPoint(early, 'backup', site(), 50);
    T.dropTrail(early);
    s2.answer(); await tick(); await tick();
    ok('a trail cleared meanwhile does not come back when the disk answers', T.trailOf(early) === null && !T.hasTrail(early));
    ok('and it leaves the disk', s2.dels.includes(early) && !(early in s2.disk));
    T.releaseTrailStore();

    const s3 = slowStore({ [early]: diskRec() });
    T.openTrailStore(s3.adapter, 5);
    await tick();
    T.dropTrail(early);
    T.recordPoint(early, 'report', site(), 60);
    s3.answer(); await tick(); await tick();
    ok('a point after the clear starts the history afresh', !!T.trailOf(early) && T.trailOf(early).points.map((p) => p.at).join() === '60');
    T.releaseTrailStore();
    T.dropTrail(early);

    // ---- 3. The landing gains Clear history when the trails arrive ----
    const later = L.librarySave('Later', null, { doc: site() }); cards.push(later);
    const third = L.librarySave('Third', null, { doc: site() }); cards.push(third);
    openLanding(false);
    const clearOn = (name) => [...document.querySelectorAll('#landing .landing-tool')].some((b) => b.title === 'Clear history' && (b.getAttribute('aria-label') || '').includes(name));
    ok('before the trails arrive, no Clear history', !clearOn('Later'));
    const s4 = slowStore({ [later]: diskRec() });
    T.openTrailStore(s4.adapter, 5);
    await tick();
    s4.answer(); await tick(); await tick();
    ok('the landing drawn before the trails arrived gains Clear history', clearOn('Later') && !clearOn('Third'));
    s4.disk[third] = diskRec();
    const other = new BroadcastChannel(T.TRAIL_DB);
    other.postMessage({ ids: [third] });
    for (let i = 0; i < 50 && !clearOn('Third'); i++) await new Promise((r) => setTimeout(r, 10));
    ok('and when another tab’s trail arrives', clearOn('Third'));
    other.close();
    closeLanding();
    T.releaseTrailStore();
    T.dropTrail(later); T.dropTrail(third);

    // ---- 4. "now" follows the typing ----
    const id = openKept(site(), 'Typing');
    record(id, 'backup', D1);
    getNode('pc').name = 'PC-1B'; getNode('pc').interfaces[0].ip = '192.168.1.30/24'; save();
    record(id, 'backup', D2);
    el('historyGroup').open = true;
    select('pc', 'node');
    ok('before: the name now since its point', lines(block('name'))[0] === 'PC-1B since 2026-09-14', JSON.stringify(lines(block('name'))));
    el('propName').value = 'PC-2'; el('propName').dispatchEvent(new Event('input', { bubbles: true }));
    ok('a name typed reads as now at once', lines(block('name'))[0] === 'PC-2 now', JSON.stringify(lines(block('name'))));
    const ipField = () => [...el('sidebar') ? el('sidebar').querySelectorAll('input.if-ip') : document.querySelectorAll('input.if-ip')].find((i) => i.offsetParent !== null);
    const ipIn = ipField();
    ipIn.value = '192.168.1.31/24'; ipIn.dispatchEvent(new Event('input', { bubbles: true }));
    ok('an address typed reads as now at once', lines(block('ip', 'i1'))[0] === '192.168.1.31/24 now', JSON.stringify(lines(block('ip', 'i1'))));
    el('propGroup').value = 'r4'; el('propGroup').dispatchEvent(new Event('change', { bubbles: true }));
    ok('a group picked reads as now at once', lines(block('group'))[0] === 'Building A / Rack 4 now', JSON.stringify(lines(block('group'))));
    select('cam', 'node');
    ok('the camera has no hint yet', !body().querySelector('.hist-reuse'));
    const camIp = ipField();
    camIp.value = '192.168.1.20/24'; camIp.dispatchEvent(new Event('input', { bubbles: true }));
    ok('typing the PC’s old address shows whose it was at once', [...body().querySelectorAll('.hist-reuse')].map((r) => r.textContent).join('|') === "Was PC-2's until 2026-03-02", body().textContent);

    // ---- 5. The reuse hint by host address ----
    const id5 = openKept(site(), 'Prefix');
    record(id5, 'backup', D1);
    getNode('pc').interfaces[0].ip = '192.168.1.20'; getNode('cam').interfaces[0].ip = '192.168.1.20/24'; save();
    select('cam', 'node');
    ok('the same address held now by both with the prefix dropped: no hint (a duplicate)', !body().querySelector('.hist-reuse'), body().textContent);
    getNode('pc').interfaces[0].ip = '192.168.1.20/16'; save();
    select('cam', 'node');
    ok('nor with another prefix', !body().querySelector('.hist-reuse'), body().textContent);
    getNode('pc').interfaces[0].ip = '192.168.1.30/24'; getNode('cam').interfaces[0].ip = '192.168.1.20/16'; save();
    select('cam', 'node');
    ok('an address reused under another prefix: the hint', [...body().querySelectorAll('.hist-reuse')].map((r) => r.textContent).join('|') === "Was PC-1's until 2026-03-02", body().textContent);

    // ---- 6. Missing at the newest point, back since ----
    const id6 = openKept(site(), 'Unplugged');
    record(id6, 'backup', D1);
    const cable = cloneData(state.links.find((l) => l.id === 'a'));
    state.links = state.links.filter((l) => l.id !== 'a'); save();
    record(id6, 'backup', D2);
    state.links.push(cable); save();
    select('pc', 'node');
    ok('a cable unplugged at a back-up and plugged back since reads as now, its span as past',
      lines(block('port')).join('|') === 'SW · Gi1/0/12 now|SW · Gi1/0/12 2026-03-02 back-up', JSON.stringify(lines(block('port'))));
    ok('so the device does not say nothing changed', !/No changes recorded/.test(body().textContent));

    // ---- 7. A device on two switches ----
    const dual = site();
    dual.nodes.push({ id: 'swb', type: 'switch', name: 'SW-B', x: 300, y: 100, portCount: 24, interfaces: [] });
    dual.nodes[0].name = 'SW-A';
    dual.nodes.push({ id: 'srv', type: 'server', name: 'SRV', x: 300, y: 300, interfaces: [{ id: 'b0', name: 'eno1', ip: '' }, { id: 'b1', name: 'eno2', ip: '' }] });
    dual.links.push({ id: 'd0', source: 'sw', target: 'srv', sourceIface: 'p1', targetIface: 'b0' }, { id: 'd1', source: 'swb', target: 'srv', sourceIface: 'p1', targetIface: 'b1' });
    const id7 = openKept(dual, 'Dual');
    record(id7, 'backup', D1);
    getNode('sw').name = 'SW-Z'; save();
    select('srv', 'node');
    ok('a switch renamed: no port change before the next point', !block('port'), body().innerHTML);
    record(id7, 'backup', D2);
    select('srv', 'node');
    ok('nor after it', !block('port'), body().innerHTML);
    const sp = spansOf(T.trailOf(id7), 'srv', 'port');
    ok('one port span, carried over the rename', sp.length === 1 && sp[0].val === 'sw|p1' && sp[0].last === D2, JSON.stringify(sp));
    state.links = state.links.filter((l) => l.id !== 'd0'); save();
    record(id7, 'backup', D2 + 1000);
    const sp2 = spansOf(T.trailOf(id7), 'srv', 'port');
    ok('a cable really pulled is a port change', sp2.length === 2 && sp2.some((s) => s.val === 'swb|p1' && s.first === D2 + 1000), JSON.stringify(sp2));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    try { T.releaseTrailStore(); cards.forEach((c) => T.dropTrail(c)); } catch (e) { /* best effort */ }
    try { if (landingIsOpen()) closeLanding(); } catch (e) { /* closed */ }
    setLocale('en');
    persistLibrary(heldLib);
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
