// Custom columns and the Devices table's arrangement (js/model.js "Custom
// columns", js/table.js "The Columns dialog", js/csv.js). What is held here:
//   1. the model: column definitions are checked (ids, unique names, kinds),
//      values are read by their kind (a decimal comma, a date day-first but
//      in English, a date that is not one refused, yes and no in any of the
//      page's languages), and a device's value for a column the document
//      does not define is dropped on load;
//   2. the document: columns, values and the view travel through the
//      serializer and back, a v12 document opens and becomes v13, and a
//      document borrowed for a card does not take the open one's columns;
//   3. the table: a custom column is a Devices column, after Topo's, typed
//      into like any other (one undo step); hidden and moved columns are a
//      view kept in the document, Name stays first, Reset puts it back; a
//      name that is another column's or one of Topo's is refused; deleting a
//      column asks first when devices hold a value and takes the values
//      with it;
//   4. the spreadsheet: devices.csv carries the custom columns last, by
//      name, in the order they were made whatever the view says; it reads
//      back unchanged; a heading Topo has no field for can be made a new
//      column, its kind guessed from its values, and Apply is one undo step;
//   5. sharing: a custom column's text is checked for passwords, its
//      heading included;
//   6. the sentences are translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(null);
  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }],
    nodes: [
      { id: 'pc1', type: 'pc', name: 'Reception PC', x: 200, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] },
      { id: 'pc2', type: 'pc', name: 'Lab PC', x: 300, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24' }] }
    ],
    links: [] });

  try {
    // ---- 1: the model ----
    ok('the document is version 14', DOC_VERSION === 14);
    const cols = normalizeCustomColumns([
      { id: 'c1', name: '  Owner  ', kind: 'text' },
      { id: 'c2', name: 'owner', kind: 'text' },            // the same name in another case
      { id: 'c1', name: 'Again', kind: 'text' },            // the same id
      { id: 'bad id', name: 'X' },
      { id: 'c3', name: '', kind: 'number' },
      { id: 'c4', name: 'Bought', kind: 'date' },
      { id: 'c5', name: 'Cost', kind: 'money' },            // an unknown kind is text
      null, 'junk'
    ]);
    ok('definitions: unique ids and names, a name each, an unknown kind is text', show(cols) === show([
      { id: 'c1', name: 'Owner', kind: 'text' }, { id: 'c4', name: 'Bought', kind: 'date' }, { id: 'c5', name: 'Cost', kind: 'text' }]), show(cols));
    ok('the next id is past every one there is', nextCustomId(cols) === 'c6' && nextCustomId([]) === 'c1');
    const num = { kind: 'number' }, date = { kind: 'date' }, yes = { kind: 'yesno' }, text = { kind: 'text' };
    ok('a number: a decimal comma, spaces, a minus', parseCustomValue(num, '1,5').value === 1.5 && parseCustomValue(num, '1 200').value === 1200
       && parseCustomValue(num, '-3.25').value === -3.25 && parseCustomValue(num, 'ten').error);
    ok('an ISO date is a date in any language', parseCustomValue(date, '2026-03-04').value === '2026-03-04' && parseCustomValue(date, '2026/3/4').value === '2026-03-04');
    ok('in English a slashed date is month first', parseCustomValue(date, '3/4/2026').value === '2026-03-04');
    setLocale('es');
    ok('in Spanish it is day first', parseCustomValue(date, '3/4/2026').value === '2026-04-03' && parseCustomValue(date, '25/12/2026').value === '2026-12-25');
    setLocale('en');
    ok('a date that is not one is refused, not rolled over', parseCustomValue(date, '2026-02-31').error && parseCustomValue(date, 'soon').error);
    ok('yes and no in the page\'s languages', parseCustomValue(yes, 'sí').value === true && parseCustomValue(yes, 'нет').value === false
       && parseCustomValue(yes, 'maybe').error && parseCustomValue(yes, true).value === true);
    ok('blank is nothing kept; text is trimmed', parseCustomValue(text, '   ').value === undefined && parseCustomValue(text, ' Ana ').value === 'Ana');
    ok('shown and exported: yes/no as words, the rest as held', customText(yes, true) === 'yes' && customText(yes, false) === 'no' && customText(num, 1.5) === '1.5' && customText(text, undefined) === '');
    const nodes = [{ id: 'a', extra: { c1: 'Ana', c4: 'not a date', c9: 'gone', c5: 7 } }, { id: 'b', extra: { c9: 'x' } }];
    normalizeCustomRefs(nodes, cols);
    ok('on load: values for no column dropped, values the kind refuses dropped, a number in a text column kept as text', show(nodes[0].extra) === show({ c1: 'Ana', c5: '7' }) && !('extra' in nodes[1]), show(nodes));

    // ---- 2: the document ----
    const doc = Object.assign(lab(), {
      columns: [{ id: 'c1', name: 'Owner' }, { id: 'c2', name: 'Warranty until', kind: 'date' }, { id: 'c3', name: 'Leased', kind: 'yesno' }],
      tableView: { devices: { order: ['x:c2', 'os'], hidden: ['dns'] } }
    });
    doc.nodes[0].extra = { c1: 'Ana', c2: '2027-01-31', c3: true };
    replaceDocument(doc, { origin: 'file' }); initHistory();
    const saved = serializeDoc();
    ok('columns, values and the view are written', show(saved.columns) === show([{ id: 'c1', name: 'Owner' }, { id: 'c2', name: 'Warranty until', kind: 'date' }, { id: 'c3', name: 'Leased', kind: 'yesno' }])
       && show(saved.nodes[0].extra) === show({ c1: 'Ana', c2: '2027-01-31', c3: true }) && show(saved.tableView) === show({ devices: { order: ['x:c2', 'os'], hidden: ['dns'] } }), show([saved.columns, saved.tableView]));
    const asWritten = (d) => JSON.parse(JSON.stringify(d));
    ok('a device with no values writes no key', !('extra' in asWritten(saved).nodes[1]));
    replaceDocument(lab(), { origin: 'file' });
    ok('a document with no columns and no view writes no key for them', !('columns' in asWritten(serializeDoc())) && !('tableView' in asWritten(serializeDoc())));
    const v12 = lab(); v12.v = 12;
    replaceDocument(v12, { origin: 'file' });
    ok('a v12 document opens, editable, and is written as v14', !state.readOnly && serializeDoc().v === 14);
    replaceDocument(doc, { origin: 'file' }); initHistory();
    const other = Object.assign(lab(), { columns: [{ id: 'c1', name: 'Something else' }] });
    withDoc(other, () => state.nodes.length);
    canonicalDoc(other);
    ok('a document borrowed for a card or a binder leaves the open one\'s columns as they were', state.columns.length === 3 && state.columns[0].name === 'Owner' && state.tableView.devices.hidden[0] === 'dns');

    // ---- 3: the table ----
    setView('table'); showTableTab('devices');
    const keys = () => tvCols('devices').map((c) => c.key);
    ok('the saved order is the table\'s: Name first, then the order named, the rest after; a hidden column is not drawn',
       keys()[0] === 'name' && keys()[1] === 'x:c2' && keys()[2] === 'os' && !keys().includes('dns') && keys().includes('x:c1') && keys().includes('x:c3'), keys().join(','));
    ok('the header shows the user\'s name for it, as typed', [...el('tvGrid').querySelectorAll('thead th')].some((th) => th.textContent.trim().startsWith('Warranty until')));
    ok('a value shows; a yes is a tick', (() => { const tr = el('tvGrid').querySelector('tr[data-row="n:pc1"]'); return tr.querySelector('td[data-col="x:c1"]').textContent === 'Ana' && tr.querySelector('td[data-col="x:c3"]').textContent === '✓'; })());
    ok('the Columns button is on the Devices tab only', !el('tvColsBtn').classList.contains('hidden')
       && (showTableTab('cables'), el('tvColsBtn').classList.contains('hidden')) && (showTableTab('devices'), true));
    // Typed into: one undo step, checked by its kind.
    const rowOf = (id) => _tv.rows.find((r) => r.key === `n:${id}`);
    const colOf = (key) => tvCols('devices').find((c) => c.key === key);
    const undoAt = _undoStack.length;
    commitValue(rowOf('pc2'), colOf('x:c1'), colOf('x:c1').parse('  Luis ').value);
    ok('a typed value is the device\'s, in one undo step', customValueOf(getNode('pc2'), 'c1') === 'Luis' && _undoStack.length === undoAt + 1);
    ok('a value its kind refuses is refused', colOf('x:c2').parse('next year').error === true);
    commitValue(rowOf('pc2'), colOf('x:c2'), colOf('x:c2').parse('2028-05-01').value);
    commitValue(rowOf('pc1'), colOf('x:c3'), false);
    ok('a tick cleared is no value kept', customValueOf(getNode('pc1'), 'c3') === undefined && customValueOf(getNode('pc2'), 'c2') === '2028-05-01');
    undo(); undo();
    ok('undo takes them back', customValueOf(getNode('pc1'), 'c3') === true && customValueOf(getNode('pc2'), 'c2') === undefined);
    undo();
    ok('and the first', customValueOf(getNode('pc2'), 'c1') === undefined);

    // The dialog.
    el('tvColsBtn').click();
    ok('Columns opens a list of every column, Name first and fixed', !el('colsDialog').hidden
       && el('colsList').querySelector('li').dataset.key === 'name' && el('colsList').querySelector('li [data-show="name"]').disabled
       && el('colsList').querySelectorAll('li').length === TV_COLS.devices.length + 3);
    ok('a hidden column is listed, unticked', !el('colsList').querySelector('[data-show="dns"]').checked);
    const box = el('colsList').querySelector('[data-show="dns"]');
    box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
    ok('ticking shows it, in one undo step', keys().includes('dns') && !(state.tableView.devices && state.tableView.devices.hidden));
    const before = keys().indexOf('x:c2');
    el('colsList').querySelector('[data-move="1"][data-key="x:c2"]').click();
    ok('Move down moves it one place', keys().indexOf('x:c2') === before + 1 && keys()[0] === 'name', keys().join(','));
    setColumnShown('os', false);
    moveColumn('x:c3', -1);
    ok('a hidden column keeps its place for when it is shown again', tvDevicesOrder().map((c) => c.key).indexOf('os') >= 0 && !keys().includes('os'));
    el('colsResetBtn').click();
    ok('Reset order: Topo\'s order, everything shown, the custom ones last', show(serializeDoc().tableView) === undefined
       && keys().slice(-3).join(',') === 'x:c1,x:c2,x:c3' && keys().includes('os') && keys().includes('dns'), keys().join(','));
    el('colsNewName').value = 'Cost centre'; el('colsNewKind').value = 'number';
    el('colsAddBtn').click();
    ok('Add makes a column of that kind, last', state.columns.length === 4 && state.columns[3].name === 'Cost centre' && state.columns[3].kind === 'number'
       && keys()[keys().length - 1] === 'x:' + state.columns[3].id && el('colsNewName').value === '');
    const toasts = [];
    const heldToast = window.showToast;
    window.showToast = (m) => toasts.push(m);
    ok('a name another column has, in any case, is refused', addCustomColumn('owner', 'text') === null && /already/.test(toasts.pop()));
    ok('so is one of Topo\'s own, by its label or a heading the import reads', addCustomColumn('Serial number', 'text') === null && addCustomColumn('hostname', 'text') === null
       && /Topo has a column called hostname already/.test(toasts.pop()));
    ok('a rename to a taken name is refused and the name stays', renameCustomColumn('c1', 'Leased') === false && customColumnById('c1').name === 'Owner');
    window.showToast = heldToast;
    const input = el('colsList').querySelector('[data-rename="c1"]');
    input.value = 'Used by'; input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    ok('a rename is kept when the field is left; the values stay', customColumnById('c1').name === 'Used by' && customValueOf(getNode('pc1'), 'c1') === 'Ana');
    // Delete: a column with values asks first.
    const asked = [];
    setDialogResponder((req) => { asked.push(req.message); return false; });
    await deleteCustomColumn('c1');
    ok('deleting a column devices hold values in asks first; No keeps it', asked.length === 1 && /Delete the column Used by\? One device loses what it holds\./.test(asked[0]) && customColumnById('c1'), show(asked));
    setDialogResponder(() => true);
    setColumnShown('x:c1', false);
    await deleteCustomColumn('c1');
    ok('Yes deletes it, every value it held and its place in the view', !customColumnById('c1') && customValueOf(getNode('pc1'), 'c1') === undefined
       && !show(serializeDoc().tableView || {}).includes('x:c1'), show(serializeDoc().tableView));
    asked.length = 0;
    setDialogResponder((req) => { asked.push(req.message); return true; });
    const empty = addCustomColumn('Spare', 'text');
    await deleteCustomColumn(empty.id);
    ok('a column nothing is held in is deleted without a question', asked.length === 0 && !customColumnById(empty.id));
    setDialogResponder(null);
    closeColumnsDialog();
    ok('every change in the dialog was an undo step', (() => { const n = state.columns.length; undo(); const back = state.columns.length; redo(); return back === n + 1 && state.columns.length === n; })());

    // ---- 4: the spreadsheet ----
    state.tableView = normalizeTableView({ devices: { order: ['x:c3', 'x:c2'], hidden: ['os'] } }); save();
    const sheet = csvDevicesSheet();
    const at = (h) => sheet.headers.indexOf(h);
    ok('devices.csv: the custom columns last, by name, in the order they were made, whatever the view',
       sheet.headers.slice(-3).join('|') === 'Warranty until|Leased|Cost centre' && at('os') > -1, sheet.headers.join(','));
    const row1 = sheet.rows[state.nodes.findIndex((n) => n.id === 'pc1')];
    ok('their values as text: a date as ISO, a yes as yes', row1[at('Warranty until')] === '2027-01-31' && row1[at('Leased')] === 'yes', show(row1));
    const csvText = [sheet.headers].concat(sheet.rows).map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    openCsvDialog('import');
    el('csvText').value = csvText;
    _csv.headings = null; _csv.mode = null; _csv.chosen.clear();
    csvReparse(); renderCsvDialog();
    ok('reading it back maps each custom heading to its column', ['Warranty until', 'Leased', 'Cost centre'].every((h) => _csv.mapping[at(h)] === 'x:' + state.columns.find((c) => c.name === h).id), show(_csv.mapping));
    el('csvReviewBtn').click();
    ok('and changes nothing', _csv.plan.counts.change === 0 && _csv.plan.counts.add === 0 && !_csv.plan.errors.length, show(_csv.plan.counts));
    el('csvBackBtn').click();
    // A client's sheet with columns Topo does not have.
    el('csvText').value = 'Name,IP,Owner,Delivered,Floor,Leased\nReception PC,10.0.0.11/24,Ana,2025-06-01,2,yes\nNew Printer,10.0.0.40/24,Front desk,2026-01-15,1,no';
    _csv.headings = null; _csv.mode = null; _csv.chosen.clear();
    csvReparse(); renderCsvDialog();
    ok('a heading with no field is left unmapped, and offered as a new column', _csv.mapping[2] === '' && !!el('csvCol-2').querySelector(`option[value="${CSV_NEW_COLUMN}Owner"]`)
       && /New column: Owner/.test(el('csvCol-2').textContent));
    ok('a heading that is one of the network\'s columns maps to it', _csv.mapping[5] === 'x:' + state.columns.find((c) => c.name === 'Leased').id, show(_csv.mapping));
    [2, 3, 4].forEach((i) => { const s = el(`csvCol-${i}`); s.value = CSV_NEW_COLUMN + sheet_h(i); s.dispatchEvent(new Event('change', { bubbles: true })); });
    function sheet_h(i) { return ['Name', 'IP', 'Owner', 'Delivered', 'Floor', 'Leased'][i]; }
    el('csvReviewBtn').click();
    const plan = _csv.plan;
    ok('the review makes the columns, their kinds guessed from the values', show(plan.newColumns.map((c) => [c.name, c.kind])) === show([['Owner', 'text'], ['Delivered', 'date'], ['Floor', 'number']])
       && /Makes the columns: Owner \(Text\) · Delivered \(Date\) · Floor \(Number\)/.test(el('csvMsgs').textContent), show(plan.newColumns));
    ok('and lists the values as changes', plan.rows[0].status === 'change' && plan.rows[0].changes.some((c) => c.field === 'Owner' && c.after === 'Ana') && plan.rows[1].status === 'add', show(plan.rows[0]));
    ok('the new columns are not made before Apply', !state.columns.some((c) => c.name === 'Owner'));
    const undoCsv = _undoStack.length;
    el('csvApplyBtn').click();
    const owner = state.columns.find((c) => c.name === 'Owner'), bought = state.columns.find((c) => c.name === 'Delivered'), floor = state.columns.find((c) => c.name === 'Floor');
    const printer = state.nodes.find((n) => n.name === 'New Printer');
    ok('Apply makes them and fills them, a new device included', owner && bought && floor && customValueOf(getNode('pc1'), owner.id) === 'Ana'
       && customValueOf(getNode('pc1'), floor.id) === 2 && printer && customValueOf(printer, bought.id) === '2026-01-15'
       && customValueOf(printer, state.columns.find((c) => c.name === 'Leased').id) === false, show(state.columns));
    ok('in one undo step', _undoStack.length === undoCsv + 1);
    undo();
    ok('undo takes the columns and the values back', !state.columns.some((c) => c.name === 'Owner') && !state.nodes.some((n) => n.name === 'New Printer'));
    // A new column named like one of Topo's fields is an error, not a guess.
    openCsvDialog('import');
    el('csvText').value = 'Name,Notes\nReception PC,hi';
    _csv.headings = null; _csv.mode = null; _csv.chosen.clear();
    csvReparse();
    const p2 = csvPlan(csvCurrentSheet(), ['name', CSV_NEW_COLUMN + 'Notes']);
    ok('a new column may not take the name of one of Topo\'s', p2.errors.some((m) => /Topo has a column called Notes already/.test(m)), show(p2.errors));
    closeCsvDialog();
    ok('a kind is guessed from every value: digits are a number, never a yes/no', csvGuessKind(['1', '0', '']) === 'number' && csvGuessKind(['yes', 'No']) === 'yesno'
       && csvGuessKind(['2026-01-01', '3/4/2026']) === 'date' && csvGuessKind(['2', 'two']) === 'text' && csvGuessKind([]) === 'text');

    // ---- 5: sharing ----
    const secret = Object.assign(lab(), { columns: [{ id: 'c1', name: 'Password' }, { id: 'c2', name: 'Owner' }] });
    secret.nodes[0].extra = { c1: 'Summer2024' }; secret.nodes[1].extra = { c2: 'Reception' };
    const hits = docSecretHits(secret);
    ok('a custom column called Password is caught by its heading; an owner is not', hits.length === 1 && hits[0].id === 'pc1', show(hits));

    ok('the warning says notes for notes, and not for a column', /^The notes on/.test(secretLintText([{ name: 'A' }])) && /^What is written on Reception PC/.test(secretLintText(hits)), secretLintText(hits));

    // ---- 7: the report, bulk edits, a column's kind, the changes ----
    const rep = Object.assign(lab(), {
      columns: [{ id: 'c1', name: 'Owner' }, { id: 'c2', name: 'Leased', kind: 'yesno' }, { id: 'c3', name: 'Internal' }],
      tableView: { devices: { order: ['x:c2'], hidden: ['x:c3'] } }
    });
    rep.nodes[0].extra = { c1: 'Ana', c2: true, c3: 'do not print' };
    replaceDocument(rep, { origin: 'file' }); initHistory();
    const inv = devicesSection(reportDevices(), reportGroups());
    ok('the report prints the shown columns under the device, in the table\'s order', inv.includes('Leased: Yes · Owner: Ana'), inv.slice(inv.indexOf('Reception'), inv.indexOf('Reception') + 300));
    ok('a column hidden in the table is not printed', !inv.includes('do not print') && !inv.includes('Internal'));
    ok('a device with no values prints no line for them', reportDevices().find((d) => d.id === 'pc2').custom.length === 0);

    state.columns = normalizeCustomColumns(state.columns.concat({ id: 'c4', name: 'Cost', kind: 'number' })); save();
    const bf = bulkFields('node').find((f) => f.key === 'x:c4');
    ok('the bulk panel offers the network\'s columns, by name', !!bf && bulkFieldLabel(bf) === 'Cost' && bulkFields('node').find((f) => f.key === 'x:c2').editor === 'bool');
    const bp = bulkPlanSet(['pc1', 'pc2'], { 'x:c4': { text: '1,5' }, 'x:c2': { text: 'true' } });
    ok('a value is read by the column\'s kind; one a device holds already is no change', !bp.errors.length && bp.rows.filter((r) => r.field === 'Leased' && r.status === 'same').length === 1
       && bp.rows.filter((r) => r.field === 'Cost' && r.status === 'change').length === 2, show(bp.rows));
    ok('a value the kind refuses stops the plan', bulkPlanSet(['pc1'], { 'x:c4': { text: 'cheap' } }).errors.length === 1);
    const ub = _undoStack.length;
    applyBulkPlan(bp);
    ok('Apply writes them as the column holds them, in one undo step', customValueOf(getNode('pc1'), 'c4') === 1.5 && customValueOf(getNode('pc2'), 'c4') === 1.5
       && customValueOf(getNode('pc2'), 'c2') === true && _undoStack.length === ub + 1);
    applyBulkPlan(bulkPlanSet(['pc1', 'pc2'], { 'x:c4': { clear: true } }));
    ok('Clear empties it on every one of them', customValueOf(getNode('pc1'), 'c4') === undefined && customValueOf(getNode('pc2'), 'c4') === undefined);

    // A column's kind changed.
    applyBulkPlan(bulkPlanSet(['pc1'], { 'x:c4': { text: '12' } }));
    const asked2 = [];
    setDialogResponder((req) => { asked2.push(req.message); return true; });
    await changeCustomKind('c4', 'text');
    ok('number to text keeps every value, as text, and asks nothing', customColumnById('c4').kind === 'text' && customValueOf(getNode('pc1'), 'c4') === '12' && !asked2.length);
    await changeCustomKind('c1', 'number');
    ok('text to number asks first when a value is not a number, then drops it', asked2.length === 1 && /One device holds a value in Owner that is not a number: it will be lost\./.test(asked2[0])
       && customColumnById('c1').kind === 'number' && customValueOf(getNode('pc1'), 'c1') === undefined, show(asked2));
    undo();
    ok('one undo step puts the kind and the value back', customColumnById('c1').kind === 'text' && customValueOf(getNode('pc1'), 'c1') === 'Ana');
    setDialogResponder(() => false);
    await changeCustomKind('c1', 'date');
    ok('No leaves it as it was', customColumnById('c1').kind === 'text' && customValueOf(getNode('pc1'), 'c1') === 'Ana');
    setDialogResponder(null);

    // Changes since the last back-up name the column.
    const base = serializeDoc();
    commitValue({ key: 'n:pc2', rec: 'node', ref: { nodeId: 'pc2' } }, tvCols('devices').find((c) => c.key === 'x:c1'), 'Luis');
    const rows = changeRows(docChanges(base, serializeDoc()));
    ok('a changed value is listed under the column\'s name', rows.some((r) => r.name === 'Lab PC' && r.detail === 'Owner'), show(rows));

    // ---- 6: words ----
    setLocale('es'); applyLocale();
    ok('the Columns button and dialog are translated', el('tvColsBtn').textContent === 'Columnas…' && el('colsTitle').textContent === 'Columnas'
       && t('New column: {name}', { name: 'Dueño' }) === 'Columna nueva: Dueño');
    setLocale('en'); applyLocale();
    setView('map');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
