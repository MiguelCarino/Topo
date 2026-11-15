// Copy, paste and duplicate: devices with the cables between them, and a
// group with everything in it.
//
// A copy is another device like the one it was made from, not the same one
// twice. So it keeps what describes the kind of device (type, vendor, model,
// OS, ports, notes, the group it sits in, the providers responsible) and
// takes new values for what names one unit:
//
//   name        the next free number ("PC" -> "PC 2", "AP 3" -> "AP 4")
//   address     the next free one in the same subnet, or none when it is full
//   MAC, serial number, asset tag   left blank: they belong to one unit
//   rack place  left out, unless its whole rack was copied with it
//
// Cables are copied when both ends are. A VM stays on its host unless the
// host was copied too. Monitors, findings notes and problem reports name the
// originals and are not copied.
//
// A group is copied with the groups inside it and every device in them, as a
// new group beside the original: same kind and settings, the next free name,
// the same parent. Inside a copied rack the devices keep their units.
//
// The clipboard is this tab's own: nothing is written to the system
// clipboard, where a network's addresses would sit for any app to read.
// Pasted into another network (the originals are not on the map), a copy
// goes in the way a block does (insertBlock, js/add.js): beside what is
// there, in no group, its subnets moved to free ones.
//
// Load order: after js/add.js (blockFromNodes, insertBlockNow).

let _clip = null;

// What identifies one physical unit, and is never carried to a copy.
const COPY_UNIT_FIELDS = ['serial', 'assetTag'];

// "PC" -> "PC 2"; "PC 2" -> "PC 3"; the first that `taken` (nameKey'd names)
// does not hold, which is then added to it.
function nextCopyName(name, taken) {
    const text = String(name || '').trim();
    const m = /^(.*\S)\s+(\d+)$/.exec(text);
    const stem = m ? m[1] : text;
    let k = m ? Number(m[2]) + 1 : 2;
    while (taken.has(nameKey(`${stem} ${k}`))) k++;
    const out = `${stem} ${k}`.trim();
    taken.add(nameKey(out));
    return out;
}

// The devices (and with groupId, that group's whole tree) as a clip: their
// records as the serializer writes them, the cables with both ends inside,
// the groups, and the same thing as a block for another network.
function clipOf(nodeIds, groupId = null) {
    const nodes = nodeIds.map((id) => getNode(id)).filter(Boolean);
    const root = groupId ? groupById(groupId) : null;
    if (!nodes.length && !root) return null;
    const ids = new Set(nodes.map((n) => n.id));
    const below = root ? groupDescendantIds(root.id) : new Set();
    const groups = root ? state.groups.filter((g) => g.id === root.id || below.has(g.id)) : [];
    return {
        nodes: nodes.map((n) => cloneData(serializeNode(n))),
        links: state.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => cloneData(serializeLink(l))),
        groups: cloneData(serializeGroups(groups) || []),
        root: root ? root.id : null,
        block: nodes.length ? cloneData(blockFromNodes(nodes)) : null,
        src: nodes.map((n) => n.id),
        pastes: 0
    };
}

// Is the clip from the network that is open? Its devices (or its group) are still here.
const clipIsFromHere = (clip) => (clip.src.length ? clip.src.every((id) => !!getNode(id)) : !!groupById(clip.root));

// -> { nodeIds, groupId, moved, blank, block } or null. Inside a batch.
function pasteClipNow(clip) {
    if (!clip || readOnlyRefuses()) return null;
    if (!clipIsFromHere(clip)) {
        // Another network: a block's rules (no group, free subnets).
        if (!clip.block) return null;
        const done = insertBlockNow({ doc: clip.block }, {});
        return done ? { nodeIds: done.nodeIds, groupId: null, moved: 0, blank: 0, block: true, moves: done.moves } : null;
    }
    const n = ++clip.pastes;
    const snap = (v) => Math.round(v / GRID_SNAP) * GRID_SNAP;
    const xs = clip.nodes.map((r) => Number(r.x) || 0);
    // A group's copy stands beside the original, clear of its frame; loose
    // devices step down and to the right, further with each paste.
    const dx = clip.root && xs.length ? (Math.max(...xs) - Math.min(...xs) + 8 * GRID_SNAP) * n : 2 * GRID_SNAP * n;
    const dy = clip.root ? 0 : 2 * GRID_SNAP * n;

    // The groups first: the devices name them.
    const gMap = {};
    let rootCopy = null;
    if (clip.groups.length) {
        const taken = new Set(state.groups.map((g) => nameKey(groupLabel(g))));
        const made = clip.groups.map((g) => {
            const fields = Object.assign({}, g); delete fields.id;
            const copy = makeGroup(fields);
            gMap[g.id] = copy.id;
            return [g, copy];
        });
        made.forEach(([g, copy]) => {
            if (g.id === clip.root) {
                copy.parent = g.parent && groupById(g.parent) ? g.parent : null;
                copy.name = nextCopyName(groupLabel(g), taken);
                rootCopy = copy;
            } else copy.parent = gMap[g.parent] || null;
        });
        state.groups = state.groups.concat(made.map(([, copy]) => copy));
    }

    const names = new Set(state.nodes.map((x) => nameKey(x.name)));
    const idMap = {}, newIds = [], wants = [];
    clip.nodes.forEach((rec) => {
        const nid = nextId('s');
        idMap[rec.id] = nid; newIds.push(nid);
        const node = normalizeLoadedNode(Object.assign(cloneData(rec), { id: nid, x: snap((Number(rec.x) || 0) + dx), y: snap((Number(rec.y) || 0) + dy), name: nextCopyName(rec.name, names) }));
        COPY_UNIT_FIELDS.forEach((k) => { delete node[k]; });
        if (clip.root) node.group = gMap[rec.group] || undefined;
        else {
            if (node.group && !groupById(node.group)) delete node.group;
            RACK_KEYS.forEach((k) => { delete node[k]; });
        }
        if (node.group === undefined) delete node.group;
        // Its addresses are asked for once every copy is on the map, so two
        // copies are never handed the same one.
        (node.interfaces || []).forEach((i) => {
            if (!i) return;
            delete i.mac;
            const p = parseValidCIDR(i.ip);
            if (p) { wants.push({ iface: i, cidr: p.networkStr, prefix: p.prefix }); i.ip = ''; }
        });
        state.nodes.push(node);
    });
    newIds.forEach((id) => { const node = getNode(id); if (node && node.host !== undefined && idMap[node.host]) node.host = idMap[node.host]; });
    let moved = 0, blank = 0;
    wants.forEach((w) => {
        const free = nextFreeAddress(w.cidr);
        if (free) { w.iface.ip = `${free}/${w.prefix}`; moved++; } else blank++;
    });
    clip.links.forEach((l) => {
        if (!idMap[l.source] || !idMap[l.target]) return;
        state.links.push(normalizeLoadedLink(Object.assign(cloneData(l), { id: nextId('sl'), source: idMap[l.source], target: idMap[l.target] })));
    });
    setSelectionEntries(newIds.map((id) => ({ type: 'node', id })));
    save(); renderCanvasOnly();
    return { nodeIds: newIds, groupId: rootCopy ? rootCopy.id : null, moved, blank, block: false };
}

// What a paste says: how many, and what became of their addresses.
function copySaid(done, verb) {
    const n = done.nodeIds.length;
    const parts = [done.groupId ? t(verb === 'paste' ? 'Pasted {group} with {n} devices.' : 'Duplicated as {group}, with {n} devices.', { group: groupLabel(groupById(done.groupId)), n })
        : t(verb === 'paste' ? (n === 1 ? 'Pasted 1 device.' : 'Pasted {n} devices.') : (n === 1 ? 'Duplicated 1 device.' : 'Duplicated {n} devices.'), { n })];
    if (done.block && done.moves && done.moves.length) parts.push(t('Moved to free addresses: {list}', { list: done.moves.map((m) => `${m.from} → ${m.to}`).join(', ') }));
    if (done.moved) parts.push(t(done.moved === 1 ? 'Its address is the next free one in its subnet.' : 'Their addresses are the next free ones in their subnets.'));
    if (done.blank) parts.push(t(done.blank === 1 ? '1 address was left blank: its subnet is full.' : '{n} addresses were left blank: their subnets are full.', { n: done.blank }));
    return parts.join(' ');
}
function afterPaste(done, verb) {
    if (!done) return null;
    renderSelection();
    if (done.groupId || (state.groups && state.groups.length)) refreshGroupViews(true);
    if (done.block) fitToView();
    showToast(copySaid(done, verb), 'ok');
    return done;
}

// Ctrl+C: the selected devices, and the cables between them, onto the clipboard.
function copySelection() {
    const clip = clipOf(selectedOf('node'));
    if (!clip) { showToast(t('Select the devices to copy first.')); return null; }
    _clip = clip;
    const n = clip.nodes.length;
    showToast(t(n === 1 ? 'Copied 1 device. Ctrl+V pastes it.' : 'Copied {n} devices. Ctrl+V pastes them.', { n }), 'ok');
    return clip;
}
const hasCopied = () => !!_clip;
// Ctrl+V: what was copied, as one step. Again pastes another, a step further on.
function pasteCopied() {
    if (!_clip) { showToast(t('Nothing is copied yet. Select devices and press Ctrl+C.')); return null; }
    if (readOnlyRefuses()) return null;
    return afterPaste(batch(() => pasteClipNow(_clip)), 'paste');
}
// Ctrl+D: a copy of the selection at once. The clipboard is left as it was.
function duplicateSelection() {
    const clip = clipOf(selectedOf('node'));
    if (!clip) { showToast(t('Select the devices to copy first.')); return null; }
    if (readOnlyRefuses()) return null;
    return afterPaste(batch(() => pasteClipNow(clip)), 'duplicate');
}
// A group, the groups inside it and every device in them, as a new group
// beside it. One step.
function duplicateGroup(id) {
    const g = groupById(id);
    if (!g || readOnlyRefuses()) return null;
    const clip = clipOf(groupMembers(id, true).map((n) => n.id), id);
    return afterPaste(batch(() => pasteClipNow(clip)), 'duplicate');
}
// The same group onto the clipboard, for Ctrl+V.
function copyGroup(id) {
    const g = groupById(id);
    if (!g) return null;
    _clip = clipOf(groupMembers(id, true).map((n) => n.id), id);
    showToast(t('Copied {group}. Ctrl+V pastes it.', { group: groupLabel(g) }), 'ok');
    return _clip;
}

(function wireCopyButtons() {
    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
    on('selCopyBtn', () => copySelection());
    on('selDuplicateBtn', () => duplicateSelection());
})();
