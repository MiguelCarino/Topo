// Where the library is kept (js/library.js): IndexedDB, written behind an
// in-memory copy, with the old localStorage blob as the fallback and as the
// way in. Driven here on a store of the suite's own — an object with the real
// adapter's three calls — because what can lose work is the logic above the
// store: what is merged on the way in and when the old key may go, which cards
// a write carries, what a refused write does to the banner and to the next
// write, what is journalled when the page closes mid-write, what another tab's
// write changes here, and a store that answers after boot stopped waiting.
// The real IndexedDB underneath is tests/suites/idb.js (real clock).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settled = () => libraryWritesSettled().then(tick);
  const blob = () => localStorage.getItem(LIBRARY_KEY);
  const J = (x) => JSON.stringify(x);
  const card = (id, name, updated) => ({ id, name, doc: { nodes: [], links: [] }, created: 1, updated });
  const shown = (id) => !document.getElementById(id).classList.contains('hidden');
  const ids = () => Object.keys(loadLibrary()).sort().join(',');

  // A store of our own: a Map for the disk, every write logged. `refuse`
  // makes the next commits fail (a full quota); `hold` keeps writes in flight
  // until released, as a transaction still running when the tab closes.
  const fakeStore = (initial = {}) => {
    const disk = new Map(Object.entries(initial));
    const st = {
      disk, log: [], refuse: false, hold: false, held: [],
      readAll: () => Promise.resolve(Object.fromEntries(disk)),
      readCards: (want) => Promise.resolve(want ? Object.fromEntries(want.map((id) => [id, disk.has(id) ? disk.get(id) : null])) : Object.fromEntries(disk)),
      write(op) {
        st.log.push({ puts: [...op.puts.keys()].sort(), dels: [...op.dels], full: op.full });
        const commit = () => {
          if (st.refuse) return false;
          op.puts.forEach((json, id) => disk.set(id, json));
          op.dels.forEach((id) => disk.delete(id));
          return true;
        };
        if (st.hold) return new Promise((resolve) => st.held.push(() => resolve(commit())));
        return Promise.resolve().then(commit);
      },
      release() { st.hold = false; st.held.splice(0).forEach((f) => f()); },
      last: () => st.log[st.log.length - 1] || {}
    };
    return st;
  };

  const heldKind = libraryStoreKind();
  const heldAdapter = libraryAdapter();
  const heldLib = loadLibrary();
  const heldBlob = blob();
  try {
    ok('boot has decided on a store before any suite runs', heldKind === 'local' || heldKind === 'idb', heldKind);
    // run.sh gives the page no IndexedDB; run-cross.mjs a real one.
    if (typeof indexedDB === 'undefined') {
      ok('without IndexedDB the real store answers null, and the library is on the fallback',
         (await idbLibraryAdapter().readAll()) === null && heldKind === 'local');
    } else {
      const all = await idbLibraryAdapter().readAll();
      ok('with IndexedDB the real store answers with its cards, and the library is in it',
         !!all && typeof all === 'object' && heldKind === 'idb');
    }

    // Start on the fallback with an empty library, whatever boot chose.
    releaseLibraryStore();
    persistLibrary({});

    // ---- The way in: the old blob merged once, newer wins ----
    localStorage.setItem(LIBRARY_KEY, J({
      a: card('a', 'Only in the old store', 5),
      b: card('b', 'Older in the old store', 1),
      c: card('c', 'Newer in the old store', 9),
      junk: 'not a card'
    }));
    const s1 = fakeStore({ b: J(card('b', 'On disk', 3)), c: J(card('c', 'On disk, older', 2)) });
    ok('opening the store switches the library to it', adoptLibraryStore(s1, await s1.readAll()) === 'idb' && libraryStoreKind() === 'idb');
    const lib1 = loadLibrary();
    ok('a card only the old store had is merged in', !!lib1.a && lib1.a.name === 'Only in the old store');
    ok('newer wins: the disk keeps a card it holds newer', lib1.b && lib1.b.name === 'On disk', lib1.b && lib1.b.name);
    ok('and takes the old store’s card where that one is newer', lib1.c && lib1.c.name === 'Newer in the old store');
    ok('what is not a card is left behind', !lib1.junk, ids());
    ok('the merge is one write of only what changed', s1.log.length === 1 && s1.log[0].puts.join() === 'a,c' && !s1.log[0].full, J(s1.log));
    ok('the old key stays until the disk has it', blob() !== null);
    await settled();
    ok('and goes once it does', blob() === null && s1.disk.has('a') && JSON.parse(s1.disk.get('c')).name === 'Newer in the old store');
    // The next visit: the same disk, no old key. Nothing to move, nothing written.
    const s = fakeStore(Object.fromEntries(s1.disk));
    adoptLibraryStore(s, await s.readAll());
    await settled();
    ok('the next visit finds nothing to move and writes nothing', s.log.length === 0 && ids() === 'a,b,c', ids());

    // ---- One card at a time ----
    loadDocState(templatesData.house); autoBindLinks();
    const idH = librarySave('Casa');
    ok('a save writes that card and nothing else', s.log.length === 1 && s.last().puts.join() === idH && !s.last().dels.length && !s.last().full, J(s.last()));
    ok('the library has it at once, before the disk does', !!loadLibrary()[idH] && !s.disk.has(idH));
    await settled();
    ok('and the disk a moment later, as the same text', s.disk.get(idH) === J(loadLibrary()[idH]));
    libraryRename('b', 'Renamed');
    ok('a rename writes that card only', s.last().puts.join() === 'b' && !s.last().dels.length);
    libraryDelete('a');
    await settled();
    ok('a delete removes that card only', s.last().dels.join() === 'a' && !s.last().puts.length && !s.disk.has('a') && s.disk.has('b'));
    loadDocState(templatesData.bank); autoBindLinks();
    const idDoomed = librarySave('To be deleted while the disk refuses');
    await settled();
    loadDocState(templatesData.house); autoBindLinks();
    const nWrites = s.log.length;
    persistLibrary(loadLibrary());
    ok('a write that changes nothing writes nothing', s.log.length === nWrites);
    const copy = loadLibrary(); copy.b.name = 'Changed, never persisted';
    ok('each read is a copy of its own', loadLibrary().b.name === 'Renamed' && libraryEntry('b').name === 'Renamed');
    ok('one card reads as the whole library has it', J(libraryEntry(idH)) === J(loadLibrary()[idH]) && libraryEntry('nope') === null);

    // ---- A write the disk refuses ----
    s.disk.set('elsewhere', J(card('elsewhere', 'Another tab, unannounced', 6)));
    s.refuse = true;
    libraryDelete(idDoomed);
    libraryRename('c', 'Refused');
    ok('a refused write still answers: the library has the change', loadLibrary().c.name === 'Refused' && !storageFailed());
    ok('and libraryWritesSettled() reports the refusal', (await libraryWritesSettled()) === false);
    await tick();
    ok('the storage banner goes up when the disk says no', storageFailed() && shown('storageBanner'));
    s.refuse = false;
    libraryRename('b', 'After the refusal');
    ok('the next write puts every card at once, so the refused one is in it',
       s.last().full === true && s.last().puts.join() === Object.keys(loadLibrary()).sort().join(), J(s.last()));
    ok('and repeats the refused delete', s.last().dels.join() === idDoomed, J(s.last()));
    await settled();
    ok('and once it lands the banner comes down', !storageFailed() && !shown('storageBanner'));
    ok('with every card of the library on disk as the library has it', !s.disk.has(idDoomed)
       && Object.keys(loadLibrary()).every((id) => s.disk.get(id) === J(loadLibrary()[id])));
    ok('and a card another tab added meanwhile still there', s.disk.has('elsewhere'));
    s.disk.delete('elsewhere');

    // A kept network: not safe to close while the disk refuses.
    replaceDocument(loadLibrary()[idH].doc, { libraryId: idH, origin: 'library' });
    s.refuse = true;
    getNode(state.nodes[0].id).name = 'Refused edit'; save();
    const f1 = flushAutosave();
    await settled();
    const f2 = flushAutosave();
    ok('autosave hands the edit over, then answers false once the disk refuses it', f1 === true && f2 === false);
    ok('and the bar says Not saved', document.getElementById('docBarStatus').textContent === 'Not saved');
    s.refuse = false;
    getNode(state.nodes[0].id).name = 'Saved edit'; save();
    flushAutosave();
    await settled();
    ok('the next edit that gets through clears it', flushAutosave() === true && !storageFailed()
       && JSON.parse(s.disk.get(idH)).doc.nodes.some((n) => n.name === 'Saved edit'));

    // ---- Leaving mid-write: the journal ----
    journalUnsettledCards();
    ok('with nothing in flight nothing is journalled', blob() === null);
    s.hold = true;
    getNode(state.nodes[0].id).name = 'In flight at close'; save();
    flushAutosave();
    journalUnsettledCards();
    const journal = JSON.parse(blob() || '{}');
    ok('a card whose write is in flight is copied into the old key', Object.keys(journal).join() === idH
       && journal[idH].updated === loadLibrary()[idH].updated, Object.keys(journal).join());
    // The tab closes here and the held write never lands. The next visit:
    const sNext = fakeStore(Object.fromEntries(s.disk));
    ok('(the disk never got it)', !JSON.parse(sNext.disk.get(idH)).doc.nodes.some((n) => n.name === 'In flight at close'));
    adoptLibraryStore(sNext, await sNext.readAll());
    await settled();
    ok('the next visit merges the journal into the disk and removes it',
       JSON.parse(sNext.disk.get(idH)).doc.nodes.some((n) => n.name === 'In flight at close') && blob() === null);
    // And a page that did not close after all: once the write lands, the journal goes.
    sNext.hold = true;
    libraryRename(idH, 'Casa Roma');
    journalUnsettledCards();
    const journalled = blob() !== null;
    sNext.release();
    await settled();
    ok('a journal whose write then landed is removed', journalled && blob() === null);
    // Written on top of what the key already holds, never over it.
    localStorage.setItem(LIBRARY_KEY, J({ other: card('other', 'Not merged yet', 7) }));
    sNext.hold = true;
    libraryRename(idH, 'Casa Roma II');
    journalUnsettledCards();
    const both = JSON.parse(blob());
    ok('the journal adds to the old key rather than replacing it', !!both.other && !!both[idH]);
    sNext.release();
    await settled();
    ok('and leaves the old key alone when someone else wrote it', blob() !== null);
    localStorage.removeItem(LIBRARY_KEY);

    // ---- Another tab ----
    if (typeof BroadcastChannel === 'function') {
      const otherTab = new BroadcastChannel(LIBRARY_DB);
      const until = async (cond) => { for (let i = 0; i < 40 && !cond(); i++) await tick(); return cond(); };
      openLanding(false);
      sNext.disk.set('fromB', J(card('fromB', 'Added in another tab', 50)));
      otherTab.postMessage({ ids: ['fromB'] });
      ok('a card another tab wrote arrives here', await until(() => !!loadLibrary().fromB));
      ok('and the landing redraws with it', !!document.querySelector('#landing .landing-card[data-id="fromB"]'));
      sNext.disk.delete('fromB');
      otherTab.postMessage({ ids: ['fromB'] });
      ok('a card another tab deleted leaves here', await until(() => !loadLibrary().fromB));
      sNext.hold = true;
      libraryRename('b', 'Mine, in flight');
      sNext.disk.set('b', J(card('b', 'Theirs', 99)));
      sNext.disk.set('c2', J(card('c2', 'Theirs too', 99)));
      otherTab.postMessage({ all: true });
      await until(() => !!loadLibrary().c2);
      ok('a card this tab is still writing is not overwritten by another tab’s',
         loadLibrary().b.name === 'Mine, in flight' && !!loadLibrary().c2);
      sNext.release();
      await settled();
      ok('its own write lands after, as the later write always did', JSON.parse(sNext.disk.get('b')).name === 'Mine, in flight');
      // A write refused here, then another tab's full rewrite announced as
      // {all:true}: quota is the whole site's, so both tabs tend to be refused
      // and the other's rewrite comes when the disk frees up. The disk lacks
      // what was refused here only because it was refused.
      sNext.disk.set('gone', J(card('gone', 'Deleted here, refused', 7)));
      sNext.disk.set('race', J(card('race', 'Edited in both', 7)));
      persistLibrary(Object.assign(loadLibrary(), { gone: card('gone', 'Deleted here, refused', 7), race: card('race', 'Edited in both', 7) }));
      await settled();
      sNext.refuse = true;
      persistLibrary(Object.assign(loadLibrary(), { unsaved: card('unsaved', 'Refused here', 60), race: card('race', 'Mine, refused', 61) }));
      libraryDelete('gone');
      await settled();
      sNext.refuse = false;
      ok('(the disk refused this tab’s writes)', storageFailed() && !sNext.disk.has('unsaved') && sNext.disk.has('gone'));
      sNext.disk.set('race', J(card('race', 'Theirs, edited later', 70)));
      sNext.disk.set('c3', J(card('c3', 'Their full rewrite', 70)));
      otherTab.postMessage({ all: true });
      await until(() => !!loadLibrary().c3);
      ok('a card the disk refused here is not taken for deleted by another tab’s rewrite',
         !!libraryEntry('unsaved') && libraryEntries().some((e) => e.id === 'unsaved'), ids());
      ok('so Back up all still has it', J(loadLibrary()).includes('Refused here'));
      ok('a card deleted here, the delete refused, is not brought back', !loadLibrary().gone, ids());
      ok('but where the other tab edited a card after this one, theirs wins', loadLibrary().race.name === 'Theirs, edited later', loadLibrary().race.name);
      libraryRename('b', 'After the other tab');
      await settled();
      ok('and the next write that gets through puts the refused card and repeats the delete',
         !storageFailed() && JSON.parse(sNext.disk.get('unsaved')).name === 'Refused here' && !sNext.disk.has('gone')
         && JSON.parse(sNext.disk.get('race')).name === 'Theirs, edited later');
      sNext.disk.set('unsaved', J(card('unsaved', 'Saved, then edited elsewhere', 80)));
      otherTab.postMessage({ ids: ['unsaved'] });
      ok('once on disk it follows other tabs again', await until(() => loadLibrary().unsaved.name === 'Saved, then edited elsewhere'));
      ['unsaved', 'race', 'c3'].forEach((id) => libraryDelete(id));
      await settled();
      closeLanding();
      otherTab.close();
    } else ok('(no BroadcastChannel in this engine: tabs catch up on the next visit)', true);

    // ---- A store slower than boot's patience ----
    releaseLibraryStore();
    persistLibrary({ l1: card('l1', 'Kept while waiting', 10) });
    const slow = fakeStore({ d1: J(card('d1', 'On a slow disk', 4)) });
    const fastRead = slow.readAll;
    slow.readAll = () => wait(200).then(fastRead);
    openLanding(false);
    const kind = await openLibraryStore(slow, 50);
    ok('past the deadline the page goes on with the fallback', kind === 'local' && libraryStoreKind() === 'local' && !loadLibrary().d1);
    await wait(250);
    await settled();
    ok('and adopts the store when it answers, keeping what was saved meanwhile',
       libraryStoreKind() === 'idb' && !!loadLibrary().d1 && !!loadLibrary().l1 && slow.disk.has('l1') && blob() === null, ids());
    ok('redrawing what reads the library', !!document.querySelector('#landing .landing-card[data-id="d1"]'));
    closeLanding();

    // ---- No IndexedDB at all ----
    releaseLibraryStore();
    ok('a browser without IndexedDB stays on the fallback, at once',
       (await openLibraryStore({ readAll: () => Promise.resolve(null) }, 5000)) === 'local' && libraryStoreKind() === 'local');
    ok('and putting the fallback back keeps the cards', !!loadLibrary().d1 && !!loadLibrary().l1 && !!JSON.parse(blob()).d1);
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e));
  } finally {
    releaseLibraryStore();
    if (heldKind === 'idb' && heldAdapter) {
      if (heldBlob === null) localStorage.removeItem(LIBRARY_KEY); else localStorage.setItem(LIBRARY_KEY, heldBlob);
      adoptLibraryStore(heldAdapter, await heldAdapter.readCards(null));
    } else persistLibrary(heldLib);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 0); });
