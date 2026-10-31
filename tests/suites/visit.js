// Pinned findings, schedules and Serviced today (js/diagnostics.js "Pinned
// for the next visit", "Accepted findings"). What is held:
//   1. pins: a line of the Findings tab is pinned (with what to check, or
//      nothing), one undo step; it stays open and counted; the tab lists it
//      first under "To check on the next visit", the map marks the device;
//      unpinned from the line or the list; a pin whose finding went away is
//      still listed, saying so; pins travel through the file and drop what
//      is gone, and a damaged entry is dropped;
//   2. schedules: a finding scheduled until a date is accepted until then and
//      no longer counted; the dialog asks for both and refuses a past day or
//      no plan; the day after, it is open again by itself and says what was
//      scheduled; scheduling again replaces the lapsed entry; until travels
//      through the file;
//   3. Serviced today: from the panel or the visit list, Last serviced is
//      today, the service finding goes, its pin and schedule with it, other
//      devices' entries stay, one undo step;
//   4. the report: the technical sheet lists the visit and says "scheduled
//      until", the client's summary has "What is planned";
//   5. the words are translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const undoBtn = () => el('undoBtn');
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  let answer = null;
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return typeof answer === 'function' ? answer(req) : answer; });
  const day = (n) => todayISO(new Date(Date.now() + n * 86400000));
  const lab = () => ({ v: DOC_VERSION, nodes: [
    { id: 'late', type: 'server', name: 'Late Server', x: 0, y: 0, serviced: day(-400), serviceEvery: 12, interfaces: [] },
    { id: 'late2', type: 'server', name: 'Other Server', x: 100, y: 0, serviced: day(-410), serviceEvery: 12, interfaces: [] },
    { id: 'old', type: 'switch', name: 'Old Switch', x: 0, y: 100, inService: day(-9 * 366), interfaces: [] }
  ], links: [] });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); };
  const saved = () => JSON.parse(JSON.stringify(serializeDoc()));
  const findingsOf = (id, key) => topologyFindings().filter((f) => f.nodeIds.includes(id) && (!key || f.key === key));
  const counted = () => topologyFindings().filter(isCountedFinding).length;
  const lineFor = (id, key) => {
    validateTopology();
    for (let gi = 0; gi < panelGroups.length; gi++) {
      const ii = panelGroups[gi].items.findIndex((it) => it.findings.some((f) => f.nodeIds.includes(id) && f.key === key));
      if (ii >= 0) return { gi, ii, item: panelGroups[gi].items[ii] };
    }
    return null;
  };
  const click = (sel, at) => { const b = document.querySelector(`#conflictMsgList ${sel}[data-g="${at.gi}"][data-i="${at.ii}"]`); b.click(); return b; };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  try {
    // ---- 1: pins ----
    open();
    initHistory();
    const before = counted();
    answer = 'Bring the vendor contract';
    click('.ca-pin', lineFor('late', 'service'));
    await settle(); await settle();
    ok('Pin asks what to check, and pins the line', asked.length === 1 && /What should be checked/.test(asked[0].message)
       && state.pinned.length === 1 && state.pinned[0].check === 'service' && state.pinned[0].note === 'Bring the vendor contract', show(state.pinned));
    ok('as one undo step, and the finding still counts', steps() === 1 && counted() === before, `${steps()} ${counted()} ${before}`);
    ok('its scope is the date due', state.pinned[0].scope === nextServiceDate(getNode('late')));
    validateTopology();
    ok('the tab starts with the list to check on the next visit', !el('visitBox').classList.contains('hidden')
       && /To check on the next visit: 1/.test(el('visitSummary').textContent) && /Late Server/.test(el('visitList').textContent)
       && /To check: Bring the vendor contract/.test(el('visitList').textContent), el('visitList').textContent);
    ok('the line shows the pin, and offers Unpin', /📌/.test(document.querySelector(`#conflictMsgList .ca-line[data-g="${lineFor('late', 'service').gi}"][data-i="${lineFor('late', 'service').ii}"]`).textContent)
       && document.querySelector(`#conflictMsgList .ca-pin[data-g="${lineFor('late', 'service').gi}"][data-i="${lineFor('late', 'service').ii}"]`).textContent === 'Unpin');
    renderCanvasOnly();
    ok('the map marks the device, and only it', !!document.querySelector('#ui-node-late .node-pin')
       && document.querySelectorAll('.node-pin').length === 1, String(document.querySelectorAll('.node-pin').length));
    answer = '';
    click('.ca-pin', lineFor('old', 'age'));
    await settle(); await settle();
    ok('a pin with nothing to say is a pin too', state.pinned.length === 2 && !('note' in state.pinned[1]));
    click('.ca-pin', lineFor('old', 'age'));
    await settle();
    ok('Unpin on the line takes it off', state.pinned.length === 1 && state.pinned[0].check === 'service');
    answer = null;
    click('.ca-pin', lineFor('old', 'age'));
    await settle(); await settle();
    ok('dismissing the question pins nothing', state.pinned.length === 1);
    // In the file: pins with their note, devices gone dropped, junk dropped.
    const doc = saved();
    ok('pins travel through the file', show(doc.pinned) === show([{ check: 'service', scope: nextServiceDate(getNode('late')), nodeIds: ['late'], note: 'Bring the vendor contract' }]), show(doc.pinned));
    ok('a damaged entry is dropped on load', normalizePinned([{ check: 'x', nodeIds: [] }, null, { nodeIds: ['a'] }, { check: 'x', nodeIds: ['a', 'a', 3], note: 7 }]).length === 1
       && show(normalizePinned([{ check: 'x', nodeIds: ['a', 'a', 3] }])) === show([{ check: 'x', nodeIds: ['a'], linkIds: [] }]));
    // A pin whose finding went away is still listed.
    const p0 = Object.assign({}, state.pinned[0]);
    getNode('late').serviced = day(-5); save();
    validateTopology();
    ok('a pin whose finding is not raised now is still listed, saying so', /Late Server · Not raised at the moment/.test(el('visitList').textContent), el('visitList').textContent);
    document.querySelector('#visitList .ca-unpin').click();
    ok('Unpin on the list takes it off', state.pinned.length === 0 && el('visitBox').classList.contains('hidden'));
    open(); state.pinned = [p0]; save();

    // ---- 2: schedules ----
    const undue = counted();
    answer = { value: 'Vendor visit booked', date: day(10) };
    click('.ca-schedule', lineFor('late2', 'service'));
    await settle(); await settle();
    const last = asked[asked.length - 1];
    ok('Schedule asks what is planned and a day, from today on', /What is planned/.test(last.message) && last.date && last.date.min === day(0) && !!customDate(last.date.value));
    const sch = state.accepted.find((a) => a.nodeIds.includes('late2'));
    ok('scheduled: accepted until that day, and no longer counted', sch && sch.until === day(10) && sch.reason === 'Vendor visit booked' && counted() === undue - 1, show(state.accepted));
    validateTopology();
    ok('the Accepted list says until when', new RegExp('Scheduled until ' + day(10) + ': Vendor visit booked').test(el('acceptedList').textContent), el('acceptedList').textContent);
    ok('until travels through the file', saved().accepted.some((a) => a.until === day(10)) && normalizeAccepted([{ check: 'x', nodeIds: ['a'], reason: 'r', until: '2026-02-30' }])[0].until === undefined);
    answer = { value: 'Later', date: day(-1) };
    click('.ca-schedule', lineFor('old', 'age'));
    await settle(); await settle();
    ok('a day before today is refused', !state.accepted.some((a) => a.check === 'age'));
    answer = { value: '  ', date: day(5) };
    click('.ca-schedule', lineFor('old', 'age'));
    await settle(); await settle();
    ok('so is a schedule with no plan', !state.accepted.some((a) => a.check === 'age'));
    // The day after: a schedule that ran out (made directly, as the dialog never makes one).
    acceptFindings(findingsOf('old', 'age'), 'Replacement ordered', day(-1));
    const back = findingsOf('old', 'age')[0];
    ok('the day after its date, it is open again by itself', !back.accepted && isCountedFinding(back) && back.lapsed && back.lapsed.until === day(-1), show(back));
    validateTopology();
    ok('the line says what was scheduled, and the Accepted list leaves it out', new RegExp('Was scheduled until ' + day(-1) + ': Replacement ordered').test(el('conflictMsgList').textContent)
       && !/Replacement ordered/.test(el('acceptedList').textContent));
    acceptFindings(findingsOf('old', 'age'), 'Replacement arrives next month', day(30));
    ok('scheduling again replaces the one that ran out', state.accepted.filter((a) => a.check === 'age').length === 1 && state.accepted.find((a) => a.check === 'age').until === day(30));

    // ---- 3: Serviced today ----
    open();
    acceptFindings(findingsOf('late', 'service'), 'Waiting for parts', day(20));
    pinFindings(findingsOf('late', 'service'), 'Check the fans');
    pinFindings(findingsOf('late2', 'service'), '');
    initHistory();
    select('late', 'node');
    ok('the panel offers Serviced today on a device that is serviced', !el('servicedTodayBtn').classList.contains('hidden'));
    el('servicedTodayBtn').click();
    ok('it records today as the last service', getNode('late').serviced === day(0) && !findingsOf('late', 'service').length);
    ok('and takes its service pin and schedule away, not the other device\'s', !state.pinned.some((a) => a.nodeIds.includes('late')) && state.pinned.some((a) => a.nodeIds.includes('late2'))
       && !state.accepted.some((a) => a.nodeIds.includes('late')), show([state.pinned, state.accepted]));
    ok('in one undo step', steps() === 1);
    undo();
    ok('undo puts the date, the pin and the schedule back', getNode('late').serviced === day(-400) && state.pinned.length === 2 && state.accepted.length === 1);
    select('old', 'node');
    ok('a device that is not serviced has no Serviced today', el('servicedTodayBtn').classList.contains('hidden'));
    select(null, null);
    validateTopology();
    const visitBtn = [...document.querySelectorAll('#visitList .ca-serviced')];
    ok('the visit list offers it on a service pin', visitBtn.length === 2);
    visitBtn[1].click();
    ok('and from there it records it too', getNode('late2').serviced === day(0) && !state.pinned.some((a) => a.nodeIds.includes('late2')));

    // ---- 4: the report ----
    open();
    pinFindings(findingsOf('old', 'age'), 'Ask about the replacement budget');
    acceptFindings(findingsOf('late', 'service'), 'Vendor visit booked', day(10));
    const model = reportModel();
    ok('the model carries the visit and the schedules', model.visit.length === 1 && model.visit[0].note === 'Ask about the replacement budget'
       && model.scheduled.length === 1 && model.scheduled[0].accepted.until === day(10), show([model.visit, model.scheduled.length]));
    const sheet = reportSheet(model, null);
    ok('the technical sheet lists the visit and says until when', /To check on the next visit/.test(sheet) && /Ask about the replacement budget/.test(sheet)
       && new RegExp('Scheduled until ' + day(10)).test(sheet));
    const summary = summarySheet(model);
    ok('the client\'s summary says what is planned', /What is planned/.test(summary) && /On the next visit: Ask about the replacement budget/.test(summary)
       && new RegExp('By ' + day(10) + ': Vendor visit booked').test(summary), summary.slice(summary.indexOf('What is planned'), summary.indexOf('What is planned') + 600));

    // ---- 5: words ----
    setLocale('es'); applyLocale();
    validateTopology();
    ok('the buttons and the list are translated', /Para revisar en la próxima visita/.test(el('visitSummary').textContent)
       && [...document.querySelectorAll('#conflictMsgList .ca-schedule')].every((b) => b.textContent === 'Programar…') && el('servicedTodayBtn').textContent === 'Mantenimiento hecho hoy');
    setLocale('en'); applyLocale();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
