// Injected into a copy of the real index.html and run against the live app state.
window.addEventListener('load', () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);

  function reset(nodes, links) {
    state.nodes = nodes.map(normalizeLoadedNode);
    state.links = links.map(normalizeLoadedLink);
    autoBindLinks();
  }

  // ---- Scenario 1: the PACS server. Two NICs, one subnet, same switch. ----
  reset([
    { id: 'pacs', type: 'server', name: 'PACS', x: 0, y: 0, gw: '192.168.1.1',
      interfaces: [{ id: 'i1', name: 'eno1', ip: '192.168.1.10/24' }, { id: 'i2', name: 'enp4s0', ip: '192.168.1.11/24' }] },
    { id: 'sw', type: 'switch', name: 'Core Switch', x: 0, y: 100, interfaces: [] },
    { id: 'rtr', type: 'router', name: 'Router', x: 0, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.1/24' }] }
  ], [
    { id: 'l1', source: 'pacs', target: 'sw' },
    { id: 'l2', source: 'pacs', target: 'sw' },
    { id: 'l3', source: 'sw', target: 'rtr' }
  ]);

  const pacs = getNode('pacs');
  ok('two cables to one switch both persist', state.links.filter(l => l.source === 'pacs').length === 2);
  const bound = state.links.filter(l => l.source === 'pacs').map(l => l.sourceIface);
  ok('auto-bind gave each cable its own NIC', new Set(bound).size === 2, bound.join(','));
  const swPorts = state.links.filter(l => l.target === 'sw').map(l => l.targetIface);
  ok('auto-bind gave each cable its own switch port', new Set(swPorts).size === swPorts.length, swPorts.join(','));

  const mh = evaluateMultiHoming(pacs);
  ok('MAC flapping detected (level bad)', mh.level === 'bad', mh.level);
  ok('MAC flapping names both NICs', /eno1/.test(mh.text) && /enp4s0/.test(mh.text));
  ok('MAC flapping cites the remedies', /arp_ignore/.test(mh.text) && /bond/.test(mh.text));
  ok('PACS node renders red', nodeSeverity(pacs) === 'bad', String(nodeSeverity(pacs)));
  ok('router is clean', nodeSeverity(getNode('rtr')) === null, String(nodeSeverity(getNode('rtr'))));
  ok('switch is clean', nodeSeverity(getNode('sw')) === null, String(nodeSeverity(getNode('sw'))));

  // ---- Scenario 2: same subnet, but different broadcast domains -> warn, not bad ----
  reset([
    { id: 'pacs', type: 'server', name: 'PACS', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eno1', ip: '192.168.1.10/24' }, { id: 'i2', name: 'enp4s0', ip: '192.168.1.11/24' }] },
    { id: 'swA', type: 'switch', name: 'Switch A', x: -100, y: 100, interfaces: [] },
    { id: 'swB', type: 'switch', name: 'Switch B', x: 100, y: 100, interfaces: [] }
  ], [
    { id: 'l1', source: 'pacs', target: 'swA' },
    { id: 'l2', source: 'pacs', target: 'swB' }
  ]);
  const split = evaluateMultiHoming(getNode('pacs'));
  ok('isolated domains warn rather than fail', split.level === 'warn', split.level + ': ' + split.text.slice(0, 60));

  // ---- Scenario 3: ...until the two switches are trunked together ----
  state.links.push(normalizeLoadedLink({ id: 'trunk', source: 'swA', target: 'swB' }));
  autoBindLinks();
  const trunked = evaluateMultiHoming(getNode('pacs'));
  ok('trunking the switches escalates warn -> bad', trunked.level === 'bad', trunked.level);

  // ---- Scenario 4: correctly multi-homed server across two subnets ----
  reset([
    { id: 'srv', type: 'server', name: 'Dual Home', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.10/24' }, { id: 'i2', name: 'eth1', ip: '10.0.0.10/24' }] },
    { id: 'swA', type: 'switch', name: 'A', x: -100, y: 100, interfaces: [] },
    { id: 'swB', type: 'switch', name: 'B', x: 100, y: 100, interfaces: [] }
  ], [
    { id: 'l1', source: 'srv', target: 'swA' },
    { id: 'l2', source: 'srv', target: 'swB' }
  ]);
  ok('legitimate dual-homing stays clean', nodeSeverity(getNode('srv')) === null, String(evaluateMultiHoming(getNode('srv')).text).slice(0, 70));

  // ---- Scenario 5: switch oversubscription ----
  reset([
    { id: 'sw', type: 'switch', name: 'Tiny', x: 0, y: 0, portCount: 2, interfaces: [] },
    { id: 'a', type: 'pc', name: 'A', x: 0, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24' }] },
    { id: 'b', type: 'pc', name: 'B', x: 50, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.21/24' }] },
    { id: 'c', type: 'pc', name: 'C', x: 100, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.22/24' }] }
  ], [
    { id: 'l1', source: 'sw', target: 'a' }, { id: 'l2', source: 'sw', target: 'b' }, { id: 'l3', source: 'sw', target: 'c' }
  ]);
  ok('3rd cable grows the 2-port switch rather than vanishing', portCountOf(getNode('sw')) === 3, 'portCount=' + portCountOf(getNode('sw')));

  // ---- Scenario 6: L2 loop ----
  reset([
    { id: 's1', type: 'switch', name: 'S1', x: 0, y: 0, interfaces: [] },
    { id: 's2', type: 'switch', name: 'S2', x: 100, y: 0, interfaces: [] }
  ], [
    { id: 'l1', source: 's1', target: 's2' }, { id: 'l2', source: 's1', target: 's2' }
  ]);
  validateTopology();
  const loopMsg = document.getElementById('conflictMsgList').textContent;
  ok('L2 loop reported', /L2 loop/.test(loopMsg), loopMsg.slice(0, 60));

  // ---- Scenario 7: round-trip through the URL hash ----
  reset([
    { id: 'pacs', type: 'server', name: 'PACS', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eno1', ip: '192.168.1.10/24' }, { id: 'i2', name: 'enp4s0', ip: '192.168.1.11/24' }] },
    { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 12, interfaces: [] }
  ], [
    { id: 'l1', source: 'pacs', target: 'sw' }, { id: 'l2', source: 'pacs', target: 'sw' }
  ]);
  const before = state.links.map(l => `${l.sourceIface}>${l.targetIface}`).join('|');
  save();
  load();
  const after = state.links.map(l => `${l.sourceIface}>${l.targetIface}`).join('|');
  ok('port bindings survive save/load', before === after && before.length > 0, `${before} vs ${after}`);
  ok('portCount survives save/load', portCountOf(getNode('sw')) === 12, String(portCountOf(getNode('sw'))));
  ok('reloaded topology still flags flapping', nodeSeverity(getNode('pacs')) === 'bad');

  // ---- Scenario 8: legacy hash with no iface refs at all ----
  const legacy = { nodes: [
      { id: 'x', type: 'server', name: 'Old', x: 0, y: 0, ips: ['192.168.1.5/24'] },
      { id: 'y', type: 'switch', name: 'OldSw', x: 0, y: 100, ips: [] }
    ], links: [{ id: 'ol', source: 'x', target: 'y' }] };
  window.location.hash = btoa(encodeURIComponent(JSON.stringify(legacy)));
  load();
  const ol = state.links[0];
  ok('legacy unbound link gets auto-bound', !!ol.sourceIface && !!ol.targetIface, `${ol.sourceIface}>${ol.targetIface}`);
  ok('legacy diagram reports no false warnings', nodeSeverity(getNode('x')) === null, String(evaluateMultiHoming(getNode('x')).text).slice(0, 50));

  // ---- Scenario 9: hash size sanity (implicit ports) ----
  reset([{ id: 'big', type: 'switch', name: 'Big', x: 0, y: 0, portCount: 48, interfaces: [] }], []);
  save();
  const implicitLen = window.location.hash.length;
  // Same switch, but with every port materialized — what the naive model would cost.
  const materialized = [];
  for (let p = 1; p <= 48; p++) materialized.push({ id: `p${p}`, name: String(p), ip: '' });
  reset([{ id: 'big', type: 'switch', name: 'Big', x: 0, y: 0, portCount: 48, interfaces: materialized }], []);
  save();
  const explicitLen = window.location.hash.length;
  ok('implicit ports keep a 48-port switch small in the hash', implicitLen * 3 < explicitLen,
     `implicit=${implicitLen} vs materialized=${explicitLen} chars`);

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
