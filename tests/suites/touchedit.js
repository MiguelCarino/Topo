// @realtime @touch
// Editing on the map by touch (Mobile batch 2; js/mobile.js the selection
// bar and connect banner, js/ui.js pressAnnotation, js/app.js the canvas
// dblclick, css/app.css the coarse-pointer discs). On a 390x844 touch screen
// through window.__touch (real touch input, run-cross.mjs):
//   1. a tap on a device shows #selBar with its name and leaves the drawer
//      closed; Edit opens the drawer with the Name field inside the rail's
//      visible box, without the focus (no keyboard);
//   2. Connect, then a tap on another device: one more cable, the banner
//      gone, and one handy-bar Undo takes the cable back;
//   3. Connect then Cancel, and Connect then a tap on the same device, both
//      disarm with no cable;
//   4. a contextmenu on a device (Android's long-press) shows the banner;
//   5. a note's Edit text opens #annEditor; a double-tap on a note opens it
//      and leaves the zoom alone; a double-tap on empty map still zooms 2x;
//   6. Link from a note and a tap on a device adds the note's leader;
//   7. no .node-delete disc is drawn on the touch phone;
//   8. no horizontal scroll.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(30); };
  const touch = (type, pts) => window.__touch(type, pts);
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); await settle(); await wait(350); };
  const mid = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const tapEl = async (node) => { const p = mid(node); await tap(p.x, p.y); };
  const cardAt = (id) => mid(el('ui-node-' + id).querySelector('rect'));
  const tapNode = async (id) => { const p = cardAt(id); await tap(p.x, p.y); };
  const shown = (node) => !!node && !node.hidden && getComputedStyle(node).display !== 'none';
  const drawerOpen = () => document.querySelector('.ws').classList.contains('drawer-open');
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  const D = (id, x, y, ip) => ({ id, type: 'pc', name: 'PC ' + id.toUpperCase(), x, y, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const doc = { v: DOC_VERSION, nodes: [D('a', 0, 0, '10.0.0.11/24'), D('b', 220, 0, '10.0.0.12/24'), D('c', 0, 260, '10.0.0.13/24')],
    links: [], annotations: [{ id: 'n1', x: 160, y: 240, text: 'Check this', style: 'note', size: 12, targets: [] }] };

  try {
    ok('this page is on a touch screen', navigator.maxTouchPoints > 0 && typeof window.__touch === 'function');
    replaceDocument(doc, { origin: 'file', docId: 'touch-edit' });
    setView('map');
    state.camera.x = 60; state.camera.y = 200; state.camera.zoom = 1; applyCamera();
    renderCanvasOnly();
    await settle();
    select(null, null);
    await settle();
    ok('no bar with nothing selected', !shown(el('selBar')) && !shown(el('linkBanner')));

    // ---- 1. A tap, then Edit ----
    await tapNode('a');
    ok('a tap selects the device', state.selectedId === 'a', state.selectedId);
    ok('the selection bar shows', shown(el('selBar')));
    ok('with its name', el('selBar').querySelector('.sel-bar-name').textContent === 'PC A', el('selBar').textContent);
    ok('and the drawer stays closed', !drawerOpen());
    const btns = [...el('selBar').querySelectorAll('button')];
    ok('a device: Edit, Connect, Select more, Delete', json(btns.map((b) => b.dataset.act)) === json(['edit', 'connect', 'more', 'remove']));
    ok('every button is at least 44px', btns.every((b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }), json(btns.map((b) => Math.round(b.getBoundingClientRect().width))));
    const sb = el('selBar').getBoundingClientRect(), hb = el('handyBar').getBoundingClientRect();
    ok('above the handy bar, inside the screen', sb.bottom <= hb.top && sb.left >= 0 && sb.right <= innerWidth, json([sb.top, sb.bottom, hb.top]));
    const db = el('docBar');
    if (db && shown(db)) ok('the document bar sits above it', db.getBoundingClientRect().bottom <= sb.top + 1, json([db.getBoundingClientRect().bottom, sb.top]));
    await tapEl(el('selBar').querySelector('[data-act="edit"]'));
    await wait(400);   // the drawer's slide
    ok('Edit opens the drawer', drawerOpen());
    const rail = document.querySelector('.topo-rail').getBoundingClientRect(), pn = el('propName').getBoundingClientRect();
    ok('with the Name field in the rail\'s visible box', pn.top >= rail.top && pn.bottom <= rail.bottom && pn.left >= rail.left && pn.right <= rail.right && pn.height > 0, json([rail.top, rail.bottom, pn.top, pn.bottom]));
    ok('and nothing focused, so no keyboard', document.activeElement !== el('propName'));
    ok('the bar hides while the drawer is open', !shown(el('selBar')));
    el('handyMenu').click();   // closes it (carino-ui.js)
    await wait(400);
    ok('closed again, the bar is back', !drawerOpen() && shown(el('selBar')));

    // ---- 2. Connect and a target ----
    const links0 = state.links.length;
    await tapEl(el('selBar').querySelector('[data-act="connect"]'));
    ok('Connect arms link mode from the device', state.linkSourceId === 'a');
    ok('the banner says what to tap', shown(el('linkBanner')) && el('linkBanner').textContent.includes('Tap the device to connect to PC A'), el('linkBanner').textContent);
    ok('in the bar\'s place', !shown(el('selBar')));
    const cancelR = el('linkCancel').getBoundingClientRect();
    ok('its Cancel is at least 44px', cancelR.width >= 44 && cancelR.height >= 44, json([cancelR.width, cancelR.height]));
    const undo0 = _undoStack.length;
    await tapNode('b');
    ok('a tap on another device files one cable', state.links.length === links0 + 1, `${links0} -> ${state.links.length}`);
    ok('as one undo step', _undoStack.length === undo0 + 1, `${undo0} -> ${_undoStack.length}`);
    ok('and the banner goes', !state.linkSourceId && !shown(el('linkBanner')));
    await tapEl(el('handyUndo'));
    ok('one handy-bar Undo takes it back', state.links.length === links0, String(state.links.length));

    // ---- 3. Cancel, and the same device ----
    await tapNode('a');
    await tapEl(el('selBar').querySelector('[data-act="connect"]'));
    await tapEl(el('linkCancel'));
    ok('Cancel disarms with no cable', !state.linkSourceId && !shown(el('linkBanner')) && state.links.length === links0);
    await tapEl(el('selBar').querySelector('[data-act="connect"]'));
    await tapNode('a');
    ok('a tap on the same device disarms with no cable', !state.linkSourceId && state.links.length === links0);

    // ---- 4. Android's long-press ----
    el('ui-node-c').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    ok('a contextmenu on a device shows the banner', state.linkSourceId === 'c' && shown(el('linkBanner')) && el('linkBanner').textContent.includes('PC C'), el('linkBanner').textContent);
    await tapEl(el('linkCancel'));

    // A read-only document files no cable: a long-press there arms nothing.
    state.readOnly = true;
    el('ui-node-c').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    ok('read-only: a long-press arms no link mode and shows no banner', !state.linkSourceId && !shown(el('linkBanner')), String(state.linkSourceId));
    state.readOnly = false;
    renderCanvasOnly(); await settle();

    // A quick double-tap on Cancel: the bar comes back with Delete under the
    // finger, and the second tap must not delete the device.
    await tapNode('a');
    await tapEl(el('selBar').querySelector('[data-act="connect"]'));
    const cp = mid(el('linkCancel'));
    await touch('touchStart', [{ x: cp.x, y: cp.y, id: 1 }]); await touch('touchEnd', []);
    await settle();
    ok('Cancel by the first tap', !state.linkSourceId && shown(el('selBar')));
    await touch('touchStart', [{ x: cp.x, y: cp.y, id: 1 }]); await touch('touchEnd', []);
    await settle(); await wait(400);
    ok('a double-tap on Cancel deletes nothing', !!getNode('a') && state.nodes.length === 3, String(state.nodes.length));

    // Two fingers, one on the bar: the map zooms, the page does not.
    await tapNode('a');
    ok('the bar shows for the pinch', shown(el('selBar')));
    const nr = el('selBar').querySelector('.sel-bar-name').getBoundingClientRect();
    const p1 = { x: nr.left + Math.min(20, nr.width / 2), y: nr.top + nr.height / 2 };
    const cvr = el('networkCanvas').getBoundingClientRect();
    const p2 = { x: cvr.left + cvr.width * 0.6, y: cvr.top + cvr.height * 0.3 };
    const zp = state.camera.zoom;
    await touch('touchStart', [{ x: p1.x, y: p1.y, id: 1 }]);
    await touch('touchStart', [{ x: p1.x, y: p1.y, id: 1 }, { x: p2.x, y: p2.y, id: 2 }]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: p1.x, y: p1.y + 6 * i, id: 1 }, { x: p2.x + 10 * i, y: p2.y - 25 * i, id: 2 }]);
    await touch('touchEnd', []);
    await settle(); await wait(200);
    ok('a pinch with a finger on the bar zooms the map', state.camera.zoom > zp * 1.05, `${zp} -> ${state.camera.zoom}`);
    ok('and not the page', !window.visualViewport || Math.abs(window.visualViewport.scale - 1) < 1e-3, String(window.visualViewport && window.visualViewport.scale));
    state.camera.x = 60; state.camera.y = 200; state.camera.zoom = 1; applyCamera();
    select(null, null);
    await settle(); await wait(400);

    // ---- 5. A note ----
    const noteAt = () => mid(el('ui-ann-n1').querySelector('rect'));
    let n = noteAt();
    await tap(n.x, n.y);
    ok('a tap selects the note', state.selectedId === 'n1' && state.selectedType === 'annotation');
    ok('a note: Edit text, Link, A−, A+, Delete', json([...el('selBar').querySelectorAll('button')].map((b) => b.dataset.act)) === json(['edittext', 'link', 'smaller', 'larger', 'remove']));
    ok('the bar fits the screen', el('selBar').scrollWidth <= el('selBar').clientWidth + 1 && el('selBar').getBoundingClientRect().right <= innerWidth);
    await tapEl(el('selBar').querySelector('[data-act="edittext"]'));
    ok('Edit text opens the note\'s editor', !!el('annEditor') && el('annEditor').dataset.annId === 'n1');
    el('annEditor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    select(null, null);
    await wait(400);
    const z0 = state.camera.zoom;
    n = noteAt();
    await touch('touchStart', [{ x: n.x, y: n.y, id: 1 }]); await touch('touchEnd', []);
    await wait(90);
    await touch('touchStart', [{ x: n.x, y: n.y, id: 1 }]); await touch('touchEnd', []);
    await settle(); await wait(300);
    ok('a double-tap on a note leaves the zoom alone', state.camera.zoom === z0, `${z0} -> ${state.camera.zoom}`);
    ok('and opens its editor', !!el('annEditor') && el('annEditor').dataset.annId === 'n1');
    if (el('annEditor')) el('annEditor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    await wait(400);
    // Empty map, well clear of the cards (a finger near one is the card's).
    const cv = el('networkCanvas').getBoundingClientRect();
    // Clear by 40px every way: the browser's touch adjustment moves a tap
    // near a card onto the card. (The canvas starts at the top of the screen
    // since the phone navbar went away, so a fixed fraction drifted onto one.)
    const clear = (x, y) => [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === el('networkCanvas'));
    let spot = { x: cv.left + cv.width * 0.75, y: cv.top + cv.height * 0.2 };
    for (let fy = 0.2; fy < 0.6 && !clear(spot.x, spot.y); fy += 0.02) spot = { x: cv.left + cv.width * 0.75, y: cv.top + cv.height * fy };
    ok('an empty point of the map was found', document.elementFromPoint(spot.x, spot.y) === el('networkCanvas'));
    const z1 = state.camera.zoom;
    await touch('touchStart', [{ x: spot.x, y: spot.y, id: 1 }]); await touch('touchEnd', []);
    await wait(60);
    await touch('touchStart', [{ x: spot.x, y: spot.y, id: 1 }]); await touch('touchEnd', []);
    await settle(); await wait(200);
    ok('a double-tap on empty map still zooms 2x', Math.abs(state.camera.zoom - z1 * 2) < 1e-6, `${z1} -> ${state.camera.zoom}`);
    state.camera.x = 60; state.camera.y = 200; state.camera.zoom = 1; applyCamera();
    await settle(); await wait(400);

    // ---- 6. A note's leader ----
    n = noteAt();
    await tap(n.x, n.y);
    await tapEl(el('selBar').querySelector('[data-act="link"]'));
    ok('Link arms link mode from the note', state.linkSourceId === 'n1');
    ok('the banner says to tap a device', shown(el('linkBanner')) && el('linkBanner').textContent.includes('Tap a device to link this note'));
    await tapNode('b');
    ok('a tap on a device adds the note\'s leader', json(getAnnotation('n1').targets) === json(['b']), json(getAnnotation('n1').targets));
    ok('and ends link mode', !state.linkSourceId && !shown(el('linkBanner')));

    // ---- 7. No little discs ----
    await tapNode('a');
    ok('the coarse pointer is seen', matchMedia('(pointer: coarse)').matches);
    const discs = [...document.querySelectorAll('#networkCanvas .node-delete')];
    ok('the device is selected, so its ✕ is in the map', state.selectedId === 'a' && discs.length > 0, String(discs.length));
    ok('no ✕ or A−/A+ is drawn on the touch phone', discs.length > 0 && discs.every((d) => getComputedStyle(d).display === 'none' && !d.getBoundingClientRect().width), String(discs.length));

    // ---- 8. Width ----
    ok('no horizontal scroll', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth} > ${innerWidth}`);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    state.linkSourceId = null;
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
