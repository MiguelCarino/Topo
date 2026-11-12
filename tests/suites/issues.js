// @realtime @touch 360x740
// Issues and the alarm, the page's side (js/issues.js; outages in
// doc.incidents, js/model.js; their merge, js/merge.js; docs/SCOPE.md D132,
// D158-D160, D172, D173, step 7g), against a stub of the app's commands
// (desktop/src-tauri/src/monitorcmd.rs, which with issues.rs and alarm.rs
// has its own cargo tests; the card window itself is tests/alarm-e2e.mjs).
// Covered:
//   - format v19: an outage's fields kept (times down, the devices behind,
//     the monitor, flapping, acts), junk dropped, the schema naming them;
//   - folding: a record of the open network becomes one outage with one
//     'outage' log entry, once; a recovery and a repeat update it with no
//     entry; the card's Acknowledge (on the record) closes it with an
//     'acknowledged' entry; the app is told what was folded; a record of
//     another network waits; a read-only network folds nothing;
//   - the rows: not answering since, answering again since (softer), the
//     devices behind it, who acted; the landing line names the device;
//   - acting: Acknowledge with a note, Expected, each one undo step with its
//     entry and sent to the app; Report a problem prefilled (the device, its
//     symptom from the type, what the monitor saw) and its save recorded as
//     the act with the report's id; on the website the act is the
//     document's alone, and the app later gets it back from the fold;
//   - who may act: a viewer (read-only) has no buttons; a provider only on
//     what they cover;
//   - two installs acting at once: the merge keeps both acts and the earlier
//     close, with no question;
//   - the card's hand-over: locked, it asks to unlock first (Not now does
//     nothing), then acknowledges;
//   - Settings: Show alarms on this PC hidden on the website, off as
//     shipped in the app, sent to the app; Test the alarm sends the words
//     first, then the drill; the app's words carry the language and the
//     alarm's sentences;
//   - every sentence translated; Japanese says PC; the rows and Settings at
//     360 (44px targets, no sideways scroll); no console error.
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
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const change = (x, v) => { if (v !== undefined) { if (x.type === 'checkbox') x.checked = v; else x.value = v; } x.dispatchEvent(new Event('change', { bubbles: true })); };
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };
  const IS = window.TopoIssues;
  const asked = [];
  const dialogs = [];
  let promptAnswer = '';
  setDialogResponder((q) => { dialogs.push(q); return q.kind === 'confirm' ? true : q.kind === 'prompt' ? promptAnswer : undefined; });

  // ---- The app, as monitorcmd.rs answers ----
  const info = { on: true, running: true, elsewhere: false, retentionDays: 360, tray: true, autostart: true, networkId: 'k1', networkName: 'HQ', count: 3,
    quiet: { site: 0, nodes: {}, groups: {} }, platform: 'linux', statsFile: '', alarms: false, monitorName: 'desk-pc' };
  const records = new Map();
  const listeners = {};
  let pendingHand = null;   // what alarm_hand left in the app (monitorcmd.rs q.pending)
  const invoke = async (cmd, args) => {
    await wait(2);
    if (!/^monitor_|^alarm_|^this_computer$/.test(cmd)) return null;
    asked.push({ cmd, args: clone(args || {}) });
    switch (cmd) {
      case 'monitor_info': return clone(info);
      case 'monitor_set': { const a = args.args || {}; if (a.alarms !== undefined) info.alarms = a.alarms; return clone(info); }
      case 'monitor_status': return [];
      case 'monitor_plan': return clone(info);
      case 'monitor_history': return { kept: true, samples: [] };
      case 'monitor_issues': return clone([...records.values()]);
      case 'monitor_issue_act': {
        const r = records.get(args.id);
        if (!r) return null;
        if (!r.acts.some((a) => a.act === args.act.act && a.at === args.act.at && a.by === args.act.by)) { r.acts.push(clone(args.act)); r.acts.sort((a, b) => a.at - b.at); r.closed = r.acts[0].at; r.rev++; }
        return clone(r);
      }
      case 'monitor_issues_folded': return 0;
      case 'alarm_take': { const x = pendingHand; pendingHand = null; return x; }
      case 'alarm_test': return null;
      case 'this_computer': return { hostname: 'desk-pc', interfaces: [] };
      default: return null;
    }
  };
  const listen = async (name, cb) => { listeners[name] = cb; return () => {}; };
  const emit = (name, payload) => { if (listeners[name]) listeners[name]({ payload: clone(payload) }); };
  const outageOf = (id) => (state.incidents || []).find((x) => x.id === id) || null;
  const entries = (id, ev) => (state.log || []).filter((e) => e.kind === 'incident' && e.incidentId === id && (!ev || e.event === ev));

  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');

    // ---- Format v19 ----
    const nodes = [{ id: 'rt', type: 'router', name: 'R1' }, { id: 'sw', type: 'switch', name: 'SW' }, { id: 'pr', type: 'printer', name: 'Front printer' }];
    const raw = { id: 'inaaaaaaaaaa', at: 100, status: 'open', symptom: 'internet', kind: 'outage', nodeIds: ['rt'],
      outages: [{ from: 300, to: 200 }, { from: 100, to: 150 }, { from: 'x' }], behind: ['sw', 'pr', 'ghost'], monitor: '  desk-pc ', flapping: true, gone: 'yes',
      acts: [{ act: 'ack', at: 500, by: 'Ana', note: 'on it' }, { act: 'close', at: 1 }, { act: 'ack', at: 500, by: 'Ana' }, { act: 'report', at: 400, reportId: 'inbbbbbbbbbb' }, { act: 'expected', at: 0 }],
      junk: 1 };
    const n1 = normalizeIncident(raw, { nodes });
    ok('an outage keeps its kind, its times down in order (an end before its start dropped)', n1.kind === 'outage' && JSON.stringify(n1.outages) === '[{"from":100,"to":150},{"from":300}]', JSON.stringify(n1.outages));
    ok('…the devices behind it that exist, the monitor, flapping', JSON.stringify(n1.behind) === '["sw","pr"]' && n1.monitor === 'desk-pc' && n1.flapping === true && n1.gone === undefined);
    ok('…its acts, oldest first, one of each, a reported one with its report', JSON.stringify(n1.acts) === '[{"act":"report","at":400,"reportId":"inbbbbbbbbbb"},{"act":"ack","at":500,"by":"Ana","note":"on it"}]', JSON.stringify(n1.acts));
    ok('…and nothing else', n1.junk === undefined);
    const plain = normalizeIncident({ id: 'incccccccccc', at: 1, status: 'open', symptom: 'wifi', outages: [{ from: 1 }], acts: [{ act: 'ack', at: 2 }] });
    ok('a report that is not an outage carries none of it', plain.kind === undefined && plain.outages === undefined && plain.acts === undefined);
    const schema = JSON.parse(await (await fetch(`schema/topo-v${DOC_VERSION}.json`)).text());
    const ip = schema.$defs.document.properties.incidents.items.properties;
    ok('the schema names an outage\'s fields', ['kind', 'outages', 'behind', 'monitor', 'flapping', 'gone', 'acts'].every((k) => ip[k]) && ip.acts.items.properties.act.enum.join() === 'ack,report,expected');
    ok('the log knows the outage events', ['outage', 'acknowledged', 'expected', 'reported'].every((e) => INCIDENT_EVENTS.includes(e)));
    ok('a symptom from the device type', IS.symptomForType('router') === 'internet' && IS.symptomForType('printer') === 'printer' && IS.symptomForType('ap') === 'wifi' && IS.symptomForType('server') === 'other');

    // ---- A kept network, in the app ----
    const doc = { v: DOC_VERSION, nodes: [
      { id: 'rt', type: 'router', name: 'R1', x: 0, y: 0, interfaces: [{ ip: '10.0.0.1/24' }], checks: [{ id: 'p', proto: 'ping' }] },
      { id: 'sw', type: 'switch', name: 'SW', x: 100, y: 0, interfaces: [{ ip: '10.0.0.2/24' }], checks: [{ id: 'p', proto: 'ping' }] },
      { id: 'pr', type: 'printer', name: 'Front printer', x: 200, y: 0, interfaces: [{ ip: '10.0.0.9/24' }], checks: [{ id: 'p', proto: 'ping' }], providers: ['pv1'] }],
      links: [{ id: 'l1', source: 'rt', target: 'sw' }, { id: 'l2', source: 'sw', target: 'pr' }],
      providers: [{ id: 'pv1', name: 'PrintCo', services: ['vendor'] }, { id: 'pv2', name: 'NetCo', services: ['internet'] }] };
    persistLibrary({ k1: { id: 'k1', name: 'HQ', doc: clone(doc), created: 1, updated: Date.now() - 1000 }, k2: { id: 'k2', name: 'Other', doc: clone(doc), created: 1, updated: Date.now() - 2000 } });
    replaceDocument(libraryEntry('k1').doc, { libraryId: 'k1', origin: 'library' });
    await settle();

    // The website first: nothing is asked of anyone.
    openSettings(); await settle();
    ok('on the website: no Show alarms on this PC', el('setAlarmBox').hidden === true);
    closeSettings();
    ok('…and nothing asked', asked.length === 0 && !IS.hasHost());

    window.__TAURI__ = { core: { invoke }, event: { listen } };
    await TopoChecks.refreshInfo();
    const t0 = Date.now() - 20 * 60000;
    records.set('inr1aaaaaaaa', { id: 'inr1aaaaaaaa', networkId: 'k1', nodeId: 'rt', name: 'R1', keys: ['rt/p'], behind: ['sw', 'pr'], outages: [{ from: t0 }],
      flapping: false, monitor: 'desk-pc', acts: [], closed: null, gone: false, rev: 1 });
    records.set('inotherrrrrr', { id: 'inotherrrrrr', networkId: 'k2', nodeId: 'pr', name: 'Front printer', keys: ['pr/p'], behind: [], outages: [{ from: t0 }],
      flapping: false, monitor: 'desk-pc', acts: [], closed: null, gone: false, rev: 1 });
    const logBefore = (state.log || []).length;
    await IS.refreshIssues();
    await until(() => !!outageOf('inr1aaaaaaaa'));
    await IS.foldIssues();
    const o1 = outageOf('inr1aaaaaaaa');
    ok('a record of the open network is folded into an outage', !!o1 && o1.kind === 'outage' && o1.status === 'open' && o1.symptom === 'internet' && JSON.stringify(o1.nodeIds) === '["rt"]'
      && JSON.stringify(o1.behind) === '["sw","pr"]' && o1.monitor === 'desk-pc' && o1.at === t0, JSON.stringify(o1));
    ok('…with one \'outage\' log entry', entries('inr1aaaaaaaa', 'outage').length === 1 && (state.log || []).length === logBefore + 1);
    ok('a record of another network waits', !outageOf('inotherrrrrr'));
    const toldDone = (id) => asked.some((a) => a.cmd === 'monitor_issues_folded' && a.args.done.some((d) => d[0] === id));
    ok('a record this page folded is not yet given up by the app (an Undo could take the fold back)', !toldDone('inr1aaaaaaaa'));
    await IS.foldIssues();
    ok('folding again changes nothing', entries('inr1aaaaaaaa').length === 1 && JSON.stringify(outageOf('inr1aaaaaaaa')) === JSON.stringify(o1));
    // The network opened anew (a new undo history): found there as the
    // record says, the app is told.
    IS.state.foldNet = null;
    await IS.foldIssues();
    ok('the app is told what is in the document, once no undo can take it out', await until(() => asked.some((a) => a.cmd === 'monitor_issues_folded' && a.args.done.some((d) => d[0] === 'inr1aaaaaaaa' && d[1] === 1))));

    // Undo of a fold: kept undone (not folded straight back by the next
    // redraw), redo still there, and nothing given up by the app.
    records.set('inundoaaaaaa', { id: 'inundoaaaaaa', networkId: 'k1', nodeId: 'sw', name: 'SW', keys: ['sw/p'], behind: [], outages: [{ from: t0 + 5000, to: t0 + 9000 }],
      flapping: false, monitor: 'desk-pc', acts: [{ act: 'ack', at: t0 + 10000, by: 'Di', note: '', reportId: '' }], closed: t0 + 10000, gone: false, rev: 4 });
    emit('topo-issues', [records.get('inundoaaaaaa')]);
    ok('a closed, ended record is folded', await until(() => !!outageOf('inundoaaaaaa')));
    await wait(450);
    const undoneAt = asked.length;
    undo(); await settle();
    renderCanvasOnly(); await wait(450); renderCanvasOnly(); await wait(450);
    ok('Undo takes a fold back, and the redraws do not fold it again', !outageOf('inundoaaaaaa') && entries('inundoaaaaaa').length === 0);
    ok('…the app keeps the record (nothing lost)', !asked.slice(undoneAt).some((a) => a.cmd === 'monitor_issues_folded' && a.args.done.some((d) => d[0] === 'inundoaaaaaa')));
    redo(); await settle();
    ok('…and Redo puts it back', !!outageOf('inundoaaaaaa') && entries('inundoaaaaaa', 'acknowledged').length === 1);
    records.delete('inundoaaaaaa');

    // A record whose device is gone from the document: the app may drop it.
    records.set('ingoneaaaaaa', { id: 'ingoneaaaaaa', networkId: 'k1', nodeId: 'deleted-node', name: 'Old AP', keys: [], behind: [], outages: [{ from: t0, to: t0 + 1000 }],
      flapping: false, monitor: 'desk-pc', acts: [], closed: null, gone: true, rev: 2 });
    emit('topo-issues', [records.get('ingoneaaaaaa')]);
    await IS.foldIssues();
    ok('a record whose device left the document is given back to the app to drop', await until(() => asked.some((a) => a.cmd === 'monitor_issues_folded' && (a.args.dropped || []).includes('ingoneaaaaaa'))) && !outageOf('ingoneaaaaaa'));
    records.delete('ingoneaaaaaa'); IS.state.records.delete('ingoneaaaaaa');

    // Recovery: answering again, still open, no entry.
    const r1 = records.get('inr1aaaaaaaa');
    r1.outages[0].to = t0 + 14 * 60000; r1.rev++;
    emit('topo-issues', [r1]);
    ok('a recovery is folded: answering again since, still open', await until(() => { const x = outageOf('inr1aaaaaaaa'); return x && x.outages[0].to === t0 + 14 * 60000; })
      && outageOf('inr1aaaaaaaa').status === 'open' && entries('inr1aaaaaaaa').length === 1);
    ok('…and said once, softly', await until(() => /R1 is answering again \(down 14 min\)/.test(el('topoToast').textContent)), el('topoToast').textContent);
    ok('IS.outageRecovered reads it', IS.outageRecovered(outageOf('inr1aaaaaaaa')) === t0 + 14 * 60000);

    // The rows.
    openIncidentsView(); await settle();
    const row = () => document.querySelector('#incidentList .inc-row[data-inc="inr1aaaaaaaa"]');
    ok('the Problems tab shows it, softer once answering again', !!row() && row().classList.contains('inc-outage') && row().classList.contains('inc-recovered')
      && /Answering again since .* \(down 14 min\)\./.test(row().textContent) && /R1 and 2 devices behind it/.test(row().textContent), row() && row().textContent);
    ok('…the devices behind it and the monitor', /Behind it: SW, Front printer/.test(row().textContent) && /Checked by monitor desk-pc\./.test(row().textContent));
    ok('…with Acknowledge, Report a problem and Expected', ['outage-ack', 'outage-report', 'outage-expected'].every((a) => row().querySelector(`[data-inc-act="${a}"]`)));
    ok('the landing line names the device', /R1 not answering/.test(landingProblemsText(serializeDoc())), landingProblemsText(serializeDoc()));
    ok('the map marks it', openIncidentNodeIds().has('rt'));
    await audit('Problems, an outage');

    // A repeat.
    r1.outages.push({ from: t0 + 18 * 60000 }); r1.rev++;
    emit('topo-issues', [r1]);
    ok('a repeat joins the same outage, no new entry', await until(() => (outageOf('inr1aaaaaaaa').outages || []).length === 2) && entries('inr1aaaaaaaa').length === 1
      && IS.outageRecovered(outageOf('inr1aaaaaaaa')) === null);
    await settle();
    ok('…the row says not answering since', /Not answering since .*\./.test(row().textContent) && /Went down 2 times while open\./.test(row().textContent));

    // Acknowledge, with a note, one undo step, sent to the app.
    promptAnswer = 'Calling the ISP';
    row().querySelector('[data-inc-act="outage-ack"]').click();
    ok('Acknowledge asks for a note, naming the device', await until(() => dialogs.some((d) => d.kind === 'prompt' && /R1 is not answering/.test(d.message))));
    ok('…closes it with who, when and the note', await until(() => outageOf('inr1aaaaaaaa').status === 'closed') && outageOf('inr1aaaaaaaa').acts[0].act === 'ack'
      && outageOf('inr1aaaaaaaa').acts[0].note === 'Calling the ISP');
    ok('…with an \'acknowledged\' log entry', entries('inr1aaaaaaaa', 'acknowledged').length === 1);
    ok('…and tells the app', await until(() => asked.some((a) => a.cmd === 'monitor_issue_act' && a.args.id === 'inr1aaaaaaaa' && a.args.act.act === 'ack' && a.args.act.note === 'Calling the ISP')));
    await IS.foldIssues();
    ok('the app\'s answer folds with no second entry', entries('inr1aaaaaaaa', 'acknowledged').length === 1 && outageOf('inr1aaaaaaaa').acts.length === 1);

    // The card's Acknowledge (on the record, no page): folded as an act.
    records.set('insw2aaaaaaa', { id: 'insw2aaaaaaa', networkId: 'k1', nodeId: 'pr', name: 'Front printer', keys: ['pr/p'], behind: [], outages: [{ from: t0 + 60000 }],
      flapping: true, monitor: 'desk-pc', acts: [{ act: 'ack', at: t0 + 120000, by: 'Bo', note: 'from the card', reportId: '' }], closed: t0 + 120000, gone: false, rev: 3 });
    emit('topo-issues', [records.get('insw2aaaaaaa')]);
    ok('an act on the card is folded: closed, with its entry', await until(() => outageOf('insw2aaaaaaa') && outageOf('insw2aaaaaaa').status === 'closed')
      && entries('insw2aaaaaaa', 'outage').length === 1 && entries('insw2aaaaaaa', 'acknowledged').length === 1 && outageOf('insw2aaaaaaa').flapping === true);
    ok('…the log says it in words', /Outage acknowledged: Front printer\./.test(incidentLogText(entries('insw2aaaaaaa', 'acknowledged')[0])));

    // Expected.
    records.set('inexpaaaaaaa', { id: 'inexpaaaaaaa', networkId: 'k1', nodeId: 'sw', name: 'SW', keys: ['sw/p'], behind: [], outages: [{ from: t0 + 30000 }],
      flapping: false, monitor: 'desk-pc', acts: [], closed: null, gone: false, rev: 1 });
    emit('topo-issues', [records.get('inexpaaaaaaa')]);
    await until(() => !!outageOf('inexpaaaaaaa'));
    await settle();
    promptAnswer = '';
    const ex = document.querySelector('#incidentList .inc-row[data-inc="inexpaaaaaaa"] [data-inc-act="outage-expected"]');
    ex.click();
    ok('Expected asks, saying its time counts as maintenance', await until(() => dialogs.some((d) => d.kind === 'prompt' && /counts as maintenance/.test(d.message))));
    ok('…closes it as expected, sent to the app', await until(() => outageOf('inexpaaaaaaa').status === 'closed' && outageOf('inexpaaaaaaa').acts[0].act === 'expected')
      && entries('inexpaaaaaaa', 'expected').length === 1 && await until(() => asked.some((a) => a.cmd === 'monitor_issue_act' && a.args.act.act === 'expected')));

    // Report a problem: prefilled, and its save is the act.
    records.set('inreportaaaa', { id: 'inreportaaaa', networkId: 'k1', nodeId: 'pr', name: 'Front printer', keys: ['pr/p'], behind: [], outages: [{ from: t0 + 200000 }],
      flapping: false, monitor: 'desk-pc', acts: [], closed: null, gone: false, rev: 1 });
    emit('topo-issues', [records.get('inreportaaaa')]);
    await until(() => !!outageOf('inreportaaaa'));
    state.settings.reporter = { name: 'Ana', phone: '555 0100' };
    ok('Report a problem opens the report', IS.reportOutage('inreportaaaa') === true && TopoIncidents.draft.open);
    const dr = TopoIncidents.draft;
    ok('…prefilled: the device, its symptom, what the monitor saw', dr.symptom === 'printer' && JSON.stringify(dr.nodeIds) === '["pr"]' && /Front printer has not answered since/.test(dr.text)
      && /Checked by monitor desk-pc\./.test(dr.text) && dr.name === 'Ana' && dr.fromIssue === 'inreportaaaa', JSON.stringify({ s: dr.symptom, t: dr.text }));
    ok('…nothing sent on its own', !asked.some((a) => /report-mail/.test(JSON.stringify(a))) && outageOf('inreportaaaa').status === 'open');
    await wait(450);
    const beforeReport = JSON.stringify(serializeDoc());
    const repId = await TopoIncidents.createIncident(Object.assign({}, dr, { routedTo: [] }));
    TopoIncidents.closeProblemDialog();
    ok('saving the report is the act, with the report\'s id', !!repId && await until(() => outageOf('inreportaaaa').status === 'closed')
      && outageOf('inreportaaaa').acts[0].act === 'report' && outageOf('inreportaaaa').acts[0].reportId === repId && entries('inreportaaaa', 'reported').length === 1);
    ok('…by the report\'s reporter, sent to the app', outageOf('inreportaaaa').acts[0].by === 'Ana'
      && await until(() => asked.some((a) => a.cmd === 'monitor_issue_act' && a.args.id === 'inreportaaaa' && a.args.act.act === 'report' && a.args.act.reportId === repId)));
    await wait(450);
    undo(); await settle();
    ok('the report and its act are one undo step', JSON.stringify(serializeDoc()) === beforeReport && !(state.incidents || []).some((x) => x.id === repId)
      && outageOf('inreportaaaa').status === 'open' && entries('inreportaaaa', 'reported').length === 0);
    redo(); await settle();
    ok('…and redo brings both back', (state.incidents || []).some((x) => x.id === repId) && outageOf('inreportaaaa').status === 'closed');
    ok('…routed as any report: the printer\'s provider first', TopoIncidents.defaultSendTo(routeIncident(undefined, { nodeIds: ['pr'], symptom: 'printer' })).includes('pv1'));

    // On the website: the document's act alone; the app gets it back.
    records.set('inwebaaaaaaa', { id: 'inwebaaaaaaa', networkId: 'k1', nodeId: 'sw', name: 'SW', keys: ['sw/p'], behind: [], outages: [{ from: t0 + 300000 }],
      flapping: false, monitor: 'desk-pc', acts: [], closed: null, gone: false, rev: 1 });
    emit('topo-issues', [records.get('inwebaaaaaaa')]);
    await until(() => !!outageOf('inwebaaaaaaa'));
    await wait(400);
    delete window.__TAURI__;
    const actsAsked = asked.filter((a) => a.cmd === 'monitor_issue_act').length;
    const beforeWeb = JSON.stringify(serializeDoc());
    await IS.actOnOutage('inwebaaaaaaa', 'ack', { note: 'web', by: 'Cy' });
    ok('on the website an act is the document\'s', outageOf('inwebaaaaaaa').status === 'closed' && asked.filter((a) => a.cmd === 'monitor_issue_act').length === actsAsked);
    undo(); flushAutosave(); await settle();
    ok('an act is one undo step, its log entry with it', JSON.stringify(serializeDoc()) === beforeWeb && outageOf('inwebaaaaaaa').status === 'open' && entries('inwebaaaaaaa', 'acknowledged').length === 0);
    redo(); await settle();
    ok('…and redo puts it back', outageOf('inwebaaaaaaa').status === 'closed' && entries('inwebaaaaaaa', 'acknowledged').length === 1);
    window.__TAURI__ = { core: { invoke }, event: { listen } };
    await IS.foldIssues();
    ok('…and the next fold in the app sends it back', await until(() => asked.some((a) => a.cmd === 'monitor_issue_act' && a.args.id === 'inwebaaaaaaa' && a.args.act.by === 'Cy'))
      && records.get('inwebaaaaaaa').acts.length === 1);

    // Who may act.
    records.set('inprovaaaaaa', { id: 'inprovaaaaaa', networkId: 'k1', nodeId: 'rt', name: 'R1', keys: ['rt/p'], behind: [], outages: [{ from: Date.now() - 60000 }],
      flapping: false, monitor: 'desk-pc', acts: [], closed: null, gone: false, rev: 1 });
    records.set('inprovbbbbbb', { id: 'inprovbbbbbb', networkId: 'k1', nodeId: 'pr', name: 'Front printer', keys: ['pr/p'], behind: [], outages: [{ from: Date.now() - 60000 }],
      flapping: false, monitor: 'desk-pc', acts: [], closed: null, gone: false, rev: 1 });
    emit('topo-issues', [records.get('inprovaaaaaa'), records.get('inprovbbbbbb')]);
    await until(() => !!outageOf('inprovaaaaaa') && !!outageOf('inprovbbbbbb'));
    const PM = TopoProviderMode;
    const wasOn = PM.state.on;
    PM.state.on = true;
    PM.setProviderSelf(state.docId || state.libraryId, 'pv1');
    ok('a provider acts on what they cover', IS.mayActOnOutage(outageOf('inprovbbbbbb')) === true);
    ok('…not on what they do not', IS.mayActOnOutage(outageOf('inprovaaaaaa')) === false);
    ok('…and is told so', (await IS.actOnOutage('inprovaaaaaa', 'ack')) === false && outageOf('inprovaaaaaa').status === 'open' && /Only an owner/.test(el('topoToast').textContent));
    PM.state.on = wasOn;
    PM.setProviderSelf(state.docId || state.libraryId, null);
    state.readOnly = true; renderIncidentsPanel(); await settle();
    const roRow = document.querySelector('#incidentList .inc-row[data-inc="inprovaaaaaa"]');
    ok('a viewer (read-only) sees it with no buttons', !!roRow && !roRow.querySelector('[data-inc-act]') && IS.mayActOnOutage(outageOf('inprovaaaaaa')) === false);
    const foldedBefore = JSON.stringify(state.incidents);
    records.set('inroaaaaaaaa', { id: 'inroaaaaaaaa', networkId: 'k1', nodeId: 'sw', name: 'SW', keys: [], behind: [], outages: [{ from: Date.now() }], flapping: false, monitor: 'x', acts: [], closed: null, gone: false, rev: 1 });
    await IS.foldIssues();
    ok('…and a read-only network folds nothing', JSON.stringify(state.incidents) === foldedBefore);
    state.readOnly = false; renderIncidentsPanel();

    // Two installs acting at once (the merge).
    const base = clone(serializeDoc());
    const mine = clone(base), theirs = clone(base);
    const mi = mine.incidents.find((x) => x.id === 'inprovaaaaaa'), ti = theirs.incidents.find((x) => x.id === 'inprovaaaaaa');
    mi.acts = [{ act: 'ack', at: 800000, by: 'A' }]; mi.status = 'closed'; mi.closedAt = 800000;
    ti.acts = [{ act: 'expected', at: 700000, by: 'B', note: 'planned' }]; ti.status = 'closed'; ti.closedAt = 700000;
    ti.outages = [{ from: mi.outages[0].from, to: mi.outages[0].from + 5000 }];
    const p = TopoMerge.planMerge(mine, theirs, base);
    const it = p.items.find((x) => x.key === 'incidents:inprovaaaaaa');
    ok('two installs acting at once: no question', !!it && it.status !== 'conflict' && !p.items.some((x) => x.status === 'conflict'), JSON.stringify(it && it.fields));
    const merged = TopoMerge.applyMergePlan(mine, p, {}).doc.incidents.find((x) => x.id === 'inprovaaaaaa');
    ok('…both acts kept, the earlier close, the end of the time down', merged.acts.map((a) => a.by).join() === 'B,A' && merged.closedAt === 700000 && merged.status === 'closed'
      && merged.outages[0].to === mi.outages[0].from + 5000, JSON.stringify(merged));

    // The card hands an act over while locked.
    const realLocked = TopoLock.isLocked, realAsk = TopoLock.requestUnlock;
    let askedUnlock = null, unlockAnswer = false;
    TopoLock.isLocked = () => true;
    TopoLock.requestUnlock = (text) => { askedUnlock = text; return Promise.resolve(unlockAnswer); };
    const promptsBefore = dialogs.length;
    await IS.handOver({ id: 'inprovaaaaaa', act: 'ack', locked: true });
    ok('locked: Acknowledge from the card asks to unlock first', /Unlock to acknowledge/.test(askedUnlock || ''));
    ok('…Not now does nothing', dialogs.length === promptsBefore && outageOf('inprovaaaaaa').status === 'open');
    unlockAnswer = true;
    askedUnlock = null;
    // Locked until the unlock is asked for and given.
    TopoLock.isLocked = () => askedUnlock === null;
    promptAnswer = 'seen on the card';
    await IS.handOver({ id: 'inprovaaaaaa', act: 'ack', locked: true });
    ok('…unlocked, it acknowledges', /Unlock to acknowledge/.test(askedUnlock || '') && outageOf('inprovaaaaaa').status === 'closed' && outageOf('inprovaaaaaa').acts.some((a) => a.note === 'seen on the card'));
    TopoLock.isLocked = realLocked; TopoLock.requestUnlock = realAsk;
    await IS.handOver({ id: 'inprovbbbbbb', act: 'report', locked: false });
    ok('Report a problem from the card opens the prefilled report', TopoIncidents.draft.open && TopoIncidents.draft.fromIssue === 'inprovbbbbbb');
    TopoIncidents.closeProblemDialog();

    // The hand-over heard live: the app's copy is taken, so a later page
    // load does not replay it; an issue already acted on is not acted on
    // again.
    pendingHand = { id: 'inprovaaaaaa', act: 'ack', locked: false };
    const dialogsBefore = dialogs.length;
    const takesBefore = asked.filter((a) => a.cmd === 'alarm_take').length;
    emit('topo-alarm-act', pendingHand);
    ok('the event takes the app\'s copy of the hand-over', await until(() => asked.filter((a) => a.cmd === 'alarm_take').length > takesBefore) && pendingHand === null);
    ok('…and an issue already acted on is not acted on again', await until(() => /already acted on this issue/.test(el('topoToast').textContent))
      && dialogs.length === dialogsBefore && outageOf('inprovaaaaaa').acts.filter((a) => a.act === 'ack').length === 1, el('topoToast').textContent);
    // The same hand-over twice at once (the event and the boot's
    // alarm_take): acted on once.
    records.set('intwiceaaaaa', { id: 'intwiceaaaaa', networkId: 'k1', nodeId: 'sw', name: 'SW', keys: ['sw/p'], behind: [], outages: [{ from: Date.now() - 60000 }],
      flapping: false, monitor: 'desk-pc', acts: [], closed: null, gone: false, rev: 1 });
    emit('topo-issues', [records.get('intwiceaaaaa')]);
    await until(() => !!outageOf('intwiceaaaaa'));
    promptAnswer = 'once';
    const promptsAt = dialogs.length;
    await Promise.all([IS.handOver({ id: 'intwiceaaaaa', act: 'ack', locked: false }), IS.handOver({ id: 'intwiceaaaaa', act: 'ack', locked: false })]);
    ok('…the same hand-over twice is asked once', dialogs.slice(promptsAt).filter((d) => d.kind === 'prompt').length === 1 && outageOf('intwiceaaaaa').acts.length === 1);

    // ---- Settings: Show alarms on this PC ----
    await TopoChecks.refreshInfo();
    openSettings(); await settle();
    ok('in the app: Show alarms on this PC, off as shipped', el('setAlarmBox').hidden === false && el('setAlarmOn').checked === false);
    ok('…its help says what it does and the Wayland caveat', /covers every screen/.test(el('setAlarmBox').textContent) && /Wayland/.test(el('setAlarmBox').textContent));
    change(el('setAlarmOn'), true);
    ok('turning it on tells the app, with the alarm\'s words', await until(() => info.alarms === true) && (() => {
      const a = asked.filter((x) => x.cmd === 'monitor_set').pop().args.args;
      return a.alarms === true && a.labels.lang === 'en' && a.labels.alarm === '{name} is not answering' && a.labels.alarmBehind === '{name} and {n} devices behind it are not answering'
        && a.labels.alarmBehindOne === '{name} and 1 device behind it are not answering'
        && a.labels.recovered === '{name} is answering again (down {min} min)' && a.labels.by === 'Ana' && a.labels.drill === 'Test of the alarm: nothing is down.';
    })());
    await audit('Settings, Show alarms on this PC');
    const testAt = asked.length;
    el('setAlarmTest').click();
    ok('Test the alarm: the words first, then the drill', await until(() => asked.slice(testAt).some((a) => a.cmd === 'alarm_test'))
      && asked.slice(testAt).findIndex((a) => a.cmd === 'monitor_set') < asked.slice(testAt).findIndex((a) => a.cmd === 'alarm_test'));
    setLocale('es');
    await IS.testAlarm();
    ok('…in the page\'s language', asked.filter((a) => a.cmd === 'monitor_set').pop().args.args.labels.lang === 'es'
      && asked.filter((a) => a.cmd === 'monitor_set').pop().args.args.labels.alarm === '{name} no responde');
    setLocale('en');
    closeSettings();

    // ---- Translated ----
    const strings = ['Show alarms on this PC', 'Test the alarm', 'Acknowledge', 'Expected', 'Answering again', '{name} is not answering', '{name} and {n} devices behind it are not answering',
      '{name} is answering again (down {min} min)', 'Test of the alarm: nothing is down.', 'Not answering since {time} ({down}).', 'Answering again since {time} (down {down}).',
      'Behind it: {names}', 'Checked by monitor {pc}.', 'Unlock to acknowledge the device that is not answering.', 'Outage acknowledged: {name}.', 'Expected (maintenance): quiet until it answers again',
      'Acknowledge: you have seen that {name} is not answering and someone is on it. A note, if you like:',
      'Expected: maintenance or planned work on {name}. Its time counts as maintenance, not as down. A note, if you like:',
      'On Wayland a window cannot always stay above the others, and with several screens the card may show on one of them only: there the system notification is the one to rely on.',
      '{name} and 1 device behind it are not answering', 'Someone has already acted on this issue.'];
    const missing = [];
    CarinoI18N.locales.filter((l) => l !== 'en').forEach((l) => strings.forEach((s) => { if (!CarinoI18N.has(l, s)) missing.push(`${l}: ${s.slice(0, 40)}`); }));
    ok('every sentence of the issues is translated', !missing.length, `${missing.length}: ${missing.slice(0, 3).join(' | ')}`);
    setLocale('ja');
    ok('Japanese says PC', /PC/.test(t('Show alarms on this PC')) && /PC/.test(t('Checked by monitor {pc}.')) && strings.map((s) => t(s)).join('').match(/パソコン|コンピューター/) === null);
    // Russian after any number reads right (no "2 устройств").
    setLocale('ru');
    const ru2 = t('{name} and {n} devices behind it', { name: 'R1', n: 2 }) + ' ' + t('{n} devices behind it are not answering either.', { n: 3 }) + ' ' + t('Went down {n} times while open.', { n: 2 })
      + ' ' + t('{name} and {n} devices behind it are not answering', { name: 'R1', n: 4 });
    ok('Russian reads right after 2, 3 and 4', !/[234] (устройств|раз)\b/.test(ru2), ru2);
    setLocale('en');
    ok('no console error', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (err) {
    ok('the suite ran to the end', false, err && (err.stack || err.message));
  }
  delete window.__TAURI__;
  TopoChecks.state.info = null; TopoChecks.state.status.clear();
  TopoIssues.state.records.clear();
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
