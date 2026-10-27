// The document path: the schema version with its one-shot migrations (R2), and
// the single replaceDocument() every document-replacing path goes through (R3).
//
// Two things are worth asserting and neither shows on screen:
//   1. A migration runs once. The old loader re-ran its shape guesses (`ips`,
//      an AP radio, the wlan0 rename, auto-bind) on every load, undo and
//      withDoc(), so a deliberate choice could be "repaired" by a reload. The
//      tests make a choice the migration would have overridden, then put the
//      document through every reader and check it is still there.
//   2. Every replacement resets the same things. Clear used to keep the saved
//      card, the notes, the report header and the undo history; each path is
//      dirtied the same way below and must come out clean.
window.addEventListener('load', async () => {
  const out = [];
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
  await loadScript('tests/fixtures/migration.js');   // docNeedsMigration
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);
  // The page's questions (js/dialog.js) are answered here: `answer` for a
  // yes/no, `promptWith` for a line of text, and the last question asked is
  // kept so a suite can say what it was asked.
  let answer = true, promptWith = null, lastAsked = null;
  const heldResponder = setDialogResponder((req) => {
    lastAsked = req.message;
    if (req.kind === 'prompt') return promptWith;
    if (req.kind === 'choice') return null;
    return req.kind === 'confirm' ? answer : undefined;
  });
  const undoDepth = () => (document.getElementById('undoBtn').disabled ? 0 : 1);

  // ---- 1. The version is in the document ----
  replaceDocument(templatesData.house, { origin: 'template' });
  const keys = Object.keys(serializeDoc());
  ok('serializeDoc stamps the schema version', serializeDoc().v === DOC_VERSION, String(serializeDoc().v));
  ok('and writes it first', keys[0] === 'v', keys.join(','));
  ok('the live document carries it', JSON.parse(liveDocJson()).v === DOC_VERSION);
  ok('a document without one reads as version 1', docVersionOf({ nodes: [] }) === 1 && docVersionOf({ v: 'two' }) === 1);

  // ---- 2. The templates were converted once and need no migration ----
  Object.keys(templatesData).forEach((k) => {
    const tpl = templatesData[k];
    ok(`template ${k} is stamped v${DOC_VERSION}`, tpl.v === DOC_VERSION, String(tpl.v));
    ok(`template ${k} needs no migration`, !docNeedsMigration(tpl));
  });
  // The blocks are not documents, but they reach the normalizer directly
  // (BUILTIN_BLOCKS starts them at v2, and insertBlock in js/add.js), which
  // no longer converts the legacy shapes.
  const legacyBlocks = Object.keys(SNIPPETS).filter((k) => SNIPPETS[k].nodes.some((n) => 'ips' in n
    || (n.type === 'ap' && Array.isArray(n.interfaces) && !n.interfaces.some(ifaceIsWireless))));
  ok('no block uses the legacy shapes', legacyBlocks.length === 0, legacyBlocks.join(','));
  // The check has to be able to fail, or the loop above proves nothing.
  ok('a legacy document does need migrating', docNeedsMigration({ nodes: [{ id: 'a', type: 'pc', ips: ['10.0.0.2/24'] }], links: [] }));
  ok('so does one with an unbound cable', docNeedsMigration({ nodes: [
    { id: 'a', type: 'pc', interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] },
    { id: 'b', type: 'pc', interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }], links: [{ id: 'l', source: 'a', target: 'b' }] }));

  // ---- 3. What the v1 -> v2 step does, and that it is pure ----
  const v1 = { nodes: [
      { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 0, ips: [] },
      { id: 'pc', type: 'pc', name: 'Laptop', x: 0, y: 100, ips: ['192.168.1.20/24'] },
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 200, interfaces: [], portCount: 8 }
    ], links: [{ id: 'r', source: 'ap', target: 'pc', medium: 'wireless' }, { id: 'c', source: 'sw', target: 'ap' }] };
  const frozen = JSON.stringify(v1);
  const m1 = migrateDoc(v1), m2 = migrateDoc(v1);
  ok('the migration does not touch its input', JSON.stringify(v1) === frozen);
  ok('and gives the same document twice', JSON.stringify(m1.doc) === JSON.stringify(m2.doc));
  ok('it stamps the result', m1.doc.v === DOC_VERSION && m1.from === 1 && !m1.newer);
  const mPc = m1.doc.nodes.find((n) => n.id === 'pc'), mAp = m1.doc.nodes.find((n) => n.id === 'ap');
  ok('ips become interfaces with stable ids', !('ips' in mPc) && mPc.interfaces[0].id === 'i1' && mPc.interfaces[0].ip === '192.168.1.20/24',
     JSON.stringify(mPc.interfaces));
  ok('an AP with no radio is given one', mAp.interfaces.some(ifaceIsWireless));
  ok('a radio client\'s eth0 becomes wlan0', mPc.interfaces[0].name === 'wlan0', mPc.interfaces[0].name);
  ok('every cable is bound', m1.doc.links.every((l) => l.sourceIface && l.targetIface), JSON.stringify(m1.doc.links));
  ok('a current document passes through untouched', migrateDoc(m1.doc).doc === m1.doc);

  // ---- 4. ...and runs once: a deliberate choice survives every reader ----
  replaceDocument(v1, { origin: 'file' });
  const pc = getNode('pc');
  pc.interfaces[0].name = 'eth0';          // the user says: it really is eth0
  getNode('ap').interfaces = getNode('ap').interfaces.filter((i) => !ifaceIsWireless(i));   // and this AP has no radio
  state.links.push({ id: 'loose', source: 'sw', target: 'pc', sourceIface: null, targetIface: null });
  save();
  const choice = () => getNode('pc') && getNode('pc').interfaces[0].name === 'eth0'
    && !getNode('ap').interfaces.some(ifaceIsWireless) && !state.links.find((l) => l.id === 'loose').sourceIface;
  ok('the choice is on the canvas', choice());
  applyDoc(liveDocJson());
  ok('reloading the saved document does not redo the migration', choice());
  getNode('sw').name = 'Core'; save(); undo();
  ok('nor does an undo', choice() && getNode('sw').name === 'SW');
  replaceDocument(JSON.parse(liveDocJson()), { origin: 'live' });
  ok('nor a reload', choice());
  const seen = CarinoLibrary.withDoc(JSON.parse(liveDocJson()), () => getNode('pc').interfaces[0].name);
  ok('nor a borrowed read (withDoc)', seen === 'eth0', seen);
  ok('and withDoc gives the canvas back', choice());

  // ---- 5. A newer document opens read-only ----
  const future = { v: DOC_VERSION + 5, nodes: [{ id: 'f1', type: 'pc', name: 'From the future', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.5/24', poe: 'class4' }], warranty: '2031-01-01' }],
    links: [], networks: [{ id: 'net1', cidr: '10.9.0.0/24' }] };
  replaceDocument(future, { origin: 'link' });
  ok('a newer document opens read-only', !!state.readOnly);
  ok('the banner says so', !document.getElementById('readOnlyBanner').classList.contains('hidden')
     && document.body.classList.contains('doc-readonly'));
  ok('the editing panels are out of reach', document.getElementById('cfgPanel-config').inert && document.getElementById('tabPanel-nodes').inert);
  ok('it is still drawn', getNode('f1') && getNode('f1').name === 'From the future');
  ok('the history entry holds it exactly as it arrived', liveDocJson() === JSON.stringify(future));
  ok('what goes out is the document as it arrived', JSON.stringify(outgoingDoc()) === JSON.stringify(future),
     JSON.stringify(outgoingDoc()).slice(0, 80));
  let exported = null;
  const realDownload = window.downloadJson;
  window.downloadJson = (payload) => { exported = payload; };
  exportJsonFile();
  window.downloadJson = realDownload;
  ok('the build file carries the unknown fields', exported && exported.doc.networks && exported.doc.nodes[0].warranty === '2031-01-01'
     && exported.doc.nodes[0].interfaces[0].poe === 'class4');
  getNode('f1').name = 'Edited'; save();
  ok('an edit is not kept', getNode('f1').name === 'From the future' && liveDocJson() === JSON.stringify(future));
  ok('a new device is refused', spawnNode('pc') === null && state.nodes.length === 1);
  ok('so is a note', spawnAnnotation({ text: 'x' }) === null && state.annotations.length === 0);
  ok('the refusal is said, not silent', document.getElementById('topoToast').classList.contains('show'));
  ok('undo has nothing to undo', undoDepth() === 0);

  // ---- 5a. ...yet it can be looked at ----
  // A click ends in the same mouseup as a drag, and that mouseup calls save().
  // It used to revert, which cleared the selection the press had just made and
  // claimed an edit: no device could be inspected. Driven through the real
  // pointer handlers, not select().
  const toastEl = document.getElementById('topoToast');
  const press = (el, x, y) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }));
  const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
  const release = () => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  toastEl.classList.remove('show');
  const nodeEl = document.getElementById('ui-node-f1');
  const box = nodeEl.getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  press(nodeEl, cx, cy); release();
  ok('a click selects a device in it', state.selectedId === 'f1' && state.selectedType === 'node', String(state.selectedId));
  ok('and its fields are shown', !document.getElementById('propertiesPane').classList.contains('hidden')
     && document.getElementById('propName').value === 'From the future');
  ok('with no false read-only toast', !toastEl.classList.contains('show'), toastEl.textContent);
  ok('and nothing is written', liveDocJson() === JSON.stringify(future));
  const at = { x: getNode('f1').x, y: getNode('f1').y };
  press(nodeEl, cx, cy); move(cx + 120, cy + 80); release();
  ok('a drag does not move it', getNode('f1').x === at.x && getNode('f1').y === at.y, `${getNode('f1').x},${getNode('f1').y}`);
  ok('and leaves it selected', state.selectedId === 'f1');
  ok('a plain save() that changed nothing is silent', (save(), !toastEl.classList.contains('show')) && state.selectedId === 'f1');
  getNode('f1').name = 'Edited again'; save();
  ok('a real edit is still undone, and says so', getNode('f1').name === 'From the future' && toastEl.classList.contains('show'));
  ok('without losing the selection', state.selectedId === 'f1' && document.getElementById('propName').value === 'From the future');
  toastEl.classList.remove('show');
  // The report header: typed for this report, not stored, and the dialog says
  // so rather than save() reverting it behind a generic toast.
  openReportDialog('site');
  ok('the report dialog says the header is not kept', /not kept/.test(document.getElementById('reportDialogBlurb').textContent));
  document.getElementById('report-site').value = 'Typed site';
  const typed = commitReportMeta();
  closeReportDialog();
  ok('the typed header is used for the report', typed.site === 'Typed site');
  ok('but not stored, and nothing is said', state.report === null && liveDocJson() === JSON.stringify(future) && !toastEl.classList.contains('show'));
  select(null, null);

  // ---- 5b. ...but what arrived raw does not leave raw, except as a file ----
  // The allowlist keeps hand-edited keys out of URLs and out of the library a
  // binder copies, and `v` is just a number anyone can type: passing a "newer"
  // document through would be a way past it. Only the build file (above) keeps
  // it as it arrived.
  const toastText = () => document.getElementById('topoToast').textContent;
  let shareThrew = false;
  try { await buildShareLink('doc', false); } catch (e) { shareThrew = true; }
  ok('a share link is not built from it', shareThrew);
  openShareDialog('doc');
  ok('the share dialog does not open for it', document.getElementById('shareDialog').classList.contains('hidden'));
  ok('and says why', /cannot be shared as a link/.test(toastText()), toastText());
  // The library as text, whichever store this browser gave it (IndexedDB or the fallback).
  const libText = () => JSON.stringify(CarinoLibrary.loadLibrary());
  const libBefore = libText();
  await keepThisNetwork();
  ok('Keep this network refuses it', libText() === libBefore && /read-only/.test(toastText()));
  ok('librarySave refuses it too', librarySave('Future', null) === null && libText() === libBefore);
  promptWith = 'Future template';
  await saveAsTemplate();
  promptWith = null;
  ok('Save as template refuses it', libText() === libBefore);
  // The bar on the canvas offers no Keep for it either: the read-only banner
  // sits there instead.
  ok('and the bar offers no Keep', document.getElementById('docBar').classList.contains('hidden'));

  // A card can still hold a document this build did not write (one kept from a
  // binder file or link is stored as it arrived). A binder link rewrites every
  // site through the serializer and leaves a newer Topo's out.
  const realLib = libBefore;
  const handEdited = { v: DOC_VERSION, extra: 'top-level secret',
    nodes: [{ id: 'h1', type: 'router', name: 'Hand edited', x: 0, y: 0, secret: 'node-level secret',
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.1.0.1/24', pin: '1234' }] }],
    links: [], annotations: [{ id: 't1', x: 0, y: 0, text: 'kept note', style: 'plain', size: 12, targets: [] }],
    report: { site: 'Kept site' } };
  persistLibrary({
    cardA: { id: 'cardA', name: 'Hand edited', doc: handEdited, created: 1, updated: 2 },
    cardB: { id: 'cardB', name: 'Future', doc: future, created: 1, updated: 3 }
  });
  const { file: linkFile, newer } = binderLinkFile();
  const linkJson = JSON.stringify(linkFile);
  ok('the binder link leaves the newer site out and counts it', newer === 1 && linkFile.sites.length === 1 && linkFile.sites[0].id === 'cardA', `${newer} / ${linkFile.sites.length}`);
  ok('and writes the rest through the serializer', !/secret|"pin"|warranty|From the future/.test(linkJson), linkJson.slice(0, 120));
  ok('without losing the notes or the report header', /kept note/.test(linkJson) && /Kept site/.test(linkJson));
  ok('the binder file still carries the cards as stored', JSON.stringify(binderFile()).includes('node-level secret'));
  const bUrl = await buildShareLink('binder', false);
  const bJson = await decodeBinderFragment(bUrl.slice(bUrl.indexOf('#') + 1));
  ok('the plain binder link decodes to the allowlisted sites only', !/secret|From the future/.test(bJson) && /Hand edited/.test(bJson), bJson.slice(0, 120));
  answer = false; lastAsked = null;
  openShareDialog('binder');
  await copyShareLink();
  answer = true;
  const asked = lastAsked;
  ok('copying a binder link with a newer site offers the binder file instead', /newer version of Topo/.test(asked || '') && document.getElementById('shareDialog').classList.contains('hidden'), asked);
  persistLibrary(JSON.parse(realLib));
  // A reload finds the same document, and so the same verdict.
  window.location.hash = '';
  load();
  ok('a reload opens it read-only again', !!state.readOnly && getNode('f1'));
  replaceDocument(templatesData.house, { origin: 'template' });
  ok('opening another network leaves read-only', !state.readOnly && document.getElementById('readOnlyBanner').classList.contains('hidden')
     && !document.getElementById('cfgPanel-config').inert && !document.body.classList.contains('doc-readonly'));

  // ---- 6. Every replacement path resets the same things ----
  // The network being replaced is an example (not kept), so every path that
  // would close it asks first. A kept one is saved instead of asked about
  // (tests/suites/library.js). Several paths below keep what they open, so
  // the tester's library is held and put back.
  const heldLib6 = CarinoLibrary.loadLibrary();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const dirty = () => {
    replaceDocument(templatesData.hospital, { origin: 'template' });
    spawnAnnotation({ text: 'old note' });
    state.report = { site: 'Old client' };
    getNode(state.nodes[0].id).name = 'Renamed'; save();
    select(state.nodes[1].id, 'node');
    state.linkSourceId = state.nodes[2].id;
  };
  // expect.lib: a card id, 'new' (kept, under an id of its own), or nothing
  // (not kept: an example or a link).
  const seenIds = new Set();
  const clean = (label, expect) => {
    ok(`${label}: selection dropped`, state.selectedId === null && state.linkSourceId === null);
    ok(`${label}: undo starts fresh`, undoDepth() === 0);
    const libOk = expect.lib === 'new' ? !!state.libraryId && !seenIds.has(state.libraryId) : state.libraryId === (expect.lib || null);
    if (state.libraryId) seenIds.add(state.libraryId);
    ok(`${label}: card is ${expect.lib || 'none'}`, libOk, String(state.libraryId));
    ok(`${label}: the old notes are gone`, !state.annotations.some((a) => a.text === 'old note'));
    ok(`${label}: the old report header is gone`, !(state.report && state.report.site === 'Old client'));
    ok(`${label}: the live document is the new one`, liveDocJson() === JSON.stringify(serializeDoc()));
  };

  dirty(); answer = true;
  document.getElementById('newNetworkBtn').click(); await tick();
  clean('New network', { lib: 'new' });
  ok('New network: the canvas is empty', state.nodes.length === 0 && state.links.length === 0);

  dirty(); answer = false; lastAsked = null;
  document.getElementById('newNetworkBtn').click(); await tick();
  ok('New network asks first, and No keeps everything', !!lastAsked && state.nodes.length > 0 && state.libraryId === null
     && state.annotations.some((a) => a.text === 'old note'), lastAsked);
  answer = true;

  dirty(); await applyTemplate(templatesData.bank); clean('template', {});
  dirty(); await applyImportedDoc({ kind: 'nettopology', version: 1, doc: cloneData(templatesData.bank) }); clean('file', { lib: 'new' });
  dirty(); openArrivedDocument(JSON.stringify(templatesData.campus)); clean('link', {});
  dirty(); replaceDocument(templatesData.retail, { libraryId: 'card-2', origin: 'library' }); clean('card', { lib: 'card-2' });
  dirty(); document.getElementById('landingExampleBtn').click(); await tick(); clean('example', {});
  dirty(); startNewNetwork(); clean('landing New', { lib: 'new' });

  // A bare { nodes } file used to half-swap: the old cables stayed.
  dirty();
  const before = state.links.length;
  let threw = null;
  try { await applyImportedDoc({ nodes: [{ id: 'solo', type: 'pc', name: 'Solo', x: 0, y: 0 }] }); } catch (e) { threw = e.message; }
  ok('a { nodes } file without links loads', !threw && state.nodes.length === 1 && getNode('solo'), threw || '');
  ok('and leaves none of the old cables behind', before > 0 && state.links.length === 0, `${before} -> ${state.links.length}`);
  clean('{ nodes } file', { lib: 'new' });
  ok('a document whose lists are not lists is not a document', !isDocShape({ nodes: 'x' }) && isDocShape({ nodes: [] }) && !isDocShape([]));

  // The setup intake (Add devices, new network) builds into a fresh document too.
  dirty();
  openAddDevices({ mode: 'new' }); applyAddDevices();
  clean('wizard', { lib: 'new' });
  state.settings.advanced = true; saveSettings(); applyProfile();

  // A reload of the document on screen keeps its undo timeline: Back/Forward
  // onto the same entry is not a new document.
  replaceDocument(templatesData.house, { origin: 'template' });
  getNode(state.nodes[0].id).name = 'Edited once'; save();
  replaceDocument(JSON.parse(liveDocJson()), { origin: 'live' });
  ok('a reload of the same document keeps undo', undoDepth() === 1);
  CarinoLibrary.persistLibrary(heldLib6);

  // ---- 7. One path: the hand-rolled ones are gone ----
  ['loadTemplateState', 'applyLoadedJson', 'loadDocIntoCanvas'].forEach((fn) =>
    ok(`${fn} no longer exists`, typeof window[fn] === 'undefined'));

  // ---- 8. Clear is gone from the toolbar and the handy bar ----
  ok('the toolbar has no Clear', !document.getElementById('clearCanvasBtn'));
  ok('New network sits in the Export menu', !!document.querySelector('#exportMenu #newNetworkBtn'));
  ok('the handy bar has no Clear', !document.getElementById('handyClear'));
  const report = document.getElementById('handyReport');
  ok('its slot went to the report', !!report && report.parentNode.id === 'handyBar');
  let opened = false;
  const realOpen = window.openReportDialog;
  window.openReportDialog = () => { opened = true; };
  report.click();
  window.openReportDialog = realOpen;
  ok('and it opens the report', opened);

  setDialogResponder(heldResponder);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
