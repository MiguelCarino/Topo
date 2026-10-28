// The rack view, round 2 item 2 (Review-Packs/Topo-groups.md, "Round 2"):
// bringing devices in and taking them out by dragging (js/rackview.js,
// "Bringing devices in and taking them out"). Pointer events go to the
// elements a hand would press and move on the window, as the browser sends
// them. What is held here:
//   1. a device under Not placed yet dragged onto the units goes there, its
//      own height, centred on the pointer, with the units outlined and its
//      name following the pointer while dragged; one undo step;
//   2. a device from Other devices dragged in joins the rack and is placed
//      (said in a toast); undone in one step, back where it was; taken units
//      are outlined red and refused, and nothing is written;
//   3. a finger drags a row by its handle only; the rest scrolls;
//   4. a placed device dragged off the units shows two targets: Not placed
//      yet keeps it in the rack with no units, Out of the rack puts it in the
//      room the rack is in; let go beside the rack, it goes back;
//   5. the taps: Other devices' Place, the selected device's Out of the
//      rack; the filter keeps its focus; a read-only document has no
//      handles; the words are translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = (v = DOC_VERSION) => ({ v,
    nodes: [
      N('fw', 'firewall', { x: 0, y: 0, group: 'rk', rackU: 40 }),
      N('srv', 'server', { x: 200, y: 0, group: 'rk', rackU: 10, rackHeight: 2 }),
      N('nas', 'server', { x: 400, y: 0, group: 'rk', rackHeight: 2 }),
      N('pc', 'pc', { x: 0, y: 300 }),
      N('cam', 'camera', { x: 100, y: 300, group: 'off' }),
      N('far', 'server', { x: 600, y: 0, group: 'rk2', rackU: 3 })
    ],
    links: [],
    groups: [
      { id: 'room', name: 'Server room', kind: 'room' },
      { id: 'rk', name: 'Rack 3', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'rk2', name: 'Rack 4', kind: 'rack', uHeight: 24 },
      { id: 'off', name: 'Office', kind: 'room' }
    ] });
  const open = (v) => { replaceDocument(site(v), { origin: 'file', docId: 'rackdrop-doc' }); openRackView('rk'); };
  const view = () => el('rackView');
  const dev = (id) => view().querySelector(`.rk-dev:not(.rk-back)[data-node="${id}"]`);
  const slots = (face) => view().querySelector(`.rk-slots[data-face="${face}"]`);
  const row = (id) => view().querySelector(`.rk-un-name[data-node="${id}"]`);
  const handle = (id) => view().querySelector(`.rk-handle[data-drag="${id}"]`);
  const others = () => view().querySelector('details.rk-others');
  const place = (id) => { const n = getNode(id); return n && Number.isInteger(n.rackU) ? `${n.rackU}+${rackHeightOf(n)}${rackFaceOf(n)[0]}` : '-'; };
  const toast = () => el('topoToast').textContent;
  const clearToast = () => { el('topoToast').textContent = ''; };
  const yOf = (face, u) => { const r = slots(face).getBoundingClientRect(); return r.top + r.height - (u - 0.5) * (r.height / 42); };
  const xOf = (face) => { const r = slots(face).getBoundingClientRect(); return r.left + r.width / 2; };
  const mid = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const ptr = (type, target, x, y, extra = {}) => target.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9, pointerType: 'mouse', isPrimary: true }, extra)));
  // Press on `from`, move to (x, y) in two steps, and (unless held) let go.
  const drag = (from, x, y, hold, extra) => {
    const [x0, y0] = mid(from);
    ptr('pointerdown', from, x0, y0, extra);
    ptr('pointermove', window, (x0 + x) / 2, (y0 + y) / 2, extra);
    ptr('pointermove', window, x, y, extra);
    if (!hold) ptr('pointerup', window, x, y, extra);
  };
  const ghost = (face) => slots(face).querySelector('.rk-ghost');

  try {
    open();
    ok('the rack view is open on Rack 3', rackShown() && el('rackPicker').value === 'rk');
    ok('Not placed yet\'s rows have a handle', !!handle('nas'));

    // ---- 1: Not placed yet onto the units ----
    let undoAt = _undoStack.length;
    drag(row('nas'), xOf('front'), yOf('front', 20), true);
    ok('dragged over the front, its units are outlined: two, centred on the pointer', !!ghost('front')
      && ghost('front').style.getPropertyValue('--u') === '20' && ghost('front').style.getPropertyValue('--h') === '2',
      ghost('front') && ghost('front').getAttribute('style'));
    ok('free units: not refused', !ghost('front').classList.contains('rk-refused'));
    ok('its name follows the pointer', !!document.querySelector('body > .rk-chip') && /NAS/.test(document.querySelector('body > .rk-chip').textContent));
    ptr('pointerup', window, xOf('front'), yOf('front', 20));
    ok('let go, it is placed there', place('nas') === '20+2f', place('nas'));
    ok('the outline and the name are gone', !ghost('front') && !document.querySelector('.rk-chip'));
    ok('one undo step', _undoStack.length === undoAt + 1);
    ok('drawn on the units and selected', !!dev('nas') && dev('nas').classList.contains('rk-sel'));
    undo();
    ok('undone, it is not placed again', place('nas') === '-' && getNode('nas').group === 'rk');

    // A press on the row that does not travel is a click: it selects.
    const [rx, ry] = mid(row('nas'));
    ptr('pointerdown', row('nas'), rx, ry);
    ptr('pointerup', window, rx, ry);
    row('nas').click();
    ok('a press without a drag selects it, as before', state.selectedId === 'nas' && place('nas') === '-');

    // ---- 2: Other devices onto the units ----
    ok('Other devices lists the devices not in this rack, shut at first', !!others() && !others().open
      && [...others().querySelectorAll('.rk-un-name')].map((b) => b.dataset.node).join() === 'pc,cam,far');
    others().querySelector('summary').click();
    await tick();
    ok('opened, it stays open across a redraw', others().open && (renderRackView(true), others().open));
    clearToast();
    undoAt = _undoStack.length;
    drag(row('pc'), xOf('rear'), yOf('rear', 30));
    ok('a device in no group dragged onto the rear is placed there', place('pc') === '30+1r', place('pc'));
    ok('and joins the rack', getNode('pc').group === 'rk');
    ok('as a toast says', /PC is in Rack 3 now\./.test(toast()), toast());
    ok('in one undo step', _undoStack.length === undoAt + 1);
    undo();
    ok('undone, it is in no group and has no units', !getNode('pc').group && !hasRackFields(getNode('pc')));

    // From another rack, onto taken units: refused.
    clearToast();
    undoAt = _undoStack.length;
    // U40 in the middle of the units' pane first: narrow, the pane is short
    // (the column scrolls, the units stuck to its top), and a pointer over a
    // unit near its edge scrolls it as a drag in should (rvBringDrag), so the
    // unit under it would no longer be U40 by the release.
    { const m = view().querySelector('.rk-main'), r = m.getBoundingClientRect(); m.scrollTop += yOf('front', 40) - (r.top + r.height / 2); }
    drag(row('far'), xOf('front'), yOf('front', 40), true);
    ok('over taken units, the outline is refused', ghost('front') && ghost('front').classList.contains('rk-refused'));
    ptr('pointerup', window, xOf('front'), yOf('front', 40));
    ok('let go, nothing is written', getNode('far').group === 'rk2' && place('far') === '3+1f' && _undoStack.length === undoAt);
    ok('and a toast says by what', /taken by FW/.test(toast()), toast());
    // Let go beside the rack: nothing.
    drag(row('cam'), 5, 5);
    ok('let go off the units, nothing is written', getNode('cam').group === 'off' && _undoStack.length === undoAt);

    // ---- 3: a finger ----
    drag(row('cam'), xOf('front'), yOf('front', 25), false, { pointerType: 'touch' });
    ok('a finger on the row\'s name scrolls: nothing is dragged', getNode('cam').group === 'off' && !document.querySelector('.rk-chip'));
    drag(handle('cam'), xOf('front'), yOf('front', 25), false, { pointerType: 'touch' });
    ok('a finger on its handle drags it in', getNode('cam').group === 'rk' && place('cam') === '25+1f', place('cam'));
    ok('the handle takes the touch (touch-action: none)', getComputedStyle(handle('nas')).touchAction === 'none');
    undo();
    ok('(undone)', getNode('cam').group === 'off' && place('cam') === '-');

    // ---- 4: a placed device off the units ----
    select('srv', 'node');
    drag(dev('srv'), xOf('front'), yOf('front', 30), true);
    const dock = view().querySelector('.rk-dock');
    ok('dragged, a placed device shows the two targets off the rack', !!dock
      && [...dock.querySelectorAll('[data-zone]')].map((z) => z.dataset.zone).join() === 'out,leave');
    ok('Out of the rack says where it goes', /It stays in Server room, with no units\./.test(dock.querySelector('[data-zone="leave"]').textContent));
    const [ox, oy] = mid(dock.querySelector('[data-zone="out"]'));
    ptr('pointermove', window, ox, oy);
    ok('over Not placed yet, that target is lit', dock.querySelector('[data-zone="out"]').classList.contains('rk-over')
      && dev('srv').classList.contains('rk-leaving'));
    undoAt = _undoStack.length;
    ptr('pointerup', window, ox, oy);
    ok('let go there, it has no units but stays in the rack, its height kept', place('srv') === '-' && getNode('srv').group === 'rk' && getNode('srv').rackHeight === 2);
    ok('the targets are gone; one undo step', !view().querySelector('.rk-dock') && _undoStack.length === undoAt + 1);
    undo();
    ok('(undone)', place('srv') === '10+2f');

    clearToast();
    drag(dev('srv'), xOf('front'), yOf('front', 30), true);
    const [lx, ly] = mid(view().querySelector('.rk-dock [data-zone="leave"]'));
    ptr('pointermove', window, lx, ly);
    ptr('pointerup', window, lx, ly);
    ok('let go on Out of the rack, it is in the room the rack is in', getNode('srv').group === 'room');
    ok('with its units, height and face gone', !hasRackFields(getNode('srv')));
    ok('as a toast says', /SRV is in Server room now\./.test(toast()), toast());
    undo();
    ok('(undone)', getNode('srv').group === 'rk' && place('srv') === '10+2f');

    undoAt = _undoStack.length;
    drag(dev('srv'), xOf('front'), yOf('front', 30), true);
    const beside = slots('front').getBoundingClientRect().left - 80;
    ptr('pointermove', window, beside, yOf('front', 30));
    ok('beside the rack, the box goes back to its units', dev('srv').style.getPropertyValue('--u') === '10');
    ptr('pointerup', window, beside, yOf('front', 30));
    ok('let go there, nothing is written', place('srv') === '10+2f' && _undoStack.length === undoAt);
    drag(dev('srv'), xOf('front'), yOf('front', 30));
    ok('a drag that stays on the units still moves it', place('srv') === '30+2f', place('srv'));
    undo();

    // ---- 5: taps, the filter, read-only, language ----
    clearToast();
    view().querySelector('[data-rk="place"][data-node="pc"]').click();
    ok('Other devices\' Place joins the rack at the lowest free units', getNode('pc').group === 'rk' && place('pc') === '1+1f', place('pc'));
    undo();
    select('fw', 'node');
    const leave = view().querySelector('.rk-selbar [data-rk="leave"]');
    ok('the selected device has Out of the rack', !!leave && /Server room/.test(leave.title));
    leave.click();
    ok('which takes it out of the rack, into its room', getNode('fw').group === 'room' && !hasRackFields(getNode('fw')));
    undo();
    rackLeave(getNode('far'));
    ok('a rack at the top: out of it is in no group', !getNode('far').group);
    undo();

    if (!others().open) others().querySelector('summary').click();
    const filter = view().querySelector('[data-rk-filter]');
    filter.focus();
    filter.value = 'cam';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    ok('the filter narrows Other devices', [...others().querySelectorAll('.rk-un-name')].map((b) => b.dataset.node).join() === 'cam');
    ok('and keeps its focus', document.activeElement === filter);
    filter.value = '';
    filter.dispatchEvent(new Event('input', { bubbles: true }));

    open(DOC_VERSION + 1);
    ok('a read-only document has no handles and drags nothing in', !!state.readOnly && !view().querySelector('.rk-handle, [data-drag]'));

    open();
    setLocale('es'); applyStaticI18n(); renderRackView(true);
    drag(dev('srv'), xOf('front'), yOf('front', 30), true);
    ok('es: the targets', /Fuera del rack/.test(view().querySelector('.rk-dock').textContent)
      && /Dejarlo en Rack 3, sin unidades/.test(view().querySelector('.rk-dock').textContent), view().querySelector('.rk-dock') && view().querySelector('.rk-dock').textContent);
    ptr('pointerup', window, 5, 5);
    ok('es: Other devices', /Otros dispositivos/.test(others().textContent));
    ok('es: the hint', /Arrastra un dispositivo de las listas/.test(view().querySelector('.rk-hint').textContent));
    setLocale('en'); applyStaticI18n(); renderRackView(true);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    state.settings.view = savedView;
    try { setView('map'); } catch (e) { /* torn down */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
