// @realtime — monitors through the server, the page's side (docs/SCOPE.md
// step 7h, D146-D162; js/monitors.js, js/issues.js, js/checks.js,
// js/serverui.js, js/backupfile.js), against the in-page fake server
// (tests/fixtures/fakeserver.js) with real Web Crypto. A site monitor "A"
// (and a second one, "B2") is a PC scripted through the fake as
// desktop/src-tauri/src/monitorlink.rs behaves (its Rust has its own cargo
// tests; the Go server's checks are server/internal/api/monitors_test.go).
//   1. turning a PC on: the app's device keys registered as a monitor,
//      given access (the roster names it 'monitor', the site key wrapped to
//      it and opening with its key), handed to the app with the token and
//      the roster this page trusts;
//   2. status: the map's dot and the device section on a signed-in page
//      with no app (the website), from the monitor's signed status;
//   3. an issue: folded by the owner's page into an outage with its log
//      entry, the server told; the banner says it; acting pushes a signed
//      act record;
//   4. the fold's checks: a provider's act on a device they cover counts,
//      on one they do not it is refused; a forged record (signed by another
//      key) and an issue a provider wrote are refused and shown to the owner;
//      a provider's act the monitor's record lacks is passed on by the owner;
//   5. two monitors on one item: "down from A, up from B2";
//   6. the heartbeat: a monitor that stopped reporting is in the banner and
//      notified on an app with Show alarms on;
//   7. statistics pulled, opened and read (availability with coverage), and
//      Keep statistics shortened after a confirmation that names the days;
//   8. the plan a site monitor sends: its groups, a block naming monitors;
//   9. revoking: the key rotates and the monitor left gets the new key;
//      the app forgets it;
//  10. a backup's unfolded records folded on restore, through the backup
//      file's own door (unlockBackup), the people's acts on them too;
//  11. quiet windows: an owner's goes to the monitors as a signed record,
//      from the website too; a provider's is refused;
//  12. what a fold sends back stays bounded: a relayed act goes once, with
//      the act's own time, and the acts are folded with their issue;
//  13. turning on refuses a PC that monitors another network, and a turn-on
//      that fails half way leaves no monitor behind; Off while not signed
//      in as an owner says plainly that only this PC forgets.

window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, tries = 200) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await wait(20); } return false; };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  try {
    await loadScript('tests/fixtures/fakeserver.js');
    const T = TopoServer, Y = TopoServerSync, C = TopoServerCrypto, M = TopoMonitors, IS = TopoIssues;
    const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    function NoStream() { this.addEventListener = () => {}; this.close = () => {}; this.readyState = 1; }
    T._reset(); Y._reset();
    Object.assign(T._hooks, { force: true, fetch: fake.fetch, EventSource: NoStream, BroadcastChannel: null, locks: null });
    Object.assign(Y._hooks, { quietMs: 30, maxMs: 200, busyMs: 300 });
    TopoServerUI.setServerResponder((q) => (q.kind === 'recovery' ? 'ok' : q.kind === 'show-name' ? false : q.kind === 'grant' ? { checked: true } : q.kind === 'merge-local' ? true : null));
    const confirms = [];
    setDialogResponder((q) => { if (q.kind === 'confirm') confirms.push(q.message || q.text || ''); return true; });

    await openServerClient();
    const ch = await T.requestCode('owner@example.test');
    await T.verifyCode(ch, '123456', 'owner@example.test');
    ok('signed in as the owner', T.state.status === 'ready');

    const N = (id, name, extra = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.' + (id.length + 1) }] }, extra);
    replaceDocument({ v: DOC_VERSION,
      providers: [{ id: 'pB', name: 'Fibra Norte', service: 'internet', email: 'prov@example.test' }],
      groups: [{ id: 'gA', name: 'Building A' }, { id: 'gB', name: 'Building B' }],
      nodes: [N('rt', 'Router', { type: 'router', providers: ['pB'], group: 'gA', checks: [{ id: 'ck1', proto: 'ping' }] }),
        N('sw', 'Switch', { type: 'switch', group: 'gB', checks: [{ id: 'ck2', proto: 'ping' }] }), N('pc', 'PC')],
      links: [{ id: 'l1', source: 'rt', target: 'sw' }, { id: 'l2', source: 'sw', target: 'pc' }] }, { origin: 'default' });
    const cardId = claimDocument('Clinic', null);
    await TopoServerUI.putOnServer(cardId);
    const siteId = Y.rec(cardId).siteId;
    const site = () => fake.state.sites.get(siteId);
    const P = await fake.remote('prov@example.test');
    P.join(siteId, 'provider');
    await T.refreshSites();
    await Y.grant(siteId, [P.user.id], { checked: true });
    await P.unwrapKeys(siteId);

    // ---- 1. Turning this PC on as the site's monitor ----
    const A = await fake.remoteMonitor();
    const calls = [];
    let enrolled = null;
    const appInvoke = async (cmd, args) => {
      calls.push(cmd);
      if (cmd === 'monitor_device_key') return { encPub: A.encPub, sigPub: A.sigPub, keyKind: 'file', name: 'FRONT-DESK' };
      if (cmd === 'monitor_enroll') { enrolled = args.args; return { enrolled: true, site: args.args.site, monitor: args.args.monitor, name: args.args.name, keyKind: 'file', groups: args.args.groups, by: args.args.by, enrolledAt: Date.now() }; }
      if (cmd === 'monitor_unenroll') return { enrolled: false };
      if (cmd === 'monitor_link_info') return M.state.link || { enrolled: false };
      if (cmd === 'alarm_notify') { calls.push('notify:' + args.text); return null; }
      return null;
    };
    M.state.invoke = appInvoke;
    const link = await M.turnOn(siteId, ['gA']);
    A.adopt(siteId, enrolled && enrolled.monitor);
    const mon = site().monitors.find((x) => x.id === A.id);
    ok('1.1 the PC\'s keys are registered as a monitor with its name', !!mon && mon.encPub === A.encPub && mon.name === 'FRONT-DESK' && /^m_[0-9a-f]{22}$/.test(A.id || ''), show(mon));
    ok('1.2 it is given access: a granted member with the role monitor', site().members.get(A.id).status === 'granted' && site().members.get(A.id).role === 'monitor');
    const lastRoster = site().rosters[site().rosters.length - 1];
    const line = C.rosterMember(lastRoster, A.id);
    ok('1.3 the owner-signed roster names it as a monitor, its keys\' fingerprints', !!line && line.role === 'monitor' && line.email === A.id && line.sig === await C.fp(A.sigPub) && line.enc === await C.fp(A.encPub));
    await A.unwrapKeys();
    ok('1.4 the site key is wrapped to it and opens with its own key', A.keys.has(site().epoch));
    ok('1.5 the app gets the token, the roster this page trusts and the groups', !!enrolled && enrolled.token === mon.token && enrolled.roster.seq === lastRoster.seq && show(enrolled.groups) === '["gA"]' && enrolled.by === 'owner@example.test'
       && calls.indexOf('monitor_device_key') < calls.indexOf('monitor_enroll'), show(enrolled && { seq: enrolled.roster.seq, groups: enrolled.groups }));
    ok('1.6 the monitor shows as "Monitor: PC name (turned on by …)"', /^Monitor: FRONT-DESK \(turned on by owner@example\.test on /.test((M.memberMonitorText(siteId, A.id) || {}).title || ''), show(M.memberMonitorText(siteId, A.id)));

    // ---- 8. The plan it sends: its groups; a block naming monitors ----
    const lk = M.state.link;
    ok('8.1 a site monitor checks the devices of its groups', M.assigned(getNode('rt'), getNode('rt').checks[0], lk) && !M.assigned(getNode('sw'), getNode('sw').checks[0], lk));
    ok('8.2 a block naming monitors is checked only by them (two may be named)', M.assigned(getNode('sw'), { id: 'x', proto: 'ping', monitors: [A.id, 'm_000000000000000000000b'] }, lk)
       && !M.assigned(getNode('rt'), { id: 'x', proto: 'ping', monitors: ['m_000000000000000000000b'] }, lk));
    const plan = TopoChecks.monitorPlan({ nodes: state.nodes, links: state.links, groups: state.groups }, { assigned: (n, c) => M.assigned(n, c, lk) });
    ok('8.3 the plan holds only what it was given', show(plan.items.map((i) => i.key)) === '["rt/ck1"]', show(plan.items.map((i) => i.key)));

    // The rest is the website: no app on this page.
    M.state.invoke = null;
    M.state.link = null;

    // ---- 2. Status on the website ----
    await A.status('FRONT-DESK', [{ key: 'rt/ck1', nodeId: 'rt', state: 'down', since: Date.now() - 5 * 60000, slow: false, flapping: false, status: '', via: 'icmp' }]);
    await M.load(siteId);
    state.selectedType = 'node'; state.selectedId = 'rt';
    await until(() => TopoChecks.statusesOf(getNode('rt')).length === 1);
    ok('2.1 the monitor\'s signed status reaches a page with no app', TopoChecks.nodeLook(getNode('rt')) === 'down');
    const mark = checkMarkEl(getNode('rt'));
    ok('2.2 the map shows its dot', !!mark && mark.getAttribute('data-look') === 'down');
    renderCheckSection(getNode('rt'));
    const grp = document.getElementById('checkGroup');
    grp.open = true; renderCheckSection(getNode('rt'));
    ok('2.3 the device section says it, read only, by monitor', !grp.hidden && /FRONT-DESK/.test(grp.textContent) && /Not answering since/.test(grp.textContent) && !grp.querySelector('[data-f]'), grp.textContent.slice(0, 160));

    // ---- 3. An issue: folded, bannered, acted on ----
    const t0 = Date.now() - 4 * 60000;
    await A.issue({ id: 'in0000000001', networkId: 'x', nodeId: 'rt', name: 'Router', keys: ['rt/ck1'], behind: ['sw'], outages: [{ from: t0 }], flapping: false, monitor: 'FRONT-DESK', monitorId: A.id, acts: [], gone: false, rev: 1 });
    await M.load(siteId);
    const folded = await until(() => (state.incidents || []).some((i) => i.id === 'in0000000001'));
    const inc = (state.incidents || []).find((i) => i.id === 'in0000000001');
    ok('3.1 the owner\'s open page folds the issue into an outage', folded && inc.kind === 'outage' && show(inc.nodeIds) === '["rt"]' && show(inc.behind) === '["sw"]' && inc.monitor === 'FRONT-DESK', show(inc));
    ok('3.2 with its log entry', (state.log || []).some((e) => e.kind === 'incident' && e.incidentId === 'in0000000001' && e.event === 'outage'));
    await until(() => (fake.foldedNs || []).length > 0);
    ok('3.3 the server is told it is in the document', (fake.foldedNs || []).length > 0 && site().records.some((x) => x.record.kind === 'issue' && x.folded));
    M.renderBanner();
    const banner = document.getElementById('srvIssueBanner');
    ok('3.4 the signed-in page shows a banner (no card)', !banner.hidden && /Router and 1 device behind it are not answering/.test(banner.textContent), banner.textContent);

    // ---- 4. The fold's checks ----
    const rtIssue = 'in0000000001';
    // P (prov@example.test) covers the router (pB): its act counts.
    const pAct = async (issue, at, nodeNote) => {
      const rec = await C.sealRecord({ site: siteId, kind: 'act', id: `${issue}|ack|${at}`, epoch: site().epoch, author: P.user.id, at }, P.keys.get(siteId + '|' + site().epoch), P.sig,
        C.utf8(JSON.stringify({ issue, act: 'ack', at, by: 'Fibra Norte', note: nodeNote })));
      return fake.putRecord(site(), rec);
    };
    await A.issue({ id: 'in0000000002', networkId: 'x', nodeId: 'sw', name: 'Switch', keys: ['sw/ck2'], behind: [], outages: [{ from: t0 }], flapping: false, monitor: 'FRONT-DESK', monitorId: A.id, acts: [], gone: false, rev: 1 });
    await pAct(rtIssue, Date.now() - 1000, 'on it');
    await pAct('in0000000002', Date.now() - 900, 'not mine');
    // A record that says it is the monitor's, signed by the provider.
    const forged = await A.seal('issue', 'in0000000003', { id: 'in0000000003', nodeId: 'pc', outages: [{ from: t0 }], acts: [] }, { sigPriv: P.sig });
    fake.putRecord(site(), forged);
    // An issue the provider wrote itself (the server lets only monitors; this one slipped in).
    fake.putRecord(site(), await C.sealRecord({ site: siteId, kind: 'issue', id: 'in0000000004', epoch: site().epoch, author: P.user.id, at: Date.now() }, P.keys.get(siteId + '|' + site().epoch), P.sig,
      C.utf8(JSON.stringify({ id: 'in0000000004', nodeId: 'pc', outages: [{ from: t0 }] }))));
    await M.load(siteId);
    await until(() => ((state.incidents || []).find((i) => i.id === rtIssue) || {}).status === 'closed');
    const rt2 = (state.incidents || []).find((i) => i.id === rtIssue);
    ok('4.1 a provider\'s act on a device they cover is folded', rt2 && rt2.status === 'closed' && rt2.acts && rt2.acts.some((a) => a.by === 'Fibra Norte' && a.note === 'on it'), show(rt2 && rt2.acts));
    await until(() => (state.incidents || []).some((i) => i.id === 'in0000000002'));
    const sw2 = (state.incidents || []).find((i) => i.id === 'in0000000002');
    const scopeRef = [...M.siteState(siteId).refused.entries()].find(([k]) => k.startsWith('act|in0000000002|'));
    ok('4.2 a provider\'s act on a device they do not cover is refused', sw2 && !(sw2.acts || []).some((a) => a.note === 'not mine') && !!scopeRef && scopeRef[1].why === 'scope',
       show([...M.siteState(siteId).refused.keys()]));
    const ref = M.siteState(siteId).refused;
    ok('4.3 a forged record and an issue a provider wrote are refused, never folded', ref.get('issue|in0000000003') && ref.get('issue|in0000000003').why === 'forged' && ref.get('issue|in0000000004') && ref.get('issue|in0000000004').why === 'role'
       && !(state.incidents || []).some((i) => i.id === 'in0000000003' || i.id === 'in0000000004'), show([...ref.entries()]));
    M.renderBanner();
    ok('4.4 the owner is shown what was refused', /records were refused/.test(banner.textContent), banner.textContent);
    await until(() => site().records.some((x) => x.record.kind === 'act' && x.record.id.endsWith('|o')));
    const relayed = site().records.find((x) => x.record.kind === 'act' && x.record.id.endsWith('|o'));
    ok('4.5 the provider\'s act, which the monitor does not take from a provider, is passed on signed by the owner', !!relayed && relayed.record.author === T.me().id && relayed.record.id.startsWith(rtIssue + '|ack|'), show(relayed && relayed.record.id));

    // ---- 12. A fold sends each act back once ----
    const relayedAt = Number(relayed.record.id.split('|')[2]);
    ok('12.1 the relayed act carries the act\'s own time (a repeat is an older record, no new event)', relayed.record.at === relayedAt, show([relayed.record.at, relayedAt]));
    const posts0 = fake.recordPosts || 0;
    for (let i = 0; i < 4; i++) { await M.load(siteId); await IS.foldIssues(); }
    await wait(400);
    ok('12.2 folding again and again does not send it again', (fake.recordPosts || 0) === posts0 && site().records.filter((x) => x.record.kind === 'act' && x.record.id.endsWith('|o')).length === 1,
       show([posts0, fake.recordPosts]));
    // The monitor takes it: its issue record now lists the act, and the fold
    // folds the issue and the acts on it on the server.
    const pRec = site().records.find((x) => x.record.kind === 'act' && x.record.author === P.user.id && x.record.id.startsWith(rtIssue + '|'));
    const pAt = Number(pRec.record.id.split('|')[2]);
    await A.issue({ id: rtIssue, networkId: 'x', nodeId: 'rt', name: 'Router', keys: ['rt/ck1'], behind: ['sw'], outages: [{ from: t0 }], flapping: false, monitor: 'FRONT-DESK', monitorId: A.id,
      acts: [{ act: 'ack', at: pAt, by: 'Fibra Norte', note: 'on it' }], gone: false, rev: 2 });
    await M.load(siteId);
    // The page that folded the act keeps the record unreported (Undo may
    // take its fold back, D254); the next page that finds it in the
    // document reports it, with the acts on it.
    IS.state.foldedHere.clear(); IS.state.foldedRev.clear();
    await IS.foldIssues();
    const actsFolded = await until(() => site().records.filter((x) => x.record.kind === 'act' && x.record.id.startsWith(rtIssue + '|')).every((x) => x.folded));
    ok('12.3 the acts on a folded issue are folded too (they leave the backups)', actsFolded, show(site().records.filter((x) => x.record.kind === 'act').map((x) => [x.record.id, x.folded])));
    // A monitor that stopped reporting is not relayed to.
    const monA0 = site().monitors.find((x) => x.id === A.id);
    monA0.stale = true;
    await M.load(siteId, { quiet: true });
    const sentStale = await M.relayAct(siteId, 'in0000000002', { act: 'ack', at: 12345, by: 'X' });
    monA0.stale = false;
    await M.load(siteId, { quiet: true });
    ok('12.4 nothing is relayed while the issue\'s monitor stopped reporting', sentStale === false);

    // Acting from this page pushes a signed act record.
    const before = site().records.filter((x) => x.record.kind === 'act' && x.record.author === T.me().id).length;
    await IS.actOnOutage('in0000000002', 'expected', { by: 'Ana' });
    await until(() => site().records.filter((x) => x.record.kind === 'act' && x.record.author === T.me().id).length > before);
    const mine = site().records.filter((x) => x.record.kind === 'act' && x.record.author === T.me().id && x.record.id.startsWith('in0000000002|expected|'));
    let opened = null;
    if (mine.length) opened = JSON.parse(C.fromUtf8(await C.openRecord(mine[0].record, await Y.siteKey(siteId, site().epoch), T.keys().sigPub)));
    ok('3.5 Expected from the page: in the document and pushed as a signed act record', ((state.incidents || []).find((i) => i.id === 'in0000000002') || {}).status === 'closed' && !!opened && opened.act === 'expected' && opened.by === 'Ana', show(opened));
    ok('3.6 the server holds the records as ciphertext only', !JSON.stringify(site().records).includes('Fibra Norte') && !JSON.stringify(site().records).includes('"Ana"'));

    // ---- 5. Two monitors on one item ----
    const B2 = await fake.remoteMonitor();
    M.state.invoke = async (cmd) => (cmd === 'monitor_device_key' ? { encPub: B2.encPub, sigPub: B2.sigPub, keyKind: 'keychain', name: 'WARD-2' }
      : cmd === 'monitor_enroll' ? { enrolled: true } : null);
    let b2args = null;
    const inv = M.state.invoke;
    M.state.invoke = async (cmd, args) => { if (cmd === 'monitor_enroll') b2args = args.args; return inv(cmd, args); };
    await M.turnOn(siteId, []);
    M.state.invoke = null; M.state.link = null;
    B2.adopt(siteId, b2args.monitor);
    await B2.unwrapKeys();
    await B2.status('WARD-2', [{ key: 'rt/ck1', nodeId: 'rt', state: 'up', since: Date.now() - 60000, slow: false, flapping: false, status: '', via: 'icmp', rttMs: 3 }]);
    await M.load(siteId);
    const comb = M.combinedStatus(getNode('rt'));
    ok('5.1 down from one monitor, up from the other: said as the path between them', comb.length === 1 && comb[0].split && show(comb[0].split) === '{"down":["FRONT-DESK"],"up":["WARD-2"]}'
       && TopoChecks.nodeLook(getNode('rt')) === 'split' && /look at the path between them/.test(TopoChecks.nowText(comb[0], getNode('rt'))), show(comb));

    // ---- 6. The heartbeat ----
    const monA = site().monitors.find((x) => x.id === A.id);
    monA.stale = true; monA.lastReport = Date.now() - 10 * 60000;
    await M.load(siteId);
    M.renderBanner();
    ok('6.1 a monitor that stopped reporting is in the banner', /Monitor at FRONT-DESK stopped reporting/.test(banner.textContent), banner.textContent);
    ok('6.2 its two-monitor item now reads from the one still reporting', TopoChecks.nodeLook(getNode('rt')) === 'up');
    ok('6.3 the members list says so', /^Stopped reporting/.test(M.memberMonitorText(siteId, A.id).last));
    // On an app with Show alarms on this PC: a notification, once.
    const notes = [];
    M.state.invoke = async (cmd, args) => { if (cmd === 'alarm_notify') notes.push(args.text); return null; };
    const info0 = TopoChecks.state.info;
    TopoChecks.state.info = { on: true, alarms: true, networkId: '', retentionDays: 360, quiet: {} };
    M.state.stalesTold.clear();
    await M.load(siteId);
    await M.load(siteId);
    ok('6.4 an app with alarms on is notified once', notes.length === 1 && notes[0] === 'Monitor at FRONT-DESK stopped reporting', show(notes));
    TopoChecks.state.info = info0;
    M.state.invoke = null;
    monA.stale = false; monA.lastReport = Date.now();

    // ---- 7. Statistics ----
    const day = Math.floor(Date.now() / 864e5) * 864e5;
    const hours = [{ hour: day, checks: 60, ok: 57, fail: 3, rttMed: 4, sUp: 3000, sSlow: 0, sDown: 300, sUpstream: 0, sMaint: 300, sUnknown: 0 }];
    await A.stats(day, { 'rt/ck1': { node: 'rt', name: 'Router · Ping', hours } }, 'FRONT-DESK');
    await A.stats(day - 40 * 864e5, { 'rt/ck1': { node: 'rt', name: 'Router · Ping', hours: [] } }, 'FRONT-DESK');
    // A blob signed by someone who is not a monitor: left out.
    const bad = await A.seal('stats', A.id + '|' + (day - 864e5), { checks: {} }, { sigPriv: P.sig });
    site().stats.push({ monitor: A.id, day: day - 864e5, record: bad });
    const st = await M.stats(siteId, day - 60 * 864e5, day);
    ok('7.1 the hourly figures are pulled and opened (a forged blob left out)', st.length === 2 && st.some((x) => x.day === day && x.checks['rt/ck1'].hours[0].checks === 60) && st.every((x) => x.name === 'FRONT-DESK'), show(st.map((x) => x.day)));
    const av = M.availability(hours, 3600);
    ok('7.2 availability leaves maintenance and unknown out, with its coverage', Math.abs(av.availability - 3000 / 3300) < 1e-9 && Math.abs(av.coverage - 3300 / 3600) < 1e-9, show(av));
    confirms.length = 0;
    const r30 = await M.setStatsDays(siteId, 30);
    ok('7.3 shortening Keep statistics asks first, naming what goes, then deletes it', confirms.length === 1 && /1 day of figures/.test(confirms[0]) && r30 && r30.deleted === 1 && site().stats.every((x) => x.day >= day - 30 * 864e5), show([confirms, r30]));
    await M.setStatsDays(siteId, 0);
    ok('7.4 Off keeps no figures on the server', site().stats.length === 0 && site().statsDays === 0);

    // ---- 9. Revoking ----
    M.state.invoke = async (cmd) => (cmd === 'monitor_link_info' ? { enrolled: true, site: siteId, monitor: B2.id } : cmd === 'monitor_unenroll' ? { enrolled: false } : null);
    const ep0 = site().epoch;
    await M.turnOff();
    ok('9.1 off on this PC revokes it: gone from the members and the monitors', !site().members.has(B2.id) && !site().monitors.some((x) => x.id === B2.id));
    ok('9.2 the key rotates, and the monitor left is wrapped the new key', site().epoch === ep0 + 1 && !!site().wraps[(ep0 + 1) + '|' + A.id] && !site().wraps[(ep0 + 1) + '|' + B2.id]);
    await A.unwrapKeys();
    ok('9.3 the monitor left opens the new key', A.keys.has(ep0 + 1));
    ok('9.4 the app forgets it', M.state.link && M.state.link.enrolled === false);
    M.state.invoke = null; M.state.link = null;
    await M.load(siteId);
    ok('9.5 the revoked monitor\'s last status no longer counts on an open page', !M.serverStatusesOf(getNode('rt')).some((x) => x.name === 'WARD-2')
       && !M.combinedStatus(getNode('rt')).some((x) => x.split), show(M.combinedStatus(getNode('rt'))));

    // ---- 11. Quiet windows ----
    // The website (no app): the owner's quiet control in the device section.
    state.selectedType = 'node'; state.selectedId = 'rt';
    grp.open = true; renderCheckSection(getNode('rt'));
    const qSel = document.getElementById('ckQuiet');
    ok('11.1 an owner on the website gets the quiet control in the device section', !!qSel);
    const qBefore = site().records.filter((x) => x.record.kind === 'quiet').length;
    if (qSel) { qSel.value = 'node:1h'; qSel.dispatchEvent(new Event('change', { bubbles: true })); }
    await until(() => site().records.filter((x) => x.record.kind === 'quiet').length > qBefore);
    const qRec = site().records.find((x) => x.record.kind === 'quiet' && x.record.id === 'node|rt');
    let qOpen = null;
    if (qRec) qOpen = JSON.parse(C.fromUtf8(await C.openRecord(qRec.record, await Y.siteKey(siteId, qRec.record.epoch), T.keys().sigPub)));
    ok('11.2 it goes to the monitors as a signed quiet record (scope, device, until)', !!qOpen && qOpen.scope === 'node' && qOpen.id === 'rt' && qOpen.until > Date.now() + 3500000 && qRec.record.author === T.me().id, show(qOpen));
    await A.unwrapKeys();
    const aKey = A.keys.get(qRec.record.epoch);
    let aOpen = null;
    try { aOpen = aKey ? JSON.parse(C.fromUtf8(await C.openRecord(qRec.record, aKey, T.keys().sigPub))) : null; } catch (e) { aOpen = null; }
    ok('11.3 the monitor opens it with the key wrapped to it', !!aOpen && aOpen.id === 'rt');
    ok('11.4 the page shows the device quiet until then', /quiet until/i.test(document.getElementById('checkBody').textContent) && M.siteQuiet(siteId).nodes.rt === qOpen.until, document.getElementById('checkBody').textContent.slice(0, 200));
    // A provider's quiet record is refused (only owners quiet the monitors).
    await P.unwrapKeys(siteId);
    await fake.putRecord(site(), await C.sealRecord({ site: siteId, kind: 'quiet', id: 'site|', epoch: site().epoch, author: P.user.id, at: Date.now() }, P.keys.get(siteId + '|' + site().epoch), P.sig,
      C.utf8(JSON.stringify({ scope: 'site', id: '', until: Date.now() + 3600000 }))));
    await M.load(siteId);
    ok('11.5 a provider\'s quiet window is refused, never applied', M.siteQuiet(siteId).site === 0 && M.siteState(siteId).refused.get('quiet|site|') && M.siteState(siteId).refused.get('quiet|site|').why === 'role');
    // Ended: folded, so it leaves the backups.
    await M.pushQuiet(siteId, 'node', 'rt', 0);
    await M.load(siteId);
    const qEnded = await until(() => (site().records.find((x) => x.record.kind === 'quiet' && x.record.id === 'node|rt') || {}).folded === true);
    ok('11.6 a quiet window that ended is folded', qEnded && !M.siteQuiet(siteId).nodes.rt);

    // ---- 13. Turning on: the network watched, a half-made monitor ----
    const C3 = await fake.remoteMonitor();
    const mons0 = site().monitors.length;
    const info1 = TopoChecks.state.info;
    TopoChecks.state.info = { on: true, alarms: false, networkId: 'lib_other', networkName: 'Home', retentionDays: 360, quiet: {} };
    M.state.invoke = async (cmd) => (cmd === 'monitor_device_key' ? { encPub: C3.encPub, sigPub: C3.sigPub, keyKind: 'file', name: 'LAB' } : cmd === 'monitor_enroll' ? { enrolled: true } : null);
    let otherErr = '';
    try { await M.turnOn(siteId, []); } catch (e) { otherErr = String(e && e.message || e); }
    ok('13.1 a PC that monitors another network is refused before anything is made', /monitors another network: Home/.test(otherErr) && site().monitors.length === mons0, otherErr);
    TopoChecks.state.info = info1;
    let enrollArgs = null;
    M.state.invoke = async (cmd, a) => { if (cmd === 'monitor_device_key') return { encPub: C3.encPub, sigPub: C3.sigPub, keyKind: 'file', name: 'LAB' }; if (cmd === 'monitor_enroll') { enrollArgs = a.args; throw new Error('no keychain'); } return null; };
    let halfErr = '';
    try { await M.turnOn(siteId, []); } catch (e) { halfErr = String(e && e.message || e); }
    ok('13.2 the network goes to the app with the enrolment', !!enrollArgs && enrollArgs.network === cardId, show(enrollArgs && enrollArgs.network));
    ok('13.3 a turn-on that fails half way takes the monitor away again', /no keychain/.test(halfErr) && site().monitors.length === mons0 && !site().members.has(enrollArgs.monitor), show([halfErr, site().monitors.length, mons0]));
    // Off while signed out: said plainly, only this PC forgets.
    confirms.length = 0;
    M.state.link = { enrolled: true, site: 's_elsewhere000000000000', monitor: 'm_0000000000000000000abc' };
    M.state.invoke = async (cmd) => (cmd === 'monitor_link_info' ? M.state.link : cmd === 'monitor_unenroll' ? { enrolled: false } : null);
    const offBtn = document.createElement('button'); offBtn.id = 'setSiteMonOff';
    document.body.appendChild(offBtn);
    offBtn.click();
    await until(() => confirms.length > 0);
    ok('13.4 Off without an owner\'s sign-in says the server cannot be told', confirms.length === 1 && /cannot be told/.test(confirms[0]), show(confirms));
    offBtn.remove();
    await until(() => M.state.link && M.state.link.enrolled === false);
    M.state.invoke = null; M.state.link = null;

    // ---- 10. A backup's unfolded records ----
    await A.unwrapKeys();   // 13's half-made monitor rotated the key when taken away
    const kOf = async (e) => Y.siteKey(siteId, e);
    const tr = await Y.walkRosters(siteId);
    const unfoldedRec = await A.seal('issue', 'in0000000009', { id: 'in0000000009', nodeId: 'pc', name: 'PC', behind: [], outages: [{ from: t0, to: t0 + 60000 }], acts: [], monitor: 'FRONT-DESK' });
    const recs = await M.backupIssues([unfoldedRec, forged], kOf, tr.rosters, tr.pubs, null);
    ok('10.1 a backup\'s records are checked (the forged one left out)', recs.length === 1 && recs[0].id === 'in0000000009', show(recs.map((x) => x.id)));
    const docAfter = await IS.foldRecordsIntoDoc(serializeDoc(), recs);
    const o9 = docAfter.incidents.find((i) => i.id === 'in0000000009');
    ok('10.2 and folded into the restored network with their log entry', !!o9 && o9.kind === 'outage' && docAfter.log.some((e) => e.incidentId === 'in0000000009' && e.event === 'outage'), show(o9));
    // Through the backup file's own door: a server backup carrying the
    // unfolded issue and an owner's act on it.
    await A.unwrapKeys();
    await A.issue({ id: 'in0000000010', networkId: 'x', nodeId: 'pc', name: 'PC', keys: [], behind: [], outages: [{ from: t0 }], flapping: false, monitor: 'FRONT-DESK', monitorId: A.id, acts: [], gone: false, rev: 1 });
    const actAt = Date.now() - 500;
    const ownAct = await C.sealRecord({ site: siteId, kind: 'act', id: `in0000000010|ack|${actAt}`, epoch: site().epoch, author: T.me().id, at: actAt }, await Y.siteKey(siteId, site().epoch), T.keys().uSig,
      C.utf8(JSON.stringify({ issue: 'in0000000010', act: 'ack', at: actAt, by: 'Ana', note: 'restored' })));
    fake.putRecord(site(), ownAct);
    const bfile = await fake.backupFile(siteId);
    let restored = null;
    try { restored = await TopoBackupFile.unlockBackup(JSON.parse(JSON.stringify(bfile)), { ask: () => { throw new Error('asked'); } }); } catch (e) { restored = { err: String(e && e.message || e) }; }
    const o10 = restored && restored.env ? (restored.env.doc.incidents || []).find((i) => i.id === 'in0000000010') : null;
    ok('10.3 a server backup\'s records are folded in when the file is opened (unlockBackup)', bfile.records.some((r) => r.id === 'in0000000010') && !!o10 && o10.kind === 'outage', show(restored && (restored.err || (restored.env.doc.incidents || []).map((i) => i.id))));
    ok('10.4 with the people\'s acts on them', !!o10 && o10.status === 'closed' && (o10.acts || []).some((a) => a.note === 'restored' && a.by === 'Ana'), show(o10 && o10.acts));

    ok('every sentence of js/monitors.js is translated (es, pt-BR, ru, ja)', (() => {
      const keys = ['Monitor at {name} stopped reporting', 'Not answering from {a}, answering from {b}: look at the path between them, not the device.', 'Make this PC the site\'s monitor', 'Revoke'];
      return ['es', 'pt-BR', 'ru', 'ja'].every((l) => keys.every((k) => { setLocale(l); const v = t(k); setLocale('en'); return v !== k; }));
    })());
    ok('no console error', errors.length === 0, errors.slice(0, 3).join(' | '));
    ok('no CSP violation', (window.__cspViolations || []).length === 0, (window.__cspViolations || []).join(' | '));
  } catch (e) {
    ok('the suite ran', false, ((e && e.stack) || String(e)).replace(/\n/g, ' | '));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
