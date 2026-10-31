// ---- The Groups tab: where devices sit (doc.groups, js/model.js "Groups") ----
// One card per group, in tree order and indented by depth: a building, the
// floors in it, the rooms on them, the racks in those, and groups of the
// user's own. Each says its kind, how many devices are in it and below it,
// and offers Select members, Collapse on map (js/groupmap.js), Open rack on
// a rack (the rack view, js/rackview.js), Edit (name, kind, parent, and a
// rack's size: see "A rack's size" below), + Inside (a group within this
// one) and Delete. Every change is one undo step, through batch() and save()
// like any other edit.
//
// Its plain words are translated (MESSAGES, js/i18n.js): "Groups", "Building",
// "Room"... are not the technical vocabulary the full editor keeps in English
// (Subnets, VLAN, Gateway). "U", the rack unit, is, and stays as it is.
//
// A register that kept places as free text before groups existed ("Building
// A / Server room / Rack 3" in each device's Location) is offered Make groups
// from locations, once, while it has no groups: the tree is read out of the
// text, previewed, and made in one undo step (planGroupsFromLocations).
//
// The device editor's Group picker lives here too (renderGroupPicker): which
// group a device is in and, in a rack, its lowest unit, its height and its
// face. The Asset group (js/assets.js) asks for it whenever it fills in.
//
// The panel is rebuilt from the document after anything changes, as the
// Subnets tab is, with the same two exceptions: hidden, it only notes that it
// is out of date; with the focus in one of its fields, it waits until the
// focus leaves, so a rebuild cannot take the field away from the person
// typing in it.
// Load order: ... share -> networks -> groups -> groupmap -> table -> ... -> assets -> app

let _grpPanelDirty = true;
const _grpEditOpen = new Set();   // groups whose edit fields are open, this session

const grpPanel = () => document.getElementById('cfgPanel-groups');
const grpPanelShown = () => { const p = grpPanel(); return !!p && !p.classList.contains('hidden') && !isReduced(); };
// Nested deeper than this, the cards stop stepping right: the rail is 340px.
const GROUP_INDENT_MAX = 5;

// How a nested group is marked in a <select>: a closed select shows the
// chosen option's text as it is, so a run of spaces per level read as a blank
// gap before "Rack 3". One corner per nested group, stepped right by a narrow
// space per level beyond the first, keeps the tree readable when the list is
// open and the gap small when it is shut (the full path is shown under the
// device editor's picker). Non-breaking: an option's text drops plain spaces.
const groupOptionIndent = (depth) => (depth > 0 ? '\u2002'.repeat(depth - 1) + '\u2514\u00a0' : '');

// The kind a group made inside another one most likely is, so a building's
// + Inside starts as a floor; the kind is one change away when it is not.
const CHILD_KIND = { building: 'floor', floor: 'room', room: 'rack', rack: 'custom', custom: 'custom' };

// How many devices each group holds itself (own) and with everything below
// it (deep), from one walk of the devices.
function groupCounts(groups = state.groups, nodes = state.nodes) {
    const own = new Map(), deep = new Map();
    const byId = new Map(groups.map((g) => [g.id, g]));
    nodes.forEach((n) => {
        if (!n || !n.group || !byId.has(n.group)) return;
        own.set(n.group, (own.get(n.group) || 0) + 1);
        const seen = new Set();
        for (let g = byId.get(n.group); g && !seen.has(g.id); g = byId.get(g.parent)) {
            seen.add(g.id);
            deep.set(g.id, (deep.get(g.id) || 0) + 1);
        }
    });
    return { own, deep };
}

function renderGroupsPanel(force) {
    const panel = grpPanel();
    if (!panel) return;
    if (!grpPanelShown()) { _grpPanelDirty = true; return; }
    const active = document.activeElement;
    if (!force && active && panel.contains(active) && active.matches('input, select, textarea')) { _grpPanelDirty = true; return; }
    _grpPanelDirty = false;

    // A rebuild replaces the buttons and fields: the one that had the focus
    // gets it back (a re-parent moves its card, and the select with it).
    const d = active && panel.contains(active) && active.dataset;
    // Escaped: a group id is any text a file or a CSV gave it (asGroupRef).
    const refocus = d && d.grp ? (d.act ? `[data-act="${CSS.escape(d.act)}"][data-grp="${CSS.escape(d.grp)}"]`
        : d.field ? `[data-field="${CSS.escape(d.field)}"][data-grp="${CSS.escape(d.grp)}"]` : null) : null;

    const list = document.getElementById('groupList');
    const tree = groupTree();
    const counts = groupCounts();
    list.innerHTML = tree.length ? tree.map((e) => groupCardHtml(e, counts, tree)).join('')
        : `<p class="rail-note">${escapeHtml(t('No groups yet. Add a building, a room or a rack with + Group, then put devices in it from their Asset section.'))}</p>`
            + (locationsToGroup().length ? `<div class="grp-from-loc">
                <p class="rail-note">${escapeHtml(t('Some devices have a location typed in. Topo can read the groups out of it: "Building A / Server room / Rack 3" becomes three groups, one inside the other.'))}</p>
                <button type="button" class="btn" data-act="from-locations">${escapeHtml(t('Make groups from locations'))}</button>
            </div>` : '');

    if (refocus) { const again = panel.querySelector(refocus); if (again) again.focus(); }
}

const devicesText = (n) => t(n === 1 ? '{n} device' : '{n} devices', { n });

function groupCardHtml({ group: g, depth }, counts, tree = groupTree()) {
    const id = escapeHtml(g.id);
    const open = _grpEditOpen.has(g.id);
    const deep = counts.deep.get(g.id) || 0, own = counts.own.get(g.id) || 0;
    const rack = isRackGroup(g);
    // Collapsed on the map (js/groupmap.js): the map's ▾ from the keyboard,
    // and on a phone a bigger target than the tab's.
    const collapsed = isGroupCollapsed(g.id);
    const kind = groupKindName(g.kind) + (rack ? ` · ${rackSizeText(g)}` : '');
    // "5 devices · 2 here": only when it holds some itself and some are in
    // groups below. A building that holds nobody directly just counts.
    const count = deep ? devicesText(deep) + (own && own !== deep ? ` · ${t('{n} here', { n: own })}` : '') : t('No devices in it yet.');
    // Not itself, and nothing below it: that would be a loop (groupParentOk,
    // spelt out so a render walks the tree once per card rather than once
    // per card per option: a campus can hold hundreds of racks).
    const below = groupDescendantIds(g.id);
    const parents = [{ id: '', label: t('— (top)') }].concat(tree
        .filter((e) => e.group.id !== g.id && !below.has(e.group.id))
        .map((e) => ({ id: e.group.id, label: groupOptionIndent(e.depth) + groupLabel(e.group) })));
    const option = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    return `<article class="net-card grp-card" data-grp="${id}" style="--grp-depth:${Math.min(depth, GROUP_INDENT_MAX)}">
        <div class="net-head">
            <span class="grp-name">${escapeHtml(groupLabel(g))}</span>
            <span class="chip-tag">${escapeHtml(kind)}</span>
        </div>
        <div class="net-line${deep ? '' : ' net-muted'}">${escapeHtml(count)}</div>
        <div class="net-actions">
            <button type="button" class="link-btn" data-act="members" data-grp="${id}" ${deep ? '' : 'disabled'}
                title="${escapeHtml(t('Select every device in this group, and in the groups inside it, and show them on the map'))}">${escapeHtml(t('Select members'))}</button>
            ${deep ? `<button type="button" class="link-btn" data-act="collapse" data-grp="${id}" aria-pressed="${collapsed}"
                title="${escapeHtml(t('Draw its devices as one node on the map, or draw them all again'))}">${escapeHtml(t(collapsed ? 'Expand on map' : 'Collapse on map'))}</button>` : ''}
            ${rack ? `<button type="button" class="link-btn" data-act="rack" data-grp="${id}"
                title="${escapeHtml(t('Show this rack unit by unit, front and rear, and place devices in it'))}">${escapeHtml(t('Open rack'))}</button>` : ''}
            <button type="button" class="link-btn" data-act="edit" data-grp="${id}" aria-expanded="${open}">${escapeHtml(t(open ? 'Close' : 'Edit'))}</button>
            <button type="button" class="link-btn" data-act="inside" data-grp="${id}"
                title="${escapeHtml(t('Add a group inside this one'))}">${escapeHtml(t('+ Inside'))}</button>
            <button type="button" class="link-btn quiet" data-act="delete" data-grp="${id}">${escapeHtml(t('Delete'))}</button>
        </div>
        <div class="net-edit prop-grid"${open ? '' : ' hidden'}>
            <div class="span2">
                <label class="prop-lbl" for="grp-${id}-name">${escapeHtml(t('Name'))}</label>
                <input id="grp-${id}-name" type="text" class="input" data-field="name" data-grp="${id}" value="${escapeHtml(g.name || '')}"
                    maxlength="${GROUP_NAME_MAX}" placeholder="${escapeHtml(groupKindName(g.kind))}" autocomplete="off" spellcheck="false">
            </div>
            <div>
                <label class="prop-lbl" for="grp-${id}-kind">${escapeHtml(t('Kind'))}</label>
                <select id="grp-${id}-kind" class="select" data-field="kind" data-grp="${id}">
                    ${GROUP_KINDS.map((k) => option(k, groupKindName(k), g.kind === k)).join('')}
                </select>
            </div>
            <div>
                <label class="prop-lbl" for="grp-${id}-parent">${escapeHtml(t('Inside'))}</label>
                <select id="grp-${id}-parent" class="select" data-field="parent" data-grp="${id}">
                    ${parents.map((p) => option(p.id, p.label, (g.parent || '') === p.id)).join('')}
                </select>
            </div>
            ${rack ? rackSizeFieldsHtml(g, 'grp') : ''}
        </div>
    </article>`;
}

// ---- Editing a group ----
// The name is typed: one undo step per field edit (saveTyping), as on a
// device. The kind and the parent are one step each, and so is each of a
// rack's size fields (onRackSizeField, below).
function onGroupField(e) {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    if (e.type === 'input' && el.matches('select')) return;   // a select's edit is its change
    const key = el.dataset.field;
    if (RACK_SIZE_KEYS.includes(key)) { if (e.type === 'change') onRackSizeField(el); return; }
    const g = groupById(el.dataset.grp);
    if (!g || readOnlyRefuses()) return;
    if (key === 'name') {
        // Typed. Its change only marks the tab out of date: the rebuild waits
        // for the focus to leave the tab (focusout below), not just the field.
        if (e.type === 'change') { _grpPanelDirty = true; return; }
        g.name = groupName(el.value);
        saveTyping();
        refreshGroupViews(false);
        return;
    }
    if (e.type !== 'change') return;
    if (key === 'kind') { changeGroupKind(g, el.value); return; }
    if (key === 'parent') {
        const parent = el.value || null;
        if (!groupParentOk(g.id, parent)) { renderGroupsPanel(true); return; }
        batch(() => { g.parent = parent; save(); renderCanvasOnly(); });
    }
    refreshGroupViews(true);
}

// ---- A rack's size ("Round 2", item 4) ----
// Its height in units (the sizes racks are sold in, or a custom one), its
// width (10", 19" or 23", which the rack view draws it in proportion to), its
// depth in mm (optional, only printed) and which way its units are numbered.
// The same four fields in the Groups tab's Edit and under the rack view's
// Size button, both answered here, each change one undo step. The height is
// a select rather than a typed number: a number written per keystroke would
// pass through "4" on the way to "42", and taking a 42U rack down to 4U is a
// question (rackShrinkQuestion, js/model.js) nobody should be asked halfway
// through typing. The depth is typed and is written when the field is left.
// Plain words, translated; "U" and the inch marks stay as they are.
// where: 'grp' (the Groups tab) or 'rk' (the rack view), so ids stay unique.
const RACK_SIZE_KEYS = ['uHeight', 'width', 'depthMm', 'numbering'];
function rackSizeFieldsHtml(g, where) {
    const id = escapeHtml(g.id), pre = `${where}-${id}`;
    const top = rackTop(g);
    const option = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const heights = RACK_U_PRESETS.includes(top) ? RACK_U_PRESETS : RACK_U_PRESETS.concat(top).sort((a, b) => a - b);
    const dis = state.readOnly ? ' disabled' : '';
    return `<div>
                <label class="prop-lbl" for="${pre}-uHeight">${escapeHtml(t('Height (U)'))}</label>
                <select id="${pre}-uHeight" class="select mono" data-field="uHeight" data-grp="${id}"${dis}>
                    ${heights.map((n) => option(String(n), RACK_U_PRESETS.includes(n) ? `${n}U` : `${n}U (${t('custom')})`, n === top)).join('')}
                    ${option('custom', t('Custom…'), false)}
                </select>
            </div>
            <div>
                <label class="prop-lbl" for="${pre}-width">${escapeHtml(t('Width'))}</label>
                <select id="${pre}-width" class="select mono" data-field="width" data-grp="${id}"${dis}>
                    ${RACK_WIDTHS.map((w) => option(w, rackWidthLabel(w), asRackWidth(g.width) === w)).join('')}
                </select>
            </div>
            <div>
                <label class="prop-lbl" for="${pre}-depthMm">${escapeHtml(t('Depth (mm)'))}</label>
                <input id="${pre}-depthMm" type="number" class="input mono" data-field="depthMm" data-grp="${id}" value="${Number.isInteger(g.depthMm) ? g.depthMm : ''}"
                    min="1" max="${RACK_DEPTH_MM_MAX}" step="1" inputmode="numeric" autocomplete="off" placeholder="${escapeHtml(t('optional'))}"${dis}>
            </div>
            <div>
                <label class="prop-lbl" for="${pre}-numbering">${escapeHtml(t('Numbering'))}</label>
                <select id="${pre}-numbering" class="select" data-field="numbering" data-grp="${id}"${dis}>
                    ${option('bottom', t('Bottom up'), !rackTopDown(g))}${option('top', t('Top down'), rackTopDown(g))}
                </select>
            </div>`;
}

// Every view that shows a rack's size, after it changed or was refused (a
// select left on Custom…, a depth that is not a number: put back).
function afterRackSize() {
    refreshGroupViews(true);
    if (typeof renderRackView === 'function') renderRackView(true);
}

// One of the fields above changed (its change event, never its input). ->
// a promise of whether it wrote anything.
async function onRackSizeField(el) {
    const g = groupById(el.dataset.grp);
    const key = el.dataset.field;
    if (!isRackGroup(g) || readOnlyRefuses()) { afterRackSize(); return false; }
    if (key === 'uHeight') {
        let n = asUnits(el.value);
        if (el.value === 'custom') {
            const answer = await askPrompt(t('How many units tall is {rack}? 1 to {max}.', { rack: groupLabel(g), max: RACK_U_MAX }),
                { title: t('Height of the rack'), ok: t('Set height'), value: rackTop(g) });
            n = answer === null ? undefined : asUnits(answer.trim());
            if (answer !== null && (n === undefined || n < 1 || n > RACK_U_MAX)) showToast(t('A rack is 1 to {max} units tall. Nothing was changed.', { max: RACK_U_MAX }));
        }
        if (n === undefined || n < 1 || n > RACK_U_MAX || !groupById(g.id)) { afterRackSize(); return false; }
        return setRackHeight(g, n);
    }
    let done = false;
    if (key === 'depthMm') {
        const text = String(el.value).trim();
        const mm = asRackDepthMm(text);
        // A blank takes the depth away; anything else that is not a whole
        // number of mm is refused, and the field shows the depth again.
        if (text && mm === undefined) showToast(t('A depth is a whole number of millimetres. Nothing was changed.'));
        else if (mm !== g.depthMm) {
            batch(() => { if (mm === undefined) delete g.depthMm; else g.depthMm = mm; save(); renderCanvasOnly(); });
            done = true;
        }
    } else if (key === 'width') {
        const w = asRackWidth(el.value);
        if (w !== asRackWidth(g.width)) { batch(() => { g.width = w; save(); renderCanvasOnly(); }); done = true; }
    } else if (key === 'numbering') {
        // Only the printed numbers turn round: no device moves (rackUnitNo).
        const top = el.value === 'top';
        if (top !== rackTopDown(g)) { batch(() => { if (top) g.numbering = 'top'; else delete g.numbering; save(); renderCanvasOnly(); }); done = true; }
    }
    afterRackSize();
    return done;
}

// A new height, after asking when devices would lose their units, named in
// the question (rackShrinkQuestion); then one step (applyRackHeight, which
// keeps every device on the units printed beside it). -> true when written.
async function setRackHeight(g, n) {
    if (!isRackGroup(g) || readOnlyRefuses() || n === rackTop(g)) { afterRackSize(); return false; }
    const question = rackShrinkQuestion(g, n);
    if (question) {
        const ok = await askConfirm(question, { title: t('Height of the rack'), ok: t('Make it {h}U', { h: n }), danger: true });
        if (!ok || !isRackGroup(groupById(g.id))) { afterRackSize(); return false; }
    }
    batch(() => { applyRackHeight(g, n); save(); renderCanvasOnly(); });
    afterRackSize();
    return true;
}

// A rack turned into anything else takes its devices' places in it with it,
// in the same step, after asking: a U position in a room is a position nobody
// can find, and every one of them would be a finding. Turned into a rack, a
// group gets the default height, and its devices are in it but not yet placed.
async function changeGroupKind(g, value) {
    const kind = asGroupKind(value);
    if (kind === g.kind) return;
    const placed = isRackGroup(g) && kind !== 'rack' ? groupMembers(g.id, false).filter(hasRackFields) : [];
    if (placed.length) {
        const ok = await askConfirm(t(placed.length === 1
            ? '{name} stops being a rack. Its one placed device loses its unit, height and face.'
            : '{name} stops being a rack. Its {n} placed devices lose their units, heights and faces.', { name: groupLabel(g), n: placed.length }),
            { ok: t('Change kind'), danger: true });
        if (!ok || !groupById(g.id)) { renderGroupsPanel(true); return; }
    }
    batch(() => {
        g.kind = kind;
        if (kind === 'rack') {
            if (!Number.isInteger(g.uHeight)) g.uHeight = RACK_U_DEFAULT;
            if (!g.width) g.width = RACK_WIDTH_DEFAULT;
        }
        placed.forEach(clearRackPlace);
        save(); renderCanvasOnly();
    });
    refreshGroupViews(true);
}

const clearRackPlace = (node) => { RACK_KEYS.forEach((k) => { delete node[k]; }); };

// After a group edit: the tab (now, or when its field loses the focus), the
// selected device's picker and its findings.
function refreshGroupViews(force) {
    renderGroupsPanel(force);
    renderGroupPicker(selectedGroupNode());
    if (typeof renderHostPicker === 'function') renderHostPicker(selectedGroupNode());
    refreshSelectedNodeDiagnostics();
}

async function onGroupAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.grp;
    if (act === 'edit') {
        if (_grpEditOpen.has(id)) _grpEditOpen.delete(id); else _grpEditOpen.add(id);
        renderGroupsPanel(true);
        if (_grpEditOpen.has(id)) { const f = grpPanel().querySelector(`[data-grp="${CSS.escape(id)}"][data-field="name"]`); if (f) f.focus(); }
        return;
    }
    if (act === 'members') { selectGroupMembers(id); return; }
    // A view, not an edit: a read-only document can be folded too.
    if (act === 'collapse') { toggleGroupCollapsed(id); return; }
    // And so is the rack view (js/rackview.js), which refuses edits itself.
    if (act === 'rack') { openRackView(id); return; }
    if (readOnlyRefuses()) return;
    if (act === 'from-locations') { await makeGroupsFromLocations(); return; }
    if (act === 'inside') { await addGroup(id); return; }
    if (act === 'delete') { await deleteGroup(id); }
}

// + Group, or + Inside one (parentId). The name is asked; the kind follows
// from where it goes (a building at the top, a floor in a building...) and
// the card opens with its fields, so a wrong guess is one change away.
async function addGroup(parentId) {
    if (readOnlyRefuses()) return null;
    const parent = parentId ? groupById(parentId) : null;
    if (parentId && !parent) return null;
    const kind = parent ? CHILD_KIND[parent.kind] || 'custom' : 'building';
    const name = await askPrompt(parent ? t('Name of the group inside {parent}:', { parent: groupLabel(parent) }) : t('Name of the new group, like Building A or Server room:'),
        { title: t('Add a group'), ok: t('Add') });
    if (name === null || (parentId && !groupById(parentId))) return null;
    const g = makeGroup({ name: groupName(name), kind, parent: parent ? parent.id : null });
    // Drawn at once: a rack made inside a room puts Rack in the view switch.
    batch(() => { state.groups = state.groups.concat(g); save(); renderCanvasOnly(); });
    _grpEditOpen.add(g.id);
    refreshGroupViews(true);
    return g;
}

// Its child groups move up to its parent, so the tree below it stays whole.
// Its own devices stay on the map, in no group (and out of any rack place),
// unless the visitor chooses to delete them too, cables and all. One step.
async function deleteGroup(id) {
    const g = groupById(id);
    if (!g) return false;
    const own = groupMembers(id, false);
    const kids = state.groups.filter((x) => x.parent === id);
    const parent = groupById(g.parent);
    const lines = [t('Delete the group {name}?', { name: groupLabel(g) })];
    if (kids.length) {
        lines.push(t(kids.length === 1 ? 'The group inside it moves up to {parent}.' : 'The {n} groups inside it move up to {parent}.',
            { n: kids.length, parent: parent ? groupLabel(parent) : t('the top') }));
    }
    let answer;
    if (!own.length) {
        answer = (await askConfirm(lines.join('\n'), { title: t('Delete group'), ok: t('Delete'), danger: true })) ? 'ungroup' : null;
    } else {
        lines.push(t(own.length === 1 ? 'Its one device stays on the map, in no group.' : 'Its {n} devices stay on the map, in no group.', { n: own.length }));
        answer = await askChoice(lines.join('\n'), { title: t('Delete group'), choices: [
            { id: 'members', label: t(own.length === 1 ? 'Delete its device too' : 'Delete its {n} devices too', { n: own.length }) },
            { id: 'ungroup', label: t('Delete the group'), primary: true }
        ] });
    }
    if (!answer || !groupById(id)) return false;
    batch(() => {
        const ownIds = new Set(state.nodes.filter((n) => n.group === id).map((n) => n.id));
        if (answer === 'members') {
            state.nodes = state.nodes.filter((n) => !ownIds.has(n.id));
            state.links = state.links.filter((l) => !ownIds.has(l.source) && !ownIds.has(l.target));
            // A text note's leader to a deleted device goes with it, as Delete does.
            state.annotations.forEach((a) => { if (a.targets && a.targets.length) a.targets = a.targets.filter((x) => !ownIds.has(x)); });
        } else {
            state.nodes.forEach((n) => { if (ownIds.has(n.id)) { delete n.group; clearRackPlace(n); } });
        }
        state.groups.forEach((x) => { if (x.parent === id) x.parent = g.parent || null; });
        state.groups = state.groups.filter((x) => x.id !== id);
        _grpEditOpen.delete(id);
        save(); renderCanvasOnly();
    });
    pruneSelection();
    renderSelection();
    refreshGroupViews(true);
    return true;
}

// ---- Make groups from locations ----
// The devices whose free-text location says something.
const locationsToGroup = (nodes = state.nodes) => nodes.filter((n) => n && typeof n.location === 'string' && splitPlacePath(n.location).length);

// Pure: the groups the locations describe and which device goes in which.
// Each location is a path split on " / ", ">" or "," (splitPlacePath,
// js/model.js); the same name under the same parent, case and spacing aside,
// is one group, so "Building A / Server room" on ten devices makes two
// groups, not twenty. A last segment that is a unit range ("U12", "U12-U13")
// is where the device sits in the group before it, which becomes a rack.
// Each group's kind is guessed from its name (guessGroupKind: "Rack 3" a
// rack, "Floor 2" a floor, anything else a group of the user's own).
// The free text itself is left as it was typed: it stays readable, and the
// table greys it once a group says where the device is.
// -> { groups: [new group], assign: [{ nodeId, groupId, rackU?, rackHeight? }] }
function planGroupsFromLocations(nodes = state.nodes, groups = state.groups) {
    const maker = groupPathMaker(groups);
    const made = new Set();
    const assign = [];
    locationsToGroup(nodes).forEach((n) => {
        const parts = splitPlacePath(n.location);
        const span = parts.length > 1 ? parseRackSpan(parts[parts.length - 1]) : null;
        if (span) parts.pop();
        const r = maker.resolve(parts.join(' / '), true);
        if (!r.group) return;   // a path naming two groups of one name: left alone
        maker.made.forEach((g) => made.add(g.id));
        const a = { nodeId: n.id, groupId: r.group.id };
        if (span && made.has(r.group.id)) {
            const g = r.group;
            // The group a unit is given in is a rack, as tall as its highest unit.
            if (g.kind !== 'rack') { g.kind = 'rack'; g.uHeight = RACK_U_DEFAULT; g.width = RACK_WIDTH_DEFAULT; }
            g.uHeight = Math.min(RACK_U_MAX, Math.max(g.uHeight || RACK_U_DEFAULT, span.u + span.height - 1));
        }
        if (span && (made.has(r.group.id) || isRackGroup(r.group)) && !Number.isInteger(n.rackU)) {
            a.rackU = span.u;
            if (span.height > 1) a.rackHeight = span.height;
        }
        assign.push(a);
    });
    return { groups: maker.made, assign };
}

// The preview, in words: the tree to be made, each group with how many
// devices go straight into it. Long trees are cut, with how many more.
const FROM_LOC_PREVIEW_MAX = 14;
function groupsFromLocationsText(plan) {
    const own = new Map();
    plan.assign.forEach((a) => own.set(a.groupId, (own.get(a.groupId) || 0) + 1));
    const tree = groupTree(plan.groups);
    const lines = tree.slice(0, FROM_LOC_PREVIEW_MAX).map((e) => {
        const n = own.get(e.group.id) || 0;
        return `${groupOptionIndent(e.depth)}${groupLabel(e.group)} (${groupKindName(e.group.kind)})${n ? ` · ${devicesText(n)}` : ''}`;
    });
    if (tree.length > FROM_LOC_PREVIEW_MAX) lines.push(t('…and {n} more.', { n: tree.length - FROM_LOC_PREVIEW_MAX }));
    const devices = new Set(plan.assign.map((a) => a.nodeId)).size;
    return [t(plan.groups.length === 1 ? 'Make one group from the locations of {m} devices?' : 'Make {n} groups from the locations of {m} devices?',
        { n: plan.groups.length, m: devices }), '', ...lines, '',
        t('Each location stays as it was typed. One Undo takes all of it back.')].join('\n');
}

// Offered while there are no groups; asks with the preview, then writes the
// groups and every device's place in one step. -> the plan applied, or null.
async function makeGroupsFromLocations() {
    if (readOnlyRefuses()) return null;
    const plan = planGroupsFromLocations();
    if (!plan.groups.length) return null;
    const ok = await askConfirm(groupsFromLocationsText(plan), { title: t('Make groups from locations'), ok: t('Make groups') });
    if (!ok) return null;
    // Planned again from the document as it is now: the question was open,
    // and a stale plan is never what is written.
    const now = planGroupsFromLocations();
    if (!now.groups.length) return null;
    batch(() => {
        state.groups = state.groups.concat(now.groups);
        now.assign.forEach((a) => {
            const n = getNode(a.nodeId);
            if (!n) return;
            n.group = a.groupId;
            const g = groupById(a.groupId);
            rackKeysLost(n, g).forEach((k) => { delete n[k]; });
            if (a.rackU !== undefined) { n.rackU = a.rackU; if (a.rackHeight) n.rackHeight = a.rackHeight; }
        });
        save(); renderCanvasOnly();
    });
    refreshGroupViews(true);
    showToast(t('Groups made: {n}. Devices in them: {m}.', { n: now.groups.length, m: now.assign.length }), 'ok');
    return now;
}

// ---- Select members ----
// Every device in the group and in the groups inside it, selected and brought
// into view, as a subnet's Select members does. Returns the ids.
function selectGroupMembers(id) {
    const members = groupMembers(id, true);
    if (!members.length) return [];
    selectEntries(members.map((n) => ({ type: 'node', id: n.id })));
    centreOnNodes(members);
    return members.map((n) => n.id);
}

// ---- The device editor's Group picker ----
const grpEl = (id) => document.getElementById(id);
const selectedGroupNode = () => (state.selectedType === 'node' && state.selectedId ? getNode(state.selectedId) : null);

// node: the selected device, or null to empty it. A field with the focus is
// left as it is being typed; everything else follows the document.
function renderGroupPicker(node) {
    const sel = grpEl('propGroup');
    if (!sel) return;
    const focused = document.activeElement;
    const tree = groupTree();
    const options = [`<option value="">${escapeHtml(t('— None'))}</option>`].concat(tree.map((e) =>
        `<option value="${escapeHtml(e.group.id)}">${escapeHtml(groupOptionIndent(e.depth) + groupLabel(e.group)
            + (e.group.kind !== 'custom' && e.group.name ? ` (${groupKindName(e.group.kind)})` : ''))}</option>`)).join('');
    if (sel.dataset.options !== options) { sel.innerHTML = options; sel.dataset.options = options; }
    sel.value = node && node.group && groupById(node.group) ? node.group : '';
    // A VM on a host is where its host is (js/model.js "Hosts"): its group
    // is the host's, so it is shown and not offered, and the note says why.
    const host = node ? hostRootOf(node) : null;
    sel.disabled = !node || !!host;

    const note = grpEl('groupPathNote');
    const path = node ? nodePlaceText(node) : '';
    const grouped = !!(node && groupOfNode(node));
    note.textContent = host ? t('Where {host} is: it runs on it.', { host: host.name || host.id }) + (grouped ? ` ${path}` : '')
        : grouped ? path : '';
    note.classList.toggle('hidden', !grouped && !host);

    // A VM or a container takes no units of its own, so it has no place to set.
    const rack = node && !isVirtualType(node.type) ? rackOfNode(node) : null;
    grpEl('rackPlaceRow').classList.toggle('hidden', !rack);
    if (!rack) return;
    const u = grpEl('propRackU'), h = grpEl('propRackHeight'), face = grpEl('propRackFace');
    u.max = String(rack.uHeight || RACK_U_DEFAULT);
    h.max = String(rack.uHeight || RACK_U_DEFAULT);
    // The unit as the rack's rails print it (rackStartNo): on a rack
    // numbered from the top, the top unit the device takes.
    const ulbl = document.querySelector('label[for="propRackU"]');
    if (ulbl) ulbl.title = t(rackTopDown(rack) ? 'The top unit it takes, counted from the top' : 'The lowest unit it takes, counted from the bottom');
    if (focused !== u) u.value = Number.isInteger(node.rackU) ? String(rackStartNo(rack, node.rackU, rackHeightOf(node))) : '';
    if (focused !== h) h.value = Number.isInteger(node.rackHeight) ? String(node.rackHeight) : '';
    if (focused !== face) face.value = rackFaceOf(node);
    grpEl('propRackDepth').checked = rackFullDepth(node);
    const ports = grpEl('propPortsFace');
    if (ports && focused !== ports) ports.value = portsFaceOf(node);
    // Greyed on a half-depth device, whose ports are on its one face whatever
    // this says (rackPortsFace): changing it there would draw nothing new.
    // Its value stays, for when the device is made full depth again.
    if (ports) {
        const half = !rackFullDepth(node);
        ports.disabled = half || !!state.readOnly;
        ports.title = half ? t('A half-depth device shows its ports on its own face.') : '';
    }
}

// The side of the device its ports are on ("Round 5"): set to its type's own,
// the key goes (the type says it), so a device keeps following its type
// until it is told otherwise. One undo step. -> true when written.
function setPortsFace(node, face) {
    if (!node || readOnlyRefuses() || isVirtualType(node.type)) return false;
    const f = asRackFace(face);
    if (!f || f === portsFaceOf(node)) return false;
    batch(() => {
        if (f === defaultPortsFace(node.type)) delete node.portsFace; else node.portsFace = f;
        save(); renderCanvasOnly();
    });
    return true;
}

// A device moved out of a rack leaves its place in it behind: a U position
// anywhere else is a position nobody can find (and a finding).
function setNodeGroup(node, groupId) {
    const g = groupById(groupId);
    if (!node || readOnlyRefuses()) return false;
    batch(() => {
        if (g) node.group = g.id; else delete node.group;
        if (!isRackGroup(g)) clearRackPlace(node);
        save(); renderCanvasOnly();
    });
    return true;
}

(function wireGroupPicker() {
    const sel = grpEl('propGroup');
    if (!sel) return;
    const after = (node) => {
        renderGroupPicker(getNode(node.id) || node);   // a read-only document puts it back
        refreshSelectedNodeDiagnostics();
        renderGroupsPanel();
    };
    sel.addEventListener('change', () => {
        const node = selectedGroupNode();
        if (!node) return;
        setNodeGroup(node, sel.value);
        after(node);
    });
    // The unit and the height are typed: one step per field edit. A value
    // that is not a whole number is ignored while typing and put back from
    // the document when the field is left.
    // The unit is read as it is stored (U 0 or U -1 kept, so the finding can
    // name it); the height is a count, and a half-typed "-" is neither.
    // On a rack numbered from the top the U field speaks the printed number
    // (renderGroupPicker), so it is turned back into the stored one, the
    // lowest unit counted from the bottom (rackUnitFromNo), and a new height
    // keeps the device's top unit where it is: "U3, 2U tall" made 3U tall is
    // still at U3, reading down, as on the rails.
    const fromField = {
        rackU: (node, rack, text) => { const no = asRackU(text); return no === undefined ? undefined : asRackU(rackUnitFromNo(rack, no, rackHeightOf(node))); },
        rackHeight: (node, rack, text) => asRackHeight(text)
    };
    [['propRackU', 'rackU', asRackU], ['propRackHeight', 'rackHeight', asUnits]].forEach(([id, key, parses]) => {
        const el = grpEl(id);
        el.addEventListener('input', () => {
            const node = selectedGroupNode();
            const rack = node && rackOfNode(node);
            if (!rack) return;
            const before = rackHeightOf(node);
            if (isBlank(el.value)) delete node[key];
            else if (parses(el.value) === undefined) return;
            else { const v = fromField[key](node, rack, el.value); if (v === undefined) delete node[key]; else node[key] = v; }
            if (key === 'rackHeight' && rackTopDown(rack) && Number.isInteger(node.rackU)) node.rackU = asRackU(node.rackU + before - rackHeightOf(node));
            grpEl('groupPathNote').textContent = nodePlaceText(node);
            saveTyping();
            renderTyped();
        });
        el.addEventListener('change', () => { const node = selectedGroupNode(); if (node) renderGroupPicker(node); });
    });
    grpEl('propRackFace').addEventListener('change', (e) => {
        const node = selectedGroupNode();
        if (!node || !rackOfNode(node)) return;
        node.rackFace = asRackFace(e.target.value) || 'front';
        save();
        after(node);
    });
    grpEl('propPortsFace').addEventListener('change', (e) => {
        const node = selectedGroupNode();
        if (!node || !rackOfNode(node)) return;
        setPortsFace(node, e.target.value);
        after(node);
    });
    // Ticked (the default) it fills the depth; unticked it is on one face,
    // stored as 'half'. Like the fields above, it writes what it is told: a
    // device made full depth over one on the other face is an overlap, and
    // the finding says so (the rack view's own Full depth button refuses it
    // instead).
    grpEl('propRackDepth').addEventListener('change', (e) => {
        const node = selectedGroupNode();
        if (!node || !rackOfNode(node)) return;
        if (e.target.checked) delete node.rackDepth; else node.rackDepth = 'half';
        save();
        renderCanvasOnly();
        after(node);
    });
})();

(function wireGroupsPanel() {
    const panel = grpPanel();
    if (!panel) return;
    panel.addEventListener('input', onGroupField);
    panel.addEventListener('change', onGroupField);
    panel.addEventListener('click', onGroupAction);
    panel.addEventListener('focusout', () => setTimeout(() => { if (_grpPanelDirty) renderGroupsPanel(); }, 0));
    document.getElementById('addGroupBtn').addEventListener('click', () => addGroup(null));
})();
