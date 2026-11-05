// Managed switches and access points forward L2 (docs/BACKLOG.md, landing
// order step 6). A switch or AP with a management address used to stop the
// reachability walk: reachL2Domain() crossed only isDumbDevice() nodes (a
// switch/AP with no address) and reachWalk() never handed the walk on through
// a non-routing neighbour. So every host behind a managed switch lost its
// gateway and DNS, and the Trace stopped at the switch. Now a switch or AP
// forwards whatever its address (isL2Forwarder); its management address only
// makes it a host on that subnet as well (reachable itself, and a Trace start
// that walks as a host).
window.addEventListener('load', () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const reset = (nodes, links) => {
    state.networks = []; state.groups = []; state.accepted = [];
    state.nodes = nodes.map(normalizeLoadedNode); state.links = links.map(normalizeLoadedLink); autoBindLinks();
  };
  const ip = (id, addr, extra) => Object.assign({ id: 'i1', name: 'eth0', ip: addr }, extra || {});
  const host = (id, type, addr, extra) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0,
    gw: '192.168.1.1', dns: '192.168.1.53', interfaces: [ip(id, addr)] }, extra || {});
  const reach = (id, port) => calculateReachability(id, { port: port === undefined ? '' : port });
  const names = (set) => [...set].sort().join(',');
  const gwLevel = (id) => evaluateGateway(getNode(id)).level;
  const dnsLevel = (id) => evaluateDns(getNode(id)).level;
  const gwFindings = () => diagnoseDoc().findings.filter((f) => f.key === 'gateway' || f.key === 'dns');
  const sameAsShared = () => {
    const bad = [];
    withLookupPass(() => {
      const ctx = reachContext();
      state.nodes.forEach((n) => {
        const a = ctx.reach(n.id), b = reach(n.id);
        const same = (x, y) => x.size === y.size && [...x].every((v) => y.has(v));
        if (!same(a.reachableNodes, b.reachableNodes) || !same(a.reachableLinks, b.reachableLinks)) bad.push(n.id);
      });
    });
    return bad;
  };

  // ---- PC -> managed switch (same subnet) -> router ----
  const office = () => reset([
    { id: 'r', type: 'router', name: 'R', x: 0, y: 0, gw: '0.0.0.0', interfaces: [ip('r', '192.168.1.1/24')] },
    { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, gw: '192.168.1.1', interfaces: [{ id: 'm', name: 'vlan1', ip: '192.168.1.2/24' }] },
    host('pc', 'pc', '192.168.1.10/24'),
    host('dns', 'server', '192.168.1.53/24')
  ], [
    { id: 'l1', source: 'r', target: 'sw' },
    { id: 'l2', source: 'pc', target: 'sw' },
    { id: 'l3', source: 'dns', target: 'sw' }
  ]);
  office();
  ok('the switch has a management address (not a dumb device)', !isDumbDevice(getNode('sw')) && isL2Forwarder(getNode('sw')));
  ok('the PC behind a managed switch reaches its gateway', gwLevel('pc') === 'good', evaluateGateway(getNode('pc')).text);
  ok('and its DNS server', dnsLevel('pc') === 'good', evaluateDns(getNode('pc')).text);
  ok('no gateway or DNS finding on the whole document', gwFindings().length === 0, gwFindings().map((f) => f.line).join(' | '));
  let r = reach('pc');
  ok('the Trace from the PC runs through the switch to the router and the server',
     ['r', 'sw', 'dns'].every((id) => r.reachableNodes.has(id)) && ['l1', 'l2', 'l3'].every((id) => r.reachableLinks.has(id)),
     `${names(r.reachableNodes)} / ${names(r.reachableLinks)}`);
  r = reach('sw');
  ok('the managed switch is still a Trace start, walking as a host on its subnet',
     ['r', 'pc', 'dns'].every((id) => r.reachableNodes.has(id)), names(r.reachableNodes));
  ok('the switch\'s own gateway check still runs (it holds an address)', gwLevel('sw') === 'good', evaluateGateway(getNode('sw')).text);
  ok('and its interfaces are not called an L2 backplane', evaluateInterfaces(getNode('sw')).level === 'good', evaluateInterfaces(getNode('sw')).text);
  ok('the shared walk equals the plain walk here', sameAsShared().length === 0, sameAsShared().join(','));
  ok('the router reaches the switch as a host on their shared subnet', reach('r').reachableNodes.has('sw'));

  // A port filter keeps the switch on the path (a transit device, like a dumb one).
  getNode('dns').ports = '53';
  r = reach('pc', '53');
  ok('a port filter keeps the managed switch and the links through it',
     r.reachableNodes.has('sw') && r.reachableNodes.has('dns') && r.reachableLinks.has('l3') && r.reachableLinks.has('l2'),
     `${names(r.reachableNodes)} / ${names(r.reachableLinks)}`);
  // ...but asked about itself, an addressed switch is an endpoint: its own
  // Allowed Ports are judged (only an unaddressed one is pure transit).
  getNode('sw').ports = '22,443';
  let ps = getPortStatus(getNode('sw'), '53');
  ok('a managed switch is judged on its own Allowed Ports for a port', !ps.ok && ps.level === 'bad', ps.text);
  ps = getPortStatus(getNode('sw'), '22');
  ok('and accepts a port it lists', ps.ok && !/Transit device/.test(ps.text), ps.text);
  const savedSettings = { tracePort: state.settings.tracePort, tracePortOn: state.settings.tracePortOn };
  state.settings.tracePort = '53'; state.settings.tracePortOn = true;
  const tp = evaluateTracePort(getNode('sw'));
  ok('the node tab\'s Trace port row does not call a managed switch transit', tp.level === 'bad' && !/Transit device/.test(tp.text), tp.text);
  getNode('sw').interfaces = [];
  const tpDumb = evaluateTracePort(getNode('sw'));
  ok('an unaddressed switch is still a transit device for the trace port', /Transit device/.test(tpDumb.text), tpDumb.text);
  state.settings.tracePort = savedSettings.tracePort; state.settings.tracePortOn = savedSettings.tracePortOn;

  // A DNS server pointed at a managed switch whose Allowed Ports leave out 53.
  office();
  getNode('sw').ports = '22,443'; getNode('pc').dns = '192.168.1.2';
  ok('a DNS server on a managed switch that does not allow port 53 reads closed', dnsLevel('pc') === 'bad'
     && /53/.test(evaluateDns(getNode('pc')).text), evaluateDns(getNode('pc')).text);
  getNode('sw').ports = '22,53';
  ok('and reads good once it allows 53', dnsLevel('pc') === 'good', evaluateDns(getNode('pc')).text);

  // ---- The management address on another subnet (a management VLAN) ----
  office();
  getNode('sw').interfaces[0].ip = '10.99.0.2/24'; getNode('sw').gw = '10.99.0.1';
  ok('a switch managed on another subnet still forwards the PC\'s traffic', gwLevel('pc') === 'good' && dnsLevel('pc') === 'good',
     `${evaluateGateway(getNode('pc')).text} / ${evaluateDns(getNode('pc')).text}`);
  // Its management address is a host only on 10.99.0.0/24: nothing here
  // routes there, so neither the PC nor the router reaches the switch itself.
  r = reach('pc');
  ok('but the PC does not reach the switch itself across subnets', !r.reachableNodes.has('sw') && r.reachableLinks.has('l2'),
     names(r.reachableNodes) + ' / ' + names(r.reachableLinks));
  ok('nor does the router with no interface on that subnet', !reach('r').reachableNodes.has('sw'));
  getNode('pc').dns = '10.99.0.2';
  ok('a DNS server set to that unrouted management address is not reachable', dnsLevel('pc') === 'bad', evaluateDns(getNode('pc')).text);
  ok('the shared walk equals the plain walk with an unrouted management subnet', sameAsShared().length === 0, sameAsShared().join(','));

  // ---- NAT: the inside management address is hidden from the WAN side ----
  reset([
    { id: 'r', type: 'router', name: 'R', x: 0, y: 0, gw: '203.0.113.1', nat: true,
      interfaces: [{ id: 'w', name: 'eth0', ip: '203.0.113.2/24' }, { id: 'l', name: 'eth1', ip: '192.168.1.1/24' }] },
    { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, gw: '192.168.1.1', interfaces: [{ id: 'm', name: 'vlan1', ip: '192.168.1.2/24' }] },
    host('pc', 'pc', '192.168.1.10/24', { dns: '' }),
    { id: 'h', type: 'server', name: 'H', x: 300, y: 0, gw: '203.0.113.2', dns: '', interfaces: [{ id: 'i1', name: 'eth0', ip: '203.0.113.50/24' }] }
  ], [
    { id: 'wan', source: 'h', target: 'r', targetIface: 'w' },
    { id: 'lan', source: 'r', target: 'sw', sourceIface: 'l' },
    { id: 'pcl', source: 'pc', target: 'sw' }
  ]);
  r = reach('h');
  ok('an outside host reaches the NAT router', r.reachableNodes.has('r'), names(r.reachableNodes));
  ok('but not the inside managed switch behind NAT', !r.reachableNodes.has('sw') && !r.reachableNodes.has('pc'), names(r.reachableNodes));
  ok('the inside PC still reaches the switch and the router', reach('pc').reachableNodes.has('sw') && gwLevel('pc') === 'good');
  ok('the shared walk equals the plain walk across NAT', sameAsShared().length === 0, sameAsShared().join(','));

  // ---- A VPN tunnel ending on a managed switch is an overlay, not L2 ----
  reset([
    { id: 'a', type: 'router', name: 'A', x: 0, y: 0, gw: '0.0.0.0', interfaces: [ip('a', '10.1.0.1/24')] },
    { id: 'swb', type: 'switch', name: 'SW-B', x: 300, y: 0, gw: '10.2.0.1', interfaces: [{ id: 'm', name: 'vlan1', ip: '10.2.0.2/24' }] },
    { id: 'pcb', type: 'pc', name: 'PC-B', x: 300, y: 100, gw: '10.2.0.1', dns: '', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.2.0.10/24' }] },
    { id: 'pca', type: 'pc', name: 'PC-A', x: 0, y: 100, gw: '10.1.0.1', dns: '', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.1.0.10/24' }] }
  ], [
    { id: 'tun', source: 'a', target: 'swb', medium: 'vpn' },
    { id: 'lb', source: 'pcb', target: 'swb' },
    { id: 'la', source: 'pca', target: 'a' }
  ]);
  const dom = reachL2Domain('a');
  ok('the tunnel is not walked as L2 adjacency', !dom.nodes.has('swb') && !dom.links.has('tun'), names(dom.nodes) + ' / ' + names(dom.links));
  r = reach('a');
  ok('the far end is still reached over the VPN overlay', r.reachableNodes.has('swb') && r.reachableLinks.has('tun'), names(r.reachableNodes));
  ok('the shared walk equals the plain walk with a tunnel to a managed switch', sameAsShared().length === 0, sameAsShared().join(','));

  // ---- Two switches in a row: managed then dumb, and managed then managed ----
  reset([
    { id: 'r', type: 'router', name: 'R', x: 0, y: 0, gw: '0.0.0.0', interfaces: [ip('r', '192.168.1.1/24')] },
    { id: 'core', type: 'switch', name: 'Core', x: 0, y: 100, gw: '192.168.1.1', interfaces: [{ id: 'm', name: 'vlan1', ip: '192.168.1.2/24' }] },
    { id: 'edge', type: 'switch', name: 'Edge', x: 0, y: 200, interfaces: [] },
    { id: 'acc', type: 'switch', name: 'Access', x: 0, y: 300, gw: '192.168.1.1', interfaces: [{ id: 'm', name: 'vlan1', ip: '192.168.1.4/24' }] },
    host('pc', 'pc', '192.168.1.10/24', { dns: '' }),
    host('pc2', 'pc', '192.168.1.11/24', { dns: '' })
  ], [
    { id: 'a', source: 'r', target: 'core' },
    { id: 'b', source: 'core', target: 'edge' },
    { id: 'c', source: 'edge', target: 'pc' },
    { id: 'd', source: 'core', target: 'acc' },
    { id: 'e', source: 'acc', target: 'pc2' }
  ]);
  ok('a PC behind a dumb switch behind a managed one reaches the router', gwLevel('pc') === 'good', evaluateGateway(getNode('pc')).text);
  ok('a PC behind two managed switches reaches it too', gwLevel('pc2') === 'good', evaluateGateway(getNode('pc2')).text);
  ok('the two PCs reach each other across the switches', reach('pc').reachableNodes.has('pc2') && reach('pc2').reachableNodes.has('pc'));
  ok('the shared walk equals the plain walk', sameAsShared().length === 0, sameAsShared().join(','));

  // ---- Routed beyond: a second subnet behind the router, behind another managed switch ----
  reset([
    { id: 'r', type: 'router', name: 'R', x: 0, y: 0, gw: '0.0.0.0',
      interfaces: [ip('r', '192.168.1.1/24'), { id: 'i2', name: 'eth1', ip: '192.168.2.1/24' }] },
    { id: 'sw1', type: 'switch', name: 'SW1', x: 0, y: 100, gw: '192.168.1.1', interfaces: [{ id: 'm', name: 'vlan1', ip: '192.168.1.2/24' }] },
    { id: 'sw2', type: 'switch', name: 'SW2', x: 200, y: 100, gw: '192.168.2.1', interfaces: [{ id: 'm', name: 'vlan1', ip: '192.168.2.2/24' }] },
    host('pc', 'pc', '192.168.1.10/24', { dns: '192.168.2.53' }),
    host('dns', 'server', '192.168.2.53/24', { gw: '192.168.2.1', dns: '' })
  ], [
    { id: 'a', source: 'r', target: 'sw1', sourceIface: 'i1' },
    { id: 'b', source: 'r', target: 'sw2', sourceIface: 'i2' },
    { id: 'c', source: 'pc', target: 'sw1' },
    { id: 'd', source: 'dns', target: 'sw2' }
  ]);
  ok('a DNS server on the far subnet, behind its own managed switch, is reachable', dnsLevel('pc') === 'good', evaluateDns(getNode('pc')).text);
  ok('and the far server reaches its gateway', gwLevel('dns') === 'good', evaluateGateway(getNode('dns')).text);
  ok('no gateway or DNS finding routed across two managed switches', gwFindings().length === 0, gwFindings().map((f) => f.line).join(' | '));
  ok('the shared walk (tails keyed by router and subnet) equals the plain walk', sameAsShared().length === 0, sameAsShared().join(','));

  // ---- Retired: a retired managed switch forwards nothing ----
  office();
  getNode('sw').status = 'retired';
  ok('a retired managed switch forwards nothing', gwLevel('pc') === 'bad' && !reach('pc').reachableNodes.has('r'),
     evaluateGateway(getNode('pc')).text);
  office();
  getNode('dns').status = 'retired';
  ok('a retired DNS server behind a managed switch is still not reachable', dnsLevel('pc') === 'bad', evaluateDns(getNode('pc')).text);

  // ---- Passthrough is still L2 ----
  reset([
    { id: 'r', type: 'router', name: 'R', x: 0, y: 0, gw: '0.0.0.0', interfaces: [ip('r', '192.168.1.1/24')] },
    { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, gw: '192.168.1.1', interfaces: [{ id: 'm', name: 'vlan1', ip: '192.168.1.2/24' }] },
    host('hv', 'server', '192.168.1.20/24', { dns: '' }),
    host('vm', 'vm', '192.168.1.30/24', { dns: '' })
  ], [
    { id: 'a', source: 'r', target: 'sw' },
    { id: 'b', source: 'hv', target: 'sw' },
    { id: 'c', source: 'vm', target: 'hv', attachment: 'passthrough' }
  ]);
  ok('a passthrough VM on a host behind a managed switch reaches the router', gwLevel('vm') === 'good', evaluateGateway(getNode('vm')).text);

  // ---- An access point with a management address and a Wi-Fi client ----
  reset([
    { id: 'r', type: 'router', name: 'R', x: 0, y: 0, gw: '0.0.0.0', interfaces: [ip('r', '192.168.1.1/24')] },
    { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 100, gw: '192.168.1.1', interfaces: [{ id: 'm', name: 'eth0', ip: '192.168.1.3/24' }] },
    host('dns', 'server', '192.168.1.53/24'),
    { id: 'lap', type: 'pc', name: 'Laptop', x: 100, y: 200, gw: '192.168.1.1', dns: '192.168.1.53',
      interfaces: [{ id: 'i1', name: 'wlan0', ip: '192.168.1.50/24' }] }
  ], [
    { id: 'up', source: 'ap', target: 'r', sourceIface: 'm' },
    { id: 'srv', source: 'dns', target: 'r' },
    { id: 'assoc', source: 'lap', target: 'ap', medium: 'wireless' }
  ]);
  ok('the AP keeps its management address', getValidIps(getNode('ap')).length === 1 && isL2Forwarder(getNode('ap')));
  ok('the association is a radio link', effectiveMedium(getLink('assoc')) === 'wireless');
  ok('a Wi-Fi client of a managed AP reaches its gateway', gwLevel('lap') === 'good', evaluateGateway(getNode('lap')).text);
  ok('and its DNS server', dnsLevel('lap') === 'good', evaluateDns(getNode('lap')).text);
  r = reach('lap');
  ok('the Trace from the laptop runs through the AP', r.reachableNodes.has('ap') && r.reachableLinks.has('assoc') && r.reachableLinks.has('up'),
     `${names(r.reachableNodes)} / ${names(r.reachableLinks)}`);
  ok('the AP is a Trace start that reaches its client', reach('ap').reachableNodes.has('lap'), names(reach('ap').reachableNodes));
  ok('no gateway or DNS finding with a managed AP', gwFindings().length === 0, gwFindings().map((f) => f.line).join(' | '));

  // ---- The L2 segment: two NICs on one subnet through one managed switch ----
  // segmentKeyOf/l2DomainOf mean "the broadcast domain", which a managed switch
  // carries as a dumb one does: the MAC-flapping check sees one segment.
  reset([
    { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, gw: '192.168.1.1', interfaces: [{ id: 'm', name: 'vlan1', ip: '192.168.1.2/24' }] },
    { id: 'srv', type: 'server', name: 'Srv', x: 0, y: 0, gw: '192.168.1.1',
      interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24' }, { id: 'i2', name: 'eth1', ip: '192.168.1.21/24' }] }
  ], [
    { id: 'a', source: 'srv', target: 'sw', sourceIface: 'i1' },
    { id: 'b', source: 'srv', target: 'sw', sourceIface: 'i2' }
  ]);
  ok('two NICs on one subnet through a managed switch are one broadcast domain', evaluateMultiHoming(getNode('srv')).level === 'bad',
     evaluateMultiHoming(getNode('srv')).text);

  // ---- Loops stay on unaddressed switches (a managed switch is where STP runs) ----
  const ring = (managed) => reset(['s1', 's2', 's3'].map((id, i) => ({ id, type: 'switch', name: id.toUpperCase(), x: i * 100, y: 0,
    interfaces: managed ? [{ id: 'm', name: 'vlan1', ip: `192.168.1.${i + 2}/24` }] : [] })), [
    { id: 'a', source: 's1', target: 's2' }, { id: 'b', source: 's2', target: 's3' }, { id: 'c', source: 's3', target: 's1' }
  ]);
  ring(false);
  ok('a ring of dumb switches is still an L2 loop', loopFindings().length === 1);
  ring(true);
  ok('a ring of managed switches is not reported as a loop (STP assumed)', loopFindings().length === 0, loopFindings().map((f) => f.line).join(' | '));

  // ---- The templates have no managed switch or AP, so nothing changed there ----
  const managed = [];
  Object.keys(templatesData).forEach((k) => (templatesData[k].nodes || []).forEach((n) => {
    if (['switch', 'ap'].includes(n.type) && (n.interfaces || []).some((i) => parseValidCIDR(i.ip))) managed.push(`${k}/${n.name}`);
  }));
  ok('no shipped template or sample has a switch or AP with an address', managed.length === 0, managed.join(', '));

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
