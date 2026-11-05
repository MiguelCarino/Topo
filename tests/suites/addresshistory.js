// Address history, stage 5: the technical sheet's optional 'Address history'
// section (docs/BACKLOG.md feature 5; the owner's call on 2026-11-05, "Do
// build optional address history"; js/trail.js trailReportHistory, js/report.js
// addressHistorySection). Asserted here:
//   1. off by default: a kept network with a trail prints byte for byte the
//      report it printed before (the default, history:false said, and the
//      sheet with a history model but the tick off all the same), no heading;
//   2. ticked: the heading after Changes and before Scope and method, the
//      lead naming the previous report's date, per device the value now
//      (since its first point) then each past one with its dates and kind:
//      an address per NIC, a MAC, a replug as Switch port, a group by its
//      path, a rename; a value typed since the last point reads as now; a
//      change older than the previous report and a device that never changed
//      left out; a removed device last, with the date it went; no report
//      point yet: the whole trail, the lead naming the first point;
//   3. no heading: an empty trail (a kept network with nothing recorded), a
//      network not kept, a read-only one; a trail with no change in the
//      window says nothing has changed;
//   4. the Simple summary never gains it, ticked or not; summary-only none;
//   5. the binder: off by default, ticked each site's sheet reads its own
//      card's trail;
//   6. print-safe: no link, no outside URL, names escaped;
//   7. the dialog: the tick, off, with its note, read by readReportParts;
//   8. the words in es, pt-BR, ja and ru, and the section in Spanish;
//   9. review fixes: a device deleted since the newest point says it went
//      after that point; a removed device's NICs numbered; a value typed back
//      after a point that held none reads as now once; a swapped NIC shows
//      the new address beside the removed ones, each numbered; one canonical
//      pass per call; a hand-over with the history but not Changes notes a
//      report point and leaves the Changes baseline alone.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const T = window.CarinoTrail;
  const L = window.CarinoLibrary;
  const { LIBRARY_KEY, BINDER_EXPORT_KEY } = L;
  const held = [LIBRARY_KEY, BINDER_EXPORT_KEY, SETTINGS_KEY].map((k) => [k, localStorage.getItem(k)]);
  const heldLib = L.loadLibrary();
  const heldTrailSetting = state.settings.trailRecording;
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : undefined));
  const heldCapture = window.captureReportDiagram;
  const heldRO = state.readOnly;
  const day = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  const D1 = day(2026, 3, 2), D2 = day(2026, 6, 10), D3 = day(2026, 9, 14);

  // One network at three points: a back-up (D1), a report (D2), a back-up (D3).
  const base = () => ({
    v: DOC_VERSION,
    nodes: [
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 }, interfaces: [] },
      { id: 'pc', type: 'pc', name: 'PC-1', x: 100, y: 200, group: 'r3',
        interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24', mac: 'aa-bb-cc-00-11-22' }] },
      { id: 'cam', type: 'camera', name: 'CAM-01', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.77/24' }] },
      { id: 'tv', type: 'tv', name: 'Lobby TV', x: 300, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.60/24' }] },
      { id: 'prn', type: 'printer', name: 'Printer <b>2</b>', x: 400, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.90/24' }] }
    ],
    links: [
      { id: 'a', source: 'sw', target: 'pc', sourceIface: 'p12', targetIface: 'i1' },
      { id: 'b', source: 'sw', target: 'cam', sourceIface: 'p5', targetIface: 'i1' }
    ],
    groups: [{ id: 'b1', name: 'Building A', kind: 'building' }, { id: 'r3', name: 'Rack 3', kind: 'rack', parent: 'b1' },
      { id: 'r4', name: 'Rack 4', kind: 'rack', parent: 'b1' }],
    networks: [{ id: 'lan', cidr: '192.168.1.0/24', name: 'LAN' }]
  });
  const node = (d, id) => d.nodes.find((n) => n.id === id);
  // D1: as base, the camera called CAM-01 (renamed before the report).
  const at1 = base;
  const at2 = () => { const d = base(); node(d, 'cam').name = 'CAM-03'; return d; };
  // D3: the PC re-addressed, its NIC swapped, replugged and moved to Rack 4;
  // the printer removed.
  const at3 = () => {
    const d = at2();
    const pc = node(d, 'pc');
    pc.interfaces[0].ip = '192.168.1.21/24';
    pc.interfaces[0].mac = 'aa-bb-cc-00-11-99';
    pc.group = 'r4';
    d.links.find((l) => l.id === 'a').sourceIface = 'p13';
    d.nodes = d.nodes.filter((n) => n.id !== 'prn');
    return d;
  };
  // Today, after D3: the PC renamed and not yet backed up.
  const today = () => { const d = at3(); node(d, 'pc').name = 'PC-1b'; return d; };

  const rows = (html) => {
    const sec = sectionOf(html);
    if (!sec) return [];
    const box = document.createElement('div');
    box.innerHTML = sec;
    return [...box.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
  };
  const sectionOf = (html) => {
    const i = html.indexOf('<h2>Address history</h2>');
    if (i < 0) return '';
    const j = html.indexOf('<h2>', i + 5);
    return html.slice(i, j < 0 ? undefined : j);
  };
  const build = (parts) => buildSiteReport(null, parts).then((b) => b.html);

  try {
    setLocale('en');
    persistLibrary({});
    window.captureReportDiagram = async () => null;
    state.readOnly = null;
    delete state.settings.trailRecording;

    replaceDocument(today(), { origin: 'file' });
    const id = L.claimDocument('Clínica', null);
    ok('a kept network', !!id && isKept());
    ok('three points recorded', T.recordPoint(id, 'backup', at1(), D1) && T.recordPoint(id, 'report', at2(), D2) && T.recordPoint(id, 'backup', at3(), D3));

    // ---- 1. off by default ----
    const dflt = await build({ technical: true });
    const saidOff = await build({ technical: true, sections: { history: false } });
    ok('the default report has no Address history', !dflt.includes('Address history') && !dflt.includes('addrhist'));
    ok('and is byte for byte the one with the tick said off', dflt === saidOff);
    const both = await build({ summary: true, technical: true });
    ok('both parts likewise', !both.includes('Address history'));
    const m = reportModel();
    const hist = T.trailReportHistory(id, serializeDoc());
    const withModel = reportSheet(Object.assign({}, m, { history: hist }), null, {});
    ok('a model carrying a history prints nothing of it with the tick off', withModel === reportSheet(m, null, {}) && !!hist);
    ok('the default sections leave it off', reportParts().sections.history === false && reportParts({}).sections.history === false);
    // The report's stylesheet is unchanged: the section borrows the inventory's row rules.
    ok('no new stylesheet rule', !reportStyles().includes('addrhist'));

    // ---- 2. ticked ----
    const on = await build({ technical: true, sections: { history: true } });
    const sec = sectionOf(on);
    ok('ticked: the heading prints', !!sec);
    // (No Changes heading here: the trail was recorded with no baseline.
    // Section 9 checks the place right after Changes.)
    const hs = on.match(/<h2>[^<]*<\/h2>/g) || [];
    ok('after the other sections, right before Scope and method',
      hs.indexOf('<h2>Address history</h2>') > -1 && hs.indexOf('<h2>Address history</h2>') === hs.indexOf('<h2>Scope and method</h2>') - 1, show(hs));
    ok('the lead names the previous report and says this browser',
      sec.includes('Recorded in this browser at each back-up and report since the report of 2026-06-10: the addresses, MACs, switch ports, groups and names that changed, with the dates each was seen.'), sec.slice(0, 400));
    const r = rows(on);
    const names = r.filter((x) => x[0]).map((x) => x[0]);
    ok('the PC first, the removed printer last; the camera (renamed before the report) and the TV (never changed) left out',
      show(names) === show(['PC-1b', 'Printer <b>2</b>removed on 2026-09-14']), show(names));
    const block = (label) => {
      const i = r.findIndex((x) => x[1] === label);
      if (i < 0) return [];
      const outRows = [r[i]];
      for (let j = i + 1; j < r.length && !r[j][1] && !r[j][0]; j++) outRows.push(r[j]);
      return outRows.map((x) => `${x[2]} | ${x[3]}`);
    };
    ok('an address per NIC: now since its first point, the past one with its dates and kind',
      show(block('Address (eth0)')) === show(['192.168.1.21/24 | since 2026-09-14', '192.168.1.20/24 | 2026-03-02 → 2026-06-10 report']), show(block('Address (eth0)')));
    ok('the MAC in colons', show(block('MAC (eth0)')) === show(['AA:BB:CC:00:11:99 | since 2026-09-14', 'AA:BB:CC:00:11:22 | 2026-03-02 → 2026-06-10 report'])
      || show(block('MAC (eth0)')).toLowerCase() === show(['aa:bb:cc:00:11:99 | since 2026-09-14', 'aa:bb:cc:00:11:22 | 2026-03-02 → 2026-06-10 report']), show(block('MAC (eth0)')));
    ok('a replug as Switch port, by the switch and port',
      show(block('Switch port')) === show(['SW · Gi1/0/13 | since 2026-09-14', 'SW · Gi1/0/12 | 2026-03-02 → 2026-06-10 report']), show(block('Switch port')));
    const g = block('Group');
    ok('a group moved, by its path', g.length === 2 && /Rack 4/.test(g[0]) && /since 2026-09-14/.test(g[0]) && /Rack 3/.test(g[1]) && /2026-03-02 → 2026-06-10/.test(g[1]), show(g));
    const nm = block('Name');
    ok('a rename typed since the last point reads as now, the recorded name below it',
      show(nm) === show(['PC-1b | now', 'PC-1 | 2026-03-02 → 2026-09-14 back-up']), show(nm));
    const prnAt = r.findIndex((x) => /^Printer/.test(x[0]));
    const prn = r.slice(prnAt).map((x) => `${x[1]} | ${x[2]} | ${x[3]}`);
    ok('the removed device lists what it held, with no value now',
      prn.includes('Address | 192.168.1.90/24 | 2026-03-02 → 2026-06-10 report') && prn.includes('Name | Printer <b>2</b> | 2026-03-02 → 2026-06-10 report'), show(prn));
    ok('the camera\'s old name (before the report) is not printed', !sec.includes('CAM-01') && !sec.includes('CAM-03'));
    ok('the rows read as blocks: the inventory\'s row rules, a device\'s first row ruled',
      sec.includes('<table class="inv addrhist">') && (sec.match(/<tr class="dev">/g) || []).length === 2);

    // No report point yet: the whole trail, from the first point.
    const id2 = L.claimDocument('Clínica 2', null);
    ok('a second card', !!id2 && id2 !== id && state.libraryId === id2);
    T.recordPoint(id2, 'backup', at1(), D1); T.recordPoint(id2, 'backup', at2(), D2);
    const noRep = await build({ technical: true, sections: { history: true } });
    const sec2 = sectionOf(noRep);
    ok('no report point yet: the lead names the first point',
      sec2.includes('Recorded in this browser at each back-up and report since 2026-03-02: the addresses, MACs, switch ports, groups and names that changed'), sec2.slice(0, 300));
    const r2 = rows(noRep);
    ok('and the whole trail is read: the camera\'s rename shows', r2.some((x) => x[0] === 'CAM-03') && r2.some((x) => x[2] === 'CAM-01'), show(r2));

    // ---- 3. no heading ----
    const id3 = L.claimDocument('Clínica 3', null);
    ok('a third card, nothing recorded', !!id3 && !T.hasTrail(id3));
    const empty = await build({ technical: true, sections: { history: true } });
    ok('an empty trail: no heading', !empty.includes('Address history') && T.trailReportHistory(id3, serializeDoc()) === null);
    const kept = state.libraryId;
    state.libraryId = null;
    const notKept = await build({ technical: true, sections: { history: true } });
    ok('a network not kept: no heading', !notKept.includes('Address history'));
    state.libraryId = id;
    state.readOnly = { doc: serializeDoc() };
    const ro = await build({ technical: true, sections: { history: true } });
    ok('a read-only one: no heading', !ro.includes('Address history'));
    state.readOnly = null;
    state.libraryId = kept;
    // A trail with no change in the window: the heading and a plain line.
    T.recordPoint(id3, 'report', serializeDoc(), D1); T.recordPoint(id3, 'backup', serializeDoc(), D2);
    const same = sectionOf(await build({ technical: true, sections: { history: true } }));
    ok('nothing changed since the report: the heading and "Nothing has changed since then."',
      !!same && same.includes('since the report of 2026-03-02') && same.includes('<p>Nothing has changed since then.</p>') && !same.includes('<table'), same);

    // ---- 4. the Simple summary ----
    state.libraryId = id;
    const sumOnly = await build({ summary: true, technical: false, sections: { history: true } });
    ok('a summary-only report never prints it', !sumOnly.includes('Address history') && !sumOnly.includes('192.168.1.20'));
    const sumBoth = await build({ summary: true, technical: true, sections: { history: true } });
    const sumOff = await build({ summary: true, technical: true });
    const sumPart = (html) => html.slice(0, html.indexOf('<h1>Network documentation report</h1>'));
    ok('the summary sheet is the same with it ticked', sumPart(sumBoth) === sumPart(sumOff) && sumBoth.includes('<h2>Address history</h2>'));

    // ---- 5. the binder ----
    flushAutosave();
    const heldEntries = window.libraryEntries;
    const entries = libraryEntries().filter((e) => e.id === id || e.id === id2);
    window.libraryEntries = () => entries.map((e) => Object.assign({}, e, { doc: cloneData(e.doc) }));
    try {
      const bOff = await buildBinderReport({}, { images: false, parts: { technical: true } });
      ok('a binder: off by default', !!bOff && !bOff.html.includes('Address history'));
      const bOn = await buildBinderReport({}, { images: false, parts: { technical: true, sections: { history: true } } });
      const heads = (bOn.html.match(/<h2>Address history<\/h2>/g) || []).length;
      ok('ticked: each site its own section', heads === 2, String(heads));
      const sheets = bOn.html.split('<div class="sheet"').filter((s) => s.includes('<h2>Address history</h2>'));
      const one = sheets.find((s) => s.includes('since the report of 2026-06-10'));
      const two = sheets.find((s) => s.includes('since 2026-03-02:'));
      ok('each sheet reads its own card\'s trail', !!one && !!two && sectionOf(one).includes('since 2026-09-14') && !sectionOf(two).includes('2026-09-14')
        && sectionOf(two).includes('CAM-01') && !sectionOf(one).includes('CAM-01'),
        show(sheets.map((x) => sectionOf(x).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300))));
    } finally { window.libraryEntries = heldEntries; }

    // ---- 6. print-safe ----
    ok('print-safe: no link and no outside URL in the section', !/<a\b|https?:|url\(|src=/i.test(sec), sec.match(/<a\b|https?:|url\(|src=/i));
    ok('names are escaped', sec.includes('Printer &lt;b&gt;2&lt;/b&gt;') && !sec.includes('Printer <b>2</b>'));

    // ---- 7. the dialog ----
    openReportDialog();
    const tick = document.querySelector('#reportSectionsList [data-section="history"]');
    ok('the dialog has an Address history tick, off', !!tick && tick.checked === false && /^Address history/.test(tick.parentElement.textContent));
    ok('with its note', !!tick && tick.parentElement.querySelector('.dlg-dim').textContent === 'What each device held at earlier back-ups and reports, from this browser. Networks kept here only.');
    ok('readReportParts reads it off', readReportParts().sections.history === false);
    tick.checked = true; tick.dispatchEvent(new Event('change', { bubbles: true }));
    ok('and on once ticked', readReportParts().sections.history === true);
    closeReportDialog();
    openReportDialog();
    ok('off again on the next opening', document.querySelector('#reportSectionsList [data-section="history"]').checked === false);
    closeReportDialog();

    // ---- 8. words ----
    const words = ['Address history', 'What each device held at earlier back-ups and reports, from this browser. Networks kept here only.',
      'Recorded in this browser at each back-up and report since the report of {date}: the addresses, MACs, switch ports, groups and names that changed, with the dates each was seen.',
      'Recorded in this browser at each back-up and report since {date}: the addresses, MACs, switch ports, groups and names that changed, with the dates each was seen.',
      'removed on {date}', 'Field', 'Value', 'Seen', 'Address', 'MAC', 'Switch port', 'Group', 'Name', 'Device', 'now', 'since {date}', '{from} → {to}',
      'back-up', 'report', 'file', 'removed interface', 'Nothing has changed since then.',
      'removed after {date}', 'interface {n}', 'removed interface {n}'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const missing = words.filter((w) => !window.CarinoI18N.has(loc, w));
      ok(`every word in ${loc}`, !missing.length, show(missing));
    });
    setLocale('ja');
    const ja = words.map((w) => t(w)).join(' ');
    ok('Japanese never says コンピューター', !ja.includes('コンピューター'));
    setLocale('es');
    const es = await build({ technical: true, sections: { history: true } });
    ok('the section in Spanish', es.includes('<h2>Historial de direcciones</h2>') && es.includes('desde el informe del 2026-06-10') && es.includes('eliminado el 2026-09-14'));
    setLocale('en');

    // ---- 9. review fixes: removals since the last point, NIC labels, a
    // value typed back, a swapped NIC, a history-only hand-over ----
    {
      const D4 = day(2026, 10, 1);
      const nic = (id, name, ip) => ({ id, name, ip });
      const docAt = (step) => {
        const pcIfaces = step < 4 ? [nic('i1', 'eth0', '10.0.2.20/24'), nic('i2', 'eth1', '10.0.2.30/24')] : [nic('i3', 'eth2', '10.0.2.21/24')];
        const apIp = step <= 2 ? '10.0.3.5/24' : step === 3 ? '10.0.3.6/24' : step === 4 ? '' : '10.0.3.6/24';
        const nodes = [
          { id: 'tv', type: 'tv', name: 'Lobby TV', x: 0, y: 0, interfaces: [nic('i1', 'eth0', '10.0.1.60/24')] },
          { id: 'nas', type: 'server', name: 'NAS', x: 100, y: 0, interfaces: [nic('i1', 'eth0', '10.0.0.5/24'), nic('i2', 'eth1', '10.0.1.5/24')] },
          { id: 'ap', type: 'pc', name: 'AP-1', x: 200, y: 0, interfaces: [nic('i1', 'eth0', apIp)] },
          { id: 'pc2', type: 'pc', name: 'PC-2', x: 300, y: 0, interfaces: pcIfaces }
        ];
        // Today (step 5): the TV and the NAS deleted since the last point.
        return { v: DOC_VERSION, nodes: step === 5 ? nodes.filter((n) => n.id !== 'tv' && n.id !== 'nas') : nodes, links: [], groups: [],
          networks: [{ id: 'n0', cidr: '10.0.0.0/16', name: 'LAN' }] };
      };
      replaceDocument(docAt(5), { origin: 'file' });
      const idR = L.claimDocument('Clínica R', null);
      ok('review: a fourth card, four points', !!idR && T.recordPoint(idR, 'backup', docAt(1), D1) && T.recordPoint(idR, 'report', docAt(2), D2)
        && T.recordPoint(idR, 'backup', docAt(3), D3) && T.recordPoint(idR, 'backup', docAt(4), D4));
      const onR = await build({ technical: true, sections: { history: true } });
      const rr = rows(onR);
      const blockOf = (dev, label) => {
        const i = rr.findIndex((x) => x[0].startsWith(dev));
        if (i < 0) return [];
        let j = i;
        const outRows = [];
        for (; j < rr.length && (j === i || !rr[j][0]); j++) {
          if (rr[j][1] === label) { outRows.push(rr[j]); for (let k = j + 1; k < rr.length && !rr[k][0] && !rr[k][1]; k++) outRows.push(rr[k]); break; }
        }
        return outRows.map((x) => `${x[2]} | ${x[3]}`);
      };
      const heads = rr.filter((x) => x[0]).map((x) => x[0]);
      ok('review: a device deleted since the last point says it went after that point, listed last',
        show(heads) === show(['AP-1', 'PC-2', 'Lobby TVremoved after 2026-10-01', 'NASremoved after 2026-10-01']), show(heads));
      const nasLabels = rr.slice(rr.findIndex((x) => x[0].startsWith('NAS'))).map((x) => x[1]).filter(Boolean);
      ok('review: a removed device\'s NICs are told apart', show(nasLabels) === show(['Address (interface 1)', 'Address (interface 2)', 'Name']), show(nasLabels));
      ok('review: a value typed back after a point that held none reads as now, once',
        show(blockOf('AP-1', 'Address (eth0)')) === show(['10.0.3.6/24 | now', '10.0.3.5/24 | 2026-03-02 → 2026-06-10 report']), show(blockOf('AP-1', 'Address (eth0)')));
      const pcLabels = rr.slice(rr.findIndex((x) => x[0] === 'PC-2'), rr.findIndex((x) => x[0].startsWith('Lobby'))).map((x) => x[1]).filter(Boolean);
      ok('review: a swapped NIC shows the new address beside the removed ones, each numbered',
        show(pcLabels) === show(['Address (eth2)', 'Address (removed interface 1)', 'Address (removed interface 2)']), show(pcLabels));
      ok('review: the new NIC\'s address, since its first point', show(blockOf('PC-2', 'Address (eth2)')) === show(['10.0.2.21/24 | since 2026-10-01']), show(blockOf('PC-2', 'Address (eth2)')));
      ok('review: the removed NICs\' addresses', show(blockOf('PC-2', 'Address (removed interface 1)')) === show(['10.0.2.20/24 | 2026-03-02 → 2026-09-14 back-up'])
        && show(blockOf('PC-2', 'Address (removed interface 2)')) === show(['10.0.2.30/24 | 2026-03-02 → 2026-09-14 back-up']), show(rr));

      // One canonical pass per call.
      const heldCanon = window.canonicalDoc;
      let calls = 0;
      window.canonicalDoc = function (d) { calls++; return heldCanon.apply(this, arguments); };
      try { T.trailReportHistory(idR, serializeDoc()); } finally { window.canonicalDoc = heldCanon; }
      ok('review: the document is made canonical once per history', calls === 1, String(calls));

      // A hand-over with the history but not Changes: a trail point, the
      // Changes baseline left where it was.
      const snapBefore = JSON.stringify(snapshotOf(idR));
      const pointsBefore = T.trailOf(idR).points.length;
      const noChanges = await buildSiteReport(null, { technical: true, sections: { changes: false } });
      ok('review: neither Changes nor the history: nothing recorded on hand-over', noChanges.onKept === null);
      const histOnly = await buildSiteReport(null, { technical: true, sections: { changes: false, history: true } });
      ok('review: the history without Changes records on hand-over', typeof histOnly.onKept === 'function');
      histOnly.onKept();
      const pts = T.trailOf(idR).points;
      ok('review: one report point noted in the trail', pts.length === pointsBefore + 1 && pts[pts.length - 1].kind === 'report', show(pts));
      ok('review: the Changes baseline unmoved', JSON.stringify(snapshotOf(idR)) === snapBefore);
      const next = sectionOf(await build({ technical: true, sections: { history: true } }));
      ok('review: the next report\'s history counts from that hand-over',
        next.includes(`since the report of ${localDateOf(pts[pts.length - 1].at)}`) && !next.includes('since the report of 2026-06-10'), next.slice(0, 300));
      // With a Changes baseline: the section right after Changes.
      ok('review: a baseline taken', takeSnapshot(idR, 'report', docAt(4)));
      const withCh = await build({ technical: true, sections: { history: true } });
      const hs2 = withCh.match(/<h2>[^<]*<\/h2>/g) || [];
      const chAt = hs2.findIndex((h) => /^<h2>Changes since the last/.test(h));
      ok('review: the section right after Changes, before Scope and method',
        chAt > -1 && hs2[chAt + 1] === '<h2>Address history</h2>' && hs2[chAt + 2] === '<h2>Scope and method</h2>', show(hs2));
      setLocale('es');
      ok('review: the new words in Spanish', t('removed after {date}', { date: 'X' }) === 'eliminado después del X' && t('interface {n}', { n: 2 }) === 'interfaz 2');
      setLocale('en');
    }
  } catch (e) {
    ok('suite ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  } finally {
    setLocale('en');
    window.captureReportDiagram = heldCapture;
    state.readOnly = heldRO;
    if (heldTrailSetting === undefined) delete state.settings.trailRecording; else state.settings.trailRecording = heldTrailSetting;
    setDialogResponder(heldResponder);
    persistLibrary(heldLib);
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
