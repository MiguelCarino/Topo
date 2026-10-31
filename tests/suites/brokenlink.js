// @realtime — awaits Web Crypto for the sealed case, so tests/run.sh runs it on a real clock.
// A link that does not read as a document (js/app.js arrivedUnreadable). It
// used to open the house demo labelled "Opened from a link", and over a kept
// card that dropped the card. Now:
//
//   1. it says the link is damaged, and on a fresh boot goes where a bare
//      visit goes, with the fragment off the address bar;
//   2. a cut-short share link, an old-style link that is no JSON and a link
//      whose JSON is no network all say so;
//   3. over a kept card the card stays open, untouched;
//   4. a sealed link whose contents are no network says so too, and keeps
//      what is on screen;
//   5. a word-like hash (a misspelt #simpel) is no link anyone sent: no
//      message for it;
//   6. a good link still opens as one.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 400) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const el = (id) => document.getElementById(id);
  const open = (id) => !el(id).classList.contains('hidden');
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return undefined; });
  const heldLib = loadLibrary();
  if (landingIsOpen()) landingHandledDocument();
  const DAMAGED = 'This link is damaged. Ask for it to be sent again.';
  const told = () => asked.some((r) => r.kind === 'tell' && r.message === DAMAGED);
  const arrive = async (frag) => {
    window.history.replaceState(null, '', '#' + frag);
    asked.length = 0;
    await load();
  };
  const campusJson = JSON.stringify(templatesData.campus);
  // Valid JSON, but no network: `nodes` must be a list (isDocShape, js/model.js).
  const NOT_A_DOC = '{"nodes":1}';

  try {
    // ---- 1. A fresh boot ----
    persistLibrary({});
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    const full = await encodeShareFragment(campusJson);
    await arrive(full.slice(0, Math.floor(full.length / 2)));
    ok('a cut-short link says it is damaged', told(), JSON.stringify(asked.map((r) => r.message)));
    ok('and is not passed off as a network opened from a link',
       !/Opened from a link/.test(el('docBarStatus').textContent) && _docOrigin !== 'link', `${_docOrigin} / ${el('docBarStatus').textContent}`);
    ok('the fragment comes off the address bar', window.location.hash === '', window.location.hash.slice(0, 20));
    if (landingIsOpen()) landingHandledDocument();

    // ---- 2. Other ways a link is no document ----
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    await arrive(btoa('not json'));
    ok('an old-style link that is no JSON says so', told());
    if (landingIsOpen()) landingHandledDocument();
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    await arrive(await encodeShareFragment(NOT_A_DOC));
    ok('and so does one whose JSON is no network', told());
    if (landingIsOpen()) landingHandledDocument();

    // ---- 3. Over a kept card ----
    // The card holds the network as this build writes it, so an autosave of
    // the unchanged canvas would write the same thing.
    replaceDocument(JSON.parse(campusJson), { libraryId: 'card1', origin: 'library' });
    persistLibrary({ card1: { id: 'card1', name: 'Campus', doc: JSON.parse(JSON.stringify(serializeDoc())), created: 1, updated: 2 } });
    const cardBefore = JSON.stringify(libraryEntry('card1').doc);
    const campusCount = state.nodes.length;
    await arrive(full.slice(0, 40));
    ok('the kept card stays open', state.libraryId === 'card1' && state.nodes.length === campusCount,
       `${state.libraryId} / ${state.nodes.length} of ${campusCount}`);
    ok('and its card is unchanged', JSON.stringify(libraryEntry('card1').doc) === cardBefore);
    ok('and the link still says it is damaged', told());
    ok('mid-session the fragment comes off too', window.location.hash === '');

    // ---- 3b. Over a read-only network (made by a newer Topo) ----
    // save() never re-writes one, so it cannot be what clears the fragment.
    persistLibrary({});
    replaceDocument(Object.assign(JSON.parse(campusJson), { v: DOC_VERSION + 1 }), { origin: 'file' });
    const roCount = state.nodes.length;
    await arrive(full.slice(0, 40));
    const roEntry = window.history.state && window.history.state[LIVE_STATE_KEY];
    ok('over a read-only network it stays, and says the link is damaged', !!state.readOnly && state.nodes.length === roCount && told());
    ok('and the fragment comes off, the entry holding the network as it arrived', window.location.hash === ''
       && !!roEntry && JSON.parse(roEntry).v === DOC_VERSION + 1 && JSON.parse(roEntry).nodes.length === roCount,
       window.location.hash.slice(0, 20) + ' / ' + (roEntry ? 'entry' : 'no entry'));

    // ---- 4. Sealed, and no network inside ----
    persistLibrary({});
    replaceDocument(JSON.parse(campusJson), { origin: 'file' });
    const pass = 'correct horse battery staple';
    const sealed = await sealFragment(NOT_A_DOC, SEAL_KIND.doc, pass);
    window.history.replaceState(null, '', '#' + sealed);
    asked.length = 0;
    const loading = load();
    ok('the sealed link asks for its passphrase', await until(() => open('unlockDialog')));
    el('unlockPass').value = pass;
    el('unlockForm').requestSubmit();
    await loading;
    ok('unsealed to no network, it says the link is damaged', told(), JSON.stringify(asked.map((r) => r.message)));
    ok('and the open network stays, not the house demo',
       state.nodes.length === templatesData.campus.nodes.length && !open('unlockDialog'), String(state.nodes.length));

    // ---- 5. A word-like hash ----
    const beforeWord = state.nodes.length;
    await arrive('simpel');
    ok('a misspelt word hash asks nothing', !asked.length, JSON.stringify(asked.map((r) => r.message)));
    ok('and leaves the open network where it is', state.nodes.length === beforeWord && _docOrigin !== 'link');

    // ---- 6. A good link ----
    await arrive(await encodeShareFragment(campusJson));
    ok('a good link still opens as one', _docOrigin === 'link' && state.nodes.length === templatesData.campus.nodes.length && !asked.length,
       `${_docOrigin} / ${state.nodes.length}`);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    persistLibrary(heldLib);
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
