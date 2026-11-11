#!/usr/bin/env node
// Email copies the infrastructure link on EVERY press (docs/SCOPE.md D94),
// in real browsers with their real clipboards, where the copy has to run
// inside the press's user activation (navigator.clipboard.write with a
// ClipboardItem, or writeText):
//
//   node tests/email-copy-check.mjs [--port 7391] [--engines chromium,firefox]
//
// For each engine: a network with a report sent to a provider, its send step
// open (the link made, the provider's part by default), then Email pressed
// three times with Copy passphrase pressed before each, and once more with
// nothing between. Each press must write the clipboard (the write resolved,
// not refused) BEFORE the mail program is asked for (the mailto: open is
// recorded, never followed), and the clipboard must then hold the link: read
// back with clipboard-read on Chromium, and on Firefox by pasting into a
// contenteditable (Control+V), which reads what the page wrote. A read-back
// an engine does not allow is said, not passed.
//
// Then the report attached (D97): "Also attach the report" ticked, the real
// report made (a PDF where the engine draws one), and Email pressed twice:
// the first press copies the link, downloads the report (a real download,
// seen by the browser) and only then asks for the mail program, whose
// mailto: says "Report: attached (<file>)"; the second press copies again
// and does not download it again.
//
// The page is served from this repo by a server of this script's own on
// --port (default: any free one). Nothing outside it is requested.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const PORT = Number(arg('--port', 0));
const ENGINES = arg('--engines', 'chromium,firefox').split(',').filter(Boolean);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

let total = 0, failed = 0;
const ok = (name, cond, extra = '') => { total++; if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`); };
const note = (text) => console.log(`NOTE :: ${text}`);

function serve() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const file = resolvePath(ROOT, '.' + (path === '/' ? '/index.html' : path));
        if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403); res.end(); return; }
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch (e) { res.writeHead(404); res.end(); }
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// In the page: a network, a report sent to Fibra Norte, its send step open
// with the link made; the clipboard and the mailto: watched.
async function setUp(page) {
  await page.waitForFunction(() => !!window.TopoIncidents && typeof replaceDocument === 'function' && typeof canSeal === 'function' && canSeal(), null, { timeout: 30000 });
  return page.evaluate(async () => {
    const TI = window.TopoIncidents;
    window.__log = [];
    TI.hooks.open = (url) => { window.__log.push({ kind: 'open', url }); };
    const cb = navigator.clipboard;
    const realWrite = cb.write ? cb.write.bind(cb) : null, realText = cb.writeText.bind(cb);
    if (realWrite) cb.write = (items) => realWrite(items).then((v) => { window.__log.push({ kind: 'write', ok: true }); return v; }, (e) => { window.__log.push({ kind: 'write', ok: false, err: String(e) }); throw e; });
    cb.writeText = (text) => realText(text).then((v) => { window.__log.push({ kind: 'writeText', ok: true, text }); return v; }, (e) => { window.__log.push({ kind: 'writeText', ok: false, err: String(e) }); throw e; });
    const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    replaceDocument({
      v: DOC_VERSION, report: { client: 'Clinica Sol', site: 'Reception' },
      providers: [{ id: 'pI', name: 'Fibra Norte', service: 'internet', email: 'noc@fibra.example' }, { id: 'pT', name: 'Andes IT', service: 'it', email: 'help@andes.example' }],
      nodes: [N('isp', 'cloud', { providers: ['pI'] }), N('rt', 'router', { y: 100 }), N('sw', 'switch', { y: 200 }), N('pc', 'pc', { y: 300, providers: ['pT'] })],
      links: [{ id: 'l1', source: 'isp', target: 'rt' }, { id: 'l2', source: 'rt', target: 'sw' }, { id: 'l3', source: 'sw', target: 'pc' }]
    }, { origin: 'file', docId: 'ec-net' });
    const id = await TI.createIncident({ symptom: 'internet', nodeIds: ['pc'], text: 'Nothing loads.', name: 'Ana', phone: '555-1', routedTo: ['pI'], remember: false });
    TI.openIncidentSend(id);
    for (let i = 0; i < 300 && !(TI.draft.send && TI.draft.send.result); i++) await new Promise((r) => setTimeout(r, 20));
    const s = TI.draft.send;
    return { url: s && s.result && s.result.url, scope: s && s.result && s.result.scope, pass: s && s.pass };
  });
}

async function readBack(page, engine) {
  if (engine === 'chromium') {
    try { return { how: 'clipboard-read', text: await page.evaluate(() => navigator.clipboard.readText()) }; } catch (e) { return { how: 'none', err: String(e) }; }
  }
  // Firefox: paste into a contenteditable; the paste event's data is what
  // the page wrote (rich and plain).
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.id = '__pasteBox'; box.contentEditable = 'true';
    box.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:40px;z-index:2147483647;background:#fff';
    window.__pasted = null;
    box.addEventListener('paste', (e) => { window.__pasted = { text: e.clipboardData.getData('text/plain'), html: e.clipboardData.getData('text/html') }; e.preventDefault(); });
    document.body.appendChild(box);
    box.focus();
  });
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(200);
  const got = await page.evaluate(() => { const g = window.__pasted; document.getElementById('__pasteBox').remove(); return g; });
  return got ? { how: 'paste', text: got.text, html: got.html } : { how: 'none', err: 'no paste event' };
}

async function runEngine(name, launcher, base) {
  let browser;
  try { browser = await launcher.launch(); } catch (e) { note(`${name}: will not launch here (${String(e.message).split('\n')[0].slice(0, 80)})`); return; }
  try {
    const context = await browser.newContext(name === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/index.html?lang=en#advanced`);
    const s = await setUp(page);
    ok(`${name}: the send step made the link (their part)`, !!s.url && s.url.includes('#e~') && s.scope === 'part', JSON.stringify({ scope: s.scope }));
    if (!s.url) return;
    for (let i = 1; i <= 4; i++) {
      if (i <= 3) {
        await page.click('#problemPassCopy');
        await page.waitForFunction(() => window.TopoIncidents.draft.send.copied === 'pass', null, { timeout: 5000 }).catch(() => {});
      }
      const n0 = await page.evaluate(() => window.__log.length);
      await page.click('#problemEmailBtn');
      await page.waitForFunction((n) => window.__log.slice(n).some((e) => e.kind === 'open'), n0, { timeout: 5000 }).catch(() => {});
      const step = await page.evaluate((n) => window.__log.slice(n), n0);
      const wrote = step.findIndex((e) => (e.kind === 'write' || e.kind === 'writeText') && e.ok);
      const opened = step.findIndex((e) => e.kind === 'open');
      ok(`${name}: press ${i}${i <= 3 ? ' (after Copy passphrase)' : ''}: the clipboard written, then the mail program asked for`, wrote >= 0 && opened > wrote,
        JSON.stringify(step.map((e) => e.kind + (e.ok === false ? ':refused ' + e.err : ''))));
      const status = await page.textContent('#problemSendStatus');
      ok(`${name}: press ${i}: the step says the link is copied and the passphrase goes another way`, status.startsWith('Link copied: paste it in the email') && status.includes('The passphrase goes another way'), status);
      const back = await readBack(page, name);
      if (back.how === 'none') note(`${name}: press ${i}: the clipboard could not be read back here (${back.err}); only the resolved write was checked`);
      else ok(`${name}: press ${i}: the clipboard holds the link (read back by ${back.how})`, back.text === s.url, (back.text || '').slice(0, 60));
      if (back.html !== undefined && back.how === 'paste') ok(`${name}: press ${i}: and the hyperlink "Follow the infrastructure link"`, /<a [^>]*href="[^"]*#e~[^"]*"[^>]*>Follow the infrastructure link<\/a>/.test(back.html || ''), (back.html || '').slice(0, 80));
    }
    const mails = await page.evaluate(() => window.__log.filter((e) => e.kind === 'open').map((e) => e.url));
    ok(`${name}: four presses, four mailto: opens, none carrying the raw link`, mails.length === 4 && mails.every((u) => u.startsWith('mailto:noc@fibra.example?') && !u.includes('e~')), String(mails.length));
    // The report attached (D97).
    await page.evaluate(() => {
      const H = window.TopoIncidents.hooks, real = H.save;
      H.save = (blob, nm) => { window.__log.push({ kind: 'save', name: nm, size: blob.size }); return real(blob, nm); };
    });
    await page.click('#problemAttach');
    await page.waitForFunction(() => { const d = window.TopoIncidents.draft.send; return d.attachFile && !d.attachBusy; }, null, { timeout: 60000 }).catch(() => {});
    const file = await page.evaluate(() => { const f = window.TopoIncidents.draft.send.attachFile; return f && { name: f.name, type: f.type, bytes: f.bytes }; });
    ok(`${name}: ticked, the report is made`, !!file && /^topo_clinica-sol_reception_\d{4}-\d{2}-\d{2}_fibra-norte\.(pdf|html)$/.test(file.name), JSON.stringify(file));
    if (file) {
      const n0 = await page.evaluate(() => window.__log.length);
      const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
      await page.click('#problemEmailBtn');
      await page.waitForFunction((n) => window.__log.slice(n).some((e) => e.kind === 'open'), n0, { timeout: 5000 }).catch(() => {});
      const download = await dl;
      const step = await page.evaluate((n) => window.__log.slice(n), n0);
      const kinds = step.map((e) => e.kind);
      const wrote = kinds.findIndex((k) => k === 'write' || k === 'writeText'), saved = kinds.indexOf('save'), opened = kinds.indexOf('open');
      ok(`${name}: attached, press 1: the link copied, the report downloaded, then the mail program`, wrote >= 0 && saved > wrote && opened > saved && step[wrote].ok, JSON.stringify(kinds));
      ok(`${name}: the browser downloaded the report under its name`, !!download && download.suggestedFilename() === file.name, download ? download.suggestedFilename() : 'no download');
      const mailto = step[opened] ? decodeURIComponent(step[opened].url) : '';
      ok(`${name}: the mailto: says the report is attached`, mailto.includes(`Report: attached (${file.name})`), mailto.slice(-160));
      const status = await page.textContent('#problemSendStatus');
      ok(`${name}: the step says to attach the file that downloaded`, status.startsWith('Link copied: paste it in the email') && status.endsWith(`The report ${file.name} was downloaded: attach it to the email.`), status);
      const back = await readBack(page, name);
      if (back.how === 'none') note(`${name}: attached: the clipboard could not be read back here (${back.err})`);
      else ok(`${name}: attached: the clipboard holds the link`, back.text === s.url);
      const n1 = await page.evaluate(() => window.__log.length);
      await page.click('#problemEmailBtn');
      await page.waitForFunction((n) => window.__log.slice(n).some((e) => e.kind === 'open'), n1, { timeout: 5000 }).catch(() => {});
      const step2 = (await page.evaluate((n) => window.__log.slice(n), n1)).map((e) => e.kind);
      ok(`${name}: attached, press 2: copied again, not downloaded again`, step2.some((k) => k === 'write' || k === 'writeText') && !step2.includes('save') && step2.includes('open'), JSON.stringify(step2));
    }
    ok(`${name}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
  }
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const launchers = { chromium, firefox };
  for (const name of ENGINES) {
    if (!launchers[name]) { note(`unknown engine ${name}`); continue; }
    await runEngine(name, launchers[name], base);
  }
} catch (e) {
  ok('the check ran to the end', false, e && (e.stack || e.message));
} finally {
  server.close();
}
console.log(`---\n${total} checks, ${failed ? failed + ' failing' : 'all passing'}`);
process.exit(failed ? 1 : 0);
