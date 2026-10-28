// The rack view, step C part 2 (Review-Packs/Topo-groups.md; js/rackview.js,
// js/model.js "A rack's cables", placeFindings in js/diagnostics.js and
// reportRacks in js/report.js). What is held here:
//   1. depth, pure: full depth is the default and is not stored, half depth
//      is 'half'; a full-depth device takes its units on both faces, so it
//      clashes with what is behind it, and the overlaps a rack holds;
//   2. the cables, pure: one entry per pair of this rack's devices, the cables
//      in it, and one stub per far device for a cable out of the rack; a
//      cable's text, its ports both ends and its label or colour;
//   3. the findings: two devices in the same units (the same face, or either
//      when one fills the depth), a device going past the top, rack fields
//      with no rack; each names both devices;
//   4. the lane: one line per pair, ×N on a bundle, the ports and the label
//      or colour on it, a colour swatch, a stub per far device labelled with
//      it, the selected device's lines lit, the search dimming the rest; a
//      label selects its cables and the rail shows the port picker;
//   5. drawing a cable: from a device's plug to another device (one undo
//      step, bindLink's ports, selected, the port picker shown), dropped on
//      nothing is nothing; Cable to… and a tap on the other end, Escape or
//      the same device letting it go;
//   6. full depth in the view: its back on the other face, units there not
//      free, the selected device's Full depth refused over a device behind
//      it and otherwise one undo step; the device editor's box, ticked by
//      default; CSV (full or half);
//   7. the report: a Racks section, front and rear per rack, a unit a row,
//      a device over its units, a clash marked, the back of a full-depth
//      one, the cables; none without racks;
//   8. read-only: no plug and no Cable to…; Spanish.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }] }, extra);
  // The UPS fills the depth (the default, not stored); the rest are half
  // depth, on one face, so the faces' own units can be told apart.
  const H = { rackDepth: 'half' };
  const site = (v = DOC_VERSION) => ({ v,
    nodes: [
      N('fw', 'firewall', { x: 0, y: 0, group: 'rk', rackU: 41, ...H }),
      N('sw', 'switch', { x: 100, y: 0, group: 'rk', rackU: 39, portCount: 24, interfaces: [], ...H }),
      N('srv', 'server', { x: 200, y: 0, group: 'rk', rackU: 30, rackHeight: 2, ...H }),
      N('db', 'server', { x: 260, y: 0, group: 'rk', rackU: 26, rackHeight: 2, ...H }),
      N('ups', 'custom', { x: 300, y: 0, group: 'rk', rackU: 1, rackHeight: 3, interfaces: [] }),
      N('pdu', 'custom', { x: 320, y: 0, group: 'rk', rackU: 36, rackFace: 'rear', interfaces: [], ...H }),
      N('nas', 'server', { x: 400, y: 0, group: 'rk', ...H }),
      N('pc', 'pc', { x: 0, y: 300, group: 'off' }),
      N('cam', 'camera', { x: 100, y: 300, group: 'off' })
    ],
    links: [
      { id: 'l1', source: 'fw', target: 'sw', sourceIface: 'i1', targetIface: 'p24', cable: { label: 'C-UP', color: 'blue' } },
      { id: 'l2', source: 'sw', target: 'srv', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'l3', source: 'srv', target: 'sw', sourceIface: 'i2', targetIface: 'p2' },
      { id: 'l4', source: 'sw', target: 'db', sourceIface: 'p3', targetIface: 'i1', cable: { color: 'not a colour' } },
      { id: 'l5', source: 'sw', target: 'pc', sourceIface: 'p10', targetIface: 'i1' },
      { id: 'l6', source: 'cam', target: 'sw', sourceIface: 'i1', targetIface: 'p11' },
      { id: 'l7', source: 'nas', target: 'sw', sourceIface: 'i1', targetIface: 'p12' }
    ],
    groups: [
      { id: 'room', name: 'Server room', kind: 'room' },
      { id: 'rk', name: 'Rack 3', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'rk2', name: 'Rack 4', kind: 'rack', parent: 'room', uHeight: 12 },
      { id: 'off', name: 'Office', kind: 'room' }
    ] });
  const open = (doc = site()) => replaceDocument(doc, { origin: 'file', docId: 'rack-cables' });
  const view = () => el('rackView');
  const dev = (id) => view().querySelector(`.rk-dev:not(.rk-back)[data-node="${id}"]`);
  const back = (id) => view().querySelector(`.rk-dev.rk-back[data-node="${id}"]`);
  const lbl = (links) => view().querySelector(`.rk-lbl[data-links="${links}"]`);
  const lbls = () => [...view().querySelectorAll('.rk-lbl')];
  const wires = () => [...view().querySelectorAll('.rk-wire')];
  const toast = () => el('topoToast').textContent;
  const clearToast = () => { el('topoToast').textContent = ''; };
  const undoDepth = () => _undoStack.length;
  const rackFindings = () => topologyFindings().filter((f) => f.key === 'rack');
  const ptr = (type, target, x, y, extra = {}) => target.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9, pointerType: 'mouse', isPrimary: true }, extra)));
  const mid = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  try {
    // ---- 1: depth, pure ----
    open();
    const rk = groupById('rk');
    ok('half depth is read from its words and stored as half', asRackDepth('Half-Depth') === 'half' && asRackDepth(' half ') === 'half' && asRackDepth('shallow') === 'half'
       && asRackDepth('one face') === 'half' && asRackDepth(false) === 'half');
    ok('full depth, the default, is not stored', asRackDepth('full') === undefined && asRackDepth('Full depth') === undefined && asRackDepth(true) === undefined
       && asRackDepth('') === undefined && !('rackDepth' in getNode('ups')) && rackFullDepth(getNode('ups')) && !rackFullDepth(getNode('pdu')));
    ok('a full-depth device takes its units on the other face too', rackClash(rk, 'rear', 2, 2, null) === getNode('ups') && rackClash(rk, 'rear', 4, 4, null) === null);
    ok('a half-depth one does not', rackClash(rk, 'front', 36, 36, null, state.nodes, false) === null && rackClash(rk, 'rear', 30, 30, null, state.nodes, false) === null);
    ok('a new one is full depth, so it meets what is behind it', rackClash(rk, 'front', 36, 36, null) === getNode('pdu'));
    ok('and one placed as full depth meets what is behind it', rackClash(rk, 'front', 36, 36, null, state.nodes, true) === getNode('pdu'));
    ok('a device that is full depth is checked as one where it moves', rackSpanCheck(rk, 'front', 36, 1, 'ups').clash === getNode('pdu')
       && rackSpanCheck(rk, 'front', 35, 1, 'ups').clash === null);
    ok('the lowest free run steps over its back', rackFirstFree(rk, 'rear', 1, null) === 4);
    ok('no overlaps in a rack placed as the view places', rackOverlaps(rk).length === 0);
    ok('its place says only the exception', rackSpanText(getNode('ups')) === 'U1–U3 front' && rackSpanText(getNode('pdu')) === 'U36 rear, half depth'
       && nodePlaceText(getNode('pdu')) === 'Server room / Rack 3 · U36 rear, half depth');

    // ---- 2: the cables, pure ----
    const rc = rackCables(rk);
    const pairOf = (a, b) => rc.pairs.find((p) => (p.a.id === a && p.b.id === b) || (p.a.id === b && p.b.id === a));
    ok('one entry per pair of the rack\'s devices', rc.pairs.length === 4 && rc.pairs.map((p) => `${p.a.id}-${p.b.id}`).join() === 'fw-sw,sw-srv,sw-db,sw-nas', rc.pairs.map((p) => `${p.a.id}-${p.b.id}`).join());
    ok('two cables between the same two are one pair, both in it', pairOf('sw', 'srv').links.map((l) => l.id).join() === 'l2,l3');
    ok('a device with no unit still has its pair', !!pairOf('sw', 'nas'));
    ok('one stub per far device', rc.stubs.map((s) => `${s.node.id}>${s.far.id}`).join() === 'sw>pc,sw>cam');
    ok('a rack with nothing cabled has none', json(rackCables(groupById('rk2'))) === json({ pairs: [], stubs: [] }));
    const txt = rackCableText(getLink('l1'), getNode('sw'));
    ok('a cable\'s text reads from the end asked', txt.ports === '24 ↔ eth0' && txt.label === 'C-UP' && txt.color === 'blue', json(txt));
    ok('and the other way round', rackCableText(getLink('l1'), getNode('fw')).ports === 'eth0 ↔ 24');

    // ---- 3: the findings ----
    ok('a rack placed as the view places has none', rackFindings().length === 0, json(rackFindings()));
    batch(() => { getNode('db').rackU = 31; save(); });   // over srv's U30–U31, the same face
    let rf = rackFindings();
    ok('two devices in the same units: critical, both named', rf.length === 1 && rf[0].level === 'bad' && json(rf[0].nodeIds.sort()) === json(['db', 'srv'])
       && /SRV and DB take the same units of Rack 3 \(U30–U31 front, half depth; U31–U32 front, half depth\)\./.test(rf[0].detail) && rf[0].subject === 'SRV, DB', json(rf));
    ok('and the view marks both', (openRackView('rk'), dev('db').classList.contains('rk-bad') && dev('srv').classList.contains('rk-bad')));
    undo();
    batch(() => { getNode('pdu').rackU = 2; save(); });   // behind the full-depth UPS
    rf = rackFindings();
    ok('one behind a full-depth device: critical, and it says why', rf.length === 1 && rf[0].level === 'bad' && /fills the rack front to back/.test(rf[0].detail), json(rf));
    undo();
    batch(() => { getNode('srv').rackU = 42; save(); });   // 2U from U42
    rf = rackFindings();
    ok('a device going past the top', rf.length === 1 && rf[0].level === 'bad' && rf[0].detail === 'It is 2U tall from U42, so it goes past U42, the top of Rack 3.', json(rf));
    renderRackView(true);
    ok('the rack view marks it', dev('srv').classList.contains('rk-bad'));
    undo();
    batch(() => { getNode('pc').rackDepth = 'half'; save(); });
    rf = rackFindings();
    ok('a depth with no rack is a rack field with no rack', rf.length === 1 && rf[0].level === 'warn' && /in no rack|is not a rack/.test(rf[0].detail), json(rf));
    undo();
    ok('undone, none again', rackFindings().length === 0);

    // ---- 4: the lane ----
    setView('rack');
    openRackView('rk');
    select(null);
    renderRackView(true);
    ok('one line per pair of placed devices and per stub', wires().length === 5 && lbls().length === 5, `${wires().length} ${lbls().length}`);
    ok('a device with no unit has no line yet', !lbl('l7'));
    const bundle = lbl('l2 l3');
    ok('a bundle is one line, counted, with each cable\'s ports', !!bundle && bundle.textContent.trim() === '×2 eth0 ↔ 1, eth1 ↔ 2', bundle && bundle.textContent.trim());
    ok('at its quieter end: the server\'s ports first', /^×2 eth0/.test(bundle.textContent.trim()));
    const up = lbl('l1');
    ok('a cable\'s label is on its line, with a swatch of its colour', up.textContent.trim() === 'eth0 ↔ 24 · C-UP' && !!up.querySelector('.rk-swatch'), up.textContent.trim());
    ok('and the line is drawn in it', wires().some((w) => /stroke:\s*blue/.test(w.getAttribute('style') || '')));
    const odd = lbl('l4');
    ok('a colour the browser does not know is written, not drawn', odd.textContent.trim() === 'eth0 ↔ 3 · not a colour' && !odd.querySelector('.rk-swatch'), odd.textContent.trim());
    const stub = lbl('l5');
    ok('a stub per far device, labelled with it', stub.textContent.trim() === '→ PC' && stub.classList.contains('rk-lbl-stub')
       && /SW → PC \(Office\)/.test(stub.title) && lbl('l6').textContent.trim() === '→ CAM', stub.title);
    ok('a bundle is drawn thicker', Number(wires().find((w) => w.classList.contains('rk-wire') && !w.classList.contains('rk-stub') && w.getAttribute('stroke-width') !== '1.5')?.getAttribute('stroke-width')) > 1.5);
    // Round 2: labels are placed in pixels over the faces (rvDrawCables).
    const ys = lbls().map((b) => parseFloat(b.style.top)).sort((a, b) => a - b);
    ok('no two labels at one height', ys.every((y, i) => !i || y - ys[i - 1] >= RV_LBL_PX - 0.001), json(ys));
    selectEntries([{ type: 'node', id: 'srv' }]);
    renderRackView(true);
    ok('the selected device\'s lines are lit, only those', lbl('l2 l3').classList.contains('rk-wsel') && !lbl('l1').classList.contains('rk-wsel'));
    setQuery('name:fw');
    renderRackView(true);
    ok('the search dims the lines it does not match', lbl('l2 l3').classList.contains('q-dim'));
    setQuery('');
    lbl('l1').click();
    ok('a label selects its cable', state.selectedType === 'link' && state.selectedId === 'l1');
    ok('and the rail shows its port picker', !el('linkPortProps').classList.contains('hidden') && el('linkPortBody').querySelectorAll('.port-chip').length > 0);
    lbl('l2 l3').click();
    ok('a bundle\'s label selects both', selectedOf('link').sort().join() === 'l2,l3');
    ok('the faces and the lane line up unit for unit', (() => {
      const a = view().querySelector('.rk-slots[data-face="front"]').getBoundingClientRect(), b = view().querySelector('.rk-lane-in').getBoundingClientRect();
      return Math.abs(a.top - b.top) < 1 && Math.abs(a.height - b.height) < 1;
    })());

    // ---- 5: drawing a cable ----
    select(null);
    renderRackView(true);
    const before = state.links.length, depth = undoDepth();
    const plug = dev('srv').querySelector('.rk-plug');
    ok('every device has a plug on its lane side', !!plug && plug.dataset.face === 'front' && !!view().querySelector('.rk-dev[data-node="pdu"] .rk-plug[data-face="rear"]'));
    dev('db').scrollIntoView({ block: 'center' });
    let [x0, y0] = mid(dev('srv').querySelector('.rk-plug'));
    let [x1, y1] = mid(dev('db'));
    ptr('pointerdown', dev('srv').querySelector('.rk-plug'), x0, y0);
    ptr('pointermove', window, x0, y0 + 10);
    ptr('pointermove', window, x1, y1);
    ok('while drawing, a line follows and the device under it is marked', !!document.querySelector('.rk-cabling') && dev('db').classList.contains('rk-target'));
    ptr('pointerup', window, x1, y1);
    const made = state.links[state.links.length - 1];
    ok('let go on another device: a cable between them', state.links.length === before + 1 && made.source === 'srv' && made.target === 'db' && !document.querySelector('.rk-cabling'));
    ok('on free ports bindLink picked', !!made.sourceIface && !!made.targetIface && made.sourceIface !== 'i1' && made.sourceIface !== 'i2', json(made));
    ok('one undo step', undoDepth() === depth + 1);
    ok('selected, with the rail on its port picker', state.selectedType === 'link' && state.selectedId === made.id && !el('linkPortProps').classList.contains('hidden'));
    ok('and drawn in the lane', !!lbl(made.id));
    undo();
    ok('undone: gone', state.links.length === before && !getLink(made.id));
    renderRackView(true);
    [x0, y0] = mid(dev('srv').querySelector('.rk-plug'));
    ptr('pointerdown', dev('srv').querySelector('.rk-plug'), x0, y0);
    ptr('pointermove', window, x0 + 60, y0 + 30);
    ptr('pointerup', window, x0 + 60, y0 + 30);
    ok('let go on nothing: nothing', state.links.length === before && undoDepth() === depth && !document.querySelector('.rk-cabling'));
    [x0, y0] = mid(dev('srv').querySelector('.rk-plug'));
    ptr('pointerdown', dev('srv').querySelector('.rk-plug'), x0, y0);
    ptr('pointermove', window, x0, y0 + 2);
    ptr('pointermove', window, mid(dev('srv'))[0], mid(dev('srv'))[1]);
    ptr('pointerup', window, mid(dev('srv'))[0], mid(dev('srv'))[1]);
    ok('nor on itself', state.links.length === before);
    await new Promise((r) => setTimeout(r, 0));   // the click a drag leaves behind has gone

    selectEntries([{ type: 'node', id: 'fw' }]);
    renderRackView(true);
    const cableBtn = () => view().querySelector('.rk-selbar [data-rk="cable"]');
    ok('the selected device has Cable to…', !!cableBtn() && cableBtn().textContent.trim() === 'Cable to…');
    cableBtn().click();
    ok('pressed: it waits for the other end, and says so', view().classList.contains('rk-arming') && dev('fw').classList.contains('rk-armed')
       && /tap the device at the other end/.test(view().querySelector('.rk-armnote').textContent) && cableBtn().textContent.trim() === 'Cancel cable');
    view().querySelector('.rk-selbar').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    ok('Escape lets it go', !view().classList.contains('rk-arming') && state.links.length === before);
    cableBtn().click();
    dev('fw').click();
    ok('so does a tap on the same device', !view().classList.contains('rk-arming') && state.links.length === before);
    cableBtn().click();
    dev('db').click();
    const tapped = state.links[state.links.length - 1];
    ok('a tap on another device cables them, in one step', state.links.length === before + 1 && tapped.source === 'fw' && tapped.target === 'db' && undoDepth() === depth + 1);
    ok('and leaves it waiting no more, the cable selected', !view().classList.contains('rk-arming') && state.selectedId === tapped.id);
    undo();

    // ---- 6: full depth in the view ----
    select(null);
    renderRackView(true);
    ok('a full-depth device\'s back is on the other face', !!back('ups') && back('ups').closest('.rk-slots').dataset.face === 'rear'
       && dev('ups').closest('.rk-slots').dataset.face === 'front' && /back/.test(back('ups').textContent));
    ok('its units there are not free', ![...view().querySelectorAll('.rk-slots[data-face="rear"] .rk-free')].some((f) => Number(f.dataset.lo) <= 3));
    clearToast();
    ok('placing behind it is refused', placeInRack('rk', { u: 2, height: 1, face: 'rear' }, { nodeId: 'nas' }) === null && /taken by UPS/.test(toast()));
    back('ups').click();
    ok('its back selects it', state.selectedType === 'node' && state.selectedId === 'ups');
    const depthBtn = () => view().querySelector('.rk-selbar [data-rk="depth"]');
    ok('the selected device says it is full depth', depthBtn().classList.contains('active') && depthBtn().getAttribute('aria-pressed') === 'true' && depthBtn().textContent.trim() === 'Full depth');
    let d0 = undoDepth();
    depthBtn().click();
    ok('made half depth: one step, no back, the button no longer pressed', getNode('ups').rackDepth === 'half' && !back('ups') && undoDepth() === d0 + 1
       && depthBtn().getAttribute('aria-pressed') === 'false');
    undo();
    selectEntries([{ type: 'node', id: 'sw' }]);
    renderRackView(true);
    batch(() => { getNode('pdu').rackU = 39; save(); });   // behind the switch
    renderRackView(true);
    clearToast();
    d0 = undoDepth();
    depthBtn().click();
    ok('full depth over a device behind it is refused, with why', getNode('sw').rackDepth === 'half' && /PDU is behind it/.test(toast()) && undoDepth() === d0);
    undo();
    renderRackView(true);
    depthBtn().click();
    ok('with nothing behind it, it is made full depth', !('rackDepth' in getNode('sw')) && !!back('sw'));
    undo();
    // The device editor's box.
    select('db', 'node');
    ok('the device editor has a Full depth box, off for a half-depth one', !el('propRackDepth').checked && !el('rackPlaceRow').classList.contains('hidden'));
    el('propRackDepth').checked = true;
    el('propRackDepth').dispatchEvent(new Event('change', { bubbles: true }));
    ok('ticked: full depth, nothing stored', !('rackDepth' in getNode('db')) && rackFullDepth(getNode('db')));
    undo();
    ok('undone', getNode('db').rackDepth === 'half');
    select('ups', 'node');
    ok('ticked for one that says nothing: full is the default', el('propRackDepth').checked);
    let d1 = undoDepth();
    el('propRackDepth').checked = false;
    el('propRackDepth').dispatchEvent(new Event('change', { bubbles: true }));
    ok('unticked: half, one undo step', getNode('ups').rackDepth === 'half' && undoDepth() === d1 + 1);
    undo();
    ok('undone, full again', !('rackDepth' in getNode('ups')));
    // The spreadsheet.
    const sheet = csvDevicesSheet();
    const col = sheet.headers.indexOf('rack_depth');
    ok('devices.csv has rack_depth after rack_face: full or half in a rack, blank elsewhere', col === sheet.headers.indexOf('rack_face') + 1
       && sheet.rows.find((r) => r[0] === 'ups')[col] === 'full' && sheet.rows.find((r) => r[0] === 'srv')[col] === 'half'
       && sheet.rows.find((r) => r[0] === 'pc')[col] === '');
    const sh = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
    const s1 = sh('name,rack_depth\nSRV,full depth\nUPS,half\nDB,half');
    const p1 = csvPlan(s1, csvAutoMap(s1));
    ok('read back by its words: full clears half, half is stored, the same is no change', csvAutoMap(s1).includes('rackDepth')
       && p1.rows[0].changes.some((c) => c.before === 'half depth' && c.after === 'full depth')
       && p1.rows[1].changes.some((c) => c.before === 'full depth' && c.after === 'half depth') && !p1.rows[2].changes.length, json(p1.rows.map((r) => r.changes)));
    // The sheet this build writes reads back as what it wrote.
    const round = csvPlan(sh(csvText(sheet)), csvAutoMap(sh(csvText(sheet))));
    ok('its own sheet reads back with no depth change', !round.rows.some((r) => r.changes.some((c) => c.field === 'Rack depth')), json(round.rows.map((r) => r.changes)));
    ok('a word that is neither is refused', csvPlan(sh('name,rack_depth\nSRV,sideways'), ['name', 'rackDepth']).rows[0].notes.length + csvPlan(sh('name,rack_depth\nSRV,sideways'), ['name', 'rackDepth']).rows[0].status.length > 0
       && /sideways/.test(json(csvPlan(sh('name,rack_depth\nSRV,sideways'), ['name', 'rackDepth']).rows[0])));
    ok('a block leaves it behind', (() => { const n = dropBlockPlace(cloneData(getNode('ups'))); return !('rackDepth' in n) && !('group' in n); })());

    // ---- 7: the report ----
    let html = reportHtml(reportModel(), null);
    ok('the report has a Racks section after the inventory', html.includes('>Racks<') && html.indexOf('>Racks<') > html.indexOf('>Device inventory<'));
    ok('a rack with front and rear', (html.match(/class="elev"/g) || []).length === 2 && /Server room \/ Rack 3 <span class="muted">42U · 19″<\/span>/.test(html)
       && html.includes('<th colspan="2">Front</th>') && html.includes('<th colspan="2">Rear</th>'));
    ok('an empty rack is left out', !/Rack 4 <span class="muted">/.test(html));
    const model = reportModel();
    const front = model.racks[0].faces[0], rear = model.racks[0].faces[1];
    ok('a unit a row, from the top', front.rows[0].u === 42 && front.rows.reduce((a, r) => a + r.span, 0) === 42 && rear.rows.reduce((a, r) => a + r.span, 0) === 42);
    ok('a device is one cell over its units', front.rows.some((r) => r.span === 2 && r.u === 31 && r.items[0].name === 'SRV') && html.includes('rowspan="2"'));
    ok('the back of a full-depth device on the rear', rear.rows.some((r) => r.u === 3 && r.span === 3 && r.items[0].back && r.items[0].name === 'UPS'));
    ok('not placed yet, under it', html.includes('<b>Not placed yet:</b> NAS'));
    ok('its cables, a pair a line, the stubs by the far device', html.includes('SW ↔ SRV <span class="muted">×2</span>') && html.includes('SW → PC <span class="muted">(Office)</span>'));
    batch(() => { getNode('db').rackU = 31; save(); });
    const clash = reportModel().racks[0].faces[0].rows.find((r) => r.clash);
    html = reportHtml(reportModel(), null);
    ok('a unit two devices claim is marked, both named', !!clash && clash.items.map((i) => i.name).sort().join() === 'DB,SRV' && html.includes('class="rs clash"'));
    undo();
    replaceDocument({ v: DOC_VERSION, nodes: [N('a', 'pc')], links: [] }, { origin: 'file', docId: 'no-racks' });
    ok('no racks, no section', !reportHtml(reportModel(), null).includes('>Racks<'));

    // ---- 8: read-only, Spanish ----
    replaceDocument(site(DOC_VERSION + 1), { origin: 'file', docId: 'rack-cables-ro' });
    openRackView('rk');
    selectEntries([{ type: 'node', id: 'srv' }]);
    renderRackView(true);
    ok('read-only: no plug and Cable to… disabled', !view().querySelector('.rk-plug') && view().querySelector('.rk-selbar [data-rk="cable"]').disabled);
    ok('the lines are still drawn', lbls().length === 5);
    ok('nor is one made', createRackCable('srv', 'db') === null && state.links.length === 7);
    open();
    openRackView('rk');
    setLocale('es'); applyStaticI18n(); renderRackView(true);
    selectEntries([{ type: 'node', id: 'ups' }]);
    ok('es: the lane, the buttons and the back speak Spanish', view().querySelector('.rk-lane .rk-cap').textContent === 'Cables'
       && view().querySelector('.rk-selbar [data-rk="cable"]').textContent.trim() === 'Cablear a…' && /parte trasera/.test(back('ups').textContent)
       && rackSpanText(getNode('ups')) === 'U1–U3 frontal' && rackSpanText(getNode('pdu')) === 'U36 trasera, media profundidad');
    batch(() => { getNode('db').rackU = 31; save(); });
    ok('es: the overlap finding', rackFindings().some((f) => /ocupan las mismas unidades de Rack 3/.test(f.detail)));
    undo();
    setLocale('en'); applyStaticI18n(); renderRackView(true);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
