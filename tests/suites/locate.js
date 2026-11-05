// Locate stage 1 (docs/BACKLOG.md, feature 1, landing order step 3): the pure
// core, locatePath(node, {nodes, links, groups}) in js/model.js, built on the
// shared uplinkOf. Nothing visible yet, so everything here is the answer
// itself. What is held:
//   1. a server in a rack: its NIC, the cable's tag, colour, length and via
//      (byte for byte, never trimmed or split), the switch port by its
//      scheme, the jack and VLAN from portAttrs, the rack's units and the
//      whole group chain; a bonded server's two cables two legs, the uplinkOf
//      one first and the bond named; a dual-homed box the same; a VM and a
//      container climbing to the outermost host and taking its legs;
//   2. multi-hop: a PC behind an IP phone to the switch port; a laptop on
//      Wi-Fi to the AP, then over the AP's cable to the switch (band and SSID
//      as recorded); a mesh AP: a client of an AP that has only a radio link
//      to another AP stops with apUpstream, a mesh AP with a cable goes on
//      over the cable; an AP to AP link from the AP itself; two radio clients
//      radioUnknown, a laptop on a wireless router routing with no
//      radioUnknown (the router serves); a cable into a router or an
//      l3switch stopping there with no jack asked for; a loop, the depth cap
//      of 4, several cables onward, and nothing onward (noUplink);
//   2b. never a guessed direction, on small copies: an AP reached by radio
//      never walks down its cable to a device below it; a one-cable hop that
//      runs out at a dead end or a fork is taken back, one that reaches a
//      routing device stands; an AP on a router's radio (apUpstream), a
//      router's radio link to an AP (no leg of the router), an AP's cable
//      before its radio; a container on a VM with a cable of its own; a list
//      not given counting as empty;
//   2c. the bundled samples: Showcase (bonded NAS, container), Data Centre
//      (DB Master, a VM), Smart Home (TV over Wi-Fi to the AP, to the router);
//   3. every gap in turn: noCable, noPort (never read as port 1), noJack,
//      noVia, notGrouped with and without a typed location (the text as
//      typed), notPlaced, radioUnknown, apUpstream, retired (the start and a
//      hop; the walk goes on); VPN tunnels and a guest's link to its host
//      are no legs, and a switch's own downstream cables are not where it is
//      plugged in;
//   4. pure: the document form ({nodes, links, groups}, the open document's
//      lists swapped for a decoy) gives the same answer without reading the
//      open one; a lookup pass gives it too, kept per device; locating
//      changes nothing (document byte for byte, undo stack, save count);
//      a read-only newer file is located as well;
//   5. the uplinkOf agreement: on every bundled template the primary leg's
//      first hop is the devices sheet's switch/port (csvUplink forSheet), and
//      every device of every template locates without throwing;
//   6. scale, counted: locating every device of the 300-device fixture
//      inside a lookup pass walks the cable list a bounded number of times
//      (the time budget is in the perf suite).
window.addEventListener('load', async () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);
  const json = (v) => JSON.stringify(v);
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
  const NIC = (...names) => names.map((name, k) => ({ id: `e${k + 1}`, name, ip: '' }));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: NIC('eth0') }, extra);
  const L = (id, source, sourceIface, target, targetIface, extra = {}) => Object.assign({ id, source, target, sourceIface, targetIface }, extra);
  const VIA = '  PP-A:12 > WJ-3B ';
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('sw1', 'switch', { name: 'SW-1', group: 'rk', rackU: 40, interfaces: [], portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 },
        portAttrs: { p1: { label: 'Patch 1', vlan: 10 }, p3: { label: 'Reception 2', vlan: 20 }, p6: { label: 'Desk 6' }, p8: { label: 'Rack B' } } }),
      N('sw2', 'switch', { name: 'SW-2', group: 'rk2', interfaces: [], portCount: 8 }),
      N('sw3', 'switch', { name: 'SW-3', interfaces: [], location: '  Closet B ' }),
      N('sw4', 'switch', { name: 'SW-4', interfaces: [] }),
      N('srv', 'server', { name: 'SRV', group: 'rk', rackU: 10, rackHeight: 2,
        interfaces: [...NIC('eno1', 'eno2'), { id: 'b0', name: 'bond0', ip: '10.0.0.5/24', bond: { mode: '802.3ad', members: ['e1', 'e2'] } }] }),
      N('vm1', 'vm', { name: 'VM-1', host: 'srv', interfaces: [{ id: 'v1', name: 'eth0', ip: '' }] }),
      N('ct1', 'container', { name: 'CT-1', host: 'vm1', interfaces: [{ id: 'c1', name: 'eth0', ip: '' }] }),
      N('dh', 'server', { name: 'DH', group: 'rk', rackU: 20, interfaces: NIC('eth0', 'eth1') }),
      N('pc', 'pc', { name: 'PC-12', group: 'off' }),
      N('ph', 'voip', { name: 'Phone 12', group: 'off', interfaces: NIC('pc', 'lan') }),
      N('lap', 'pc', { name: 'Laptop', group: 'off', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }),
      N('ap1', 'ap', { name: 'AP-1', group: 'off', interfaces: [] }),
      N('ap2', 'ap', { name: 'AP-Mesh', group: 'off', interfaces: [] }),
      N('ap3', 'ap', { name: 'AP-Wired-Mesh', group: 'off', interfaces: [] }),
      N('tab', 'pc', { name: 'Tablet', group: 'off', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }),
      N('tab2', 'pc', { name: 'Tablet 2', group: 'off', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }),
      N('ra', 'pc', { name: 'Radio A', group: 'off', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }),
      N('rb', 'pc', { name: 'Radio B', group: 'off', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }),
      N('rtr', 'router', { name: 'R1', group: 'off', interfaces: [...NIC('eth0', 'eth1'), { id: 'w1', name: 'wlan0', ip: '', wireless: true }] }),
      N('l3', 'l3switch', { name: 'L3', group: 'off', interfaces: NIC('ge1') }),
      N('lap2', 'pc', { name: 'Laptop 2', group: 'off', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }),
      N('nas', 'server', { name: 'NAS', group: 'off' }),
      N('l3c', 'pc', { name: 'L3 client', group: 'off' }),
      N('lone', 'pc', { name: 'Lone' }),
      N('rpc', 'pc', { name: 'Retired-hop PC', group: 'off' }),
      N('rph', 'voip', { name: 'Old phone', group: 'off', status: 'retired', interfaces: NIC('pc', 'lan') }),
      N('old', 'pc', { name: 'Old PC', group: 'off', status: 'retired' }),
      N('typ', 'pc', { name: 'Typed', group: 'off' }),
      N('ung', 'pc', { name: 'Ungrouped far', group: 'off' }),
      N('np', 'pc', { name: 'No port', group: 'off' }),
      N('vp', 'pc', { name: 'VPN only', group: 'off' }),
      N('x1', 'pc', { name: 'X1', group: 'off', interfaces: NIC('a', 'b') }),
      N('x2', 'pc', { name: 'X2', group: 'off', interfaces: NIC('a', 'b') }),
      N('x3', 'pc', { name: 'X3', group: 'off', interfaces: NIC('a', 'b') }),
      ...[1, 2, 3, 4, 5, 6].map((k) => N(`d${k}`, 'pc', { name: `D${k}`, group: 'off', interfaces: NIC('a', 'b') })),
      N('y1', 'pc', { name: 'Y1', group: 'off' }),
      N('y2', 'pc', { name: 'Y2', group: 'off', interfaces: NIC('a', 'b', 'c') }),
      N('y3', 'pc', { name: 'Y3', group: 'off' }),
      N('y4', 'pc', { name: 'Y4', group: 'off' }),
      N('z1', 'pc', { name: 'Z1', group: 'off' }),
      N('z2', 'iot', { name: 'Z2', group: 'off' })
    ],
    links: [
      L('c1', 'srv', 'e1', 'sw1', 'p1', { cable: { label: 'A-01', color: 'blue', length: '2 m', via: VIA } }),
      L('c2', 'srv', 'e2', 'sw1', 'p2', { cable: { label: 'A-02' } }),
      L('c3', 'pc', 'e1', 'ph', 'e1', { cable: { via: 'desk' } }),
      L('c4', 'ph', 'e2', 'sw1', 'p3', { cable: { label: 'B-03', via: 'PP-B:3' } }),
      L('c5', 'lap', 'w1', 'ap1', null, { medium: 'wireless', wifi: { band: '5' } }),
      L('c6', 'ap1', 'p1', 'sw1', 'p4', { cable: { via: 'PP-C:4' } }),
      L('c7', 'ap1', null, 'ap2', null, { medium: 'wireless' }),
      L('c8', 'tab', 'w1', 'ap2', null, { medium: 'wireless' }),
      L('c9', 'ap3', null, 'ap1', null, { medium: 'wireless' }),
      L('c10', 'ap3', 'p1', 'sw2', null, { cable: { via: 'x' } }),
      L('c11', 'tab2', 'w1', 'ap3', null, { medium: 'wireless' }),
      L('c12', 'ra', 'w1', 'rb', 'w1', { medium: 'wireless' }),
      L('c13', 'lap2', 'w1', 'rtr', 'w1', { medium: 'wireless' }),
      L('c14', 'nas', 'e1', 'rtr', 'e2', { cable: { via: 'v' } }),
      L('c15', 'l3c', 'e1', 'l3', 'e1', { cable: { via: 'v' } }),
      L('c16', 'rpc', 'e1', 'rph', 'e1', { cable: { via: 'v' } }),
      L('c17', 'rph', 'e2', 'sw1', 'p6', { cable: { via: 'v' } }),
      L('c18', 'old', 'e1', 'sw1', 'p7', { cable: { via: 'v' } }),
      L('c19', 'typ', 'e1', 'sw3', 'p1', { cable: { via: 'v' } }),
      L('c20', 'ung', 'e1', 'sw4', 'p1', { cable: { via: 'v' } }),
      L('c21', 'np', 'e1', 'sw2', null, { cable: { via: 'v' } }),
      L('c22', 'vp', 'e1', 'rtr', 'e1', { medium: 'vpn' }),
      L('c23', 'x1', 'e1', 'x2', 'e1'), L('c24', 'x2', 'e2', 'x3', 'e1'), L('c25', 'x3', 'e2', 'x1', 'e2'),
      L('c26', 'd1', 'e1', 'd2', 'e1'), L('c27', 'd2', 'e2', 'd3', 'e1'), L('c28', 'd3', 'e2', 'd4', 'e1'),
      L('c29', 'd4', 'e2', 'd5', 'e1'), L('c30', 'd5', 'e2', 'd6', 'e1'),
      L('c31', 'y1', 'e1', 'y2', 'e1'), L('c32', 'y2', 'e2', 'y3', 'e1'), L('c33', 'y2', 'e3', 'y4', 'e1'),
      L('c34', 'dh', 'e2', 'sw2', 'p2', { cable: { via: 'v' } }),
      L('c35', 'dh', 'e1', 'sw1', 'p8', { cable: { via: 'v' } }),
      L('c36', 'vm1', 'v1', 'srv', 'e1', { attachment: 'bridged' }),
      L('c37', 'z1', 'e1', 'z2', 'e1')
    ],
    groups: [{ id: 'bld', name: 'HQ', kind: 'building' }, { id: 'fl', name: 'Floor 2', kind: 'floor', parent: 'bld' },
      { id: 'room', name: 'Server room', kind: 'room', parent: 'fl' }, { id: 'rk', name: 'Rack S', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'rk2', name: 'Rack T', kind: 'rack', parent: 'room', uHeight: 24 }, { id: 'off', name: 'Office', kind: 'room', parent: 'fl' }] });
  const byIdNow = (id) => state.nodes.find((n) => n.id === id);
  const loc = (id) => locatePath(byIdNow(id));
  const codes = (r) => r.gaps.map((g) => g.code);
  const has = (r, code, nodeId, leg) => r.gaps.some((g) => g.code === code && (!nodeId || g.node.id === nodeId) && (leg === undefined || g.leg === leg));
  const farIds = (leg) => leg.hops.map((h) => h.far.id).join('>');
  const stopOf = (leg) => (leg.stop ? `${leg.stop.reason}@${leg.stop.node.id}` : '-');
  // A signature of the whole answer, by ids, for comparing two ways of asking.
  const sig = (r) => json({ s: r.start && [r.start.node.id, r.start.hosts.map((h) => h.id), r.start.place.groups.map((g) => g.id), r.start.place.units, r.start.retired],
    l: r.legs.map((l) => [l.primary, stopOf(l), l.hops.map((h) => [h.from.id, h.nic, h.bond, h.link.id, h.cable, h.far.id, h.farPort, h.farPortId, h.jack, h.vlan, h.overflow, h.medium,
      h.wifi && [h.wifi.ssid, h.wifi.band, h.wifi.signal], h.place.groups.map((g) => g.id), h.place.rack && h.place.rack.id, h.place.units, h.place.location, h.retired])]),
    g: r.gaps.map((g) => [g.code, g.leg, g.hop, g.node.id, g.link && g.link.id, g.portId, g.text]) });

  try {
    replaceDocument(site(), { origin: 'file', docId: 'locate' });
    initHistory();

    // ---- 1. A server in a rack, a bond, dual-homed, guests ----
    {
      const r = loc('srv');
      const h = r.legs[0] && r.legs[0].hops[0];
      ok('a bonded server gives a leg per cable, the uplinkOf one (SW-1 port 1) first',
        r.legs.length === 2 && r.legs[0].primary && !r.legs[1].primary && h.link.id === 'c1' && r.legs[1].hops[0].link.id === 'c2', r.legs.map((l) => l.hops[0].link.id).join());
      ok('the leg: NIC, bond, cable tag/colour/length, switch port by its scheme, jack and VLAN',
        h.from.id === 'srv' && h.nic === 'eno1' && h.bond === 'bond0' && h.cable.tag === 'A-01' && h.cable.color === 'blue' && h.cable.length === '2 m'
        && h.far.id === 'sw1' && h.farPort === 'Gi1/0/1' && h.farPortId === 'p1' && h.jack === 'Patch 1' && h.vlan === 10 && h.medium === 'utp' && h.wifi === null,
        json([h.nic, h.bond, h.cable, h.farPort, h.jack, h.vlan, h.medium]));
      ok('the via is byte for byte as typed (spaces kept, never split)', h.cable.via === VIA, json(h.cable.via));
      ok('the switch\'s place: rack units and the whole group chain, outermost first',
        h.place.units === rackSpanText(byIdNow('sw1')) && h.place.units !== '' && h.place.rack && h.place.rack.id === 'rk'
        && h.place.groups.map((g) => g.id).join('/') === 'bld/fl/room/rk', json([h.place.units, h.place.groups.map((g) => g.id)]));
      ok('it stops at the switch, reached by a cable', stopOf(r.legs[0]) === 'faceplate@sw1' && stopOf(r.legs[1]) === 'faceplate@sw1');
      ok('the start: the device, its place (units and groups), no hosts',
        r.start.node.id === 'srv' && r.start.hosts.length === 0 && r.start.place.units === rackSpanText(byIdNow('srv')) && r.start.place.groups.length === 4);
      ok('the second cable has no via and no jack: two gaps, the first cable none',
        has(r, 'noVia', 'sw1', 1) && has(r, 'noJack', 'sw1', 1) && !r.gaps.some((g) => g.leg === 0), json(codes(r)));
      ok('the VM\'s bridged link to its own host is no leg', !r.legs.some((l) => l.hops[0].link.id === 'c36'));
    }
    {
      const r = loc('dh');
      ok('a dual-homed box: two legs, the one onto the lowest-named switch first whatever the document order',
        r.legs.length === 2 && r.legs[0].hops[0].far.id === 'sw1' && r.legs[0].hops[0].farPort === 'Gi1/0/8' && r.legs[1].hops[0].far.id === 'sw2'
        && r.legs[1].hops[0].farPort === '2', r.legs.map((l) => `${l.hops[0].far.id}:${l.hops[0].farPort}`).join());
      ok('and a switch in a rack with no unit is notPlaced', has(r, 'notPlaced', 'sw2', 1) && !has(r, 'notPlaced', 'sw1'), json(codes(r)));
    }
    {
      const vm = loc('vm1'), ct = loc('ct1'), srv = loc('srv');
      ok('a VM: runs on its host, then the host\'s legs', vm.start.hosts.map((h) => h.id).join() === 'srv' && vm.legs.length === 2
        && vm.legs.every((l, i) => l.hops[0].from.id === 'srv' && l.hops[0].link.id === srv.legs[i].hops[0].link.id), vm.legs.map((l) => l.hops[0].link.id).join());
      ok('a container climbs to the outermost host (VM, then server)', ct.start.hosts.map((h) => h.id).join() === 'vm1,srv'
        && ct.legs.length === 2 && ct.legs[0].primary && ct.legs[0].hops[0].far.id === 'sw1', ct.start.hosts.map((h) => h.id).join());
      ok('and its place is the outermost host\'s, its own host named', ct.start.place.units === rackSpanText(byIdNow('srv')) && ct.start.place.host.id === 'srv'
        && ct.start.place.groups.map((g) => g.id).join('/') === 'bld/fl/room/rk');
      ok('a guest with no cable of its own has no noCable gap (its host has cables)', !has(vm, 'noCable') && !has(ct, 'noCable'), json(codes(ct)));
    }

    // ---- 2. Multi-hop ----
    {
      const r = loc('pc');
      ok('a PC behind an IP phone: PC to phone to the switch port', r.legs.length === 1 && farIds(r.legs[0]) === 'ph>sw1' && stopOf(r.legs[0]) === 'faceplate@sw1',
        farIds(r.legs[0]) + ' ' + stopOf(r.legs[0]));
      const [a, b] = r.legs[0].hops;
      ok('each hop names its own ends: PC eth0 > phone pc, phone lan > Gi1/0/3 (Reception 2, VLAN 20)',
        a.nic === 'eth0' && a.farPort === 'pc' && a.jack === '' && b.from.id === 'ph' && b.nic === 'lan' && b.farPort === 'Gi1/0/3' && b.jack === 'Reception 2' && b.vlan === 20,
        json([a.nic, a.farPort, b.nic, b.farPort, b.jack, b.vlan]));
      ok('no jack is asked of a phone (no faceplate)', !r.gaps.some((g) => g.code === 'noJack'), json(codes(r)));
    }
    {
      const r = loc('lap');
      const [a, b] = r.legs[0].hops;
      ok('a laptop on Wi-Fi: to the AP by radio, then the AP\'s cable to the switch port',
        r.legs.length === 1 && farIds(r.legs[0]) === 'ap1>sw1' && stopOf(r.legs[0]) === 'faceplate@sw1' && a.medium === 'wireless' && b.medium === 'utp'
        && b.from.id === 'ap1' && b.farPort === 'Gi1/0/4', farIds(r.legs[0]) + ' ' + stopOf(r.legs[0]));
      ok('the radio hop carries the band as recorded, no port asked at the AP and no via', a.wifi && a.wifi.band === '5' && !a.wifi.bandInferred
        && !r.gaps.some((g) => g.hop === 0 && ['noPort', 'noJack', 'noVia'].includes(g.code)), json([a.wifi, codes(r)]));
      ok('never on by radio from the AP: its mesh link to AP-Mesh is not followed', !r.legs[0].hops.some((h) => h.far.id === 'ap2'));
      ok('the AP\'s port with no label is noJack', has(r, 'noJack', 'sw1', 0) && r.gaps.find((g) => g.code === 'noJack').portId === 'p4');
    }
    {
      const r = loc('tab');
      ok('a client of a mesh AP with only a radio link to another AP: apUpstream, stop',
        farIds(r.legs[0]) === 'ap2' && stopOf(r.legs[0]) === 'apUpstream@ap2' && has(r, 'apUpstream', 'ap2', 0), farIds(r.legs[0]) + ' ' + stopOf(r.legs[0]) + ' ' + json(codes(r)));
      const m = loc('ap2');
      ok('the mesh AP itself: an AP to AP leg stops with apUpstream (which side is upstream is not recorded)',
        m.legs.length === 1 && farIds(m.legs[0]) === 'ap1' && stopOf(m.legs[0]) === 'apUpstream@ap1' && has(m, 'apUpstream', 'ap1'), farIds(m.legs[0]) + ' ' + stopOf(m.legs[0]));
      const w = loc('tab2');
      ok('a mesh AP with a cable goes on over the cable only (to SW-2, no port: noPort)',
        farIds(w.legs[0]) === 'ap3>sw2' && stopOf(w.legs[0]) === 'faceplate@sw2' && has(w, 'noPort', 'sw2', 0) && !has(w, 'apUpstream'), farIds(w.legs[0]) + ' ' + json(codes(w)));
      const a1 = loc('ap1');
      ok('an AP\'s own legs: its cable first (a wired uplink, though AP-Mesh sorts before SW-1), then the mesh links; its Wi-Fi clients are not legs',
        a1.legs.map((l) => l.hops[0].link.id).join() === 'c6,c7,c9' && stopOf(a1.legs[0]) === 'faceplate@sw1' && !a1.legs.some((l) => ['lap', 'tab', 'tab2'].includes(l.hops[0].far.id)), a1.legs.map((l) => l.hops[0].link.id).join());
    }
    {
      const r = loc('ra');
      ok('two radio clients: radioUnknown and stop', r.legs.length === 1 && stopOf(r.legs[0]) === 'radioUnknown@rb' && has(r, 'radioUnknown', 'rb', 0), json(codes(r)));
      const w = loc('lap2');
      ok('a laptop on a wireless router: the router serves, it stops there as routing, no radioUnknown',
        stopOf(w.legs[0]) === 'routing@rtr' && !has(w, 'radioUnknown'), stopOf(w.legs[0]) + ' ' + json(codes(w)));
      const n = loc('nas');
      ok('a cable into a router: plugged into R1 · eth1, stops as routing, no jack asked',
        n.legs[0].hops[0].farPort === 'eth1' && stopOf(n.legs[0]) === 'routing@rtr' && !has(n, 'noJack') && !has(n, 'noPort'), json([n.legs[0].hops[0].farPort, codes(n)]));
      const l = loc('l3c');
      ok('a cable into an l3switch stops there as a routing device (hasPortGrid is switch or AP only)', stopOf(l.legs[0]) === 'routing@l3' && !has(l, 'noJack'), stopOf(l.legs[0]));
    }
    {
      const x = loc('x1');
      ok('a loop of non-switch devices stops on the device already visited', x.legs.length === 2 && x.legs.every((l) => l.stop.reason === 'loop' && l.stop.node.id === 'x1')
        && farIds(x.legs[0]) === 'x2>x3', x.legs.map((l) => farIds(l) + ' ' + stopOf(l)).join(' | '));
      const d = loc('d1');
      ok('the depth cap: four cables walked, then it stops and says so', d.legs[0].hops.length === 4 && stopOf(d.legs[0]) === 'depth@d5', farIds(d.legs[0]) + ' ' + stopOf(d.legs[0]));
      const d5 = loc('d5');
      ok('a chain of one-cable hops that runs out at a dead end went down, not up: taken back to the first device, noUplink there',
        farIds(d5.legs[0]) === 'd4' && stopOf(d5.legs[0]) === 'end@d4' && has(d5, 'noUplink', 'd4', 0) && !d5.gaps.some((g) => ['d3', 'd2', 'd1'].includes(g.node.id)) && !has(d5, 'noCable'),
        d5.legs.map((l) => farIds(l) + ' ' + stopOf(l)).join(' | ') + ' ' + json(codes(d5)));
      const y = loc('y1');
      ok('several cables onward and none onto a faceplate: it stops rather than picking one', farIds(y.legs[0]) === 'y2' && stopOf(y.legs[0]) === 'several@y2', farIds(y.legs[0]) + ' ' + stopOf(y.legs[0]));
      const z = loc('z1');
      ok('nothing recorded onward: end, with a noUplink gap at that device (it has a cable, so never noCable)', stopOf(z.legs[0]) === 'end@z2' && has(z, 'noUplink', 'z2', 0) && !has(z, 'noCable'), json(codes(z)));
      const ph = loc('ph');
      const down = ph.legs.find((l) => l.hops[0].far.id === 'pc');
      ok('a phone\'s cable to the PC behind it: end at the PC with noUplink, no noCable for a PC that has a cable',
        !!down && stopOf(down) === 'end@pc' && has(ph, 'noUplink', 'pc') && !has(ph, 'noCable') && ph.legs[0].hops[0].far.id === 'sw1', json(codes(ph)));
    }

    // ---- 2b. What the walk must never claim (each a small copy, the document form) ----
    {
      const mini = (nodes, links, groups = []) => ({ nodes, links, groups });
      const at = (doc, id) => locatePath(doc.nodes.find((n) => n.id === id), doc);
      const WL = (id) => N(id, 'pc', { interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] });
      // An AP reached by radio whose only cable goes down to a camera.
      const cam = mini([WL('lap'), N('ap', 'ap', { interfaces: [] }), N('cam', 'camera')],
        [L('r', 'lap', 'w1', 'ap', null, { medium: 'wireless' }), L('w', 'ap', 'p2', 'cam', 'e1', { medium: 'utp' })]);
      const a = at(cam, 'lap');
      ok('a laptop on an AP whose only cable goes to a camera below it: it stops at the AP, never walks down to the camera',
        farIds(a.legs[0]) === 'ap' && stopOf(a.legs[0]) === 'end@ap' && has(a, 'noUplink', 'ap', 0) && !has(a, 'noCable') && !a.gaps.some((g) => g.node.id === 'cam'),
        farIds(a.legs[0]) + ' ' + stopOf(a.legs[0]) + ' ' + json(codes(a)));
      // The same when the device below the AP has a cable of its own to a switch:
      // still not the AP's way up.
      const below = mini([WL('lap'), N('ap', 'ap', { interfaces: [] }), N('pcx', 'pc', { interfaces: NIC('a', 'b') }), N('sw', 'switch', { interfaces: [] })],
        [L('r', 'lap', 'w1', 'ap', null, { medium: 'wireless' }), L('w', 'ap', 'p2', 'pcx', 'e1', { medium: 'utp' }), L('u', 'pcx', 'e2', 'sw', 'p9')]);
      const b = at(below, 'lap');
      ok('an AP reached by radio never walks down its cable to a PC, even one cabled on to a switch',
        farIds(b.legs[0]) === 'ap' && stopOf(b.legs[0]) === 'end@ap' && has(b, 'noUplink', 'ap', 0), farIds(b.legs[0]) + ' ' + stopOf(b.legs[0]));
      const ac = at(cam, 'ap');
      ok('and that AP\'s own cable to the camera is no leg of the AP (noUplink, not noCable)', ac.legs.length === 0 && json(codes(ac)) === json(['noUplink']), json(codes(ac)));
      // An AP on a home router's radio, nothing cabled.
      const rr = mini([WL('lap'), N('ap', 'ap', { interfaces: [] }), N('rtr', 'router', { interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }, ...NIC('eth1')] }),
        N('sw', 'switch', { interfaces: [] })],
        [L('r', 'lap', 'w1', 'ap', null, { medium: 'wireless' }), L('m', 'ap', null, 'rtr', 'w1', { medium: 'wireless' })]);
      const ap = at(rr, 'ap');
      ok('an AP on a router\'s radio: the radio link is its leg, and it stops with apUpstream (never noCable)',
        ap.legs.length === 1 && farIds(ap.legs[0]) === 'rtr' && stopOf(ap.legs[0]) === 'apUpstream@rtr' && has(ap, 'apUpstream', 'rtr', 0) && !has(ap, 'noCable'),
        ap.legs.map((l) => farIds(l) + ' ' + stopOf(l)).join(' | ') + ' ' + json(codes(ap)));
      const lp = at(rr, 'lap');
      ok('a laptop on that AP: apUpstream at the AP, never noCable', stopOf(lp.legs[0]) === 'apUpstream@ap' && has(lp, 'apUpstream', 'ap', 0) && !has(lp, 'noCable'),
        stopOf(lp.legs[0]) + ' ' + json(codes(lp)));
      // A router's radio serving an AP that is cabled to a switch.
      const rs = mini(rr.nodes, [L('m', 'ap', null, 'rtr', 'w1', { medium: 'wireless' }), L('c', 'ap', 'p1', 'sw', 'p3', { medium: 'utp' })]);
      const rt = at(rs, 'rtr');
      ok('a router\'s radio link to an AP is no leg of the router (the AP is below it), so it is never "plugged in" at that AP\'s switch port',
        rt.legs.length === 0 && json(codes(rt)) === json(['noUplink']), rt.legs.map((l) => farIds(l)).join(' | ') + ' ' + json(codes(rt)));
      const apc = at(rs, 'ap');
      ok('that AP: its cable to the switch first, the router\'s radio after it', apc.legs.map((l) => l.hops[0].link.id).join() === 'c,m' && stopOf(apc.legs[0]) === 'faceplate@sw',
        apc.legs.map((l) => l.hops[0].link.id).join());
      // A PC behind a phone with a second PC behind it: no switch recorded.
      const dc = mini([N('pc1', 'pc'), N('ph', 'voip', { interfaces: NIC('pc', 'lan') }), N('pc2', 'pc')],
        [L('a', 'pc1', 'e1', 'ph', 'e1'), L('b', 'ph', 'e2', 'pc2', 'e1')]);
      const d = at(dc, 'pc1');
      ok('PC to phone to a second PC: the walk does not claim the phone is plugged into the second PC (taken back, noUplink at the phone)',
        farIds(d.legs[0]) === 'ph' && stopOf(d.legs[0]) === 'end@ph' && has(d, 'noUplink', 'ph', 0) && !d.gaps.some((g) => g.node.id === 'pc2'),
        farIds(d.legs[0]) + ' ' + stopOf(d.legs[0]) + ' ' + json(codes(d)));
      // The same through a device that forks: taken back too, not 'several'.
      const fk = mini([N('q1', 'pc'), N('q2', 'pc', { interfaces: NIC('a', 'b') }), N('q3', 'pc', { interfaces: NIC('a', 'b', 'c') }), N('q4', 'pc'), N('q5', 'pc')],
        [L('a', 'q1', 'e1', 'q2', 'e1'), L('b', 'q2', 'e2', 'q3', 'e1'), L('c', 'q3', 'e2', 'q4', 'e1'), L('d', 'q3', 'e3', 'q5', 'e1')]);
      const f = at(fk, 'q1');
      ok('a one-cable hop onto a fork is taken back as well', farIds(f.legs[0]) === 'q2' && stopOf(f.legs[0]) === 'end@q2' && has(f, 'noUplink', 'q2', 0),
        farIds(f.legs[0]) + ' ' + stopOf(f.legs[0]));
      // A one-cable hop that does get somewhere stands: a media converter pair.
      const mc = mini([N('pc', 'pc'), N('m1', 'custom', { interfaces: NIC('a', 'b') }), N('m2', 'custom', { interfaces: NIC('a', 'b') }), N('r', 'router', { interfaces: NIC('a', 'b') })],
        [L('a', 'pc', 'e1', 'm1', 'e1'), L('b', 'm1', 'e2', 'm2', 'e1'), L('c', 'm2', 'e2', 'r', 'e1')]);
      const m = at(mc, 'pc');
      ok('a one-cable hop that reaches a routing device stands (PC, two media converters, router)', farIds(m.legs[0]) === 'm1>m2>r' && stopOf(m.legs[0]) === 'routing@r',
        farIds(m.legs[0]) + ' ' + stopOf(m.legs[0]));
      // A container on a VM that has a cable of its own.
      const vc = mini([N('srv', 'server', { interfaces: NIC('eno1') }), N('vm', 'vm', { host: 'srv', interfaces: [{ id: 'v1', name: 'eth0', ip: '' }, { id: 'v2', name: 'pt0', ip: '' }] }),
        N('ct', 'container', { host: 'vm', interfaces: [{ id: 'c1', name: 'eth0', ip: '' }] }), N('sw', 'switch', { interfaces: [] }), N('sw2', 'switch', { interfaces: [] })],
        [L('h', 'srv', 'e1', 'sw', 'p1'), L('p', 'vm', 'v2', 'sw2', 'p5'), L('k', 'ct', 'c1', 'vm', 'v1', { attachment: 'bridged' })]);
      const c = at(vc, 'ct');
      ok('a container on a VM: the VM\'s own cable is a leg too, in order (VM, then server)', c.legs.map((l) => `${l.hops[0].from.id}:${l.hops[0].link.id}`).join() === 'vm:p,srv:h',
        c.legs.map((l) => `${l.hops[0].from.id}:${l.hops[0].link.id}`).join());
      // Only some lists given: the missing ones are empty, never the open document's.
      const held = state.groups;
      state.groups = [{ id: 'gx', name: 'Decoy room', kind: 'room' }];
      let part;
      try {
        const doc = mini([N('pc', 'pc', { group: 'gx' }), N('sw', 'switch', { group: 'gx', interfaces: [] })], [L('a', 'pc', 'e1', 'sw', 'p1', { cable: { via: 'v' } })]);
        part = locatePath(doc.nodes[0], { nodes: doc.nodes, links: doc.links });
      } finally { state.groups = held; }
      ok('given nodes and links but no groups, groups count as none (not the open document\'s)',
        part.start.place.groups.length === 0 && part.legs[0].hops[0].place.groups.length === 0 && has(part, 'notGrouped', 'sw', 0), json(codes(part)));
    }

    // ---- 2c. The bundled samples ----
    {
      replaceDocument(cloneData(templatesData.showcase), { origin: 'file' });
      const nas = loc('nas');
      ok('Showcase: the bonded NAS has a leg per cable, both bond0, onto Storage Switch ports 2 and 3',
        nas.legs.length === 2 && nas.legs.every((l) => l.hops.length === 1 && l.hops[0].bond === 'bond0' && l.hops[0].far.id === 'bsw' && stopOf(l) === 'faceplate@bsw')
        && nas.legs.map((l) => l.hops[0].farPort).join() === '2,3', nas.legs.map((l) => l.hops[0].farPort + '/' + l.hops[0].bond).join());
      const ctr = loc('ctr');
      ok('Showcase: the container climbs its hosts to the outermost one, and each leg starts at it or a host',
        ctr.start.hosts.length >= 1 && ctr.legs.length > 0 && ctr.legs.every((l) => l.hops[0].from.id === 'ctr' || ctr.start.hosts.includes(l.hops[0].from)),
        ctr.start.hosts.map((h) => h.id).join());
      const opc = loc('opc');
      ok('Showcase: the office PC on Wi-Fi to Office WiFi, then over the AP\'s cable to Core Distribution (routing)',
        farIds(opc.legs[0]) === 'oap>l3' && opc.legs[0].hops[0].medium === 'wireless' && stopOf(opc.legs[0]) === 'routing@l3', farIds(opc.legs[0]) + ' ' + stopOf(opc.legs[0]));
      replaceDocument(cloneData(templatesData.datacenter), { origin: 'file' });
      const db = loc('d13');
      ok('Data Centre: DB Master onto Storage Switch port 2, stopping there', db.legs.length === 1 && db.legs[0].hops[0].far.id === 'd12' && db.legs[0].hops[0].farPort === '2'
        && stopOf(db.legs[0]) === 'faceplate@d12', farIds(db.legs[0]) + ' ' + stopOf(db.legs[0]));
      const vm = loc('d6');
      ok('Data Centre: a VM runs on its host and is located', vm.start.hosts.length >= 1 && vm.legs.length > 0, vm.start.hosts.map((h) => h.id).join());
      replaceDocument(cloneData(templatesData.house), { origin: 'file' });
      const tv = loc('h5');
      ok('Smart Home: the TV on Wi-Fi to the AP, then the AP\'s cable into the Home Router\'s eth2 (a routing device)',
        farIds(tv.legs[0]) === 'hap>h2' && tv.legs[0].hops[0].medium === 'wireless' && tv.legs[0].hops[1].farPort === 'eth2' && stopOf(tv.legs[0]) === 'routing@h2',
        farIds(tv.legs[0]) + ' ' + stopOf(tv.legs[0]));
      replaceDocument(site(), { origin: 'file', docId: 'locate' });
    }

    // ---- 3. Every gap ----
    {
      const r = loc('lone');
      ok('noCable: no link at all, no legs, the gap on the device itself',
        r.legs.length === 0 && json(codes(r)) === json(['noCable']) && r.gaps[0].leg === -1 && r.gaps[0].node.id === 'lone', json(codes(r)));
      const v = loc('vp');
      ok('a VPN tunnel is no leg', v.legs.length === 0 && has(v, 'noCable'), json(codes(v)));
      const np = loc('np');
      const h = np.legs[0].hops[0];
      ok('noPort: a cable onto a switch with no port picked; never read as port 1',
        has(np, 'noPort', 'sw2', 0) && h.farPort === '' && h.farPortId === null && h.jack === '' && h.vlan === null && !has(np, 'noJack'), json([h.farPort, h.farPortId, codes(np)]));
      ok('the noPort gap names its cable (for Pick a port)', np.gaps.find((g) => g.code === 'noPort').link.id === 'c21');
      const t = loc('typ');
      const g = t.gaps.find((x) => x.code === 'notGrouped');
      ok('notGrouped: the far switch in no group, its typed location as typed text (trimmed of its edges only)', !!g && g.node.id === 'sw3' && g.text === 'Closet B', json(g && g.text));
      const u = loc('ung');
      const g2 = u.gaps.find((x) => x.code === 'notGrouped');
      ok('notGrouped with no typed location: an empty text, nothing made up', !!g2 && g2.node.id === 'sw4' && g2.text === '', json(g2 && g2.text));
      ok('a grouped far end has no notGrouped gap', !has(loc('srv'), 'notGrouped'));
      const rp = loc('rpc');
      ok('retired hop: dimmed (retired), the gap raised, and the walk goes on to the switch',
        farIds(rp.legs[0]) === 'rph>sw1' && rp.legs[0].hops[0].retired && !rp.legs[0].hops[1].retired && has(rp, 'retired', 'rph', 0)
        && stopOf(rp.legs[0]) === 'faceplate@sw1', farIds(rp.legs[0]) + ' ' + json(codes(rp)));
      const o = loc('old');
      ok('a retired start: retired on the device itself, still located', o.start.retired && has(o, 'retired', 'old', -1) && o.legs[0].hops[0].farPort === 'Gi1/0/7', json(codes(o)));
      const every = new Set();
      state.nodes.forEach((n) => locatePath(n).gaps.forEach((x) => every.add(x.code)));
      ok('every gap code is raised somewhere on this site, and no other', LOCATE_GAPS.every((c) => every.has(c)) && [...every].every((c) => LOCATE_GAPS.includes(c)), [...every].sort().join());
      const sw = loc('sw1');
      ok('a switch\'s cables down to its devices are not where it is plugged in: no legs, noUplink (not noCable) on itself',
        sw.legs.length === 0 && json(codes(sw)) === json(['noUplink']) && sw.gaps[0].leg === -1, sw.legs.length + ' ' + json(codes(sw)));
    }

    // ---- 4. Pure: the document form, a lookup pass, nothing written, read-only ----
    {
      const all = () => state.nodes.map((n) => sig(locatePath(n)));
      const live = all();
      const docRaw = JSON.parse(JSON.stringify({ nodes: state.nodes, links: state.links, groups: state.groups }));
      const asked = { getNode: 0 };
      const realGetNode = window.getNode;
      const heldNodes = state.nodes, heldLinks = state.links, heldGroups = state.groups;
      // The open document becomes a decoy cabled otherwise: a copy must not read it.
      state.nodes = docRaw.nodes.map((n) => Object.assign({}, n, { name: 'decoy' }));
      state.links = [];
      state.groups = [];
      window.getNode = (id) => { asked.getNode++; return realGetNode(id); };
      let fromDoc;
      try { fromDoc = docRaw.nodes.map((n) => sig(locatePath(n, docRaw))); } finally { window.getNode = realGetNode; state.nodes = heldNodes; state.links = heldLinks; state.groups = heldGroups; }
      const diff = live.map((s, i) => (s === fromDoc[i] ? null : state.nodes[i].id)).filter(Boolean);
      ok('the document form gives the open document\'s answer for every device, reading nothing of the open one',
        diff.length === 0 && asked.getNode === 0, `${diff.join()} getNode ${asked.getNode}`);
      const inPass = withLookupPass(() => {
        const first = state.nodes.map((n) => locatePath(n));
        const again = state.nodes.map((n) => locatePath(n));
        return { sigs: first.map(sig), same: first.every((r, i) => r === again[i]) };
      });
      ok('inside a lookup pass the same answer, worked out once per device', json(inPass.sigs) === json(live) && inPass.same);
      const before = json(serializeDoc()), undoN = (state.undoStack || []).length;
      state.nodes.forEach((n) => locatePath(n));
      withLookupPass(() => state.nodes.forEach((n) => locatePath(n)));
      ok('locating changes nothing: the document byte for byte, no undo step', json(serializeDoc()) === before && (state.undoStack || []).length === undoN);
      // A newer Topo's file: opened read-only, located all the same.
      replaceDocument(Object.assign(site(), { v: DOC_VERSION + 1 }), { origin: 'file', docId: 'locate-ro' });
      const ro = json({ nodes: state.nodes, links: state.links, groups: state.groups });
      const roSigs = state.nodes.map((n) => sig(locatePath(n)));
      ok('a read-only newer file is located like any other, and nothing is written', !!state.readOnly && json(roSigs) === json(live)
        && json({ nodes: state.nodes, links: state.links, groups: state.groups }) === ro, String(state.readOnly));
      replaceDocument(site(), { origin: 'file', docId: 'locate' });
      // The SSID worked out on the open document is flagged as inferred.
      state.wifi = [{ id: 'wf1', ssid: 'Staff' }];
      byIdNow('ap1').interfaces = [{ id: 'r1', name: 'wlan0', ip: '', wireless: true, radio: { ssids: ['wf1'] } }];
      state.links.find((l) => l.id === 'c5').targetIface = 'r1';
      const wf = loc('lap').legs[0].hops[0].wifi;
      ok('an SSID the link does not name is worked out on the open document and flagged inferred (as linkWifiSsid says)',
        wf.ssid === linkWifiSsid(state.links.find((l) => l.id === 'c5')) && wf.ssidInferred === (wf.ssid != null) && wf.band === '5' && !wf.bandInferred, json(wf));
      replaceDocument(site(), { origin: 'file', docId: 'locate' });
    }

    // ---- 5. The uplinkOf agreement, every template ----
    {
      const disagree = [], threw = [];
      let checked = 0;
      Object.keys(templatesData).forEach((key) => {
        replaceDocument(cloneData(templatesData[key]), { origin: 'file' });
        state.nodes.forEach((n) => {
          let r;
          try { r = locatePath(n); } catch (e) { threw.push(`${key}:${n.id}:${e.message}`); return; }
          const up = csvUplink(n, true);
          if (!up || isVirtualType(n.type) || n.type === 'switch' || isRoutingDevice(n.type)) return;
          checked++;
          const h = r.legs[0] && r.legs[0].hops[0];
          if (!h || h.far !== up.peer || h.farPort !== (up.port === '—' ? '' : up.port) || h.from !== n) disagree.push(`${key}:${n.id}:${h ? h.far.id + '/' + h.farPort : '-'} vs ${up.peer.id}/${up.port}`);
        });
      });
      ok('every device of every template locates without throwing', threw.length === 0, threw.slice(0, 3).join(' | '));
      ok('the primary leg is the devices sheet\'s switch/port on every template', disagree.length === 0 && checked > 50, `${checked} checked; ${disagree.slice(0, 4).join(' | ')}`);
    }

    // ---- 6. Scale, counted ----
    {
      await loadScript('tests/fixtures/site300.js');
      replaceDocument(topoSite300(), { origin: 'file' });
      const realLinks = state.links;
      let scans = 0;
      const SCANS = new Set(['filter', 'find', 'forEach', 'some', 'map', 'every', 'findIndex', 'reduce', 'flatMap']);
      state.links = new Proxy(realLinks, { get(t, p, r) { if (SCANS.has(p)) scans++; return Reflect.get(t, p, r); } });
      let located = 0, gaps = 0;
      try {
        withLookupPass(() => state.nodes.forEach((n) => { const r = locatePath(n); located++; gaps += r.gaps.length; }));
      } finally { state.links = realLinks; }
      ok('locating all 300 devices in one pass walks the cable list a bounded number of times, not once per device',
        located === state.nodes.length && located >= 300 && scans <= 4, `${located} devices, ${scans} scans, ${gaps} gaps`);
      const doc = { nodes: state.nodes.slice(), links: state.links.slice(), groups: state.groups };
      let docGaps = 0;
      doc.nodes.forEach((n) => { docGaps += locatePath(n, doc).gaps.length; });
      ok('and the document form over all of them gives the same gaps (its time budget is in the perf suite)', docGaps === gaps, `${docGaps} vs ${gaps}`);
    }
  } catch (e) {
    ok('locate suite ran without throwing', false, e && (e.stack || e.message));
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
});
