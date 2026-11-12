// @realtime — the preview's frame, the diagram and the PDF run on the real clock.
// A provider's report, "Your part of this network" (js/providerreport.js,
// docs/SCOPE.md D96):
//   1. the model on a hand-made network: their devices in full (the group
//      override brings a deep member a nearer provider of the same service
//      covers; a VM through its host), how they answer for each (named on
//      it, through its host, through the group); the linked devices marked
//      hop 1, hop 2, the host and where the problem is, with the ports
//      facing theirs and their addresses; the cables, theirs first; this
//      problem; their other open problems; their own visits only;
//   2. the sheet: the title per audience, the header (site, client, the
//      client's contact, the provider's own record), every section, the
//      serial, MAC, VLANs of their devices; never a linked device's serial
//      or notes, another provider's name, visit or notes, the client's
//      notes about them, a finding; .dev-block blocks; no table;
//   3. the preview: openProviderReport shows it in the sheet preview on A4,
//      the file topo_<org>_<site>_<date>_<provider>.html|.pdf, the page
//      count, the diagram drawn into it; Download HTML saves those bytes;
//      a provider named "labels" or "constructor" still gets the A4 paper
//      and the same file name; the PDF made by makeReportPdf (%PDF-) when
//      carino-pdf.js is loaded;
//   4. the CSVs: devices.csv their devices only, cables.csv their cables
//      and every cable at their devices, named _<provider>-devices.csv and
//      _<provider>-cables.csv, imported into the network or into the part
//      planning no change; on every sample and every provider too, with
//      the sheet built;
//   5. translated: the sheet in Spanish, every string in every locale,
//      Japanese never パソコン;
//   6. the report as a file (D97, providerReportFile): the union of two
//      providers' parts (both records, each device saying who answers for
//      it, both their visits), named _<provider>-<provider>.pdf|.html, a
//      PDF (%PDF-) or the HTML asked for; the client's "Report for this
//      provider" (the Providers tab, D98) opens the same sheet titled with
//      their name, on a read-only network too; "Share their part" opens the
//      share dialog on their part, and its locked link carries only that
//      part (a 'part' revision), the incidents row hidden.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 500) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const el = (id) => document.getElementById(id);
  const heldSave = window.saveBlob;
  const saved = [];
  try {
    await until(() => !!window.TopoProviderReport && !!window.TopoPart && typeof openSheetPreview === 'function');
    const PR = window.TopoProviderReport;
    setLocale('en');
    window.saveBlob = (blob, name) => { saved.push({ blob, name }); return 'blob:x'; };

    const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    const net = () => ({
      v: DOC_VERSION,
      report: { client: 'Clinica Sol', site: 'Reception', engineer: 'Eve', scope: 'Private scope notes' },
      providers: [
        { id: 'pA', name: 'Alfa IT', service: 'it', phone: '555-1', email: 'a@alfa.example', hours: '9-5', account: 'C-42', notes: 'They overcharge' },
        { id: 'pB', name: 'Beta IT', service: 'it', phone: '555-2' },
        { id: 'pC', name: 'Cable ISP', service: 'internet' }
      ],
      groups: [
        { id: 'gTop', name: 'HQ', kind: 'building', providers: ['pA'] },
        { id: 'gSub', name: 'Server room', kind: 'room', parent: 'gTop', providers: ['pB'] },
        { id: 'gFar', name: 'Annex', kind: 'building' }
      ],
      nodes: [
        N('sw', 'switch', { name: 'Core SW', group: 'gTop', vendor: 'Acme', model: 'S24', serial: 'SN-SW', portCount: 8,
          portAttrs: { p1: { vlan: 10 }, p2: { vlan: 20, tagged: '30,40' } }, interfaces: [{ id: 'm', name: 'mgmt', ip: '10.0.0.2/24', mac: '00:11:22:33:44:55' }] }),
        N('srv', 'server', { name: 'Box', group: 'gSub', serial: 'SN-BOX', notes: 'Their own note', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] }),
        N('vm', 'vm', { name: 'App VM', host: 'srv', group: 'gSub' }),
        N('rt', 'router', { name: 'Edge', group: 'gFar', serial: 'SN-SECRET', notes: 'Router notes', providers: ['pC'], interfaces: [{ id: 'w', name: 'wan', ip: '200.1.1.1/30' }, { id: 'l', name: 'lan', ip: '10.0.0.1/24' }] }),
        N('mod', 'modem', { name: 'Modem', group: 'gFar', serial: 'SN-MOD', providers: ['pC'] }),
        N('cl', 'cloud', { name: 'Internet', group: 'gFar', providers: ['pC'] }),
        N('pc', 'pc', { name: 'Far PC', group: 'gFar' })
      ],
      links: [
        { id: 'l1', source: 'srv', target: 'sw', sourceIface: 'i1', targetIface: 'p1', cable: { label: 'C-1' } },
        { id: 'l2', source: 'sw', target: 'rt', sourceIface: 'p2', targetIface: 'l', cable: { label: 'UP' } },
        { id: 'l3', source: 'rt', target: 'mod', sourceIface: 'w', targetIface: 'i1', cable: { label: 'WAN' } },
        { id: 'l4', source: 'mod', target: 'cl', sourceIface: 'i1', targetIface: 'i1' },
        { id: 'l5', source: 'cl', target: 'pc', sourceIface: 'i1', targetIface: 'i1' }
      ],
      incidents: [
        { id: 'inA', at: Date.UTC(2026, 10, 9, 9), symptom: 'internet', status: 'sent', nodeIds: ['sw'], text: 'Nothing loads since 9.', routedTo: ['pA', 'pB'],
          reporter: { name: 'Ana', phone: '5551', email: 'ana@x.example' }, visits: ['vA', 'vB'] },
        { id: 'inO', at: Date.UTC(2026, 10, 8, 9), symptom: 'printer', status: 'open', nodeIds: ['srv'], routedTo: ['pA'], text: 'Old one' },
        { id: 'inZ', at: Date.UTC(2026, 10, 8, 9), symptom: 'phone', status: 'open', nodeIds: ['pc'], routedTo: ['pC'], text: 'Elsewhere' }
      ],
      log: [
        { id: 'vA', at: Date.UTC(2026, 10, 9, 12), kind: 'visit', incidentId: 'inA', providerId: 'pA', provider: 'Alfa IT', by: 'Ana A', outcome: 'partly', notes: 'Alfa visit notes' },
        { id: 'vB', at: Date.UTC(2026, 10, 9, 13), kind: 'visit', incidentId: 'inA', providerId: 'pB', provider: 'Beta IT', by: 'Beto B', outcome: 'fixed', notes: 'B secret' }
      ]
    });
    replaceDocument(net(), { origin: 'file' });
    const full = serializeDoc();

    // ---- 1. The model ----
    const m = PR.providerReportModel(full, 'pA', { incidentId: 'inA', audience: 'provider' });
    const devNames = m.devices.map((d) => d.name);
    ok('their devices: the group\'s, a deep member a nearer provider covers, the VM through its host', show(devNames) === show(['Core SW', 'Box', 'App VM']), show(devNames));
    const dev = (n) => m.devices.find((d) => d.name === n);
    ok('how they answer for each: through the group', dev('Core SW').via === 'Through the group HQ' && dev('Box').via === 'Through the group HQ', dev('Box').via);
    ok('a device in full: model, serial, addresses, MAC, group path, notes', dev('Core SW').model === 'Acme S24' && dev('Core SW').serial === 'SN-SW'
       && dev('Core SW').interfaces[0].ip === '10.0.0.2/24' && dev('Core SW').interfaces[0].mac === '00:11:22:33:44:55' && dev('Core SW').group === 'HQ'
       && dev('Box').notes === 'Their own note' && dev('App VM').host === 'Box', show(dev('Core SW')));
    const swPorts = dev('Core SW').ports;
    ok('the switch\'s ports and VLANs', swPorts.some((r) => r.label === 'Port 1' && r.vlan === '10' && r.peer === 'Box') && swPorts.some((r) => r.label === 'Port 2' && r.vlan === '20' && r.tagged.includes('30')), show(swPorts));
    const ctx = Object.fromEntries(m.context.map((c) => [c.name, c]));
    ok('linked devices: their way to the network ends at the router; the modem and the Internet past it are not theirs to see (D363)', ctx.Edge && ctx.Edge.role === 'hop1' && !ctx.Modem && !ctx.Internet && !ctx['Far PC'], show(m.context.map((c) => [c.name, c.role])));
    ok('a linked device: the port facing theirs and its addresses', ctx.Edge.facing[0].port === 'lan' && ctx.Edge.facing[0].peer === 'Core SW' && ctx.Edge.facing[0].theirs
       && show(ctx.Edge.addresses) === show(['200.1.1.1/30', '10.0.0.1/24']), show(ctx.Edge));
    ok('the cables, theirs first, ports at both ends', m.cables.length === 2 && m.cables[0].theirs && m.cables[1].theirs
       && m.cables.some((c) => c.from === 'Box' && c.fromIface === 'eth0' && c.to === 'Core SW' && c.toIface === 'Port 1'), show(m.cables));
    ok('this problem, with who reported it', m.incident && m.incident.text === 'Nothing loads since 9.' && m.incident.reporter.phone === '5551', show(m.incident));
    ok('their other open problem, not one elsewhere', m.problems.length === 1 && m.problems[0].id === 'inO', show(m.problems));
    ok('their own visits only', m.visits.length === 1 && m.visits[0].notes === 'Alfa visit notes', show(m.visits));
    ok('the provider\'s own record, never the client\'s notes', m.provider.account === 'C-42' && m.provider.hours === '9-5' && !show(m).includes('They overcharge'), show(m.provider));
    ok('the header: the site and the client', m.meta.site === 'Reception' && m.meta.client === 'Clinica Sol' && !show(m).includes('Private scope notes'));
    ok('an unknown provider: no model', PR.providerReportModel(full, 'pZ', {}) === null);
    // A problem beyond two hops, and a host.
    const far = PR.providerReportModel(full, 'pA', { incidentId: 'inZ' });
    ok('a problem being sent far away brings its device as "Where the problem is"', far.context.some((c) => c.name === 'Far PC' && c.role === 'problem' && c.roleText === 'Where the problem is'), show(far.context.map((c) => [c.name, c.role])));
    const hostDoc = JSON.parse(JSON.stringify(full));
    hostDoc.nodes.find((n) => n.id === 'vm').providers = ['pC'];
    const hm = PR.providerReportModel(hostDoc, 'pC', {});
    ok('the server a VM of theirs runs on: "Runs their devices"', hm.devices.some((d) => d.name === 'App VM') && hm.context.some((c) => c.name === 'Box' && (c.role === 'host' || c.role === 'hop1' || c.role === 'hop2')), show(hm.context.map((c) => [c.name, c.role])));
    const hostRole = PR.providerContextRole({ hop: 0, why: new Set(['host']) });
    ok('the host mark', hostRole.key === 'host' && hostRole.text === 'Runs their devices');
    const named = PR.providerReportModel(full, 'pC', {});
    ok('named on it', named.devices.find((d) => d.name === 'Edge').via === 'Named on it');

    // ---- 2. The sheet ----
    const html = PR.providerReportHtml(m, null);
    const dom = new DOMParser().parseFromString(html, 'text/html');
    ok('the sheet is titled for the provider', dom.title === 'Your part of this network' && dom.querySelector('h1').textContent === 'Your part of this network');
    ok('every section', ['problem', 'devices', 'linked', 'cables', 'problems', 'visits'].every((c) => !!dom.querySelector(`section.${c}`)), [...dom.querySelectorAll('section')].map((s) => s.className).join(','));
    ok('the header: site, client, contact and their record', html.includes('Reception · Clinica Sol') && html.includes('Ana · 5551 · ana@x.example') && html.includes('C-42') && html.includes('a@alfa.example'));
    ok('their devices\' serials, MAC and VLANs', html.includes('SN-SW') && html.includes('SN-BOX') && html.includes('00:11:22:33:44:55') && html.includes('VLAN 20') && html.includes('Tagged 30,40'));
    ok('hop marks', dom.querySelectorAll('.hop-hop1').length === 1 && dom.querySelectorAll('.hop-hop2').length === 0);
    const leaks = ['SN-SECRET', 'Router notes', 'SN-MOD', 'Beta IT', 'B secret', 'They overcharge', 'Private scope notes', 'Elsewhere', 'Eve'].filter((s) => html.includes(s));
    ok('nothing it must not carry', !leaks.length, leaks.join(' | '));
    ok('no table and no finding: blocks the preview counts', !dom.querySelector('table') && dom.querySelectorAll('.dev-block').length >= 6 && !/Critical|Advisory/.test(html));
    ok('the sheet carries the A4 margins and its note', /@page \{ size: A4; margin: 16mm 14mm; \}/.test(html) && dom.querySelector('.toolbar span').textContent.startsWith('What you look after here')
       && !/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, '')));
    const cm = PR.providerReportModel(full, 'pA', { audience: 'client' });
    ok('for the client: "{name}\'s part of this network"', cm.title === 'Alfa IT\'s part of this network' && !cm.incident, cm.title);

    // ---- 3. The preview ----
    setReportFormat('html');
    const r = await PR.openProviderReport('pA', { doc: full, incidentId: 'inA', audience: 'provider' });
    const built = r && await r.ready;
    ok('the print preview opens with the sheet', !!built && !el('sheetPreviewDialog').classList.contains('hidden') && el('sheetPreviewTitle').textContent === 'Your part of this network');
    ok('named topo_<org>_<site>_<date>_<provider>.html', /^topo_clinica-sol_reception_\d{4}-\d{2}-\d{2}_alfa-it\.html$/.test(el('sheetPreviewName').textContent), el('sheetPreviewName').textContent);
    ok('on A4: a page count', /pages? \(A4\)$/.test(el('sheetPreviewStatus').textContent), el('sheetPreviewStatus').textContent);
    ok('the diagram drawn into it', !!r.image && built.html.includes('class="dev-block figure"') && built.html.includes('data:image/png'), r.image ? 'image' : 'no image');
    ok('the frame shows it on paper', !!el('sheetPreviewFrame').contentDocument.querySelector('.dev-block') && !!SHEET_PREVIEW[sheetPreviewBuilt().kind]);
    const dl = downloadSheetPreview();
    const dlText = dl && saved.length ? await saved[saved.length - 1].blob.text() : '';
    ok('Download HTML saves the sheet', !!dl && dl.format === 'html' && /_alfa-it\.html$/.test(dl.name) && dlText === built.html, dl && dl.name);
    ok('the canvas is the network again', state.nodes.length === full.nodes.length && !!getNode('pc'));
    const k1 = PR.providerSheetKind('labels'), k2 = PR.providerSheetKind('constructor'), k3 = PR.providerSheetKind('locate');
    ok('a provider named labels, constructor or locate: the A4 paper, the same file name', k1 !== 'labels' && SHEET_PREVIEW[k1] === SHEET_PREVIEW.locate && SHEET_PREVIEW.labels.pageW < 300
       && SHEET_PREVIEW[k2] === SHEET_PREVIEW.locate && k3 !== 'locate' && reportFileName({ site: 'S' }, k1).endsWith('_labels.html') && reportFileName({ site: 'S' }, k2).endsWith('_constructor.html'), show([k1, k2, k3]));
    if (reportPdfEngine()) {
      const t0 = performance.now();
      const pdf = await makeReportPdf(built.html);
      const head = pdf ? await pdf.slice(0, 5).text() : '';
      ok('the PDF made by makeReportPdf', head === '%PDF-' && pdf.size > 1000, `${head} ${pdf && pdf.size} bytes in ${Math.round(performance.now() - t0)} ms`);
      setReportFormat('pdf');
      const r2 = await PR.openProviderReport('pA', { doc: full, incidentId: 'inA' });
      await r2.ready;
      ok('PDF chosen: the name ends .pdf', /_alfa-it\.pdf$/.test(el('sheetPreviewName').textContent), el('sheetPreviewName').textContent);
      closeSheetPreview();
      setReportFormat('html');
    } else ok('carino-pdf.js is loaded on the page', false, 'no CarinoPdf');

    // ---- 4. The CSVs ----
    const sheetOf = (text) => csvSheet(csvParse(text.replace(/^﻿/, '')), true);
    const plan = (doc, text) => withDoc(doc, () => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); });
    const part = TopoPart.providerPart(full, ['pA']);
    const dc = PR.providerCsv(full, 'pA', 'devices'), cc = PR.providerCsv(full, 'pA', 'cables');
    ok('devices.csv: their devices only', dc.rows === 3 && sheetOf(dc.text).rows.map((x) => x[0]).sort().join(',') === 'srv,sw,vm', dc.text.split('\n').slice(1).map((l) => l.split(',')[0]).join(','));
    ok('cables.csv: their cables and every cable at their devices', cc.rows === 2 && /\nl1,/.test(cc.text) && /\nl2,/.test(cc.text) && !/\nl3,/.test(cc.text), cc.text);
    ok('named _<provider>-devices.csv and _<provider>-cables.csv, with the BOM', /^topo_clinica-sol_reception_\d{4}-\d{2}-\d{2}_alfa-it-devices\.csv$/.test(dc.name) && /_alfa-it-cables\.csv$/.test(cc.name) && dc.text.startsWith('﻿'), dc.name);
    {
      // The sheet's word is English in every language, as the network's own devices.csv.
      setLocale('ja');
      const jd = PR.providerCsv(full, 'pA', 'devices'), jc = PR.providerCsv(full, 'pA', 'cables');
      setLocale('en');
      ok('the file name is the same in Japanese: -devices.csv, -cables.csv', jd.name === dc.name && jc.name === cc.name, [jd.name, jc.name]);
    }
    {
      // A kept network: its files go by the card's name, as every other
      // download of it (docFileStem); the sheet's header keeps the site.
      const heldKept = window.keptSiteName;
      window.keptSiteName = () => 'Clinica Norte';
      try {
        const kc = PR.providerCsv(full, 'pA', 'devices');
        const km = PR.providerReportModel(full, 'pA', { audience: 'client' });
        ok('a kept network: the CSV and the report named by the card, the header keeps its site',
           /^topo_clinica-sol_clinica-norte_\d{4}-\d{2}-\d{2}_alfa-it-devices\.csv$/.test(kc.name)
           && /^topo_clinica-sol_clinica-norte_\d{4}-\d{2}-\d{2}_alfa-it\.pdf$/.test(reportFileName(km.meta, km.fileKind, 'pdf')) && km.meta.site === 'Reception',
           show([kc.name, km.meta]));
      } finally { window.keptSiteName = heldKept; }
    }
    ok('no provider column: read back it would take the other providers off', !sheetOf(dc.text).headers.includes('provider') && !sheetOf(cc.text).headers.includes('cable_provider'),
       sheetOf(dc.text).headers.join(','));
    const same = (p) => p.rows.every((x) => x.status === 'same');
    const why = (p) => p.rows.filter((x) => x.status !== 'same').map((x) => `${x.name}:${x.status}:${x.why || ''}:${show(x.changes || x.diff || '')}`).join(' | ');
    [['devices', dc], ['cables', cc]].forEach(([k, c]) => {
      const pf = plan(full, c.text), pp = plan(part.doc, c.text);
      ok(`${k}.csv imported into the network plans no change`, same(pf), why(pf));
      ok(`${k}.csv imported into the part plans no change`, same(pp), why(pp));
    });
    const d1 = downloadProviderCsv('pA', 'devices', full);
    ok('Devices CSV downloads it', !!d1 && saved[saved.length - 1].name === dc.name);

    // Every sample, every provider: the sheet builds, the CSVs read back.
    const bad = [];
    let n = 0;
    const keys = TEMPLATE_META.map((x) => x.key).flatMap((k) => [k, k + SIMPLE_SUFFIX]).filter((k) => templatesData[k]);
    keys.forEach((k) => {
      const d = canonicalDoc(migrateDoc(cloneData(templatesData[k])).doc);
      (d.providers || []).forEach((p) => {
        const mm = PR.providerReportModel(d, p.id, {});
        if (!mm) return;
        n++;
        try {
          const h = PR.providerReportHtml(mm, null);
          if (!h.includes('</html>')) bad.push(`${k}/${p.id}: no sheet`);
        } catch (e) { bad.push(`${k}/${p.id}: ${e.message}`); }
        const pd = TopoPart.providerPart(d, [p.id]).doc;
        ['devices', 'cables'].forEach((w) => {
          const c = PR.providerCsv(d, p.id, w);
          if (c.rows === 0) return;
          const pf = plan(d, c.text), pp = plan(pd, c.text);
          if (!same(pf)) bad.push(`${k}/${p.id} ${w} into the network: ${why(pf).slice(0, 160)}`);
          if (!same(pp)) bad.push(`${k}/${p.id} ${w} into the part: ${why(pp).slice(0, 160)}`);
        });
      });
    });
    ok('every sample, every provider: the sheet builds and the CSVs plan no change', n > 10 && !bad.length, `${n} providers; ` + bad.slice(0, 4).join(' || '));

    // ---- 5. Translated ----
    setLocale('es');
    const es = PR.providerReportHtml(PR.providerReportModel(full, 'pA', { incidentId: 'inA', audience: 'provider' }), null);
    ok('the sheet in Spanish', es.includes('<title>Su parte de esta red</title>') && es.includes('Equipos vinculados') && es.includes('Salto 1'), es.slice(0, 200));
    setLocale('en');
    const { has, locales } = window.CarinoI18N;
    const req = new XMLHttpRequest(); req.open('GET', 'js/providerreport.js', false); req.send();
    const strs = new Set();
    for (const mt of req.responseText.matchAll(/\bt\(\s*([^;]*?)(?:,\s*\{|\))/g)) for (const s of mt[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) strs.add(s[1].replace(/\\'/g, '\''));
    ['Hop 1', 'Hop 2', 'Devices CSV', 'Cables CSV'].forEach((s) => strs.add(s));
    // Report a problem to them and Provider report… (D365).
    ['Report a problem to them', 'Report a problem with what they look after: they are ticked as the recipient and their report goes with it', 'Chosen from their card',
      'Print their report', '🧾 Provider report…', 'Provider report', 'Whose report?', 'Open the report', 'This network has no providers yet. Add one in the Providers tab.',
      'Port {port}: in use (not in your part)'].forEach((s) => strs.add(s));
    ok('the module\'s strings found', strs.size > 30, String(strs.size));
    locales.forEach((loc) => { const missing = [...strs].filter((s) => !has(loc, s)); ok(`${loc} carries the report's strings`, !missing.length, missing.join(' | ')); });
    setLocale('ja');
    const ja = PR.providerReportHtml(PR.providerReportModel(full, 'pA', { incidentId: 'inA' }), null);
    ok('Japanese never パソコン', !ja.includes('パソコン') && ja.includes('このネットワークの担当部分'));
    setLocale('en');

    // ---- 6. The report as a file; the client's report and share ----
    const both = PR.providerReportModel(full, ['pA', 'pC'], { incidentId: 'inA', audience: 'client' });
    const one = PR.providerReportModel(full, 'pA', { incidentId: 'inA', audience: 'client' });
    const onlyC = PR.providerReportModel(full, 'pC', { incidentId: 'inA', audience: 'client' });
    const ids = (m) => m.devices.map((d) => d.id).sort().join(',');
    ok('two providers: the union of their parts', !!both && new Set([...one.devices, ...onlyC.devices].map((d) => d.id)).size === both.devices.length
       && show(both.providerIds) === show(['pA', 'pC']), `${ids(both)} / ${ids(one)} + ${ids(onlyC)}`);
    ok('two providers: both records, the title and each device\'s answer', both.providers.length === 2 && both.title === 'The part of this network Alfa IT and Cable ISP look after'
       && both.devices.every((d) => /^(Alfa IT|Cable ISP): /.test(d.via)) && both.fileKind === 'Alfa IT Cable ISP', show([both.title, both.devices.map((d) => d.via)]));
    const bothHtml = PR.providerReportHtml(both, null);
    ok('the sheet lists both providers', bothHtml.includes('<dd>Alfa IT</dd>') && bothHtml.includes('<dd>Cable ISP</dd>') && !bothHtml.includes('Beta IT') && !bothHtml.includes('They overcharge'));
    const docNow = serializeDoc();
    replaceDocument(full);
    const fh = await PR.providerReportFile(['pA', 'pC'], { incidentId: 'inA', format: 'html' });
    ok('the file: HTML asked, named _<provider>-<provider>.html', !!fh && fh.format === 'html' && fh.type === 'text/html' && /^topo_clinica-sol_reception_\d{4}-\d{2}-\d{2}_alfa-it-cable-isp\.html$/.test(fh.name)
       && fh.bytes === fh.blob.size && (await fh.blob.text()).includes('data:image/png'), fh && fh.name);
    if (reportPdfEngine()) {
      const fp = await PR.providerReportFile('pA', { incidentId: 'inA', format: 'pdf' });
      ok('the file: a PDF', !!fp && fp.type === 'application/pdf' && /_alfa-it\.pdf$/.test(fp.name) && (await fp.blob.slice(0, 5).text()) === '%PDF-', fp && fp.name);
    }
    ok('the canvas is the network again after the file', state.nodes.length === full.nodes.length);
    // The Providers tab: Report a problem to them, Share their part (D365).
    showConfigTab('providers');
    renderProvidersPanel(true);
    const card = document.querySelector('.pv-card[data-pv="pA"]');
    ok('the card has Report a problem to them and Share their part, no Report for this provider', !!card && !!card.querySelector('[data-act="problem"]') && !!card.querySelector('[data-act="sharepart"]')
       && !card.querySelector('[data-act="report"]') && card.querySelector('[data-act="problem"]').textContent === 'Report a problem to them'
       && card.querySelector('[data-act="sharepart"]').textContent === 'Share their part');
    // Export's Provider report…: a pick among the providers, then their report.
    const heldResponder = setDialogResponder((req) => { picked.push(req); return req.kind === 'pick' ? 'pA' : undefined; });
    const picked = [];
    el('providerReportBtn').click();
    await until(() => !el('sheetPreviewDialog').classList.contains('hidden') && sheetPreviewBuilt(), 600);
    ok('Export\'s Provider report…: whose report is asked, every provider listed', picked.length === 1 && picked[0].kind === 'pick' && picked[0].message === 'Whose report?'
       && show(picked[0].rows.map((r) => r.id)) === show(full.providers.map((p) => p.id)), show(picked.map((r) => [r.kind, r.message])));
    ok('then the preview, titled with their name', el('sheetPreviewTitle').textContent === 'Alfa IT\'s part of this network'
       && /_alfa-it\.(html|pdf)$/.test(el('sheetPreviewName').textContent), el('sheetPreviewTitle').textContent + ' ' + el('sheetPreviewName').textContent);
    closeSheetPreview();
    setDialogResponder(heldResponder);
    document.querySelector('.pv-card[data-pv="pA"] [data-act="sharepart"]').click();
    await tick();
    ok('Share their part: the share dialog on their part, no incidents row', !el('shareDialog').classList.contains('hidden') && el('shareTitle').textContent === 'Share their part'
       && /^The link carries only what Alfa IT looks after: (1 device|\d+ devices) of theirs, (1 linked device|\d+ linked devices) around them, their reports and visits\.$/.test(el('shareBlurb').textContent)
       && el('shareIncidentsRow').classList.contains('hidden'), el('shareBlurb').textContent);
    {
      // One device and one linked device: said in the singular.
      const heldCounts = _sharePart.counts;
      _sharePart.counts = Object.assign({}, heldCounts, { items: 1, context: 1 });
      renderShareDialog();
      ok('Share their part: one device, one linked device, in the singular', el('shareBlurb').textContent
         === 'The link carries only what Alfa IT looks after: 1 device of theirs, 1 linked device around them, their reports and visits.', el('shareBlurb').textContent);
      _sharePart.counts = heldCounts;
      // Unlocked, their reports' names and phones ask for the lock.
      const heldSeal = el('shareSeal').checked;
      el('shareSeal').checked = false;
      renderShareDialog();
      const people = sharePartHasPeople(_sharePart);
      const warned = el('shareHint').textContent.includes('The problem reports carry names and phone numbers: lock the link.');
      const withReporter = { lintDoc: { incidents: [{ id: 'x', reporter: { name: 'Ana', phone: '555' } }] } };
      ok('Share their part, unlocked: the names-and-phones warning follows their reports', people && warned
         && sharePartHasPeople(withReporter) && !sharePartHasPeople({ lintDoc: { incidents: [{ id: 'x', reporter: { name: ' ' } }] } }), show([people, warned]));
      el('shareSeal').checked = heldSeal;
      renderShareDialog();
    }
    if (canSeal()) {
      const heldClip = navigator.clipboard && navigator.clipboard.writeText;
      try { navigator.clipboard.writeText = () => Promise.resolve(); } catch (e) { /* read-only */ }
      el('shareCopyBtn').click();
      await until(() => el('shareLink').value, 600);
      const url = el('shareLink').value;
      const { json } = await unsealFragment(url.slice(url.indexOf('#') + 1), sharePassphrase());
      const sent = JSON.parse(json);
      const part1 = TopoPart.providerPart(full, ['pA']);
      ok('its locked link carries their part only, as a part revision', sent.nodes.length === part1.items.nodes.size + part1.context.size
         && sent.providers.length === 1 && sent.providers[0].id === 'pA' && !JSON.stringify(sent).includes('They overcharge')
         && (!isKept() || revisionWhy(state.libraryId, sent.rev) === 'part'),
         show([sent.nodes.length, part1.items.nodes.size, part1.context.size, sent.providers.map((x) => x.id)]));
      try { if (heldClip) navigator.clipboard.writeText = heldClip; } catch (e) { /* read-only */ }
    }
    closeShareDialog();
    // Read-only: the report still opens; a problem and Share their part are refused.
    state.readOnly = { doc: cloneData(serializeDoc()), loaded: JSON.stringify(serializeDoc()) };
    renderProvidersPanel(true);
    {
      const held = setDialogResponder((req) => (req.kind === 'pick' ? 'pA' : undefined));
      el('providerReportBtn').click();
      await until(() => !el('sheetPreviewDialog').classList.contains('hidden') && sheetPreviewBuilt(), 600);
      ok('a read-only network still prints their report', !el('sheetPreviewDialog').classList.contains('hidden'));
      closeSheetPreview();
      setDialogResponder(held);
    }
    document.querySelector('.pv-card[data-pv="pA"] [data-act="problem"]').click();
    await tick();
    ok('a read-only network: Report a problem to them refused', !TopoIncidents.draft.open);
    document.querySelector('.pv-card[data-pv="pA"] [data-act="sharepart"]').click();
    await tick();
    ok('a read-only network: Share their part refused', el('shareDialog').classList.contains('hidden'));
    state.readOnly = null;

    // ---- Report a problem to them (D365) ----
    {
      const TI = window.TopoIncidents;
      const heldFile = TI.hooks.reportFile;
      let fileFor = null;
      // As the real one does (withDoc), the stand-in borrows the page's
      // document while it works: the link must not be made meanwhile.
      TI.hooks.reportFile = async (ids, opts) => {
        fileFor = { ids: ids.slice(), opts };
        const held = state.nodes;
        state.nodes = held.filter((n) => ids.some((id) => (n.providers || []).includes(id)));
        try { await new Promise((r) => setTimeout(r, 150)); } finally { state.nodes = held; }
        return { name: 'alfa_report.html', type: 'text/html', bytes: 3, blob: new Blob(['abc']) };
      };
      try {
        renderProvidersPanel(true);
        // A device selected: Report a problem would start on it; their card does not.
        state.selectedType = 'node'; state.selectedId = 'rt';
        document.querySelector('.pv-card[data-pv="pB"] [data-act="problem"]').click();
        await until(() => TI.draft.open, 100);
        const firstRow = el('problemContacts').querySelector('.pb-contact');
        ok('their card opens Report a problem: no device picked, them ticked, first', TI.draft.open && el('problemTitle').textContent === 'Report a problem' && TI.draft.nodeIds.length === 0
           && TI.draft.sendTo[0] === 'pB' && !!firstRow && firstRow.querySelector('.pb-contact-name').textContent === 'Beta IT'
           && firstRow.querySelector('[data-sendto="pB"]').checked, show([TI.draft.nodeIds, TI.draft.sendTo, firstRow && firstRow.textContent]));
        // A provider the routing would not list for this network is listed all the same, as chosen.
        TI.closeProblemDialog();
        TI.openProblemFor('pC');
        const rows = [...el('problemContacts').querySelectorAll('.pb-contact')];
        const cRow = rows.find((r) => r.querySelector('[data-sendto="pC"]'));
        ok('one the routing lists last comes first, ticked', TI.draft.sendTo[0] === 'pC' && rows[0] === cRow && cRow.querySelector('[data-sendto="pC"]').checked,
           show([TI.draft.sendTo, rows.map((r) => r.textContent)]));
        TI.closeProblemDialog();
        TI.openProblemFor('pB');
        // The form asks for the device as usual: the server, which routes to Alfa IT too.
        TI.draft.nodeIds = ['srv']; TI.draft.symptom = 'printer';
        renderProblemDialog();
        ok('the routing may tick others too; theirs stays ticked', TI.draft.sendTo.includes('pB') && TI.draft.sendTo[0] === 'pB', show(TI.draft.sendTo));
        el('problemName').value = 'Ana'; el('problemPhone').value = '5551';
        el('problemSaveSendBtn').click();
        await until(() => TI.draft.send && TI.draft.send.attachFile, 300);
        const s = TI.draft.send;
        ok('on the send step their report is attached, as Also attach the report ticked', !!s && s.scope === 'part' && s.attach === true && el('problemAttach').checked
           && !!fileFor && fileFor.ids.includes('pB') && s.attachFile.name === 'alfa_report.html', show(s && { attach: s.attach, scope: s.scope, fileFor }));
        ok('and Print their report is there', !el('problemScopeRow').classList.contains('hidden') && el('problemPrintTheirs').textContent === 'Print their report');
        await until(() => !s.busy && (s.result || s.failCount), 300);
        const whole = TopoPart.providerPart(serializeDoc(), TI.draft.sendTo, { incidentId: TI.draft.incidentId });
        ok('the link and the attached report are made one after the other: the link\'s part is of the whole network', !!s.result && show(s.result.counts) === show(whole.counts),
           show([s.result && s.result.counts, whole.counts]));
        el('problemPrintTheirs').click();
        await until(() => !el('sheetPreviewDialog').classList.contains('hidden') && sheetPreviewBuilt(), 600);
        ok('Print their report: the recipients\' report in the preview, the sheet stepped aside', !el('sheetPreviewDialog').classList.contains('hidden') && /Beta IT/.test(el('sheetPreviewTitle').textContent)
           && el('problemDialog').hidden && TI.draft.open, el('sheetPreviewTitle').textContent);
        closeSheetPreview();
        await tick();
        ok('the preview closed, the send step is back as it was', !el('problemDialog').hidden && TI.draft.open && TI.draft.send === s && !el('problemSend').hidden && el('problemAttach').checked);
        TI.closeProblemDialog();
        // Report a problem from Export: no provider pinned, nothing attached.
        TI.openProblemDialog();
        ok('Report a problem from Export pins nobody', TI.draft.forProvider === null);
        TI.closeProblemDialog();
      } finally {
        TI.hooks.reportFile = heldFile;
      }
    }
    replaceDocument(docNow);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    window.saveBlob = heldSave;
    try { closeSheetPreview(); } catch (e) { /* not open */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
