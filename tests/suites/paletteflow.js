// Building a network by clicks on the palette, one device selected or none
// (js/app.js paletteAnchor, spawnNode's `beside`; js/ui.js holdLibraryFor):
//   1. from a blank map, Router, Switch, PC, Printer: the switch on the
//      router, both end devices on the switch (no daisy chain), the printer
//      beside the PC in its row;
//   2. an end device with one uplink: the new one shares the uplink, sits
//      beside it and joins its group, not the switch's; a place already taken
//      in the row is stepped over;
//   3. what stays on the selected device: a switch, an access point, a
//      router; a VM on its host; an end device with no cable or with two;
//      an end device whose one cable goes to another end device;
//   4. the library is not folded by the device a click just added; a press
//      on the map, another selection or the row folds it; Keep open still
//      works and is still kept;
//      "Try another mode" moves to the selection's panel while folded;
//   5. a device added outside the view is brought into it;
//   6. the shortcut list names key 2 as the tab is named, in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const open = (doc) => { replaceDocument(Object.assign({ v: DOC_VERSION, nodes: [], links: [] }, doc), { origin: 'file', docId: 'doc-paletteflow' });
    state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 1; applyCamera(); renderCanvasOnly(); };
  const add = (type) => { const n0 = state.nodes.length; document.querySelector(`#nodePalette .palette-item[data-type="${type}"]`).click(); return state.nodes[n0]; };
  const cabled = (x, y) => state.links.some((l) => (l.source === x && l.target === y) || (l.source === y && l.target === x));
  const rail = () => document.querySelector('.topo-rail');
  const folded = () => rail().classList.contains('lib-wrapped');
  const press = () => el('networkCanvas').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
  const pinKey = 'topo-lib-open';
  let pinWas = null, phoneWas;
  try {
    setLocale('en');
    try { pinWas = localStorage.getItem(pinKey); } catch (e) { /* blocked */ }
    setLibraryPinned(false);

    // ---- 1: from blank ----
    open({}); await tick();
    select(null, null);
    const r = add('router'); await tick();
    const sw = add('switch'); await tick();
    const pc = add('pc'); await tick();
    const pr = add('printer'); await tick();
    ok('four clicks: four devices, three cables', state.nodes.length === 4 && state.links.length === 3, `${state.nodes.length} ${state.links.length}`);
    ok('the switch is on the router', cabled(r.id, sw.id));
    ok('the PC is on the switch', cabled(sw.id, pc.id));
    ok('the printer is on the switch, not on the PC', cabled(sw.id, pr.id) && !cabled(pc.id, pr.id), json(state.links.map((l) => [l.source, l.target])));
    ok('…beside the PC, in its row', pr.y === pc.y && pr.x > pc.x && pr.x - pc.x <= 120, json([pc.x, pc.y, pr.x, pr.y]));
    ok('…and it is the selection', state.selectedId === pr.id && state.selection.size === 1);
    const ph = add('printer'); await tick();
    ok('a fifth is on the switch too, further along the row', cabled(sw.id, ph.id) && ph.y === pc.y && ph.x > pr.x, json([pr.x, ph.x]));

    // ---- 2: an end device with one uplink ----
    const site = () => ({
      nodes: [N('s', 'switch', { x: 400, y: 0, group: 'rack', portCount: 8, interfaces: [] }), N('p', 'pc', { x: 100, y: 200, group: 'desk' }),
        N('q', 'pc', { x: 210, y: 200 }), N('lone', 'pc', { x: 900, y: 0 }), N('two', 'pc', { x: 900, y: 300 }), N('t', 'switch', { x: 1100, y: 300, portCount: 8, interfaces: [] }),
        N('h', 'server', { x: 100, y: 500 }), N('k', 'pc', { x: 400, y: 500 }), N('m', 'pc', { x: 600, y: 500 }),
        N('ap', 'ap', { x: 700, y: 100, interfaces: [{ id: 'w1', name: 'wlan0', ip: '' }] }), N('rt', 'router', { x: 400, y: -200 })],
      links: [{ id: 'l1', source: 's', target: 'p' }, { id: 'l2', source: 's', target: 'q' }, { id: 'l3', source: 's', target: 'two' }, { id: 'l4', source: 't', target: 'two' },
        { id: 'l5', source: 'k', target: 'm' }, { id: 'l6', source: 's', target: 'h' }],
      groups: [{ id: 'rack', name: 'Rack', kind: 'room' }, { id: 'desk', name: 'Desk', kind: 'room' }] });
    open(site()); await tick();
    select('p', 'node');
    let n = add('printer'); await tick();
    ok('selected PC on a switch: the new device is on the switch', cabled('s', n.id) && !cabled('p', n.id));
    ok('…in the PC\'s group, not the switch\'s', n.group === 'desk', String(n.group));
    ok('…in the PC\'s row, past the place already taken', n.y === 200 && n.x >= 320, json([n.x, n.y]));
    ok('…and one undo takes it back', (undo(), state.nodes.length === 11 && state.links.length === 6));

    // ---- 3: what stays on the selected device ----
    const onto = (id, type) => { open(site()); select(id, 'node'); const made = add(type); return cabled(id, made.id) && state.links.length === 7; };
    ok('a switch selected: onto the switch', onto('s', 'pc'));
    ok('an access point selected: onto it', onto('ap', 'pc'));
    ok('a router selected: onto it', onto('rt', 'switch'));
    ok('a VM onto a server that has one uplink: onto the server', onto('h', 'vm'));
    ok('an end device with no cable: onto it', onto('lone', 'pc'));
    ok('an end device with two cables: onto it', onto('two', 'pc'));
    ok('an end device cabled to another end device: onto it', onto('k', 'pc'));
    ok('paletteAnchor with nothing selected cables nothing', json(paletteAnchor(null, 'pc')) === '{"connectTo":null}');

    // ---- 4: the library's fold ----
    // The suites run 800px wide, where js/mobile.js takes the palette's click
    // (its drawer holds the library, tests/suites/touchdrawer.js). Set aside
    // here: this is the path above 900px.
    phoneWas = window.phonePaletteDevice; window.phonePaletteDevice = null;
    open(site()); await tick();
    select('p', 'node'); await tick();
    ok('a selection folds the library', folded());
    select(null, null); await tick();
    n = add('pc'); await tick();
    ok('a device added by a click is selected and the library stays open', state.selectedId === n.id && !folded() && !el('libWrapRow').classList.contains('hidden'));
    const n2 = add('pc'); await tick();
    ok('…and for the next click', state.selectedId === n2.id && !folded());
    press(); await tick();
    ok('a press on the map folds it', folded() && state.selectedId === n2.id);
    add('pc'); await tick();
    select('s', 'node'); await tick();
    ok('another selection folds it', folded());
    add('pc'); await tick();
    el('libWrapRow').click(); await tick();
    ok('a click on the row folds it, and keeps nothing', folded() && !libraryPinned());
    el('libWrapRow').click(); await tick();
    ok('the next click on the row is Keep open, as before', !folded() && libraryPinned() && localStorage.getItem(pinKey) === '1');
    el('libWrapRow').click(); await tick();
    ok('…and the one after folds', folded() && !libraryPinned());
    select(null, null); await tick();
    ok('nothing selected: open, no row', !folded() && el('libWrapRow').classList.contains('hidden'));

    // The reduced views' way to another mode is not folded away with the palette.
    const mode = el('modeSwitchBtn');
    ok('unfolded, "Try another mode" is under the palette', mode.parentNode === el('tabPanel-nodes') && mode === el('tabPanel-nodes').lastElementChild);
    select('s', 'node'); await tick();
    ok('folded, it is at the foot of the selection\'s panel', folded() && mode.parentNode === rail().querySelector('.rail-props'));
    select(null, null); await tick();
    ok('…and back under the palette after', mode.parentNode === el('tabPanel-nodes') && mode === el('tabPanel-nodes').lastElementChild);

    // ---- 5: the map follows ----
    open({ nodes: [N('s', 'switch', { x: 300, y: 300, portCount: 8, interfaces: [] })], links: [] }); await tick();
    const box = el('networkCanvas').getBoundingClientRect();
    state.camera.y = box.height - 340; applyCamera();   // the switch near the bottom edge
    const camY = state.camera.y;
    select('s', 'node');
    n = add('pc'); await tick();
    const sy = n.y * state.camera.zoom + state.camera.y;
    ok('a device added below the view is brought into it', state.camera.y < camY && sy > 0 && sy + 44 <= box.height, json([camY, state.camera.y, sy, box.height]));
    const camNow = json(state.camera);
    state.camera.y = 80 - getNode('s').y; applyCamera(); select('s', 'node');
    const cam0 = json(state.camera);
    n = add('pc'); await tick();
    ok('one that lands in view moves nothing', json(state.camera) === cam0 && camNow !== cam0, json(state.camera));

    // ---- 6: the shortcut's name ----
    const sc = SHORTCUTS.find((s) => s.keys.join() === '2');
    ok('key 2 is named as its tab is', sc.label === 'Templates tab' && /^Templates/.test(document.querySelector('[data-tab="templates"]').textContent.trim()), sc.label);
    const { has, locales } = window.CarinoI18N;
    locales.forEach((loc) => ok(`${loc} carries the string`, has(loc, 'Templates tab')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    if (phoneWas !== undefined) window.phonePaletteDevice = phoneWas;
    try { if (pinWas === null) localStorage.removeItem(pinKey); else localStorage.setItem(pinKey, pinWas); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
