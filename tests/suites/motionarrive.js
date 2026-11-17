// Things arriving, and the rail's library folding (js/motion.js
// mapMotionArrive, mapPopDrawn, railFoldStart / railFoldPlay):
//   1. in the runner (window.TOPO_MOTION = false) a network opens and the
//      library folds with nothing animated;
//   2. asked for, an opened network pops in: every device and note drawn is
//      animated, later ones starting later, top of the map first; the cables
//      and frames fade in; the devices' transform attributes, the saved
//      document and an SVG export are what they are without motion; nothing
//      is left running once played;
//   3. a network of 620 devices pops in, every one; past 2000 things it
//      fades in as one; the table view animates nothing;
//   4. whatever adds a device, it pops in with its cable and what was already
//      there stays still: spawnNode, a duplicate, a block, an import merged
//      in as a document edit, an undo that brings a deleted device back
//      (once, not twice); a redraw mid-way carries the pop on over the new
//      elements; a redraw of the same map, once played, animates nothing;
//   5. the library folding: while it plays the library is still drawn
//      (.lib-folding) and closing, the panels growing; played, it is gone and
//      nothing is left on the elements; unfolding plays the other way; a
//      second change mid-way starts from a clean rail.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // The runner's clock is virtual: each animation is finished by hand (tests/suites/motion.js).
  const played = async () => { document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* infinite */ } }); _popFlying.clear(); await wait(30); };   // and what the map thinks is still on its way (the virtual clock has barely moved)
  const anims = (e) => (e && e.getAnimations ? e.getAnimations() : []);
  const delayOf = (e) => (anims(e)[0] ? anims(e)[0].effect.getTiming().delay : -1);
  const N = (id, type, x, y, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x, y, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const small = () => ({ v: DOC_VERSION,
    nodes: [N('top', 'router', 300, 0), N('mid', 'switch', 300, 200, { portCount: 8, interfaces: [] }), N('low', 'pc', 300, 400)],
    links: [{ id: 'l1', source: 'top', target: 'mid' }, { id: 'l2', source: 'mid', target: 'low' }],
    annotations: [{ id: 'an1', kind: 'note', x: 500, y: 100, text: 'A note' }] });
  const open = (doc) => replaceDocument(doc, { origin: 'file', docId: 'doc-motionarrive' });
  const rail = () => document.querySelector('.topo-rail');
  const lib = () => rail().querySelector('.rail-lib');
  const pinKey = 'topo-lib-open';
  let pinWas = null;
  try {
    setLocale('en');
    try { pinWas = localStorage.getItem(pinKey); } catch (e) { /* blocked */ }
    setLibraryPinned(false);

    // ---- 1. Off in the runner ----
    open(small());
    ok('motion off: an opened network animates nothing', document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#networkCanvas')).length === 0);
    select('low', 'node');
    ok('motion off: the library folds at once', rail().classList.contains('lib-wrapped') && !rail().classList.contains('lib-folding') && anims(lib()).length === 0);
    select(null, null);

    // ---- 2. A network pops in ----
    window.TOPO_MOTION = true;
    open(small());
    const saved = JSON.stringify(serializeDoc());
    const top = el('ui-node-top'), mid = el('ui-node-mid'), low = el('ui-node-low');
    ok('every device drawn is animated', [top, mid, low].every((e) => anims(e).length === 1));
    const note = el(`ui-ann-${state.annotations[0].id}`);
    ok('a note too', anims(note).length === 1);
    ok('from the top of the map down', delayOf(top) === 0 && delayOf(mid) > delayOf(top) && delayOf(low) > delayOf(mid), `${delayOf(top)} ${delayOf(mid)} ${delayOf(low)}`);
    const frames = anims(top)[0].effect.getKeyframes();
    ok('it grows from small past its size and settles', frames.length === 3 && /scale\(0\.3\)/.test(frames[0].transform) && /scale\(1\.08\)/.test(frames[1].transform)
      && !/scale/.test(frames[2].transform) && frames[0].opacity === '0', JSON.stringify(frames.map((f) => f.transform)));
    ok('the cables fade in behind them', anims(el('layer-links')).length === 1 && anims(el('layer-links'))[0].effect.getTiming().delay > 0);
    ok('the device\'s own transform is its place', top.getAttribute('transform') === `translate(${getNode('top').x}, ${getNode('top').y})`);
    ok('the saved document is what it was', JSON.stringify(serializeDoc()) === saved);
    ok('an SVG export mid-way is the drawing at rest', !/opacity:\s*0/.test(canvasSvgMarkup()) && !/scale\(/.test(canvasSvgMarkup()));
    await played();
    ok('played, nothing is left running on the map', anims(top).length === 0 && anims(el('layer-links')).length === 0 && anims(note).length === 0);

    // ---- 3. A very large network, and the table ----
    const many = { v: DOC_VERSION, nodes: [], links: [] };
    for (let i = 0; i < 620; i++) many.nodes.push(N('n' + i, 'pc', (i % 40) * 110, Math.floor(i / 40) * 130));
    open(many);
    ok('620 devices: every one pops in', many.nodes.every((n) => anims(el('ui-node-' + n.id)).length === 1) && anims(el('layer-nodes')).length === 0);
    await played();
    for (let i = 620; i < 2010; i++) many.nodes.push(N('n' + i, 'pc', (i % 40) * 110, Math.floor(i / 40) * 130));
    open(many);
    ok('past 2000 the map fades in as one', anims(el('ui-node-n0')).length === 0 && anims(el('layer-nodes')).length === 1);
    await played();
    open(small()); await played();
    const viewBtn = el('viewTableBtn') || document.querySelector('[data-view="table"]');
    if (viewBtn) {
      viewBtn.click(); await wait(30);
      open(small());
      ok('in the table view nothing on the map is animated', document.body.classList.contains('table-view') && anims(el('layer-links')).length === 0);
      (el('viewMapBtn') || document.querySelector('[data-view="map"]')).click(); await wait(30);
      await played();
    } else ok('the view switch was found', false);

    // ---- 4. Added to a map already open ----
    open(small()); await played();
    select('mid', 'node');
    const n0 = state.nodes.length, l0 = state.links.length;
    const made = spawnNode('pc', { connectTo: 'mid' });
    ok('a device added pops in', state.nodes.length === n0 + 1 && anims(el(`ui-node-${made.id}`)).length === 1);
    ok('…its cable fades in', state.links.length === l0 + 1 && anims(el(`ui-link-${state.links[l0].id}`)).length === 1);
    ok('…and what was there stays still', anims(el('ui-node-top')).length === 0 && anims(el('ui-node-mid')).length === 0 && anims(el('layer-links')).length === 0);
    await played();
    selectEntries([{ type: 'node', id: 'top' }, { type: 'node', id: 'low' }]);
    const n1 = state.nodes.length;
    duplicateSelection();
    const copies = state.nodes.slice(n1);
    ok('a duplicate pops in, each copy', copies.length === 2 && copies.every((n) => anims(el(`ui-node-${n.id}`)).length === 1) && anims(el('ui-node-top')).length === 0);
    await played();
    const dup = el(`ui-node-${copies[0].id}`);
    ok('a redraw mid-way carries the pop on over the new elements', (() => { duplicateSelection(); const c = state.nodes[state.nodes.length - 1]; const before = el(`ui-node-${c.id}`);
      renderCanvasOnly(); const after = el(`ui-node-${c.id}`); return before !== after && anims(after).length === 1; })());
    await played();
    renderCanvasOnly();
    ok('a redraw of the same map animates nothing', state.nodes.every((n) => anims(el(`ui-node-${n.id}`)).length === 0));
    // Any edit that leaves a new device in the document: here one written straight in, as an import or a merge does.
    batch(() => { state.nodes.push(N('late', 'printer', 700, 400)); state.links.push(bindLink({ id: 'l-late', source: 'mid', target: 'late' })); save(); renderCanvasOnly(); });
    ok('a device put there by any edit pops in, with its cable', anims(el('ui-node-late')).length === 1 && anims(el('ui-link-l-late')).length === 1 && anims(el('ui-node-mid')).length === 0);
    await played();
    batch(() => { state.nodes = state.nodes.filter((n) => n.id !== 'late'); state.links = state.links.filter((l) => l.id !== 'l-late'); save(); renderCanvasOnly(); }); await played();
    ok('deleted, it is gone', !getNode('late') && !el('ui-node-late'));
    undo();
    ok('an undo that brings it back pops it in, once', !!getNode('late') && anims(el('ui-node-late')).length === 1, String(anims(el('ui-node-late')).length));
    await played();
    batch(() => { state.annotations.push({ id: 'an2', kind: 'note', x: 600, y: 300, text: 'Another' }); save(); renderCanvasOnly(); });
    ok('a new note pops in', anims(el('ui-ann-an2')).length === 1 && anims(el('ui-node-late')).length === 0);
    await played();

    // ---- 5. The library folds ----
    open(small()); await played();
    select(null, null); await played();
    const libH = lib().getBoundingClientRect().height;
    select('low', 'node');
    ok('folding: the library is still drawn, closing', rail().classList.contains('lib-wrapped') && rail().classList.contains('lib-folding')
      && getComputedStyle(lib()).display !== 'none' && anims(lib()).length === 1 && libH > 0, `${libH}`);
    const fk = anims(lib())[0] ? anims(lib())[0].effect.getKeyframes() : [];
    ok('…from its height to nothing, fading', fk.length === 2 && Math.abs(parseFloat(fk[0].height) - libH) < 1 && fk[1].height === '0px' && fk[1].opacity === '0', JSON.stringify(fk.map((f) => [f.height, f.opacity])));
    ok('…and never hit on its way out', getComputedStyle(lib()).pointerEvents === 'none');
    await played();
    ok('played: gone, and nothing left on it', !rail().classList.contains('lib-folding') && getComputedStyle(lib()).display === 'none' && anims(lib()).length === 0 && !lib().getAttribute('style'));
    select(null, null);
    ok('unfolding: it opens from nothing', !rail().classList.contains('lib-wrapped') && !rail().classList.contains('lib-folding') && anims(lib()).length === 1
      && anims(lib())[0].effect.getKeyframes()[0].height === '0px');
    select('low', 'node');
    ok('a change mid-way starts from a clean rail', rail().classList.contains('lib-wrapped') && anims(lib()).length <= 1);
    await played();
    ok('…and ends folded, nothing running', getComputedStyle(lib()).display === 'none' && !rail().classList.contains('lib-folding') && anims(lib()).length === 0,
      `${getComputedStyle(lib()).display} / ${rail().className} / ${anims(lib()).length}`);
    select(null, null); await played();
    ok('the library is back, whole', getComputedStyle(lib()).display !== 'none' && Math.abs(lib().getBoundingClientRect().height - libH) < 1, `${lib().getBoundingClientRect().height} ${libH}`);

    window.TOPO_MOTION = false;
    select('low', 'node');
    ok('TOPO_MOTION = false turns it off', rail().classList.contains('lib-wrapped') && !rail().classList.contains('lib-folding') && anims(lib()).length === 0);
    select(null, null);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.TOPO_MOTION = false;
    try { if (pinWas === null) localStorage.removeItem(pinKey); else localStorage.setItem(pinKey, pinWas); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
