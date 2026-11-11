// The Topo server end to end: the real topo-server binary and the real app in
// Chromium (docs/SCOPE.md step 5a, design §11.3). Not a run.sh suite: run.sh
// serves the repository with a static server, this starts the binary.
//
//   node tests/server-e2e.mjs [--port 7381] [--keep] [--no-build]
//
//   --port      the loopback port for the server (default 7381, or
//               $TOPO_E2E_PORT). A busy port is an error: nothing is killed.
//   --keep      keep the temporary data folder (topo.db, mail/) and print it.
//   --no-build  use server/dist/topo-server as it is (otherwise
//               `make -C server build` stages the app and builds it first).
//   $TOPO_E2E_BIN  a binary to use instead (implies --no-build).
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
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
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
const child = spawn(BIN, ['serve'], {
    env: {
        PATH: process.env.PATH, HOME: process.env.HOME, TOPO_DATA: data, TOPO_LISTEN: `127.0.0.1:${PORT}`, TOPO_PUBLIC_URL: ORIGIN,
        TOPO_MAIL: 'file', TOPO_OWNER_EMAIL: OWNER, TOPO_NOTIFY_REVISION_MINUTES: '0', TOPO_NOTIFY_EVENT_SECONDS: '0', TOPO_LOG_LEVEL: 'warn',
        TOPO_MAIL_PER_MINUTE: '1000'
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

    // 7. Concurrent offline edits: B's push meets a 409, B pulls, merges
    //    cleanly and pushes; both converge. The order is fixed (C9): B reads
    //    the head before A pushes, so B's push is on a stale base.
    for (const p of [A.p, B.p]) await p.evaluate(() => { TopoServerSync._hooks.quietMs = 200; TopoServerSync._hooks.maxMs = 1000; });
    let b409 = 0;
    B.p.on('response', (r) => { if (r.request().method() === 'POST' && /\/revs$/.test(new URL(r.url()).pathname) && r.status() === 409) b409++; });
    await A.c.setOffline(true);
    await B.c.setOffline(true);
    await A.p.evaluate((id) => { const lib = loadLibrary(); lib[id].doc.nodes[0].name = 'Renamed by A'; lib[id].updated = Date.now(); persistLibrary(lib); serverAfterSave(id); }, cardId);
    await B.p.evaluate(() => { batch(() => { state.nodes[1].notes = 'Note by B'; save(); }); flushAutosave(); });
    ok('7. B offline: the card keeps the local change', await until(B.p, (id) => TopoServerSync.dirty(id) && ['offline', 'error'].includes(TopoServerSync.cardSync(id).state), cardId),
        await B.p.evaluate((id) => TopoServerSync.cardSync(id), cardId));
    let releaseB, bRead;
    const aPushed = new Promise((r) => { releaseB = r; });
    const bHasStale = new Promise((r) => { bRead = r; });
    let held = false;
    await B.p.route((u) => /\/api\/sites\/[^/]+\/revs$/.test(u.pathname) && u.searchParams.has('since'), async (route) => {
        if (held || route.request().method() !== 'GET') return route.continue();
        held = true;
        const stale = await route.fetch();
        bRead();
        await aPushed;
        await route.fulfill({ response: stale });
    });
    await B.c.setOffline(false);
    const bSync = B.p.evaluate((id) => TopoServerSync.syncNow(id), cardId);
    await Promise.race([bHasStale, sleep(15000)]);
    ok('7. B read head 1 before A pushed', held);
    await A.c.setOffline(false);
    await A.p.evaluate((id) => TopoServerSync.syncNow(id), cardId);
    ok('7. A pushed head 2', await until(A.p, (id) => TopoServerSync.rec(id).baseN >= 2, cardId), await A.p.evaluate((id) => TopoServerSync.rec(id), cardId));
    releaseB();
    await bSync.catch(() => {});
    await B.p.unroute('**');
    ok('7. B\'s push met a 409', b409 >= 1, b409);
    ok('7. B merged and pushed head 3', await until(B.p, (id) => TopoServerSync.rec(id).baseN === 3 && TopoServerSync.cardSync(id).state === 'synced', cardId),
        await B.p.evaluate((id) => [TopoServerSync.rec(id), TopoServerSync.cardSync(id)], cardId));
    ok('7. the quiet merge is one log entry from "the server"', await B.p.evaluate(() => (state.log || []).filter((e) => e.kind === 'merge' && e.source === 'server').length === 1));
    ok('7. A pulled head 3', await until(A.p, (id) => TopoServerSync.rec(id).baseN === 3, cardId));
    const docs = await Promise.all([A.p, B.p].map((p) => p.evaluate((id) => { const d = libraryEntry(id).doc; return [d.nodes[0].name, d.nodes[1].notes, revHashOf(d)]; }, cardId)));
    ok('7. both have both edits and converge', docs[0][0] === 'Renamed by A' && docs[0][1] === 'Note by B' && docs[0][2] === docs[1][2], docs);
    ok('7. B\'s screen shows A\'s rename', await B.p.evaluate(() => state.nodes[0].name === 'Renamed by A'));
    ok('7. the server head is 3', (await head(siteId)) === '3 1', await head(siteId));

    // 8. A conflict: both rename the same device offline; A syncs first; B
    //    shows Needs merge, the review opens only on the tap, then converges.
    await B.c.setOffline(true);
    await A.p.evaluate((id) => { const lib = loadLibrary(); lib[id].doc.nodes[2].name = 'A says'; lib[id].updated = Date.now(); persistLibrary(lib); serverAfterSave(id); }, cardId);
    await B.p.evaluate(() => { batch(() => { state.nodes[2].name = 'B says'; save(); }); flushAutosave(); });
    ok('8. A pushed head 4', await until(A.p, (id) => TopoServerSync.rec(id).baseN === 4, cardId));
    await B.c.setOffline(false);
    await B.p.evaluate((id) => TopoServerSync.syncNow(id), cardId);
    ok('8. B needs a merge', await until(B.p, (id) => TopoServerSync.cardSync(id).state === 'needs-merge', cardId), await B.p.evaluate((id) => TopoServerSync.cardSync(id), cardId));
    ok('8. no merge dialog popped up by itself', !(await B.p.evaluate(() => TopoMergeUI.mergeDialogOpen())));
    ok('8. the doc bar says Merge', await B.p.evaluate(() => /Merge/.test((document.getElementById('docBar') || document.body).textContent)));
    await B.p.evaluate(async (id) => { TopoMergeUI.setMergeResponder(() => ({})); await TopoServerSync.reviewMerge(id); }, cardId);
    ok('8. B pushed after the review (head 5)', await until(B.p, (id) => TopoServerSync.rec(id).baseN === 5 && TopoServerSync.cardSync(id).state === 'synced', cardId),
        await B.p.evaluate((id) => [TopoServerSync.rec(id), TopoServerSync.cardSync(id)], cardId));
    ok('8. A converged at head 5', await until(A.p, (id) => TopoServerSync.rec(id).baseN === 5, cardId));
    const d2 = await Promise.all([A.p, B.p].map((p) => p.evaluate((id) => revHashOf(libraryEntry(id).doc), cardId)));
    ok('8. the two copies are the same', d2[0] === d2[1], d2);

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

    // 10. B gets it live, records a visit; the owner gets the email.
    ok('10. B has the report', await until(B.p, (iid) => (state.incidents || []).some((x) => x.id === iid && x.status === 'sent'), sent.id));
    // Through the Record visit dialog, as the provider would.
    await B.p.evaluate((iid) => { enterProviderMode(iid); TopoProviderMode.openVisitDialog(iid); }, sent.id);
    ok('10. the visit dialog opens, ready to save', await until(B.p, () => !document.getElementById('visitDialog').hidden && !document.getElementById('visitSaveBtn').disabled));
    await B.p.evaluate(() => {
        const tile = document.querySelector('#visitOutcomes input[value=fixed]');
        tile.checked = true; tile.dispatchEvent(new Event('change', { bubbles: true }));
        const by = document.getElementById('visitBy'); by.value = 'Tech'; by.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await B.p.click('#visitSaveBtn');
    ok('10. the return step says "Saved to the server"', await until(B.p, () => document.getElementById('visitReturnStatus').textContent === 'Saved to the server. The client will get an email.'),
        await B.p.evaluate(() => [document.getElementById('visitReturnStatus').textContent, document.getElementById('visitError').textContent]));
    ok('10. no link, passphrase, email, share or file to send back', await B.p.evaluate(() => ['visitEmailBtn', 'visitCallBtn', 'visitShareBtn', 'visitCopyMsgBtn', 'visitCopyLinkBtn', 'visitFileBtn', 'visitPassRow', 'visitMakeBtn', 'visitLink']
        .every((id) => document.getElementById(id).classList.contains('hidden'))));
    ok('10. B recorded a visit', await B.p.evaluate(() => (state.log || []).some((e) => e.kind === 'visit' && e.by === 'Tech')));
    await B.p.click('#visitDoneBtn');
    const vm = await readMail(OWNER, 'visit-recorded');
    ok('10. the owner\'s visit-recorded email is in the sink', !!vm, mails().map((m) => m.kind + ' ' + m.to));
    ok('10. it carries no network content', !!vm && !/Secret note|Renamed by A|Office|Tech|house/i.test(emlOf(vm)));
    ok('10. A has the visit', await until(A.p, () => (state.log || []).some((e) => e.kind === 'visit')));
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

    // 12. Sign out on both.
    for (const [n, p] of [['A', A.p], ['B', B.p]]) {
        await p.evaluate(() => TopoServer.signOut());
        ok(`12. ${n} signed out (/api/me is 401)`, (await p.evaluate(async () => (await fetch('/api/me')).status)) === 401);
    }

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
