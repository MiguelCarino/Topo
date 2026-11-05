// Capacity, stage 1 (docs/BACKLOG.md feature 2, landing order step 2): one
// shared counter per side, so a "used port" and a "free address" mean the
// same in every place that prints one. What is held here:
//   1. subnetCapacity (js/model.js): members plus the network's own gateway
//      and DNS, drawn or not, so "free" is exactly how many addresses
//      freeAddresses() can hand out (the undrawn gateway was one too many
//      before); a retired member's address is free; a device of a network
//      declared inside this one counts (freeAddresses skips it too); an
//      address that is the network or broadcast address does not; a /30, a
//      /31 and a /32 have the right sizes; an IPv6 /64 has no size; an
//      implied subnet's CIDR works, lending the gateway of a network
//      declared with exactly that range; a bad CIDR is null; a /8 is
//      counted without walking it; networkStats() and the Subnets card read
//      the same numbers;
//   2. portCapacity: a cabled port, a bond port and a bond's member are used, a bond is not a cable to the overflow finding, a cable past the faceplate is one to rebind even on a materialized port, bulk Move to switch hands out ports by the same rule, an AP's
//      wireless clients are not ports, a link on a numbered port holds it
//      whatever its medium, a cable past the faceplate is counted in used
//      and past; the free ids are freePorts()'s; an implicit switch is never
//      nearly full or full; the thresholds (8 ports with 6, 7 and 8 used, 24
//      with 21 and 22, an AP's single port); no port grid is null;
//   3. agreement on the same fixtures: for every switch and AP, the node
//      panel's port line (evaluatePorts), the inventory (portUsage, the
//      report's devices rows and their printed "Ports: u/t"), and the
//      report port map (reportPortMaps used/total and its free ranges) give
//      portCapacity's numbers, bonds included; the panel adds the free count,
//      or "Port count not set, so the total is a guess." when the faceplate's size was never set, in
//      every locale with no placeholder left.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const open = (doc) => replaceDocument({ v: DOC_VERSION, links: [], ...doc }, { origin: 'file' });
  const pc = (id, ip, extra = {}) => ({ id, type: 'pc', name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip }], ...extra });
  setLocale('en');

  try {
    // ---- 1. subnetCapacity ----
    open({
      networks: [{ id: 'lan', cidr: '10.0.1.0/24', gateway: '10.0.1.1', dns: '10.0.1.53, 10.0.1.1, 8.8.8.8' },
                 { id: 'inner', cidr: '10.0.1.128/25' }],
      nodes: [pc('a', '10.0.1.10/24'), pc('b', '10.0.1.11/24'), pc('old', '10.0.1.12/24', { status: 'retired' }),
              pc('nest', '10.0.1.200/25'), pc('edge', '10.0.1.255/24')]
    });
    const lan = state.networks[0];
    const cap = subnetCapacity(lan);
    ok('a /24 has 254 usable addresses', cap.size === 254, show(cap));
    ok('the undrawn gateway and DNS server are reserved, once each, and the outside resolver is not',
       cap.reserved.join() === '10.0.1.1,10.0.1.53', show(cap.reserved));
    ok('used: two members, the nested network\'s device and the two reserved addresses; not the retired member or the broadcast address',
       cap.used === 5, show(cap));
    const handOut = freeAddresses('10.0.1.0/24', 1000, lan).length;
    ok('free is exactly what freeAddresses can hand out (the gateway off-by-one)', cap.free === handOut && cap.free === 249, `${cap.free} vs ${handOut}`);
    ok('with no pool, the fixed part is the whole subnet', cap.pool === null && show(cap.fixed) === show({ size: 254, used: 5, free: 249 }), show(cap.fixed));
    const st = networkStats(lan);
    ok('networkStats reads the same numbers', st.used === cap.used && st.free === cap.free && st.size === cap.size, show({ used: st.used, free: st.free }));
    getNode('old').status = 'active';
    ok('a member brought back into service is counted again', subnetCapacity(lan).used === 6 && subnetCapacity(lan).free === freeAddresses('10.0.1.0/24', 1000, lan).length);
    getNode('a').interfaces[0].ip = '10.0.1.1/24';
    ok('a gateway a device holds is used once, not reserved', subnetCapacity(lan).reserved.join() === '10.0.1.53' && subnetCapacity(lan).used === 5,
       show(subnetCapacity(lan)));
    ok('the inner network counts its own range: 126 addresses, its one device', subnetCapacity(state.networks[1]).size === 126 && subnetCapacity(state.networks[1]).used === 1);

    // The Subnets card prints them.
    showConfigTab('networks');
    renderNetworksPanel(true);
    const card = document.querySelector('#networkList .net-card[data-net="lan"]');
    ok('the Subnets card says the same used and free', !!card && card.textContent.includes(`${subnetCapacity(lan).used} of 254 used · ${subnetCapacity(lan).free} free`),
       card ? card.textContent.replace(/\s+/g, ' ').slice(0, 120) : 'no card');

    // Sizes.
    open({ networks: [], nodes: [pc('x', '10.9.0.1/30'), pc('y', '10.9.1.0/31'), pc('z', '10.9.2.7/32'), pc('v6', '2001:db8::5/64')] });
    ok('a /30 has 2', subnetCapacity('10.9.0.0/30').size === 2 && subnetCapacity('10.9.0.0/30').free === 1, show(subnetCapacity('10.9.0.0/30')));
    ok('a /31 has 2, both hosts (RFC 3021)', subnetCapacity('10.9.1.0/31').size === 2 && subnetCapacity('10.9.1.0/31').used === 1);
    ok('a /32 has 1', subnetCapacity('10.9.2.7/32').size === 1 && subnetCapacity('10.9.2.7/32').free === 0);
    const v6 = subnetCapacity('2001:db8::/64');
    ok('an IPv6 /64 has no size and no free count, but counts what is used', v6.size === null && v6.free === null && v6.used === 1, show(v6));
    ok('a bad CIDR is null', subnetCapacity('10.0.0.0/33') === null && subnetCapacity({ cidr: 'nope' }) === null);
    const t0 = performance.now();
    const big = subnetCapacity('10.0.0.0/8');
    ok('a /8 is counted, not walked (its three devices used)', big.size === 16777214 && big.free === 16777214 - 3 && performance.now() - t0 < 200, show(big));

    // An implied subnet's CIDR: the network declared with that range lends
    // its gateway; one declared around it does not.
    open({ networks: [{ id: 'n', cidr: '192.168.5.0/24', gateway: '192.168.5.254' }], nodes: [pc('p', '192.168.5.20/24')] });
    ok('a CIDR of a declared network counts its gateway', subnetCapacity('192.168.5.0/24').used === 2 && subnetCapacity('192.168.5.0/24').free === freeAddresses('192.168.5.0/24', 1000).length);
    ok('a narrower CIDR inside it does not borrow it', subnetCapacity('192.168.5.0/25').reserved.length === 0 && subnetCapacity('192.168.5.0/25').used === 1);

    // ---- 2. portCapacity ----
    const swDoc = (portCount, cabled, extra = {}) => ({
      nodes: [{ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, ...(portCount ? { portCount } : {}), interfaces: [], ...extra },
        ...Array.from({ length: cabled }, (_, k) => pc(`h${k}`, `10.1.0.${10 + k}/24`))],
      links: Array.from({ length: cabled }, (_, k) => ({ id: `l${k}`, source: 'sw', target: `h${k}`, sourceIface: `p${k + 1}`, targetIface: 'i1' }))
    });
    const capOf = (doc) => { open(doc); return portCapacity(getNode('sw')); };
    let c = capOf(swDoc(8, 6));
    ok('8 ports, 6 cabled: 2 free, not nearly full', c.used === 6 && c.free === 2 && c.explicit && !c.nearlyFull && !c.full, show(c));
    ok('and the free ids are freePorts\'', show(c.freeIds) === show(freePorts(getNode('sw'), 2).ids) && show(c.freeIds) === '["p7","p8"]');
    c = capOf(swDoc(8, 7));
    ok('8 ports, 7 cabled: nearly full', c.free === 1 && c.nearlyFull && !c.full, show(c));
    c = capOf(swDoc(8, 8));
    ok('8 ports, 8 cabled: full', c.free === 0 && c.nearlyFull && c.full, show(c));
    c = capOf(swDoc(24, 21));
    ok('24 ports, 21 cabled: 3 free, not nearly full', c.free === 3 && !c.nearlyFull, show(c));
    c = capOf(swDoc(24, 22));
    ok('24 ports, 22 cabled: 2 free, nearly full', c.free === 2 && c.nearlyFull, show(c));
    c = capOf(swDoc(0, 8));
    ok('an implicit switch is never nearly full or full', !c.explicit && c.total === 8 && c.free === 0 && !c.nearlyFull && !c.full, show(c));
    c = capOf(swDoc(0, 10));
    ok('and grows with what is in it', c.total === 10 && c.used === 10, show(c));
    open({ nodes: [{ id: 'ap', type: 'ap', name: 'AP', x: 0, y: 0, portCount: 1, interfaces: [] }, { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, interfaces: [] }],
      links: [{ id: 'u', source: 'ap', target: 'sw', sourceIface: 'p1', targetIface: 'p1' }] });
    c = portCapacity(getNode('ap'));
    ok('an AP\'s single port is below the size a note is for', c.full && !c.nearlyFull, show(c));
    ok('a device without a port grid is null', portCapacity(pc('q', '10.0.0.1/24')) === null);

    // Overflow: a cable past the faceplate counts in used and past.
    const over = swDoc(8, 8);
    over.nodes.push(pc('h8', '10.1.0.99/24'));
    over.links.push({ id: 'l8', source: 'sw', target: 'h8', sourceIface: 'p9', targetIface: 'i1' });
    c = capOf(over);
    ok('nine cables on 8 ports: used 9, past 1, free 0', c.used === 9 && c.past === 1 && c.free === 0, show(c));
    ok('the panel reports it as before, from the same count', evaluatePorts(getNode('sw')).level === 'bad' && /^9 cables on a 8-port switch/.test(evaluatePorts(getNode('sw')).text), evaluatePorts(getNode('sw')).text);

    // A bond is used but is not a cable: the overflow finding counts cables.
    // A pN bond (from a CSV if:id row or a hand-written file) on 8 ports,
    // eight cables, one of them past the faceplate on p9: eight cables, not
    // nine, so it is the cable to rebind, not an overflow.
    const pnBond = swDoc(8, 0, { interfaces: [{ id: 'p3', name: 'lag', bond: { mode: '802.3ad', members: ['p4', 'p5'] } }] });
    ['p1', 'p2', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'].forEach((port, k) => {
      pnBond.nodes.push(pc(`h${k}`, `10.1.0.${10 + k}/24`));
      pnBond.links.push({ id: `l${k}`, source: 'sw', target: `h${k}`, sourceIface: port, targetIface: 'i1' });
    });
    c = capOf(pnBond);
    ok('a pN bond and eight cables on 8 ports: eight cables, nine used', c.cables === 8 && c.used === 9 && c.past === 1, show(c));
    let ev = evaluatePorts(getNode('sw'));
    ok('which is the one cable to rebind, not "9 cables on a 8-port switch"', ev.level === 'bad' && /^1 link lands on an interface/.test(ev.text), ev.text);
    const four = swDoc(4, 0, { interfaces: [{ id: 'p3', name: 'lag', bond: { mode: 'active-backup', members: [] } }] });
    ['p1', 'p2', 'p4', 'p5'].forEach((port, k) => {
      four.nodes.push(pc(`h${k}`, `10.1.0.${10 + k}/24`));
      four.links.push({ id: `l${k}`, source: 'sw', target: `h${k}`, sourceIface: port, targetIface: 'i1' });
    });
    capOf(four);
    ev = evaluatePorts(getNode('sw'));
    ok('a bond and four cables on 4 ports never reads "5 cables"', !/5 cables/.test(ev.text) && /^1 link lands/.test(ev.text), ev.text);
    // Five cables past one bond on 4 ports is an overflow, counted in cables.
    four.nodes.push(pc('h9', '10.1.0.99/24'));
    four.links.push({ id: 'l9', source: 'sw', target: 'h9', sourceIface: 'p6', targetIface: 'i1' });
    capOf(four);
    ok('five cables on 4 ports read "5 cables", the bond left out', /^5 cables on a 4-port switch/.test(evaluatePorts(getNode('sw')).text), evaluatePorts(getNode('sw')).text);

    // A cable past the faceplate on a port materialized as an interface of
    // its own is still one to rebind, so the in-use line never says a port is
    // free while counting the cable past it.
    const mat = swDoc(8, 7, { interfaces: [{ id: 'p9', name: 'uplink' }] });
    mat.nodes.push(pc('up', '10.1.0.99/24'));
    mat.links.push({ id: 'lu', source: 'sw', target: 'up', sourceIface: 'p9', targetIface: 'i1' });
    capOf(mat);
    ev = evaluatePorts(getNode('sw'));
    ok('a materialized p9 on 8 ports with a cable is the cable to rebind', ev.level === 'bad' && /^1 link lands on an interface/.test(ev.text) && !/1 port free/.test(ev.text), ev.text);

    // Create bond on a switch's ports: its id is a b id and the ports are its
    // members, which then count as used everywhere and are not handed out.
    open(swDoc(8, 0, { interfaces: [{ id: 'p4', name: '4' }, { id: 'p5', name: '5' }] }));
    const made = createBond(getNode('sw'), { name: 'lag1', mode: '802.3ad' });
    c = portCapacity(getNode('sw'));
    ok('Create bond makes a b id whose members are the ports', !!made && !/^p\d+$/.test(made.id) && show(made.bond.members) === show(['p4', 'p5']), show(made));
    ok('and those ports are used and not handed out', c.used === 2 && c.free === 6 && !c.freeIds.includes('p4') && !c.freeIds.includes('p5')
       && show(freePorts(getNode('sw'), 4).ids) === show(['p1', 'p2', 'p3', 'p6']), show(c));

    // Bulk Move to switch hands out ports by the same rule: a port with any
    // link on it (a VPN one too) is not free.
    open({ nodes: [{ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8, interfaces: [] },
                   { id: 'fw', type: 'firewall', name: 'FW', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0' }] }, pc('h', '10.4.0.2/24')],
      links: [{ id: 'v', source: 'sw', target: 'fw', sourceIface: 'p1', targetIface: 'e0', medium: 'vpn' }] });
    ok('the VPN link holds p1 for portCapacity', !portCapacity(getNode('sw')).freeIds.includes('p1'));
    const plan = bulkPlanRecable(['h'], { target: 'sw', from: '', order: 'port' });
    const ports = plan.ops.map((op) => (op.addLink ? op.addLink.sourceIface : null)).filter(Boolean);
    ok('bulk Move to switch plans the cable on p2, not on the VPN link\'s p1', show(ports) === show(['p2']), show(plan.ops));

    // ---- 3. Agreement on one fixture ----
    // A bond port, an AP with wireless clients and a cable on a numbered
    // port, a cable-less switch, a labelled free jack.
    const mixed = () => ({
      networks: [{ id: 'n', cidr: '10.2.0.0/24', gateway: '10.2.0.1' }],
      nodes: [
        { id: 'core', type: 'switch', name: 'Core', x: 0, y: 0, portCount: 8,
          portAttrs: { p6: { label: 'Desk 6' } },
          interfaces: [{ id: 'b_lag', name: 'lag1', ip: '', bond: { mode: '802.3ad', members: ['p4', 'p5'] } }] },
        { id: 'edge', type: 'switch', name: 'Edge', x: 200, y: 0, interfaces: [] },
        { id: 'idle', type: 'switch', name: 'Idle', x: 400, y: 0, portCount: 16, interfaces: [] },
        { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 200, portCount: 2, interfaces: [{ id: 'w1', name: 'wlan0', wireless: true }] },
        pc('a', '10.2.0.10/24'), pc('b', '10.2.0.11/24'), pc('c', '10.2.0.12/24'),
        { id: 'ph', type: 'phone', name: 'Phone', x: 0, y: 300, interfaces: [{ id: 'w', name: 'wlan0', ip: '10.2.0.30/24', wireless: true }] },
        { id: 'lt', type: 'laptop', name: 'Laptop', x: 0, y: 300, interfaces: [{ id: 'w', name: 'wlan0', ip: '10.2.0.31/24', wireless: true }] }],
      links: [
        { id: 'c1', source: 'core', target: 'edge', sourceIface: 'p1', targetIface: 'p1' },
        { id: 'c2', source: 'core', target: 'ap', sourceIface: 'p2', targetIface: 'p1' },
        { id: 'c3', source: 'core', target: 'a', sourceIface: 'p7', targetIface: 'i1' },
        { id: 'c4', source: 'edge', target: 'b', sourceIface: 'p2', targetIface: 'i1' },
        { id: 'c5', source: 'ap', target: 'c', sourceIface: 'p2', targetIface: 'i1' },
        { id: 'w1', source: 'ap', target: 'ph', sourceIface: 'w1', targetIface: 'w' },
        { id: 'w2', source: 'ap', target: 'lt', sourceIface: 'w1', targetIface: 'w' }]
    });
    open(mixed());
    const model = reportModel();
    const html = reportHtml(model, null);
    const want = { core: [5, 8, 3], edge: [2, 8, 6], idle: [0, 16, 16], ap: [2, 2, 0] };
    Object.entries(want).forEach(([id, [u, tot, fr]]) => {
      const n = getNode(id);
      const k = portCapacity(n);
      ok(`${n.name}: portCapacity ${u} of ${tot}, ${fr} free`, k.used === u && k.total === tot && k.free === fr, show(k));
      const panel = evaluatePorts(n);
      const room = !k.explicit ? 'Port count not set, so the total is a guess.' : `${k.free} ${k.free === 1 ? 'port' : 'ports'} free.`;
      // A cable-less switch says it has no links, as it always did.
      const line = u ? `${u} of ${tot} ports in use` : 'No links attached.';
      ok(`${n.name}: the node panel's port line agrees`, panel.text.startsWith(line) && (!u || panel.text.endsWith(room)), panel.text);
      ok(`${n.name}: the inventory agrees`, show(portUsage(n)) === show({ used: u, total: tot })
         && show(model.devices.find((d) => d.id === id).ports) === show({ used: u, total: tot }));
      const map = reportPortMaps().find((m) => m.id === id);
      if (map) ok(`${n.name}: the port map agrees`, map.used === u && map.total === tot, show({ used: map.used, total: map.total }));
    });
    ok('a bond\'s member ports are used everywhere, cabled or not (a LAG made by Create bond has a b id, not a port id)',
       portUsage(getNode('core')).used === 5 && !portCapacity(getNode('core')).freeIds.includes('p4') && !portCapacity(getNode('core')).freeIds.includes('p5'));
    const coreMap = reportPortMaps().find((m) => m.id === 'core');
    ok('the port map\'s free ranges leave out the bond\'s members and the labelled jack, which has its own row',
       coreMap.free === '3, 8' && coreMap.rows.some((r) => r.free && r.portLabel === 'Desk 6'), show({ free: coreMap.free }));
    ok('the printed inventory and port map say the same', html.includes('Ports: 5/8') && html.includes('5 of 8 ports used') && html.includes('2 of 2 ports used'),
       (html.match(/Core <span[^\n]*/) || [])[0]);
    ok('freePorts hands out what portCapacity calls free', show(freePorts(getNode('core'), 3).ids) === show(['p3', 'p6', 'p8']), show(freePorts(getNode('core'), 3)));
    ok('the AP\'s wireless clients are not ports, and its cable on p2 is one', portCapacity(getNode('ap')).used === 2
       && evaluatePorts(getNode('ap')).text === '2 of 2 ports in use, 2 wireless clients. 0 ports free.', evaluatePorts(getNode('ap')).text);
    ok('the panel names its free count only when the size is set', evaluatePorts(getNode('core')).text === '5 of 8 ports in use. 3 ports free.'
       && evaluatePorts(getNode('edge')).text === '2 of 8 ports in use. Port count not set, so the total is a guess.',
       evaluatePorts(getNode('core')).text + ' | ' + evaluatePorts(getNode('edge')).text);

    // In every locale: translated, nothing left over.
    ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => {
      setLocale(loc);
      const a = evaluatePorts(getNode('core')).text, b = evaluatePorts(getNode('edge')).text;
      const room = t('{n} ports free.', { n: 3 }), unset = t('Port count not set, so the total is a guess.');
      ok(`${loc}: the free count and the unset size read translated`, !/\{|\}|free\.|not set/.test(a + b + room + unset)
         && /3/.test(room) && a.endsWith(` ${room}`) && b.endsWith(` ${unset}`), `${a} | ${b}`);
    });
    setLocale('en');
    open({ nodes: [{ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 2, interfaces: [] }, pc('h', '10.3.0.2/24')],
      links: [{ id: 'l', source: 'sw', target: 'h', sourceIface: 'p1', targetIface: 'i1' }] });
    setLocale('es');
    ok('es: one free port in the singular', /1 puerto libre\.$/.test(evaluatePorts(getNode('sw')).text), evaluatePorts(getNode('sw')).text);
    setLocale('en');

    // The same agreement on every bundled template.
    const odd = [];
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'file' });
      const maps = new Map(reportPortMaps().map((m) => [m.id, m]));
      const devRows = new Map(reportModel().devices.map((d) => [d.id, d]));
      state.nodes.filter(hasPortGrid).forEach((n) => {
        const kk = portCapacity(n), u = portUsage(n), m = maps.get(n.id), d = devRows.get(n.id);
        // Worked out here, not by portCapacity: the numbered ports a link
        // lands on, and every port that is a bond or a bond's member.
        const total = portCountOf(n), num = (id) => { const x = /^p(\d+)$/.exec(id || ''); return x ? Number(x[1]) : 0; };
        const taken = new Set();
        linksAtNode(n.id).forEach((l) => { const id = ifaceIdOn(l, n.id); if (num(id)) taken.add(id); });
        (n.interfaces || []).filter((i) => i.bond).forEach((b) => [b.id, ...(b.bond.members || [])].forEach((id) => { if (num(id) && num(id) <= total) taken.add(id); }));
        const used = taken.size;
        if (kk.used !== used || kk.total !== total || u.used !== used || u.total !== total
            || (d && d.ports && (d.ports.used !== used || d.ports.total !== total))
            || (m && (m.used !== used || m.total !== total))) odd.push(`${k}:${n.name}:${used}/${total} vs ${kk.used}/${kk.total}`);
        const p = evaluatePorts(n);
        if (p.level === 'good' && !p.text.startsWith(`${kk.used} of ${kk.total} port`)) odd.push(`${k}:${n.name}:${p.text}`);
      });
      state.networks.forEach((net) => {
        const s = subnetCapacity(net);
        if (s && s.size !== null && s.size <= 4096 && s.free !== freeAddresses(net.cidr, 5000, net).length) odd.push(`${k}:${net.cidr}`);
      });
    });
    ok('on every template the panel, inventory and port map agree, and every subnet\'s free is what freeAddresses hands out', !odd.length, odd.slice(0, 5).join(' | '));
  } catch (e) {
    ok('the suite ran', false, e && (e.stack || e.message));
  }
  setLocale('en');
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 50); });
