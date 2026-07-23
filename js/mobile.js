/* ============================================================
   mobile.js — phone/tablet adaptation for network.carino.systems
   ------------------------------------------------------------
   The desktop layout is a fixed w-96 sidebar sitting beside the
   canvas, with the app's controls (Trace / Undo / Export / …)
   relocated into the shared Carino navbar as `.cn-actions`.
   Neither survives a narrow screen: the sidebar eats the canvas
   and the action cluster overflows the bar. So below the
   breakpoint we do the same thing netplan.carino.systems does:

     1. turn the <aside> into an off-canvas drawer opened by a ☰
        button injected into the navbar, and
     2. fold the navbar's action cluster into a section at the
        top of that drawer.

   Everything reverses above the breakpoint. The relocated nodes
   are the real DOM elements (never clones), so every id and
   handler wired elsewhere keeps working. The shared navbar file
   is left untouched — all of this lives in the app.
   ============================================================ */
(function () {
    'use strict';

    // 1024px, not netplan's 860: this app's action cluster (a Trace group,
    // Undo/Redo, Tidy, Export, Clear, Help) is far wider than netplan's four
    // buttons, so it overflows a narrow desktop long before 860px. Folding it
    // away at the tablet breakpoint keeps the bar clean the whole way down.
    var MQ = window.matchMedia('(max-width: 1024px)');
    var aside = document.querySelector('aside');
    if (!aside) return;

    // Scrim that dims the canvas behind an open drawer and closes it on tap.
    var scrim = document.createElement('div');
    scrim.id = 'mobileScrim';
    document.body.appendChild(scrim);

    // A titled home for the navbar actions while the drawer holds them. It sits
    // at the very top of the aside; on desktop CSS keeps it hidden.
    var actionsSection = document.createElement('div');
    actionsSection.id = 'mobileActions';
    actionsSection.innerHTML =
        '<h3 class="mobile-actions-title">Controls</h3>' +
        '<div id="mobileActionsSlot"></div>';
    aside.insertBefore(actionsSection, aside.firstChild);
    var slot = actionsSection.querySelector('#mobileActionsSlot');

    function openDrawer() {
        aside.classList.add('drawer-open');
        scrim.classList.add('open');
        document.body.classList.add('drawer-lock');
    }
    function closeDrawer() {
        aside.classList.remove('drawer-open');
        scrim.classList.remove('open');
        document.body.classList.remove('drawer-lock');
    }
    function toggleDrawer() {
        aside.classList.contains('drawer-open') ? closeDrawer() : openDrawer();
    }

    scrim.addEventListener('click', closeDrawer);
    // Esc closes the drawer too; app.js's own Esc handlers still run alongside.
    window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDrawer();
    });

    // Move the navbar's action cluster into the drawer below the breakpoint and
    // back into the bar above it. `.cn-actions` is the app's own `.cs-right`,
    // relocated into `.cn-right` by carino-navbar.js at mount.
    function syncActions() {
        var nav = document.getElementById('carinoNav');
        var actions = document.querySelector('.cn-actions');
        if (!actions) return; // navbar not mounted yet — boot()'s retry will catch it
        if (MQ.matches) {
            if (actions.parentNode !== slot) slot.appendChild(actions);
        } else {
            var right = nav && nav.querySelector('.cn-right');
            if (right && actions.parentNode !== right) {
                right.insertBefore(actions, right.querySelector('.social-row'));
            }
            closeDrawer();
        }
    }

    // Drop a ☰ button into the navbar's left cluster. Injected (not baked into
    // the shared navbar markup) so this stays a per-app change; CSS shows it
    // only on mobile.
    function addToggleButton() {
        var nav = document.getElementById('carinoNav');
        if (!nav) return false;
        if (document.getElementById('mobileMenuBtn')) return true;
        var btn = document.createElement('button');
        btn.id = 'mobileMenuBtn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Toggle controls');
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = '☰'; // ☰
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleDrawer();
            btn.setAttribute('aria-expanded', aside.classList.contains('drawer-open') ? 'true' : 'false');
        });
        var left = nav.querySelector('.cn-left');
        if (left) left.insertBefore(btn, left.firstChild);
        else nav.insertBefore(btn, nav.firstChild);
        return true;
    }

    // carino-navbar.js is deferred and injects the bar during its own run. This
    // file is deferred right after it, so the bar is normally present already;
    // the retry is insurance for any load-order surprise.
    function boot() {
        if (!addToggleButton()) return false;
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
