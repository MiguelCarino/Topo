// ---- Setup, the first-run welcome (docs/SCOPE.md D138, D141-D143, D170,
// D326-D336, D353-D359; steps 7l and 7o) ----
// Called "Setup" on screen in every language (D356); the code keeps the
// name welcome. The desktop app's alone (D425): the first time the app
// starts on a PC, a few questions, each one skippable, each one handed to
// the piece that already does it. The website, the offline zip and a page a
// Topo server served never show it: they start on the landing, which
// already has every way in (and, on a server's page, Sign in).
//
//   theme  Gold or Colourful: the navbar's theme switch (carino-theme.js),
//          so the choice is kept as that switch keeps it.
//   mode   Document the network (the full editor) or Report problems (the
//          simple view, then General or Imagenology): set exactly as the
//          mode picker sets it (js/app.js openModePicker).
//   where  The desktop app: on this PC only; Connect to a Topo server
//          (D144); or Make this PC the server (D113, D125), offered where
//          this PC can run the service and does not yet (D336); D125's
//          question (server_question) is answered here once (D170). A server
//          chosen is then set up here, step by step (D353), each step done
//          by the function Settings uses for it, never a second copy:
//            connect  srvAddr (js/desktopclient.js dcConnect), srvCompare
//                     when the server signs its own certificate (dcTrust);
//                     the window reloads as its client;
//            server   srvOwner (the owner's email, who opens it, the email
//                     server for other PCs: js/desktopserver.js dsSetUpWith,
//                     which is Settings' Run it in the background from
//                     startup), srvWait (server_info until it runs, then
//                     dcConnectOwn); the window reloads as its client;
//            both     srvEmail and srvCode (js/server.js requestCode and
//                     verifyCode); on this PC's own server with no email,
//                     the app fetches the code from it with its own key
//                     (js/desktopserver.js dsSignInCode, D358), never
//                     from a log other accounts could read.
//          A reload in the middle (Connect reloads) resumes Setup at the
//          step it left for (sessionStorage RESUME_KEY, D355). Not asked in
//          an app window already connected to a server (unless Setup
//          connected it).
//   lock   The screen lock's time and PIN (js/idlelock.js, D134).
//   pc     Add this computer to the map (js/
//          thiscomputer.js, through the Import… review) and Monitor from
//          this PC (js/checks.js, off unless ticked). Both need an open
//          network, so they wait until one is (D331).
//   start  Open a file, Map the network now (the '#setup' intake's Add
//          devices), or An empty network: the landing's own buttons. With a
//          server Setup connected, what was done and Finish: the start page
//          behind is the server's (D353).
//
// When it shows (D141, D326, D425): in the desktop app, on a plain start
// only (no link, no '#setup', '?profile=' or mode entry, no reload of an
// open network: the landing is what that start shows), once per PC. The
// mark is localStorage WL_KEY; an app that already holds networks counts as
// done, so an install from before the welcome never sees it (D327). The
// app's Settings has "Run the setup again". Skipping a step changes
// nothing; closing it (✕ or Esc) skips the rest and marks it done; while a
// step is being applied (an administrator prompt, a connect) it closes once
// that step is done (D359). Nothing here is in the document.
// Load order: ... -> reports -> welcome -> app -> settings

(function () {
'use strict';

const WL_KEY = 'topo-welcome';
const NEXT_KEY = 'topo-welcome-next';     // sessionStorage: the waiting pc/monitor tasks
const NEXT_GIVE_UP_MS = 30 * 60000;
const RESUME_KEY = 'topo-welcome-resume'; // sessionStorage: Setup left for a reload (D355)
const RESUME_GIVE_UP_MS = 30 * 60000;
const SRV_STEPS = ['srvAddr', 'srvCompare', 'srvOwner', 'srvWait', 'srvEmail', 'srvCode'];

// How this page was entered, read before js/app.js's load() takes a link or
// an entry off the URL.
const ARRIVAL = (() => {
    let hash = '', profile = false;
    try {
        hash = window.location.hash.slice(1);
        const p = new URLSearchParams(window.location.search);
        profile = p.has('profile') || p.has('simple');
    } catch (e) { /* plain */ }
    return { hash, profile };
})();

// The server walk (D353). connected: Setup connected this window (known
// after the reload); signedIn: Setup signed in; skipped: Skip on one of its
// steps ended the walk; own: this PC's own server; mail: its codes ('none':
// the app fetches them, D358); sentAt: when the code was asked for (a code
// sent before it is an older one); probed: the comparison Setup's Connect
// started; failed: the wait ended without a server.
const freshSrv = () => ({ connected: false, signedIn: false, skipped: false, own: false, mail: '', url: '', email: '',
    challenge: null, sentAt: 0, probed: false, msg: '', err: false, failed: false, gen: 0 });

const _wl = {
    // Tests: (cmd, args) => Promise for the app's commands; null uses the
    // app's own window.__TAURI__.
    invoke: null,
    open: false,
    steps: [], i: 0,
    pick: {},              // the choices made on screen, applied on Next
    keptTheme: null,       // the theme kept now (as the welcome opened, or the last Next)
    serverAsk: false,      // the app said to ask D125's question
    serverOffer: false,    // Make this PC the server is offered (D336)
    serverAnswered: false,
    busy: false,           // a Next is being applied (the PIN, a server step): nothing else moves
    closeWanted: '',       // closed while busy: how, once the step is done (D359)
    poll: 0,
    again: false,
    srv: freshSrv(),
    srvInfo: null,         // server_info as Setup opened (the saved settings)
    waitMs: 1000,          // how often the service and its log are asked (tests shorten it)
    waitFor: 90000,        // how long the service has to answer
    timer: 0,
};

const el = (id) => document.getElementById(id);
const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* none */ } },
};
// The waiting tasks: { at, tasks }, at = when the welcome queued them, so
// the 30 minutes run from then, across reloads (D331, D336).
const ss = {
    read() {
        try {
            const v = JSON.parse(sessionStorage.getItem(NEXT_KEY) || 'null');
            if (!v || !Array.isArray(v.tasks) || typeof v.at !== 'number') return { at: 0, tasks: [] };
            return { at: v.at, tasks: v.tasks.filter((x) => x === 'pc' || x === 'monitor') };
        } catch (e) { return { at: 0, tasks: [] }; }
    },
    get() { return ss.read().tasks; },
    set(list, at) {
        try {
            if (!list.length) { sessionStorage.removeItem(NEXT_KEY); return; }
            sessionStorage.setItem(NEXT_KEY, JSON.stringify({ at: typeof at === 'number' ? at : (ss.read().at || Date.now()), tasks: list }));
        } catch (e) { /* this tab only */ }
    },
};
// Setup left for a reload (Connect reloads the window): where it goes on,
// for 30 minutes (D355).
const rs = {
    get() {
        try {
            const v = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null');
            if (!v || typeof v.at !== 'number' || !SRV_STEPS.includes(v.step)) return null;
            if (Date.now() - v.at > RESUME_GIVE_UP_MS) { rs.clear(); return null; }
            return v;
        } catch (e) { return null; }
    },
    set(v) { try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(Object.assign({ at: Date.now() }, v))); } catch (e) { /* no resume: Settings finishes it */ } },
    clear() { try { sessionStorage.removeItem(RESUME_KEY); } catch (e) { /* none */ } },
};

function wlInvoke(cmd, args) {
    if (_wl.invoke) return Promise.resolve().then(() => _wl.invoke(cmd, args || {}));
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
// The desktop app (or a test's stand-in for it).
const isApp = () => !!_wl.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
const DCl = () => window.CarinoDesktopClient || null;
const DSv = () => window.CarinoDesktopServer || null;
const TS = () => window.TopoServer || null;
const appClient = () => { const DC = DCl(); return !!(DC && DC.connectedTo && DC.connectedTo()); };
// After Setup's reload: the app's answer (client_info) may still be on its
// way, but the address the window was pointed at (the mirror) is there.
const reconnected = () => { const DC = DCl(); return !!(DC && (DC.connectedTo() || DC.state.url)); };
const isSrv = (name) => SRV_STEPS.includes(name);
const walking = () => _wl.pick.where === 'connect' || _wl.pick.where === 'server';

// ---- The mark ----
const doneMark = () => { try { const m = JSON.parse(ls.get(WL_KEY)); return m && typeof m.at === 'number' ? m : null; } catch (e) { return null; } };
const markDone = (how) => ls.set(WL_KEY, JSON.stringify({ v: 1, at: Date.now(), how }));

// A start the welcome belongs to: a plain one (D326).
function plainStart() {
    if (ARRIVAL.hash || ARRIVAL.profile) return false;
    return typeof landingIsOpen === 'function' && landingIsOpen();
}
const holdsNetworks = () => (typeof libraryEntries === 'function' ? libraryEntries().some((e) => !e.template) : false);

// Called by js/app.js's boot once load() has decided. -> 'shown', 'done',
// 'existing', 'skipped' or 'resumed'.
async function atBoot() {
    resumeNext();
    // Setup reloaded the window half way through (Connect does): it goes on
    // where it left, whatever else this start is (D355).
    const back = rs.get();
    if (back && isApp()) { await openWelcome(!!back.again, back); return 'resumed'; }
    if (back) rs.clear();
    // The desktop app's alone (D425): a browser starts on the landing, and
    // keeps no mark (nothing was asked).
    if (!isApp()) return 'web';
    if (doneMark()) { fallbackQuestion(); return 'done'; }
    if (!plainStart()) { fallbackQuestion(); return 'skipped'; }
    if (holdsNetworks()) { markDone('existing'); fallbackQuestion(); return 'existing'; }
    await openWelcome(false);
    return 'shown';
}
// Where the welcome does not run, D125's question is still asked once by
// its own prompt (js/desktopserver.js), where the app says to ask it.
function fallbackQuestion() {
    const DS = DSv();
    if (!isApp() || !DS || typeof DS.dsFirstRun !== 'function') return;
    setTimeout(() => { if (!_wl.open) DS.dsFirstRun(); }, 1500);
}

// ---- The steps ----
// The server walk's steps follow what is chosen and done (D353): the
// address and, for a certificate to compare, srvCompare; or the owner and
// the wait; then the sign-in, unless done. Skipped, none of them.
function serverSteps() {
    const sv = _wl.srv;
    if (!isApp() || !walking() || sv.skipped) return [];
    const out = [];
    if (!sv.connected) {
        if (_wl.pick.where === 'connect') {
            out.push('srvAddr');
            const DC = DCl();
            if (DC && DC.state.probe) out.push('srvCompare');
        } else out.push('srvOwner', 'srvWait');
    }
    if (!sv.signedIn) out.push('srvEmail', 'srvCode');
    return out;
}
function stepsFor() {
    const app = isApp();
    const list = ['theme', 'mode'];
    if (!appClient() || _wl.srv.connected) list.push('where', ...serverSteps());
    list.push('lock');
    const pcOk = app && el('wlAddPc') && ((window.TopoThisComputer && TopoThisComputer.hasHost()) || (window.TopoChecks && TopoChecks.hasHost()));
    if (pcOk) list.push('pc');
    list.push('start');
    return list;
}
const current = () => _wl.steps[_wl.i];
// To a step by name, the list worked out again (it follows the choices).
function goTo(name) {
    _wl.steps = stepsFor();
    const at = _wl.steps.indexOf(name);
    _wl.i = at >= 0 ? at : Math.min(_wl.i, _wl.steps.length - 1);
    render();
}

function pressed(container, attr, value) {
    container.querySelectorAll('.wl-choice').forEach((b) => {
        if (b.hasAttribute(attr)) b.setAttribute('aria-pressed', b.getAttribute(attr) === value ? 'true' : 'false');
    });
}

function currentTheme() {
    if (window.CarinoTheme && typeof CarinoTheme.current === 'function') return CarinoTheme.current();
    return document.documentElement.getAttribute('data-carino-theme') === 'color' ? 'color' : 'gold';
}
// A look at the theme while choosing (not kept until Next).
function previewTheme(th) {
    if (window.CarinoTheme && typeof CarinoTheme.apply === 'function') CarinoTheme.apply(th);
    else document.documentElement.setAttribute('data-carino-theme', th);
}
// Kept as the navbar's switch keeps it (localStorage and the fleet cookie).
// Measured against the theme kept so far, not the one on screen (a preview),
// so a second visit to the step (Back) keeps its new choice too (D334).
function keepTheme(th) {
    const kept = _wl.keptTheme || currentTheme();
    previewTheme(kept);
    if (kept !== th) {
        const sw = el('ctSwitch');
        if (sw) sw.click();
        else { ls.set('carino-theme', th); previewTheme(th); }
    }
    _wl.keptTheme = th;
}
// A preview not kept goes back to the kept theme.
function unpreviewTheme() {
    if (_wl.keptTheme && currentTheme() !== _wl.keptTheme) previewTheme(_wl.keptTheme);
}

function fillProfiles() {
    const box = el('wlProfiles');
    if (!box || typeof PROFILES !== 'object') return;
    box.textContent = '';
    Object.keys(PROFILES).forEach((k) => {
        const p = PROFILES[k];
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'wl-choice'; b.dataset.profile = k;
        b.setAttribute('aria-pressed', 'false');
        const name = document.createElement('b'); name.textContent = `${p.icon} ${t(p.label)}`;
        const blurb = document.createElement('span'); blurb.className = 'wl-blurb'; blurb.textContent = t(p.blurb);
        b.append(name, blurb);
        box.append(b);
    });
}

function fillLock() {
    const L = window.TopoLock;
    const sel = el('wlLockAfter');
    const min = L ? L.lockAfterMin() : 30;
    sel.querySelectorAll('option[data-custom]').forEach((o) => o.remove());
    if (![0, 5, 15, 30, 60].includes(min)) {
        const o = document.createElement('option');
        o.value = String(min); o.dataset.custom = '1';
        o.textContent = t('{n} min', { n: min });
        sel.append(o);
    }
    sel.value = String(min);
    el('wlPin1').value = ''; el('wlPin2').value = '';
    const canPin = !!(window.crypto && crypto.subtle && L);
    el('wlPinBox').hidden = !canPin || (L && L.hasPin());
    el('wlLockMsg').textContent = L && L.hasPin() ? t('A PIN is set on this PC. Change it in Settings, Screen lock.') : '';
}

// The server form starts from what is saved (Settings' own values).
function fillServerForm() {
    const s = (_wl.srvInfo && _wl.srvInfo.settings) || {};
    el('wlSrvUrl').value = '';
    el('wlSrvOwner').value = s.ownerEmail || '';
    el('wlSrvWho').value = s.lan ? 'lan' : 'pc';
    el('wlSrvSmtpHost').value = s.smtpHost || '';
    el('wlSrvSmtpPort').value = s.smtpPort || 587;
    el('wlSrvSmtpSec').value = ['starttls', 'tls', 'none'].includes(s.smtpSecurity) ? s.smtpSecurity : 'starttls';
    el('wlSrvSmtpUser').value = s.smtpUser || '';
    el('wlSrvSmtpPass').value = '';
    el('wlSrvSmtpFrom').value = s.smtpFrom || '';
    el('wlSrvEmail').value = ''; el('wlSrvToken').value = ''; el('wlSrvCode').value = '';
}

const NEXT_LABEL = { srvAddr: 'Connect', srvCompare: 'They are the same: connect', srvOwner: 'Set it up', srvEmail: 'Send me a code', srvCode: 'Sign in' };
function nextLabel(name) {
    if (name === 'srvWait') return t('Try again');
    return t(NEXT_LABEL[name] || 'Next');
}

function renderServer(name) {
    const sv = _wl.srv;
    if (name === 'srvCompare') {
        const p = DCl() && DCl().state.probe;
        el('wlSrvFpUrl').textContent = p ? p.url : '';
        el('wlSrvFp').textContent = p ? p.fingerprint : '';
    }
    if (name === 'srvOwner') {
        const lan = el('wlSrvWho').value === 'lan';
        el('wlSrvSmtp').hidden = !lan;
        el('wlSrvPcNote').hidden = lan;
    }
    if (name === 'srvEmail') {
        el('wlSrvEmailText').textContent = sv.own && sv.mail === 'none'
            ? t('This PC\'s server sends no email: Topo gets the sign-in code from it, for this account only. The owner\'s email is filled in.')
            : t('Type your email address. A code to sign in will be sent there.');
        const S = TS();
        el('wlSrvTokenRow').hidden = sv.own || !(S && S.state.health && S.state.health.setup);
        if (!el('wlSrvEmail').value && sv.email) el('wlSrvEmail').value = sv.email;
    }
    if (name === 'srvCode') {
        const own = sv.own && sv.mail === 'none';
        el('wlSrvCodeLbl').textContent = own ? t('Sign-in code') : t('Code from the email');
        el('wlSrvCodeText').textContent = own
            ? t('Topo gets the code from this PC\'s server and fills it in. Then Sign in.')
            : t('If {email} can sign in here, a code is on its way. Type the code from the email here.', { email: sv.email });
    }
}

function render() {
    _wl.steps = stepsFor();
    if (_wl.i >= _wl.steps.length) _wl.i = _wl.steps.length - 1;
    const name = current();
    document.querySelectorAll('#welcomeDialog .wl-step').forEach((s) => { s.hidden = s.dataset.step !== name; });
    el('wlCount').textContent = t('Step {n} of {total}', { n: _wl.i + 1, total: _wl.steps.length });
    const last = name === 'start';
    const doneSrv = last && _wl.srv.connected;
    el('wlBack').hidden = _wl.i === 0;
    el('wlNext').hidden = last || (name === 'srvWait' && !_wl.srv.failed);
    el('wlNext').disabled = _wl.busy;
    el('wlNext').textContent = nextLabel(name);
    el('wlSkip').textContent = last ? t('Not now') : t('Skip this step');
    el('wlSkip').hidden = doneSrv;
    el('wlSrvMsg').textContent = isSrv(name) ? _wl.srv.msg : '';
    el('wlSrvMsg').classList.toggle('wl-err', isSrv(name) && _wl.srv.err);
    el('wlSrvMsg').setAttribute('role', isSrv(name) && _wl.srv.err ? 'alert' : 'status');
    el('wlSrvLater').hidden = !isSrv(name);
    if (name === 'theme') pressed(el('wlThemes'), 'data-theme', _wl.pick.theme || currentTheme());
    if (name === 'mode') {
        const m = _wl.pick.mode || '';
        pressed(el('wlModes'), 'data-mode', m);
        el('wlPurpose').hidden = m !== 'simple';
        if (m === 'simple') pressed(el('wlProfiles'), 'data-profile', _wl.pick.profile || state.settings.profile || 'simple');
    }
    if (name === 'where') {
        const on = _wl.srv.connected;
        el('wlWhereApp').hidden = on;
        el('wlWhereOn').hidden = !on;
        if (on) el('wlWhereOnUrl').textContent = (DCl() && DCl().connectedTo()) || _wl.srv.url;
        el('wlWhereApp').querySelector('[data-where="server"]').hidden = !_wl.serverOffer;
        pressed(el('wlWhereApp'), 'data-where', _wl.pick.where || 'here');
    }
    renderServer(name);
    if (name === 'pc') {
        el('wlAddPcRow').hidden = !(window.TopoThisComputer && TopoThisComputer.hasHost());
        el('wlMonitorRow').hidden = !(window.TopoChecks && TopoChecks.hasHost());
    }
    if (name === 'start') {
        // A server Setup connected: what was done, and Finish; the start
        // page behind is the server's (D353).
        el('wlStarts').hidden = doneSrv;
        el('wlHandoff').hidden = !doneSrv;
        el('wlStartHead').textContent = doneSrv ? t('All set') : t('How do you want to start?');
        if (doneSrv) {
            const S = TS(), url = (DCl() && DCl().connectedTo()) || _wl.srv.url;
            const me = S && S.me && S.me();
            el('wlHandoffText').textContent = me
                ? t('This window is connected to {server} and signed in as {email}. The networks kept on the server are on the start page.', { server: url, email: me.email })
                : t('This window is connected to {server}. Sign in from the start page to see the networks kept on it.', { server: url });
            el('wlHandoffGo').textContent = t('Finish');
        }
    }
    // Focus on the step's first control, so a keyboard and a screen reader
    // start where the question is.
    const sec = document.querySelector(`#welcomeDialog .wl-step[data-step="${name}"]`);
    const first = sec && [...sec.querySelectorAll('button, input, select')].find((x) => !x.disabled && x.getClientRects().length);
    const target = first || (doneSrv ? el('wlHandoffGo') : (!el('wlNext').hidden ? el('wlNext') : null));
    if (target && !_wl.busy) target.focus({ preventScroll: true });
    const body = document.querySelector('#welcomeDialog .wl-body');
    if (body) body.scrollTop = 0;
}

async function openWelcome(again, resume) {
    if (_wl.open) return;
    const scrim = el('welcomeDialog');
    if (!scrim) return;
    _wl.again = !!again;
    _wl.pick = {};
    _wl.i = 0;
    _wl.keptTheme = currentTheme();
    _wl.serverAsk = false; _wl.serverOffer = false; _wl.serverAnswered = false; _wl.busy = false; _wl.closeWanted = '';
    _wl.srv = freshSrv();
    _wl.srvInfo = null;
    if (resume) {
        // Back after the reload Setup's Connect made (D355): what it had.
        _wl.pick.where = resume.where === 'server' ? 'server' : 'connect';
        _wl.serverAsk = !!resume.serverAsk; _wl.serverAnswered = !!resume.serverAnswered; _wl.serverOffer = !!resume.serverOffer;
        Object.assign(_wl.srv, { own: !!resume.own, mail: resume.mail || '', email: resume.email || '', url: resume.url || '' });
        // The server client opened at boot (js/server.js): its answer first.
        const S = TS();
        if (S && S.state.opening) { try { await Promise.race([S.state.opening, new Promise((r) => setTimeout(r, 20000))]); } catch (e) { /* said on the step */ } }
        _wl.srv.connected = reconnected();
        _wl.srv.signedIn = !!(S && S.me && S.me());
        if (!_wl.srv.connected) srvSay(t('This window is not connected to the server. Try again.'), true);
        else if (S && S.state.status === 'unreachable') srvSay(t('The server does not answer right now. Topo keeps trying.'), true);
    } else if (isApp() && !appClient()) {
        try { _wl.serverAsk = (await wlInvoke('server_question')) === true; } catch (e) { _wl.serverAsk = false; }
        // Offered whenever this PC can run the service and does not yet,
        // asked or not (D142, D336); only the question is once (D170).
        try { _wl.srvInfo = await wlInvoke('server_info'); } catch (e) { _wl.srvInfo = null; }
        const info = _wl.srvInfo;
        _wl.serverOffer = _wl.serverAsk || !!(info && info.available && info.service && info.service.supported && !info.service.installed);
    }
    fillProfiles();
    fillLock();
    fillServerForm();
    if (resume && _wl.srv.email) el('wlSrvEmail').value = _wl.srv.email;
    el('wlAddPc').checked = false;
    el('wlMonitor').checked = false;
    _wl.open = true;
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onDismiss: () => dismiss('closed') });
    else scrim.hidden = false;
    _wl.steps = stepsFor();
    if (resume) {
        const at = _wl.srv.signedIn ? 'lock' : (_wl.srv.connected ? 'srvEmail' : (_wl.pick.where === 'server' ? 'srvWait' : 'srvAddr'));
        if (!_wl.srv.connected && _wl.pick.where === 'server') _wl.srv.failed = true;
        goTo(at);
    } else render();
}

function closeDialog() {
    const scrim = el('welcomeDialog');
    _wl.open = false;
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else if (scrim) scrim.hidden = true;
}

// ✕ or Esc. While a step is being applied (the PIN's hash, an
// administrator prompt, a connect), Setup does not walk away from it: it
// closes once the step is done, so what that step did is answered as done
// (D125's "yes" after a set-up) and a connect that succeeds is not resumed
// after its reload (D359).
function dismiss(how) {
    if (!_wl.open) return;
    if (!_wl.busy) { finish(how); return; }
    _wl.closeWanted = how || 'closed';
    // A connect may reload the window before the step ends: Setup is
    // closed then too, not resumed, not shown again.
    rs.clear();
    markDone(_wl.closeWanted);
    if (isSrv(current())) srvSay(t('Setup closes once this step is done.'));
    else el('wlLockMsg').textContent = t('Setup closes once this step is done.');
}
// A close waiting for a step: now. -> true when Setup closed.
function settleClose() {
    if (!_wl.closeWanted || !_wl.open || _wl.busy) return false;
    const how = _wl.closeWanted;
    _wl.closeWanted = '';
    finish(how);
    return true;
}

// Ends the welcome, however: the mark, the theme back from a preview, D125's
// question answered ("not now" unless Setup set the service up, D353), a
// certificate comparison Setup started cancelled (nothing pinned).
function finish(how) {
    if (!_wl.open) return;
    unpreviewTheme();
    _wl.keptTheme = null;
    _wl.busy = false;
    _wl.closeWanted = '';
    stopWait();
    rs.clear();
    const DC = DCl();
    if (DC && DC.state.probe && (current() === 'srvCompare' || _wl.srv.probed)) DC.dcCancel();
    _wl.srv.probed = false;
    answerServer(false);
    markDone(how);
    closeDialog();
    // What waits for an open network (D331).
    const want = [];
    if (_wl.pick.pc) want.push('pc');
    if (_wl.pick.monitor) want.push('monitor');
    if (want.length) { ss.set(want, Date.now()); startPolling(); }
}

// Next: what is on screen is applied; the next step.
// While a Next is applied (the PIN's hash, a server step), Next, Skip and
// Back wait, and the step moves on only if the welcome is still at it (D336).
async function next() {
    if (!_wl.open || _wl.busy) return;
    const name = current();
    if (name === 'theme') keepTheme(_wl.pick.theme || currentTheme());
    else if (name === 'mode') applyMode();
    else if (name === 'where') applyWhere();
    else if (name === 'lock') {
        const at = _wl.i;
        _wl.busy = true;
        let kept;
        try { kept = await applyLock(); } finally { _wl.busy = false; }
        if (settleClose()) return;
        if (!kept || !_wl.open || _wl.i !== at) return;
    }
    else if (name === 'pc') {
        _wl.pick.pc = !el('wlAddPcRow').hidden && el('wlAddPc').checked;
        _wl.pick.monitor = !el('wlMonitorRow').hidden && el('wlMonitor').checked;
    }
    else if (isSrv(name)) { await serverNext(name); return; }
    advance();
}
// Skip: nothing of this step is applied. On a server step it ends the walk
// (D354): what is done stays done, the rest is in Settings.
function skip() {
    if (!_wl.open || _wl.busy) return;
    const name = current();
    if (name === 'start') { finish('done'); return; }
    if (name === 'theme') { unpreviewTheme(); delete _wl.pick.theme; }
    if (name === 'mode') { delete _wl.pick.mode; delete _wl.pick.profile; }
    if (name === 'where' && !_wl.srv.connected) delete _wl.pick.where;
    if (name === 'pc') { _wl.pick.pc = false; _wl.pick.monitor = false; }
    if (isSrv(name)) {
        stopWait();
        rs.clear();
        if (name === 'srvCompare' && DCl()) DCl().dcCancel();
        _wl.srv.probed = false;
        _wl.srv.skipped = true;
        srvSay('');
        goTo('lock');
        return;
    }
    advance();
}
function advance() {
    const name = current();
    _wl.steps = stepsFor();
    const at = _wl.steps.indexOf(name);
    if (at >= 0 && at < _wl.steps.length - 1) { _wl.i = at + 1; render(); }
    else if (at < 0 && _wl.i < _wl.steps.length) render();
    else finish('done');
}
function back() {
    if (_wl.busy || !_wl.open) return;
    const name = current();
    if (isSrv(name)) {
        stopWait();
        srvSay('');
        _wl.srv.failed = false;
        // Comparing: back to the address, nothing pinned (dcCancel).
        if (name === 'srvCompare') { if (DCl()) DCl().dcCancel(); _wl.srv.probed = false; goTo('srvAddr'); return; }
    }
    _wl.steps = stepsFor();
    const at = _wl.steps.indexOf(name);
    if (at > 0) { _wl.i = at - 1; render(); }
}

// The mode, exactly as the mode picker sets it (D142).
function applyMode() {
    const m = _wl.pick.mode;
    if (m === 'full') { state.settings.advanced = true; saveSettings(); applyProfile(); }
    else if (m === 'simple') {
        const k = PROFILES[_wl.pick.profile] ? _wl.pick.profile : (PROFILES[state.settings.profile] ? state.settings.profile : 'simple');
        state.settings.profile = k; state.settings.advanced = false; saveSettings(); applyProfile();
    }
}

function answerServer(yes) {
    if (!_wl.serverAsk || _wl.serverAnswered) return;
    _wl.serverAnswered = true;
    wlInvoke('server_question_done', { answer: yes ? 'yes' : 'no' }).catch(() => { /* asked anyway */ });
}
// D125's answer goes when Setup ends (finish), so Back can still change
// it; skipping the step is "not now" (D170). "yes" only once the service
// is set up (D353).
function applyWhere() {
    _wl.pick.where = _wl.pick.where || 'here';
    if (walking() && !_wl.srv.connected) { _wl.srv.skipped = false; srvSay(''); }
}

async function applyLock() {
    const L = window.TopoLock;
    if (!L) return true;
    const min = Number(el('wlLockAfter').value);
    if (min !== L.lockAfterMin()) L.setLockAfterMin(min);
    const a = el('wlPin1').value, b = el('wlPin2').value;
    if (el('wlPinBox').hidden || (!a && !b)) return true;
    const msg = el('wlLockMsg');
    if (!/^\d{4,12}$/.test(a)) { msg.textContent = t('A PIN is 4 to 12 digits.'); el('wlPin1').focus(); return false; }
    if (a !== b) { msg.textContent = t('The two PINs are not the same.'); el('wlPin2').focus(); return false; }
    msg.textContent = t('Saving…');
    el('wlNext').disabled = true;
    try { await L.setPin(a); }
    catch (e) { msg.textContent = t('The PIN could not be kept in this browser.'); return false; }
    finally { el('wlNext').disabled = false; }
    el('wlPin1').value = ''; el('wlPin2').value = '';
    msg.textContent = '';
    if (typeof showToast === 'function') showToast(t('PIN set. Topo asks for it to unlock.'), 'ok');
    return true;
}

// ---- The server, step by step (D353) ----
// Each step's Next runs the function Settings runs for it; its answer is
// said on the step (an error stays there, and Next tries again).
function srvSay(text, isErr) {
    _wl.srv.msg = text || '';
    _wl.srv.err = !!(text && isErr);
    if (_wl.open && isSrv(current())) {
        el('wlSrvMsg').textContent = _wl.srv.msg;
        el('wlSrvMsg').classList.toggle('wl-err', _wl.srv.err);
        el('wlSrvMsg').setAttribute('role', _wl.srv.err ? 'alert' : 'status');
    }
}
function setBusy(on) {
    _wl.busy = on;
    el('wlNext').disabled = on;
    el('welcomeDialog').querySelector('.topo-welcome').setAttribute('aria-busy', on ? 'true' : 'false');
}
// What Setup needs to go on after the reload Connect makes.
function leaveFor(step) {
    rs.set({ step, again: _wl.again, where: _wl.pick.where, own: _wl.srv.own, mail: _wl.srv.mail, email: _wl.srv.email, url: _wl.srv.url,
        serverAsk: _wl.serverAsk, serverAnswered: _wl.serverAnswered, serverOffer: _wl.serverOffer });
}

async function serverNext(name) {
    const at = name;
    setBusy(true);
    let go = null;
    try { go = await SERVER_NEXT[name](); }
    catch (e) { srvSay(t('Something went wrong: {why}', { why: String(e && e.message ? e.message : e) }), true); go = null; }
    finally { setBusy(false); }
    if (settleClose()) return;
    if (!_wl.open || current() !== at) return;
    if (go) goTo(go);
    else render();
}

const SERVER_NEXT = {
    // The address: Settings' Connect (dcConnect). A certificate it cannot
    // check is compared first; anything else connects, and the window reloads.
    async srvAddr() {
        const DC = DCl();
        if (!DC) return null;
        const url = el('wlSrvUrl').value.trim();
        _wl.srv.url = url; _wl.srv.own = false; _wl.srv.mail = '';
        srvSay(t('Looking for the server…'));
        leaveFor('srvEmail');
        const done = await DC.dcConnect(url);
        if (done) { srvSay(t('Connected. Opening…')); return null; }
        rs.clear();
        if (DC.state.probe) { _wl.srv.probed = true; srvSay(''); return 'srvCompare'; }
        srvSay(DC.state.note || DC.dcErrText('offline'), DC.state.noteErr !== false);
        return null;
    },
    // They are the same: Settings' dcTrust pins it; the window reloads.
    async srvCompare() {
        const DC = DCl();
        if (!DC || !DC.state.probe) return 'srvAddr';
        leaveFor('srvEmail');
        const done = await DC.dcTrust();
        _wl.srv.probed = false;
        if (done) { srvSay(t('Connected. Opening…')); return null; }
        rs.clear();
        srvSay(DC.state.note || DC.dcErrText('offline'), true);
        return null;
    },
    // The owner and who opens it: Settings' own form, then its Run it in
    // the background from startup (dsSetUpWith). D125's "yes" goes now.
    async srvOwner() {
        const DS = DSv();
        if (!DS) return null;
        const owner = el('wlSrvOwner').value.trim();
        const lan = el('wlSrvWho').value === 'lan';
        const over = { ownerEmail: owner, lan, mail: lan ? 'smtp' : 'none' };
        if (lan) {
            const port = parseInt(el('wlSrvSmtpPort').value, 10);
            Object.assign(over, { smtpHost: el('wlSrvSmtpHost').value.trim(), smtpPort: Number.isFinite(port) ? port : 0, smtpSecurity: el('wlSrvSmtpSec').value,
                smtpUser: el('wlSrvSmtpUser').value.trim(), smtpFrom: el('wlSrvSmtpFrom').value.trim() });
        }
        srvSay(t('Setting it up… The administrator prompt may ask for a password.'));
        const r = await DS.dsSetUpWith(over, lan ? el('wlSrvSmtpPass').value : '');
        if (!r) { srvSay(t('Settings is still busy with the server. Try again.'), true); return null; }
        if (r.error) { srvSay(DS.dsErrText(r.error), true); return null; }
        el('wlSrvSmtpPass').value = '';
        answerServer(true);
        Object.assign(_wl.srv, { own: true, mail: over.mail, email: owner, failed: false });
        srvSay(t('Set up. Waiting for the server to start…'));
        setTimeout(startWait, 0);
        return 'srvWait';
    },
    // Try again, after the wait gave up: the service started (Settings'
    // Start), then the wait again.
    async srvWait() {
        const DS = DSv();
        _wl.srv.failed = false;
        srvSay(t('Set up. Waiting for the server to start…'));
        if (DS && DS.state.info && !DS.state.info.running) {
            const r = await DS.dsStart();
            if (r && r.error) { _wl.srv.failed = true; srvSay(DS.dsErrText(r.error), true); return null; }
        }
        setTimeout(startWait, 0);
        return null;
    },
    // The email: js/server.js requestCode, as the sign-in sheet does.
    async srvEmail() {
        const S = TS();
        if (!S || !reconnected()) { srvSay(t('This window is not connected to the server. Try again.'), true); return null; }
        if (S.state.opening) { try { await S.state.opening; } catch (e) { /* said below */ } }
        if (S.me && S.me()) { _wl.srv.signedIn = true; srvSay(''); return 'lock'; }
        const email = el('wlSrvEmail').value.trim();
        if (!email) { srvSay(t('Type your email address. A code to sign in will be sent there.'), true); return null; }
        _wl.srv.email = email;
        const ownCode = _wl.srv.own && _wl.srv.mail === 'none';
        // A code sent before this request is an older one (D358).
        _wl.srv.sentAt = Date.now();
        srvSay(t('Sending…'));
        try {
            const token = el('wlSrvTokenRow').hidden ? undefined : (el('wlSrvToken').value.trim() || undefined);
            _wl.srv.challenge = await S.requestCode(email, { setupToken: token });
        } catch (e) { srvSay(errText(e), true); return null; }
        el('wlSrvCode').value = '';
        srvSay('');
        if (ownCode) setTimeout(watchCode, 0);
        return 'srvCode';
    },
    // The code: js/server.js verifyCode; a first owner's keys and recovery
    // key follow as at any sign-in (the server sheet), then the lock step.
    async srvCode() {
        const S = TS();
        const code = el('wlSrvCode').value.replace(/\D/g, '');
        if (code.length < 6) { srvSay(t('Type the 6-digit code.'), true); return null; }
        if (!S || !_wl.srv.challenge) return 'srvEmail';
        srvSay(t('Signing in…'));
        try { await S.verifyCode(_wl.srv.challenge, code, _wl.srv.email); }
        catch (e) { srvSay(errText(e), true); return null; }
        stopWait();
        rs.clear();
        _wl.srv.signedIn = !!(S.me && S.me());
        srvSay('');
        // As the sign-in sheet ends (js/serverui.js signedInDone).
        if (S.state.status === 'locked' && window.TopoServerUI && TopoServerUI.openUnlock) TopoServerUI.openUnlock();
        return 'lock';
    },
};
const errText = (e) => (window.TopoServerUI && TopoServerUI.errText ? TopoServerUI.errText(e) : t('Something went wrong on the server. Try again.'));
async function safeInfo() {
    const DS = DSv();
    if (!DS) return null;
    try { return await DS.dsRefresh(false); } catch (e) { return null; }
}
// A code sent for this request, not an older one: the server's clock is
// this PC's, a second of slack for its millisecond rounding (D358).
const freshCode = (c) => !!(c && c.code && c.at >= _wl.srv.sentAt - 1000);

// Waiting for this PC's service, then this window connected to it
// (dcConnectOwn, as Open it in this window does); the window reloads.
function stopWait() { clearTimeout(_wl.timer); _wl.timer = 0; _wl.srv.gen++; }
function startWait() {
    stopWait();
    const gen = _wl.srv.gen, t0 = Date.now();
    const tick = async () => {
        if (!_wl.open || gen !== _wl.srv.gen || current() !== 'srvWait') return;
        const info = await safeInfo();
        if (!_wl.open || gen !== _wl.srv.gen || current() !== 'srvWait') return;
        const lan = !!(info && info.settings && info.settings.lan);
        if (info && info.running && info.settings && info.settings.port && (!lan || info.fingerprint)) {
            await connectOwn(info);
            return;
        }
        if (info && !info.running && info.error && Date.now() - t0 > 5000) { waitFailed(DSv().dsErrText(info.error)); return; }
        if (Date.now() - t0 > _wl.waitFor) { waitFailed(t('The server has not started yet. Its log is in Settings, This PC as the server.')); return; }
        _wl.timer = setTimeout(tick, _wl.waitMs);
    };
    _wl.timer = setTimeout(tick, 0);
}
function waitFailed(text) {
    _wl.srv.failed = true;
    srvSay(text, true);
    if (_wl.open && current() === 'srvWait') render();
}
// Connecting is a step being applied too: a close waits for it (D359).
async function connectOwn(info) {
    const DC = DCl();
    if (!DC) { waitFailed(t('This window is not connected to the server. Try again.')); return; }
    const lan = !!info.settings.lan;
    _wl.srv.url = DC.ownUrl(info.settings.port, lan);
    srvSay(t('Running. Connecting this window to it…'));
    leaveFor('srvEmail');
    setBusy(true);
    try {
        const done = await DC.dcConnectOwn(info.settings.port, lan, info.fingerprint || '');
        setBusy(false);
        if (done) { if (!settleClose()) srvSay(t('Connected. Opening…')); return; }
        rs.clear();
        if (settleClose()) return;
        waitFailed(DC.state.note || DC.dcErrText('offline'));
    } catch (e) {
        setBusy(false);
        rs.clear();
        if (settleClose()) return;
        waitFailed(DC.dcErrText(e));
    }
}
// The code from this PC's own server, fetched by the app with its key
// (dsSignInCode, D358), once the one for this request is there.
function watchCode() {
    stopWait();
    const gen = _wl.srv.gen, t0 = Date.now();
    const DS = DSv();
    const tick = async () => {
        if (!_wl.open || gen !== _wl.srv.gen || current() !== 'srvCode') return;
        let got = null, err = '';
        try { got = DS ? await DS.dsSignInCode(_wl.srv.email) : null; } catch (e) { err = String(e && e.message ? e.message : e); }
        if (!_wl.open || gen !== _wl.srv.gen || current() !== 'srvCode') return;
        if (freshCode(got)) {
            el('wlSrvCode').value = got.code;
            srvSay(t('Topo got the code from this PC\'s server. Sign in.'));
            el('wlNext').focus({ preventScroll: true });
            return;
        }
        // A server set up without the app's key: retrying cannot help.
        if (err === 'no-code-key') { srvSay(DS.dsErrText(err), true); return; }
        if (Date.now() - t0 > 30000) { srvSay(t('No code came from this PC\'s server. Back, then send a new code.'), true); return; }
        _wl.timer = setTimeout(tick, _wl.waitMs);
    };
    _wl.timer = setTimeout(tick, 0);
}

// ---- Start (D142 step 6): the landing's own ways in ----
function startWith(kind) {
    finish('done');
    const landing = typeof landingIsOpen === 'function' && landingIsOpen();
    if (kind === 'file') { el('importFileInput').click(); return; }
    if (kind === 'map') {
        if (landing) closeLanding();
        openAddDevices({ mode: 'new', simpleAfter: isReduced() });
        return;
    }
    if (kind === 'empty') {
        if (landing) startNewNetwork();
        else newNetwork();
    }
}

// ---- What waits for an open network (D331) ----
// Add this computer and Monitor from this PC act on the open network, so
// they run once one is open and nothing else is on screen (no landing, no
// dialog, not locked), in that order, kept for this tab across a reload
// (Connect to a Topo server reloads the page), given up after 30 minutes.
function idle() {
    if (_wl.open) return false;
    if (document.body.classList.contains('chrome-pending')) return false;
    if (typeof landingIsOpen === 'function' && landingIsOpen()) return false;
    if (window.TopoLock && TopoLock.isLocked()) return false;
    if (window.CarinoUI && CarinoUI.modal.top()) return false;
    return ![...document.querySelectorAll('.modal-scrim')].some((s) => !s.hidden && !s.classList.contains('hidden') && s.getClientRects().length);
}
function runNext() {
    const { at, tasks: list } = ss.read();
    if (!list.length) { stopPolling(); return false; }
    if (Date.now() - at > NEXT_GIVE_UP_MS) { ss.set([]); stopPolling(); return false; }
    if (!idle()) return false;
    const task = list.shift();
    ss.set(list);
    if (task === 'pc' && window.TopoThisComputer && TopoThisComputer.hasHost()) TopoThisComputer.addThisComputer({ setup: true });
    else if (task === 'monitor' && window.TopoChecks && TopoChecks.hasHost()) openMonitorOffer();
    if (!list.length) stopPolling();
    return true;
}
// Settings at Monitor from this PC, its tick ticked: the offer under it
// (the network it checks, the tray and Open Topo at sign-in), as a click
// on the tick opens it. Turning it on stays the person's click.
function openMonitorOffer() {
    if (typeof openSettings === 'function') openSettings('monitor');
    const sec = el('setMonSec'), box = el('setMonOn');
    if (!sec || sec.hidden || !box) return;
    // The Monitoring tab, scrolled to it (D361).
    if (typeof revealInSettings === 'function') revealInSettings(sec, { focus: false });
    else sec.scrollIntoView({ block: 'start' });
    if (!box.checked) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
}
function startPolling() {
    if (_wl.poll) return;
    _wl.poll = setInterval(runNext, 1000);
}
function stopPolling() { clearInterval(_wl.poll); _wl.poll = 0; }
function resumeNext() { if (ss.get().length) startPolling(); }

// ---- Wiring ----
(function wire() {
    const scrim = el('welcomeDialog');
    if (!scrim) return;
    el('wlThemes').addEventListener('click', (e) => {
        const b = e.target.closest('[data-theme]');
        if (!b) return;
        _wl.pick.theme = b.dataset.theme;
        previewTheme(b.dataset.theme);
        render();
    });
    el('wlModes').addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]');
        if (!b) return;
        _wl.pick.mode = b.dataset.mode;
        render();
    });
    el('wlProfiles').addEventListener('click', (e) => {
        const b = e.target.closest('[data-profile]');
        if (!b) return;
        _wl.pick.profile = b.dataset.profile;
        render();
    });
    el('wlWhereApp').addEventListener('click', (e) => {
        const b = e.target.closest('[data-where]');
        if (!b) return;
        _wl.pick.where = b.dataset.where;
        render();
    });
    el('wlSrvWho').addEventListener('change', () => renderServer('srvOwner'));
    el('wlNext').addEventListener('click', () => { next(); });
    el('wlSkip').addEventListener('click', skip);
    el('wlBack').addEventListener('click', back);
    // Enter in a field is Next, as the field's own button would be.
    ['wlPin2', 'wlSrvUrl', 'wlSrvOwner', 'wlSrvEmail', 'wlSrvToken', 'wlSrvCode', 'wlSrvSmtpFrom'].forEach((id) => {
        el(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    });
    el('wlOpenFile').addEventListener('click', () => startWith('file'));
    el('wlMapNow').addEventListener('click', () => startWith('map'));
    el('wlEmpty').addEventListener('click', () => startWith('empty'));
    el('wlHandoffGo').addEventListener('click', () => finish('done'));
    if (!window.CarinoUI) {
        el('wlClose').addEventListener('click', () => dismiss('closed'));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _wl.open) dismiss('closed'); });
    }
    const again = el('setWelcomeAgain');
    if (again) again.addEventListener('click', () => {
        if (typeof closeSettings === 'function') closeSettings();
        openWelcome(true);
    });
})();

// Settings, Setup: Run the setup again, in the desktop app only (D425).
function renderWelcomeSettings() {
    const sec = el('setWelcomeSec');
    if (sec) sec.hidden = !isApp();
}
window.renderWelcomeSettings = renderWelcomeSettings;

window.TopoWelcome = {
    state: _wl, ARRIVAL, WL_KEY, NEXT_KEY, RESUME_KEY,
    atBoot, open: openWelcome, finish, dismiss, next, skip, back, runNext, idle, stepsFor, doneMark,
    isOpen: () => _wl.open,
    // Tests: the page goes away as at a reload (storage kept, nothing ended).
    _unload() { stopWait(); stopPolling(); if (_wl.open) closeDialog(); _wl.busy = false; _wl.closeWanted = ''; _wl.pick = {}; _wl.srv = freshSrv(); },
    step: () => (_wl.open ? current() : ''),
    // Tests: back to a PC that has never seen it.
    _reset() {
        ls.del(WL_KEY); ss.set([]); rs.clear(); stopPolling(); stopWait();
        if (_wl.open) { _wl.keptTheme = null; closeDialog(); }
        _wl.busy = false; _wl.closeWanted = ''; _wl.invoke = null; _wl.pick = {}; _wl.srv = freshSrv(); _wl.srvInfo = null;
        _wl.waitMs = 1000; _wl.waitFor = 90000;
    },
};
})();
