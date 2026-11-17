// ---- Motion: the map and the rack view showing what changed ----
// A collapse, an expand, a Tidy, an undo or a drop redraws the map at once
// (drawCanvas rebuilds the layers): without motion a device just appears
// somewhere else and the eye has to find it again. Here a change is played
// from where things were to where they are now:
//   - a device that moved glides from its old place to its new one;
//   - devices folded into a collapsed group (or a VM into its host) fly into
//     it and fade, and the group's node grows in where they meet;
//   - expanded, they spread out from the group's node, which fades;
//   - a frame that appears fades in, one that grows or shrinks eases to its
//     new size, and the frame a drop went into pulses once.
// In the rack view a box that moved, grew or shrank slides to its units, a
// new one settles in, and the cables fade back in over them.
// A network that is opened pops in, and so does what is added to one; the
// rail's library closes and opens rather than vanishing (both further down).
//
// Only the picture moves. The Web Animations API animates a CSS transform and
// opacity over the elements as drawn and leaves their attributes alone, so a
// saved file, a share link, the SVG and PNG exports and the report read the
// same thing with or without motion, and nothing waits for an animation to
// end. A ghost (a copy of a device that is no longer drawn, flying into its
// group) lives in a layer of its own, never clicked, gone when it lands.
//
// Off when the system asks for reduced motion, and under automation: the
// suites read the map right after an action and must not meet a ghost.
// Playwright's Chromium reports navigator.webdriver; tests/run.sh's headless
// one does not, so its probe sets window.TOPO_MOTION = false. A browser check
// that wants to see the motion sets it to true.
const MOTION_MS = 260;
const MOTION_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const motionOn = () => {
    if (typeof window.TOPO_MOTION === 'boolean') return window.TOPO_MOTION;
    if (navigator.webdriver) return false;
    try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; }
};
const motionAnimate = (el, frames, opts) => {
    try { return el.animate(frames, Object.assign({ duration: MOTION_MS, easing: MOTION_EASE }, opts)); } catch (e) { return null; }
};
const mxy = (p, s = 1) => `translate(${p.x}px, ${p.y}px)${s === 1 ? '' : ` scale(${s})`}`;

// ---- The map ----
// Where each device is drawn: its own place, or the place of what it is folded
// into (a collapsed group's node, or its folded host, which may itself be in a
// collapsed group). `folded` says it is not drawn as itself.
function mapDrawnPoints() {
    const gv = typeof groupMapNow === 'function' ? groupMapNow() : null;
    const folds = new Map();
    if (gv) gv.folds.forEach((f) => folds.set(f.group.id, { x: f.x, y: f.y }));
    const pts = new Map();
    const pointOf = (n, depth) => {
        if (pts.has(n.id)) return pts.get(n.id);
        let p = { x: n.x, y: n.y, folded: false };
        if (gv && gv.hidden.has(n.id) && folds.has(gv.hidden.get(n.id))) p = { ...folds.get(gv.hidden.get(n.id)), folded: true };
        else if (gv && gv.guestHidden && gv.guestHidden.has(n.id) && depth < 4) {
            const host = getNode(gv.guestHidden.get(n.id));
            if (host) p = { ...pointOf(host, depth + 1), folded: true };
        }
        pts.set(n.id, p);
        return p;
    };
    state.nodes.forEach((n) => { if (n) pointOf(n, 0); });
    const frames = new Map();
    if (gv) gv.frames.forEach((f) => frames.set(f.group.id, { ...f.rect }));
    return { pts, folds, frames };
}

// Before a change: where everything is, and a copy of every device and group
// node drawn (the redraw throws the originals away; a device folded by the
// change flies into its group as its copy). Null when there is no motion.
function mapMotionStart() {
    if (!motionOn() || typeof lNodes === 'undefined' || !lNodes) return null;
    const ghosts = new Map();
    lNodes.querySelectorAll(':scope > [id^="ui-node-"]').forEach((el) => ghosts.set(el.id, el.cloneNode(true)));
    const svg = lNodes.ownerSVGElement || document;
    svg.querySelectorAll('[id^="ui-group-"]').forEach((el) => ghosts.set(el.id, el.cloneNode(true)));
    return Object.assign(mapDrawnPoints(), { ghosts });
}

// The layer the ghosts fly in: over the devices, under the notes, never hit.
function motionLayer() {
    let layer = document.getElementById('layer-motion');
    if (!layer && lNodes && lNodes.parentNode) {
        layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layer.setAttribute('id', 'layer-motion');
        layer.setAttribute('aria-hidden', 'true');
        layer.style.pointerEvents = 'none';
        lNodes.parentNode.insertBefore(layer, lNodes.nextSibling);
    }
    return layer;
}
function motionGhost(copy, from, to, frames) {
    const layer = motionLayer();
    if (!layer || !copy) return;
    copy.removeAttribute('id');
    copy.setAttribute('class', 'motion-ghost');
    layer.appendChild(copy);
    const a = motionAnimate(copy, frames || [
        { transform: mxy(from), opacity: 1 },
        { transform: mxy(to, 0.35), opacity: 0 }
    ], { fill: 'forwards' });
    const gone = () => copy.remove();
    if (a) { a.onfinish = gone; a.oncancel = gone; } else gone();
}

// After the change has been drawn: play it. opts.pulse: a group id whose
// frame pulses (the one a drop went into).
function mapMotionPlay(before, opts = {}) {
    if (!before) return;
    const after = mapDrawnPoints();
    const near = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
    let moved = 0;
    // Devices drawn now: glide, spread out of a group, or appear.
    state.nodes.forEach((n, i) => {
        if (!n) return;
        const now = after.pts.get(n.id), was = before.pts.get(n.id);
        if (!now || now.folded) return;
        const el = document.getElementById(`ui-node-${n.id}`);
        if (!el) return;
        const delay = Math.min(i, 12) * 10;
        if (!was) {
            // A device that is new to the map already pops in (mapPopDrawn, below).
            if (!el.getAnimations().length) motionAnimate(el, [{ transform: mxy(now, 0.6), opacity: 0 }, { transform: mxy(now), opacity: 1 }], { delay });
            moved++;
        } else if (was.folded) {
            motionAnimate(el, [{ transform: mxy(was, 0.35), opacity: 0 }, { transform: mxy(now), opacity: 1 }], { delay, fill: 'backwards' });
            moved++;
        } else if (!near(was, now)) {
            motionAnimate(el, [{ transform: mxy(was) }, { transform: mxy(now) }]);
            moved++;
        }
    });
    // Devices drawn before and folded now: their copies fly in.
    before.pts.forEach((was, id) => {
        const now = after.pts.get(id);
        if (was.folded || !now || !now.folded) return;
        motionGhost(before.ghosts.get(`ui-node-${id}`), was, now);
        moved++;
    });
    // Group nodes: one that appears grows in once its devices have arrived;
    // one that is gone (expanded) swells and fades where it was.
    after.folds.forEach((p, gid) => {
        if (before.folds.has(gid)) return;
        const el = document.getElementById(`ui-group-${gid}`);
        if (el) motionAnimate(el, [{ transform: mxy(p, 0.5), opacity: 0 }, { transform: mxy(p), opacity: 1 }], { delay: MOTION_MS * 0.45, fill: 'backwards' });
        moved++;
    });
    before.folds.forEach((p, gid) => {
        if (after.folds.has(gid)) return;
        motionGhost(before.ghosts.get(`ui-group-${gid}`), p, p, [
            { transform: mxy(p), opacity: 1 }, { transform: mxy(p, 1.35), opacity: 0 }]);
        moved++;
    });
    // Frames: a new one fades in, one that changed size eases to it.
    const layer = document.getElementById('layer-groups');
    after.frames.forEach((r, gid) => {
        const g = layer && layer.querySelector(`.grp-frame[data-grp="${CSS.escape(gid)}"]`);
        if (!g) return;
        const was = before.frames.get(gid);
        if (!was) { motionAnimate(g, [{ opacity: 0 }, { opacity: 1 }], { delay: MOTION_MS * 0.3, fill: 'backwards' }); return; }
        if (was.x === r.x && was.y === r.y && was.w === r.w && was.h === r.h) return;
        const box = g.querySelector(':scope > rect');
        if (box) motionAnimate(box, [{ x: `${was.x}px`, y: `${was.y}px`, width: `${was.w}px`, height: `${was.h}px` },
            { x: `${r.x}px`, y: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }]);
        const tab = g.querySelector(':scope > .grp-tab'), toggle = g.querySelector(':scope > .grp-toggle');
        if (tab) motionAnimate(tab, [{ transform: mxy({ x: was.x + 14, y: was.y }) }, { transform: mxy({ x: r.x + 14, y: r.y }) }]);
        if (toggle) motionAnimate(toggle, [{ transform: mxy({ x: was.x + 25, y: was.y }) }, { transform: mxy({ x: r.x + 25, y: r.y }) }]);
    });
    if (opts.pulse) {
        const g = layer && layer.querySelector(`.grp-frame[data-grp="${CSS.escape(opts.pulse)}"] > rect`);
        if (g) motionAnimate(g, [{ strokeOpacity: 0.6, strokeWidth: 1.5 }, { strokeOpacity: 1, strokeWidth: 4, stroke: 'var(--accent)' }, { strokeOpacity: 0.6, strokeWidth: 1.5 }],
            { duration: MOTION_MS * 2.2, easing: 'ease-in-out' });
    }
    // The cables are drawn where the devices end up: they come in as the
    // devices arrive rather than waiting there ahead of them.
    // So do the subnets' bubbles, which are drawn round where they end up.
    if (moved) {
        ['layer-links', 'layer-labels', 'layer-zones', 'traceWorkspace'].forEach((id) => {
            const layer = document.getElementById(id);
            if (layer) motionAnimate(layer, [{ opacity: 0.15 }, { opacity: 1 }], { duration: MOTION_MS * 1.2, easing: 'ease-in' });
        });
    }
}

// fn changes and redraws the map; what it changed is played.
function mapMotion(fn, opts) {
    const before = mapMotionStart();
    const out = fn();
    mapMotionPlay(before, opts);
    return out;
}

// ---- Things arriving on the map ----
// A network opened (a file, a link, a template, a kept network, the page
// itself) pops in: each device, group node and note grows from small past
// its size and settles, one after another from the top of the map down, and
// the cables, labels, frames and bubbles fade in behind them. Devices, notes
// and cables added to a map already open pop in the same way, the rest left
// still (mapPopDrawn).
const POP_MS = 380;
const POP_SPREAD_MS = 420;   // the last of a whole map starts this long after the first
const POP_MAX = 2000;        // past this many, the map fades in as one
const popFrames = (p) => [{ transform: mxy(p, 0.3), opacity: 0 }, { transform: mxy(p, 1.08), opacity: 1, offset: 0.65 }, { transform: mxy(p), opacity: 1 }];
// What is drawn on the map, each with its place: devices not folded away,
// the nodes of collapsed groups, notes and texts. `want` picks among them.
function mapPopItems(want) {
    const now = mapDrawnPoints(), items = [];
    state.nodes.forEach((n) => {
        const p = n && now.pts.get(n.id);
        if (!p || p.folded || (want && !want('node', n.id))) return;
        const el = document.getElementById(`ui-node-${n.id}`);
        if (el) items.push({ el, p });
    });
    now.folds.forEach((p, gid) => {
        if (want && !want('group', gid)) return;
        const el = document.getElementById(`ui-group-${gid}`);
        if (el) items.push({ el, p });
    });
    (state.annotations || []).forEach((a) => {
        if (!a || (want && !want('annotation', a.id))) return;
        const el = document.getElementById(`ui-ann-${a.id}`);
        if (el) items.push({ el, p: { x: a.x, y: a.y } });
    });
    return items.sort((a, b) => (a.p.y - b.p.y) || (a.p.x - b.p.x));
}
function mapPop(items, spread) {
    const last = items.length - 1, t0 = performance.now();
    items.forEach((it, i) => {
        const delay = last > 0 ? Math.round((i / last) * spread) : 0;
        it.el.getAnimations().forEach((x) => x.cancel());   // one carried on from a moment ago: this one replaces it
        motionAnimate(it.el, popFrames(it.p), { duration: POP_MS, easing: 'ease-out', fill: 'backwards', delay });
        _popFlying.set(it.el.id, { t0, delay, p: it.p });
    });
}
function mapFadeIn(el, delay) {
    motionAnimate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: POP_MS, easing: 'ease-in', fill: 'backwards', delay });
    _popFlying.set(el.id, { t0: performance.now(), delay, p: null });
}
// The map is drawn afresh by every edit, and often twice in a row (a paste
// selects what it made, the page's start-up fits and settles): the elements
// that were popping in are thrown away with their animations. What is still
// on its way is remembered by element id and carried on, from where it had
// got to, over the new elements.
const _popFlying = new Map();
function mapPopCarryOn() {
    if (!_popFlying.size) return;
    const now = performance.now();
    _popFlying.forEach((f, id) => {
        const left = f.delay + POP_MS - (now - f.t0);
        if (left <= 0) { _popFlying.delete(id); return; }
        const el = document.getElementById(id);
        if (!el || el.getAnimations().length) return;
        const opts = { duration: POP_MS, fill: 'backwards', delay: Math.round(f.delay - (now - f.t0)) };
        if (f.p) motionAnimate(el, popFrames(f.p), Object.assign(opts, { easing: 'ease-out' }));
        else motionAnimate(el, [{ opacity: 0 }, { opacity: 1 }], Object.assign(opts, { easing: 'ease-in' }));
    });
}
// A whole network just drawn (replaceDocument, js/app.js).
function mapMotionArrive() {
    if (!motionOn() || typeof lNodes === 'undefined' || !lNodes || document.body.classList.contains('table-view')) return;
    const items = mapPopItems(null);
    if (!items.length) return;
    const whole = items.length > POP_MAX;
    const spread = whole ? 0 : Math.min(POP_SPREAD_MS, items.length * 24);
    if (!whole) mapPop(items, spread);
    ['layer-links', 'layer-labels', 'layer-zones', 'layer-groups', 'traceWorkspace'].concat(whole ? ['layer-nodes', 'layer-annotations'] : []).forEach((id) => {
        const layer = document.getElementById(id);
        if (layer) motionAnimate(layer, [{ opacity: 0 }, { opacity: 1 }], { duration: POP_MS, easing: 'ease-in', fill: 'backwards', delay: Math.round(spread * 0.5) });
    });
}
// Every drawing (renderCanvasOnly, js/ui.js): a device, note or cable the
// map had not shown yet pops in, whatever put it there: the palette, a drop,
// Add devices, a block, a paste, an import, a merge, an undo that brings one
// back. What was already there stays still. The map remembers which ids it
// has shown; a network being opened forgets them first (mapPopReset), since
// that is mapMotionArrive's to play. The binder report's borrowed drawings
// (canvasIsBorrowed, js/app.js) are not the map and are not remembered.
let _popKnown = null;
function mapPopReset() { _popKnown = null; _popFlying.clear(); }
function mapPopDrawn() {
    if (typeof canvasIsBorrowed === 'function' && canvasIsBorrowed()) return;
    const known = _popKnown;
    const now = { node: new Set(), annotation: new Set(), link: new Set() };
    state.nodes.forEach((n) => { if (n) now.node.add(n.id); });
    (state.annotations || []).forEach((x) => { if (x) now.annotation.add(x.id); });
    state.links.forEach((l) => { if (l) now.link.add(l.id); });
    _popKnown = now;
    if (!motionOn() || typeof lNodes === 'undefined' || !lNodes || document.body.classList.contains('table-view')) { _popFlying.clear(); return; }
    mapPopCarryOn();
    if (!known) return;
    if (now.node.size <= known.node.size && now.annotation.size <= known.annotation.size && now.link.size <= known.link.size
        && [...now.node].every((id) => known.node.has(id)) && [...now.link].every((id) => known.link.has(id)) && [...now.annotation].every((id) => known.annotation.has(id))) return;
    const items = mapPopItems((kind, id) => kind !== 'group' && !known[kind].has(id));
    if (items.length > POP_MAX) return;
    const spread = Math.min(POP_SPREAD_MS, Math.max(0, items.length - 1) * 24);
    mapPop(items, spread);
    state.links.forEach((l) => {
        if (!l || known.link.has(l.id)) return;
        const el = document.getElementById(`ui-link-${l.id}`);
        if (el) mapFadeIn(el, Math.round(spread * 0.5));
    });
}

// ---- The rail's library folding and unfolding ----
// updateRailWrap (js/ui.js) folds the library to one row and gives the rail
// to the panels, or brings it back. Played: the tabs and the library close
// up (or open) and fade while the panels grow (or shrink) into the room. The
// heights are animated over the elements as laid out and let go at the end;
// while it folds, .lib-folding keeps the library drawn (css/app.css).
const RAIL_FOLD_MS = 220;
const railFoldParts = (rail) => [rail.querySelector('#libraryTabs'), rail.querySelector('.rail-lib'), rail.querySelector('.rail-props')].filter(Boolean);
function railFoldEnd(rail) {
    (rail._foldAnims || []).forEach((a) => { try { a.cancel(); } catch (e) { /* done */ } });
    rail._foldAnims = null;
    rail.classList.remove('lib-folding');
}
// Before the fold changes: how tall each part is.
function railFoldStart(rail) {
    if (!rail) return null;
    railFoldEnd(rail);
    if (!motionOn() || !rail.getClientRects().length) return null;
    return railFoldParts(rail).map((el) => ({ el, h: el.getBoundingClientRect().height }));
}
// After it has changed: play it.
function railFoldPlay(rail, before, wrapped) {
    if (!before) return;
    const after = before.map((b) => b.el.getBoundingClientRect().height);   // a folded part is 0
    if (wrapped) rail.classList.add('lib-folding');
    const anims = [];
    before.forEach((b, i) => {
        const from = b.h, to = after[i];
        if (Math.abs(from - to) < 1) return;
        const lib = !b.el.classList.contains('rail-props');
        const cs = getComputedStyle(b.el);
        const end = (h) => Object.assign({ height: `${h}px`, minHeight: '0px', flexGrow: 0, flexShrink: 0, flexBasis: 'auto', overflow: 'hidden' },
            lib ? { opacity: h < 1 ? 0 : 1, paddingTop: h < 1 ? '0px' : cs.paddingTop, paddingBottom: h < 1 ? '0px' : cs.paddingBottom } : {});
        const a = motionAnimate(b.el, [end(from), end(to)], { duration: RAIL_FOLD_MS });
        if (a) anims.push(a);
    });
    if (!anims.length) { rail.classList.remove('lib-folding'); return; }
    rail._foldAnims = anims;
    const done = () => { if (rail._foldAnims === anims) { rail._foldAnims = null; rail.classList.remove('lib-folding'); } };
    // The promise, not the finish event: it settles with the animation, the
    // event waits for a frame that a hidden tab never paints.
    Promise.allSettled(anims.map((a) => a.finished)).then(done);
}

// ---- The rack view ----
// Each box's place inside the faces (so the pane's scroll is not a move), by
// device and face; a device full depth is drawn on both.
// A VM's chip (.rk-guest) is keyed by the guest and the box it is drawn in.
const RACK_MOVERS = '.rk-dev[data-node], .rk-guest[data-guest]';
function rackBoxKey(el) {
    const box = el.classList.contains('rk-guest') ? el.closest('.rk-dev') : el;
    const face = box && box.classList.contains('rk-back') ? 'b' : 'f';
    return el.classList.contains('rk-guest') ? `g|${el.dataset.guest}|${box ? box.dataset.node : ''}|${face}` : `d|${el.dataset.node}|${face}`;
}
function rackMotionStart(body) {
    if (!motionOn() || !body) return null;
    const faces = body.querySelector('.rk-faces');
    if (!faces) return null;
    const o = faces.getBoundingClientRect();
    const boxes = new Map();
    faces.querySelectorAll(RACK_MOVERS).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width) boxes.set(rackBoxKey(el), { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height });
    });
    return { rack: body.dataset.rack, boxes };
}
function rackMotionPlay(body, before) {
    if (!before || !body || body.dataset.rack !== before.rack) return;
    const faces = body.querySelector('.rk-faces');
    if (!faces) return;
    const o = faces.getBoundingClientRect();
    let moved = 0;
    faces.querySelectorAll(RACK_MOVERS).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const was = before.boxes.get(rackBoxKey(el));
        if (!was) {
            motionAnimate(el, [{ transform: 'scale(0.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: MOTION_MS * 0.8 });
            moved++;
            return;
        }
        // A chip rides in its host's box, which plays the box's move.
        if (el.classList.contains('rk-guest')) return;
        const dx = was.x - (r.left - o.left), dy = was.y - (r.top - o.top);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(was.h - r.height) < 0.5 && Math.abs(was.w - r.width) < 0.5) return;
        // Played from the old box's top left, at the old size, to the new.
        el.style.transformOrigin = '0 0';
        const a = motionAnimate(el, [
            { transform: `translate(${dx}px, ${dy}px) scale(${was.w / r.width}, ${was.h / r.height})` },
            { transform: 'none' }]);
        const done = () => { el.style.transformOrigin = ''; };
        if (a) { a.onfinish = done; a.oncancel = done; } else done();
        moved++;
    });
    if (moved) {
        const wiring = faces.querySelector('.rk-wiring');
        if (wiring) motionAnimate(wiring, [{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS, delay: MOTION_MS * 0.6, fill: 'backwards' });
    }
}
