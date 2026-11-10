// Replace must not silently lose edits (docs/SCOPE.md section 2, part A),
// and nothing replaces a network newer-wins any more (section 3, step 2).
// askAboutKnownCopy offers Merge first; Replace with this copy (the old
// Update) judges the copy against the card's last back-up or report
// (js/changes.js): when both sides changed since and the copy lacks some of
// yours, the question says how many it would replace. Every Replace notes
// its restore point. A copy that is your last back-up is never merged.
// Binders: each differing network is a row of one summary (js/mergedoors.js),
// skipped by default; Replace with theirs over the network open on the
// canvas opens the new copy, so the canvas's next autosave cannot put the
// old one back.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const R = window.CarinoRestore;
  const L = window.CarinoLibrary;
  const C = window.CarinoChanges;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  let answer = 'update';
  const asked = [];
  const heldResponder = setDialogResponder((req) => {
    asked.push(req);
    if (req.kind === 'confirm') return true;
    if (req.kind === 'choice') return req.choices.some((c) => c.id === 'download') ? 'continue' : answer;
    return undefined;
  });
  const heldLib = L.loadLibrary();
  const heldDownload = window.downloadJson;
  window.downloadJson = () => {};

  // A store that takes every write, so no "could not be saved" question.
  const disk = new Map();
  const adapter = {
    open: async () => [],
    readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = []; }); return o; },
    readDoc: async (id) => (disk.has(id) ? clone(disk.get(id)) : null),
    write: (ops) => { ops.put.forEach((p) => disk.set(p.meta.id, clone(p.doc))); ops.del.forEach((id) => disk.delete(id)); return Promise.resolve(true); }
  };

  const node = (id, name) => ({ id, type: 'pc', name, x: 0, y: 0 });
  const docOf = (...names) => ({ v: DOC_VERSION, nodes: names.map((n, i) => node(`n${i}`, n)), links: [] });
  const card = (id, name, doc, updated) => ({ id, name, doc: clone(doc), created: 1, updated });
  const setLib = (cards) => { const lib = {}; cards.forEach((c) => { lib[c.id] = c; }); L.persistLibrary(lib); };
  const fileOf = (id, updated, doc) => ({ kind: 'nettopology', version: 1, doc: Object.assign({ v: DOC_VERSION, id, updated }, clone(doc)) });
  const names = (doc) => (doc && doc.nodes || []).map((n) => n.name).join(',');
  const lastChoice = () => asked.filter((q) => q.kind === 'choice' && q.choices.some((c) => c.id === 'update')).pop();
  const primaryOf = (q) => (q ? q.choices.filter((c) => c.primary).map((c) => c.id).join() : '');
  const ids = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9'];
  const binderOf = (sites) => ({ kind: L.BINDER_KIND, version: 1, sites });
  const byName = (name) => Object.values(L.loadLibrary()).find((e) => e.name === name);

  // The binder merge's summary (js/mergedoors.js): `rowAnswer(row)` per
  // row, and every summary asked is kept.
  let rowAnswer = () => 'skip';
  const summaries = [];
  const heldSummary = TopoMergeDoors.setMergeSummaryResponder((req) => {
    summaries.push(req);
    const o = {};
    req.rows.forEach((r) => { o[r.id] = rowAnswer(r); });
    return o;
  });
  const lastSummary = () => summaries[summaries.length - 1] || null;

  try {
    R._reset();
    await R.openRestoreStore(adapter);

    // ---- Both sides changed since the last back-up ----
    const BASE = docOf('Router', 'PC-1', 'PC-2');
    const mine = docOf('Router', 'PC-1 (mine)', 'PC-2');           // yours: one edit since the back-up
    setLib([card('u1', 'Casa Roma', mine, 2000)]);
    C.takeSnapshot('u1', 'backup', BASE);
    const theirs = docOf('Router', 'PC-1', 'PC-2 (theirs)');        // the copy: another edit, not yours
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    answer = 'copy'; asked.length = 0;
    await applyImportedDoc(fileOf('u1', 9000, theirs), { fileName: 'theirs.json' });
    let q = lastChoice();
    ok('both sides changed: the question says how many of yours Replace would replace',
       !!q && /Yours has 1 change since its last back-up that this copy does not have; replacing with this copy loses it\. A restore point is kept\./.test(q.message), q && q.message);
    ok('it says the copy differs, first', !!q && q.message.startsWith('You already have "Casa Roma" in this browser, and this copy differs from it.\n\n'), q && q.message);
    ok('Merge is the main answer; Replace with this copy, a copy and Open mine stay', !!q && q.choices.map((c) => c.id).join() === 'merge,update,copy,mine'
       && primaryOf(q) === 'merge' && q.choices[1].label === 'Replace with this copy', q && JSON.stringify(q.choices));
    ok('answering copy leaves the card as it was', names(L.libraryEntry('u1').doc) === names(mine) && !R.hasRestorePoints('u1'));

    // Choosing Replace anyway: a restore point first, holding your edit.
    answer = 'update'; asked.length = 0;
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    await applyImportedDoc(fileOf('u1', 9000, theirs), { fileName: 'theirs.json' });
    let pts = R.restorePointsOf('u1');
    ok('Replace with this copy replaces the card', names(L.libraryEntry('u1').doc) === names(theirs));
    ok('and a restore point holds your edit', pts.length === 1 && names(await R.restorePointDoc(pts[0].id)) === names(mine), JSON.stringify(pts));
    ok('the card\'s updated moves on, even for an older copy', L.libraryEntry('u1').updated > 2000, String(L.libraryEntry('u1').updated));

    // Two edits of yours, both missing: the plural.
    setLib([card('u2', 'Torre', docOf('Router', 'A (mine)', 'B (mine)'), 2000)]);
    C.takeSnapshot('u2', 'backup', docOf('Router', 'A', 'B'));
    answer = 'copy'; asked.length = 0;
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    await applyImportedDoc(fileOf('u2', 9000, docOf('Router (theirs)', 'A', 'B')), { fileName: 'x.json' });
    q = lastChoice();
    ok('two of yours: the plural', !!q && /Yours has 2 changes since its last back-up that this copy does not have; replacing with this copy loses them\./.test(q.message), q && q.message);

    // A report as the baseline says report.
    setLib([card('u3', 'Bodega', docOf('Core (mine)'), 2000)]);
    C.takeSnapshot('u3', 'report', docOf('Core'));
    asked.length = 0;
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    await applyImportedDoc(fileOf('u3', 9000, docOf('Core', 'Edge')), { fileName: 'y.json' });
    q = lastChoice();
    ok('a report baseline says "since its last report"', !!q && /Yours has 1 change since its last report that/.test(q.message) && primaryOf(q) === 'merge', q && q.message);

    // ---- The copy has your edits (made from yours, then edited): nothing lost ----
    setLib([card('u4', 'Casa', mine, 2000)]);
    C.takeSnapshot('u4', 'backup', BASE);
    asked.length = 0;
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    await applyImportedDoc(fileOf('u4', 9000, docOf('Router', 'PC-1 (mine)', 'PC-2', 'PC-3')), { fileName: 'z.json' });
    q = lastChoice();
    ok('a copy that has your edits warns of nothing; Replace notes its restore point',
       !!q && !/Yours has/.test(q.message) && primaryOf(q) === 'merge' && /Replacing keeps a restore point of yours first\./.test(q.message), q && q.message);

    // The copy is your back-up itself: yours already has everything in it
    // (js/mergedoors.js, A2), so no Merge, and no warning.
    asked.length = 0;
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    await applyImportedDoc(fileOf('u4', 9500, BASE), { fileName: 'z.json' });
    q = lastChoice();
    ok('a copy that is your last back-up: yours has everything, Open mine first, no Merge', !!q && !/Yours has/.test(q.message)
       && /yours already has everything in this copy/.test(q.message) && primaryOf(q) === 'mine' && !q.choices.some((c) => c.id === 'merge'), q && q.message);
    ok('updateWouldLose agrees', L.updateWouldLose(L.libraryEntry('u4'), BASE) === null
       && JSON.stringify(L.updateWouldLose(L.libraryEntry('u4'), theirs)) === '{"n":1,"kind":"backup"}');

    // ---- No baseline: two-way, said so, plus the restore-point note ----
    setLib([card('u5', 'Sin copia', mine, 2000)]);
    asked.length = 0;
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    await applyImportedDoc(fileOf('u5', 9000, theirs), { fileName: 'w.json' });
    q = lastChoice();
    ok('with no baseline the question says it merges two-way, plus the note', !!q && !/Yours has/.test(q.message)
       && q.message === 'You already have "Sin copia" in this browser, and this copy differs from it.\n\nNo copy both started from was found: merging keeps everything of yours and asks where the two differ.\n\nReplacing keeps a restore point of yours first.'
       && primaryOf(q) === 'merge', q && q.message);

    // ---- Keep this network over a card has the same question ----
    setLib([card('u6', 'Enlace', mine, 2000)]);
    C.takeSnapshot('u6', 'backup', BASE);
    openArrivedDocument(JSON.stringify(Object.assign({ v: DOC_VERSION, id: 'u6', updated: Date.now() + 120000 }, theirs)));
    answer = null; asked.length = 0;
    await keepThisNetwork();
    q = lastChoice();
    ok('Keep this network over a card warns the same way, Merge first', !!q && /Yours has 1 change since its last back-up/.test(q.message) && primaryOf(q) === 'merge'
       && q.choices.some((c) => c.id === 'copy' && c.label === 'Keep as a copy'), q && q.message);
    ok('a copy from before revisions, edited after your back-up, is compared with that back-up', !!q && /compared with your back-up of/.test(q.message), q && q.message);

    // ---- An edit typed just before opening a file is in the comparison and the point ----
    setLib([card('u1', 'Casa Roma', BASE, 2000)]);
    C.dropSnapshot('u1'); R._reset();
    replaceDocument(EMPTY_DOC, { origin: 'new' }); await openFromLibrary('u1');
    ok('the card is open', state.libraryId === 'u1' && isKept());
    batch(() => { state.nodes[0].name = 'Router (just typed)'; save(); });
    answer = 'update'; asked.length = 0;
    await applyImportedDoc(fileOf('u1', Date.now() + 600000, docOf('Router', 'PC-1', 'PC-2', 'PC-9')), { fileName: 'late.json' });
    pts = R.restorePointsOf('u1');
    q = lastChoice();
    ok('the pending edit is in the comparison', !!q && q.choices[1].label === 'Replace with this copy', q && q.choices[1].label);
    ok('and kept in the restore point', pts.length === 1 && names(await R.restorePointDoc(pts[0].id)) === 'Router (just typed),PC-1,PC-2', pts.length && names(await R.restorePointDoc(pts[0].id)));

    // ---- A binder that replaces the open network (the summary's Replace with theirs) ----
    setLib([card('u1', 'Casa Roma', BASE, 2000)]);
    R._reset();
    replaceDocument(EMPTY_DOC, { origin: 'new' }); await openFromLibrary('u1');
    batch(() => { state.nodes[1].name = 'PC-1 (pending)'; save(); });
    const later = Date.now() + 600000;
    rowAnswer = () => 'replace'; summaries.length = 0;
    await applyImportedDoc({ kind: L.BINDER_KIND, version: 1, sites: [{ id: 'u1', name: 'Casa Roma', updated: later, doc: docOf('Router', 'PC-1', 'PC-2', 'NAS') }] }, { fileName: 'estate.json' });
    pts = R.restorePointsOf('u1');
    ok('a differing copy with no common base is asked about, never newer-wins', summaries.length === 1 && lastSummary().rows.length === 1
       && lastSummary().rows[0].reason === 'No copy both started from was found', JSON.stringify(summaries.map((s) => s.rows)));
    ok('the pending edit went into the card before the binder replaced it', pts.length === 1 && names(await R.restorePointDoc(pts[0].id)) === 'Router,PC-1 (pending),PC-2',
       pts.length && names(await R.restorePointDoc(pts[0].id)));
    ok('the restore point says the binder file', pts.length === 1 && R.restoreReasonText(pts[0]) === 'Before merging estate.json', pts.length && R.restoreReasonText(pts[0]));
    ok('the canvas opens the binder\'s copy', state.libraryId === 'u1' && names(serializeDoc()) === 'Router,PC-1,PC-2,NAS', names(serializeDoc()));
    batch(() => { state.nodes[0].name = 'Router 2'; save(); });
    flushAutosave();
    ok('so the next autosave keeps the import', names(L.libraryEntry('u1').doc) === 'Router 2,PC-1,PC-2,NAS', names(L.libraryEntry('u1').doc));

    // The guest shelf's Keep, the same.
    await keepGuestSites([{ id: 'u1', name: 'Casa Roma', updated: Date.now() + 700000, doc: docOf('Router', 'AP') }]);
    ok('the guest shelf replacing the open network opens its copy too', names(serializeDoc()) === 'Router,AP' && names(L.libraryEntry('u1').doc) === 'Router,AP', names(serializeDoc()));

    // A binder that does not touch the open network leaves the canvas alone.
    setLib([card('u1', 'Casa Roma', BASE, 2000), card('u2', 'Torre', docOf('Core'), 2000)]);
    replaceDocument(EMPTY_DOC, { origin: 'new' }); await openFromLibrary('u1');
    batch(() => { state.nodes[0].name = 'Router (here)'; save(); });
    await applyImportedBinder({ kind: L.BINDER_KIND, version: 1, sites: [{ id: 'u2', name: 'Torre', updated: Date.now() + 600000, doc: docOf('Core', 'Edge') }] });
    ok('a binder that replaces another card leaves the open one as it is', state.libraryId === 'u1' && state.nodes[0].name === 'Router (here)'
       && names(L.libraryEntry('u1').doc) === 'Router (here),PC-1,PC-2' && names(L.libraryEntry('u2').doc) === 'Core,Edge', names(serializeDoc()));

    // ---- A binder file over cards that differ: one summary, a choice each ----
    flushAutosave(); replaceDocument(EMPTY_DOC, { origin: 'new' });
    R._reset();
    setLib([card('u7', 'Casa Roma', mine, 2000), card('u8', 'Torre', docOf('Core'), 2000)]);
    C.takeSnapshot('u7', 'backup', BASE);
    const estate = () => binderOf([{ id: 'u7', name: 'Casa Roma', updated: 9000, doc: theirs }, { id: 'u8', name: 'Torre', updated: 9000, doc: docOf('Core', 'Edge') }]);
    rowAnswer = (r) => (r.id === 'u7' ? 'copy' : 'replace'); summaries.length = 0; asked.length = 0;
    await applyImportedDoc(estate(), { fileName: 'estate.json' });
    ok('a binder: both differing cards are in one summary, nothing asked one by one', summaries.length === 1
       && lastSummary().rows.map((r) => r.id).join() === 'u7,u8' && !asked.some((x) => x.kind === 'choice'), JSON.stringify(summaries.map((s) => s.rows)));
    ok('every row can be reviewed', lastSummary().rows.every((r) => r.canReview));
    ok('Keep as a copy keeps yours, with no restore point', names(L.libraryEntry('u7').doc) === names(mine) && !R.hasRestorePoints('u7'));
    const copyCard = byName('Casa Roma (copy)');
    ok('and adds the binder\'s copy as a card of its own', !!copyCard && copyCard.id !== 'u7' && names(copyCard.doc) === names(theirs), copyCard && copyCard.id);
    ok('Replace with theirs replaces the other, after a restore point', names(L.libraryEntry('u8').doc) === 'Core,Edge' && R.hasRestorePoints('u8'));

    setLib([card('u7', 'Casa Roma', mine, 2000), card('u8', 'Torre', docOf('Core'), 2000)]);
    R._reset(); summaries.length = 0;
    TopoMergeDoors.setMergeSummaryResponder((req) => { summaries.push(req); return null; });
    ok('Cancel imports nothing', (await applyImportedDoc(estate(), { fileName: 'estate.json' })) === false
       && names(L.libraryEntry('u7').doc) === names(mine) && names(L.libraryEntry('u8').doc) === 'Core' && !byName('Casa Roma (copy)'));
    TopoMergeDoors.setMergeSummaryResponder((req) => { summaries.push(req); const o = {}; req.rows.forEach((r) => { o[r.id] = rowAnswer(r); }); return o; });
    rowAnswer = () => 'skip';
    await applyImportedDoc(estate(), { fileName: 'estate.json' });
    ok('Skip, the default, leaves every card as it was and takes no restore point', names(L.libraryEntry('u7').doc) === names(mine)
       && names(L.libraryEntry('u8').doc) === 'Core' && !R.hasRestorePoints('u7') && !R.hasRestorePoints('u8'));
    rowAnswer = () => 'replace';
    await applyImportedDoc(estate(), { fileName: 'estate.json' });
    pts = R.restorePointsOf('u7');
    ok('Replace with theirs replaces it after a restore point holding your edit', names(L.libraryEntry('u7').doc) === names(theirs)
       && pts.length === 1 && names(await R.restorePointDoc(pts[0].id)) === names(mine) && !byName('Casa Roma (copy)'));

    // The guest shelf's Keep asks the same.
    setLib([card('u7', 'Casa Roma', mine, 2000)]);
    rowAnswer = () => 'copy'; summaries.length = 0;
    await keepGuestSites([{ id: 'u7', name: 'Casa Roma', updated: 9000, doc: theirs }]);
    ok('the guest shelf\'s Keep asks too, and Keep as a copy keeps yours', summaries.length === 1
       && names(L.libraryEntry('u7').doc) === names(mine) && !!byName('Casa Roma (copy)'));

    // ---- A binder older than the open card's pending edit, skipped: nothing changes ----
    setLib([card('u1', 'Casa Roma', BASE, 2000)]);
    C.dropSnapshot('u1'); R._reset();
    replaceDocument(EMPTY_DOC, { origin: 'new' }); await openFromLibrary('u1');
    batch(() => { state.nodes[0].name = 'Router (pending)'; save(); });
    rowAnswer = () => 'skip'; summaries.length = 0;
    await applyImportedDoc(binderOf([{ id: 'u1', name: 'Casa Roma', updated: 5000, doc: docOf('Router', 'Old') }]), { fileName: 'old.json' });
    ok('a skipped binder copy takes no restore point and changes nothing', summaries.length === 1 && !R.hasRestorePoints('u1')
       && names(L.libraryEntry('u1').doc) === 'Router (pending),PC-1,PC-2', names(L.libraryEntry('u1').doc));
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack);
  } finally {
    TopoMergeDoors.setMergeSummaryResponder(heldSummary);
    ids.forEach((id) => C.dropSnapshot(id));
    R.releaseRestoreStore(); R._reset();
    window.downloadJson = heldDownload;
    setDialogResponder(heldResponder);
    if (landingIsOpen()) closeLanding();
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    L.persistLibrary(heldLib);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
