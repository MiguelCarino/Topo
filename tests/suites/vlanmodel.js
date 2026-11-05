// VLANs, trunks and PoE, stage 1a (docs/BACKLOG.md feature 4, landing order
// step 14): the data model only, folded into document version 16 beside the
// DHCP pool, the saved searches and the vendor and model. What is held here:
//   1. the readers: parseVlanList / vlanListText (canonical "10,20,30-39",
//      "all", a spaced range "10 - 20", 0, 4095, words and reversed ranges
//      refused whole), the PoE
//      words of a port (af/at/bt3/bt4, 802.3af, PoE+, PoE++, Type 3/4,
//      watts), a draw (watts, "class 0".."class 8") and a budget;
//   2. the format: normalizePortAttrs keeps tagged and poe canonical and
//      drops junk; portAttrOf's shape; setPortAttr's whitelist; hasPortAttrs
//      counting the new facts; a wired interface's vlan and tagged, never a
//      wireless one's; poeBudget only on a switch or an AP, poeDraw never on
//      a cloud, a VM or a container (kept in memory, out of the file); keys
//      in schema order, none when unset;
//   3. versions: a v15 file opens editable at v16 and saves byte for byte
//      but for v; the 15 to 16 step changes nothing but v; a v6 file opens
//      at the current version through the whole chain unchanged; every
//      template saves the same stamped v15 or current, with no new key; a
//      newer file opens read-only;
//   4. portVlans / endCarries: an end with nothing recorded is unknown and
//      carries every VLAN; a port's untagged and tagged; "all"; an interface
//      on its declared network's VLAN, its own vlan over it, a bond member
//      reading its bond's, a switch LAG's member ports reading the LAG's
//      when it records any, a wireless one unknown;
//   5. the facts raise only their own checks (PoE, stage 2b; VLAN, stage 2a): every template given VLAN and PoE facts on every port,
//      interface and device has the same other findings as without them;
//   6. search: vlan: matching a tagged port, its switch, the device cabled
//      into it and an interface's own or tagged VLANs, has:trunk and has:poe
//      on devices, interface rows and port rows (a LAG member by its LAG's),
//      a leading -, never a wireless interface's own VLAN;
//  6b. shown since stage 1b: a free port with only PoE or a tagged list is a
//      row of the report's port map and counted on the faceplate's list;
//   7. the changes since the last back-up naming 'Port labels, VLANs and
//      PoE', 'PoE draw (W)' and an interface's 'Tagged VLANs';
//   8. a binder's site (canonicalDoc) keeping every fact;
//   9. the words in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const open = (doc) => { replaceDocument(doc, { origin: 'file' }); initHistory(); };
  const saved = () => JSON.parse(JSON.stringify(serializeDoc()));
  const lab = () => ({ v: DOC_VERSION, links: [
      { id: 'l1', source: 'pc', target: 'sw', sourceIface: 'i1', targetIface: 'p3' },
      { id: 'l2', source: 'sw', target: 'sw2', sourceIface: 'p1', targetIface: 'p1' },
      { id: 'l3', source: 'cam', target: 'sw', sourceIface: 'i1', targetIface: 'p5' }],
    networks: [{ id: 'n10', cidr: '10.0.10.0/24', name: 'Staff', vlan: 10 }, { id: 'n20', cidr: '10.0.20.0/24', name: 'Cams', vlan: 20 }],
    nodes: [
      { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 0, portCount: 8, poeBudget: 120,
        portAttrs: { p1: { tagged: '30-39,20,10,20' }, p3: { vlan: 10 }, p5: { vlan: 20, poe: 'at' } }, interfaces: [] },
      { id: 'sw2', type: 'switch', name: 'SW-2', x: 200, y: 0, portCount: 8, portAttrs: { p1: { vlan: 1, tagged: 'all' } }, interfaces: [] },
      { id: 'pc', type: 'pc', name: 'PC-1', x: 0, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.5/24' }] },
      { id: 'cam', type: 'camera', name: 'CAM-1', x: 100, y: 100, poeDraw: 6.49, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.5/24' }] },
      { id: 'rt', type: 'router', name: 'RT', x: 0, y: -100, interfaces: [{ id: 'i1', name: 'eth0', ip: '', tagged: '10,20' },
        { id: 'i2', name: 'eth0.30', ip: '10.0.30.1/24', vlan: 30 }] },
      { id: 'lt', type: 'pc', name: 'LT', x: 0, y: 200, interfaces: [{ id: 'w1', name: 'wlan0', ip: '10.0.10.9/24', vlan: 10, tagged: '10' }] }
    ] });
  setLocale('en');

  try {
    // ---- 1. The readers ----
    ok('a tagged list is sorted, each VLAN once, three in a row a range', vlanListText(parseVlanList('30-39,10,20,20')) === '10,20,30-39'
       && vlanListText(parseVlanList('10 11;12, 14,15')) === '10-12,14,15', vlanListText(parseVlanList('10 11;12, 14,15')));
    ok('"all" is all', show(parseVlanList('All')) === '{"all":true}' && vlanListText(parseVlanList('all')) === 'all');
    ok('0, 4095, a word, a reversed range and nothing are refused whole', ['0', '4095', '10,x', '39-30', '', '  ', '10,,4095'].every((v) => parseVlanList(v) === null));
    ok('a range with spaces round its hyphen reads as one range', asVlanList('10 - 20') === '10-20' && asVlanList('1, 30 -39 ; 5') === '1,5,30-39' && parseVlanList('10 - 20').size === 11,
       show([asVlanList('10 - 20'), asVlanList('1, 30 -39 ; 5')]));
    ok('a hyphen with no number beside it is still refused', ['10 -', '- 20', '10 - - 20'].every((v) => parseVlanList(v) === null));
    ok('the whole range is held as a range', asVlanList('1-4094') === '1-4094' && parseVlanList('1-4094').size === 4094);
    ok('a hand-edited list of numbers or one number reads', asVlanList([20, 10]) === '10,20' && asVlanList(7) === '7' && asVlanList({}) === undefined);
    const poe = (v) => portPoeFromText(v);
    ok('a port\'s PoE by its words', show(['af', '802.3af', 'PoE', 'poe+', '802.3at', '802.3at (PoE+)', 'PoE++', 'Type 3', '802.3bt Type 3', 'type 4', 'BT4'].map(poe))
       === show(['af', 'af', 'af', 'at', 'at', 'at', 'bt3', 'bt3', 'bt3', 'bt4', 'bt4']), show(['af', '802.3af', 'PoE', 'poe+', '802.3at', '802.3at (PoE+)', 'PoE++', 'Type 3', '802.3bt Type 3', 'type 4', 'BT4'].map(poe)));
    ok('or watts at the switch, one decimal', poe('30 W') === 30 && poe('12,5') === 12.5 && poe('7.5w') === 7.5 && poe('0.4') === null && poe('101') === null && poe('12.25') === null && poe('class 3') === null);
    ok('POE_CLASSES hold both figures', POE_CLASSES.at.pse === 30 && POE_CLASSES.at.pd === 25.5 && POE_CLASSES.bt4.pd === 71.3 && POE_CLASSES.af.pd === 12.95);
    ok('a draw in watts or by class', poeDrawFromText('12') === 12 && poeDrawFromText('12,5 W') === 12.5 && poeDrawFromText('class 0') === 13
       && poeDrawFromText('Class 1') === 3.84 && poeDrawFromText('class 4') === 25.5 && poeDrawFromText('class 8') === 71.3 && poeDrawFromText('class 9') === null
       && poeDrawFromText('0') === null && poeDrawFromText('100.5') === null);
    ok('a budget in watts', poeBudgetFromText('370') === 370 && poeBudgetFromText('370,5 W') === 370.5 && poeBudgetFromText('0.5') === null && poeBudgetFromText('10001') === null);

    // ---- 2. The format ----
    ok('normalizePortAttrs keeps tagged and poe canonical and drops junk',
       show(normalizePortAttrs({ p1: { tagged: '20,10', poe: 'AT' }, p2: { tagged: '0', poe: 'x' }, p3: { poe: '30' }, p4: { tagged: 'all', poe: 0.2, extra: 1 } }))
       === '{"p1":{"tagged":"10,20","poe":"at"},"p3":{"poe":30},"p4":{"tagged":"all"}}',
       show(normalizePortAttrs({ p1: { tagged: '20,10', poe: 'AT' }, p2: { tagged: '0', poe: 'x' }, p3: { poe: '30' }, p4: { tagged: 'all', poe: 0.2, extra: 1 } })));
    open(lab());
    ok('the lab opens editable', !state.readOnly);
    const d = saved();
    const node = (id) => d.nodes.find((n) => n.id === id);
    ok('a switch keeps its port facts, the tagged list canonical', show(node('sw').portAttrs) === '{"p1":{"tagged":"10,20,30-39"},"p3":{"vlan":10},"p5":{"vlan":20,"poe":"at"}}', show(node('sw').portAttrs));
    const keys = Object.keys(node('sw'));
    ok('its budget is written right after the port facts', node('sw').poeBudget === 120 && keys.indexOf('poeBudget') === keys.indexOf('portAttrs') + 1, keys.join(','));
    ok('a camera keeps its draw', node('cam').poeDraw === 6.49 && !('poeBudget' in node('cam')));
    ok('a wired interface keeps its own VLAN and tagged list, after bond in schema order', show(node('rt').interfaces) === '[{"id":"i1","name":"eth0","ip":"","tagged":"10,20"},{"id":"i2","name":"eth0.30","ip":"10.0.30.1/24","vlan":30}]', show(node('rt').interfaces));
    ok('a wireless one never does', show(node('lt').interfaces) === '[{"id":"w1","name":"wlan0","ip":"10.0.10.9/24"}]', show(node('lt').interfaces));
    ok('a device that never said anything carries none of the keys', !/poeBudget|poeDraw|tagged|"poe"/.test(show(node('pc'))), show(node('pc')));
    ok('portAttrOf says all four facts', show(portAttrOf(getNode('sw'), 'p5')) === '{"label":"","vlan":20,"tagged":null,"poe":"at"}'
       && show(portAttrOf(getNode('sw'), 'p2')) === '{"label":"","vlan":null,"tagged":null,"poe":null}');
    ok('hasPortAttrs counts a tagged list or PoE alone', hasPortAttrs(getNode('sw'), 'p1') && !hasPortAttrs(getNode('sw'), 'p2'));
    ok('the stage 1a stand-in hasPortLabelOrVlan is gone (stage 1b reads hasPortAttrs)', typeof window.hasPortLabelOrVlan === 'undefined');
    setPortAttr(getNode('sw'), 'p2', 'poe', 'bt4');
    setPortAttr(getNode('sw'), 'p2', 'tagged', '40,41,42');
    setPortAttr(getNode('sw'), 'p2', 'bogus', 'x');
    ok('setPortAttr lets tagged and poe through, nothing else', show(getNode('sw').portAttrs.p2) === '{"tagged":"40-42","poe":"bt4"}', show(getNode('sw').portAttrs.p2));
    setPortAttr(getNode('sw'), 'p2', 'poe', ''); setPortAttr(getNode('sw'), 'p2', 'tagged', '');
    ok('and a blank clears it, the entry going with it', !('p2' in getNode('sw').portAttrs));
    open({ v: DOC_VERSION, links: [], nodes: [
      { id: 'a', type: 'pc', name: 'A', x: 0, y: 0, poeBudget: 50, poeDraw: 5, interfaces: [] },
      { id: 'b', type: 'vm', name: 'B', x: 0, y: 0, poeDraw: 5, interfaces: [] },
      { id: 'c', type: 'cloud', name: 'C', x: 0, y: 0, poeDraw: 5, interfaces: [] },
      { id: 'e', type: 'ap', name: 'E', x: 0, y: 0, poeBudget: '30', poeDraw: 12.95, interfaces: [] },
      { id: 'f', type: 'switch', name: 'F', x: 0, y: 0, poeBudget: -1, poeDraw: 'lots', interfaces: [] }] });
    const g = (id) => saved().nodes.find((n) => n.id === id);
    ok('a PC has no budget, a VM and a cloud no draw', !('poeBudget' in g('a')) && g('a').poeDraw === 5 && !('poeDraw' in g('b')) && !('poeDraw' in g('c')));
    ok('an AP has both, digits as text read as their number', g('e').poeBudget === 30 && g('e').poeDraw === 12.95);
    ok('a value out of range is no value', !('poeBudget' in g('f')) && !('poeDraw' in g('f')));
    open(lab());
    getNode('sw').type = 'pc';
    ok('a switch retyped to a PC in this session keeps its budget in memory, not in the file', getNode('sw').poeBudget === 120 && !('poeBudget' in saved().nodes.find((n) => n.id === 'sw')));
    getNode('rt').interfaces[1].wireless = true;
    ok('an interface made wireless keeps its VLAN in memory, not in the file', getNode('rt').interfaces[1].vlan === 30 && !('vlan' in saved().nodes.find((n) => n.id === 'rt').interfaces[1]));
    const f = (k) => NODE_FIELDS.find((x) => x.key === k);
    const fi = (k) => IFACE_FIELDS.find((x) => x.key === k);
    ok('the schema rows', f('portAttrs').label === 'Port labels, VLANs and PoE' && f('poeBudget').label === 'PoE budget (W)' && f('poeBudget').csv === 'poe_budget'
       && f('poeDraw').label === 'PoE draw (W)' && f('poeDraw').csv === 'poe_draw' && fi('vlan').csv === 'untagged_vlan' && fi('tagged').csv === 'tagged_vlans' && fi('tagged').label === 'Tagged VLANs');
    ok('a Change all row and a table column each (stage 1b)', f('poeBudget').bulk && f('poeDraw').bulk && f('poeBudget').table === 'edit' && f('poeDraw').table === 'edit'
       && bulkFields().filter((b) => /^poe/.test(b.key)).map((b) => b.key).join() === 'poeBudget,poeDraw');

    // ---- 3. Versions ----
    ok('the document is version 16 or later', DOC_VERSION >= 16);
    const v15 = { v: 15, links: [], nodes: [{ id: 's', type: 'switch', name: 'S', x: 0, y: 0, gw: '', dns: '', os: '', ports: '', notes: '', nat: false, portCount: 24,
      portAttrs: { p3: { label: 'Desk 3', vlan: 30 } }, interfaces: [{ id: 'i1', name: 'vlan1', ip: '10.0.0.2/24' }] }] };
    open(cloneData(v15));
    ok('a v15 file with an access VLAN opens editable', !state.readOnly);
    ok('and saves byte for byte but for v', show(saved().nodes) === show(v15.nodes) && saved().v === DOC_VERSION, show(saved().nodes));
    ok('the 15 to 16 step changes nothing but v', show({ ...migrateDoc(cloneData(v15)).doc, v: 15 }) === show(v15));
    const v6 = { v: 6, links: [], nodes: [{ id: 's', type: 'switch', name: 'S', x: 0, y: 0, gw: '', dns: '', os: '', ports: '', notes: '', nat: false, portCount: 8,
      portAttrs: { p1: { label: 'Up', vlan: 1 } }, interfaces: [] }] };
    const chained = migrateDoc(cloneData(v6));
    ok('a v6 file opens at the current version through the whole chain, its ports unchanged', chained.doc.v === DOC_VERSION && !chained.newer
       && show(chained.doc.nodes) === show(v6.nodes), show(chained.doc.nodes));
    const odd = [];
    Object.keys(templatesData).forEach((k) => {
      const nodesAt = (v) => { replaceDocument({ ...cloneData(templatesData[k]), v }, { origin: 'file' }); return saved().nodes; };
      const a = nodesAt(15), b = nodesAt(DOC_VERSION);
      // The Full Showcase records PoE since stage 2b (two budgeted switches,
      // three powered devices) and one clean trunk since stage 2a (the
      // Studio's uplink); no other template records a tagged VLAN or PoE.
      const keys = k === 'showcase' ? null : /"(?:poeBudget|poeDraw|tagged|poe)"/;
      if (show(a) !== show(b) || (keys && keys.test(show(a)))) odd.push(k);
    });
    ok('every template saves the same stamped v15 or current, and writes no VLAN or PoE key (the Showcase only, PoE and one trunk)', !odd.length, odd.join(', '));
    replaceDocument(cloneData(templatesData.showcase), { origin: 'template' });
    ok('the Showcase\'s one trunk: the Studio uplink, tagged 20 at both ends', saved().nodes.filter((n) => /"tagged"/.test(show(n))).map((n) => n.id).sort().join(',') === 'l3,ssw');
    replaceDocument({ v: DOC_VERSION + 1, links: [], nodes: [{ id: 's', type: 'switch', name: 'S', x: 0, y: 0, portAttrs: { p1: { tagged: '10', poe: 'bt3' } }, interfaces: [] }] }, { origin: 'file' });
    ok('a newer file opens read-only', !!state.readOnly);

    // ---- 4. portVlans / endCarries ----
    open(lab());
    const pv = (id, port) => { const r = portVlans(getNode(id), port); return [r.untagged, r.tagged instanceof Set ? vlanListText(r.tagged) : r.tagged, r.known]; };
    ok('a port with nothing recorded is unknown', show(pv('sw', 'p2')) === '[null,null,false]' && endCarries(getNode('sw'), 'p2', 99));
    ok('an access port carries its VLAN only', show(pv('sw', 'p3')) === '[10,null,true]' && endCarries(getNode('sw'), 'p3', 10) && !endCarries(getNode('sw'), 'p3', 20));
    ok('a trunk carries its tagged list', show(pv('sw', 'p1')) === '[null,"10,20,30-39",true]' && endCarries(getNode('sw'), 'p1', 35) && !endCarries(getNode('sw'), 'p1', 40));
    ok('"all" carries every VLAN, beside its native one', show(pv('sw2', 'p1')) === '[1,"all",true]' && endCarries(getNode('sw2'), 'p1', 4000));
    ok('an interface is on its declared network\'s VLAN', show(pv('pc', 'i1')) === '[10,null,true]' && !endCarries(getNode('pc'), 'i1', 20));
    ok('its own VLAN over it, and its tagged list', show(pv('rt', 'i2')) === '[30,null,true]' && show(pv('rt', 'i1')) === '[null,"10,20",true]');
    ok('a wireless interface is unknown', show(pv('lt', 'w1')) === '[null,null,false]');
    replaceDocument({ v: DOC_VERSION, links: [], networks: [],
      nodes: [{ id: 'nas', type: 'server', name: 'NAS', x: 0, y: 0, interfaces: [{ id: 'e1', name: 'eth0', ip: '' }, { id: 'e2', name: 'eth1', ip: '' },
        { id: 'b0', name: 'bond0', ip: '', vlan: 40, tagged: '50', bond: { mode: '802.3ad', members: ['e1', 'e2'] } }] }] }, { origin: 'file' });
    ok('a bond member reads its bond\'s', show(pv('nas', 'e1')) === '[40,"50",true]' && endCarries(getNode('nas'), 'e2', 50) && !endCarries(getNode('nas'), 'e2', 60));
    // A switch's LAG: its members are the pN ports.
    const lag = () => ({ v: DOC_VERSION, links: [], networks: [],
      nodes: [{ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8, portAttrs: { p4: { label: 'Up A', vlan: 5 }, p6: { tagged: '70' } },
        interfaces: [{ id: 'b_lag', name: 'lag1', ip: '', tagged: '10,20', bond: { mode: '802.3ad', members: ['p4', 'p5'] } },
          { id: 'b_two', name: 'lag2', ip: '', bond: { mode: '802.3ad', members: ['p6', 'p7'] } }] }] });
    replaceDocument(lag(), { origin: 'file' });
    ok('a switch LAG member port reads its LAG\'s tagged list', show(pv('sw', 'p5')) === '[null,"10,20",true]' && show(pv('sw', 'p4')) === '[null,"10,20",true]'
       && !endCarries(getNode('sw'), 'p5', 30) && endCarries(getNode('sw'), 'p4', 20), show([pv('sw', 'p4'), pv('sw', 'p5')]));
    ok('a LAG that records nothing leaves its member ports their own', show(pv('sw', 'p6')) === '[null,"70",true]' && show(pv('sw', 'p7')) === '[null,null,false]', show([pv('sw', 'p6'), pv('sw', 'p7')]));
    const lpq = (text) => { const p = parseQuery(text); return ['p4', 'p5', 'p6', 'p7'].filter((id) => queryMatch(p, 'port', { node: getNode('sw'), portId: id, peer: null })).join(','); };
    ok('port rows: a LAG member is found by its LAG\'s VLANs', lpq('vlan:20') === 'p4,p5' && lpq('has:trunk') === 'p4,p5,p6' && lpq('vlan:5') === '', `${lpq('vlan:20')} ${lpq('has:trunk')} ${lpq('vlan:5')}`);

    // ---- 5. The facts raise only their own checks: the PoE checks (stage
    // 2b, tests/suites/poechecks.js) and the VLAN checks (stage 2a,
    // tests/suites/vlanchecks.js); every other finding is unchanged ----
    const findingsOf = () => topologyFindings().filter((x) => !/^(?:poe|vlan)-/.test(x.key)).map((x) => `${x.level}|${x.subject}|${x.detail}`).sort().join('\n');
    const changed = [];
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'file' });
      const before = findingsOf();
      state.nodes.forEach((n, i) => {
        if (hasPortGrid(n)) { n.poeBudget = 15; n.portAttrs = { p1: { vlan: 999, tagged: '3000' }, p2: { poe: 'af', vlan: 7 } }; }
        if (canDrawPoe(n.type)) n.poeDraw = 90;
        (n.interfaces || []).forEach((it) => { it.vlan = 4000 - i; it.tagged = '5,6'; });
      });
      save();
      if (findingsOf() !== before) changed.push(k);
    });
    ok('every template given VLAN and PoE facts that disagree everywhere has the same findings as without them, the PoE and VLAN checks apart', !changed.length, changed.join(', '));

    // ---- 6. Search ----
    open(lab());
    const q = (text) => { const p = parseQuery(text); return p.errors.length ? 'ERR' : state.nodes.filter((n) => queryMatch(p, 'node', n)).map((n) => n.id).sort().join(','); };
    ok('vlan:35 finds the trunk\'s switch and the switch cabled into it', q('vlan:35') === 'sw,sw2', q('vlan:35'));
    ok('vlan:3000 finds the "all" trunk and its neighbour', q('vlan:3000') === 'sw,sw2', q('vlan:3000'));
    ok('vlan:20 finds the access port\'s camera, the trunks and an interface\'s tagged list', q('vlan:20') === 'cam,rt,sw,sw2', q('vlan:20'));
    ok('vlan:30 finds an interface by its own VLAN', q('vlan:30') === 'rt,sw,sw2', q('vlan:30'));
    ok('vlan:10 still finds by the network', q('vlan:10') === 'lt,pc,rt,sw,sw2', q('vlan:10'));
    // A VLAN no network and no port has (only the "all" trunk, so its two
    // switches), held in memory on a wireless one.
    Object.assign(getNode('lt').interfaces[0], { vlan: 77, tagged: '78' });
    ok('a wireless interface\'s own VLAN and tagged list are never searched', getNode('lt').interfaces[0].vlan === 77 && q('vlan:77') === 'sw,sw2' && q('vlan:78') === 'sw,sw2' && !q('has:trunk').includes('lt'),
       `${q('vlan:77')} ${q('vlan:78')} ${q('has:trunk')}`);
    open(lab());
    ok('has:trunk', q('has:trunk') === 'rt,sw,sw2', q('has:trunk'));
    ok('has:poe: a PoE port or budget, a draw', q('has:poe') === 'cam,sw', q('has:poe'));
    ok('-has:poe leaves them out', q('-has:poe') === 'lt,pc,rt,sw2', q('-has:poe'));
    const ifq = (text) => { const p = parseQuery(text); return state.nodes.flatMap((n) => (n.interfaces || []).filter((i) => queryMatch(p, 'iface', n, i)).map((i) => `${n.id}:${i.id}`)).join(','); };
    ok('has:trunk on interface rows is the interface\'s own', ifq('has:trunk') === 'rt:i1', ifq('has:trunk'));
    const pq = (text) => { const p = parseQuery(text); return ['p1', 'p2', 'p3', 'p5'].filter((id) => queryMatch(p, 'port', { node: getNode('sw'), portId: id, peer: null })).join(','); };
    ok('port rows: vlan: by untagged or tagged, has:trunk and has:poe by the port', pq('vlan:20') === 'p1,p5' && pq('has:trunk') === 'p1' && pq('has:poe') === 'p5', `${pq('vlan:20')} ${pq('has:trunk')} ${pq('has:poe')}`);
    ok('has:cable on a port row still asks its switch', pq('has:cable') === 'p1,p2,p3,p5');

    // ---- 6b. Shown (stage 1b, vlanui.js holds the rest) ----
    replaceDocument({ v: DOC_VERSION, links: [], networks: [], nodes: [{ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8,
      portAttrs: { p2: { label: 'Desk 2' }, p5: { poe: 'af' }, p6: { tagged: '10,20' } }, interfaces: [] }] }, { origin: 'file' });
    const pmap = reportPortMaps().find((m) => m.id === 'sw');
    ok('the report\'s port map lists a free port with only PoE or a tagged list', pmap.rows.map((r) => r.port).join(',') === '2,5,6' && pmap.free === '1, 3–4, 7–8',
       show([pmap.rows.map((r) => r.port), pmap.free]));
    ok('the faceplate\'s count is of every fact', portAttrsSummary(getNode('sw')) === 'Port labels, VLANs and PoE (3 · 1 trunk · 1 PoE)', portAttrsSummary(getNode('sw')));

    // ---- 7. Changes ----
    const C = window.CarinoChanges;
    const before = lab(), after = lab();
    after.nodes[0].portAttrs.p1.tagged = '10,20';
    after.nodes[3].poeDraw = 12;
    after.nodes[4].interfaces[0].tagged = '10,20,30';
    const ch = C.docChanges(before, after);
    const names = ch.devices.changed.map((x) => `${x.name}:${x.fields.join('+')}:${(x.interfaces || []).map((i) => `${i.name}=${(i.fields || []).join('+')}`).join('/')}`).sort().join(' ');
    ok('the changes name the port facts, the draw and an interface\'s tagged VLANs', names === 'CAM-1:PoE draw (W): RT::eth0=Tagged VLANs SW-1:Port labels, VLANs and PoE:', names);
    setLocale('es');
    const rows = C.changeRows(ch).map((r) => r.detail).join(' | ');
    ok('and in Spanish', /Consumo PoE \(W\)/.test(rows) && /Etiquetas, VLAN y PoE de los puertos/.test(rows), rows);
    setLocale('en');

    // ---- 8. A binder's site ----
    const site = canonicalDoc(lab());
    const sn = (id) => site.nodes.find((n) => n.id === id);
    ok('a binder\'s site keeps every port fact, the budget, the draw and the interface VLANs', show(sn('sw').portAttrs.p1) === '{"tagged":"10,20,30-39"}' && sn('sw').poeBudget === 120
       && sn('cam').poeDraw === 6.49 && sn('rt').interfaces[0].tagged === '10,20' && sn('rt').interfaces[1].vlan === 30 && show(sn('sw2').portAttrs) === '{"p1":{"vlan":1,"tagged":"all"}}');
    const b = binderModel([{ id: 'b1', name: 'Trunked', updated: 1, doc: lab() }], { site: 'Estate', client: '', engineer: '', ref: '', date: '', scope: '' });
    ok('and a binder of it builds', !!b);

    // ---- 9. Words ----
    const { MESSAGES } = window.CarinoI18N;
    const words = ['Port labels, VLANs and PoE', 'PoE budget (W)', 'PoE draw (W)', 'Tagged VLANs', 'Only a switch or an access point has a PoE budget.',
      'A cloud, a VM or a container draws no PoE.', 'A sheet of ports maps the device, the port and its label, VLANs or PoE. Leave the other columns unmapped.'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = words.filter((w) => !MESSAGES[loc][w] || MESSAGES[loc][w] === w);
      ok(`${loc} carries the new words`, !miss.length, miss.join(' | '));
      ok(`${loc} no longer carries the old ports-sheet sentence`, !('A sheet of ports maps the device, the port and its label or VLAN. Leave the other columns unmapped.' in MESSAGES[loc]));
    });
    ok('Japanese and Russian keep PoE and VLAN in English', /PoE/.test(MESSAGES.ja['PoE draw (W)']) && /VLAN/.test(MESSAGES.ru['Tagged VLANs']));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 50); });
