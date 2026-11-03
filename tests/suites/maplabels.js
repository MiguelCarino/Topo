// What sits on and beside the cables on the map (js/ui.js, js/model.js).
// What is held here:
//   1. a note goes where its device goes: dragging a device drags the notes
//      whose red lines all point at what is dragged, in one save and one undo
//      step; a note that also points at a device staying put stays, and so
//      does one pointing only at another note;
//   2. a cable run straight through a device it does not reach bows round it
//      (linkDetour), on the side that needs less, clear of the device's card
//      and name; with nothing in the way it stays straight; a device folded
//      into a collapsed group is not in the way; two cables between the same
//      pair, drawn either way round, bow to the same side, apart;
//   3. cable labels and a subnet's name tab are drawn in the labels layer,
//      over every cable and under the devices; a label whose middle spot is
//      under a device moves along the cable off it; the export carries them;
//      a device's name and addresses have a halo a cable passes behind;
//   4. a transit network (routers and firewalls alone) draws no bubble unless
//      set to; a network in two groups is a bubble in each, its gateway alone
//      in a third none; a zone's tab keeps off a device over its corner;
//   5. a detour never swings past its reach: a cable that cannot clear its
//      way within it stays straight.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const canvas = el('networkCanvas');
  const at = (x, y) => { const r = canvas.getBoundingClientRect(); return { clientX: r.left + state.camera.x + x * state.camera.zoom, clientY: r.top + state.camera.y + y * state.camera.zoom }; };
  const mouse = (target, type, pt, extra = {}) => target.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, pt, extra)));
  // A drag of a device from where it is by (dx, dy), through the real handlers.
  const drag = (id, dx, dy) => {
    const n = getNode(id), x0 = n.x, y0 = n.y;
    mouse(el(`ui-node-${id}`), 'mousedown', at(x0, y0));
    for (let i = 1; i <= 4; i += 1) mouse(window, 'mousemove', at(x0 + (dx * i) / 4, y0 + (dy * i) / 4));
    mouse(window, 'mouseup', at(x0 + dx, y0 + dy));
  };
  const heldResponder = setDialogResponder(() => null);

  const D = (id, type, x, y) => ({ id, type, name: id.toUpperCase(), x, y, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] });
  const T = (id, x, y, targets) => ({ id, x, y, text: id, style: 'note', size: 12, targets });
  const doc = (nodes, links, annotations = []) => ({ v: DOC_VERSION, nodes, links, annotations });

  try {
    // ---- 1. Notes ride with their devices ----
    replaceDocument(doc([D('a', 'pc', 100, 100), D('b', 'pc', 400, 100), D('c', 'pc', 100, 400)], [],
      [T('t1', 140, 40, ['a']), T('t2', 260, 40, ['a', 'b']), T('t3', 300, 300, ['t1']), T('t4', 600, 600, [])]));
    state.camera = { x: 0, y: 0, zoom: 1 }; renderCanvasOnly();
    const where = (id) => { const a = getAnnotation(id); return `${a.x},${a.y}`; };
    const undoDepth = _undoStack.length;
    drag('a', 100, 60);
    ok('the device moved', getNode('a').x === 200 && getNode('a').y === 160, `${getNode('a').x},${getNode('a').y}`);
    ok('its note moved with it, by the same step', where('t1') === '240,100', where('t1'));
    ok('and is drawn there', el('ui-ann-t1').getAttribute('transform') === 'translate(240, 100)', el('ui-ann-t1').getAttribute('transform'));
    ok('a note also pointing at a device that stayed did not move', where('t2') === '260,40', where('t2'));
    ok('nor one pointing only at that note, nor a loose one', where('t3') === '300,300' && where('t4') === '600,600');
    ok('one undo step for the device and its note', _undoStack.length === undoDepth + 1, `${_undoStack.length - undoDepth}`);
    undo();
    ok('undone, both are back', getNode('a').x === 100 && getNode('a').y === 100 && where('t1') === '140,40', `${getNode('a').x} ${where('t1')}`);
    // Both of t2's devices dragged as a set: it goes too.
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    drag('a', 0, 100);
    ok('a note on two devices moves when both are dragged', where('t2') === '260,140' && where('t1') === '140,140', `${where('t2')} ${where('t1')}`);
    ok('the device left behind did not', getNode('c').y === 400);

    // ---- 2. Cables round devices ----
    replaceDocument(doc([
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8, interfaces: [] },
      D('mid', 'server', 0, 160), D('cam', 'camera', 0, 320), D('side', 'pc', 300, 0), D('far', 'pc', 300, 320)
    ], [
      { id: 'l1', source: 'sw', target: 'cam' },
      { id: 'l2', source: 'sw', target: 'side' },
      { id: 'l3', source: 'side', target: 'far' }
    ]));
    renderCanvasOnly();
    const g1 = linkGeometry(getLink('l1'));
    ok('a cable through a device it does not reach bows', Math.abs(g1.bow) > 0, `${g1.bow}`);
    // Sample the curve: no point inside the device's card and name.
    const inside = (geo, n) => { for (let i = 1; i < 40; i += 1) { const p = geo.pointAt(i / 40); if (p.x > n.x - 34 && p.x < n.x + 34 && p.y > n.y - 30 && p.y < n.y + 52) return true; } return false; };
    ok('and clears the device\'s card and name', !inside(g1, getNode('mid')));
    ok('drawn so on the map', /Q (-?\d+(\.\d+)?) /.test(el('ui-link-l1').getAttribute('d')) && el('ui-link-l1').getAttribute('d').indexOf('Q 0 160') < 0, el('ui-link-l1').getAttribute('d'));
    ok('a cable with nothing in the way stays straight', linkGeometry(getLink('l2')).bow === 0 && linkGeometry(getLink('l3')).bow === 0);
    // A second cable between the same pair, drawn the other way round.
    state.links.push({ id: 'l1b', source: 'cam', target: 'sw' });
    renderCanvasOnly();
    const ga = linkGeometry(getLink('l1')), gb = linkGeometry(getLink('l1b'));
    ok('two cables of a pair bow to the same side of the device', Math.sign(ga.ctrl.x) === Math.sign(gb.ctrl.x) && ga.ctrl.x !== 0, `${ga.ctrl.x} ${gb.ctrl.x}`);
    ok('and apart from each other', Math.abs(ga.ctrl.x - gb.ctrl.x) >= PARALLEL_BOW - 1, `${ga.ctrl.x} ${gb.ctrl.x}`);
    ok('neither through the device', !inside(ga, getNode('mid')) && !inside(gb, getNode('mid')));
    state.links = state.links.filter((l) => l.id !== 'l1b');
    // Folded into a collapsed group, the device is not on the map to cross.
    state.groups = [{ id: 'g1', name: 'Rack', kind: 'room' }];
    getNode('mid').group = 'g1'; save();
    setGroupCollapsed('g1', true); renderCanvasOnly();
    const folded = groupMapNow();
    ok('(the device is folded away)', !!folded && folded.hidden.has('mid'));
    ok('a device folded into a collapsed group is not in the way', linkGeometry(getLink('l1')).bow === 0, `${linkGeometry(getLink('l1')).bow}`);
    setGroupCollapsed('g1', false); renderCanvasOnly();

    // ---- 3. Labels over the cables ----
    const layers = [...el('workspace').children].map((g) => g.id);
    ok('the labels layer is over the cables and under the devices',
      layers.indexOf('layer-labels') === layers.indexOf('layer-links') + 1 && layers.indexOf('layer-labels') < layers.indexOf('layer-nodes'), layers.join(','));
    replaceDocument(Object.assign(doc([
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8, interfaces: [{ id: 'p1', name: 'p1', ip: '10.0.0.1/24' }] },
      Object.assign(D('a', 'pc', 400, 0), { interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.2/24' }] }),
      Object.assign(D('in', 'pc', 200, 24), { interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.3/24' }] })
    ], [{ id: 'k1', source: 'sw', target: 'a', cable: { label: 'HT-C-101' } }])));
    state.settings.subnetZones = true; renderCanvasOnly();
    const tag = el('layer-labels').querySelector('text.cable-label[data-link="k1"]');
    ok('a cable label is drawn in the labels layer', !!tag && tag.textContent === 'HT-C-101' && !el('layer-links').querySelector('.cable-label'));
    const box = tag.getBBox(), n = getNode('in');
    const under = box.x < n.x + 46 && box.x + box.width > n.x - 46 && box.y < n.y + 54 && box.y + box.height > n.y - 28;
    ok('off the device standing at its middle', !under, `${box.x},${box.y} ${box.width}x${box.height}`);
    const zt = el('layer-labels').querySelector('.zone-tag');
    ok('a subnet\'s name tab is in the labels layer too, hidden in the reduced views', !!zt && zt.hasAttribute('data-adv') && /10\.0\.0\.0\/24/.test(zt.textContent));
    ok('with its backdrop', !!zt && !!zt.querySelector('rect[rx="3"]'));
    // Blueprint inks: subnets one apart in the address take different inks.
    const slots = zoneInkSlots(['10.10.10.0/24', '10.10.20.0/24', '10.10.30.0/24', '10.10.10.0/24']);
    ok('three neighbouring subnets take three blueprint inks', slots.size === 3 && new Set(slots.values()).size === 3, JSON.stringify([...slots]));
    ok('and the same ones again on the next draw', JSON.stringify([...zoneInkSlots(['10.10.30.0/24', '10.10.20.0/24', '10.10.10.0/24'])].sort()) === JSON.stringify([...slots].sort()));
    ok('nine subnets: every ink in use before one repeats',
      new Set(zoneInkSlots(Array.from({ length: 9 }, (_, i) => `10.0.${i}.0/24`)).values()).size === ZONE_INKS.length);
    setMapInk('blue');
    const zr = el('layer-zones').querySelector('.zone-bubble > rect'), ink = zt.style.getPropertyValue('--zc');
    const blueStroke = getComputedStyle(zr).stroke;
    ok('on blueprint a zone is outlined in its ink, and its tab written in it', !!ink && blueStroke === getComputedStyle(zt.querySelector('text')).fill && blueStroke !== 'rgb(255, 255, 255)', `${ink} ${blueStroke}`);
    setMapInk('dark');
    ok('so it is on the dark map', getComputedStyle(zr).stroke === blueStroke && getComputedStyle(zt.querySelector('text')).fill === blueStroke, getComputedStyle(zr).stroke);
    setMapInk('');
    ok('the paper map keeps its own colours', getComputedStyle(zr).stroke !== blueStroke && zr.getAttribute('stroke').startsWith('hsla('), getComputedStyle(zr).stroke);
    {
      // The paper hue is the same slot's (ZONE_HUES): it used to add up the
      // address's characters, so 10.10.10.0/24 and 10.10.20.0/24 matched.
      const hueOf = (r) => r.getAttribute('stroke').match(/hsla\((\d+)/)[1];
      const hues = [...el('layer-zones').querySelectorAll('.zone-bubble > rect')].map(hueOf);
      const inks = [...el('layer-zones').querySelectorAll('.zone-bubble')].map((g) => g.style.getPropertyValue('--zc'));
      ok('on paper each subnet takes its own slot\'s hue', hues.length > 0 && new Set(hues).size === new Set(inks).size
        && hues.every((h, i) => Number(h) === ZONE_HUES[ZONE_INKS.indexOf(inks[i])]), JSON.stringify([hues, inks]));
    }
    const svg = canvasSvgMarkup();
    ok('the export carries both', !!svg && svg.markup.indexOf('HT-C-101') >= 0 && svg.markup.indexOf('10.0.0.0/24') >= 0);
    const nameEl = el('ui-node-in').querySelector('text');
    ok('a device\'s name has a halo of the ground, so a cable passes behind it', nameEl.getAttribute('paint-order') === 'stroke' && nameEl.getAttribute('stroke') === '#ffffff');

    // ---- 4. Zones: transit links, one bubble per group, tabs off devices ----
    const I = (ip) => [{ id: 'i1', name: 'eth0', ip }];
    const zoneDoc = (nets, extra = {}) => Object.assign({ v: DOC_VERSION, networks: nets, links: [], nodes: [
      Object.assign(D('rt', 'router', 0, 0), { interfaces: [{ id: 'w', name: 'wan', ip: '172.16.0.1/24' }, { id: 'l', name: 'lan', ip: '10.5.0.1/24' }] }),
      Object.assign(D('fw', 'firewall', 0, 200), { interfaces: I('172.16.0.2/24') }),
      Object.assign(D('h1', 'server', 400, 0), { interfaces: I('10.5.0.11/24'), group: 'rk' }),
      Object.assign(D('h2', 'server', 400, 200), { interfaces: I('10.5.0.12/24'), group: 'rk' }),
      Object.assign(D('jh', 'pc', 1000, 0), { interfaces: I('10.5.0.50/24'), group: 'ops' })
    ], groups: [{ id: 'rk', name: 'Rack', kind: 'room' }, { id: 'ops', name: 'Ops', kind: 'room' }, { id: 'net', name: 'Net', kind: 'room' }] }, extra);
    const cidrsOf = () => zonesToDraw().map((z) => z.net.cidr).sort();
    replaceDocument(zoneDoc([{ id: 'n1', cidr: '172.16.0.0/24' }, { id: 'n2', cidr: '10.5.0.0/24' }]));
    ok('a network of routers and firewalls alone (a transit link) draws no bubble', cidrsOf().indexOf('172.16.0.0/24') < 0, json(cidrsOf()));
    replaceDocument(zoneDoc([{ id: 'n1', cidr: '172.16.0.0/24', drawZone: true }, { id: 'n2', cidr: '10.5.0.0/24' }]));
    ok('set to draw, it does', cidrsOf().indexOf('172.16.0.0/24') >= 0, json(cidrsOf()));
    const lan = () => zonesToDraw().filter((z) => z.net.cidr === '10.5.0.0/24').map((z) => [z.box.minX, z.box.maxX]).sort((p, q) => p[0] - q[0]);
    ok('a network in two groups is one bubble in each', json(lan()) === '[[400,400],[1000,1000]]', json(lan()));
    // Its gateway alone in a third group is no bubble of its own.
    getNode('rt').group = 'net'; save(); renderCanvasOnly();
    ok('its gateway alone in another group is no bubble of its own', json(lan()) === '[[400,400],[1000,1000]]', json(lan()));
    // A zone tab keeps off a device standing over the zone's corner.
    replaceDocument({ v: DOC_VERSION, links: [], networks: [{ id: 'n2', cidr: '10.5.0.0/24' }], nodes: [
      Object.assign(D('h1', 'server', 0, 200), { interfaces: I('10.5.0.11/24') }),
      Object.assign(D('h2', 'server', 300, 200), { interfaces: I('10.5.0.12/24') }),
      Object.assign(D('top', 'server', 0, 100), { interfaces: I('192.168.9.9/32') })
    ] });
    const tb = el('layer-labels').querySelector('.zone-tag rect').getBBox(), tp = getNode('top');
    ok('a zone\'s tab keeps off a device over its corner, and its name', !(tb.x < tp.x + 46 && tb.x + tb.width > tp.x - 46 && tb.y < tp.y + 66 && tb.y + tb.height > tp.y - 28),
      `${Math.round(tb.x)},${Math.round(tb.y)} ${Math.round(tb.width)}x${Math.round(tb.height)}`);

    // ---- 5. A detour never swings wider than its reach ----
    replaceDocument(doc([D('a', 'pc', 0, 0), D('b', 'pc', 2000, 0), D('m1', 'pc', 1000, 0), D('m2', 'pc', 1000, -80), D('m3', 'pc', 1000, 80),
      D('m4', 'pc', 1000, -160), D('m5', 'pc', 1000, 160), D('m6', 'pc', 1000, -240), D('m7', 'pc', 1000, 240)], [{ id: 'far', source: 'a', target: 'b' }]));
    const gf = linkGeometry(getLink('far'));
    ok('a long cable that cannot clear a stack of devices within its reach stays straight', gf.bow === 0, `${gf.bow}`);
    replaceDocument(doc([D('a', 'pc', 0, 0), D('b', 'pc', 2000, 0), D('m1', 'pc', 1000, 0)], [{ id: 'far', source: 'a', target: 'b' }]));
    const gn = linkGeometry(getLink('far'));
    ok('one device in its way: it bows, within the reach', gn.bow !== 0 && Math.abs(gn.bow) <= DETOUR_REACH, `${gn.bow}`);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
