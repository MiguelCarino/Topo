// The doors into a merge (docs/SCOPE.md section 3, step 2, stage 5;
// js/mergedoors.js, js/library.js, js/app.js):
//   A. Open a file whose network is not here: "Open as its own network"
//      (main) or "Merge into a network…" (a pick of the networks, most
//      recent first, with organization and site; never a template); merged
//      as one undo step, a restore point "Before merging {file}", a log entry
//      naming the file, the copy kept under its rev. No networks: no question;
//   B. Open a file whose network IS here: Merge first, three-way against the
//      copy that left (both sides' edits survive), two-way when no copy both
//      started from is held; your own copy as it left is never merged ("yours
//      already has everything"), until the merge it came from is undone;
//      Replace with this copy keeps its restore point; the next copy names
//      the merged rev as its base;
//   C. Keep this network (a link) over a card: the same Merge;
//   D. the landing card's ⇄ Merge…: on network cards only; a file into this
//      network, or this network into another (the pick leaves itself out);
//   E. binders: a clean three-way site merged on its own (restore point and
//      log entry), the rest in one summary (Review…, Replace with theirs, Keep
//      as a copy, Skip), new networks added, identical ones up to date; one
//      toast; Cancel does nothing; the bound file at Back up all: your own
//      copies up to date, an edit made in the file merged, a conflict asked
//      (Skip writes yours, D5), Cancel cancels the back-up; the link shelf:
//      a skipped site stays on the shelf;
//   F. the base: prior, a hand-edited copy of your own rev, a pre-v17 copy
//      against your last back-up (never merged unasked);
//   G. no newer-wins left in the code; a newer Topo's file is never merged;
//   H. every new string in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const RV = window.CarinoRevisions;
  const R = window.CarinoRestore;
  const C = window.CarinoChanges;
  const TM = window.TopoMerge;
  const MD = window.TopoMergeDoors;
  const MU = window.TopoMergeUI;

  const heldDigest = TM.setDigest(async (text) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0').repeat(8);
  });
  const heldLib = loadLibrary();
  const heldDownload = window.downloadJson;
  const downloads = [];
  window.downloadJson = (payload, name) => { downloads.push({ payload: clone(payload), name }); };
  const heldToast = window.showToast;
  const toasts = [];
  window.showToast = (m, kind) => { toasts.push({ m, kind }); };

  // The questions: `choose` (an id, or a function of the request), `pickId`
  // for the network picker; every request kept.
  let choose = null, pickId = null;
  const asked = [];
  const heldResponder = setDialogResponder((req) => {
    asked.push(req);
    if (req.kind === 'choice') return typeof choose === 'function' ? choose(req) : choose;
    if (req.kind === 'pick') return pickId;
    if (req.kind === 'confirm') return true;
    return undefined;
  });
  const lastChoice = () => asked.filter((q) => q.kind === 'choice').pop() || null;
  const lastPick = () => asked.filter((q) => q.kind === 'pick').pop() || null;
  // The review: `reviewAnswer` (choices, or null for Cancel).
  let reviewAnswer = {};
  const reviews = [];
  const heldMerge = MU.setMergeResponder((req) => { reviews.push(req); return typeof reviewAnswer === 'function' ? reviewAnswer(req) : reviewAnswer; });
  // The binder summary: `rowAnswer(row)` per row, or `summaryCancel`.
  let rowAnswer = () => 'skip', summaryCancel = false;
  const summaries = [];
  const heldSummary = MD.setMergeSummaryResponder((req) => {
    summaries.push(clone(req));
    if (summaryCancel) return null;
    const o = {};
    req.rows.forEach((r) => { o[r.id] = rowAnswer(r); });
    return o;
  });

  const restoreAdapter = {
    open: async () => [],
    readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = []; }); return o; },
    readDoc: async () => null,
    write: () => Promise.resolve(true)
  };
  const revDisk = new Map();
  const revAdapter = {
    open: async () => [],
    readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = [...revDisk.values()].filter((r) => r.meta.cardId === id).map((r) => clone(r.meta)); }); return o; },
    readDoc: async (id) => (revDisk.has(id) ? clone(revDisk.get(id).doc) : null),
    write: (ops) => { ops.put.forEach((p) => revDisk.set(p.meta.id, { meta: clone(p.meta), doc: clone(p.doc) })); ops.del.forEach((id) => revDisk.delete(id)); return Promise.resolve(true); },
    dropCard: async () => true
  };

  const nic = (id, ip) => ({ id, name: 'eth0', ip });
  const dev = (id, name, o = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [] }, o);
  const D = (o = {}) => Object.assign({ v: DOC_VERSION, nodes: [], links: [] }, o);
  const card = (id, name, doc, extra = {}) => Object.assign({ id, name, doc: clone(doc), created: 1, updated: 1000 }, extra);
  const putCards = (...cards) => { const lib = {}; cards.forEach((c) => { lib[c.id] = c; }); persistLibrary(lib); };
  const names = (doc) => ((doc && doc.nodes) || []).map((n) => n.name).sort().join(',');
  const fileOf = (doc) => ({ kind: 'nettopology', version: 1, doc: clone(doc) });
  const lastLog = (id) => { const log = (libraryEntry(id) || { doc: {} }).doc.log || []; return log[log.length - 1] || null; };
  const binderOf = (sites) => ({ kind: BINDER_KIND, version: 1, sites });
  const cardsUsed = ['t1', 't2', 'tp', 'tn', 'k1', 'k2', 'k3', 'b1', 'b2', 'b3', 'b4', 'b9', 'f1', 'f2', 'f3', 'f4', 'sh1'];
  const reset = () => { asked.length = 0; reviews.length = 0; summaries.length = 0; toasts.length = 0; downloads.length = 0; reviewAnswer = {}; summaryCancel = false; };

  try {
    ok('the doors are loaded', !!MD && typeof binderMergeSites === 'function' && typeof mergeContext === 'function');
    R._reset(); await R.openRestoreStore(restoreAdapter);
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(revAdapter);
    cardsUsed.forEach((id) => C.dropSnapshot(id));

    // ---- A. A file whose network is not here ----
    const casa = D({ nodes: [dev('a', 'Router', { interfaces: [nic('i1', '10.0.0.1/24')] })], report: { client: 'Acme', site: 'Roma' } });
    const freshCards = () => putCards(card('t1', 'Casa Roma', casa, { updated: Date.now() - 1000 }), card('t2', 'Bodega', D({ nodes: [dev('z', 'Core', { x: 400 })] }), { updated: Date.now() - 5000 }),
      card('tp', 'Plantilla', D({ nodes: [dev('q', 'X')] }), { template: true, updated: Date.now() }));
    freshCards();
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    const tech = fileOf(D({ id: 'techSess1', updated: Date.now() - 500, rev: 'techR1', nodes: [dev('t9', 'Printer', { interfaces: [nic('i1', '10.0.0.20/24')] })] }));
    reset(); choose = 'merge'; pickId = 't1';
    let took = await applyImportedDoc(clone(tech), { fileName: 'closet-2F.json' });
    let q = asked.find((r) => r.kind === 'choice');
    ok('A1 a file not here asks: Merge into a network…, or Open as its own network (the main answer)', !!q && q.choices.map((c) => c.id).join() === 'merge,open'
       && q.choices.find((c) => c.id === 'open').primary === true && q.choices[0].label === 'Merge into a network…', q && JSON.stringify(q.choices));
    let p = lastPick();
    ok('A2 the pick: networks only, most recent first, with organization and site', !!p && p.rows.map((r) => r.id).join() === 't1,t2'
       && /^Acme · Roma · /.test(p.rows[0].detail) && p.rows[0].label === 'Casa Roma', p && JSON.stringify(p.rows));
    ok('A3 reviewed two-way, named by the file', reviews.length === 1 && reviews[0].plan.mode === 'two-way' && reviews[0].sourceText === 'closet-2F.json' && reviews[0].targetId === 't1');
    ok('A4 merged into the picked network, which opens', took === true && state.libraryId === 't1' && names(serializeDoc()) === 'Printer,Router' && names(libraryEntry('t1').doc) === 'Printer,Router');
    ok('A5 no card of its own', !libraryEntry('techSess1'));
    let pts = R.restorePointsOf('t1');
    ok('A6 a restore point first, named by the file', pts.length === 1 && R.restoreReasonText(pts[0]) === 'Before merging closet-2F.json', pts.length && R.restoreReasonText(pts[0]));
    let e = lastLog('t1');
    ok('A7 a log entry: the file, two-way, its rev', !!e && e.source === 'closet-2F.json' && e.mode === 'two-way' && e.rev === 'techR1', JSON.stringify(e));
    ok('A8 the copy kept under its rev (merge-theirs)', RV.revisionsOf('t1').some((m) => m.rev === 'techR1' && m.why === 'merge-theirs'));
    undo(); flushAutosave();
    ok('A9 one undo step takes the merge back, its log entry too', names(serializeDoc()) === 'Router' && !(libraryEntry('t1').doc.log || []).length);
    // The same file again: the undone merge is not "already merged".
    reset(); choose = 'open';
    took = await applyImportedDoc(clone(tech), { fileName: 'closet-2F.json' });
    ok('A10 Open as its own network keeps it as a card under its id', took === true && !!libraryEntry('techSess1') && state.libraryId === 'techSess1');
    libraryDelete('techSess1');
    freshCards(); replaceDocument(EMPTY_DOC, { origin: 'new' });
    reset(); choose = 'merge'; pickId = null;
    ok('A11 cancelling the pick opens nothing', (await applyImportedDoc(clone(tech), { fileName: 'closet-2F.json' })) === false && !libraryEntry('techSess1')
       && names(libraryEntry('t1').doc) === 'Router' && !reviews.length);
    reset(); choose = 'merge'; pickId = 't1'; reviewAnswer = null;
    ok('A12 cancelling the review changes nothing', (await applyImportedDoc(clone(tech), { fileName: 'closet-2F.json' })) === false
       && names(libraryEntry('t1').doc) === 'Router' && R.restorePointsOf('t1').length === 1);
    putCards(card('tp', 'Plantilla', D({ nodes: [dev('q', 'X')] }), { template: true }));
    reset(); choose = null;
    took = await applyImportedDoc(clone(tech), { fileName: 'closet-2F.json' });
    ok('A13 with no network to merge into, nothing is asked: it opens as its own', took === true && !asked.some((r) => r.kind === 'choice') && state.libraryId === 'techSess1');
    libraryDelete('techSess1');
    putCards(card('t1', 'Casa Roma', casa), card('tn', 'Futuro', { v: DOC_VERSION + 1, nodes: [dev('f', 'Future')], links: [] }, { updated: Date.now() }));
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    reset(); choose = 'merge'; pickId = null;
    await applyImportedDoc(clone(tech), { fileName: 'closet-2F.json' });
    p = lastPick();
    ok('A14 a network from a newer Topo is never offered to merge into', !MD.mergeTargets().some((x) => x.id === 'tn') && MD.mergeTargets().some((x) => x.id === 't1')
       && !!p && p.rows.map((r) => r.id).join() === 't1', p && JSON.stringify(p.rows));
    libraryDelete('tn');

    // ---- B. A file whose network IS here ----
    putCards(card('k1', 'Clínica', D({ nodes: [dev('a', 'Router', { interfaces: [nic('i1', '10.0.0.1/24')] }), dev('b', 'PC-1', { x: 160, interfaces: [nic('i1', '10.0.0.11/24')] })] })));
    await openFromLibrary('k1');
    downloads.length = 0; exportJsonFile();
    const sent = downloads[0].payload;
    ok('B1 the back-up carries a rev', !!sent.doc.rev);
    batch(() => { getNode('a').notes = 'mine note'; save(); }); flushAutosave();
    const back = clone(sent);
    back.doc.nodes.find((n) => n.id === 'b').name = 'PC-1 (tech)';
    back.doc.base = sent.doc.rev; back.doc.rev = 'techR2'; back.doc.prior = [];
    reset(); choose = 'merge';
    took = await applyImportedDoc(clone(back), { fileName: 'clinica.json' });
    q = lastChoice();
    ok('B2 Merge is the main answer, three-way said in words', !!q && q.choices[0].id === 'merge' && q.choices[0].primary === true
       && q.choices.some((c) => c.id === 'update' && c.label === 'Replace with this copy') && q.choices.some((c) => c.id === 'mine') && q.choices.some((c) => c.id === 'copy')
       && /It was taken from yours, so edits made on both sides are kept\./.test(q.message), q && q.message);
    ok('B3 the review is three-way with nothing to decide', reviews.length === 1 && reviews[0].plan.mode === 'three-way' && reviews[0].plan.counts.conflicts === 0);
    const k1 = libraryEntry('k1').doc;
    ok('B4 both sides\' edits survive', took === true && k1.nodes.find((n) => n.id === 'a').notes === 'mine note' && k1.nodes.find((n) => n.id === 'b').name === 'PC-1 (tech)');
    e = lastLog('k1');
    ok('B5 logged three-way with the rev merged in', !!e && e.mode === 'three-way' && e.rev === 'techR2' && e.source === 'clinica.json', JSON.stringify(e));
    downloads.length = 0; exportJsonFile();
    ok('B6 the next copy names the merged rev as its base', downloads[0].payload.doc.base === 'techR2', downloads[0].payload.doc.base);
    // The merged copy again: already in yours.
    reset(); choose = 'mine';
    await applyImportedDoc(clone(back), { fileName: 'clinica.json' });
    q = lastChoice();
    ok('B7 the copy just merged comes back: yours already has everything, no Merge, Open mine first', !!q && /yours already has everything in this copy/.test(q.message)
       && !q.choices.some((c) => c.id === 'merge') && q.choices.find((c) => c.primary).id === 'mine', q && q.message);
    // Your own back-up as it left.
    reset(); choose = 'mine';
    await applyImportedDoc(clone(sent), { fileName: 'clinica-old.json' });
    q = lastChoice();
    ok('B8 your own back-up as it left is never merged', !!q && /yours already has everything/.test(q.message) && !reviews.length, q && q.message);
    // Undo the merge: the copy is new to this network again.
    await openFromLibrary('k1');
    batch(() => { getNode('a').notes = 'second'; save(); });
    // The technician's next copy, continued from the one merged (its base).
    const back2 = clone(back); back2.doc.base = 'techR2'; back2.doc.rev = 'techR3'; back2.doc.nodes.find((n) => n.id === 'b').name = 'PC-1 (tech 2)';
    reset(); choose = 'merge';
    await applyImportedDoc(clone(back2), { fileName: 'clinica2.json' });
    ok('B9 a second copy merges', libraryEntry('k1').doc.nodes.find((n) => n.id === 'b').name === 'PC-1 (tech 2)' && lastLog('k1').rev === 'techR3');
    undo(); flushAutosave();
    reset(); choose = null;
    await applyImportedDoc(clone(back2), { fileName: 'clinica2.json' });
    q = lastChoice();
    ok('B10 undone, that copy is offered as a merge again (A1, A2)', !!q && q.choices[0].id === 'merge', q && q.message);
    // Two-way: no copy both started from.
    putCards(card('k2', 'Sin base', D({ nodes: [dev('a', 'Router')] })));
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    reset(); choose = 'merge';
    await applyImportedDoc(fileOf(D({ id: 'k2', updated: 5000, nodes: [dev('a', 'Router', { notes: 'theirs' }), dev('c', 'NAS', { x: 200 })] })), { fileName: 'sinbase.json' });
    q = lastChoice();
    ok('B11 no common copy: Merge still first, two-way said in words', !!q && q.choices[0].id === 'merge'
       && /No copy both started from was found: merging keeps everything of yours and asks where the two differ\./.test(q.message), q && q.message);
    ok('B12 merged two-way: theirs added, a blank of yours filled', names(libraryEntry('k2').doc) === 'NAS,Router' && lastLog('k2').mode === 'two-way'
       && libraryEntry('k2').doc.nodes.find((n) => n.id === 'a').notes === 'theirs');
    // Replace with this copy: the old Update, with its restore point.
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    reset(); choose = 'update';
    await applyImportedDoc(fileOf(D({ id: 'k2', updated: 6000, nodes: [dev('x', 'Only')] })), { fileName: 'replace.json' });
    pts = R.restorePointsOf('k2');
    ok('B13 Replace with this copy replaces, after a restore point', names(libraryEntry('k2').doc) === 'Only' && R.restoreReasonText(pts[0]) === 'Before opening replace.json',
       pts.length && R.restoreReasonText(pts[0]));

    // ---- C. Keep this network over a card ----
    putCards(card('k3', 'Enlace', D({ nodes: [dev('a', 'Router')] })));
    await openFromLibrary('k3');
    const linkDoc = identifiedDoc(serializeDoc(), 'link');
    const sentRev = linkDoc.rev;
    linkDoc.nodes.push(dev('w', 'Wi-Fi AP', { x: 200 }));
    linkDoc.base = sentRev; linkDoc.rev = 'linkR1';
    openArrivedDocument(JSON.stringify(linkDoc));
    ok('C1 the link opens unkept, under the card\'s id', state.libraryId === null && state.docId === 'k3');
    // The visitor edits the canvas before keeping it: the edit is merged,
    // but it is no part of what linkR1 held.
    batch(() => { getNode('a').notes = 'visitor edit'; save(); });
    reset(); choose = 'merge';
    const keptId = await keepThisNetwork();
    q = lastChoice();
    ok('C2 Keep asks the same question, Keep as a copy among it', !!q && q.choices[0].id === 'merge' && q.choices.some((c) => c.id === 'copy' && c.label === 'Keep as a copy'));
    ok('C3 merged three-way into the card, which opens', keptId === 'k3' && state.libraryId === 'k3' && names(libraryEntry('k3').doc) === 'Router,Wi-Fi AP'
       && lastLog('k3').source === 'link' && lastLog('k3').mode === 'three-way');
    pts = R.restorePointsOf('k3');
    ok('C4 its restore point says a link', pts.length === 1 && R.restoreReasonText(pts[0]) === 'Before merging a link', pts.length && R.restoreReasonText(pts[0]));
    const heldR1 = await RV.revisionDoc('k3', 'linkR1');
    ok('C5 the visitor\'s edit is merged, but linkR1 holds the link as it arrived (never the edited canvas)', libraryEntry('k3').doc.nodes.find((n) => n.id === 'a').notes === 'visitor edit'
       && !!heldR1 && !heldR1.nodes.some((n) => n.notes === 'visitor edit') && heldR1.nodes.some((n) => n.name === 'Wi-Fi AP')
       && RV.revisionsOf('k3').some((m) => m.rev === 'linkR1' && m.why === 'merge-theirs'), JSON.stringify(heldR1 && heldR1.nodes));

    // ---- D. The landing card's Merge… ----
    freshCards();
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    openLanding(false);
    const toolOf = (id) => [...document.querySelectorAll(`.landing-card[data-id="${id}"] .landing-tool`)].find((b) => b.title === 'Merge…');
    ok('D1 a network card has the ⇄ Merge… tool; a template has none', !!toolOf('t2') && toolOf('t2').textContent === '⇄' && !toolOf('tp'));
    reset(); choose = 'into'; pickId = 't1';
    await openCardMerge('t2');
    q = lastChoice(); p = lastPick();
    ok('D2 two answers: a file into this network, or this network into another', !!q && q.choices.map((c) => c.id).join() === 'file,into', q && JSON.stringify(q.choices));
    ok('D3 the pick leaves the card itself out', !!p && p.rows.map((r) => r.id).join() === 't1', p && JSON.stringify(p.rows));
    ok('D4 merged into the other network, named by the card', names(libraryEntry('t1').doc) === 'Core,Router' && lastLog('t1').source === 'Bodega'
       && R.restoreReasonText(R.restorePointsOf('t1')[0]) === 'Before merging Bodega', R.restorePointsOf('t1').length && R.restoreReasonText(R.restorePointsOf('t1')[0]));
    ok('D5 the card merged from stays as it was, and left with a rev', names(libraryEntry('t2').doc) === 'Core' && !!lastLog('t1').rev && RV.hasRevision('t2', lastLog('t1').rev));
    ok('D6 and the landing stepped aside for the network merged into', !landingIsOpen() && state.libraryId === 't1');
    const input = document.getElementById('mergeFileInput');
    const heldClick = input.click;
    let clicked = 0;
    input.click = () => { clicked++; };
    reset(); choose = 'file';
    await openCardMerge('t2');
    input.click = heldClick;
    ok('D7 "A file into this network…" opens the picker for that network', clicked === 1 && input.dataset.target === 't2');
    reset();
    await mergeFileIntoCard('t2', clone(tech), 'closet-2F.json');
    ok('D8 the file picked is merged into it', names(libraryEntry('t2').doc) === 'Core,Printer' && lastLog('t2').source === 'closet-2F.json');
    reset();
    ok('D9 a binder picked there is refused with a word', (await mergeFileIntoCard('t2', binderOf([]), 'b.json')) === null && toasts.some((x) => /binder of several networks/.test(x.m)));

    // ---- E. Binders ----
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    putCards(card('b1', 'Uno', D({ nodes: [dev('a', 'Router')] })), card('b2', 'Dos', D({ nodes: [dev('a', 'Switch')] })),
      card('b3', 'Tres', D({ nodes: [dev('a', 'AP')] })), card('b4', 'Cuatro', D({ nodes: [dev('a', 'Cam')] })));
    const s1 = stampCard('b1', 'binder'), s2 = stampCard('b2', 'binder');
    // b2 edited here since it left.
    { const lib = loadLibrary(); lib.b2.doc.nodes[0].name = 'Switch (mine)'; lib.b2.updated += 10; persistLibrary(lib); }
    const estate = () => binderOf([
      { id: 'b1', name: 'Uno', updated: 5000, rev: 'bx1', base: s1.rev, doc: D({ nodes: [dev('a', 'Router'), dev('n', 'NAS', { x: 200 })] }) },
      { id: 'b2', name: 'Dos', updated: 5000, rev: 'bx2', base: s2.rev, doc: D({ nodes: [dev('a', 'Switch (theirs)')] }) },
      { id: 'b3', name: 'Tres', updated: 5000, doc: D({ nodes: [dev('a', 'AP'), dev('k', 'Kiosk', { x: 200 })] }) },
      { id: 'b4', name: 'Cuatro', updated: 5000, doc: D({ nodes: [dev('a', 'Cam')] }) },
      { id: 'b9', name: 'Nueve', updated: 5000, doc: D({ nodes: [dev('a', 'New')] }) }]);
    reset(); summaryCancel = true;
    took = await applyImportedDoc(estate(), { fileName: 'estate.json' });
    ok('E1 Cancel in the summary does nothing at all', took === false && names(libraryEntry('b1').doc) === 'Router' && !libraryEntry('b9') && !R.hasRestorePoints('b1'));
    reset(); rowAnswer = (r) => (r.id === 'b2' ? 'review' : r.id === 'b3' ? 'copy' : 'skip');
    reviewAnswer = (req) => { const o = {}; req.plan.items.forEach((it) => (it.fields || []).forEach((f) => { if (f.conflict) o[`${it.key}#${f.field}`] = 'theirs'; })); return o; };
    took = await applyImportedDoc(estate(), { fileName: 'estate.json' });
    const sm = summaries[0];
    ok('E2 one summary: the conflict and the copy with no base; the clean merge listed above', summaries.length >= 1 && sm.rows.map((r) => r.id).join() === 'b2,b3'
       && sm.rows[0].reason === '1 conflict' && sm.rows[1].reason === 'No copy both started from was found' && sm.auto.join() === 'Uno' && sm.rows.every((r) => r.canReview),
       JSON.stringify(sm && [sm.rows, sm.auto]));
    ok('E3 the clean three-way site is merged on its own: restore point, log entry', names(libraryEntry('b1').doc) === 'NAS,Router' && lastLog('b1').mode === 'three-way'
       && lastLog('b1').source === 'estate.json' && R.restoreReasonText(R.restorePointsOf('b1')[0]) === 'Before merging estate.json');
    ok('E4 Review… opens the review for that site, and its answer is written', reviews.length === 1 && reviews[0].targetId === 'b2'
       && names(libraryEntry('b2').doc) === 'Switch (theirs)' && lastLog('b2').rev === 'bx2');
    const tresCopy = libraryEntries().find((x) => x.name === 'Tres (copy)');
    ok('E5 Keep as a copy keeps yours and adds theirs as a card', names(libraryEntry('b3').doc) === 'AP' && !!tresCopy && names(tresCopy.doc) === 'AP,Kiosk' && !R.hasRestorePoints('b3'));
    ok('E6 the network not here is added; the identical one is up to date', !!libraryEntry('b9') && names(libraryEntry('b4').doc) === 'Cam' && !R.hasRestorePoints('b4'));
    ok('E7 one toast says it all', toasts.some((x) => x.m === 'Binder loaded: 2 added, 2 merged, 1 already up to date.'), JSON.stringify(toasts));
    ok('E8 the open canvas was left alone', state.libraryId === null && !state.nodes.length);
    // The same binder again: the merged ones are in yours now.
    reset(); rowAnswer = () => 'skip';
    await applyImportedDoc(estate(), { fileName: 'estate.json' });
    ok('E9 the same binder again: nothing merged twice', !reviews.length && (lastLog('b1') || {}).rev === 'bx1' && (libraryEntry('b1').doc.log || []).length === 1
       && (summaries[0] ? !summaries[0].rows.some((r) => r.id === 'b1' || r.id === 'b2') : true), JSON.stringify(summaries.map((s) => s.rows)));
    // A binder site from a newer Topo: asked about, never planned.
    reset(); rowAnswer = () => 'skip';
    await applyImportedBinder(binderOf([{ id: 'b4', name: 'Cuatro', updated: 9000, doc: { v: DOC_VERSION + 1, nodes: [dev('a', 'Future')], links: [] } }]));
    ok('E10 a site from a newer Topo is a summary row, not a merge', summaries.length === 1 && summaries[0].rows[0].reason === 'Made by a newer version of Topo'
       && summaries[0].rows[0].canReview === false && names(libraryEntry('b4').doc) === 'Cam');
    // The link shelf: Skip leaves it on the shelf.
    putCards(card('sh1', 'Faro', D({ nodes: [dev('a', 'F1')] })));
    setGuestBinder({ sites: [{ id: 'sh1', name: 'Faro', updated: 9000, doc: D({ nodes: [dev('a', 'F1'), dev('b', 'F2', { x: 100 })] }) }] });
    reset(); rowAnswer = () => 'skip';
    await keepGuestSites(guestSites());
    ok('E11 the shelf: a skipped site stays on the shelf, yours as it was', guestSites().length === 1 && names(libraryEntry('sh1').doc) === 'F1' && summaries.length === 1);
    reset(); rowAnswer = () => 'replace';
    await keepGuestSites(guestSites());
    ok('E12 Replace with theirs takes it and empties the shelf, after a "Before merging a link" point', guestSites().length === 0 && names(libraryEntry('sh1').doc) === 'F1,F2'
       && R.restoreReasonText(R.restorePointsOf('sh1')[0]) === 'Before merging a link');
    setGuestBinder(null);

    // The bound binder file at Back up all.
    {
      const heldPicker = window.showSaveFilePicker;
      const heldExport = localStorage.getItem(BINDER_EXPORT_KEY);
      let mem = null;
      const heldStore = setHandleStore({ get: () => Promise.resolve(mem), put: (h) => { mem = h; return Promise.resolve(); }, del: () => { mem = null; return Promise.resolve(); } });
      const h = { name: 'estate.json', written: '' };
      h.queryPermission = () => Promise.resolve('granted'); h.requestPermission = h.queryPermission;
      h.getFile = () => Promise.resolve({ text: () => Promise.resolve(h.written) });
      h.createWritable = () => Promise.resolve({ write: (x) => { h.written = x; return Promise.resolve(); }, close: () => Promise.resolve(), abort: () => Promise.resolve() });
      const siteIn = (id) => JSON.parse(h.written).sites.find((x) => x.id === id);
      try {
        putCards(card('f1', 'Campo', D({ nodes: [dev('a', 'Router')] })), card('f2', 'Lago', D({ nodes: [dev('a', 'Switch')] })));
        window.showSaveFilePicker = () => Promise.resolve(h);
        reset();
        await exportBinder();
        ok('E13 bound: the file holds both, with their revs', !!siteIn('f1') && !!siteIn('f1').rev && !!siteIn('f2').rev);
        { const lib = loadLibrary(); lib.f1.doc.nodes[0].name = 'Router (edited here)'; lib.f1.updated += 10; persistLibrary(lib); }
        reset();
        await exportBinder();
        ok('E14 Back up all over your own older copies asks nothing and writes yours', !summaries.length && !reviews.length
           && names(siteIn('f1').doc) === 'Router (edited here)', names(siteIn('f1').doc));
        // An edit made in the file (another machine, the same rev): merged on its own.
        const onDisk = JSON.parse(h.written);
        onDisk.sites.find((x) => x.id === 'f2').doc.nodes.push(dev('m', 'From machine B', { x: 300 }));
        h.written = JSON.stringify(onDisk);
        reset();
        await exportBinder();
        ok('E15 an edit made in the file is merged on its own before the write', !summaries.length && names(libraryEntry('f2').doc) === 'From machine B,Switch'
           && names(siteIn('f2').doc) === 'From machine B,Switch' && lastLog('f2').mode === 'three-way');
        ok('E15b and a toast says the back-up merged it', toasts.some((x) => x.m === 'Binder loaded: 0 added, 1 merged, 1 already up to date.'), JSON.stringify(toasts));
        // A conflict: asked; Skip writes yours over the file's copy (D5).
        const disk2 = JSON.parse(h.written);
        disk2.sites.find((x) => x.id === 'f1').doc.nodes[0].name = 'Router (machine B)';
        h.written = JSON.stringify(disk2);
        { const lib = loadLibrary(); lib.f1.doc.nodes[0].name = 'Router (here again)'; lib.f1.updated += 10; persistLibrary(lib); }
        const before = h.written;
        reset(); summaryCancel = true;
        await exportBinder();
        ok('E16 a conflict in the file is asked about as a back-up; Cancel cancels the back-up', summaries.length === 1 && summaries[0].backup === true
           && h.written === before && names(libraryEntry('f1').doc) === 'Router (here again)');
        reset(); rowAnswer = () => 'skip';
        await exportBinder();
        ok('E17 Skip: yours is written over the file\'s copy', names(siteIn('f1').doc) === 'Router (here again)' && names(libraryEntry('f1').doc) === 'Router (here again)');
        // Binding for the first time over a file with a conflict: Cancel
        // cancels the back-up (no download, nothing bound).
        const disk3 = JSON.parse(h.written);
        disk3.sites.find((x) => x.id === 'f1').doc.nodes[0].name = 'Router (machine C)';
        h.written = JSON.stringify(disk3);
        { const lib = loadLibrary(); lib.f1.doc.nodes[0].name = 'Router (here 3)'; lib.f1.updated += 10; persistLibrary(lib); }
        await clearBinderHandle();
        const before3 = h.written;
        reset(); summaryCancel = true;
        await exportBinder();
        ok('E18 first binding, Cancel in the summary: the back-up is cancelled, no download, nothing bound', summaries.length === 1 && !downloads.length && mem === null
           && h.written === before3 && toasts.some((x) => x.m === 'Back-up cancelled.'), JSON.stringify([summaries.length, downloads.length, !!mem, toasts]));
      } finally {
        window.showSaveFilePicker = heldPicker;
        await clearBinderHandle();
        setHandleStore(heldStore);
        if (heldExport === null) localStorage.removeItem(BINDER_EXPORT_KEY); else localStorage.setItem(BINDER_EXPORT_KEY, heldExport);
      }
    }

    // ---- F. The base ----
    putCards(card('f3', 'Base', D({ nodes: [dev('a', 'Router')] })));
    const own = stampCard('f3', 'export');
    let ctx = await mergeContext('f3', D({ nodes: [dev('a', 'Router'), dev('b', 'X', { x: 100 })] }), { rev: 'otherR', base: null, prior: ['nope', own.rev] });
    ok('F1 a copy\'s prior names the base held here', !ctx.ancestor && ctx.baseRev === own.rev && ctx.via === 'rev', JSON.stringify([ctx.baseRev, ctx.via]));
    ctx = await mergeContext('f3', D({ nodes: [dev('a', 'Router (hand edit)')] }), { rev: own.rev, base: null, prior: [] });
    ok('F2 your own rev, edited by hand since: that rev is its base, not "yours has everything"', !ctx.ancestor && ctx.baseRev === own.rev);
    ctx = await mergeContext('f3', D({ nodes: [dev('a', 'Router')] }), { rev: own.rev, base: null, prior: [] });
    ok('F3 your own rev, unchanged: yours has everything', ctx.ancestor === true);
    C.takeSnapshot('f3', 'backup', D({ nodes: [dev('a', 'Router')] }));
    { const lib = loadLibrary(); lib.f3.doc.nodes.push(dev('c', 'Mine since', { x: 300 })); lib.f3.rev = null; lib.f3.revHash = null; persistLibrary(lib); }
    RV.dropRevisions('f3');
    const old = D({ nodes: [dev('a', 'Router (old build)')] });
    ctx = await mergeContext('f3', old, { id: 'f3', updated: Date.now() + 60000, rev: null, base: null, prior: [] });
    ok('F4 a copy from before revisions, edited after your back-up, is compared with that back-up', ctx.via === 'snapshot' && !!ctx.base && names(ctx.base) === 'Router');
    reset(); rowAnswer = () => 'skip';
    await applyImportedBinder(binderOf([{ id: 'f3', name: 'Base', updated: Date.now() + 60000, doc: old }]));
    ok('F5 and at a binder door it is never merged unasked', summaries.length === 1 && summaries[0].rows[0].reason === 'Compared with your last back-up'
       && names(libraryEntry('f3').doc) === 'Mine since,Router');
    ctx = await mergeContext('f3', old, { id: 'f3', updated: 5, rev: null, base: null, prior: [] });
    ok('F6 one older than the back-up is not: two-way', !ctx.base && !ctx.ancestor);
    C.dropSnapshot('f3');
    // A cross-merge: R0 left from here, M1 came back and was merged in; the
    // other machine's next copy names R0 as prior and M1 as base. The base is
    // M1 (held here last), not R0: a delete made here since stays deleted.
    {
      const r0doc = D({ nodes: [dev('a', 'Router', { notes: 'a' })] });
      putCards(card('f4', 'Cruce', r0doc));
      const r0 = stampCard('f4', 'export');
      const m1doc = D({ nodes: [dev('a', 'Router', { notes: 'b' }), dev('e', 'Extra', { x: 200 })] });
      RV.recordRevision('f4', 'crossM1', m1doc, 'merge-theirs');
      const entry = TM.mergeLogEntry({ id: 'lg_cross', at: Date.now(), source: 'm1.json', counts: { added: 1, changed: 1, removed: 0, conflicts: 0 }, mode: 'three-way', rev: 'crossM1' });
      { const lib = loadLibrary(); lib.f4.doc = D({ nodes: [dev('a', 'Router', { notes: 'a' })], log: [entry] }); lib.f4.updated += 10; persistLibrary(lib); }
      const n1 = D({ nodes: [dev('a', 'Router', { notes: 'b' }), dev('e', 'Extra', { x: 200 }), dev('z', 'Theirs new', { x: 400 })] });
      ctx = await mergeContext('f4', n1, { id: 'f4', updated: Date.now(), rev: 'crossN1', base: 'crossM1', prior: [r0.rev] });
      ok('F7 after a cross-merge the base is the nearest one held (M1), not the older prior (R0)', !ctx.ancestor && ctx.baseRev === 'crossM1', JSON.stringify([ctx.baseRev, r0.rev]));
      const res = ctx.base && TM.applyMergePlan(libraryEntry('f4').doc, TM.planMerge(libraryEntry('f4').doc, n1, ctx.base));
      ok('F7b so a delete made here stays deleted and the field keeps mine', !!res && names(res.doc) === 'Router,Theirs new' && res.doc.nodes.find((n) => n.id === 'a').notes === 'a',
         res && JSON.stringify(res.doc.nodes));
      libraryDelete('f4');
    }

    // ---- G. No newer-wins left; a newer Topo's file is never merged ----
    const src = (f) => { const r = new XMLHttpRequest(); r.open('GET', f, false); r.send(); return r.responseText; };
    const lib = src('js/library.js'), app = src('js/app.js');
    ok('G1 no newer-wins left at any door', !/binderLossGuard|binderOverwrites/.test(lib + app) && !/\(theirs\.updated \|\| 0\) > \(mine\.updated/.test(lib)
       && !/updatedOf\(x\) > updatedOf/.test(lib));
    freshCards(); replaceDocument(EMPTY_DOC, { origin: 'new' });
    reset(); choose = 'merge'; pickId = 't1';
    await applyImportedDoc(fileOf({ v: DOC_VERSION + 1, id: 'futureX', nodes: [dev('a', 'Future')], links: [] }), { fileName: 'future.json' });
    ok('G2 a newer Topo\'s file opens read-only, with no merge offered', !!state.readOnly && !asked.some((r) => r.kind === 'choice') && !reviews.length,
       JSON.stringify([!!state.readOnly, asked.map((r) => r.kind + ':' + r.message), reviews.length]));
    replaceDocument(EMPTY_DOC, { origin: 'new' });

    // ---- H. Words ----
    const keys = ['There is no network here to merge into.', 'Merge into which network?', 'Merge into a network',
      'It is compared with your back-up of {date}, so edits made on both sides are kept.', 'It was taken from yours, so edits made on both sides are kept.',
      'No copy both started from was found: merging keeps everything of yours and asks where the two differ.', '"{name}" already has everything in this copy.',
      'Merge with "{name}":', 'A file into this network…', 'This network into another…', 'Merge "{name}" into which network?',
      'That file is a binder of several networks: open it with Open a file.', 'A newer copy of a template', 'Made by a newer version of Topo',
      'Yours was made by a newer version of Topo', 'No copy both started from was found', 'Compared with your last back-up', 'Could not be compared',
      '{n} conflict', '{n} conflicts', 'Review…', 'Replace with theirs', 'Keep as a copy', 'Skip',
      'The bound binder file holds copies of these networks that differ from yours. A copy you skip is replaced in the file by yours.',
      'These copies differ from your networks and could not be merged on their own. Choose for each; Skip leaves yours as it is.',
      'Merged when you press Done (nothing to decide): {names}.', 'Merged', 'Skip (yours goes in the file)', 'Binder loaded: {added} added, {merged} merged, {kept} already up to date.',
      '{n} replaced by its copy.', '{n} replaced by their copies.', '{n} skipped.', 'Replace with this copy', 'Replacing keeps a restore point of yours first.',
      'You already have "{name}" in this browser, and yours already has everything in this copy.', 'You already have "{name}" in this browser, and this copy differs from it.',
      'Merge into "{name}"', 'Merge…', 'This file holds a network that is not in this browser yet.', 'Merge into a network…', 'Open as its own network', 'Networks to decide on', 'Merge into it', 'Back-up cancelled.',
      'Not added: one of yours has the same name or range.', 'Kept yours: another one already has that name or range.',
      'Skipped: the one of yours chosen for it was chosen for another too.',
      'Yours has 1 change since its last back-up that this copy does not have; replacing with this copy loses it. A restore point is kept.',
      'Yours has {n} changes since its last back-up that this copy does not have; replacing with this copy loses them. A restore point is kept.',
      'Yours has 1 change since its last report that this copy does not have; replacing with this copy loses it. A restore point is kept.',
      'Yours has {n} changes since its last report that this copy does not have; replacing with this copy loses them. A restore point is kept.'];
    const missing = [];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => keys.forEach((k) => {
      if (!CarinoI18N.has(loc, k)) missing.push(`${loc}: ${k.slice(0, 30)}`);
      else if ((k.match(/\{\w+\}/g) || []).some((ph) => !CarinoI18N.MESSAGES[loc][k].includes(ph))) missing.push(`${loc} placeholder: ${k.slice(0, 30)}`);
    }));
    ok('H1 every new string in es, pt-BR, ja and ru, placeholders kept', !missing.length, missing.slice(0, 3).join(' | '));
    ok('H2 Japanese never says コンピューター', !keys.some((k) => /コンピューター/.test(CarinoI18N.MESSAGES.ja[k] || '')));
    setLocale('es');
    ok('H3 the summary\'s words in Spanish', t('Replace with theirs') === 'Reemplazar con la suya' && t('{n} conflicts', { n: 2 }) === '2 conflictos');
    const inLoc = (loc, k) => { setLocale(loc); const v = t(k); setLocale('es'); return v; };
    ok('H4 one word for a binder in each locale\'s new strings', /^Binder cargado/.test(inLoc('es', 'Binder loaded: {added} added, {merged} merged, {kept} already up to date.'))
       && inLoc('es', 'Two-way merge') === 'Fusión de dos vías' && /биндер/i.test(inLoc('ru', 'That file is a binder of several networks: open it with Open a file.'))
       && /^Binder carregado/.test(inLoc('pt-BR', 'Binder loaded: {added} added, {merged} merged, {kept} already up to date.')));
    setLocale('en');
  } catch (err) {
    ok('the suite ran without throwing', false, String(err && err.stack || err));
  } finally {
    setLocale('en');
    TM.setDigest(heldDigest);
    setDialogResponder(heldResponder);
    MU.setMergeResponder(heldMerge);
    MD.setMergeSummaryResponder(heldSummary);
    window.downloadJson = heldDownload;
    window.showToast = heldToast;
    setGuestBinder(null);
    cardsUsed.forEach((id) => C.dropSnapshot(id));
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(null);
    R.releaseRestoreStore(); R._reset();
    if (landingIsOpen()) closeLanding();
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    persistLibrary(heldLib);
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 300); });
