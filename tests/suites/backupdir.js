// A back-up folder with no server (js/backupdir.js; docs/SCOPE.md step 5b,
// D108). The File System Access API is stubbed: run.sh serves from
// 127.0.0.1, a secure context, so window.showDirectoryPicker really exists in
// this Chromium and would otherwise be reached (as tests/suites/binderfile.js
// explains). The folder and its files are plain objects; the handle store is
// in memory (IndexedDB never answers under the virtual clock). Covered:
//   - without the API: Settings shows no Back-ups section, and Download a
//     back-up is the download it always was;
//   - Choose a folder… keeps the handle; the section names it; Stop using it
//     forgets it;
//   - Download a back-up (and a restore point's back-up) is written into the
//     folder under the download's name, the permission asked on that click;
//     refused, it is the download;
//   - the daily copy: written after the autosave only while the folder is
//     already granted (never a prompt), the same day's file written over,
//     unchanged not written again;
//   - keeping: only files Topo wrote and recorded are deleted, per D103;
//   - another folder starts its own list (Topo never deletes there what it
//     wrote elsewhere).
// What cannot be tested here, and is hand-checked only: the real picker, the
// browser's permission prompt, a handle surviving a restart.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const BD = window.CarinoBackupDir;
  const realPicker = window.showDirectoryPicker;
  delete window.showDirectoryPicker;
  const mem = new Map();
  const heldStore = BD.setBackupDirStore({ get: async (k) => (mem.has(k) ? mem.get(k) : null), put: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); } });
  const heldResponder = setDialogResponder((q) => (q.kind === 'confirm' ? true : null));
  const realDownload = window.downloadJson;
  let downloads = [];
  window.downloadJson = (payload, name) => { downloads.push({ payload, name }); };
  const heldLib = loadLibrary();
  const heldSettings = Object.assign({}, state.settings);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // A folder: files by name; its permission now and what a request answers.
  const folder = (name, perm, onRequest) => {
    const d = { name, files: new Map(), perm, onRequest, queries: 0, requests: 0, removed: [] };
    d.queryPermission = async () => { d.queries++; return d.perm; };
    d.requestPermission = async () => { d.requests++; d.perm = d.onRequest; return d.perm; };
    d.getFileHandle = async (n) => ({ createWritable: async () => { let buf = ''; return { write: async (x) => { buf += x; }, close: async () => { d.files.set(n, buf); }, abort: async () => {} }; } });
    d.removeEntry = async (n) => { if (!d.files.has(n)) { const e = new Error('gone'); e.name = 'NotFoundError'; throw e; } d.files.delete(n); d.removed.push(n); };
    d.isSameEntry = async (o) => o === d;
    return d;
  };
  try {
    persistLibrary({});
    loadDocState(templatesData.house); autoBindLinks();
    const id = librarySave('Casa Roma');
    ok('a kept network', !!libraryEntry(id));

    // ---- Without the API ----
    BD.renderBackupDirSettings();
    ok('without the API, Settings shows no Back-ups', document.getElementById('setBackupSec').hidden === true);
    await BD.saveBackupJson({ kind: 'nettopology', version: 1, doc: libraryEntry(id).doc }, 'topo_casa-roma_2026-11-10.json');
    ok('…and Download a back-up is the download', downloads.length === 1 && downloads[0].name === 'topo_casa-roma_2026-11-10.json');

    // ---- Choosing a folder ----
    let next = folder('OneDrive - Topo', 'granted', 'granted');
    window.showDirectoryPicker = async () => next;
    BD.renderBackupDirSettings();
    ok('with the API, Settings shows Back-ups, no folder yet', !document.getElementById('setBackupSec').hidden && document.getElementById('setBackupDirName').textContent === '(none)'
      && document.getElementById('setBackupDirPick').textContent === 'Choose a folder…' && document.getElementById('setBackupDirStop').hidden);
    await BD.chooseBackupDir();
    const dirA = next;
    ok('Choose a folder… keeps the handle', mem.get(BD.BACKUP_DIR_KEY) === dirA);
    ok('the section names it, offers Change… and Stop using it, daily copy ticked', document.getElementById('setBackupDirName').textContent === 'OneDrive - Topo'
      && document.getElementById('setBackupDirPick').textContent === 'Change…' && !document.getElementById('setBackupDirStop').hidden && document.getElementById('setBackupDirAuto').checked);

    // ---- Download a back-up into the folder ----
    downloads = [];
    const card = libraryEntry(id);
    downloadNetworkJson(card.name, card.id, card.updated, card.doc, '2026-11-10', null);
    await new Promise((r) => setTimeout(r, 50));
    const name1 = topoFileName({ site: 'Casa Roma', date: '2026-11-10' }, 'json');
    ok('a back-up is written into the folder under the download\'s name', dirA.files.has(name1) && downloads.length === 0, [...dirA.files.keys()].join(','));
    const saved = JSON.parse(dirA.files.get(name1) || '{}');
    ok('the same file a download gives', saved.kind === 'nettopology' && saved.doc && saved.doc.id === id && /topo-v\d+\.json/.test(saved.$schema || ''));
    ok('granted: no prompt', dirA.requests === 0);
    // The permission lapsed: asked on the click; refused, the download.
    dirA.perm = 'prompt'; dirA.onRequest = 'denied';
    await BD.saveBackupJson({ kind: 'nettopology', version: 1, doc: card.doc }, 'topo_casa-roma_2026-11-11.json');
    ok('a lapsed permission is asked on the click; refused, it is the download', dirA.requests === 1 && downloads.length === 1 && !dirA.files.has('topo_casa-roma_2026-11-11.json'));
    dirA.onRequest = 'granted';
    await BD.saveBackupJson({ kind: 'nettopology', version: 1, doc: card.doc }, 'topo_casa-roma_2026-11-11.json');
    ok('granted on the click, it is written there', dirA.requests === 2 && dirA.files.has('topo_casa-roma_2026-11-11.json') && downloads.length === 1);

    // ---- The daily copy ----
    dirA.perm = 'prompt'; dirA.onRequest = 'granted';
    const reqs = dirA.requests;
    ok('the daily copy never prompts: not granted, nothing written', (await BD.backupDirAutoSave(id)) === 'no-permission' && dirA.requests === reqs);
    dirA.perm = 'granted';
    const day = todayISO();
    const dailyName = topoFileName({ site: 'Casa Roma', date: day }, 'json');
    dirA.files.delete(dailyName);
    ok('granted: today\'s file is written', (await BD.backupDirAutoSave(id)) === 'saved' && dirA.files.has(dailyName));
    ok('unchanged, it is not written again', (await BD.backupDirAutoSave(id)) === 'same');
    const lib = loadLibrary(); lib[id].doc.nodes[0].name = 'Changed today'; lib[id].updated = Date.now(); persistLibrary(lib);
    const count = dirA.files.size;
    ok('changed: the same day\'s file is written over', (await BD.backupDirAutoSave(id)) === 'saved' && dirA.files.size === count && /Changed today/.test(dirA.files.get(dailyName)));
    // The autosave hook, a quiet minute (short here).
    BD.hooks.quietMs = 20;
    lib[id].doc.nodes[0].name = 'After the autosave'; lib[id].updated = Date.now() + 1; persistLibrary(lib);
    BD.backupDirAfterSave(id);
    await new Promise((r) => setTimeout(r, 120));
    ok('after the autosave and a quiet spell it is written', /After the autosave/.test(dirA.files.get(dailyName) || ''));
    state.settings.backupDirAuto = false;
    lib[id].doc.nodes[0].name = 'Not auto'; lib[id].updated = Date.now() + 2; persistLibrary(lib);
    BD.backupDirAfterSave(id);
    await new Promise((r) => setTimeout(r, 120));
    ok('with the tick off, nothing is written after edits', !/Not auto/.test(dirA.files.get(dailyName) || ''));
    delete state.settings.backupDirAuto;

    // ---- Two kept networks with the same name ----
    loadDocState(templatesData.house); autoBindLinks();
    const id2 = librarySave('Casa Roma 2');
    const lib2 = loadLibrary(); lib2[id2].name = 'Casa Roma'; lib2[id2].doc.nodes[0].name = 'The other one'; lib2[id2].updated = Date.now() + 3; persistLibrary(lib2);
    const firstText = dirA.files.get(dailyName);
    ok('a second network with the same name is saved', (await BD.backupDirAutoSave(id2)) === 'saved');
    const otherName = [...dirA.files.keys()].find((n) => n !== dailyName && /^topo_casa-roma-[a-z0-9]+_\d{4}-\d{2}-\d{2}\.json$/.test(n) && /The other one/.test(dirA.files.get(n)));
    ok('…under its own name (a piece of its id), not over the first one\'s file', !!otherName && dirA.files.get(dailyName) === firstText, [...dirA.files.keys()].join(','));
    ok('…and kept apart: each network has its own list', BD.state.files.filter((f) => f.cardId === id2).length === 1 && BD.state.files.some((f) => f.cardId === id));
    ok('its next save keeps that name', (await BD.backupDirAutoSave(id2)) === 'same');
    dirA.files.delete(otherName);
    BD.state.files = BD.state.files.filter((f) => f.cardId !== id2);
    const libDel = loadLibrary(); delete libDel[id2]; persistLibrary(libDel);
    delete state.settings.backupDirAuto;

    // ---- Keeping: only Topo's own files ----
    const now = Date.UTC(2026, 10, 10, 12);
    const H = 3600e3;
    // Files Topo wrote: one a day for 20 days back, recorded.
    const own = [];
    for (let i = 1; i <= 20; i++) {
      own.push({ name: `topo_casa-roma_${new Date(now - i * 24 * H).toISOString().slice(0, 10)}.json`, at: now - i * 24 * H, hash: '' });
    }
    own.forEach((f) => dirA.files.set(f.name, '{}'));
    BD.state.files = own.slice();
    dirA.files.set('notes.txt', 'mine'); dirA.files.set('topo_casa-roma_2025-01-01.json', 'someone else\'s');
    BD.hooks.now = () => now;
    await BD.saveBackupJson({ kind: 'nettopology', version: 1, doc: libraryEntry(id).doc }, 'topo_casa-roma_2026-11-10.json');
    const times = own.map((f) => f.at).concat([now]);
    const keep = BD.backupKeep(times, now, Intl.DateTimeFormat().resolvedOptions().timeZone);
    const expectDropped = own.filter((f, i) => !keep[i]).map((f) => f.name).sort();
    ok('files beyond D103 are deleted', expectDropped.length > 0 && JSON.stringify(dirA.removed.slice().sort()) === JSON.stringify(expectDropped), dirA.removed.join(','));
    ok('files Topo did not write are left alone', dirA.files.has('notes.txt') && dirA.files.has('topo_casa-roma_2025-01-01.json'));
    ok('what is kept is still recorded', BD.state.files.length === own.length + 1 - expectDropped.length);
    BD.hooks.now = () => Date.now();

    // ---- Another folder; Stop using it ----
    next = folder('USB', 'granted', 'granted');
    await BD.chooseBackupDir();
    ok('another folder starts its own list', mem.get(BD.BACKUP_DIR_KEY) === next && BD.state.files.length === 0 && document.getElementById('setBackupDirName').textContent === 'USB');
    await BD.forgetBackupDir();
    ok('Stop using it forgets the folder', !mem.has(BD.BACKUP_DIR_KEY) && document.getElementById('setBackupDirName').textContent === '(none)');
    downloads = [];
    await BD.saveBackupJson({ kind: 'nettopology', version: 1, doc: libraryEntry(id).doc }, 'topo_x_2026-11-10.json');
    ok('…and back-ups are downloads again', downloads.length === 1);
    window.showDirectoryPicker = async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); };
    ok('closing the picker is not a failure', (await BD.chooseBackupDir()) === null && !mem.has(BD.BACKUP_DIR_KEY));
    await tick();
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  } finally {
    BD.setBackupDirStore(heldStore);
    setDialogResponder(heldResponder);
    window.downloadJson = realDownload;
    if (realPicker) window.showDirectoryPicker = realPicker; else delete window.showDirectoryPicker;
    persistLibrary(heldLib);
    state.settings = heldSettings;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
  }
}, 400); });
