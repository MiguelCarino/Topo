// @realtime @touch 360x780
// Touch targets on a phone, part 1 of 3 (Mobile review M60, batch 4 M21-M29):
// the landing (empty, then with a saved network and the binder bar), the map's
// chrome (top bar, zoom column, handy bar, document bar, a device tapped and
// its selection bar), and the drawer: its header, actions, every panel tab
// (Problems with a report filed), a device's pane with every section open, the
// Export and Tidy menus, the library's three tabs. Each screen through
// tests/fixtures/touchaudit.js: every visible control takes a tap over 44x44,
// every field is 16px and 44 tall, nothing past the right edge, no sideways
// scroll, and no console error. The allow-list is TOUCH_EXEMPT there, each
// entry with its reason. touchsizes2 covers the table, search and rack;
// touchsizes3 the dialogs, the merge review, restore, the problem sheet,
// provider mode, Simple and the other screen sizes. A desktop's mouse cannot
// be had here (a touch context stays coarse), so the 1280 desktop's look is
// checked outside the suites (docs/MOBILE.md, "How batches 4 and 5 landed").
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
  const tapEl = async (e) => { const r = e.getBoundingClientRect(); await tap(r.left + r.width / 2, r.top + r.height / 2); };
  const ws = document.querySelector('.ws');
  const rail = document.querySelector('.topo-rail');
  const drawerOpen = () => ws.classList.contains('drawer-open');
  // One screen: the probe, and the box that scrolls it page by page.
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

  try {
    await __media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    ok('this page is a 360x780 touch screen', navigator.maxTouchPoints > 0 && innerWidth === 360 && innerHeight === 780, `${innerWidth}x${innerHeight}`);

    // ---- The landing, empty and with a saved network ----
    const savedLib = typeof loadLibrary === 'function' ? loadLibrary() : null;
    persistLibrary({});
    openLanding(false);
    await settle();
    ok('the landing is open', document.body.classList.contains('landing-open'));
    await screen('landing, nothing saved', el('landing'));
    // M50: a touch screen has nothing to drop, so the line says open.
    const dropP = el('landing').querySelector('.landing-drop p');
    ok('M50 on touch the landing says open, not drop', dropP.innerText.includes('open a .json') && !/drop a/i.test(dropP.innerText), dropP.innerText);
    ok('M50 Open a file has a space after 📂', /^📂 \S/.test(el('landingOpenFileBtn').textContent.trim()), el('landingOpenFileBtn').textContent);
    setLocale('ja'); applyStaticI18n();
    ok('M50 in Japanese too, and a space after 📂', dropP.innerText.includes('「ファイルを開く」') && /^📂 \S/.test(el('landingOpenFileBtn').textContent.trim()), dropP.innerText);
    setLocale('en'); applyStaticI18n();
    loadDocState(templatesData.house); autoBindLinks();
    librarySave('Casa Roma');
    renderLanding();
    await settle();
    ok('the binder bar shows with a saved network', !!el('binderLinkBtn') && el('binderLinkBtn').getClientRects().length > 0);
    await screen('landing, one network saved', el('landing'));
    const handle = el('navHandle');
    if (handle) {
      const hb = handle.getBoundingClientRect();
      ok('on the landing the navbar handle is 44 tall', hb.height >= 44 && hb.width >= 44, `${hb.width}x${hb.height}`);
    }
    closeLanding();
    if (savedLib) persistLibrary(savedLib); else persistLibrary({});
    replaceDocument(templatesData.house, { origin: 'template' });
    setView('map');
    select(null, null);
    await settle(); await wait(200);

    // ---- The map's chrome ----
    await screen('map: top bar, zoom column, handy bar, document bar');
    // The probe's own check: zoom buttons shrunk to 30px inside the column's
    // overflow: hidden (a clip narrower than 44 that does not scroll) are
    // measured and fail, not skipped as scrolled away.
    {
      const st = document.createElement('style');
      st.textContent = '.zoom-ctl button { width: 30px !important; height: 30px !important; min-width: 30px !important; min-height: 30px !important; }';
      document.head.appendChild(st); await settle();
      const r = window.touchAudit('self-test: small zoom buttons');
      st.remove(); await settle();
      ok('self-test: the probe fails zoom buttons shrunk to 30px', r.lines.some((l) => /zoomInBtn.*hit short/.test(l)), JSON.stringify(r.lines.slice(0, 3)));
    }
    const hb2 = el('navHandle') && el('navHandle').getBoundingClientRect();
    ok('in the full editor the handle stays a strip over the search box\'s row', !hb2 || hb2.height <= 16, hb2 && `${hb2.height}`);
    const dev = state.nodes.find((n) => n.type === 'router') || state.nodes[0];
    const g = el('ui-node-' + dev.id);
    if (g) await tapEl(g);
    ok('a device tapped shows the selection bar', !!document.querySelector('.sel-bar:not([hidden])'));
    await screen('map: a device selected, the selection bar');

    // ---- The drawer ----
    if (!drawerOpen()) await tapEl(el('handyMenu'));
    await wait(150); await settle();
    ok('the drawer is open', drawerOpen());
    const nb = el('drawerNavBtn');
    const nbr = nb && nb.getBoundingClientRect();
    ok('the drawer\'s header has the Carino bar\'s 44x44 button', !!nbr && nbr.width >= 44 && nbr.height >= 44, nbr && `${nbr.width}x${nbr.height}`);
    // A device's pane, every section open.
    el('configTabBtn').click();
    rail.querySelectorAll('details').forEach((d) => { d.open = true; });
    await screen('drawer: a router\'s Configuration, every section open', rail);
    const pc = state.nodes.find((n) => n.type === 'pc' && (n.interfaces || []).length);
    if (pc) {
      select(pc.id, 'node'); await settle();
      el('configTabBtn').click();
      rail.querySelectorAll('details').forEach((d) => { d.open = true; });
      await screen('drawer: a PC\'s interfaces', rail);
    }
    select(null, null); await settle();
    // A report filed, so Problems shows.
    const TI = window.TopoIncidents;
    if (TI) await TI.createIncident({ symptom: 'internet', nodeIds: [dev.id], text: 'No internet since this morning', name: 'Ana', phone: '555-1', remember: false });
    await settle();
    for (const id of ['configTabBtn', 'diagTabBtn', 'netTabBtn', 'groupTabBtn', 'wifiTabBtn', 'providerTabBtn', 'findTabBtn', 'incTabBtn']) {
      const b = el(id);
      if (!b || b.hidden || !b.getClientRects().length) { if (id === 'incTabBtn') ok('the Problems tab shows with a report filed', false); continue; }
      b.click(); await settle();
      rail.querySelectorAll('.rail-props details').forEach((d) => { d.open = true; });
      await screen(`drawer: the ${b.textContent.trim().replace(/\s+/g, ' ')} tab`, rail);
    }
    el('configTabBtn').click();
    // The library's tabs (Blocks holds the shipped blocks' cards).
    for (const lt of ['nodes', 'templates', 'blocks']) {
      const b = document.querySelector(`#libraryTabs [data-tab="${lt}"]`);
      if (!b) continue;
      b.click(); await settle();
      rail.querySelectorAll('.tpl-examples').forEach((d) => { d.open = true; });
      await screen(`drawer: the library's ${lt} tab`, rail);
    }
    document.querySelector('#libraryTabs [data-tab="nodes"]')?.click();
    // The Tidy and Export menus.
    rail.scrollTop = 0; await settle();
    for (const id of ['tidyMenuBtn', 'exportMenuBtn']) {
      const b = el(id);
      if (!b) continue;
      await tapEl(b);
      const open = b.getAttribute('aria-expanded') === 'true';
      ok(`the ${id} menu opens`, open);
      await screen(`drawer: the ${id} menu`, rail);
      if (open) b.click();
      await settle();
    }
    // The ⌃ button brings the Carino bar and closes the drawer.
    await tapEl(el('drawerNavBtn'));
    await wait(100);
    ok('the drawer\'s ⌃ closes the drawer and brings the Carino bar', !drawerOpen() && document.documentElement.classList.contains('topo-nav-shown'));
    document.documentElement.classList.remove('topo-nav-shown');

    ok('no console error', !errors.length, errors.slice(0, 4).join(' | '));
  } catch (e) {
    ok('the suite ran to its end', false, String(e && e.stack || e).slice(0, 300));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 400); });
