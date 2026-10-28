// A rack's size (Review-Packs/Topo-groups.md, "Round 2", item 4; GROUP_FIELDS
// and "How a rack's units are numbered" in js/model.js, "A rack's size" in
// js/groups.js, the Size fields in js/rackview.js). What is held here:
//   1. the schema: widths 10", 19" and 23" (written any common way), a depth
//      in mm (optional, bounded), top-down numbering stored as 'top' and
//      bottom-up as nothing, none of it on a group that is not a rack; the
//      v8 -> v9 step changes nothing and leaves its input alone; a document
//      saved and opened again keeps all three (a sealed share link too, in
//      tests/suites/groupseal.js, which needs the real clock);
//   2. the numbering: only the printed numbers turn round. rackU stays
//      counted from the bottom (and so does the sheet's rack_u); the path
//      text, the rack view's numbers and boxes, the findings and the report
//      say the printed numbers; the device editor's U and the place dialog's
//      take and show the printed start;
//   3. the Size fields under the rack view's head and in the Groups tab's
//      Edit: width (drawn in proportion), depth (blank clears it, a zero is
//      refused), numbering and height, each one undo step; a custom height
//      through the prompt; a shorter rack asks first, naming the devices in
//      the units it loses, which then wait under Not placed yet; on a rack
//      numbered from the top the height comes and goes at the bottom, so
//      every device keeps its printed unit;
//   4. the table's Groups tab (width, depth, numbering, a height that asks)
//      and the spreadsheet's groups sheet (out, back in, a shorter rack in
//      the review);
//   5. the report: its size, its numbering and the elevation's numbers;
//   6. the words in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const json = (v) => JSON.stringify(v);
  const answers = [];
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return answers.length ? answers.shift()(req) : (req.kind === 'confirm' ? false : null); });
  const savedView = state.settings.view;
  const fire = (e, type) => e.dispatchEvent(new Event(type, { bubbles: true }));
  const node = (id) => getNode(id);
  const grp = (id) => groupById(id);
  const steps = () => _undoStack.length;

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  // A 24U rack: a switch near the top, a 2U server in the middle, a
  // half-depth panel at the bottom of the rear, and one not placed yet.
  const site = (rack = {}) => ({ v: DOC_VERSION,
    nodes: [
      N('sw', 'switch', { x: 0, y: 0, group: 'rk', rackU: 22, portCount: 8, interfaces: [] }),
      N('srv', 'server', { x: 100, y: 0, group: 'rk', rackU: 10, rackHeight: 2 }),
      N('pp', 'custom', { x: 200, y: 0, group: 'rk', rackU: 1, rackFace: 'rear', rackDepth: 'half', interfaces: [] }),
      N('nas', 'server', { x: 300, y: 0, group: 'rk' }),
      N('pc', 'pc', { x: 0, y: 300, group: 'room' })
    ],
    links: [{ id: 'l1', source: 'srv', target: 'sw', sourceIface: 'i1', targetIface: 'p1' }],
    groups: [
      { id: 'room', name: 'Server room', kind: 'room' },
      Object.assign({ id: 'rk', name: 'Rack 1', kind: 'rack', parent: 'room', uHeight: 24 }, rack)
    ] });
  const open = (doc) => { replaceDocument(doc, { origin: 'file', docId: 'racksize-doc' }); initHistory(); };
  const view = () => el('rackView');
  const sizeField = (f) => el('rackSize').querySelector(`[data-field="${f}"]`);
  const box = (id) => view().querySelector(`.rk-dev:not(.rk-back)[data-node="${id}"]`);
  const numbers = (face = 'front') => [...view().querySelectorAll(`.rk-face[data-face="${face}"] .rk-units li`)].map((li) => li.textContent);
  const lastAsked = () => (asked.length ? asked[asked.length - 1] : null);

  try {
    // ---- 1: the schema ----
    const gs = normalizeGroups([
      { id: 'a', kind: 'rack', width: '10"' },
      { id: 'b', kind: 'rack', width: 23 },
      { id: 'c', kind: 'rack', width: '21in' },
      { id: 'd', kind: 'rack', depthMm: '600', numbering: 'Top-Down' },
      { id: 'e', kind: 'rack', depthMm: 0, numbering: 'bottom' },
      { id: 'f', kind: 'rack', depthMm: 9000, width: '19 inch' },
      { id: 'g', kind: 'room', width: '10in', depthMm: 600, numbering: 'top' }
    ]);
    const by = (id) => gs.find((g) => g.id === id);
    ok('10" and 23" are widths, written as a sheet or a person would', by('a').width === '10in' && by('b').width === '23in' && by('f').width === '19in', json(gs.map((g) => g.width)));
    ok('a width nobody makes is 19"', by('c').width === '19in');
    ok('a depth in mm is a whole number, read from text', by('d').depthMm === 600);
    ok('a zero is no depth, and a slip past 3000 mm is held at 3000', by('e').depthMm === undefined && by('f').depthMm === RACK_DEPTH_MM_MAX && RACK_DEPTH_MM_MAX === 3000);
    ok('top-down is stored as top; bottom-up, the default, as nothing', by('d').numbering === 'top' && by('e').numbering === undefined);
    ok('a group that is not a rack carries none of them', ['width', 'depthMm', 'numbering', 'uHeight'].every((k) => by('g')[k] === undefined));
    ok('serialized: only what was given, in table order', json(serializeGroups([by('d'), by('e')]))
       === '[{"id":"d","kind":"rack","uHeight":42,"width":"19in","depthMm":600,"numbering":"top"},{"id":"e","kind":"rack","uHeight":42,"width":"19in"}]',
       json(serializeGroups([by('d'), by('e')])));
    ok('the heights racks are sold in', json(RACK_U_PRESETS) === '[4,6,9,12,18,24,27,42,45,47,48]');

    ok('the document is at v9 or later', DOC_VERSION >= 9);
    const v8 = { v: 8, nodes: [N('x', 'server', { group: 'r', rackU: 3 })], links: [], groups: [{ id: 'r', kind: 'rack', uHeight: 24, width: '19in' }] };
    const v8copy = json(v8);
    const m = migrateDoc(v8);
    ok('a v8 document is taken up with nothing changed', m.doc.v === DOC_VERSION && m.from === 8 && !m.newer && json(m.doc.groups) === json(v8.groups) && json(m.doc.nodes) === json(v8.nodes));
    ok('the input is not touched', json(v8) === v8copy);

    open(site({ width: '10in', depthMm: 450, numbering: 'top' }));
    const saved = json(serializeDoc());
    ok('saved: the width, the depth and the numbering', /"width":"10in","depthMm":450,"numbering":"top"/.test(saved) && serializeDoc().v === DOC_VERSION, saved.slice(0, 600));
    open(JSON.parse(saved));
    ok('opened again, the same document', json(serializeDoc()) === saved);
    // A sealed share link carries them too: tests/suites/groupseal.js
    // (@realtime, Web Crypto) seals a rack with all three.

    // ---- 2: the numbering ----
    open(site());
    const rk = () => grp('rk');
    ok('bottom-up by default: U10 is U10', rackUnitNo(rk(), 10) === 10 && rackUnitsText(rk(), 10, 11) === 'U10–U11'
       && nodePlaceText(node('srv')) === 'Server room / Rack 1 · U10–U11 front', nodePlaceText(node('srv')));
    const storedBefore = json(state.nodes.map((n) => n.rackU));
    batch(() => { rk().numbering = 'top'; save(); });
    ok('top-down: the top unit is U1 and the bottom one U24', rackUnitNo(rk(), 24) === 1 && rackUnitNo(rk(), 1) === 24);
    ok('a run reads smaller number first', rackUnitsText(rk(), 10, 11) === 'U14–U15' && rackUnitsText(rk(), 22) === 'U3');
    ok('the path text follows it', nodePlaceText(node('srv')) === 'Server room / Rack 1 · U14–U15 front' && rackSpanText(node('pp')) === 'U24 rear, half depth', nodePlaceText(node('srv')));
    ok('and no device moved: rackU is still counted from the bottom', json(state.nodes.map((n) => n.rackU)) === storedBefore);
    let roundTrip = true;
    for (let u = 1; u <= 23; u++) if (rackUnitFromNo(rk(), rackStartNo(rk(), u, 2), 2) !== u) roundTrip = false;
    ok('a field\'s printed start and the stored unit turn into each other', roundTrip && rackStartNo(rk(), 10, 2) === 14);
    const devSheet = csvDevicesSheet();
    const rcol = devSheet.headers.indexOf('rack_u');
    ok('the sheet\'s rack_u is the stored unit, whatever the numbering', devSheet.rows.find((r) => r[0] === 'srv')[rcol] === '10');

    // The findings say the printed numbers.
    batch(() => { node('nas').rackU = 23; node('nas').rackHeight = 3; save(); });
    let rf = topologyFindings().filter((f) => f.key === 'rack');
    // Round 2 review: worded "from U2, so it goes past U1" before, and "from
    // U1 ... past U1" for a device stored at the top: its bottom unit and how
    // far above U1 it reaches say it plainly.
    ok('past the top: its bottom unit and how far above U1 it reaches', rf.some((f) => f.detail === 'It is 3U tall with its bottom unit at U2, so it reaches 1U above U1, the top of Rack 1.'), json(rf.map((f) => f.detail)));
    undo();
    batch(() => { node('nas').rackU = 24; node('nas').rackHeight = 2; save(); });
    rf = topologyFindings().filter((f) => f.key === 'rack');
    ok('stored at the top unit, it no longer reads "from U1 ... past U1"', rf.some((f) => f.detail === 'It is 2U tall with its bottom unit at U1, so it reaches 1U above U1, the top of Rack 1.')
       && !rf.some((f) => /from U1, so it goes past U1/.test(f.detail)), json(rf.map((f) => f.detail)));
    undo();
    // Outside: the number as the field took it (rackStartNo), never a mirror below U1.
    batch(() => { node('nas').rackU = rackUnitFromNo(rk(), 30, 1); save(); });
    rf = topologyFindings().filter((f) => f.key === 'rack');
    ok('outside, worded with the number typed into the field', rf.some((f) => f.detail === 'U30 is outside Rack 1, which has units 1 to 24.'), json(rf.map((f) => f.detail)));
    undo();
    batch(() => { node('nas').rackU = 22; save(); });
    rf = topologyFindings().filter((f) => f.key === 'rack');
    ok('an overlap names the printed units', rf.some((f) => /\(U3 front; U3 front\)/.test(f.detail)), json(rf.map((f) => f.detail)));
    undo();

    // The rack view.
    setView('rack');
    openRackView('rk');
    select(null);
    renderRackView(true);
    ok('the rails are numbered from the top: 1 at the top, 24 at the bottom', numbers()[0] === '1' && numbers()[23] === '24' && numbers('rear')[0] === '1');
    ok('a box says its printed units', box('srv').querySelector('.rk-span').textContent === 'U14–U15' && /U14–U15 front/.test(box('srv').title));
    ok('and is drawn where it was: unit 10 from the bottom', box('srv').style.getPropertyValue('--u') === '10');

    // The device editor's U: the printed start, typed back to the stored unit.
    select('srv', 'node');
    const uf = el('propRackU');
    ok('the device editor shows the printed start: its top unit', uf.value === '14' && /from the top/.test(document.querySelector('label[for="propRackU"]').title));
    uf.focus(); uf.value = '5'; fire(uf, 'input'); uf.blur(); commitTyping();
    ok('typed U5 on a 2U device: its units are U5–U6, stored from the bottom', node('srv').rackU === 19 && rackSpanText(node('srv')) === 'U5–U6 front', String(node('srv').rackU));
    const hf = el('propRackHeight');
    hf.focus(); hf.value = '3'; fire(hf, 'input'); hf.blur(); commitTyping();
    ok('made 3U tall it keeps its top unit, U5, and grows down', rackSpanText(node('srv')) === 'U5–U7 front' && node('srv').rackU === 18, rackSpanText(node('srv')));
    undo(); undo();
    ok('two undo steps put it back', node('srv').rackU === 10 && rackHeightOf(node('srv')) === 2);

    // The place dialog: "Top unit", the printed start.
    openPlaceDialog({ rackId: 'rk', u: 5, height: 1, face: 'front' });
    ok('the place dialog asks for the top unit, printed', document.querySelector('label[for="rackPlaceU"]').textContent === 'Top unit' && el('rackPlaceU').value === '20');
    el('rackPlaceU').value = '20'; el('rackPlaceHeight').value = '2'; fire(el('rackPlaceHeight'), 'input');
    ok('it says where that is', /Goes in U20–U21 front/.test(el('rackPlaceMsg').textContent), el('rackPlaceMsg').textContent);
    let d0 = steps();
    const made = pickInPlaceDialog({ type: 'server' });
    ok('placed at U20–U21: stored from the bottom as 4', !!made && made.rackU === 4 && rackHeightOf(made) === 2 && steps() === d0 + 1, made ? String(made.rackU) : 'none');
    undo();
    // Back to bottom-up for the dialog's label.
    batch(() => { delete rk().numbering; save(); });
    openPlaceDialog({ rackId: 'rk', u: 5, height: 1, face: 'front' });
    ok('bottom-up, it asks for the lowest unit, as before', document.querySelector('label[for="rackPlaceU"]').textContent === 'Lowest unit' && el('rackPlaceU').value === '5');
    closePlaceDialog();
    undo();
    ok('the numbering is one undo step', rackTopDown(rk()));
    undo();
    ok('and back to bottom-up', !rackTopDown(rk()) && steps() === 0);

    // ---- 3: the Size fields ----
    renderRackView(true);
    ok('the head has a Size button, shut at first', !el('rackSizeBtn').hidden && el('rackSizeBtn').getAttribute('aria-expanded') === 'false' && el('rackSize').hidden);
    el('rackSizeBtn').click();
    ok('pressed, it opens the four fields', !el('rackSize').hidden && el('rackSizeBtn').getAttribute('aria-expanded') === 'true'
       && ['uHeight', 'width', 'depthMm', 'numbering'].every((f) => !!sizeField(f)));
    ok('the height offers the sizes racks come in and a custom one', [...sizeField('uHeight').options].map((o) => o.value).join() === '4,6,9,12,18,24,27,42,45,47,48,custom'
       && sizeField('uHeight').value === '24');
    ok('the head says the size', /^24U · 19″ · /.test(el('rackCount').textContent), el('rackCount').textContent);

    const faceW = () => view().querySelector('.rk-face[data-face="front"]').getBoundingClientRect().width;
    const w19 = faceW();
    d0 = steps();
    sizeField('width').value = '10in'; fire(sizeField('width'), 'change'); await tick();
    const w10 = faceW();
    ok('10": one step, drawn narrower', rk().width === '10in' && steps() === d0 + 1 && w10 < w19 && el('rackBody').style.getPropertyValue('--rk-w') === '0.526', `${w10} < ${w19}`);
    // Narrower, but still read: the name keeps the first line whole, and a
    // 2U back drops its "back" word so its units are not cut at the bottom.
    node('sw').name = 'Core switch'; renderRackView(true);   // a real name, set outside the history: the drawing is what is measured
    const nm = box('sw').querySelector('.rk-name');
    const back = view().querySelector('.rk-dev.rk-back[data-node="srv"]');
    const bs = back.querySelector('.rk-span').getBoundingClientRect(), bb = back.getBoundingClientRect();
    ok('a 10" rack\'s names read whole', nm.textContent === 'Core switch' && nm.scrollWidth <= nm.clientWidth && nm.getBoundingClientRect().top - box('sw').getBoundingClientRect().top < 8,
      `${nm.scrollWidth} <= ${nm.clientWidth}`);
    ok('a 10" back keeps its units inside the box', getComputedStyle(back.querySelector('.rk-backword')).display === 'none' && bs.bottom <= bb.bottom + 0.5, `${bs.bottom} <= ${bb.bottom}`);
    node('sw').name = 'SW'; renderRackView(true);
    sizeField('width').value = '23in'; fire(sizeField('width'), 'change'); await tick();
    const w23 = faceW();
    ok('23": drawn wider than 19"', rk().width === '23in' && w23 > w19, `${w23} > ${w19}`);
    ok('the head says it', /^24U · 23″ · /.test(el('rackCount').textContent), el('rackCount').textContent);
    undo(); undo();
    ok('two undo steps: 19" again', rk().width === '19in');

    renderRackView(true);
    d0 = steps();
    sizeField('depthMm').value = '600'; fire(sizeField('depthMm'), 'change'); await tick();
    ok('a depth: one step, in the head', rk().depthMm === 600 && steps() === d0 + 1 && /24U · 19″ · 600 mm/.test(el('rackCount').textContent), el('rackCount').textContent);
    sizeField('depthMm').value = '0'; fire(sizeField('depthMm'), 'change'); await tick();
    ok('a zero is refused, said, and the field shows the depth again', rk().depthMm === 600 && steps() === d0 + 1 && /whole number of millimetres/.test(el('topoToast').textContent)
       && sizeField('depthMm').value === '600');
    sizeField('depthMm').value = ''; fire(sizeField('depthMm'), 'change'); await tick();
    ok('a blank takes it away', !('depthMm' in rk()) && steps() === d0 + 2 && !/mm/.test(el('rackCount').textContent));
    undo(); undo();

    d0 = steps();
    sizeField('numbering').value = 'top'; fire(sizeField('numbering'), 'change'); await tick();
    ok('top-down from the Size fields: one step, the rails renumbered', rackTopDown(rk()) && steps() === d0 + 1 && numbers()[0] === '1');
    undo();
    renderRackView(true);

    // The height: bigger is one step and asks nothing.
    asked.length = 0;
    d0 = steps();
    sizeField('uHeight').value = '42'; fire(sizeField('uHeight'), 'change'); await tick(); await tick();
    ok('taller: one step, no question, nothing moves', rk().uHeight === 42 && steps() === d0 + 1 && asked.length === 0 && node('sw').rackU === 22 && node('srv').rackU === 10);
    undo();
    // Shorter than a placed device: asked, the device named, and No is no.
    renderRackView(true);
    answers.push(() => false);
    sizeField('uHeight').value = '12'; fire(sizeField('uHeight'), 'change'); await tick(); await tick();
    ok('shorter than a placed device: asked first, naming it and where it is', asked.length === 1 && /Rack 1 becomes 12U/.test(lastAsked().message)
       && /SW \(U22 front\)/.test(lastAsked().message) && !/SRV/.test(lastAsked().message) && lastAsked().ok === 'Make it 12U', lastAsked() ? lastAsked().message : '');
    ok('No changes nothing, and the field shows the height again', rk().uHeight === 24 && node('sw').rackU === 22 && steps() === d0 && sizeField('uHeight').value === '24');
    answers.push(() => true);
    sizeField('uHeight').value = '12'; fire(sizeField('uHeight'), 'change'); await tick(); await tick();
    ok('Yes: 12U in one step; the switch waits in the rack, not placed, keeping its size', rk().uHeight === 12 && steps() === d0 + 1
       && node('sw').group === 'rk' && node('sw').rackU === undefined && node('sw').rackFace === undefined && node('srv').rackU === 10);
    ok('it is listed under Not placed yet, and there is no finding', !!view().querySelector('.rk-unplaced [data-node="sw"]') && !topologyFindings().some((f) => f.key === 'rack'));
    undo();
    ok('one undo puts the height and the switch back', rk().uHeight === 24 && node('sw').rackU === 22 && steps() === d0);

    // Top-down: the units come and go at the bottom, every device keeps its
    // printed unit.
    batch(() => { rk().numbering = 'top'; save(); });
    renderRackView(true);
    asked.length = 0;
    d0 = steps();
    answers.push(() => true);
    sizeField('uHeight').value = '12'; fire(sizeField('uHeight'), 'change'); await tick(); await tick();
    ok('top-down, shorter: asked about the devices at the bottom, not the switch at the top', asked.length === 1 && /SRV \(U14–U15 front\)/.test(lastAsked().message)
       && /PP \(U24 rear, half depth\)/.test(lastAsked().message) && !/SW/.test(lastAsked().message), lastAsked() ? lastAsked().message : '');
    ok('the switch is still at U3', rk().uHeight === 12 && rackSpanText(node('sw')) === 'U3 front' && node('sw').rackU === 10 && node('srv').rackU === undefined && node('pp').rackU === undefined);
    undo();
    ok('undone: as it was', rk().uHeight === 24 && node('sw').rackU === 22 && node('srv').rackU === 10 && node('pp').rackU === 1);
    renderRackView(true);
    sizeField('uHeight').value = '42'; fire(sizeField('uHeight'), 'change'); await tick(); await tick();
    ok('top-down, taller: every device keeps its printed unit', rk().uHeight === 42 && rackSpanText(node('sw')) === 'U3 front'
       && rackSpanText(node('srv')) === 'U14–U15 front' && node('sw').rackU === 40);
    undo(); undo();
    ok('back to bottom-up 24U', !rackTopDown(rk()) && rk().uHeight === 24 && steps() === 0);

    // A custom height, through the prompt.
    renderRackView(true);
    answers.push((req) => (req.kind === 'prompt' ? '30' : null));
    sizeField('uHeight').value = 'custom'; fire(sizeField('uHeight'), 'change'); await tick(); await tick();
    ok('Custom… asks for the units, offering the height it has', lastAsked().kind === 'prompt' && lastAsked().value === '24' && rk().uHeight === 30 && steps() === 1);
    ok('a custom height is offered as such', [...sizeField('uHeight').options].some((o) => o.value === '30' && o.selected && /30U \(custom\)/.test(o.textContent)));
    answers.push((req) => (req.kind === 'prompt' ? 'tall' : null));
    sizeField('uHeight').value = 'custom'; fire(sizeField('uHeight'), 'change'); await tick(); await tick();
    ok('a height that is not a number is refused, said, and the field shows 30 again', rk().uHeight === 30 && steps() === 1
       && /1 to 99 units tall/.test(el('topoToast').textContent) && sizeField('uHeight').value === '30');
    sizeField('uHeight').value = 'custom'; fire(sizeField('uHeight'), 'change'); await tick(); await tick();
    ok('dismissed, nothing changes', rk().uHeight === 30 && steps() === 1 && sizeField('uHeight').value === '30');
    undo();

    // The Groups tab's Edit has the same fields, answered the same way.
    el('groupTabBtn').click();
    const card = () => el('groupList').querySelector('.grp-card[data-grp="rk"]');
    if (!_grpEditOpen.has('rk')) card().querySelector('[data-act="edit"]').click();
    const cf = (f) => card().querySelector(`[data-field="${f}"]`);
    ok('the Groups tab card: its size on the chip, and the four fields', /Rack · 24U · 19″/.test(card().querySelector('.chip-tag').textContent)
       && ['uHeight', 'width', 'depthMm', 'numbering'].every((f) => !!cf(f)));
    cf('width').value = '10in'; fire(cf('width'), 'change'); await tick();
    ok('a width set there is one step, and the rack view follows', rk().width === '10in' && steps() === 1 && sizeField('width').value === '10in'
       && /10″/.test(card().querySelector('.chip-tag').textContent));
    cf('numbering').value = 'top'; fire(cf('numbering'), 'change'); await tick();
    ok('and the numbering', rackTopDown(rk()) && steps() === 2 && sizeField('numbering').value === 'top');
    undo(); undo();

    // Read-only: the fields are there but cannot change anything.
    replaceDocument(Object.assign(site(), { v: DOC_VERSION + 1 }), { origin: 'file', docId: 'racksize-ro' });
    openRackView('rk');
    renderRackView(true);
    ok('a read-only network: the size fields are disabled', state.readOnly && sizeField('width').disabled && sizeField('uHeight').disabled);
    _rv.sizeOpen = false;

    // ---- 4: the table and the spreadsheet ----
    open(site({ width: '10in', depthMm: 450 }));
    setView('table');
    showTableTab('groups');
    const grow = (id) => _tv.rows.find((r) => r.key === `g:${id}`);
    const gc = (key) => TV_COLS.groups.find((c) => c.key === key);
    const cell = (key, col) => el('tvGrid').querySelector(`tr[data-row="${key}"] td[data-col="${col}"]`);
    ok('the Groups tab has width, depth and numbering', cell('g:rk', 'g:width').textContent === '10″' && cell('g:rk', 'g:depthMm').textContent === '450'
       && cell('g:rk', 'g:numbering').textContent === 'Bottom up' && cell('g:room', 'g:width').textContent === '—');
    ok('a rack\'s only', canEdit(grow('rk'), gc('g:width')) && !canEdit(grow('room'), gc('g:width')) && !canEdit(grow('room'), gc('g:numbering')));
    ok('typed values parse as a person writes them', gc('g:width').parse('23"').value === '23in' && gc('g:width').parse('21').error === true
       && gc('g:depthMm').parse('600 mm').value === 600 && gc('g:depthMm').parse('').value === undefined && gc('g:depthMm').parse('5000').error === true
       && gc('g:numbering').parse('top down').value === 'top' && gc('g:numbering').parse('Bottom up').value === 'bottom' && gc('g:numbering').parse('sideways').error === true
       && gc('g:uHeight').parse('12U').value === 12);
    commitValue(grow('rk'), gc('g:numbering'), 'top');
    ok('numbering from a cell: one step', rackTopDown(grp('rk')) && steps() === 1);
    commitValue(grow('rk'), gc('g:depthMm'), undefined);
    ok('a blank depth cell takes it away', !('depthMm' in grp('rk')) && steps() === 2);
    undo(); undo();
    asked.length = 0;
    answers.push(() => true);
    commitValue(grow('rk'), gc('g:uHeight'), 12);
    await tick(); await tick();
    ok('a shorter rack from a cell asks the same question, answered Make it 12U', asked.length === 1 && /SW \(U22 front\)/.test(asked[0].message) && asked[0].ok === 'Make it 12U'
       && grp('rk').uHeight === 12 && node('sw').rackU === undefined && steps() === 1, asked.length ? asked[0].message : '');
    undo();

    // Paste a column: the same question, asked before Apply takes anything.
    const pplan = planPaste('g:uHeight', '12', { rows: [grow('rk')], mode: 'selected' }, 'groups');
    ok('a pasted shorter height counts the devices that lose their place', pplan.counts.change === 1 && pplan.loses === 1 && /SW \(U22 front\)/.test(pasteQuestion(pplan)),
      json({ loses: pplan.loses, q: pasteQuestion(pplan) }));
    ok('a taller one asks nothing', pasteQuestion(planPaste('g:uHeight', '42', { rows: [grow('rk')], mode: 'selected' }, 'groups')) === '');
    const two = planPaste('g:kind', 'room', { rows: [grow('rk')], mode: 'selected' }, 'groups');
    ok('a pasted kind that ends a rack asks too, and counts its placed devices', two.loses === 3 && /stops being a rack/.test(pasteQuestion(two)), json(two.loses));
    _tv.cursor = { row: 'g:rk', col: 'g:uHeight' }; _tv.cursorChosen = true;
    openPasteColumn({ col: 'g:uHeight', text: '12' });
    ok('the preview says a device loses its place and that Apply asks', /Devices that lose their place in a rack: 1\. Apply asks first\./.test(el('pasteDelta').textContent), el('pasteDelta').textContent);
    asked.length = 0;
    answers.push(() => false);
    applyPasteDialog();
    await tick(); await tick();
    ok('No: nothing changes, and the paste comes back as it was', asked.length === 1 && asked[0].kind === 'confirm' && /SW \(U22 front\)/.test(asked[0].message)
       && grp('rk').uHeight === 24 && node('sw').rackU === 22 && steps() === 0 && !el('pasteDialog').hidden && el('pasteText').value === '12',
      json({ asked: asked.length, h: grp('rk').uHeight, steps: steps() }));
    answers.push(() => true);
    applyPasteDialog();
    await tick(); await tick();
    ok('Apply: one step, the device waits under Not placed yet', asked.length === 2 && grp('rk').uHeight === 12 && node('sw').rackU === undefined
       && node('srv').rackU === 10 && steps() === 1, json({ asked: asked.length, h: grp('rk').uHeight, steps: steps() }));
    undo();

    // groups.csv: out, and back in.
    const sheet = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
    const gsheet = csvGroupsSheet();
    const rkRow = gsheet.rows.find((r) => r[0] === 'rk');
    ok('groups.csv carries width, depth_mm and numbering', json(gsheet.headers.slice(-3)) === '["width","depth_mm","numbering"]' && json(rkRow.slice(-3)) === '["10in","450","bottom"]'
       && json(gsheet.rows.find((r) => r[0] === 'room').slice(-3)) === '["","",""]', json(gsheet.rows));
    const own = csvPlan(sheet(csvText(gsheet)), csvAutoMap(sheet(csvText(gsheet))));
    ok('its own sheet reads back with no change', own.counts.change === 0 && own.counts.conflict === 0, json(own.rows.map((r) => r.changes)));
    const edited = 'group_id,u_height,width,depth_mm,numbering\nrk,12,23",800,Top down\n';
    const ep = csvPlan(sheet(edited), csvAutoMap(sheet(edited)));
    const er = ep.rows[0];
    ok('a sheet that changes them: each change listed, and the devices in the units it loses counted', er.status === 'change'
       && ['Height (U)', 'Width', 'Depth (mm)', 'Numbering'].every((f) => er.changes.some((c) => c.field === f))
       && er.changes.some((c) => c.field === 'Numbering' && c.after === 'Top down') && er.changes.some((c) => c.field === 'Width' && c.after === '23″')
       && er.notes.some((n) => /2 placed devices are in the units it loses/.test(n)), json(er));
    d0 = steps();
    applyCsvPlan(ep);
    ok('applied in one step, top-down: the switch keeps U3, the server and the panel lose their units', grp('rk').uHeight === 12 && grp('rk').width === '23in'
       && grp('rk').depthMm === 800 && rackTopDown(grp('rk')) && node('sw').rackU === 10 && node('srv').rackU === undefined && node('pp').rackU === undefined
       && steps() === d0 + 1, json(grp('rk')));
    undo();
    ok('one undo', grp('rk').uHeight === 24 && node('srv').rackU === 10 && !rackTopDown(grp('rk')));
    if (typeof closeCsvDialog === 'function') closeCsvDialog();

    // ---- 5: the report ----
    open(site({ width: '10in', depthMm: 450, numbering: 'top' }));
    const html = reportHtml(reportModel(), null);
    ok('the rack\'s heading says its size and numbering', /Rack 1 <span class="muted">24U · 10″ · 450 mm · numbered from the top<\/span>/.test(html));
    const firstElev = (html.split('class="elev"')[1] || '');
    ok('its elevation is numbered from the top and drawn as wide as a 10" rack', /^ style="width:53%"/.test(firstElev)
       && /<tbody><tr><td class="ru">1<\/td>/.test(firstElev) && /U14–U15/.test(firstElev), firstElev.slice(0, 200));
    open(site());
    const plain = reportHtml(reportModel(), null);
    ok('a 19" rack numbered from the bottom, as before', /Rack 1 <span class="muted">24U · 19″<\/span>/.test(plain) && /<tbody><tr><td class="ru">24<\/td>/.test(plain.split('class="elev"')[1] || ''));

    // ---- 6: the words ----
    const words = ['Numbering', 'Bottom up', 'Top down', 'Depth (mm)', 'Size', 'Top unit', 'numbered from the top', 'Make it {h}U',
      '{n} of the rows this paste changes ask first:', 'Devices that lose their place in a rack: {n}. Apply asks first.',
      '{rack} becomes {h}U. These {n} devices are in units it loses, so they lose their places and wait under Not placed yet:'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((lang) => {
      const missing = words.filter((w) => !Object.prototype.hasOwnProperty.call(window.CarinoI18N.MESSAGES[lang] || {}, w));
      ok(`${lang} has the size words`, !missing.length, missing.join(' | '));
    });
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    _rv.sizeOpen = false;
    state.settings.view = savedView;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
