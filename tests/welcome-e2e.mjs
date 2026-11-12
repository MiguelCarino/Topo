// Setup, the first-run welcome, with real page loads (docs/SCOPE.md
// D141-D143, D170, D326-D336, D352-D357; js/welcome.js).
// tests/suites/welcome.js covers the steps with the way in set by hand; this
// loads real addresses in Chromium:
//
//   node tests/welcome-e2e.mjs [--shots <dir>]
//
// The page is served by Playwright (page.route on http://localhost:8399, a
// secure context with no socket opened). Each load is a fresh browser
// context: no done mark, nothing in the library. Covered:
//   1. not shown, and no mark written, for a real '#setup', '#provider',
//      '#simple', '#imagenology', '?profile=imagenology', '?simple', a real
//      share link (made by the page's own buildShareLink) and this test
//      runner's '?lang=en#advanced';
//   2. a plain start (index.html?lang=en, no fragment) at 360, 390 and 1280,
//      in Gold and Colourful: shown over the landing; every step with no
//      sideways scroll and the card on screen, 44px targets on a phone; Skip
//      through to the end leaves the landing up and writes the mark; a reload
//      does not show it again;
//   3. the desktop app (window.__TAURI__ stubbed, kept across reloads in
//      sessionStorage; the server is the in-page fake server) at 360, 390
//      and 1280 in Gold and Colourful: Connect to a Topo server (the address,
//      the certificate compared, the real reload, Setup going on at the
//      sign-in, Back showing the server, the code step, Skip, the end, Finish,
//      not shown after a reload) and Make this PC the server (the owner's
//      step for this PC and for other PCs, the wait, the real reload, the
//      owner's email filled in, the code the app fetched from its own server
//      with its key (D358), the
//      recovery key, signed in as the owner, the end), every step with no
//      sideways scroll and the card on screen, 44px targets on a phone;
//   4. no console error anywhere. --shots saves a picture of each step.
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8399';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const args = process.argv.slice(2);
const shotsAt = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shotsAt) await mkdir(shotsAt, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS ::', name); } else { fail++; console.log('FAIL ::', name, extra ? ':: ' + extra : ''); } };

async function route(ctx) {
  await ctx.route(ORIGIN + '/**', async (r) => {
    const path = decodeURIComponent(new URL(r.request().url()).pathname);
    const file = resolvePath(ROOT, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(ROOT + sep)) return r.fulfill({ status: 403, body: 'no' });
    try { r.fulfill({ status: 200, body: await readFile(file), headers: { 'content-type': MIME[extname(file)] || 'application/octet-stream' } }); }
    catch { r.fulfill({ status: 404, body: 'not found' }); }
  });
}
const errors = [];
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
}
// Boot has ended (the chrome shown) and the welcome's atBoot has had its turn.
const booted = async (page) => {
  await page.waitForFunction(() => window.TopoWelcome && !document.body.classList.contains('chrome-pending') && document.readyState === 'complete', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
};
const mark = (page) => page.evaluate(() => localStorage.getItem('topo-welcome'));
// The open step, the page's width, the card's edges, and any target under 44px.
const measure = (page) => page.evaluate(() => {
  const sec = [...document.querySelectorAll('#welcomeDialog .wl-step')].find((x) => !x.hidden);
  const box = document.querySelector('.topo-welcome').getBoundingClientRect();
  const small = [...document.querySelectorAll('#welcomeDialog button, #welcomeDialog input, #welcomeDialog select')]
    .filter((b) => b.getClientRects().length && !b.closest('[hidden]'))
    .map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.textContent.trim().slice(0, 20), w: r.width, h: r.height, t: b.type }; })
    .filter((b) => b.t !== 'checkbox' && (b.h < 44 || b.w < 44));
  return { step: sec ? sec.dataset.step : '', sx: document.documentElement.scrollWidth, iw: innerWidth, left: box.left, right: box.right, small };
});

const browser = await chromium.launch();
try {
  // ---- 1. Links and entries never see it ----
  // A real share link, made by the page itself.
  let shareFrag = '';
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await route(ctx);
    const p = await ctx.newPage();
    watch(p, 'share-maker');
    await p.goto(ORIGIN + '/index.html?lang=en#advanced');
    await booted(p);
    const link = await p.evaluate(async () => buildShareLink('network', false, ''));
    shareFrag = String(link || '').split('#')[1] || '';
    ok('a real share link made by the page', shareFrag.length > 20, String(link).slice(0, 80));
    await ctx.close();
  }
  const ways = [
    ['this runner\'s ?lang=en#advanced', '/index.html?lang=en#advanced'],
    ['#setup (the intake)', '/index.html?lang=en#setup'],
    ['#provider', '/index.html?lang=en#provider'],
    ['#simple', '/index.html?lang=en#simple'],
    ['#imagenology', '/index.html?lang=en#imagenology'],
    ['?profile=imagenology', '/index.html?lang=en&profile=imagenology'],
    ['?simple', '/index.html?lang=en&simple'],
    ['a share link', '/index.html?lang=en#' + shareFrag],
  ];
  for (const [label, path] of ways) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await route(ctx);
    const p = await ctx.newPage();
    watch(p, label);
    await p.goto(ORIGIN + path);
    await booted(p);
    const r = await p.evaluate(() => ({ open: TopoWelcome.isOpen(), hidden: document.getElementById('welcomeDialog').hidden }));
    const m = await mark(p);
    ok(`not shown for ${label}, no mark written`, !r.open && r.hidden && m === null, JSON.stringify(r) + ' ' + m);
    await ctx.close();
  }

  // ---- 2. A plain start ----
  for (const theme of ['gold', 'color']) {
    for (const [w, h] of [[360, 780], [390, 844], [1280, 900]]) {
      const phone = w < 500;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 });
      await ctx.addInitScript((th) => { try { if (!localStorage.getItem('carino-theme')) localStorage.setItem('carino-theme', th); } catch (e) { /* none */ } }, theme);
      await route(ctx);
      const p = await ctx.newPage();
      const tag = `${theme} ${w}`;
      watch(p, tag);
      await p.goto(ORIGIN + '/index.html?lang=en');
      const shown = await p.waitForFunction(() => window.TopoWelcome && TopoWelcome.isOpen(), null, { timeout: 30000 }).then(() => true, () => false);
      ok(`${tag}: a plain first start shows the welcome over the landing`, shown && await p.evaluate(() => landingIsOpen()));
      ok(`${tag}: the theme as kept`, await p.evaluate((th) => window.CarinoTheme.current() === th, theme));
      for (const s of ['theme', 'mode', 'where', 'lock', 'start']) {
        await p.waitForTimeout(250);
        const r = await measure(p);
        ok(`${tag} ${s}: the step, no sideways scroll, the card on screen`, r.step === s && r.sx <= r.iw && r.left >= 0 && r.right <= r.iw, JSON.stringify(r));
        if (phone) ok(`${tag} ${s}: 44px targets`, r.small.length === 0, JSON.stringify(r.small));
        if (shotsAt) await p.screenshot({ path: join(shotsAt, `welcome-${theme}-${w}-${s}.png`) });
        if (s === 'mode') await p.click('#wlModes [data-mode="simple"]');
        await p.click('#wlSkip');
      }
      await p.waitForTimeout(200);
      ok(`${tag}: ended, the landing up, the mark written`, await p.evaluate(() => !TopoWelcome.isOpen() && landingIsOpen() && !!localStorage.getItem('topo-welcome')));
      await p.reload();
      await booted(p);
      ok(`${tag}: not shown again after a reload`, await p.evaluate(() => !TopoWelcome.isOpen()));
      await ctx.close();
    }
  }

  // ---- 3. The desktop app: the server, step by step (D353-D355) ----
  // window.__TAURI__ is a stand-in for the app's commands (as the suites
  // stub them), kept in this tab's sessionStorage so it survives the real
  // reload Connect makes; the server's requests go to the in-page fake
  // server (tests/fixtures/fakeserver.js), a new one after each reload.
  const appStub = () => {
    const K = 'e2e-host';
    const FP = 'A6:08:2D:50:E7:2C:E3:6B:3E:2B:0F:A0:BF:6A:CF:18:EE:68:34:75:AA:29:1A:20:C4:CD:32:3B:30:CF:7B:6C';
    const OWN = 'http://127.0.0.1:7380';
    let host = null;
    try { host = JSON.parse(sessionStorage.getItem(K)); } catch (e) { host = null; }
    if (!host) host = { url: '', pin: '', asked: false, installed: false, running: false, polls: 0, box: null, log: ['level=INFO msg="topo-server started"'],
      settings: { enabled: false, port: 7380, lan: false, ownerEmail: '', mail: 'none', smtpPort: 587, smtpSecurity: 'starttls', shareAddress: '' } };
    const save = () => { try { sessionStorage.setItem(K, JSON.stringify(host)); } catch (e) { /* none */ } };
    const info = () => ({ available: true, mode: host.installed ? 'service' : 'app', service: { supported: true, installed: host.installed }, running: host.running, error: '',
      urls: host.running ? [OWN] : [], log: host.log.slice(), lanAddresses: ['192.168.1.20'], settings: host.settings, fingerprint: '', hasSmtpPass: false });
    let fake = null;
    const getFake = () => {
      if (fake) return Promise.resolve(fake);
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'tests/fixtures/fakeserver.js';
        s.onload = () => { fake = window.FakeTopoServer({ ownerEmail: 'it@clinica.test' }); fake.code = '482915'; resolve(fake); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    };
    const norm = (u) => { const s = String(u || '').trim(); if (!s) return null; const w = s.includes('://') ? s : 'https://' + s; try { return new URL(w).origin; } catch (e) { return null; } };
    const invoke = async (cmd, args) => {
      args = args || {};
      if (cmd === 'server_question') return !host.asked;
      if (cmd === 'server_question_done') { host.asked = true; save(); return null; }
      if (cmd === 'server_info') { if (host.installed && !host.running && ++host.polls >= 2) host.running = true; save(); return info(); }
      if (cmd === 'server_service_install' || cmd === 'server_save') {
        const st = args.settings || {};
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(st.ownerEmail || '')) throw 'owner-email';
        if (st.mail === 'smtp' && (!st.smtpHost || !st.smtpFrom)) throw 'smtp';
        host.installed = true; host.settings = st; host.polls = 0; save(); return info();
      }
      if (cmd === 'server_start') return info();
      // This PC's own server keeps the code for the app (D358).
      if (cmd === 'server_signin_code') {
        if (!host.installed || host.settings.mail !== 'none') throw 'not-local';
        const c = host.box && args.email === host.settings.ownerEmail ? host.box : null;
        host.box = null; save();
        return c;
      }
      if (cmd === 'client_info') return { url: host.url, pin: host.pin };
      if (cmd === 'client_probe' || cmd === 'client_connect') {
        const url = norm(args.url);
        if (!url) throw 'address';
        const fp = /192\.168/.test(url) ? FP : '';
        if (cmd === 'client_probe') return { url, error: fp && args.pin !== fp ? 'untrusted' : '', fingerprint: fp };
        if (fp && args.pin !== fp) throw 'untrusted:' + fp;
        host.url = url; host.pin = args.pin || ''; save();
        return { url: host.url, pin: host.pin };
      }
      if (cmd === 'client_disconnect') { host.url = ''; host.pin = ''; save(); return { url: '', pin: '' }; }
      if (cmd === 'client_request') {
        if (!host.url) throw 'not-connected';
        const f = await getFake();
        const r = await f.fetch(args.path, { method: args.method, body: args.body || undefined, headers: { 'X-Topo': '1' } });
        if (host.url === OWN && args.path === '/api/auth/request' && r.status === 202) {
          host.box = { code: f.code, at: Date.now() }; save();
        }
        return { status: r.status, contentType: 'application/json', body: await r.text(), b64: false };
      }
      if (cmd === 'client_events') return 1;
      if (cmd === 'this_computer') return { hostname: 'recepcion-pc', os: 'Fedora Linux 44', platform: 'linux', gateways: [], dns: [], interfaces: [] };
      return null;
    };
    class Channel { constructor() { this.onmessage = null; } }
    window.__TAURI__ = { core: { invoke, Channel } };
  };
  const stepOf = (p) => p.evaluate(() => (window.TopoWelcome ? TopoWelcome.step() : ''));
  const waitStep = (p, s, ms = 20000) => p.waitForFunction((x) => window.TopoWelcome && TopoWelcome.isOpen() && TopoWelcome.step() === x, s, { timeout: ms }).then(() => true, () => false);
  const look = async (p, tag, s, phone) => {
    await p.waitForTimeout(200);
    const r = await measure(p);
    ok(`${tag} ${s}: the step, no sideways scroll, the card on screen`, r.step === s && r.sx <= r.iw && r.left >= 0 && r.right <= r.iw, JSON.stringify(r));
    if (phone) ok(`${tag} ${s}: 44px targets`, r.small.length === 0, JSON.stringify(r.small));
    if (shotsAt) await p.screenshot({ path: join(shotsAt, `setup-${tag.replace(/\s+/g, '-')}-${s}.png`) });
  };
  for (const theme of ['gold', 'color']) {
    for (const [w, h] of [[360, 780], [390, 844], [1280, 900]]) {
      const phone = w < 500;
      // Connect to a Topo server.
      {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 });
        await ctx.addInitScript((th) => { try { if (!localStorage.getItem('carino-theme')) localStorage.setItem('carino-theme', th); } catch (e) { /* none */ } }, theme);
        await ctx.addInitScript(appStub);
        await route(ctx);
        const p = await ctx.newPage();
        const tag = `app connect ${theme} ${w}`;
        watch(p, tag);
        await p.goto(ORIGIN + '/index.html?lang=en');
        ok(`${tag}: Setup shown on the app's plain first start`, await waitStep(p, 'theme', 30000) && await p.evaluate((th) => window.CarinoTheme.current() === th, theme));
        await p.click('#wlSkip'); await p.click('#wlSkip');
        await p.click('#wlWhereApp [data-where="connect"]');
        await look(p, tag, 'where', phone);
        await p.click('#wlNext');
        await waitStep(p, 'srvAddr');
        await look(p, tag, 'srvAddr', phone);
        await p.fill('#wlSrvUrl', '192.168.1.20:7380');
        await p.click('#wlNext');
        ok(`${tag}: the certificate to compare`, await waitStep(p, 'srvCompare') && await p.evaluate(() => document.getElementById('wlSrvFp').textContent.length === 95));
        await look(p, tag, 'srvCompare', phone);
        await p.click('#wlNext');
        // The real reload: Setup goes on at the sign-in.
        ok(`${tag}: after the window's reload, Setup goes on at the sign-in`, await waitStep(p, 'srvEmail', 30000)
          && await p.evaluate(() => CarinoDesktopClient.connectedTo() === 'https://192.168.1.20:7380' && !localStorage.getItem('topo-welcome')));
        await look(p, tag, 'srvEmail', phone);
        await p.click('#wlBack');
        ok(`${tag}: Back shows the server this window is connected to`, await waitStep(p, 'where') && await p.evaluate(() => !document.getElementById('wlWhereOn').hidden));
        await look(p, tag, 'where', phone);
        await p.click('#wlNext');
        await waitStep(p, 'srvEmail');
        await p.fill('#wlSrvEmail', 'ana@clinica.test');
        await p.click('#wlNext');
        ok(`${tag}: the code step`, await waitStep(p, 'srvCode'));
        await look(p, tag, 'srvCode', phone);
        await p.click('#wlSkip');
        ok(`${tag}: Skip ends the walk, the lock next`, await waitStep(p, 'lock'));
        await p.click('#wlSkip');
        await waitStep(p, 'pc');
        await p.click('#wlSkip');
        ok(`${tag}: the end says this window is connected`, await waitStep(p, 'start') && await p.evaluate(() => /connected to https:\/\/192\.168\.1\.20:7380\. Sign in/.test(document.getElementById('wlHandoffText').textContent)));
        await look(p, tag, 'start', phone);
        await p.click('#wlHandoffGo');
        await p.waitForTimeout(200);
        ok(`${tag}: Finish ends Setup, the mark written`, await p.evaluate(() => !TopoWelcome.isOpen() && !!localStorage.getItem('topo-welcome')));
        await p.reload();
        await booted(p);
        ok(`${tag}: not shown again after a reload`, await p.evaluate(() => !TopoWelcome.isOpen()));
        await ctx.close();
      }
      // Make this PC the server.
      {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 });
        await ctx.addInitScript((th) => { try { if (!localStorage.getItem('carino-theme')) localStorage.setItem('carino-theme', th); } catch (e) { /* none */ } }, theme);
        await ctx.addInitScript(appStub);
        await route(ctx);
        const p = await ctx.newPage();
        const tag = `app server ${theme} ${w}`;
        watch(p, tag);
        await p.goto(ORIGIN + '/index.html?lang=en');
        await waitStep(p, 'theme', 30000);
        await p.click('#wlSkip'); await p.click('#wlSkip');
        await p.click('#wlWhereApp [data-where="server"]');
        await p.click('#wlNext');
        ok(`${tag}: the owner's step`, await waitStep(p, 'srvOwner'));
        await look(p, tag, 'srvOwner', phone);
        await p.selectOption('#wlSrvWho', 'lan');
        await look(p, tag, 'srvOwner', phone);
        await p.selectOption('#wlSrvWho', 'pc');
        await p.fill('#wlSrvOwner', 'it@clinica.test');
        await p.click('#wlNext');
        ok(`${tag}: set up, then the wait`, await waitStep(p, 'srvWait'));
        await look(p, tag, 'srvWait', phone);
        ok(`${tag}: once it runs, the window reloads as its client and Setup goes on at the sign-in`, await waitStep(p, 'srvEmail', 30000)
          && await p.evaluate(() => CarinoDesktopClient.connectedTo() === 'http://127.0.0.1:7380' && document.getElementById('wlSrvEmail').value === 'it@clinica.test'));
        await look(p, tag, 'srvEmail', phone);
        await p.click('#wlNext');
        ok(`${tag}: the code fetched from this PC's own server with the app's key`, await waitStep(p, 'srvCode')
          && await p.waitForFunction(() => document.getElementById('wlSrvCode').value === '482915', null, { timeout: 15000 }).then(() => true, () => false));
        await look(p, tag, 'srvCode', phone);
        await p.click('#wlNext');
        // The owner's first sign-in: the recovery key, as at any sign-in.
        const sheet = await p.waitForSelector('#serverSheetBody [data-k="tick"]', { timeout: 20000 }).then(() => true, () => false);
        if (sheet) { await p.check('#serverSheetBody [data-k="tick"]'); await p.click('#serverSheetBody button.primary'); }
        ok(`${tag}: signed in as the owner (the recovery key kept), then the lock`, sheet && await waitStep(p, 'lock')
          && await p.evaluate(() => TopoServer.state.status === 'ready' && TopoServer.me().email === 'it@clinica.test'));
        await p.click('#wlSkip');
        await waitStep(p, 'pc');
        await p.click('#wlSkip');
        ok(`${tag}: the end: connected and signed in`, await waitStep(p, 'start') && await p.evaluate(() => /signed in as it@clinica\.test/.test(document.getElementById('wlHandoffText').textContent)));
        await look(p, tag, 'start', phone);
        await p.click('#wlHandoffGo');
        await p.waitForTimeout(200);
        ok(`${tag}: Finish ends Setup, the mark written`, await p.evaluate(() => !TopoWelcome.isOpen() && !!localStorage.getItem('topo-welcome')));
        await ctx.close();
      }
    }
  }
  ok('no console error', errors.length === 0, errors.slice(0, 4).join(' | '));
} finally {
  await browser.close();
}
console.log(`${pass + fail} checks, ${fail} failing`);
process.exit(fail ? 1 : 0);
