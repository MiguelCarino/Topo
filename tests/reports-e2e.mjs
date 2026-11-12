// The monitoring report (js/reports.js; docs/SCOPE.md D163, D164, step 7j)
// in Chromium, with the desktop app's commands stubbed (this PC monitors
// the open network; monitor_figures answers a week of hourly figures):
//
//   cd tests && node reports-e2e.mjs [--shots <dir>]
//
// The repository is served by Playwright (page.route on
// http://localhost:8398, no socket opened). At 360, 390 and 1280, in Gold
// and Colourful:
//   1. a device's Answer checks: the Full report link (44 px on a phone);
//   2. its report in the print preview: the choices in the left column (44
//      px on a phone), the charts and tables, Print, CSV and Download, no
//      sideways scroll on the page or past the dialog's edge;
//   3. the whole network's report for a week, then a provider's;
//   4. in every language (en, es, pt-BR, ru, ja): the report and its
//      choices translated, no {placeholder} left, Japanese never パソコン;
//   5. no console error anywhere.
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolvePath(join(dirname(fileURLToPath(import.meta.url)), '..'));
const ORIGIN = 'http://localhost:8398';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const args = process.argv.slice(2);
const shotsAt = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS ::', name); } else { fail++; console.log('FAIL ::', name, extra ? ':: ' + extra : ''); } };
const errors = [];

const STUB = () => {
  const HOUR = 3600000;
  const hours = (key) => {
    const out = [];
    const to = Math.floor(Date.now() / HOUR) * HOUR;
    for (let h = to - 7 * 24 * HOUR; h < to; h += HOUR) {
      const i = (h / HOUR) % 24;
      const down = key === 'rt/p' && h === to - 30 * HOUR;
      out.push({ hour: h, checks: 60, ok: down ? 40 : 60, fail: down ? 20 : 0, rttMin: 1, rttMed: 3 + (i % 5), rttP95: 9 + (i % 7), rttMax: 30, jitter: 0.8,
        sUp: down ? 2400 : i === 9 ? 3000 : 3600, sSlow: i === 9 ? 600 : 0, sDown: down ? 1200 : 0, sUpstream: 0, sMaint: 0, sUnknown: 0, tcp: key === 'mo/p' ? 60 : 0 });
    }
    return out;
  };
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, a) => {
        switch (cmd) {
          case 'monitor_info': return { on: true, running: true, elsewhere: false, retentionDays: 360, tray: true, autostart: true, networkId: window.__rpLib || '', networkName: 'Clinic', count: 3, quiet: { site: 0, nodes: {}, groups: {} }, platform: 'linux', statsFile: '', alarms: false, monitorName: 'FRONT-PC' };
          case 'monitor_figures': { const o = {}; (a.keys || []).forEach((k) => { if (k !== 'rt/w') o[k] = hours(k); }); return o; }
          case 'monitor_history': return { kept: true, samples: [] };
          case 'monitor_statuses': return [];
          case 'this_computer': return { interfaces: [] };
          case 'visit_monitor_info': return { running: false, meta: null, stopped: null, count: 0, statuses: [], outages: [], hasFigures: false };
          default: return null;
        }
      }
    },
    event: { listen: async () => () => {} }
  };
};

const SETUP = async () => {
  const N = (id, type, ip, extra) => Object.assign({ id, type, name: id, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra);
  const now = Date.now();
  replaceDocument({ v: DOC_VERSION, report: { client: 'Clinica Sol', site: 'Reception' },
    providers: [{ id: 'pI', name: 'Fibra Norte', service: 'internet', target: 99.5, hours: 'Mon-Fri 9-17', targetHours: true }],
    groups: [{ id: 'gB', name: 'Office', kind: 'building' }],
    nodes: [N('mo', 'modem', '10.0.0.2/24', { name: 'Modem', providers: ['pI'], checks: [{ id: 'p', proto: 'ping' }] }),
      N('rt', 'router', '10.0.0.1/24', { name: 'Router R1', providers: ['pI'], target: 99.9, x: 0, y: 120, checks: [{ id: 'p', proto: 'ping' }, { id: 'w', proto: 'http' }] }),
      N('sw', 'switch', '10.0.0.3/24', { name: 'Switch', group: 'gB', x: 0, y: 240, checks: [{ id: 'p', proto: 'ping', slowMs: 8 }] })],
    links: [{ id: 'l1', source: 'mo', target: 'rt' }, { id: 'l2', source: 'rt', target: 'sw' }],
    incidents: [{ id: 'inaaaaaaaaaa', kind: 'outage', at: now - 30 * 3600000, status: 'closed', symptom: 'internet', nodeIds: ['rt'], behind: ['sw'], monitor: 'FRONT-PC',
      outages: [{ from: now - 30 * 3600000, to: now - 30 * 3600000 + 20 * 60000 }], acts: [{ act: 'ack', at: now - 30 * 3600000 + 4 * 60000, by: 'Ana' }], closedAt: now - 30 * 3600000 + 4 * 60000, reporter: {}, routedTo: [], visits: [] }] },
  { origin: 'file', docId: 'rp-e2e' });
  state.libraryId = 'k-rp-e2e';
  window.__rpLib = 'k-rp-e2e';
  await TopoChecks.refreshInfo();
};

// The preview's state, measured.
const MEASURE = async (phone) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !(sheetPreviewOpen() && sheetPreviewBuilt() && !document.getElementById('sheetPreviewPrint').disabled); i++) await wait(25);
  await wait(200);
  const b = sheetPreviewBuilt();
  const dlg = document.getElementById('sheetPreviewDialog');
  const ctl = document.getElementById('sheetPreviewControls');
  const targets = [...ctl.querySelectorAll('select, label:has(input)'), ...dlg.querySelectorAll('.rpv-actions .btn:not([hidden]), .rpv-x')]
    .map((x) => x.getBoundingClientRect()).filter((r) => r.width > 0);
  const over = [...dlg.querySelectorAll('.rpv-side *')].map((x) => x.getBoundingClientRect()).filter((r) => r.width > 0 && r.right > innerWidth + 1).length;
  return { html: b ? b.html : '', name: b ? b.name : '', svgs: b ? (b.html.match(/<svg /g) || []).length : 0, tables: b ? (b.html.match(/<table/g) || []).length : 0,
    choices: ctl.querySelectorAll('[data-rp]').length, csv: !document.getElementById('sheetPreviewCsv').hidden,
    small: phone ? targets.filter((r) => r.height < 44).length : 0, sideways: document.documentElement.scrollWidth > innerWidth, over,
    ctlText: ctl.textContent, title: document.getElementById('sheetPreviewTitle').textContent };
};

const browser = await chromium.launch();
const open = async (width, theme, lang) => {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 740 : 860 }, hasTouch: width < 500, isMobile: width < 500 });
  const tag = `${width} ${theme} ${lang}`;
  await ctx.route(ORIGIN + '/**', async (r) => {
    const path = decodeURIComponent(new URL(r.request().url()).pathname);
    const file = resolvePath(REPO, '.' + path);
    if (!file.startsWith(REPO + sep)) return r.fulfill({ status: 403, body: 'no' });
    try { r.fulfill({ status: 200, body: await readFile(file), headers: { 'content-type': MIME[extname(file)] || 'application/octet-stream' } }); }
    catch { r.fulfill({ status: 404, body: 'not found' }); }
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  await page.addInitScript(STUB);
  await page.addInitScript((th) => { try { localStorage.setItem('carino-theme', th); } catch (e) { /* none */ } }, theme);
  await page.goto(`${ORIGIN}/index.html?lang=${lang}#advanced`);
  await page.waitForFunction(() => window.TopoReports && window.TopoChecks && !document.body.classList.contains('chrome-pending'), null, { timeout: 30000 });
  await page.evaluate(SETUP);
  return { ctx, page };
};

try {
  for (const width of [360, 390, 1280]) {
    for (const theme of ['gold', 'color']) {
      const tag = `${width} ${theme}`;
      const phone = width < 500;
      const { ctx, page } = await open(width, theme, 'en');
      // 1. The device's Answer checks: Full report.
      const r1 = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        select('rt', 'node');
        await wait(150);
        const grp = document.getElementById('checkGroup');
        if (grp && !grp.open) { grp.open = true; await wait(100); }
        renderCheckSection(getNode('rt'));
        const link = document.querySelector('#checkBody [data-ck="report"]');
        if (!link) return { link: false };
        link.scrollIntoView({ block: 'center' });
        await wait(100);
        const r = link.getBoundingClientRect();
        return { link: true, h: r.height, w: r.width, sideways: document.documentElement.scrollWidth > innerWidth };
      });
      ok(`${tag}: the device's Answer checks link to its full report${phone ? ' (44 px)' : ''}`, r1.link && (!phone || r1.h >= 44) && !r1.sideways, JSON.stringify(r1));
      if (shotsAt) { await mkdir(shotsAt, { recursive: true }); await page.screenshot({ path: join(shotsAt, `rp-check-${width}-${theme}.png`) }); }
      // 2. Its report.
      await page.evaluate(() => document.querySelector('#checkBody [data-ck="report"]').click());
      const r2 = await page.evaluate(MEASURE, phone);
      ok(`${tag}: the device's report: its checks' charts and tables, its choices, Print, CSV and Download`,
        /Monitoring report: Router R1/.test(r2.html) && r2.svgs === 2 && r2.tables >= 4 && /No response times|HTTP/.test(r2.html) && r2.choices >= 5 && r2.csv && /_monitoring\.html$/.test(r2.name), JSON.stringify(Object.assign({}, r2, { html: r2.html.length })));
      ok(`${tag}: ${phone ? '44 px choices and buttons, ' : ''}nothing past the edge, no sideways scroll`, r2.small === 0 && !r2.sideways && r2.over === 0, JSON.stringify({ small: r2.small, sideways: r2.sideways, over: r2.over }));
      ok(`${tag}: the figures said to come from this PC's monitor (one chart: the HTTP check has no figures)`, /Figures: this PC/.test(r2.html), '');
      if (shotsAt) await page.screenshot({ path: join(shotsAt, `rp-device-${width}-${theme}.png`) });
      // 3. The whole network, then the provider.
      // 3. The whole network for a week, then a provider.
      await page.evaluate(async () => { closeSheetPreview(); await TopoReports.openMonitoringReport({ scope: 'site', period: 'week' }); });
      const rs = await page.evaluate(MEASURE, phone);
      ok(`${tag}: the whole network for a week: per check, per group and per provider, the outage with who acted`,
        /Per group/.test(rs.html) && /Per provider/.test(rs.html) && /Acknowledged by Ana/.test(rs.html) && /Modem · Ping/.test(rs.html) && /TCP, not ping/.test(rs.html) && rs.small === 0 && !rs.sideways && rs.over === 0,
        JSON.stringify({ small: rs.small, sideways: rs.sideways, over: rs.over }));
      if (shotsAt) await page.screenshot({ path: join(shotsAt, `rp-site-${width}-${theme}.png`) });
      await page.evaluate(() => { const sc = document.querySelector('#sheetPreviewControls [data-rp="scope"]'); sc.value = 'provider'; sc.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForFunction(() => /Fibra Norte/.test((sheetPreviewBuilt() || {}).html || ''), null, { timeout: 10000 });
      const rp = await page.evaluate(MEASURE, phone);
      ok(`${tag}: a provider's report: their devices, their support hours, the hours choice`,
        /Only during their support hours/.test(rp.html) && !/Switch · Ping/.test(rp.html) && /Around the clock/.test(rp.ctlText) && rp.small === 0 && !rp.sideways && rp.over === 0,
        JSON.stringify({ small: rp.small, sideways: rp.sideways, over: rp.over }));
      if (shotsAt) await page.screenshot({ path: join(shotsAt, `rp-provider-${width}-${theme}.png`) });
      await page.close();
      await ctx.close();
    }
  }
  // 4. Every language, at 390 in Gold.
  for (const lang of ['es', 'pt-BR', 'ru', 'ja']) {
    const { ctx, page } = await open(390, 'gold', lang);
    await page.evaluate(() => TopoReports.openMonitoringReport({ scope: 'site', period: 'week' }));
    const r = await page.evaluate(MEASURE, true);
    const labels = await page.evaluate(() => [...document.querySelectorAll('#sheetPreviewControls label, #sheetPreviewControls legend, #sheetPreviewControls option')].map((x) => x.textContent.trim()));
    const english = ['>Availability<', '>Outages<', '>Who acted<', '>Time to acknowledge<', 'Last 7 days', 'Monitoring report'].filter((w) => r.html.includes(w))
      .concat(['Report on', 'Period', 'What goes in', 'Whole network', 'Last 7 days', 'Response times'].filter((w) => labels.includes(w)));
    ok(`${lang}: the report and its choices translated, no {placeholder} left${lang === 'ja' ? ', PC never パソコン' : ''}`,
      !english.length && !/\{\w+\}/.test(r.html.replace(/<style>[\s\S]*?<\/style>/g, '')) && !/パソコン/.test(r.html) && r.small === 0 && !r.sideways,
      JSON.stringify({ english, title: r.title, small: r.small }));
    if (shotsAt) await page.screenshot({ path: join(shotsAt, `rp-${lang}.png`) });
    await page.close();
    await ctx.close();
  }
  ok('no console error anywhere', !errors.length, errors.slice(0, 4).join(' | '));
} catch (e) {
  ok('the check ran to the end', false, String(e && e.stack || e).slice(0, 400));
} finally {
  await browser.close();
}
console.log(`---\n${pass + fail} checks, ${fail ? fail + ' failing' : 'all passing'}`);
process.exit(fail ? 1 : 0);
