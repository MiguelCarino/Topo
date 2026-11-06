// A phone's framing of the map (Mobile batch 1; js/app.js mapViewport,
// frameCamera, fitToView, the zoom buttons; js/ui.js focusOnMap and
// centreOnNodes). This runner's window is wider than a phone, so the phone's
// maths is held through the pure frameCamera, and the live code through
// phoneView() stubbed to say "phone" (tests/suites/touchfit.js does it on a
// real 390x844 touch screen). What is held here:
//   1. frameCamera on a phone, with a 390x844 screen's visible map (a 390x784
//      canvas under a 49px top bar and over the document and handy bars):
//      the Smart Home's first view is 0.7 or more with its top in view; a
//      small map is 1.4 at most; an explicit Showcase fit has every device
//      in the view at 0.1 or more; a first view of the Showcase is 0.7 and
//      top-anchored;
//   2. frameCamera off a phone is the old framing to the bit, for random
//      bounds and sizes, and fitToView at this size is what the old maths
//      gives;
//   3. the Fit button sits in the zoom control, is titled, and runs fitToView;
//   4. on a "phone": mapViewport leaves out the top bar and the bottom bars,
//      1:1 is zoom 1 with the world point at the view's middle kept, the zoom
//      buttons zoom about the view's middle, focusOnMap comes in to 0.7 and
//      centres in the view, centreOnNodes comes in to 0.7 for a set that fits
//      and out for one that doesn't, and the zoom floor is 0.1;
//   5. off a phone, 1:1 is the reset to {0, 0, 1} as ever, the floor is 0.2,
//      and focusOnMap keeps the zoom.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  const realPhone = window.phoneView;
  const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

  // The old framing, copied from fitToView before Mobile batch 1.
  const oldFrame = (b, rect) => {
    const PAD = 80;
    const w = (b.maxX - b.minX) || 1, h = (b.maxY - b.minY) || 1;
    const zoom = Math.min(1.4, Math.max(0.2, Math.min((rect.width - PAD * 2) / w, (rect.height - PAD * 2) / h)));
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    return { zoom, x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom };
  };
  // A document's bounds as fitToView takes them (devices, labels, frames).
  const boundsOf = (nodes, frames) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => { minX = Math.min(minX, n.x - 30); minY = Math.min(minY, n.y - 30); maxX = Math.max(maxX, n.x + 30); maxY = Math.max(maxY, n.y + 76); });
    if (frames) { minX = Math.min(minX, frames.minX); minY = Math.min(minY, frames.minY); maxX = Math.max(maxX, frames.maxX); maxY = Math.max(maxY, frames.maxY); }
    return { minX, minY, maxX, maxY };
  };
  const inside = (b, cam, v) => b.minX * cam.zoom + cam.x >= v.left - 0.5 && b.maxX * cam.zoom + cam.x <= v.left + v.width + 0.5
    && b.minY * cam.zoom + cam.y >= v.top - 0.5 && b.maxY * cam.zoom + cam.y <= v.top + v.height + 0.5;
  const N = (id, x, y) => ({ id, type: 'pc', name: id, x, y, gw: '', dns: '', os: '', notes: '', nat: false, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] });

  try {
    // ---- 1. The phone's maths ----
    // 390x844: the canvas from y 60 to 844 (784 tall); the top bar's bottom
    // at y 109, the document bar's top at y 697: canvas y 49 to 637.
    const PHONE_VIEW = { left: 0, top: 49, width: 390, height: 588 };
    // The same screen with the search tools open: the top bar down to y 230.
    const SEARCH_VIEW = { left: 0, top: 170, width: 390, height: 467 };
    ok('the readable zoom is 0.7 and the phone floor 0.1', PHONE_READABLE_ZOOM === 0.7 && PHONE_MIN_ZOOM === 0.1);
    const house = boundsOf(templatesData.house.nodes);
    let c = frameCamera(house, PHONE_VIEW, { phone: true, initial: true });
    ok('the Smart Home opens at the readable zoom or more on a phone', c.zoom >= 0.7, json(c));
    ok('with its top in the view', house.minY * c.zoom + c.y >= PHONE_VIEW.top - 0.5 && house.minY * c.zoom + c.y < PHONE_VIEW.top + PHONE_VIEW.height, json(c));
    ok('and its middle across the middle of the view', near((house.minX + house.maxX) / 2 * c.zoom + c.x, 195, 1e-6), json(c));
    const small = { minX: 0, minY: 0, maxX: 60, maxY: 106 };
    c = frameCamera(small, PHONE_VIEW, { phone: true, initial: true });
    ok('a small map is no more than 1.4', c.zoom <= 1.4 && c.zoom >= 0.7, json(c));
    ok('and is centred in the view', near(53 * c.zoom + c.y, PHONE_VIEW.top + PHONE_VIEW.height / 2, 1e-6) && near(30 * c.zoom + c.x, 195, 1e-6), json(c));
    const show = boundsOf(templatesData.showcase.nodes);
    c = frameCamera(show, PHONE_VIEW, { phone: true });
    ok('an explicit Showcase fit has all of it in the view', inside(show, c, PHONE_VIEW), json([c, show]));
    ok('at 0.1 or more, under 0.2', c.zoom >= 0.1 && c.zoom < 0.2, String(c.zoom));
    c = frameCamera(show, PHONE_VIEW, { phone: true, initial: true });
    ok('a first view of the Showcase stays at 0.7', c.zoom === 0.7, String(c.zoom));
    ok('with its top 16px under the top of the view', near(show.minY * c.zoom + c.y, PHONE_VIEW.top + 16, 1e-6), json(c));
    ok('centred across', near((show.minX + show.maxX) / 2 * c.zoom + c.x, 195, 1e-6), json(c));
    // With the search tools open the top bar takes the most.
    c = frameCamera(show, SEARCH_VIEW, { phone: true });
    ok('with the search open, an explicit Showcase fit is all in the smaller view', inside(show, c, SEARCH_VIEW) && c.zoom >= 0.1, json([c, show]));
    c = frameCamera(show, SEARCH_VIEW, { phone: true, initial: true });
    ok('and a first view has its top 16px under the open search', near(show.minY * c.zoom + c.y, SEARCH_VIEW.top + 16, 1e-6) && c.zoom === 0.7, json(c));
    c = frameCamera(house, SEARCH_VIEW, { phone: true, initial: true });
    ok('the Smart Home top stays under the open search', house.minY * c.zoom + c.y >= SEARCH_VIEW.top - 0.5 && c.zoom >= 0.7, json(c));
    // A huge map on a phone still floors at 0.1 for an explicit fit.
    c = frameCamera({ minX: 0, minY: 0, maxX: 100000, maxY: 100 }, PHONE_VIEW, { phone: true });
    ok('an explicit fit floors at 0.1 on a phone', c.zoom === 0.1, String(c.zoom));

    // ---- 2. Off a phone it is the old framing ----
    let same = true, bad = null;
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      const minX = (rnd() - 0.5) * 4000, minY = (rnd() - 0.5) * 4000;
      const b = { minX, minY, maxX: minX + rnd() * 5000, maxY: minY + rnd() * 3000 };
      const rect = { width: 200 + Math.round(rnd() * 2400), height: 200 + Math.round(rnd() * 1400) };
      const a = frameCamera(b, { left: 0, top: 0, width: rect.width, height: rect.height }, { phone: false, initial: rnd() < 0.5 });
      const o = oldFrame(b, rect);
      if (a.zoom !== o.zoom || a.x !== o.x || a.y !== o.y) { same = false; bad = [b, rect, a, o]; break; }
    }
    ok('off a phone frameCamera is the old framing, bit for bit', same, json(bad));
    // The 1280x800 example: the canvas is 940x740 there.
    const exB = boundsOf(templatesData.house.nodes, null);
    replaceDocument(cloneData(templatesData.house), { origin: 'file', docId: 'phonefit-house' });
    setView('map');
    const fr = groupFrameBounds();
    const b1280 = fr ? { minX: Math.min(exB.minX, fr.minX), minY: Math.min(exB.minY, fr.minY), maxX: Math.max(exB.maxX, fr.maxX), maxY: Math.max(exB.maxY, fr.maxY) } : exB;
    c = frameCamera(b1280, { left: 0, top: 0, width: 940, height: 740 }, { phone: false, initial: true });
    ok('the 1280x800 example frame is unchanged (zoom 1.06618, x 37.132, y 69.338)',
      near(c.zoom, 1.0661764705882353, 1e-12) && near(c.x, 37.132352941176464, 1e-9) && near(c.y, 69.33823529411762, 1e-9), json(c));
    window.phoneView = () => false;
    fitToView(null, { initial: true });
    const r = el('networkCanvas').getBoundingClientRect();
    const o = oldFrame(b1280, r);
    ok('fitToView at this size is the old maths', state.camera.zoom === o.zoom && state.camera.x === o.x && state.camera.y === o.y, json([state.camera, o]));
    const v0 = mapViewport();
    ok('mapViewport off a phone is the whole canvas', v0.left === 0 && v0.top === 0 && v0.width === r.width && v0.height === r.height, json([v0, r.width, r.height]));

    // ---- 3. The Fit button ----
    const fit = el('zoomFitBtn');
    ok('the zoom control has a Fit button', !!fit && fit.closest('.zoom-ctl') !== null);
    ok('titled with the fit key', fit && fit.title === 'Fit the diagram to the view' && fit.hasAttribute('data-i18n-title'), fit && fit.title);
    const tr = ['es', 'pt-BR', 'ja', 'ru'].map((l) => { setLocale(l); return t('Fit the diagram to the view'); });
    setLocale('en');
    ok('the title is translated', tr.every((x) => x && x !== 'Fit the diagram to the view'), json(tr));
    state.camera.x = 900; state.camera.y = -400; state.camera.zoom = 3; applyCamera();
    const realFit = window.fitToView;
    let calls = 0;
    window.fitToView = (...a) => { calls++; return realFit(...a); };
    fit.click();
    window.fitToView = realFit;
    ok('and it runs fitToView', calls === 1 && state.camera.zoom === o.zoom && state.camera.x === o.x, json([calls, state.camera]));

    // ---- 4. On a "phone" ----
    window.phoneView = () => true;
    // The bars: the top bar is there (#advanced); a bottom bar is put up.
    const topbar = document.querySelector('#canvasContainer > .topo-topbar');
    const docBar = el('docBar');
    const docWasHidden = docBar.classList.contains('hidden');
    docBar.classList.remove('hidden');
    const vb = mapViewport();
    const tb = topbar.getBoundingClientRect(), db = docBar.getBoundingClientRect();
    ok('mapViewport starts under the top bar', Math.abs(vb.top - (tb.bottom - r.top)) < 0.5 && vb.top > 0, json([vb, tb.bottom, r.top]));
    ok('and ends over the document bar', Math.abs(vb.top + vb.height - (db.top - r.top)) < 0.5, json([vb, db.top, r.top]));
    ok('the full width', vb.left === 0 && vb.width === r.width, json(vb));
    // Boot fits while body.chrome-pending hides the bars (css/app.css): the
    // visible map is still measured as it will be once they show.
    document.body.classList.add('chrome-pending');
    const vPending = mapViewport();
    const stillPending = document.body.classList.contains('chrome-pending');
    document.body.classList.remove('chrome-pending');
    ok('mapViewport during boot (chrome-pending) is the one after it', json(vPending) === json(vb), json([vPending, vb]));
    ok('and boot\'s chrome-pending is left as it was', stillPending);
    const mid = { x: vb.left + vb.width / 2, y: vb.top + vb.height / 2 };
    const worldAt = (p) => ({ x: (p.x - state.camera.x) / state.camera.zoom, y: (p.y - state.camera.y) / state.camera.zoom });
    state.camera.x = -130; state.camera.y = 75; state.camera.zoom = 0.355; applyCamera();
    let w0 = worldAt(mid);
    el('zoomResetBtn').click();
    let w1 = worldAt(mid);
    ok('phone 1:1 is zoom 1', state.camera.zoom === 1, json(state.camera));
    ok('with the world point at the middle of the view kept', near(w0.x, w1.x, 1e-6) && near(w0.y, w1.y, 1e-6), json([w0, w1]));
    w0 = worldAt(mid);
    el('zoomInBtn').click();
    w1 = worldAt(mid);
    ok('the + button zooms about the middle of the view', near(w0.x, w1.x, 1e-6) && near(w0.y, w1.y, 1e-6) && near(state.camera.zoom, 1.2, 1e-9), json([w0, w1, state.camera]));
    ok('the zoom floor is 0.1 on a phone', mapZoomLimits().min === 0.1);
    state.camera.zoom = 0.12; applyCamera();
    el('zoomOutBtn').click(); el('zoomOutBtn').click();
    ok('and the - button goes down to it', near(state.camera.zoom, 0.1, 1e-9), String(state.camera.zoom));

    // focusOnMap: in to 0.7, centred in the view.
    const doc = { v: DOC_VERSION, nodes: [N('a', 0, 0), N('b', 300, 0), N('c', 3000, 2000)], links: [], annotations: [] };
    replaceDocument(doc, { origin: 'file', docId: 'phonefit-doc', fit: false });
    setView('map');
    state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 0.3; applyCamera();
    focusOnMap({ type: 'node', id: 'b' });
    let at = { x: 300 * state.camera.zoom + state.camera.x, y: 0 * state.camera.zoom + state.camera.y };
    ok('phone focusOnMap comes in to the readable zoom', state.camera.zoom >= 0.7, String(state.camera.zoom));
    ok('with the device in the middle of the view', near(at.x, mid.x, 1e-6) && near(at.y, mid.y, 1e-6), json([at, mid]));
    state.camera.zoom = 2; applyCamera();
    focusOnMap({ type: 'node', id: 'a' });
    ok('and keeps a closer zoom', state.camera.zoom === 2, String(state.camera.zoom));
    // centreOnNodes: in to 0.7 when the set fits there, out when it doesn't.
    state.camera.zoom = 0.3; applyCamera();
    centreOnNodes([getNode('a'), getNode('b')]);
    ok('phone centreOnNodes comes in to 0.7 for a set that fits', near(state.camera.zoom, 0.7, 1e-9), String(state.camera.zoom));
    at = { x: 150 * state.camera.zoom + state.camera.x, y: state.camera.y };
    // What is seen with a device selected: the phone's selection bar (Mobile
    // batch 2) lifts the document bar over it, so the view is shorter now.
    const vSel = mapViewport(), midSel = { x: vSel.left + vSel.width / 2, y: vSel.top + vSel.height / 2 };
    ok('centred in the view', near(at.x, midSel.x, 1e-6) && near(at.y, midSel.y, 1e-6), json([at, midSel]));
    state.camera.zoom = 1; applyCamera();
    centreOnNodes([getNode('a'), getNode('c')]);
    const fitZ = Math.min((vb.width - 120) / 3000, (vb.height - 120) / 2000);
    ok('and out, as far as it takes, for one that does not', near(state.camera.zoom, Math.max(0.1, fitZ), 1e-9) && state.camera.zoom < 0.7, json([state.camera.zoom, fitZ]));
    // Devices added under the document bar are off what is seen: the map is
    // refitted (addDevices, js/add.js), as for ones off the canvas.
    {
      const realFitTV = window.fitToView;
      let fits = 0;
      window.fitToView = () => { fits++; };
      initHistory();
      const probe = addDevices({ items: [{ type: 'pc', count: 1 }], targetId: null })[0];
      const px = probe && probe.x, py = probe && probe.y;
      undo();
      state.camera.zoom = 1; state.camera.x = vb.left + vb.width / 2 - px; state.camera.y = vb.top + vb.height + 10 - py; applyCamera();
      const inCanvas = state.camera.y + py < r.height;
      fits = 0;
      const again = addDevices({ items: [{ type: 'pc', count: 1 }], targetId: null })[0];
      window.fitToView = realFitTV;
      ok('a device added under the document bar refits the phone map', !!probe && inCanvas && again && again.x === px && again.y === py && fits === 1, json([px, py, again && [again.x, again.y], fits, inCanvas]));
      undo();
    }
    // Tidy on a phone is a new layout looked at: the readable zoom, never the
    // whole-map 0.1 an explicit fit allows.
    replaceDocument(cloneData(templatesData.showcase), { origin: 'file', docId: 'phonefit-show', fit: false });
    setView('map');
    state.camera.zoom = 0.7; applyCamera();
    batch(() => tidyLayoutNow('all'));
    ok('phone Tidy all keeps the readable zoom', state.camera.zoom >= 0.7, String(state.camera.zoom));
    replaceDocument(doc, { origin: 'file', docId: 'phonefit-doc', fit: false });
    setView('map');
    if (docWasHidden) docBar.classList.add('hidden');

    // ---- 5. Off a phone, as ever ----
    window.phoneView = () => false;
    state.camera.x = 50; state.camera.y = 60; state.camera.zoom = 2; applyCamera();
    el('zoomResetBtn').click();
    ok('off a phone 1:1 is the reset to the corner', state.camera.x === 0 && state.camera.y === 0 && state.camera.zoom === 1, json(state.camera));
    ok('the floor is 0.2', mapZoomLimits().min === 0.2);
    // A camera a phone left under 0.2 (the window then widened past it):
    // zooming out never zooms in.
    state.camera.zoom = 0.12; applyCamera();
    el('zoomOutBtn').click();
    ok('off a phone, - from 0.12 does not jump in to 0.2', state.camera.zoom <= 0.12, String(state.camera.zoom));
    const cvr = el('networkCanvas').getBoundingClientRect();
    el('networkCanvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 200, clientX: cvr.left + 100, clientY: cvr.top + 100, bubbles: true, cancelable: true }));
    ok('nor does the wheel', state.camera.zoom <= 0.12, String(state.camera.zoom));
    el('zoomInBtn').click();
    ok('and + still zooms in from there', state.camera.zoom > 0.12, String(state.camera.zoom));
    state.camera.zoom = 0.2; applyCamera();
    el('zoomOutBtn').click();
    ok('at 0.2 the - button stays at 0.2', state.camera.zoom === 0.2, String(state.camera.zoom));
    state.camera.zoom = 0.3; applyCamera();
    focusOnMap({ type: 'node', id: 'b' });
    ok('focusOnMap keeps the zoom', state.camera.zoom === 0.3 && near(300 * 0.3 + state.camera.x, r.width / 2, 1e-9), json(state.camera));
    state.camera.zoom = 0.3; applyCamera();
    centreOnNodes([getNode('a'), getNode('b')]);
    ok('centreOnNodes never comes in', state.camera.zoom === 0.3, String(state.camera.zoom));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.phoneView = realPhone;
    setDialogResponder(heldResponder);
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
