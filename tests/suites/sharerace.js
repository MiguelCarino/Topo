// @realtime — awaits Web Crypto, so tests/run.sh runs it on a real clock.
// Sealing and unsealing take a few hundred milliseconds, and the page stays
// live meanwhile. Two races:
//
//   1. The share dialog: a link still locking when the choices change (a new
//      passphrase typed or generated, the seal unticked, the dialog closed and
//      reopened) is dropped, never shown or copied beside a passphrase that
//      cannot open it (_shareGen, js/share.js).
//   2. The unlock dialog: Back/Forward while a sealed link asks, or while it is
//      checking, abandons that run. The dialog closes, and the late result
//      never writes into the entry navigation brought back (abandonUnlock,
//      _unlockRun; popstate in js/app.js). Nor does the abandoned run take
//      the decline (a save into that entry), nor a wrong passphrase's late
//      refusal ask again.
//
// The seal and the unseal are gated so each race is hit every time, not only
// when the timing happens to fall that way.
window.addEventListener('load', async () => {
  const out = [];
  const heldResponder = setDialogResponder((req) => (req.kind === 'prompt' ? null : req.kind === 'choice' ? (req.choices[0] || {}).id : true));
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const bare = () => window.location.pathname + window.location.search;
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 400) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const el = (id) => document.getElementById(id);
  const open = (id) => !el(id).classList.contains('hidden');
  const docJson = () => JSON.stringify(serializeDoc());

  // buildShareLink and openSealedLink look these globals up at call time, so
  // rebinding them holds each one at the gate until the test lets it through.
  const realSeal = sealFragment, realUnseal = unsealFragment;
  let sealGate = Promise.resolve(), releaseSeal = () => {};
  const armSeal = () => { sealGate = new Promise((r) => { releaseSeal = r; }); };
  let unsealGate = Promise.resolve(), releaseUnseal = () => {}, unsealsDone = 0;
  const armUnseal = () => { unsealGate = new Promise((r) => { releaseUnseal = r; }); };
  const clip = [];
  const hadClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  try {
  window.sealFragment = async (...a) => { await sealGate; return realSeal(...a); };
  window.unsealFragment = async (...a) => { await unsealGate; try { return await realUnseal(...a); } finally { unsealsDone++; } };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => { clip.push(s); } } });
  ok('the seal is gated through the global', sealFragment !== realSeal && unsealFragment !== realUnseal);

  loadDocState(templatesData.hospital); autoBindLinks();
  window.history.replaceState(null, '', bare());
  save();

  // Starts a sealed copy and holds it at 'Locking…'.
  const startLocking = async () => {
    armSeal(); clip.length = 0;
    el('shareCopyBtn').click();
    return until(() => /Locking/.test(el('shareCopyBtn').textContent));
  };
  const finish = async () => { releaseSeal(); return until(() => !_shareBusy); };
  const nothingShown = () => !open('shareResult') && el('shareLink').value === '' && !open('sharePassCopyBtn') && clip.length === 0;
  const opensWithField = async () => {
    try { return (await realUnseal(el('shareLink').value.split('#')[1], sharePassphrase())).kind === SEAL_KIND.doc; }
    catch (e) { return false; }
  };

  // A) A passphrase typed while it locks.
  openShareDialog('doc');
  ok('A: the copy shows Locking… while it seals', await startLocking(), el('shareCopyBtn').textContent);
  el('sharePass').value = 'zzzz-yyyy-xxxx-wwww'; el('sharePass').dispatchEvent(new Event('input'));
  ok('A: the seal finishes', await finish());
  await tick();
  ok('A: a link sealed with the old passphrase is not shown or copied', nothingShown(),
     `result ${open('shareResult')}, link ${el('shareLink').value.slice(0, 30)}, ${clip.length} copied`);
  el('shareCopyBtn').click();
  ok('A: copying again makes a link', await until(() => el('shareLink').value.includes('#e~')));
  ok('A: and the passphrase in the field opens it', await opensWithField());

  // B) New passphrase clicked while it locks.
  openShareDialog('doc');
  await startLocking();
  el('shareNewPass').click();
  await finish(); await tick();
  ok('B: a new passphrase while locking drops the old link', nothingShown(),
     `result ${open('shareResult')}, ${clip.length} copied`);
  el('shareCopyBtn').click();
  await until(() => el('shareLink').value.includes('#e~'));
  ok('B: the next link opens with the new passphrase', await opensWithField());

  // C) Closed and reopened (a fresh passphrase) while it locks.
  openShareDialog('doc');
  await startLocking();
  closeShareDialog(); openShareDialog('doc');
  await finish(); await tick();
  ok('C: closing and reopening while locking shows and copies nothing', nothingShown(),
     `result ${open('shareResult')}, ${clip.length} copied`);

  // D) The seal unticked while it locks.
  openShareDialog('doc');
  el('shareDone').textContent = '';
  await startLocking();
  el('shareSeal').checked = false; el('shareSeal').dispatchEvent(new Event('change'));
  await finish(); await tick();
  ok('D: unticking the seal while locking shows no locked link',
     !el('shareLink').value.includes('#e~') && !/Locked link copied/.test(el('shareDone').textContent) && clip.length === 0,
     `${el('shareLink').value.slice(0, 30)} / ${el('shareDone').textContent} / ${clip.length} copied`);

  // E) Control: nothing changes, so the link is the one shown and copied.
  openShareDialog('doc');
  await startLocking();
  await finish();
  ok('E: left alone, the link is shown', await until(() => el('shareLink').value.includes('#e~')));
  await until(() => clip.length > 0);
  ok('E: and copied exactly once, as shown', clip.length === 1 && clip[0] === el('shareLink').value, `${clip.length} copied`);
  ok('E: and the field’s passphrase opens it', await opensWithField());
  closeShareDialog();
  releaseSeal(); sealGate = Promise.resolve();

  // ---- The unlock dialog and Back/Forward ----
  const pass = 'test-pass-1234';
  loadDocState(templatesData.house); autoBindLinks();
  const houseJson = docJson();
  const binderJson = JSON.stringify({ kind: BINDER_KIND, version: BINDER_VERSION, exported: null,
      sites: [{ id: 's1', name: 'Torre A', doc: JSON.parse(houseJson), created: 1, updated: 2 }] });
  const sealed = '#' + await realSeal(houseJson, SEAL_KIND.doc, pass);
  const sealedBinder = '#' + await realSeal(binderJson, SEAL_KIND.binder, pass);
  ok('the sealed links carry the e~ marker', sealed.startsWith('#e~') && sealedBinder.startsWith('#e~'));

  // Entry A: an ordinary network in its own entry.
  loadDocState(templatesData.hospital); autoBindLinks();
  window.history.replaceState(null, '', bare());
  save();
  const aJson = window.history.state && window.history.state.topoDoc;
  ok('entry A holds its network', typeof aJson === 'string' && aJson === docJson());
  const entryIsA = () => !!window.history.state && window.history.state.topoDoc === aJson && docJson() === aJson;
  const settle = async () => { for (let i = 0; i < 25; i++) await tick(); };

  // 1) Back while it asks.
  window.location.hash = sealed;
  ok('1: the sealed link asks for its passphrase', await until(() => open('unlockDialog')));
  // The abandoned run must return, not take the decline: that would save()
  // into the entry Back brought back, or rewrite it and load again. Back to a
  // live entry does neither, so any call is the stale run's.
  const realSave = window.save, realReplace = window.history.replaceState;
  let writes = 0;
  window.save = function () { writes++; return realSave.apply(this, arguments); };
  window.history.replaceState = function () { writes++; return realReplace.apply(this, arguments); };
  try {
    window.history.back();
    ok('1: Back closes the dialog', await until(() => window.location.hash === '' && !open('unlockDialog')),
       `hash ${window.location.hash.slice(0, 8)}, dialog ${open('unlockDialog')}`);
    await settle();
  } finally { window.save = realSave; window.history.replaceState = realReplace; }
  ok('1: the abandoned run writes nothing', writes === 0, `${writes} writes`);
  ok('1: and entry A is untouched', entryIsA(), String(window.history.state && window.history.state.topoDoc).slice(0, 40));

  // 2) Forward asks again; Back while it checks.
  window.history.forward();
  ok('2: Forward asks again', await until(() => open('unlockDialog')));
  for (let i = 0; i < 5; i++) await tick();
  ok('2: and keeps asking', open('unlockDialog'));
  armUnseal(); let doneBefore = unsealsDone;
  el('unlockPass').value = pass; el('unlockForm').requestSubmit();
  ok('2: the passphrase goes to the check', await until(() => /Checking/.test(el('unlockOpenBtn').textContent)));
  window.history.back();
  await until(() => window.location.hash === '');
  releaseUnseal();
  await until(() => unsealsDone > doneBefore);
  await settle();
  ok('2: Back during Checking… leaves entry A and the canvas alone', entryIsA(),
     `${String(window.history.state && window.history.state.topoDoc).slice(0, 30)} / canvas ${docJson() === houseJson ? 'house' : 'other'}`);
  ok('2: the URL stays bare and the dialog is gone', window.location.hash === '' && !open('unlockDialog'),
     `hash ${window.location.hash.slice(0, 8)}, dialog ${open('unlockDialog')}`);

  // 3) A sealed binder, Back during the check.
  window.location.hash = sealedBinder;
  await until(() => open('unlockDialog'));
  armUnseal(); doneBefore = unsealsDone;
  el('unlockPass').value = pass; el('unlockForm').requestSubmit();
  await until(() => /Checking/.test(el('unlockOpenBtn').textContent));
  window.history.back();
  await until(() => window.location.hash === '');
  releaseUnseal();
  await until(() => unsealsDone > doneBefore);
  await settle();
  ok('3: a late binder does not wipe entry A', entryIsA(), JSON.stringify(window.history.state).slice(0, 40));
  ok('3: nor fill the shelf', guestSites().length === 0, `${guestSites().length} on shelf`);
  if (landingIsOpen()) landingHandledDocument();

  // 4) The latest run still opens: ask, Back, Forward, then answer.
  window.location.hash = sealed;
  await until(() => open('unlockDialog'));
  window.history.back();
  await until(() => window.location.hash === '' && !open('unlockDialog'));
  window.history.forward();
  ok('4: Forward asks once more', await until(() => open('unlockDialog')));
  el('unlockPass').value = pass; el('unlockForm').requestSubmit();
  ok('4: the latest run opens the network', await until(() => docJson() === houseJson && window.location.hash === ''),
     `hash ${window.location.hash.slice(0, 8)}`);
  ok('4: the dialog is gone and the field emptied', !open('unlockDialog') && el('unlockPass').value === '');
  ok('4: into its own entry', !!window.history.state && window.history.state.topoDoc === houseJson);
  window.history.back();
  await until(() => docJson() === aJson);
  await settle();
  ok('4: and entry A is still A', entryIsA());

  // 5) A wrong passphrase still checking when Back is pressed: its refusal
  //    comes after, and must not ask again, with an error, in an entry that
  //    has no sealed link.
  window.location.hash = sealed;
  await until(() => open('unlockDialog'));
  armUnseal(); doneBefore = unsealsDone;
  el('unlockPass').value = 'not-the-pass'; el('unlockForm').requestSubmit();
  ok('5: the wrong passphrase goes to the check', await until(() => /Checking/.test(el('unlockOpenBtn').textContent)));
  window.history.back();
  await until(() => window.location.hash === '');
  releaseUnseal();
  await until(() => unsealsDone > doneBefore);
  await settle();
  ok('5: the late refusal does not reopen the dialog', !open('unlockDialog') && el('unlockError').textContent === '',
     `dialog ${open('unlockDialog')}, error "${el('unlockError').textContent}"`);
  ok('5: and entry A is still A', entryIsA());
  } catch (e) {
    ok('the suite ran to the end', false, (e && (e.stack || e.message)) || String(e));
  } finally {
    releaseSeal(); releaseUnseal();
    window.sealFragment = realSeal; window.unsealFragment = realUnseal;
    if (hadClipboard) Object.defineProperty(navigator, 'clipboard', hadClipboard); else delete navigator.clipboard;
    abandonUnlock(); closeShareDialog();
    dismissGuestBinder();
    try { sessionStorage.removeItem(GUEST_BINDER_KEY); } catch (e) { /* private mode */ }
    window.history.replaceState(null, '', bare());
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
