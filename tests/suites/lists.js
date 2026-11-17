// Address lists and who may reach whom (js/model.js "Address lists",
// js/lists.js, js/tracetarget.js; docs/SCOPE.md step 9h, D444):
//   1. the format: a list keeps its name, members (addresses and subnets,
//      anything else dropped, none twice) and rules; a rule naming a list
//      that is not there, or the list itself, is dropped; a list with no
//      name is dropped; saved, read back and saved again is the same text; a
//      network with none writes no key; the schema lists the key;
//   2. membership: a device is in a list by an address or by a subnet that
//      holds one of its addresses, IPv6 too; a device with no address is in
//      none;
//   3. "Does A reach B?": a blocked pair is not reached and the reason names
//      the two lists; the other way round is untouched; an allowed list is
//      an exception; with no lists the answer is as before;
//   4. the dialog: from Export, Add a list, a name, addresses typed with
//      commas or lines (what is not an address is left out and said), the
//      count of devices on the map, May not reach ticked, Delete (which
//      takes the rules that named it), each one undo step; read-only shows
//      and does not edit;
//   5. compare and merge know the lists (a change is counted and named; the
//      merge matches by name and keeps a rule's ids pointing right);
//   6. the report prints the table under Addressing, and nothing when there
//      are no lists;
//   7. the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const show = (v) => JSON.stringify(v);
  const N = (id, type, cidr, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false, ports: '80',
    interfaces: [{ id: 'i1', name: 'eth0', ip: cidr || '' }] }, extra);
  const site = (lists) => ({ v: DOC_VERSION,
    nodes: [N('sw', 'switch', '', { portCount: 8, interfaces: [], x: 300, y: 0 }), N('pc', 'pc', '10.0.10.5/24', { x: 100, y: 150 }), N('pc2', 'pc', '10.0.10.6/24', { x: 200, y: 150 }),
      N('cam', 'camera', '10.0.10.50/24', { x: 300, y: 150 }), N('nvr', 'server', '10.0.10.60/24', { x: 400, y: 150 }), N('six', 'server', '2001:db8:1::5/64', { x: 500, y: 150 }), N('bare', 'pc', '', { x: 600, y: 150 })],
    links: [{ id: 'l1', source: 'sw', target: 'pc' }, { id: 'l2', source: 'sw', target: 'pc2' }, { id: 'l3', source: 'sw', target: 'cam' }, { id: 'l4', source: 'sw', target: 'nvr' }, { id: 'l5', source: 'sw', target: 'six' }, { id: 'l6', source: 'sw', target: 'bare' }],
    lists });
  const LISTS = () => [{ id: 'al1', name: 'Office', members: ['10.0.10.0/28'] }, { id: 'al2', name: 'Cameras', members: ['10.0.10.50', '10.0.10.60'] }, { id: 'al3', name: 'Six', members: ['2001:db8:1::/64'] }];
  const open = (doc) => { replaceDocument(doc, { origin: 'file', docId: 'doc-lists' }); autoBindLinks(); renderCanvasOnly(); };
  const type = (input, value) => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); };
  const A = () => window.TopoTraceTarget.answer;
  try {
    setLocale('en');
    // ---- 1. The format ----
    open(site([{ id: 'al1', name: ' Office ', members: ['10.0.10.0/28', '10.0.10.0/28', 'not an address', '10.0.10.999', 42, '10.0.10.7'], blocked: ['al2', 'al1', 'ghost'], allowed: ['ghost'], notes: 'VLAN 10', colour: 'red' },
      { id: 'al2', name: 'Cameras', members: ['10.0.10.50'] }, { id: 'al9', members: ['10.0.0.1'] }, 'junk', { id: 'al2', name: 'Twin' }]));
    let saved = JSON.parse(show(serializeDoc())).lists;
    ok('a list keeps its name, members and notes', saved[0].name === 'Office' && show(saved[0].members) === '["10.0.10.0/28","10.0.10.7"]' && saved[0].notes === 'VLAN 10' && !('colour' in saved[0]), show(saved[0]));
    ok('a rule naming itself or a list that is not there is dropped', show(saved[0].blocked) === '["al2"]' && !('allowed' in saved[0]));
    ok('a list with no name is dropped; a second with the same id gets its own', saved.length === 3 && saved.every((l) => l.name) && new Set(saved.map((l) => l.id)).size === 3, show(saved.map((l) => [l.id, l.name])));
    const one = show(serializeDoc());
    open(JSON.parse(one));
    ok('saved, read back and saved again is the same text', show(serializeDoc()) === one);
    open(site(undefined));
    ok('a network with none writes no key', !('lists' in JSON.parse(show(serializeDoc()))) && state.lists.length === 0);
    const schema = JSON.parse(await (await fetch(`schema/topo-v${DOC_VERSION}.json`)).text());
    ok('the schema lists the key and its fields', schema.$defs.document.properties.lists.items.$ref === '#/$defs/addressList' && LIST_FIELDS.every((f) => f.key in schema.$defs.addressList.properties)
      && schema.$defs.addressList.additionalProperties === false && schema.$defs.document.properties.lists.maxItems === LIST_MAX);

    // ---- 2. Membership ----
    open(site(LISTS()));
    const inLists = (id) => listsHolding(getNode(id)).map((l) => l.name).join();
    ok('by a subnet that holds its address', inLists('pc') === 'Office' && inLists('pc2') === 'Office');
    ok('by its own address', inLists('cam') === 'Cameras' && inLists('nvr') === 'Cameras');
    ok('IPv6 too', inLists('six') === 'Six');
    ok('a device with no address is in none', inLists('bare') === '' && inLists('sw') === '');

    // ---- 3. Does A reach B? ----
    let a = A()('pc', 'cam', '');
    ok('with no rule, as before', a.reaches === true);
    batch(() => { listById('al1').blocked = ['al2']; save(); renderCanvasOnly(); });
    a = A()('pc', 'cam', '');
    ok('a blocked pair is not reached', a.reaches === false && a.why.key === 'list' && show(a.why.listIds) === '["al1","al2"]');
    ok('…and the reason names the two lists', /The address lists say Office may not reach Cameras\./.test(a.why.text) && /PC does not reach CAM/.test(a.line), a.why.text);
    ok('the other way round is untouched', A()('cam', 'pc', '').reaches === true);
    ok('a device in neither list is untouched', A()('six', 'cam', '').reaches === A()('six', 'pc', '').reaches);
    batch(() => { state.lists.push({ id: 'al4', name: 'Admins', members: ['10.0.10.5'], allowed: ['al2'] }); state.lists = normalizeLists(state.lists); save(); renderCanvasOnly(); });
    ok('an allowed list is an exception for its own devices', A()('pc', 'cam', '').reaches === true && A()('pc2', 'cam', '').reaches === false);
    ok('listBlockBetween says the same', listBlockBetween(getNode('pc'), getNode('cam')) === null && listBlockBetween(getNode('pc2'), getNode('cam')).to.name === 'Cameras' && listBlockBetween(getNode('bare'), getNode('cam')) === null);

    // ---- 4. The dialog ----
    open(site(undefined));
    ok('Address lists is in the Export menu', !!el('listsBtn') && /Address lists…/.test(el('listsBtn').textContent));
    el('listsBtn').click(); await tick();
    const dlg = el('listsDialog');
    ok('it opens, empty', !dlg.hidden && !el('listsEmpty').classList.contains('hidden') && el('listsBody').children.length === 0);
    let undoAt = _undoStack.length;
    el('listsAddBtn').click(); await tick();
    ok('Add a list: one list, one undo step', state.lists.length === 1 && state.lists[0].name === 'List 1' && _undoStack.length === undoAt + 1 && el('listsBody').children.length === 1 && el('listsEmpty').classList.contains('hidden'));
    const cardOf = (i) => el('listsBody').children[i];
    type(cardOf(0).querySelector('.al-name'), 'Office'); await tick();
    type(cardOf(0).querySelector('.al-members'), '10.0.10.0/28, 10.0.10.7\nnonsense 999.1.1.1'); await tick();
    ok('a name and addresses typed with commas and lines are kept', state.lists[0].name === 'Office' && show(state.lists[0].members) === '["10.0.10.0/28","10.0.10.7"]');
    ok('…and what was left out is said', !el('listsStatus').classList.contains('hidden') && /2 entries were not addresses or subnets and were left out\./.test(el('listsStatus').textContent), el('listsStatus').textContent);
    ok('the devices on the map are counted', /2 devices on the map/.test(cardOf(0).querySelector('.al-count').textContent), cardOf(0).querySelector('.al-count').textContent);
    ok('one list alone has nothing to block yet', /Add a second list/.test(cardOf(0).querySelector('.al-refs').textContent));
    el('listsAddBtn').click(); await tick();
    type(cardOf(1).querySelector('.al-name'), 'Cameras'); await tick();
    type(cardOf(1).querySelector('.al-members'), '10.0.10.50'); await tick();
    undoAt = _undoStack.length;
    cardOf(0).querySelector('.al-refs[data-key="blocked"] input').click(); await tick();
    ok('May not reach ticked: the rule is kept, one undo step', show(state.lists[0].blocked) === `["${state.lists[1].id}"]` && _undoStack.length === undoAt + 1);
    ok('…and a trace obeys it at once', A()('pc', 'cam', '').reaches === false);
    type(cardOf(0).querySelector('.al-name'), '   '); await tick();
    ok('an empty name is not taken', state.lists[0].name === 'Office' && cardOf(0).querySelector('.al-name').value === 'Office');
    undoAt = _undoStack.length;
    cardOf(1).querySelector('.al-del').click(); await tick();
    ok('Delete takes the list and the rules that named it, one undo step', state.lists.length === 1 && !('blocked' in state.lists[0]) && _undoStack.length === undoAt + 1 && A()('pc', 'cam', '').reaches === true);
    undo(); await tick();
    ok('undo brings both back', state.lists.length === 2 && show(state.lists[0].blocked) === `["${state.lists[1].id}"]`);
    TopoLists.render();
    state.readOnly = { doc: {}, loaded: '' };
    TopoLists.render();
    ok('read-only: shown, nothing to edit with', el('listsBody').children.length === 2 && el('listsAddBtn').classList.contains('hidden') && el('listsBody').querySelector('.al-name').disabled && !el('listsBody').querySelector('.al-del'));
    state.readOnly = null;
    dlg.querySelector('.modal-foot [data-close]').click(); await tick();

    // ---- 5. Compare and merge ----
    const before = site(LISTS()), after = site(LISTS());
    after.lists[0].members = ['10.0.10.0/27']; after.lists.push({ id: 'al7', name: 'Guests', members: ['10.0.40.0/24'] }); after.lists.splice(1, 1);
    const ch = docChanges(before, after);
    const rows = changeRows(ch).map((r) => [r.op, r.what, r.name, r.detail].join(' ')).join(' | ');
    ok('a change to the lists is counted and named', ch.lists.added.length === 1 && ch.lists.removed.length === 1 && ch.lists.changed.length === 1 && ch.total === 3
      && /Address list Guests/.test(rows) && /Address list Cameras/.test(rows) && /Address list Office[^|]*Addresses/.test(rows), rows);
    const mine = site([{ id: 'al1', name: 'Office', members: ['10.0.10.0/28'] }]);
    const theirs = site([{ id: 'zz1', name: 'office', members: ['10.0.10.0/28'] }, { id: 'zz2', name: 'Cameras', members: ['10.0.10.50'] }, { id: 'zz3', name: 'Guests', members: ['10.0.40.0/24'], blocked: ['zz1', 'zz2'] }]);
    const plan = planMerge(mine, theirs, null);
    const merged = applyMergePlan(mine, plan, {});
    const mdoc = merged.doc || merged;
    const byName = (n) => (mdoc.lists || []).find((l) => l.name.toLowerCase() === n);
    ok('the merge matches a list by name and adds the others', (mdoc.lists || []).length === 3 && !!byName('office') && !!byName('cameras') && !!byName('guests'), show(mdoc.lists));
    ok('…and a rule\'s ids point at the merged lists', !!byName('guests') && show((byName('guests').blocked || []).slice().sort()) === show([byName('office').id, byName('cameras').id].sort()), show(byName('guests')));

    // ---- 6. The report ----
    open(site(LISTS()));
    batch(() => { listById('al1').blocked = ['al2']; listById('al3').allowed = ['al1']; save(); renderCanvasOnly(); });
    const model = reportModel();
    ok('the report model holds each list with its devices and rules', model.lists.length === 3 && show(model.lists[0].devices) === '["PC","PC2"]' && show(model.lists[0].blocked) === '["Cameras"]' && show(model.lists[2].allowed) === '["Office"]', show(model.lists));
    const html = listsSection(model.lists);
    ok('…and prints the table', /<h3 class="rep-lists">Address lists<\/h3>/.test(html) && /10\.0\.10\.0\/28/.test(html) && /May not reach/.test(html) && /not as read from a firewall/.test(html));
    ok('no lists: nothing is printed', listsSection([]) === '' && listsSection(undefined) === '');

    // ---- 7. Translations ----
    const { has, locales } = window.CarinoI18N;
    const strings = ['Address lists', 'Address lists…', 'Address list', 'No address lists yet.', '+ Add a list', 'List {n}', 'Add a second list to say what this one may not reach.', '1 device on the map', '{n} devices on the map',
      'Addresses and subnets', 'May not reach', 'May reach', '1 entry was not an address or a subnet and was left out.', '{n} entries were not addresses or subnets and were left out.',
      'The address lists say {from} may not reach {to}.', 'As recorded here, not as read from a firewall.',
      'Names for sets of addresses, as a firewall has them, and what each may not reach. Does A reach B? stops at a blocked pair. It is a record: nothing here is read from a firewall or sent to one.'];
    locales.forEach((loc) => ok(`${loc} carries the strings`, strings.every((s) => has(loc, s)), strings.filter((s) => !has(loc, s)).join(' | ')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    state.readOnly = null;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
