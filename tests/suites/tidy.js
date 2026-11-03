// Tidy at site scale (plan R8, js/app.js "Auto-layout"): it used to put every
// device of one depth in one row, about forty wide on a real site. Now
//   1. the backbone (cloud, router, switches) is in tiers from the top, each
//      tier wrapped 12 wide;
//   2. each switch's devices are a block of their own, in port order, at most
//      12 wide, the blocks side by side and wrapped the same way, with nothing
//      drawn on top of anything else;
//   3. devices with no cable go last;
//   4. with two or more devices selected, only those are arranged, starting
//      where the selection started, and nothing else moves;
//   5. either way it is one undo step (Untidy is gone: tests/suites/batch.js);
//   6. the notes go with their devices: a note on one keeps its offset, a
//      note on two takes the mean of their steps, one on nothing stays;
//   7. a rack is one column in unit order, its VMs and containers on their
//      host's row; without groups, a VM cabled to a switch goes under its host.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  // A cloud, a router, a core switch, three access switches with 20, 13 and
  // 5 devices on shuffled ports, and four devices with no cable.
  const site = () => {
    const nodes = [
      { id: 'isp', type: 'cloud', name: 'ISP', x: 900, y: 900, interfaces: [{ id: 'i1', name: 'wan0', ip: '' }] },
      { id: 'rt', type: 'router', name: 'Router', x: 10, y: 700, interfaces: [{ id: 'w', name: 'wan', ip: '' }, { id: 'l', name: 'lan', ip: '' }] },
      { id: 'core', type: 'switch', name: 'Core', x: 500, y: 40, portCount: 24, interfaces: [] }
    ];
    const links = [{ id: 'k0', source: 'isp', target: 'rt', sourceIface: 'i1', targetIface: 'w' },
      { id: 'k1', source: 'rt', target: 'core', sourceIface: 'l', targetIface: 'p24' }];
    [['a', 20], ['b', 13], ['c', 5]].forEach(([s, count], si) => {
      nodes.push({ id: `sw${s}`, type: 'switch', name: `SW-${s.toUpperCase()}`, x: 300 * si, y: 2000, portCount: 24, interfaces: [] });
      links.push({ id: `u${s}`, source: 'core', target: `sw${s}`, sourceIface: `p${si + 1}`, targetIface: 'p24' });
      // Ports in a shuffled but fixed order, names that do not sort like ports.
      const ports = Array.from({ length: count }, (_, i) => i + 1).sort((x, y) => ((x * 7) % 11) - ((y * 7) % 11) || x - y);
      ports.forEach((port, i) => {
        const id = `${s}${port}`;
        nodes.push({ id, type: 'voip', name: `Phone ${s}-${String.fromCharCode(97 + ((i * 5) % 26))}${i}`, x: (i * 37) % 800, y: 3000 + i * 3, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] });
        links.push({ id: `l${id}`, source: `sw${s}`, target: id, sourceIface: `p${port}`, targetIface: 'i1' });
      });
    });
    ['x1', 'x2', 'x3', 'x4'].forEach((id, i) => nodes.push({ id, type: i % 2 ? 'printer' : 'pc', name: `Loose ${i}`, x: 5, y: 5, interfaces: [] }));
    return { v: DOC_VERSION, nodes, links };
  };
  const byY = () => {
    const rows = new Map();
    state.nodes.forEach((n) => { if (!rows.has(n.y)) rows.set(n.y, []); rows.get(n.y).push(n); });
    return rows;
  };
  const portOf = (n) => { const l = state.links.find((x) => x.target === n.id && /^sw/.test(x.source)); return Number(l.sourceIface.slice(1)); };
  const reading = (a, b) => (a.y - b.y) || (a.x - b.x);

  try {
    replaceDocument(site(), { origin: 'file' });
    initHistory();
    const steps = _undoStack.length;
    tidyLayout();
    ok('one undo step', _undoStack.length === steps + 1);
    const widest = Math.max(...[...byY().values()].map((r) => r.length));
    ok('no row is wider than 12', widest <= TIDY_WRAP && TIDY_WRAP === 12, String(widest));
    const spots = new Set(state.nodes.map((n) => `${n.x},${n.y}`));
    ok('nothing is drawn on top of anything else', spots.size === state.nodes.length, `${spots.size} of ${state.nodes.length}`);
    ok('everything on the grid', state.nodes.every((n) => n.x % GRID_SNAP === 0 && n.y % GRID_SNAP === 0));
    const y = (id) => getNode(id).y;
    ok('the backbone in tiers from the top: cloud, router, core, access switches', y('isp') < y('rt') && y('rt') < y('core') && y('core') < y('swa')
       && y('swa') === y('swb') && y('swb') === y('swc'));
    const phones = (s) => state.nodes.filter((n) => n.id.startsWith(s) && n.type === 'voip');
    const lowestSwitch = Math.max(y('swa'), y('swb'), y('swc'));
    ok('the devices sit below the switches', state.nodes.filter((n) => n.type === 'voip').every((n) => n.y > lowestSwitch));
    ['a', 'b', 'c'].forEach((s) => {
      const list = phones(s);
      const xs = new Set(list.map((n) => n.x));
      const inReading = list.slice().sort(reading).map(portOf);
      ok(`SW-${s.toUpperCase()}'s devices are a block of at most 12 columns`, xs.size === Math.min(12, list.length), String(xs.size));
      ok(`in port order, read left to right, top to bottom`, inReading.every((p, i) => i === 0 || p > inReading[i - 1]), inReading.join(','));
    });
    // Blocks never interleave: a block's box holds only its own devices.
    const box = (list) => ({ x0: Math.min(...list.map((n) => n.x)), x1: Math.max(...list.map((n) => n.x)), y0: Math.min(...list.map((n) => n.y)), y1: Math.max(...list.map((n) => n.y)) });
    const intruders = ['a', 'b', 'c'].flatMap((s) => {
      const b = box(phones(s));
      return state.nodes.filter((n) => !n.id.startsWith(s) && n.x >= b.x0 && n.x <= b.x1 && n.y >= b.y0 && n.y <= b.y1).map((n) => `${s}:${n.id}`);
    });
    ok('each switch\'s block holds only its own devices', !intruders.length, intruders.slice(0, 5).join(','));
    const loose = state.nodes.filter((n) => n.id.startsWith('x'));
    ok('devices with no cable go last', loose.every((n) => n.y > Math.max(...state.nodes.filter((m) => !m.id.startsWith('x')).map((m) => m.y))));
    // The backbone over what it serves: each access switch over its block,
    // the core over the access switches, the router over the core (it used
    // to sit at the left edge while the rows ran twelve wide to the right).
    const span = (list) => [Math.min(...list.map((n) => n.x)), Math.max(...list.map((n) => n.x))];
    const over = (id, list) => { const [a, b] = span(list); return getNode(id).x >= a && getNode(id).x <= b; };
    ok('each switch sits over its own devices', ['a', 'b', 'c'].every((s) => over(`sw${s}`, phones(s))),
       ['a', 'b', 'c'].map((s) => `${getNode(`sw${s}`).x} in ${span(phones(s))}`).join(' '));
    ok('the core over the switches, the router and the cloud over the core', over('core', ['swa', 'swb', 'swc'].map(getNode))
       && Math.abs(getNode('rt').x - getNode('core').x) <= GRID_SNAP && Math.abs(getNode('isp').x - getNode('rt').x) <= GRID_SNAP,
       ['isp', 'rt', 'core', 'swa', 'swc'].map((id) => `${id}=${getNode(id).x}`).join(' '));
    const tidied = JSON.stringify(state.nodes.map((n) => [n.id, n.x, n.y]));
    tidyLayout();
    ok('a second Tidy changes nothing', JSON.stringify(state.nodes.map((n) => [n.id, n.x, n.y])) === tidied);
    undo(); undo();
    ok('Undo puts the drawing back', getNode('isp').x === 900 && getNode('core').y === 40);

    // ---- Only the selection ----
    tidyLayout();
    const pick = ['a1', 'a2', 'a3', 'a4', 'a5'];
    pick.forEach((id, i) => { const n = getNode(id); n.x = 2000 + i * 70 + (i % 2) * 33; n.y = 1500 - i * 41; });
    save();
    const others = JSON.stringify(state.nodes.filter((n) => !pick.includes(n.id)).map((n) => [n.id, n.x, n.y]));
    const x0 = Math.min(...pick.map((id) => getNode(id).x)), y0 = Math.min(...pick.map((id) => getNode(id).y));
    selectEntries(pick.map((id) => ({ type: 'node', id })));
    const steps2 = _undoStack.length;
    tidyLayout();
    ok('with a selection, nothing else moves', JSON.stringify(state.nodes.filter((n) => !pick.includes(n.id)).map((n) => [n.id, n.x, n.y])) === others);
    ok('the selection is arranged in one row, in name order (no cable among them)', new Set(pick.map((id) => getNode(id).y)).size === 1
       && pick.map((id) => getNode(id)).sort((a, b) => a.x - b.x).map((n) => n.id).join(',') === pick.slice().sort((a, b) => getNode(a).name.localeCompare(getNode(b).name, undefined, { numeric: true })).join(','));
    ok('starting where the selection started', Math.min(...pick.map((id) => getNode(id).x)) === Math.round(x0 / GRID_SNAP) * GRID_SNAP
       && Math.min(...pick.map((id) => getNode(id).y)) === Math.round(y0 / GRID_SNAP) * GRID_SNAP);
    ok('one undo step, and the selection kept', _undoStack.length === steps2 + 1 && state.selection.size === 5);
    // A switch and its devices, selected: the switch on top, its block below.
    const pick2 = ['swc', 'c1', 'c2', 'c3', 'c4', 'c5'];
    selectEntries(pick2.map((id) => ({ type: 'node', id })));
    tidyLayout();
    ok('a selected switch heads its own devices', pick2.slice(1).every((id) => getNode(id).y > getNode('swc').y)
       && pick2.slice(1).map((id) => getNode(id)).sort(reading).map(portOf).join(',') === '1,2,3,4,5');
    // One device selected is not a selection to arrange: the whole map is.
    select('a1', 'node');
    tidyLayout();
    ok('one device selected tidies the whole map', JSON.stringify(state.nodes.map((n) => [n.id, n.x, n.y])) === tidied);
    ok('tidyPositions is pure', (() => { const before = JSON.stringify(state.nodes); tidyPositions(state.nodes, state.links); return JSON.stringify(state.nodes) === before; })());

    // ---- 6. Notes go with their devices ----
    replaceDocument(Object.assign(site(), { annotations: [
      { id: 'n1', x: 100, y: 3100, text: 'a1', style: 'note', size: 12, targets: ['a1'] },
      { id: 'n2', x: 200, y: 200, text: 'both', style: 'note', size: 12, targets: ['a1', 'b1'] },
      { id: 'n3', x: 700, y: 700, text: 'page', style: 'note', size: 12, targets: [] }
    ] }));
    select(null, null);
    const a1 = { ...getNode('a1') }, b1 = { ...getNode('b1') }, n1 = { ...getAnnotation('n1') }, n2 = { ...getAnnotation('n2') };
    tidyLayout();
    const off = (n, a) => `${a.x - n.x},${a.y - n.y}`;
    ok('a note on one device keeps its place beside it', off(getNode('a1'), getAnnotation('n1')) === off(a1, n1), `${off(a1, n1)} -> ${off(getNode('a1'), getAnnotation('n1'))}`);
    const half = (k) => Math.round(n2[k] + ((getNode('a1')[k] - a1[k]) + (getNode('b1')[k] - b1[k])) / 2);
    ok('a note on two devices takes the mean of their steps', getAnnotation('n2').x === half('x') && getAnnotation('n2').y === half('y'), `${getAnnotation('n2').x},${getAnnotation('n2').y}`);
    ok('a note on nothing stays', getAnnotation('n3').x === 700 && getAnnotation('n3').y === 700);
    undo();
    ok('one undo step puts the notes back too', getAnnotation('n1').x === n1.x && getAnnotation('n1').y === n1.y && getAnnotation('n2').x === n2.x);
    // With a selection, a note on a device left alone stays.
    selectEntries(['b1', 'b2', 'b3'].map((id) => ({ type: 'node', id })));
    tidyLayout();
    ok('with a selection, a note on a device not tidied does not move', getAnnotation('n1').x === n1.x && getAnnotation('n1').y === n1.y);
    select(null, null);

    // ---- 7. Racks in unit order, guests beside their host ----
    const D = (id, type, extra) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    replaceDocument({ v: DOC_VERSION,
      groups: [{ id: 'rm', name: 'Room', kind: 'room' }, { id: 'rk', name: 'Rack', kind: 'rack', parent: 'rm', rackHeight: 42 }],
      nodes: [
        D('sw', 'switch', { group: 'rk', rackU: 40, portCount: 24, interfaces: [], x: 400, y: 900 }),
        D('srv', 'server', { group: 'rk', rackU: 30, x: 100, y: 100 }),
        D('nas', 'server', { group: 'rk', rackU: 36, x: 700, y: 400 }),
        D('pdu', 'server', { group: 'rk', rackU: 2, rackFace: 'back', x: 50, y: 50 }),
        D('new', 'server', { group: 'rk', x: 60, y: 60 }),
        D('vm2', 'vm', { group: 'rk', host: 'srv', x: 900, y: 900 }),
        D('vm1', 'vm', { group: 'rk', host: 'srv', x: 950, y: 50 }),
        D('ct', 'container', { group: 'rk', host: 'vm2', x: 990, y: 990 }),
        D('pc', 'pc', { group: 'rm', x: 0, y: 0 })
      ],
      links: [
        { id: 'r1', source: 'sw', target: 'srv' }, { id: 'r2', source: 'sw', target: 'nas' }, { id: 'r3', source: 'sw', target: 'pdu' },
        { id: 'r4', source: 'sw', target: 'vm1' }, { id: 'r5', source: 'sw', target: 'vm2' }, { id: 'r6', source: 'sw', target: 'pc' }
      ] });
    select(null, null); tidyLayout();
    const col = ['sw', 'nas', 'srv', 'pdu', 'new'].map((id) => getNode(id));
    ok('a rack is one column, the top unit at the top, then what has no units', col.every((n) => n.x === col[0].x)
       && col.every((n, i) => !i || n.y > col[i - 1].y), col.map((n) => `${n.id}:${n.x},${n.y}`).join(' '));
    const row = ['srv', 'vm1', 'vm2', 'ct'].map((id) => getNode(id));
    ok('its VMs sit on their host\'s row, to its right: each VM, then what runs on it', row.every((n) => n.y === row[0].y)
       && row.every((n, i) => !i || n.x > row[i - 1].x), row.map((n) => `${n.id}:${n.x},${n.y}`).join(' '));
    ok('right beside it', getNode('vm1').x - getNode('srv').x <= 160, `${getNode('vm1').x - getNode('srv').x}`);
    // Without groups, a VM cabled to a switch still goes under its host.
    replaceDocument({ v: DOC_VERSION, nodes: [
      D('sw', 'switch', { portCount: 24, interfaces: [] }), D('h', 'server', {}), D('p1', 'pc', {}), D('p2', 'pc', {}), D('p3', 'pc', {}),
      D('v', 'vm', { host: 'h', x: 2000, y: 2000 })
    ], links: ['h', 'p1', 'p2', 'p3', 'v'].map((id, i) => ({ id: `w${i}`, source: 'sw', target: id, sourceIface: `p${i + 1}`, targetIface: 'i1' })) });
    select(null, null); tidyLayout();
    const h = getNode('h'), v = getNode('v');
    ok('a VM cabled to a switch goes under its host, not with the switch\'s desks', v.y > h.y && Math.abs(v.x - h.x) <= 160, `host ${h.x},${h.y} vm ${v.x},${v.y}`);
    ok('the host stays on the switch\'s tier, over its VM', h.y > getNode('sw').y);
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e).slice(0, 300));
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
