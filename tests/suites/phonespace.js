// @realtime @touch 360x780
// A phone's screen space (Mobile review batch 5: M30, M32, M33, M38), at
// 360x780 and again at 390x844, by touch:
//   M30 the document bar shows in full the first time a network is on
//       screen and folds into a 44px chip at the first touch on the map, a
//       selection, or after DOCBAR_FOLD_MS (js/library.js); the chip steps
//       aside for the selection bar, so the bars at the bottom (document,
//       selection, handy) cover 20% of the screen or less; Keep in the chip
//       keeps the network; the zoom column stands above the handy bar.
//   M32 the table's sub-tabs fade at the edge where more lie past it
//       (data-more) and a tab chosen is scrolled fully into the row.
//   M33 the tick, twist and Name columns stay put while the grid scrolls
//       sideways, and take 60% of the box or less.
//   M38 below the readable zoom the address lines under the devices go,
//       the selected device's excepted; at 1:1 they are back, and the SVG
//       export holds every address whatever the zoom.
// touchland covers a phone held sideways (M31).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(40); };
  const tap = async (x, y) => {
    await window.__touch('touchStart', [{ x, y, id: 1 }]);
    await window.__touch('touchEnd', []);
    await settle(); await wait(120);
  };
  const tapEl = async (e) => { const r = e.getBoundingClientRect(); await tap(r.left + r.width / 2, r.top + r.height / 2); };
  const shown = (e) => !!e && !e.classList.contains('hidden') && !e.hidden && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  const rect = (e) => e.getBoundingClientRect();
  const json = (v) => JSON.stringify(v);
  // The top of the bars at the bottom: what they cover, as a share of the height.
  const stackShare = () => {
    const tops = ['docBar', 'selBar', 'handyBar'].map(el).filter(shown).map((e) => rect(e).top);
    return tops.length ? (innerHeight - Math.min(...tops)) / innerHeight : 0;
  };
  const docBar = el('docBar');
  const chip = () => docBar.classList.contains('docbar-chip');
  // An empty spot on the map, in the strip the bars leave.
  const emptySpot = () => {
    const v = mapViewport(), c = rect(el('networkCanvas'));
    const nodes = [...document.querySelectorAll('[id^="ui-node-"]')].map(rect);
    for (let y = c.top + v.top + 20; y < c.top + v.top + v.height - 20; y += 24) {
      for (let x = 24; x < innerWidth - 90; x += 24) {
        if (!nodes.some((r) => x > r.left - 30 && x < r.right + 30 && y > r.top - 30 && y < r.bottom + 50)) {
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit.id === 'networkCanvas' || hit.closest('#networkCanvas')) && !hit.closest('[id^="ui-node-"], .grp-frame, .netline, [class*="link"]')) return [x, y];
        }
      }
    }
    return null;
  };
  const tapDevice = async (pred) => {
    const v = mapViewport(), c = rect(el('networkCanvas'));
    const n = state.nodes.filter(pred).map((d) => el('ui-node-' + d.id)).filter(Boolean).find((g) => {
      const r = rect(g), y = r.top + r.height / 2, x = r.left + r.width / 2;
      return x > 20 && x < innerWidth - 80 && y > c.top + v.top + 10 && y < c.top + v.top + v.height - 10;
    });
    if (n) await tapEl(n);
    return n;
  };
  const openExample = async () => {
    replaceDocument(templatesData.house, { origin: 'template' });
    setView('map');
    select(null, null);
    fitToView(null, { initial: true });
    await settle(); await wait(150);
  };

  const bottomBars = async (size) => {
    // ---- M30: the document bar's first showing, its fold, the chip ----
    await openExample();
    ok(`${size}: the example opens on the map with the document bar in full`, shown(docBar) && !chip() && docBar.classList.contains('unkept')
      && shown(el('docBarStatus')) && /example/i.test(el('docBarStatus').textContent), docBar.className);
    const zc = rect(document.querySelector('.zoom-ctl')), hb = rect(el('handyBar'));
    ok(`${size}: the zoom column stands above the handy bar, not over it`, zc.bottom <= hb.top + 0.5 && zc.top >= rect(el('canvasContainer')).top, json([zc.top, zc.bottom, hb.top]));
    const spot = emptySpot();
    ok(`${size}: an empty spot on the map is found`, !!spot, json(spot));
    if (spot) await tap(spot[0], spot[1]);
    const cr = rect(docBar);
    ok(`${size}: a touch on the map folds the bar into a 44px chip`, chip() && cr.height >= 43.5 && cr.height <= 50, `${docBar.className} ${cr.height}`);
    ok(`${size}: the chip shows Keep only, its sentence gone`, !shown(el('docBarStatus')) && shown(el('docBarKeep'))
      && shown(document.querySelector('#docBarKeep .docbar-keep-short')) && !shown(document.querySelector('#docBarKeep .docbar-keep-long'))
      && el('docBarKeep').getAttribute('aria-label') === 'Keep this network', el('docBarKeep').textContent);
    ok(`${size}: the chip's Keep is 44x44 or more`, rect(el('docBarKeep')).height >= 44 && rect(el('docBarKeep')).width >= 44, json(rect(el('docBarKeep'))));
    ok(`${size}: folded, the bars cover 20% of the screen or less`, stackShare() <= 0.2, stackShare().toFixed(3));
    const g = await tapDevice((n) => n.type === 'router');
    ok(`${size}: a device tapped shows the selection bar`, !!g && shown(el('selBar')), g && g.id);
    ok(`${size}: the chip steps aside for the selection bar`, !shown(docBar), getComputedStyle(docBar).display);
    ok(`${size}: with a device selected the bars cover 20% of the screen or less`, stackShare() <= 0.2, stackShare().toFixed(3));
    select(null, null); await settle(); await wait(80);
    ok(`${size}: the selection cleared, the chip is back`, shown(docBar) && chip());
    // A re-render keeps the fold (an edit, a save status).
    renderDocBar();
    ok(`${size}: a redraw keeps the chip`, chip());
    // A selection folds a new network's bar too.
    await openExample();
    ok(`${size}: another network shows its bar in full again`, shown(docBar) && !chip());
    await tapDevice((n) => n.type === 'router');
    select(null, null); await settle(); await wait(80);
    ok(`${size}: a selection folds it`, chip());
  };

  try {
    await __media('reduce');
    await document.fonts.ready;
    ok('this page is a 360x780 touch screen', navigator.maxTouchPoints > 0 && innerWidth === 360 && innerHeight === 780, `${innerWidth}x${innerHeight}`);
    const savedLib = typeof loadLibrary === 'function' ? loadLibrary() : null;
    try { sessionStorage.removeItem('topo_docbar_shown'); } catch (e) { /* private mode */ }
    if (document.body.classList.contains('landing-open')) closeLanding();

    await bottomBars('360');

    // The timer: a network nobody touches folds by itself.
    await openExample();
    ok('360: untouched, the bar is in full at first', !chip());
    await wait(DOCBAR_FOLD_MS + 300);
    ok('360: untouched, it folds by itself after a few seconds', chip(), String(DOCBAR_FOLD_MS));

    // Keep in the chip keeps the network; the kept chip is its name.
    persistLibrary({});
    const realPrompt = window.askPrompt;
    window.askPrompt = async () => 'Casa Roma';   // the name it asks for
    try { await tapEl(el('docBarKeep')); } finally { window.askPrompt = realPrompt; }
    await settle(); await wait(150);
    ok('360: Keep in the chip keeps the network', isKept() && !docBar.classList.contains('unkept'), String(state.libraryId));
    ok('360: just kept, the bar says so in full', !chip() && shown(el('docBarStatus')) && shown(el('docBarName')), el('docBarStatus').textContent);
    foldDocBar();
    const nr = rect(el('docBarName'));
    ok('360: the kept chip is the name, 44 tall', chip() && shown(el('docBarName')) && !shown(el('docBarStatus')) && nr.height >= 44, `${nr.width}x${nr.height}`);

    // ---- M32: the table's sub-tabs ----
    setView('table'); await settle(); await wait(100);
    const row = document.querySelector('#tableView .tv-tabs');
    ok('M32: the sub-tabs outrun the row at 360', row.scrollWidth > row.clientWidth + 1, `${row.scrollWidth} > ${row.clientWidth}`);
    ok('M32: at the start the row fades at its end only', row.getAttribute('data-more') === 'end', row.getAttribute('data-more'));
    const groups = row.querySelector('[data-tvtab="groups"]');
    // A thumb taps the part that shows, at the faded edge.
    // (A toast over the row, the Keep above's, is waited out.)
    const tapShown = async (b, r) => {
      const br = rect(b), xr = rect(r), x = Math.min(br.left + br.width / 2, xr.right - 10), y = br.top + br.height / 2;
      for (let i = 0; i < 50 && !b.contains(document.elementFromPoint(x, y)); i++) await wait(100);
      await tap(x, y);
    };
    await tapShown(groups, row);
    await settle(); await wait(100);
    const rr = rect(row), gr = rect(groups);
    ok('M32: Groups tapped is fully inside the row', groups.classList.contains('active') && gr.left >= rr.left - 0.5 && gr.right <= rr.right + 0.5, json([gr.left, gr.right, rr.left, rr.right, groups.className, _tv.tab, row.scrollLeft, row.dataset.revealed]));
    row.scrollLeft = row.scrollWidth; row.dispatchEvent(new Event('scroll')); await settle();
    ok('M32: scrolled to its end the row fades at its start only', row.getAttribute('data-more') === 'start', row.getAttribute('data-more'));
    const dev = row.querySelector('[data-tvtab="devices"]');
    row.scrollLeft = 0; row.dispatchEvent(new Event('scroll')); await settle();
    await tapEl(dev); await settle();
    ok('M32: back on Devices the row fades at its end', dev.classList.contains('active') && row.getAttribute('data-more') === 'end', row.getAttribute('data-more'));

    // ---- M33: the pinned columns ----
    const scroller = el('tvScroll');
    const pinned = () => ['.tv-chk', '.tv-exp', '.tv-key'].map((s) => {
      const th = scroller.querySelector('thead th' + s), td = scroller.querySelector('tbody tr td' + s);
      return th && td ? [rect(th).left, rect(td).left, rect(th).right] : null;
    });
    scroller.scrollLeft = 0; await settle();
    const before = pinned();
    scroller.scrollLeft = 600; await settle();
    const after = pinned();
    ok('M33: the grid scrolls sideways', scroller.scrollLeft > 100, String(scroller.scrollLeft));
    ok('M33: the tick, twist and Name columns stay put, head and rows', before.every(Boolean) && before.every((b, i) => Math.abs(b[0] - after[i][0]) < 1 && Math.abs(b[1] - after[i][1]) < 1), json([before, after]));
    const box = rect(scroller);
    const share = (before[2][2] - box.left) / box.width;
    ok('M33: the pinned columns take 60% of the box or less', share <= 0.6, share.toFixed(3));
    scroller.scrollLeft = 0;

    // ---- M38: address lines at a phone's zoom ----
    setView('map'); select(null, null); await settle();
    const ips = () => [...document.querySelectorAll('#canvasContainer .node-ip')];
    const visibleIps = () => ips().filter((t) => getComputedStyle(t).display !== 'none');
    fitToView(); await settle();
    ok('M38: Fit on the example is below the readable zoom', state.camera.zoom < IP_MIN_ZOOM, String(state.camera.zoom));
    ok('M38: below it the address lines go', ips().length > 2 && el('canvasContainer').classList.contains('lod-far') && !visibleIps().length, `${ips().length} / ${visibleIps().length}`);
    const router = state.nodes.find((n) => n.type === 'router');
    select(router.id, 'node'); await settle(); await wait(60);
    const vis = visibleIps();
    ok('M38: the selected device keeps its addresses', vis.length > 0 && vis.every((t) => t.closest('#ui-node-' + router.id)), `${vis.length}`);
    const svgMarkup = canvasSvgMarkup(1).markup;
    const ipCount = (svgMarkup.match(/class="node-ip"/g) || []).length;
    ok('M38: the SVG export holds every address whatever the zoom', ipCount === ips().length && !/node-sel/.test(svgMarkup), `${ipCount} of ${ips().length}`);
    select(null, null);
    state.camera.zoom = 1; applyCamera(); await settle();
    ok('M38: at 1:1 the address lines are back', !el('canvasContainer').classList.contains('lod-far') && visibleIps().length === ips().length, `${visibleIps().length} of ${ips().length}`);

    // ---- 390x844 ----
    await __viewport(390, 844); await wait(300); await settle();
    ok('the screen is now 390x844', innerWidth === 390 && innerHeight === 844, `${innerWidth}x${innerHeight}`);
    await bottomBars('390');
    setView('table'); await settle(); await wait(100);
    const row2 = document.querySelector('#tableView .tv-tabs');
    const wifi = row2.querySelector('[data-tvtab="wifi"]:not(.hidden)') || row2.querySelector('[data-tvtab="groups"]');
    // Wi-Fi lies wholly past the edge at 390: a thumb swipes the row a little, then taps it.
    row2.scrollLeft = 20; row2.dispatchEvent(new Event('scroll')); await settle();
    await tapShown(wifi, row2); await settle(); await wait(100);
    ok('390: the last tab tapped is fully inside the row', wifi.classList.contains('active') && rect(wifi).right <= rect(row2).right + 0.5 && rect(wifi).left >= rect(row2).left - 0.5, json([rect(wifi).left, rect(wifi).right, rect(row2).right, wifi.dataset.tvtab, _tv.tab, row2.scrollLeft, row2.scrollWidth, row2.clientWidth]));
    setView('map');

    ok('no sideways scroll', document.scrollingElement.scrollWidth <= innerWidth, String(document.scrollingElement.scrollWidth));
    ok('no console error', !errors.length, errors.slice(0, 3).join(' | '));
    if (savedLib) persistLibrary(savedLib); else persistLibrary({});
  } catch (e) {
    ok('the suite ran to its end', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
