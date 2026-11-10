// @realtime @touch 360x780
// Touch targets on a phone, part 2 of 3 (Mobile review M60, batch 4 M24, M28):
// the table on each of its tabs, its Columns menu and Paste a column, one tap on
// a tick's cell ticking its row exactly once; the search's tools with a search
// on; the rack view on the Datacenter template's A01 at 1x, 2x and 3x, its
// head, elevation and patch schedule. Through tests/fixtures/touchaudit.js, as
// tests/suites/touchsizes.js says.
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
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
  const tap = async (x, y) => {
    await window.__touch('touchStart', [{ x, y, id: 1 }]);
    await window.__touch('touchEnd', []);
    await settle(); await wait(120);
  };
  const screen = async (label, scroller) => {
    await document.fonts.ready; await settle();
    const lines = new Set();
    let measured = 0;
    const once = () => { const r = window.touchAudit(label); r.lines.filter((l) => !/^screen not reached/.test(l)).forEach((l) => lines.add(l)); measured += r.measured; };
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
      const top = scroller.scrollTop;
      const step = Math.max(80, scroller.clientHeight - 160);
      for (let y = 0, i = 0; i < 40; y += step, i++) {
        scroller.scrollTop = y; await settle();
        once();
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) break;
      }
      scroller.scrollTop = top; await settle();
    } else once();
    if (!measured) lines.add('screen not reached: no control measured');
    ok(label + ': every target 44x44, every field 16px and 44 tall, nothing past the edge', !lines.size, [...lines].slice(0, 12).join(' | '));
  };
  const savedView = state.settings.view;

  try {
    await __media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    ok('this page is a 360x780 touch screen', navigator.maxTouchPoints > 0 && innerWidth === 360 && innerHeight === 780, `${innerWidth}x${innerHeight}`);
    replaceDocument(templatesData.house, { origin: 'template' });
    select(null, null);

    // ---- The table, each tab ----
    setView('table');
    await settle(); await wait(150);
    const scroll = el('tvScroll');
    for (const tt of ['devices', 'interfaces', 'cables', 'ports', 'subnets', 'groups', 'wifi']) {
      const b = document.querySelector(`[data-tvtab="${tt}"]`);
      if (!b || b.hidden || b.classList.contains('hidden')) continue;
      b.click(); await settle();
      // The tab bar scrolls sideways: the tab tapped is in it.
      b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await screen(`table: ${tt}`, scroll);
    }
    document.querySelector('[data-tvtab="devices"]').click(); await settle();
    // A row is a finger's height (decision D3).
    const td = document.querySelector('#tvGrid tbody tr[data-row] td.tv-cell');
    ok('a table row is 44 tall on a touch screen', !!td && td.getBoundingClientRect().height >= 43.5, td && `${td.getBoundingClientRect().height}`);
    // A tap on the tick's cell beside the box ticks the row once.
    const cell = document.querySelector('#tvGrid tbody tr[data-row] td.tv-chk[data-hitbox]');
    const box = cell && cell.querySelector('input');
    if (cell && box) {
      const was = box.checked;
      const r = cell.getBoundingClientRect();
      await tap(r.left + 4, r.top + r.height / 2);
      ok('a tap in the tick\'s cell, beside the box, ticks its row once', box.checked === !was, `${was} -> ${box.checked}`);
      await wait(450);
      await tap(r.left + 4, r.top + r.height / 2);
      const again = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const box2 = again && again.closest('td') && again.closest('td').querySelector('input');
      ok('and a second tap unticks it', !!box2 && box2.checked === was);
    } else ok('the tick column marks its cells as a hit box', false);
    // A finger 3-4px inside any edge of a tick's cell ticks that row (the
    // head's: every row), never the row beside it nor the twist (the
    // browser's touch adjustment steered such taps next door before).
    {
      const ticks = () => [...document.querySelectorAll('#tvGrid tbody tr[data-row]:not(.tv-sub) input[data-check]')].map((c, i) => c.checked ? i : -1).filter((i) => i >= 0).join(',');
      const nRows = () => document.querySelectorAll('#tvGrid tbody tr[data-row]').length;
      // The cells are found again after each reset: a redraw (the count's
      // "Selected: n") can move the grid.
      const cellAt = (k) => (k === 0 ? document.querySelector('#tvGrid th.tv-chk[data-hitbox]') : document.querySelectorAll('#tvGrid tbody tr[data-row]:not(.tv-sub) td.tv-chk[data-hitbox]')[k - 1]);
      const total = document.querySelectorAll('#tvGrid tbody tr[data-row]:not(.tv-sub)').length;
      const bad = [];
      for (const k of [0, 1, 2]) {
        const want = k === 0 ? [...Array(total).keys()].join(',') : String(k - 1);
        for (const side of ['top', 'bottom', 'left', 'right']) {
          checkRows(_tv.rows.filter((w) => !w.sub), false); renderTableView(true); await settle(); await wait(400);
          const r = cellAt(k).getBoundingClientRect();
          const [x, y] = { top: [r.left + r.width / 2, r.top + 4], bottom: [r.left + r.width / 2, r.bottom - 4], left: [r.left + 3, r.top + r.height / 2], right: [r.right - 3, r.top + r.height / 2] }[side];
          const rows0 = nRows();
          await tap(x, y); await wait(150);
          const got = ticks();
          if (got !== want || nRows() !== rows0) bad.push(`${k ? 'row ' + (k - 1) : 'head'} ${side}: ticked [${got}] want [${want}], rows ${rows0}->${nRows()}`);
        }
      }
      checkRows(_tv.rows.filter((w) => !w.sub), false); renderTableView(true); await settle();
      ok('a tap 3-4px inside each edge of a tick\'s cell ticks that row only', !bad.length, bad.join(' | '));
    }
    // Columns and Paste a column.
    for (const id of ['tvColsBtn', 'tvPasteBtn']) {
      const b = el(id);
      if (!b || !b.getClientRects().length) continue;
      b.click(); await settle(); await wait(120);
      const dlg = document.querySelector('.modal-scrim:not(.hidden):not([hidden]) .modal');
      await screen(`table: ${id} open`, dlg ? dlg.querySelector('.modal-body') : null);
      await window.__key('Escape'); await settle();
      if (b.getAttribute('aria-expanded') === 'true') b.click();
      await settle();
    }

    // ---- The search's tools ----
    setView('map'); await settle();
    const q = el('queryInput');
    q.value = 'type:switch'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(); await wait(200);
    ok('the search tools show', el('queryTools').classList.contains('q-on'));
    await screen('map: search tools with "type:switch"');
    q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    // ---- The rack: Datacenter, A01 ----
    replaceDocument(templatesData.datacenter, { origin: 'template' });
    await settle();
    setView('rack'); await settle(); await wait(200);
    const pick = el('rackPicker');
    const opt = pick && [...pick.options].find((o) => /A01/.test(o.textContent));
    if (opt) { pick.value = opt.value; pick.dispatchEvent(new Event('change', { bubbles: true })); }
    await settle(); await wait(200);
    ok('the rack view shows A01', document.body.classList.contains('rack-view') && !!opt);
    const body = document.querySelector('.rk-body');
    const unit = document.querySelector('.rk-free, .rk-dev');
    ok('a 1U box at 1x is 44 tall', !!unit && document.querySelector('.rk-dev[style*="--h: 1"], .rk-dev[style*="--h:1"]') ? document.querySelector('.rk-dev[style*="--h: 1"], .rk-dev[style*="--h:1"]').getBoundingClientRect().height >= 43.5 : true,
      unit && `${unit.getBoundingClientRect().height}`);
    await screen('rack A01 at 1x', body);
    for (const z of ['2', '3']) {
      const b = [...document.querySelectorAll('#rackZoom button')].find((x) => x.textContent.trim().startsWith(z));
      if (!b) continue;
      b.click(); await settle(); await wait(120);
      await screen(`rack A01 at ${z}x`, body);
    }
    const one = [...document.querySelectorAll('#rackZoom button')].find((x) => x.textContent.trim().startsWith('1'));
    if (one) one.click();
    setView('map');

    ok('no console error', !errors.length, errors.slice(0, 4).join(' | '));
  } catch (e) {
    ok('the suite ran to its end', false, String(e && e.stack || e).slice(0, 300));
  }
  try { state.settings.view = savedView; } catch (e) { /* none */ }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 400); });
