// The docked Findings tab and "Accept with reason" (plan R5, phase 2 part;
// js/diagnostics.js "Accepted findings" and "The Findings tab"):
//   1. the findings are a tab of the rail, grouped by check, with a pill on the
//      map that counts the open ones and opens the tab;
//   2. Accept… asks for a reason (required), stores { check, nodeIds,
//      linkIds, reason } in the document as one undo step, moves the finding
//      to Accepted with its reason, and takes it out of every count: the tab,
//      the pill, the badge, has:finding, a card's summary, the report's totals
//      and a bulk preview's delta;
//   3. what was accepted is those devices: a third device joining an accepted
//      conflict, or a fourth PC with the same wrong gateway, is open again;
//   4. the stored list is allowlisted (junk dropped), loses the ids of deleted
//      devices, travels in serializeDoc (the document is v5), and Reopen takes
//      it back, as one undo step;
//   5. the report prints it under Known / accepted with the reason, the CSV
//      findings sheet in its last column, the notes lint reads the reason, and
//      a read-only network offers no Accept;
//   6. the sentences are translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const shown = (id) => !el(id).classList.contains('hidden');
  let answer = null;
  const asked = [];
  const heldResponder = setDialogResponder((req) => {
    asked.push(req);
    if (req.kind === 'prompt') return answer;
    if (req.kind === 'confirm') return true;
    return undefined;
  });

  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n1', cidr: '10.0.0.0/24', gateway: '10.0.0.1' }],
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 120, portCount: 16, interfaces: [] },
      { id: 'pa', type: 'pc', name: 'Lab A', x: -100, y: 240, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] },
      { id: 'pb', type: 'pc', name: 'Lab B', x: 0, y: 240, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] },
      { id: 'p1', type: 'pc', name: 'PC 1', x: 100, y: 240, gw: '10.9.9.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.21/24' }] },
      { id: 'p2', type: 'pc', name: 'PC 2', x: 200, y: 240, gw: '10.9.9.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.22/24' }] },
      { id: 'p3', type: 'pc', name: 'PC 3', x: 300, y: 240, gw: '10.9.9.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.23/24' }] }
    ],
    links: [
      { id: 'l0', source: 'rt', target: 'sw', sourceIface: 'e0', targetIface: 'p16' },
      { id: 'la', source: 'sw', target: 'pa', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'lb', source: 'sw', target: 'pb', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'l1', source: 'sw', target: 'p1', sourceIface: 'p3', targetIface: 'i1' },
      { id: 'l2', source: 'sw', target: 'p2', sourceIface: 'p4', targetIface: 'i1' },
      { id: 'l3', source: 'sw', target: 'p3', sourceIface: 'p5', targetIface: 'i1' }
    ] });
  const open = (doc) => {
    replaceDocument(doc || lab(), { origin: 'file' });
    initHistory();
    showConfigTab('config');
  };
  const open1 = () => topologyFindings().filter((f) => !f.accepted);
  const groupEl = (re) => [...el('conflictMsgList').querySelectorAll('.ca-group')].find((g) => re.test(g.querySelector('.ca-check').textContent));
  const acceptIn = async (re, reason) => {
    answer = reason;
    const g = groupEl(re);
    const b = g && g.querySelector('.ca-accept');
    if (!b) return false;
    b.click();
    await wait(0); await wait(0);
    return true;
  };

  try {
    // ---- 1. The tab ----
    open();
    const before = open1();
    ok('the lab raises an IP conflict and three gateway findings', before.filter((f) => f.key === 'ip-conflict').length === 1
       && before.filter((f) => f.key === 'gateway').length === 3, before.map((f) => f.key).join(','));
    ok('the findings are a tab of the rail, beside the selection tabs', el('findTabBtn').closest('.cfg-tabs') === el('configTabBtn').closest('.cfg-tabs')
       && el('cfgPanel-findings').contains(el('conflictMsgList')));
    ok('nothing floats over the map but the pill', !el('conflictAlert') && !!el('conflictPill') && !el('cfgPanel-findings').contains(el('conflictPill')));
    ok('the pill and the tab count the open findings', el('conflictPillCount').textContent === String(before.length) && el('findTabCount').textContent === String(before.length));
    el('conflictPill').click();
    ok('the pill opens the tab', shown('cfgPanel-findings') && findingsTabShown());
    ok('grouped by check, one line for the same gateway on three PCs', groupEl(/Gateway/).querySelectorAll('.ca-line').length === 1
       && /PC 1, PC 2, PC 3/.test(groupEl(/Gateway/).querySelector('.ca-line').textContent));
    ok('every line offers Accept…', [...el('conflictMsgList').querySelectorAll('.ca-item')].every((li) => li.querySelector('.ca-accept')));
    ok('nothing is accepted yet', !shown('acceptedBox') && serializeDoc().accepted === undefined);
    // Selecting a device from the tab keeps the tab open (stepping through).
    groupEl(/IP Conflict/).querySelector('.ca-line').click();
    ok('a line selects the device and the tab stays', state.selectedId === 'pa' && findingsTabShown());

    // ---- 2. Accept with reason ----
    const steps0 = _undoStack.length;
    await acceptIn(/IP Conflict/, '   ');
    ok('a blank reason accepts nothing', !acceptedList().length && _undoStack.length === steps0);
    await acceptIn(/IP Conflict/, null);
    ok('nor does Cancel', !acceptedList().length && _undoStack.length === steps0);
    const prompt = asked.filter((a) => a.kind === 'prompt').pop();
    ok('the question names the finding', !!prompt && /10\.0\.0\.10 shared by Lab A, Lab B/.test(prompt.message), prompt && prompt.message);
    await acceptIn(/IP Conflict/, 'Two lab images behind the bench NAT; never on the LAN together.');
    ok('accepted: one entry in the document', acceptedList().length === 1 && acceptedList()[0].check === 'ip-conflict'
       && acceptedList()[0].nodeIds.join(',') === 'pa,pb', JSON.stringify(acceptedList()));
    ok('as one undo step', _undoStack.length === steps0 + 1);
    const after = open1();
    ok('it no longer counts', after.length === before.length - 1 && el('conflictPillCount').textContent === String(after.length)
       && el('findTabCount').textContent === String(after.length));
    ok('it left the open list', !groupEl(/IP Conflict/));
    ok('and is listed under Accepted with its reason', shown('acceptedBox') && /Accepted: 1/.test(el('acceptedSummary').textContent)
       && /Lab A, Lab B/.test(el('acceptedList').textContent) && /bench NAT/.test(el('acceptedList').textContent));
    ok('the finding itself says so', topologyFindings().find((f) => f.key === 'ip-conflict').accepted.reason.startsWith('Two lab images'));
    ok('has:finding leaves it out', !qSeverity(getNode('pa')) && !qSeverity(getNode('pb')) && qSeverity(getNode('p1')) === 'bad');
    const scratch = cloneData({ nodes: state.nodes, links: state.links, networks: state.networks });
    ok('a preview on a scratch copy reads the document\'s accepted list', diagnoseDoc(scratch).findings.filter((f) => f.accepted).length === 1
       && findingsDelta(topologyFindings(), diagnoseDoc(scratch).findings).length === 0);
    ok('a card\'s summary counts the open ones', librarySummary(serializeDoc()).critical === after.filter((f) => f.level === 'bad').length);
    select(null, null);
    el('acceptedList').querySelector('.ca-line').click();
    ok('an accepted line still finds the device', state.selectedId === 'pa');

    // The folded gateway line: three PCs under one reason.
    await acceptIn(/Gateway/, 'Bench PCs routed by the lab firewall');
    ok('a folded line is accepted for every device it names', acceptedList()[1].check === 'gateway' && acceptedList()[1].nodeIds.join(',') === 'p1,p2,p3');
    ok('the gateway group is gone, and everything open is the rest', !groupEl(/Gateway/) && open1().every((f) => f.key !== 'gateway'));

    // ---- 3. What was accepted is those devices ----
    batch(() => {
      state.nodes.push(normalizeLoadedNode({ id: 'pc', type: 'pc', name: 'Lab C', x: 100, y: 360, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] }));
      state.nodes.push(normalizeLoadedNode({ id: 'p4', type: 'pc', name: 'PC 4', x: 200, y: 360, gw: '10.9.9.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.24/24' }] }));
      save(); renderCanvasOnly();
    });
    const now = open1();
    ok('a third device in the conflict opens it again', now.some((f) => f.key === 'ip-conflict' && f.nodeIds.length === 3));
    ok('a fourth PC with the same wrong gateway is open', now.some((f) => f.key === 'gateway' && f.nodeIds[0] === 'p4')
       && !now.some((f) => f.key === 'gateway' && f.nodeIds[0] === 'p1'));
    undo();

    // ---- 4. Stored, allowlisted, pruned, reopened ----
    const doc = serializeDoc();
    // v5 brought the list; later versions (v6: port names and labels) keep it.
    ok('the document is v5 or later and carries the list', doc.v === DOC_VERSION && DOC_VERSION >= 5 && Array.isArray(doc.accepted) && doc.accepted.length === 2);
    ok('written as check, the address, node ids and reason (no empty cable list)', JSON.stringify(doc.accepted[0]) === JSON.stringify({ check: 'ip-conflict', scope: '10.0.0.10', nodeIds: ['pa', 'pb'], reason: 'Two lab images behind the bench NAT; never on the LAN together.' }),
       JSON.stringify(doc.accepted[0]));
    ok('a v4 document is opened by the chain and reads as accepting nothing', migrateDoc({ v: 4, nodes: [], links: [] }).doc.v === DOC_VERSION
       && MIGRATIONS.some((m) => m.from === 4 && m.to === 5));
    loadDocState(JSON.parse(JSON.stringify(doc)));
    ok('it survives a reload', acceptedList().length === 2 && topologyFindings().filter((f) => f.accepted).length === 4);
    ok('junk is dropped: no reason, no ids, wrong types, unknown keys', JSON.stringify(normalizeAccepted([
      { check: 'loop', nodeIds: ['a'], reason: '' }, { check: 'loop', nodeIds: [], linkIds: [], reason: 'x' }, { check: 7, nodeIds: ['a'], reason: 'x' },
      'nope', { check: 'loop', nodeIds: ['a', 5, 'a'], linkIds: 'l1', reason: ' kept ', secret: 'leak' }
    ])) === JSON.stringify([{ check: 'loop', nodeIds: ['a'], linkIds: [], reason: 'kept' }]));
    ok('a very long reason is cut, not refused', normalizeAccepted([{ check: 'loop', nodeIds: ['a'], reason: 'x'.repeat(900) }])[0].reason.length === 300);
    open(doc);
    select('pb', 'node'); deleteSelected();
    ok('a deleted device leaves the entry it was in', JSON.stringify(serializeDoc().accepted[0].nodeIds) === '["pa"]');
    select('pa', 'node'); deleteSelected();
    ok('and an entry naming nothing left is dropped', serializeDoc().accepted.length === 1 && serializeDoc().accepted[0].check === 'gateway');
    undo(); undo();
    ok('undo brings both back', serializeDoc().accepted.length === 2);
    showConfigTab('findings');
    const steps1 = _undoStack.length;
    el('acceptedList').querySelector('.ca-reopen').click();
    ok('Reopen takes the entry back, as one undo step', acceptedList().length === 1 && acceptedList()[0].check === 'gateway' && _undoStack.length === steps1 + 1
       && !!groupEl(/IP Conflict/));
    undo();
    ok('and Undo accepts it again', acceptedList().length === 2 && !groupEl(/IP Conflict/));

    // A node's own issue: accepted, it no longer badges the device.
    open({ v: DOC_VERSION, nodes: [{ id: 'x', type: 'server', name: 'Odd', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.300/24' }] }], links: [] });
    showConfigTab('findings');
    ok('an invalid address badges the device', nodeDiagnosis(getNode('x')).severity === 'bad' && !!document.querySelector('#ui-node-x circle[r="7.5"]'));
    await acceptIn(/Interfaces/, 'Placeholder until the vendor sends the address');
    ok('accepted, the badge goes', nodeDiagnosis(getNode('x')).severity === null && !document.querySelector('#ui-node-x circle[r="7.5"]'));
    ok('while the node tab still says what the check found', nodeDiagnosis(getNode('x')).checks.some((c) => c.level === 'bad' || c.level === 'warn') || /Invalid CIDR/.test(topologyFindings()[0].detail));
    ok('with nothing open, the tab says so and the pill goes', shown('findingsEmpty') && !shown('conflictPill'));

    // ---- 5. Report, CSV, lint, read-only ----
    open(doc);
    state.report = { site: 'Banco Norte', date: '2026-10-26' };
    const model = reportModel();
    ok('the report counts only the open findings', model.counts.critical === model.findings.filter((f) => f.level === 'bad').length
       && model.accepted.length === 4 && !model.findings.some((f) => f.accepted), `${model.counts.critical} / ${model.accepted.length}`);
    const html = reportHtml(model, null);
    const known = html.split('>Known / accepted<')[1] || '';
    ok('and prints them under Known / accepted, with the reason', /bench NAT/.test(known) && /Bench PCs routed/.test(known) && /shared by Lab A, Lab B/.test(known));
    ok('with a stat for them', />4<\/b><span>Accepted</.test(html));
    ok('the findings table above it does not repeat them', !/shared by Lab A, Lab B/.test(html.split('>Known / accepted<')[0]));
    state.accepted = normalizeAccepted(doc.accepted.concat([{ check: 'mac', nodeIds: ['rt'], reason: 'r' }]));
    const allAccepted = reportHtml(withDoc({ v: DOC_VERSION, nodes: [{ id: 'q', type: 'pc', name: 'Q', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '1.2.3.300/24' }] }], links: [],
      accepted: [{ check: 'interfaces', nodeIds: ['q'], reason: 'known' }] }, () => reportModel()), null);
    ok('a report whose every finding is accepted says that, not "no faults"', /No open findings/.test(allAccepted) && !/No faults were raised/.test(allAccepted));
    open(doc);
    reopenAccepted(0);   // the conflict counts again: one open row, then the accepted
    const sheet = csvFindingsSheet();
    ok('findings.csv lists the open ones first and the reason last', sheet.rows.length === 4 && sheet.rows[0][4] === '' && /shared by/.test(sheet.rows[0][3])
       && sheet.rows.slice(1).every((r) => r[4] === 'Bench PCs routed by the lab firewall'), JSON.stringify(sheet.rows.map((r) => r[4])));
    undo();
    ok('a password in a reason is caught by the pre-share lint', docSecretHits({ nodes: [], accepted: [{ check: 'loop', nodeIds: ['a'], reason: 'password: Hunter22!' }] })
       .some((h) => h.kind === 'accepted'));
    replaceDocument(Object.assign(lab(), { v: DOC_VERSION + 1 }), { origin: 'file' });
    showConfigTab('findings');
    ok('a read-only network lists its findings but offers no Accept', !!state.readOnly && el('conflictMsgList').querySelectorAll('.ca-line').length > 0
       && !el('conflictMsgList').querySelector('.ca-accept'));
    ok('and acceptFindings refuses it', acceptFindings(topologyFindings().slice(0, 1), 'x') === false && !acceptedList().length);

    // ---- 6. In Spanish ----
    open(doc);
    showConfigTab('findings');
    setLocale('es'); applyLocale();
    reopenAccepted(1);   // one line open again, so it offers Accept…
    ok('the tab, the button and the list are in Spanish', /Hallazgos/.test(el('findTabBtn').textContent) && /Aceptar…/.test(el('conflictMsgList').textContent)
       && /Aceptados: 1/.test(el('acceptedSummary').textContent) && /Motivo:/.test(el('acceptedList').textContent) && /Reabrir/.test(el('acceptedList').textContent),
       el('findTabBtn').textContent + ' | ' + el('acceptedSummary').textContent);
    ok('and so is the report section', /Conocidos \/ aceptados/.test(reportHtml(reportModel(), null)));
    setLocale('en'); applyLocale();
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e).slice(0, 300));
  } finally {
    setDialogResponder(heldResponder);
    showConfigTab('config');
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
