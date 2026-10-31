// The spreadsheet import, where it used to lose or garble what it was given
// without saying so (js/csv.js). What is held here:
//   1. a cable's free-text length from before lengths were metres or feet
//      ("about 3"): cables.csv writes it as it is, and read back on the same
//      cable it is no change, so a sheet relabelled in Excel applies; other
//      words, or the words on a new cable, are still refused, and a real
//      length is still read;
//   2. a file's encoding: UTF-8 with or without a BOM, UTF-16 by its BOM,
//      and Windows-1252 (Excel's "CSV (Comma delimited)") when the bytes are
//      not UTF-8, so "Ubicación" stays itself and its heading is found; the
//      review says when Windows-1252 was used, translated, and stops saying
//      so once a sheet is pasted over the file; in Russian the fallback is
//      Windows-1251 and in Japanese Shift_JIS, as Excel saves there;
//   3. dates: a column's order (day first or month first) is decided by the
//      whole column, whatever the page's language, for the service dates
//      and the network's own date columns, a new one included; a column
//      that does not say is read by the language and the review says how;
//      one that says both is left to its cells, and the review says so;
//      ISO dates, years and months read as they did;
//   4. new devices with no id that share a name are one device, each row's
//      NIC its own interface, so a cable to that name finds it; another
//      serial, type or location keeps a row its own device, and so does a
//      randomised MAC (a client list); ids, and names seen on the wire,
//      still keep rows apart; rows naming a device on the map still meet
//      on it; the review lists the names it joined.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  // A check whose function may not be there (before the fix) fails, not the suite.
  const tryOk = (n, fn) => { try { const r = fn(); ok(n, r === true, r === true ? '' : JSON.stringify(r)); } catch (e) { ok(n, false, e && e.message); } };
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(() => null);
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
  const planOf = (text, mapping) => { const s = sheetOf(text); return csvPlan(s, mapping || csvAutoMap(s)); };
  const byName = (name) => state.nodes.filter((n) => n.name === name);
  const notes = (plan) => (plan.notes || []).join(' | ');
  const wait = async (test, tries = 200) => { for (let i = 0; i < tries && !test(); i++) await new Promise((r) => setTimeout(r, 10)); return test(); };

  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }],
    columns: [{ id: 'c1', name: 'Warranty until', kind: 'date' }],
    nodes: [
      { id: 'sw', type: 'switch', name: 'SW-1', x: 300, y: 100, portCount: 8, interfaces: [] },
      { id: 'pc1', type: 'pc', name: 'PC-1', x: 200, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] },
      { id: 'pc2', type: 'pc', name: 'PC-2', x: 300, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24' }] },
      { id: 'pc3', type: 'pc', name: 'PC-3', x: 400, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.13/24' }] }
    ],
    links: [
      { id: 'l1', source: 'sw', target: 'pc1', sourceIface: 'p1', targetIface: 'i1', cable: { label: 'A-01', length: 'about 3' } },
      { id: 'l2', source: 'sw', target: 'pc2', sourceIface: 'p2', targetIface: 'i1', cable: { label: 'A-02', length: '2 m' } }
    ] });
  const open = () => { replaceDocument(lab(), { origin: 'file' }); initHistory(); };

  try {
    // ---- 1: a free-text cable length ----
    open();
    const cab = csvCablesSheet();
    const at = (h) => cab.headers.indexOf(h);
    const r1 = cab.rows.find((r) => r[0] === 'l1');
    ok('cables.csv writes an old length as it is', r1[at('cable_length')] === 'about 3', show(r1));
    // Relabelled in a spreadsheet, every cable's label, and read back.
    const edited = { headers: cab.headers, rows: cab.rows.map((r) => r.map((c, i) => (i === at('cable_label') ? c.replace('A-', 'B-') : c))) };
    let plan = planOf(csvText(edited));
    const row1 = plan.rows.find((r) => r.linkId === 'l1');
    ok('the same words on the same cable are no change, so its new label applies', !!row1 && row1.status === 'change'
       && show(row1.changes.map((c) => c.after)) === show(['B-01']) && plan.counts.conflict === 0, show(plan.rows));
    applyCsvPlan(plan);
    ok('applied: the labels change and the old length stays as written', cableOf(getLink('l1'), 'label') === 'B-01'
       && cableOf(getLink('l1'), 'length') === 'about 3' && cableOf(getLink('l2'), 'label') === 'B-02' && cableOf(getLink('l2'), 'length') === '2 m',
       show([getLink('l1').cable, getLink('l2').cable]));
    plan = planOf('cable_id,cable_length\nl1,about 4\n');
    ok('other words on that cable are still refused', plan.rows[0].status === 'conflict' && /about 4/.test(plan.rows[0].why), show(plan.rows[0]));
    plan = planOf('cable_id,cable_length\nl2,about 3\n');
    ok('and so are the words on a cable that holds a real length', plan.rows[0].status === 'conflict', show(plan.rows[0]));
    plan = planOf('from_device,to_device,cable_length\nsw,pc3,about 3\n');
    ok('and on a new cable', plan.rows[0].status === 'conflict' && /about 3/.test(plan.rows[0].why), show(plan.rows[0]));
    plan = planOf('cable_id,cable_length\nl1,5 m\n');
    ok('a real length over the old words is still read', plan.rows[0].status === 'change' && plan.rows[0].changes[0].after === '5 m', show(plan.rows[0]));

    // ---- 2: a file's encoding ----
    // "Ubicación,Nombre" as Excel on Windows saves it: ó is the one byte F3.
    const ansi = Uint8Array.from([...'Name,Ubicaci'].map((c) => c.charCodeAt(0)).concat([0xF3, 0x6E, 0x0A], [...'PC-1,Recepci'].map((c) => c.charCodeAt(0)), [0xF3, 0x6E, 0x0A]));
    tryOk('bytes that are not UTF-8 are read as Windows-1252', () => { const r = csvDecode(ansi.buffer); return (r.text === 'Name,Ubicación\nPC-1,Recepción\n' && r.encoding === 'windows-1252') || r; });
    const utf8 = new TextEncoder().encode('﻿Name,Ubicación\n');
    tryOk('UTF-8 is UTF-8, its BOM dropped', () => { const r = csvDecode(utf8.buffer); return (r.text === 'Name,Ubicación\n' && r.encoding === 'utf-8') || r; });
    tryOk('and without a BOM', () => { const r = csvDecode(new TextEncoder().encode('Name,Ubicación\n').buffer); return (r.text === 'Name,Ubicación\n' && r.encoding === 'utf-8') || r; });
    const u16 = new Uint8Array(2 + 2 * 'Name\tÜ\n'.length);
    u16[0] = 0xFF; u16[1] = 0xFE;
    [...'Name\tÜ\n'].forEach((c, i) => { u16[2 + 2 * i] = c.charCodeAt(0) & 0xFF; u16[3 + 2 * i] = c.charCodeAt(0) >> 8; });
    tryOk('UTF-16 by its BOM (Excel\'s "Unicode Text")', () => { const r = csvDecode(u16.buffer); return (r.text === 'Name\tÜ\n' && r.encoding === 'utf-16le') || r; });
    // Through the Open button's path, into the review.
    open();
    openCsvDialog('import');
    el('csvText').value = '';
    csvLoadFile(new File([ansi], 'excel.csv', { type: 'text/csv' }));
    const loaded = await wait(() => el('csvText').value.includes('Recepci'));
    ok('a Windows-1252 file opens with its accents', loaded && el('csvText').value.includes('Recepción') && !el('csvText').value.includes('�'), show(el('csvText').value));
    ok('and its Spanish heading is found', _csv.mapping[1] === 'location', show(_csv.mapping));
    el('csvReviewBtn').click();
    ok('the review says it was read as Windows-1252', /Windows-1252/.test(el('csvMsgs').textContent) && !el('csvMsgs').classList.contains('hidden'), el('csvMsgs').textContent);
    el('csvApplyBtn').click();
    ok('applied: the text is stored as it was written', getNode('pc1').location === 'Recepción', getNode('pc1').location);
    openCsvDialog('import');
    el('csvBackBtn').click();
    csvLoadFile(new File([new TextEncoder().encode('Name,Ubicación\nPC-2,Almacén\n')], 'utf8.csv', { type: 'text/csv' }));
    await wait(() => el('csvText').value.includes('Almac'));
    el('csvReviewBtn').click();
    ok('a UTF-8 file is not said to be Windows-1252', !/Windows-1252/.test(el('csvMsgs').textContent) && _csv.plan.counts.change === 1, el('csvMsgs').textContent);
    // Pasted over the whole box, the text is the clipboard's: the file's
    // code page is no longer said. Pasted into the file's text, it still is.
    const pasteOver = async (text, whole) => {
      const box = el('csvText');
      box.focus();
      if (whole) box.select(); else box.setSelectionRange(box.value.length, box.value.length);
      box.dispatchEvent(new Event('paste'));
      box.value = whole ? text : box.value + text;
      box.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 300));
    };
    el('csvBackBtn').click();
    csvLoadFile(new File([ansi], 'excel.csv', { type: 'text/csv' }));
    await wait(() => el('csvText').value.includes('Recepci'));
    await pasteOver('PC-3,Recepción\n', false);
    el('csvReviewBtn').click();
    ok('a row pasted into a Windows-1252 file still says how the file was read', /Windows-1252/.test(el('csvMsgs').textContent), el('csvMsgs').textContent);
    el('csvBackBtn').click();
    await pasteOver('Name,Ubicación\nPC-2,Almacén\n', true);
    el('csvReviewBtn').click();
    ok('a sheet pasted over the whole box is not said to be Windows-1252', !/Windows-1252/.test(el('csvMsgs').textContent) && _csv.plan.counts.change === 1, el('csvMsgs').textContent);
    closeCsvDialog();
    setLocale('es');
    ok('the note is translated', typeof CSV_ANSI_NOTE === 'string' && t(CSV_ANSI_NOTE, { encoding: 'Windows-1252' }) !== CSV_ANSI_NOTE.replace('{encoding}', 'Windows-1252')
       && /Windows-1252/.test(t(CSV_ANSI_NOTE, { encoding: 'Windows-1252' })));
    // A Russian Excel saves Windows-1251 and a Japanese one Shift_JIS: the
    // page's language picks the code page, and the note names it.
    const cp1251 = Uint8Array.from([200, 236, 255, 44, 204, 229, 241, 242, 238, 239, 238, 235, 238, 230, 229, 237, 232, 229, 10]);
    const cp932 = Uint8Array.from([150, 188, 145, 79, 44, 143, 234, 143, 138, 10]);
    setLocale('ru');
    tryOk('in Russian, bytes that are not UTF-8 are read as Windows-1251', () => { const r = csvDecode(cp1251.buffer); return (r.text === 'Имя,Местоположение\n' && r.encoding === 'windows-1251') || r; });
    open();
    openCsvDialog('import');
    el('csvText').value = '';
    // "PC-1,Склад" as a Russian Excel saves it.
    csvLoadFile(new File([cp1251, Uint8Array.from([80, 67, 45, 49, 44, 209, 234, 235, 224, 228, 10])], 'excel.csv', { type: 'text/csv' }));
    await wait(() => el('csvText').value.includes('PC-1'));
    ok('a Windows-1251 file opens in Cyrillic, its headings found', el('csvText').value.includes('Склад') && _csv.mapping[0] === 'name' && _csv.mapping[1] === 'location',
       show([el('csvText').value, _csv.mapping]));
    el('csvReviewBtn').click();
    ok('and the review says Windows-1251, in Russian', /Windows-1251/.test(el('csvMsgs').textContent) && el('csvMsgs').textContent.includes(t(CSV_ANSI_NOTE, { encoding: 'Windows-1251' }))
       && !el('csvMsgs').textContent.includes('The file is not UTF-8'), el('csvMsgs').textContent);
    closeCsvDialog();
    setLocale('ja');
    tryOk('in Japanese, they are read as Shift_JIS', () => { const r = csvDecode(cp932.buffer); return (r.text === '名前,場所\n' && r.encoding === 'shift_jis') || r; });
    setLocale('en');
    tryOk('in English, Cyrillic bytes are still read as Windows-1252', () => csvDecode(cp1251.buffer).encoding === 'windows-1252');

    // ---- 3: dates, a column at a time ----
    open();
    const dated = (text) => { const p = planOf(text); applyCsvPlan(p); return p; };
    // The page is in English, and 25/12/2019 says the column is day first.
    plan = dated('Name,In service since\nPC-1,25/12/2019\nPC-2,03/04/2019\n');
    ok('a column that says day first is read day first, in English too', getNode('pc1').inService === '2019-12-25' && getNode('pc2').inService === '2019-04-03'
       && plan.counts.conflict === 0, show([getNode('pc1').inService, getNode('pc2').inService, plan.rows.map((r) => r.why)]));
    ok('and nothing needs saying about it', !notes(plan), notes(plan));
    open();
    setLocale('es');
    plan = dated('Name,Last serviced\nPC-1,12/25/2026\nPC-2,03/04/2026\n');
    ok('one that says month first is read month first, in Spanish too', getNode('pc1').serviced === '2026-12-25' && getNode('pc2').serviced === '2026-03-04',
       show([getNode('pc1').serviced, getNode('pc2').serviced]));
    setLocale('en');
    open();
    plan = dated('Name,Warranty until\nPC-1,31/01/2027\nPC-2,02/03/2027\n');
    ok('a network\'s own date column likewise', customValueOf(getNode('pc1'), 'c1') === '2027-01-31' && customValueOf(getNode('pc2'), 'c1') === '2027-03-02',
       show([customValueOf(getNode('pc1'), 'c1'), customValueOf(getNode('pc2'), 'c1')]));
    open();
    plan = planOf('Name,In service since\nPC-1,03/04/2019\nPC-2,2019\nPC-3,05/2020\n');
    ok('a column that does not say is read by the language, and the review says how', /In service since read as month\/day/.test(notes(plan)), notes(plan));
    applyCsvPlan(plan);
    ok('years and months read as they did', getNode('pc1').inService === '2019-03-04' && getNode('pc2').inService === '2019' && getNode('pc3').inService === '2020-05',
       show([getNode('pc1').inService, getNode('pc2').inService, getNode('pc3').inService]));
    open();
    setLocale('es');
    plan = planOf('Name,In service since\nPC-1,03/04/2019\n');
    const dayMonth = 'Dates in {column} read as day/month: nothing in the column says which comes first.';
    ok('in Spanish it says day/month, in Spanish', notes(plan) === t(dayMonth, { column: 'In service since' })
       && notes(plan) !== dayMonth.replace('{column}', 'In service since'), notes(plan));
    applyCsvPlan(plan);
    ok('and reads it so', getNode('pc1').inService === '2019-04-03', getNode('pc1').inService);
    setLocale('en');
    plan = planOf('Name,In service since\nPC-1,2019-03-04\nPC-2,05/05/2019\n');
    ok('a column with nothing that reads two ways says nothing', !notes(plan), notes(plan));
    plan = planOf('Name,In service since\nPC-1,25/12/2019\nPC-2,12/25/2019\n');
    ok('one that says both is left to its cells, and the review says so', /written both day first and month first/.test(notes(plan))
       && plan.rows[0].status === 'conflict' && plan.rows[1].status === 'change', show([notes(plan), plan.rows.map((r) => r.status)]));
    plan = planOf('Name,In service since\nPC-1,25/12/2019\nPC-2,31/02/2019\n');
    ok('a date that is no date in the column\'s order is still refused, as written', plan.rows[1].status === 'conflict' && /31\/02\/2019/.test(plan.rows[1].why), show(plan.rows[1]));
    // A new column of dates: its kind is guessed from the dates as the
    // column reads them, so 25/12 in English does not make it text.
    open();
    const fresh = sheetOf('Name,Delivered\nPC-1,25/12/2025\nPC-2,03/04/2026\n');
    plan = csvPlan(fresh, ['name', CSV_NEW_COLUMN + 'Delivered']);
    ok('a new column of day-first dates is a column of dates', plan.newColumns.length === 1 && plan.newColumns[0].kind === 'date', show(plan.newColumns));
    applyCsvPlan(plan);
    const delivered = state.columns.find((c) => c.name === 'Delivered');
    ok('and its dates are read day first', !!delivered && customValueOf(getNode('pc2'), delivered.id) === '2026-04-03', delivered && customValueOf(getNode('pc2'), delivered.id));

    // ---- 4: new devices that share a name ----
    open();
    // An IPAM export: one row per address, no id.
    plan = planOf('Name,IP,MAC\nsrv1,10.0.0.50/24,00:1B:21:00:00:50\n srv1 ,10.0.0.51/24,00:1B:21:00:00:51\npc9,10.0.0.60/24,\n');
    ok('two rows naming one new device are one device to add', plan.counts.add === 2 && plan.counts.conflict === 0, show([plan.counts, plan.rows.map((r) => r.why)]));
    ok('and the review says the second row was read with the first', plan.rows[1].notes.some((n) => /Another row names srv1 too/.test(n)), show(plan.rows[1].notes));
    applyCsvPlan(plan);
    const srv = byName('srv1');
    const nics = srv.length === 1 ? srv[0].interfaces : [];
    ok('applied: one srv1, each row\'s NIC its own interface', srv.length === 1 && nics.length === 2
       && show(nics.map((i) => [i.ip, normMac(i.mac)])) === show([['10.0.0.50/24', '001B21000050'], ['10.0.0.51/24', '001B21000051']])
       && nics[0].name !== nics[1].name, show(state.nodes.filter((n) => /srv1/i.test(n.name)).map((n) => [n.name, n.interfaces])));
    plan = planOf('from_device,to_device\nSW-1,srv1\n');
    ok('a cable to srv1 then finds it', plan.rows[0].status === 'add' && plan.counts.conflict === 0, show(plan.rows[0]));
    open();
    plan = planOf('Name,IP,Switch,Port\nsrv1,10.0.0.50/24,SW-1,5\nsrv1,10.0.0.51/24,SW-1,6\npc9,10.0.0.60/24,srv1,\n');
    ok('in the same sheet too: a row cabled to srv1 is not told it names two devices', plan.counts.conflict === 0 && plan.counts.add === 2,
       show(plan.rows.map((r) => [r.status, r.why])));
    open();
    plan = planOf('Name,Serial,IP\nPrinter-X,SN1,10.0.0.70/24\nPrinter-X,SN2,10.0.0.71/24\n');
    ok('another serial keeps a row its own device, and says why', plan.counts.add === 2 && plan.rows[1].notes.some((n) => /Another row is also called Printer-X/.test(n)),
       show(plan.rows.map((r) => [r.status, r.notes])));
    plan = planOf('id,Name,IP\nnas-a,NAS,10.0.0.80/24\nnas-b,NAS,10.0.0.81/24\n');
    ok('rows with their own ids stay two devices', plan.counts.add === 2 && plan.counts.conflict === 0, show(plan.counts));
    plan = planOf('Name,Notes\nPC-1,desk\npc-1,desk\n');
    ok('rows naming a device on the map still meet on it', plan.counts.add === 0 && plan.rows.every((r) => r.nodeId === 'pc1'), show(plan.rows));
    // Names seen on the wire are not the register's (DHCP clients repeat
    // theirs): two "iPhone" leases stay two devices.
    const seen = sheetOf('ip,mac,name\n10.0.0.90/24,00:1B:21:00:00:90,iPhone\n10.0.0.91/24,00:1B:21:00:00:91,iPhone\n');
    seen.observed = true;
    plan = csvPlan(seen, ['if:ip', 'if:mac', 'name']);
    ok('names seen on the network never join rows', plan.counts.add === 2, show(plan.counts));
    // A router's client list saved as a CSV with headings is a sheet, not
    // addresses seen; its phones' randomised MACs still keep them apart.
    plan = planOf('Name,IP Address,MAC Address\niPhone,10.0.0.92/24,DA:A1:19:00:00:92\niPhone,10.0.0.93/24,7A:11:22:00:00:93\niPhone,10.0.0.94/24,00:1B:21:00:00:94\n');
    ok('rows whose MAC is randomised are devices of their own, and say why', plan.counts.add === 3
       && plan.rows[0].notes.some((n) => /randomised/.test(n)) && plan.rows[1].notes.some((n) => /randomised/.test(n)), show(plan.rows.map((r) => [r.status, r.notes])));
    // Two NICs of one box never disagree on where it is or what it is.
    plan = planOf('name,type,location\nPrinter,printer,Reception\nPrinter,printer,Lab\n');
    ok('another location keeps a row its own device, not a conflict', plan.counts.add === 2 && plan.counts.conflict === 0
       && plan.rows[1].notes.some((n) => /Another row is also called Printer/.test(n)), show(plan.rows.map((r) => [r.status, r.why, r.notes])));
    plan = planOf('name,type,IP\nbox,server,10.0.0.95/24\nbox,printer,10.0.0.96/24\n');
    ok('and so does another type', plan.counts.add === 2 && plan.counts.conflict === 0, show(plan.rows.map((r) => [r.status, r.why])));
    // Joining rows changes how many devices the sheet adds, so the review
    // says so for the whole sheet, not only on each row.
    plan = planOf('Name,IP,MAC\nsrv1,10.0.0.50/24,00:1B:21:00:00:50\nsrv1,10.0.0.51/24,00:1B:21:00:00:51\n');
    ok('the review lists the names read as one device', notes(plan) === t('Rows that share a name are read as one device each: {names}.', { names: 'srv1 (2)' }), notes(plan));
    plan = planOf('Name,IP\npc8,10.0.0.97/24\npc9,10.0.0.98/24\n');
    ok('and says nothing when no rows were joined', !notes(plan), notes(plan));
    setLocale('ja');
    ok('the notes are translated', t('Another row names {name} too: read as one device.', { name: 'srv1' }).includes('srv1')
       && t('Another row names {name} too: read as one device.', { name: 'srv1' }) !== 'Another row names srv1 too: read as one device.');
    setLocale('en');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
