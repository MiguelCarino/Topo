// @realtime — awaits Web Crypto, so tests/run.sh runs it on a real clock.
// Keeping the network out of places it should not be. Three claims:
//
//   1. The live document never rides the URL. It lives in history.state, so the
//      address bar, the history list and anything that syncs it stay bare,
//      whatever gets drawn. An arriving link is an envelope: it is opened, and
//      then it comes off the URL.
//   2. A sealed ('e~') link is ciphertext. It round-trips only with the right
//      passphrase, says nothing about what it carries, and fails loudly, never
//      silently, when it is wrong, tampered with or damaged.
//   3. The page's CSP holds: the app boots and runs under it with no violation.
//      That matters because a policy that quietly breaks the app gets deleted.
//
// Async because deflate and PBKDF2 both are.
window.addEventListener('load', async () => {
  const out = [];
  const realAlert = window.alert, realConfirm = window.confirm, realPrompt = window.prompt;
  window.alert = () => {}; window.confirm = () => true; window.prompt = () => null;
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const bare = () => window.location.pathname + window.location.search;
  const tick = () => new Promise((r) => setTimeout(r, 20));
  // Poll rather than sleep a guess: key stretching takes as long as it takes.
  const until = async (fn, tries = 400) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const el = (id) => document.getElementById(id);
  const open = (id) => !el(id).classList.contains('hidden');

  try {
  // ---- 1. The live document is not in the URL ----
  loadTemplateState(templatesData.hospital); autoBindLinks();
  window.history.replaceState(null, '', bare());
  save();
  spawnNode('router');
  ok('editing leaves the address bar bare', window.location.hash === '', window.location.hash.slice(0, 20));
  ok('and the history entry holds the document instead',
     liveDocJson() === JSON.stringify(serializeDoc()), String(liveDocJson()).slice(0, 40));
  const docAfterEdit = JSON.stringify(serializeDoc());

  // A reload: the same entry, no fragment. The card it belonged to comes back too.
  state.libraryId = 'card-7'; save();
  state.nodes = []; state.links = []; state.libraryId = null;
  await load();
  ok('a reload restores the document from the entry', JSON.stringify(serializeDoc()) === docAfterEdit);
  ok('and remembers which saved card it was', state.libraryId === 'card-7', String(state.libraryId));
  ok('a document in the entry is not the landing', shouldShowLanding() === false);
  state.libraryId = null;

  // An arriving plain link: opened, then taken off the URL.
  loadTemplateState(templatesData.house); autoBindLinks();
  const houseJson = JSON.stringify(serializeDoc());
  window.history.replaceState(null, '', '#' + await encodeShareFragment(houseJson));
  state.libraryId = 'someone-else';
  await load();
  ok('a shared link opens its document', JSON.stringify(serializeDoc()) === houseJson);
  ok('then comes off the URL', window.location.hash === '', window.location.hash.slice(0, 20));
  ok('into the entry, so a reload still finds it', liveDocJson() === houseJson);
  ok('and it is nobody’s saved card', state.libraryId === null, String(state.libraryId));

  // Old uncompressed links, the ones save() used to write, still open.
  window.history.replaceState(null, '', '#' + encodeDoc(JSON.parse(houseJson)));
  await load();
  ok('a legacy link still opens and is cleared too',
     JSON.stringify(serializeDoc()) === houseJson && window.location.hash === '');

  // A binder link leaves the URL once it is on the shelf.
  const binderJson = JSON.stringify({ kind: BINDER_KIND, version: BINDER_VERSION, exported: null,
      sites: [{ id: 's1', name: 'Torre A', doc: JSON.parse(houseJson), created: 1, updated: 2 }] });
  window.history.replaceState(null, '', '#' + await encodeBinderFragment(binderJson));
  await load();
  ok('a binder link fills the shelf', guestSites().length === 1, String(guestSites().length));
  ok('and comes off the URL', window.location.hash === '', window.location.hash.slice(0, 20));
  dismissGuestBinder(); landingHandledDocument();

  // ---- 2. Sealed links ----
  ok('sealing is available on this page', canSeal());
  const pass = generatePassphrase();
  ok('a generated passphrase is four groups of four, nothing to misread',
     /^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){3}$/.test(pass), pass);
  const many = new Set(Array.from({ length: 40 }, generatePassphrase));
  ok('and never the same twice', many.size === 40, String(many.size));

  const sealed = await sealFragment(houseJson, SEAL_KIND.doc, pass);
  ok('a sealed link carries the e~ marker', isSealedFragment(sealed) && sealed.startsWith('e~'), sealed.slice(0, 4));
  ok('and is taken for neither a document nor a binder', !isBinderFragment(sealed) && sealed[0] !== FRAG_SCHEME);
  const back = await unsealFragment(sealed, pass);
  ok('the right passphrase opens it byte for byte', back.json === houseJson && back.kind === SEAL_KIND.doc);
  const again = await sealFragment(houseJson, SEAL_KIND.doc, pass);
  ok('sealing twice gives two different links (fresh salt and IV)', again !== sealed);
  // Nothing readable survives: not a device name, not an address.
  const bytes = _bytesFromB64url(sealed.slice(2));
  const asText = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const name = JSON.parse(houseJson).nodes[0].name;
  ok('the ciphertext does not contain the plaintext', !asText.includes(name) && !sealed.includes(btoa(name).slice(0, 6)), name);
  const plainLen = (await encodeShareFragment(houseJson)).length;
  ok('and costs only a header over the plain compressed link', sealed.length - plainLen < 90, `${sealed.length} vs ${plainLen}`);

  const code = async (frag, p) => { try { await unsealFragment(frag, p); return 'opened'; } catch (e) { return e.code; } };
  ok('the wrong passphrase is refused', await code(sealed, pass + 'x') === 'passphrase');
  // Flip one ciphertext byte (past version, salt and IV): GCM must notice.
  const tampered = bytes.slice(); tampered[40] ^= 1;
  ok('a tampered link is refused, not half-decoded', await code('e~' + _b64urlFromBytes(tampered), pass) === 'passphrase');
  const wrongVersion = bytes.slice(); wrongVersion[0] = 9;
  ok('a version this build does not know is called damaged', await code('e~' + _b64urlFromBytes(wrongVersion), pass) === 'damaged');
  ok('so is a truncated one', await code(sealed.slice(0, 30), pass) === 'damaged');
  ok('and garbage', await code('e~!!!not base64!!!', pass) === 'damaged');

  const sealedBinder = await sealFragment(binderJson, SEAL_KIND.binder, pass);
  const bBack = await unsealFragment(sealedBinder, pass);
  ok('a binder seals the same way, and the kind rides inside', bBack.kind === SEAL_KIND.binder && bBack.json === binderJson);

  // ---- Opening one: the unlock dialog ----
  loadTemplateState(templatesData.errors); autoBindLinks(); save();
  const beforeUnlock = JSON.stringify(serializeDoc());
  window.history.replaceState(null, '', '#' + sealed);
  let loading = load();
  ok('an arriving sealed link asks for the passphrase', await until(() => open('unlockDialog')));
  ok('and has not touched the canvas yet', JSON.stringify(serializeDoc()) === beforeUnlock);
  el('unlockPass').value = 'definitely-wrong';
  el('unlockForm').requestSubmit();
  ok('a wrong passphrase says so and keeps asking',
     await until(() => /does not open/.test(el('unlockError').textContent) && open('unlockDialog')),
     el('unlockError').textContent);
  el('unlockPass').value = pass;
  el('unlockForm').requestSubmit();
  await loading;
  ok('the right one opens the network', JSON.stringify(serializeDoc()) === houseJson);
  ok('the dialog is gone and the field emptied', !open('unlockDialog') && el('unlockPass').value === '');
  ok('and the envelope came off the URL', window.location.hash === '' && liveDocJson() === houseJson);

  // Declining mid-session keeps what is on screen.
  window.history.replaceState(null, '', '#' + sealed);
  loading = load();
  await until(() => open('unlockDialog'));
  el('unlockCancelBtn').click();
  await loading;
  ok('declining keeps the network on screen', JSON.stringify(serializeDoc()) === houseJson);
  ok('and clears the link from the URL', window.location.hash === '' && !open('unlockDialog'));

  // A sealed binder goes to the shelf, like a plain one.
  window.history.replaceState(null, '', '#' + sealedBinder);
  loading = load();
  await until(() => open('unlockDialog'));
  el('unlockPass').value = pass;
  el('unlockForm').requestSubmit();
  await loading;
  ok('a sealed binder opens onto the shelf', guestSites().length === 1 && window.location.hash === '',
     `${guestSites().length} on shelf`);
  dismissGuestBinder(); landingHandledDocument();

  // ---- The share dialog ----
  loadTemplateState(templatesData.hospital); autoBindLinks(); save();
  const hospitalJson = JSON.stringify(serializeDoc());
  el('copyUrlBtn').click();
  ok('Copy link opens the share dialog', open('shareDialog'));
  ok('locked by default, with a passphrase already filled in',
     el('shareSeal').checked && /^[a-z2-9]{4}-/.test(el('sharePass').value), el('sharePass').value);
  el('shareCopyBtn').click();
  ok('it produces a sealed link', await until(() => el('shareLink').value.includes('#e~')), el('shareLink').value.slice(0, 40));
  const madeFrag = el('shareLink').value.split('#')[1];
  ok('that the dialog’s passphrase opens to this network',
     (await unsealFragment(madeFrag, el('sharePass').value)).json === hospitalJson);
  ok('and offers the passphrase as a separate copy', open('sharePassCopyBtn'));
  ok('while the address bar stays bare', window.location.hash === '');

  el('sharePass').value = 'short'; el('sharePass').dispatchEvent(new Event('input'));
  ok('a short passphrase cannot be used', el('shareCopyBtn').disabled);
  ok('and changing it withdraws the old link', !open('shareResult') && el('shareLink').value === '');

  el('shareSeal').checked = false; el('shareSeal').dispatchEvent(new Event('change'));
  ok('a plain link is a deliberate choice, with a warning', /Anyone who gets this link/.test(el('shareHint').textContent),
     el('shareHint').textContent);
  el('shareCopyBtn').click();
  ok('and it is the ordinary ~ link', await until(() => el('shareLink').value.includes('#~')));
  ok('that decodes without any passphrase',
     (await decodeFragment(el('shareLink').value.split('#')[1])) === hospitalJson);
  closeShareDialog();

  // ---- 3. The policy itself ----
  const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const policy = csp ? csp.getAttribute('content') : '';
  const directive = (name) => (policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) || '');
  ok('the page carries a CSP', !!csp);
  ok('scripts come from this origin only — nothing inline, nothing eval’d',
     directive('script-src') === "script-src 'self'", directive('script-src'));
  ok('and connect-src is an allowlist, not a wildcard',
     /^connect-src 'self'/.test(directive('connect-src')) && !directive('connect-src').includes('*'), directive('connect-src'));
  ok('no Referer leaves the page',
     (document.querySelector('meta[name="referrer"]') || {}).content === 'no-referrer');
  // Nothing so far — boot, dialogs, sealing — tripped the policy.
  await tick();
  const violations = window.__cspViolations || null;
  ok('the probe is listening for violations', Array.isArray(violations));
  ok('and the app ran under the policy without a single one', violations && violations.length === 0,
     (violations || []).slice(0, 5).join(' | '));
  } catch (e) {
    ok('the suite ran to the end', false, (e && (e.stack || e.message)) || String(e));
  } finally {
    dismissGuestBinder();
    try { sessionStorage.removeItem(GUEST_BINDER_KEY); } catch (e) { /* private mode */ }
    window.history.replaceState(null, '', bare());
    window.alert = realAlert; window.confirm = realConfirm; window.prompt = realPrompt;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
