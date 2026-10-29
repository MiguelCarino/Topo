// The step-C exit test (Review-Packs/Topo-groups.md, step C): a rack built,
// cabled, folded and printed the way a person would, through the editor's
// own entry points, and checked at each stage.
//   1. build: a building, a floor, a server room and a 42U rack, made with
//      the Groups tab's Add (each name asked for); in the rack, through the
//      rack view's place, a switch near the top, ten 2U servers and a 3U UPS
//      at the bottom, all full depth as every rack device is by default (its
//      back on the rear; round 2, item 3); two PCs in an office;
//   2. cable it, patch-free: each server straight to the switch, drawn from
//      the switch's plug or with Cable to…, plus the PCs; the rack view then
//      draws ten lines and two stubs, each labelled with its ports;
//   3. fold the rack on the map: the cables inside it gone, one line per
//      outside end, and with the office folded too, one line ×2; a server put
//      over another (the device editor's U field) is a critical finding,
//      which the folded rack carries as its worst, with the count;
//   4. export the CSV sheets and import them into a blank map: groups,
//      devices, interfaces, cables, with nothing lost (every device's every
//      field, every cable, every group, the same findings);
//   5. print the report: the Racks section with the rack's front and rear
//      elevations, the switch, the servers and the UPS (and its back) in
//      them, and its patch schedule, a row per cable (Round 5).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const answers = [];
  const heldResponder = setDialogResponder((req) => (answers.length ? answers.shift() : null));
  const heldDeliver = window.deliverReport;
  const delivered = [];
  window.deliverReport = (html) => { delivered.push(html); return { opened: true }; };
  const savedView = state.settings.view;
  const view = () => el('rackView');
  const dev = (id) => view().querySelector(`.rk-dev:not(.rk-back)[data-node="${id}"]`);
  const byName = (name) => state.nodes.find((n) => n.name === name);
  const rename = (node, name) => batch(() => { node.name = name; save(); });
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };

  try {
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file', docId: 'rack-exit' });

    // ---- 1: build ----
    answers.push('HQ');
    const hq = await addGroup(null);
    answers.push('Ground floor');
    const floor = await addGroup(hq.id);
    answers.push('Server room');
    const room = await addGroup(floor.id);
    answers.push('Rack 1');
    const rack = await addGroup(room.id);
    answers.push('Office');
    const office = await addGroup(floor.id);
    ok('the groups, each kind from its parent', [hq, floor, room, rack, office].map((g) => g.kind).join() === 'building,floor,room,rack,room'
       && groupPath(rack) === 'HQ / Ground floor / Server room / Rack 1');
    ok('a new rack is 42U', rack.uHeight === 42 && rackTop(rack) === 42);
    ok('the switch offers the rack view', rackViewOffered() && !document.querySelector('#viewSwitch [data-view="rack"]').hidden);
    openRackView(rack.id);
    const sw = placeInRack(rack.id, { u: 40, height: 1, face: 'front' }, { type: 'switch' });
    rename(sw, 'SW-CORE');
    const servers = [];
    for (let i = 1; i <= 10; i++) {
      const s = placeInRack(rack.id, { u: 4 + (i - 1) * 3, height: 2, face: 'front' }, { type: 'server' });
      rename(s, `SRV-${String(i).padStart(2, '0')}`);
      servers.push(s);
    }
    const ups = placeInRack(rack.id, { u: 1, height: 3, face: 'front' }, { type: 'custom' });
    rename(ups, 'UPS-1');
    selectEntries([{ type: 'node', id: ups.id }]);
    renderRackView(true);
    ok('twelve devices in the rack, each where it was put', rackMembers(rack).length === 12 && sw.rackU === 40
       && servers.every((s, i) => s.rackU === 4 + i * 3 && s.rackHeight === 2) && ups.rackU === 1 && ups.rackHeight === 3);
    ok('the UPS at the bottom, full depth by default: its back on the rear', !('rackDepth' in ups) && rackFullDepth(ups)
       && !!view().querySelector(`.rk-dev.rk-back[data-node="${ups.id}"]`) && view().querySelector('.rk-selbar [data-rk="depth"]').getAttribute('aria-pressed') === 'true');
    ok('and so is every server: the rear is their backs', servers.every((s) => rackFullDepth(s) && !!view().querySelector(`.rk-dev.rk-back[data-node="${s.id}"]`)));
    ok('no units taken twice: nothing to find', rackOverlaps(rack).length === 0 && !topologyFindings().some((f) => f.key === 'rack'));
    const pcs = ['PC-1', 'PC-2'].map((name, i) => {
      let n = null;
      batch(() => { n = spawnNodeNow('pc', { at: { x: 600 + i * 120, y: 500 } }); n.name = name; n.group = office.id; save(); });
      return n;
    });

    // ---- 2: cable it ----
    const before = _undoStack.length;
    // The first from the switch's plug, dragged to the server, as a person
    // would: the server is further down than the pane shows, so the pointer
    // rests at the pane's bottom edge, which scrolls it, until it is in sight.
    renderRackView(true);
    const main = view().querySelector('.rk-main');
    main.scrollTop = 0;
    const plug = dev(sw.id).querySelector('.rk-plug');
    const pr = plug.getBoundingClientRect();
    const P = (type, target, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 3, pointerType: 'mouse', isPrimary: true }));
    P('pointerdown', plug, pr.left + pr.width / 2, pr.top + pr.height / 2);
    P('pointermove', window, pr.left, pr.top + 20);
    const mr = main.getBoundingClientRect();
    let tr = dev(servers[9].id).getBoundingClientRect(), steps = 0;
    while (tr.top + tr.height / 2 > mr.bottom - 40 && steps++ < 80) {
      P('pointermove', window, tr.left + tr.width / 2, mr.bottom - 4);
      tr = dev(servers[9].id).getBoundingClientRect();
    }
    ok('held at the pane\'s edge, the pane scrolls down to it', main.scrollTop > 0 && tr.top + tr.height / 2 <= mr.bottom - 40, `${main.scrollTop} ${steps}`);
    P('pointermove', window, tr.left + tr.width / 2, tr.top + tr.height / 2);
    P('pointerup', window, tr.left + tr.width / 2, tr.top + tr.height / 2);
    ok('dragged from the switch\'s plug to a server: cabled', state.links.length === 1 && state.links[0].source === sw.id && state.links[0].target === servers[9].id,
       json({ links: state.links, pr: [pr.left, pr.top, pr.width], tr: [tr.left, tr.top, tr.width], at: (document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2) || {}).className, shown: rackShown(), inner: [innerWidth, innerHeight] }));
    ok('and the rail shows its port picker', state.selectedType === 'link' && !el('linkPortProps').classList.contains('hidden'));
    await new Promise((r) => setTimeout(r, 0));
    // The rest with Cable to… and a tap, from the switch each time.
    servers.slice(0, 9).forEach((s) => {
      selectEntries([{ type: 'node', id: sw.id }]);
      renderRackView(true);
      view().querySelector('.rk-selbar [data-rk="cable"]').click();
      dev(s.id).click();
    });
    pcs.forEach((pc) => createRackCable(sw.id, pc.id));
    ok('twelve cables, one undo step each', state.links.length === 12 && _undoStack.length === before + 12);
    ok('patch-free: each straight from the switch, on its own port', state.links.every((l) => l.source === sw.id && !cableOf(l, 'via'))
       && new Set(state.links.map((l) => l.sourceIface)).size === 12);
    batch(() => { setCableField(state.links[0], 'label', 'C-10'); setCableField(state.links[0], 'color', 'green'); save(); });
    select(null);
    renderRackView(true);
    // Round 5: a line per cable, port to port, a tag at each end.
    const lines = [...view().querySelectorAll('.rk-cable')];
    const tag = (l, at) => [...view().querySelectorAll(`.rk-flag[data-key="${l.id}"]`)].find((b) => b.dataset.node === at);
    ok('the rack view: ten lines, one per server, and one out of the rack per PC', lines.filter((g) => !g.classList.contains('rk-out')).length === 10
       && pcs.every((pc) => tag(state.links.find((x) => x.target === pc.id), sw.id).textContent.trim().startsWith(`→ ${pc.name} · `)));
    ok('each tagged with its ports at the server (its label, the one that has one)', servers.every((s) => {
      const l = state.links.find((x) => x.target === s.id);
      const b = tag(l, s.id);
      return b && b.textContent.trim() === (cableOf(l, 'label') || `${ifaceLabel(s, l.targetIface)} ↔ ${ifaceLabel(sw, l.sourceIface)}`);
    }));
    ok('and with its label when set', tag(state.links[0], sw.id).textContent.trim() === 'C-10');

    // ---- 3: fold it on the map ----
    setView('map');
    setGroupCollapsed(rack.id, true);
    let gv = groupMapView();
    ok('folded: every device in the rack is hidden in it', rackMembers(rack).every((n) => gv.hidden.get(n.id) === rack.id));
    ok('its cables inside gone, one line per outside end', gv.edges.length === 2 && gv.edges.every((e) => e.links.length === 1)
       && state.links.filter((l) => l.target !== pcs[0].id && l.target !== pcs[1].id).every((l) => gv.covered.has(l.id)
         && !gv.edges.some((e) => e.links.includes(l))));
    setGroupCollapsed(office.id, true);
    gv = groupMapView();
    const counts = [...el('layer-links').querySelectorAll('.grp-edge-count')].map((x) => x.textContent);
    ok('with the office folded too: one line, ×2', gv.edges.length === 1 && gv.edges[0].links.length === 2 && counts.join() === '×2', counts.join());
    ok('no finding yet: no badge', !el(`ui-group-${rack.id}`).querySelector('.grp-node-badge'));
    // A server put over another, in the device editor's U field.
    select(servers[1].id, 'node');
    el('propRackU').value = String(servers[0].rackU + 1);
    el('propRackU').dispatchEvent(new Event('input', { bubbles: true }));
    el('propRackU').dispatchEvent(new Event('change', { bubbles: true }));
    const over = topologyFindings().filter((f) => f.key === 'rack' && !f.accepted);
    ok('a server over another is a critical finding naming both', over.length === 1 && over[0].level === 'bad'
       && json(over[0].nodeIds.slice().sort()) === json([servers[0].id, servers[1].id].sort()), json(over));
    renderCanvasOnly();
    const mine = topologyFindings().filter((f) => !f.accepted && f.nodeIds.some((id) => rackMembers(rack).some((n) => n.id === id)));
    const badge = el(`ui-group-${rack.id}`).querySelector('.grp-node-badge');
    ok('the folded rack carries it: the worst, and how many', !!badge && badge.getAttribute('data-severity') === 'bad' && badge.textContent === String(mine.length),
       `${badge && badge.textContent} vs ${mine.length}`);
    undo();
    // An undo rebuilds the devices from the timeline: asked for again by id.
    ok('undone: the server back, the badge gone', getNode(servers[1].id).rackU === 7 && (renderCanvasOnly(), !el(`ui-group-${rack.id}`).querySelector('.grp-node-badge')));
    setGroupCollapsed(rack.id, false);
    setGroupCollapsed(office.id, false);

    // ---- 4: CSV out and back in ----
    const devSig = () => state.nodes.map((n) => json(serializeNode(n))).sort().join('\n');
    const grpSig = () => json(serializeGroups(state.groups).slice().sort((a, b) => a.id.localeCompare(b.id)));
    const cabSig = () => state.links.map((l) => json([l.source, l.sourceIface, l.target, l.targetIface, l.cable || null, l.medium || null])).sort().join('\n');
    const fSig = () => topologyFindings().map((f) => `${f.check}|${f.subject}|${f.detail}`).sort().join('\n');
    const want = { dev: devSig(), grp: grpSig(), cab: cabSig(), f: fSig() };
    const sheets = [csvGroupsSheet(), csvDevicesSheet(), csvInterfacesSheet(), csvCablesSheet()].map((s) => csvText(s));
    ok('devices.csv carries the group path and the rack fields', /HQ \/ Ground floor \/ Server room \/ Rack 1/.test(sheets[1]) && /rack_u,rack_height,rack_face,rack_depth/.test(sheets[1]));
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file', docId: 'rack-exit-blank' });
    const conflicts = [];
    sheets.forEach((text) => {
      const s = sheetOf(text);
      const plan = csvPlan(s, csvAutoMap(s));
      plan.rows.filter((r) => r.status === 'conflict').forEach((r) => conflicts.push(`${r.name}: ${r.why}`));
      applyCsvPlan(plan);
    });
    const got = { dev: devSig(), grp: grpSig(), cab: cabSig(), f: fSig() };
    const lost = Object.keys(want).filter((k) => want[k] !== got[k]);
    ok('imported into a blank map with nothing lost', !conflicts.length && !lost.length,
       `${conflicts.slice(0, 2).join(' | ')} ${lost.map((k) => { const a = want[k].split('\n'), b = got[k].split('\n'); const i = a.findIndex((x, j) => x !== b[j]); return `${k}: ${a[i]} ≠ ${b[i]}`; }).join(' ; ').slice(0, 600)}`);
    const back = groupById(rack.id);
    ok('the rack again, its devices in their units', isRackGroup(back) && rackMembers(back).length === 12 && rackFullDepth(byName('UPS-1')) && !('rackDepth' in byName('UPS-1'))
       && byName('SRV-10').rackU === 31 && rackSchedule(back).length === 12 && rackSchedule(back).filter((r) => !r.farIn).length === 2);

    // ---- 5: print the report ----
    openRackView(rack.id);
    await generateSiteReport();
    const html = delivered[delivered.length - 1] || '';
    ok('the report was made', html.length > 1000);
    const racks = html.split('<h2>Racks</h2>')[1] || '';
    ok('it has a Racks section', !!racks && /HQ \/ Ground floor \/ Server room \/ Rack 1 <span class="muted">42U · 19″<\/span>/.test(racks));
    const elevs = racks.split('<table class="elev">').slice(1).map((t) => t.split('</table>')[0]);
    ok('with both elevations, front and rear', elevs.length === 2 && elevs[0].includes('<th colspan="2">Front</th>') && elevs[1].includes('<th colspan="2">Rear</th>'));
    ok('a unit a row, 42 of them, on each', elevs.every((e) => (e.match(/<td class="ru">/g) || []).length === 42));
    ok('the switch and every server on the front, each over its units', elevs[0].includes('<b>SW-CORE</b>')
       && servers.every((s) => elevs[0].includes(`<b>${s.name}</b>`)) && (elevs[0].match(/rowspan="2"/g) || []).length === 10);
    ok('the UPS at the bottom of the front, and its back on the rear', /rowspan="3"><b>UPS-1<\/b>/.test(elevs[0]) && /class="rs back" rowspan="3"><b>UPS-1<\/b>/.test(elevs[1]));
    // Round 5 (R5b): its patch schedule, a row per cable (it was a line per
    // device pair), each read from the switch at the top.
    ok('and the rack\'s patch schedule under them', (racks.split('class="patch"')[1] || '').split('</table>')[0].split('<tr><td class="mono">SW-CORE · ').length === 13);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    window.deliverReport = heldDeliver;
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
