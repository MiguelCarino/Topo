window.addEventListener('load', () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const reset = (nodes, links) => { state.nodes = nodes.map(normalizeLoadedNode); state.links = links.map(normalizeLoadedLink); autoBindLinks(); };

  // ---- Name-based kind detection ----
  const kinds = ['wlan0','wlp1s0','wlo1','wlx00','wifi0','ath0','ra0'].map(n => ifaceIsWireless({name:n}));
  ok('recognises wireless names', kinds.every(Boolean), ['wlan0','wlp1s0','wlo1','wlx00','wifi0','ath0','ra0'].join(','));
  const wired = ['eth0','eno1','enp4s0','ens33','em1','igb0','bond0'].map(n => ifaceIsWireless({name:n}));
  ok('does not mistake wired names for radios', wired.every(k => !k));
  ok('explicit flag overrides the name', ifaceIsWireless({name:'eth0', wireless:true}) && !ifaceIsWireless({name:'wlan0', wireless:false}));

  // ---- The AP model: radio for clients, socket for uplink ----
  reset([
    { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 0, interfaces: [] },
    { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, interfaces: [] },
    { id: 'pc', type: 'pc', name: 'Laptop', x: 100, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.50/24' }] }
  ], [
    { id: 'up', source: 'ap', target: 'sw' },
    { id: 'assoc', source: 'pc', target: 'ap' }
  ]);
  const ap = getNode('ap'), pc = getNode('pc');
  ok('legacy AP gains a radio', ap.interfaces.some(ifaceIsWireless), ap.interfaces.map(i=>i.name).join(','));
  ok('AP uplink is a cable, not radio', effectiveMedium(getLink('up')) === 'utp', effectiveMedium(getLink('up')));
  ok('AP uplink lands on a faceplate port', /^p\d+$/.test(getLink('up').sourceIface), getLink('up').sourceIface);
  ok('client association is wireless', effectiveMedium(getLink('assoc')) === 'wireless');
  ok('association lands on the AP radio', ifaceIsWireless(ifaceOn(ap, getLink('assoc').targetIface)), ifaceLabel(ap, getLink('assoc').targetIface));
  ok('single-NIC client renamed eth0 -> wlan0', pc.interfaces[0].name === 'wlan0', pc.interfaces[0].name);
  ok('rename kept the IP on the radio', pc.interfaces[0].ip === '192.168.1.50/24', pc.interfaces[0].ip);
  ok('no false badge on a correct wifi setup', !nodeSeverity(pc) && !nodeSeverity(ap), `pc=${nodeSeverity(pc)} ap=${nodeSeverity(ap)}`);

  // ---- Many clients share the radio, not port 1 ----
  const many = [{ id: 'ap', type: 'ap', name: 'AP', x: 0, y: 0, interfaces: [] }];
  const mlinks = [];
  for (let i = 0; i < 5; i++) {
    many.push({ id: 'c' + i, type: 'iot', name: 'C' + i, x: i * 40, y: 100, interfaces: [{ id: 'i1', name: 'wlan0', ip: '192.168.1.' + (60 + i) + '/24' }] });
    mlinks.push({ id: 'k' + i, source: 'c' + i, target: 'ap' });
  }
  reset(many, mlinks);
  const apn = getNode('ap');
  const targets = new Set(state.links.map(l => l.targetIface));
  ok('5 clients share one radio', targets.size === 1 && ifaceIsWireless(ifaceOn(apn, [...targets][0])), [...targets].join(','));
  ok('clients do not occupy the AP faceplate', ![...targets].some(t => /^p\d+$/.test(t)));
  ok('AP not flagged for 5 clients on one radio', !nodeSeverity(apn), String(evaluatePorts(apn).text).slice(0,50));

  // ---- The user's point: wifi cannot come from enp1s0 ----
  reset([
    { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 0, interfaces: [] },
    { id: 'srv', type: 'server', name: 'Srv', x: 100, y: 0, interfaces: [
      { id: 'i1', name: 'enp1s0', ip: '192.168.1.10/24' }, { id: 'i2', name: 'wlan0', ip: '192.168.1.11/24' }] }
  ], [{ id: 'a', source: 'srv', target: 'ap' }]);
  ok('multi-NIC host associates via its radio, not enp1s0', ifaceLabel(getNode('srv'), getLink('a').sourceIface) === 'wlan0',
     ifaceLabel(getNode('srv'), getLink('a').sourceIface));

  // Force the wrong hardware and confirm it is caught.
  getLink('a').sourceIface = 'i1';
  const r = evaluateRadio(getNode('srv'));
  ok('wifi forced onto enp1s0 is flagged red', r.level === 'bad', r.text.slice(0, 78));
  ok('node renders red for it', nodeSeverity(getNode('srv')) === 'bad');

  // ---- Inverse: a cable terminating on a radio ----
  reset([
    { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, interfaces: [] },
    { id: 'pc', type: 'pc', name: 'PC', x: 100, y: 0, interfaces: [{ id: 'i1', name: 'wlan0', ip: '192.168.1.5/24' }] }
  ], [{ id: 'c', source: 'pc', target: 'sw', medium: 'utp' }]);
  ok('cable to a radio-only host grows it an eth0 rather than mis-binding',
     ifaceLabel(getNode('pc'), getLink('c').sourceIface) === 'eth0', ifaceLabel(getNode('pc'), getLink('c').sourceIface));
  // Force the wrong binding by hand, the way the picker allows.
  getLink('c').sourceIface = getNode('pc').interfaces.find(i => i.name === 'wlan0').id;
  const inv = evaluateRadio(getNode('pc'));
  ok('utp cable forced onto a radio is flagged', inv.level === 'bad', inv.text.slice(0, 64));

  // ---- Round trip ----
  reset([
    { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 0, interfaces: [] },
    { id: 'pc', type: 'pc', name: 'PC', x: 100, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.50/24' }] }
  ], [{ id: 'a', source: 'pc', target: 'ap' }]);
  save(); load();
  ok('radio naming survives save/load', getNode('pc').interfaces[0].name === 'wlan0', getNode('pc').interfaces[0].name);
  ok('wireless binding survives save/load', ifaceIsWireless(ifaceOn(getNode('ap'), getLink('a').targetIface)));

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
