// ---- The welcome (docs/SCOPE.md D138, D141-D143, D170, D326-D335; step 7l) ----
// The first time Topo starts on a PC or in a browser, a few questions, each
// one skippable, each one handed to the piece that already does it:
//
//   theme  Gold or Colourful: the navbar's theme switch (carino-theme.js),
//          so the choice is kept as that switch keeps it.
//   mode   Document the network (the full editor) or Report problems (the
//          simple view, then General or Imagenology): set exactly as the
//          mode picker sets it (js/app.js openModePicker).
//   where  The desktop app: on this PC only; Connect to a Topo server
//          (Settings, js/desktopclient.js, D144); or Make this PC the server
//          (Settings, js/desktopserver.js, D113, D125), offered where this
//          PC can run the service and does not yet (D336); D125's question
//          (server_question) is answered here once (D170). The website: on this browser, and a Topo server opens at
//          its own address (D66). Not asked on a page a Topo server served,
//          nor in an app window already connected to one.
//   lock   The screen lock's time and PIN (js/idlelock.js, D134).
//   pc     The desktop app only: Add this computer to the map (js/
//          thiscomputer.js, through the Import… review) and Monitor from
//          this PC (js/checks.js, off unless ticked). Both need an open
//          network, so they wait until one is (D331).
//   start  Open a file, Map the network now (the '#setup' intake's Add
//          devices), or An empty network: the landing's own buttons. With a
//          server chosen in step 3, Settings opens instead (D330).
//
// When it shows (D141, D326): on a plain start only (no link, no '#setup',
// '?profile=' or mode entry, no reload of an open network: the landing is
// what that start shows), once per PC or browser. The mark is localStorage
// WL_KEY; a browser or app that already holds networks counts as done, so an
// install from before the welcome never sees it (D327). Settings has "Run
// the welcome again". Skipping a step changes nothing; closing it (✕ or
// Esc) skips the rest and marks it done. Nothing here is in the document.
// Load order: ... -> reports -> welcome -> app -> settings

(function () {
'use strict';

const WL_KEY = 'topo-welcome';
const NEXT_KEY = 'topo-welcome-next';     // sessionStorage: the waiting pc/monitor tasks
const NEXT_GIVE_UP_MS = 30 * 60000;

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

const _wl = {
    // Tests: (cmd, args) => Promise for the app's commands; null uses the
    // app's own window.__TAURI__.
    invoke: null,
    // Tests: true/false forces "a page a Topo server served"; null asks js/server.js.
    served: null,
    open: false,
    steps: [], i: 0,
    pick: {},              // the choices made on screen, applied on Next
    keptTheme: null,       // the theme kept now (as the welcome opened, or the last Next)
    serverAsk: false,      // the app said to ask D125's question
    serverOffer: false,    // Make this PC the server is offered (D336)
    serverAnswered: false,
    busy: false,           // a Next is being applied (the PIN): nothing else moves
    poll: 0,
    again: false,
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

function wlInvoke(cmd, args) {
    if (_wl.invoke) return Promise.resolve().then(() => _wl.invoke(cmd, args || {}));
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
// The desktop app (or a test's stand-in for it).
const isApp = () => !!_wl.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
const servedByServer = () => (_wl.served !== null ? !!_wl.served
    : !!(window.TopoServer && typeof TopoServer.serverMarked === 'function' && TopoServer.serverMarked()));
const appClient = () => { const DC = window.CarinoDesktopClient; return !!(DC && DC.connectedTo && DC.connectedTo()); };

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
// 'existing' or 'skipped'.
async function atBoot() {
    resumeNext();
    if (doneMark()) { fallbackQuestion(); return 'done'; }
    if (!plainStart()) { fallbackQuestion(); return 'skipped'; }
    if (holdsNetworks()) { markDone('existing'); fallbackQuestion(); return 'existing'; }
    await openWelcome(false);
    return 'shown';
}
// Where the welcome does not run, D125's question is still asked once by
// its own prompt (js/desktopserver.js), where the app says to ask it.
function fallbackQuestion() {
    const DS = window.CarinoDesktopServer;
    if (!isApp() || !DS || typeof DS.dsFirstRun !== 'function') return;
    setTimeout(() => { if (!_wl.open) DS.dsFirstRun(); }, 1500);
}

// ---- The steps ----
function stepsFor() {
    const app = isApp();
    const list = ['theme', 'mode'];
    if (!servedByServer() && !(app && appClient())) list.push('where');
    list.push('lock');
    const pcOk = app && el('wlAddPc') && ((window.TopoThisComputer && TopoThisComputer.hasHost()) || (window.TopoChecks && TopoChecks.hasHost()));
    if (pcOk) list.push('pc');
    list.push('start');
    return list;
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

function render() {
    const name = _wl.steps[_wl.i];
    document.querySelectorAll('#welcomeDialog .wl-step').forEach((s) => { s.hidden = s.dataset.step !== name; });
    el('wlCount').textContent = t('Step {n} of {total}', { n: _wl.i + 1, total: _wl.steps.length });
    const last = name === 'start';
    el('wlBack').hidden = _wl.i === 0;
    el('wlNext').hidden = last;
    el('wlSkip').textContent = last ? t('Not now') : t('Skip this step');
    if (name === 'theme') pressed(el('wlThemes'), 'data-theme', _wl.pick.theme || currentTheme());
    if (name === 'mode') {
        const m = _wl.pick.mode || '';
        pressed(el('wlModes'), 'data-mode', m);
        el('wlPurpose').hidden = m !== 'simple';
        if (m === 'simple') pressed(el('wlProfiles'), 'data-profile', _wl.pick.profile || state.settings.profile || 'simple');
    }
    if (name === 'where') {
        const app = isApp();
        el('wlWhereApp').hidden = !app;
        el('wlWhereWeb').hidden = app;
        el('wlWhereApp').querySelector('[data-where="server"]').hidden = !_wl.serverOffer;
        pressed(el('wlWhereApp'), 'data-where', _wl.pick.where || 'here');
    }
    if (name === 'pc') {
        el('wlAddPcRow').hidden = !(window.TopoThisComputer && TopoThisComputer.hasHost());
        el('wlMonitorRow').hidden = !(window.TopoChecks && TopoChecks.hasHost());
    }
    if (name === 'start') {
        const hand = _wl.pick.where === 'connect' || _wl.pick.where === 'server';
        el('wlStarts').hidden = hand;
        el('wlHandoff').hidden = !hand;
        el('wlStartHead').textContent = hand ? t('One more thing') : t('How do you want to start?');
        if (hand) {
            el('wlHandoffText').textContent = _wl.pick.where === 'connect'
                ? t('Settings opens at Connect to a Topo server: type the server\'s address, compare its certificate if asked, then sign in with your email.')
                : t('Settings opens at This PC as the server: fill in the owner\'s email (and, for other PCs, the email settings), then Run it in the background from startup.');
        }
    }
    // Focus on the step's first control, so a keyboard and a screen reader
    // start where the question is.
    const sec = document.querySelector(`#welcomeDialog .wl-step[data-step="${name}"]`);
    const first = sec && [...sec.querySelectorAll('button, input, select')].find((x) => !x.disabled && x.getClientRects().length);
    if (first) first.focus({ preventScroll: true });
    const body = document.querySelector('#welcomeDialog .wl-body');
    if (body) body.scrollTop = 0;
}

async function openWelcome(again) {
    if (_wl.open) return;
    const scrim = el('welcomeDialog');
    if (!scrim) return;
    _wl.again = !!again;
    _wl.pick = {};
    _wl.i = 0;
    _wl.keptTheme = currentTheme();
    _wl.serverAsk = false; _wl.serverOffer = false; _wl.serverAnswered = false; _wl.busy = false;
    if (isApp() && !servedByServer() && !appClient()) {
        try { _wl.serverAsk = (await wlInvoke('server_question')) === true; } catch (e) { _wl.serverAsk = false; }
        // Offered whenever this PC can run the service and does not yet,
        // asked or not (D142, D336); only the question is once (D170).
        _wl.serverOffer = _wl.serverAsk;
        if (!_wl.serverOffer) {
            try {
                const info = await wlInvoke('server_info');
                _wl.serverOffer = !!(info && info.available && info.service && info.service.supported && !info.service.installed);
            } catch (e) { _wl.serverOffer = false; }
        }
    }
    _wl.steps = stepsFor();
    fillProfiles();
    fillLock();
    el('wlAddPc').checked = false;
    el('wlMonitor').checked = false;
    _wl.open = true;
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onDismiss: () => finish('closed') });
    else scrim.hidden = false;
    render();
}

function closeDialog() {
    const scrim = el('welcomeDialog');
    _wl.open = false;
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else if (scrim) scrim.hidden = true;
}

// Ends the welcome, however: the mark, the theme back from a preview, D125's
// question answered. "yes" only from Open Settings with Make this PC the
// server chosen (handOff); every other ending is "not now" (D170, D336).
function finish(how, serverYes) {
    if (!_wl.open) return;
    unpreviewTheme();
    _wl.keptTheme = null;
    _wl.busy = false;
    answerServer(!!serverYes && _wl.pick.where === 'server');
    markDone(how);
    closeDialog();
    // What waits for an open network (D331).
    const want = [];
    if (_wl.pick.pc) want.push('pc');
    if (_wl.pick.monitor) want.push('monitor');
    if (want.length) { ss.set(want, Date.now()); startPolling(); }
}

// Next: what is on screen is applied; the next step.
// While a Next is applied (the PIN's hash), Next, Skip and Back wait, and
// the step moves on only if the welcome is still at it (D336).
async function next() {
    if (!_wl.open || _wl.busy) return;
    const name = _wl.steps[_wl.i];
    if (name === 'theme') keepTheme(_wl.pick.theme || currentTheme());
    else if (name === 'mode') applyMode();
    else if (name === 'where') applyWhere();
    else if (name === 'lock') {
        const at = _wl.i;
        _wl.busy = true;
        let kept;
        try { kept = await applyLock(); } finally { _wl.busy = false; }
        if (!kept || !_wl.open || _wl.i !== at) return;
    }
    else if (name === 'pc') {
        _wl.pick.pc = !el('wlAddPcRow').hidden && el('wlAddPc').checked;
        _wl.pick.monitor = !el('wlMonitorRow').hidden && el('wlMonitor').checked;
    }
    advance();
}
// Skip: nothing of this step is applied.
function skip() {
    if (!_wl.open || _wl.busy) return;
    const name = _wl.steps[_wl.i];
    if (name === 'start') { finish('done'); return; }
    if (name === 'theme') { unpreviewTheme(); delete _wl.pick.theme; }
    if (name === 'mode') { delete _wl.pick.mode; delete _wl.pick.profile; }
    if (name === 'where') delete _wl.pick.where;
    if (name === 'pc') { _wl.pick.pc = false; _wl.pick.monitor = false; }
    advance();
}
function advance() {
    if (_wl.i < _wl.steps.length - 1) { _wl.i++; render(); }
    else finish('done');
}
function back() {
    if (_wl.busy) return;
    if (_wl.i > 0) { _wl.i--; render(); }
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
// The answer to D125's question goes when the welcome ends (finish), so
// Back can still change it; skipping the step is "not now" (D170).
function applyWhere() { _wl.pick.where = _wl.pick.where || 'here'; }

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
// A server chosen in step 3: Settings, at its section (D330).
async function handOff() {
    const where = _wl.pick.where;
    finish('done', true);
    if (where === 'server') {
        const DS = window.CarinoDesktopServer;
        if (DS && DS.dsOpenSetUp) await DS.dsOpenSetUp();
        return;
    }
    if (typeof openSettings === 'function') openSettings();
    const sec = el('setDcSec');
    if (sec && !sec.hidden) {
        sec.scrollIntoView({ block: 'start' });
        const url = el('setDcUrl');
        if (url && !url.closest('[hidden]')) url.focus({ preventScroll: true });
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
    if (task === 'pc' && window.TopoThisComputer && TopoThisComputer.hasHost()) TopoThisComputer.addThisComputer();
    else if (task === 'monitor' && window.TopoChecks && TopoChecks.hasHost()) openMonitorOffer();
    if (!list.length) stopPolling();
    return true;
}
// Settings at Monitor from this PC, its tick ticked: the offer under it
// (the network it checks, the tray and Open Topo at sign-in), as a click
// on the tick opens it. Turning it on stays the person's click.
function openMonitorOffer() {
    if (typeof openSettings === 'function') openSettings();
    const sec = el('setMonSec'), box = el('setMonOn');
    if (!sec || sec.hidden || !box) return;
    sec.scrollIntoView({ block: 'start' });
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
    el('wlNext').addEventListener('click', () => { next(); });
    el('wlSkip').addEventListener('click', skip);
    el('wlBack').addEventListener('click', back);
    el('wlPin2').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    el('wlOpenFile').addEventListener('click', () => startWith('file'));
    el('wlMapNow').addEventListener('click', () => startWith('map'));
    el('wlEmpty').addEventListener('click', () => startWith('empty'));
    el('wlHandoffGo').addEventListener('click', () => { handOff(); });
    if (!window.CarinoUI) {
        el('wlClose').addEventListener('click', () => finish('closed'));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _wl.open) finish('closed'); });
    }
    const again = el('setWelcomeAgain');
    if (again) again.addEventListener('click', () => {
        if (typeof closeSettings === 'function') closeSettings();
        openWelcome(true);
    });
})();

window.TopoWelcome = {
    state: _wl, ARRIVAL, WL_KEY, NEXT_KEY,
    atBoot, open: openWelcome, finish, next, skip, back, runNext, idle, stepsFor, doneMark,
    isOpen: () => _wl.open,
    // Tests: back to a PC that has never seen it.
    _reset() { ls.del(WL_KEY); ss.set([]); stopPolling(); if (_wl.open) { _wl.keptTheme = null; closeDialog(); } _wl.busy = false; _wl.invoke = null; _wl.served = null; _wl.pick = {}; },
};
})();
