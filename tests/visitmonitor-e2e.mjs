// "Monitor during this visit" (js/visitmonitor.js; docs/SCOPE.md D148,
// D174, step 7i) in Chromium, with the app's commands stubbed:
//
//   cd tests && node visitmonitor-e2e.mjs [--shots <dir>]
//
// The repository is served by Playwright (page.route on
// http://localhost:8398, no socket opened). At 360, 390 and 1280, in Gold
// and Colourful:
//   1. the report's tab: Monitor during this visit, Start, the checks with
//      their states and an outage seen; 44 px buttons on a phone; no
//      sideways scroll;
//   2. Record visit: the monitoring line in the dialog, saved into the
//      visit entry; no sideways scroll;
//   3. the visit's report in the print preview: a chart per check and the
//      tables;
//   4. no console error anywhere.
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
  const now = Date.now();
  let info = { running: false, meta: null, stopped: null, count: 0, statuses: [], outages: [], hasFigures: false };
  const figures = () => ({ from: now - 3600000, to: Date.now(), items: [
    { key: 'rt/p', nodeId: 'rt', checkId: 'p', name: 'Router R1', proto: 'ping', via: '', asked: 60, answered: 57, loss: 0.05, avail: 0.95, coverage: 1, med: 4, p95: 9, step: 75000,
      rtt: Array.from({ length: 48 }, (_, i) => 3 + (i % 5)), states: 'u'.repeat(30) + 'd'.repeat(6) + 'u'.repeat(12) },
    { key: 'mo/p', nodeId: 'mo', checkId: 'p', name: 'Modem', proto: 'ping', via: 'tcp', asked: 60, answered: 60, loss: 0, avail: 1, coverage: 1, med: 1.2, p95: 2, step: 75000,
      rtt: Array.from({ length: 48 }, () => 1.2), states: 'u'.repeat(48) }],
    outages: [{ nodeId: 'rt', name: 'Router R1', from: now - 1500000, to: now - 1050000 }] });
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, a) => {
        switch (cmd) {
          case 'visit_monitor_start': info = { running: true, meta: Object.assign({}, a.meta, { started: now - 3600000 }), stopped: null, count: a.plan.items.length, statuses: [], outages: [], hasFigures: true }; return JSON.parse(JSON.stringify(info));
          case 'visit_monitor_info': return JSON.parse(JSON.stringify(info));
          case 'visit_monitor_figures': return info.meta ? figures() : null;
          case 'visit_monitor_end': info = { running: false, meta: null, stopped: null, count: 0, statuses: [], outages: [], hasFigures: false }; return info;
          case 'monitor_info': return { on: false, running: false, elsewhere: false, retentionDays: 360, tray: false, autostart: false, networkId: '', networkName: '', count: 0, quiet: { site: 0, nodes: {}, groups: {} }, platform: 'linux', statsFile: '', alarms: false, monitorName: 'PC' };
          case 'this_computer': return { interfaces: [] };
          default: return null;
        }
      }
    },
    event: { listen: async (name, cb) => { if (name === 'topo-visit-monitor') window.__vmcb = cb; return () => {}; } }
  };
};

const browser = await chromium.launch();
try {
  for (const width of [360, 390, 1280]) {
    for (const theme of ['gold', 'color']) {
      const tag = `${width} ${theme}`;
      const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 740 : 860 }, hasTouch: width < 500, isMobile: width < 500 });
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
      await page.goto(ORIGIN + '/index.html?lang=en#advanced');
      await page.waitForFunction(() => window.TopoVisitMonitor && window.TopoProviderMode && !document.body.classList.contains('chrome-pending'), null, { timeout: 30000 });
      const r1 = await page.evaluate(async () => {
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        const N = (id, type, ip, extra) => Object.assign({ id, type, name: id, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra);
        replaceDocument({ v: DOC_VERSION, providers: [{ id: 'pI', name: 'Fibra Norte', service: 'internet' }],
          nodes: [N('mo', 'modem', '10.0.0.2/24', { name: 'Modem', providers: ['pI'], checks: [{ id: 'p', proto: 'ping' }] }),
            N('rt', 'router', '10.0.0.1/24', { name: 'Router R1', providers: ['pI'], x: 0, y: 120, checks: [{ id: 'p', proto: 'ping' }] }),
            N('pc', 'pc', '10.0.0.9/24', { name: 'Reception PC', x: 0, y: 240 })],
          links: [{ id: 'l1', source: 'mo', target: 'rt' }, { id: 'l2', source: 'rt', target: 'pc' }] }, { origin: 'file', docId: 'vm-e2e' });
        const inc = await TopoIncidents.createIncident({ symptom: 'internet', nodeIds: ['pc'], text: 'Slow.', name: 'Ana', phone: '555-1', routedTo: ['pI'] });
        TopoProviderMode.enterProviderMode(inc);
        TopoProviderMode.setProviderSelf('vm-e2e', 'pI');
        TopoProviderMode.renderProviderPanel();
        TopoProviderMode.openProviderPanel();
        await wait(300);
        document.querySelector('#vmSection .btn-primary').click();
        for (let i = 0; i < 100 && !TopoVisitMonitor.active(); i++) await wait(20);
        const now = Date.now();
        window.__vmcb({ payload: { statuses: [
          { key: 'rt/p', nodeId: 'rt', state: 'down', since: now - 300000, status: 'timeout', via: 'icmp', slow: false, flapping: false },
          { key: 'mo/p', nodeId: 'mo', state: 'up', since: now - 3600000, rttMs: 1.2, status: 'echo', via: 'icmp', slow: false, flapping: false }],
          outages: [{ nodeId: 'rt', name: 'Router R1', from: now - 300000 }] } });
        await wait(300);
        const sec = document.getElementById('vmSection');
        sec.scrollIntoView();
        await wait(150);
        const btns = [...sec.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).filter((b) => b.width > 0);
        return { text: sec.textContent, rows: sec.querySelectorAll('.vm-row').length, visible: sec.getBoundingClientRect().width > 0,
          small: btns.filter((b) => b.height < 44).length, sideways: document.documentElement.scrollWidth > innerWidth,
          over: sec.getBoundingClientRect().right > innerWidth + 1 };
      });
      ok(`${tag}: the tab shows the checks, a state and the outage`, r1.visible && r1.rows === 2 && /Not answering since/.test(r1.text) && /Outages seen/.test(r1.text), JSON.stringify(r1).slice(0, 300));
      ok(`${tag}: ${width < 500 ? '44 px buttons, ' : ''}nothing past the edge, no sideways scroll`, (width >= 500 || r1.small === 0) && !r1.sideways && !r1.over, JSON.stringify(r1).slice(0, 300));
      if (shotsAt) { await mkdir(shotsAt, { recursive: true }); await page.screenshot({ path: join(shotsAt, `vm-tab-${width}-${theme}.png`) }); }
      const r2 = await page.evaluate(async () => {
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        TopoProviderMode.openVisitDialog();
        for (let i = 0; i < 150 && (TopoProviderMode.state.vd.monState === 'loading' || TopoProviderMode.state.vd.changesState === 'loading'); i++) await wait(20);
        const box = document.getElementById('visitMonitoring');
        box.scrollIntoView();
        await wait(100);
        const res = { text: document.getElementById('visitMonitoringText').textContent, shown: !box.hidden && box.getBoundingClientRect().width > 0,
          sideways: document.documentElement.scrollWidth > innerWidth, over: box.getBoundingClientRect().right > innerWidth + 1 };
        document.querySelector('#visitOutcomes input[value="fixed"]').click();
        document.getElementById('visitBy').value = 'Juan';
        document.getElementById('visitSaveBtn').click();
        for (let i = 0; i < 200 && TopoProviderMode.state.vd && TopoProviderMode.state.vd.stage !== 'return'; i++) await wait(25);
        const e = state.log[state.log.length - 1];
        res.saved = !!(e && e.kind === 'visit' && e.monitoring && e.monitoring.items.length === 2);
        res.reportBtn = !document.getElementById('visitReportBtn').classList.contains('hidden');
        return res;
      });
      ok(`${tag}: Record visit says what is added, with no sideways scroll`, r2.shown && /Monitored during the visit: 2 checks\. 1 outage seen\./.test(r2.text) && !r2.sideways && !r2.over, JSON.stringify(r2));
      ok(`${tag}: the visit entry carries the section, and the report is offered`, r2.saved && r2.reportBtn, JSON.stringify(r2));
      if (shotsAt) await page.screenshot({ path: join(shotsAt, `vm-dialog-${width}-${theme}.png`) });
      const r3 = await page.evaluate(async () => {
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        document.getElementById('visitReportBtn').click();
        for (let i = 0; i < 200 && !(typeof sheetPreviewBuilt === 'function' && sheetPreviewBuilt()); i++) await wait(25);
        await wait(600);
        const b = sheetPreviewBuilt();
        const res = { html: !!b, svgs: b ? (b.html.match(/<svg /g) || []).length : 0, tables: b ? (b.html.match(/<table /g) || []).length : 0,
          dialog: !document.getElementById('sheetPreviewDialog').classList.contains('hidden'), sideways: document.documentElement.scrollWidth > innerWidth };
        closeSheetPreview();
        TopoProviderMode.closeVisitDialog();
        return res;
      });
      ok(`${tag}: the visit's report: a chart per check and the tables, in the preview`, r3.html && r3.dialog && r3.svgs === 4 && r3.tables === 2 && !r3.sideways, JSON.stringify(r3));
      if (shotsAt) {
        await page.evaluate(() => { const e = state.log[state.log.length - 1]; TopoVisitMonitor.openVisitReport(e); });
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(shotsAt, `vm-report-${width}-${theme}.png`) });
      }
      await page.close();
      await ctx.close();
    }
  }
  ok('no console error anywhere', !errors.length, errors.slice(0, 4).join(' | '));
} catch (e) {
  ok('the check ran to the end', false, String(e && e.stack || e).slice(0, 400));
} finally {
  await browser.close();
}
console.log(`---\n${pass + fail} checks, ${fail ? fail + ' failing' : 'all passing'}`);
process.exit(fail ? 1 : 0);
