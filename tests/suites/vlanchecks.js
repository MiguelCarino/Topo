// VLANs, trunks and PoE, stage 2a (docs/BACKLOG.md feature 4, landing order
// step 15): the VLAN checks (vlanFindings in js/diagnostics.js on vlanPath,
// portVlans and endCarries in js/model.js). What is held here:
//   1. a lab with VLAN facts everywhere and nothing wrong raises nothing,
//      and the same lab with every VLAN fact taken away raises nothing
//      either (an end that records nothing carries every VLAN); vlanPath on
//      it: through a managed switch (one with a management address), the
//      stop it names, null with no VLAN-blind path at all;
//   2. vlan-path: a trunk that lacks VLAN 20 is one critical finding,
//      scoped to the VLAN, naming the stopping cable, the gateway and the
//      devices behind it folded into one; adding the VLAN clears it; one end
//      lacking it names that cable (and the mismatch advisory beside it); a
//      second access switch with a management address on another subnet is
//      crossed all the same; a Wi-Fi client's SSID VLAN missing on its access
//      point's uplink is flagged at the AP's cable; a device whose gateway
//      check is not good, a retired device, a device on a port with no VLAN
//      and a NIC on no VLAN are not judged;
//   3. vlan-mismatch: a device on the wrong access port (critical, by its
//      network's name, and by its own VLAN with no network), two ports with
//      different native VLANs (critical), a VLAN tagged at one end only and
//      one tagged at one end and untagged at the other (advisory, one finding
//      per cable), an "all" trunk against a list, a radio link, a VPN tunnel
//      and a VM's bridged link skipped, an SVI on a trunk (its address's VLAN
//      in its tagged list) read as tagged;
//   4. vlan-subnet: an access port's VLAN that no subnet has, once per VLAN,
//      naming the switches and ports (singular and plural), a trunk's native
//      VLAN and a tagged-only VLAN left alone, a retired switch's ports too;
//   5. accepting: a vlan-path finding accepted for VLAN 20 leaves VLAN 10's
//      on the same cable open; a new device behind it reopens it;
//   6. counted and read: the counts, the check names, the Simple summary's
//      plain words (PLAIN_FINDINGS, no "VLAN" or "PoE" in them);
//   7. Locate's cross-check: the vlan-mismatch on the device's own cable is
//      shown on its hop, with the finding's words, and gone once accepted;
//      a poe-none likewise;
//   8. the samples: the Full Showcase's Studio trunk, and no template or
//      simple sample (nor any template with every VLAN fact stripped) raising
//      a VLAN finding;
//   9. the words in es, pt-BR, ja and ru, no placeholder left, Russian
//      keeping the count out of the plural.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  setLocale('en');
  const vlanKeys = /^vlan-/;
  const vl = () => topologyFindings().filter((f) => vlanKeys.test(f.key));
  const of = (key) => vl().filter((f) => f.key === key);
  const ids = (f) => (f ? f.nodeIds.slice().sort().join(',') : '');
  const nets = () => [{ id: 'n10', cidr: '10.0.10.0/24', name: 'Staff', vlan: 10 }, { id: 'n20', cidr: '10.0.20.0/24', name: 'Cams', vlan: 20 }];
  // RT (a router on a stick: eth0 trunks 10 and 20, its subinterfaces hold
  // the gateways) - CORE (managed: an address on Staff) - ACC (access).
  const lab = (opts = {}) => {
    const core = { id: 'core', type: 'switch', name: 'CORE', x: 0, y: 0, portCount: 24,
      portAttrs: { p1: { tagged: '10,20' }, p24: { tagged: opts.coreTrunk || '10,20' } }, interfaces: [{ id: 'm', name: 'mgmt', ip: '10.0.10.2/24' }] };
    const acc = { id: 'acc', type: 'switch', name: 'ACC', x: 0, y: 100, portCount: 24,
      portAttrs: Object.assign({ p24: { tagged: opts.accTrunk || '10,20' }, p3: { vlan: 20 }, p4: { vlan: 20 } }, opts.accPorts || {}), interfaces: opts.accIfaces || [] };
    const host = (id, name, ip, gw, extra) => Object.assign({ id, type: 'pc', name, x: 0, y: 200, gw, interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra || {});
    return { v: DOC_VERSION, networks: nets(), wifi: opts.wifi || [],
      nodes: [
        { id: 'rt', type: 'router', name: 'RT', x: 0, y: -100, interfaces: [{ id: 'e0', name: 'eth0', ip: '', tagged: '10,20' },
          { id: 'e10', name: 'eth0.10', ip: '10.0.10.1/24' }, { id: 'e20', name: 'eth0.20', ip: '10.0.20.1/24' }] },
        core, acc,
        host('pc1', 'PC-1', '10.0.10.5/24', '10.0.10.1'), host('pc2', 'PC-2', '10.0.10.6/24', '10.0.10.1'),
        host('cam', 'CAM-1', '10.0.20.5/24', '10.0.20.1', { type: 'camera' }),
        host('cam2', 'CAM-2', '10.0.20.6/24', '10.0.20.1', { type: 'camera' })
      ].concat(opts.nodes || []),
      links: [
        { id: 'k_up', source: 'rt', target: 'core', sourceIface: 'e0', targetIface: 'p1' },
        { id: 'k_tr', source: 'core', target: 'acc', sourceIface: 'p24', targetIface: 'p24' },
        { id: 'k1', source: 'acc', target: 'pc1', sourceIface: 'p1', targetIface: 'i1' },
        { id: 'k2', source: 'acc', target: 'pc2', sourceIface: 'p2', targetIface: 'i1' },
        { id: 'k3', source: 'acc', target: 'cam', sourceIface: 'p3', targetIface: 'i1' },
        { id: 'k4', source: 'acc', target: 'cam2', sourceIface: 'p4', targetIface: 'i1' }
      ].concat(opts.links || []) };
  };
  const open = (doc) => { replaceDocument(doc, { origin: 'file' }); initHistory(); };
  // Every VLAN fact on ports and interfaces taken away (PoE and labels kept).
  const strip = (doc) => {
    (doc.nodes || []).forEach((n) => {
      if (n.portAttrs) {
        Object.keys(n.portAttrs).forEach((k) => { delete n.portAttrs[k].vlan; delete n.portAttrs[k].tagged; if (!Object.keys(n.portAttrs[k]).length) delete n.portAttrs[k]; });
        if (!Object.keys(n.portAttrs).length) delete n.portAttrs;
      }
      (n.interfaces || []).forEach((i) => { delete i.vlan; delete i.tagged; });
    });
    return doc;
  };
  const gatewayOf = (id) => (nodeDiagnosis(getNode(id)).checks.find((c) => c.key === 'gateway') || {}).level;

  try {
    // ---- 1. Clean, and with no facts at all ----
    open(lab());
    ok('the lab is reachable: every device\'s gateway check is good', ['pc1', 'pc2', 'cam', 'cam2'].every((id) => gatewayOf(id) === 'good'),
      ['pc1', 'cam'].map(gatewayOf).join(','));
    ok('VLAN facts everywhere, nothing wrong: no VLAN finding', !vl().length, show(vl()));
    ok('and no finding at all', !topologyFindings().length, show(topologyFindings().map((f) => f.line)));
    ok('vlanPath crosses the managed switch (an address of its own) to the gateway', show(vlanPath('acc', 20, 'rt')) === '{"ok":true}' && getValidIps(getNode('core')).length === 1);
    open(strip(lab()));
    ok('every VLAN fact taken away: still none (an end that records nothing carries every VLAN)', !vl().length && !topologyFindings().length, show(topologyFindings().map((f) => f.line)));
    ok('vlanPath on unknown ends is the plain L2 walk', vlanPath('acc', 999, 'rt').ok === true);
    open(lab({ coreTrunk: '10' }));
    const vp = vlanPath('acc', 20, 'rt');
    ok('vlanPath names the first cable that does not carry it, and the end it still reaches', vp && vp.ok === false && vp.link.id === 'k_tr' && vp.near === 'acc' && vp.far === 'core', show(vp && { l: vp.link.id, n: vp.near, f: vp.far }));
    ok('and is null where not even a VLAN-blind path leads', vlanPath('acc', 20, 'nobody') === null);

    // ---- 2. vlan-path ----
    open(lab({ coreTrunk: '10', accTrunk: '10' }));
    let f = of('vlan-path');
    ok('a trunk that lacks VLAN 20: one critical vlan-path finding', f.length === 1 && f[0].level === 'bad', show(vl()));
    ok('its words: the VLAN, the gateway, the cable, the devices folded', f[0] && f[0].detail === 'VLAN 20 does not reach its gateway RT: ACC · 24 ↔ CORE · 24 does not carry it. On it: CAM-1, CAM-2.', f[0] && f[0].detail);
    ok('scoped to the VLAN, naming the devices, the gateway, the switch and the cable', f[0] && f[0].scope === 'vlan:20' && ids(f[0]) === 'acc,cam,cam2,rt' && show(f[0].linkIds) === '["k_tr"]', show(f[0]));
    ok('the check name, the subject is where it stops', f[0] && f[0].check === 'VLAN path' && f[0].subject === 'ACC' && findingCheckName('vlan-path') === 'VLAN path');
    ok('VLAN 10 still gets through: nothing about it', !vl().some((x) => x.scope === 'vlan:10'), show(vl()));
    ok('the two trunk ends tagged alike: no mismatch on it', !of('vlan-mismatch').length, show(of('vlan-mismatch')));
    ok('the gateway check is unchanged (VLAN-blind)', gatewayOf('cam') === 'good');
    open(lab({ coreTrunk: '10,20' }));
    ok('adding VLAN 20 to the trunk clears it', !vl().length, show(vl()));
    open(lab({ accTrunk: '10' }));
    f = of('vlan-path');
    ok('one end lacking it: the path stops at that cable', f.length === 1 && show(f[0].linkIds) === '["k_tr"]', show(vl()));
    ok('and the mismatch advisory says the VLAN is tagged at one end only', of('vlan-mismatch').length === 1 && of('vlan-mismatch')[0].level === 'warn'
       && of('vlan-mismatch')[0].detail === 'CORE · 24 and ACC · 24 disagree on what the cable carries: VLAN 20 is tagged at one end only.', show(of('vlan-mismatch')));
    // A second managed switch, managed on a subnet of its own.
    open(lab({ coreTrunk: '10', accIfaces: [{ id: 'm', name: 'mgmt', ip: '10.0.99.2/24' }] }));
    ok('an access switch managed on another subnet is crossed all the same', of('vlan-path').length === 1 && show(of('vlan-path')[0].linkIds) === '["k_tr"]', show(vl()));
    open(lab({ coreTrunk: '10', nodes: [{ id: 'late', type: 'pc', name: 'Late PC', x: 0, y: 300, gw: '10.0.20.250', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.7/24' }] }],
      links: [{ id: 'k5', source: 'acc', target: 'late', sourceIface: 'p5', targetIface: 'i1' }] }));
    ok('a device whose gateway check is not good is not judged (its gateway finding says it)', gatewayOf('late') === 'bad' && !of('vlan-path').some((x) => x.nodeIds.includes('late')), show(vl()));
    open(lab({ coreTrunk: '10' }));
    getNode('cam').status = 'retired'; getNode('cam2').status = 'retired'; save();
    ok('retired devices are not judged', !of('vlan-path').length, show(vl()));
    open(strip(lab({ coreTrunk: '10' })));
    getNode('core').portAttrs = { p24: { tagged: '10' } }; save();
    ok('a camera on a port with no VLAN and a NIC whose subnet has no VLAN... (here Cams has 20): judged by its NIC', of('vlan-path').length === 1, show(vl()));
    const noVlanDoc = strip(lab({ coreTrunk: '10' }));
    noVlanDoc.networks.forEach((n) => delete n.vlan);
    noVlanDoc.nodes.find((n) => n.id === 'core').portAttrs = { p24: { tagged: '10' } };
    open(noVlanDoc);
    ok('with neither the port nor the NIC on a VLAN the device is not judged', !of('vlan-path').length, show(vl()));
    // Wi-Fi: a client of an access point whose uplink does not carry the
    // SSID's VLAN.
    const wifiLab = (uplink) => lab({ wifi: [{ id: 'wf', ssid: 'Cams', network: 'n20' }],
      accPorts: { p5: { tagged: uplink } },
      nodes: [{ id: 'ap', type: 'ap', name: 'AP-1', x: 0, y: 300, interfaces: [{ id: 'w1', name: 'wlan0', ip: '', radio: { standard: 'ax' } }] },
        { id: 'lt', type: 'pc', name: 'Laptop', x: 0, y: 400, gw: '10.0.20.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.0.20.9/24', radio: { standard: 'ax' } }] }],
      links: [{ id: 'k_ap', source: 'acc', target: 'ap', sourceIface: 'p5', targetIface: 'p1' },
        { id: 'k_w', source: 'ap', target: 'lt', medium: 'wireless', sourceIface: 'w1', targetIface: 'i1', wifi: { ssid: 'wf' } }] });
    open(wifiLab('10'));
    f = of('vlan-path');
    ok('a Wi-Fi client\'s SSID VLAN missing on its access point\'s uplink is flagged there', gatewayOf('lt') === 'good' && f.length === 1 && show(f[0].linkIds) === '["k_ap"]'
       && f[0].detail === 'VLAN 20 does not reach its gateway RT: AP-1 · 1 ↔ ACC · 5 does not carry it. On it: Laptop.', show(f.map((x) => x.detail)));
    open(wifiLab('10,20'));
    ok('carried, nothing', !vl().length, show(vl()));
    // A router drawn with one cable for two subnets (the Retail template's
    // shape): its cabled interface's VLAN is only its address's subnet's, a
    // fact about the NIC and not the cable, so it lets VLAN 10 through.
    const oneCable = (vlan) => ({ v: DOC_VERSION, networks: nets(),
      links: [{ id: 'ku', source: 'rt', target: 'sw', sourceIface: 'e20', targetIface: 'p1' }, { id: 'kp', source: 'sw', target: 'pc', sourceIface: 'p2', targetIface: 'i1' }],
      nodes: [{ id: 'rt', type: 'router', name: 'RT', x: 0, y: 0, interfaces: [{ id: 'e10', name: 'eth0', ip: '10.0.10.1/24' }, Object.assign({ id: 'e20', name: 'eth1', ip: '10.0.20.1/24' }, vlan ? { vlan } : {})] },
        { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 8, interfaces: [] },
        { id: 'pc', type: 'pc', name: 'PC', x: 0, y: 200, gw: '10.0.10.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.5/24' }] }] });
    open(oneCable(null));
    ok('a gateway cabled on another subnet\'s interface, with no VLAN typed on it: no finding', gatewayOf('pc') === 'good' && !vl().length, show(vl()));
    open(oneCable(20));
    ok('with VLAN 20 typed on that interface, VLAN 10 is found not to reach it', of('vlan-path').length === 1
       && of('vlan-path')[0].detail === 'VLAN 10 does not reach its gateway RT: SW · 1 ↔ RT · eth1 does not carry it. On it: PC.', show(vl()));
    // A router with one leg per VLAN (both typed), and a trunk between the
    // two access switches that lacks VLAN 20: the trunk is named, not the
    // VLAN 10 access cable to the router that never meant to carry 20.
    const twoLegs = (trunk) => ({ v: DOC_VERSION, networks: nets(),
      nodes: [{ id: 'rt', type: 'router', name: 'RT', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.10.1/24', vlan: 10 }, { id: 'e1', name: 'eth1', ip: '10.0.20.1/24', vlan: 20 }] },
        { id: 'acc', type: 'switch', name: 'ACC', x: 0, y: 100, portCount: 24, portAttrs: { p1: { vlan: 10 }, p3: { vlan: 20 }, p24: { tagged: trunk } }, interfaces: [] },
        { id: 'core', type: 'switch', name: 'CORE', x: 100, y: 100, portCount: 24, portAttrs: { p1: { vlan: 20 }, p24: { tagged: trunk } }, interfaces: [] },
        { id: 'cam', type: 'camera', name: 'CAM-1', x: 0, y: 200, gw: '10.0.20.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.5/24' }] }],
      links: [{ id: 'k_a', source: 'rt', target: 'acc', sourceIface: 'e0', targetIface: 'p1' }, { id: 'k_c', source: 'rt', target: 'core', sourceIface: 'e1', targetIface: 'p1' },
        { id: 'k_tr', source: 'acc', target: 'core', sourceIface: 'p24', targetIface: 'p24' }, { id: 'k3', source: 'acc', target: 'cam', sourceIface: 'p3', targetIface: 'i1' }] });
    open(twoLegs('10'));
    const leg = vlanPath('acc', 20, 'rt');
    ok('two router legs: vlanPath names the trunk that lacks the VLAN, not the other VLAN\'s access cable', gatewayOf('cam') === 'good' && leg && leg.ok === false && leg.link.id === 'k_tr' && leg.near === 'acc' && leg.far === 'core',
       show(leg && { l: leg.link.id, n: leg.near, f: leg.far }));
    ok('and so does the finding', of('vlan-path').length === 1 && show(of('vlan-path')[0].linkIds) === '["k_tr"]'
       && of('vlan-path')[0].detail === 'VLAN 20 does not reach its gateway RT: ACC · 24 ↔ CORE · 24 does not carry it. On it: CAM-1.', show(vl()));
    open(twoLegs('10,20'));
    ok('the trunk carrying it: nothing', !vl().length, show(vl()));
    // The gate itself: the same device judged only when its gateway check
    // says good (a resolvable gateway, a VLAN-blind path, a break on VLAN 20).
    open(lab({ coreTrunk: '10' }));
    const everyone = new Set(state.nodes.map((n) => n.id));
    const gated = (good) => withLookupPass(() => vlanFindings(reachContext(), good)).filter((x) => x.key === 'vlan-path');
    const withAll = gated(everyone), withoutCams = gated(new Set([...everyone].filter((id) => id !== 'cam' && id !== 'cam2')));
    ok('vlan-path judges a device only when its gateway check is good', withAll.length === 1 && ids(withAll[0]).includes('cam') && !withoutCams.length,
       show({ withAll: withAll.map((x) => x.detail), withoutCams: withoutCams.map((x) => x.detail) }));

    // ---- 3. vlan-mismatch ----
    open(lab({ accPorts: { p6: { vlan: 20 } }, nodes: [{ id: 'pc3', type: 'pc', name: 'PC-3', x: 0, y: 300, gw: '10.0.10.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.7/24' }] }],
      links: [{ id: 'k6', source: 'pc3', target: 'acc', sourceIface: 'i1', targetIface: 'p6' }] }));
    f = of('vlan-mismatch');
    ok('a device on the wrong access port: one critical mismatch', f.length === 1 && f[0].level === 'bad', show(vl()));
    ok('its words, by the network\'s name', f[0] && f[0].detail === 'PC-3 is on Staff (VLAN 10) but plugged into ACC · 6, which is VLAN 20.', f[0] && f[0].detail);
    ok('naming both ends and the cable', f[0] && ids(f[0]) === 'acc,pc3' && show(f[0].linkIds) === '["k6"]' && f[0].check === 'VLAN mismatch' && f[0].subject === 'PC-3 ↔ ACC');
    ok('the path is walked on the port\'s VLAN, which does reach its gateway: no vlan-path', !of('vlan-path').length, show(vl()));
    getNode('pc3').interfaces[0].vlan = 30; save();
    ok('a NIC on its own VLAN (no network has it): by the number', of('vlan-mismatch')[0] && of('vlan-mismatch')[0].detail === 'PC-3 is on VLAN 30 but plugged into ACC · 6, which is VLAN 20.', show(of('vlan-mismatch')));
    open(lab({ accTrunk: '10,20' }));
    getNode('core').portAttrs.p24 = { vlan: 1, tagged: '10,20' }; getNode('acc').portAttrs.p24 = { vlan: 99, tagged: '10,20' }; save();
    f = of('vlan-mismatch');
    ok('two ports with different native VLANs: critical', f.length === 1 && f[0].level === 'bad' && f[0].detail === 'CORE · 24 and ACC · 24 are cabled together with different untagged VLANs (1 and 99).', show(f));
    ok('a trunk\'s native VLAN is no vlan-subnet finding', !of('vlan-subnet').length, show(vl()));
    getNode('core').portAttrs.p24 = { vlan: 20, tagged: '10' }; getNode('acc').portAttrs.p24 = { tagged: '10,20,30,31' }; save();
    f = of('vlan-mismatch');
    ok('tagged at one end and untagged at the other, and tagged at one end only: one advisory per cable', f.length === 1 && f[0].level === 'warn'
       && f[0].detail === 'CORE · 24 and ACC · 24 disagree on what the cable carries: VLANs 30, 31 are tagged at one end only. VLAN 20 is tagged at one end and untagged at the other.', show(f));
    ok('VLAN 20 still crosses it (untagged at one end, tagged at the other both carry it)', !of('vlan-path').length, show(vl()));
    getNode('core').portAttrs.p24 = { tagged: 'all' }; getNode('acc').portAttrs.p24 = { tagged: '10,20' }; save();
    ok('an "all" trunk against a list: nothing to say', !vl().length, show(vl()));
    getNode('acc').portAttrs.p24 = { vlan: 5, tagged: '10,20' }; save();
    ok('an "all" trunk against a native VLAN it would tag: the advisory', of('vlan-mismatch').length === 1 && /VLAN 5 is tagged at one end and untagged at the other\./.test(of('vlan-mismatch')[0].detail), show(of('vlan-mismatch')));
    open(lab({ coreTrunk: '30', accTrunk: '40' }));
    state.links.find((l) => l.id === 'k_tr').medium = 'wireless'; save();
    ok('a radio link between the same ends is skipped by the mismatch check', !of('vlan-mismatch').length, show(of('vlan-mismatch')));
    state.links.find((l) => l.id === 'k_tr').medium = 'vpn'; save();
    ok('a VPN tunnel too', !of('vlan-mismatch').length, show(of('vlan-mismatch')));
    open({ v: DOC_VERSION, networks: nets(), links: [{ id: 'kb', source: 'hv', target: 'vm', sourceIface: 'i1', targetIface: 'i1', attachment: 'bridged' }],
      nodes: [{ id: 'hv', type: 'server', name: 'HV', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.9/24', tagged: '30' }] },
        { id: 'vm', type: 'vm', name: 'VM', x: 0, y: 100, host: 'hv', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.9/24' }] }] });
    ok('a VM\'s bridged link is skipped', !of('vlan-mismatch').length, show(vl()));
    open({ v: DOC_VERSION, networks: nets(), links: [{ id: 'ks', source: 'l3', target: 'sw', sourceIface: 'i2', targetIface: 'p1' }],
      nodes: [{ id: 'l3', type: 'l3switch', name: 'L3', x: 0, y: 0, interfaces: [{ id: 'i2', name: 'eth1', ip: '10.0.20.1/24', tagged: '20' }] },
        { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 8, portAttrs: { p1: { tagged: '20' } }, interfaces: [] }] });
    ok('an SVI on a trunk (its address\'s VLAN in its tagged list) reads as tagged, not untagged', portVlans(getNode('l3'), 'i2').untagged === null && !vl().length, show(vl()));
    // An uplink with nothing typed on the device's side (its VLAN only its
    // subnet's) facing a documented trunk port: the device's end takes no
    // part in the tagged comparison, as vlanPath walks through it.
    const uplink = (port, dev) => ({ v: DOC_VERSION, networks: nets().concat([{ id: 'n99', cidr: '10.0.99.0/24', name: 'Mgmt', vlan: 99 }]),
      links: [{ id: 'ku', source: 'sw', target: 'd', sourceIface: 'p1', targetIface: 'i1' }],
      nodes: [{ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8, portAttrs: { p1: port }, interfaces: [] },
        Object.assign({ id: 'd', x: 0, y: 100, interfaces: [Object.assign({ id: 'i1', name: 'eth0' }, dev.iface)] }, dev.node)] });
    const ap = { node: { type: 'ap', name: 'AP' }, iface: { ip: '10.0.99.5/24' } };
    open(uplink({ vlan: 99, tagged: '30' }, ap));
    ok('an AP managed on the native VLAN, nothing typed on its uplink, facing a trunk tagging its SSID VLAN: no mismatch', portVlans(getNode('d'), 'i1').derived === true && !of('vlan-mismatch').length, show(vl()));
    open(uplink({ tagged: '10,20' }, { node: { type: 'router', name: 'RT' }, iface: { ip: '10.0.10.1/24' } }));
    ok('a router on a stick with nothing typed on its interface, facing a trunk port: no mismatch', !of('vlan-mismatch').length, show(vl()));
    open(uplink({ tagged: '10,20' }, { node: { type: 'router', name: 'RT' }, iface: { ip: '10.0.10.1/24', vlan: 10 } }));
    ok('the same router with VLAN 10 typed on it: the advisory, as before', of('vlan-mismatch').length === 1 && of('vlan-mismatch')[0].level === 'warn', show(vl()));
    open(uplink({ vlan: 10, tagged: '20,99' }, ap));
    ok('a device with nothing typed on a trunk port that tags its subnet\'s VLAN: not plugged into the wrong port', !of('vlan-mismatch').length, show(vl()));
    open(uplink({ vlan: 10, tagged: '20' }, ap));
    ok('a trunk port that does not carry its subnet\'s VLAN at all: still the critical mismatch', of('vlan-mismatch').length === 1 && of('vlan-mismatch')[0].level === 'bad'
       && of('vlan-mismatch')[0].detail === 'AP is on Mgmt (VLAN 99) but plugged into SW · 1, which is VLAN 10.', show(vl()));
    open(uplink({ vlan: 10, tagged: '20,99' }, { node: { type: 'ap', name: 'AP' }, iface: { ip: '10.0.99.5/24', vlan: 99 } }));
    ok('with VLAN 99 typed as its untagged one: still the critical mismatch', of('vlan-mismatch').length === 1 && of('vlan-mismatch')[0].level === 'bad', show(vl()));

    // ---- 4. vlan-subnet ----
    open(lab({ accPorts: { p7: { vlan: 30 }, p8: { vlan: 30 }, p9: { tagged: '40' }, p10: { vlan: 1, tagged: '10' } } }));
    getNode('core').portAttrs.p9 = { vlan: 31 }; save();
    f = of('vlan-subnet');
    ok('one advisory per VLAN no subnet has', f.length === 2 && f.every((x) => x.level === 'warn') && show(f.map((x) => x.scope)) === '["vlan:30","vlan:31"]', show(f));
    ok('naming the switch and its ports, plural', f[0] && f[0].detail === 'VLAN 30 is untagged on ACC · 7, ACC · 8, but no subnet has it (2 ports).' && ids(f[0]) === 'acc', f[0] && f[0].detail);
    ok('singular', f[1] && f[1].detail === 'VLAN 31 is untagged on CORE · 9, but no subnet has it.' && ids(f[1]) === 'core' && f[1].check === 'VLAN subnet', f[1] && f[1].detail);
    ok('a tagged-only VLAN (transit) and a trunk\'s native VLAN are left alone', !f.some((x) => /VLAN (40|1) /.test(x.detail)));
    getNode('core').status = 'retired'; save();
    ok('a retired switch\'s ports are not judged', of('vlan-subnet').length === 1, show(of('vlan-subnet')));

    // ---- 5. Accepting ----
    open(lab({ coreTrunk: '30', accTrunk: '30' }));
    f = of('vlan-path');
    ok('a trunk carrying neither: one finding per VLAN on the same cable', f.length === 2 && show(f.map((x) => x.scope).sort()) === '["vlan:10","vlan:20"]', show(f));
    acceptFindings(f.filter((x) => x.scope === 'vlan:20'), 'Cameras move next week');
    ok('accepting VLAN 20\'s covers only that VLAN', of('vlan-path').filter((x) => !x.accepted).map((x) => x.scope).join() === 'vlan:10'
       && of('vlan-path').find((x) => x.scope === 'vlan:20').accepted, show(of('vlan-path').map((x) => [x.scope, !!x.accepted])));
    state.nodes.push({ id: 'cam3', type: 'camera', name: 'CAM-3', x: 0, y: 300, gw: '10.0.20.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.8/24' }] });
    state.links.push({ id: 'k7', source: 'acc', target: 'cam3', sourceIface: 'p7', targetIface: 'i1' });
    save();
    ok('a new device behind it reopens it', of('vlan-path').filter((x) => !x.accepted).length === 2, show(of('vlan-path').map((x) => [x.scope, !!x.accepted])));

    // ---- 6. Counted and read ----
    open(lab({ coreTrunk: '10', accTrunk: '10', accPorts: { p7: { vlan: 30 } } }));
    const c = findingCounts(topologyFindings());
    ok('counted: vlan-path critical, vlan-subnet advisory', c.critical === 1 && c.advisory === 1, show(c));
    ok('the check names', ['vlan-path', 'vlan-subnet', 'vlan-mismatch'].map(findingCheckName).join('|') === 'VLAN path|VLAN subnet|VLAN mismatch');
    const plainWords = ['vlan-path', 'vlan-subnet', 'vlan-mismatch'].map((k) => PLAIN_FINDINGS[k]);
    ok('PLAIN_FINDINGS has all three, and none says VLAN or PoE', plainWords.every((p) => Array.isArray(p) && p.length === 2 && p.every((s) => !/PoE|VLAN/.test(s))), show(plainWords));
    const sheet = summarySheet(reportModel());
    ok('the Simple summary says them in plain words', sheet.includes('Part of the network cannot reach its way out') && sheet.includes('A switch port is set up for a network that has no addresses recorded'));

    // ---- 7. Locate's cross-check ----
    open(lab({ accPorts: { p6: { vlan: 20 } }, nodes: [{ id: 'pc3', type: 'pc', name: 'PC-3', x: 0, y: 300, gw: '10.0.10.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.7/24' }] }],
      links: [{ id: 'k6', source: 'pc3', target: 'acc', sourceIface: 'i1', targetIface: 'p6' }] }));
    let html = locatePanelHtml(locatePath(getNode('pc3')));
    ok('Locate shows the open vlan-mismatch on the device\'s cable, in its words', /class="locate-finding bad" data-loc-finding="vlan-mismatch"/.test(html)
       && html.includes(escapeHtml('PC-3 is on Staff (VLAN 10) but plugged into ACC · 6, which is VLAN 20.')), html.slice(0, 400));
    ok('and none on a clean device', !/locate-finding/.test(locatePanelHtml(locatePath(getNode('pc1')))));
    acceptFindings(of('vlan-mismatch'), 'Desk swap in progress');
    html = locatePanelHtml(locatePath(getNode('pc3')));
    ok('accepted, it is no longer shown', !/locate-finding/.test(html));
    open({ v: DOC_VERSION, links: [{ id: 'kp', source: 'sw', target: 'cam', sourceIface: 'p2', targetIface: 'i1' }],
      nodes: [{ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8, poeBudget: 60, interfaces: [] },
        { id: 'cam', type: 'camera', name: 'CAM', x: 0, y: 100, poeDraw: 6.49, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }] });
    html = locatePanelHtml(locatePath(getNode('cam')));
    ok('a poe-none on the cable likewise', /data-loc-finding="poe-none"/.test(html) && html.includes('gives no PoE'), html.slice(0, 300));

    // ---- 8. The samples ----
    replaceDocument(cloneData(templatesData.showcase), { origin: 'template' });
    const ssw = getNode('ssw');
    ok('the Full Showcase has a clean trunk: the Studio uplink tagged 20 at both ends, its access ports VLAN 20',
       portVlans(ssw, 'p1').tagged instanceof Set && portVlans(ssw, 'p1').tagged.has(20) && portVlans(getNode('l3'), 'i3').tagged.has(20)
       && portVlans(getNode('l3'), 'i3').untagged === null && portVlans(ssw, 'p2').untagged === 20);
    ok('and still opens with no finding at all', !topologyFindings().filter(isCountedFinding).length && !vl().length, show(topologyFindings().map((f) => f.line)));
    const noisy = [], strippedDiff = [];
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'template' });
      if (vl().length) noisy.push(k + ': ' + vl().map((x) => x.line).join(' / '));
      const all = topologyFindings().map((x) => `${x.key}|${x.line}`).sort().join('\n');
      replaceDocument(strip(cloneData(templatesData[k])), { origin: 'template' });
      if (topologyFindings().map((x) => `${x.key}|${x.line}`).sort().join('\n') !== all) strippedDiff.push(k);
    });
    ok('no template or simple sample raises a VLAN finding', !noisy.length && Object.keys(templatesData).length > 30, noisy.join('; '));
    ok('every template\'s findings are the same with its VLAN facts stripped', !strippedDiff.length, strippedDiff.join(', '));

    // ---- 9. The words ----
    open(lab({ coreTrunk: '10', accTrunk: '10,20', accPorts: { p7: { vlan: 30 }, p8: { vlan: 30 }, p6: { vlan: 20 } },
      nodes: [{ id: 'pc3', type: 'pc', name: 'PC-3', x: 0, y: 300, gw: '10.0.10.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.7/24' }] }],
      links: [{ id: 'k6', source: 'pc3', target: 'acc', sourceIface: 'i1', targetIface: 'p6' }] }));
    const english = vl().map((x) => x.detail).sort();
    const left = [];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      setLocale(loc);
      diagnosisMemo = null;
      const words = vl().map((x) => x.detail).sort();
      if (words.length !== english.length) left.push(`${loc}: ${words.length} findings`);
      words.forEach((w) => { if (/\{[a-z]+\}/.test(w)) left.push(`${loc}: placeholder in ${w}`); if (english.includes(w)) left.push(`${loc}: English ${w}`); });
      ['VLAN path', 'VLAN subnet', 'VLAN mismatch'].forEach((k) => { if (t(k) === k) left.push(`${loc}: check name ${k}`); });
      const sum = summarySheet(reportModel());
      if (/\{[a-z]+\}/.test(sum)) left.push(`${loc}: placeholder in the summary`);
      if (sum.includes('Part of the network cannot reach its way out')) left.push(`${loc}: plain words English`);
      if (loc === 'ru' && !vl().some((x) => x.detail.includes('(портов: 2)'))) left.push('ru: the port count out of the plural');
    });
    setLocale('en');
    ok('four kinds of VLAN finding in English', english.length === 4, show(english));
    ok('every VLAN finding, check name and plain sentence is translated in es, pt-BR, ja and ru', !left.length, left.join('; '));
  } catch (e) {
    ok('vlanchecks suite ran without throwing', false, e && e.stack);
  } finally {
    setLocale('en');
    setDialogResponder(heldResponder);
  }

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
