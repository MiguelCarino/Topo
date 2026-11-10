// @realtime @touch 360x780
// What a Topo server adds to the page, on a phone (js/serverui.js, docs/SCOPE.md
// step 5a, design §9.5-9.6, amendments A1, A6, A8, E4), against the in-page
// fake server (tests/fixtures/fakeserver.js). Covered:
//   - the landing's "On this server": hidden until the client opens, then
//     "Sign in"; signed in and set up, the card and a site not opened here;
//   - the sign-in sheet: email (type=email, 16px), the code step
//     (inputmode=numeric, one-time-code) that signs in at the sixth digit, a
//     wrong code said in words; the recovery key shown with its tick;
//   - a card's sync line in each state, and the doc bar's chip;
//   - the members sheet: a waiting member with the 24-digit safety code
//     (A1), Give access asks for the compare, then the row is granted; a
//     member whose keys changed is flagged and cannot be given access
//     without checking (A6);
//   - an invitation arriving;
//   - the server's error codes as sentences, never raw (E4);
//   - Spanish rendering of the sheet;
//   - every screen through tests/fixtures/touchaudit.js at 360 and 390:
//     44px targets, 16px fields, nothing past the edge, no sideways scroll;
//   - no console error.
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
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const until = async (cond, n = 100) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const body = () => el('serverSheetBody');
  const sheetShown = () => !el('serverSheet').hidden;
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };
  const both = async (label, open) => {
    for (const w of [360, 390]) { await window.__viewport(w, w === 360 ? 780 : 844); await settle(); if (open) await open(); await audit(label); }
  };
  const typeInto = async (input, text) => { input.focus(); input.value = ''; await window.__type(text); await settle(); };
  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    await loadScript('tests/fixtures/fakeserver.js');
    const T = TopoServer, Y = TopoServerSync, C = TopoServerCrypto, U = TopoServerUI;
    ok('the section is hidden before the client opens', el('landingServer').hidden);
    const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    function NoStream() { this.addEventListener = () => {}; this.close = () => {}; this.readyState = 1; }
    T._reset(); Y._reset();
    Object.assign(T._hooks, { force: true, fetch: fake.fetch, EventSource: NoStream, BroadcastChannel: null, locks: null });
    Object.assign(Y._hooks, { quietMs: 30, maxMs: 200, busyMs: 200 });
    await openServerClient();
    openLanding(false);
    await settle();
    ok('signed out: the section asks to sign in', !el('landingServer').hidden && /Sign in/.test(el('serverStatus').textContent) && el('serverAccountBtn').textContent === 'Sign in');
    await both('the landing, signed out');

    // ---- Sign in through the sheet ----
    el('serverAccountBtn').click();
    await settle();
    ok('the sign-in sheet opens', sheetShown() && el('serverSheetTitle').textContent === 'Sign in to Topo');
    const email = body().querySelector('input[type=email]');
    ok('an email field', !!email && email.getAttribute('autocomplete') === 'email' && parseFloat(getComputedStyle(email).fontSize) >= 16);
    await both('the sign-in sheet, email');
    await typeInto(body().querySelector('input[type=email]'), 'owner@example.test');
    body().querySelector('button.primary').click();
    ok('the code step', await until(() => !!body().querySelector('input[inputmode=numeric]')));
    const code = body().querySelector('input[inputmode=numeric]');
    ok('the code field', code.getAttribute('autocomplete') === 'one-time-code' && code.getAttribute('maxlength') === '6');
    ok('"Send a new code" waits 30 s', [...body().querySelectorAll('button')].some((b) => /Send a new code/.test(b.textContent) && b.disabled));
    await both('the sign-in sheet, code');
    await typeInto(body().querySelector('input[inputmode=numeric]'), '999999');
    ok('a wrong code is said in words', await until(() => /not right/.test((body().querySelector('.srv-err') || {}).textContent || '')));
    await typeInto(body().querySelector('input[inputmode=numeric]'), '123456');
    ok('six digits sign in, then the recovery key', await until(() => !!el('serverRecoveryCode')));
    const cont = [...body().querySelectorAll('button')].find((b) => b.textContent === 'Continue');
    ok('the server owner cannot skip it, and Continue waits for the tick', !!cont && cont.disabled && ![...body().querySelectorAll('button')].some((b) => b.textContent === 'Skip'));
    await both('the recovery key');
    // Print: the code must have a box under the print rules. The print
    // media rules are applied here as screen rules (CSSOM) while print()
    // runs, since a page cannot switch itself to print media.
    {
        const shown = el('serverRecoveryCode').textContent;
        let seen = null;
        const realPrint = window.print;
        const appSheet = [...document.styleSheets].find((sh) => /css\/app\.css/.test(sh.href || ''));
        window.print = () => {
            const added = [];
            const media = [...appSheet.cssRules].filter((r) => r instanceof CSSMediaRule && /print/.test(r.conditionText || r.media.mediaText) && /srvPrint|srv-printing/.test(r.cssText));
            media.forEach((m) => [...m.cssRules].forEach((r) => { added.push(appSheet.insertRule(r.cssText, appSheet.cssRules.length)); }));
            const blk = document.getElementById('srvPrint');
            const codeEl = blk && blk.querySelector('.srv-print-code');
            const box = codeEl ? codeEl.getBoundingClientRect() : { width: 0, height: 0 };
            const ws = document.querySelector('.ws');
            seen = { parentIsBody: !!blk && blk.parentElement === document.body, text: codeEl ? codeEl.textContent : '', w: box.width, h: box.height,
                wsHidden: !ws || getComputedStyle(ws).display === 'none', rules: media.length };
            for (let i = appSheet.cssRules.length - 1; i >= 0 && added.length; i--) { appSheet.deleteRule(i); added.pop(); }
            window.dispatchEvent(new Event('afterprint'));
        };
        try { [...body().querySelectorAll('button')].find((b) => b.textContent === 'Print').click(); } finally { window.print = realPrint; }
        ok('Print: the recovery key prints (a block of its own under <body>, with a box)', !!seen && seen.rules >= 1 && seen.parentIsBody && seen.text === shown && seen.w > 0 && seen.h > 0 && seen.wsHidden, JSON.stringify(seen));
        ok('and is taken away after printing', !document.getElementById('srvPrint') && !document.body.classList.contains('srv-printing'));
    }
    body().querySelector('input[type=checkbox]').click();
    await settle();
    [...body().querySelectorAll('button')].find((b) => b.textContent === 'Continue').click();
    ok('ready', await until(() => T.state.status === 'ready'));
    ok('the sheet closed', !sheetShown());
    await settle();
    ok('the account chip shows the email', /owner@example.test/.test(el('serverAccountBtn').textContent));

    // ---- A card on the server ----
    replaceDocument(templatesData.house, { origin: 'default' });
    const id = claimDocument('Office', null);
    U.setServerResponder((q) => (q.kind === 'show-name' ? false : null));
    await U.putOnServer(id);
    U.setServerResponder(null);
    const siteId = Y.rec(id).siteId;
    openLanding(false); await settle();
    const card = el('serverCards').querySelector(`.landing-card[data-id="${id}"]`);
    ok('the card is in "On this server", not "Your networks"', !!card && !el('landingCards').querySelector(`[data-id="${id}"]`));
    ok('its line says Synced', !!card && /Synced/.test(card.querySelector('.landing-card-sync').textContent));
    ok('it has Members', !!card && [...card.querySelectorAll('.landing-tool')].some((b) => b.title === 'Members'));
    await both('the landing with a server card');
    // The states as the card says them.
    const r = Y.rec(id);
    const say = (st, extra) => { Object.assign(r, { state: st }, extra || {}); Y.putRec(r); return serverCardText(id).text; };
    ok('Needs merge', /Needs merge: tap to review/.test(say('needs-merge')));
    ok('history mismatch', /older or different history/.test(say('history-mismatch')));
    ok('removed', /removed from this site/.test(say('removed')));
    ok('an error in words', /Not saved to the server\. This network is too large/.test(say('error', { err: 'too-large' })), say('error', { err: 'too-large' }));
    say('synced', { err: null });
    // The doc bar chip.
    await openFromLibrary(id); await settle();
    ok('the doc bar chip says Synced', /Synced/.test((el('docBarSync') || {}).textContent || ''));
    say('needs-merge'); renderDocBar();
    ok('…and Merge when it needs one', /Merge/.test(el('docBarSync').textContent));
    say('synced'); renderDocBar();

    // ---- Members: a waiting member, the safety code ----
    const B = await fake.remote('prov@example.test');
    B.join(siteId, 'provider');
    await T.refreshMe();
    U.openMembers(siteId);
    ok('the members sheet opens', await until(() => sheetShown() && /prov@example.test/.test(body().textContent)));
    const bCode = await C.safetyCode(B.encPub, B.sigPub);
    ok('the newcomer\'s 24-digit safety code shows', body().textContent.includes(bCode) && /Accepted: give access/.test(body().textContent));
    await both('the members sheet');
    let asked = null;
    setDialogResponder((q) => { asked = q; return 'checked'; });
    [...body().querySelectorAll('button')].find((b) => b.textContent === 'Give access').click();
    ok('Give access asks for the code compare', await until(() => !!asked) && asked.message.includes(bCode) && asked.choices.some((c) => c.id === 'unchecked'));
    ok('then the member is granted', await until(() => fake.site(siteId).members.get(B.user.id).status === 'granted'));
    ok('…and pinned as checked', (await T.personKeys(B.user.id, B.encPub, B.sigPub)).checked === true);
    // Keys changed (A6): flagged, and no "without checking".
    const B2 = await fake.remote('prov@example.test');   // the same person, new keys
    fake.site(siteId).members.get(B.user.id).status = 'waiting';
    asked = null;
    U.openMembers(siteId);
    ok('a member whose keys changed is flagged', await until(() => /Their keys changed/.test(body().textContent)));
    [...body().querySelectorAll('button')].find((b) => b.textContent === 'Give access').click();
    ok('…and cannot be given access without checking', await until(() => !!asked) && !asked.choices.some((c) => c.id === 'unchecked') && /do not give access/.test(asked.message));
    setDialogResponder(null);
    U.closeSheet();
    void B2;

    // ---- An invitation arriving ----
    await Y.invite(siteId, 'guest@example.test', 'viewer', 'en');
    const tok = fake.mails.filter((m) => m.kind === 'invite').pop().token;
    U.inviteArrived(tok);
    ok('the invitation sheet', await until(() => /invited you to a network/.test(body().textContent) && /Viewer/.test(body().textContent)));
    ok('signed in as someone else, it says so', /This invitation is for guest@example.test/.test(body().textContent));
    await both('the invitation sheet');
    U.closeSheet();

    // ---- The account ----
    U.openAccount();
    ok('the account sheet', await until(() => sheetShown() && /Language for emails/.test(body().textContent) && !/Loading…/.test(body().textContent)));
    ok('six notification choices', body().querySelectorAll('fieldset input[type=checkbox]').length === 6);
    await both('the account sheet');
    U.closeSheet();

    // ---- Errors in words (E4) ----
    ok('a server code is a sentence', U.errText({ code: 'wrong-email' }).startsWith('This invitation is for another email'));
    ok('an unknown code gets the generic sentence', U.errText({ code: 'zzz' }) === 'Something went wrong on the server. Try again.');
    ok('rate-limited says how long', U.errText({ code: 'rate-limited', data: { retryAfter: 300 } }) === 'Too many tries. Wait 5 min.');

    // ---- Spanish ----
    setLocale('es'); applyLocale('es');
    U.openSignIn();
    await settle();
    ok('the sheet in Spanish', el('serverSheetTitle').textContent === 'Iniciar sesión en Topo' && /correo/.test(body().textContent));
    ok('errors in Spanish', U.errText({ code: 'bad-code' }).startsWith('Ese código'));
    await both('the sign-in sheet in Spanish');
    U.closeSheet();
    setLocale('en'); applyLocale('en');

    ok('no console error', !errors.length, errors.slice(0, 4).join(' | '));
    ok('no CSP violation', (window.__cspViolations || []).length === 0, (window.__cspViolations || []).join(' | '));
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
