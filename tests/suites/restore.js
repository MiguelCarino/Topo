// Restore points (js/restore.js, docs/SCOPE.md section 2): before a file, a
// binder, a link or a sheet changes a kept network, the card as it was is kept
// in a store of its own; Restore puts one back (keeping the state it replaces
// as a point first) and Download hands it over as a normal back-up.
//
// run.sh takes IndexedDB away, so the store here is a fake adapter that can
// take writes, refuse them or never answer. The real database and the
// BroadcastChannel are hand-verified (an @realtime suite like changesidb.js
// would be the place for them).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const R = window.CarinoRestore;
  const L = window.CarinoLibrary;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // The page's questions: `answer` for the Update / copy question, `failAnswer`
  // for "could not be saved" (told apart by its Download choice).
  let answer = 'update', failAnswer = 'continue';
  const asked = [];
  const heldResponder = setDialogResponder((req) => {
    // Whether the Restore points dialog was still showing when this was asked.
    req.restoreOpen = !!el('restoreDialog') && !el('restoreDialog').hidden;
    asked.push(req);
    if (req.kind === 'confirm') return true;
    if (req.kind === 'choice' && req.choices.some((c) => c.id === 'open') && !req.choices.some((c) => c.id === answer)) return 'open';
    if (req.kind === 'choice') return req.choices.some((c) => c.id === 'download') ? failAnswer : answer;
    return undefined;
  });
  // The binder merge's summary (js/mergedoors.js): Replace with theirs,
  // unless rowAnswer says otherwise.
  let rowAnswer = () => 'replace';
  const heldSummary = TopoMergeDoors.setMergeSummaryResponder((req) => {
    const o = {};
    req.rows.forEach((r) => { o[r.id] = rowAnswer(r); });
    return o;
  });
  const failQuestions = () => asked.filter((q) => q.kind === 'choice' && q.choices.some((c) => c.id === 'download'));
  const heldLib = L.loadLibrary();
  const heldDownload = window.downloadJson;
  const heldLimits = Object.assign({}, R.RESTORE_LIMITS);
  const downloads = [];
  window.downloadJson = (payload, name) => { downloads.push({ payload: clone(payload), name }); };

  // A store that keeps what it is given, in this tab.
  const makeDisk = (initial = []) => {
    const disk = new Map(initial.map((r) => [r.meta.id, r]));
    const f = { disk, mode: 'ok', writes: [] };
    f.adapter = {
      open: async () => [...disk.values()].map((r) => clone(r.meta)),
      readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = [...disk.values()].filter((r) => r.meta.cardId === id).map((r) => clone(r.meta)); }); return o; },
      readDoc: async (id) => (disk.has(id) ? clone(disk.get(id).doc) : null),
      write: (ops) => {
        f.writes.push({ put: ops.put.map((p) => p.meta.id), del: ops.del.slice() });
        if (f.mode === 'hang') return new Promise(() => {});
        if (f.mode === 'fail') return Promise.resolve(false);
        ops.put.forEach((p) => disk.set(p.meta.id, { meta: clone(p.meta), doc: clone(p.doc) }));
        ops.del.forEach((id) => disk.delete(id));
        return Promise.resolve(true);
      },
      dropCard: (cardId) => {
        if (f.mode !== 'ok') return Promise.resolve(false);
        [...disk.values()].filter((r) => r.meta.cardId === cardId).forEach((r) => disk.delete(r.meta.id));
        return Promise.resolve(true);
      }
    };
    return f;
  };

  const node = (id, name) => ({ id, type: 'pc', name, x: 0, y: 0 });
  const docOf = (...names) => ({ v: DOC_VERSION, nodes: names.map((n, i) => node(`n${i}`, n)), links: [] });
  const card = (id, name, doc, updated) => ({ id, name, doc: clone(doc), created: 1, updated });
  const setLib = (cards) => { const lib = {}; cards.forEach((c) => { lib[c.id] = c; }); L.persistLibrary(lib); };
  const fileOf = (id, updated, doc) => ({ kind: 'nettopology', version: 1, doc: Object.assign({ v: DOC_VERSION, id, updated }, clone(doc)) });
  const names = (doc) => (doc && doc.nodes || []).map((n) => n.name).join(',');
  const until = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await wait(10); return cond(); };

  try {
    R._reset();
    ok('without IndexedDB the store is this tab only', (await R.openRestoreStore()) === 'tab');
    let f = makeDisk();
    ok('a store that answers is taken', (await R.openRestoreStore(f.adapter)) === 'idb');

    // ---- B: every part of the document is a change ----
    const base = docOf('A', 'B');
    const withKey = (k, v) => Object.assign(clone(base), { [k]: v });
    [['networks', [{ id: 'net1', cidr: '10.0.0.0/24', name: 'LAN' }]],
     ['groups', [{ id: 'g1', name: 'Rack 1', kind: 'rack' }]],
     ['wifi', [{ id: 'w1', ssid: 'Casa' }]],
     ['providers', [{ id: 'p1', name: 'ISP' }]],
     ['columns', [{ id: 'c1', name: 'Tag', kind: 'text' }]]].forEach(([k, v]) => {
      ok(`a document differing only in ${k} is not the same`, docChangeCount(base, withKey(k, v)) >= 1, String(docChangeCount(base, withKey(k, v))));
    });

    // ---- 1. Opening a file onto a card: Update ----
    const D1 = docOf('Router', 'PC-1');
    setLib([card('c1', 'Casa Roma', D1, 1000)]);
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    answer = 'update'; asked.length = 0;
    const took = await applyImportedDoc(fileOf('c1', 2000, docOf('Router', 'PC-1', 'PC-2')), { fileName: 'visit.json' });
    let pts = R.restorePointsOf('c1');
    ok('Update opens the file onto the card', took === true && names(L.libraryEntry('c1').doc) === 'Router,PC-1,PC-2', names(L.libraryEntry('c1').doc));
    ok('and a restore point was kept first', pts.length === 1 && pts[0].reason === 'Before opening {file}' && pts[0].fileName === 'visit.json', JSON.stringify(pts));
    ok('holding the card as it was', names(await R.restorePointDoc(pts[0].id)) === 'Router,PC-1');
    ok('with its device count and size', pts[0].devices === 2 && pts[0].bytes > 0);
    ok('the reason reads with the file name', R.restoreReasonText(pts[0]) === 'Before opening visit.json');
    ok('written to the store, with no question', f.disk.has(pts[0].id) && failQuestions().length === 0);

    // A file of a network not here adds a card: nothing kept is overwritten.
    const before = f.writes.length;
    await applyImportedDoc(fileOf('c9', 3000, docOf('Solo')), { fileName: 'new.json' });
    ok('a file that only adds a card takes no restore point', !R.hasRestorePoints('c9') && f.writes.length === before && !!L.libraryEntry('c9'));

    // ---- 2. A binder that replaces cards (the merge summary's Replace with theirs) ----
    const BK = L.BINDER_KIND;
    setLib([card('c1', 'Casa Roma', D1, 1000), card('c2', 'Torre A', docOf('Core'), 1000), card('c3', 'Bodega', docOf('Old'), Date.now() + 600000)]);
    R._reset();
    rowAnswer = (r) => (r.id === 'c3' ? 'skip' : 'replace');
    await applyImportedDoc({ kind: BK, version: 1, sites: [
      { id: 'c1', name: 'Casa Roma', updated: 5000, doc: docOf('Router', 'NAS') },
      { id: 'c3', name: 'Bodega', updated: 5000, doc: docOf('Older') },
      { id: 'nb', name: 'Nueva', updated: 5000, doc: docOf('X') }] }, { fileName: 'estate.json' });
    pts = R.restorePointsOf('c1');
    ok('a binder file: a point of each card it replaces', pts.length === 1 && pts[0].reason === 'Before merging {file}' && pts[0].fileName === 'estate.json'
       && names(L.libraryEntry('c1').doc) === 'Router,NAS', JSON.stringify(pts));
    ok('none for a card it does not replace (skipped) or one it adds', !R.hasRestorePoints('c3') && !R.hasRestorePoints('nb') && names(L.libraryEntry('c3').doc) === 'Old');
    rowAnswer = () => 'replace';
    await applyImportedBinder({ kind: BK, version: 1, sites: [{ id: 'c2', name: 'Torre A', updated: 6000, doc: docOf('Core', 'Edge') }] });
    pts = R.restorePointsOf('c2');
    ok('applyImportedBinder on its own takes them too', pts.length === 1 && pts[0].reason === 'Before merging a binder' && names(await R.restorePointDoc(pts[0].id)) === 'Core', JSON.stringify(pts));

    // ---- 3. The guest shelf's Keep ----
    const kept = keepGuestSites([{ id: 'c2', name: 'Torre A', updated: 7000, doc: docOf('Core', 'Edge', 'AP') }]);
    ok('Keep that replaces a card waits for its point', kept && typeof kept.then === 'function');
    await kept;
    pts = R.restorePointsOf('c2');
    ok('and the point is "Before merging a link"', pts[0].reason === 'Before merging a link' && names(await R.restorePointDoc(pts[0].id)) === 'Core,Edge'
       && names(L.libraryEntry('c2').doc) === 'Core,Edge,AP', JSON.stringify(pts.map((p) => p.reason)));
    await keepGuestSites([{ id: 'g9', name: 'Otra', updated: 1, doc: docOf('Y') }]);
    ok('Keep that only adds takes no point', !!L.libraryEntry('g9') && !R.hasRestorePoints('g9'));

    // ---- 4. Keep this network over a card, from a link ----
    const linkDoc = Object.assign({ v: DOC_VERSION, id: 'c2', updated: Date.now() + 120000 }, docOf('Core', 'Edge', 'AP', 'Cam'));
    openArrivedDocument(JSON.stringify(linkDoc));
    answer = 'update';
    const keptId = await keepThisNetwork();
    pts = R.restorePointsOf('c2');
    ok('Keep this network that updates a card keeps a point first', keptId === 'c2' && pts[0].reason === 'Before updating from a link'
       && names(await R.restorePointDoc(pts[0].id)) === 'Core,Edge,AP' && names(L.libraryEntry('c2').doc) === 'Core,Edge,AP,Cam', JSON.stringify(pts.map((p) => p.reason)));

    // ---- 5. A sheet applied to a kept network ----
    await openFromLibrary('c1');
    ok('the card is open and kept', state.libraryId === 'c1' && isKept());
    const ptsBefore = R.restorePointsOf('c1').length;
    el('csvMenuBtn').click();
    el('csvTabs').querySelector('[data-csvtab="import"]').click();
    el('csvText').value = 'name,type\nKiosk,pc';
    csvReparse(); renderCsvDialog();
    el('csvReviewBtn').click();
    _csv.fileName = 'inventario.csv';
    el('csvApplyBtn').click();
    await until(() => state.nodes.some((n) => n.name === 'Kiosk'));
    pts = R.restorePointsOf('c1');
    ok('Apply on a kept network keeps a point first', pts.length === ptsBefore + 1 && pts[0].reason === 'Before importing {file}' && pts[0].fileName === 'inventario.csv'
       && names(await R.restorePointDoc(pts[0].id)) === 'Router,NAS', JSON.stringify(pts[0]));
    ok('and then applies the sheet', state.nodes.some((n) => n.name === 'Kiosk') && el('csvDialog').hidden);

    // ---- 6. A binder file: bound, and read again at each Back up all ----
    // The picker and the handle store are doubles (as in binderfile.js).
    const heldPicker = window.showSaveFilePicker;
    const heldExport = localStorage.getItem(L.BINDER_EXPORT_KEY);
    let mem = null;
    const heldHandleStore = setHandleStore({ get: () => Promise.resolve(mem), put: (h) => { mem = h; return Promise.resolve(); }, del: () => { mem = null; return Promise.resolve(); } });
    const fileHandle = (sites) => {
      const h = { name: 'estate.json', written: JSON.stringify({ kind: BK, version: 1, sites }) };
      h.queryPermission = () => Promise.resolve('granted'); h.requestPermission = h.queryPermission;
      h.getFile = () => Promise.resolve({ text: () => Promise.resolve(h.written) });
      h.createWritable = () => Promise.resolve({ write: (x) => { h.written = x; return Promise.resolve(); }, close: () => Promise.resolve(), abort: () => Promise.resolve() });
      return h;
    };
    try {
      flushAutosave(); replaceDocument(EMPTY_DOC, { origin: 'new' });
      setLib([card('c4', 'Clínica', docOf('Old'), 1000)]);
      const picked = fileHandle([{ id: 'c4', name: 'Clínica', created: 1, updated: 9000, doc: docOf('Old', 'New') }]);
      window.showSaveFilePicker = () => Promise.resolve(picked);
      await exportBinder();
      pts = R.restorePointsOf('c4');
      ok('binding a file that holds a different copy: Replace with theirs keeps a point first', pts.length === 1 && pts[0].reason === 'Before merging {file}' && pts[0].fileName === 'estate.json'
         && names(await R.restorePointDoc(pts[0].id)) === 'Old' && names(L.libraryEntry('c4').doc) === 'Old,New', JSON.stringify(pts));
      picked.written = JSON.stringify({ kind: BK, version: 1, sites: [{ id: 'c4', name: 'Clínica', created: 1, updated: Date.now() + 600000, doc: docOf('Old', 'New', 'Newer') }] });
      await exportBinder();
      pts = R.restorePointsOf('c4');
      ok('so does Back up all reading a different copy from the bound file', pts.length === 2 && pts[0].fileName === 'estate.json'
         && names(await R.restorePointDoc(pts[0].id)) === 'Old,New' && names(L.libraryEntry('c4').doc) === 'Old,New,Newer', JSON.stringify(pts.map((p) => p.reason)));
    } finally {
      window.showSaveFilePicker = heldPicker;
      await clearBinderHandle();
      setHandleStore(heldHandleStore);
      if (heldExport === null) localStorage.removeItem(L.BINDER_EXPORT_KEY); else localStorage.setItem(L.BINDER_EXPORT_KEY, heldExport);
    }
    setLib([card('c1', 'Casa Roma', D1, 1000), card('c2', 'Torre A', docOf('Core'), 1000), card('c3', 'Bodega', docOf('Old'), 1000)]);
    ['c1', 'c2'].forEach((id) => R.recordRestorePoint(id, 'Before restoring'));

    // ---- The caps ----
    R.RESTORE_LIMITS.perCard = 3;
    f.writes.length = 0;
    const made = [];
    for (let i = 0; i < 5; i++) made.push(R.recordRestorePoint('c3', 'Before restoring').id);
    await wait(0);
    pts = R.restorePointsOf('c3');
    ok('at most perCard points per card, the oldest dropped first', pts.length === 3 && pts.map((p) => p.id).join() === made.slice(2).reverse().join(), pts.map((p) => p.id).join());
    ok('and the dropped ones are deleted from the store', made.slice(0, 2).every((id) => !f.disk.has(id)) && f.writes.some((w) => w.del.length));
    R.RESTORE_LIMITS.perCard = 20;
    const size = R.restorePointsOf('c3')[0].bytes;
    const total = () => ['c1', 'c2', 'c3'].reduce((s, id) => s + R.restorePointsOf(id).reduce((a, p) => a + p.bytes, 0), 0);
    const all = () => ['c1', 'c2', 'c3'].flatMap((id) => R.restorePointsOf(id));
    const oldest = all().sort((a, b) => a.at - b.at)[0];
    R.RESTORE_LIMITS.totalBytes = total() - 1;
    const newest = R.recordRestorePoint('c3', 'Before restoring').id;
    ok('past the total size the oldest point of any card goes first', !all().some((p) => p.id === oldest.id) && all().some((p) => p.id === newest) && total() <= R.RESTORE_LIMITS.totalBytes,
       `${total()} / ${R.RESTORE_LIMITS.totalBytes}`);
    R.RESTORE_LIMITS.totalBytes = 1;
    const only = R.recordRestorePoint('c3', 'Before restoring').id;
    ok('the newest point is kept even when it alone is past the cap', all().length === 1 && all()[0].id === only && size > 1);
    R.RESTORE_LIMITS.totalBytes = heldLimits.totalBytes;

    // ---- When a point cannot be stored ----
    flushAutosave(); replaceDocument(EMPTY_DOC, { origin: 'new' });
    setLib([card('c1', 'Casa Roma', D1, 1000)]);
    R._reset();
    const later = (n) => fileOf('c1', 2000 + n, docOf('Router', 'PC-1', `New-${n}`));
    f.mode = 'fail';
    asked.length = 0; failAnswer = null;
    ok('a refused write asks, and Cancel stops the Update', (await applyImportedDoc(later(1), { fileName: 'a.json' })) === false && names(L.libraryEntry('c1').doc) === 'Router,PC-1');
    const q = failQuestions()[0];
    ok('the question names the network and offers a download, Continue without and Cancel', !!q && /Casa Roma/.test(q.message)
       && q.choices.map((c) => c.id).join() === 'continue,download' && q.choices.find((c) => c.id === 'download').primary === true,
       q ? JSON.stringify(q.choices) : 'not asked');
    downloads.length = 0; failAnswer = 'continue';
    ok('Continue without goes ahead with no download', (await applyImportedDoc(later(2), { fileName: 'b.json' })) === true
       && names(L.libraryEntry('c1').doc) === 'Router,PC-1,New-2' && downloads.length === 0);
    failAnswer = 'download';
    const cardThen = L.libraryEntry('c1');
    ok('Download a back-up first downloads the card and goes ahead', (await applyImportedDoc(later(3), { fileName: 'c.json' })) === true
       && names(L.libraryEntry('c1').doc) === 'Router,PC-1,New-3' && downloads.length === 1, String(downloads.length));
    const dl = downloads[0] && downloads[0].payload;
    ok('the back-up is the usual identified .json of the card as it was', !!dl && dl.kind === 'nettopology' && dl.version === 1 && dl.name === 'Casa Roma'
       && dl.doc.id === 'c1' && dl.doc.updated === cardThen.updated && names(dl.doc) === 'Router,PC-1,New-2' && /^topo_casa-roma_\d{4}-\d{2}-\d{2}\.json$/.test(downloads[0].name),
       downloads[0] && downloads[0].name);
    f.mode = 'hang'; R.RESTORE_LIMITS.writeMs = 30; asked.length = 0; failAnswer = 'continue';
    await applyImportedDoc(later(4), { fileName: 'd.json' });
    ok('a write with no answer counts as not stored', failQuestions().length === 1);
    R.RESTORE_LIMITS.writeMs = heldLimits.writeMs; f.mode = 'ok';
    R.releaseRestoreStore(); asked.length = 0;
    await applyImportedDoc(later(5), { fileName: 'e.json' });
    ok('with no store at all it asks too', failQuestions().length === 1);
    asked.length = 0;
    await applyImportedDoc(fileOf('c8', 3000, docOf('Z')), { fileName: 'z.json' });
    ok('but not when nothing kept is overwritten', failQuestions().length === 0 && !!L.libraryEntry('c8'));
    ok('a point that could not be stored still lists in this tab', R.restorePointsOf('c1').length >= 1);

    // ---- Opening the store: the disk and this tab joined ----
    const tabPoint = R.recordRestorePoint('c1', 'Before restoring').id;
    const diskMeta = { id: 'disk-1', cardId: 'c1', at: 5, reason: 'Before opening {file}', fileName: 'old.json', bytes: 10, devices: 1, name: 'Casa Roma', updated: 4 };
    f = makeDisk([{ meta: diskMeta, doc: docOf('Disk') }, { meta: { id: 'bad' }, doc: {} }]);
    await R.openRestoreStore(f.adapter);
    await until(() => f.disk.has(tabPoint));
    pts = R.restorePointsOf('c1');
    ok('a point on disk joins the list, oldest last', pts[pts.length - 1].id === 'disk-1' && names(await R.restorePointDoc('disk-1')) === 'Disk');
    ok('a broken record is skipped', !pts.some((p) => p.id === 'bad'));
    ok('a point this tab held is written once the store opens', f.disk.has(tabPoint));

    // ---- Restore ----
    R._reset();
    setLib([card('c1', 'Casa Roma', D1, 1000), card('c8', 'Sin puntos', docOf('Z'), 1000)]);
    await applyImportedDoc(later(6), { fileName: 'f.json' });
    await openFromLibrary('c1');
    const target = R.restorePointsOf('c1')[0];
    const cardNow = names(L.libraryEntry('c1').doc);
    const updatedNow = L.libraryEntry('c1').updated;
    ok('Restore puts the point back', (await R.restoreFromPoint('c1', target.id)) === true && names(L.libraryEntry('c1').doc) === 'Router,PC-1'
       && L.libraryEntry('c1').updated > updatedNow, names(L.libraryEntry('c1').doc));
    pts = R.restorePointsOf('c1');
    ok('after keeping the state it replaced as "Before restoring"', pts[0].reason === 'Before restoring' && names(await R.restorePointDoc(pts[0].id)) === cardNow);
    ok('and opens it', state.libraryId === 'c1' && names(serializeDoc()) === 'Router,PC-1');
    await R.restoreFromPoint('c1', pts[0].id);
    ok('restoring that point takes the restore back', names(L.libraryEntry('c1').doc) === cardNow && names(serializeDoc()) === cardNow);

    // ---- Download ----
    downloads.length = 0;
    const snapBefore = JSON.stringify(window.CarinoChanges ? CarinoChanges.snapshotOf('c1') : null);
    await R.downloadRestorePoint('c1', target.id);
    const d = downloads[0];
    ok('Download hands over the point as an identified back-up', !!d && d.payload.kind === 'nettopology' && d.payload.version === 1 && d.payload.name === 'Casa Roma'
       && d.payload.doc.id === 'c1' && d.payload.doc.updated === target.updated && d.payload.doc.v === DOC_VERSION && names(d.payload.doc) === 'Router,PC-1'
       && /^topo_casa-roma_\d{4}-\d{2}-\d{2}\.json$/.test(d.name), d && JSON.stringify(Object.assign({}, d.payload, { doc: '…' })) + ' ' + d.name);
    ok('and does not count as backing up the card', JSON.stringify(window.CarinoChanges ? CarinoChanges.snapshotOf('c1') : null) === snapBefore);
    ok('opened again, it is recognised as an older copy of the card', docIdentity(d.payload.doc).id === 'c1' && d.payload.doc.updated < L.libraryEntry('c1').updated);

    // ---- The landing and the menu ----
    renderDocBar();
    ok('the open kept network with points offers them in the Export menu', !el('restorePointsBtn').classList.contains('hidden'));
    openLanding(false);
    const tool = (id) => [...document.querySelectorAll(`.landing-card[data-id="${id}"] .landing-tool`)].find((b) => b.title === 'Restore points');
    ok('a card with points has Restore points', !!tool('c1'));
    ok('a card without has none', !!document.querySelector('.landing-card[data-id="c8"]') && !tool('c8'));
    tool('c1').click();
    const rows = [...el('restoreList').querySelectorAll('.restore-row')];
    pts = R.restorePointsOf('c1');
    ok('the dialog lists them newest first', !el('restoreDialog').hidden && rows.length === pts.length && rows[0].dataset.id === pts[0].id, `${rows.length} / ${pts.length}`);
    ok('each with its time, reason and devices', rows[0].querySelector('.restore-why').textContent === 'Before restoring'
       && /\d/.test(rows[0].querySelector('.restore-when').textContent) && /devices?/.test(rows[0].querySelector('.restore-n').textContent)
       && el('restoreName').textContent === 'Casa Roma');
    downloads.length = 0;
    rows[0].querySelector('[data-download]').click();
    await until(() => downloads.length === 1);
    ok('its Download button downloads that point', downloads.length === 1 && downloads[0].payload.doc.id === 'c1');
    // Drawn again once the download is done: the rows are read afresh.
    await until(() => !el('restoreList').querySelector('[data-restore]').disabled);
    const rowsNow = [...el('restoreList').querySelectorAll('.restore-row')];
    const lastRow = rowsNow[rowsNow.length - 1];
    const countRows = R.restorePointsOf('c1').length;
    lastRow.querySelector('[data-restore]').click();
    await until(() => el('restoreDialog').hidden && R.restorePointsOf('c1').length === countRows + 1);
    ok('its Restore button restores and closes the dialog', el('restoreDialog').hidden && R.restorePointsOf('c1')[0].reason === 'Before restoring');
    setLocale('es');
    ok('a reason reads in the page language', R.restoreReasonText({ reason: 'Before opening {file}', fileName: 'visita.json' }) === 'Antes de abrir visita.json');
    setLocale('en');
    if (landingIsOpen()) closeLanding();

    // ---- A deleted card takes its points with it ----
    f.writes.length = 0;
    const gone = R.restorePointsOf('c1').map((p) => p.id);
    L.libraryDelete('c1');
    await wait(0);
    ok('deleting a card drops its points', !R.hasRestorePoints('c1') && f.writes.some((w) => gone.every((id) => w.del.includes(id))));
    ok('from the store as well', gone.every((id) => !f.disk.has(id)));

    // ---- A batch past the total cap keeps every point it took ----
    R._reset();
    f = makeDisk(); await R.openRestoreStore(f.adapter);
    flushAutosave(); replaceDocument(EMPTY_DOC, { origin: 'new' });
    setLib([card('cA', 'Alfa', docOf('A1', 'A2', 'A3'), 1000), card('cB', 'Beta', docOf('B1', 'B2', 'B3'), 1000), card('cC', 'Gama', docOf('C1', 'C2', 'C3'), 1000)]);
    const trio = ['cA', 'cB', 'cC'];
    const oneDoc = new Blob([JSON.stringify(L.libraryEntry('cA').doc)]).size;
    R.RESTORE_LIMITS.totalBytes = Math.floor(oneDoc * 1.5);
    asked.length = 0;
    const goTrio = await R.keepRestorePoints(trio, 'Before importing a binder');
    ok('three cards past the total cap: each keeps its point, with no question', goTrio === true && failQuestions().length === 0
       && trio.every((id) => R.restorePointsOf(id).length === 1), trio.map((id) => R.restorePointsOf(id).length).join());
    ok('and each is on disk', trio.every((id) => R.restorePointsOf(id).length && f.disk.has(R.restorePointsOf(id)[0].id)));
    await applyImportedBinder({ kind: L.BINDER_KIND, version: 1, sites: trio.map((id, i) => ({ id, name: id, updated: 5000 + i, doc: docOf(id + '-new') })) });
    await wait(0);
    ok('applyImportedBinder on its own keeps one for each card it replaces too', trio.every((id) => R.restorePointsOf(id).some((p) => p.reason === 'Before merging a binder'
       && names(L.libraryEntry(id).doc) === id + '-new')), trio.map((id) => R.restorePointsOf(id).length).join());
    R.recordRestorePoint('cA', 'Before restoring');
    await wait(0);
    const left = trio.flatMap((id) => R.restorePointsOf(id));
    ok('a point taken after the batch drops the older ones to the cap again', left.reduce((n, p) => n + p.bytes, 0) <= R.RESTORE_LIMITS.totalBytes
       && left.some((p) => p.cardId === 'cA' && p.reason === 'Before restoring') && left.length < 7, `${left.length} points`);
    R.RESTORE_LIMITS.totalBytes = heldLimits.totalBytes;

    // ---- Deleting a card drops its points on disk this tab never heard of ----
    f.disk.set('other-tab', { meta: { id: 'other-tab', cardId: 'cA', at: 7, reason: 'Before restoring', bytes: 5, devices: 1, name: 'Alfa', updated: 1 }, doc: docOf('Z') });
    ok('(another tab wrote a point this one does not list)', !R.restorePointsOf('cA').some((p) => p.id === 'other-tab'));
    L.libraryDelete('cA');
    ok('deleting the card drops it from the disk as well', await until(() => !f.disk.has('other-tab')) && !R.hasRestorePoints('cA'));

    // While the store is still opening: dropped once it has opened.
    let releaseOpen;
    const gate = new Promise((r) => { releaseOpen = r; });
    const slow = makeDisk([{ meta: { id: 'slow-1', cardId: 'cB', at: 9, reason: 'Before restoring', bytes: 5, devices: 1, name: 'Beta', updated: 1 }, doc: docOf('S') }]);
    const slowOpen = slow.adapter.open;
    slow.adapter.open = () => gate.then(slowOpen);
    R._reset();
    ok('(the store is slow to open: the boot stops waiting)', (await R.openRestoreStore(slow.adapter, 10)) === 'tab');
    L.libraryDelete('cB');
    releaseOpen();
    ok('a card deleted while the store opens loses its points on disk once it has opened', await until(() => !slow.disk.has('slow-1')) && !R.hasRestorePoints('cB'));

    // ---- A point taken while the store is slow to open is not a failure ----
    let releaseOpen2;
    const gate2 = new Promise((r) => { releaseOpen2 = r; });
    const slow2 = makeDisk();
    slow2.adapter.open = () => gate2.then(() => []);
    R._reset();
    await R.openRestoreStore(slow2.adapter, 10);
    asked.length = 0;
    const goSlow = R.keepRestorePoints(['cC'], 'Before restoring');
    await wait(40);
    releaseOpen2();
    ok('a point taken while the store is still opening waits for it and asks nothing', (await goSlow) === true && failQuestions().length === 0
       && [...slow2.disk.values()].some((r) => r.meta.cardId === 'cC'), String(failQuestions().length));

    // ---- The dialog: one action at a time, questions above it, errors in it ----
    R._reset();
    f = makeDisk(); await R.openRestoreStore(f.adapter);
    setLib([card('cD', 'Dalia', docOf('D1'), 1000)]);
    await R.keepRestorePoints(['cD'], 'Before restoring');
    setLib([card('cD', 'Dalia', docOf('D1', 'D2'), 2000)]);
    ok('a question is drawn above the Restore points dialog',
       Number(getComputedStyle(el('topoAsk')).zIndex) > Number(getComputedStyle(el('restoreDialog')).zIndex),
       getComputedStyle(el('topoAsk')).zIndex + ' / ' + getComputedStyle(el('restoreDialog')).zIndex);
    R.openRestoreDialog('cD');
    const countD = R.restorePointsOf('cD').length;
    el('restoreList').querySelector('[data-restore]').click();
    const second = el('restoreList').querySelector('[data-restore]');
    ok('while a Restore runs the buttons are disabled', !!second && second.disabled === true && !!el('restoreList').querySelector('[data-download]').disabled);
    if (second) second.click();
    await until(() => el('restoreDialog').hidden);
    await wait(30);
    ok('a double tap restores once: one "Before restoring" point', R.restorePointsOf('cD').length === countD + 1 && names(L.libraryEntry('cD').doc) === 'D1',
       `${R.restorePointsOf('cD').length} / ${countD + 1}`);

    // The restore point of the state it replaces cannot be stored: the
    // question is asked with the dialog shut, not under it.
    f.mode = 'fail'; failAnswer = null; asked.length = 0;
    R.openRestoreDialog('cD');
    const beforeFail = names(L.libraryEntry('cD').doc);
    el('restoreList').querySelectorAll('[data-restore]')[1].click();
    await until(() => failQuestions().length === 1);
    await wait(20);
    ok('a Restore whose point cannot be stored asks with the dialog shut', failQuestions().length === 1 && failQuestions()[0].restoreOpen === false);
    ok('and Cancel leaves the card as it was', names(L.libraryEntry('cD').doc) === beforeFail);
    f.mode = 'ok'; failAnswer = 'continue';

    // A point that cannot be read: said in the dialog, which stays open.
    const heldReadDoc = f.adapter.readDoc;
    f.adapter.readDoc = async () => null;
    R.openRestoreDialog('cD');
    ok('(the error line starts hidden)', el('restoreStatus').classList.contains('hidden'));
    downloads.length = 0;
    // A row whose document is on disk only (the failed point above is still held in the tab).
    const diskRow = [...el('restoreList').querySelectorAll('.restore-row')].find((li) => f.disk.has(li.dataset.id));
    diskRow.querySelector('[data-download]').click();
    await until(() => !el('restoreStatus').classList.contains('hidden'));
    ok('an unreadable point says so inside the open dialog', !el('restoreDialog').hidden && !el('restoreStatus').classList.contains('hidden')
       && el('restoreStatus').textContent === 'That restore point could not be read.' && downloads.length === 0);
    [...el('restoreList').querySelectorAll('.restore-row')].find((li) => f.disk.has(li.dataset.id)).querySelector('[data-restore]').click();
    await wait(30);
    ok('and so does Restore, changing nothing', !el('restoreDialog').hidden && el('restoreStatus').textContent === 'That restore point could not be read.');
    f.adapter.readDoc = heldReadDoc;
    R.closeRestoreDialog();
    R.openRestoreDialog('cD');
    ok('opening the dialog again clears the error line', el('restoreStatus').classList.contains('hidden'));
    R.closeRestoreDialog();

    // ---- Each guarded path, when its point cannot be stored ----
    const DL = () => downloads.map((d) => d.payload.kind);
    // A sheet applied to a kept network.
    flushAutosave(); replaceDocument(EMPTY_DOC, { origin: 'new' });
    setLib([card('cE', 'Eco', docOf('E1'), 1000)]);
    await openFromLibrary('cE');
    f.mode = 'fail'; failAnswer = null; asked.length = 0; downloads.length = 0;
    el('csvMenuBtn').click();
    el('csvTabs').querySelector('[data-csvtab="import"]').click();
    el('csvText').value = 'name,type\nKiosk,pc';
    csvReparse(); renderCsvDialog();
    el('csvReviewBtn').click();
    _csv.fileName = 'hoja.csv';
    el('csvApplyBtn').click();
    await until(() => failQuestions().length === 1);
    await wait(20);
    ok('a sheet: Cancel applies nothing and leaves the dialog open', failQuestions().length === 1 && !state.nodes.some((n) => n.name === 'Kiosk') && !el('csvDialog').hidden);
    failAnswer = 'download';
    el('csvApplyBtn').click();
    await until(() => state.nodes.some((n) => n.name === 'Kiosk'));
    ok('a sheet: Download a back-up first downloads the network and applies', state.nodes.some((n) => n.name === 'Kiosk') && DL().join() === 'nettopology'
       && names(downloads[0].payload.doc) === 'E1' && el('csvDialog').hidden, DL().join());
    flushAutosave();

    // Keep this network over a card.
    const linkE = () => JSON.stringify(Object.assign({ v: DOC_VERSION, id: 'cE', updated: Date.now() + 120000 }, docOf('E1', 'Kiosk', 'Link')));
    const cardE = names(L.libraryEntry('cE').doc);
    openArrivedDocument(linkE());
    answer = 'update'; failAnswer = null; asked.length = 0; downloads.length = 0;
    ok('Keep this network: Cancel keeps nothing', (await keepThisNetwork()) === null && names(L.libraryEntry('cE').doc) === cardE && failQuestions().length === 1);
    openArrivedDocument(linkE());
    failAnswer = 'download';
    ok('Keep this network: Download a back-up first downloads the card and keeps', (await keepThisNetwork()) === 'cE'
       && names(L.libraryEntry('cE').doc) === 'E1,Kiosk,Link' && DL().join() === 'nettopology' && names(downloads[0].payload.doc) === cardE, DL().join());
    flushAutosave(); replaceDocument(EMPTY_DOC, { origin: 'new' });

    // The guest shelf's Keep.
    setLib([card('cF', 'Faro', docOf('F1'), 1000), card('cG', 'Gema', docOf('G1'), 1000)]);
    failAnswer = null; asked.length = 0; downloads.length = 0;
    await keepGuestSites([{ id: 'cF', name: 'Faro', updated: 5000, doc: docOf('F1', 'F2') }]);
    ok('the guest shelf: Cancel keeps nothing', names(L.libraryEntry('cF').doc) === 'F1' && failQuestions().length === 1 && downloads.length === 0);
    failAnswer = 'download';
    await keepGuestSites([{ id: 'cF', name: 'Faro', updated: 5000, doc: docOf('F1', 'F2') }]);
    ok('the guest shelf: Download a back-up first downloads the card and keeps', names(L.libraryEntry('cF').doc) === 'F1,F2' && DL().join() === 'nettopology', DL().join());

    // A binder over several cards: the back-up is a binder of them.
    const two = () => ({ kind: L.BINDER_KIND, version: 1, sites: [
      { id: 'cF', name: 'Faro', updated: 9000, doc: docOf('F1', 'F2', 'F3') }, { id: 'cG', name: 'Gema', updated: 9000, doc: docOf('G1', 'G2') }] });
    failAnswer = null; asked.length = 0; downloads.length = 0;
    ok('a binder over two cards: Cancel stops it', (await applyImportedDoc(two(), { fileName: 'dos.json' })) === false
       && names(L.libraryEntry('cF').doc) === 'F1,F2' && names(L.libraryEntry('cG').doc) === 'G1' && /2 networks/.test(failQuestions()[0].message), failQuestions()[0] && failQuestions()[0].message);
    failAnswer = 'download';
    await applyImportedDoc(two(), { fileName: 'dos.json' });
    const bdl = downloads[0] && downloads[0].payload;
    ok('a binder over two cards: Download downloads one binder of both, then imports', !!bdl && bdl.kind === L.BINDER_KIND && downloads.length === 1
       && bdl.sites.map((x) => x.id).sort().join() === 'cF,cG' && names(bdl.sites.find((x) => x.id === 'cF').doc) === 'F1,F2'
       && names(L.libraryEntry('cF').doc) === 'F1,F2,F3' && names(L.libraryEntry('cG').doc) === 'G1,G2', DL().join());

    // A bound binder file holding a newer copy: binding it, and Back up all.
    {
      const heldPicker2 = window.showSaveFilePicker;
      const heldExport2 = localStorage.getItem(L.BINDER_EXPORT_KEY);
      let mem2 = null;
      const heldStore2 = setHandleStore({ get: () => Promise.resolve(mem2), put: (h) => { mem2 = h; return Promise.resolve(); }, del: () => { mem2 = null; return Promise.resolve(); } });
      const handleOf = (sites) => {
        const h = { name: 'estate.json', written: JSON.stringify({ kind: BK, version: 1, sites }) };
        h.queryPermission = () => Promise.resolve('granted'); h.requestPermission = h.queryPermission;
        h.getFile = () => Promise.resolve({ text: () => Promise.resolve(h.written) });
        h.createWritable = () => Promise.resolve({ write: (x) => { h.written = x; return Promise.resolve(); }, close: () => Promise.resolve(), abort: () => Promise.resolve() });
        return h;
      };
      try {
        setLib([card('cH', 'Hoja', docOf('H1'), 1000)]);
        const picked = handleOf([{ id: 'cH', name: 'Hoja', created: 1, updated: 9000, doc: docOf('H1', 'H2') }]);
        const pickedThen = picked.written;
        window.showSaveFilePicker = () => Promise.resolve(picked);
        failAnswer = null; asked.length = 0;
        await exportBinder();
        ok('binding a file: Cancel stops, the card and the file as they were', failQuestions().length === 1 && names(L.libraryEntry('cH').doc) === 'H1'
           && picked.written === pickedThen && !(await binderHandle()));
        failAnswer = 'download'; asked.length = 0; downloads.length = 0;
        await exportBinder();
        ok('binding a file: Download a back-up first downloads the card, then merges and binds', failQuestions().length === 1 && names(L.libraryEntry('cH').doc) === 'H1,H2'
           && downloads.length >= 1 && downloads[0].payload.kind === 'nettopology' && names(downloads[0].payload.doc) === 'H1' && !!(await binderHandle()), DL().join());
        picked.written = JSON.stringify({ kind: BK, version: 1, sites: [{ id: 'cH', name: 'Hoja', created: 1, updated: Date.now() + 600000, doc: docOf('H1', 'H2', 'H3') }] });
        const fileThen = picked.written;
        failAnswer = null; asked.length = 0;
        await exportBinder();
        ok('Back up all reading a newer copy: Cancel stops the back-up, the file untouched', failQuestions().length === 1 && names(L.libraryEntry('cH').doc) === 'H1,H2' && picked.written === fileThen);
      } finally {
        window.showSaveFilePicker = heldPicker2;
        await clearBinderHandle();
        setHandleStore(heldStore2);
        if (heldExport2 === null) localStorage.removeItem(L.BINDER_EXPORT_KEY); else localStorage.setItem(L.BINDER_EXPORT_KEY, heldExport2);
      }
    }
    f.mode = 'ok'; failAnswer = 'continue';
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack);
  } finally {
    Object.assign(R.RESTORE_LIMITS, heldLimits);
    R.releaseRestoreStore(); R._reset();
    window.downloadJson = heldDownload;
    setDialogResponder(heldResponder);
    TopoMergeDoors.setMergeSummaryResponder(heldSummary);
    L.persistLibrary(heldLib);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
