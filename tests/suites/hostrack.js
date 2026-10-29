// VMs and containers in their hosts, in the rack view and the report
// (Review-Packs/Topo-groups.md, "Round 3", item 2; js/rackview.js "VMs and
// containers in their hosts"). Pointer events go to the elements a hand
// presses and move on the window, as the browser sends them. What is held:
//   1. a host draws what runs on it as chips in its box, a VM's container
//      after it; a box with no room counts the rest "+N", with at least one
//      chip in sight beside a long host name; the guests are not
//      under Not placed yet, and a VM there has no Place but a hint;
//   2. a click on a chip selects the guest, whose bar has Select its host
//      and Runs on nothing (one undo step);
//   3. a VM dragged from Not placed yet or Other devices onto a placed device
//      runs on it (the box lit while over it), joining the rack; let go on
//      empty units, or over a device it cannot run on (a switch), it is
//      refused with a hint and nothing is written; the place dialog does
//      not offer it; Other devices says where it goes;
//   4. a chip dragged off onto Runs on nothing runs on nothing; onto another
//      device, on that one; held at the foot of the pane it scrolls it; let
//      go anywhere else, nothing changes; a finger drags a chip too;
//   5. a cable to a guest is drawn to its host's box, labelled with the
//      guest; one between a guest and its own host is not drawn; a stub
//      from a guest names it;
//   6. the report's elevation lists what runs on each host, and Not placed
//      yet leaves the guests out; read-only drags nothing; es words.
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
      N('sw', 'switch', { group: 'rk', rackU: 40 }),
      N('hv', 'server', { group: 'rk', rackU: 20, rackHeight: 2 }),
      N('hv2', 'server', { group: 'rk', rackU: 10 }),
      N('vm1', 'vm', { host: 'hv' }),
      N('vm2', 'vm', { host: 'hv' }),
      N('ct1', 'container', { host: 'vm2' }),
      N('vmr', 'vm', { group: 'rk' }),
      N('vmo', 'vm', { x: 400 }),
      N('pc', 'pc', { x: 600 })
    ],
    links: [
      { id: 'l1', source: 'sw', target: 'vm1' },
      { id: 'l2', source: 'vm1', target: 'hv' },
      { id: 'l3', source: 'pc', target: 'ct1' }
    ],
    groups: [{ id: 'room', name: 'Server room', kind: 'room' }, { id: 'rk', name: 'Rack 3', kind: 'rack', parent: 'room', uHeight: 42 }] });
  const open = (v) => { replaceDocument(site(v), { origin: 'file', docId: 'hostrack-doc' }); openRackView('rk'); };
  const view = () => el('rackView');
  const dev = (id) => view().querySelector(`.rk-dev:not(.rk-back)[data-node="${id}"]`);
  const chips = (id) => [...dev(id).querySelectorAll('.rk-guest')];
  const chip = (id) => view().querySelector(`.rk-guest[data-guest="${id}"]`);
  const slots = (face) => view().querySelector(`.rk-slots[data-face="${face}"]`);
  const row = (id) => view().querySelector(`.rk-un-name[data-node="${id}"]`);
  const handle = (id) => view().querySelector(`.rk-handle[data-drag="${id}"]`);
  const others = () => view().querySelector('details.rk-others');
  const toast = () => el('topoToast').textContent;
  const clearToast = () => { el('topoToast').textContent = ''; };
  const mid = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const yOf = (face, u) => { const r = slots(face).getBoundingClientRect(); return r.top + r.height - (u - 0.5) * (r.height / 42); };
  const xOf = (face) => { const r = slots(face).getBoundingClientRect(); return r.left + r.width / 2; };
  const ptr = (type, target, x, y, extra = {}) => target.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9, pointerType: 'mouse', isPrimary: true }, extra)));
  // The units around `u` in the middle of the pane: a pointer near its edge scrolls it.
  const centre = (u) => { const m = view().querySelector('.rk-main'), r = m.getBoundingClientRect(); m.scrollTop += yOf('front', u) - (r.top + r.height / 2); };
  const drag = (from, to, hold, extra) => {
    const [x0, y0] = mid(from);
    ptr('pointerdown', from, x0, y0, extra);
    const [x, y] = typeof to === 'function' ? to() : to;
    ptr('pointermove', window, (x0 + x) / 2, (y0 + y) / 2, extra);
    const [x2, y2] = typeof to === 'function' ? to() : to;   // aimed again: the pane may have scrolled
    ptr('pointermove', window, x2, y2, extra);
    if (!hold) ptr('pointerup', window, x2, y2, extra);
    return [x2, y2];
  };
  // Aimed at a box in the middle of the pane, away from the bands at its
  // edges where a drag scrolls it (the test window is short: so is the pane).
  const onBox = (id) => () => {
    const m = view().querySelector('.rk-main'), r = m.getBoundingClientRect(), b = dev(id).getBoundingClientRect();
    m.scrollTop += (b.top + b.height / 2) - (r.top + r.height / 2);
    return mid(dev(id));
  };

  try {
    open();
    ok('the rack view is open', rackShown());

    // ---- 1: chips ----
    ok('HV draws what runs on it: two VMs and the container on one', json(chips('hv').map((c) => c.dataset.guest)) === json(['vm1', 'vm2', 'ct1']));
    ok('the container on the VM is marked so', chip('ct1').classList.contains('rk-guest-in') && !chip('vm1').classList.contains('rk-guest-in'));
    ok('a chip has the type\'s icon and the name', !!chip('vm1').querySelector('.rk-ico') && chip('vm1').textContent.trim() === 'VM1');
    ok('the box\'s tooltip names them all', /Runs here: VM1, VM2, CT1/.test(dev('hv').title), dev('hv').title);
    ok('the back of the box has no chips', !view().querySelector('.rk-dev.rk-back[data-node="hv"] .rk-guest'));
    const unplaced = [...view().querySelectorAll('.rk-unplaced:not(.rk-others) .rk-un-name')].map((b) => b.dataset.node);
    ok('Not placed yet lists the VM on no host, not the guests', json(unplaced) === json(['vmr']), json(unplaced));
    ok('the count says one not placed', /1 not placed/.test(el('rackCount').textContent), el('rackCount').textContent);
    const vmrRow = row('vmr').closest('li');
    ok('the VM\'s row has no Place, and says where it goes', !vmrRow.querySelector('[data-rk="place"]') && /Drag onto its host/.test(vmrRow.textContent));
    // Crowded: twelve VMs on a 1U box.
    const many = Array.from({ length: 12 }, (_, i) => N(`m${i}`, 'vm', { name: `VM-number-${i}`, host: 'hv2' }));
    // A long host name too: a full row had wrapped the chips off the 1U
    // box's only line behind it, leaving a bare "+12" or nothing.
    batch(() => { many.forEach((n) => state.nodes.push(n)); getNode('hv2').name = 'HV-2 hypervisor node'; save(); renderCanvasOnly(); });
    renderRackView(true);
    const shown = chips('hv2').filter((c) => !c.hidden).length, more = dev('hv2').querySelector('.rk-guest-more');
    ok('a 1U box with twelve: as many as fit, the rest counted', shown >= 1 && shown < 12 && !more.hidden && more.textContent === `+${12 - shown}`, `${shown} shown, ${more.textContent}`);
    ok('nothing shown spills out of the box', chips('hv2').filter((c) => !c.hidden).every((c) => c.getBoundingClientRect().right <= dev('hv2').getBoundingClientRect().right + 0.5));
    ok('the chip and the count are on the box\'s one line, in sight', [chips('hv2')[0], more].every((e) => e.getBoundingClientRect().bottom <= dev('hv2').getBoundingClientRect().bottom + 0.5),
       json([chips('hv2')[0], more].map((e) => e.getBoundingClientRect().bottom).concat(dev('hv2').getBoundingClientRect().bottom)));
    undo();
    renderRackView(true);
    ok('(undone)', !getNode('m0') && !dev('hv2').querySelector('.rk-guest'));

    // ---- 2: a chip selects its guest ----
    chip('vm1').click();
    ok('a click on a chip selects the guest, not its host', state.selectedId === 'vm1' && state.selection.size === 1);
    ok('the chip is marked selected', chip('vm1').classList.contains('rk-sel'));
    const bar = () => view().querySelector('.rk-selbar');
    ok('the guest\'s bar says where it runs', !!bar() && /Runs on HV · U20–U21 front/.test(bar().textContent), bar() && bar().textContent);
    ok('its lines are lit with it', [...view().querySelectorAll('.rk-cable.rk-wsel')].length >= 1);
    bar().querySelector('[data-rk="select"]').click();
    ok('Select its host selects HV', state.selectedId === 'hv');
    chip('vm1').click();
    let undoAt = _undoStack.length;
    clearToast();
    bar().querySelector('[data-rk="unhost"]').click();
    ok('Runs on nothing: it runs on nothing, one undo step', !getNode('vm1').host && _undoStack.length === undoAt + 1);
    ok('it stays in the rack, under Not placed yet', getNode('vm1').group === 'rk' && !!row('vm1'));
    ok('said in a toast', /VM1 runs on nothing now\. It stays in Rack 3, under Not placed yet\./.test(toast()), toast());
    undo();
    ok('(undone: back on HV)', getNode('vm1').host === 'hv' && !!chip('vm1'));
    select(null, null);

    // ---- 3: onto a host from the lists ----
    centre(10);
    undoAt = _undoStack.length;
    drag(row('vmr'), onBox('hv2'), true);
    ok('a VM dragged over a placed device lights it as its host', dev('hv2').classList.contains('rk-host-target'));
    ok('no units are outlined for it', !view().querySelector('.rk-ghost'));
    ptr('pointerup', window, ...mid(dev('hv2')));
    ok('let go, it runs on it, in one undo step', getNode('vmr').host === 'hv2' && _undoStack.length === undoAt + 1);
    ok('drawn as a chip in its box, gone from Not placed yet', !!dev('hv2').querySelector('.rk-guest[data-guest="vmr"]') && !row('vmr'));
    ok('the light is gone', !view().querySelector('.rk-host-target'));
    undo();
    // Onto empty units: refused.
    clearToast();
    undoAt = _undoStack.length;
    drag(row('vmr'), () => [xOf('front'), yOf('front', 15)], true);
    ok('over empty units, the name that follows says where it goes', !!document.querySelector('.rk-chip.rk-chip-refused') && /Drop it on the device it runs on/.test(document.querySelector('.rk-chip').textContent));
    ptr('pointerup', window, xOf('front'), yOf('front', 15));
    ok('let go there, nothing is written', !getNode('vmr').host && !Number.isInteger(getNode('vmr').rackU) && _undoStack.length === undoAt);
    ok('and a toast says why', /takes no units: drop it on the device it runs on/.test(toast()), toast());
    // Over a device a VM cannot run on (the core switch): not lit, refused
    // as units are. It had been taken as the VM's host.
    clearToast();
    drag(row('vmr'), onBox('sw'), true);
    ok('a VM over the switch does not light it', !dev('sw').classList.contains('rk-host-target') && !!document.querySelector('.rk-chip.rk-chip-refused'));
    ptr('pointerup', window, ...mid(dev('sw')));
    ok('let go there, it does not run on the switch', !getNode('vmr').host && _undoStack.length === undoAt && /drop it on the device it runs on/.test(toast()), toast());
    // From Other devices: it joins the rack with its host.
    others().querySelector('summary').click();
    await tick();
    ok('Other devices says where a VM goes', /A VM or a container goes onto the device it runs on\./.test(others().querySelector('.rail-note').textContent));
    centre(20);
    clearToast();
    drag(row('vmo'), onBox('hv'));
    ok('a VM from Other devices onto HV runs on it and is in the rack', getNode('vmo').host === 'hv' && getNode('vmo').group === 'rk');
    ok('said in a toast', /VMO runs on HV now\./.test(toast()), toast());
    undo();
    ok('(undone: in no group, on nothing)', !getNode('vmo').host && !getNode('vmo').group);
    // A PC is no guest: dragged onto a box it is an ordinary bring (refused: taken).
    drag(row('pc'), onBox('hv'));
    ok('a PC dropped on a box does not run on it', !getNode('pc').host);
    // The place dialog offers no VM.
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 5, height: 1 });
    const offered = [...el('rackPlaceList').querySelectorAll('.rkp-item')].map((b) => b.dataset.node);
    ok('the place dialog does not offer a VM or a container', !offered.some((id) => isVirtualType(getNode(id).type)) && offered.includes('pc'), json(offered));
    closePlaceDialog();

    // ---- 4: a chip dragged off ----
    centre(20);
    undoAt = _undoStack.length;
    let [cx, cy] = mid(chip('vm2'));
    ptr('pointerdown', chip('vm2'), cx, cy);
    ptr('pointermove', window, cx + 10, cy + 10);
    const zone = () => view().querySelector('.rk-dock [data-zone="unhost"]');
    ok('dragging a chip shows one target: Runs on nothing', !!zone() && view().querySelectorAll('.rk-dock [data-zone]').length === 1 && /Runs on nothing/.test(zone().textContent));
    ok('the chip being dragged is marked, its name follows the pointer', chip('vm2').classList.contains('rk-leaving') && /VM2/.test(document.querySelector('body > .rk-chip').textContent));
    ptr('pointermove', window, ...mid(zone()));
    ok('over it, it is lit', zone().classList.contains('rk-over'));
    ptr('pointerup', window, ...mid(zone()));
    ok('let go on it, the VM runs on nothing, one undo step', !getNode('vm2').host && _undoStack.length === undoAt + 1);
    ok('its container still runs on it', getNode('ct1').host === 'vm2');
    ok('the target is gone', !view().querySelector('.rk-dock'));
    undo();
    // Onto another device.
    centre(15);
    drag(chip('vm2'), onBox('hv2'));
    ok('a chip let go on another device runs on that one', getNode('vm2').host === 'hv2' && !!dev('hv2').querySelector('.rk-guest[data-guest="vm2"]'));
    ok('its container goes with it', !!dev('hv2').querySelector('.rk-guest[data-guest="ct1"]'));
    undo();
    // Held at the foot of the pane, a chip's drag scrolls it, as a box's
    // does: a host out of sight (a phone shows a dozen units) is reached.
    centre(20);
    const pane = view().querySelector('.rk-main');
    const st0 = pane.scrollTop;
    [cx, cy] = mid(chip('vm2'));
    ptr('pointerdown', chip('vm2'), cx, cy);
    ptr('pointermove', window, cx, cy + 12);
    const pr = pane.getBoundingClientRect();
    ptr('pointermove', window, cx, pr.bottom - 8);
    await new Promise((r) => setTimeout(r, 400));
    ok('a chip held at the foot of the pane scrolls it', pane.scrollTop > st0, `${st0} -> ${pane.scrollTop}`);
    ptr('pointerup', window, cx, pr.bottom - 8);
    const st1 = pane.scrollTop;
    await new Promise((r) => setTimeout(r, 150));
    ok('and stops when let go', pane.scrollTop === st1 && getNode('vm2').host === 'hv');
    // Anywhere else: nothing.
    undoAt = _undoStack.length;
    drag(chip('vm1'), () => [xOf('front'), yOf('front', 30)]);
    ok('let go on empty units, nothing changes', getNode('vm1').host === 'hv' && _undoStack.length === undoAt);
    // A finger.
    ok('a chip takes the touch (touch-action: none)', getComputedStyle(chip('vm1')).touchAction === 'none');
    centre(15);
    drag(chip('vm1'), onBox('hv2'), false, { pointerType: 'touch' });
    ok('a finger drags a chip onto another device', getNode('vm1').host === 'hv2');
    undo();

    // ---- 5: cables ----
    renderRackView(true);
    // Round 5: each cable is drawn port to port, its tags at its ends; a
    // guest's end is its chip in its host's box, its tag naming it.
    const lbls = () => [...view().querySelectorAll('.rk-flag')].map((b) => b.textContent.trim());
    ok('the cable to VM1 is drawn to HV\'s box, labelled with VM1', lbls().some((x) => /^VM1: /.test(x)), json(lbls()));
    ok('its ends are the boxes', [...view().querySelectorAll('.rk-cable')].some((g) => g.dataset.key === 'l1' && g.dataset.ends.split(' ').includes('hv') && g.dataset.ends.split(' ').includes('sw')));
    ok('the cable between VM1 and its own host is not drawn', ![...view().querySelectorAll('.rk-cable')].some((g) => g.dataset.key.split(' ').includes('l2')));
    ok('the container\'s cable out of the rack runs from HV\'s box to the rack\'s edge, named for it', lbls().includes('CT1: → PC · no port')
       && [...view().querySelectorAll('.rk-cable')].some((g) => g.dataset.key === 'l3' && g.classList.contains('rk-out') && g.dataset.ends.split(' ').includes('hv')), json(lbls()));

    // ---- 6: the report ----
    const racks = reportRacks();
    const front = racks[0].faces.find((f) => f.face === 'front');
    const hvRow = front.rows.find((r) => r.items && r.items.some((it) => it.name === 'HV'));
    ok('the report\'s elevation lists what runs on HV', json(hvRow.items[0].guests) === json(['VM1', 'VM2', 'CT1']), json(hvRow.items[0]));
    ok('and Not placed yet leaves the guests out', json(racks[0].unplaced) === json(['VMR']), json(racks[0].unplaced));
    const html = racksSection(racks);
    ok('printed in the cell and under the rack', /Runs here: VM1, VM2, CT1/.test(html) && /Runs on HV:<\/b> VM1, VM2, CT1/.test(html));

    // ---- read-only and the words ----
    open(DOC_VERSION + 1);
    ok('read-only: no handles', !!state.readOnly && !view().querySelector('.rk-handle'));
    [cx, cy] = mid(chip('vm1'));
    ptr('pointerdown', chip('vm1'), cx, cy);
    ptr('pointermove', window, cx + 40, cy + 40);
    ok('read-only: a chip is not dragged', !view().querySelector('.rk-dock'));
    ptr('pointerup', window, cx + 40, cy + 40);
    chip('vm1').click();
    ok('read-only: a click still selects it', state.selectedId === 'vm1');

    open();
    setLocale('es'); applyStaticI18n(); renderRackView(true);
    ok('es: the hint on the row', /Arrástralo sobre su host/.test(row('vmr').closest('li').textContent));
    ok('es: the box\'s tooltip', /Se ejecutan aquí: VM1, VM2, CT1/.test(dev('hv').title));
    chip('vm1').click();
    ok('es: the guest\'s bar', /Se ejecuta en HV/.test(bar().textContent) && /Seleccionar su host/.test(bar().textContent) && /No se ejecuta en nada/.test(bar().textContent), bar().textContent);
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
