// What a redraw, a drag step and a keystroke leave alone, so a big map stays
// smooth in WebKitGTK (the Linux desktop app) as well as in Chromium. Each of
// these was measured costing tens to hundreds of milliseconds there at 400
// devices (docs: tests/README.md, drawcost). Held here:
//   1. measuredTextBox (js/ui.js) answers getBBox's box, and the same words
//      in the same font are measured once: a second redraw reads no box;
//   2. linkDetour (js/model.js) passes far devices over before projecting
//      them, with every answer the same as the full projection's, for every
//      cable of the 400-device fixture and for runs dragged across it;
//   3. a drag step moves the group frames where they are (drawGroupFrames
//      reuse): the same elements, at the new place, the last step's drop cue
//      cleared; a frame whose words change is drawn anew;
//   4. the cards a finger drags have no touchstart listener of their own: one
//      listener on the map, in the capture phase, presses each card under the
//      finger (onMapTouch), innermost first;
//   5. the map is pinned to its pane's size in pixels (pinCanvasSize), and no
//      export carries the pin;
//   6. the fields' coalescer settles (redrawCoalescer opts.settle, js/state.js):
//      once the map is slow a keystroke draws nothing, the name under the
//      device follows at once (renderTyped), and the draw comes when the keys
//      pause or at a flush, once; a fast map draws on every key as before;
//   7. applyCamera writes the grid spacing only when it changes, and the
//      selection bar's attributes only when they change (js/mobile.js).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const held = { coalesce: window.TOPO_COALESCE, checks: window.TOPO_CHECKS };
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
  // The detour as it was before the far devices were passed over: every
  // device projected, for every cable.
  const fullDetour = (src, tgt) => {
    const dx = tgt.x - src.x, dy = tgt.y - src.y, len = Math.hypot(dx, dy);
    if (len < 1) return 0;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const near = [];
    detourObstacles().forEach((n) => {
      if (n === src || n === tgt || n.id === src.id || n.id === tgt.id) return;
      let lo = Infinity, hi = -Infinity, a0 = Infinity, a1 = -Infinity;
      [[DETOUR_BOX.x1, DETOUR_BOX.y1], [DETOUR_BOX.x2, DETOUR_BOX.y1], [DETOUR_BOX.x1, DETOUR_BOX.y2], [DETOUR_BOX.x2, DETOUR_BOX.y2]].forEach(([ox, oy]) => {
        const rx = n.x + ox - src.x, ry = n.y + oy - src.y;
        const along = rx * ux + ry * uy, across = rx * nx + ry * ny;
        a0 = Math.min(a0, along); a1 = Math.max(a1, along);
        lo = Math.min(lo, across); hi = Math.max(hi, across);
      });
      if (a1 < 24 || a0 > len - 24) return;
      const t = Math.min(0.85, Math.max(0.15, ((n.x - src.x) * ux + (n.y - src.y) * uy) / len));
      near.push({ t, lo: lo - DETOUR_GAP, hi: hi + DETOUR_GAP });
    });
    if (!near.length) return 0;
    const hits = (bow) => near.filter((o) => { const off = 2 * o.t * (1 - o.t) * bow; return off > o.lo && off < o.hi; });
    if (!hits(0).length) return 0;
    const cap = Math.min(len * DETOUR_MAX, DETOUR_REACH);
    const tryside = (sign) => {
      let bow = 0;
      for (let i = 0; i < 6; i += 1) {
        const now = hits(bow);
        if (!now.length) return { bow, left: 0 };
        const need = now.reduce((m, o) => { const k = 2 * o.t * (1 - o.t); return sign > 0 ? Math.max(m, o.hi / k) : Math.min(m, o.lo / k); }, bow);
        if (Math.abs(need) > cap) return { bow: sign * cap, left: hits(sign * cap).length };
        bow = need;
      }
      return { bow, left: hits(bow).length };
    };
    const a = tryside(1), b = tryside(-1);
    const best = a.left !== b.left ? (a.left < b.left ? a : b) : (Math.abs(a.bow) <= Math.abs(b.bow) ? a : b);
    return best.left ? 0 : best.bow;
  };

  try {
    window.TOPO_CHECKS = false;
    window.TOPO_COALESCE = false;
    await loadScript('tests/fixtures/site400.js');
    replaceDocument(topoSite400(), { origin: 'file' });
    setView('map');
    renderCanvasOnly();

    // ---- 1. Text measured once ----
    const NS = 'http://www.w3.org/2000/svg';
    const probe = document.createElementNS(NS, 'text');
    probe.setAttribute('x', '7'); probe.setAttribute('y', '9'); probe.setAttribute('font-size', '10'); probe.setAttribute('font-family', 'sans-serif');
    probe.textContent = 'Measured once · 12';
    el('layer-labels').appendChild(probe);
    const real = probe.getBBox(), got = measuredTextBox(probe);
    ok('the box is getBBox\'s', ['x', 'y', 'width', 'height'].every((k) => Math.abs(real[k] - got[k]) < 0.01) && real.width > 0,
      `${JSON.stringify(got)} / ${real.x},${real.y},${real.width},${real.height}`);
    probe.setAttribute('x', '107');
    const realGet = SVGGraphicsElement.prototype.getBBox;
    let boxes = 0;
    SVGGraphicsElement.prototype.getBBox = function () { boxes++; return realGet.apply(this, arguments); };
    let moved;
    try { moved = measuredTextBox(probe); } finally { SVGGraphicsElement.prototype.getBBox = realGet; }
    ok('the same words elsewhere are not measured again, and sit where the text does', boxes === 0 && Math.abs(moved.x - (got.x + 100)) < 0.01, `${boxes} / ${moved.x}`);
    probe.remove();
    boxes = 0;
    SVGGraphicsElement.prototype.getBBox = function () { boxes++; return realGet.apply(this, arguments); };
    try { renderCanvasOnly(); } finally { SVGGraphicsElement.prototype.getBBox = realGet; }
    ok('a second redraw of the same map reads no box', boxes === 0, String(boxes));

    // ---- 2. The detour, the same answers ----
    const same = (fn) => withLookupPass(() => {
      const bad = [];
      state.links.forEach((l) => {
        const s = getNode(l.source), t = getNode(l.target);
        if (!s || !t) return;
        const a = fn(s, t), b = fullDetour(s, t);
        if (Math.abs(a - b) > 1e-9) bad.push(`${l.id}: ${a} vs ${b}`);
      });
      return bad;
    });
    let bad = same(linkDetour);
    const bowed = withLookupPass(() => state.links.filter((l) => { const s = getNode(l.source), t = getNode(l.target); return s && t && linkDetour(s, t) !== 0; }).length);
    ok('every cable bows as the full projection bows it', !bad.length, bad.slice(0, 3).join('; '));
    ok('and some do bow (the check is not of straight runs only)', bowed > 0, String(bowed));
    // Runs dragged across the site: a core moved over a grid of places.
    const core = state.nodes.find((n) => n.type === 'switch');
    const x0 = core.x, y0 = core.y;
    bad = [];
    for (let gx = -2; gx <= 2; gx++) for (let gy = -2; gy <= 2; gy++) {
      core.x = x0 + gx * 170; core.y = y0 + gy * 130;
      bad.push(...same(linkDetour));
    }
    core.x = x0; core.y = y0;
    ok('and so do the cables of a device moved across the map', !bad.length, bad.slice(0, 3).join('; '));
    renderCanvasOnly();

    // ---- 3. The frames on a drag step ----
    const frames = () => [...el('layer-groups').children];
    const before = frames();
    ok('the fixture draws its group frames', before.length >= 2 && before.every((g) => g._gmKey), String(before.length));
    const member = state.nodes.find((n) => n.group && !state.groups.find((g) => g.id === n.group && g.kind === 'rack'));
    const frameOf = (gid) => el('layer-groups').querySelector(`.grp-frame[data-grp="${CSS.escape(gid)}"]`);
    const rectOf = (gid) => frameOf(gid).firstElementChild.getAttribute('x');
    const was = rectOf(member.group);
    before.forEach((g) => g.classList.add('grp-drop'));
    member.x -= 400;
    redrawGroupOverlay();
    const after = frames();
    ok('a drag step keeps the frames\' elements', after.length === before.length && after.every((g, i) => g === before[i]));
    ok('and moves the frame to the device', rectOf(member.group) !== was && Number(rectOf(member.group)) < Number(was), `${was} -> ${rectOf(member.group)}`);
    ok('the last step\'s drop cue is cleared', after.every((g) => !g.classList.contains('grp-drop')));
    member.x += 400;
    const g0 = state.groups.find((g) => g.id === member.group), name0 = g0.name;
    g0.name = `${name0 || 'Group'} renamed`;
    redrawGroupOverlay();
    ok('a frame whose words change is drawn anew', frames()[0] !== before[0] && frameOf(g0.id).textContent.includes('renamed'));
    g0.name = name0;
    renderCanvasOnly();

    // ---- 4. One touch listener ----
    const nodeG = el(`ui-node-${state.nodes[3].id}`);
    ok('a device\'s card is pressed through the map\'s listener', _mapTouchPress.has(nodeG));
    const tab = el('layer-groups').querySelector('.grp-tab');
    ok('so is a frame\'s tab', !!tab && _mapTouchPress.has(tab));
    let pressed = [];
    const realPress = window.touchPress;
    window.touchPress = function (e, press) { pressed.push(e.currentTarget === el('networkCanvas') ? 'map' : 'other'); };
    try {
      let te = null;
      try {
        const touch = new Touch({ identifier: 1, target: nodeG.querySelector('rect') || nodeG, clientX: 10, clientY: 10 });
        te = new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch], bubbles: true, cancelable: true });
      } catch (err) { te = null; }
      if (te) {
        (nodeG.querySelector('rect') || nodeG).dispatchEvent(te);
        ok('a finger on a card presses it once, from the map', pressed.length === 1 && pressed[0] === 'map', pressed.join(','));
      } else ok('a finger on a card presses it (no TouchEvent here: checked by its record)', _mapTouchPress.get(nodeG).length === 1);
    } finally { window.touchPress = realPress; }

    // ---- 5. The pin ----
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pane = el('canvasContainer'), svg = el('networkCanvas');
    ok('the map is pinned to its pane\'s size in pixels', svg.style.width === `${pane.clientWidth}px` && svg.style.height === `${pane.clientHeight}px`,
      `${svg.style.width} x ${svg.style.height} / ${pane.clientWidth} x ${pane.clientHeight}`);
    const svgFile = canvasSvgMarkup(1);
    const head = svgFile && svgFile.markup.slice(0, svgFile.markup.indexOf('>') + 1);
    ok('an export does not carry the pin', !!head && !/style=/.test(head) && /width="/.test(head), head);

    // ---- 6. The fields settle ----
    const realDraw = window.renderCanvasOnly;
    let draws = 0;
    window.renderCanvasOnly = function () { draws++; return realDraw.apply(this, arguments); };
    try {
      const sw = state.nodes.find((n) => n.type === 'switch' && el(`ui-node-${n.id}`));
      select(sw.id, 'node');
      window.TOPO_COALESCE = true;
      _lastCanvasMs = 999;   // as a slow map's last redraw left it
      cancelTypedRender();
      draws = 0;
      const input = el('propName');
      const word = 'settled';
      for (let i = 1; i <= word.length; i++) { input.value = word.slice(0, i); input.dispatchEvent(new Event('input', { bubbles: true })); }
      const label = () => [...el(`ui-node-${sw.id}`).querySelectorAll('text')].map((t) => t.textContent);
      ok('on a slow map the keystrokes draw nothing', draws === 0 && typedDraw.waiting(), String(draws));
      ok('but the name under the device follows them', label().includes(word), label().join('|'));
      ok('and the model has every key', getNode(sw.id).name === word);
      await wait(TYPED_SETTLE_MS + 60);
      ok('a pause draws once', draws === 1 && !typedDraw.waiting(), String(draws));
      input.value = word + '!'; input.dispatchEvent(new Event('input', { bubbles: true }));
      ok('the next key waits again', draws === 1 && typedDraw.waiting(), String(draws));
      flushTypedRender();
      ok('and a flush draws it at once', draws === 2 && !typedDraw.waiting(), String(draws));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      cancelTypedRender();
      // A small map: every key draws, as before.
      const co = redrawCoalescer(() => { draws++; }, { settle: 300, slow: () => false });
      draws = 0;
      window.TOPO_COALESCE = false;
      co.ask(); co.ask(); co.ask();
      ok('with the coalescer off every ask draws', draws === 3, String(draws));
      window.TOPO_COALESCE = true;
      draws = 0;
      const fast = redrawCoalescer(() => { draws++; }, { settle: 300 });
      fast.ask();
      ok('a map not yet slow draws its first key at once', draws === 1, String(draws));
      fast.cancel();
    } finally { window.renderCanvasOnly = realDraw; window.TOPO_COALESCE = false; }

    // ---- 7. Writes only when they change ----
    applyCamera();
    const cc = el('canvasContainer');
    let writes = 0;
    const realSet = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (k) { if (k === '--grid' || k === '--grid-major') writes++; return realSet.apply(this, arguments); };
    try { state.camera.x += 5; applyCamera(); } finally { CSSStyleDeclaration.prototype.setProperty = realSet; }
    ok('a pan writes no grid spacing', writes === 0 && cc.style.getPropertyValue('--grid') !== '', String(writes));
    const seen = [];
    const mo = new MutationObserver((list) => list.forEach((m) => seen.push(`${m.target.id}:${m.attributeName}`)));
    mo.observe(el('selBar'), { attributes: true });
    mo.observe(el('linkBanner'), { attributes: true });
    renderCanvasOnly();
    await new Promise((r) => setTimeout(r, 0));
    seen.push(...mo.takeRecords().map((m) => `${m.target.id}:${m.attributeName}`));
    mo.disconnect();
    ok('a redraw that changes nothing on them writes nothing to the bars', seen.length === 0, seen.join(','));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.TOPO_COALESCE = held.coalesce; window.TOPO_CHECKS = held.checks;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
