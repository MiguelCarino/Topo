// @realtime @touch
// The fleet navbar on a phone (Mobile batch 2; js/mobile.js navReveal,
// css/app.css "The fleet navbar on a phone"). run-cross.mjs opens this on a
// 390x844 touch screen, DPR 2, with window.__touch for real touch input
// (see tests/suites/touchmap.js). What is held here:
//   1. on load the bar is away: out of the flow above the top edge,
//      visibility hidden (so Tab and screen readers skip it), --nav-h 0, the
//      map from the top of the screen, the 72px handle at the top;
//   2. a swipe down that starts in the top band, on the map, shows it sliding
//      in over the content: the camera does not move and the map does not
//      reflow;
//   3. a tap elsewhere hides it; a swipe lower on the map pans and leaves it
//      hidden; a swipe down on the top row (Map | Table) shows it; a swipe
//      up on it hides it; a tap on the handle shows it;
//   4. a few seconds idle hide it, but not while its About window is open;
//      closing that starts the idle count again;
//   5. the reduced view (#simple) too; How to use's Touch line names the
//      gesture; no horizontal scroll and the page never zoomed.
// tests/suites/navpinned.js holds that 1280 with a mouse is unchanged.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const touch = (type, pts) => window.__touch(type, pts);
  // 320 ms: past the bar's 0.22 s slide.
  const tapAt = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); await wait(320); await settle(); };
  const tapEl = async (node) => { const b = node.getBoundingClientRect(); await tapAt(b.left + b.width / 2, b.top + b.height / 2); };
  const swipe = async (x, y0, y1) => {
    await touch('touchStart', [{ x, y: y0, id: 1 }]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x, y: y0 + (y1 - y0) * i / 6, id: 1 }]); await wait(16); }
    await touch('touchEnd', []);
    await wait(320); await settle();   // the 0.22 s slide
  };
  const heldResponder = setDialogResponder(() => true);
  const savedView = state.settings.view, savedAdvanced = state.settings.advanced;
  const nav = el('carinoNav'), handle = el('navHandle'), cv = el('networkCanvas');
  const shown = () => document.documentElement.classList.contains('topo-nav-shown');
  const navBox = () => nav.getBoundingClientRect();
  const cam = () => json({ x: Math.round(state.camera.x), y: Math.round(state.camera.y), z: state.camera.zoom });
  const away = () => !shown() && getComputedStyle(nav).visibility === 'hidden' && navBox().bottom <= 0;
  const out1 = () => getComputedStyle(nav).visibility === 'visible' && Math.abs(navBox().top) < 0.5;

  try {
    ok('this page is a phone', innerWidth === 390 && navigator.maxTouchPoints > 0, `${innerWidth}`);
    setView('map');
    await settle();

    // ---- 1. On load ----
    ok('the bar is away on load', away(), json(navBox()));
    ok('it is out of the flow (fixed)', getComputedStyle(nav).position === 'fixed', getComputedStyle(nav).position);
    ok('--nav-h is 0 here', getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim() === '0px');
    ok('the map starts at the top of the screen', Math.abs(cv.getBoundingClientRect().top) < 0.5, json(cv.getBoundingClientRect()));
    const legal = el('cnLegal');
    legal.focus();
    ok('a hidden bar takes no focus (Tab skips it)', document.activeElement !== legal);
    ok('its buttons are hidden to screen readers too', getComputedStyle(legal).visibility === 'hidden');
    const hb = handle && handle.getBoundingClientRect();
    ok('the handle is at the top, 44px wide or more', !!hb && hb.top === 0 && hb.width >= 44 && getComputedStyle(handle).display !== 'none', json(hb));
    ok('the handle comes just before the bar (Tab order)', handle && handle.nextElementSibling === nav);

    // ---- 2. A swipe down from the top edge, on the map ----
    const camBefore = cam(), cvTop = cv.getBoundingClientRect().top;
    const fromMap = document.elementFromPoint(300, 4);
    ok('the band at x 300 is the map', !!fromMap && !!fromMap.closest('#networkCanvas'), fromMap && fromMap.tagName);
    await swipe(300, 4, 130);
    ok('a swipe down from the top shows the bar', shown() && out1(), json(navBox()));
    ok('and the map did not pan', cam() === camBefore, `${camBefore} -> ${cam()}`);
    ok('nor reflow: it came in over the map', cv.getBoundingClientRect().top === cvTop && getComputedStyle(nav).position === 'fixed');

    // ---- 3. Tap elsewhere, a lower swipe, the top row, swipe up, the handle ----
    await tapAt(200, 640);
    ok('a tap elsewhere hides it', away(), json(navBox()));
    select(null); await settle();
    const before = state.camera.y;
    await swipe(200, 420, 600);
    ok('a swipe lower on the map pans it', Math.abs(state.camera.y - before - 180) < 4, `${before} -> ${state.camera.y}`);
    ok('and leaves the bar away', away());
    const vs = document.querySelector('#viewSwitch [data-view="map"]');
    const vb = vs.getBoundingClientRect();
    const camTop = cam();
    await swipe(vb.left + vb.width / 2, vb.top + vb.height / 2, vb.top + vb.height / 2 + 120);
    ok('a swipe down on the top row shows it', shown() && out1());
    ok('without moving the map', cam() === camTop);
    const nb = navBox();
    await swipe(nb.width / 2, nb.top + 40, nb.top - 40 < 0 ? 2 : nb.top - 40);
    ok('a swipe up on it hides it', away(), json(navBox()));
    await tapAt(195, 7);
    ok('a tap on the handle shows it', shown() && out1());
    ok('the handle says so (aria-expanded)', handle.getAttribute('aria-expanded') === 'true');

    // ---- 4. Idle, and the About window keeping it ----
    await wait(4600);
    ok('a few seconds idle hide it', away());
    await tapAt(195, 7);
    await tapEl(legal);
    const help = nav.querySelector('.cn-help');
    ok('its About window opens', !!help && !help.hidden);
    await wait(4600);
    ok('it stays while the About window is open', shown() && out1() && !help.hidden);
    const x = nav.querySelector('.cn-x');
    if (x) await tapEl(x); else help.hidden = true;
    await settle();
    ok('the About window closed', help.hidden);
    ok('still shown just after', shown());
    await wait(4600);
    ok('then idle hides it again', away());
    // The ? key (or any script) opening About brings the bar with it.
    legal.click();
    await wait(320); await settle();
    ok('About opened while away brings the bar', shown() && out1() && !help.hidden);
    if (x) x.click(); else help.hidden = true;
    await settle();
    await tapAt(200, 640);
    select(null); await settle();
    ok('and a tap elsewhere puts it away after', away());

    // ---- 5. The reduced view; How to use; the page ----
    state.settings.advanced = false; applyProfile(); setView('map');
    await settle();
    ok('the reduced view starts with it away', away());
    const sCam = cam();
    const band = document.elementFromPoint(300, 4);
    await swipe(300, 4, 130);
    ok('and a swipe from the top shows it there', shown() && out1(), band && band.tagName);
    ok('without moving the map', cam() === sCam);
    await tapAt(200, 640);
    select(null);
    state.settings.advanced = savedAdvanced; applyProfile();
    await settle();
    renderShortcutHelp();
    const hint = el('touchHint');
    ok('How to use names the gesture', !!hint && /Swipe down from the top edge to show the menu bar\./.test(hint.textContent), hint && hint.textContent);
    ok('no horizontal scroll', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth}`);
    ok('the page never zoomed', !window.visualViewport || Math.abs(visualViewport.scale - 1) < 0.01, window.visualViewport && visualViewport.scale);
  } catch (e) {
    ok('suite ran without throwing', false, (e && e.stack) || String(e));
  } finally {
    state.settings.advanced = savedAdvanced; applyProfile();
    setView(savedView || 'map');
    setDialogResponder(heldResponder);
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
