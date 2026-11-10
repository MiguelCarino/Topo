// @realtime — the links are locked and the log's hash chain awaits Web Crypto.
// The client-provider loop end to end, in one page (docs/SCOPE.md step 4,
// stage 5):
//   1. the client reports "No internet" on a PC: it routes to the ISP first;
//      Send keeps the network as a card (K) and makes a locked link; the
//      client's side shows it: the Problems tab (count, row, Send again and
//      Mark fixed), the map's ! on the device (never in the SVG export), the
//      landing card's Open problems line and its ⚠ tool, the Simple views'
//      lists (nothing selected: every open one; the device selected: its own),
//      in Spanish too;
//   2. a provider opens the link in a fresh state (no card, no session);
//   3. "I am the provider", renames the router, adds a switch, records the
//      visit (Fixed, with what changed) and makes the copy back, locked with
//      the same passphrase;
//   4. the client opens what came back: the visited banner; Merge into my
//      network is three-way from the revision the provider received; the
//      review shows the report's row in plain words ("Now: Visited") and the
//      visit under the rows; after it, the rename and the switch are in K,
//      the report is visited with its visit, the log holds opened, sent,
//      visit and merge, chained;
//   5. Mark fixed (the Problems tab's button, a note asked): closed, a log
//      entry, the marker gone; Reopen: open, reopened 1, the closure cleared;
//      a two-way merge with the old closed copy keeps it open; the report's
//      Problems and visits section prints it; the network log says it in words;
//   6. two providers from one link: each records a visit with different
//      edits and one field both changed; merged one after the other into K,
//      three-way: both edits in, the field both changed asks (yours by
//      default), the report visited with both visits, both in the log.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 500) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const el = (id) => document.getElementById(id);
  const visible = (id) => { const x = el(id); return !!x && !x.classList.contains('hidden') && !x.hidden && getComputedStyle(x).display !== 'none'; };
  await until(() => !!window.TopoProviderMode && !!window.TopoIncidents && !!window.TopoMergeUI && typeof canSeal === 'function');
  const PM = window.TopoProviderMode;
  const TI = window.TopoIncidents;
  const MU = window.TopoMergeUI;
  const RV = window.CarinoRevisions;
  const R = window.CarinoRestore;
  const H = TI.hooks;

  // The questions: Keep this network over a card answers Merge; a note
  // asked for is `promptAnswer`.
  let promptAnswer = '';
  const asked = [];
  const heldResponder = setDialogResponder((req) => {
    asked.push(req);
    if (req.kind === 'choice') return req.choices.some((c) => c.id === 'merge') ? 'merge' : null;
    if (req.kind === 'prompt') return promptAnswer;
    if (req.kind === 'confirm') return true;
    return undefined;
  });
  // The merge review, drawn for real: its rows and notes read, then Apply.
  const reviews = [];
  let heldMerge = null;
  const reviewer = (req) => {
    MU.setMergeResponder(null);
    const p = MU.showMergeReview(req);
    const rows = [...el('mergeList').querySelectorAll(':scope > .merge-row')].map((r) => ({
      kind: r.querySelector('.merge-kind').textContent, label: r.querySelector('.merge-label').textContent, text: r.textContent
    }));
    const notes = [...el('mergeNotes').querySelectorAll('li')].map((li) => li.textContent);
    reviews.push({ req, rows, notes, mode: req.plan.mode });
    el('mergeApplyBtn').click();
    MU.setMergeResponder(reviewer);
    return p;
  };
  heldMerge = MU.setMergeResponder(reviewer);

  const held = { open: H.open, copy: H.copy, share: H.share, canShare: H.canShare, saveBlob: window.saveBlob, now: H.now };
  const heldLib = CarinoLibrary.loadLibrary();
  const heldSettings = clone(state.settings);
  const opened = [], copied = [], saved = [];
  H.open = (u) => opened.push(u);
  H.copy = async (s) => { copied.push(s); };
  H.canShare = () => false;
  window.saveBlob = (blob, name) => { saved.push({ blob, name }); };

  // In-memory restore points and revisions, so nothing of this suite stays
  // in the browser's stores.
  const restoreAdapter = {
    open: async () => [],
    readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = []; }); return o; },
    readDoc: async () => null,
    write: () => Promise.resolve(true)
  };
  const revDisk = new Map();
  const revAdapter = {
    open: async () => [...revDisk.values()].map((r) => clone(r.meta)),
    readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = [...revDisk.values()].filter((r) => r.meta.cardId === id).map((r) => clone(r.meta)); }); return o; },
    readDoc: async (id) => (revDisk.has(id) ? clone(revDisk.get(id).doc) : null),
    write: (ops) => { ops.put.forEach((p) => revDisk.set(p.meta.id, { meta: clone(p.meta), doc: clone(p.doc) })); ops.del.forEach((id) => revDisk.delete(id)); return Promise.resolve(true); },
    dropCard: async () => true
  };

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({
    v: DOC_VERSION,
    report: { client: 'Clinica Sol', site: 'Reception' },
    providers: [
      { id: 'pI', name: 'Fibra Norte', service: 'internet', phone: '+52 55 1234 5678', email: 'noc@fibra.example', hours: '24/7' },
      { id: 'pT', name: 'Andes IT', service: 'it', phone: '555-0100', email: 'help@andes.example' }
    ],
    groups: [{ id: 'gB', name: 'Office', kind: 'building', providers: ['pT'] }],
    nodes: [
      N('isp', 'cloud', { name: 'Internet', providers: ['pI'], x: 0, y: 0 }),
      N('rt', 'router', { name: 'Router', x: 0, y: 100 }),
      N('sw', 'switch', { name: 'Switch', x: 0, y: 200, group: 'gB' }),
      N('pc', 'pc', { name: 'Reception PC', x: -100, y: 300, group: 'gB' })
    ],
    links: [{ id: 'l1', source: 'isp', target: 'rt' }, { id: 'l2', source: 'rt', target: 'sw' }, { id: 'l3', source: 'sw', target: 'pc' }]
  });
  const K = 'lp-net';
  const PASS = 'loop-pass-word-123';
  const clearSessions = () => { try { Object.keys(sessionStorage).filter((k) => /^topo_(provider|incbanner)_/.test(k)).forEach((k) => sessionStorage.removeItem(k)); } catch (e) { /* none */ } };
  const fragOf = (url) => url.slice(url.indexOf('#') + 1);
  const unseal = async (url) => (await unsealFragment(fragOf(url), PASS)).json;
  const incOf = (id) => (state.incidents || []).find((x) => x.id === id) || null;
  const lastLog = (id) => { const log = (libraryEntry(id) || { doc: {} }).doc.log || []; return log[log.length - 1] || null; };
  // A provider: the link opened in a fresh state, provider mode, the work,
  // the visit, the copy back. -> { entry, url }.
  let clientRevs = null;   // the client's revisions while a provider works on another device
  async function providerVisit(url, incId, providerId, by, work) {
    CarinoLibrary.persistLibrary({});
    clearSessions();
    if (PM.state.on) PM.leaveProviderMode();
    // Another device: none of the client's revisions, on disk or in the tab.
    await RV.revisionsFlushed();
    if (!clientRevs) clientRevs = new Map(revDisk);
    RV.releaseRevisionStore(); RV._reset(); revDisk.clear(); await RV.openRevisionStore(revAdapter);
    const json = await unseal(url);
    _arrivalPass = PASS;
    openArrivedDocument(json);
    const fresh = state.docId === K && !isKept() && !libraryEntry(K);
    PM.enterProviderMode(incId);
    const sessionOf = () => { try { return JSON.parse(sessionStorage.getItem('topo_provider_' + K) || 'null'); } catch (e) { return null; } };
    const arrivalHeld = await until(() => !!(sessionOf() || {}).arrivalJson);
    // A reload: this tab's revisions are gone, only the session holds the copy received.
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(revAdapter);
    const storeMiss = !(await findBase([PM.state.session.arrivalRev]));
    batch(() => { work(); save(); });
    renderCanvasOnly();
    const changes = PM.visitChangesOf(await PM.visitBaseDoc(), serializeDoc());
    const entry = await PM.recordVisit({ incidentId: incId, providerId, by, outcome: 'fixed', notes: `Visit by ${by}.`, changes });
    const back = await PM.buildVisitReturn(PASS);
    PM.leaveProviderMode();
    return { entry, url: back.ok ? back.url : null, fresh, why: back.why, arrivalHeld, storeMiss };
  }
  // The client: K back in the library, the copy opened, Merge into my network.
  async function clientMerges(lib, url) {
    CarinoLibrary.persistLibrary(lib);
    // Back to the client's device: its revisions again (opened once its
    // cards are back, or the store would drop them as cards no longer here).
    if (clientRevs) {
      RV.releaseRevisionStore(); RV._reset(); clientRevs.forEach((v, k) => revDisk.set(k, v)); clientRevs = null;
      await RV.openRevisionStore(revAdapter);
    }
    clearSessions();
    const json = await unseal(url);
    openArrivedDocument(json);
    const banner = visible('incidentBanner') ? el('incidentBannerText').textContent : '';
    const go = el('incidentBannerGo').textContent;
    const theirs = JSON.parse(json);
    const ctx = await mergeContext(K, theirs, docIdentity(theirs));
    const n = reviews.length;
    await PM.incidentBannerGo();
    await until(() => state.libraryId === K && reviews.length > n);
    return { banner, go, ctx, review: reviews[n] || null };
  }

  try {
    setLocale('en');
    clearSessions();
    R._reset(); await R.openRestoreStore(restoreAdapter);
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(revAdapter);
    CarinoLibrary.persistLibrary({});
    state.settings.advanced = true;
    saveSettings(); applyProfile();

    // ---- 1. The client reports and sends ----
    replaceDocument(site(), { origin: 'file', docId: K });
    const route = routeIncident(undefined, { nodeIds: ['pc'], symptom: 'internet' }, { now: new Date(Date.UTC(2026, 10, 9, 15)) });
    ok('1.1 No internet on the PC routes to the ISP first, IT support after', route.results[0] && route.results[0].provider.id === 'pI' && route.results.some((r) => r.provider.id === 'pT'),
       show(route.results.map((r) => r.provider.id)));
    const incId = await TI.createIncident({ symptom: 'internet', nodeIds: ['pc'], text: 'Nothing loads since 9.', name: 'Ana', phone: '555-1', email: 'ana@x.example', routedTo: ['pI'] });
    ok('1.2 the report is saved, the network kept as card K', !!incId && state.libraryId === K && !!libraryEntry(K) && incOf(incId).status === 'open');
    const sent = await TI.sendIncident(incId, { providerIds: ['pI'], passphrase: PASS });
    ok('1.3 sent: a locked link, the report sent', sent.ok && sent.why === 'link' && !!sent.url && incOf(incId).status === 'sent', show(sent.why));
    ok('1.4 the log: opened, then sent', show(state.log.filter((e) => e.kind === 'incident').map((e) => e.event)) === '["opened","sent"]');
    const clientLib = CarinoLibrary.loadLibrary();
    const clientRev = (clientLib[K] || {}).rev;
    ok('1.5 the card names the revision that left', !!clientRev);
    // The client's side, before anyone comes.
    renderCanvasOnly();
    ok('1.6 the Problems tab shows, counting the one open', visible('incTabBtn') && el('incTabCount').textContent === '1');
    TI.openIncidentsView();
    ok('1.7 it opens on its list', el('incTabBtn').getAttribute('aria-selected') === 'true' && visible('cfgPanel-incidents'));
    let rowsTab = [...el('incidentList').querySelectorAll('.inc-row')];
    ok('1.8 one row: Sent, what, where, whom it went to, the words', rowsTab.length === 1 && rowsTab[0].querySelector('.pm-status').textContent === 'Sent'
       && rowsTab[0].textContent.includes('No internet') && rowsTab[0].textContent.includes('Reception PC') && rowsTab[0].textContent.includes('Sent to: Fibra Norte')
       && rowsTab[0].textContent.includes('Nothing loads since 9.'), rowsTab[0] && rowsTab[0].textContent);
    ok('1.9 its actions: Send again and Mark fixed, no Reopen', !!rowsTab[0].querySelector('[data-inc-act="send"]') && !!rowsTab[0].querySelector('[data-inc-act="fix"]') && !rowsTab[0].querySelector('[data-inc-act="reopen"]'));
    ok('1.10 the device has the ! on the map, the others not', !!document.querySelector('#ui-node-pc .node-problem') && !document.querySelector('#ui-node-rt .node-problem'));
    const svg = (canvasSvgMarkup() || {}).markup;
    ok('1.11 the ! is not in the SVG export', typeof svg === 'string' && svg.includes('Reception PC') && !svg.includes('node-problem'));
    rowsTab[0].querySelector('[data-inc-act="send"]').click();
    await until(() => TI.draft.open && TI.draft.stage === 'send');
    ok('1.12 Send again opens the send step for it', TI.draft.open && TI.draft.incidentId === incId && TI.draft.stage === 'send');
    TI.closeProblemDialog();
    // The landing card.
    openLanding(false);
    const face = document.querySelector(`.landing-card[data-id="${K}"] .landing-card-problems`);
    ok('1.13 the landing card says Open problems: how many, the newest', !!face && /^⚠ Open problems: 1 · newest No internet, .+/.test(face.textContent), face && face.textContent);
    const warnTool = [...document.querySelectorAll(`.landing-card[data-id="${K}"] .landing-tool`)].find((b) => b.textContent === '⚠');
    ok('1.14 with a ⚠ tool', !!warnTool && warnTool.title === 'Problems');
    showConfigTab('config');
    warnTool.click();
    await until(() => !landingIsOpen() && el('incTabBtn').getAttribute('aria-selected') === 'true');
    ok('1.15 which opens the network on its Problems tab', !landingIsOpen() && state.libraryId === K && el('incTabBtn').getAttribute('aria-selected') === 'true');
    // The Simple view.
    state.settings.advanced = false; applyProfile();
    TI.openIncidentsView();
    ok('1.16 Simple, nothing selected: every open problem listed', visible('problemsSimpleAll') && el('problemsSimpleAll').textContent.includes('Open problems: 1')
       && el('problemsSimpleAll').textContent.includes('No internet') && !visible('incTabBtn'), el('problemsSimpleAll').textContent.slice(0, 120));
    selectEntries([{ type: 'node', id: 'pc' }]);
    ok('1.17 the PC selected: its problem in its panel, the other list hidden', visible('problemsSimple') && el('problemsSimple').textContent.includes('No internet') && !visible('problemsSimpleAll'));
    selectEntries([{ type: 'node', id: 'rt' }]);
    ok('1.18 the router selected: nothing', !visible('problemsSimple'));
    setLocale('es');
    applyLocale('es');
    selectEntries([]);
    renderCanvasOnly();
    ok('1.19 in Spanish', el('problemsSimpleAll').textContent.includes('Problemas abiertos: 1') && el('problemsSimpleAll').textContent.includes('Marcar resuelto'), el('problemsSimpleAll').textContent.slice(0, 160));
    setLocale('en');
    applyLocale('en');
    state.settings.advanced = true; applyProfile();

    // ---- 2-3. A provider, in a fresh state ----
    const A1 = await providerVisit(sent.url, incId, 'pI', 'Juan Pérez', () => {
      getNode('rt').name = 'Core router';
      state.nodes.push(N('sw2', 'switch', { name: 'New switch', x: 100, y: 200, group: 'gB' }));
    });
    ok('2.1 the provider opened the link with no card and no session', A1.fresh);
    ok('2.2 the copy received went into the session, and after a reload the changes came from it', A1.arrivalHeld && A1.storeMiss);
    ok('3.1 the visit, with what changed', !!A1.entry && A1.entry.outcome === 'fixed' && A1.entry.provider === 'Fibra Norte' && show(A1.entry.changes.counts) === '{"added":1,"changed":1,"removed":0}',
       show(A1.entry && A1.entry.changes));
    ok('3.2 the copy back is a locked link', !!A1.url && A1.why === 'link');

    // ---- 4. The client merges what came back ----
    const m1 = await clientMerges(clientLib, A1.url);
    ok('4.1 the visited banner offers the merge', /^⚠ Juan Pérez recorded a visit on .+: Fixed\.$/.test(m1.banner) && m1.go === 'Merge into my network', m1.banner);
    ok('4.2 three-way, from the revision the provider received', m1.ctx.via === 'rev' && m1.ctx.baseRev === clientRev && !!m1.review && m1.review.mode === 'three-way', `${m1.ctx.via} ${m1.review && m1.review.mode}`);
    const incRow = m1.review && m1.review.rows.find((r) => r.kind === 'Problem report');
    ok('4.3 the review: the report in plain words, where it stands now', !!incRow && incRow.label === 'No internet at Reception PC. Now: Visited', show(m1.review && m1.review.rows.map((r) => r.label)));
    ok('4.4 and the visit under the rows', !!m1.review && m1.review.notes.some((n) => /^Visit by Juan Pérez \(Fibra Norte\), .+: Fixed\. 2 changes\.$/.test(n)), show(m1.review && m1.review.notes));
    ok('4.5 merged into K: the rename and the switch', state.libraryId === K && isKept() && getNode('rt').name === 'Core router' && !!getNode('sw2'));
    ok('4.6 the report visited, its visit listed', incOf(incId).status === 'visited' && show(incOf(incId).visits) === show([A1.entry.id]), show(incOf(incId)));
    const kinds = state.log.map((e) => (e.kind === 'incident' ? e.event : e.kind));
    ok('4.7 the log: opened, sent, visit, merge', ['opened', 'sent', 'visit', 'merge'].every((k) => kinds.includes(k)) && kinds.indexOf('visit') < kinds.lastIndexOf('merge') && lastLog(K).kind === 'merge', show(kinds));
    ok('4.8 chained end to end', (await TopoMerge.verifyLog(state.log)) === -1);
    ok('4.9 the merge log says three-way', lastLog(K).mode === 'three-way');
    renderCanvasOnly();
    TI.openIncidentsView();
    rowsTab = [...el('incidentList').querySelectorAll('.inc-row')];
    ok('4.10 the Problems tab: Visited, the visit, its notes and what changed', rowsTab.length === 1 && rowsTab[0].querySelector('.pm-status').textContent === 'Visited'
       && rowsTab[0].textContent.includes('Visit by Juan Pérez (Fibra Norte)') && rowsTab[0].textContent.includes('Visit by Juan Pérez.')
       && [...rowsTab[0].querySelectorAll('.inc-changes li')].map((li) => li.textContent).includes('Added · Device: New switch'), rowsTab[0] && rowsTab[0].textContent.slice(0, 300));
    ok('4.11 the network log says them in words', logEntryText(state.log.find((e) => e.kind === 'incident' && e.event === 'sent')) === 'Problem sent to 1 provider: No internet.'
       && /^Visit by Juan Pérez \(Fibra Norte\)/.test(logEntryText(state.log.find((e) => e.kind === 'visit'))));

    // ---- 5. Mark fixed, Reopen ----
    const logN = state.log.length;
    promptAnswer = 'Cable replaced, all fine.';
    el('incidentList').querySelector('[data-inc-act="fix"]').click();
    await until(() => incOf(incId).status === 'closed');
    const closedInc = incOf(incId);
    ok('5.1 Mark fixed asks for a note, then closes it', asked.some((q) => q.kind === 'prompt' && q.title === 'Mark fixed') && closedInc.status === 'closed'
       && closedInc.closedNote === 'Cable replaced, all fine.' && Number.isFinite(closedInc.closedAt));
    ok('5.2 a closed entry in the log, chained', state.log.length === logN + 1 && state.log[logN].kind === 'incident' && state.log[logN].event === 'closed' && (await TopoMerge.verifyLog(state.log)) === -1);
    renderCanvasOnly();
    ok('5.3 the ! leaves the map, the count goes', !document.querySelector('#layer-nodes .node-problem') && el('incTabCount').classList.contains('hidden'));
    rowsTab = [...el('incidentList').querySelectorAll('.inc-row')];
    ok('5.4 the row: Fixed, its note, Reopen only', rowsTab[0].querySelector('.pm-status').textContent === 'Fixed' && rowsTab[0].textContent.includes('Cable replaced, all fine.')
       && !!rowsTab[0].querySelector('[data-inc-act="reopen"]') && !rowsTab[0].querySelector('[data-inc-act="fix"]'));
    undo();
    ok('5.5 one undo takes it back', incOf(incId).status === 'visited' && state.log.length === logN);
    redo();
    ok('5.6 redo closes it again', incOf(incId).status === 'closed' && state.log.length === logN + 1);
    const closedCopy = serializeDoc();
    openLanding(false);
    ok('5.7 no Open problems line on the card once closed', !document.querySelector(`.landing-card[data-id="${K}"] .landing-card-problems`));
    closeLanding();
    TI.openIncidentsView();
    el('incidentList').querySelector('[data-inc-act="reopen"]').click();
    await until(() => incOf(incId).status === 'open');
    const re = incOf(incId);
    ok('5.8 Reopen: open, one round up, the closure cleared', re.status === 'open' && re.reopened === 1 && re.closedAt === undefined && re.closedNote === undefined, show(re));
    ok('5.9 a reopened entry in the log', state.log[state.log.length - 1].event === 'reopened');
    const plan2 = planMerge(serializeDoc(), closedCopy, null);
    const two = applyMergePlan(serializeDoc(), plan2, {}).doc;
    const twoInc = two.incidents.find((x) => x.id === incId);
    ok('5.10 a two-way merge with the old closed copy keeps it open', plan2.mode === 'two-way' && twoInc.status === 'open' && twoInc.reopened === 1, show(twoInc));
    const sec = reportSheet(reportModel(), null, { sections: Object.assign(reportSections({}), { incidents: true }) });
    ok('5.11 the report prints the report and its visit when ticked', sec.includes('<h2>Problems and visits</h2>') && sec.includes('Nothing loads since 9.') && sec.includes('Visit by Juan Pérez (Fibra Norte)'));
    ok('5.12 and not by default', !reportSheet(reportModel(), null, {}).includes('<h2>Problems and visits</h2>'));

    // ---- 6. Two providers from one link ----
    const inc2 = await TI.createIncident({ symptom: 'phone', nodeIds: ['pc'], text: 'The phone is dead.', name: 'Ana', phone: '555-1', routedTo: ['pT', 'pI'] });
    const sent2 = await TI.sendIncident(inc2, { providerIds: ['pT', 'pI'], passphrase: PASS });
    ok('6.1 a second report, sent to two providers', sent2.ok && !!sent2.url && show(incOf(inc2).routedTo) === '["pT","pI"]');
    const lib2 = CarinoLibrary.loadLibrary();
    const rev2 = (lib2[K] || {}).rev;
    const VA = await providerVisit(sent2.url, inc2, 'pT', 'Ana Andes', () => {
      getNode('sw').name = 'Switch A';
      getNode('pc').notes = 'A note';
    });
    const VB = await providerVisit(sent2.url, inc2, 'pI', 'Beto Fibra', () => {
      state.nodes.push(N('pr', 'printer', { name: 'Printer B', x: 200, y: 300, group: 'gB' }));
      getNode('pc').notes = 'B note';
    });
    ok('6.2 both visits recorded from the same link, both sent back', VA.fresh && VB.fresh && !!VA.url && !!VB.url && VA.entry.providerId === 'pT' && VB.entry.providerId === 'pI');
    const mA = await clientMerges(lib2, VA.url);
    ok('6.3 the first merged three-way from the revision sent', mA.ctx.via === 'rev' && mA.ctx.baseRev === rev2 && mA.review && mA.review.mode === 'three-way');
    ok('6.4 its edits in', getNode('sw').name === 'Switch A' && getNode('pc').notes === 'A note' && show(incOf(inc2).visits) === show([VA.entry.id]));
    const mB = await clientMerges(CarinoLibrary.loadLibrary(), VB.url);
    ok('6.5 the second visit, on a report already visited, still gets the banner and its merge', /^⚠ Beto Fibra recorded a visit on .+: Fixed\.$/.test(mB.banner) && mB.go === 'Merge into my network', mB.banner);
    ok('6.6 the second merged three-way too', mB.ctx.via === 'rev' && mB.ctx.baseRev === rev2 && mB.review && mB.review.mode === 'three-way', `${mB.ctx.via} ${mB.ctx.baseRev} ${rev2}`);
    const pcItem = mB.review && mB.review.req.plan.items.find((it) => it.kind === 'nodes' && it.mineId === 'pc');
    ok('6.7 the field both changed asks', !!pcItem && pcItem.fields.some((f) => f.field === 'notes' && f.conflict && f.take === 'mine'), show(pcItem && pcItem.fields));
    ok('6.8 both edits in, the field both changed yours by default', getNode('sw').name === 'Switch A' && !!getNode('pr') && getNode('pc').notes === 'A note');
    ok('6.9 the report visited with both visits', incOf(inc2).status === 'visited' && show(incOf(inc2).visits) === show([VA.entry.id, VB.entry.id]), show(incOf(inc2)));
    ok('6.10 both visits in the log, chained', state.log.some((e) => e.id === VA.entry.id) && state.log.some((e) => e.id === VB.entry.id) && (await TopoMerge.verifyLog(state.log)) === -1);
    ok('6.11 the first report untouched by them: still open, reopened once', incOf(incId).status === 'open' && incOf(incId).reopened === 1);
    ok('6.12 the second review lists the new visit only', !!mB.review && mB.review.notes.filter((n) => n.startsWith('Visit by ')).length === 1 && mB.review.notes.some((n) => n.startsWith('Visit by Beto Fibra (Fibra Norte)')), show(mB.review && mB.review.notes));

    // Translated: the strings of the merge review's rows.
    const { has, locales } = window.CarinoI18N;
    const keys = ['{symptom} at {where}. Now: {status}', 'Problems', 'Problems and visits', 'Mark fixed', 'Send again', 'Reopen', 'Open problems: {n} · newest {symptom}, {date}', 'Fixed', 'Visited', 'Sent', 'Reported', 'Open', 'Closed'];
    locales.forEach((loc) => {
      const missing = keys.filter((k) => !has(loc, k));
      ok(`${loc} carries the loop's strings`, missing.length === 0, missing.join(' | '));
    });
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    try { TI.closeProblemDialog(); } catch (e) { /* closed */ }
    try { if (PM.state.on) PM.leaveProviderMode(); } catch (e) { /* off */ }
    try { if (landingIsOpen()) closeLanding(); } catch (e) { /* closed */ }
    clearSessions();
    Object.assign(H, { open: held.open, copy: held.copy, share: held.share, canShare: held.canShare, now: held.now });
    window.saveBlob = held.saveBlob;
    MU.setMergeResponder(heldMerge);
    setDialogResponder(heldResponder);
    RV.releaseRevisionStore(); RV._reset(); await RV.openRevisionStore(null);
    R.releaseRestoreStore(); R._reset();
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    CarinoLibrary.persistLibrary(heldLib);
    Object.keys(state.settings).forEach((k) => { delete state.settings[k]; });
    Object.assign(state.settings, heldSettings);
    saveSettings(); applyProfile();
    setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
