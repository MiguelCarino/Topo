// One count for findings, and What is planned without duplicates
// (findingCounts in js/diagnostics.js, summaryVerdict and reportVisit in
// js/report.js). What is held here:
//   1. every count counts findings one by one: five devices on a wrong
//      gateway are five on the pill, the tab, the report's totals, a library
//      card and the client's verdict, while the summary still has one row for
//      the check naming all five;
//   2. the Accepted label counts accepted findings: an entry that covers
//      nothing at the moment is still listed (it says so) but counts 0, and an
//      accepted info finding counts nowhere, as in the report;
//   3. findingCounts itself, and the verdict in Spanish;
//   4. a finding pinned and also scheduled is one line in What is planned,
//      saying both, whichever came first; the technical sheet keeps its visit
//      and its Known / accepted sections; an info finding's schedule is
//      planned nowhere, pinned or not.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(() => null);
  const pc = (id, name, ip) => ({ id, type: 'pc', name, x: 100, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  // The network's gateway is an address nobody holds, so every PC on it
  // raises its own gateway finding.
  const gatewayLab = () => {
    const d = { v: DOC_VERSION,
      networks: [{ id: 'n', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.254' }],
      nodes: [{ id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] },
              { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 100, portCount: 8, interfaces: [] }],
      links: [{ id: 'l0', source: 'rt', target: 'sw', sourceIface: 'i1', targetIface: 'p8' }] };
    [1, 2, 3, 4, 5].forEach((n) => {
      d.nodes.push(pc('p' + n, 'Desk PC ' + n, `10.0.0.1${n}/24`));
      d.links.push({ id: 'l' + n, source: 'sw', target: 'p' + n, sourceIface: 'p' + n, targetIface: 'i1' });
    });
    return d;
  };
  // Two PCs on one address, as tests/suites/summary.js.
  const conflictLab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }],
    nodes: [{ id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] },
            { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 100, portCount: 8, interfaces: [] },
            pc('a', 'Reception PC', '10.0.0.11/24'), pc('b', 'Lab PC', '10.0.0.11/24')],
    links: [{ id: 'l0', source: 'rt', target: 'sw', sourceIface: 'i1', targetIface: 'p8' },
            { id: 'l1', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1' },
            { id: 'l2', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1' }] });
  // A rack whose one cable has no tag: an info finding.
  const rackLab = () => ({ v: DOC_VERSION,
    nodes: [{ id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 0, group: 'rk', rackU: 10, portCount: 8, interfaces: [] },
            { id: 'srv', type: 'server', name: 'SRV', x: 100, y: 0, group: 'rk', rackU: 5, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }],
    links: [{ id: 'l1', source: 'sw', target: 'srv', sourceIface: 'p1', targetIface: 'i1' }],
    groups: [{ id: 'rk', name: 'Rack 3', kind: 'rack', uHeight: 12 }] });
  const open = (doc) => { replaceDocument(doc, { origin: 'file' }); validateTopology(); };
  const todoRows = (html) => { const m = /<ol class="todo">([\s\S]*?)<\/ol>/.exec(html); return m ? m[1].split('</li>').filter((s) => s.includes('<li')) : []; };
  const plannedItems = (html) => { const m = /<ul class="planned">([\s\S]*?)<\/ul>/.exec(html); return m ? m[1].split('</li>').filter((s) => s.includes('<li')) : []; };
  const day = (n) => todayISO(new Date(Date.now() + n * 86400000));

  try {
    // ---- 1: one count, findings one by one ----
    open(gatewayLab());
    const gw = topologyFindings().filter((f) => f.key === 'gateway' && f.level === 'bad');
    ok('five PCs on a wrong gateway are five critical findings', gw.length >= 5, show(gw.map((f) => f.subject)));
    const c = findingCounts(topologyFindings());
    ok('the pill and the tab count the findings', el('conflictPillCount').textContent === String(c.open) && el('findTabCount').textContent === String(c.open),
       `${el('conflictPillCount').textContent} ${el('findTabCount').textContent} ${c.open}`);
    const m = reportModel();
    ok('the report\'s totals count the same', m.counts.critical === c.critical && m.counts.advisory === c.advisory, show([m.counts, c]));
    const sum = summarySheet(m);
    ok('the client\'s verdict: one kind of problem, on every PC it names', sum.includes(`One kind of problem needs fixing, on ${c.critical} devices`) && !sum.includes('One problem needs fixing'),
       sum.slice(sum.indexOf('verdict'), sum.indexOf('verdict') + 300));
    const gwRows = todoRows(sum).filter((r) => r.includes('A device cannot reach the way out of its network'));
    ok('and still one row for the check, naming every PC', gwRows.length === 1 && [1, 2, 3, 4, 5].every((n) => gwRows[0].includes('Desk PC ' + n)), show(gwRows));
    ok('a library card counts the same', librarySummary(serializeDoc()).critical === m.counts.critical, show([librarySummary(serializeDoc()), m.counts]));

    // ---- 2: Accepted counts findings, not entries ----
    open(conflictLab());
    const conflict = topologyFindings().find((f) => f.key === 'ip-conflict');
    acceptFindings([conflict], 'Lab bench, swapped by hand.');
    validateTopology();
    ok('accepted: the panel, the report and the count all say 1', /Accepted: 1\b/.test(el('acceptedSummary').textContent)
       && reportModel().counts.accepted === 1 && findingCounts(topologyFindings()).accepted === 1, el('acceptedSummary').textContent);
    getNode('b').interfaces[0].ip = '10.0.0.12/24';
    save();
    validateTopology();
    ok('an entry that covers nothing counts 0, and is still listed saying so', /Accepted: 0\b/.test(el('acceptedSummary').textContent)
       && !el('acceptedBox').classList.contains('hidden') && /Not raised at the moment\./.test(el('acceptedList').textContent),
       `${el('acceptedSummary').textContent} | ${el('acceptedList').textContent}`);
    ok('as the report says', reportModel().counts.accepted === 0, show(reportModel().counts));

    open(rackLab());
    const tag = topologyFindings().find((f) => f.key === 'rack-tag');
    ok('an untagged rack cable is an info finding', !!tag && tag.level === 'info', show(tag));
    acceptFindings([tag], 'Tags go on next week.');
    validateTopology();
    ok('an accepted info finding counts nowhere', /Accepted: 0\b/.test(el('acceptedSummary').textContent) && reportModel().counts.accepted === 0
       && findingCounts(topologyFindings()).accepted === 0, el('acceptedSummary').textContent);

    // ---- 3: findingCounts, and the verdict translated ----
    ok('findingCounts: critical, advisory, accepted, open; info nowhere',
       show(findingCounts([{ level: 'bad' }, { level: 'bad' }, { level: 'warn' }, { level: 'info' }, { level: 'bad', accepted: {} }, { level: 'info', accepted: {} }]))
       === show({ critical: 2, advisory: 1, accepted: 1, open: 3 }));
    open(gatewayLab());
    const n = findingCounts(topologyFindings()).critical;
    setLocale('es'); applyLocale();
    const es = summarySheet(reportModel());
    ok('in Spanish the verdict counts the same', es.includes(`Hay un tipo de problema que corregir, en ${n} dispositivos`), es.slice(es.indexOf('verdict'), es.indexOf('verdict') + 300));
    setLocale('en'); applyLocale();

    // ---- 4: What is planned, once per finding ----
    const servers = () => ({ v: DOC_VERSION, nodes: [
      { id: 'late', type: 'server', name: 'Late Server', x: 0, y: 0, serviced: day(-400), serviceEvery: 12, interfaces: [] },
      { id: 'late2', type: 'server', name: 'Other Server', x: 100, y: 0, serviced: day(-410), serviceEvery: 12, interfaces: [] }
    ], links: [] });
    const findingsOf = (id, key) => topologyFindings().filter((f) => f.nodeIds.includes(id) && (!key || f.key === key));
    const planned = (pinFirst) => {
      replaceDocument(servers(), { origin: 'file' });
      if (pinFirst) pinFindings(findingsOf('late', 'service'), 'Bring the spare fan');
      acceptFindings(findingsOf('late', 'service'), 'Vendor visit booked', day(10));
      if (!pinFirst) pinFindings(findingsOf('late', 'service'), 'Bring the spare fan');
      acceptFindings(findingsOf('late2', 'service'), 'Parts ordered', day(20));
      const model = reportModel();
      return { model, items: plannedItems(summarySheet(model)) };
    };
    const p = planned(true);
    ok('the schedules left are the unpinned ones', p.model.scheduled.length === 1 && p.model.scheduled[0].subject === 'Other Server', show(p.model.scheduled.map((f) => f.subject)));
    ok('the pin carries its schedule', p.model.visit.length === 1 && p.model.visit[0].scheduled.length === 1 && p.model.visit[0].scheduled[0].until === day(10)
       && p.model.visit[0].scheduled[0].reason === 'Vendor visit booked', show(p.model.visit));
    const late = p.items.filter((li) => li.includes('Late Server'));
    ok('What is planned: one line per finding, the pinned one saying both', p.items.length === 2 && late.length === 1
       && late[0].includes('On the next visit: Bring the spare fan') && late[0].includes('By ' + day(10) + ': Vendor visit booked')
       && p.items.some((li) => li.includes('Other Server') && li.includes('By ' + day(20) + ': Parts ordered')), show(p.items));
    const sheet = reportSheet(p.model, null);
    ok('the technical sheet still says until when and what to check', sheet.includes('Scheduled until ' + day(10)) && sheet.includes('Bring the spare fan'));
    const r = planned(false);
    ok('scheduled first, then pinned: still one line each', r.items.length === 2 && r.items.filter((li) => li.includes('Late Server')).length === 1, show(r.items));
    replaceDocument(servers(), { origin: 'file' });
    pinFindings(findingsOf('late', 'service'), 'Check the fans');
    const plain = plannedItems(summarySheet(reportModel()));
    ok('a pin with no schedule reads as before', plain.length === 1 && plain[0].includes('On the next visit: Check the fans') && !plain[0].includes('By '), show(plain));
    // An info finding's schedule is planned nowhere, pinned or not: the
    // report leaves the finding out.
    open(rackLab());
    const tagOf = () => topologyFindings().find((f) => f.key === 'rack-tag');
    acceptFindings([tagOf()], 'Label run booked', day(10));
    const unpinned = reportModel();
    ok('an info finding\'s schedule is not planned', !unpinned.scheduled.length && !summarySheet(unpinned).includes('Label run booked'), show(unpinned.scheduled));
    pinFindings([tagOf()], 'Bring the labeller');
    const pinned = reportModel();
    ok('nor once it is pinned', pinned.visit.length === 1 && !pinned.visit[0].scheduled.length && !summarySheet(pinned).includes('Label run booked')
       && !reportSheet(pinned, null).includes('Label run booked'), show(pinned.visit));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en'); applyLocale();
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
