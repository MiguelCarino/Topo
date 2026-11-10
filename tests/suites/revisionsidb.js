// @realtime — the revision store (js/revisions.js) on a real IndexedDB, its
// own database (nettopo_revisions) opened through the restore points'
// adapter (js/restore.js idbRestoreAdapter, parameterised). run.sh gives its
// pages none, so this runs on Playwright's real clock;
// tests/suites/revisions.js covers everything above the store. Here: the
// store opens, a revision kept is on disk in both object stores under
// cardId|rev and reported stored, its document is read back once the tab
// lets go of it, a reopened store lists it, the restore points' database
// is not touched, and a deleted card's revisions leave the disk.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const RV = window.CarinoRevisions;
  const L = window.CarinoLibrary;
  const until = async (cond) => { for (let i = 0; i < 100 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 10)); return cond(); };
  const rawGet = (dbName, store, id) => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); resolve(null); return; }
      const g = db.transaction(store, 'readonly').objectStore(store).get(id);
      g.onsuccess = () => { db.close(); resolve(g.result === undefined ? null : g.result); };
    };
  });
  const doc = { v: DOC_VERSION, nodes: [{ id: 'a', type: 'pc', name: 'PC-A', x: 0, y: 0, interfaces: [] }], links: [] };
  const heldLib = L.loadLibrary();

  try {
    L.persistLibrary({ 'rv-1': { id: 'rv-1', name: 'Casa', doc, created: 1, updated: 10 } });
    ok('on a real clock the revisions open in IndexedDB', await RV.openRevisionStore() === 'idb');
    const made = RV.recordRevision('rv-1', 'revA', doc, 'export');
    ok('a revision kept is reported stored', (await made.stored) === true);
    const meta = await rawGet(RV.REVISION_DB, 'revs', 'rv-1|revA');
    const held = await rawGet(RV.REVISION_DB, 'revdocs', 'rv-1|revA');
    ok('its entry and its document are on disk under cardId|rev', !!meta && meta.cardId === 'rv-1' && meta.rev === 'revA' && meta.why === 'export'
       && !!held && held.doc.nodes[0].name === 'PC-A', JSON.stringify(meta));
    const back = await RV.revisionDoc('rv-1', 'revA');
    ok('its document is read back from the disk', !!back && back.nodes[0].name === 'PC-A');
    const all = await RV.idbRevisionAdapter().open();
    ok('a reopened store lists it', Array.isArray(all) && all.some((m) => m.id === 'rv-1|revA'));
    ok('the restore points\' database holds no such record', (await rawGet('nettopo_restore', 'points', 'rv-1|revA')) === null);
    const base = await RV.findBase(['nope', 'revA'], 'rv-1');
    ok('findBase reads it from the disk', !!base && base.rev === 'revA' && base.doc.nodes[0].name === 'PC-A');
    L.libraryDelete('rv-1');
    const gone = await until(async () => !(await rawGet(RV.REVISION_DB, 'revs', 'rv-1|revA')) && !(await rawGet(RV.REVISION_DB, 'revdocs', 'rv-1|revA')));
    ok('a deleted card\'s revisions leave both object stores', gone);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    L.persistLibrary(heldLib);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
