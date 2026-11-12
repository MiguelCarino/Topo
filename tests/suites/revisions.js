// Document v17 and the revision store (docs/SCOPE.md section 3, step 2,
// stage 1; js/revisions.js, js/model.js "Network log"):
//   A. the format: DOC_VERSION 17, the 16 -> 17 step (deterministic, the
//      input untouched), isDocShape taking log and prior, schema v17 beside
//      v16 with rev/base/prior/log;
//   B. the network log: normalized (malformed and unknown kinds dropped, one
//      entry per id, the newest 500 kept, summary cut, prev only as 64 hex),
//      written last by serializeDoc and not at all when empty, a link
//      carrying the newest 50, a template carrying none, and the borrowers
//      (canonicalDoc, withDoc, withDocRendered) leaving the open log alone;
//   C. the store: a fake disk, caps (opened first, a card's rev and base
//      held), the total cap, the tab fallback, BroadcastChannel, findBase
//      order and its wait for the store, dropped with the card;
//   D. identity: a rev minted only when the content changed (an edit undone
//      keeps it), prior, base from a file or a link kept, a copy's base, the
//      card's revision kept across autosaves and restore points, the base
//      after a merge read from the log, binderFile() alone stamping nothing,
//      the back-up, binder and restore downloads carrying rev before doc;
//   E. privacy: a link nobody kept stamps nothing on disk, until it is kept.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const RV = window.CarinoRevisions;
  const realSaveBlob = window.saveBlob;
  const saved = [];
  window.saveBlob = (blob, name) => { saved.push({ blob, name }); return 'blob:test'; };
  const lastJson = async () => JSON.parse(await saved[saved.length - 1].blob.text());
  let promptWith = null, choose = null;
  const heldResponder = setDialogResponder((req) => (req.kind === 'prompt' ? promptWith : req.kind === 'choice' ? (req.kind === 'choice' && req.choices.some((c) => c.id === 'open') && req.choices.some((c) => c.id === 'merge') && !req.choices.some((c) => c.id === choose) ? 'open' : choose) : req.kind === 'confirm' ? true : undefined));
  if (window.CarinoRestore) await CarinoRestore.openRestoreStore({ open: async () => [], readCards: async () => ({}), readDoc: async () => null, write: async () => true });
  const heldLib = loadLibrary();
  const heldLimits = Object.assign({}, RV.REVISION_LIMITS);
  const heldExport = localStorage.getItem(BINDER_EXPORT_KEY);

  const makeDisk = (initial = []) => {
    const disk = new Map(initial.map((r) => [r.meta.id, r]));
    const f = { disk, mode: 'ok', writes: [], reads: [] };
    f.adapter = {
      open: async () => { if (f.slow) await f.slow; return [...disk.values()].map((r) => clone(r.meta)); },
      readCards: async (ids) => { f.reads.push(ids); const o = {}; ids.forEach((id) => { o[id] = [...disk.values()].filter((r) => r.meta.cardId === id).map((r) => clone(r.meta)); }); return o; },
      readDoc: async (id) => (disk.has(id) ? clone(disk.get(id).doc) : null),
      write: (ops) => {
        f.writes.push({ put: ops.put.map((p) => p.meta.id), del: ops.del.slice() });
        if (f.mode === 'fail') return Promise.resolve(false);
        ops.put.forEach((p) => disk.set(p.meta.id, { meta: clone(p.meta), doc: clone(p.doc) }));
        ops.del.forEach((id) => disk.delete(id));
        return Promise.resolve(true);
      },
      dropCard: (cardId) => { [...disk.values()].filter((r) => r.meta.cardId === cardId).forEach((r) => disk.delete(r.meta.id)); return Promise.resolve(true); }
    };
    return f;
  };
  const node = (id, name, x = 0) => ({ id, type: 'pc', name, x, y: 0 });
  const docOf = (...names) => ({ v: DOC_VERSION, nodes: names.map((n, i) => node(`n${i}`, n, i * 120)), links: [] });
  const entry = (id, doc, extra = {}) => Object.assign({ id, name: id, created: 1, updated: 100, doc }, extra);
  const putCards = (...cards) => { const lib = {}; cards.forEach((c) => { lib[c.id] = c; }); persistLibrary(lib); };
  const mergeEntry = (id, rev, extra = {}) => Object.assign({ id, at: 1000, kind: 'merge', source: 'x.json', counts: { added: 1, changed: 0, removed: 0, conflicts: 0 }, mode: 'two-way', rev }, extra);

  try {
    // ---- A. The format ----
    ok('the document version is 20', DOC_VERSION === 20);
    const v16 = { v: 16, nodes: [node('a', 'A')], links: [], searches: [{ id: 's1', name: 'S', query: 'x' }] };
    const frozen = JSON.stringify(v16);
    const m1 = migrateDoc(v16), m2 = migrateDoc(clone(v16));
    ok('a v16 document migrates to 20, the same twice, input untouched', m1.doc.v === 20 && m1.from === 16 && !m1.newer
       && JSON.stringify(m1.doc) === JSON.stringify(m2.doc) && JSON.stringify(v16) === frozen
       && JSON.stringify(Object.assign({}, m1.doc, { v: 16 })) === frozen);
    ok('a v21 document is newer (read-only)', migrateDoc({ v: 21, nodes: [] }).newer === true);
    ok('isDocShape takes a log and a prior list', isDocShape({ nodes: [], log: [], prior: ['a'] }) && isDocShape({ nodes: [], log: [{ id: 'x' }] }));
    ok('and refuses a log or prior that is not a list', !isDocShape({ nodes: [], log: {} }) && !isDocShape({ nodes: [], prior: 'a' }));
    ok('withTopoSchema names v20', withTopoSchema({ kind: 'nettopology', doc: { nodes: [] } }).$schema === 'https://topo.carino.systems/schema/topo-v20.json');
    const fetchJson = async (u) => { try { const r = await fetch(u); return r.ok ? JSON.parse(await r.text()) : null; } catch (e) { return null; } };
    const s18 = await fetchJson('schema/topo-v18.json'), s17 = await fetchJson('schema/topo-v17.json'), s16 = await fetchJson('schema/topo-v16.json');
    ok('schema v18 parses beside the kept v17 and v16', !!s18 && !!s17 && !!s16 && s18.$id.endsWith('topo-v18.json') && s17.$id.endsWith('topo-v17.json') && s16.$id.endsWith('topo-v16.json'));
    ok('v18 describes the problem reports, before the log', !!s18 && Object.keys(s18.$defs.document.properties).indexOf('incidents') === Object.keys(s18.$defs.document.properties).indexOf('log') - 1
       && /18/.test(s18.$defs.document.properties.v.description));
    ok('it describes rev, base, prior and log on the document', !!s17 && ['rev', 'base', 'prior', 'log'].every((k) => k in s17.$defs.document.properties)
       && s17.$defs.document.properties.log.type === 'array' && /17/.test(s17.$defs.document.properties.v.description));
    ok('and rev, base and prior on a binder site, before its doc', !!s17 && (() => {
      const keys = Object.keys(s17.$defs.binderFile.properties.sites.items.properties);
      return ['rev', 'base', 'prior'].every((k) => keys.indexOf(k) >= 0 && keys.indexOf(k) < keys.indexOf('doc'));
    })());

    // ---- B. The network log ----
    const good = mergeEntry('lg_1', 'r1', { by: ' Ana ', summary: 'x'.repeat(400), prev: 'a'.repeat(64) });
    const norm = normalizeLog([good, null, 5, { id: 'bad id', at: 1, kind: 'merge' }, { id: 'lg_2', at: 0, kind: 'merge' },
      { id: 'lg_3', at: 2, kind: 'gossip' }, { id: 'lg_1', at: 9, kind: 'merge' }, { id: 'lg_4', at: 3, kind: 'merge', counts: { added: -1, changed: 2.5 }, prev: 'ABC', mode: 'sideways', secret: 'x' }]);
    ok('normalizeLog keeps entries in order, drops malformed and unknown kinds, first of an id', norm.length === 2 && norm[0].id === 'lg_1' && norm[1].id === 'lg_4', JSON.stringify(norm.map((e) => e.id)));
    ok('fields trimmed and cut: by, summary at 160', norm[0].by === 'Ana' && norm[0].summary.length === LOG_SUMMARY_MAX && norm[0].prev === 'a'.repeat(64) && norm[0].rev === 'r1');
    ok('counts default to 0, a bad prev, mode and stray keys dropped', JSON.stringify(norm[1].counts) === '{"added":0,"changed":0,"removed":0,"conflicts":0}'
       && !('prev' in norm[1]) && !('mode' in norm[1]) && !('secret' in norm[1]));
    ok('key order is the allowlist\'s', JSON.stringify(Object.keys(norm[0])) === '["id","at","kind","source","by","counts","summary","mode","rev","prev"]', Object.keys(norm[0]).join());
    const many = Array.from({ length: 520 }, (_, i) => mergeEntry('lg_' + i, null));
    const kept500 = normalizeLog(many);
    ok('at most 500, the newest kept', kept500.length === LOG_MAX && kept500[0].id === 'lg_20' && kept500[499].id === 'lg_519');
    ok('normalizing twice changes nothing', JSON.stringify(normalizeLog(kept500)) === JSON.stringify(kept500));
    ok('a link carries the newest 50, the document left alone', (() => { const d = { nodes: [], log: kept500 }; const l = withLinkLog(d); return l.log.length === LOG_LINK_MAX && l.log[49].id === 'lg_519' && d.log.length === 500; })());

    replaceDocument(Object.assign(docOf('A'), { log: [good] }), { origin: 'file' });
    const ser = serializeDoc();
    ok('serializeDoc writes the log, last', Object.keys(ser).pop() === 'log' && ser.log.length === 1 && ser.log[0].id === 'lg_1');
    ok('and none when it is empty', (() => { replaceDocument(docOf('A'), { origin: 'file' }); return serializeDoc().log === undefined && !('log' in JSON.parse(JSON.stringify(serializeDoc()))); })());
    replaceDocument(Object.assign(docOf('A'), { log: [good] }), { origin: 'template' });
    ok('a template opened brings no log', state.log.length === 0 && serializeDoc().log === undefined);
    persistLibrary({});
    replaceDocument(Object.assign(docOf('T'), { log: [good] }), { origin: 'file' });
    const tplId = librarySave('Tpl', null, { template: true });
    ok('a template saved keeps no log', !!tplId && !('log' in libraryEntry(tplId).doc));
    // The borrowers hold the open log.
    replaceDocument(Object.assign(docOf('Mine'), { log: [mergeEntry('lg_mine', null)] }), { origin: 'file' });
    const other = Object.assign(docOf('Other'), { log: [mergeEntry('lg_other', null)] });
    const c = canonicalDoc(other);
    ok('canonicalDoc reads another document\'s log and leaves the open one', c.log[0].id === 'lg_other' && state.log[0].id === 'lg_mine');
    const seen = withDoc(other, () => state.log.map((e) => e.id).join());
    ok('withDoc too', seen === 'lg_other' && state.log[0].id === 'lg_mine');
    let rendered = '';
    await withDocRendered(other, async () => { rendered = state.log.map((e) => e.id).join(); });
    ok('withDocRendered too (a binder report must not leave a site\'s log behind)', rendered === 'lg_other' && state.log.length === 1 && state.log[0].id === 'lg_mine');
    ok('every key loadDocState writes is held', DOC_STATE_KEYS.includes('log') && DOC_STATE_KEYS.includes('incidents') && DOC_STATE_KEYS.includes('watch') && DOC_STATE_KEYS.length === 17);

    // ---- C. The store ----
    persistLibrary({});
    RV._reset();
    let f = makeDisk();
    ok('a store that answers is taken', (await RV.openRevisionStore(f.adapter)) === 'idb');
    putCards(entry('c1', docOf('A')), entry('c2', docOf('B')));
    const r1 = RV.recordRevision('c1', 'ra', docOf('A'), 'export');
    ok('a revision is held at once', !!r1 && RV.hasRevision('c1', 'ra') && RV.hasRevision(null, 'ra') && !RV.hasRevision('c2', 'ra'));
    ok('and reaches the disk', (await r1.stored) === true && f.disk.has('c1|ra') && f.disk.get('c1|ra').meta.rev === 'ra' && f.disk.get('c1|ra').meta.cardId === 'c1');
    const again = RV.recordRevision('c1', 'ra', docOf('Z'), 'export');
    ok('the same revision again writes nothing', (await again.stored) === true && f.writes.length === 1);
    ok('its content is read back without identity', (await RV.revisionDoc('c1', 'ra')).nodes[0].name === 'A');
    ok('a revision with no doc, card or valid rev is refused', RV.recordRevision('c1', 'bad rev!', docOf('A')) === null && RV.recordRevision('', 'r', docOf('A')) === null && RV.recordRevision('c1', 'r', null) === null);
    // Caps: per card, the opened first, the card's own rev and base held.
    RV.REVISION_LIMITS.perCard = 3;
    putCards(entry('c1', docOf('A'), { rev: 'h1', base: 'h0' }), entry('c2', docOf('B')));
    RV._reset();
    ['h0', 'o1', 'h1', 'e1', 'e2'].forEach((rev) => RV.recordRevision('c1', rev, docOf(rev), rev.startsWith('o') ? 'opened' : 'export'));
    const kept = RV.revisionsOf('c1').map((m) => m.rev);
    ok('past the cap, the opened go first, then the oldest; the card\'s rev and base stay', kept.length === 3 && kept.includes('h0') && kept.includes('h1') && kept.includes('e2') && !kept.includes('o1'), kept.join());
    RV.REVISION_LIMITS.perCard = 30;
    RV._reset();
    const big = docOf('X'.repeat(2000));
    RV.REVISION_LIMITS.totalBytes = 3 * new Blob([JSON.stringify(big)]).size + 10;
    ['t1', 't2'].forEach((rev) => RV.recordRevision('c2', rev, big, 'export'));
    ['h1', 't3'].forEach((rev) => RV.recordRevision('c1', rev, big, 'export'));
    const all = [...RV.revisionsOf('c1'), ...RV.revisionsOf('c2')].map((m) => m.rev).sort();
    ok('the total cap drops the oldest of any card, a held one never', all.join() === 'h1,t2,t3', all.join());
    RV.REVISION_LIMITS.totalBytes = heldLimits.totalBytes;
    // Dropped with the card.
    RV._reset();
    f = makeDisk(); await RV.openRevisionStore(f.adapter);
    putCards(entry('c1', docOf('A')), entry('c2', docOf('B')));
    await RV.recordRevision('c1', 'd1', docOf('A'), 'export').stored;
    await RV.recordRevision('c2', 'd2', docOf('B'), 'export').stored;
    libraryDelete('c1');
    await wait(10);
    ok('a deleted card\'s revisions go, here and on disk', !RV.hasRevision('c1', 'd1') && !f.disk.has('c1|d1') && f.disk.has('c2|d2'));
    // Adopting a disk: its records join, a card that is gone loses its own.
    RV._reset();
    const f2 = makeDisk([{ meta: { id: 'c2|z1', cardId: 'c2', rev: 'z1', at: 5, bytes: 10, hash: 'h', why: 'binder' }, doc: docOf('Z') },
      { meta: { id: 'bad', cardId: 'c2', rev: 'z2', at: 5 }, doc: docOf('Q') }]);
    await RV.openRevisionStore(f2.adapter);
    ok('the disk\'s revisions are adopted, an invalid record skipped', RV.hasRevision('c2', 'z1') && !RV.hasRevision('c2', 'z2') && (await RV.revisionDoc('c2', 'z1')).nodes[0].name === 'Z');
    // Another tab.
    f2.disk.set('c2|z9', { meta: { id: 'c2|z9', cardId: 'c2', rev: 'z9', at: 9, bytes: 1, hash: 'h', why: 'link' }, doc: docOf('Y') });
    const bc = new BroadcastChannel(RV.REVISION_DB);
    bc.postMessage({ cardIds: ['c2'] });
    for (let i = 0; i < 20 && !RV.hasRevision('c2', 'z9'); i++) await wait(20);
    bc.close();
    ok('another tab\'s revision is read when it says so', RV.hasRevision('c2', 'z9') && f2.reads.some((ids) => ids.includes('c2')));
    // findBase: the card first, then any card, then this tab.
    RV._reset();
    await RV.openRevisionStore(makeDisk().adapter);
    RV.recordRevision('c1', 'fa', docOf('in c1'), 'export');
    RV.recordRevision('c2', 'fa', docOf('in c2'), 'export');
    RV.recordRevision('c2', 'fb', docOf('only c2'), 'export');
    RV.recordSessionRevision('fc', docOf('tab'), 'opened');
    const b1 = await RV.findBase('fa', 'c2'), b2 = await RV.findBase(['zz', 'fb'], 'c1'), b3 = await RV.findBase(['fc'], 'c1'), b4 = await RV.findBase(['nope', 'bad id!'], 'c1');
    ok('findBase looks under the given card first', b1 && b1.cardId === 'c2' && b1.doc.nodes[0].name === 'in c2');
    ok('then under any card, the first of the list that is held', b2 && b2.cardId === 'c2' && b2.rev === 'fb');
    ok('then in this tab; nothing found is null', b3 && b3.cardId === null && b3.doc.nodes[0].name === 'tab' && b4 === null);
    // It waits for the store to open.
    RV._reset();
    let release;
    const f3 = makeDisk([{ meta: { id: 'c1|late', cardId: 'c1', rev: 'late', at: 5, bytes: 1, hash: 'h', why: 'export' }, doc: docOf('Late') }]);
    f3.slow = new Promise((r) => { release = r; });
    RV.openRevisionStore(f3.adapter, 10);
    await wait(30);
    const pending = RV.findBase('late', 'c1');
    release();
    const late = await pending;
    ok('findBase waits for the store to adopt the disk', !!late && late.doc.nodes[0].name === 'Late');
    // Without IndexedDB: this tab only.
    RV._reset();
    ok('no store: this tab only', (await RV.openRevisionStore(null)) === 'tab');
    const tabRec = RV.recordRevision('c1', 'tb', docOf('A'), 'export');
    ok('a revision is still held, not stored', RV.hasRevision('c1', 'tb') && (await tabRec.stored) === false && (await RV.revisionDoc('c1', 'tb')).nodes.length === 1);

    // ---- D. Identity ----
    RV._reset();
    f = makeDisk(); await RV.openRevisionStore(f.adapter);
    persistLibrary({}); localStorage.removeItem(BINDER_EXPORT_KEY);
    replaceDocument(docOf('A', 'B'), { origin: 'file', claim: true });
    const id = claimDocument('Net', state.libraryId);
    ok('a kept network has no revision before a copy leaves', !!libraryEntry(id) && !libraryEntry(id).rev && !state.docRev);
    binderFile();
    ok('binderFile() alone (a count, a preview) stamps nothing', !libraryEntry(id).rev && RV.revisionsOf(id).length === 0);
    saved.length = 0; exportJsonFile();
    const e1 = (await lastJson()).doc;
    const card1 = libraryEntry(id);
    ok('a back-up carries a rev, after id and updated', !!e1.rev && JSON.stringify(Object.keys(e1).slice(0, 4)) === '["v","id","updated","rev"]' && !('base' in e1) && !('prior' in e1), Object.keys(e1).slice(0, 5).join());
    ok('the card holds it, without moving updated', card1.rev === e1.rev && card1.revAt === card1.updated && card1.updated === e1.updated && state.docRev === e1.rev);
    ok('and the content is kept under it, on disk', RV.hasRevision(id, e1.rev) && (await RV.revisionsFlushed()) && f.disk.has(id + '|' + e1.rev) && f.disk.get(id + '|' + e1.rev).meta.why === 'export');
    saved.length = 0; exportJsonFile();
    ok('nothing changed: the same rev again', (await lastJson()).doc.rev === e1.rev);
    state.nodes[0].name = 'A2'; save(); flushAutosave();
    saved.length = 0; exportJsonFile();
    const e2 = (await lastJson()).doc;
    ok('changed: a new rev, the old one first in prior', e2.rev && e2.rev !== e1.rev && JSON.stringify(e2.prior) === JSON.stringify([e1.rev]));
    state.nodes[0].name = 'A3'; save(); flushAutosave();
    state.nodes[0].name = 'A2'; save(); flushAutosave();
    saved.length = 0; exportJsonFile();
    ok('an edit undone back to what left keeps that rev', (await lastJson()).doc.rev === e2.rev);
    ok('the card\'s revision survives its autosaves (libraryEntryFor)', libraryEntry(id).rev === e2.rev && JSON.stringify(libraryEntry(id).prior) === JSON.stringify([e1.rev]));
    // The binder download: each network site carries its revision before its doc.
    saved.length = 0; await exportBinder();
    const bf = await lastJson();
    const site = bf.sites.find((x) => x.id === id);
    ok('a binder back-up stamps its sites: rev, base, prior before doc', site && site.rev === e2.rev
       && Object.keys(site).indexOf('rev') < Object.keys(site).indexOf('doc') && Object.keys(site).indexOf('prior') < Object.keys(site).indexOf('doc'), Object.keys(site || {}).join());
    ok('the template card carries none', bf.sites.every((x) => !x.template || !x.rev));
    // A file arriving with a rev, kept as a new card: it IS that rev, started from it.
    const arriving = { kind: 'nettopology', version: 1, name: 'Theirs', doc: Object.assign({ v: DOC_VERSION, id: 'theirs1', updated: 50, rev: 'arrR', base: 'arrB', prior: ['arrP'] }, docOf('T1')) };
    await applyImportedDoc(clone(arriving), { fileName: 'theirs.json' });
    const tc = libraryEntry('theirs1');
    ok('a file kept as a new card takes its rev, base = that rev, its prior', tc && tc.rev === 'arrR' && tc.base === 'arrR' && JSON.stringify(tc.prior) === '["arrP"]' && !!tc.revHash, JSON.stringify(tc && { rev: tc.rev, base: tc.base }));
    ok('the card\'s doc holds no identity', tc && !('rev' in tc.doc) && !('id' in tc.doc));
    ok('its content is kept under that rev (opened)', RV.hasRevision('theirs1', 'arrR') && RV.revisionsOf('theirs1')[0].why === 'opened');
    saved.length = 0; exportJsonFile();
    const back = (await lastJson()).doc;
    ok('sent back unchanged, it goes as the same rev, base that rev', back.rev === 'arrR' && back.base === 'arrR');
    // The base after a merge comes from the log.
    setCardMeta('theirs1', { base: 'arrR' });
    RV.recordRevision('theirs1', 'mergedR', docOf('M'), 'merge-theirs');
    state.log = [mergeEntry('lg_m', 'mergedR')]; save(); flushAutosave();
    saved.length = 0; exportJsonFile();
    ok('after a merge the base is the merged rev the log names', (await lastJson()).doc.base === 'mergedR');
    state.log = []; save(); flushAutosave();
    saved.length = 0; exportJsonFile();
    ok('the merge undone (its entry gone), the base is the card\'s own again', (await lastJson()).doc.base === 'arrR');
    ok('setCardMeta leaves updated alone', (() => { const u = libraryEntry('theirs1').updated; setCardMeta('theirs1', { base: 'q1' }); const ok1 = libraryEntry('theirs1').updated === u && libraryEntry('theirs1').base === 'q1'; setCardMeta('theirs1', { base: null }); return ok1 && !('base' in libraryEntry('theirs1')); })());
    // A restore point keeps the revision and restoring puts it back (on a
    // restore store that reads its documents back).
    await CarinoRestore.openRestoreStore(makeDisk().adapter);
    setCardMeta('theirs1', { base: 'arrR' });
    const before = libraryEntry('theirs1');
    await keepRestorePoints(['theirs1'], 'Before opening a file');
    const point = CarinoRestore.restorePointsOf('theirs1')[0];
    setCardMeta('theirs1', { rev: 'other', revHash: 'x', base: 'otherBase' });
    await CarinoRestore.restoreFromPoint('theirs1', point.id);
    const after = libraryEntry('theirs1');
    ok('a restore point puts back the base and rev it had', after.base === 'arrR' && after.rev === before.rev && !('revAt' in after), JSON.stringify({ base: after.base, rev: after.rev }));
    // The restore downloads carry a rev.
    saved.length = 0; CarinoRestore && downloadRestoreBackup(['theirs1']);
    ok('the restore back-up download carries the card\'s rev', (await lastJson()).doc.rev === libraryEntry('theirs1').rev);
    saved.length = 0; await CarinoRestore.downloadRestorePoint('theirs1', point.id);
    const pd = (await lastJson()).doc;
    ok('a point downloaded carries a rev of its own, kept under the card', !!pd.rev && RV.hasRevision('theirs1', pd.rev));
    // A binder site with a rev, kept.
    const bsite = { id: 'bsite', name: 'B', updated: 60, rev: 'bsR', doc: docOf('BS') };
    importBinderSites([bsite]);
    ok('a binder site kept takes its rev and base', libraryEntry('bsite').rev === 'bsR' && libraryEntry('bsite').base === 'bsR' && RV.hasRevision('bsite', 'bsR'));
    importBinderSites([{ id: 'bsite2', name: 'B2', updated: 60, rev: 'bad rev!', base: '../x', prior: 'p', doc: docOf('BS') }]);
    ok('an invalid rev, base or prior is not kept', !('rev' in libraryEntry('bsite2')) && !('base' in libraryEntry('bsite2')) && !('prior' in libraryEntry('bsite2')));

    // ---- E. Privacy: a link nobody kept ----
    persistLibrary({});
    RV._reset();
    f = makeDisk(); await RV.openRevisionStore(f.adapter);
    const linkDoc = Object.assign({ v: DOC_VERSION, id: 'linked1', updated: 70, rev: 'lnkR' }, docOf('Client'));
    replaceDocument(clone(linkDoc), { origin: 'link' });
    ok('a link opened is that rev, held in this tab only', state.docRev === 'lnkR' && !isKept() && RV.hasSessionRevision('lnkR') && !RV.hasRevision(null, 'lnkR'));
    const shared = identifiedDoc(serializeDoc(), 'link');
    ok('shared on unchanged, it is the same rev', shared.rev === 'lnkR' && shared.id === 'linked1');
    state.nodes[0].name = 'Edited'; save();
    const shared2 = identifiedDoc(serializeDoc(), 'link');
    await wait(10);
    ok('edited and shared: a new rev, still nothing on disk', shared2.rev !== 'lnkR' && JSON.stringify(shared2.prior) === '["lnkR"]' && f.writes.length === 0 && f.disk.size === 0);
    ok('the history entry carries the identity, for a reload', window.history.state && window.history.state.rev === shared2.rev && window.history.state.rh === state.docRevHash);
    promptWith = 'Client';
    const keptId = await keepThisNetwork();
    await RV.revisionsFlushed();
    const kc = libraryEntry(keptId);
    ok('kept: the card is the tab\'s rev, based on it, its revisions on disk now', kc && kc.rev === shared2.rev && kc.base === shared2.rev
       && JSON.stringify(kc.prior) === '["lnkR"]' && f.disk.has(keptId + '|lnkR') && f.disk.has(keptId + '|' + shared2.rev), JSON.stringify(kc && { rev: kc.rev, base: kc.base }));
    // Keep as a copy of a network already here: started from that rev, no rev of its own.
    replaceDocument(clone(Object.assign({}, linkDoc, { id: keptId, rev: 'cpR' }, docOf('Other'))), { origin: 'link' });
    choose = 'copy'; promptWith = 'Copy';
    const copyId = await keepThisNetwork();
    const cc = libraryEntry(copyId);
    ok('kept as a copy: a new card, based on the copy\'s rev, no rev of its own', cc && copyId !== keptId && cc.base === 'cpR' && !cc.rev && RV.hasRevision(copyId, 'cpR'), JSON.stringify(cc && { base: cc.base, rev: cc.rev }));
  } catch (e) {
    ok('the suite ran without throwing', false, String(e && e.stack || e));
  } finally {
    window.saveBlob = realSaveBlob;
    setDialogResponder(heldResponder);
    Object.assign(RV.REVISION_LIMITS, heldLimits);
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(null);
    persistLibrary(heldLib);
    if (heldExport === null) localStorage.removeItem(BINDER_EXPORT_KEY); else localStorage.setItem(BINDER_EXPORT_KEY, heldExport);
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 300); });
