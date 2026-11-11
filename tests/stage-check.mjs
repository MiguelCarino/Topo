#!/usr/bin/env node
// Checks desktop/stage.sh, the copy every offline build starts from (the zip
// and the desktop apps' frontendDist). Not a browser suite: run.sh never
// builds anything.
//
//   node tests/stage-check.mjs
//
//   1. a web stage and a --desktop stage of this repo both pass the script's
//      own checks; the web copy is the website's files byte for byte, the
//      desktop copy differs only in index.html, by the CSP's IPC origins;
//   2. nothing that is not the app is staged (tests/, docs/, desktop/,
//      CLAUDE.md, CNAME, AUDIT.md, README.md, 404.html, robots.txt,
//      sitemap.xml, og.jpg, carino-diag.js, dotfiles);
//   3. on a made-up source tree, the script fails when index.html points at a
//      file that is not there, when it loads carino-diag.js, when a script
//      comes from another site, and when a shipped item is missing.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'desktop', 'stage.sh');
const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'topo-stage-'));
let failed = 0, total = 0;
const ok = (name, cond, extra = '') => { total++; if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`); };
const run = (script, args) => spawnSync('bash', [script, ...args], { encoding: 'utf8' });
const files = (dir) => readdirSync(dir, { recursive: true }).filter((f) => statSync(join(dir, f)).isFile()).map(String).sort();

try {
  // ---- 1: this repo ----
  const web = join(tmp, 'web'), desk = join(tmp, 'desk');
  const r1 = run(STAGE, [web]);
  ok('a web stage passes its own checks', r1.status === 0, (r1.stderr || '').trim().slice(0, 300));
  const r2 = run(STAGE, [desk, '--desktop']);
  ok('a desktop stage passes its own checks', r2.status === 0, (r2.stderr || '').trim().slice(0, 300));
  const wf = files(web), df = files(desk);
  ok('both stage the same files, and the desktop one its intro', df.filter((f) => f !== 'intro.html').join() === wf.join() && df.includes('intro.html') && !wf.includes('intro.html'), `${wf.length} vs ${df.length}`);
  ok('the intro is desktop/intro.html as it is', readFileSync(join(desk, 'intro.html')).equals(readFileSync(join(ROOT, 'desktop', 'intro.html'))));
  const differs = wf.filter((f) => !readFileSync(join(web, f)).equals(readFileSync(join(ROOT, f))));
  ok('the web copy is the website, byte for byte', differs.length === 0, differs.join(', '));
  const ddiff = df.filter((f) => f !== 'intro.html' && !readFileSync(join(desk, f)).equals(readFileSync(join(ROOT, f))));
  ok('the desktop copy differs only in index.html', ddiff.join() === 'index.html', ddiff.join(', '));
  const src = readFileSync(join(ROOT, 'index.html'), 'utf8'), dsk = readFileSync(join(desk, 'index.html'), 'utf8');
  ok('by the IPC origins in connect-src', dsk === src.replace("connect-src 'self';", "connect-src 'self' ipc: http://ipc.localhost;") && dsk !== src);
  ok('which the website never gets', !src.includes('ipc.localhost') && !readFileSync(join(web, 'index.html'), 'utf8').includes('ipc:'));
  ok('the stage summary names the count', /staged \d+ files, \d+ KB \(web\)/.test(r1.stdout), r1.stdout.trim());

  // ---- 2: only the app ----
  const banned = ['tests', 'docs', 'desktop', '.github', 'CLAUDE.md', 'CNAME', 'AUDIT.md', 'README.md', '404.html', 'robots.txt', 'sitemap.xml', 'og.jpg', 'carino-diag.js'];
  const leaked = wf.filter((f) => banned.some((b) => f === b || f.startsWith(b + '/')) || f.split('/').some((p) => p.startsWith('.')));
  ok('nothing that is not the app is staged', leaked.length === 0, leaked.join(', '));
  ok('the app is there (index, scripts, fonts, vendor, licence, the clock the navbar loads)',
     ['index.html', 'js/app.js', 'css/app.css', 'fonts/carino-fonts.css', 'vendor/README.md', 'LICENSE', 'carino-clock.js', 'carino-navbar.js'].every((f) => wf.includes(f)));
  ok('and the report previews\' PDF engine with the html2canvas it loads on the first PDF',
     ['carino-pdf.js', 'carino-html2canvas.js'].every((f) => wf.includes(f)));
  const kb = wf.reduce((n, f) => n + statSync(join(web, f)).size, 0) / 1024;
  ok('about 4 MB', kb > 2500 && kb < 8000, `${Math.round(kb)} KB`);

  // ---- 3: a made-up source tree ----
  const fake = (name, html, drop = []) => {
    const dir = join(tmp, name);
    mkdirSync(join(dir, 'desktop'), { recursive: true });
    cpSync(STAGE, join(dir, 'desktop', 'stage.sh'));
    writeFileSync(join(dir, 'desktop', 'intro.html'), 'intro');
    for (const d of ['css', 'js', 'fonts', 'vendor']) { mkdirSync(join(dir, d)); writeFileSync(join(dir, d, 'x.txt'), d); }
    for (const f of ['carino-clock.js', 'carino-lang.js', 'carino-navbar.js', 'carino-theme.css', 'carino-theme.js', 'carino-ui.css', 'carino-ui.js', 'carino-pdf.js', 'carino-html2canvas.js', 'logo.svg', 'logo-color.svg', 'logo.webp', 'LICENSE']) writeFileSync(join(dir, f), f);
    writeFileSync(join(dir, 'index.html'), html);
    for (const f of drop) rmSync(join(dir, f), { recursive: true });
    return run(join(dir, 'desktop', 'stage.sh'), [join(dir, 'out')]);
  };
  const head = `<meta http-equiv="Content-Security-Policy" content="connect-src 'self';">`;
  const good = fake('good', `${head}<link rel="canonical" href="https://example.org/"><script src="js/x.txt"></script>`);
  ok('a sound tree stages (a canonical link to the site is an address, not a load)', good.status === 0, good.stderr.trim());
  const missing = fake('missing', `${head}<script src="js/nope.js"></script>`);
  ok('a file index.html needs and the tree lacks fails the stage', missing.status !== 0 && /js\/nope\.js/.test(missing.stderr), missing.stderr.trim());
  const diag = fake('diag', `${head}<script src="carino-diag.js"></script>`);
  ok('index.html loading carino-diag.js fails it', diag.status !== 0 && /carino-diag/.test(diag.stderr), diag.stderr.trim());
  const cdn = fake('cdn', `${head}<script src="https://cdn.example/x.js"></script>`);
  ok('a script from another site fails it', cdn.status !== 0 && /another site/.test(cdn.stderr), cdn.stderr.trim());
  const css = fake('css', `${head}<link rel="stylesheet" href="//fonts.example/x.css">`);
  ok('and so does a stylesheet', css.status !== 0 && /another site/.test(css.stderr), css.stderr.trim());
  const gone = fake('gone', `${head}`, ['logo.webp']);
  ok('a shipped item missing from the source fails it', gone.status !== 0 && /logo\.webp/.test(gone.stderr), gone.stderr.trim());
  const noH2c = fake('noh2c', `${head}`, ['carino-html2canvas.js']);
  ok('so does a missing carino-html2canvas.js, which index.html never names (carino-pdf.js loads it)', noH2c.status !== 0 && /carino-html2canvas/.test(noH2c.stderr), noH2c.stderr.trim());
  const twice = fake('twice', `${head}${head}`);
  const twiceDesk = run(join(tmp, 'twice', 'desktop', 'stage.sh'), [join(tmp, 'twice', 'out2'), '--desktop']);
  ok('a --desktop CSP patch that does not match exactly once fails it', twice.status === 0 && twiceDesk.status !== 0 && /not once/.test(twiceDesk.stderr), twiceDesk.stderr.trim());
  const nowhere = run(STAGE, ['/']);
  ok('it refuses to stage into /', nowhere.status !== 0 && existsSync('/usr'));
  const usage = run(STAGE, []);
  ok('and asks for an outdir', usage.status === 2 && /usage/.test(usage.stderr));
} catch (e) {
  ok('the check ran to the end', false, String(e && e.stack || e).slice(0, 300));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`---\n${total} checks, ${failed ? failed + ' failing' : 'all passing'}`);
process.exit(failed ? 1 : 0);
