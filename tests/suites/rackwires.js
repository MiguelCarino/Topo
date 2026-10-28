// The rack view's cables drawn on the rack ("Round 2", item 5;
// Review-Packs/Topo-groups.md; rvCableItems, rvDrawCables and rvSetHot in
// js/rackview.js). What is held here:
//   1. pure: which face each end of a line meets the manager on (full depth
//      meets the other end on its face), a rounded route, the items' words;
//   2. the lines meet the boxes: every line's end dot is on its device's box,
//      on the face it runs on, at its plug; a same-face line runs in the
//      manager; a front-rear one meets both faces; a full-depth server to a
//      switch behind it runs on the rear, from its back;
//   3. readable with many: 10+ lines in a 42U rack, the labels of a single
//      cable wait, a bundle shows its count, stubs name their far device;
//      shown labels never overlap and stay in the manager; with few, every
//      label says its ports;
//   4. lit: the selected device's lines, their labels shown, the rest back;
//      a selected cable's two devices marked; pointed at (mouse), a line or
//      a device lights its lines and shows their labels, a touch does not,
//      leaving lets go; a click on a line selects its cables;
//   5. colour on the line and its end dots; the search dims;
//   6. one face on show (a phone): a line to the other face runs to the
//      manager's far edge and names the device there, in Spanish too;
//   7. redrawn when the faces change size; the lines step back while a device
//      is dragged; read-only still draws them.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const frame = () => new Promise((r) => setTimeout(r, 30));
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  const N = (id, type, u, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: type === 'switch' ? [] : [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }], group: 'rk', rackU: u }, extra);
  const H = { rackDepth: 'half' };
  // A core switch on the front cabled to eight full-depth servers, a NAS
  // and a firewall; a management switch at the back cabled to four servers'
  // backs and a patch panel; a half-depth KVM on the front cabled to the
  // management switch (front to rear); three devices outside the rack.
  const big = (v = DOC_VERSION) => {
    const nodes = [
      N('core', 'switch', 40, { portCount: 48, ...H }), N('fw', 'firewall', 42, H), N('kvm', 'custom', 34, H),
      N('pp', 'custom', 38, { rackFace: 'rear', name: 'PATCH', ...H }), N('mgmt', 'switch', 36, { portCount: 24, rackFace: 'rear', ...H }),
      N('nas', 'server', 4, { rackHeight: 2 }), N('ups', 'custom', 1, { rackHeight: 2, interfaces: [] }),
      N('pc1', 'pc', null, { group: 'off' }), N('pc2', 'pc', null, { group: 'off' }), N('ap', 'ap', null, { group: 'off' })
    ];
    for (let i = 1; i <= 8; i++) nodes.push(N(`srv${i}`, 'server', 33 - i * 3, { rackHeight: 2 }));
    nodes.forEach((n) => { if (n.rackU == null) delete n.rackU; });
    const links = [{ id: 'l0', source: 'fw', target: 'core', sourceIface: 'i1', targetIface: 'p1', cable: { color: 'blue', label: 'UPLINK' } }];
    for (let i = 1; i <= 8; i++) links.push({ id: `l${i}`, source: `srv${i}`, target: 'core', sourceIface: 'i1', targetIface: `p${i + 1}` });
    links.push({ id: 'l9', source: 'srv1', target: 'core', sourceIface: 'i2', targetIface: 'p20' });   // a bundle with l1
    links.push({ id: 'l10', source: 'nas', target: 'core', sourceIface: 'i1', targetIface: 'p21', cable: { color: 'green' } });
    for (let i = 1; i <= 4; i++) links.push({ id: `m${i}`, source: `srv${i}`, target: 'mgmt', sourceIface: 'i2', targetIface: `p${i}` });
    links.push({ id: 'm9', source: 'mgmt', target: 'pp', sourceIface: 'p20', targetIface: 'i1' });
    links.push({ id: 'k1', source: 'kvm', target: 'mgmt', sourceIface: 'i1', targetIface: 'p22' });
    links.push({ id: 'x1', source: 'core', target: 'pc1', sourceIface: 'p40', targetIface: 'i1' });
    links.push({ id: 'x2', source: 'core', target: 'pc2', sourceIface: 'p41', targetIface: 'i1' });
    links.push({ id: 'x3', source: 'ap', target: 'core', sourceIface: 'i1', targetIface: 'p42' });
    return { v, nodes, links, groups: [{ id: 'room', name: 'Server room', kind: 'room' }, { id: 'rk', name: 'Rack 1', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'off', name: 'Office', kind: 'room' }] };
  };
  // Few: four lines.
  const small = () => ({ v: DOC_VERSION,
    nodes: [N('sw', 'switch', 20, { portCount: 8, ...H }), N('a', 'server', 10, { rackHeight: 2 }), N('b', 'server', 6, { rackHeight: 2 }),
      N('r', 'custom', 22, { rackFace: 'rear', ...H }), N('pc', 'pc', null, { group: null })],
    links: [{ id: 's1', source: 'a', target: 'sw', sourceIface: 'i1', targetIface: 'p1' }, { id: 's2', source: 'b', target: 'sw', sourceIface: 'i1', targetIface: 'p2' },
      { id: 's3', source: 'r', target: 'sw', sourceIface: 'i1', targetIface: 'p3' }, { id: 's4', source: 'sw', target: 'pc', sourceIface: 'p8', targetIface: 'i1' }],
    groups: [{ id: 'rk', name: 'Rack S', kind: 'rack', uHeight: 24 }] });
  const open = (doc) => { doc.nodes.forEach((n) => { if (n.rackU == null) delete n.rackU; if (n.group == null) delete n.group; }); replaceDocument(doc, { origin: 'file', docId: 'rack-wires' }); setView('rack'); openRackView('rk'); select(null); renderRackView(true); };
  const view = () => el('rackView');
  const cable = (key) => [...view().querySelectorAll('.rk-cable')].find((g) => g.dataset.key === key);
  const lbl = (key) => [...view().querySelectorAll('.rk-lbl')].find((b) => b.dataset.key === key);
  const shown = (b) => !!b && getComputedStyle(b).display !== 'none';
  const box = (id, face) => view().querySelector(`.rk-slots[data-face="${face}"] .rk-dev[data-node="${id}"]`);
  const layerRect = () => view().querySelector('.rk-wires').getBoundingClientRect();
  // An end dot, in the page's coordinates.
  const dots = (key) => [...cable(key).querySelectorAll('.rk-end')].map((c) => { const r = layerRect(); return { x: r.left + Number(c.getAttribute('cx')), y: r.top + Number(c.getAttribute('cy')) }; });
  const inside = (p, r, pad = 0.6) => p.x >= r.left - pad && p.x <= r.right + pad && p.y >= r.top - pad && p.y <= r.bottom + pad;
  const onBox = (p, id, face) => { const b = box(id, face); return !!b && inside(p, b.getBoundingClientRect()); };
  const lane = () => view().querySelector('.rk-lane-in').getBoundingClientRect();
  const ptr = (type, target, extra = {}) => target.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, pointerId: 5, pointerType: 'mouse', isPrimary: true }, extra)));

  try {
    // ---- 1: pure ----
    open(big());
    const g = getNode;
    ok('two half-depth devices: each on its own face', json(rvSides(g('kvm'), g('mgmt'), null)) === json(['front', 'rear']));
    ok('a full-depth one meets a half-depth one on that one\'s face', json(rvSides(g('srv1'), g('mgmt'), null)) === json(['rear', 'rear'])
       && json(rvSides(g('core'), g('srv1'), null)) === json(['front', 'front']));
    ok('two full-depth ones meet on the first one\'s face, or the one on show', json(rvSides(g('srv1'), g('nas'), null)) === json(['front', 'front'])
       && json(rvSides(g('srv1'), g('nas'), 'rear')) === json(['rear', 'rear']));
    const d = rvRoundPath([[0, 0], [20, 0], [20, 40], [0, 40]], 6);
    ok('a route is rounded at its corners', d.startsWith('M 0 0 L 14 0 Q 20 0 20 6') && /L 0 40$/.test(d), d);
    ok('a short leg rounds less', rvRoundPath([[0, 0], [10, 0], [10, 4], [0, 4]], 6).includes('Q 10 0 10 2'));
    const items = rvCableItems(groupById('rk'), ['front', 'rear'], null);
    const item = (key) => items.find((it) => it.key === key);
    ok('one item per pair and per far device, every placed device', items.length === 19 && items.filter((it) => it.kind === 'stub').length === 3, items.length);
    ok('a bundle is one, counted, its label at the quieter end', item('l1 l9').count === '×2' && item('l1 l9').from.id === 'srv1' && /^×2 eth0 ↔ 2, eth1 ↔ 20$/.test(item('l1 l9').text), item('l1 l9').text);
    ok('the colour it is drawn in, when the browser knows it', item('l0').colour === 'blue' && item('l10').colour === 'green' && item('l2').colour === '');

    // ---- 2: the lines meet the boxes ----
    const plugOn = (p, id, face) => { const r = box(id, face).getBoundingClientRect(); return Math.abs(p.x - (face === 'front' ? r.right - 9 : r.left + 9)) < 1.5 && Math.abs(p.y - (r.top + r.height / 2)) < 1.5; };
    // Its two dots, in either order, each at one of the two (id, face) given.
    const meets = (key, test, x, y) => { const e = dots(key); return e.length === 2 && ((test(e[0], ...x) && test(e[1], ...y)) || (test(e[0], ...y) && test(e[1], ...x))); };
    let ends = dots('l2');
    ok('a line ends on both devices\' boxes, at their plugs', meets('l2', plugOn, ['srv2', 'front'], ['core', 'front']), json(ends));
    ok('and every line has a dot on a box', [...view().querySelectorAll('.rk-cable')].every((c) => {
      const ids = c.dataset.ends.split(' ');
      return dots(c.dataset.key).every((p) => ids.some((id) => onBox(p, id, 'front') || onBox(p, id, 'rear')));
    }));
    const runX = (key) => { const p = cable(key).querySelector('.rk-wire'); const b = p.getBBox(); return { l: layerRect().left + b.x, r: layerRect().left + b.x + b.width }; };
    let lr = lane(), rx = runX('l2');
    ok('a same-face line goes out into the manager and back, no further', rx.r > lr.left && rx.r < lr.left + lr.width / 2 + 1, json([rx, lr.left, lr.right]));
    ends = dots('m1');
    ok('a full-depth server to the switch behind it: on the rear, from its back', meets('m1', onBox, ['srv1', 'rear'], ['mgmt', 'rear']) && box('srv1', 'rear').classList.contains('rk-back')
       && runX('m1').l > lr.left + lr.width / 2 - 1, json(ends));
    ends = dots('k1');
    ok('front to rear: across the manager, from one face\'s box to the other\'s', meets('k1', onBox, ['kvm', 'front'], ['mgmt', 'rear']));
    const stubDots = dots('x1');
    ok('a stub starts on its device and runs to the chip that names the far one', stubDots.length === 1 && onBox(stubDots[0], 'core', 'front')
       && lbl('x1').textContent.trim() === '→ PC1' && lbl('x1').classList.contains('rk-lbl-stub'));
    ok('a device with no unit has no line', !view().querySelector('.rk-cable[data-ends~="pc1"]:not([data-key="x1"])'));

    // ---- 3: readable with many ----
    const quietSingles = ['l2', 'l3', 'm1', 'k1'].map(lbl);
    ok('many lines: a single cable\'s label waits', quietSingles.every((b) => b.classList.contains('rk-quiet') && !shown(b)));
    ok('a bundle shows its count only', lbl('l1 l9').classList.contains('rk-quiet') && shown(lbl('l1 l9')) && getComputedStyle(lbl('l1 l9'), '::before').content.includes('×2')
       && getComputedStyle(lbl('l1 l9').querySelector('span')).display === 'none');
    ok('stubs always name their far device', ['x1', 'x2', 'x3'].every((k) => shown(lbl(k))));
    const visibleRects = () => [...view().querySelectorAll('.rk-lbl')].filter(shown).map((b) => b.getBoundingClientRect());
    const noOverlap = (rs) => rs.every((a, i) => rs.every((b, j) => j <= i || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5 || a.right <= b.left || b.right <= a.left));
    ok('the labels on show do not overlap', noOverlap(visibleRects()));
    lr = lane();
    ok('and stay in the manager', visibleRects().every((r) => r.left >= lr.left - 0.5 && r.right <= lr.right + 0.5), json(visibleRects().map((r) => [r.left, r.right]).slice(0, 4)));
    ok('nested lines on a side are on their own tracks while there is room', (() => {
      const xs = ['l5', 'l6', 'l7', 'l8'].map((k) => Math.round(runX(k).r));
      return new Set(xs).size === 4;
    })());

    // ---- 4: lit ----
    selectEntries([{ type: 'node', id: 'core' }]);
    renderRackView(true);
    const coreKeys = ['l0', 'l1 l9', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l10', 'x1', 'x2', 'x3'];
    ok('the selected device\'s lines are lit, only those', coreKeys.every((k) => cable(k).classList.contains('rk-wsel')) && !cable('m1').classList.contains('rk-wsel'));
    ok('their labels say their ports, ten and more of them, none over another', coreKeys.every((k) => shown(lbl(k)) && !lbl(k).classList.contains('rk-quiet'))
       && noOverlap(visibleRects()), json(coreKeys.filter((k) => !shown(lbl(k)))));
    ok('the rest step back', view().querySelector('.rk-wiring').classList.contains('rk-lit') && Number(getComputedStyle(cable('m1')).opacity) < 1);
    lbl('l3').click();
    ok('a label selects its cable, which marks its two devices', state.selectedType === 'link' && state.selectedId === 'l3'
       && box('srv3', 'front').classList.contains('rk-cabled') && box('core', 'front').classList.contains('rk-cabled') && !box('srv4', 'front').classList.contains('rk-cabled'));
    select(null);
    renderRackView(true);
    view().querySelector('.rk-hit[data-key="m2"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    ok('a click on a line selects its cables', state.selectedType === 'link' && state.selectedId === 'm2');
    view().querySelector('.rk-hit[data-key="l1 l9"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    ok('a bundle\'s line selects both', selectedOf('link').sort().join() === 'l1,l9');
    select(null);
    renderRackView(true);
    ptr('pointerover', view().querySelector('.rk-hit[data-key="l4"]'));
    ok('pointed at: the line lit, its label shown, its two devices marked', cable('l4').classList.contains('rk-hot') && shown(lbl('l4')) && lbl('l4').classList.contains('rk-hot')
       && box('srv4', 'front').classList.contains('rk-hot') && box('core', 'front').classList.contains('rk-hot') && !cable('l5').classList.contains('rk-hot')
       && view().querySelector('.rk-wiring').classList.contains('rk-hotting'));
    ptr('pointerover', box('srv2', 'front'));
    ok('a device pointed at lights its lines, on both faces', cable('l2').classList.contains('rk-hot') && cable('m2').classList.contains('rk-hot')
       && !cable('l4').classList.contains('rk-hot') && shown(lbl('m2')));
    ptr('pointerleave', view(), { bubbles: false });
    ok('leaving the view lets go', !view().querySelector('.rk-hot') && !view().querySelector('.rk-wiring').classList.contains('rk-hotting'));
    ptr('pointerover', view().querySelector('.rk-hit[data-key="l4"]'), { pointerType: 'touch' });
    ok('a finger does not hover: nothing lit', !view().querySelector('.rk-hot'));
    box('srv5', 'front').focus();
    ok('a device focused from the keyboard lights its lines', cable('l5').classList.contains('rk-hot'));
    box('srv5', 'front').blur();

    // ---- 4b: pointed at, with many (repair round 1) ----
    // A server pointed at lights two or three quiet singles at once, at the
    // height its bundle's count or a stub's chip already holds: each takes
    // the free height nearest its line's, joined to it by a leader.
    const lead = (key) => cable(key).querySelector('.rk-lead').getAttribute('d') || '';
    const hovered = {};
    [['srv1', 'front'], ['srv2', 'front'], ['mgmt', 'rear'], ['srv3', 'front']].forEach(([id, face]) => {
      ptr('pointerover', box(id, face));
      hovered[id] = { over: !noOverlap(visibleRects()), keys: [...view().querySelectorAll('.rk-lbl.rk-hot')].filter(shown).map((b) => b.dataset.key) };
    });
    ptr('pointerleave', view(), { bubbles: false });
    ok('a device pointed at: its labels all show, none over another', Object.values(hovered).every((h) => !h.over)
       && hovered.srv1.keys.includes('m1') && hovered.srv1.keys.includes('l1 l9') && hovered.srv2.keys.includes('l2') && hovered.srv2.keys.includes('m2')
       && hovered.mgmt.keys.length === 6, json(hovered));
    ptr('pointerover', box('srv1', 'front'));
    const m1y = parseFloat(lbl('m1').style.top), d1y = dots('m1').find((p) => onBox(p, 'srv1', 'rear')).y - layerRect().top;
    const ml = lead('m1').match(/^M [\d.]+ ([\d.]+) L [\d.]+ ([\d.]+)$/);
    ok('one moved out of the way is joined to its line by a leader, from its line\'s height to its own', shown(lbl('m1')) && Math.abs(m1y - d1y) > 1
       && !!ml && Math.abs(Number(ml[1]) - d1y) < 1 && Math.abs(Number(ml[2]) - m1y) < 1, json([m1y, d1y, lead('m1')]));
    ptr('pointerleave', view(), { bubbles: false });
    ok('let go, it hides again and its leader with it', !shown(lbl('m1')) && lead('m1') === '');
    const bx = runX('l1 l9');
    const bl = lead('l1 l9').match(/^M ([\d.]+) [\d.]+ L ([\d.]+)/);
    ok('a bundle\'s quiet count out past the other tracks has a leader from its own track', !!bl
       && Math.abs(layerRect().left + Number(bl[1]) - bx.r) < 1.5 && Math.abs(layerRect().left + Number(bl[2]) - lbl('l1 l9').getBoundingClientRect().left) < 1.5, json([lead('l1 l9'), bx]));
    ok('and the count sits clear of its line\'s track, not over it', lbl('l1 l9').getBoundingClientRect().left > bx.r);
    selectEntries([{ type: 'node', id: 'core' }]);
    renderRackView(true);
    const cut = (b) => { const s = b.querySelector('span'); return s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1; };
    ok('selected, a bundle\'s ports read in full where the manager has room', !cut(lbl('l1 l9')) && !cut(lbl('l0')), json([lbl('l1 l9').getBoundingClientRect().width, lane().width]));
    select(null);
    renderRackView(true);

    // ---- 5: colour, search ----
    const wire = (k) => cable(k).querySelector('.rk-wire');
    ok('a line in its cable\'s colour, and its end dots', /stroke:\s*blue/.test(wire('l0').getAttribute('style') || '') && [...cable('l0').querySelectorAll('.rk-end')].every((c) => /fill:\s*blue/.test(c.getAttribute('style') || '')));
    ok('a bundle is drawn thicker', Number(wire('l1 l9').getAttribute('stroke-width')) > Number(wire('l2').getAttribute('stroke-width')));
    setQuery('name:srv7');
    renderRackView(true);
    ok('the search dims the lines it does not match', cable('l2').classList.contains('q-dim') && !cable('l7').classList.contains('q-dim'));
    setQuery('');
    renderRackView(true);

    // ---- 6: one face on show ----
    const rear = view().querySelector('.rk-face[data-face="rear"]');
    rear.style.display = 'none';
    rvDrawCables();
    ok('the face not on show draws no line of its own', !cable('m1') && !cable('m9'));
    ends = dots('k1');
    lr = lane();
    ok('a line to it runs to the manager\'s far edge', ends.length === 1 && onBox(ends[0], 'kvm', 'front') && runX('k1').r >= lr.right - 0.5, json([runX('k1'), lr.right]));
    ok('and names the device there, always', shown(lbl('k1')) && /^→ MGMT · rear · eth0 ↔ 22$/.test(lbl('k1').textContent.trim()), lbl('k1').textContent.trim());
    setLocale('es'); applyStaticI18n(); renderRackView(true);
    view().querySelector('.rk-face[data-face="rear"]').style.display = 'none';
    rvDrawCables();
    ok('es: in Spanish', /^→ MGMT · trasera · /.test(lbl('k1').textContent.trim()), lbl('k1').textContent.trim());
    setLocale('en'); applyStaticI18n(); renderRackView(true);
    ok('a rebuild shows both faces again', !!cable('m1'));
    // A phone's manager (8.5rem, about 130px): the far end's name and ports
    // do not fit one line, so the label wraps rather than being cut, and the
    // labels still keep clear of each other.
    view().querySelector('.rk-face[data-face="front"]').style.display = 'none';
    view().querySelector('.rk-faces').style.gridTemplateColumns = '134px minmax(0, 1fr)';
    rvDrawCables();
    ok('a narrow manager: the far end\'s label wraps to two lines, every word of it shown', lbl('k1').classList.contains('rk-l2')
       && /^→ KVM · front · 22 ↔ eth0$/.test(lbl('k1').textContent.trim()) && !cut(lbl('k1')), json([lbl('k1').className, lbl('k1').getBoundingClientRect().height]));
    ok('and takes two lines\' room among the rest', noOverlap(visibleRects()) && Math.abs(lbl('k1').getBoundingClientRect().height - 32) < 1.5);
    view().querySelector('.rk-faces').style.gridTemplateColumns = '';
    renderRackView(true);

    // ---- 3b: few ----
    open(small());
    ok('few lines: every label says its ports', [...view().querySelectorAll('.rk-lbl')].every((b) => shown(b) && !b.classList.contains('rk-quiet'))
       && view().querySelectorAll('.rk-lbl').length === 4);
    ok('a full-depth server to a half-depth switch on the front, a rear device to it across', dots('s1').every((p) => onBox(p, 'a', 'front') || onBox(p, 'sw', 'front'))
       && meets('s3', onBox, ['r', 'rear'], ['sw', 'front']));

    // ---- 7: size, drag, read-only ----
    const body = el('rackBody');
    const was = body.style.width;
    const right0 = box('a', 'front').getBoundingClientRect().right;
    body.style.width = '480px';
    await frame(); await frame();
    ok('the faces change size: the lines meet the boxes where they are now', box('a', 'front').getBoundingClientRect().right !== right0
       && meets('s1', plugOn, ['a', 'front'], ['sw', 'front']), json([right0, box('a', 'front').getBoundingClientRect().right, dots('s1')]));
    body.style.width = was;
    await frame(); await frame();
    renderRackView(true);
    const dev = box('a', 'front');
    const r = dev.getBoundingClientRect();
    ptr('pointerdown', dev.querySelector('.rk-name'), { clientX: r.left + 30, clientY: r.top + 8, button: 0 });
    ptr('pointermove', window, { clientX: r.left + 30, clientY: r.top - 40 });
    ok('while a device is dragged, its lines step back', view().querySelector('.rk-faces').classList.contains('rk-moving'));
    ptr('pointerup', window, { clientX: r.left + 30, clientY: r.top - 40 });
    await new Promise((res) => setTimeout(res, 0));
    ok('and are drawn to where it landed', !view().querySelector('.rk-faces').classList.contains('rk-moving') && dots('s1').some((p) => onBox(p, 'a', 'front')));
    undo();

    // ---- 7b: a device tapped stays in sight (repair round 1) ----
    // On a phone its buttons come in above the rack and push the units
    // down; the box tapped is scrolled back into the pane. A rebuild with no
    // tap leaves a pane the user scrolled where it was.
    open(big());
    const main = () => view().querySelector('.rk-main');
    const bodyH = body.style.height;
    body.style.height = '300px';
    const inPane = (id) => { const b = box(id, 'front').getBoundingClientRect(), m = main().getBoundingClientRect(); return b.top >= m.top - 1 && b.bottom <= m.bottom + 1; };
    main().scrollTop = main().scrollHeight;
    renderRackView(true);
    const low = main().scrollTop;
    ok('a rebuild keeps a pane scrolled away where it was', low > 0 && !inPane('fw'), low);
    // Tapped while out of the pane (the bar coming in above the rack does
    // that on a phone): the rebuild that follows the tap brings it back.
    _rv.suppressClick = false;   // left by section 7's drag; a real press clears it (onRackPointerDown)
    box('fw', 'front').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    renderRackView(true);
    ok('a device tapped whose box is out of the pane is scrolled into it', state.selectedId === 'fw' && inPane('fw'), json([main().scrollTop, state.selectedId]));
    // (Unfocused first: a rebuild gives a focused box its focus back, which
    // scrolls it in on its own; that is the keyboard's, not this.)
    if (document.activeElement) document.activeElement.blur();
    main().scrollTop = main().scrollHeight;
    renderRackView(true);
    ok('once, not on every rebuild after', main().scrollTop > 0 && !inPane('fw'));
    body.style.height = bodyH;
    select(null);
    const ro = small(); ro.v = DOC_VERSION + 1;
    replaceDocument(ro, { origin: 'file', docId: 'rack-wires-ro' });
    openRackView('rk');
    renderRackView(true);
    ok('read-only: the lines are drawn, with no plugs', view().querySelectorAll('.rk-cable').length === 4 && !view().querySelector('.rk-plug')
       && dots('s1').every((p) => onBox(p, 'a', 'front') || onBox(p, 'sw', 'front')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    setLocale('en');
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
