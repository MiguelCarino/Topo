// Select more and the desktop's own multi-select (Mobile batch 2; js/ui.js
// selectMoreOn / setSelectMore / pressNode, js/app.js the empty-map press,
// js/mobile.js the selection bar, index.html the multi-selection hint). This
// run is a desktop window with a mouse; the touch side is touchselect.js.
//   1. Select more is off by default; a plain press on a device replaces the
//      selection, a Shift-press (and Ctrl, Cmd) adds and takes out, a
//      Shift-press on a cable adds it, and a plain press on empty map clears;
//   2. at 900px or less, with the mode on (as the phone's bar sets it), a
//      press and release that moves nothing (a tap, a mouse's or a pen's
//      click) adds and takes out with no modifier, and a press on empty map
//      keeps the set; a mouse or pen drag on a member moves the whole set,
//      one undo step, and toggles nothing; off again, a plain press replaces;
//      wider, the mode is refused at once;
//   3. a mouse (fine pointer) reads the Shift-click hint, not the tap one;
//   4. the new strings are translated in es, pt-BR, ja and ru;
//   5. the page itself at 1280px (a blob frame): Shift-click adds and takes
//      out, a plain click replaces, Select more is refused, and the
//      Shift-click hint shows.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const D = (id, x, y, ip) => ({ id, type: 'pc', name: id.toUpperCase(), x, y, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const lab = () => ({ v: DOC_VERSION, nodes: [D('a', 100, 100, '10.0.0.11/24'), D('b', 300, 100, '10.0.0.12/24'), D('c', 500, 100, '10.0.0.13/24')],
    links: [{ id: 'l1', source: 'a', target: 'b' }], annotations: [] });
  const sel = () => [...state.selection].map((e) => e.type[0] + ':' + e.id).sort();
  // A mouse press and its release, as a click on the element.
  const press = (target, extra = {}) => {
    const o = Object.assign({ bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }, extra);
    target.dispatchEvent(new MouseEvent('mousedown', o));
    window.dispatchEvent(new MouseEvent('mouseup', o));
  };
  const card = (id) => el('ui-node-' + id);
  const cable = () => document.querySelector('#ui-link-l1') || document.querySelector('[id^="ui-link-l1"]');

  try {
    replaceDocument(lab(), { origin: 'file', docId: 'selectmore' });
    setView('map');
    renderCanvasOnly();
    select(null, null);

    // ---- 1. The desktop ----
    ok('Select more is off by default', typeof selectMoreOn === 'function' && !selectMoreOn());
    press(card('a'));
    ok('a plain press selects one device', json(sel()) === json(['n:a']), json(sel()));
    press(card('b'));
    ok('a second plain press replaces it', json(sel()) === json(['n:b']), json(sel()));
    press(card('a'), { shiftKey: true });
    ok('a Shift-press adds', json(sel()) === json(['n:a', 'n:b']), json(sel()));
    press(card('c'), { ctrlKey: true });
    ok('so does Ctrl', json(sel()) === json(['n:a', 'n:b', 'n:c']), json(sel()));
    press(card('b'), { metaKey: true });
    ok('and Cmd takes one out', json(sel()) === json(['n:a', 'n:c']), json(sel()));
    press(card('a'), { shiftKey: true });
    ok('a Shift-press on a member takes it out', json(sel()) === json(['n:c']), json(sel()));
    const line = cable();
    ok('the cable is drawn', !!line);
    if (line) {
      line.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
      ok('a Shift-press on a cable adds it', json(sel()) === json(['l:l1', 'n:c']), json(sel()));
    }
    press(el('networkCanvas'));
    ok('a plain press on empty map clears', !state.selection.size, json(sel()));

    // ---- 2. The mode, as the phone's bar sets it ----
    press(card('a'));
    setSelectMore(true);
    if (!matchMedia('(max-width: 900px)').matches) {
      // No Select more past the breakpoint: the bar's sync ends it at once.
      ok('wider than 900px the mode is refused', !selectMoreOn());
      setSelectMore(false);
    } else {
    ok('the mode is on', selectMoreOn());
    press(card('b'));
    ok('on: a plain press adds', json(sel()) === json(['n:a', 'n:b']), json(sel()));
    press(card('a'));
    ok('and takes out', json(sel()) === json(['n:b']), json(sel()));
    if (cable()) {
      cable().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      ok('a press on a cable adds it', json(sel()) === json(['l:l1', 'n:b']), json(sel()));
    }
    press(el('networkCanvas'));
    ok('a press on empty map keeps the set', json(sel()) === json(['l:l1', 'n:b']) && selectMoreOn(), json(sel()));
    ok('nothing moved and nothing was filed by the taps', getNode('a').x === 100 && getNode('b').x === 300);
    // A mouse's or a pen's drag on a member moves the set (a pen sends real
    // mouse events, no touch, so the press alone cannot say tap or drag).
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    {
      const u0 = _undoStack.length;
      const r = card('a').querySelector('rect').getBoundingClientRect();
      const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
      card('a').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x0, clientY: y0 }));
      for (let i = 1; i <= 5; i++) window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, buttons: 1, clientX: x0 + 12 * i, clientY: y0 + 6 * i }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x0 + 60, clientY: y0 + 30 }));
      await tick();
      const da = getNode('a').x - 100, db = getNode('b').x - 300;
      ok('on: a mouse drag on a member moves it', da !== 0, String(da));
      ok('and the whole set by the same step', da === db && getNode('a').y === getNode('b').y, json([getNode('a').x, getNode('a').y, getNode('b').x, getNode('b').y]));
      ok('and toggles nothing', json(sel()) === json(['n:a', 'n:b']) && selectMoreOn(), json(sel()));
      ok('as one undo step', _undoStack.length === u0 + 1, u0 + ' -> ' + _undoStack.length);
      ok('a device outside the set stays', getNode('c').x === 500);
      undo();
      await tick();
      ok('and one Undo puts both back', getNode('a').x === 100 && getNode('b').x === 300);
    }
    setSelectMore(false);
    press(card('c'));
    ok('off again, a plain press replaces', json(sel()) === json(['n:c']), json(sel()));
    select(null, null);
    setSelectMore(true);
    await tick();
    ok('an empty selection ends the mode', !selectMoreOn());
    setSelectMore(false);
    }

    // ---- 3. The hint ----
    const fine = document.querySelector('#multiSelectionPane .hint-fine'), coarse = document.querySelector('#multiSelectionPane .hint-coarse');
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    await tick();
    if (!matchMedia('(pointer: coarse)').matches) {
      ok('a mouse reads the Shift-click hint', !!fine && getComputedStyle(fine).display !== 'none');
      ok('and not the tap one', !!coarse && getComputedStyle(coarse).display === 'none');
    }
    select(null, null);

    // ---- 4. Translated ----
    const keys = ['Select more', 'Done', '{n} selected', 'Tap devices to add or remove them.'];
    for (const loc of ['es', 'pt-BR', 'ja', 'ru']) {
      setLocale(loc);
      const missing = keys.filter((k) => t(k) === k);
      ok(loc + ' translates the Select more strings', !missing.length, missing.join(' | '));
    }
    setLocale('en');

    // ---- 5. The page itself at 1280px ----
    {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;border:0;visibility:hidden';
      // The page's CSP frames blob: only (selbar.js does the same).
      const html = (await (await fetch('index.html')).text())
        .replace(/(\s(?:src|href))="(?!https?:|data:|blob:|#|mailto:)([^"]*)"/g, (m, attr, u) => attr + '="' + new URL(u, location.href).href + '"');
      f.src = URL.createObjectURL(new Blob([html], { type: 'text/html' })) + '#advanced';
      const loaded = new Promise((r) => f.addEventListener('load', r));
      document.body.appendChild(f);
      await loaded; await new Promise((r) => setTimeout(r, 400));
      const w = f.contentWindow, fd = f.contentDocument;
      w.replaceDocument(lab(), { origin: 'file', docId: 'selectmore-wide' });
      w.setView('map'); w.renderCanvasOnly();
      w.select(null, null);
      const wsel = () => w.selectedOf('node').map((id) => 'n:' + id).sort();
      const wpress = (id, extra = {}) => {
        const o = Object.assign({ bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }, extra);
        fd.getElementById('ui-node-' + id).dispatchEvent(new w.MouseEvent('mousedown', o));
        w.dispatchEvent(new w.MouseEvent('mouseup', o));
      };
      ok('the frame is 1280px wide', w.matchMedia('(max-width: 900px)').matches === false && w.innerWidth === 1280, String(w.innerWidth));
      wpress('a');
      wpress('b');
      ok('at 1280px a plain click replaces', json(wsel()) === json(['n:b']), json(wsel()));
      wpress('a', { shiftKey: true });
      wpress('c', { ctrlKey: true });
      ok('Shift and Ctrl add', json(wsel()) === json(['n:a', 'n:b', 'n:c']), json(wsel()));
      wpress('b', { shiftKey: true });
      ok('Shift on a member takes it out', json(wsel()) === json(['n:a', 'n:c']), json(wsel()));
      w.setSelectMore(true);
      ok('Select more is refused at 1280px', !fd.body.classList.contains('select-more') && fd.getElementById('selBar').dataset.more !== 'on');
      wpress('b');
      ok('so a plain click still replaces', json(wsel()) === json(['n:b']), json(wsel()));
      w.selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
      await new Promise((r) => setTimeout(r, 50));
      const wf = fd.querySelector('#multiSelectionPane .hint-fine'), wc = fd.querySelector('#multiSelectionPane .hint-coarse');
      ok('and the pane reads the Shift-click hint', w.getComputedStyle(wf).display !== 'none' && w.getComputedStyle(wc).display === 'none');
      f.remove();
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    if (typeof setSelectMore === 'function') setSelectMore(false);
    if (typeof setLocale === 'function') setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
