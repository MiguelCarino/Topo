// The two shared readers behind a cable's length and every schema field read
// from text (js/model.js): cableLengthShown, a length as its field opens on
// it, and fromTextResult, a reader's null as a parser's { error }. What is
// held here:
//   1. cableLengthShown on its own: a length kept as "8 ft" opens as its
//      number in its unit; one an older file wrote some other way ("15
//      feet", "2,5 m", a bare "3") as it is written, on metres, and marked
//      as old text; nothing is nothing, on metres;
//   2. every place that opens a length on it: the side panel, the table's
//      length column (its unit, what it edits, an old text left alone but a
//      typed seed over it stored), and the bulk panel (mixed, and an old
//      text they all share left alone);
//   3. fromTextResult on its own and through every parser that uses it: the
//      bulk panel, the table's upkeep and length cells, and CSV's;
//   4. a cables.csv read back: the same words on the same cable are no
//      change whether or not they parse. Before, only words the parser
//      refused were let through, so an old "15 feet" exported and imported
//      unchanged came back a change to "15 ft", and Apply rewrote it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(null);
  const savedView = state.settings.view;
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
  const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
  const lab = (lengths) => ({ v: DOC_VERSION,
    networks: [{ id: 'n1', cidr: '10.0.0.0/24', gateway: '10.0.0.1' }],
    nodes: [
      { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 0, portCount: 8, interfaces: [] },
      { id: 'a', type: 'pc', name: 'PC-A', x: -200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] },
      { id: 'b', type: 'pc', name: 'PC-B', x: -100, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] },
      { id: 'c', type: 'pc', name: 'PC-C', x: 100, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24' }] },
      { id: 'd', type: 'pc', name: 'PC-D', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.13/24' }] }
    ],
    links: ['a', 'b', 'c', 'd'].map((n, i) => ({ id: `l${i + 1}`, source: 'sw', target: n, sourceIface: `p${i + 1}`, targetIface: 'i1',
      cable: { label: `C-0${i + 1}`, length: lengths[i] } })) });
  const open = (lengths) => { replaceDocument(lab(lengths), { origin: 'file' }); initHistory(); };
  const len = (id) => cableOf(getLink(id), 'length');
  const table = () => { setView('table'); showTableTab('cables'); };
  const lenCol = () => TV_COLS.cables.find((c) => c.key === 'cable:length');
  const cellOf = (key) => el('tableView').querySelector(`tr[data-row="l:${key}"] td[data-col="cable:length"]`);

  try {
    // ---- 1: cableLengthShown ----
    ok('"8 ft" opens as its number, in feet', show(cableLengthShown('8 ft')) === show({ text: '8', unit: 'ft', legacy: false }), show(cableLengthShown('8 ft')));
    ok('"2.5 m" as 2.5 in metres', show(cableLengthShown('2.5 m')) === show({ text: '2.5', unit: 'm', legacy: false }), show(cableLengthShown('2.5 m')));
    const old = ['15 feet', 'about 3', '2,5 m', '3m', '3'].filter((v) => show(cableLengthShown(v)) !== show({ text: v, unit: 'm', legacy: true }));
    ok('an old free-text length opens as written, on metres, marked old', !old.length, show(old.map(cableLengthShown)));
    ok('nothing is nothing, on metres, and not old text', show(cableLengthShown('')) === show({ text: '', unit: 'm', legacy: false })
       && show(cableLengthShown(null)) === show({ text: '', unit: 'm', legacy: false }) && show(cableLengthShown(undefined)) === show({ text: '', unit: 'm', legacy: false }));
    ok('blank space is not old text either', cableLengthShown('  ').legacy === false);

    // ---- 2: where a length opens ----
    open(['8 ft', '15 feet', '3', 'about 3']);
    select('l1', 'link');
    ok('the panel shows "8 ft" as 8, feet picked', el('propCableLength').value === '8' && el('propCableUnit').value === 'ft', el('propCableLength').value + ' ' + el('propCableUnit').value);
    select('l2', 'link');
    ok('and "15 feet" as written, metres picked', el('propCableLength').value === '15 feet' && el('propCableUnit').value === 'm', el('propCableLength').value + ' ' + el('propCableUnit').value);
    open(['8 ft', '15 metres', '3', 'about 3']);
    select('l2', 'link');
    el('propCableUnit').value = 'ft'; el('propCableUnit').dispatchEvent(new Event('change'));
    ok('an old "15 metres" with the pick moved is stored in the unit it names, and shown so', len('l2') === '15 m'
       && el('propCableLength').value === '15' && el('propCableUnit').value === 'm', show([len('l2'), el('propCableLength').value, el('propCableUnit').value]));
    selectEntries([]);

    open(['8 ft', '15 feet', '3', 'about 3']);
    table();
    const row = (id) => rowByKey(`l:${id}`);
    ok('the table\'s length column: "8 ft" is 8 in feet', lenCol().unitOf(row('l1')) === 'ft' && lenCol().edit(row('l1')) === '8',
       show([lenCol().unitOf(row('l1')), lenCol().edit(row('l1'))]));
    ok('"15 feet" is as written, in metres', lenCol().unitOf(row('l2')) === 'm' && lenCol().edit(row('l2')) === '15 feet',
       show([lenCol().unitOf(row('l2')), lenCol().edit(row('l2'))]));
    startEdit(cellOf('l3'));
    ok('a bare "3" from an older file opens as old text', !!_tv.editor && _tv.editor.legacy === '3', _tv.editor && show(_tv.editor.legacy));
    finishEdit('enter');
    ok('and left as it opened, it stays as written', len('l3') === '3', len('l3'));
    startEdit(cellOf('l3'), '3');
    ok('a seed typed over it is no old text', !!_tv.editor && _tv.editor.legacy === undefined);
    finishEdit('enter');
    ok('so the same "3" typed is stored as a length', len('l3') === '3 m', len('l3'));
    startEdit(cellOf('l1'));
    ok('a length kept the new way is no old text either', !!_tv.editor && _tv.editor.legacy === undefined && _tv.editor.el.value === '8' && _tv.editor.unitEl.value === 'ft');
    cancelEdit(true);

    resetBulkDraft();
    selectEntries([{ type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    ok('bulk over mixed lengths: the field empty, metres picked, nothing asked', el('bulkF-cable.length').value === '' && el('bulkU-cable.length').value === 'm'
       && show(readBulkEdits('link')) === '{}', show([el('bulkF-cable.length').value, el('bulkU-cable.length').value, readBulkEdits('link')]));
    resetBulkDraft();
    open(['15 feet', '15 feet', '3', 'about 3']);
    selectEntries([{ type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    ok('an old text they all share opens as written, metres picked, and asks nothing', el('bulkF-cable.length').value === '15 feet'
       && el('bulkU-cable.length').value === 'm' && show(readBulkEdits('link')) === '{}', show(readBulkEdits('link')));
    resetBulkDraft();
    selectEntries([]);

    // ---- 3: fromTextResult ----
    ok('a date read: "03/2019" is 2019-03', show(fromTextResult(looseDateFromText, '03/2019')) === show({ value: '2019-03' }), show(fromTextResult(looseDateFromText, '03/2019')));
    ok('and "nope" is refused', show(fromTextResult(looseDateFromText, 'nope')) === show({ error: true }));
    ok('an interval: "1 year" is 12 months', show(fromTextResult(serviceMonthsFromText, '1 year')) === show({ value: 12 }));
    ok('a length: the unit goes to the reader', show(fromTextResult(cableLengthFromText, '8', 'ft')) === show({ value: '8 ft' })
       && show(fromTextResult(cableLengthFromText, '8')) === show({ value: '8 m' }), show(fromTextResult(cableLengthFromText, '8', 'ft')));
    ok('a unit written wins over the one passed', show(fromTextResult(cableLengthFromText, '8 m', 'ft')) === show({ value: '8 m' }));
    ok('nothing long is refused', show(fromTextResult(cableLengthFromText, '0')) === show({ error: true }));
    ok('a reader that reads 0 or blank has read something', show(fromTextResult(() => 0, 'x')) === show({ value: 0 })
       && show(fromTextResult(() => '', 'x')) === show({ value: '' }) && show(fromTextResult(() => undefined, 'x')) === show({ error: true }));
    const inService = TV_COLS.devices.find((c) => c.key === 'inService');
    ok('the table\'s upkeep cell: blank and "—" are unset', show(inService.parse('')) === show({}) && inService.parse('').value === undefined && !inService.parse('').error
       && inService.parse('—').value === undefined && !inService.parse('—').error);
    ok('and a date is read, a word refused', inService.parse(' 03/2019 ').value === '2019-03' && inService.parse('nope').error === true);
    ok('the table\'s length cell: blank is no length', show(lenCol().parse('')) === show({ value: '' }) && show(lenCol().parse('  ')) === show({ value: '' }));
    ok('"—" is refused there, not blanked', show(lenCol().parse('—')) === show({ error: true }));
    ok('a number with no unit given is metres', show(lenCol().parse('25', null, {})) === show({ value: '25 m' }) && show(lenCol().parse('25', null, 'ft')) === show({ value: '25 ft' }));
    const bLen = bulkFields('link').find((bf) => bf.key === 'cable.length');
    ok('the bulk panel reads a length by its schema row', show(bulkParse(bLen, '2,5')) === show({ value: '2.5 m' }) && show(bulkParse(bLen, 'about')) === show({ error: true }));
    ok('CSV reads a length in metres', show(CSV_PARSERS['lk:cable.length']('2,5')) === show({ value: '2.5 m' }) && CSV_PARSERS['lk:cable.length']('nope').error === true);
    ok('CSV reads a bond', show(CSV_PARSERS['if:bond']('802.3ad n1 n2')) === show({ value: { mode: '802.3ad', members: ['n1', 'n2'] } })
       && CSV_PARSERS['if:bond']('nope').error === true, show(CSV_PARSERS['if:bond']('802.3ad n1 n2')));
    ok('CSV reads the service dates', show(CSV_PARSERS.inService('03/2019')) === show({ value: '2019-03' }) && CSV_PARSERS.serviceEvery('1 year').value === 12 && CSV_PARSERS.serviced('nope').error === true);
    ok('and still knows a date column by its reader', csvIsDateKey('inService') === true);

    // ---- 4: cables.csv read back ----
    const lengthChanges = (plan) => plan.rows.flatMap((r) => r.changes).filter((c) => c.field === 'Length');
    open(['15 feet', '2,5 m', 'about 3', '8 ft']);
    let plan = planOf('cable_id,cable_length\nl1,15 feet\n');
    ok('"15 feet" over the same "15 feet" is no change', plan.rows[0].status === 'same' && !lengthChanges(plan).length, show(plan.rows[0]));
    applyCsvPlan(plan);
    ok('and applied, it stays as written', len('l1') === '15 feet', len('l1'));
    plan = planOf('cable_id,cable_length\nl2,"2,5 m"\n');
    ok('nor is "2,5 m" over itself', plan.rows[0].status === 'same' && !lengthChanges(plan).length, show(plan.rows[0]));
    applyCsvPlan(plan);
    ok('and it stays as written too', len('l2') === '2,5 m', len('l2'));
    plan = planOf('cable_id,cable_length\nl1,15 ft\n');
    ok('"15 ft" over it is a change', plan.rows[0].status === 'change' && show(lengthChanges(plan).map((c) => [c.before, c.after])) === show([['15 feet', '15 ft']]), show(plan.rows[0]));
    open(['8 m', '15 feet', 'about 3', '8 ft']);
    plan = planOf('cable_id,cable_length\nl1,9 m\nl1,8 m\n');
    ok('two rows on one cable, "9 m" then the "8 m" it holds, are a conflict', plan.rows[0].status === 'change' && plan.rows[1].status === 'conflict' && /9 m/.test(plan.rows[1].why), show(plan.rows.map((r) => [r.status, r.why])));
    plan = planOf('cable_id,cable_length\nl2,9 m\nl2,15 feet\n');
    ok('as are "9 m" then the old "15 feet" it holds', plan.rows[1].status === 'conflict', show(plan.rows.map((r) => [r.status, r.why])));
    open(['15 feet', '2,5 m', 'about 3', '8 ft']);
    plan = planOf('cable_id,cable_length\nl3,about 3\n');
    ok('"about 3" over "about 3" is no change', plan.rows[0].status === 'same', show(plan.rows[0]));
    plan = planOf('cable_id,cable_length\nl3,about 4\n');
    ok('"about 4" over it is refused', plan.rows[0].status === 'conflict' && /about 4/.test(plan.rows[0].why), show(plan.rows[0]));
    plan = planOf('cable_id,cable_length\nl4,8\n');
    ok('a bare "8" over "8 ft" is a change to metres', plan.rows[0].status === 'change' && show(lengthChanges(plan).map((c) => c.after)) === show(['8 m']), show(plan.rows[0]));

    open(['15 feet', '2,5 m', '3m', '3']);
    const before = show(serializeDoc().links);
    plan = planOf(csvText(csvCablesSheet()));
    ok('cables.csv exported and imported unchanged is no change at all', plan.rows.every((r) => r.status === 'same') && plan.counts.conflict === 0 && !lengthChanges(plan).length,
       show(plan.rows.map((r) => [r.status, r.changes, r.why])));
    applyCsvPlan(plan);
    ok('and applied, every old length stays as written', show(serializeDoc().links) === before && ['l1', 'l2', 'l3', 'l4'].map(len).join('|') === '15 feet|2,5 m|3m|3',
       ['l1', 'l2', 'l3', 'l4'].map(len).join('|'));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    cancelEdit(true);
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
