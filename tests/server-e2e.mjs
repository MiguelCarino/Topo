// The Topo server end to end: the real topo-server binary and the real app in
// Chromium (docs/SCOPE.md step 5a, design §11.3). Not a run.sh suite: run.sh
// serves the repository with a static server, this starts the binary.
//
//   node tests/server-e2e.mjs [--port 7381] [--keep] [--no-build] [--no-rust]
//
//   --port      the loopback port for the server (default 7381, or
//               $TOPO_E2E_PORT). A busy port is an error: nothing is killed.
//   --keep      keep the temporary data folder (topo.db, mail/) and print it.
//   --no-build  use server/dist/topo-server as it is (otherwise
//               `make -C server build` stages the app and builds it first).
//   $TOPO_E2E_BIN  a binary to use instead (implies --no-build).
//   --no-rust      skip step 15k (the app's Rust link, built with cargo).
//
// The server runs with TOPO_MAIL=file in a temporary data folder, so every
// email lands in <data>/mail/outbox.jsonl (one JSON line each) and as an .eml;
// sign-in codes and links are read from there. Event emails are sent at once
// (TOPO_NOTIFY_EVENT_SECONDS=0, TOPO_NOTIFY_REVISION_MINUTES=0).
//
// Step 10b: a report to a provider who is not a member is emailed by the
// server (report-mail, docs/SCOPE.md D87): the .eml's HTML part has the
// hyperlink "Follow the infrastructure link" to this server, the plain part
// the raw link, Reply-To the client, the phone as tel:; a foreign link is
// refused, the 11th send in an hour is 429, a removed member is 404.
//
// Two browser contexts in one Chromium: A, the owner (touch, 1280 wide), and
// B, the provider (a phone: touch, 390x844). Every step prints PASS :: or
// FAIL ::, and the last line counts them; the exit code is 1 on any failure.
// The child server is spawned in its own process group, and only it is
// stopped at the end (SIGTERM, then SIGKILL after 5 s).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(join(ROOT, 'tests/node_modules/playwright/index.mjs'));

const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PORT = Number(argVal('--port') || process.env.TOPO_E2E_PORT || 7381);
const KEEP = args.includes('--keep');
const BIN = process.env.TOPO_E2E_BIN || join(ROOT, 'server/dist/topo-server');
const BUILD = !process.env.TOPO_E2E_BIN && !args.includes('--no-build');
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OWNER = 'owner@example.test', PROV = 'prov@example.test';

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
}
if (!existsSync(BIN)) { console.error('no binary at ' + BIN); process.exit(2); }

const data = mkdtempSync(join(tmpdir(), 'topo-e2e-'));
// Step 5b: the folder backups may go to (TOPO_BACKUP_FOLDERS) and the
// folder the owner picks inside it (it must exist: the server never makes
// the chosen folder, amendment 13).
const bkRoot = join(data, 'bkroot'), bk = join(bkRoot, 'usb');
mkdirSync(bk, { recursive: true, mode: 0o700 });
const child = spawn(BIN, ['serve'], {
    env: {
        PATH: process.env.PATH, HOME: process.env.HOME, TOPO_DATA: data, TOPO_LISTEN: `127.0.0.1:${PORT}`, TOPO_PUBLIC_URL: ORIGIN,
        TOPO_MAIL: 'file', TOPO_OWNER_EMAIL: OWNER, TOPO_NOTIFY_REVISION_MINUTES: '0', TOPO_NOTIFY_EVENT_SECONDS: '0', TOPO_LOG_LEVEL: 'warn',
        TOPO_MAIL_PER_MINUTE: '1000', TOPO_BACKUP_FOLDERS: bkRoot, TOPO_BACKUP_DEBOUNCE: '0s', TOPO_BACKUP_TICK: '1s',
        TOPO_MONITOR_SWEEP: '200ms'
    },
    stdio: ['ignore', 'inherit', 'inherit'], detached: true
});
let exited = false;
child.on('exit', () => { exited = true; });
const signal = (sig) => { if (!exited) try { process.kill(-child.pid, sig); } catch (e) { /* gone */ } };
process.on('exit', () => signal('SIGKILL'));
async function stopServer() {
    signal('SIGTERM');
    for (let i = 0; i < 50 && !exited; i++) await sleep(100);
    if (!exited) signal('SIGKILL');
}

let up = false;
for (let i = 0; i < 100 && !exited; i++) {
    try { const r = await fetch(ORIGIN + '/api/health'); if (r.ok) { up = true; break; } } catch (e) { /* not yet */ }
    await sleep(100);
}
if (!up) { console.error('the server did not start'); await stopServer(); process.exit(2); }

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
// The whole message as written (headers, text and HTML parts).
const emlOf = (m) => {
    const dir = join(data, 'mail');
    const f = readdirSync(dir).find((n) => n.endsWith('-' + m.id + '.eml'));
    return f ? readFileSync(join(dir, f), 'utf8') : '';
};
// The parts of a message, quoted-printable decoded: { head, type, text,
// html, files: [{ head, name, bytes }] }; a multipart/mixed one (a report
// with its PDF, D97) is read through its nested alternative.
const partsOf = (eml) => {
    const head = eml.slice(0, eml.indexOf('\r\n\r\n'));
    const out = { head, type: (/Content-Type: ([^;\r\n]+)/i.exec(head) || [])[1] || '', text: '', html: '', files: [] };
    const walk = (h, bodyAll) => {
        const b = /boundary="([^"]+)"/.exec(h);
        if (!b) return;
        for (const seg of bodyAll.split('--' + b[1]).slice(1, -1)) {
            const i = seg.indexOf('\r\n\r\n');
            const sh = seg.slice(0, i).replace(/^\r\n/, ''), body = seg.slice(i + 4).replace(/\r\n$/, '');
            if (/multipart\//i.test(sh)) { walk(sh, body); continue; }
            if (/Content-Disposition: attachment/i.test(sh)) {
                out.files.push({ head: sh, name: (/filename="?([^";\r\n]+)/.exec(sh) || [])[1] || '', bytes: Buffer.from(body.replace(/\r\n/g, ''), 'base64') });
                continue;
            }
            const dec = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (x, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8');
            if (/text\/html/.test(sh)) out.html = dec; else if (/text\/plain/.test(sh)) out.text = dec;
        }
    };
    walk(head, eml.slice(eml.indexOf('\r\n\r\n') + 4));
    return out;
};

// ---- Browsers ----
const TOUCHAUDIT = readFileSync(join(ROOT, 'tests/fixtures/touchaudit.js'), 'utf8');
const browser = await chromium.launch();
const errors = { A: [], B: [] };
async function ctx(name, opts) {
    const c = await browser.newContext(opts);
    await c.addInitScript(() => {
        // The first-run welcome (js/welcome.js) is tests/suites/welcome.js's;
        // these browsers have seen it.
        try { localStorage.setItem('topo-welcome', JSON.stringify({ v: 1, at: 1, how: 'done' })); } catch (e) { /* none */ }
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI));
    });
    const p = await c.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errors[name].push(m.text()); });
    p.on('pageerror', (e) => errors[name].push(String(e)));
    return { c, p };
}
const until = async (p, fn, arg, ms = 20000) => { try { await p.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (e) { return false; } };
const sheetText = (p) => p.evaluate(() => (document.getElementById('serverSheetBody') || {}).textContent || '');
// tests/fixtures/touchaudit.js on what is on the screen now (evaluated, so
// the page's CSP is not involved).
async function audit(p, label) {
    await p.evaluate(TOUCHAUDIT);
    await p.waitForTimeout(150);
    const r = await p.evaluate((l) => { const x = window.touchAudit(l); return { lines: x.lines.filter((s) => !/^screen not reached/.test(s)), measured: x.measured }; }, label);
    const w = await p.evaluate(() => innerWidth);
    ok(`${label} @${w}: 44px targets, 16px fields, nothing past the edge`, !r.lines.length && r.measured > 0, r.lines.slice(0, 6));
    ok(`${label} @${w}: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
const head = async (siteId) => {
    const db = spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), `SELECT head_n || ' ' || epoch FROM sites WHERE id = '${siteId.replace(/[^\w-]/g, '')}'`], { encoding: 'utf8' });
    return db.status === 0 ? db.stdout.trim() : null;
};

try {
    // 1. A loads the app from the server.
    const A = await ctx('A', { viewport: { width: 1280, height: 900 }, hasTouch: true });
    const res = await A.p.goto(ORIGIN + '/');
    ok('1. the app loads from the server', res && res.status() === 200);
    ok('1. the server marker is in the page', await A.p.evaluate(() => !!document.querySelector('meta[name="topo-server"]')));
    const health = await (await fetch(ORIGIN + '/api/health')).json();
    ok('1. health is ok', health.ok === true && health.server === 'topo' && typeof health.appHash === 'string', health);
    ok('1. "On this server" asks to sign in', await until(A.p, () => !document.getElementById('landingServer').hidden && TopoServer.state.status === 'signed-out'));

    // 2. A signs in with the code from the sink; keys and the recovery key.
    await A.p.click('#serverAccountBtn');
    await A.p.fill('#serverSheetBody input[type=email]', OWNER);
    await A.p.click('#serverSheetBody button.primary');
    const m1 = await readMail(OWNER, 'signin');
    ok('2. the sign-in code is in the sink', !!m1 && /^\d{6}$/.test(m1.code), m1);
    await A.p.waitForSelector('#serverSheetBody input[inputmode=numeric]');
    await A.p.fill('#serverSheetBody input[inputmode=numeric]', m1.code);
    ok('2. the recovery key is shown once', await until(A.p, () => /^[a-z2-9]{4}(-[a-z2-9]{4}){6}$/.test((document.getElementById('serverRecoveryCode') || {}).textContent || '')));
    // Kept for step 14c: a backup opened with no server takes it.
    const recoveryA = await A.p.evaluate(() => document.getElementById('serverRecoveryCode').textContent);
    ok('2. an owner cannot skip it', !(await A.p.$('#serverSheetBody button:has-text("Skip")')));
    await A.p.check('#serverSheetBody input[type=checkbox]');
    await A.p.click('#serverSheetBody button.primary');
    ok('2. A is signed in with keys', await until(A.p, () => TopoServer.state.status === 'ready'), await A.p.evaluate(() => TopoServer.state.status));
    ok('2. A is the server owner', await A.p.evaluate(() => TopoServer.me().serverRole === 'owner'));

    // 3. A keeps a network and puts it on the server.
    const cardId = await A.p.evaluate(() => {
        loadDocState(templatesData.house); autoBindLinks();
        state.providers = [makeProvider({ name: 'Acme IT', email: 'prov@example.test', service: 'it' })];
        return librarySave('Office');
    });
    await A.p.evaluate(async (id) => {
        TopoServerUI.setServerResponder((q) => (q.kind === 'show-name' ? false : null));
        await TopoServerUI.putOnServer(id);
    }, cardId);
    ok('3. put on the server: Synced at head 1', await until(A.p, (id) => { const r = TopoServerSync.rec(id); return r && r.baseN === 1 && TopoServerSync.cardSync(id).state === 'synced'; }, cardId),
        await A.p.evaluate((id) => TopoServerSync.rec(id), cardId));
    const siteId = await A.p.evaluate((id) => TopoServerSync.rec(id).siteId, cardId);
    ok('3. the server holds head 1, epoch 1', (await head(siteId)) === '1 1', await head(siteId));
    const dbText = spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), 'SELECT quote(name_ct), quote(name_clear) FROM sites'], { encoding: 'utf8' }).stdout;
    ok('3. the server has no name in clear and no network text', !/Office|Acme/.test(dbText) && /NULL$/.test(dbText.trim()), dbText);
    await A.p.evaluate(() => openLanding(false));
    ok('3. the card sits in "On this server" and says Synced', await until(A.p, () => /Synced/.test(document.getElementById('landingServer').textContent)));

    // 4. A invites the provider.
    await A.p.evaluate(async (s) => TopoServerSync.invite(s, 'prov@example.test', 'provider', 'en'), siteId);
    const inv = await readMail(PROV, 'invite');
    ok('4. the invitation is in the sink', !!inv && /#invite=/.test(inv.link), inv);
    ok('4. the invitation has no network content', !!inv && !/Office|Acme|house/i.test(emlOf(inv)));

    // 5. B (a phone) opens the invitation, signs in by the magic link.
    const B = await ctx('B', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await B.p.goto(inv.link);
    ok('5. the invitation sheet shows', await until(B.p, () => /invited you/.test(document.getElementById('serverSheetBody').textContent)));
    ok('5. the token left the address bar', !(await B.p.evaluate(() => location.hash)));
    await B.p.click('#serverSheetBody button.primary');
    await B.p.waitForSelector('#serverSheetBody input[type=email]');
    ok('5. the email is prefilled', (await B.p.inputValue('#serverSheetBody input[type=email]')) === PROV);
    await audit(B.p, '13. the sign-in sheet, email');
    await B.p.click('#serverSheetBody button.primary');
    const m2 = await readMail(PROV, 'signin');
    ok('5. B\'s sign-in link is in the sink', !!m2 && /#signin=/.test(m2.link), m2);
    await audit(B.p, '13. the sign-in sheet, code');
    // A second browser cannot use the link (it is bound to the one that asked).
    const other = await browser.newContext();
    const op = await other.newPage();
    await op.goto(m2.link);
    if (await until(op, () => /Sign in to Topo on this browser/.test((document.getElementById('serverSheetBody') || {}).textContent || ''), undefined, 10000)) {
        await op.click('#serverSheetBody button.primary');
        ok('5. the link refuses another browser', await until(op, () => /browser where you asked/.test(document.getElementById('serverSheetBody').textContent), undefined, 10000));
    } else ok('5. the link refuses another browser', false, 'no link sheet');
    await other.close();
    await B.p.goto(m2.link);
    ok('5. "Sign in to Topo on this browser?"', await until(B.p, () => /Sign in to Topo on this browser/.test(document.getElementById('serverSheetBody').textContent)));
    await B.p.click('#serverSheetBody button.primary');
    ok('5. B\'s recovery key is shown', await until(B.p, () => !!document.getElementById('serverRecoveryCode')));
    const skip = await B.p.$('#serverSheetBody button:has-text("Skip")');
    ok('5. a member may skip the recovery key', !!skip);
    if (skip) await skip.click();
    ok('5. B is signed in with keys', await until(B.p, () => TopoServer.state.status === 'ready'));
    ok('5. B accepted and waits', await until(B.p, (s) => (TopoServer.site(s) || {}).status === 'waiting', siteId), await B.p.evaluate(() => TopoServer.state.sites));
    await B.p.evaluate(() => { TopoServerUI.closeSheet(); openLanding(false); });
    ok('5. B\'s landing says it waits for the owner', await until(B.p, () => /Waiting for the owner to give you access/.test(document.getElementById('landingServer').textContent)));
    const bCode = await B.p.evaluate(() => (document.getElementById('landingServer').textContent.match(/Your safety code: ([\d ]+)/) || [])[1] || '');
    ok('5. B\'s card shows its 24-digit safety code', bCode.replace(/\D/g, '').length === 24, bCode);
    const joined = await readMail(OWNER, 'member-joined');
    ok('5. A got the member-joined email', !!joined);
    ok('5. it names no network', !!joined && !/Office|Acme/.test(emlOf(joined)));

    // 6. A gives access from Members, comparing the safety code.
    ok('6. A sees the waiting badge', await until(A.p, () => (TopoServer.me() || {}).waitingGrants === 1));
    // No responders: the real Give access question, read and answered on
    // screen.
    await A.p.evaluate(async (s) => {
        TopoServerUI.setServerResponder(null);
        setDialogResponder(null);
        await TopoServerUI.openMembers(s);
    }, siteId);
    ok('6. Members lists B as "Accepted: give access"', await until(A.p, () => /Accepted: give access/.test(document.getElementById('serverSheetBody').textContent) && !!document.querySelector('#serverSheetBody button.primary')));
    await A.p.click('#serverSheetBody .srv-row button:has-text("Give access")');
    ok('6. the compare question opens', await until(A.p, () => { const a = document.getElementById('topoAsk'); return !!a && !a.hidden && getComputedStyle(a).display !== 'none'; }));
    const askMsg = await A.p.evaluate(() => document.getElementById('topoAskMsg').textContent);
    const seenCode = (askMsg.match(/\d{4}(?: \d{4}){5}/) || [''])[0];
    ok('6. the code the owner compares is B\'s own', seenCode !== '' && seenCode.replace(/\D/g, '') === bCode.replace(/\D/g, '') && askMsg.includes(PROV), [askMsg, bCode]);
    await A.p.click('#topoAskFoot button:has-text("Yes, give access")');
    ok('6. B is granted (live)', await until(B.p, (s) => (TopoServer.site(s) || {}).status === 'granted', siteId));
    ok('6. the granted email', !!(await readMail(PROV, 'granted')));
    await A.p.evaluate(() => TopoServerUI.closeSheet());
    await B.p.evaluate(async (s) => { TopoServerUI.setServerResponder(() => true); await TopoServerSync.openSite(s); }, siteId);
    ok('6. B opened the site', await until(B.p, (id) => state.libraryId === id, cardId));
    const same = await Promise.all([A.p, B.p].map((p) => p.evaluate((id) => revHashOf(libraryEntry(id).doc), cardId)));
    ok('6. B decrypted the same network', same[0] === same[1], same);
    ok('6. B\'s "who am I" is Acme IT', await B.p.evaluate(() => { const id = providerSelfOf(state.docId); return !!id && (state.providers.find((p) => p.id === id) || {}).name === 'Acme IT'; }));

    // 7. B is a provider: it never pushes (docs/SCOPE.md D154). Offline
    //    edits on both; A pushes; B pulls and keeps its own edit on top (a
    //    quiet merge here); B's edit waits for a visit; a push B's app tries
    //    anyway (as a v0.0.1 app would) is refused: 403 owners-only.
    for (const p of [A.p, B.p]) await p.evaluate(() => { TopoServerSync._hooks.quietMs = 200; TopoServerSync._hooks.maxMs = 1000; });
    let bPosts = 0;
    B.p.on('request', (r) => { if (r.method() === 'POST' && /\/revs$/.test(new URL(r.url()).pathname)) bPosts++; });
    await A.c.setOffline(true);
    await B.c.setOffline(true);
    await A.p.evaluate((id) => { const lib = loadLibrary(); lib[id].doc.nodes[0].name = 'Renamed by A'; lib[id].updated = Date.now(); persistLibrary(lib); serverAfterSave(id); }, cardId);
    await B.p.evaluate(() => { batch(() => { state.nodes[1].notes = 'Note by B'; save(); }); flushAutosave(); });
    ok('7. B offline: the card keeps the local change', await until(B.p, (id) => TopoServerSync.dirty(id), cardId), await B.p.evaluate((id) => TopoServerSync.cardSync(id), cardId));
    await B.c.setOffline(false);
    await A.c.setOffline(false);
    await A.p.evaluate((id) => TopoServerSync.syncNow(id), cardId);
    ok('7. A pushed head 2', await until(A.p, (id) => TopoServerSync.rec(id).baseN >= 2, cardId), await A.p.evaluate((id) => TopoServerSync.rec(id), cardId));
    await B.p.evaluate((id) => TopoServerSync.syncNow(id), cardId);
    ok('7. B pulled head 2 and kept its own edit on top', await until(B.p, (id) => TopoServerSync.rec(id).baseN === 2 && libraryEntry(id).doc.nodes[0].name === 'Renamed by A'
        && libraryEntry(id).doc.nodes[1].notes === 'Note by B', cardId), await B.p.evaluate((id) => [TopoServerSync.rec(id), TopoServerSync.cardSync(id)], cardId));
    ok('7. B\'s card says its changes go to the owner', await until(B.p, (id) => TopoServerSync.cardSync(id).state === 'proposed', cardId), await B.p.evaluate((id) => TopoServerSync.cardSync(id), cardId));
    ok('7. the quiet merge is one log entry from "the server"', await B.p.evaluate(() => (state.log || []).filter((e) => e.kind === 'merge' && e.source === 'server').length === 1));
    ok('7. B never pushed', bPosts === 0, bPosts);
    ok('7. A has not got B\'s note: it waits for a visit', await A.p.evaluate((id) => libraryEntry(id).doc.nodes[1].notes !== 'Note by B', cardId));
    const bRefused = await B.p.evaluate(async (id) => {
        const r = TopoServerSync.rec(id);
        r.role = 'owner';
        try { await TopoServerSync.pushCard(r); return ['pushed']; } catch (e) { return [e.status, e.code, !!(e.data && e.data.update)]; } finally { r.role = 'provider'; TopoServerSync.putRec(r); }
    }, cardId);
    bPosts = 0;
    ok('7. a provider\'s push is refused: 403 owners-only, update Topo', bRefused[0] === 403 && bRefused[1] === 'owners-only' && bRefused[2] === true, bRefused);
    ok('7. the server head is 2', (await head(siteId)) === '2 1', await head(siteId));

    // 8. A conflict: both rename the same device offline; A syncs first; B
    //    shows Needs merge, the review opens only on the tap; B still pushes
    //    nothing.
    await B.c.setOffline(true);
    await A.p.evaluate((id) => { const lib = loadLibrary(); lib[id].doc.nodes[2].name = 'A says'; lib[id].updated = Date.now(); persistLibrary(lib); serverAfterSave(id); }, cardId);
    await B.p.evaluate(() => { batch(() => { state.nodes[2].name = 'B says'; save(); }); flushAutosave(); });
    ok('8. A pushed head 3', await until(A.p, (id) => TopoServerSync.rec(id).baseN === 3, cardId));
    await B.c.setOffline(false);
    await B.p.evaluate((id) => TopoServerSync.syncNow(id), cardId);
    ok('8. B needs a merge', await until(B.p, (id) => TopoServerSync.cardSync(id).state === 'needs-merge', cardId), await B.p.evaluate((id) => TopoServerSync.cardSync(id), cardId));
    ok('8. no merge dialog popped up by itself', !(await B.p.evaluate(() => TopoMergeUI.mergeDialogOpen())));
    ok('8. the doc bar says Merge', await B.p.evaluate(() => /Merge/.test((document.getElementById('docBar') || document.body).textContent)));
    await B.p.evaluate(async (id) => { TopoMergeUI.setMergeResponder(() => ({})); await TopoServerSync.reviewMerge(id); TopoMergeUI.setMergeResponder(null); }, cardId);
    ok('8. B reviewed it: on head 3, its own name kept, nothing pushed', await until(B.p, (id) => TopoServerSync.rec(id).baseN === 3 && TopoServerSync.cardSync(id).state === 'proposed'
        && libraryEntry(id).doc.nodes[2].name === 'B says', cardId), await B.p.evaluate((id) => [TopoServerSync.rec(id), TopoServerSync.cardSync(id)], cardId));
    ok('8. B never pushed', bPosts === 0, bPosts);
    ok('8. the server head is 3', (await head(siteId)) === '3 1', await head(siteId));

    // 9. A reports a problem routed to Acme IT and sends it through the server.
    await A.p.evaluate(async (id) => { setDialogResponder(() => true); await openFromLibrary(id); }, cardId);
    ok('9. A opened its card', await A.p.evaluate((id) => state.libraryId === id, cardId));
    // Through the Problems dialog, as a client would: Save and send.
    await A.p.evaluate(async () => {
        await TopoServerSync.siteDetail(TopoServerSync.rec(state.libraryId).siteId, true);
        selectEntries([{ type: 'node', id: state.nodes[0].id }]);
        TopoIncidents.openProblemDialog();
    });
    ok('9. the Problems dialog opens', await until(A.p, () => !document.getElementById('problemDialog').hidden && !document.getElementById('problemForm').hidden));
    await A.p.evaluate(() => {
        const tile = document.querySelector('#problemSymptoms input[value=internet]');
        tile.checked = true; tile.dispatchEvent(new Event('change', { bubbles: true }));
        const set = (id, v) => { const f = document.getElementById(id); f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); };
        set('problemText', 'Secret note text'); set('problemName', 'Owner'); set('problemEmail', 'owner@example.test');
        const box = document.querySelector(`#problemContacts input[data-sendto="${state.providers[0].id}"]`);
        if (box && !box.checked) box.click();
    });
    await A.p.click('#problemSaveSendBtn');
    ok('9. the send step says "Sent through the server"', await until(A.p, () => /^Sent through the server\. Acme IT will get an email\.$/.test(document.getElementById('problemSendStatus').textContent)),
        await A.p.evaluate(() => [document.getElementById('problemSendStatus').textContent, document.getElementById('problemError').textContent]));
    ok('9. no link, passphrase, email, share or file to send by hand', await A.p.evaluate(() => ['problemEmailBtn', 'problemShareBtn', 'problemCopyMsgBtn', 'problemFileBtn', 'problemPassRow', 'problemMakeBtn', 'problemLink']
        .every((id) => document.getElementById(id).classList.contains('hidden'))));
    const sent = await A.p.evaluate(() => ({ id: TopoIncidents.draft.incidentId, status: (state.incidents.find((x) => x.id === TopoIncidents.draft.incidentId) || {}).status }));
    ok('9. the report is marked sent', !!sent.id && sent.status === 'sent', sent);
    await A.p.click('#problemDoneBtn');
    const im = await readMail(PROV, 'incident-sent');
    ok('9. the provider\'s incident-sent email is in the sink', !!im, mails().map((m) => m.kind + ' ' + m.to));
    ok('9. it carries no network content', !!im && !/Secret note|Renamed by A|Office|A says|B says|house/i.test(emlOf(im)), im && emlOf(im).slice(0, 400));

    // 10. B gets it live and records a visit: a visit copy goes to the owner
    //     (D154), who gets the email, reviews it in Visits waiting, approves
    //     it as Successful; it is pushed and answered; B is told, and takes
    //     the server's version.
    ok('10. B has the report', await until(B.p, (iid) => (state.incidents || []).some((x) => x.id === iid && x.status === 'sent'), sent.id));
    const head10 = (await head(siteId)).split(' ')[0];
    // Through the Record visit dialog, as the provider would.
    await B.p.evaluate((iid) => { enterProviderMode(iid); TopoProviderMode.openVisitDialog(iid); }, sent.id);
    ok('10. the visit dialog opens, ready to save', await until(B.p, () => !document.getElementById('visitDialog').hidden && !document.getElementById('visitSaveBtn').disabled));
    await B.p.evaluate(() => {
        const tile = document.querySelector('#visitOutcomes input[value=fixed]');
        tile.checked = true; tile.dispatchEvent(new Event('change', { bubbles: true }));
        const by = document.getElementById('visitBy'); by.value = 'Tech'; by.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await B.p.click('#visitSaveBtn');
    ok('10. the return step says it went to the owner for review', await until(B.p, () => /^Sent to the owner for review\./.test(document.getElementById('visitReturnStatus').textContent)),
        await B.p.evaluate(() => [document.getElementById('visitReturnStatus').textContent, document.getElementById('visitError').textContent]));
    ok('10. no link, passphrase, email, share or file to send back', await B.p.evaluate(() => ['visitEmailBtn', 'visitCallBtn', 'visitShareBtn', 'visitCopyMsgBtn', 'visitCopyLinkBtn', 'visitFileBtn', 'visitPassRow', 'visitMakeBtn', 'visitLink']
        .every((id) => document.getElementById(id).classList.contains('hidden'))));
    ok('10. B recorded a visit', await B.p.evaluate(() => (state.log || []).some((e) => e.kind === 'visit' && e.by === 'Tech')));
    await B.p.click('#visitDoneBtn');
    // What B is asked before its card takes the server's version (D192):
    // answered here, the question recorded.
    await B.p.evaluate(() => { window.__offered = ''; TopoServerSync._hooks.ask = async (m, o) => { window.__offered = o.why; return 'no'; }; });
    ok('10. B\'s card says the visit waits for the owner', await until(B.p, (id) => TopoServerSync.cardSync(id).state === 'visit-waiting', cardId), await B.p.evaluate((id) => TopoServerSync.cardSync(id), cardId));
    ok('10. nothing was pushed: the head is the same', (await head(siteId)).split(' ')[0] === head10 && bPosts === 0, [await head(siteId), bPosts]);
    const db10 = spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), `SELECT state || ' ' || base_n || ' ' || length(ct) FROM visit_copies WHERE site_id = '${siteId.replace(/[^\w-]/g, '')}'`], { encoding: 'utf8' });
    ok('10. the server holds one visit copy, waiting, on head ' + head10, db10.status === 0 && db10.stdout.trim().startsWith('waiting ' + head10 + ' '), db10.stdout || db10.stderr);
    const vm = await readMail(OWNER, 'visit-recorded');
    ok('10. the owner\'s visit-recorded email is in the sink', !!vm, mails().map((m) => m.kind + ' ' + m.to));
    ok('10. it carries no network content', !!vm && !/Secret note|Renamed by A|Office|Tech|house/i.test(emlOf(vm)));
    // A: Visits waiting, in the Problems tab; the review in the browser.
    await A.p.evaluate(async (id) => { await openFromLibrary(id); await TopoVisits.refreshServerVisits(id, true); openIncidentsView(); TopoVisits.renderVisitsWaiting(); }, cardId);
    ok('10. A\'s Problems tab lists the visit waiting', await until(A.p, () => /A visit waits for your review/.test(document.getElementById('visitsWaiting').textContent)
        && !!document.querySelector('#visitsWaiting button.vw-review')), await A.p.evaluate(() => document.getElementById('visitsWaiting').textContent));
    await A.p.click('#visitsWaiting button.vw-review');
    ok('10. the review opens with the visit\'s two questions', await until(A.p, () => TopoMergeUI.mergeDialogOpen() && !document.getElementById('mergeVisit').hidden));
    await audit(A.p, '10. the visit review');
    await A.p.click('#mergeVisit [data-visit-outcome="successful"]');
    await A.p.click('#mergeApplyBtn');
    ok('10. A has the visit, the report fixed, the decision logged', await until(A.p, (iid) => (state.log || []).some((e) => e.kind === 'visit' && e.by === 'Tech')
        && (state.log || []).some((e) => e.kind === 'decision' && e.result === 'approved' && e.outcome === 'successful')
        && (state.incidents.find((x) => x.id === iid) || {}).status === 'closed', sent.id), await A.p.evaluate(() => (state.log || []).map((e) => e.kind)));
    // Acme IT is named on no device: B's note and B's name are outside what
    // it covers (D154, D188), so they are left out by default.
    ok('10. B\'s edits outside what Acme IT covers left out, A\'s name kept', await A.p.evaluate((id) => { const d = libraryEntry(id).doc; return d.nodes[1].notes !== 'Note by B' && d.nodes[2].name === 'A says'; }, cardId));
    ok('10. pushed and answered on the server', await until(A.p, (a) => TopoServerSync.rec(a.id).baseN > a.n && !(TopoServerSync.rec(a.id).decisions || []).length, { id: cardId, n: Number(head10) }));
    const db10b = spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), `SELECT state || ' ' || decided_n FROM visit_copies WHERE site_id = '${siteId.replace(/[^\w-]/g, '')}'`], { encoding: 'utf8' });
    ok('10. the copy is approved at the new head', db10b.stdout.trim() === 'approved ' + (await head(siteId)).split(' ')[0] || db10b.stdout.trim() === '', [db10b.stdout, await head(siteId)]);
    const pm = await readMail(PROV, 'visit-recorded');
    ok('10. B is told by email that the owner approved it', !!pm && /approved your visit/.test(pm.subject || emlOf(pm)), pm && pm.subject);
    ok('10. B takes the server\'s version and deletes its copy', await until(B.p, (id) => TopoServerSync.cardSync(id).state === 'synced' && !TopoServerSync.dirty(id)
        && revHashOf(libraryEntry(id).doc) !== '' , cardId), await B.p.evaluate((id) => TopoServerSync.cardSync(id), cardId));
    ok('10. B is offered its copy as a file first: the owner left its outside edits out (D192)', (await B.p.evaluate(() => window.__offered)) === 'unsent', await B.p.evaluate(() => window.__offered));
    await B.p.evaluate(() => { delete TopoServerSync._hooks.ask; });
    const conv = await Promise.all([A.p, B.p].map((p) => p.evaluate((id) => revHashOf(libraryEntry(id).doc), cardId)));
    ok('10. the two copies are the same', conv[0] === conv[1], conv);
    const db10c = spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), `SELECT count(*) FROM visit_copies WHERE site_id = '${siteId.replace(/[^\w-]/g, '')}'`], { encoding: 'utf8' });
    ok('10. the decided copy is gone from the server', await (async () => { for (let i = 0; i < 100; i++) { const r = spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), `SELECT count(*) FROM visit_copies WHERE site_id = '${siteId.replace(/[^\w-]/g, '')}'`], { encoding: 'utf8' }); if (r.stdout.trim() === '0') return true; await sleep(100); } return false; })(), db10c.stdout);
    ok('10. A\'s log verifies', (await A.p.evaluate(async () => verifyLog(normalizeLog(state.log)))) === -1);

    // 10b. A reports a problem to a provider who is not a member: the
    // locked link as without a server, then the server emails it (D87).
    ok('10b. /api/me says the server can send mail', (await A.p.evaluate(() => TopoServer.me().mailRelay)) === true);
    await A.p.evaluate(() => {
        batch(() => { state.providers.push(makeProvider({ name: 'Outside Co', email: 'outside@example.test', service: 'internet' })); save(); });
        flushAutosave();
        selectEntries([{ type: 'node', id: state.nodes[0].id }]);
        TopoIncidents.openProblemDialog();
    });
    ok('10b. the Problems dialog opens', await until(A.p, () => !document.getElementById('problemDialog').hidden && !document.getElementById('problemForm').hidden));
    await A.p.evaluate(() => {
        const tile = document.querySelector('#problemSymptoms input[value=internet]');
        tile.checked = true; tile.dispatchEvent(new Event('change', { bubbles: true }));
        const set = (id, v) => { const f = document.getElementById(id); f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); };
        set('problemText', 'Nothing <b>loads</b>'); set('problemName', 'Owner'); set('problemPhone', '+52 55 1234 5678'); set('problemEmail', 'owner@example.test');
        const outside = state.providers.find((p) => p.name === 'Outside Co').id;
        document.querySelectorAll('#problemContacts input[data-sendto]').forEach((box) => { if (box.checked !== (box.dataset.sendto === outside)) box.click(); });
    });
    await A.p.click('#problemSaveSendBtn');
    // D95: the email waits for Send by email; D97: the report attached.
    ok('10b. the send step waits for Send by email', await until(A.p, () => TopoIncidents.draft.send && TopoIncidents.draft.send.result
        && document.getElementById('problemEmailBtn').textContent === '✉ Send by email') && countMail('outside@example.test', 'report') === 0,
        await A.p.evaluate(() => [document.getElementById('problemSendStatus').textContent, document.getElementById('problemEmailBtn').textContent]));
    await A.p.click('#problemAttach');
    ok('10b. the report attached is made (a PDF), the server warning said', await until(A.p, () => TopoIncidents.draft.send.attachFile && !TopoIncidents.draft.send.attachBusy)
        && await A.p.evaluate(() => TopoIncidents.draft.send.attachFile.type === 'application/pdf'
            && document.getElementById('problemAttachNote').textContent.includes('The server sends the report unlocked, so the server (and whoever runs it) can read it.')),
        await A.p.evaluate(() => [document.getElementById('problemAttachNote').textContent, TopoIncidents.draft.send.attachError]));
    const attachSent = await A.p.evaluate(async () => {
        const f = TopoIncidents.draft.send.attachFile;
        const b = new Uint8Array(await f.blob.arrayBuffer());
        let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return { name: f.name, b64: btoa(bin) };
    });
    await audit(A.p, '10b. the send step with the report attached');
    await A.p.click('#problemEmailBtn');
    ok('10b. the send step says the server sent it, with the report', await until(A.p, () => document.getElementById('problemSendStatus').textContent
        .startsWith('Sent by email from the server to Outside Co. Send the passphrase another way, such as a call or a text.')
        && document.getElementById('problemSendStatus').textContent.includes(' went with it.')),
        await A.p.evaluate(() => [document.getElementById('problemSendStatus').textContent, document.getElementById('problemError').textContent]));
    ok('10b. Copy passphrase stays; nothing to send by hand', await A.p.evaluate(() => !document.getElementById('problemPassRow').classList.contains('hidden')
        && ['problemEmailBtn', 'problemShareBtn', 'problemCopyMsgBtn', 'problemFileBtn'].every((id) => document.getElementById(id).classList.contains('hidden'))));
    await audit(A.p, '10b. the send step (server email)');
    const sentLink = await A.p.evaluate(() => TopoIncidents.draft.send.result.url);
    await A.p.click('#problemDoneBtn');
    const rm = await readMail('outside@example.test', 'report');
    ok('10b. the report email is in the sink', !!rm, mails().map((m) => m.kind + ' ' + m.to));
    const rp = partsOf(rm ? emlOf(rm) : '');
    ok('10b. the email is multipart/mixed with the PDF, byte for byte', rp.type === 'multipart/mixed' && rp.files.length === 1 && rp.files[0].name === attachSent.name
        && /^Content-Type: application\/pdf/m.test(rp.files[0].head) && rp.files[0].bytes.equals(Buffer.from(attachSent.b64, 'base64')) && rp.files[0].bytes.subarray(0, 5).toString() === '%PDF-',
        [rp.type, rp.files.map((f) => [f.name, f.bytes.length]), attachSent.name]);
    ok('10b. outbox.jsonl names the attachment and its size', !!rm && rm.attachment === attachSent.name && rm.attachmentBytes === Buffer.from(attachSent.b64, 'base64').length, rm);
    ok('10b. the text says the report is attached', rp.text.includes('The report is attached: ' + attachSent.name), rp.text.slice(-400));
    ok('10b. the stored file is gone once sent', spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), 'SELECT count(*) FROM mail_files'], { encoding: 'utf8' }).stdout.trim() === '0');
    ok('10b. the link is this server\'s locked link', typeof sentLink === 'string' && sentLink.startsWith(ORIGIN + '/') && sentLink.includes('#e~'), String(sentLink).slice(0, 60));
    ok('10b. HTML: the hyperlink "Follow the infrastructure link" to it', rp.html.includes(`<a href="${sentLink}"`) && /">Follow the infrastructure link<\/a>/.test(rp.html), rp.html.slice(0, 600));
    ok('10b. plain: "Follow the infrastructure link: URL"', rp.text.includes('Follow the infrastructure link: ' + sentLink), rp.text.slice(0, 600));
    ok('10b. Reply-To is the client, From the server', /\r\nReply-To: <owner@example\.test>\r\n/.test(rp.head) && /^From: .*topo@/m.test(rp.head), rp.head);
    ok('10b. the phone is a tel: link, the words escaped', rp.html.includes('href="tel:+525512345678"') && rp.html.includes('Nothing &lt;b&gt;loads&lt;/b&gt;') && !rp.html.includes('<b>loads'), rp.html.slice(0, 900));
    ok('10b. the footer names the client and the server', rp.text.includes('on behalf of owner@example.test') && rp.text.includes(ORIGIN), rp.text.slice(-300));
    ok('10b. the passphrase is not in it, only the note', !rp.text.includes(await A.p.evaluate(() => TopoIncidents.draft.send ? TopoIncidents.draft.send.pass : 'x')) && rp.text.includes('The passphrase comes separately'));
    // The rules, straight at the endpoint from A's page.
    const post = (body) => A.p.evaluate(async ([s, b]) => {
        const r = await fetch('/api/sites/' + s + '/report-mail', { method: 'POST', headers: { 'X-Topo': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
        return { status: r.status, body: await r.json().catch(() => null), retry: r.headers.get('Retry-After') };
    }, [siteId, body]);
    const okBody = { to: ['outside@example.test'], subject: 'S', lines: ['x'], link: ORIGIN + '/#e~x', lang: 'en' };
    const foreign = await post(Object.assign({}, okBody, { link: 'https://evil.example/#e~x' }));
    ok('10b. a link to another origin is refused (400)', foreign.status === 400 && foreign.body.field === 'link', foreign);
    const statuses = [];
    for (let i = 0; i < 10; i++) statuses.push((await post(okBody)).status);
    const last = await post(okBody);
    ok('10b. 10 sends an hour: the 11th is 429 with Retry-After', statuses.slice(0, 9).every((x) => x === 202) && statuses[9] === 429 && last.status === 429 && !!last.retry && last.body.limit === 'user', [statuses, last]);

    // 13 (phone). B's Members sheet at 390, before the removal.
    await B.p.evaluate((s) => TopoServerUI.openMembers(s), siteId);
    ok('13. B\'s Members sheet opens', await until(B.p, () => /Acme|owner@example.test/.test(document.getElementById('serverSheetBody').textContent)));
    await audit(B.p, '13. the members sheet (provider)');
    await B.p.evaluate(() => TopoServerUI.closeSheet());
    // The owner's Members sheet on a 390 screen: a second tab of A's touch
    // context (same cookie and key store), opened at that width.
    const A2 = await A.c.newPage();
    A2.on('console', (m) => { if (m.type() === 'error') errors.A.push(m.text()); });
    A2.on('pageerror', (e) => errors.A.push(String(e)));
    await A2.setViewportSize({ width: 390, height: 844 });
    await A2.goto(ORIGIN + '/');
    ok('13. A\'s second tab is ready', await until(A2, () => TopoServer.state.status === 'ready'));
    await A2.evaluate((s) => TopoServerUI.openMembers(s), siteId);
    ok('13. A\'s Members sheet opens', await until(A2, () => !!document.querySelector('#serverSheetBody .srv-row button')));
    await audit(A2, '13. the members sheet (owner)');
    await A2.close();
    await A.p.evaluate((s) => TopoServerUI.openMembers(s), siteId);
    await until(A.p, () => !!document.querySelector('#serverSheetBody .srv-row button'));

    // 11. A removes B: a new epoch; B is told; B's push is refused.
    const before = (await head(siteId) || '').split(' ')[0];
    await A.p.evaluate(() => setDialogResponder(() => true));
    await A.p.click('#serverSheetBody .srv-row button:has-text("Remove")');
    ok('11. the epoch is 2', await until(A.p, (s) => (TopoServer.site(s) || {}).epoch === 2, siteId), await head(siteId));
    ok('11. the server says epoch 2', (await head(siteId) || '').endsWith(' 2'), await head(siteId));
    ok('11. B is told it was removed', await until(B.p, (id) => (TopoServerSync.cardSync(id) || {}).state === 'removed', cardId), await B.p.evaluate((id) => TopoServerSync.cardSync(id), cardId));
    const bTry = await B.p.evaluate(async (id) => {
        const lib = loadLibrary(); if (lib[id]) { lib[id].doc.nodes[0].name = 'After removal'; lib[id].updated = Date.now(); persistLibrary(lib); }
        const out = await TopoServerSync.syncNow(id);
        const r = await fetch('/api/sites/' + TopoServerSync.rec(id).siteId + '/keys');
        return [out, r.status];
    }, cardId);
    const bMail = await B.p.evaluate(async (s) => (await fetch('/api/sites/' + s + '/report-mail', { method: 'POST', headers: { 'X-Topo': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: ['a@example.test'], subject: 'S', lines: [], link: location.origin + '/#x' }) })).status, siteId);
    ok('11. a removed member cannot send a report email (404)', bMail === 404, bMail);
    ok('11. B can neither push nor fetch keys', bTry[0] !== 'pushed' && bTry[1] === 404 && (await head(siteId)) === before + ' 2', [bTry, before, await head(siteId)]);
    await A.p.evaluate(() => TopoServerUI.closeSheet());
    ok('11. A still pushes under the new key', (await A.p.evaluate(async (id) => {
        const lib = loadLibrary(); lib[id].doc.nodes[0].name = 'After'; lib[id].updated = Date.now(); persistLibrary(lib); return TopoServerSync.syncNow(id);
    }, cardId)) === 'pushed', await head(siteId));
    ok('11. the server took it under epoch 2', (await head(siteId)) === (Number(before) + 1) + ' 2', await head(siteId));

    // 14. Backups (step 5b): the server owner turns on a folder backup; the
    //     network's encrypted head appears in it, another after the next
    //     push; the owner lists and downloads it; a broken folder and a
    //     tampered file each send one email. 14b and 14c: the sheets, a
    //     restore through the merge, and a file opened with no server.
    const api = (method, path, body) => A.p.evaluate(async ([m, u, b]) => {
        const r = await fetch(u, { method: m, headers: b === undefined ? { 'X-Topo': '1' } : { 'X-Topo': '1', 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
        const text = await r.text();
        let json = null; try { json = JSON.parse(text); } catch (e) { /* bytes */ }
        return { status: r.status, json, text, sha: r.headers.get('X-Topo-Backup-Sha256') };
    }, [method, path, body]);
    const bkFiles = () => { try { return readdirSync(join(bk, siteId)).filter((n) => n.endsWith('.json')).sort(); } catch (e) { return []; } };
    const waitFor = async (fn, ms = 10000) => { for (let i = 0; i < ms / 200; i++) { const v = await fn(); if (v) return v; await sleep(200); } return null; };
    const status = async () => (await api('GET', '/api/admin/backups')).json.status;
    const outside = await api('PUT', '/api/admin/backups', { enabled: true, kind: 'folder', fields: { path: data } });
    ok('14. a folder outside TOPO_BACKUP_FOLDERS is refused', outside.status === 422 && outside.json.error === 'backup-folder-not-allowed', outside.json);
    const saved = await api('PUT', '/api/admin/backups', { enabled: true, kind: 'folder', fields: { path: bk } });
    ok('14. the server owner saves a folder backup (checked first)', saved.status === 200 && saved.json.config.enabled === true && existsSync(join(bk, '.topo-backups')), saved.json);
    const first = await waitFor(() => bkFiles().length >= 1 && bkFiles());
    ok('14. the network\'s backup appears in the folder', !!first && /^topo_network-[a-z0-9-]{8}_\d{4}-\d{2}-\d{2}\.json$/.test(first[0]), first);
    const bytes1 = first ? readFileSync(join(bk, siteId, first[0]), 'utf8') : '';
    let parsed1 = null; try { parsed1 = JSON.parse(bytes1); } catch (e) { /* checked below */ }
    ok('14. it is the encrypted revision with the owners\' locked keys', !!parsed1 && parsed1.kind === 'topo-backup' && parsed1.v === 1 && parsed1.site === siteId
        && typeof parsed1.rev.ct === 'string' && parsed1.owners.length === 1 && !!parsed1.owners[0].escrow && parsed1.name === null, parsed1 && Object.keys(parsed1));
    const docWords = await A.p.evaluate((id) => { const d = libraryEntry(id).doc; return [...d.nodes.map((n) => n.name), ...d.nodes.map((n) => n.ip).filter(Boolean), 'Acme IT', 'Office'].filter((w) => String(w).length >= 6); }, cardId);
    ok('14. no device name, address or network name in the bytes', docWords.length > 3 && docWords.every((w) => !bytes1.includes(w)), docWords.filter((w) => bytes1.includes(w)));
    await A.p.evaluate((id) => { const lib = loadLibrary(); lib[id].doc.nodes[0].name = 'Backed up twice'; lib[id].updated = Date.now(); persistLibrary(lib); return TopoServerSync.syncNow(id); }, cardId);
    const second = await waitFor(() => bkFiles().length >= 2 && bkFiles());
    ok('14. the next push writes a second file with the time', !!second && second.some((n) => /_\d{4}-\d{2}-\d{2}_\d{4}(\d{2})?(-\d+)?\.json$/.test(n)), second || bkFiles());
    const list = await api('GET', '/api/sites/' + siteId + '/backups');
    ok('14. the owner lists the network\'s backups', list.status === 200 && list.json.backups.length === 2 && list.json.backups.every((b) => b.kind === 'enc' && !b.missing), list.json);
    const oldest = list.json.backups[list.json.backups.length - 1];
    const dl = await api('GET', '/api/sites/' + siteId + '/backups/' + oldest.id);
    ok('14. downloading it gives the file byte for byte', dl.status === 200 && dl.text === readFileSync(join(bk, siteId, oldest.name), 'utf8') && !!dl.sha, [dl.status, oldest.name]);
    // A folder the server cannot write to.
    chmodSync(join(bk, siteId), 0o500);
    await A.p.evaluate((id) => { const lib = loadLibrary(); lib[id].doc.nodes[0].name = 'Not backed up'; lib[id].updated = Date.now(); persistLibrary(lib); return TopoServerSync.syncNow(id); }, cardId);
    const failed = await waitFor(async () => { const s = await status(); return s.lastError && s; });
    ok('14. a failed backup shows in the status', !!failed && failed.lastError.code === 'refused', failed);
    const fm = await readMail(OWNER, 'backup-failed');
    ok('14. the owner gets one backup-failed email with no network detail', !!fm && !/Office|Acme|Backed up|network-|bkroot/.test(emlOf(fm)) && countMail(OWNER, 'backup-failed') === 1, fm && emlOf(fm).slice(0, 300));
    chmodSync(join(bk, siteId), 0o700);
    const run = await api('POST', '/api/admin/backups/run');
    const cleared = await waitFor(async () => { const s = await status(); return !s.lastError && s.lastOk > 0 && bkFiles().length === 3 && s; });
    ok('14. Back up now after the fix clears the status', run.status === 202 && !!cleared, [run.status, await status(), bkFiles()]);
    // One byte changed in the newest file: the check finds it.
    const newest = (await api('GET', '/api/sites/' + siteId + '/backups')).json.backups[0];
    const p3 = join(bk, siteId, newest.name);
    const b3 = readFileSync(p3);
    b3[Math.floor(b3.length / 2)] ^= 1;
    writeFileSync(p3, b3);
    const chk = await api('POST', '/api/admin/backups/check');
    const checkFailed = await waitFor(async () => { const s = await status(); return s.lastCheck && s.lastCheck.ok === false && s; });
    ok('14. Check now finds the tampered file', chk.status === 202 && !!checkFailed && checkFailed.lastCheck.code === 'mismatch', checkFailed || await status());
    const cm = await readMail(OWNER, 'backup-check-failed');
    ok('14. the owner gets one backup-check-failed email', !!cm && countMail(OWNER, 'backup-check-failed') === 1 && !/Office|Acme|network-/.test(emlOf(cm)));

    // 14b. The server owner's Backups sheet, then a restore from the list
    //      (Members, Backups, Restore…): opened with A's own keys, Replace
    //      with this copy after a restore point, pushed on top of the head.
    await A.p.evaluate(() => TopoServerUI.openAccount());
    ok('14b. Account has Backups for the server owner', await until(A.p, () => [...document.querySelectorAll('#serverSheetBody button')].some((b) => b.textContent === 'Backups…')));
    await A.p.click('#serverSheetBody button:has-text("Backups…")');
    ok('14b. the Backups sheet shows the folder and how it went', await until(A.p, () => {
        const b = document.getElementById('serverSheetBody');
        const k = b && b.querySelector('[data-k="kind"]');
        return !!k && k.value === 'folder' && /Last backup:/.test(b.textContent) && /Last check: failed/.test(b.textContent);
    }), (await sheetText(A.p)).slice(0, 400));
    await audit(A.p, '14b. the Backups sheet');
    // The tampered file is replaced by a good one before restoring.
    await api('POST', '/api/admin/backups/run');
    await A.p.evaluate(() => TopoServerUI.closeSheet());
    const files14 = (await api('GET', '/api/sites/' + siteId + '/backups')).json.backups.filter((b) => b.kind === 'enc');
    const oldest14 = files14[files14.length - 1];
    const oldDoc = await A.p.evaluate(async ([s, id]) => {
        const text = await (await fetch('/api/sites/' + s + '/backups/' + id, { headers: { 'X-Topo': '1' } })).text();
        const r = await TopoBackupFile.unlockBackup(JSON.parse(text));
        return { name: r.env.doc.nodes[0].name, how: r.how };
    }, [siteId, oldest14.id]);
    ok('14b. the oldest backup opens with A\'s own keys', oldDoc.how === 'own' && typeof oldDoc.name === 'string', oldDoc);
    const headBefore14 = (await head(siteId)).split(' ')[0];
    await A.p.evaluate(() => {
        setDialogResponder((q) => (q.kind === 'choice' ? (q.choices.some((c) => c.id === 'update') ? 'update' : null) : q.kind === 'confirm' ? true : undefined));
    });
    await A.p.evaluate((s) => TopoServerUI.openSiteBackups(s), siteId);
    ok('14b. the network\'s Backups lists the files with Restore…', await until(A.p, () => [...document.querySelectorAll('#serverSheetBody button')].filter((b) => b.textContent === 'Restore…').length >= 2));
    await audit(A.p, '14b. a network\'s Backups');
    await A.p.evaluate(() => { const r = [...document.querySelectorAll('#serverSheetBody button')].filter((b) => b.textContent === 'Restore…'); r[r.length - 1].click(); });
    ok('14b. Restore… then Replace with this copy brings the old copy back', await until(A.p, (n) => Object.values(loadLibrary()).some((c) => c.doc.nodes[0].name === n), oldDoc.name), oldDoc.name);
    ok('14b. after a restore point "Before restoring a backup"', await A.p.evaluate((id) => CarinoRestore.restorePointsOf(id).some((p) => p.reason === 'Before restoring a backup'), cardId));
    ok('14b. and the restore is pushed as one new revision on top of the head', (await A.p.evaluate((id) => TopoServerSync.syncNow(id), cardId)) === 'pushed'
        && Number((await head(siteId)).split(' ')[0]) === Number(headBefore14) + 1, [headBefore14, await head(siteId)]);
    await A.p.evaluate(() => setDialogResponder(null));

    // 14c. The newest backup file, opened in Topo with no server at all (a
    //      context serving the repository's static files; a localhost
    //      address, so WebCrypto is there), with A's recovery key.
    // The backup of the restore's push (the newest file before it is the
    // one 14 tampered with, which must not open).
    const headNow = Number((await head(siteId)).split(' ')[0]);
    const newestFile = await waitFor(async () => (await api('GET', '/api/sites/' + siteId + '/backups')).json.backups.find((b) => b.kind === 'enc' && b.revN === headNow));
    ok('14c. the restore\'s push was backed up too', !!newestFile);
    const tamperedText = (await api('GET', '/api/sites/' + siteId + '/backups/' + newest.id)).text;
    const fileText = (await api('GET', '/api/sites/' + siteId + '/backups/' + newestFile.id)).text;
    errors.S = [];
    const S = await ctx('S', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const STATIC = 'http://localhost:9';
    await S.c.route(STATIC + '/**', (route) => {
        const u = new URL(route.request().url());
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
        const file = join(ROOT, rel);
        if (!file.startsWith(ROOT) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const ext = rel.split('.').pop();
        const type = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', woff2: 'font/woff2', png: 'image/png' }[ext] || 'application/octet-stream';
        return route.fulfill({ status: 200, body: readFileSync(file), contentType: type });
    });
    await S.p.goto(STATIC + '/index.html?lang=en#advanced');
    ok('14c. the app with no server', await until(S.p, () => typeof openBackupFile === 'function' && !TopoServer.state.on));
    const opened = await S.p.evaluate(async ([text, code]) => {
        const asked = [];
        setDialogResponder((q) => { asked.push(q.kind); return q.kind === 'prompt' ? code : q.kind === 'choice' ? (q.choices.some((c) => c.id === 'open') ? 'open' : null) : q.kind === 'confirm' ? true : undefined; });
        const okd = await applyImportedDoc(JSON.parse(text), { fileName: 'topo_network-x_2026-11-10.json' });
        setDialogResponder(null);
        return { okd, asked, names: Object.values(loadLibrary()).map((c) => c.doc.nodes.map((n) => n.name)).flat() };
    }, [fileText, recoveryA]);
    ok('14c. it asks for the recovery key and opens as its own network', opened.okd === true && opened.asked.includes('prompt') && opened.names.includes(oldDoc.name), opened);
    const wrongKey = await S.p.evaluate(async (text) => {
        try { await TopoBackupFile.unlockBackup(JSON.parse(text), { ask: (b, r, problem) => (problem ? null : 'abcd-efgh-jkmn-pqrs-tuvw-xyz2-3456') }); return 'opened'; }
        catch (e) { return e.code; }
    }, fileText);
    ok('14c. a wrong recovery key opens nothing', wrongKey === 'cancelled', wrongKey);
    const tamperedCode = await S.p.evaluate(async ([text, code]) => {
        try { await TopoBackupFile.unlockBackup(JSON.parse(text), { ask: () => code }); return 'opened'; } catch (e) { return e.code; }
    }, [tamperedText, recoveryA]);
    ok('14c. the file 14 tampered with is refused as damaged', tamperedCode === 'damaged', tamperedCode);
    ok('14c. no CSP violation with no server', (await S.p.evaluate(() => (window.__cspViolations || []).length)) === 0);
    ok('14c. no console errors with no server', errors.S.filter((x) => !/^Failed to load resource/.test(x)).length === 0, errors.S);
    await S.c.close();

    // 14d. An S3-compatible bucket (5c, D111), a local fake that checks every
    //      request's SigV4 signature with its own code (tests/fixtures/
    //      fakes3.mjs): a wrong secret is refused by the check; saved, the
    //      next push puts the encrypted backup in the bucket under topo/;
    //      the secret never comes back; the file downloads through the
    //      server byte for byte and opens with A's own keys.
    const { startFakeS3 } = await import(join(ROOT, 'tests/fixtures/fakes3.mjs'));
    const s3 = await startFakeS3({ keyId: 'AKIDE2E', secret: 'e2e-s3-secret', region: 'us-east-1', bucket: 'topo-e2e' });
    try {
        const s3body = (secret) => ({ enabled: true, kind: 's3', fields: { endpoint: s3.url, bucket: 'topo-e2e', keyId: 'AKIDE2E', pathStyle: '1', region: 'us-east-1' }, secrets: { secret } });
        const wrong = await api('PUT', '/api/admin/backups', s3body('not-it'));
        ok('14d. a wrong S3 secret fails the check (the fake checks the signature)', wrong.status === 422 && wrong.json.error === 'backup-dest' && wrong.json.code === 'refused' && s3.state.refused > 0, wrong.json);
        const s3saved = await api('PUT', '/api/admin/backups', s3body('e2e-s3-secret'));
        ok('14d. S3 saved after the check; the secret never comes back', s3saved.status === 200 && s3saved.json.config.kind === 's3' && s3saved.json.config.fields.prefix === 'topo/'
            && !s3saved.text.includes('e2e-s3-secret') && !(await api('GET', '/api/admin/backups')).text.includes('e2e-s3-secret'), s3saved.json);
        await A.p.evaluate((id) => { const lib = loadLibrary(); lib[id].doc.nodes[0].name = 'Into the bucket'; lib[id].updated = Date.now(); persistLibrary(lib); return TopoServerSync.syncNow(id); }, cardId);
        const s3keys = () => [...s3.objects.keys()].filter((k) => k.startsWith('topo/' + siteId + '/') && k.endsWith('.json'));
        const s3first = await waitFor(() => s3keys().length >= 1 && s3keys());
        ok('14d. the backup lands in the bucket under topo/<network>/', !!s3first && /^topo\/[^/]+\/topo_network-[a-z0-9-]{8}_\d{4}-\d{2}-\d{2}(_\d{4})?\.json$/.test(s3first[0]), s3first || [...s3.objects.keys()]);

        // Saving wrote the head at once (a new destination catches up); the
        // push above is written a moment later: wait for the head's file.
        const s3headNow = (await head(siteId)).split(' ')[0];
        const s3list = (await waitFor(async () => { const l = (await api('GET', '/api/sites/' + siteId + '/backups')).json.backups.filter((b) => !b.previousDest && b.kind === 'enc'); return l.length && String(l[0].revN) === s3headNow && l; })) || [];
        const s3dl = s3list.length ? await api('GET', '/api/sites/' + siteId + '/backups/' + s3list[0].id) : { status: 0 };
        const s3bytes = s3list.length ? (s3.objects.get('topo/' + siteId + '/' + s3list[0].name) || '').toString('utf8') : '';
        ok('14d. encrypted: no device name, address or network name in the object', s3bytes.includes('"topo-backup"') && !s3bytes.includes('Into the bucket') && docWords.every((w) => !s3bytes.includes(w)));
        ok('14d. it downloads through the server byte for byte', s3dl.status === 200 && s3dl.text === s3bytes, [s3dl.status, s3list.length]);
        const s3open = await A.p.evaluate(async (text) => { const r = await TopoBackupFile.unlockBackup(JSON.parse(text)); return { how: r.how, name: r.env.doc.nodes[0].name }; }, s3dl.text || '{}').catch((e) => ({ err: String(e) }));
        const s3head = (await head(siteId)).split(' ')[0];
        ok('14d. and opens with A\'s own keys: the head, with the push in it', s3open.how === 'own' && s3open.name === 'Into the bucket' && s3list.length > 0 && String(s3list[0].revN) === s3head, [s3open, s3list[0] && s3list[0].revN, s3head]);
        const checkedBefore = ((await status()).lastCheck || { at: 0 }).at;
        await sleep(20);
        const s3chk = await api('POST', '/api/admin/backups/check');
        const s3checked = await waitFor(async () => { const s = await status(); return s.lastCheck && s.lastCheck.ok && s.lastCheck.at > checkedBefore && s; });
        ok('14d. Check now passes on the bucket', s3chk.status === 202 && !!s3checked, await status());
    } finally {
        await s3.close();
    }

    // 15. Site monitors through the real server (docs/SCOPE.md step 7h).
    // The PC's side (desktop/src-tauri/src/monitorlink.rs) is played in A's
    // page with WebCrypto: its keys, its token on every request, its records
    // sealed with the site key and signed with its own key.
    const mon = await A.p.evaluate(async (s) => {
        const C = TopoServerCrypto, M = TopoMonitors;
        const pcs = [];
        for (const name of ['FRONT-DESK', 'WARD-2']) {
            const e = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
            const g = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
            const pc = { name, enc: e.privateKey, sig: g.privateKey, encPub: C.b64u(new Uint8Array(await crypto.subtle.exportKey('raw', e.publicKey))), sigPub: C.b64u(new Uint8Array(await crypto.subtle.exportKey('raw', g.publicKey))) };
            M.state.invoke = async (cmd, a) => {
                if (cmd === 'monitor_device_key') return { encPub: pc.encPub, sigPub: pc.sigPub, keyKind: 'file', name };
                if (cmd === 'monitor_enroll') { pc.args = a.args; return { enrolled: true }; }
                return null;
            };
            await M.turnOn(s, []);
            pcs.push(pc);
        }
        M.state.invoke = null; M.state.link = null;
        window.__pcs = pcs;
        // As the monitor: its own token, no cookie of a person counted.
        const call = async (pc, method, path, body) => {
            const r = await fetch(path, { method, credentials: 'omit', headers: Object.assign({ 'X-Topo': '1', Authorization: 'Topo-Monitor ' + pc.args.token }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
            let j = null; try { j = await r.json(); } catch (x) { /* none */ }
            return { status: r.status, json: j };
        };
        window.__monCall = call;
        const pc = pcs[0];
        const self = await call(pc, 'GET', '/api/monitor');
        const keys = await call(pc, 'GET', `/api/sites/${s}/keys`);
        const tr = await TopoServerSync.walkRosters(s);
        const owners = [];
        for (const m of tr.rosters[tr.rosters.length - 1].members) if (m.role === 'owner') owners.push(tr.pubs[m.u].sigPub);
        const w = keys.json.wraps.find((x) => x.epoch === self.json.epoch);
        const raw = await C.unwrap(w.wrap, { priv: pc.enc, pub: pc.encPub, ctx: C.siteCtx(s, w.epoch, pc.args.monitor), signers: owners });
        const key = await C.importSiteKey(raw);
        pc.key = key; pc.epoch = w.epoch;
        let at = Date.now();
        const seal = (kind, id, payload) => C.sealRecord({ site: s, kind, id, epoch: pc.epoch, author: pc.args.monitor, at: at++ }, key, pc.sig, C.utf8(JSON.stringify(payload)));
        const firstNode = state.nodes[0];
        const status = await call(pc, 'PUT', `/api/sites/${s}/status?interval=60000`, await seal('status', pc.args.monitor, { v: 1, monitor: pc.name, items: [{ key: firstNode.id + '/ck', nodeId: firstNode.id, state: 'down', since: Date.now() - 60000, status: 'e2e-plaintext-marker' }] }));
        const issue = await call(pc, 'POST', `/api/sites/${s}/records`, await seal('issue', 'in00000e2e01', { id: 'in00000e2e01', nodeId: firstNode.id, name: firstNode.name, outages: [{ from: Date.now() - 60000 }], behind: [], acts: [], monitor: pc.name }));
        const head = await (await fetch(`/api/sites/${s}/revs?since=0&limit=1`)).json();
        const rev = await call(pc, 'POST', `/api/sites/${s}/revs`, { rev: { n: head.head.n + 1 } });
        const me = await call(pc, 'GET', '/api/me');
        const day = Math.floor(Date.now() / 864e5) * 864e5;
        const stats = await call(pc, 'PUT', `/api/sites/${s}/stats/${day}`, await seal('stats', pc.args.monitor + '|' + day, { v: 1, day, monitor: pc.name, checks: {} }));
        // The owner's page reads it all.
        await M.load(s);
        const st = M.siteState(s);
        const pulled = await M.stats(s, day, day);
        return { self: self.status, selfSite: self.json && self.json.site, unwrapped: raw.length === 32, status: status.status, issue: issue.status, rev: rev.status, me: me.status, stats: stats.status,
            statusRead: [...st.status.values()].some((o) => o.author === pc.args.monitor && o.payload.items[0].state === 'down'), issueRead: st.issues.has('in00000e2e01'),
            listed: st.monitors.map((m) => ({ name: m.name, last: m.lastReport > 0 })), pulled: pulled.length, ids: pcs.map((x) => x.args.monitor), tokens: pcs.map((x) => x.args.token), refused: st.refused.size };
    }, siteId);
    ok('15a. an owner turns two PCs into monitors; each opens the site key wrapped to it', mon.self === 200 && mon.selfSite === siteId && mon.unwrapped && mon.ids.length === 2, mon);
    ok('15b. a monitor pushes its signed status (the heartbeat), an issue and a day of statistics', mon.status === 200 && mon.issue === 200 && mon.stats === 204, mon);
    ok('15c. it cannot push a revision or act as a person', mon.rev === 403 && mon.me === 403, mon);
    ok('15d. the owner\'s page reads them, checked, and lists the monitors with their last report', mon.statusRead && mon.issueRead && mon.pulled === 1 && mon.refused === 0 && mon.listed.length === 2 && mon.listed[0].last, mon);
    const recText = spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), 'SELECT record FROM site_records'], { encoding: 'utf8' }).stdout;
    ok('15e. the server holds the records as ciphertext only', recText.includes('"ctHash"') && !recText.includes('e2e-plaintext-marker'), recText.slice(0, 200));
    const folded = await waitFor(async () => (await A.p.evaluate(() => (state.incidents || []).some((i) => i.id === 'in00000e2e01'))) && spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), "SELECT folded FROM site_records WHERE id = 'in00000e2e01'"], { encoding: 'utf8' }).stdout.trim() === '1');
    ok('15f. the owner\'s open page folds the issue into the network, and the server marks it folded', !!folded);
    // The monitoring report on the real server's blobs (step 7j, D298): a
    // day of hourly figures the monitor sealed is pulled, opened and counted
    // by the owner's page, its monitor named.
    const rpt = await A.p.evaluate(async (s) => {
        const C = TopoServerCrypto, R = TopoReports;
        const pc = window.__pcs[0];
        const HOUR = 36e5, DAY = 864e5;
        const n0 = state.nodes[0];
        const key = n0.id + '/ck';
        const hour = Math.floor(Date.now() / HOUR) * HOUR - 2 * HOUR;
        const hday = Math.floor(hour / DAY) * DAY;
        const fig = { hour, checks: 60, ok: 57, fail: 3, rttMin: 1, rttMed: 4, rttP95: 9, rttMax: 20, jitter: 0.5, sUp: 3000, sSlow: 0, sDown: 600, sUpstream: 0, sMaint: 0, sUnknown: 0 };
        const checks = {};
        checks[key] = { node: n0.id, hours: [fig] };
        const body = await C.sealRecord({ site: s, kind: 'stats', id: pc.args.monitor + '|' + hday, epoch: pc.epoch, author: pc.args.monitor, at: Date.now() }, pc.key, pc.sig,
            C.utf8(JSON.stringify({ v: 1, day: hday, monitor: pc.name, checks })));
        const put = await window.__monCall(pc, 'PUT', '/api/sites/' + s + '/stats/' + hday, body);
        const range = R.periodRange('day');
        const doc = serializeDoc();
        const data = await R.gather(range, doc);
        doc.nodes.find((n) => n.id === n0.id).checks = [{ id: 'ck', proto: 'ping' }];
        const m = R.buildModel(doc, data, { scope: 'site', range, parts: R.PARTS });
        const row = m.rows.find((r) => r.key === key);
        return { put: put.status, source: data.source, streams: data.streams.length, row: row && { down: row.down, up: row.up, avail: row.avail, coverage: row.coverage, monitors: row.monitors, med: row.med },
            html: /FRONT-DESK/.test(R.reportHtml(m)) };
    }, siteId);
    ok('15f2. the monitoring report reads the real server\'s blobs: the hour pulled, opened and counted, its monitor named', rpt.put === 204 && rpt.source === 'server' && rpt.row
        && rpt.row.down === 600 && Math.abs(rpt.row.avail - 3000 / 3600) < 1e-9 && Math.abs(rpt.row.coverage - 1 / 24) < 1e-9 && rpt.row.med === 4 && rpt.html, rpt);
    // Revoking the second: the key rotates, the first is wrapped the new key.
    const rv = await A.p.evaluate(async (s) => {
        const pcs = window.__pcs;
        const before = (await TopoServerSync.siteDetail(s, true)).site.epoch;
        await TopoServerSync.removeMember(s, pcs[1].args.monitor);
        const after = (await TopoServerSync.siteDetail(s, true)).site.epoch;
        const gone = await window.__monCall(pcs[1], 'GET', '/api/monitor');
        const keys = await window.__monCall(pcs[0], 'GET', `/api/sites/${s}/keys`);
        return { before, after, gone: gone.status, firstHasNew: keys.json.wraps.some((w) => w.epoch === after) };
    }, siteId);
    ok('15g. revoking a monitor: its credential is refused, the key rotates, the other monitor gets the new key', rv.gone === 401 && rv.after === rv.before + 1 && rv.firstHasNew, rv);

    // 15i. The heartbeat through the server's own sweep (TOPO_MONITOR_SWEEP
    //      above): the first monitor's last report moved 4 minutes back in
    //      the database, the sweep marks it stale and the owner's open page
    //      hears it and says "Monitor at FRONT-DESK stopped reporting".
    const monId = mon.ids[0].replace(/[^\w]/g, '');
    const aged = spawnSync('sqlite3', ['-cmd', '.timeout 5000', join(data, 'topo.db'), `UPDATE monitors SET last_report = last_report - 240000 WHERE id = '${monId}'`], { encoding: 'utf8' });
    const staleSaid = await waitFor(async () => {
        const db = spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), `SELECT stale FROM monitors WHERE id = '${monId}'`], { encoding: 'utf8' }).stdout.trim();
        const banner = await A.p.evaluate(() => { const b = document.getElementById('srvIssueBanner'); return b && !b.hidden ? b.textContent : ''; });
        return db === '1' && banner.includes('Monitor at FRONT-DESK stopped reporting') && banner;
    });
    ok('15i. a monitor that missed 3 intervals is marked by the server\'s sweep and shown as stopped reporting', aged.status === 0 && !!staleSaid, [aged.stderr, staleSaid]);

    // 15j. An owner's quiet window goes to the site's monitors as a signed
    //      record (D227, D265): the monitor finds it, opens it with the
    //      key wrapped to it, and its signer is the owner.
    const qt = await A.p.evaluate(async (s) => {
        const C = TopoServerCrypto, pc = window.__pcs[0];
        const node = state.nodes[0];
        const until = Date.now() + 3600000;
        const pushed = await TopoMonitors.pushQuiet(s, 'node', node.id, until);
        const self = await window.__monCall(pc, 'GET', '/api/monitor');
        const keys = await window.__monCall(pc, 'GET', `/api/sites/${s}/keys`);
        const tr = await TopoServerSync.walkRosters(s);
        const owners = tr.rosters[tr.rosters.length - 1].members.filter((m) => m.role === 'owner').map((m) => tr.pubs[m.u].sigPub);
        const w = keys.json.wraps.find((x) => x.epoch === self.json.epoch);
        const key = await C.importSiteKey(await C.unwrap(w.wrap, { priv: pc.enc, pub: pc.encPub, ctx: C.siteCtx(s, w.epoch, pc.args.monitor), signers: owners }));
        const recs = await window.__monCall(pc, 'GET', `/api/sites/${s}/records?since=0`);
        const q = recs.json.records.map((x) => x.record).find((r) => r.kind === 'quiet');
        const me = TopoServer.me();
        let p = null;
        try { p = JSON.parse(C.fromUtf8(await C.openRecord(q, key, tr.pubs[me.id].sigPub))); } catch (e) { p = { err: String(e) }; }
        return { pushed, author: q && q.author === me.id, p, node: node.id, until };
    }, siteId);
    ok('15j. an owner\'s quiet window reaches the site\'s monitor as a signed record', qt.pushed && qt.author && qt.p && qt.p.scope === 'node' && qt.p.id === qt.node && qt.p.until === qt.until, qt);

    // 15k. The app's own Rust link against this server (D275): the device
    //      keys made in Rust, the PC turned on from A's page, then
    //      src/monitorlink.rs (desktop/src-tauri/examples/monitor-link.rs,
    //      the app's link, crypto and transport with a stand-in for the
    //      checks) walks the rosters, opens its key, pushes its status, an
    //      issue and a day of statistics, and takes the owner's quiet
    //      window; A's page reads and opens what Rust sealed and signed.
    //      Skipped with --no-rust (no cargo here).
    if (!args.includes('--no-rust')) {
        const TAURI = join(ROOT, 'desktop/src-tauri');
        const exe = join(TAURI, 'target/debug/examples/monitor-link');
        const built = spawnSync('cargo', ['build', '--offline', '-j', '4', '--example', 'monitor-link'], { cwd: TAURI, stdio: ['ignore', 'ignore', 'inherit'] });
        ok('15k. the Rust link builds (cargo build --example monitor-link)', built.status === 0 && existsSync(exe));
        const keys = JSON.parse(spawnSync(exe, ['keys'], { encoding: 'utf8' }).stdout || '{}');
        const en = await A.p.evaluate(async ([s, k]) => {
            const M = TopoMonitors;
            let args = null;
            M.state.invoke = async (cmd, a) => {
                if (cmd === 'monitor_device_key') return { encPub: k.encPub, sigPub: k.sigPub, keyKind: 'file', name: 'RUST-PC' };
                if (cmd === 'monitor_enroll') { args = a.args; return { enrolled: true }; }
                return null;
            };
            try { await M.turnOn(s, []); } catch (e) { return { err: String(e && e.message || e) }; }
            M.state.invoke = null; M.state.link = null;
            return { args, node: state.nodes[0].id, name: state.nodes[0].name };
        }, [siteId, keys]);
        const cfgPath = join(data, 'monitor-link.json');
        const day = Math.floor(Date.now() / 864e5) * 864e5;
        writeFileSync(cfgPath, JSON.stringify({
            origin: ORIGIN, pin: '', token: en.args && en.args.token, secret: keys.secret, site: siteId, monitor: en.args && en.args.monitor, name: 'RUST-PC',
            network: en.args && en.args.network, watched: en.args && en.args.network, roster: en.args && en.args.roster,
            statuses: [{ key: en.node + '/rk', nodeId: en.node, state: 'down' }], issues: [{ id: 'in0000rust01', nodeId: en.node, name: en.name }], ticks: 2
        }));
        const runOut = spawnSync(exe, ['tick', cfgPath], { encoding: 'utf8' });
        let run = {};
        try { run = JSON.parse(runOut.stdout); } catch (e) { run = { stdout: runOut.stdout, stderr: runOut.stderr }; }
        const sent = (m, p) => (run.calls || []).find((c) => c[0] === m && c[1].endsWith(p));
        ok('15k. the Rust link pushes status, an issue and statistics, all taken by the server', !!en.args && (run.errors || []).length === 0 && !run.revoked
            && sent('PUT', '/status')[2] === 200 && sent('POST', '/records')[2] === 200 && sent('PUT', '/stats/' + day)[2] === 204, { en: en.err, run });
        ok('15k. it takes the owner\'s quiet window (sealed and signed by the page) and the site\'s Keep statistics', (run.quiets || []).some((q) => q.scope === 'node' && q.id === en.node) && (run.retention || [])[0] === 360, run);
        const rd = await A.p.evaluate(async ([s, mid, day]) => {
            const M = TopoMonitors;
            await M.load(s);
            const st = M.siteState(s);
            const status = st.status.get(mid);
            const stats = await M.stats(s, day, day);
            return { status: !!status && status.payload.items[0].state === 'down' && status.payload.monitor === 'RUST-PC', issue: !!st.issues.get('in0000rust01') && st.issues.get('in0000rust01').author === mid,
                stats: stats.some((x) => x.monitor === mid && x.name === 'RUST-PC'), refused: [...st.refused.entries()].filter(([, v]) => v.author === mid) };
        }, [siteId, en.args && en.args.monitor, day]);
        ok('15k. the owner\'s page opens what Rust sealed and signed: status, issue and statistics, none refused', rd.status && rd.issue && rd.stats && rd.refused.length === 0, rd);
    }

    // 12. Sign out on both.
    for (const [n, p] of [['A', A.p], ['B', B.p]]) {
        await p.evaluate(() => TopoServer.signOut());
        ok(`12. ${n} signed out (/api/me is 401)`, (await p.evaluate(async () => (await fetch('/api/me')).status)) === 401);
    }

    // 15h. The monitor keeps reporting after the people signed out (D129).
    const after = await fetch(ORIGIN + '/api/monitor', { headers: { Authorization: 'Topo-Monitor ' + mon.tokens[0] } });
    ok('15h. a site monitor keeps working after its owner signed out', after.status === 200);

    // The whole run: no console errors (an HTTP status line is the
    // browser reporting a 401/404/409, not a script error), no CSP violation.
    const real = (l) => l.filter((x) => !/^Failed to load resource/.test(x));
    ok('no console errors on A', real(errors.A).length === 0, errors.A);
    ok('no console errors on B', real(errors.B).length === 0, errors.B);
    for (const [n, p] of [['A', A.p], ['B', B.p]]) ok(`no CSP violations on ${n}`, (await p.evaluate(() => (window.__cspViolations || []).length)) === 0, await p.evaluate(() => window.__cspViolations));
    ok('no email is still waiting', countMail(OWNER, 'signin') >= 1 && spawnSync('sqlite3', ['-readonly', join(data, 'topo.db'), "SELECT count(*) FROM outbox WHERE sent IS NULL AND kind != 'revision'"], { encoding: 'utf8' }).stdout.trim() === '0');
} catch (e) {
    ok('the script ran to the end', false, String((e && e.stack) || e));
} finally {
    await browser.close();
    await stopServer();
    if (KEEP) console.log('data kept in ' + data); else rmSync(data, { recursive: true, force: true });
    const bad = results.filter((r) => !r).length;
    console.log(`--- ${results.length} checks, ${bad} failing`);
    process.exit(bad ? 1 : 0);
}
