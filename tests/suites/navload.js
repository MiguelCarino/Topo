// @realtime @touch @hashes -|simple|setup
// The phone navbar is away on every way in (Mobile batch 2; js/mobile.js
// navReveal). run-cross.mjs loads this three times on a 390x844 touch screen:
// the plain URL, #simple and #setup (each failure is marked with its URL).
// Each load: the bar is off the top and hidden to Tab and screen readers,
// --nav-h is 0, the handle is drawn, the page has no horizontal scroll.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const json = (v) => JSON.stringify(v);
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  await frame(); await frame();
  try {
    const nav = document.getElementById('carinoNav'), handle = document.getElementById('navHandle');
    ok('this page is a phone', innerWidth === 390 && navigator.maxTouchPoints > 0, `${innerWidth} ${location.hash}`);
    ok('the bar is there', !!nav);
    const b = nav.getBoundingClientRect();
    ok('the bar is away on load', !document.documentElement.classList.contains('topo-nav-shown') && b.bottom <= 0, json(b));
    ok('hidden to Tab and screen readers', getComputedStyle(nav).visibility === 'hidden');
    ok('--nav-h is 0', getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim() === '0px');
    const hb = handle && handle.getBoundingClientRect();
    ok('the handle is drawn at the top', !!hb && hb.top === 0 && hb.width >= 44, json(hb));
    ok('no horizontal scroll', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth}`);
  } catch (e) {
    ok('suite ran without throwing', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
