// @realtime — restore points (js/restore.js) on a real IndexedDB. run.sh gives
// its pages none, so this runs on Playwright's real clock;
// tests/suites/restore.js covers everything above the store. Here: the store
// opens, a point taken is on disk in both object stores and reported stored,
// its document is read back from the disk once the tab lets go of it, a
// reopened store lists it, another tab's point arrives over the
// BroadcastChannel, and dropped points leave the disk, including one another
// tab wrote that this one never heard of.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const R = window.CarinoRestore;
  const L = window.CarinoLibrary;
  const until = async (cond) => { for (let i = 0; i < 100 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 10)); return cond(); };
  const raw = (fn) => new Promise((resolve, reject) => {
    const req = indexedDB.open(R.RESTORE_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const db = req.result; fn(db, (v) => { db.close(); resolve(v); }); };
  });
  const rawGet = (store, id) => raw((db, done) => {
    const g = db.transaction(store, 'readonly').objectStore(store).get(id);
    g.onsuccess = () => done(g.result === undefined ? null : g.result);
  });
  const rawPut = (meta, doc) => raw((db, done) => {
    const tx = db.transaction(['points', 'docs'], 'readwrite');
    tx.objectStore('points').put(meta); tx.objectStore('docs').put({ id: meta.id, doc });
    tx.oncomplete = () => done(true);
  });
  const doc = { v: DOC_VERSION, nodes: [{ id: 'a', type: 'pc', name: 'PC-A', x: 0, y: 0, interfaces: [] }], links: [] };
  const heldLib = L.loadLibrary();

  try {
    L.persistLibrary({ 'rp-1': { id: 'rp-1', name: 'Casa', doc, created: 1, updated: 10 }, 'rp-2': { id: 'rp-2', name: 'Torre', doc, created: 1, updated: 10 } });
    ok('on a real clock the restore points open in IndexedDB', await R.openRestoreStore() === 'idb');
    const made = R.recordRestorePoint('rp-1', 'Before opening {file}', { fileName: 'visit.json' });
    ok('a point taken is reported stored', (await made.stored) === true);
    const meta = await rawGet('points', made.id);
    const held = await rawGet('docs', made.id);
    ok('its entry and its document are on disk', !!meta && meta.cardId === 'rp-1' && meta.fileName === 'visit.json' && !!held && held.doc.nodes[0].name === 'PC-A', JSON.stringify(meta));
    const back = await R.restorePointDoc(made.id);
    ok('its document is read back from the disk', !!back && back.nodes[0].name === 'PC-A');

    const again = R.idbRestoreAdapter();
    const all = await again.open();
    ok('a reopened store lists it', Array.isArray(all) && all.some((m) => m.id === made.id));

    await rawPut({ id: 'other-1', cardId: 'rp-2', at: 42, reason: 'Before restoring', bytes: 5, devices: 1, name: 'Torre', updated: 9 }, doc);
    const other = new BroadcastChannel(R.RESTORE_DB);
    other.postMessage({ cardIds: ['rp-2'] });
    const arrived = await until(() => R.hasRestorePoints('rp-2'));
    other.close();
    ok('another tab’s point arrives over the channel', arrived && R.restorePointsOf('rp-2')[0].id === 'other-1');

    R.dropRestorePoints('rp-1'); R.dropRestorePoints('rp-2');
    const gone = await until(async () => !(await rawGet('points', made.id)) && !(await rawGet('docs', made.id)) && !(await rawGet('points', 'other-1')));
    ok('dropped points leave the disk', gone);

    // A point another tab wrote without this one hearing of it (no message
    // on the channel) still leaves the disk when its card is deleted.
    L.persistLibrary(Object.assign(L.loadLibrary(), { 'rp-3': { id: 'rp-3', name: 'Bodega', doc, created: 1, updated: 10 } }));
    await rawPut({ id: 'unheard-1', cardId: 'rp-3', at: 43, reason: 'Before restoring', bytes: 5, devices: 1, name: 'Bodega', updated: 9 }, doc);
    ok('(this tab does not list it)', !R.hasRestorePoints('rp-3'));
    L.libraryDelete('rp-3');
    const unheard = await until(async () => !(await rawGet('points', 'unheard-1')) && !(await rawGet('docs', 'unheard-1')));
    ok('deleting its card drops it from both object stores', unheard);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    L.persistLibrary(heldLib);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
