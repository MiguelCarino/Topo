// The technical sheet's sections, a tick each (an owner request, 2026-11-04,
// docs/BACKLOG.md "Decisions taken": "Make ports table optional, we will make
// check marks for more specific reports"). What is held here:
//   1. reportParts().sections: every REPORT_SECTIONS key at its default
//      (all on but the Capacity Ports table, the Network log and the
//      Address history), a
//      boolean given for a key winning, unknown keys and non-booleans
//      ignored, no map meaning the defaults;
//   2. the default report: on every shipped template and a nearly full
//      switch, byte for byte the report with every section ticked minus
//      the Ports table (and the Capacity heading when that was all of it);
//      the summary sheet itself the same whatever is ticked;
//   3. each tick removes exactly its own section: the sheet cut at its h2
//      headings is the same list of pieces minus that section's (findings
//      takes To check on the next visit and Known / accepted with it), the
//      Capacity tables likewise at their h3; a diagram on a sheet of its
//      own goes with the Topology tick; with nothing in Capacity ticked no
//      Capacity heading is left; with everything off the sheet keeps its
//      Summary and Scope and method only;
//   4. the binder: nothing said is the defaults (no Ports table), its
//      sections map reaches every site's sheet;
//   5. buildSiteReport, dated: the dialog's sections reach the built
//      report and the dated counts are those of reportModel at that date;
//   6. the dialog: a tick per section starting from its default (the
//      Address history's too, off), read by readReportParts, the row hidden
//      with Technical details, the saved-search ticks hidden with the Saved
//      searches section, nothing kept between openings, a language switch
//      rewording the ticks and keeping them, the binder dialog listing them
//      too;
//   7. every tick's words in es, pt-BR, ja and ru;
//   8. pinned to the output from before the ticks existed: every shipped
//      template's report (both parts; technical with a diagram; and with
//      the Large map), the Ports table ticked, hashed against the hashes
//      the earlier reportSheet gave, with the clock held at 2026-11-05
//      (they were taken that day: ages and services count to it);
//   9. the review's fixes: a Ports table printed without Switch ports does
//      not point at it; the Large map's note prints with Topology unticked;
//      the binder cover's estate findings, addressing and topology follow
//      their ticks; a report without Changes (and no summary) does not move
//      a kept network's report baseline, site or binder.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const el = (id) => document.getElementById(id);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  setLocale('en');
  const KEYS = REPORT_SECTIONS.map((s) => s.key);
  const allOn = Object.fromEntries(KEYS.map((k) => [k, true]));
  const allOff = Object.fromEntries(KEYS.map((k) => [k, false]));
  const img = { url: 'data:image/png;base64,AAAA', width: 600, height: 400, scale: 1 };
  // A sheet cut at its h2 headings: [heading, piece] in order, each piece
  // trimmed (a section left out leaves only blank lines behind).
  const cut = (html, tag = 'h2') => html.split(`<${tag}>`).map((piece, i) => {
    const end = piece.indexOf(`</${tag}>`);
    return [i === 0 || end < 0 ? '' : piece.slice(0, end), piece.replace(/\s+$/, '')];
  });
  const HEADS = {
    findings: ['Findings', 'To check on the next visit', 'Known / accepted'], providers: ['Providers'], diagram: ['Topology'],
    devices: ['Device inventory'], inventory: ['Inventory'], racks: ['Racks'], ports: ['Switch ports'], cables: ['Connections'],
    wifi: ['Wi-Fi'], addressing: ['Addressing'], vlans: ['VLANs'], searches: ['Saved searches'],
    changes: ['Changes since the last back-up', 'Changes since the last report']
  };
  const H3 = { capAddresses: 'Addresses', capPorts: 'Ports', capPoe: 'PoE' };
  const closet = () => {
    // A make and model (the Inventory section) and a trunk (VLANs).
    const sw = { id: 'sw', type: 'switch', name: 'Closet switch', x: 0, y: 0, portCount: 8, vendor: 'Cisco', model: 'C9200-24P',
      portAttrs: { p1: { vlan: 1, tagged: '10,20' } }, interfaces: [] };
    const nodes = [sw], links = [];
    for (let p = 1; p <= 7; p++) {
      nodes.push({ id: `h${p}`, type: 'pc', name: `H${p}`, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: `10.0.9.${p}/28` }] });
      links.push({ id: `l${p}`, source: 'sw', target: `h${p}`, sourceIface: `p${p}`, targetIface: 'i1' });
    }
    return { v: DOC_VERSION, networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes, links };
  };
  const portsOnly = () => {
    const d = closet();
    d.networks = [];
    d.nodes.forEach((n) => { n.interfaces.forEach((i) => { delete i.ip; }); });
    return d;
  };
  // Every shipped template, and two built here, each with a search marked
  // to print and a Changes section, so every section shows somewhere.
  const candidates = [...Object.keys(templatesData).sort().map((k) => [k, () => cloneData(templatesData[k])]), ['closet', closet], ['portsOnly', portsOnly]];
  const modelOf = (make) => {
    const d = make();
    d.searches = [{ id: 'sq_rs', name: 'Every PC', query: 'type:pc', print: true }];
    replaceDocument(d, { origin: 'file' });
    const m = reportModel();
    m.changes = { kind: 'backup', rows: [], at: Date.now() };
    return m;
  };

  try {
    // ---- 1. reportParts().sections ----
    const def = reportParts().sections;
    ok('every section key is in the map', show(Object.keys(def)) === show(KEYS), show(def));
    ok('every one on by default but the Ports table, the Problems and visits, the Network log and the Address history', KEYS.every((k) => def[k] === !(k === 'capPorts' || k === 'history' || k === 'log' || k === 'incidents')), show(def));
    ok('history is no longer reserved: it has a tick (stage 5)', REPORT_SECTIONS.find((s) => s.key === 'history').on === false
       && REPORT_SECTIONS.filter((s) => s.reserved).length === 0);
    const given = reportParts({ sections: { devices: false, capPorts: true, bogus: false, racks: 'no', history: true } }).sections;
    ok('a boolean wins; unknown keys and non-booleans are ignored', given.devices === false && given.capPorts === true && given.history === true
       && given.racks === true && !('bogus' in given), show(given));
    ok('no map, an empty one and a non-object all mean the defaults', [undefined, {}, null, 'x', 7, []].every((s) => show(reportParts({ sections: s }).sections) === show(def)));
    ok('the summary-only and the both reports carry the map too', show(reportParts({ summary: true, technical: false }).sections) === show(def));

    // ---- 2. the default report ----
    const differs = [], summaryDiffers = [];
    candidates.forEach(([name, make]) => {
      const m = modelOf(make);
      [null, img].forEach((image) => {
        const on = reportHtml(m, image, { summary: true, technical: true, sections: allOn });
        const dflt = reportHtml(m, image, { summary: true, technical: true });
        const ports = capacityPorts(m.capacity.ports || []);
        let want = on;
        if (ports) {
          const whole = `\n    <h2>Capacity</h2>\n    ${ports}\n`;
          want = on.includes(whole) ? on.replace(whole, '') : on.replace(ports, '');
        }
        if (dflt !== want) differs.push(`${name}${image ? ' +image' : ''}`);
        const sum = summarySheet(m, { image });
        const none = reportHtml(m, image, { summary: true, technical: true, sections: allOff });
        if (!on.includes(sum) || !none.includes(sum) || !dflt.includes(sum)) summaryDiffers.push(name);
      });
    });
    ok(`the default is every section but the Ports table, byte for byte (${candidates.length} documents, with and without a diagram)`, !differs.length, show(differs));
    ok('the summary sheet is the same whatever is ticked', !summaryDiffers.length, show(summaryDiffers));
    const cm = modelOf(closet);
    const cHtml = reportHtml(cm, null, { technical: true });
    ok('a nearly full switch: Addresses in Capacity, no Ports table by default', cHtml.includes('<h3>Addresses</h3>') && !cHtml.includes('<h3>Ports</h3>')
       && reportHtml(cm, null, { technical: true, sections: { capPorts: true } }).includes('<h3>Ports</h3>'));
    const pm = modelOf(portsOnly);
    ok('a Capacity holding only the Ports table has no heading by default', pm.capacity.ports.length === 1 && !reportHtml(pm, null).includes('<h2>Capacity</h2>')
       && reportHtml(pm, null, { sections: { capPorts: true } }).includes('<h2>Capacity</h2>'), show(pm.capacity.ports));

    // ---- 3. each tick removes exactly its section ----
    const seen = new Set(), wrong = [];
    candidates.forEach(([name, make]) => {
      const m = modelOf(make);
      const on = reportSheet(m, img, { sections: allOn });
      const pieces = cut(on);
      Object.entries(HEADS).forEach(([key, heads]) => {
        if (!pieces.some(([h]) => heads.includes(h))) return;
        seen.add(key);
        const off = cut(reportSheet(m, img, { sections: Object.assign({}, allOn, { [key]: false }) }));
        // The last piece (Scope and method) carries a diagram sheet of the
        // diagram's own: the Topology tick takes that too.
        // Without Switch ports the Capacity Ports table's intro stops
        // pointing at it, and that one sentence is all that changes there.
        const unpoint = (p) => p.replace(' Every port of every switch is under Switch ports.', '');
        const want = pieces.filter(([h]) => !heads.includes(h)).map(([h, p]) => [h, key === 'ports' && h === 'Capacity' ? unpoint(p) : p]);
        // Only there: every other tick leaves the pages after the sheet
        // (the diagram's own page, the Large map) byte for byte.
        const strip = (list) => show(list.map(([h, p]) => (key === 'diagram' && h === 'Scope and method' ? p.split('</footer>')[0] : p)));
        if (strip(off) !== strip(want)) wrong.push(`${name}: ${key}`);
      });
      const cap = pieces.find(([h]) => h === 'Capacity');
      if (cap) {
        const capOn = cut(cap[1], 'h3');
        Object.entries(H3).forEach(([key, h3]) => {
          if (!capOn.some(([h]) => h === h3)) return;
          seen.add(key);
          const offCap = cut(reportSheet(m, img, { sections: Object.assign({}, allOn, { [key]: false }) })).find(([h]) => h === 'Capacity');
          const want = capOn.filter(([h]) => h !== h3);
          const got = offCap ? cut(offCap[1], 'h3') : [];
          if (want.length > 1 ? show(got) !== show(want) : !!offCap) wrong.push(`${name}: ${key}`);
        });
      }
    });
    // The Address history needs a kept network's trail, which these models
    // have not: tests/suites/addresshistory.js holds it.
    // The Network log needs a log, which no shipped template has: it is
    // held just below (and in tests/suites/mergeapply.js).
    // The Problems and visits need a report, which no shipped template has
    // either: held below too.
    const printable = KEYS.filter((k) => !REPORT_SECTIONS.find((s) => s.key === k).reserved && k !== 'history' && k !== 'log' && k !== 'incidents');
    ok('every section turns up in some document here', printable.every((k) => seen.has(k)), show(printable.filter((k) => !seen.has(k))));
    ok('each tick takes out exactly its own section and leaves every other byte for byte', !wrong.length, show(wrong));
    {
      // A network with a log: the Network log tick prints it after Changes
      // and takes out only it.
      const lm = modelOf(closet);
      lm.log = [{ id: 'lg_rs1', at: Date.UTC(2026, 10, 9, 12), kind: 'merge', source: 'tech.json', counts: { added: 2, changed: 1, removed: 0, conflicts: 0 }, mode: 'two-way' }];
      const lOn = reportSheet(lm, null, { sections: allOn });
      const lOff = reportSheet(lm, null, { sections: Object.assign({}, allOn, { log: false }) });
      const hs = cut(lOn).map(([h]) => h);
      ok('a network with a log: its section after Changes', hs.indexOf('Network log') === hs.indexOf('Changes since the last back-up') + 1, show(hs));
      ok('and its tick takes out only it', show(cut(lOn).filter(([h]) => h !== 'Network log')) === show(cut(lOff)));
      ok('off by default', !reportSheet(lm, null, {}).includes('<h2>Network log</h2>'));
    }
    {
      // A network with a problem report and a visit (docs/SCOPE.md step 4):
      // the Problems and visits tick prints them after Changes, before the
      // Network log, the visit read from the log by id.
      const im = modelOf(closet);
      im.incidents = [{ id: 'inrs1', at: Date.UTC(2026, 10, 9, 9), status: 'visited', symptom: 'internet', nodeIds: [], text: 'Nothing loads.',
        reporter: { name: 'Ana', phone: '555-1' }, routedTo: [], visits: ['lg_rsv', 'lg_gone'] }];
      im.log = [{ id: 'lg_rsv', at: Date.UTC(2026, 10, 9, 12), kind: 'visit', incidentId: 'inrs1', providerId: 'pX', provider: 'Fibra', by: 'Juan', outcome: 'fixed', notes: 'New cable.' }];
      const iOn = reportSheet(im, null, { sections: allOn });
      const iOff = reportSheet(im, null, { sections: Object.assign({}, allOn, { incidents: false }) });
      const hs = cut(iOn).map(([h]) => h);
      ok('a network with a report: Problems and visits after Changes, before the Network log',
         hs.indexOf('Problems and visits') === hs.indexOf('Changes since the last back-up') + 1 && hs.indexOf('Network log') === hs.indexOf('Problems and visits') + 1, show(hs));
      ok('it prints the words, the reporter, the visit and its notes, and says a visit it does not hold',
         iOn.includes('Nothing loads.') && iOn.includes('Ana · 555-1') && iOn.includes('Visit by Juan (Fibra)') && iOn.includes('New cable.') && iOn.includes('A visit recorded elsewhere.'));
      ok('its tick takes out only it', show(cut(iOn).filter(([h]) => h !== 'Problems and visits')) === show(cut(iOff)));
      ok('off by default', !reportSheet(im, null, {}).includes('<h2>Problems and visits</h2>'));
    }
    // A diagram too big for the text goes on a landscape page of its own;
    // its tick takes that page as well.
    const big = modelOf(() => cloneData(templatesData[Object.keys(templatesData).sort()[0]]));
    const bigImg = { url: img.url, width: 6000, height: 800, scale: 1 };
    const away = reportSheet(big, bigImg, { sections: allOn });
    const noAway = reportSheet(big, bigImg, { sections: Object.assign({}, allOn, { diagram: false }) });
    ok('a diagram on a page of its own goes with the Topology tick', reportDiagramLayout(bigImg, big.counts.devices).kind === 'sheet'
       && away.includes('class="sheet land"') && !noAway.includes('class="sheet land"') && !noAway.includes('<h2>Topology</h2>'));
    ok('while the Large map, asked for, still prints', reportSheet(big, bigImg, { sections: Object.assign({}, allOn, { diagram: false }), largeMap: true }).includes('class="sheet land'));
    const capNone = reportSheet(cm, null, { sections: Object.assign({}, allOn, { capAddresses: false, capPorts: false, capPoe: false }) });
    ok('nothing in Capacity ticked: no Capacity heading', !capNone.includes('<h2>Capacity</h2>') && reportSheet(cm, null, { sections: allOn }).includes('<h2>Capacity</h2>'));
    const bare = reportSheet(modelOf(() => cloneData(templatesData[Object.keys(templatesData).sort()[0]])), img, { sections: allOff });
    ok('everything off: the Summary and Scope and method, no other heading', show(cut(bare).slice(1).map(([h]) => h)) === show(['Summary', 'Scope and method']), show(cut(bare).map(([h]) => h)));

    // ---- 4. the binder ----
    const entries = [{ id: 'c1', name: 'Closet', updated: 1, doc: closet() }, { id: 'c2', name: 'Spare', updated: 1, doc: portsOnly() }];
    const binder = binderModel(entries, { site: 'Estate', client: '', engineer: '', ref: '', date: '', scope: '' });
    const bDefault = binderHtml(binder, {});
    ok('a binder with nothing said prints the defaults: no Ports table', bDefault === binderHtml(binder, {}, { technical: true, sections: {} })
       && !bDefault.includes('<h3>Ports</h3>') && (bDefault.match(/<h2>Capacity<\/h2>/g) || []).length === 1);
    ok('and with it ticked, each site\'s table', (binderHtml(binder, {}, { technical: true, sections: { capPorts: true } }).match(/<h3>Ports<\/h3>/g) || []).length === 2);
    const bNoDev = binderHtml(binder, {}, { technical: true, sections: { devices: false, cables: false } });
    ok('a binder\'s sections reach every site\'s sheet', (bDefault.match(/<h2>Device inventory<\/h2>/g) || []).length === 2
       && !bNoDev.includes('<h2>Device inventory</h2>') && !bNoDev.includes('<h2>Connections</h2>') && bNoDev.includes('<h2>Estate addressing</h2>'));

    // ---- 5. buildSiteReport, dated ----
    replaceDocument(closet(), { origin: 'file' });
    const heldCapture = window.captureReportDiagram;
    window.captureReportDiagram = async () => null;
    try {
      const meta = normalizeReportMeta({ site: 'Closet', date: '2024-01-15' });
      const built = await buildSiteReport(meta, { technical: true, sections: { devices: false, capPorts: true } });
      const dated = reportModel(meta);
      ok('the dialog\'s sections reach the built report', !built.html.includes('<h2>Device inventory</h2>') && built.html.includes('<h3>Ports</h3>')
         && built.html.includes('<h2>Connections</h2>'));
      ok('and a dated report counts to its date as before', built.html.includes(`<b>${dated.counts.devices}</b><span>Devices</span>`) && built.meta.date === '2024-01-15', built.meta.date);
    } finally { window.captureReportDiagram = heldCapture; }

    // ---- 6. the dialog ----
    const d = closet();
    d.searches = [{ id: 'sq_rs', name: 'Every PC', query: 'type:pc', print: true }];
    replaceDocument(d, { origin: 'file' });
    openReportDialog();
    const ticks = () => [...document.querySelectorAll('#reportSectionsList [data-section]')];
    ok('a tick per section, the Address history\'s too', show(ticks().map((c) => c.dataset.section)) === show(KEYS));
    ok('each starting from its default', ticks().every((c) => c.checked === def[c.dataset.section]));
    ok('readReportParts reads them as the defaults', show(readReportParts().sections) === show(def));
    const tick = (key) => ticks().find((c) => c.dataset.section === key);
    tick('devices').checked = false; tick('devices').dispatchEvent(new Event('change', { bubbles: true }));
    tick('capPorts').checked = true; tick('capPorts').dispatchEvent(new Event('change', { bubbles: true }));
    const read = readReportParts().sections;
    ok('an unticked one and a ticked one reach readReportParts', read.devices === false && read.capPorts === true && read.history === false, show(read));
    ok('the row shows with Technical details', !el('reportSectionsRow').classList.contains('hidden') && !el('reportSearchesRow').classList.contains('hidden'));
    tick('searches').checked = false; tick('searches').dispatchEvent(new Event('change', { bubbles: true }));
    ok('the saved-search ticks hide with the Saved searches section', el('reportSearchesRow').classList.contains('hidden'));
    tick('searches').checked = true; tick('searches').dispatchEvent(new Event('change', { bubbles: true }));
    ok('and come back with it', !el('reportSearchesRow').classList.contains('hidden'));
    el('reportTechnical').checked = false; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('the row hides with Technical details', el('reportSectionsRow').classList.contains('hidden') && el('reportSearchesRow').classList.contains('hidden'));
    el('reportTechnical').checked = true; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('and shows again with it', !el('reportSectionsRow').classList.contains('hidden'));
    setLocale('es');
    renderReportDialog();
    const esTick = tick('devices');
    ok('a language switch rewords the ticks and keeps them', !esTick.checked && tick('capPorts').checked
       && esTick.parentElement.textContent.includes('Inventario de dispositivos'), esTick.parentElement.textContent);
    setLocale('en');
    renderReportDialog();
    closeReportDialog();
    openReportDialog();
    ok('nothing is kept between openings', ticks().every((c) => c.checked === def[c.dataset.section]));
    closeReportDialog();
    openReportDialog('binder');
    ok('the binder dialog lists them too', ticks().length === KEYS.length && !el('reportSectionsRow').classList.contains('hidden'));
    closeReportDialog();
    // Phone widths (44px ticks, the list wrapping, no horizontal scroll) are
    // checked in the Playwright pass at 360, 390 and 1280, not here: the
    // instrumented page cannot frame a second copy of itself.

    // ---- 7. words ----
    const words = REPORT_SECTIONS.filter((s) => !s.reserved).map((s) => s.label)
      .concat(['Sections', 'Untick a section to leave it out of the technical details. The summary does not change.', 'The nearly full switches only; Switch ports lists every port.',
        'Switches and access points with few or no free ports left.']);
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const missing = words.filter((w) => !window.CarinoI18N.has(loc, w));
      ok(`every tick's words in ${loc}`, !missing.length, show(missing));
    });

    // ---- 8. pinned to the output from before the ticks ----
    // FNV-1a and length of each report, as js/report.js printed them before
    // REPORT_SECTIONS (the Ports table then always printed). A change to a
    // template or to what a report says changes these on purpose: take them
    // again then, from the code before that change.
    // Taken again for document v18 (several providers per item, inherited
    // per service): bank and hospital name two providers on their edge
    // firewall, and the devices of callcenter, datacenter and imaging that
    // name a provider of their own now also list their group's provider of
    // another service.
    const GOLD = {
    bank: ['6db1518a:34269', '9f660fdc:31567', '87be14b6:37361'],
    bank_simple: ['4cbc5acd:30308', '5ad7d3d4:28479', '5d0d6954:34273'],
    callcenter: ['349ae468:46351', '79f3f9d2:42821', 'de73cf8c:48615'],
    callcenter_simple: ['10bb7a54:33414', '654ce373:31298', '8e0a2761:37092'],
    campus: ['566b9018:38211', '344e78d1:35649', 'c13cb769:41443'],
    campus_simple: ['eeef9155:33191', '1b9c0f26:31255', '4a19cc0e:37049'],
    datacenter: ['4ec1cadd:58885', '8980fe50:55107', '4825bddc:60901'],
    datacenter_simple: ['6a860c30:31898', 'c8c83dac:30187', '519b18d2:35981'],
    errors: ['54db3a2f:33979', '37b9eded:31026', 'b88a55eb:36820'],
    errors_simple: ['957e7dbc:26359', 'dd7494ce:24586', 'cd97b70c:30380'],
    factory: ['a5d5bce7:33142', '34ccda28:30766', '69212bbe:36560'],
    factory_simple: ['50d279b1:31571', '21287f2f:29536', 'e62954ef:35330'],
    hospital: ['f0bfe455:39274', '80c6cab2:36273', 'bef52c9e:42067'],
    hospital_simple: ['78288263:35582', '5493d4df:33351', '7e38d559:39145'],
    hotel: ['4aa89791:40890', 'f928ca4e:38026', '5c549808:43820'],
    hotel_simple: ['849d5e5:32521', 'e97f3e1b:30410', 'cf59aa07:36204'],
    house: ['a15e7cdf:28956', '1bdfd127:27162', 'af501519:32956'],
    house_simple: ['9a2c600b:25418', 'c0b7319:24048', 'f169ba35:29842'],
    imaging: ['1d4cd6b9:53927', 'd1436e27:49516', '9f6eaa2b:55310'],
    imaging_simple: ['e055bd4f:31514', 'e7457325:29549', '17e36c81:35343'],
    military: ['cd1b629e:46075', 'd6d22480:43367', '87309776:49161'],
    military_simple: ['577e0e8:31427', 'cf592765:29418', 'e1205503:35212'],
    offlineBalanced: ['7c2aa11a:31251', 'd52ceda9:29661', 'ad20ece9:35455'],
    offlineBalanced_simple: ['c705a004:29589', 'd2f9296c:27921', '6dacdd7c:33715'],
    offlineExtended: ['8183d6ab:35006', 'fb101643:33192', '54bb8597:38986'],
    offlineExtended_simple: ['503a57c5:30633', '9bd412f5:28885', 'a7a5d6ed:34679'],
    offlineLean: ['ed0f0216:27143', '2563f85d:25814', 'c1961759:31608'],
    offlineLean_simple: ['e857fe8a:24349', '3bd517d4:23067', '73565e5c:28861'],
    retail: ['83a6e51d:38038', '7e643697:35378', '611dd77:41172'],
    retail_simple: ['d8027c20:34471', '3882838c:32364', '7eed02b6:38158'],
    // Taken again for VLAN stage 2a: the Showcase's Studio trunk (its port
    // map's Untagged/Tagged columns and the VLANs section); with the old
    // Showcase the old values still held.
    showcase: ['ddaf8482:100595', '398748e0:93857', '302f7742:99651'],
    studio: ['b3a1e73c:31495', '3f21a462:29207', '616d6598:35001'],
    studio_simple: ['c933c253:31350', '8bd85b47:29427', '7e9cb7d3:35221'],
    vessel: ['e3a49522:36993', 'e57e12f0:34570', 'f66b0548:40364'],
    vessel_simple: ['40da83e7:33604', 'ffadf2f:31583', '6440097b:37377'],
    warehouse: ['f5aae43:36069', 'f6299047:33753', 'f431bd39:39547'],
    warehouse_simple: ['4c3f7c:31518', '4a011b87:29503', '3a6cf767:35297'],
    };
    const fnv = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x.toString(16) + ':' + str.length; };
    const goldImg = { url: 'data:image/png;base64,AAAA', width: 3000, height: 2000, scale: 1 };
    const RealDate = window.Date;
    const at = new RealDate('2026-11-05T12:00:00').getTime();
    window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(at); } static now() { return at; } };
    const goldOff = [];
    try {
      Object.keys(templatesData).sort().forEach((k) => {
        replaceDocument(cloneData(templatesData[k]), { origin: 'file' });
        const m = reportModel();
        const ex = { sections: { capPorts: true } };
        const got = [reportHtml(m, null, Object.assign({ summary: true, technical: true }, ex)),
          reportHtml(m, goldImg, Object.assign({ technical: true }, ex)),
          reportHtml(m, goldImg, Object.assign({ technical: true, largeMap: true }, ex))].map(fnv);
        if (show(got) !== show(GOLD[k])) goldOff.push(`${k} ${got.join(' ')}`);
      });
    } finally { window.Date = RealDate; }
    ok(`every template's report is the one printed before the ticks (${Object.keys(GOLD).length} templates, 3 reports each)`,
       !goldOff.length && Object.keys(GOLD).length === Object.keys(templatesData).length, show(goldOff));

    // ---- 9. the review's fixes ----
    const capOnly = reportSheet(cm, null, { sections: { capPorts: true, ports: false } });
    const capBoth = reportSheet(cm, null, { sections: { capPorts: true } });
    ok('a Ports table without Switch ports does not point at it', capOnly.includes('<h3>Ports</h3>') && !capOnly.includes('<h2>Switch ports</h2>')
       && !capOnly.includes('under Switch ports') && capOnly.includes('Switches and access points with few or no free ports left.</p>')
       && capBoth.includes('Every port of every switch is under Switch ports.'));
    const largeOnly = reportSheet(big, bigImg, { sections: { diagram: false }, largeMap: true });
    const largeNote = t('A large map is at the end: an overview with each sheet marked, then {n} landscape sheets.', { n: reportDiagramLayout(bigImg, big.counts.devices, { large: true }).tiles.length });
    ok('the Large map with Topology unticked still says it is at the end', largeOnly.includes(escapeHtml(largeNote)) && largeOnly.includes('<h2>Topology</h2>')
       && !largeOnly.includes('class="figure"') && !reportSheet(big, bigImg, { sections: { diagram: false } }).includes('<h2>Topology</h2>'));
    const COVER = { findings: 'Findings across the estate', addressing: 'Estate addressing', diagram: 'Estate topology' };
    const coverOn = binderCoverSheet(binder, reportSections({}));
    const coverWrong = Object.entries(COVER).filter(([key, head]) => {
      const off = binderCoverSheet(binder, reportSections({ [key]: false }));
      return !coverOn.includes(`<h2>${head}</h2>`) || off.includes(`<h2>${head}</h2>`)
        || Object.values(COVER).some((h) => h !== head && !off.includes(`<h2>${h}</h2>`));
    });
    ok('the binder cover\'s estate findings, addressing and topology follow their ticks', !coverWrong.length && coverOn === binderCoverSheet(binder), show(coverWrong));
    const bCover = binderHtml(binder, {}, { technical: true, sections: { findings: false, addressing: false, diagram: false } });
    ok('and the binder passes its ticks to the cover', !Object.values(COVER).some((h) => bCover.includes(`<h2>${h}</h2>`)) && bCover.includes('<h2>Sites</h2>'));
    ok('a report shows changes with the summary or the Changes tick', reportShowsChanges(reportParts({}))
       && reportShowsChanges(reportParts({ summary: true, technical: false })) && reportShowsChanges(reportParts({ summary: true, sections: { changes: false } }))
       && !reportShowsChanges(reportParts({ technical: true, sections: { changes: false } })));
    replaceDocument(closet(), { origin: 'file' });
    const heldCap = window.captureReportDiagram, heldSnap = window.takeSnapshot, heldLib = state.libraryId, heldRO = state.readOnly;
    const snaps = [];
    window.captureReportDiagram = async () => null;
    window.takeSnapshot = (id, kind) => { snaps.push(`${id}:${kind}`); };
    try {
      state.libraryId = 'rs_kept'; state.readOnly = false;
      const keptOn = await buildSiteReport(null, { technical: true });
      const keptOff = await buildSiteReport(null, { technical: true, sections: { changes: false } });
      const keptSum = await buildSiteReport(null, { summary: true, technical: true, sections: { changes: false } });
      if (keptOn.onKept) keptOn.onKept();
      ok('a site report with Changes moves the baseline when handed over', snaps.join() === 'rs_kept:report', snaps.join());
      ok('without Changes (and no summary) it does not', keptOff.onKept === null && typeof keptSum.onKept === 'function');
      state.libraryId = heldLib;
      const heldEntries = window.libraryEntries;
      window.libraryEntries = () => entries.map((e) => Object.assign({}, e, { doc: cloneData(e.doc) }));
      try {
        snaps.length = 0;
        const bOn = await buildBinderReport({}, { images: false, parts: { technical: true } });
        const bOff = await buildBinderReport({}, { images: false, parts: { technical: true, sections: { changes: false } } });
        const bSum = await buildBinderReport({}, { images: false, parts: { summary: true, technical: true, sections: { changes: false } } });
        bOn.onKept();
        ok('the binder likewise', snaps.join() === 'c1:report,c2:report' && bOff.onKept === null && typeof bSum.onKept === 'function', snaps.join());
      } finally { window.libraryEntries = heldEntries; }
    } finally {
      window.captureReportDiagram = heldCap; window.takeSnapshot = heldSnap; state.libraryId = heldLib; state.readOnly = heldRO;
    }
  } catch (e) {
    ok('suite ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  } finally {
    setDialogResponder(heldResponder);
    setLocale('en');
  }

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
