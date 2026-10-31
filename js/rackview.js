// ---- The rack view (Review-Packs/Topo-groups.md, step C part 1) ----
// A rack group drawn as what it is: a column of units, numbered as its rails
// are (from the bottom, or from the top for a rack set so: only the printed
// numbers change, see "How a rack's units are numbered" in js/model.js), as
// wide as its width says against a 19" one, with each device placed in it as
// a box over the units it takes. The head's Size button opens the rack's
// size fields, the Groups tab's own (rackSizeFieldsHtml, js/groups.js). It is the third face of the register, beside Map and Table
// in the same switch (js/table.js), and lies over the map as the table does,
// so the map keeps its size underneath. The switch offers it only while the
// document has a rack; the picker in its head says which rack.
//
// Where it opens: the Groups tab's Open rack (js/groups.js), the Open rack
// control beside a collapsed rack on the map (js/groupmap.js), or the switch.
//
// What it shows: front and rear side by side, each its own column of units
// (rackClash in js/model.js: a half-depth device at the back does not take
// the units of a half-depth one at the front; a full-depth one, the
// default, takes both). On a phone there is room for one, and a
// Front | Rear switch picks it. A device is a box with its type's icon, its
// name and its units; a planned one is outlined dashed and a retired one
// dimmed, as on the map. One drawn outside the rack or over another device
// (a spreadsheet can say so; nothing here can) is marked, not hidden.
// Devices in the rack with no unit yet are listed beside it, Not placed yet,
// each with Place (the lowest units free that fit it).
//
// Placing: drag down or up the empty units of a face; the rectangle snaps to
// whole units, and letting go asks which device goes there (this rack's
// devices not placed yet first, then devices in no group, then the rest,
// which move here from wherever they were) or makes a new one of a type.
// A tap, or Enter on an empty run with the keyboard, asks for one unit; the
// dialog's fields change the units, the height and the face before picking.
// Moving and resizing snap to units too: drag a device, or its top edge once
// it is selected; with the keyboard, the arrows move the focused device a
// unit, Shift+arrows make it taller or shorter, left and right put it on the
// front or the rear. A phone, which has no hover and whose finger on a
// device scrolls the rack, gets the same as buttons under the selected
// device's name. Units already taken, or past the top or the bottom, are
// refused, with a toast saying by what; nothing is written. Each change is
// one batch(): one undo step, one redraw.
//
// Selection is the one selection (state.selection): a device clicked here is
// selected on the map and in the table, and the rail shows its editor; Shift
// or Ctrl adds or takes out, as on the map.
//
// Which rack is on show, and which face a phone shows, are a view: kept for
// this visit, never in the document, a file or a link. Like the table, the
// view is rebuilt from the document after anything changes (renderCanvasOnly
// calls renderRackView), only while it shows, and never under a gesture in
// progress, which would take the box being dragged away.
//
// Cables ("Round 5", R5a; one line per device pair before that): each cable
// is drawn from its port to the other end's port, along the boxes' lower
// edges and through the cable manager between the faces, tagged with its
// label or its ports; a cable out of the rack ends at the rack's edge, its
// tag naming where it goes. The filter in the head (All, Selected, One
// cable) says which are bold and tagged. See "The cables, port to port"
// below. The rear is drawn as the front's mirror, its numbers on its outer
// rail, so both faces' devices meet the manager on their inner edge. On a
// phone the manager sits on the shown face's side. Beside the rack, its
// patch schedule ("Round 5", R5b) lists the same cables a row each, sorted by
// any column; a row traces its cable on the elevation. On a phone the list is
// the main view, the elevation stuck above it. See "The patch schedule".
// A cable is drawn by dragging from a free port to another device's free
// port (bound to both, one undo step), or from a device's plug (the dot on
// its inner side, there on every device, finger-sized) to another device, or
// with the selected device's Cable to… button and then a tap on the other
// end; those two make the cable like the map's (bindLink picks free ports)
// in one undo step, and select it, so the rail opens on its port picker to
// change them. A device fills the rack's depth unless it is set to one face
// (rackDepth 'half'; full is the default, "Round 2", item 3), and takes its
// units on both faces: it is drawn on the other face too, dimmed, as its
// back, and nothing can be put there.
//
// Bringing devices in and taking them out (Review-Packs/Topo-groups.md,
// "Round 2", item 2), by dragging, with a tap for each as well:
//   in    a device under Not placed yet, or one under Other devices (every
//         device not in this rack, in no group first), dragged onto the units
//         goes there, its own height tall, centred on the pointer: it joins
//         the rack if it was not in it. A mouse drags the row; a finger drags
//         the row's handle (the rest of the row scrolls the list, as a finger
//         on a device scrolls the rack). Place, on the row, is the tap.
//   out   a placed device dragged off the units shows two targets beside
//         the rack, over the column of lists (across the top of the units
//         where that column is under the rack), and only they act: Not placed yet keeps it in
//         the rack with no units (Clear its units, as a drag), Out of the rack
//         takes it out of the rack group, into the group the rack is in (the
//         room it stands in, so the device still says where it is), or into
//         no group for a rack at the top. Two targets rather than one rule,
//         because the two are both common (a server pulled for repair stays
//         the rack's; a desk switch carried to an office does not), and a rule
//         would have to guess. Let go anywhere else, it goes back to where it
//         was: off the rack is not a place. The selected device's Out of the
//         rack button is the tap.
// Each is one batch(): one undo step. Units taken, or too few, are refused as
// a move is, with the same toast.
//
// The full editor's, like the table: "U" and the type names stay English;
// the sentences, Front and Rear, Place and the rest are translated
// (MESSAGES, js/i18n.js). A reduced view never shows it.
// Load order: ... groups -> groupmap -> table -> rackview -> query -> ... -> app

const _rv = {
    rackId: null,      // the rack on show, or null for the first one
    face: 'front',     // the face a phone shows; anything wider shows both
    drag: null,        // the gesture in progress: see onRackPointerDown
    dirty: true,
    suppressClick: false,
    pendingPlace: null, // units let go of, for the click that follows to ask about
    cableFrom: null,   // a device whose Cable to… waits for a tap on the other end
    othersOpen: false, // Other devices, opened (a view, this visit)
    othersFilter: '',  // and what its filter says
    sizeOpen: false,   // the head's Size fields, opened (a view, this visit)
    hot: null,         // the line or device pointed at: rvSetHot
    wired: null,       // the flags as last drawn, for rvPlaceFlags to place: rvDrawCables
    cables: 'sel',     // the cable filter, all, sel or one (a view kept in this browser): setRackCables
    noPort: null,      // each device's cables with no port drawn on its box, as of the last rebuild: rvNoPortLinks
    drawnAt: '',       // the faces' size the cables were last drawn for
    reveal: '',        // a device just tapped, for the rebuild to keep in sight: renderRackView
    zoom: 1,           // the unit's height, 1x, 2x or 3x (a view kept in this browser): setRackZoom
    portTip: null,     // the port whose tip shows, { node, port, how }: rvShowPortTip
    badLinks: null,    // the cables an open finding names, as of the last rebuild: rvBadLinks
    sort: { key: 'dev', dir: 1 }, // the patch schedule's sort (a view, this visit): setRackSort
    trace: '',         // a cable a schedule row just traced, for the rebuild to bring into sight: rvTraceCable
    schedSel: ''       // the cable selected at the last rebuild, so its row is scrolled to once: rvRevealSchedule
};
const RV_FACES = ['front', 'rear'];
const RV_FACE_NAMES = { front: 'Front', rear: 'Rear' };
const rvEl = (id) => document.getElementById(id);
const rackViewEl = () => rvEl('rackView');
const rackShown = () => { const v = rackViewEl(); return !!v && !v.classList.contains('hidden'); };
// The racks, in the Groups tab's order.
const rackGroups = () => groupTree().map((e) => e.group).filter(isRackGroup);
// The switch offers Rack while there is a rack to show, in the full editor.
const rackViewOffered = () => !isReduced() && (state.groups || []).some(isRackGroup);
// The rack on show: the one picked, else the first. Null without racks.
function currentRack() {
    const picked = groupById(_rv.rackId);
    if (isRackGroup(picked)) return picked;
    const first = rackGroups()[0] || null;
    _rv.rackId = first ? first.id : null;
    return first;
}
const rvPhone = () => !!(window.matchMedia && window.matchMedia(PHONE_MQ).matches);
const rvName = (n) => (n.name && String(n.name).trim()) || n.id;
const rvTypeName = (type) => { const p = paletteDefs.find((d) => d.type === type); return p ? p.name : type; };
const rvIcon = (type, size) => `<svg class="rk-ico" viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[type] || iconPaths.custom}</svg>`;
// "U12–U13", "U7": units as the rails print them, the way this rack is
// numbered (rackUnitsText, js/model.js). lo and hi are counted from the
// bottom, as every unit is stored and as every gesture here works.
const rvUnits = (rack, lo, hi) => rackUnitsText(rack, lo, hi);
const rvSpanText = (rack, lo, hi, face) => `${rvUnits(rack, lo, hi)} ${t(face === 'rear' ? 'rear' : 'front')}`;

// ---- Showing it ----
// Called by applyView (js/table.js) with whether the rack view is the view.
function showRackView(on) {
    const view = rackViewEl();
    if (!view) return;
    if (!on) endRackGesture();
    view.classList.toggle('hidden', !on);
    document.body.classList.toggle('rack-view', on);
    if (on) renderRackView(true);
}

// The Groups tab's Open rack, the collapsed rack's control, a test.
function openRackView(id) {
    const rack = groupById(id);
    if (!isRackGroup(rack) || isReduced()) return false;
    _rv.rackId = rack.id;
    // On a phone the rail is a drawer over the pane: shut, so the rack shows.
    const ws = document.querySelector('.topo-ws');
    if (ws && ws.classList.contains('drawer-open') && window.matchMedia('(max-width: 900px)').matches) {
        const toggle = document.querySelector('[data-ws-toggle]');
        if (toggle) toggle.click();
    }
    setView('rack');
    renderRackView(true);
    // The device selected on the map is shown where it sits in the rack.
    const sel = rackViewEl().querySelector('.rk-dev.rk-sel');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    return true;
}

// The switch's Rack button follows the document: shown while there is a
// rack. And the view follows the switch: the last rack deleted (or a network
// without one opened) puts the view back on the map or the table, and one
// that has racks again shows the rack view the visitor left on. -> true when
// it switched the view, which redraws it.
function syncRackSwitch() {
    const btn = document.querySelector('#viewSwitch [data-view="rack"]');
    if (btn) btn.hidden = !rackViewOffered();
    if ((effectiveView() === 'rack') !== rackShown()) { applyView(); return true; }
    return false;
}

// ---- Drawing ----
// diag: the document's diagnosis from the same synchronous render, when the
// caller has one (renderCanvasOnly), so the pass need not build it again.
function renderRackView(force, diag) {
    if (syncRackSwitch()) return;
    if (!rackShown()) { _rv.dirty = true; return; }
    if (_rv.drag && !force) { _rv.dirty = true; return; }
    _rv.dirty = false;
    const view = rackViewEl();
    const active = document.activeElement;
    const refocus = active && view.contains(active) && active !== rvEl('rackPicker') ? rvFocusKey(active) : null;

    const rack = currentRack();
    const picker = rvEl('rackPicker');
    const options = rackGroups().map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(groupPath(g))}</option>`).join('');
    if (picker.dataset.options !== options) { picker.innerHTML = options; picker.dataset.options = options; }
    picker.value = rack ? rack.id : '';
    document.querySelectorAll('#rackFaceSwitch [data-face]').forEach((b) => {
        const on = b.dataset.face === _rv.face;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    view.dataset.face = _rv.face;
    // The zoom: the units' height (--rk-z, css/app.css), and its switch.
    view.style.setProperty('--rk-z', String(_rv.zoom));
    document.querySelectorAll('#rackZoom [data-zoom]').forEach((b) => {
        const on = Number(b.dataset.zoom) === _rv.zoom;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    // The cable filter (a view kept in this browser): see "The cables, port
    // to port".
    document.querySelectorAll('#rackCables [data-cables]').forEach((b) => {
        const on = b.dataset.cables === _rv.cables;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    const body = rvEl('rackBody');
    renderRackSize(rack, force);
    if (!rack) { body.innerHTML = ''; rvEl('rackCount').textContent = ''; rvHidePortTip(); return; }

    const qm = typeof _queryLastMap !== 'undefined' ? _queryLastMap : null;
    // The members, the rings, the no-port spots and the markup are one lookup
    // pass (js/model.js): every box asks for its cables, its ports and the
    // diagnosis. The pass only builds strings and this view's own state
    // (_rv); everything that touches the page is after it, so a blur-commit
    // fired by the rebuild never writes under open indexes.
    const { members, unplaced, html } = withLookupPass(() => {
        const members = rackMembers(rack);
        const placed = members.filter((n) => Number.isInteger(n.rackU));
        // A VM or a container on a host is where its host is, drawn in its box:
        // not a device waiting for units.
        const unplaced = members.filter((n) => !Number.isInteger(n.rackU) && !hostOf(n));
        // A Cable to… left waiting on a device that has left the rack, or that is
        // no longer the one selected (the map or the table picked another), is
        // let go.
        if (_rv.cableFrom && (!placed.some((n) => n.id === _rv.cableFrom)
            || !(state.selectedType === 'node' && state.selectedId === _rv.cableFrom))) _rv.cableFrom = null;
        // The rings on the ports, from the findings as they are now, and the
        // cables that meet a box at its no-port spot: set before the markup,
        // which reads them.
        _rv.badLinks = rvBadLinks();
        _rv.noPort = rvNoPortLinks(rack);
        // Front, the cable manager, rear: the manager is between the faces, as the cables
        // are between the devices' fronts and backs.
        const html = `<div class="rk-main"><div class="rk-faces">${rackFaceHtml(rack, 'front', placed, qm)}${rackLaneHtml(rack)}${rackFaceHtml(rack, 'rear', placed, qm)}<div class="rk-wiring"></div></div></div>
        <aside class="rk-side">${rackSelBarHtml(rack)}${rackScheduleHtml(rack, qm)}${rackUnplacedHtml(rack, unplaced, qm)}${rackOthersHtml(rack, qm)}</aside>`;
        return { members, unplaced, html };
    }, diag);
    rvEl('rackCount').textContent = [rackSizeText(rack), devicesText(members.length),
        unplaced.length ? t('{n} not placed', { n: unplaced.length }) : ''].filter(Boolean).join(' · ');
    // Drawn as wide as the rack is against a 19" one (the faces' columns
    // and, on a phone, the frame read --rk-w; css/app.css).
    body.style.setProperty('--rk-w', String(Math.round(rackWidthInches(rack) / 19 * 1000) / 1000));
    body.dataset.width = asRackWidth(rack.width);
    view.classList.toggle('rk-arming', !!_rv.cableFrom);
    // The units scroll in a pane of their own, so the selected device's
    // buttons and the list beside them stay in sight however far down the
    // rack it is (on a phone, above and below the rack). A rebuild keeps
    // where that pane was scrolled to, unless it is another rack now.
    const was = body.querySelector('.rk-main');
    const scroll = was && body.dataset.rack === rack.id ? was.scrollTop : 0;
    // And the column beside it, and the schedule's own list, where they
    // scroll (beside the rack): a row tapped low in the list is still where
    // it was once the rebuild has lit it.
    const keepScroll = ['.rk-side', '.rk-sscroll'].map((sel) => { const x = body.querySelector(sel); return [sel, x && body.dataset.rack === rack.id ? x.scrollTop : 0]; });
    // Where each box was, so the rebuild can play the change (js/motion.js).
    // Not across a change of zoom: every box would play a slide and a stretch
    // to where the same units are now.
    const motion = body.dataset.zoom === String(_rv.zoom) ? rackMotionStart(body) : null;
    body.dataset.rack = rack.id;
    body.dataset.zoom = String(_rv.zoom);
    body.innerHTML = html;
    // The cables are drawn over the boxes once they are laid out.
    rvDrawCables();
    if (scroll) body.querySelector('.rk-main').scrollTop = scroll;
    keepScroll.forEach(([sel, top]) => { const x = top && body.querySelector(sel); if (x) x.scrollTop = top; });
    // A device just tapped or clicked keeps its box in sight: on a phone or
    // a narrow window its buttons come in above the rack and push the units
    // down, so the box could otherwise end up below the pane, and its lit
    // cables with it. Only for that tap (rvSelect), so a rebuild never pulls
    // back a pane the user has scrolled away, nor one a drag let go in.
    const reveal = _rv.reveal;
    _rv.reveal = '';
    // At 900px and narrower the column itself scrolls, the units stuck to
    // its top (css/app.css): scrolled down to the lists, the buttons that
    // come in above the units would be out of sight, so the column goes
    // back up to them. Only for a box tapped on the units: a row tapped in
    // a list, or a drag in, leaves the list where it was.
    const box = reveal ? [...body.querySelectorAll('.rk-dev[data-node="' + CSS.escape(reveal) + '"]')].find((b) => b.offsetParent) : null;
    const sel = box ? body.querySelector('.rk-selbar') : null;
    if (sel && body.scrollTop > 0) {
        const s = sel.getBoundingClientRect().top - body.getBoundingClientRect().top;
        if (s < 0) body.scrollTop += s;
    }
    if (box) {
        const main = body.querySelector('.rk-main');
        const b = box.getBoundingClientRect(), m = main.getBoundingClientRect();
        if (b.top < m.top || b.bottom > m.bottom) main.scrollTop += b.top - m.top - Math.max(0, (m.height - b.height) / 2);
    }
    // A cable a schedule row traced, brought into the elevation's sight; the
    // row of one selected on the elevation, into the list's.
    rvRevealSchedule(body);
    // In the schedule, without a scroll: its list is where it was kept above.
    if (refocus) { const again = view.querySelector(refocus); if (again) again.focus({ preventScroll: !!again.closest('.rk-sched') }); }
    rackMotionPlay(body, motion);
    // A tapped port's tip stays over the rebuilt port while its device is
    // selected, or a cable on it is (One cable traces it); a pointer's goes
    // with the box it was over.
    const tip = _rv.portTip;
    if (tip && tip.how === 'pin' && (inSelection('node', tip.node) || (tip.links || []).some((id) => inSelection('link', id)))) rvPinPortTip(tip.node, tip.port);
    else rvHidePortTip();
}

// A tap's tip, shown now and put right again once the boxes have played
// their move (js/motion.js): a box that grows as it is selected is measured
// mid-way otherwise, and the tip would point at where its port was.
function rvPinPortTip(nodeId, portId) {
    if (!rvShowPortTip(nodeId, portId, 'pin')) return false;
    if (typeof motionOn === 'function' && motionOn() && typeof MOTION_MS === 'number') {
        setTimeout(() => {
            const tip = _rv.portTip;
            if (tip && tip.how === 'pin' && tip.node === nodeId && tip.port === portId) rvShowPortTip(nodeId, portId, 'pin');
        }, MOTION_MS + 40);
    }
    return true;
}

// The head's Size button and, opened, the rack's size fields under it: the
// Groups tab's own (rackSizeFieldsHtml and onRackSizeField, js/groups.js),
// so a change made in either is the same one step and shows in both. Not
// rebuilt under the focus of one of its fields (a depth half typed is not
// taken away) unless forced, which every answer to a field is: a field left
// on Custom… or on a refused value then shows the rack as it is again, and
// the field that had the focus gets it back.
function renderRackSize(rack, force) {
    const btn = rvEl('rackSizeBtn'), box = rvEl('rackSize');
    if (!btn || !box) return;
    btn.hidden = !rack;
    const open = !!rack && _rv.sizeOpen;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('active', open);
    box.hidden = !open;
    if (!open) return;
    const html = rackSizeFieldsHtml(rack, 'rk');
    if (!force && box.dataset.html === html) return;
    const active = document.activeElement;
    if (!force && active && box.contains(active)) return;
    const key = active && box.contains(active) ? active.dataset.field : null;
    box.innerHTML = html;
    box.dataset.html = html;
    if (key) { const again = box.querySelector(`[data-field="${CSS.escape(key)}"]`); if (again) again.focus(); }
}

// A selector that finds the same control after a rebuild.
function rvFocusKey(el) {
    const node = el.dataset.node ? `[data-node="${CSS.escape(el.dataset.node)}"]` : '';
    if (el.classList.contains('rk-dev')) return `.rk-dev${el.classList.contains('rk-back') ? '.rk-back' : ':not(.rk-back)'}${node}`;
    if (el.classList.contains('rk-flag')) return `.rk-flag[data-key="${CSS.escape(el.dataset.key || '')}"][data-node="${CSS.escape(el.dataset.node || '')}"]`;
    if (el.dataset.rk) return `[data-rk="${CSS.escape(el.dataset.rk)}"]${node}`;
    if (el.hasAttribute('data-rk-filter')) return '[data-rk-filter]';
    if (el.dataset.rkSched) return `[data-rk-sched="${CSS.escape(el.dataset.rkSched)}"]`;
    if (el.dataset.rkSort) return `[data-rk-sort="${CSS.escape(el.dataset.rkSort)}"]`;
    if (el.dataset.zoom && el.closest('#rackZoom')) return `#rackZoom [data-zoom="${CSS.escape(el.dataset.zoom)}"]`;
    if (el.dataset.cables && el.closest('#rackCables')) return `#rackCables [data-cables="${CSS.escape(el.dataset.cables)}"]`;
    if (el.dataset.face && el.closest('#rackFaceSwitch')) return `#rackFaceSwitch [data-face="${CSS.escape(el.dataset.face)}"]`;
    return null;
}

// One face: the unit numbers, top to bottom, and the units themselves, with
// the free runs (for the keyboard) under the devices.
function rackFaceHtml(rack, face, placed, qm) {
    const top = rackTop(rack);
    const mine = placed.filter((n) => rackFaceOf(n) === face);
    // The backs of the full-depth devices mounted on the other face.
    const backs = placed.filter((n) => rackFaceOf(n) !== face && rackFullDepth(n));
    const taken = new Array(top + 2).fill(false);
    mine.concat(backs).forEach((n) => { const s = rackSpanOf(n); for (let u = Math.max(1, s.lo); u <= Math.min(top, s.hi); u++) taken[u] = true; });
    const runs = [];
    for (let u = 1; u <= top; u++) {
        if (taken[u]) continue;
        const lo = u;
        while (u + 1 <= top && !taken[u + 1]) u++;
        runs.push([lo, u]);
    }
    // Top to bottom, as printed on the rails: 42 down to 1, or 1 down to 42.
    const numbers = [];
    for (let u = top; u >= 1; u--) numbers.push(`<li>${rackUnitNo(rack, u)}</li>`);
    const free = runs.map(([lo, hi]) => ({ top: hi, html: `<button type="button" class="rk-free" data-face="${face}" data-lo="${lo}" data-hi="${hi}"
        style="--u:${lo};--h:${hi - lo + 1}" aria-label="${escapeHtml(t('{span} free. Place a device here.', { span: rvSpanText(rack, lo, hi, face) }))}"><span>${escapeHtml(t('+ Place a device'))}</span></button>` }));
    // A back in the same units as a device mounted on this face (an overlap
    // the findings name: a v7 file's front and rear pair became two
    // full-depth devices) would cover that device and take its taps, so the
    // wrong one would be selected and fixed. It shrinks to a hatched strip on
    // the outer rail, under nothing and taking no pointer, and the device
    // beside it keeps the rest of the width: both stay in sight, and a tap
    // on this face always selects the device mounted on it.
    const meets = (a, b) => { const sa = rackSpanOf(a), sb = rackSpanOf(b); return sa.lo <= sb.hi && sb.lo <= sa.hi; };
    const under = new Set(backs.filter((b) => mine.some((n) => meets(n, b))).map((b) => b.id));
    const beside = new Set(mine.filter((n) => backs.some((b) => under.has(b.id) && meets(n, b))).map((n) => n.id));
    // In the order the rack is read, top to bottom, so Tab walks down it.
    const boxes = free.concat(mine.map((n) => ({ top: rackSpanOf(n).hi, html: rackDevHtml(rack, n, qm, face, false, beside.has(n.id) ? 'beside' : '') })),
        backs.map((n) => ({ top: rackSpanOf(n).hi, html: rackDevHtml(rack, n, qm, face, true, under.has(n.id) ? 'under' : '') })))
        .sort((a, b) => b.top - a.top).map((x) => x.html).join('');
    return `<figure class="rk-face" data-face="${face}">
        <figcaption class="rk-cap">${escapeHtml(t(RV_FACE_NAMES[face]))}</figcaption>
        <div class="rk-frame">
            <ol class="rk-units" aria-hidden="true">${numbers.join('')}</ol>
            <div class="rk-slots" data-face="${face}" style="--rk-n:${top}">${boxes}</div>
        </div>
    </figure>`;
}

// back: the box is the back of a full-depth device mounted on the other
// face. It can be selected and cabled from, not moved: the device is moved
// by its front. layer: 'under', a back drawn as a strip because a device on
// this face is in its units; 'beside', that device, narrowed to clear it.
function rackDevHtml(rack, n, qm, face, back = false, layer = '') {
    const top = rackTop(rack);
    const s = rackSpanOf(n);
    // Drawn inside the rack whatever it says, so a slip is seen and fixed.
    const lo = Math.min(Math.max(s.lo, 1), top), hi = Math.max(Math.min(s.hi, top), lo);
    const outside = !rackSpanInside(rack, s.lo, s.hi);
    const clash = rackClash(rack, s.face, s.lo, s.hi, n.id);
    const full = rackFullDepth(n);
    const sel = inSelection('node', n.id);
    const status = n.status === 'planned' || n.status === 'retired' ? n.status : '';
    const armed = _rv.cableFrom === n.id;
    // What runs on it, drawn in its box on the face it is mounted on (its
    // back, on the other face, is its units only): see "VMs and containers
    // in their hosts" below.
    const guests = back ? [] : guestTreeOf(n);
    // Its ports, on the box on the face they are on (rackPortsFace): the
    // back's for a server mounted at the front. Not on a back drawn as a
    // strip under another device.
    // On a phone the selected device's rows are half as long (RV_PORTS_ROW_PHONE),
    // so a port is a fingertip wide rather than a sixth of one.
    const perRow = sel && rvPhone() ? RV_PORTS_ROW_PHONE : RV_PORTS_ROW;
    const ports = rackPortsFace(n) === face && layer !== 'under' ? rvPortsHtml(n, perRow, sel ? 0 : hi - lo + 1) : { html: '', rows: 0 };
    // Its cables with no port drawn here meet it at its no-port spot, on the
    // face its ports are on: see "The cables, port to port".
    const noPort = rackPortsFace(n) === face && layer !== 'under' ? ((_rv.noPort && _rv.noPort.get(n.id)) || []) : [];
    // The selected box grows past its units when they have no room for its
    // ports (css/app.css .rk-dev.rk-sel.rk-hasports). Grown, it steps in from
    // the outer rail (rk-grown), so the devices it is drawn over still show
    // their edge there, icon and all, and a tap on that edge selects them.
    const grown = sel && ports.rows > 0 && !rvPortsFit(hi - lo + 1, ports.rows);
    const cls = ['rk-dev', ports.rows ? 'rk-hasports' : '', ports.thin ? 'rk-pthin' : '', grown ? 'rk-grown' : '', back ? 'rk-back' : '', layer ? `rk-${layer}` : '', sel ? 'rk-sel' : '', outside || clash ? 'rk-bad' : '', status ? `rk-${status}` : '',
        armed ? 'rk-armed' : '', qm && !qm.nodes.has(n.id) && !guests.some((g) => qm.nodes.has(g.id)) ? 'q-dim' : '',
        guests.length ? 'rk-hosting' : '', guests.length && hi > lo ? 'rk-tall' : '', noPort.length ? 'rk-hasspot' : ''].filter(Boolean).join(' ');
    const title = [rvName(n), rvTypeName(n.type), rvSpanText(rack, s.lo, s.hi, s.face) + `, ${t(full ? 'full depth' : 'half depth')}`,
        back ? t('Full depth: this is its back. Its front is on the {face}.', { face: t(s.face) }) : '',
        status ? statusName(status) : '',
        outside ? t('{rack} has units 1 to {top}: this is outside it.', { rack: groupLabel(rack), top }) : '',
        clash ? t('It takes units {name} takes too.', { name: rvName(clash) }) : '',
        guests.length ? t('Runs here: {names}', { names: guests.map(rvName).join(', ') }) : '',
        ports.rows ? t('Point at or tap a port to read its cable.') : '',
        noPort.length === 1 ? t('A cable meets it at its no-port spot: tap the spot to pick its port.')
            : noPort.length ? t('{n} cables meet it at its no-port spot: tap the spot to pick their ports.', { n: noPort.length }) : '',
        ports.rows && !state.readOnly ? t('Drag from a free port to a free port on another device to cable them.') : '',
        state.readOnly || back ? '' : t('Arrows move it a unit, Shift+arrows change its height, left and right put it on the front or the rear.'),
        state.readOnly ? '' : t('Drag from its dot to another device to cable them.')]
        .filter(Boolean).join('\n');
    return `<button type="button" class="${cls}" data-node="${escapeHtml(n.id)}" style="--u:${lo};--h:${hi - lo + 1}${ports.rows ? `;--rk-pr:${ports.rows}` : ''}"
        aria-pressed="${sel}" title="${escapeHtml(title)}"${layer === 'under' ? ' tabindex="-1"' : ''}>
        ${rvIcon(n.type, 14)}<span class="rk-name">${escapeHtml(rvName(n))}</span>
        ${guests.length ? `<span class="rk-guests">${guests.map((g) => rvGuestChipHtml(g, n, qm)).join('')}<span class="rk-guest-more" hidden></span></span>` : ''}
        ${status ? `<span class="rk-status">${escapeHtml(statusName(status))}</span>` : ''}
        ${back ? `<span class="rk-status rk-backword">${escapeHtml(t('back'))}</span>` : ''}
        <span class="rk-span">${escapeHtml(rvUnits(rack, s.lo, s.hi))}</span>
        ${sel && ports.rows ? '<span class="rk-own" aria-hidden="true"></span>' : ''}
        ${sel && !back && !state.readOnly ? `<span class="rk-grip" aria-hidden="true" title="${escapeHtml(t('Drag to make it taller or shorter'))}"></span>` : ''}
        ${ports.html}
        ${noPort.length ? `<span class="rk-noport" data-face="${face}" title=""></span>` : ''}
        ${state.readOnly ? '' : `<span class="rk-plug" data-face="${face}" aria-hidden="true"></span>`}
    </button>`;
}

// ---- VMs and containers in their hosts (Review-Packs/Topo-groups.md, "Round 3", item 2) ----
// A VM or a container takes no units: it runs on a device (node.host,
// js/model.js "Hosts") and is where that device is. So the rack draws it in
// its host's box, as a chip with its type's icon and its name, a VM's
// containers after the VM (dashed). As many chips as the box has room for
// are shown, the rest counted "+N" (rvFitGuests, measured once the box is
// laid out, as the cables are: the units are CSS); the box's tooltip names
// them all. A chip is the device: a click or a tap selects it, as a box
// does, and the rail opens on it, with its own buttons (Select its host,
// Runs on nothing).
// Hosting and unhosting, by dragging, one undo step each (setNodeHost,
// js/hosts.js):
//   in    a VM or a container under Not placed yet or Other devices, dragged
//         onto a placed device, runs on it (the box lit in the info colour,
//         not the accent's a cable's or a move's target has); one from
//         elsewhere joins the rack with its host. Let go on empty units, it
//         is refused, with a hint to drop it on the device it runs on: units
//         are not its to take. Its row has no Place; its handle is the way.
//   out   a chip dragged off its box onto the one target that appears beside
//         the rack, Runs on nothing, runs on nothing from then on and waits
//         under Not placed yet; dragged onto another device that may host
//         it, it runs on that one. Let go anywhere else, it stays.
// A finger drags a chip itself (it is too small to scroll by, and has no
// other press to make). A cable to a guest is drawn to its host's box, from
// the face its host is on, labelled with the guest's name (rvDrawnAt), and
// a cable between a guest and its own host stays inside the box: there is
// nothing to draw between a box and itself.

function rvGuestChipHtml(g, box, qm) {
    const sel = inSelection('node', g.id);
    const cls = ['rk-guest', g.host !== box.id ? 'rk-guest-in' : '', sel ? 'rk-sel' : '', isRetired(g) ? 'rk-retired' : '',
        qm && !qm.nodes.has(g.id) ? 'q-dim' : ''].filter(Boolean).join(' ');
    const on = hostOf(g);
    const title = [rvName(g), rvTypeName(g.type), on ? t('Runs on {host}', { host: rvName(on) }) : '',
        isRetired(g) ? statusName('retired') : '', state.readOnly ? '' : t('Drag it off to run it on nothing, or onto another device.')].filter(Boolean).join('\n');
    return `<span class="${cls}" data-guest="${escapeHtml(g.id)}" title="${escapeHtml(title)}">${rvIcon(g.type, 11)}<span class="rk-gname">${escapeHtml(rvName(g))}</span></span>`;
}

// Hide the chips a box has no room for, and count them in its "+N": a chip
// fits when it is wholly inside the row (or rows, on a taller box) the box
// keeps for them. Run after every rebuild and whenever the faces change size.
function rvFitGuests() {
    const view = rackViewEl();
    if (!view) return;
    view.querySelectorAll('.rk-guests').forEach((box) => {
        const chips = [...box.querySelectorAll('.rk-guest')], more = box.querySelector('.rk-guest-more');
        chips.forEach((c) => { c.hidden = false; });
        more.hidden = true;
        box.style.width = box.style.flex = '';
        if (!box.clientWidth) return;   // a face a phone does not show
        // The row is sized by what is in it: with every chip in it asks for
        // all the room the box has, and on a 1U box (its items wrap, the
        // second line out of sight) that pushed the whole row off the first
        // line behind a long host name: a host with ten VMs showed nothing,
        // or a bare "+10". A crowded row asks for a short basis instead, as
        // the name does (css/app.css), and shares what is left with it.
        const dev = box.closest('.rk-dev');
        if (dev && !dev.classList.contains('rk-tall') && box.offsetTop + box.offsetHeight > dev.clientHeight + 0.5) box.style.flex = '1 1 5em';
        // Then it holds its width while chips are taken out (hidden, they
        // would narrow it until none fitted beside the count), and the first
        // chip, which may shrink, stays when it fits beside the count at its
        // shortest.
        box.style.width = `${box.clientWidth}px`;
        const fits = (el) => el.offsetLeft + el.offsetWidth <= box.clientWidth + 0.5 && el.offsetTop + el.offsetHeight <= box.clientHeight + 0.5;
        let shown = chips.length;
        while (shown > 0 && !fits(chips[shown - 1])) chips[--shown].hidden = true;
        if (shown === chips.length) return;
        more.hidden = false;
        more.textContent = `+${chips.length - shown}`;
        while (shown > 0 && !fits(more)) { chips[--shown].hidden = true; more.textContent = `+${chips.length - shown}`; }
    });
}

// ---- Ports on the boxes (Review-Packs/Topo-groups.md, "Round 5", R5a) ----
// Every placed device shows its ports as a strip along the foot of its box,
// on the face they are on (rackPortsFace, js/model.js: the side of the device
// its ports face says, its type's by default; a half-depth device has only
// its own face). Which ports and in what order is rackPortsOf: a switch's or
// an AP's faceplate, else its interfaces with a bond's members side by side
// under a bar for the bond. Evenly spaced in order, never at a faceplate
// position (the owner's call: there is no device-model library to know one),
// RV_PORTS_ROW to a row, so 48 ports are two rows and 96 four (the selected
// device's on a phone, RV_PORTS_ROW_PHONE, so a port is a fingertip wide).
//
// A port says what it is by how it is drawn, in the theme's colours only:
//   free     hollow;
//   cabled   filled, in the cable's colour when its colour is one the
//            browser knows (cable.color is free text), neutral otherwise;
//   finding  ringed in the error colour: a cable an open finding names (a
//            loop, two subnets on one cable, a label on two cables), two
//            cables on the one port, or a port past the faceplate's count;
//   VLAN     an access VLAN tints the port's cell.
// The ports are as big as the box has room for under its name. A 1U box at
// 1x has none (its name fills it), so its ports are a hairline along its foot
// (rvPortsFit, rk-pthin): their state seen, not read. The selected device's
// box grows over its neighbours until its ports are a size to read and tap
// (css/app.css, .rk-dev.rk-sel.rk-hasports), its own units tinted inside it
// and stepped in from the outer rail so what it covers keeps an edge to see
// and tap (rk-grown); the zoom (1x, 2x, 3x the unit height, a view kept in
// this browser) grows them all.
//
// Pointed at with a mouse, a port shows a tip: its name, its label, its VLAN,
// its bond, and each cable on it (the far device and port, the cable's tag,
// colour, length and via). A finger has no hover, so a tap on a port of the
// selected device (or of any device whose ports are a finger's size) shows
// the same tip and keeps it until a tap elsewhere, Escape, or the device is
// no longer selected. A tap on the tiny ports of a device not selected
// selects the device, as a tap on its box always has.
const RV_PORTS_ROW = 24;   // ports in a row before the strip wraps to another
const RV_PORTS_ROW_PHONE = 12; // the same for the selected device on a phone, which is narrow
const RV_PORT_TAP_PX = 10; // a port cell at least this wide is tapped as a port
const RV_PORT_MIN_PX = 3;  // the smallest port drawn as a box (css/app.css, --rk-ps)
const RV_U0_MIN = 22;      // a unit at 1x, at its smallest (css/app.css, --rk-u0)
const RV_ZOOMS = [1, 2, 3];
const RV_ZOOM_KEY = 'topo.rackZoom';
// The colours a cable's free-text colour may be drawn in: what CSS reads.
const rvOkColour = (c) => !!c && typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('color', c);

// The cables an open finding names, for the ports' rings: worked out once per
// rebuild (rvPortsHtml reads _rv.badLinks), from the diagnosis the map and the
// Findings tab already share.
function rvBadLinks() {
    const bad = new Set();
    currentDiagnosis().findings.forEach((f) => {
        if (isOpenFinding(f) && (f.level === 'bad' || f.level === 'warn')) (f.linkIds || []).forEach((id) => bad.add(id));
    });
    return bad;
}

// What a port's drawing says, from rackPortsOf's entry. -> { cabled, colour,
// problem: '' | 'past' | 'doubled' | 'finding' }. Doubled is the entry's own
// (isSocketPort): two cables on a router's gateway interface are shorthand
// for an undrawn switch, which the Findings tab lets be, so no ring either.
function rvPortState(p, bad) {
    const colour = p.links.map((l) => cableOf(l, 'color').trim()).find(rvOkColour) || '';
    const problem = p.past ? 'past' : p.doubled ? 'doubled' : p.links.some((l) => bad && bad.has(l.id)) ? 'finding' : '';
    return { cabled: p.links.length > 0, colour, problem };
}

// Whether a box of h units has room, under its name's line, for rows of
// ports at least RV_PORT_MIN_PX tall: the sum css/app.css does for --rk-ps
// (.rk-dev.rk-hasports), at the smallest unit, so a box judged roomy is
// roomy at every width. A 1U box at 1x never is: its name fills it.
function rvPortsFit(h, rows) {
    const H = h * _rv.zoom * RV_U0_MIN - 2;
    return (H - RV_U0_MIN - 2) / rows - 3 >= RV_PORT_MIN_PX;
}

// The strip, or '' for a device with no ports. units: the box's height in
// units when it is drawn that tall (0 for the selected box, which grows to
// fit its ports). A box with no room for them gets a hairline instead
// (rk-pthin): one row of 2px dashes along its foot, below its name, free
// faint and cabled in its colour, so their state is still seen without
// marks over the name's letters (they read as accents: "Ḅuilding").
// -> { html, rows, thin }
function rvPortsHtml(n, perRow = RV_PORTS_ROW, units = 0) {
    const ports = rackPortsOf(n);
    if (!ports.length) return { html: '', rows: 0, thin: false };
    const thin = units > 0 && !rvPortsFit(units, Math.ceil(ports.length / perRow));
    const rows = thin ? 1 : Math.ceil(ports.length / perRow);
    const cols = Math.ceil(ports.length / rows);
    const bad = _rv.badLinks;
    const same = (a, b) => !!a && !!b && !!a.bond && !!b.bond && a.bond.id === b.bond.id;
    const cells = ports.map((p, k) => {
        const st = rvPortState(p, bad);
        // A bond's bar runs under its members, broken where a row ends.
        const bond = p.bond ? ['rk-pb', !same(ports[k - 1], p) || k % cols === 0 ? 'rk-pb-s' : '', !same(p, ports[k + 1]) || (k + 1) % cols === 0 ? 'rk-pb-e' : ''] : [];
        const cls = ['rk-port', st.cabled ? 'rk-pcab' : '', st.problem ? 'rk-pbad' : '', p.vlan !== null ? 'rk-pvlan' : '', ...bond].filter(Boolean).join(' ');
        return `<span class="${cls}" data-port="${escapeHtml(p.id)}"${st.colour ? ` style="--pcol:${escapeHtml(st.colour)}"` : ''}></span>`;
    }).join('');
    // title="": the box's own tooltip is not shown over its ports, which
    // have a tip of their own (rvShowPortTip).
    return { html: `<span class="rk-ports${thin ? ' rk-pthin' : ''}" title="" style="--rk-pc:${cols}">${cells}</span>`, rows, thin };
}

// A port's tip: { head, lines } in words, for rvShowPortTip.
function rvPortInfo(node, portId) {
    const p = rackPortsOf(node).find((x) => x.id === portId);
    if (!p) return null;
    const st = rvPortState(p, _rv.badLinks || rvBadLinks());
    const head = `${rvName(node)} · ${p.name}${p.label ? ` · ${p.label}` : ''}`;
    const lines = [];
    if (p.vlan !== null) lines.push(`VLAN ${p.vlan}`);
    if (p.bond) lines.push(t('In {bond}', { bond: p.bond.name }));
    if (!p.links.length) lines.push(t('Free: no cable on it.'));
    p.links.forEach((l) => {
        const farId = l.source === node.id ? l.target : l.source;
        const far = getNode(farId);
        lines.push(`→ ${far ? rvName(far) : farId} · ${far ? ifaceLabel(far, ifaceIdOn(l, farId)) : '—'}`);
        const tag = cableOf(l, 'label').trim(), via = cableOf(l, 'via').trim();
        const facts = [tag ? t('Tag: {tag}', { tag }) : '', cableOf(l, 'color').trim(), cableOf(l, 'length').trim(), via ? t('via {via}', { via }) : ''].filter(Boolean);
        if (facts.length) lines.push(facts.join(' · '));
    });
    if (st.problem === 'past') lines.push(t('Past the {total}-port faceplate', { total: portCountOf(node) }));
    else if (st.problem === 'doubled') lines.push(t('{n} cables on this port: a port carries one.', { n: p.links.length }));
    else if (st.problem === 'finding') lines.push(t('A finding names this cable: see the Findings tab.'));
    return { head, lines, colour: st.colour, bad: !!st.problem, links: p.links.map((l) => l.id) };
}

// The tip, over the rack view, above the port (below it when there is no
// room above), kept inside the view's width. how: 'hover' (a mouse's, gone
// when the pointer leaves the port) or 'pin' (a tap's, kept). portId
// RV_NOPORT is the box's no-port spot, whose tip lists its cables, each with
// Pick a port: buttons, so that tip takes the pointer. -> true when shown.
function rvShowPortTip(nodeId, portId, how) {
    const view = rackViewEl();
    const node = getNode(nodeId);
    const spot = portId === RV_NOPORT;
    const el = node && view.querySelector(`.rk-dev[data-node="${CSS.escape(nodeId)}"] ${spot ? '.rk-noport' : `.rk-port[data-port="${CSS.escape(portId)}"]`}`);
    const info = el && el.offsetParent ? (spot ? rvNoPortInfo(node) : rvPortInfo(node, portId)) : null;
    if (!info) { rvHidePortTip(); return false; }
    _rv.portTip = { node: nodeId, port: portId, how, links: info.links || [] };
    let tip = view.querySelector('.rk-ptip');
    if (!tip) {
        tip = document.createElement('div');
        tip.className = 'rk-ptip';
        tip.setAttribute('role', 'status');
        view.appendChild(tip);
    }
    view.querySelectorAll('.rk-ptipped').forEach((x) => x.classList.remove('rk-ptipped'));
    el.classList.add('rk-ptipped');
    tip.classList.toggle('rk-ptip-bad', info.bad);
    // A line is words, or { text, pick }: a cable to Pick a port for.
    const pick = (x) => (x.pick && !state.readOnly ? `<button type="button" class="cs-btn rk-pick" data-rk-pick="${escapeHtml(x.pick)}">${escapeHtml(t('Pick a port'))}</button>` : '');
    tip.classList.toggle('rk-ptip-act', info.lines.some((x) => x.pick) && !state.readOnly);
    tip.innerHTML = `<strong>${info.colour ? `<i class="rk-swatch" style="background:${escapeHtml(info.colour)}"></i>` : ''}${escapeHtml(info.head)}</strong>`
        + info.lines.map((x) => (typeof x === 'string' ? `<span>${escapeHtml(x)}</span>` : `<span class="rk-ptrow"><span>${escapeHtml(x.text)}</span>${pick(x)}</span>`)).join('')
        + (info.note ? `<span class="rk-ptnote">${escapeHtml(info.note)}</span>` : '');
    tip.hidden = false;
    const vr = view.getBoundingClientRect(), pr = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.min(Math.max(8, pr.left + pr.width / 2 - vr.left - w / 2), Math.max(8, vr.width - w - 8));
    const above = pr.top - vr.top - h - 8;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(above >= 8 ? above : pr.bottom - vr.top + 8)}px`;
    return true;
}
function rvHidePortTip() {
    _rv.portTip = null;
    const view = rackViewEl();
    if (!view) return;
    const tip = view.querySelector('.rk-ptip');
    if (tip) tip.hidden = true;
    view.querySelectorAll('.rk-ptipped').forEach((x) => x.classList.remove('rk-ptipped'));
}

// The port a click or a tap meant: the one under it, or, on the strip between
// ports, the nearest. Null for a click with no position (the keyboard's).
function rvPortAt(e) {
    const strip = e.target && e.target.closest ? e.target.closest('.rk-ports') : null;
    if (!strip) return null;
    const own = e.target.closest('.rk-port');
    if (own) return own;
    if (!e.clientX && !e.clientY) return null;
    let best = null, d = Infinity;
    strip.querySelectorAll('.rk-port').forEach((p) => {
        const r = p.getBoundingClientRect();
        const dd = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY);
        if (dd < d) { d = dd; best = p; }
    });
    return best;
}

// The zoom: the unit's height 1x, 2x or 3x (--rk-z, css/app.css). A view,
// kept in this browser only, never in the document, a file or a link.
function rvLoadZoom() {
    let z = 1;
    try { z = Number(localStorage.getItem(RV_ZOOM_KEY)) || 1; } catch (e) { /* storage blocked: 1x */ }
    return RV_ZOOMS.includes(z) ? z : 1;
}
function setRackZoom(z) {
    if (!RV_ZOOMS.includes(z) || z === _rv.zoom) return false;
    // The unit in the middle of the pane stays in the middle.
    const pane = rackShown() ? rvPane() : null;
    const mid = pane && pane.scrollHeight ? (pane.scrollTop + pane.clientHeight / 2) / pane.scrollHeight : 0;
    _rv.zoom = z;
    try { localStorage.setItem(RV_ZOOM_KEY, String(z)); } catch (e) { /* storage blocked: this visit only */ }
    renderRackView(true);
    const again = rackShown() ? rvPane() : null;
    if (again && mid) again.scrollTop = Math.max(0, mid * again.scrollHeight - again.clientHeight / 2);
    return true;
}

// The box a device's cables meet in this rack: its own while it is placed
// here, or, for a VM or a container, its outermost host's while that one is
// placed here. Null when it has no box here (a device placed in another rack
// has units too: they are not this rack's).
function rvDrawnAt(n, rack) {
    if (!n || !rack) return null;
    if (n.group === rack.id && Number.isInteger(n.rackU)) return n;
    const h = hostRootOf(n);
    return h && h !== n && h.group === rack.id && Number.isInteger(h.rackU) ? h : null;
}
// "VM-web on HV-1": a cable's end named for its label, the guest by its host.
const rvEndName = (n, drawn) => (n === drawn ? rvName(n) : t('{guest} on {host}', { guest: rvName(n), host: rvName(drawn) }));

// The device whose box is under a pointer that `node` may run on, or null:
// never itself or one of its own guests.
function rvHostUnder(node, x, y) {
    const hit = document.elementFromPoint(x, y);
    const box = hit && hit.closest ? hit.closest('#rackView .rk-dev') : null;
    const host = box ? getNode(box.dataset.node) : null;
    if (!host || host === node || !canHost(node.type, host) || hostChainOf(host).includes(node)) return null;
    return host;
}
// The box lit as the host a guest would run on (both its faces), or none.
function rvMarkHostTarget(id) {
    const view = rackViewEl();
    if (!view) return;
    view.querySelectorAll('.rk-host-target').forEach((el) => { if (el.dataset.node !== id) el.classList.remove('rk-host-target'); });
    if (id) view.querySelectorAll(`.rk-dev[data-node="${CSS.escape(id)}"]`).forEach((el) => el.classList.add('rk-host-target'));
}

// Run `node` on `host` (null: on nothing), one undo step, and say so. Run on
// nothing, it stays in the group it was in with its host: in this rack,
// under Not placed yet. -> true when written.
function rvSetHost(node, host) {
    if (!setNodeHost(node, host ? host.id : '')) { renderRackView(true); return false; }
    const g = groupOfNode(node);
    showToast(host ? t('{name} runs on {host} now.', { name: rvName(node), host: rvName(host) })
        : isRackGroup(g) ? t('{name} runs on nothing now. It stays in {group}, under Not placed yet.', { name: rvName(node), group: groupLabel(g) })
            : t('{name} runs on nothing now.', { name: rvName(node) }), 'ok');
    if (typeof renderHostPicker === 'function') renderHostPicker(selectedGroupNode());
    rvAfterEdit();
    if (typeof renderGroupsPanel === 'function') renderGroupsPanel();
    return true;
}

// The selected guest's bar, in place of a placed device's: where it runs,
// and the taps for what a drag does (Select its host; Runs on nothing).
function rackGuestBarHtml(one) {
    const on = hostOf(one), root = hostRootOf(one) || on;
    const span = rackSpanText(one);
    const dis = state.readOnly ? ' disabled' : '';
    const id = escapeHtml(one.id);
    return `<section class="rk-selbar" aria-label="${escapeHtml(rvName(one))}">
        <div class="rk-selname">${rvIcon(one.type, 16)}<span class="rk-name">${escapeHtml(rvName(one))}</span></div>
        <p class="rail-note rk-guestnote">${escapeHtml([t('Runs on {host}', { host: rvName(on) }), span].filter(Boolean).join(' · '))}</p>
        <div class="rk-selacts">
            <button type="button" class="cs-btn" data-rk="select" data-node="${escapeHtml(root.id)}">${escapeHtml(t('Select its host'))}</button>
            <button type="button" class="cs-btn rk-quiet" data-rk="unhost" data-node="${id}"
                title="${escapeHtml(t('It stops running on {host} and waits under Not placed yet.', { host: rvName(on) }))}"${dis}>${escapeHtml(t('Runs on nothing'))}</button>
        </div>
    </section>`;
}

// ---- The cables, port to port (Review-Packs/Topo-groups.md, "Round 5", R5a) ----
// Each cable is drawn the way it runs in a rack: out of its port (on the
// strip at the foot of the box, on the face the device's ports are on), down
// to the box's lower edge, along it to the cable manager at the side of that
// face, up or down the manager, and along the other device's lower edge into
// its port. This replaced one line per device pair (the first build's agreed
// scope) on the owner's call: a line per pair said which devices were cabled,
// not which ports, and the person at the rack patches ports.
//
// The manager is the column between the faces, split down the middle: the
// front's channel on the front's side, the rear's on the rear's (the rear is
// drawn as the front's mirror, so both faces' devices meet the column on
// their inner edge). On a phone, which shows one face, the whole column is
// that face's channel. In a channel each cable has a track, a few pixels
// from the next, the shorter runs nearer the face, so no run crosses
// another's ends (a greedy pass, shortest first; past the tracks there is
// room for, they share the outermost, as cables share a manager's finger).
// A cable from a port on the front to one on the rear runs in the front's
// channel and across the middle to the rear: around the side of the rack.
//
// Ends that are not a port drawn on a face on show:
//   outside   a cable to a device not placed in this rack (elsewhere, in
//             another rack, or here with no units yet) runs from its port
//             to the manager and on its own track up or down to the rack's
//             top or bottom edge, the nearer, where it ends in an open ring;
//             its tag says where it goes: "→ PC-12 · eth0";
//   away      on a phone, a port on the face not shown: round the side, into
//             the channel and on its own track to the far box's level, a
//             ring there, "→ MGMT · 22 · rear";
//   no port   an end that names no port the box draws (none was picked yet,
//             or a sheet named one the device does not have) meets the box at
//             its "no port" spot, a dashed ring at the inner end of the
//             strip. A tap on it lists those cables, each with Pick a port:
//             the existing port picker in the rail, where a pick is one undo
//             step, as every pick there is. The selected device's bar has
//             the same button while it has such a cable;
//   guest     a VM's or a container's cable meets its chip in its host's box
//             (the box's spot when the chip is counted in "+N"), its tag
//             naming the guest. A cable between a guest and its own host is
//             not drawn (rackCableLinks): it never leaves the box.
//
// What shows is the filter in the head, All | Selected | One cable, a view
// kept in this browser (RV_CABLES_KEY), never in the document or a link:
//   All        every cable, thin; their tags from 2x, where there is room;
//   Selected   the default: the selected devices' cables (and cables
//              selected) bold and tagged, the rest faint;
//   One cable  a tap on a port, a line or a tag selects that one cable and
//              traces it end to end, bold and tagged; the rest faint.
// Faint lines can still be pointed at and tapped. Pointed at with a mouse or
// focused (a line, a tag or a device), a cable's or a device's lines come up
// bold and tagged for as long as the pointer stays; a finger has no hover,
// and its tap selects, which the filter shows.
//
// Tags: a small flag hung under each end of a cable on show, with the cable's
// label, else its ports ("eth0 ↔ 24"), else for a cable out of the rack where
// it goes. Flags never cover one another: each takes the free place nearest
// under its port (rvPlaceFlags: rows under it, then over its box, each tried
// a step to either side), hung from the port by a leader; one with
// no free place near enough is left off, and its port's tip still says it
// all. A tap on a flag or a line selects its cable (the rail shows it) and
// shows the tip of the port at that end: the tag, both ends, VLAN, length,
// colour and via.
//
// A cable is drawn as well as read here, port to port: drag from a free port
// to a free port of another device (a mouse anywhere; a finger on the
// selected device's ports, which are a finger's size), and the cable is made
// bound to those two ports, one undo step, and selected. Let go on another
// device's box rather than a port, the far port is the one bindLink picks,
// and the rail opens on the port picker, as dragging from a device's dot has
// always done.
const RV_CABLES = ['all', 'sel', 'one'];
const RV_CABLES_KEY = 'topo.rackCables';
const RV_TRACK_PX = 4;     // between two tracks in a channel, at the least
const RV_TRACK_MAX = 18;   // and at the most, while there is room
const RV_DROP_PX = 7;      // between two cables' runs out under one box
const RV_FLAG_H = 15;      // a flag's height (css/app.css .rk-flag)
const RV_FLAG_GAP = 2;     // between two flags
const RV_FLAG_MAX = 132;   // a flag's widest; its words are cut past it
const RV_FLAG_REACH = 5;   // rows tried under a port (and over its box) before a flag is left off
const RV_NOPORT = '#noport'; // the tip's "port" for a box's no-port spot
const RV_SNAP_PX = 14;     // a port within this of the pointer, on the box under it, is the one a drag lands on

// The filter: kept in this browser only, as the zoom is.
function rvLoadCables() {
    let m = 'sel';
    try { m = localStorage.getItem(RV_CABLES_KEY) || 'sel'; } catch (e) { /* storage blocked: the default */ }
    return RV_CABLES.includes(m) ? m : 'sel';
}
function setRackCables(mode) {
    if (!RV_CABLES.includes(mode) || mode === _rv.cables) return false;
    rvKeepCables(mode);
    renderRackView(true);
    return true;
}
// The filter set and kept, with no redraw.
function rvKeepCables(mode) {
    _rv.cables = mode;
    try { localStorage.setItem(RV_CABLES_KEY, mode); } catch (e) { /* storage blocked: this visit only */ }
}

// The cables of each placed device here whose end names no port its box
// draws, by device: the "no port" spots. Worked out once per rebuild.
// -> Map(node id -> [link])
function rvNoPortLinks(rack) {
    const out = new Map();
    const drawn = new Map();
    rackCableLinks(rack).forEach((l) => [l.source, l.target].forEach((id) => {
        const n = getNode(id);
        if (!n || rvDrawnAt(n, rack) !== n) return;
        if (!drawn.has(id)) drawn.set(id, new Set(rackPortsOf(n).map((p) => p.id)));
        const pid = ifaceIdOn(l, id);
        if (pid && drawn.get(id).has(pid)) return;
        if (!out.has(id)) out.set(id, []);
        out.get(id).push(l);
    }));
    return out;
}

// The spot's tip: the cables that meet the box there, each with Pick a port.
function rvNoPortInfo(node) {
    const links = (_rv.noPort && _rv.noPort.get(node.id)) || [];
    if (!links.length) return null;
    const lines = links.slice(0, 8).map((l) => {
        const farId = l.source === node.id ? l.target : l.source, far = getNode(farId);
        const tag = cableOf(l, 'label').trim();
        return { text: [`→ ${far ? rvName(far) : farId} · ${far ? rvPortName(l, far) : '—'}`, tag ? t('Tag: {tag}', { tag }) : ''].filter(Boolean).join(' · '), pick: l.id };
    });
    if (links.length > 8) lines.push({ text: t('…and {n} more.', { n: links.length - 8 }) });
    return { head: `${rvName(node)} · ${t('no port')}`, lines, colour: '', bad: false, links: links.map((l) => l.id),
        note: state.readOnly ? '' : t('Pick the port each one is plugged into.') };
}

// A cable's port at one end, as the rack names it: the port picker's name,
// or "no port" when none was picked.
const rvPortName = (link, node) => { const pid = ifaceIdOn(link, node.id); return pid ? ifaceLabel(node, pid) : t('no port'); };

// One end of a cable, before anything is measured: the device it is on, the
// box it is drawn at (its own, its host's for a guest, none outside), the
// face, and what it meets there: its port, the box's spot, or a guest's chip.
// at: drawn on a face on show. ports: a cache of each box's drawn port ids.
function rvEndOf(link, node, rack, shown, ports) {
    const box = rvDrawnAt(node, rack);
    if (!box) return { node, box: null, kind: 'out', face: null, port: null, at: false };
    if (box !== node) { const face = rackFaceOf(box); return { node, box, kind: 'guest', face, port: null, at: shown.includes(face) }; }
    const face = rackPortsFace(node);
    if (!ports.has(node.id)) ports.set(node.id, new Set(rackPortsOf(node).map((p) => p.id)));
    const pid = ifaceIdOn(link, node.id);
    const kind = pid && ports.get(node.id).has(pid) ? 'port' : 'spot';
    return { node, box, kind, face, port: kind === 'port' ? pid : null, at: shown.includes(face) };
}

// What the rack's cables are, before any is placed: one item per cable with
// an end on a face on show, its two ends, its tags' words, its colour, and
// how the filter shows it. Pure but for the selection, the search and the
// view state it reads.
function rvCableItems(rack, shown, qm) {
    const items = [];
    const ports = new Map();
    const mode = _rv.cables;
    rackCableLinks(rack).forEach((l, i) => {
        const a = rvEndOf(l, getNode(l.source), rack, shown, ports), b = rvEndOf(l, getNode(l.target), rack, shown, ports);
        if (!a.at && !b.at) return;
        // Both ends in the one box (two guests of one host): nothing to draw.
        if (a.box && a.box === b.box) return;
        const label = cableOf(l, 'label').trim();
        // A tag's words, at end e with o the other end.
        const words = (e, o) => {
            const guest = e.kind === 'guest' ? `${rvName(e.node)}: ` : '';
            if (o.at) return guest + (label || `${rvPortName(l, e.node)} ↔ ${rvPortName(l, o.node)}`);
            const away = o.box ? ` · ${t(o.face)}` : '';
            return `${guest}→ ${rvName(o.node)} · ${rvPortName(l, o.node)}${away}${label ? ` · ${label}` : ''}`;
        };
        const ends = [a, b].map((e, k) => (e.at ? Object.assign(e, { words: words(e, k ? a : b) }) : e));
        const colour = cableOf(l, 'color').trim();
        const ids = [...new Set([a.node, a.box, b.node, b.box].filter(Boolean).map((n) => n.id))];
        const linkSel = inSelection('link', l.id);
        const sel = linkSel || (mode !== 'one' && ids.some((id) => inSelection('node', id)));
        items.push({ i, key: l.id, link: l, ends, ids, linkSel, sel,
            colour: rvOkColour(colour) ? colour : '',
            tagged: sel || (mode === 'all' && _rv.zoom >= 2),
            faint: mode !== 'all' && !sel,
            dim: !!qm && !qm.links.has(l.id),
            title: [`${rvEndName(a.node, a.box || a.node)} · ${rvPortName(l, a.node)} ↔ ${rvEndName(b.node, b.box || b.node)} · ${rvPortName(l, b.node)}`,
                rvCableLine(l, a.node)].join('\n') });
    });
    return items;
}

// The manager's column, under the lines: a trough with a finger every unit,
// lined up unit for unit with the faces (the same caption above it, the same
// frame padding). The lines and tags are drawn over all three columns, in
// .rk-wiring, by rvDrawCables once the boxes are where they will be.
function rackLaneHtml(rack) {
    const top = rackTop(rack);
    const any = rackCableLinks(rack).some((l) => [l.source, l.target].some((id) => !!rvDrawnAt(getNode(id), rack)));
    const empty = any ? '' : `<p>${escapeHtml(t('No cables between the devices placed here yet.'))}</p>`;
    return `<figure class="rk-lane" aria-label="${escapeHtml(t('Cables'))}"><figcaption class="rk-cap">${escapeHtml(t('Cables'))}</figcaption>
        <div class="rk-lane-box"><div class="rk-lane-in${any ? '' : ' rk-lane-empty'}" style="--rk-n:${top}">${empty}</div></div></figure>`;
}

// A route through the given corners with each corner rounded, as a cable
// bends: the radius shrinks where a leg is short, so a run between two
// neighbouring units is still a smooth S, not a knot.
function rvRoundPath(pts, radius = 6) {
    const r2 = (v) => Math.round(v * 10) / 10;
    let d = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`;
    for (let k = 1; k < pts.length - 1; k++) {
        const [px, py] = pts[k - 1], [x, y] = pts[k], [nx, ny] = pts[k + 1];
        const lin = Math.hypot(x - px, y - py), lout = Math.hypot(nx - x, ny - y);
        const r = Math.min(radius, lin / 2, lout / 2);
        if (r < 0.5) { d += ` L ${r2(x)} ${r2(y)}`; continue; }
        const ax = x - (x - px) / lin * r, ay = y - (y - py) / lin * r;
        const bx = x + (nx - x) / lout * r, by = y + (ny - y) / lout * r;
        d += ` L ${r2(ax)} ${r2(ay)} Q ${r2(x)} ${r2(y)} ${r2(bx)} ${r2(by)}`;
    }
    const [lx, ly] = pts[pts.length - 1];
    return d + ` L ${r2(lx)} ${r2(ly)}`;
}

// Lines and tags over the faces, from where the boxes and their ports are
// now. Called after every rebuild, and when the faces change size without one.
function rvDrawCables() {
    // The hosts' chips are fitted to their boxes first, from the same layout.
    rvFitGuests();
    const view = rackViewEl();
    const faces = view && view.querySelector('.rk-faces');
    const layer = faces && faces.querySelector('.rk-wiring');
    const rack = currentRack();
    const laneEl = faces && faces.querySelector('.rk-lane-in');
    if (!layer || !rack || !laneEl) return;
    const fr = faces.getBoundingClientRect();
    _rv.drawnAt = `${Math.round(fr.width)}x${Math.round(fr.height)}`;
    const shown = RV_FACES.filter((f) => { const s = rvSlotsOf(f); return s && s.offsetParent; });
    _rv.wired = null;
    if (!fr.width || !shown.length) { layer.innerHTML = ''; return; }
    const qm = typeof _queryLastMap !== 'undefined' ? _queryLastMap : null;
    // The items in a lookup pass of their own (each asks for its two devices
    // and their ports); the measuring below is outside it.
    const items = withLookupPass(() => rvCableItems(rack, shown, qm));
    if (!items.length) { layer.innerHTML = ''; return; }

    const lr = laneEl.getBoundingClientRect();
    const L = lr.left - fr.left, R = lr.right - fr.left, M = (L + R) / 2;
    // Each face's channel: its inner edge (beside the face) and its far one.
    const both = shown.length === 2;
    const chan = {
        front: { inner: L, outer: both ? M : R },
        rear: { inner: R, outer: both ? M : L }
    };
    const dir = (face) => Math.sign(chan[face].outer - chan[face].inner) || 1;
    const slotsRect = {};
    shown.forEach((f) => { const r = rvSlotsOf(f).getBoundingClientRect(); slotsRect[f] = { l: r.left - fr.left, r: r.right - fr.left }; });
    // What a flag must not cover, a face at a time (rvPlaceFlags): each box's
    // name line (its top to the foot of its name, the box's width), its port
    // strip, its guests' chips and its no-port spot. The rest of a box (the
    // plain middle of a tall one) and the empty units may take a flag.
    const keep = {};
    shown.forEach((f) => {
        const list = keep[f] = [];
        const add = (r, top) => { if (r.width || r.height) list.push({ l: r.left - fr.left, r: r.right - fr.left, t: (top ?? r.top) - fr.top, b: r.bottom - fr.top }); };
        rvSlotsOf(f).querySelectorAll('.rk-dev').forEach((b) => {
            const br = b.getBoundingClientRect(), name = b.querySelector('.rk-name');
            if (name) { const nr = name.getBoundingClientRect(); add({ left: br.left, right: br.right, width: br.width, height: nr.height, bottom: nr.bottom + 1 }, br.top); }
            b.querySelectorAll(':scope > .rk-ports, :scope > .rk-guests, :scope > .rk-noport').forEach((x) => add(x.getBoundingClientRect()));
        });
    });
    // Where an end is: the middle of its port (or spot, or chip), and the
    // edge under its box the cable runs along. Measured once per box.
    const boxes = new Map();
    const boxOf = (id, face) => {
        const k = `${id}\u0000${face}`;
        if (!boxes.has(k)) {
            const el = rvSlotsOf(face).querySelector(`.rk-dev[data-node="${CSS.escape(id)}"]`);
            boxes.set(k, el ? { el, r: el.getBoundingClientRect() } : null);
        }
        return boxes.get(k);
    };
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.width || r.height ? [r.left + r.width / 2 - fr.left, r.top + r.height / 2 - fr.top] : null; };
    const place = (e) => {
        const b = boxOf(e.box.id, e.face);
        if (!b) { e.at = false; return; }
        let el = null;
        if (e.kind === 'port') el = b.el.querySelector(`.rk-port[data-port="${CSS.escape(e.port)}"]`);
        else if (e.kind === 'guest') { const c = b.el.querySelector(`.rk-guest[data-guest="${CSS.escape(e.node.id)}"]`); el = c && !c.hidden ? c : null; }
        if (!el) el = b.el.querySelector('.rk-noport');
        const at = el && mid(el);
        // No mark to meet (a chip counted in "+N" on a box with no spot):
        // the box's inner corner, where the spot would be.
        const inner = e.face === 'front' ? b.r.right - 26 : b.r.left + 26;
        [e.x, e.y] = at || [inner - fr.left, b.r.bottom - 5 - fr.top];
        e.gy = b.r.bottom + 1 - fr.top;
        e.top = b.r.top - fr.top;
    };
    items.forEach((it) => it.ends.forEach((e) => { if (e.at) place(e); }));
    const drawn = items.filter((it) => it.ends.some((e) => e.at));
    // Each cable leaving a box runs out under it at a level of its own, a
    // little below the box and RV_DROP_PX under the last: on one line along
    // the box's edge, a box's cables read as one. The port nearest the
    // manager runs highest, so no drop crosses another's run.
    const unitPx = rvSlotsOf(shown[0]).getBoundingClientRect().height / rackTop(rack) || 22;
    const leaving = new Map();
    drawn.forEach((it) => it.ends.forEach((e) => {
        if (!e.at) return;
        const k = `${e.box.id}\u0000${e.face}`;
        if (!leaving.has(k)) leaving.set(k, []);
        leaving.get(k).push(e);
    }));
    leaving.forEach((ends) => {
        ends.sort((p, q) => (p.face === 'front' ? q.x - p.x : p.x - q.x));
        const step = ends.length > 1 ? Math.min(RV_DROP_PX, (unitPx - 6) / (ends.length - 1)) : 0;
        ends.forEach((e, j) => { e.gy += 3 + j * Math.max(3, step); });
    });

    // Tracks, a channel at a time: as many as fit, the shortest runs nearest
    // the face. A front-to-rear cable takes one in the front's channel.
    // Every cable drawn takes one, those with an end not drawn too: one out
    // of the rack runs in its face's channel to the rack's top or bottom edge,
    // whichever is nearer (the way a cable leaves a rack, up to the tray or
    // down through the floor), and one to the face a phone does not show runs
    // in it to the far box's level. Each had ended at the edge of its own
    // box, along that box's lower edge, so the cables from one box to four
    // switches elsewhere drew as one line to one ring, and a click on it
    // could only ever take the last of them: in a track of its own each is a
    // line of its own, to a ring of its own.
    const used = { front: [], rear: [] };
    const laneTop = lr.top - fr.top, laneBot = lr.bottom - fr.top;
    // The far box's level for an end on the face not on show, from its
    // units: the units are as tall on every face (a grown box is drawn over
    // its neighbours, it does not push them), and the slots of the face on
    // show are those units.
    const sr = rvSlotsOf(shown[0]).getBoundingClientRect();
    const top = rackTop(rack), uh = sr.height / top || 22;
    const levelOf = (box) => sr.bottom - fr.top - (Math.min(Math.max(rackSpanOf(box).lo, 1), top) - 1) * uh;
    drawn.forEach((it) => {
        const [a, b] = it.ends;
        if (a.at && b.at) {
            it.chan = a.face === b.face ? a.face : 'front';
            it.lo = Math.min(a.gy, b.gy); it.hi = Math.max(a.gy, b.gy);
            return;
        }
        const e = a.at ? a : b, o = a.at ? b : a;
        it.chan = e.face;
        if (o.box) it.far = levelOf(o.box);
        else it.far = e.gy - laneTop <= laneBot - e.gy ? laneTop : laneBot;
        it.lo = Math.min(e.gy, it.far); it.hi = Math.max(e.gy, it.far);
    });
    // While a channel has a track for each of its cables, each takes its own
    // (two runs one above the other in one track read as one cable); past
    // that they share. Then the tracks spread over the channel's width, up to
    // RV_TRACK_MAX apart, so a few cables are a few clear lines, not a bundle
    // against the face.
    const per = { front: 0, rear: 0 };
    drawn.forEach((it) => { per[it.chan]++; });
    // Two faces share the manager by how many cables each runs in it (a
    // quarter at the least for one that has any), not half and half: a rack
    // cabled on its front only had them in half the room, the rest empty.
    if (both && per.front + per.rear) {
        const share = !per.rear ? 1 : !per.front ? 0 : Math.min(0.75, Math.max(0.25, per.front / (per.front + per.rear)));
        chan.front.outer = chan.rear.outer = L + (R - L) * share;
    }
    const room = (c) => Math.abs(c.outer - c.inner) - 10;
    drawn.slice().sort((x, y) => (x.hi - x.lo) - (y.hi - y.lo) || x.i - y.i).forEach((it) => {
        const K = Math.max(1, Math.floor((room(chan[it.chan]) + 2) / RV_TRACK_PX));
        const list = used[it.chan];
        let k = 0;
        if (per[it.chan] <= K) k = list.length;
        else while (k < K - 1 && (list[k] || []).some(([a, b]) => a <= it.hi + 4 && it.lo <= b + 4)) k++;
        (list[k] = list[k] || []).push([it.lo, it.hi]);
        it.k = k;
    });
    drawn.forEach((it) => {
        const c = chan[it.chan], n = used[it.chan].length;
        const step = n > 1 ? Math.min(RV_TRACK_MAX, Math.max(RV_TRACK_PX, room(c) / (n - 1))) : 0;
        it.x = c.inner + dir(it.chan) * (5 + it.k * step);
    });

    const r1 = (v) => Math.round(v * 10) / 10;
    const svg = [], flags = [];
    drawn.forEach((it) => {
        let pts, hit, ring = null;
        const [a, b] = it.ends;
        // Where a face's boxes meet the manager: the edge a run leaves them by.
        const edge = (face) => (face === 'front' ? slotsRect.front.r : slotsRect.rear.l);
        if (a.at && b.at) {
            // From the front's end when it crosses, so the run is in its channel.
            const [p, q] = a.face === b.face || a.face === 'front' ? [a, b] : [b, a];
            pts = [[p.x, p.y], [p.x, p.gy], [it.x, p.gy], [it.x, q.gy], [q.x, q.gy], [q.x, q.y]];
            hit = [[edge(p.face), p.gy], [it.x, p.gy], [it.x, q.gy], [edge(q.face), q.gy]];
        } else if (!(a.at ? b : a).box) {
            // Out of the rack: to the manager, up or down its track to the
            // rack's top or bottom edge, an open ring there. The rings of
            // neighbouring tracks (4px apart, a ring is wider) sit one on the
            // edge and the next just inside it, so no two touch. (It had
            // ended mid-manager at its box's level, which is no edge, and
            // then on the face's outer rail along its box's lower edge, one
            // line and one ring for all of a box's.) Its hit stroke is its
            // run in the manager and on over the ring: a stroke ends square
            // at its last point, so ended at the ring's middle it left half
            // the ring to nothing, or to the next track's stroke.
            const e = a.at ? a : b;
            const up = it.far === laneTop;
            const ry = up ? (it.k % 2 ? laneTop + 5 : laneTop - 3) : (it.k % 2 ? laneBot - 5 : laneBot + 3);
            ring = [it.x, ry];
            pts = [[e.x, e.y], [e.x, e.gy], [it.x, e.gy], ring];
            hit = [[edge(e.face), e.gy], [it.x, e.gy], [it.x, ry + (up ? -5 : 5)]];
        } else {
            // To the face a phone does not show: around the side, into the
            // manager and along its track to the far box's level, an open
            // ring there; its tag says the face.
            const e = a.at ? a : b;
            ring = [it.x, it.far];
            pts = [[e.x, e.y], [e.x, e.gy], [it.x, e.gy], ring];
            hit = [[edge(e.face), e.gy], [it.x, e.gy], [it.x, it.far + (it.far < e.gy ? -5 : 5)]];
        }
        // The hit stroke is the run in the manager only: over the boxes it
        // would take the taps meant for their ports and their lower edge.
        const d = rvRoundPath(pts, 4);
        const dHit = rvRoundPath(hit, 4);
        const cls = ['rk-cable', it.sel ? 'rk-wsel' : '', it.faint ? 'rk-faint' : '', it.dim ? 'q-dim' : '', ring ? 'rk-out' : ''].filter(Boolean).join(' ');
        const style = it.colour ? ` style="stroke:${escapeHtml(it.colour)}"` : '';
        const key = escapeHtml(it.key);
        const first = it.ends.find((e) => e.at && e.kind === 'port');
        const tipAt = first ? ` data-node="${escapeHtml(first.node.id)}" data-port="${escapeHtml(first.port)}"` : '';
        const ringSvg = ring ? `<circle class="rk-ring" cx="${r1(ring[0])}" cy="${r1(ring[1])}" r="3"${style}/>` : '';
        const spots = it.ends.filter((e) => e.at && e.kind !== 'port').map((e) => `<circle class="rk-end" cx="${r1(e.x)}" cy="${r1(e.y)}" r="2.5"${it.colour ? ` style="fill:${escapeHtml(it.colour)}"` : ''}/>`).join('');
        svg.push(`<g class="${cls}" data-key="${key}" data-ends="${escapeHtml(it.ids.join(' '))}">
            <path class="rk-wire" d="${d}"${style}/>${ringSvg}${spots}${it.ends.filter((e) => e.at).map(() => '<path class="rk-lead" d=""/>').join('')}
            <path class="rk-hit" d="${dHit}" data-key="${key}" data-links="${key}"${tipAt}><title>${escapeHtml(it.title)}</title></path></g>`);
        it.ends.forEach((e) => {
            if (!e.at) return;
            // A flag's width, a guess from its words (mono, about 6.2px a
            // letter, and its padding and colour edge).
            const w = Math.min(RV_FLAG_MAX, Math.round(e.words.length * 6.2 + 14));
            const fl = { it, e, w, face: e.face };
            flags.push(fl);
            const fcls = ['rk-flag', ring ? 'rk-flag-out' : '', it.sel ? 'rk-wsel' : '', it.dim ? 'q-dim' : ''].filter(Boolean).join(' ');
            const at = e.kind === 'port' ? ` data-node="${escapeHtml(e.node.id)}" data-port="${escapeHtml(e.port)}"` : ` data-node="${escapeHtml(e.box.id)}" data-port="${RV_NOPORT}"`;
            fl.html = `<button type="button" class="${fcls}" data-key="${key}" data-links="${key}" data-ends="${escapeHtml(it.ids.join(' '))}"${at}
                style="width:${w}px${it.colour ? `;--fcol:${escapeHtml(it.colour)}` : ''}" title="${escapeHtml(it.title)}" aria-label="${escapeHtml(`${e.words}. ${it.title}`)}"><span>${escapeHtml(e.words)}</span></button>`;
        });
    });
    layer.classList.toggle('rk-lit', drawn.some((it) => it.sel));
    layer.dataset.cables = _rv.cables;
    layer.innerHTML = `<svg class="rk-wires" width="${r1(fr.width)}" height="${r1(fr.height)}" viewBox="0 0 ${r1(fr.width)} ${r1(fr.height)}" aria-hidden="true">${svg.join('')}</svg>${flags.map((f) => f.html).join('')}`;
    // Each flag's button and its leader, in the order they were written.
    const btns = layer.querySelectorAll('.rk-flag');
    flags.forEach((f, j) => { f.btn = btns[j]; });
    const groups = layer.querySelectorAll('.rk-cable');
    drawn.forEach((it, j) => {
        const leads = groups[j].querySelectorAll('.rk-lead');
        flags.filter((f) => f.it === it).forEach((f, k) => { f.lead = leads[k]; });
    });
    _rv.wired = { layer, items: drawn, flags, height: fr.height, slots: slotsRect, keep };
    // The lit cables' devices are marked too, so the two ends of a selected
    // cable are found at a glance.
    faces.querySelectorAll('.rk-dev.rk-cabled').forEach((b) => b.classList.remove('rk-cabled'));
    drawn.filter((it) => it.linkSel).forEach((it) => it.ids.forEach((id) => {
        faces.querySelectorAll(`.rk-dev[data-node="${CSS.escape(id)}"]`).forEach((b) => b.classList.add('rk-cabled'));
    }));
    if (_rv.hot) rvSetHot(_rv.hot); else rvPlaceFlags();
}

// The flags' places, from what is on show now: the tagged cables' first, in
// the order of their ports down the rack (so a rebuild puts each where it was),
// then those lit by the pointer only. Each takes the first free place of:
// under its box, at its port and then a flag's width either side, a row lower
// each time; then over its box the same way. Inside its face, never over
// another flag nor over what a box says (its name line, its ports, its
// guests, its spot: w.keep, measured by rvDrawCables), so a flag hung in a
// full rack covers the plain middle of a box or an empty unit, never the
// next box's name; past RV_FLAG_REACH rows, it is left off.
// A flag already on show keeps its place while it stays on show: pointing at
// a flag lights its cable alone, and were the lit flags placed afresh then,
// the one under the pointer could move off it and another slide under it,
// which the pointer would then light, and so on, the flags trading places
// under a still mouse and a click pressing on one and letting go on another.
// Whether a flag is lit never orders it for the same reason. Classes only:
// nothing is rebuilt under the pointer.
function rvPlaceFlags() {
    const w = _rv.wired;
    if (!w || !w.layer.isConnected) return;
    const r1 = (v) => Math.round(v * 10) / 10;
    const hot = (f) => f.it.hot;
    const occ = [];
    const H2 = RV_FLAG_H / 2;
    const free = (x, y, fw, face) => occ.every((o) => x + fw / 2 + RV_FLAG_GAP <= o.x - o.w / 2 || o.x + o.w / 2 + RV_FLAG_GAP <= x - fw / 2
        || y + H2 + RV_FLAG_GAP <= o.y - H2 || o.y + H2 + RV_FLAG_GAP <= y - H2)
        && (w.keep[face] || []).every((k) => x + fw / 2 <= k.l || k.r <= x - fw / 2 || y + H2 <= k.t || k.b <= y - H2);
    const want = w.flags.filter((f) => f.it.tagged || hot(f));
    const order = (p, q) => (p.it.tagged === q.it.tagged ? 0 : p.it.tagged ? -1 : 1) || p.e.y - q.e.y || p.e.x - q.e.x || p.it.i - q.it.i;
    const spot = (f) => {
        const s = w.slots[f.face] || { l: 0, r: Infinity };
        const fw = Math.min(f.w, s.r - s.l - 2);
        const clampX = (x) => Math.min(Math.max(x, s.l + 1 + fw / 2), s.r - 1 - fw / 2);
        const clampY = (y) => Math.min(Math.max(y, RV_FLAG_H / 2), w.height - RV_FLAG_H / 2);
        const step = RV_FLAG_H + RV_FLAG_GAP;
        const rows = [];
        for (let k = 0; k < RV_FLAG_REACH; k++) rows.push(f.e.gy + RV_FLAG_GAP + RV_FLAG_H / 2 + k * step);
        for (let k = 0; k < RV_FLAG_REACH; k++) rows.push(f.e.top - RV_FLAG_GAP - RV_FLAG_H / 2 - k * step);
        for (const y0 of rows) {
            for (const side of [0, 1, -1, 2, -2]) {
                const x = clampX(f.e.x + side * (fw + RV_FLAG_GAP)), y = clampY(y0);
                if (free(x, y, fw, f.face)) return { x, y, w: fw };
            }
        }
        return null;
    };
    const placed = new Set();
    const sorted = want.slice().sort(order);
    // Those on show already, where they are; then the rest.
    sorted.forEach((f) => {
        if (!f.on || !f.at) return;
        occ.push(f.at);
        placed.add(f);
    });
    sorted.forEach((f) => {
        if (placed.has(f)) return;
        const at = spot(f);
        if (!at) return;
        occ.push(at);
        placed.add(f);
        f.at = at;
    });
    w.flags.forEach((f) => {
        const on = placed.has(f);
        f.on = on;
        f.btn.classList.toggle('rk-on', on);
        f.btn.classList.toggle('rk-hot', on && hot(f));
        if (f.lead) f.lead.setAttribute('d', on ? `M ${r1(f.e.x)} ${r1(f.e.y)} L ${r1(f.at.x)} ${r1(f.at.y - RV_FLAG_H / 2)}` : '');
        if (!on) return;
        const st = f.btn.style;
        st.left = `${r1(f.at.x - f.at.w / 2)}px`;
        st.top = `${r1(f.at.y - RV_FLAG_H / 2)}px`;
        st.width = `${r1(f.at.w)}px`;
    });
}

// Pointed at: a line or a flag (its key) or a device (its id). Its lines are
// lit and their flags show, the devices at their ends are marked, the rest
// step back. Classes only: nothing is rebuilt under the pointer. null lets go.
function rvSetHot(hot) {
    _rv.hot = hot;
    const view = rackViewEl();
    const layer = view && view.querySelector('.rk-wiring');
    if (!layer) return;
    view.querySelectorAll('.rk-dev.rk-hot').forEach((el) => el.classList.remove('rk-hot'));
    const w = _rv.wired;
    const flags = w && w.layer === layer ? w.flags : [];
    // A boolean, always: toggle() given undefined flips the class, which lit
    // every other line whenever one was pointed at.
    const match = (key, ends) => !!hot && (!!hot.key && key === hot.key || !!hot.node && String(ends || '').split(' ').includes(hot.node));
    const lines = [...layer.querySelectorAll('.rk-cable')];
    let any = false;
    lines.forEach((g) => { const on = match(g.dataset.key, g.dataset.ends); g.classList.toggle('rk-hot', on); any = any || on; });
    flags.forEach((f) => { f.it.hot = match(f.it.key, f.it.ids.join(' ')); });
    layer.classList.toggle('rk-hotting', any);
    if (hot && hot.key && any) {
        const ends = new Set(lines.filter((g) => g.classList.contains('rk-hot')).flatMap((g) => String(g.dataset.ends || '').split(' ').filter(Boolean)));
        ends.forEach((id) => view.querySelectorAll(`.rk-dev[data-node="${CSS.escape(id)}"]`).forEach((b) => b.classList.add('rk-hot')));
    }
    rvPlaceFlags();
}
// What a pointer or the focus is on, as rvSetHot takes it: a line or a flag,
// or a device box. null for anything else.
// A pointer's event (e) also finds a line drawn where it has no hit stroke,
// its drop from a port over its box and its run out under it: pointed at,
// that is the one cable, not the box's (which lit them all).
function rvHotOf(target, e) {
    const el = target && target.closest ? target.closest('.rk-hit, .rk-flag, .rk-dev') : null;
    if (e && !(el && !el.classList.contains('rk-dev')) && !target.closest('.rk-port, .rk-noport')) {
        const key = rvWireAt(e);
        if (key) return { key };
    }
    if (!el || !rackViewEl().contains(el)) return null;
    if (el.classList.contains('rk-dev')) return { node: el.dataset.node };
    return el.dataset.key ? { key: el.dataset.key } : null;
}
// The line a click or a tap meant: lines in the manager run a few pixels
// apart and a finger's hit stroke is wider than that, so the stroke on top
// is not always the one under the middle of the finger. Of the lines whose
// hit stroke takes the point, the one nearest it, found by narrowing the
// strokes until one is left. A click with no position (the keyboard) keeps
// the one it landed on.
function rvNearestHit(hit, e) {
    const svg = hit.ownerSVGElement;
    if (!svg || typeof hit.isPointInStroke !== 'function' || typeof DOMPoint !== 'function' || !e || (!e.clientX && !e.clientY)) return hit;
    const r = svg.getBoundingClientRect();
    const pt = new DOMPoint(e.clientX - r.left, e.clientY - r.top);
    // The browser's own pick is looser than the stroke: a click on one of two
    // parallel tracks 4px apart could land on the other's hit stroke while
    // the point is in this one's alone. So one stroke taking it is the one,
    // whichever the click landed on.
    const near = [...svg.querySelectorAll('.rk-hit')].filter((h) => h.isPointInStroke(pt));
    if (!near.length) return hit;
    if (near.length === 1) return near[0];
    for (let w = 1; w <= 24; w++) {
        const at = near.filter((h) => { h.style.strokeWidth = `${w}px`; const yes = h.isPointInStroke(pt); h.style.strokeWidth = ''; return yes; });
        if (at.length) return at[at.length - 1];
    }
    return near[near.length - 1];
}
// The key of the drawn line under a pointer, the nearest of them, by
// widening the lines' strokes a pixel at a time (up to 6px, about the hit
// stroke's reach). null off every line.
function rvWireAt(e) {
    const svg = rackViewEl().querySelector('.rk-wires');
    if (!svg || typeof DOMPoint !== 'function' || !e || (!e.clientX && !e.clientY)) return null;
    const wires = [...svg.querySelectorAll('.rk-wire')];
    if (!wires.length || typeof wires[0].isPointInStroke !== 'function') return null;
    const r = svg.getBoundingClientRect();
    const pt = new DOMPoint(e.clientX - r.left, e.clientY - r.top);
    for (let w = 2; w <= 6; w++) {
        const at = wires.filter((p) => { p.style.strokeWidth = w + 'px'; const yes = p.isPointInStroke(pt); p.style.strokeWidth = ''; return yes; });
        if (at.length) return at[at.length - 1].closest('.rk-cable').dataset.key || null;
    }
    return null;
}
const rvSameHot = (a, b) => (!a && !b) || (!!a && !!b && a.key === b.key && a.node === b.node);
// One cable, for its tooltip: "eth0 ↔ Gi0/2 · C-12 · blue · 3 m · via PP-1:4".
function rvCableLine(link, from) {
    const x = rackCableText(link, from);
    const via = cableOf(link, 'via').trim();
    return [x.ports, x.label, x.color, cableOf(link, 'length').trim(), via ? t('via {via}', { via }) : ''].filter(Boolean).join(' · ');
}

// A half-depth device's ports are on the one face its box has (rackPortsFace),
// whatever its Ports face says, so the button is shown greyed with the reason
// rather than offered: a tap that flipped the label and drew nothing new read
// as a fault. The field is kept as it is, for the day it is made full depth.
function rvHalfPortsBtn(id) {
    const why = escapeHtml(t('A half-depth device shows its ports on its own face.'));
    return `<button type="button" class="cs-btn rk-portsbtn" data-rk="ports" data-node="${id}" disabled
        aria-label="${why}" title="${why}">${escapeHtml(t('Ports: this face'))}</button>`;
}

// The selected device's controls: what a drag does, as buttons, for a phone
// (no hover, and a finger on a device scrolls) and for anyone who wants them.
function rackSelBarHtml(rack) {
    const one = state.selectedType === 'node' ? getNode(state.selectedId) : null;
    if (one && one.group === rack.id && hostOf(one) && rvDrawnAt(one, rack) !== one) return rackGuestBarHtml(one);
    if (!one || one.group !== rack.id || !Number.isInteger(one.rackU)) return '';
    const s = rackSpanOf(one);
    const dis = state.readOnly ? ' disabled' : '';
    const id = escapeHtml(one.id);
    const btn = (act, label, text, cls = '') => `<button type="button" class="cs-btn${cls}" data-rk="${act}" data-node="${id}"
        aria-label="${escapeHtml(t(label))}" title="${escapeHtml(t(label))}"${dis}>${text}</button>`;
    const other = s.face === 'rear' ? 'front' : 'rear';
    const full = rackFullDepth(one);
    const arming = _rv.cableFrom === one.id;
    // A cable on it with no port drawn here (its no-port spot): Pick a port,
    // the tap for the spot's tip, opens the rail's port picker on it.
    const noPort = ((_rv.noPort && _rv.noPort.get(one.id)) || []).length > 0;
    // The ports button says "Ports: front" or "Ports: rear" as whole messages,
    // not "Ports: {face}" with the face's own word: that word agrees with
    // "face" (es "cara trasera") and read wrong beside "Puertos".
    return `<section class="rk-selbar" aria-label="${escapeHtml(rvName(one))}">
        <div class="rk-selname">${rvIcon(one.type, 16)}<span class="rk-name">${escapeHtml(rvName(one))}</span>
            <span class="rk-span">${escapeHtml(rvSpanText(rack, s.lo, s.hi, s.face))}</span>
            ${full ? btn('ports', 'The side of the device its ports are on. Tap for the other side.',
                escapeHtml(portsFaceOf(one) === 'front' ? t('Ports: front') : t('Ports: rear')), ' rk-portsbtn')
                : rvHalfPortsBtn(id)}</div>
        <div class="rk-selacts">
            ${btn('up', 'Up one unit', '▲')}${btn('down', 'Down one unit', '▼')}
            ${btn('taller', 'One unit taller', '+1U')}${btn('shorter', 'One unit shorter', '−1U')}
            ${btn('face', other === 'rear' ? 'To the rear' : 'To the front', escapeHtml(t(other === 'rear' ? 'To the rear' : 'To the front')))}
            <button type="button" class="cs-btn${full ? ' active' : ''}" data-rk="depth" data-node="${id}" aria-pressed="${full}"
                title="${escapeHtml(t(full ? 'Make it half depth: it takes its units on one face' : 'Make it full depth: it takes its units on both faces'))}"${dis}>${escapeHtml(t('Full depth'))}</button>
            ${btn('cable', arming ? 'Stop: no cable' : 'Cable it to another device: tap the other end next',
                escapeHtml(t(arming ? 'Cancel cable' : 'Cable to…')), arming ? ' active' : '')}
            ${noPort ? btn('pickport', 'A cable on it has no port here: pick the port it is plugged into', escapeHtml(t('Pick a port'))) : ''}
            ${btn('out', 'Free its units. It stays in this rack, under Not placed yet.', escapeHtml(t('Clear its units')), ' rk-quiet')}
            <button type="button" class="cs-btn rk-quiet" data-rk="leave" data-node="${id}"
                title="${escapeHtml(rvLeaveText(rack))}" aria-label="${escapeHtml(rvLeaveText(rack))}"${dis}>${escapeHtml(t('Out of the rack'))}</button>
        </div>
        ${arming ? `<p class="rail-note rk-armnote" role="status">${escapeHtml(t('Now tap the device at the other end of the cable.'))}</p>` : ''}
    </section>`;
}

function rackUnplacedHtml(rack, unplaced, qm) {
    const head = `<h3 class="rk-sub">${escapeHtml(t('Not placed yet'))}</h3>`;
    if (!rackMembers(rack).length) return `<section class="rk-unplaced">${head}<p class="rail-note">${escapeHtml(t('Nothing is in this rack yet. Drag on its units to place a device, or tap one.'))}</p></section>`;
    if (!unplaced.length) return `<section class="rk-unplaced">${head}<p class="rail-note">${escapeHtml(t('Every device in this rack has its units.'))}</p></section>`;
    const dis = state.readOnly ? ' disabled' : '';
    const items = unplaced.slice().sort(rvByName).map((n) => {
        const id = escapeHtml(n.id);
        const sel = inSelection('node', n.id);
        return `<li class="rk-un${sel ? ' rk-sel' : ''}${qm && !qm.nodes.has(n.id) ? ' q-dim' : ''}">
            ${rvHandleHtml(n)}
            <button type="button" class="rk-un-name" data-rk="select" data-node="${id}"${state.readOnly ? '' : ` data-drag="${id}"`} aria-pressed="${sel}">${rvIcon(n.type, 14)}<span class="rk-name">${escapeHtml(rvName(n))}</span>
                <span class="rk-meta">${escapeHtml(rvTypeName(n.type))}${rackHeightOf(n) > 1 ? ` · ${rackHeightOf(n)}U` : ''}</span></button>
            ${rvPlaceBtnHtml(n, dis)}
        </li>`;
    }).join('');
    return `<section class="rk-unplaced">${head}<ul class="rk-unlist">${items}</ul></section>`;
}

// A row's handle: what a finger drags it by (a mouse can take the whole
// row). Not in a read-only document, where nothing is dragged in.
const rvHandleHtml = (n) => (state.readOnly ? '' : `<span class="rk-handle" data-drag="${escapeHtml(n.id)}" aria-hidden="true"
    title="${escapeHtml(t(isVirtualType(n.type) ? 'Drag onto the device it runs on' : 'Drag onto the units to place it'))}"></span>`);
// A row's Place. A VM or a container takes no units, so its row has none: it
// says where it goes instead (onto its host, by its handle; or Runs on, in
// the rail).
const rvPlaceBtnHtml = (n, dis) => (isVirtualType(n.type)
    ? `<span class="rk-meta rk-unhint">${escapeHtml(t('Drag onto its host'))}</span>`
    : `<button type="button" class="cs-btn" data-rk="place" data-node="${escapeHtml(n.id)}"
                title="${escapeHtml(t('Put it in the lowest free units that fit it'))}"${dis}>${escapeHtml(t('Place'))}</button>`);

// Other devices: every device not in this rack, to drag in or Place, which
// moves it here from wherever it was. Folded shut until opened, so a site of
// hundreds is not a list under every rack; filtered by name, type or address
// as the place dialog is, and cut at RV_OTHERS_MAX with how many more.
const RV_OTHERS_MAX = 30;
function rackOthersHtml(rack, qm) {
    const count = state.nodes.filter((n) => n && n.group !== rack.id).length;
    if (!count) return '';
    return `<details class="rk-unplaced rk-others"${_rv.othersOpen ? ' open' : ''}>
        <summary class="rk-sub">${escapeHtml(t('Other devices'))} <span class="rk-meta">${count}</span></summary>
        <p class="rail-note">${escapeHtml(t('Drag one onto the units, or Place it: it moves into this rack.'))}
            ${escapeHtml(t('A VM or a container goes onto the device it runs on.'))}</p>
        <input type="search" class="input rk-filter" data-rk-filter value="${escapeHtml(_rv.othersFilter)}"
            placeholder="${escapeHtml(t('Filter by name, type or address'))}" aria-label="${escapeHtml(t('Filter by name, type or address'))}" autocomplete="off" spellcheck="false">
        <ul class="rk-unlist rk-others-list">${rackOthersItems(rack, qm)}</ul>
    </details>`;
}
// A string, built in a lookup pass (the rack view's own, reused, or one of
// its own from the filter's input): the caller puts it in, after the pass.
function rackOthersItems(rack, qm) { return withLookupPass(() => rackOthersItemsNow(rack, qm)); }
function rackOthersItemsNow(rack, qm) {
    const list = placeCandidates(rack, _rv.othersFilter).filter((c) => c.rank > 0);
    const dis = state.readOnly ? ' disabled' : '';
    const rows = list.slice(0, RV_OTHERS_MAX).map(({ node: n }) => {
        const id = escapeHtml(n.id);
        const sel = inSelection('node', n.id);
        const where = nodePlaceText(n);
        return `<li class="rk-un${sel ? ' rk-sel' : ''}${qm && !qm.nodes.has(n.id) ? ' q-dim' : ''}">
            ${rvHandleHtml(n)}
            <button type="button" class="rk-un-name" data-rk="select" data-node="${id}"${state.readOnly ? '' : ` data-drag="${id}"`} aria-pressed="${sel}"
                title="${escapeHtml([rvName(n), where].filter(Boolean).join('\n'))}">${rvIcon(n.type, 14)}<span class="rk-name">${escapeHtml(rvName(n))}</span>
                <span class="rk-meta">${escapeHtml(where || rvTypeName(n.type))}</span></button>
            ${rvPlaceBtnHtml(n, dis)}
        </li>`;
    }).join('');
    const more = list.length > RV_OTHERS_MAX ? `<li class="rkp-more">${escapeHtml(t('…and {n} more. Narrow the filter to see them.', { n: list.length - RV_OTHERS_MAX }))}</li>` : '';
    return rows + more || `<li class="rkp-more">${escapeHtml(t('No device matches.'))}</li>`;
}

// Where Out of the rack takes a device, in words.
function rvLeaveText(rack) {
    const into = groupById(rack.parent);
    return into ? t('Take it out of {rack}. It stays in {group}, with no units.', { rack: groupLabel(rack), group: groupLabel(into) })
        : t('Take it out of {rack}. It is then in no group.', { rack: groupLabel(rack) });
}
const rvByName = (a, b) => rvName(a).localeCompare(rvName(b), undefined, { numeric: true, sensitivity: 'base' });

// ---- The patch schedule (Review-Packs/Topo-groups.md, "Round 5", R5b) ----
// The rack's cables as a list, beside the rack (under it on a narrower
// window; on a phone, the main view, with the elevation stuck above it as the
// column scrolls): a row per cable that touches the rack (rackSchedule,
// js/model.js, the same cables the elevation draws and the untagged-cables
// finding counts), with the device here and its port, the cable's tag, the
// far end and its port (and where that is, out of the rack), the colour, the
// length and the via. An untagged cable says "no tag" in its Tag cell, so the
// finding's cables are found at a glance.
//
// Sorted by any column (its head, again for the other way): the device in
// the rack's order, top first, by default (its ports in their order, as a
// person reads a rack down), the rest as text with numbers in order ("2 m"
// before "10 m"), blanks last whichever way. The sort is a view of this
// visit, not the document's.
//
// A click or a tap on a row selects its cable (the rail shows it, its port
// picker included) and traces it in One cable mode (the filter switches to
// it, kept as a choice of the filter is), and the elevation scrolls to bring
// its ends into sight. A cable selected on the elevation lights its row, and
// the list scrolls to it where it scrolls on its own (beside the rack).
// The heads are translated as the port's tip words them ("Tag: C-12" is
// "Etiqueta: C-12"); the ports' names and the cables' own words are as typed.
const RV_SCHED_COLS = [
    { key: 'dev', label: 'Device · port' }, { key: 'tag', label: 'Tag' }, { key: 'far', label: 'Far end' },
    { key: 'color', label: 'Colour' }, { key: 'length', label: 'Length' }, { key: 'via', label: 'Via' }
];
const rvNatural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

// The rows as the panel lists them, sorted as its heads say.
function rvScheduleRows(rack) {
    const rows = rackSchedule(rack).map((r, i) => Object.assign(r, { i, from: rackScheduleEnd(r), to: rackScheduleEnd(r, true) }));
    const { key, dir } = _rv.sort;
    // The device: the rack's order, as rackSchedule gives it; the other way,
    // from the bottom up.
    if (key === 'dev') return dir < 0 ? rows.reverse() : rows;
    const val = (r) => (key === 'far' ? r.to : r[key]) || '';
    return rows.sort((a, b) => {
        const x = val(a), y = val(b);
        if (!x !== !y) return x ? -1 : 1;
        return dir * rvNatural(x, y) || a.i - b.i;
    });
}

// Where a row's far end is, out of this rack, short enough for the column
// beside it: its group's own name and its units ("A02 Compute · U30–U31
// front"), not the whole path, which the row's tooltip and the report give.
// A device in no group: the location typed for it.
function rvWhereShort(r) {
    const n = r.farBox || r.far;
    const g = groupOfNode(n);
    return g ? [groupLabel(g), rackSpanText(n)].filter(Boolean).join(' · ') : r.where;
}

// A head: the sort by it, then the other way.
function setRackSort(key) {
    if (!RV_SCHED_COLS.some((c) => c.key === key)) return false;
    _rv.sort = _rv.sort.key === key ? { key, dir: -_rv.sort.dir } : { key, dir: 1 };
    renderRackView(true);
    return true;
}

function rackScheduleHtml(rack, qm) {
    const rows = rvScheduleRows(rack);
    const title = escapeHtml(t('Patch schedule'));
    const head = `<h3 class="rk-sub">${title} <span class="rk-meta">${rows.length}</span></h3>`;
    if (!rows.length) return `<section class="rk-sched" aria-label="${title}">${head}<p class="rail-note">${escapeHtml(t('No cable touches this rack yet.'))}</p></section>`;
    const { key, dir } = _rv.sort;
    const ths = RV_SCHED_COLS.map((c) => {
        const on = key === c.key;
        return `<th scope="col" aria-sort="${on ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="rk-sort${on ? ' active' : ''}" data-rk-sort="${c.key}"
            title="${escapeHtml(t('Sort by this column. Again for the other way.'))}">${escapeHtml(t(c.label))}<span class="rk-sortmark" aria-hidden="true">${on ? (dir > 0 ? '▲' : '▼') : ''}</span></button></th>`;
    }).join('');
    // Empty cells are left empty (no spaces): the list hides them. A row is
    // stacked to fit (css/app.css), so the length and the via say what they are.
    const body = rows.map((r) => {
        const id = escapeHtml(r.link.id);
        const sel = inSelection('link', r.link.id);
        const mine = !sel && [r.node, r.box, r.far, r.farBox].some((n) => n && inSelection('node', n.id));
        const cls = ['rk-srow', sel ? 'rk-ssel' : '', mine ? 'rk-smine' : '', qm && !qm.links.has(r.link.id) ? 'q-dim' : ''].filter(Boolean).join(' ');
        const swatch = rvOkColour(r.color) ? `<i class="rk-swatch" style="background:${escapeHtml(r.color)}"></i>` : '';
        return `<tr class="${cls}" data-link="${id}">`
            + `<td class="rk-sdev"><button type="button" class="rk-slink" data-rk-sched="${id}" aria-pressed="${sel}" title="${escapeHtml(`${r.from}\n${t('Trace this cable on the rack')}`)}">${escapeHtml(r.from)}</button></td>`
            + `<td class="rk-stag">${r.tag ? `<span class="rk-stagw">${escapeHtml(r.tag)}</span>` : `<span class="rk-snotag">${escapeHtml(t('no tag'))}</span>`}</td>`
            + `<td class="rk-sfar" title="${escapeHtml([r.to, r.where].filter(Boolean).join('\n'))}">${escapeHtml(r.to)}${r.where ? `<span class="rk-meta"> · ${escapeHtml(rvWhereShort(r))}</span>` : ''}</td>`
            + `<td class="rk-scol">${r.color ? `${swatch}${escapeHtml(r.color)}` : ''}</td>`
            + `<td class="rk-slen">${r.length ? `<span class="rk-sk">${escapeHtml(t('Length'))}: </span>${escapeHtml(r.length)}` : ''}</td>`
            + `<td class="rk-svia">${r.via ? `<span class="rk-sk">${escapeHtml(t('Via'))}: </span>${escapeHtml(r.via)}` : ''}</td></tr>`;
    }).join('');
    return `<section class="rk-sched" aria-label="${title}">${head}
        <p class="rail-note rk-shint">${escapeHtml(t('Tap a row to trace its cable on the rack.'))}</p>
        <div class="rk-sscroll"><table class="rk-stable"><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table></div>
    </section>`;
}

// A row's cable: selected (the rail shows it) and traced in One cable mode,
// its ends brought into the elevation's sight by the rebuild (renderRackView).
// -> true when there was such a cable.
function rvTraceCable(id) {
    if (!getLink(id)) return false;
    // For this visit only: the person tapped a row, not the filter, so the
    // filter they keep (Selected, or whatever they chose) is the one a reload
    // opens on.
    _rv.cables = 'one';
    _rv.trace = id;
    // The row was tapped, so it is in sight: the list is not scrolled to it.
    _rv.schedSel = id;
    if (typeof showConfigTab === 'function') showConfigTab('config');
    selectEntries([{ type: 'link', id }]);
    // Selected already, the selection's redraw may have been skipped.
    if (_rv.trace) renderRackView(true);
    return true;
}

// After a rebuild: the cable a row traced, its ends brought into the
// elevation's sight (both where they fit, else the first); and the row of a
// cable selected elsewhere brought into the list's, where the list scrolls
// on its own (beside the rack: under it, the whole column scrolls, and that
// is the user's to move).
function rvRevealSchedule(body) {
    const trace = _rv.trace;
    _rv.trace = '';
    const main = body.querySelector('.rk-main');
    const it = trace && _rv.wired ? _rv.wired.items.find((x) => x.key === trace) : null;
    if (it && main) {
        const rects = it.ends.filter((e) => e.at && e.box).map((e) => {
            const el = rvSlotsOf(e.face).querySelector(`.rk-dev[data-node="${CSS.escape(e.box.id)}"]`);
            return el ? el.getBoundingClientRect() : null;
        }).filter(Boolean);
        if (rects.length) {
            const top = Math.min(...rects.map((r) => r.top)), bot = Math.max(...rects.map((r) => r.bottom));
            const m = main.getBoundingClientRect();
            if (top < m.top || bot > m.bottom) main.scrollTop += bot - top <= m.height ? top - m.top - (m.height - (bot - top)) / 2 : top - m.top - 8;
        }
    }
    const one = soleSelected(state.selection);
    const sel = one && one.type === 'link' ? one.id : '';
    if (sel && sel !== _rv.schedSel) {
        const box = body.querySelector('.rk-sscroll');
        const row = box && box.querySelector(`.rk-srow[data-link="${CSS.escape(sel)}"]`);
        if (row && box.scrollHeight > box.clientHeight + 1) {
            const b = box.getBoundingClientRect(), r = row.getBoundingClientRect();
            const headH = (box.querySelector('thead') || row).getBoundingClientRect().height;
            if (r.top < b.top + headH || r.bottom > b.bottom) box.scrollTop += r.top - b.top - headH - Math.max(0, (b.height - headH - r.height) / 2);
        }
    }
    _rv.schedSel = sel;
}

// ---- Changing a place ----
// The one way a device's units change here: checked first, refused with a
// toast that says why, otherwise one batch (one undo step).
function rackRefusal(rack, chk) {
    if (chk.outside) return t('{rack} has units 1 to {top}: that does not fit.', { rack: groupLabel(rack), top: rackTop(rack) });
    return t('Those units are taken by {name}.', { name: rvName(chk.clash) });
}

// A VM or a container takes no units of its own: it is where the device it
// runs on is (js/model.js "Hosts"), and the units it was given would be
// dropped by the next save. Refused here, with the reason, rather than
// placed and quietly taken back. -> true when refused.
function rvRefuseVirtual(type) {
    if (!isVirtualType(type)) return false;
    showToast(t('A VM or a container takes no units: it is where the device it runs on is. Set that in its Runs on.'));
    return true;
}

// to: { lo, h, face }. -> true when written.
function commitRackPlace(node, to) {
    if (!node || readOnlyRefuses()) return false;
    if (rvRefuseVirtual(node.type)) return false;
    const rack = rackOfNode(node);
    if (!rack) return false;
    const chk = rackSpanCheck(rack, to.face, to.lo, to.h, node.id);
    if (!chk.ok) { showToast(rackRefusal(rack, chk)); renderRackView(true); return false; }
    const s = rackSpanOf(node);
    if (s && s.lo === to.lo && s.hi - s.lo + 1 === to.h && s.face === to.face) return false;
    batch(() => {
        node.rackU = to.lo;
        if (to.h > 1) node.rackHeight = to.h; else delete node.rackHeight;
        if (!s || to.face !== s.face || node.rackFace !== undefined) node.rackFace = to.face;
        save(); renderCanvasOnly();
    });
    rvAfterEdit();
    return true;
}

// The rail's Group picker and findings say where the selected device is.
function rvAfterEdit() {
    if (typeof renderGroupPicker === 'function') renderGroupPicker(selectedGroupNode());
    refreshSelectedNodeDiagnostics();
}

// The steps the buttons and the keys take. -> true when something changed.
function rackStep(node, act) {
    const s = rackSpanOf(node);
    const rack = rackOfNode(node);
    if (!s || !rack) return false;
    const h = s.hi - s.lo + 1;
    // Its units only: it stays a member of the rack (leaving it is the Group
    // picker's or Move to group's), and keeps its height and depth, which are
    // the device's own size and what Place fits it by.
    if (act === 'out') {
        if (readOnlyRefuses()) return false;
        batch(() => { delete node.rackU; delete node.rackFace; save(); renderCanvasOnly(); });
        rvAfterEdit();
        return true;
    }
    if (act === 'depth') return rackSetDepth(node, !rackFullDepth(node));
    if (act === 'leave') return rackLeave(node);
    let to = null;
    if (act === 'up') to = { lo: s.lo + 1, h, face: s.face };
    else if (act === 'down') to = { lo: s.lo - 1, h, face: s.face };
    else if (act === 'taller') to = { lo: s.lo, h: h + 1, face: s.face };
    else if (act === 'shorter') { if (h <= 1) return false; to = { lo: s.lo, h: h - 1, face: s.face }; }
    else if (act === 'face' || act === 'front' || act === 'rear') {
        const face = act === 'face' ? (s.face === 'rear' ? 'front' : 'rear') : act;
        if (face === s.face) return false;
        to = { lo: s.lo, h, face };
    }
    if (!to) return false;
    const done = commitRackPlace(node, to);
    // A phone shows one face: it follows the device to the other one.
    if (done && to.face !== s.face) { _rv.face = to.face; renderRackView(true); }
    return done;
}

// Full depth (the default) or half depth, on one face only. Made full
// depth, it takes the same units on the
// other face, which must be free: refused with a toast otherwise, as a move
// onto taken units is. One undo step. -> true when written.
function rackSetDepth(node, full) {
    if (!node || readOnlyRefuses()) return false;
    const rack = rackOfNode(node);
    const s = rackSpanOf(node);
    if (!rack || rackFullDepth(node) === full) return false;
    if (full && s) {
        const chk = rackSpanCheck(rack, s.face, s.lo, s.hi - s.lo + 1, node.id, state.nodes, true);
        if (!chk.ok && chk.clash) { showToast(t('It cannot fill the depth: {name} is behind it.', { name: rvName(chk.clash) })); renderRackView(true); return false; }
    }
    batch(() => {
        if (full) delete node.rackDepth; else node.rackDepth = 'half';
        save(); renderCanvasOnly();
    });
    rvAfterEdit();
    return true;
}

// ---- Cables ----
// A cable from one device to another, made as the map makes one (js/ui.js):
// bindLink picks a free port at each end, a virtual machine's is bridged, and
// a second run between the same two ports is not made again. One undo step.
// A second cable between two devices on other ports is made (a bond, a
// management link), but said: on the rack it is only a "×2" on a line that
// was already there, and a drag meant to show the existing one would add a
// port and a cable unseen. Then it is selected and the rail shows it on its port picker, the Plugged
// Into chips, to change the ports it picked; on a phone the drawer opens for
// it. -> the cable, or null.
// ports: { from, to }, the ports a drag from a port named (to only when it was
// let go on a port): bindLink picks only the end not named. With both named,
// the cable is what was drawn, so it is selected without the port picker,
// and said.
function createRackCable(fromId, toId, ports = {}) {
    _rv.cableFrom = null;
    if (readOnlyRefuses()) return null;
    const a = getNode(fromId), b = getNode(toId);
    if (!a || !b || a.id === b.id) { renderRackView(true); return null; }
    let link = { id: nextId('l'), source: a.id, target: b.id, attachment: (isVirtualType(a.type) || isVirtualType(b.type)) ? 'bridged' : null };
    // A port someone else's cable took meanwhile is not taken twice.
    if (ports.from && ifaceIsOccupied(a.id, ports.from)) ports = { ...ports, from: null };
    if (ports.to && ifaceIsOccupied(b.id, ports.to)) { showToast(t('That port has a cable already.')); renderRackView(true); return null; }
    if (ports.from) link.sourceIface = ports.from;
    if (ports.to) link.targetIface = ports.to;
    bindLink(link);
    const same = state.links.find((l) =>
        (l.source === link.source && l.target === link.target && l.sourceIface === link.sourceIface && l.targetIface === link.targetIface) ||
        (l.source === link.target && l.target === link.source && l.sourceIface === link.targetIface && l.targetIface === link.sourceIface));
    if (same) {
        showToast(t('That cable is already there.'));
        link = same;
    } else {
        const before = state.links.filter((l) => (l.source === a.id && l.target === b.id) || (l.source === b.id && l.target === a.id)).length;
        batch(() => { state.links.push(link); save(); renderCanvasOnly(); });
        if (before && !(ports.from && ports.to)) showToast(t('{a} and {b} were already cabled: this is cable {n} between them. Undo takes it back.', { a: rvName(a), b: rvName(b), n: before + 1 }));
    }
    if (ports.from && ports.to && !same) {
        selectEntries([{ type: 'link', id: link.id }]);
        if (typeof showConfigTab === 'function') showConfigTab('config');
        showToast(t('Cabled: {a} to {b}.', { a: `${rvName(a)} · ${rvPortName(link, a)}`, b: `${rvName(b)} · ${rvPortName(link, b)}` }), 'ok');
        renderRackView(true);
        return link;
    }
    openCablePorts(link);
    return link;
}

function openCablePorts(link) {
    if (typeof showConfigTab === 'function') showConfigTab('config');
    selectEntries([{ type: 'link', id: link.id }]);
    renderRackView(true);
    const ws = document.querySelector('.topo-ws');
    if (ws && !ws.classList.contains('drawer-open') && window.matchMedia('(max-width: 900px)').matches) {
        const toggle = document.querySelector('[data-ws-toggle]');
        if (toggle) toggle.click();
    }
    const ports = document.getElementById('linkPortProps');
    if (ports && !ports.classList.contains('hidden') && ports.scrollIntoView) ports.scrollIntoView({ block: 'nearest' });
}

// Cable to…: the selected device waits for a tap on the other end. Again,
// or Escape, lets it go.
function armRackCable(node) {
    if (readOnlyRefuses()) return;
    _rv.cableFrom = _rv.cableFrom === node.id ? null : node.id;
    renderRackView(true);
    const again = rackViewEl().querySelector('[data-rk="cable"]');
    if (again) again.focus();
}

// A line or its label: its cables selected (Shift/Ctrl adds them), so the
// rail shows them; one cable shows its port picker.
function rvSelectCables(e, ids) {
    const entries = ids.filter((id) => getLink(id)).map((id) => ({ type: 'link', id }));
    if (!entries.length) return;
    if (addsToSelection(e)) selectEntries([...state.selection, ...entries]);
    else selectEntries(entries);
    if (typeof showConfigTab === 'function') showConfigTab('config');
}

// The depth a device brought in from the lists goes in at, on units `to`
// ({ lo, h, face }): its own where that fits; else, for a full-depth one,
// half depth where one face is all that is free there (behind a half-depth
// device), as the place dialog's Full depth box unticks itself for the same
// units. -> { ok, full }: full undefined keeps its own depth, false makes it
// half; ok false where it fits at neither.
function rvFitDepth(rack, node, to) {
    if (rackSpanCheck(rack, to.face, to.lo, to.h, node.id).ok) return { ok: true, full: undefined };
    if (rackFullDepth(node) && rackSpanCheck(rack, to.face, to.lo, to.h, node.id, state.nodes, false).ok) return { ok: true, full: false };
    return { ok: false, full: undefined };
}

// Not placed yet's Place: the lowest free units that fit it, on the face a
// phone shows (the front, on anything wider), else on the other face. Other
// devices' Place does the same for a device not in the rack (rack: the one
// on show), which joins it. A full-depth device with no room front to back
// goes in at half depth where one face has the room, rather than refused.
function placeUnplaced(node, rack = rackOfNode(node)) {
    if (!node || !isRackGroup(rack) || readOnlyRefuses()) return false;
    const h = rackHeightOf(node);
    const first = rvPhone() ? _rv.face : 'front';
    const faces = [first, first === 'front' ? 'rear' : 'front'];
    for (const face of faces) {
        const lo = rackFirstFree(rack, face, h, node.id);
        if (lo === null) continue;
        if (node.group === rack.id) return commitRackPlace(node, { lo, h, face });
        return !!rvBringIn(node, rack, { lo, h, face });
    }
    if (rackFullDepth(node)) {
        for (const face of faces) {
            const lo = rackFirstFree(rack, face, h, node.id, state.nodes, false);
            if (lo !== null) return !!rvBringIn(node, rack, { lo, h, face, full: false });
        }
    }
    showToast(t('There are not {n} free units in a row in {rack}.', { n: h, rack: groupLabel(rack) }));
    return false;
}

// A device from outside the rack (or not placed in it) put on units `to`
// ({ lo, h, face, full? }): through placeInRack, which refuses taken units
// with its toast, and a word when it joined the rack from somewhere else or
// went in at half depth (to.full false, from rvFitDepth).
// -> the device, or null.
function rvBringIn(node, rack, to) {
    const joined = node.group !== rack.id;
    const half = to.full === false && rackFullDepth(node);
    const span = { u: to.lo, height: to.h, face: to.face };
    if (typeof to.full === 'boolean') span.full = to.full;
    const done = placeInRack(rack.id, span, { nodeId: node.id });
    if (!done) { renderRackView(true); return null; }
    const said = [joined ? t('{name} is in {group} now.', { name: rvName(done), group: groupLabel(rack) }) : '',
        half ? t('{name} goes in at half depth: the other face of those units is taken.', { name: rvName(done) }) : ''];
    if (joined || half) showToast(said.filter(Boolean).join(' '), 'ok');
    if (joined && typeof renderGroupsPanel === 'function') renderGroupsPanel();
    return done;
}

// Out of the rack: into the group the rack is in, or none. Its units and
// face go (rackKeysLost); a rack inside a rack, which the Groups tab allows,
// takes it in with no units. One undo step. -> true when written.
function rackLeave(node) {
    if (!node || readOnlyRefuses()) return false;
    const rack = rackOfNode(node);
    if (!rack) return false;
    const into = groupById(rack.parent);
    if (_rv.cableFrom === node.id) _rv.cableFrom = null;
    batch(() => {
        rackKeysLost(node, into).forEach((k) => { delete node[k]; });
        if (isRackGroup(into)) { delete node.rackU; delete node.rackFace; }
        if (into) node.group = into.id; else delete node.group;
        save(); renderCanvasOnly();
    });
    showToast(into ? t('{name} is in {group} now.', { name: rvName(node), group: groupLabel(into) })
        : t('{name} is in no group now.', { name: rvName(node) }), 'ok');
    rvAfterEdit();
    if (typeof renderGroupsPanel === 'function') renderGroupsPanel();
    return true;
}

// Put a device in the rack at span ({ u, height, face, full? }): pick.nodeId, an
// existing device (taken out of wherever it was), or pick.type, a new one,
// drawn on the map beside the rack's other devices. span.full, when given,
// is its depth (the place dialog's Full depth box); left out, a device keeps
// its own and a new one fills the depth. Refused, with a toast, where the
// units are not free at that depth. One undo step; the device ends selected.
// -> the device, or null.
function placeInRack(rackId, span, pick) {
    if (readOnlyRefuses()) return null;
    if (rvRefuseVirtual(pick && (pick.nodeId ? (getNode(pick.nodeId) || {}).type : pick.type))) return null;
    const rack = groupById(rackId);
    if (!isRackGroup(rack) || !span || !pick) return null;
    const face = span.face === 'rear' ? 'rear' : 'front';
    const height = Number.isInteger(span.height) && span.height > 0 ? span.height : 1;
    const existing = pick.nodeId ? getNode(pick.nodeId) : null;
    if (pick.nodeId && !existing) return null;
    if (!existing && !paletteDefs.some((d) => d.type === pick.type)) return null;
    const full = typeof span.full === 'boolean' ? span.full : undefined;
    const chk = rackSpanCheck(rack, face, span.u, height, existing ? existing.id : null, state.nodes, full);
    if (!chk.ok) { showToast(rackRefusal(rack, chk)); return null; }
    let node = existing;
    batch(() => {
        if (!node) {
            node = spawnNodeNow(pick.type, rackDropPoint(rack) ? { at: rackDropPoint(rack) } : {});
            // A name typed in the dialog; blank keeps the one it was given.
            if (node && typeof pick.name === 'string' && pick.name.trim()) node.name = pick.name.trim();
        }
        if (!node) return;
        node.group = rack.id;
        // Its depth is the one asked for, else the device's own: the span
        // check above already read it, and Place (commitRackPlace) keeps it.
        const depth = full === undefined ? node.rackDepth : (full ? undefined : 'half');
        clearRackPlace(node);
        if (depth) node.rackDepth = depth;
        node.rackU = span.u;
        if (height > 1) node.rackHeight = height;
        node.rackFace = face;
        save(); renderCanvasOnly();
    });
    if (!node) return null;
    _rv.face = face;
    selectEntries([{ type: 'node', id: node.id }]);
    rvAfterEdit();
    return node;
}

// Where a device made in the rack view lands on the map: beside the rack's
// devices, stepped so a few made in a row do not stack; with none, where a
// new device always lands.
function rackDropPoint(rack) {
    const mates = rackMembers(rack);
    if (!mates.length) return null;
    const x = mates.reduce((a, n) => a + n.x, 0) / mates.length, y = Math.max(...mates.map((n) => n.y));
    return { x: x + (mates.length % 6) * 40, y: y + 100 };
}

// ---- Gestures ----
// One at a time, in _rv.drag:
//   move  a device dragged by its body (a mouse or a pen: a finger scrolls)
//   size  a selected device's top edge dragged
//   place a run of empty units dragged over, or tapped
//   bring a row of Not placed yet or Other devices dragged onto the units
// A move dragged off the units offers the two targets of "out" (the header).
const rvSlotsOf = (face) => rackViewEl().querySelector(`.rk-slots[data-face="${face}"]`);
// The unit under a pointer, 1 at the bottom, clamped to the rack.
function rvUnitAt(slots, clientY, top) {
    const r = slots.getBoundingClientRect();
    const uh = r.height / top || 1;
    return Math.min(top, Math.max(1, top - Math.floor((clientY - r.top) / uh)));
}
const rvUnitPx = (slots, top) => (slots.getBoundingClientRect().height / top) || 22;
// The face whose units are under the pointer, or null (a phone shows one).
function rvFaceAt(clientX, clientY) {
    for (const face of RV_FACES) {
        const s = rvSlotsOf(face);
        if (!s || !s.offsetParent) continue;
        const r = s.getBoundingClientRect();
        if (clientX >= r.left - 12 && clientX <= r.right + 12 && clientY >= r.top - 40 && clientY <= r.bottom + 40) return face;
    }
    return null;
}

// Whether a pointer's x is beside the rack: left of the first face shown or
// right of the last, by more than the margin rvFaceAt allows.
function rvOffRackX(clientX) {
    const shown = RV_FACES.map(rvSlotsOf).filter((s) => s && s.offsetParent).map((s) => s.getBoundingClientRect());
    if (!shown.length) return false;
    return clientX < Math.min(...shown.map((r) => r.left)) - 12 || clientX > Math.max(...shown.map((r) => r.right)) + 12;
}

function onRackPointerDown(e) {
    _rv.suppressClick = false;
    if (e.button !== 0 || _rv.drag) return;
    const rack = currentRack();
    // A row of Not placed yet or Other devices: by its handle, or (a mouse,
    // a pen) anywhere on its name. A finger on the name scrolls the list.
    const carry = e.target.closest('[data-drag]');
    if (carry && rack && !state.readOnly) {
        const handle = carry.classList.contains('rk-handle');
        if (e.pointerType === 'touch' && !handle) return;
        if (handle) e.preventDefault();
        _rv.drag = { kind: 'bring', id: carry.dataset.drag, x0: e.clientX, y0: e.clientY, moved: false, chip: null, ghost: null, to: null, pointerId: e.pointerId };
        return;
    }
    const slots = e.target.closest('.rk-slots');
    if (!slots || !rack) return;
    const top = rackTop(rack);
    const dev = e.target.closest('.rk-dev');
    // A guest's chip in its host's box: dragged off it, it runs on nothing or
    // on the device it is let go on. A finger's too. Read-only, the click
    // selects it and nothing is dragged.
    const chip = e.target.closest('.rk-guest');
    if (chip) {
        if (state.readOnly) return;
        e.preventDefault();
        _rv.drag = { kind: 'guest', id: chip.dataset.guest, el: chip, x0: e.clientX, y0: e.clientY, moved: false, chip: null, dock: null, host: null, zone: null, pointerId: e.pointerId };
        return;
    }
    // A free port: a cable drawn from it to another device's port. A mouse's
    // on any box's port strip (not the hairline of a box with no room: that
    // is the box's to move); a finger's on the selected box's, whose ports
    // are a finger's size and take the touch (css/app.css), so a finger on
    // any other box still scrolls the rack. A press with no drag is a tap,
    // which shows the port's tip as before.
    const freePort = dev && !state.readOnly ? rvFreePortAt(e, dev) : null;
    if (freePort) {
        if (e.pointerType !== 'touch') e.preventDefault();
        _rv.drag = { kind: 'port', id: dev.dataset.node, port: freePort.dataset.port, el: dev, from: freePort, x0: e.clientX, y0: e.clientY, moved: false, line: null, over: null, pointerId: e.pointerId };
        return;
    }
    // A device's plug: a cable drawn from it, a finger's as well as a mouse's.
    const plug = e.target.closest('.rk-plug');
    if (dev && plug && !state.readOnly) {
        e.preventDefault();
        _rv.drag = { kind: 'cable', id: dev.dataset.node, el: dev, plug, x0: e.clientX, y0: e.clientY, moved: false, line: null, over: null, pointerId: e.pointerId };
        return;
    }
    if (dev && dev.classList.contains('rk-back')) return;   // the back of a full-depth device: moved by its front
    if (dev) {
        const grip = !!e.target.closest('.rk-grip');
        const node = getNode(dev.dataset.node);
        const s = rackSpanOf(node);
        // A finger on a device scrolls the rack: the buttons move it. Its
        // grip, on the selected one, is the finger's way to resize.
        if (!s || state.readOnly || (e.pointerType === 'touch' && !grip)) return;
        if (grip) e.preventDefault();
        // st0: where the pane was scrolled, so a drag that scrolls it
        // (rvMoveScroll) still counts its steps from the units, not the screen.
        const pane = rvPane();
        _rv.drag = { kind: grip ? 'size' : 'move', id: node.id, el: dev, x0: e.clientX, y0: e.clientY, st0: pane ? pane.scrollTop : 0, lo: s.lo, hi: s.hi, face: s.face, to: null, moved: false, pointerId: e.pointerId };
        return;
    }
    if (state.readOnly) return;
    const u = rvUnitAt(slots, e.clientY, top);
    const touch = e.pointerType === 'touch';
    if (!touch) e.preventDefault();   // no text selected on the way
    _rv.drag = { kind: 'place', face: slots.dataset.face, slots, u0: u, u1: u, touch, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, pointerId: e.pointerId };
}

function onRackPointerMove(e) {
    const d = _rv.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const rack = currentRack();
    if (!rack) { endRackGesture(); return; }
    const top = rackTop(rack);
    const far = Math.abs(e.clientX - d.x0) > 4 || Math.abs(e.clientY - d.y0) > 4;
    if (d.kind === 'cable' || d.kind === 'port') {
        if (!d.moved && !far) return;
        d.moved = true;
        e.preventDefault();
        if (d.kind === 'port') rvPortDrag(d, e.clientX, e.clientY);
        else rvCableDrag(d, e.clientX, e.clientY);
        return;
    }
    if (d.kind === 'bring') {
        if (!d.moved && !far) return;
        d.moved = true;
        e.preventDefault();
        rvBringDrag(d, rack, e.clientX, e.clientY);
        return;
    }
    if (d.kind === 'guest') {
        if (!d.moved && !far) return;
        d.moved = true;
        e.preventDefault();
        d.px = e.clientX; d.py = e.clientY;
        rvGuestDrag(d, rack, e.clientX, e.clientY);
        rvMoveScroll(d, rvGuestDrag);
        return;
    }
    if (d.kind === 'place') {
        if (d.touch) { if (far) d.moved = true; return; }   // a finger dragging scrolls; the browser takes it
        const u = rvUnitAt(d.slots, e.clientY, top);
        if (!d.moved && !far && u === d.u0) return;
        d.moved = true;
        d.u1 = u;
        const lo = Math.min(d.u0, d.u1), h = Math.abs(d.u1 - d.u0) + 1;
        if (!d.ghost) { d.ghost = document.createElement('div'); d.ghost.className = 'rk-ghost'; d.slots.appendChild(d.ghost); }
        d.ghost.style.setProperty('--u', lo);
        d.ghost.style.setProperty('--h', h);
        // Refused only where nothing fits, not even on one face: the dialog
        // that follows picks the depth (half by itself where that is all
        // that fits, behind a half-depth device on the other face).
        d.ghost.classList.toggle('rk-refused', !rackSpanCheck(rack, d.face, lo, h, null, state.nodes, false).ok);
        return;
    }
    if (!d.moved && !far) return;
    if (!d.moved) {
        d.moved = true;
        d.el.classList.add('rk-dragging');
        // The lines were drawn to where it was: they step back until it lands.
        const faces = d.el.closest('.rk-faces');
        if (faces) faces.classList.add('rk-moving');
        if (d.kind === 'move') d.dock = rvDockOpen(rack);
    }
    e.preventDefault();
    d.px = e.clientX; d.py = e.clientY;
    rvMoveAt(d, rack, e.clientX, e.clientY);
    rvMoveScroll(d);
}

// Where a moved or resized box is, for a pointer at x, y: on a target off the
// rack, or on the units under it (counted from where the drag began, with
// whatever the pane scrolled since: rvMoveScroll).
function rvMoveAt(d, rack, x, y) {
    const top = rackTop(rack);
    // Over one of the two targets off the rack: that is where it goes, and
    // the box waits where it was last on the units.
    if (d.dock) {
        d.zone = rvZoneAt(d.dock, x, y);
        d.dock.querySelectorAll('[data-zone]').forEach((z) => z.classList.toggle('rk-over', z.dataset.zone === d.zone));
        d.el.classList.toggle('rk-leaving', !!d.zone);
        if (d.zone) { d.el.classList.remove('rk-refused'); return; }
    }
    const slots = d.el.closest('.rk-slots');
    const pane = rvPane();
    const scrolled = pane ? pane.scrollTop - (d.st0 || 0) : 0;
    const steps = Math.round((d.y0 - y - scrolled) / rvUnitPx(slots, top));
    const h0 = d.hi - d.lo + 1;
    let to;
    if (d.kind === 'size') {
        to = { lo: d.lo, h: Math.max(1, Math.min(top - d.lo + 1, h0 + steps)), face: d.face };
    } else {
        // Off the rack to the side (past both faces and the manager between
        // them), and not on a target: off the rack is not a place, so the box
        // goes back to its units, and a release there writes nothing. Above
        // or below, it is kept inside the rack: past the top it stays at the
        // top, so an overshoot on the way up is not a drag lost.
        if (rvOffRackX(x)) {
            const home = rvSlotsOf(d.face);
            if (home && d.el.parentElement !== home) home.appendChild(d.el);
            d.to = null;
            d.el.style.setProperty('--u', d.lo);
            d.el.style.setProperty('--h', h0);
            d.el.classList.remove('rk-refused');
            return;
        }
        const face = rvFaceAt(x, y) || d.to?.face || d.face;
        to = { lo: Math.min(Math.max(1, d.lo + steps), Math.max(1, top - h0 + 1)), h: h0, face };
        const there = rvSlotsOf(face);
        if (there && d.el.parentElement !== there) there.appendChild(d.el);
    }
    d.to = to;
    d.el.style.setProperty('--u', to.lo);
    d.el.style.setProperty('--h', to.h);
    d.el.classList.toggle('rk-refused', !rackSpanCheck(rack, to.face, to.lo, to.h, d.id).ok);
}

// The units' pane, which scrolls (a 42U rack is taller than most windows).
const rvPane = () => rackViewEl().querySelector('.rk-main');

// A box moved or resized near the top or the bottom of the pane scrolls it,
// and keeps scrolling while the pointer is held there, so units out of sight
// can be reached without letting go: before, only a row brought in and a
// cable did, and a device could not be moved to units scrolled away. Not
// over a target (that is where it goes, and the units under it stay put).
// The band is just inside the pane and a little past its top; past its
// bottom are the targets on a narrower window (rvDockOpen). A guest's chip
// dragged to another host scrolls the same way (redo: rvGuestDrag), or on a
// phone, where the pane shows a dozen units, a host scrolled out of sight
// could not be reached.
function rvMoveScroll(d, redo = rvMoveAt) {
    if (d.scroller) return;
    d.scroller = setInterval(() => {
        const pane = rvPane(), rack = currentRack();
        if (_rv.drag !== d || !pane || !rack) { clearInterval(d.scroller); d.scroller = null; return; }
        if (d.zone || d.host || d.px === undefined) return;   // over a target, or a host lit for a chip
        const r = pane.getBoundingClientRect();
        if (d.px < r.left || d.px > r.right) return;
        let dy = 0;
        if (d.py < r.top + 28 && d.py > r.top - 40) dy = -14;
        else if (d.py > r.bottom - 28 && d.py <= r.bottom) dy = 14;
        if (!dy) return;
        const before = pane.scrollTop;
        pane.scrollTop += dy;
        if (pane.scrollTop !== before) redo(d, rack, d.px, d.py);
    }, 40);
}

function onRackPointerUp(e) {
    const d = _rv.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    _rv.drag = null;
    rvDragDone(d);
    if (d.kind === 'bring') {
        if (!d.moved) {   // a press on the row without a drag: the click selects
            if (_rv.dirty) setTimeout(() => { if (!_rv.drag) renderRackView(); }, 0);
            return;
        }
        _rv.suppressClick = true;
        setTimeout(() => { _rv.suppressClick = false; }, 0);
        const node = getNode(d.id), rack = currentRack();
        // A VM or a container: onto the device it will run on, never units.
        if (node && rack && isVirtualType(node.type)) {
            if (d.host) { rvSetHost(node, d.host); return; }
            if (d.overUnits) showToast(t('A VM or a container takes no units: drop it on the device it runs on.'));
            renderRackView(true);
            return;
        }
        if (node && rack && d.to) rvBringIn(node, rack, d.to);
        else renderRackView(true);
        return;
    }
    if (d.kind === 'guest') {
        if (!d.moved) {   // a press on the chip without a drag: the click selects
            if (_rv.dirty) setTimeout(() => { if (!_rv.drag) renderRackView(); }, 0);
            return;
        }
        _rv.suppressClick = true;
        setTimeout(() => { _rv.suppressClick = false; }, 0);
        const node = getNode(d.id);
        if (node && d.zone === 'unhost') { rvSetHost(node, null); return; }
        if (node && d.host && d.host.id !== node.host) { rvSetHost(node, d.host); return; }
        renderRackView(true);
        return;
    }
    if (d.kind === 'cable') {
        rvCableDragEnd(d);
        if (!d.moved) {   // a press on the dot without a drag: the click selects
            if (_rv.dirty) setTimeout(() => { if (!_rv.drag) renderRackView(); }, 0);
            return;
        }
        _rv.suppressClick = true;
        // The click that follows a drag lands where it was let go: on the
        // other device, which it must not select instead.
        setTimeout(() => { _rv.suppressClick = false; }, 0);
        if (d.over) createRackCable(d.id, d.over);
        else renderRackView(true);
        return;
    }
    if (d.kind === 'port') {
        rvCableDragEnd(d);
        if (!d.moved) {   // a press on the port without a drag: the click shows its tip
            if (_rv.dirty) setTimeout(() => { if (!_rv.drag) renderRackView(); }, 0);
            return;
        }
        _rv.suppressClick = true;
        setTimeout(() => { _rv.suppressClick = false; }, 0);
        if (d.over) createRackCable(d.id, d.over.node, { from: d.port, to: d.over.port });
        else {
            if (d.overKey && /\u00001$/.test(d.overKey)) showToast(t('That port has a cable already.'));
            renderRackView(true);
        }
        return;
    }
    const rack = currentRack();
    if (!rack) { renderRackView(true); return; }
    if (d.kind === 'place') {
        if (d.touch && d.moved) { if (_rv.dirty) renderRackView(); return; }
        const lo = Math.min(d.u0, d.u1), h = Math.abs(d.u1 - d.u0) + 1;
        const chk = rackSpanCheck(rack, d.face, lo, h, null, state.nodes, false);   // as the ghost: any depth
        if (!chk.ok) { showToast(rackRefusal(rack, chk)); renderRackView(true); return; }
        if (_rv.dirty) renderRackView();
        // Opened by the click that follows, not here: opened now, the dialog
        // would be under the finger when that click lands, and could take
        // it as a pick. A click that lands outside the view opens it anyway.
        const req = { rackId: rack.id, face: d.face, u: lo, height: h };
        _rv.pendingPlace = req;
        setTimeout(() => { if (_rv.pendingPlace === req) { _rv.pendingPlace = null; openPlaceDialog(req); } }, 350);
        return;
    }
    if (!d.moved) {
        // A plain click: the click event selects. The view is not rebuilt
        // under it, or the click would land on a box no longer there.
        if (_rv.dirty) setTimeout(() => { if (!_rv.drag) renderRackView(); }, 0);
        return;
    }
    _rv.suppressClick = true;
    const node = getNode(d.id);
    if (node && d.zone) {
        if (!rackStep(node, d.zone === 'leave' ? 'leave' : 'out')) renderRackView(true);
        return;
    }
    if (!node || !d.to || !commitRackPlace(node, d.to)) { renderRackView(true); return; }
    if (d.to.face !== d.face) _rv.face = d.to.face;
    renderRackView(true);
}

// A gesture the browser took over (a finger scrolling) or the view closed.
function endRackGesture() {
    const d = _rv.drag;
    if (!d) return;
    _rv.drag = null;
    rvDragDone(d);
    if (d.kind === 'cable' || d.kind === 'port') rvCableDragEnd(d);
    if (rackShown()) renderRackView(true);
}

// What a gesture put on the page for its length, taken away.
function rvDragDone(d) {
    if (d.scroller) { clearInterval(d.scroller); d.scroller = null; }
    if (d.ghost) d.ghost.remove();
    if (d.chip) d.chip.remove();
    if (d.dock) d.dock.remove();
    d.ghost = d.chip = d.dock = null;
    if (d.kind === 'guest' || d.kind === 'bring') rvMarkHostTarget(null);
}

// A row being brought in: its name follows the pointer, and over a face the
// units it would take are outlined, its own height tall and centred on the
// pointer (refused, red, where they are taken). Near the top or the bottom
// of the units' pane, the pane scrolls.
function rvBringDrag(d, rack, x, y) {
    const node = getNode(d.id);
    if (!node) return;
    const main = rackViewEl().querySelector('.rk-main');
    if (main) {
        const r = main.getBoundingClientRect();
        if (x >= r.left && x <= r.right) {
            if (y < r.top + 28 && y > r.top - 40) main.scrollTop -= 14;
            else if (y > r.bottom - 28 && y < r.bottom + 40) main.scrollTop += 14;
        }
    }
    if (!d.chip) d.chip = rvDragChip(node);
    d.chip.style.left = `${x + 12}px`;
    d.chip.style.top = `${y + 12}px`;
    // A VM or a container goes onto a device, not onto units.
    if (isVirtualType(node.type)) { rvGuestOver(d, node, x, y); return; }
    const face = rvFaceAt(x, y);
    const slots = face && rvSlotsOf(face);
    if (!slots) {
        d.to = null;
        if (d.ghost) { d.ghost.remove(); d.ghost = null; }
        return;
    }
    const top = rackTop(rack);
    const h = rackHeightOf(node);
    const lo = Math.min(Math.max(1, rvUnitAt(slots, y, top) - Math.floor((h - 1) / 2)), Math.max(1, top - h + 1));
    // At its own depth, or half where only one face is free there.
    const fit = rvFitDepth(rack, node, { lo, h, face });
    d.to = { lo, h, face, full: fit.full };
    if (!d.ghost || d.ghost.parentElement !== slots) {
        if (d.ghost) d.ghost.remove();
        d.ghost = document.createElement('div');
        d.ghost.className = 'rk-ghost';
        slots.appendChild(d.ghost);
    }
    d.ghost.style.setProperty('--u', lo);
    d.ghost.style.setProperty('--h', Math.min(h, top));
    d.ghost.classList.toggle('rk-refused', !fit.ok);
}

// The name that follows the pointer while a row or a chip is dragged; a VM's
// or a container's has a line under it for when it is over units it cannot
// take (rvGuestOver).
function rvDragChip(node) {
    const chip = document.createElement('div');
    chip.className = 'rk-chip';
    chip.setAttribute('aria-hidden', 'true');
    chip.innerHTML = `${rvIcon(node.type, 14)}<span class="rk-name">${escapeHtml(rvName(node))}</span>`
        + (isVirtualType(node.type) ? `<span class="rk-chip-hint" hidden>${escapeHtml(t('Drop it on the device it runs on'))}</span>` : '');
    document.body.appendChild(chip);
    return chip;
}

// A VM or a container dragged in from a list, or a chip dragged off its box:
// the device under the pointer it may run on is lit (d.host); over units and
// no such device, the name that follows the pointer says where it goes
// instead (d.overUnits), and a release there is refused with the same words.
function rvGuestOver(d, node, x, y) {
    d.to = null;
    if (d.ghost) { d.ghost.remove(); d.ghost = null; }
    d.host = d.zone ? null : rvHostUnder(node, x, y);
    // Over the box it already runs in: nothing to light.
    rvMarkHostTarget(d.host && d.host.id !== node.host ? d.host.id : null);
    d.overUnits = !d.host && !d.zone && !!rvFaceAt(x, y) && !(d.kind === 'guest' && rvOnOwnHost(node, x, y));
    if (d.chip) {
        d.chip.classList.toggle('rk-chip-refused', d.overUnits);
        const hint = d.chip.querySelector('.rk-chip-hint');
        if (hint) hint.hidden = !d.overUnits;
    }
}
// Whether the pointer is still over the box a chip came from.
function rvOnOwnHost(node, x, y) {
    const hit = document.elementFromPoint(x, y);
    const box = hit && hit.closest ? hit.closest('#rackView .rk-dev') : null;
    return !!box && box.dataset.node === (hostRootOf(node) || {}).id;
}

// A chip being dragged off its host's box: its name follows the pointer, the
// one target beside the rack (Runs on nothing) appears, and a device it may
// run on is lit under the pointer.
function rvGuestDrag(d, rack, x, y) {
    const node = getNode(d.id);
    if (!node) return;
    if (!d.chip) {
        d.chip = rvDragChip(node);
        if (d.el) d.el.classList.add('rk-leaving');
        const on = hostOf(node);
        d.dock = rvDockOpen(rack, [{ zone: 'unhost', title: t('Runs on nothing'),
            text: t('It stops running on {host} and waits under Not placed yet.', { host: on ? rvName(on) : '' }) }]);
    }
    d.chip.style.left = `${x + 12}px`;
    d.chip.style.top = `${y + 12}px`;
    d.zone = rvZoneAt(d.dock, x, y);
    d.dock.querySelectorAll('[data-zone]').forEach((z) => z.classList.toggle('rk-over', z.dataset.zone === d.zone));
    rvGuestOver(d, node, x, y);
}

// The two targets a placed device dragged off the units can go to, there only
// while it is dragged: over the column beside the rack, where a hand that
// drags a device off the rack is headed (the foot of the view has the
// network's bar in its corner); where that column sits under the rack (900px
// and narrower), side by side just under the rack's pane, over the lists
// that are there. They were across the top of the pane, over its top two or
// three units: a device dragged up to U41 of a 42U rack scrolled to the top
// lit Not placed yet and lost its units on release. Never over the units.
// zones: [{ zone, title, text }] in place of those two (a guest's chip has
// one, Runs on nothing).
function rvDockOpen(rack, zones) {
    const view = rackViewEl();
    const vr = view.getBoundingClientRect();
    const side = view.querySelector('.rk-side');
    const sr = side ? side.getBoundingClientRect() : null;
    const body = rvEl('rackBody').getBoundingClientRect();
    const dock = document.createElement('div');
    dock.className = 'rk-dock';
    if (sr && sr.width > 0) {
        dock.classList.add('rk-dock-side');
        dock.style.left = `${Math.round(sr.left - vr.left)}px`;
        dock.style.width = `${Math.round(sr.width)}px`;
        dock.style.top = `${Math.round(sr.top - vr.top)}px`;
    } else {
        const pane = rvPane();
        const below = pane ? pane.getBoundingClientRect().bottom : body.top;
        dock.style.top = `${Math.round(below - vr.top + 6)}px`;
    }
    dock.setAttribute('role', 'presentation');
    const list = zones || [{ zone: 'out', title: t('Not placed yet'), text: t('Keep it in {rack}, with no units', { rack: groupLabel(rack) }) },
        { zone: 'leave', title: t('Out of the rack'), text: rvLeaveText(rack) }];
    dock.innerHTML = list.map((z) => `<div class="rk-drop" data-zone="${escapeHtml(z.zone)}"><strong>${escapeHtml(z.title)}</strong>
            <span>${escapeHtml(z.text)}</span></div>`).join('');
    view.appendChild(dock);
    return dock;
}
// The target under a pointer, or null. Never over the units' pane: a target
// that ends up over it (a short window) gives way to the units.
function rvZoneAt(dock, x, y) {
    const pane = rvPane();
    if (pane) {
        const p = pane.getBoundingClientRect();
        if (x >= p.left && x <= p.right && y >= p.top && y <= p.bottom) return null;
    }
    for (const z of dock.querySelectorAll('[data-zone]')) {
        const r = z.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z.dataset.zone;
    }
    return null;
}

// The cable being drawn: a line from the plug to the pointer, over the
// whole page (the other device can be on the other face or further down),
// and the device under the pointer marked as the one it would go to. Near
// the top or the bottom of the units' pane, the pane scrolls.
function rvCableDrag(d, x, y) {
    const main = rackViewEl().querySelector('.rk-main');
    if (main) {
        const r = main.getBoundingClientRect();
        if (y < r.top + 28) main.scrollTop -= 14; else if (y > r.bottom - 28) main.scrollTop += 14;
    }
    if (!d.line) {
        d.line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        d.line.setAttribute('class', 'rk-cabling');
        d.line.setAttribute('aria-hidden', 'true');
        d.line.innerHTML = '<line/>';
        document.body.appendChild(d.line);
        d.el.classList.add('rk-armed');
    }
    // The plug is looked up again: the pane may have scrolled under it.
    const from = (rackViewEl().querySelector(`.rk-dev[data-node="${CSS.escape(d.id)}"] .rk-plug`) || d.plug).getBoundingClientRect();
    const ln = d.line.firstChild;
    ln.setAttribute('x1', from.left + from.width / 2); ln.setAttribute('y1', from.top + from.height / 2);
    ln.setAttribute('x2', x); ln.setAttribute('y2', y);
    const hit = document.elementFromPoint(x, y);
    const target = hit && hit.closest ? hit.closest('#rackView .rk-dev') : null;
    const over = target && target.dataset.node !== d.id ? target.dataset.node : null;
    if (over !== d.over) {
        rackViewEl().querySelectorAll('.rk-target').forEach((el) => el.classList.remove('rk-target'));
        if (over) rackViewEl().querySelectorAll(`.rk-dev[data-node="${CSS.escape(over)}"]`).forEach((el) => el.classList.add('rk-target'));
        d.over = over;
    }
}
function rvCableDragEnd(d) {
    if (d.line) d.line.remove();
    d.line = null;
    const view = rackViewEl();
    if (view) view.querySelectorAll('.rk-target, .rk-ptarget').forEach((el) => el.classList.remove('rk-target', 'rk-ptarget'));
    if (d.el) d.el.classList.remove('rk-armed');
    if (d.from) d.from.classList.remove('rk-pfrom');
}

// The free port a press on a box starts a cable from, or null: see "A free
// port" in onRackPointerDown.
function rvFreePortAt(e, dev) {
    const port = e.target && e.target.closest ? e.target.closest('.rk-port') : null;
    if (!port || !dev.contains(port) || port.classList.contains('rk-pcab')) return null;
    if (port.closest('.rk-ports.rk-pthin')) return null;
    if (e.pointerType === 'touch' && !dev.classList.contains('rk-sel')) return null;
    return port.getBoundingClientRect().width >= 4 ? port : null;
}

// The end a port's cable would go to under a pointer at x, y: a free port of
// another device (the one under the pointer, or the nearest free one on the
// box under it within RV_SNAP_PX: a port at 1x is a few pixels wide), else
// that device itself, for bindLink to pick its port. -> { node, port|null,
// el } or null; a taken port under the pointer is { node, taken: true }.
function rvPortTargetAt(d, x, y) {
    const hit = document.elementFromPoint(x, y);
    const box = hit && hit.closest ? hit.closest('#rackView .rk-dev') : null;
    if (!box || box.dataset.node === d.id) return null;
    const own = hit.closest('.rk-port');
    if (own && own.classList.contains('rk-pcab')) return { node: box.dataset.node, taken: true, el: own };
    let best = own, dist = 0;
    if (!best) {
        dist = Infinity;
        box.querySelectorAll('.rk-port:not(.rk-pcab)').forEach((p) => {
            const r = p.getBoundingClientRect();
            const dd = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
            if (dd < dist) { dist = dd; best = p; }
        });
    }
    return best && dist <= RV_SNAP_PX ? { node: box.dataset.node, port: best.dataset.port, el: best } : { node: box.dataset.node, port: null, el: null };
}

// A cable being drawn from a port: a line from the port to the pointer, the
// port it would go to ringed, or the device (bindLink picks its port); a
// port already taken is refused, red. Near the top or the bottom of the
// units' pane, the pane scrolls, as a cable from a plug does; not while the
// pointer is still by the port it started from (a port near the pane's edge
// would scroll away under the pointer before the drag had gone anywhere).
function rvPortDrag(d, x, y) {
    const main = rvPane();
    if (main && Math.hypot(x - d.x0, y - d.y0) > 24) {
        const r = main.getBoundingClientRect();
        if (y < r.top + 28) main.scrollTop -= 14; else if (y > r.bottom - 28) main.scrollTop += 14;
    }
    if (!d.line) {
        d.line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        d.line.setAttribute('class', 'rk-cabling');
        d.line.setAttribute('aria-hidden', 'true');
        d.line.innerHTML = '<line/>';
        document.body.appendChild(d.line);
        d.from.classList.add('rk-pfrom');
    }
    // The port is looked up again: the pane may have scrolled under it.
    const from = (rackViewEl().querySelector(`.rk-dev[data-node="${CSS.escape(d.id)}"] .rk-port[data-port="${CSS.escape(d.port)}"]`) || d.from).getBoundingClientRect();
    const ln = d.line.firstChild;
    ln.setAttribute('x1', from.left + from.width / 2); ln.setAttribute('y1', from.top + from.height / 2);
    ln.setAttribute('x2', x); ln.setAttribute('y2', y);
    const over = rvPortTargetAt(d, x, y);
    d.line.classList.toggle('rk-refused', !!(over && over.taken));
    const key = over ? `${over.node}\u0000${over.port || ''}\u0000${over.taken ? 1 : 0}` : '';
    if (key === d.overKey) return;
    d.overKey = key;
    d.over = over && !over.taken ? over : null;
    const view = rackViewEl();
    view.querySelectorAll('.rk-target, .rk-ptarget').forEach((el) => el.classList.remove('rk-target', 'rk-ptarget'));
    if (!over || over.taken) return;
    if (over.el) over.el.classList.add('rk-ptarget');
    view.querySelectorAll(`.rk-dev[data-node="${CSS.escape(over.node)}"]`).forEach((el) => el.classList.add('rk-target'));
}

function onRackClick(e) {
    if (_rv.pendingPlace) {
        const req = _rv.pendingPlace;
        _rv.pendingPlace = null;
        openPlaceDialog(req);
        return;
    }
    // Pick a port, in a no-port spot's tip: the rail's port picker on it.
    const pickBtn = e.target.closest('[data-rk-pick]');
    if (pickBtn) {
        const link = getLink(pickBtn.dataset.rkPick);
        rvHidePortTip();
        if (link) openCablePorts(link);
        return;
    }
    // The cable filter (a view kept in this browser).
    const filter = e.target.closest('#rackCables [data-cables]');
    if (filter) { setRackCables(filter.dataset.cables); return; }
    // The patch schedule: a head sorts by its column, a row traces its cable.
    const sortBtn = e.target.closest('[data-rk-sort]');
    if (sortBtn) { setRackSort(sortBtn.dataset.rkSort); return; }
    const srow = e.target.closest('.rk-srow');
    if (srow) { rvHidePortTip(); rvTraceCable(srow.dataset.link); return; }
    // A guest's chip is the guest: selected (or, with Cable to… waiting, the
    // other end of the cable), not its host.
    const chip = e.target.closest('.rk-guest');
    if (chip) {
        if (_rv.suppressClick) { _rv.suppressClick = false; return; }   // the end of a drag off it
        const guest = getNode(chip.dataset.guest);
        if (!guest) return;
        if (_rv.cableFrom) { createRackCable(_rv.cableFrom, guest.id); return; }
        rvSelect(e, guest);
        return;
    }
    const act = e.target.closest('[data-rk]');
    if (act) {
        const node = getNode(act.dataset.node);
        if (!node) return;
        if (act.dataset.rk === 'unhost') { rvSetHost(node, null); return; }
        if (act.dataset.rk === 'select') {
            if (_rv.suppressClick) { _rv.suppressClick = false; return; }   // the end of a drag in
            rvSelect(e, node);
            return;
        }
        if (act.dataset.rk === 'place') { placeUnplaced(node, currentRack()); return; }
        if (act.dataset.rk === 'cable') { armRackCable(node); return; }
        if (act.dataset.rk === 'pickport') {
            const first = ((_rv.noPort && _rv.noPort.get(node.id)) || [])[0];
            if (first) openCablePorts(first);
            return;
        }
        // Its ports to the other side of the device (setPortsFace, js/groups.js).
        if (act.dataset.rk === 'ports') {
            if (rackFullDepth(node) && setPortsFace(node, portsFaceOf(node) === 'front' ? 'rear' : 'front')) rvAfterEdit();
            return;
        }
        rackStep(node, act.dataset.rk);
        return;
    }
    const face = e.target.closest('#rackFaceSwitch [data-face]');
    if (face) { _rv.face = face.dataset.face === 'rear' ? 'rear' : 'front'; renderRackView(true); return; }
    const zoom = e.target.closest('#rackZoom [data-zoom]');
    if (zoom) { setRackZoom(Number(zoom.dataset.zoom)); return; }
    // A port: its tip, kept. On the selected device's box (grown to show
    // them), or wherever the ports are a finger's size; a tap on the marks
    // of a box not selected selects it, below, as a tap on a box does. Not
    // the end of a drag, nor the other end of a Cable to…
    const port = !_rv.suppressClick && !_rv.cableFrom ? rvPortAt(e) : null;
    const portBox = port && port.closest('.rk-dev');
    if (port && portBox && !addsToSelection(e)) {
        const id = portBox.dataset.node;
        // One cable: a tap on a cabled port, however small, traces its cable
        // (it is selected; the filter shows it end to end) with the tip.
        const node = getNode(id);
        const info = _rv.cables === 'one' && node ? rvPortInfo(node, port.dataset.port) : null;
        if (info && info.links.length) {
            selectEntries(info.links.map((lid) => ({ type: 'link', id: lid })));
            rvPinPortTip(id, port.dataset.port);
            return;
        }
        if (inSelection('node', id) || port.getBoundingClientRect().width >= RV_PORT_TAP_PX) {
            if (!(state.selectedType === 'node' && state.selectedId === id)) rvSelect(e, node);
            const again = rackViewEl().querySelector(`.rk-dev[data-node="${CSS.escape(id)}"] .rk-port[data-port="${CSS.escape(port.dataset.port)}"]`);
            if (again) rvPinPortTip(id, port.dataset.port);
            return;
        }
    }
    // A box's no-port spot: its device selected (a phone reads the rail and
    // its bar's Pick a port), and the spot's tip, its cables with Pick a port.
    const spot = !_rv.suppressClick && !_rv.cableFrom && !addsToSelection(e) ? e.target.closest('.rk-noport') : null;
    if (spot) {
        const id = spot.closest('.rk-dev').dataset.node;
        if (!(state.selectedType === 'node' && state.selectedId === id)) rvSelect(e, getNode(id));
        rvPinPortTip(id, RV_NOPORT);
        return;
    }
    // Anything else lets a tapped port's tip go.
    if (_rv.portTip) rvHidePortTip();
    // A line, or its flag: its cable, and the tip of the port at that end
    // (the flag's, or the line's first port), so a tap reads it all.
    let lbl = e.target.closest('.rk-flag, .rk-hit');
    if (lbl && lbl.classList.contains('rk-hit')) lbl = rvNearestHit(lbl, e);
    if (lbl) {
        rvSelectCables(e, String(lbl.dataset.links || '').split(' ').filter(Boolean));
        if (lbl.dataset.node && lbl.dataset.port && !addsToSelection(e)) rvPinPortTip(lbl.dataset.node, lbl.dataset.port);
        return;
    }
    const dev = e.target.closest('.rk-dev');
    if (dev) {
        if (_rv.suppressClick) { _rv.suppressClick = false; return; }
        // Cable to… is waiting: this is the other end.
        if (_rv.cableFrom) {
            const from = _rv.cableFrom;
            if (dev.dataset.node === from) { _rv.cableFrom = null; renderRackView(true); return; }
            createRackCable(from, dev.dataset.node);
            return;
        }
        const node = getNode(dev.dataset.node);
        if (node) rvSelect(e, node);
        return;
    }
    // An empty run, from the keyboard (a click with the pointer is the place
    // gesture's, above): one unit at its bottom, changed in the dialog.
    const free = e.target.closest('.rk-free');
    if (free && e.detail === 0 && !state.readOnly) {
        const rack = currentRack();
        if (rack) openPlaceDialog({ rackId: rack.id, face: free.dataset.face, u: Number(free.dataset.lo), height: 1 });
    }
}

// Selected here is selected everywhere; Shift/Ctrl/Cmd adds or takes out.
function rvSelect(e, node) {
    // A guest is in its host's box: that is what is kept in sight.
    _rv.reveal = (hostRootOf(node) || node).id;
    if (addsToSelection(e)) toggleSelected('node', node.id);
    else selectEntries([{ type: 'node', id: node.id }]);
    const again = rackViewEl().querySelector(`.rk-dev:not(.rk-back)[data-node="${CSS.escape(node.id)}"]`)
        || rackViewEl().querySelector(`.rk-un-name[data-node="${CSS.escape(node.id)}"]`);
    // It was just tapped, so it is in sight: the focus does not scroll. Where
    // the column scrolls (900px and narrower) a focus that did would undo the
    // rebuild's own care, which brings the buttons above the units back.
    if (again) again.focus({ preventScroll: true });
}

// The focused device, from the keyboard. The keys are the rack view's while
// it has the focus, so the map's shortcuts do not see them.
function onRackKey(e) {
    if (e.key === 'Escape' && _rv.portTip) {
        e.preventDefault();
        e.stopPropagation();
        rvHidePortTip();
        return;
    }
    if (e.key === 'Escape' && _rv.cableFrom) {
        e.preventDefault();
        e.stopPropagation();
        _rv.cableFrom = null;
        renderRackView(true);
        return;
    }
    const dev = e.target.closest('.rk-dev');
    if (!dev || dev.classList.contains('rk-back') || e.ctrlKey || e.metaKey || e.altKey) return;
    const acts = { ArrowUp: e.shiftKey ? 'taller' : 'up', ArrowDown: e.shiftKey ? 'shorter' : 'down', ArrowLeft: 'front', ArrowRight: 'rear' };
    const act = acts[e.key];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    const node = getNode(dev.dataset.node);
    if (node) rackStep(node, act);
}

// ---- The place dialog ----
// Opened with the units dragged over (or tapped, or an empty run's bottom
// one from the keyboard). Where it goes is one line at the top ("Goes in U23
// front, full depth."), opened to change the units, face and depth; it opens
// by itself when they do not fit. Under it two tabs:
//   New device    a grid of the types that go in a rack, a name (optional:
//                 blank takes the usual one), and Add <type> in the footer;
//   From the map  every device not already placed in this rack: this rack's
//                 own first, then devices in no group, then those in another
//                 group (placing one moves it here); a click places it.
// It opens on From the map when this rack has devices waiting for units
// (the likely reason to have dragged over some), else on New device.
const _rp = { req: null, depthSaid: false, tab: 'new' };
// The types most often racked come first in the grid; the rest follow in the
// palette's order. VMs and containers are left out (they take no units).
const RP_TYPE_ORDER = ['server', 'switch', 'l3switch', 'router', 'firewall', 'edge', 'loadbalancer', 'vpn', 'ap'];
const rpEl = (id) => document.getElementById(id);
const RP_LIST_MAX = 120;

function openPlaceDialog(req) {
    if (readOnlyRefuses()) return false;
    const rack = groupById(req && req.rackId);
    if (!isRackGroup(rack)) return false;
    _rp.req = { rackId: rack.id };
    rpEl('rackPlaceTitle').textContent = t('Add to {rack}', { rack: groupLabel(rack) });
    rpEl('rackPlaceU').max = String(rackTop(rack));
    rpEl('rackPlaceHeight').max = String(rackTop(rack));
    // The unit as the rails print it: on a rack numbered from the top, the
    // top unit (rackStartNo); placeDialogSpan turns it back.
    const ulbl = document.querySelector('label[for="rackPlaceU"]');
    if (ulbl) ulbl.textContent = t(rackTopDown(rack) ? 'Top unit' : 'Lowest unit');
    rpEl('rackPlaceU').value = String(rackStartNo(rack, req.u, req.height || 1));
    rpEl('rackPlaceHeight').value = String(req.height || 1);
    rpEl('rackPlaceFace').value = req.face === 'rear' ? 'rear' : 'front';
    _rp.depthSaid = false;
    placeDialogDepth(rack);
    rpEl('rackPlaceFilter').value = '';
    rpEl('rackPlaceName').value = '';
    rpEl('rackPlaceWhere').open = false;
    // A VM or a container takes no units (placeInRack refuses it): offered
    // here, it would be a choice the button always turns down. One goes in a
    // rack by running on a device that is in it.
    const rank = (d) => { const i = RP_TYPE_ORDER.indexOf(d.type); return i < 0 ? RP_TYPE_ORDER.length : i; };
    // Nor a cloud: it stands for a network outside, never a box on rails.
    const defs = paletteDefs.filter((d) => !isVirtualType(d.type) && d.type !== 'cloud').map((d, i) => ({ d, i }))
        .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map(({ d }) => d);
    const types = defs.map((d) => `<option value="${d.type}">${escapeHtml(d.name)}</option>`).join('');
    // A server is what most often goes in a rack; after that, the type last made.
    if (rpEl('rackPlaceType').dataset.options !== types) {
        rpEl('rackPlaceType').innerHTML = types;
        rpEl('rackPlaceType').dataset.options = types;
        rpEl('rackPlaceType').value = 'server';
        rpEl('rackPlaceTypes').innerHTML = defs.map((d) => `<button type="button" class="rkp-type" role="radio" data-type="${d.type}" aria-checked="false">${rvIcon(d.type, 20)}<span>${escapeHtml(rvTypeName(d.type))}</span></button>`).join('');
    }
    // From the map first when devices of this rack are waiting for units.
    _rp.tab = placeCandidates(rack).some((c) => c.rank === 0 && !isVirtualType(c.node.type)) ? 'map' : 'new';
    renderPlaceDialog();
    const scrim = rpEl('rackPlaceDialog');
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onClose: () => { _rp.req = null; } });
    else scrim.hidden = false;
    // Typing finds a device; on a phone a keyboard sliding up over the list
    // would hide it, so the list is what shows first there. On New device the
    // type picked has the focus, so Enter adds it.
    if (!rvPhone()) {
        if (_rp.tab === 'map') rpEl('rackPlaceFilter').focus();
        else { const on = rpEl('rackPlaceTypes').querySelector('[aria-checked="true"]'); if (on) on.focus(); }
    }
    return true;
}

// Full depth, the default, unless the units the fields say are free on this
// face only (behind a half-depth device on the other one): then half depth,
// which is the only thing that fits there. Worked out again as the lowest
// unit, height or face change, until the box is ticked or unticked by hand
// (depthSaid): from then on it says what the user said. Worked out, it is a
// new device's depth only: one already on the map keeps its own (placeDepth),
// as it does dragged in from the lists, or a half-depth PDU picked on units
// free on both faces came out full depth, its owner's setting lost.
function placeDialogDepth(rack) {
    if (_rp.depthSaid) return;
    const span = placeDialogSpan();
    if (span.u === undefined || !span.height) return;
    rpEl('rackPlaceFull').checked = !(!rackSpanCheck(rack, span.face, span.u, span.height, null, state.nodes, true).ok
        && rackSpanCheck(rack, span.face, span.u, span.height, null, state.nodes, false).ok);
}

function closePlaceDialog() {
    const scrim = rpEl('rackPlaceDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
    _rp.req = null;
}

// The span the fields say: { u, height, face, full, said }, with u or height
// undefined where they are not whole numbers. full is the Full depth box: a
// new device's depth, and, once the box was changed by hand (said), the
// depth whatever is picked goes in at, a device already on the map included.
// u is stored-style, the lowest unit counted from the bottom, whatever the
// rack's numbering (the field says the printed start: rackUnitFromNo).
function placeDialogSpan() {
    const rack = _rp.req && groupById(_rp.req.rackId);
    const no = asUnits(rpEl('rackPlaceU').value), height = asUnits(rpEl('rackPlaceHeight').value);
    const u = no === undefined ? undefined : !rackTopDown(rack) ? no : height ? rackUnitFromNo(rack, no, height) : undefined;
    return { u, height, face: rpEl('rackPlaceFace').value === 'rear' ? 'rear' : 'front', full: rpEl('rackPlaceFull').checked, said: _rp.depthSaid };
}

// The depth a device on the map goes in at from the dialog: the box's once it
// was changed by hand; else its own, or half where only one face is free
// there (rvFitDepth, as a drag in from the lists). -> { ok, full }: full a
// boolean to write, or undefined to keep the device's own.
function placeDepth(rack, span, node) {
    if (span.said) return { ok: rackSpanCheck(rack, span.face, span.u, span.height, node.id, state.nodes, span.full).ok, full: span.full };
    return rvFitDepth(rack, node, { lo: span.u, h: span.height, face: span.face });
}

// The devices that can go in, in the order the dialog lists them.
// -> [{ node, rank }], rank 0 this rack's, 1 in no group, 2 in another group.
function placeCandidates(rack, text = '') {
    const q = String(text).trim().toLowerCase();
    const rank = (n) => (n.group === rack.id ? 0 : !groupOfNode(n) ? 1 : 2);
    return state.nodes
        .filter((n) => n && !(n.group === rack.id && Number.isInteger(n.rackU)))
        .filter((n) => !q || [rvName(n), n.type, rvTypeName(n.type), ...getValidIps(n).map((p) => p.ip.toString())]
            .some((v) => String(v).toLowerCase().includes(q)))
        .map((node) => ({ node, rank: rank(node) }))
        .sort((a, b) => a.rank - b.rank || rvByName(a.node, b.node));
}

function renderPlaceDialog() {
    const rack = _rp.req && groupById(_rp.req.rackId);
    if (!rack) return;
    const span = placeDialogSpan();
    const filter = rpEl('rackPlaceFilter').value;
    // The check and the list's rows are one lookup pass (js/model.js): each
    // candidate asks for its addresses and whether its depth fits. Strings
    // only; the dialog is written after it.
    const { msg, ok, html, waiting } = withLookupPass(() => {
        let msg = '', ok = false;
        if (span.u === undefined || !span.height) msg = t(rackTopDown(rack) ? 'Give the top unit and the height as whole numbers.' : 'Give the lowest unit and the height as whole numbers.');
        else {
            const chk = rackSpanCheck(rack, span.face, span.u, span.height, null, state.nodes, span.full);
            ok = chk.ok;
            if (!ok) msg = rackRefusal(rack, chk);
            else msg = t('Goes in {span}.', { span: `${rvSpanText(rack, span.u, span.u + span.height - 1, span.face)}, ${t(span.full ? 'full depth' : 'half depth')}` });
        }
        // Units are not a VM's or a container's to take: they go onto a host.
        const list = placeCandidates(rack, filter).filter((c) => !isVirtualType(c.node.type));
        const heads = ['In this rack, not placed yet', 'In no group', 'In another group: placing it here moves it'];
        let last = -1;
        const rows = list.slice(0, RP_LIST_MAX).map(({ node: n, rank }) => {
            // A device that is the one in the way is still offered: placed
            // elsewhere in this rack it is not listed, so the check is on others.
            const fit = placeDepth(rack, span, n);
            const fits = ok && fit.ok;
            const head = rank !== last ? `<li class="rkp-head">${escapeHtml(t(heads[rank]))}</li>` : '';
            last = rank;
            // The message under the fields is a new device's depth: a device that
            // would go in at half depth where that says full says so on its row.
            const half = !span.said && fits && span.full && (fit.full === false || !rackFullDepth(n)) ? t('half depth') : '';
            const where = rank === 2 ? nodePlaceText(n) : '';
            return `${head}<li><button type="button" class="rkp-item" data-node="${escapeHtml(n.id)}"${fits ? '' : ' disabled'}>${rvIcon(n.type, 16)}
                <span class="rkp-name">${escapeHtml(rvName(n))}</span>
                <span class="rkp-meta">${escapeHtml([rvTypeName(n.type), half, where].filter(Boolean).join(' · '))}</span></button></li>`;
        }).join('');
        const more = list.length > RP_LIST_MAX ? `<li class="rkp-more">${escapeHtml(t('…and {n} more. Narrow the filter to see them.', { n: list.length - RP_LIST_MAX }))}</li>` : '';
        // The tab's count: this rack's own devices waiting for units.
        const waiting = list.filter((c) => c.rank === 0).length;
        return { msg, ok, html: rows + more || `<li class="rkp-more">${escapeHtml(t('No device matches.'))}</li>`, waiting };
    });
    const err = rpEl('rackPlaceMsg');
    err.textContent = msg;
    err.classList.toggle('rkp-bad', !ok);
    // Units that do not fit are the first thing to fix: the fields show.
    if (!ok) rpEl('rackPlaceWhere').open = true;
    // The tabs, the type picked, and Add named after it.
    ['new', 'map'].forEach((tab) => {
        const btn = rpEl(tab === 'new' ? 'rackPlaceTabNew' : 'rackPlaceTabMap');
        btn.classList.toggle('active', _rp.tab === tab);
        btn.setAttribute('aria-selected', String(_rp.tab === tab));
        rpEl(tab === 'new' ? 'rackPlaceNewPane' : 'rackPlaceMapPane').hidden = _rp.tab !== tab;
    });
    const type = rpEl('rackPlaceType').value;
    rpEl('rackPlaceTypes').querySelectorAll('.rkp-type').forEach((b) => {
        const on = b.dataset.type === type;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
    });
    rpEl('rackPlaceNewBtn').textContent = t('Add {type}', { type: rvTypeName(type) });
    rpEl('rackPlaceNewBtn').hidden = _rp.tab !== 'new';
    rpEl('rackPlaceList').innerHTML = html;
    rpEl('rackPlaceMapCount').textContent = waiting ? String(waiting) : '';
    rpEl('rackPlaceMapCount').title = waiting ? t('In this rack, not placed yet') : '';
    rpEl('rackPlaceNewBtn').disabled = !ok;
}

function pickInPlaceDialog(pick) {
    const req = _rp.req;
    if (!req) return null;
    const span = placeDialogSpan();
    if (span.u === undefined || !span.height) return null;
    // A device on the map: its own depth, unless the box was changed by hand.
    const existing = pick.nodeId ? getNode(pick.nodeId) : null;
    const rack = groupById(req.rackId);
    const full = existing && isRackGroup(rack) ? placeDepth(rack, span, existing).full : span.full;
    const node = placeInRack(req.rackId, { u: span.u, height: span.height, face: span.face, full }, pick);
    if (node) closePlaceDialog();
    else renderPlaceDialog();
    return node;
}

(function wireRackView() {
    const view = rackViewEl();
    if (!view) return;
    _rv.zoom = rvLoadZoom();
    _rv.cables = rvLoadCables();
    view.addEventListener('click', onRackClick);
    view.addEventListener('keydown', onRackKey);
    view.addEventListener('pointerdown', onRackPointerDown);
    window.addEventListener('pointermove', onRackPointerMove);
    window.addEventListener('pointerup', onRackPointerUp);
    window.addEventListener('pointercancel', (e) => { if (_rv.drag && e.pointerId === _rv.drag.pointerId) endRackGesture(); });
    // Pointed at with a mouse or a pen, or focused: a line, a label or a
    // device lights its cables (rvSetHot). A finger has no hover: a tap
    // selects, and the selection lights them.
    view.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'touch' || _rv.drag) return;
        const hot = rvHotOf(e.target, e);
        if (!rvSameHot(hot, _rv.hot)) rvSetHot(hot);
        // A port pointed at shows its tip; off it, a pointer's tip goes (a
        // tapped one stays until a tap elsewhere).
        // A no-port spot shows its tip the same way; its Pick a port buttons
        // are a click's (the spot's tap pins the tip so they can be reached).
        const port = e.target.closest ? e.target.closest('.rk-port, .rk-noport') : null;
        const box = port && port.closest('.rk-dev');
        const tip = _rv.portTip;
        const pid = port && (port.classList.contains('rk-noport') ? RV_NOPORT : port.dataset.port);
        if (port && box) {
            if (!tip || tip.node !== box.dataset.node || tip.port !== pid) {
                if (!(tip && tip.how === 'pin' && tip.port === RV_NOPORT)) rvShowPortTip(box.dataset.node, pid, 'hover');
            }
        } else if (tip && tip.how === 'hover' && !(e.target.closest && e.target.closest('.rk-ptip'))) rvHidePortTip();
    });
    // On and off a line over a box is no new element pointed at: the move
    // says which, once a frame.
    let moved = null;
    view.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' || _rv.drag) return;
        if (!moved) requestAnimationFrame(() => {
            const m = moved;
            moved = null;
            if (!m || _rv.drag || !m.target.isConnected) return;
            const hot = rvHotOf(m.target, m);
            if (!rvSameHot(hot, _rv.hot)) rvSetHot(hot);
        });
        moved = { target: e.target, clientX: e.clientX, clientY: e.clientY };
    });
    view.addEventListener('pointerleave', () => {
        moved = null;
        if (_rv.hot) rvSetHot(null);
        if (_rv.portTip && _rv.portTip.how === 'hover') rvHidePortTip();
    });
    // The units' pane scrolled: a pointer's tip goes, a tapped one follows
    // its port (or goes, scrolled out of the pane).
    view.addEventListener('scroll', () => {
        const tip = _rv.portTip;
        if (!tip) return;
        if (tip.how !== 'pin') { rvHidePortTip(); return; }
        const el = view.querySelector(`.rk-dev[data-node="${CSS.escape(tip.node)}"] ${tip.port === RV_NOPORT ? '.rk-noport' : `.rk-port[data-port="${CSS.escape(tip.port)}"]`}`);
        const pane = rvPane();
        const r = el && el.getBoundingClientRect(), p = pane && pane.getBoundingClientRect();
        if (!r || !p || r.bottom < p.top || r.top > p.bottom) rvHidePortTip();
        else rvShowPortTip(tip.node, tip.port, 'pin');
    }, true);
    view.addEventListener('focusin', (e) => { const hot = rvHotOf(e.target); if (!rvSameHot(hot, _rv.hot)) rvSetHot(hot); });
    view.addEventListener('focusout', (e) => { if (!view.contains(e.relatedTarget) && _rv.hot) rvSetHot(null); });
    // The faces change size without a rebuild (the window, the rail, a phone
    // turned): the lines are drawn again to meet the boxes where they are now.
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => {
            const faces = view.querySelector('.rk-faces');
            if (!faces || !rackShown() || _rv.drag) return;
            const r = faces.getBoundingClientRect();
            if (`${Math.round(r.width)}x${Math.round(r.height)}` !== _rv.drawnAt) rvDrawCables();
        }).observe(rvEl('rackBody'));
    }
    // A device's box is a button: no native drag of it, no menu from a long press.
    view.addEventListener('dragstart', (e) => e.preventDefault());
    rvEl('rackPicker').addEventListener('change', (e) => { _rv.rackId = e.target.value || null; renderRackView(true); });
    // Size: the rack's size fields, open or shut (a view), each change
    // answered as the Groups tab answers it (onRackSizeField, js/groups.js).
    rvEl('rackSizeBtn').addEventListener('click', () => { _rv.sizeOpen = !_rv.sizeOpen; renderRackView(true); });
    rvEl('rackSize').addEventListener('change', (e) => {
        const el = e.target.closest('[data-field]');
        if (el && RACK_SIZE_KEYS.includes(el.dataset.field)) onRackSizeField(el);
    });
    // Other devices' filter redraws its list only, so the field keeps the
    // focus and the caret; open or shut, it stays so across redraws.
    view.addEventListener('input', (e) => {
        if (!e.target.hasAttribute('data-rk-filter')) return;
        _rv.othersFilter = e.target.value;
        const rack = currentRack(), list = view.querySelector('.rk-others-list');
        if (rack && list) list.innerHTML = rackOthersItems(rack, typeof _queryLastMap !== 'undefined' ? _queryLastMap : null);
    });
    view.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('rk-others')) _rv.othersOpen = e.target.open; }, true);

    const dlg = rpEl('rackPlaceDialog');
    // The span's fields work the depth out again first (placeDialogDepth);
    // the box itself, changed by hand, keeps what it says from then on.
    ['rackPlaceU', 'rackPlaceHeight', 'rackPlaceFace', 'rackPlaceFull', 'rackPlaceFilter'].forEach((id) => {
        const onEdit = () => {
            const rack = _rp.req && groupById(_rp.req.rackId);
            if (id === 'rackPlaceFull') _rp.depthSaid = true;
            else if (id !== 'rackPlaceFilter' && rack) placeDialogDepth(rack);
            renderPlaceDialog();
        };
        rpEl(id).addEventListener('input', onEdit);
        rpEl(id).addEventListener('change', onEdit);
    });
    rpEl('rackPlaceList').addEventListener('click', (e) => {
        const item = e.target.closest('.rkp-item');
        if (item && !item.disabled) pickInPlaceDialog({ nodeId: item.dataset.node });
    });
    rpEl('rackPlaceNewBtn').addEventListener('click', () => pickInPlaceDialog({ type: rpEl('rackPlaceType').value, name: rpEl('rackPlaceName').value }));
    // Enter in the name adds it, as Add does.
    rpEl('rackPlaceName').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!rpEl('rackPlaceNewBtn').disabled) rpEl('rackPlaceNewBtn').click();
    });
    rpEl('rackPlaceTabs').addEventListener('click', (e) => {
        const tab = e.target.closest('[data-rkp-tab]');
        if (!tab) return;
        _rp.tab = tab.dataset.rkpTab;
        renderPlaceDialog();
        if (_rp.tab === 'map') rpEl('rackPlaceFilter').focus();
    });
    // The type grid: a click picks, a double click adds; arrows move the pick
    // as a radio group's do, and Enter adds the one picked.
    const typeGrid = rpEl('rackPlaceTypes');
    const pickType = (type, focus) => {
        rpEl('rackPlaceType').value = type;
        renderPlaceDialog();
        const b = typeGrid.querySelector(`[data-type="${CSS.escape(type)}"]`);
        if (focus && b) b.focus();
    };
    typeGrid.addEventListener('click', (e) => { const b = e.target.closest('.rkp-type'); if (b) pickType(b.dataset.type, true); });
    typeGrid.addEventListener('dblclick', (e) => { if (e.target.closest('.rkp-type') && !rpEl('rackPlaceNewBtn').disabled) rpEl('rackPlaceNewBtn').click(); });
    typeGrid.addEventListener('keydown', (e) => {
        const all = [...typeGrid.querySelectorAll('.rkp-type')];
        const i = all.findIndex((b) => b.dataset.type === rpEl('rackPlaceType').value);
        const cols = Math.max(1, Math.round(typeGrid.clientWidth / ((all[0] && all[0].offsetWidth) || 1)));
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
        if (step) { e.preventDefault(); const n = all[Math.min(all.length - 1, Math.max(0, i + step))]; if (n) pickType(n.dataset.type, true); }
        else if (e.key === 'Enter') { e.preventDefault(); if (!rpEl('rackPlaceNewBtn').disabled) rpEl('rackPlaceNewBtn').click(); }
    });
    // Enter in the filter takes the first device that fits.
    rpEl('rackPlaceFilter').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const first = rpEl('rackPlaceList').querySelector('.rkp-item:not([disabled])');
        if (first) pickInPlaceDialog({ nodeId: first.dataset.node });
    });
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePlaceDialog));
})();
