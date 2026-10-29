// The rack view's cables, port to port (Review-Packs/Topo-groups.md, "Round
// 5", R5a; "The cables, port to port" in js/rackview.js, rackCableLinks in
// js/model.js). This suite replaced the one-line-per-device-pair one (Round 2,
// item 5): the owner's call was to draw each cable from its port to the other
// end's port, so every assertion here is about cables and ports, not pairs.
// What is held here:
//   1. pure: one item per cable (never per pair), each end at its port, the
//      box's no-port spot, a guest's chip or outside the rack; a tag's words
//      (the label, else the ports, else where it goes);
//   2. the lines meet the ports: a line starts and ends on its two ports'
//      marks; one on the front to one on the rear runs in the front's channel
//      and round to the rear; one on the rear stays in the rear's channel;
//      nested runs get tracks of their own; a cable out of the rack runs on
//      a track of its own to a ring at the rack's top or bottom edge (not
//      mid-manager, and not along its box's lower edge to the outer rail,
//      where all of a box's made one line and one ring); a cable with no
//      port meets the box's spot;
//   3. the filter: Selected (the default) bolds and tags the selected
//      device's cables, the rest faint; All draws them all, tags from 2x;
//      One cable traces the cable selected, a tap on a port picks it; kept in
//      this browser, never in the document;
//   4. tags: never over one another nor over a box's name or ports, inside
//      the faces, hung from their port; a flag on show keeps its place while
//      the pointer goes over it and on (no flags trading places under it);
//   5. pointed at (mouse) a line or a device lights its cables and tags; a
//      touch does not; leaving lets go; a tap on a flag or a line selects the
//      cable and shows the port's tip (tag, both ends, VLAN, length, colour,
//      via); a click on one of two tracks side by side takes that one, even
//      when the browser handed it to the other's hit stroke;
//   6. one face on show (a phone): a cable to the other face runs on its
//      own track to a ring at the far device's level, its tag naming the far
//      device, port and face, in Spanish too;
//   7. redrawn when the faces change size; the lines step back while a device
//      is dragged; a device tapped is kept in sight; read-only still draws.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const frame = () => new Promise((r) => setTimeout(r, 30));
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  let held = {};
  try { ['topo.rackZoom', 'topo.rackCables'].forEach((k) => { held[k] = localStorage.getItem(k); localStorage.removeItem(k); }); } catch (e) { /* blocked */ }
  _rv.zoom = 1; _rv.cables = 'sel';

  const NIC = [{ id: 'e1', name: 'eth0', ip: '' }, { id: 'e2', name: 'eth1', ip: '' }];
  const N = (id, type, u, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: type === 'switch' ? [] : NIC.map((i) => ({ ...i })), group: 'rk', rackU: u }, extra);
  const H = { rackDepth: 'half' };
  // A core switch on the front, its ports facing the front; six full-depth
  // servers whose ports face the rear (their backs), cabled to it (front to
  // rear) and to a management switch at the back (rear to rear); a half-depth
  // KVM on the front cabled to the management switch; a NAS with a cable
  // whose port at the NAS was never picked; two PCs outside the rack and a
  // spare server in the rack with no units yet.
  const big = (v = DOC_VERSION) => {
    const nodes = [
      N('core', 'switch', 40, { portCount: 48, ...H, portAttrs: { p1: { vlan: 10 } } }), N('fw', 'firewall', 42, H), N('kvm', 'custom', 34, H),
      N('mgmt', 'switch', 36, { portCount: 24, rackFace: 'rear', ...H }), N('nas', 'server', 4, { rackHeight: 2 }),
      N('spare', 'server', null), N('pc1', 'pc', null, { group: 'off' }), N('pc2', 'pc', null, { group: 'off' })
    ];
    for (let i = 1; i <= 6; i++) nodes.push(N(`srv${i}`, 'server', 33 - i * 3, { rackHeight: 2 }));
    nodes.forEach((n) => { if (n.rackU == null) delete n.rackU; });
    const links = [{ id: 'l0', source: 'fw', target: 'core', sourceIface: 'e2', targetIface: 'p1', cable: { color: 'blue', label: 'UPLINK', length: '2 m', via: 'PP-1:4' } }];
    for (let i = 1; i <= 6; i++) links.push({ id: `l${i}`, source: `srv${i}`, target: 'core', sourceIface: 'e1', targetIface: `p${i + 1}` });
    for (let i = 1; i <= 4; i++) links.push({ id: `m${i}`, source: `srv${i}`, target: 'mgmt', sourceIface: 'e2', targetIface: `p${i}` });
    links.push({ id: 'k1', source: 'kvm', target: 'mgmt', sourceIface: 'e1', targetIface: 'p22', cable: { color: 'green' } });
    links.push({ id: 'x1', source: 'core', target: 'pc1', sourceIface: 'p40', targetIface: 'e1' });
    links.push({ id: 'x2', source: 'core', target: 'pc2', sourceIface: 'p41', targetIface: 'e1' });
    links.push({ id: 'u1', source: 'core', target: 'spare', sourceIface: 'p30', targetIface: 'e1' });
    // No port picked at the NAS's end.
    links.push({ id: 'n1', source: 'nas', target: 'core', targetIface: 'p21' });
    return { v, nodes, links, groups: [{ id: 'room', name: 'Server room', kind: 'room' }, { id: 'rk', name: 'Rack 1', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'off', name: 'Office', kind: 'room' }] };
  };
  const open = (doc) => { replaceDocument(doc, { origin: 'file', docId: 'rack-wires' }); setView('rack'); openRackView('rk'); select(null); renderRackView(true); };
  const view = () => el('rackView');
  const cable = (key) => [...view().querySelectorAll('.rk-cable')].find((g) => g.dataset.key === key);
  const flags = (key) => [...view().querySelectorAll('.rk-flag')].filter((b) => !key || b.dataset.key === key);
  const shownFlags = (key) => flags(key).filter((b) => getComputedStyle(b).display !== 'none');
  const box = (id, face) => view().querySelector(`.rk-slots[data-face="${face}"] .rk-dev[data-node="${id}"]`);
  const port = (id, face, p) => box(id, face).querySelector(`.rk-port[data-port="${p}"]`);
  const layerRect = () => view().querySelector('.rk-wires').getBoundingClientRect();
  const midOf = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  // A line's two ends, in the page's coordinates, from its path.
  const endsOf = (key) => {
    const d = cable(key).querySelector('.rk-wire').getAttribute('d');
    const nums = d.match(/-?[\d.]+/g).map(Number), r = layerRect();
    return [{ x: r.left + nums[0], y: r.top + nums[1] }, { x: r.left + nums[nums.length - 2], y: r.top + nums[nums.length - 1] }];
  };
  const near = (p, q, d = 1.5) => Math.abs(p.x - q.x) <= d && Math.abs(p.y - q.y) <= d;
  const meets = (key, a, b) => { const [p, q] = endsOf(key); return (near(p, a) && near(q, b)) || (near(p, b) && near(q, a)); };
  // The x of a cable's run up or down the manager (its track), in the page.
  const trackX = (key) => layerRect().left + _rv.wired.items.find((it) => it.key === key).x;
  const lane = () => view().querySelector('.rk-lane-in').getBoundingClientRect();
  const noOverlap = (rs) => rs.every((a, i) => rs.every((b, j) => j <= i || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5 || a.right <= b.left + 0.5 || b.right <= a.left + 0.5));
  const ptr = (type, target, extra = {}) => target.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, pointerId: 5, pointerType: 'mouse', isPrimary: true }, extra)));
  const tipText = () => { const t = view().querySelector('.rk-ptip'); return t && !t.hidden ? t.textContent : ''; };

  try {
    // ---- 1: pure ----
    open(big());
    const rk = groupById('rk');
    ok('the rack\'s cables, one by one: every cable with an end on one of its devices', json(rackCableLinks(rk).map((l) => l.id)) === json(['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'm1', 'm2', 'm3', 'm4', 'k1', 'x1', 'x2', 'u1', 'n1']));
    const items = rvCableItems(rk, ['front', 'rear'], null);
    const item = (key) => items.find((it) => it.key === key);
    ok('one item per cable, never per pair', items.length === 16 && new Set(items.map((it) => it.key)).size === 16, items.length);
    const l1 = item('l1');
    ok('each end at its port, on the face the device\'s ports are on', l1.ends.some((e) => e.node.id === 'core' && e.kind === 'port' && e.port === 'p2' && e.face === 'front')
       && l1.ends.some((e) => e.node.id === 'srv1' && e.kind === 'port' && e.port === 'e1' && e.face === 'rear'), json(l1.ends.map((e) => [e.node.id, e.kind, e.port, e.face])));
    ok('a tag says the ports from its own end', json(l1.ends.map((e) => e.words)) === json(['eth0 ↔ 2', '2 ↔ eth0']), json(l1.ends.map((e) => e.words)));
    ok('or the cable\'s label when it has one', item('l0').ends.every((e) => e.words === 'UPLINK'));
    ok('the colour it is drawn in, when the browser knows it', item('l0').colour === 'blue' && item('k1').colour === 'green' && item('l2').colour === '');
    const x1 = item('x1');
    ok('a cable out of the rack: one end outside, its tag says where it goes', x1.ends[1].kind === 'out' && !x1.ends[1].at && x1.ends[0].words === '→ PC1 · eth0', json(x1.ends[0].words));
    ok('a device here with no units is outside the drawing too', item('u1').ends[1].kind === 'out' && item('u1').ends[0].words === '→ SPARE · eth0');
    const n1 = item('n1');
    ok('an end with no port picked meets the box\'s spot', n1.ends[0].kind === 'spot' && n1.ends[0].node.id === 'nas' && n1.ends[0].words === 'no port ↔ 21', json(n1.ends[0]));
    ok('which the rebuild lists by device', json([..._rv.noPort.keys()]) === '["nas"]' && _rv.noPort.get('nas')[0].id === 'n1');

    // ---- 2: the lines meet the ports ----
    ok('every cable here is drawn, one line each', view().querySelectorAll('.rk-cable').length === 16);
    ok('a line runs from its port to the other end\'s port', meets('l1', midOf(port('core', 'front', 'p2')), midOf(port('srv1', 'rear', 'e1'))), json([endsOf('l1'), midOf(port('core', 'front', 'p2')), midOf(port('srv1', 'rear', 'e1'))]));
    ok('every line between two ports does', ['l0', 'l2', 'l3', 'm1', 'm4', 'k1'].every((k) => {
      const it = item(k);
      const at = it.ends.map((e) => midOf(box(e.node.id, e.face).querySelector(`.rk-port[data-port="${e.port}"]`)));
      return meets(k, at[0], at[1]);
    }));
    let lr = lane();
    const M = lr.left + lr.width / 2;
    const frontEnd = (key) => endsOf(key).find((p) => p.x < M), rearEnd = (key) => endsOf(key).find((p) => p.x > M);
    ok('front to rear: its run is in the front\'s channel, and on round to the rear', trackX('l1') > lr.left && trackX('l1') < M && !!frontEnd('l1') && !!rearEnd('l1'),
       json([trackX('l1'), lr.left, M]));
    ok('rear to rear: in the rear\'s channel', trackX('m1') > M && trackX('m1') < lr.right, json([trackX('m1'), M, lr.right]));
    ok('nested runs in a channel on tracks of their own', new Set(['m1', 'm2', 'm3', 'm4'].map((k) => Math.round(trackX(k)))).size === 4);
    ok('the shorter run nearer the face', Math.abs(trackX('m1') - lr.right) < Math.abs(trackX('m4') - lr.right));
    const ringAt = (key) => { const c = cable(key).querySelector('.rk-ring'), r = layerRect(); return c && { x: r.left + Number(c.getAttribute('cx')), y: r.top + Number(c.getAttribute('cy')) }; };
    const ring = ringAt('x1');
    ok('out of the rack: dashed, in the front\'s channel to a ring at the rack\'s top edge (the core switch is near the top)', cable('x1').classList.contains('rk-out')
       && ring.x > lr.left && ring.x < M && Math.abs(ring.y - lr.top) <= 6 && Math.abs(ring.x - trackX('x1')) < 0.5
       && near(endsOf('x1')[0], midOf(port('core', 'front', 'p40'))), json([ring, lr.left, lr.top, M]));
    // The core switch has three cables out of the rack (x1, x2 to the PCs,
    // u1 to the spare with no units): each a line of its own, to a ring of
    // its own, no two rings touching (a ring is 7.5px across with its edge).
    const outs = ['x1', 'x2', 'u1'];
    const rings = outs.map(ringAt);
    ok('a box\'s cables out of the rack do not stack: a track and a ring each', new Set(outs.map((k) => Math.round(trackX(k)))).size === 3
       && new Set(outs.map((k) => cable(k).querySelector('.rk-hit').getAttribute('d'))).size === 3
       && rings.every((a, i) => rings.every((b, j) => j <= i || Math.hypot(a.x - b.x, a.y - b.y) > 7.5)), json(rings));
    // Whichever stroke the browser hands it, a click on a ring's middle is
    // that cable's (its hit stroke runs on over the ring; it had ended at the
    // ring's middle, square, leaving half the ring to the next track's).
    ok('and a click on its ring takes it', outs.every((k, i) => outs.every((o) => rvNearestHit(cable(o).querySelector('.rk-hit'), { clientX: rings[i].x, clientY: rings[i].y }).dataset.key === k)),
       json(outs.map((k, i) => rvNearestHit(cable('x2').querySelector('.rk-hit'), { clientX: rings[i].x, clientY: rings[i].y }).dataset.key)));
    ok('a cable with no port meets the box\'s no-port spot', !!box('nas', 'rear').querySelector('.rk-noport') && !box('nas', 'front').querySelector('.rk-noport')
       && endsOf('n1').some((p) => near(p, midOf(box('nas', 'rear').querySelector('.rk-noport')))));
    ok('a line\'s hit stroke is its run in the manager, not over the boxes', (() => {
      const hb = cable('m1').querySelector('.rk-hit').getBBox(), r = layerRect();
      const s = view().querySelector('.rk-slots[data-face="rear"]').getBoundingClientRect();
      return r.left + hb.x + hb.width <= s.left + 1;
    })());

    // ---- 3: the filter ----
    const filterBtn = (m) => view().querySelector(`#rackCables [data-cables="${m}"]`);
    ok('Selected is the default, and the switch says so', _rv.cables === 'sel' && filterBtn('sel').getAttribute('aria-pressed') === 'true' && filterBtn('all').getAttribute('aria-pressed') === 'false');
    ok('nothing selected: every cable faint, no tag', [...view().querySelectorAll('.rk-cable')].every((g) => g.classList.contains('rk-faint')) && shownFlags().length === 0);
    selectEntries([{ type: 'node', id: 'srv2' }]);
    renderRackView(true);
    ok('a device selected: its cables bold and tagged at both ends', ['l2', 'm2'].every((k) => cable(k).classList.contains('rk-wsel') && !cable(k).classList.contains('rk-faint') && shownFlags(k).length === 2)
       && cable('l3').classList.contains('rk-faint') && shownFlags('l3').length === 0);
    filterBtn('all').click();
    ok('All: every cable drawn, none faint; at 1x the tags stay the selected device\'s', _rv.cables === 'all' && ![...view().querySelectorAll('.rk-cable')].some((g) => g.classList.contains('rk-faint'))
       && shownFlags('l3').length === 0 && shownFlags('l2').length === 2);
    ok('kept in this browser, not the document', localStorage.getItem('topo.rackCables') === 'all' && !JSON.stringify(serializeDoc()).includes('rackCables'));
    setRackZoom(2);
    ok('All at 2x: the tags of every cable that has room', shownFlags().length >= 20 && shownFlags('l3').length >= 1, shownFlags().length);
    const fr = () => shownFlags().map((b) => b.getBoundingClientRect());
    ok('no two tags over each other', noOverlap(fr()));
    const faces = view().querySelector('.rk-faces').getBoundingClientRect();
    ok('and every tag inside the faces', fr().every((r) => r.left >= faces.left - 0.5 && r.right <= faces.right + 0.5 && r.top >= faces.top - 0.5 && r.bottom <= faces.bottom + 0.5));
    ok('each hung from its port by a leader', shownFlags('l0').length === 2 && [...cable('l0').querySelectorAll('.rk-lead')].every((p) => /^M [\d.]+ [\d.]+ L/.test(p.getAttribute('d'))));
    setRackZoom(1);
    filterBtn('one').click();
    ok('One cable: a device selected does not light its cables', _rv.cables === 'one' && cable('l2').classList.contains('rk-faint') && !cable('l2').classList.contains('rk-wsel'));
    selectEntries([{ type: 'link', id: 'l3' }]);
    renderRackView(true);
    ok('the cable selected is traced end to end, bold and tagged, the rest faint', cable('l3').classList.contains('rk-wsel') && shownFlags('l3').length === 2
       && view().querySelectorAll('.rk-cable.rk-wsel').length === 1 && box('srv3', 'rear').classList.contains('rk-cabled') && box('core', 'front').classList.contains('rk-cabled'));
    select(null);
    renderRackView(true);
    // A tap on a cabled port, however small, traces its cable.
    const p5 = port('core', 'front', 'p5');
    p5.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: midOf(p5).x, clientY: midOf(p5).y }));
    ok('a tap on a port traces its cable, with the port\'s tip', state.selectedType === 'link' && state.selectedId === 'l4' && cable('l4').classList.contains('rk-wsel')
       && /SRV4 · eth0/.test(tipText()), tipText());
    filterBtn('sel').click();
    ok('back to Selected', _rv.cables === 'sel' && localStorage.getItem('topo.rackCables') === 'sel');
    select(null);
    renderRackView(true);

    // ---- 5: pointed at, tapped ----
    ptr('pointerover', cable('l5').querySelector('.rk-hit'));
    ok('a line pointed at: bold, its tags shown, its two devices marked', cable('l5').classList.contains('rk-hot') && shownFlags('l5').length === 2
       && box('srv5', 'rear').classList.contains('rk-hot') && box('core', 'front').classList.contains('rk-hot') && view().querySelector('.rk-wiring').classList.contains('rk-hotting'));
    ptr('pointerover', box('srv2', 'front'));
    ok('a device pointed at lights its cables', cable('l2').classList.contains('rk-hot') && cable('m2').classList.contains('rk-hot') && !cable('l5').classList.contains('rk-hot')
       && shownFlags('m2').length === 2);
    ok('the tags of what is lit never cover each other', noOverlap(fr()));
    // A flag pointed at keeps its place, and so does every other flag on
    // show: placed afresh, the lit one moved off the pointer and another slid
    // under it, which the pointer then lit, and a click pressed on one flag
    // and let go on another.
    ptr('pointerleave', view(), { bubbles: false });
    selectEntries([{ type: 'node', id: 'core' }]);
    renderRackView(true);
    const at = () => shownFlags().map((b) => [b.dataset.key, b.dataset.node, b.style.left, b.style.top].join(':')).sort().join(' ');
    const still = at();
    const firstOn = shownFlags()[0], secondOn = shownFlags()[1];
    ptr('pointerover', firstOn);
    ok('a flag pointed at: lit, where it was, and no flag on show moves', firstOn.classList.contains('rk-hot') && at() === still, json([still, at()]));
    ptr('pointerover', secondOn);
    ok('nor when the pointer goes on to the next', secondOn.classList.contains('rk-hot') && at() === still);
    ptr('pointerleave', view(), { bubbles: false });
    ok('nor when it leaves', at() === still);
    // Nor over what a box says: no flag on show covers another box's name
    // line or its ports.
    const covers = (f, r) => f.left < r.right - 0.5 && r.left < f.right - 0.5 && f.top < r.bottom - 0.5 && r.top < f.bottom - 0.5;
    const boxSays = [...view().querySelectorAll('.rk-slots .rk-dev')].flatMap((b) => [b.querySelector('.rk-name'), b.querySelector('.rk-ports')].filter(Boolean)).map((x) => x.getBoundingClientRect());
    ok('no flag over a box\'s name or its ports', shownFlags().length > 0 && fr().every((f) => !boxSays.some((r) => covers(f, r))), shownFlags().length);
    select(null);
    renderRackView(true);
    ptr('pointerleave', view(), { bubbles: false });
    ok('leaving the view lets go', !view().querySelector('.rk-cable.rk-hot') && shownFlags().length === 0);
    ptr('pointerover', cable('l5').querySelector('.rk-hit'), { pointerType: 'touch' });
    ok('a finger does not hover: nothing lit', !view().querySelector('.rk-cable.rk-hot'));
    box('srv6', 'front').focus();
    ok('a device focused from the keyboard lights its cables', cable('l6').classList.contains('rk-hot'));
    box('srv6', 'front').blur();
    select(null);
    renderRackView(true);
    view().querySelector('.rk-hit[data-key="m3"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    ok('a click on a line selects its cable', state.selectedType === 'link' && state.selectedId === 'm3');
    // Two tracks 4px apart: the browser can hand a click on one's centreline
    // to the other's (wider) hit stroke. The point decides, not the target.
    select(null);
    renderRackView(true);
    {
      const it = _rv.wired.items.find((x) => x.key === 'x1'), r = layerRect();
      const cx = r.left + it.x, cy = r.top + (it.lo + it.hi) / 2;
      view().querySelector('.rk-hit[data-key="x2"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      ok('a click on one of two tracks side by side takes that one, whichever hit stroke it landed on', state.selectedType === 'link' && state.selectedId === 'x1', json([state.selectedId, Math.abs(trackX('x1') - trackX('x2'))]));
    }
    selectEntries([{ type: 'node', id: 'fw' }]);
    renderRackView(true);
    const upFlag = shownFlags('l0').find((b) => b.dataset.node === 'core');
    upFlag.click();
    const said = tipText();
    ok('a tap on a tag selects its cable and shows the port\'s tip', state.selectedType === 'link' && state.selectedId === 'l0' && said.startsWith('CORE · 1'), said);
    ok('the tip: the tag, both ends, VLAN, length, colour and via', said.includes('UPLINK') && said.includes('→ FW · eth1') && said.includes('VLAN 10') && said.includes('2 m')
       && said.includes('blue') && said.includes('PP-1:4'), said);
    ok('kept while its cable is selected', (renderRackView(true), tipText().includes('UPLINK')));
    select(null);
    renderRackView(true);
    ok('and gone when it is not', tipText() === '');

    // ---- 6: one face on show ----
    _rv.cables = 'all'; setRackZoom(2);
    view().querySelector('.rk-face[data-face="rear"]').style.display = 'none';
    rvDrawCables();
    ok('the face not on show draws no line of its own', !cable('m1'));
    lr = lane();
    {
      // SRV1 is at U30 (2U): its foot is 29 units up from the slots' foot.
      const fs = view().querySelector('.rk-slots[data-face="front"]').getBoundingClientRect(), uh = fs.height / 42;
      const r1 = ringAt('l1');
      ok('a cable to it runs on its own track to a ring at the far device\'s level', cable('l1').classList.contains('rk-out')
         && Math.abs(r1.x - trackX('l1')) < 0.5 && r1.x > lr.left && r1.x < lr.right && Math.abs(r1.y - (fs.bottom - 29 * uh)) < 3, json([r1, fs.bottom - 29 * uh]));
      const away = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'].map(ringAt);
      ok('and so does each of the others there: no two on one ring', away.every((a, i) => away.every((b, j) => j <= i || Math.hypot(a.x - b.x, a.y - b.y) > 3)), json(away));
    }
    ok('its tag names the device, port and face there', flags('l1').length === 1 && flags('l1')[0].textContent.trim() === '→ SRV1 · eth0 · rear', flags('l1')[0] && flags('l1')[0].textContent.trim());
    setLocale('es'); applyStaticI18n(); renderRackView(true);
    view().querySelector('.rk-face[data-face="rear"]').style.display = 'none';
    rvDrawCables();
    ok('es: in Spanish', flags('l1')[0].textContent.trim() === '→ SRV1 · eth0 · trasera', flags('l1')[0].textContent.trim());
    setLocale('en'); applyStaticI18n();
    _rv.cables = 'sel'; setRackZoom(1);
    ok('a rebuild shows both faces again', !!cable('m1'));

    // ---- 7: size, drag, sight, read-only ----
    const body = el('rackBody');
    const was = body.style.width;
    const right0 = box('core', 'front').getBoundingClientRect().right;
    body.style.width = '520px';
    await frame(); await frame();
    ok('the faces change size: the lines meet the ports where they are now', box('core', 'front').getBoundingClientRect().right !== right0
       && meets('l1', midOf(port('core', 'front', 'p2')), midOf(port('srv1', 'rear', 'e1'))), json([right0, box('core', 'front').getBoundingClientRect().right]));
    body.style.width = was;
    await frame(); await frame();
    renderRackView(true);
    const dv = box('kvm', 'front');
    const r = dv.getBoundingClientRect();
    ptr('pointerdown', dv.querySelector('.rk-name'), { clientX: r.left + 30, clientY: r.top + 8, button: 0 });
    ptr('pointermove', window, { clientX: r.left + 30, clientY: r.top + 40 });
    ok('while a device is dragged, its lines step back', view().querySelector('.rk-faces').classList.contains('rk-moving'));
    ptr('pointerup', window, { clientX: r.left + 30, clientY: r.top + 40 });
    await new Promise((res) => setTimeout(res, 0));
    ok('and are drawn to where it landed', !view().querySelector('.rk-faces').classList.contains('rk-moving') && getNode('kvm').rackU !== 34
       && meets('k1', midOf(port('kvm', 'front', 'e1')), midOf(port('mgmt', 'rear', 'p22'))));
    undo();
    // A device tapped is scrolled into the pane once; a rebuild with no tap
    // leaves a pane the user scrolled where it was.
    open(big());
    const main = () => view().querySelector('.rk-main');
    const bodyH = body.style.height;
    body.style.height = '300px';
    const inPane = (id) => { const b = box(id, 'front').getBoundingClientRect(), m = main().getBoundingClientRect(); return b.top >= m.top - 1 && b.bottom <= m.bottom + 1; };
    main().scrollTop = main().scrollHeight;
    renderRackView(true);
    ok('a rebuild keeps a pane scrolled away where it was', main().scrollTop > 0 && !inPane('fw'));
    _rv.suppressClick = false;
    box('fw', 'front').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    renderRackView(true);
    ok('a device tapped whose box is out of the pane is scrolled into it', state.selectedId === 'fw' && inPane('fw'));
    if (document.activeElement) document.activeElement.blur();
    main().scrollTop = main().scrollHeight;
    renderRackView(true);
    ok('once, not on every rebuild after', main().scrollTop > 0 && !inPane('fw'));
    body.style.height = bodyH;
    select(null);
    replaceDocument(big(DOC_VERSION + 1), { origin: 'file', docId: 'rack-wires-ro' });
    openRackView('rk');
    renderRackView(true);
    ok('read-only: every cable drawn, with no plugs', view().querySelectorAll('.rk-cable').length === 16 && !view().querySelector('.rk-plug')
       && meets('l1', midOf(port('core', 'front', 'p2')), midOf(port('srv1', 'rear', 'e1'))));
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
