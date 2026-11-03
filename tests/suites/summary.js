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
window.addEventListener('load', () => { setTimeout(async () => {
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
       show(reportParts()) === show({ summary: false, technical: true, largeMap: false, largeCols: 2, largeRows: 2, largeSkip: [] }) && show(reportParts({ summary: true, technical: true })) === show({ summary: true, technical: true, largeMap: false, largeCols: 2, largeRows: 2, largeSkip: [] })
       && show(reportParts({ summary: false, technical: false })) === show({ summary: false, technical: true, largeMap: false, largeCols: 2, largeRows: 2, largeSkip: [] }));
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
    ok('both are ticked when the dialog opens', el('reportSummary').checked && el('reportTechnical').checked && show(readReportParts()) === show({ summary: true, technical: true, largeMap: false, largeCols: 2, largeRows: 2, largeSkip: [] }));
    el('reportSummary').checked = false; el('reportSummary').dispatchEvent(new Event('change'));
    ok('one can be unticked', show(readReportParts()) === show({ summary: false, technical: true, largeMap: false, largeCols: 2, largeRows: 2, largeSkip: [] }));
    el('reportTechnical').checked = false; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('unticking the last one ticks the other', el('reportSummary').checked && !el('reportTechnical').checked);
    closeReportDialog();
    openReportDialog();
    ok('and the next time it opens, both again', el('reportSummary').checked && el('reportTechnical').checked);
    closeReportDialog();
    _reportMode = 'binder';
    renderReportDialog();
    el('reportTechnical').checked = false; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('a binder summary offers the diagrams too: it shows each site\'s map', !el('reportImagesRow').classList.contains('hidden'));
    el('reportTechnical').checked = true; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('and so do the technical pages', !el('reportImagesRow').classList.contains('hidden'));
    _reportMode = 'site';
    closeReportDialog();

    // ---- 5b: the large map ----
    openReportDialog();
    ok('Large map is offered, off, with the technical pages', !el('reportLargeMap').checked && !el('reportLargeMapRow').classList.contains('hidden'));
    el('reportLargeMap').checked = true;
    ok('ticked, the parts say so', readReportParts().largeMap === true);
    el('reportTechnical').checked = false; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('a summary alone has no diagram, so no large map', el('reportLargeMapRow').classList.contains('hidden'));
    closeReportDialog();
    openReportDialog();
    ok('and it is off again the next time', !el('reportLargeMap').checked);
    closeReportDialog();
    // A small network: its diagram is inline, and the large map adds the
    // overview and its sheets at the end, under an image id of their own.
    const lm = model(clean());
    const pic = { url: 'data:image/png;base64,AA==', width: 4 * 900, height: 4 * 700, scale: 4, minX: 0, minY: 0, points: [[100, 100], [800, 600], [450, 350]] };
    const without = reportHtml(lm, pic, { technical: true });
    const withLarge = reportHtml(lm, pic, { technical: true, largeMap: true });
    const pages = (h) => (h.match(/class="sheet land"/g) || []).length;
    const bigMap = reportDiagramLayout(pic, 3, { large: true });   // 2 × 2 unless picked
    ok('the small diagram stays in the text', /<div class="figure">/.test(withLarge) && pages(without) === 0);
    ok('the large map is the 2 × 2 grid when nothing else is picked', bigMap && bigMap.kind === 'tiles' && bigMap.tiles.length === 4, bigMap && JSON.stringify({ n: bigMap.tiles.length }));
    ok('it adds the overview and one sheet per square', pages(withLarge) === bigMap.tiles.length + 1, `${pages(withLarge)} vs ${bigMap.tiles.length + 1}`);
    ok('the overview names the squares, the sheets say which one they are', /Overview: each square is one of the/.test(withLarge) && /Sheet A1 · 1 of/.test(withLarge));
    ok('the text says it is there', /A large map is at the end/.test(withLarge));
    ok('the picture is carried once, not once per sheet', (withLarge.match(/<image id="topo-dg"/g) || []).length === 1);
    ok('without it, nothing changes', !/A large map/.test(without));
    // The grid is picked (Sheets across, Sheets down), 2 × 2 unless changed.
    ok('the parts carry the grid, 2 × 2 by default, clamped', reportParts({ technical: true }).largeCols === 2 && reportParts({ technical: true }).largeRows === 2
       && reportParts({ technical: true, largeCols: 99, largeRows: 0 }).largeCols === REPORT_DIAGRAM_GRID_MAX && reportParts({ largeRows: 0 }).largeRows === 2);
    const g32 = reportDiagramLayout(pic, 3, { large: true, cols: 3, rows: 2 });
    const g32Html = reportHtml(lm, pic, { technical: true, largeMap: true, largeCols: 3, largeRows: 2 });
    ok('3 × 2 is six sheets, every one printed', g32.tiles.length === 6 && pages(g32Html) === 6 + 1, String(pages(g32Html)));
    openReportDialog();
    ok('the grid pickers show only with Large map ticked, at 2 × 2', el('reportLargeSheetsRow').classList.contains('hidden')
       && el('reportLargeCols').value === '2' && el('reportLargeRows').value === '2');
    el('reportLargeMap').checked = true; el('reportLargeMap').dispatchEvent(new Event('change'));
    ok('ticked, they show, with the total', !el('reportLargeSheetsRow').classList.contains('hidden') && el('reportLargeTotal').textContent === '= 4 sheets', el('reportLargeTotal').textContent);
    el('reportLargeCols').value = '3'; el('reportLargeCols').dispatchEvent(new Event('change'));
    ok('and the parts read them', readReportParts().largeCols === 3 && readReportParts().largeRows === 2 && el('reportLargeTotal').textContent === '= 6 sheets');
    // A square per sheet, to leave it out; the last one stays.
    ok('a toggle per sheet, all on', el('reportLargeCells').querySelectorAll('.dlg-cell').length === 6
       && [...el('reportLargeCells').querySelectorAll('.dlg-cell')].every((b) => b.getAttribute('aria-pressed') === 'true'));
    el('reportLargeCells').querySelector('[data-cell="B1"]').click();
    ok('one clicked is left out', readReportParts().largeSkip.join() === 'B1' && el('reportLargeTotal').textContent === '= 5 of 6 sheets'
       && el('reportLargeCells').querySelector('[data-cell="B1"]').getAttribute('aria-pressed') === 'false', el('reportLargeTotal').textContent);
    el('reportLargeCells').querySelector('[data-cell="B1"]').click();
    ok('clicked again, it is back', readReportParts().largeSkip.length === 0);
    el('reportLargeCols').value = '1'; el('reportLargeCols').dispatchEvent(new Event('change'));
    el('reportLargeCells').querySelector('[data-cell="A1"]').click();
    ok('the last one printed cannot be left out', readReportParts().largeSkip.length === 1 && !toggleLargeSheet('A2') && readReportParts().largeSkip.length === 1);
    el('reportLargeCols').value = '3'; el('reportLargeCols').dispatchEvent(new Event('change'));
    ok('kept while the grid grows', readReportParts().largeSkip.join() === 'A1');
    el('reportTechnical').checked = false; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('without the technical pages they go with Large map', el('reportLargeSheetsRow').classList.contains('hidden'));
    closeReportDialog();
    openReportDialog();
    ok('and they are 2 × 2 again the next time, every sheet on', el('reportLargeCols').value === '2' && readReportParts().largeSkip.length === 0);
    closeReportDialog();
    const sumOnly = reportHtml(lm, pic, { summary: true, technical: false, largeMap: true });
    ok('a summary alone has no large map even when asked', !sumOnly.includes('class="dg-cell"'));
    ok('but it has the map, on one whole page after its own, no sheet marks', (sumOnly.match(/class="sheet land"/g) || []).length === 1
       && sumOnly.indexOf('class="sheet summary"') < sumOnly.indexOf('class="sheet land"') && !/Sheet A1/.test(sumOnly) && /The map of the network is on the next page/.test(sumOnly));
    const bothParts = reportHtml(lm, pic, { summary: true, technical: true });
    ok('with the technical pages too, the picture is carried once', (bothParts.match(/<image id="topo-dg"/g) || []).length === 1);
    ok('without a picture the summary has no map page', !/sheet land/.test(reportHtml(lm, null, { summary: true, technical: false })));

    // ---- 5c: the preview, in the dialog ----
    const realDeliver = window.deliverReport;
    const handed = [];
    window.deliverReport = (html, meta, kind, onKept) => { handed.push({ html, meta, kind }); return { opened: false }; };
    try {
      replaceDocument(clean(), { origin: 'file' });
      openReportDialog();
      let b = await refreshReportPreview();
      ok('the dialog shows the report beside its questions', !!b && /^blob:/.test(el('reportPreviewFrame').getAttribute('src') || '')
         && el('reportDialog').contains(el('reportPreviewFrame')) && /Network documentation report/.test(b.html));
      ok('named as the file it downloads as', /-report-\d{4}-\d{2}-\d{2}\.html$/.test(el('reportPreviewName').textContent), el('reportPreviewName').textContent);
      ok('with its own toolbar hidden (the dialog prints)', getComputedStyle(el('reportPreviewFrame').contentDocument.querySelector('.toolbar')).display === 'none');
      ok('looking hands nothing over', !handed.length);
      el('report-site').value = 'Torre B'; el('report-site').dispatchEvent(new Event('input', { bubbles: true }));
      b = await refreshReportPreview();
      ok('an edit redraws it with what was typed', /Torre B/.test(b.html));
      ok('without storing the header yet', state.report.site !== 'Torre B');
      el('reportSummary').checked = false; el('reportSummary').dispatchEvent(new Event('change'));
      b = await refreshReportPreview();
      ok('and a tick changes what it shows', !/class="sheet summary"/.test(b.html) && b.kind === 'report');
      // A change to the large map's grid shows the preview at the overview,
      // and any other redraw keeps the place the preview was scrolled to.
      {
        const fw = () => el('reportPreviewFrame').contentWindow, fd = () => el('reportPreviewFrame').contentDocument;
        const ovTop = () => { const g = fd().querySelector('.dg-cell[data-cell]'); return g ? g.closest('.sheet').getBoundingClientRect().top : NaN; };
        const atOverview = () => { const max = fd().documentElement.scrollHeight - fw().innerHeight; return Math.abs(ovTop() - 12) < 3 || (fw().scrollY >= max - 1 && ovTop() > 0); };
        el('reportLargeMap').checked = true; el('reportLargeMap').dispatchEvent(new Event('change'));
        await refreshReportPreview();
        ok('ticking Large map shows the preview at its overview', fw().scrollY > 0 && atOverview(), JSON.stringify({ y: fw().scrollY, top: ovTop(), ih: fw().innerHeight }));
        fw().scrollTo(0, 0);
        el('reportLargeCols').value = '3'; el('reportLargeCols').dispatchEvent(new Event('change'));
        await refreshReportPreview();
        ok('and so does a new grid size', atOverview(), String(ovTop()));
        fw().scrollTo(0, 0);
        toggleLargeSheet('B1');
        await refreshReportPreview();
        ok('and a square left out', atOverview() && fd().querySelector('.dg-cell.off[data-cell="B1"]'), String(ovTop()));
        fw().scrollTo(0, 40);
        el('report-site').value = 'Torre B '; el('report-site').dispatchEvent(new Event('input', { bubbles: true }));
        await refreshReportPreview();
        ok('another edit keeps the preview where it was', fw().scrollY === 40, String(fw().scrollY));
        el('report-site').value = 'Torre B'; el('report-site').dispatchEvent(new Event('input', { bubbles: true }));
        el('reportLargeMap').checked = false; el('reportLargeMap').dispatchEvent(new Event('change'));
        await refreshReportPreview();
      }
      const frame = el('reportPreviewFrame');
      let printed = 0;
      const stub = () => { try { frame.contentWindow.print = () => { printed++; }; } catch (e) { /* not reachable */ } };
      frame.addEventListener('load', stub);
      await printReportFromDialog();
      frame.removeEventListener('load', stub);
      ok('Print prints the preview, the dialog staying', printed === 1 && !el('reportDialog').classList.contains('hidden'), String(printed));
      ok('and stores the header', state.report.site === 'Torre B');
      el('reportBuildBtn').click();
      for (let i = 0; i < 100 && !handed.length; i++) await new Promise((r) => setTimeout(r, 10));
      ok('Download hands over the report as shown', handed.length === 1 && /Torre B/.test(handed[0].html) && handed[0].kind === 'report');
      ok('and closes the dialog, preview and all', el('reportDialog').classList.contains('hidden') && !el('reportPreviewFrame').getAttribute('src') && !reportPreviewBuilt());
      openReportDialog();
      closeReportDialog();
      ok('Close keeps nothing', handed.length === 1 && !reportPreviewBuilt());
    } finally { window.deliverReport = realDeliver; closeReportDialog(); }

    // ---- 6: words ----
    const reachable = Object.keys(FINDING_CHECK_NAMES).concat(NODE_CHECKS.map((c) => c.key)).filter((k) => !['rack-tag', 'wifi-plan', 'service-due', 'provider'].includes(k));
    const missing = reachable.filter((k) => !PLAIN_FINDINGS[k]);
    ok('every check the report prints has its plain words (the info notes are not printed)', missing.length === 0, missing.join(','));
    const { MESSAGES } = window.CarinoI18N;
    const untranslated = Object.values(PLAIN_FINDINGS).flat().filter((k) => !['es', 'pt-BR', 'ru', 'ja'].every((l) => MESSAGES[l][k]));
    ok('and every plain sentence is translated', untranslated.length === 0, untranslated[0]);
    setLocale('es'); applyLocale();
    const es = summarySheet(cm);
    ok('the summary reads in the page\'s language', /Hay un problema que corregir/.test(es) && es.includes('Dos dispositivos tienen la misma dirección') && es.includes('Corregir ya'));
    ok('the dialog too', el('reportSummary').nextElementSibling.textContent.startsWith('Resumen sencillo'));
    setLocale('en'); applyLocale();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
