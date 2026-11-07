// The desktop side of tests/suites/touchkeyboard.js (Mobile batch 3;
// js/mobile.js the keyboard section). This run is a desktop window with a
// fine pointer, where a focused field has no on-screen keyboard, so nothing
// here may change:
//   1. keyboardUp's pure cases, the same as in touchkeyboard.js;
//   2. a focused search box puts no topo-kb on <html> and sets no --kb-top or
//      --kb-h, and the docbar and the handy bar are as they were (this also
//      runs in a narrow window with a mouse, where the handy bar shows);
//   3. a prompt with its field focused and a stand-in visual viewport 300px
//      tall: still no class, the scrim covers the whole window, and the
//      dialog's max-height is what it was;
//   4. mapViewport is the same before and during the focus.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tick = () => wait(20);
  // The landing going leaves the search box's 150ms visibility transition
  // (.input's transition: all) to run out; a page in a background tab has no
  // animation frames to run it on, so after a short wait it is finished here.
  const ready = async (node) => {
    for (let i = 0; i < 20 && node.getAnimations().length; i++) await wait(25);
    node.getAnimations().forEach((a) => a.finish());
  };
  const root = document.documentElement;
  const noVars = () => !root.style.getPropertyValue('--kb-top') && !root.style.getPropertyValue('--kb-h');
  const real = window.visualViewport;
  let faked = false;
  const fakeViewport = (fake) => {
    try { window.visualViewport = fake; } catch (e) { /* a getter-only window */ }
    if (window.visualViewport !== fake) Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    faked = true;
  };
  const realViewport = () => {
    if (!faked) return;
    try { delete window.visualViewport; } catch (e) { /* not a defined property */ }
    if (window.visualViewport !== real) { try { window.visualViewport = real; } catch (e) { /* see above */ } }
    if (window.visualViewport !== real) Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => real });
    faked = false;
  };

  try {
    ok('this is a fine pointer', !matchMedia('(pointer: coarse)').matches);

    // ---- 1. keyboardUp ----
    const up = window.keyboardUp;
    ok('keyboardUp is published', typeof up === 'function');
    ok('no shrink is no keyboard', up(780, 780) === false);
    ok('a 54px strip is no keyboard', up(780, 726) === false);
    ok('a 360px shrink is a keyboard', up(780, 420) === true);
    ok('an unmeasured base is never a keyboard', up(0, 400) === false);

    // ---- 2 and 4. The search box ----
    // A network open and the landing put away (a page with no ?profile opens
    // on it), so nothing else is holding the focus.
    const D = (id, x, ip) => ({ id, type: 'pc', name: id.toUpperCase(), x, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
    if (landingIsOpen()) closeLanding();
    replaceDocument({ v: DOC_VERSION, nodes: [D('a', 0, '10.0.0.11/24'), D('b', 220, '10.0.0.12/24')], links: [], annotations: [] },
      { origin: 'file', docId: 'keyboard-desk' });
    setView('map');
    await tick();
    const doc = el('docBar');
    const docShown = !doc.classList.contains('hidden');
    const docBefore = docShown ? [getComputedStyle(doc).visibility, getComputedStyle(doc).bottom] : null;
    const mapBefore = mapViewport();
    // Not drawn in a wide window, showing in a narrow one with a mouse (the
    // handy bar follows the width alone); either way the focus changes neither.
    const handyNow = () => { const cs = getComputedStyle(el('handyBar')); return [cs.display, cs.visibility]; };
    const handyBefore = handyNow();
    await ready(el('queryInput'));
    el('queryInput').focus();
    await tick();
    ok('the search box has the focus', document.activeElement === el('queryInput'));
    ok('no topo-kb on <html>', !root.classList.contains('topo-kb'));
    ok('no --kb-top or --kb-h', noVars());
    if (docShown) ok('the docbar is where it was', json([getComputedStyle(doc).visibility, getComputedStyle(doc).bottom]) === json(docBefore));
    ok('the handy bar is as it was', json(handyNow()) === json(handyBefore), `${json(handyNow())} vs ${json(handyBefore)}`);
    ok('mapViewport is the same during the focus', json(mapViewport()) === json(mapBefore), `${json(mapViewport())} vs ${json(mapBefore)}`);
    el('queryInput').blur();
    await tick();

    // ---- 3. A prompt with a short viewport ----
    const quiet = setDialogResponder(null);
    const asked = askPrompt('Name?');
    await tick();
    const scrim = el('topoAsk'), input = el('topoAskInput'), modal = scrim.querySelector('.modal');
    const maxBefore = getComputedStyle(modal).maxHeight;
    fakeViewport({ width: innerWidth, height: 300, offsetTop: 0, offsetLeft: 0, scale: 1, addEventListener() {}, removeEventListener() {} });
    input.focus();
    await tick();
    window.syncKeyboard({ type: 'resize' });
    await tick();
    ok('the prompt\'s field has the focus', document.activeElement === input);
    ok('still no topo-kb', !root.classList.contains('topo-kb') && noVars());
    const sr = scrim.getBoundingClientRect();
    ok('the scrim covers the whole window', Math.abs(sr.top) <= 1 && Math.abs(sr.height - innerHeight) <= 1, `${sr.top} ${sr.height}`);
    ok('the dialog\'s max-height is what it was', getComputedStyle(modal).maxHeight === maxBefore, `${getComputedStyle(modal).maxHeight} vs ${maxBefore}`);
    realViewport();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const answer = await Promise.race([asked, wait(1500).then(() => 'timeout')]);
    ok('Esc closes the prompt', answer === null, String(answer));
    setDialogResponder(quiet);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    realViewport();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
