// A narrow window with a mouse keeps the fleet navbar pinned (Mobile batch 2:
// js/mobile.js navReveal and css/app.css hide it only on a touch screen 900px
// wide or less). run.sh's headless window is under 900px with a mouse, so the
// drawer layout is on here and the bar must still be as it always was.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  try {
    const nav = el('carinoNav'), cs = getComputedStyle(nav), b = nav.getBoundingClientRect();
    ok('this window is narrow, with a mouse', innerWidth <= 900 && !matchMedia('(pointer: coarse)').matches, `${innerWidth}`);
    ok('the drawer layout is on', matchMedia('(max-width: 900px)').matches);
    ok('the bar sticks at the top, in the flow, visible', cs.position === 'sticky' && cs.visibility === 'visible' && Math.abs(b.top) < 0.5 && b.height >= 59, `${cs.position} ${cs.visibility} ${b.top} ${b.height}`);
    ok('--nav-h is 60px', getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim() === '60px');
    const h = el('navHandle');
    ok('the handle exists but is not drawn', !!h && getComputedStyle(h).display === 'none');
    h.click();
    ok('a click on it changes nothing here', !document.documentElement.classList.contains('topo-nav-shown'));
    renderShortcutHelp();
    ok('How to use has no swipe line', !/Swipe down from the top edge/.test(el('shortcutBody').textContent));
  } catch (e) {
    ok('suite ran without throwing', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
