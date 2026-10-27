// Keeping a network (R6): the document's identity, claimed-only autosave and
// its "Saved · just now", the Keep this network bar on demos and links, the
// storage banner, bringing a network back (Update / Open as a copy, newer
// wins), saved templates as library cards, one Back up, and the
// <site-slug>-<local date> filenames.
//
// The claims that matter are about not losing work and not keeping what
// nobody chose to keep: an example or a client's link is never written into
// this browser on its own, a kept network is never more than one flush behind
// its card, and re-importing your own file never makes a second card.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const shown = (id) => !el(id).classList.contains('hidden') && !el(id).hidden;
  const status = () => el('docBarStatus').textContent;
  const cards = () => CarinoLibrary.libraryEntries();
  const { LIBRARY_KEY, BINDER_EXPORT_KEY, USER_TPL_KEY } = CarinoLibrary;

  // The page's questions, answered: `promptWith` for a name, `choose` for the
  // Update / copy question (and what it offered is kept in `offered`).
  let promptWith = null, choose = null, offered = null, confirms = 0;
  const heldResponder = setDialogResponder((req) => {
    if (req.kind === 'prompt') return promptWith;
    if (req.kind === 'choice') { offered = { message: req.message, labels: req.choices.map((c) => c.label), ids: req.choices.map((c) => c.id) }; return choose; }
    if (req.kind === 'confirm') { confirms++; return true; }
    return undefined;
  });
  // The library through its own calls, so whichever store this browser gave
  // it (IndexedDB, or the localStorage fallback) is held and put back.
  const heldLib = CarinoLibrary.loadLibrary();
  CarinoLibrary.persistLibrary({});
  const held = [BINDER_EXPORT_KEY, USER_TPL_KEY].map((k) => [k, localStorage.getItem(k)]);
  held.forEach(([k]) => localStorage.removeItem(k));
  // Refused writes, in either store: the fallback's setItem throws at once,
  // while an IndexedDB transaction is refused a moment later and the banner
  // goes up when it is (settled()).
  const idb = CarinoLibrary.libraryStoreKind() === 'idb';
  const settled = () => CarinoLibrary.libraryWritesSettled().then(() => wait(0));
  const realSet = Storage.prototype.setItem;
  let realWrite = null;
  const refuse = (onlyLibrary) => {
    Storage.prototype.setItem = function (k, v) {
      if (!onlyLibrary || k === LIBRARY_KEY) throw new Error('QuotaExceededError');
      return realSet.call(this, k, v);
    };
    const a = CarinoLibrary.libraryAdapter();
    if (a && !realWrite) { realWrite = a.write; a.write = () => Promise.resolve(false); }
  };
  const allow = () => {
    Storage.prototype.setItem = realSet;
    const a = CarinoLibrary.libraryAdapter();
    if (a && realWrite) a.write = realWrite;
    realWrite = null;
  };
  let downloads = [];
  const realDownload = window.downloadJson;
  window.downloadJson = (payload, name) => { downloads.push({ payload: JSON.parse(JSON.stringify(payload)), name }); };

  try {
    // ---- An example is not kept, and says so ----
    replaceDocument(templatesData.house, { origin: 'template' });
    ok('an example has no card behind it', state.libraryId === null);
    ok('the bar says what it is, with Keep this network', shown('docBar') && el('docBar').classList.contains('unkept')
       && !el('docBarKeep').hidden && el('docBarName').hidden && /example/i.test(status()), status());
    ok('and the Export menu offers Keep too', !el('saveNetworkBtn').classList.contains('hidden'));
    // The suites run on a virtual clock with an 8 s budget, so the waits here
    // are spent sparingly: just past AUTOSAVE_MS (800) where the timer itself
    // is the claim, a synchronous flushAutosave() everywhere else.
    spawnNode('pc'); save();
    await wait(900);
    ok('editing an example writes nothing into this browser', cards().length === 0 && JSON.stringify(CarinoLibrary.loadLibrary()) === '{}',
       String(cards().length));

    // ---- Nor is a link someone sent ----
    openArrivedDocument(JSON.stringify(templatesData.bank));
    ok('a link opens unkept', state.libraryId === null && /link/i.test(status()), status());
    getNode(state.nodes[0].id).name = 'Edited from a link'; save();
    ok('and editing it keeps nothing either, even flushed', flushAutosave() === true && cards().length === 0);

    // ---- Keep this network ----
    replaceDocument(templatesData.house, { origin: 'template' });
    state.report = { site: 'Clínica José' }; save();
    // Not kept: the download is named after the report's site.
    ok('an unkept network’s files are named <site-slug>-<local date>', docFileStem() === `clinica-jose-${todayISO()}`, docFileStem());
    ok('the date is the local calendar date', todayISO() === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`);
    promptWith = 'Casa Roma';
    const id = await keepThisNetwork();
    ok('Keep this network makes it a card', !!id && cards().length === 1 && cards()[0].name === 'Casa Roma');
    ok('the card is the document’s identity', state.libraryId === id && state.docId === id && state.docUpdated === cards()[0].updated);
    ok('the bar now shows its name and "Saved · just now"', !el('docBar').classList.contains('unkept') && el('docBarKeep').hidden
       && el('docBarName').textContent === 'Casa Roma' && status() === 'Saved · just now', status());
    ok('and Keep leaves the Export menu', el('saveNetworkBtn').classList.contains('hidden'));
    ok('a kept network’s files are named after its card', docFileStem() === `casa-roma-${todayISO()}`, docFileStem());

    // ---- Autosave ----
    const node = state.nodes[0];
    node.name = 'Router renamed'; save();
    ok('an edit shows "Saving…"', status() === 'Saving…', status());
    ok('and has not been written yet', cards()[0].doc.nodes[0].name !== 'Router renamed');
    await wait(900);
    ok('a moment later it is in the card', CarinoLibrary.loadLibrary()[id].doc.nodes.find((n) => n.id === node.id).name === 'Router renamed');
    ok('and the bar says Saved again', status() === 'Saved · just now', status());
    ok('the identity follows the card', state.docUpdated === CarinoLibrary.loadLibrary()[id].updated);
    const stamp = CarinoLibrary.loadLibrary()[id].updated;
    save(); flushAutosave();
    ok('a save that changes nothing does not age the card', CarinoLibrary.loadLibrary()[id].updated === stamp && status() === 'Saved · just now');
    node.name = 'Router'; save();
    // Leaving the page writes a pending autosave at once.
    window.dispatchEvent(new Event('pagehide'));
    ok('leaving the page writes it at once', CarinoLibrary.loadLibrary()[id].doc.nodes.find((n) => n.id === node.id).name === 'Router');

    // ---- The identity travels in a file, not in an undo step ----
    ok('serializeDoc carries no identity (it is not an edit)', !('id' in serializeDoc()) && !('updated' in serializeDoc()));
    downloads = [];
    exportJsonFile();
    const file = downloads[0];
    ok('Back up this network downloads <slug>-<date>.nettopo.json', !!file && file.name === `casa-roma-${todayISO()}.nettopo.json`, file && file.name);
    ok('the file carries the card’s id, its version and its name', !!file && file.payload.doc.id === id
       && file.payload.doc.updated === CarinoLibrary.loadLibrary()[id].updated && file.payload.name === 'Casa Roma'
       && Object.keys(file.payload.doc)[0] === 'v');
    ok('and counts as backing that card up', CarinoLibrary.backupStatus().stale === false, CarinoLibrary.backupStatus().text);
    node.name = 'Changed after the back-up'; save(); flushAutosave();
    ok('until the card changes again', CarinoLibrary.backupStatus().stale === true, CarinoLibrary.backupStatus().text);
    // The binder file is the other size of the same Back up.
    downloads = [];
    await exportBinder();
    ok('Back up all clears it too, and is dated', CarinoLibrary.backupStatus().stale === false && downloads[0]
       && downloads[0].name === `networks-${todayISO()}.nettopo-binder.json`, downloads[0] && downloads[0].name);
    node.name = 'Router'; save(); flushAutosave();

    // ---- Bringing it back ----
    // The same file again, unchanged: the card opens, nothing is asked, and
    // there is still one card.
    downloads = []; exportJsonFile();
    const same = downloads[0].payload;
    offered = null;
    replaceDocument(templatesData.bank, { origin: 'template' });
    ok('re-importing your own file asks nothing', (await applyImportedDoc(same)) === true && offered === null);
    ok('makes no second card, and opens the card', cards().length === 1 && state.libraryId === id);

    // A newer copy (a colleague's edit of the file you sent): Update.
    const theirs = JSON.parse(JSON.stringify(same));
    theirs.doc.nodes[0].name = 'Their edit';
    theirs.doc.nodes[1].name = 'Their second edit';
    theirs.doc.updated = CarinoLibrary.loadLibrary()[id].updated + 60000;
    replaceDocument(templatesData.bank, { origin: 'template' });
    choose = 'update';
    await applyImportedDoc(theirs);
    ok('a newer copy is offered as an update, with the number of changes',
       !!offered && offered.ids.join(',') === 'copy,update' && offered.labels[1] === 'Update "Casa Roma" (2 changes)' && /newer/.test(offered.message),
       offered && offered.labels.join(' | '));
    ok('Update merges it into the same card', cards().length === 1 && state.libraryId === id
       && CarinoLibrary.loadLibrary()[id].doc.nodes[0].name === 'Their edit' && getNode(theirs.doc.nodes[0].id).name === 'Their edit');
    ok('newer wins: the card takes the file’s version', CarinoLibrary.loadLibrary()[id].updated === theirs.doc.updated);

    // An older copy: yours is newer, so "Open mine" or a copy.
    const older = JSON.parse(JSON.stringify(same));
    older.doc.nodes[0].name = 'Stale edit';
    older.doc.updated = 1000;
    offered = null; choose = 'copy';
    await applyImportedDoc(older);
    ok('an older copy says yours is newer, and offers Open mine', !!offered && offered.ids.join(',') === 'copy,mine' && /yours is newer/.test(offered.message),
       offered && offered.message);
    ok('Open as a copy makes a second card of its own', cards().length === 2 && state.libraryId !== id
       && CarinoLibrary.loadLibrary()[state.libraryId].name === 'Casa Roma (copy)');
    ok('and leaves yours as it was', CarinoLibrary.loadLibrary()[id].doc.nodes[0].name === 'Their edit');
    const copyId = state.libraryId;
    ok('the copy’s own file carries its own id', identifiedDoc(serializeDoc()).id === copyId);
    libraryDelete(copyId);
    ok('deleting the open card leaves it on screen, no longer kept', (releaseDocument(), state.libraryId === null && shown('docBar') && el('docBar').classList.contains('unkept')));

    // Cancelling the question opens nothing.
    replaceDocument(templatesData.bank, { origin: 'template' });
    const bankJson = JSON.stringify(serializeDoc());
    choose = null;
    ok('cancelling the question leaves the canvas alone', (await applyImportedDoc(older)) === false && JSON.stringify(serializeDoc()) === bankJson);

    // A link of a network you already have: Keep on the canvas is the same
    // network, not a name and a second card.
    const link = identifiedDoc(serializeDoc());   // the bank example, unkept: an identity of its own
    replaceDocument(CarinoLibrary.loadLibrary()[id].doc, { libraryId: id, origin: 'library' });
    const mineAsLink = identifiedDoc(serializeDoc());
    openArrivedDocument(JSON.stringify(mineAsLink));
    ok('your own network arriving as a link opens unkept, under its identity', state.libraryId === null && state.docId === id);
    promptWith = 'Should not be asked'; offered = null;
    ok('Keep recognises it: no name, no second card', (await keepThisNetwork()) === id && offered === null && cards().length === 1 && state.libraryId === id);
    ok('a link of a network nobody kept carries an identity too', !!link.id && link.id !== id && link.updated > 0);

    // "Keep as a copy", then Esc on the name: nothing was kept, so the network
    // must still be the one it was. Letting the id go before the name was
    // given used to orphan it — a later Keep made a second card without
    // asking, and its file and link were no longer recognised as this card.
    openArrivedDocument(JSON.stringify(mineAsLink));
    getNode(state.nodes[0].id).name = 'Edited in the link'; save();
    choose = 'copy'; promptWith = null; offered = null;
    ok('cancelling a copy’s name keeps nothing and keeps the identity',
       (await keepThisNetwork()) === null && state.docId === id && state.libraryId === null && cards().length === 1, String(state.docId));
    offered = null;
    ok('so the next Keep still asks the Update / copy question', (await keepThisNetwork()) === null && !!offered && offered.ids.includes('copy'),
       offered && offered.ids.join(','));
    ok('and its file still carries the card’s id', identifiedDoc(serializeDoc()).id === id);
    // Update or Open mine, depending on which copy the clock calls newer (the
    // card was stamped ahead of it by the newer-file case above): either way
    // the open network is that card again, not a second one.
    choose = offered.ids.find((c) => c !== 'copy');
    ok('answering the other way makes it the card again', (await keepThisNetwork()) === id && state.libraryId === id && cards().length === 1);
    choose = null;

    // ---- The storage banner ----
    ok('no storage banner while writes get through', !shown('storageBanner'));
    refuse();
    let flushed;
    try {
      node.name = 'Unsaveable'; getNode(state.nodes[0].id).name = 'Unsaveable'; save();
      flushed = flushAutosave();
      await settled();
    } finally { allow(); }
    // The fallback answers at once; IndexedDB's refusal arrives after the
    // call, and from then on the network is reported as not safe to close.
    ok('a write the browser refuses is reported', (idb || flushed === false) && flushAutosave() === false, String(flushed));
    // With only this card in the library, the open network is the whole back-up.
    ok('Back up all is not offered when this is the only card', el('storageBackupAllBtn').classList.contains('hidden'));
    ok('as a persistent banner with Back up now', shown('storageBanner') && !!el('storageBackupBtn'));
    ok('and the bar says Not saved', status() === 'Not saved' && el('docBarStatus').classList.contains('failed'), status());
    await wait(3400);   // past a toast's 3.2 s
    ok('the banner stays up (it is not a toast)', shown('storageBanner'));
    // A second card makes the whole binder worth offering, and the file must
    // carry the edits the store refused, not the card's older copy.
    const other = librarySave('Otra sede', null);
    await settled();
    refuse();
    let binder;
    try {
      getNode(state.nodes[0].id).name = 'Only in this tab'; save();
      flushAutosave();
      await settled();
      ok('with other cards here the banner offers Back up all', shown('storageBanner') && shown('storageBackupAllBtn')
         && el('storageBackupAllBtn').onclick === exportBinder);
      // The file exportBinder() writes, taken directly: the export itself
      // awaits IndexedDB (the bound-file handle), and headless Chromium's
      // virtual clock runs on through that wait and spends this suite's budget.
      binder = { payload: CarinoLibrary.binderFile() };
    } finally { allow(); }
    const mineIn = binder && binder.payload.sites.find((x) => x.id === id);
    // What the store holds: with IndexedDB the library in memory took the edit
    // and the disk refused it, so the disk is what has to lack it.
    let stored = CarinoLibrary.loadLibrary()[id];
    if (idb) { const disk = await CarinoLibrary.libraryAdapter().readCards([id]); stored = disk && disk[id] ? JSON.parse(disk[id]) : null; }
    ok('Back up all carries every card', !!binder && binder.payload.sites.length === 2 && binder.payload.sites.some((x) => x.id === other),
       binder && String(binder.payload.sites.length));
    ok('and the open network as it is on screen, not as the store last took it',
       !!mineIn && mineIn.doc.nodes.some((n) => n.name === 'Only in this tab')
       && !!stored && !stored.doc.nodes.some((n) => n.name === 'Only in this tab'));
    ok('a kept network that could not be written is asked about before it is replaced',
       (confirms = 0, await okToReplace('Replace?'), confirms === 1));
    getNode(state.nodes[0].id).name = 'Saveable'; save();
    const through = flushAutosave();
    await settled();
    ok('the next write that gets through takes it down', (idb || through === true) && flushAutosave() === true
       && !shown('storageBanner') && status() === 'Saved · just now', status());
    libraryDelete(other);

    // ---- Saved templates are library cards ----
    // The old store, as an earlier Topo left it, moves in once.
    localStorage.setItem(USER_TPL_KEY, JSON.stringify({ 'Mi plantilla': templatesData.house, '': { nodes: 'broken' } }));
    const movedOnce = CarinoLibrary.migrateUserTemplates();
    await settled();   // the old store goes once the library has it on disk
    ok('the old template store moves into the library once', movedOnce === 1 && localStorage.getItem(USER_TPL_KEY) === null);
    const tpl = cards().find((e) => e.template);
    ok('as a card flagged template, under its name', !!tpl && tpl.name === 'Mi plantilla' && tpl.doc.nodes.length === templatesData.house.nodes.length);
    ok('and a second boot finds nothing more to move', CarinoLibrary.migrateUserTemplates() === 0 && cards().filter((e) => e.template).length === 1);
    localStorage.setItem(USER_TPL_KEY, '["not a store"]');
    ok('a store of the wrong shape is cleared, not migrated', CarinoLibrary.migrateUserTemplates() === 0 && localStorage.getItem(USER_TPL_KEY) === null);
    localStorage.setItem(USER_TPL_KEY, JSON.stringify({ 'Otra': templatesData.house }));
    refuse(true);
    let moved;
    try { moved = CarinoLibrary.migrateUserTemplates(); await settled(); } finally { allow(); }
    // The fallback refuses the card outright; IndexedDB takes it into the
    // library and the disk refuses it. Either way the old store stays.
    ok('a full library keeps the old store for next time', (idb ? moved === 1 : moved === -1) && !!localStorage.getItem(USER_TPL_KEY), String(moved));
    const tplCount = () => cards().filter((e) => e.template).length;
    const tplBefore = tplCount();
    const again = CarinoLibrary.migrateUserTemplates();
    await settled();
    ok('and the next boot moves it onto the same card, not a second one', again === 1 && tplCount() === (idb ? tplBefore : tplBefore + 1)
       && cards().filter((e) => e.name === 'Otra').length === 1 && localStorage.getItem(USER_TPL_KEY) === null, tplBefore + ' -> ' + tplCount());
    CarinoLibrary.persistLibrary(CarinoLibrary.loadLibrary());   // clears the banner the refused write raised
    await settled();
    ok('USER_TPL_KEY has no writer left', typeof window.persistUserTemplates === 'undefined' && typeof window.saveUserTemplate === 'undefined'
       && typeof window.templateSnapshot === 'undefined');

    // Save as template: a card, updated in place under the same name.
    promptWith = 'Plantilla B';
    const tB = await saveAsTemplate();
    ok('Save as template makes a template card', !!tB && CarinoLibrary.loadLibrary()[tB].template === true);
    ok('and the network on screen stays the kept network it was', state.libraryId === id);
    const nTpl = cards().filter((e) => e.template).length;
    ok('saving it again under the same name updates it', (await saveAsTemplate()) === tB && cards().filter((e) => e.template).length === nTpl);

    // A template's own file brought back newer updates the template, and it
    // stays a template.
    replaceDocument(CarinoLibrary.loadLibrary()[tB].doc, { libraryId: tB, origin: 'library' });
    downloads = []; exportJsonFile();
    const tplFile = downloads[0].payload;
    tplFile.doc.nodes[0].name = 'Template edit'; tplFile.doc.updated += 60000;
    replaceDocument(templatesData.bank, { origin: 'template' });
    choose = 'update';
    await applyImportedDoc(tplFile);
    ok('updating a template from its file keeps it a template', CarinoLibrary.loadLibrary()[tB].template === true
       && CarinoLibrary.loadLibrary()[tB].doc.nodes[0].name === 'Template edit');
    replaceDocument(CarinoLibrary.loadLibrary()[id].doc, { libraryId: id, origin: 'library' });

    // On the landing: their own section, a Template badge, Duplicate.
    openLanding(false);
    const tplCards = [...document.querySelectorAll('#landingTemplateCards .landing-card')];
    ok('the landing lists templates apart from networks', shown('landingTemplatesHead') && tplCards.length === nTpl
       && !document.querySelector(`#landingCards .landing-card[data-id="${tB}"]`));
    ok('each with a Template badge', tplCards.every((c) => c.classList.contains('template') && c.querySelector('.landing-badge.tpl')));
    const dup = document.querySelector(`#landingTemplateCards .landing-card[data-id="${tB}"] .landing-tool[title="New network from this template"]`);
    ok('and a Duplicate that starts a network from it', !!dup);
    const before = cards().length;
    dup.click();
    const made = cards().find((e) => e.name === 'Plantilla B (copy)');
    ok('Duplicate adds a network card (not a template)', cards().length === before + 1 && !!made && !made.template
       && !!document.querySelector(`#landingCards .landing-card[data-id="${made.id}"]`));
    closeLanding();
    ok('templates travel in the back-up', CarinoLibrary.binderFile().sites.filter((s) => s.template).length === nTpl);
    ok('but are not sites of the estate', binderModel(libraryEntries().filter((e) => !e.template), {}).sites.every((s) => s.name !== 'Plantilla B'));
    // The Networks tab lists the same cards; picking one starts an unkept
    // network from it, without its identity.
    renderLibrary();
    const row = [...document.querySelectorAll('#userTemplateList .lib-item')].find((r) => /Plantilla B/.test(r.textContent));
    ok('the Networks tab lists them under My templates', !!row && shown('userTemplateSection'));
    await applyTemplate(CarinoLibrary.loadLibrary()[tB].doc);
    ok('picking one opens an unkept network with no identity of the template’s', state.libraryId === null && state.docId !== tB);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.downloadJson = realDownload;
    allow();
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    CarinoLibrary.persistLibrary(heldLib);
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
