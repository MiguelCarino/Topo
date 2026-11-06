// @realtime
// The docked rail on a desktop, as it was before the phone's drawer became one
// scroller (Mobile batch 2; css/app.css "The phone's drawer as one
// scroller"). @realtime for its window, not for Web Crypto: run.sh's own
// headless Chromium is 780px wide, which is a phone to the breakpoint, and
// run-cross.mjs opens a 1280x720 desktop page. What is held here is that the
// phone's rules stay below 900px:
//   1. the rail itself does not scroll; the library takes what is left
//      (flex 1) and scrolls on its own, and the selection panel is a fixed
//      half of the rail that scrolls on its own;
//   2. with the library folded (something selected), the panel takes the
//      rest of the rail and still scrolls on its own;
//   3. the panel tabs are not sticky, the port list keeps its 320px box, and
//      the drawer's Controls header (with its ✕) is not shown;
//   4. a palette click adds the device where it always did, connected to the
//      selection, and Note opens its editor (the phone's paths are not taken);
//   5. 'Close controls' is translated in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const cs = (node) => getComputedStyle(node);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  try {
    ok('this run is wider than the phone breakpoint', !matchMedia('(max-width: 900px)').matches, String(innerWidth));
    const rail = document.querySelector('.topo-rail');
    const lib = document.querySelector('.rail-lib');
    const props = document.querySelector('.rail-props');
    setView('map');
    select(null, null);
    await tick();

    // ---- 1. Nothing selected ----
    ok('the rail itself does not scroll', cs(rail).overflowY === 'hidden', cs(rail).overflowY);
    ok('the library takes what is left', cs(lib).flexGrow === '1' && cs(lib).overflowY === 'auto', cs(lib).flexGrow + ' ' + cs(lib).overflowY);
    const half = Math.abs(props.getBoundingClientRect().height - rail.clientHeight / 2) <= 2;
    ok('the panel is a fixed half of the rail', half, props.getBoundingClientRect().height + ' of ' + rail.clientHeight);
    ok('and scrolls on its own', cs(props).overflowY === 'auto', cs(props).overflowY);

    // ---- 2. Folded ----
    const sw = spawnNode('switch');
    await tick();
    ok('a selection folds the library', rail.classList.contains('lib-wrapped'));
    ok('the panel then takes the rest of the rail', cs(props).flexGrow === '1' && cs(props).overflowY === 'auto', cs(props).flexGrow + ' ' + cs(props).overflowY);
    ok('and the rail still does not scroll', rail.scrollHeight <= rail.clientHeight + 1, rail.scrollHeight + ' ' + rail.clientHeight);

    // ---- 3. The phone's rules stay off ----
    const tabs = props.querySelector('.cfg-tabs');
    ok('the panel tabs are not sticky', cs(tabs).position === 'static', cs(tabs).position);
    const cnt = el('portCountInput');
    if (cnt) { cnt.value = '48'; cnt.dispatchEvent(new Event('input', { bubbles: true })); }
    if (el('portCountInput')) el('portCountInput').blur();
    await tick();
    const pl = document.querySelector('.port-attr-list');
    ok('the port list keeps its own 320px box', !!pl && cs(pl).maxHeight === '320px' && cs(pl).overflowY === 'auto', pl && cs(pl).maxHeight + ' ' + cs(pl).overflowY);
    ok('the drawer header exists', !!el('railHead') && !!el('railClose'));
    ok('and is not shown on a desktop', cs(el('railHead')).display === 'none', cs(el('railHead')).display);

    // ---- 4. The palette ----
    const n0 = state.nodes.length, l0 = state.links.length, u0 = _undoStack.length;
    const pcBtn = document.querySelector('#nodePalette .palette-item[data-type="pc"]') || document.querySelector('#nodePalette .palette-item[data-type]');
    pcBtn.click();
    await tick();
    const added = state.nodes[state.nodes.length - 1];
    ok('a palette click adds one device', state.nodes.length === n0 + 1 && _undoStack.length === u0 + 1, `${state.nodes.length - n0} / ${_undoStack.length - u0}`);
    ok('connected to the selected one, below it', state.links.length === l0 + 1 && added.y >= sw.y + 120, `${added.y} vs ${sw.y}`);
    ok('and selected', state.selectedId === added.id);
    ok('the library still folds after a palette click (the phone\'s hold is off)', rail.classList.contains('lib-wrapped'));
    ok('the rail has no scroll padding for sticky rows', cs(rail).scrollPaddingTop === 'auto', cs(rail).scrollPaddingTop);
    const propsTop = props.scrollTop = 200;
    el('diagTabBtn').click();
    ok('a panel tab click leaves the panel\'s own scroll alone', rail.scrollTop === 0 && props.scrollTop <= propsTop, rail.scrollTop + ' ' + props.scrollTop);
    el('configTabBtn').click();
    const noteBtn = [...document.querySelectorAll('#nodePalette .palette-item')].find((b) => !b.dataset.type && /Note/.test(b.textContent));
    const a0 = state.annotations.length;
    noteBtn.click();
    await tick();
    ok('Note adds a note with its editor open', state.annotations.length === a0 + 1 && !!el('annEditor'));
    const a = state.annotations[state.annotations.length - 1];
    const r = el('networkCanvas').getBoundingClientRect();
    const cx = (r.width / 2 - state.camera.x) / state.camera.zoom, cy = (r.height / 2 - state.camera.y) / state.camera.zoom;
    ok('at the centre of the canvas, as before', Math.abs(a.x - cx) <= GRID_SNAP && Math.abs(a.y - cy) <= GRID_SNAP, `${a.x},${a.y} vs ${cx},${cy}`);
    el('annEditor').innerText = 'Desk note';
    window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await tick();

    // ---- 5. Translated ----
    const I = window.CarinoI18N;
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => ok(`'Close controls' in ${loc}`, I.has(loc, 'Close controls')));
  } catch (e) {
    ok('the suite ran without throwing', false, e && e.stack);
  }
  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 50); });
