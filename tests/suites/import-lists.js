// Importers fill the address lists (js/importers/common.js addressLists,
// mikrotik.js, unifi.js; docs/SCOPE.md step 9h, D444):
//   1. the shared reader: groups become lists al1, al2… in order with the
//      members that are addresses or subnets (a range and a host name left
//      out and counted), a rule between two of them is a block or an allow
//      on the list traffic comes from, a rule naming a group not given or a
//      group itself is dropped, a group with no name is dropped;
//   2. MikroTik: /ip firewall address-list entries by list name (a disabled
//      one left out); from /ip firewall filter's forward chain, drop and
//      reject between two lists block and accept allows; another chain, a
//      negated list and a disabled rule are not read; an export with no
//      list writes no key; the address-list section is no longer named as
//      not read;
//   3. UniFi: rest/firewallgroup address groups (IPv6 ones too, port groups
//      not), rest/firewallrule between two of them, an off rule not read;
//   4. what comes out satisfies the schema, and opened, a trace obeys it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const file = (name, text) => ({ name, text, bytes: new TextEncoder().encode(text) });
  try {
    setLocale('en');
    const I = TopoImporters, C = TopoImportCommon;
    // ---- 1. The shared reader ----
    const r = C.addressLists(
      [{ key: 'g1', name: 'Cameras', members: ['10.0.30.0/24', '10.0.30.0/24', '10.0.31.5', '10.0.32.1-10.0.32.9', 'nvr.example.com', ''] }, { key: 'g2', name: ' Office ', members: ['10.0.10.0/24'] },
        { key: 'g3', name: '', members: ['10.9.9.9'] }, { key: 'g4', name: 'Names only', members: ['a.example.com'] }, { key: 'g1', name: 'Twin', members: [] }],
      [{ from: 'g2', to: 'g1', action: 'block' }, { from: 'g2', to: 'g1', action: 'block' }, { from: 'g1', to: 'g2', action: 'allow' }, { from: 'g2', to: 'nope', action: 'block' }, { from: 'g2', to: 'g2', action: 'block' }]);
    ok('groups become lists in order, with the members that are addresses', show(r.lists.map((l) => [l.id, l.name, l.members])) === '[["al1","Cameras",["10.0.30.0/24","10.0.31.5"]],["al2","Office",["10.0.10.0/24"]],["al3","Names only",null]]', show(r.lists));
    ok('…a range and a host name are left out and counted', r.skipped === 3, String(r.skipped));
    ok('a rule is on the list the traffic comes from, once', show(r.lists[1].blocked) === '["al1"]' && show(r.lists[0].allowed) === '["al2"]' && !('blocked' in r.lists[0]));
    ok('nothing given: nothing', show(C.addressLists([], [])) === '{"lists":[],"skipped":0}' && C.addressLists(undefined, undefined).lists.length === 0);

    // ---- 2. MikroTik ----
    const rsc = `# 2026-11-17 10:00:00 by RouterOS 7.16
# model = RB5009UG+S+
/system identity
set name=gw
/interface ethernet
set [ find default-name=ether1 ] name=wan
/ip address
add address=192.168.88.1/24 interface=ether2 network=192.168.88.0
/ip firewall address-list
add address=192.168.88.0/26 list=office
add address=192.168.88.100 list=cameras
add address=192.168.88.101 list=cameras comment="porch"
add address=192.168.88.102 list=cameras disabled=yes
add address=192.168.88.200-192.168.88.210 list=guests
add address=updates.example.com list=allowed-out
/ip firewall filter
add action=drop chain=forward src-address-list=guests dst-address-list=office
add action=reject chain=forward src-address-list=office dst-address-list=cameras reject-with=icmp-admin-prohibited
add action=accept chain=forward src-address-list=cameras dst-address-list=office
add action=drop chain=input src-address-list=guests dst-address-list=cameras
add action=drop chain=forward src-address-list=!office dst-address-list=cameras
add action=drop chain=forward src-address-list=cameras dst-address-list=guests disabled=yes
add action=drop chain=forward src-address-list=guests
`;
    const m = I.parse('mikrotik', [file('gw.rsc', rsc)]);
    const lists = m.doc.lists || [];
    const by = (n) => lists.find((l) => l.name === n);
    ok('MikroTik: the lists by name', lists.map((l) => l.name).join() === 'office,cameras,guests,allowed-out', lists.map((l) => l.name).join());
    ok('…their addresses, a disabled entry left out', show(by('cameras').members) === '["192.168.88.100","192.168.88.101"]' && show(by('office').members) === '["192.168.88.0/26"]');
    ok('…a range and a name are not members', !('members' in by('guests')) && !('members' in by('allowed-out')));
    ok('drop and reject between two lists block', show(by('guests').blocked) === `["${by('office').id}"]` && show(by('office').blocked) === `["${by('cameras').id}"]`);
    ok('accept allows', show(by('cameras').allowed) === `["${by('office').id}"]`);
    ok('another chain, a negated list, a disabled rule and a rule with one list are not read', !('blocked' in by('cameras')) && (by('guests').blocked || []).length === 1);
    const notes = show(m.notes) + show(m.warnings);
    ok('the address-list section is not named as not read', !/address-list/.test(notes), notes.slice(0, 300));
    const plain = I.parse('mikrotik', [file('gw.rsc', rsc.split('/ip firewall address-list')[0])]);
    ok('an export with no list writes no key', !('lists' in plain.doc));

    // ---- 3. UniFi ----
    const uni = show({ meta: { rc: 'ok' }, data: [
      { _id: 'fg1', name: 'Cameras', group_type: 'address-group', group_members: ['10.0.30.0/24', '10.0.31.5'] },
      { _id: 'fg2', name: 'Office', group_type: 'address-group', group_members: ['10.0.10.0/24'] },
      { _id: 'fg3', name: 'Web ports', group_type: 'port-group', group_members: ['80', '443'] },
      { _id: 'fg4', name: 'Six', group_type: 'ipv6-address-group', group_members: ['2001:db8:30::/64'] },
      { _id: 'r1', name: 'Office to cameras', ruleset: 'LAN_IN', action: 'drop', enabled: true, src_firewallgroup_ids: ['fg2'], dst_firewallgroup_ids: ['fg1', 'fg3'] },
      { _id: 'r2', name: 'Cameras to office', ruleset: 'LAN_IN', action: 'accept', enabled: true, src_firewallgroup_ids: ['fg1'], dst_firewallgroup_ids: ['fg2'] },
      { _id: 'r3', name: 'Off', ruleset: 'LAN_IN', action: 'drop', enabled: false, src_firewallgroup_ids: ['fg1'], dst_firewallgroup_ids: ['fg4'] },
      { ip_subnet: '10.0.10.1/24', name: 'Office', purpose: 'corporate', vlan_enabled: false }] });
    const u = I.parse('unifi', [file('unifi.json', uni)]);
    const ul = u.doc.lists || [];
    const ub = (n) => ul.find((l) => l.name === n);
    ok('UniFi: the address groups, IPv6 too, port groups not', ul.map((l) => l.name).join() === 'Cameras,Office,Six' && show(ub('Six').members) === '["2001:db8:30::/64"]', ul.map((l) => l.name).join());
    ok('…a drop between two address groups blocks, an accept allows', show(ub('Office').blocked) === `["${ub('Cameras').id}"]` && show(ub('Cameras').allowed) === `["${ub('Office').id}"]`);
    ok('…a rule that is off is not read', !('blocked' in ub('Cameras')));
    ok('the subnet beside them is still read', (u.doc.networks || []).length === 1);

    // ---- 4. The result ----
    const norm = normalizeLists(lists);
    ok('what comes out is what the document keeps', show(norm) === show(lists) && show(normalizeLists(ul)) === show(ul), show(norm));
    replaceDocument({ v: DOC_VERSION, lists: ul, links: [{ id: 'l1', source: 'a', target: 'b' }],
      nodes: [{ id: 'a', type: 'pc', name: 'Desk', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.20/16' }] }, { id: 'b', type: 'camera', name: 'Cam', x: 100, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.31.5/16' }] }] },
      { origin: 'file', docId: 'doc-import-lists' });
    autoBindLinks(); renderCanvasOnly();
    const ans = TopoTraceTarget.answer('a', 'b', '');
    ok('opened, a trace obeys the imported rule', ans.reaches === false && /Office may not reach Cameras/.test(ans.why.text), show(ans.why));
    ok('…and the allowed direction passes', TopoTraceTarget.answer('b', 'a', '').reaches === true);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
