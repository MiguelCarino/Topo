// @realtime — the address history's store (js/trail.js) on a real IndexedDB.
// run.sh gives its pages none (tests/README.md), so this runs on Playwright's
// real clock; tests/suites/trail.js covers everything above the store. Here:
// boot opens it, a point recorded is on disk as the record held, a reopened
// store (the next visit) reads it back, another tab's trail arrives over the
// BroadcastChannel, a record on disk that is not one is skipped, the open
// deadline falls back to this tab, a dropped trail leaves the disk, and the
// library's and the baselines' databases gain no store of it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const T = window.CarinoTrail;
  const L = window.CarinoLibrary;
  const C = window.CarinoChanges;
  const until = async (cond) => { for (let i = 0; i < 100 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 10)); return cond(); };
  const raw = (fn) => new Promise((resolve, reject) => {
    const req = indexedDB.open(T.TRAIL_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(T.TRAIL_STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const db = req.result; fn(db, (v) => { db.close(); resolve(v); }); };
  });
  const rawGet = (id) => raw((db, done) => {
    const g = db.transaction(T.TRAIL_STORE, 'readonly').objectStore(T.TRAIL_STORE).get(id);
    g.onsuccess = () => done(g.result === undefined ? null : g.result);
  });
  const rawPut = (id, rec) => raw((db, done) => {
    const tx = db.transaction(T.TRAIL_STORE, 'readwrite');
    tx.objectStore(T.TRAIL_STORE).put(rec, id);
    tx.oncomplete = () => done(true);
  });
  const storesOf = (name) => new Promise((resolve) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => { const list = [...req.result.objectStoreNames]; req.result.close(); resolve(list); };
    req.onerror = () => resolve(null);
  });
  const doc = { v: DOC_VERSION, nodes: [{ id: 'a', type: 'pc', name: 'PC-A', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] }], links: [] };
  const heldLib = L.loadLibrary();

  try {
    ok('on a real clock the trails open in IndexedDB', await T.openTrailStore() === 'idb');
    const id = L.librarySave('Trail card', null, { doc });
    ok('a point recorded', T.recordPoint(id, 'backup', doc));
    const onDisk = await until(async () => !!(await rawGet(id)));
    const rec = await rawGet(id);
    ok('is on disk', onDisk && rec.points.length === 1 && rec.devices.a.spans.some((s) => s.f === 'ip' && s.val === '10.0.0.5/24'), JSON.stringify(rec));
    ok('as the record the tab holds', JSON.stringify(rec) === JSON.stringify(T.trailOf(id)));

    const again = T.idbTrailAdapter();
    const all = await again.readAll();
    ok('a reopened store reads it back', !!all && !!all[id] && JSON.stringify(T.validTrail(all[id])) === JSON.stringify(T.trailOf(id)));

    // Another tab's trail: written to the disk, announced on the channel.
    const theirs = { v: 1, points: [{ at: 42, kind: 'report' }], devices: { b: { name: 'B', gone: null, spans: [{ f: 'name', k: '', val: 'B', txt: 'B', first: 42, last: 42, kind: 'report' }] } } };
    await rawPut('card-2', theirs);
    const other = new BroadcastChannel(T.TRAIL_DB);
    other.postMessage({ ids: ['card-2'] });
    ok('another tab’s trail arrives over the channel', await until(() => !!T.trailOf('card-2')) && T.trailOf('card-2').points[0].at === 42);
    // A record on disk that is not one is skipped, not trusted: card-3 arrives
    // valid, then its disk copy is overwritten with junk and announced again.
    await rawPut('card-3', theirs);
    other.postMessage({ ids: ['card-3'] });
    ok('a second card arrives valid', await until(() => !!T.trailOf('card-3')));
    await rawPut('card-3', { v: 1, points: 'nope', devices: {} });
    other.postMessage({ ids: ['card-3', 'card-2'] });
    ok('an invalid record on disk is skipped, not trusted', await until(() => T.trailOf('card-3') === null) && !!T.trailOf('card-2'));
    other.close();

    T.dropTrail(id); T.dropTrail('card-2'); T.dropTrail('card-3');
    ok('a dropped trail leaves the disk', await until(async () => !(await rawGet(id)) && !(await rawGet('card-2'))));

    // The deadline: a store that never answers is this tab's.
    const slow = { readAll: () => new Promise(() => {}), read: async () => null, put: async () => true, del: async () => true };
    ok('a store that does not answer in time falls back to this tab', await T.openTrailStore(slow, 50) === 'tab');

    // The other databases are as they were: no trail store in either.
    const snaps = await storesOf(C.SNAPSHOT_DB);
    ok('the baselines’ database has no trail store', !!snaps && !snaps.includes(T.TRAIL_STORE), JSON.stringify(snaps));
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    const libDb = dbs.map((d) => d.name).find((n) => n && n !== T.TRAIL_DB && n !== C.SNAPSHOT_DB);
    const libStores = libDb ? await storesOf(libDb) : [];
    ok('nor the library’s', !libStores || !libStores.includes(T.TRAIL_STORE), `${libDb}: ${JSON.stringify(libStores)}`);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    T.releaseTrailStore();
    persistLibrary(heldLib);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
