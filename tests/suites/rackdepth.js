// Full depth by default (Review-Packs/Topo-groups.md, "Round 2", item 3;
// rackDepth in js/model.js, the rack view's place dialog in js/rackview.js).
// Every device in a rack fills its depth unless it is set to one face (half
// depth), stored as rackDepth 'half'; full is not stored. What is held here:
//   1. the v7 -> v8 step: v7's 'full' and v7's nothing (shallow) both become
//      nothing, full depth, as the owner asked; the input is not touched; a
//      v7 rack opened here is all full depth, and two devices that shared
//      units front and rear in v7 are now an overlap the findings name;
//   2. the loader: 'half' kept, a hand-written 'full' or a junk word dropped
//      (both read as full); the document saved, exported and opened again,
//      and Undo, keep it;
//   3. the drawing and the selected device's button: a device with nothing
//      stored has its back on the other face, a half-depth one does not;
//   4. the place dialog: Full depth ticked by default, unticked by itself on
//      units free on one face only, and the box decides the depth of what is
//      placed, a new device or one already on the map; one undo step; the
//      box is worked out again as the unit or face is edited, until it is
//      changed by hand;
//   5. the words: the place text (which is the table's Group cell and the
//      spreadsheet's), the report and the findings say "half depth" for the exception and nothing for the
//      default; es, pt-BR, ja and ru have the words;
//   6. a migrated front and rear pair: on each face the other's back is a
//      strip that takes no pointer, so a click selects the device mounted
//      there and its Full depth button fixes the right one;
//   5b. a spreadsheet's "Half depth" column: its yes is half depth, the
//      opposite of a "Full depth" or "Rack depth" column's yes;
//   7. brought in from the lists (Place, or a drag, through rvFitDepth): a
//      full-depth device with room on one face only goes in at half depth,
//      says so, one undo step, rather than refused.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const groups = [{ id: 'room', name: 'Server room', kind: 'room' }, { id: 'rk', name: 'Rack 1', kind: 'rack', parent: 'room', uHeight: 24 }];
  const view = () => el('rackView');
  const dev = (id) => view().querySelector(`.rk-dev:not(.rk-back)[data-node="${id}"]`);
  const back = (id) => view().querySelector(`.rk-dev.rk-back[data-node="${id}"]`);
  const rackFindings = () => topologyFindings().filter((f) => f.key === 'rack');
  const undoDepth = () => _undoStack.length;
  const input = (id, v) => { el(id).value = v; el(id).dispatchEvent(new Event('input', { bubbles: true })); };
  const tickBox = (id, on) => { el(id).checked = on; el(id).dispatchEvent(new Event('change', { bubbles: true })); };

  try {
    // ---- 1: the v7 -> v8 step ----
    const v7 = { v: 7, nodes: [
        N('srv', 'server', { group: 'rk', rackU: 10, rackHeight: 2, rackDepth: 'full' }),
        N('sw', 'switch', { group: 'rk', rackU: 20, interfaces: [] }),
        N('pp', 'custom', { group: 'rk', rackU: 20, rackFace: 'rear', interfaces: [] }),
        null
      ], links: [], groups };
    const v7copy = json(v7);
    const m = migrateDoc(v7);
    ok('a v7 document is taken to the current version', DOC_VERSION >= 8 && m.doc.v === DOC_VERSION && m.from === 7 && !m.newer);
    ok('its full and its nothing both become nothing: full depth', m.doc.nodes.slice(0, 3).every((n) => !('rackDepth' in n)), json(m.doc.nodes));
    ok('the rest of each device as it was, junk passed through', m.doc.nodes[0].rackU === 10 && m.doc.nodes[2].rackFace === 'rear' && m.doc.nodes[3] === null
       && m.doc.nodes[1] === v7.nodes[1]);
    ok('the input is not touched', json(v7) === v7copy);
    ok('a v8 step does nothing to a v8 document', json(migrateDoc({ v: 8, nodes: [N('a', 'pc', { rackDepth: 'half' })], links: [] }).doc.nodes[0].rackDepth) === '"half"');

    replaceDocument(JSON.parse(v7copy), { origin: 'file', docId: 'depth-v7' });
    ok('opened: every rack device full depth', ['srv', 'sw', 'pp'].every((id) => rackFullDepth(getNode(id)) && !('rackDepth' in getNode(id))));
    ok('saved as v8 with no depth stored', serializeDoc().v === DOC_VERSION && !/rackDepth/.test(json(serializeDoc())));
    let rf = rackFindings();
    ok('a switch and a panel that shared U20 front and rear now overlap, and the finding says both must be half depth', rf.length === 1
       && json(rf[0].nodeIds.sort()) === json(['pp', 'sw']) && /both fill the rack front to back\. To share them, set both to half depth\./.test(rf[0].detail), json(rf));
    // One of them made half depth: still in the other's way, and the
    // finding says which way round now.
    batch(() => { getNode('pp').rackDepth = 'half'; save(); });
    rf = rackFindings();
    ok('one made half: still an overlap, now the one-fills wording', rf.length === 1 && /one of them fills the rack front to back\.$/.test(rf[0].detail), json(rf));
    batch(() => { getNode('sw').rackDepth = 'half'; save(); });
    ok('set to one face each, they share the units again', rackFindings().length === 0, json(rackFindings()));
    undo(); undo();

    // ---- 2: the loader and the round trips ----
    const v8 = () => ({ v: DOC_VERSION, nodes: [
        N('srv', 'server', { x: 0, y: 0, group: 'rk', rackU: 10, rackHeight: 2 }),
        N('pp', 'custom', { x: 100, y: 0, group: 'rk', rackU: 20, rackDepth: 'half', interfaces: [] }),
        N('pdu', 'custom', { x: 200, y: 0, group: 'rk', rackU: 20, rackFace: 'rear', rackDepth: 'half', interfaces: [] }),
        N('odd', 'server', { x: 300, y: 0, group: 'rk', rackU: 5, rackDepth: 'full' }),
        N('junk', 'server', { x: 400, y: 0, group: 'rk', rackU: 1, rackDepth: 'sideways' }),
        N('nas', 'server', { x: 500, y: 0, group: 'rk' })
      ], links: [], groups });
    replaceDocument(v8(), { origin: 'file', docId: 'depth-v8' });
    ok('half is kept', getNode('pp').rackDepth === 'half' && getNode('pdu').rackDepth === 'half');
    ok('a hand-written full and a junk word are dropped: both full', !('rackDepth' in getNode('odd')) && !('rackDepth' in getNode('junk'))
       && rackFullDepth(getNode('odd')) && rackFullDepth(getNode('junk')));
    ok('a panel and a PDU on one face each share U20 with no finding', rackFindings().length === 0, json(rackFindings()));
    const saved = json(serializeDoc());
    replaceDocument(JSON.parse(saved), { origin: 'file', docId: 'depth-again' });
    ok('exported and opened again, the same document', json(serializeDoc()) === saved);
    ok('a block carries no depth', !('rackDepth' in dropBlockPlace(cloneData(getNode('pp')))));

    // ---- 3: the drawing and the button ----
    setView('rack');
    openRackView('rk');
    select(null);
    renderRackView(true);
    ok('a device with nothing stored has its back on the rear', !!back('srv') && back('srv').closest('.rk-slots').dataset.face === 'rear');
    ok('a half-depth one has none', !back('pp') && !back('pdu') && dev('pdu').closest('.rk-slots').dataset.face === 'rear');
    ok('the box says which, in its title', /full depth/.test(dev('srv').title) && /half depth/.test(dev('pp').title));
    selectEntries([{ type: 'node', id: 'srv' }]);
    renderRackView(true);
    const depthBtn = () => view().querySelector('.rk-selbar [data-rk="depth"]');
    ok('its Full depth button is pressed, and says what a press does', depthBtn().getAttribute('aria-pressed') === 'true' && /half depth/.test(depthBtn().title));
    let d0 = undoDepth();
    depthBtn().click();
    ok('pressed: half, one step, no back', getNode('srv').rackDepth === 'half' && !back('srv') && undoDepth() === d0 + 1);
    depthBtn().click();
    ok('pressed again: full, nothing stored', !('rackDepth' in getNode('srv')) && !!back('srv') && undoDepth() === d0 + 2);
    undo(); undo();
    ok('undone twice, as it was', !('rackDepth' in getNode('srv')) && undoDepth() === d0);

    // ---- 4: the place dialog ----
    select(null);
    renderRackView(true);
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 14, height: 1 });
    ok('Full depth is ticked on units free on both faces', !el('rackPlaceDialog').hidden && el('rackPlaceFull').checked
       && /U14 front, full depth/.test(el('rackPlaceMsg').textContent), el('rackPlaceMsg').textContent);
    tickBox('rackPlaceFull', false);
    ok('unticked, the message says half depth', /U14 front, half depth/.test(el('rackPlaceMsg').textContent));
    // NAS: no depth stored (full); placed with the box unticked it is half.
    d0 = undoDepth();
    [...el('rackPlaceList').querySelectorAll('.rkp-item')].find((b) => b.dataset.node === 'nas').click();
    ok('the box decides: a device placed unticked is half depth', getNode('nas').rackU === 14 && getNode('nas').rackDepth === 'half' && undoDepth() === d0 + 1);
    undo();
    ok('one undo step takes it back', getNode('nas').rackU === undefined && !('rackDepth' in getNode('nas')));
    // The PDU moved up out of the way: U20 rear is then free behind the
    // half-depth panel, and only something on one face fits there.
    batch(() => { getNode('pdu').rackU = 22; save(); });
    // Asked for there with the pointer: a press and a release on the unit,
    // then the click. Not refused for the full depth a new device would
    // have; the dialog unticks the box instead.
    renderRackView(true);
    const slots = view().querySelector('.rk-slots[data-face="rear"]');
    const sr = slots.getBoundingClientRect();
    const x = sr.left + sr.width / 2, y = sr.top + sr.height - (20 - 0.5) * (sr.height / 24);
    const P = (type, target) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 5, pointerType: 'mouse', isPrimary: true }));
    el('topoToast').textContent = '';
    P('pointerdown', slots); P('pointerup', slots);
    slots.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    ok('a tap on the unit behind a half-depth device asks, not refused', !el('rackPlaceDialog').hidden && el('rackPlaceU').value === '20'
       && el('rackPlaceFace').value === 'rear' && !/taken/.test(el('topoToast').textContent), el('topoToast').textContent);
    closePlaceDialog();
    openPlaceDialog({ rackId: 'rk', face: 'rear', u: 20, height: 1 });
    ok('behind a half-depth device, unticked by itself: half is all that fits', !el('rackPlaceFull').checked
       && /U20 rear, half depth/.test(el('rackPlaceMsg').textContent) && !el('rackPlaceNewBtn').disabled, el('rackPlaceMsg').textContent);
    tickBox('rackPlaceFull', true);
    ok('ticked there, refused with why, nothing can be picked', /taken by PP/.test(el('rackPlaceMsg').textContent) && el('rackPlaceNewBtn').disabled
       && [...el('rackPlaceList').querySelectorAll('.rkp-item')].every((b) => b.disabled), el('rackPlaceMsg').textContent);
    tickBox('rackPlaceFull', false);
    el('rackPlaceType').value = 'switch';
    d0 = undoDepth();
    const before = state.nodes.length;
    el('rackPlaceNewBtn').click();
    const made = state.nodes[state.nodes.length - 1];
    ok('Add makes it half depth on the rear, one step', state.nodes.length === before + 1 && made.type === 'switch' && made.rackU === 20
       && made.rackFace === 'rear' && made.rackDepth === 'half' && undoDepth() === d0 + 1 && rackFindings().length === 0, json(made));
    undo();
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 16, height: 1 });
    el('rackPlaceType').value = 'server';
    el('rackPlaceNewBtn').click();
    const srv2 = state.nodes[state.nodes.length - 1];
    ok('a new one left ticked is full depth, nothing stored', srv2.rackU === 16 && !('rackDepth' in srv2) && rackFullDepth(srv2));
    undo();
    // The box follows the fields: moved onto units behind a half-depth
    // device it unticks itself, moved back it ticks again; once changed by
    // hand it keeps what it says.
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 14, height: 1 });
    input('rackPlaceU', '20'); el('rackPlaceFace').value = 'rear'; el('rackPlaceFace').dispatchEvent(new Event('change', { bubbles: true }));
    ok('edited to U20 rear behind the half-depth panel, unticked by itself and not refused', !el('rackPlaceFull').checked
       && /U20 rear, half depth/.test(el('rackPlaceMsg').textContent) && !el('rackPlaceNewBtn').disabled, el('rackPlaceMsg').textContent);
    input('rackPlaceU', '14');
    ok('edited back to U14, ticked again', el('rackPlaceFull').checked && /U14 rear, full depth/.test(el('rackPlaceMsg').textContent), el('rackPlaceMsg').textContent);
    tickBox('rackPlaceFull', false);
    input('rackPlaceU', '15');
    ok('unticked by hand, it stays unticked as the fields change', !el('rackPlaceFull').checked && /U15 rear, half depth/.test(el('rackPlaceMsg').textContent), el('rackPlaceMsg').textContent);
    closePlaceDialog();
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 14, height: 1 });
    ok('opened again, the box is worked out afresh', el('rackPlaceFull').checked);
    closePlaceDialog();
    ok('placeInRack with no depth asked: a new one fills it', (() => { const n = placeInRack('rk', { u: 17, height: 1, face: 'front' }, { type: 'server' }); const r = !!n && !('rackDepth' in n); undo(); return r; })());
    ok('and one already there keeps its own', (() => { const n = placeInRack('rk', { u: 17, height: 1, face: 'front' }, { nodeId: 'pp' }); const r = !!n && n.rackDepth === 'half'; undo(); return r; })());
    undo();   // the PDU back to U20 rear

    // ---- 5: the words ----
    ok('the place text says only the exception', rackSpanText(getNode('srv')) === 'U10–U11 front' && rackSpanText(getNode('pp')) === 'U20 front, half depth'
       && nodePlaceText(getNode('pdu')) === 'Server room / Rack 1 · U20 rear, half depth');
    const model = reportModel();
    const items = model.racks[0].faces.flatMap((f) => f.rows.flatMap((r) => r.items || []));
    const html = reportHtml(model, null);
    ok('the report tags the half-depth ones, not the full', items.some((i) => i.name === 'PP' && !i.full) && items.some((i) => i.name === 'SRV' && i.full)
       && /PP<\/b> <span class="muted">[^<]*half depth/.test(html) && !/full depth/.test(html));
    for (const [lang, word] of [['es', 'media profundidad'], ['pt-BR', 'meia profundidade'], ['ru', 'на полглубины'], ['ja', 'ハーフ奥行き']]) {
      setLocale(lang);
      ok(`${lang}: half depth has its word`, rackSpanText(getNode('pp')).endsWith(word) && t('Make it half depth: it takes its units on one face') !== 'Make it half depth: it takes its units on one face',
        rackSpanText(getNode('pp')));
    }
    setLocale('en'); applyStaticI18n();

    // A "Half depth" column answers the opposite question: its yes is half,
    // its no full. A "Full depth" column's yes is full, its no half.
    {
      const sh = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
      const dep = (p, i) => (p.rows[i].changes.find((c) => c.field === 'Rack depth') || {}).after || 'same';
      const half = sh('name,Half depth\nSRV,yes\nPP,no');
      const hp = csvPlan(half, csvAutoMap(half));
      ok('a Half depth column: yes is half, no is full', csvAutoMap(half)[1] === 'rackDepth' && dep(hp, 0) === 'half depth' && dep(hp, 1) === 'full depth',
        json(hp.rows.map((r) => r.changes)));
      const full = sh('name,Full depth\nSRV,yes\nPP,no');
      const fp = csvPlan(full, csvAutoMap(full));
      ok('a Full depth column: yes is full, no is half', dep(fp, 0) === 'same' && dep(fp, 1) === 'same', json(fp.rows.map((r) => r.changes)));
      const words = sh('name,half depth\nSRV,half\nPP,full');
      const wp = csvPlan(words, csvAutoMap(words));
      ok('under a Half depth heading the words still read as they say', dep(wp, 0) === 'half depth' && dep(wp, 1) === 'full depth', json(wp.rows.map((r) => r.changes)));
      const shallow = sh('name,shallow\nSRV,✓');
      ok('a Shallow column mapped by hand: a tick is half', dep(csvPlan(shallow, ['name', 'rackDepth']), 0) === 'half depth');
    }

    // ---- 6: a migrated overlap is fixed on the right device ----
    // A v7 front and rear pair in U18, both full depth now. On each face the
    // other's back must not cover the device mounted there, or a tap selects
    // the wrong one and Full depth fixes the wrong one.
    replaceDocument({ v: 7, nodes: [N('sw', 'switch', { group: 'rk', rackU: 18, interfaces: [] }),
        N('pp', 'custom', { x: 100, group: 'rk', rackU: 18, rackFace: 'rear', interfaces: [] }),
        N('srv', 'server', { x: 200, group: 'rk', rackU: 10 })], links: [], groups }, { origin: 'file', docId: 'depth-pair' });
    setView('rack'); openRackView('rk'); select(null); renderRackView(true);
    const face = (node) => node && node.closest('.rk-slots').dataset.face;
    ok('each face draws its own device and the other one\'s back as a strip under it',
      face(dev('sw')) === 'front' && face(back('pp')) === 'front' && back('pp').classList.contains('rk-under') && dev('sw').classList.contains('rk-beside')
      && face(dev('pp')) === 'rear' && face(back('sw')) === 'rear' && back('sw').classList.contains('rk-under') && dev('pp').classList.contains('rk-beside'));
    ok('a strip takes no pointer and is out of the Tab order', getComputedStyle(back('pp')).pointerEvents === 'none' && back('pp').tabIndex === -1);
    ok('a back that meets nothing is drawn whole', !!back('srv') && !back('srv').classList.contains('rk-under') && !dev('srv').classList.contains('rk-beside'));
    const hit = (b) => { b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const t0 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t0 && t0.closest('.rk-dev'); };
    ok('the middle of U18 front is the switch, not the panel\'s back', hit(dev('sw')) === dev('sw'));
    ok('the middle of U18 rear is the panel, not the switch\'s back', hit(dev('pp')) === dev('pp'));
    ok('the strip is still in sight beside it', back('pp').getBoundingClientRect().width > 4 && back('pp').getBoundingClientRect().height > 4
       && back('pp').getBoundingClientRect().right <= dev('sw').getBoundingClientRect().left + 1);
    hit(dev('pp')).click();
    renderRackView(true);
    ok('a click there selects the panel', state.selectedType === 'node' && state.selectedId === 'pp');
    d0 = undoDepth();
    view().querySelector('.rk-selbar [data-rk="depth"]').click();
    ok('its Full depth button makes the panel half depth, one step, and not the switch', getNode('pp').rackDepth === 'half' && !('rackDepth' in getNode('sw'))
       && undoDepth() === d0 + 1);
    renderRackView(true);
    ok('the panel has no back now, the switch\'s is still a strip beside it on the rear',
      !back('pp') && !dev('sw').classList.contains('rk-beside') && back('sw').classList.contains('rk-under') && dev('pp').classList.contains('rk-beside'));
    // Then the switch, clicked on the front where it is now drawn whole.
    hit(dev('sw')).click();
    renderRackView(true);
    view().querySelector('.rk-selbar [data-rk="depth"]').click();
    ok('the switch made half too: the overlap goes, and no backs are left', getNode('sw').rackDepth === 'half' && rackFindings().length === 0
       && !back('sw') && !back('pp') && undoDepth() === d0 + 2, json(rackFindings()));
    undo(); undo();

    // ---- 7: brought in from the lists behind a half-depth device ----
    // A two-unit rack: a server (full) in U1, a half-depth panel in U2 front.
    // The NAS (full) fits nowhere front to back; U2 rear has room on one face.
    const g2 = groups.concat([{ id: 'rk2', name: 'Rack 2', kind: 'rack', parent: 'room', uHeight: 2 }]);
    replaceDocument({ v: DOC_VERSION, nodes: [N('a', 'server', { group: 'rk2', rackU: 1 }),
        N('pp', 'custom', { x: 100, group: 'rk2', rackU: 2, rackDepth: 'half', interfaces: [] }),
        N('nas', 'server', { x: 200, group: 'rk2' }), N('ext', 'server', { x: 300 })], links: [], groups: g2 }, { origin: 'file', docId: 'depth-bring' });
    setView('rack'); openRackView('rk2'); select(null); renderRackView(true);
    const rk2 = groupById('rk2');
    ok('the fit: half behind the panel, nothing in U1', json(rvFitDepth(rk2, getNode('nas'), { lo: 2, h: 1, face: 'rear' })) === json({ ok: true, full: false })
       && !rvFitDepth(rk2, getNode('nas'), { lo: 1, h: 1, face: 'rear' }).ok
       && rvFitDepth(rk2, getNode('pp'), { lo: 2, h: 1, face: 'front' }).full === undefined);
    el('topoToast').textContent = '';
    d0 = undoDepth();
    ok('Place puts a full-depth device in at half depth where that is all that fits', placeUnplaced(getNode('nas'), rk2)
       && getNode('nas').rackU === 2 && getNode('nas').rackFace === 'rear' && getNode('nas').rackDepth === 'half' && undoDepth() === d0 + 1
       && rackFindings().length === 0, json(getNode('nas')));
    ok('and says so', /NAS goes in at half depth/.test(el('topoToast').textContent), el('topoToast').textContent);
    undo();
    ok('one undo step: not placed, full again', getNode('nas').rackU === undefined && !('rackDepth' in getNode('nas')));
    el('topoToast').textContent = '';
    ok('one from outside the rack joins it the same way, and both are said', placeUnplaced(getNode('ext'), rk2)
       && getNode('ext').group === 'rk2' && getNode('ext').rackDepth === 'half' && undoDepth() === d0 + 1
       && /is in Rack 2 now\. EXT goes in at half depth/.test(el('topoToast').textContent), el('topoToast').textContent);
    undo();
    ok('undone, out again with no depth', getNode('ext').group === undefined && !('rackDepth' in getNode('ext')));
    ok('a half-depth one where its own depth fits is not changed', (() => {
      batch(() => { getNode('pp').rackFace = 'rear'; save(); });
      const r = rvBringIn(getNode('pp'), rk2, { lo: 2, h: 1, face: 'front', full: rvFitDepth(rk2, getNode('pp'), { lo: 2, h: 1, face: 'front' }).full });
      const good = !!r && getNode('pp').rackDepth === 'half' && getNode('pp').rackFace === 'front';
      undo(); undo(); return good; })());
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { closePlaceDialog(); } catch (e) { /* not open */ }
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
