// Cross-engine test runner. run.sh proves the suites on Chromium only (it leans
// on Chromium's --dump-dom, which Firefox and WebKit have no equivalent for).
// This runs the SAME suites on every Playwright engine that will launch here, so
// "works cross-browser" is something the suite actually checks rather than a hope.
//
//   cd tests && npm install && npx playwright install chromium firefox webkit
//   node run-cross.mjs            # every suite on every available engine
//   node run-cross.mjs wifi bonds # named suites only
//
// WebKit needs system libraries Playwright ships for Ubuntu; on other distros it
// may not launch. An engine that will not start is reported as skipped, not as a
// failure — the point is to cover what we can, honestly, not to pretend.
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join, dirname, extname, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); // repo root
const RUNFILE = '.crossrun.html';
// Its own variable, not PORT, and an ephemeral port when unset. run.sh hands
// its real-clock suites to this script with its environment, PORT included,
// while its own python server is still listening on that port; reading PORT
// here meant `PORT=8862 tests/run.sh` crashed this server with EADDRINUSE and
// the suite failed as "real-clock run reported nothing".
let PORT = Number(process.env.CROSS_PORT || 0);

// Same boot-error probe run.sh injects, and for the same reason a file rather
// than inline: index.html's CSP forbids inline script. It also collects CSP
// violations for tests/suites/privacy.js.
const PROBEFILE = '.crossprobe.js';
// Rejections too, as run.sh's probe has them: most suites are async, and a
// throw inside one is a rejection, not an error event. Without this listener
// the failure still counted, but read "(suite reported nothing)" with no reason.
const PROBE = 'window.addEventListener("error",(e)=>{if(document.getElementById("BOOTERR"))return;'
  + 'const p=document.createElement("pre");p.id="BOOTERR";'
  + 'p.textContent=e.message+" @ "+(e.filename||"").split("/").pop()+":"+e.lineno;'
  + 'document.documentElement.appendChild(p);});'
  + 'window.addEventListener("unhandledrejection",(e)=>{if(document.getElementById("BOOTERR"))return;'
  + 'const p=document.createElement("pre");p.id="BOOTERR";const r=e.reason;'
  + 'p.textContent="unhandled rejection: "+(r&&r.stack?String(r.stack).split("\\n").slice(0,2).join(" | "):String(r));'
  + 'document.documentElement.appendChild(p);});'
  + 'window.__cspViolations=[];document.addEventListener("securitypolicyviolation",(e)=>'
  + 'window.__cspViolations.push(e.violatedDirective+" "+(e.blockedURI||"inline")));'
  // Suites start after boot has decided, not merely on load — see run.sh.
  + 'window.__topoReady=new Promise((r)=>window.addEventListener("topo:ready",r,{once:true}));'
  + 'const _wadd=window.addEventListener;window.addEventListener=function(type,fn,opts){'
  + 'const s=document.currentScript;'
  + 'if(type==="load"&&fn&&s&&/(^|\\/)tests\\/suites\\//.test(s.getAttribute("src")||"")){'
  + 'const f=typeof fn==="function"?fn:(e)=>fn.handleEvent(e);'
  + 'return _wadd.call(this,type,(e)=>window.__topoReady.then(()=>f.call(window,e)),opts);}'
  + 'return _wadd.call(this,type,fn,opts);};';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const path = decodeURIComponent(req.url.split('?')[0]);
        // Contained to the repo: '/..%2F..%2F' decodes to a path that join()
        // happily walks out of ROOT with, and anything that can reach the port
        // while the suites run could read files elsewhere on the machine.
        const file = resolvePath(ROOT, '.' + (path === '/' ? '/index.html' : path));
        if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403); res.end('forbidden'); return; }
        const buf = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
        res.end(buf);
      } catch { res.writeHead(404); res.end('not found'); }
    });
    server.listen(PORT, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function buildRunfile(suite) {
  let html = await readFile(join(ROOT, 'index.html'), 'utf8');
  if (!html.includes('<head>') || !html.includes('</body>')) throw new Error('index.html missing <head> or </body>');
  await writeFile(join(ROOT, PROBEFILE), PROBE);
  html = html.replace('<head>', `<head><script src="${PROBEFILE}"></script>`);
  html = html.replace('</body>', `<script src="tests/suites/${suite}.js"></script>\n</body>`);
  await writeFile(join(ROOT, RUNFILE), html);
}

// One suite on one already-launched engine → { total, failed, bad[], boot }.
async function runSuite(browser, suite) {
  const page = await browser.newPage();
  try {
    // ?lang=en and #advanced for the same reasons run.sh uses them — see the note there.
    await page.goto(`http://127.0.0.1:${PORT}/${RUNFILE}?lang=en#advanced`, { waitUntil: 'load' });
    let text = '';
    try {
      await page.waitForSelector('#TESTOUT', { timeout: 15000 });
      text = await page.$eval('#TESTOUT', (el) => el.textContent);
    } catch {
      const boot = await page.$eval('#BOOTERR', (el) => el.textContent).catch(() => '');
      return { total: 0, failed: 1, bad: [], boot: boot || '(suite reported nothing)' };
    }
    const lines = text.split('\n').filter((l) => /^(PASS|FAIL) ::/.test(l));
    const bad = lines.filter((l) => l.startsWith('FAIL ::'));
    return { total: lines.length, failed: bad.length, bad, boot: '' };
  } finally {
    await page.close();
  }
}

const ENGINES = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit }
];

const wanted = process.argv.slice(2);
const suites = (await readdir(join(ROOT, 'tests/suites')))
  .filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''))
  .filter((s) => !wanted.length || wanted.includes(s))
  .sort();

const server = await serve();
let anyFail = false;
const summary = [];

try {
  // TOPO_ENGINES=chromium narrows the run; run.sh uses it for the real-clock suites.
  const only = (process.env.TOPO_ENGINES || '').split(',').filter(Boolean);
  for (const engine of ENGINES.filter((e) => !only.length || only.includes(e.name))) {
    let browser;
    try {
      browser = await engine.type.launch();
    } catch (e) {
      console.log(`\n== ${engine.name} ==  SKIPPED — will not launch here (${String(e.message).split('\n')[0].slice(0, 70)})`);
      summary.push(`${engine.name}: skipped`);
      continue;
    }
    console.log(`\n== ${engine.name} ==`);
    let eTotal = 0, eFailed = 0;
    for (const suite of suites) {
      await buildRunfile(suite);
      const r = await runSuite(browser, suite);
      eTotal += r.total; eFailed += r.failed;
      if (r.boot) { console.log(`FAIL ${suite.padEnd(12)} ${r.boot}`); }
      else if (r.failed) {
        console.log(`FAIL ${suite.padEnd(12)} ${r.total - r.failed}/${r.total}`);
        r.bad.forEach((b) => console.log(`       ${b}`));
      } else {
        console.log(`ok   ${suite.padEnd(12)} ${r.total}`);
      }
    }
    console.log(`   ${eFailed ? 'FAIL' : 'ok'} ${engine.name}: ${eTotal} assertions, ${eFailed} failing`);
    summary.push(`${engine.name}: ${eTotal} assertions${eFailed ? `, ${eFailed} failing` : ', all passing'}`);
    if (eFailed) anyFail = true;
    await browser.close();
  }
} finally {
  await unlink(join(ROOT, RUNFILE)).catch(() => {});
  await unlink(join(ROOT, PROBEFILE)).catch(() => {});
  await server.close();
}

console.log('\n--- cross-engine summary ---');
summary.forEach((s) => console.log('  ' + s));
process.exit(anyFail ? 1 : 0);
