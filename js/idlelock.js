// ---- The idle lock (docs/SCOPE.md section 7: D134, D165, D169, D213-D226) ----
// After a time without use (30 min unless changed; Off turns it off) Topo
// saves, closes the open network and covers the screen until someone unlocks
// it. Per PC: everything here lives in this browser's (or the desktop app's)
// storage, never in a document.
//
//   localStorage
//     topo-lock        the lock itself: { at, why, user: { id, email } | null,
//                      doc }: doc is the library card open when it locked.
//                      Present = every tab of this browser is locked; a tab
//                      that opens while it is there boots locked (D215).
//     topo-lock-after  minutes before it locks; '0' is Off; absent is 30.
//     topo-lock-pin    { v, iter, salt, hash, fails, lastFail }: the PIN as a
//                      PBKDF2-SHA-256 hash (D217) and the wrong tries so far.
//     topo-lock-seen   the last time any tab was used, so a tab left in the
//                      background does not lock the one in use (D216).
//     topo-lock-note   { at, kind }: the screen was unlocked without the PIN
//                      or the sign-in (Forget the PIN; the server not
//                      answering). Said in Settings until dismissed (D219).
//     topo-lock-down   { since }: while locked with a sign-in, the first time
//                      the server did not answer; cleared when it answers
//                      or on unlock (D223).
//   sessionStorage
//     topo-lock-drafts the Report a problem and Record visit drafts open
//                      when it locked, reopened after the unlock (D218).
//
// Locking clears the page by reloading it (D214): the kept network is in its
// card, a network that is not kept is in the tab's history entry (where a
// reload already finds it), and the page that comes back stops before it
// reads either. Unlocking lets that boot carry on (js/app.js awaits gate()).
//
// Unlocking: the PIN set on this PC, or the person's server sign-in (a code
// sent to the email that was signed in when it locked). Each wrong PIN says
// how many of the 10 tries are left; after 10 only the sign-in works. With no
// sign-in to fall back on, Forget the PIN unlocks from the fifth wrong one
// and is said afterwards, and after 10 each further try waits longer (D169,
// D219, D343). No PIN and no sign-in: a plain Unlock. A sign-in whose
// server does not answer is still a sign-in (D223, D346): the PIN keeps
// working (with the waits), Forget the PIN and the plain Unlock never come,
// and once the server has not answered for 72 h the one way past it is
// Forget the network and unlock: the network that was open and this
// server's networks kept here are deleted from this browser, its keys for
// that person too, and the window is signed out, so the screen opens on
// nothing of theirs.
//
// It is not encryption at rest, and Settings says so.
//
// For the alarm card (7g): TopoLock.showOver(el) puts an element above the
// cover, so a card shows while locked; TopoLock.requestUnlock(text) asks to
// unlock first (Acknowledge, Report a problem) and answers true once
// unlocked, false for Not now. isLocked() and onChange(fn) follow it.
//
// Loaded in <head> (after js/theme-boot.js) so a locked tab is covered
// before it paints; everything else here runs later.
(function () {
'use strict';

const LOCK_KEY = 'topo-lock', AFTER_KEY = 'topo-lock-after', PIN_KEY = 'topo-lock-pin';
const SEEN_KEY = 'topo-lock-seen', NOTE_KEY = 'topo-lock-note', DRAFTS_KEY = 'topo-lock-drafts';
const DOWN_KEY = 'topo-lock-down';
const DEFAULT_MIN = 30;
const CHOICES = [0, 5, 15, 30, 60];
const CUSTOM_MAX = 1440;
const PIN_RE = /^\d{4,12}$/;
// The wrong PINs before only the sign-in (or, with none, the waits) unlock,
// and the wrong ones before Forget the PIN is offered (D343).
const PIN_TRIES = 10, FORGET_AT = 5;
const WAIT_FIRST_S = 30, WAIT_MAX_S = 900;
const SEEN_WRITE_MS = 15000;

const realNow = Date.now.bind(Date);
const _hooks = {
    now: realNow,
    // Clearing the page: a reload. The suites put a stand-in here.
    reload: () => window.location.reload(),
    iterations: 600000,
    saveWaitMs: 8000,
    // How long a sign-in's server must stay silent before the lock lets go
    // without it, by forgetting the network (D223, D346).
    downGraceMs: 72 * 3600000
};

// ---- Storage (each access may throw: private windows, blocked storage) ----
const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing kept */ } }
};
const json = (k) => { try { return JSON.parse(ls.get(k)); } catch (e) { return null; } };
const marker = () => { const m = json(LOCK_KEY); return m && typeof m === 'object' && typeof m.at === 'number' ? m : null; };
// The lock in force in this tab: the stored one, or, when this browser
// refused to store it, the copy kept in the page (D224).
let _mem = null;
const current = () => marker() || _mem;

// Covered before the first paint (this file runs in <head>).
if (marker()) document.documentElement.classList.add('topo-locked');

// ---- The setting ----
function lockAfterMin() {
    const raw = ls.get(AFTER_KEY);
    if (raw === null || raw === '') return DEFAULT_MIN;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= 0 && n <= CUSTOM_MAX ? n : DEFAULT_MIN;
}
function setLockAfterMin(n) {
    n = Math.round(Number(n));
    if (!Number.isFinite(n) || n < 0) n = DEFAULT_MIN;
    n = Math.min(CUSTOM_MAX, n);
    if (n === DEFAULT_MIN) ls.del(AFTER_KEY); else ls.set(AFTER_KEY, String(n));
    seen(true);
    schedule();
}

// ---- The PIN (D217) ----
const pinRec = () => { const p = json(PIN_KEY); return p && p.v === 1 && p.hash && p.salt ? p : null; };
const hasPin = () => !!pinRec();
const canHash = () => !!(window.crypto && crypto.subtle && typeof crypto.subtle.deriveBits === 'function');
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pinHash(pin, salt, iter) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
    return b64(new Uint8Array(bits));
}
async function setPin(pin) {
    pin = String(pin || '');
    if (!PIN_RE.test(pin)) throw new Error('bad-pin');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iter = _hooks.iterations;
    const hash = await pinHash(pin, salt, iter);
    if (!ls.set(PIN_KEY, JSON.stringify({ v: 1, iter, salt: b64(salt), hash, fails: 0, lastFail: 0 }))) throw new Error('storage');
    return true;
}
function removePin() { ls.del(PIN_KEY); }
async function pinMatches(pin) {
    const p = pinRec();
    if (!p || !PIN_RE.test(String(pin || ''))) return false;
    return (await pinHash(String(pin), unb64(p.salt), p.iter || _hooks.iterations)) === p.hash;
}
const fails = () => { const p = pinRec(); return p ? (p.fails | 0) : 0; };
function setFails(n, at) {
    const p = pinRec();
    if (!p) return;
    p.fails = n; p.lastFail = at || 0;
    ls.set(PIN_KEY, JSON.stringify(p));
}
// The wait before the next try, in ms, once 10 are wrong and there is no
// sign-in to fall back on: 30 s after the tenth, doubling, at most 15 min.
function waitLeftMs() {
    const p = pinRec();
    if (!p || (p.fails | 0) < PIN_TRIES) return 0;
    const s = Math.min(WAIT_MAX_S, WAIT_FIRST_S * Math.pow(2, (p.fails | 0) - PIN_TRIES));
    return Math.max(0, (p.lastFail || 0) + s * 1000 - _hooks.now());
}

// ---- Use, across tabs (D216) ----
let _seen = realNow(), _seenWritten = 0;
function seen(force) {
    _seen = _hooks.now();
    if (force || _seen - _seenWritten > SEEN_WRITE_MS) { _seenWritten = _seen; ls.set(SEEN_KEY, String(_seen)); }
}
function lastSeen() {
    const other = Number(ls.get(SEEN_KEY)) || 0;
    return Math.max(_seen, other);
}

// ---- State ----
let _locked = false;        // the cover is up in this tab
let _locking = false;       // saving before the reload
let _gated = false;         // this tab booted locked and waits in gate()
let _inPlace = false;       // covered without a reload (the network could not be saved)
let _unkept = false;        // in place because this browser refused to keep the lock itself (D224)
let _gateResolve = null;
let _ask = null;            // { text, resolve }: requestUnlock
let _timer = 0, _waitTimer = 0;
let _watching = false;
let _server = { down: false, checked: false, challenge: null, busy: false };
const _listeners = new Set();
function emitChange() { _listeners.forEach((fn) => { try { fn(_locked); } catch (e) { console.warn('TopoLock listener', e); } }); }

// ---- The watch ----
function schedule() {
    clearTimeout(_timer); _timer = 0;
    if (!_watching || _locked || _locking) return;
    const min = lockAfterMin();
    if (!min) return;
    const left = lastSeen() + min * 60000 - _hooks.now();
    if (left <= 0) { lock('idle'); return; }
    // Looked at again at least each minute: a setting or another tab may change it.
    _timer = setTimeout(schedule, Math.max(250, Math.min(left, 60000)));
}
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'input'];
function onActivity() { if (!_locked && !_locking) seen(false); }
function startWatch() {
    if (_watching) { schedule(); return; }
    _watching = true;
    seen(true);
    ACTIVITY.forEach((ev) => window.addEventListener(ev, onActivity, { capture: true, passive: true }));
    window.addEventListener('scroll', onActivity, { capture: true, passive: true });
    // Timers sleep in a hidden tab and on a sleeping PC: look again on return.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(); });
    window.addEventListener('focus', schedule);
    schedule();
}

// ---- Locking ----
// Saving first (D165): the dialogs' drafts, the open document, the library's
// writes, a server card's push. Then the reload clears the page.
async function lock(why) {
    if (_locked || _locking) return false;
    _locking = true;
    clearTimeout(_timer);
    try {
        const drafts = collectDrafts();
        try {
            if (drafts) sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
            else sessionStorage.removeItem(DRAFTS_KEY);
        } catch (e) { /* the drafts stay in the page, which then is not cleared: see below */ }
        if (typeof flushPendingSaves === 'function') { try { flushPendingSaves(); } catch (e) { console.warn('Lock: save', e); } }
        // Who may sign in to unlock: the person signed in now, if any.
        const S = window.TopoServer;
        const me = S && typeof S.me === 'function' ? S.me() : null;
        const user = me && me.id && me.email ? { id: String(me.id), email: String(me.email) } : null;
        const doc = (typeof state !== 'undefined' && state.libraryId) || null;
        const rec = { at: _hooks.now(), why: why || 'idle', user, doc };
        // Kept? A browser refusing the write (site data blocked, storage
        // full) would boot the reloaded page unlocked: then no reload (D224).
        const kept = !!marker() || (ls.set(LOCK_KEY, JSON.stringify(rec)) && !!marker());
        _mem = marker() || rec;
        cover();
        await settleSaves();
        const safe = kept && pageCanGo(drafts);
        if (safe) { _hooks.reload(); return true; }
        // The open network could not be put anywhere a reload finds it, or
        // the lock could not be kept across one: it stays in the page, under
        // the cover, and the cover says so.
        _inPlace = true;
        _unkept = !kept;
        _locking = false;
        renderCover();
        return true;
    } finally { _locking = false; }
}
function collectDrafts() {
    const out = {};
    try { const d = window.TopoIncidents && TopoIncidents.problemDraftForLock && TopoIncidents.problemDraftForLock(); if (d) out.problem = d; } catch (e) { /* none */ }
    try { const d = window.TopoProviderMode && TopoProviderMode.visitDraftForLock && TopoProviderMode.visitDraftForLock(); if (d) out.visit = d; } catch (e) { /* none */ }
    if (!out.problem && !out.visit) return null;
    out.doc = (typeof state !== 'undefined' && (state.libraryId || state.docId)) || null;
    return out;
}
const withTimeout = (p, ms) => Promise.race([Promise.resolve(p).catch(() => false), new Promise((r) => setTimeout(() => r('timeout'), ms))]);
async function settleSaves() {
    const waits = [];
    if (typeof libraryWritesSettled === 'function') waits.push(libraryWritesSettled());
    const Y = window.TopoServerSync;
    if (Y && typeof Y.flushAll === 'function') { try { waits.push(Y.flushAll()); } catch (e) { /* offline: synced after the unlock */ } }
    await withTimeout(Promise.all(waits), _hooks.saveWaitMs);
}
// May the page go? Not when the live document is still waiting to be
// written into the tab's entry (too big for it, or the browser refusing),
// or the drafts did not fit in the tab's storage.
function pageCanGo(drafts) {
    try { if (typeof _livePending !== 'undefined' && _livePending !== null) return false; } catch (e) { /* not this page */ }
    // Writes parked for entries Back/Forward left (js/app.js): a reload here
    // would forget them.
    try { if (typeof _liveParked !== 'undefined' && _liveParked && _liveParked.size) return false; } catch (e) { /* not this page */ }
    if (drafts) { try { if (!sessionStorage.getItem(DRAFTS_KEY)) return false; } catch (e) { return false; } }
    return true;
}

// ---- The gate (js/app.js awaits it before reading anything) ----
function gate() {
    if (!marker()) { document.documentElement.classList.remove('topo-locked'); startWatch(); return Promise.resolve(true); }
    _gated = true;
    cover();
    return new Promise((resolve) => { _gateResolve = resolve; }).then(() => { startWatch(); return true; });
}

// ---- Unlocking ----
function unlocked(how) {
    ls.del(LOCK_KEY);
    ls.del(DOWN_KEY);
    if (how === 'pin' || how === 'signin') setFails(0, 0);
    seen(true);
    finishUnlock();
}
// This tab, after an unlock here or in another tab.
function finishUnlock() {
    if (!_locked) return;
    const n = readNote(), lockedAt = (_mem && _mem.at) || 0;
    if (n && n.kind === 'forgot-network' && n.at >= lockedAt) dropTabNetwork();
    _locked = false;
    _mem = null; _unkept = false;
    clearInterval(_waitTimer); _waitTimer = 0;
    _server = { down: false, checked: false, challenge: null, busy: false };
    const c = document.getElementById('lockCover');
    if (c) c.hidden = true;
    document.documentElement.classList.remove('topo-locked');
    if (_ask) { const a = _ask; _ask = null; a.resolve(true); }
    if (_gated) {
        _gated = false;
        const r = _gateResolve; _gateResolve = null;
        if (r) r(true);
        // Boot carries on from here (js/app.js) and reads the network back.
        window.addEventListener('topo:ready', () => setTimeout(reopenDrafts, 0), { once: true });
    } else if (_inPlace) { _inPlace = false; reopenDrafts(); }
    noteToast();
    emitChange();
    schedule();
}
function reopenDrafts() {
    let d = null;
    try { d = JSON.parse(sessionStorage.getItem(DRAFTS_KEY)); sessionStorage.removeItem(DRAFTS_KEY); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') return;
    const open = (typeof state !== 'undefined' && (state.libraryId || state.docId)) || null;
    if (d.doc && open !== d.doc) return;   // another network came back: its drafts are not this one's
    try { if (d.problem && window.TopoIncidents && TopoIncidents.reopenProblemDraft) TopoIncidents.reopenProblemDraft(d.problem); } catch (e) { console.warn('Lock: problem draft', e); }
    try { if (d.visit && window.TopoProviderMode && TopoProviderMode.reopenVisitDraft) TopoProviderMode.reopenVisitDraft(d.visit); } catch (e) { console.warn('Lock: visit draft', e); }
}

// Another tab locked or unlocked this browser.
window.addEventListener('storage', (e) => {
    if (e.key === LOCK_KEY || e.key === null) {
        if (marker()) { if (!_locked && !_locking && _watching) lock('other-tab'); }
        // A lock this tab holds only in the page (D224) is not another tab's to end.
        else if (_locked && !_unkept) finishUnlock();
        return;
    }
    if (e.key === PIN_KEY && _locked) renderCover();
    if (e.key === AFTER_KEY) { schedule(); if (typeof renderIdleLockSettings === 'function') renderIdleLockSettings(); }
});

// ---- The cover ----
const $ = (id) => document.getElementById(id);
const tr = (k, p) => (typeof t === 'function' ? t(k, p) : k);
const signInUser = () => { const m = current(); return m && m.user && m.user.email ? m.user : null; };
const serverThere = () => { const S = window.TopoServer; return !!(S && typeof S.serverMarked === 'function' && S.serverMarked()); };
// A sign-in to fall back on: someone was signed in when it locked, this page
// has their server, and it answers.
const signInPossible = () => !!signInUser() && serverThere() && !_server.down;
// A sign-in exists, answering or not (D165: then only it unlocks after 10
// wrong PINs).
const signInExists = () => !!signInUser() && serverThere();
// Its server silent since…, and whether that has lasted the grace (D223).
const downSince = () => { const d = json(DOWN_KEY); return d && typeof d.since === 'number' ? d.since : 0; };
function markDown(down) {
    _server.down = down;
    if (!down) { ls.del(DOWN_KEY); return; }
    if (!downSince()) ls.set(DOWN_KEY, JSON.stringify({ since: _hooks.now() }));
}
const downLong = () => _server.down && !!downSince() && _hooks.now() - downSince() >= _hooks.downGraceMs;
// No sign-in exists, so the PIN-less ways (Forget the PIN, the plain Unlock)
// may. A sign-in whose server is silent never opens them (D346); after the
// grace only Forget the network does.
const noSignInWay = () => !signInExists();
const canForgetNetwork = () => signInExists() && downLong();
function maskEmail(email) {
    const [name, host] = String(email).split('@');
    if (!host) return email;
    return (name.length <= 2 ? name[0] + '*' : name[0] + '***' + name.slice(-1)) + '@' + host;
}
function cover() {
    _locked = true;
    document.documentElement.classList.add('topo-locked');
    const c = $('lockCover');
    if (!c) return;
    wireCover();
    c.hidden = false;
    renderCover();
    emitChange();
    if (signInUser() && serverThere() && !_server.checked) checkServer();
    const pin = $('lockPin');
    setTimeout(() => { const f = hasPin() && !$('lockPinRow').hidden ? pin : $('lockPlainBtn'); if (f && !f.disabled && _locked) f.focus(); }, 0);
}
function timeText(ms) {
    const lang = window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined;
    try { return new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(ms).toTimeString().slice(0, 5); }
}
function setMsg(text, kind) {
    const m = $('lockMsg');
    if (!m) return;
    m.textContent = text || '';
    m.className = 'lock-msg' + (kind ? ' ' + kind : '');
}
function renderCover() {
    const c = $('lockCover');
    if (!c || !_locked) return;
    const m = current();
    const at = m ? m.at : _hooks.now();
    $('lockWhen').textContent = _locking ? tr('Saving, then locking…') : tr('Locked at {time}.', { time: timeText(at) });
    $('lockInPlace').hidden = !_inPlace;
    $('lockInPlace').textContent = _unkept
        ? tr('This browser would not keep the lock, so the open network stays under it in this tab.')
        : tr('The open network could not be saved, so it stays open under the lock.');
    // Asked to unlock for something (the alarm card's Acknowledge).
    $('lockAsk').hidden = !_ask;
    $('lockAsk').textContent = _ask ? _ask.text : '';
    $('lockNotNow').hidden = !_ask;
    const pin = hasPin(), user = signInUser(), si = signInPossible();
    const tooMany = pin && fails() >= PIN_TRIES;
    // The PIN: offered while it can still unlock.
    const pinOpen = pin && !(tooMany && si);
    $('lockPinRow').hidden = !pinOpen || _locking;
    const wait = pinOpen && tooMany && !si ? waitLeftMs() : 0;
    $('lockPin').disabled = wait > 0;
    $('lockPinBtn').disabled = wait > 0;
    clearInterval(_waitTimer); _waitTimer = 0;
    const stateLine = (text) => { const st = $('lockState'); st.textContent = text || ''; st.hidden = !text; };
    if (wait > 0) {
        stateLine(tr('Too many wrong PINs. Try again in {s} s.', { s: Math.ceil(wait / 1000) }));
        _waitTimer = setInterval(() => {
            if (waitLeftMs() <= 0) { clearInterval(_waitTimer); _waitTimer = 0; renderCover(); }
            else stateLine(tr('Too many wrong PINs. Try again in {s} s.', { s: Math.ceil(waitLeftMs() / 1000) }));
        }, 1000);
    } else if (tooMany && si) stateLine(tr('10 wrong PINs: only signing in unlocks now.'));
    else stateLine('');
    // The sign-in.
    const siShown = !!user && serverThere() && !_locking;
    $('lockSignIn').hidden = !siShown;
    if (siShown) {
        let lead = _server.down
            ? tr('Your Topo server does not answer, so signing in cannot unlock now.')
            : tr('Or sign in again: a code is sent to {email}.', { email: maskEmail(user.email) });
        // Silent, and nothing else unlocks (no PIN, or 10 wrong): when the
        // way without it opens (D223).
        if (_server.down && !downLong() && (!pin || tooMany) && downSince()) {
            const when = new Date(downSince() + _hooks.downGraceMs).toLocaleString(window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined, { dateStyle: 'short', timeStyle: 'short' });
            const more = tr('If it still does not answer on {when}, you can unlock by forgetting the network that was open.', { when });
            lead = typeof joinSentences === 'function' ? joinSentences([lead, more]) : lead + ' ' + more;
        }
        $('lockSignInLead').textContent = lead;
        $('lockSendCode').hidden = _server.down || !!_server.challenge;
        $('lockSendCode').disabled = _server.busy;
        $('lockRetry').hidden = !_server.down;
        $('lockCodeRow').hidden = _server.down || !_server.challenge;
        $('lockVerify').disabled = _server.busy;
    }
    // No PIN: a plain Unlock, unless a sign-in exists (D169, D219, D223).
    const plain = !pin && noSignInWay() && !_locking;
    $('lockPlain').hidden = !plain;
    $('lockPlainNote').textContent = user && serverThere()
        ? tr('Your Topo server does not answer. Unlocking now is noted in Settings.')
        : tr('Set a PIN in Settings so only you can unlock.');
    // Forget the PIN: from the fifth wrong one, where no sign-in exists.
    $('lockForget').hidden = !(pin && fails() >= FORGET_AT && noSignInWay()) || _locking;
    // Forget the network: a sign-in's server silent for 72 h (D346).
    $('lockForgetNet').hidden = !canForgetNetwork() || _locking;
}
let _wired = false;
function wireCover() {
    if (_wired) return;
    _wired = true;
    // The code field takes the phone's one-time code (js/ui.js set the
    // int keyboard, which turns autocomplete off).
    const code = $('lockCode');
    if (code) code.setAttribute('autocomplete', 'one-time-code');
    $('lockPinBtn').addEventListener('click', tryPin);
    $('lockPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tryPin(); } });
    $('lockPlainBtn').addEventListener('click', () => {
        if (hasPin() || !noSignInWay()) return;
        if (signInExists()) writeNote('no-server');
        unlocked('plain');
    });
    $('lockSendCode').addEventListener('click', sendCode);
    $('lockRetry').addEventListener('click', () => { _server.down = false; _server.checked = false; checkServer(); });
    $('lockVerify').addEventListener('click', verifyCode);
    $('lockCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verifyCode(); } });
    $('lockCode').addEventListener('input', () => { if ($('lockCode').value.replace(/\D/g, '').length === 6) verifyCode(); });
    $('lockForgetBtn').addEventListener('click', () => {
        const btn = $('lockForgetBtn');
        if (!btn.dataset.sure) { btn.dataset.sure = '1'; $('lockForgetSure').hidden = false; btn.textContent = tr('Forget the PIN and unlock'); return; }
        delete btn.dataset.sure;
        forgetPin();
    });
    $('lockForgetNetBtn').addEventListener('click', () => {
        const btn = $('lockForgetNetBtn');
        if (!btn.dataset.sure) { btn.dataset.sure = '1'; $('lockForgetNetSure').hidden = false; btn.textContent = tr('Forget it and unlock'); return; }
        delete btn.dataset.sure;
        forgetNetwork();
    });
    $('lockNotNow').addEventListener('click', () => { if (_ask) { const a = _ask; _ask = null; a.resolve(false); renderCover(); } });
    // The cover holds the keyboard: Tab stays on it (its siblings are hidden),
    // and its keys go no further than the cover (the page's shortcuts must
    // not act on a network still in memory under it, D224).
    $('lockCover').addEventListener('keydown', (e) => { if (_locked) e.stopPropagation(); });
}
let _pinBusy = false;
async function tryPin() {
    if (_pinBusy || !hasPin()) return;
    const f = $('lockPin');
    const pin = f.value;
    if (waitLeftMs() > 0) return;
    if (!PIN_RE.test(pin)) { setMsg(tr('A PIN is 4 to 12 digits.'), 'err'); return; }
    _pinBusy = true;
    $('lockPinBtn').disabled = true;
    setMsg(tr('Checking…'));
    let good = false;
    try { good = canHash() && await pinMatches(pin); } catch (e) { good = false; }
    _pinBusy = false;
    f.value = '';
    $('lockPinBtn').disabled = false;
    if (good) { setMsg(''); unlocked('pin'); return; }
    const n = fails() + 1;
    setFails(n, _hooks.now());
    renderCover();
    if (n < PIN_TRIES) setMsg(tn(PIN_TRIES - n, 'Wrong PIN. {n} try left.', 'Wrong PIN. {n} tries left.'), 'err');
    else setMsg('');
    if (!$('lockPin').disabled && !$('lockPinRow').hidden) f.focus();
}
function tn(n, one, other) { return typeof window.tn === 'function' ? window.tn(n, one, other, { n }) : tr(n === 1 ? one : other, { n }); }
function forgetPin() {
    if (!hasPin() || fails() < FORGET_AT || !noSignInWay()) return;
    removePin();
    writeNote('forgot');
    unlocked('forgot');
}
// Forget the network (D346): the sign-in's server has not answered for
// 72 h. Losing the network on this PC is better than showing it: it stays
// on the server, and only changes not yet sent are lost. Nothing names it.
let _forgetting = false;
async function forgetNetwork() {
    if (_forgetting || !canForgetNetwork()) return;
    _forgetting = true;
    try {
        const m = current() || {}, user = signInUser();
        const ids = new Set();
        if (m.doc) ids.add(String(m.doc));
        const Y = window.TopoServerSync;
        try { if (Y && typeof Y.index === 'function') Object.keys(Y.index()).forEach((id) => ids.add(id)); } catch (e) { /* none */ }
        ids.forEach((id) => {
            try { if (typeof libraryDelete === 'function') libraryDelete(id); } catch (e) { console.warn('Lock: forget', e); }
            try { if (Y && typeof Y.dropRec === 'function') Y.dropRec(id); } catch (e) { /* not a server card */ }
        });
        const S = window.TopoServer;
        try { if (S && typeof S.forgetHere === 'function' && user) await S.forgetHere(user.id); } catch (e) { console.warn('Lock: keys', e); }
        const D = window.CarinoDesktopClient;
        try { if (D && typeof D.dcForget === 'function') await D.dcForget(); } catch (e) { /* not the app */ }
        dropTabNetwork();
        writeNote('forgot-network');
        unlocked('forgot-network');
    } finally { _forgetting = false; }
}
// The network a tab holds in its history entry (one not kept) and its
// drafts: gone, so the boot after the unlock opens on nothing.
function dropTabNetwork() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* none */ }
    try { sessionStorage.removeItem(DRAFTS_KEY); } catch (e) { /* none */ }
}
function writeNote(kind) { ls.set(NOTE_KEY, JSON.stringify({ at: _hooks.now(), kind })); }
const readNote = () => { const n = json(NOTE_KEY); return n && typeof n.at === 'number' ? n : null; };
function noteText(n) {
    if (!n) return '';
    const when = new Date(n.at).toLocaleString(window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined);
    if (n.kind === 'forgot-network') return tr('On {when} the screen was unlocked by forgetting the network that was open, because the Topo server had not answered for 3 days. That network and the server\'s networks were deleted from this PC, and you were signed out here. They are still on the server.', { when });
    return n.kind === 'forgot'
        ? tr('The PIN was forgotten on {when} and the screen unlocked without it. Set a new PIN if you want one.', { when })
        : tr('The screen was unlocked on {when} without signing in, because the Topo server did not answer.', { when });
}
function noteToast() {
    const n = readNote();
    if (n && _hooks.now() - n.at < 60000 && typeof showToast === 'function') setTimeout(() => showToast(noteText(n), 'warn'), 600);
}

// ---- Unlocking by sign-in (D220) ----
function serverErrorDown(e) { return !e || e.offline || e.status === 0 || e.status >= 500; }
async function checkServer() {
    const S = window.TopoServer;
    _server.checked = true;
    if (!S) { markDown(true); renderCover(); return; }
    let h = null;
    try { h = await S.api('GET', '/api/health'); } catch (e) { h = null; }
    markDown(!h || h.server !== 'topo');
    if (_locked) renderCover();
}
async function sendCode() {
    const user = signInUser(), S = window.TopoServer;
    if (!user || !S || _server.busy) return;
    _server.busy = true; renderCover();
    setMsg(tr('Sending a code…'));
    try {
        _server.challenge = await S.requestCode(user.email);
        setMsg(tr('Type the 6-digit code from the email.'));
        renderCover();
        setTimeout(() => { const c = $('lockCode'); if (c) c.focus(); }, 0);
    } catch (e) {
        if (serverErrorDown(e)) { markDown(true); setMsg(''); }
        else setMsg(tr('The code could not be sent. Try again in a minute.'), 'err');
    } finally { _server.busy = false; renderCover(); }
}
async function verifyCode() {
    const user = signInUser(), S = window.TopoServer;
    const f = $('lockCode');
    const code = (f.value || '').replace(/\D/g, '');
    if (!user || !S || !_server.challenge || _server.busy) return;
    if (code.length !== 6) { setMsg(tr('The code has 6 digits.'), 'err'); return; }
    _server.busy = true; renderCover();
    setMsg(tr('Checking…'));
    try {
        const who = await S.verifyCodeOnly(_server.challenge, code, user.email);
        if (!who || String(who.id) !== String(user.id)) { setMsg(tr('This sign-in is not the one that was open.'), 'err'); return; }
        f.value = '';
        setMsg('');
        _server.busy = false;
        unlocked('signin');
    } catch (e) {
        if (serverErrorDown(e)) { markDown(true); setMsg(''); }
        else { f.value = ''; setMsg(tr('That code is not right. Check the newest email and try again.'), 'err'); }
    } finally { _server.busy = false; if (_locked) renderCover(); }
}

// ---- The alarm card's hooks (7g) ----
function showOver(el) {
    const layer = $('lockAlarms');
    if (!layer || !el) return () => {};
    layer.appendChild(el);
    layer.classList.add('on');
    return () => { if (el.parentNode === layer) layer.removeChild(el); if (!layer.children.length) layer.classList.remove('on'); };
}
function requestUnlock(text) {
    if (!_locked) return Promise.resolve(true);
    if (_ask) _ask.resolve(false);
    return new Promise((resolve) => {
        _ask = { text: String(text || tr('Unlock to go on.')), resolve };
        renderCover();
        const f = !$('lockPinRow').hidden ? $('lockPin') : null;
        if (f && !f.disabled) f.focus();
    });
}

// ---- Keys and the clipboard while locked (D224) ----
// Registered in <head>, before any other script's, so a key meant for the
// page under the cover (focus left on <body> by the hiding) never reaches
// it: no Delete, undo or shortcut on the network an in-place lock keeps in
// memory, no copy or paste into it. The cover's and the alarm card's own
// fields keep their keys.
const onCover = (n) => !!(n && n.closest && n.closest('#lockCover, #lockAlarms'));
['keydown', 'keyup', 'keypress', 'copy', 'cut', 'paste'].forEach((ev) => window.addEventListener(ev, (e) => {
    if (!_locked || onCover(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
}, true));

// ---- Settings: Screen lock ----
let _pinForm = false;
function renderIdleLockSettings() {
    const sec = $('setLockSec');
    if (!sec) return;
    const min = lockAfterMin();
    const sel = $('setLockAfter');
    const custom = !CHOICES.includes(min) || sel.dataset.custom === '1';
    sel.value = custom ? 'custom' : String(min);
    $('setLockCustomRow').hidden = !custom;
    const cf = $('setLockCustom');
    if (custom && document.activeElement !== cf) cf.value = String(min || DEFAULT_MIN);
    const pin = hasPin();
    $('setLockPinState').textContent = !canHash()
        ? tr('This browser cannot keep a PIN here (it needs a secure page).')
        : pin ? tr('A PIN is set on this PC.') : tr('No PIN: anyone at this PC can unlock it.');
    $('setLockPinSet').textContent = pin ? tr('Change the PIN…') : tr('Set a PIN…');
    $('setLockPinSet').hidden = _pinForm || !canHash();
    $('setLockPinRemove').hidden = !pin || _pinForm;
    $('setLockPinForm').hidden = !_pinForm;
    const n = readNote();
    $('setLockNoteRow').hidden = !n;
    $('setLockNote').textContent = noteText(n);
}
async function savePinFromForm() {
    const a = $('setLockPin1').value, b = $('setLockPin2').value;
    const msg = $('setLockPinMsg');
    if (!PIN_RE.test(a)) { msg.textContent = tr('A PIN is 4 to 12 digits.'); return; }
    if (a !== b) { msg.textContent = tr('The two PINs are not the same.'); return; }
    msg.textContent = tr('Saving…');
    $('setLockPinSave').disabled = true;
    try { await setPin(a); }
    catch (e) { msg.textContent = tr('The PIN could not be kept in this browser.'); $('setLockPinSave').disabled = false; return; }
    $('setLockPinSave').disabled = false;
    $('setLockPin1').value = ''; $('setLockPin2').value = ''; msg.textContent = '';
    _pinForm = false;
    renderIdleLockSettings();
    if (typeof showToast === 'function') showToast(tr('PIN set. Topo asks for it to unlock.'), 'ok');
}
(function wireSettings() {
    const sec = $('setLockSec');
    if (!sec) { document.addEventListener('DOMContentLoaded', wireSettings, { once: true }); return; }
    $('setLockAfter').addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === 'custom') { e.target.dataset.custom = '1'; $('setLockCustomRow').hidden = false; const cf = $('setLockCustom'); if (!cf.value) cf.value = String(lockAfterMin() || DEFAULT_MIN); setLockAfterMin(cf.value); cf.focus(); return; }
        delete e.target.dataset.custom;
        setLockAfterMin(Number(v));
        renderIdleLockSettings();
    });
    $('setLockCustom').addEventListener('change', (e) => {
        const n = Math.round(Number(e.target.value));
        if (!Number.isFinite(n) || n < 1) { e.target.value = String(lockAfterMin() || DEFAULT_MIN); return; }
        e.target.value = String(Math.min(CUSTOM_MAX, n));
        setLockAfterMin(Math.min(CUSTOM_MAX, n));
    });
    $('setLockPinSet').addEventListener('click', () => { _pinForm = true; renderIdleLockSettings(); $('setLockPin1').focus(); });
    $('setLockPinCancel').addEventListener('click', () => { _pinForm = false; $('setLockPin1').value = ''; $('setLockPin2').value = ''; $('setLockPinMsg').textContent = ''; renderIdleLockSettings(); });
    $('setLockPinSave').addEventListener('click', savePinFromForm);
    $('setLockPin2').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); savePinFromForm(); } });
    $('setLockPinRemove').addEventListener('click', () => { removePin(); renderIdleLockSettings(); if (typeof showToast === 'function') showToast(tr('PIN removed.'), 'ok'); });
    $('setLockNow').addEventListener('click', () => { if (typeof closeSettings === 'function') closeSettings(); lock('now'); });
    $('setLockNoteOk').addEventListener('click', () => { ls.del(NOTE_KEY); renderIdleLockSettings(); });
})();

window.renderIdleLockSettings = renderIdleLockSettings;
window.TopoLock = {
    _hooks,
    gate, lock, isLocked: () => _locked,
    // Locked, being locked, or about to boot locked: nothing may open the
    // server's data yet (js/server.js openServerClient).
    held: () => _locked || _locking || !!marker(),
    onChange: (fn) => { _listeners.add(fn); return () => _listeners.delete(fn); },
    showOver, requestUnlock,
    lockAfterMin, setLockAfterMin, hasPin, setPin, removePin, pinMatches, fails, waitLeftMs,
    forgetPin, readNote, schedule, startWatch,
    // Tests: back to a page that never locked.
    _reset() {
        clearTimeout(_timer); clearInterval(_waitTimer);
        [LOCK_KEY, AFTER_KEY, PIN_KEY, SEEN_KEY, NOTE_KEY, DOWN_KEY].forEach(ls.del);
        try { sessionStorage.removeItem(DRAFTS_KEY); } catch (e) { /* none */ }
        _locked = false; _locking = false; _gated = false; _inPlace = false; _unkept = false; _mem = null; _gateResolve = null; _ask = null;
        _server = { down: false, checked: false, challenge: null, busy: false };
        _hooks.now = realNow; _seen = realNow(); _hooks.downGraceMs = 72 * 3600000;
        const c = $('lockCover'); if (c) c.hidden = true;
        document.documentElement.classList.remove('topo-locked');
    },
    _state: () => ({ locked: _locked, locking: _locking, gated: _gated, inPlace: _inPlace, unkept: _unkept, server: Object.assign({}, _server), watching: _watching }),
    CHOICES, DEFAULT_MIN, PIN_TRIES, FORGET_AT
};
})();
