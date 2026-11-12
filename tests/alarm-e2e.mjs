// The alarm card window (desktop/alarm.html; docs/SCOPE.md D130, D160,
// D172, step 7g) in Chromium, as the desktop app stages it
// (desktop/stage.sh --desktop), with the app's commands stubbed:
//
//   node tests/alarm-e2e.mjs [--shots <dir>]
//
// The staged copy is served by Playwright (page.route on
// http://localhost:8399, no socket opened). Covered:
//   1. at 360, 390 and 1280, in Gold and Colourful, in every language: the
//      title, the device, how long, the chain behind it, "Checked by
//      monitor <PC>", the three buttons translated (Japanese says PC); no
//      sideways scroll, every button at least 44 px, nothing cut off;
//   2. Escape is Later; Later answers "later";
//   3. Acknowledge opens the note, a second press sends it ("ack" with it);
//   4. locked (js/idlelock.js's key in this origin's storage): the card still
//      names the device, says it will ask to unlock, and Acknowledge and
//      Report a problem are handed to Topo's window ("alarm_hand", locked);
//   5. Report a problem is always handed over; the drill is marked DRILL and
//      its buttons only close it;
//   6. the chime: one Web Audio context when the app says so, none
//      otherwise; nothing touches a volume;
//   7. the app's refresh event shows the next card; a device answering again
//      reads "Answering again since";
//   8. the app's window (the staged index.html, the same stub): an outage
//      folded from a record, its row in the Problems tab and Settings' Show
//      alarms on this PC at 360, 390 and 1280, in Gold and Colourful, with
//      no sideways scroll;
//   9. no console error anywhere.
import { chromium } from 'playwright';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, extname, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8399';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const args = process.argv.slice(2);
const shotsAt = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS ::', name); } else { fail++; console.log('FAIL ::', name, extra ? ':: ' + extra : ''); } };

const tmp = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'topo-alarm-'));
const ROOT = join(tmp, 'dist');
const st = spawnSync('bash', [join(REPO, 'desktop', 'stage.sh'), ROOT, '--desktop'], { encoding: 'utf8' });
ok('the desktop stage (with the card) passes its own checks', st.status === 0, (st.stderr || '').slice(0, 300));

async function route(ctx) {
  await ctx.route(ORIGIN + '/**', async (r) => {
    const path = decodeURIComponent(new URL(r.request().url()).pathname);
    const file = resolvePath(ROOT, '.' + path);
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

// The app's side, in the page: alarm_current answers window.__views[0];
// every call is kept in window.__calls; listen keeps the refresh handler.
const STUB = () => {
  window.__calls = [];
  window.__audio = 0;
  const RealAC = window.AudioContext;
  window.AudioContext = function () { window.__audio++; return new RealAC(); };
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, a) => {
        window.__calls.push({ cmd, args: JSON.parse(JSON.stringify(a || {})) });
        if (cmd === 'alarm_current') return (window.__views || [])[0] || null;
        return null;
      }
    },
    event: { listen: async (name, cb) => { if (name === 'topo-alarm') window.__refresh = cb; return () => {}; } }
  };
};
const NOW = Date.UTC(2026, 10, 11, 10, 42);
const viewOf = (o = {}) => Object.assign({ id: 'inabcdefghij', drill: false, name: 'Router R1', since: NOW - 14 * 60000, now: NOW, behind: 12,
  behindNames: ['Core switch', 'Front printer', 'Camera 3'], monitor: 'FRONT-DESK', recovered: null, flapping: false, more: 0, lang: 'en', chime: false }, o);

const WORDS = {
  en: { title: 'NOT ANSWERING', ack: 'Acknowledge', report: 'Report a problem', later: 'Later', by: 'Checked by monitor FRONT-DESK', head: 'Router R1 and 12 devices behind it', time: 'Not answering for 14 min' },
  es: { title: 'NO RESPONDE', ack: 'Enterado', report: 'Reportar un problema', later: 'Más tarde', by: 'Comprobado por el monitor FRONT-DESK', head: 'Router R1 y 12 dispositivos detrás', time: 'No responde desde hace 14 min' },
  'pt-BR': { title: 'SEM RESPOSTA', ack: 'Ciente', report: 'Relatar um problema', later: 'Mais tarde', by: 'Verificado pelo monitor FRONT-DESK', head: 'Router R1 e 12 dispositivos atrás dele', time: 'Sem resposta há 14 min' },
  ja: { title: '応答なし', ack: '確認しました', report: '問題を報告', later: '後で', by: '監視 PC FRONT-DESK が確認', head: 'Router R1 とその先の 12 台の機器', time: '14 分前から応答なし' },
  ru: { title: 'НЕ ОТВЕЧАЕТ', ack: 'Принято', report: 'Сообщить о проблеме', later: 'Позже', by: 'Проверено монитором FRONT-DESK', head: 'Router R1 и ещё устройств за ним: 12', time: 'Не отвечает уже 14 мин' }
};

async function open(ctx, view, opts = {}) {
  const page = await ctx.newPage();
  watch(page, `${opts.tag || 'card'}`);
  await page.addInitScript(STUB);
  await page.addInitScript(([v, o]) => {
    window.__views = [v];
    try {
      if (o.theme === 'color') localStorage.setItem('carino-theme', 'color'); else localStorage.removeItem('carino-theme');
      if (o.locked) localStorage.setItem('topo-lock', JSON.stringify({ at: 1, why: 'idle', user: null })); else localStorage.removeItem('topo-lock');
    } catch (e) { /* none */ }
  }, [view, opts]);
  await page.clock.install({ time: NOW });
  await page.goto(ORIGIN + '/alarm.html');
  await page.waitForFunction(() => window.TopoAlarmCard && TopoAlarmCard.state().view, null, { timeout: 15000 });
  return page;
}
const calls = (page, cmd) => page.evaluate((c) => window.__calls.filter((x) => x.cmd === c).map((x) => x.args), cmd);

const browser = await chromium.launch();
try {
  // ---- 1: every size, theme and language ----
  for (const width of [360, 390, 1280]) {
    for (const theme of ['gold', 'color']) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 740 : 860 } });
      await route(ctx);
      for (const lang of Object.keys(WORDS)) {
        const w = WORDS[lang];
        const page = await open(ctx, viewOf({ lang, name: 'Router R1' }), { theme, tag: `${width}/${theme}/${lang}` });
        const got = await page.evaluate(() => {
          const $ = (id) => document.getElementById(id);
          const btns = ['ack', 'report', 'later'].map((id) => $(id).getBoundingClientRect());
          return {
            title: $('title').textContent, head: $('head').textContent, time: $('time').textContent, by: $('by').textContent,
            chain: $('chain').textContent, ack: $('ack').textContent, report: $('report').textContent, later: $('later').textContent,
            lang: document.documentElement.lang, theme: document.documentElement.getAttribute('data-carino-theme'),
            sideways: document.documentElement.scrollWidth > innerWidth,
            small: btns.filter((r) => r.height < 44 || r.width < 44).length,
            outside: btns.filter((r) => r.left < 0 || r.right > innerWidth + 0.5).length,
            focus: document.activeElement && document.activeElement.id
          };
        });
        const tag = `${width} ${theme} ${lang}`;
        ok(`${tag}: the card in its language`, got.title === w.title && got.head === w.head && got.time === w.time && got.by === w.by
          && got.ack === w.ack && got.report === w.report && got.later === w.later && got.lang === lang, JSON.stringify(got));
        ok(`${tag}: the chain behind it, no sideways scroll, 44 px buttons inside the screen`, /Core switch, Front printer, Camera 3, …/.test(got.chain)
          && !got.sideways && got.small === 0 && got.outside === 0, JSON.stringify(got));
        if (lang === 'en') ok(`${tag}: the theme read, Acknowledge focused`, (theme === 'color' ? got.theme === 'color' : got.theme === null) && got.focus === 'ack', JSON.stringify(got));
        if (shotsAt) { await mkdir(shotsAt, { recursive: true }); await page.screenshot({ path: join(shotsAt, `alarm-${width}-${theme}-${lang}.png`) }); }
        await page.close();
      }
      await ctx.close();
    }
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 740 } });
  await route(ctx);

  // ---- 2: Escape and Later ----
  let page = await open(ctx, viewOf());
  await page.keyboard.press('Escape');
  ok('Escape is Later', JSON.stringify(await calls(page, 'alarm_answer')) === JSON.stringify([{ id: 'inabcdefghij', answer: 'later' }]));
  await page.click('#later');
  ok('Later answers later', (await calls(page, 'alarm_answer')).length === 2 && (await calls(page, 'alarm_answer'))[1].answer === 'later');
  ok('no chime when the app says none', await page.evaluate(() => window.__audio) === 0);
  await page.close();

  // ---- 3: Acknowledge with a note ----
  page = await open(ctx, viewOf({ chime: true }));
  ok('the chime plays once when the app says so', await page.evaluate(() => window.__audio) === 1);
  ok('…and nothing in the page touches a volume', !(await readFile(join(REPO, 'desktop', 'alarm.html'), 'utf8')).match(/volume\s*=|setVolume|speechSynthesis/));
  await page.click('#ack');
  ok('Acknowledge first opens the note', await page.evaluate(() => !document.getElementById('noterow').hidden && document.activeElement.id === 'note')
    && (await calls(page, 'alarm_answer')).length === 0);
  await page.fill('#note', 'Calling the ISP');
  await page.keyboard.press('Enter');
  ok('…then sends it', JSON.stringify(await calls(page, 'alarm_answer')) === JSON.stringify([{ id: 'inabcdefghij', answer: 'ack', note: 'Calling the ISP' }]));
  ok('the note row has no sideways scroll at 390', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.click('#report');
  ok('Report a problem is handed to Topo\'s window', JSON.stringify((await calls(page, 'alarm_hand')).pop()) === JSON.stringify({ id: 'inabcdefghij', act: 'report', locked: false }));
  await page.close();

  // ---- 4: locked ----
  page = await open(ctx, viewOf({ name: 'Front printer', behind: 0, behindNames: [] }), { locked: true });
  const lk = await page.evaluate(() => ({ head: document.getElementById('head').textContent, line: document.getElementById('lockline').hidden ? '' : document.getElementById('lockline').textContent,
    chain: document.getElementById('chain').hidden }));
  ok('locked: the card still names the device', lk.head === 'Front printer' && lk.chain === true);
  ok('…and says it will ask to unlock', /unlock it first/.test(lk.line), lk.line);
  await page.click('#ack');
  ok('…Acknowledge is handed over, to unlock first', JSON.stringify((await calls(page, 'alarm_hand')).pop()) === JSON.stringify({ id: 'inabcdefghij', act: 'ack', locked: true })
    && await page.evaluate(() => document.getElementById('noterow').hidden));
  await page.click('#report');
  ok('…and so is Report a problem', (await calls(page, 'alarm_hand')).pop().act === 'report');
  await page.keyboard.press('Escape');
  ok('…Later needs no unlock', (await calls(page, 'alarm_answer')).pop().answer === 'later');
  await page.close();

  // ---- 5: the drill ----
  page = await open(ctx, { id: 'drill', drill: true, name: '', since: NOW - 180000, now: NOW, behind: 0, behindNames: [], monitor: 'FRONT-DESK', recovered: null, flapping: false, more: 0, lang: 'es', chime: true });
  const dr = await page.evaluate(() => ({ drill: document.getElementById('drill').hidden ? '' : document.getElementById('drill').textContent, head: document.getElementById('head').textContent,
    extra: document.getElementById('extra').textContent }));
  ok('the drill is marked DRILL, in the language asked', dr.drill === 'SIMULACRO · ESTO ES UNA PRUEBA' && dr.head === 'Prueba de la alarma' && /Nada está caído/.test(dr.extra), JSON.stringify(dr));
  await page.click('#report');
  await page.click('#ack');
  ok('…its buttons only close it', (await calls(page, 'alarm_hand')).length === 0 && (await calls(page, 'alarm_answer')).map((a) => a.answer).join() === 'later,ack');
  await page.close();

  // ---- 7: the next card, answering again ----
  page = await open(ctx, viewOf({ more: 2, flapping: true }));
  ok('more waiting and flapping are said', /2 more not answering/.test(await page.textContent('#extra')) && /flapping/.test(await page.textContent('#extra')));
  await page.evaluate((v) => { window.__views = [v]; window.__refresh(); }, viewOf({ id: 'inzzzzzzzzzz', name: 'NAS', behind: 0, behindNames: [], recovered: NOW - 60000 }));
  await page.waitForFunction(() => TopoAlarmCard.state().view.id === 'inzzzzzzzzzz');
  ok('the refresh shows the next card; answering again is said', (await page.textContent('#head')) === 'NAS' && /^Answering again since /.test(await page.textContent('#time')));
  await page.close();
  // The duration keeps running on a card still down (tick, every 15 s).
  page = await open(ctx, viewOf());
  const t0 = await page.textContent('#time');
  await page.clock.fastForward('16:00');
  const t1 = await page.textContent('#time');
  ok('the time down keeps running on the card', t0 === 'Not answering for 14 min' && t1 === 'Not answering for 30 min', t0 + ' -> ' + t1);
  await page.close();

  // A long name wraps instead of pushing sideways at 360.
  const narrow = await browser.newContext({ viewport: { width: 360, height: 640 } });
  await route(narrow);
  page = await open(narrow, viewOf({ name: 'Very-long-device-name-with-no-spaces-at-all-0123456789-abcdefghij', lang: 'ru' }));
  ok('a long name wraps at 360', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.close();
  await narrow.close();
  await ctx.close();
  // ---- 8: the app's window: the outage's row and Settings ----
  const APP_STUB = () => {
    const now = Date.now();
    window.__calls = [];
    window.__info = { on: true, running: true, elsewhere: false, retentionDays: 360, tray: true, autostart: true, networkId: '', networkName: 'HQ', count: 2,
      quiet: { site: 0, nodes: {}, groups: {} }, platform: 'linux', statsFile: '', alarms: false, monitorName: 'FRONT-DESK' };
    window.__records = [];
    const answers = {
      monitor_info: () => window.__info, monitor_set: () => window.__info, monitor_plan: () => window.__info, monitor_status: () => [],
      monitor_history: () => ({ kept: true, samples: [] }), monitor_issues: () => window.__records, monitor_issues_folded: () => 0,
      alarm_take: () => null, this_computer: () => ({ hostname: 'FRONT-DESK', interfaces: [], gateways: [], dns: [] }), client_info: () => null, server_info: () => null
    };
    window.__TAURI__ = {
      core: { invoke: async (cmd, a) => { window.__calls.push(cmd); const f = answers[cmd]; if (f) return JSON.parse(JSON.stringify(f(a))); throw new Error('not in this stub: ' + cmd); } },
      event: { listen: async () => () => {} }
    };
    window.__now = now;
  };
  for (const width of [360, 390, 1280]) {
    for (const theme of ['gold', 'color']) {
      const actx = await browser.newContext({ viewport: { width, height: width < 500 ? 740 : 860 }, hasTouch: width < 500, isMobile: width < 500 });
      await route(actx);
      const app = await actx.newPage();
      const tag = `app ${width} ${theme}`;
      watch(app, tag);
      await app.addInitScript(APP_STUB);
      await app.addInitScript((th) => { try { localStorage.setItem('carino-theme', th); } catch (e) { /* none */ } }, theme === 'color' ? 'color' : 'gold');
      await app.goto(ORIGIN + '/index.html?lang=en#advanced');
      await app.waitForFunction(() => window.TopoIssues && !document.body.classList.contains('chrome-pending'), null, { timeout: 30000 });
      const r = await app.evaluate(async () => {
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        replaceDocument({ v: DOC_VERSION, nodes: [
          { id: 'rt', type: 'router', name: 'Router R1', x: 0, y: 0, interfaces: [{ ip: '10.0.0.1/24' }], checks: [{ id: 'p', proto: 'ping' }] },
          { id: 'pr', type: 'printer', name: 'Front printer', x: 160, y: 0, interfaces: [{ ip: '10.0.0.9/24' }], checks: [{ id: 'p', proto: 'ping' }] }],
          links: [{ id: 'l1', source: 'rt', target: 'pr' }] }, { origin: 'file' });
        const id = claimDocument('HQ', null);
        window.__info.networkId = id;
        window.__records = [{ id: 'inabcdefghij', networkId: id, nodeId: 'rt', name: 'Router R1', keys: ['rt/p'], behind: ['pr'], outages: [{ from: window.__now - 14 * 60000 }],
          flapping: false, monitor: 'FRONT-DESK', acts: [], closed: null, gone: false, rev: 1 }];
        await TopoChecks.refreshInfo();
        await TopoIssues.refreshIssues();
        await TopoIssues.foldIssues();
        openIncidentsView();
        await wait(300);
        const row = document.querySelector('#incidentList .inc-row[data-inc="inabcdefghij"]');
        const rowText = row ? row.textContent : '';
        const btns = row ? [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).filter((b) => b.width > 0) : [];
        const rowSideways = document.documentElement.scrollWidth > innerWidth;
        openSettings();
        await wait(300);
        const box = document.getElementById('setAlarmBox');
        box.scrollIntoView();
        await wait(100);
        const res = { rowText, buttons: btns.length, smallButtons: btns.filter((b) => b.height < 44).length, rowSideways,
          alarmBox: !box.hidden, alarmOff: document.getElementById('setAlarmOn').checked === false,
          setSideways: document.documentElement.scrollWidth > innerWidth };
        return res;
      });
      ok(`${tag}: the outage is folded and shown in the Problems tab`, /Not answering/.test(r.rowText) && /Router R1 and 1 device behind it/.test(r.rowText) && r.buttons >= 3, JSON.stringify(r));
      ok(`${tag}: its buttons ${width < 500 ? 'at 44 px ' : ''}and no sideways scroll`, (width >= 500 || r.smallButtons === 0) && !r.rowSideways, JSON.stringify(r));
      ok(`${tag}: Settings shows Show alarms on this PC, off, with no sideways scroll`, r.alarmBox && r.alarmOff && !r.setSideways, JSON.stringify(r));
      if (shotsAt) await app.screenshot({ path: join(shotsAt, `app-settings-${width}-${theme}.png`) });
      await app.close();
      await actx.close();
    }
  }
  ok('no console error anywhere', !errors.length, errors.slice(0, 4).join(' | '));
} catch (e) {
  ok('the check ran to the end', false, String(e && e.stack || e).slice(0, 400));
} finally {
  await browser.close();
  await rm(tmp, { recursive: true, force: true });
}
console.log(`---\n${pass + fail} checks, ${fail ? fail + ' failing' : 'all passing'}`);
process.exit(fail ? 1 : 0);
