// The site report's parts: the summary for the client, the technical sheet,
// or both (js/report.js "The summary for the client", reportParts). Held:
//   1. what a report holds: a caller that says nothing gets the technical
//      sheet exactly as before; both put the summary first; the summary on
//      its own has no technical pages and says so in its title; nothing at
//      all is the technical sheet, never an empty document;
//   2. the verdict: fine, needs attention, or problems to fix, from the open
//      findings only (an accepted one is not counted), each problem in plain
//      words with why it matters and the devices it is about;
//   3. what they have: the kinds counted, the devices listed with where they
//      are and the network's own columns the table shows (a hidden one not),
//      and only a note past a page's worth of devices; what changed; who
//      checked it;
//   4. the binder: a summary per site before its technical sheet, holding the
//      cover's link; a summary alone has no cover;
//   5. the dialog: both ticked whenever it opens, one always stays ticked,
//      and the binder's diagrams offered only with the technical pages;
//   6. every check that can reach the report has its plain words, and the
//      sentences are translated.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const pc = (id, name, ip, extra) => Object.assign({ id, type: 'pc', name, x: 100, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra || {});
  const clean = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }],
    nodes: [{ id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] },
            { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 100, portCount: 8, interfaces: [] },
            pc('a', 'Reception PC', '10.0.0.11/24')],
    links: [{ id: 'l0', source: 'rt', target: 'sw', sourceIface: 'i1', targetIface: 'p8' }, { id: 'l1', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1' }],
    report: { site: 'Clínica Norte', client: 'Dr. Ruiz', engineer: 'Miguel', ref: 'CS-9', date: '2026-10-31', scope: '' } });
  const conflict = () => { const d = clean(); d.nodes.push(pc('b', 'Lab PC', '10.0.0.11/24')); d.links.push({ id: 'l2', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1' }); return d; };
  const model = (doc) => { replaceDocument(doc, { origin: 'file' }); return reportModel(); };

  try {
    // ---- 1: what a report holds ----
    ok('nothing said is the technical sheet; both is both; neither is the technical sheet',
       show(reportParts()) === show({ summary: false, technical: true }) && show(reportParts({ summary: true, technical: true })) === show({ summary: true, technical: true })
       && show(reportParts({ summary: false, technical: false })) === show({ summary: false, technical: true }));
    const m = model(clean());
    const plain = reportHtml(m, null);
    ok('a caller that says nothing gets the report as it was: no summary', !plain.includes('class="sheet summary"') && plain.includes('Device inventory'));
    const both = reportHtml(m, null, { summary: true, technical: true });
    ok('both: the summary first, then the technical sheet', both.indexOf('class="sheet summary"') > -1 && both.indexOf('class="sheet summary"') < both.indexOf('Device inventory')
       && both.includes('<title>Clínica Norte — Network documentation report</title>'));
    const only = reportHtml(m, null, { summary: true, technical: false });
    ok('the summary alone: no technical pages, and its title says summary', !only.includes('Device inventory') && !only.includes('Scope and method')
       && only.includes('<title>Clínica Norte — Network summary</title>'), only.match(/<title>.*<\/title>/)[0]);

    // ---- 2: the verdict ----
    ok('no open findings: the network looks fine, and the page says it was documented, not scanned', /Your network looks fine/.test(only) && /documented on 2026-10-31\. Nothing was scanned or logged into\./.test(only)
       && /No problems were found/.test(only));
    const cm = model(conflict());
    const bad = summarySheet(cm);
    ok('a fault: problems to fix, in plain words, with why and where', /One problem needs fixing/.test(bad) && bad.includes('Two devices are set to the same address')
       && bad.includes('Only one of them can work at a time') && /Where: [^<]*Reception PC/.test(bad) && /Where: [^<]*Lab PC/.test(bad) && bad.includes('class="verdict bad"'), bad.slice(bad.indexOf('verdict'), bad.indexOf('verdict') + 600));
    ok('no device ids, check codes or jargon from the technical table', !bad.includes('ip-conflict') && !bad.includes('IP Conflict'));
    // Accepted: known, so not counted.
    const acc = conflict();
    replaceDocument(acc, { origin: 'file' });
    const f = topologyFindings().find((x) => x.key === 'ip-conflict');
    acc.accepted = [{ check: f.key, nodeIds: f.nodeIds, linkIds: f.linkIds || [], reason: 'Lab bench, swapped by hand.' }];
    ok('an accepted finding is not counted', /Your network looks fine/.test(summarySheet(model(acc))));
    const one = summaryVerdict({ critical: 0, advisory: 1 }), mixed = summaryVerdict({ critical: 2, advisory: 1 });
    ok('advisories only: needs attention; both: the problems, then the rest', one.cls === 'warn' && one.title === 'One thing needs attention'
       && mixed.cls === 'bad' && mixed.title === '2 problems need fixing' && mixed.more === 'One thing needs attention', show([one, mixed]));
    const spread = [summaryVerdict({ critical: 3 }, { kinds: 1, devices: 3 }), summaryVerdict({ critical: 4 }, { kinds: 2, devices: 4 }),
        summaryVerdict({ critical: 2 }, { kinds: 2, devices: 3 }), summaryVerdict({ critical: 2 }, { kinds: 1, devices: 1 })];
    ok('fewer kinds than problems: the kinds, on how many devices; else the problems', show(spread.map((v) => v.title)) === show([
        'One kind of problem needs fixing, on 3 devices', '2 kinds of problem need fixing, on 4 devices', '2 problems need fixing', '2 problems need fixing']), show(spread));
    ok('problems come one per check, faults first, devices named once', (() => {
      const p = summaryProblems([{ key: 'dns', level: 'warn', subject: 'A' }, { key: 'ip-conflict', level: 'bad', subject: 'B, C' }, { key: 'dns', level: 'warn', subject: 'A' }, { key: 'dns', level: 'warn', subject: 'D' }, { key: 'rack-tag', level: 'info', subject: 'R' }]);
      return p.length === 2 && p[0].key === 'ip-conflict' && show(p[1].where) === show(['A', 'D']);
    })());
    ok('a long list of devices is cut, saying how many more', (() => {
      const many = Array.from({ length: 9 }, (_, i) => ({ key: 'dns', level: 'warn', subject: `PC-${i}` }));
      const html = summarySheet({ meta: {}, devices: [], findings: many });
      return /PC-5 …and 3 more\./.test(html) && !html.includes('PC-6');
    })());

    // ---- 3: what they have ----
    const own = clean();
    own.columns = [{ id: 'c1', name: 'Owner' }, { id: 'c2', name: 'Secret' }];
    own.tableView = { devices: { hidden: ['x:c2'] } };
    own.nodes[2].extra = { c1: 'Ana', c2: 'hidden value' };
    own.nodes[2].location = 'Front desk';
    const om = summarySheet(model(own));
    ok('the kinds are counted', /<b>1<\/b><span>Workstation<\/span>/.test(om) && /<b>1<\/b><span>Router<\/span>/.test(om));
    ok('the devices are listed with where they are and the columns the table shows', om.includes('<th>Owner</th>') && om.includes('<td>Ana</td>') && om.includes('Front desk')
       && !om.includes('Secret') && !om.includes('hidden value'));
    ok('who checked it is named', /Checked by Miguel\. Questions about this summary go to them\./.test(om));
    const big = { meta: {}, findings: [], devices: Array.from({ length: SUMMARY_LIST_MAX + 1 }, (_, i) => ({ name: `D${i}`, typeName: 'Workstation', custom: [] })) };
    ok('past a page of devices only the kinds, and where the list is', !summarySheet(big).includes('summary-list') && summarySheet(big).includes('The full list of devices is in the technical report.'));
    const withChanges = Object.assign({}, m, { changes: { at: Date.now(), kind: 'backup', total: 1, rows: [{ op: 'Added', what: 'Device', name: 'New printer', detail: 'Printer' }] } });
    ok('what changed since the last visit, in a line each', /What changed since the last visit/.test(summarySheet(withChanges)) && /Added · Device <b>New printer<\/b>/.test(summarySheet(withChanges)));

    // ---- 4: the binder ----
    const entries = [{ id: 'sA', name: 'Casa A', doc: clean() }, { id: 'sB', name: 'Casa B', doc: conflict() }];
    const binder = binderModel(entries, { site: 'Grupo Ruiz', client: 'Dr. Ruiz', engineer: 'Miguel', ref: '', date: '2026-10-31', scope: '' });
    const bBoth = binderHtml(binder, {}, { summary: true, technical: true });
    const sumA = bBoth.indexOf('<h1>Casa A</h1>\n    <p class="sub">Network summary');
    ok('binder, both: the cover, then each site\'s summary before its technical sheet', bBoth.includes('Estate documentation report') && sumA > -1
       && sumA < bBoth.indexOf('<h1>Casa B</h1>\n    <p class="sub">Network summary'), String(sumA));
    ok('the cover\'s link lands on the site\'s summary, and on one sheet only', (bBoth.match(new RegExp(`id="${binder.sites[0].anchor}"`, 'g')) || []).length === 1
       && bBoth.indexOf(`id="${binder.sites[0].anchor}"`) < bBoth.indexOf('Device inventory'));
    const bSum = binderHtml(binder, {}, { summary: true, technical: false });
    ok('binder, summary alone: a page per site and no cover', !bSum.includes('Estate documentation report') && !bSum.includes('Device inventory')
       && (bSum.match(/class="sheet summary"/g) || []).length === 2 && /One problem needs fixing/.test(bSum));
    ok('binder, technical alone: as before', !binderHtml(binder, {}).includes('class="sheet summary"'));

    // ---- 5: the dialog ----
    replaceDocument(clean(), { origin: 'file' });
    openReportDialog();
    ok('both are ticked when the dialog opens', el('reportSummary').checked && el('reportTechnical').checked && show(readReportParts()) === show({ summary: true, technical: true }));
    el('reportSummary').checked = false; el('reportSummary').dispatchEvent(new Event('change'));
    ok('one can be unticked', show(readReportParts()) === show({ summary: false, technical: true }));
    el('reportTechnical').checked = false; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('unticking the last one ticks the other', el('reportSummary').checked && !el('reportTechnical').checked);
    closeReportDialog();
    openReportDialog();
    ok('and the next time it opens, both again', el('reportSummary').checked && el('reportTechnical').checked);
    closeReportDialog();
    _reportMode = 'binder';
    renderReportDialog();
    el('reportTechnical').checked = false; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('a binder summary has no diagrams to offer', el('reportImagesRow').classList.contains('hidden'));
    el('reportTechnical').checked = true; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('and they come back with the technical pages', !el('reportImagesRow').classList.contains('hidden'));
    _reportMode = 'site';
    closeReportDialog();

    // ---- 6: words ----
    const reachable = Object.keys(FINDING_CHECK_NAMES).concat(NODE_CHECKS.map((c) => c.key)).filter((k) => !['rack-tag', 'wifi-plan', 'service-due'].includes(k));
    const missing = reachable.filter((k) => !PLAIN_FINDINGS[k]);
    ok('every check the report prints has its plain words (the info notes are not printed)', missing.length === 0, missing.join(','));
    const { MESSAGES } = window.CarinoI18N;
    const untranslated = Object.values(PLAIN_FINDINGS).flat().filter((k) => !['es', 'pt-BR', 'ru', 'ja'].every((l) => MESSAGES[l][k]));
    ok('and every plain sentence is translated', untranslated.length === 0, untranslated[0]);
    setLocale('es'); applyLocale();
    const es = summarySheet(cm);
    ok('the summary reads in the page\'s language', /Hay un problema que corregir/.test(es) && es.includes('Dos dispositivos tienen la misma dirección') && es.includes('Corregir ya'));
    ok('the dialog too', el('reportSummary').nextElementSibling.textContent.startsWith('Resumen para el cliente'));
    setLocale('en'); applyLocale();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
