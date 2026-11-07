// @realtime @touch 360x780
// Typing in the table with a finger (Mobile review M19; js/table.js "Typing
// with a finger", css/app.css .tv-next). On a 360x780 touch screen through
// window.__touch (real touch input), __type and __key (run-cross.mjs):
//   1. a tap, then a second tap, on a device's OS cell opens its editor,
//      whose keyboard is a name's and whose Enter says Next;
//   2. typing and Enter keep the value in one undo step and open the cell
//      below, focused, so the keyboard stays up;
//   3. on the last row with an OS cell Enter says Done, keeps the value and
//      closes the editor;
//   4. the → in an open Name cell, and in an open cell beside the pinned
//      Name column made as wide as a phone lets it be by a long name
//      ('Wireless Printer', as on the example network), is 44px or larger,
//      inside the table's scroller and the one thing under its middle, and
//      the open row is no taller than a resting one; a tap keeps the name,
//      the field holding the focus all through the press, and opens the next
//      cell along that takes typing (past the read-only Type and
//      Interfaces), focused, with capitals off;
//   5. a refused gateway and Enter keep that cell open, marked, no chain;
//   6. Enter onto a cell below that is a pick (Group) opens nothing;
//   7. no horizontal page scroll;
//   8. the same size checks at 390x844.
// The same logic with a mouse's pointer standing in is held by
// tests/suites/keyboards.js, which also holds that desktop keys are unchanged.
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
  const tapEl = async (node) => { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await settle(); const p = mid(node); await tap(p.x, p.y); };
  const grid = () => el('tvGrid');
  const rowEl = (key) => [...grid().querySelectorAll('tbody tr[data-row]')].find((r) => r.dataset.row === key) || null;
  const cellEl = (key, col) => { const r = rowEl(key); return r ? [...r.querySelectorAll('td[data-col]')].find((td) => td.dataset.col === col) || null : null; };
  // A first tap puts the cursor on the cell, a second opens it (onTableClick).
  const openCell = async (rk, col) => { await tapEl(cellEl(rk, col)); if (!_tv.editor) await tapEl(cellEl(rk, col)); return _tv.editor; };
  const steps = () => _undoStack.length;
  const noSideScroll = () => document.documentElement.scrollWidth <= innerWidth;
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  const PC = (id, name, x, os) => ({ id, type: 'pc', name, x, y: 0, gw: '', dns: '', os, notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: `10.0.0.${x / 10 + 10}/24` }] });
  const doc = { v: DOC_VERSION, nodes: [PC('a', 'PC A', 0, ''), PC('b', 'PC B', 100, ''), PC('c', 'Wireless Printer', 200, ''),
    { id: 'sw', type: 'switch', name: 'SW', x: 300, y: 0, portCount: 8, interfaces: [] }], links: [], annotations: [] };

  // The → of the open cell: at least 44px, inside the table's scroller
  // across (not only the window: the scroller clips it short of that), the
  // one thing a finger on its middle meets, and its row no taller than the
  // row under it, which is at rest.
  const checkNext = (where) => {
    const btn = _tv.editor && _tv.editor.td.querySelector('.tv-next');
    ok(`${where}: the open cell has a →`, !!btn);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const box = el('tvScroll'), b = box.getBoundingClientRect();
    const edge = b.left + box.clientLeft + box.clientWidth;
    ok(`${where}: the → is 44px or larger`, r.width >= 44 && r.height >= 44, json([r.width, r.height]));
    ok(`${where}: the → is inside the table, on the screen`, r.left >= b.left && r.right <= edge + 0.5 && r.right <= innerWidth, json([r.left, r.right, edge, innerWidth]));
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    ok(`${where}: and nothing covers it`, !!hit && hit.closest('.tv-next') === btn, hit ? hit.outerHTML.slice(0, 80) : 'nothing');
    const tr = _tv.editor.td.parentElement, rest = tr.nextElementSibling || tr.previousElementSibling;
    if (rest) ok(`${where}: the open row is no taller than a resting one`, tr.getBoundingClientRect().height <= rest.getBoundingClientRect().height + 0.5,
      json([tr.getBoundingClientRect().height, rest.getBoundingClientRect().height]));
    return btn;
  };

  try {
    ok('this page is on a touch screen', navigator.maxTouchPoints > 0 && typeof window.__touch === 'function' && matchMedia('(pointer: coarse)').matches);
    if (landingIsOpen()) closeLanding();
    replaceDocument(doc, { origin: 'file', docId: 'touch-keys' });
    initHistory();
    setView('table');
    showTableTab('devices');
    await settle();

    // ---- 1. Open a cell ----
    let ed = await openCell('n:a', 'os');
    ok('a second tap opens the OS cell', !!ed && ed.colKey === 'os' && ed.rowKey === 'n:a');
    if (ed) ok('a name\'s keyboard that says Next', ed.el.dataset.keys === 'name' && ed.el.getAttribute('enterkeyhint') === 'next', ed.el.outerHTML.slice(0, 160));

    // ---- 2. Enter goes on down ----
    if (ed) {
      const n0 = steps();
      await window.__type('Win 11'); await window.__key('Enter'); await settle();
      ok('Enter keeps the value, one undo step', getNode('a').os === 'Win 11' && steps() === n0 + 1, `${getNode('a').os} ${steps() - n0}`);
      ok('and opens the cell below, focused', !!_tv.editor && _tv.editor.rowKey === 'n:b' && _tv.editor.colKey === 'os' && document.activeElement === _tv.editor.el,
        _tv.editor ? `${_tv.editor.rowKey} ${_tv.editor.colKey}` : 'no editor');
      if (_tv.editor) { await window.__type('Win 10'); await window.__key('Enter'); await settle(); }
      ok('and on to the next', getNode('b').os === 'Win 10' && !!_tv.editor && _tv.editor.rowKey === 'n:c');
    }

    // ---- 3. The end of the column ----
    // The switch's OS cell is the last one, so c's says Next; the switch's Done.
    if (_tv.editor) { await window.__type('Ubuntu'); await window.__key('Enter'); await settle(); }
    if (_tv.editor && _tv.editor.rowKey === 'n:sw') {
      ok('the last row says Done', _tv.editor.el.getAttribute('enterkeyhint') === 'done');
      await window.__type('IOS'); await window.__key('Enter'); await settle();
      ok('and its Enter closes the editor', !_tv.editor && getNode('sw').os === 'IOS');
    } else ok('Enter reached the last row', false, _tv.editor ? _tv.editor.rowKey : 'no editor');

    // ---- 4. The → across ----
    ed = await openCell('n:a', 'name');
    let btn = checkNext('360');
    if (btn) {
      _tv.editor.el.value = 'PC A1';
      // A press that took the focus would drop the keyboard and raise it
      // again on the next cell; tvNextCell recovers from it, so the end
      // state alone cannot tell. The field must still have it at the click.
      const field = _tv.editor.el;
      let heldAtClick = null;
      btn.addEventListener('click', () => { heldAtClick = document.activeElement === field; }, { capture: true, once: true });
      await tapEl(btn);
      ok('the field keeps the focus all through the press', heldAtClick === true, String(heldAtClick));
      ok('the → keeps the name', getNode('a').name === 'PC A1', getNode('a').name);
      ok('and opens the next typeable cell, past Type and Interfaces', !!_tv.editor && _tv.editor.colKey === 'gw' && _tv.editor.rowKey === 'n:a' && document.activeElement === _tv.editor.el,
        _tv.editor ? `${_tv.editor.rowKey} ${_tv.editor.colKey}` : 'no editor');
      if (_tv.editor) ok('with capitals off', _tv.editor.el.getAttribute('autocapitalize') === 'off');
      // The gateway sits beside the pinned Name column, which the long name
      // has made 9rem wide: its field takes only the room left there.
      if (_tv.editor && _tv.editor.colKey === 'gw') checkNext('360, beside a long name');
    }

    // ---- 5. A refused value ----
    if (_tv.editor && _tv.editor.colKey === 'gw') {
      const n1 = steps();
      await window.__type('nope'); await window.__key('Enter'); await settle();
      ok('a refused gateway stays open, marked, no chain', !!_tv.editor && _tv.editor.colKey === 'gw' && _tv.editor.rowKey === 'n:a'
        && _tv.editor.el.classList.contains('bad') && steps() === n1);
      if (_tv.editor) { await window.__key('Escape'); await settle(); }
    }

    // ---- 6. A pick below ----
    // Enter from a's Group cell's neighbour column is not possible by typing,
    // so the chain is asked straight: from a cell whose next one down is a pick.
    ok('a pick never takes a chained edit', !tvTypes(cellEl('n:b', 'group')) && !tvEditOn(cellEl('n:b', 'group'), ''));
    ok('nothing opened by asking', !_tv.editor);

    // ---- 7. No sideways scroll ----
    ok('no horizontal scroll at 360', noSideScroll(), `${document.documentElement.scrollWidth} > ${innerWidth}`);

    // ---- 8. 390 wide ----
    await window.__viewport(390, 844);
    await settle(); await wait(200);
    ed = await openCell('n:b', 'name');
    btn = checkNext('390');
    if (_tv.editor) { await window.__key('Escape'); await settle(); }
    ed = await openCell('n:b', 'gw');
    checkNext('390, beside a long name');
    if (_tv.editor) { await window.__key('Escape'); await settle(); }
    ok('no horizontal scroll at 390', noSideScroll(), `${document.documentElement.scrollWidth} > ${innerWidth}`);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    try { if (_tv.editor) cancelEdit(true); setView(savedView === 'table' ? 'table' : 'map'); } catch (e) { /* the view is restored as far as it can be */ }
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
