// @realtime @touch 360x780
// The phone's drawer on the narrowest phone, 360x780 (Mobile batch 2; the
// size where the old rail clipped its last 12px). Through window.__touch
// (real touch input, run-cross.mjs): on the plain Smart Home with nothing
// selected and with a device selected, the rail is the only box in it that
// scrolls (textareas aside), a finger swiping up reaches its very end, the
// last control there is inside the rail's box, the ✕ is 44x44 or more, and
// nothing scrolls sideways.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(30); };
  const touch = (type, pts) => window.__touch(type, pts);
  const swipe = async (x0, y0, x1, y1, steps = 8) => {
    await touch('touchStart', [{ x: x0, y: y0, id: 1 }]);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }]);
      await frame();
    }
    await touch('touchEnd', []);
    await settle();
    await wait(250);
  };
  const ws = document.querySelector('.ws');
  const rail = document.querySelector('.topo-rail');
  const drawerOpen = () => ws.classList.contains('drawer-open');
  const box = () => rail.getBoundingClientRect();
  const scrollers = () => [rail, ...rail.querySelectorAll('*')].filter((e) => {
    if (e.tagName === 'TEXTAREA') return false;
    const st = getComputedStyle(e);
    return st.display !== 'none' && /(auto|scroll)/.test(st.overflowY) && e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 1;
  });
  const describe = (list) => list.map((e) => (e.id || e.className || e.tagName) + ' ' + e.clientHeight + '/' + e.scrollHeight).join(', ');
  const lastControl = () => [...rail.querySelectorAll('button, input, select, textarea, summary, a[href]')]
    .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
    .sort((p, q) => q.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom)[0];
  const savedView = state.settings.view;
  const savedPin = libraryPinned();

  const check = async (label) => {
    const list = scrollers();
    ok(label + ': the rail is the only box in it that scrolls', list.length === 1 && list[0] === rail, describe(list));
    rail.scrollTop = 0;
    await settle();
    for (let i = 0, last = -1; i < 30 && rail.scrollTop !== last; i++) {
      last = rail.scrollTop;
      const rb = box();
      await swipe(rb.left + rb.width * 0.7, rb.bottom - 60, rb.left + rb.width * 0.7, rb.top + 140);
    }
    ok(label + ': a finger reaches the rail\'s very end', rail.scrollTop > 0 && Math.abs(rail.scrollTop + rail.clientHeight - rail.scrollHeight) <= 1,
      json([rail.scrollTop, rail.clientHeight, rail.scrollHeight]));
    const lc = lastControl(), lb = lc && lc.getBoundingClientRect();
    ok(label + ': its last control is inside the rail', !!lb && lb.bottom <= box().bottom + 0.5 && lb.top >= box().top,
      lc && `${lc.id || lc.className} ${lb.bottom} / ${box().bottom}`);
    ok(label + ': no horizontal scroll', document.documentElement.scrollWidth <= window.innerWidth, `${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  };

  try {
    ok('this page is a 360x780 touch screen', navigator.maxTouchPoints > 0 && window.innerWidth === 360 && window.innerHeight === 780, json([window.innerWidth, window.innerHeight]));
    setLibraryPinned(false);
    setView('map');
    select(null, null);
    await settle();
    el('handyMenu').click();
    await wait(350); await settle();
    ok('the drawer is open', drawerOpen());
    await check('nothing selected');
    const dev = state.nodes.find((n) => n.type === 'switch') || state.nodes[0];
    ok('Smart Home has a device to select', !!dev);
    if (dev) {
      select(dev.id, 'node');
      await settle();
      await check('a device selected');
    }
    const x = el('railClose'), xb = x.getBoundingClientRect();
    ok('the close button is at least 44x44', xb.width >= 44 && xb.height >= 44, json([xb.width, xb.height]));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLibraryPinned(savedPin);
    if (drawerOpen()) el('handyMenu').click();
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
