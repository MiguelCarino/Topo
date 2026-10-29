// The bulk panel (plan 3.4, Review-Packs/Topo-proposal.md; js/bulk.js). Two or
// more devices selected, and nothing else, in the full editor: the rail can
// change all of them at once. What is held here:
//   1. when the panel shows: a set of devices, not one, not a mixed set, not a
//      reduced view;
//   2. Set fields: built from the schema's bulk rows; "mixed" where they
//      differ, the shared value where they agree; blank or untouched leaves a
//      field alone, Clear empties it, an invalid value is refused; NAT only on
//      routing devices;
//   3. the preview: counts per device, the findings delta from the pure engine
//      on a scratch copy (the live document untouched until Apply), and Apply
//      as one batch and one undo step;
//   4. Rename: a pattern ({n}, {n:02}, {name}) counted by name, switch port or
//      place on the map, from a start number; find and replace; a warning for
//      names that would be shared;
//   5. Move to a network: next free host (skipping the gateway, the resolvers
//      and addresses already used, and those handed out in the same move),
//      overrides cleared so gateway and DNS are inherited, routers left alone,
//      a full network refused;
//   6. Delete Selected on such a set previews first, then takes the cables;
//      the Delete key and a mixed set still delete at once;
//   7. the draft survives a shift-click, and is dropped when the set ends;
//   8. the sentences are translated, the field labels stay English;
//   9. Enter → Apply redraws the panel from what was written (the modal hands
//      the focus back to the field, which used to keep it stale);
//  10. a set of cables gets Set fields only (Medium), with the same preview,
//      Apply and undo; its Delete still deletes at once.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const shown = (id) => !el(id).classList.contains('hidden');
  const dialogOpen = () => !el('bulkDialog').hidden;
  const type = (id, v) => { const f = el(id); f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); };
  const tab = (k) => el('bulkTabs').querySelector(`[data-bulk="${k}"]`).click();
  const nodeByName = (name) => state.nodes.find((n) => n.name === name);
  const phones = () => ['p1', 'p2', 'p10'];
  const pick = (ids) => selectEntries(ids.map((id) => ({ type: 'node', id })));

  const P = (id, name, x, y, ip, extra) => Object.assign({ id, type: 'voip', name, x, y, os: 'FW 1.0', notes: '', interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra || {});
  const lab = () => ({ v: DOC_VERSION,
    networks: [
      { id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' },
      { id: 'n20', cidr: '10.0.20.0/24', name: 'Voice', vlan: 20, gateway: '10.0.20.1', dns: '10.0.20.53' },
      { id: 'n30', cidr: '10.0.30.0/30', name: 'Tiny', gateway: '10.0.30.1' }
    ],
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 300, y: 40, nat: true, interfaces: [{ id: 'w', name: 'eth0', ip: '10.0.0.1/24' }, { id: 'v', name: 'eth1', ip: '10.0.20.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 300, y: 160, portCount: 8, interfaces: [] },
      P('p2', 'Phone 2', 100, 300, '10.0.0.12/24', { notes: 'desk' }),
      P('p10', 'Phone 10', 200, 305, '10.0.0.13/24', { notes: 'lobby' }),
      P('p1', 'Phone 1', 50, 420, '10.0.0.11/24', { gw: '10.0.0.254', dns: '1.1.1.1', notes: 'desk' }),
      { id: 'cam', type: 'camera', name: 'Cam', x: 500, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.2/24' }] }
    ],
    links: [
      { id: 'l10', source: 'sw', target: 'p10', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'l1', source: 'sw', target: 'p1', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'l2', source: 'sw', target: 'p2', sourceIface: 'p3', targetIface: 'i1' },
      { id: 'lr', source: 'rt', target: 'sw', sourceIface: 'w', targetIface: 'p8' }
    ] });
  const open = () => {
    replaceDocument(lab(), { origin: 'file' });
    initHistory();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };

  try {
    open();

    // ---- 1: when the panel shows ----
    select('p1', 'node');
    ok('one device: no bulk panel (its own editor)', !shown('multiSelectionPane') && !shown('bulkPanel'));
    pick(phones());
    ok('a set of devices: the bulk panel', shown('multiSelectionPane') && shown('bulkPanel'));
    selectEntries([{ type: 'node', id: 'p1' }, { type: 'node', id: 'p2' }, { type: 'link', id: 'l1' }]);
    ok('a mixed set: counts and Delete only', shown('multiSelectionPane') && !shown('bulkPanel'));
    state.settings.advanced = false; applyProfile();
    pick(phones());
    ok('a reduced view: no bulk panel', !shown('bulkPanel'));
    state.settings.advanced = true; applyProfile();
    pick(phones());
    ok('back in the full editor it is there', shown('bulkPanel'));

    // ---- 2: Set fields ----
    const bulkKeys = NODE_FIELDS.filter((f) => f.bulk).map((f) => f.key);
    ok('its fields are the schema\'s bulk rows', bulkFields().map((f) => f.key).join(',') === bulkKeys.join(','), bulkKeys.join(','));
    ok('NAT is not offered on a set with no routing device', !el('bulkF-nat') && !!el('bulkF-os'));
    ok('a value they share is shown', el('bulkF-os').value === 'FW 1.0' && el('bulkF-type').value === 'voip');
    ok('a value they differ on says "mixed"', el('bulkF-notes').value === '' && el('bulkF-notes').placeholder === 'mixed');
    ok('so does a gateway only one of them overrides', el('bulkF-gw').placeholder === 'mixed');
    ok('nothing asked, nothing to preview', el('bulkPreviewBtn').disabled);
    ok('a field left as it is asks for nothing', Object.keys(readBulkEdits()).length === 0);
    type('bulkF-os', 'FW 2.0');
    ok('a field changed asks for that change, the others nothing', JSON.stringify(readBulkEdits()) === '{"os":{"text":"FW 2.0"}}', JSON.stringify(readBulkEdits()));
    ok('and Preview is offered', !el('bulkPreviewBtn').disabled);

    // ---- 3: the preview and Apply ----
    const undoBefore = _undoStack.length;
    el('bulkPreviewBtn').click();
    ok('Preview opens the dialog', dialogOpen() && CarinoUI.modal.isOpen(el('bulkDialog')));
    ok('titled with the action', el('bulkTitle').textContent === 'Set fields');
    ok('counted per device', /3\s*To change/.test(el('bulkCounts').textContent) && /0\s*Unchanged/.test(el('bulkCounts').textContent), el('bulkCounts').textContent);
    ok('every change is listed with its field', el('bulkPreview').querySelectorAll('tr.paste-change').length === 3 && /Model \/ firmware/.test(el('bulkPreview').textContent));
    ok('an OS changes no finding', /The findings stay the same/.test(el('bulkDelta').textContent), el('bulkDelta').textContent);
    ok('nothing is written before Apply', nodeByName('Phone 1').os === 'FW 1.0' && _undoStack.length === undoBefore);
    let saves = 0;
    const realSave = save;
    window.save = function () { if (!_batchDepth) saves++; return realSave.apply(this, arguments); };
    el('bulkApplyBtn').click();
    window.save = realSave;
    ok('Apply writes every one of them', phones().every((id) => getNode(id).os === 'FW 2.0'));
    ok('in one save and one undo step', saves === 1 && _undoStack.length === undoBefore + 1, `${saves} saves, ${_undoStack.length - undoBefore} steps`);
    ok('the dialog closes and the set stays selected', !dialogOpen() && selectedOf('node').length === 3 && shown('bulkPanel'));
    ok('the panel now shows what they hold', el('bulkF-os').value === 'FW 2.0' && !Object.keys(readBulkEdits()).length);
    undo();
    ok('one undo puts every one back', phones().every((id) => getNode(id).os === 'FW 1.0'));
    ok('and keeps the set', selectedOf('node').length === 3 && shown('bulkPanel'));

    // Clear, blank and invalid.
    el('bulkFields').querySelector('[data-clear="gw"]').click();
    ok('Clear marks the field for emptying', el('bulkF-gw').disabled && el('bulkF-gw').placeholder === 'will be cleared');
    let plan = bulkPlanSet(selectedOf('node'), readBulkEdits());
    ok('a cleared override empties it where it is set, and is "unchanged" elsewhere', plan.counts.change === 1 && plan.counts.same === 2, JSON.stringify(plan.counts));
    const cleared = plan.rows.find((r) => r.nodeId === 'p1');
    ok('and the preview says what it will use instead', cleared.before === '10.0.0.254' && cleared.after === '10.0.0.1 · from Office', `${cleared.before} -> ${cleared.after}`);
    el('bulkFields').querySelector('[data-clear="gw"]').click();
    ok('pressed again, it leaves the field alone', !el('bulkF-gw').disabled && !('gw' in readBulkEdits()));
    type('bulkF-gw', '10.0.0');
    el('bulkPreviewBtn').click();
    ok('an invalid value is refused for all of them', /10\.0\.0 is not a valid Gateway/.test(el('bulkMsgs').textContent) && el('bulkApplyBtn').disabled);
    closeBulkPreview();
    type('bulkF-gw', '10.9.9.9');
    el('bulkPreviewBtn').click();
    ok('the findings delta comes from the engine on a scratch copy', /Findings after this change:/.test(el('bulkDelta').textContent) && /\+\d/.test(el('bulkDelta').textContent), el('bulkDelta').textContent);
    ok('and the live document still has the old gateways', getNode('p2').gw === '' && getNode('p1').gw === '10.0.0.254');
    closeBulkPreview();
    type('bulkF-gw', '');

    // NAT on a set with a router in it.
    pick(['rt', 'p1']);
    ok('NAT is offered when a routing device is in the set, and says how many it applies to',
       !!el('bulkF-nat') && /Applies to 1 of them/.test(el('bulkF-nat').closest('.bulk-field').textContent));
    plan = bulkPlanSet(['rt', 'p1'], { nat: { text: 'false' } });
    ok('NAT is set on the router and left alone on the phone', plan.counts.change === 1 && plan.counts.skip === 1 && plan.ops.length === 1 && plan.ops[0].nodeId === 'rt');

    // A type change.
    plan = bulkPlanSet(phones(), { type: { text: 'pc' } });
    ok('a type is set like any field', plan.counts.change === 3 && plan.ops.every((op) => op.set.type === 'pc'));
    ok('a type that is not a device type is refused', bulkPlanSet(phones(), { type: { text: 'toaster' } }).errors.length === 1);

    // ---- 4: Rename ----
    const names = (p) => p.rows.filter((r) => r.status === 'change').map((r) => `${r.before}>${r.after}`).join(',');
    plan = bulkPlanRename(phones(), { pattern: 'TEL-{n:02}', order: 'name', start: '1' });
    ok('a pattern counts in name order, naturally (2 before 10)', names(plan) === 'Phone 1>TEL-01,Phone 2>TEL-02,Phone 10>TEL-03', names(plan));
    plan = bulkPlanRename(phones(), { pattern: 'TEL-{n}', order: 'port', start: '1' });
    ok('by switch port', names(plan) === 'Phone 10>TEL-1,Phone 1>TEL-2,Phone 2>TEL-3', names(plan));
    plan = bulkPlanRename(phones(), { pattern: 'TEL-{n:3}', order: 'position', start: '7' });
    ok('by place on the map (rows, then left to right), from a start number', names(plan) === 'Phone 2>TEL-007,Phone 10>TEL-008,Phone 1>TEL-009', names(plan));
    plan = bulkPlanRename(phones(), { pattern: '{name} (old)', order: 'name', start: '1' });
    ok('{name} is the current name', names(plan) === 'Phone 1>Phone 1 (old),Phone 2>Phone 2 (old),Phone 10>Phone 10 (old)', names(plan));
    plan = bulkPlanRename(['p1', 'p2', 'cam'], { find: 'PHONE', pattern: 'Tel', order: 'name', start: '1' });
    ok('find and replace, whatever the case; a name without it is unchanged', names(plan) === 'Phone 1>Tel 1,Phone 2>Tel 2' && plan.counts.same === 1, names(plan));
    plan = bulkPlanRename(phones(), { pattern: 'Desk', order: 'name', start: '1' });
    ok('one name for all is allowed, and said', plan.counts.change === 3 && plan.notes.some((m) => /Without \{n\}/.test(m)) && plan.notes.some((m) => /share a name/.test(m)));
    plan = bulkPlanRename(['p1', 'p2'], { pattern: 'Phone 10', order: 'name', start: '1' });
    ok('a name another device already has is warned about', plan.notes.some((m) => /share a name with another: 2/.test(m)), plan.notes.join(' | '));
    plan = bulkPlanRename(['p1', 'p2'], { find: 'phone 1', pattern: '', order: 'name', start: '1' });
    ok('a name replaced down to nothing is refused', plan.counts.bad === 1 && plan.counts.same === 1 && !plan.ops.length, JSON.stringify(plan.counts));
    // Through the panel.
    pick(phones());
    tab('rename');
    ok('the Rename tab shows its own fields', shown('bulkPane-rename') && !shown('bulkPane-set'));
    type('bulkPattern', 'TEL-{n:02}');
    el('bulkOrder').value = 'port'; el('bulkOrder').dispatchEvent(new Event('change', { bubbles: true }));
    const stepsBefore = _undoStack.length;
    el('bulkPreviewBtn').click();
    ok('the rename preview lists old and new names', /Phone 10/.test(el('bulkPreview').textContent) && /TEL-01/.test(el('bulkPreview').textContent));
    el('bulkApplyBtn').click();
    ok('renamed, in one undo step', getNode('p10').name === 'TEL-01' && getNode('p1').name === 'TEL-02' && getNode('p2').name === 'TEL-03' && _undoStack.length === stepsBefore + 1);
    ok('and the map says so', /TEL-01/.test(el('ui-node-p10').textContent));
    undo();
    ok('undo gives the names back', getNode('p10').name === 'Phone 10' && getNode('p1').name === 'Phone 1');

    // ---- 5: Move to a network ----
    plan = bulkPlanMove(phones(), 'n20');
    const moved = (p) => p.rows.filter((r) => r.field === 'IP / CIDR' && r.status === 'change').map((r) => `${r.name}>${r.after}`).join(',');
    ok('next free host, in name order, skipping the gateway, the camera and each other', moved(plan) === 'Phone 1>10.0.20.3/24,Phone 2>10.0.20.4/24,Phone 10>10.0.20.5/24', moved(plan));
    ok('an override outside the new network is cleared, so it inherits', plan.ops.find((o) => o.nodeId === 'p1').set.gw === '');
    ok('its own DNS goes too, since the network names resolvers', plan.ops.find((o) => o.nodeId === 'p1').set.dns === '');
    ok('and the preview says where they come from now', plan.rows.some((r) => r.field === 'Gateway' && /10\.0\.20\.1 · from Voice/.test(r.after)));
    plan = bulkPlanMove(['rt', 'cam', 'p1'], 'n20');
    ok('a router keeps its addresses; one already there is unchanged', plan.counts.skip === 1 && plan.counts.same === 1 && plan.counts.change === 1, JSON.stringify(plan.counts));
    plan = bulkPlanMove(phones(), 'n30');
    ok('a network with one free address takes one, and refuses the rest', plan.counts.change === 1 && plan.counts.bad === 2 && /No free address left in Tiny/.test(plan.rows.find((r) => r.status === 'bad').why));
    ok('no network, no move', bulkPlanMove(phones(), 'nope').errors.length === 1);
    // Planned only, never written: the two devices are taken out again below.
    state.nodes.push({ id: 'ap1', type: 'ap', name: 'AP', x: 0, y: 0, interfaces: [{ id: 'w1', name: 'wlan0', ip: '' }, { id: 'e1', name: 'eth0', ip: '' }] },
                     { id: 'lap', type: 'pc', name: 'Laptop', x: 0, y: 0, interfaces: [{ id: 'w', name: 'wlan0', ip: '' }, { id: 'e', name: 'eth0', ip: '' }] });
    plan = bulkPlanMove(['ap1', 'lap'], 'n20');
    ok('an access point with no address is left without one (its radio would become a hop)', plan.rows.find((r) => r.nodeId === 'ap1').status === 'skip' && !plan.ops.some((o) => o.nodeId === 'ap1'));
    ok('a laptop\'s wired port takes the address before its radio', plan.ops.find((o) => o.nodeId === 'lap').iface.id === 'e');
    state.nodes = state.nodes.filter((n) => n.id !== 'ap1' && n.id !== 'lap');
    // Through the panel.
    tab('move');
    ok('the Move tab lists the declared networks', shown('bulkPane-move') && el('bulkNet').options.length === 3 && !shown('bulkNoNets'));
    el('bulkNet').value = 'n20'; el('bulkNet').dispatchEvent(new Event('change', { bubbles: true }));
    const movesBefore = _undoStack.length;
    el('bulkPreviewBtn').click();
    ok('the move is titled with its network', el('bulkTitle').textContent === 'Move to Voice');
    ok('the delta is the engine\'s, before anything moves', el('bulkDelta').textContent.length > 0 && getNode('p1').interfaces[0].ip === '10.0.0.11/24');
    el('bulkApplyBtn').click();
    ok('moved, in one undo step', getNode('p1').interfaces[0].ip === '10.0.20.3/24' && getNode('p10').interfaces[0].ip === '10.0.20.5/24' && _undoStack.length === movesBefore + 1);
    ok('gateway and DNS now come from the network', effectiveGw(getNode('p1')) === '10.0.20.1' && effectiveDns(getNode('p1')) === '10.0.20.53' && getNode('p1').gw === '');
    ok('and they are members of it', networkMembers(networkById('n20')).length === 5);
    undo();
    ok('undo moves them back, override and all', getNode('p1').interfaces[0].ip === '10.0.0.11/24' && getNode('p1').gw === '10.0.0.254' && getNode('p1').dns === '1.1.1.1');
    // No network declared.
    replaceDocument(Object.assign(lab(), { networks: [] }), { origin: 'file' });
    pick(phones()); tab('move');
    ok('with no network declared, Move says to declare one', shown('bulkNoNets') && el('bulkPreviewBtn').disabled);
    open();

    // ---- 6: Delete ----
    pick(phones());
    const delBefore = _undoStack.length;
    el('deleteSelectionBtn').click();
    ok('Delete Selected on such a set previews first', dialogOpen() && el('bulkTitle').textContent === 'Delete' && getNode('p1'));
    ok('saying how many devices and cables go', /3\s*Devices to delete/.test(el('bulkCounts').textContent) && /3\s*Cables removed with them/.test(el('bulkCounts').textContent), el('bulkCounts').textContent);
    el('bulkApplyBtn').click();
    ok('Apply deletes them and their cables, in one step', !getNode('p1') && !getNode('p2') && !getNode('p10') && state.links.length === 1 && _undoStack.length === delBefore + 1);
    ok('the selection is empty', state.selection.size === 0);
    undo();
    ok('undo brings them back', !!getNode('p1') && state.links.length === 4);
    selectEntries([{ type: 'node', id: 'p1' }, { type: 'link', id: 'l2' }]);
    el('deleteSelectionBtn').click();
    ok('a mixed set is deleted at once, as before', !dialogOpen() && !getNode('p1') && !getLink('l2'));
    undo();
    pick(phones());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    ok('the Delete key does not ask', !dialogOpen() && !getNode('p1'));
    undo();

    // ---- 7: the draft ----
    pick(['p1', 'p2']); tab('set');
    type('bulkF-os', 'Draft OS');
    toggleSelected('node', 'p10');
    ok('a shift-click keeps what was typed', el('bulkF-os').value === 'Draft OS' && selectedOf('node').length === 3);
    select(null, null);
    pick(['p1', 'p2']);
    ok('a set that ended and began again starts clean', el('bulkF-os').value === 'FW 1.0');

    // Enter → Apply: the modal gives the focus back to the field Enter was
    // pressed in, and the panel must still be redrawn from what was written.
    el('bulkF-os').focus();
    type('bulkF-os', 'FW 3');
    el('bulkF-os').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    ok('Enter in a field opens the preview', dialogOpen());
    el('bulkApplyBtn').click();
    ok('after an Enter → Apply the field shows what was written', getNode('p1').os === 'FW 3' && el('bulkF-os').value === 'FW 3' && el('bulkF-os').dataset.initial === 'FW 3', el('bulkF-os').dataset.initial);
    ok('so nothing is asked and Preview is off', !Object.keys(readBulkEdits()).length && el('bulkPreviewBtn').disabled, JSON.stringify(readBulkEdits()));
    ok('and the focus is back in that field', document.activeElement === el('bulkF-os'));
    ok('the other rows were redrawn too ("mixed" is still mixed)', el('bulkF-notes').value === 'desk' && el('bulkF-gw').placeholder === 'mixed');
    document.activeElement.blur();
    undo();

    // ---- Cables: Set fields only, from LINK_FIELDS' bulk rows (Medium) and
    // the cable facts a run shares (CABLE_FIELDS' bulk rows: length, colour, via) ----
    const pickLinks = (ids) => selectEntries(ids.map((id) => ({ type: 'link', id })));
    el('bulkF-os').focus();   // a device field with the focus must not keep the devices' rows
    pickLinks(['l1', 'l2']);
    const linkKeys = LINK_FIELDS.filter((f) => f.bulk).map((f) => f.key).concat(CABLE_FIELDS.filter((f) => f.bulk).map((f) => `cable.${f.key}`));
    ok('a set of cables: the bulk panel, its fields the cable schema\'s bulk rows', shown('bulkPanel') && bulkFields('link').map((f) => f.key).join(',') === linkKeys.join(',') && !!el('bulkF-medium') && !el('bulkF-os'), linkKeys.join(','));
    const visibleTabs = [...el('bulkTabs').querySelectorAll('[data-bulk]')].filter((b) => !b.classList.contains('hidden')).map((b) => b.dataset.bulk);
    ok('with Set fields only (Rename and Move are about devices)', visibleTabs.join(',') === 'set' && shown('bulkPane-set') && !shown('bulkPane-rename'), visibleTabs.join(','));
    ok('a medium never given is shown as drawn (UTP)', el('bulkF-medium').value === 'utp');
    getLink('l2').medium = 'fiber'; save(); renderBulkPanel();
    ok('media that differ say "mixed"', el('bulkF-medium').value === '' && el('bulkF-medium').options[0].textContent === 'mixed');
    type('bulkF-medium', 'fiber');
    const undoLinks = _undoStack.length;
    el('bulkPreviewBtn').click();
    ok('the preview counts per cable and names it by its ends', dialogOpen() && /1\s*To change/.test(el('bulkCounts').textContent) && /1\s*Unchanged/.test(el('bulkCounts').textContent) && /SW-1 ↔ Phone 1/.test(el('bulkPreview').textContent), el('bulkCounts').textContent);
    ok('and says it is the same on every cable', /every cable/.test(el('bulkBlurb').textContent));
    el('bulkApplyBtn').click();
    ok('Apply sets the medium on every cable, in one undo step', getLink('l1').medium === 'fiber' && getLink('l2').medium === 'fiber' && _undoStack.length === undoLinks + 1);
    ok('and the panel shows it', el('bulkF-medium').value === 'fiber' && el('bulkPreviewBtn').disabled);
    ok('a medium that is not one of the five is refused', bulkPlanSet(['l1', 'l2'], { medium: { text: 'string' } }, 'link').errors.length === 1);
    undo();
    ok('one undo puts both back', !getLink('l1').medium && getLink('l2').medium === 'fiber');
    const linksBefore = state.links.length;
    el('deleteSelectionBtn').click();
    ok('a cable set\'s Delete still deletes at once, as before', !dialogOpen() && state.links.length === linksBefore - 2);
    undo();
    pick(['p1', 'p2']);
    // Every device tab again, but Wi-Fi: it is offered only to a set with a
    // device on Wi-Fi in it (Review-Packs/Topo-wifi.md), and these are wired.
    ok('back to devices: all three tabs again', [...el('bulkTabs').querySelectorAll('[data-bulk]')].every((b) => b.classList.contains('hidden') === (b.dataset.bulk === 'wifi')) && !!el('bulkF-os'));

    // ---- 8: words ----
    el('bulkF-os').focus();   // a field with the focus is redrawn too: its words change with the language
    setLocale('es'); applyLocale();
    ok('the sentences are translated', el('bulkPanel').querySelector('.bulk-title').textContent === 'Cambiarlos todos' && el('bulkF-gw').placeholder === 'mixto',
       `${el('bulkPanel').querySelector('.bulk-title').textContent} | ${el('bulkF-gw').placeholder}`);
    ok('the field labels stay English', /Model \/ firmware/.test(el('bulkFields').textContent) && /Gateway/.test(el('bulkFields').textContent));
    setLocale('en'); applyLocale();
    ok('and back', el('bulkPanel').querySelector('.bulk-title').textContent === 'Change all of them');

    // ---- A document from a newer Topo is read-only: nothing is applied ----
    replaceDocument(Object.assign(lab(), { v: DOC_VERSION + 1 }), { origin: 'file' });
    pick(phones()); tab('set');
    type('bulkF-os', 'FW 9');
    el('bulkPreviewBtn').click();
    ok('a read-only document opens no preview', !dialogOpen());
    ok('and a plan applied anyway writes nothing', applyBulkPlan(bulkPlanSet(phones(), { os: { text: 'FW 9' } })) === 0 && getNode('p1').os === 'FW 1.0');
    open();
    select(null, null);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
