// The first-run welcome with real page loads (docs/SCOPE.md D141-D143, D170,
// D326-D336; js/welcome.js). tests/suites/welcome.js covers the steps with
// the way in set by hand; this loads real addresses in Chromium:
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
//   3. no console error anywhere. --shots saves a picture of each step.
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
        const r = await p.evaluate(() => {
          const sec = [...document.querySelectorAll('#welcomeDialog .wl-step')].find((x) => !x.hidden);
          const box = document.querySelector('.topo-welcome').getBoundingClientRect();
          const small = [...document.querySelectorAll('#welcomeDialog button, #welcomeDialog input, #welcomeDialog select')]
            .filter((b) => b.getClientRects().length && !b.closest('[hidden]'))
            .map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.textContent.trim().slice(0, 20), w: r.width, h: r.height, t: b.type }; })
            .filter((b) => b.t !== 'checkbox' && (b.h < 44 || b.w < 44));
          return { step: sec ? sec.dataset.step : '', sx: document.documentElement.scrollWidth, iw: innerWidth, left: box.left, right: box.right, small };
        });
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
  ok('no console error', errors.length === 0, errors.slice(0, 4).join(' | '));
} finally {
  await browser.close();
}
console.log(`${pass + fail} checks, ${fail} failing`);
process.exit(fail ? 1 : 0);
