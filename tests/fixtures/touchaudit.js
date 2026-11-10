// The phone's target probe (Mobile review M60), shared by
// tests/suites/touchsizes.js, touchsizes2.js and touchsizes3.js. Loaded into the
// page with a <script src> (the page's CSP allows only its own files).
//
// window.touchAudit(label) measures what is on the screen now:
//   - every visible interactive control a finger can reach must take a tap
//     over a 44x44 box around its centre: elementFromPoint at the box's four
//     edges (less half a pixel for a DPR 2 screen's rounding) must land on the
//     control, inside it, on its <label>, or inside the [data-hitbox] cell that
//     holds it. A point off the screen passes (the edge is part of the target).
//     A ::after hit area counts, since it hits as its element.
//   - a control whose centre lands on ANOTHER control has its tap stolen: FAIL.
//     One under a non-interactive overlay (the drawer's scrim, a dialog's
//     backdrop) is skipped, as is one under a sticky bar of its own scroller
//     (the drawer's header and tabs, a table's head): the suite scrolls it
//     clear and measures it there. Nothing measured at all: the screen was
//     never reached, FAIL.
//   - a field a finger types into is 16px or more (iOS zooms otherwise) and
//     44px tall (decision D2, docs/MOBILE.md).
//   - nothing runs past the right edge of the screen, unless a box that
//     scrolls sideways (the table, its tabs) holds it; the page never scrolls
//     sideways.
// It returns { lines: [...FAIL reasons], measured, skipped }.
(function () {
  'use strict';

  // The allow-list: controls exempt from the 44px rule, each with its reason.
  // Nothing else is. A control that matches is not measured for size (a field
  // still is for its 16px, and everything for the right edge).
  const TOUCH_EXEMPT = [
    // The map's own drawing (devices, cables, a group's collapse badge, a
    // host's fold badge): drawn in map units, so it scales with the zoom, and a
    // finger on it is the map's gesture code's (touchmap, with its slop).
    { sel: '#canvasContainer svg, #canvasContainer svg *', why: 'map drawing, scales with zoom' },
    // A rack's cable lines: 14px-wide strokes on a phone, lines not boxes.
    { sel: '.rk-hit, .rk-cabling, .rk-cabling *', why: 'rack cable line' },
    // Text links inside a sentence: growing them breaks the line they read in.
    { sel: 'p a[href], .hint a, [data-carino-about] a, #inheritNote .link-btn, .rail-note .link-btn, .model-split-note .link-btn, .link-btn.vendor-use', why: 'text link inside a sentence' },
    // The navbar's handle in the full editor: there it is the strip a finger
    // swipes down from, kept 14px so it does not cover the search box. Its tap
    // is the drawer header's ⌃ button, #drawerNavBtn (decision D4).
    { sel: '.nav-handle', when: () => { const b = document.querySelector('.topo-topbar'); return !!(b && b.getClientRects().length && getComputedStyle(b).display !== 'none'); }, why: 'edge-swipe strip; #drawerNavBtn is its tap' },
  ];
  // Overlays that are no control: a control under one is out of reach now,
  // not broken.
  const OVERLAYS = '.ws-scrim, .modal-scrim, #landing-scrim';
  // Layers over the whole screen: what lies under one is behind it.
  const LAYERS = '#landing, .modal-scrim';
  // Sticky bars over a scroller's content.
  const STICKY = '#railHead, .topo-rail .cfg-tabs, .tv-grid thead th, .rk-stable thead, .rk-main, .rpv-actions, .modal-head, .modal-foot';
  // The map's bars that float over the table and the rack.
  const FLOATING = '.topo-docbar, .handy-bar, .sel-bar, .link-banner, .alert.topo-readonly, .alert.topo-storage';
  const CANDIDATES = 'button, a[href], input:not([type="hidden"]):not([type="file"]), select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="option"], [tabindex]:not([tabindex="-1"])';
  const NOT_FIELD = /^(checkbox|radio|range|color|file|button|submit|reset|image)$/;

  const describe = (e) => {
    let s = e.tagName.toLowerCase();
    if (e.id) s += '#' + e.id;
    else if (typeof e.className === 'string' && e.className.trim()) s += '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.');
    const txt = (e.getAttribute('aria-label') || e.textContent || e.value || e.title || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return s + (txt ? ` "${txt}"` : '');
  };
  const exempt = (e) => TOUCH_EXEMPT.some((x) => { try { return e.matches(x.sel) && (!x.when || x.when()); } catch (err) { return false; } });
  const isCandidate = (e) => { try { return e.matches(CANDIDATES); } catch (err) { return false; } };
  const shown = (e) => {
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden && n.tagName !== 'BODY') return false;
      const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse' || +st.opacity === 0) return false;
    }
    return true;
  };
  // The box a control can be seen in: the screen, cut by every ancestor that
  // clips (scrolls or hides overflow).
  const clipOf = (e) => {
    let L = 0, T = 0, R = innerWidth, B = innerHeight, scroller = null;
    for (let n = e.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === 'contents') continue;
      if (/(hidden|auto|scroll|clip)/.test(st.overflowX + ' ' + st.overflowY)) {
        const r = n.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        L = Math.max(L, r.left); T = Math.max(T, r.top); R = Math.min(R, r.right); B = Math.min(B, r.bottom);
        if (!scroller && /(auto|scroll)/.test(st.overflowX + ' ' + st.overflowY)) scroller = n;
      }
    }
    // A sticky bar of that scroller covers its top (or its bottom).
    if (scroller) {
      for (const s of scroller.querySelectorAll(STICKY)) {
        if (s.contains(e) || !s.getClientRects().length) continue;
        const st = getComputedStyle(s);
        if (st.position !== 'sticky') continue;
        const r = s.getBoundingClientRect();
        if (r.bottom <= T + 1 || r.top >= B - 1) continue;
        if (r.top <= T + 1) T = Math.max(T, r.bottom); else if (r.bottom >= B - 1) B = Math.min(B, r.top);
      }
    }
    return { L, T, R, B, scroller };
  };
  const owns = (e, h) => {
    if (!h) return false;
    if (h === e || e.contains(h)) return true;
    const lab = h.closest && h.closest('label');
    if (lab && (lab.contains(e) || (e.id && lab.htmlFor === e.id))) return true;
    if (e.labels) for (const l of e.labels) if (l.contains(h)) return true;
    const hb = h.closest && h.closest('[data-hitbox]');
    if (hb && hb.contains(e)) return true;
    return false;
  };
  const controlOf = (h) => {
    for (let n = h; n && n.nodeType === 1; n = n.parentElement) if (isCandidate(n)) return n;
    return null;
  };

  window.touchAudit = function touchAudit(label) {
    const W = innerWidth, H = innerHeight;
    const lines = [];
    let measured = 0, skipped = 0;
    const all = [...document.querySelectorAll(CANDIDATES)];
    for (const e of all) {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // Off the screen: not on this screen.
      if (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
      if (!shown(e)) continue;
      const c = clipOf(e);
      // Scrolled away inside its box.
      if (r.bottom <= c.T || r.top >= c.B || r.right <= c.L || r.left >= c.R) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // The right edge, whatever the control.
      if (r.right > W + 0.5 && !(c.scroller && c.R <= W + 0.5)) lines.push(`${describe(e)} past the right edge (${Math.round(r.right)} > ${W})`);
      // A field: 16px text, 44px tall.
      const field = (e.tagName === 'INPUT' && !NOT_FIELD.test(e.type)) || e.tagName === 'SELECT' || e.tagName === 'TEXTAREA';
      if (field) {
        const fs = parseFloat(getComputedStyle(e).fontSize);
        if (fs < 16) lines.push(`${describe(e)} field text ${fs}px < 16`);
        if (r.height < 43.5) lines.push(`${describe(e)} field ${Math.round(r.width)}x${r.height.toFixed(1)} < 44 tall`);
      }
      if (exempt(e)) continue;
      // Only where its whole 44px box can be seen in its scroller; the suite
      // scrolls it clear for another look.
      const half = 22;
      const boxL = cx - half, boxR = cx + half, boxT = cy - half, boxB = cy + half;
      const inner = (lo, hi, clo, chi, edge0, edge1) => (lo >= clo - 0.5 || clo <= edge0 + 0.5) && (hi <= chi + 0.5 || chi >= edge1 - 0.5);
      // Skipped only when a box that SCROLLS cuts it and is big enough to
      // show its 44px box once scrolled. A clip that does not scroll (the
      // zoom column's overflow: hidden) or is narrower than 44 is no excuse:
      // the control is measured, and comes out hit short if it is small.
      const outY = !inner(boxT, boxB, c.T, c.B, 0, H), outX = !inner(boxL, boxR, c.L, c.R, 0, W);
      if (c.scroller && ((outY && c.B - c.T >= 44) || (outX && c.R - c.L >= 44))) { skipped++; continue; }
      // Under one of the map's floating bars (the document bar over the
      // table's last rows): out of reach until scrolled clear, not small.
      // Only a bar that is really on top there counts: one behind a dialog's
      // scrim or the landing (a dialog's Done over the docbar) is no cover.
      if ([...document.querySelectorAll(FLOATING)].some((f) => {
        if (f.contains(e) || !f.getClientRects().length || getComputedStyle(f).visibility === 'hidden') return false;
        const b = f.getBoundingClientRect();
        if (!(boxL < b.right && boxR > b.left && boxT < b.bottom && boxB > b.top)) return false;
        const ox = (Math.max(boxL, b.left, 0) + Math.min(boxR, b.right, W)) / 2;
        const oy = (Math.max(boxT, b.top, 0) + Math.min(boxB, b.bottom, H)) / 2;
        const h = document.elementFromPoint(ox, oy);
        return !!(h && f.contains(h));
      })) { skipped++; continue; }
      const mid = document.elementFromPoint(cx, cy);
      if (!owns(e, mid)) {
        // Another control's hit area (its ::after, its padding reaching out)
        // over this one's centre: a stolen tap. A control whose own box is
        // over it is a layer on top (the drawer, a dialog, a menu): this one
        // is behind it, not broken.
        const other = mid && controlOf(mid);
        const ob = other && other.getBoundingClientRect();
        // Behind a whole layer (the landing over the table): out of reach, not stolen.
        const layer = mid && mid.closest && mid.closest(LAYERS);
        if (layer && !layer.contains(e)) { skipped++; continue; }
        if (other && other !== e && !other.contains(e) && !(cx >= ob.left && cx <= ob.right && cy >= ob.top && cy <= ob.bottom)) {
          lines.push(`${describe(e)} ${Math.round(r.width)}x${Math.round(r.height)} tap stolen by ${describe(other)}`);
        } else skipped++;
        continue;
      }
      measured++;
      if (r.width >= 44 - 0.5 && r.height >= 44 - 0.5) continue;
      const d = 21.5;
      const bad = [];
      for (const [x, y, side] of [[cx - d, cy, 'left'], [cx + d, cy, 'right'], [cx, cy - d, 'top'], [cx, cy + d, 'bottom']]) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const h = document.elementFromPoint(x, y);
        if (owns(e, h)) continue;
        const other = h && controlOf(h);
        bad.push(side + (other && other !== e ? ' on ' + describe(other) : h ? ' on ' + (h.id ? '#' + h.id : h.tagName.toLowerCase() + (typeof h.className === 'string' && h.className ? '.' + h.className.trim().split(/\s+/)[0] : '')) : ''));
      }
      if (bad.length) lines.push(`${describe(e)} ${r.width.toFixed(1)}x${r.height.toFixed(1)} hit short: ${bad.join(', ')}`);
    }
    const sw = document.scrollingElement.scrollWidth;
    if (sw > W) lines.push(`the page scrolls sideways (${sw} > ${W})`);
    if (!measured) lines.push(`screen not reached: no control measured (${skipped} covered)`);
    return { label, lines, measured, skipped };
  };
  window.TOUCH_EXEMPT = TOUCH_EXEMPT;
})();
