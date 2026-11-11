// Lansweeper asset CSV to Topo (js/importers/lansweeper.js; docs/SCOPE.md
// step 6, D114, amendment 34), on tests/fixtures/import/lansweeper.csv
// (hand-written: Windows PCs and a server, a printer, a laptop in stock, an
// ESXi host that is broken with a placeholder serial, an unnamed asset, a
// phone with a plain location, a camera with a bad address, day-first dates,
// a local admin password column). Covered: detection (and Topo's own
// spreadsheets are never taken), types from asset type and OS, maker, model,
// serial (placeholders dropped), OS with its version, description as notes,
// Building and Location as nested groups (a "a / b" path too), a plain
// location as the location text, the state map with the original in a
// column, purchase date as in service, warranty and last seen as date
// columns, dates whose order the column settles and ambiguous ones left
// empty with a note, passwords never read, unread columns said, ids from
// AssetID (a re-import changes nothing), and a merge into a sample by MAC.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const enc = (name, text) => ({ name, text, bytes: new TextEncoder().encode(text) });
  try {
    const I = TopoImporters, C = TopoImportCommon;
    const node = (doc, name) => doc.nodes.find((n) => n.name === name);
    const f = enc('lansweeper.csv', await (await fetch('tests/fixtures/import/lansweeper.csv')).text());
    ok('detected as Lansweeper, by nothing else', I.sniff(f).importer === 'lansweeper' && I.list().filter((x) => x.detect(f) > 0.5).length === 1,
      JSON.stringify(I.sniff(f)) + I.list().filter((x) => x.detect(f) > 0.5).map((x) => x.id));
    const r = I.parse('lansweeper', [f]);
    const d = r.doc;
    const col = (name) => (d.columns.find((c) => c.name === name) || {}).id;
    const pc = node(d, 'CONTA-PC03'), srv = node(d, 'SRV-FILES'), pr = node(d, 'IMPRESORA-RECEPCION'), lap = node(d, 'LAPTOP-VIEJA'), esx = node(d, 'ESXI-01'), tel = node(d, 'TEL-RECEPCION'), cam = node(d, 'CAMARA-PATIO');
    ok('every named asset is a device; the unnamed one is listed', d.nodes.length === 7 && r.warnings.some((w) => w.code === 'row-no-name' && w.row === 7), JSON.stringify(r.warnings));
    ok('types: PC, Windows Server, printer, VMware host, phone, camera', pc.type === 'pc' && srv.type === 'server' && pr.type === 'printer' && esx.type === 'server' && tel.type === 'voip' && cam.type === 'camera');
    ok('maker, model, serial, OS with version, notes', pc.vendor === 'Dell Inc.' && pc.model === 'OptiPlex 7010' && pc.serial === '7XK2M93' && pc.os === 'Windows 11 Pro 23H2' && pc.notes === 'Contabilidad');
    ok('a placeholder serial is dropped', !esx.serial);
    ok('address and MAC on an interface (no subnet known: /32, said)', pc.interfaces[0].ip === '192.168.50.33/32' && pc.interfaces[0].mac === '3C:A9:F4:00:33:01' && r.notes.some((x) => x.code === 'no-prefix'));
    const bA = d.groups.find((g) => g.name === 'Edificio A'), p2 = d.groups.find((g) => g.name === 'Piso 2'), room = d.groups.find((g) => g.name === 'Cuarto de servidores' && g.parent && d.groups.find((x) => x.id === g.parent).name === 'Planta Baja');
    ok('Building and Location as nested groups, kinds from their words', bA && bA.kind === 'building' && p2 && p2.kind === 'floor' && p2.parent === bA.id && pc.group === p2.id, JSON.stringify(d.groups));
    ok('a location written as a path', room && srv.group === room.id);
    ok('a plain location with no building is the location text', tel.location === 'Bodega' && !tel.group);
    ok('states: Active, Stock and Broken retired, Planned', pc.status === 'active' && lap.status === 'retired' && esx.status === 'retired' && tel.status === 'planned');
    ok('an unusual state is kept in a column', lap.extra[col('Lansweeper state')] === 'Stock' && !(pc.extra || {})[col('Lansweeper state')]);
    ok('dates day-first, settled by the column: in service, warranty, last seen', pc.inService === '2024-03-15' && pc.extra[col('Warranty')] === '2027-03-15' && pc.extra[col('Last seen')] === '2026-11-10'
      && d.columns.find((c) => c.name === 'Warranty').kind === 'date', JSON.stringify(pc));
    ok('department as a column', pc.extra[col('Department')] === 'Finanzas');
    ok('a bad address is listed', r.warnings.some((w) => w.code === 'ip-bad' && w.row === 9));
    ok('the admin password is never read; the user name column is said', !/Sup3r/.test(JSON.stringify(d)) && r.notes.some((x) => x.code === 'secrets' && x.params.n === 1)
      && r.notes.some((x) => x.code === 'columns-not-read' && /Username/.test(x.params.list)), JSON.stringify(r.notes));
    ok('ids from AssetID with the site\'s tag', /^ls-[0-9a-z]{6}-1001$/.test(pc.id));
    ok('the result is a document the editor reads', isDocShape(d) && canonicalDoc(d).nodes.length === 7);

    // Dates whose order nothing settles.
    const amb = I.parse('lansweeper', [enc('ls.csv', 'AssetName,AssetType,Purchasedate\nA,Windows,03/04/2024\nB,Windows,05/06/2023\nC,Windows,2022-01-31\n')]);
    ok('ambiguous dates are left empty and said; ISO ones are read', !node(amb.doc, 'A').inService && node(amb.doc, 'C').inService === '2022-01-31'
      && amb.notes.some((x) => x.code === 'dates-ambiguous' && x.params.column === 'Purchasedate'), JSON.stringify(amb.notes));
    const mdy = C.dateColumn(['12/31/2026', '01/02/2026']);
    ok('month-first when a second part is over 12', mdy.order === 'mdy' && mdy.read('01/02/2026') === '2026-01-02');

    // Topo's own devices sheet is never Lansweeper's.
    const sheet = CSV_SHEETS.find((s) => s.key === 'devices');
    if (sheet) { const sf = enc('devices.csv', csvText(sheet.build())); ok('Topo\'s devices sheet goes to Spreadsheet', I.sniff(sf).kind === 'topo-csv' && !(I.get('lansweeper').detect(sf) > 0.5)); }

    persistLibrary({});
    replaceDocument(I.withoutTransientIds(d), { origin: 'file' });
    const plan = planMerge(serializeDoc(), I.parse('lansweeper', [f]).doc, null);
    ok('the same export merged again adds no device', !plan.items.some((it) => it.kind === 'nodes' && !it.mineId), JSON.stringify(plan.counts));

    const mine = canonicalDoc(templatesData.house);
    const target = mine.nodes.find((n) => n.type !== 'cloud' && (n.interfaces || []).length);
    target.interfaces[0].mac = '00:14:38:AA:BB:20';
    const plan2 = planMerge(mine, d, null);
    ok('the printer matches the sample\'s device by MAC', plan2.items.some((it) => it.kind === 'nodes' && it.mineId === target.id && it.matchedBy === 'mac'));
    ok('no transient id survives the merge', !/"imp-/.test(JSON.stringify(applyMergePlan(mine, plan2, {}).doc)));
    // Two assets that had the same address (DHCP), each with its own id and MAC.
    const same = enc('same-ip.csv', 'AssetID,AssetName,AssetType,IPAddress,Mac\n101,PC-A,Windows,10.1.1.50,3C:A9:F4:00:00:0A\n102,PC-B,Windows,10.1.1.50,3C:A9:F4:00:00:0B\n');
    const sr = I.parse('lansweeper', [same]);
    ok('two assets with the same address are two devices', ['PC-A', 'PC-B'].every((n) => node(sr.doc, n)) && sr.doc.nodes.length === 2, sr.doc.nodes.map((n) => n.name).join(','));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
