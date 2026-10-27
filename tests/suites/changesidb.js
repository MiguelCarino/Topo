// @realtime — the baselines for "changes since the last back-up" (js/changes.js)
// on a real IndexedDB. run.sh gives its pages none (tests/README.md), so this
// runs on Playwright's real clock; tests/suites/changes.js covers everything
// above the store. Here: boot opens the store, a baseline taken is on disk as
// the record held, a dropped one leaves the disk, a reopened store (the next
// visit) reads them back, and another tab's baseline arrives over the
// BroadcastChannel.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const C = window.CarinoChanges;
  const until = async (cond) => { for (let i = 0; i < 100 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 10)); return cond(); };
  const raw = (fn) => new Promise((resolve, reject) => {
    const req = indexedDB.open(C.SNAPSHOT_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(C.SNAPSHOT_STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const db = req.result; fn(db, (v) => { db.close(); resolve(v); }); };
  });
  const rawGet = (id) => raw((db, done) => {
    const g = db.transaction(C.SNAPSHOT_STORE, 'readonly').objectStore(C.SNAPSHOT_STORE).get(id);
    g.onsuccess = () => done(g.result === undefined ? null : g.result);
  });
  const rawPut = (id, rec) => raw((db, done) => {
    const tx = db.transaction(C.SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(C.SNAPSHOT_STORE).put(rec, id);
    tx.oncomplete = () => done(true);
  });
  const doc = { v: DOC_VERSION, nodes: [{ id: 'a', type: 'pc', name: 'PC-A', x: 0, y: 0, interfaces: [] }], links: [] };

  try {
    // Boot does not wait for it; give it the moment it takes.
    ok('on a real clock the baselines open in IndexedDB', await C.openSnapshotStore() === 'idb');
    C.takeSnapshot('card-1', 'backup', doc);
    const onDisk = await until(async () => !!(await rawGet('card-1')));
    const rec = await rawGet('card-1');
    ok('a baseline taken is on disk', onDisk && rec.kind === 'backup' && rec.doc.nodes[0].name === 'PC-A', JSON.stringify(rec));
    ok('as the record the tab holds', JSON.stringify(rec.doc) === JSON.stringify(C.snapshotOf('card-1').doc) && rec.at === C.snapshotOf('card-1').at);

    // The next visit: a fresh store reads it back.
    const again = C.idbSnapshotAdapter();
    const all = await again.readAll();
    ok('a reopened store reads it back', !!all && !!all['card-1'] && all['card-1'].at === rec.at);

    // Another tab's baseline: written to the disk, announced on the channel.
    await rawPut('card-2', { at: 42, kind: 'report', doc });
    const other = new BroadcastChannel(C.SNAPSHOT_DB);
    other.postMessage({ ids: ['card-2'] });
    const arrived = await until(() => !!C.snapshotOf('card-2'));
    other.close();
    ok('another tab’s baseline arrives over the channel', arrived && C.snapshotOf('card-2').kind === 'report' && C.snapshotOf('card-2').at === 42);

    C.dropSnapshot('card-1'); C.dropSnapshot('card-2');
    const gone = await until(async () => !(await rawGet('card-1')) && !(await rawGet('card-2')));
    ok('a dropped baseline leaves the disk', gone);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
