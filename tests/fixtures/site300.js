// A 300-device site, built the same way every time, for tests/suites/perf.js
// and for looking at Topo at scale by hand (load this file into the page, then
// replaceDocument(topoSite300(), { origin: 'file' })).
//
// Shaped like the sites Topo is used on, not like a stress grid: an ISP, a
// firewall, a router with a leg on each of five declared networks, a core
// switch, six 48-port access switches and four access points, then PCs,
// phones, printers, cameras and servers on the access switches and laptops on
// the APs. It carries what makes the engine work hard on a real site: the
// switched fabric every reachability walk crosses, inherited gateways and DNS,
// named ports with labels and VLANs, cable labels, asset tags, a retired
// device, a few faults (two duplicate addresses, one duplicate MAC, a gateway
// outside its subnet) and one accepted finding.
//
// Deterministic (no Math.random, no Date): the time budget in perf.js has to
// measure the same document on every run.
window.topoSite300 = function topoSite300() {
  const nodes = [], links = [];
  let linkSeq = 0;
  const link = (source, target, sourceIface, targetIface, extra) => {
    const id = `L${++linkSeq}`;
    links.push(Object.assign({ id, source, target, sourceIface, targetIface }, extra || {}));
    return id;
  };
  const hex = (n) => n.toString(16).padStart(2, '0');
  const mac = (a, b) => `52:54:00:${hex(a)}:${hex(b >> 8)}:${hex(b & 255)}`;

  const networks = [
    { id: 'net-srv', cidr: '10.20.10.0/24', name: 'Servers', vlan: 10, gateway: '10.20.10.1', dns: '10.20.10.10' },
    { id: 'net-usr', cidr: '10.20.20.0/23', name: 'Staff', vlan: 20, gateway: '10.20.20.1', dns: '10.20.10.10' },
    { id: 'net-cam', cidr: '10.20.30.0/24', name: 'Cameras', vlan: 30, gateway: '10.20.30.1', dns: '10.20.10.10' },
    { id: 'net-voip', cidr: '10.20.40.0/24', name: 'Voice', vlan: 40, gateway: '10.20.40.1', dns: '10.20.10.10' },
    { id: 'net-wifi', cidr: '10.20.50.0/24', name: 'Wi-Fi', vlan: 50, gateway: '10.20.50.1', dns: '10.20.10.10' }
  ];

  nodes.push({ id: 'isp', type: 'cloud', name: 'ISP', x: 2700, y: 40, interfaces: [{ id: 'i1', name: 'wan', ip: '203.0.113.1/30' }] });
  nodes.push({ id: 'fw', type: 'firewall', name: 'FW-1', x: 2700, y: 160, gw: '203.0.113.1', dns: '9.9.9.9',
    interfaces: [{ id: 'i1', name: 'wan', ip: '203.0.113.2/30' }, { id: 'i2', name: 'lan', ip: '10.20.0.1/30' }] });
  nodes.push({ id: 'rt', type: 'router', name: 'RT-CORE', x: 2700, y: 280, gw: '10.20.0.1', dns: '9.9.9.9',
    interfaces: [{ id: 'i0', name: 'up', ip: '10.20.0.2/30' }].concat(networks.map((n, i) =>
      ({ id: `i${i + 1}`, name: `vlan${n.vlan}`, ip: `${n.gateway}/${n.cidr.split('/')[1]}`, mac: mac(1, i + 1) }))) });
  link('isp', 'fw', 'i1', 'i1', { cable: { label: 'WAN-1' } });
  link('fw', 'rt', 'i2', 'i0', { cable: { label: 'FW-RT' } });

  nodes.push({ id: 'core', type: 'switch', name: 'SW-CORE', x: 2700, y: 400, portCount: 48,
    portScheme: { prefix: 'Te1/0/', start: 1 }, assetTag: 'CS-0001', location: 'MDF rack 1, U40', interfaces: [] });
  // Every router leg on the core: the router-on-a-stick shape most sites have.
  networks.forEach((n, i) => link('rt', 'core', `i${i + 1}`, `p${43 + i}`, { cable: { label: `RT-${n.vlan}` } }));

  // The DNS server every network hands out, on the core.
  nodes.push({ id: 'dns', type: 'server', name: 'SRV-DNS', x: 3000, y: 400, allowedPorts: '53',
    interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.10.10/24', mac: mac(4, 1) }] });
  link('core', 'dns', 'p10', 'i1', { cable: { label: 'DNS-1' } });

  const ACCESS = 6;
  for (let s = 1; s <= ACCESS; s++) {
    nodes.push({ id: `sw${s}`, type: 'switch', name: `SW-ACC-${s}`, x: 480 + (s - 1) * 1000, y: 540, portCount: 48,
      portScheme: { prefix: 'Gi1/0/', start: 1 }, assetTag: `CS-00${10 + s}`, location: `IDF ${s}`,
      portAttrs: { p1: { label: `Desk ${s}-01`, vlan: 20 }, p2: { label: `Desk ${s}-02`, vlan: 20 } }, interfaces: [] });
    link('core', `sw${s}`, `p${s}`, 'p48', { cable: { label: `UP-${s}`, length: '30 m' } });
  }
  for (let a = 1; a <= 4; a++) {
    // A radio of its own for the clients: the uplink takes the AP's one port.
    nodes.push({ id: `ap${a}`, type: 'ap', name: `AP-${a}`, x: 600 + (a - 1) * 1500, y: 1300,
      interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] });
    link(`sw${a}`, `ap${a}`, 'p47', 'p1');
  }

  // Hosts on the access switches, 42 ports each, a mix per switch.
  const KINDS = [
    { type: 'pc', name: 'PC', net: 1, ports: '' },
    { type: 'voip', name: 'PHONE', net: 3, ports: '5060' },
    { type: 'printer', name: 'PRN', net: 1, ports: '9100' },
    { type: 'camera', name: 'CAM', net: 2, ports: '554' },
    { type: 'server', name: 'SRV', net: 0, ports: '22, 443' }
  ];
  const nextHost = networks.map(() => 20);
  const hostIp = (netIndex) => {
    const n = networks[netIndex];
    const base = n.cidr.split('/')[0].split('.').map(Number);
    const h = nextHost[netIndex]++;
    return `${base[0]}.${base[1]}.${base[2] + (h >> 8)}.${h & 255}/${n.cidr.split('/')[1]}`;
  };
  let seq = 0;
  for (let s = 1; s <= ACCESS; s++) {
    for (let p = 1; p <= 42; p++) {
      // Weighted so PCs and phones dominate, as on a real floor.
      const pick = [0, 0, 1, 0, 1, 3, 0, 1, 2, 0, 1, 3, 4][(p + s) % 13];
      const k = KINDS[pick];
      seq++;
      const id = `h${seq}`;
      const row = Math.floor((p - 1) / 12), col = (p - 1) % 12;
      nodes.push({ id, type: k.type, name: `${k.name}-${String(seq).padStart(3, '0')}`,
        x: 40 + (s - 1) * 1000 + col * 80, y: 680 + row * 110,
        allowedPorts: k.ports, assetTag: seq % 3 === 0 ? `CS-${String(1000 + seq)}` : undefined,
        interfaces: [{ id: 'i1', name: 'eth0', ip: hostIp(k.net), mac: mac(2, seq) }] });
      link(`sw${s}`, id, `p${p + 2}`, 'i1', seq % 4 === 0 ? { cable: { label: `D${s}-${String(p).padStart(2, '0')}` } } : undefined);
    }
  }
  // Laptops on the access points, by radio.
  for (let w = 1; w <= 33; w++) {
    seq++;
    const a = 1 + (w % 4);
    nodes.push({ id: `h${seq}`, type: 'pc', name: `LAPTOP-${String(w).padStart(2, '0')}`,
      x: 440 + (a - 1) * 1500 + (Math.floor((w - 1) / 4) % 5) * 80, y: 1440 + Math.floor((w - 1) / 20) * 100,
      interfaces: [{ id: 'i1', name: 'wlan0', ip: hostIp(4), mac: mac(3, w), wireless: true }] });
    link(`ap${a}`, `h${seq}`, 'w1', 'i1', { medium: 'wireless' });
  }

  // Faults a real site has. Two addresses held twice, one MAC on two boxes,
  // a gateway outside its device's subnet, a retired PC whose address went
  // to its replacement (not a conflict), and a loop accepted on purpose.
  const host = (n) => nodes.find((x) => x.id === `h${n}`);
  host(7).interfaces[0].ip = host(3).interfaces[0].ip;
  host(40).interfaces[0].ip = host(12).interfaces[0].ip;
  host(100).interfaces[0].mac = host(101).interfaces[0].mac;
  host(150).gw = '10.99.0.1';
  host(200).status = 'retired';
  host(201).interfaces[0].ip = host(200).interfaces[0].ip;
  const ring1 = link('sw5', 'sw6', 'p45', 'p45', { cable: { label: 'LAB-LOOP' } });
  const ring2 = link('sw6', 'core', 'p46', 'p7');

  const doc = { v: 6, nodes, links, networks,
    // The ring's two closing cables, each its own loop finding.
    accepted: [{ check: 'loop', nodeIds: ['sw5', 'sw6'], linkIds: [ring1], reason: 'Lab ring, STP on' },
      { check: 'loop', nodeIds: ['sw6', 'core'], linkIds: [ring2], reason: 'Lab ring, STP on' }],
    report: { site: 'Site 300', client: 'Perf fixture' } };
  // JSON round trip: drops the undefined assetTags so the document looks like
  // one read from a file.
  return JSON.parse(JSON.stringify(doc));
};
