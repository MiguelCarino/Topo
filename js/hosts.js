// ---- Runs on: the device a VM or a container runs on (node.host) ----
// The device editor's half of "Hosts" (js/model.js, Review-Packs/
// Topo-groups.md "Round 3", item 2). In the Asset section, under the Group
// picker:
//
//   Runs on   on a VM or a container: the devices it may run on (canHost),
//             the kinds it usually runs on first (a VM on a server; a
//             container on a server or a VM), then any other, then none.
//             Picking one is one undo step, and the VM is then where its
//             host is: the save that files the step puts it in the host's
//             group (repairHosts, run by save()), which the Group picker
//             above shows, greyed, as the host's.
//   Runs here on a device something runs on: what runs on it, each a button
//             that selects that device, and a container on one of its VMs
//             under the VM.
//
// The table's Runs on column, the query's host:, the bulk panel's Move to
// host and the report's inventory read the same model helpers (hostOf,
// guestsOf, hostCandidates); the rack view's and the map's drawing of guests
// are theirs.
//
// Plain words, translated (MESSAGES, js/i18n.js): "Runs on" is not the
// technical vocabulary the full editor keeps in English.
// Load order: ... groups -> hosts -> groupmap -> ... -> assets -> app

const hostEl = (id) => document.getElementById(id);

// The options of the Runs on picker for `node`, as HTML: none, the usual
// hosts, the rest. A host it may not run on but holds (it never does after
// repairHosts) is not offered, and the select falls back to none.
function hostOptionsHtml(node) {
    const list = hostCandidates(node);
    const opt = (n) => `<option value="${escapeHtml(n.id)}">${escapeHtml(`${n.name || n.id} · ${t(typeName(n.type))}`)}</option>`;
    const first = list.filter((n) => isSuggestedHost(node.type, n)), rest = list.filter((n) => !isSuggestedHost(node.type, n));
    return `<option value="">${escapeHtml(t('— None'))}</option>`
        + (first.length && rest.length
            ? `<optgroup label="${escapeHtml(t('Suggested'))}">${first.map(opt).join('')}</optgroup><optgroup label="${escapeHtml(t('Other devices'))}">${rest.map(opt).join('')}</optgroup>`
            : list.map(opt).join(''));
}

// node: the selected device, or null to hide both rows. Rebuilt from the
// document each time, like the Group picker; a select that has the focus is
// left as the person is choosing in it.
function renderHostPicker(node) {
    const row = hostEl('hostRow'), sel = hostEl('propHost');
    if (!row || !sel) return;
    const virtual = !!node && isVirtualType(node.type);
    row.classList.toggle('hidden', !virtual);
    if (virtual && document.activeElement !== sel) {
        const html = hostOptionsHtml(node);
        if (sel.dataset.options !== html) { sel.innerHTML = html; sel.dataset.options = html; }
        const host = hostOf(node);
        sel.value = host && hostCandidates(node).includes(host) ? host.id : '';
    }
    sel.disabled = !virtual || !!state.readOnly;

    // What runs on it, and on its VMs, one level in.
    const guests = node ? guestsOf(node) : [];
    const box = hostEl('guestRow');
    box.classList.toggle('hidden', !guests.length);
    if (!guests.length) { hostEl('guestList').innerHTML = ''; return; }
    hostEl('guestHead').textContent = t(guests.length === 1 ? 'Runs here: {n} device' : 'Runs here: {n} devices', { n: guests.length });
    const item = (g, depth) => `<li class="host-guest${depth ? ' host-guest-in' : ''}">
        <button type="button" class="link-btn" data-guest="${escapeHtml(g.id)}">${escapeHtml(g.name || g.id)}</button>
        <span class="rail-note">${escapeHtml(t(typeName(g.type)))}${isRetired(g) ? ` · ${escapeHtml(statusName('retired'))}` : ''}</span>
    </li>`;
    hostEl('guestList').innerHTML = guests.map((g) => item(g, 0) + guestsOf(g).map((c) => item(c, 1)).join('')).join('');
}

// Onto `hostId` ('' for none). One undo step; save() moves it into the
// host's group. -> true when written.
function setNodeHost(node, hostId) {
    if (!node || !isVirtualType(node.type) || readOnlyRefuses()) return false;
    const host = hostId ? getNode(hostId) : null;
    if (hostId && (!host || !canHost(node.type, host) || host === node)) return false;
    if ((node.host || '') === (host ? host.id : '')) return false;
    batch(() => {
        if (host) node.host = host.id; else delete node.host;
        save(); renderCanvasOnly();
    });
    return true;
}

(function wireHostPicker() {
    const sel = hostEl('propHost');
    if (!sel) return;
    sel.addEventListener('change', () => {
        const node = selectedGroupNode();
        if (!node) return;
        setNodeHost(node, sel.value);
        const now = getNode(node.id) || node;   // a read-only document puts it back
        renderHostPicker(now);
        renderGroupPicker(now);
        refreshSelectedNodeDiagnostics();
        renderGroupsPanel();
    });
    // A guest in the list: select it and bring it into view, as a group's
    // Select members does for a set.
    hostEl('guestList').addEventListener('click', (e) => {
        const b = e.target.closest('[data-guest]');
        const guest = b && getNode(b.dataset.guest);
        if (!guest) return;
        selectEntries([{ type: 'node', id: guest.id }]);
        centreOnNodes([guest]);
    });
})();
