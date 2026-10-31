// Every date in a report counts to the report's date (js/model.js
// onChecksDay, js/report.js reportModel). What is held here:
//   1. a report dated in the past says what was true that day: no Age or
//      Service finding the device had not earned yet, the inventory and the
//      findings giving one age, a schedule that lapsed since still scheduled
//      (accepted, not counted), the summary's "By <date>" line, the
//      technical sheet's "Scheduled until", and a pin whose finding was not
//      raised then saying so;
//   2. "in N days" counts to that day too;
//   3. the dialog's date reaches the model with nothing stored (a read-only
//      document), and a binder's site counts to its own date;
//   4. the live document still counts to today afterwards, a blank date is
//      the live findings, a throw puts the day and the pass back, today's
//      memo is not evicted, and an outer lookup pass holding today's
//      diagnosis is not reused for the report's day;
//   5. the diagram is drawn for the report's day as well (a folded group's
//      card counts its findings), the map for today again afterwards, and a
//      binder's site diagram for that site's date.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const heldReport = state.report, heldReadOnly = state.readOnly;
  const heldHtml = window.reportHtml, heldDeliver = window.deliverReport, heldCapture = window.captureCanvasImage;

  // Relative to the real today, so the suite means the same any day it runs.
  const day = (n) => todayISO(new Date(Date.now() + n * 86400000));
  const R = day(-400);
  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n1', cidr: '10.0.0.0/24', gateway: '10.0.0.1' }],
    nodes: [
      // About 8.5 y old today (a switch lasts 8) and its service overdue;
      // at R about 7.4 y, with the service not due for months.
      { id: 'sw', type: 'switch', name: 'Core', x: 0, y: 0, portCount: 8, interfaces: [],
        inService: day(-3122), serviceEvery: 12, serviced: day(-500) },
      { id: 'a', type: 'pc', name: 'PC A', x: -100, y: 120, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] },
      { id: 'b', type: 'pc', name: 'PC B', x: 100, y: 120, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] }
    ],
    links: [
      { id: 'la', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'lb', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1' }
    ] });
  const swFinding = (fs, key) => fs.find((f) => f.key === key && (f.nodeIds || []).includes('sw'));
  const conflictOf = (fs) => fs.find((f) => f.key === 'ip-conflict');

  try {
    replaceDocument(lab(), { origin: 'file' }); initHistory();
    ok('the fixture: a switch lasts 8 years', typeLifeOf('switch') === 8);
    const live = topologyFindings();
    ok('the fixture: today the switch is old and overdue, the addresses clash',
       !!swFinding(live, 'age') && !!swFinding(live, 'service') && !!conflictOf(live), show(live.map((f) => f.key)));
    // Scheduled until a day that has passed by today but had not by R.
    acceptFindings([conflictOf(live)], 'Re-address in spring', day(10));
    state.accepted[0].until = day(-200);
    pinFindings([swFinding(topologyFindings(), 'age')], 'Ask budget');
    const liveCritical = topologyFindings().filter((f) => f.level === 'bad' && !f.accepted).length;
    state.report = Object.assign({}, state.report, { date: R });

    // ---- 1: a report dated R says what was true at R ----
    const m = reportModel();
    ok('no Age or Service finding the switch had not earned at R',
       !swFinding(m.findings, 'age') && !swFinding(m.findings, 'service') && !swFinding(m.accepted, 'age'), show(m.findings.map((f) => f.key)));
    const dev = m.devices.find((d) => d.id === 'sw');
    ok('the inventory and the findings give one age', /\b7 y\b/.test(dev.upkeep) && !m.findings.some((f) => /\b8 y\b/.test(f.detail)), dev.upkeep);
    const sched = conflictOf(m.scheduled);
    ok('the conflict is still scheduled at R, not counted',
       !!conflictOf(m.accepted) && !!sched && sched.accepted.until === day(-200) && !conflictOf(m.findings)
       && m.counts.critical === m.findings.filter((f) => f.level === 'bad').length && m.counts.critical < liveCritical,
       show({ critical: m.counts.critical, open: m.findings.map((f) => f.key) }));
    const summary = summarySheet(m);
    ok('the summary plans it by its date, and asks for no service',
       summary.includes(`By ${day(-200)}: Re-address in spring`) && !summary.includes('Was due for service'));
    const sheet = reportSheet(m, null);
    ok('the technical sheet says Scheduled until, and no replacement',
       sheet.includes('Scheduled until ' + day(-200)) && !sheet.includes('Plan its replacement'));
    const pin = m.visit.find((v) => v.key === 'age');
    ok('the age pin says it was not raised then', !!pin && pin.detail === 'Not raised at the moment.', show(pin));

    // ---- 2: "in N days" counts to the day ----
    const due = nextServiceDate(getNode('sw'));
    const [dy, dm, dd] = due.split('-').map(Number);
    const dueMinus10 = todayISO(new Date(dy, dm - 1, dd - 10));
    const soon = onChecksDay(dueMinus10, () => upkeepFindings()).find((f) => f.key === 'service-due');
    ok('ten days before it is due, it is due in 10 days', !!soon && soon.detail === `Due for service on ${due}, in 10 days.`, show(soon));

    // ---- 3: the dialog's date, a read-only document, a binder ----
    state.report = Object.assign({}, state.report, { date: '' });
    const fromMeta = reportModel({ date: R });
    ok('the date handed in counts, with none stored', !swFinding(fromMeta.findings, 'age') && !swFinding(fromMeta.findings, 'service'));
    let built = null;
    window.reportHtml = (model) => { built = model; return ''; };
    window.deliverReport = () => ({ url: '', name: '', opened: false });
    state.readOnly = true;
    try { await generateSiteReport(Object.assign({}, siteReportMeta(state.report), { date: R }), { summary: true, technical: false }); }
    finally { state.readOnly = heldReadOnly; window.reportHtml = heldHtml; window.deliverReport = heldDeliver; }
    ok('a read-only document\'s report counts to the typed date', !!built && !swFinding(built.findings, 'age') && built.meta.date === R,
       show(built && built.findings.map((f) => f.key)));
    state.report = Object.assign({}, state.report, { date: R });
    const doc = serializeDoc();
    state.report = Object.assign({}, state.report, { date: '' });
    const site = binderSiteModels([{ id: 's1', name: 'S', updated: 1, doc }])[0];
    ok('a binder\'s site counts to its own date', !!site.model && !swFinding(site.model.findings, 'age'), show(site.unreadable));

    // ---- 4: the live document is untouched ----
    state.report = Object.assign({}, state.report, { date: R });
    reportModel();
    const after = topologyFindings(), open = conflictOf(after);
    ok('afterwards the live findings count to today',
       !!swFinding(after, 'age') && !!swFinding(after, 'service') && !!open && !open.accepted && open.lapsed && open.lapsed.until === day(-200) && checksDay() === todayISO(),
       show(open));
    state.report = Object.assign({}, state.report, { date: '' });
    const keys = (fs) => fs.map((f) => `${f.key}|${f.subject}|${f.scope || ''}`).sort();
    const blank = reportModel();
    ok('a blank date is today\'s findings', show(keys(blank.findings.concat(blank.accepted))) === show(keys(topologyFindings().filter((f) => f.level !== 'info'))));
    let inner = 'unset', outerPass = null, threw = false;
    withLookupPass(() => {
      outerPass = lookupPass;
      try { onChecksDay(R, () => { inner = lookupPass; ok('inside, the day is the report\'s', checksDay() === R); throw new Error('boom'); }); }
      catch (e) { threw = true; }
      ok('a throw puts the day and the pass back', threw && inner === null && lookupPass === outerPass && checksDay() === todayISO());
    });
    state.report = Object.assign({}, state.report, { date: R });
    const before = currentDiagnosis();
    reportModel();
    ok('today\'s memo is not evicted', currentDiagnosis() === before);
    const nested = withLookupPass(() => { currentDiagnosis(); return reportModel(); });
    ok('an outer pass holding today\'s diagnosis is not reused', !swFinding(nested.findings, 'age') && !swFinding(nested.findings, 'service'));

    // ---- 5: the diagram counts to the day too ----
    // A folded group's card counts every open finding of its devices: today
    // the conflict (lapsed) and the switch's age and service too, at R not.
    const folded = lab();
    folded.groups = [{ id: 'g1', name: 'Office', kind: 'room' }];
    folded.nodes.forEach((n) => { n.group = 'g1'; });
    replaceDocument(folded, { origin: 'file', docId: 'reportdate-fold' });
    acceptFindings([conflictOf(topologyFindings())], 'Re-address in spring', day(10));
    state.accepted[0].until = day(-200);
    setGroupCollapsed('g1', true);
    const badge = () => { const b = document.querySelector('#ui-group-g1 .grp-node-badge'); return b ? `${b.getAttribute('data-severity')} ${b.textContent}` : 'none'; };
    const todayBadge = badge();
    ok('today the folded card is red', /^bad /.test(todayBadge), todayBadge);
    let drawn = null, drawnDay = null;
    window.captureCanvasImage = (...a) => { drawn = badge(); drawnDay = checksDay(); return heldCapture(...a); };
    window.reportHtml = () => '';
    window.deliverReport = () => ({ url: '', name: '', opened: false });
    try { await generateSiteReport(Object.assign({}, siteReportMeta(state.report), { date: R }), { summary: false, technical: true }); }
    finally { window.captureCanvasImage = heldCapture; window.reportHtml = heldHtml; window.deliverReport = heldDeliver; }
    // Every device is in the group, so the card counts the report's open findings.
    const atR = reportModel({ date: R }).findings.length;
    ok('the report\'s diagram is drawn for its date', drawnDay === R && drawn !== todayBadge && drawn.endsWith(' ' + atR),
       [drawnDay, drawn, todayBadge, atR].join(' / '));
    ok('and the map is drawn for today again', badge() === todayBadge && checksDay() === todayISO(), badge());
    setGroupCollapsed('g1', false);
    // A binder's site: its diagram is drawn for its own date.
    state.report = Object.assign({}, state.report, { date: R });
    const binderDoc = serializeDoc();
    state.report = Object.assign({}, state.report, { date: '' });
    let binderDay = null;
    window.captureCanvasImage = () => { binderDay = checksDay(); return Promise.resolve(null); };
    try { await captureBinderImages([{ id: 's1', name: 'S', model: {}, doc: binderDoc }]); }
    finally { window.captureCanvasImage = heldCapture; }
    ok('a binder\'s site diagram is drawn for that site\'s date', binderDay === R, String(binderDay));
  } catch (e) {
    ok('suite ran without throwing', false, e && e.stack);
  } finally {
    state.report = heldReport; state.readOnly = heldReadOnly;
    window.reportHtml = heldHtml; window.deliverReport = heldDeliver; window.captureCanvasImage = heldCapture;
    setDialogResponder(heldResponder);
  }

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
