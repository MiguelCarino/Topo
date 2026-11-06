// @realtime
// Above the phone breakpoint the fleet navbar is as it always was (Mobile
// batch 2 hides it only below 900px: js/mobile.js navReveal, css/app.css).
// run-cross.mjs opens this at Playwright's 1280x720 with a mouse. Held here:
// the bar sticks at the top in the page's flow, visible, 60px, --nav-h 60px,
// the map under it; there is no handle; the pointer at the top, a click
// elsewhere and a few idle seconds change nothing; How to use has no swipe.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const savedView = state.settings.view;
  const nav = el('carinoNav'), cv = el('networkCanvas'), handle = el('navHandle');
  const pinned = () => {
    const cs = getComputedStyle(nav), b = nav.getBoundingClientRect();
    return cs.position === 'sticky' && cs.visibility === 'visible' && Math.abs(b.top) < 0.5 && b.height >= 59;
  };
  try {
    ok('this page is wide, with a mouse', innerWidth > 900 && !matchMedia('(pointer: coarse)').matches, `${innerWidth}`);
    setView('map');
    await settle();
    ok('the bar is pinned at the top, in the flow', pinned(), json(nav.getBoundingClientRect()));
    ok('--nav-h is the bar\'s 60px', getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim() === '60px');
    ok('the map starts under it', Math.abs(cv.getBoundingClientRect().top - nav.getBoundingClientRect().bottom) < 0.5, json([cv.getBoundingClientRect().top, nav.getBoundingClientRect().bottom]));
    ok('no handle here', !handle || getComputedStyle(handle).display === 'none');
    ok('the reveal class is off', !document.documentElement.classList.contains('topo-nav-shown'));
    const legal = el('cnLegal');
    legal.focus();
    ok('its buttons take focus as before', document.activeElement === legal);
    legal.blur();
    window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 600, clientY: 2, bubbles: true }));
    cv.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', clientX: 600, clientY: 400, bubbles: true }));
    await wait(4400);
    ok('the pointer, a click elsewhere and idle change nothing', pinned() && !document.documentElement.classList.contains('topo-nav-shown'));
    renderShortcutHelp();
    ok('How to use has no swipe line here', !/Swipe down from the top edge/.test(el('shortcutBody').textContent));
    ok('no horizontal scroll', document.documentElement.scrollWidth <= innerWidth);
  } catch (e) {
    ok('suite ran without throwing', false, (e && e.stack) || String(e));
  } finally {
    setView(savedView || 'map');
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
