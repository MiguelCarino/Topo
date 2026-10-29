// Patching in the rack view, port to port (Review-Packs/Topo-groups.md,
// "Round 5", R5a; "The cables, port to port" in js/rackview.js, the
// untagged-cables finding in placeFindings, js/diagnostics.js). What is held
// here:
//   1. drawing a cable from a free port to another device's free port: bound
//      to both ports, one undo step, selected, said; let go on a port already
//      taken, refused and said; on another device's box, the far port is
//      bindLink's and the rail opens on the port picker; on nothing, nothing;
//      a cabled port is not a start; a finger draws from the selected box's
//      ports (they take the touch), not from another box's;
//   2. the no-port spot: a cable whose end names no port the box draws meets
//      it there; a tap selects the device and shows the spot's tip, each
//      cable with Pick a port, which opens the rail's port picker on it; the
//      selected device's bar has Pick a port too; picking a port there is one
//      undo step and the spot goes;
//   3. the finding: "N cables in <rack> have no tag", info, once per rack,
//      naming the cables; listed in the Findings tab, never counted (the
//      pill, the tab's count, has:finding, the report); tagging them takes
//      it away; in Spanish;
//   4. read-only: no port drag, no Pick a port in the spot's tip.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  let held = {};
  try { ['topo.rackZoom', 'topo.rackCables'].forEach((k) => { held[k] = localStorage.getItem(k); localStorage.removeItem(k); }); } catch (e) { /* blocked */ }
  _rv.zoom = 1; _rv.cables = 'sel';

  const NIC = () => [{ id: 'e1', name: 'eth0', ip: '' }, { id: 'e2', name: 'eth1', ip: '' }];
  const N = (id, type, u, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: type === 'switch' ? [] : NIC(), group: 'rk', rackU: u }, extra);
  const site = (v = DOC_VERSION) => ({ v,
    nodes: [N('sw', 'switch', 20, { portCount: 24, rackDepth: 'half' }), N('sw2', 'switch', 19, { portCount: 24, rackDepth: 'half' }),
      N('srv', 'server', 10, { rackHeight: 2, rackDepth: 'half', portsFace: 'front' }), N('nas', 'server', 6, { rackHeight: 2, rackDepth: 'half', portsFace: 'front' })],
    links: [{ id: 'c1', source: 'sw', target: 'srv', sourceIface: 'p1', targetIface: 'e1', cable: { label: 'C-1' } },
      { id: 'c2', source: 'sw', target: 'sw2', sourceIface: 'p24', targetIface: 'p24' },
      // No port picked at the NAS.
      { id: 'c3', source: 'nas', target: 'sw', targetIface: 'p3' }],
    groups: [{ id: 'rk', name: 'Rack 7', kind: 'rack', uHeight: 24 }] });
  const open = (doc = site()) => { replaceDocument(doc, { origin: 'file', docId: 'rack-patch' }); initHistory(); setView('rack'); openRackView('rk'); select(null); renderRackView(true); };
  const view = () => el('rackView');
  const box = (id) => view().querySelector(`.rk-slots[data-face="front"] .rk-dev[data-node="${id}"]`);
  const port = (id, p) => box(id).querySelector(`.rk-port[data-port="${p}"]`);
  const midOf = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const ptr = (type, target, x, y, extra = {}) => target.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 11, pointerType: 'mouse', isPrimary: true }, extra)));
  const drag = (from, to, extra = {}) => {
    const [x0, y0] = midOf(from);
    ptr('pointerdown', from, x0, y0, extra);
    ptr('pointermove', window, x0 + 3, y0 + 6, extra);
    const [x1, y1] = Array.isArray(to) ? to : midOf(to);
    ptr('pointermove', window, x1, y1, extra);
    const at = document.elementFromPoint(x1, y1), pane = rvPane().getBoundingClientRect();
    const during = { line: !!document.querySelector('.rk-cabling'), from: from.classList.contains('rk-pfrom'),
      target: !Array.isArray(to) && to.classList.contains('rk-ptarget'), refused: !!document.querySelector('.rk-cabling.rk-refused'),
      at: at ? String(at.className.baseVal !== undefined ? at.className.baseVal : at.className) : null, xy: [x1, y1], pane: [pane.top, pane.bottom], win: [innerWidth, innerHeight] };
    ptr('pointerup', window, x1, y1, extra);
    return during;
  };
  const toast = () => el('topoToast').textContent;
  const clearToast = () => { el('topoToast').textContent = ''; };
  const tipText = () => { const t = view().querySelector('.rk-ptip'); return t && !t.hidden ? t.textContent : ''; };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  try {
    // ---- 1: drawing a cable port to port ----
    open();
    // Ports a pointer's size at 2x. The test's window is short and narrow,
    // where the units' pane is a third of the window: the column is made
    // taller, so the two switches one above the other are both in the pane
    // and clear of the bands at its edges where a drag scrolls it.
    _rv.zoom = 2;
    el('rackBody').style.flex = '0 0 1000px';
    renderRackView(true);
    const before = state.links.length, depth = _undoStack.length;
    box('sw').scrollIntoView({ block: 'center' });
    clearToast();
    let seen = drag(port('sw', 'p5'), port('sw2', 'p7'));
    const made = state.links[state.links.length - 1];
    ok('while drawing: a line follows, the port it starts from and the one under the pointer ringed', seen.line && seen.from && seen.target, json(seen));
    ok('let go on another device\'s free port: a cable bound to both ports', state.links.length === before + 1 && made.source === 'sw' && made.target === 'sw2'
       && made.sourceIface === 'p5' && made.targetIface === 'p7', json(made));
    ok('one undo step, the cable selected, the rail not sent to the port picker', _undoStack.length === depth + 1 && state.selectedType === 'link' && state.selectedId === made.id);
    ok('and said', /Cabled: SW · 5 to SW2 · 7\./.test(toast()), toast());
    await settle();
    renderRackView(true);
    ok('drawn from port to port at once', !!view().querySelector(`.rk-cable[data-key="${made.id}"]`) && port('sw', 'p5').classList.contains('rk-pcab') && port('sw2', 'p7').classList.contains('rk-pcab'));
    undo();
    ok('undone: gone, the ports free again', state.links.length === before && !port('sw', 'p5').classList.contains('rk-pcab'));
    clearToast();
    seen = drag(port('sw', 'p5'), port('sw2', 'p24'));
    ok('let go on a port already taken: refused, red while over it, and said', state.links.length === before && seen.refused && /already/.test(toast()), json([seen, toast()]));
    await settle();
    // Onto the box, away from its ports: the far port is bindLink's.
    const nb = box('sw2').getBoundingClientRect();
    drag(port('sw', 'p6'), [nb.left + 40, nb.top + 6]);
    const toBox = state.links[state.links.length - 1];
    ok('let go on a device\'s box: its port picked for it, the rail on the port picker', state.links.length === before + 1 && toBox.sourceIface === 'p6' && toBox.target === 'sw2'
       && !!toBox.targetIface && !el('linkPortProps').classList.contains('hidden'), json(toBox));
    undo();
    await settle();
    const r0 = box('sw').getBoundingClientRect();
    drag(port('sw', 'p6'), [r0.right + 400, r0.top - 30]);
    ok('let go on nothing: nothing', state.links.length === before && _undoStack.length === depth && !document.querySelector('.rk-cabling'));
    await settle();
    // A cabled port starts nothing: the press is the box's, a move.
    renderRackView(true);
    const [cx, cy] = midOf(port('sw', 'p1'));
    ptr('pointerdown', port('sw', 'p1'), cx, cy);
    ok('a cabled port is not where a cable starts', !_rv.drag || _rv.drag.kind !== 'port');
    ptr('pointerup', window, cx, cy);
    await settle();
    // A finger: on the selected box's ports only. (The port picker opened the
    // rail's drawer over the rack on this narrow window: shut first.)
    const ws = document.querySelector('.topo-ws');
    if (ws.classList.contains('drawer-open')) document.querySelector('[data-ws-toggle]').click();
    select(null);
    renderRackView(true);
    const [tx, ty] = midOf(port('sw', 'p8'));
    ptr('pointerdown', port('sw', 'p8'), tx, ty, { pointerType: 'touch' });
    ok('a finger on a port of a box not selected does not start a cable (it scrolls)', !_rv.drag);
    ptr('pointerup', window, tx, ty, { pointerType: 'touch' });
    selectEntries([{ type: 'node', id: 'sw' }]);
    renderRackView(true);
    // Selecting may open the rail's drawer over the rack again on this narrow
    // window, and the earlier toasts may still be up: shut the drawer, and
    // bring the two switches back into the middle of the pane, so the port
    // aimed at is the element under the finger whatever ran before.
    if (ws.classList.contains('drawer-open')) document.querySelector('[data-ws-toggle]').click();
    clearToast();
    box('sw').scrollIntoView({ block: 'center' });
    // A timer, not two animation frames: under the runner's virtual clock a
    // headless page does not always draw a frame before the budget runs out,
    // and a wait on one then never ends (the suite reported nothing about
    // one run in six). The scroll is laid out by the time a timer fires.
    await new Promise((r) => setTimeout(r, 40));
    ok('the selected box\'s free ports take the touch', getComputedStyle(port('sw', 'p8')).touchAction === 'none' && getComputedStyle(port('sw', 'p1')).touchAction !== 'none');
    const fseen = drag(port('sw', 'p8'), port('sw2', 'p9'), { pointerType: 'touch' });
    const byFinger = state.links[state.links.length - 1];
    ok('a finger draws from the selected box\'s port', state.links.length === before + 1 && byFinger.sourceIface === 'p8' && byFinger.targetIface === 'p9', json(fseen));
    undo();
    await settle();

    // ---- 2: the no-port spot ----
    select(null);
    el('rackBody').style.flex = '';
    _rv.zoom = 1;
    renderRackView(true);
    const spot = () => box('nas').querySelector('.rk-noport');
    ok('a cable with no port at the NAS: a spot on its box, which makes room for it', !!spot() && box('nas').classList.contains('rk-hasspot') && !box('srv').querySelector('.rk-noport'));
    ok('its box says so', /no-port spot/.test(box('nas').title));
    const [sx, sy] = midOf(spot());
    spot().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: sx, clientY: sy }));
    ok('a tap on it selects the device and shows its cables, each with Pick a port', state.selectedId === 'nas' && /NAS · no port/.test(tipText()) && /→ SW · 3/.test(tipText())
       && !!view().querySelector('.rk-ptip [data-rk-pick="c3"]'), tipText());
    ok('that tip takes the pointer (its button is a tap)', getComputedStyle(view().querySelector('.rk-ptip')).pointerEvents === 'auto');
    view().querySelector('.rk-ptip [data-rk-pick="c3"]').click();
    ok('Pick a port: the cable selected, the rail on the port picker', state.selectedType === 'link' && state.selectedId === 'c3' && !el('linkPortProps').classList.contains('hidden') && tipText() === '');
    select('nas', 'node');
    renderRackView(true);
    const pickBtn = view().querySelector('.rk-selbar [data-rk="pickport"]');
    ok('the selected device\'s bar has Pick a port too', !!pickBtn && pickBtn.textContent.trim() === 'Pick a port');
    pickBtn.click();
    ok('which does the same', state.selectedType === 'link' && state.selectedId === 'c3');
    const d1 = _undoStack.length;
    batch(() => { getLink('c3').sourceIface = 'e2'; save(); renderCanvasOnly(); });   // as the port picker's chip does
    renderRackView(true);
    ok('a port picked: one step, the spot gone, the cable at its port', _undoStack.length === d1 + 1 && !spot() && port('nas', 'e2').classList.contains('rk-pcab'));
    undo();
    renderRackView(true);
    ok('undone, the spot again', !!spot());

    // ---- 3: the untagged-cables finding ----
    const tagFinding = () => topologyFindings().find((f) => f.key === 'rack-tag');
    let f = tagFinding();
    ok('untagged cables: one info finding for the rack, naming them', !!f && f.level === 'info' && f.subject === 'Rack 7' && f.detail === '2 cables in Rack 7 have no tag.'
       && json(f.linkIds.sort()) === json(['c2', 'c3']), json(f));
    ok('listed, not counted', !isCountedFinding(f) && isOpenFinding(f));
    validateTopology();
    ok('in the Findings tab, under Cable tags', /Cable tags/.test(el('conflictMsgList').textContent) && /2 cables in Rack 7 have no tag/.test(el('conflictMsgList').textContent));
    const counted = topologyFindings().filter(isCountedFinding).length;
    ok('the pill and the tab count only what is wrong', el('conflictPillCount').textContent === String(counted) && (counted > 0 || el('conflictPill').classList.contains('hidden')));
    ok('has:finding does not match a cable for it', qLinkSeverity(getLink('c2')) === null);
    ok('the report leaves it out', !reportModel().findings.some((x) => x.key === 'rack-tag') && !reportHtml(reportModel(), null).includes('have no tag'));
    batch(() => { setCableField(getLink('c2'), 'label', 'C-2'); save(); });
    f = tagFinding();
    ok('one tagged: one left, said in the singular', !!f && f.detail === 'One cable in Rack 7 has no tag.' && json(f.linkIds) === '["c3"]', json(f));
    batch(() => { setCableField(getLink('c3'), 'label', 'C-3'); save(); });
    ok('all tagged: gone', !tagFinding());
    undo(); undo();
    setLocale('es');
    ok('es: the finding in Spanish', tagFinding().detail === '2 cables de Rack 7 no tienen etiqueta.' && tagFinding().check === 'Etiquetas de cable', tagFinding().detail);
    setLocale('en');

    // ---- 4: read-only ----
    replaceDocument(site(DOC_VERSION + 1), { origin: 'file', docId: 'rack-patch-ro' });
    openRackView('rk');
    _rv.zoom = 3;
    select('nas', 'node');
    renderRackView(true);
    const [px, py] = midOf(port('sw', 'p5'));
    ptr('pointerdown', port('sw', 'p5'), px, py);
    ok('read-only: a port starts no cable', !_rv.drag);
    ptr('pointerup', window, px, py);
    const [qx, qy] = midOf(spot());
    spot().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: qx, clientY: qy }));
    ok('and the spot\'s tip says its cables with no Pick a port', /→ SW · 3/.test(tipText()) && !view().querySelector('.rk-ptip [data-rk-pick]'), tipText());
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    setLocale('en');
    _rv.zoom = 1; _rv.cables = 'sel';
    try { Object.entries(held).forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }); } catch (e) { /* blocked */ }
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
