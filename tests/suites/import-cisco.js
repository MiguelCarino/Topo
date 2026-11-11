// Cisco CDP and MAC table to Topo (js/importers/cisco.js; docs/SCOPE.md
// step 6, D114, D119, amendment 32), on hand-written captures in
// tests/fixtures/import/: cisco-cdp.txt (IOS-XE "SW-CORE#" and IOS
// "SW-ACCESS2>" prompts in one file: a router, an AP, a Cisco phone, the
// other switch seen from both sides, an entry with no interface line),
// cisco-mac-ios.txt (CPU and "All" rows, access ports, a phone and a PC on
// one port in two VLANs, an AP's and a router's port, a port with four
// addresses, a port-channel, a multicast row on two ports, a Router port, a
// line it cannot read) and cisco-mac-nxos.txt (no prompt: NX-OS CDP with the
// serial in the Device ID, the legend, *, +, G and C markers, the age,
// Secure and NTFY columns, vPC Peer-Link, sup-eth, a port-channel).
// Covered: interface names written long, prompts as switch names, the switch
// name asked when there is no prompt, neighbour types from capabilities and
// platform, one cable for a link seen from both ends, the native VLAN, the
// port grid from the most common prefix, MAC-to-port devices named by their
// maker, the uplink rule (D119) said once, the two-VLAN rule, and a merge
// into a sample that finds a device by its MAC.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const load = async (n) => { const text = await (await fetch(`tests/fixtures/import/${n}`)).text(); return { name: n, text, bytes: new TextEncoder().encode(text) }; };
  try {
    const I = TopoImporters, K = TopoImportCisco;
    const node = (doc, name) => doc.nodes.find((n) => n.name === name);
    const iface = (n, name) => (n.interfaces || []).find((i) => i.name === name);
    ok('interface names written long', ['Gi1/0/5', 'Te1/1/1', 'Twe1/0/1', 'Tw1/0/2', 'Fa0/1', 'Fo1/1', 'Hu1/0/49', 'Eth1/54', 'Et1/1', 'Po10', 'Vl20', 'Fi1/0/3', 'mgmt0', 'Port 1'].map(K.ifName).join()
      === 'GigabitEthernet1/0/5,TenGigabitEthernet1/1/1,TwentyFiveGigE1/0/1,TwoGigabitEthernet1/0/2,FastEthernet0/1,FortyGigabitEthernet1/1,HundredGigE1/0/49,Ethernet1/54,Ethernet1/1,Port-channel10,Vlan20,FiveGigabitEthernet1/0/3,mgmt0,Port 1',
      ['Gi1/0/5', 'Twe1/0/1', 'Tw1/0/2'].map(K.ifName).join());
    const cdp = await load('cisco-cdp.txt'), ios = await load('cisco-mac-ios.txt'), nx = await load('cisco-mac-nxos.txt');
    ok('the three captures are detected as Cisco, by nothing else', [cdp, ios, nx].every((f) => I.sniff(f).importer === 'cisco' && I.list().filter((x) => x.detect(f) > 0.5).length === 1),
      [cdp, ios, nx].map((f) => JSON.stringify(I.sniff(f))).join());

    // ---- CDP and the MAC table of one switch together ----
    const r = I.parse('cisco', [cdp, ios]);
    const d = r.doc;
    const core = node(d, 'SW-CORE'), acc = node(d, 'SW-ACCESS2'), rtr = node(d, 'RTR-EDGE'), ap = node(d, 'AP-RECEPCION'), ph = node(d, 'SEP00562B001122');
    ok('the switches from their prompts; a neighbour\'s domain is dropped', core && acc && rtr && core.type === 'switch' && !r.askName, d.nodes.map((n) => n.name).join());
    ok('neighbour types: an ISR router, an AP from Trans-Bridge, a phone', rtr.type === 'router' && ap.type === 'ap' && ph.type === 'voip');
    ok('platform as model, Cisco as maker, address on its own interface', rtr.model === 'ISR4331/K9' && rtr.vendor === 'Cisco' && rtr.interfaces.some((i) => i.ip === '10.1.1.1/32'));
    ok('SW-CORE\'s port grid from GigabitEthernet1/0/, the 10G port an interface', core.portScheme.prefix === 'GigabitEthernet1/0/' && core.portCount === 48 && !!iface(core, 'TenGigabitEthernet1/1/1'),
      JSON.stringify(core.portScheme) + core.portCount);
    const lk = (a, z) => d.links.filter((l) => (l.source === a.id && l.target === z.id) || (l.source === z.id && l.target === a.id));
    ok('the router on port 48 to its GigabitEthernet0/0/1', lk(core, rtr).length === 1 && lk(core, rtr)[0].sourceIface === 'p48' && lk(core, rtr)[0].targetIface === iface(rtr, 'GigabitEthernet0/0/1').id);
    ok('the link between the two switches, seen from both, is one cable', lk(core, acc).length === 1, JSON.stringify(lk(core, acc)));
    ok('the native VLAN of the AP\'s port', core.portAttrs.p10.vlan === 10, JSON.stringify(core.portAttrs));
    ok('a phone\'s Device ID gives its MAC', ph.interfaces.some((i) => i.mac === '00:56:2B:00:11:22'));
    ok('an entry with no interface line is listed', r.warnings.some((w) => w.code === 'line-unread' && w.file === 'cisco-cdp.txt' && w.line === 74), JSON.stringify(r.warnings));
    const byMac = (m) => d.nodes.find((n) => n.interfaces.some((i) => i.mac === m));
    const dell = byMac('D0:67:E5:EE:00:03'), hp = byMac('00:14:38:EE:00:04'), pc5 = byMac('3C:A9:F4:EE:00:05'), st = byMac('5C:E0:C5:EE:00:31');
    ok('addresses on access ports are devices named by their maker, cabled to the port', dell && /^Dell 0003$/.test(dell.name) && lk(core, dell)[0].sourceIface === 'p3' && hp && lk(core, hp)[0].sourceIface === 'p4'
      && st && lk(core, st)[0].sourceIface === 'p31', [dell, hp].map((n) => n && n.name).join());
    ok('the port\'s VLAN from its addresses', core.portAttrs.p3.vlan === 10 && core.portAttrs.p4.vlan === 10);
    ok('a phone and a PC on one port: the VLAN with more (tie: the lower) untagged, the other tagged, said', core.portAttrs.p5.vlan === 10 && core.portAttrs.p5.tagged === '20'
      && r.notes.some((x) => x.code === 'port-two-vlans' && /GigabitEthernet1\/0\/5/.test(x.params.list)), JSON.stringify(core.portAttrs.p5));
    ok('the phone found by its MAC is the CDP phone, not a second device; the PC behind it is not cabled to the switch', d.nodes.filter((n) => n.interfaces.some((i) => i.mac === '00:56:2B:00:11:22')).length === 1
      && pc5 && !lk(core, pc5).length);
    ok('uplinks (an AP\'s, a router\'s, four addresses) are left out and said once (D119)', !byMac('A4:5E:60:EE:00:10') && !byMac('D0:67:E5:EE:00:20') && !byMac('00:50:56:AA:00:01')
      && r.notes.some((x) => x.code === 'uplinks-skipped' && x.params.n === 3), JSON.stringify(r.notes));
    ok('port-channels, CPU, Router and multicast rows are left out', !byMac('D0:67:E5:EE:00:30') && !byMac('5C:0A:5B:00:00:99') && !byMac('01:00:5E:00:00:01') && !byMac('01:00:0C:CC:CC:CC'));
    ok('a line it cannot read in the table is listed', r.warnings.some((w) => w.code === 'line-unread' && w.file === 'cisco-mac-ios.txt' && w.line === 26), JSON.stringify(r.warnings));
    ok('the result is a document the editor reads', isDocShape(d) && canonicalDoc(d).nodes.length === d.nodes.length);

    // ---- NX-OS, no prompt ----
    const n1 = I.parse('cisco', [nx]);
    ok('no prompt: the switch name is asked, the file name meanwhile', n1.askName && !!node(n1.doc, 'cisco-mac-nxos'));
    const n2 = I.parse('cisco', [nx], { switchName: 'LEAF-01' });
    const leaf1 = node(n2.doc, 'LEAF-01'), leaf2 = node(n2.doc, 'LEAF-02');
    ok('the name given is used', !!leaf1 && !node(n2.doc, 'cisco-mac-nxos'));
    ok('NX-OS CDP: the serial from the Device ID, System Name as the name, a Nexus', leaf2 && leaf2.serial === 'FDO24210ABC' && leaf2.model === 'N9K-C93180YC-FX' && leaf2.type === 'l3switch' && /CDP Device ID: LEAF-02\(FDO24210ABC\)/.test(leaf2.notes));
    const nbm = (m) => n2.doc.nodes.find((n) => n.interfaces.some((i) => i.mac === m));
    ok('NX-OS rows with *, + and C markers read; Ethernet1/ is the grid', leaf1.portScheme.prefix === 'Ethernet1/' && nbm('00:50:56:B1:0A:01') && nbm('3C:A9:F4:B1:0C:01')
      && n2.doc.links.some((l) => l.source === leaf1.id && l.sourceIface === 'p4'));
    ok('vPC Peer-Link, sup-eth, a port-channel and the CDP uplink left out', !nbm('00:50:56:B1:0A:03') && !nbm('00:DE:FB:00:12:34') && !nbm('D0:67:E5:B1:0B:02') && !nbm('D0:67:E5:B1:0B:09'));
    ok('no line of the legend is listed', n2.warnings.length === 0, JSON.stringify(n2.warnings));

    // ---- Into a sample: the MAC table finds a device ----
    const mine = canonicalDoc(templatesData.house);
    const target = mine.nodes.find((n) => n.type !== 'cloud' && (n.interfaces || []).length);
    target.interfaces[0].mac = 'D0:67:E5:EE:00:03';
    const plan = planMerge(mine, d, null);
    ok('a MAC-table device matches the sample\'s by MAC', plan.items.some((it) => it.kind === 'nodes' && it.mineId === target.id && it.matchedBy === 'mac'));
    ok('no transient id survives the merge', !/"imp-/.test(JSON.stringify(applyMergePlan(mine, plan, {}).doc)));
    // A capture that starts with a login banner: the switch is named by its prompt, nothing asked.
    const banner = 'Last login: Mon Nov 10 09:12:44 2026 from 10.0.0.9\n\n' + cdp.text;
    const br = I.parse('cisco', [{ name: 'banner.txt', text: banner, bytes: new TextEncoder().encode(banner) }]);
    ok('a login banner before the prompt does not ask for a switch name', !br.askName && !!node(br.doc, 'SW-CORE'), String(br.askName) + ' ' + br.doc.nodes.map((n) => n.name).join());
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
