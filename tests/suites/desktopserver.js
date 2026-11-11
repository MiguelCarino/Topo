// @realtime @touch 360x780
// This PC as the server (js/desktopserver.js; docs/SCOPE.md D113, D125),
// the Settings section of the desktop app and its first-run question,
// against a stub of the app's commands (desktop/src-tauri/src/server.rs:
// server_info, server_save, server_start, server_stop, server_open,
// server_service_install, server_service_remove, server_question,
// server_question_done). The Rust side, the real child process and the
// service are not run here (the desktop app is built and its Rust unit tests
// run with cargo; the service commands have Go tests; starting either needs
// a desktop session and an administrator). Covered:
//   - on the website (no window.__TAURI__) the section stays hidden; an app
//     whose bundle has no server binary hides it too;
//   - the saved settings fill the form; "Other PCs on this network" turns
//     "Shown in the log" off and shows the SMTP fields and the LAN note;
//   - Save sends the form and the SMTP password once (never shown again:
//     "Saved (type to replace)"); a refusal is said in words;
//   - Start saves what is on screen, then starts; Running shows each address
//     with Copy and Open in browser (server_open with that address), the
//     fingerprint in LAN mode, Stop; Stop stops;
//   - a server left running by an earlier run says so and offers Stop;
//   - the log follows while Settings is open;
//   - the tick "Start it when Topo opens" goes back when it cannot be kept;
//   - the service (D125): offered only where this copy can run it, set up
//     with the form in one call, then "Running in the background", no
//     start-with-Topo tick, Start and Stop without saving first, a closed
//     administrator prompt said in words, Stop using this PC (asked first);
//   - the first-run question: asked once when the app says so, Yes opens
//     Settings at the section with the owner's email focused, Not now opens
//     nothing, both recorded;
//   - Spanish;
//   - Settings with the section through tests/fixtures/touchaudit.js at 360
//     and 390, and no sideways scroll.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const setVal = async (input, v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); await settle(); };
  const DS = window.CarinoDesktopServer;
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };

  // The app's commands, as server.rs answers them.
  const calls = [];
  const host = {
    available: true, running: false, error: '', pid: 0, hasPass: false, log: ['level=INFO msg="topo server listening"'],
    settings: { enabled: false, port: 7380, lan: false, ownerEmail: '', mail: 'none', smtpHost: '', smtpPort: 587, smtpSecurity: 'starttls', smtpUser: '', smtpFrom: '' },
    lan: ['192.168.1.20', '10.8.0.3'], fp: 'AB:CD:' + Array(30).fill('EF').join(':'),
    svc: { supported: false, installed: false, running: false }, deny: false, ask: false, answers: [],
  };
  // server.rs share_first: the chosen address first, when the PC has it.
  const lanOrder = () => { const a = host.lan.slice(), i = a.indexOf(host.settings.shareAddress || ''); if (i > 0) a.unshift(a.splice(i, 1)[0]); return a; };
  const urls = () => (host.settings.lan ? lanOrder().map((a) => `https://${a}:${host.settings.port}`) : [`http://127.0.0.1:${host.settings.port}`]);
  const svcMode = () => host.svc.installed;
  const isRunning = () => (svcMode() ? host.svc.running : host.running);
  const info = () => ({ available: host.available, mode: svcMode() ? 'service' : 'app', service: Object.assign({}, host.svc), running: isRunning(), pid: host.pid,
    urls: isRunning() ? urls() : [], fingerprint: host.settings.lan && isRunning() ? host.fp : '',
    error: host.error, log: host.log.slice(), lanAddresses: host.lan, hasSmtpPass: host.hasPass, settings: Object.assign({}, host.settings) });
  // The administrator prompt: host.deny says no to it.
  const admin = () => { if (host.deny) throw 'cancelled'; };
  const validate = (s) => {
    if (s.port < 1024) return 'port';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.ownerEmail)) return 'owner-email';
    if (s.mail === 'none' && s.lan) return 'lan-needs-email';
    if (s.mail === 'smtp' && (!s.smtpHost || !s.smtpFrom || !s.smtpPort)) return 'smtp';
    return '';
  };
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args: JSON.parse(JSON.stringify(args || {})) });
    await wait(5);
    if (cmd === 'server_info') return info();
    if (cmd === 'server_save') { const e = validate(args.settings); if (e) throw e; host.settings = Object.assign({}, args.settings); if (args.smtpPass) host.hasPass = true; return info(); }
    if (cmd === 'server_start' && svcMode()) { admin(); host.svc.running = true; return info(); }
    if (cmd === 'server_stop' && svcMode()) { admin(); host.svc.running = false; return info(); }
    if (cmd === 'server_start') { const e = validate(host.settings); if (e) throw e; host.running = true; host.pid = 4242; host.error = ''; host.log.push('level=INFO msg="self-signed certificate"'); return info(); }
    if (cmd === 'server_stop') { host.running = false; host.pid = 0; host.error = ''; return info(); }
    if (cmd === 'server_service_install') {
      const e = validate(args.settings); if (e) throw e;
      if (!host.svc.supported) throw 'no-service';
      admin();
      host.settings = Object.assign({}, args.settings, { enabled: false }); host.running = false;
      host.svc.installed = true; host.svc.running = true; if (args.smtpPass) host.hasPass = true; return info();
    }
    if (cmd === 'server_service_remove') { admin(); host.svc.installed = false; host.svc.running = false; return info(); }
    if (cmd === 'server_question') return host.ask;
    if (cmd === 'server_question_done') { host.answers.push(args.answer); host.ask = false; return null; }
    if (cmd === 'server_open') { if (!urls().includes(args.url)) throw 'not-ours'; return null; }
    throw new Error('unknown ' + cmd);
  };
  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');

    // ---- The website ----
    ok('on the website there is no host', !window.__TAURI__);
    openSettings(); await settle();
    ok('…and Settings has no "This PC as the server"', el('setDsSec').hidden === true);
    closeSettings();

    // ---- An app without the binary ----
    DS.state.invoke = invoke;
    host.available = false;
    openSettings(); await settle();
    ok('an app with no bundled server hides the section', await until(() => calls.some((c) => c.cmd === 'server_info')) && el('setDsSec').hidden);
    closeSettings();
    host.available = true;

    // ---- The form ----
    host.settings.ownerEmail = 'it@example.com';
    openSettings();
    ok('the section shows in the app', await until(() => !el('setDsSec').hidden));
    ok('Off, with Start and no Stop', el('setDsStatus').textContent === 'Off.' && !el('setDsStart').hidden && el('setDsStop').hidden);
    ok('the saved settings fill the form', el('setDsOwner').value === 'it@example.com' && el('setDsPort').value === '7380' && el('setDsWho').value === 'pc' && el('setDsMail').value === 'none' && !el('setDsEnabled').checked);
    ok('"Shown in the log": no SMTP fields, no LAN note', el('setDsSmtp').hidden && el('setDsLanNote').hidden);
    await setVal(el('setDsWho'), 'lan');
    ok('other PCs: email only, the SMTP fields and the LAN note', el('setDsMail').value === 'smtp' && el('setDsMail').querySelector('option[value="none"]').disabled && !el('setDsSmtp').hidden && !el('setDsLanNote').hidden);
    const pass = el('setDsSmtpPass');
    ok('the SMTP password is a password the manager does not fill', pass.type === 'password' && pass.getAttribute('autocomplete') === 'new-password');

    // ---- Save ----
    el('setDsSave').click();
    ok('a missing SMTP server is said in words', await until(() => /Fill in the SMTP server/.test(el('setDsStatus').textContent)) && el('setDsStatus').classList.contains('ds-err'));
    await setVal(el('setDsSmtpHost'), 'smtp.example.com');
    await setVal(el('setDsSmtpFrom'), 'Topo <topo@example.com>');
    await setVal(el('setDsSmtpUser'), 'topo@example.com');
    await setVal(pass, 'smtp-secret');
    calls.length = 0;
    el('setDsSave').click();
    ok('saved', await until(() => el('setDsStatus').textContent === 'Saved.'));
    const saved = calls.find((c) => c.cmd === 'server_save');
    ok('Save sends the form and the password once', saved && saved.args.settings.lan === true && saved.args.settings.mail === 'smtp' && saved.args.settings.smtpHost === 'smtp.example.com' && saved.args.smtpPass === 'smtp-secret'
      && !('smtpPass' in saved.args.settings), JSON.stringify(saved && saved.args));
    ok('then the field is empty: "Saved (type to replace)"', pass.value === '' && pass.placeholder === 'Saved (type to replace)');
    calls.length = 0;
    el('setDsSave').click();
    await until(() => calls.some((c) => c.cmd === 'server_save'));
    await until(() => !DS.state.busy);
    ok('a later Save sends no password', calls.find((c) => c.cmd === 'server_save').args.smtpPass === null);

    // ---- Start, the addresses, Stop ----
    calls.length = 0;
    el('setDsStart').click();
    ok('Start saves what is on screen, then starts', await until(() => host.running) && calls.map((c) => c.cmd).filter((c) => c !== 'server_info').join(',') === 'server_save,server_start');
    ok('Running: give the other PCs this address', await until(() => /Give the other PCs this address/.test(el('setDsStatus').textContent)));
    const items = [...el('setDsUrls').querySelectorAll('.ds-url')];
    ok('every LAN address, https, with Copy and Open in browser', items.length === 2 && items[0].querySelector('code').textContent === 'https://192.168.1.20:7380'
      && items.every((li) => [...li.querySelectorAll('button')].map((b) => b.textContent).join(',') === 'Copy,Open in browser'), items.map((li) => li.textContent).join(' | '));
    ok('the fingerprint to compare', !el('setDsFpRow').hidden && el('setDsFp').textContent === host.fp);
    ok('Stop, no Start', !el('setDsStop').hidden && el('setDsStart').hidden);
    calls.length = 0;
    items[1].querySelectorAll('button')[1].click();
    ok('Open in browser asks the app to open that address', await until(() => calls.some((c) => c.cmd === 'server_open')) && calls.find((c) => c.cmd === 'server_open').args.url === 'https://10.8.0.3:7380');
    host.log.push('level=INFO msg="sign-in code sent"');
    el('setDsSec').querySelector('details').open = true;
    ok('the log follows while Settings is open', await until(() => /sign-in code sent/.test(el('setDsLog').textContent), 200));

    for (const w of [360, 390]) {
      await window.__viewport(w, w === 360 ? 780 : 844); await settle();
      el('setDsSec').scrollIntoView();
      await audit('Settings, This PC as the server, running');
    }
    await window.__viewport(1280, 800); await settle();

    el('setDsStop').click();
    ok('Stop stops', await until(() => !host.running && el('setDsStatus').textContent === 'Off.') && el('setDsUrls').hidden && el('setDsFpRow').hidden);

    // ---- The address to give people ----
    const share = el('setDsShare');
    ok('the address to give people: Automatic, then every LAN address', !el('setDsShareRow').hidden
      && [...share.options].map((o) => o.value).join(',') === ',192.168.1.20,10.8.0.3' && share.value === '');
    await setVal(share, '10.8.0.3');
    calls.length = 0;
    el('setDsStart').click();
    ok('the chosen address is saved and comes first', await until(() => host.running) && calls.find((c) => c.cmd === 'server_save').args.settings.shareAddress === '10.8.0.3'
      && await until(() => (el('setDsUrls').querySelector('code') || {}).textContent === 'https://10.8.0.3:7380'));
    el('setDsStop').click(); await until(() => !host.running);
    await setVal(share, '');

    // ---- A server left running ----
    host.error = 'already-running'; host.pid = 999;
    await DS.dsRefresh(false);
    ok('a server left running is said, with Stop', /still running on this PC/.test(el('setDsStatus').textContent) && !el('setDsStop').hidden);
    host.error = ''; host.pid = 0;
    await DS.dsRefresh(false);

    // ---- This PC only ----
    await setVal(el('setDsWho'), 'pc');
    ok('this PC only: "Shown in the log" offered again', !el('setDsMail').querySelector('option[value="none"]').disabled && el('setDsLanNote').hidden);
    await setVal(el('setDsMail'), 'none');
    el('setDsStart').click();
    ok('this PC only runs on http://127.0.0.1', await until(() => host.running) && await until(() => el('setDsUrls').textContent.includes('http://127.0.0.1:7380')) && /Open it on this PC/.test(el('setDsStatus').textContent) && el('setDsFpRow').hidden);
    el('setDsStop').click(); await until(() => !host.running);

    // ---- The tick ----
    await setVal(el('setDsOwner'), '');
    el('setDsEnabled').checked = true;
    el('setDsEnabled').dispatchEvent(new Event('change', { bubbles: true }));
    ok('a tick that cannot be kept goes back, and says why', await until(() => /owner's email/.test(el('setDsStatus').textContent)) && !el('setDsEnabled').checked && host.settings.enabled === false);
    await setVal(el('setDsOwner'), 'it@example.com');
    el('setDsEnabled').checked = true;
    el('setDsEnabled').dispatchEvent(new Event('change', { bubbles: true }));
    ok('…and is kept once it can be', await until(() => host.settings.enabled === true) && el('setDsEnabled').checked);

    // ---- The service (D125) ----
    el('setDsEnabled').checked = false;
    el('setDsEnabled').dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => host.settings.enabled === false);
    await DS.dsRefresh(false);
    ok('a copy that cannot run the service (an AppImage): only while Topo is open', el('setDsService').hidden && !el('setDsEnabledRow').hidden && el('setDsRemove').hidden
      && el('setDsHow').textContent === 'It runs only while Topo is open.' && el('setDsStart').classList.contains('btn-primary'));
    host.svc.supported = true;
    await DS.dsRefresh(false);
    ok('a packaged copy offers "Run it in the background from startup", first', !el('setDsService').hidden && el('setDsService').classList.contains('btn-primary')
      && !el('setDsStart').classList.contains('btn-primary') && /recommended/.test(el('setDsHow').textContent));
    await setVal(el('setDsWho'), 'lan');
    await setVal(el('setDsSmtpHost'), 'smtp.example.com');
    await setVal(el('setDsSmtpFrom'), 'Topo <topo@example.com>');
    host.deny = true;
    el('setDsService').click();
    ok('a closed administrator prompt changes nothing, and says so', await until(() => /administrator prompt was closed/.test(el('setDsStatus').textContent)) && !host.svc.installed);
    host.deny = false;
    await setVal(el('setDsSmtpPass'), 'svc-secret');
    calls.length = 0;
    el('setDsService').click();
    ok('set up: one call with the form and the password', await until(() => host.svc.installed) && calls.filter((c) => c.cmd === 'server_service_install').length === 1
      && calls.find((c) => c.cmd === 'server_service_install').args.settings.lan === true && calls.find((c) => c.cmd === 'server_service_install').args.smtpPass === 'svc-secret');
    ok('…said, the password field emptied', await until(() => /starts with this PC from now on/.test(el('setDsStatus').textContent)) && el('setDsSmtpPass').value === '');
    await DS.dsRefresh(false);
    ok('the service: running in the background, its addresses and fingerprint', /Running in the background\. Give the other PCs this address/.test(el('setDsStatus').textContent)
      && el('setDsUrls').querySelectorAll('.ds-url').length === 2 && el('setDsFp').textContent === host.fp);
    ok('…no start-with-Topo tick, no set-up button, Stop using this PC offered', el('setDsEnabledRow').hidden && el('setDsService').hidden && !el('setDsRemove').hidden
      && /nobody is signed in/.test(el('setDsHow').textContent));
    calls.length = 0;
    el('setDsStop').click();
    ok('Stop goes to the service, without saving first', await until(() => !host.svc.running) && calls.filter((c) => c.cmd !== 'server_info').map((c) => c.cmd).join(',') === 'server_stop'
      && await until(() => el('setDsStatus').textContent === 'Set up to start with this PC, but not running now.'));
    calls.length = 0;
    el('setDsStart').click();
    ok('Start too: one call, one administrator prompt', await until(() => host.svc.running) && calls.filter((c) => c.cmd !== 'server_info').map((c) => c.cmd).join(',') === 'server_start');
    const prevResponder = setDialogResponder(() => false);
    calls.length = 0;
    el('setDsRemove').click();
    await wait(120);
    ok('Stop using this PC asks first; No keeps it', !calls.some((c) => c.cmd === 'server_service_remove') && host.svc.installed);
    let asked = null;
    setDialogResponder((req) => { asked = req; return true; });
    el('setDsRemove').click();
    ok('…Yes removes it, the data stays', await until(() => !host.svc.installed) && /Stop using this PC as the server\?/.test(asked.message) && asked.danger === true
      && await until(() => /Its data stays on this PC/.test(el('setDsStatus').textContent)) && !el('setDsService').hidden && !el('setDsEnabledRow').hidden);

    // ---- The first-run question ----
    closeSettings(); await settle();
    asked = null;
    host.ask = false;
    ok('not asked when the app says not to', (await DS.dsFirstRun()) === false && asked === null);
    host.ask = true;
    setDialogResponder((req) => { asked = req; return false; });
    ok('Not now: nothing opens', (await DS.dsFirstRun()) === false && el('settingsDialog').hidden && host.answers.join(',') === 'no');
    ok('the question names the choice and the background', asked && asked.title === 'Use this PC as the server for your network?' && /background from startup/.test(asked.message)
      && asked.ok === 'Yes, set it up' && asked.cancel === 'Not now');
    ok('asked once: not again', (await DS.dsFirstRun()) === false && host.answers.length === 1);
    host.ask = true;
    setDialogResponder(() => true);
    await setVal(el('setDsOwner'), '');
    host.settings.ownerEmail = '';
    ok('Yes: Settings opens at the section', (await DS.dsFirstRun()) === true && !el('settingsDialog').hidden && !el('setDsSec').hidden && host.answers.join(',') === 'no,yes');
    ok('…with what to do next, and the owner\'s email focused', /Fill in the owner's email/.test(el('setDsStatus').textContent) && document.activeElement === el('setDsOwner')
      && !el('setDsService').hidden);
    setDialogResponder(prevResponder);
    host.settings.ownerEmail = 'it@example.com';
    await DS.dsRefresh(true);

    // ---- Spanish ----
    setLocale('es'); applyLocale('es'); await settle();
    await DS.dsRefresh(false);
    ok('Spanish', el('setDsHead').textContent === 'Este PC como servidor' && el('setDsStart').textContent === 'Iniciar' && el('setDsStatus').textContent === 'Apagado.',
      el('setDsHead').textContent + ' / ' + el('setDsStatus').textContent);
    ok('an error code in Spanish', DS.dsErrText('lan-needs-email').startsWith('Los otros PC necesitan'));
    setLocale('en'); applyLocale('en'); await settle();
    closeSettings();
  } catch (e) {
    ok('suite ran to the end', false, String(e && e.stack || e));
  }
  DS.state.invoke = null;
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 300); });
