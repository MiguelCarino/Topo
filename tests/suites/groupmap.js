// Groups on the map, step B part 1 (Review-Packs/Topo-groups.md): frames and
// collapse (js/groupmap.js). What is held here:
//   1. the view, pure: frames round their members and nested in each other,
//      a collapsed group folding its devices to one node at their centre,
//      cables across its edge folded to one line per outside end, cables
//      inside it gone, a group in a collapsed group taking the outermost
//      one, and two collapsed groups sharing one line;
//   2. the drawing: a frame per group with members, on its own layer under
//      the cables, with its tab; a collapsed node with its icon, name and
//      count; "×N" on a folded line of several cables;
//   3. collapsed is a view: not in the document, the undo timeline, the live
//      history entry or a file; kept per document in this browser, a
//      document with no id keeps nothing for the next one;
//   4. the findings: the collapsed node carries the worst and how many, and
//      the checks still run on every device;
//   5. expanding: by the ▸, by a click on the node (round 2: a click
//      expands, it no longer selects), from the Groups tab; every device is
//      back exactly where it was;
//   6. a click leaves the selection alone; Shift-pressing a collapsed node
//      selects its devices; dragging it moves them in one undo step and the
//      node follows; Delete on them asks first;
//   7. the exports carry the frames and the collapsed node, not the ▾;
//      the reduced views and a read-only document; another language.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const answers = [];
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return answers.length ? answers.shift()(req) : (req.kind === 'confirm' ? false : null); });
  const json = (v) => JSON.stringify(v);

  // A building with a server room (a rack in it, and a server beside the
  // rack) and an office, and one device outside every group.
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('rtr', 'router', { x: 0, y: 0, group: 'rk', rackU: 40, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }] }),
      N('sw', 'switch', { x: 100, y: 0, group: 'rk', rackU: 12, portCount: 8, interfaces: [] }),
      N('srv', 'server', { x: 200, y: 0, group: 'room', interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }] }),
      N('pc1', 'pc', { x: 0, y: 300, group: 'off', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] }),
      N('pc2', 'pc', { x: 120, y: 300, group: 'off', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] }),
      N('out', 'server', { x: 500, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }, { id: 'i3', name: 'eth2', ip: '' }] })
    ],
    links: [
      { id: 'l1', source: 'rtr', target: 'sw', sourceIface: 'i1', targetIface: 'p1' },
      { id: 'l2', source: 'sw', target: 'srv', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'l3', source: 'sw', target: 'pc1', sourceIface: 'p3', targetIface: 'i1' },
      { id: 'l4', source: 'sw', target: 'pc2', sourceIface: 'p4', targetIface: 'i1' },
      { id: 'l5', source: 'sw', target: 'out', sourceIface: 'p5', targetIface: 'i1' },
      { id: 'l6', source: 'rtr', target: 'out', sourceIface: 'i2', targetIface: 'i2' },
      { id: 'l7', source: 'srv', target: 'out', sourceIface: 'i2', targetIface: 'i3' }
    ],
    groups: [
      { id: 'bA', name: 'Building A', kind: 'building' },
      { id: 'room', name: 'Server room', kind: 'room', parent: 'bA' },
      { id: 'rk', name: 'Rack 3', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'off', name: 'Office', kind: 'room', parent: 'bA' },
      { id: 'empty', name: 'Storage', kind: 'room', parent: 'bA' }
    ] });
  const open = (docId) => replaceDocument(site(), { origin: 'file', docId });
  const frame = (id) => el('layer-groups').querySelector(`.grp-frame[data-grp="${id}"]`);
  const frameRect = (id) => { const r = frame(id).querySelector(':scope > rect'); return ['x', 'y', 'width', 'height'].map((k) => Number(r.getAttribute(k))); };
  const inside = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[0] + a[2] <= b[0] + b[2] && a[1] + a[3] <= b[1] + b[3];
  const block = (id) => el(`ui-group-${id}`);
  // A collapsed node's ▸ is drawn beside it, not in it (gmToggle, js/groupmap.js).
  const toggleOf = (id) => document.querySelector(`#layer-nodes > .grp-toggle[data-grp="${id}"]`);
  const nodeEl = (id) => el(`ui-node-${id}`);
  const edges = () => [...el('layer-links').querySelectorAll('.grp-edge')].map((p) => p.getAttribute('data-links')).sort();
  const at = (x, y) => {
    const rect = el('networkCanvas').getBoundingClientRect();
    return { clientX: rect.left + state.camera.x + x * state.camera.zoom, clientY: rect.top + state.camera.y + y * state.camera.zoom, bubbles: true };
  };

  try {
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }

    // ---- 1: the view, pure ----
    open('doc-A');
    let v = groupMapView(new Set());
    ok('with nothing collapsed, nothing is hidden and no cable is folded', v.hidden.size === 0 && v.covered.size === 0 && v.edges.length === 0 && v.folds.length === 0);
    ok('a frame for each group with devices in it, at any depth (the empty one has none)',
       json(v.frames.map((f) => f.group.id).sort()) === json(['bA', 'off', 'rk', 'room']), json(v.frames.map((f) => f.group.id)));
    ok('outermost first, so an inner frame is drawn over the one round it', v.frames[0].group.id === 'bA' && v.frames.findIndex((f) => f.group.id === 'room') < v.frames.findIndex((f) => f.group.id === 'rk'));
    const R = (id) => { const r = v.frames.find((f) => f.group.id === id).rect; return [r.x, r.y, r.w, r.h]; };
    ok('a frame holds its devices with room for their names', R('rk')[0] < 0 && R('rk')[0] + R('rk')[2] > 100 && R('rk')[1] < -30 && R('rk')[1] + R('rk')[3] > 60, json(R('rk')));
    ok('frames nest: the rack in the room, the room and the office in the building',
       inside(R('rk'), R('room')) && inside(R('room'), R('bA')) && inside(R('off'), R('bA')) && R('rk')[1] > R('room')[1] && R('room')[1] > R('bA')[1]);

    v = groupMapView(new Set(['rk']));
    ok('collapsed: its devices are hidden, in it', v.hidden.get('rtr') === 'rk' && v.hidden.get('sw') === 'rk' && v.hidden.size === 2);
    ok('one node at the centre of where they are', v.folds.length === 1 && v.folds[0].x === 50 && v.folds[0].y === 0, json(v.folds.map((b) => [b.x, b.y])));
    ok('its own frame is gone, the frames round it stay', !v.frames.some((f) => f.group.id === 'rk') && v.frames.some((f) => f.group.id === 'room'));
    ok('every cable with an end inside is drawn folded or not at all', json([...v.covered].sort()) === json(['l1', 'l2', 'l3', 'l4', 'l5', 'l6']));
    const ends = (e) => [e.a, e.b].map((x) => (x.fold ? `[${x.fold}]` : x.node)).sort().join('-');
    ok('one line per outside end; the two to OUT are one', json(v.edges.map((e) => `${ends(e)}:${e.links.length}`).sort())
       === json(['[rk]-out:2', '[rk]-pc1:1', '[rk]-pc2:1', '[rk]-srv:1']), json(v.edges.map((e) => `${ends(e)}:${e.links.length}`)));
    ok('the cable inside it is in no line', !v.edges.some((e) => e.links.some((l) => l.id === 'l1')));

    v = groupMapView(new Set(['rk', 'off']));
    ok('two collapsed groups cabled together share one line', v.edges.some((e) => ends(e) === '[off]-[rk]' && e.links.length === 2));
    v = groupMapView(new Set(['rk', 'bA']));
    ok('a collapsed group inside a collapsed group takes the outermost', v.folds.length === 1 && v.folds[0].group.id === 'bA'
       && ['rtr', 'sw', 'srv', 'pc1', 'pc2'].every((id) => v.hidden.get(id) === 'bA') && !v.hidden.has('out'));
    ok('and no frame is drawn inside it', v.frames.length === 0);
    ok('its three cables to OUT are one line, the rest are inside it', v.edges.length === 1 && v.edges[0].links.length === 3 && v.covered.size === 7);
    ok('and it sits at the centre of all five', v.folds[0].x === 100 && v.folds[0].y === 150);

    // ---- 2: the drawing ----
    open('doc-A');
    ok('the frames have a layer of their own, after the zones and before the cables',
       el('layer-groups').previousElementSibling === el('layer-zones') && el('layer-groups').nextElementSibling === el('layer-links'));
    ok('a frame per group with devices in it', ['bA', 'room', 'rk', 'off'].every((id) => !!frame(id)) && !frame('empty'));
    ok('drawn nested on the map too', inside(frameRect('rk'), frameRect('room')) && inside(frameRect('room'), frameRect('bA')));
    ok('a dotted outline with no fill: not a zone', frame('rk').querySelector(':scope > rect').getAttribute('fill') === 'none'
       && !!frame('rk').querySelector(':scope > rect').getAttribute('stroke-dasharray'));
    ok('the tab names it and counts its devices', /Rack 3 · 2/.test(frame('rk').querySelector('.grp-tab text').textContent)
       && /Building A · 5/.test(frame('bA').querySelector('.grp-tab text').textContent));
    ok('with the kind\'s icon and the control', !!frame('rk').querySelector('.grp-tab svg') && !!frame('rk').querySelector('.grp-toggle'));
    ok('every device and cable still drawn', state.nodes.every((n) => !!nodeEl(n.id)) && state.links.every((l) => !!el(`ui-link-${l.id}`)));

    // ---- 3: collapsing, from the ▾ ----
    const docBefore = json(serializeDoc());
    const undoBefore = _undoStack.length;
    const liveBefore = liveDocJson();
    const posBefore = json(state.nodes.map((n) => [n.id, n.x, n.y]));
    frame('rk').querySelector('.grp-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('the ▾ collapses it', isGroupCollapsed('rk') && !!block('rk'));
    ok('its devices are not drawn', !nodeEl('rtr') && !nodeEl('sw') && !!nodeEl('srv'));
    ok('nor the cable inside it, nor those folded', ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'].every((id) => !el(`ui-link-${id}`)) && !!el('ui-link-l7'));
    ok('one folded line per outside end', json(edges()) === json(['l2', 'l3', 'l4', 'l5 l6']), json(edges()));
    const counts = [...el('layer-links').querySelectorAll('.grp-edge-count')].map((x) => x.textContent);
    ok('"×2" on the line of two, nothing on a line of one', json(counts) === json(['×2']), json(counts));
    ok('the collapsed node: at the centre, with its icon, its name and its count',
       block('rk').getAttribute('transform') === 'translate(50, 0)' && !!block('rk').querySelector('svg')
       && /Rack 3/.test(block('rk').textContent) && block('rk').querySelector('.grp-node-count').textContent === '2 devices', block('rk').getAttribute('transform'));
    ok('it is a view: the document is the same', json(serializeDoc()) === docBefore);
    ok('no undo step', _undoStack.length === undoBefore);
    ok('the live history entry is the same', liveDocJson() === liveBefore);
    ok('no device moved', json(state.nodes.map((n) => [n.id, n.x, n.y])) === posBefore);
    ok('a file carries no trace of it', !/collapsed/i.test(json(identifiedDoc(serializeDoc()))));
    let stored = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
    ok('kept in this browser under the document\'s id', stored['doc-A'] && json(stored['doc-A'].ids) === json(['rk']), json(stored));
    ok('the Groups tab offers to expand it', (showConfigTab('groups'), renderGroupsPanel(true),
       el('groupList').querySelector('[data-act="collapse"][data-grp="rk"]').textContent === 'Expand on map'));
    ok('and to collapse the others', el('groupList').querySelector('[data-act="collapse"][data-grp="off"]').textContent === 'Collapse on map'
       && !el('groupList').querySelector('[data-act="collapse"][data-grp="empty"]'));

    // Per document.
    replaceDocument(site(), { origin: 'file', docId: 'doc-B' });
    ok('another document has its own (none)', !isGroupCollapsed('rk') && !!nodeEl('rtr'));
    open('doc-A');
    ok('back to the first, it is collapsed again', isGroupCollapsed('rk') && !nodeEl('rtr') && !!block('rk'));
    replaceDocument(site(), { origin: 'template' });
    ok('a template has no id and nothing collapsed', state.docId === null && !isGroupCollapsed('rk'));
    setGroupCollapsed('off', true);
    ok('collapsed without an id: kept in memory', isGroupCollapsed('off'));
    replaceDocument(site(), { origin: 'template' });
    ok('and not handed to the next document without one', !isGroupCollapsed('off'));
    setGroupCollapsed('off', true);
    state.docId = 'doc-C';   // as Keep this network or a first export gives it one
    ok('given an id where it stands, it keeps what it had collapsed', isGroupCollapsed('off')
       && json((JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}')['doc-C'] || {}).ids) === json(['off']));

    // ---- 4: the findings ----
    open('doc-A');
    const findingsBefore = json(topologyFindings().map((f) => [f.key, f.nodeIds]));
    const office = topologyFindings().filter((f) => !f.accepted && f.nodeIds.some((id) => id === 'pc1' || id === 'pc2'));
    const issues = office.length;
    ok('the office holds a duplicate address', office.some((f) => f.key === 'ip-conflict' && f.level === 'bad'), json(office.map((f) => [f.key, f.level])));
    setGroupCollapsed('off', true);
    const badge = block('off').querySelector('.grp-node-badge');
    ok('its collapsed node carries the worst finding', !!badge && badge.getAttribute('data-severity') === 'bad');
    ok('and how many', badge.textContent === String(issues), `${badge.textContent} vs ${issues}`);
    ok('its outline says so too', block('off').querySelectorAll(':scope > rect')[1].getAttribute('stroke') === '#dc2626');
    ok('the checks still run on every device', json(topologyFindings().map((f) => [f.key, f.nodeIds])) === findingsBefore);
    setGroupCollapsed('rk', true);
    ok('a group with nothing wrong has no badge', !block('rk').querySelector('.grp-node-badge'));
    ok('and its tooltip says a click expands it and Shift-click selects', /Click to expand\. Shift-click selects its devices\./.test(block('rk').querySelector(':scope > title').textContent));

    // ---- 5: expanding ----
    toggleOf('off').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('the ▸ expands it', !isGroupCollapsed('off') && !block('off') && !!nodeEl('pc1'));
    select('out', 'node');
    const undoTap = _undoStack.length;
    block('rk').dispatchEvent(new MouseEvent('mousedown', at(50, 0)));
    ok('pressing it does not expand it yet (the release decides)', isGroupCollapsed('rk') && !!block('rk'));
    window.dispatchEvent(new MouseEvent('mouseup', at(50, 0)));
    ok('so does a click on it (round 2: a click expands)', !isGroupCollapsed('rk') && !!nodeEl('rtr') && !block('rk'));
    ok('the click selected nothing: the selection is as it was', json(selectedOf('node')) === json(['out']));
    ok('and it is no edit', _undoStack.length === undoTap);
    ok('every device is back where it was', json(state.nodes.map((n) => [n.id, n.x, n.y])) === posBefore);
    ok('the cables are themselves again', state.links.every((l) => !!el(`ui-link-${l.id}`)) && edges().length === 0);
    stored = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
    ok('a document with nothing collapsed is forgotten', !stored['doc-A'], json(stored));
    showConfigTab('groups'); renderGroupsPanel(true);
    el('groupList').querySelector('[data-act="collapse"][data-grp="rk"]').click();
    ok('the Groups tab collapses it', isGroupCollapsed('rk') && !!block('rk'));

    // ---- 6: select, drag, delete ----
    select(null, null);
    block('rk').dispatchEvent(new MouseEvent('mousedown', Object.assign(at(50, 0), { shiftKey: true })));
    window.dispatchEvent(new MouseEvent('mouseup', at(50, 0)));
    ok('Shift-pressing it selects its devices', json(selectedOf('node').sort()) === json(['rtr', 'sw']));
    ok('and leaves it collapsed', isGroupCollapsed('rk') && !!block('rk'));
    ok('and it shows as selected', block('rk').querySelectorAll(':scope > rect')[1].getAttribute('stroke') === '#eab308');
    select(null, null);
    const undoDrag = _undoStack.length;
    block('rk').dispatchEvent(new MouseEvent('mousedown', at(50, 0)));
    window.dispatchEvent(new MouseEvent('mousemove', at(90, 40)));
    ok('dragging it moves them all by the same step', getNode('rtr').x === 40 && getNode('rtr').y === 40 && getNode('sw').x === 140 && getNode('sw').y === 40,
       json([getNode('rtr').x, getNode('rtr').y, getNode('sw').x]));
    ok('the node follows while dragging', block('rk').getAttribute('transform') === 'translate(90, 40)', block('rk').getAttribute('transform'));
    ok('and so do the folded cables', el('layer-links').querySelector('.grp-edge[data-links="l2"]').getAttribute('d').startsWith('M 90 40 '));
    window.dispatchEvent(new MouseEvent('mouseup', at(90, 40)));
    ok('one undo step', _undoStack.length === undoDrag + 1);
    ok('a drag is not a click: it stays collapsed', isGroupCollapsed('rk') && !!block('rk'));
    ok('and a plain drag selects nothing', selectedOf('node').length === 0);
    undo();
    ok('undone, both are back', getNode('rtr').x === 0 && getNode('sw').x === 100 && getNode('rtr').y === 0);
    ok('and it is still collapsed (undo does not touch the view)', isGroupCollapsed('rk') && !!block('rk'));
    block('rk').dispatchEvent(new MouseEvent('mousedown', Object.assign(at(50, 0), { shiftKey: true })));
    window.dispatchEvent(new MouseEvent('mouseup', at(50, 0)));
    block('rk').dispatchEvent(new MouseEvent('mousedown', Object.assign(at(50, 0), { shiftKey: true })));
    ok('shift-pressing it again takes them out', selectedOf('node').length === 0);
    block('rk').dispatchEvent(new MouseEvent('mousedown', Object.assign(at(50, 0), { shiftKey: true })));
    window.dispatchEvent(new MouseEvent('mouseup'));
    ok('and puts them back', json(selectedOf('node').sort()) === json(['rtr', 'sw']) && isGroupCollapsed('rk'));

    asked.length = 0;
    answers.push(() => false);
    deleteSelected();
    await tick();
    ok('Delete on devices hidden in a collapsed group asks first', asked.length === 1 && /inside a collapsed group/.test(asked[0].message || ''), json(asked.map((a) => a.message)));
    ok('No keeps them', !!getNode('rtr') && !!getNode('sw'));
    answers.push(() => true);
    deleteSelected();
    await tick(); await tick();
    ok('Yes deletes them, with their cables', !getNode('rtr') && !getNode('sw') && !state.links.some((l) => l.source === 'sw' || l.target === 'sw'));
    ok('in one undo step', (undo(), !!getNode('rtr') && !!getNode('sw')));
    asked.length = 0;
    select('out', 'node');
    answers.push(() => true);
    deleteSelected();
    ok('a device on the map is deleted without asking', asked.length === 0 && !getNode('out'));
    undo();

    // The frame's tab: press selects, drag moves.
    open('doc-A');
    setGroupCollapsed('rk', false);
    select(null, null);
    frame('off').querySelector('.grp-tab').dispatchEvent(new MouseEvent('mousedown', at(0, 220)));
    ok('pressing a frame\'s tab selects its devices', json(selectedOf('node').sort()) === json(['pc1', 'pc2']));
    window.dispatchEvent(new MouseEvent('mousemove', at(40, 220)));
    window.dispatchEvent(new MouseEvent('mouseup'));
    ok('and dragging it moves them', getNode('pc1').x === 40 && getNode('pc2').x === 160);
    undo();
    select(null, null);

    // ---- 7: exports, profiles, read-only, language ----
    setGroupCollapsed('off', true);
    const svg = canvasSvgMarkup(1).markup;
    ok('the image carries the frames and the collapsed node', /grp-frame/.test(svg) && /ui-group-off/.test(svg) && /Office/.test(svg));
    ok('not the ▾, which is a control', !/grp-toggle/.test(svg));
    ok('nor the devices folded into it', !/ui-node-pc1/.test(svg));
    const drawn = canvasSvgMarkup(1);
    const fb = groupFrameBounds();
    ok('the crop takes in the outermost frame and its tab', drawn.minY < fb.minY && drawn.minX < fb.minX
       && drawn.minY + drawn.height > fb.maxY, json([drawn.minY, fb.minY]));
    fitToView();
    const vr = el('networkCanvas').getBoundingClientRect();
    const topOnScreen = state.camera.y + fb.minY * state.camera.zoom;
    ok('fitting the map to the view takes in the frames too', topOnScreen >= 0 && state.camera.y + fb.maxY * state.camera.zoom <= vr.height, String(topOnScreen));

    // A zone is drawn round what is on the map: a collapsed group's node,
    // not the empty patch its folded devices sit on.
    const zoned = { v: DOC_VERSION,
      nodes: [N('a', 'pc', { x: 0, y: 0, group: 'z', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.5/24' }] }),
              N('b', 'pc', { x: 400, y: 0, group: 'z', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.6/24' }] }),
              N('c', 'pc', { x: 1000, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.7/24' }] })],
      links: [], networks: [{ id: 'n9', cidr: '10.9.0.0/24', drawZone: true }], groups: [{ id: 'z', name: 'Lab', kind: 'room' }] };
    replaceDocument(zoned, { origin: 'file', docId: 'doc-Z' });
    const zoneBox = () => zonesToDraw()[0].box;
    ok('expanded, the zone spans the devices', zoneBox().minX === 0 && zoneBox().maxX === 1000);
    setGroupCollapsed('z', true);
    ok('collapsed, it spans the group\'s node instead', zoneBox().minX === 200 && zoneBox().maxX === 1000, json(zoneBox()));
    setGroupCollapsed('z', false);
    open('doc-A');

    state.settings.advanced = false;
    renderCanvasOnly();
    ok('the reduced views draw no frames and fold nothing', !el('layer-groups').children.length && !!nodeEl('pc1') && !block('off'));
    ok('and Delete there never asks', selectedHiddenCount() === 0);
    state.settings.advanced = true;
    renderCanvasOnly();
    ok('back in the full editor, it is collapsed as it was', !!block('off') && !nodeEl('pc1'));

    replaceDocument(Object.assign(site(), { v: DOC_VERSION + 1 }), { origin: 'file', docId: 'doc-RO' });
    ok('a read-only document opens', !!state.readOnly);
    setGroupCollapsed('rk', true);
    ok('and can still be folded: a view, not an edit', isGroupCollapsed('rk') && !!block('rk'));

    open('doc-A');
    setLocale('es'); applyStaticI18n(); renderCanvasOnly();
    ok('es: the node\'s count and the ▸ speak Spanish', block('off').querySelector('.grp-node-count').textContent === '2 dispositivos'
       && toggleOf('off').querySelector('title').textContent === 'Expandir');
    ok('es: and the frame\'s ▾', frame('bA').querySelector('.grp-toggle title').textContent === 'Contraer');
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
