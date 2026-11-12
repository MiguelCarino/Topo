// @realtime @touch 360x740
// The visit monitor, "Monitor during this visit" (js/visitmonitor.js;
// docs/SCOPE.md D148, D174, step 7i), against a stub of the app's
// commands (desktop/src-tauri/src/visitcmd.rs and visitmon.rs, which have
// their own cargo tests: the figures from known samples, the outages with
// root cause, Stop keeping the figures and dropping the samples, Off
// keeping nothing). Covered:
//   - the website (no window.__TAURI__): no section, nothing asked;
//   - it covers only the provider's items: the plan holds the checks of
//     the devices the chosen provider covers, nothing else; no provider
//     chosen, no Start;
//   - Start sends the plan and who it is for (the network, the report, the
//     provider, statistics on, the server user);
//   - the app's events: the states in the tab and the map's dot, an outage
//     said on this screen, and no issue for the client (no incident, no
//     issue or alarm command, nothing folded);
//   - Record visit: the section in the dialog, the visit entry's
//     `monitoring` (per check: answered, loss, availability with its
//     coverage, median, 95th percentile, the chart; the outages with their
//     cause), the before-and-after against a site monitor's 7 days before
//     ("the median went from 38 ms to 4 ms"), one undo step, the log still
//     chained; the session ended after it (the raw data gone); the copy
//     back carries it; the visit's report (charts and tables) and the
//     network report;
//   - Stop keeps the figures for Record visit (D174); leaving provider
//     mode ends it (asked first); signing out of the server ends it, and so
//     does someone else signing in; a new start on another network names it
//     before dropping its figures; a late event of an earlier session is
//     ignored;
//   - the whole page's app commands (window.__TAURI__) while it runs and an
//     outage comes: nothing asked of the issues or the alarm;
//   - statistics Off: started with nothing kept, no section in the visit;
//     a server site whose Keep statistics cannot be read counts as Off;
//     Off turned on during the visit drops the section at Save;
//   - the comparison through this PC's own site monitor (monitor_figures),
//     only whole hours before the visit (an hour straddling its start left
//     out), and the 7 days' coverage printed;
//   - the format: visitMonitoring keeps what it should and drops the rest;
//   - translated (es, ja says PC); the tab at 360 (44px targets, no
//     sideways scroll); no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const until = async (cond, n = 200) => { for (let i = 0; i < n && !(await cond()); i++) await wait(25); return cond(); };
  const show = (v) => JSON.stringify(v);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  await until(() => !!window.TopoVisitMonitor && !!window.TopoProviderMode && !!window.TopoIncidents && !!window.TopoChecks && !!window.TopoMonitors && typeof canSeal === 'function');
  const VM = window.TopoVisitMonitor, PM = window.TopoProviderMode, TI = window.TopoIncidents, CK = window.TopoChecks, MON = window.TopoMonitors;
  const held = { siteOfOpen: MON.siteOfOpen, siteState: MON.siteState, stats: MON.stats, loadMonitors: MON.loadMonitors };
  const heldTauri = window.__TAURI__;
  const heldCkInfo = CK.state.info;
  const heldLib = state.libraryId;
  const pageCmds = [];
  let lastQuestion = '';
  const toasts = [];
  const heldToast = window.showToast;
  window.showToast = (text, kind) => { toasts.push({ text, kind }); return heldToast(text, kind); };
  let confirmAnswer = true;
  setDialogResponder((q) => { if (q.kind === 'confirm') { lastQuestion = q.message || ''; return confirmAnswer; } return undefined; });

  try {
    setLocale('en');
    CarinoLibrary.persistLibrary({});
    const N = (id, type, ip, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra);
    const site = () => ({
      v: DOC_VERSION,
      report: { client: 'Clinica Sol', site: 'Reception' },
      providers: [{ id: 'pI', name: 'Fibra Norte', service: 'internet' }, { id: 'pT', name: 'Andes IT', service: 'it' }],
      groups: [{ id: 'gB', name: 'Office', kind: 'building', providers: ['pT'] }],
      nodes: [
        N('isp', 'cloud', '', { name: 'Internet' }),
        N('rt', 'router', '10.0.0.1/24', { name: 'R1', providers: ['pI'], checks: [{ id: 'p', proto: 'ping' }, { id: 'w', proto: 'http' }] }),
        N('mo', 'modem', '10.0.0.2/24', { name: 'Modem', providers: ['pI'], checks: [{ id: 'p', proto: 'ping' }] }),
        N('sw', 'switch', '10.0.0.3/24', { name: 'SW', group: 'gB', checks: [{ id: 'p', proto: 'ping' }] }),
        N('pc', 'pc', '10.0.0.9/24', { name: 'Reception PC', group: 'gB' })
      ],
      links: [{ id: 'l0', source: 'isp', target: 'mo' }, { id: 'l1', source: 'mo', target: 'rt' }, { id: 'l2', source: 'rt', target: 'sw' }, { id: 'l3', source: 'sw', target: 'pc' }]
    });

    // ---- 0. The website: nothing ----
    replaceDocument(site(), { origin: 'file', docId: 'vm-net' });
    const incId = await TI.createIncident({ symptom: 'internet', nodeIds: ['pc'], text: 'Slow since 9.', name: 'Ana', phone: '555-1', routedTo: ['pI'] });
    PM.enterProviderMode(incId);
    await settle();
    ok('0.1 the website shows no Monitor during this visit', !VM.hasHost() && !el('vmSection') && VM.section() === null);

    // ---- The app's commands, as visitcmd.rs answers ----
    const asked = [];
    let info = { running: false, meta: null, stopped: null, count: 0, statuses: [], outages: [], hasFigures: false };
    let figures = null;
    let localHours = {};
    let listener = null;
    VM.state.listen = (name, cb) => { if (name === 'topo-visit-monitor') listener = cb; return () => {}; };
    VM.state.invoke = async (cmd, args) => {
      await wait(2);
      asked.push({ cmd, args: clone(args || {}) });
      switch (cmd) {
        case 'visit_monitor_start':
          info = { running: true, meta: Object.assign({}, args.meta, { started: Date.now() - 3600000 }), stopped: null, count: args.plan.items.length, statuses: [], outages: [], hasFigures: !!args.meta.kept };
          return clone(info);
        case 'visit_monitor_info': return clone(info);
        case 'visit_monitor_plan': info.count = args.plan.items.length; return clone(info);
        case 'visit_monitor_figures': return figures && info.meta && info.meta.kept ? clone(figures) : null;
        case 'visit_monitor_stop': info.running = false; info.stopped = Date.now(); return clone(info);
        case 'visit_monitor_end': info = { running: false, meta: null, stopped: null, count: 0, statuses: [], outages: [], hasFigures: false }; return clone(info);
        case 'monitor_figures': return clone(localHours);
        default: return null;
      }
    };
    const cmds = () => asked.map((a) => a.cmd);
    PM.renderProviderPanel();
    await settle();

    // ---- 1. Only the provider's items ----
    ok('1.1 no provider chosen: the section asks for one, no Start', !!el('vmSection') && /Choose which provider you are/.test(el('vmSection').textContent) && !el('vmSection').querySelector('.btn-primary'),
       el('vmSection') && el('vmSection').textContent);
    PM.setProviderSelf('vm-net', 'pI');
    PM.renderProviderPanel();
    await settle();
    const plan = VM.planFor('pI');
    ok('1.2 the plan holds only the checks of the devices Fibra Norte covers', show(plan.items.map((i) => i.key).sort()) === show(['mo/p', 'rt/p', 'rt/w']), show(plan.items.map((i) => i.key)));
    const swItem = VM.planFor('pT').items[0] || {};
    ok('1.3 with the site monitor\'s upstream chains (root cause): the switch is behind the router', Array.isArray(swItem.chain) && swItem.chain.includes('rt'), show(swItem.chain));
    ok('1.4 Andes IT covers the switch only', show(VM.planFor('pT').items.map((i) => i.key)) === show(['sw/p']));
    const sec = el('vmSection');
    ok('1.5 the section says what it does and counts the checks', /for this visit only/.test(sec.textContent) && /3 checks\./.test(sec.textContent), sec.textContent);

    // ---- 2. Start ----
    // Every other part of the page asks the app through window.__TAURI__:
    // recorded while the visit monitor runs, so a call into the issues or
    // the alarm from any of them is seen (3.6).
    window.__TAURI__ = { core: { invoke: async (cmd) => { pageCmds.push(cmd); throw new Error('stub: ' + cmd); } }, event: { listen: async () => () => {} } };
    sec.querySelector('.btn-primary').click();
    await until(() => VM.active());
    const st = asked.find((a) => a.cmd === 'visit_monitor_start');
    ok('2.1 Start sends the provider\'s plan and who it is for', !!st && st.args.plan.items.length === 3 && st.args.meta.networkId === 'vm-net' && st.args.meta.incidentId === incId
       && st.args.meta.providerId === 'pI' && st.args.meta.kept === true && st.args.meta.who === '', show(st && st.args.meta));
    await settle();
    ok('2.2 the tab lists the checks being made, and Stop', el('vmSection').querySelectorAll('.vm-row').length === 3 && /Stop monitoring/.test(el('vmSection').textContent), el('vmSection').textContent);

    // ---- 3. Events: states and an outage, on this screen only ----
    const incidentsBefore = clone(state.incidents);
    const logBefore = state.log.length;
    const now = Date.now();
    listener({ payload: { statuses: [
      { key: 'mo/p', nodeId: 'mo', state: 'down', since: now - 600000, status: 'timeout', via: 'icmp', slow: false, flapping: false },
      { key: 'rt/p', nodeId: 'rt', state: 'down', since: now - 590000, cause: 'mo', status: 'timeout', via: 'icmp', slow: false, flapping: false },
      { key: 'rt/w', nodeId: 'rt', state: 'up', since: now - 3600000, rttMs: 4, status: '200', via: '', slow: false, flapping: false }],
      outages: [{ nodeId: 'mo', name: 'Modem', from: now - 600000 }] } });
    await settle();
    ok('3.1 the outage is said on this screen', toasts.some((x) => x.text === 'Modem is not answering' && x.kind === 'err'), show(toasts.slice(-2)));
    ok('3.2 the tab shows the states and the outage', /Not answering since/.test(el('vmSection').textContent) && /Outages seen/.test(el('vmSection').textContent) && /Modem: not answering since/.test(el('vmSection').textContent),
       el('vmSection').textContent.slice(0, 400));
    ok('3.3 the map\'s dot follows the visit monitor', CK.nodeLook(getNode('mo')) === 'down' && CK.nodeLook(getNode('rt')) === 'cause' && !!CK.state && !!checkMarkEl(getNode('mo')));
    ok('3.4 no dot on a device it does not check', checkMarkEl(getNode('sw')) === null);
    ok('3.5 no issue for the client: no incident, no log entry', show(state.incidents) === show(incidentsBefore) && state.log.length === logBefore);
    await wait(150);
    ok('3.6 nothing asked of the issues or the alarm, by any part of the page', !cmds().some((c) => /issue|alarm|notif/.test(c)) && !pageCmds.some((c) => /issue|alarm|notif/.test(c)), show(cmds().concat(pageCmds)));
    if (heldTauri === undefined) delete window.__TAURI__; else window.__TAURI__ = heldTauri;
    // A late event of an earlier session (another start) changes nothing.
    VM.onEvent({ started: 12345, statuses: [{ key: 'rt/w', nodeId: 'rt', state: 'down', since: now, status: 'timeout' }], outages: [] });
    ok('3.6b a late event of an earlier session is ignored', VM.state.statuses.get('rt/w').state === 'up' && VM.state.outages.length === 1);
    // A check added while it runs joins it.
    getNode('mo').checks.push({ id: 'h', proto: 'http' });
    VM.docChanged();
    await until(() => cmds().includes('visit_monitor_plan'), 120);
    ok('3.7 a check added during the visit is sent', (asked.filter((a) => a.cmd === 'visit_monitor_plan').pop() || { args: { plan: { items: [] } } }).args.plan.items.length === 4);
    getNode('mo').checks.pop();

    // ---- 4. Record visit, with a site monitor to compare with ----
    const t0 = now - 3600000;
    figures = { from: t0, to: now, items: [
      { key: 'rt/p', nodeId: 'rt', checkId: 'p', name: 'R1', proto: 'ping', via: '', asked: 60, answered: 54, loss: 0.1, avail: 0.9, coverage: 0.98, med: 4, p95: 9.5, min: 2, max: 20, step: 75000,
        rtt: Array.from({ length: 48 }, (_, i) => (i > 40 ? null : 3 + (i % 4))), states: 'u'.repeat(40) + 'd'.repeat(8) },
      { key: 'mo/p', nodeId: 'mo', checkId: 'p', name: 'Modem', proto: 'ping', via: 'tcp', asked: 60, answered: 50, loss: 0.1667, avail: 0.85, coverage: 1, med: 1.2, p95: 3, min: 1, max: 4, step: 75000,
        rtt: Array.from({ length: 48 }, () => 1.2), states: 'u'.repeat(38) + 'd'.repeat(10) }],
      outages: [{ nodeId: 'mo', name: 'Modem', from: now - 600000 }, { nodeId: 'rt', name: 'R1', from: now - 590000, cause: 'mo' }] };
    // The site's monitor on the server: its hourly figures of the week before.
    const day = (ms) => Math.floor(ms / 864e5) * 864e5;
    const hrs = [0, 1, 2].map((i) => ({ hour: Math.floor((t0 - (i + 5) * 3600000) / 3600000) * 3600000, checks: 60, ok: 60, fail: 0, rttMed: 38, rttP95: 50, sUp: 3600, sSlow: 0, sDown: 0, sUpstream: 0, sMaint: 0, sUnknown: 0 }));
    hrs.push({ hour: Math.floor((t0 + 3600000) / 3600000) * 3600000, checks: 60, ok: 60, fail: 0, rttMed: 999, rttP95: 999, sUp: 3600, sSlow: 0, sDown: 0, sMaint: 0, sUnknown: 0 });
    // The hour the visit starts in holds minutes of the visit: left out.
    hrs.push({ hour: Math.floor(t0 / 3600000) * 3600000, checks: 60, ok: 10, fail: 50, rttMed: 777, rttP95: 777, sUp: 600, sSlow: 0, sDown: 3000, sMaint: 0, sUnknown: 0 });
    let statsAsked = null;
    MON.siteOfOpen = () => 'S1';
    MON.siteState = () => ({ monitors: [{ id: 'm_1' }], statsDays: 360, statsAt: Date.now() });
    MON.stats = async (siteId, from, to) => { statsAsked = { siteId, from, to }; return [{ monitor: 'm_1', name: 'FRONT', day: day(t0), checks: { 'rt/p': { node: 'rt', hours: hrs } } }]; };
    PM.openVisitDialog();
    await until(() => PM.state.vd && PM.state.vd.changesState !== 'loading' && PM.state.vd.monState !== 'loading');
    const vd = PM.state.vd;
    ok('4.1 Record visit reads the site monitor\'s 7 days before the visit', !!statsAsked && statsAsked.siteId === 'S1' && statsAsked.from === day(t0 - 7 * 864e5) && statsAsked.to === day(t0), show(statsAsked));
    ok('4.2 the dialog says what is added', vd.monState === 'ok' && !el('visitMonitoring').hidden && /Monitored during the visit: 2 checks\. 2 outages seen\. Added to the visit and its report\. Saving the visit ends the monitoring\./.test(el('visitMonitoringText').textContent),
       el('visitMonitoringText').textContent);
    el('visitOutcomes').querySelector('input[value="fixed"]').click();
    el('visitBy').value = 'Juan';
    const logN = state.log.length;
    el('visitSaveBtn').click();
    await until(() => PM.state.vd && PM.state.vd.stage === 'return');
    const entry = state.log[state.log.length - 1];
    const m = entry && entry.monitoring;
    ok('4.3 the visit entry carries the monitoring section', state.log.length === logN + 1 && entry.kind === 'visit' && !!m && m.items.length === 2 && m.outages.length === 2, show(entry && Object.keys(entry)));
    const r1 = m && m.items.find((x) => x.node === 'rt');
    ok('4.4 per check: answered, loss, availability with coverage, median and 95th', !!r1 && r1.check === 'p' && r1.asked === 60 && r1.answered === 54 && r1.loss === 0.1 && r1.avail === 0.9 && r1.coverage === 0.98 && r1.med === 4 && r1.p95 === 9.5, show(r1));
    ok('4.5 the chart: 48 points and their states', !!r1 && r1.rtt.length === 48 && r1.states.length === 48 && r1.rtt[45] === null && r1.step === 75000);
    ok('4.6 a ping asked over TCP says so', (m.items.find((x) => x.node === 'mo') || {}).via === 'tcp');
    ok('4.7 the outages, the root cause named', m.outages[1].node === 'rt' && m.outages[1].cause === 'mo' && m.outages[1].causeName === 'Modem' && !m.outages[0].to, show(m.outages));
    ok('4.8 compared with the 7 days before (an hour inside the visit, and the hour it starts in, left out)', m.compared === true && !!r1.before && r1.before.med === 38 && r1.before.p95 === 50 && r1.before.avail === 1 && !(m.items.find((x) => x.node === 'mo') || {}).before, show(r1.before));
    ok('4.8b the 7 days\' coverage is kept: 3 hours of 168', !!r1.before && Math.abs(r1.before.coverage - 3 / 168) < 1e-4, show(r1.before));
    ok('4.9 "R1\'s median went from 38 ms to 4 ms"', VM.compareLines(m).some((l) => l === 'R1 · Ping: the median went from 38 ms to 4 ms.'), show(VM.compareLines(m)));
    ok('4.10 the log is still chained', (await TopoMerge.verifyLog(state.log)) === -1);
    await until(() => cmds().includes('visit_monitor_end'));
    ok('4.11 the session ended at Record visit: the raw data is gone', cmds().includes('visit_monitor_end') && !VM.active() && !el('vmSection').querySelector('.vm-row'));
    ok('4.12 the entry\'s summary says it in no language', /monitored 2 checks, 2 outages/.test(entry.summary), entry.summary);
    // The copy back carries it, and so does the message.
    const back = serializeDoc();
    ok('4.13 the copy back holds the section', ((back.log || []).find((e) => e.id === entry.id) || {}).monitoring.items.length === 2);
    const msg = PM.composeVisitMessage({ incident: TI.incidentById(incId), entry });
    ok('4.14 the message to the client names it', msg.body.includes('Monitored during the visit: 2 checks. 2 outages seen.'), msg.body);
    // The visit's report: tables and charts.
    el('visitReportBtn').click();
    await until(() => typeof sheetPreviewBuilt === 'function' && !!sheetPreviewBuilt());
    const html = sheetPreviewBuilt().html;
    ok('4.15 the visit\'s report has the section, a chart per check, the tables', /Visit report/.test(html) && /Monitoring during the visit/.test(html) && (html.match(/<svg /g) || []).length === 4
       && /95th percentile \(ms\)/.test(html) && /down because Modem/.test(html) && /the median went from 38 ms to 4 ms/.test(html), html.length + '');
    ok('4.15b the 7 days before print their coverage', /class="muted vm-before-cov">1\.79 % measured</.test(html), (html.match(/vm-before-cov[^<]*</) || [''])[0]);
    closeSheetPreview();
    const net = TI.incidentsReportSection(state.incidents, state.log);
    ok('4.16 the network report lists it under the visit', /vm-report/.test(net) && /Outages seen/.test(net));
    // One undo takes the visit (and its section) back.
    PM.closeVisitDialog();
    undo();
    ok('4.17 one undo step', state.log.length === logN && !state.log.some((e) => e.id === entry.id));
    redo();

    // ---- 5. Stop keeps the figures (D174); leaving stops; sign-out ends ----
    MON.siteOfOpen = () => null;
    PM.renderProviderPanel(); await settle();
    el('vmSection').querySelector('.btn-primary').click();
    await until(() => VM.active());
    el('vmSection').querySelector('.pb-acts .btn').click();
    await until(() => cmds().filter((c) => c === 'visit_monitor_stop').length === 1);
    await settle();
    ok('5.1 Stop: the checks end, the figures are kept for Record visit', /Stopped at/.test(el('vmSection').textContent) && /kept for Record visit/.test(el('vmSection').textContent), el('vmSection').textContent);
    const r = await VM.forVisit();
    ok('5.2 Record visit after Stop still has the section, no comparison without a site monitor', r.state === 'ok' && !r.running && !r.monitoring.compared && r.monitoring.items.length === 2);
    ok('5.3 with no site monitor the report says so', /No site monitor/.test(VM.sectionHtml(r.monitoring)));
    // Start again asks before dropping the kept figures.
    confirmAnswer = false;
    el('vmSection').querySelector('.pb-acts .btn').click();
    await wait(80);
    ok('5.4 Start again asks first; No keeps them', cmds().filter((c) => c === 'visit_monitor_start').length === 2);
    confirmAnswer = true;
    el('vmSection').querySelector('.pb-acts .btn').click();
    await until(() => VM.active());
    const endsAt = () => cmds().filter((c) => c === 'visit_monitor_end').length;
    let e0 = endsAt();
    confirmAnswer = false;
    await PM.leaveProviderMode();
    ok('5.5 leaving provider mode while it runs asks first; No stays', PM.state.on && VM.active() && endsAt() === e0 && /monitoring of this visit stops/.test(lastQuestion), lastQuestion);
    confirmAnswer = true;
    await PM.leaveProviderMode();
    ok('5.5b Yes: provider mode is left and the session ends, nothing kept on disk', !PM.state.on && endsAt() === e0 + 1 && !VM.state.info
       && cmds().filter((c) => c === 'visit_monitor_stop').length === 1);
    PM.enterProviderMode(incId);
    PM.setProviderSelf('vm-net', 'pI');
    PM.renderProviderPanel(); await settle();
    el('vmSection').querySelector('.btn-primary').click();
    await until(() => VM.active());
    // Signed in to a server: its own sign-out ends the session.
    const ends = cmds().filter((c) => c === 'visit_monitor_end').length;
    info.meta.who = 'u_1';
    VM.state.info.meta.who = 'u_1';
    TopoServer.emit('signed-out');
    await until(() => cmds().filter((c) => c === 'visit_monitor_end').length === ends + 1);
    ok('5.6 signing out of the server ends it (everything goes)', cmds().filter((c) => c === 'visit_monitor_end').length === ends + 1 && !VM.state.info);
    // Figures kept by u_1 (the app closed before their sign-out reached it):
    // someone else signed in neither sees nor records them, and they go.
    const heldMe = TopoServer.state.me;
    info = { running: false, meta: { networkId: 'vm-net', incidentId: incId, providerId: 'pI', kept: true, who: 'u_1', started: now - 3600000 }, stopped: now, count: 2, statuses: [], outages: [], hasFigures: true };
    TopoServer.state.me = { id: 'u_2' };
    e0 = endsAt();
    await VM.refresh();
    ok('5.7 another person signed in: the earlier person\'s figures go', endsAt() === e0 + 1 && !VM.state.info);
    TopoServer.state.me = null;
    info = { running: false, meta: { networkId: 'vm-net', incidentId: incId, providerId: 'pI', kept: true, who: 'u_1', started: now - 3600000 }, stopped: now, count: 2, statuses: [], outages: [], hasFigures: true };
    await VM.refresh();
    const fv = await VM.forVisit();
    ok('5.7b nobody signed in: they stay on the app, but are not shown or recorded here', !!VM.state.info && fv.state === 'none' && !/Stopped at/.test((el('vmSection') || {}).textContent || ''));
    TopoServer.state.me = heldMe;
    // Figures of another network not recorded yet: a start here names it.
    info = { running: false, meta: { networkId: 'other-net', incidentId: 'x', providerId: 'pI', kept: true, who: '', started: now - 3600000 }, stopped: now, count: 2, statuses: [], outages: [], hasFigures: true };
    await VM.refresh();
    PM.renderProviderPanel(); await settle();
    const starts = () => cmds().filter((c) => c === 'visit_monitor_start').length;
    const s0 = starts();
    confirmAnswer = false;
    lastQuestion = '';
    el('vmSection').querySelector('.btn-primary').click();
    await wait(120);
    ok('5.8 a start here asks before dropping another network\'s figures, and names it', starts() === s0 && /not recorded yet/.test(lastQuestion) && /another network|other-net/.test(lastQuestion), lastQuestion);
    confirmAnswer = true;
    info = { running: false, meta: null, stopped: null, count: 0, statuses: [], outages: [], hasFigures: false };
    await VM.refresh();

    // ---- 6. Statistics Off ----
    MON.siteOfOpen = () => 'S1';
    // The site's Keep statistics not read yet, and unreadable: Off.
    const unread = { monitors: [], statsDays: 360, statsAt: 0 };
    MON.siteState = () => unread;
    MON.loadMonitors = async () => { throw new Error('offline'); };
    PM.renderProviderPanel(); await settle();
    el('vmSection').querySelector('.btn-primary').click();
    await until(() => VM.active());
    ok('6.0 Keep statistics not readable: started with nothing kept (fail closed)', asked.filter((a) => a.cmd === 'visit_monitor_start').pop().args.meta.kept === false);
    await VM.end();
    // Read when needed: on, then the owner turns it Off during the visit.
    const live = { monitors: [], statsDays: 360, statsAt: 0 };
    MON.siteState = () => live;
    MON.loadMonitors = async () => { live.statsAt = Date.now(); return live; };
    el('vmSection').querySelector('.btn-primary').click();
    await until(() => VM.active());
    ok('6.0b read first, then kept', asked.filter((a) => a.cmd === 'visit_monitor_start').pop().args.meta.kept === true && live.statsAt > 0);
    PM.openVisitDialog();
    await until(() => PM.state.vd && PM.state.vd.monState !== 'loading' && PM.state.vd.changesState !== 'loading');
    const vdOn = PM.state.vd.monState;
    live.statsDays = 0;
    el('visitOutcomes').querySelector('input[value="partly"]').click();
    el('visitBy').value = 'Juan';
    el('visitSaveBtn').click();
    await until(() => PM.state.vd && PM.state.vd.stage === 'return');
    const eOff = state.log[state.log.length - 1];
    ok('6.0c turned Off during the visit: Save adds no section', vdOn === 'ok' && eOff.kind === 'visit' && eOff.monitoring === undefined, show({ vdOn, keys: Object.keys(eOff) }));
    PM.closeVisitDialog();
    await until(() => !VM.state.info);
    MON.siteState = () => ({ monitors: [], statsDays: 0, statsAt: Date.now() });
    PM.renderProviderPanel(); await settle();
    ok('6.1 the tab says statistics are off', /Statistics are off for this network/.test(el('vmSection').textContent));
    el('vmSection').querySelector('.btn-primary').click();
    await until(() => VM.active());
    ok('6.2 started with nothing kept', asked.filter((a) => a.cmd === 'visit_monitor_start').pop().args.meta.kept === false);
    PM.openVisitDialog();
    await until(() => PM.state.vd && PM.state.vd.monState !== 'loading' && PM.state.vd.changesState !== 'loading');
    ok('6.3 the dialog says no section', PM.state.vd.monState === 'off' && /no monitoring section/.test(el('visitMonitoringText').textContent));
    el('visitOutcomes').querySelector('input[value="partly"]').click();
    el('visitBy').value = 'Juan';
    el('visitSaveBtn').click();
    await until(() => PM.state.vd && PM.state.vd.stage === 'return');
    const e2 = state.log[state.log.length - 1];
    ok('6.4 the visit saves with no monitoring section, and the session ends', e2.kind === 'visit' && e2.monitoring === undefined && !VM.state.info, show(Object.keys(e2)));
    PM.closeVisitDialog();
    Object.assign(MON, held);

    // ---- 6b. The comparison through this PC's own site monitor ----
    MON.siteOfOpen = () => null;
    if (!state.libraryId) state.libraryId = 'lib-vm';
    CK.state.info = { on: true, networkId: state.libraryId, retentionDays: 360 };
    const H = 3600000;
    const v0 = Math.floor(now / H) * H - 2 * H + 40 * 60000;  // 40 minutes into an hour
    localHours = { 'rt/p': [
      { hour: Math.floor(v0 / H) * H - 3 * H, checks: 60, ok: 60, fail: 0, rttMed: 20, rttP95: 30, sUp: 3600, sSlow: 0, sDown: 0, sMaint: 0, sUnknown: 0 },
      { hour: Math.floor(v0 / H) * H, checks: 60, ok: 60, fail: 0, rttMed: 555, rttP95: 555, sUp: 2400, sSlow: 0, sDown: 1200, sMaint: 0, sUnknown: 0 }] };
    const local = await VM.sectionOf({ from: v0, to: now, items: [Object.assign({}, figures.items[0])], outages: [] });
    const lf = asked.filter((a) => a.cmd === 'monitor_figures').pop();
    ok('6b.1 this PC\'s own figures are asked: the keys, 7 days of whole hours before the visit', !!lf && show(lf.args.keys) === show(['rt/p']) && lf.args.to === Math.floor(v0 / H) * H && lf.args.from === Math.floor(v0 / H) * H - 7 * 864e5, show(lf && lf.args));
    ok('6b.2 compared with them; the hour the visit starts in left out', !!local && local.compared === true && !!local.items[0].before && local.items[0].before.med === 20 && local.items[0].before.avail === 1, show(local && local.items[0].before));
    CK.state.info = Object.assign({}, CK.state.info, { retentionDays: 0 });
    const n0 = asked.filter((a) => a.cmd === 'monitor_figures').length;
    const noStats = await VM.sectionOf({ from: v0, to: now, items: [Object.assign({}, figures.items[0])], outages: [] });
    ok('6b.3 this PC keeping no statistics: nothing asked, no comparison', asked.filter((a) => a.cmd === 'monitor_figures').length === n0 && !noStats.compared);
    // A server site whose monitors cannot be read: said so, not "no site monitor".
    MON.siteOfOpen = () => 'S1';
    MON.siteState = () => ({ monitors: [], statsDays: 360, statsAt: 0 });
    MON.loadMonitors = async () => { throw new Error('offline'); };
    const unreadSec = await VM.sectionOf({ from: v0, to: now, items: [Object.assign({}, figures.items[0])], outages: [] });
    ok('6b.4 the site monitor unreadable: the section says so', unreadSec.unread === true && !unreadSec.compared && /could not be read/.test(VM.sectionHtml(unreadSec)) && !/No site monitor/.test(VM.sectionHtml(unreadSec)));
    CK.state.info = heldCkInfo;
    state.libraryId = heldLib;
    Object.assign(MON, held);

    // ---- 7. The format ----
    const norm = visitMonitoring({ from: 10, to: 5 });
    ok('7.1 a span that ends before it starts is dropped', norm === undefined);
    const big = visitMonitoring({ from: 1000, to: 2000, compared: 'yes', items: Array.from({ length: 70 }, (_, i) => ({ node: 'n' + i, proto: 'gopher', asked: 3, answered: 9, loss: 2, coverage: 0.5, states: 'udx', rtt: [1, 2, 3], step: 5 })),
      outages: [{ node: '', from: 1 }, { node: 'a', from: 1500, to: 1400, cause: 'b' }] });
    ok('7.2 at most 60 checks, the rest counted; unknown values dropped', big.items.length === 60 && big.more === 10 && big.items[0].proto === 'ping' && big.items[0].answered === 3 && big.items[0].loss === undefined
       && big.items[0].states === undefined && big.compared === undefined, show(big.items[0]));
    ok('7.3 an outage with no device is dropped, an end before its start too', big.outages.length === 1 && big.outages[0].to === undefined && big.outages[0].cause === 'b');
    ok('7.4 normalizing twice changes nothing', show(visitMonitoring(m)) === show(m));
    const loaded = clone(serializeDoc());
    replaceDocument(loaded, { origin: 'file', docId: 'vm-net2' });
    ok('7.5 a saved network reads it back', ((state.log || []).find((e) => e.id === entry.id) || {}).monitoring.items.length === 2);

    // ---- 8. Translated; the tab at 360 ----
    replaceDocument(site(), { origin: 'file', docId: 'vm-net' });
    const inc3 = await TI.createIncident({ symptom: 'internet', nodeIds: ['pc'], text: 'x', name: 'Ana', phone: '555-1', routedTo: ['pI'] });
    PM.enterProviderMode(inc3);
    PM.setProviderSelf('vm-net', 'pI');
    setLocale('es'); applyLocale(); PM.renderProviderPanel(); await settle();
    ok('8.0 provider mode on the new copy', PM.state.on && !!el('vmSection'), show({ on: PM.state.on, doc: state.docId, inc: inc3, pm: PM.state.docId, ro: state.readOnly }));
    ok('8.1 the tab in Spanish', /Monitorear durante esta visita/.test(el('vmSection').textContent) && /3 comprobaciones\./.test(el('vmSection').textContent), el('vmSection').textContent);
    setLocale('ja'); applyLocale(); PM.renderProviderPanel(); await settle();
    ok('8.2 Japanese says PC', /PC/.test(el('vmSection').textContent) && !/パソコン|コンピューター/.test(el('vmSection').textContent), el('vmSection').textContent);
    ok('8.3 the visit\'s report in Japanese', /訪問レポート/.test(VM.visitReportHtml(entry)) && /訪問中の監視/.test(VM.visitReportHtml(entry)));
    setLocale('en'); applyLocale(); PM.renderProviderPanel();
    if (typeof openProviderPanel === 'function') PM.openProviderPanel();
    await settle();
    if (window.touchAudit) {
      el('vmSection').scrollIntoView();
      await settle();
      // The section's own controls, in each of its states (not started,
      // running, stopped), measured directly.
      const small = [];
      const measure = (label) => el('vmSection').querySelectorAll('button').forEach((b) => {
        const r = b.getBoundingClientRect();
        if (r.width && (r.height < 44 || r.width < 44)) small.push(`${label}: ${b.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      measure('idle');
      const nIdle = el('vmSection').querySelectorAll('button').length;
      el('vmSection').querySelector('.btn-primary').click();
      await until(() => VM.active()); await settle();
      measure('running');
      el('vmSection').querySelector('.pb-acts .btn').click();
      await until(() => VM.state.info && !VM.state.info.running); await settle();
      measure('stopped');
      const nStopped = el('vmSection').querySelectorAll('button').length;
      ok(`8.4 the tab @${innerWidth}: its buttons are 44px targets in every state`, !small.length && nIdle >= 1 && nStopped === 2, small.slice(0, 4).join(' | ') || `${nIdle}/${nStopped}`);
      await VM.end(); await settle();
    }
    ok(`8.5 no sideways scroll @${innerWidth}`, document.documentElement.scrollWidth <= innerWidth, document.documentElement.scrollWidth + '');
    await PM.leaveProviderMode();
    ok('8.6 no console error', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e).slice(0, 300));
  } finally {
    Object.assign(MON, held);
    if (heldTauri === undefined) delete window.__TAURI__; else window.__TAURI__ = heldTauri;
    CK.state.info = heldCkInfo;
    window.showToast = heldToast;
    VM.state.invoke = null; VM.state.listen = null; VM.state.info = null;
  }
  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
