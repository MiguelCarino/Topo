// Applying a merge (docs/SCOPE.md section 3, step 2, stage 3; js/mergeapply.js):
//   A. on screen: one undo step (undo takes the whole merge back, its log
//      entry too; redo puts it back), a restore point first with its reason
//      ("Before merging tech.json"), the log entry (source, who from
//      Settings, counts, mode, the revision merged in, prev chained), the
//      copy kept in the revision store (merge-theirs), saved at once, the
//      added devices selected;
//   B. the base the next copy goes out with: the merged rev, and back to the
//      card's own after undo (A1);
//   C. choices: a conflict answered with theirs;
//   D. a card not on screen: written in place (open: false), the network
//      on screen untouched; or opened first (the default);
//   E. refused: a read-only network on screen, a card from a newer Topo, a
//      copy from a newer Topo, a template; nothing written, no restore point;
//   F. a stale plan (the conflicts changed since the review): nothing
//      written; the restore point question cancelled: nothing written;
//      one merge at a time;
//   G. the log shown: the Export menu's Network log… once there is one,
//      the dialog's rows newest first, a tampered entry hinted, the card's
//      ≡ tool;
//   H. the report's Network log tick: off by default, printed when ticked,
//      at most 50 entries then how many earlier, markup as text;
//   I. every new string in es, pt-BR, ja and ru, the restore reasons too.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const MA = window.TopoMergeApply;
  const RV = window.CarinoRevisions;
  const R = window.CarinoRestore;
  const TM = window.TopoMerge;

  const fakeDigest = async (text) => {
    let s = '';
    for (let seed = 1; seed <= 8; seed++) {
      let h = 0x811c9dc5 ^ seed;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
      s += (h >>> 0).toString(16).padStart(8, '0');
    }
    return s;
  };
  const heldDigest = TM.setDigest(fakeDigest);
  const heldLib = loadLibrary();
  const heldEngineer = state.settings.reportEngineer;
  const heldDownload = window.downloadJson;
  window.downloadJson = () => {};
  let choose = null;
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return req.kind === 'choice' ? choose : req.kind === 'confirm' ? true : undefined; });

  // Stores that take every write (restoreDisk.mode 'fail' refuses them).
  const restoreDisk = { mode: 'ok', map: new Map() };
  const restoreAdapter = {
    open: async () => [],
    readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = []; }); return o; },
    readDoc: async (id) => (restoreDisk.map.has(id) ? clone(restoreDisk.map.get(id)) : null),
    write: (ops) => {
      if (restoreDisk.mode === 'fail') return Promise.resolve(false);
      ops.put.forEach((p) => restoreDisk.map.set(p.meta.id, clone(p.doc))); ops.del.forEach((id) => restoreDisk.map.delete(id));
      return Promise.resolve(true);
    }
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
  const oldEntry = { id: 'lg_old1', at: Date.UTC(2026, 9, 1), kind: 'merge', source: 'first.json', counts: { added: 1, changed: 0, removed: 0, conflicts: 0 }, mode: 'two-way' };
  const MINE = D({ nodes: [dev('a', 'Router', { interfaces: [nic('i1', '10.0.0.1/24')], notes: 'mine' }), dev('b', 'PC-1', { x: 120, interfaces: [nic('i1', '10.0.0.11/24')] })],
    links: [{ id: 'l1', source: 'a', target: 'b' }], log: [oldEntry] });
  const THEIRS = D({ nodes: [dev('a', 'Router', { interfaces: [nic('i1', '10.0.0.1/24')], notes: 'theirs', serial: 'SN-9' }), dev('b', 'PC-1', { x: 120, interfaces: [nic('i1', '10.0.0.11/24')] }),
    dev('c', 'Printer', { x: 240, interfaces: [nic('i1', '10.0.0.20/24')] })],
    links: [{ id: 'l1', source: 'a', target: 'b' }, { id: 'l2', source: 'a', target: 'c' }] });
  const sortDeep = (v) => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v);
  const undoOff = () => document.getElementById('undoBtn').disabled;

  try {
    ok('the apply layer is loaded', !!MA && typeof commitMerge === 'function' && typeof openLogDialog === 'function');
    R._reset(); await R.openRestoreStore(restoreAdapter);
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(revAdapter);
    state.settings.reportEngineer = 'Ana Ruiz';

    // ---- A. On screen ----
    putCards(card('m1', 'Casa Roma', MINE, { base: 'orig1' }));
    await openFromLibrary('m1');
    flushAutosave();
    const beforeJson = JSON.stringify(serializeDoc());
    ok('the target is open, a fresh undo timeline', state.libraryId === 'm1' && undoOff());
    let res = await commitMerge({ targetId: 'm1', theirs: clone(THEIRS), base: null, theirsRev: 'revT1', source: 'C:\\Users\\tech\\tech.json', reason: 'Before merging {file}' });
    ok('A1 merged', res.ok && res.mode === 'two-way', JSON.stringify(res));
    ok('A2 the device of theirs is on screen and in the card', names(serializeDoc()) === 'PC-1,Printer,Router' && names(libraryEntry('m1').doc) === 'PC-1,Printer,Router');
    const rA = getNode('a');
    ok('A3 the defaults: mine kept on a conflict, a blank of mine filled', rA.notes === 'mine' && rA.serial === 'SN-9');
    ok('A4 the counts', res.counts.added === 2 && res.counts.changed === 1 && res.counts.removed === 0 && res.counts.conflicts === 1, JSON.stringify(res.counts));
    const pts = R.restorePointsOf('m1');
    ok('A5 a restore point first, holding the network as it was', pts.length === 1 && pts[0].reason === 'Before merging {file}'
       && JSON.stringify(canonicalDoc(await R.restorePointDoc(pts[0].id))) === JSON.stringify(canonicalDoc(JSON.parse(beforeJson))), JSON.stringify(pts));
    ok('A6 its reason names the file by its name only', R.restoreReasonText(pts[0]) === 'Before merging tech.json', R.restoreReasonText(pts[0]));
    const log = state.log;
    const e = log[log.length - 1];
    ok('A7 the log keeps what it had and gains one entry', log.length === 2 && log[0].id === 'lg_old1' && e.kind === 'merge' && /^lg_/.test(e.id));
    ok('A8 the entry: source, who, counts, mode, the rev merged in', e.source === 'tech.json' && e.by === 'Ana Ruiz' && e.mode === 'two-way' && e.rev === 'revT1'
       && e.counts.added === 2 && e.counts.changed === 1 && e.counts.conflicts === 1 && Math.abs(e.at - Date.now()) < 60000, JSON.stringify(e));
    ok('A9 chained to the entry before it', e.prev === await fakeDigest(JSON.stringify(sortDeep(log[0])))
       && await TM.verifyLog(log) === -1, e.prev);
    ok('A10 the card holds the log too', JSON.stringify(libraryEntry('m1').doc.log) === JSON.stringify(log));
    ok('A11 the copy is kept under its revision, as merge-theirs', RV.hasRevision('m1', 'revT1') && RV.revisionsOf('m1').some((m) => m.rev === 'revT1' && m.why === 'merge-theirs'));
    ok('A12 the result itself is not kept as a revision (A23)', RV.revisionsOf('m1').length === 1);
    ok('A13 the devices added are selected', state.selection.size >= 1 && [...state.selection].some((k) => String(k).includes('c')), JSON.stringify([...state.selection]));
    ok('A14 one undo step', !undoOff());
    undo();
    flushAutosave();
    ok('A15 undo takes the whole merge back, its log entry with it', JSON.stringify(serializeDoc()) === beforeJson && state.log.length === 1 && undoOff());
    ok('A16 and the card follows', names(libraryEntry('m1').doc) === 'PC-1,Router' && libraryEntry('m1').doc.log.length === 1);
    // ---- B. The base ----
    const baseUndone = RV.stampCard('m1', 'export');
    ok('B1 undone: the next copy goes out with the card\'s own base', baseUndone && baseUndone.base === 'orig1', JSON.stringify(baseUndone));
    redo();
    flushAutosave();
    ok('A17 redo puts it back', names(serializeDoc()) === 'PC-1,Printer,Router' && state.log.length === 2);
    const baseMerged = RV.stampCard('m1', 'export');
    ok('B2 merged: the next copy goes out based on the copy merged in', baseMerged && baseMerged.base === 'revT1', JSON.stringify(baseMerged));
    const outFile = identifiedDoc(serializeDoc(), 'export');
    ok('B3 and so does an export of the open network', outFile.base === 'revT1' && outFile.rev && outFile.rev !== 'revT1', JSON.stringify({ rev: outFile.rev, base: outFile.base }));
    ok('B4 the card\'s own base is not rewritten by a merge', libraryEntry('m1').base === 'orig1');

    // ---- C. Choices ----
    putCards(card('m2', 'Torre', MINE));
    await openFromLibrary('m2');
    const plan = planMerge(clone(MINE), clone(THEIRS), null);
    res = await commitMerge({ targetId: 'm2', theirs: clone(THEIRS), plan, choices: { 'nodes:a#notes': 'theirs' }, source: 'tech.json' });
    ok('C1 a conflict answered with theirs', res.ok && getNode('a').notes === 'theirs' && libraryEntry('m2').doc.nodes.find((n) => n.id === 'a').notes === 'theirs');
    ok('C2 a reviewed plan whose conflicts still stand is applied', res.ok && res.counts.conflicts === 1);
    ok('C3 no rev given: the entry names none, nothing kept in the store', !state.log[state.log.length - 1].rev && !RV.revisionsOf('m2').length);

    // ---- D. A card not on screen ----
    putCards(card('m3', 'Open one', D({ nodes: [dev('x', 'Kept')] })), card('m4', 'Closed one', MINE, { updated: 5000 }));
    await openFromLibrary('m3');
    const openJson = JSON.stringify(serializeDoc());
    res = await commitMerge({ targetId: 'm4', theirs: clone(THEIRS), source: 'link', reason: 'Before merging a link', open: false, theirsRev: 'revL' });
    const m4 = libraryEntry('m4');
    ok('D1 written in place', res.ok && names(m4.doc) === 'PC-1,Printer,Router' && m4.doc.log.length === 2 && m4.doc.log[1].source === 'link');
    ok('D2 its time moves on', m4.updated > 5000);
    ok('D3 the network on screen is untouched, nothing to undo', state.libraryId === 'm3' && JSON.stringify(serializeDoc()) === openJson && undoOff());
    ok('D4 the restore point and the revision are its', R.restorePointsOf('m4').length === 1 && R.restorePointsOf('m4')[0].reason === 'Before merging a link' && RV.hasRevision('m4', 'revL'));
    ok('D5 a link reads as such in the log', logEntryText(m4.doc.log[1]) === 'Merged a link: 2 added, 1 changed, 0 removed, 1 conflicts.', logEntryText(m4.doc.log[1]));
    putCards(card('m3', 'Open one', D({ nodes: [dev('x', 'Kept')] })), card('m5', 'Another', MINE));
    await openFromLibrary('m3');
    res = await commitMerge({ targetId: 'm5', theirs: clone(THEIRS), source: 'Torre B', reason: 'Before merging {name}', name: 'Torre B' });
    ok('D6 by default the card is opened first, so the merge is its undo step', res.ok && state.libraryId === 'm5' && !undoOff() && names(serializeDoc()) === 'PC-1,Printer,Router');
    ok('D7 another network\'s name in the reason', R.restoreReasonText(R.restorePointsOf('m5')[0]) === 'Before merging Torre B', R.restoreReasonText(R.restorePointsOf('m5')[0]));

    // ---- E. Refused ----
    const newer = Object.assign(clone(MINE), { v: DOC_VERSION + 1 });
    putCards(card('m6', 'Newer card', newer), card('m7', 'Plain', MINE), card('m8', 'Tpl', MINE, { template: true }));
    replaceDocument(clone(newer), { libraryId: 'm6', origin: 'library' });
    ok('E0 a newer card opens read-only', !!state.readOnly);
    res = await commitMerge({ targetId: 'm6', theirs: clone(THEIRS), source: 'x.json' });
    ok('E1 a read-only network on screen is refused', !res.ok && res.reason === 'read-only' && !R.hasRestorePoints('m6'));
    await openFromLibrary('m7');
    res = await commitMerge({ targetId: 'm6', theirs: clone(THEIRS), source: 'x.json', open: false });
    ok('E2 so is a card from a newer Topo not on screen', !res.ok && res.reason === 'read-only' && !R.hasRestorePoints('m6'));
    res = await commitMerge({ targetId: 'm7', theirs: Object.assign(clone(THEIRS), { v: DOC_VERSION + 1 }), source: 'x.json' });
    ok('E3 a copy from a newer Topo is refused, nothing written', !res.ok && res.reason === 'newer' && !R.hasRestorePoints('m7') && names(libraryEntry('m7').doc) === 'PC-1,Router');
    res = await commitMerge({ targetId: 'm8', theirs: clone(THEIRS), source: 'x.json' });
    ok('E4 a template takes no merge', !res.ok && res.reason === 'target');
    res = await commitMerge({ targetId: 'nope', theirs: clone(THEIRS), source: 'x.json' });
    ok('E5 nor a card that is not there', !res.ok && res.reason === 'target');

    // ---- F. Stale, cancelled, busy ----
    putCards(card('m9', 'Stale', D({ nodes: [dev('a', 'Router', { interfaces: [nic('i1', '10.0.0.1/24')], notes: 'theirs' })] })));
    await openFromLibrary('m9');
    const quiet = planMerge(serializeDoc(), clone(THEIRS), null);   // no conflict on notes: the same on both
    getNode('a').notes = 'edited since'; save();
    res = await commitMerge({ targetId: 'm9', theirs: clone(THEIRS), plan: quiet, source: 'x.json' });
    ok('F1 the conflicts changed since the review: nothing written, asked to review again', !res.ok && res.reason === 'stale' && !!res.plan
       && getNode('a').notes === 'edited since' && !getNode('c') && (libraryEntry('m9').doc.log || []).length === 0);
    restoreDisk.mode = 'fail'; choose = null; asked.length = 0;
    putCards(card('m10', 'Cancel', MINE));
    await openFromLibrary('m10');
    res = await commitMerge({ targetId: 'm10', theirs: clone(THEIRS), source: 'x.json' });
    ok('F2 the restore point could not be stored and the question was cancelled: nothing written', !res.ok && res.reason === 'cancelled'
       && asked.some((q) => q.kind === 'choice') && names(libraryEntry('m10').doc) === 'PC-1,Router' && undoOff());
    choose = 'continue';
    res = await commitMerge({ targetId: 'm10', theirs: clone(THEIRS), source: 'x.json' });
    ok('F3 Continue without: merged', res.ok && names(libraryEntry('m10').doc) === 'PC-1,Printer,Router');
    restoreDisk.mode = 'ok'; choose = null;
    putCards(card('m11', 'Busy', MINE));
    await openFromLibrary('m11');
    const p1 = commitMerge({ targetId: 'm11', theirs: clone(THEIRS), source: 'x.json' });
    const r2 = await commitMerge({ targetId: 'm11', theirs: clone(THEIRS), source: 'y.json' });
    const r1 = await p1;
    ok('F4 one merge at a time', r1.ok && !r2.ok && r2.reason === 'busy' && state.log.length === 2, JSON.stringify([r1.ok, r2]));

    // ---- G. The log shown ----
    renderDocBar();
    ok('G1 the Export menu offers the Network log once there is one', !document.getElementById('networkLogBtn').classList.contains('hidden'));
    openLogDialog('m11');
    const rows = [...document.querySelectorAll('#logList .log-row')];
    ok('G2 a row per entry, newest first', rows.length === 2 && rows[0].dataset.id === state.log[1].id && rows[1].dataset.id === 'lg_old1');
    ok('G3 each in words: what, the mode and who', rows[0].textContent.includes('Merged x.json: 2 added, 1 changed, 0 removed, 1 conflicts.')
       && rows[0].textContent.includes('Two-way merge') && rows[0].textContent.includes('by Ana Ruiz'), rows[0].textContent);
    ok('G4 nothing to press: read-only', !document.querySelector('#logList button, #logList input'));
    ok('G5 the name of the network', document.getElementById('logName').textContent === 'Busy');
    await wait(30);
    ok('G6 an intact log: no hint', document.getElementById('logHint').classList.contains('hidden'));
    closeLogDialog();
    // A log edited by hand: the entry after the edited one no longer follows.
    const tampered = clone(libraryEntry('m11'));
    tampered.doc.log[0].source = 'forged.json';
    tampered.id = 'm12'; tampered.name = 'Tampered';
    const lib = loadLibrary(); lib.m12 = tampered; persistLibrary(lib);
    openLogDialog('m12');
    await wait(30);
    const hint = document.getElementById('logHint');
    ok('G7 a tampered log: a hint names the entry', !hint.classList.contains('hidden') && /does not follow from the one before it/.test(hint.textContent), hint.textContent);
    closeLogDialog();
    replaceDocument(D({ nodes: [dev('q', 'Q')] }), { origin: 'file' });
    renderDocBar();
    openLogDialog(null);
    ok('G8 a network with none: the Export item hidden, the dialog says so', document.getElementById('networkLogBtn').classList.contains('hidden')
       && !document.getElementById('logEmpty').classList.contains('hidden') && !document.querySelectorAll('#logList li').length);
    closeLogDialog();
    renderLanding();
    const tool = document.querySelector('.landing-tool[aria-label^="Network log — Busy"]');
    const noTool = document.querySelector('.landing-tool[aria-label^="Network log — Tpl"]');
    ok('G9 a card with a log has its ≡ tool; a template none', !!tool && tool.textContent === '≡' && !noTool);
    if (tool) { tool.click(); ok('G10 which opens its log', document.getElementById('logList').children.length === 2 && document.getElementById('logName').textContent === 'Busy'); closeLogDialog(); }
    closeLanding();

    // ---- H. The report ----
    await openFromLibrary('m11');
    const heldCapture = window.captureReportDiagram;
    window.captureReportDiagram = async () => null;
    try {
      const plain = await buildSiteReport(normalizeReportMeta({ site: 'Busy' }), { technical: true });
      ok('H1 off by default', !plain.html.includes('<h2>Network log</h2>'));
      const withLog = await buildSiteReport(normalizeReportMeta({ site: 'Busy' }), { technical: true, sections: { log: true } });
      ok('H2 ticked: printed with every entry, who and when', withLog.html.includes('<h2>Network log</h2>') && withLog.html.includes('Merged first.json: 1 added')
         && withLog.html.includes('Ana Ruiz') && withLog.html.includes(localDateOf(state.log[1].at)));
      ok('H3 newest first', withLog.html.indexOf('Merged x.json') < withLog.html.indexOf('Merged first.json'));
    } finally { window.captureReportDiagram = heldCapture; }
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `lg_m${i}`, at: Date.UTC(2026, 0, 1) + i * 86400000, kind: 'merge', source: `<b>f${i}</b>.json`, counts: { added: i, changed: 0, removed: 0, conflicts: 0 }, mode: 'three-way' }));
    const sec = logReportSection(many);
    ok('H4 at most 50, then how many earlier', (sec.match(/<tr>/g) || []).length === 51 && sec.includes('…and 10 earlier entries.') && sec.includes('f59') && !sec.includes('>f9<') && !sec.includes('f9</b>'));
    ok('H5 a file name with markup is text', !sec.includes('<b>f') && sec.includes('&lt;b&gt;f59'));
    ok('H6 the mode in words', sec.includes('Three-way merge'));

    // ---- I. Words ----
    const keys = ['Before merging {file}', 'Before merging a link', 'Before merging a binder', 'Before merging {name}', 'a link', 'a binder', 'a copy',
      'Merged {source}: {added} added, {changed} changed, {removed} removed, {conflicts} conflicts.', 'Three-way merge', 'Two-way merge', 'by {name}',
      'This copy was made by a newer version of Topo, so it cannot be merged. Open it as a copy to read it.',
      'The network changed since the merge was reviewed: review it again.', 'Merged {source}: {added} added, {changed} changed, {removed} removed, {conflicts} conflicts.', 'Back-up cancelled.', 'Network log', 'Network log…',
      'Nothing has been merged into this network yet.', 'The entry of {date} does not follow from the one before it: this log was edited outside Topo.',
      'What was merged into this network from other copies, newest first. The log travels with the network.', '…and {n} earlier entries.', 'Merge',
      'Each merge into this network from another copy, newest first.',
      'Each merge into this network from another copy, newest first: where it came from, who merged it and what it changed. The log travels with the network in its files and links, and cannot be edited here.'];
    const missing = [];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => keys.forEach((k) => { if (!CarinoI18N.has(loc, k)) missing.push(`${loc}: ${k.slice(0, 30)}`); }));
    ok('I1 every new string in es, pt-BR, ja and ru', !missing.length, missing.slice(0, 3).join(' | '));
    ok('I2 the merge reasons are restore reasons', MA.MERGE_REASONS.every((r) => R.RESTORE_REASONS.includes(r)));
    setLocale('es');
    ok('I3 a reason reads in the language shown', R.restoreReasonText({ reason: 'Before merging {file}', fileName: 'a.json' }) === 'Antes de fusionar a.json');
    setLocale('en');
  } catch (err) {
    ok('the suite ran without throwing', false, String(err && err.stack || err));
  } finally {
    TM.setDigest(heldDigest);
    setDialogResponder(heldResponder);
    window.downloadJson = heldDownload;
    state.settings.reportEngineer = heldEngineer;
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(null);
    R._reset();
    persistLibrary(heldLib);
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 300); });
