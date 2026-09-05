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
  const realAlert = window.alert, realConfirm = window.confirm, realPrompt = window.prompt;
  let confirmAnswer = true;
  window.alert = () => {}; window.prompt = () => null;
  window.confirm = () => confirmAnswer;

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

  const heldStore = localStorage.getItem(LIBRARY_KEY);
  const heldExport = localStorage.getItem(BINDER_EXPORT_KEY);
  localStorage.removeItem(LIBRARY_KEY); localStorage.removeItem(BINDER_EXPORT_KEY);
  await clearBinderHandle();

  loadTemplateState(templatesData.hospital); autoBindLinks(); librarySave('Torre A');
  loadTemplateState(templatesData.house); autoBindLinks(); librarySave('Casa Coyoacán');

  // ---- Without the API, nothing changes ----
  ok('a browser without the API reports that it cannot bind', binderCanBind() === false);
  let downloads = 0, lastDownload = null;
  const realDownload = window.downloadJson;
  window.downloadJson = (payload, name) => { downloads++; lastDownload = { payload, name }; };
  await exportBinder();
  ok('exporting still hands over a file', downloads === 1, String(downloads));
  ok('and it is the binder, correctly named',
     !!lastDownload && lastDownload.name === 'networks.nettopo-binder.json'
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

  // ---- Cleanup ----
  await clearBinderHandle();
  window.downloadJson = realDownload;
  if (realPicker) window.showSaveFilePicker = realPicker; else delete window.showSaveFilePicker;
  localStorage.removeItem(LIBRARY_KEY); localStorage.removeItem(BINDER_EXPORT_KEY);
  if (heldStore !== null) localStorage.setItem(LIBRARY_KEY, heldStore);
  if (heldExport !== null) localStorage.setItem(BINDER_EXPORT_KEY, heldExport);
  setHandleStore(realHandleStore);
  window.alert = realAlert; window.confirm = realConfirm; window.prompt = realPrompt;
  await refreshBinderBinding();

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
