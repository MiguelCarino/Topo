// The dark map, the properties panel's height, and the rack's cables spread
// and under a selected box. What is held here:
//   1. the ◐ button darkens the map (black on Carino, a blueprint on
//      Colourful): pressed, titled for the way back, kept in this browser;
//      the drawing's white cards and grey writing take the map's colours;
//      an export carries no stylesheet, so it stays on paper;
//   2. the properties panel is half the rail whatever is selected;
//   3. a few cables take a track each, spread over their channel, wider apart
//      than the least gap; the cables out of one box run under it at levels of their own;
//      a selected box stacks over the lines, the flags over it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  // The cards ease their colours (0.1s), and this runner's clock stands still.
  const settle = () => document.getAnimations().forEach((a) => { if (a instanceof CSSTransition) a.finish(); });
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view, savedInk = state.settings.mapInk || '';
  let held = null;
  try { held = localStorage.getItem('topo.rackCables'); localStorage.removeItem('topo.rackCables'); } catch (e) { /* blocked */ }
  const N = (id, type, u, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: u ? 0 : 300, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'e1', name: 'eth0', ip: '' }, { id: 'e2', name: 'eth1', ip: '' }], group: 'rk', rackU: u, rackDepth: 'half' }, extra);
  const doc = () => ({ v: DOC_VERSION,
    nodes: [N('sw', 'switch', 40, { portCount: 8, interfaces: [] }), N('a', 'server', 30), N('b', 'server', 20), N('c', 'server', 10)],
    links: [{ id: 'la', source: 'a', target: 'sw', sourceIface: 'e1', targetIface: 'p1' },
      { id: 'lb', source: 'b', target: 'sw', sourceIface: 'e1', targetIface: 'p2' },
      { id: 'lc', source: 'c', target: 'sw', sourceIface: 'e1', targetIface: 'p3' }],
    groups: [{ id: 'rk', name: 'Rack 1', kind: 'rack', uHeight: 42 }] });
  try {
    // ---- 1. The dark map ----
    replaceDocument(doc(), { origin: 'file', docId: 'map-ink' });
    setView('map');
    setMapInk(false);
    const card = () => el('ui-node-a').querySelector('rect');
    const paper = getComputedStyle(card()).fill;
    el('mapInkBtn').click(); settle();
    ok('the button darkens the map, pressed and titled for the next step', el('canvasContainer').classList.contains('map-ink')
      && !el('canvasContainer').classList.contains('map-blue')
      && el('mapInkBtn').getAttribute('aria-pressed') === 'true' && el('mapInkBtn').title === 'Blueprint background', el('mapInkBtn').title);
    ok('kept in this browser', JSON.parse(localStorage.getItem(SETTINGS_KEY)).mapInk === 'dark');
    const bg = getComputedStyle(el('canvasContainer')).backgroundColor;
    ok('dark: black, the cards the map\'s colour, the names white', bg === 'rgb(10, 10, 10)' && getComputedStyle(card()).fill === bg && paper !== bg
      && getComputedStyle(el('ui-node-a').querySelector('text')).fill === 'rgb(250, 250, 250)', [bg, getComputedStyle(card()).fill].join(' | '));
    document.documentElement.setAttribute('data-carino-theme', 'color'); settle();
    ok('whatever the site\'s theme: still dark on Colourful', getComputedStyle(el('canvasContainer')).backgroundColor === 'rgb(10, 10, 10)');
    document.documentElement.setAttribute('data-carino-theme', 'gold');
    el('mapInkBtn').click(); settle();
    ok('the next press is the blueprint: white writing on blue, titled for light', el('canvasContainer').classList.contains('map-blue')
      && getComputedStyle(el('canvasContainer')).backgroundColor === 'rgb(27, 79, 140)'
      && getComputedStyle(card()).fill === 'rgb(27, 79, 140)'
      && getComputedStyle(el('ui-node-a').querySelector('text')).fill === 'rgb(255, 255, 255)' && el('mapInkBtn').title === 'Light background',
      getComputedStyle(el('canvasContainer')).backgroundColor);
    ok('kept too', JSON.parse(localStorage.getItem(SETTINGS_KEY)).mapInk === 'blue');
    const drawn = canvasSvgMarkup().markup;
    ok('an export stays on paper', !/map-ink|map-blue|#0a0a0a|#1b4f8c/.test(drawn) && /fill="#ffffff"/.test(drawn));
    setLocale('es'); applyLocale();
    ok('es: its title', el('mapInkBtn').title === 'Fondo claro', el('mapInkBtn').title);
    setLocale('en'); applyLocale();
    el('mapInkBtn').click(); settle();
    ok('and back to light', !el('canvasContainer').classList.contains('map-ink') && !el('canvasContainer').classList.contains('map-blue')
      && el('mapInkBtn').getAttribute('aria-pressed') === 'false' && getComputedStyle(card()).fill === paper && el('mapInkBtn').title === 'Dark background');
    setMapInk(true);
    ok('a setting saved before the blueprint (true) is the dark map', state.settings.mapInk === 'dark');
    setMapInk(false);
    // The grid thins out as the map zooms out: never closer than 12 px.
    const spacing = [1, 0.5, 0.3, 0.1, 0.05].map((z) => gridSpacing(z).minor);
    ok('the grid is 20 units at full size, and thins to 2, 5, 10 of them zoomed out', show(spacing) === show([20, 20, 12, 20, 20]), show(spacing));
    ok('so it is never closer than 12 px on screen', [0.2, 0.25, 0.33, 0.6, 0.75, 1, 2.5, 5].every((z) => gridSpacing(z).minor >= 12 - 1e-9));
    const camHeld = Object.assign({}, state.camera);
    state.camera.zoom = 0.3; applyCamera(); settle();
    ok('the light dots take the spacing', getComputedStyle(el('canvasContainer')).backgroundSize === '12px 12px', getComputedStyle(el('canvasContainer')).backgroundSize);
    setMapInk('blue'); settle();
    ok('the blueprint has a major line every fifth', getComputedStyle(el('canvasContainer')).backgroundSize === '60px 60px, 60px 60px, 12px 12px, 12px 12px',
      getComputedStyle(el('canvasContainer')).backgroundSize);
    setMapInk('dark'); settle();
    ok('the dark dots are fainter than before (12% white)', /rgba\(250, 250, 250, 0\.12\)/.test(getComputedStyle(el('canvasContainer')).backgroundImage));
    setMapInk(false);
    state.camera = camHeld; applyCamera();

    // ---- 2. The properties panel ----
    const props = document.querySelector('.rail-props');
    select(null);
    const empty = props.getBoundingClientRect().height;
    select('a');
    const full = props.getBoundingClientRect().height;
    const rail = props.parentElement.getBoundingClientRect().height;
    ok('the properties panel is half the rail, selected or not', Math.abs(empty - full) < 1 && Math.abs(empty - rail / 2) < 2, [empty, full, rail].join(' '));
    select(null);

    // ---- 3. The rack's cables ----
    setView('rack'); openRackView('rk'); setRackCables('all'); renderRackView(true);
    const items = _rv.wired.items.slice().sort((p, q) => p.x - q.x);
    const xs = items.map((it) => it.x);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    ok('three cables, three tracks', new Set(items.map((it) => it.k)).size === 3, items.map((it) => it.k).join());
    ok('spread wider than the least gap, no wider than the most', gaps.every((g) => g > RV_TRACK_PX + 1 && g <= RV_TRACK_MAX + 0.01), gaps.join());
    const swEnds = items.map((it) => it.ends.find((e) => e.at && e.node.id === 'sw'));
    const swBox = el('rackView').querySelector('.rk-slots[data-face="front"] .rk-dev[data-node="sw"]').getBoundingClientRect();
    const top = el('rackView').querySelector('.rk-wires').getBoundingClientRect().top;
    const levels = swEnds.map((e) => e.gy);
    ok('the cables out of one box run under it at levels of their own, below its edge', new Set(levels).size === 3
      && levels.every((y) => y + top > swBox.bottom + 2), levels.join());
    const byX = swEnds.slice().sort((p, q) => q.x - p.x);
    ok('the port nearest the manager runs highest', byX.every((e, j) => !j || e.gy > byX[j - 1].gy), byX.map((e) => [e.x, e.gy].join('@')).join());
    setSelectionEntries([{ type: 'node', id: 'a' }]); renderRackView(true);
    const boxEl = el('rackView').querySelector('.rk-slots[data-face="front"] .rk-dev[data-node="a"]');
    const z = (x) => Number(getComputedStyle(x).zIndex) || 0;
    const flag = el('rackView').querySelector('.rk-flag');
    ok('a selected box is over the lines, the flags over it', z(boxEl) > z(el('rackView').querySelector('.rk-wires')) && (!flag || z(flag) > z(boxEl)),
      [z(boxEl), z(el('rackView').querySelector('.rk-wires')), flag && z(flag)].join());
    setSelectionEntries([]);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    setMapInk(savedInk);
    try { if (held === null) localStorage.removeItem('topo.rackCables'); else localStorage.setItem('topo.rackCables', held); } catch (e) { /* blocked */ }
    _rv.cables = 'sel';
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
