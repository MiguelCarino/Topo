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

    // carino-ui.css's drawer breakpoint, and a phone held sideways (DRAWER_MQ,
    // js/state.js; css/app.css copies the drawer for the part past 900px).
    var MQ = window.matchMedia(DRAWER_MQ);
    var aside = document.querySelector('.topo-rail');
    if (!aside) return;
    var ws = aside.closest('.ws');

    // A titled home for the navbar actions while the drawer holds them. It sits
    // at the very top of the rail; on desktop CSS keeps it hidden.
    var actionsSection = document.createElement('div');
    actionsSection.id = 'mobileActions';
    actionsSection.innerHTML = '<div id="mobileActionsSlot"></div>';
    aside.insertBefore(actionsSection, aside.firstChild);
    var slot = actionsSection.querySelector('#mobileActionsSlot');

    // The drawer's own header (Mobile batch 2): its title and a 44px ✕. The
    // handy bar (and its ☰) is hidden while the drawer is open and a phone has
    // no Esc, so without it the only way out was the scrim's thin strip on the
    // right. Sticky at the top of the rail, which is the drawer's one
    // scroller on a phone (css/app.css). The ✕ clicks the ☰, carino-ui.js's
    // [data-ws-toggle], so aria-expanded stays in step.
    var railHead = document.createElement('div');
    railHead.id = 'railHead';
    railHead.className = 'rail-head';
    railHead.innerHTML =
        '<h3 class="mobile-actions-title" data-i18n>Controls</h3>' +
        // My networks in sight (step 3): in the Simple views it was only
        // reachable through Export ▾. It is the Export menu's own item.
        '<button type="button" id="drawerNetworksBtn" class="rail-close rail-netbtn" title="My networks" aria-label="My networks"' +
        ' data-i18n-title="My networks" data-i18n-aria-label="My networks"><span aria-hidden="true">🗂️</span></button>' +
        // The Carino bar's tap (decision D4, docs/MOBILE.md): in the full
        // editor the handle at the top edge cannot be 44px tall without
        // covering the search box, so it stays a swipe strip there and this
        // is its 44x44 button. It closes the drawer and brings the bar.
        '<button type="button" id="drawerNavBtn" class="rail-close rail-navbtn" title="Show the menu bar" aria-label="Show the menu bar"' +
        ' data-i18n-title="Show the menu bar" data-i18n-aria-label="Show the menu bar"><span aria-hidden="true">⌃</span></button>' +
        '<button type="button" id="railClose" class="rail-close" title="Close controls" aria-label="Close controls"' +
        ' data-i18n-title="" data-i18n-aria-label=""><span aria-hidden="true">✕</span></button>';
    aside.insertBefore(railHead, aside.firstChild);
    railHead.querySelector('#railClose').addEventListener('click', function () {
        var menu = document.getElementById('handyMenu');
        if (menu && ws && ws.classList.contains('drawer-open')) menu.click();
    });
    [['#drawerNavBtn', 'Show the menu bar'], ['#drawerNetworksBtn', 'My networks']].forEach(function (p) {
        var b = railHead.querySelector(p[0]);
        var l = typeof t === 'function' ? t(p[1]) : p[1];
        b.title = l; b.setAttribute('aria-label', l);
    });
    railHead.querySelector('#drawerNetworksBtn').addEventListener('click', function () {
        var menu = document.getElementById('handyMenu');
        if (menu && ws && ws.classList.contains('drawer-open')) menu.click();
        var item = document.getElementById('myNetworksBtn');
        if (item) item.click();
    });
    railHead.querySelector('#drawerNavBtn').addEventListener('click', function () {
        var menu = document.getElementById('handyMenu');
        if (menu && ws && ws.classList.contains('drawer-open')) menu.click();
        var handle = document.getElementById('navHandle');
        if (handle) handle.click();
    });

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
        // A problem to report to the network's providers (js/incidents.js):
        // what a client's phone is most often picked up for.
        btn('handyProblem', '⚠', 'Report a problem', function () {
            var real = document.getElementById('reportProblemBtn');
            if (real) real.click();
        });

        document.body.appendChild(bar);
        // A phone held sideways puts the bars on one row beside this one
        // (css/app.css, M31): they leave its width free.
        if (window.ResizeObserver) new ResizeObserver(function () {
            var w = bar.offsetWidth;
            if (w) document.documentElement.style.setProperty('--handy-w', w + 'px');
        }).observe(bar);
    }
    buildHandyBar();
    // Built after app.js's boot has already translated the page.
    if (typeof window.applyStaticI18n === 'function') window.applyStaticI18n();

    // ---- The selection bar and the connect banner (Mobile batch 2) ----
    // A tap on the map selects, and on a phone the editor for it is in the
    // closed drawer. The selection bar, just above the handy bar, names what is
    // selected and holds what a phone does with it: Edit (opens the drawer at
    // its fields), Connect (link mode from a device: the touch twin of
    // right-click and the L key), a note's text, size and red leader, and
    // Delete (the 44px twin of the map's little ✕, which a phone does not
    // draw, css/app.css). While link mode is armed, however it was armed (an
    // Android long-press fires contextmenu), the banner says what to tap and
    // offers Cancel. Both live above the handy bar and only below 900px.
    var SELBAR_BUTTONS = {
        edit:     { glyph: '✎', label: 'Edit', tip: 'Edit' },
        connect:  { glyph: '⇄', label: 'Connect', tip: 'Connect to another device', keep: true },
        edittext: { glyph: '✎', label: 'Edit text', tip: 'Edit text' },
        link:     { glyph: '↗', label: 'Link', tip: 'Link to a device', keep: true },
        smaller:  { glyph: 'A−', label: '', tip: 'Smaller text' },
        larger:   { glyph: 'A+', label: '', tip: 'Larger text' },
        more:     { glyph: '⊕', label: 'Select more', tip: 'Select more' },
        done:     { glyph: '✓', label: 'Done', tip: 'Done', keep: true },
        remove:   { glyph: '✕', label: 'Delete', tip: 'Delete' }
    };
    // What the bar offers for a selection (a Set or a list of { type, id })
    // in a document that is read-only or not, with Select more on or not.
    // Pure, for tests/suites/selbar.js and touchselect.js.
    // Select more (a finger's Shift-click, js/ui.js selectMoreOn) gathers
    // devices and cables: offered on them, and while it is on the bar holds
    // the set's Edit and Delete and Done, which leaves the mode.
    function selBarActions(selection, readOnly, more) {
        var list = selection ? Array.from(selection) : [];
        if (!list.length) return [];
        if (readOnly) return ['edit'];
        if (more) return ['edit', 'remove', 'done'];
        if (list.length > 1) return ['edit', 'more', 'remove'];
        switch (list[0].type) {
            case 'node': return ['edit', 'connect', 'more', 'remove'];
            case 'link': return ['edit', 'more', 'remove'];
            case 'annotation': return ['edittext', 'link', 'smaller', 'larger', 'remove'];
            case 'notelink': return ['remove'];
            default: return ['edit'];
        }
    }
    window.selBarActions = selBarActions;

    function tr(key, params) { return typeof window.t === 'function' ? window.t(key, params) : key; }
    function lStr(el, key) { el.setAttribute('data-i18n', ''); el.dataset.i18nKey = key; el.textContent = tr(key); }
    function lAttr(el, attr, key) { el.setAttribute('data-i18n-' + attr, key); el.setAttribute(attr, tr(key)); }

    // What the bar calls the selection (Select more counts even one).
    function selBarName(list, more) {
        if (list.length > 1 || more) return tr('{n} selected', { n: list.length });
        var e = list[0];
        if (e.type === 'node') { var n = getNode(e.id); return n ? (n.name || tr('Unnamed device')) : ''; }
        if (e.type === 'link') {
            var l = getLink(e.id); if (!l) return '';
            var a = getNode(l.source), b = getNode(l.target);
            return ((a && a.name) || l.source) + ' ↔ ' + ((b && b.name) || l.target);
        }
        if (e.type === 'annotation') {
            var ann = getAnnotation(e.id);
            var line = ann && String(ann.text || '').split('\n').find(function (x) { return x.trim(); });
            return line ? line.trim() : tr('Text note');
        }
        if (e.type === 'notelink') return tr('Note link');
        return '';
    }

    function bodyFlag(name, on) { document.body.classList.toggle(name, !!on); }

    function nearScroller(el) {
        for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            var oy = getComputedStyle(p).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
            if (p === aside) break;
        }
        return null;
    }
    // Brings `target` to the top of what scrolls it in the drawer, vertically
    // only (scrollIntoView would also slide the drawer's own sideways
    // transform box). A sticky row over it (the panel tabs) is kept clear.
    function revealInRail(target) {
        if (!target) return;
        var margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
        for (var guard = 0, el = target; guard < 4; guard++) {
            var box = nearScroller(el);
            if (!box) break;
            // What stays stuck over the top of the box: the drawer's header
            // and, under it, the panel tabs (each stuck at its own `top`).
            var sticky = 0;
            box.querySelectorAll('.cfg-tabs, .rail-head').forEach(function (s) {
                var cs = getComputedStyle(s);
                if (cs.position === 'sticky' && s.offsetHeight) sticky = Math.max(sticky, (parseFloat(cs.top) || 0) + s.getBoundingClientRect().height);
            });
            var delta = target.getBoundingClientRect().top - box.getBoundingClientRect().top - sticky - margin - 8;
            box.scrollTop += delta;
            el = box;
        }
    }

    function openSelectionEditor() {
        if (ws && !ws.classList.contains('drawer-open')) {
            var menu = document.getElementById('handyMenu');
            if (menu) menu.click();   // carino-ui.js opens on a [data-ws-toggle] click only
        }
        if (typeof showConfigTab === 'function') showConfigTab('config');
        var multi = state.selection.size > 1;
        var target = multi ? document.getElementById('multiSelectionPane') : document.getElementById('propName');
        if (target && !multi) target = target.closest('.prop-row, .prop-group, div') || target;
        // Not focused: a field with the focus would bring the keyboard up.
        requestAnimationFrame(function () { revealInRail(target); });
    }

    // Shared: the selection bar's Edit and the palette's device add (below)
    // both land the drawer, its one scroller, at the selection's editor.
    window.showSelectionEditor = openSelectionEditor;

    // What stays stuck at the rail's top on a phone, the header and the panel
    // tabs under it (one or two rows, by language and width), as
    // --rail-sticky-h: css/app.css makes it the rail's scroll-padding-top, so
    // every scrollIntoView and focus scroll in the drawer lands below them.
    var cfgTabs = aside.querySelector('.rail-props .cfg-tabs');
    function syncStickyH() {
        if (!MQ.matches) return;
        var h = railHead.offsetHeight + (cfgTabs ? cfgTabs.offsetHeight : 0);
        if (h) aside.style.setProperty('--rail-sticky-h', h + 'px');
    }
    if (typeof ResizeObserver === 'function') {
        var ro = new ResizeObserver(syncStickyH);
        ro.observe(railHead);
        if (cfgTabs) ro.observe(cfgTabs);
    }
    window.addEventListener('resize', syncStickyH);
    if (MQ.addEventListener) MQ.addEventListener('change', syncStickyH);
    else if (MQ.addListener) MQ.addListener(syncStickyH);
    syncStickyH();

    // A panel tab tapped while the tabs are stuck (deep in a long panel):
    // the new panel starts above them, so the rail goes back to where the
    // tabs sit unstuck and the panel shows from its top. Runs after the
    // tab's own click (showConfigTab, js/app.js). Desktop: untouched.
    aside.addEventListener('click', function (e) {
        if (!MQ.matches || !e.target.closest) return;
        var tab = e.target.closest('.cfg-tab');
        var props = tab && tab.closest('.rail-props');
        if (!props) return;
        var head = railHead.offsetHeight;
        var delta = props.getBoundingClientRect().top - aside.getBoundingClientRect().top - head;
        if (delta < 0) aside.scrollTop += delta;
    });

    // ---- The palette on a phone (Mobile batch 2) ----
    // js/ui.js's palette asks these first and does its desktop click when
    // they say no (above the breakpoint, they always do).
    function drawerOpen() { return !!(ws && ws.classList.contains('drawer-open')); }
    function closeDrawer() {
        var menu = document.getElementById('handyMenu');
        if (drawerOpen() && menu) menu.click();
    }
    // Text or Note: the editor goes on the map, so the drawer goes first, or
    // the phone's keyboard comes up for a note the drawer and scrim cover.
    // Centred across the uncovered map (mapViewport, js/app.js) and in the
    // upper part of it, where the keyboard leaves it in sight.
    window.phonePaletteAnnotation = function (style) {
        if (!MQ.matches || typeof spawnAnnotation !== 'function') return false;
        closeDrawer();
        var v = typeof mapViewport === 'function' ? mapViewport() : null;
        var opts = { style: style, edit: true };
        if (v && v.width && v.height) {
            var z = state.camera.zoom || 1;
            opts.at = {
                x: (v.left + v.width / 2 - state.camera.x) / z - 22,
                y: (v.top + v.height * 0.3 - state.camera.y) / z - 13
            };
        }
        spawnAnnotation(opts);
        return true;
    };
    // A device: the drawer stays open (one tap after another builds a tree)
    // and scrolls to the new device's Name, unfocused, so no keyboard. When
    // the drawer is closed, the new device is panned into the map's view.
    // While the drawer stays open after a palette add, the library is held
    // unfolded (js/ui.js updateRailWrap asks phoneLibraryHeld), or selecting
    // the new device would fold the palette away from under the finger and
    // the next tap would need Keep open. It folds as usual once the drawer
    // closes.
    var revealOnClose = null, libHeld = false;
    window.phoneLibraryHeld = function () { return libHeld && MQ.matches && drawerOpen(); };
    function releaseLibrary() {
        if (!libHeld) return;
        libHeld = false;
        if (typeof updateRailWrap === 'function') updateRailWrap();
    }
    window.phonePaletteDevice = function (type, connectTo) {
        if (!MQ.matches || typeof spawnNode !== 'function') return false;
        var open = drawerOpen();
        if (open) libHeld = true;
        var node = spawnNode(type, { connectTo: connectTo });
        if (!node) return true;
        if (open) {
            revealOnClose = node.id;   // panned into view when the drawer closes
            openSelectionEditor();
        } else {
            revealOnClose = null;
            panIntoView(node.id);
        }
        return true;
    };
    // The smallest pan that brings a device's card (and its name under it)
    // inside the uncovered map, with a margin.
    function panIntoView(id) {
        var n = typeof getNode === 'function' ? getNode(id) : null;
        if (!n || typeof mapViewport !== 'function') return;
        var v = mapViewport(), z = state.camera.zoom || 1, pad = 16;
        var sx = n.x * z + state.camera.x, sy = n.y * z + state.camera.y;
        var left = sx - 40 * z - pad, right = sx + 40 * z + pad;
        var top = sy - 28 * z - pad, bottom = sy + 44 * z + pad;
        var dx = 0, dy = 0;
        if (left < v.left) dx = v.left - left; else if (right > v.left + v.width) dx = v.left + v.width - right;
        if (top < v.top) dy = v.top - top; else if (bottom > v.top + v.height) dy = v.top + v.height - bottom;
        if (!dx && !dy) return;
        state.camera.x += dx; state.camera.y += dy;
        if (typeof applyCamera === 'function') applyCamera();
    }
    window.panIntoView = panIntoView;
    function dropPending() { revealOnClose = null; releaseLibrary(); }
    if (MQ.addEventListener) MQ.addEventListener('change', function () { if (!MQ.matches) dropPending(); });
    else if (MQ.addListener) MQ.addListener(function () { if (!MQ.matches) dropPending(); });
    if (ws) new MutationObserver(function () {
        if (drawerOpen()) return;
        // Past the breakpoint (carino-ui.js closes the drawer on a widen) a
        // pending reveal is dropped: no camera move nobody asked for.
        if (!MQ.matches) { dropPending(); return; }
        releaseLibrary();
        if (!revealOnClose) return;
        var id = revealOnClose; revealOnClose = null;
        // A frame later: the selection bar is back by then and counts as cover.
        requestAnimationFrame(function () {
            if (typeof state !== 'undefined' && state.selectedId === id && !document.body.classList.contains('table-view')) panIntoView(id);
        });
    }).observe(ws, { attributes: true, attributeFilter: ['class'] });

    function runSelBar(act) {
        var one = soleSelected(state.selection);
        if (act === 'edit') { openSelectionEditor(); return; }
        if (act === 'remove') { deleteSelected(); return; }
        if (act === 'more') { if (typeof setSelectMore === 'function') setSelectMore(true); return; }
        if (act === 'done') { if (typeof setSelectMore === 'function') setSelectMore(false); return; }
        if (!one) return;
        if (act === 'connect' || act === 'link') { state.linkSourceId = one.id; renderCanvasOnly(); return; }
        var a = one.type === 'annotation' ? getAnnotation(one.id) : null;
        if (!a) return;
        if (act === 'edittext') { openAnnotationEditor(a); return; }
        if (act === 'smaller' || act === 'larger') {
            // The map's A− / A+ step (renderAnnotation, js/ui.js).
            a.size = Math.min(36, Math.max(10, (a.size || 12) + (act === 'larger' ? 2 : -2)));
            save(); renderCanvasOnly();
        }
    }

    var selBar = null, selName = null, selBtns = null, linkBanner = null, linkText = null, selSig = '';
    // Cancel and the bar's Delete share the right-hand edge of one box, and the
    // bar is back the moment the banner goes: a second, quick tap on Cancel
    // would land on Delete. The bar takes no tap for a moment after Cancel.
    var SELBAR_GUARD_MS = 350, selGuardUntil = 0;
    function buildSelBar() {
        if (document.getElementById('selBar')) return;
        selBar = document.createElement('div');
        selBar.id = 'selBar';
        selBar.className = 'sel-bar';
        selBar.setAttribute('role', 'toolbar');
        lAttr(selBar, 'aria-label', 'Selected item');
        selBar.hidden = true;
        selName = document.createElement('span');
        selName.className = 'sel-bar-name';
        selBtns = document.createElement('span');
        selBtns.className = 'sel-bar-btns';
        selBar.appendChild(selName); selBar.appendChild(selBtns);
        selBar.addEventListener('click', function (e) {
            var b = e.target.closest('button[data-act]');
            if (performance.now() < selGuardUntil) { e.preventDefault(); return; }
            if (b && !b.disabled) runSelBar(b.dataset.act);
        });
        document.body.appendChild(selBar);

        linkBanner = document.createElement('div');
        linkBanner.id = 'linkBanner';
        linkBanner.className = 'link-banner';
        linkBanner.setAttribute('role', 'status');
        linkBanner.setAttribute('aria-live', 'polite');
        linkBanner.hidden = true;
        linkText = document.createElement('span');
        linkText.className = 'link-banner-text';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.id = 'linkCancel';
        cancel.className = 'cs-btn link-banner-cancel';
        lStr(cancel, 'Cancel');
        cancel.addEventListener('click', function () {
            selGuardUntil = performance.now() + SELBAR_GUARD_MS;
            state.linkSourceId = null; renderCanvasOnly();
        });
        linkBanner.appendChild(linkText); linkBanner.appendChild(cancel);
        document.body.appendChild(linkBanner);
    }

    function selBarButtons(acts) {
        selBtns.innerHTML = '';
        acts.forEach(function (act) {
            var d = SELBAR_BUTTONS[act];
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'sel-bar-btn' + (act === 'remove' ? ' danger' : '');
            b.dataset.act = act;
            lAttr(b, 'title', d.tip); lAttr(b, 'aria-label', d.tip);
            var g = document.createElement('span');
            g.className = 'sel-bar-glyph'; g.setAttribute('aria-hidden', 'true'); g.textContent = d.glyph;
            b.appendChild(g);
            if (d.label) { var l = document.createElement('span'); l.className = 'sel-bar-label' + (d.keep ? ' keep' : ''); lStr(l, d.label); b.appendChild(l); }
            selBtns.appendChild(b);
        });
    }

    function syncBars() {
        if (!selBar || typeof state === 'undefined') return;
        var cv = document.getElementById('networkCanvas');
        var linking = !!(cv && cv.classList.contains('linking') && state.linkSourceId);
        var onMap = !document.body.classList.contains('table-view') && !document.body.classList.contains('rack-view');
        var typing = !!document.getElementById('annEditor');
        var list = Array.from(state.selection || []);
        // Neither bar shows over the open drawer, the landing or the chrome
        // still loading; nor does body.selbar-on lift the docbar for them.
        var b = document.body.classList;
        var clear = !(ws && ws.classList.contains('drawer-open')) && !b.contains('landing-open') && !b.contains('chrome-pending');
        // A read-only document files no cable: a finger's long-press there
        // (Android's contextmenu) does not arm link mode. A mouse's
        // right-click is left as it was.
        if (linking && state.readOnly && MQ.matches && COARSE.matches) {
            state.linkSourceId = null; renderCanvasOnly();
            return;
        }

        // The banner.
        var showBanner = MQ.matches && linking && onMap && clear;
        if (showBanner) {
            var src = state.linkSourceId;
            var srcNode = getNode(src);
            linkText.textContent = getAnnotation(src) ? tr('Tap a device to link this note')
                : tr('Tap the device to connect to {name}', { name: (srcNode && srcNode.name) || tr('Unnamed device') });
        }
        linkBanner.hidden = !showBanner;

        // Select more ends with the set (emptied, Esc, a Delete), in a
        // read-only document, past the breakpoint and off the map (the Table
        // or Rack view, where its bar is not shown). setSelectMore
        // announces, which runs this again with the mode off.
        var more = typeof selectMoreOn === 'function' && selectMoreOn();
        if (more && (!list.length || state.readOnly || !MQ.matches || !onMap)) { setSelectMore(false); return; }

        // The selection bar.
        var acts = selBarActions(list, !!state.readOnly, more);
        var showSel = MQ.matches && acts.length > 0 && !linking && onMap && !typing && clear;
        if (showSel) {
            var name = selBarName(list, more);
            var sig = acts.join(',') + '|' + (document.documentElement.lang || '');
            if (sig !== selSig) { selBarButtons(acts); selSig = sig; }
            if (selName.textContent !== name) { selName.textContent = name; selName.title = name; }
            selBar.dataset.kind = list.length > 1 ? 'multi' : list[0].type;
        }
        selBar.dataset.more = more ? 'on' : 'off';
        bodyFlag('select-more', more);
        selBar.hidden = !showSel;
        // The labels go when the row would not fit, leaving the glyphs.
        // Edit's ✎ and Delete's ✕ read without words, so theirs go first;
        // Connect and Link keep theirs while they can.
        if (showSel) {
            selBar.classList.remove('compact', 'compact-all', 'noname');
            var tight = function () { return selBar.scrollWidth > selBar.clientWidth + 1 || selName.clientWidth < 64; };
            if (tight()) selBar.classList.add('compact');
            if (tight()) selBar.classList.add('compact-all');
            // A name cut to a letter or two says nothing; the card is lit on the map.
            if (selBar.scrollWidth > selBar.clientWidth + 1 || selName.clientWidth < 40) selBar.classList.add('noname');
        }
        // A selection folds the document bar into its chip (M30, js/library.js).
        if (showSel && typeof window.foldDocBar === 'function') window.foldDocBar();
        bodyFlag('selbar-on', showSel || showBanner);
    }

    var COARSE = window.matchMedia('(pointer: coarse)');
    buildSelBar();
    // Two fingers on either bar pinch the map, as on the docbar (js/app.js).
    if (typeof mapOverlay === 'function') { mapOverlay(selBar); mapOverlay(linkBanner); }
    document.addEventListener('topo:selectionchange', syncBars);
    // The labels' fit is measured, so a new width (a rotation, split screen,
    // a late font) measures it again; the breakpoint alone does not change.
    window.addEventListener('resize', syncBars);
    // Esc ends Select more in js/app.js's own Esc (SHORTCUTS), which only runs
    // when no dialog, overlay or field took the key.
    window.addEventListener('carino:langchange', function () { selSig = ''; setTimeout(syncBars, 0); });
    (function watch() {
        var cv = document.getElementById('networkCanvas');
        // drawCanvas writes the canvas's class on every draw ('linking' while
        // armed, js/ui.js), so this hears every redraw, link mode included.
        if (cv) new MutationObserver(syncBars).observe(cv, { attributes: true, attributeFilter: ['class'] });
        if (ws) new MutationObserver(syncBars).observe(ws, { attributes: true, attributeFilter: ['class'] });
        new MutationObserver(syncBars).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        var cc = document.getElementById('canvasContainer');
        if (cc) new MutationObserver(syncBars).observe(cc, { childList: true });   // the note editor comes and goes
    })();
    syncBars();
    if (MQ.addEventListener) MQ.addEventListener('change', syncBars);
    else if (MQ.addListener) MQ.addListener(syncBars);

    // ---- The on-screen keyboard (Mobile batch 3) ----
    // While a field a finger types into has the focus on a touch phone, the
    // keyboard takes the bottom half of the screen. index.html's viewport meta
    // asks for no interactive-widget, so Chrome on Android (108 and up) and iOS
    // Safari both lay the keyboard over the visual viewport and leave the
    // layout viewport, where position: fixed attaches, as it was. Asking Chrome
    // for resizes-content was weighed and left out: iOS ignores it, so this
    // visualViewport path is needed anyway, and on Android it would reflow the
    // 100vh body, the map and the report card and fire every window resize
    // handler (syncBars, the table's sticky heights, the report's preview fit)
    // on each show and hide of the keyboard.
    // So, while such a field has the focus, <html> carries `topo-kb`, and
    // css/app.css then:
    //   - hides the floating bars (handy bar, selection bar, connect banner,
    //     docbar, read-only and storage banners). Under the overlay model they
    //     sit behind the keyboard anyway; in a browser that does shrink the
    //     layout (Firefox for Android, older Chrome) they would ride up over
    //     the very field being typed in;
    //   - fits every dialog's scrim to the visual viewport (--kb-top, --kb-h),
    //     so the dialog's field and its buttons are above the keyboard.
    // After the keyboard settles, the focused field is scrolled into the part
    // of its own scroller that is still in sight, and only when it is not.
    // The class lives on <html>, not <body>, so body's class observer (above)
    // does not run syncBars on every focus.
    // To confirm on a real iPhone (Safari) and a real Android phone (Chrome):
    //   1. getBoundingClientRect and visualViewport.offsetTop are both measured
    //      against the layout viewport (old iOS measured client rects against
    //      the visual one, which would count offsetTop twice in the reveal and
    //      in the scrim's top);
    //   2. the keyboard's opening and closing fire a visualViewport resize, and
    //      KB_FALLBACK_MS covers the keyboard's slide;
    //   3. Android's back gesture and the keyboard's hide key keep the focus,
    //      the bars come back (kb.seen), and a tap on the field hides them again;
    //   4. iOS may scroll the window on focus despite body's overflow: hidden;
    //      the scrim's top must still land at the top of what is in sight;
    //   5. iOS's shortcut strip over a hardware keyboard stays under KB_MIN;
    //   6. a focus that raises no keyboard (iOS ignores a focus() outside a
    //      user's gesture) leaves the bars hidden until the blur. That is
    //      accepted: the cost is bars out of sight, never bars over a field;
    //   7. the browser's own scroll to the focused field and the reveal here do
    //      not fight (the reveal does nothing to a field already in sight).
    // A touch screen this narrow: a phone, or a tablet upright; or this low: a
    // phone held sideways, which is wider than 900px (a Pixel 7 is 915, an
    // iPhone Pro Max 932) and where the keyboard takes more than half of a
    // screen about 410px tall. A window of any size with a mouse has no
    // on-screen keyboard. The bars this hides only exist at 900px or less
    // (NAV_MQ below, in the navbar's section); the scrim's fit is the part a
    // phone sideways needs (css/app.css, "The on-screen keyboard on a phone").
    var KB_MQ = window.matchMedia('(max-width: 900px) and (pointer: coarse), (max-height: 600px) and (pointer: coarse)');
    // A shrink smaller than KB_MIN is the URL bar or iOS's strip over a
    // hardware keyboard (about 44-56px), not a keyboard (200px and more).
    // KB_SETTLE_MS waits out the last resize events of the slide; the
    // fallback covers a focus that brings no resize at all (a hardware
    // keyboard, or field to field with the keyboard already up), and is a
    // little longer than the keyboard's slide (about 250-300ms on both).
    var KB_MIN = 120, KB_SETTLE_MS = 120, KB_FALLBACK_MS = 400, KB_PAD = 8;
    // el: the field with the focus; base: the tallest visual viewport seen
    // since it got it (the height with no keyboard); w: the width then, so a
    // rotation starts over; seen: whether the keyboard has been up since.
    var kb = { el: null, base: 0, w: 0, seen: false, timer: 0 };
    var KB_TYPES = /^(text|search|email|number|tel|url|password)$/;

    // Does focusing el bring up the keyboard? A date, a time, a tick, a select
    // or a slider brings a picker or nothing; a read-only or disabled field
    // and inputmode=none bring nothing.
    function typesText(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.disabled || el.readOnly) return false;
        if ((el.getAttribute('inputmode') || '').toLowerCase() === 'none') return false;
        if (el.isContentEditable) return true;
        if (el.tagName === 'TEXTAREA') return true;
        return el.tagName === 'INPUT' && KB_TYPES.test(el.type);
    }
    // Is a keyboard up, for a visual viewport h tall that was base tall
    // without one? Pure, and published for the suites.
    function keyboardUp(base, h) { return base > 0 && h < base - KB_MIN; }
    window.keyboardUp = keyboardUp;

    function kbStart(el) {
        // Field to field keeps the height measured before the keyboard came:
        // measured now it would already be the keyboard-short one.
        if (!kb.el) {
            var v = window.visualViewport;
            kb.base = v ? v.height : window.innerHeight;
            kb.w = v ? v.width : window.innerWidth;
            kb.seen = false;
        }
        kb.el = el;
        kbPaint();
        kbReveal(KB_FALLBACK_MS);
    }
    function kbPaint() {
        var root = document.documentElement, v = window.visualViewport;
        // A field no longer drawn (its dialog closed under it) has no keyboard,
        // even where a browser leaves it the active element.
        if (!kb.el || kb.el !== document.activeElement || !kb.el.getClientRects().length || !KB_MQ.matches) { kbEnd(); return; }
        var on = true;
        if (v) {
            // A new width is a rotation: the keyboard-free height is not the
            // one measured before it.
            if (Math.abs(v.width - kb.w) > 1) { kb.w = v.width; kb.base = v.height; kb.seen = false; }
            kb.base = Math.max(kb.base, v.height);
            var up = keyboardUp(kb.base, v.height);
            kb.seen = kb.seen || up;
            // The keyboard was up and has gone while the field keeps the
            // focus: Android's back gesture and the keyboard's own hide key do
            // not blur. The bars come back; a tap on the field raises the
            // keyboard again, the next resize sees it, and they go again.
            on = !(kb.seen && !up);
            // A pinch-zoomed page leaves the dialogs where they are: a scrim
            // fitted to a zoomed viewport would be narrower than the screen.
            if (on && v.scale <= 1.01) {
                root.style.setProperty('--kb-top', v.offsetTop + 'px');
                root.style.setProperty('--kb-h', v.height + 'px');
            } else {
                root.style.removeProperty('--kb-top');
                root.style.removeProperty('--kb-h');
            }
        }
        // An engine with no visualViewport gets the bars hidden and nothing
        // else: there is nothing to fit the dialogs to.
        root.classList.toggle('topo-kb', on);
    }
    function kbEnd() {
        clearTimeout(kb.timer);
        kb.el = null; kb.base = 0; kb.w = 0; kb.seen = false;
        var root = document.documentElement;
        root.classList.remove('topo-kb');
        root.style.removeProperty('--kb-top');
        root.style.removeProperty('--kb-h');
    }
    function kbReveal(ms) {
        clearTimeout(kb.timer);
        kb.timer = setTimeout(function () {
            if (kb.el && kb.el === document.activeElement && document.documentElement.classList.contains('topo-kb')) revealTyping(kb.el);
        }, ms);
    }
    // The tallest sticky thing in box stuck over its top (the drawer's header
    // and panel tabs, the table's header row), or over its bottom (the
    // report's actions), so the reveal clears it.
    function stickyEdge(box, sel, useTop) {
        var h = 0;
        box.querySelectorAll(sel).forEach(function (s) {
            var cs = getComputedStyle(s);
            if (cs.position !== 'sticky' || !s.offsetHeight) return;
            var r = s.getBoundingClientRect().height;
            h = Math.max(h, useTop ? (parseFloat(cs.top) || 0) + r : r);
        });
        return h;
    }
    // Scrolls el into the part of each scroller above it that is in sight
    // (inside the scroller's box and above the keyboard), vertically only,
    // like revealInRail: scrollIntoView would also slide the drawer's sideways
    // transform box, and on iOS it can scroll the layout viewport itself. A
    // field already in sight is left alone, so neither the browser's own scroll
    // to it nor the visitor's own scrolling is fought. The note editor sits in
    // #canvasContainer, which does not scroll, so nothing moves for it.
    function revealTyping(el) {
        var v = window.visualViewport;
        var vt = v ? v.offsetTop : 0, vb = v ? v.offsetTop + v.height : window.innerHeight;
        for (var guard = 0, cur = el; guard < 4; guard++) {
            var box = nearScroller(cur);
            if (!box) break;
            var bb = box.getBoundingClientRect();
            var top = Math.max(bb.top, vt) + stickyEdge(box, '.rail-head, .cfg-tabs, .tv-grid thead th:first-child, .rk-stable thead', true) + KB_PAD;
            var bottom = Math.min(bb.bottom, vb) - stickyEdge(box, '.rpv-actions', false) - KB_PAD;
            var r = el.getBoundingClientRect(), d = 0;
            if (r.bottom > bottom) d = r.bottom - bottom;
            // A field taller than the band shows its top.
            if (r.top - d < top) d = r.top - top;
            if (Math.abs(d) >= 1) box.scrollTop += d;
            cur = box;
        }
    }
    // A visualViewport resize is the keyboard coming, going or still sliding:
    // the scrim is fitted again and the reveal waits for the last one. A
    // scroll (the visual viewport panning) only moves the scrim.
    function onViewport(e) {
        if (!kb.el) return;
        kbPaint();
        if (e && e.type === 'resize') kbReveal(KB_SETTLE_MS);
    }
    // tests/suites/touchkeyboard.js and keyboarddesk.js call this after putting
    // a stand-in in place of window.visualViewport: Chromium cannot raise an
    // on-screen keyboard, so its geometry is only testable that way.
    window.syncKeyboard = onViewport;

    document.addEventListener('focusin', function (e) {
        if (KB_MQ.matches && typesText(e.target)) kbStart(e.target);
    });
    // Looked at a tick later, once the focus has landed: focus moving field to
    // field (the table's Enter, the next cell) never shows the bars for a
    // frame in between.
    document.addEventListener('focusout', function () {
        if (!kb.el && !KB_MQ.matches) return;
        setTimeout(function () {
            var a = document.activeElement;
            if (KB_MQ.matches && typesText(a)) { if (a !== kb.el) kbStart(a); return; }
            kbEnd();
        }, 0);
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onViewport);
        window.visualViewport.addEventListener('scroll', onViewport);
    }
    function kbMedia() { if (!KB_MQ.matches) kbEnd(); }
    if (KB_MQ.addEventListener) KB_MQ.addEventListener('change', kbMedia);
    else if (KB_MQ.addListener) KB_MQ.addListener(kbMedia);

    // carino-navbar.js is deferred and injects the bar during its own run. This
    // file is deferred right after it, so the bar is normally present already;
    // the retry is insurance for any load-order surprise.
    function boot() {
        var nav = document.getElementById('carinoNav');
        if (!nav) return false;
        syncActions();
        navReveal(nav);
        return true;
    }

    // ---- The fleet navbar on a phone (Mobile batch 2) ----
    // On a touch screen below the breakpoint (NAV_MQ) #carinoNav is out of the
    // page's flow and off the top of the screen (css/app.css), so the map and
    // the table get the full height, and --nav-h is 0 there, so nothing waits for the space under it.
    // It comes back sliding in OVER the content (nothing reflows, the camera
    // does not move) on:
    //   - a downward swipe that starts in the top NAV_BAND px of the screen, or
    //     on the pane's own top row (Map | Table and the search box);
    //   - a tap or a click on the thin handle at the top (#navHandle), or
    //     keyboard focus on it (it sits just before the bar in the Tab order);
    //   - the bar's own About window or menu opening (the ? key), or focus
    //     moving into it.
    // It goes again on a tap anywhere else, a swipe up on it, or NAV_IDLE ms
    // with nothing in it open or keyboard-focused. carino-navbar.js's own
    // data-immersive mode is left off: on a touch screen it only hides in
    // fullscreen, and it collapses the bar's height, which would reflow the
    // map. The shared file is untouched; all of this is Topo's.
    var NAV_BAND = 28, NAV_SWIPE = 24, NAV_IDLE = 4000;
    // A touch screen this narrow: a phone, or a tablet upright. A narrow desktop
    // window with a mouse keeps the pinned bar (css/app.css, the same query).
    var NAV_MQ = window.matchMedia(NAV_AWAY_MQ); // a phone held sideways too (js/state.js)
    var navWired = false;
    function navReveal(nav) {
        if (navWired) return;
        navWired = true;
        var root = document.documentElement;
        var timer = null, swipe = null, lastPointer = '';

        var handle = document.createElement('button');
        handle.type = 'button';
        handle.id = 'navHandle';
        handle.className = 'nav-handle';
        // Translated now (the page's first i18n pass ran before this file) and
        // on a language change by applyStaticI18n, which reads the English key
        // from the data-i18n-* marks.
        var handleLabel = typeof t === 'function' ? t('Show the menu bar') : 'Show the menu bar';
        handle.title = handleLabel;
        handle.setAttribute('aria-label', handleLabel);
        handle.setAttribute('data-i18n-title', 'Show the menu bar');
        handle.setAttribute('data-i18n-aria-label', 'Show the menu bar');
        handle.setAttribute('aria-expanded', 'false');
        handle.innerHTML = '<span aria-hidden="true"></span>';
        nav.parentNode.insertBefore(handle, nav);

        function phone() { return NAV_MQ.matches; }
        function shown() { return root.classList.contains('topo-nav-shown'); }
        // Something of the bar's is open: its About window, its ⋯ menu, the
        // theme switch's or any other menu of its (aria-expanded).
        function overlayOpen() {
            var menu = nav.querySelector('.cn-more-menu'), pop = nav.querySelector('.cn-help');
            return !!((menu && !menu.hidden) || (pop && !pop.hidden) || nav.querySelector('[aria-expanded="true"]'));
        }
        // ...or a keyboard is working in it (or on the handle, so the next Tab
        // still finds the bar), or a mouse rests on it. A button a finger
        // tapped keeps focus too, which is not a reason to stay.
        function busy() {
            if (overlayOpen()) return true;
            var a = document.activeElement;
            if (a && (nav.contains(a) || a === handle)) {
                try { if ((a !== handle && a.matches('input, select, textarea, [contenteditable]')) || a.matches(':focus-visible')) return true; }
                catch (e) { return true; }
            }
            // A mouse on a touch screen (a tablet with one): the last pointer
            // said so, whatever the screen's main pointer is.
            try { if (lastPointer === 'mouse' && (nav.matches(':hover') || handle.matches(':hover'))) return true; } catch (e) { /* no :hover */ }
            return false;
        }
        // keepFocus: the window grew past the breakpoint, so the bar is pinned
        // again rather than put away, and an open About window keeps its focus.
        function set(on, keepFocus) {
            if (on === shown()) return;
            root.classList.toggle('topo-nav-shown', on);
            handle.setAttribute('aria-expanded', on ? 'true' : 'false');
            if (!on && !keepFocus) {
                var a = document.activeElement;
                if (a && nav.contains(a) && a.blur) a.blur();
            }
            try { document.dispatchEvent(new CustomEvent('topo:navbar', { detail: { shown: on } })); } catch (e) { /* old engine */ }
        }
        function arm() {
            clearTimeout(timer);
            if (!shown()) return;
            timer = setTimeout(function () {
                if (!phone()) return;
                if (busy()) arm(); else set(false);
            }, NAV_IDLE);
        }
        function show() { if (!phone()) return; set(true); arm(); }
        function hide() { clearTimeout(timer); set(false); }
        // A modal dialog is above everything (Topo's are .modal-scrim divs,
        // z-index over the bar's); the bar does not come in under one.
        function dialogOpen() {
            if (document.querySelector('dialog[open]')) return true;
            var ds = document.querySelectorAll('.modal-scrim');
            for (var i = 0; i < ds.length; i++) if (ds[i].getClientRects().length) return true;
            return false;
        }
        // The top row itself, not what hangs from it: the Saved searches sheet
        // (and any menu panel) scrolls, and a drag down there scrolls it back.
        function onTopRow(t) {
            var bar = t && t.closest && t.closest('#canvasContainer > .topo-topbar');
            if (!bar || t.closest('.cs-menu-panel, [role="menu"]')) return false;
            for (var n = t; n && n !== bar; n = n.parentElement) if (n.scrollTop > 0) return false;
            return true;
        }
        function topY(clientY) { return clientY - ((window.visualViewport && window.visualViewport.offsetTop) || 0); }
        function touchOf(list, id) {
            for (var i = 0; list && i < list.length; i++) if (list[i].identifier === id) return list[i];
            return null;
        }

        handle.addEventListener('click', show);
        handle.addEventListener('focus', function () {
            try { if (handle.matches(':focus-visible')) show(); } catch (e) { /* no :focus-visible */ }
        });
        nav.addEventListener('focusin', function () { if (phone()) show(); });
        nav.addEventListener('focusout', function () { if (shown()) arm(); });
        // The ? key, or a script, opening the About window: it is in the bar.
        // Its closing starts the idle count again; nothing else here does, so a
        // bar that changes on its own (the clock) never keeps itself up.
        var wasOpen = false;
        if (window.MutationObserver) {
            new MutationObserver(function () {
                var open = overlayOpen();
                if (open === wasOpen) return;
                wasOpen = open;
                if (!phone()) return;
                if (open) show(); else if (shown()) arm();
            }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-expanded'] });
        }

        // A tap or a click anywhere else puts it away (its About window's
        // backdrop is inside the bar, so that is not "elsewhere").
        // A tap in it is use: the idle count starts again (the theme switch is
        // no menu, and a tapped button is not keyboard focus).
        window.addEventListener('pointerdown', function (e) {
            lastPointer = e.pointerType || '';
            if (!phone() || !shown()) return;
            var t = e.target;
            if (nav.contains(t) || handle.contains(t)) { arm(); return; }
            if (overlayOpen()) return;
            hide();
        }, true);
        // A mouse on such a screen (a tablet with one): the pointer at the very
        // top brings it.
        window.addEventListener('pointermove', function (e) {
            lastPointer = e.pointerType || lastPointer;
            if (e.pointerType === 'mouse' && phone() && !shown() && e.clientY <= 4 && !dialogOpen()) show();
        }, { passive: true });

        // The swipes. Capture on window runs before the map's own touchstart
        // (js/app.js mapTouchStart), so a swipe that starts in the top band on
        // the map is kept from the map: it reveals the bar and never pans.
        // Lower down, the map's touches are not touched.
        // A second finger while a band touch is held from the map: it was a
        // pinch after all. The map is given the first finger (mapTouchStart,
        // js/app.js, as it would have had it) and this touch goes on to it, so
        // the two pinch as anywhere else.
        function handOver(e) {
            var s = swipe, first = touchOf(e.touches, s.id);
            swipe = null;
            if (first && typeof mapTouchStart === 'function') {
                mapTouchStart({ target: s.target, touches: e.touches, changedTouches: [first], cancelable: false, preventDefault: function () {} });
            }
        }
        window.addEventListener('touchstart', function (e) {
            if (swipe && swipe.map && e.touches && e.touches.length > 1) { handOver(e); return; }
            swipe = null;
            if (!phone() || !e.touches || e.touches.length !== 1) return;
            var tp = e.changedTouches[0], t = e.target;
            if (shown()) {
                if (nav.contains(t)) swipe = { id: tp.identifier, x: tp.clientX, y: tp.clientY, up: true };
                return;
            }
            if (dialogOpen()) return;
            var band = topY(tp.clientY) <= NAV_BAND;
            var onTop = onTopRow(t);
            if (!band && !onTop && t !== handle) return;
            var onMap = band && !!(t && t.closest && t.closest('#networkCanvas'));
            swipe = { id: tp.identifier, x: tp.clientX, y: tp.clientY, down: true, map: onMap, done: false, target: t };
            if (onMap) e.stopPropagation();
        }, { capture: true, passive: true });
        window.addEventListener('touchmove', function (e) {
            if (!swipe) return;
            if (swipe.map) e.stopPropagation();
            if (e.touches && e.touches.length > 1) { swipe = null; return; }
            var tp = touchOf(e.changedTouches, swipe.id);
            if (!tp || swipe.done) return;
            var dx = tp.clientX - swipe.x, dy = tp.clientY - swipe.y;
            if (swipe.down && dy >= NAV_SWIPE && Math.abs(dx) < dy) { swipe.done = true; show(); }
            else if (swipe.up && -dy >= NAV_SWIPE && Math.abs(dx) < -dy) {
                swipe.done = true;
                if (!overlayOpen()) hide();
            }
        }, { capture: true, passive: true });
        function swipeEnd(e) {
            if (!swipe) return;
            var s = swipe;
            if (!touchOf(e.changedTouches, s.id)) { if (s.map) e.stopPropagation(); return; }
            swipe = null;
            if (s.map) {
                e.stopPropagation();
                // The map never heard this finger, but it was a finger on the
                // map: a dblclick right after is a double-tap (fromTouch,
                // js/app.js, where a browser does not say so on the event).
                if (typeof mapTouchNoted === 'function') mapTouchNoted();
            }
            // A swipe that showed the bar is not a tap on what it started on.
            if (s.done && s.down && e.cancelable) e.preventDefault();
        }
        window.addEventListener('touchend', swipeEnd, { capture: true, passive: false });
        window.addEventListener('touchcancel', swipeEnd, { capture: true, passive: true });

        // Across the breakpoint: wider, the bar is pinned again (an open About
        // window keeps its focus); narrower with its About window open or
        // focus in it, it is shown, not hidden under what is open.
        function onWidth() {
            if (!phone()) { clearTimeout(timer); set(false, true); return; }
            var a = document.activeElement;
            if (overlayOpen() || (a && nav.contains(a))) show();
        }
        if (NAV_MQ.addEventListener) NAV_MQ.addEventListener('change', onWidth);
        else if (NAV_MQ.addListener) NAV_MQ.addListener(onWidth);
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
