// @realtime @touch
// The phone navbar's edge cases (Mobile batch 2 review; js/mobile.js
// navReveal). run-cross.mjs opens this on a 390x844 touch screen with real
// touch input (window.__touch), a keyboard (__key), a mouse (__mouse),
// reduced motion (__media) and a rotation (__viewport). tests/suites/navreveal.js
// holds the main gestures; this holds what goes wrong around them:
//   1. a tap in the top band on empty map, then a dblclick from a browser that
//      does not say where it came from (no sourceCapabilities: Firefox,
//      Safari), is a finger's double-tap: no note;
//   2. a pinch whose first finger lands in the top band pinches the map, and
//      a second finger on a device does not drag it;
//   3. a band swipe that drifts sideways neither pans nor shows the bar;
//   4. no bar under an open Topo dialog (.modal-scrim);
//   5. a drag down in the Saved searches sheet scrolls it, no bar;
//   6. a tap in the bar (the theme switch) starts the idle count again;
//   7. a keyboard on the handle keeps the bar, and Tab goes on into it;
//   8. a mouse resting on the bar keeps it;
//   9. crossing the breakpoint with About open: wider keeps About's focus,
//      narrower shows the bar with About;
//  10. reduced motion: no slide.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const touch = (type, pts) => window.__touch(type, pts);
  const tapAt = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); await wait(320); await settle(); };
  const tapEl = async (node) => { const b = node.getBoundingClientRect(); await tapAt(b.left + b.width / 2, b.top + b.height / 2); };
  const swipe = async (x0, y0, x1, y1, after = 320) => {
    await touch('touchStart', [{ x: x0, y: y0, id: 1 }]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: x0 + (x1 - x0) * i / 6, y: y0 + (y1 - y0) * i / 6, id: 1 }]); await wait(16); }
    await touch('touchEnd', []);
    if (after) { await wait(after); await settle(); }
  };
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  const nav = el('carinoNav'), handle = el('navHandle'), cv = el('networkCanvas');
  const shown = () => document.documentElement.classList.contains('topo-nav-shown');
  const navBox = () => nav.getBoundingClientRect();
  const away = () => !shown() && getComputedStyle(nav).visibility === 'hidden' && navBox().bottom <= 0;
  const out1 = () => getComputedStyle(nav).visibility === 'visible' && Math.abs(navBox().top) < 0.5;
  const cam = () => json({ x: Math.round(state.camera.x), y: Math.round(state.camera.y), z: state.camera.zoom });
  const home = () => { state.camera.x = 120; state.camera.y = 430; state.camera.zoom = 1; applyCamera(); };
  const putAway = async () => {
    const help = nav.querySelector('.cn-help');
    if (help && !help.hidden) { const x = nav.querySelector('.cn-x'); if (x) x.click(); else help.hidden = true; }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await settle();
    if (shown()) await tapAt(330, 760);
    select(null); await settle();
  };
  const doc = { v: DOC_VERSION, links: [], annotations: [],
    nodes: [{ id: 'd1', type: 'pc', name: 'PC-1', x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10' }] }] };

  try {
    ok('this page is a phone', innerWidth === 390 && navigator.maxTouchPoints > 0, `${innerWidth}`);
    replaceDocument(doc, { origin: 'file', docId: 'nav-edge' });
    setView('map');
    home();
    renderCanvasOnly();
    await settle(); await wait(800);
    ok('the bar is away to start', away());
    // An empty point of the band, clear of the handle (x 159-231).
    let bx = 320;
    while (bx < 380 && document.elementFromPoint(bx, 5) !== cv) bx += 6;
    ok('the band at y 5 is empty map', document.elementFromPoint(bx, 5) === cv, String(bx));

    // ---- 1. Band tap, then a dblclick that does not say it is a finger's ----
    const notes0 = (state.annotations || []).length, undo0 = _undoStack.length;
    await tapAt(bx, 5);
    let proto = MouseEvent.prototype;
    while (proto && !Object.prototype.hasOwnProperty.call(proto, 'sourceCapabilities')) proto = Object.getPrototypeOf(proto);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'sourceCapabilities');
    if (proto) delete proto.sourceCapabilities;
    try {
      ok('this event says nothing of its source (as in Firefox)', !('sourceCapabilities' in new MouseEvent('dblclick')));
      cv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: bx, clientY: 5 }));
    } finally { if (proto && desc) Object.defineProperty(proto, 'sourceCapabilities', desc); }
    await settle();
    ok('a band double-tap drops no note', (state.annotations || []).length === notes0 && _undoStack.length === undo0,
      `${notes0} -> ${(state.annotations || []).length}, undo ${undo0} -> ${_undoStack.length}`);
    ok('and no note editor', !el('annEditor') || el('annEditor').hidden);
    if (el('annEditor')) el('annEditor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    home(); await settle(); await wait(800);

    // ---- 2. A pinch whose first finger lands in the band ----
    const dEl = el('ui-node-d1'), db = dEl && dEl.getBoundingClientRect();
    const f2 = db ? { x: db.left + db.width / 2, y: db.top + db.height / 2 } : { x: 200, y: 500 };
    ok('the second finger is on a device', !!db && dEl.contains(document.elementFromPoint(f2.x, f2.y)), json(f2));
    const p0 = json([getNode('d1').x, getNode('d1').y]), z0 = state.camera.zoom, u0 = _undoStack.length;
    await touch('touchStart', [{ x: bx, y: 4, id: 1 }]);
    await wait(30);
    await touch('touchStart', [{ x: bx, y: 4, id: 1 }, { x: f2.x, y: f2.y, id: 2 }]);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [{ x: bx, y: 4, id: 1 }, { x: f2.x - 4 * i, y: f2.y + 30 * i, id: 2 }]);
      await frame();
    }
    await touch('touchEnd', []);
    await settle(); await wait(200);
    ok('it pinches the map (zooms)', state.camera.zoom > z0 * 1.2, `${z0} -> ${state.camera.zoom}`);
    ok('and the device under the second finger did not move', json([getNode('d1').x, getNode('d1').y]) === p0, `${p0} -> ${json([getNode('d1').x, getNode('d1').y])}`);
    ok('nothing was filed', _undoStack.length === u0);
    ok('nor did the bar come', away());
    home(); select(null); await settle(); await wait(800);

    // ---- 3. A band swipe that drifts sideways ----
    const c3 = cam();
    await swipe(bx, 4, bx - 200, 30);
    ok('a sideways band swipe does not pan', cam() === c3, `${c3} -> ${cam()}`);
    ok('nor show the bar', away());

    // ---- 4. A Topo dialog open ----
    const dlg = el('settingsDialog');
    dlg.hidden = false; await settle();
    ok('the dialog is up', dlg.getClientRects().length > 0);
    await swipe(bx, 4, bx, 130);
    ok('a band swipe does not bring the bar under a dialog', !shown(), handle.getAttribute('aria-expanded'));
    dlg.hidden = true; await putAway();

    // ---- 5. The Saved searches sheet scrolls ----
    const menu = el('querySavedMenu'), panel = el('querySavedPanel'), list = el('querySavedList');
    menu.classList.remove('hidden'); panel.hidden = false;
    list.innerHTML = Array.from({ length: 40 }, (_, i) => `<li style="padding:12px">Search ${i}</li>`).join('');
    await settle();
    panel.scrollTop = 300; await settle();
    const pb = panel.getBoundingClientRect();
    const px = pb.left + pb.width / 2, py = pb.top + Math.min(60, pb.height / 3);
    ok('the sheet is open and scrolled', panel.scrollTop > 0 && panel.contains(document.elementFromPoint(px, py)), `${panel.scrollTop} ${json(pb)}`);
    await swipe(px, py, px, py + 120);
    ok('a drag down in it does not show the bar', !shown());
    ok('it scrolled the sheet back up instead', panel.scrollTop < 300, String(panel.scrollTop));
    panel.hidden = true; list.innerHTML = ''; menu.classList.add('hidden');
    await putAway();

    // ---- 6. A tap in the bar starts the idle count again ----
    await swipe(bx, 4, bx, 130);
    ok('the bar is shown', shown() && out1());
    // The first tap focuses the switch (focusin counts as use); the second,
    // on a switch already focused (or in Safari, where a tap focuses no
    // button), must count too.
    await wait(1000);
    const sw = el('ctSwitch');
    ok('the theme switch is in the bar', !!sw && nav.contains(sw));
    if (sw) await tapEl(sw);
    await wait(2600);
    if (sw) await tapEl(sw);   // the theme back
    await wait(1500);   // past 4 s since the first tap, 1.5 s since the second
    ok('a tap on the theme switch kept it up past the idle time', shown() && out1());
    await wait(4600);
    ok('then idle hides it', away());
    await putAway();

    // ---- 7. A keyboard on the handle ----
    // A key first, so the focus that follows is a keyboard's (:focus-visible).
    await window.__key('Shift');
    handle.focus();
    await wait(320); await settle();
    ok('the keyboard is on the handle', document.activeElement === handle && handle.matches(':focus-visible'));
    ok('and that shows the bar', shown() && out1());
    await wait(4600);
    ok('it stays while the keyboard is on the handle', shown() && out1());
    await window.__key('Tab'); await settle();
    ok('the next Tab goes into the bar', nav.contains(document.activeElement), document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    await putAway();
    ok('away again', away());

    // ---- 8. A mouse on such a screen ----
    await window.__mouse(bx, 2);
    await wait(320); await settle();
    ok('a mouse at the top shows it', shown() && out1());
    await window.__mouse(bx, 30);
    await wait(4600);
    ok('it stays while the mouse rests on it', shown() && out1());
    await window.__mouse(bx, 700);
    await wait(4600);
    ok('and goes once the mouse leaves', away());

    // ---- 9. Across the breakpoint with About open ----
    await tapAt(195, 7);
    const legal = el('cnLegal');
    await tapEl(legal);
    const help = nav.querySelector('.cn-help');
    const x = nav.querySelector('.cn-x');
    ok('About is open', !!help && !help.hidden && !!x);
    if (x) x.focus();
    await window.__viewport(1180, 820); await settle(); await wait(320);
    ok('wider: About still open', !help.hidden);
    ok('and its focus kept', !!x && document.activeElement === x, document.activeElement && (document.activeElement.className || document.activeElement.tagName));
    ok('the bar pinned and visible', getComputedStyle(nav).visibility === 'visible' && getComputedStyle(nav).position !== 'fixed', getComputedStyle(nav).position);
    await window.__viewport(390, 844); await settle(); await wait(320); await settle();
    ok('narrower again with About open: the bar is shown', shown() && out1() && !help.hidden, json(navBox()));
    ok('the About window can be seen', getComputedStyle(help).visibility === 'visible');
    if (x) x.click(); else help.hidden = true;
    await putAway();
    ok('away after', away());

    // ---- 10. Reduced motion ----
    await window.__media('reduce'); await settle();
    const dur = () => getComputedStyle(nav).transitionDuration.split(',').every((d) => parseFloat(d) === 0);
    ok('reduced motion: no slide', dur(), getComputedStyle(nav).transitionDuration);
    await swipe(bx, 4, bx, 130, 0);
    await frame(); await frame();
    ok('and the bar is there at once', shown() && out1(), json(navBox()));
    await window.__media('no-preference'); await settle();
    ok('without the setting it slides', !dur(), getComputedStyle(nav).transitionDuration);
    await putAway();

    ok('no horizontal scroll', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth}`);
  } catch (e) {
    ok('suite ran without throwing', false, (e && e.stack) || String(e));
  } finally {
    setView(savedView || 'map');
    setDialogResponder(heldResponder);
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
