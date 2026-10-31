// A cable's length typed, pasted and set in bulk (cableLengthFromText,
// js/model.js; the length column, js/table.js; the bulk panel, js/bulk.js).
// A length is kept as "2.5 m" or "8 ft"; one written some other way in an
// older file ("15 feet", "about 3") is kept as it is until it is typed over.
// What is held here:
//   1. the table's editor: an old free-text length opens as it is written,
//      and Enter or a blur with nothing changed leaves it as it was, with no
//      undo step; what is typed over it is filtered and stored as ever, and
//      moving the unit pick is an edit; a length kept the new way opens as
//      its number, in its own unit;
//   2. a paste: a bare number takes the unit the cable is kept in, in the
//      preview (planPaste) and in one cell (onTablePaste); a unit pasted
//      with it wins; an old free-text one, or none, is in metres;
//   3. the bulk panel: an old free-text length all of them share is shown,
//      and left alone it asks for nothing, so a colour can still be set on
//      them; typed over, it is a length like any other; only its unit pick
//      moved, it is read in that unit, as the table reads it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const undoBtn = () => el('undoBtn');
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  const typeInto = (input, text) => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const letGo = () => { if (document.activeElement) document.activeElement.blur(); };
  const heldResponder = setDialogResponder(null);
  const savedView = state.settings.view;
  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n1', cidr: '10.0.0.0/24', gateway: '10.0.0.1' }],
    nodes: [
      { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 0, portCount: 8, interfaces: [] },
      { id: 'a', type: 'pc', name: 'PC-A', x: -200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] },
      { id: 'b', type: 'pc', name: 'PC-B', x: -100, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] },
      { id: 'c', type: 'pc', name: 'PC-C', x: 100, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24' }] },
      { id: 'd', type: 'pc', name: 'PC-D', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.13/24' }] }
    ],
    links: [
      { id: 'l1', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1', cable: { length: '15 feet' } },
      { id: 'l2', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1', cable: { length: 'about 3' } },
      { id: 'l3', source: 'sw', target: 'c', sourceIface: 'p3', targetIface: 'i1', cable: { length: '8 ft' } },
      { id: 'l4', source: 'sw', target: 'd', sourceIface: 'p4', targetIface: 'i1', cable: { length: '2 m' } }
    ] });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); };
  const len = (id) => cableOf(getLink(id), 'length');
  const cellOf = (key) => el('tableView').querySelector(`tr[data-row="l:${key}"] td[data-col="cable:length"]`);
  const table = () => { setView('table'); showTableTab('cables'); };

  try {
    // ---- 1: the table's editor ----
    open(); table();
    ok('an old free-text length is kept as written on load', len('l1') === '15 feet' && len('l2') === 'about 3', show([len('l1'), len('l2')]));
    let before = steps();
    startEdit(cellOf('l1'));
    let ed = _tv.editor;
    ok('it opens as it is written, not filtered to its digits', !!ed && ed.el.value === '15 feet', ed && ed.el.value);
    ok('Enter with nothing changed is taken', finishEdit('enter', 'down') === true && !_tv.editor);
    ok('and leaves it as it was, with no undo step', len('l1') === '15 feet' && steps() === before, show([len('l1'), steps(), before]));

    startEdit(cellOf('l2'));
    ed = _tv.editor;
    ok('one that is no length at all opens as written too', !!ed && ed.el.value === 'about 3', ed && ed.el.value);
    ok('Enter on it unchanged is not refused', finishEdit('enter') === true && !_tv.editor && len('l2') === 'about 3', len('l2'));
    startEdit(cellOf('l2'));
    finishEdit('blur');
    ok('nor is a blur: it is left as it was, and nothing is said', len('l2') === 'about 3' && steps() === before && !_tv.editor, show([len('l2'), steps()]));

    startEdit(cellOf('l1'));
    ed = _tv.editor;
    typeInto(ed.el, '4 feet');
    ok('what is typed over it is filtered as ever', ed.el.value === '4', ed.el.value);
    finishEdit('enter');
    ok('and stored as a length, one undo step', len('l1') === '4 m' && steps() === before + 1, show([len('l1'), steps()]));
    undo();
    ok('undone, the old text is back', len('l1') === '15 feet', len('l1'));

    startEdit(cellOf('l1'), '5');
    finishEdit('enter');
    ok('a character typed on the cell starts it over, as a spreadsheet does', len('l1') === '5 m', len('l1'));
    undo();

    startEdit(cellOf('l1'));
    ed = _tv.editor;
    ed.unitEl.value = 'ft'; ed.unitEl.dispatchEvent(new Event('change', { bubbles: true }));
    finishEdit('enter');
    ok('moving the unit pick is an edit: "15 feet" read in feet', len('l1') === '15 ft', len('l1'));
    undo();

    startEdit(cellOf('l2'));
    ed = _tv.editor;
    ed.el.value = 'about 4';
    ok('changed but still no length, it is refused and stays open', finishEdit('enter') === false && _tv.editor === ed && ed.el.classList.contains('bad') && len('l2') === 'about 3');
    cancelEdit();

    before = steps();
    startEdit(cellOf('l3'));
    ed = _tv.editor;
    ok('a length kept the new way opens as its number, in its own unit', ed.el.value === '8' && ed.unitEl.value === 'ft', show([ed.el.value, ed.unitEl.value]));
    finishEdit('enter');
    ok('and left as it is, it is no edit either', len('l3') === '8 ft' && steps() === before, show([len('l3'), steps()]));
    startEdit(cellOf('l4'));
    _tv.editor.el.value = '2.5';
    finishEdit('enter');
    ok('typed, it is stored in its unit', len('l4') === '2.5 m', len('l4'));
    undo();

    // ---- 2: a paste ----
    open(); table();
    const rows = ['l3', 'l4', 'l1'].map((id) => rowByKey('l:' + id));
    let plan = planPaste('cable:length', '25\n25\n25', { rows, mode: 'selected' }, 'cables');
    ok('a bare number pasted takes the unit the cable is kept in', plan.cells[0].value === '25 ft' && plan.cells[1].value === '25 m',
      show(plan.cells.map((c) => c.value)));
    ok('an old free-text one, with no unit to keep, is in metres', plan.cells[2].value === '25 m', plan.cells[2].value);
    plan = planPaste('cable:length', '25 m\n8', { rows, mode: 'selected' }, 'cables');
    ok('a unit pasted with the number wins', plan.cells[0].value === '25 m' && plan.cells[0].status === 'change', show(plan.cells[0]));
    ok('a number equal to what is there, in its unit, is the same', plan.cells[1].value === '8 m' && plan.cells[1].status === 'change'
      && planPaste('cable:length', '8', { rows: [rows[0]], mode: 'selected' }, 'cables').cells[0].status === 'same');
    plan = planPaste('cable:length', 'about 3', { rows: [rows[0]], mode: 'selected' }, 'cables');
    ok('a paste that is no length is still refused', plan.cells[0].status === 'bad');

    setCursor('l:l3', 'cable:length');
    const paste = (text) => onTablePaste({ target: el('tvGrid'), clipboardData: { getData: () => text }, preventDefault() {} });
    paste('30');
    ok('one number pasted into one cell takes the cable\'s unit too', len('l3') === '30 ft', len('l3'));
    setCursor('l:l4', 'cable:length');
    paste('30');
    ok('and a cable in metres stays in metres', len('l4') === '30 m', len('l4'));
    setCursor('l:l3', 'cable:length');
    paste('2 m');
    ok('a unit pasted into one cell wins there too', len('l3') === '2 m', len('l3'));
    setView('map');

    // ---- 3: the bulk panel ----
    open({ v: DOC_VERSION, nodes: lab().nodes,
      links: [{ id: 'l1', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1', cable: { length: 'about 3' } },
        { id: 'l2', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1', cable: { length: 'about 3' } }] });
    resetBulkDraft();
    selectEntries([{ type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    const bLen = el('bulkF-cable.length'), bColor = el('bulkF-cable.color');
    ok('the old text they share is shown', !!bLen && bLen.value === 'about 3', bLen && bLen.value);
    ok('left alone, it asks for nothing', show(readBulkEdits('link')) === '{}', show(readBulkEdits('link')));
    typeInto(bColor, 'red');
    const req = bulkRequest('set');
    ok('a colour set on them asks for the colour alone', show(req.edits) === show({ 'cable.color': { text: 'red' } }), show(req.edits));
    const cplan = bulkPlan(req);
    ok('so its preview is no error, and Apply is offered', !cplan.errors.length && cplan.counts.change === 2, show({ errors: cplan.errors, counts: cplan.counts }));
    bulkWrite(cplan, state);
    ok('and applied, the length is left as it was', cableOf(getLink('l1'), 'color') === 'red' && len('l1') === 'about 3' && len('l2') === 'about 3');
    // Out of the field first: the panel is not redrawn under a field that has
    // the focus (renderBulkFields), so the colour typed would still be there.
    letGo();
    resetBulkDraft();
    selectEntries([{ type: 'link', id: 'l1' }]);
    selectEntries([{ type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    const bLen2 = el('bulkF-cable.length');
    typeInto(bLen2, '6 feet');
    ok('typed over, it is a length like any other', bLen2.value === '6' && show(readBulkEdits('link')) === show({ 'cable.length': { text: '6 m' } }), show(readBulkEdits('link')));
    typeInto(bLen2, 'about 3');
    ok('and the old text cannot be typed back in', bLen2.value === '3' && show(readBulkEdits('link')) === show({ 'cable.length': { text: '3 m' } }), show(readBulkEdits('link')));
    letGo();
    resetBulkDraft();
    // Only the unit pick moved on an old text they share: read in that unit,
    // as the table reads it, not the text with the unit stuck on its end.
    selectEntries([]);
    selectEntries([{ type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    const aUnit = el('bulkU-cable.length');
    aUnit.value = 'ft'; aUnit.dispatchEvent(new Event('change', { bubbles: true }));
    const aPlan = bulkPlan(bulkRequest('set'));
    ok('"about 3" with only its unit moved is still refused, as written', aPlan.errors.length > 0 && show(readBulkEdits('link')) === show({ 'cable.length': { text: 'about 3' } }),
      show({ edits: readBulkEdits('link'), errors: aPlan.errors }));
    resetBulkDraft();
    selectEntries([]);
    open({ v: DOC_VERSION, nodes: lab().nodes,
      links: [{ id: 'l1', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1', cable: { length: '15 feet' } },
        { id: 'l2', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1', cable: { length: '15 feet' } }] });
    selectEntries([{ type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    const fLen = el('bulkF-cable.length'), fUnit = el('bulkU-cable.length');
    ok('"15 feet" they share is shown as written, the pick on m', fLen.value === '15 feet' && fUnit.value === 'm', show([fLen.value, fUnit.value]));
    fUnit.value = 'ft'; fUnit.dispatchEvent(new Event('change', { bubbles: true }));
    ok('only its unit moved to ft, it is read in feet, as in the table', show(readBulkEdits('link')) === show({ 'cable.length': { text: '15 ft' } }), show(readBulkEdits('link')));
    const fPlan = bulkPlan(bulkRequest('set'));
    ok('so its preview is no error', !fPlan.errors.length && fPlan.counts.change === 2, show({ errors: fPlan.errors, counts: fPlan.counts }));
    bulkWrite(fPlan, state);
    ok('and applied, both are 15 ft', len('l1') === '15 ft' && len('l2') === '15 ft', show([len('l1'), len('l2')]));
    resetBulkDraft();
    selectEntries([]);

    open({ v: DOC_VERSION, nodes: lab().nodes,
      links: [{ id: 'l1', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1', cable: { length: '8 ft' } },
        { id: 'l2', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1', cable: { length: '8 ft' } }] });
    selectEntries([{ type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    const nLen = el('bulkF-cable.length'), nUnit = el('bulkU-cable.length');
    ok('a length they share the new way shows its number and unit', nLen.value === '8' && nUnit.value === 'ft' && show(readBulkEdits('link')) === '{}');
    nUnit.value = 'm'; nUnit.dispatchEvent(new Event('change', { bubbles: true }));
    ok('moving its unit pick is an edit', show(readBulkEdits('link')) === show({ 'cable.length': { text: '8 m' } }), show(readBulkEdits('link')));
    resetBulkDraft();
    selectEntries([]);
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
