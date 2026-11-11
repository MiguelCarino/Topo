// The ink of a link and the small marks on the map, each drawn by one helper
// now (js/ui.js). What is held here:
//   1. linkInk, pure: the colour, dash and width of every medium, a 6 GHz
//      band's finer dash, a passthrough attachment over any medium (keeping
//      the medium's width), an unknown medium drawn as utp, and the wireless
//      colour taken from the ink handed in;
//   2. the canvas draws every link as it did: one per medium, a 6 GHz radio
//      link, a passthrough link; a selected one keeps its look at rest for
//      the export; a traced one still flows in its medium's pattern;
//   3. a collapsed group's folded lines draw as their cables do (before, a
//      folded powerline was a solid yellow line that read as selected, a
//      tunnel solid and thin, a 6 GHz radio the 2.4/5 GHz dash, a
//      passthrough grey): one cable is its canvas line at rest; a bundle of
//      one look keeps it, one medium in two looks is that medium plain, a
//      mix is a plain line; lit is amber with no flow; selected exports at
//      rest;
//   4. canvasDiscButton: its markup, its place only when given, a press that
//      starts no drag, a click that goes no further; the ✕ on a device, a
//      cable, a note and a note leader, and the note's A− / A+, each shown
//      when it was and doing what it did; none in an export;
//   5. rowDeleteButton: the ✖ on an interface, a MAC, a bond member and a
//      library card, named by its title for a screen reader.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const parse = (text) => new DOMParser().parseFromString(text, 'image/svg+xml');
  const attrs = (node, keys) => (node ? keys.map((k) => node.getAttribute(k)).join('|') : 'missing');
  const heldResponder = setDialogResponder(() => null);
  const savedTrace = state.settings.traceMode;

  const N = (id, type, x, y, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x, y, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }] }, extra);
  // A switch and an AP in one room, with one cable of each look leaving
  // it to a device of its own, so a collapsed room folds each into a line of
  // its own; and three pairs of cables to one device each, for the bundles.
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('sw', 'switch', 300, 100, { portCount: 16, interfaces: [], group: 'core' }),
      N('ap', 'ap', 500, 100, { group: 'core', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', radio: { standard: 'ax', bands: [{ band: '5' }, { band: '6' }] } }] }),
      N('u', 'pc', 0, 400), N('f', 'server', 100, 400), N('p', 'pc', 200, 400), N('v', 'server', 300, 400),
      N('pt', 'server', 400, 400), N('v2', 'server', 500, 400), N('m', 'pc', 600, 400),
      N('w5', 'laptop', 700, 400), N('w6', 'laptop', 800, 400), N('wx', 'laptop', 900, 400),
      N('srv', 'server', 1200, 100, { interfaces: [
        { id: 'e0', name: 'eth0', ip: '', mac: 'aa:bb:cc:dd:ee:01' },
        { id: 'e1', name: 'eno1', ip: '' }, { id: 'e2', name: 'eno2', ip: '' },
        { id: 'b0', name: 'bond0', ip: '', bond: { mode: 'active-backup', members: ['e1', 'e2'] } }] })
    ],
    links: [
      { id: 'lu', source: 'sw', target: 'u', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'lf', source: 'sw', target: 'f', sourceIface: 'p2', targetIface: 'i1', medium: 'fiber' },
      { id: 'lp', source: 'sw', target: 'p', sourceIface: 'p3', targetIface: 'i1', medium: 'powerline' },
      { id: 'lv', source: 'sw', target: 'v', sourceIface: 'p4', targetIface: 'i1', medium: 'vpn' },
      { id: 'lpt', source: 'sw', target: 'pt', sourceIface: 'p5', targetIface: 'i1', attachment: 'passthrough' },
      { id: 'lv2a', source: 'sw', target: 'v2', sourceIface: 'p6', targetIface: 'i1', medium: 'vpn' },
      { id: 'lv2b', source: 'sw', target: 'v2', sourceIface: 'p7', targetIface: 'i2', medium: 'vpn' },
      { id: 'lmu', source: 'sw', target: 'm', sourceIface: 'p8', targetIface: 'i1' },
      { id: 'lmp', source: 'sw', target: 'm', sourceIface: 'p9', targetIface: 'i2', medium: 'powerline' },
      { id: 'lw5', source: 'w5', target: 'ap', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { band: '5' } },
      { id: 'lw6', source: 'w6', target: 'ap', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { band: '6' } },
      { id: 'lwx5', source: 'wx', target: 'ap', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { band: '5' } },
      { id: 'lwx6', source: 'wx', target: 'ap', sourceIface: 'i2', targetIface: 'w1', medium: 'wireless', wifi: { band: '6' } }
    ],
    groups: [{ id: 'core', name: 'Core', kind: 'room' }],
    annotations: [{ id: 'note', x: 600, y: 600, text: 'Rack 2', targets: ['u', 'f'] }] });
  const open = () => {
    replaceDocument(site(), { origin: 'file', docId: 'canvas-marks' });
    state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera();
    renderCanvasOnly();
  };
  const look = (p) => attrs(p, ['stroke', 'stroke-dasharray', 'stroke-width']);
  const edgeOf = (ids) => [...el('layer-links').querySelectorAll('.grp-edge')]
    .find((p) => p.getAttribute('data-links').split(' ').sort().join(' ') === ids.slice().sort().join(' '));

  try {
    // ---- 1. linkInk, pure ----
    const wifi = wifiMapColours().line;
    const inkIs = (ink, colour, dash, width) => ink.colour === colour && ink.dash === dash && ink.width === width;
    ok('utp: grey, solid, 2', inkIs(linkInk('utp'), '#94a3b8', null, 2), json(linkInk('utp')));
    ok('fiber: cyan, solid, 2', inkIs(linkInk('fiber'), '#06b6d4', null, 2));
    ok('powerline: yellow, dash-dot, 2', inkIs(linkInk('powerline'), '#eab308', '8 4 2 4', 2));
    ok('vpn: teal, long dash, 2.5', inkIs(linkInk('vpn'), '#14b8a6', '10 6', 2.5));
    ok('wireless with no band: the wifi token, 4 4', inkIs(linkInk('wireless'), wifi, '4 4', 2) && inkIs(linkInk('wireless', { band: null }), wifi, '4 4', 2));
    ok('wireless on 5 GHz: the same', inkIs(linkInk('wireless', { band: '5' }), wifi, '4 4', 2));
    ok('wireless on 6 GHz: the finer dash', inkIs(linkInk('wireless', { band: '6' }), wifi, WIFI_6G_DASH, 2) && WIFI_6G_DASH !== '4 4');
    ok('a 6 GHz band means nothing on a cable', inkIs(linkInk('utp', { band: '6' }), '#94a3b8', null, 2));
    ok('passthrough on utp: purple, 4 4', inkIs(linkInk('utp', { passthrough: true }), '#a855f7', '4 4', 2));
    ok('passthrough on vpn keeps the tunnel\'s width', inkIs(linkInk('vpn', { passthrough: true }), '#a855f7', '4 4', 2.5));
    ok('an unknown medium is drawn as utp', inkIs(linkInk('carrier-pigeon'), '#94a3b8', null, 2) && inkIs(linkInk(undefined), '#94a3b8', null, 2));
    ok('the wireless colour is the ink handed in', inkIs(linkInk('wireless', {}, { line: '#123456', halo: '#fff' }), '#123456', '4 4', 2)
      && linkInk('fiber', {}, { line: '#123456' }).colour === '#06b6d4');
    const mine = linkInk('utp', { passthrough: true }); mine.width = 9;
    ok('each call is a fresh object (the table is never written)', LINK_INK.utp.colour === '#94a3b8' && LINK_INK.utp.dash === null && LINK_INK.utp.width === 2);

    // ---- 2. the canvas, as it was ----
    open();
    const was = {
      lu: '#94a3b8|null|2', lf: '#06b6d4|null|2', lp: '#eab308|8 4 2 4|2', lv: '#14b8a6|10 6|2.5',
      lw5: `${wifi}|4 4|2`, lw6: `${wifi}|${WIFI_6G_DASH}|2`, lpt: '#a855f7|4 4|2'
    };
    const canvasLook = {};
    Object.keys(was).forEach((id) => {
      const p = el(`ui-link-${id}`);
      canvasLook[id] = [p.getAttribute('stroke'), p.getAttribute('stroke-dasharray'), p.getAttribute('stroke-width')].map(String).join('|');
      ok(`canvas: ${id} drawn as before`, canvasLook[id] === was[id], canvasLook[id]);
    });
    select('lv', 'link');
    ok('a selected tunnel is yellow and wider, its dash kept', look(el('ui-link-lv')) === '#eab308|10 6|3', look(el('ui-link-lv')));
    ok('and keeps its look at rest for the export', el('ui-link-lv').getAttribute('data-rest') === json({ stroke: '#14b8a6', 'stroke-width': '2.5' }),
      el('ui-link-lv').getAttribute('data-rest'));
    const svgSel = parse(canvasSvgMarkup(1).markup);
    ok('the export draws it at rest', look(svgSel.getElementById('ui-link-lv')) === '#14b8a6|10 6|2.5', look(svgSel.getElementById('ui-link-lv')));
    ok('and has no ✕ in it', svgSel.querySelectorAll('.node-delete').length === 0 && document.querySelectorAll('#networkCanvas .node-delete').length === 1);
    state.settings.traceMode = true;
    select('f', 'node');
    // The cable on the map is drawn as traced (the export's look); its
    // moving twin on the trace layer flows (drawTraceFlow, js/ui.js).
    const traced = el('ui-link-lf'), flowing = el('ui-flow-lf');
    ok('a traced fiber flows in its own pattern', traced.getAttribute('stroke') === '#f59e0b' && traced.getAttribute('stroke-dasharray') === FLOW_DASH.fiber
      && traced.getAttribute('stroke-width') === '3.5' && !!flowing && flowing.classList.contains(FLOW_CLASS.fiber)
      && flowing.getAttribute('stroke-dasharray') === FLOW_DASH.fiber, look(traced) + ' ' + (flowing && flowing.getAttribute('class')));
    state.settings.traceMode = false;
    select(null);

    // ---- 3. the folded lines ----
    setGroupCollapsed('core', true); renderCanvasOnly();
    ok('the room folds: each cable its own line', !el('ui-link-lu') && !!edgeOf(['lu']) && !!edgeOf(['lv2a', 'lv2b']));
    ok('a folded powerline keeps its dash-dot (it was solid yellow, which reads as selected)', look(edgeOf(['lp'])) === '#eab308|8 4 2 4|2', look(edgeOf(['lp'])));
    ok('a folded tunnel is dashed and 2.5 wide', look(edgeOf(['lv'])) === '#14b8a6|10 6|2.5', look(edgeOf(['lv'])));
    ok('a folded 6 GHz radio keeps the finer dash', look(edgeOf(['lw6'])) === `${wifi}|${WIFI_6G_DASH}|2`, look(edgeOf(['lw6'])));
    ok('a folded passthrough is purple', look(edgeOf(['lpt'])) === '#a855f7|4 4|2', look(edgeOf(['lpt'])));
    Object.keys(was).forEach((id) => {
      const p = edgeOf([id]);
      const got = p ? [p.getAttribute('stroke'), p.getAttribute('stroke-dasharray'), p.getAttribute('stroke-width')].map(String).join('|') : 'missing';
      ok(`one folded cable is its canvas line at rest: ${id}`, got === canvasLook[id], got);
    });
    ok('two tunnels: their look, one wider', look(edgeOf(['lv2a', 'lv2b'])) === '#14b8a6|10 6|3.5', look(edgeOf(['lv2a', 'lv2b'])));
    ok('a cable and a powerline: a plain line', look(edgeOf(['lmu', 'lmp'])) === '#94a3b8||3' && !edgeOf(['lmu', 'lmp']).hasAttribute('stroke-dasharray'),
      look(edgeOf(['lmu', 'lmp'])));
    ok('a 5 and a 6 GHz radio: wireless plain, not grey', look(edgeOf(['lwx5', 'lwx6'])) === `${wifi}|4 4|3`, look(edgeOf(['lwx5', 'lwx6'])));
    state.settings.traceMode = true;
    select('f', 'node');
    const lit = edgeOf(['lf']);
    ok('a lit folded cable is amber, with no flow', lit.getAttribute('stroke') === '#f59e0b' && lit.getAttribute('stroke-width') === '3'
      && !/flow-/.test(lit.getAttribute('class')), look(lit) + ' ' + lit.getAttribute('class'));
    state.settings.traceMode = false;
    select('lv', 'link');
    ok('a selected folded tunnel is yellow on the map', look(edgeOf(['lv'])) === '#eab308|10 6|3', look(edgeOf(['lv'])));
    const svgFold = parse(canvasSvgMarkup(1).markup);
    const exp = [...svgFold.querySelectorAll('.grp-edge')].find((p) => p.getAttribute('data-links') === 'lv');
    ok('and exports at rest: teal, 2.5, dashed', look(exp) === '#14b8a6|10 6|2.5', look(exp));
    select(null);
    setGroupCollapsed('core', false); renderCanvasOnly();

    // ---- 4. canvasDiscButton and the marks ----
    const NS = 'http://www.w3.org/2000/svg';
    let clicks = 0, parentDown = 0, parentClick = 0;
    const host = document.createElementNS(NS, 'g');
    host.addEventListener('mousedown', () => parentDown++);
    host.addEventListener('click', () => parentClick++);
    const b = canvasDiscButton({ glyph: 'Q', tip: 'Quiz', onClick: (e) => { clicks++; ok('onClick gets the event', e instanceof MouseEvent); } });
    host.appendChild(b);
    const c = b.querySelector('circle'), m = b.querySelector('text');
    ok('a disc: g.node-delete in the SVG namespace, no transform without a place', b.namespaceURI === NS && b.tagName === 'g'
      && b.getAttribute('class') === 'node-delete' && !b.hasAttribute('transform'));
    ok('its circle', attrs(c, ['r', 'fill', 'stroke', 'stroke-width']) === '7.5|#dc2626|#ffffff|1.5', attrs(c, ['r', 'fill', 'stroke', 'stroke-width']));
    ok('its glyph', attrs(m, ['text-anchor', 'y', 'font-size', 'font-weight', 'fill', 'font-family']) === 'middle|3|9|900|#ffffff|sans-serif'
      && m.textContent === 'Q' && m.style.pointerEvents === 'none', attrs(m, ['text-anchor', 'y', 'font-size', 'font-weight', 'fill', 'font-family']));
    ok('its tooltip', b.querySelector('title').textContent === 'Quiz' && b.children.length === 3);
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    ok('a press does not reach what it sits on (no drag)', parentDown === 0);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('a click calls onClick once and goes no further', clicks === 1 && parentClick === 0, `${clicks} ${parentClick}`);
    const placed = canvasDiscButton({ glyph: 'A', tip: 'x', at: { x: 4, y: -5 }, fill: '#334155', fontSize: '7', y: '2.5', onClick: () => {} });
    ok('placed: its transform, then its class; the options taken', placed.getAttribute('transform') === 'translate(4, -5)'
      && placed.getAttributeNames().join(',') === 'transform,class' && placed.querySelector('circle').getAttribute('fill') === '#334155'
      && attrs(placed.querySelector('text'), ['y', 'font-size']) === '2.5|7', placed.getAttributeNames().join(','));

    // A device.
    select('u', 'node');
    const dx = el('ui-node-u').querySelector('.node-delete');
    ok('a selected device has its ✕ top-left', !!dx && dx.getAttribute('transform') === 'translate(-19, -19)' && dx.querySelector('title').textContent === 'Delete node'
      && dx.querySelector('text').textContent === '✕', dx && dx.getAttribute('transform'));
    state.linkSourceId = 'u'; renderCanvasOnly();
    ok('none in link mode', !el('ui-node-u').querySelector('.node-delete'));
    state.linkSourceId = null; renderCanvasOnly();
    el('ui-node-u').querySelector('.node-delete').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('its ✕ deletes it, and its cable', !getNode('u') && !state.links.some((l) => l.id === 'lu'));

    // A cable.
    open();
    select('lf', 'link');
    const mid = linkGeometry(state.links.find((l) => l.id === 'lf')).pointAt(0.5);
    const lx = el('layer-links').querySelector('.node-delete');
    ok('a selected cable has its ✕ at the midpoint', !!lx && lx.getAttribute('transform') === `translate(${mid.x}, ${mid.y})`
      && lx.querySelector('title').textContent === 'Delete link', lx && lx.getAttribute('transform'));
    lx.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('its ✕ deletes the cable, not its ends', !state.links.some((l) => l.id === 'lf') && !!getNode('f') && !!getNode('sw'));
    selectEntries([{ type: 'node', id: 'p' }, { type: 'node', id: 'v' }, { type: 'link', id: 'lp' }]); renderCanvasOnly();
    ok('two devices and a cable selected: no ✕ anywhere', document.querySelectorAll('#networkCanvas .node-delete').length === 0);

    // A note.
    select('note', 'annotation');
    const card = el('ui-ann-note');
    const nx = [...card.querySelectorAll('.node-delete')].find((g) => g.querySelector('text').textContent === '✕');
    ok('a selected note has its ✕ at its corner, unplaced', !!nx && !nx.hasAttribute('transform') && nx.querySelector('title').textContent === 'Delete note'
      && nx.querySelector('circle').getAttribute('fill') === '#dc2626');
    const ctl = (glyph) => [...el('ui-ann-note').querySelectorAll('.node-delete')].find((g) => g.querySelector('text').textContent === glyph);
    ok('A− and A+ are slate discs, the smaller glyph', ['A−', 'A+'].every((gl) => ctl(gl) && ctl(gl).querySelector('circle').getAttribute('fill') === '#334155'
      && attrs(ctl(gl).querySelector('text'), ['font-size', 'y']) === '7|2.5')
      && ctl('A−').getAttribute('transform') === 'translate(-18, 0)' && ctl('A+').getAttribute('transform') === 'translate(0, 0)'
      && ctl('A−').querySelector('title').textContent === 'Smaller text' && ctl('A+').querySelector('title').textContent === 'Larger text');
    ctl('A+').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('A+ raises the size by 2', getAnnotation('note').size === 14 && inSelection('annotation', 'note'), String(getAnnotation('note').size));
    getAnnotation('note').size = 35; renderCanvasOnly();
    ctl('A+').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ctl('A+').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('capped at 36', getAnnotation('note').size === 36, String(getAnnotation('note').size));
    ctl('A−').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('A− lowers it by 2', getAnnotation('note').size === 34, String(getAnnotation('note').size));
    delete getAnnotation('note')._ctlPin;

    // A note leader.
    select('nl:note:u', 'notelink');
    const geo = noteLinkGeometry(getAnnotation('note'), noteLinkTarget('u'));
    const leaders = lAnn.firstChild;
    const ly = leaders.querySelector('.node-delete');
    ok('a selected note leader has its ✕ at its midpoint', !!ly && ly.getAttribute('transform') === `translate(${(geo.sx + geo.ex) / 2}, ${(geo.sy + geo.ey) / 2})`
      && ly.querySelector('title').textContent === 'Delete note link', ly && ly.getAttribute('transform'));
    ly.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('its ✕ removes that leader only', json(getAnnotation('note').targets) === json(['f']) && !!getNode('u'), json(getAnnotation('note').targets));
    select(null);

    // ---- 5. rowDeleteButton ----
    const r = rowDeleteButton('Drop it', () => {});
    ok('a row ✖: a button, type button, if-del, its title its name', r.tagName === 'BUTTON' && r.type === 'button' && r.className === 'if-del'
      && r.textContent === '✖' && r.title === 'Drop it' && r.getAttribute('aria-label') === 'Drop it');
    select('srv', 'node');
    const rows = [...el('ifaceListContainer').querySelectorAll('button.if-del')];
    const byTitle = (tt) => rows.find((x) => x.title === tt);
    ['Delete eth0 and any cable in it', 'Unbond bond0 (members keep their cables)', 'Clear this address', 'Remove eno1 from bond0', 'Remove eno2 from bond0'].forEach((tt) => {
      const x = byTitle(tt);
      ok(`row ✖ "${tt}": named by its title`, !!x && x.type === 'button' && x.getAttribute('aria-label') === tt && x.textContent === '✖',
        rows.map((y) => y.title).join(' / '));
    });
    byTitle('Clear this address').click();
    ok('the MAC ✖ still clears the address', getNode('srv').interfaces.find((i) => i.id === 'e0').mac === '');
    [...el('ifaceListContainer').querySelectorAll('button.if-del')].find((x) => x.title === 'Remove eno1 from bond0').click();
    ok('the member ✖ still takes it out of the bond', json(getNode('srv').interfaces.find((i) => i.id === 'b0').bond.members) === json(['e2']));
    select(null);
    let picked = 0, deleted = 0, rowClick = 0;
    const item = libraryItem({ icon: '★', name: 'Branch', blurb: 'x' }, () => picked++, () => deleted++);
    item.addEventListener('click', () => rowClick++);
    const ld = item.querySelector('.lib-item-del');
    ok('a library card\'s ✖', !!ld && ld.className === 'lib-item-del shrink-0' && ld.type === 'button' && ld.textContent === '✖'
      && ld.title === 'Delete "Branch"' && ld.getAttribute('aria-label') === ld.title, ld && ld.className);
    ld.click();
    ok('a click deletes, and does not open the card', deleted === 1 && picked === 0 && rowClick === 0, `${deleted} ${picked} ${rowClick}`);
    ok('a card with nothing to delete has no ✖', !libraryItem({ icon: '★', name: 'Shipped', blurb: '' }, () => {}).querySelector('.lib-item-del'));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    state.settings.traceMode = savedTrace;
    state.linkSourceId = null;
    setDialogResponder(heldResponder);
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
