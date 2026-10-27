// "Save to binder": after one save picker, Export writes to that same file.
//
// The sharpest edge in the whole feature is right at the top. run.sh serves from
// 127.0.0.1, which IS a secure context, so window.showSaveFilePicker really
// exists in this headless Chromium. An unstubbed exportBinder() would therefore
// reach the real picker, get a SecurityError for want of a user gesture, fall
// through to the blob download, and the suite would go GREEN for entirely the
// wrong reason. So the API is taken away on line one and handed back at the end,
// and the unsupported path is asserted on spies rather than on outcomes.
//
// What cannot be tested here, and is hand-verified only: the real picker, a
// handle surviving a browser restart, and the browser's own permission prompt.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  const realPicker = window.showSaveFilePicker;
  delete window.showSaveFilePicker;
  // The page's questions (js/dialog.js) are answered here: a question with
  // nobody to click it would wait forever under the headless runner.
  let confirmAnswer = true;
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? confirmAnswer : req.kind === 'prompt' ? null : req.kind === 'choice' ? null : undefined));

  // IndexedDB's callbacks never fire under run.sh's virtual clock, so the real
  // store is swapped for an in-memory one. What is under test is everything
  // ABOVE the store — when to bind, when to write, when to fall back — which is
  // where the bugs live; the IndexedDB implementation is hand-verified.
  let _mem = null;
  const realHandleStore = setHandleStore({
    get: () => Promise.resolve(_mem),
    put: (h) => { _mem = h; return Promise.resolve(); },
    del: () => { _mem = null; return Promise.resolve(); },
  });

  const heldStore = loadLibrary();
  const heldExport = localStorage.getItem(BINDER_EXPORT_KEY);
  persistLibrary({}); localStorage.removeItem(BINDER_EXPORT_KEY);
  // Storage refusing the library's writes, in either store: the fallback's
  // setItem throws, and IndexedDB's transactions are refused.
  const idb = libraryStoreKind() === 'idb';
  const realWrite = idb ? libraryAdapter().write : null;
  const refuseIdb = (on) => { if (idb) libraryAdapter().write = on ? () => Promise.resolve(false) : realWrite; };
  await clearBinderHandle();

  loadDocState(templatesData.hospital); autoBindLinks(); librarySave('Torre A');
  loadDocState(templatesData.house); autoBindLinks(); librarySave('Casa Coyoacán');

  // ---- Without the API, nothing changes ----
  ok('a browser without the API reports that it cannot bind', binderCanBind() === false);
  let downloads = 0, lastDownload = null;
  const realDownload = window.downloadJson;
  window.downloadJson = (payload, name) => { downloads++; lastDownload = { payload, name }; };
  await exportBinder();
  ok('exporting still hands over a file', downloads === 1, String(downloads));
  ok('and it is the binder, correctly named',
     // Dated by the local calendar, like every download (docFileStem).
     !!lastDownload && lastDownload.name === `networks-${todayISO()}.nettopo-binder.json`
     && lastDownload.payload.kind === 'nettopo-binder' && lastDownload.payload.sites.length === 2,
     lastDownload ? lastDownload.name : 'nothing was handed over');
  ok('the export is recorded, so the landing stops saying "never"',
     !/never|not exported/i.test(binderStatus()), binderStatus());
  ok('nothing was bound', (await binderHandle()) === null);
  ok('and the landing shows no destination line',
     (renderLanding(), document.getElementById('binderTarget').hidden));

  // ---- The handle store ----
  // A plain object stands in for a FileSystemFileHandle; what is under test is
  // that a handle put away comes back, and that clearing means gone.
  const fake = { name: 'estate.json' };
  await putBinderHandle(fake);
  ok('a handle round-trips through IndexedDB', (await binderHandle()).name === 'estate.json');
  await clearBinderHandle();
  ok('and clearing it really clears it', (await binderHandle()) === null);

  // ---- The permission dance ----
  const handleWith = (query, request) => {
    const h = { name: 'estate.json', queries: 0, requests: 0, written: null, closed: 0, aborted: 0 };
    h.queryPermission = () => { h.queries++; return Promise.resolve(query); };
    h.requestPermission = () => { h.requests++; return Promise.resolve(request); };
    h.getFile = () => Promise.resolve({ text: () => Promise.resolve('') });
    h.createWritable = () => Promise.resolve({
      write: (t) => { h.written = t; return Promise.resolve(); },
      close: () => { h.closed++; return Promise.resolve(); },
      abort: () => { h.aborted++; return Promise.resolve(); },
    });
    return h;
  };
  const granted = handleWith('granted', 'denied');
  ok('an already-granted handle is not asked again',
     (await ensureBinderPermission(granted)) === true && granted.requests === 0,
     `${granted.queries} queries, ${granted.requests} requests`);
  const prompts = handleWith('prompt', 'granted');
  ok('one that needs asking is asked exactly once',
     (await ensureBinderPermission(prompts)) === true && prompts.requests === 1, String(prompts.requests));
  const denied = handleWith('prompt', 'denied');
  ok('and a refusal is a refusal', (await ensureBinderPermission(denied)) === false);
  ok('a handle with no permission API at all is not assumed to work',
     (await ensureBinderPermission({ name: 'x' })) === false);

  // ---- Writing ----
  const target = handleWith('granted', 'granted');
  await writeBinderTo(target, binderFile());
  ok('the bytes written parse back as a binder',
     !!binderFromImported(JSON.parse(target.written)), target.written.slice(0, 40));
  ok('and match what the download would have handed over',
     !!lastDownload && JSON.parse(target.written).sites.length === lastDownload.payload.sites.length);
  ok('the stream is closed exactly once, and never aborted',
     target.closed === 1 && target.aborted === 0, `${target.closed}/${target.aborted}`);

  const broken = handleWith('granted', 'granted');
  broken.createWritable = () => Promise.resolve({
    write: () => Promise.reject(new Error('disk full')),
    close: () => { broken.closed++; return Promise.resolve(); },
    abort: () => { broken.aborted++; return Promise.resolve(); },
  });
  let threw = false;
  try { await writeBinderTo(broken, binderFile()); } catch (e) { threw = true; }
  ok('a failed write aborts the stream rather than leaving it open',
     threw && broken.aborted === 1 && broken.closed === 0, `${broken.aborted}/${broken.closed}`);

  // ---- With the API present ----
  window.showSaveFilePicker = () => Promise.resolve(handleWith('granted', 'granted'));
  ok('the browser now reports that it can bind', binderCanBind() === true);
  await clearBinderHandle();
  downloads = 0;
  await exportBinder();
  ok('the first export binds a file instead of downloading', downloads === 0, String(downloads));
  const boundHandle = await binderHandle();
  ok('and remembers it', boundHandle && boundHandle.name === 'estate.json', String(boundHandle && boundHandle.name));
  ok('the landing says where the binder goes',
     (await refreshBinderBinding(), renderLanding(), !document.getElementById('binderTarget').hidden
      && /estate\.json/.test(document.getElementById('binderTargetName').textContent)),
     document.getElementById('binderTargetName').textContent);
  // The picker minted a fresh double on every call, so asserting `written` was
  // satisfied by the FIRST export. Clear it, then assert the second wrote.
  (await binderHandle()).written = null;
  await exportBinder();
  ok('and the second export writes straight to it, with no picker',
     downloads === 0 && (await binderHandle()).written !== null, String(downloads));
  // Make it behind first, or "no longer behind" is a claim about a state that
  // was already true before the write.
  librarySave('Torre A', Object.keys(loadLibrary())[0]);
  ok('a save after the last export puts the binder behind', /changed since/i.test(binderStatus()), binderStatus());
  (await binderHandle()).written = null;
  await exportBinder();
  ok('after a bound write the binder is no longer behind',
     !/changed since/i.test(binderStatus()), binderStatus());
  ok('and the write really happened', (await binderHandle()).written !== null);

  // A permission revoked between sessions must fall back, not fail.
  await clearBinderHandle();
  await putBinderHandle(handleWith('prompt', 'denied'));
  downloads = 0;
  await exportBinder();
  ok('a revoked permission falls back to the download rather than losing the file',
     downloads === 1, String(downloads));

  // The user closing the picker is not an error, and must not download either.
  await clearBinderHandle();
  window.showSaveFilePicker = () => Promise.reject(Object.assign(new Error('abort'), { name: 'AbortError' }));
  downloads = 0;
  await exportBinder();
  ok('cancelling the picker downloads instead of doing nothing at all', downloads === 1, String(downloads));
  ok('and binds nothing', (await binderHandle()) === null);

  // A file that already holds someone else's networks is merged, not obliterated.
  await clearBinderHandle();
  const foreign = handleWith('granted', 'granted');
  foreign.getFile = () => Promise.resolve({ text: () => Promise.resolve(JSON.stringify({
    kind: 'nettopo-binder', version: 1,
    sites: [{ id: 'theirs9', name: 'Clínica Norte', created: 1, updated: 2, doc: { nodes: [], links: [] } }] })) });
  window.showSaveFilePicker = () => Promise.resolve(foreign);
  confirmAnswer = true;
  const beforeAdopt = Object.keys(loadLibrary()).length;
  await exportBinder();
  ok('binding to a file that already holds networks offers to keep them',
     Object.keys(loadLibrary()).length === beforeAdopt + 1, `${beforeAdopt} -> ${Object.keys(loadLibrary()).length}`);
  await clearBinderHandle();
  libraryDelete('theirs9');
  confirmAnswer = false;
  await exportBinder();
  ok('and declining leaves this browser’s library alone',
     !loadLibrary().theirs9, Object.keys(loadLibrary()).join(','));
  // Declining the ADD still binds the file — otherwise there is no way to pick
  // a destination that happens to contain someone else's binder.
  ok('but the file is still bound', (await binderHandle()) !== null);

  // A file holding a NEWER copy of a network you already have is merged without
  // asking: newer-wins can never destroy anything newer, and skipping it was how
  // a binder edited on another machine got overwritten by this one's older copy.
  await clearBinderHandle();
  const mineId = Object.keys(loadLibrary())[0];
  const newerFile = handleWith('granted', 'granted');
  newerFile.getFile = () => Promise.resolve({ text: () => Promise.resolve(JSON.stringify({
    kind: 'nettopo-binder', version: 1,
    sites: [{ id: mineId, name: 'Edited elsewhere', created: 1, updated: Date.now() + 120000, doc: { nodes: [], links: [] } }] })) });
  window.showSaveFilePicker = () => Promise.resolve(newerFile);
  confirmAnswer = false;   // nothing to ask about: no unknown ids
  await exportBinder();
  ok('a newer copy in the picked file is read in before the file is overwritten',
     loadLibrary()[mineId].name === 'Edited elsewhere', loadLibrary()[mineId].name);
  ok('and the bytes written back carry it, rather than the older local copy',
     JSON.parse(newerFile.written).sites.some((x) => x.name === 'Edited elsewhere'),
     (JSON.parse(newerFile.written).sites.map((x) => x.name).join(',')));

  // ---- The file is never thinner than what it held ----
  // A double whose bytes persist across writes, as a real file's do: each
  // export reads what the previous one (or another machine) left there.
  const diskFile = (initial) => {
    const h = handleWith('granted', 'granted');
    h.written = initial;
    h.getFile = () => Promise.resolve({ text: () => Promise.resolve(h.written || '') });
    return h;
  };
  const namesIn = (h) => JSON.parse(h.written).sites.map((x) => x.name).sort().join(',');
  const site = (id, name, updated) => ({ id, name, created: 1, updated, doc: { nodes: [], links: [] } });

  // Declining "add them to this browser?" keeps them out of the LIBRARY. It
  // used to delete them from the FILE too: the handle was bound and the
  // library alone was written over it.
  await clearBinderHandle();
  const declined = diskFile(JSON.stringify({ kind: 'nettopo-binder', version: 1,
    sites: [site('strangerX', 'Bodega X', 5), site('strangerY', 'Bodega Y', 6)] }));
  window.showSaveFilePicker = () => Promise.resolve(declined);
  confirmAnswer = false;
  await exportBinder();
  ok('declining the add leaves the library without them', !loadLibrary().strangerX && !loadLibrary().strangerY);
  ok('but the file still holds them after the write',
     /Bodega X/.test(namesIn(declined)) && /Bodega Y/.test(namesIn(declined)), namesIn(declined));
  ok('alongside this browser\'s own networks', /Torre A|Edited elsewhere/.test(namesIn(declined)), namesIn(declined));
  // A second export over the same file must not drop them either: they were
  // carried, not exported by this browser, so they are not "deleted here".
  await exportBinder();
  ok('and a second export still carries them', /Bodega X/.test(namesIn(declined)) && /Bodega Y/.test(namesIn(declined)),
     namesIn(declined));
  ok('carried networks do not count as exported from here',
     !Object.prototype.hasOwnProperty.call(loadLastExport().seen, 'strangerX'), Object.keys(loadLastExport().seen).join(','));

  // A storage failure while adding them is the same story: still in the file.
  await clearBinderHandle();
  const unstorable = diskFile(JSON.stringify({ kind: 'nettopo-binder', version: 1, sites: [site('strangerZ', 'Bodega Z', 7)] }));
  window.showSaveFilePicker = () => Promise.resolve(unstorable);
  confirmAnswer = true;
  const realSetItem = Storage.prototype.setItem;
  let failNext = 1;
  Storage.prototype.setItem = function (k, v) {
    if (k === LIBRARY_KEY && failNext-- > 0) throw new Error('QuotaExceededError');
    return realSetItem.call(this, k, v);
  };
  refuseIdb(true);
  try { await exportBinder(); await libraryWritesSettled(); } finally { Storage.prototype.setItem = realSetItem; refuseIdb(false); }
  ok('a merge that could not be stored still leaves them in the file', /Bodega Z/.test(namesIn(unstorable)), namesIn(unstorable));

  // A bound file another machine has written to since: re-read at write time.
  // Exporting used to write this browser's library over it unread.
  await clearBinderHandle();
  const synced = diskFile('');
  window.showSaveFilePicker = () => Promise.resolve(synced);
  await exportBinder();
  const fromB = JSON.parse(synced.written);
  fromB.sites.push(site('machineB', 'Added on machine B', Date.now()));
  synced.written = JSON.stringify(fromB);
  await exportBinder();
  ok('a network another machine added to the bound file survives this one\'s export',
     /Added on machine B/.test(namesIn(synced)), namesIn(synced));

  // ...while a network deliberately deleted here really does leave the file.
  // Otherwise nothing could ever be removed from a bound binder.
  const goneId = Object.keys(loadLibrary()).find((id) => loadLibrary()[id].name === 'Casa Coyoacán');
  ok('(setup: the local network to delete is in the file)', !!goneId && /Casa Coyoacán/.test(namesIn(synced)), namesIn(synced));
  libraryDelete(goneId);
  await exportBinder();
  ok('a network deleted in this browser leaves the bound file on the next export',
     !/Casa Coyoacán/.test(namesIn(synced)), namesIn(synced));
  ok('without taking the other machine\'s network with it', /Added on machine B/.test(namesIn(synced)), namesIn(synced));

  // A network both hold, newer in the file, while storage is full. The merge
  // that would read the newer copy in cannot be stored, and the export used
  // to write this browser's older copy over it.
  const onDisk = JSON.parse(synced.written);
  const bothId = Object.keys(loadLibrary()).find((id) => onDisk.sites.some((x) => x.id === id));
  const theirCopy = onDisk.sites.find((x) => x.id === bothId);
  ok('(setup: the shared network is in the file)', !!theirCopy, namesIn(synced));
  if (theirCopy) {
    theirCopy.name = 'Newer on machine B';
    theirCopy.updated = (loadLibrary()[bothId].updated || 0) + 1000;
    synced.written = JSON.stringify(onDisk);
    Storage.prototype.setItem = function (k, v) {
      if (k === LIBRARY_KEY) throw new Error('QuotaExceededError');
      return realSetItem.call(this, k, v);
    };
    refuseIdb(true);
    try { await exportBinder(); await libraryWritesSettled(); } finally { Storage.prototype.setItem = realSetItem; refuseIdb(false); }
    ok('with storage full, the newer file copy is not overwritten by the older local one',
       /Newer on machine B/.test(namesIn(synced)) && JSON.parse(synced.written).sites.filter((x) => x.id === bothId).length === 1,
       namesIn(synced));
    // The fallback could not take the newer copy, so this browser's version
    // was not what went into the file. IndexedDB's library did take it (the
    // disk refused, which the banner says), so the file holds the library's
    // own version and is recorded as such.
    if (idb) ok('the library took the newer copy, and the export records that version',
       loadLibrary()[bothId].name === 'Newer on machine B' && loadLastExport().seen[bothId] === theirCopy.updated
       && storageFailed(), String(loadLastExport().seen[bothId]));
    else ok('and it is not recorded as exported from here',
       !Object.prototype.hasOwnProperty.call(loadLastExport().seen, bothId), Object.keys(loadLastExport().seen).join(','));
    // With storage back, the same export reads it in as usual.
    await exportBinder();
    ok('once storage works again the newer copy is read into the library',
       loadLibrary()[bothId].name === 'Newer on machine B' && /Newer on machine B/.test(namesIn(synced)),
       loadLibrary()[bothId].name);
  }

  // ---- Cleanup ----
  await clearBinderHandle();
  window.downloadJson = realDownload;
  if (realPicker) window.showSaveFilePicker = realPicker; else delete window.showSaveFilePicker;
  localStorage.removeItem(BINDER_EXPORT_KEY);
  persistLibrary(heldStore);
  if (heldExport !== null) localStorage.setItem(BINDER_EXPORT_KEY, heldExport);
  setHandleStore(realHandleStore);
  setDialogResponder(heldResponder);
  await refreshBinderBinding();

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
