// @realtime @touch 360x780
// The idle lock (js/idlelock.js; docs/SCOPE.md D134, D165, D169, D213-D222).
// Web Crypto (the PIN's PBKDF2) needs the real clock, so this runs through
// Playwright. The page is never really reloaded here (that would end the
// suite): TopoLock._hooks.reload records the call, and the reload itself,
// the network gone from a locked page and back after the unlock, is
// tests/idlelock-e2e.mjs. Covered:
//   - the setting: 30 min as shipped, Off, the choices, a custom time, kept
//     in this browser's storage and never in the document;
//   - it locks on time, saving first (the card, the tab's entry, the
//     drafts of Report a problem and Record visit), and not before; Off
//     never locks; use in another tab keeps it open; Lock now;
//   - a locked boot (gate) covers the page and reads nothing until unlocked;
//   - the PIN: kept as a PBKDF2 hash, the right one unlocks, wrong ones
//     counted; the fifth with a sign-in leaves only the sign-in, which
//     unlocks with the emailed code (fake server) and closes the session
//     from before the lock; with no sign-in, the waits and Forget the PIN,
//     which is then said in Settings; no PIN and no sign-in, a plain Unlock;
//     a sign-in whose server does not answer is still a sign-in: the PIN
//     with its waits, and Forget or the plain Unlock only after 24 h of
//     silence (D223);
//   - an in-place lock (the network not kept, the lock refused by the
//     browser, writes parked for another entry): no reload, and no key,
//     undo or paste reaches the network under the cover (D224);
//   - a locked window does not open the server client (D225);
//   - another tab locking or unlocking this browser;
//   - the drafts (Report a problem, Record visit) kept at the lock and
//     reopened after the unlock;
//   - the alarm card's hooks: an element shown over the cover, and an
//     unlock asked for (Not now, then the PIN);
//   - Spanish on the cover; the cover and Settings on a phone at 360 and
//     390 in Gold and Colourful (44px targets, 16px fields, no sideways
//     scroll); no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(40); };
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const shown = (id) => { const e = el(id); if (!e) return false; let n = e; while (n && n !== document) { if (n.hidden) return false; n = n.parentNode; } return getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0; };
  const L = window.TopoLock;
  const reloads = [];
  const setTheme = (th) => document.documentElement.setAttribute('data-carino-theme', th);
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };
  const phones = async (label) => {
    for (const th of ['gold', 'color']) {
      setTheme(th);
      for (const w of [360, 390]) { await window.__viewport(w, w === 360 ? 780 : 844); await audit(`${label} (${th})`); }
    }
    setTheme('gold');
  };
  const fresh = () => {
    L._reset();
    L._hooks.reload = () => reloads.push(Date.now());
    L._hooks.iterations = 1000;
    L._hooks.saveWaitMs = 1500;
  };
  const typeIn = async (input, text) => { input.focus(); input.value = ''; await window.__type(text); await settle(); };
  const LOCK = 'topo-lock';
  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    await loadScript('tests/fixtures/fakeserver.js');
    ok('TopoLock is there and this page is not locked', !!L && !L.isLocked() && !document.documentElement.classList.contains('topo-locked'));
    ok('the boot went through the gate and watches for idle time', L._state().watching);
    ok('the cover is a child of <body>, so the rule that hides the rest leaves it', el('lockCover').parentElement === document.body && el('lockAlarms').parentElement === document.body);
    fresh();

    // ---- The setting ----
    ok('30 min as shipped', L.lockAfterMin() === 30 && localStorage.getItem('topo-lock-after') === null);
    openSettings('lock'); await settle();
    ok('Settings has Screen lock, showing 30 min', shown('setLockSec') && el('setLockAfter').value === '30');
    ok('the choices are Off, 5, 15, 30, 60 min and Custom', [...el('setLockAfter').options].map((o) => o.value).join(',') === '0,5,15,30,60,custom');
    ok('it says it is not encryption at rest', /not encryption/.test(el('setLockSec').textContent));
    ok('no PIN is said plainly', /No PIN: anyone at this PC can unlock it/.test(el('setLockPinState').textContent));
    el('setLockAfter').value = '0'; el('setLockAfter').dispatchEvent(new Event('change', { bubbles: true }));
    ok('Off is kept as 0', L.lockAfterMin() === 0 && localStorage.getItem('topo-lock-after') === '0');
    el('setLockAfter').value = 'custom'; el('setLockAfter').dispatchEvent(new Event('change', { bubbles: true })); await settle();
    ok('Custom shows the minutes', shown('setLockCustomRow'));
    el('setLockCustom').value = '45'; el('setLockCustom').dispatchEvent(new Event('change', { bubbles: true }));
    ok('a custom time is kept', L.lockAfterMin() === 45);
    el('setLockCustom').value = '99999'; el('setLockCustom').dispatchEvent(new Event('change', { bubbles: true }));
    ok('a custom time is at most 1440 min', L.lockAfterMin() === 1440);
    el('setLockAfter').value = '30'; el('setLockAfter').dispatchEvent(new Event('change', { bubbles: true })); await settle();
    ok('back to 30 min, the key goes (the default)', L.lockAfterMin() === 30 && localStorage.getItem('topo-lock-after') === null && el('setLockCustomRow').hidden);
    // Set a PIN in Settings.
    el('setLockPinSet').click(); await settle();
    ok('Set a PIN… opens the two fields', shown('setLockPin1') && shown('setLockPin2'));
    el('setLockPin1').value = '12'; el('setLockPin2').value = '12'; el('setLockPinSave').click(); await settle();
    ok('a PIN of 2 digits is refused', /4 to 12 digits/.test(el('setLockPinMsg').textContent) && !L.hasPin());
    el('setLockPin1').value = '2468'; el('setLockPin2').value = '2469'; el('setLockPinSave').click(); await settle();
    ok('two different PINs are refused', /not the same/.test(el('setLockPinMsg').textContent) && !L.hasPin());
    el('setLockPin1').value = '2468'; el('setLockPin2').value = '2468'; el('setLockPinSave').click();
    ok('the PIN is saved', await until(() => L.hasPin()));
    const rec = JSON.parse(localStorage.getItem('topo-lock-pin'));
    ok('kept as a PBKDF2 hash with its salt, never the PIN', rec.v === 1 && rec.iter === 1000 && rec.salt.length >= 20 && rec.hash.length >= 40 && !JSON.stringify(rec).includes('2468'));
    ok('the hash checks the PIN', await L.pinMatches('2468') && !(await L.pinMatches('2469')));
    await settle();
    ok('Settings says a PIN is set, and offers Change and Remove', /A PIN is set on this PC/.test(el('setLockPinState').textContent) && /Change the PIN/.test(el('setLockPinSet').textContent) && shown('setLockPinRemove'));
    await phones('Settings, Screen lock');
    await window.__viewport(360, 780);
    ok('nothing of the lock is in the document', !/topo-lock|lockAfter|"pin"/i.test(JSON.stringify(serializeDoc())));
    closeSettings();

    // ---- It locks on time, saving first ----
    replaceDocument(templatesData.house, { origin: 'default' });
    const cardId = claimDocument('Lock test', null);
    ok('a kept network to lock over', !!cardId && state.nodes.length > 0);
    // An edit not yet written (the autosave waits), and a problem being written.
    const n0 = state.nodes[0];
    n0.name = 'Edited-before-lock'; save();
    TopoIncidents.openProblemDialog(); await settle();
    el('problemText').value = 'The printer by the door';
    let base = Date.now();
    L._hooks.now = () => base;
    L.startWatch();
    base += 29 * 60000; L.schedule(); await settle();
    ok('not locked after 29 min', !L.isLocked() && reloads.length === 0);
    base += 2 * 60000; L.schedule();
    ok('locked after 30 min', await until(() => reloads.length === 1));
    const m = JSON.parse(localStorage.getItem(LOCK));
    ok('the lock is kept in this browser, as idle', !!m && m.why === 'idle' && m.user === null);
    ok('the card took the edit first', JSON.stringify(libraryEntry(cardId).doc).includes('Edited-before-lock'));
    const h = window.history.state;
    ok('so did the tab\'s entry', !!h && typeof h.topoDoc === 'string' && h.topoDoc.includes('Edited-before-lock') && h.lib === cardId);
    const drafts = JSON.parse(sessionStorage.getItem('topo-lock-drafts'));
    ok('the Report a problem draft is kept in the tab', !!drafts && drafts.doc === cardId && drafts.problem && drafts.problem.text === 'The printer by the door');
    ok('the cover is up and the rest is not drawn', shown('lockCover') && getComputedStyle(document.querySelector('.ws') || document.body.firstElementChild).visibility === 'hidden');
    TopoIncidents.closeProblemDialog();

    // ---- Off never locks; another tab's use keeps it open ----
    fresh();
    base = Date.now(); L._hooks.now = () => base;
    L.setLockAfterMin(0);
    base += 5 * 3600000; L.schedule(); await settle();
    ok('Off: not locked after 5 hours', !L.isLocked() && reloads.length === 1);
    L.setLockAfterMin(5);
    base += 4 * 60000;
    localStorage.setItem('topo-lock-seen', String(base));   // another tab, used just now
    base += 3 * 60000; L.schedule(); await settle();
    ok('use in another tab 3 min ago keeps it open at 5 min', !L.isLocked() && reloads.length === 1);
    base += 3 * 60000; L.schedule();
    ok('and it locks once that is 5 min old too', await until(() => reloads.length === 2));
    fresh();

    // ---- Lock now, and the person signed in ----
    const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    const owner = fake.user('owner@example.test');
    function NoStream() { this.addEventListener = () => {}; this.close = () => {}; this.readyState = 1; }
    Object.assign(TopoServer._hooks, { force: true, fetch: fake.fetch, EventSource: NoStream, BroadcastChannel: null, locks: null });
    TopoServer.state.me = { id: owner.id, email: owner.email };
    openSettings('lock'); await settle();
    el('setLockNow').click();
    ok('Lock now locks at once', await until(() => reloads.length === 3));
    const m2 = JSON.parse(localStorage.getItem(LOCK));
    ok('it names who was signed in, to unlock by sign-in', m2.why === 'now' && m2.user && m2.user.id === owner.id && m2.user.email === owner.email);
    ok('Settings closed under it', !settingsOpen());
    TopoServer.state.me = null;
    fresh();

    // ---- The network cannot be put where a reload finds it: covered in place ----
    replaceDocument(templatesData.house, { origin: 'default' });
    const realReplace = window.history.replaceState;
    window.history.replaceState = function () { throw new Error('refused'); };   // the tab's entry refusing the write
    state.nodes[0].name = 'Held-in-place'; save();
    state.selection.clear();
    const before = reloads.length;
    await L.lock('now'); await settle();
    ok('no reload: covered in place, and it says so', reloads.length === before && L.isLocked() && L._state().inPlace && shown('lockInPlace') && /could not be saved/.test(el('lockInPlace').textContent) && /^Locked at /.test(el('lockWhen').textContent));
    // Keys under the cover: from <body> (where the hiding leaves focus) and
    // from a cover button. None reaches the network still in memory.
    const snap = JSON.stringify(serializeDoc());
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    for (const k of ['Control+a', 'Delete', 'Backspace', 'Control+z', 'Control+y', 'Control+Shift+z']) await window.__key(k);
    el('lockPlainBtn').focus();
    for (const k of ['Control+a', 'Delete', 'Control+z']) await window.__key(k);
    await settle();
    ok('keys under an in-place lock leave the network as it was (no select-all, no undo)', JSON.stringify(serializeDoc()) === snap && state.selection.size === 0 && state.nodes[0].name === 'Held-in-place' && L.isLocked());
    let pasted = false;
    const onPaste = () => { pasted = true; };
    document.addEventListener('paste', onPaste);
    document.body.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
    document.removeEventListener('paste', onPaste);
    ok('and a paste does not reach the page', !pasted);
    window.history.replaceState = realReplace;
    flushLiveDoc();
    el('lockPlainBtn').click(); await settle();
    ok('unlocked, the network is still on screen', !L.isLocked() && state.nodes.some((n) => n.name === 'Held-in-place'));
    // The same keys, unlocked, do act: so the check above means something.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await window.__key('Control+a'); await settle();
    const selAll = state.selection.size;
    await window.__key('Control+z'); await settle();
    ok('unlocked, the same keys act again (select-all, undo)', selAll > 0 && state.nodes[0].name !== 'Held-in-place', selAll + ' ' + state.nodes[0].name);
    fresh();

    // ---- The browser refuses to keep the lock: covered in place (D224) ----
    replaceDocument(templatesData.house, { origin: 'default' });
    flushLiveDoc();
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === LOCK) throw new Error('QuotaExceededError'); return realSet.call(this, k, v); };
    const b2 = reloads.length;
    try { await L.lock('now'); } finally { Storage.prototype.setItem = realSet; }
    await settle();
    ok('the lock refused: no reload (it would boot unlocked), covered in place, and it says why', reloads.length === b2 && L.isLocked() && L._state().unkept && !localStorage.getItem(LOCK) && shown('lockInPlace') && /would not keep the lock/.test(el('lockInPlace').textContent));
    window.dispatchEvent(new StorageEvent('storage', { key: LOCK, oldValue: null, newValue: null }));
    ok('another tab\'s storage news does not end a lock held only here', L.isLocked());
    el('lockPlainBtn').click(); await settle();
    ok('it unlocks as any lock does', !L.isLocked() && !L._state().unkept);
    fresh();

    // ---- Writes parked for another history entry: no reload (they would be lost) ----
    replaceDocument(templatesData.house, { origin: 'default' });
    flushLiveDoc();
    _liveParked.set('eid-left-by-back', { json: '{}', meta: {} });
    const b3 = reloads.length;
    await L.lock('now'); await settle();
    ok('a parked write keeps the page: covered in place', reloads.length === b3 && L.isLocked() && L._state().inPlace);
    _liveParked.delete('eid-left-by-back');
    el('lockPlainBtn').click(); await settle();
    fresh();

    // ---- A locked boot: no PIN, no sign-in ----
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: null }));
    let through = false;
    const g1 = L.gate().then(() => { through = true; });
    await settle();
    ok('the gate holds while locked', !through && L.isLocked() && L._state().gated);
    ok('the cover: title and time', shown('lockCover') && el('lockTitle').textContent === 'Topo is locked' && /^Locked at /.test(el('lockWhen').textContent));
    ok('no PIN and no sign-in: a plain Unlock and its advice', shown('lockPlainBtn') && /Set a PIN in Settings/.test(el('lockPlainNote').textContent) && !shown('lockPinRow') && !shown('lockSignIn'));
    await phones('the cover, plain Unlock');
    el('lockPlainBtn').click(); await g1;
    ok('Unlock lets the boot go on and the lock goes', through && !L.isLocked() && !localStorage.getItem(LOCK) && !shown('lockCover'));
    fresh();

    // ---- The PIN, no sign-in: wrong ones, the wait, the right one ----
    await L.setPin('135790');
    base = Date.now(); L._hooks.now = () => base;
    localStorage.setItem(LOCK, JSON.stringify({ at: base, why: 'idle', user: null }));
    through = false;
    let g2 = L.gate().then(() => { through = true; });
    await settle();
    ok('with a PIN: the PIN field, no plain Unlock', shown('lockPin') && !shown('lockPlain'));
    ok('the PIN field: numeric, 16px, nothing remembered', el('lockPin').type === 'password' && el('lockPin').getAttribute('inputmode') === 'numeric' && parseFloat(getComputedStyle(el('lockPin')).fontSize) >= 16 && el('lockPin').getAttribute('autocomplete') === 'off');
    await phones('the cover, PIN');
    const tryPin = async (pin) => { el('lockPin').value = pin; el('lockPinBtn').click(); await until(() => !/Checking/.test(el('lockMsg').textContent)); await settle(); };
    await tryPin('111111');
    ok('a wrong PIN: 9 tries left (D343)', /Wrong PIN\. 9 tries left/.test(el('lockMsg').textContent) && L.fails() === 1 && !through);
    await tryPin('12');
    ok('too short is said, not counted', /4 to 12 digits/.test(el('lockMsg').textContent) && L.fails() === 1);
    await tryPin('111112'); await tryPin('111113'); await tryPin('111114');
    ok('four wrong: 6 left, no Forget yet', /6 tries left/.test(el('lockMsg').textContent) && !shown('lockForgetBtn'));
    await tryPin('111115');
    ok('the fifth wrong PIN, no sign-in: Forget the PIN is offered, 5 left, no wait (D343)',
        L.fails() === 5 && shown('lockForgetBtn') && /5 tries left/.test(el('lockMsg').textContent) && !el('lockPin').disabled && !/Try again/.test(el('lockState').textContent));
    for (const p of ['111106', '111107', '111108', '111109']) await tryPin(p);
    ok('one try left, said in the singular', /1 try left/.test(el('lockMsg').textContent) && L.fails() === 9 && shown('lockForgetBtn'));
    await tryPin('111110');
    ok('the tenth wrong PIN, no sign-in: a wait of 30 s, Forget still offered', L.fails() === 10 && /Try again in 30 s/.test(el('lockState').textContent) && el('lockPin').disabled && shown('lockForgetBtn'));
    await phones('the cover, the wait');
    el('lockPin').disabled = false; await tryPin('135790');
    ok('during the wait even the right PIN is not tried', !through && L.isLocked());
    base += 31000; L.schedule();
    // Re-render on the timer's tick.
    ok('after 30 s it may be tried again', await until(() => !el('lockPinBtn').disabled && !el('lockPin').disabled, 80));
    await tryPin('111116');
    ok('the eleventh wrong one waits 60 s (doubling)', L.fails() === 11 && /Try again in 60 s/.test(el('lockState').textContent), L.fails() + ' ' + el('lockState').textContent + ' / ' + el('lockMsg').textContent);
    // Fifteen minutes at most.
    const pinRec = JSON.parse(localStorage.getItem('topo-lock-pin')); pinRec.fails = 20; pinRec.lastFail = base; localStorage.setItem('topo-lock-pin', JSON.stringify(pinRec));
    ok('the wait is at most 15 min', Math.round(L.waitLeftMs() / 1000) === 900, String(L.waitLeftMs()));
    pinRec.fails = 11; pinRec.lastFail = base - 61000; localStorage.setItem('topo-lock-pin', JSON.stringify(pinRec));
    window.dispatchEvent(new StorageEvent('storage', { key: 'topo-lock-pin' }));
    ok('(the wait is over)', await until(() => !el('lockPin').disabled, 80));
    await tryPin('135790');
    await g2;
    ok('the right PIN unlocks, and the count starts again', through && !L.isLocked() && L.fails() === 0 && !localStorage.getItem(LOCK));

    // ---- Forget the PIN ----
    localStorage.setItem(LOCK, JSON.stringify({ at: base, why: 'idle', user: null }));
    through = false;
    g2 = L.gate().then(() => { through = true; });
    await settle();
    for (const p of ['900001', '900002', '900003', '900004', '900005']) await tryPin(p);
    ok('five wrong again: Forget offered', shown('lockForgetBtn') && !shown('lockForgetSure'));
    el('lockForgetBtn').click(); await settle();
    ok('the first tap says what it does, and the button asks again', shown('lockForgetSure') && /never encrypted/.test(el('lockForgetSure').textContent) && el('lockForgetBtn').textContent === 'Forget the PIN and unlock' && !through);
    el('lockForgetBtn').click(); await g2;
    ok('the second unlocks and removes the PIN', through && !L.isLocked() && !L.hasPin());
    const note = L.readNote();
    ok('it is noted in this browser', !!note && note.kind === 'forgot');
    openSettings(); await settle();
    ok('Settings says the PIN was forgotten', shown('setLockNoteRow') && /PIN was forgotten/.test(el('setLockNote').textContent));
    el('setLockNoteOk').click(); await settle();
    ok('OK clears the note', !L.readNote() && el('setLockNoteRow').hidden);
    closeSettings();
    fresh();

    // ---- With a sign-in: the fifth wrong PIN leaves only the sign-in ----
    // Signed in at the server before the lock: that session is closed once
    // the unlock's own sign-in has made a new one (D226).
    const ch0 = await TopoServer.api('POST', '/api/auth/request', { email: owner.email });
    await TopoServer.api('POST', '/api/auth/verify', { challenge: ch0.challenge, code: fake.code });
    const oldSid = fake.state.session;
    const mails0 = fake.mails.length;
    await L.setPin('2468');
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: { id: owner.id, email: owner.email } }));
    through = false;
    let g3 = L.gate().then(() => { through = true; });
    ok('the server is asked whether it answers', await until(() => L._state().server.checked && fake.calls.some((c) => c.path === '/api/health')));
    await settle();
    const calls0 = fake.calls.length;
    TopoServer.state.opening = null;
    ok('locked: the server client does not open (D225)', L.held() && (await TopoServer.openServerClient()) === false && fake.calls.length === calls0);
    ok('a PIN and a sign-in: both offered, the email masked', shown('lockPin') && shown('lockSendCode') && /o\*\*\*r@example\.test/.test(el('lockSignInLead').textContent));
    for (const p of ['1111', '1112', '1113', '1114', '1115']) await tryPin(p);
    ok('5 wrong with a sign-in: the PIN still open, 5 left, no Forget', shown('lockPinRow') && /5 tries left/.test(el('lockMsg').textContent) && !shown('lockForget'));
    for (const p of ['1116', '1117', '1118', '1119', '1120']) await tryPin(p);
    ok('after 10 wrong PINs only the sign-in: no PIN field, no wait, no Forget', !shown('lockPinRow') && /only signing in/.test(el('lockState').textContent) && !shown('lockForget') && shown('lockSendCode'));
    await phones('the cover, sign-in only');
    el('lockSendCode').click();
    ok('Send a code: the code field', await until(() => shown('lockCode')));
    ok('a code was asked for this person', fake.mails.slice(mails0).some((x) => x.kind === 'signin' && x.to === owner.email));
    ok('the code field takes a phone\'s one-time code', el('lockCode').getAttribute('autocomplete') === 'one-time-code' && el('lockCode').getAttribute('inputmode') === 'numeric');
    await typeIn(el('lockCode'), '999999');
    ok('a wrong code is said in words', await until(() => /not right/.test(el('lockMsg').textContent)) && !through);
    await typeIn(el('lockCode'), '123456');
    await until(() => through);
    ok('the right code unlocks', through && !L.isLocked());
    ok('and the count of wrong PINs starts again', L.fails() === 0 && L.hasPin());
    ok('the unlock signed nothing else in (no keys or sites read)', !fake.calls.some((c) => /\/api\/sites|\/api\/me\/keys/.test(c.path)));
    ok('the session from before the lock is closed, the new one open', !!oldSid && !fake.state.sessions.has(oldSid) && !!fake.state.session && fake.state.session !== oldSid
        && [...fake.state.sessions.values()].filter((x) => x.user === owner.id).length === 1);

    // ---- With a sign-in, but the server does not answer ----
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: { id: owner.id, email: owner.email } }));
    fake.offline = true;
    L._hooks.now = () => Date.now();
    through = false;
    g3 = L.gate().then(() => { through = true; });
    ok('a server that does not answer is said', await until(() => L._state().server.down && /does not answer/.test(el('lockSignInLead').textContent)));
    ok('its first silence is kept', !!JSON.parse(localStorage.getItem('topo-lock-down') || 'null'));
    for (const p of ['1111', '1112', '1113', '1114', '1115', '1116', '1117', '1118', '1119', '1120']) await tryPin(p);
    ok('10 wrong PINs, the server silent: still a sign-in, so the PIN with its waits and no Forget (D223)',
        /Try again in 30 s/.test(el('lockState').textContent) && !shown('lockForget') && shown('lockRetry') && /If it still does not answer on/.test(el('lockSignInLead').textContent),
        el('lockState').textContent + ' / ' + el('lockSignInLead').textContent);
    // Cutting the network never opens Forget the PIN (D346); after 72 h only Forget the network.
    localStorage.setItem('topo-lock-down', JSON.stringify({ since: Date.now() - 25 * 3600000 }));
    el('lockRetry').click();
    await until(() => L._state().server.checked); await settle(); await new Promise((r) => setTimeout(r, 200));
    ok('silent for 25 h: still the PIN, no Forget of any kind (D346)', L._state().server.down && shown('lockPinRow') && !shown('lockForget') && !shown('lockForgetNet'));
    localStorage.setItem('topo-lock-down', JSON.stringify({ since: Date.now() - 73 * 3600000 }));
    el('lockRetry').click();
    ok('silent for 72 h: Forget the network is offered, never Forget the PIN', await until(() => L._state().server.down && shown('lockForgetNetBtn')) && !shown('lockForget') && shown('lockPinRow'));
    fake.offline = false;
    el('lockRetry').click();
    ok('Try the server again: the sign-in comes back, Forget the network goes, the silence forgotten', await until(() => !L._state().server.down && shown('lockSendCode') && !shown('lockForgetNet') && !localStorage.getItem('topo-lock-down')));
    // Unlock by sign-in to go on.
    el('lockSendCode').click(); await until(() => shown('lockCode'));
    await typeIn(el('lockCode'), '123456'); await until(() => through);
    ok('(unlocked by the sign-in)', through);
    fresh();

    // ---- No PIN, a sign-in: the sign-in; the server down: plain Unlock, noted ----
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: { id: owner.id, email: owner.email } }));
    through = false;
    g3 = L.gate().then(() => { through = true; });
    await until(() => L._state().server.checked); await settle();
    ok('no PIN with a sign-in: the sign-in, no plain Unlock', shown('lockSendCode') && !shown('lockPlain'));
    fake.offline = true; L._reset(); L._hooks.reload = () => reloads.push(Date.now()); L._hooks.iterations = 1000;
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: { id: owner.id, email: owner.email } }));
    through = false;
    g3 = L.gate().then(() => { through = true; });
    ok('no PIN, the server silent: no plain Unlock, and it says when the network can be forgotten', await until(() => L._state().server.down && /forgetting the network that was open/.test(el('lockSignInLead').textContent)) && !shown('lockPlainBtn'));
    localStorage.setItem('topo-lock-down', JSON.stringify({ since: Date.now() - 25 * 3600000 }));
    el('lockRetry').click();
    await until(() => L._state().server.checked); await settle(); await new Promise((r) => setTimeout(r, 200));
    ok('silent for 25 h: still no plain Unlock (D346)', !shown('lockPlainBtn') && !shown('lockForgetNet'));
    fake.offline = true; L._reset(); L._hooks.reload = () => reloads.push(Date.now()); L._hooks.iterations = 1000;
    // The network open when it locked, a server card, and this person's keys here.
    replaceDocument(templatesData.house, { origin: 'default' });
    const openCard = claimDocument('Forget-me network', null);
    const otherCard = claimDocument('Server site copy', null);
    TopoServerSync.putRec({ cardId: otherCard, siteId: 'site-forget', origin: location.origin });
    const C = window.TopoServerCrypto, keyId = (TopoServer._hooks.origin || location.origin) + '|' + owner.id;
    await C.ksPut('keys', keyId, { userId: owner.id, devPriv: 'x' });
    history.replaceState({ topoTest: 'unkept network' }, '');
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: { id: owner.id, email: owner.email }, doc: openCard }));
    localStorage.setItem('topo-lock-down', JSON.stringify({ since: Date.now() - 73 * 3600000 }));
    through = false;
    g3 = L.gate().then(() => { through = true; });
    ok('silent for 72 h, no PIN: only Forget the network, which does not name it', await until(() => L._state().server.down && shown('lockForgetNetBtn')) && !shown('lockPlainBtn')
        && !/Forget-me/.test(el('lockCover').textContent));
    await phones('the cover, forget the network');
    el('lockForgetNetBtn').click(); await settle();
    ok('the first tap says what it deletes, and asks again', shown('lockForgetNetSure') && /stay on the server/.test(el('lockForgetNetSure').textContent) && el('lockForgetNetBtn').textContent === 'Forget it and unlock' && !through);
    el('lockForgetNetBtn').click(); await g3;
    ok('the second unlocks', through && !L.isLocked());
    ok('the open network and the server\'s card are deleted from this browser', !libraryEntry(openCard) && !libraryEntry(otherCard) && !TopoServerSync.rec(otherCard));
    ok('this person\'s keys here are gone and the page is signed out', !(await C.ksGet('keys', keyId)) && !TopoServer.me());
    ok('the tab\'s unkept network is gone', history.state === null);
    ok('the note says it, and still names no network', L.readNote() && L.readNote().kind === 'forgot-network');
    openSettings(); await settle();
    ok('Settings says the network was forgotten', /forgetting the network that was open/.test(el('setLockNote').textContent) && !/Forget-me/.test(el('setLockNote').textContent));
    el('setLockNoteOk').click(); await settle();
    closeSettings();
    fake.offline = false;
    TopoServer._hooks.force = false; TopoServer._hooks.fetch = null; TopoServer._hooks.EventSource = null;
    fresh();

    // ---- Another tab ----
    L.startWatch();
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: LOCK, newValue: localStorage.getItem(LOCK) }));
    ok('another tab locking locks this one (saving first)', await until(() => reloads.length === 4) && L.isLocked());
    fresh();
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: null }));
    await L.setPin('4321');
    through = false;
    const g4 = L.gate().then(() => { through = true; });
    await settle();
    localStorage.removeItem(LOCK);
    window.dispatchEvent(new StorageEvent('storage', { key: LOCK, oldValue: '{}', newValue: null }));
    await g4;
    ok('another tab unlocking unlocks this one', through && !L.isLocked());
    fresh();

    // ---- The drafts come back after the unlock ----
    replaceDocument(templatesData.house, { origin: 'default' });
    const card2 = claimDocument('Drafts', null);
    TopoIncidents.openProblemDialog(); await settle();
    el('problemText').value = 'No Wi-Fi in room 4';
    const sym = document.querySelector('#problemSymptoms input[type=radio]'); if (sym) sym.click();
    await settle();
    const symptom = TopoIncidents.draft.symptom;
    await L.setPin('8642');
    await L.lock('now');
    ok('locked with the draft kept', reloads.length === 5 && /No Wi-Fi in room 4/.test(sessionStorage.getItem('topo-lock-drafts')));
    // As the page that comes back: the dialog is gone, the gate waits.
    TopoIncidents.closeProblemDialog(); await settle();
    L._reset(); L._hooks.reload = () => reloads.push(Date.now()); L._hooks.iterations = 1000;
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'now', user: null }));
    sessionStorage.setItem('topo-lock-drafts', JSON.stringify({ doc: card2, problem: { text: 'No Wi-Fi in room 4', symptom, nodeIds: [], sendTo: [] } }));
    await L.setPin('8642');
    through = false;
    const g5 = L.gate().then(() => { through = true; });
    await settle();
    await tryPin('8642'); await g5;
    window.dispatchEvent(new Event('topo:ready'));
    ok('after the unlock, Report a problem reopens with its draft', await until(() => !el('problemDialog').hidden && el('problemText').value === 'No Wi-Fi in room 4') && TopoIncidents.draft.symptom === symptom);
    ok('and the draft is not kept any longer', !sessionStorage.getItem('topo-lock-drafts'));
    TopoIncidents.closeProblemDialog();
    // Record visit: the same, through the lock.
    L._hooks.reload = () => reloads.push(Date.now()); L._hooks.iterations = 1000; L._hooks.saveWaitMs = 1500;
    TopoProviderMode.openVisitDialog(null); await settle();
    el('visitNotes').value = 'Replaced the patch cord';
    await L.lock('now');
    const vkept = sessionStorage.getItem('topo-lock-drafts');
    ok('locked with the Record visit draft kept', reloads.length === 6 && /Replaced the patch cord/.test(vkept || '') && JSON.parse(vkept).doc === card2, String(reloads.length));
    TopoProviderMode.closeVisitDialog(); await settle();
    L._reset(); L._hooks.reload = () => reloads.push(Date.now()); L._hooks.iterations = 1000;
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'now', user: null }));
    sessionStorage.setItem('topo-lock-drafts', vkept);
    await L.setPin('8642');
    through = false;
    const g5b = L.gate().then(() => { through = true; });
    await settle();
    await tryPin('8642'); await g5b;
    window.dispatchEvent(new Event('topo:ready'));
    ok('after the unlock, Record visit reopens with its draft', await until(() => !el('visitDialog').hidden && el('visitNotes').value === 'Replaced the patch cord'));
    ok('and that draft is not kept any longer', !sessionStorage.getItem('topo-lock-drafts'));
    TopoProviderMode.closeVisitDialog();
    fresh();

    // ---- The alarm card's hooks (7g) ----
    await L.setPin('5555');
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: null }));
    through = false;
    const g6 = L.gate().then(() => { through = true; });
    await settle();
    const card = document.createElement('div');
    card.style.cssText = 'position:fixed;left:20px;top:200px;width:200px;height:120px;background:#b45309;color:#fff';
    card.textContent = 'NOT ANSWERING · R1';
    const off = L.showOver(card); await settle();
    const r = card.getBoundingClientRect();
    ok('a card shown while locked is above the cover', document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === card && getComputedStyle(card).visibility === 'visible');
    off(); await settle();
    ok('and goes when taken away', !card.isConnected && !el('lockAlarms').classList.contains('on'));
    let answer = null;
    L.requestUnlock('Unlock to acknowledge R1.').then((v) => { answer = v; });
    await settle();
    ok('an unlock asked for says why, with Not now', shown('lockAsk') && el('lockAsk').textContent === 'Unlock to acknowledge R1.' && shown('lockNotNow'));
    el('lockNotNow').click();
    ok('Not now answers no and stays locked', await until(() => answer === false) && L.isLocked() && !shown('lockAsk'));
    answer = null;
    L.requestUnlock('Unlock to acknowledge R1.').then((v) => { answer = v; });
    await settle();
    await tryPin('5555');
    ok('the PIN answers yes', await until(() => answer === true) && !L.isLocked());
    await g6;
    let free = null;
    await L.requestUnlock('x').then((v) => { free = v; });
    ok('not locked: an unlock asked for is yes at once', free === true);
    fresh();

    // ---- Spanish ----
    setLocale('es'); applyLocale();
    localStorage.setItem(LOCK, JSON.stringify({ at: Date.now(), why: 'idle', user: null }));
    through = false;
    const g7 = L.gate().then(() => { through = true; });
    await settle();
    ok('the cover in Spanish', el('lockTitle').textContent === 'Topo está bloqueado' && /^Bloqueado a las /.test(el('lockWhen').textContent) && el('lockPlainBtn').textContent === 'Desbloquear', el('lockTitle').textContent);
    await phones('the cover in Spanish');
    el('lockPlainBtn').click(); await g7;
    setLocale('en'); applyLocale();
    fresh();
    await window.__viewport(360, 780);
    ok('no console error', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('the suite ran to the end', false, (e && e.stack ? e.stack : String(e)).slice(0, 300));
  }
  L._reset();
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
