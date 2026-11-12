// @realtime — provider visits through the owner on a Topo server
// (docs/SCOPE.md step 7, phase 7b: D139, D153, D154, D180-D190;
// js/serversync.js, js/visits.js), against the in-page fake server
// (tests/fixtures/fakeserver.js) with real Web Crypto. This page is the
// owner first, then a provider; "B" is a provider scripted through the fake.
//   1. B's visit copy waits on the server: the owner's list (oldest first,
//      the provider, the report, the count); the copy is ciphertext there;
//   2. one copy per provider and report: B's second Record visit replaces it;
//   3. the owner's review is three-way against the copy's base revision; a
//      change outside what B covers is marked and left out by default;
//      approved with Successful: the merge and the decision one undo step,
//      pushed, then the answer sent with that revision; the copy's base
//      held; the provider told (the visit-recorded event);
//   4. rejected: nothing applied, the copy kept as a file, the answer sent;
//   5. a forged copy (signed by someone else) is refused when opened;
//   6. the provider's side: it never pushes (a push it tries is refused
//      403 owners-only, "update Topo"), its card says its changes go to
//      the owner, Record visit uploads a copy, the card says it waits;
//      answered, the provider takes the server's version, a rejected copy
//      offered as a file first, and deletes its copy;
//   7. revisions B pushed as a provider before (a v0.0.1 history) still
//      verify and are pulled;
//   8. approved (review of 7b, D187, D192): the provider takes the
//      server's version without merging it (the owner's Not successful
//      against its own Visited is no question), with no file offered when
//      nothing would be lost; an edit made after the upload is offered as
//      a file first;
//   9. a later copy that still carries a rejected copy's change (D191): a
//      new copy for the slot stays beside the decided one; the change is
//      marked rejected before and left out by default;
//  10. a copy whose author is no longer a provider is not opened (D191).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, tries = 200) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await wait(20); } return false; };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  try {
    await loadScript('tests/fixtures/fakeserver.js');
    const T = TopoServer, Y = TopoServerSync, C = TopoServerCrypto, V = TopoVisits;
    const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    function NoStream() { this.addEventListener = () => {}; this.close = () => {}; this.readyState = 1; }
    T._reset(); Y._reset(); V._reset();
    Object.assign(T._hooks, { force: true, fetch: fake.fetch, EventSource: NoStream, BroadcastChannel: null, locks: null });
    Object.assign(Y._hooks, { quietMs: 30, maxMs: 200, busyMs: 300 });
    TopoServerUI.setServerResponder((q) => (q.kind === 'recovery' ? 'ok' : q.kind === 'show-name' ? false : q.kind === 'grant' ? { checked: true } : q.kind === 'merge-local' ? true : null));
    setDialogResponder(() => true);
    const downloads = [];
    V.hooks.download = (payload, name) => downloads.push({ payload, name });
    V.hooks.serverMs = 0;

    await openServerClient();
    const ch = await T.requestCode('owner@example.test');
    await T.verifyCode(ch, '123456', 'owner@example.test');
    ok('signed in as the owner', T.state.status === 'ready');

    // A network whose router B (Fibra Norte) looks after; a report routed to B.
    const N = (id, name, extra = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    replaceDocument({ v: DOC_VERSION,
      providers: [{ id: 'pB', name: 'Fibra Norte', service: 'internet', email: 'prov@example.test' }, { id: 'pC', name: 'Andes IT', service: 'it' }],
      nodes: [N('rt', 'Router', { type: 'router', providers: ['pB'] }), N('sw', 'Switch', { type: 'switch', providers: ['pC'] }), N('pc', 'PC')],
      links: [{ id: 'l1', source: 'rt', target: 'sw' }, { id: 'l2', source: 'sw', target: 'pc' }],
      incidents: [{ id: 'incB', at: 1, status: 'sent', symptom: 'internet', nodeIds: ['rt'], routedTo: ['pB'], sentAt: 2 }] }, { origin: 'default' });
    const id = claimDocument('Clinic', null);
    await TopoServerUI.putOnServer(id);
    const rec = () => Y.rec(id);
    const siteId = rec().siteId;
    const site = () => fake.site(siteId);
    const B = await fake.remote('prov@example.test');
    B.join(siteId, 'provider');
    await T.refreshSites();
    await Y.grant(siteId, [B.user.id], { checked: true });
    await B.unwrapKeys(siteId);
    ok('B is a provider on the site', site().members.get(B.user.id).status === 'granted' && site().members.get(B.user.id).role === 'provider');

    // ---- 7 (first): a revision B pushed as a provider (v0.0.1) ----
    await B.push(siteId, (d) => { d.nodes.find((n) => n.id === 'pc').notes = 'pushed by the provider in v0.0.1'; });
    await Y.syncNow(id);
    ok('7.1 a provider\'s revision from before (v0.0.1 history) verifies and is pulled', rec().baseN === 2 && libraryEntry(id).doc.nodes.find((n) => n.id === 'pc').notes === 'pushed by the provider in v0.0.1'
       && Y.cardSync(id).state === 'synced', show(Y.cardSync(id)));

    // ---- 1. B's visit copy ----
    const visitOf = (by, incId) => visitLogEntry({ id: 'lg_' + randomToken(), at: Date.now(), incidentId: incId, providerId: 'pB', provider: 'Fibra Norte', by, outcome: 'fixed',
      changes: { counts: { added: 0, changed: 2, removed: 0 } } });
    let v1e;
    const v1 = await B.uploadVisit(siteId, (d) => {
      d.nodes.find((n) => n.id === 'rt').name = 'Fibra router';           // B's own item
      d.nodes.find((n) => n.id === 'sw').name = 'Switch renamed by B';    // Andes IT's: outside
      v1e = visitOf('Beto', 'incB');
      // The visit monitor's section (step 7i) travels in the visit copy.
      v1e = visitLogEntry(Object.assign({}, v1e, { monitoring: { from: 1000, to: 3601000, items: [{ node: 'rt', check: 'p', proto: 'ping', asked: 60, answered: 60, coverage: 1, med: 4 }], outages: [] } }));
      d.log = (d.log || []).concat([v1e]);
      const x = d.incidents.find((i) => i.id === 'incB'); x.visits = [v1e.id]; x.status = 'visited';
    }, { incidentId: 'incB', providerId: 'pB' });
    ok('1.1 the server holds the copy sealed', site().visits.length === 1 && !JSON.stringify(site().visits).includes('Fibra router'));
    let rows = await V.refreshServerVisits(id, true);
    {
      const opened = await Y.openVisitCopy(siteId, rows[0].hdr, { base: false });
      const ve = ((opened.env.doc.log) || []).find((e) => e.id === v1e.id) || {};
      ok('1.1b the visit copy carries the visit monitor\'s section (step 7i)', !!ve.monitoring && ve.monitoring.items[0].med === 4 && !JSON.stringify(site().visits).includes('"med"'), show(ve.monitoring));
    }
    ok('1.2 the owner lists it: B, the report, one visit', rows.length === 1 && rows[0].info.providerId === 'pB' && rows[0].info.provider === 'Fibra Norte' && rows[0].info.count === 1
       && rows[0].info.incidentId === 'incB' && rows[0].hdr.email === 'prov@example.test', show(rows.map((r) => r.info)));
    // The landing reads a server card's copies on its own (the card need
    // not have been opened, nor the list read first).
    V._vw.server.delete(id);
    V.landingVisitsText(id);
    await until(() => V._vw.server.has(id));
    ok('1.3 the landing line, read by the landing itself', V.landingVisitsText(id) === 'A visit waits for your review');

    // ---- 2. One copy per provider and report ----
    let v2e;
    const v2 = await B.uploadVisit(siteId, (d) => {
      d.nodes.find((n) => n.id === 'rt').name = 'Fibra router';
      d.nodes.find((n) => n.id === 'sw').name = 'Switch renamed by B';
      d.nodes.find((n) => n.id === 'rt').notes = 'second visit';
      v2e = visitOf('Beto', 'incB');
      d.log = (d.log || []).concat([v1e, v2e]);
      const x = d.incidents.find((i) => i.id === 'incB'); x.visits = [v1e.id, v2e.id]; x.status = 'visited';
    }, { incidentId: 'incB', providerId: 'pB' });
    rows = await V.refreshServerVisits(id, true);
    ok('2.1 the second Record visit replaces the first', site().visits.length === 1 && v2.replaced === 1 && rows.length === 1 && rows[0].hdr.id === v2.id && rows[0].info.count === 2,
       show(rows.map((r) => [r.hdr.id, r.info.count])));
    ok('2.2 its base is the revision it was made on', v2.baseN === 2);

    // ---- 3. Reviewed and approved ----
    // The owner edits meanwhile and pushes (head 3): the copy merges three-way against its base.
    batch(() => { getNode('pc').name = 'Reception PC'; save(); });
    flushAutosave();
    await Y.syncNow(id);
    ok('3.0 the owner pushed meanwhile', rec().baseN === 3);
    let req = null, answer = { $visit: { changes: 'apply', outcome: 'successful', note: 'Fixed, thanks' } };
    setMergeResponder((r) => { req = r; return answer; });
    const pushes0 = fake.pushes || 0;
    let res = await V.reviewWaitingVisit('server|' + v2.id);
    const it = (key) => req && req.plan.items.find((x) => x.key === key);
    ok('3.1 three-way against the copy\'s base, the visit in the request', !!req && req.plan.mode === 'three-way' && !!req.visit && req.visit.serverId === v2.id && req.visit.count === 2);
    ok('3.2 the switch (Andes IT\'s) is outside what B covers; the router is not', it('nodes:sw') && it('nodes:sw').outside === true && it('nodes:rt') && !it('nodes:rt').outside,
       show(req && req.plan.items.filter((x) => x.status !== 'unchanged').map((x) => [x.key, !!x.outside])));
    const doc = libraryEntry(id).doc;
    ok('3.3 approved: B\'s own change in, the outside one left out, the owner\'s kept', res.ok && doc.nodes.find((n) => n.id === 'rt').name === 'Fibra router'
       && doc.nodes.find((n) => n.id === 'rt').notes === 'second visit' && doc.nodes.find((n) => n.id === 'sw').name === 'Switch' && doc.nodes.find((n) => n.id === 'pc').name === 'Reception PC');
    ok('3.4 the report marked fixed, the decision logged', doc.incidents.find((x) => x.id === 'incB').status === 'closed' && doc.log.slice(-1)[0].kind === 'decision'
       && doc.log.slice(-1)[0].result === 'approved' && show(doc.log.slice(-1)[0].visits) === show([v1e.id, v2e.id]));
    await until(() => site().visits[0].state === 'approved');
    const sv = site().visits[0];
    ok('3.5 pushed, then the answer sent with that revision', (fake.pushes || 0) === pushes0 + 1 && sv.state === 'approved' && sv.decidedN === site().revs.length && rec().baseN === site().revs.length
       && !(rec().decisions || []).length, show([sv.state, sv.decidedN, site().revs.length, fake.pushes, pushes0]));
    ok('3.6 the provider is told (the visit-recorded event)', fake.mails.some((m) => m.kind === 'visit-recorded' && m.to === 'prov@example.test' && m.reason === 'approved'));
    rows = await V.refreshServerVisits(id, true);
    ok('3.7 nothing waits now', rows.length === 0 && V.landingVisitsText(id) === '');

    // ---- 4. Rejected ----
    await B.uploadVisit(siteId, (d) => {
      d.nodes.find((n) => n.id === 'rt').name = 'Wrong router';
      const e = visitOf('Beto', 'incB');
      d.log = (d.log || []).concat([e]);
    }, { incidentId: 'incB', providerId: 'pB', slot: 'slot_rejected_one' });
    rows = await V.refreshServerVisits(id, true);
    answer = { $visit: { changes: 'reject', outcome: 'undecided', note: 'Not what we agreed' } };
    const before4 = show(libraryEntry(id).doc.nodes);
    res = await V.reviewWaitingVisit('server|' + rows[0].hdr.id);
    await until(() => site().visits.some((v) => v.slot === 'slot_rejected_one' && v.state === 'rejected'));
    const d4 = libraryEntry(id).doc;
    ok('4.1 rejected: nothing applied, logged, kept as a file', res.ok && show(d4.nodes) === before4 && d4.log.slice(-1)[0].result === 'rejected'
       && downloads.length === 1 && /_rejected-visit\.json$/.test(downloads[0].name));
    ok('4.2 the answer sent', site().visits.find((v) => v.slot === 'slot_rejected_one').state === 'rejected');

    // ---- 9. A rejected copy's change carried by a later copy (D191) ----
    // B has not taken the rejection yet and records another visit for the
    // same report: the new copy still renames the router as the rejected one did.
    const c9 = await B.uploadVisit(siteId, (d) => {
      d.nodes.find((n) => n.id === 'rt').name = 'Wrong router';
      d.nodes.push(N('ap', 'AP-9'));
      const e = visitOf('Beto', 'incB');
      d.log = (d.log || []).concat([e]);
    }, { incidentId: 'incB', providerId: 'pB', slot: 'slot_rejected_one' });
    ok('9.1 the new copy stays beside the rejected one', site().visits.filter((v) => v.slot === 'slot_rejected_one').length === 2 && c9.replaced === 0
       && site().visits.some((v) => v.slot === 'slot_rejected_one' && v.state === 'rejected'));
    await V.refreshServerVisits(id, true);
    answer = { $visit: { changes: 'apply', outcome: 'undecided', note: '' } };
    req = null;
    res = await V.reviewWaitingVisit('server|' + c9.id);
    ok('9.2 the rename the owner rejected is marked rejected before; the new device is not', !!it('nodes:rt') && it('nodes:rt').rejectedBefore === true && it('nodes:rt').outside === true
       && !!it('nodes:ap') && !it('nodes:ap').rejectedBefore && !it('nodes:ap').outside, show(req && req.plan.items.filter((x) => x.status !== 'unchanged').map((x) => [x.key, !!x.outside, !!x.rejectedBefore])));
    const d9 = libraryEntry(id).doc;
    ok('9.3 left out by default; the rest applied', res.ok && d9.nodes.find((n) => n.id === 'rt').name === 'Fibra router' && d9.nodes.some((n) => n.id === 'ap'),
       show(d9.nodes.map((n) => n.name)));
    await until(() => (site().visits.find((v) => v.id === c9.id) || {}).state === 'approved');
    ok('9.4 the answer sent', (site().visits.find((v) => v.id === c9.id) || {}).state === 'approved');
    // B takes its answers.
    site().visits = site().visits.filter((v) => v.author !== B.user.id);
    setMergeResponder(null);

    // ---- 5. A forged copy ----
    const X = await fake.remote('stranger@example.test');
    const forged = await B.uploadVisit(siteId, (d) => d, { incidentId: 'incB', providerId: 'pB', slot: 'slot_forged_one' });
    forged.sig = await C.sign(X.sig, C.visitSigned(Object.assign({ site: siteId }, forged)));
    let refused = '';
    try { await Y.openVisitCopy(siteId, Object.assign({}, forged, { email: '' })); } catch (e) { refused = e.code; }
    ok('5.1 a copy whose signature is not its author\'s is refused', refused === 'bad-chain', refused);
    rows = await V.refreshServerVisits(id, true);
    ok('5.2 and listed as one that could not be opened', rows.some((r) => r.hdr.id === forged.id && r.err === 'bad-chain'));
    site().visits = site().visits.filter((v) => v.id !== forged.id);

    // ---- 10. A copy whose author is no longer a provider (D191) ----
    const c10 = await B.uploadVisit(siteId, (d) => d, { incidentId: 'incB', providerId: 'pB', slot: 'slot_role_gone' });
    const kept10 = Object.assign({}, c10);
    await Y.setRole(siteId, B.user.id, 'viewer');
    ok('10.1 made a viewer, B\'s copies go with them', !site().visits.some((v) => v.author === B.user.id));
    site().visits.push(kept10);   // as if the server had not dropped it yet
    refused = '';
    try { await Y.openVisitCopy(siteId, Object.assign({ email: '' }, kept10)); } catch (e) { refused = e.code; }
    ok('10.2 a copy whose author is no longer a provider is not opened', refused === 'not-provider', refused);
    site().visits = site().visits.filter((v) => v.id !== kept10.id);
    await Y.setRole(siteId, B.user.id, 'provider');
    ok('10.3 B is a provider again', site().members.get(B.user.id).role === 'provider');

    // ---- 6. This page as a provider ----
    site().members.get(T.me().id).role = 'provider';
    // Another owner exists in the fake (who answers): B stands in, pushing.
    await T.refreshSites();
    await Y.syncNow(id);
    ok('6.1 the card follows the role', rec().role === 'provider');
    const posts0 = fake.calls.filter((c) => c.method === 'POST' && /\/revs$/.test(c.path)).length;
    batch(() => { getNode('pc').notes = 'provider edit'; save(); });
    flushAutosave();
    serverAfterSave(id);
    await wait(150);
    await Y.syncNow(id);
    ok('6.2 a provider never pushes: its edits stay here', fake.calls.filter((c) => c.method === 'POST' && /\/revs$/.test(c.path)).length === posts0 && Y.dirty(id));
    ok('6.3 its card says they go to the owner', Y.cardSync(id).state === 'proposed' && /go to the owner when you record a visit/.test(serverCardText(id).text), show(Y.cardSync(id)));
    let code = '', upd = null;
    try { await T.api('POST', `/api/sites/${siteId}/revs`, { rev: { base: site().revs.length, epoch: site().epoch, rseq: site().rosters.length, n: site().revs.length + 1 } }); }
    catch (e) { code = e.code; upd = e.data && e.data.update; }
    ok('6.4 a push it tries anyway is refused: 403 owners-only, update Topo', code === 'owners-only' && upd === true, show([code, upd]));
    const up = await Y.uploadVisit(id, { incidentId: 'incB', providerId: 'pB' });
    const mineCopy = site().visits.find((v) => v.author === T.me().id);
    ok('6.5 Record visit uploads a visit copy on its base', !!up && !!mineCopy && mineCopy.baseN === rec().baseN && mineCopy.state === 'waiting');
    ok('6.6 its card says it waits for the owner', Y.cardSync(id).state === 'visit-waiting' && /waiting for the owner/.test(serverCardText(id).text));
    // The owner rejects it (B stands in, writing the site's version).
    await B.push(siteId, (d) => { d.nodes.find((n) => n.id === 'pc').name = 'Owner\'s version'; });
    Object.assign(mineCopy, { state: 'rejected', decidedN: site().revs.length, decidedAt: Date.now(), decidedBy: B.user.id });
    let asked = '';
    Y._hooks.ask = async (m, o) => { asked = o.why; return 'file'; };
    const realDownload = window.downloadJson;
    const got = [];
    window.downloadJson = (payload, name) => got.push({ payload, name });
    await Y.syncNow(id);
    window.downloadJson = realDownload;
    delete Y._hooks.ask;
    const d6 = libraryEntry(id).doc;
    ok('6.7 rejected: its copy offered as a file first', asked === 'rejected' && got.length === 1 && /_my-visit\.json$/.test(got[0].name)
       && got[0].payload.doc.nodes.find((n) => n.id === 'pc').notes === 'provider edit', show([asked, got.map((g) => g.name)]));
    ok('6.8 then the server\'s version taken', d6.nodes.find((n) => n.id === 'pc').name === 'Owner\'s version' && d6.nodes.find((n) => n.id === 'pc').notes !== 'provider edit'
       && !Y.dirty(id) && rec().baseN === site().revs.length && Y.cardSync(id).state === 'synced', show(Y.cardSync(id)));
    ok('6.9 and on screen', state.libraryId === id && getNode('pc').name === 'Owner\'s version');
    ok('6.10 its copy deleted on the server', !site().visits.some((v) => v.author === T.me().id));

    // ---- 8. Approved (D187, D192) ----
    // The provider marks the report Visited and records the visit; the
    // owner (B stands in) applies it and judges it Not successful.
    batch(() => { getNode('rt').notes = 'provider fixed it'; const x = state.incidents.find((i) => i.id === 'incB'); x.status = 'visited'; save(); });
    flushAutosave();
    const up8 = await Y.uploadVisit(id, { incidentId: 'incB', providerId: 'pB' });
    const c8 = site().visits.find((v) => v.id === up8.id);
    const judge = (d, extra) => {
      d.nodes.find((n) => n.id === 'rt').notes = 'provider fixed it';
      const x = d.incidents.find((i) => i.id === 'incB'); x.status = 'open'; x.reopened = (x.reopened || 0) + 1; delete x.closedAt; delete x.closedNote;
      d.log = (d.log || []).concat([decisionLogEntry({ id: 'lg_' + randomToken(), at: Date.now(), visits: [], incidentId: 'incB', providerId: 'pB', result: 'approved', outcome: 'not-successful' })]);
      if (extra) extra(d);
    };
    await B.push(siteId, (d) => judge(d));
    Object.assign(c8, { state: 'approved', decidedN: site().revs.length, decidedAt: Date.now(), decidedBy: B.user.id });
    asked = '';
    Y._hooks.ask = async (m, o) => { asked = o.why; return 'no'; };
    await Y.syncNow(id);
    const inc8 = libraryEntry(id).doc.incidents.find((i) => i.id === 'incB');
    ok('8.1 approved, nothing else changed: no file offered', asked === '', asked);
    ok('8.2 the server\'s version taken as it is, no merge question', inc8.status === 'open' && getNode('rt').notes === 'provider fixed it' && Y.cardSync(id).state === 'synced'
       && !Y.dirty(id) && rec().baseN === site().revs.length, show([inc8.status, Y.cardSync(id)]));
    ok('8.3 its copy deleted', !site().visits.some((v) => v.author === T.me().id));
    // An edit made after the upload, with no new Record visit.
    batch(() => { getNode('pc').notes = 'at the visit'; save(); });
    flushAutosave();
    const up8b = await Y.uploadVisit(id, { incidentId: 'incB', providerId: 'pB' });
    batch(() => { getNode('sw').notes = 'after the upload'; save(); });
    flushAutosave();
    await B.push(siteId, (d) => { d.nodes.find((n) => n.id === 'pc').notes = 'at the visit'; });
    Object.assign(site().visits.find((v) => v.id === up8b.id), { state: 'approved', decidedN: site().revs.length, decidedAt: Date.now(), decidedBy: B.user.id });
    asked = '';
    Y._hooks.ask = async (m, o) => { asked = o.why; return 'file'; };
    const got8 = [];
    window.downloadJson = (payload, name) => got8.push({ payload, name });
    await Y.syncNow(id);
    window.downloadJson = realDownload;
    delete Y._hooks.ask;
    ok('8.4 an edit the owner never got: offered as a file first', asked === 'unsent' && got8.length === 1 && got8[0].payload.doc.nodes.find((n) => n.id === 'sw').notes === 'after the upload',
       show([asked, got8.length]));
    ok('8.5 then the server\'s version', getNode('pc').notes === 'at the visit' && getNode('sw').notes !== 'after the upload' && !Y.dirty(id));
    ok('no CSP violation', (window.__cspViolations || []).length === 0, (window.__cspViolations || []).join(' | '));
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  }
  setMergeResponder(null);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
