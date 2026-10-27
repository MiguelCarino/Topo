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
//   5. either way it is one undo step (Untidy is gone: tests/suites/batch.js).
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
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e).slice(0, 300));
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
