// ---- A back-up folder, with no server (docs/SCOPE.md step 5b, D108) ----
// On Chrome and Edge (the File System Access API), Settings, Back-ups lets
// a person pick a folder once: a OneDrive, Google Drive or Nextcloud folder
// whose own desktop app uploads what lands in it, a USB disk, a share. Then:
//   - Download a back-up (and the back-up a restore point offers) is written
//     there instead of to Downloads, under the same name
//     (topo_<org>_<site>_<date>.json). The folder's permission is asked only
//     on that click; refused, or no folder, it is the download as before;
//   - with "Also back up a network I change, once a day" ticked, a kept
//     network that changed is written there a minute after the last edit,
//     but only while the browser still grants the folder (it never asks
//     outside a click). The same day's file is written over, so there is one
//     a day per network;
//   - the files Topo wrote there are kept as the server keeps its backups
//     (D103: everything from the last 24 hours, then the newest of each of
//     the last 7 days, 4 weeks and 12 months that have one). Topo deletes
//     only files it wrote itself and recorded; anything else in the folder
//     is left alone.
// The folder is remembered in IndexedDB (nettopo_handles, key 'backupDir',
// as the binder file is: js/library.js). Safari and Firefox have no such API:
// the section stays hidden and nothing changes. No outside request.
// Load order: ... library -> restore -> backupdir -> ... -> app -> settings.

const BACKUP_DIR_KEY = 'backupDir';
const BACKUP_DIR_FILES_KEY = 'backupDirFiles';
const BACKUP_DIR_QUIET_MS = 60 * 1000;
const BACKUP_DIR_FILES_MAX = 2000;
// Read at call time: a test stubs it, a browser may gain it.
const backupDirCan = () => typeof window.showDirectoryPicker === 'function';
// The store, swappable for tests (the headless runner has no IndexedDB).
let _backupDirStore = {
    get: (k) => _idb('readonly', (st) => st.get(k)),
    put: (k, v) => _idb('readwrite', (st) => st.put(v, k)),
    del: (k) => _idb('readwrite', (st) => st.delete(k))
};
const _backupDir = { handle: null, files: null, loaded: null, timers: new Map(), hooks: { quietMs: BACKUP_DIR_QUIET_MS, now: () => Date.now() } };
function setBackupDirStore(store) { const prev = _backupDirStore; _backupDirStore = store; _backupDir.handle = null; _backupDir.files = null; _backupDir.loaded = null; return prev; }
const bdGet = (k) => Promise.resolve().then(() => _backupDirStore.get(k)).catch(() => null);
const bdPut = (k, v) => Promise.resolve().then(() => _backupDirStore.put(k, v)).catch(() => null);
const bdDel = (k) => Promise.resolve().then(() => _backupDirStore.del(k)).catch(() => null);

// The folder and the list of files Topo wrote there, read once.
function loadBackupDir() {
    if (!backupDirCan()) return Promise.resolve(null);
    if (!_backupDir.loaded) {
        _backupDir.loaded = Promise.all([bdGet(BACKUP_DIR_KEY), bdGet(BACKUP_DIR_FILES_KEY)]).then(([hd, files]) => {
            _backupDir.handle = hd && typeof hd.getFileHandle === 'function' ? hd : null;
            _backupDir.files = Array.isArray(files) ? files.filter((f) => f && typeof f.name === 'string' && Number.isFinite(f.at)) : [];
            renderBackupDirSettings();
            return _backupDir.handle;
        });
    }
    return _backupDir.loaded;
}
const backupDirAuto = () => state.settings.backupDirAuto !== false;

async function backupDirPermission(handle, ask) {
    if (!handle || typeof handle.queryPermission !== 'function') return false;
    try {
        if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
        if (!ask || typeof handle.requestPermission !== 'function') return false;
        return await handle.requestPermission({ mode: 'readwrite' }) === 'granted';
    } catch (e) { return false; }
}

// Picks a folder (from a click). -> the handle, or null.
async function chooseBackupDir() {
    if (!backupDirCan()) return null;
    let handle;
    try { handle = await window.showDirectoryPicker({ id: 'topo-backups', mode: 'readwrite' }); }
    catch (e) { return null; }   // closed: not a failure
    if (!handle) return null;
    await loadBackupDir();
    const changed = !_backupDir.handle || !(typeof handle.isSameEntry === 'function' && await handle.isSameEntry(_backupDir.handle).catch(() => false));
    _backupDir.handle = handle;
    // A different folder starts its own list: Topo never deletes there what
    // it wrote somewhere else.
    if (changed) { _backupDir.files = []; await bdPut(BACKUP_DIR_FILES_KEY, []); }
    await bdPut(BACKUP_DIR_KEY, handle);
    if (state.settings.backupDirAuto === false) { delete state.settings.backupDirAuto; saveSettings(); }
    renderBackupDirSettings();
    return handle;
}
async function forgetBackupDir() {
    await loadBackupDir();
    _backupDir.handle = null; _backupDir.files = [];
    await bdDel(BACKUP_DIR_KEY); await bdDel(BACKUP_DIR_FILES_KEY);
    renderBackupDirSettings();
}

// Writes text as `name` in the folder. -> true when written.
async function writeBackupDirFile(handle, name, text) {
    const fh = await handle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try { await w.write(text); await w.close(); }
    catch (e) { try { await w.abort(); } catch (e2) { /* gone */ } throw e; }
    return true;
}
// Records a file written and drops what retention no longer keeps (only
// files on the list: Topo's own).
async function noteBackupDirFile(handle, name, hash, cardId) {
    const now = _backupDir.hooks.now();
    const files = (_backupDir.files || []).filter((f) => f.name !== name);
    files.push(Object.assign({ name, at: now, hash: hash || '' }, cardId ? { cardId } : {}));
    // Kept per network: by its id when known; a file recorded before ids
    // were (no cardId) goes with the one network writing that name, else by
    // the name up to the date.
    const ids = new Map();
    files.forEach((f) => { if (f.cardId) { const st = backupDirGroup(f.name); if (!ids.has(st)) ids.set(st, new Set()); ids.get(st).add(f.cardId); } });
    const groupOf = (f) => {
        if (f.cardId) return 'id:' + f.cardId;
        const set = ids.get(backupDirGroup(f.name));
        return set && set.size === 1 ? 'id:' + [...set][0] : 'name:' + backupDirGroup(f.name);
    };
    const groups = new Map();
    files.forEach((f) => { const k = groupOf(f); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); });
    const drop = new Set();
    let tz = 'UTC';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { tz = 'UTC'; }
    groups.forEach((list) => {
        const keep = backupKeep(list.map((f) => f.at), now, tz);
        list.forEach((f, i) => { if (!keep[i]) drop.add(f); });
    });
    for (const f of drop) {
        try { await handle.removeEntry(f.name); }
        catch (e) { if (!e || e.name !== 'NotFoundError') { drop.delete(f); } }
    }
    _backupDir.files = files.filter((f) => !drop.has(f)).slice(-BACKUP_DIR_FILES_MAX);
    await bdPut(BACKUP_DIR_FILES_KEY, _backupDir.files);
    return [...drop].map((f) => f.name);
}
// A network's files share their name up to the date: topo_<org>_<site>.
function backupDirGroup(name) {
    const m = /^(.*?)_\d{4}-\d{2}-\d{2}(?:_[^.]*)?\.json$/.exec(String(name));
    return m ? m[1] : String(name);
}
// The name a network's file takes in the folder: its usual name, unless
// another network with the same name and client already writes there; then
// a short piece of its id goes after the name (topo_office-3f9k2a_<date>),
// so neither overwrites the other's file.
function backupDirName(fileName, cardId) {
    if (!cardId) return fileName;
    const files = _backupDir.files || [];
    const stem = backupDirGroup(fileName);
    if (stem === fileName) return fileName;
    const short = String(cardId).replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase() || 'x';
    const alt = stem + '-' + short;
    const named = fileName.slice(0, stem.length) === stem ? alt + fileName.slice(stem.length) : fileName;
    if (files.some((x) => x.cardId === cardId && backupDirGroup(x.name) === alt)) return named;
    const clash = files.some((x) => x.cardId && x.cardId !== cardId && backupDirGroup(x.name) === stem);
    return clash ? named : fileName;
}
const payloadCardId = (payload) => (payload && payload.doc && typeof payload.doc.id === 'string' && payload.doc.id) || '';

// Download a back-up (js/app.js exportJsonFile, js/restore.js): into the
// folder when there is one and the browser lets it, else the download.
function saveBackupJson(payload, fileName) {
    const text = JSON.stringify(withTopoSchema(payload), null, 2);
    const download = () => downloadJson(payload, fileName);
    const handle = _backupDir.handle;
    if (!backupDirCan() || !handle) { download(); return Promise.resolve('download'); }
    // Asked at once, inside the click (a permission prompt needs it).
    return backupDirPermission(handle, true).then(async (ok) => {
        if (!ok) { download(); return 'download'; }
        const cardId = payloadCardId(payload);
        const name = backupDirName(fileName, cardId);
        try {
            await writeBackupDirFile(handle, name, text);
            await noteBackupDirFile(handle, name, '', cardId);
            showToast(t('Saved to {folder}: {file}', { folder: handle.name || t('the back-up folder'), file: name }), 'ok');
            return 'folder';
        } catch (e) {
            download();
            return 'download';
        }
    });
}

// After the autosave of a kept network (js/library.js): a minute of quiet,
// then today's file, while the folder is still granted.
function backupDirAfterSave(cardId) {
    if (!cardId || !backupDirCan() || !_backupDir.handle || !backupDirAuto()) return;
    clearTimeout(_backupDir.timers.get(cardId));
    _backupDir.timers.set(cardId, setTimeout(() => { _backupDir.timers.delete(cardId); backupDirAutoSave(cardId).catch(() => {}); }, _backupDir.hooks.quietMs));
}
// -> 'saved' | 'same' | 'no-permission' | 'idle'.
async function backupDirAutoSave(cardId) {
    const handle = _backupDir.handle;
    const card = typeof libraryEntry === 'function' ? libraryEntry(cardId) : null;
    if (!handle || !card || card.template || card.block || !card.doc || !Array.isArray(card.doc.nodes)) return 'idle';
    if (!(await backupDirPermission(handle, false))) return 'no-permission';
    const day = todayISO(new Date(_backupDir.hooks.now()));
    const hash = typeof revHashOf === 'function' ? revHashOf(card.doc) : String(card.updated || '');
    const ident = typeof stampCard === 'function' ? stampCard(cardId, 'backup') : null;
    const f = networkJsonFile(card.name, card.id, card.updated, card.doc, day, ident);
    const name = backupDirName(f.fileName, cardId);
    const same = (_backupDir.files || []).find((x) => x.name === name && (!x.cardId || x.cardId === cardId));
    if (same && same.hash && same.hash === hash) return 'same';
    try { await writeBackupDirFile(handle, name, JSON.stringify(withTopoSchema(f.payload), null, 2)); }
    catch (e) { return 'idle'; }
    await noteBackupDirFile(handle, name, hash, cardId);
    // Backed up, as a download is (the landing stops counting it as changed).
    if (typeof recordBuildExport === 'function') recordBuildExport(cardId, card.updated);
    return 'saved';
}

// ---- Keeping (D103), the server's rule in the browser ----
// times: ms; now: ms; tz: an IANA zone. -> keep[i] for each time. The same
// vectors as server/internal/backup/retention.go (tests/fixtures/retention.json).
const BACKUP_KEEP = { recent: 24, daily: 7, weekly: 4, monthly: 12 };
function backupKeep(times, now, tz) {
    const keep = times.map(() => false);
    if (!times.length) return keep;
    const idx = times.map((_, i) => i).sort((a, b) => (times[b] - times[a]) || (a - b));
    keep[idx[0]] = true;
    let recent = 0;
    for (const i of idx) {
        if (recent >= BACKUP_KEEP.recent) break;
        const d = now - times[i];
        if (d >= 0 && d < 24 * 3600 * 1000) { keep[i] = true; recent++; }
    }
    let fmt;
    try { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch (e) { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    const ymd = (ms) => { const p = {}; fmt.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; }); return [Number(p.year), Number(p.month), Number(p.day)]; };
    const isoWeek = ([y, m, d]) => {
        const dt = new Date(Date.UTC(y, m - 1, d));
        const wd = dt.getUTCDay() || 7;
        dt.setUTCDate(dt.getUTCDate() + 4 - wd);
        const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
        return dt.getUTCFullYear() + '-W' + String(Math.ceil(((dt - yearStart) / 864e5 + 1) / 7)).padStart(2, '0');
    };
    const keys = idx.map((i) => { const p = ymd(times[i]); return { i, day: p.join('-'), week: isoWeek(p), month: p[0] + '-' + p[1] }; });
    const bucket = (n, k) => {
        let last = null, count = 0;
        for (const x of keys) {
            if (count >= n) return;
            if (x[k] !== last) { keep[x.i] = true; last = x[k]; count++; }
        }
    };
    bucket(BACKUP_KEEP.daily, 'day');
    bucket(BACKUP_KEEP.weekly, 'week');
    bucket(BACKUP_KEEP.monthly, 'month');
    return keep;
}

// ---- Settings, Back-ups ----
function renderBackupDirSettings() {
    const sec = document.getElementById('setBackupSec');
    if (!sec) return;
    sec.hidden = !backupDirCan();
    if (sec.hidden) return;
    const handle = _backupDir.handle;
    const name = document.getElementById('setBackupDirName');
    if (name) name.textContent = handle ? (handle.name || t('a folder')) : t('(none)');
    const pick = document.getElementById('setBackupDirPick');
    if (pick) pick.textContent = handle ? t('Change…') : t('Choose a folder…');
    const stop = document.getElementById('setBackupDirStop');
    if (stop) stop.hidden = !handle;
    const auto = document.getElementById('setBackupDirAuto');
    if (auto) { auto.checked = backupDirAuto(); auto.disabled = !handle; }
}
(function wireBackupDir() {
    const sec = document.getElementById('setBackupSec');
    if (!sec) return;
    const pick = document.getElementById('setBackupDirPick');
    if (pick) pick.addEventListener('click', () => { chooseBackupDir(); });
    const stop = document.getElementById('setBackupDirStop');
    if (stop) stop.addEventListener('click', () => { forgetBackupDir(); });
    const auto = document.getElementById('setBackupDirAuto');
    if (auto) auto.addEventListener('change', () => {
        if (auto.checked) delete state.settings.backupDirAuto; else state.settings.backupDirAuto = false;
        saveSettings();
    });
    renderBackupDirSettings();
    if (backupDirCan()) loadBackupDir();
})();

window.CarinoBackupDir = {
    BACKUP_DIR_KEY, BACKUP_DIR_FILES_KEY, BACKUP_KEEP, hooks: _backupDir.hooks, state: _backupDir, backupDirCan, setBackupDirStore, loadBackupDir,
    chooseBackupDir, forgetBackupDir, saveBackupJson, backupDirAfterSave, backupDirAutoSave, backupKeep, backupDirGroup, renderBackupDirSettings
};
