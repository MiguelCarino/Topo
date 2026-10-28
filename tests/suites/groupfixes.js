// The Groups feature's last review round (Review-Packs/Topo-groups.md). What
// is held here:
//   1. a pasted Inside column is checked row by row against the moves above
//      it in the same paste, so two rows cannot make a loop together;
//   2. a group id with a quote in it (a hand-edited file, a CSV) still opens
//      its fields and collapses from the Groups tab;
//   3. the rack view's place dialog keeps a device's full depth, as Place
//      does; Clear its units frees the units only (it stays in the rack, with
//      its height and depth);
//   4. the changes since the last back-up list the groups themselves: added,
//      removed, renamed, re-kinded, moved inside another, a rack's height;
//   5. the top of a typed location path is a building, whatever it is
//      called, and HQ, site, campus and sede say so too;
//   6. a rack device cabled to many outside devices gathers its stubs by the
//      far group, and past that a "+N more";
//   7. a second cable between two devices in the rack view is said;
//   8. the exports: a frame tab without its ▾ closes up, and a collapsed
//      group spread wide does not widen the picture.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const savedView = state.settings.view;
  const errors = [];
  const onErr = (e) => errors.push(e.message || String(e));
  window.addEventListener('error', onErr);

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const office = () => ({ v: DOC_VERSION,
    nodes: [N('srv', 'server', { group: 'srvroom' }), N('pc', 'pc', { group: 'sales', x: 200 })],
    links: [],
    groups: [
      { id: 'hq', name: 'HQ', kind: 'building' },
      { id: 'f2', name: 'Floor 2', kind: 'floor', parent: 'hq' },
      { id: 'srvroom', name: 'Server room', kind: 'room', parent: 'f2' },
      { id: 'sales', name: 'Sales', kind: 'room', parent: 'f2' }
    ] });
  const toast = () => el('topoToast').textContent;

  try {
    // ---- 1: a pasted Inside column ----
    replaceDocument(office(), { origin: 'file', docId: 'gfix-paste' });
    const rows = tvBuildRows('groups');
    const row = (id) => rows.find((r) => r.ref.groupId === id);
    const plan = planPaste('g:parent', 'HQ / Floor 2 / Server room\nHQ / Floor 2 / Sales', { rows: [row('sales'), row('srvroom')], mode: 'selected' }, 'groups');
    ok('the first move is a change', plan.cells[0].status === 'change', json(plan.cells.map((c) => c.status)));
    ok('the second, a loop with the first, is refused', plan.cells[1].status === 'bad' && plan.counts.change === 1, json(plan.cells.map((c) => c.status)));
    applyPastePlan(plan);
    ok('applied: one move, no loop', groupById('sales').parent === 'srvroom' && groupById('srvroom').parent === 'f2'
       && groupPath(groupById('sales')) === 'HQ / Floor 2 / Server room / Sales');
    ok('no loop finding', !topologyFindings().some((f) => f.key === 'group' && f.level === 'bad'), json(topologyFindings().filter((f) => f.key === 'group')));
    ok('the serialized tree holds no loop', serializeDoc().groups.every((g) => groupParentOk(g.id, g.parent || null, serializeDoc().groups)));
    undo();
    const swap = planPaste('g:parent', 'HQ / Floor 2 / Sales\nHQ', { rows: [row('srvroom'), row('sales')], mode: 'selected' }, 'groups');
    ok('moves that do not close a loop all pass', swap.counts.change === 2, json(swap.cells.map((c) => c.status)));
    const single = TV_COLS.groups.find((c) => c.key === 'g:parent').parse('HQ / Floor 2 / Sales', row('srvroom'));
    ok('a single cell still reads against the live tree', single.value === 'sales');

    // ---- 2: a group id with a quote ----
    replaceDocument({ v: DOC_VERSION, nodes: [N('a', 'pc', { group: 'x"y' })], links: [], groups: [{ id: 'x"y', name: 'Odd', kind: 'room' }] }, { origin: 'file', docId: 'gfix-quote' });
    showConfigTab('groups');
    renderGroupsPanel(true);
    errors.length = 0;
    let threw = '';
    try { el('groupList').querySelector('[data-act="edit"]').click(); } catch (e) { threw = e.message; }
    const nameField = el('groupList').querySelector('[data-field="name"]');
    ok('Edit opens its fields and focuses the name', !threw && !errors.length && document.activeElement === nameField, threw || errors.join(' | '));
    try { el('groupList').querySelector('[data-act="collapse"]').click(); } catch (e) { threw = e.message; }
    ok('Collapse works too', !threw && !errors.length && isGroupCollapsed('x"y'), threw || errors.join(' | '));
    setGroupCollapsed('x"y', false);

    // ---- 3: placing keeps the depth; Clear its units ----
    replaceDocument({ v: DOC_VERSION,
      // big fills the depth (the default, not stored); the PDU at the back
      // and the patch panel are on one face (half depth).
      nodes: [N('big', 'server', { group: 'rk', rackHeight: 2 }), N('pdu', 'custom', { group: 'rk', rackU: 1, rackFace: 'rear', rackDepth: 'half', interfaces: [] }),
        N('pp', 'custom', { group: 'rk', rackDepth: 'half', interfaces: [] })],
      links: [], groups: [{ id: 'rk', name: 'Rack A', kind: 'rack', uHeight: 12 }] }, { origin: 'file', docId: 'gfix-depth' });
    setView('rack');
    openRackView('rk');
    ok('the dialog path refuses U1 front over the device behind', placeInRack('rk', { u: 1, height: 2, face: 'front' }, { nodeId: 'big' }) === null);
    placeInRack('rk', { u: 5, height: 2, face: 'front' }, { nodeId: 'big' });
    const big = getNode('big');
    ok('placed through the dialog, it is still full depth', big.rackU === 5 && big.rackHeight === 2 && rackFullDepth(big) && !('rackDepth' in big), json(big));
    placeInRack('rk', { u: 1, height: 1, face: 'front' }, { nodeId: 'pp' });
    ok('and a half-depth one is still half, in front of the PDU', getNode('pp').rackU === 1 && getNode('pp').rackDepth === 'half', json(getNode('pp')));
    selectEntries([{ type: 'node', id: 'big' }]);
    renderRackView(true);
    const out1 = el('rackView').querySelector('.rk-selbar [data-rk="out"]');
    ok('the button says what it does', out1.textContent.trim() === 'Clear its units' && /stays in this rack/.test(out1.title), out1.textContent);
    out1.click();
    ok('Clear its units: in the rack, no unit, height and depth kept', big.group === 'rk' && big.rackU === undefined && big.rackFace === undefined
       && big.rackHeight === 2 && rackFullDepth(big) && getNode('pp').rackDepth === 'half', json(big));
    setView('map');

    // ---- 4: the changes list the groups ----
    const base = office();
    const now = office();
    now.groups.find((g) => g.id === 'sales').name = 'Sales team';
    now.groups.find((g) => g.id === 'srvroom').parent = 'hq';
    now.groups.find((g) => g.id === 'f2').kind = 'room';
    now.groups.push({ id: 'rk', name: 'Rack 9', kind: 'rack', parent: 'srvroom', uHeight: 42 });
    const ch = CarinoChanges.docChanges(base, now);
    ok('a group added', ch.groups.added.length === 1 && ch.groups.added[0].name === 'HQ / Server room / Rack 9', json(ch.groups.added));
    const byName = (n) => ch.groups.changed.find((c) => c.id === n);
    ok('renamed, re-kinded, moved inside another', byName('sales').renamedFrom === 'Sales' && json(byName('srvroom').fields) === '["Inside"]'
       && json(byName('f2').fields) === '["Kind"]', json(ch.groups.changed));
    ok('each counted once', ch.total === 4, String(ch.total));
    const tall = office(); tall.groups.push({ id: 'rk', name: 'Rack 9', kind: 'rack', uHeight: 42 });
    const taller = office(); taller.groups.push({ id: 'rk', name: 'Rack 9', kind: 'rack', uHeight: 45 });
    const ch2 = CarinoChanges.docChanges(tall, taller);
    ok('a rack made taller', ch2.groups.changed.length === 1 && json(ch2.groups.changed[0].fields) === '["Height (U)"]', json(ch2.groups));
    const gone = CarinoChanges.docChanges(tall, office());
    ok('a group removed', gone.groups.removed.length === 1 && gone.groups.removed[0].name === 'Rack 9');
    const rowsOut = CarinoChanges.changeRows(ch).filter((r) => r.what === 'Group');
    ok('as rows of the list and the report', rowsOut.length === 4 && rowsOut.some((r) => r.op === 'Changed' && /renamed from Sales/.test(r.detail))
       && rowsOut.some((r) => r.op === 'Added' && r.name === 'HQ / Server room / Rack 9'), json(rowsOut));
    ok('nothing changed is nothing', CarinoChanges.docChanges(office(), office()).total === 0);

    // ---- 5: the top of a path is a building ----
    ok('HQ, site, campus, sede, branch say building', ['HQ', 'Main site', 'North campus', 'Sede Centro', 'Branch 4', '本社'].every((n) => guessGroupKind(n) === 'building'));
    ok('a name that says nothing is still its own kind', guessGroupKind('Sales') === 'custom' && guessGroupKind('Storage') === 'custom');
    replaceDocument({ v: DOC_VERSION, nodes: [N('a', 'pc', { location: 'Acme / Floor 2 / Sales' }), N('b', 'pc', { location: 'Reception' }),
      N('c', 'pc', { location: 'Annex' }), N('d', 'pc', { location: 'Annex / Room 4' })], links: [] }, { origin: 'file', docId: 'gfix-kind' });
    const lp = planGroupsFromLocations();
    const kindOf = (name) => (lp.groups.find((g) => g.name === name) || {}).kind;
    ok('the top of a longer path is a building', kindOf('Acme') === 'building' && kindOf('Floor 2') === 'floor' && kindOf('Sales') === 'custom', json(lp.groups));
    ok('a lone name stays custom', kindOf('Reception') === 'custom');
    ok('and becomes a building once a later path puts something in it', kindOf('Annex') === 'building' && kindOf('Room 4') === 'room');

    // ---- 6: stubs gathered by the far group ----
    const many = { v: DOC_VERSION, nodes: [N('sw', 'switch', { group: 'rk', rackU: 10, portCount: 48, interfaces: [] })], links: [],
      groups: [{ id: 'rk', name: 'Rack A', kind: 'rack', uHeight: 12 }, { id: 'off', name: 'Office', kind: 'room' }] };
    for (let i = 1; i <= 6; i++) {
      many.nodes.push(N(`pc${i}`, 'pc', { group: 'off', x: i * 50, y: 300 }));
      many.links.push({ id: `l${i}`, source: 'sw', target: `pc${i}`, sourceIface: `p${i}`, targetIface: 'i1' });
    }
    many.nodes.push(N('ap', 'ap', { x: 0, y: 400 }));
    many.links.push({ id: 'l9', source: 'sw', target: 'ap', sourceIface: 'p9', targetIface: 'i1' });
    replaceDocument(many, { origin: 'file', docId: 'gfix-stubs' });
    setView('rack');
    openRackView('rk');
    select(null);
    renderRackView(true);
    const stubText = [...el('rackView').querySelectorAll('.rk-lbl-stub')].map((b) => b.textContent.trim());
    ok('seven far devices: one stub per far group', json(stubText) === json(['→ Office · 6 devices', '→ Not in a group · 1 device']), json(stubText));
    const offStub = [...el('rackView').querySelectorAll('.rk-lbl-stub')].find((b) => /Office/.test(b.textContent));
    ok('it stands for all their cables, named in its tooltip', offStub.dataset.links.split(' ').length === 6 && /PC1, PC2/.test(offStub.title), offStub.title);
    offStub.click();
    ok('and selects them all', state.selection.size === 6 && [...state.selection].every((e) => e.type === 'link'));
    const few = rvStubsShown(rackCables(groupById('rk')).stubs.slice(0, 3));
    ok('few far devices: still one stub each', few.length === 3 && few.every((s) => s.far));
    for (let g = 1; g <= 5; g++) many.groups.push({ id: `r${g}`, name: `Room ${g}`, kind: 'room' });
    many.nodes.forEach((n, i) => { if (/^pc/.test(n.id)) n.group = `r${Math.min(i, 5)}`; });
    replaceDocument(many, { origin: 'file', docId: 'gfix-stubs2' });
    openRackView('rk');
    renderRackView(true);
    const capped = [...el('rackView').querySelectorAll('.rk-lbl-stub')].map((b) => b.textContent.trim());
    ok('many far groups: the biggest, then "+N more"', capped.length === RV_STUB_MAX && /^→ \+\d+ more$/.test(capped[capped.length - 1]), json(capped));

    // ---- 7: a second cable is said ----
    replaceDocument({ v: DOC_VERSION, nodes: [N('a', 'server', { group: 'rk', rackU: 1, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }] }),
      N('b', 'server', { group: 'rk', rackU: 3, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }] })],
      links: [{ id: 'l1', source: 'a', target: 'b', sourceIface: 'i1', targetIface: 'i1' }],
      groups: [{ id: 'rk', name: 'Rack A', kind: 'rack', uHeight: 12 }] }, { origin: 'file', docId: 'gfix-second' });
    openRackView('rk');
    el('topoToast').textContent = '';
    const second = createRackCable('a', 'b');
    ok('a second cable is made, and said', !!second && state.links.length === 2 && /A and B were already cabled: this is cable 2 between them/.test(toast()), toast());
    undo();
    ok('one undo takes it back', state.links.length === 1);
    setView('map');

    // ---- 8: the exports ----
    replaceDocument({ v: DOC_VERSION, nodes: [N('a', 'pc', { group: 'off', x: 0, y: 0 }), N('b', 'pc', { group: 'off', x: 2000, y: 0 }), N('c', 'pc', { x: 1000, y: 300 })],
      links: [], groups: [{ id: 'off', name: 'Office', kind: 'room' }] }, { origin: 'file', docId: 'gfix-export' });
    renderCanvasOnly();
    const svgOf = () => new DOMParser().parseFromString(canvasSvgMarkup(1).markup, 'image/svg+xml');
    const tabIn = (doc) => doc.querySelector('.grp-frame .grp-tab');
    const live = document.querySelector('#layer-groups .grp-tab');
    const tabX = tabIn(svgOf());
    ok('an exported tab closes up where its ▾ was', tabX.querySelector('.grp-tab-text').getAttribute('x') === '24'
       && Number(tabX.querySelector('.grp-tab-pill').getAttribute('width')) === Number(live.querySelector('.grp-tab-pill').getAttribute('width')) - GM_TAB_TOGGLE_W
       && live.querySelector('.grp-tab-text').getAttribute('x') === String(24 + GM_TAB_TOGGLE_W));
    const wide = canvasSvgMarkup(1).width;
    setGroupCollapsed('off', true);
    renderCanvasOnly();
    const folded = canvasSvgMarkup(1);
    ok('a collapsed group spread wide does not widen the picture', folded.width < wide - 500, `${folded.width} vs ${wide}`);
    setGroupCollapsed('off', false);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.removeEventListener('error', onErr);
    setDialogResponder(heldResponder);
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
