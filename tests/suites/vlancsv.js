// VLANs, trunks and PoE in spreadsheets, stage 1a (docs/BACKLOG.md feature
// 4, landing order step 14; the data model is tests/suites/vlanmodel.js):
//   1. export: devices.csv's poe_budget and poe_draw right after first_port
//      (blank where the schema would not write them), interfaces.csv's
//      untagged_vlan and tagged_vlans after bond (blank on a wireless one),
//      ports.csv's port_tagged and port_poe after port_vlan;
//   2. each sheet imported straight back changes nothing;
//   3. ports.csv in: tagged lists canonical, "all", PoE by its words
//      ("poe+" is at), watts, a blank cell leaving a fact as it is, a bad
//      list or PoE refused on its row, a port the box does not have a
//      conflict, two rows that disagree on tagged a conflict, the counts per
//      port, Apply one undo step;
//   4. devices.csv and interfaces.csv in: a draw by class held as watts, a
//      budget on a PC or a draw on a VM said and not stored, an interface's
//      VLANs set, a wireless one's passed over;
//   5. the headings: no bare "PoE" alias (an inventory's PoE column leaves it
//      a sheet of devices), poe_draw a device's, "PoE class" a port's, a
//      bare "VLAN" still unmapped, interfaces.csv never a sheet of subnets;
//   6. every template, given tagged lists, a range, "all", standard and
//      custom PoE, budgets, draws and interface VLANs, round-trips through a
//      blank map with every fact (ports.csv last).
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const open = (doc) => { replaceDocument(doc, { origin: 'file' }); initHistory(); };
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
  const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
  const statuses = (plan) => plan.rows.map((r) => r.status).join(',');
  const lab = () => ({ v: DOC_VERSION, links: [{ id: 'l1', source: 'cam', target: 'sw', sourceIface: 'i1', targetIface: 'p5' }],
    networks: [{ id: 'n10', cidr: '10.0.10.0/24', vlan: 10 }],
    nodes: [
      { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 0, portCount: 8, poeBudget: 370.5,
        portAttrs: { p1: { tagged: '10,20,30-39' }, p2: { vlan: 1, tagged: 'all' }, p5: { vlan: 20, poe: 'at' }, p6: { poe: 7.5 } }, interfaces: [] },
      { id: 'cam', type: 'camera', name: 'CAM-1', x: 100, y: 100, poeDraw: 3.84, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.5/24' }] },
      { id: 'rt', type: 'router', name: 'RT', x: 0, y: -100, interfaces: [{ id: 'i1', name: 'eth0', ip: '', tagged: '10,20' }, { id: 'i2', name: 'eth1', ip: '10.0.30.1/24', vlan: 30 }] },
      { id: 'pc', type: 'pc', name: 'PC-1', x: 0, y: 200, interfaces: [{ id: 'w1', name: 'wlan0', ip: '10.0.10.9/24' }] },
      { id: 'vm', type: 'vm', name: 'VM-1', x: 0, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.20/24' }] }
    ] });
  setLocale('en');

  try {
    // ---- 1. Export ----
    open(lab());
    const dev = csvDevicesSheet();
    const at = (h) => dev.headers.indexOf(h);
    ok('devices.csv has poe_budget and poe_draw right after first_port', at('poe_budget') === at('first_port') + 1 && at('poe_draw') === at('poe_budget') + 1, dev.headers.join(','));
    const drow = (id) => dev.rows[state.nodes.findIndex((n) => n.id === id)];
    ok('with the values as numbers', drow('sw')[at('poe_budget')] === '370.5' && drow('cam')[at('poe_draw')] === '3.84' && drow('pc')[at('poe_draw')] === '' && drow('cam')[at('poe_budget')] === '');
    getNode('pc').type = 'vm'; getNode('pc').poeDraw = 5; getNode('pc').poeBudget = 9;
    ok('blank where the file would not hold them', csvDevicesSheet().rows[3][at('poe_draw')] === '' && csvDevicesSheet().rows[3][at('poe_budget')] === '');
    open(lab());
    const ifs = csvInterfacesSheet();
    const ih = (h) => ifs.headers.indexOf(h);
    ok('interfaces.csv has untagged_vlan and tagged_vlans after bond', ih('untagged_vlan') === ih('bond') + 1 && ih('tagged_vlans') === ih('bond') + 2, ifs.headers.join(','));
    const irow = (dev, id) => ifs.rows.find((r) => r[0] === dev && r[3] === id);
    ok('a wired interface\'s VLANs as stored', irow('rt', 'i1')[ih('tagged_vlans')] === '10,20' && irow('rt', 'i2')[ih('untagged_vlan')] === '30' && irow('cam', 'i1')[ih('untagged_vlan')] === '');
    getNode('pc').interfaces[0].vlan = 10;
    ok('a wireless one\'s blank, even one held in memory', csvInterfacesSheet().rows.find((r) => r[0] === 'pc')[ih('untagged_vlan')] === '');
    open(lab());
    const ps = csvPortsSheet();
    ok('ports.csv: port_tagged and port_poe after port_vlan', ps.headers.join(',') === 'device_id,device,port,port_label,port_vlan,port_tagged,port_poe,connected_device,connected_port');
    const prow = (p) => ps.rows.find((r) => r[2] === p).slice(2, 7).join('|');
    ok('a trunk, "all" with a native VLAN, a standard and custom watts', prow('1') === '1|||10,20,30-39|' && prow('2') === '2||1|all|' && prow('5') === '5||20||at' && prow('6') === '6||||7.5',
       ['1', '2', '5', '6'].map(prow).join(' ; '));

    // ---- 2. Straight back ----
    ['devices', 'interfaces', 'ports'].forEach((k) => {
      open(lab());
      const sheet = CSV_SHEETS.find((s) => s.key === k).build();
      const p = planOf(csvText(sheet));
      ok(`${k}.csv imported straight back changes nothing`, !p.errors.length && p.rows.every((r) => r.status === 'same'), p.errors.join(' ') + p.rows.map((r) => `${r.name}:${r.status}:${r.why}`).join(' | '));
    });

    // ---- 3. ports.csv in ----
    open(lab());
    let p = planOf('device,port,port_tagged,port_poe\nSW-1,3,"30-39,10,20,20",poe+\nSW-1,4,all,802.3bt Type 4\nSW-1,7,,30 W\nSW-1,1,,\nSW-1,8,0,\nSW-1,8,,lots\nSW-1,99,10,\nSW-1,2,"5,6",\nSW-1,2,"5,7",');
    ok('ports.csv rows: changes, a blank row the same, refusals and conflicts', statuses(p) === 'change,change,change,same,conflict,conflict,conflict,change,conflict', statuses(p));
    ok('a bad list and a bad PoE are refused on their rows', /not a valid Port tagged VLANs/.test(p.rows[4].why) && /not a valid Port PoE/.test(p.rows[5].why), `${p.rows[4].why} | ${p.rows[5].why}`);
    ok('a port the box does not have is a conflict', /has no port 99/.test(p.rows[6].why), p.rows[6].why);
    ok('two rows that disagree on tagged are a conflict', /Another row sets Port tagged VLANs to 5,6/.test(p.rows[8].why), p.rows[8].why);
    ok('changes are counted per port', p.counts.change === 4, show(p.counts));
    const steps = _undoStack.length;
    applyCsvPlan(p);
    ok('Apply writes them canonical, in one undo step', _undoStack.length === steps + 1 && show(getNode('sw').portAttrs.p3) === '{"tagged":"10,20,30-39","poe":"at"}'
       && show(getNode('sw').portAttrs.p4) === '{"tagged":"all","poe":"bt4"}' && show(getNode('sw').portAttrs.p7) === '{"poe":30}' && show(getNode('sw').portAttrs.p2) === '{"vlan":1,"tagged":"5,6"}', show(getNode('sw').portAttrs));
    ok('a blank cell left the facts as they were', show(getNode('sw').portAttrs.p1) === '{"tagged":"10,20,30-39"}' && show(getNode('sw').portAttrs.p5) === '{"vlan":20,"poe":"at"}');
    undo();
    ok('one undo takes them back', !getNode('sw').portAttrs.p3 && getNode('sw').portAttrs.p2.tagged === 'all');

    // ---- 4. devices.csv and interfaces.csv in ----
    open(lab());
    p = planOf('name,poe_draw,poe_budget\nCAM-1,class 4,\nPC-1,6,50\nVM-1,class 2,\nSW-1,,400');
    ok('the rows change', statuses(p) === 'change,change,same,change', statuses(p));
    ok('a budget on a PC and a draw on a VM are said, not stored', p.rows[1].notes.some((n) => /PoE budget/.test(n)) && p.rows[2].notes.some((n) => /draws no PoE/.test(n)), show(p.rows.map((r) => r.notes)));
    applyCsvPlan(p);
    ok('a draw by class is held as watts, the rest as typed', getNode('cam').poeDraw === 25.5 && getNode('pc').poeDraw === 6 && !('poeBudget' in getNode('pc')) && !('poeDraw' in getNode('vm')) && getNode('sw').poeBudget === 400,
       show([getNode('cam').poeDraw, getNode('pc').poeDraw, getNode('pc').poeBudget, getNode('vm').poeDraw, getNode('sw').poeBudget]));
    p = planOf('name,poe_draw\nCAM-1,lots');
    ok('a draw that is no draw is refused', statuses(p) === 'conflict', statuses(p));
    open(lab());
    p = planOf('device_id,interface_id,untagged_vlan,tagged_vlans\ncam,i1,10,"20,21,22"\npc,w1,10,20\nrt,i1,,\nrt,i2,4095,');
    ok('interfaces.csv rows: a change, a wireless one passed over, a blank row, a bad VLAN refused', statuses(p) === 'change,same,same,conflict', statuses(p) + ' ' + p.rows.map((r) => r.why).join('|'));
    ok('the wireless one says why, once', show(p.rows[1].notes) === show(['Only a wired interface has a VLAN of its own.']) && !p.rows[0].notes.length, show(p.rows.map((r) => r.notes)));
    applyCsvPlan(p);
    ok('the interface\'s VLANs are set, canonical', getNode('cam').interfaces[0].vlan === 10 && getNode('cam').interfaces[0].tagged === '20-22' && !('vlan' in getNode('pc').interfaces[0]));

    // ---- 5. The headings ----
    const mapped = (text) => csvAutoMap(sheetOf(text));
    ok('an inventory\'s bare PoE column is no port fact: still a sheet of devices', csvSheetKind(mapped('name,ip,PoE\nCAM-9,10.0.10.40,yes')) === 'devices' && mapped('name,ip,PoE\nX,10.0.10.40,yes')[2] === '', show(mapped('name,ip,PoE\nX,10.0.10.40,yes')));
    ok('poe_draw and "PoE draw" are a device\'s draw', mapped('name,poe_draw\nX,5')[1] === 'poeDraw' && mapped('name,PoE draw\nX,5')[1] === 'poeDraw' && mapped('name,PoE budget (W)\nX,5')[1] === 'poeBudget');
    ok('an inventory\'s "Power draw" or "PoE watts" is left unmapped', mapped('name,type,Power draw\nsrv1,server,450')[2] === '' && mapped('name,PoE watts\nX,5')[1] === '',
       show([mapped('name,type,Power draw\nsrv1,server,450'), mapped('name,PoE watts\nX,5')]));
    open(lab());
    p = planOf('name,type,Power draw\nSRV-1,server,450\nNUC-1,pc,65');
    ok('so a 450 W server imports and a 65 W PC is not made PoE-powered', statuses(p) === 'add,add', statuses(p) + ' ' + p.rows.map((r) => r.why).join('|'));
    applyCsvPlan(p);
    ok('with no draw stored', !state.nodes.some((n) => 'poeDraw' in n && /^(SRV|NUC)-1$/.test(n.name)));
    ok('"PoE class", "Port PoE" and "Port tagged" are a port\'s', mapped('device,port,PoE class\nSW-1,1,af')[2] === 'pt:poe' && mapped('device,port,Port PoE\nSW-1,1,af')[2] === 'pt:poe'
       && mapped('device,port,Port tagged\nSW-1,1,10')[2] === 'pt:tagged');
    ok('a bare VLAN heading is still unmapped', mapped('name,ip,VLAN\nX,10.0.10.9,10')[2] === '', show(mapped('name,ip,VLAN\nX,10.0.10.9,10')));
    open(lab());
    const ifSheet = sheetOf(csvText(csvInterfacesSheet()));
    ok('interfaces.csv is not a sheet of subnets', csvSheetKind(csvAutoMap(ifSheet)) === 'devices' && !csvAutoMap(ifSheet).some((k) => /^net:/.test(k)), csvAutoMap(ifSheet).join(','));
    ok('"Tagged VLANs" and "Native VLAN" are an interface\'s', mapped('name,Tagged VLANs\nRT,10')[1] === 'if:tagged' && mapped('name,Native VLAN\nRT,10')[1] === 'if:vlan'
       && mapped('name,ip,Allowed VLANs\nRT,10.0.10.1,10')[2] === 'if:tagged');
    // Beside a port and nothing of an interface's, they are the port's.
    ok('"device, port, Tagged VLANs" is a sheet of ports', show(mapped('device,port,Tagged VLANs\nSW-1,1,"20,30"')) === '["name","cab:port","pt:tagged"]'
       && csvSheetKind(mapped('device,port,Tagged VLANs\nSW-1,1,"20,30"')) === 'ports', show(mapped('device,port,Tagged VLANs\nSW-1,1,"20,30"')));
    ok('so are "Native VLAN", "Trunk VLANs" and "Allowed VLANs" beside a port', show(mapped('device,port,Native VLAN,Allowed VLANs\nSW-1,1,10,20')) === '["name","cab:port","pt:vlan","pt:tagged"]'
       && mapped('device,port,Trunk VLANs\nSW-1,1,10')[2] === 'pt:tagged', show(mapped('device,port,Native VLAN,Allowed VLANs\nSW-1,1,10,20')));
    ok('a plain "Tagged VLANs" beside port_vlan is the port\'s, not a mixed sheet', csvSheetKind(mapped('device,port,port_vlan,Tagged VLANs\nSW-1,1,10,"20,30"')) === 'ports',
       show(mapped('device,port,port_vlan,Tagged VLANs\nSW-1,1,10,"20,30"')));
    ok('beside a switch or an address they stay the interface\'s', mapped('name,switch,port,Tagged VLANs\nPC,SW-1,1,10')[3] === 'if:tagged'
       && mapped('name,ip,port,Native VLAN\nPC,10.0.10.5,1,10')[3] === 'if:vlan');
    open(lab());
    p = planOf('device,port,Native VLAN,Tagged VLANs\nSW-1,3,10,20\nSW-1,4,30,"40 - 42"');
    ok('a switch\'s port list with Native and Tagged VLANs sets the ports', p.kind === 'ports' && statuses(p) === 'change,change', p.kind + ' ' + statuses(p) + ' ' + p.rows.map((r) => r.why).join('|'));
    applyCsvPlan(p);
    ok('each port\'s VLANs, canonical, and no interface touched', show(portAttrOf(getNode('sw'), 'p3')) === '{"label":"","vlan":10,"tagged":"20","poe":null}'
       && portAttrOf(getNode('sw'), 'p4').tagged === '40-42' && portAttrOf(getNode('sw'), 'p4').vlan === 30 && !(getNode('sw').interfaces || []).some((i) => 'vlan' in i || 'tagged' in i),
       show(getNode('sw').portAttrs));

    // ---- 6. Every template, back through a blank map ----
    const blank = () => replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    const devSig = () => state.nodes.map((n) => { const o = serializeNode(n); if (o.group) o.group = groupPathOf(n); return JSON.stringify(o); }).sort().join('\n');
    const lost = [];
    let facts = 0;
    Object.keys(templatesData).forEach((k) => {
      loadDocState(cloneData(templatesData[k])); autoBindLinks();
      state.nodes.forEach((n, i) => {
        if (hasPortGrid(n)) {
          const total = portCountOf(n);
          const want = [{ tagged: ['10,20,30-39', 'all', '1-4094'][i % 3], vlan: i % 2 ? 99 : undefined }, { poe: ['af', 'at', 'bt3', 'bt4'][i % 4] }, { poe: 12.5, tagged: '7' }];
          for (let j = 0; j < Math.min(total, 3); j++) Object.keys(want[j]).forEach((key) => { if (want[j][key] !== undefined) setPortAttr(n, 'p' + (j + 1), key, want[j][key]); });
          n.poeBudget = 120 + i;
          facts++;
        }
        if (canDrawPoe(n.type) && i % 2) n.poeDraw = [3.84, 12.95, 25.5, 71.3][i % 4];
        (n.interfaces || []).forEach((it, j) => { if (ifaceIsWireless(it)) return; if (j % 2) it.vlan = 100 + j; else it.tagged = j % 4 ? 'all' : '200-210,300'; });
      });
      save();
      const want = devSig();
      const sheets = { P: csvText(csvProvidersSheet()), S: csvText(csvSubnetsSheet()), G: csvText(csvGroupsSheet()), W: csvText(csvWifiSheet()), D: csvText(csvDevicesSheet()), I: csvText(csvInterfacesSheet()), C: csvText(csvCablesSheet()), T: csvText(csvPortsSheet()) };
      const order = ((state.providers || []).length ? 'P' : '') + ((state.wifi || []).length ? 'SWGDICT' : 'SGDICT');
      blank();
      const why = [];
      [...order].forEach((s) => { const sh = sheetOf(sheets[s]); const pl = csvPlan(sh, csvAutoMap(sh), { createGroups: true });
        pl.errors.forEach((e) => why.push(`${s}: ${e}`));
        pl.rows.filter((r) => r.status === 'conflict').forEach((r) => why.push(`${s} ${r.name}: ${r.why}`)); applyCsvPlan(pl); });
      const got = devSig();
      if (got !== want || why.length) {
        const a = want.split('\n'), b = got.split('\n'); const i = a.findIndex((x, j) => x !== b[j]);
        lost.push(`${k}: ${why.slice(0, 1).join('')} ${i >= 0 ? `${a[i]} ≠ ${b[i]}`.slice(0, 400) : ''}`);
      }
    });
    ok('every template with VLAN and PoE facts round-trips through a blank map with every one', !lost.length && facts > 5, `${facts} switches; ` + lost.slice(0, 2).join(' ; '));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 50); });
