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
// Cables (step C part 2, drawn on the rack since "Round 2", item 5): each
// pair of this rack's devices with a cable between them is one line from the
// one's box to the other's (the agreed scope: one line per device pair, never
// a port position), run through the cable manager between the faces, "×N"
// when there are several, with the ports at both ends and the cable's label
// or colour on a label at its quieter end (rackCables and rackCableText,
// js/model.js). The rear is drawn as the front's mirror, its numbers on its
// outer rail, so both faces' devices meet the manager on their inner edge.
// A device's cables to devices elsewhere are one stub per far device, run
// out to a chip that names it; past RV_STUB_MAX far devices (an access switch
// cabled to every desk) they are one stub per far group instead, "→ Sales ·
// 26 devices", and past that many groups the smallest share a "+N more"
// (rvStubsShown). A line or its label selects its cables, so the rail shows
// them. With many lines the labels wait to be pointed at or selected; see
// "The cables, drawn on the rack" below. On a phone the manager sits on the
// shown face's side and draws that face's lines.
// A cable is drawn by dragging from a device's plug (the dot on its inner
// side, there on every device, finger-sized) to another device, or with the
// selected device's Cable to… button and then a tap on the other end; either
// way the cable is made like the map's (bindLink picks free ports) in one
// undo step, and selected, so the rail opens on its port picker to change
// them. A device fills the rack's depth unless it is set to one face
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
    wired: null,       // the labels as last drawn, for rvPlaceLabels to move: rvDrawCables
    drawnAt: '',       // the faces' size the cables were last drawn for
    reveal: ''         // a device just tapped, for the rebuild to keep in sight: renderRackView
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
function renderRackView(force) {
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
    const body = rvEl('rackBody');
    renderRackSize(rack, force);
    if (!rack) { body.innerHTML = ''; rvEl('rackCount').textContent = ''; return; }

    const members = rackMembers(rack);
    const placed = members.filter((n) => Number.isInteger(n.rackU));
    // A VM or a container on a host is where its host is, drawn in its box:
    // not a device waiting for units.
    const unplaced = members.filter((n) => !Number.isInteger(n.rackU) && !hostOf(n));
    rvEl('rackCount').textContent = [rackSizeText(rack), devicesText(members.length),
        unplaced.length ? t('{n} not placed', { n: unplaced.length }) : ''].filter(Boolean).join(' · ');
    // Drawn as wide as the rack is against a 19" one (the faces' columns
    // and, on a phone, the frame read --rk-w; css/app.css).
    body.style.setProperty('--rk-w', String(Math.round(rackWidthInches(rack) / 19 * 1000) / 1000));
    body.dataset.width = asRackWidth(rack.width);
    const qm = typeof _queryLastMap !== 'undefined' ? _queryLastMap : null;
    // A Cable to… left waiting on a device that has left the rack, or that is
    // no longer the one selected (the map or the table picked another), is
    // let go.
    if (_rv.cableFrom && (!placed.some((n) => n.id === _rv.cableFrom)
        || !(state.selectedType === 'node' && state.selectedId === _rv.cableFrom))) _rv.cableFrom = null;
    view.classList.toggle('rk-arming', !!_rv.cableFrom);
    // The units scroll in a pane of their own, so the selected device's
    // buttons and the list beside them stay in sight however far down the
    // rack it is (on a phone, above and below the rack). A rebuild keeps
    // where that pane was scrolled to, unless it is another rack now.
    const was = body.querySelector('.rk-main');
    const scroll = was && body.dataset.rack === rack.id ? was.scrollTop : 0;
    body.dataset.rack = rack.id;
    // Front, the cable manager, rear: the manager is between the faces, as the cables
    // are between the devices' fronts and backs.
    body.innerHTML = `<div class="rk-main"><div class="rk-faces">${rackFaceHtml(rack, 'front', placed, qm)}${rackLaneHtml(rack)}${rackFaceHtml(rack, 'rear', placed, qm)}<div class="rk-wiring"></div></div></div>
        <aside class="rk-side">${rackSelBarHtml(rack)}${rackUnplacedHtml(rack, unplaced, qm)}${rackOthersHtml(rack, qm)}</aside>`;
    // The cables are drawn over the boxes once they are laid out.
    rvDrawCables();
    if (scroll) body.querySelector('.rk-main').scrollTop = scroll;
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
    if (refocus) { const again = view.querySelector(refocus); if (again) again.focus(); }
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
    if (el.classList.contains('rk-lbl')) return `.rk-lbl[data-key="${CSS.escape(el.dataset.key || '')}"]`;
    if (el.dataset.rk) return `[data-rk="${CSS.escape(el.dataset.rk)}"]${node}`;
    if (el.hasAttribute('data-rk-filter')) return '[data-rk-filter]';
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
    const cls = ['rk-dev', back ? 'rk-back' : '', layer ? `rk-${layer}` : '', sel ? 'rk-sel' : '', outside || clash ? 'rk-bad' : '', status ? `rk-${status}` : '',
        armed ? 'rk-armed' : '', qm && !qm.nodes.has(n.id) && !guests.some((g) => qm.nodes.has(g.id)) ? 'q-dim' : '',
        guests.length ? 'rk-hosting' : '', guests.length && hi > lo ? 'rk-tall' : ''].filter(Boolean).join(' ');
    const title = [rvName(n), rvTypeName(n.type), rvSpanText(rack, s.lo, s.hi, s.face) + `, ${t(full ? 'full depth' : 'half depth')}`,
        back ? t('Full depth: this is its back. Its front is on the {face}.', { face: t(s.face) }) : '',
        status ? statusName(status) : '',
        outside ? t('{rack} has units 1 to {top}: this is outside it.', { rack: groupLabel(rack), top }) : '',
        clash ? t('It takes units {name} takes too.', { name: rvName(clash) }) : '',
        guests.length ? t('Runs here: {names}', { names: guests.map(rvName).join(', ') }) : '',
        state.readOnly || back ? '' : t('Arrows move it a unit, Shift+arrows change its height, left and right put it on the front or the rear.'),
        state.readOnly ? '' : t('Drag from its dot to another device to cable them.')]
        .filter(Boolean).join('\n');
    return `<button type="button" class="${cls}" data-node="${escapeHtml(n.id)}" style="--u:${lo};--h:${hi - lo + 1}"
        aria-pressed="${sel}" title="${escapeHtml(title)}"${layer === 'under' ? ' tabindex="-1"' : ''}>
        ${rvIcon(n.type, 14)}<span class="rk-name">${escapeHtml(rvName(n))}</span>
        ${guests.length ? `<span class="rk-guests">${guests.map((g) => rvGuestChipHtml(g, n, qm)).join('')}<span class="rk-guest-more" hidden></span></span>` : ''}
        ${status ? `<span class="rk-status">${escapeHtml(statusName(status))}</span>` : ''}
        ${back ? `<span class="rk-status rk-backword">${escapeHtml(t('back'))}</span>` : ''}
        <span class="rk-span">${escapeHtml(rvUnits(rack, s.lo, s.hi))}</span>
        ${sel && !back && !state.readOnly ? `<span class="rk-grip" aria-hidden="true" title="${escapeHtml(t('Drag to make it taller or shorter'))}"></span>` : ''}
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

// The box a device's cables meet in this rack: its own while it is placed,
// or, for a VM or a container, its outermost host's while that one is placed
// here. Null when it has no box here.
function rvDrawnAt(n, rack) {
    if (!n) return null;
    if (Number.isInteger(n.rackU)) return n;
    const h = hostRootOf(n);
    return h && h.group === rack.id && Number.isInteger(h.rackU) ? h : null;
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

// ---- The cables, drawn on the rack (step C part 2; "Round 2", item 5) ----
// A cable is a line from one device's box to the other's, the way it runs in
// a rack: out of the device at its plug (the dot on the box's inner edge),
// across the rail, along the cable manager between the faces, and back into
// the other device. The manager is the column between front and rear (the
// lane of the first build, which held the lines and a stack of labels apart
// from the devices: the owner read it as a list beside the rack, not as
// cables in it). It stays as the channel the lines run in, so there is still
// one place where they gather; the lines themselves now start and end on the
// boxes, so which device a line belongs to is seen, not read off a label.
//
// The lines are one SVG over the whole of front, manager and rear, drawn in
// pixels measured from the boxes after the view is built (rvDrawCables), and
// again when its size changes (a phone turned, the rail opened): the units
// are CSS (--rk-u), so measuring is the one way to meet a box exactly.
// Where each side runs:
//   same face  out to a track in the manager on that face's side, down or up
//              it, back in: shorter runs on the inner tracks, so none crosses
//              another's ends (a greedy pass, shortest first, as before);
//              past the tracks there is room for, they share the outermost,
//              as cables share a manager's finger;
//   front-rear across the middle of the manager, from the front device's
//              plug to the rear device's;
//   full depth a device that fills the depth has a box on both faces, so a
//              cable to a device on one face runs on that face, from its back
//              when that is the face (a server cabled to the switch behind it
//              is a short line on the rear, not one across the rack); two
//              full-depth devices meet on the first one's face;
//   outside    a stub per far device out to a chip that names it, gathered
//              by far group past RV_STUB_MAX (rvStubsShown).
// One line per pair of devices (the agreed scope), drawn thicker and counted
// "×N" for a bundle, in the cable's colour when its cables share one the
// browser knows.
//
// Labels without clutter: while few lines are on show (RV_FEW), each says its
// ports (and the cable's label or colour) beside the manager, as before. With
// more, a line keeps quiet: a bundle shows only its "×N", a single cable
// nothing; its ports come up while it is pointed at (the line, its label, or
// either device), and stay up for the selected device's lines and the
// selected cables, which are lit while the rest step back. Stubs always name
// their far device: that is what they are for. A tap on a line or a label
// selects its cables, so a phone (no hover) reads the ports in the rail;
// a device's lines are tabbed to through their labels once it is selected.
// On a phone, which shows one face, a line to the other face runs out to the
// manager's far edge at the other device's height, labelled with its name.
const RV_FEW = 6;          // lines on show before the labels wait to be asked for
const RV_TRACK_PX = 5;     // between two nested lines in the manager
const RV_LBL_PX = 19;      // between two one-line labels' middles, at least (a label is 17px, a 2px gap)
const RV_LINE_PX = 15;     // a label's line of words; a label is its lines and a 2px border
const RV_LINES_MAX = 3;    // lines a label wraps to before it is cut (a phone's narrow manager)
const RV_STUB_MAX = 4;     // stubs from one device before they gather by far group

// One device's stubs as they are drawn: one per far device while there
// are few; else one per group the far devices are in (those in none
// together), the biggest first, the rest of them in one "+N more". A gathered
// stub has no `far` but `label` and `fars`; its links are all of theirs, so
// its label still selects every cable it stands for.
function rvStubsShown(stubs) {
    const byNode = new Map();
    stubs.forEach((st) => { if (!byNode.has(st.node.id)) byNode.set(st.node.id, []); byNode.get(st.node.id).push(st); });
    const out = [];
    byNode.forEach((list) => {
        if (list.length <= RV_STUB_MAX) { out.push(...list); return; }
        const node = list[0].node;
        const byGroup = new Map();
        list.forEach((st) => {
            const g = groupOfNode(st.far);
            const key = g ? g.id : '';
            if (!byGroup.has(key)) byGroup.set(key, { node, far: null, label: g ? groupLabel(g) : t('Not in a group'), title: g ? groupPath(g) : '', fars: [], links: [] });
            const e = byGroup.get(key);
            e.fars.push(st.far); e.links.push(...st.links);
        });
        const gathered = [...byGroup.values()].sort((a, b) => b.fars.length - a.fars.length);
        if (gathered.length <= RV_STUB_MAX) { out.push(...gathered); return; }
        const keep = gathered.slice(0, RV_STUB_MAX - 1), rest = gathered.slice(RV_STUB_MAX - 1);
        const fars = rest.flatMap((e) => e.fars);
        out.push(...keep, { node, far: null, label: t('+{n} more', { n: fars.length }), title: '', more: true, fars, links: rest.flatMap((e) => e.links) });
    });
    return out;
}

// The faces a pair's two ends meet the manager on: each its own, but a
// device that fills the depth meets the other end on that end's face (its
// back is there), and two that both do meet on the first one's, or on the
// one face a phone shows. -> [face of a, face of b]
function rvSides(a, b, one) {
    const fa = rackFullDepth(a), fb = rackFullDepth(b);
    if (fa && fb) { const s = one || rackFaceOf(a); return [s, s]; }
    if (fa) return [rackFaceOf(b), rackFaceOf(b)];
    if (fb) return [rackFaceOf(a), rackFaceOf(a)];
    return [rackFaceOf(a), rackFaceOf(b)];
}

// What the rack's lines are, before any is placed: which device at each end
// and on which face, the label's words, the colour, and whether it is lit or
// dimmed. shown: the faces on show. Only placed devices have a line (one with
// no unit yet has no place to draw from), and only lines with an end on a
// face on show. Pure but for the selection and the search it reads.
function rvCableItems(rack, shown, qm) {
    const one = shown.length === 1 ? shown[0] : null;
    const { pairs, stubs } = rackCables(rack);
    const items = [];
    // Each end at its box: a guest's at its host's (rvDrawnAt). p.a and p.b
    // are the boxes; ra and rb the devices the cables are on, whose ports
    // the label reads.
    pairs.forEach((pr) => {
        const a = rvDrawnAt(pr.a, rack), b = rvDrawnAt(pr.b, rack);
        if (!a || !b || a === b) return;
        const [sa, sb] = rvSides(a, b, one);
        if (!shown.includes(sa) && !shown.includes(sb)) return;
        items.push({ kind: 'pair', p: { a, b, ra: pr.a, rb: pr.b, links: pr.links }, links: pr.links, sa, sb });
    });
    rvStubsShown(stubs).forEach((st) => {
        const dn = rvDrawnAt(st.node, rack);
        if (!dn) return;
        const side = rackFullDepth(dn) && one ? one : rackFaceOf(dn);
        if (!shown.includes(side)) return;
        items.push({ kind: 'stub', st, dn, links: st.links, sa: side, sb: side });
    });
    // The quieter end of a pair (the one fewer lines meet) is where its label
    // goes, so a switch with twenty lines is not buried under twenty labels.
    const ends = new Map();
    const count = (n) => ends.set(n.id, (ends.get(n.id) || 0) + 1);
    items.forEach((it) => { if (it.kind === 'pair') { count(it.p.a); count(it.p.b); } else count(it.dn); });
    const okColour = (c) => !!c && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', c);
    items.forEach((it, i) => {
        it.i = i;
        it.key = it.links.map((l) => l.id).join(' ');
        const n = it.links.length;
        it.count = n > 1 ? `×${n}` : '';
        if (it.kind === 'stub' && !it.st.far) {
            // Gathered: the group and how many, the devices in the tooltip.
            const { node, label, fars } = it.st;
            it.from = it.dn; it.side = it.sa; it.ids = [...new Set([it.dn.id, node.id])];
            const guest = node !== it.dn ? `${rvName(node)} ` : '';
            it.text = it.st.more ? `${guest}→ ${label}` : `${guest}→ ${label} · ${devicesText(fars.length)}`;
            const LIST = 12;
            const names = fars.slice(0, LIST).map(rvName).join(', ') + (fars.length > LIST ? ` ${t('…and {n} more.', { n: fars.length - LIST })}` : '');
            it.title = [`${rvEndName(node, it.dn)} → ${it.st.title || label}`, names].join('\n');
        } else if (it.kind === 'stub') {
            const { node, far } = it.st;
            it.from = it.dn; it.side = it.sa; it.ids = [...new Set([it.dn.id, node.id])];
            const where = nodePlaceText(far);
            // From a guest: its name first, so the line out of the host's box
            // says whose cable it is.
            it.text = `${node !== it.dn ? `${rvName(node)} ` : ''}→ ${rvName(far)}${n > 1 ? ` ×${n}` : ''}`;
            it.title = [`${rvEndName(node, it.dn)} → ${rvName(far)}${where ? ` (${where})` : ''}`, ...it.links.map((l) => rvCableLine(l, node))].join('\n');
        } else {
            const { a, b, ra, rb } = it.p;
            it.ids = [...new Set([a.id, b.id, ra.id, rb.id])];
            // An end on a face not on show (a phone) cannot be the label's.
            let quietA = (ends.get(a.id) || 0) <= (ends.get(b.id) || 0);
            if (!shown.includes(it.sa)) quietA = false; else if (!shown.includes(it.sb)) quietA = true;
            it.from = quietA ? a : b; it.side = quietA ? it.sa : it.sb;
            const other = quietA ? b : a, otherSide = quietA ? it.sb : it.sa;
            // The ports are read from the device the cables are on at this
            // end (a guest's, not its host's).
            const at = quietA ? ra : rb;
            const texts = it.links.map((l) => rackCableText(l, at));
            const tags = [...new Set(texts.map((x) => x.label || x.color).filter(Boolean))];
            // To the face a phone does not show: which device, and where.
            const away = shown.includes(otherSide) ? '' : `→ ${rvName(other)} · ${t(otherSide)} · `;
            // A guest at either end is named: the line meets its host's box.
            const guests = [ra !== a ? ra : null, rb !== b ? rb : null].filter(Boolean).map(rvName);
            it.text = `${away}${it.count ? `${it.count} ` : ''}${guests.length ? `${guests.join(' ↔ ')}: ` : ''}${texts.map((x) => x.ports).join(', ')}${tags.length ? ` · ${tags.join(', ')}` : ''}`;
            it.title = [`${rvEndName(ra, a)} ↔ ${rvEndName(rb, b)}`, ...it.links.map((l) => rvCableLine(l, at))].join('\n');
            it.away = !!away;
        }
        const colours = [...new Set(it.links.map((l) => cableOf(l, 'color').trim()).filter(okColour))];
        it.colour = colours.length === 1 ? colours[0] : '';
        it.sel = it.links.some((l) => inSelection('link', l.id)) || it.ids.some((id) => inSelection('node', id));
        it.dim = !!qm && !it.links.some((l) => qm.links.has(l.id));
    });
    return items;
}

// The manager's column, under the lines: a trough with a finger every unit,
// lined up unit for unit with the faces (the same caption above it, the same
// frame padding). The lines and labels are drawn over all three columns, in
// .rk-wiring, by rvDrawCables once the boxes are where they will be.
function rackLaneHtml(rack) {
    const top = rackTop(rack);
    const { pairs, stubs } = rackCables(rack);
    const any = pairs.some((p) => { const a = rvDrawnAt(p.a, rack), b = rvDrawnAt(p.b, rack); return a && b && a !== b; }) || stubs.some((s) => !!rvDrawnAt(s.node, rack));
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

// Lines and labels over the faces, from where the boxes are now. Called after
// every rebuild, and when the faces change size without one.
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
    if (!fr.width || !shown.length) { layer.innerHTML = ''; return; }
    const qm = typeof _queryLastMap !== 'undefined' ? _queryLastMap : null;
    const items = rvCableItems(rack, shown, qm);
    if (!items.length) { layer.innerHTML = ''; return; }

    const lr = laneEl.getBoundingClientRect();
    const L = lr.left - fr.left, R = lr.right - fr.left, W = R - L, M = (L + R) / 2;
    // Where a device meets the manager on a face: its plug, on the inner edge
    // of its box there (its back's, for a full-depth one on the other face).
    // A back drawn as a strip on the outer rail (an overlap) is met at the
    // inner rail instead, at its height.
    const at = new Map();
    const endOf = (n, face) => {
        const k = `${n.id}\u0000${face}`;
        if (at.has(k)) return at.get(k);
        const slots = rvSlotsOf(face);
        const box = slots && slots.offsetParent ? slots.querySelector(`.rk-dev[data-node="${CSS.escape(n.id)}"]`) : null;
        let e = null;
        if (box) {
            const r = box.getBoundingClientRect(), s = slots.getBoundingClientRect();
            const under = box.classList.contains('rk-under');
            const edge = face === 'front' ? (under ? s.right - 6 : r.right) : (under ? s.left + 6 : r.left);
            e = { x: (face === 'front' ? edge - 9 : edge + 9) - fr.left, edge: edge - fr.left, y: r.top + r.height / 2 - fr.top };
        }
        at.set(k, e);
        return e;
    };
    // The y a face not on show would have the device at: the units are the
    // same down both faces, so the shown face's slots say it.
    const yAway = (n) => {
        const slots = rvSlotsOf(shown[0]);
        const s = slots.getBoundingClientRect(), top = rackTop(rack), sp = rackSpanOf(n);
        const lo = Math.min(Math.max(sp.lo, 1), top), hi = Math.max(Math.min(sp.hi, top), lo);
        return s.top - fr.top + (top - (lo + hi) / 2 + 0.5) * (s.height / top);
    };
    items.forEach((it) => {
        if (it.kind === 'stub') { const e = endOf(it.dn, it.sa); it.A = e; return; }
        it.A = shown.includes(it.sa) ? endOf(it.p.a, it.sa) : null;
        it.B = shown.includes(it.sb) ? endOf(it.p.b, it.sb) : null;
        it.yA = it.A ? it.A.y : yAway(it.p.a);
        it.yB = it.B ? it.B.y : yAway(it.p.b);
    });
    const drawn = items.filter((it) => (it.kind === 'stub' ? !!it.A : (it.A || it.B)));

    // Tracks, a side at a time: as many as fit in a little under half the
    // manager, the shortest runs innermost.
    const K = Math.max(1, Math.floor((W * 0.42 - 6) / RV_TRACK_PX));
    const used = { front: 0, rear: 0 };
    const tracks = { front: [], rear: [] };
    drawn.filter((it) => it.kind === 'pair' && it.sa === it.sb)
        .sort((x, y) => Math.abs(x.yA - x.yB) - Math.abs(y.yA - y.yB))
        .forEach((it) => {
            const lo = Math.min(it.yA, it.yB), hi = Math.max(it.yA, it.yB);
            const list = tracks[it.sa];
            let k = 0;
            while (k < K - 1 && (list[k] || []).some(([a, b]) => a <= hi + 6 && lo <= b + 6)) k++;
            (list[k] = list[k] || []).push([lo, hi]);
            it.track = k;
            used[it.sa] = Math.max(used[it.sa], k + 1);
        });
    const trackX = (side, k) => (side === 'rear' ? R - 6 - k * RV_TRACK_PX : L + 6 + k * RV_TRACK_PX);
    // Labels start past their side's tracks (so they do not cover the lines
    // they name), no further than the middle.
    const anchor = {
        front: Math.min(L + 6 + used.front * RV_TRACK_PX + 4, M - 8),
        rear: Math.max(R - 6 - used.rear * RV_TRACK_PX - 4, M + 8)
    };
    let cross = 0;
    drawn.forEach((it) => {
        if (it.kind === 'pair' && it.sa !== it.sb) it.mx = M + ((cross++ % 3) - 1) * RV_TRACK_PX;
    });

    // Which labels show: all while few lines are on show; else the stubs,
    // the lit lines', and a bundle's count. The rest wait for a pointer.
    const few = drawn.length <= RV_FEW;
    drawn.forEach((it) => {
        it.quiet = !few && it.kind === 'pair' && !it.sel && !it.away;
        it.y0 = it.kind === 'stub' ? it.A.y : (it.from === it.p.a ? it.yA : it.yB);
        it.y = it.y0;
        // A quiet single takes no room until it shows: rvPlaceLabels finds
        // it a free height then, among the labels already on show.
        it.fixed = !(it.quiet && !it.count);
        it.ax = anchor[it.side];
        // How wide its words are (a guess from their length), and the
        // count alone, which is all a quiet bundle shows until it is lit.
        // Words wider than the manager (a phone's, about 130px: "→ KVM ·
        // front · 22 ↔ eth0" is the one place a phone shows the far end's
        // port) wrap to a second line, or a third, rather than being cut;
        // the label then takes the manager's width and that much height.
        const words = it.text.length * 6.6 + (it.colour ? 12 : 0) + 12;
        it.need = Math.min(W - 6, words);
        it.lines = Math.max(1, Math.min(RV_LINES_MAX, Math.ceil(words / Math.max(1, W - 14))));
        it.h = it.lines * RV_LINE_PX + 2;
        it.needCount = it.count ? Math.min(it.need, it.count.length * 6.6 + 12) : it.need;
    });
    // Shown labels never on top of each other: down from the top in order,
    // each at least a step below the last (more for a label of two lines),
    // then back up from the bottom if that ran out of rack.
    const placedLbls = drawn.filter((it) => it.fixed).sort((p, q) => p.y0 - q.y0 || p.i - q.i);
    const height = fr.height;
    for (let k = 1; k < placedLbls.length; k++) placedLbls[k].y = Math.max(placedLbls[k].y, placedLbls[k - 1].y + rvLblGap(placedLbls[k - 1], placedLbls[k]));
    const last = placedLbls.length - 1;
    if (last >= 0 && placedLbls[last].y > height - placedLbls[last].h / 2) {
        placedLbls[last].y = height - placedLbls[last].h / 2;
        for (let k = last - 1; k >= 0; k--) placedLbls[k].y = Math.min(placedLbls[k].y, placedLbls[k + 1].y - rvLblGap(placedLbls[k], placedLbls[k + 1]));
    }

    const r1 = (v) => Math.round(v * 10) / 10;
    const svg = [], btns = [];
    const lit = drawn.some((it) => it.sel);
    drawn.forEach((it) => {
        const side = it.side;
        const ax = anchor[side];
        let pts, hit;
        if (it.kind === 'stub') {
            // Out to the chip that names the far device, at the chip's height.
            const sx = side === 'rear' ? ax + 4 : ax - 4;
            pts = [[it.A.x, it.A.y], [sx, it.A.y], [sx, it.y], [ax, it.y]];
            if (Math.abs(it.y - it.A.y) < 0.5) pts = [[it.A.x, it.A.y], [ax, it.A.y]];
            hit = pts.slice();
            hit[0] = [it.A.edge, it.A.y];
        } else {
            const x = it.sa === it.sb ? trackX(it.sa, it.track) : it.mx;
            // An end on the face a phone does not show runs to the manager's
            // far edge, at that device's height: it goes on round the back.
            const farX = (s) => (s === 'rear' ? R + 4 : L - 4);
            const a = it.A ? [it.A.x, it.yA] : [farX(it.sa), it.yA];
            const b = it.B ? [it.B.x, it.yB] : [farX(it.sb), it.yB];
            pts = [a, [x, it.yA], [x, it.yB], b];
            hit = pts.slice();
            if (it.A) hit[0] = [it.A.edge, it.yA];
            if (it.B) hit[3] = [it.B.edge, it.yB];
            it.vx = x;
        }
        const d = rvRoundPath(pts);
        const cls = ['rk-cable', it.sel ? 'rk-wsel' : '', it.dim ? 'q-dim' : '', it.quiet ? 'rk-quiet' : ''].filter(Boolean).join(' ');
        const wcls = ['rk-wire', it.kind === 'stub' ? 'rk-stub' : ''].filter(Boolean).join(' ');
        const style = it.colour ? ` style="stroke:${escapeHtml(it.colour)}"` : '';
        const dot = it.colour ? ` style="fill:${escapeHtml(it.colour)}"` : '';
        const width = r1(1.5 + Math.min(2, Math.log2(it.links.length)));
        const dots = [it.A, it.B].filter(Boolean).map((e) => `<circle class="rk-end" cx="${r1(e.x)}" cy="${r1(e.y)}" r="3"${dot}/>`).join('');
        const key = escapeHtml(it.key);
        svg.push(`<g class="${cls}" data-key="${key}" data-ends="${escapeHtml(it.ids.join(' '))}">
            <path class="${wcls}" d="${d}" stroke-width="${width}"${style}/><path class="rk-lead" d=""${style}/>${dots}
            <path class="rk-hit" d="${rvRoundPath(hit)}" data-key="${key}" data-links="${key}"><title>${escapeHtml(it.title)}</title></path></g>`);
        const lcls = ['rk-lbl', side === 'rear' ? 'rk-lbl-r' : '', it.kind === 'stub' ? 'rk-lbl-stub' : '', it.quiet ? 'rk-quiet' : '', it.lines > 1 ? `rk-l${it.lines}` : '',
            it.sel ? 'rk-wsel' : '', it.dim ? 'q-dim' : ''].filter(Boolean).join(' ');
        const swatch = it.colour ? `<i class="rk-swatch" style="background:${escapeHtml(it.colour)}"></i>` : '';
        btns.push(`<button type="button" class="${lcls}" data-key="${key}" data-links="${key}" data-ends="${escapeHtml(it.ids.join(' '))}"${it.count ? ` data-count="${it.count}"` : ''}
            title="${escapeHtml(it.title)}" aria-label="${escapeHtml(it.title)}">${swatch}<span>${escapeHtml(it.text)}</span></button>`);
    });
    layer.classList.toggle('rk-lit', lit);
    layer.innerHTML = `<svg class="rk-wires" width="${r1(fr.width)}" height="${r1(fr.height)}" viewBox="0 0 ${r1(fr.width)} ${r1(fr.height)}" aria-hidden="true">${svg.join('')}</svg>${btns.join('')}`;
    // The labels' places are set by rvPlaceLabels, here and again whenever
    // what is pointed at changes, from the one set of rules: the leaders and
    // the buttons come out in the order the lines are drawn.
    const leads = layer.querySelectorAll('.rk-lead'), lbls = layer.querySelectorAll('.rk-lbl');
    drawn.forEach((it, j) => { it.lead = leads[j]; it.btn = lbls[j]; });
    _rv.wired = { layer, items: drawn, height, L, R, width: fr.width };
    // The lit lines' devices are marked too, so the two ends of a selected
    // cable are found at a glance.
    faces.querySelectorAll('.rk-dev.rk-cabled').forEach((b) => b.classList.remove('rk-cabled'));
    drawn.filter((it) => it.sel && it.links.some((l) => inSelection('link', l.id))).forEach((it) => it.ids.forEach((id) => {
        faces.querySelectorAll(`.rk-dev[data-node="${CSS.escape(id)}"]`).forEach((b) => b.classList.add('rk-cabled'));
    }));
    if (_rv.hot) rvSetHot(_rv.hot); else rvPlaceLabels();
}

// Where a label sits across the manager: past its side's tracks (so it does
// not cover the lines it names), as wide as its words up to the far edge.
// Past many tracks (a phone's narrow manager) the room left can be too little
// to read a port: the label then starts over the tracks, as far back as its
// words need (the manager's whole width at most), and covers them at its
// height only. -> { left | right, max, lx: its edge toward its line }
function rvLblPos(it, need, w) {
    const { L, R } = w;
    if (it.side === 'rear') {
        const x = it.ax - L - 3 < need ? Math.min(R - 3, L + 3 + need) : it.ax;
        return { right: w.width - x, max: x - L - 3, lx: x };
    }
    const x = R - 3 - it.ax < need ? Math.max(L + 3, R - 3 - need) : it.ax;
    return { left: x, max: R - 3 - x, lx: x };
}
// How far apart two labels' middles have to be: half of each, and a gap.
// A label is { h } (its height); RV_LBL_PX for two of one line.
const rvLblGap = (a, b) => (a.h + b.h) / 2 + (RV_LBL_PX - RV_LINE_PX - 2);
// The nearest height to it.y0 at which a label of its height is clear of
// every one in occ ({ y, h }), inside the faces (height tall); y0 itself
// when there is none (a rack full of labels).
function rvFreeY(it, occ, height) {
    const clamp = (y) => Math.min(Math.max(y, it.h / 2), height - it.h / 2);
    const free = [it.y0, ...occ.flatMap((o) => [o.y - rvLblGap(o, it), o.y + rvLblGap(o, it)])].map(clamp)
        .filter((y) => occ.every((o) => Math.abs(y - o.y) >= rvLblGap(o, it) - 0.01));
    return free.length ? free.reduce((b, y) => (Math.abs(y - it.y0) < Math.abs(b - it.y0) ? y : b)) : it.y0;
}
// The labels' places, from what is lit now. Those on show when the view was
// drawn keep theirs (rvDrawCables stacked them), so nothing already on show
// jumps under the pointer; a quiet single that comes up while pointed at
// takes the free height nearest its line's, so it never lands on another
// label (a server pointed at lights two or three lines at once, and the
// height they share may already hold a bundle's count or a stub's chip). A
// label away from its line, across the tracks or moved up or down, is joined
// to it by a leader, so a bundle's "×2" out by the middle still says whose
// line it counts.
function rvPlaceLabels() {
    const w = _rv.wired;
    if (!w || !w.layer.isConnected) return;
    const r1 = (v) => Math.round(v * 10) / 10;
    const hot = (it) => !!it.btn && it.btn.classList.contains('rk-hot');
    const occ = w.items.filter((it) => it.fixed);
    w.items.filter((it) => !it.fixed).sort((p, q) => p.y0 - q.y0 || p.i - q.i).forEach((it) => {
        it.y = hot(it) ? rvFreeY(it, occ, w.height) : it.y0;
        if (hot(it)) occ.push(it);
    });
    w.items.forEach((it) => {
        if (!it.btn) return;
        const words = !it.quiet || hot(it);
        const pos = rvLblPos(it, words ? it.need : it.needCount, w);
        const st = it.btn.style;
        st.top = `${r1(it.y)}px`;
        st.left = pos.left == null ? '' : `${r1(pos.left)}px`;
        st.right = pos.right == null ? '' : `${r1(pos.right)}px`;
        st.maxWidth = `${r1(pos.max)}px`;
        let d = '';
        if (it.kind === 'pair' && it.vx != null && (it.fixed || hot(it))) {
            const across = it.side === 'rear' ? pos.lx < it.vx - 3 : pos.lx > it.vx + 3;
            if (across) d = `M ${r1(it.vx)} ${r1(it.y0)} L ${r1(pos.lx)} ${r1(it.y)}`;
            else if (Math.abs(it.y - it.y0) > 1) d = `M ${r1(it.vx)} ${r1(it.y0)} L ${r1(it.vx)} ${r1(it.y)}`;
        }
        if (it.lead) it.lead.setAttribute('d', d);
    });
}

// Pointed at: a line (its key) or a device (its id). Its lines are lit and
// their labels show, the devices at their ends are marked, the rest step
// back. Classes only: nothing is rebuilt under the pointer. null lets go.
function rvSetHot(hot) {
    _rv.hot = hot;
    const view = rackViewEl();
    const layer = view && view.querySelector('.rk-wiring');
    if (!layer) return;
    view.querySelectorAll('.rk-hot').forEach((el) => el.classList.remove('rk-hot'));
    if (!hot) { layer.classList.remove('rk-hotting'); rvPlaceLabels(); return; }
    const lines = [...layer.querySelectorAll('.rk-cable, .rk-lbl')].filter((el) =>
        (hot.key && el.dataset.key === hot.key) || (hot.node && String(el.dataset.ends || '').split(' ').includes(hot.node)));
    lines.forEach((el) => el.classList.add('rk-hot'));
    layer.classList.toggle('rk-hotting', lines.length > 0);
    const ends = new Set(lines.flatMap((el) => String(el.dataset.ends || '').split(' ').filter(Boolean)));
    if (hot.key) ends.forEach((id) => view.querySelectorAll(`.rk-dev[data-node="${CSS.escape(id)}"]`).forEach((b) => b.classList.add('rk-hot')));
    rvPlaceLabels();
}
// What a pointer or the focus is on, as rvSetHot takes it: a line or its
// label, or a device box. null for anything else.
function rvHotOf(target) {
    const el = target && target.closest ? target.closest('.rk-hit, .rk-lbl, .rk-dev') : null;
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
    const near = [...svg.querySelectorAll('.rk-hit')].filter((h) => h.isPointInStroke(pt));
    if (near.length < 2) return hit;
    for (let w = 1; w <= 24; w++) {
        const at = near.filter((h) => { h.style.strokeWidth = `${w}px`; const yes = h.isPointInStroke(pt); h.style.strokeWidth = ''; return yes; });
        if (at.length) return at[at.length - 1];
    }
    return hit;
}
const rvSameHot = (a, b) => (!a && !b) || (!!a && !!b && a.key === b.key && a.node === b.node);
// One cable of a line, for its tooltip: "eth0 ↔ Gi0/2 · C-12 · blue · 3 m".
function rvCableLine(link, from) {
    const x = rackCableText(link, from);
    return [x.ports, x.label, x.color, cableOf(link, 'length').trim()].filter(Boolean).join(' · ');
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
    return `<section class="rk-selbar" aria-label="${escapeHtml(rvName(one))}">
        <div class="rk-selname">${rvIcon(one.type, 16)}<span class="rk-name">${escapeHtml(rvName(one))}</span>
            <span class="rk-span">${escapeHtml(rvSpanText(rack, s.lo, s.hi, s.face))}</span></div>
        <div class="rk-selacts">
            ${btn('up', 'Up one unit', '▲')}${btn('down', 'Down one unit', '▼')}
            ${btn('taller', 'One unit taller', '+1U')}${btn('shorter', 'One unit shorter', '−1U')}
            ${btn('face', other === 'rear' ? 'To the rear' : 'To the front', escapeHtml(t(other === 'rear' ? 'To the rear' : 'To the front')))}
            <button type="button" class="cs-btn${full ? ' active' : ''}" data-rk="depth" data-node="${id}" aria-pressed="${full}"
                title="${escapeHtml(t(full ? 'Make it half depth: it takes its units on one face' : 'Make it full depth: it takes its units on both faces'))}"${dis}>${escapeHtml(t('Full depth'))}</button>
            ${btn('cable', arming ? 'Stop: no cable' : 'Cable it to another device: tap the other end next',
                escapeHtml(t(arming ? 'Cancel cable' : 'Cable to…')), arming ? ' active' : '')}
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
function rackOthersItems(rack, qm) {
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
function createRackCable(fromId, toId) {
    _rv.cableFrom = null;
    if (readOnlyRefuses()) return null;
    const a = getNode(fromId), b = getNode(toId);
    if (!a || !b || a.id === b.id) { renderRackView(true); return null; }
    let link = { id: nextId('l'), source: a.id, target: b.id, attachment: (isVirtualType(a.type) || isVirtualType(b.type)) ? 'bridged' : null };
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
        if (before) showToast(t('{a} and {b} were already cabled: this is cable {n} between them. Undo takes it back.', { a: rvName(a), b: rvName(b), n: before + 1 }));
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
        if (!node) node = spawnNodeNow(pick.type, rackDropPoint(rack) ? { at: rackDropPoint(rack) } : {});
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
    if (d.kind === 'cable') {
        if (!d.moved && !far) return;
        d.moved = true;
        e.preventDefault();
        rvCableDrag(d, e.clientX, e.clientY);
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
    if (d.kind === 'cable') rvCableDragEnd(d);
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
    if (view) view.querySelectorAll('.rk-target').forEach((el) => el.classList.remove('rk-target'));
    if (d.el) d.el.classList.remove('rk-armed');
}

function onRackClick(e) {
    if (_rv.pendingPlace) {
        const req = _rv.pendingPlace;
        _rv.pendingPlace = null;
        openPlaceDialog(req);
        return;
    }
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
        rackStep(node, act.dataset.rk);
        return;
    }
    const face = e.target.closest('#rackFaceSwitch [data-face]');
    if (face) { _rv.face = face.dataset.face === 'rear' ? 'rear' : 'front'; renderRackView(true); return; }
    // A line, or its label: its cables.
    let lbl = e.target.closest('.rk-lbl, .rk-hit');
    if (lbl && lbl.classList.contains('rk-hit')) lbl = rvNearestHit(lbl, e);
    if (lbl) { rvSelectCables(e, String(lbl.dataset.links || '').split(' ').filter(Boolean)); return; }
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
// one from the keyboard); its fields change them. The list is every device
// not already placed in this rack: this rack's own first, then devices in no
// group, then those in another group (placing one moves it here). A new
// device of a type is made here instead with Create here.
const _rp = { req: null, depthSaid: false };
const rpEl = (id) => document.getElementById(id);
const RP_LIST_MAX = 120;

function openPlaceDialog(req) {
    if (readOnlyRefuses()) return false;
    const rack = groupById(req && req.rackId);
    if (!isRackGroup(rack)) return false;
    _rp.req = { rackId: rack.id };
    rpEl('rackPlaceTitle').textContent = t('Place a device in {rack}', { rack: groupLabel(rack) });
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
    // A VM or a container takes no units (placeInRack refuses it): offered
    // here, it would be a choice the button always turns down. One goes in a
    // rack by running on a device that is in it.
    const types = paletteDefs.filter((d) => !isVirtualType(d.type)).map((d) => `<option value="${d.type}">${escapeHtml(d.name)}</option>`).join('');
    // A server is what most often goes in a rack; after that, the type last made.
    if (rpEl('rackPlaceType').dataset.options !== types) {
        rpEl('rackPlaceType').innerHTML = types;
        rpEl('rackPlaceType').dataset.options = types;
        rpEl('rackPlaceType').value = 'server';
    }
    renderPlaceDialog();
    const scrim = rpEl('rackPlaceDialog');
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onClose: () => { _rp.req = null; } });
    else scrim.hidden = false;
    // Typing finds a device; on a phone a keyboard sliding up over the list
    // would hide it, so the list is what shows first there.
    if (!rvPhone()) rpEl('rackPlaceFilter').focus();
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
    let msg = '', ok = false;
    if (span.u === undefined || !span.height) msg = t(rackTopDown(rack) ? 'Give the top unit and the height as whole numbers.' : 'Give the lowest unit and the height as whole numbers.');
    else {
        const chk = rackSpanCheck(rack, span.face, span.u, span.height, null, state.nodes, span.full);
        ok = chk.ok;
        if (!ok) msg = rackRefusal(rack, chk);
        else msg = t('Goes in {span}.', { span: `${rvSpanText(rack, span.u, span.u + span.height - 1, span.face)}, ${t(span.full ? 'full depth' : 'half depth')}` });
    }
    const err = rpEl('rackPlaceMsg');
    err.textContent = msg;
    err.classList.toggle('rkp-bad', !ok);
    // Units are not a VM's or a container's to take: they go onto a host.
    const list = placeCandidates(rack, rpEl('rackPlaceFilter').value).filter((c) => !isVirtualType(c.node.type));
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
    rpEl('rackPlaceList').innerHTML = rows + more || `<li class="rkp-more">${escapeHtml(t('No device matches.'))}</li>`;
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
        const hot = rvHotOf(e.target);
        if (!rvSameHot(hot, _rv.hot)) rvSetHot(hot);
    });
    view.addEventListener('pointerleave', () => { if (_rv.hot) rvSetHot(null); });
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
    rpEl('rackPlaceNewBtn').addEventListener('click', () => pickInPlaceDialog({ type: rpEl('rackPlaceType').value }));
    // Enter in the filter takes the first device that fits.
    rpEl('rackPlaceFilter').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const first = rpEl('rackPlaceList').querySelector('.rkp-item:not([disabled])');
        if (first) pickInPlaceDialog({ nodeId: first.dataset.node });
    });
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePlaceDialog));
})();
