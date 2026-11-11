// MikroTik /export to Topo (js/importers/mikrotik.js; docs/SCOPE.md step 6,
// D114, amendment 33), on hand-written exports in tests/fixtures/import/:
// mikrotik-hex.rsc (v6, verbose, a router with a renamed WAN port, a VLAN
// interface, a security profile with an escaped key, pools, DHCP networks,
// leases, a PPP secret, a disabled port, a line that is not RouterOS and
// "/ip neighbor print detail" pasted at the end), mikrotik-crs-vlans.rsc
// (v7, terse, a CRS switch with bridge VLAN filtering, a renamed port, a
// bond, VLAN ranges, an SNMP community) and mikrotik-hapax-v7.rsc (v7
// /interface wifi with security and configuration profiles).
// Covered: the tokenizer (continuations, quotes, \" \\ \_ escapes, [ find ]),
// detection, the device from the header and identity, interfaces and their
// addresses, VLAN interfaces carried tagged by their parent, a CRS's etherN
// as its port grid with PVIDs, untagged and tagged lists (ranges expanded),
// labels from comments and renames, a bond of numbered ports, subnets with
// gateway, DNS and the pool, leases as clients left out by default,
// neighbours cabled from the interface they were seen on, Wi-Fi from v7
// profiles (bands from both radios, hidden), secrets never read and counted,
// a disabled port noted, sections not read named, an unread line listed.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const load = async (n) => { const text = await (await fetch(`tests/fixtures/import/${n}`)).text(); return { name: n, text, bytes: new TextEncoder().encode(text) }; };
  try {
    const I = TopoImporters, M = TopoImportMikrotik;
    const node = (doc, name) => doc.nodes.find((n) => n.name === name);
    const iface = (n, name) => (n.interfaces || []).find((i) => i.name === name);

    // ---- The tokenizer ----
    const w = M.words('add name="a \\"b\\" c\\\\d" comment=x\\_y [ find default-name=ether1 ] k=v');
    ok('words: quotes and escapes, [ find ] as one word', w[1] === 'name=a "b" c\\d' && w[2] === 'comment=x y' && w[3].find === 'find default-name=ether1' && w[4] === 'k=v', JSON.stringify(w));
    const ll = M.logicalLines('/ip address\nadd address=1.2.3.4/24 \\\n    interface=ether1\n');
    ok('continued lines are joined', ll[1].text === 'add address=1.2.3.4/24 interface=ether1' && ll[1].line === 2, JSON.stringify(ll));
    ok('VLAN ranges expanded', M.vlanIds('10,20,100-102').join() === '10,20,100,101,102' && M.vlanIds('4090-5000').length === 5);

    const hex = await load('mikrotik-hex.rsc'), crs = await load('mikrotik-crs-vlans.rsc'), ax = await load('mikrotik-hapax-v7.rsc');
    ok('the three exports are detected as MikroTik, by nothing else', [hex, crs, ax].every((f) => I.sniff(f).importer === 'mikrotik' && I.list().filter((x) => x.detect(f) > 0.5).length === 1),
      [hex, crs, ax].map((f) => JSON.stringify(I.sniff(f))).join());

    // ---- hEX (v6, router) ----
    const r = I.parse('mikrotik', [hex]);
    r.parts.forEach((p) => { p.on = true; });
    I.applyParts(r);
    const d = r.doc;
    const rt = node(d, 'hex-oficina');
    ok('the router: identity, model, RouterOS version, serial', rt && rt.type === 'router' && rt.model === 'RB750Gr3' && rt.os === 'RouterOS 6.49.15' && rt.serial === 'HEX0000A1B2' && rt.vendor === 'MikroTik');
    ok('a renamed port keeps its MAC and address', iface(rt, 'ether1-wan').mac === '48:8F:5A:00:00:01' && iface(rt, 'ether1-wan').ip === '201.150.10.2/30');
    ok('the bridge and the VLAN interface hold their addresses; the bridge carries VLAN 20 tagged', iface(rt, 'bridge').ip === '192.168.88.1/24' && iface(rt, 'vlan20-voz').ip === '10.0.20.1/24'
      && iface(rt, 'vlan20-voz').vlan === 20 && iface(rt, 'bridge').tagged === '20', JSON.stringify(rt.interfaces));
    ok('bridge ports are interfaces', ['ether2', 'ether3', 'ether4'].every((n) => iface(rt, n)));
    const lan = d.networks.find((n) => n.cidr === '192.168.88.0/24'), voz = d.networks.find((n) => n.cidr === '10.0.20.0/24');
    ok('subnets: DHCP, gateway, DNS and the pool of the server on that interface', lan.dhcp && lan.gateway === '192.168.88.1' && lan.dns === '192.168.88.1, 1.1.1.1' && lan.dhcpFirst === '192.168.88.100'
      && lan.dhcpLast === '192.168.88.199' && voz.vlan === 20 && voz.dhcpFirst === '10.0.20.10' && !lan.name, JSON.stringify(d.networks));
    ok('the WAN /30 is a subnet with no gateway guessed', d.networks.some((n) => n.cidr === '201.150.10.0/30' && !n.gateway));
    const prn = node(d, 'Impresora HP'), tel = node(d, 'Telefono recepcion');
    ok('leases are clients, not cabled, in their subnet\'s prefix', prn && prn.interfaces[0].ip === '192.168.88.20/24' && tel.interfaces[0].ip === '10.0.20.11/24'
      && !d.links.some((l) => l.target === prn.id || l.source === prn.id) && d.nodes.some((n) => n.interfaces.some((i) => i.mac === 'D0:67:E5:DD:00:21')));
    ok('leases are a part, left out by default', r.parts.find((p) => p.key === 'leases').ids.length === 3 && I.parse('mikrotik', [hex]).doc.nodes.every((n) => n.name !== 'Impresora HP'));
    const swp = node(d, 'sw-piso1'), nas = node(d, 'nas-01');
    const lk = (a, z) => d.links.find((l) => (l.source === a.id && l.target === z.id) || (l.source === z.id && l.target === a.id));
    ok('neighbours: a CRS is a switch with its board and version, cabled from ether2 to its ether24', swp && swp.type === 'switch' && swp.model === 'CRS326-24G-2S+' && swp.os === 'RouterOS 7.15.3'
      && lk(rt, swp) && lk(rt, swp).sourceIface === iface(rt, 'ether2').id && iface(swp, 'ether24') && iface(swp, 'ether24').ip === '192.168.88.2/24', JSON.stringify(swp));
    ok('a neighbour with no board on ether4', nas && lk(rt, nas) && lk(rt, nas).sourceIface === iface(rt, 'ether4').id);
    ok('secrets never read and counted (a Wi-Fi key with escapes, a PPP account)', !/Una|rara|vpn-secret/.test(JSON.stringify(d)) && r.notes.some((x) => x.code === 'secrets' && x.params.n === 2), JSON.stringify(r.notes));
    ok('a disabled port is noted', r.notes.some((x) => x.code === 'iface-disabled' && x.params.n === 1));
    ok('sections not read are named', r.notes.some((x) => x.code === 'sections-not-read' && /\/ip firewall filter/.test(x.params.list) && /\/ppp secret/.test(x.params.list) && !/neighbor/.test(x.params.list)),
      JSON.stringify(r.notes));
    ok('a line that is not RouterOS is listed with its line, the neighbour lines are not', r.warnings.length === 1 && r.warnings[0].code === 'line-unread' && r.warnings[0].line === 60, JSON.stringify(r.warnings));
    ok('one export: its name is offered', r.name === 'hex-oficina');

    // ---- CRS (v7 terse, switch) ----
    const c = I.parse('mikrotik', [crs]);
    const sw = node(c.doc, 'sw-piso1');
    const pa = sw.portAttrs || {};
    ok('a CRS is a switch whose etherN are its port grid', sw.type === 'switch' && sw.portScheme && sw.portScheme.prefix === 'ether' && sw.portCount === 24, JSON.stringify(sw.portScheme) + sw.portCount);
    ok('labels from comments and from a rename', pa.p1.label === 'Uplink hEX' && pa.p2.label === 'Recepcion' && pa.p3.label === 'cam-patio' && pa.p24.label === 'hEX oficina');
    ok('PVIDs are access VLANs; an untagged list too', pa.p2.vlan === 10 && pa.p3.vlan === 30 && pa.p4.vlan === 10 && pa.p5.vlan === 20, JSON.stringify(pa));
    ok('tagged lists, ranges expanded', pa.p1.tagged === '10,20,30,99-102' && pa.p24.tagged === '10,20,30,99-102', pa.p1.tagged);
    const bond = iface(sw, 'bond-nas');
    ok('a bond of numbered ports, with its PVID', bond && bond.bond && bond.bond.members.join() === 'p22,p23' && bond.vlan === 10 && iface(sw, 'ether22').id === 'p22', JSON.stringify(sw.interfaces));
    ok('an SFP port that is not etherN is an interface', !!iface(sw, 'sfp-sfpplus1'));
    ok('the management VLAN interface and its subnet', iface(sw, 'mgmt').ip === '192.168.99.2/24' && c.doc.networks.some((n) => n.cidr === '192.168.99.0/24' && n.vlan === 99));
    ok('an SNMP community counts as a secret and is never read', !/s3cr3t/.test(JSON.stringify(c.doc)) && c.notes.some((x) => x.code === 'secrets' && x.params.n === 1));

    // ---- hAP ax (v7 wifi) ----
    const a = I.parse('mikrotik', [ax]);
    const casa = a.doc.wifi.find((x) => x.ssid === 'Casa Ruiz'), inv = a.doc.wifi.find((x) => x.ssid === 'Casa Invitados');
    ok('v7 Wi-Fi: SSID from the configuration, WPA2/WPA3 from the security profile, both bands', casa && casa.security === 'wpa2/3' && casa.bands.join() === '2.4,5', JSON.stringify(a.doc.wifi));
    ok('a virtual AP: hidden, no security said', inv && inv.hidden === true && !inv.security);
    const hap = node(a.doc, 'hapax-casa');
    ok('wifi interfaces are wireless', iface(hap, 'wifi1').wireless && iface(hap, 'wifi3').wireless && !/no-me-leas/.test(JSON.stringify(a.doc)));

    // ---- Both routers together: the neighbour and the CRS are one switch ----
    const both = I.parse('mikrotik', [hex, crs]);
    ok('a neighbour and its own export are one device', both.doc.nodes.filter((n) => n.name === 'sw-piso1').length === 1);
    ok('the result is a document the editor reads', isDocShape(d) && canonicalDoc(d).nodes.length === d.nodes.length && isDocShape(c.doc));

    const mine = canonicalDoc(templatesData.house);
    const target = mine.nodes.find((n) => n.type !== 'cloud' && (n.interfaces || []).length);
    target.interfaces[0].mac = '00:14:38:DD:00:20';
    const plan = planMerge(mine, d, null);
    ok('a lease matches the sample\'s device by MAC', plan.items.some((it) => it.kind === 'nodes' && it.mineId === target.id && it.matchedBy === 'mac'));
    ok('no transient id survives the merge', !/"imp-/.test(JSON.stringify(applyMergePlan(mine, plan, {}).doc)));
    // \\XX bytes are UTF-8 (RouterOS writes every non-ASCII character so).
    const ux = M.words('set name="Oficina-Dise\\C3\\B1o" comment=Caf\\C3\\A9\\_2');
    ok('\\XX escapes are UTF-8 bytes', ux[1] === 'name=Oficina-Diseño' && ux[2] === 'comment=Café 2', JSON.stringify(ux));
    const enc = (name, text) => ({ name, text, bytes: new TextEncoder().encode(text) });
    const leaseText = '# 2026-11-10 10:00:00 by RouterOS 7.16\n# model = RB5009UG+S+\n/system identity\nset name=gw\n/ip address\nadd address=192.168.1.1/24 interface=bridge\n'
      + '/ip dhcp-server lease\nadd address=192.168.1.20 mac-address=AA:BB:CC:00:00:01 host-name=iPhone\nadd address=192.168.1.21 mac-address=AA:BB:CC:00:00:02 host-name=iPhone\n'
      + 'add address=192.168.1.30 mac-address=48:8F:5A:00:00:30 host-name=cap-recepcion\n'
      + '/ip neighbor print detail\n 0 interface=ether2 address=192.168.1.30 mac-address=48:8F:5A:00:00:30 identity="cap-recepcion" platform="MikroTik" board="cAP ac" interface-name="ether1"\n';
    const lr = I.parse('mikrotik', [enc('leases.rsc', leaseText)]);
    const phones = lr.full.nodes.filter((n) => /^iPhone/.test(n.name));
    ok('two leases with different MACs, both called iPhone, are two devices', phones.length === 2, lr.full.nodes.map((n) => n.name).join(','));
    ok('a neighbour that also had a lease stays in, with its cable, while leases are left out', !!node(lr.doc, 'cap-recepcion') && lr.doc.links.length === 1 && !node(lr.doc, 'iPhone'),
      JSON.stringify({ nodes: lr.doc.nodes.map((n) => n.name), links: lr.doc.links.length, parts: lr.parts }));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
