// The phone's selection bar and connect banner, the model and the paths they
// use (Mobile batch 2; js/mobile.js selBarActions, js/ui.js select() and the
// node click). This run is a desktop window, where both bars stay hidden; the
// touch side is tests/suites/touchedit.js. What is held here:
//   1. selBarActions: a device offers Edit, Connect, Select more and Delete;
//      a cable Edit, Select more and Delete; a note Edit text, Link, A−, A+
//      and Delete; a note leader Delete; a set Edit, Select more and Delete;
//      Select more on, Edit, Delete and Done; a read-only document Edit only;
//      nothing selected, nothing;
//   2. select() and a set's renderSelection() announce 'topo:selectionchange';
//   3. Connect (link mode from the selected device, as the bar arms it) and a
//      click on another device file exactly one cable and one undo step, and
//      undo takes it back; a click on the same device disarms with no cable;
//   4. link mode writes the canvas's class (an <svg>: 'linking' while armed),
//      which the banner watches;
//   5. on the desktop: right-click and L still arm link mode, the map still
//      draws the selected device's ✕, and neither bar shows;
//   6. Link from a note and a click on a device adds the note's leader, and
//      the bar's A+ step is the map's (2px, one undo step);
//   7. every new string is translated in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const D = (id, x, y, ip) => ({ id, type: 'pc', name: id.toUpperCase(), x, y, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const lab = () => ({ v: DOC_VERSION, nodes: [D('a', 100, 100, '10.0.0.11/24'), D('b', 300, 100, '10.0.0.12/24'), D('c', 500, 100, '10.0.0.13/24')],
    links: [{ id: 'l1', source: 'a', target: 'b' }], annotations: [{ id: 'n1', x: 100, y: 300, text: 'Check', style: 'note', size: 12, targets: [] }] });
  const click = (target, extra = {}) => target.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, extra)));
  const tick = () => new Promise((r) => setTimeout(r, 0));   // the bars follow through MutationObservers
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Poll instead of a fixed sleep: under the full suite the frame's boot timers can run late.
  const until = async (fn, ms = 3000) => { const t0 = performance.now(); while (!fn() && performance.now() - t0 < ms) await wait(25); return fn(); };
  const frame = () => Promise.race([new Promise((r) => requestAnimationFrame(() => r())), wait(100)]);
  const GUARD = 400;   // past the bar's pause after Cancel (js/mobile.js SELBAR_GUARD_MS)
  const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  try {
    // ---- 1. The model ----
    const A = window.selBarActions;
    ok('selBarActions is published', typeof A === 'function');
    ok('nothing selected: no bar', json(A([], false)) === '[]' && json(A(new Set(), false)) === '[]');
    ok('a device: Edit, Connect, Select more, Delete', json(A([{ type: 'node', id: 'a' }], false)) === json(['edit', 'connect', 'more', 'remove']));
    ok('a cable: Edit, Select more, Delete', json(A([{ type: 'link', id: 'l1' }], false)) === json(['edit', 'more', 'remove']));
    ok('a note: Edit text, Link, A−, A+, Delete', json(A([{ type: 'annotation', id: 'n1' }], false)) === json(['edittext', 'link', 'smaller', 'larger', 'remove']));
    ok('a note leader: Delete', json(A([{ type: 'notelink', id: 'nl:n1:a' }], false)) === json(['remove']));
    ok('a set: Edit, Select more, Delete', json(A([{ type: 'node', id: 'a' }, { type: 'link', id: 'l1' }], false)) === json(['edit', 'more', 'remove']));
    ok('Select more on: Edit, Delete, Done', json(A([{ type: 'node', id: 'a' }], false, true)) === json(['edit', 'remove', 'done'])
       && json(A([{ type: 'node', id: 'a' }, { type: 'link', id: 'l1' }], false, true)) === json(['edit', 'remove', 'done']));
    ok('no Select more on a note or in a read-only network', !A([{ type: 'annotation', id: 'n1' }], false).includes('more') && json(A([{ type: 'node', id: 'a' }], true, true)) === json(['edit']));
    ok('read-only: Edit only', json(A([{ type: 'node', id: 'a' }], true)) === json(['edit']) && json(A([{ type: 'annotation', id: 'n1' }], true)) === json(['edit']));

    replaceDocument(lab(), { origin: 'file', docId: 'selbar' });
    setView('map');
    renderCanvasOnly();

    // ---- 2. The announcement ----
    let heard = 0;
    const hear = () => { heard++; };
    document.addEventListener('topo:selectionchange', hear);
    select('a', 'node');
    ok('select() announces the selection', heard >= 1, String(heard));
    heard = 0;
    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    ok('a set announces it too', heard >= 1, String(heard));
    heard = 0;
    select(null, null);
    ok('and so does clearing it', heard >= 1, String(heard));
    document.removeEventListener('topo:selectionchange', hear);

    // ---- 3. Connect, then a target ----
    select('a', 'node');
    const links0 = state.links.length, undo0 = _undoStack.length;
    state.linkSourceId = 'a'; renderCanvasOnly();   // what the bar's Connect does
    ok('Connect arms link mode from the device', state.linkSourceId === 'a');
    ok('and the canvas carries the linking class', el('networkCanvas').classList.contains('linking'), el('networkCanvas').getAttribute('class'));
    click(el('ui-node-c'));
    ok('a click on another device files one cable', state.links.length === links0 + 1, `${links0} -> ${state.links.length}`);
    ok('as one undo step', _undoStack.length === undo0 + 1, `${undo0} -> ${_undoStack.length}`);
    ok('and ends link mode', !state.linkSourceId && !el('networkCanvas').classList.contains('linking'));
    const made = state.links[state.links.length - 1];
    ok('between the two devices', made && ((made.source === 'a' && made.target === 'c') || (made.source === 'c' && made.target === 'a')), made && json([made.source, made.target]));
    undo();
    ok('undo takes the cable back', state.links.length === links0, String(state.links.length));
    select('a', 'node');
    state.linkSourceId = 'a'; renderCanvasOnly();
    click(el('ui-node-a'));
    ok('a click on the same device disarms and files nothing', !state.linkSourceId && state.links.length === links0);
    state.linkSourceId = 'a'; renderCanvasOnly();
    select(null, null);
    ok('select() disarms too', !state.linkSourceId && !el('networkCanvas').classList.contains('linking'));

    // ---- 5. The desktop is as it was ----
    const g = el('ui-node-b');
    g.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    ok('right-click arms link mode', state.linkSourceId === 'b');
    state.linkSourceId = null; renderCanvasOnly();
    select('a', 'node');
    key('l');
    ok('L arms link mode from the selected device', state.linkSourceId === 'a');
    key('Escape');
    select('a', 'node');
    ok('the map draws the selected device\'s ✕', !!el('ui-node-a').querySelector('.node-delete') && getComputedStyle(el('ui-node-a').querySelector('.node-delete')).display !== 'none');
    // This headless window is 800px wide, under the phone breakpoint, so the
    // bar is live here (a mouse's: the ✕ above stays). Above 900px the
    // stylesheet's top-level rule hides both (checked at 1280 in a browser).
    const narrow = matchMedia('(max-width: 900px)').matches;
    const topRule = [...document.styleSheets].some((ss) => { try { return [...ss.cssRules].some((r) => r.selectorText === '.sel-bar, .link-banner' && r.style.display === 'none'); } catch (e) { return false; } });
    ok('above 900px neither bar shows (top-level display:none)', topRule);
    if (!narrow) ok('neither bar shows on this desktop window', getComputedStyle(el('selBar')).display === 'none' && getComputedStyle(el('linkBanner')).display === 'none');
    else {
      ok('under 900px the bar names the selected device', getComputedStyle(el('selBar')).display !== 'none' && el('selBar').querySelector('.sel-bar-name').textContent === 'A', el('selBar').textContent);
      ok('and lifts the document bar over it', document.body.classList.contains('selbar-on'));
      // The bar's own buttons, clicked.
      const links1 = state.links.length, undo1 = _undoStack.length;
      click(el('selBar').querySelector('[data-act="connect"]'));
      await tick();
      ok('the bar\'s Connect arms link mode from it', state.linkSourceId === 'a');
      ok('the banner takes the bar\'s place', !el('linkBanner').hidden && el('selBar').hidden && el('linkBanner').textContent.includes('Tap the device to connect to A'), el('linkBanner').textContent);
      click(el('linkCancel'));
      await tick();
      ok('Cancel disarms, nothing filed', !state.linkSourceId && el('linkBanner').hidden && state.links.length === links1 && _undoStack.length === undo1);
      await wait(GUARD);
      click(el('selBar').querySelector('[data-act="connect"]'));
      click(el('ui-node-c'));
      ok('Connect and a tap on another device: one cable, one undo step', state.links.length === links1 + 1 && _undoStack.length === undo1 + 1, state.links.length + ' ' + _undoStack.length);
      undo();
      select('a', 'node');
      click(el('selBar').querySelector('[data-act="remove"]'));
      ok('Delete deletes it as one undo step', !getNode('a') && _undoStack.length === undo1 + 1, String(_undoStack.length));
      undo();
      ok('and undo brings it back', !!getNode('a'));

      // A quick second tap on Cancel: the bar is back in the same box, with
      // Delete where Cancel was. It must not delete.
      select('a', 'node'); await tick();
      click(el('selBar').querySelector('[data-act="connect"]')); await tick();
      click(el('linkCancel')); await tick();
      ok('after Cancel the bar is back', !el('selBar').hidden && !state.linkSourceId);
      click(el('selBar').querySelector('[data-act="remove"]'));
      ok('a second quick tap where Cancel was deletes nothing', !!getNode('a') && _undoStack.length === undo1, String(_undoStack.length));
      await wait(GUARD);
      click(el('selBar').querySelector('[data-act="connect"]'));
      ok('a moment later the bar takes taps again', state.linkSourceId === 'a');
      state.linkSourceId = null; renderCanvasOnly(); await tick();

      // A long name on a narrow banner stays within the docbar's lift.
      const longName = 'Living room switch TL-SG108E rack 2 shelf B port bank, upstairs east wing closet';
      const name0 = getNode('a').name;
      getNode('a').name = longName;
      el('linkBanner').style.right = Math.max(0, innerWidth - 12 - 276) + 'px';   // a 360px phone's banner
      state.linkSourceId = 'a'; renderCanvasOnly(); await tick();
      const bh = el('linkBanner').getBoundingClientRect().height;
      ok('a long name keeps the banner within its 64px', !el('linkBanner').hidden && bh > 0 && bh <= 64, String(bh));
      state.linkSourceId = null; renderCanvasOnly(); await tick();
      el('linkBanner').style.right = '';
      getNode('a').name = name0;
      select('a', 'node'); await tick();

      // The open drawer, the landing and the chrome still loading lift nothing.
      const ws = document.querySelector('.ws');
      ok('the bar lifts the docbar while it shows', document.body.classList.contains('selbar-on'));
      ws.classList.add('drawer-open'); await tick();
      ok('the open drawer hides the bar and drops the lift', el('selBar').hidden && !document.body.classList.contains('selbar-on'));
      ws.classList.remove('drawer-open'); await tick();
      for (const flag of ['landing-open', 'chrome-pending']) {
        document.body.classList.add(flag); await tick();
        ok(flag + ' drops the lift', !document.body.classList.contains('selbar-on') && el('selBar').hidden);
        document.body.classList.remove(flag); await tick();
      }
      state.linkSourceId = 'a'; renderCanvasOnly(); await tick();
      ws.classList.add('drawer-open'); await tick();
      ok('the banner drops the lift under the open drawer too', el('linkBanner').hidden && !document.body.classList.contains('selbar-on'));
      ws.classList.remove('drawer-open');
      state.linkSourceId = null; renderCanvasOnly(); await tick();
      ok('closed again, the bar and its lift are back', !el('selBar').hidden && document.body.classList.contains('selbar-on'));

      // A new width measures the labels' fit again (a rotation under 900px).
      ok('the device bar fits its labels here', !el('selBar').classList.contains('compact'), el('selBar').className);
      el('selBar').style.right = Math.max(0, innerWidth - 12 - 150) + 'px';
      window.dispatchEvent(new Event('resize')); await frame(); await tick();
      ok('narrowed, a resize drops the labels', el('selBar').classList.contains('compact-all'), el('selBar').className);
      el('selBar').style.right = '';
      window.dispatchEvent(new Event('resize')); await frame(); await tick();
      ok('widened again, they come back', !el('selBar').classList.contains('compact'), el('selBar').className);
      ok('the bars are map to two fingers (touch-action none)', getComputedStyle(el('selBar')).touchAction === 'none' && getComputedStyle(el('linkBanner')).touchAction === 'none');
    }

    // ---- 6. A note ----
    select('n1', 'annotation');
    state.linkSourceId = 'n1'; renderCanvasOnly();   // the bar's Link
    click(el('ui-node-b'));
    ok('Link from a note and a click on a device adds the leader', json(getAnnotation('n1').targets) === json(['b']), json(getAnnotation('n1').targets));
    ok('and ends link mode', !state.linkSourceId);
    select('n1', 'annotation');
    const u1 = _undoStack.length;
    const size0 = getAnnotation('n1').size;
    // The map's A+ disc (a mouse's) and, under 900px, the bar's: the same 2px step, one undo step each.
    const plus = [...el('ui-ann-n1').querySelectorAll('.node-delete')].find((d) => d.textContent.includes('A+'));
    ok('the map draws the note\'s A+ for a mouse', !!plus);
    if (plus) click(plus);
    ok('A+ on the map grows the note by 2px', getAnnotation('n1').size === size0 + 2, size0 + ' -> ' + getAnnotation('n1').size);
    ok('as one undo step', _undoStack.length === u1 + 1, u1 + ' -> ' + _undoStack.length);
    const barPlus = document.querySelector('#selBar:not([hidden]) [data-act="larger"]');
    if (matchMedia('(max-width: 900px)').matches) {
      ok('the bar offers A+ for the note', !!barPlus);
      if (barPlus) {
        click(barPlus);
        ok('the bar\'s A+ is the same step, one undo step', getAnnotation('n1').size === size0 + 4 && _undoStack.length === u1 + 2, getAnnotation('n1').size + ' ' + _undoStack.length);
        click(document.querySelector('#selBar [data-act="smaller"]'));
        ok('and A− takes it back down', getAnnotation('n1').size === size0 + 2);
      }
      click(document.querySelector('#selBar [data-act="edittext"]'));
      await tick();
      ok('Edit text opens the note\'s editor', !!el('annEditor') && el('annEditor').dataset.annId === 'n1');
      ok('the bar steps aside while it is open', el('selBar').hidden);
      el('annEditor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    // ---- Above 900px: the page itself, in a 1280px frame ----
    {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;border:0;visibility:hidden';
      // The page's CSP frames blob: only, so the frame is index.html as a
      // blob, its own files named in full (base-uri is 'none').
      const html = (await (await fetch('index.html')).text())
        .replace(/(\s(?:src|href))="(?!https?:|data:|blob:|#|mailto:)([^"]*)"/g, (m, attr, u) => attr + '="' + new URL(u, location.href).href + '"');
      f.src = URL.createObjectURL(new Blob([html], { type: 'text/html' })) + '#advanced';
      const loaded = new Promise((r) => f.addEventListener('load', r));
      document.body.appendChild(f);
      await loaded; await wait(400);
      const w = f.contentWindow, fd = f.contentDocument;
      w.replaceDocument(lab(), { origin: 'file', docId: 'selbar-wide' });
      w.setView('map'); w.renderCanvasOnly();
      w.select('a', 'node'); await wait(50);
      const fs = (id) => w.getComputedStyle(fd.getElementById(id)).display;
      ok('at 1280px the selection bar is absent', w.matchMedia('(max-width: 900px)').matches === false && fs('selBar') === 'none' && !fd.body.classList.contains('selbar-on'), fs('selBar'));
      const x = fd.getElementById('ui-node-a').querySelector('.node-delete');
      ok('and the map draws the ✕ for the mouse', !!x && w.getComputedStyle(x).display !== 'none');
      // state is the page's own (a const), so the mouse's right-click arms it.
      // Let the frame's late boot work (fit, arrival focus) settle first, so it can't clear link mode after the press.
      await wait(300); w.select('a', 'node'); await wait(50);
      fd.getElementById('ui-node-a').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
      const armed = await until(() => fd.getElementById('networkCanvas').classList.contains('linking'));
      ok('right-click at 1280px arms link mode and shows no banner', fs('linkBanner') === 'none' && armed, fs('linkBanner') + ' armed=' + armed);
      f.remove();
    }

    // ---- 7. Translations ----
    const keys = ['Connect', 'Connect to another device', 'Edit text', 'Link', 'Link to a device', 'Tap the device to connect to {name}',
      'Tap a device to link this note', 'Selected item', '{n} selected', 'Unnamed device', 'Edit', 'Delete', 'Cancel', 'Smaller text', 'Larger text'];
    for (const loc of ['es', 'pt-BR', 'ja', 'ru']) {
      setLocale(loc);
      const missing = keys.filter((k) => t(k) === k);
      ok(`${loc} translates the bar's strings`, !missing.length, missing.join(' | '));
      ok(`${loc} keeps {name} and {n}`, t('Tap the device to connect to {name}', { name: 'Q' }).includes('Q') && t('{n} selected', { n: 7 }).includes('7'));
    }
    setLocale('en');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
