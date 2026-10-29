// The rack view, step C part 1 (Review-Packs/Topo-groups.md; js/rackview.js).
// What is held here:
//   1. the units, pure (js/model.js): a device's span, a clash on the same
//      face only, outside the rack, the lowest free run;
//   2. the switch: Rack offered only while there is a rack and only in the
//      full editor; opened from the Groups tab, from the collapsed rack's
//      control on the map, and kept as the view while racks exist;
//   3. the drawing: units numbered from the bottom, front and rear, each
//      device a box on its units with its icon, name and status, a device
//      outside the rack or over another marked, the ones with no unit listed;
//   4. selection is the one selection, both ways;
//   5. the keyboard and the buttons: move, taller, shorter, the other face,
//      out of the rack; each one undo step; taken units refused;
//   6. the pointer: a dragged rectangle snaps to units and asks which device;
//      a dragged device moves and a dragged top edge resizes, by whole units,
//      one undo step each, and a drop on taken units is refused;
//   7. the place dialog: this rack's unplaced devices first, the filter, a
//      taken span refused, an existing device or a new one by type, one step;
//   8. a read-only document, the last rack deleted, another language, the
//      exports.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  // Every rack device here is half depth (one face): this suite is about
  // the faces as separate columns of units. Full depth, the default since
  // round 2, is held in rackcables.js and rackdepth.js.
  const H = { rackDepth: 'half' };
  const site = (v = DOC_VERSION) => ({ v,
    nodes: [
      N('fw', 'firewall', { x: 0, y: 0, group: 'rk', rackU: 40, ...H }),
      N('sw', 'switch', { x: 100, y: 0, group: 'rk', rackU: 38, portCount: 8, interfaces: [], ...H }),
      N('srv', 'server', { x: 200, y: 0, group: 'rk', rackU: 10, rackHeight: 2, ...H }),
      N('old', 'server', { x: 260, y: 0, group: 'rk', rackU: 14, rackHeight: 2, status: 'retired', ...H }),
      N('ups', 'custom', { x: 300, y: 0, group: 'rk', rackU: 1, rackHeight: 3, rackFace: 'rear', status: 'planned', ...H }),
      N('nas', 'server', { x: 400, y: 0, group: 'rk', ...H }),
      N('pc', 'pc', { x: 0, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.50/24' }] }),
      N('cam', 'camera', { x: 100, y: 300, group: 'off' }),
      N('far', 'server', { x: 600, y: 0, group: 'rk2', rackU: 3 })
    ],
    links: [{ id: 'l1', source: 'fw', target: 'sw', sourceIface: 'i1', targetIface: 'p1' }],
    groups: [
      { id: 'room', name: 'Server room', kind: 'room' },
      { id: 'rk', name: 'Rack 3', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'rk2', name: 'Rack 4', kind: 'rack', parent: 'room', uHeight: 24 },
      { id: 'off', name: 'Office', kind: 'room' }
    ] });
  const open = (doc = site()) => replaceDocument(doc, { origin: 'file', docId: 'rack-doc' });
  const view = () => el('rackView');
  const dev = (id) => view().querySelector(`.rk-dev[data-node="${id}"]`);
  const slots = (face) => view().querySelector(`.rk-slots[data-face="${face}"]`);
  const rackBtn = () => document.querySelector('#viewSwitch [data-view="rack"]');
  const place = (id) => { const n = getNode(id); return n && Number.isInteger(n.rackU) ? `${n.rackU}+${rackHeightOf(n)}${rackFaceOf(n)[0]}` : '-'; };
  const toast = () => el('topoToast').textContent;
  const clearToast = () => { el('topoToast').textContent = ''; };
  // The y of the middle of unit u on a face, as the pointer would be there.
  const yOf = (face, u) => { const r = slots(face).getBoundingClientRect(); const uh = r.height / rackTop(groupById(el('rackPicker').value)); return r.top + r.height - (u - 0.5) * uh; };
  const xOf = (face) => { const r = slots(face).getBoundingClientRect(); return r.left + r.width / 2; };
  const ptr = (type, target, x, y, extra = {}) => target.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7, pointerType: 'mouse', isPrimary: true }, extra)));
  const key = (target, k, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
  const undoDepth = () => _undoStack.length;

  try {
    // ---- 1: the units, pure ----
    open();
    const rk = groupById('rk');
    ok('a placed device spans its units', JSON.stringify(rackSpanOf(getNode('srv'))) === JSON.stringify({ lo: 10, hi: 11, face: 'front' }));
    ok('one with no unit has no span', rackSpanOf(getNode('nas')) === null);
    ok('units taken on the same face clash', rackClash(rk, 'front', 11, 12, null) === getNode('srv'));
    ok('the same units on the other face do not, for a half-depth one', rackClash(rk, 'rear', 10, 11, null, state.nodes, false) === null);
    ok('a new one is full depth unless it says, and meets it', rackClash(rk, 'rear', 10, 11, null) === getNode('srv'));
    ok('a device is never in its own way', rackClash(rk, 'front', 10, 12, 'srv') === null);
    ok('the rack\'s height bounds it', rackSpanCheck(rk, 'front', 42, 2, null).outside && rackSpanCheck(rk, 'front', 0, 1, null).outside
       && rackSpanCheck(rk, 'front', 41, 2, null).ok);
    ok('the lowest free run that fits', rackFirstFree(rk, 'front', 2, null, state.nodes, false) === 1 && rackFirstFree(rk, 'rear', 2, null, state.nodes, false) === 4
       && rackFirstFree(rk, 'front', 3, 'srv') === 1);
    ok('full depth, the default, needs both faces free', rackFirstFree(rk, 'front', 2, null) === 4);
    ok('none when nothing that tall is free', rackFirstFree(groupById('rk2'), 'front', 25, null) === null);
    ok('a rack\'s own devices', rackMembers(rk).map((n) => n.id).join() === 'fw,sw,srv,old,ups,nas');

    // ---- 2: the switch ----
    replaceDocument({ v: DOC_VERSION, nodes: [N('a', 'pc')], links: [] }, { origin: 'file', docId: 'no-rack' });
    ok('no rack: no Rack in the switch', rackBtn().hidden && !rackViewOffered());
    setView('rack');
    ok('and the view cannot be put on it', !rackShown() && state.settings.view !== 'rack');
    open();
    ok('a rack: Rack is offered', !rackBtn().hidden);
    ok('the view is still the map until asked', !rackShown());
    showConfigTab('groups');
    const card = el('groupList').querySelector('[data-act="rack"][data-grp="rk2"]');
    ok('a rack\'s card on the Groups tab has Open rack', !!card && !el('groupList').querySelector('[data-act="rack"][data-grp="room"]'));
    card.click();
    ok('which opens the rack view on that rack', rackShown() && el('rackPicker').value === 'rk2' && rackBtn().getAttribute('aria-pressed') === 'true'
       && document.body.classList.contains('rack-view'));
    ok('kept as the visitor\'s view', state.settings.view === 'rack' && effectiveView() === 'rack');
    ok('the picker lists every rack by its path', [...el('rackPicker').options].map((o) => o.textContent).join('|') === 'Server room / Rack 3|Server room / Rack 4');
    el('rackPicker').value = 'rk';
    el('rackPicker').dispatchEvent(new Event('change', { bubbles: true }));
    ok('picking another shows it', !!dev('srv') && !dev('far'));
    showConfigTab('config');
    setView('map');
    ok('Map puts the map back', !rackShown() && !document.body.classList.contains('rack-view'));
    // The collapsed rack's control on the map.
    setGroupCollapsed('rk', true);
    const opener = document.querySelector('#layer-nodes > .grp-rack-open[data-grp="rk"]');
    ok('a collapsed rack has Open rack beside it', !!opener && !document.querySelector('#layer-nodes > .grp-rack-open[data-grp="off"]'));
    ok('which is a control, not drawing: not in the SVG export', !/grp-rack-open/.test(canvasSvgMarkup(1).markup));
    opener.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('and opens the rack view on it', rackShown() && el('rackPicker').value === 'rk');
    setGroupCollapsed('rk', false);
    rackBtn().click();
    ok('the switch\'s Rack is a toggle like the others', rackShown());

    // ---- 3: the drawing ----
    const nums = [...slots('front').parentElement.querySelectorAll('.rk-units li')].map((li) => li.textContent);
    ok('the units are numbered from the bottom', nums.length === 42 && nums[0] === '42' && nums[41] === '1');
    ok('front and rear side by side', !!slots('front') && !!slots('rear') && slots('front').getBoundingClientRect().top === slots('rear').getBoundingClientRect().top);
    ok('each device on its face', slots('front').contains(dev('srv')) && slots('rear').contains(dev('ups')));
    ok('a box on its lowest unit, as tall as its units', dev('srv').style.getPropertyValue('--u') === '10' && dev('srv').style.getPropertyValue('--h') === '2');
    const fr = slots('front').getBoundingClientRect(), br = dev('srv').getBoundingClientRect();
    const uh = fr.height / 42;
    ok('drawn over those units', Math.abs(fr.bottom - br.bottom - 9 * uh) < 2 && Math.abs(br.height - 2 * uh) < 3, `${fr.bottom - br.bottom} ${br.height} ${uh}`);
    ok('with its type\'s icon, its name and its units', !!dev('srv').querySelector('svg.rk-ico') && dev('srv').querySelector('.rk-name').textContent === 'SRV'
       && dev('srv').querySelector('.rk-span').textContent === 'U10–U11');
    ok('a retired one dimmed', dev('old').classList.contains('rk-retired') && Number(getComputedStyle(dev('old')).opacity) < 0.6
       && /Retired/.test(dev('old').textContent));
    ok('a planned one dashed', dev('ups').classList.contains('rk-planned') && getComputedStyle(dev('ups')).borderTopStyle === 'dashed');
    ok('nothing marked when nothing is wrong', !view().querySelector('.rk-bad'));
    ok('the devices with no unit are listed as not placed', [...view().querySelectorAll('.rk-unplaced:not(.rk-others) .rk-un-name')].map((b) => b.dataset.node).join() === 'nas');
    ok('the head counts them', /42U · 19″ · 6 devices · 1 not placed/.test(el('rackCount').textContent), el('rackCount').textContent);
    ok('empty runs are there for the keyboard', [...slots('front').querySelectorAll('.rk-free')].some((b) => b.dataset.lo === '1' && b.dataset.hi === '9'));
    // A spreadsheet can say what the view cannot: shown, and marked.
    batch(() => { getNode('old').rackU = 11; getNode('fw').rackU = 50; save(); renderCanvasOnly(); });
    ok('two devices on the same units are both marked', dev('old').classList.contains('rk-bad') && dev('srv').classList.contains('rk-bad'));
    ok('one past the top is drawn inside it, marked', dev('fw').classList.contains('rk-bad') && dev('fw').style.getPropertyValue('--u') === '42'
       && /outside/.test(dev('fw').title));
    undo();
    ok('and unmarked again', !view().querySelector('.rk-bad') && place('old') === '14+2f');

    // ---- 4: one selection ----
    dev('srv').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    ok('a device clicked here is the selection', state.selectedId === 'srv' && state.selectedType === 'node');
    ok('and is drawn selected', dev('srv').classList.contains('rk-sel') && dev('srv').getAttribute('aria-pressed') === 'true');
    ok('the rail edits it', el('propName').value === 'SRV');
    dev('sw').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, shiftKey: true }));
    ok('Shift-click adds to it', inSelection('node', 'srv') && inSelection('node', 'sw') && state.selection.size === 2);
    selectEntries([{ type: 'node', id: 'old' }]);
    ok('selected on the map or in the table, selected here', dev('old').classList.contains('rk-sel') && !dev('srv').classList.contains('rk-sel'));
    ok('only the selected one has a grip', !!dev('old').querySelector('.rk-grip') && !dev('srv').querySelector('.rk-grip'));
    view().querySelector('.rk-un-name[data-node="nas"]').click();
    ok('a device not placed yet is selected from its list', state.selectedId === 'nas');

    // ---- 5: the keyboard and the buttons ----
    clearToast();
    let depth = undoDepth();
    dev('srv').focus();
    key(dev('srv'), 'ArrowUp');
    ok('ArrowUp moves the focused device up a unit', place('srv') === '11+2f' && undoDepth() === depth + 1);
    ok('the box follows and keeps the focus', dev('srv').style.getPropertyValue('--u') === '11' && document.activeElement === dev('srv'));
    key(dev('srv'), 'ArrowUp', { shiftKey: true });
    ok('Shift+ArrowUp makes it a unit taller', place('srv') === '11+3f');
    key(dev('srv'), 'ArrowUp', { shiftKey: true });
    ok('not into the device above it: refused, said why', place('srv') === '11+3f' && /taken by OLD/.test(toast()), toast());
    key(dev('srv'), 'ArrowDown', { shiftKey: true });
    key(dev('srv'), 'ArrowDown', { shiftKey: true });
    ok('Shift+ArrowDown shorter, down to one unit', place('srv') === '11+1f' && getNode('srv').rackHeight === undefined);
    key(dev('srv'), 'ArrowRight');
    ok('ArrowRight puts it on the rear', place('srv') === '11+1r' && slots('rear').contains(dev('srv')));
    key(dev('srv'), 'ArrowLeft');
    ok('ArrowLeft back on the front', place('srv') === '11+1f');
    ok('one undo step each', undoDepth() === depth + 6, `${undoDepth() - depth}`);
    undo(); undo();
    ok('Undo takes the steps back one at a time', place('srv') === '11+1f');
    while (place('srv') !== '10+2f' && undoDepth() > depth) undo();
    ok('back where it started', place('srv') === '10+2f');
    clearToast();
    dev('ups').focus();
    key(dev('ups'), 'ArrowDown');
    ok('not below unit 1', place('ups') === '1+3r' && /units 1 to 42/.test(toast()), toast());
    // The map's single-key shortcuts do not see the rack's keys.
    const trace = state.settings.traceMode;
    key(dev('ups'), 'ArrowUp');
    ok('the arrow keys are the rack\'s while it has the focus', place('ups') === '2+3r' && state.settings.traceMode === trace);
    undo();
    // Delete is the map's, as it is not the table's: the selection can hold
    // devices this rack does not show.
    selectEntries([{ type: 'node', id: 'ups' }, { type: 'node', id: 'pc' }]);
    key(dev('ups'), 'Delete');
    ok('Delete does nothing over the rack view', !!getNode('ups') && !!getNode('pc'));
    // The buttons, for a phone.
    selectEntries([{ type: 'node', id: 'sw' }]);
    const bar = () => view().querySelector('.rk-selbar');
    ok('the selected device gets the buttons', !!bar() && /SW/.test(bar().textContent) && /U38 front/.test(bar().textContent));
    depth = undoDepth();
    bar().querySelector('[data-rk="up"]').click();
    ok('▲ moves it up', place('sw') === '39+1f');
    bar().querySelector('[data-rk="taller"]').click();
    ok('and not into the device above', place('sw') === '39+1f');
    bar().querySelector('[data-rk="down"]').click();
    bar().querySelector('[data-rk="taller"]').click();
    ok('+1U makes it taller', place('sw') === '38+2f');
    bar().querySelector('[data-rk="shorter"]').click();
    bar().querySelector('[data-rk="face"]').click();
    ok('To the rear', place('sw') === '38+1r' && /To the front/.test(bar().textContent));
    bar().querySelector('[data-rk="out"]').click();
    ok('Clear its units: still in it, with no unit', getNode('sw').group === 'rk' && place('sw') === '-' && getNode('sw').rackFace === undefined
       && !!view().querySelector('.rk-un-name[data-node="sw"]'));
    ok('one undo step each', undoDepth() === depth + 6, `${undoDepth() - depth}`);
    view().querySelector('[data-rk="place"][data-node="sw"]').click();
    ok('Place puts it in the lowest free units that fit', place('sw') === '1+1f');
    undo(); undo();
    ok('Undo puts it back on the rear', place('sw') === '38+1r');
    while (place('sw') !== '38+1f' && undoDepth() > depth) undo();

    // ---- 6: the pointer ----
    // A rectangle over units 20 to 23 of the front, then the click.
    clearToast();
    ptr('pointerdown', slots('front'), xOf('front'), yOf('front', 20));
    ptr('pointermove', slots('front'), xOf('front'), yOf('front', 22));
    ptr('pointermove', slots('front'), xOf('front'), yOf('front', 23));
    const ghost = slots('front').querySelector('.rk-ghost');
    ok('dragging over empty units draws the rectangle, snapped to units', !!ghost && ghost.style.getPropertyValue('--u') === '20' && ghost.style.getPropertyValue('--h') === '4'
       && !ghost.classList.contains('rk-refused'));
    ptr('pointerup', slots('front'), xOf('front'), yOf('front', 23));
    ok('letting go asks nothing until the click lands', el('rackPlaceDialog').hidden);
    slots('front').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    ok('then asks which device goes in units 20 to 23', !el('rackPlaceDialog').hidden && el('rackPlaceU').value === '20' && el('rackPlaceHeight').value === '4'
       && el('rackPlaceFace').value === 'front' && /U20–U23 front/.test(el('rackPlaceMsg').textContent));
    closePlaceDialog();
    // Upwards from the top, over a device: refused.
    ptr('pointerdown', slots('front'), xOf('front'), yOf('front', 9));
    ptr('pointermove', slots('front'), xOf('front'), yOf('front', 12));
    ok('over a device the rectangle says no', slots('front').querySelector('.rk-ghost').classList.contains('rk-refused'));
    ptr('pointerup', slots('front'), xOf('front'), yOf('front', 12));
    slots('front').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    ok('and letting go there is refused, with why', el('rackPlaceDialog').hidden && /taken by SRV/.test(toast()), toast());
    // A device dragged up two units: one step.
    depth = undoDepth();
    const selBefore = [...state.selection].map((e) => e.id).join();
    ptr('pointerdown', dev('srv'), xOf('front'), yOf('front', 10));
    ptr('pointermove', dev('srv'), xOf('front'), yOf('front', 11.6));
    ok('a dragged device follows by whole units', dev('srv').style.getPropertyValue('--u') === '12' && dev('srv').classList.contains('rk-dragging'));
    ptr('pointermove', dev('srv'), xOf('front'), yOf('front', 12));
    ptr('pointerup', dev('srv'), xOf('front'), yOf('front', 12));
    dev('srv').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    ok('dropped, it is there, in one undo step', place('srv') === '12+2f' && undoDepth() === depth + 1);
    ok('the drag\'s click does not change the selection', [...state.selection].map((e) => e.id).join() === selBefore);
    clearToast();
    ptr('pointerdown', dev('srv'), xOf('front'), yOf('front', 12));
    ptr('pointermove', dev('srv'), xOf('front'), yOf('front', 14));
    ok('over another device it shows refused', dev('srv').classList.contains('rk-refused'));
    ptr('pointerup', dev('srv'), xOf('front'), yOf('front', 14));
    ok('and is refused on the drop', place('srv') === '12+2f' && /taken by OLD/.test(toast()) && undoDepth() === depth + 1);
    // Across to the rear.
    ptr('pointerdown', dev('srv'), xOf('front'), yOf('front', 12));
    ptr('pointermove', dev('srv'), xOf('rear'), yOf('rear', 12));
    ptr('pointerup', dev('srv'), xOf('rear'), yOf('rear', 12));
    ok('dragged onto the rear, it goes on the rear', place('srv') === '12+2r');
    undo();
    // The top edge of the selected one: down a unit, up a unit, and up into
    // the device above, refused.
    selectEntries([{ type: 'node', id: 'srv' }]);
    const gripDrag = (fromU, toU) => {
      const g = dev('srv').querySelector('.rk-grip');
      ptr('pointerdown', g, xOf('front'), yOf('front', fromU));
      ptr('pointermove', g, xOf('front'), yOf('front', toU));
      ptr('pointerup', g, xOf('front'), yOf('front', toU));
    };
    depth = undoDepth();
    gripDrag(13, 12);
    ok('its top edge dragged down makes it shorter, by whole units', place('srv') === '12+1f', place('srv'));
    gripDrag(12, 10);
    ok('never under one unit', place('srv') === '12+1f', place('srv'));
    gripDrag(12, 13.2);
    ok('dragged up, taller', place('srv') === '12+2f', place('srv'));
    clearToast();
    gripDrag(13, 14);
    ok('not into the device above: refused, with why', place('srv') === '12+2f' && /taken by OLD/.test(toast()), toast());
    ok('one undo step per resize', undoDepth() === depth + 2, String(undoDepth() - depth));
    gripDrag(13, 12);
    // A finger on a device scrolls: no drag.
    ptr('pointerdown', dev('srv'), xOf('front'), yOf('front', 12), { pointerType: 'touch' });
    ptr('pointermove', dev('srv'), xOf('front'), yOf('front', 16), { pointerType: 'touch' });
    ptr('pointerup', dev('srv'), xOf('front'), yOf('front', 16), { pointerType: 'touch' });
    ok('a finger on a device does not move it (it scrolls the rack)', place('srv') === '12+1f');
    // A tap on an empty unit asks for that one unit.
    ptr('pointerdown', slots('rear'), xOf('rear'), yOf('rear', 30), { pointerType: 'touch' });
    ptr('pointerup', slots('rear'), xOf('rear'), yOf('rear', 30), { pointerType: 'touch' });
    slots('rear').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    ok('a tap on an empty unit asks for it', !el('rackPlaceDialog').hidden && el('rackPlaceU').value === '30' && el('rackPlaceHeight').value === '1' && el('rackPlaceFace').value === 'rear');
    closePlaceDialog();
    // And a finger that scrolls asks nothing.
    ptr('pointerdown', slots('rear'), xOf('rear'), yOf('rear', 30), { pointerType: 'touch' });
    ptr('pointercancel', slots('rear'), xOf('rear'), yOf('rear', 26), { pointerType: 'touch' });
    await new Promise((r) => setTimeout(r, 400));
    ok('a finger that scrolls asks nothing', el('rackPlaceDialog').hidden);
    // The keyboard's way in: Enter on an empty run.
    const run = slots('front').querySelector('.rk-free[data-lo="1"]');
    run.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    ok('an empty run, from the keyboard, asks for its bottom unit', !el('rackPlaceDialog').hidden && el('rackPlaceU').value === '1' && el('rackPlaceHeight').value === '1');

    // ---- 7: the place dialog ----
    const items = () => [...el('rackPlaceList').querySelectorAll('.rkp-item')];
    ok('this rack\'s devices not placed yet first, then no group, then the rest', items().map((b) => b.dataset.node).join() === 'nas,pc,cam,far',
       items().map((b) => b.dataset.node).join());
    ok('each section named', [...el('rackPlaceList').querySelectorAll('.rkp-head')].map((h) => h.textContent).join('|')
       === 'In this rack, not placed yet|In no group|In another group: placing it here moves it');
    ok('a device in another group says where it is', /Office/.test(items()[2].textContent));
    el('rackPlaceFilter').value = 'cam';
    el('rackPlaceFilter').dispatchEvent(new Event('input', { bubbles: true }));
    ok('the filter narrows it', items().map((b) => b.dataset.node).join() === 'cam');
    el('rackPlaceFilter').value = '10.0.0.50';
    el('rackPlaceFilter').dispatchEvent(new Event('input', { bubbles: true }));
    ok('by address too', items().map((b) => b.dataset.node).join() === 'pc');
    el('rackPlaceFilter').value = '';
    el('rackPlaceFilter').dispatchEvent(new Event('input', { bubbles: true }));
    el('rackPlaceU').value = '12';
    el('rackPlaceU').dispatchEvent(new Event('input', { bubbles: true }));
    ok('units changed to taken ones: said, and nothing can be picked', /taken by SRV/.test(el('rackPlaceMsg').textContent) && items().every((b) => b.disabled)
       && el('rackPlaceNewBtn').disabled);
    el('rackPlaceU').value = '41'; el('rackPlaceHeight').value = '3';
    el('rackPlaceHeight').dispatchEvent(new Event('input', { bubbles: true }));
    ok('past the top: said', /units 1 to 42/.test(el('rackPlaceMsg').textContent) && items().every((b) => b.disabled));
    el('rackPlaceU').value = '20'; el('rackPlaceHeight').value = '2';
    el('rackPlaceHeight').dispatchEvent(new Event('input', { bubbles: true }));
    depth = undoDepth();
    items().find((b) => b.dataset.node === 'cam').click();
    const cam = getNode('cam');
    ok('a device picked goes in: moved out of its group into this rack', cam.group === 'rk' && place('cam') === '20+2f' && el('rackPlaceDialog').hidden);
    ok('selected, in one undo step', state.selectedId === 'cam' && undoDepth() === depth + 1 && dev('cam').classList.contains('rk-sel'));
    undo();
    ok('Undo puts it back in its group', getNode('cam').group === 'off' && place('cam') === '-');
    // A new device by type.
    const before = state.nodes.length;
    openPlaceDialog({ rackId: 'rk', face: 'rear', u: 20, height: 2 });
    ok('a new device starts as a server', el('rackPlaceType').value === 'server');
    el('rackPlaceType').value = 'switch';
    depth = undoDepth();
    el('rackPlaceNewBtn').click();
    const made = state.nodes[state.nodes.length - 1];
    ok('Add makes one of that type in those units', state.nodes.length === before + 1 && made.type === 'switch' && made.group === 'rk' && place(made.id) === '20+2r');
    ok('selected, on the map beside the rack, in one undo step', state.selectedId === made.id && undoDepth() === depth + 1 && Number.isFinite(made.x) && made.y > 0);
    undo();
    ok('Undo takes it away', state.nodes.length === before && !dev(made.id));
    // placeInRack itself refuses taken units.
    clearToast();
    ok('placing on taken units is refused', placeInRack('rk', { u: 12, height: 1, face: 'front' }, { nodeId: 'nas' }) === null && place('nas') === '-' && /taken/.test(toast()));
    ok('and an unknown type is not made', placeInRack('rk', { u: 30, height: 1, face: 'front' }, { type: 'toaster' }) === null);

    // ---- 8: read-only, the last rack, another language ----
    replaceDocument(site(DOC_VERSION + 1), { origin: 'file', docId: 'rack-ro' });
    ok('a read-only document opens on the rack view', !!state.readOnly && rackShown());
    ok('with no grips and no buttons that change it', (selectEntries([{ type: 'node', id: 'srv' }]), !dev('srv').querySelector('.rk-grip'))
       && [...view().querySelectorAll('.rk-selbar [data-rk]')].every((b) => b.disabled));
    key(dev('srv'), 'ArrowUp');
    ok('the keys change nothing', place('srv') === '10+2f');
    ok('nor does placing', placeInRack('rk', { u: 30, height: 1, face: 'front' }, { nodeId: 'nas' }) === null && place('nas') === '-');
    ptr('pointerdown', dev('srv'), xOf('front'), yOf('front', 10));
    ptr('pointermove', dev('srv'), xOf('front'), yOf('front', 13));
    ptr('pointerup', dev('srv'), xOf('front'), yOf('front', 13));
    ok('nor dragging', place('srv') === '10+2f');

    open();
    ok('back on a document: still the rack view', rackShown());
    showConfigTab('groups');
    setDialogResponder((req) => (req.kind === 'choice' ? 'ungroup' : true));
    await deleteGroup('rk2');
    ok('a rack deleted: the view moves to another', rackShown() && el('rackPicker').options.length === 1);
    await deleteGroup('rk');
    ok('the last rack deleted: back to the map, and no Rack in the switch', !rackShown() && rackBtn().hidden && effectiveView() === 'map');
    undo();
    ok('undone: the rack view again, as the visitor left it', rackShown() && !rackBtn().hidden);
    setDialogResponder(() => null);
    showConfigTab('config');

    state.settings.advanced = false; applyProfile();
    ok('a reduced view: no rack view and no Rack', !rackShown() && effectiveView() === 'map' && !rackViewOffered());
    state.settings.advanced = true; applyProfile();
    ok('back in the full editor, the rack view again', rackShown());

    setLocale('es'); applyStaticI18n(); renderRackView(true);
    ok('es: the faces, the head and the list speak Spanish', view().querySelector('.rk-face[data-face="front"] .rk-cap').textContent === 'Frontal'
       && /sin colocar/.test(el('rackCount').textContent) && rackBtn().textContent === 'Rack');
    ok('es: Open rack on the Groups tab', (renderGroupsPanel(true), true) && (showConfigTab('groups'), /Abrir rack/.test(el('groupList').textContent)));
    setLocale('en'); applyStaticI18n(); renderRackView(true);
    showConfigTab('config');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { closePlaceDialog(); } catch (e) { /* not open */ }
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
