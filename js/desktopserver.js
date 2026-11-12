// ---- This PC as the server (docs/SCOPE.md D113, D125) ----
// The desktop app (desktop/src-tauri/src/server.rs) bundles topo-server and
// can run it, so a PC on site is the Topo server for the others: as a
// service that starts with the PC, even with Topo closed and nobody signed
// in (mode "service", the default once chosen), or only while Topo is open
// (mode "app"). This file is the Settings section that drives it and the
// first-run question, through the app's own commands:
//
//   server_info            status, mode, settings, LAN addresses,
//                          fingerprint, log
//   server_save            settings (+ the SMTP password, never sent back);
//                          a service gets them through an admin prompt
//   server_start / _stop   the service through the service manager, else
//                          the app's own child
//   server_service_install the service, with the settings on screen
//   server_service_remove  no longer the server (the data stays)
//   server_question        whether to ask "Use this PC as the server…?"
//   server_question_done   asked: never again
//   server_open            one of the running server's addresses, in the
//                          system browser (no longer offered here)
//
// "Open it in this window" connects this window to it, at 127.0.0.1,
// through the app (js/desktopclient.js, D144): it replaces opening its
// address in a browser. Its certificate (Other PCs on this network) is the
// one this PC made, so there is nothing to compare.
//
// The section shows only when window.__TAURI__ is there and server_info
// answers with the bundled binary found: never on the website or in the
// offline zip. Off by default; "Other PCs on this network" needs email
// (SMTP), since nobody on another PC can read this PC's log.
// Load order: ... -> backupdir -> desktopserver -> ... -> settings

const _ds = {
    // Tests swap in a stub: (cmd, args) => Promise.
    invoke: null,
    info: null,
    busy: false,
    timer: 0,
};

function dsInvoke(cmd, args) {
    if (_ds.invoke) return _ds.invoke(cmd, args || {});
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
const dsHasHost = () => !!_ds.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');

// The codes server.rs answers with, as sentences.
function dsErrText(code) {
    const c = String(code && code.message ? code.message : code || '');
    if (c === 'port') return t('Choose a port from 1024 to 65535.');
    if (c === 'owner-email') return t('Type the owner\'s email.');
    if (c === 'smtp') return t('Fill in the SMTP server, its port and Send from.');
    if (c === 'lan-needs-email') return t('Other PCs need sign-in codes by email: choose Sent by email (SMTP).');
    if (c === 'mail') return t('Choose how sign-in codes are sent.');
    if (c === 'no-binary') return t('This copy of Topo has no built-in server.');
    if (c === 'no-lan') return t('This PC has no network address other PCs can reach.');
    if (c === 'already-running') return t('A Topo server started earlier is still running on this PC. Stop it first.');
    if (c === 'cancelled') return t('Nothing changed: the administrator prompt was closed.');
    if (c === 'not-authorized') return t('This account may not do that: an administrator has to.');
    if (c === 'no-service') return t('This copy of Topo cannot run the server in the background (an AppImage, or not in Applications). Install the package, or run it only while Topo is open.');
    if (c === 'share') return t('Choose the address to give people again.');
    if (c.startsWith('service:')) return t('The server service said: {why}', { why: c.slice(8) });
    if (c.startsWith('exited:')) return t('The server stopped. The log below says why.');
    if (c.startsWith('start:')) return t('The server could not start: {why}', { why: c.slice(6) });
    return t('Something went wrong: {why}', { why: c });
}

const dsEl = (id) => document.getElementById(id);

function dsFormSettings() {
    const num = (id, d) => { const n = parseInt(dsEl(id).value, 10); return Number.isFinite(n) ? n : d; };
    return {
        enabled: dsEl('setDsEnabled').checked,
        port: num('setDsPort', 0),
        lan: dsEl('setDsWho').value === 'lan',
        shareAddress: dsEl('setDsShare').value,
        ownerEmail: dsEl('setDsOwner').value.trim(),
        mail: dsEl('setDsMail').value,
        smtpHost: dsEl('setDsSmtpHost').value.trim(),
        smtpPort: num('setDsSmtpPort', 0),
        smtpSecurity: dsEl('setDsSmtpSec').value,
        smtpUser: dsEl('setDsSmtpUser').value.trim(),
        smtpFrom: dsEl('setDsSmtpFrom').value.trim(),
    };
}

// The fields follow the choices: SMTP fields only for email, and "no email"
// only for this PC.
function dsSyncFields() {
    const lan = dsEl('setDsWho').value === 'lan';
    const mail = dsEl('setDsMail');
    const none = mail.querySelector('option[value="none"]');
    if (none) none.disabled = lan;
    if (lan && mail.value === 'none') mail.value = 'smtp';
    dsEl('setDsSmtp').hidden = mail.value !== 'smtp';
    dsEl('setDsLanNote').hidden = !lan;
    dsEl('setDsShareRow').hidden = !lan;
}

// The address to give people (the one in sign-in links): Automatic, or
// one of this PC's addresses. A saved one the PC no longer has stays listed.
function dsShareOptions(list, keep) {
    const sel = dsEl('setDsShare');
    const cur = keep != null ? keep : sel.value;
    const want = [''].concat(list || []);
    if (cur && !want.includes(cur)) want.push(cur);
    const have = Array.from(sel.options).map((o) => o.value);
    if (have.join('|') !== want.join('|')) {
        while (sel.options.length > 1) sel.remove(1);
        want.slice(1).forEach((a) => { const o = document.createElement('option'); o.value = a; o.textContent = a; sel.append(o); });
    }
    sel.value = cur || '';
}

function dsFill(s) {
    dsEl('setDsEnabled').checked = !!s.enabled;
    dsEl('setDsWho').value = s.lan ? 'lan' : 'pc';
    dsShareOptions(_ds.info && _ds.info.lanAddresses, s.shareAddress || '');
    dsEl('setDsPort').value = s.port || 7380;
    dsEl('setDsOwner').value = s.ownerEmail || '';
    dsEl('setDsMail').value = s.mail === 'smtp' ? 'smtp' : 'none';
    dsEl('setDsSmtpHost').value = s.smtpHost || '';
    dsEl('setDsSmtpPort').value = s.smtpPort || 587;
    dsEl('setDsSmtpSec').value = ['starttls', 'tls', 'none'].includes(s.smtpSecurity) ? s.smtpSecurity : 'starttls';
    dsEl('setDsSmtpUser').value = s.smtpUser || '';
    dsEl('setDsSmtpFrom').value = s.smtpFrom || '';
    dsSyncFields();
}

function dsRender(info, note, isErr) {
    const sec = dsEl('setDsSec');
    if (!sec) return;
    _ds.info = info;
    sec.hidden = !(info && info.available);
    if (sec.hidden) return;
    dsShareOptions(info.lanAddresses);
    const svc = info.mode === 'service';
    const canSvc = !svc && !!(info.service && info.service.supported);
    const lan = !!(info.settings && info.settings.lan);
    const how = dsEl('setDsHow');
    if (how) {
        how.textContent = svc ? t('It runs in the background from startup, even when Topo is closed or nobody is signed in. Starting, stopping and saving ask for an administrator.')
            : canSvc ? t('Run it in the background from startup (recommended), or only while Topo is open with Start below.')
                : t('It runs only while Topo is open.');
    }
    const status = dsEl('setDsStatus');
    let line;
    if (note) line = note;
    else if (info.running && svc) line = lan ? t('Running in the background. Give the other PCs this address:') : t('Running in the background. Open it on this PC:');
    else if (info.running) line = lan ? t('Running. Give the other PCs this address:') : t('Running. Open it on this PC:');
    else if (info.error) line = dsErrText(info.error);
    else if (svc) line = t('Set up to start with this PC, but not running now.');
    else line = t('Off.');
    status.textContent = line;
    status.classList.toggle('ds-err', note ? !!isErr : !info.running && !!info.error);

    const list = dsEl('setDsUrls');
    list.textContent = '';
    list.hidden = !info.running || !(info.urls || []).length;
    (info.running ? info.urls || [] : []).forEach((u, i) => {
        const li = document.createElement('li');
        li.className = 'ds-url';
        const code = document.createElement('code');
        code.className = 'ds-code';
        code.textContent = u;
        const copy = document.createElement('button');
        copy.type = 'button'; copy.className = 'btn'; copy.textContent = t('Copy');
        copy.addEventListener('click', () => dsCopy(u));
        li.append(code, copy);
        if (i === 0 && info.urls.length > 1) {
            const more = document.createElement('span');
            more.className = 'dlg-dim ds-more';
            more.textContent = t('or, from another network of this PC:');
            li.append(more);
        }
        list.append(li);
    });
    const fp = info.running && info.settings && info.settings.lan ? info.fingerprint || '' : '';
    dsEl('setDsFpRow').hidden = !fp;
    dsEl('setDsFp').textContent = fp;
    dsEl('setDsStart').hidden = !!info.running;
    // This window and its own server (js/desktopclient.js): offered while it
    // runs, unless this window already uses it.
    const DC = window.CarinoDesktopClient;
    const port = info.settings && info.settings.port;
    const here = !!(DC && port && DC.connectedTo() === DC.ownUrl(port, lan));
    dsEl('setDsHere').hidden = !info.running || !DC || !port || here || (lan && !info.fingerprint);
    if (info.running && here && !note) status.textContent = line + ' ' + t('This window is connected to it.');
    dsEl('setDsStart').classList.toggle('btn-primary', !canSvc);
    dsEl('setDsStop').hidden = !info.running && info.error !== 'already-running';
    // The service: always at startup, so the app's own tick goes; set up
    // from here when this copy can, removed from here when it is.
    dsEl('setDsEnabledRow').hidden = svc;
    dsEl('setDsService').hidden = !canSvc;
    dsEl('setDsRemove').hidden = !svc;
    const pass = dsEl('setDsSmtpPass');
    pass.placeholder = info.hasSmtpPass ? t('Saved (type to replace)') : '';
    // The form keeps what is being typed; it is filled from the saved
    // settings when the section opens.
    const log = dsEl('setDsLog');
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    log.textContent = (info.log || []).join('\n');
    if (atEnd) log.scrollTop = log.scrollHeight;
}

async function dsCopy(text) {
    try { await navigator.clipboard.writeText(text); showToast(t('Copied.'), 'ok'); }
    catch (e) { showToast(text, 'warn'); }
}

async function dsRefresh(fill) {
    if (!dsHasHost()) { dsRender(null); return null; }
    try {
        const info = await dsInvoke('server_info');
        if (fill && info && info.settings) dsFill(info.settings);
        dsRender(info);
        return info;
    } catch (e) {
        // An app without these commands (an older build): no section.
        dsRender(null);
        return null;
    }
}

async function dsAct(cmd, args) {
    if (_ds.busy) return;
    _ds.busy = true;
    const sec = dsEl('setDsSec');
    sec.setAttribute('aria-busy', 'true');
    try {
        const info = await dsInvoke(cmd, args);
        const done = { server_save: t('Saved.'), server_service_install: t('Set up. It starts with this PC from now on.'), server_service_remove: t('Removed. Its data stays on this PC.') };
        if (info) dsRender(info, done[cmd] || '');
        if (cmd === 'server_save' || cmd === 'server_service_install') dsEl('setDsSmtpPass').value = '';
    } catch (e) {
        dsRender(_ds.info || { available: true, settings: dsFormSettings() }, dsErrText(e), true);
    } finally {
        _ds.busy = false;
        sec.removeAttribute('aria-busy');
    }
}

function dsSave() {
    const pass = dsEl('setDsSmtpPass').value;
    return dsAct('server_save', { settings: dsFormSettings(), smtpPass: pass || null });
}
// Sets this PC up as the server for good: the service, with what is on
// screen (one administrator prompt).
function dsInstallService() {
    const pass = dsEl('setDsSmtpPass').value;
    return dsAct('server_service_install', { settings: dsFormSettings(), smtpPass: pass || null });
}
async function dsRemoveService() {
    const yes = await askConfirm(t('Stop using this PC as the server? Other PCs can no longer sign in to it. Its data stays on this PC.'),
        { ok: t('Stop using this PC'), danger: true });
    if (yes) return dsAct('server_service_remove');
}

async function dsStart() {
    // The service starts with its saved settings (Save sends new ones): one
    // administrator prompt, not two.
    if (_ds.info && _ds.info.mode === 'service') return dsAct('server_start');
    // What is on screen is what starts.
    await dsSave();
    if (dsEl('setDsStatus').classList.contains('ds-err')) return;
    return dsAct('server_start');
}

// Connects this window to the server this PC runs (the page reloads as a
// client of it).
async function dsOpenHere() {
    const info = _ds.info, DC = window.CarinoDesktopClient;
    if (!info || !info.running || !DC) return;
    const lan = !!(info.settings && info.settings.lan);
    try { await DC.dcConnectOwn(info.settings.port, lan, info.fingerprint || ''); }
    catch (e) { dsRender(info, DC.dcErrText(e), true); }
}

// Settings opens: fill from the saved settings, then follow the log while
// the dialog is open.
function renderDesktopServerSettings() {
    const sec = dsEl('setDsSec');
    if (!sec) return;
    if (!dsHasHost()) { sec.hidden = true; return; }
    dsRefresh(true);
    clearInterval(_ds.timer);
    _ds.timer = setInterval(() => {
        const scrim = dsEl('settingsDialog');
        if (!scrim || scrim.hidden || sec.hidden) { clearInterval(_ds.timer); _ds.timer = 0; return; }
        if (!_ds.busy) dsRefresh(false);
    }, 2000);
}

(function wireDesktopServer() {
    const sec = dsEl('setDsSec');
    if (!sec) return;
    dsEl('setDsWho').addEventListener('change', dsSyncFields);
    dsEl('setDsMail').addEventListener('change', dsSyncFields);
    dsEl('setDsSave').addEventListener('click', () => { dsSave(); });
    dsEl('setDsStart').addEventListener('click', () => { dsStart(); });
    dsEl('setDsStop').addEventListener('click', () => { dsAct('server_stop'); });
    dsEl('setDsService').addEventListener('click', () => { dsInstallService(); });
    dsEl('setDsRemove').addEventListener('click', () => { dsRemoveService(); });
    dsEl('setDsHere').addEventListener('click', () => { dsOpenHere(); });
    // The tick is kept at once, like every other setting.
    dsEl('setDsEnabled').addEventListener('change', async (e) => {
        const box = e.target;
        await dsSave();
        // Not kept (a field to fill first): the tick goes back.
        if (dsEl('setDsStatus').classList.contains('ds-err')) box.checked = !box.checked;
    });
})();

// ---- The first-run question (D125, D170) ----
// On Linux and macOS the question is the welcome's step 3 choice "Make this
// PC the server" (js/welcome.js, D170): asked once, and any other answer,
// or skipping the step, is "not now". dsFirstRun is what is left of the old
// standalone prompt: the welcome calls it only on a start where the welcome
// itself does not run (an install that was already in use, a start by a
// link), so the question is still asked once where the app says to ask it
// (server_question: a PC that can run the service and does not yet, whose
// Windows installer did not already ask). Either way it is not asked again.
async function dsFirstRun() {
    if (!dsHasHost() || !dsEl('setDsSec')) return false;
    let askIt = false;
    try { askIt = await dsInvoke('server_question'); } catch (e) { return false; }
    if (askIt !== true) return false;
    const yes = await askConfirm(t('Other PCs on site sign in to Topo and sync with this one. It runs in the background from startup, even when Topo is closed. You can change this later in Settings, This PC as the server.'),
        { title: t('Use this PC as the server for your network?'), ok: t('Yes, set it up'), cancel: t('Not now') });
    try { await dsInvoke('server_question_done', { answer: yes ? 'yes' : 'no' }); } catch (e) { /* asked anyway */ }
    if (!yes) return false;
    await dsOpenSetUp();
    return true;
}
// "Yes, set it up" (the old prompt, or the welcome's Make this PC the
// server): Settings opens at this section to fill in the owner and the
// email, then "Run it in the background from startup" sets it up.
async function dsOpenSetUp() {
    if (typeof openSettings === 'function') openSettings();
    await dsRefresh(true);
    const sec = dsEl('setDsSec');
    if (sec && !sec.hidden) {
        sec.scrollIntoView({ block: 'start' });
        dsRender(_ds.info, t('Fill in the owner\'s email (and, for other PCs, the email settings), then Run it in the background from startup.'));
        const owner = dsEl('setDsOwner');
        if (owner) owner.focus({ preventScroll: true });
    }
}

window.CarinoDesktopServer = { state: _ds, dsErrText, dsOpenHere, dsFormSettings, dsRefresh, renderDesktopServerSettings, dsSave, dsStart, dsInstallService, dsRemoveService, dsFirstRun, dsOpenSetUp, dsHasHost, dsInvoke };
