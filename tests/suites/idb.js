// @realtime — the library's IndexedDB store for real. run.sh gives its pages no
// IndexedDB (every wait on it is idle time its virtual clock skips across), so
// this runs on Playwright's real clock. tests/suites/store.js covers the logic
// above the store; this covers the store itself: a card on disk is the text
// the library holds, deletes reach the disk, the old localStorage blob is
// merged in on opening and then removed, a reopened store (the next visit)
// reads back exactly the library, a journal left by a write that never landed
// is merged, another tab's write arrives over the BroadcastChannel, and the
// rewrite after a refusal leaves another tab's unannounced card alone.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const settled = () => libraryWritesSettled().then(tick);
  const until = async (cond) => { for (let i = 0; i < 100 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 10)); return cond(); };
  const blob = () => localStorage.getItem(LIBRARY_KEY);
  const J = (x) => JSON.stringify(x);
  const card = (id, name, updated) => ({ id, name, doc: { nodes: [], links: [] }, created: 1, updated });
  const ids = () => Object.keys(loadLibrary()).sort().join(',');

  // The database opened directly, as another tab or the next visit would.
  const raw = (fn) => new Promise((resolve, reject) => {
    const req = indexedDB.open(LIBRARY_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      fn(db, (v) => { db.close(); resolve(v); });
    };
  });
  const rawCards = () => raw((db, done) => {
    const tx = db.transaction(LIBRARY_STORE, 'readonly');
    const st = tx.objectStore(LIBRARY_STORE);
    const keys = st.getAllKeys(); const vals = st.getAll();
    tx.oncomplete = () => { const o = {}; keys.result.forEach((k, i) => { o[k] = vals.result[i]; }); done(o); };
  });
  const rawPut = (id, json) => raw((db, done) => {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    tx.objectStore(LIBRARY_STORE).put(json, id);
    tx.oncomplete = () => done(true);
  });

  const heldLib = loadLibrary();
  try {
    ok('on a real clock the library opens in IndexedDB', libraryStoreKind() === 'idb', libraryStoreKind());
    persistLibrary({});
    await settled();
    ok('emptying the library empties the disk', Object.keys(await rawCards()).length === 0);

    loadDocState(templatesData.house); autoBindLinks();
    const id = librarySave('Casa');
    await settled();
    let disk = await rawCards();
    ok('a saved card is on disk as the text the library holds', disk[id] === J(loadLibrary()[id]));
    const id2 = librarySave('Segunda');
    libraryDelete(id2);
    await settled();
    disk = await rawCards();
    ok('a deleted card leaves the disk, and only that one', !(id2 in disk) && id in disk);

    // ---- The old blob, merged on opening ----
    localStorage.setItem(LIBRARY_KEY, J({ m: card('m', 'From the old store', 5), [id]: card(id, 'Older copy', 1) }));
    const visit2 = idbLibraryAdapter();
    adoptLibraryStore(visit2, await visit2.readAll());
    await settled();
    disk = await rawCards();
    ok('opening the store merges the old blob into the disk', !!disk.m && JSON.parse(disk.m).name === 'From the old store');
    ok('newer wins against the old blob', JSON.parse(disk[id]).name === 'Casa');
    ok('and the old key is gone once the disk has it', blob() === null);

    // ---- The next visit reads back exactly the library ----
    const visit3 = idbLibraryAdapter();
    const back = await visit3.readAll();
    ok('a reopened store reads back exactly the library', Object.keys(back).sort().join() === ids()
       && Object.keys(back).every((k) => back[k] === J(loadLibrary()[k])), Object.keys(back).sort().join());
    adoptLibraryStore(visit3, back);

    // ---- A write that never lands: journalled, and merged next visit ----
    const stuck = libraryAdapter();
    stuck.write = () => new Promise(() => {});   // the tab closes with this transaction open
    libraryRename(id, 'Renamed as the tab closed');
    journalUnsettledCards();
    ok('the card in flight is journalled into the old key', !!blob() && JSON.parse(blob())[id].name === 'Renamed as the tab closed');
    disk = await rawCards();
    ok('(the disk never got it)', JSON.parse(disk[id]).name === 'Casa');
    const visit4 = idbLibraryAdapter();
    adoptLibraryStore(visit4, await visit4.readAll());
    await settled();
    disk = await rawCards();
    ok('the next visit merges the journal into the disk', JSON.parse(disk[id]).name === 'Renamed as the tab closed' && blob() === null);

    // ---- Another tab ----
    if (typeof BroadcastChannel === 'function') {
      await rawPut('tabB', J(card('tabB', 'Written by another tab', 40)));
      const otherTab = new BroadcastChannel(LIBRARY_DB);
      otherTab.postMessage({ ids: ['tabB'] });
      ok('a card another tab wrote arrives here', await until(() => !!loadLibrary().tabB));
      otherTab.close();
    } else ok('(no BroadcastChannel in this engine)', true);

    // ---- The rewrite after a refusal ----
    await rawPut('quiet', J(card('quiet', 'Another tab, unannounced', 41)));
    const real = libraryAdapter();
    const realWrite = real.write;
    real.write = () => Promise.resolve(false);
    libraryRename(id, 'Refused');
    await settled();
    ok('a refused write raises the storage banner', storageFailed());
    real.write = realWrite;
    libraryRename(id, 'Through again');
    await settled();
    disk = await rawCards();
    ok('the rewrite that follows puts every card and takes the banner down', !storageFailed()
       && Object.keys(loadLibrary()).every((k) => disk[k] === J(loadLibrary()[k])));
    ok('and leaves another tab’s card it never heard of', !!disk.quiet);
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e));
  } finally {
    persistLibrary(heldLib);
    await settled();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 0); });
