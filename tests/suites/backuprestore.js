// @realtime — opening and restoring a Topo server's backup file
// (js/backupfile.js; docs/SCOPE.md step 5b, D100, D107, amendments 1-3, 26),
// with real Web Crypto, against the in-page fake server (tests/fixtures/
// fakeserver.js builds the file as server/internal/backup/snapshot.go does).
// Covered:
//   - on its own server, signed in as an owner: opened with this browser's
//     keys, no question;
//   - anywhere else (another server's file, the website, no server): the
//     recovery key of one of its owners opens it; a mistyped one and a wrong
//     one are said in words and asked again; Cancel opens nothing;
//   - the owners are listed, one with no recovery key greyed as such; no
//     owner with a recovery key: it cannot be opened, said in words;
//   - a changed ciphertext, a changed header, a member list that is not the
//     one this browser trusts, a newer format: refused in words; a list
//     newer than this browser's trust record is checked, not refused;
//   - a forged file (an attacker's list naming the real owner, a key of the
//     attacker's wrapped to them) opened with the real recovery key: the
//     review says Topo could not confirm who made it;
//   - an author whose keys changed since: it opens, and the review says the
//     signature could not be checked;
//   - restoring: a known network is offered Merge / Replace with this copy /
//     Open as a copy; Replace keeps a restore point "Before restoring a
//     backup" first; Merge goes through the review, logged as "a backup";
//   - on a synced network, the restored copy is one new revision on top of
//     the head, and a co-owner's later edit pulled afterwards does not undo
//     it (amendment 26);
//   - the same through the list on the server (Members, Backups, Restore…);
//   - no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  try {
    await loadScript('tests/fixtures/fakeserver.js');
    const T = TopoServer, Y = TopoServerSync, C = TopoServerCrypto, BF = TopoBackupFile, U = TopoServerUI;
    const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    function NoStream() { this.addEventListener = () => {}; this.close = () => {}; this.readyState = 1; }
    T._reset(); Y._reset();
    Object.assign(T._hooks, { force: true, fetch: fake.fetch, EventSource: NoStream, BroadcastChannel: null, locks: null });
    Object.assign(Y._hooks, { quietMs: 30, maxMs: 200, busyMs: 300 });
    let recovery = '';
    U.setServerResponder((q) => { if (q.kind === 'recovery') { recovery = recovery || q.code; return 'ok'; } return q.kind === 'grant' ? { checked: true } : q.kind === 'show-name' ? false : null; });
    // The questions: a queue of answers by kind; what was asked is kept.
    const asked = [];
    let answers = {};
    setDialogResponder((q) => {
      asked.push(q);
      const a = answers[q.kind];
      if (Array.isArray(a)) return a.length ? a.shift() : null;
      if (typeof a === 'function') return a(q);
      return a !== undefined ? a : q.kind === 'confirm' ? true : null;
    });
    const reviews = [];
    const heldMerge = setMergeResponder((req) => { reviews.push(req); return {}; });
    await CarinoRestore.openRestoreStore({ open: async () => [], readCards: async () => ({}), readDoc: async () => null, write: async () => true });

    await openServerClient();
    await T.verifyCode(await T.requestCode('owner@example.test'), '123456', 'owner@example.test');
    ok('signed in with keys and a recovery key', T.state.status === 'ready' && /^[a-z2-9]{4}(-[a-z2-9]{4}){6}$/.test(recovery), recovery);
    const me = fake.user('owner@example.test');

    replaceDocument(templatesData.house, { origin: 'default' });
    const id = claimDocument('Office', null);
    await U.putOnServer(id);
    const siteId = Y.rec(id).siteId;
    const edit = async (name) => { const lib = loadLibrary(); lib[id].doc.nodes[0].name = name; lib[id].updated = Date.now(); persistLibrary(lib); if (state.libraryId === id) replaceDocument(lib[id].doc, { libraryId: id, origin: 'library' }); return Y.syncNow(id); };
    ok('a first push', (await edit('Version one')) === 'pushed');
    const file1 = await fake.backupFile(siteId);
    ok('the file is ciphertext with the owner\'s locked keys', file1.kind === 'topo-backup' && !JSON.stringify(file1).includes('Version one') && file1.owners.length === 1 && !!file1.owners[0].escrow);

    // ---- Own keys, on the same server ----
    let res = await BF.unlockBackup(clone(file1), { ask: () => { throw new Error('asked'); } });
    ok('on its server, an owner\'s browser opens it with its own keys', res.how === 'own' && res.env.doc.nodes[0].name === 'Version one' && res.env.id === id && !res.note, res.how);

    // ---- Elsewhere: the recovery key ----
    const elsewhere = Object.assign(clone(file1), { originHash: C.b64u(await C.sha256(C.utf8('https://elsewhere.example'))) });
    const problems = [];
    const tries = ['not a code', 'aaaa-bbbb-cccc-dddd-eeee-ffff-gggg', (await C.newRecoveryCode()).text, recovery];
    res = await BF.unlockBackup(clone(elsewhere), { ask: (b, r, problem) => { problems.push(problem); return tries.shift(); } });
    ok('another server\'s file asks for a recovery key and the right one opens it', res.how === 'recovery' && res.env.doc.nodes[0].name === 'Version one');
    ok('a mistyped code is said in words', /no i, l, o, 0 or 1|one character is wrong/.test(problems[1] || ''), problems[1]);
    ok('a wrong key says it needs the key its owners had then', /does not open this backup/.test(problems[3] || '') && /recovery key its owners had then/.test(problems[3] || ''), problems[3]);
    let code = '';
    try { await BF.unlockBackup(clone(elsewhere), { ask: () => null }); } catch (e) { code = e.code; }
    ok('Cancel opens nothing', code === 'cancelled');
    // Not signed in (no server on the page): the recovery key too.
    T.state.on = false;
    res = await BF.unlockBackup(clone(file1), { ask: () => recovery });
    ok('with no server, the recovery key opens it', res.how === 'recovery' && res.env.doc.nodes[0].name === 'Version one');
    T.state.on = true;

    // ---- Refused ----
    const refused = async (f) => { try { await BF.unlockBackup(f, { ask: () => recovery }); return 'opened'; } catch (e) { return e.code; } };
    const ct = clone(file1); ct.rev.ct = (ct.rev.ct[0] === 'A' ? 'B' : 'A') + ct.rev.ct.slice(1);
    ok('a changed ciphertext is refused', (await refused(ct)) === 'damaged');
    const hdr = clone(file1); hdr.rev.at += 1;
    ok('a changed header is refused', (await refused(hdr)) === 'damaged');
    const bad = clone(file1); bad.rosters[0].members[0].email = 'mallory@example.test';
    bad.rosters[0].sig = C.b64u(C.random(64));
    ok('a member list this browser does not trust is refused', (await refused(bad)) === 'roster-mismatch');
    ok('…in words', /member list does not match/.test(BF.backupErrorText({ code: 'roster-mismatch' })));
    ok('a newer format is refused in words', (await refused(Object.assign(clone(file1), { v: 2 }))) === 'newer' && /newer version of Topo/.test(BF.backupErrorText({ code: 'newer' })));
    ok('a file that is not a backup is damaged', (await refused({ kind: 'topo-backup', v: 1 })) === 'damaged');

    // ---- A forged file (someone who can write to the drive) ----
    // It copies the owner's escrow and public keys from a genuine file, names
    // the owner and the attacker as owners on a list the attacker signed,
    // wraps a network key of the attacker's to the owner and encrypts a
    // network of the attacker's under it.
    const forge = async (src) => {
      const f = clone(src);
      const X = await C.newUser();
      const xid = 'u_' + C.b64u(C.random(16));
      const ownerPub = f.pubs[me.id];
      const at = Date.now();
      const r = await C.signRoster({ site: siteId, seq: f.rev.rseq, epoch: f.rev.epoch, by: xid, at, sigPriv: X.sig, members: [
        { u: me.id, email: 'owner@example.test', role: 'owner', encPub: ownerPub.encPub, sigPub: ownerPub.sigPub },
        { u: xid, email: 'x@example.test', role: 'owner', encPub: X.encPub, sigPub: X.sigPub }] });
      const raw = C.newSiteKeyRaw();
      const w = await C.wrap({ toPub: ownerPub.encPub, ctx: C.siteCtx(siteId, f.rev.epoch, me.id), plaintext: raw, by: xid, sigPriv: X.sig });
      const key = await C.importSiteKey(raw);
      const env = { v: 1, id, name: 'Planted', rev: 1, base: 0, prior: [], doc: Object.assign(clone(templatesData.house), { id }) };
      env.doc.nodes[0].name = 'Planted by someone else';
      const h = { site: siteId, n: f.rev.n, base: f.rev.base, prev: f.rev.prev, epoch: f.rev.epoch, rseq: f.rev.rseq, author: xid, dev: f.rev.dev, at };
      const sealed = await C.sealRevision(h, key, X.sig, await C.packDoc(env));
      f.rev = Object.assign({}, sealed.envelope, { h: sealed.h });
      delete f.rev.site;
      f.rosters = [r];
      f.pubs = { [me.id]: ownerPub, [xid]: { encPub: X.encPub, sigPub: X.sigPub } };
      f.owners = [{ u: me.id, wrap: w, escrow: src.owners.find((o) => o.u === me.id).escrow }];
      return f;
    };
    const planted = await forge(Object.assign(clone(file1), { originHash: 'x' }));
    let plantedRes = null;
    try { plantedRes = await BF.unlockBackup(clone(planted), { ask: () => recovery }); } catch (e) { plantedRes = { code: e.code }; }
    ok('a forged file opened with the owner\'s real recovery key says Topo could not confirm who made it',
      !!plantedRes && plantedRes.how === 'recovery' && /could not confirm who made this backup/.test(plantedRes.note || ''), plantedRes && (plantedRes.note || plantedRes.code));
    T.state.on = false;
    try { plantedRes = await BF.unlockBackup(clone(planted), { ask: () => recovery }); } catch (e) { plantedRes = { code: e.code }; }
    ok('…also with no server on the page', /could not confirm who made this backup/.test((plantedRes && plantedRes.note) || ''), plantedRes && (plantedRes.note || plantedRes.code));
    res = await BF.unlockBackup(clone(file1), { ask: () => recovery });
    ok('a genuine file signed by the owner who opens it has no such note', !/could not confirm/.test(res.note || ''), res.note);
    T.state.on = true;
    const badSig = clone(Object.assign(clone(file1), { originHash: 'x' }));
    badSig.rosters[0].members[0].email = 'mallory@example.test';
    ok('a changed member list whose signer\'s key is in the file is damaged anywhere', (await refused(badSig)) === 'damaged');

    // ---- Owners: one with no recovery key, a second owner's edit ----
    const B = await fake.remote('second@example.test');
    B.join(siteId, 'owner');
    await T.refreshSites();
    await Y.grant(siteId, [B.user.id], { checked: true });
    await B.unwrapKeys(siteId);
    await B.push(siteId, (doc) => { doc.nodes[0].name = 'By the second owner'; });
    await Y.syncNow(id);
    ok('the second owner\'s edit arrived', libraryEntry(id).doc.nodes[0].name === 'By the second owner');
    const file2 = await fake.backupFile(siteId, { originHash: 'x' });
    // This browser's trust record is behind the file (signed out, or not
    // synced since the grant): the newer list is checked, not refused.
    {
      const sameFile = await fake.backupFile(siteId);
      const realTrust = Y.trust, realWalk = Y.walkRosters;
      const full = await realTrust(siteId);
      Y.trust = async () => Object.assign({}, full, { rosters: full.rosters.filter((r) => r.seq < sameFile.rosters[sameFile.rosters.length - 1].seq) });
      Y.walkRosters = async () => { throw new Error('offline'); };
      let behind;
      try { behind = await BF.unlockBackup(clone(sameFile), { ask: () => recovery }); } catch (e) { behind = { code: e.code }; }
      Y.trust = realTrust; Y.walkRosters = realWalk;
      ok('a list newer than this browser\'s trust record is not refused as a mismatch', !!behind && !!behind.env && behind.env.doc.nodes[0].name === 'By the second owner' && !/could not confirm/.test(behind.note || ''),
        behind && (behind.code || behind.note));
    }
    ok('both owners are in the file; the second has no recovery key', file2.owners.length === 2 && file2.owners.some((o) => o.u === B.user.id && !o.escrow));
    asked.length = 0;
    answers = { prompt: [null] };
    try { await BF.unlockBackup(clone(file2)); } catch (e) { code = e.code; }
    const prompt = asked.find((q) => q.kind === 'prompt');
    ok('the dialog lists the owners, the one with no recovery key said so', !!prompt && prompt.message.includes('owner@example.test') && prompt.message.includes('second@example.test (no recovery key)') && /Owners added after that are not in it/.test(prompt.message), prompt && prompt.message);
    ok('the field is typed exactly (no capitals, no corrections)', !!prompt && prompt.keys === 'code');
    const noEscrow = clone(file2); noEscrow.owners.forEach((o) => { o.escrow = null; });
    ok('no owner with a recovery key: it cannot be opened, in words', (await refused(noEscrow)) === 'no-recovery' && /only in a browser on its server/.test(BF.backupErrorText({ code: 'no-recovery' })));
    // The author (the second owner) reset keys since: their key is not in the file.
    const reset = await fake.backupFile(siteId, { originHash: 'x', dropPubs: [B.user.id] });
    res = await BF.unlockBackup(reset, { ask: () => recovery });
    ok('an author whose keys changed since: it still opens, with a note', res.env.doc.nodes[0].name === 'By the second owner' && /signature could not be checked/.test(res.note), res.note);
    const forged = await fake.backupFile(siteId, { originHash: 'x' });
    forged.rev.sig = C.b64u(C.random(64));
    // The chain hash covers the signature: recomputed, so only the signature is wrong.
    forged.rev.h = await C.chainHash(C.revSigned(Object.assign({ site: siteId }, forged.rev)), forged.rev.sig);
    ok('a signature that does not verify under the author\'s key is refused', (await refused(forged)) === 'damaged');

    // ---- Restoring a known network: Replace with this copy ----
    await openFromLibrary(id);
    const headBefore = fake.site(siteId).revs.length;
    asked.length = 0;
    answers = { choice: (q) => (q.choices.some((c) => c.id === 'update') ? 'update' : null), confirm: true };
    const okUpdate = await openBackupFile(clone(file1), { fileName: 'topo_network-x_2026-11-10.json' });
    const choice = asked.find((q) => q.kind === 'choice');
    ok('a known network: Merge / Replace with this copy / Open as a copy', !!choice && choice.title === 'Restore a backup' && ['update', 'copy'].every((c) => choice.choices.some((x) => x.id === c))
      && !choice.choices.some((x) => x.id === 'history'), choice && JSON.stringify(choice.choices.map((c) => c.id)));
    ok('Replace with this copy takes it', okUpdate === true && libraryEntry(id).doc.nodes[0].name === 'Version one');
    const points = CarinoRestore.restorePointsOf(id);
    ok('…after a restore point "Before restoring a backup" of how it was', points.some((p) => p.reason === 'Before restoring a backup'), JSON.stringify(points.map((p) => p.reason)));
    ok('the next push is one new revision on top of the head', (await Y.syncNow(id)) === 'pushed' && fake.site(siteId).revs.length === headBefore + 1 && fake.site(siteId).revs[headBefore].hdr.base === headBefore);
    // The co-owner edits something else afterwards; pulled, it does not undo the restore.
    await B.unwrapKeys(siteId);
    await B.push(siteId, (doc) => { doc.nodes[1].name = 'Later edit'; });
    await Y.syncNow(id);
    const doc = libraryEntry(id).doc;
    ok('a co-owner\'s later edit pulled afterwards keeps the restore', doc.nodes[0].name === 'Version one' && doc.nodes[1].name === 'Later edit', [doc.nodes[0].name, doc.nodes[1].name].join(' / '));

    // ---- Merge, through the review ----
    await B.push(siteId, (d) => { d.nodes[2].name = 'Only in the backup'; });
    const file3 = await fake.backupFile(siteId);
    await B.push(siteId, (d) => { d.nodes[2].name = libraryEntry(id).doc.nodes[2].name; });
    reviews.length = 0; asked.length = 0;
    answers = { choice: (q) => (q.choices.some((c) => c.id === 'merge') ? 'merge' : null), confirm: true };
    const okMerge = await openBackupFile(clone(file3), { fileName: 'topo_network-x_2026-11-10_1200.json' });
    ok('Merge goes through the review', okMerge === true && reviews.length === 1);
    ok('…and takes what only the backup has', libraryEntry(id).doc.nodes[2].name === 'Only in the backup');
    const log = (libraryEntry(id).doc.log || []).filter((e) => e.kind === 'merge').pop();
    ok('the log says it came from a backup', !!log && log.source === 'backup' && /Merged a backup/.test(logEntryText(log)), log && logEntryText(log));
    ok('with a restore point "Before restoring a backup"', CarinoRestore.restorePointsOf(id).filter((p) => p.reason === 'Before restoring a backup').length >= 2);
    // The note reaches the review header.
    reviews.length = 0;
    await B.push(siteId, (d) => { d.nodes[3].name = 'Note test'; });
    const file4 = await fake.backupFile(siteId, { originHash: 'x', dropPubs: [B.user.id] });
    answers = { choice: (q) => (q.choices.some((c) => c.id === 'merge') ? 'merge' : null), confirm: true, prompt: [recovery] };
    await openBackupFile(file4, { fileName: 'x.json' });
    ok('the review says the author\'s signature could not be checked', reviews.length === 1 && /signature could not be checked/.test(reviews[0].note || ''), reviews[0] && reviews[0].note);

    // ---- "A file into this network…" with a backup of another network ----
    replaceDocument(templatesData.house, { origin: 'default' });
    const otherId = claimDocument('Annex', null);
    reviews.length = 0; asked.length = 0;
    answers = { confirm: true, prompt: [recovery] };
    await mergeFileIntoCard(otherId, clone(file4), 'x.json');
    ok('a backup picked for "A file into this network…" merges into that network, through the review', reviews.length === 1 && reviews[0].targetId === otherId
      && !asked.some((q) => q.kind === 'choice'), reviews[0] && reviews[0].targetId);

    // ---- From the list on the server (Members, Backups, Restore…) ----
    await fake.addBackup(siteId);
    ok('a local change after the backup', (await edit('Local change')) === 'pushed');
    asked.length = 0;
    answers = { choice: (q) => (q.choices.some((c) => c.id === 'update') ? 'update' : null), confirm: true };
    U.openSiteBackups(siteId);
    const restoreBtn = () => [...document.querySelectorAll('#serverSheetBody button')].find((b) => b.textContent === 'Restore…');
    ok('the network\'s Backups lists it with Restore…', await until(() => !!restoreBtn()));
    const pointsBefore = CarinoRestore.restorePointsOf(id).length;
    restoreBtn().click();
    ok('Restore… fetches it, opens it with this browser\'s keys and asks', await until(() => asked.some((q) => q.kind === 'choice' && q.title === 'Restore a backup')));
    ok('…and Replace with this copy brings it back, after a restore point', await until(() => libraryEntry(id).doc.nodes[0].name === 'Version one') && CarinoRestore.restorePointsOf(id).length > pointsBefore);
    ok('no recovery key was asked for', !asked.some((q) => q.kind === 'prompt'));

    // ---- A network not in this browser: its own network ----
    const other = clone(file1);
    const lib = loadLibrary(); delete lib[id]; persistLibrary(lib);
    Y.dropRec(id);
    asked.length = 0;
    answers = { choice: (q) => (q.choices.some((c) => c.id === 'open') ? 'open' : null), confirm: true };
    const okOpen = await openBackupFile(other, { fileName: 'topo_network-x_2026-11-10.json' });
    ok('a network not here opens as its own (or merges into one)', okOpen === true && !!libraryEntry(id) && libraryEntry(id).doc.nodes[0].name === 'Version one');


    setMergeResponder(heldMerge);
    setDialogResponder(null);
    void me;
    ok('no console error', !errors.length, errors.slice(0, 4).join(' | '));
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
