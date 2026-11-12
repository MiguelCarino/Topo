// @realtime — the merge back walks the revision store (promises) and a merge
// is committed with its log entry chained (Web Crypto digests).
// The merge fixes of step 7, phase 7a (docs/SCOPE.md D152, D175, D176-D178):
//   1. sent parts are kept until answered: a ninth and a sixty-fifth
//      outstanding part survive the per-card cap and still merge three-way;
//      the card names every outstanding part; a part is let go once a copy
//      of it is merged back (the merged copy says which part it answers) or
//      its report is closed; a tab's parts (a network not kept) are never
//      pushed out by the tab's count; over the 40 MB budget with only held
//      parts left nothing is dropped and the library warns;
//   2. two providers' new records are never joined by name alone: a record
//      another provider's merge added since the part left matches a
//      returning part's new record only by id, MAC or serial; a name, an
//      address, a place is a question in the review whose default is Add as
//      new, so two different "AP-9"s stay two; a device you added yourself
//      since still joins by name, as before; the review's question and its
//      default in the browser;
//   3. new ids get a random part: two PCs minting in the same millisecond
//      with the same counter make different ids; withFixedIds stays
//      deterministic (the same ids as before the change).
//   4. a strong key wins over a weak hit on another provider's record: the
//      same asset tag and serial pair by the serial; the asset tag alone,
//      the name alone and a cable's ends alone ask, Add as new by default;
//   5. what holds a part is bounded where nothing can answer it: parts from
//      before 0.0.2 and copies back for no report are held as the newest
//      few only; an unanswered Share-dialog part keeps only the newest
//      copies merged back since it left; a part for two providers needs a
//      copy from each; over the budget, parts with no open report go first
//      and the warning stays for the rest; a card's part list from outside
//      is bounded (D179).
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 500) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  try {
    await until(() => !!window.CarinoRevisions && typeof mergeContext === 'function' && typeof planMerge === 'function' && typeof commitMerge === 'function');
    const RV = window.CarinoRevisions;
    setLocale('en');
    const limits = Object.assign({}, RV.REVISION_LIMITS);
    // The revision store in this tab only: nothing from an earlier suite.
    RV.releaseRevisionStore();
    RV._reset();
    await RV.openRevisionStore(null);

    const N = (id, name, extra = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    const inc = (id, status) => ({ id, at: 1, status, symptom: 'internet', routedTo: ['pA'] });
    const net = (extra = {}) => Object.assign({ v: DOC_VERSION,
      providers: [{ id: 'pA', name: 'Alfa IT', service: 'it' }, { id: 'pB', name: 'Beta IT', service: 'it' }],
      nodes: [N('sw', 'SW', { type: 'switch' }), N('pc', 'PC')], links: [{ id: 'l1', source: 'sw', target: 'pc' }],
      incidents: [inc('inc1', 'sent'), inc('inc2', 'sent')] }, extra);
    const card = (id, doc) => ({ id, name: id, created: 1, updated: 100, doc });
    const putCards = (...cards) => { const lib = loadLibrary(); cards.forEach((c) => { lib[c.id] = c; }); persistLibrary(lib); };
    const partCtx = (incidents, providers = ['pA']) => ({ nodes: [], groups: [], all: ['sw', 'pc', 'l1'], incidents, providers });
    const held = (k, rev) => RV.hasRevision(k, rev);

    // ---- 1. Sent parts are kept until answered ----
    const K = 'mf-held';
    putCards(card(K, net()));
    for (let i = 1; i <= 9; i++) RV.recordPartRevision(K, `pt${i}`, net(), undefined, partCtx(['inc1']));
    for (let i = 1; i <= 40; i++) RV.recordRevision(K, `ex${i}`, net({ nodes: [N('sw', 'SW ' + i, { type: 'switch' }), N('pc', 'PC')] }), 'export');
    ok('1.1 nine parts out and 40 copies after: the first part is still held', [1, 2, 3, 4, 5, 6, 7, 8, 9].every((i) => held(K, `pt${i}`)),
       show(RV.revisionsOf(K).filter((m) => m.why === 'part').map((m) => m.rev)));
    ok('1.2 and the per-card cap still applies to everything else', RV.revisionsOf(K).filter((m) => m.why === 'export').length <= limits.perCard - 9 + 1,
       String(RV.revisionsOf(K).length));
    // The ninth outstanding copy (the first part's) comes back: three-way.
    const back1 = Object.assign(net({ nodes: [N('sw', 'SW'), N('pc', 'PC renamed')] }), { rev: 'cb1', prior: ['pt1'] });
    const ctx1 = await mergeContext(K, back1, { id: null, updated: 5, rev: 'cb1', base: null, prior: ['pt1'] });
    ok('1.3 a copy of the first of nine parts merges three-way on its part', ctx1.isPart && ctx1.via === 'rev' && ctx1.baseRev === 'pt1'
       && planMerge(ctx1.mine, back1, ctx1.base, { part: ctx1.part }).mode === 'three-way', show([ctx1.isPart, ctx1.via, ctx1.baseRev]));
    ok('1.4 the merge info names the part it answers and its report', !!ctx1.part && ctx1.part.rev === 'pt1' && show([...ctx1.part.incidents]) === '["inc1"]', show(ctx1.part && [ctx1.part.rev, [...(ctx1.part.incidents || [])]]));
    for (let i = 10; i <= 65; i++) RV.recordPartRevision(K, `pt${i}`, net(), undefined, partCtx(['inc1']));
    for (let i = 41; i <= 60; i++) RV.recordRevision(K, `ex${i}`, net({ nodes: [N('sw', 'SW ' + i, { type: 'switch' }), N('pc', 'PC')] }), 'export');
    const all65 = Array.from({ length: 65 }, (_, i) => `pt${i + 1}`);
    ok('1.5 sixty-five parts out: every one held', all65.every((r) => held(K, r)), String(all65.filter((r) => !held(K, r)).length));
    ok('1.6 and the card names all 65 (no 64-entry cut)', all65.every((r) => (libraryEntry(K).partRevs || []).includes(r)), String((libraryEntry(K).partRevs || []).length));
    const ctx65 = await mergeContext(K, Object.assign(clone(back1), { rev: 'cb65', prior: ['pt65'] }), { id: null, updated: 5, rev: 'cb65', base: null, prior: ['pt65'] });
    ok('1.7 the sixty-fifth merges three-way too', ctx65.isPart && ctx65.baseRev === 'pt65', show([ctx65.via, ctx65.baseRev]));

    // Answered: the first part's copy merged back (committed, as the review does).
    const r1 = await commitMerge({ targetId: K, theirs: back1, base: ctx1.base, theirsRev: 'cb1', part: ctx1.part, source: 'link', open: false, pointTaken: true, quiet: true });
    const meta1 = RV.revisionPartMeta(K, 'cb1');
    ok('1.8 the copy merged back is held as a part that says which part it answers', r1.ok && RV.revisionWhy(K, 'cb1') === 'part' && !!meta1 && meta1.back === true
       && show(meta1.answers) === '["pt1"]' && show(meta1.incidents) === '["inc1"]' && meta1.by === 'pA', show([r1.ok, r1.reason, meta1]));
    RV.recordRevision(K, 'ex61', net({ nodes: [N('sw', 'SW 61', { type: 'switch' }), N('pc', 'PC')] }), 'export');
    ok('1.9 the answered part is let go at the next cap, the others stay', !held(K, 'pt1') && all65.slice(1).every((r) => held(K, r)) && held(K, 'cb1'),
       show([held(K, 'pt1'), all65.slice(1).filter((r) => !held(K, r))]));

    // Closed: a part sent for report inc2 goes once inc2 is closed.
    RV.recordPartRevision(K, 'pq1', net(), undefined, partCtx(['inc2']));
    RV.recordRevision(K, 'ex62', net({ nodes: [N('sw', 'SW 62', { type: 'switch' }), N('pc', 'PC')] }), 'export');
    ok('1.10 a part whose report is open stays', held(K, 'pq1'));
    const cur = libraryEntry(K);
    putCards(Object.assign(cur, { doc: Object.assign(clone(cur.doc), { incidents: [inc('inc1', 'sent'), Object.assign(inc('inc2', 'closed'), { closedAt: 2 })] }) }));
    RV.recordRevision(K, 'ex63', net({ nodes: [N('sw', 'SW 63', { type: 'switch' }), N('pc', 'PC')] }), 'export');
    ok('1.11 its report closed: let go at the next cap', !held(K, 'pq1') && held(K, 'pt2'), show(RV.revisionsOf(K).filter((m) => m.why === 'part').length));
    // A part with no report (shared from the Share dialog): until answered.
    RV.recordPartRevision(K, 'pn1', net(), undefined, partCtx([]));
    RV.recordRevision(K, 'ex64', net({ nodes: [N('sw', 'SW 64', { type: 'switch' }), N('pc', 'PC')] }), 'export');
    ok('1.12 a part sent for no report stays until a copy of it is merged', held(K, 'pn1'));
    // A part for two providers: answered only once both have come back.
    RV.recordPartRevision(K, 'p2p', net(), undefined, partCtx(['inc1'], ['pA', 'pB']));
    RV.recordRevision(K, 'cbA', back1, 'part', undefined, { nodes: [], groups: [], all: [], back: true, answers: ['p2p'], incidents: ['inc1'] });
    RV.recordRevision(K, 'ex65', net({ nodes: [N('sw', 'SW 65', { type: 'switch' }), N('pc', 'PC')] }), 'export');
    ok('1.13 a part for two providers is held after the first copy back', held(K, 'p2p'));
    RV.recordRevision(K, 'cbB', back1, 'part', undefined, { nodes: [], groups: [], all: [], back: true, answers: ['p2p'], incidents: ['inc1'] });
    RV.recordRevision(K, 'ex66', net({ nodes: [N('sw', 'SW 66', { type: 'switch' }), N('pc', 'PC')] }), 'export');
    ok('1.14 and let go after the second', !held(K, 'p2p'));

    // A network not kept: its parts are held in the tab, never pushed out by count.
    for (let i = 1; i <= limits.session + 5; i++) RV.recordSessionRevision(`sp${i}`, net(), 'part');
    for (let i = 1; i <= limits.session + 5; i++) RV.recordSessionRevision(`so${i}`, net(), 'opened');
    ok('1.15 a tab\'s parts are never pushed out by the tab\'s count', RV.sessionRevsWhy('part').length === limits.session + 5, String(RV.sessionRevsWhy('part').length));
    ok('1.16 its other copies still are', RV.sessionRevsWhy('opened').length < limits.session + 5, String(RV.sessionRevsWhy('opened').length));

    // Over the budget with only held parts left: nothing held goes, the library warns.
    const partsBefore = RV.revisionsOf(K).filter((m) => m.why === 'part').length;
    RV.REVISION_LIMITS.totalBytes = 1;
    RV.recordRevision(K, 'ex67', net({ nodes: [N('sw', 'SW 67', { type: 'switch' }), N('pc', 'PC')] }), 'export');
    ok('1.17 over the budget: no part with an open report is dropped', all65.slice(1).every((r) => held(K, r)) && held(K, 'cb1') && held(K, 'cbA') && held(K, 'cbB'),
       show([partsBefore, RV.revisionsOf(K).filter((m) => m.why === 'part').length]));
    ok('1.17b a part sent for no report is what goes instead (nothing to close it by)', !held(K, 'pn1'));
    ok('1.18 only what was not held went', !held(K, 'ex67') && RV.revisionsOf(K).every((m) => m.why === 'part' || m.rev === libraryEntry(K).rev || m.rev === libraryEntry(K).base),
       show(RV.revisionsOf(K).filter((m) => m.why !== 'part').map((m) => m.rev)));
    ok('1.19 and the store says it is over budget', typeof RV.revisionsOverBudget === 'function' && RV.revisionsOverBudget() === true);
    openLanding(false);
    renderLanding();
    await tick();
    const warn = document.getElementById('revisionSpaceWarn');
    ok('1.20 the library warns: close or merge them', !!warn && !warn.hidden && warn.textContent === 'Old sent copies are taking up space: close or merge them.', warn && `${warn.hidden} ${warn.textContent}`);
    setLocale('es');
    applyStaticI18n();
    ok('1.21 in Spanish too', !!warn && warn.textContent !== 'Old sent copies are taking up space: close or merge them.' && warn.textContent.length > 10, warn && warn.textContent);
    setLocale('en');
    applyStaticI18n();
    Object.assign(RV.REVISION_LIMITS, limits);
    RV.recordRevision(K, 'ex68', net(), 'export');
    if (typeof renderLanding === 'function') renderLanding();
    ok('1.22 back under the budget: no warning', typeof RV.revisionsOverBudget === 'function' && RV.revisionsOverBudget() === false && !!warn && warn.hidden);
    closeLanding();

    // ---- 2. Two providers' new records are never joined by name alone ----
    RV._reset();
    const K2 = 'mf-names';
    const ap = (id, extra = {}) => N(id, 'AP-9', Object.assign({ type: 'ap', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.9/24', mac: '' }] }, extra));
    // The network now: provider A's merge added AP-9 (apA) and a room;
    // you added a NAS yourself.
    const mineDoc = net({
      groups: [{ id: 'gA', name: 'Room 9', kind: 'room' }],
      nodes: [N('sw', 'SW', { type: 'switch' }), N('pc', 'PC'), ap('apA', { serial: 'SER-A', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.9/24', mac: 'AA:AA:AA:00:00:09' }] }),
        N('own1', 'NAS', { type: 'nas' })] });
    putCards(card(K2, mineDoc));
    // Provider B's part left first; provider A's copy came back after.
    RV.recordPartRevision(K2, 'pB', net(), undefined, partCtx(['inc1'], ['pB']));
    await tick();
    RV.recordRevision(K2, 'cA', net({ groups: [{ id: 'gA', name: 'Room 9', kind: 'room' }], nodes: [N('sw', 'SW', { type: 'switch' }), N('pc', 'PC'), mineDoc.nodes[2]] }), 'part', undefined,
      { nodes: [], groups: [], all: ['sw', 'pc', 'l1'], back: true, answers: ['pA0'], incidents: ['inc1'] });
    // Provider B's copy: its own AP-9 (another box), its own NAS, its own Room 9.
    const theirsB = (apExtra = {}) => Object.assign(net({ groups: [{ id: 'gB', name: 'Room 9', kind: 'room' }],
      nodes: [N('sw', 'SW', { type: 'switch' }), N('pc', 'PC'), ap('apB', apExtra), N('nasB', 'NAS', { type: 'nas' })] }), { rev: 'cB', prior: ['pB'] });
    const identB = { id: null, updated: 9, rev: 'cB', base: null, prior: ['pB'] };
    const ctxB = await mergeContext(K2, theirsB(), identB);
    ok('2.1 the merge info knows what another provider\'s merge added since the part left', ctxB.isPart && ctxB.baseRev === 'pB' && !!ctxB.part && ctxB.part.others instanceof Set
       && ctxB.part.others.has('apA') && ctxB.part.others.has('gA') && !ctxB.part.others.has('own1') && !ctxB.part.others.has('sw'),
       show(ctxB.part && ctxB.part.others ? [...ctxB.part.others] : null));
    const planB = planMerge(ctxB.mine, theirsB(), ctxB.base, { part: ctxB.part });
    const apItem = planB.items.find((it) => it.kind === 'nodes' && it.theirsId === 'apB');
    ok('2.2 their AP-9, the same name and address as the other provider\'s: a question, not a match', !!apItem && apItem.status === 'conflict' && apItem.conflict.type === 'ambiguous'
       && apItem.conflict.other === true && show(apItem.conflict.candidates) === '["apA"]', show(apItem && [apItem.status, apItem.conflict, apItem.matchedBy]));
    const outB = applyMergePlan(ctxB.mine, planB, {});
    ok('2.3 left alone, it is added as new: two AP-9s', outB.doc.nodes.filter((n) => n.name === 'AP-9').length === 2
       && outB.doc.nodes.find((n) => n.id === 'apA').serial === 'SER-A', show(outB.doc.nodes.map((n) => [n.id, n.name])));
    ok('2.4 the NAS you added yourself still joins theirs by name, as before', outB.doc.nodes.filter((n) => n.name === 'NAS').length === 1,
       show(planB.items.filter((it) => it.kind === 'nodes').map((it) => [it.theirsId, it.mineId, it.status, it.matchedBy])));
    const gItem = planB.items.find((it) => it.kind === 'groups' && it.theirsId === 'gB');
    ok('2.5 their Room 9 against the other provider\'s Room 9: a question too, added as new by default', !!gItem && gItem.conflict && gItem.conflict.type === 'ambiguous' && gItem.conflict.other === true
       && outB.doc.groups.filter((g) => g.name === 'Room 9').length === 2, show([gItem && gItem.conflict, outB.doc.groups]));
    const outPick = applyMergePlan(ctxB.mine, planB, { [apItem.key]: 'apA' });
    ok('2.6 answered "it is that one": one AP-9', outPick.doc.nodes.filter((n) => n.name === 'AP-9').length === 1, show(outPick.doc.nodes.map((n) => n.id)));
    const outSkip = applyMergePlan(ctxB.mine, planB, { [apItem.key]: 'skip' });
    ok('2.7 answered Skip: neither added nor joined, and a note says so', outSkip.doc.nodes.filter((n) => n.name === 'AP-9').length === 1
       && outSkip.notes.some((n) => n.key === 'Skipped: it may be one another provider added since.'), show(outSkip.notes));
    const byMac = planMerge(ctxB.mine, theirsB({ interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.9/24', mac: 'AA:AA:AA:00:00:09' }] }), ctxB.base, { part: ctxB.part });
    const macItem = byMac.items.find((it) => it.kind === 'nodes' && it.mineId === 'apA');
    ok('2.8 the same MAC: the same device, no question', !!macItem && macItem.matchedBy === 'mac' && !(macItem.conflict && macItem.conflict.type === 'ambiguous'), show(macItem && [macItem.matchedBy, macItem.status]));
    const bySerial = planMerge(ctxB.mine, theirsB({ serial: 'ser-a' }), ctxB.base, { part: ctxB.part });
    const serItem = bySerial.items.find((it) => it.kind === 'nodes' && it.mineId === 'apA');
    ok('2.9 the same serial: the same device', !!serItem && serItem.matchedBy === 'serial', show(serItem && serItem.matchedBy));
    const byId = Object.assign(theirsB(), {});
    byId.nodes[2].id = 'apA';
    const idPlan = planMerge(ctxB.mine, byId, ctxB.base, { part: ctxB.part });
    const idItem = idPlan.items.find((it) => it.kind === 'nodes' && it.mineId === 'apA');
    ok('2.10 the same id: the same device', !!idItem && idItem.matchedBy === 'id', show(idItem && idItem.matchedBy));
    ok('2.11 a part with no others (an older merge info) behaves as before: joined by its address', (() => {
      const p = planMerge(ctxB.mine, theirsB(), ctxB.base, { part: { nodes: ctxB.part.nodes, groups: ctxB.part.groups, known: ctxB.part.known } });
      const it = p.items.find((x) => x.kind === 'nodes' && x.theirsId === 'apB');
      return !!it && it.mineId === 'apA' && !(it.conflict && it.conflict.type === 'ambiguous');
    })());
    // The review's default, as the page reads it.
    ok('2.12 the review takes Add as new for it when nothing is chosen', mergeItemTake({ choices: {} }, apItem) === 'add' && mergeItemChoice({}, apItem) === 'add');
    ok('2.13 and an ordinary "matches more than one" still defaults to Skip', mergeItemTake({ choices: {} }, { key: 'nodes:x', conflict: { type: 'ambiguous', candidates: ['a', 'b'], by: 'name' } }) === 'skip');
    // Committed through the review's path with no answer: two AP-9s on the card.
    const rB = await commitMerge({ targetId: K2, theirs: theirsB(), base: ctxB.base, theirsRev: 'cB', part: ctxB.part, plan: planB, source: 'link', open: false, pointTaken: true, quiet: true });
    ok('2.14 committed with no answer: two AP-9s in the network, the log entry written', rB.ok && libraryEntry(K2).doc.nodes.filter((n) => n.name === 'AP-9').length === 2
       && rB.entry && rB.entry.kind === 'merge', show([rB.ok, rB.reason, libraryEntry(K2).doc.nodes.map((n) => n.id)]));
    // In the review itself: the question and the button pressed.
    if (typeof showMergeReview === 'function') {
      const shown = showMergeReview({ plan: planB, mine: ctxB.mine, targetId: K2, name: K2, source: 'link', sourceText: 'a link', choices: {}, note: '' });
      await tick();
      const row = document.querySelector('.merge-row[data-key="nodes:apB"]');
      const q = row && row.querySelector('.merge-asks .merge-fname');
      const pressed = row && row.querySelector('button[aria-pressed="true"]');
      ok('2.15 the review asks it as another provider\'s, Add as new pressed', !!row && !!q && /Another provider added one with the same IP address since/.test(q.textContent)
         && !!pressed && pressed.textContent === 'Add as new', show([!!shown, q && q.textContent, pressed && pressed.textContent]));
      if (typeof closeMergeDialog === 'function') closeMergeDialog();
    } else ok('2.15 the review opens (showMergeReview)', false, 'no showMergeReview');

    // ---- 4. Strong keys win over a weak "another provider's" hit (review) ----
    // A returning device sharing its asset tag AND its serial with the other
    // provider's new AP-9 pairs by the serial: the asset tag (a weak key that
    // hits another provider's record) is only asked when no strong key pairs.
    const mineT = clone(ctxB.mine);
    mineT.nodes.find((n) => n.id === 'apA').assetTag = 'TAG-9';
    const tagSer = planMerge(mineT, theirsB({ assetTag: 'TAG-9', serial: 'SER-A' }), ctxB.base, { part: ctxB.part });
    const tsItem = tagSer.items.find((it) => it.kind === 'nodes' && it.theirsId === 'apB');
    ok('4.1 the same asset tag and the same serial as another provider\'s new device: paired by the serial, no question',
       !!tsItem && tsItem.mineId === 'apA' && tsItem.matchedBy === 'serial' && !(tsItem.conflict && tsItem.conflict.type === 'ambiguous'),
       show(tsItem && [tsItem.mineId, tsItem.matchedBy, tsItem.conflict]));
    const tagOnly = planMerge(mineT, theirsB({ name: 'AP-X', assetTag: 'TAG-9', interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }), ctxB.base, { part: ctxB.part });
    const toItem = tagOnly.items.find((it) => it.kind === 'nodes' && it.theirsId === 'apB');
    ok('4.2 only the asset tag matches it: a question by asset tag, Add as new by default', !!toItem && toItem.conflict && toItem.conflict.type === 'ambiguous'
       && toItem.conflict.other === true && toItem.conflict.by === 'assetTag' && mergeItemChoice({}, toItem) === 'add', show(toItem && [toItem.conflict, toItem.matchedBy]));
    // The name alone (no address on theirs): asked by name, two AP-9s by default.
    const nameOnlyT = theirsB({ interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] });
    const nameOnly = planMerge(ctxB.mine, nameOnlyT, ctxB.base, { part: ctxB.part });
    const noItem = nameOnly.items.find((it) => it.kind === 'nodes' && it.theirsId === 'apB');
    ok('4.3 the same name, nothing else: a question by name (the name finder asks itself)', !!noItem && noItem.conflict && noItem.conflict.type === 'ambiguous'
       && noItem.conflict.other === true && noItem.conflict.by === 'name', show(noItem && [noItem.conflict, noItem.matchedBy]));
    ok('4.4 left alone: two AP-9s', applyMergePlan(ctxB.mine, nameOnly, {}).doc.nodes.filter((n) => n.name === 'AP-9').length === 2);
    // A cable another provider added between the same two devices.
    const mineL = clone(ctxB.mine);
    mineL.links = (mineL.links || []).concat([{ id: 'lA', source: 'sw', target: 'own1' }]);
    const theirsL = theirsB();
    theirsL.nodes.push(N('own1', 'NAS', { type: 'nas' }));
    theirsL.links = (theirsL.links || []).concat([{ id: 'lB', source: 'sw', target: 'own1' }]);
    const partL = { nodes: ctxB.part.nodes, groups: ctxB.part.groups, known: ctxB.part.known, others: new Set([...ctxB.part.others, 'lA']) };
    const cab = planMerge(mineL, theirsL, ctxB.base, { part: partL });
    const cItem = cab.items.find((it) => it.kind === 'links' && it.theirsId === 'lB');
    ok('4.5 a cable with the same ends as another provider\'s new cable: a question, Add as new by default', !!cItem && cItem.conflict && cItem.conflict.type === 'ambiguous'
       && cItem.conflict.other === true && cItem.conflict.by === 'ends' && mergeItemChoice({}, cItem) === 'add', show(cItem && [cItem.status, cItem.conflict, cItem.mineId]));

    // ---- 5. What holds a part, bounded (review) ----
    RV._reset();
    const K5 = 'mf-bounds';
    putCards(card(K5, net({ incidents: [inc('inc1', 'sent'), Object.assign(inc('incC', 'closed'), { closedAt: 2 })] })));
    // Held: what heldParts names (dropped later, oldest first, at a cap).
    const hp = (k, r) => !!RV.heldParts && RV.heldParts(k).has(r);
    const LOOSE = RV.PART_LOOSE_HELD, SINCE = RV.PART_SINCE_HELD;
    ok('5.0 the bounds are published', Number.isInteger(LOOSE) && LOOSE > 0 && Number.isInteger(SINCE) && SINCE > 0, show([LOOSE, SINCE]));
    const exp = (i) => RV.recordRevision(K5, `e5x${i}`, net({ nodes: [N('sw', 'SW ' + i, { type: 'switch' }), N('pc', 'PC')] }), 'export');
    // Parts from before 0.0.2: sent ones (on the card, no providers) and
    // copies merged back (not on the card, no marks). Already answered or
    // not, nothing says: they are held as before, the newest few only.
    for (let i = 1; i <= 6; i++) RV.recordPartRevision(K5, `lgs${i}`, net(), undefined, { nodes: [], groups: [], all: ['sw', 'pc', 'l1'] });
    for (let i = 1; i <= 6; i++) RV.recordRevision(K5, `lgb${i}`, net(), 'part', undefined, { nodes: [], groups: [], all: ['sw', 'pc', 'l1'] });
    for (let i = 1; i <= 40; i++) exp(i);
    const legacy = [...Array.from({ length: 6 }, (_, i) => `lgs${i + 1}`), ...Array.from({ length: 6 }, (_, i) => `lgb${i + 1}`)];
    ok('5.1 parts from before 0.0.2 are not held forever: the newest few only, as before', legacy.filter((r) => hp(K5, r)).length === LOOSE
       && legacy.slice(-LOOSE).every((r) => hp(K5, r)), show(legacy.filter((r) => hp(K5, r))));
    // A part sent for no report (the Share dialog), then a copy of it merged back for no report.
    RV.recordPartRevision(K5, 'sh1', net(), undefined, partCtx([], ['pA']));
    await tick();
    RV.recordRevision(K5, 'shb1', net(), 'part', undefined, { nodes: [], groups: [], all: [], back: true, answers: ['sh1'], by: 'pA' });
    exp(41);
    ok('5.2 a Share-dialog part is let go once its copy is merged; the copy is held', !hp(K5, 'sh1') && hp(K5, 'shb1'), show([hp(K5, 'sh1'), hp(K5, 'shb1')]));
    ok('5.3 the copy says whose it is', RV.revisionPartMeta(K5, 'shb1').by === 'pA', show(RV.revisionPartMeta(K5, 'shb1')));
    // That copy, for no report, never answered again: held among the newest few loose ones, not forever.
    for (let i = 1; i <= LOOSE + 2; i++) RV.recordRevision(K5, `lb${i}`, net(), 'part', undefined, { nodes: [], groups: [], all: [], back: true, answers: [`zz${i}`] });
    exp(42);
    ok('5.4 a copy back for no report is let go once newer ones like it pass the bound', !hp(K5, 'shb1'), String(hp(K5, 'shb1')));
    // One Share-dialog part never answered does not pin every later copy back.
    RV.recordPartRevision(K5, 'sh2', net(), undefined, partCtx([], ['pB']));
    await tick();
    for (let i = 1; i <= SINCE + 10; i++) RV.recordRevision(K5, `cc${i}`, net(), 'part', undefined, { nodes: [], groups: [], all: [], back: true, answers: [`yy${i}`], incidents: ['incC'] });
    for (let i = 43; i <= 80; i++) exp(i);
    const ccHeld = Array.from({ length: SINCE + 10 }, (_, i) => `cc${i + 1}`).filter((r) => hp(K5, r));
    ok('5.5 the unanswered part stays', hp(K5, 'sh2'));
    ok('5.6 but only the newest copies merged back since it left stay with it', ccHeld.length === SINCE && ccHeld.includes(`cc${SINCE + 10}`), show(ccHeld));
    // A part for two providers is answered by both, not by two copies of one.
    RV.recordPartRevision(K5, 'two', net(), undefined, partCtx(['inc1'], ['pA', 'pB']));
    RV.recordRevision(K5, 'twA1', net(), 'part', undefined, { nodes: [], groups: [], all: [], back: true, answers: ['two'], incidents: ['inc1'], by: 'pA' });
    RV.recordRevision(K5, 'twA2', net(), 'part', undefined, { nodes: [], groups: [], all: [], back: true, answers: ['two'], incidents: ['inc1'], by: 'pA' });
    exp(81);
    ok('5.7 two copies from the same provider do not answer a part for two', hp(K5, 'two'));
    RV.recordRevision(K5, 'twB1', net(), 'part', undefined, { nodes: [], groups: [], all: [], back: true, answers: ['two'], incidents: ['inc1'], by: 'pB' });
    exp(82);
    ok('5.8 the second provider\'s copy does', !hp(K5, 'two'));
    // Over the budget: what has no open report goes (oldest first); a part
    // with an open report never does, and the warning stays for those.
    RV.recordPartRevision(K5, 'sh3', net(), undefined, partCtx([], ['pA']));
    RV.REVISION_LIMITS.totalBytes = 1;
    exp(83);
    ok('5.9 over the budget: parts with no open report are let go', !held(K5, 'sh2') && !held(K5, 'sh3') && legacy.every((r) => !held(K5, r)) && ccHeld.every((r) => !held(K5, r)),
       show(RV.revisionsOf(K5).filter((m) => m.why === 'part').map((m) => m.rev)));
    ok('5.10 parts with an open report stay, and the store is still over', held(K5, 'twA1') && held(K5, 'twB1') && RV.revisionsOverBudget() === true);
    Object.assign(RV.REVISION_LIMITS, limits);
    // The card's part list from outside (a binder, a server site) is bounded.
    const big = { partRevs: Array.from({ length: 5000 }, (_, i) => 'r' + String(i).padStart(20, '0')) };
    const cut = applyCardRevision({ id: 'x' }, big).partRevs || [];
    ok('5.11 a card\'s part list from outside is cut to a generous bound, newest kept', cut.length > 0 && cut.length < 5000 && cut[cut.length - 1] === big.partRevs[4999], String(cut.length));

    // ---- 3. New ids get a random part ----
    const realNow = Date.now;
    const s0 = idSeq;
    let a, b;
    try {
      Date.now = () => 1767225600000;
      idSeq = 0; a = nextId('n');
      idSeq = 0; b = nextId('n');
    } finally { Date.now = realNow; idSeq = Math.max(s0, idSeq); }
    ok('3.1 two PCs, the same millisecond, the same counter: two different ids', a !== b, `${a} ${b}`);
    ok('3.2 still prefix_ and base 36, the four random characters last', /^n_[0-9a-z]+$/.test(a) && /^n_[0-9a-z]+$/.test(b) && a.slice(0, -4) === b.slice(0, -4) && a.length === b.length, `${a} ${b}`);
    const many = new Set();
    try { Date.now = () => 1767225600000; for (let i = 0; i < 200; i++) { idSeq = 0; many.add(nextId('x')); } } finally { Date.now = realNow; idSeq = Math.max(s0, idSeq); }
    ok('3.3 200 "PCs" in one millisecond: (nearly) all different', many.size >= 199, String(many.size));
    const f1 = withFixedIds(() => [nextId('n'), nextId('l'), nextId('i')]);
    const f2 = withFixedIds(() => [nextId('n'), nextId('l'), nextId('i')]);
    ok('3.4 withFixedIds is deterministic, the same ids as before the change', show(f1) === show(f2) && show(f1) === '["n_00","l_01","i_02"]', show(f1));
    ok('3.5 and the live sequence and clock are put back', (() => { const x = nextId('n'); return !x.startsWith('n_0') && /^n_[0-9a-z]{13,}$/.test(x); })());
  } catch (e) {
    ok('suite ran without throwing', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e));
  } finally {
    try { setLocale('en'); } catch (e) { /* ignore */ }
  }

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
