// The upkeep fields redraw what reads them (js/assets.js UPKEEP_INPUTS).
// In service, Last serviced, Service every and Expected life are typed like
// any other field: saved at once, drawn through the coalesced typed redraw
// (renderTyped, js/ui.js), so the findings, the device's badge and the
// table's Age and Next service follow the typing, not some later redraw.
// What is held:
//   1. typing a date or an interval, with no commit, reaches the findings;
//   2. and the table's Next service column;
//   3. a picked day (the calendar) draws at once, not when the window closes;
//   4. what cannot be read is marked and draws nothing;
//   5. the keystrokes still coalesce, and the commit draws the last of them.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const typeInto = (input, text) => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const heldResponder = setDialogResponder(null);
  const heldCoalesce = window.TOPO_COALESCE;
  const heldDraw = window.renderCanvasOnly;
  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }],
    nodes: [
      { id: 'sw', type: 'switch', name: 'Core', x: 200, y: 100, portCount: 8, inService: '2019', serviceEvery: 12, serviced: '2026-01-31', interfaces: [] },
      { id: 'pc1', type: 'pc', name: 'Reception PC', x: 200, y: 300, inService: '2021-03-15', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] },
      { id: 'pc2', type: 'pc', name: 'Lab PC', x: 300, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24' }] }
    ],
    links: [] });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); };
  const findingsText = () => el('conflictMsgList').textContent;
  const grid = () => el('tvGrid');
  const rowEl = (key) => [...grid().querySelectorAll('tbody tr[data-row]')].find((r) => r.dataset.row === key) || null;
  const cellEl = (key, col) => { const r = rowEl(key); return r ? [...r.querySelectorAll('td[data-col]')].find((td) => td.dataset.col === col) || null : null; };
  // Counts the map's draws while it is on; the typed redraw calls it by name.
  let draws = 0;
  const countDraws = () => { draws = 0; window.renderCanvasOnly = function () { draws++; return heldDraw.apply(this, arguments); }; };
  const stopCounting = () => { window.renderCanvasOnly = heldDraw; };

  try {
    window.TOPO_COALESCE = false;
    open();

    // ---- 1: typing reaches the findings ----
    select('pc1', 'node');
    ok('no service finding to begin with', !/Was due for service/.test(findingsText()), findingsText());
    typeInto(el('propServiceEvery'), '6');
    typeInto(el('propServiced'), '2020-01-01');
    ok('typed, not committed, the findings say it is overdue', /Was due for service on 2020-07-01/.test(findingsText()), findingsText());

    // ---- 2: and the table ----
    setView('table');
    showTableTab('devices');
    typeInto(el('propServiced'), '2026-10-01');
    const next = cellEl('n:pc1', 'nextService');
    ok('the table\'s Next service follows the typing', !!next && next.textContent === '2027-04-01', next ? next.textContent : 'no cell');
    ok('and the findings drop the overdue one', !/Was due for service on 2020-07-01/.test(findingsText()), findingsText());
    setView('map');
    commitTyping();

    // ---- 3: the calendar draws at once ----
    // The first ask draws and opens the window, so the picked day's ask is
    // left pending: only the field's change can draw it before the timer.
    window.TOPO_COALESCE = true;
    typeInto(el('propServiceEvery'), '6');
    const native = el('propServiced').parentElement.querySelector('.date-pick-native');
    native.value = '2020-01-01';
    native.dispatchEvent(new Event('change'));
    ok('a picked day is in the findings at once', /Was due for service on 2020-07-01/.test(findingsText()), findingsText());
    ok('with nothing left waiting', !typedDraw.waiting());
    flushTypedRender(); cancelTypedRender();

    // ---- 4: what cannot be read draws nothing ----
    window.TOPO_COALESCE = false;
    flushTypedRender();
    countDraws();
    typeInto(el('propServiced'), '02/31/2026');
    stopCounting();
    ok('an unreadable date is not drawn', draws === 0, String(draws));
    ok('it is marked', el('propServiced').classList.contains('bad') && el('propServiced').getAttribute('aria-invalid') === 'true');
    ok('and not stored', getNode('pc1').serviced === '2020-01-01', getNode('pc1').serviced);
    el('propServiced').dispatchEvent(new Event('change'));
    commitTyping();

    // ---- 5: the keystrokes still coalesce ----
    window.TOPO_COALESCE = true;
    typeInto(el('propServiceEvery'), '6');   // opens the window
    countDraws();
    typeInto(el('propServiceEvery'), '1');
    typeInto(el('propServiceEvery'), '12');
    typeInto(el('propServiceEvery'), '120');
    const during = draws;
    const waited = typedDraw.waiting();
    el('propServiceEvery').dispatchEvent(new Event('change'));
    stopCounting();
    ok('three keystrokes in the window draw at most once', during <= 1, String(during));
    ok('and leave one draw waiting', waited);
    ok('the commit draws it', !typedDraw.waiting() && draws >= 1, String(draws));
    // Serviced 2020-01-01 every 120 months: due 2030-01-01, nothing overdue.
    ok('the findings read the last value', getNode('pc1').serviceEvery === 120 && !/Was due for service/.test(findingsText()), findingsText());
    commitTyping();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.renderCanvasOnly = heldDraw;
    cancelTypedRender();
    if (heldCoalesce === undefined) delete window.TOPO_COALESCE; else window.TOPO_COALESCE = heldCoalesce;
    if (typeof tableShown === 'function' && tableShown()) setView('map');
    select(null, null);
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });