// The Round 5 exit test (Review-Packs/Topo-groups.md, "Round 5: ports and
// cables in the rack view", R5a and R5b): the Data Centre sample's network
// rack, opened and patched the way a person would, through the rack view's
// own entry points, and checked at each stage.
//   1. open: the Data Centre sample, rack A01 Network in the rack view;
//   2. ports: every cabled port of every device placed in it drawn, on the
//      face its ports are on, and filled;
//   3. the filter: Selected is the default; with a device selected only its
//      cables are bold and tagged, the rest faint; with nothing selected,
//      none is bold;
//   4. the schedule: a row per cable; a row's click selects that cable and
//      shows it alone in One cable mode;
//   5. the untagged-cables finding: A01's cables carry no tag, the finding
//      counts them and the schedule says "no tag"; tagging one counts one
//      fewer;
//   6. drawing a cable: a drag from a free port to another device's free
//      port makes a cable bound to both, one undo step; undo removes it;
//   7. the report: A01's patch schedule after its elevation, a row per cable,
//      and the elevation drawn with ports.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  const held = {};
  try { ['topo.rackZoom', 'topo.rackCables'].forEach((k) => { held[k] = localStorage.getItem(k); localStorage.removeItem(k); }); } catch (e) { /* blocked */ }
  const view = () => el('rackView');
  const box = (id, face) => view().querySelector(`.rk-slots[data-face="${face}"] .rk-dev[data-node="${id}"]`);
  const ptr = (type, target, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 21, pointerType: 'mouse', isPrimary: true }));
  const midOf = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const wires = () => [...view().querySelectorAll('.rk-wiring .rk-cable')];
  const flagsOn = () => [...view().querySelectorAll('.rk-wiring .rk-flag.rk-on')];

  try {
    // ---- 1: open ----
    replaceDocument(templatesData.datacenter, { origin: 'template' });
    initHistory();
    // The filter as a first visit finds it: nothing kept in this browser.
    _rv.cables = rvLoadCables();
    _rv.zoom = 1;
    const rack = groupById('g_a01');
    ok('the Data Centre sample has rack A01', isRackGroup(rack) && rack.name === 'A01 Network');
    ok('the switch offers the rack view, and it opens on A01', openRackView('g_a01') && currentRack() === rack && !view().classList.contains('hidden'));
    select(null);

    // ---- 2: every cabled port drawn and filled ----
    const placed = rackMembers(rack).filter((n) => Number.isInteger(n.rackU));
    const want = [];
    placed.forEach((n) => rackPortsOf(n).forEach((p) => { if (p.links.length) want.push({ n, p, face: rackPortsFace(n) }); }));
    const missing = [], empty = [];
    want.forEach(({ n, p, face }) => {
      const b = box(n.id, face);
      const port = b && b.querySelector(`.rk-port[data-port="${p.id}"]`);
      if (!port) { missing.push(`${n.name}:${p.name}@${face}`); return; }
      const fill = getComputedStyle(port, '::before').backgroundColor;
      if (!port.classList.contains('rk-pcab') || !fill || fill === 'transparent' || fill === 'rgba(0, 0, 0, 0)') empty.push(`${n.name}:${p.name} ${fill}`);
    });
    ok('A01 has cabled ports on its devices', want.length >= 8 && placed.length === 5, `${want.length} on ${placed.length}`);
    ok('every cabled port is drawn, on the face its ports are on', !missing.length, missing.join(', '));
    ok('and filled', !empty.length, empty.join(', '));
    const free = box('d2', 'front').querySelector('.rk-port[data-port="i2"]');
    ok('a free port is not', !!free && !free.classList.contains('rk-pcab'));
    ok('the storage switch\'s ports are on the rear, where it is mounted', !!box('d12', 'rear') && box('d12', 'rear').querySelectorAll('.rk-port').length === 8);

    // ---- 3: Selected, the default ----
    ok('the cable filter defaults to Selected', _rv.cables === 'sel' && view().querySelector('#rackCables [data-cables="sel"]').classList.contains('active'));
    ok('with nothing selected, no cable is bold', wires().length > 0 && !wires().some((g) => g.classList.contains('rk-wsel')) && wires().every((g) => g.classList.contains('rk-faint')));
    select('d3', 'node');
    const fwCables = rackCableLinks(rack).filter((l) => l.source === 'd3' || l.target === 'd3').map((l) => l.id).sort();
    const bold = wires().filter((g) => g.classList.contains('rk-wsel')).map((g) => g.dataset.key).sort();
    ok('with a device selected, its cables bold, and only they', json(bold) === json(fwCables) && fwCables.length === 3, `${bold} vs ${fwCables}`);
    ok('the rest faint', wires().filter((g) => !fwCables.includes(g.dataset.key)).every((g) => g.classList.contains('rk-faint')));
    ok('and only its cables tagged', flagsOn().length > 0 && flagsOn().every((f) => fwCables.includes(f.dataset.key)), flagsOn().map((f) => f.dataset.key).join());
    select(null);

    // ---- 4: One cable from a schedule row ----
    const rows = [...view().querySelectorAll('.rk-sched .rk-srow')];
    const sched = rackSchedule(rack);
    ok('the schedule lists a row per cable that touches the rack', rows.length === sched.length && sched.length === 14, `${rows.length} / ${sched.length}`);
    const row = view().querySelector('.rk-srow[data-link="dl11"]');
    row.querySelector('.rk-sfar').click();
    const one = wires().filter((g) => g.classList.contains('rk-wsel')).map((g) => g.dataset.key);
    ok('a row\'s click selects that cable', json([...state.selection]) === json([{ type: 'link', id: 'dl11' }]));
    ok('and shows it in One cable mode, alone', _rv.cables === 'one' && json(one) === '["dl11"]' && wires().filter((g) => g.dataset.key !== 'dl11').every((g) => g.classList.contains('rk-faint')), json(one));
    ok('its two ends marked, front and rear', !!box('d5', 'front') && box('d5', 'front').classList.contains('rk-cabled') && box('d12', 'rear').classList.contains('rk-cabled'));
    setRackCables('sel');
    select(null);

    // ---- 5: the untagged-cables finding ----
    const tagFinding = () => topologyFindings().find((f) => f.key === 'rack-tag' && f.subject === groupLabel(rack));
    let f = tagFinding();
    ok('an info finding counts A01\'s untagged cables', !!f && f.level === 'info' && f.linkIds.length === 14 && /14 cables in A01 Network have no tag/.test(f.detail), f && f.detail);
    ok('never counted with the faults', !isCountedFinding(f));
    ok('and the schedule says no tag on each', [...view().querySelectorAll('.rk-srow .rk-stag')].every((c) => c.textContent.trim() === 'no tag'));
    batch(() => { getLink('dl2').cable = { label: 'A01-002' }; save(); renderCanvasOnly(); });
    f = tagFinding();
    ok('a tag given, one fewer, and the row shows it', !!f && f.linkIds.length === 13 && !f.linkIds.includes('dl2')
       && view().querySelector('.rk-srow[data-link="dl2"] .rk-stag').textContent.trim() === 'A01-002');
    undo();

    // ---- 6: drawing a cable port to port ----
    // The storage switch moved up under the edge router first (the rack
    // view's own move, one step), so both ends are in the test window's
    // short pane at once. Then the edge router selected: its box grows until
    // its ports are a pointer's size, and its free port (eth1) is drawn from;
    // the storage switch's free port 5, at the rear, is the other end.
    ok('the storage switch moves up to U40 at the rear', commitRackPlace(getNode('d12'), { lo: 40, h: 1, face: 'rear' }) && getNode('d12').rackU === 40);
    // At 2x, where the storage switch's ports are drawn a pointer's size too
    // (at 1x a 1U box's are a hairline at its foot).
    setRackZoom(2);
    // The test window is short, and the units' pane a third of it: the
    // column is made taller so both ends are in the pane (as rackpatch.js).
    el('rackBody').style.flex = '0 0 1000px';
    select('d2', 'node');
    rvPane().scrollTop = 0;
    box('d2', 'front').scrollIntoView({ block: 'center' });
    const from = box('d2', 'front').querySelector('.rk-port[data-port="i2"]');
    const to = box('d12', 'rear').querySelector('.rk-port[data-port="p5"]');
    const before = state.links.length, depth = _undoStack.length;
    const [x0, y0] = midOf(from), [x1, y1] = midOf(to);
    const inView = (x, y) => x > 0 && y > 0 && x < innerWidth && y < innerHeight;
    ptr('pointerdown', from, x0, y0);
    ptr('pointermove', window, x0 + 3, y0 + 6);
    ptr('pointermove', window, x1, y1);
    const lit = to.classList.contains('rk-ptarget') || !!view().querySelector('.rk-port.rk-ptarget');
    ptr('pointerup', window, x1, y1);
    const made = state.links.length === before + 1 ? state.links[state.links.length - 1] : null;
    ok('both ports on screen for the drag', inView(x0, y0) && inView(x1, y1), `${x0},${y0} → ${x1},${y1} in ${innerWidth}x${innerHeight}`);
    ok('the far port lit while over it', lit);
    ok('a drag from a free port to another device\'s free port makes a cable bound to both', !!made && made.source === 'd2' && made.sourceIface === 'i2' && made.target === 'd12' && made.targetIface === 'p5', json(made));
    ok('in one undo step, and selected', _undoStack.length === depth + 1 && !!made && inSelection('link', made.id));
    ok('it is a row of the schedule now', !!made && !!view().querySelector(`.rk-srow[data-link="${made.id}"]`));
    undo();
    el('rackBody').style.flex = '';
    setRackZoom(1);
    ok('undo removes it', state.links.length === before && !!made && !getLink(made.id) && !view().querySelector(`.rk-srow[data-link="${made.id}"]`));
    select(null);

    // ---- 7: the report ----
    const doc = new DOMParser().parseFromString(reportHtml(reportModel(), null), 'text/html');
    const a01 = [...doc.querySelectorAll('.rack')].find((r) => r.querySelector('h3') && r.querySelector('h3').textContent.includes('A01 Network'));
    const patch = a01 && a01.querySelector('table.patch');
    const prows = patch ? [...patch.querySelectorAll('tbody tr')] : [];
    ok('the report has A01\'s patch schedule after its elevations', !!patch && !!(a01.querySelector('.elevs').compareDocumentPosition(patch) & Node.DOCUMENT_POSITION_FOLLOWING));
    ok('a row per cable, in the rack\'s order', prows.length === 14 && prows[0].cells[0].textContent.trim() === rackScheduleEnd(sched[0]), prows[0] && prows[0].cells[0].textContent);
    ok('the elevation drawn with ports', !!a01 && a01.querySelectorAll('table.elev .pstrip').length >= 5 && a01.querySelectorAll('table.elev .pm.on').length === want.length,
       `${a01 && a01.querySelectorAll('table.elev .pstrip').length} strips, ${a01 && a01.querySelectorAll('table.elev .pm.on').length} on of ${want.length}`);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    el('rackBody').style.flex = '';
    _rv.zoom = 1; _rv.cables = 'sel';
    try { Object.entries(held).forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }); } catch (e) { /* blocked */ }
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
