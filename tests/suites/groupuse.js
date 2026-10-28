// Groups on the map, step B part 2 (Review-Packs/Topo-groups.md): working
// with collapsed groups. What is held here:
//   1. where folded devices are on screen (mapPointsOf, js/groupmap.js):
//      the collapsed node, once per group; focusing a folded device (a table
//      row, a finding) centres the map on its group's node, which shows that
//      it holds part of the selection; Select members does the same;
//   2. the search: a collapsed group hiding a match lights up (a ring, not
//      dimmed, the count in its tooltip), one hiding none dims, and Zoom to
//      matches frames the node, not the empty patch;
//   3. the trace runs through a collapsed group: the node and the folded
//      lines on both sides light, the devices beyond it are reached; traced
//      from a folded device, the node is marked as where it starts;
//   4. Tidy with groups: each group laid out as a block, no frame on
//      another (siblings apart, each inside its parent, no loose device
//      inside a frame), one undo step; a selection tidies the same way where
//      it is, a room selected whole bringing the racks inside it; with no
//      groups, and in the reduced views, Tidy is as it was;
//      the collapsed node follows its members;
//   5. the report's picture and the exports follow the map as it is,
//      collapsed or expanded;
//   6. the ▸/▾ is a tap target a finger can hit, beside (not inside) what a
//      tap selects, unoutlined on hover, and Spanish.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? false : null));

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  // The rack (a router and a switch) in the server room, a server beside it,
  // an office of two PCs on the switch, and a server in no group.
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('rtr', 'router', { x: 0, y: 0, group: 'rk', rackU: 40, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }, { id: 'i2', name: 'eth1', ip: '' }] }),
      N('sw', 'switch', { x: 100, y: 0, group: 'rk', rackU: 12, portCount: 8, interfaces: [] }),
      N('srv', 'server', { x: 200, y: 0, group: 'room', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }, { id: 'i2', name: 'eth1', ip: '' }] }),
      N('pc1', 'pc', { x: 0, y: 300, group: 'off', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.21/24' }] }),
      N('pc2', 'pc', { x: 120, y: 300, group: 'off', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.22/24' }] }),
      N('out', 'server', { x: 500, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.30/24' }, { id: 'i2', name: 'eth1', ip: '' }, { id: 'i3', name: 'eth2', ip: '' }] })
    ],
    links: [
      { id: 'l1', source: 'rtr', target: 'sw', sourceIface: 'i1', targetIface: 'p1' },
      { id: 'l2', source: 'sw', target: 'srv', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'l3', source: 'sw', target: 'pc1', sourceIface: 'p3', targetIface: 'i1' },
      { id: 'l4', source: 'sw', target: 'pc2', sourceIface: 'p4', targetIface: 'i1' },
      { id: 'l5', source: 'sw', target: 'out', sourceIface: 'p5', targetIface: 'i1' }
    ],
    groups: [
      { id: 'bA', name: 'Building A', kind: 'building' },
      { id: 'room', name: 'Server room', kind: 'room', parent: 'bA' },
      { id: 'rk', name: 'Rack 3', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'off', name: 'Office', kind: 'room', parent: 'bA' }
    ] });
  const open = (doc = site(), docId = 'doc-use') => replaceDocument(doc, { origin: 'file', docId });
  const block = (id) => el(`ui-group-${id}`);
  // A collapsed node's ▸ is drawn beside it, not in it (gmToggle, js/groupmap.js).
  const toggleOf = (id) => document.querySelector(`#layer-nodes > .grp-toggle[data-grp="${id}"]`);
  const card = (id) => block(id).querySelectorAll(':scope > rect:not(.grp-node-hit)')[1];
  const tip = (id) => block(id).querySelector(':scope > title').textContent;
  // The map point at the middle of the canvas.
  const centre = () => {
    const r = el('networkCanvas').getBoundingClientRect();
    return { x: (r.width / 2 - state.camera.x) / state.camera.zoom, y: (r.height / 2 - state.camera.y) / state.camera.zoom };
  };
  const near = (p, x, y) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1;
  const edgeOf = (ids) => [...el('layer-links').querySelectorAll('.grp-edge')].find((p) => p.getAttribute('data-links') === ids);
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const within = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  // A frame with its tab, which rides 10 above the top edge.
  const withTab = (r) => ({ x: r.x, y: r.y - 10, w: r.w, h: r.h + 10 });

  try {
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }

    // ---- 1: where folded devices are ----
    open();
    ok('nothing collapsed: every device is where it is', json(mapPointsOf(state.nodes).map((p) => [p.x, p.y]))
       === json(state.nodes.map((n) => [n.x, n.y])));
    setGroupCollapsed('rk', true);
    const pts = mapPointsOf(['rtr', 'sw', 'srv'].map(getNode));
    ok('folded devices are their group\'s node, once', pts.length === 2 && near(pts[0], 50, 0) && near(pts[1], 200, 0), json(pts));
    ok('one device alone too', near(mapPointOf(getNode('sw')), 50, 0) && mapPointOf(getNode('srv')) === getNode('srv'));

    state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera();
    focusOnMap({ type: 'node', id: 'sw' });
    ok('focusing a folded device centres the map on its group\'s node', near(centre(), 50, 0), json(centre()));
    ok('and selects the device', state.selectedId === 'sw');
    ok('the node shows it holds part of the selection: a dashed yellow outline',
       card('rk').getAttribute('stroke') === '#eab308' && card('rk').getAttribute('stroke-dasharray') === '5 3');
    ok('and says so in its tooltip', /1 of them is selected/.test(tip('rk')), tip('rk'));
    focusOnMap({ type: 'link', id: 'l2' });
    ok('a cable from a folded device is centred between the node and its far end', near(centre(), 125, 0), json(centre()));
    select(null, null);
    ok('nothing selected, the outline is plain again', card('rk').getAttribute('stroke') === '#64748b' && !card('rk').getAttribute('stroke-dasharray'));

    // A table row on a folded device, as a click on it does.
    setView('table');
    showTableTab('devices');
    const row = _tv.rows.find((r) => r.rec === 'node' && r.ref.nodeId === 'rtr');
    ok('the table lists the folded devices', !!row);
    state.camera = { x: 0, y: 0, zoom: 1 };
    setView('map');
    focusOnMap({ type: 'node', id: 'rtr' });
    ok('focusing it from the table lands on the node', near(centre(), 50, 0), json(centre()));
    select(null, null);

    // The Groups tab's Select members, for a collapsed group.
    state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera();
    centreOnNodes(groupMembers('rk', true));
    ok('Select members of a collapsed group centres on its node', near(centre(), 50, 0), json(centre()));

    // ---- 2: the search ----
    setGroupCollapsed('off', true);
    setQuery('name:PC1');
    ok('a collapsed group hiding a match lights up', block('off').classList.contains('q-hit') && !block('off').classList.contains('q-dim')
       && !!block('off').querySelector('.grp-node-hit'));
    ok('its tooltip says how many', /1 of them matches the search/.test(tip('off')), tip('off'));
    ok('one hiding none dims with the rest', block('rk').classList.contains('q-dim') && !block('rk').querySelector('.grp-node-hit'));
    setQuery('type:pc');
    ok('two matches in it: "2 of them match"', /2 of them match the search/.test(tip('off')), tip('off'));
    ok('the count says two devices match', /2/.test(el('queryCount').textContent), el('queryCount').textContent);
    state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera();
    zoomToQueryMatches();
    // fitToView frames a point with room for its label under it: 23 lower.
    ok('Zoom to matches frames the group\'s node', near(centre(), 60, 323), json(centre()));
    setQuery('type:server');
    zoomToQueryMatches();
    // SRV (beside the rack) and OUT: neither is folded.
    ok('matches on the map are framed as before', near(centre(), 350, 173), json(centre()));
    setQuery('');
    ok('cleared, nothing is lit or dimmed', !block('off').classList.contains('q-hit') && !block('off').classList.contains('q-dim'));
    setGroupCollapsed('off', false);

    // ---- 3: the trace runs through a collapsed group ----
    // The switch is folded into the rack; PC1 reaches SRV and OUT through it.
    select('pc1', 'node');
    setTraceMode(true);
    renderCanvasOnly();
    const reach = calculateReachability('pc1');
    ok('the trace from PC1 reaches past the switch', reach.reachableNodes.has('srv') && reach.reachableNodes.has('out') && reach.reachableNodes.has('sw'));
    ok('the rack\'s node is lit, not faded', !block('rk').classList.contains('fade-inactive') && card('rk').getAttribute('stroke') === '#fcd34d');
    ok('the folded line into it is lit', edgeOf('l3').getAttribute('stroke') === '#f59e0b' && !edgeOf('l3').classList.contains('fade-inactive'));
    ok('and the folded lines out of it', edgeOf('l2').getAttribute('stroke') === '#f59e0b' && edgeOf('l5').getAttribute('stroke') === '#f59e0b');
    ok('the devices beyond it are lit too', !el('ui-node-srv').classList.contains('fade-inactive') && !el('ui-node-out').classList.contains('fade-inactive'));
    ok('the node is not marked as the start', !block('rk').classList.contains('grp-trace-src'));
    select('sw', 'node');
    renderCanvasOnly();
    ok('traced from a folded device, its node is marked as the start', block('rk').classList.contains('grp-trace-src')
       && card('rk').getAttribute('stroke') === '#f59e0b' && card('rk').getAttribute('stroke-width') === '3');
    ok('and what it reaches is lit', !el('ui-node-pc1').classList.contains('fade-inactive'));
    setTraceMode(false);
    select(null, null);
    renderCanvasOnly();
    ok('trace off, the node is plain', !block('rk').classList.contains('grp-trace-src') && !block('rk').classList.contains('fade-inactive'));
    setGroupCollapsed('rk', false);

    // ---- 4: Tidy with groups ----
    // A bigger site: a building of two floors, each of two rooms, devices
    // spread so a cable-only layout would mix them; and devices in no group.
    const big = () => {
      const nodes = [N('net', 'cloud', { x: 900, y: -400, interfaces: [{ id: 'i1', name: 'wan', ip: '' }] }),
        N('core', 'router', { x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }),
        N('cs', 'switch', { x: 300, y: 0, group: 'mdf', portCount: 24, interfaces: [] })];
      const links = [{ id: 'k0', source: 'net', target: 'core', sourceIface: 'i1', targetIface: 'i1' },
        { id: 'k1', source: 'core', target: 'cs', targetIface: 'p24' }];
      const groups = [{ id: 'hq', name: 'HQ', kind: 'building' },
        { id: 'f1', name: 'Floor 1', kind: 'floor', parent: 'hq' }, { id: 'f2', name: 'Floor 2', kind: 'floor', parent: 'hq' },
        { id: 'mdf', name: 'MDF', kind: 'room', parent: 'f1' }];
      let port = 1;
      ['r11', 'r12', 'r21', 'r22'].forEach((r, ri) => {
        groups.push({ id: r, name: `Room ${r.slice(1)}`, kind: 'room', parent: ri < 2 ? 'f1' : 'f2' });
        const sw = `${r}sw`;
        nodes.push(N(sw, 'switch', { x: (ri * 977) % 1300, y: 700 - ri * 211, group: r, portCount: 24, interfaces: [] }));
        links.push({ id: `u${r}`, source: 'cs', target: sw, sourceIface: `p${port++}`, targetIface: 'p24' });
        for (let i = 1; i <= 7; i++) {
          const id = `${r}h${i}`;
          nodes.push(N(id, 'pc', { x: (i * 431 + ri * 97) % 1500, y: (i * 173 + ri * 311) % 900, group: r }));
          links.push({ id: `${r}l${i}`, source: sw, target: id, sourceIface: `p${i}`, targetIface: 'i1' });
        }
      });
      // Two loose devices, in no group and on no cable.
      nodes.push(N('lap1', 'laptop', { x: 50, y: 50 }), N('lap2', 'laptop', { x: 60, y: 900 }));
      return { v: DOC_VERSION, nodes, links, groups };
    };
    open(big(), 'doc-big');
    ok('with groups, Tidy is not the cables\' layout alone', json([...tidyPositionsGrouped(state.nodes, state.links)]) !== json([...tidyPositions(state.nodes, state.links)]));
    const undoBefore = _undoStack.length;
    tidyLayout();
    ok('Tidy is one undo step', _undoStack.length === undoBefore + 1);
    let view = groupMapView(new Set());
    const rectOf = (id) => view.frames.find((f) => f.group.id === id).rect;
    const parentOf = (id) => groupById(id).parent || null;
    const ids = view.frames.map((f) => f.group.id);
    const clashes = [];
    ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => {
      if (parentOf(a) === parentOf(b) && overlaps(withTab(rectOf(a)), withTab(rectOf(b)))) clashes.push(`${a}/${b}`);
    }));
    ok('no group\'s frame lands on another\'s', clashes.length === 0, clashes.join(' '));
    const strays = ids.filter((id) => parentOf(id) && !within(withTab(rectOf(id)), rectOf(parentOf(id))));
    ok('each frame sits inside the one round it', strays.length === 0, strays.join(' '));
    const loose = state.nodes.filter((n) => !n.group);
    const inFrame = loose.filter((n) => view.frames.some((f) => overlaps({ x: n.x - 30, y: n.y - 30, w: 60, h: 90 }, withTab(f.rect))));
    ok('no device in no group sits inside a frame', inFrame.length === 0, inFrame.map((n) => n.id).join(' '));
    const spread = (gid) => { const r = rectOf(gid); return r.w * r.h; };
    ok('a room is a compact block (8 devices, not the width of the map)', ['r11', 'r12', 'r21', 'r22'].every((g) => rectOf(g).w <= 12 * 150 + 2 * 58), json(['r11', 'r21'].map(spread)));
    // What the cables say goes first: the internet and the core, then the building.
    ok('the block with the internet comes first', getNode('net').y <= Math.min(...state.nodes.filter((n) => n.group).map((n) => n.y)));
    ok('the room with the core switch comes first in its floor', rectOf('mdf').x <= rectOf('r11').x);
    ok('every device on the grid', state.nodes.every((n) => n.x % GRID_SNAP === 0 && n.y % GRID_SNAP === 0));
    const tidied = json(state.nodes.map((n) => [n.id, n.x, n.y]));
    tidyLayout();
    ok('a second Tidy changes nothing', json(state.nodes.map((n) => [n.id, n.x, n.y])) === tidied);
    undo(); undo();
    ok('undone, every device is back', json(state.nodes.map((n) => [n.id, n.x, n.y])) === json(big().nodes.map((n) => [n.id, n.x, n.y])));

    // A selection spanning two rooms: each its block, where the selection was.
    const sel = state.nodes.filter((n) => n.group === 'r21' || n.group === 'r22');
    const others = json(state.nodes.filter((n) => !sel.includes(n)).map((n) => [n.id, n.x, n.y]));
    const minX0 = Math.min(...sel.map((n) => n.x)), minY0 = Math.min(...sel.map((n) => n.y));
    selectEntries(sel.map((n) => ({ type: 'node', id: n.id })));
    tidyLayout();
    ok('tidying a selection moves only it', json(state.nodes.filter((n) => !sel.includes(n)).map((n) => [n.id, n.x, n.y])) === others);
    ok('and it starts where it was', Math.abs(Math.min(...sel.map((n) => n.x)) - minX0) <= GRID_SNAP && Math.abs(Math.min(...sel.map((n) => n.y)) - minY0) <= GRID_SNAP);
    view = groupMapView(new Set());
    ok('its two rooms do not overlap', !overlaps(withTab(rectOf('r21')), withTab(rectOf('r22'))));
    undo();
    select(null, null);

    // Two rooms selected, not the racks inside them: the racks come along,
    // since the rooms' frames are drawn round them. Left where they were, a
    // rack switch stretched its room's frame back over the room beside it.
    {
      const racked = big();
      racked.groups.push({ id: 'r21r', name: 'Rack 21', kind: 'rack', parent: 'r21' }, { id: 'r22r', name: 'Rack 22', kind: 'rack', parent: 'r22' });
      racked.nodes.find((n) => n.id === 'r21sw').group = 'r21r';
      racked.nodes.find((n) => n.id === 'r22sw').group = 'r22r';
      open(racked, 'doc-racked');
      const rooms = state.nodes.filter((n) => n.group === 'r21' || n.group === 'r22');
      const rest = json(state.nodes.filter((n) => !['r21', 'r22', 'r21r', 'r22r'].includes(n.group)).map((n) => [n.id, n.x, n.y]));
      selectEntries(rooms.map((n) => ({ type: 'node', id: n.id })));
      tidyLayout();
      view = groupMapView(new Set());
      ok('two rooms tidied without their racks: the frames stay apart', !overlaps(withTab(rectOf('r21')), withTab(rectOf('r22'))),
         json([rectOf('r21'), rectOf('r22')]));
      ok('each rack inside its room', within(withTab(rectOf('r21r')), rectOf('r21')) && within(withTab(rectOf('r22r')), rectOf('r22')));
      ok('nothing outside the two rooms moved', json(state.nodes.filter((n) => !['r21', 'r22', 'r21r', 'r22r'].includes(n.group)).map((n) => [n.id, n.x, n.y])) === rest);
      undo();
      // A room only partly selected stays a selection's tidy: only what was picked moves.
      const two = state.nodes.filter((n) => n.group === 'r21').slice(0, 2);
      const unpicked = json(state.nodes.filter((n) => !two.includes(n)).map((n) => [n.id, n.x, n.y]));
      selectEntries(two.map((n) => ({ type: 'node', id: n.id })));
      tidyLayout();
      ok('two devices of a room tidied: nothing else moves', json(state.nodes.filter((n) => !two.includes(n)).map((n) => [n.id, n.x, n.y])) === unpicked);
      undo();
      select(null, null);
      open(big(), 'doc-big');
    }

    // A collapsed group's node follows its members to their new block.
    setGroupCollapsed('r12', true);
    tidyLayout();
    const members = state.nodes.filter((n) => n.group === 'r12');
    const cx = (Math.min(...members.map((n) => n.x)) + Math.max(...members.map((n) => n.x))) / 2;
    const cy = (Math.min(...members.map((n) => n.y)) + Math.max(...members.map((n) => n.y))) / 2;
    ok('a collapsed group\'s node follows its members', block('r12').getAttribute('transform') === `translate(${cx}, ${cy})`, block('r12').getAttribute('transform'));
    undo();
    setGroupCollapsed('r12', false);

    // No groups, or a reduced view: Tidy by the cables alone, as before.
    const bare = big(); bare.groups = []; bare.nodes.forEach((n) => { delete n.group; });
    open(bare, 'doc-bare');
    const plain = tidyPositions(state.nodes, state.links);
    ok('with no groups, the layout is the cables\' alone', json([...tidyPositionsGrouped(state.nodes, state.links)]) === json([...plain]));
    open(big(), 'doc-big');
    state.settings.advanced = false;
    ok('in a reduced view too, groups or not', json([...tidyPositionsGrouped(state.nodes, state.links)]) === json([...tidyPositions(state.nodes, state.links)]));
    state.settings.advanced = true;
    renderCanvasOnly();

    // ---- 5: the report's picture and the exports follow the map ----
    open();
    const realMarkup = canvasSvgMarkup;
    let captured = '';
    window.canvasSvgMarkup = function () { const d = realMarkup.apply(this, arguments); captured = d ? d.markup : ''; return d; };
    try {
      setGroupCollapsed('off', true);
      await captureCanvasImage('png');   // what the report embeds (generateSiteReport, js/report.js)
      ok('the report\'s picture shows a collapsed group as its node', /ui-group-off/.test(captured) && !/ui-node-pc1/.test(captured));
      setGroupCollapsed('off', false);
      await captureCanvasImage('png');
      ok('and expanded, its devices in their frame', !/ui-group-off/.test(captured) && /ui-node-pc1/.test(captured) && /grp-frame/.test(captured));
      setGroupCollapsed('off', true);
      setQuery('name:pc1');
      await captureCanvasImage('png');
      ok('the search\'s ring is in the picture as on the map', /grp-node-hit/.test(captured));
      setQuery('');
    } finally { window.canvasSvgMarkup = realMarkup; }
    ok('the SVG export too, and never the ▸', /ui-group-off/.test(canvasSvgMarkup(1).markup) && !/grp-toggle/.test(canvasSvgMarkup(1).markup));

    // ---- 6: a finger can hit the ▸, and Spanish ----
    const hit = toggleOf('off') && toggleOf('off').querySelector('.grp-toggle-hit');
    ok('the ▸ has a target wider than its glyph', !!hit && Number(hit.getAttribute('width')) >= 28 && Number(hit.getAttribute('height')) >= 28);
    ok('and so has the frame\'s ▾', !!el('layer-groups').querySelector('.grp-frame > .grp-toggle .grp-toggle-hit'));
    // Chromium's touch adjustment drops a tap target that holds another one:
    // with the ▸ inside the node, a tap on a zoomed-out node expanded it.
    ok('the ▸ is beside the node it folds, not inside it', !block('off').querySelector('.grp-toggle'));
    ok('and the frame\'s ▾ is not inside the tab', !el('layer-groups').querySelector('.grp-tab .grp-toggle'));
    {
      // The target grows away from the card: it takes little of what a tap should select.
      const b = state.nodes.filter((n) => n.group === 'off');
      const bx = (Math.min(...b.map((n) => n.x)) + Math.max(...b.map((n) => n.x))) / 2, by = (Math.min(...b.map((n) => n.y)) + Math.max(...b.map((n) => n.y))) / 2;
      const t = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(toggleOf('off').getAttribute('transform'));
      const h = { x: Number(t[1]) + Number(hit.getAttribute('x')), y: Number(t[2]) + Number(hit.getAttribute('y')), w: Number(hit.getAttribute('width')), h: Number(hit.getAttribute('height')) };
      const c = { x: bx - 28, y: by - 24, w: 56, h: 48 };
      const shared = Math.max(0, Math.min(h.x + h.w, c.x + c.w) - Math.max(h.x, c.x)) * Math.max(0, Math.min(h.y + h.h, c.y + c.h) - Math.max(h.y, c.y));
      ok('its target covers under a tenth of the card', shared < 0.1 * c.w * c.h, `${shared} of ${c.w * c.h}`);
    }
    // The unpainted target is not outlined on hover (a yellow square round the ▸).
    const hoverRules = [];
    [...document.styleSheets].forEach((sh) => { try { [...sh.cssRules].forEach((r) => { if (r.selectorText && /grp-toggle[^,]*:hover/.test(r.selectorText)) hoverRules.push(r.selectorText); }); } catch (e) { /* cross-origin */ } });
    ok('hovering the ▸ outlines its box, not its target', hoverRules.length > 0
       && hoverRules.every((sel) => !hit.matches(sel.replace(/:hover/g, '')))
       && hoverRules.some((sel) => !!toggleOf('off').querySelector(':scope > rect:not(.grp-toggle-hit)').matches(sel.replace(/:hover/g, ''))), hoverRules.join(' | '));
    setQuery('type:server');
    ok('the ▸ dims with its node', block('off').classList.contains('q-dim') && toggleOf('off').classList.contains('q-dim'));
    setQuery('');
    ok('and is plain again with it', !toggleOf('off').classList.contains('q-dim'));
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('a tap on it expands, no hover needed', !isGroupCollapsed('off') && !block('off'));
    setGroupCollapsed('off', true);
    setLocale('es'); applyStaticI18n();
    setQuery('type:pc');
    ok('es: the tooltip speaks Spanish', /2 de ellos coinciden con la búsqueda/.test(tip('off')), tip('off'));
    setQuery('');
    setLocale('en'); applyStaticI18n(); renderCanvasOnly();
    setGroupCollapsed('off', false);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
