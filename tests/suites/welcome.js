// @realtime @touch 360x780
// The first-run welcome (js/welcome.js; docs/SCOPE.md D141-D143, D170,
// D326-D335), on the website and in the desktop app (a stub of the app's
// commands, as tests/suites/desktopserver.js and thiscomputer.js do).
// Real clock (the PIN is a PBKDF2 hash, js/idlelock.js). Covered:
//   - not shown for this run's own way in (#advanced), nor for '#setup',
//     '#provider', a share link, '#simple', '?profile=', or a start that is
//     not the landing (a reload of an open network); shown on a plain first
//     start with the landing behind it; a browser that already holds
//     networks counts as done (marked, not shown);
//   - the website's steps: theme, mode, where (this browser, and the note
//     that a Topo server opens at its own address), lock, start; no desktop
//     step; a page a Topo server served skips "where";
//   - every step skippable: skipping all of them leaves today's defaults
//     (full editor, the theme, the lock at 30 min with no PIN, the landing
//     still up) and marks it done; ✕ closes it and marks it too;
//   - Next applies: Colourful through the navbar's switch (kept), Report
//     problems + Imagenology as the mode picker sets it, the lock's time and
//     a PIN (a short or mismatched PIN stays on the step and says why; Skip,
//     Back and Enter wait while it is kept), a theme only looked at and
//     skipped goes back, Back to the theme step keeps a new choice too
//     (storage, the fleet cookie and the switch);
//   - start: Open a file opens the file picker, Map the network now opens
//     Add devices' new network, An empty network starts one;
//   - the desktop app: where offers this PC, Connect to a Topo server and,
//     Make this PC the server wherever the service can run and does not yet
//     (D336); D125's answer goes once ('yes' only through Open Settings with
//     it chosen; skipping, Not now or ✕ is 'no'); an app that already
//     answered is not asked again; a chosen server ends in Settings at
//     its section; an app window already connected skips "where"; the pc step
//     queues Add this computer and Monitor from this PC until a network is
//     open and nothing is on screen, then runs them in turn, given up 30
//     minutes after they were queued;
//   - where the welcome does not run, D125's own prompt still asks once;
//   - Settings, Run the welcome again;
//   - Spanish and Japanese ("PC");
//   - each step at 360 and 390 through tests/fixtures/touchaudit.js, and at
//     1280; no sideways scroll; no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };
  const W = window.TopoWelcome, L = window.TopoLock;
  const TC = window.TopoThisComputer, CK = window.TopoChecks, DS = window.CarinoDesktopServer, DC = window.CarinoDesktopClient;
  const shown = () => W.isOpen() && !el('welcomeDialog').hidden;
  const step = () => { const s = [...document.querySelectorAll('#welcomeDialog .wl-step')].find((x) => !x.hidden); return s ? s.dataset.step : ''; };
  const asked = [];
  setDialogResponder((q) => { asked.push(q); return q.kind === 'confirm' ? false : q.kind === 'choice' ? null : undefined; });
  // A file picker never opens in a test: the click is caught.
  let picked = 0;
  el('importFileInput').addEventListener('click', (e) => { picked++; e.preventDefault(); }, true);
  // A plain first start: the landing up, no mark, nothing in the library.
  const plain = (over = {}) => {
    W._reset();
    Object.assign(W.ARRIVAL, { hash: '', profile: false }, over);
    persistLibrary({});
    if (!landingIsOpen()) openLanding(true);
  };
  const close = async () => { if (W.isOpen()) W.finish('closed'); await settle(); };
  const theme0 = window.CarinoTheme.current();

  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');

    // ---- When it shows ----
    ok('this run came in by #advanced: not shown, no mark', W.ARRIVAL.hash === 'advanced' && !shown() && !W.doneMark());
    for (const [label, over] of [['#setup', { hash: 'setup' }], ['#provider', { hash: 'provider' }], ['a share link', { hash: 'e~abc' }],
      ['#simple', { hash: 'simple' }], ['?profile=', { profile: true }]]) {
      plain(over);
      const r = await W.atBoot();
      ok(`not shown for ${label}`, r === 'skipped' && !shown() && !W.doneMark(), r);
    }
    plain(); closeLanding(); await settle();
    ok('not shown when the start is not the landing (a reload of an open network)', (await W.atBoot()) === 'skipped' && !shown());
    plain();
    persistLibrary({ n1: { id: 'n1', name: 'Clinic', updated: 1, doc: { nodes: [], links: [] } } });
    ok('a browser that already holds networks counts as done', (await W.atBoot()) === 'existing' && !shown() && W.doneMark() && W.doneMark().how === 'existing');
    plain();
    ok('a plain first start shows it, over the landing', (await W.atBoot()) === 'shown' && shown() && landingIsOpen());
    ok('done once: marked as it closes, never before', !W.doneMark());
    await close();
    ok('closed (✕ or Esc) marks it done', W.doneMark() && W.doneMark().how === 'closed' && !shown());
    Object.assign(W.ARRIVAL, { hash: '', profile: false });
    if (!landingIsOpen()) openLanding(true);
    ok('a second plain start does not show it again', (await W.atBoot()) === 'done' && !shown());

    // ---- The website's steps ----
    plain();
    await W.atBoot(); await settle();
    ok('the website: theme, mode, where, lock, start', W.state.steps.join() === 'theme,mode,where,lock,start', W.state.steps.join());
    ok('step 1 of 5, Back hidden, focus inside', step() === 'theme' && /Step 1 of 5/.test(el('wlCount').textContent) && el('wlBack').hidden
      && el('welcomeDialog').contains(document.activeElement));
    for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 780 : 844); await audit('The welcome, theme'); }
    await window.__viewport(1280, 900); await settle();
    W.skip(); W.skip(); await settle();
    ok('where, on the website: this browser and the note on a Topo server', step() === 'where' && el('wlWhereApp').hidden && !el('wlWhereWeb').hidden
      && /opens at its own address/.test(el('wlWhereWeb').textContent));
    for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 780 : 844); await audit('The welcome, where (website)'); }
    await window.__viewport(1280, 900); await settle();
    await close();
    plain(); W.state.served = true;
    await W.atBoot(); await settle();
    ok('a page a Topo server served skips where', W.state.steps.join() === 'theme,mode,lock,start', W.state.steps.join());
    await close();

    // ---- Skipping everything leaves today's defaults ----
    plain();
    state.settings.advanced = true; saveSettings(); applyProfile();
    const before = { adv: state.settings.advanced, prof: state.settings.profile, theme: window.CarinoTheme.current(), lock: L.lockAfterMin(), pin: L.hasPin() };
    await W.atBoot(); await settle();
    // A theme looked at, then the step skipped: it goes back.
    el('wlThemes').querySelector('[data-theme="color"]').click(); await settle();
    ok('choosing a theme shows it at once', window.CarinoTheme.current() === 'color');
    let n = 0;
    while (W.isOpen() && n++ < 10) { el('wlSkip').click(); await settle(); }
    ok('every step skipped: closed and marked done', !shown() && W.doneMark() && W.doneMark().how === 'done');
    ok('skipping everything leaves today\'s defaults', state.settings.advanced === before.adv && state.settings.profile === before.prof
      && window.CarinoTheme.current() === before.theme && L.lockAfterMin() === 30 && L.hasPin() === before.pin && before.lock === 30,
      JSON.stringify([state.settings.advanced, state.settings.profile, window.CarinoTheme.current(), L.lockAfterMin(), L.hasPin()]));
    ok('the landing is still up behind it, nothing opened', landingIsOpen() && picked === 0);

    // ---- Next applies ----
    plain();
    await W.atBoot(); await settle();
    el('wlThemes').querySelector('[data-theme="color"]').click();
    el('wlNext').click();
    ok('Colourful kept as the navbar switch keeps it (storage, the fleet cookie, the switch)', await until(() => window.CarinoTheme.current() === 'color' && localStorage.getItem('carino-theme') === 'color'
      && /(^|; )carino-theme=color(;|$)/.test(document.cookie) && el('ctSwitch').getAttribute('aria-checked') === 'true'));
    await settle();
    // Back to the theme step: a new Next keeps the new choice, a Skip
    // puts back the one kept (D334, D336).
    el('wlBack').click(); await settle();
    el('wlThemes').querySelector('[data-theme="gold"]').click(); await settle();
    el('wlNext').click();
    ok('Back, then Gold and Next: Gold kept, not only shown', await until(() => window.CarinoTheme.current() === 'gold' && localStorage.getItem('carino-theme') === 'gold'
      && /(^|; )carino-theme=gold(;|$)/.test(document.cookie)) && step() === 'mode');
    el('wlBack').click(); await settle();
    el('wlThemes').querySelector('[data-theme="color"]').click(); await settle();
    el('wlSkip').click(); await settle();
    ok('Back, then Colourful looked at and skipped: Gold back on screen and kept', window.CarinoTheme.current() === 'gold' && localStorage.getItem('carino-theme') === 'gold' && step() === 'mode');
    el('wlBack').click(); await settle();
    el('wlThemes').querySelector('[data-theme="color"]').click(); await settle();
    el('wlNext').click();
    ok('and Colourful kept again', await until(() => window.CarinoTheme.current() === 'color' && localStorage.getItem('carino-theme') === 'color'
      && /(^|; )carino-theme=color(;|$)/.test(document.cookie)));
    await settle();
    ok('then the mode step, Back shown', step() === 'mode' && !el('wlBack').hidden);
    el('wlModes').querySelector('[data-mode="simple"]').click(); await settle();
    ok('Report problems asks what is documented (the profiles)', !el('wlPurpose').hidden && el('wlProfiles').querySelectorAll('[data-profile]').length === Object.keys(PROFILES).length);
    for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 780 : 844); await audit('The welcome, mode'); }
    await window.__viewport(1280, 900); await settle();
    el('wlProfiles').querySelector('[data-profile="imagenology"]').click();
    el('wlNext').click(); await settle();
    ok('the profile set as the mode picker sets it', state.settings.profile === 'imagenology' && state.settings.advanced === false && document.body.classList.contains('simple-mode'));
    ok('then where', step() === 'where');
    el('wlNext').click(); await settle();
    ok('then the lock, at 30 min as shipped', step() === 'lock' && el('wlLockAfter').value === '30' && !el('wlPinBox').hidden);
    for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 780 : 844); await audit('The welcome, lock'); }
    await window.__viewport(1280, 900); await settle();
    el('wlLockAfter').value = '15';
    el('wlPin1').value = '12'; el('wlPin2').value = '12';
    el('wlNext').click(); await settle();
    ok('a short PIN stays on the step and says why', step() === 'lock' && /4 to 12 digits/.test(el('wlLockMsg').textContent));
    el('wlPin1').value = '2468'; el('wlPin2').value = '2469';
    el('wlNext').click(); await settle();
    ok('two different PINs stay and say so', step() === 'lock' && /not the same/.test(el('wlLockMsg').textContent) && !L.hasPin());
    el('wlPin2').value = '2468';
    el('wlNext').click();
    // While the PIN is being kept, Skip, Back and Enter wait (D336).
    el('wlSkip').click(); el('wlBack').click();
    el('wlPin2').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok('while the PIN is kept, Skip, Back and Enter wait', step() === 'lock' && shown());
    ok('the time and the PIN kept (the screen lock\'s own)', await until(() => step() === 'start', 400) && L.lockAfterMin() === 15 && L.hasPin() && await L.pinMatches('2468'));
    await settle();
    ok('one step on, not two: the start step still up', shown() && step() === 'start');
    ok('the website has no desktop step, and the start shows its three ways', !W.state.steps.includes('pc') && !el('wlStarts').hidden && el('wlHandoff').hidden
      && el('wlSkip').textContent === 'Not now' && el('wlNext').hidden);
    for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 780 : 844); await audit('The welcome, start'); }
    await window.__viewport(1280, 900); await settle();
    el('wlOpenFile').click(); await settle();
    ok('Open a file: the welcome ends, the file picker opens', !shown() && picked === 1 && W.doneMark().how === 'done');
    // Put this back for what follows.
    L._reset();
    state.settings.advanced = true; saveSettings(); applyProfile();
    if (window.CarinoTheme.current() !== theme0) { el('ctSwitch').click(); await until(() => window.CarinoTheme.current() === theme0); }

    plain(); await W.atBoot(); await settle();
    while (step() !== 'start') { el('wlSkip').click(); await settle(); }
    el('wlMapNow').click(); await settle();
    ok('Map the network now: Add devices for a new network, the landing gone', !shown() && !el('addDevices').hidden && !landingIsOpen() && el('addTitle').textContent === 'What do you have?');
    if (window.CarinoUI && CarinoUI.modal.isOpen(el('addDevices'))) CarinoUI.modal.close(el('addDevices')); else el('addDevices').hidden = true;
    await settle();
    plain(); await W.atBoot(); await settle();
    while (step() !== 'start') { el('wlSkip').click(); await settle(); }
    el('wlEmpty').click(); await settle();
    ok('An empty network: the landing gone, nothing on the map', !shown() && !landingIsOpen() && state.nodes.length === 0);

    // ---- The desktop app ----
    const calls = [];
    const host = { ask: true, connected: '', installed: false };
    const invoke = async (cmd, args) => {
      calls.push({ cmd, args: JSON.parse(JSON.stringify(args || {})) });
      if (cmd === 'server_question') return host.ask;
      if (cmd === 'server_question_done') { host.ask = false; return null; }
      if (cmd === 'server_info') return { available: true, mode: 'app', service: { supported: true, installed: host.installed }, running: false, urls: [], log: [], lanAddresses: [], settings: { enabled: false, port: 7380, lan: false, ownerEmail: '', mail: 'none', smtpPort: 587, smtpSecurity: 'starttls' } };
      if (cmd === 'client_info') return { url: host.connected, pin: '' };
      if (cmd === 'this_computer') return { hostname: 'recepcion-pc', os: 'Fedora Linux 44', platform: 'linux', gateways: [], dns: [],
        interfaces: [{ name: 'enp3s0', label: '', mac: '3C:A9:F4:00:33:01', mtu: 1500, up: true, loopback: false, physical: true, wireless: false, addresses: [{ ip: '192.168.50.33', prefix: 24, temporary: false }] }] };
      return null;
    };
    const desktop = () => { W.state.invoke = invoke; TC.state.invoke = invoke; CK.state.invoke = invoke; DS.state.invoke = invoke; DC.state.invoke = invoke; DC.state.info = { url: host.connected, pin: '' }; };
    const done = () => calls.filter((c) => c.cmd === 'server_question_done').map((c) => c.args.answer).join();

    plain(); desktop();
    await W.atBoot(); await settle();
    ok('the app: theme, mode, where, lock, this PC, start', W.state.steps.join() === 'theme,mode,where,lock,pc,start', W.state.steps.join());
    W.skip(); W.skip(); await settle();
    const srv = el('wlWhereApp').querySelector('[data-where="server"]');
    ok('where in the app: this PC (chosen), connect, and make this PC the server (the app says to ask)',
      step() === 'where' && !el('wlWhereApp').hidden && el('wlWhereWeb').hidden && !srv.hidden
      && el('wlWhereApp').querySelector('[data-where="here"]').getAttribute('aria-pressed') === 'true');
    for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 780 : 844); await audit('The welcome, where (app)'); }
    await window.__viewport(1280, 900); await settle();
    W.skip(); await settle();
    ok('skipping where answers nothing yet', done() === '');
    W.skip(); await settle();
    ok('this PC: Add this computer and Monitor, both unticked', step() === 'pc' && !el('wlAddPc').checked && !el('wlMonitor').checked
      && !el('wlAddPcRow').hidden && !el('wlMonitorRow').hidden);
    for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 780 : 844); await audit('The welcome, this PC'); }
    await window.__viewport(1280, 900); await settle();
    W.skip(); await settle(); el('wlSkip').click(); await settle();
    ok('the server question skipped is answered "not now", once (D170)', done() === 'no' && !shown());

    calls.length = 0; host.ask = false;
    plain(); desktop();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); await settle();
    ok('an app that already answered (0.0.1): Make this PC the server still offered (D336)', !srv.hidden);
    srv.click(); W.next(); await settle(); W.skip(); await settle(); W.skip(); await settle();
    el('wlHandoffGo').click();
    ok('chosen there: Settings at This PC as the server, the question not answered again', await until(() => settingsOpen() && !el('setDsSec').hidden) && done() === '');
    closeSettings(); await settle();
    host.installed = true;
    plain(); desktop();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); await settle();
    ok('a PC already running the service: no Make this PC the server', step() === 'where' && srv.hidden);
    await close();
    ok('and nothing answered for it', done() === '');
    host.installed = false;

    // Make this PC the server chosen, then the welcome ends without Open
    // Settings: "not now", Settings not opened (D170, D336).
    for (const [label, end] of [['Not now', () => el('wlSkip').click()], ['✕', () => W.finish('closed')]]) {
      calls.length = 0; host.ask = true;
      plain(); desktop();
      await W.atBoot(); await settle();
      W.skip(); W.skip(); await settle();
      srv.click(); W.next(); await settle(); W.skip(); await settle(); W.skip(); await settle();
      ok(`server chosen, then ${label} at the hand-over…`, step() === 'start' && !el('wlHandoff').hidden);
      end(); await settle();
      ok(`…answers "not now", Settings not opened (${label})`, !shown() && done() === 'no' && !settingsOpen());
    }

    calls.length = 0; host.ask = true;
    plain(); desktop();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); await settle();
    srv.click(); await settle();
    ok('choosing it marks it', srv.getAttribute('aria-pressed') === 'true');
    W.next(); await settle(); W.skip(); await settle();
    el('wlAddPc').click(); el('wlMonitor').click();
    el('wlNext').click(); await settle();
    ok('a server chosen: the start step hands over to Settings', step() === 'start' && el('wlStarts').hidden && !el('wlHandoff').hidden
      && /This PC as the server/.test(el('wlHandoffText').textContent));
    for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 780 : 844); await audit('The welcome, hand-over'); }
    await window.__viewport(1280, 900); await settle();
    el('wlHandoffGo').click();
    ok('"yes" answered once, Settings open at This PC as the server', await until(() => settingsOpen() && !el('setDsSec').hidden) && done() === 'yes'
      && document.activeElement === el('setDsOwner'));
    const queued = JSON.parse(sessionStorage.getItem(W.NEXT_KEY));
    ok('Add this computer and Monitor wait for an open network, with the time they were queued', JSON.stringify(queued.tasks) === '["pc","monitor"]'
      && typeof queued.at === 'number' && Date.now() - queued.at < 60000);
    ok('not while Settings and the landing are up', !W.runNext() && !W.idle());
    closeSettings(); await settle();
    ok('nor with only the landing up', !W.runNext());
    startNewNetwork(); await settle();
    ok('a network open and nothing on screen: Add this computer opens its review', W.runNext() && await until(() => !el('importDialog').hidden)
      && calls.some((c) => c.cmd === 'this_computer'));
    ok('Monitor waits for the review', !W.runNext());
    if (window.CarinoUI && CarinoUI.modal.isOpen(el('importDialog'))) CarinoUI.modal.close(el('importDialog')); else el('importDialog').hidden = true;
    await settle();
    let monChanged = 0;
    el('setMonOn').addEventListener('change', () => { monChanged++; }, { once: true });
    ok('then Monitor from this PC: Settings at it, its tick asked (the offer, or why not yet)', W.runNext() && settingsOpen() && !el('setMonSec').hidden && monChanged === 1);
    ok('nothing left waiting', !sessionStorage.getItem(W.NEXT_KEY));
    closeSettings(); await settle();
    // The 30 minutes run from the queueing, not from this page's load (D331, D336).
    sessionStorage.setItem(W.NEXT_KEY, JSON.stringify({ at: Date.now() - 31 * 60000, tasks: ['pc'] }));
    const thisComputerCalls = calls.filter((c) => c.cmd === 'this_computer').length;
    ok('a queue older than 30 minutes is given up, even with the page idle', W.idle() && !W.runNext() && !sessionStorage.getItem(W.NEXT_KEY)
      && calls.filter((c) => c.cmd === 'this_computer').length === thisComputerCalls);
    while (asked.length) asked.pop();

    // Connect: Settings at Connect to a Topo server.
    calls.length = 0; host.ask = false;
    plain(); desktop();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); await settle();
    el('wlWhereApp').querySelector('[data-where="connect"]').click();
    W.next(); await settle(); W.skip(); await settle(); W.skip(); await settle();
    ok('Connect chosen: the hand-over names it', /Connect to a Topo server/.test(el('wlHandoffText').textContent));
    el('wlHandoffGo').click(); await settle();
    ok('Settings open at Connect to a Topo server, the address focused', settingsOpen() && !el('setDcSec').hidden && document.activeElement === el('setDcUrl'));
    closeSettings(); await settle();
    // An app window already connected to a server: no where step.
    host.connected = 'https://topo.clinica.lan:7380';
    plain(); desktop();
    await W.atBoot(); await settle();
    ok('an app window already connected skips where', !W.state.steps.includes('where') && W.state.steps.includes('pc'), W.state.steps.join());
    await close();
    host.connected = ''; desktop();

    // Where the welcome does not run, D125's own prompt still asks once.
    calls.length = 0; host.ask = true; asked.length = 0;
    plain(); desktop();
    W.ARRIVAL.hash = 'setup';
    ok('a start the welcome skips…', (await W.atBoot()) === 'skipped');
    ok('…still asks D125\'s question by its own prompt, once', await until(() => asked.some((q) => q.kind === 'confirm' && /server for your network/.test(q.title || '')), 120)
      && await until(() => done() === 'no'));

    // ---- Run the welcome again ----
    W._reset(); W.state.invoke = null; TC.state.invoke = null; CK.state.invoke = null; DS.state.invoke = null; DC.state.invoke = null; DC.state.info = null;
    W.finish('done'); localStorage.setItem(W.WL_KEY, JSON.stringify({ v: 1, at: 1, how: 'done' }));
    openSettings(); await settle();
    ok('Settings has Run the welcome again', !el('setWelcomeSec').hidden && el('setWelcomeAgain').textContent === 'Run the welcome again');
    el('setWelcomeAgain').click();
    ok('it runs again from step 1, Settings closed', await until(() => shown()) && !settingsOpen() && step() === 'theme');
    await close();

    // ---- Languages ----
    for (const [lang, title, count] of [['es', true, 'Paso 1 de'], ['ja', true, 'ステップ 1 /']]) {
      setLocale(lang); applyLocale();
      plain(); await W.atBoot(); await settle();
      const txt = el('welcomeDialog').textContent;
      ok(`${lang}: the welcome is translated`, el('wlCount').textContent.includes(count) && el('wlSkip').textContent !== 'Skip this step'
        && (!title || el('wlTitle').textContent !== 'Welcome to Topo'), el('wlCount').textContent + ' | ' + el('wlTitle').textContent);
      if (lang === 'ja') ok('ja: says PC', /PC/.test(txt) && !/コンピューター/.test(txt));
      await window.__viewport(360, 780); await audit(`The welcome (${lang})`);
      await window.__viewport(1280, 900); await settle();
      await close();
    }
    setLocale('en'); applyLocale();
    ok('no console error', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('suite ran without throwing', false, (e && e.stack) || String(e));
  } finally {
    W._reset();
    L._reset();
    setDialogResponder(null);
    Object.assign(W.ARRIVAL, { hash: 'advanced', profile: false });
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
