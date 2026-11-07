// @realtime @touch 360x780
// The on-screen keyboard on a phone (Mobile batch 3; js/mobile.js the
// keyboard section, css/app.css html.topo-kb, js/app.js mapViewport). On a
// 360x780 touch screen through window.__touch (real touch input,
// run-cross.mjs). Chromium cannot raise an on-screen keyboard, so its
// geometry is checked through a stand-in window.visualViewport and
// window.syncKeyboard, the handler js/mobile.js hangs on the real one.
//   1. keyboardUp: a shrink under 120px (the URL bar, a shortcut strip) is
//      no keyboard, a larger one is, and an unmeasured base never is;
//   2. a device selected, so the selection bar shows; what of the handy bar,
//      the selection bar, the docbar and the banners is showing is noted;
//   3. a tap in the search box gives it the focus and puts topo-kb on <html>,
//      and every noted bar is then hidden and takes no tap;
//   4. a window resize while typing (syncBars measures the selection bar) and
//      then a blur: the class goes, the bars come back, and the selection bar
//      is no more compact than it was;
//   5. mapViewport is the same typing or not (it measures the bars as they
//      will be);
//   6. focus moving field to field never takes the class off;
//   7. a tick, a select, a date and a read-only field never put it on;
//   8. with a stand-in viewport: a prompt's scrim takes the height and the
//      top the keyboard leaves, with its field and its OK inside; the keyboard
//      put away with the field still focused brings the bars back, and its
//      return hides them again; a pinch zoom undoes the fit;
//   9. the report dialog's last header field is scrolled above its sticky
//      actions, and Download stays in sight;
//  10. the same as 3 and 4 on a 390x844 screen;
//  11. no horizontal scroll.
// Outside run-cross (a browser pane under mobile emulation, with no __touch
// or __viewport) a field is focused by focus() instead of a tap, and 10 is
// left out.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // A frame, or 100ms in a background tab that draws none.
  const frame = () => Promise.race([new Promise((r) => requestAnimationFrame(() => r())), wait(100)]);
  const settle = async () => { await frame(); await frame(); await wait(30); };
  const hasTouch = typeof window.__touch === 'function';
  const touch = (type, pts) => window.__touch(type, pts);
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); await settle(); await wait(350); };
  const mid = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  // A page whose window does not have the system focus (a browser pane in the
  // background) moves document.activeElement on focus() and blur() but fires
  // no focusin or focusout, which is what js/mobile.js listens to; there the
  // events are sent by hand. run-cross's page has the focus, so it never is.
  const focusOn = (node) => {
    const from = document.activeElement;
    node.focus();
    if (document.hasFocus()) return;
    if (from && from !== node && from !== document.body) from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: node }));
    node.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: from }));
  };
  const blurOff = (node) => {
    node.blur();
    if (!document.hasFocus()) node.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  };
  const tapField = async (node) => {
    await ready(node);
    if (hasTouch) { const p = mid(node); await tap(p.x, p.y); }
    if (document.activeElement !== node) focusOn(node);
    await settle();
  };
  // The landing going leaves the search box's 150ms visibility transition
  // (.input's transition: all) to run out; a page in a background tab has no
  // animation frames to run it on, so after a short wait it is finished here.
  const ready = async (node) => {
    for (let i = 0; i < 20 && node.getAnimations().length; i++) await wait(25);
    node.getAnimations().forEach((a) => a.finish());
  };
  const root = document.documentElement;
  const typing = () => root.classList.contains('topo-kb');
  const BARS = ['handyBar', 'selBar', 'docBar', 'readOnlyBanner', 'storageBanner'];
  const visible = (node) => {
    if (!node || node.hidden || node.classList.contains('hidden')) return false;
    const cs = getComputedStyle(node), r = node.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const SIZES = ['compact', 'compact-all', 'noname'];
  const sizes = () => SIZES.filter((c) => el('selBar').classList.contains(c));
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
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
  const fake = () => ({ width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1, addEventListener() {}, removeEventListener() {} });

  const D = (id, x, y, ip) => ({ id, type: 'pc', name: 'PC ' + id.toUpperCase(), x, y, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const doc = { v: DOC_VERSION, nodes: [D('a', 0, 0, '10.0.0.11/24'), D('b', 220, 0, '10.0.0.12/24')], links: [], annotations: [] };

  // 3 and 4, once per screen size.
  const typeAndLeave = async (label) => {
    select('a', 'node');
    await settle();
    const before = BARS.filter((id) => visible(el(id)));
    const centres = Object.fromEntries(before.map((id) => [id, mid(el(id))]));
    const was = sizes();
    ok(`${label}: the selection bar and the handy bar show`, before.includes('selBar') && before.includes('handyBar'), json(before));
    await tapField(el('queryInput'));
    ok(`${label}: a tap in the search box focuses it`, document.activeElement === el('queryInput'), document.activeElement && document.activeElement.id);
    ok(`${label}: and puts topo-kb on <html>`, typing());
    for (const id of before) {
      const node = el(id), c = centres[id], hit = document.elementFromPoint(c.x, c.y);
      ok(`${label}: #${id} is hidden while typing`, getComputedStyle(node).visibility === 'hidden', getComputedStyle(node).visibility);
      ok(`${label}: and takes no tap`, !hit || !node.contains(hit), hit && (hit.id || hit.className));
    }
    // A window resize while the bars are hidden: syncBars measures the
    // selection bar's fit, which must not stick a smaller size on it.
    window.dispatchEvent(new Event('resize'));
    await settle();
    const during = mapViewport();
    blurOff(el('queryInput'));
    await settle();
    ok(`${label}: the blur takes topo-kb off`, !typing());
    ok(`${label}: and every bar is back`, before.every((id) => visible(el(id))), json(BARS.filter((id) => visible(el(id)))));
    ok(`${label}: the selection bar is the size it was`, json(sizes()) === json(was), `${json(sizes())} vs ${json(was)}`);
    ok(`${label}: mapViewport is the same typing or not`, json(during) === json(mapViewport()), `${json(during)} vs ${json(mapViewport())}`);
  };

  try {
    ok('this page is on a touch screen', navigator.maxTouchPoints > 0 && matchMedia('(max-width: 900px) and (pointer: coarse)').matches, `${navigator.maxTouchPoints} ${innerWidth}`);

    // ---- 1. keyboardUp ----
    const up = window.keyboardUp;
    ok('keyboardUp is published', typeof up === 'function');
    ok('no shrink is no keyboard', up(780, 780) === false);
    ok('a 54px strip is no keyboard', up(780, 726) === false);
    ok('a 360px shrink is a keyboard', up(780, 420) === true);
    ok('an unmeasured base is never a keyboard', up(0, 400) === false);

    if (landingIsOpen()) closeLanding();
    replaceDocument(doc, { origin: 'file', docId: 'touch-keyboard' });
    setView('map');
    state.camera.x = 60; state.camera.y = 200; state.camera.zoom = 1; applyCamera();
    renderCanvasOnly();
    await settle();

    // ---- 2 to 5 ----
    await typeAndLeave(`${innerWidth}x${innerHeight}`);

    // ---- 6. Field to field ----
    const removed = [];
    const mo = new MutationObserver(() => { if (!typing()) removed.push(document.activeElement && (document.activeElement.id || document.activeElement.tagName)); });
    const extra = document.createElement('input');
    extra.type = 'text'; extra.className = 'input';
    el('canvasContainer').appendChild(extra);
    await tapField(el('queryInput'));
    ok('typing again', typing());
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    focusOn(extra); await settle();
    focusOn(el('queryInput')); await settle();
    mo.disconnect();
    ok('field to field never takes the class off', removed.length === 0 && typing(), json(removed));
    blurOff(el('queryInput')); extra.remove();
    await settle();
    ok('and the blur does', !typing());

    // ---- 7. Controls that raise no keyboard ----
    const tick = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const pick = document.createElement('select'); pick.appendChild(new Option('One', '1'));
    const date = Object.assign(document.createElement('input'), { type: 'date' });
    const ro = Object.assign(document.createElement('input'), { type: 'text', readOnly: true });
    const noKeys = Object.assign(document.createElement('input'), { type: 'text' }); noKeys.setAttribute('inputmode', 'none');
    for (const [name, node] of [['a tick', tick], ['a select', pick], ['a date', date], ['a read-only field', ro], ['inputmode=none', noKeys]]) {
      el('canvasContainer').appendChild(node);
      focusOn(node); await settle();
      ok(`${name} puts no topo-kb on`, document.activeElement === node && !typing());
      blurOff(node); node.remove();
    }
    await settle();

    // ---- 8. A prompt above the keyboard ----
    const vv = fake();
    fakeViewport(vv);
    ok('the stand-in viewport took', window.visualViewport === vv);
    // The real modal, not the suite's stand-in answer.
    const quiet = setDialogResponder(null);
    const asked = askPrompt('Name?');
    await settle();
    const scrim = el('topoAsk'), input = el('topoAskInput');
    ok('the prompt is open', !scrim.hidden);
    focusOn(input); await settle();
    ok('its field has the focus and topo-kb is on', document.activeElement === input && typing());
    vv.height = 380; window.syncKeyboard({ type: 'resize' }); await settle();
    ok('--kb-h is the height the keyboard leaves', root.style.getPropertyValue('--kb-h') === '380px', root.style.getPropertyValue('--kb-h'));
    let sr = scrim.getBoundingClientRect();
    ok('the scrim covers only that', Math.abs(sr.top) <= 1 && Math.abs(sr.height - 380) <= 1, `${sr.top} ${sr.height}`);
    const okBtn = scrim.querySelector('.btn-primary, .cs-btn.primary');
    const ir = input.getBoundingClientRect(), br = okBtn && okBtn.getBoundingClientRect();
    ok('the field is above the keyboard', ir.top >= 0 && ir.bottom <= 380, `${ir.top} ${ir.bottom}`);
    ok('and so is the OK button', !!br && br.top >= 0 && br.bottom <= 380, br && `${br.top} ${br.bottom}`);
    vv.offsetTop = 100; window.syncKeyboard({ type: 'scroll' }); await settle();
    sr = scrim.getBoundingClientRect();
    ok('a panned viewport moves the scrim with it', Math.abs(sr.top - 100) <= 1, String(sr.top));
    vv.offsetTop = 0; vv.height = 780; window.syncKeyboard({ type: 'resize' }); await settle();
    ok('the keyboard put away with the field focused: topo-kb off', document.activeElement === input && !typing());
    ok('and the fit is gone', !root.style.getPropertyValue('--kb-h') && !root.style.getPropertyValue('--kb-top'));
    vv.height = 380; window.syncKeyboard({ type: 'resize' }); await settle();
    ok('the keyboard back: topo-kb on again', typing());
    vv.scale = 1.6; window.syncKeyboard({ type: 'resize' }); await settle();
    sr = scrim.getBoundingClientRect();
    ok('a pinch zoom drops the fit', !root.style.getPropertyValue('--kb-h') && Math.abs(sr.height - innerHeight) <= 1, `${sr.height}`);
    ok('and keeps the bars away', typing());
    realViewport();
    ok('the real viewport is back', window.visualViewport === real);
    // The prompt's Cancel; askPrompt resolves null.
    const cancel = [...scrim.querySelectorAll('button')].find((b) => !b.classList.contains('primary') && !b.classList.contains('btn-primary'));
    if (cancel) cancel.click(); else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    ok('the prompt closes', (await Promise.race([asked, wait(1500).then(() => 'timeout')])) !== 'timeout');
    // The field went with the dialog; see focusOn for a page without the focus.
    // A page with the focus blurs a field its dialog hid; one without keeps
    // it as the active element, with no event.
    if (!document.hasFocus()) blurOff(input);
    setDialogResponder(quiet);
    await settle(); await wait(20);
    ok('and topo-kb is gone', !typing());

    // ---- 9. The report's last header field ----
    el('reportBtn').click();
    await settle(); await wait(100);
    const rep = el('reportDialog');
    ok('the report dialog opens', rep && !rep.classList.contains('hidden'));
    const fields = [...el('reportFields').querySelectorAll('input[type="text"], input:not([type]), textarea')];
    const last = fields[fields.length - 1];
    ok('it has header fields', !!last, String(fields.length));
    if (last) {
      const rv = fake(); rv.height = 360;
      fakeViewport(rv);
      focusOn(last); await settle();
      window.syncKeyboard({ type: 'resize' });
      await wait(250); await settle();
      const acts = rep.querySelector('.rp-actions'), ah = acts ? acts.getBoundingClientRect().height : 0;
      const lr = last.getBoundingClientRect(), dl = el('reportBuildBtn').getBoundingClientRect();
      ok('the last header field is above the keyboard and the actions', lr.top >= 0 && lr.bottom <= 360 - ah + 1, `${lr.top} ${lr.bottom} / ${360 - ah}`);
      ok('and Download is in sight', dl.bottom <= 361 && dl.top >= 0, `${dl.top} ${dl.bottom}`);
      blurOff(last);
      realViewport();
    }
    const close = rep && rep.querySelector('#reportCancelBtn, .modal-x, [data-close]');
    if (close) close.click(); else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();

    // ---- 10. A 390px phone ----
    if (typeof window.__viewport === 'function') {
      await window.__viewport(390, 844);
      await settle(); await wait(200);
      await typeAndLeave('390x844');
    }

    // ---- 11. Width ----
    ok('no horizontal scroll', root.scrollWidth <= innerWidth, `${root.scrollWidth} > ${innerWidth}`);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    realViewport();
    setDialogResponder(heldResponder);
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
