// Groups, step A part 1 (Review-Packs/Topo-groups.md): where devices sit.
// doc.groups is a tree of buildings, floors, rooms, racks and custom groups;
// a device names the one it is in (node.group) and, in a rack, where
// (rackU / rackHeight / rackFace). What is held here:
//   1. the schema: GROUP_FIELDS and the node fields, the allowlist, coercion;
//   2. the normalizer: dangling parents and groups dropped, loops cut,
//      repeated ids reminted, rack fields clamped;
//   3. the paths: "Building A / Server room / Rack 3" and "U12–U13 front";
//   4. the document: v7, the v6 -> v7 migration, round trips through the
//      serializer, a reload (the history entry), a back-up file, and undo;
//   5. the findings: a parent loop, a unit outside the rack, rack fields
//      without a rack;
//   6. the Groups tab: cards, tree order and indent, counts, add, + Inside,
//      edit (name, kind, parent, height), Delete either way, Select members;
//   7. the device editor's Group picker and its rack row;
//   8. read-only, and the tab's words in another language.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const answers = [];
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return answers.length ? answers.shift()(req) : (req.kind === 'confirm' ? false : null); });
  const json = (v) => JSON.stringify(v);

  // A small site: a building with a server room and a rack in it, and a
  // floor with an office. Written the way a v7 file carries it.
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', ports: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({ v: 7,
    nodes: [
      N('rtr', 'router', { x: 0, y: 0, group: 'rk', rackU: 40, rackFace: 'front' }),
      N('sw', 'switch', { x: 100, y: 0, group: 'rk', rackU: 12, rackHeight: 2, rackFace: 'rear', portCount: 8, interfaces: [] }),
      N('srv', 'server', { x: 200, y: 0, group: 'srvroom' }),
      N('pc1', 'pc', { x: 0, y: 200, group: 'office', location: 'Desk 4' }),
      N('pc2', 'pc', { x: 100, y: 200, location: 'Reception' })
    ],
    links: [{ id: 'l1', source: 'rtr', target: 'sw', sourceIface: 'i1', targetIface: 'p1' }],
    groups: [
      { id: 'bA', name: 'Building A', kind: 'building' },
      { id: 'srvroom', name: 'Server room', kind: 'room', parent: 'bA' },
      { id: 'rk', name: 'Rack 3', kind: 'rack', parent: 'srvroom', uHeight: 42, width: '19in' },
      { id: 'f1', name: 'Floor 1', kind: 'floor', parent: 'bA' },
      { id: 'office', name: 'Office', kind: 'room', parent: 'f1' }
    ] });
  const node = (id) => getNode(id);
  const grp = (id) => groupById(id);
  const card = (id) => el('groupList').querySelector(`.grp-card[data-grp="${id}"]`);
  const act = (id, a) => card(id).querySelector(`[data-act="${a}"]`);
  const field = (id, f) => card(id).querySelector(`[data-field="${f}"]`);
  const fire = (e, type) => e.dispatchEvent(new Event(type, { bubbles: true }));

  try {
    // ---- 1: the schema ----
    const gs = normalizeGroups([
      { id: 'a', name: '  Hall\n 2 ', kind: 'ROOM', parent: null, junk: 'x', uHeight: 10 },
      { id: 'r', name: 'R1', kind: 'rack', parent: 'a' },
      { id: 'r2', name: 'R2', kind: 'rack', uHeight: '24', width: '21in' },
      { id: 'r3', name: 'R3', kind: 'rack', uHeight: 500 },
      { id: 'r4', name: 'R4', kind: 'rack', uHeight: 0 },
      { id: 'k', name: '', kind: 'nonsense' },
      null, 'junk', [1]
    ]);
    ok('a group is read through the table', gs.length === 6, json(gs.map((g) => g.id)));
    ok('unknown keys are not kept (the allowlist)', !('junk' in gs[0]));
    ok('a name is one line, trimmed', gs[0].name === 'Hall  2', json(gs[0].name));
    ok('a kind is one of five, case aside', gs[0].kind === 'room' && gs[5].kind === 'custom');
    ok('only a rack has a height and a width', gs[0].uHeight === undefined && gs[0].width === undefined);
    ok('a rack defaults to 42U and 19"', gs[1].uHeight === 42 && gs[1].width === '19in', json(gs[1]));
    // 23" is a width now (Round 2, item 4): 21" is the one nobody makes.
    ok('a height typed as text is its number; a width nobody makes is 19"', gs[2].uHeight === 24 && gs[2].width === '19in');
    ok('a height is clamped to 1..99', gs[3].uHeight === RACK_U_MAX && gs[4].uHeight === 1, `${gs[3].uHeight} ${gs[4].uHeight}`);
    ok('every field, in table order', json(serializeGroups(gs.slice(0, 2)))
       === '[{"id":"a","name":"Hall  2","kind":"room"},{"id":"r","name":"R1","kind":"rack","parent":"a","uHeight":42,"width":"19in"}]',
       json(serializeGroups(gs.slice(0, 2))));
    ok('a blank name is not written', json(serializeGroups([gs[5]])) === '[{"id":"k","kind":"custom"}]', json(serializeGroups([gs[5]])));
    ok('a document with no groups has no groups key', !('groups' in JSON.parse(json({ groups: serializeGroups([]) }))));
    const rackKind = gs[1];
    rackKind.kind = 'room';
    ok('a rack turned into a room keeps its height in memory but does not write it', rackKind.uHeight === 42 && !('uHeight' in JSON.parse(json(writeFields(GROUP_FIELDS, rackKind)))));
    rackKind.kind = 'rack';
    ok('turned back, it writes it again', writeFields(GROUP_FIELDS, rackKind).uHeight === 42);

    const n1 = normalizeLoadedNode({ id: 'z', type: 'pc', group: ' g1 ', rackU: '7', rackHeight: 1, rackFace: 'REAR' });
    ok('a device\'s group is an id, trimmed', n1.group === 'g1');
    ok('a unit typed as text is its number', n1.rackU === 7);
    ok('one unit of height is the default and is not stored', !('rackHeight' in n1));
    ok('a face is front or rear, case aside', n1.rackFace === 'rear');
    const n2 = normalizeLoadedNode({ id: 'z', type: 'pc', group: 5, rackU: 0, rackHeight: 300, rackFace: 'side' });
    ok('a unit below 1 is kept (the finding names it), a height past 99 is 99', n2.rackU === 0 && n2.rackHeight === RACK_U_MAX, `${n2.rackU} ${n2.rackHeight}`);
    const nLow = [-3, '-3', ' 0 ', 500, -500].map((v) => normalizeLoadedNode({ id: 'z', type: 'pc', rackU: v }).rackU);
    ok('a unit may be negative, typed or stored, and is bounded only to +/-99', json(nLow) === json([-3, -3, 0, RACK_U_MAX, -RACK_U_MAX]), json(nLow));
    ok('and a unit of 0 is written, not dropped as falsy', JSON.parse(json(serializeNode(normalizeLoadedNode({ id: 'z', type: 'pc', name: 'Z', interfaces: [], rackU: 0 })))).rackU === 0);
    ok('a face that is not one is none', !('rackFace' in n2));
    ok('a numeric group id is read as its text (ids are text)', n2.group === '5');
    const n3 = normalizeLoadedNode({ id: 'z', type: 'pc', rackU: 'twelve', rackHeight: 2.5 });
    ok('a unit or height that is not a whole number is none', !('rackU' in n3) && !('rackHeight' in n3));
    const bare = serializeNode(normalizeLoadedNode({ id: 'z', type: 'pc', name: 'Z', interfaces: [] }));
    ok('a device that never used them writes none of the new keys', !['group', 'rackU', 'rackHeight', 'rackFace'].some((k) => k in JSON.parse(json(bare))));

    // ---- 2: the normalizer ----
    const tangled = normalizeGroups([
      { id: 'a', name: 'A', parent: 'b' }, { id: 'b', name: 'B', parent: 'c' }, { id: 'c', name: 'C', parent: 'a' },
      { id: 's', name: 'Self', parent: 's' },
      { id: 'o', name: 'Orphan', parent: 'gone' },
      { id: 'a', name: 'Second A' },
      { id: 'd', name: 'D', parent: 'a' }
    ]);
    const tp = (id) => (tangled.find((g) => g.id === id) || {}).parent;
    ok('a loop is cut where it closes, in list order', tp('a') === 'b' && tp('b') === 'c' && tp('c') === null, json(tangled.map((g) => [g.id, g.parent])));
    ok('a group that is its own parent is at the top', tp('s') === null);
    ok('a parent that is not a group is dropped', tp('o') === null);
    ok('a repeated id is reminted; the first keeps it', tangled.filter((g) => g.id === 'a').length === 1 && tangled[5].id !== 'a' && tangled[5].name === 'Second A');
    ok('a child of the repeated id stays with the first', tp('d') === 'a');
    ok('the same document always normalizes the same way', json(normalizeGroups([{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }]).map((g) => g.parent)) === '["b",null]');
    const input = [{ id: 'x', parent: 'x' }];
    normalizeGroups(input);
    ok('the input is not mutated', input[0].parent === 'x');

    replaceDocument(Object.assign(site(), {
      nodes: site().nodes.concat([N('lost', 'pc', { group: 'nowhere', rackU: 3 })])
    }), { origin: 'template' });
    ok('a device in a group the document does not hold is ungrouped on load', node('lost').group === undefined);
    ok('and keeps its rack fields, for the finding to name', node('lost').rackU === 3);
    ok('every other device keeps its group', node('sw').group === 'rk' && node('pc1').group === 'office' && node('pc2').group === undefined);

    // ---- 3: the paths ----
    ok('a group\'s path, outermost first', groupPath(grp('rk')) === 'Building A / Server room / Rack 3', groupPath(grp('rk')));
    ok('a device in a rack: its path and its units', nodePlaceText(node('sw')) === 'Building A / Server room / Rack 3 · U12–U13 rear', nodePlaceText(node('sw')));
    ok('one unit reads as one', rackSpanText(node('rtr')) === 'U40 front', rackSpanText(node('rtr')));
    ok('a grouped device outside a rack: its path, its old location text set aside', nodePlaceText(node('pc1')) === 'Building A / Floor 1 / Office', nodePlaceText(node('pc1')));
    ok('an ungrouped device still reads its free-text location', nodePlaceText(node('pc2')) === 'Reception');
    ok('a device in a rack with no unit yet: the path alone', (() => { const n = { group: 'rk' }; return nodePlaceText(n) === 'Building A / Server room / Rack 3'; })());
    ok('an unnamed group reads as its kind', groupLabel(makeGroup({ kind: 'rack' })) === 'Rack' && groupLabel(makeGroup({})) === 'Group');
    ok('members, deep and own', groupMembers('bA').length === 4 && groupMembers('bA', false).length === 0 && groupMembers('rk').length === 2);
    ok('the tree, in order, with depth', json(groupTree().map((e) => `${e.depth}:${e.group.id}`)) === '["0:bA","1:f1","2:office","1:srvroom","2:rk"]',
       json(groupTree().map((e) => `${e.depth}:${e.group.id}`)));
    ok('a parent below a group would be a loop', !groupParentOk('bA', 'rk') && !groupParentOk('bA', 'bA') && groupParentOk('rk', 'f1') && groupParentOk('rk', null));
    ok('nor one that does not exist', !groupParentOk('rk', 'nope'));
    setLocale('es');
    ok('es: the face and an unnamed kind follow the language', rackSpanText(node('sw')) === 'U12–U13 trasera' && groupLabel(makeGroup({ kind: 'building' })) === 'Edificio',
       rackSpanText(node('sw')));
    setLocale('en');

    // ---- 4: the document ----
    ok(`this build writes v${DOC_VERSION}, and that is 7 or later`, DOC_VERSION >= 7 && serializeDoc().v === DOC_VERSION);
    const doc = serializeDoc();
    const keys = Object.keys(JSON.parse(json(doc)));
    ok('groups are written after the networks and before the accepted findings', keys.indexOf('groups') > keys.indexOf('links')
       && (keys.indexOf('accepted') === -1 || keys.indexOf('groups') < keys.indexOf('accepted')), json(keys));
    const again = (() => { loadDocState(JSON.parse(json(doc))); return serializeDoc(); })();
    ok('serialize -> load -> serialize is the same bytes', json(again) === json(doc));
    ok('the groups and the rack fields survive it', state.groups.length === 5 && node('sw').rackHeight === 2 && node('sw').rackFace === 'rear');

    const m = migrateDoc({ v: 6, nodes: [N('a', 'pc', { location: 'Room 1' })], links: [] });
    ok('a v6 document is brought to this version, from 6', m.doc.v === DOC_VERSION && m.from === 6 && !m.newer);
    ok('nothing is converted: the location text stays as it was', m.doc.nodes[0].location === 'Room 1' && !('groups' in m.doc));
    const m6 = migrateDoc({ v: 6, nodes: [], links: [], groups: [{ id: 'q', name: 'Q' }] });
    ok('the step leaves the document\'s keys alone', json(m6.doc.groups) === '[{"id":"q","name":"Q"}]');
    replaceDocument({ v: 6, nodes: [N('a', 'pc')], links: [] }, { origin: 'template' });
    ok('a v6 document opens editable, with no groups', !state.readOnly && state.groups.length === 0);
    replaceDocument({ v: 6, nodes: [N('a', 'pc', { group: 'g', rackU: 2 })], links: [], groups: [{ id: 'g', kind: 'rack' }] }, { origin: 'template' });
    ok('a v6 file that somehow carries them reads them', state.groups.length === 1 && node('a').group === 'g' && serializeDoc().v === DOC_VERSION);
    ok('a newer document still opens read-only', (replaceDocument({ v: DOC_VERSION + 1, nodes: [], links: [], groups: [] }, { origin: 'file' }), !!state.readOnly));
    ok('isDocShape refuses a groups key that is not a list', !isDocShape({ nodes: [], groups: {} }) && isDocShape({ nodes: [], groups: [] }));

    // The reload: the live document is the history entry (js/app.js), and a
    // reload reads it back through load().
    replaceDocument(site(), { origin: 'file', claim: true });
    initHistory();
    batch(() => { grp('rk').uHeight = 45; node('srv').group = 'rk'; node('srv').rackU = 30; save(); });
    flushPendingSaves();
    const before = json(serializeDoc());
    const entry = window.history.state && window.history.state.topoDoc;
    ok('the history entry carries the groups', !!entry && JSON.parse(entry).groups.length === 5 && JSON.parse(entry).groups.find((g) => g.id === 'rk').uHeight === 45);
    state.nodes = []; state.links = []; state.groups = [];
    await load();
    ok('a reload gives the same document back', json(serializeDoc()) === before && node('srv').rackU === 30);

    // A back-up file: what exportJsonFile writes, opened again here.
    const file = JSON.parse(json(Object.assign({ kind: 'nettopology', version: 1 }, { doc: stripIdentity(serializeDoc()) })));
    replaceDocument(templatesData.house, { origin: 'template' });
    answers.push(() => true);   // replace the canvas
    const took = await applyImportedDoc(file, { fileName: 'groups.nettopo.json' });
    ok('a back-up file opens with its groups and rack places', took && json(serializeDoc().groups) === json(JSON.parse(before).groups)
       && node('sw').rackU === 12 && node('srv').group === 'rk', String(took));
    ok('and the devices\' places byte for byte', json(serializeDoc().nodes) === json(JSON.parse(before).nodes));

    // A plain share link ('~', deflate): the sealed one is tests/suites/groupseal.js.
    const frag = await encodeShareFragment(json(serializeDoc()));
    const decoded = await decodeFragment(frag);
    openArrivedDocument(decoded);
    ok('a share link carries them, and opening it gives them back', json(JSON.parse(decoded).groups) === json(JSON.parse(before).groups) && json(serializeDoc().groups) === json(JSON.parse(before).groups));

    // ---- 5: the findings ----
    replaceDocument(site(), { origin: 'template' });
    const keysOf = (fs) => fs.map((f) => f.key);
    ok('the site as drawn raises no group or rack finding', !keysOf(topologyFindings()).some((k) => k === 'group' || k === 'rack'),
       json(topologyFindings().filter((f) => f.key === 'group' || f.key === 'rack').map((f) => f.line)));
    batch(() => { node('rtr').rackU = 50; save(); });
    let rackF = topologyFindings().filter((f) => f.key === 'rack');
    ok('a unit past the top of the rack is a finding on that device', rackF.length === 1 && rackF[0].level === 'bad' && json(rackF[0].nodeIds) === '["rtr"]'
       && /U50 is outside Rack 3, which has units 1 to 42/.test(rackF[0].line), json(rackF.map((f) => f.line)));
    batch(() => { node('rtr').rackU = 0; save(); });
    rackF = topologyFindings().filter((f) => f.key === 'rack');
    ok('a unit below the first is a finding too', rackF.length === 1 && rackF[0].level === 'bad' && /U0 is outside Rack 3/.test(rackF[0].line), json(rackF.map((f) => f.line)));
    batch(() => { node('rtr').rackU = 40; node('pc1').rackU = 3; delete node('pc2').group; node('pc2').rackFace = 'front'; save(); });
    rackF = topologyFindings().filter((f) => f.key === 'rack');
    ok('rack fields in a group that is not a rack, and in none, are findings', rackF.length === 2
       && rackF.some((f) => f.nodeIds[0] === 'pc1' && /Office is not a rack/.test(f.line))
       && rackF.some((f) => f.nodeIds[0] === 'pc2' && /in no rack/.test(f.line)), json(rackF.map((f) => f.line)));
    ok('they are warnings: the register misleads, the network works', rackF.every((f) => f.level === 'warn'));
    const looped = diagnoseDoc({ nodes: [N('x', 'pc', { group: 'a' })], links: [], groups: [{ id: 'a', name: 'A', parent: 'b' }, { id: 'b', name: 'B', parent: 'a' }] });
    const loopF = looped.findings.filter((f) => f.key === 'group');
    ok('a parent loop that skipped the loader is a finding naming the groups and their devices', loopF.length === 1 && loopF[0].level === 'bad'
       && /A, B/.test(loopF[0].line) && json(loopF[0].nodeIds) === '["x"]', json(loopF.map((f) => f.line)));
    const scratch = cloneData({ nodes: state.nodes, links: state.links, networks: state.networks });
    ok('a scratch copy without groups is read against the document\'s own (no spurious rack findings in a preview)',
       diagnoseDoc(scratch).findings.filter((f) => f.key === 'rack').length === 2);
    ok('a finding is accepted like any other', (() => {
      const f = topologyFindings().find((x) => x.nodeIds[0] === 'pc2' && x.key === 'rack');
      acceptFindings([f], 'Spare rail, to be mounted');
      const after = topologyFindings().find((x) => x.nodeIds[0] === 'pc2' && x.key === 'rack');
      return !!after.accepted && after.accepted.reason === 'Spare rail, to be mounted';
    })());
    ok('its check is named', findingCheckName('rack') === 'Rack' && findingCheckName('group') === 'Groups');

    // ---- 6: the Groups tab ----
    replaceDocument(site(), { origin: 'template' });
    initHistory();
    el('groupTabBtn').click();
    ok('the tab is there in the full editor and opens its panel', !el('cfgPanel-groups').classList.contains('hidden') && el('groupTabBtn').getAttribute('aria-selected') === 'true');
    const order = [...el('groupList').querySelectorAll('.grp-card')].map((c) => c.dataset.grp);
    ok('one card per group, in tree order', json(order) === '["bA","f1","office","srvroom","rk"]', json(order));
    ok('cards step in by depth', card('rk').style.getPropertyValue('--grp-depth') === '2' && card('bA').style.getPropertyValue('--grp-depth') === '0'
       && card('rk').getBoundingClientRect().left > card('bA').getBoundingClientRect().left);
    ok('a building counts every device below it', /4 devices/.test(card('bA').textContent) && !/here/.test(card('rk').textContent), card('bA').textContent.replace(/\s+/g, ' ').slice(0, 80));
    ok('a room with devices both in it and in a rack inside it says how many are its own', /3 devices · 1 here/.test(card('srvroom').textContent));
    ok('a rack shows its height', /Rack · 42U/.test(card('rk').querySelector('.chip-tag').textContent), card('rk').querySelector('.chip-tag').textContent);

    // + Group, named in the question; a building at the top.
    answers.push((req) => (req.kind === 'prompt' ? 'Building B' : null));
    el('addGroupBtn').click();
    await tick(); await tick();
    const bB = state.groups.find((g) => g.name === 'Building B');
    ok('+ Group adds a building at the top, its fields open', !!bB && bB.kind === 'building' && bB.parent === null && !card(bB.id).querySelector('.net-edit').hidden);
    undo();
    ok('one undo step takes it back', !state.groups.some((g) => g.name === 'Building B'));
    redo();
    ok('and redo puts it back', state.groups.some((g) => g.name === 'Building B'));
    renderGroupsPanel(true);

    // + Inside: the kind follows from the parent.
    answers.push(() => 'Rack 4');
    act('srvroom', 'inside').click();
    await tick(); await tick();
    const r4 = state.groups.find((g) => g.name === 'Rack 4');
    ok('+ Inside a room adds a rack in it, 42U', !!r4 && r4.parent === 'srvroom' && r4.kind === 'rack' && r4.uHeight === 42);
    answers.push(() => null);
    const n0 = state.groups.length;
    act('bA', 'inside').click();
    await tick(); await tick();
    ok('a dismissed name adds nothing', state.groups.length === n0);

    // Edit: name (typed: one step), kind, parent.
    if (!_grpEditOpen.has('f1')) act('f1', 'edit').click();
    const name = field('f1', 'name');
    name.focus(); name.value = 'Ground floor'; fire(name, 'input');
    ok('a typed name changes the group at once', grp('f1').name === 'Ground floor');
    ok('and the device paths with it', nodePlaceText(node('pc1')) === 'Building A / Ground floor / Office');
    name.blur(); commitTyping(); renderGroupsPanel(true);
    undo();
    ok('a typed name is one undo step', grp('f1').name === 'Floor 1', grp('f1').name);
    redo();
    renderGroupsPanel(true);
    if (!_grpEditOpen.has('rk')) act('rk', 'edit').click();
    const parentSel = field('rk', 'parent');
    const offered = [...parentSel.options].map((o) => o.value);
    ok('the parent list offers the top and every group but itself and those below it', offered[0] === '' && !offered.includes('rk') && offered.includes('f1') && offered.includes('bA'), json(offered));
    if (!_grpEditOpen.has('bA')) act('bA', 'edit').click();
    const bAOffers = [...field('bA', 'parent').options].map((o) => o.value);
    ok('a building cannot go inside its own rack', !bAOffers.includes('rk') && !bAOffers.includes('srvroom') && !bAOffers.includes('office'), json(bAOffers));
    // Opening another card rebuilt the tab: the select is a new element.
    field('rk', 'parent').value = 'office'; fire(field('rk', 'parent'), 'change');
    ok('re-parenting moves the rack and its devices\' paths', grp('rk').parent === 'office' && groupPathOf(node('sw')) === 'Building A / Ground floor / Office / Rack 3');
    ok('and the tab follows, in tree order', [...el('groupList').querySelectorAll('.grp-card')].map((c) => c.dataset.grp).indexOf('rk')
       === [...el('groupList').querySelectorAll('.grp-card')].map((c) => c.dataset.grp).indexOf('office') + 1);
    undo();
    ok('a re-parent is one undo step', grp('rk').parent === 'srvroom');
    renderGroupsPanel(true);
    if (!_grpEditOpen.has('rk')) act('rk', 'edit').click();
    // Round 2, item 4: the height is picked from the sizes racks come in,
    // and a rack made shorter than a placed device asks first, naming it,
    // then frees its units (it waits under Not placed yet) rather than
    // leaving it outside the rack as a finding. (Before, the height was a
    // typed number and the device became a finding.)
    const h = field('rk', 'uHeight');
    answers.push((req) => (req.kind === 'confirm' ? true : null));
    h.value = '24'; fire(h, 'change');
    await tick(); await tick();
    ok('a rack\'s height is picked, after a question that names the device above the new top', grp('rk').uHeight === 24
       && /RTR \(U40 front\)/.test(asked[asked.length - 1].message), asked.length ? asked[asked.length - 1].message : '');
    ok('that device then waits in the rack with no units, and is no finding', node('rtr').group === 'rk' && node('rtr').rackU === undefined
       && !topologyFindings().some((f) => f.key === 'rack' && f.nodeIds[0] === 'rtr'));
    undo();
    ok('one undo puts the height and the device back', grp('rk').uHeight === 42 && node('rtr').rackU === 40);
    renderGroupsPanel(true);
    if (!_grpEditOpen.has('rk')) act('rk', 'edit').click();

    // A rack turned into a room asks, then takes its devices' places with it.
    answers.push((req) => (asked.length && req.kind === 'confirm' ? false : null));
    const kindSel = field('rk', 'kind');
    kindSel.value = 'room'; fire(kindSel, 'change');
    await tick(); await tick();
    ok('turning a rack with placed devices into a room asks first, and No changes nothing', grp('rk').kind === 'rack' && node('sw').rackU === 12
       && /placed devices lose/.test(asked[asked.length - 1].message), asked.length ? asked[asked.length - 1].message : '');
    renderGroupsPanel(true);
    answers.push(() => true);
    field('rk', 'kind').value = 'room'; fire(field('rk', 'kind'), 'change');
    await tick(); await tick();
    ok('Yes changes the kind and clears the places, in one step', grp('rk').kind === 'room' && !hasRackFields(node('sw')) && !hasRackFields(node('rtr')));
    undo();
    ok('which one undo puts back', grp('rk').kind === 'rack' && node('sw').rackU === 12 && node('rtr').rackFace === 'front');
    renderGroupsPanel(true);

    // Select members: the group and everything below it.
    act('srvroom', 'members').click();
    ok('Select members takes every device in the group and below it', json(selectedOf('node').sort()) === '["rtr","srv","sw"]', json(selectedOf('node')));
    select(null, null);
    ok('a group with nobody in it cannot select anyone', act(r4.id, 'members').disabled === true);

    // Delete, keeping the devices: they are ungrouped and out of the rack;
    // the groups inside move up.
    answers.push((req) => (req.kind === 'choice' ? 'ungroup' : null));
    act('srvroom', 'delete').click();
    await tick(); await tick();
    const q = asked[asked.length - 1];
    ok('Delete asks, naming what happens to the groups inside and the devices', q.kind === 'choice' && /2 groups inside it move up to Building A/.test(q.message)
       && /Its one device stays on the map/.test(q.message), q.message);
    ok('the group goes; its own device is ungrouped; the racks inside move up', !grp('srvroom') && node('srv').group === undefined && grp('rk').parent === 'bA' && grp(r4.id).parent === 'bA');
    ok('devices in the groups inside are untouched', node('sw').group === 'rk' && node('sw').rackU === 12);
    undo();
    ok('one undo puts the group, its device and its children back', !!grp('srvroom') && node('srv').group === 'srvroom' && grp('rk').parent === 'srvroom');
    renderGroupsPanel(true);

    // Delete a rack and its devices, cables and all.
    answers.push((req) => (req.kind === 'choice' ? 'members' : null));
    act('rk', 'delete').click();
    await tick(); await tick();
    ok('Delete with its devices removes them and their cables', !grp('rk') && !node('sw') && !node('rtr') && !state.links.length && node('srv'));
    undo();
    ok('one undo puts them all back', !!grp('rk') && !!node('sw') && state.links.length === 1 && node('sw').rackU === 12);
    renderGroupsPanel(true);
    answers.push(() => true);
    act(r4.id, 'delete').click();
    await tick(); await tick();
    ok('an empty group is a plain yes-or-no', asked[asked.length - 1].kind === 'confirm' && !grp(r4.id));
    // Ungrouping out of a rack: the rack fields go with it.
    answers.push((req) => (req.kind === 'choice' ? 'ungroup' : null));
    renderGroupsPanel(true);
    act('rk', 'delete').click();
    await tick(); await tick();
    ok('devices taken out of a deleted rack lose their places in it (no finding left behind)', !hasRackFields(node('sw')) && !hasRackFields(node('rtr'))
       && !topologyFindings().some((f) => f.key === 'rack'));
    undo();

    // ---- 7: the device editor's Group picker ----
    showConfigTab('config');
    select('sw', 'node');
    const pick = el('propGroup');
    const labels = [...pick.options].map((o) => o.textContent);
    ok('the picker lists none and every group, indented, by tree', pick.options[0].value === '' && labels.length === state.groups.length + 1
       && labels.some((l) => l === '\u2002\u2514\u00a0Rack 3 (Rack)') && labels.includes('Building A (Building)'), json(labels));
    ok('it shows the device\'s group and its place', pick.value === 'rk' && el('groupPathNote').textContent === 'Building A / Server room / Rack 3 · U12–U13 rear');
    ok('in a rack, the unit, height and face are shown', !el('rackPlaceRow').classList.contains('hidden') && el('propRackU').value === '12'
       && el('propRackHeight').value === '2' && el('propRackFace').value === 'rear' && el('propRackU').max === '42');
    const u = el('propRackU');
    u.focus(); u.value = '20'; fire(u, 'input');
    ok('typing a unit moves it', node('sw').rackU === 20 && /U20–U21/.test(el('groupPathNote').textContent));
    u.blur(); commitTyping();
    undo();
    ok('a typed unit is one undo step', node('sw').rackU === 12);
    select('sw', 'node');
    u.focus(); u.value = '0'; fire(u, 'input');
    ok('a unit of 0 is kept as typed, and the finding says so', node('sw').rackU === 0
       && topologyFindings().some((f) => f.key === 'rack' && f.nodeIds[0] === 'sw' && /U0 is outside/.test(f.line)));
    u.blur(); commitTyping(); undo();
    select('sw', 'node');
    const ht = el('propRackHeight');
    ht.focus(); ht.value = '1'; fire(ht, 'input'); ht.blur(); commitTyping();
    ok('a height of 1 is the default, and is not stored', !('rackHeight' in node('sw')));
    undo(); select('sw', 'node');
    el('propRackFace').value = 'front'; fire(el('propRackFace'), 'change');
    ok('the face is one change', node('sw').rackFace === 'front');
    undo(); select('sw', 'node');
    pick.value = 'office'; fire(pick, 'change');
    ok('moving it out of the rack clears its place there, in one step', node('sw').group === 'office' && !hasRackFields(node('sw'))
       && el('rackPlaceRow').classList.contains('hidden') && el('groupPathNote').textContent === 'Building A / Ground floor / Office', el('groupPathNote').textContent);
    undo();
    ok('which one undo puts back', node('sw').group === 'rk' && node('sw').rackU === 12);
    select('pc2', 'node');
    ok('an ungrouped device: none, no path, no rack row', el('propGroup').value === '' && el('groupPathNote').classList.contains('hidden')
       && el('rackPlaceRow').classList.contains('hidden'));
    el('propGroup').value = 'rk'; fire(el('propGroup'), 'change');
    ok('put in a rack, it is in it but not yet placed', node('pc2').group === 'rk' && node('pc2').rackU === undefined && !el('rackPlaceRow').classList.contains('hidden')
       && el('propRackU').value === '');
    ok('an unplaced member raises nothing', !topologyFindings().some((f) => f.key === 'rack'));
    undo();
    // A rename in the tab reaches the picker of the selected device.
    select('sw', 'node');
    showConfigTab('groups');
    if (!_grpEditOpen.has('rk')) act('rk', 'edit').click();
    field('rk', 'name').value = 'Rack 9'; fire(field('rk', 'name'), 'input');
    commitTyping();
    ok('the picker follows a rename in the tab', [...el('propGroup').options].some((o) => /Rack 9/.test(o.textContent))
       && /Rack 9 · U12/.test(el('groupPathNote').textContent));
    undo();
    ok('and its undo', [...el('propGroup').options].some((o) => /Rack 3/.test(o.textContent)));
    showConfigTab('config');
    select(null, null);
    ok('with nothing selected the picker is empty and disabled', el('propGroup').disabled === true);

    // ---- 7b: blocks carry no place ----
    // A block is a stamp for any document: its devices come in ungrouped,
    // whether the target holds the group (no doubled rack units) or not (no
    // dangling id in the history entry, the back-up or a share link).
    replaceDocument(site(), { origin: 'template' });
    select('sw', 'node');
    const blk = blockFromSelection();
    ok('a block made from racked devices carries no group or rack fields', blk.nodes.length === 1
       && !['group', 'rackU', 'rackHeight', 'rackFace'].some((k) => k in blk.nodes[0]), json(blk.nodes[0]));
    const legacy = cloneData(blk); Object.assign(legacy.nodes[0], { group: 'rk', rackU: 12, rackHeight: 2, rackFace: 'rear' });
    const sameDoc = insertBlock({ name: 'x', doc: legacy });
    const copy = getNode(sameDoc.nodeIds[0]);
    ok('one that still has them, put back in the same document, does not claim the rack place again', !copy.group && !hasRackFields(copy)
       && !topologyFindings().some((f) => f.key === 'rack'));
    undo();
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'template' });
    insertBlock({ name: 'x', doc: legacy });
    // serializeDoc() leaves unused keys present but undefined; JSON drops them.
    const saved = serializeDoc();
    ok('nor, put in a document without that group, leaves a dangling id behind', state.groups.length === 0
       && saved.nodes.length === 1 && !['group', 'rackU', 'rackHeight', 'rackFace'].some((k) => saved.nodes[0][k] !== undefined)
       && !topologyFindings().some((f) => f.key === 'rack'), json(saved.nodes[0]));
    replaceDocument(site(), { origin: 'template' });

    // ---- 8: read-only, and the language ----
    showConfigTab('groups');
    setLocale('es'); applyStaticI18n(); renderGroupsPanel(true);
    ok('es: the tab and its button are translated', el('groupTabBtn').textContent === 'Grupos' && el('addGroupBtn').textContent === '+ Grupo', el('groupTabBtn').textContent);
    ok('es: a card speaks Spanish', /4 dispositivos/.test(card('bA').textContent) && /Seleccionar miembros/.test(card('bA').textContent) && /Edificio/.test(card('bA').textContent));
    setLocale('en'); applyStaticI18n(); renderGroupsPanel(true);
    ok('back to en', el('groupTabBtn').textContent === 'Groups');

    replaceDocument({ v: DOC_VERSION + 1, nodes: [], links: [], groups: [{ id: 'x', name: 'X' }] }, { origin: 'file' });
    ok('a newer document\'s groups cannot be edited', el('groupList').inert === true && el('addGroupBtn').inert === true);
    const nRo = state.groups.length;
    answers.push(() => 'Nope');
    await addGroup(null);
    ok('nor added to', state.groups.length === nRo);
    replaceDocument(site(), { origin: 'template' });
    ok('opening another document puts them back in reach', el('groupList').inert === false);
    ok('the tab and the picker are the full editor\'s (data-adv: the reduced views drop them)',
       el('groupTabBtn').hasAttribute('data-adv') && el('cfgPanel-groups').hasAttribute('data-adv') && !!el('propGroup').closest('[data-adv]'));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
