// Groups, step A part 2 (Review-Packs/Topo-groups.md): groups across the
// lists. What is held here:
//   1. where a device is, as one line: its group's path (and units, in a
//      rack) wherever the free-text location showed (the report's rows, the
//      printed labels, the table), and the free text where it has no group;
//   2. the search: loc: on the free text and on the path, group: by a name or
//      a fragment of the path, through every ancestor, has:group, plain text;
//   3. the paths typed as text: splitting, the kind guessed, a path resolved
//      (whole, by id, segment by segment, ambiguous, missing);
//   4. Make groups from locations: offered only with locations and no
//      groups, previewed, merged by name, a unit range read as a rack place,
//      No changes nothing, Yes is one undo step, the free text stays;
//   5. the bulk panel's Move to group: plan, notes, the rack places left
//      behind, the findings delta, one batch, out of every group;
//   6. the table: the Group column (picked, typed, pasted, refused), the
//      Location column greyed under a group, the Groups tab (tree order,
//      rename, kind asked first, parent loop refused, height on racks only,
//      search, a row selecting its members);
//   7. the spreadsheet: devices.csv's group / rack columns, the formula
//      guard, missing groups made only once ticked (and the tick in the
//      review), rack fields only in a rack, one undo step; groups.csv out and
//      back in, its conflicts; a whole site rebuilt from groups.csv then
//      devices.csv;
//   8. the report: the inventory under group headings when there are groups,
//      as before when there are none.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const answers = [];
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return answers.length ? answers.shift()(req) : (req.kind === 'confirm' ? false : null); });
  const json = (v) => JSON.stringify(v);
  const node = (id) => getNode(id);
  const grp = (id) => groupById(id);

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', ports: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  // The same small site as tests/suites/groups.js.
  const site = () => ({ v: DOC_VERSION,
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
  // A register from before groups: places as free text.
  const legacy = () => ({ v: DOC_VERSION,
    nodes: [
      N('a', 'server', { location: 'Building A / Server room / Rack 3 / U12-U13' }),
      N('b', 'switch', { location: 'building a / server room / rack 3 / U40', interfaces: [] }),
      N('c', 'pc', { location: 'Building A > Floor 2 > Office 201' }),
      N('d', 'pc', { location: 'Building A, Floor 2, Office 201' }),
      N('e', 'printer', { location: 'Reception' }),
      N('f', 'pc', {})
    ],
    links: [] });
  const ids = (list) => list.map((n) => n.id).sort().join(',');
  const matches = (q) => ids(state.nodes.filter((n) => queryMatch(parseQuery(q), 'node', n)));

  try {
    replaceDocument(site(), { origin: 'template' });

    // ---- 1: where a device is ----
    const rows = reportDevices();
    const row = (id) => rows.find((r) => r.id === id);
    ok('a grouped device is placed by its path', row('srv').place === 'Building A / Server room' && row('srv').groupId === 'srvroom');
    ok('in a rack, by its path and its units', row('sw').place === 'Building A / Server room / Rack 3 · U12–U13 rear' && row('sw').rackSpan === 'U12–U13 rear', row('sw').place);
    ok('a grouped device keeps its free text, which the path stands in front of', row('pc1').place === 'Building A / Floor 1 / Office' && row('pc1').location === 'Desk 4');
    ok('a device in no group is placed by its free text', row('pc2').place === 'Reception' && row('pc2').groupId === '');
    const labels = labelsFor([{ type: 'node', id: 'sw' }, { type: 'node', id: 'pc2' }].map((e) => { node(e.id).assetTag = `T-${e.id}`; return e; }));
    ok('a printed label says where the device is the same way', labels.devices[0].location === row('sw').place && labels.devices[1].location === 'Reception');
    delete node('sw').assetTag; delete node('pc2').assetTag;

    // ---- 2: the search ----
    ok('loc: finds the free text', matches('loc:reception') === 'pc2' && matches('loc:"desk 4"') === 'pc1');
    ok('loc: finds the path too', matches('loc:"server room"') === 'rtr,srv,sw' && matches('loc:office') === 'pc1');
    ok('loc: finds a rack place by its units', matches('loc:u12') === 'sw');
    ok('group: by the group\'s own name', matches('group:"rack 3"') === 'rtr,sw');
    ok('group: through every ancestor', matches('group:"building a"') === 'pc1,rtr,srv,sw' && matches('group:floor') === 'pc1');
    ok('group: by a fragment of the path, however its slashes were spaced', matches('group:"server room/rack"') === 'rtr,sw' && matches('group:"room / rack 3"') === 'rtr,sw');
    ok('a free-text location is not a group', matches('group:reception') === '' && matches('group:desk') === '');
    ok('-group: leaves them out', matches('-group:"building a"') === 'pc2');
    ok('grp: is the same prefix', matches('grp:office') === 'pc1');
    ok('has:group', matches('has:group') === 'pc1,rtr,srv,sw' && matches('-has:group') === 'pc2');
    ok('plain text finds the path', matches('"server room"') === 'rtr,srv,sw');
    ok('a unit number is not plain text: "12" is not U12', !matches('12').includes('sw'));
    ok('group: is understood', parseQuery('group:x').errors.length === 0);

    // ---- 3: paths as text ----
    ok('a path splits on " / ", ">" and ","', json(splitPlacePath('A / B > C, D')) === '["A","B","C","D"]');
    ok('a slash needs its spaces: "Rack A/B" is one name', json(splitPlacePath('Room 1 / Rack A/B')) === '["Room 1","Rack A/B"]');
    ok('a kind is guessed from the name, in every language', guessGroupKind('Rack 3') === 'rack' && guessGroupKind('2nd floor') === 'floor'
       && guessGroupKind('Sala de servidores') === 'room' && guessGroupKind('Edificio B') === 'building' && guessGroupKind('Стойка 2') === 'rack'
       && guessGroupKind('3階') === 'floor' && guessGroupKind('Storage') === 'custom' && guessGroupKind('Reception') === 'custom');
    ok('a unit range at the end is a place, not a group', json(parseRackSpan('U12-U13')) === '{"u":12,"height":2}' && json(parseRackSpan('u 7')) === '{"u":7,"height":1}'
       && parseRackSpan('U9-U3') === null && parseRackSpan('Unit 4') === null);
    ok('a whole path finds its group', findGroupByPath('building a/server room / RACK 3').group === grp('rk'));
    ok('a name one group has finds it', findGroupByPath('Office').group === grp('office'));
    ok('an id finds its group', findGroupByPath('srvroom').group === grp('srvroom'));
    ok('a path segment by segment, from any group of the first name', findGroupByPath('Server room > Rack 3').group === grp('rk'));
    const miss = findGroupByPath('Building A / Server room / Rack 4');
    ok('a missing tail says where it would go', miss.missing && json(miss.missing) === '["Rack 4"]' && miss.parent === grp('srvroom'));
    batch(() => { state.groups = state.groups.concat(makeGroup({ id: 'o2', name: 'Office', kind: 'room', parent: 'bA' })); save(); });
    ok('two groups of one name are ambiguous', findGroupByPath('Office').ambiguous === 2 && findGroupByPath('Building A / Office').group === grp('o2'));
    undo();
    const maker = groupPathMaker(state.groups);
    const m1 = maker.resolve('Building B / Rack 9', true), m2 = maker.resolve('building b / rack 9', true);
    ok('a maker makes a missing path once, parents first', m1.made === 2 && m2.made === 0 && m1.group === m2.group && maker.made.length === 2
       && maker.made[1].parent === maker.made[0].id && maker.made[1].kind === 'rack' && maker.made[0].kind === 'building');
    ok('and adds nothing to the document', !state.groups.some((g) => g.name === 'Building B'));
    ok('without making, it says what is missing', groupPathMaker(state.groups).resolve('Building A / Annex', false).missing === 'Building A / Annex');

    // ---- 4: Make groups from locations ----
    replaceDocument(legacy(), { origin: 'template' });
    showConfigTab('groups');
    const fromLocBtn = () => el('groupList').querySelector('[data-act="from-locations"]');
    ok('offered with locations and no groups', !!fromLocBtn());
    const plan = planGroupsFromLocations();
    const names = groupTree(plan.groups).map((e) => `${'-'.repeat(e.depth)}${e.group.name}:${e.group.kind}`).join(' ');
    ok('the tree comes out of the text, one group per name and parent', names === 'Building A:building -Floor 2:floor --Office 201:room -Server room:room --Rack 3:rack Reception:custom', names);
    const rack = plan.groups.find((g) => g.name === 'Rack 3');
    const at = (id) => plan.assign.find((a) => a.nodeId === id);
    ok('a unit range is read as a rack place', at('a').groupId === rack.id && at('a').rackU === 12 && at('a').rackHeight === 2 && at('b').rackU === 40 && at('b').rackHeight === undefined);
    ok('the three separators make one place', at('c').groupId === at('d').groupId);
    ok('a device with no location is left out', !at('f'));
    ok('the plan writes nothing', state.groups.length === 0 && !node('a').group);
    const before = json(serializeDoc());
    asked.length = 0;
    answers.push(() => false);
    fromLocBtn().click();
    await tick(); await tick();
    ok('it asks, with the tree in the question', asked.length === 1 && asked[0].kind === 'confirm' && /6 groups from the locations of 5 devices/.test(asked[0].message)
       && /Rack 3 \(Rack\) · 2 devices/.test(asked[0].message) && /Each location stays as it was typed/.test(asked[0].message), asked[0] && asked[0].message);
    ok('No changes nothing', json(serializeDoc()) === before);
    answers.push(() => true);
    const made = await makeGroupsFromLocations();
    ok('Yes makes them', !!made && state.groups.length === 6 && groupPathOf(node('a')) === 'Building A / Server room / Rack 3' && node('a').rackU === 12 && node('a').rackHeight === 2);
    ok('every device with a location is in its group', node('c').group === node('d').group && groupPathOf(node('e')) === 'Reception' && !node('f').group);
    ok('the free text stays as typed', node('a').location === 'Building A / Server room / Rack 3 / U12-U13' && node('d').location === 'Building A, Floor 2, Office 201');
    ok('the tab shows the tree and no longer offers it', el('groupList').querySelectorAll('.grp-card').length === 6 && !fromLocBtn());
    undo();
    ok('one undo takes all of it back', json(serializeDoc()) === before && state.groups.length === 0);
    replaceDocument({ v: DOC_VERSION, nodes: [N('x', 'pc')], links: [] }, { origin: 'template' });
    renderGroupsPanel(true);
    ok('not offered with no location to read', !fromLocBtn());

    // ---- 5: the bulk panel's Move to group ----
    replaceDocument(site(), { origin: 'template' });
    let bp = bulkPlanGroup(['srv', 'pc2', 'rtr'], 'office');
    ok('each device moves, in name order', bp.rows.map((r) => `${r.name}:${r.status}`).join(',') === 'PC2:change,RTR:change,SRV:change' && bp.counts.change === 3);
    ok('the preview says where from and where to', bp.rows[0].before === '—' && bp.rows[0].after === 'Building A / Floor 1 / Office'
       && bp.rows[1].before === 'Building A / Server room / Rack 3 · U40 front');
    ok('out of a rack, its units go with it', json(bp.ops.find((o) => o.nodeId === 'rtr').drop) === '["rackU","rackFace"]');
    ok('and the preview says so', bp.notes.some((n) => /leaves its units in the rack behind/.test(n)), json(bp.notes));
    bp = bulkPlanGroup(['sw', 'rtr'], 'rk');
    ok('one already there is unchanged', bp.counts.same === 2 && bp.counts.change === 0);
    bp = bulkPlanGroup(['srv', 'pc2'], 'rk');
    ok('into a rack, unplaced, and the preview says to place them', bp.counts.change === 2 && bp.notes.some((n) => /go in without a unit/.test(n)) && bp.ops.every((o) => !o.drop.length));
    ok('a group that is not one is an error', bulkPlanGroup(['srv', 'pc2'], 'nope').errors.length === 1);
    // A device placed above U40 moved into a smaller rack: the findings delta
    // says so. So does the 2U switch at U12 of a 12U rack, which now goes
    // past its top (step C's finding): two more.
    batch(() => { state.groups = state.groups.concat(makeGroup({ id: 'small', name: 'Wall rack', kind: 'rack', uHeight: 12, parent: 'office' })); save(); });
    const delta = bulkFindingsDelta(bulkPlanGroup(['rtr', 'sw'], 'small'));
    ok('the findings delta is the engine on a scratch copy, groups and all', delta.length === 1 && delta[0].key === 'rack' && delta[0].diff === 2, json(delta));
    const beforeMove = json(serializeDoc());
    selectEntries([{ type: 'node', id: 'srv' }, { type: 'node', id: 'pc2' }, { type: 'node', id: 'rtr' }]);
    ok('the panel has a Group tab', !!el('bulkTabs').querySelector('[data-bulk="group"]'));
    el('bulkTabs').querySelector('[data-bulk="group"]').click();
    ok('its pane lists the tree and out of every group, nothing picked', !el('bulkPane-group').classList.contains('hidden')
       && el('bulkGroup').value === '' && el('bulkGroup').querySelectorAll('option').length === state.groups.length + 2 && el('bulkPreviewBtn').disabled);
    el('bulkGroup').value = 'office';
    el('bulkGroup').dispatchEvent(new Event('change', { bubbles: true }));
    ok('picking one offers Preview', !el('bulkPreviewBtn').disabled);
    el('bulkPreviewBtn').click();
    ok('the preview names the group', el('bulkTitle').textContent === 'Move to Office' && el('bulkPreview').querySelectorAll('tr').length === 3);
    el('bulkApplyBtn').click();
    ok('Apply moves them all', ['srv', 'pc2', 'rtr'].every((id) => node(id).group === 'office') && node('rtr').rackU === undefined && node('rtr').rackFace === undefined);
    undo();
    ok('in one undo step', json(serializeDoc()) === beforeMove);
    const outPlan = bulkPlanGroup(['srv', 'sw'], BULK_NO_GROUP);
    applyBulkPlan(outPlan);
    ok('out of every group: no group, no rack place', !node('srv').group && !node('sw').group && !hasRackFields(node('sw')));
    undo();
    ok('which one undo puts back', node('sw').group === 'rk' && node('sw').rackU === 12);
    ok('the Group tab is plain words, translated', (() => {
      setLocale('es'); applyStaticI18n();
      const r = el('bulkTabs').querySelector('[data-bulk="group"]').textContent === 'Grupo' && t('Move to {group}', { group: 'X' }) === 'Mover a X';
      setLocale('en'); applyStaticI18n();
      return r;
    })());
    select(null);

    // ---- 6: the table ----
    replaceDocument(site(), { origin: 'template' });
    setView('table');
    showTableTab('devices');
    const cell = (key, col) => el('tvGrid').querySelector(`tr[data-row="${key}"] td[data-col="${col}"]`);
    ok('the Devices tab has a Group column, after the serial', !!cell('n:sw', 'group') && TV_COLS.devices.findIndex((c) => c.key === 'group') === TV_COLS.devices.findIndex((c) => c.key === 'serial') + 1);
    ok('it shows the path and the units', cell('n:sw', 'group').textContent === 'Building A / Server room / Rack 3 · U12–U13 rear' && cell('n:pc2', 'group').textContent === '');
    ok('a grouped device\'s free text is greyed, with the path in its title', cell('n:pc1', 'location').classList.contains('tv-muted')
       && /Office/.test(cell('n:pc1', 'location').title) && !cell('n:pc2', 'location').classList.contains('tv-muted'));
    const gcol = TV_COLS.devices.find((c) => c.key === 'group');
    const drow = (id) => _tv.rows.find((r) => r.key === `n:${id}`);
    ok('typed: a path, a name, an id or blank', gcol.parse('Building A / Floor 1 / Office').value === 'office' && gcol.parse('rack 3').value === 'rk'
       && gcol.parse('srvroom').value === 'srvroom' && gcol.parse('').value === '');
    ok('a path the map lacks is refused, not made', gcol.parse('Building A / Annex').error === true && state.groups.length === 5);
    commitValue(drow('pc2'), gcol, 'rk');
    ok('picked: into the group, one edit', node('pc2').group === 'rk' && cell('n:pc2', 'group').textContent === 'Building A / Server room / Rack 3');
    undo();
    ok('one undo step', !node('pc2').group);
    commitValue(drow('sw'), gcol, 'office');
    ok('out of a rack, its units go with it, as the picker has it', node('sw').group === 'office' && !hasRackFields(node('sw')));
    undo();
    // Paste a column of paths down the devices from RTR.
    const pp = planPaste('group', 'Office\nBuilding A / Annex\n\nBuilding A / Floor 1 / Office', { rows: ['rtr', 'sw', 'srv', 'pc1'].map(drow), mode: 'selected' });
    ok('a pasted column of paths: valid, refused, blank, unchanged', pp.cells.map((c) => c.status).join(',') === 'change,bad,skip,same', pp.cells.map((c) => c.status).join(','));
    const pd = pasteFindingsDelta(pp);
    ok('its findings delta sees the groups', json(pd) === '[]', json(pd));
    applyPastePlan(pp);
    ok('applied, as one step', node('rtr').group === 'office' && node('rtr').rackU === undefined && node('sw').group === 'rk');
    undo();
    ok('undone', node('rtr').group === 'rk' && node('rtr').rackU === 40);

    showTableTab('groups');
    const grow = (id) => _tv.rows.find((r) => r.key === `g:${id}`);
    ok('the Groups tab lists every group in tree order', _tv.rows.map((r) => r.ref.groupId).join(',') === 'bA,f1,office,srvroom,rk', _tv.rows.map((r) => r.ref.groupId).join(','));
    ok('stepped in by depth, with kind, parent, height and devices', /└ Rack 3$/.test(cell('g:rk', 'g:name').textContent) && cell('g:rk', 'g:kind').textContent === 'Rack'
       && cell('g:rk', 'g:parent').textContent === 'Building A / Server room' && cell('g:rk', 'g:uHeight').textContent === '42'
       && cell('g:bA', 'g:deep').textContent === '4' && cell('g:office', 'g:uHeight').textContent === '—');
    const gc = (key) => TV_COLS.groups.find((c) => c.key === key);
    commitValue(grow('f1'), gc('g:name'), 'Ground floor');
    ok('rename, one step', grp('f1').name === 'Ground floor');
    undo();
    ok('the height is a rack\'s only', canEdit(grow('rk'), gc('g:uHeight')) && !canEdit(grow('office'), gc('g:uHeight')));
    // Round 2, item 4: a rack made shorter than a placed device asks first,
    // naming it, and that device loses its units (before, the height was
    // simply written and the device left outside the rack).
    asked.length = 0;
    answers.push(() => true);
    commitValue(grow('rk'), gc('g:uHeight'), 24);
    await tick(); await tick();
    ok('a rack\'s height, one step, after a question that names the device above it', grp('rk').uHeight === 24 && asked.length === 1
       && /RTR \(U40 front\)/.test(asked[0].message) && node('rtr').rackU === undefined, asked.length ? asked[0].message : '');
    undo();
    ok('one undo puts both back', grp('rk').uHeight === 42 && node('rtr').rackU === 40);
    ok('a parent that is itself or inside it is refused', gc('g:parent').parse('Rack 3', grow('srvroom')).error === true && gc('g:parent').parse('srvroom', grow('srvroom')).error === true
       && gc('g:parent').parse('Floor 1', grow('srvroom')).value === 'f1' && gc('g:parent').parse('', grow('srvroom')).value === null);
    ok('the parent picker leaves out itself and what is inside it', gc('g:parent').options(grow('srvroom')).map((o) => o.value).join(',') === ',bA,f1,office');
    commitValue(grow('srvroom'), gc('g:parent'), 'f1');
    ok('re-parented, one step', grp('srvroom').parent === 'f1' && groupPathOf(node('sw')) === 'Building A / Floor 1 / Server room / Rack 3');
    undo();
    asked.length = 0;
    answers.push(() => false);
    commitValue(grow('rk'), gc('g:kind'), 'room');
    await tick(); await tick();
    ok('a rack with placed devices turned into a room asks first, and No changes nothing', asked.length === 1 && /stops being a rack/.test(asked[0].message) && grp('rk').kind === 'rack' && node('sw').rackU === 12);
    answers.push(() => true);
    commitValue(grow('rk'), gc('g:kind'), 'room');
    await tick(); await tick();
    ok('Yes changes it, and its devices lose their places', grp('rk').kind === 'room' && !hasRackFields(node('sw')) && !hasRackFields(node('rtr')));
    undo();
    ok('in one undo step', grp('rk').kind === 'rack' && node('sw').rackU === 12 && node('rtr').rackFace === 'front');
    asked.length = 0;
    commitValue(grow('office'), gc('g:kind'), 'rack');
    ok('a room turned into a rack asks nothing and gets a height', asked.length === 0 && grp('office').kind === 'rack' && grp('office').uHeight === 42);
    undo();
    setQuery('group:office');
    ok('the search keeps the groups it matches, and those holding a match', _tv.rows.map((r) => r.ref.groupId).join(',') === 'bA,f1,office', _tv.rows.map((r) => r.ref.groupId).join(','));
    setQuery('rack');
    ok('plain text finds a group by its name or path', _tv.rows.map((r) => r.ref.groupId).join(',') === 'bA,srvroom,rk', _tv.rows.map((r) => r.ref.groupId).join(','));
    setQuery('');
    focusRow(grow('srvroom'));
    ok('a group row selects its devices, those inside too', selectedOf('node').sort().join(',') === 'rtr,srv,sw');
    select(null);
    setView('map');

    // ---- 7: the spreadsheet ----
    replaceDocument(site(), { origin: 'template' });
    const dev = csvDevicesSheet();
    const col = (h) => dev.headers.indexOf(h);
    const cellOf = (id, h) => dev.rows.find((r) => r[0] === id)[col(h)];
    ok('devices.csv has group, rack_u, rack_height and rack_face, after status', ['group', 'rack_u', 'rack_height', 'rack_face'].every((h) => col(h) > col('status')));
    ok('the group as its path, the rack fields as they are', cellOf('sw', 'group') === 'Building A / Server room / Rack 3' && cellOf('sw', 'rack_u') === '12'
       && cellOf('sw', 'rack_height') === '2' && cellOf('sw', 'rack_face') === 'rear' && cellOf('pc2', 'group') === '' && cellOf('rtr', 'rack_height') === '');
    batch(() => { grp('office').name = '=HYPERLINK("x")'; save(); });
    const guarded = csvText(csvDevicesSheet());
    ok('a group name that is a formula is written as text', guarded.includes(`'Building A / Floor 1 / =HYPERLINK`) === false && guarded.includes(`"Building A / Floor 1 / =HYPERLINK(""x"")"`), guarded.split('\r\n').find((l) => l.includes('HYPERLINK')));
    undo();
    batch(() => { grp('bA').name = '=cmd'; save(); });
    const g2 = csvText(csvDevicesSheet());
    ok('a path that starts with one gets the apostrophe', g2.includes("'=cmd / Server room / Rack 3"), g2.split('\r\n')[2]);
    ok('and reads back without it', csvParse(g2).rows.some((r) => r.includes('=cmd / Server room / Rack 3')));
    undo();

    const grpSheet = csvGroupsSheet();
    // A rack's size is four columns since Round 2, item 4: its depth in mm
    // (blank when none was given) and its numbering, "bottom" by default.
    ok('groups.csv: every group field, in tree order, a rack\'s size only on a rack', grpSheet.headers.join() === 'group_id,name,kind,parent,u_height,width,depth_mm,numbering'
       && grpSheet.rows.map((r) => r[0]).join() === 'bA,f1,office,srvroom,rk' && json(grpSheet.rows[4]) === '["rk","Rack 3","rack","srvroom","42","19in","","bottom"]'
       && json(grpSheet.rows[0]) === '["bA","Building A","building","","","","",""]', json(grpSheet.rows));
    ok('it is one of the export sheets', CSV_SHEETS.some((s) => s.key === 'groups'));

    // devices.csv into a map with no groups: the groups are missing until ticked.
    const devText = csvText(csvDevicesSheet());
    const grpText = csvText(csvGroupsSheet());
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'template' });
    const sheet = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
    const dsh = sheet(devText);
    const map = csvAutoMap(dsh);
    ok('the columns map themselves', ['group', 'rackU', 'rackHeight', 'rackFace'].every((k) => map.includes(k)) && csvSheetKind(map) === 'devices');
    let cp = csvPlan(dsh, map);
    ok('without the tick, no group is made and the paths are listed', cp.newGroups.length === 0 && cp.missingGroups.length === 3
       && cp.missingGroups.includes('Building A / Server room / Rack 3') && cp.counts.add === 5, json(cp.missingGroups));
    ok('each such row says so and still applies', cp.rows.filter((r) => r.notes.some((n) => /There is no group/.test(n))).length === 4 && cp.rows.every((r) => r.status === 'add'));
    ok('its rack fields wait with it', cp.ops.filter((o) => o.create).every((o) => !hasRackFields(o.create)) && cp.ops.filter((o) => o.create).length === 5);
    cp = csvPlan(dsh, map, { createGroups: true });
    ok('ticked, each missing group is made once, parents first', cp.newGroups.map((g) => `${g.name}:${g.kind}`).join(',') === 'Building A:building,Server room:room,Rack 3:rack,Floor 1:floor,Office:room', cp.newGroups.map((g) => `${g.name}:${g.kind}`).join(','));
    const csvBefore = json(serializeDoc());
    applyCsvPlan(cp);
    const byName = (n) => state.nodes.find((x) => x.name === n);
    ok('applied: the devices are in their groups, placed in the rack', groupPathOf(byName('SW')) === 'Building A / Server room / Rack 3' && byName('SW').rackU === 12
       && byName('SW').rackHeight === 2 && byName('SW').rackFace === 'rear' && groupPathOf(byName('PC1')) === 'Building A / Floor 1 / Office' && !byName('PC2').group);
    ok('the same places as the map it came from', ['RTR', 'SW', 'SRV', 'PC1', 'PC2'].every((n) => nodePlaceText(byName(n)) === row(n.toLowerCase()).place));
    undo();
    ok('one undo step, groups and all', json(serializeDoc()) === csvBefore && state.groups.length === 0);

    // groups.csv first, then devices.csv: the kinds and heights come back too.
    const gsh = sheet(grpText);
    const gmap = csvAutoMap(gsh);
    ok('groups.csv is read as a sheet of groups', csvSheetKind(gmap) === 'groups' && gmap.join() === 'grp:id,grp:name,grp:kind,grp:parent,grp:uHeight,grp:width,grp:depthMm,grp:numbering', gmap.join());
    const gp = csvPlan(gsh, gmap);
    ok('every row a new group', gp.counts.add === 5 && gp.counts.conflict === 0, json(gp.rows.map((r) => r.why)));
    applyCsvPlan(gp);
    ok('the tree, by the sheet\'s ids', json(serializeGroups(state.groups).map((g) => g.id).sort()) === json(['bA', 'f1', 'office', 'rk', 'srvroom']) && grp('rk').parent === 'srvroom' && grp('rk').uHeight === 42);
    applyCsvPlan(csvPlan(dsh, map));
    ok('then devices.csv finds them by path: nothing is missing', state.nodes.length === 5 && byName('SW').group === 'rk' && byName('PC1').group === 'office' && state.groups.length === 5);
    const again = csvPlan(gsh, gmap);
    ok('groups.csv again changes nothing', again.counts.same === 5 && again.counts.add === 0 && again.counts.change === 0);
    const edited = csvPlan(sheet('group_id,name,kind,u_height\nrk,Rack 3A,,45\nf1,,,10\nnew1,Annex,,'), null || csvAutoMap(sheet('group_id,name,kind,u_height\nrk,Rack 3A,,45\nf1,,,10\nnew1,Annex,,')));
    ok('a row changes what it says and leaves blanks alone', edited.rows[0].status === 'change' && edited.rows[0].changes.map((c) => c.after).join() === 'Rack 3A,45'
       && edited.rows[1].notes.some((n) => /Only a rack has a height/.test(n)) && edited.rows[2].status === 'add', json(edited.rows));
    const loop = csvPlan(sheet('group_id,parent\nbA,rk'), ['grp:id', 'grp:parent']);
    ok('a parent that makes a loop is a conflict', loop.rows[0].status === 'conflict' && /inside itself/.test(loop.rows[0].why), json(loop.rows[0]));
    const lost = csvPlan(sheet('group_id,parent\nf1,Nowhere'), ['grp:id', 'grp:parent']);
    ok('a parent nobody has is a conflict', lost.rows[0].status === 'conflict' && /No group Nowhere/.test(lost.rows[0].why));
    const fwd = csvPlan(sheet('group_id,name,parent\nz2,Rack Z,z1\nz1,Room Z,bA'), csvAutoMap(sheet('group_id,name,parent\nz2,Rack Z,z1\nz1,Room Z,bA')));
    ok('a parent further down the sheet is found', fwd.counts.add === 2 && fwd.counts.conflict === 0 && fwd.ops[0].grp.create.kind === 'rack');
    const unrack = csvPlan(sheet('group_id,kind\nrk,room'), ['grp:id', 'grp:kind']);
    ok('a rack the sheet turns into a room says its devices lose their places', unrack.rows[0].notes.some((n) => /placed devices lose/.test(n)) && unrack.ops.filter((o) => o.nodeId).length === 2);
    applyCsvPlan(unrack);
    ok('and they do, in the same step', grp('rk').kind === 'room' && !hasRackFields(byName('SW')));
    undo();
    ok('undone', grp('rk').kind === 'rack' && byName('SW').rackU === 12);
    const mixed = csvPlan(sheet('group_id,ip\nrk,10.0.0.1'), ['grp:id', 'if:ip']);
    ok('a groups sheet with a device column is refused', mixed.errors.length === 1);
    // A device sheet's rack fields, in and out of a rack.
    const placeRows = csvPlan(sheet('name,group,rack_u,rack_face\nSRV,Rack 3,30,front\nPC1,,5,\nPC2,Office,,'), csvAutoMap(sheet('name,group,rack_u,rack_face\nSRV,Rack 3,30,front\nPC1,,5,\nPC2,Office,,')));
    ok('a row moving a device into a rack can place it', placeRows.rows[0].status === 'change' && placeRows.rows[0].changes.map((c) => c.field).join() === 'Group,Rack U,Rack face', json(placeRows.rows[0].changes));
    ok('rack fields on a device in no rack are left out, said', placeRows.rows[1].status === 'same' && placeRows.rows[1].notes.some((n) => /Only a device in a rack/.test(n)));
    ok('a name one group has is enough', placeRows.rows[2].status === 'change' && /Office/.test(placeRows.rows[2].changes[0].after));
    const outRack = csvPlan(sheet('name,group\nSW,Office'), ['name', 'group']);
    ok('a row moving a device out of a rack leaves its units behind', outRack.rows[0].changes.map((c) => c.field).join() === 'Group,Rack U,Rack height,Rack face');
    applyCsvPlan(outRack);
    ok('and they go', byName('SW').group === 'office' && !hasRackFields(byName('SW')));
    undo();
    const amb = csvPlan(sheet('name,group\nSRV,Nope / X\nPC2,Rack 3'), ['name', 'group']);
    ok('a missing group on an existing device: the row still applies the rest', amb.rows[0].status === 'same' && amb.rows[0].notes.length === 1 && amb.missingGroups[0] === 'Nope / X');
    const elsewhere = csvPlan(sheet('name,group,rack_u\nSW,Building B / Rack 1,4'), ['name', 'group', 'rackU']);
    ok('units in a rack nobody made wait with it: the rack the device is in keeps its place', elsewhere.rows[0].status === 'same' && elsewhere.ops.length === 0, json(elsewhere.rows[0]));
    ok('ticked, they go with the device into the new rack', (() => {
      const p = csvPlan(sheet('name,group,rack_u\nSW,Building B / Rack 1,4'), ['name', 'group', 'rackU'], { createGroups: true });
      return p.rows[0].changes.map((c) => `${c.field}:${c.after}`).join() === 'Group:Building B / Rack 1,Rack U:4';
    })());
    const twice = csvPlan(sheet('name,group\nSRV,Office\nSRV,Rack 3'), ['name', 'group']);
    ok('two rows putting a device in two groups is a conflict', twice.rows[1].status === 'conflict' && /Another row sets/.test(twice.rows[1].why));
    const fd = csvFindingsDelta(csvPlan(sheet('name,group,rack_u\nSRV,Rack 3,50'), ['name', 'group', 'rackU']));
    ok('the findings delta reads the groups (U50 in a 42U rack)', fd.length === 1 && fd[0].key === 'rack', json(fd));

    // The review's tick.
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'template' });
    openCsvDialog('import');
    el('csvText').value = 'name,group\nA1,Building Z / Rack 1\nA2,Building Z / Rack 1';
    _csv.headings = null; _csv.mode = null; csvReparse(); renderCsvDialog();
    el('csvReviewBtn').click();
    ok('the review offers the missing groups, unticked', !el('csvGroupsBox').classList.contains('hidden') && !el('csvCreateGroups').checked
       && /Building Z \/ Rack 1/.test(el('csvGroupsText').textContent));
    el('csvCreateGroups').checked = true;
    el('csvCreateGroups').dispatchEvent(new Event('change', { bubbles: true }));
    ok('ticked, the plan makes them and the box names them', _csv.plan.newGroups.length === 2 && /2 groups/.test(el('csvGroupsText').textContent), el('csvGroupsText').textContent);
    el('csvApplyBtn').click();
    ok('Apply makes them, once', state.groups.length === 2 && state.nodes.every((n) => groupPathOf(n) === 'Building Z / Rack 1') && grp(state.nodes[0].group).kind === 'rack');
    openCsvDialog('import');
    el('csvText').value = 'name,group\nA3,Building Z / Rack 2';
    csvReparse(); renderCsvDialog();
    el('csvReviewBtn').click();
    ok('the tick is asked afresh each review', !el('csvCreateGroups').checked && !_csv.plan.createGroups);
    closeCsvDialog();
    _csv.step = 'map';

    // ---- 8: the report ----
    replaceDocument(site(), { origin: 'template' });
    const model = reportModel();
    const inv = devicesSection(model.devices, model.groups);
    ok('with groups, the inventory is laid out under them', (inv.match(/<tr class="grp">/g) || []).length === 4
       && inv.indexOf('Building A / Floor 1 / Office') < inv.indexOf('Building A / Server room</b>') && inv.indexOf('Not in a group') > inv.indexOf('Rack 3'), inv.slice(0, 400));
    ok('a heading says the kind and the count', /Building A \/ Server room \/ Rack 3<\/b> <span class="muted">· Rack 42U · 2 devices/.test(inv));
    ok('a device under its group says only its units', /U12–U13 rear/.test(inv) && !/Serial number[^<]*Building A/.test(inv) && /Reception/.test(inv));
    const html = reportHtml(model, null);
    ok('the report prints it so', html.includes('<tr class="grp">'));
    replaceDocument({ v: DOC_VERSION, nodes: [N('x', 'pc', { location: 'Hall' })], links: [] }, { origin: 'template' });
    const plainInv = devicesSection(reportDevices(), reportGroups());
    ok('without groups, as before: no headings, the free text', !plainInv.includes('class="grp"') && plainInv.includes('Hall'));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
