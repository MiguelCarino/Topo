// @realtime @touch 360x780
// Connect to a Topo server (js/desktopclient.js; docs/SCOPE.md D144, step
// 7c): the desktop app's window as a client of a Topo server, with every
// request and the event stream going through the app's commands
// (desktop/src-tauri/src/clientcmd.rs: client_info, client_probe,
// client_connect, client_disconnect, client_request, client_events,
// client_events_close). Here the commands are a stub whose client_request
// answers from the in-page fake server (tests/fixtures/fakeserver.js), so
// js/server.js and js/serversync.js run unchanged on the app's transport.
// The Rust side is tested with cargo (src/client.rs: the pin, a changed
// certificate refused, the cookie, the stream) and against the real
// topo-server by tests/desktop-client-e2e.mjs. Covered:
//   - on the website (no window.__TAURI__) the section stays hidden and
//     js/server.js keeps its own fetch (nothing is hooked);
//   - in the app, not connected: "Not connected", the address field;
//   - plain http to another PC refused in words; nobody there, in words;
//   - a server that signs its own certificate: its fingerprint to compare,
//     Cancel goes back, "They are the same: connect" pins it
//     (client_connect with that fingerprint), keeps the address and reloads;
//   - a server with a public certificate connects with no question;
//   - after the reload: js/server.js's fetch, EventSource and origin are the
//     app's, it opens signed out through client_request ("Sign in" shown),
//     signs in, sets up its keys and puts a network on the server;
//   - the stream: events reach js/server.js, a dropped stream reconnects
//     (readyState 0), a refused one is closed (2), close() tells the app;
//   - a body that is not text arrives as bytes; no answer is "offline";
//   - a changed certificate: refused, said once, Settings says why and
//     offers to check it again, which compares the new fingerprint;
//   - in the window, the sign-in sheet asks only for the code (the email's
//     link signs in a browser), and Backups shows the server's redirect
//     address (not the page's) and sends Google Drive / OneDrive to a
//     browser on the server instead of a Connect that cannot finish;
//   - a server with no pin whose certificate stops being trusted: refused,
//     said, not retried, and Settings offers to check it again;
//   - the retry wait starts again from 5 s once the server answers;
//   - Disconnect asks, signs out, forgets the server and reloads;
//   - the app and the page disagreeing: one reload, never a loop;
//   - the section in Spanish; Settings at 360 and 390 through
//     tests/fixtures/touchaudit.js, no sideways scroll, in both themes.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const setVal = async (input, v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); await settle(); };
  const DC = window.CarinoDesktopClient;
  const T = window.TopoServer, Y = window.TopoServerSync;
  const root = document.documentElement;
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };
  const FP = 'A6:08:2D:50:E7:2C:E3:6B:3E:2B:0F:A0:BF:6A:CF:18:EE:68:34:75:AA:29:1A:20:C4:CD:32:3B:30:CF:7B:6C';
  const NEW_FP = '18:85:62:E8:D1:4F:9D:6C:AA:4B:4B:AE:36:3E:BE:EE:42:A2:76:5D:C7:7B:52:AA:0F:7E:23:01:44:11:9E:BA';
  const LAN = 'https://192.168.1.20:7380';
  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    await loadScript('tests/fixtures/fakeserver.js');

    // ---- The website ----
    ok('on the website there is no host', !window.__TAURI__);
    ok('…nothing is hooked: js/server.js keeps its own fetch', !T._hooks.force && T._hooks.fetch === null && T._hooks.EventSource === null);
    openSettings('server'); await settle();
    ok('…and Settings has no "Connect to a Topo server"', el('setDcSec').hidden === true);
    closeSettings();

    // ---- The app's commands, as clientcmd.rs answers them ----
    const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    const calls = [];
    const host = { url: '', pin: '', offline: false, changed: '', streams: [], closed: [], binary: null };
    const norm = (u) => { const s = String(u || '').trim(); if (!s) return null; const w = s.includes('://') ? s : 'https://' + s; try { return new URL(w).origin; } catch (e) { return null; } };
    const invoke = async (cmd, args) => {
      calls.push({ cmd, args: cmd === 'client_events' ? { path: args.path } : JSON.parse(JSON.stringify(args || {})) });
      await wait(3);
      if (cmd === 'client_info') return { url: host.url, pin: host.pin };
      if (cmd === 'client_probe' || cmd === 'client_connect') {
        const url = norm(args.url);
        if (!url) throw 'address';
        if (url.startsWith('http://') && !/^http:\/\/(127\.|localhost|\[::1\])/.test(url)) { if (cmd === 'client_probe') return { url: '', error: 'needs-https', fingerprint: '' }; throw 'needs-https'; }
        if (/nobody/.test(url)) { if (cmd === 'client_probe') return { url, error: 'offline', fingerprint: '' }; throw 'offline'; }
        const fp = /192\.168/.test(url) ? (host.changed || FP) : (host.untrusted || '');
        const pinned = (args.pin || '') === fp;
        if (cmd === 'client_probe') return { url, error: fp && !pinned ? 'untrusted' : '', fingerprint: fp };
        if (fp && !pinned) throw 'untrusted:' + fp;
        host.url = url; host.pin = args.pin || ''; host.changed = ''; host.untrusted = '';
        return { url: host.url, pin: host.pin };
      }
      if (cmd === 'client_disconnect') { host.url = ''; host.pin = ''; return { url: '', pin: '' }; }
      if (cmd === 'client_request') {
        if (!host.url) throw 'not-connected';
        if (host.changed) throw 'pin-changed:' + host.changed;
        if (host.untrusted) throw 'untrusted:' + host.untrusted;
        if (host.offline) throw 'offline';
        if (host.empty && args.path === host.empty) return { status: 204, contentType: '', body: '', b64: false };
        if (host.binary && args.path === host.binary.path) return { status: 200, contentType: 'application/octet-stream', body: host.binary.b64, b64: true };
        let r;
        try { r = await fake.fetch(args.path, { method: args.method, body: args.body || undefined, headers: { 'X-Topo': '1' } }); } catch (e) { throw 'offline'; }
        return { status: r.status, contentType: 'application/json', body: await r.text(), b64: false };
      }
      if (cmd === 'client_events') { const id = host.streams.length + 1; host.streams.push({ id, ch: args.onEvent, path: args.path }); return id; }
      if (cmd === 'client_events_close') { host.closed.push(args.id); return null; }
      throw new Error('unknown ' + cmd);
    };
    class StubChannel { constructor() { this.onmessage = null; } }
    let reloads = 0;
    Object.assign(DC.state, { invoke, Channel: StubChannel, reload: () => { reloads++; } });
    TopoServerUI.setServerResponder((q) => (q.kind === 'recovery' ? 'ok' : q.kind === 'show-name' ? false : null));
    // What the app does at a (re)load: the boot reads the mirror and asks
    // the app, then js/app.js's boot opens the server client.
    const restart = async () => {
      T._reset(); Y._reset(); DC.detach();
      Object.assign(DC.state, { info: null, changed: '', changedKind: '', told: false, probe: null, note: '' });
      await DC.boot();
      await openServerClient();
      await settle();
    };

    // ---- Not connected ----
    await restart();
    openSettings('server'); await settle();
    ok('the section shows in the app', !el('setDcSec').hidden && el('setDcHead').textContent === 'Connect to a Topo server');
    ok('…not connected: the networks stay on this PC, the address field', /Not connected/.test(el('setDcStatus').textContent) && !el('setDcForm').hidden && el('setDcOn').hidden && el('setDcCompare').hidden);
    ok('…and nothing is hooked yet', !T._hooks.force && T.state.status === 'off');
    for (const w of [360, 390]) {
      await window.__viewport(w, w === 360 ? 780 : 844); await settle();
      el('setDcSec').scrollIntoView();
      await audit('Settings, Connect to a Topo server');
    }
    await window.__viewport(1280, 800); await settle();

    await setVal(el('setDcUrl'), 'http://192.168.1.20:7380');
    el('setDcConnect').click();
    ok('plain http to another PC is refused in words', await until(() => /needs https/.test(el('setDcStatus').textContent)) && el('setDcStatus').classList.contains('ds-err'));
    await setVal(el('setDcUrl'), 'nobody.example');
    el('setDcConnect').click();
    ok('nobody there, in words', await until(() => /No Topo server answered/.test(el('setDcStatus').textContent)));

    // ---- A self-signed server: compare, then pin ----
    await setVal(el('setDcUrl'), '192.168.1.20:7380');
    el('setDcConnect').click();
    ok('its fingerprint is shown to compare', await until(() => !el('setDcCompare').hidden) && el('setDcFp').textContent === FP && el('setDcForm').hidden);
    ok('…"They are the same: connect" has the focus', document.activeElement === el('setDcTrust'));
    for (const theme of ['gold', 'color']) {
      root.setAttribute('data-carino-theme', theme);
      for (const w of [360, 390]) {
        await window.__viewport(w, w === 360 ? 780 : 844); await settle();
        el('setDcSec').scrollIntoView();
        await audit(`Settings, compare the fingerprint (${theme})`);
      }
    }
    root.setAttribute('data-carino-theme', 'gold');
    await window.__viewport(1280, 800); await settle();
    el('setDcCancel').click(); await settle();
    ok('Cancel goes back to the address', el('setDcCompare').hidden && !el('setDcForm').hidden && !calls.some((c) => c.cmd === 'client_connect'));
    el('setDcConnect').click();
    await until(() => !el('setDcCompare').hidden);
    el('setDcTrust').click();
    ok('they are the same: connected, pinned to that fingerprint, and the page reloads', await until(() => reloads === 1)
      && JSON.stringify(calls.find((c) => c.cmd === 'client_connect').args) === JSON.stringify({ url: LAN, pin: FP }) && host.pin === FP
      && localStorage.getItem(DC.MIRROR_KEY) === JSON.stringify({ url: LAN }), JSON.stringify(calls.slice(-3)));
    closeSettings();

    // ---- Connected: js/server.js on the app's transport ----
    calls.length = 0;
    await restart();
    ok('after the reload the hooks are the app\'s', T._hooks.force === true && T._hooks.origin === LAN && T._hooks.fetch === DC.hostFetch && T._hooks.EventSource === DC.HostEventSource);
    ok('it opens signed out, through the app', T.state.status === 'signed-out' && calls.some((c) => c.cmd === 'client_request' && c.args.path === '/api/health' && c.args.method === 'GET'), T.state.status);
    openSettings('server'); await settle();
    ok('Settings: connected, Sign in, the pinned fingerprint, Disconnect', /Connected\. Sign in/.test(el('setDcStatus').textContent) && !el('setDcSignIn').hidden
      && el('setDcAddr').textContent === LAN && el('setDcPin').textContent === FP && !el('setDcDisconnect').hidden && el('setDcForm').hidden);
    closeSettings();
    const sheetText = () => el('serverSheetBody').textContent;
    TopoServerUI.openSignIn(); await settle();
    const emailIn = el('serverSheetBody').querySelector('[data-k="email"]');
    await setVal(emailIn, 'owner@example.test');
    el('serverSheetBody').querySelector('button.primary').click();
    ok('in the window the sign-in asks for the code only (the email\'s link signs in a browser)', await until(() => /Type the code from the email here\./.test(sheetText())) && !/in this browser/.test(sheetText()), sheetText().slice(0, 300));
    TopoServerUI.closeSheet(); await settle();
    const ch = await T.requestCode('owner@example.test');
    await T.verifyCode(ch, '123456', 'owner@example.test');
    ok('signed in with keys, through the app', T.state.status === 'ready', T.state.status);
    const verify = calls.find((c) => c.cmd === 'client_request' && c.args.path === '/api/auth/verify');
    ok('…a POST carries its JSON body to the app', verify && verify.args.method === 'POST' && JSON.parse(verify.args.body).code === '123456');
    ok('…the keys are kept under the server\'s address', !!(await T.myRecord()) && (await T.myRecord()).origin === LAN);
    replaceDocument(templatesData.house, { origin: 'default' });
    const id = claimDocument('Office', null);
    await TopoServerUI.putOnServer(id);
    ok('a network put on the server through the app', Y.rec(id) && Y.rec(id).baseN === 1 && Y.cardSync(id).state === 'synced' && fake.state.sites.get(Y.rec(id).siteId).revs.length === 1);
    openSettings('server'); await settle();
    ok('Settings: connected and signed in as the owner', /signed in as owner@example\.test/.test(el('setDcStatus').textContent) && el('setDcSignIn').hidden);
    for (const theme of ['gold', 'color']) {
      root.setAttribute('data-carino-theme', theme);
      for (const w of [360, 390]) {
        await window.__viewport(w, w === 360 ? 780 : 844); await settle();
        el('setDcSec').scrollIntoView();
        await audit(`Settings, connected (${theme})`);
      }
    }
    root.setAttribute('data-carino-theme', 'gold');
    await window.__viewport(1280, 800); await settle();
    closeSettings();

    // ---- Backups to Google Drive or OneDrive, from the window ----
    TopoServerUI.openBackups();
    ok('Backups opens for the owner, through the app', await until(() => !!el('serverSheetBody').querySelector('[data-k="kind"]')));
    const kindSel = el('serverSheetBody').querySelector('[data-k="kind"]');
    kindSel.value = 'gdrive'; kindSel.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    ok('…the redirect address is the server\'s, not the window\'s', /Redirect address to register in the app: https:\/\/topo\.example\.test\/api\/backups\/oauth\/callback/.test(sheetText()) && !/localhost/.test(sheetText()), sheetText().slice(0, 900));
    const sheetBtn = (label) => [...el('serverSheetBody').querySelectorAll('button')].find((b) => b.textContent === label);
    ok('…no Connect that cannot finish here; it says to finish in a browser', !sheetBtn('Connect') && /Connect cannot finish: Google sends you back to a browser/.test(sheetText()) && !!sheetBtn('Open the server in a browser'), sheetText().slice(-400));
    let went = null;
    T._hooks.navigate = (u) => { went = u; };
    const startsBefore = fake.calls.filter((c) => /oauth\/start/.test(c.path)).length;
    sheetBtn('Open the server in a browser').click(); await settle();
    ok('…which opens the server\'s own address (outside the app), and starts nothing', went === LAN + '/' && fake.calls.filter((c) => /oauth\/start/.test(c.path)).length === startsBefore, String(went));
    for (const theme of ['gold', 'color']) {
      root.setAttribute('data-carino-theme', theme);
      for (const w of [360, 390]) {
        await window.__viewport(w, w === 360 ? 780 : 844); await settle();
        await audit('Backups, Google Drive in the window (' + theme + ')');
      }
    }
    root.setAttribute('data-carino-theme', 'gold');
    await window.__viewport(1280, 800); await settle();
    T._hooks.navigate = null;
    TopoServerUI.closeSheet(); await settle();
    // This PC's own server (at 127.0.0.1): the address the server makes for
    // a request from this machine, http(s)://localhost:<port>.
    const wasOrigin = T._hooks.origin;
    T._hooks.origin = 'http://127.0.0.1:7380';
    TopoServerUI.openBackups();
    await until(() => !!el('serverSheetBody').querySelector('[data-k="kind"]'));
    const k2 = el('serverSheetBody').querySelector('[data-k="kind"]');
    k2.value = 'onedrive'; k2.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    ok('…this PC\'s own server: http://localhost:7380 with the server\'s port, not the window\'s', /Redirect address to register in the app: http:\/\/localhost:7380\/api\/backups\/oauth\/callback/.test(sheetText()), sheetText().slice(0, 900));
    TopoServerUI.closeSheet(); await settle();
    T._hooks.origin = wasOrigin;

    // ---- The event stream ----
    ok('the stream is the app\'s, at /api/events', await until(() => host.streams.length > 0) && host.streams[host.streams.length - 1].path === '/api/events');
    const st = host.streams[host.streams.length - 1];
    const es = T.state.es;
    let mes = 0;
    T.on('event:me', () => { mes++; });
    st.ch.onmessage({ kind: 'open' });
    ok('open: readyState 1', es.readyState === 1);
    st.ch.onmessage({ kind: 'event', event: 'me', data: '{}' });
    ok('an event reaches js/server.js', await until(() => mes === 1));
    st.ch.onmessage({ kind: 'event', event: 'nobody-listens', data: '{}' });
    st.ch.onmessage({ kind: 'error', closed: false });
    ok('a dropped stream: reconnecting (0), still the same stream', es.readyState === 0 && T.state.es === es);
    st.ch.onmessage({ kind: 'open' });
    st.ch.onmessage({ kind: 'event', event: 'me', data: '{}' });
    ok('…and back: events again', es.readyState === 1 && await until(() => mes === 2));
    const probe = new DC.HostEventSource('/api/events');
    await until(() => host.streams.length >= 2);
    const st2 = host.streams[host.streams.length - 1];
    let errs = 0; probe.onerror = () => { errs++; };
    st2.ch.onmessage({ kind: 'error', closed: true });
    ok('a refused stream is closed for good (2)', probe.readyState === 2 && errs === 1);
    st2.ch.onmessage({ kind: 'event', event: 'me', data: '{}' });
    const p3 = new DC.HostEventSource('/api/events');
    await until(() => host.streams.length >= 3);
    p3.close();
    ok('close() tells the app which stream', await until(() => host.closed.includes(host.streams[host.streams.length - 1].id)) && p3.readyState === 2);

    // ---- Bytes, and no answer ----
    host.binary = { path: '/api/sites/x/backups/b', b64: '/wAB' };
    const raw = new Uint8Array(await (await DC.hostFetch('/api/sites/x/backups/b', { method: 'GET' })).arrayBuffer());
    ok('a body that is not text arrives as its bytes', raw.length === 3 && raw[0] === 255 && raw[1] === 0 && raw[2] === 1);
    host.binary = null;
    host.empty = '/api/nothing';
    ok('204: no body, and js/server.js reads it as nothing', (await DC.hostFetch('/api/nothing', { method: 'POST', body: '{}' })).status === 204 && (await T.api('POST', '/api/nothing', {})) === null);
    host.empty = null;
    host.offline = true;
    let offErr = null;
    try { await T.api('GET', '/api/me'); } catch (e) { offErr = e; }
    ok('no answer: js/server.js gets its own "offline"', offErr && offErr.offline === true && offErr.code === 'offline');
    host.offline = false;

    // ---- A changed certificate ----
    host.changed = NEW_FP;
    let changedErr = null;
    try { await T.api('GET', '/api/me'); } catch (e) { changedErr = e; }
    ok('a changed certificate is refused (offline for the page)', changedErr && changedErr.offline === true);
    ok('…said once', await until(() => /certificate changed/.test(el('topoToast').textContent) && el('topoToast').classList.contains('err')));
    el('topoToast').textContent = '';
    try { await T.api('GET', '/api/me'); } catch (e) { /* again */ }
    ok('…only once', DC.state.told === true && el('topoToast').textContent === '');
    openSettings('server'); await settle();
    ok('Settings says why, and offers to check it again', /certificate changed since this window connected/.test(el('setDcStatus').textContent) && el('setDcStatus').classList.contains('ds-err')
      && !el('setDcAgain').hidden && el('setDcSignIn').hidden);
    reloads = 0;
    el('setDcAgain').click();
    ok('…which shows the new fingerprint to compare', await until(() => !el('setDcCompare').hidden) && el('setDcFp').textContent === NEW_FP);
    el('setDcTrust').click();
    ok('…and pins the new one', await until(() => reloads === 1) && host.pin === NEW_FP && host.url === LAN);
    closeSettings();
    await restart();
    ok('after the reload: still signed in (the same server keeps the session)', await until(() => T.state.status === 'ready'), T.state.status);

    // ---- Disconnect ----
    openSettings('server'); await settle();
    const prev = setDialogResponder(() => false);
    el('setDcDisconnect').click(); await wait(120);
    ok('Disconnect asks first; No keeps it', !calls.some((c) => c.cmd === 'client_disconnect') && host.url === LAN);
    let asked = null;
    setDialogResponder((q) => { asked = q; return true; });
    reloads = 0;
    calls.length = 0;
    el('setDcDisconnect').click();
    ok('Yes: signs out, forgets the server, reloads', await until(() => reloads === 1) && host.url === '' && localStorage.getItem(DC.MIRROR_KEY) === null
      && calls.some((c) => c.cmd === 'client_request' && c.args.path === '/api/auth/signout') && /Disconnect this window from https:\/\/192\.168\.1\.20:7380\?/.test(asked.message) && asked.danger === true);
    setDialogResponder(prev);
    closeSettings();
    await restart();
    ok('after the reload: not connected, nothing hooked', !T._hooks.force && T.state.status === 'off');

    // ---- A server with a public certificate ----
    reloads = 0;
    ok('a server whose certificate a public authority signed connects with no question', (await DC.dcConnect('topo.example.com')) === true && reloads === 1 && host.pin === '' && host.url === 'https://topo.example.com');

    // ---- The app and the page disagree ----
    reloads = 0;
    try { sessionStorage.removeItem('topo-desktop-client-reloaded'); } catch (e) { /* fine */ }
    localStorage.setItem(DC.MIRROR_KEY, JSON.stringify({ url: 'https://old.example' }));
    T._reset(); Y._reset(); DC.detach();
    await DC.boot();
    ok('the app says another server: the page follows with one reload', reloads === 1 && localStorage.getItem(DC.MIRROR_KEY) === JSON.stringify({ url: 'https://topo.example.com' }));
    localStorage.setItem(DC.MIRROR_KEY, JSON.stringify({ url: 'https://old.example' }));
    T._reset(); Y._reset(); DC.detach();
    await DC.boot();
    ok('…never a loop: the second time it opens the app\'s server at once', reloads === 1 && T._hooks.origin === 'https://topo.example.com');
    await until(() => T.state.status !== 'checking');
    try { sessionStorage.removeItem('topo-desktop-client-reloaded'); } catch (e) { /* fine */ }

    // ---- A certificate nobody vouches for any more (no pin) ----
    const OTHER_FP = '50:0C:F9:E4:58:9B:9A:86:64:DE:55:23:86:FA:E3:8B:F5:31:6A:BA:3A:D5:5F:4A:64:5C:3A:D1:CD:7D:F9:F0';
    host.untrusted = OTHER_FP;
    el('topoToast').textContent = '';
    DC.state.retryMs = 40;
    await restart();
    ok('a server with no pin whose certificate is not trusted any more: refused', T.state.status === 'unreachable' && DC.state.changed === OTHER_FP && DC.state.changedKind === 'untrusted', T.state.status);
    ok('…said, as a certificate problem', await until(() => /certificate could not be checked/.test(el('topoToast').textContent)));
    const reqs = () => calls.filter((c) => c.cmd === 'client_request').length;
    const n0 = reqs();
    await wait(400);
    ok('…and not retried on its own', reqs() === n0, `${reqs() - n0} more requests`);
    // The toast sends the person to Settings: the gear opens at Topo server
    // over the kept tab while the certificate waits for a decision (D362).
    try { sessionStorage.setItem('topo.settings.tab', 'general'); } catch (e) { /* none */ }
    openSettings(); await settle();
    ok('the gear opens Settings at Topo server while the certificate waits (over the kept tab)', el('setTab-server').getAttribute('aria-selected') === 'true'
      && !el('setPanel-server').hidden && !el('setDcAgain').hidden, document.querySelector('#settingsDialog .set-tab[aria-selected="true"]')?.dataset.tab);
    closeSettings(); await settle();
    openSettings('server'); await settle();
    ok('Settings says the certificate cannot be checked, and offers to check it again', /cannot be checked any more/.test(el('setDcStatus').textContent) && !/does not answer/.test(el('setDcStatus').textContent)
      && el('setDcStatus').classList.contains('ds-err') && !el('setDcAgain').hidden);
    reloads = 0;
    el('setDcAgain').click();
    ok('…which shows its fingerprint to compare', await until(() => !el('setDcCompare').hidden) && el('setDcFp').textContent === OTHER_FP);
    el('setDcTrust').click();
    ok('…and pins it', await until(() => reloads === 1) && host.pin === OTHER_FP && !host.untrusted);
    closeSettings();

    // ---- The retry wait after the server answers again ----
    host.offline = true;
    DC.state.retryMs = 40;
    await restart();
    ok('a server that does not answer: tried again, waiting longer each time', T.state.status === 'unreachable' && await until(() => DC.state.retryMs >= 320), String(DC.state.retryMs));
    host.offline = false;
    ok('…it answers again', await until(() => T.state.status !== 'unreachable' && T.state.status !== 'checking', 300), T.state.status);
    ok('…and the next outage starts from 5 s again', DC.state.retryMs === 5000, String(DC.state.retryMs));
    host.url = 'https://topo.example.com'; host.pin = '';
    clearTimeout(DC.state.retry);

    // ---- Spanish ----
    host.url = ''; host.pin = '';
    localStorage.removeItem(DC.MIRROR_KEY);
    try { sessionStorage.removeItem('topo-desktop-client-reloaded'); } catch (e) { /* fine */ }
    await restart();
    setLocale('es'); applyLocale('es'); await settle();
    openSettings('server'); await settle();
    ok('Spanish', el('setDcHead').textContent === 'Conectar a un servidor Topo' && el('setDcConnect').textContent === 'Conectar' && /^No conectado/.test(el('setDcStatus').textContent),
      el('setDcHead').textContent + ' / ' + el('setDcStatus').textContent);
    ok('an error code in Spanish', DC.dcErrText('needs-https').startsWith('El servidor de otro PC necesita https'));
    setLocale('en'); applyLocale('en'); await settle();
    closeSettings();
  } catch (e) {
    ok('suite ran to the end', false, String(e && e.stack || e));
  }
  Object.assign(DC.state, { invoke: null, Channel: null, reload: null });
  try { localStorage.removeItem(DC.MIRROR_KEY); } catch (e) { /* fine */ }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 300); });
