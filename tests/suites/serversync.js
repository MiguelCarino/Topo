// @realtime — a network kept in step with a Topo server (js/serversync.js,
// docs/SCOPE.md step 5a, design §9.2-9.4, amendments A3, C1-C7, E5),
// against the in-page fake server (tests/fixtures/fakeserver.js), with real
// Web Crypto. This page is browser A, the owner; "B" is another browser
// scripted through the fake with keys of its own. Covered:
//   - sign in, keys set up (recovery key shown, escrowed), put on the server;
//   - a grant: roster 2 signed by A, the site key wrapped for B, who opens
//     the same network;
//   - B's push with no edits here: a fast-forward, on screen in one undo
//     step, no log entry, nothing pushed back;
//   - edits on both sides that do not meet: a quiet merge (one log entry,
//     source "the server", no restore point), then a push;
//   - a push on a stale base: 409, then pull, merge, push;
//   - edits that meet: "Needs merge", no dialog until asked, the review
//     takes a restore point and pushes; a newer head replaces the waiting
//     one (C5);
//   - offline: the edits stay, the card says how many, they push when back;
//   - a rolled-back history: 'history-mismatch', nothing pushed; trusting
//     the server's history recovers;
//   - a tampered body and a revision citing an older roster (A3) are refused;
//   - removing B: a new epoch whose key B does not get, A pushes under it;
//   - a copy saved by a newer Topo: 'update-needed', nothing merged (C7);
//   - deriveEvents for every case; the provider's send route;
//   - 'server' revisions: at most 3 per card, evicted first (C1);
//   - the delete question both ways; a viewer reads only, never pushes (E5);
//   - review fixes: a member's keys swapped by the server are refused when an
//     owner writes the next roster; removing a member who reset their keys
//     rotates; another tab's index records are never written over and its
//     changes arrive by 'storage'; a push whose answer was lost is adopted,
//     not merged with itself; a lost base is fetched again (or nothing is
//     declared) before events are derived; a site whose envelope names a
//     card linked elsewhere opens as a new card;
//   - signing out.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  try {
    await loadScript('tests/fixtures/fakeserver.js');
    const T = TopoServer, Y = TopoServerSync, C = TopoServerCrypto;
    const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    function NoStream() { this.addEventListener = () => {}; this.close = () => {}; this.readyState = 1; }
    T._reset(); Y._reset();
    Object.assign(T._hooks, { force: true, fetch: fake.fetch, EventSource: NoStream, BroadcastChannel: null, locks: null });
    Object.assign(Y._hooks, { quietMs: 30, maxMs: 200, busyMs: 300 });
    const answers = { delete: 'local' };
    TopoServerUI.setServerResponder((q) => (q.kind === 'recovery' ? 'ok' : q.kind === 'show-name' ? false : q.kind === 'grant' ? { checked: true } : q.kind === 'delete' ? answers.delete : q.kind === 'merge-local' ? true : null));
    setDialogResponder(() => true);

    await openServerClient();
    ok('a served page starts signed out', T.state.status === 'signed-out', T.state.status);
    const ch = await T.requestCode('owner@example.test');
    await T.verifyCode(ch, '123456', 'owner@example.test');
    ok('signed in, keys set up', T.state.status === 'ready', T.state.status);
    const me = fake.user('owner@example.test');
    ok('the server has the public keys and an escrow', !!me.encPub && !!me.escrow);
    ok('the kept keys are not extractable', T.keys().uEnc.extractable === false && T.keys().uSig.extractable === false && T.keys().devPriv.extractable === false);

    // ---- Put on the server ----
    replaceDocument(templatesData.house, { origin: 'default' });
    const id = claimDocument('Office', null);
    const k = (i) => i % libraryEntry(id).doc.nodes.length;
    ok('a kept card', !!libraryEntry(id));
    await TopoServerUI.putOnServer(id);
    const rec = () => Y.rec(id);
    ok('on the server at revision 1', rec() && rec().baseN === 1 && Y.cardSync(id).state === 'synced', JSON.stringify(rec()));
    const siteId = rec().siteId;
    const site = () => fake.site(siteId);
    ok('the site id was made here (D4)', C.validId(siteId, 's_'));
    ok('the server holds ciphertext only', !JSON.stringify(site().revs).includes('Office') && !!site().nameCt && !site().nameClear);
    ok('the card is listed apart', serverCardIds().has(id));
    ok('a server revision was kept under the card', hasRevision(id, libraryEntry(id).rev));

    // ---- A grant ----
    const B = await fake.remote('prov@example.test');
    B.join(siteId, 'provider');
    await T.refreshSites();
    await Y.grant(siteId, [B.user.id], { checked: true });
    ok('the grant made roster 2', site().rosters.length === 2 && site().members.get(B.user.id).status === 'granted');
    await B.unwrapKeys(siteId);
    const bHead = await B.head(siteId);
    ok('B opens the same network', revHashOf(bHead.doc) === revHashOf(libraryEntry(id).doc) && bHead.id === id && bHead.name === 'Office');
    const pin = await T.personKeys(B.user.id, B.encPub, B.sigPub);
    ok('B\'s keys are pinned, checked', pin.state === 'same' && pin.checked);

    // ---- A fast-forward ----
    const logLen = () => (libraryEntry(id).doc.log || []).length;
    const log0 = logLen();
    const pushes0 = fake.pushes;
    const old0 = state.nodes[k(0)].name;
    await B.push(siteId, (d) => { d.nodes[k(0)].name = 'Renamed by B'; });
    T.handleEvent('head', { site: siteId, n: 2 });
    for (let i = 0; i < 50 && rec().baseN !== 2; i++) await wait(20);
    ok('B\'s change arrived', rec().baseN === 2 && libraryEntry(id).doc.nodes[k(0)].name === 'Renamed by B');
    ok('and is on screen', state.nodes[k(0)].name === 'Renamed by B');
    ok('no log entry for a fast-forward', logLen() === log0);
    await wait(150);
    ok('nothing pushed back', fake.pushes === pushes0, `${pushes0} -> ${fake.pushes}`);
    undo();
    ok('one undo step takes it back', state.nodes[k(0)].name === old0);
    redo();
    flushAutosave();
    await Y.syncNow(id);
    ok('redone, nothing to push', fake.pushes === pushes0 && Y.cardSync(id).state === 'synced');

    // ---- A clean merge ----
    batch(() => { state.nodes[k(1)].name = 'Edited by A'; save(); });
    flushAutosave();
    await B.push(siteId, (d) => { d.nodes[k(2)].name = 'Edited by B'; });
    const points0 = restorePointsOf(id).length;
    await Y.syncNow(id);
    const c1 = libraryEntry(id).doc;
    ok('edits that do not meet merge', c1.nodes[k(1)].name === 'Edited by A' && c1.nodes[k(2)].name === 'Edited by B');
    ok('and are pushed', site().revs.length === 4 && rec().baseN === 4, String(site().revs.length));
    const last = (c1.log || [])[c1.log.length - 1];
    ok('one merge log entry from the server', logLen() === log0 + 1 && last.kind === 'merge' && last.source === 'server');
    ok('no restore point for a quiet merge', restorePointsOf(id).length === points0);
    ok('B reads the merged copy', (await B.head(siteId)).doc.nodes[k(1)].name === 'Edited by A');

    // ---- 409 ----
    batch(() => { state.nodes[k(3)].name = 'Again A'; save(); });
    flushAutosave();
    await B.push(siteId, (d) => { d.nodes[k(4)].name = 'Again B'; });
    const direct = await Y.pushCard(rec());
    ok('a push on a stale base gets 409', direct === 'conflict' && fake.calls.some((c) => c.status === 409));
    await Y.syncNow(id);
    const c2 = libraryEntry(id).doc;
    ok('then pull, merge and push', c2.nodes[k(3)].name === 'Again A' && c2.nodes[k(4)].name === 'Again B' && Y.cardSync(id).state === 'synced' && rec().baseN === site().revs.length);

    // ---- A conflict ----
    batch(() => { state.nodes[k(0)].name = 'A says'; save(); });
    flushAutosave();
    await B.push(siteId, (d) => { d.nodes[k(0)].name = 'B says'; });
    const n0 = site().revs.length;
    await Y.syncNow(id);
    ok('edits that meet: Needs merge', Y.cardSync(id).state === 'needs-merge', Y.cardSync(id).state);
    ok('no dialog opened on its own', !TopoMergeUI.mergeDialogOpen());
    ok('nothing pushed while it waits', site().revs.length === n0);
    ok('the card says so', /Needs merge/.test(serverCardText(id).text));
    await B.push(siteId, (d) => { d.nodes[k(5)].name = 'Later B'; });
    await Y.syncNow(id);
    const pend = await Y.getDoc(id, 'pending');
    ok('the newest head waits for the review (C5)', pend && pend.n === site().revs.length);
    let asked = null;
    TopoMergeUI.setMergeResponder((req) => { asked = req; return {}; });
    const pointsBefore = restorePointsOf(id).length;
    const res = await Y.reviewMerge(id);
    TopoMergeUI.setMergeResponder(null);
    ok('the review was asked, from the server', res.ok && asked && asked.source === 'server' && mergeConflictKeys(asked.plan) !== '');
    ok('a reviewed merge takes a restore point', restorePointsOf(id).length === pointsBefore + 1);
    for (let i = 0; i < 50 && Y.cardSync(id).state !== 'synced'; i++) await wait(20);
    ok('and pushes', Y.cardSync(id).state === 'synced' && rec().baseN === site().revs.length && site().revs.length === n0 + 2);
    ok('both sides converge', revHashOf((await B.head(siteId)).doc) === revHashOf(libraryEntry(id).doc) && libraryEntry(id).doc.nodes[k(5)].name === 'Later B');

    // ---- Offline ----
    fake.offline = true;
    batch(() => { state.nodes[k(6)].name = 'Offline edit'; save(); });
    flushAutosave();
    await Y.syncNow(id);
    const off = Y.cardSync(id);
    ok('offline: the edit stays, the card counts it', off.state === 'offline' && off.changes >= 1 && libraryEntry(id).doc.nodes[k(6)].name === 'Offline edit', JSON.stringify(off));
    fake.offline = false;
    await Y.syncNow(id);
    ok('back online it is pushed', Y.cardSync(id).state === 'synced' && (await B.head(siteId)).doc.nodes[k(6)].name === 'Offline edit');

    // ---- A push kept by the server whose answer was lost ----
    const logL = logLen();
    batch(() => { state.nodes[k(6)].name = 'Answer lost'; save(); });
    flushAutosave();
    fake.loseNextPushAnswer = true;
    const nL = site().revs.length;
    await Y.syncNow(id);
    ok('lost answer: the server kept the push, this browser does not know', site().revs.length === nL + 1 && rec().baseN === nL && Y.cardSync(id).state === 'offline', JSON.stringify([site().revs.length, rec().baseN, Y.cardSync(id)]));
    const pushesL = fake.pushes;
    await Y.syncNow(id);
    ok('next sync adopts its own push as the base', rec().baseN === nL + 1 && Y.cardSync(id).state === 'synced' && !Y.dirty(id), JSON.stringify([rec().baseN, Y.cardSync(id)]));
    ok('with no merge log entry and nothing pushed again', logLen() === logL && fake.pushes === pushesL, `${logL} -> ${logLen()}, pushes ${pushesL} -> ${fake.pushes}`);

    // ---- Events derived from a lost base ----
    const pv = addProviderRecord({ name: 'Self', email: 'owner@example.test' });
    const iid = await createIncident({ symptom: 'internet', nodeIds: [state.nodes[k(0)].id], text: 'x', name: 'Owner', email: 'owner@example.test', routedTo: [pv.id], remember: false });
    await sendIncident(iid, { providerIds: [pv.id], server: true });
    flushAutosave();
    await Y.syncNow(id);
    const lastPush = () => fake.calls.filter((c) => c.method === 'POST' && /\/revs$/.test(c.path) && c.status === 201).pop();
    ok('a report sent through the server is declared', JSON.stringify(lastPush().body.events) === `[{"kind":"incident-sent","to":["${me.id}"]}]`, JSON.stringify(lastPush().body.events));
    await Y.putDoc(id, 'base', null);
    batch(() => { state.nodes[k(7)].name = 'Base lost, fetched again'; save(); });
    flushAutosave();
    const calls0 = fake.calls.length;
    await Y.syncNow(id);
    ok('a lost base is fetched again before deriving events', fake.calls.slice(calls0).some((c) => /\/revs\/\d+$/.test(c.path)) && JSON.stringify(lastPush().body.events) === '[]', JSON.stringify(lastPush().body.events));
    await Y.putDoc(id, 'base', null);
    site().revs[rec().baseN - 1].hdr.pruned = true;
    batch(() => { state.nodes[k(7)].name = 'Base lost for good'; save(); });
    flushAutosave();
    const pushesE = fake.pushes;
    await Y.syncNow(id);
    ok('a base that cannot be fetched: pushed, nothing declared', fake.pushes === pushesE + 1 && JSON.stringify(lastPush().body.events) === '[]', JSON.stringify(lastPush().body.events));
    site().revs.forEach((r) => { r.hdr.pruned = false; });

    // ---- Rollback ----
    const nOk = site().revs.length;
    const saved = site().revs.slice();
    const savedH = site().headH;
    fake.rollback(siteId, nOk - 1);
    batch(() => { state.nodes[k(7)].name = 'After the rollback'; save(); });
    flushAutosave();
    const pushesR = fake.pushes;
    await Y.syncNow(id);
    ok('a rolled-back history is caught', Y.cardSync(id).state === 'history-mismatch', Y.cardSync(id).state);
    ok('and nothing is pushed over it', fake.pushes === pushesR);
    T.handleEvent('head', { site: siteId });
    await wait(100);
    ok('a live update does not undo it', Y.cardSync(id).state === 'history-mismatch');
    site().revs = saved; site().headH = savedH;
    await Y.syncNow(id);
    ok('once the server has its history back, Sync now carries on', Y.cardSync(id).state === 'synced' && rec().baseN === nOk + 1, JSON.stringify(Y.cardSync(id)));
    fake.rollback(siteId, nOk - 1);
    await Y.syncNow(id);
    ok('rolled back again: caught again', Y.cardSync(id).state === 'history-mismatch');
    await Y.trustServerHistory(id);
    ok('trusting the server\'s history carries on', Y.cardSync(id).state === 'synced' && rec().baseN === site().revs.length && (await B.head(siteId)).doc.nodes[k(7)].name === 'After the rollback',
      JSON.stringify(Y.cardSync(id)));

    // ---- A tampered body, an old roster (A3) ----
    await B.push(siteId, (d) => { d.nodes[k(8)].name = 'Tampered'; });
    const top = site().revs[site().revs.length - 1];
    const goodCt = top.body.ct;
    const bad = C.unb64u(goodCt); bad[4] ^= 1; top.body.ct = C.b64u(bad);
    await Y.syncNow(id);
    ok('a tampered body is refused', Y.cardSync(id).state === 'error' && Y.cardSync(id).err === 'bad-chain' && libraryEntry(id).doc.nodes[k(8)].name !== 'Tampered', JSON.stringify(Y.cardSync(id)));
    top.body.ct = goodCt;
    await Y.syncNow(id);
    ok('the real body is taken', libraryEntry(id).doc.nodes[k(8)].name === 'Tampered' && Y.cardSync(id).state === 'synced');
    const nA3 = site().revs.length, hA3 = site().headH;
    await B.push(siteId, (d) => { d.nodes[k(8)].name = 'Old roster'; }, { rseq: 1 });
    await Y.syncNow(id);
    ok('a revision citing an older roster is refused (A3)', Y.cardSync(id).err === 'bad-chain' && libraryEntry(id).doc.nodes[k(8)].name !== 'Old roster');
    fake.rollback(siteId, nA3); site().headH = hA3;
    await Y.syncNow(id);
    ok('back in step', Y.cardSync(id).state === 'synced');

    // ---- deriveEvents (D67, design §9.4) ----
    const members = [{ user: 'u_owner', email: 'owner@example.test', role: 'owner', status: 'granted' }, { user: 'u_prov', email: 'prov@example.test', role: 'provider', status: 'granted' },
      { user: 'u_wait', email: 'wait@example.test', role: 'provider', status: 'waiting' }];
    const providers = [{ id: 'p1', email: 'Prov@Example.test' }, { id: 'p2', email: 'nobody@example.test' }, { id: 'p3', email: 'wait@example.test' }];
    const inc = (o) => Object.assign({ id: 'i1', status: 'open', routedTo: [], reporter: { email: 'owner@example.test' } }, o);
    const D = (incs, log) => ({ nodes: [], providers, incidents: incs, log: log || [] });
    const ev = (a, b) => JSON.stringify(Y.deriveEvents(a, b, members));
    ok('events: a report sent to a member provider', ev(D([inc()]), D([inc({ status: 'sent', routedTo: ['p1', 'p2', 'p3'] })])) === '[{"kind":"incident-sent","to":["u_prov"]}]');
    ok('events: a new report already sent', ev(D([]), D([inc({ status: 'sent', routedTo: ['p1'] })])) === '[{"kind":"incident-sent","to":["u_prov"]}]');
    ok('events: sent to nobody on the server says nothing', ev(D([inc()]), D([inc({ status: 'sent', routedTo: ['p2'] })])) === '[]');
    ok('events: the routing grew', ev(D([inc({ status: 'sent', routedTo: ['p2'] })]), D([inc({ status: 'sent', routedTo: ['p2', 'p1'] })])) === '[{"kind":"incident-sent","to":["u_prov"]}]');
    ok('events: a visit goes to the reporter', ev(D([inc({ status: 'sent', routedTo: ['p1'] })]), D([inc({ status: 'visited', routedTo: ['p1'] })], [{ id: 'lg1', kind: 'visit', incidentId: 'i1' }])) === '[{"kind":"visit-recorded","to":["u_owner"]}]');
    ok('events: a visit already in the base is not new', ev(D([inc()], [{ id: 'lg1', kind: 'visit', incidentId: 'i1' }]), D([inc()], [{ id: 'lg1', kind: 'visit', incidentId: 'i1' }])) === '[]');
    ok('events: closed', ev(D([inc({ status: 'visited', routedTo: ['p1'] })]), D([inc({ status: 'closed', routedTo: ['p1'] })])) === '[{"kind":"incident-closed","to":["u_prov"]}]');
    ok('events: nothing happened, nothing declared', ev(D([inc()]), D([inc()])) === '[]');

    // ---- The provider's routes ----
    const st0 = state.providers;
    state.providers = [{ id: 'pA', name: 'Acme', email: 'prov@example.test' }, { id: 'pZ', name: 'Zed', email: 'zed@example.test' }];
    await Y.siteDetail(siteId, true);
    ok('a report to a member goes through the server', !!serverSendRoute(id, ['pA']) && serverSendRoute(id, ['pA']).names[0] === 'Acme');
    ok('one to someone not on the server keeps the link', serverSendRoute(id, ['pA', 'pZ']) === null);
    ok('a visit goes back through the server', serverReturnRoute(id) === true);
    state.providers = st0;

    // ---- 'server' revisions, at most 3 (C1) ----
    const d0 = libraryEntry(id).doc;
    for (let i = 0; i < 6; i++) recordRevision(id, 'svcap' + i, d0, 'server');
    ok('at most 3 server revisions per card', !hasRevision(id, 'svcap0') && !hasRevision(id, 'svcap2') && hasRevision(id, 'svcap5'), [0, 1, 2, 3, 4, 5].map((i) => hasRevision(id, 'svcap' + i)).join(','));

    // ---- The server swaps a granted member's keys ----
    const bu = fake.state.users.get(B.user.id);
    const realB = { encPub: bu.encPub, sigPub: bu.sigPub };
    const evil = await C.newUser();
    bu.encPub = evil.encPub; bu.sigPub = evil.sigPub;
    const rosters0 = site().rosters.length, epoch0 = site().epoch;
    let swapErr = null;
    try { await Y.rotate(siteId); } catch (e) { swapErr = e.code; }
    ok('a rotation refuses keys the trusted roster does not name', swapErr === 'keys-changed' && site().rosters.length === rosters0 && site().epoch === epoch0, String(swapErr));
    swapErr = null;
    try { await Y.setRole(siteId, B.user.id, 'viewer'); } catch (e) { swapErr = e.code; }
    ok('so does a role change', swapErr === 'keys-changed' && site().rosters.length === rosters0 && site().members.get(B.user.id).role === 'provider', String(swapErr));
    ok('and no key was wrapped to the swapped key', !Object.keys(site().wraps).some((w) => w.startsWith((epoch0 + 1) + '|')));
    ok('the reason is said in words', TopoServerUI.errText ? !/keys-changed/.test(TopoServerUI.errText({ code: 'keys-changed' })) : true);
    bu.encPub = realB.encPub; bu.sigPub = realB.sigPub;

    // ---- Removing B: a new epoch ----
    await Y.removeMember(siteId, B.user.id);
    ok('removing B rotates to epoch 2', site().epoch === 2 && !site().members.has(B.user.id) && site().rosters.length === 3);
    ok('B has no key for epoch 2', !Object.keys(site().wraps).some((k) => k === '2|' + B.user.id));
    batch(() => { state.nodes[k(9)].name = 'Epoch two'; save(); });
    flushAutosave();
    await Y.syncNow(id);
    const topRev = site().revs[site().revs.length - 1];
    ok('A pushes under the new key', Y.cardSync(id).state === 'synced' && topRev.hdr.epoch === 2);
    let bReads = true;
    try { await B.head(siteId); } catch (e) { bReads = false; }
    ok('B cannot read what came after', !bReads);
    ok('the name was sealed again for epoch 2', site().nameCt.epoch === 2 && (await Y.siteName(siteId)) === 'Office');

    // ---- Removing a member who reset their keys (waiting, still in the roster) ----
    const B3 = await fake.remote('reset@example.test');
    B3.join(siteId, 'viewer');
    await T.refreshSites();
    await Y.grant(siteId, [B3.user.id], { checked: true });
    const u3 = fake.state.users.get(B3.user.id);
    const nk3 = await C.newUser();
    u3.encPub = nk3.encPub; u3.sigPub = nk3.sigPub;
    site().members.get(B3.user.id).status = 'waiting';
    Object.keys(site().wraps).forEach((w) => { if (w.endsWith('|' + B3.user.id)) delete site().wraps[w]; });
    const epR = site().epoch;
    await Y.removeMember(siteId, B3.user.id);
    ok('removing a member who reset their keys rotates', site().epoch === epR + 1 && !site().members.has(B3.user.id), `${epR} -> ${site().epoch}`);
    batch(() => { state.nodes[k(9)].name = 'After the reset removal'; save(); });
    flushAutosave();
    await Y.syncNow(id);
    ok('and the next push uses the new epoch', Y.cardSync(id).state === 'synced' && site().revs[site().revs.length - 1].hdr.epoch === epR + 1, JSON.stringify(Y.cardSync(id)));

    // ---- A copy from a newer Topo (C7) ----
    const nN = site().revs.length, hN = site().headH;
    const B2 = await fake.remote('second@example.test');
    B2.join(siteId, 'owner');
    await Y.grant(siteId, [B2.user.id], { checked: true });
    await B2.unwrapKeys(siteId);
    await B2.push(siteId, (d) => { d.v = 999; d.nodes[k(0)].name = 'From the future'; });
    await Y.syncNow(id);
    ok('a newer copy: update needed, nothing merged', Y.cardSync(id).state === 'update-needed' && libraryEntry(id).doc.nodes[k(0)].name !== 'From the future');
    ok('the card says to reload', /newer Topo/.test(serverCardText(id).text));
    fake.rollback(siteId, nN); site().headH = hN;
    rec().state = 'synced'; Y.putRec(rec());
    await Y.syncNow(id, { force: true });

    // ---- A viewer (E5) ----
    site().members.get(me.id).role = 'viewer';
    await T.refreshSites();
    await Y.syncNow(id);
    replaceDocument(libraryEntry(id).doc, { libraryId: id, origin: 'library' });
    ok('a viewer\'s card opens read-only', !!state.readOnly && state.readOnly.viewer === true);
    ok('the banner says why', !document.getElementById('readOnlyViewer').hidden && document.getElementById('readOnlyWhy').hidden);
    const lib = loadLibrary(); lib[id].doc.nodes[k(0)].name = 'Viewer edit'; lib[id].updated = Date.now() + 5; persistLibrary(lib);
    const pushesV = fake.pushes;
    await Y.syncNow(id);
    ok('a viewer never pushes', fake.pushes === pushesV);
    site().members.get(me.id).role = 'owner';
    await T.refreshSites();
    replaceDocument(templatesData.house, { origin: 'default' });

    // ---- Another tab writes the index ----
    const ixKey = 'topo-sync:' + (T._hooks.origin || location.origin);
    const other = JSON.parse(localStorage.getItem(ixKey) || '{}');
    other.zz_other = { cardId: 'zz_other', siteId: 's_other', baseN: 1, state: 'synced' };
    localStorage.setItem(ixKey, JSON.stringify(other));   // as another tab would, with no event here yet
    Y.putRec(rec());
    ok('a tab that is behind keeps the other tab\'s record', !!JSON.parse(localStorage.getItem(ixKey)).zz_other && JSON.parse(localStorage.getItem(ixKey))[id].siteId === siteId);
    const zz = Y.rec('zz_other');
    other.zz_other.baseN = 2;
    localStorage.setItem(ixKey, JSON.stringify(Object.assign(JSON.parse(localStorage.getItem(ixKey)), { zz_other: other.zz_other })));
    window.dispatchEvent(new StorageEvent('storage', { key: ixKey, newValue: localStorage.getItem(ixKey) }));
    ok('another tab\'s change arrives by the storage event', Y.rec('zz_other') && Y.rec('zz_other').baseN === 2 && Y.rec('zz_other') === zz);
    Y.dropRec('zz_other');
    ok('and removing one record leaves the others', !JSON.parse(localStorage.getItem(ixKey)).zz_other && !!JSON.parse(localStorage.getItem(ixKey))[id]);

    // ---- Deleting ----
    const id2 = claimDocument('Second', null);
    await TopoServerUI.putOnServer(id2);
    const site2 = Y.rec(id2).siteId;
    answers.delete = 'local';
    ok('the delete question is asked for a server card', await serverDeleteQuestion(libraryEntry(id2)) === true);
    ok('"this browser only": gone here, still on the server', !libraryEntry(id2) && !Y.rec(id2) && !!fake.site(site2));
    const id3 = claimDocument('Third', null);
    await TopoServerUI.putOnServer(id3);
    const site3 = Y.rec(id3).siteId;
    answers.delete = 'everyone';
    await serverDeleteQuestion(libraryEntry(id3));
    ok('"for everyone": gone from the server too', !libraryEntry(id3) && !fake.site(site3));

    // ---- Opening a site here that this browser does not have ----
    Y.dropRec(id); libraryDelete(id);
    await T.refreshSites();
    const opened = await Y.openSite(siteId);
    ok('a site from the server opens as a card', opened === id && !!libraryEntry(id) && state.libraryId === id && Y.cardSync(id).state === 'synced');
    ok('with its name', libraryEntry(id).name === 'Office');

    // ---- A site whose envelope names a card linked to another site ----
    const id4 = claimDocument('Fourth', null);
    await TopoServerUI.putOnServer(id4);
    const site4 = Y.rec(id4).siteId;
    const B4 = await fake.remote('fourth@example.test');
    B4.join(site4, 'provider');
    await T.refreshSites();
    await Y.grant(site4, [B4.user.id], { checked: true });
    await B4.unwrapKeys(site4);
    await B4.push(site4, (d) => { d.nodes[0] && (d.nodes[0].name = 'Takeover'); }, { envId: id });
    Y.dropRec(id4); libraryDelete(id4);
    await T.refreshSites();
    let asked4 = false;
    const opened4 = await Y.openSite(site4, async () => { asked4 = true; return true; });
    ok('it opens as a new card, not over the linked one', opened4 && opened4 !== id && !asked4 && Y.rec(opened4).siteId === site4, String(opened4));
    ok('the linked card keeps its site', Y.rec(id).siteId === siteId && libraryEntry(id).doc.nodes.every((n) => n.name !== 'Takeover'));

    // ---- Signing out ----
    await T.signOut();
    ok('signed out', T.state.status === 'signed-out' && Y.cardSync(id).state === 'signed-out');
    ok('no CSP violation', (window.__cspViolations || []).length === 0, (window.__cspViolations || []).join(' | '));
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
