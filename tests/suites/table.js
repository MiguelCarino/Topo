// Map | Table (plan 3.2, js/table.js). What is held here:
//   1. the view: the toggle, the table over the map (the findings panel out
//      of its way), the choice remembered, none in a reduced view, and the
//      phone's default decided once;
//   2. rows from the report model and columns from the field schema, on all
//      four tabs; a device's blank gateway shows the one it inherits;
//   3. edits through the real keys: Enter / a typed character / Delete start
//      one, Enter or Tab keeps it and moves on, Esc throws it away; a value
//      the schema refuses is not written and the cell stays open; leaving the
//      cell keeps a good value and says so of a bad one; each kept edit is
//      one undo step, and an unchanged one none; Enter from an interface
//      row under a device moves on to a cell that edits; interfaces (also folded open
//      under their device), MACs in one canonical form, NAT only on a router,
//      a cable's medium, a network's fields, Declare on an undeclared subnet;
//   4. the keyboard moves between cells, and the map's single-key shortcuts
//      (T, Delete) stay quiet while a cell has the focus; Delete stays quiet
//      with the table shown wherever the focus is;
//   5. sorting, addresses as addresses;
//   6. a row click selects the thing and centres the map on it, the first
//      click on a fresh table's first cell too (the cursor parked there is
//      not one the user chose); tick boxes and shift-ranges feed the
//      selection set; the table follows the map;
//   7. Paste a column: per-cell validation, blank lines and missing rows left
//      alone, the findings delta from a scratch copy (the document untouched),
//      one undo step to apply, the dialog and Ctrl+V; a list pasted after a
//      row click runs down the column on every tab (two or more ticked rows
//      are the target set; otherwise it starts at the cursor's row, also
//      after the arrows moved it, and the cursor follows a device picked on
//      the map);
//   8. a read-only document refuses edits and pastes;
//   9. plain words translated, technical headers left English.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const grid = () => el('tvGrid');
  const rowEl = (key) => [...grid().querySelectorAll('tbody tr[data-row]')].find((r) => r.dataset.row === key) || null;
  const cellEl = (key, col) => { const r = rowEl(key); return r ? [...r.querySelectorAll('td[data-col]')].find((td) => td.dataset.col === col) || null : null; };
  const rowKeys = () => [...grid().querySelectorAll('tbody tr[data-row]')].map((r) => r.dataset.row);
  const heads = () => [...grid().querySelectorAll('thead th[data-col]')].map((th) => th.dataset.col);
  const key = (target, k, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
  const click = (target, extra = {}) => target.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, extra)));
  // A pointer's whole press, as a finger or a mouse gives it: down, up, click.
  const tap = (target) => {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    click(target);
    // The page catches up a tick after the pointer is let go; a test cannot
    // wait for that between steps, so it catches up here.
    _tv.pointerDown = false; if (_tv.dirty && !_tv.editor) renderTableView();
  };
  const steps = () => _undoStack.length;
  // Puts the cursor on a cell and starts an edit with Enter, as a person would.
  const editCell = (rk, col) => { const td = cellEl(rk, col); td.focus(); key(td, 'Enter'); return _tv.editor; };
  const type = (value, k = 'Enter', extra) => { const ed = _tv.editor; ed.el.value = value; key(ed.el, k, extra); };

  const PC = (id, name, ip, x) => ({ id, type: 'pc', name, x, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'net1', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1', dns: '10.0.0.53' }],
    nodes: [
      { id: 'r', type: 'router', name: 'R1', x: 300, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] },
      PC('a', 'PC-A', '10.0.0.10/24', 100), PC('b', 'PC-B', '10.0.0.9/24', 200), PC('c', 'PC-C', '10.0.0.11/24', 900),
      { id: 'sw', type: 'switch', name: 'SW', x: 300, y: 200, portCount: 8, interfaces: [] }
    ], links: [
      { id: 'la', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'lr', source: 'sw', target: 'r', sourceIface: 'p2', targetIface: 'i1' }
    ] });
  const open = () => {
    replaceDocument(lab(), { origin: 'file' });
    state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };
  const savedView = state.settings.view;
  const quiet = setDialogResponder(() => null);

  try {
    open();

    // ---- 1: the view ----
    ok('the Map | Table switch is on the pane', !!el('viewSwitch') && el('viewSwitch').querySelectorAll('[data-view]').length === 2);
    setView('table');
    ok('Table shows the table over the map', tableShown() && document.body.classList.contains('table-view')
       && el('canvasContainer').contains(el('tableView')));
    ok('the switch says which is on', el('viewSwitch').querySelector('[data-view="table"]').getAttribute('aria-pressed') === 'true');
    ok('the findings pill steps out of the way', getComputedStyle(el('conflictPill')).display === 'none');
    ok('the choice is remembered in this browser', JSON.parse(localStorage.getItem('nettopo_settings')).view === 'table');
    setView('map');
    ok('Map hides it again', !tableShown() && !document.body.classList.contains('table-view'));
    setView('table');
    state.settings.advanced = false; applyProfile();
    ok('a reduced view has no table, whatever was chosen', !tableShown() && effectiveView() === 'map');
    state.settings.advanced = true; applyProfile();
    ok('and the full editor brings it back', tableShown());
    {
      const mm = window.matchMedia;
      const held = state.settings.view;
      let phone = true;
      window.matchMedia = (q) => ({ matches: q === '(max-width: 640px)' ? phone : mm.call(window, q).matches, media: q, addEventListener() {}, removeEventListener() {} });
      try {
        state.settings.view = undefined; _tv.defaultView = null;
        ok('with no choice made, a phone opens on the table', effectiveView() === 'table');
        phone = false;
        ok('and stays there when it is turned sideways', effectiveView() === 'table');
        _tv.defaultView = null;
        ok('anything wider opens on the map', effectiveView() === 'map');
      } finally { window.matchMedia = mm; state.settings.view = held; _tv.defaultView = null; applyView(); }
    }
    ok('table still up after that', tableShown());

    // ---- 2: rows and columns ----
    showTableTab('devices');
    ok('one row per device, in the document order', rowKeys().join() === state.nodes.map((n) => `n:${n.id}`).join(), rowKeys().join());
    ok('rows read the report model', reportDevices().every((d) => cellEl(`n:${d.id}`, 'name').textContent === d.name));
    const tableable = (fields) => fields.filter((f) => f.table).map((f) => f.key);
    ok('every device field the schema marks for the table is a column',
       tableable(NODE_FIELDS).every((k) => heads().includes(k)), `${tableable(NODE_FIELDS)} vs ${heads()}`);
    ok('the Gateway header is the schema label, in English', grid().querySelector('th[data-col="gw"]').textContent.includes('Gateway'));
    const inh = cellEl('n:a', 'gw');
    ok('a blank gateway shows the inherited one, greyed', inh.textContent === '10.0.0.1' && inh.classList.contains('tv-muted'));
    ok('NAT is only a router\'s', cellEl('n:a', 'nat').textContent === '—' && !cellEl('n:a', 'nat').classList.contains('tv-edit')
       && cellEl('n:r', 'nat').classList.contains('tv-edit'));
    showTableTab('interfaces');
    ok('Interfaces: one row per interface', rowKeys().length === 4 && rowKeys().includes('i:a:i1'), rowKeys().join());
    ok('and its columns from the interface schema', tableable(IFACE_FIELDS).every((k) => heads().includes(k)), heads().join());
    ok('a cabled interface names the other end', cellEl('i:a:i1', 'cable').textContent.startsWith('SW · '), cellEl('i:a:i1', 'cable').textContent);
    ok('and the network it is on', cellEl('i:a:i1', 'subnet').textContent === 'Office');
    showTableTab('cables');
    ok('Cables: one row per cable', rowKeys().join() === 'l:la,l:lr', rowKeys().join());
    ok('and its columns from the cable schema', tableable(LINK_FIELDS).every((k) => heads().includes(k)), heads().join());
    showTableTab('subnets');
    ok('Subnets: the declared network', rowKeys().join() === 's:10.0.0.0/24' && cellEl('s:10.0.0.0/24', 'name').textContent === 'Office');
    ok('and its columns from the network schema', tableable(NETWORK_FIELDS).every((k) => heads().includes(k)), heads().join());
    ok('it counts its devices', cellEl('s:10.0.0.0/24', 'members').textContent === '4');

    // ---- 3: editing ----
    showTableTab('devices');
    let n0 = steps();
    let ed = editCell('n:a', 'os');
    ok('Enter on a cell opens it for editing', !!ed && ed.el.tagName === 'INPUT' && cellEl('n:a', 'os').contains(ed.el));
    type('Windows 11');
    ok('Enter keeps the value, written to the device', getNode('a').os === 'Windows 11');
    ok('as one undo step', steps() === n0 + 1, `${n0} -> ${steps()}`);
    ok('and moves down a row', _tv.cursor.row === 'n:b' && _tv.cursor.col === 'os' && document.activeElement === cellEl('n:b', 'os'));
    ok('the cell shows it', cellEl('n:a', 'os').textContent === 'Windows 11');

    n0 = steps();
    cellEl('n:b', 'os').focus();
    key(cellEl('n:b', 'os'), 'X');
    ok('a typed character starts an edit with it', _tv.editor && _tv.editor.el.value === 'X');
    key(_tv.editor.el, 'Escape');
    ok('Esc throws it away', !_tv.editor && (getNode('b').os || '') === '' && steps() === n0);
    ok('and leaves the focus on the cell', document.activeElement === cellEl('n:b', 'os'));

    n0 = steps();
    editCell('n:a', 'gw'); type('10.0.0');
    ok('a value the schema refuses keeps the cell open, marked', !!_tv.editor && _tv.editor.el.classList.contains('bad'));
    ok('and is not written', (getNode('a').gw || '') === '' && steps() === n0);
    ok('and says why', /not a valid Gateway/.test(el('topoToast').textContent), el('topoToast').textContent);
    _tv.editor.el.value = '10.0.0.254'; key(_tv.editor.el, 'Tab');
    ok('corrected, it is kept', getNode('a').gw === '10.0.0.254' && steps() === n0 + 1);
    ok('Tab moves right', _tv.cursor.row === 'n:a' && _tv.cursor.col === 'dns');
    ok('an own gateway is no longer grey', !cellEl('n:a', 'gw').classList.contains('tv-muted'));

    n0 = steps();
    editCell('n:a', 'gw'); type('10.0.0.254');
    ok('the same value again is no undo step', steps() === n0);

    n0 = steps();
    cellEl('n:a', 'gw').focus(); key(cellEl('n:a', 'gw'), 'Delete');
    ok('Delete on a cell opens it empty', _tv.editor && _tv.editor.el.value === '' && !!getNode('a'));
    type('');
    ok('and Enter clears the field, back to inheriting', getNode('a').gw === '' && cellEl('n:a', 'gw').classList.contains('tv-muted') && steps() === n0 + 1);

    // Leaving the cell for somewhere else.
    n0 = steps();
    editCell('n:c', 'notes');
    ok('notes open as a text area', _tv.editor.el.tagName === 'TEXTAREA');
    _tv.editor.el.value = 'Rack 2'; _tv.editor.el.blur();
    ok('leaving a cell keeps a good value', getNode('c').notes === 'Rack 2' && steps() === n0 + 1 && !_tv.editor);
    n0 = steps();
    editCell('n:c', 'dns'); _tv.editor.el.value = 'not-an-ip'; _tv.editor.el.blur();
    ok('and drops a bad one, saying nothing was changed', (getNode('c').dns || '') === '' && steps() === n0 && /Nothing was changed/.test(el('topoToast').textContent));

    n0 = steps();
    editCell('n:r', 'nat');
    ok('Enter flips a tick in one step', getNode('r').nat === true && steps() === n0 + 1 && !_tv.editor);
    n0 = steps();
    editCell('n:a', 'nat');
    ok('and a dash is not editable', getNode('a').nat === false && steps() === n0 && !_tv.editor);

    // A device's interfaces, open beneath it.
    click(rowEl('n:b').querySelector('[data-expand]'));
    ok('the twist opens a device\'s interfaces under it', rowKeys().indexOf('d:b:i1') === rowKeys().indexOf('n:b') + 1);
    ok('each sub-cell says what it is', cellEl('d:b:i1', 'if:ip').dataset.cap === 'IP / CIDR');
    n0 = steps();
    editCell('d:b:i1', 'if:ip'); type('10.0.0.99/24');
    ok('an address edits in place under the device', getNode('b').interfaces[0].ip === '10.0.0.99/24' && steps() === n0 + 1);
    // Enter moved on to the next row, a device with no address column: it
    // lands on a cell that can be typed into, not on the read-only Type.
    const afterIp = cellEl(_tv.cursor.row, _tv.cursor.col);
    ok('Enter under a device moves on to a cell that edits', _tv.cursor.row === 'n:c' && !!afterIp && afterIp.classList.contains('tv-edit'), JSON.stringify(_tv.cursor));
    cellEl('d:b:i1', 'if:ip').focus(); key(cellEl('d:b:i1', 'if:ip'), 'ArrowDown');
    ok('while an arrow lands on the cell drawn under it', _tv.cursor.row === 'n:c' && _tv.cursor.col === 'type', JSON.stringify(_tv.cursor));
    cellEl('d:b:i1', 'if:mac').focus(); key(cellEl('d:b:i1', 'if:mac'), 'ArrowDown');
    ok('the MAC, drawn under Gateway, goes to Gateway', _tv.cursor.col === 'gw', JSON.stringify(_tv.cursor));
    editCell('d:b:i1', 'if:ip'); type('10.0.0.300/24');
    ok('and a bad one is refused there too', getNode('b').interfaces[0].ip === '10.0.0.99/24' && !!_tv.editor);
    key(_tv.editor.el, 'Escape');
    click(rowEl('n:b').querySelector('[data-expand]'));
    ok('the twist folds them away', !rowKeys().includes('d:b:i1'));

    showTableTab('interfaces');
    n0 = steps();
    editCell('i:c:i1', 'mac'); type('aa-bb-cc-dd-ee-0f');
    ok('a MAC is kept in one canonical form', getNode('c').interfaces[0].mac === 'AA:BB:CC:DD:EE:0F', getNode('c').interfaces[0].mac);
    editCell('i:c:i1', 'mac'); type('aa-bb');
    ok('and a short one refused', getNode('c').interfaces[0].mac === 'AA:BB:CC:DD:EE:0F' && !!_tv.editor);
    key(_tv.editor.el, 'Escape');
    editCell('i:c:i1', 'name'); type('eno1');
    ok('an interface renames', getNode('c').interfaces[0].name === 'eno1' && steps() === n0 + 2);

    showTableTab('cables');
    n0 = steps();
    ed = editCell('l:la', 'medium');
    ok('a medium edits with a list of the five', ed && ed.el.tagName === 'SELECT' && ed.el.options.length === 5);
    ed.el.value = 'fiber'; key(ed.el, 'Enter');
    ok('and is written to the cable', getLink('la').medium === 'fiber' && steps() === n0 + 1);
    ed = editCell('l:lr', 'medium'); ed.el.value = effectiveMedium(getLink('lr')); key(ed.el, 'Enter');
    ok('picking the medium it is already drawn in is no edit', getLink('lr').medium === undefined && steps() === n0 + 1);

    showTableTab('subnets');
    n0 = steps();
    editCell('s:10.0.0.0/24', 'name'); type('HQ');
    ok('a network renames', networkById('net1').name === 'HQ' && steps() === n0 + 1);
    editCell('s:10.0.0.0/24', 'vlan'); type('4095');
    ok('a VLAN outside 1–4094 is refused', networkById('net1').vlan === undefined && !!_tv.editor);
    _tv.editor.el.value = '20'; key(_tv.editor.el, 'Enter');
    ok('and 20 is kept as a number', networkById('net1').vlan === 20);
    editCell('s:10.0.0.0/24', 'dhcp');
    ok('DHCP flips', networkById('net1').dhcp === true);
    spawnNode('pc', { at: { x: 600, y: 600 } });
    const fresh = state.nodes[state.nodes.length - 1];
    fresh.interfaces[0].ip = '192.168.77.5/24'; save(); renderCanvasOnly();
    const undecl = 's:192.168.77.0/24';
    ok('an undeclared subnet is a row too', !!rowEl(undecl) && cellEl(undecl, 'cidr').classList.contains('tv-muted'));
    ok('with nothing to edit until it is declared', !cellEl(undecl, 'name').classList.contains('tv-edit'));
    cellEl(undecl, 'declare').focus(); key(cellEl(undecl, 'declare'), 'Enter');
    ok('Enter on Declare declares it', state.networks.some((n) => n.cidr === '192.168.77.0/24') && cellEl(undecl, 'name').classList.contains('tv-edit'));

    // ---- 4: the keyboard ----
    open(); showTableTab('devices');
    cellEl('n:a', 'name').focus();
    key(cellEl('n:a', 'name'), 'ArrowRight');
    ok('ArrowRight moves a cell right', _tv.cursor.row === 'n:a' && _tv.cursor.col === 'type' && document.activeElement === cellEl('n:a', 'type'));
    key(document.activeElement, 'ArrowDown');
    ok('ArrowDown a row down, same column', _tv.cursor.row === 'n:b' && _tv.cursor.col === 'type');
    key(document.activeElement, 'End');
    ok('End goes to the last cell of the row', _tv.cursor.col === 'severity');
    key(document.activeElement, 'Home');
    ok('Home to the first', _tv.cursor.col === 'name');
    key(document.activeElement, 'Tab', { shiftKey: true });
    ok('Shift+Tab off the first cell wraps to the row above', _tv.cursor.row === 'n:a' && _tv.cursor.col === 'severity');
    const roving = grid().querySelectorAll('td[tabindex="0"]');
    ok('one cell is in the tab order: the cursor', roving.length === 1 && roving[0] === document.activeElement);
    const traceWas = state.settings.traceMode;
    cellEl('n:a', 'type').focus(); key(cellEl('n:a', 'type'), 't');
    ok('T on a cell is not the trace shortcut', state.settings.traceMode === traceWas);
    cellEl('n:a', 'type').focus(); select('a', 'node'); cellEl('n:a', 'type').focus(); key(cellEl('n:a', 'type'), 'Delete');
    ok('Delete on a cell does not delete the selected device', !!getNode('a'));
    document.activeElement.blur();
    key(document.body, 'Delete');
    ok('nor does Delete with the focus off the table, while the table covers the map', !!getNode('a') && state.nodes.length === 5);

    // ---- 5: sorting ----
    showTableTab('interfaces');
    _tv.sort.interfaces = null; renderTableView(true);
    click(grid().querySelector('[data-sort="ip"]'));
    const ips = () => rowKeys().map((k) => findTarget('iface', rowByKey(k).ref).ip);
    ok('addresses sort as addresses', ips().join() === '10.0.0.1/24,10.0.0.9/24,10.0.0.10/24,10.0.0.11/24', ips().join());
    ok('the header says so', grid().querySelector('th[data-col="ip"]').getAttribute('aria-sort') === 'ascending');
    click(grid().querySelector('[data-sort="ip"]'));
    ok('a second click reverses it', ips().join() === '10.0.0.11/24,10.0.0.10/24,10.0.0.9/24,10.0.0.1/24', ips().join());
    click(grid().querySelector('[data-sort="ip"]'));
    ok('a third puts the document order back', rowKeys().join() === 'i:r:i1,i:a:i1,i:b:i1,i:c:i1', rowKeys().join());
    showTableTab('devices');
    click(grid().querySelector('[data-sort="name"]')); click(grid().querySelector('[data-sort="name"]'));
    ok('names sort, descending', rowKeys()[0] === 'n:sw' && rowKeys()[rowKeys().length - 1] === 'n:a', rowKeys().join());
    _tv.sort.devices = null; renderTableView(true);

    // ---- 6: selecting ----
    select(null, null);
    showTableTab('cables'); showTableTab('devices');
    const first = grid().querySelector('tbody td[data-col]');
    const firstRow = rowByKey(first.parentElement.dataset.row);
    ok('a fresh table parks the cursor on its first cell, unchosen', _tv.cursor.row === firstRow.key && !_tv.cursorChosen);
    tap(first);
    ok('so the first tap there selects the device, not an editor', !_tv.editor && state.selectedId === firstRow.ref.nodeId,
       `editor ${!!_tv.editor}, selected ${state.selectedId}`);
    tap(cellEl(firstRow.key, first.dataset.col));
    ok('and a second tap on it edits', !!_tv.editor);
    key(_tv.editor.el, 'Escape');
    select(null, null);
    const canvas = el('networkCanvas').getBoundingClientRect();
    click(cellEl('n:c', 'name'));
    const c = getNode('c');
    ok('a row click selects the device', state.selectedId === 'c' && state.selectedType === 'node');
    ok('and centres the map on it', Math.abs(state.camera.x + c.x * state.camera.zoom - canvas.width / 2) < 1
       && Math.abs(state.camera.y + c.y * state.camera.zoom - canvas.height / 2) < 1, JSON.stringify(state.camera));
    ok('its row is marked', rowEl('n:c').classList.contains('tv-sel'));
    _tv.downOnCursor = true; click(cellEl('n:c', 'name'));
    ok('a second click on the cursor\'s cell edits it', !!_tv.editor && _tv.editor.td === cellEl('n:c', 'name'));
    key(_tv.editor.el, 'Escape');
    showTableTab('cables');
    click(cellEl('l:la', 'medium'));
    ok('a cable row selects the cable', state.selectedId === 'la' && state.selectedType === 'link');
    showTableTab('subnets');
    click(cellEl('s:10.0.0.0/24', 'members'));
    ok('a subnet row selects its devices', selectedOf('node').slice().sort().join() === 'a,b,c,r', selectedOf('node').join());
    showTableTab('devices');
    select(null, null);
    const box = (k) => rowEl(k).querySelector('input[data-check]');
    // A dispatched click on a checkbox ticks it, as a real one does.
    click(box('n:a'));
    click(box('n:c'), { shiftKey: true });
    ok('tick, then shift-tick, takes the range into the selection set', selectedOf('node').slice().sort().join() === 'a,b,c', selectedOf('node').join());
    ok('the rail shows the set', !el('multiSelectionPane').classList.contains('hidden'));
    ok('and the count says so', /Selected: 3/.test(el('tvCount').textContent), el('tvCount').textContent);
    click(box('n:b'));
    ok('untick takes one out', selectedOf('node').slice().sort().join() === 'a,c');
    select('sw', 'node');
    ok('a selection made on the map shows in the table', rowEl('n:sw').classList.contains('tv-sel') && !rowEl('n:a').classList.contains('tv-sel'));
    const before = rowKeys().length;
    spawnNode('server', { at: { x: 700, y: 100 } });
    ok('a device added on the map is a new row', rowKeys().length === before + 1);
    undo();
    ok('and undo takes the row away', rowKeys().length === before);

    // ---- 7: Paste a column ----
    open(); showTableTab('interfaces');
    checkRows(['i:a:i1', 'i:b:i1', 'i:c:i1'].map(rowByKey), true);
    ok('pasteLines drops a spreadsheet\'s last line break and its other columns',
       JSON.stringify(pasteLines('x\tq\r\ny\r\n')) === '["x","y"]' && pasteLines('').length === 0);
    const docBefore = JSON.stringify(serializeDoc());
    let plan = planPaste('ip', '10.0.0.50/24\n10.0.0.50/24\n10.0.0.50/24');
    ok('three lines over three ticked rows: three to change', plan.counts.change === 3 && plan.cells.map((x) => x.row.key).join() === 'i:a:i1,i:b:i1,i:c:i1');
    const delta = pasteFindingsDelta(plan);
    const conflict = delta.find((d) => d.key === 'ip-conflict');
    ok('the preview finds the conflict it would make', !!conflict && conflict.diff > 0, JSON.stringify(delta));
    ok('without touching the document', JSON.stringify(serializeDoc()) === docBefore && getNode('a').interfaces[0].ip === '10.0.0.10/24');
    plan = planPaste('ip', '10.0.0.60/24\n\n10.0.0.300/24\n10.0.0.61/24');
    ok('a blank line is left alone, a bad value refused, a line with no row counted',
       plan.counts.change === 1 && plan.counts.skip === 1 && plan.counts.bad === 1 && plan.extra === 1, JSON.stringify(plan.counts) + ' extra ' + plan.extra);
    plan = planPaste('ip', '10.0.0.60/24');
    ok('ticked rows with no line are counted as left alone', plan.unfilled === 2);
    plan = planPaste('ip', '10.0.0.10/24\n10.0.0.70/24\n10.0.0.71/24');
    ok('an equal value is unchanged, not a change', plan.counts.same === 1 && plan.counts.change === 2);
    let n1 = steps();
    ok('applying it changes the two', applyPastePlan(plan) === 2 && getNode('b').interfaces[0].ip === '10.0.0.70/24' && getNode('c').interfaces[0].ip === '10.0.0.71/24');
    ok('in one undo step', steps() === n1 + 1);
    undo();
    ok('which undo takes back whole', getNode('b').interfaces[0].ip === '10.0.0.9/24' && getNode('c').interfaces[0].ip === '10.0.0.11/24');

    showTableTab('devices');
    select(null, null);
    setCursor('n:b', 'os');
    const tg = pasteTargets();
    ok('with nothing ticked, a paste fills from the cursor\'s row down', tg.mode === 'down' && tg.rows.map((r) => r.key).join() === 'n:b,n:c,n:sw');
    plan = planPaste('nat', 'yes\nyes', { rows: [rowByKey('n:r'), rowByKey('n:a')], mode: 'selected' });
    ok('a column a row does not have is left alone (NAT on a PC)', plan.counts.change === 1 && plan.counts.skip === 1);

    // The dialog, through the real buttons.
    n1 = steps();
    checkRows(['n:a', 'n:b'].map(rowByKey), true);
    openPasteColumn({ col: 'os', text: 'Debian 12\nDebian 13' });
    ok('the dialog opens on the column and the text', !el('pasteDialog').hidden && el('pasteColumn').value === 'os' && el('pasteText').value === 'Debian 12\nDebian 13');
    ok('says where it goes', /selected rows/.test(el('pasteTarget').textContent) && /Rows: 2/.test(el('pasteTarget').textContent), el('pasteTarget').textContent);
    ok('previews each row', el('pastePreview').querySelectorAll('tr').length === 2 && /2\s*To change/.test(el('pasteCounts').textContent), el('pasteCounts').textContent);
    ok('and what the findings would do', /findings stay the same/i.test(el('pasteDelta').textContent), el('pasteDelta').textContent);
    ok('only pasteable columns are offered', [...el('pasteColumn').options].every((o) => TV_COLS.devices.find((c2) => c2.key === o.value).editor));
    el('pasteText').value = 'nope'; el('pasteText').dispatchEvent(new Event('input', { bubbles: true }));
    el('pasteColumn').value = 'gw'; el('pasteColumn').dispatchEvent(new Event('change', { bubbles: true }));
    ok('nothing valid to change: Apply is off', el('pasteApplyBtn').disabled && /1\s*Not valid/.test(el('pasteCounts').textContent));
    el('pasteText').value = '10.0.0.2\n10.0.0.3'; el('pasteText').dispatchEvent(new Event('input', { bubbles: true }));
    click(el('pasteApplyBtn'));
    ok('Apply writes them and closes', el('pasteDialog').hidden && getNode('a').gw === '10.0.0.2' && getNode('b').gw === '10.0.0.3');
    ok('as one step', steps() === n1 + 1);

    // Ctrl+V on a cell.
    select(null, null);
    const pasteOn = (td, text) => { td.focus(); const dt = new DataTransfer(); dt.setData('text/plain', text); td.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); };
    n1 = steps();
    pasteOn(cellEl('n:c', 'os'), 'FreeBSD 14\n');
    ok('one line pasted on a cell is an edit of that cell', getNode('c').os === 'FreeBSD 14' && steps() === n1 + 1 && el('pasteDialog').hidden);
    pasteOn(cellEl('n:c', 'gw'), 'bogus');
    ok('and is refused like a typed one', (getNode('c').gw || '') === '' && /not a valid Gateway/.test(el('topoToast').textContent));
    pasteOn(cellEl('n:a', 'os'), 'A\nB\nC');
    ok('several lines open the preview on that column', !el('pasteDialog').hidden && el('pasteColumn').value === 'os' && /from PC-A down/.test(el('pasteTarget').textContent), el('pasteTarget').textContent);
    closePasteColumn();
    ok('Cancel leaves everything', el('pasteDialog').hidden && getNode('a').os !== 'A');
    // A row click on Devices or Cables ticks the row it selects; a list pasted
    // then must still run down the column, as it does on Interfaces.
    for (const [tab, rk, col, name] of [['devices', 'n:b', 'os', 'PC-B'], ['cables', 'l:la', 'medium', 'SW']]) {
      showTableTab(tab); select(null, null);
      tap(cellEl(rk, col));
      ok(`${tab}: the clicked row is ticked by the click`, rowChecked(rowByKey(rk)));
      const tgt = pasteTargets();
      ok(`${tab}: so a paste starts there and goes down`, tgt.mode === 'down' && tgt.rows[0].key === rk, tgt.mode);
      pasteOn(cellEl(rk, col), 'A\nB');
      ok(`${tab}: the preview says so`, !el('pasteDialog').hidden && new RegExp(`from ${name}.* down`).test(el('pasteTarget').textContent), el('pasteTarget').textContent);
      closePasteColumn();
    }
    // The arrows move the cursor and leave the clicked row ticked: a list
    // pasted then starts at the cursor, where one line would go too.
    showTableTab('devices'); select(null, null);
    tap(cellEl('n:c', 'os'));
    key(cellEl('n:c', 'os'), 'ArrowUp'); key(cellEl('n:b', 'os'), 'ArrowUp');
    ok('arrows: the cursor moved, the click\'s row still ticked', _tv.cursor.row === 'n:a' && rowChecked(rowByKey('n:c')) && document.activeElement === cellEl('n:a', 'os'));
    pasteOn(cellEl('n:a', 'os'), 'A\nB');
    ok('so a list starts at the cursor\'s row', !el('pasteDialog').hidden && /from PC-A down/.test(el('pasteTarget').textContent)
       && _paste.plan.cells[0].row.key === 'n:a' && !_paste.plan.extra, el('pasteTarget').textContent);
    closePasteColumn();
    openPasteColumn();
    ok('and so does the Paste a column button', /from PC-A down/.test(el('pasteTarget').textContent), el('pasteTarget').textContent);
    closePasteColumn();
    // A device picked on the map, then the table: the cursor follows it.
    setView('map'); select('b', 'node'); setView('table');
    ok('a device picked on the map brings the cursor to its row', _tv.cursor.row === 'n:b', JSON.stringify(_tv.cursor));
    ok('where a paste then starts', pasteTargets().rows[0].key === 'n:b');
    n1 = steps();
    pasteOn(cellEl('n:b', 'os'), 'Plan 9');
    ok('and where one line goes', getNode('b').os === 'Plan 9' && steps() === n1 + 1);
    showTableTab('devices'); select(null, null);
    tap(cellEl('n:b', 'os'));
    n1 = steps();
    pasteOn(cellEl('n:b', 'os'), 'Haiku R1');
    ok('one line after a row click is still a plain edit of that cell', getNode('b').os === 'Haiku R1' && steps() === n1 + 1 && el('pasteDialog').hidden);

    // ---- 8: read-only ----
    replaceDocument(Object.assign(lab(), { v: DOC_VERSION + 1 }), { origin: 'file' });
    showTableTab('devices');
    ok('a newer document still reads in the table', rowKeys().length === 5);
    editCell('n:a', 'os');
    ok('but no cell opens', !_tv.editor && /read-only/.test(el('topoToast').textContent));
    ok('and Paste a column is off', el('tvPasteBtn').disabled);
    ok('nor does a plan apply', applyPastePlan(planPaste('os', 'x', { rows: [rowByKey('n:a')], mode: 'selected' })) === 0 && (getNode('a').os || '') === '');

    // ---- 9: language ----
    open(); showTableTab('devices');
    setLocale('es'); applyLocale();
    ok('Map and Table are translated', el('viewSwitch').querySelector('[data-view="map"]').textContent === 'Mapa' && el('viewSwitch').querySelector('[data-view="table"]').textContent === 'Tabla');
    ok('plain headers are translated', grid().querySelector('th[data-col="name"]').textContent.includes('Nombre'));
    ok('technical ones stay English', grid().querySelector('th[data-col="gw"]').textContent.includes('Gateway')
       && el('tableView').querySelector('[data-tvtab="interfaces"]').textContent === 'Interfaces');
    ok('so do the counts', /Filas: 5/.test(el('tvCount').textContent), el('tvCount').textContent);
    setLocale('en'); applyLocale();
  } catch (err) {
    ok('suite ran without throwing', false, err && (err.stack || err.message));
  } finally {
    setDialogResponder(quiet);
    if (_tv.editor) cancelEdit(true);
    state.settings.view = savedView; saveSettings(); applyView();
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 50); });
