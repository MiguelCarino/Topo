// The rack view's edge scroll and reveal, one helper each (js/rackview.js
// rvEdgeScroll, rvRevealIn): a drag near the units' pane's top or bottom
// scrolls it a step, and a box or a row brought into sight is centred where
// it fits. The suite runs in the default 800px window, the narrow layout,
// with a 42U rack at 1x scrolled to its middle.
//   1. rvEdgeScroll on its edges: the band inside the pane, how far past its
//      top and bottom it reaches, the columns, the pane's ends, no pane;
//   2. rvRevealIn: in sight, nothing; short, centred; tall, its top at the
//      pane's top plus the pad; under a sticky header (the inset) is out;
//   3. the call sites as they were: a row brought in scrolls near the top,
//      not beside the pane, and up to 40px under its bottom; a box moved
//      10px under the bottom does not (the targets are there); a cable from
//      a port waits for 24px of travel; a box revealed on a rebuild is
//      centred;
//   4. the drift fixed: a cable from a plug inside the bottom band used to
//      scroll the pane 14px on the first move, the plug sliding away under
//      the pointer; now it waits for 24px of travel, as a port's does.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  let heldZoom = null;
  try { heldZoom = localStorage.getItem('topo.rackZoom'); } catch (e) { /* blocked */ }

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }], group: 'rk' }, extra);
  const view = () => el('rackView');
  const pane = () => view().querySelector('.rk-main');
  const dev = (id) => view().querySelector(`.rk-dev:not(.rk-back)[data-node="${id}"]`);
  const ptr = (type, target, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9, pointerType: 'mouse', isPrimary: true }));
  const mid = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const maxTop = () => pane().scrollHeight - pane().clientHeight;
  const toMid = () => { pane().scrollTop = Math.round(maxTop() / 2); return pane().scrollTop; };
  // rvEdgeScroll from the pane's middle (or `from`): [what it returned, how far the pane went].
  const es = (x, y, opts, from) => {
    if (from === undefined) toMid(); else pane().scrollTop = from;
    const s0 = pane().scrollTop;
    const moved = opts ? rvEdgeScroll(x, y, opts) : rvEdgeScroll(x, y);
    return [moved, pane().scrollTop - s0];
  };
  // rvRevealIn on the pane from `from`: how far it scrolled.
  const rv = (top, bottom, opts, from) => {
    pane().scrollTop = from;
    const s0 = pane().scrollTop;
    rvRevealIn(pane(), top, bottom, opts);
    return pane().scrollTop - s0;
  };

  try {
    replaceDocument({ v: DOC_VERSION, nodes: [
      N('s38', 'server', { rackU: 38, rackHeight: 2 }), N('s30', 'server', { rackU: 30, rackHeight: 2 }),
      N('sw', 'switch', { rackU: 22, rackHeight: 2, portCount: 8, rackDepth: 'half', interfaces: [] }),
      N('s14', 'server', { rackU: 14, rackHeight: 2 }), N('s6', 'server', { rackU: 6, rackHeight: 2 }),
      N('s2', 'server', { rackU: 2, rackHeight: 2 }), N('loose', 'server')
    ], links: [], groups: [{ id: 'rk', name: 'R', kind: 'rack', uHeight: 42 }] }, { origin: 'file', docId: 'rack-scroll' });
    initHistory();
    setView('rack');
    openRackView('rk');
    select(null);
    setRackZoom(1);
    renderRackView(true);
    let r = pane().getBoundingClientRect();
    const h = r.height, cx = r.left + r.width / 2;
    ok('at 1x, the 42U rack is more than twice the pane\'s height', _rv.zoom === 1 && maxTop() > h + 60, `${pane().scrollHeight} ${h}`);
    toMid();
    r = pane().getBoundingClientRect();

    // ---- 1: rvEdgeScroll ----
    ok('inside the top band: true, up a step', json(es(cx, r.top + 10)) === json([true, -14]), json(es(cx, r.top + 10)));
    ok('39px over the top still scrolls', es(cx, r.top - 39)[0]);
    ok('41px over it does not', json(es(cx, r.top - 41)) === json([false, 0]));
    ok('just under the band, nothing', json(es(cx, r.top + 30)) === json([false, 0]));
    ok('inside the bottom band: down a step', json(es(cx, r.bottom - 10)) === json([true, 14]));
    ok('10px under the bottom: not by default', json(es(cx, r.bottom + 10)) === json([false, 0]));
    ok('with below 40, it does', json(es(cx, r.bottom + 10, { below: 40 })) === json([true, 14]));
    ok('beside the pane\'s columns: not', json(es(r.left - 5, r.top + 10)) === json([false, 0]));
    ok('beside them with inX false: yes', json(es(r.left - 5, r.top + 10, { inX: false })) === json([true, -14]));
    ok('above Infinity reaches 500px over the top', json(es(cx, r.top - 500, { above: Infinity })) === json([true, -14]));
    ok('at the top already, the top edge: false', json(es(cx, r.top + 10, undefined, 0)) === json([false, 0]));
    ok('at the bottom already, the bottom edge: false', json(es(cx, r.bottom - 10, undefined, maxTop())) === json([false, 0]));
    {
      const m = pane(), parent = m.parentNode, next = m.nextSibling;
      m.remove();
      let res = null;
      try { res = rvEdgeScroll(cx, r.top + 10); } finally { parent.insertBefore(m, next); }
      ok('no pane: false', res === false);
    }

    // ---- 2: rvRevealIn ----
    // Measured from the pane's rect at scrollTop 0 and at its end (it does
    // not move as it scrolls), so the scroll has room either way.
    ok('in sight: nothing', rv(r.top + 10, r.top + 50, {}, 0) === 0);
    ok('no scroller: nothing, no throw', (rvRevealIn(null, 0, 10), true));
    {
      const d = rv(r.bottom - 10, r.bottom + 20, {}, 0);
      const t = r.bottom - 10 - d;
      ok('short, past the bottom: centred within 1px', Math.abs(t - (r.top + (h - 30) / 2)) <= 1, `${t} ${r.top} ${h}`);
    }
    ok('taller than the pane: its top at the pane\'s top', rv(r.top + 30, r.top + 30 + h + 10, {}, 0) === 30);
    ok('with pad 8: at the top plus 8', rv(r.top + 30, r.top + 30 + h + 10, { pad: 8 }, 0) === 22);
    ok('under the inset, in sight: nothing', rv(r.top + 25, r.top + 50, { inset: 20 }, maxTop()) === 0);
    {
      const d = rv(r.top + 10, r.top + 40, { inset: 20 }, maxTop());
      const t = r.top + 10 - d;
      ok('half under the inset counts as out: centred below it', d < 0 && Math.abs(t - (r.top + 20 + (h - 20 - 30) / 2)) <= 1, `${d} ${t}`);
    }
    ok('taller than the room under the inset: its top at the inset', rv(r.top + 30, r.top + 30 + h, { inset: 20 }, 0) === 10);

    // ---- 3: the call sites ----
    // A row brought in from Not placed yet.
    const handle = view().querySelector('.rk-handle[data-drag="loose"]');
    ok('the waiting row has its handle', !!handle);
    if (handle) {
      const undoAt = _undoStack.length;
      const [hx, hy] = mid(handle);
      ptr('pointerdown', handle, hx, hy);
      let s0 = toMid();
      r = pane().getBoundingClientRect();
      ptr('pointermove', window, cx, r.top + 10);
      ok('brought in near the pane\'s top, it scrolls up', pane().scrollTop === s0 - 14, `${s0} -> ${pane().scrollTop}`);
      s0 = toMid();
      ptr('pointermove', window, r.left - 5, r.top + 10);
      ok('beside the pane, it does not', pane().scrollTop === s0);
      ptr('pointermove', window, cx, r.bottom + 30);
      ok('30px under its bottom, it scrolls down', pane().scrollTop === s0 + 14, `${s0} -> ${pane().scrollTop}`);
      ptr('pointermove', window, -200, -200);
      ptr('pointerup', window, -200, -200);
      while (_undoStack.length > undoAt) undo();
      ok('(let go off the rack: still waiting)', !Number.isInteger(getNode('loose').rackU));
    }
    // A box moved 10px under the pane's bottom: the targets are there, the
    // pane stays.
    {
      const undoAt = _undoStack.length;
      const s0 = toMid();
      const [x0, y0] = mid(dev('s30'));
      r = pane().getBoundingClientRect();
      ptr('pointerdown', dev('s30'), x0, y0);
      ptr('pointermove', window, x0, y0 + 10);
      ptr('pointermove', window, x0, r.bottom + 10);
      await wait(300);
      ok('a move held 10px under the bottom does not scroll', pane().scrollTop === s0, `${s0} -> ${pane().scrollTop}`);
      ptr('pointermove', window, x0, y0);
      ptr('pointerup', window, x0, y0);
      while (_undoStack.length > undoAt) undo();
      ok('(the box is where it was)', getNode('s30').rackU === 30 && getNode('s30').group === 'rk');
    }
    // Scrolled so `target`'s centre sits 10px inside the pane's bottom.
    const intoBand = (target) => {
      pane().scrollTop = 0;
      r = pane().getBoundingClientRect();
      pane().scrollTop += mid(target)[1] - (r.bottom - 10);
      r = pane().getBoundingClientRect();
      return mid(target);
    };
    // A cable from the switch's free port.
    const port = dev('sw') && dev('sw').querySelector('.rk-port:not(.rk-pcab)');
    ok('the switch has a free port wide enough to drag from', !!port && port.getBoundingClientRect().width >= 4 && !port.closest('.rk-pthin'));
    if (port) {
      const [px, py] = intoBand(port);
      ok('(the port is inside the bottom band)', py > r.bottom - RV_EDGE_BAND && py < r.bottom);
      const undoAt = _undoStack.length, links = state.links.length;
      const s0 = pane().scrollTop;
      ptr('pointerdown', port, px, py);
      ptr('pointermove', window, px, py + 5);
      ok('a port dragged 5px near the edge does not scroll', _rv.drag && _rv.drag.kind === 'port' && pane().scrollTop === s0, `${_rv.drag && _rv.drag.kind} ${s0} -> ${pane().scrollTop}`);
      ptr('pointermove', window, px + 30, r.bottom - 4);
      ok('past 24px, it does', pane().scrollTop === s0 + 14, `${s0} -> ${pane().scrollTop}`);
      ptr('pointermove', window, -200, -200);
      ptr('pointerup', window, -200, -200);
      while (_undoStack.length > undoAt) undo();
      ok('(no cable made)', state.links.length === links);
    }
    // ---- 4: the drift: a cable from a plug inside the bottom band ----
    const plug = dev('s14') && dev('s14').querySelector('.rk-plug');
    ok('the server has its plug', !!plug);
    if (plug) {
      const [gx, gy] = intoBand(plug);
      ok('(the plug is inside the bottom band)', gy > r.bottom - RV_EDGE_BAND && gy < r.bottom, `${gy} ${r.bottom}`);
      const undoAt = _undoStack.length, links = state.links.length;
      const s0 = pane().scrollTop;
      ptr('pointerdown', plug, gx, gy);
      ptr('pointermove', window, gx, gy + 5);
      ok('a cable from a plug moved 5px does not scroll the plug away (it did, 14px)', _rv.drag && _rv.drag.kind === 'cable' && pane().scrollTop === s0,
        `${_rv.drag && _rv.drag.kind} ${s0} -> ${pane().scrollTop}`);
      ptr('pointermove', window, gx + 30, r.bottom - 4);
      ok('more than 24px away at the edge, it scrolls', pane().scrollTop > s0, `${s0} -> ${pane().scrollTop}`);
      ptr('pointermove', window, -200, -200);
      ptr('pointerup', window, -200, -200);
      while (_undoStack.length > undoAt) undo();
      ok('(no cable made)', state.links.length === links);
    }

    // A box revealed on a rebuild (a tap on the units): out of sight below,
    // centred; in sight, the pane stays.
    pane().scrollTop = 0;
    r = pane().getBoundingClientRect();
    ok('(s14 is out of sight at the top of the rack)', dev('s14').getBoundingClientRect().top > r.bottom);
    _rv.reveal = 's14';
    renderRackView(true);
    {
      const b = dev('s14').getBoundingClientRect();
      ok('revealed, it is centred in the pane', Math.abs(b.top - r.top - (h - b.height) / 2) <= 1, `${b.top} ${r.top} ${h} ${b.height}`);
      const s1 = pane().scrollTop;
      _rv.reveal = 's14';
      renderRackView(true);
      ok('revealed again in sight, the pane stays', pane().scrollTop === s1);
      pane().scrollTop = 0;
      renderRackView(true);
      ok('a rebuild with nothing to reveal leaves the pane where it was', pane().scrollTop === 0);
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { if (heldZoom === null) localStorage.removeItem('topo.rackZoom'); else localStorage.setItem('topo.rackZoom', heldZoom); } catch (e) { /* blocked */ }
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
