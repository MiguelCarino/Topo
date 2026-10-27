// The site report is the deliverable, so what it says has to be true and its
// structure has to be stable. Two things are asserted here that no screenshot
// would catch: that splitting topologyFindings() out of validateTopology() did
// not change one word the alert panel shows, and that a device named with angle
// brackets cannot inject markup into a document handed to a customer.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  // ---- The findings split ----
  loadDocState(templatesData.errors); autoBindLinks(); renderCanvasOnly();

  const panel = [...document.querySelectorAll('#conflictMsgList .ca-line')].map((li) => li.textContent);
  const findings = topologyFindings();

  // The panel groups by check and folds identical wording into one line, so
  // it is compared with the grouping of the findings, not line for line. On
  // this template every finding is its own line.
  const expected = groupFindings(findings).flatMap((g) => g.items.map(findingItemText));
  ok('every alert line comes from a finding', findings.length === panel.length && expected.length === panel.length,
     `findings=${findings.length} alerts=${panel.length}`);
  ok('and reads exactly as the panel renders it',
     expected.every((line, i) => line === panel[i])
       && findings.every((f) => panel.some((l) => l.toLowerCase().endsWith(f.detail.toLowerCase()))),
     expected.find((line, i) => line !== panel[i])?.slice(0, 60));
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
  loadDocState(templatesData.house); autoBindLinks(); renderCanvasOnly();
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

  loadDocState(templatesData.errors); autoBindLinks();
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
  loadDocState(doc);
  ok('and survives a reload', state.report && state.report.site === 'Clínica Norte',
     JSON.stringify(state.report));

  state.report = null;
  ok('an untouched diagram carries no report key', serializeDoc().report === undefined,
     JSON.stringify(serializeDoc().report));
  state.report = { site: '', client: '', engineer: '', ref: '', date: '', scope: '' };
  ok('and neither does an emptied one', serializeDoc().report === undefined,
     JSON.stringify(serializeDoc().report));

  // ---- The split did not change the single-site document ----
  // reportHtml() was cut into reportDocument() + reportSheet() so the estate
  // report can put many sheets in one file. Every other assertion in this suite
  // is now regression cover for a refactor it was not written for; these are
  // the ones that watch the seam itself. A single-site report must still be
  // exactly one sheet, with nothing in it that only makes sense once there are
  // several.
  loadDocState(templatesData.errors); autoBindLinks();
  const oneSite = reportHtml(reportModel(), null);
  const count = (hay, needle) => hay.split(needle).length - 1;
  ok('a single-site report is still one sheet', count(oneSite, 'class="sheet"') === 1,
     String(count(oneSite, 'class="sheet"')));
  ok('with one title and one print button',
     count(oneSite, '<h1>') === 1 && count(oneSite, 'class="toolbar"') === 1);
  ok('and no sheet anchor, which only an index needs', !oneSite.includes('<div class="sheet" id='));
  ok('the page-break rule ships but cannot match a lone sheet',
     oneSite.includes('.sheet + .sheet') && count(oneSite, 'class="sheet"') === 1);

  // ---- The header has to travel with the document, not with the tab ----
  // It rides inside serializeDoc(), so every restore path has to put it back —
  // and two of them did not. load()'s document branch never assigned it at all,
  // which is worse than dropping it: opening a shared link in a tab where a
  // report had been filled in left the PREVIOUS client's name on someone else's
  // network, and the next keystroke saved it there.
  loadDocState(templatesData.hospital); autoBindLinks();
  state.report = { site: 'Torre A', client: 'Hospital San José', engineer: '', ref: '', date: '', scope: '' };
  save();
  const withHeader = '#' + encodeDoc(serializeDoc());
  await load();                  // the reload path: the document from history.state
  ok('a reload brings the survey header back',
     state.report && state.report.client === 'Hospital San José', JSON.stringify(state.report));
  window.history.replaceState(null, '', withHeader);
  await load();
  ok('a shared link brings its own survey header back',
     state.report && state.report.client === 'Hospital San José', JSON.stringify(state.report));

  // A document with no header must CLEAR the one on screen, not inherit it.
  state.report = { site: 'Somebody else', client: 'Another client', engineer: '', ref: '', date: '', scope: '' };
  window.history.replaceState(null, '', '#' + encodeDoc({ nodes: templatesData.house.nodes, links: templatesData.house.links }));
  await load();
  ok('and a document without one does not inherit the last one', state.report === null,
     JSON.stringify(state.report));

  // Undo restores a document, so it has to restore the whole document. Undoing
  // to a step whose header merely MATCHES the current one proves nothing — the
  // two snapshots have to disagree about it, or applyDoc() can ignore the field
  // entirely and still look correct.
  window.history.replaceState(null, '', withHeader);
  await load(); initHistory();
  state.report = { site: 'Torre A', client: 'Clínica Norte', engineer: '', ref: '', date: '', scope: '' };
  save();
  ok('the header is part of what a step records', state.report.client === 'Clínica Norte');
  undo();
  ok('undo restores the header the step had, not the one on screen',
     state.report && state.report.client === 'Hospital San José', JSON.stringify(state.report));
  redo();
  ok('and redo puts the newer one back',
     state.report && state.report.client === 'Clínica Norte', JSON.stringify(state.report));

  // Reading a stored document must not leave its header behind on the canvas.
  state.report = { site: 'On screen', client: '', engineer: '', ref: '', date: '', scope: '' };
  const seen = withDoc({ nodes: [], links: [], report: { site: 'In the drawer' } }, () => state.report && state.report.site);
  ok('withDoc lends the stored header to whatever is reading it', seen === 'In the drawer', String(seen));
  ok('and hands the canvas its own back afterwards',
     state.report && state.report.site === 'On screen', JSON.stringify(state.report));
  state.report = null;

  // ---- The date is the reader's date ----
  // toISOString() is UTC, so from late afternoon on in Mexico the report (and
  // its filename) said tomorrow. Simulated with a clock whose UTC day is ahead
  // of its local day, which is what UTC-6 at 23:30 looks like.
  const RealDate = window.Date;
  window.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(2026, 9, 24, 23, 30); }
    toISOString() { return '2026-10-25T05:30:00.000Z'; }
  };
  let stamped;
  try { stamped = todayISO(); } finally { window.Date = RealDate; }
  ok('the report date is the local calendar day, not UTC', stamped === '2026-10-24', stamped);
  ok('and a fresh header defaults to it', normalizeReportMeta({}).date === todayISO(), normalizeReportMeta({}).date);

  // ---- A stored header with non-string fields cannot sink the estate report ----
  let estateHtml = '', estateErr = '';
  try {
    estateHtml = binderHtml(binderModel([{ id: 'odd', name: 'Odd site', created: 1, updated: 1,
      doc: { nodes: [], links: [], report: { site: 5, client: { x: 1 }, engineer: ['a'], ref: null, date: 7, scope: 9 } } }],
      { site: 'Estate' }), {});
  } catch (e) { estateErr = String(e); }
  ok('a binder doc whose header holds numbers and objects still renders', !estateErr && /Odd site/.test(estateHtml), estateErr);

  // ---- IP conflicts are between devices ----
  state.nodes = [
    { id: 'c1', type: 'cloud', name: 'ISP A', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'wan0', ip: '8.8.8.8/32' }] },
    { id: 'c2', type: 'cloud', name: 'ISP B', x: 100, y: 0, interfaces: [{ id: 'i1', name: 'wan0', ip: '8.8.8.8/32' }] },
    { id: 'm', type: 'server', name: 'Multi', x: 0, y: 100, interfaces: [
      { id: 'i1', name: 'eth0', ip: '10.9.0.5/24' }, { id: 'i2', name: 'eth1', ip: '10.9.0.5/24' }] }
  ].map(normalizeLoadedNode);
  state.links = [];
  const conflicts = () => topologyFindings().filter((f) => f.check === t('IP Conflict'));
  ok('two clouds on the default 8.8.8.8 are not an IP conflict', !conflicts().some((f) => /8\.8\.8\.8/.test(f.detail)),
     conflicts().map((f) => f.detail).join(' | '));
  ok('one device holding an address twice does not conflict with itself', !conflicts().some((f) => /Multi, Multi/.test(f.detail)),
     conflicts().map((f) => f.detail).join(' | '));
  state.nodes.push(normalizeLoadedNode({ id: 'pc', type: 'pc', name: 'Misconfigured PC', x: 0, y: 200,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '8.8.8.8/24' }] }));
  ok('but a device of this site on a cloud\'s address still is',
     conflicts().some((f) => /8\.8\.8\.8/.test(f.detail) && /Misconfigured PC/.test(f.detail)),
     conflicts().map((f) => f.detail).join(' | '));
  state.nodes.push(normalizeLoadedNode({ id: 'pc2', type: 'pc', name: 'Twin', x: 0, y: 300,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.5/24' }] }));
  ok('and two devices sharing one still are, each named once',
     conflicts().some((f) => f.detail.indexOf('Multi, Twin') > -1), conflicts().map((f) => f.detail).join(' | '));
  state.nodes = []; state.links = [];

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
