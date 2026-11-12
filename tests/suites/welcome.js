// @realtime @touch 360x780
// Setup, the first-run welcome (js/welcome.js; docs/SCOPE.md D141-D143,
// D170, D326-D336, D352-D357), on the website and in the desktop app (a stub
// of the app's commands, as tests/suites/desktopserver.js, desktopclient.js
// and thiscomputer.js do; the server's requests go to the in-page fake
// server, tests/fixtures/fakeserver.js).
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
//     (D336); D125's answer goes once ('yes' once Setup set the service up;
//     skipping, Not now or ✕ is 'no'); an app that already answered is not
//     asked again; an app window already connected skips "where"; the pc
//     step queues Add this computer and Monitor from this PC until a network
//     is open and nothing is on screen, then runs them in turn, given up 30
//     minutes after they were queued;
//   - the server, step by step (D353-D355). Connect: the address (no
//     address and nobody there said on the step, Back, retry), a
//     self-signed certificate compared (Back cancels, nothing pinned),
//     pinned by dcTrust, the reload, Setup resumed at the sign-in (Back shows
//     the server connected to), no email said, the code asked through the
//     app, a wrong code said, the right one signs in with keys, then the
//     lock, the end with Finish; Setup's word older than 30 minutes given up.
//     Make this PC the server: the owner's email and who opens it, other PCs'
//     email server fields, the service's own refusals in Settings' words,
//     set up through Settings' own form (dsSetUpWith), D125's 'yes', the wait
//     (no Next), a server that does not start said with Try again (Settings'
//     Start), this window connected to it (dcConnectOwn), the reload, the
//     owner's email filled in, the code fetched from this PC's server by the
//     app with its key (D358; an older code it hands back first is not
//     taken; a server set up without the key said on the step), signed in
//     as the owner; Back from the wait to the owner step and Set it up
//     again uses Settings' Save, not a second service. Closed (Esc) while
//     the administrator prompt is up: Setup waits for it, says so, then
//     closes with D125's 'yes' (D359); closed while comparing a
//     certificate: nothing pinned, no comparison left for Settings.
//     Skip on a server step ends the walk with nothing set up;
//   - where the welcome does not run, D125's own prompt still asks once;
//   - Settings, Run the setup again (the section named Setup, D356);
//   - Spanish and Japanese ("PC"); every Setup string in es, pt-BR, ru, ja;
//   - each step at 360 and 390 through tests/fixtures/touchaudit.js (the
//     server steps in Gold and Colourful), and at 1280; no sideways scroll;
//     no console error.
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
    srv.click(); W.next(); await settle();
    ok('chosen there: Setup goes on to the owner\'s email, not to Settings (D353)', step() === 'srvOwner' && !settingsOpen()
      && /Step 4 of 10/.test(el('wlCount').textContent), el('wlCount').textContent);
    W.skip(); await settle();
    ok('Skip on a server step ends the walk: the lock next, nothing set up', step() === 'lock' && !calls.some((c) => c.cmd === 'server_service_install')
      && !W.state.steps.some((s) => /^srv/.test(s)));
    await close();
    ok('…and the question is not answered again', done() === '');
    host.installed = true;
    plain(); desktop();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); await settle();
    ok('a PC already running the service: no Make this PC the server', step() === 'where' && srv.hidden);
    await close();
    ok('and nothing answered for it', done() === '');
    host.installed = false;

    // Make this PC the server chosen, its steps skipped, then Setup ends:
    // "not now", nothing set up, Settings not opened (D170, D353).
    for (const [label, end] of [['Not now', () => el('wlSkip').click()], ['✕', () => W.finish('closed')]]) {
      calls.length = 0; host.ask = true;
      plain(); desktop();
      await W.atBoot(); await settle();
      W.skip(); W.skip(); await settle();
      srv.click(); W.next(); await settle(); W.skip(); await settle(); W.skip(); await settle(); W.skip(); await settle();
      ok(`server chosen and skipped, then ${label} at the start…`, step() === 'start' && !el('wlStarts').hidden && el('wlHandoff').hidden);
      end(); await settle();
      ok(`…answers "not now", Settings not opened (${label})`, !shown() && done() === 'no' && !settingsOpen() && !calls.some((c) => c.cmd === 'server_service_install'));
    }

    // This PC's two ticks wait for an open network (D331).
    calls.length = 0; host.ask = false;
    plain(); desktop();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); W.next(); await settle(); W.skip(); await settle();
    el('wlAddPc').click(); el('wlMonitor').click();
    el('wlNext').click(); await settle();
    ok('on this PC only: the start step shows its three ways', step() === 'start' && !el('wlStarts').hidden && el('wlHandoff').hidden);
    el('wlSkip').click(); await settle();
    const queued = JSON.parse(sessionStorage.getItem(W.NEXT_KEY));
    ok('Add this computer and Monitor wait for an open network, with the time they were queued', JSON.stringify(queued.tasks) === '["pc","monitor"]'
      && typeof queued.at === 'number' && Date.now() - queued.at < 60000);
    openSettings(); await settle();
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
    ok('then Monitor from this PC: Settings at it, its tick asked (the offer, or why not yet)', W.runNext() && settingsOpen() && !el('setMonSec').hidden && monChanged === 1
      && el('setTab-monitor').getAttribute('aria-selected') === 'true' && !el('setPanel-monitor').hidden && el('setMonSec').getClientRects().length > 0,
      document.querySelector('#settingsDialog .set-tab[aria-selected="true"]')?.dataset.tab);
    ok('nothing left waiting', !sessionStorage.getItem(W.NEXT_KEY));
    closeSettings(); await settle();
    // The 30 minutes run from the queueing, not from this page's load (D331, D336).
    sessionStorage.setItem(W.NEXT_KEY, JSON.stringify({ at: Date.now() - 31 * 60000, tasks: ['pc'] }));
    const thisComputerCalls = calls.filter((c) => c.cmd === 'this_computer').length;
    ok('a queue older than 30 minutes is given up, even with the page idle', W.idle() && !W.runNext() && !sessionStorage.getItem(W.NEXT_KEY)
      && calls.filter((c) => c.cmd === 'this_computer').length === thisComputerCalls);
    while (asked.length) asked.pop();
    if (!landingIsOpen()) openLanding(true);

    // ---- The server, step by step (D353-D355) ----
    // The app's commands as clientcmd.rs and server.rs answer them; every
    // request goes to an in-page fake Topo server (tests/fixtures/fakeserver.js),
    // as tests/suites/desktopclient.js and desktopserver.js stub them.
    await loadScript('tests/fixtures/fakeserver.js');
    const T = window.TopoServer, Y = window.TopoServerSync, UI = window.TopoServerUI;
    const FP = 'A6:08:2D:50:E7:2C:E3:6B:3E:2B:0F:A0:BF:6A:CF:18:EE:68:34:75:AA:29:1A:20:C4:CD:32:3B:30:CF:7B:6C';
    const LAN = 'https://192.168.1.20:7380', OWN = 'http://127.0.0.1:7380';
    const fakeOrg = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    const fakeOwn = FakeTopoServer({ ownerEmail: 'it@clinica.test' });
    fakeOwn.code = '482915';
    const net = { url: '', pin: '', reloads: 0 };
    // The code box of this PC's own server (D358): the newest code, handed
    // to the app after deliverAfter asks (the mail worker's moment); stale:
    // an older code handed back first; noKey: set up before the app's key.
    const box = { code: null, stale: null, polls: 0, deliverAfter: 2, noKey: false };
    const svc = { installed: false, running: false, startable: true, polls: 0, runAfter: 2, installDelay: 0, log: ['level=INFO msg="topo-server started"'],
      settings: { enabled: false, port: 7380, lan: false, ownerEmail: '', mail: 'none', smtpPort: 587, smtpSecurity: 'starttls', shareAddress: '' } };
    const svcInfo = () => ({ available: true, mode: svc.installed ? 'service' : 'app', service: { supported: true, installed: svc.installed }, running: svc.running, error: '',
      urls: svc.running ? [svc.settings.lan ? LAN : OWN] : [], log: svc.log.slice(), lanAddresses: ['192.168.1.20'], settings: JSON.parse(JSON.stringify(svc.settings)),
      fingerprint: svc.running && svc.settings.lan ? FP : '', hasSmtpPass: false });
    const checkSettings = (st) => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(st.ownerEmail || '')) throw 'owner-email';
      if (st.lan && st.mail === 'none') throw 'lan-needs-email';
      if (st.mail === 'smtp' && (!st.smtpHost || !st.smtpFrom || !st.smtpPort)) throw 'smtp';
    };
    const norm = (u) => { const s = String(u || '').trim(); if (!s) return null; const w = s.includes('://') ? s : 'https://' + s; try { return new URL(w).origin; } catch (e) { return null; } };
    const invoke2 = async (cmd, args) => {
      calls.push({ cmd, args: cmd === 'client_events' ? { path: args.path } : JSON.parse(JSON.stringify(args || {})) });
      await wait(2);
      if (cmd === 'server_question') return host.ask;
      if (cmd === 'server_question_done') { host.ask = false; return null; }
      if (cmd === 'server_info') {
        if (svc.installed && !svc.running && svc.startable && ++svc.polls >= svc.runAfter) svc.running = true;
        return svcInfo();
      }
      if (cmd === 'server_service_install') { if (svc.installDelay) await wait(svc.installDelay); checkSettings(args.settings); svc.installed = true; svc.settings = Object.assign({}, args.settings); svc.polls = 0; return svcInfo(); }
      if (cmd === 'server_save') { checkSettings(args.settings); svc.settings = Object.assign({}, args.settings); return svcInfo(); }
      if (cmd === 'server_start') { svc.startable = true; svc.polls = 0; return svcInfo(); }
      if (cmd === 'server_signin_code') {
        if (!svc.installed || svc.settings.lan || svc.settings.mail !== 'none') throw 'not-local';
        if (box.noKey) throw 'no-code-key';
        if (args.email !== svc.settings.ownerEmail) return null;
        if (box.stale) { const c = box.stale; box.stale = null; return c; }
        if (box.code && ++box.polls >= box.deliverAfter) { const c = box.code; box.code = null; return c; }
        return null;
      }
      if (cmd === 'client_info') return { url: net.url, pin: net.pin };
      if (cmd === 'client_probe' || cmd === 'client_connect') {
        const url = norm(args.url);
        if (!url) throw 'address';
        if (/nobody/.test(url)) { if (cmd === 'client_probe') return { url, error: 'offline', fingerprint: '' }; throw 'offline'; }
        const fp = /192\.168/.test(url) ? FP : '';
        const pinned = (args.pin || '') === fp;
        if (cmd === 'client_probe') return { url, error: fp && !pinned ? 'untrusted' : '', fingerprint: fp };
        if (fp && !pinned) throw 'untrusted:' + fp;
        net.url = url; net.pin = args.pin || '';
        return { url: net.url, pin: net.pin };
      }
      if (cmd === 'client_disconnect') { net.url = ''; net.pin = ''; return { url: '', pin: '' }; }
      if (cmd === 'client_request') {
        if (!net.url) throw 'not-connected';
        const fake = net.url === OWN ? fakeOwn : fakeOrg;
        let r;
        try { r = await fake.fetch(args.path, { method: args.method, body: args.body || undefined, headers: { 'X-Topo': '1' } }); } catch (e) { throw 'offline'; }
        // This PC's own server with no email: the code waits in its box for
        // the app (D358), never in its log.
        if (fake === fakeOwn && args.path === '/api/auth/request' && r.status === 202) { box.code = { code: fakeOwn.code, at: Date.now() }; box.polls = 0; }
        return { status: r.status, contentType: 'application/json', body: await r.text(), b64: false };
      }
      if (cmd === 'client_events') return 1;
      if (cmd === 'client_events_close') return null;
      if (cmd === 'this_computer') return null;
      return null;
    };
    class StubChannel { constructor() { this.onmessage = null; } }
    const app2 = () => {
      W.state.invoke = invoke2; DS.state.invoke = invoke2; TC.state.invoke = invoke2; CK.state.invoke = invoke2;
      Object.assign(DC.state, { invoke: invoke2, Channel: StubChannel, reload: () => { net.reloads++; } });
      W.state.waitMs = 20;
    };
    UI.setServerResponder((q) => (q.kind === 'recovery' ? 'ok' : q.kind === 'show-name' ? false : null));
    // What a reload does: the page goes, the boot reads the mirror and asks
    // the app (js/desktopclient.js), opens the server client, then Setup's
    // atBoot. The landing is what a plain start shows.
    const reload = async () => {
      W._unload();
      T._reset(); Y._reset(); DC.detach();
      Object.assign(DC.state, { info: null, changed: '', changedKind: '', told: false, probe: null, note: '' });
      Object.assign(W.ARRIVAL, { hash: '', profile: false });
      if (!landingIsOpen()) openLanding(true);
      await DC.boot();
      await openServerClient();
      await settle();
      const r = await W.atBoot();
      await settle();
      return r;
    };
    const msg = () => el('wlSrvMsg').textContent;
    const shots = async (label) => {
      for (const theme of ['gold', 'color']) {
        document.documentElement.setAttribute('data-carino-theme', theme);
        for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 780 : 844); await audit(`Setup, ${label} (${theme})`); }
      }
      document.documentElement.setAttribute('data-carino-theme', theme0);
      await window.__viewport(1280, 900); await settle();
      ok(`Setup, ${label} @1280: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
    };

    // -- Connect to a Topo server --
    calls.length = 0; host.ask = true;
    plain(); app2();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); await settle();
    el('wlWhereApp').querySelector('[data-where="connect"]').click(); await settle();
    ok('Connect chosen: its steps join the count (address, sign-in, code)', /Step 3 of 9/.test(el('wlCount').textContent), el('wlCount').textContent);
    el('wlNext').click(); await settle();
    ok('Next: the address step, Connect as its button, nothing asked of the app yet', step() === 'srvAddr' && el('wlNext').textContent === 'Connect'
      && !el('wlSrvLater').hidden && !calls.some((c) => c.cmd === 'client_probe') && document.activeElement === el('wlSrvUrl'));
    await shots('the address');
    el('wlNext').click();
    ok('no address: said on the step, as Settings says it', await until(() => /not a server address/.test(msg())) && el('wlSrvMsg').classList.contains('wl-err')
      && el('wlSrvMsg').getAttribute('role') === 'alert' && step() === 'srvAddr');
    el('wlSrvUrl').value = 'nobody.example';
    el('wlNext').click();
    ok('nobody there: said, and the step stays to try again', await until(() => /No Topo server answered/.test(msg())) && step() === 'srvAddr' && !sessionStorage.getItem(W.RESUME_KEY));
    el('wlBack').click(); await settle();
    ok('Back from the address: the where step, the error gone', step() === 'where' && msg() === '');
    el('wlNext').click(); await settle();
    el('wlSrvUrl').value = '192.168.1.20:7380';
    el('wlNext').click();
    ok('a server that signs its own certificate: compare it (dcConnect\'s probe)', await until(() => step() === 'srvCompare') && el('wlSrvFp').textContent === FP
      && el('wlSrvFpUrl').textContent === LAN && el('wlNext').textContent === 'They are the same: connect' && /Step 5 of 10/.test(el('wlCount').textContent)
      && document.activeElement === el('wlNext'));
    await shots('compare the certificate');
    el('wlBack').click(); await settle();
    ok('Back: the address again, nothing pinned (dcCancel)', step() === 'srvAddr' && !DC.state.probe && !calls.some((c) => c.cmd === 'client_connect'));
    el('wlNext').click();
    await until(() => step() === 'srvCompare');
    el('wlNext').click();
    ok('they are the same: connected with that fingerprint pinned (dcTrust), the window reloads', await until(() => net.reloads === 1)
      && JSON.stringify(calls.find((c) => c.cmd === 'client_connect').args) === JSON.stringify({ url: LAN, pin: FP }) && localStorage.getItem(DC.MIRROR_KEY) === JSON.stringify({ url: LAN }));
    const left = JSON.parse(sessionStorage.getItem(W.RESUME_KEY) || 'null');
    ok('Setup left word to go on at the sign-in after the reload', left && left.step === 'srvEmail' && left.where === 'connect' && left.serverAsk === true && !W.doneMark());

    ok('after the reload Setup goes on by itself (D355)', (await reload()) === 'resumed' && shown() && step() === 'srvEmail', step());
    ok('…the sign-in step: the email, no setup code (the server has its owner), Send me a code', el('wlNext').textContent === 'Send me a code'
      && el('wlSrvTokenRow').hidden && /A code to sign in will be sent there/.test(el('wlSrvEmailText').textContent) && T.state.status === 'signed-out');
    await shots('sign in');
    el('wlBack').click(); await settle();
    ok('Back from the sign-in: where, showing the server this window is connected to', step() === 'where' && !el('wlWhereOn').hidden && el('wlWhereApp').hidden
      && el('wlWhereOnUrl').textContent === LAN);
    el('wlNext').click(); await settle();
    el('wlNext').click();
    ok('no email: said on the step', await until(() => /Type your email address/.test(msg()) && el('wlSrvMsg').classList.contains('wl-err')) && step() === 'srvEmail');
    el('wlSrvEmail').value = 'owner@example.test';
    el('wlNext').click();
    ok('a code asked for (requestCode, through the app): the code step', await until(() => step() === 'srvCode') && el('wlNext').textContent === 'Sign in'
      && el('wlSrvCodeLbl').textContent === 'Code from the email' && /owner@example\.test/.test(el('wlSrvCodeText').textContent)
      && calls.some((c) => c.cmd === 'client_request' && c.args.path === '/api/auth/request'));
    await shots('the code');
    el('wlSrvCode').value = '111111';
    el('wlNext').click();
    ok('a wrong code: the server\'s words, the step stays', await until(() => msg() !== '' && msg() !== 'Signing in…') && step() === 'srvCode' && el('wlSrvMsg').classList.contains('wl-err'), msg());
    el('wlSrvCode').value = '123456';
    el('wlNext').click();
    ok('the right code: signed in with keys (verifyCode), then the lock step', await until(() => step() === 'lock', 300) && T.state.status === 'ready'
      && T.me().email === 'owner@example.test' && !sessionStorage.getItem(W.RESUME_KEY), T.state.status);
    W.skip(); await settle(); W.skip(); await settle();
    ok('the end: what was done, and Finish (the start page is the server\'s)', step() === 'start' && el('wlStarts').hidden && !el('wlHandoff').hidden
      && /connected to https:\/\/192\.168\.1\.20:7380 and signed in as owner@example\.test/.test(el('wlHandoffText').textContent)
      && el('wlHandoffGo').textContent === 'Finish' && el('wlSkip').hidden && el('wlStartHead').textContent === 'All set');
    await shots('all set');
    el('wlHandoffGo').click(); await settle();
    ok('Finish: Setup done, D125 answered "not now" (nothing set up on this PC)', !shown() && W.doneMark() && W.doneMark().how === 'done'
      && calls.filter((c) => c.cmd === 'server_question_done').map((c) => c.args.answer).join() === 'no');

    // A reload with Setup's word older than 30 minutes: not resumed.
    sessionStorage.setItem(W.RESUME_KEY, JSON.stringify({ at: Date.now() - 31 * 60000, step: 'srvEmail', where: 'connect' }));
    host.ask = false;
    ok('Setup\'s word older than 30 minutes is given up', (await reload()) === 'done' && !shown() && !sessionStorage.getItem(W.RESUME_KEY));
    await wait(1700);   // D125's own prompt had its turn (nothing to ask)
    // Back to a window that is not a client.
    await T.signOut().catch(() => {});
    net.url = ''; net.pin = ''; localStorage.removeItem(DC.MIRROR_KEY);
    T._reset(); Y._reset(); DC.detach(); DC.state.info = { url: '', pin: '' };

    // -- Make this PC the server --
    calls.length = 0; host.ask = true;
    plain(); app2();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); await settle();
    srv.click(); el('wlNext').click(); await settle();
    ok('Make this PC the server: the owner\'s email and who opens it, Set it up', step() === 'srvOwner' && el('wlNext').textContent === 'Set it up'
      && el('wlSrvWho').value === 'pc' && el('wlSrvSmtp').hidden && !el('wlSrvPcNote').hidden && /Step 4 of 10/.test(el('wlCount').textContent), el('wlCount').textContent);
    await shots('make this PC the server');
    el('wlSrvWho').value = 'lan'; el('wlSrvWho').dispatchEvent(new Event('change'));
    await settle();
    ok('other PCs too: the email server\'s fields', !el('wlSrvSmtp').hidden && el('wlSrvPcNote').hidden && el('wlSrvSmtpPort').value === '587');
    await shots('other PCs, the email server');
    el('wlSrvOwner').value = 'it@clinica.test';
    el('wlNext').click();
    ok('no email server for other PCs: the service\'s own refusal, in Settings\' words', await until(() => /Fill in the SMTP server/.test(msg())) && step() === 'srvOwner' && !svc.installed);
    el('wlSrvWho').value = 'pc'; el('wlSrvWho').dispatchEvent(new Event('change'));
    el('wlSrvOwner').value = '';
    el('wlNext').click();
    ok('no owner\'s email: said, nothing set up', await until(() => /Type the owner's email/.test(msg())) && !svc.installed && done() === '');
    el('wlSrvOwner').value = 'it@clinica.test';
    svc.startable = false;
    W.state.waitFor = 1500;
    el('wlNext').click();
    const inst = await until(() => svc.installed);
    const ic = calls.filter((c) => c.cmd === 'server_service_install').pop();
    ok('Set it up: Settings\' own "Run it in the background from startup", with what Setup asked', inst && ic.args.settings.ownerEmail === 'it@clinica.test'
      && ic.args.settings.lan === false && ic.args.settings.mail === 'none' && ic.args.settings.port === 7380 && el('setDsOwner').value === 'it@clinica.test');
    ok('D125 answered "yes" once the service is set up', await until(() => done() === 'yes'));
    ok('then the wait: no Next while it waits', await until(() => step() === 'srvWait') && el('wlNext').hidden && /Waiting for the server/.test(msg()));
    await shots('waiting for the server');
    ok('a server that does not start: said, with Try again', await until(() => !el('wlNext').hidden, 300) && el('wlNext').textContent === 'Try again'
      && /has not started yet/.test(msg()) && el('wlSrvMsg').classList.contains('wl-err'));
    // Back to the owner step, then Set it up again: the service is set up
    // now, so Settings' Save, never a second service (the real way there).
    const installs = calls.filter((c) => c.cmd === 'server_service_install').length;
    el('wlBack').click(); await settle();
    ok('Back from the wait: the owner step again, as set up', step() === 'srvOwner' && el('wlSrvOwner').value === 'it@clinica.test' && msg() === '');
    el('wlNext').click();
    ok('Set it up again after Back: Settings\' Save, not a second service, then the wait again', await until(() => calls.some((c) => c.cmd === 'server_save'))
      && calls.filter((c) => c.cmd === 'server_service_install').length === installs && await until(() => step() === 'srvWait')
      && calls.filter((c) => c.cmd === 'server_save').pop().args.settings.ownerEmail === 'it@clinica.test');
    ok('…and it gives up again, with Try again', await until(() => !el('wlNext').hidden, 300) && el('wlNext').textContent === 'Try again');
    W.state.waitFor = 90000;
    el('wlNext').click();
    ok('Try again: Settings\' Start, then running, and this window connected to it (dcConnectOwn), which reloads', await until(() => net.reloads === 2, 300)
      && calls.some((c) => c.cmd === 'server_start') && JSON.stringify(calls.filter((c) => c.cmd === 'client_connect').pop().args) === JSON.stringify({ url: OWN, pin: null }));
    const left2 = JSON.parse(sessionStorage.getItem(W.RESUME_KEY) || 'null');
    ok('Setup left word: the sign-in, on this PC\'s own server with no email', left2 && left2.step === 'srvEmail' && left2.own === true && left2.mail === 'none'
      && left2.email === 'it@clinica.test' && left2.serverAnswered === true);

    ok('after the reload: the sign-in, the owner\'s email filled in', (await reload()) === 'resumed' && step() === 'srvEmail' && el('wlSrvEmail').value === 'it@clinica.test'
      && /gets the sign-in code from it, for this account only/.test(el('wlSrvEmailText').textContent) && el('wlSrvTokenRow').hidden);
    // A server set up before the app's key: said on the step, no retry loop.
    box.noKey = true;
    el('wlNext').click();
    ok('a server without the app\'s key: said on the code step, what to do', await until(() => /without this app's key/.test(msg()), 300) && step() === 'srvCode'
      && el('wlSrvMsg').classList.contains('wl-err') && el('wlSrvCode').value === '');
    box.noKey = false;
    el('wlBack').click(); await settle();
    ok('Back: the email again', step() === 'srvEmail');
    // An older code waiting (another attempt): handed back first, not taken.
    box.stale = { code: '999999', at: Date.now() - 60000 };
    el('wlNext').click();
    ok('the code fetched from this PC\'s server with the app\'s key (D358) and filled in, the older one not taken', await until(() => el('wlSrvCode').value === '482915', 300)
      && step() === 'srvCode' && box.stale === null && el('wlSrvCodeLbl').textContent === 'Sign-in code' && /got the code from this PC's server/.test(msg())
      && calls.filter((c) => c.cmd === 'server_signin_code').every((c) => c.args.email === 'it@clinica.test'));
    await shots('the code from this PC\'s server');
    el('wlNext').click();
    ok('signed in as the owner, on to the lock', await until(() => step() === 'lock', 300) && T.state.status === 'ready' && T.me().email === 'it@clinica.test' && T.me().serverRole === 'owner');
    await close();
    ok('closed: D125 answered once only ("yes")', done() === 'yes' && !sessionStorage.getItem(W.RESUME_KEY));

    // Closed (Esc) while the administrator prompt is up (D359): Setup
    // waits for the set-up, says so, then closes with D125's "yes".
    const fresh = async () => {
      await T.signOut().catch(() => {});
      net.url = ''; net.pin = ''; localStorage.removeItem(DC.MIRROR_KEY);
      T._reset(); Y._reset(); DC.detach(); DC.state.info = { url: '', pin: '' };
      Object.assign(DC.state, { probe: null, note: '' });
    };
    const esc = () => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    calls.length = 0; host.ask = true;
    await fresh();
    Object.assign(svc, { installed: false, running: false, startable: false, installDelay: 400 });
    plain(); app2();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); await settle();
    srv.click(); el('wlNext').click(); await settle();
    el('wlSrvOwner').value = 'it@clinica.test';
    el('wlNext').click();
    await until(() => calls.some((c) => c.cmd === 'server_service_install'));
    esc(); await settle();
    ok('Esc while the administrator prompt is up: Setup stays, and says it closes once the step is done', shown() && step() === 'srvOwner'
      && /closes once this step is done/.test(msg()) && W.doneMark() && W.doneMark().how === 'closed', msg());
    ok('…then closes, with D125 answered "yes": the service was set up', await until(() => !shown(), 300) && svc.installed
      && calls.filter((c) => c.cmd === 'server_question_done').map((c) => c.args.answer).join() === 'yes' && !sessionStorage.getItem(W.RESUME_KEY));
    const polls = calls.filter((c) => c.cmd === 'server_info').length;
    await wait(200);
    ok('…and nothing waits for the service after it closed', calls.filter((c) => c.cmd === 'server_info').length === polls && !W.state.busy);
    svc.installDelay = 0;

    // Closed while comparing a certificate: nothing pinned, and no
    // comparison left behind for Settings to show.
    calls.length = 0; host.ask = false;
    await fresh();
    plain(); app2();
    await W.atBoot(); await settle();
    W.skip(); W.skip(); await settle();
    el('wlWhereApp').querySelector('[data-where="connect"]').click(); el('wlNext').click(); await settle();
    el('wlSrvUrl').value = '192.168.1.20:7380';
    el('wlNext').click();
    ok('the comparison again', await until(() => step() === 'srvCompare') && !!DC.state.probe);
    esc(); await settle();
    ok('Esc while comparing: closed, the comparison cancelled (dcCancel), nothing pinned', !shown() && !DC.state.probe && !calls.some((c) => c.cmd === 'client_connect'));
    svc.startable = true;

    // Back to the page as the earlier checks left it.
    net.url = ''; localStorage.removeItem(DC.MIRROR_KEY);
    T._reset(); Y._reset(); DC.detach();
    Object.assign(DC.state, { Channel: null, reload: null });
    UI.setServerResponder(null);
    if (!landingIsOpen()) openLanding(true);
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

    // ---- Run the setup again ----
    W._reset(); W.state.invoke = null; TC.state.invoke = null; CK.state.invoke = null; DS.state.invoke = null; DC.state.invoke = null; DC.state.info = null;
    W.finish('done'); localStorage.setItem(W.WL_KEY, JSON.stringify({ v: 1, at: 1, how: 'done' }));
    openSettings('setup'); await settle();
    ok('Settings has Run the setup again (Setup, D356)', !el('setWelcomeSec').hidden && el('setWelcomeAgain').textContent === 'Run the setup again' && el('setWelcomeHead').textContent === 'Setup');
    el('setWelcomeAgain').click();
    ok('it runs again from step 1, Settings closed', await until(() => shown()) && !settingsOpen() && step() === 'theme');
    await close();

    // ---- Languages ----
    for (const [lang, title, count] of [['es', true, 'Paso 1 de'], ['ja', true, 'ステップ 1 /']]) {
      setLocale(lang); applyLocale();
      plain(); await W.atBoot(); await settle();
      const txt = el('welcomeDialog').textContent;
      ok(`${lang}: the welcome is translated`, el('wlCount').textContent.includes(count) && el('wlSkip').textContent !== 'Skip this step'
        && (!title || el('wlTitle').textContent !== 'Set up Topo'), el('wlCount').textContent + ' | ' + el('wlTitle').textContent);
      if (lang === 'ja') ok('ja: says PC', /PC/.test(txt) && !/コンピューター/.test(txt));
      await window.__viewport(360, 780); await audit(`The welcome (${lang})`);
      await window.__viewport(1280, 900); await settle();
      await close();
    }
    // Every Setup string, in markup and in its server steps, in every
    // language (Japanese says PC).
    {
      const keys = new Set();
      document.querySelectorAll('#welcomeDialog [data-i18n], #setWelcomeSec [data-i18n]').forEach((n) => keys.add(n.dataset.i18nKey || n.textContent.trim()));
      ['Connect', 'They are the same: connect', 'Set it up', 'Send me a code', 'Sign in', 'Try again', 'Next', 'Finish', 'All set', 'Sign-in code', 'Skip the setup',
        'This window is connected to {server} and signed in as {email}. The networks kept on the server are on the start page.',
        'This window is connected to {server}. Sign in from the start page to see the networks kept on it.',
        'This PC\'s server sends no email: Topo gets the sign-in code from it, for this account only. The owner\'s email is filled in.',
        'Topo gets the code from this PC\'s server and fills it in. Then Sign in.', 'Topo got the code from this PC\'s server. Sign in.',
        'No code came from this PC\'s server. Back, then send a new code.', 'The server has not started yet. Its log is in Settings, This PC as the server.',
        'This PC\'s server was set up without this app\'s key for sign-in codes. Save it again in Settings, This PC as the server, then send a new code.',
        'Settings is still busy with the server. Try again.', 'Setup closes once this step is done.', 'No email: Setup gets the sign-in codes (this PC only)',
        'Set up. Waiting for the server to start…', 'Running. Connecting this window to it…', 'This window is not connected to the server. Try again.',
        'Setting it up… The administrator prompt may ask for a password.', 'Type the 6-digit code.'].forEach((k) => keys.add(k));
      for (const loc of ['es', 'pt-BR', 'ru', 'ja']) {
        const missing = [...keys].filter((k) => k && !CarinoI18N.has(loc, k));
        ok(loc + ': every Setup string translated (' + keys.size + ')', missing.length === 0, missing.slice(0, 3).join(' | '));
      }
      setLocale('ja');
      const ja = [...keys].map((k) => t(k)).join(' ');
      ok('ja: Setup\'s strings say PC, never コンピューター', /PC/.test(ja) && !/コンピューター/.test(ja));
      setLocale('en');
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
