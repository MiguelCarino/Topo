// Hosts (Review-Packs/Topo-groups.md, "Round 3", item 2; js/model.js "Hosts"):
// a VM or a container names the device it runs on (node.host). What is held:
//   1. the schema: the host is read and written only on a virtual device,
//      under runs_on in a sheet, and nothing else rides along (the allowlist);
//   2. the normalizer (repairHosts): a host that is missing, the device
//      itself, a cloud, a VM under a VM or anything under a container is
//      dropped; a container in a VM is kept, one level; a hand-made loop
//      comes out as a chain; a virtual device keeps no rack units; a guest's
//      group is its outermost host's;
//   3. the document: v10, the v9 -> v10 step, round trips through the
//      serializer, a reload, a back-up file, a share link and undo;
//   4. the save hook: a host moved into a room takes its VMs, a deleted host
//      leaves them on nothing, a guest retyped stops being one; an inserted
//      block's guests are renamed onto the block's own host;
//   5. the findings: a guest on a retired host; a guest in another group
//      than its host (a scratch copy that skipped the repair);
//   6. the device editor: Runs on (suggested hosts first), what runs here,
//      the Group picker following the host, no rack row on a VM;
//   7. the table's Runs on column, host: and has:host / has:guests, the
//      bulk panel's Move to host (and Move to group leaving guests to their
//      hosts), the report's inventory with guests under their host;
//   8. the spreadsheet: runs_on out and back, by name or id, and what an
//      import refuses; the rack view refusing a VM units of its own.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const answers = [];
  const heldResponder = setDialogResponder((req) => (answers.length ? answers.shift()(req) : (req.kind === 'confirm' ? false : null)));
  const json = (v) => JSON.stringify(v);
  const node = (id) => getNode(id);
  const fire = (e, type) => e.dispatchEvent(new Event(type, { bubbles: true }));

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', ports: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  // A hypervisor in a rack with two VMs (one running a container), a NAS
  // with a container, a VM nobody placed, and an office PC.
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('hv', 'server', { x: 0, y: 0, name: 'HV-1', group: 'rk', rackU: 10, rackHeight: 2 }),
      N('web', 'vm', { x: 100, y: 100, name: 'Web', host: 'hv', group: 'rk' }),
      N('db', 'vm', { x: 200, y: 100, name: 'DB', host: 'hv', group: 'rk' }),
      N('app', 'container', { x: 100, y: 200, name: 'App', host: 'web', group: 'rk' }),
      N('nas', 'server', { x: 300, y: 0, name: 'NAS', group: 'room' }),
      N('ct', 'container', { x: 300, y: 100, name: 'Backup', host: 'nas', group: 'room' }),
      N('lone', 'vm', { x: 400, y: 100, name: 'Lone' }),
      N('pc', 'pc', { x: 500, y: 0, name: 'PC' })
    ],
    links: [{ id: 'l1', source: 'hv', target: 'web', sourceIface: 'i1', targetIface: 'i1', attachment: 'bridged' }],
    groups: [
      { id: 'room', name: 'Server room', kind: 'room' },
      { id: 'rk', name: 'Rack 1', kind: 'rack', parent: 'room', uHeight: 42, width: '19in' },
      { id: 'office', name: 'Office', kind: 'room' }
    ] });

  try {
    // ---- 1: the schema ----
    const f = NODE_FIELDS.find((x) => x.key === 'host');
    ok('the host is a node field, last, under runs_on', !!f && NODE_FIELDS[NODE_FIELDS.length - 1] === f && f.csv === 'runs_on');
    ok('read on a VM and a container, as a trimmed id', readFields(NODE_FIELDS, N('a', 'vm', { host: ' hv ' })).host === 'hv'
       && readFields(NODE_FIELDS, N('a', 'container', { host: 'x' })).host === 'x');
    ok('not on anything else', readFields(NODE_FIELDS, N('a', 'server', { host: 'hv' })).host === undefined
       && readFields(NODE_FIELDS, N('a', 'pc', { host: 'hv' })).host === undefined);
    ok('a host that is not text is no host', readFields(NODE_FIELDS, N('a', 'vm', { host: { id: 'hv' } })).host === undefined
       && readFields(NODE_FIELDS, N('a', 'vm', { host: '   ' })).host === undefined);
    ok('written only on a virtual device', writeFields(NODE_FIELDS, { id: 'a', type: 'vm', host: 'hv' }).host === 'hv'
       && writeFields(NODE_FIELDS, { id: 'a', type: 'server', host: 'hv' }).host === undefined);
    ok('a device that runs on nothing has no host key', !('host' in JSON.parse(json(writeFields(NODE_FIELDS, N('a', 'vm'))))));

    // ---- 2: the normalizer ----
    replaceDocument({ v: DOC_VERSION, nodes: [
      N('s', 'server'), N('c', 'cloud'),
      N('v1', 'vm', { host: 's' }),                 // kept
      N('v2', 'vm', { host: 'v1' }),                // a VM in a VM: dropped
      N('v3', 'vm', { host: 'gone' }),              // missing: dropped
      N('v4', 'vm', { host: 'v4' }),                // itself: dropped
      N('v5', 'vm', { host: 'c' }),                 // a cloud: dropped
      N('k1', 'container', { host: 'v1' }),         // a container in a VM: kept
      N('k2', 'container', { host: 'k1' }),         // in a container: dropped
      N('k3', 'container', { host: 's', rackU: 3, rackFace: 'rear', group: 'nowhere' }),
      N('p', 'pc', { host: 's' })                   // not virtual: dropped
    ], links: [] }, { origin: 'template' });
    const hostIs = (id) => node(id).host;
    ok('a VM on a server is kept', hostIs('v1') === 's');
    ok('a VM on a VM, on nothing, on itself or on a cloud is dropped', ['v2', 'v3', 'v4', 'v5'].every((id) => hostIs(id) === undefined), json(['v2', 'v3', 'v4', 'v5'].map(hostIs)));
    ok('a container in a VM is kept: one level', hostIs('k1') === 'v1' && json(hostChainOf(node('k1')).map((n) => n.id)) === '["v1","s"]');
    ok('a container in a container is dropped', hostIs('k2') === undefined);
    ok('a host on a device that is not virtual is dropped', hostIs('p') === undefined);
    ok('a virtual device keeps no rack units', !hasRackFields(node('k3')));
    const loop = [N('a', 'container', { host: 'b' }), N('b', 'vm', { host: 'a' })];
    repairHosts(loop);
    ok('a hand-made loop comes out as a chain', loop[0].host === 'b' && loop[1].host === undefined);
    ok('canHost: a VM on a server, a workstation or a custom device; a container on those or a VM', canHost('vm', { type: 'server' }) && canHost('vm', { type: 'pc' })
       && canHost('vm', { type: 'custom' }) && canHost('container', { type: 'server' })
       && !canHost('vm', { type: 'vm' }) && !canHost('vm', { type: 'cloud' }) && canHost('container', { type: 'vm' }) && !canHost('container', { type: 'container' })
       && !canHost('server', { type: 'server' }));
    // Round 3 repair: network gear and the rest are not hosts. A VM let go
    // over the core switch in the rack view had run on it.
    ok('canHost: no switch, router, firewall, AP, printer, camera, phone, IoT, DICOM or cloud',
       ['switch', 'l3switch', 'router', 'firewall', 'ap', 'printer', 'camera', 'voip', 'iot', 'dicom', 'cloud', 'edge', 'vpn', 'loadbalancer']
           .every((t) => !canHost('vm', { type: t }) && !canHost('container', { type: t })));
    const onSw = [N('s', 'switch'), N('v', 'vm', { host: 's' })];
    repairHosts(onSw);
    ok('a VM recorded on a switch runs on nothing after the repair', onSw[1].host === undefined);

    replaceDocument(site(), { origin: 'template' });
    ok('a guest is in its host\'s group', node('web').group === 'rk' && node('app').group === 'rk' && node('ct').group === 'room');
    replaceDocument(Object.assign(site(), { nodes: site().nodes.map((n) => (n.id === 'db' ? Object.assign({}, n, { group: 'office' }) : n.id === 'ct' ? Object.assign({}, n, { group: undefined }) : n)) }), { origin: 'template' });
    ok('a file that says otherwise is put right: the host\'s group wins', node('db').group === 'rk' && node('ct').group === 'room');
    replaceDocument(Object.assign(site(), { nodes: site().nodes.map((n) => (n.id === 'nas' ? Object.assign({}, n, { group: undefined }) : n)) }), { origin: 'template' });
    ok('and a host in no group leaves its guest in none', node('ct').group === undefined);
    replaceDocument(site(), { origin: 'template' });
    ok('a guest is where its host is in the rack', rackSpanText(node('web')) === rackSpanText(node('hv')) && rackSpanText(node('app')) === 'U10–U11 front'
       && nodePlaceText(node('web')) === 'Server room / Rack 1 · U10–U11 front', nodePlaceText(node('web')));
    ok('and takes no units of the rack: no overlap with its host', rackOverlaps(groupById('rk')).length === 0
       && !topologyFindings().some((f) => f.key === 'rack'), json(topologyFindings().filter((f) => f.key === 'rack').map((f) => f.line)));
    ok('guestsOf and hostRootOf', json(guestsOf(node('hv')).map((n) => n.id)) === '["web","db"]' && hostRootOf(node('app')) === node('hv') && hostRootOf(node('pc')) === null);
    ok('a VM\'s candidates: servers first, then other devices, never a VM or a cloud', json(hostCandidates(node('lone')).map((n) => n.id)) === '["hv","nas","pc"]');
    ok('a container\'s: servers and VMs first', json(hostCandidates(node('ct')).map((n) => n.id)) === '["db","hv","lone","nas","web","pc"]', json(hostCandidates(node('ct')).map((n) => n.id)));

    // ---- 3: the document ----
    ok('the document is v10', DOC_VERSION === 10 && serializeDoc().v === 10);
    const m = migrateDoc({ v: 9, nodes: [N('s', 'server'), N('v', 'vm', { host: 's' })], links: [] });
    ok('a v9 document is brought to v10, nothing converted', m.doc.v === 10 && m.from === 9 && !m.newer && m.doc.nodes[1].host === 's');
    const m9 = migrateDoc({ v: 9, nodes: [N('v', 'vm', { group: 'r', rackU: 4 })], links: [], groups: [{ id: 'r', kind: 'rack' }] });
    replaceDocument(m9.doc, { origin: 'template' });
    ok('a v9 VM with rack units opens without them, still in its rack', node('v').group === 'r' && !hasRackFields(node('v')));
    replaceDocument({ v: 10 + 1, nodes: [N('s', 'server'), N('v', 'vm', { host: 's' })], links: [] }, { origin: 'file' });
    ok('a v11 document opens read-only', !!state.readOnly);

    replaceDocument(site(), { origin: 'file', claim: true });
    initHistory();
    const doc = serializeDoc();
    ok('the host is written on the guest, by id', doc.nodes.find((n) => n.id === 'app').host === 'web' && !('host' in JSON.parse(json(doc.nodes.find((n) => n.id === 'hv')))));
    const again = (() => { loadDocState(JSON.parse(json(doc))); return serializeDoc(); })();
    ok('serialize -> load -> serialize is the same bytes', json(again) === json(doc));
    batch(() => { node('lone').host = 'nas'; save(); });
    flushPendingSaves();
    const before = json(serializeDoc());
    const entry = window.history.state && window.history.state.topoDoc;
    ok('the history entry carries it', !!entry && JSON.parse(entry).nodes.find((n) => n.id === 'lone').host === 'nas');
    state.nodes = []; state.links = []; state.groups = [];
    await load();
    ok('a reload gives it back', json(serializeDoc()) === before && node('lone').host === 'nas' && node('lone').group === 'room');
    const file = JSON.parse(json(Object.assign({ kind: 'nettopology', version: 1 }, { doc: stripIdentity(serializeDoc()) })));
    replaceDocument(templatesData.house, { origin: 'template' });
    answers.push(() => true);
    const took = await applyImportedDoc(file, { fileName: 'hosts.nettopo.json' });
    ok('a back-up file opens with every host', took && json(serializeDoc().nodes) === json(JSON.parse(before).nodes));
    const frag = await encodeShareFragment(json(serializeDoc()));
    const decoded = await decodeFragment(frag);
    replaceDocument(templatesData.house, { origin: 'template' });
    openArrivedDocument(decoded);
    ok('a share link carries it, and opening it gives it back', json(serializeDoc().nodes) === json(JSON.parse(before).nodes) && node('app').host === 'web');
    const hand = JSON.parse(before);
    hand.nodes.find((n) => n.id === 'web').hostSecret = 'x';
    hand.nodes.find((n) => n.id === 'web').host = 'hv';
    replaceDocument(hand, { origin: 'template' });
    ok('nothing beside it rides along (the allowlist)', !json(serializeDoc()).includes('hostSecret'));

    // ---- 4: the save hook, and undo ----
    replaceDocument(site(), { origin: 'file', claim: true });
    initHistory();
    const s0 = json(serializeDoc());
    setNodeGroup(node('hv'), 'office');
    ok('a host moved into a room takes its VMs, and the container on them', ['hv', 'web', 'db', 'app'].every((id) => node(id).group === 'office'), json(['hv', 'web', 'db', 'app'].map((id) => node(id).group)));
    ok('the host leaves the rack\'s units behind; its guests had none', !hasRackFields(node('hv')) && !hasRackFields(node('web')));
    undo();
    ok('one undo puts the host and its guests back', json(serializeDoc()) === s0);
    selectEntries([{ type: 'node', id: 'hv' }]);
    deleteSelected();
    // Where they were: in the rack the host was in (with no units, which a
    // VM never has), and the container still on its VM.
    ok('a deleted host leaves its VMs on nothing, where they were', node('web').host === undefined && node('db').host === undefined && node('web').group === 'rk'
       && node('app').host === 'web' && node('app').group === 'rk', json([node('web').group, node('app').group]));
    undo();
    ok('and undo brings the host and its guests back', json(serializeDoc()) === s0);
    batch(() => { node('db').type = 'server'; save(); });
    ok('a guest retyped to a server stops being a guest', node('db').host === undefined && node('db').group === 'rk');
    undo();
    batch(() => { node('nas').type = 'cloud'; save(); });
    ok('a host retyped to a cloud loses its guest', node('ct').host === undefined);
    undo();
    ok('undone', node('ct').host === 'nas');

    // A block: the copies run on the copy of their host, or on nothing.
    selectEntries([{ type: 'node', id: 'hv' }, { type: 'node', id: 'web' }, { type: 'node', id: 'ct' }]);
    const block = blockFromSelection();
    ok('a block keeps the host ids it was saved with', block.nodes.find((n) => n.id === 'web').host === 'hv');
    const done = insertBlock({ name: 'b', doc: block });
    const copies = done.nodeIds.map((id) => node(id));
    const cHv = copies.find((n) => n.name === 'HV-1'), cWeb = copies.find((n) => n.name === 'Web'), cCt = copies.find((n) => n.name === 'Backup');
    ok('inserted, a copy runs on the copy of its host, not the original', cWeb.host === cHv.id && cWeb.host !== 'hv');
    ok('and one whose host was left behind runs on nothing', cCt.host === undefined);
    undo();
    select(null);

    // ---- 5: the findings ----
    replaceDocument(site(), { origin: 'template' });
    ok('the site as drawn raises no host finding', !topologyFindings().some((f) => f.key === 'host'));
    batch(() => { node('nas').status = 'retired'; save(); });
    let hf = topologyFindings().filter((f) => f.key === 'host');
    ok('a guest on a retired host is an advisory on both', hf.length === 1 && hf[0].level === 'warn' && json(hf[0].nodeIds) === '["ct","nas"]'
       && /Backup runs on NAS, which is retired/.test(hf[0].line), json(hf.map((f) => f.line)));
    batch(() => { node('ct').status = 'retired'; save(); });
    ok('a retired guest on it is not', !topologyFindings().some((f) => f.key === 'host'));
    const scratch = diagnoseDoc({ nodes: [N('s', 'server', { group: 'a' }), N('v', 'vm', { host: 's', group: 'b' })], links: [],
      groups: [{ id: 'a', name: 'Room A', kind: 'room' }, { id: 'b', name: 'Room B', kind: 'room' }] });
    hf = scratch.findings.filter((f) => f.key === 'host');
    ok('a guest in another group than its host is one, on a scratch copy', hf.length === 1 && /V runs on S, but it is in Room B and S is in Room A/.test(hf[0].line), json(hf.map((f) => f.line)));
    setLocale('es');
    batch(() => { node('ct').status = 'active'; save(); });
    hf = topologyFindings().filter((f) => f.key === 'host');
    ok('worded in the page\'s language', hf.length === 1 && /Backup se ejecuta en NAS, que está retirado/.test(hf[0].line), hf[0] && hf[0].line);
    setLocale('en');

    // ---- 6: the device editor ----
    replaceDocument(site(), { origin: 'template' });
    showConfigTab('config');
    select('web', 'node');
    ok('a VM has Runs on, with its host picked', !el('hostRow').classList.contains('hidden') && el('propHost').value === 'hv');
    const groupsOf = [...el('propHost').querySelectorAll('optgroup')].map((g) => g.label);
    ok('servers first, then the other devices', json(groupsOf) === '["Suggested","Other devices"]'
       && el('propHost').querySelector('optgroup').querySelectorAll('option').length === 2, json(groupsOf));
    ok('its Group picker follows the host, greyed, and says why', el('propGroup').disabled && /Where HV-1 is: it runs on it/.test(el('groupPathNote').textContent));
    ok('and it has no rack row: it takes no units', el('rackPlaceRow').classList.contains('hidden'));
    const sE = json(serializeDoc());
    el('propHost').value = 'nas';
    fire(el('propHost'), 'change');
    ok('picking another host moves it there, into the host\'s room', node('web').host === 'nas' && node('web').group === 'room' && node('app').group === 'room');
    undo();
    ok('in one undo step', json(serializeDoc()) === sE);
    el('propHost').value = '';
    fire(el('propHost'), 'change');
    ok('none: it runs on nothing, staying where it was, and its Group picker is its own again', node('web').host === undefined && node('web').group === 'rk' && !el('propGroup').disabled);
    undo();
    select('hv', 'node');
    ok('a host lists what runs on it, a VM\'s container under the VM', el('hostRow').classList.contains('hidden') && !el('guestRow').classList.contains('hidden')
       && el('guestHead').textContent === 'Runs here: 2 devices'
       && json([...el('guestList').querySelectorAll('[data-guest]')].map((b) => b.dataset.guest)) === '["web","app","db"]'
       && el('guestList').querySelectorAll('.host-guest-in').length === 1);
    el('guestList').querySelector('[data-guest="db"]').click();
    ok('a guest in the list selects it', state.selectedType === 'node' && state.selectedId === 'db');
    select('pc', 'node');
    ok('a device that runs nothing and is not virtual shows neither', el('hostRow').classList.contains('hidden') && el('guestRow').classList.contains('hidden'));
    ok('both rows are the full editor\'s', !!el('hostRow').closest('[data-adv]') && !!el('guestRow').closest('[data-adv]'));
    select(null);

    // ---- 7: the table, the query, the bulk panel, the report ----
    setView('table');
    showTableTab('devices');
    const cell = (key, col) => el('tvGrid').querySelector(`tr[data-row="${key}"] td[data-col="${col}"]`);
    const drow = (id) => _tv.rows.find((r) => r.key === `n:${id}`);
    const hcol = TV_COLS.devices.find((c) => c.key === 'host');
    ok('the Devices tab has Runs on, after Group', TV_COLS.devices.findIndex((c) => c.key === 'host') === TV_COLS.devices.findIndex((c) => c.key === 'group') + 1);
    ok('it shows the host\'s name, and a dash on what is not virtual', cell('n:app', 'host').textContent === 'Web' && cell('n:lone', 'host').textContent === '' && cell('n:pc', 'host').textContent === '—');
    ok('only a VM\'s or a container\'s cell is editable', canEdit(drow('lone'), hcol) && !canEdit(drow('pc'), hcol));
    ok('a guest\'s Group cell is not: it is its host\'s', !canEdit(drow('web'), TV_COLS.devices.find((c) => c.key === 'group')) && canEdit(drow('pc'), TV_COLS.devices.find((c) => c.key === 'group')));
    ok('typed: a name, an id, blank; a VM, a cloud or nonsense refused', hcol.parse('nas', drow('lone')).value === 'nas' && hcol.parse('HV-1', drow('lone')).value === 'hv'
       && hcol.parse('', drow('lone')).value === '' && hcol.parse('Web', drow('lone')).error && hcol.parse('Nowhere', drow('lone')).error && hcol.parse('Lone', drow('lone')).error);
    ok('a container may take a VM', hcol.parse('Lone', drow('ct')).value === 'lone');
    commitValue(drow('lone'), hcol, 'hv');
    ok('picked: it runs there, and is in the rack with it', node('lone').host === 'hv' && node('lone').group === 'rk' && cell('n:lone', 'host').textContent === 'HV-1');
    undo();
    ok('one undo step', node('lone').host === undefined && node('lone').group === undefined);
    const pp = planPaste('host', 'NAS\nPC\nHV-1', { rows: ['lone', 'pc', 'ct'].map(drow), mode: 'selected' });
    ok('a pasted column: a change, a device that runs nothing, another change', pp.cells.map((c) => c.status).join(',') === 'change,skip,change', pp.cells.map((c) => c.status).join(','));
    ok('its findings delta sees the host rule', json(pasteFindingsDelta(pp)) === '[]', json(pasteFindingsDelta(pp)));
    applyPastePlan(pp);
    ok('applied as one step', node('lone').host === 'nas' && node('ct').host === 'hv' && node('ct').group === 'rk');
    undo();
    setView('map');

    const ids = (list) => list.map((n) => n.id).sort().join(',');
    const matches = (q) => ids(state.nodes.filter((n) => queryMatch(parseQuery(q), 'node', n)));
    ok('host: finds what runs on it, and on its VMs', matches('host:hv-1') === 'app,db,web' && matches('host:web') === 'app' && matches('host:nas') === 'ct');
    ok('by its id too', matches('host:hv') === 'app,db,web');
    ok('has:host and has:guests', matches('has:host') === 'app,ct,db,web' && matches('has:guests') === 'hv,nas,web');
    ok('the host id is no plain text: "hv" finds HV-1 by its name, not its VMs', matches('hv') === 'hv');
    ok('host: is understood; a -host: leaves them out', parseQuery('host:x').errors.length === 0 && matches('-host:hv type:vm') === 'lone');

    let bp = bulkPlanHost(['lone', 'ct', 'pc', 'web', 'nas'], 'hv');
    ok('Move to host: each in name order, with what stops one', bp.rows.map((r) => `${r.name}:${r.status}`).join(',') === 'Backup:change,Lone:change,NAS:skip,PC:skip,Web:same', bp.rows.map((r) => `${r.name}:${r.status}`).join(','));
    ok('the preview says the room they go into', bp.notes.some((n) => /2 of them move to Server room \/ Rack 1, where HV-1 is/.test(n)), json(bp.notes));
    bp = bulkPlanHost(['web', 'app'], 'db');
    ok('a VM on a VM is refused on its row; a container on a VM is not', bp.rows.find((r) => r.nodeId === 'web').status === 'bad' && bp.rows.find((r) => r.nodeId === 'app').status === 'change');
    bp = bulkPlanHost(['web', 'ct'], BULK_NO_HOST);
    ok('on no device', bp.counts.change === 2 && json(bp.ops.map((o) => o.drop)) === '[["host"],["host"]]');
    ok('a host that is not one is an error', bulkPlanHost(['web'], 'nope').errors.length === 1);
    const gp = bulkPlanGroup(['web', 'hv'], 'office');
    ok('Move to group leaves a guest to its host, and says what goes with the host', gp.rows.find((r) => r.nodeId === 'web').status === 'skip'
       && gp.notes.some((n) => /3 VMs and containers run on them and go with them/.test(n)), json(gp.notes));
    const sB = json(serializeDoc());
    selectEntries([{ type: 'node', id: 'lone' }, { type: 'node', id: 'ct' }]);
    ok('the panel has a Host tab', !!el('bulkTabs').querySelector('[data-bulk="host"]'));
    el('bulkTabs').querySelector('[data-bulk="host"]').click();
    ok('its pane lists the hosts and on no device, nothing picked', !el('bulkPane-host').classList.contains('hidden') && el('bulkHost').value === ''
       && !!el('bulkHost').querySelector('option[value="hv"]') && !!el('bulkHost').querySelector(`option[value="${BULK_NO_HOST}"]`) && el('bulkPreviewBtn').disabled);
    el('bulkHost').value = 'hv';
    fire(el('bulkHost'), 'change');
    el('bulkPreviewBtn').click();
    ok('the preview names the host', el('bulkTitle').textContent === 'Run on HV-1' && el('bulkPreview').querySelectorAll('tr').length === 2);
    el('bulkApplyBtn').click();
    ok('Apply puts them on it, in its rack', node('lone').host === 'hv' && node('ct').host === 'hv' && node('ct').group === 'rk');
    undo();
    ok('in one undo step', json(serializeDoc()) === sB);
    select(null);

    const model = reportModel();
    const inv = devicesSection(model.devices, model.groups);
    const at = (name) => inv.indexOf(`<b>${name}</b>`);
    ok('the inventory lists guests under their host, a container under its VM', at('HV-1') < at('Web') && at('Web') < at('App') && at('App') < at('DB') && at('NAS') < at('Backup'), inv.slice(0, 300));
    ok('stepped in, saying what each runs on', (inv.match(/class="dev guest"/g) || []).length === 4 && /Runs on HV-1/.test(inv) && /--guest:2/.test(inv));
    ok('the report prints it so', reportHtml(model, null).includes('Runs on Web'));

    // ---- 8: the spreadsheet, and the rack view ----
    replaceDocument(site(), { origin: 'template' });
    const dev = csvDevicesSheet();
    const colOf = (h) => dev.headers.indexOf(h);
    const cellOf = (id, h) => dev.rows.find((r) => r[0] === id)[colOf(h)];
    ok('devices.csv has runs_on after the rack columns', colOf('runs_on') === colOf('rack_depth') + 1);
    ok('the host by its name; blank on the rest', cellOf('web', 'runs_on') === 'HV-1' && cellOf('app', 'runs_on') === 'Web' && cellOf('hv', 'runs_on') === '' && cellOf('lone', 'runs_on') === '');
    batch(() => { node('pc').name = 'NAS'; save(); });
    ok('by its id when another device has the name', csvDevicesSheet().rows.find((r) => r[0] === 'ct')[colOf('runs_on')] === 'nas');
    undo();
    const devText = csvText(csvDevicesSheet());
    const sheet = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [], groups: site().groups }, { origin: 'template' });
    const dsh = sheet(devText);
    const map = csvAutoMap(dsh);
    ok('the column maps itself', map[colOf('runs_on')] === 'host', map[colOf('runs_on')]);
    const cp = csvPlan(dsh, map);
    ok('into an empty map, each guest finds its host among the new rows', cp.counts.add === 8 && cp.counts.conflict === 0
       && cp.ops.filter((o) => o.create && o.create.host).length === 4, json(cp.rows.map((r) => r.why || r.notes.join(' '))));
    applyCsvPlan(cp);
    ok('applied: the same hosts and places as the map it came from', ['web', 'db', 'app', 'ct'].every((id) => node(id).host === site().nodes.find((n) => n.id === id).host)
       && node('app').group === 'rk' && node('ct').group === 'room', json(state.nodes.map((n) => [n.id, n.host, n.group])));
    const hSheet = sheet('name,type,runs_on\nLone,vm,NAS\nPC,pc,HV-1\nDB,vm,Web\nWeb,vm,Web\nApp,container,Nowhere\nBackup,container,DB');
    const hp = csvPlan(hSheet, csvAutoMap(hSheet));
    const rowOf = (name) => hp.rows.find((r) => r.name === name);
    ok('a host found by name changes an existing guest', rowOf('Lone').status === 'change' && rowOf('Lone').changes.some((c) => c.field === 'Runs on' && c.after === 'NAS'));
    ok('a device that is not virtual: said, left out', rowOf('PC').notes.some((n) => /Only a VM or a container runs on another device/.test(n)));
    ok('a VM on a VM, a device on itself, a host nobody has: said, left out', rowOf('DB').notes.some((n) => /DB is a VM/.test(n))
       && rowOf('Web').notes.some((n) => /cannot run on itself/.test(n)) && rowOf('App').notes.some((n) => /No device called Nowhere/.test(n)), json(hp.rows.map((r) => r.notes)));
    ok('a container may run on a VM', rowOf('Backup').changes.some((c) => c.after === 'DB'));
    const cBefore = json(serializeDoc());
    applyCsvPlan(hp);
    ok('applied: on their hosts, in the hosts\' places', node('lone').host === 'nas' && node('lone').group === 'room' && node('ct').host === 'db' && node('ct').group === 'rk' && node('db').host === 'hv');
    undo();
    ok('in one undo step', json(serializeDoc()) === cBefore);

    const n0 = state.nodes.length;
    ok('the rack view gives a VM no units of its own', placeInRack('rk', { u: 20, height: 1, face: 'front' }, { nodeId: 'lone' }) === null && !hasRackFields(node('lone'))
       && placeInRack('rk', { u: 20, height: 1, face: 'front' }, { type: 'container' }) === null && state.nodes.length === n0);

    setLocale('es'); applyStaticI18n();
    ok('the words are translated', t('Runs on') === 'Se ejecuta en' && el('bulkTabs').querySelector('[data-bulk="host"]').textContent === 'Host'
       && t('Runs on {host}', { host: 'X' }) === 'Se ejecuta en X');
    setLocale('en'); applyStaticI18n();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
