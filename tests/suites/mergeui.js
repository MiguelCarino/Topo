// The merge review (docs/SCOPE.md section 3, step 2, stage 4; js/mergeui.js),
// driven through the real dialog, not the responder, except where a section
// says so:
//   A. it opens: the title names the copy and the network, the mode line
//      (two-way here), the counts (each a toggle; unchanged hidden at first),
//      the kind filter, one row per item, conflicts first;
//   B. a conflicting field is a Mine / Theirs pair, pressed on its default
//      (mine; a blank of mine filled from theirs is a change, not a
//      question); choosing presses the other; Use mine / theirs for all;
//   C. the findings: now and after, and which, recomputed as choices change;
//   D. Apply: the answers reach commitMerge (one undo step, a restore point,
//      a log entry); Cancel, the ✕ and Esc change nothing and keep no
//      restore point;
//   E. an item's own question: matched to several of mine (pick one: the
//      list is planned again with that match's fields; add as new; skip),
//      removed on one side and edited on the other (three-way: keep or
//      remove);
//   F. nothing to merge: Apply disabled and says so; a copy from a newer
//      Topo is refused before any review; a read-only target too;
//   G. at most 500 rows, then how many more; names and values are text,
//      never markup;
//   H. the phone rules, from the stylesheet (this runner's window is not a
//      phone: the real 360 / 390 check is a Playwright run): the pair
//      stacks, the tools go full width, targets 44px; and no row is wider
//      than the list here;
//   I. setMergeResponder answers instead of the dialog: its choices are
//      applied, null cancels; a stale review is asked again;
//   J. askPick (js/dialog.js): radio rows, the yes waits for a pick, the
//      answer is the id, dismissing is null, a responder's unknown id null;
//   K. words: every string the review shows (its literals, the kinds, the
//      statuses, the field labels it reads) in es, pt-BR, ja and ru; the
//      dialog reads in Spanish when Spanish is on.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const el = (id) => document.getElementById(id);
  const UI = window.TopoMergeUI;
  const TM = window.TopoMerge;
  const R = window.CarinoRestore;
  const RV = window.CarinoRevisions;
  const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  const heldDigest = TM.setDigest(async (text) => {
    let s = '';
    for (let seed = 1; seed <= 8; seed++) {
      let h = 0x811c9dc5 ^ seed;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
      s += (h >>> 0).toString(16).padStart(8, '0');
    }
    return s;
  });
  const heldLib = loadLibrary();
  const heldMerge = UI.setMergeResponder(null);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : req.kind === 'choice' ? null : undefined));

  const restoreDisk = new Map();
  const restoreAdapter = {
    open: async () => [],
    readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = []; }); return o; },
    readDoc: async (id) => (restoreDisk.has(id) ? clone(restoreDisk.get(id)) : null),
    write: (ops) => { ops.put.forEach((p) => restoreDisk.set(p.meta.id, clone(p.doc))); ops.del.forEach((id) => restoreDisk.delete(id)); return Promise.resolve(true); }
  };
  const revDisk = new Map();
  const revAdapter = {
    open: async () => [],
    readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = [...revDisk.values()].filter((r) => r.meta.cardId === id).map((r) => clone(r.meta)); }); return o; },
    readDoc: async (id) => (revDisk.has(id) ? clone(revDisk.get(id).doc) : null),
    write: (ops) => { ops.put.forEach((p) => revDisk.set(p.meta.id, { meta: clone(p.meta), doc: clone(p.doc) })); ops.del.forEach((id) => revDisk.delete(id)); return Promise.resolve(true); },
    dropCard: async () => true
  };

  const nic = (id, ip, mac) => Object.assign({ id, name: 'eth0', ip }, mac ? { mac } : {});
  const dev = (id, name, o = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [] }, o);
  const D = (o = {}) => Object.assign({ v: DOC_VERSION, nodes: [], links: [] }, o);
  const card = (id, name, doc, extra = {}) => Object.assign({ id, name, doc: clone(doc), created: 1, updated: 1000 }, extra);
  const putCards = (...cards) => { const lib = {}; cards.forEach((c) => { lib[c.id] = c; }); persistLibrary(lib); };
  const names = (doc) => ((doc && doc.nodes) || []).map((n) => n.name).sort().join(',');
  const isOpen = () => UI.mergeDialogOpen();
  const rows = () => [...el('mergeList').querySelectorAll(':scope > li.merge-row')];
  const rowOf = (key) => el('mergeList').querySelector(`[data-key="${CSS.escape(key)}"]`);
  const chip = (status) => el('mergeCounts').querySelector(`[data-status="${status}"]`);
  const chipN = (status) => Number(chip(status).querySelector('.merge-chip-n').textContent);
  const pickBtn = (key, field, take) => el('mergeList').querySelector(`button[data-key="${CSS.escape(key)}"][data-field="${CSS.escape(field)}"][data-take="${take}"]`);
  const choiceBtn = (key, choice) => el('mergeList').querySelector(`button[data-key="${CSS.escape(key)}"][data-choice="${CSS.escape(choice)}"]`);
  const pressed = (b) => !!b && b.getAttribute('aria-pressed') === 'true';

  const MINE = D({ nodes: [
    dev('a', 'Router', { type: 'router', interfaces: [nic('i1', '10.0.0.1/24')], notes: 'mine', vendor: 'MikroTik' }),
    dev('b', 'PC-1', { x: 120, interfaces: [nic('i1', '10.0.0.11/24')] })],
  links: [{ id: 'l1', source: 'a', target: 'b' }] });
  const THEIRS = D({ nodes: [
    dev('a', 'Router', { type: 'router', interfaces: [nic('i1', '10.0.0.1/24')], notes: 'theirs', vendor: 'Ubiquiti', serial: 'SN-9' }),
    dev('b', 'PC-1', { x: 120, interfaces: [nic('i1', '10.0.0.11/24')] }),
    dev('c', 'Printer <b>x</b>', { x: 240, interfaces: [nic('i1', '10.0.0.11/24')] })],
  links: [{ id: 'l1', source: 'a', target: 'b' }, { id: 'l2', source: 'a', target: 'c' }] });

  try {
    ok('the review is loaded', !!UI && typeof openMergeReview === 'function' && typeof closeMergeDialog === 'function' && !!el('mergeDialog'));
    R._reset(); await R.openRestoreStore(restoreAdapter);
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(revAdapter);

    // ---- A. It opens ----
    putCards(card('m1', 'Casa Roma', MINE));
    await openFromLibrary('m1');
    flushAutosave();
    const beforeJson = JSON.stringify(serializeDoc());
    let p = openMergeReview({ targetId: 'm1', theirs: clone(THEIRS), base: null, theirsRev: 'revT1', source: '/home/tech/tech.json', reason: 'Before merging {file}' });
    await tick();
    ok('A1 the review opens', isOpen());
    ok('A2 its title names the copy (by its file name) and the network', el('mergeTitle').textContent === 'Merge tech.json into Casa Roma', el('mergeTitle').textContent);
    ok('A3 the mode line says two-way and that nothing is removed', /^Two-way/.test(el('mergeMode').textContent) && /nothing is removed/.test(el('mergeMode').textContent));
    ok('A4 five counts, each a toggle', [...el('mergeCounts').children].length === 5 && [...el('mergeCounts').children].every((b) => b.hasAttribute('aria-pressed')));
    ok('A5 the counts: 2 to add (the printer, its cable), 1 conflict (the router), 2 unchanged',
       chipN('added') === 2 && chipN('conflict') === 1 && chipN('unchanged') === 2 && chipN('changed') === 0 && chipN('removed') === 0,
       ['added', 'changed', 'unchanged', 'removed', 'conflict'].map(chipN).join(','));
    ok('A6 unchanged is hidden at first, the rest shown', !pressed(chip('unchanged')) && pressed(chip('added')) && pressed(chip('conflict')));
    ok('A7 a row per item shown, conflicts first', rows().length === 3 && rows()[0].dataset.key === 'nodes:a' && rows()[0].classList.contains('merge-conflict'),
       rows().map((r) => r.dataset.key).join(','));
    const looksOn = (b) => !!b && b.classList.contains('active') && getComputedStyle(b).backgroundColor !== getComputedStyle(chip('unchanged')).backgroundColor;
    ok('A6b a chip that is on looks on (the fleet toggle style), one that is off does not', looksOn(chip('added')) && !chip('unchanged').classList.contains('active'),
       [getComputedStyle(chip('added')).backgroundColor, getComputedStyle(chip('unchanged')).backgroundColor].join(' / '));
    chip('unchanged').click();
    ok('A8 the unchanged toggle shows them', rows().length === 5 && pressed(chip('unchanged')) && chip('unchanged').classList.contains('active'));
    chip('unchanged').click();
    ok('A9 and hides them again', rows().length === 3);
    const kinds = [...el('mergeKind').options].map((o) => o.value);
    ok('A10 the kind filter lists the kinds present', kinds.join(',') === ',nodes,links', kinds.join(','));
    el('mergeKind').value = 'links';
    el('mergeKind').dispatchEvent(new Event('change'));
    ok('A11 and filters by kind', rows().length === 1 && rows()[0].dataset.key.startsWith('links:'));
    el('mergeKind').value = '';
    el('mergeKind').dispatchEvent(new Event('change'));
    ok('A12 an added row reads its kind and name', /Device/.test(rowOf('nodes:c').textContent) && rowOf('nodes:c').querySelector('.merge-label').textContent === 'Printer <b>x</b>');
    ok('A13 the cable row names both ends', rowOf('links:l2').querySelector('.merge-label').textContent === 'Router — Printer <b>x</b>', rowOf('links:l2').querySelector('.merge-label').textContent);

    // ---- B. Mine / Theirs ----
    const notesMine = pickBtn('nodes:a', 'notes', 'mine'), notesTheirs = pickBtn('nodes:a', 'notes', 'theirs');
    ok('B1 a conflicting field is a pair: Mine and Theirs with their values', notesMine && notesTheirs
       && notesMine.textContent === 'Mine: mine' && notesTheirs.textContent === 'Theirs: theirs', notesMine && notesMine.textContent);
    ok('B2 the field is named by its column label', [...rowOf('nodes:a').querySelectorAll('.merge-fname')].map((x) => x.textContent).includes('Notes'));
    ok('B3 pressed on mine by default', pressed(notesMine) && !pressed(notesTheirs));
    const serialLine = [...rowOf('nodes:a').querySelectorAll('.merge-field')].find((f) => f.querySelector('.merge-fname').textContent === 'Serial number');
    ok('B4 a blank of mine filled from theirs is a change, not a question', serialLine && !serialLine.querySelector('button')
       && serialLine.querySelector('.merge-change').textContent === '(empty) → SN-9', serialLine && serialLine.textContent);
    notesTheirs.click();
    ok('B5 choosing theirs presses it and lets go of mine', pressed(notesTheirs) && !pressed(notesMine) && UI.review().choices['nodes:a#notes'] === 'theirs');
    el('mergeAllMine').click();
    ok('B6 Use mine for all: every field conflict on mine', pressed(pickBtn('nodes:a', 'notes', 'mine')) && pressed(pickBtn('nodes:a', 'vendor', 'mine'))
       && UI.review().choices['nodes:a#vendor'] === 'mine');
    el('mergeAllTheirs').click();
    ok('B7 Use theirs for all: every field conflict on theirs', pressed(pickBtn('nodes:a', 'notes', 'theirs')) && pressed(pickBtn('nodes:a', 'vendor', 'theirs')));
    pickBtn('nodes:a', 'vendor', 'mine').click();

    // ---- C. The findings ----
    let d = UI.refreshMergeDelta();
    ok('C1 the findings now and after the merge', d && d.after > d.now && /Open findings: \d+ now, \d+ after this merge\./.test(el('mergeDelta').textContent), el('mergeDelta').textContent);
    ok('C1b said once: no second lead-in from the paste preview', !/Findings after this change|The findings stay the same/.test(el('mergeDelta').textContent), el('mergeDelta').textContent);
    ok('C2 and which: the printer takes PC-1\'s address', d.delta.some((x) => x.diff > 0) && !!el('mergeDelta').querySelector('.paste-delta-up'), JSON.stringify(d.delta));
    const dueBefore = el('mergeDelta').textContent;
    el('mergeDelta').textContent = 'stale';
    pickBtn('nodes:a', 'notes', 'mine').click();
    await wait(400);
    ok('C3 recomputed after a choice (debounced)', el('mergeDelta').textContent !== 'stale' && el('mergeDelta').textContent === dueBefore, el('mergeDelta').textContent);

    // ---- D. Apply ----
    pickBtn('nodes:a', 'notes', 'theirs').click();
    el('mergeApplyBtn').click();
    ok('D1 Apply closes the review at once', !isOpen());
    let res = await p;
    flushAutosave();
    const ra = getNode('a');
    ok('D2 the answers are what is written', res.ok && ra.notes === 'theirs' && ra.vendor === 'MikroTik' && ra.serial === 'SN-9', JSON.stringify(res));
    ok('D3 the printer is added', names(serializeDoc()) === 'PC-1,Printer <b>x</b>,Router');
    ok('D4 a restore point first, and a log entry', R.restorePointsOf('m1').length === 1 && state.log.length === 1 && state.log[0].source === 'tech.json');
    undo();
    flushAutosave();
    ok('D5 one undo step takes it back', JSON.stringify(serializeDoc()) === beforeJson);
    const points = R.restorePointsOf('m1').length;
    p = openMergeReview({ targetId: 'm1', theirs: clone(THEIRS), base: null, source: 'tech.json' });
    await tick();
    el('mergeCancelBtn').click();
    res = await p;
    ok('D6 Cancel: nothing changed, no restore point', res.ok === false && res.reason === 'cancelled' && !isOpen()
       && JSON.stringify(serializeDoc()) === beforeJson && R.restorePointsOf('m1').length === points, JSON.stringify(res));
    p = openMergeReview({ targetId: 'm1', theirs: clone(THEIRS), base: null, source: 'tech.json' });
    await tick();
    esc();
    res = await p;
    ok('D7 Esc cancels too', res.reason === 'cancelled' && !isOpen());
    p = openMergeReview({ targetId: 'm1', theirs: clone(THEIRS), base: null, source: 'tech.json' });
    await tick();
    el('mergeDialog').querySelector('.modal-x').click();
    res = await p;
    ok('D8 and the ✕', res.reason === 'cancelled' && !isOpen() && JSON.stringify(serializeDoc()) === beforeJson);

    // ---- E. An item's own question ----
    const AMB_MINE = D({ nodes: [dev('x1', 'Desk PC', { interfaces: [nic('i1', '10.0.0.21/24')] }), dev('x2', 'Desk PC', { x: 120, interfaces: [nic('i1', '10.0.0.22/24')] })] });
    const AMB_THEIRS = D({ nodes: [dev('t9', 'Desk PC', { notes: 'from the tech', interfaces: [] })] });
    putCards(card('m2', 'Ambiguous', AMB_MINE));
    await openFromLibrary('m2');
    p = openMergeReview({ targetId: 'm2', theirs: clone(AMB_THEIRS), base: null, source: 'amb.json' });
    await tick();
    const ambKey = rows()[0] && rows()[0].dataset.key;
    ok('E1 a device matching two of mine is a conflict that asks which', ambKey === 'nodes:t9' && /matches more than one of yours by name/.test(rows()[0].textContent), rows()[0] && rows()[0].textContent);
    ok('E2 its answers: each candidate, Add as new, Skip (the default)', choiceBtn(ambKey, 'x1') && choiceBtn(ambKey, 'x2') && choiceBtn(ambKey, 'add')
       && pressed(choiceBtn(ambKey, 'skip')) && choiceBtn(ambKey, 'x1').firstChild.textContent === 'Desk PC');
    ok('E2b each candidate says what tells it apart: its address', choiceBtn(ambKey, 'x1').querySelector('.merge-cand').textContent === '10.0.0.21/24'
       && choiceBtn(ambKey, 'x2').querySelector('.merge-cand').textContent === '10.0.0.22/24');
    choiceBtn(ambKey, 'x2').click();
    ok('E3 a candidate chosen: the question stays, answered', pressed(choiceBtn(ambKey, 'x2')) && !pressed(choiceBtn(ambKey, 'skip')));
    const matched = rowOf('nodes:x2');
    ok('E4 and the match is planned: its fields shown', !!matched && /matched by your choice/.test(matched.textContent)
       && /Notes/.test(matched.textContent), matched && matched.textContent);
    el('mergeApplyBtn').click();
    res = await p;
    flushAutosave();
    ok('E5 applied: theirs merged into the device chosen', res.ok && getNode('x2').notes === 'from the tech' && !getNode('x1').notes && state.nodes.length === 2, JSON.stringify(res));
    // Three-way: removed in theirs, edited in mine.
    const BASE = D({ nodes: [dev('a', 'Router'), dev('b', 'Old PC')] });
    const MINE3 = D({ nodes: [dev('a', 'Router'), dev('b', 'Old PC', { notes: 'still here' })] });
    const THEIRS3 = D({ nodes: [dev('a', 'Router')] });
    putCards(card('m3', 'Three', MINE3));
    await openFromLibrary('m3');
    p = openMergeReview({ targetId: 'm3', theirs: clone(THEIRS3), base: clone(BASE), source: 'back.json' });
    await tick();
    ok('E6 three-way: the mode line says so', /^Three-way/.test(el('mergeMode').textContent));
    ok('E7 removed in theirs, edited in mine: Keep it (the default) or Remove it', /Removed in their copy, but edited in yours\./.test(rowOf('nodes:b').textContent)
       && pressed(choiceBtn('nodes:b', 'keep')) && !!choiceBtn('nodes:b', 'remove'));
    choiceBtn('nodes:b', 'remove').click();
    ok('E8 Remove it pressed', pressed(choiceBtn('nodes:b', 'remove')) && !pressed(choiceBtn('nodes:b', 'keep')));
    el('mergeApplyBtn').click();
    res = await p;
    ok('E9 applied: removed', res.ok && names(serializeDoc()) === 'Router', names(serializeDoc()));

    // ---- F. Nothing to merge; refusals ----
    putCards(card('m4', 'Same', MINE));
    await openFromLibrary('m4');
    p = openMergeReview({ targetId: 'm4', theirs: clone(MINE), base: null, source: 'same.json' });
    await tick();
    ok('F1 nothing to merge: Apply is disabled and says so', el('mergeApplyBtn').disabled && el('mergeApplyBtn').textContent === 'Nothing to merge'
       && el('mergeAllMine').disabled && el('mergeAllTheirs').disabled);
    ok('F2 the list says the filters hide everything', rows().length === 0 && /Nothing to show/.test(el('mergeList').textContent));
    closeMergeDialog();
    res = await p;
    ok('F3 closeMergeDialog answers Cancel', res.reason === 'cancelled' && !isOpen());
    res = await openMergeReview({ targetId: 'm4', theirs: Object.assign(clone(MINE), { v: DOC_VERSION + 1 }), source: 'new.json' });
    ok('F4 a copy from a newer Topo is refused before any review', res.ok === false && res.reason === 'newer' && !isOpen(), JSON.stringify(res));
    res = await openMergeReview({ targetId: 'nope', theirs: clone(MINE), source: 'x.json' });
    ok('F5 no such network: refused', res.ok === false && res.reason === 'target' && !isOpen());
    putCards(card('m5', 'Newer', Object.assign(clone(MINE), { v: DOC_VERSION + 1 })), card('m4', 'Same', MINE));
    res = await openMergeReview({ targetId: 'm5', theirs: clone(MINE), source: 'x.json' });
    ok('F6 a network made by a newer Topo: refused (read-only)', res.ok === false && res.reason === 'read-only' && !isOpen());

    // ---- G. The cap; text, not markup ----
    const MANY = D({ nodes: Array.from({ length: 520 }, (_, i) => dev(`n${i}`, `<img src=x onerror="window.__mergeXss=1">Box ${i}`, { x: (i % 20) * 120, y: Math.floor(i / 20) * 120 })) });
    putCards(card('m6', 'Big', D({ nodes: [dev('z', 'Core')] })));
    await openFromLibrary('m6');
    p = openMergeReview({ targetId: 'm6', theirs: MANY, base: null, source: 'big.json' });
    await tick();
    ok('G1 at most 500 rows, then how many more', rows().length === 500 && /…and 20 more\./.test(el('mergeList').lastElementChild.textContent), `${rows().length} ${el('mergeList').lastElementChild.textContent}`);
    ok('G2 names are text: no element made from them', !el('mergeList').querySelector('img') && !window.__mergeXss && /<img/.test(rows()[0].querySelector('.merge-label').textContent));
    // ---- H. Phone rules ----
    const list = el('mergeList');
    ok('H1 no row is wider than the list here', list.scrollWidth <= list.clientWidth + 1, `${list.scrollWidth} > ${list.clientWidth}`);
    closeMergeDialog();
    await p;
    const rules = [];
    const walk = (list, media) => [...list].forEach((r) => {
      if (r.media && r.cssRules) walk(r.cssRules, r.media.mediaText);
      else if (r.selectorText) rules.push({ media: media || '', sel: r.selectorText, style: r.style });
    });
    [...document.styleSheets].forEach((s) => { try { walk(s.cssRules, ''); } catch (e) { /* another origin */ } });
    const phone = (sel, prop) => rules.find((r) => /max-width:\s*640px/.test(r.media) && r.sel.split(',').map((x) => x.trim()).includes(sel) && r.style.getPropertyValue(prop));
    const pickRule = phone('.merge-pick', 'grid-template-columns');
    ok('H2 on a phone the pair stacks: one column', !!pickRule && /^minmax\(0(px)?, 1fr\)$/.test(pickRule.style.getPropertyValue('grid-template-columns')),
       pickRule && pickRule.style.getPropertyValue('grid-template-columns'));
    ok('H3 the tools and the answers go full width', !!phone('.merge-bulk', 'flex') && !!phone('.merge-acts .btn', 'flex') && !!phone('.merge-tools .select', 'flex'));
    const tall = rules.find((r) => /max-width:\s*640px/.test(r.media) && /pointer:\s*coarse/.test(r.media) && r.sel.includes('.topo-merge .btn') && r.style.getPropertyValue('min-height') === '44px');
    ok('H4 every target 44px on a phone and under a finger', !!tall && /\.topo-merge \.toggle-btn/.test(tall.sel) && /\.topo-merge \.select/.test(tall.sel));
    ok('H5 values wrap anywhere: a long one never widens a row', rules.some((r) => r.sel === '.merge-btn' && r.style.getPropertyValue('overflow-wrap') === 'anywhere'));

    // ---- I. The responder ----
    putCards(card('m7', 'Resp', MINE));
    await openFromLibrary('m7');
    const asked = [];
    UI.setMergeResponder((req) => { asked.push(req); return { 'nodes:a#notes': 'theirs' }; });
    res = await openMergeReview({ targetId: 'm7', theirs: clone(THEIRS), base: null, source: 'r.json' });
    flushAutosave();
    ok('I1 the responder answers instead of the dialog, and its choices apply', res.ok && !isOpen() && getNode('a').notes === 'theirs'
       && asked.length === 1 && asked[0].plan && asked[0].targetId === 'm7' && asked[0].name === 'Resp' && asked[0].sourceText === 'r.json');
    UI.setMergeResponder(() => null);
    const before7 = JSON.stringify(serializeDoc());
    res = await openMergeReview({ targetId: 'm7', theirs: clone(THEIRS), base: null, source: 'r.json' });
    ok('I2 null cancels', res.reason === 'cancelled' && JSON.stringify(serializeDoc()) === before7);
    // Stale: the network changes while the review is open.
    putCards(card('m8', 'Stale', MINE));
    await openFromLibrary('m8');
    // While the first review is open, PC-1's vendor is edited here, and
    // theirs has another: a new conflict, so that review is stale.
    let rounds = 0;
    UI.setMergeResponder((req) => {
      rounds++;
      if (rounds === 1) { const n = getNode('b'); n.vendor = 'Dell'; save(); flushAutosave(); }
      return Object.assign({ 'nodes:a#notes': 'theirs' }, req.choices);
    });
    const THEIRS_B = clone(THEIRS);
    THEIRS_B.nodes[1].vendor = 'HP';
    res = await openMergeReview({ targetId: 'm8', theirs: THEIRS_B, base: null, source: 's.json' });
    flushAutosave();
    ok('I3 a review gone stale is asked again, the answers carried over', res.ok && rounds === 2 && getNode('a').notes === 'theirs' && getNode('b').vendor === 'Dell', `${rounds} ${JSON.stringify(res)}`);
    UI.setMergeResponder(null);

    // ---- J. askPick ----
    setDialogResponder(null);
    const ask = el('topoAsk');
    let q = askPick('Merge into which network?', { title: 'Merge', ok: 'Merge', rows: [{ id: 'c1', label: 'Casa Roma', detail: 'Grupo · Torre A · 2h ago' }, { id: 'c2', label: '<b>Torre</b>' }] });
    await tick();
    const radios = [...document.querySelectorAll('#topoAskTicks input')];
    const okBtn = [...document.querySelectorAll('#topoAskFoot button')].find((b) => b.textContent === 'Merge');
    ok('J1 a radio row each, the names as text', radios.length === 2 && radios.every((r) => r.type === 'radio') && !document.querySelector('#topoAskTicks b')
       && /Grupo · Torre A/.test(el('topoAskTicks').textContent));
    ok('J2 the yes waits for a pick', okBtn && okBtn.disabled);
    radios[1].click();
    ok('J3 a pick enables it', !okBtn.disabled);
    okBtn.click();
    ok('J4 the answer is the id', (await q) === 'c2' && ask.hidden);
    q = askPick('Which?', { rows: [{ id: 'c1', label: 'A' }], value: 'c1' });
    await tick();
    ok('J5 a value given is picked at first', document.querySelector('#topoAskTicks input').checked);
    esc();
    ok('J6 dismissing is null', (await q) === null);
    setDialogResponder(() => 'zz');
    ok('J7 a responder\'s unknown id is null', (await askPick('Which?', { rows: [{ id: 'c1', label: 'A' }] })) === null);
    setDialogResponder(() => 'c1');
    ok('J8 a responder\'s id is the answer', (await askPick('Which?', { rows: [{ id: 'c1', label: 'A' }] })) === 'c1');
    setDialogResponder((req) => (req.kind === 'confirm' ? true : req.kind === 'choice' ? null : undefined));

    // ---- K. Words ----
    const src = (() => { const x = new XMLHttpRequest(); x.open('GET', 'js/mergeui.js', false); x.send(); return x.responseText; })();
    const keys = new Set();
    const re = /\bt\('((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(src))) keys.add(m[1].replace(/\\(['"\\])/g, '$1'));
    Object.values(UI.MERGE_KIND_ONE).concat(Object.values(UI.MERGE_KIND_MANY), UI.MERGE_CHIPS.map((c) => c.label), Object.values(UI.MERGE_MATCHED_BY)).forEach((k) => keys.add(k));
    const fieldKinds = { nodes: NODE_FIELDS, ifaces: IFACE_FIELDS, links: LINK_FIELDS, networks: NETWORK_FIELDS, groups: GROUP_FIELDS, wifi: WIFI_FIELDS,
      providers: PROVIDER_FIELDS, searches: SEARCH_FIELDS, report: REPORT_FIELDS };
    // Every field the plan can list (not the ones it never compares: ids, a
    // device's place, the bags it splits into one field each).
    Object.keys(fieldKinds).forEach((kind) => fieldKinds[kind].forEach((f) => {
      if ((MERGE_SKIP[kind] || ['id']).includes(f.key)) return;
      const k = UI.mergeFieldKey(kind, f.key); if (k) keys.add(k);
    }));
    // The engine's notes, shown through t(), and the static buttons.
    ['Not added: this network already has as many as it can hold.', 'Skipped: it matches more than one of yours.', 'Dropped: its device was removed.',
     'Use mine for all', 'Use theirs for all'].forEach((k) => keys.add(k));
    CABLE_FIELDS.forEach((f) => { const k = UI.mergeFieldKey('links', `cable.${f.key}`); if (k) keys.add(k); });
    keys.add(UI.mergeFieldKey('nodes', 'port p3'));
    ok('K1 the review asks for a real number of strings', keys.size > 100, `${keys.size}`);
    const missing = [];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => keys.forEach((k) => { if (!CarinoI18N.has(loc, k)) missing.push(`${loc}: ${k}`); }));
    ok('K2 every string the review shows in es, pt-BR, ja and ru', !missing.length, `${missing.length} missing: ${missing.slice(0, 400).join(' | ')}`);
    setLocale('ja');
    ok('K3 Japanese says PC', [...keys].every((k) => !/パソコン/.test(t(k))));
    setLocale('es');
    applyStaticI18n();
    putCards(card('m9', 'Casa', MINE));
    await openFromLibrary('m9');
    p = openMergeReview({ targetId: 'm9', theirs: clone(THEIRS), base: null, source: 'tech.json' });
    await tick();
    ok('K4 in Spanish: the title, the counts, Mine / Theirs, the bulk buttons, Apply', el('mergeTitle').textContent === t('Merge {source} into {name}', { source: 'tech.json', name: 'Casa' })
       && el('mergeTitle').textContent !== 'Merge tech.json into Casa'
       && chip('added').firstChild.textContent === t('To add') && t('To add') !== 'To add'
       && /^Mío|^Mía|^Lo mío/.test(pickBtn('nodes:a', 'notes', 'mine').textContent)
       && el('mergeAllMine').textContent === t('Use mine for all') && el('mergeApplyBtn').textContent === t('Apply'),
       `${el('mergeTitle').textContent} | ${chip('added').textContent} | ${pickBtn('nodes:a', 'notes', 'mine').textContent} | ${el('mergeAllMine').textContent}`);
    closeMergeDialog();
    await p;
    setLocale('en');
    applyStaticI18n();
  } catch (err) {
    ok('the suite ran without throwing', false, String(err && err.stack || err));
  } finally {
    try { closeMergeDialog(); } catch (e) { /* shut */ }
    setLocale('en');
    applyStaticI18n();
    TM.setDigest(heldDigest);
    UI.setMergeResponder(heldMerge);
    setDialogResponder(heldResponder);
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(null);
    R._reset();
    persistLibrary(heldLib);
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 300); });
