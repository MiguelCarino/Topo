// A 400-device, 600-cable site, built the same way every time, for
// tests/suites/perfedit.js (what a click, a keystroke, a search, a table tab,
// a rack and an undo cost at scale). Load it into the page, then
// replaceDocument(topoSite400(), { origin: 'file' }).
//
// A router with a leg on each of four networks, two managed cores (an address
// each, so the loop check does not count them as dumb), twelve 48-port access
// switches in two racks with two to four parallel uplinks each and a patch
// ring between them, fifteen servers (three of them hosts with two VMs each,
// every server on both cores), thirty APs, and PCs, phones and printers on
// the access switches. The rest of the 600 cables are second runs to
// workstations (an eth1 with no address), access ports first, then the cores.
// Ten groups (a building, two floors, three rooms, a server area, a wing, two
// racks), two Wi-Fi networks, and a few faults: one address held twice, one
// gateway outside its subnet, and the patch ring's closing cable as an
// accepted loop.
//
// Deterministic: a seeded LCG, no Math.random, no Date.
window.topoSite400 = function topoSite400() {
  let seed = 400;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const nodes = [], links = [];
  const byId = new Map();
  const add = (n) => { nodes.push(n); byId.set(n.id, n); return n; };
  let linkSeq = 0;
  const link = (source, target, sourceIface, targetIface, extra) => {
    const id = `C${++linkSeq}`;
    links.push(Object.assign({ id, source, target, sourceIface, targetIface }, extra || {}));
    return id;
  };
  const hex = (n) => n.toString(16).padStart(2, '0');
  const mac = (a, b) => `52:54:01:${hex(a)}:${hex(b >> 8)}:${hex(b & 255)}`;

  const networks = [
    { id: 'n-srv', cidr: '10.40.10.0/24', name: 'Servers', vlan: 10, gateway: '10.40.10.1', dns: '10.40.10.10' },
    { id: 'n-usr', cidr: '10.40.20.0/22', name: 'Staff', vlan: 20, gateway: '10.40.20.1', dns: '10.40.10.10' },
    { id: 'n-voip', cidr: '10.40.30.0/24', name: 'Voice', vlan: 30, gateway: '10.40.30.1', dns: '10.40.10.10' },
    { id: 'n-wifi', cidr: '10.40.50.0/24', name: 'Wi-Fi', vlan: 50, gateway: '10.40.50.1', dns: '10.40.10.10' }
  ];
  const next = networks.map(() => 20);
  const ipOn = (k) => {
    const n = networks[k];
    const base = n.cidr.split('/')[0].split('.').map(Number);
    const h = next[k]++;
    return `${base[0]}.${base[1]}.${base[2] + (h >> 8)}.${h & 255}/${n.cidr.split('/')[1]}`;
  };

  // Free ports per switch, lowest first.
  const used = new Map();
  const freePort = (sw, top) => {
    const taken = used.get(sw) || new Set();
    used.set(sw, taken);
    for (let p = 1; p <= (top || 48); p++) if (!taken.has(p)) { taken.add(p); return `p${p}`; }
    return null;
  };
  const take = (sw, p) => { const s = used.get(sw) || new Set(); s.add(p); used.set(sw, s); return `p${p}`; };

  add({ id: 'rt', type: 'router', name: 'RT-1', x: 2400, y: 40, assetTag: 'S4-0001',
    interfaces: networks.map((n, i) => ({ id: `i${i + 1}`, name: `vlan${n.vlan}`, ip: `${n.gateway}/${n.cidr.split('/')[1]}`, mac: mac(1, i + 1) })) });
  ['core1', 'core2'].forEach((id, i) => add({ id, type: 'switch', name: `SW-CORE-${i + 1}`, x: 2000 + i * 800, y: 200, portCount: 48,
    portScheme: { prefix: 'Te1/0/', start: 1 }, assetTag: `S4-00${10 + i}`, gw: '10.40.10.1',
    interfaces: [{ id: 'm1', name: 'mgmt', ip: `10.40.10.${2 + i}/24`, mac: mac(1, 20 + i) }] }));
  link('rt', 'core1', 'i1', take('core1', 48), { cable: { label: 'RT-10' } });
  link('rt', 'core1', 'i2', take('core1', 47), { cable: { label: 'RT-20' } });
  link('rt', 'core2', 'i3', take('core2', 48), { cable: { label: 'RT-30' } });
  link('rt', 'core2', 'i4', take('core2', 47), { cable: { label: 'RT-50' } });
  link('core1', 'core2', take('core1', 46), take('core2', 46), { cable: { label: 'ISL-1' } });
  link('core1', 'core2', take('core1', 45), take('core2', 45), { cable: { label: 'ISL-2' } });

  const ACCESS = 12;
  for (let s = 1; s <= ACCESS; s++) {
    const id = `acc${s}`;
    add({ id, type: 'switch', name: `SW-ACC-${String(s).padStart(2, '0')}`, x: 200 + (s - 1) * 400, y: 420, portCount: 48,
      portScheme: { prefix: 'Gi1/0/', start: 1 }, assetTag: `S4-0${100 + s}`,
      portAttrs: { p1: { label: `Desk ${s}-01`, vlan: 20 }, p2: { label: `Desk ${s}-02`, vlan: 20 } }, interfaces: [] });
    // Two to four parallel uplinks, all to one core, on the top ports.
    const core = s % 2 ? 'core1' : 'core2';
    const ups = 2 + (s % 3);
    for (let u = 0; u < ups; u++) link(id, core, take(id, 48 - u), freePort(core), { cable: { label: `UP-${s}-${u + 1}`, length: '40 m' } });
  }
  // The patch ring between neighbours (p43 to the next, p44 from the last);
  // its closing cable is the accepted loop.
  let ringClose = null;
  for (let s = 1; s <= ACCESS; s++) {
    const nx = s === ACCESS ? 1 : s + 1;
    const id = link(`acc${s}`, `acc${nx}`, take(`acc${s}`, 43), take(`acc${nx}`, 44), { cable: { label: `PATCH-${s}`, color: 'yellow' } });
    if (s === ACCESS) ringClose = id;
  }

  // Servers, on both cores; the first three host two VMs each; the first is
  // the DNS server every network hands out.
  for (let v = 1; v <= 15; v++) {
    const id = `srv${v}`;
    add({ id, type: 'server', name: `SRV-${String(v).padStart(2, '0')}`, x: 1800 + ((v - 1) % 5) * 160, y: 80 + Math.floor((v - 1) / 5) * 110,
      allowedPorts: v === 1 ? '53' : '22, 443', os: v % 2 ? 'Debian 12' : 'Windows Server 2022', assetTag: `S4-0${200 + v}`,
      interfaces: [{ id: 'i1', name: 'eth0', ip: v === 1 ? '10.40.10.10/24' : ipOn(0), mac: mac(2, v) }, { id: 'i2', name: 'eth1', ip: '', mac: mac(2, 100 + v) }] });
    link('core1', id, freePort('core1'), 'i1', { cable: { label: `SRV-${v}A` } });
    link('core2', id, freePort('core2'), 'i2', { cable: { label: `SRV-${v}B` } });
  }
  for (let h = 1; h <= 3; h++) for (let k = 1; k <= 2; k++) {
    const id = `vm${(h - 1) * 2 + k}`;
    add({ id, type: 'vm', name: `VM-${h}${k}`, host: `srv${h}`, x: 1800 + (h - 1) * 160, y: 400 + k * 60,
      interfaces: [{ id: 'i1', name: 'eth0', ip: ipOn(0), mac: mac(3, (h - 1) * 2 + k) }] });
  }

  // Access points, on the access switches.
  for (let a = 1; a <= 30; a++) {
    const sw = `acc${1 + ((a - 1) % ACCESS)}`;
    const id = `ap${a}`;
    add({ id, type: 'ap', name: `AP-${String(a).padStart(2, '0')}`, x: 200 + ((a - 1) % 15) * 320, y: 2200 + Math.floor((a - 1) / 15) * 120,
      interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] });
    link(sw, id, freePort(sw), 'p1');
  }

  // Desks: PCs, phones and printers, to a free port on a switch picked by the LCG.
  const KINDS = [
    { type: 'pc', name: 'PC', net: 1, ports: '' },
    { type: 'voip', name: 'PHONE', net: 2, ports: '5060' },
    { type: 'printer', name: 'PRN', net: 1, ports: '9100' }
  ];
  const DESKS = 400 - nodes.length;
  const desks = [];
  for (let d = 1; d <= DESKS; d++) {
    const r = rnd();
    const k = KINDS[r < 0.6 ? 0 : r < 0.87 ? 1 : 2];
    let s = 1 + Math.floor(rnd() * ACCESS), port = null, sw = null;
    for (let tries = 0; tries < ACCESS && !port; tries++, s = s % ACCESS + 1) { sw = `acc${s}`; port = freePort(sw, 42); }
    const id = `h${d}`;
    add({ id, type: k.type, name: `${k.name}-${String(d).padStart(3, '0')}`,
      x: 40 + ((d - 1) % 40) * 120, y: 640 + Math.floor((d - 1) / 40) * 150,
      allowedPorts: k.ports, assetTag: d % 3 === 0 ? `S4-${1000 + d}` : undefined,
      interfaces: [{ id: 'i1', name: 'eth0', ip: ipOn(k.net), mac: mac(4, d) }] });
    link(sw, id, port, 'i1', d % 4 === 0 ? { cable: { label: `D-${String(d).padStart(3, '0')}` } } : undefined);
    if (k.type === 'pc') desks.push(id);
  }
  // Second runs to workstations until there are 600 cables: access ports
  // first, then the cores.
  const pool = ['core1', 'core2'];
  for (let i = 0; links.length < 600 && i < desks.length; i++) {
    const id = desks[i];
    let sw = null, port = null;
    for (let s = 1; s <= ACCESS && !port; s++) { sw = `acc${s}`; port = freePort(sw, 42); }
    for (let c = 0; c < pool.length && !port; c++) { sw = pool[c]; port = freePort(sw); }
    if (!port) break;
    byId.get(id).interfaces.push({ id: 'i2', name: 'eth1', ip: '' });
    link(sw, id, port, 'i2', { cable: { label: `X-${i + 1}` } });
  }

  // The faults.
  byId.get('h7').interfaces[0].ip = byId.get('h3').interfaces[0].ip;
  byId.get('h150').gw = '10.99.0.1';

  // Ten groups, two of them racks.
  const groups = [
    { id: 'g-hq', name: 'HQ', kind: 'building' },
    { id: 'g-fl1', name: 'Floor 1', kind: 'floor', parent: 'g-hq' },
    { id: 'g-fl2', name: 'Floor 2', kind: 'floor', parent: 'g-hq' },
    { id: 'g-mdf', name: 'MDF', kind: 'room', parent: 'g-fl1' },
    { id: 'g-idf', name: 'IDF', kind: 'room', parent: 'g-fl2' },
    { id: 'g-ra', name: 'Rack A', kind: 'rack', parent: 'g-mdf', uHeight: 42, width: '19in' },
    { id: 'g-rb', name: 'Rack B', kind: 'rack', parent: 'g-idf', uHeight: 42, width: '19in' },
    { id: 'g-srv', name: 'Servers', kind: 'custom', parent: 'g-mdf' },
    { id: 'g-east', name: 'East wing', kind: 'room', parent: 'g-fl1' },
    { id: 'g-west', name: 'West wing', kind: 'room', parent: 'g-fl2' }
  ];
  const place = (id, group, extra) => Object.assign(byId.get(id), { group }, extra || {});
  place('rt', 'g-ra', { rackU: 42, rackFace: 'front' });
  place('core1', 'g-ra', { rackU: 41, rackFace: 'front' });
  place('core2', 'g-ra', { rackU: 40, rackFace: 'front' });
  for (let s = 1; s <= ACCESS; s++) place(`acc${s}`, s <= 6 ? 'g-ra' : 'g-rb', { rackU: 36 - ((s - 1) % 6) * 2, rackFace: 'front' });
  for (let v = 1; v <= 15; v++) place(`srv${v}`, 'g-srv');
  for (let d = 1; d <= DESKS; d++) place(`h${d}`, d % 2 ? 'g-east' : 'g-west');

  const doc = { v: 14, nodes, links, networks, groups,
    wifi: [{ id: 'wf-staff', ssid: 'Staff', security: 'wpa3', network: '10.40.50.0/24' },
      { id: 'wf-guest', ssid: 'Guest', security: 'wpa2' }],
    accepted: [{ check: 'loop', nodeIds: [`acc${ACCESS}`, 'acc1'], linkIds: [ringClose], reason: 'Patch ring, STP on' }],
    report: { site: 'Site 400', client: 'Perf fixture' } };
  return JSON.parse(JSON.stringify(doc));
};
