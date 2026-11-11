// NetBox to Topo (js/importers/netbox.js; docs/SCOPE.md step 6, D115, D116),
// on hand-written exports in tests/fixtures/import/netbox/:
//   - csv-verbose/: the list views' Export (verbose headers, "Data (10)"
//     VLANs, statuses as labels, an unnamed device, an interface of a device
//     that is not there, a cable to a device that is not there, a second and
//     a free-standing address);
//   - csv-fields/: the bulk-import field names, two sites, NetBox 4.2's MAC
//     file, virtual machines in a cluster, wireless LANs with a key;
//   - api/: REST JSON pages (two pages in one file, a bare list), 4.2 MAC
//     objects, a power cable, a tenant list it does not read.
// Covered: detection, the mapping of each object type, the status map,
// tags and custom fields as columns, a secret never read, a VLAN with no
// subnet noted, an address on no interface skipped and listed, the port grid
// from numbered ports, bonds from a LAG, rack position, ids from NetBox's
// own (a re-import updates: merged again it changes nothing), and a merge
// into a sample that matches by MAC and keeps no 'imp-' id.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const load = async (dir, names) => Promise.all(names.map(async (n) => {
    const text = await (await fetch(`tests/fixtures/import/netbox/${dir}/${n}`)).text();
    return { name: n, text, bytes: new TextEncoder().encode(text) };
  }));
  try {
    const I = TopoImporters;
    const node = (doc, name) => doc.nodes.find((n) => n.name === name);
    const iface = (n, name) => (n.interfaces || []).find((i) => i.name === name);
    const codes = (list) => list.map((w) => w.code);

    // ---- Verbose CSV ----
    const verbose = await load('csv-verbose', ['devices.csv', 'interfaces.csv', 'cables.csv', 'ip-addresses.csv', 'prefixes.csv', 'vlans.csv', 'locations.csv', 'racks.csv']);
    ok('every verbose file is detected as NetBox', verbose.every((f) => { const s = I.sniff(f); return s.kind === 'import' && s.importer === 'netbox'; }),
      verbose.map((f) => `${f.name}:${JSON.stringify(I.sniff(f))}`).join(' '));
    const v = I.parse('netbox', verbose);
    const d = v.doc;
    ok('devices: the four named ones, the unnamed one left out with its row', d.nodes.length === 4 && v.warnings.some((w) => w.code === 'row-no-name' && w.file === 'devices.csv' && w.row === 6),
      d.nodes.map((n) => n.name).join());
    const sw = node(d, 'core-sw-01'), fw = node(d, 'fw-01'), ap = node(d, 'ap-recepcion'), srv = node(d, 'srv-files');
    ok('roles to types', sw.type === 'switch' && fw.type === 'firewall' && ap.type === 'ap' && srv.type === 'server');
    ok('make, model, platform, serial, asset tag', sw.vendor === 'Cisco' && sw.model === 'C9200L-24P-4G' && sw.os === 'IOS-XE' && sw.serial === 'FOC2345X0AB' && sw.assetTag === 'INV-0042');
    ok('statuses: Active, Planned, Offline (retired, and its NetBox status in a column)', sw.status === 'active' && ap.status === 'planned' && srv.status === 'retired'
      && Object.values(srv.extra || {}).includes('offline') && d.columns.some((c) => c.name === 'NetBox status'));
    ok('comments and description are the notes', sw.notes === 'Core switch\nMain floor');
    ok('tags are a Tags column, custom fields columns (a date kept as a date)', d.columns.some((c) => c.name === 'Tags') && Object.values(sw.extra).includes('core, monitored')
      && d.columns.some((c) => c.name === 'warranty_end' && c.kind === 'date') && Object.values(sw.extra).includes('2027-06-30'), JSON.stringify(d.columns));
    const rack = d.groups.find((g) => g.kind === 'rack'), floor = d.groups.find((g) => g.name === 'Planta 1'), rec = d.groups.find((g) => g.name === 'Recepción');
    ok('locations nested, kinds from their words; the rack inside its location', floor && floor.kind === 'floor' && rec && rec.parent === floor.id && rack && rack.parent === floor.id
      && rack.uHeight === 42 && rack.depthMm === 1000 && rack.width === '19in', JSON.stringify(d.groups));
    ok('devices in the rack at their position and face, others in their location', sw.group === rack.id && sw.rackU === 40 && sw.rackFace === 'front' && ap.group === rec.id);
    ok('numbered ports become the port grid', sw.portScheme && sw.portScheme.prefix === 'GigabitEthernet1/0/' && sw.portCount === 24
      && sw.portAttrs.p1.label === 'Uplink FW' && sw.portAttrs.p1.vlan === 10 && sw.portAttrs.p2.poe === 'at' && sw.portAttrs.p3.tagged === '20,30', JSON.stringify(sw.portAttrs));
    ok('a numbered port with a MAC is kept as an interface on its port', iface(sw, 'GigabitEthernet1/0/24') && iface(sw, 'GigabitEthernet1/0/24').id === 'p24');
    ok('a virtual interface stays an interface, with its address', iface(sw, 'Vlan10') && iface(sw, 'Vlan10').ip === '192.168.10.2/24');
    ok('a LAG is a bond of its members… (none here: no member names it)', !iface(fw, 'lag1').bond);
    ok('a disabled interface is noted', v.notes.some((x) => x.code === 'iface-disabled' && x.params.n === 1));
    ok('an interface of a device not in the files is listed', v.warnings.some((w) => w.code === 'iface-no-device' && w.row === 15));
    ok('addresses on their interfaces; a second one and a free-standing one listed', iface(fw, 'wan1').ip === '203.0.113.2/29' && iface(srv, 'NIC1').ip === '192.168.10.30/24'
      && v.warnings.some((w) => w.code === 'ip-extra' && w.params.address === '192.168.10.31/24') && v.warnings.some((w) => w.code === 'ip-unassigned' && w.params.address === '192.168.10.250/24'));
    ok('cables between the right ports, with label, colour, length and medium', d.links.some((l) => l.source === sw.id && l.sourceIface === 'p1' && l.target === fw.id
      && iface(fw, 'internal1').id === l.targetIface && l.cable.label === 'C-001' && l.cable.color === 'blue' && l.cable.length === '2 m' && l.medium === 'utp')
      && d.links.some((l) => l.medium === 'fiber' && l.cable && l.cable.color === 'yellow'), JSON.stringify(d.links));
    ok('a cable to a device not in the files is listed', v.warnings.some((w) => w.code === 'cable-end' && w.row === 5));
    const data = d.networks.find((n) => n.cidr === '192.168.10.0/24');
    ok('prefixes are subnets: description the name, VLAN from "Data (10)", role the purpose', data && data.name === 'Oficinas' && data.vlan === 10 && data.purpose === 'Staff');
    ok('a VLAN names a subnet that has none; one with no subnet is noted', d.networks.find((n) => n.cidr === '192.168.20.0/24').name === 'Voz'
      && v.notes.some((x) => x.code === 'vlan-no-subnet' && x.params.vid === 30));
    ok('columns it does not read are said', v.notes.some((x) => x.code === 'columns-not-read' && /Utilization/.test(x.params.list)));
    ok('one site: its name is offered for the network', v.name === 'Oficina Centro');
    ok('no CSV id is kept as a NetBox id without a source tag, and the ids are the source\'s', /^nb-[0-9a-z]{6}-d12$/.test(sw.id) && /^nb-[0-9a-z]{6}-c201$/.test(d.links[0].id), sw.id);
    ok('the result is a document the editor reads', isDocShape(d) && canonicalDoc(d).nodes.length === 4);
    ok('counts', v.counts.devices === 4 && v.counts.cables === 3 && v.counts.subnets === 3 && v.counts.racks === 1 && v.counts.groups === 2 && v.counts.vlans === 3, JSON.stringify(v.counts));

    // ---- Bulk-import field names ----
    const fields = await load('csv-fields', ['devices.csv', 'interfaces.csv', 'mac-addresses.csv', 'virtual-machines.csv', 'vm-interfaces.csv', 'wireless-lans.csv', 'ip-addresses.csv']);
    ok('field-name files are detected as NetBox', fields.every((f) => I.sniff(f).importer === 'netbox'), fields.map((f) => `${f.name}:${I.sniff(f).kind}`).join(' '));
    const fr = I.parse('netbox', fields), fd = fr.doc;
    ok('two sites are two buildings', fd.groups.filter((g) => g.kind === 'building').length === 2 && fd.groups.some((g) => g.name === 'Clinic South'));
    ok('staged is planned', node(fd, 'lab-pc').status === 'planned');
    ok('NetBox 4.2 MAC file: MACs on their interfaces (VM ones too)', iface(node(fd, 'edge-rtr'), 'ether1').mac === '48:A9:8A:00:00:01' && iface(node(fd, 'lab-pc'), 'eth0').mac === 'D8:5E:D3:00:00:07'
      && iface(node(fd, 'ris-01'), 'ens18').mac === 'BC:24:11:AA:BB:01');
    ok('a trunk: untagged and tagged VLANs', iface(node(fd, 'edge-rtr'), 'ether2').vlan === 10 && iface(node(fd, 'edge-rtr'), 'ether2').tagged === '10,20');
    ok('virtual machines and a container run on the cluster\'s device', node(fd, 'ris-01').type === 'vm' && node(fd, 'ris-01').host === node(fd, 'hv-01').id
      && node(fd, 'web-ct').type === 'container' && node(fd, 'web-ct').host === node(fd, 'hv-01').id);
    ok('wireless LANs: SSID, security, subnet by VLAN; the key is never read', fd.wifi.some((w) => w.ssid === 'Clinic-Staff' && w.security === 'wpa2') && fd.wifi.some((w) => w.ssid === 'Clinic-Guest' && w.security === 'open')
      && !JSON.stringify(fd).includes('supersecret123') && fr.notes.some((x) => x.code === 'secrets' && x.params.n === 1), JSON.stringify(fr.notes));
    ok('with no NetBox ids the records get transient ids', fd.nodes.every((n) => /^imp-/.test(n.id)));

    // ---- REST JSON ----
    const api = await load('api', ['devices.json', 'interfaces.json', 'mac-addresses.json', 'cables.json', 'ip-addresses.json', 'prefixes.json', 'vlans.json', 'locations.json', 'wireless-lans.json', 'tenants.json']);
    ok('API pages are detected as NetBox (a type it does not read too, less surely)', api.every((f) => { const s = I.sniff(f); return s.kind === 'import' && s.importer === 'netbox' && s.score > (f.name === 'tenants.json' ? 0.5 : 0.9); }));
    const a = I.parse('netbox', api), ad = a.doc;
    const usw = node(ad, 'sw-floor2'), ap2 = node(ad, 'ap-201'), tv = node(ad, 'tv-201');
    ok('devices from nested objects', usw.vendor === 'Ubiquiti' && usw.model === 'USW-24-PoE' && usw.type === 'switch' && ap2.type === 'ap' && ap2.assetTag === 'HM-201' && tv.type === 'iot' && tv.status === 'planned');
    ok('two pages in one file are both read', (ap2.interfaces || []).length === 2 && (tv.interfaces || []).length === 1);
    ok('ports named "Port N" become the grid; PoE af, a trunk', usw.portCount === 24 && usw.portScheme.prefix === 'Port ' && usw.portAttrs.p1.poe === 'af' && usw.portAttrs.p1.vlan === 100
      && usw.portAttrs.p24.tagged === '100,200' && usw.portAttrs.p24.vlan === 1, JSON.stringify(usw.portAttrs));
    ok('4.2 MAC objects and the primary address land on their interface', iface(ap2, 'eth0').mac === '74:83:C2:11:22:33' && iface(ap2, 'eth0').ip === '10.0.2.21/24'
      && usw.interfaces.some((i) => i.id === 'p24' && i.ip === '10.0.2.2/24' && i.mac === 'F4:E2:C6:00:00:02'), JSON.stringify(usw.interfaces));
    ok('a wireless interface is wireless', iface(ap2, 'wlan0').wireless === true);
    ok('cables by interface id; a power cable is not a network cable and is listed', ad.links.length === 2 && ad.links.some((l) => l.source === usw.id && l.sourceIface === 'p1' && l.target === ap2.id
      && l.cable.length === '12.5 m' && l.cable.color === 'orange') && a.warnings.some((w) => w.code === 'cable-not-iface'));
    ok('a custom field with a community string is never read; others are columns', !JSON.stringify(ad).includes('public') && ad.columns.some((c) => c.name === 'room_count' && c.kind === 'number')
      && a.notes.some((x) => x.code === 'secrets' && x.params.n === 2), JSON.stringify(a.notes));
    ok('a Wi-Fi\'s key is never read', !JSON.stringify(ad).includes('welcome2026') && ad.wifi[0].ssid === 'HotelMar-Guest' && ad.wifi[0].network === ad.networks.find((n) => n.vlan === 100).id);
    ok('VLAN 200 has no subnet: noted', a.notes.some((x) => x.code === 'vlan-no-subnet' && x.params.vid === 200));
    ok('tenants are not read and are said so', a.notes.some((x) => x.code === 'not-read' && x.params.type === 'tenancy/tenants' && x.params.n === 1));
    ok('ids carry the NetBox host\'s tag', /^nb-[0-9a-z]{6}-d7$/.test(usw.id) && /^nb-[0-9a-z]{6}-i81$/.test(iface(ap2, 'wlan0').id));

    // ---- Re-import updates instead of duplicating ----
    persistLibrary({});
    replaceDocument(a.doc, { origin: 'file' });
    const again = I.parse('netbox', api);
    const plan = planMerge(serializeDoc(), again.doc, null);
    ok('the same export merged again changes nothing', plan.counts.added === 0 && plan.counts.changed === 0 && plan.counts.conflicts === 0, JSON.stringify(plan.counts));

    // ---- Into a sample: by MAC, and no transient id survives ----
    {
      const mine = canonicalDoc(templatesData.house);
      // The samples carry no MACs: one is given to the first device with an interface.
      const target = mine.nodes.find((n) => n.type !== 'cloud' && (n.interfaces || []).length);
      const mac = 'AA:BB:CC:DD:EE:01';
      if (target) target.interfaces[0].mac = mac;
      const csv = `name,role,device_type,manufacturer,site,status\n${target ? 'renamed-box' : 'x'},Server,Box,Acme,Home,active\nn1,Workstation,PC,Acme,Home,active\n`;
      const ifs = `device,name,type,mac_address\nrenamed-box,eth0,1000base-t,${mac}\nn1,eth0,1000base-t,\n`;
      const r = I.parse('netbox', [{ name: 'devices.csv', text: csv }, { name: 'interfaces.csv', text: ifs }].map((f) => Object.assign(f, { bytes: new TextEncoder().encode(f.text) })));
      const plan2 = planMerge(mine, r.doc, null);
      const res = applyMergePlan(mine, plan2, {});
      ok('a device with a known MAC matches it (no new device)', !!target && plan2.items.some((it) => it.kind === 'nodes' && it.mineId === target.id && it.matchedBy === 'mac'), target && target.id);
      ok('a device whose name collides with an id ("n1") is not matched by id', !plan2.items.some((it) => it.kind === 'nodes' && it.matchedBy === 'id'));
      ok('no transient id survives the merge', !/"imp-/.test(JSON.stringify(res.doc)), (JSON.stringify(res.doc).match(/"imp-[^"]*"/) || [''])[0]);
      const own = I.withoutTransientIds(r.doc);
      ok('opened as its own network, the prefix is dropped', !/"imp-/.test(JSON.stringify(own)) && own.nodes.every((n) => /^[a-z]+\d+$/.test(n.id)), own.nodes.map((n) => n.id).join());
    }
    // ---- Two sites, one name: rows say which by their site, or are left out ----
    const csvFile = (name, text) => ({ name, text, bytes: new TextEncoder().encode(text) });
    const two = I.parse('netbox', [
      csvFile('devices.csv', 'ID,Name,Status,Site,Role,Manufacturer,Type\n1,sw-core,Active,Clinic North,Access Switch,Cisco,C9200L\n2,sw-core,Active,Clinic South,Access Switch,Cisco,C9200L\n3,fw,Active,Clinic South,Firewall,Fortinet,FG-60F\n'),
      csvFile('interfaces.csv', 'ID,Device,Site,Name,Type\n11,sw-core,Clinic North,Vlan10,Virtual\n12,sw-core,Clinic North,Vlan20,Virtual\n21,sw-core,Clinic South,Vlan30,Virtual\n22,sw-core,,Vlan99,Virtual\n23,sw-core,Clinic South,Gi1/0/1,1000BASE-T (1GE)\n31,fw,,port1,1000BASE-T (1GE)\n'),
      csvFile('cables.csv', 'ID,Side A Site,Side A Device,Side A Type,Side A Name,Side B Device,Side B Type,Side B Name\n9,Clinic South,sw-core,dcim.interface,Gi1/0/1,fw,dcim.interface,port1\n')]);
    const cores = two.doc.nodes.filter((n) => n.name === 'sw-core');
    const north = cores.find((n) => n.id.endsWith('-d1')) || cores[0], south = cores.find((n) => n.id.endsWith('-d2')) || cores[1];
    const ifn = (n) => (n.interfaces || []).map((i) => i.name).filter(Boolean).sort().join(',');
    ok('same-named devices on two sites keep their own interfaces (told apart by the row\'s site)', cores.length === 2 && ifn(north) === 'Vlan10,Vlan20' && /Vlan30/.test(ifn(south)) && !/Vlan1|Vlan2/.test(ifn(south)),
      cores.map((n) => n.id + ':' + ifn(n)).join(' | '));
    ok('a row that does not say which is listed and left out', two.warnings.some((w) => w.code === 'device-ambiguous' && w.row === 5) && !cores.some((n) => ifn(n).includes('Vlan99')), JSON.stringify(two.warnings));
    ok('a cable whose end says its site lands on that site\'s device', two.doc.links.length === 1 && [two.doc.links[0].source, two.doc.links[0].target].includes(south.id), JSON.stringify(two.doc.links));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
