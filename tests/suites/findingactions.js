// The buttons on an open line of the Findings tab (js/diagnostics.js
// renderFindingsPanel, askAcceptReason, servicedToday). What is held:
//   1. one Accept… with an optional date: there is no Schedule… any more; a
//      line that is not about a service offers Accept… and Pin, nothing
//      else; Accept asks for a reason and a day from today on, empty by
//      default; with a day it is accepted until then and stops counting,
//      with none it is accepted for good and the entry has no until key (in
//      memory and in the saved file); a past day, a day typed only in part
//      and an empty reason are refused;
//   2. Serviced today on a service line (overdue or due): it records today
//      on that device only, takes its service finding, pin and schedule and
//      leaves another device's, in one undo step; a folded line (two devices
//      with the same detail) services both in one step and undo puts both
//      back; a line about age has none, and neither has a read-only network;
//   3. the button is translated.
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
  // late and late2 are overdue on different days (two lines), old is past
  // its expected life, and pa and pb share an address.
  const lab = () => ({ v: DOC_VERSION, nodes: [
    { id: 'late', type: 'server', name: 'Late Server', x: 0, y: 0, serviced: day(-400), serviceEvery: 12, interfaces: [] },
    { id: 'late2', type: 'server', name: 'Other Server', x: 100, y: 0, serviced: day(-410), serviceEvery: 12, interfaces: [] },
    { id: 'old', type: 'switch', name: 'Old Switch', x: 0, y: 100, inService: day(-9 * 366), interfaces: [] },
    { id: 'pa', type: 'pc', name: 'Lab A', x: 0, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] },
    { id: 'pb', type: 'pc', name: 'Lab B', x: 100, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] }
  ], links: [] });
  // Two servers last serviced the same day: one folded line.
  const twins = () => ({ v: DOC_VERSION, nodes: [
    { id: 'f1', type: 'server', name: 'Twin A', x: 0, y: 0, serviced: day(-400), serviceEvery: 12, interfaces: [] },
    { id: 'f2', type: 'server', name: 'Twin B', x: 100, y: 0, serviced: day(-400), serviceEvery: 12, interfaces: [] }
  ], links: [] });
  // Due within the month: a note, not overdue.
  const soon = () => ({ v: DOC_VERSION, nodes: [
    { id: 'due', type: 'server', name: 'Due Server', x: 0, y: 0, serviced: day(-350), serviceEvery: 12, interfaces: [] }
  ], links: [] });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); initHistory(); };
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
  const btn = (sel, at) => at && document.querySelector(`#conflictMsgList ${sel}[data-g="${at.gi}"][data-i="${at.ii}"]`);
  const click = (sel, at) => { const b = btn(sel, at); b.click(); return b; };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const plainKeys = ['check', 'scope', 'nodeIds', 'linkIds', 'reason'];
  const plain = (a) => !!a && Object.keys(a).every((k) => plainKeys.includes(k));

  try {
    // ---- 1: Accept…, with or without a day ----
    open();
    validateTopology();
    ok('no line offers Schedule… any more', !document.querySelector('#conflictMsgList .ca-schedule'));
    const ipLine = lineFor('pa', 'ip-conflict');
    const acts = ipLine && btn('.ca-accept', ipLine) && btn('.ca-accept', ipLine).parentElement;
    ok('a line not about a service offers Accept… and Pin, nothing else', !!acts && acts.children.length === 2
       && acts.children[0].classList.contains('ca-accept') && acts.children[1].classList.contains('ca-pin'),
       acts ? [...acts.children].map((b) => b.className).join(' | ') : 'no line');

    const before = counted();
    answer = { value: 'Vendor visit booked', date: day(10) };
    click('.ca-accept', ipLine);
    await settle(); await settle();
    const req = asked[asked.length - 1];
    ok('Accept asks for a day too, empty, from today on', !!req && !!req.date && req.date.value === '' && req.date.min === todayISO(), show(req && req.date));
    const until = state.accepted.find((a) => a.check === 'ip-conflict');
    ok('with a day: accepted until it, and counted one less', !!until && until.until === day(10) && until.reason === 'Vendor visit booked' && counted() === before - 1,
       show([state.accepted, counted(), before]));

    open();
    answer = 'r';
    click('.ca-accept', lineFor('old', 'age'));
    await settle(); await settle();
    const forGood = state.accepted.find((a) => a.check === 'age');
    ok('answered with a line only: accepted for good, with no until key', !!forGood && plain(forGood) && !('until' in forGood), show(state.accepted));
    ok('and none in the saved file', (saved().accepted || []).length === 1 && plain(saved().accepted[0]), show(saved().accepted));
    answer = { value: 'r', date: '' };
    click('.ca-accept', lineFor('pa', 'ip-conflict'));
    await settle(); await settle();
    const forGood2 = state.accepted.find((a) => a.check === 'ip-conflict');
    ok('the date left empty: the same', !!forGood2 && plain(forGood2) && !('until' in forGood2)
       && saved().accepted.length === 2 && saved().accepted.every(plain), show(saved().accepted));

    open();
    answer = { value: 'Later', date: day(-1) };
    click('.ca-accept', lineFor('old', 'age'));
    await settle(); await settle();
    ok('a day before today is refused', !state.accepted.length, show(state.accepted));
    answer = { value: 'Later', date: '!' };
    click('.ca-accept', lineFor('old', 'age'));
    await settle(); await settle();
    ok('so is a day typed only in part (the dialog answers "!"), not taken as for good', !state.accepted.length, show(state.accepted));
    answer = { value: 'Later', date: '2026-13-40' };
    click('.ca-accept', lineFor('old', 'age'));
    await settle(); await settle();
    ok('and a day that does not exist', !state.accepted.length, show(state.accepted));
    answer = { value: '  ', date: '' };
    click('.ca-accept', lineFor('old', 'age'));
    await settle(); await settle();
    ok('so is an empty reason', !state.accepted.length, show(state.accepted));

    // ---- 2: Serviced today on the line ----
    open();
    validateTopology();
    ok('the two service lines offer Serviced today, the age line does not',
       document.querySelectorAll('#conflictMsgList .ca-serviced').length === 2 && !btn('.ca-serviced', lineFor('old', 'age')),
       String(document.querySelectorAll('#conflictMsgList .ca-serviced').length));
    ok('it comes first on the line', btn('.ca-serviced', lineFor('late', 'service')).parentElement.firstElementChild.classList.contains('ca-serviced'));
    click('.ca-serviced', lineFor('late', 'service'));
    ok('it records today on that device, and its service finding goes', getNode('late').serviced === day(0) && !findingsOf('late', 'service').length);
    ok('the other device is left as it was', getNode('late2').serviced === day(-410) && findingsOf('late2', 'service').length === 1);
    ok('in one undo step', steps() === 1, String(steps()));

    // Pinned both, late's schedule ran out (so its line is open), late2 scheduled.
    open();
    pinFindings(findingsOf('late', 'service'), 'Check the fans');
    pinFindings(findingsOf('late2', 'service'), '');
    acceptFindings(findingsOf('late', 'service'), 'Waiting for parts', day(-1));
    acceptFindings(findingsOf('late2', 'service'), 'Vendor visit booked', day(20));
    initHistory();
    click('.ca-serviced', lineFor('late', 'service'));
    ok('its pin and schedule no longer name it; the other device\'s still do',
       !state.pinned.some((a) => a.nodeIds.includes('late')) && state.pinned.some((a) => a.nodeIds.includes('late2'))
       && !state.accepted.some((a) => a.nodeIds.includes('late')) && state.accepted.some((a) => a.nodeIds.includes('late2')),
       show([state.pinned, state.accepted]));

    // A folded line: both devices, one step.
    open(twins());
    const twin = lineFor('f1', 'service');
    ok('two servers due the same day are one line, with one button', !!twin && twin.item.findings.flatMap((f) => f.nodeIds).includes('f2')
       && document.querySelectorAll('#conflictMsgList .ca-serviced').length === 1, show(twin && twin.item.findings.map((f) => f.nodeIds)));
    click('.ca-serviced', twin);
    ok('one click services both, in one undo step', getNode('f1').serviced === day(0) && getNode('f2').serviced === day(0) && steps() === 1
       && !topologyFindings().some((f) => f.key === 'service'), String(steps()));
    undo();
    ok('undo puts both back', getNode('f1').serviced === day(-400) && getNode('f2').serviced === day(-400));

    // Due soon (a note): the button too.
    open(soon());
    const dueLine = lineFor('due', 'service-due');
    ok('a service due soon offers it too', !!btn('.ca-serviced', dueLine), show(topologyFindings().map((f) => f.key)));
    if (dueLine) click('.ca-serviced', dueLine);
    ok('and clears it', getNode('due').serviced === day(0) && !findingsOf('due', 'service-due').length);

    // Read-only: nothing that edits.
    open();
    state.readOnly = true;
    validateTopology();
    ok('a read-only network offers no Serviced today', !document.querySelector('#conflictMsgList .ca-serviced'));
    state.readOnly = false;

    // ---- 3: words ----
    setLocale('es'); applyLocale();
    validateTopology();
    const es = document.querySelector('#conflictMsgList .ca-serviced');
    ok('the button is translated', !!es && es.textContent === 'Mantenimiento realizado', es && es.textContent);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    state.readOnly = false;
    setLocale('en'); applyLocale();
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
