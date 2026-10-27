/* ============================================================
   mobile.js — phone/tablet adaptation for topo.carino.systems
   ------------------------------------------------------------
   The rail is the shared workspace drawer below 900px
   (carino-ui.css + carino-ui.js open and close it on any
   [data-ws-toggle]). This file adds the two things that are
   Topo's own:

     1. the navbar's action cluster (Undo / Export / …)
        folds into a section at the top of that drawer, and
     2. a floating "handy" bar of the five things a phone needs
        mid-edit, whose ☰ is the drawer's toggle.

   Everything reverses above the breakpoint. The relocated nodes
   are the real DOM elements (never clones), so every id and
   handler wired elsewhere keeps working. The shared navbar file
   is left untouched — all of this lives in the app.
   ============================================================ */
(function () {
    'use strict';

    // carino-ui.css's drawer breakpoint.
    var MQ = window.matchMedia('(max-width: 900px)');
    var aside = document.querySelector('.topo-rail');
    if (!aside) return;
    var ws = aside.closest('.ws');

    // A titled home for the navbar actions while the drawer holds them. It sits
    // at the very top of the rail; on desktop CSS keeps it hidden.
    var actionsSection = document.createElement('div');
    actionsSection.id = 'mobileActions';
    actionsSection.innerHTML =
        '<h3 class="mobile-actions-title" data-i18n>Controls</h3>' +
        '<div id="mobileActionsSlot"></div>';
    aside.insertBefore(actionsSection, aside.firstChild);
    var slot = actionsSection.querySelector('#mobileActionsSlot');

    // Move the navbar's action cluster into the drawer below the breakpoint and
    // back into the bar above it. `.topo-actions` is relocated into `.cn-right`
    // by carino-navbar.js at mount (data-carino-actions).
    function syncActions() {
        var nav = document.getElementById('carinoNav');
        var actions = document.querySelector('.topo-actions.cn-actions');
        if (!actions) return; // navbar not mounted yet — boot()'s retry will catch it
        if (MQ.matches) {
            if (actions.parentNode !== slot) slot.appendChild(actions);
        } else {
            var right = nav && nav.querySelector('.cn-right');
            if (right && actions.parentNode !== right) {
                right.insertBefore(actions, right.querySelector('.social-row'));
            }
        }
    }

    // Floating "handy" bar, bottom-center, mobile only — the same pattern as
    // quote.carino.systems. It replaces the old navbar ☰: the five things a
    // phone actually needs mid-edit (drawer, trace, undo, redo, report) ride in
    // one thumb-reach pill instead of hiding behind the drawer. Every button
    // delegates to the REAL control (`.click()` / checkbox toggle), so behavior
    // — including the report's guard and disabled Undo/Redo — stays identical.
    function buildHandyBar() {
        if (document.getElementById('handyBar')) return;
        var bar = document.createElement('div');
        bar.id = 'handyBar';
        bar.className = 'handy-bar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Quick actions');
        bar.setAttribute('data-i18n-aria-label', '');

        function btn(id, glyph, label, onClick) {
            var b = document.createElement('button');
            b.type = 'button';
            if (id) b.id = id;
            b.className = 'handy-btn';
            b.title = label; b.setAttribute('aria-label', label);
            b.setAttribute('data-i18n-title', ''); b.setAttribute('data-i18n-aria-label', '');
            b.textContent = glyph;
            b.addEventListener('click', onClick);
            bar.appendChild(b);
            return b;
        }
        function div() {
            var d = document.createElement('span');
            d.className = 'handy-div';
            bar.appendChild(d);
        }

        // carino-ui.js toggles the drawer (and aria-expanded) for it.
        var menuBtn = btn('handyMenu', '☰', 'Open controls', function () {});
        menuBtn.setAttribute('data-ws-toggle', '');
        menuBtn.setAttribute('aria-expanded', ws && ws.classList.contains('drawer-open') ? 'true' : 'false');

        // Trace lives in the node's Diagnostics tab now, with its state in
        // state.settings; this button goes through the same setTraceMode() as
        // the tab and the T key, and app.js announces every change
        // ('topo:tracechange') so the button stays lit whichever way it moved.
        // data-adv: the reduced views have no trace, so it goes with them.
        var traceBtn = btn('handyTrace', '🔍', 'Toggle trace', function () {
            if (typeof window.setTraceMode === 'function') window.setTraceMode(!state.settings.traceMode);
        });
        traceBtn.setAttribute('data-adv', '');
        function syncTrace() {
            // `state` is js/state.js's top-level const: in scope here, not on window.
            traceBtn.classList.toggle('active', typeof state !== 'undefined' && !!state.settings.traceMode);
        }
        document.addEventListener('topo:tracechange', syncTrace);
        syncTrace();

        div();

        // Undo/redo mirror the real buttons' disabled state — app.js flips the
        // `disabled` attribute in updateUndoButtons(), so an attribute observer
        // is enough and app.js stays untouched.
        var undoReal = document.getElementById('undoBtn');
        var redoReal = document.getElementById('redoBtn');
        var undoBtn = btn('handyUndo', '↶', 'Undo', function () { if (undoReal) undoReal.click(); });
        var redoBtn = btn('handyRedo', '↷', 'Redo', function () { if (redoReal) redoReal.click(); });
        function mirror(real, mine) {
            if (!real) return;
            var sync = function () { mine.disabled = real.disabled; };
            new MutationObserver(sync).observe(real, { attributes: true, attributeFilter: ['disabled'] });
            sync();
        }
        mirror(undoReal, undoBtn);
        mirror(redoReal, redoBtn);

        div();

        // The fifth slot was Clear. It went with the toolbar's Clear (now New
        // network, in the File menu, behind a confirm): one thumb-tap from
        // emptying the canvas was the wrong thing to keep within reach, and the
        // report is what a phone in the field is most often opened for.
        btn('handyReport', '📋', 'Site report', function () {
            var real = document.getElementById('reportBtn');
            if (real) real.click(); // keeps the "nothing to report yet" guard
        });

        document.body.appendChild(bar);
    }
    buildHandyBar();
    // Built after app.js's boot has already translated the page.
    if (typeof window.applyStaticI18n === 'function') window.applyStaticI18n();

    // carino-navbar.js is deferred and injects the bar during its own run. This
    // file is deferred right after it, so the bar is normally present already;
    // the retry is insurance for any load-order surprise.
    function boot() {
        var nav = document.getElementById('carinoNav');
        if (!nav) return false;
        syncActions();
        return true;
    }
    if (!boot()) {
        var tries = 0;
        var iv = setInterval(function () {
            if (boot() || ++tries > 40) clearInterval(iv);
        }, 50);
    }

    if (MQ.addEventListener) MQ.addEventListener('change', syncActions);
    else if (MQ.addListener) MQ.addListener(syncActions); // older Safari
})();
