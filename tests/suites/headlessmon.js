// @realtime — a monitor with no screen, the page's side (docs/SCOPE.md
// D455-D457, step 9k; js/monitors.js), against the in-page fake server
// (tests/fixtures/fakeserver.js) with real Web Crypto. The box is scripted
// through the fake as desktop/monitor behaves (the program has its own cargo
// tests, and runs against the real server in tests/server-e2e.mjs):
//   1. Settings: the section is there for an owner on a network kept on a
//      server, on the website too, and nowhere else;
//   2. the line a box prints: read, and anything else refused in words with
//      no monitor made;
//   3. enrolling: the box's keys registered as a monitor under its name,
//      given access as a PC is (the roster names it 'monitor', the site key
//      wrapped to it and opening with its key), and the enrolment file
//      downloaded with the server's address, the credential, the roster and
//      the network; the status line says what to do with the file;
//   4. its checks: a box that says it wants them is sent the open network's,
//      sealed with the site key and signed by the owner, once; a box that
//      has them is sent nothing; a change to the network sends them again,
//      newer; a box with groups gets only theirs; a monitoring PC (which
//      asks for none) is sent nothing;
//   5. many checks go in parts the server takes, and too many are refused;
//   6. every sentence in es, pt-BR, ru and ja.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, tries = 200) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await wait(20); } return false; };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const el = (id) => document.getElementById(id);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  try {
    await loadScript('tests/fixtures/fakeserver.js');
    const T = TopoServer, Y = TopoServerSync, C = TopoServerCrypto, M = TopoMonitors;
    const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    function NoStream() { this.addEventListener = () => {}; this.close = () => {}; this.readyState = 1; }
    T._reset(); Y._reset();
    Object.assign(T._hooks, { force: true, fetch: fake.fetch, EventSource: NoStream, BroadcastChannel: null, locks: null });
    Object.assign(Y._hooks, { quietMs: 30, maxMs: 200, busyMs: 300 });
    TopoServerUI.setServerResponder((q) => (q.kind === 'recovery' ? 'ok' : q.kind === 'show-name' ? false : q.kind === 'grant' ? { checked: true } : q.kind === 'merge-local' ? true : null));
    setDialogResponder(() => true);
    setLocale('en');
    await openServerClient();
    const ch = await T.requestCode('owner@example.test');
    await T.verifyCode(ch, '123456', 'owner@example.test');
    ok('signed in as the owner', T.state.status === 'ready');

    const N = (id, name, extra = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.' + (id.length + 1) + '/24' }] }, extra);
    replaceDocument({ v: DOC_VERSION, groups: [{ id: 'gA', name: 'Building A' }, { id: 'gB', name: 'Building B' }],
      nodes: [N('rt', 'Router', { type: 'router', group: 'gA', checks: [{ id: 'ck1', proto: 'ping' }] }), N('sw', 'Switch', { type: 'switch', group: 'gB', checks: [{ id: 'ck2', proto: 'ping' }] }), N('pc', 'PC')],
      links: [{ id: 'l1', source: 'rt', target: 'sw' }, { id: 'l2', source: 'sw', target: 'pc' }] }, { origin: 'default' });
    const cardId = claimDocument('Clinic', null);

    // ---- 1. Settings ----
    M.renderSiteMonitorSettings();
    ok('1.1 a network not on the server: no section', el('setHeadlessSec').hidden === true);
    await TopoServerUI.putOnServer(cardId);
    const siteId = Y.rec(cardId).siteId;
    const site = () => fake.state.sites.get(siteId);
    await M.load(siteId);
    ok('1.2 an owner on the website (no app) sees it', !M.hasHost() && el('setHeadlessSec').hidden === false && !!el('setHeadlessLine') && !!el('setHeadlessGo'));
    openSettings('setHeadlessGo'); await wait(80);
    const tab = document.getElementById('setTab-monitor');
    ok('1.3 …under Monitoring, which the website now has', !!tab && !tab.hidden && el('setHeadlessGo').getBoundingClientRect().width > 0, tab && String(tab.hidden));

    // ---- 2. The line a box prints ----
    const B = await fake.remoteMonitor();
    const lineOf = (v) => 'topo-monitor-request:' + C.b64u(C.utf8(JSON.stringify(v)));
    const line = lineOf({ v: 1, name: 'Rack box', encPub: B.encPub, sigPub: B.sigPub });
    ok('2.1 the line is read: the name and the two public keys', show(M.parseRequest('  ' + line + '\n')) === show({ name: 'Rack box', encPub: B.encPub, sigPub: B.sigPub }));
    ok('2.2 anything else is not', [null, '', 'hello', 'topo-monitor-request:!!!', lineOf({ v: 2, encPub: 'a', sigPub: 'b' }), lineOf({ v: 1, encPub: 'a' }), line.replace('topo-monitor-request:', '')].every((x) => M.parseRequest(x) === null));
    ok('2.3 a line with no name gets one', M.parseRequest(lineOf({ v: 1, encPub: 'a', sigPub: 'b' })).name === 'Monitor');
    const files = [];
    M.state.download = (name, text) => files.push({ name, text });
    el('setHeadlessLine').value = 'not a line';
    el('setHeadlessGo').click();
    await until(() => /could not be added/.test(el('setHeadlessStatus').textContent));
    ok('2.4 a wrong line is said in words and makes no monitor', /not the line topo-monitor request prints/.test(el('setHeadlessStatus').textContent) && !(site().monitors || []).length && files.length === 0, el('setHeadlessStatus').textContent);

    // ---- 3. Enrolling ----
    el('setHeadlessLine').value = line;
    el('setHeadlessGo').click();
    await until(() => files.length === 1);
    const file = files.length ? JSON.parse(files[0].text) : {};
    B.adopt(siteId, file.monitor);
    const mon = (site().monitors || []).find((x) => x.id === B.id);
    ok('3.1 the box\'s keys are registered as a monitor under its name', !!mon && mon.encPub === B.encPub && mon.sigPub === B.sigPub && mon.name === 'Rack box', show(mon && mon.name));
    ok('3.2 it is given access: a granted member with the role monitor', !!mon && site().members.get(B.id).status === 'granted' && site().members.get(B.id).role === 'monitor');
    const lastRoster = site().rosters[site().rosters.length - 1];
    const rl = C.rosterMember(lastRoster, B.id);
    ok('3.3 the owner-signed roster names it with its keys\' fingerprints', !!rl && rl.role === 'monitor' && rl.sig === await C.fp(B.sigPub) && rl.enc === await C.fp(B.encPub));
    await B.unwrapKeys();
    ok('3.4 the site key is wrapped to it and opens with its own key', B.keys.has(site().epoch));
    ok('3.5 the file: what it is, where the server is, the credential, the roster and the network', file.v === 1 && file.kind === 'topo-monitor-enrolment' && file.origin === T.origin() && file.site === siteId && file.token === mon.token
      && file.roster.seq === lastRoster.seq && file.network === cardId && file.by === 'owner@example.test' && file.name === 'Rack box' && show(file.groups) === '[]', show(Object.keys(file)));
    ok('3.6 …named after the box, and nothing of a person\'s in it', files[0].name === 'topo-monitor-Rack_box.json' && !/devPriv|uSig|password/i.test(files[0].text));
    ok('3.7 the status line says what to do with the file, and the box is cleared', /"Rack box" is now a monitor of this site/.test(el('setHeadlessStatus').textContent) && /topo-monitor-Rack_box\.json/.test(el('setHeadlessStatus').textContent)
      && /delete it/.test(el('setHeadlessStatus').textContent) && el('setHeadlessLine').value === '');
    ok('3.8 the members list shows it as a monitor', /^Monitor: Rack box \(turned on by owner@example\.test on /.test((M.memberMonitorText(siteId, B.id) || {}).title || ''), show(M.memberMonitorText(siteId, B.id)));
    closeSettings();

    // ---- 4. Its checks ----
    const plans = () => site().records.filter((x) => x.record.kind === 'plan');
    const ownerSig = fake.state.users.get(T.me().id).sigPub;
    const openPlan = async (x) => JSON.parse(C.fromUtf8(await C.openRecord(x.record, B.keys.get(x.record.epoch), ownerSig)));
    const say = async (extra) => fake.putRecord(site(), await B.seal('status', B.id, Object.assign({ v: 1, monitor: 'Rack box', at: Date.now(), intervalMs: 60000, items: [] }, extra)));
    await M.load(siteId); await wait(100);
    ok('4.1 a box that has said nothing is sent nothing', plans().length === 0);
    await say({ wantsPlan: true, planHash: '', groups: [] });
    await M.load(siteId);
    await until(() => plans().length === 1);
    const p1 = plans().length ? await openPlan(plans()[0]) : {};
    ok('4.2 a box that asks is sent the open network\'s checks', p1.v === 1 && p1.monitor === B.id && p1.by === T.me().id && p1.i === 0 && p1.n === 1 && show((p1.items || []).map((i) => i.key)) === '["rt/ck1","sw/ck2"]'
      && p1.networkName === 'Clinic' && /^[0-9a-f]{32}$/.test(p1.hash || ''), show(p1 && { n: p1.n, keys: (p1.items || []).map((i) => i.key), name: p1.networkName }));
    ok('4.3 …with the address to ask, as the app\'s own plan has it', p1.items[0].spec.proto === 'ping' && p1.items[0].spec.host === '10.0.0.3' && p1.items[0].nodeId === 'rt', show(p1.items && p1.items[0].spec));
    ok('4.4 …sealed with the site key and signed by the owner', plans()[0].record.author === T.me().id && plans()[0].record.id === `${B.id}|${T.me().id}|0` && !/10\.0\.0\.3|rt\/ck1/.test(JSON.stringify(plans()[0].record)));
    const n1 = plans()[0].n;
    await M.load(siteId); await M.pushPlans(siteId); await wait(60);
    ok('4.5 the same checks are not sent again while the box has not said it has them', plans().length === 1 && plans()[0].n === n1);
    await say({ wantsPlan: true, planHash: p1.hash, groups: [] });
    await M.load(siteId); await wait(60);
    ok('4.6 a box that has them is sent nothing', plans()[0].n === n1 && (await M.pushPlans(siteId)) === 0);
    // The network changes: another check.
    batch(() => { getNode('pc').checks = [{ id: 'ck3', proto: 'ping' }]; save(); });
    await M.load(siteId);
    await until(() => plans().length === 1 && plans()[0].n !== n1);
    const p2 = await openPlan(plans()[0]);
    ok('4.7 a change to the network sends them again, newer', p2.rev > p1.rev && p2.hash !== p1.hash && show(p2.items.map((i) => i.key)) === '["rt/ck1","sw/ck2","pc/ck3"]', show(p2.items.map((i) => i.key)));
    await say({ wantsPlan: true, planHash: p2.hash, groups: ['gA'] });
    await M.load(siteId);
    await until(async () => plans().length === 1 && (await openPlan(plans()[0])).rev > p2.rev);
    const p3 = await openPlan(plans()[0]);
    ok('4.8 a box with groups gets only their devices', show(p3.items.map((i) => i.key)) === '["rt/ck1"]', show(p3.items.map((i) => i.key)));
    // A monitoring PC asks for none.
    const A = await fake.remoteMonitor();
    const resA = await T.api('POST', `/api/sites/${siteId}/monitors`, { name: 'FRONT-DESK', encPub: A.encPub, sigPub: A.sigPub });
    A.adopt(siteId, resA.monitor.id);
    await Y.grant(siteId, [A.id], { checked: true, history: false });
    await A.unwrapKeys(); await B.unwrapKeys();
    await A.status('FRONT-DESK', []);
    await say({ wantsPlan: true, planHash: p3.hash, groups: ['gA'] });
    await M.load(siteId); await wait(80);
    ok('4.9 a monitoring PC, which takes its checks from its own page, is sent none', (await M.pushPlans(siteId)) === 0 && plans().every((x) => x.record.id.startsWith(B.id + '|')));

    // ---- 5. Parts ----
    const many = Array.from({ length: 900 }, (_, i) => ({ key: `n${i}/c1`, nodeId: `n${i}`, name: `Device ${i} · ping`, nodeName: `Device ${i}`, spec: { proto: 'ping', host: `10.1.${i >> 8}.${i & 255}` }, intervalS: 60, slowMs: 0, chain: ['rt', 'sw'], groups: ['gA'] }));
    const parts = M.planParts(many);
    ok('5.1 many checks go in parts, each small enough for one record, nothing lost', parts.length > 1 && parts.every((p) => JSON.stringify(p).length <= 61000) && show(parts.flat()) === show(many), String(parts.length));
    ok('5.2 no check, one empty part; too many, refused', show(M.planParts([])) === '[[]]' && M.planParts(Array.from({ length: 40000 }, (_, i) => many[i % 900])) === null);
    ok('5.3 the hash names the checks', (await M.planHash(many)) === (await M.planHash(many.slice())) && (await M.planHash(many)) !== (await M.planHash(many.slice(1))));

    // ---- 6. Translations ----
    const { has, locales } = window.CarinoI18N;
    const strings = ['A monitor with no screen', 'On the box, run: topo-monitor request', 'Paste the line it prints here.', 'Give the file Topo downloads to: topo-monitor enroll FILE', 'The line from the box', 'Make its enrolment file', 'Monitor',
      'A small program, topo-monitor, checks this network from a box at the site with no desktop and reports through this server, as a monitoring PC does. The server still cannot read what it sends.',
      'That is not the line topo-monitor request prints. Copy the whole line, from topo-monitor-request: to its end.', 'Only an owner can add a monitor.', 'The monitor could not be added: {error}',
      '"{name}" is now a monitor of this site. Give the file {file} to the box (topo-monitor enroll), then delete it: it holds the monitor\'s credential. Owners see it in the members list and can revoke it.'];
    locales.forEach((loc) => ok(`${loc} carries the strings`, strings.every((s) => has(loc, s)), strings.filter((s) => !has(loc, s)).join(' | ')));
    ok('no console error', errors.length === 0, errors.slice(0, 3).join(' | '));
    ok('no CSP violation', (window.__cspViolations || []).length === 0, (window.__cspViolations || []).join(' | '));
  } catch (e) {
    ok('the suite ran', false, ((e && e.stack) || String(e)).replace(/\n/g, ' | '));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
