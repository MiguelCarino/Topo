// VLANs, trunks and PoE, stage 3 (docs/BACKLOG.md feature 4, landing order
// step 15): the VLAN-aware Trace. reachL2Domain and reachWalk take the VLAN
// being walked (the start's access VLAN; after a router hop the VLAN of the
// declared subnet it hops into), a router or another L3 neighbour is
// reached only through a link that carries that VLAN, and a router walks
// each of its subnets on its own VLAN. Only the Trace does this, behind the
// VLAN tick (state.settings.traceVlan, on by default, not persisted); the
// findings' reachContext stays VLAN-blind. What is held here:
//   1. with no VLAN facts, the VLAN-aware trace is today's trace, nodes and
//      links, from every device of every template (and of every template
//      with its VLAN facts stripped, and the Full Showcase with its trunk);
//   2. with facts: a VLAN 20 camera behind a trunk that lacks 20 reaches
//      its VLAN 20 neighbour but not the router nor the VLAN 10 PCs behind
//      it, and the links past the trunk stay dark; carried, it reaches the
//      router and, routed, the PCs on VLAN 10; the PCs on VLAN 10 still reach
//      everything; a start router walks VLAN 10 and 20 each by its own;
//      a router whose leg for a VLAN is cut does not route into it; a PC on
//      Staff plugged into a VLAN 20 port reaches neither its gateway nor
//      Staff; a Wi-Fi client walks its SSID's VLAN from its access point;
//      a managed switch starts on its management VLAN; a dumb switch start
//      lights its whole fabric;
//   3. unticking VLAN (state.settings.traceVlan false, or opts.vlan false)
//      gives today's result; a call naming its port (the checks') is
//      VLAN-blind; reachContext equals the VLAN-blind walk, never the VLAN
//      one, so the gateway check is unchanged and the break is vlan-path's;
//   4. the Trace box: the VLAN tick beside Port filter, ticked by default,
//      unticking redraws the trace and the status line; "→ 1 device · VLAN
//      20", "→ 5 devices · VLAN 10,20" from a router, no VLAN part unticked
//      or with no VLAN known; traceVlan never saved with the settings;
//   5. es, pt-BR, ja and ru for the status line and the tick's title.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const el = (id) => document.getElementById(id);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const heldSettings = { traceMode: state.settings.traceMode, tracePort: state.settings.tracePort, tracePortOn: state.settings.tracePortOn, traceVlan: state.settings.traceVlan };
  setLocale('en');
  const nets = () => [{ id: 'n10', cidr: '10.0.10.0/24', name: 'Staff', vlan: 10 }, { id: 'n20', cidr: '10.0.20.0/24', name: 'Cams', vlan: 20 }];
  // RT (a router on a stick: eth0 trunks 10 and 20, its subinterfaces hold
  // the gateways) - CORE (managed, an address on Staff) - ACC (access: PCs on
  // p1/p2 untagged, cameras on p3/p4 VLAN 20).
  const lab = (opts = {}) => {
    const core = { id: 'core', type: 'switch', name: 'CORE', x: 0, y: 0, portCount: 24,
      portAttrs: { p1: { tagged: '10,20' }, p24: { tagged: opts.coreTrunk || '10,20' } }, interfaces: [{ id: 'm', name: 'mgmt', ip: '10.0.10.2/24' }] };
    const acc = { id: 'acc', type: 'switch', name: 'ACC', x: 0, y: 100, portCount: 24,
      portAttrs: Object.assign({ p24: { tagged: opts.accTrunk || '10,20' }, p1: { vlan: 10 }, p2: { vlan: 10 }, p3: { vlan: 20 }, p4: { vlan: 20 } }, opts.accPorts || {}), interfaces: [] };
    const host = (id, name, ip, gw, extra) => Object.assign({ id, type: 'pc', name, x: 0, y: 200, gw, interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra || {});
    return { v: DOC_VERSION, networks: nets(), wifi: opts.wifi || [],
      nodes: [
        { id: 'rt', type: 'router', name: 'RT', x: 0, y: -100, interfaces: [{ id: 'e0', name: 'eth0', ip: '', tagged: opts.rtTrunk || '10,20' },
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
  const aware = (id) => calculateReachability(id, { port: '', vlan: true });
  const blind = (id) => calculateReachability(id, { port: '', vlan: false });
  const sorted = (set) => [...set].sort().join(',');
  const same = (a, b) => sorted(a.reachableNodes) === sorted(b.reachableNodes) && sorted(a.reachableLinks) === sorted(b.reachableLinks);
  const gatewayOf = (id) => (nodeDiagnosis(getNode(id)).checks.find((c) => c.key === 'gateway') || {}).level;

  try {
    state.settings.tracePort = ''; state.settings.tracePortOn = false;

    // ---- 1. No VLAN facts: today's trace ----
    {
      let checked = 0;
      const differs = [];
      const sweep = (label, doc) => {
        replaceDocument(doc, { origin: 'template' });
        withLookupPass(() => state.nodes.forEach((n) => {
          checked++;
          if (!same(aware(n.id), blind(n.id))) differs.push(`${label}/${n.name || n.id}`);
        }));
      };
      Object.keys(templatesData).forEach((k) => {
        sweep(k, cloneData(templatesData[k]));
        sweep(k + ' stripped', strip(cloneData(templatesData[k])));
      });
      ok('with no VLAN facts the VLAN-aware trace is today\'s, nodes and links, from every device of every template (stripped too, the Showcase trunk too)',
        !differs.length && checked > 400, differs.slice(0, 6).join(', ') || `${checked} traces`);
      open(strip(lab()));
      ok('and the lab with its VLAN facts stripped likewise', state.nodes.every((n) => same(aware(n.id), blind(n.id))));
    }

    // ---- 2. With facts ----
    open(lab());
    ok('the clean lab: from CAM-1 the VLAN-aware trace reaches the router and, routed, the PCs on VLAN 10',
      ['rt', 'cam2', 'pc1', 'pc2', 'core', 'acc'].every((id) => aware('cam').reachableNodes.has(id)), sorted(aware('cam').reachableNodes));
    ok('and it is today\'s trace there', same(aware('cam'), blind('cam')), sorted(aware('cam').reachableNodes) + ' / ' + sorted(blind('cam').reachableNodes));
    ok('a start router walks VLAN 10 and 20 each by its own', same(aware('rt'), blind('rt')) && show(aware('rt').vlans) === '[10,20]', show(aware('rt').vlans));

    open(lab({ accTrunk: '10' }));
    let r = aware('cam');
    ok('a VLAN 20 camera behind a trunk that lacks 20 reaches its VLAN 20 neighbour', r.reachableNodes.has('cam2') && r.reachableNodes.has('acc') && show(r.vlans) === '[20]', sorted(r.reachableNodes));
    ok('but not the router, nor the VLAN 10 PCs behind it', !r.reachableNodes.has('rt') && !r.reachableNodes.has('pc1') && !r.reachableNodes.has('pc2'), sorted(r.reachableNodes));
    ok('and the trunk and the links past it stay dark', !r.reachableLinks.has('k_tr') && !r.reachableLinks.has('k_up') && !r.reachableLinks.has('k1')
       && r.reachableLinks.has('k3') && r.reachableLinks.has('k4'), sorted(r.reachableLinks));
    ok('VLAN-blind, the same camera reaches them all (today\'s trace)', ['rt', 'pc1', 'pc2'].every((id) => blind('cam').reachableNodes.has(id)));
    ok('the PCs on VLAN 10 still reach the router and the other PC', ['rt', 'pc2', 'core'].every((id) => aware('pc1').reachableNodes.has(id)) && show(aware('pc1').vlans) === '[10]');
    ok('routed from VLAN 10, the cameras are not reached either (the router\'s VLAN 20 leg does not get there)',
      !aware('pc1').reachableNodes.has('cam') && !aware('pc1').reachableNodes.has('cam2'), sorted(aware('pc1').reachableNodes));
    ok('the router reaches VLAN 10 but not VLAN 20', aware('rt').reachableNodes.has('pc1') && !aware('rt').reachableNodes.has('cam'), sorted(aware('rt').reachableNodes));
    ok('the findings stay VLAN-blind: the camera\'s gateway check is still good, the break is vlan-path\'s', gatewayOf('cam') === 'good'
       && topologyFindings().filter((f) => f.key === 'vlan-path').length === 1, show(topologyFindings().map((f) => f.key)));
    // The router's own leg lacking VLAN 20.
    open(lab({ rtTrunk: '10' }));
    ok('a router whose trunk does not carry VLAN 20 does not route into it', !aware('pc1').reachableNodes.has('cam') && aware('pc1').reachableNodes.has('rt')
       && aware('cam').reachableNodes.has('cam2') && !aware('cam').reachableNodes.has('rt'), sorted(aware('pc1').reachableNodes));
    // A PC on Staff plugged into a VLAN 20 port.
    open(lab({ accPorts: { p6: { vlan: 20 } },
      nodes: [{ id: 'pc3', type: 'pc', name: 'PC-3', x: 0, y: 300, gw: '10.0.10.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.7/24' }] }],
      links: [{ id: 'k6', source: 'pc3', target: 'acc', sourceIface: 'i1', targetIface: 'p6' }] }));
    r = aware('pc3');
    ok('a PC on Staff plugged into a VLAN 20 port walks VLAN 20 and reaches neither its gateway nor Staff', show(r.vlans) === '[20]'
       && !r.reachableNodes.has('rt') && !r.reachableNodes.has('pc1') && !r.reachableNodes.has('cam'), sorted(r.reachableNodes));
    ok('nor CORE, whose management address is on Staff: its links light (frames cross it), the box is not reached', !r.reachableNodes.has('core')
       && r.reachableLinks.has('k_tr') && r.reachableNodes.has('acc'), sorted(r.reachableNodes));
    ok('VLAN-blind it reaches them', blind('pc3').reachableNodes.has('rt') && blind('pc3').reachableNodes.has('pc1'));
    // A managed switch is reached on its management subnet's VLAN only.
    {
      const d = lab({ accTrunk: '10', coreTrunk: '10' });
      d.nodes.find((n) => n.id === 'acc').interfaces = [{ id: 'm', name: 'mgmt', ip: '10.0.20.3/24' }];
      open(d);
      r = aware('rt');
      ok('a router does not reach a switch whose management address is on a VLAN it walked no path to', !r.reachableNodes.has('acc')
         && r.reachableNodes.has('pc1') && !aware('acc').reachableNodes.has('rt'), sorted(r.reachableNodes));
    }
    // A router with an address on a subnet with no VLAN (an undeclared WAN):
    // that subnet is walked untagged, never across a trunk that does not
    // carry it natively, so it opens no VLAN.
    {
      const d = lab({ rtTrunk: '10', accPorts: { p5: { vlan: 20 } },
        nodes: [{ id: 'cloud', type: 'cloud', name: 'ISP', x: 200, y: -200, interfaces: [] },
          { id: 'camsw', type: 'switch', name: 'CAMSW', x: 0, y: 300, portCount: 8, interfaces: [{ id: 'm', name: 'mgmt', ip: '10.0.20.3/24' }] },
          { id: 'cam3', type: 'camera', name: 'CAM-3', x: 0, y: 400, gw: '10.0.20.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.7/24' }] }],
        links: [{ id: 'k_wan', source: 'rt', target: 'cloud', sourceIface: 'wan' },
          { id: 'k_cs', source: 'acc', target: 'camsw', sourceIface: 'p5', targetIface: 'p1' },
          { id: 'k_c3', source: 'camsw', target: 'cam3', sourceIface: 'p2', targetIface: 'i1' }] });
      d.nodes.find((n) => n.id === 'rt').interfaces.push({ id: 'wan', name: 'wan', ip: '203.0.113.2/30' });
      open(d);
      r = aware('rt');
      ok('a router\'s undeclared WAN subnet does not light the fabric of a VLAN its trunk lacks', r.reachableNodes.has('cloud') && r.reachableLinks.has('k_wan')
         && !r.reachableNodes.has('camsw') && !r.reachableLinks.has('k_cs') && !r.reachableNodes.has('cam3') && r.reachableNodes.has('pc1'),
         sorted(r.reachableNodes) + ' / ' + sorted(r.reachableLinks));
      ok('and the WAN adds no VLAN to the status line', show(r.vlans) === '[10,20]', show(r.vlans));
    }
    {
      const d = lab({ rtTrunk: '10',
        nodes: [{ id: 'sw3', type: 'switch', name: 'SW3', x: 200, y: 0, portCount: 8, portAttrs: { p1: { tagged: '20' } }, interfaces: [] }],
        links: [{ id: 'k_s3', source: 'core', target: 'sw3', sourceIface: 'p3', targetIface: 'p1' }] });
      d.nodes.find((n) => n.id === 'core').portAttrs.p3 = { tagged: '20' };
      d.nodes.find((n) => n.id === 'rt').interfaces.push({ id: 'wan', name: 'wan', ip: '198.51.100.2/30' });
      open(d);
      r = aware('pc1');
      ok('nor, routed into from a PC, a switch behind a trunk carrying only VLAN 20', r.reachableNodes.has('rt') && !r.reachableNodes.has('sw3') && !r.reachableLinks.has('k_s3'),
         sorted(r.reachableNodes) + ' / ' + sorted(r.reachableLinks));
    }
    {
      const d = lab({ accTrunk: '10', accPorts: { p8: { vlan: 20 } },
        nodes: [{ id: 'h5', type: 'pc', name: 'H-5', x: 0, y: 300, gw: '192.168.5.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.5.10/24' }] }],
        links: [{ id: 'k8', source: 'acc', target: 'h5', sourceIface: 'p8', targetIface: 'i1' }] });
      d.nodes.find((n) => n.id === 'rt').interfaces.push({ id: 'e5', name: 'eth0.5', ip: '192.168.5.1/24' });
      open(d);
      ok('a router does not reach a host on an undeclared subnet behind a trunk, nor the host it (both ways alike)',
        !aware('rt').reachableNodes.has('h5') && !aware('h5').reachableNodes.has('rt'), sorted(aware('rt').reachableNodes));
    }
    // A retired start walks nothing, so it names no VLAN.
    {
      const d = lab();
      d.nodes.find((n) => n.id === 'cam').status = 'retired';
      open(d);
      ok('a retired start names no VLAN', show(aware('cam').vlans) === '[]' && aware('cam').reachableNodes.size === 1, show(aware('cam').vlans));
    }
    // Wi-Fi: the client walks its SSID's VLAN from its access point.
    const wifiLab = (uplink) => lab({ wifi: [{ id: 'wf', ssid: 'Cams', network: 'n20' }],
      accPorts: { p5: { tagged: uplink } },
      nodes: [{ id: 'ap', type: 'ap', name: 'AP-1', x: 0, y: 300, interfaces: [{ id: 'w1', name: 'wlan0', ip: '', radio: { standard: 'ax' } }] },
        { id: 'lt', type: 'pc', name: 'Laptop', x: 0, y: 400, gw: '10.0.20.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.0.20.9/24', radio: { standard: 'ax' } }] }],
      links: [{ id: 'k_ap', source: 'acc', target: 'ap', sourceIface: 'p5', targetIface: 'p1' },
        { id: 'k_w', source: 'ap', target: 'lt', medium: 'wireless', sourceIface: 'w1', targetIface: 'i1', wifi: { ssid: 'wf' } }] });
    open(wifiLab('10'));
    r = aware('lt');
    ok('a Wi-Fi client walks its SSID\'s VLAN: its AP\'s uplink lacking it, the cameras are out of reach', show(r.vlans) === '[20]' && r.reachableNodes.has('ap')
       && !r.reachableNodes.has('cam') && !r.reachableNodes.has('rt'), sorted(r.reachableNodes));
    open(wifiLab('10,20'));
    r = aware('lt');
    ok('carried, it reaches them and the router', r.reachableNodes.has('cam') && r.reachableNodes.has('rt'), sorted(r.reachableNodes));
    // A managed switch starts on its management VLAN.
    open(lab({ accTrunk: '20', coreTrunk: '20' }));
    r = aware('core');
    ok('a managed switch starts on its management VLAN (10): the router, but not the PCs past a trunk that lacks 10', show(r.vlans) === '[10]'
       && r.reachableNodes.has('rt') && !r.reachableNodes.has('pc1'), sorted(r.reachableNodes));
    // A dumb switch start: its whole fabric, then each device on its own VLAN.
    open(lab({ accTrunk: '10' }));
    r = aware('acc');
    ok('a dumb switch start lights its fabric and every device cabled to it, with no VLAN of its own', show(r.vlans) === '[]'
       && ['pc1', 'cam', 'cam2'].every((id) => r.reachableNodes.has(id)), sorted(r.reachableNodes));

    // ---- 3. The tick, the checks' walks ----
    open(lab({ accTrunk: '10' }));
    state.settings.traceVlan = true;
    ok('the trace\'s own walk (no options) is VLAN-aware while the tick is on', !calculateReachability('cam').reachableNodes.has('rt'));
    state.settings.traceVlan = false;
    ok('unticked, it is today\'s trace', same(calculateReachability('cam'), blind('cam')) && show(calculateReachability('cam').vlans) === '[]');
    state.settings.traceVlan = true;
    ok('a call that names its port (the checks\') is VLAN-blind', same(calculateReachability('cam', { port: '' }), blind('cam')));
    ok('calculateBaseReachability is VLAN-blind', same(calculateBaseReachability('cam'), blind('cam')));
    {
      const differs = [];
      withLookupPass(() => {
        const ctx = reachContext();
        state.nodes.forEach((n) => { const a = ctx.reach(n.id); if (!same(a, blind(n.id))) differs.push(n.id); });
      });
      ok('reachContext (the findings\' shared walk) equals the VLAN-blind walk from every device', !differs.length, differs.join(','));
    }
    ok('the VLAN-aware walk differs there, so the comparison means something', !same(aware('cam'), blind('cam')));
    // With a port filter too: the port pass runs on the VLAN's reach.
    getNode('cam2').allowedPorts = '554';
    state.settings.tracePort = '554'; state.settings.tracePortOn = true;
    r = calculateReachability('cam');
    ok('the port filter runs on the VLAN\'s reach and keeps the VLAN', r.reachableNodes.has('cam2') && !r.reachableNodes.has('rt') && show(r.vlans) === '[20]', sorted(r.reachableNodes));
    state.settings.tracePort = ''; state.settings.tracePortOn = false;

    // ---- 4. The Trace box ----
    ok('the VLAN tick sits beside Port filter, ticked', !!el('traceVlan') && el('traceVlan').checked && el('traceVlan').closest('.trace-port-row') === el('tracePortToggle').closest('.trace-port-row'));
    ok('state.settings.traceVlan is on by default', state.settings.traceVlan !== false);
    select('cam', 'node'); setTraceMode(true); renderCanvasOnly();
    ok('the status line: "→ 1 device · VLAN 20"', el('traceStatus').textContent === '→ 1 device · VLAN 20', el('traceStatus').textContent);
    el('traceVlan').click();
    ok('unticking redraws the trace: "→ 5 devices", traceVlan false', state.settings.traceVlan === false && el('traceStatus').textContent === '→ 5 devices', el('traceStatus').textContent);
    el('traceVlan').click();
    ok('ticked again: "→ 1 device · VLAN 20"', state.settings.traceVlan === true && el('traceStatus').textContent === '→ 1 device · VLAN 20', el('traceStatus').textContent);
    open(lab());
    select('rt', 'node'); renderCanvasOnly();
    ok('from the router: "→ 5 devices · VLAN 10,20" (the unaddressed ACC not counted)', el('traceStatus').textContent === '→ 5 devices · VLAN 10,20', el('traceStatus').textContent);
    open(strip(lab()));
    state.networks.forEach((n) => { delete n.vlan; });
    select('pc1', 'node'); renderCanvasOnly();
    ok('no VLAN known: no VLAN part', /^→ \d+ devices$/.test(el('traceStatus').textContent), el('traceStatus').textContent);
    state.settings.traceVlan = false; syncTraceControls();
    ok('syncTraceControls mirrors the setting', el('traceVlan').checked === false);
    saveSettings();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { /* private mode */ }
    ok('traceVlan is never saved with the settings', !('traceVlan' in saved), show(saved));
    state.settings.traceVlan = true; syncTraceControls();

    // ---- 5. The words ----
    open(lab({ accTrunk: '10' }));
    select('cam', 'node'); renderCanvasOnly();
    const words = {};
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      setLocale(loc); applyLocale(); renderCanvasOnly();
      words[loc] = { status: el('traceStatus').textContent, title: el('traceVlan').closest('label').title };
    });
    setLocale('en'); applyLocale(); renderCanvasOnly();
    const enTitle = el('traceVlan').closest('label').title;
    const bad = Object.entries(words).filter(([, w]) => !/· VLAN 20$/.test(w.status) || /\{/.test(w.status) || w.title === enTitle || !w.title);
    ok('the status line and the tick\'s title in es, pt-BR, ja and ru', !bad.length && /Follow one VLAN/.test(enTitle), show(words));
    ok('Russian keeps the count out of the plural, Japanese counts 台', words.ru.status === '→ устройств: 1 · VLAN 20' && words.ja.status === '→ 1 台 · VLAN 20', show(words));
    setTraceMode(false);
  } catch (e) {
    ok('vlantrace suite ran without throwing', false, e && e.stack);
  } finally {
    setLocale('en'); applyLocale();
    Object.assign(state.settings, heldSettings);
    setDialogResponder(heldResponder);
  }

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
