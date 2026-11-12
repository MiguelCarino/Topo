// @realtime — a merge is committed with its log entry chained (Web Crypto
// digests) and the waiting copies sit in the key store (IndexedDB).
// Provider visits through the owner, by link and file (docs/SCOPE.md step 7,
// phase 7b: D139, D153, D180-D190; js/visits.js):
//   1. what a copy brings: the visits nobody has decided on (a 'decision'
//      entry answers them), the provider, the report, the count;
//   2. Visits waiting: copies from two providers wait at once, oldest
//      first; a second Record visit for the same provider and report
//      replaces the first copy ("2 visits"); the landing line; the Problems
//      tab's list and its Review… button;
//   3. every visit opens the review, whose foot asks the two questions: an
//      approval with Successful closes the report, its note the close note,
//      the merge and the 'decision' entry one undo step; the second copy
//      merges against the network as the first approval left it, a field
//      both changed asked, never overwritten; Not successful opens the report
//      one round up with the note; Undecided leaves it Visited;
//   4. a rejected copy applies nothing, is logged ("Visit by X rejected:
//      note") and is kept as a file; Cancel keeps a copy waiting;
//   5. a binder site with a visit to decide on is never merged on its own;
//   6. the outside-their-items marking (js/merge.js scope): left out by
//      default, applied when chosen; the row's question in the dialog;
//   7. the dialog's foot in the browser; format v19 (the decision kind, the
//      v18 -> v19 migration); every new string in es, pt-BR, ja and ru;
//  10. a copy whose visits were answered through a newer copy (which held
//      them too) leaves the list with the decision, and reviewing one left
//      behind opens nothing (review of 7b, D191).
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 500) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const el = (id) => document.getElementById(id);
  try {
    await until(() => !!window.TopoVisits && !!window.CarinoRevisions && typeof mergeContext === 'function');
    const V = window.TopoVisits, RV = window.CarinoRevisions;
    setLocale('en');
    RV.releaseRevisionStore();
    RV._reset();
    await RV.openRevisionStore(null);
    V._reset();
    const downloads = [];
    V.hooks.download = (payload, name) => downloads.push({ payload, name });
    setDialogResponder(() => true);

    const N = (id, name, extra = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    const inc = (id, routedTo) => ({ id, at: 1, status: 'sent', symptom: 'internet', nodeIds: ['pc'], routedTo, sentAt: 2 });
    const net = { v: DOC_VERSION,
      providers: [{ id: 'pA', name: 'Andes IT', service: 'it' }, { id: 'pB', name: 'Fibra Norte', service: 'internet' }],
      nodes: [N('rt', 'Router', { type: 'router', providers: ['pB'] }), N('sw', 'Switch', { type: 'switch', providers: ['pA'] }), N('pc', 'PC', { providers: ['pA'] })],
      links: [{ id: 'l1', source: 'rt', target: 'sw' }, { id: 'l2', source: 'sw', target: 'pc' }],
      incidents: [inc('incA', ['pA']), inc('incB', ['pB'])] };
    replaceDocument(clone(net), { origin: 'default' });
    const K = claimDocument('Clinic', null);
    ok('a kept network with two reports sent', !!libraryEntry(K) && state.libraryId === K);
    const sent = stampCard(K, 'export');
    const base = clone(libraryEntry(K).doc);
    let seq = 0;
    // A copy coming back: the base as it left, edited, with a visit entry.
    const copyBack = (pid, who, incId, edit, prev) => {
      const d = clone(prev ? prev.doc : base);
      edit(d);
      const p = d.providers.find((x) => x.id === pid);
      const e = visitLogEntry({ id: 'lg_v' + (++seq) + randomToken().slice(0, 6), at: Date.now() + seq, incidentId: incId, providerId: pid, provider: p.name, by: who,
        outcome: 'fixed', changes: { counts: { added: 0, changed: 1, removed: 0 } } });
      d.log = (d.log || []).concat([e]);
      const x = d.incidents.find((i) => i.id === incId);
      x.visits = (x.visits || []).concat([e.id]);
      x.status = 'visited';
      return { doc: d, entry: e, ident: { id: K, updated: Date.now(), rev: randomToken(), base: sent.rev, prior: prev ? [prev.ident.rev] : [] } };
    };

    // ---- 1. What a copy brings ----
    const a1 = copyBack('pA', 'Juan Pérez', 'incA', (d) => { d.nodes.find((n) => n.id === 'sw').name = 'Core switch'; d.nodes.find((n) => n.id === 'rt').notes = 'by Andes'; });
    const info1 = V.visitReviewInfo(a1.doc, libraryEntry(K).doc);
    ok('1.1 a copy with a visit nobody decided on', !!info1 && info1.count === 1 && info1.providerId === 'pA' && info1.provider === 'Andes IT' && info1.visitBy === 'Juan Pérez'
       && info1.incidentId === 'incA' && info1.symptom === 'internet' && info1.changes === 1, show(info1));
    ok('1.2 a copy with nothing new: no visit', V.visitReviewInfo(base, libraryEntry(K).doc) === null);
    const decided = clone(a1.doc);
    decided.log.push(decisionLogEntry({ id: 'lg_dec0', at: 5, visits: [a1.entry.id], result: 'rejected', outcome: 'undecided' }));
    ok('1.3 a visit a decision answers is history, not one to decide', V.visitReviewInfo(decided, libraryEntry(K).doc) === null);

    // ---- 2. Visits waiting ----
    await V.visitKeepWaiting({ targetId: K, theirs: a1.doc, ident: a1.ident, source: 'link' }, info1);
    await tick();
    const b1 = copyBack('pB', 'Beto', 'incB', (d) => { d.nodes.find((n) => n.id === 'sw').name = 'Edge switch'; d.nodes.find((n) => n.id === 'rt').name = 'Fibra router'; });
    await V.visitKeepWaiting({ targetId: K, theirs: b1.doc, ident: b1.ident, source: 'topo_clinic_2026-11-11.json', fileName: 'topo_clinic_2026-11-11.json' }, V.visitReviewInfo(b1.doc, libraryEntry(K).doc));
    let rows = V.visitsWaitingFor(K);
    ok('2.1 two providers\' copies wait at once, oldest first', rows.length === 2 && rows[0].info.providerId === 'pA' && rows[1].info.providerId === 'pB', show(rows.map((r) => r.info.providerId)));
    // A second Record visit by Andes IT on the same report: it replaces the first.
    const a2 = copyBack('pA', 'Juan Pérez', 'incA', (d) => { d.nodes.find((n) => n.id === 'pc').name = 'Reception PC'; }, a1);
    const info2 = V.visitReviewInfo(a2.doc, libraryEntry(K).doc);
    await V.visitKeepWaiting({ targetId: K, theirs: a2.doc, ident: a2.ident, source: 'link' }, info2);
    rows = V.visitsWaitingFor(K);
    const rowA = rows.find((r) => r.info.providerId === 'pA');
    ok('2.2 one copy per provider and report: the second replaces the first', rows.length === 2 && rowA.rec.replaced === 1 && rowA.info.count === 2, show(rows.map((r) => [r.info.providerId, r.info.count])));
    ok('2.3 the landing line', V.landingVisitsText(K) === 'Visits waiting: 2');
    renderIncidentsPanel();
    showConfigTab('incidents');
    renderIncidentsPanel();
    const box = el('visitsWaiting');
    ok('2.4 the Problems tab lists them, each with Review…', !box.classList.contains('hidden') && box.querySelectorAll('.vw-row').length === 2
       && /Visits waiting: 2/.test(box.textContent) && /Juan Pérez \(Andes IT\) · No internet/.test(box.textContent) && /2 visits/.test(box.textContent)
       && box.querySelectorAll('button.vw-review').length === 2, box.textContent.slice(0, 300));
    ok('2.5 the file name says where a copy came from', /topo_clinic_2026-11-11\.json/.test(box.textContent));

    // ---- 3. Reviewed in turn ----
    let req = null, answer = null;
    setMergeResponder((r) => { req = r; return answer; });
    answer = { $visit: { changes: 'apply', outcome: 'successful', note: 'All good now' } };
    const logLen = () => (libraryEntry(K).doc.log || []).length;
    const before1 = logLen();
    let res = await V.reviewWaitingVisit(rowA.key);
    let card = libraryEntry(K).doc;
    ok('3.1 the review opened with the visit (two visits in the copy)', !!req && !!req.visit && req.visit.count === 2 && req.plan.mode === 'three-way', show(req && req.visit && req.visit.ids));
    ok('3.2 approved: the edits in', res.ok && card.nodes.find((n) => n.id === 'sw').name === 'Core switch' && card.nodes.find((n) => n.id === 'pc').name === 'Reception PC');
    const incA = () => libraryEntry(K).doc.incidents.find((x) => x.id === 'incA');
    ok('3.3 Successful: the report is marked fixed, the note its close note', incA().status === 'closed' && incA().closedNote === 'All good now' && incA().visits.length === 2, show(incA()));
    const tail = card.log.slice(-2);
    ok('3.4 a merge entry, then the decision, answering both visits', logLen() === before1 + 4 && tail[0].kind === 'merge' && tail[1].kind === 'decision' && tail[1].result === 'approved'
       && tail[1].outcome === 'successful' && show(tail[1].visits) === show([a1.entry.id, a2.entry.id]) && tail[1].provider === 'Andes IT' && tail[1].visitBy === 'Juan Pérez', show(tail));
    ok('3.5 the log reads it and verifies', logEntryText(tail[1]) === 'Visit by Juan Pérez (Andes IT) approved: Successful.' && (await TopoMerge.verifyLog(card.log)) === -1, logEntryText(tail[1]));
    ok('3.6 it waits no more', V.visitsWaitingFor(K).length === 1);
    undo();
    ok('3.7 one undo step takes the merge and the decision back', state.nodes.find((n) => n.id === 'sw').name === 'Switch' && !(state.log || []).some((e) => e.kind === 'decision')
       && state.incidents.find((x) => x.id === 'incA').status === 'sent');
    redo();
    flushAutosave();
    ok('3.8 and redo brings both', state.nodes.find((n) => n.id === 'sw').name === 'Core switch' && (state.log || []).some((e) => e.kind === 'decision'));
    renderIncidentsPanel();
    ok('3.9 the Problems tab shows the answer under the visit', [...el('incidentList').querySelectorAll('.pm-visit-decision')].some((x) => x.textContent === 'Visit by Juan Pérez (Andes IT) approved: Successful.'));

    // The second copy: merged against the network as the first approval left
    // it. Both changed the switch's name: a question, mine kept by default.
    answer = { $visit: { changes: 'apply', outcome: 'not-successful', note: 'The router still drops' } };
    req = null;
    res = await V.reviewWaitingVisit(V.visitsWaitingFor(K)[0].key);
    card = libraryEntry(K).doc;
    const swItem = req && req.plan.items.find((it) => it.key === 'nodes:sw');
    ok('3.10 a field both providers changed is asked in the second review', !!swItem && swItem.status === 'conflict' && swItem.fields.some((f) => f.field === 'name' && f.conflict && f.mine === 'Core switch' && f.theirs === 'Edge switch'),
       show(swItem && swItem.fields));
    ok('3.11 never an overwrite: the first approval\'s name stays; the rest of theirs comes in', res.ok && card.nodes.find((n) => n.id === 'sw').name === 'Core switch' && card.nodes.find((n) => n.id === 'rt').name === 'Fibra router');
    const incB = () => libraryEntry(K).doc.incidents.find((x) => x.id === 'incB');
    ok('3.12 Not successful: the report open again, one round up', incB().status === 'open' && incB().reopened === 1 && !incB().closedAt, show(incB()));
    const decB = card.log[card.log.length - 1];
    ok('3.13 with the note for the provider in the decision', decB.kind === 'decision' && decB.outcome === 'not-successful' && decB.note === 'The router still drops' && decB.providerId === 'pB');
    ok('3.14 nothing waits now', V.visitsWaitingFor(K).length === 0 && V.landingVisitsText(K) === '');

    // Undecided: the report stays Visited.
    const b2 = copyBack('pB', 'Beto', 'incB', (d) => { d.nodes.find((n) => n.id === 'pc').notes = 'checked'; }, { doc: clone(libraryEntry(K).doc), ident: { rev: randomToken() } });
    answer = { $visit: { changes: 'apply', outcome: 'undecided', note: '' } };
    res = await mergeCopyInto(K, b2.doc, { ident: b2.ident, source: 'link', reason: 'Before merging a link' });
    ok('3.15 Undecided: the report stays as the visit left it (Visited)', res.ok && incB().status === 'visited' && libraryEntry(K).doc.log.slice(-1)[0].outcome === 'undecided', show(incB()));

    // ---- 4. Rejected, and Cancel ----
    const nodesBefore = show(libraryEntry(K).doc.nodes);
    const c1 = copyBack('pA', 'Juan Pérez', 'incA', (d) => { d.nodes.find((n) => n.id === 'rt').name = 'Hacked name'; d.nodes.push(N('x9', 'Extra')); }, { doc: clone(libraryEntry(K).doc), ident: { rev: randomToken() } });
    answer = { $visit: { changes: 'reject', outcome: 'undecided', note: 'Not agreed with us' } };
    downloads.length = 0;
    res = await mergeCopyInto(K, c1.doc, { ident: c1.ident, source: 'link', reason: 'Before merging a link' });
    card = libraryEntry(K).doc;
    const decR = card.log[card.log.length - 1];
    ok('4.1 a rejected copy applies nothing', res.ok && res.rejected && show(card.nodes) === nodesBefore && !card.log.some((e) => e.id === c1.entry.id));
    ok('4.2 it is logged: "Visit by X rejected: note"', decR.kind === 'decision' && decR.result === 'rejected' && logEntryText(decR) === 'Visit by Juan Pérez (Andes IT) rejected: Not agreed with us', logEntryText(decR));
    ok('4.3 and its copy kept as a file, named in the entry', downloads.length === 1 && /_rejected-visit\.json$/.test(downloads[0].name) && decR.file === downloads[0].name
       && downloads[0].payload.doc.nodes.some((n) => n.name === 'Hacked name'), show(downloads.map((d) => d.name)));
    ok('4.4 the rejected visit is history: it is not asked again', V.visitReviewInfo(c1.doc, card) === null);
    // Cancel: the copy stays in Visits waiting.
    const c2 = copyBack('pB', 'Beto', 'incB', (d) => { d.nodes.find((n) => n.id === 'pc').notes = 'again'; }, { doc: clone(libraryEntry(K).doc), ident: { rev: randomToken() } });
    answer = null;
    res = await mergeCopyInto(K, c2.doc, { ident: c2.ident, source: 'link', reason: 'Before merging a link' });
    await tick();
    ok('4.5 Cancel: nothing merged, the copy waits', !res.ok && V.visitsWaitingFor(K).length === 1 && V.visitsWaitingFor(K)[0].info.providerId === 'pB');
    // It survives the page: read back from the key store.
    V._reset();
    await V.vwLoad();
    ok('4.6 kept in the key store, read back after a reload', V.visitsWaitingFor(K).length === 1);
    await V.vwDel(V.visitsWaitingFor(K)[0].key);

    // ---- 5. A binder site with a visit is asked, never merged on its own ----
    const rowsB = await TopoMergeDoors.classifyBinderSites([{ id: K, name: 'Clinic', updated: Date.now(), rev: c2.ident.rev, base: sent.rev, doc: c2.doc }]);
    ok('5.1 a binder site with a visit to decide on: asked, not auto', rowsB.length === 1 && rowsB[0].kind === 'ask' && rowsB[0].reason === 'A visit to review', show(rowsB.map((r) => [r.kind, r.reason])));

    // ---- 6. Outside what the provider covers (js/merge.js scope) ----
    const mine6 = clone(libraryEntry(K).doc);
    const theirs6 = clone(mine6);
    theirs6.nodes.find((n) => n.id === 'pc').name = 'PC by Andes';     // inside (pA covers pc)
    theirs6.nodes.find((n) => n.id === 'rt').name = 'Router by Andes'; // outside (pB's)
    theirs6.nodes.push(N('new1', 'New AP'));                           // added: inside
    theirs6.report = { client: 'Changed client' };                     // outside
    const scope = V.visitScope(theirs6, mine6, 'pA');
    ok('6.1 what Andes IT covers', scope.name === 'Andes IT' && scope.nodes.has('pc') && scope.nodes.has('sw') && !scope.nodes.has('rt') && scope.incidents.has('incA') && !scope.incidents.has('incB'), show([...scope.nodes]));
    const plan6 = planMerge(mine6, theirs6, mine6, { scope });
    const it = (key) => plan6.items.find((x) => x.key === key);
    ok('6.2 the plan marks the router and the header outside, not the PC or the new device', it('nodes:rt').outside === true && it('report:report').outside === true && !it('nodes:pc').outside && !it('nodes:new1').outside,
       show(plan6.items.filter((x) => x.outside).map((x) => x.key)));
    let r6 = applyMergePlan(mine6, plan6, {});
    ok('6.3 left out by default', r6.doc.nodes.find((n) => n.id === 'rt').name !== 'Router by Andes' && r6.doc.nodes.find((n) => n.id === 'pc').name === 'PC by Andes'
       && !!r6.doc.nodes.find((n) => n.id === 'new1') && (r6.doc.report || {}).client !== 'Changed client');
    r6 = applyMergePlan(mine6, plan6, { 'nodes:rt@outside': 'apply' });
    ok('6.4 applied when the owner chooses', r6.doc.nodes.find((n) => n.id === 'rt').name === 'Router by Andes' && (r6.doc.report || {}).client !== 'Changed client');
    ok('6.5 a scope no provider holds: every existing item outside', planMerge(mine6, theirs6, mine6, { scope: V.visitScope(theirs6, mine6, 'nobody') }).items.find((x) => x.key === 'nodes:pc').outside === true);

    // ---- 7. The dialog's foot in the browser ----
    setMergeResponder(null);
    const d7 = copyBack('pA', 'Juan Pérez', 'incA', (d) => { d.nodes.find((n) => n.id === 'rt').name = 'Router by Andes'; }, { doc: clone(libraryEntry(K).doc), ident: { rev: randomToken() } });
    const info7 = V.visitReviewInfo(d7.doc, libraryEntry(K).doc);
    const p7 = openMergeReview({ targetId: K, theirs: d7.doc, base: clone(libraryEntry(K).doc), source: 'server', reason: 'Before merging from the server', scope: V.visitScope(d7.doc, null, 'pA'), visit: info7 });
    await until(() => TopoMergeUI.mergeDialogOpen());
    const foot = el('mergeVisit');
    const pressed = (sel) => [...foot.querySelectorAll(sel)].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
    ok('7.1 the foot shows the two questions, Apply and Undecided pressed', !foot.hidden && el('mergeVisitHead').textContent.includes('A visit by Juan Pérez (Andes IT) waits for your decision.')
       && show(pressed('[data-visit-changes]')) === '["Apply as reviewed"]' && show(pressed('[data-visit-outcome]')) === '["Undecided"]', el('mergeVisitHead').textContent);
    ok('7.2 the outside row asks, Leave it out pressed', [...el('mergeList').querySelectorAll('.merge-outside')].some((x) => x.textContent.includes('Outside what Andes IT covers.')
       && [...x.querySelectorAll('button')].find((b) => b.textContent === 'Leave it out').getAttribute('aria-pressed') === 'true'));
    foot.querySelector('[data-visit-changes="reject"]').click();
    ok('7.3 Reject: the button says so, the note says the copy is kept', el('mergeApplyBtn').textContent === 'Reject the changes' && /kept as a file/.test(el('mergeVisitSays').textContent));
    foot.querySelector('[data-visit-outcome="successful"]').click();
    ok('7.4 Successful: the report is marked fixed (said)', /marked fixed/.test(el('mergeVisitSays').textContent) && show(pressed('[data-visit-outcome]')) === '["Successful"]');
    el('mergeVisitNote').value = 'typed'; el('mergeVisitNote').dispatchEvent(new Event('input', { bubbles: true }));
    ok('7.5 the note is kept', TopoMergeUI.review().visit.note === 'typed');
    el('mergeCancelBtn').click();
    const r7 = await p7;
    ok('7.6 Cancel closes it with nothing done', !r7.ok && !TopoMergeUI.mergeDialogOpen());

    // ---- 8. Format v19 ----
    const de = decisionLogEntry({ id: 'lg_d1', at: 9, visits: ['lg_a', 'lg_a', 'bad id!'], incidentId: 'incA', providerId: 'pA', provider: 'Andes IT', visitBy: 'Juan', by: 'Owner',
      result: 'approved', outcome: 'successful', note: 'ok', file: 'f.json', junk: 1 });
    ok('8.1 a decision entry keeps its fields only', de.kind === 'decision' && show(de.visits) === '["lg_a"]' && de.result === 'approved' && de.outcome === 'successful' && !('junk' in de)
       && de.summary === 'Visit by Juan approved: successful.', show(de));
    ok('8.2 an unknown result or outcome is dropped', !('result' in normalizeLogEntry(Object.assign({}, de, { result: 'maybe' }))) && !('outcome' in normalizeLogEntry(Object.assign({}, de, { outcome: 'fixed' }))));
    const m18 = migrateDoc({ v: 18, nodes: [], log: [] });
    ok('8.3 v18 -> v20: nothing to convert', DOC_VERSION === 20 && m18.doc.v === 20 && m18.from === 18 && !m18.newer);

    // ---- 10. A copy answered through a newer one (D191) ----
    const e1 = copyBack('pA', 'Juan Pérez', 'incA', (d) => { d.nodes.find((n) => n.id === 'pc').notes = 'first visit'; }, { doc: clone(libraryEntry(K).doc), ident: { rev: randomToken() } });
    const e1info = V.visitReviewInfo(e1.doc, libraryEntry(K).doc);
    await V.visitKeepWaiting({ targetId: K, theirs: e1.doc, ident: e1.ident, source: 'link' }, e1info);
    const e2 = copyBack('pA', 'Juan Pérez', 'incB', (d) => { d.nodes.find((n) => n.id === 'rt').notes = 'second report'; }, e1);
    await V.visitKeepWaiting({ targetId: K, theirs: e2.doc, ident: e2.ident, source: 'link' }, V.visitReviewInfo(e2.doc, libraryEntry(K).doc));
    ok('10.1 two copies wait: one per report', V.visitsWaitingFor(K).length === 2);
    setMergeResponder(() => ({ $visit: { changes: 'apply', outcome: 'undecided', note: '' } }));
    res = await V.reviewWaitingVisit(V.visitsWaitingFor(K).find((r) => r.info.incidentId === 'incB').key);
    ok('10.2 deciding the newer copy answers the older one too: nothing waits', res.ok && V.visitsWaitingFor(K).length === 0, show(V.visitsWaitingFor(K).map((r) => r.info.incidentId)));
    // One left behind (another tab kept it): reviewing it opens nothing.
    await V.visitKeepWaiting({ targetId: K, theirs: e1.doc, ident: e1.ident, source: 'link' }, e1info);
    let opened10 = false;
    setMergeResponder(() => { opened10 = true; return null; });
    res = await V.reviewWaitingVisit(V.visitsWaitingFor(K)[0].key);
    ok('10.3 a copy already answered leaves the list without a review', res.reason === 'decided' && !opened10 && V.visitsWaitingFor(K).length === 0, show(res));
    setMergeResponder(null);

    // ---- 9. Every new string translated ----
    const strings = ['A visit waits for your review', 'Visits waiting: {n}', 'Nothing a provider changed is applied until you review it.', 'Review the visit', 'A visit to review',
      'Visit by {who} approved: {outcome}.', 'Visit by {who} rejected: {note}', 'Visit by {who} rejected.', 'Successful', 'Not successful', 'Undecided', 'Outside what {name} covers.',
      'Leave it out', 'Apply it', 'Reject the changes', 'Save the decision', 'Apply as reviewed', 'Reject: apply nothing', 'The changes', 'The visit', 'A note for the provider (optional)',
      'Visit approved.', 'Visit rejected: nothing was applied. Its copy was kept as the file {file}.', 'By link', '{n} visits', 'A provider', '1 change', '{n} changes',
      'This visit was already answered.', 'This change came in a visit you rejected before.', 'Whoever recorded this visit is no longer a provider on this site, so it cannot be reviewed.'];
    const missing = [];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((lang) => { setLocale(lang); strings.forEach((s) => { if (t(s) === s) missing.push(`${lang}: ${s}`); }); });
    setLocale('en');
    ok('9.1 every new string in es, pt-BR, ja and ru', !missing.length, missing.join(' | '));
  } catch (e) {
    ok('the suite ran to the end', false, (e && e.stack) || String(e));
  }
  setMergeResponder(null);
  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
