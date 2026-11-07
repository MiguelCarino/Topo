// @realtime @touch 360x780 @hashes advanced|simple
// The table's touch hint (Mobile review M20; index.html #tvTouchHint,
// css/app.css .tv-touchhint, js/table.js renderTableView). On a 360x780
// touch screen through window.__touch (real touch input), __key and
// __viewport (run-cross.mjs):
//   1. the page is a touch screen with a coarse pointer;
//   2. on the Devices tab the line shows above the grid, in its English
//      words, with the rack schedule's rail-note look, inside the screen,
//      and the keyboard hint and the Inventory hint do not;
//   3. what the words say, by real taps far enough apart that no dblclick
//      fires: the first tap on the parked cell selects the row and edits
//      nothing, a tap on another cell of that row edits nothing, a second tap
//      on that same cell opens its editor, and two taps on the NAT tick flip
//      it, one undo putting it back;
//   4. it is gone on the read-only Inventory tab and back on Devices;
//   5. it is gone on a read-only network and back on one that can be edited;
//   6. es, pt-BR, ru and ja carry it;
//   7. a print rule hides it (a page cannot switch itself to print media, so
//      the rule is what is checked);
//   8. at 390x844 it still fits, and there is no horizontal scroll at either
//      width.
// In #simple the table is never shown, so neither is the line.
// The desktop side (a mouse never sees it; the keyboard hint is unchanged) is
// held by tests/suites/table.js.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(30); };
  const touch = (type, pts) => window.__touch(type, pts);
  // 500ms after each tap, so two taps on one cell are two clicks and never a
  // dblclick, which would open the editor on its own and prove nothing.
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); await settle(); await wait(500); };
  const mid = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const tapEl = async (node) => { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await settle(); const p = mid(node); await tap(p.x, p.y); };
  const grid = () => el('tvGrid');
  const rowEl = (key) => [...grid().querySelectorAll('tbody tr[data-row]')].find((r) => r.dataset.row === key) || null;
  const cellEl = (key, col) => { const r = rowEl(key); return r ? [...r.querySelectorAll('td[data-col]')].find((td) => td.dataset.col === col) || null : null; };
  const shown = (node) => { if (!node) return false; const r = node.getBoundingClientRect(); return getComputedStyle(node).display !== 'none' && r.width > 0 && r.height > 0; };
  const hint = () => el('tvTouchHint');
  const noSideScroll = () => document.documentElement.scrollWidth <= innerWidth;
  const fits = (where) => {
    const r = hint().getBoundingClientRect();
    ok(`${where}: the hint is inside the screen`, r.left >= 0 && r.right <= innerWidth, json([r.left, r.right, innerWidth]));
    ok(`${where}: no horizontal scroll`, noSideScroll(), `${document.documentElement.scrollWidth} > ${innerWidth}`);
  };
  const KEY = 'Tap a cell to select its row. Tap the same cell again to edit it.';
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  const savedLang = window.CarinoI18N.current();

  try {
    ok('this page is a 360-wide touch screen', innerWidth === 360 && navigator.maxTouchPoints > 0
       && typeof window.__touch === 'function' && matchMedia('(pointer: coarse)').matches,
       `${innerWidth} ${navigator.maxTouchPoints} ${location.hash}`);

    // The app takes the hash off the address once it has read it, so the
    // mode it chose is what tells the two runs apart.
    if (document.body.classList.contains('simple-mode')) {
      // A reduced view never shows the table (#tableView is data-adv), so the
      // line that explains it is never on the screen, even asked for.
      ok('#simple: the hint is not shown', !shown(hint()));
      setView('table'); await settle();
      ok('#simple: nor after the table is asked for', !shown(hint()));
      setView(savedView === 'table' ? 'table' : 'map');
      ok('#simple: no horizontal scroll', noSideScroll(), `${document.documentElement.scrollWidth} > ${innerWidth}`);
      return;
    }

    // ---- 2. Shown, above the grid, in place of the keyboard hint ----
    if (landingIsOpen()) closeLanding();
    const PC = (id, name, x, extra) => Object.assign({ id, type: 'pc', name, x, y: 0, gw: '', dns: '', os: '', notes: '',
      interfaces: [{ id: 'i1', name: 'eth0', ip: `10.0.0.${x / 10 + 10}/24` }] }, extra);
    const doc = () => ({ v: DOC_VERSION, nodes: [
      { id: 'r', type: 'router', name: 'Router', x: 0, y: 0, nat: false, interfaces: [{ id: 'i1', name: 'lan', ip: '10.0.0.1/24' }] },
      PC('a', 'PC A', 100, { vendor: 'Dell' }), PC('b', 'PC B', 200), PC('c', 'PC C', 300)], links: [], annotations: [] });
    replaceDocument(doc(), { origin: 'file', docId: 'touch-table-hint' });
    initHistory();
    setView('table');
    showTableTab('devices');
    await settle();
    ok('the hint shows on Devices', shown(hint()));
    ok('in its English words', hint().textContent.trim() === KEY, hint().textContent);
    ok('with the rack schedule\'s note look', hint().classList.contains('rail-note'));
    ok('above the grid', hint().getBoundingClientRect().bottom <= el('tvScroll').getBoundingClientRect().top + 0.5,
       json([hint().getBoundingClientRect().bottom, el('tvScroll').getBoundingClientRect().top]));
    ok('in place of the keyboard hint', !shown(el('tvHint')) && !shown(el('tvInvHint')));
    fits('360');

    // ---- 3. What the words say ----
    const first = grid().querySelector('tbody td[data-col]');
    const firstRow = rowByKey(first.parentElement.dataset.row);
    // The grid must not move between the two taps: the tick's "Selected: 1"
    // once wrapped the toolbar at 360 and pushed every row down, so a second
    // tap where the finger already was hit the row above (css/app.css,
    // .tv-bar > #tvCount).
    const gridTop0 = el('tvScroll').getBoundingClientRect().top;
    await tapEl(first);
    ok('a first tap on a cell selects its row', state.selectedId === firstRow.ref.nodeId, `${state.selectedId} ${firstRow.ref.nodeId}`);
    ok('and opens nothing', !_tv.editor);
    ok('and the grid stays where it was, so the second tap meets the same cell',
       Math.abs(el('tvScroll').getBoundingClientRect().top - gridTop0) < 0.5,
       json([gridTop0, el('tvScroll').getBoundingClientRect().top]));
    const other = cellEl(firstRow.key, 'os');
    await tapEl(other);
    ok('a tap on another cell of the row opens nothing either', !_tv.editor);
    await tapEl(cellEl(firstRow.key, 'os'));
    ok('a second tap on the same cell opens its editor', !!_tv.editor && _tv.editor.td === cellEl(firstRow.key, 'os'),
       _tv.editor ? `${_tv.editor.rowKey} ${_tv.editor.colKey}` : 'no editor');
    if (_tv.editor) { await window.__key('Escape'); await settle(); }
    ok('Esc closes it', !_tv.editor);
    const n0 = _undoStack.length;
    await tapEl(cellEl('n:r', 'nat'));
    ok('a first tap on a tick leaves it', getNode('r').nat === false);
    await tapEl(cellEl('n:r', 'nat'));
    ok('a second tap on the same tick flips it', getNode('r').nat === true && _undoStack.length === n0 + 1,
       `${getNode('r').nat} ${_undoStack.length - n0}`);
    undo(); await settle();
    ok('and one undo puts it back', !getNode('r').nat);

    // ---- 4. Inventory ----
    showTableTab('inventory'); await settle();
    ok('Inventory is offered and shown', _tv.tab === 'inventory');
    ok('the hint is gone on Inventory, where nothing edits', !shown(hint()));
    showTableTab('devices'); await settle();
    ok('and back on Devices', shown(hint()));

    // ---- 5. A read-only network ----
    replaceDocument(Object.assign(doc(), { v: DOC_VERSION + 1 }), { origin: 'file', docId: 'touch-table-hint-ro' });
    showTableTab('devices'); await settle();
    ok('a read-only network is read-only', !!state.readOnly);
    ok('the hint is gone on a read-only network', !shown(hint()));
    replaceDocument(doc(), { origin: 'file', docId: 'touch-table-hint' });
    showTableTab('devices'); await settle();
    ok('and back on one that can be edited', !state.readOnly && shown(hint()));

    // ---- 6. Languages ----
    const words = {};
    for (const l of ['es', 'pt-BR', 'ru', 'ja']) {
      setLocale(l); applyLocale(); await settle();
      words[l] = hint().textContent.trim();
      ok(`${l} carries the hint`, !!words[l] && words[l] !== KEY, words[l]);
    }
    ok('Spanish words', words.es === 'Toca una celda para seleccionar su fila. Toca la misma celda otra vez para editarla.', words.es);
    setLocale('en'); applyLocale(); await settle();
    ok('English again', hint().textContent.trim() === KEY);

    // ---- 7. Print ----
    let printRule = false;
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r instanceof CSSMediaRule && /print/.test(r.media.mediaText)) {
          for (const inner of r.cssRules) if (inner.selectorText && inner.selectorText.includes('.tv-touchhint') && inner.style.display === 'none') printRule = true;
        }
      }
    }
    ok('a print rule hides the hint', printRule);

    // ---- 8. 390 wide ----
    await window.__viewport(390, 844);
    await settle(); await wait(200);
    ok('the hint still shows at 390', shown(hint()));
    fits('390');
    await window.__viewport(360, 780);
    await settle(); await wait(200);
    fits('360 again');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    try { if (_tv.editor) cancelEdit(true); } catch (e) { /* nothing open to close */ }
    try { setView(savedView === 'table' ? 'table' : 'map'); } catch (e) { /* the view is restored as far as it can be */ }
    try { if (window.CarinoI18N.current() !== savedLang) { setLocale(savedLang); applyLocale(); } } catch (e) { /* English stays */ }
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
