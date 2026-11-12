// @realtime — the links are locked (PBKDF2, AES-GCM).
// Links back, step 8a (js/app.js "Sealed links", js/share.js "Reply tags"
// and "Open a link…", docs/SCOPE.md D366-D370):
//   1. the seal: a link with no tag is version 1 as it always was; with a
//      reply tag it is version 2, the tag read without a passphrase and
//      returned by the unseal; a tag changed in transit no longer opens; a
//      later version is "newer", rubbish is "damaged";
//   2. the client sends a report: its link carries a tag, and the passphrase
//      is kept under it with the report and the provider's name;
//   3. the provider opens it (a browser that keeps nothing): the passphrase
//      is asked, and the tag is held with it for the copy back, which carries
//      the same tag;
//   4. the client opens the copy back: no passphrase asked; a copy locked
//      with a new passphrase under the same tag asks, and says why; a tag
//      not known here asks as any link does; a newer version says so and
//      asks nothing; nothing is ever refused as "wrong network";
//   5. Open a link…: the fragment of any address, a bare fragment, a link
//      broken by mail; what holds none is said, not opened; a pasted reply
//      opens through the same door;
//   6. translated: every new string in every locale.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const asked = [];
  let promptAnswer = null;
  const heldResponder = setDialogResponder((req) => { asked.push(req); return req.kind === 'confirm' ? true : req.kind === 'prompt' ? promptAnswer : null; });
  const show = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 500) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  await until(() => !!window.TopoProviderMode && !!window.TopoIncidents && typeof canSeal === 'function');
  const PM = window.TopoProviderMode;
  const TI = window.TopoIncidents;
  const H = TI.hooks;
  const held = { open: H.open, copy: H.copy, saveBlob: window.saveBlob };
  const heldLib = CarinoLibrary.loadLibrary();
  const heldTags = localStorage.getItem('topo_reply_tags');
  H.open = () => {}; H.copy = async () => {};
  window.saveBlob = () => {};
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({
    v: DOC_VERSION,
    report: { client: 'Clinica Sol', site: 'Reception' },
    providers: [{ id: 'pI', name: 'Fibra Norte', service: 'internet', email: 'noc@fibra.example' }],
    nodes: [N('isp', 'cloud', { name: 'Internet', providers: ['pI'] }), N('rt', 'router', { name: 'Router', y: 100 }), N('pc', 'pc', { name: 'Reception PC', y: 200 })],
    links: [{ id: 'l1', source: 'isp', target: 'rt' }, { id: 'l2', source: 'rt', target: 'pc' }]
  });
  const PASS = 'test-pass-word-123';
  const fragOf = (url) => url.slice(url.indexOf('#') + 1);
  const clearSessions = () => { try { Object.keys(sessionStorage).filter((k) => /^topo_(provider|incbanner)_/.test(k)).forEach((k) => sessionStorage.removeItem(k)); } catch (e) { /* none */ } };
  const toast = () => (document.getElementById('topoToast') || {}).textContent || '';
  const code = async (p) => { try { await p; return 'opened'; } catch (e) { return e.code || String(e); } };
  const bytesOf = (frag) => _bytesFromB64url(frag.slice(2));
  const fragFrom = (bytes) => 'e~' + _b64urlFromBytes(bytes);

  try {
    setLocale('en');
    clearSessions();
    localStorage.removeItem('topo_reply_tags');
    CarinoLibrary.persistLibrary({});
    if (landingIsOpen()) landingHandledDocument();
    const json = JSON.stringify(site());

    // ---- 1. The seal ----
    const v1 = await sealFragment(json, SEAL_KIND.doc, PASS);
    ok('no tag: a version 1 link, as before', bytesOf(v1)[0] === 1 && sealedShape(v1).shape === 'ok' && sealedShape(v1).tag === null, show(sealedShape(v1)));
    const un1 = await unsealFragment(v1, PASS);
    ok('it opens, and names no tag', un1.json === json && un1.tag === null && un1.kind === SEAL_KIND.doc);
    const TAG = newReplyTag();
    ok('a reply tag is 16 hex characters, new each time', /^[0-9a-f]{16}$/.test(TAG) && newReplyTag() !== TAG, TAG);
    const v2 = await sealFragment(json, SEAL_KIND.doc, PASS, TAG);
    ok('with a tag: version 2, the tag read with no passphrase', bytesOf(v2)[0] === 2 && sealedShape(v2).tag === TAG, show(sealedShape(v2)));
    const un2 = await unsealFragment(v2, PASS);
    ok('it opens, and the unseal names the tag', un2.json === json && un2.tag === TAG);
    ok('a wrong passphrase is "passphrase"', await code(unsealFragment(v2, PASS + 'x')) === 'passphrase');
    const swapped = bytesOf(v2); swapped[3] ^= 0xff;
    ok('a tag changed on the way no longer opens (it is authenticated)', await code(unsealFragment(fragFrom(swapped), PASS)) === 'passphrase');
    const later = bytesOf(v2); later[0] = 3;
    ok('a later version is "newer"', sealedShape(fragFrom(later)).shape === 'newer' && await code(unsealFragment(fragFrom(later), PASS)) === 'newer');
    ok('rubbish and a stub are "damaged"', sealedShape('e~!!!').shape === 'damaged' && sealedShape('e~AQ').shape === 'damaged' && sealedShape(fragFrom(bytesOf(v2).slice(0, 30))).shape === 'damaged'
       && await code(unsealFragment('e~AQ', PASS)) === 'damaged');
    ok('a tag that is not one is ignored: version 1', bytesOf(await sealFragment(json, SEAL_KIND.doc, PASS, 'nope'))[0] === 1);
    ok('a binder link takes no tag', sealedShape(await buildShareLink('binder', true, PASS, { tag: TAG }).then(fragOf).catch(() => v1)).tag === null);

    // ---- 2. The client sends ----
    replaceDocument(site(), { origin: 'link', docId: 'rt-net' });
    const incId = await TI.createIncident({ symptom: 'internet', nodeIds: ['pc'], text: 'Nothing loads.', name: 'Ana', phone: '555-1', email: 'ana@x.example', routedTo: ['pI'] });
    const sent = await TI.sendIncident(incId, { providerIds: ['pI'], passphrase: PASS });
    ok('the client sent a locked link', sent.ok && sent.why === 'link' && !!sent.url, show(sent) + ' inc ' + show(incId));
    const sentTag = sealedShape(fragOf(sent.url)).tag;
    ok('the link carries a reply tag', validReplyTag(sentTag) === sentTag, show(sentTag));
    const rec = replyTagLookup(sentTag);
    ok('the passphrase is kept under it, with the report and whom it went to',
       !!rec && rec.pass === PASS && rec.incidentId === incId && rec.docId === 'rt-net' && show(rec.to) === '["Fibra Norte"]' && rec.at > 0, show(rec));
    ok('an unknown or malformed tag finds nothing', replyTagLookup('0000000000000000') === null && replyTagLookup('x') === null && replyTagLookup(null) === null);
    const clientLib = CarinoLibrary.loadLibrary();
    const clientTags = localStorage.getItem('topo_reply_tags');

    // ---- 3. The provider opens it, in a browser that keeps nothing ----
    CarinoLibrary.persistLibrary({});
    localStorage.removeItem('topo_reply_tags');
    clearSessions();
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    const unlocking = openSealedLink(fragOf(sent.url));
    ok('the provider is asked for the passphrase', await until(() => unlockDialogOpen()));
    _answerUnlock(PASS);
    await unlocking;
    ok('the document opened', state.docId === 'rt-net' && state.nodes.length === 3, `${state.docId} ${state.nodes.length}`);
    ok('the tag is held with the passphrase, in memory only', PM.state.tag.get('rt-net') === sentTag && PM.state.pass.get('rt-net') === PASS && _arrivalTag === null && localStorage.getItem('topo_reply_tags') === null);
    const back = await PM.buildVisitReturn(PASS, PM.state.tag.get('rt-net'));
    ok('the copy back is a locked link with the same tag', back.ok && back.why === 'link' && sealedShape(fragOf(back.url)).tag === sentTag, show(back.why));
    const backNew = await PM.buildVisitReturn('another-pass-word-9', sentTag);
    const backBare = await PM.buildVisitReturn('another-pass-word-9', null);
    ok('with no tag held it is a version 1 link', bytesOf(fragOf(backBare.url))[0] === 1);
    // A link with no tag leaves no tag held from the one before.
    const plain = openSealedLink(v1);
    await until(() => unlockDialogOpen());
    _answerUnlock(PASS);
    await plain;
    ok('a link with no tag leaves none held', !PM.state.tag.has(state.docId), show([...PM.state.tag.keys()]));

    // ---- 4. The client opens what came back ----
    CarinoLibrary.persistLibrary(clientLib);
    localStorage.setItem('topo_reply_tags', clientTags);
    clearSessions();
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    asked.length = 0;
    let opening = openSealedLink(fragOf(back.url));
    await opening;
    ok('the reply opens with no passphrase asked', state.docId === 'rt-net' && !unlockDialogOpen() && state.nodes.length === 3, `${state.docId} ${unlockDialogOpen()}`);
    ok('and says whose reply it is', toast() === 'A reply from Fibra Norte: opened with the passphrase you sent it with.', toast());
    ok('nothing was told as an error', !asked.some((r) => r.kind === 'tell'), show(asked.map((r) => r.message)));

    // The same tag, a new passphrase (the provider's page had forgotten it).
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    opening = openSealedLink(fragOf(backNew.url));
    ok('a reply locked with a new passphrase asks for it', await until(() => unlockDialogOpen()));
    ok('and says why', document.getElementById('unlockError').textContent === 'This reply was locked with a new passphrase. Ask whoever sent it for it.', document.getElementById('unlockError').textContent);
    _answerUnlock('another-pass-word-9');
    await opening;
    ok('typed, it opens', state.docId === 'rt-net' && !unlockDialogOpen());

    // A tag this browser does not know: asked, never refused.
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    opening = openSealedLink(v2);
    ok('a tag not known here asks as any link does', await until(() => unlockDialogOpen()) && document.getElementById('unlockError').textContent === '', document.getElementById('unlockError').textContent);
    _answerUnlock(PASS);
    await opening;
    ok('and opens', state.nodes.length === 3 && !unlockDialogOpen());

    // A newer version: said, nothing asked.
    asked.length = 0;
    const before = state.nodes.length;
    await openSealedLink(fragFrom(later));
    ok('a link from a newer Topo says so and asks no passphrase', !unlockDialogOpen() && asked.some((r) => r.kind === 'tell' && r.message === 'This link was made by a newer Topo. Update Topo to open it.')
       && state.nodes.length === before, show(asked.map((r) => r.message)));
    asked.length = 0;
    await openSealedLink('e~!!!');
    ok('a malformed sealed link says it is damaged and asks no passphrase', !unlockDialogOpen() && asked.some((r) => r.kind === 'tell' && r.message === 'This link is damaged. Ask for it to be sent again.'),
       show(asked.map((r) => r.message)));

    // ---- 5. Open a link… ----
    ok('the fragment of an address', linkFragmentOf('https://topo.carino.systems/#e~abc') === 'e~abc' && linkFragmentOf('http://localhost:7397/index.html?profile=x#e~abc') === 'e~abc');
    ok('a bare fragment, with or without #', linkFragmentOf('e~abc') === 'e~abc' && linkFragmentOf('#e~abc') === 'e~abc');
    ok('what mail does to a long link is taken off', linkFragmentOf('  <https://topo.carino.systems/#e~ab\n  cd ef>\n') === 'e~abcdef');
    ok('no fragment, an entry word, nothing: no link', linkFragmentOf('https://topo.carino.systems/') === null && linkFragmentOf('https://topo.carino.systems/#simple') === null
       && linkFragmentOf('hello') === null && linkFragmentOf('') === null && linkFragmentOf(null) === null);
    ok('the menu and the landing offer it', !!document.getElementById('openLinkBtn') && !!document.getElementById('landingOpenLinkBtn')
       && document.getElementById('openLinkBtn').textContent === '🔗 Open a link…');
    asked.length = 0;
    promptAnswer = 'not a link';
    ok('text with no link is said, nothing opened', await openLinkDialog() === false && asked.some((r) => r.kind === 'tell' && r.message === 'This is not a Topo link, or it was cut short.') && location.hash === '',
       show(asked.map((r) => r.message)));
    asked.length = 0;
    promptAnswer = 'https://topo.carino.systems/#e~!!!';
    ok('a sealed link cut to nothing is said, nothing opened', await openLinkDialog() === false && asked.some((r) => r.kind === 'tell') && location.hash === '');
    asked.length = 0;
    promptAnswer = null;
    ok('dismissed: nothing', await openLinkDialog() === false && asked.length === 1 && asked[0].kind === 'prompt' && asked[0].title === 'Open a link');
    // The reply pasted in: through the address, as the address bar would.
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    promptAnswer = 'https://topo.carino.systems/#' + fragOf(back.url);
    ok('a pasted reply is taken', await openLinkDialog() === true);
    ok('and opens here with no passphrase asked', await until(() => state.docId === 'rt-net' && state.nodes.length === 3) && !unlockDialogOpen(), `${state.docId} ${state.nodes.length}`);
    ok('the link leaves the address', await until(() => location.hash === ''), location.hash);

    // The store: a network no longer kept takes its passphrases with it.
    rememberReplyTag('00000000000000aa', { pass: PASS, cardId: 'gone-card', docId: 'x', to: ['A'] });
    rememberReplyTag('00000000000000bb', { pass: PASS, cardId: null, docId: 'y', to: [] });
    ok('a card that is gone takes its passphrase with it; an unkept network\'s stays', replyTagLookup('00000000000000aa') === null && !!replyTagLookup('00000000000000bb'));
    ok('nothing is kept without a passphrase or a tag', rememberReplyTag('00000000000000cc', { pass: '' }) === false && rememberReplyTag('zz', { pass: PASS }) === false);

    // ---- 6. Translated ----
    const keys = ['In the Topo app: Export, Open a link…, and paste the link.', '🔗 Open a link…', '🔗 Open a link', 'Open a link',
      'Paste the link you were sent. It opens here, in this Topo.', 'This is not a Topo link, or it was cut short.',
      'This link was made by a newer Topo. Update Topo to open it.', 'A reply from {who}: opened with the passphrase you sent it with.',
      'A reply to a link you sent: opened with the passphrase you sent it with.', 'This reply was locked with a new passphrase. Ask whoever sent it for it.'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const M = window.CarinoI18N.MESSAGES[loc] || {};
      const missing = keys.filter((k) => !Object.prototype.hasOwnProperty.call(M, k) || !M[k] || M[k] === k);
      ok(`${loc} carries every string of the links back`, missing.length === 0, missing.slice(0, 3).join(' | '));
    });
    ok('placeholders survive translation', ['es', 'pt-BR', 'ja', 'ru'].every((loc) => String(window.CarinoI18N.MESSAGES[loc]['A reply from {who}: opened with the passphrase you sent it with.']).includes('{who}')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    try { if (unlockDialogOpen()) abandonUnlock(); } catch (e) { /* closed */ }
    try { if (PM.state.on) PM.leaveProviderMode(); } catch (e) { /* off */ }
    clearSessions();
    Object.assign(H, { open: held.open, copy: held.copy });
    window.saveBlob = held.saveBlob;
    CarinoLibrary.persistLibrary(heldLib);
    try { if (heldTags === null) localStorage.removeItem('topo_reply_tags'); else localStorage.setItem('topo_reply_tags', heldTags); } catch (e) { /* storage blocked */ }
    setLocale('en');
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
