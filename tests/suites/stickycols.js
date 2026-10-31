// What should stay in sight does, in either theme. What is held here:
//   1. the table's identifier column (Name on Devices, the device on
//      Interfaces, an interface's name folded open under its device) is
//      pinned beside the tick and twist columns: scrolled all the way right it
//      is still there, on top, opaque when selected, its header over the
//      body's; a cell the keyboard moves to comes out from under it; a click,
//      Enter and Esc, a sort and a hidden column all leave it pinned and first;
//   2. a length's unit pick lists its options on the card's colours, so
//      Colourful light is not a black list, and Gold stays as it was; the
//      pair's frame is still an input's;
//   3. a selected cable's port labels read on the dark and blueprint maps,
//      stay off an export, and say "unbound" in the user's language, with
//      the room kept for them as wide as the label (Japanese full width).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const grid = () => el('tvGrid');
  const rowEl = (key) => [...grid().querySelectorAll('tbody tr[data-row]')].find((r) => r.dataset.row === key) || null;
  const cellEl = (key, col) => { const r = rowEl(key); return r ? [...r.querySelectorAll('td[data-col]')].find((td) => td.dataset.col === col) || null : null; };
  const headEl = (col) => grid().querySelector(`thead th[data-col="${col}"]`);
  const heads = () => [...grid().querySelectorAll('thead th[data-col]')].map((th) => th.dataset.col);
  const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const click = (target) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const css = (x) => getComputedStyle(x);
  const sticky = (x) => !!x && css(x).position === 'sticky';
  // The fields ease their colours (0.15s), and this runner's clock stands still.
  const settle = () => document.getAnimations().forEach((a) => { if (a instanceof CSSTransition) a.finish(); });
  const frame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 50); });
  // WCAG 2 contrast from two computed colours ("rgb(…)" / "rgba(…)").
  const rgba = (s) => { const m = String(s).match(/[\d.]+/g) || []; return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]]; };
  const lum = (s) => { const [r, g, b] = rgba(s).map((v, i) => (i < 3 ? v / 255 : v)).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // A token as a computed colour, read off a probe on the page.
  const token = (name) => {
    const p = document.createElement('div'); p.style.background = `var(${name})`; document.body.appendChild(p);
    const v = css(p).backgroundColor; p.remove(); return v;
  };
  const root = document.documentElement;
  const savedTheme = root.getAttribute('data-carino-theme'), savedMode = root.getAttribute('data-theme');
  const savedView = state.settings.view, savedInk = state.settings.mapInk || '';
  const savedProfile = state.settings.profile, savedAdvanced = state.settings.advanced;
  const savedTableView = state.tableView;
  const quiet = setDialogResponder(() => null);
  const scroller = el('tvScroll');
  const savedWidth = scroller.style.width;

  const PC = (id, name, x) => ({ id, type: 'pc', name, x, y: 300, os: 'Windows 11 Pro for Workstations', notes: 'A long note so the table runs wide',
    interfaces: [{ id: 'i1', name: 'eth0', ip: `10.0.0.${x / 10}/24`, mac: '00:11:22:33:44:55' }, { id: 'i2', name: 'eth1', ip: '' }] });
  const lab = () => ({ v: DOC_VERSION,
    nodes: [PC('a', 'PC-A', 100), PC('b', 'PC-B', 200), PC('c', 'PC-C', 300)], links: [] });

  try {
    // ---- 1. The pinned column ----
    replaceDocument(lab(), { origin: 'file', docId: 'stickycols' });
    setView('table');
    showTableTab('devices');
    scroller.style.width = '700px';
    renderTableView(true);
    const name = () => cellEl('n:a', 'name');
    const chk = () => rowEl('n:a').querySelector('td.tv-chk');
    const exp = () => rowEl('n:a').querySelector('td.tv-exp');
    ok('the table is wider than its 700px box', scroller.scrollWidth > scroller.clientWidth + 100, `${scroller.scrollWidth} / ${scroller.clientWidth}`);
    ok('Name, its header, the tick and the twist are sticky', sticky(headEl('name')) && sticky(name()) && sticky(chk()) && sticky(exp()),
      [headEl('name'), name(), chk(), exp()].map((x) => x && css(x).position).join());
    scroller.scrollLeft = scroller.scrollWidth; await frame();
    const sc = scroller.getBoundingClientRect();
    ok('scrolled all the way right, Name stays right of the twist column', scroller.scrollLeft > 0
      && name().getBoundingClientRect().left >= exp().getBoundingClientRect().right - 0.5
      && exp().getBoundingClientRect().left >= sc.left - 0.5,
      `${name().getBoundingClientRect().left} vs ${exp().getBoundingClientRect().right}`);
    const nr = name().getBoundingClientRect();
    const hit = document.elementFromPoint(nr.left + nr.width / 2, nr.top + nr.height / 2);
    ok('and nothing scrolled under it is on top', !!hit && hit.closest('td') === name(), hit && (hit.closest('td') || hit).outerHTML.slice(0, 80));
    select('a', 'node'); renderTableView(true);
    scroller.scrollLeft = scroller.scrollWidth;
    const opaque = () => rgba(css(name()).backgroundColor)[3] === 1;
    ok('a selected row\'s name cell is opaque (Gold)', rowEl('n:a').classList.contains('tv-sel') && opaque(), css(name()).backgroundColor);
    root.setAttribute('data-carino-theme', 'color'); root.setAttribute('data-theme', 'light');
    ok('and on Colourful', opaque(), css(name()).backgroundColor);
    root.setAttribute('data-theme', 'dark');
    ok('and on Colourful dark', opaque(), css(name()).backgroundColor);
    root.setAttribute('data-carino-theme', 'gold'); root.removeAttribute('data-theme');
    const z = (x) => Number(css(x).zIndex) || 0;
    ok('the header stacks over the body, the pinned header over both', z(headEl('type')) > z(name()) && z(headEl('name')) > z(headEl('type')),
      [z(headEl('name')), z(headEl('type')), z(name())].join());
    select(null, null);
    scroller.scrollLeft = scroller.scrollWidth;
    setCursor('n:a', 'type', true);
    const type = cellEl('n:a', 'type');
    ok('a cell the cursor moves to comes out from under the pinned name', name().getBoundingClientRect().left >= sc.left + 0.5
      && type.getBoundingClientRect().left >= name().getBoundingClientRect().right - 0.5,
      `${type.getBoundingClientRect().left} vs ${name().getBoundingClientRect().right}`);

    // Pinned, it still acts as the first column always did.
    scroller.scrollLeft = 0;
    click(name());
    ok('a click on the name selects the device', state.selectedId === 'a' && state.selectedType === 'node');
    name().focus(); key(name(), 'Enter');
    ok('Enter edits the name', !!_tv.editor && name().contains(_tv.editor.el) && name().classList.contains('tv-key'));
    ok('the open cell stacks over its neighbours', z(name()) >= 2, String(z(name())));
    _tv.editor.el.value = 'Renamed';
    key(_tv.editor.el, 'Escape');
    ok('Esc throws it away', !_tv.editor && getNode('a').name === 'PC-A');
    click(grid().querySelector('[data-sort="name"]')); click(grid().querySelector('[data-sort="name"]'));
    ok('sorted by Name, still pinned', grid().querySelector('tbody tr[data-row]').dataset.row === 'n:c' && sticky(headEl('name')) && sticky(name()));
    _tv.sort.devices = null;
    state.tableView = normalizeTableView({ devices: { hidden: ['type'] } });
    renderTableView(true);
    ok('with a column hidden, Name is first and pinned', heads()[0] === 'name' && !heads().includes('type') && headEl('name').classList.contains('tv-key')
      && sticky(name()), heads().join());
    state.tableView = savedTableView; renderTableView(true);
    click(rowEl('n:a').querySelector('[data-expand]'));
    const sub = cellEl('d:a:i1', 'if:name');
    ok('an interface folded open under its device pins its name', !!sub && sub.classList.contains('tv-key') && sticky(sub)
      && rgba(css(sub).backgroundColor)[3] === 1, sub && css(sub).backgroundColor);
    click(rowEl('n:a').querySelector('[data-expand]'));
    showTableTab('interfaces');
    const dev = grid().querySelector('tbody td[data-col="device"]');
    ok('Interfaces: the device column is the pinned one', !!dev && dev.classList.contains('tv-key') && headEl('device').classList.contains('tv-key')
      && !grid().classList.contains('tv-has-exp'));
    showTableTab('devices');
    ok('Devices has the twist column to clear', grid().classList.contains('tv-has-exp'));

    // ---- 2. The unit pick's options ----
    setView('map');
    replaceDocument({ v: DOC_VERSION, nodes: [{ id: 'p', type: 'pc', name: 'P', x: 100, y: 100, interfaces: [{ id: 'e1', name: 'eth0', ip: '' }] },
      { id: 'q', type: 'pc', name: 'Q', x: 300, y: 100, interfaces: [{ id: 'e1', name: 'eth0', ip: '' }] }],
      links: [{ id: 'lp', source: 'p', target: 'q', sourceIface: 'e1', targetIface: '' }] }, { origin: 'file', docId: 'stickycols-map' });
    const opt = () => el('propCableUnit').options[0];
    const host = document.createElement('div'); host.className = 'topo-rail';
    const len = document.createElement('input'); len.className = 'input'; host.appendChild(len);
    document.body.appendChild(host);
    const built = wrapUnitField(len, 'm');
    root.setAttribute('data-carino-theme', 'color'); root.setAttribute('data-theme', 'light');
    ok('Colourful light: the options read, on the card\'s colour', contrast(css(opt()).color, css(opt()).backgroundColor) >= 4.5
      && css(opt()).backgroundColor === token('--bg-card'), `${css(opt()).color} on ${css(opt()).backgroundColor}`);
    ok('so does a pick built by wrapUnitField', contrast(css(built.options[0]).color, css(built.options[0]).backgroundColor) >= 4.5,
      `${css(built.options[0]).color} on ${css(built.options[0]).backgroundColor}`);
    root.style.setProperty('--bg-card', '#172031'); root.style.setProperty('--text', '#e3e3e3');
    ok('Colourful dark: the options follow the card', css(opt()).backgroundColor === 'rgb(23, 32, 49)'
      && contrast(css(opt()).color, css(opt()).backgroundColor) >= 4.5, css(opt()).backgroundColor);
    root.style.removeProperty('--bg-card'); root.style.removeProperty('--text');
    root.setAttribute('data-carino-theme', 'gold'); root.removeAttribute('data-theme');
    ok('Gold: still a dark list, readable', lum(css(opt()).backgroundColor) < 0.02 && contrast(css(opt()).color, css(opt()).backgroundColor) >= 4.5,
      `${css(opt()).color} on ${css(opt()).backgroundColor}`);
    settle();
    const frameEl = built.parentElement, plain = document.createElement('input'); plain.className = 'input'; host.appendChild(plain);
    const same = (p) => css(frameEl)[p] === css(plain)[p];
    ok('the pair\'s frame is an input\'s: background, border, radius',
      ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius'].every(same),
      ['backgroundColor', 'borderTopColor', 'borderTopLeftRadius'].map((p) => `${css(frameEl)[p]}/${css(plain)[p]}`).join(' '));
    host.remove();

    // ---- 3. Port labels ----
    state.settings.advanced = true; applyProfile();
    setMapInk(false);
    select('lp', 'link');
    const label = (bound) => [...el('networkCanvas').querySelectorAll('.port-label')].find((x) => (x.getAttribute('fill') === '#a16207') === bound);
    ok('light map: the bound port in dark amber', !!label(true) && css(label(true)).fill === 'rgb(161, 98, 7)', label(true) && css(label(true)).fill);
    ['blue', 'dark'].forEach((ink) => {
      setMapInk(ink); select('lp', 'link');
      const bg = css(el('canvasContainer')).backgroundColor;
      const c = [label(true), label(false)].map((x) => x && contrast(css(x).fill, bg));
      ok(`${ink} map: both port labels read against it`, c.every((v) => v >= 4.5), c.map((v) => v && v.toFixed(2)).join(' / '));
    });
    ok('an export carries no port label', !/port-label/.test(canvasSvgMarkup().markup));
    setLocale('es'); applyLocale(); select('lp', 'link');
    ok('es: the unbound end says so', !!label(false) && label(false).textContent === 'sin puerto', label(false) && label(false).textContent);
    // The box chips keep clear of (portLabelHalf) holds the label as drawn,
    // a full-width Japanese one too.
    setLocale('ja'); applyLocale(); select('lp', 'link');
    const jaLabel = label(false), jaWidth = jaLabel && jaLabel.getBBox().width;
    ok('ja: the box chips avoid is as wide as the unbound label drawn', !!jaLabel && portLabelHalf(jaLabel.textContent) * 2 >= jaWidth,
       jaLabel && `${portLabelHalf(jaLabel.textContent) * 2} / ${jaWidth}`);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    try { setLocale('en'); applyLocale(); } catch (e) { /* the suite already failed */ }
    setMapInk(savedInk);
    setDialogResponder(quiet);
    if (savedTheme === null) root.removeAttribute('data-carino-theme'); else root.setAttribute('data-carino-theme', savedTheme);
    if (savedMode === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', savedMode);
    root.style.removeProperty('--bg-card'); root.style.removeProperty('--text');
    scroller.style.width = savedWidth;
    state.tableView = savedTableView;
    state.settings.profile = savedProfile; state.settings.advanced = savedAdvanced; applyProfile();
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
