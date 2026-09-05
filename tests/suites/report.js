// The site report is the deliverable, so what it says has to be true and its
// structure has to be stable. Two things are asserted here that no screenshot
// would catch: that splitting topologyFindings() out of validateTopology() did
// not change one word the alert panel shows, and that a device named with angle
// brackets cannot inject markup into a document handed to a customer.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  // ---- The findings split ----
  loadTemplateState(templatesData.errors); autoBindLinks(); renderCanvasOnly();

  const panel = [...document.querySelectorAll('#conflictMsgList li')].map((li) => li.textContent);
  const findings = topologyFindings();

  ok('every alert line comes from a finding', findings.length === panel.length,
     `findings=${findings.length} alerts=${panel.length}`);
  ok('and reads exactly as the panel renders it',
     findings.every((f, i) => f.line === panel[i]),
     findings.find((f, i) => f.line !== panel[i])?.line?.slice(0, 60));
  ok('each one names a device, a check and a severity',
     findings.every((f) => f.subject && f.check && ['bad', 'warn'].includes(f.level)),
     findings.find((f) => !f.subject || !f.check)?.line?.slice(0, 60));
  // The detail is what the report's Finding column prints on its own, so it has
  // to stand up without the "<device>: " prefix the panel puts in front of it.
  ok('the detail stands alone, without the panel prefix',
     findings.every((f) => f.detail && !f.detail.startsWith(f.subject + ':')),
     findings.find((f) => f.detail.startsWith(f.subject + ':'))?.detail?.slice(0, 60));

  // Details are written to follow the panel's "L2 loop: " prefix, so the report
  // has to fix the capitalisation the prefix used to supply.
  const loop = findings.find((f) => f.check === 'L2 loop');
  ok('the L2 loop detail is the one that needs sentence case', loop && /^[a-z]/.test(loop.detail),
     loop && loop.detail.slice(0, 40));

  // ---- The model ----
  const model = reportModel();

  ok('the counts add up to the findings',
     model.counts.critical + model.counts.advisory === model.findings.length,
     `${model.counts.critical}+${model.counts.advisory} vs ${model.findings.length}`);
  ok('the broken template reports something critical', model.counts.critical > 0, String(model.counts.critical));
  ok('every device on the canvas reaches the inventory',
     model.counts.devices === state.nodes.length, `${model.counts.devices} vs ${state.nodes.length}`);
  ok('every link reaches the connections table',
     model.counts.connections === state.links.length, `${model.counts.connections} vs ${state.links.length}`);

  // The addressing table is the one nobody has written down, so it must agree
  // with the addresses actually on the diagram rather than with itself.
  const netsOnCanvas = new Set();
  state.nodes.forEach((n) => getValidIps(n).forEach((p) => netsOnCanvas.add(p.networkStr)));
  ok('the addressing table lists every subnet in use',
     model.subnets.length === netsOnCanvas.size, `${model.subnets.length} vs ${netsOnCanvas.size}`);
  const dup = model.subnets.find((s) => s.devices.length !== new Set(s.devices).size);
  ok('no subnet lists the same device twice', !dup, dup && dup.network);

  // ---- Severity ordering ----
  // The errors template raises nothing but critical findings, so it cannot show
  // the sort doing any work. This pair does: the advisory belongs to the FIRST
  // node, so check order alone would print it above the critical one, and a
  // reader skimming the top of the table would see the wrong problem first.
  state.nodes = [
    { id: 'a', type: 'server', name: 'Alpha', x: 0, y: 0, interfaces: [
        { id: 'i1', name: 'eno1', ip: '' },
        { id: 'b1', name: 'bond0', ip: '10.0.0.9/24', bond: { mode: 'active-backup', members: ['i1'] } } ] },
    { id: 'b', type: 'server', name: 'Bravo', x: 100, y: 0, interfaces: [{ id: 'i2', name: 'eno1', ip: '10.0.0.500/24' }] }
  ].map(normalizeLoadedNode);
  state.links = [];

  const natural = topologyFindings().map((f) => f.level);
  ok('the checks really do raise the advisory first', natural.join(',') === 'warn,bad', natural.join(','));
  const sorted = reportModel().findings;
  ok('the report puts the critical finding above it',
     sorted.map((f) => f.level).join(',') === 'bad,warn', sorted.map((f) => f.level).join(','));
  ok('and it is the right one', sorted[0].subject === 'Bravo' && sorted[1].subject === 'Alpha',
     sorted.map((f) => f.subject).join(','));

  // A clean network must not manufacture problems to justify the report.
  loadTemplateState(templatesData.house); autoBindLinks(); renderCanvasOnly();
  const clean = reportModel();
  ok('a clean network reports no findings', clean.findings.length === 0,
     clean.findings.map((f) => f.line).join(' | ').slice(0, 90));
  ok('and still produces a full inventory', clean.counts.devices === state.nodes.length && clean.counts.devices > 0,
     String(clean.counts.devices));

  // ---- The document ----
  state.report = { site: 'Hospital San José', client: 'Grupo Médico', engineer: 'M. Carino', ref: 'CS-2026-014', date: '2026-09-05', scope: 'Torre B only.' };
  const html = reportHtml(reportModel(), null);

  ok('the header carries the site', html.includes('Hospital San José'));
  ok('and the reference', html.includes('CS-2026-014'));
  ok('and the scope note', html.includes('Torre B only.'));
  ok('the document is standalone HTML', /^<!DOCTYPE html>/.test(html) && html.includes('<style>'));
  ok('it pulls in nothing over the network',
     !/<(script|link)\b|src="http|href="http/i.test(html.replace(/onclick="window\.print\(\)"/g, '')),
     (html.match(/<(script|link)\b[^>]*>/i) || [])[0]);
  ok('it declares a print size', html.includes('@page'));
  ok('the scope-and-method paragraph is never omitted', /no device was scanned/i.test(html));

  loadTemplateState(templatesData.errors); autoBindLinks();
  const withFaults = reportHtml(reportModel(), null);
  ok('and no finding is printed starting mid-sentence',
     !/<td>[a-z]/.test(withFaults), (withFaults.match(/<td>[a-z][^<]{0,40}/) || [])[0]);

  // Every field below is customer-supplied and lands in a document that gets
  // emailed onward. One unescaped name is a scripted attachment.
  state.report = { site: '<img src=x onerror=alert(1)>', client: '', engineer: '', ref: '', date: '2026-09-05', scope: '' };
  state.nodes[0].name = '<script>alert(2)</script>';
  const nasty = reportHtml(reportModel(), null);
  ok('a hostile site name is escaped', !nasty.includes('<img src=x'), 'raw <img> survived');
  ok('a hostile device name is escaped', !nasty.includes('<script>alert(2)'), 'raw <script> survived');
  ok('the escaped text is still readable', nasty.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));

  // ---- Round-trip ----
  // The header rides the document, so a shared link has to carry it — and a
  // diagram that never used the feature has to serialize as if it did not exist.
  state.report = { site: 'Clínica Norte', client: '', engineer: '', ref: '', date: '', scope: '' };
  ok('only the fields that were filled in are stored',
     JSON.stringify(serializeReportMeta(state.report)) === '{"site":"Clínica Norte"}',
     JSON.stringify(serializeReportMeta(state.report)));
  const doc = serializeDoc();
  ok('the header serializes with the document', doc.report && doc.report.site === 'Clínica Norte');
  loadTemplateState(doc);
  ok('and survives a reload', state.report && state.report.site === 'Clínica Norte',
     JSON.stringify(state.report));

  state.report = null;
  ok('an untouched diagram carries no report key', serializeDoc().report === undefined,
     JSON.stringify(serializeDoc().report));
  state.report = { site: '', client: '', engineer: '', ref: '', date: '', scope: '' };
  ok('and neither does an emptied one', serializeDoc().report === undefined,
     JSON.stringify(serializeDoc().report));

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
