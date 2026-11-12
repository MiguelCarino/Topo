// The desktop app as a server client, end to end (docs/SCOPE.md D144, step
// 7c): the page in Chromium runs js/server.js on js/desktopclient.js's
// transport, whose commands go to desktop/src-tauri's Rust client
// (src/client.rs, through examples/client-bridge.rs: the same transport the
// app's commands use, over stdin and stdout), against the real topo-server
// binary with a certificate it signs itself (TOPO_TLS_SELF). Not a run.sh
// suite: it starts the server and the bridge.
//
//   node tests/desktop-client-e2e.mjs [--port 7397] [--keep] [--no-build]
//
//   --port      the server's loopback port (default 7397, or
//               $TOPO_E2E_PORT). A busy port is an error: nothing is killed.
//   --keep      keep the temporary data folder and print it.
//   --no-build  use server/dist/topo-server and the bridge as they are
//               (otherwise `make -C server build` and
//               `cargo build --offline --example client-bridge` first).
//
// The page is served by Playwright itself (page.route on
// http://localhost:8399, a secure context with no socket opened), as the app
// serves its own files: it is not the server's page. The test checks that
// the page never fetches the server: every byte to it goes through Rust.
//
// A, the app window (1280 wide); B, a browser on the server's own address
// (the same owner on another PC). Covered:
//   1. Connect: the self-signed certificate's fingerprint is the server's
//      own (tls/cert.sha256), pinned on "They are the same: connect";
//   2. sign-in by the code from the mail sink, keys, the recovery key;
//   3. a network put on the server through Rust;
//   4. the event stream through Rust: B asks to open the account, A gets
//      the link-request event and approves; B opens the network A put;
//   5. B's edit reaches A by the 'head' event and a pull, through Rust;
//   6. a reload keeps the session (the cookie is Rust's), and so does the
//      app restarted (a new bridge on the same folder: the address, the pin
//      and the cookies are read back from the app's own files, which only
//      this user can read);
//   7. the server makes a new certificate: refused and said; checking it
//      again shows the new fingerprint, pinning it keeps the session;
//   8. Disconnect: signed out, nothing hooked, the app's files gone;
//   9. this PC's server on plain http (127.0.0.1, no certificate): connects
//      with no question, signs in, and a reload keeps the session (the
//      server's cookies over http have other names);
//   and no console errors, no CSP violations, no request from the page to
//   the server.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, normalize as normPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(join(ROOT, 'tests/node_modules/playwright/index.mjs'));

const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PORT = Number(argVal('--port') || process.env.TOPO_E2E_PORT || 7397);
const KEEP = args.includes('--keep');
const BUILD = !args.includes('--no-build');
const BIN = join(ROOT, 'server/dist/topo-server');
const TAURI = join(ROOT, 'desktop/src-tauri');
const BRIDGE = join(TAURI, 'target/debug/examples/client-bridge');
const ORIGIN = `https://127.0.0.1:${PORT}`;
const PLAIN = `http://127.0.0.1:${PORT}`;
const APP = 'http://localhost:8399';
const OWNER = 'owner@example.test';

const results = [];
const ok = (name, cond, extra) => {
    results.push(!!cond);
    console.log(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra !== undefined && !cond ? ' :: ' + JSON.stringify(extra).slice(0, 600) : ''}`);
    return !!cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) { console.error('bad --port'); process.exit(2); }
const portFree = () => new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(PORT, '127.0.0.1', () => s.close(() => res(true))); });
if (!(await portFree())) { console.error(`port ${PORT} is busy: free it or pass --port (nothing was stopped)`); process.exit(2); }

if (BUILD) {
    const b = spawnSync('make', ['-C', join(ROOT, 'server'), 'build'], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (b.status !== 0) { console.error('make -C server build failed'); process.exit(2); }
    const c = spawnSync('cargo', ['build', '--offline', '-j', '4', '--example', 'client-bridge'], { cwd: TAURI, stdio: ['ignore', 'ignore', 'inherit'] });
    if (c.status !== 0) { console.error('cargo build --example client-bridge failed'); process.exit(2); }
}
for (const f of [BIN, BRIDGE]) if (!existsSync(f)) { console.error('missing ' + f); process.exit(2); }

// ---- The server ----
const data = mkdtempSync(join(tmpdir(), 'topo-dc-e2e-'));
let child = null, exited = true, plain = false;
function startServer() {
    child = spawn(BIN, ['serve'], {
        env: {
            PATH: process.env.PATH, HOME: process.env.HOME, TOPO_DATA: data, TOPO_LISTEN: `127.0.0.1:${PORT}`, TOPO_PUBLIC_URL: plain ? PLAIN : ORIGIN, TOPO_TLS_SELF: plain ? '0' : '1',
            TOPO_MAIL: 'file', TOPO_OWNER_EMAIL: OWNER, TOPO_NOTIFY_REVISION_MINUTES: '0', TOPO_NOTIFY_EVENT_SECONDS: '0', TOPO_LOG_LEVEL: 'warn', TOPO_MAIL_PER_MINUTE: '1000'
        },
        stdio: ['ignore', 'inherit', 'inherit'], detached: true
    });
    exited = false;
    child.on('exit', () => { exited = true; });
}
const signal = (sig) => { if (child && !exited) try { process.kill(-child.pid, sig); } catch (e) { /* gone */ } };
async function stopServer() {
    signal('SIGTERM');
    for (let i = 0; i < 50 && !exited; i++) await sleep(100);
    if (!exited) signal('SIGKILL');
}
// /api/health over https, the certificate not checked (this is the test
// harness, not the client under test).
const health = () => new Promise((res) => {
    const r = (plain ? http : https).get((plain ? PLAIN : ORIGIN) + '/api/health', { rejectUnauthorized: false, timeout: 2000 }, (x) => { x.resume(); res(x.statusCode === 200); });
    r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
});
async function serverUp() {
    for (let i = 0; i < 100 && !exited; i++) { if (await health()) return true; await sleep(100); }
    return false;
}
const certFp = () => readFileSync(join(data, 'tls', 'cert.sha256'), 'utf8').trim();

// ---- The bridge (the app's Rust transport) ----
// Its folder is the app's config and data folders: client.json and
// client/session.json, written by the app's own code (src/client.rs Store).
const appDir = mkdtempSync(join(tmpdir(), 'topo-dc-app-'));
const pending = new Map();
let nextId = 0;
const streamTo = new Map();   // bridge stream id -> { page, chan }
const bridgeLog = [];
let bridge = null;
function startBridge() {
    const b = spawn(BRIDGE, [appDir], { stdio: ['pipe', 'pipe', 'inherit'] });
    createInterface({ input: b.stdout }).on('line', (line) => {
        let m;
        try { m = JSON.parse(line); } catch (e) { return; }
        if (m.stream !== undefined) {
            const to = streamTo.get(m.stream);
            if (to) to.page.evaluate(([c, msg]) => { const ch = (window.__chans || {})[c]; if (ch && ch.onmessage) ch.onmessage(msg); }, [to.chan, m.msg]).catch(() => {});
            return;
        }
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); p(m); }
    });
    bridge = b;
}
// The app quits and starts again: what it knew comes back from its files.
async function restartBridge() {
    const old = bridge;
    bridge = null;   // calls made while it restarts are answered offline, as the app's would be
    const gone = new Promise((r) => old.once('exit', r));
    old.stdin.end(); old.kill('SIGTERM');
    await gone;
    for (const [, p] of pending) p({ ok: false, error: 'offline' });
    pending.clear(); streamTo.clear();
    startBridge();
}
startBridge();
function call(cmd, a) {
    const id = ++nextId;
    bridgeLog.push(cmd + ' ' + (a && a.path ? a.method + ' ' + a.path : ''));
    if (!bridge || bridge.stdin.writableEnded) return Promise.resolve({ ok: false, error: 'offline' });
    return new Promise((res) => { pending.set(id, res); bridge.stdin.write(JSON.stringify({ id, cmd, args: a || {} }) + '\n'); });
}

// ---- The mail sink ----
const mails = () => {
    const f = join(data, 'mail', 'outbox.jsonl');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
async function readMail(to, kind, after = 0) {
    for (let i = 0; i < 200; i++) {
        const m = mails().filter((x) => x.to === to && x.kind === kind);
        if (m.length > after) return m[m.length - 1];
        await sleep(100);
    }
    return null;
}
const countMail = (to, kind) => mails().filter((x) => x.to === to && x.kind === kind).length;

// ---- The pages ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' };
const browser = await chromium.launch();
const errors = { A: [], B: [] };
let pageToServer = 0;

async function appContext() {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await c.route(APP + '/**', (route) => {
        const u = new URL(route.request().url());
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
        const file = normPath(join(ROOT, rel));
        if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
        route.fulfill({ status: 200, body: readFileSync(file), headers: { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' } });
    });
    // window.__TAURI__ as the app's: invoke goes to the bridge, a Channel is
    // a number the bridge's stream messages are delivered to.
    await c.addInitScript(() => {
        // The first-run welcome (js/welcome.js) is tests/suites/welcome.js's.
        try { localStorage.setItem('topo-welcome', JSON.stringify({ v: 1, at: 1, how: 'done' })); } catch (e) { /* none */ }
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI));
        window.__chans = {};
        let n = 0;
        class Channel { constructor() { this.id = ++n; this.onmessage = null; window.__chans[this.id] = this; } }
        window.__TAURI__ = { core: { Channel, invoke: async (cmd, args) => {
            const a = {};
            for (const [k, v] of Object.entries(args || {})) a[k] = v instanceof Channel ? { __channel: v.id } : v;
            const r = await window.__bridge(cmd, a);
            if (!r.ok) throw r.error;
            return r.result;
        } } };
    });
    const p = await c.newPage();
    await p.exposeFunction('__bridge', async (cmd, a) => {
        if (!/^client_/.test(cmd)) return { ok: false, error: 'unknown command ' + cmd };
        if (cmd === 'client_events') {
            const r = await call(cmd, { path: a.path });
            if (r.ok) streamTo.set(r.result, { page: p, chan: a.onEvent.__channel });
            return r;
        }
        return call(cmd, a);
    });
    // A reload drops the page's streams (the app's on_page_load).
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) call('page_load'); });
    p.on('request', (r) => { if (r.url().startsWith(ORIGIN) || r.url().startsWith(PLAIN)) pageToServer++; });
    p.on('console', (m) => { if (m.type() === 'error') errors.A.push(m.text()); });
    p.on('pageerror', (e) => errors.A.push(String(e)));
    return { c, p };
}
const until = async (p, fn, arg, ms = 20000) => { try { await p.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (e) { return false; } };
const reloaded = async (p, act) => { await Promise.all([p.waitForNavigation({ timeout: 20000 }), act()]); await p.waitForLoadState('load'); };
const status = (p) => p.evaluate(() => TopoServer.state.status);

startServer();
let failed = false;
try {
    ok('0. the server starts with a certificate it signs itself', await serverUp() && /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(certFp()));
    const fp1 = certFp();
    const A = await appContext();
    await A.p.goto(APP + '/index.html?lang=en');
    await A.p.waitForLoadState('load');

    // 1. Connect: compare, pin.
    await A.p.evaluate(() => openSettings());
    ok('1. Settings has "Connect to a Topo server" in the app', await until(A.p, () => !document.getElementById('setDcSec').hidden));
    await A.p.fill('#setDcUrl', ORIGIN);
    await A.p.click('#setDcConnect');
    ok('1. the fingerprint to compare is the server\'s own certificate', await until(A.p, () => !document.getElementById('setDcCompare').hidden)
        && (await A.p.textContent('#setDcFp')) === fp1, await A.p.textContent('#setDcFp'));
    await reloaded(A.p, () => A.p.click('#setDcTrust'));
    ok('1. connected: the page reloads as a client of that server', await until(A.p, () => TopoServer.state.status === 'signed-out') && (await A.p.evaluate(() => TopoServer._hooks.origin)) === ORIGIN, await status(A.p));
    ok('1. "On this server" asks to sign in', await until(A.p, () => !document.getElementById('landingServer').hidden));

    // 2. Sign in (the existing email sign-in, through Rust).
    await A.p.click('#serverAccountBtn');
    await A.p.fill('#serverSheetBody input[type=email]', OWNER);
    await A.p.click('#serverSheetBody button.primary');
    const m1 = await readMail(OWNER, 'signin');
    ok('2. the sign-in code is in the sink', !!m1 && /^\d{6}$/.test(m1.code), m1);
    await A.p.waitForSelector('#serverSheetBody input[inputmode=numeric]');
    await A.p.fill('#serverSheetBody input[inputmode=numeric]', m1.code);
    ok('2. the recovery key is shown once', await until(A.p, () => !!document.getElementById('serverRecoveryCode')));
    await A.p.check('#serverSheetBody input[type=checkbox]');
    await A.p.click('#serverSheetBody button.primary');
    ok('2. A is signed in with keys', await until(A.p, () => TopoServer.state.status === 'ready'), await status(A.p));

    // 3. A network on the server.
    const cardId = await A.p.evaluate(() => { loadDocState(templatesData.house); autoBindLinks(); return librarySave('Office'); });
    await A.p.evaluate(async (id) => { TopoServerUI.setServerResponder((q) => (q.kind === 'show-name' ? false : null)); await TopoServerUI.putOnServer(id); }, cardId);
    ok('3. put on the server through Rust: Synced at head 1', await until(A.p, (id) => { const r = TopoServerSync.rec(id); return r && r.baseN === 1 && TopoServerSync.cardSync(id).state === 'synced'; }, cardId));
    const siteId = await A.p.evaluate((id) => TopoServerSync.rec(id).siteId, cardId);
    const db = (sql) => spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), sql], { encoding: 'utf8' }).stdout.trim();
    ok('3. the server holds head 1', db(`SELECT head_n FROM sites WHERE id = '${siteId.replace(/[^\w-]/g, '')}'`) === '1');

    // 4. The event stream through Rust.
    await A.p.evaluate(() => { window.__linkEvents = 0; TopoServer.on('event:link-request', () => { window.__linkEvents++; }); });
    const Bc = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
    await Bc.addInitScript(() => { try { localStorage.setItem('topo-welcome', JSON.stringify({ v: 1, at: 1, how: 'done' })); } catch (e) { /* none */ } });
    const B = await Bc.newPage();
    B.on('console', (m) => { if (m.type() === 'error') errors.B.push(m.text()); });
    B.on('pageerror', (e) => errors.B.push(String(e)));
    await B.goto(ORIGIN + '/');
    ok('4. B (a browser on the server) starts signed out', await until(B, () => TopoServer.state.status === 'signed-out'));
    const before = countMail(OWNER, 'signin');
    const chal = await B.evaluate((e) => TopoServer.requestCode(e), OWNER);
    const m2 = await readMail(OWNER, 'signin', before);
    await B.evaluate(([c, code, e]) => TopoServer.verifyCode(c, code, e), [chal, m2 && m2.code, OWNER]);
    ok('4. B signs in as the same owner: a new PC, locked', await until(B, () => TopoServer.state.status === 'locked'), await status(B));
    await B.evaluate(() => { window.__link = TopoServer.startLink(); });
    ok('4. A gets the link-request event through Rust', await until(A.p, () => window.__linkEvents >= 1));
    const approved = await A.p.evaluate(async () => { const r = await TopoServer.linkRequests(); if (!r.length) return false; await TopoServer.approveLink(r[0]); return true; });
    ok('4. A approves; B is let in', approved && await until(B, () => TopoServer.state.status === 'ready'), await status(B));
    await B.evaluate(async (s) => { TopoServerUI.setServerResponder(() => true); await TopoServerSync.openSite(s); }, siteId);
    ok('4. B opens the network A put on the server, the same one', await until(B, (id) => state.libraryId === id, cardId)
        && (await B.evaluate((id) => revHashOf(libraryEntry(id).doc), cardId)) === (await A.p.evaluate((id) => revHashOf(libraryEntry(id).doc), cardId)));

    // 5. B's edit reaches A: the 'head' event, then a pull, through Rust.
    await B.evaluate(() => { TopoServerSync._hooks.quietMs = 200; TopoServerSync._hooks.maxMs = 1000; });
    await A.p.evaluate(() => { window.__heads = 0; TopoServer.on('event:head', () => { window.__heads++; }); });
    await B.evaluate((id) => { const lib = loadLibrary(); lib[id].doc.nodes[0].name = 'Renamed by B'; lib[id].updated = Date.now(); persistLibrary(lib); serverAfterSave(id); TopoServerSync.syncNow(id); }, cardId);
    ok('5. B pushed head 2', await until(B, (id) => TopoServerSync.rec(id).baseN === 2, cardId));
    ok('5. A got the head event and pulled B\'s edit', await until(A.p, (id) => window.__heads >= 1 && TopoServerSync.rec(id).baseN === 2 && libraryEntry(id).doc.nodes[0].name === 'Renamed by B', cardId),
        await A.p.evaluate((id) => [window.__heads, TopoServerSync.rec(id).baseN], cardId));

    // 6. A reload keeps the session (Rust holds the cookie).
    await A.p.reload(); await A.p.waitForLoadState('load');
    ok('6. after a reload A is still signed in, with no sign-in', await until(A.p, () => TopoServer.state.status === 'ready'), await status(A.p));
    ok('6. the page never holds the session cookie', !(await A.p.evaluate(() => document.cookie)).includes('topo'));
    const saved = JSON.parse(readFileSync(join(appDir, 'client.json'), 'utf8'));
    const sess = join(appDir, 'client', 'session.json');
    ok('6. the app keeps the address and the pin, and the cookies in a file only this user can read',
        saved.url === ORIGIN && saved.pin === fp1 && existsSync(sess) && (statSync(sess).mode & 0o777) === 0o600 && Object.keys(JSON.parse(readFileSync(sess, 'utf8')).cookies).length > 0, saved);
    await restartBridge();
    await A.p.reload(); await A.p.waitForLoadState('load');
    ok('6. the app restarted: still connected and signed in, from its files', await until(A.p, () => TopoServer.state.status === 'ready'), await status(A.p));

    // 7. A new certificate on the server.
    await stopServer();
    rmSync(join(data, 'tls'), { recursive: true, force: true });
    startServer();
    ok('7. the server is back with a new certificate', await serverUp() && certFp() !== fp1);
    const fp2 = certFp();
    await A.p.reload(); await A.p.waitForLoadState('load');
    ok('7. the changed certificate is refused: nothing opens', await until(A.p, () => TopoServer.state.status === 'unreachable'), await status(A.p));
    ok('7. …and said', await until(A.p, () => /certificate changed/.test(document.getElementById('topoToast').textContent)));
    await A.p.evaluate(() => openSettings());
    ok('7. Settings says why and offers to check it again', await until(A.p, () => /certificate changed since this window connected/.test(document.getElementById('setDcStatus').textContent) && !document.getElementById('setDcAgain').hidden));
    await A.p.click('#setDcAgain');
    ok('7. checking again shows the new fingerprint', await until(A.p, () => !document.getElementById('setDcCompare').hidden) && (await A.p.textContent('#setDcFp')) === fp2);
    await reloaded(A.p, () => A.p.click('#setDcTrust'));
    ok('7. pinned again: still signed in (the same server keeps the session)', await until(A.p, () => TopoServer.state.status === 'ready'), await status(A.p));

    // 8. Disconnect.
    await A.p.evaluate(() => { setDialogResponder(() => true); openSettings(); });
    await until(A.p, () => !document.getElementById('setDcOn').hidden);
    await reloaded(A.p, () => A.p.click('#setDcDisconnect'));
    await A.p.waitForTimeout(500);
    ok('8. disconnected: nothing hooked, no server section', (await A.p.evaluate(() => [TopoServer._hooks.force, TopoServer.state.status].join(','))) === 'false,off'
        && await A.p.evaluate(() => document.getElementById('landingServer').hidden));
    ok('8. the bridge forgot the server, and its files', (await call('client_info')).result.url === '' && !existsSync(join(appDir, 'client.json')) && !existsSync(join(appDir, 'client', 'session.json')));

    // 9. This PC's server on plain http.
    await stopServer();
    plain = true;
    startServer();
    ok('9. the server is back on plain http at 127.0.0.1', await serverUp());
    await A.p.evaluate(() => openSettings());
    await until(A.p, () => !document.getElementById('setDcForm').hidden);
    await A.p.fill('#setDcUrl', PLAIN);
    await reloaded(A.p, () => A.p.click('#setDcConnect'));
    ok('9. connected with no certificate to compare, no pin', await until(A.p, () => TopoServer.state.status === 'signed-out') && (await call('client_info')).result.pin === '' && (await A.p.evaluate(() => TopoServer._hooks.origin)) === PLAIN, await status(A.p));
    const before9 = countMail(OWNER, 'signin');
    await A.p.evaluate(() => TopoServerUI.openSignIn());
    await A.p.fill('#serverSheetBody input[type=email]', OWNER);
    await A.p.click('#serverSheetBody button.primary');
    const m9 = await readMail(OWNER, 'signin', before9);
    await A.p.waitForSelector('#serverSheetBody input[inputmode=numeric]');
    await A.p.fill('#serverSheetBody input[inputmode=numeric]', m9 && m9.code);
    const signedIn = () => ['ready', 'locked', 'needs-keys'].includes(TopoServer.state.status);
    ok('9. signed in over http, through Rust', await until(A.p, signedIn), await status(A.p));
    const httpJar = JSON.parse(readFileSync(sess, 'utf8'));
    ok('9. the http session cookie is kept (no __Host- name over http)', Object.keys(httpJar.cookies).length > 0 && !Object.keys(httpJar.cookies).some((n) => n.startsWith('__Host-')) && httpJar.origin === PLAIN, Object.keys(httpJar.cookies));
    await A.p.reload(); await A.p.waitForLoadState('load');
    ok('9. a reload keeps the session', await until(A.p, signedIn), await status(A.p));

    const real = (l) => l.filter((x) => !/^Failed to load resource/.test(x));
    ok('no console errors in the app window', real(errors.A).length === 0, errors.A);
    ok('no console errors on B', real(errors.B).length === 0, errors.B);
    ok('no CSP violations in the app window', (await A.p.evaluate(() => window.__cspViolations.length)) === 0, await A.p.evaluate(() => window.__cspViolations));
    ok('the app window never fetched the server: everything went through Rust', pageToServer === 0, pageToServer);
} catch (e) {
    failed = true;
    ok('the script ran to the end', false, String((e && e.stack) || e));
} finally {
    await browser.close();
    bridge.stdin.end(); bridge.kill('SIGTERM');
    await stopServer();
    if (KEEP) console.log('data kept in ' + data + ' and ' + appDir); else { rmSync(data, { recursive: true, force: true }); rmSync(appDir, { recursive: true, force: true }); }
    const bad = results.filter((r) => !r).length;
    console.log(`--- ${results.length} checks, ${bad} failing`);
    process.exit(bad || failed ? 1 : 0);
}
