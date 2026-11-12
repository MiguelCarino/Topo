// The idle lock, end to end with real reloads (docs/SCOPE.md D165, D214,
// D215; js/idlelock.js). tests/suites/idlelock.js covers the cover and the
// PIN with the reload stubbed; this is the reload itself, in Chromium:
//
//   node tests/idlelock-e2e.mjs [--shots <dir>]
//
// The page is served by Playwright (page.route on http://localhost:8399, a
// secure context with no socket opened). Covered:
//   1. a kept network with an edit, a PIN set (the real 600,000 rounds), then
//      the idle time passing (Playwright's clock): the page reloads locked;
//   2. the locked page holds nothing: no devices, no library cards, no undo
//      steps, nothing of the network in the page's text; the cover only;
//   3. a wrong PIN, then the right one: the network comes back, edit and
//      card and all, and the Report a problem draft reopens;
//   4. a network that is not kept (an example) comes back from the tab;
//   5. two tabs: B opens while locked and boots locked; A locks, B follows;
//      B unlocks, A follows;
//   6. Off: the time passes and nothing locks;
//   7. at 360, 390 and 1280, Gold and Colourful: the cover and Settings
//      (Screen lock) with no sideways scroll; no console error anywhere.
//      --shots saves a picture of each.
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8399';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const args = process.argv.slice(2);
const shotsAt = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;

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
const booted = (page) => page.waitForFunction(() => window.TopoLock && !document.body.classList.contains('chrome-pending'), null, { timeout: 30000 });
const lockedUp = (page) => page.waitForFunction(() => document.documentElement.classList.contains('topo-locked') && !document.getElementById('lockCover').hidden && document.readyState === 'complete', null, { timeout: 30000 });

const browser = await chromium.launch();
try {
  // ---- 1-3: idle time, the reload, the PIN ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await route(ctx);
  const a = await ctx.newPage();
  watch(a, 'A');
  await a.clock.install();
  await a.goto(ORIGIN + '/index.html?lang=en#advanced');
  await booted(a);
  const cardId = await a.evaluate(async () => {
    replaceDocument(templatesData.house, { origin: 'default' });
    const id = claimDocument('Idle lock E2E', null);
    state.nodes[0].name = 'E2E-edited-node'; save();
    await TopoLock.setPin('246810');
    TopoIncidents.openProblemDialog();
    document.getElementById('problemText').value = 'Draft before the lock';
    return id;
  });
  ok('a kept network and a PIN', !!cardId && await a.evaluate(() => TopoLock.hasPin() && TopoLock.lockAfterMin() === 30));
  const nav = a.waitForEvent('load', { timeout: 30000 });
  await a.clock.fastForward('29:00');
  ok('not locked at 29 min', await a.evaluate(() => !TopoLock.isLocked()));
  await a.clock.fastForward('02:00');
  await nav;
  await lockedUp(a);
  ok('at 30 min the page reloaded locked', await a.evaluate(() => TopoLock.isLocked() && TopoLock._state().gated));
  const held = await a.evaluate(() => ({
    nodes: state.nodes.length, cards: libraryEntries().length, undo: typeof _undoStack !== 'undefined' ? _undoStack.length : -1,
    text: document.body.innerText, title: document.getElementById('lockTitle').textContent,
    landing: !document.getElementById('landing').classList.contains('hidden'),
    pinShown: !document.getElementById('lockPinRow').hidden
  }));
  ok('the locked page holds no devices, no cards, no undo steps', held.nodes === 0 && held.cards === 0 && held.undo <= 0, JSON.stringify({ n: held.nodes, c: held.cards, u: held.undo }));
  ok('nothing of the network in the page\'s text', !/E2E-edited-node|Idle lock E2E|Draft before the lock/.test(held.text));
  ok('the cover asks for the PIN', held.title === 'Topo is locked' && held.pinShown);
  await a.fill('#lockPin', '000000'); await a.click('#lockPinBtn');
  await a.waitForFunction(() => /Wrong PIN/.test(document.getElementById('lockMsg').textContent), null, { timeout: 20000 });
  ok('a wrong PIN keeps it locked', await a.evaluate(() => TopoLock.isLocked() && TopoLock.fails() === 1));
  await a.fill('#lockPin', '246810'); await a.click('#lockPinBtn');
  await a.waitForFunction(() => !TopoLock.isLocked() && state.nodes.length > 0, null, { timeout: 30000 });
  const back = await a.evaluate(() => ({ id: state.libraryId, has: state.nodes.some((n) => n.name === 'E2E-edited-node'), fails: TopoLock.fails() }));
  ok('the right PIN brings the network back, edit and card', back.id === cardId && back.has && back.fails === 0, JSON.stringify(back));
  await a.waitForFunction(() => !document.getElementById('problemDialog').hidden, null, { timeout: 10000 });
  ok('and the Report a problem draft reopens', await a.evaluate(() => document.getElementById('problemText').value === 'Draft before the lock'));
  await a.evaluate(() => TopoIncidents.closeProblemDialog());

  // ---- 4: a network that is not kept ----
  await a.evaluate(() => { replaceDocument(templatesData.house, { origin: 'default' }); state.nodes[0].name = 'Unkept-node'; save(); });
  ok('(an example, not kept)', await a.evaluate(() => !state.libraryId));
  let n2 = a.waitForEvent('load');
  await a.evaluate(() => TopoLock.lock('now'));
  await n2; await lockedUp(a);
  ok('locked: the unkept network is not in the page', await a.evaluate(() => state.nodes.length === 0 && !/Unkept-node/.test(document.body.innerText)));
  await a.fill('#lockPin', '246810'); await a.click('#lockPinBtn');
  await a.waitForFunction(() => !TopoLock.isLocked() && state.nodes.length > 0, null, { timeout: 30000 });
  ok('it comes back from the tab after the unlock', await a.evaluate(() => state.nodes.some((n) => n.name === 'Unkept-node') && !state.libraryId));

  // ---- 5: two tabs ----
  const b = await ctx.newPage();
  watch(b, 'B');
  await b.goto(ORIGIN + '/index.html?lang=en#advanced');
  await booted(b);
  ok('B opens unlocked', await b.evaluate(() => !TopoLock.isLocked()));
  const na = a.waitForEvent('load'), nb = b.waitForEvent('load');
  await a.evaluate(() => TopoLock.lock('now'));
  await na; await nb;
  await lockedUp(a); await lockedUp(b);
  ok('A locks and B follows (both reloaded, locked)', await b.evaluate(() => TopoLock.isLocked() && state.nodes.length === 0));
  const c = await ctx.newPage();
  watch(c, 'C');
  await c.goto(ORIGIN + '/index.html?lang=en#advanced');
  await lockedUp(c);
  ok('a tab opened while locked boots locked and reads nothing', await c.evaluate(() => TopoLock.isLocked() && state.nodes.length === 0 && libraryEntries().length === 0));
  await c.close();
  await b.fill('#lockPin', '246810'); await b.click('#lockPinBtn');
  await b.waitForFunction(() => !TopoLock.isLocked(), null, { timeout: 30000 });
  await a.waitForFunction(() => !TopoLock.isLocked() && state.nodes.length > 0, null, { timeout: 30000 });
  ok('B unlocks and A follows, its network back', await a.evaluate(() => state.nodes.some((n) => n.name === 'Unkept-node')));
  await b.close();

  // ---- 6: Off ----
  await a.evaluate(() => TopoLock.setLockAfterMin(0));
  await a.clock.fastForward('03:00:00');
  ok('Off: three hours pass and nothing locks', await a.evaluate(() => !TopoLock.isLocked()));
  await a.evaluate(() => { TopoLock.setLockAfterMin(30); TopoLock.removePin(); });
  await ctx.close();

  // ---- 7: the look, at three widths and in both themes ----
  if (shotsAt) await mkdir(shotsAt, { recursive: true });
  for (const theme of ['gold', 'color']) {
    for (const [w, h] of [[360, 780], [390, 844], [1280, 860]]) {
      const cx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 640 ? 2 : 1, hasTouch: w < 640, isMobile: w < 640 });
      await route(cx);
      const p = await cx.newPage();
      watch(p, `${theme}@${w}`);
      await p.goto(`${ORIGIN}/index.html?lang=en&theme=${theme}#advanced`);
      await booted(p);
      await p.evaluate(async () => { await TopoLock.setPin('1234'); openSettings(); });
      await p.evaluate(() => document.getElementById('setLockSec').scrollIntoView());
      await p.waitForTimeout(250);
      const sw = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sec: document.getElementById('setLockSec').getBoundingClientRect().width }));
      ok(`Settings, Screen lock, ${theme} @${w}: no sideways scroll`, sw.sw <= sw.iw && sw.sec > 0, JSON.stringify(sw));
      if (shotsAt) await p.screenshot({ path: join(shotsAt, `settings-${theme}-${w}.png`) });
      const nl = p.waitForEvent('load');
      await p.evaluate(() => TopoLock.lock('now'));
      await nl; await lockedUp(p);
      await p.waitForTimeout(250);
      const cv = await p.evaluate(() => {
        const card = document.querySelector('.lock-card').getBoundingClientRect();
        const btn = document.getElementById('lockPinBtn').getBoundingClientRect();
        const pin = document.getElementById('lockPin');
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, l: card.left, r: card.right, bh: btn.height, fs: parseFloat(getComputedStyle(pin).fontSize), ph: pin.getBoundingClientRect().height,
          bg: getComputedStyle(document.getElementById('lockCover')).backgroundColor, theme: document.documentElement.getAttribute('data-carino-theme'),
          mark: [...document.querySelectorAll('.lock-mark img')].filter((i) => getComputedStyle(i).display !== 'none').map((i) => i.getAttribute('src')) };
      });
      ok(`the cover, ${theme} @${w}: inside the screen, no sideways scroll`, cv.sw <= cv.iw && cv.l >= 0 && cv.r <= cv.iw, JSON.stringify(cv));
      ok(`the cover, ${theme} @${w}: 44px targets, a 16px field`, cv.bh >= 44 && cv.ph >= 44 && cv.fs >= 16, JSON.stringify(cv));
      ok(`the cover, ${theme} @${w}: the theme's own mark`, cv.theme === theme && cv.mark.length === 1 && cv.mark[0] === (theme === 'gold' ? 'logo.svg' : 'logo-color.svg'), JSON.stringify(cv.mark));
      if (shotsAt) await p.screenshot({ path: join(shotsAt, `cover-${theme}-${w}.png`) });
      await p.fill('#lockPin', '1234'); await p.click('#lockPinBtn');
      await p.waitForFunction(() => !TopoLock.isLocked(), null, { timeout: 30000 });
      await cx.close();
    }
  }
  ok('no console error on any page', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (e) {
  ok('the run reached the end', false, String(e && e.stack || e).slice(0, 400));
} finally {
  await browser.close();
}
console.log(`---\n${pass + fail} checks, ${fail} failing`);
process.exit(fail ? 1 : 0);
