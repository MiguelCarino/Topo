// R7: subnets as objects (Review-Packs/Topo-proposal.md). A network is a record
// in doc.networks; a device belongs to one by address containment; its own
// gateway and DNS are overrides of the network's, read only through
// effectiveGw()/effectiveDns(); the zone is the network's; Renumber moves a
// whole network as one undo step. What is held here:
//   1. the schema row and its round trip;
//   2. the v2 -> v3 migration: a network per subnet, the agreed gateway and
//      DNS moved onto it, copies cleared, differences kept, zones moved;
//   3. every reader asks the effective value (diagnostics, trace, report,
//      the Netplan hand-off) and follows a change to the network;
//   4. zones: the switch, the per-network flag, interleaving;
//   5. the Subnets tab: cards, Declare, editing, Delete, Select members;
//   6. Renumber: refused with reasons, applied as one step, undone whole;
//   7. construction: a spawned device, a stamped block, the next free address.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const answers = [];
  const heldResponder = setDialogResponder((req) => (answers.length ? answers.shift()(req) : (req.kind === 'confirm' ? false : null)));

  // A small office, written the way a v2 document was: gateway and DNS on
  // every device, the zone flag on the interfaces.
  const N = (id, type, ip, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '10.10.0.1', dns: '10.10.0.53',
    os: '', ports: '', notes: '', nat: false, interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra);
  const office = () => ({ v: 2, nodes: [
      { id: 'isp', type: 'cloud', name: 'ISP', x: 300, y: 0, gw: '', dns: '', os: '', ports: '', notes: '', nat: false, interfaces: [{ id: 'w', name: 'wan0', ip: '203.0.113.1/30' }] },
      { id: 'rtr', type: 'router', name: 'RTR', x: 300, y: 100, gw: '203.0.113.1', dns: '1.1.1.1', os: '', ports: '22', notes: '', nat: true,
        interfaces: [{ id: 'wan', name: 'eth0', ip: '203.0.113.2/30' }, { id: 'lan', name: 'eth1', ip: '10.10.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW', x: 300, y: 200, gw: '', dns: '', os: '', ports: '', notes: '', nat: false, portCount: 8, interfaces: [] },
      N('ns', 'server', '10.10.0.53/24', { x: 0, y: 320, ports: '53' }),
      N('pc1', 'pc', '10.10.0.21/24', { x: 100, y: 320 }),
      N('pc2', 'pc', '10.10.0.22/24', { x: 200, y: 320 }),
      N('pc3', 'pc', '10.10.0.23/24', { x: 300, y: 320, gw: '10.10.0.254', dns: '8.8.8.8' }),
      N('pc4', 'pc', '10.10.0.24/24', { x: 400, y: 320, gw: '', dns: '' }),
      N('cam1', 'camera', '10.20.0.5/24', { x: 500, y: 320, gw: '10.20.0.1', dns: '' }),
      N('cam2', 'camera', '10.20.0.6/24', { x: 600, y: 320, gw: '10.20.0.1', dns: '' })
    ], links: [
      { id: 'l0', source: 'isp', target: 'rtr', sourceIface: 'w', targetIface: 'wan' },
      { id: 'l1', source: 'rtr', target: 'sw', sourceIface: 'lan', targetIface: 'p1' },
      ...['ns', 'pc1', 'pc2', 'pc3', 'pc4'].map((id, i) => ({ id: `l${i + 2}`, source: 'sw', target: id, sourceIface: `p${i + 2}`, targetIface: 'i1' }))
    ] });
  const raw = office();
  raw.nodes.find((n) => n.id === 'cam1').interfaces[0].drawZone = false;
  raw.nodes.find((n) => n.id === 'cam2').interfaces[0].drawZone = false;

  try {
    // ---- 1: the schema row ----
    const nets = normalizeNetworks([
      { id: 'a', cidr: '10.1.0.77/24', name: 'Office', vlan: '20', purpose: 'Staff', gateway: '10.1.0.1', dns: '10.1.0.53', dhcp: true, drawZone: false, junk: 'x' },
      { id: 'b', cidr: '10.1.0.0/24' },                // the same subnet again
      { id: 'c', cidr: 'nonsense' }, null, 'junk',
      { id: 'a', cidr: '10.2.0.0/16', vlan: 9999 }      // a repeated id, an impossible VLAN
    ]);
    ok('a network is held as its masked CIDR', nets[0].cidr === '10.1.0.0/24', nets[0].cidr);
    ok('one per subnet, and only real ones', nets.length === 2, JSON.stringify(nets.map((n) => n.cidr)));
    ok('a VLAN typed as text is its number; an impossible one is none', nets[0].vlan === 20 && nets[1].vlan === undefined);
    ok('a repeated id is reminted', nets[1].id !== 'a');
    ok('unknown keys are not kept (the allowlist)', !('junk' in nets[0]));
    ok('every field, in table order', JSON.stringify(serializeNetworks(nets.slice(0, 1))[0])
       === '{"id":"a","cidr":"10.1.0.0/24","name":"Office","vlan":20,"purpose":"Staff","gateway":"10.1.0.1","dns":"10.1.0.53","dhcp":true,"drawZone":false}',
       JSON.stringify(serializeNetworks(nets.slice(0, 1))[0]));
    ok('an unnamed network carries no empty keys', JSON.stringify(serializeNetworks([makeNetwork('10.9.0.0/24', 'z')])[0]) === '{"id":"z","cidr":"10.9.0.0/24"}');
    ok('a document with no networks has no networks key', !('networks' in JSON.parse(JSON.stringify({ networks: serializeNetworks([]) }))));
    ok('the IPv6 network is masked too', canonicalCidr('2001:db8::5/64') === '2001:db8::/64');

    // ---- 2: the migration ----
    const m = migrateDoc(JSON.parse(JSON.stringify(raw)));
    const d = m.doc;
    const by = (id) => d.nodes.find((n) => n.id === id);
    ok(`a v2 document is brought to v${DOC_VERSION}`, d.v === DOC_VERSION && m.from === 2 && !m.newer);
    ok('a network for every subnet in use, the cloud\'s aside, named in order', JSON.stringify(d.networks.map((n) => [n.id, n.cidr]))
       === '[["net1","203.0.113.0/30"],["net2","10.10.0.0/24"],["net3","10.20.0.0/24"]]', JSON.stringify(d.networks));
    const lan = d.networks[1], wan = d.networks[0], cams = d.networks[2];
    ok('the LAN takes the gateway and DNS most of its devices used', lan.gateway === '10.10.0.1' && lan.dns === '10.10.0.53', JSON.stringify(lan));
    ok('the uplink takes the router\'s gateway, not its resolver', wan.gateway === '203.0.113.1' && !wan.dns, JSON.stringify(wan));
    ok('copies of the network\'s values are cleared', by('pc1').gw === '' && by('pc1').dns === '' && by('ns').gw === '');
    ok('a router keeps its own default route: a routing device inherits nothing', by('rtr').gw === '203.0.113.1');
    ok('a device that differs keeps its own', by('pc3').gw === '10.10.0.254' && by('pc3').dns === '8.8.8.8');
    ok('a router keeps its upstream resolver', by('rtr').dns === '1.1.1.1');
    ok('the zone flag moved to the network', cams.drawZone === false && lan.drawZone === undefined
       && d.nodes.every((n) => (n.interfaces || []).every((i) => !('drawZone' in i))));
    ok('migrating the result again changes nothing', JSON.stringify(migrateDoc({ ...JSON.parse(JSON.stringify(d)), v: 2 }).doc) === JSON.stringify(d));
    {
        // The verifier's file: 1000 PCs on 50 /24s, each with its own copy
        // of the gateway and DNS. The migration was networks x devices x
        // networks (27 s for this one, the page frozen); it is near linear
        // now. The suites run on a virtual clock, so the work is counted
        // rather than timed: every cidr parse goes through parseCIDRNow(),
        // and the cubic shape made millions of them.
        const big = { v: 2, nodes: [], links: [] };
        for (let s = 0; s < 50; s++) for (let h = 0; h < 20; h++) big.nodes.push({ id: `h${s}_${h}`, type: 'pc', name: `h${s}_${h}`,
            gw: `10.${s}.0.1`, dns: `10.${s}.0.53`, interfaces: [{ id: 'i1', name: 'eth0', ip: `10.${s}.0.${h + 10}/24` }] });
        const realParse = window.parseCIDRNow;
        let parses = 0;
        window.parseCIDRNow = (s) => { parses += 1; return realParse(s); };
        let bm;
        try { bm = migrateDoc(big).doc; } finally { window.parseCIDRNow = realParse; }
        ok('a 1000-device v2 file migrates with work in proportion to its size', parses > 0 && parses < 20 * 1000 && bm.networks.length === 50
           && bm.nodes.every((n) => n.gw === '' && n.dns === ''), `${parses} parses, ${bm.networks.length} networks`);
        // The library re-reads its cards from storage on every render, so the
        // same document arrives as a new object each time.
        const realMigrate = window.migrateDoc;
        let migrations = 0;
        window.migrateDoc = (doc) => { migrations += 1; return realMigrate(doc); };
        let first, again;
        try { first = librarySummary(big); again = librarySummary(JSON.parse(JSON.stringify(big))); } finally { window.migrateDoc = realMigrate; }
        ok('a library card is summarised once, not migrated on every render', JSON.stringify(first) === JSON.stringify(again)
           && first.devices === 1000 && migrations === 1, `${migrations} migrations`);
    }
    ok('every shipped template declares its networks', Object.entries(templatesData).every(([, tpl]) => Array.isArray(tpl.networks) && tpl.networks.length > 0),
       Object.entries(templatesData).filter(([, tpl]) => !(tpl.networks || []).length).map(([k]) => k).join(', '));

    // ---- 3: the readers ----
    replaceDocument(d, { origin: 'template' });
    const node = (id) => getNode(id);
    ok('a device with nothing of its own inherits', effectiveGw(node('pc4')) === '10.10.0.1' && effectiveDns(node('pc4')) === '10.10.0.53');
    ok('an override wins', effectiveGw(node('pc3')) === '10.10.0.254' && effectiveDns(node('pc3')) === '8.8.8.8');
    ok('a router keeps its own default route', effectiveGw(node('rtr')) === '203.0.113.1' && effectiveDns(node('rtr')) === '1.1.1.1');
    // Verifier repro: changing a LAN's gateway used to move the router's own
    // default route, because it inherited the first network in interface order.
    const lanRec = state.networks.find((n) => n.cidr === '10.10.0.0/24');
    const heldGw = lanRec.gateway;
    lanRec.gateway = '10.99.99.99';
    ok('editing the LAN\'s gateway does not move the router\'s default route', effectiveGw(node('rtr')) === '203.0.113.1', effectiveGw(node('rtr')));
    ok('and no alert blames the router for it', !topologyFindings().some((f) => /10\.99\.99\.99/.test(f.line || '') && /RTR/.test(f.line || '')));
    lanRec.gateway = heldGw;
    {
        // A routing device inherits neither, whichever interface comes first:
        // a router whose LAN names a firewall as gateway does not take it.
        const nets = [{ id: 'a', cidr: '10.0.1.0/24', gateway: '10.0.1.254', dns: '10.0.1.53' }, { id: 'b', cidr: '203.0.113.0/30', gateway: '203.0.113.1', dns: '' }];
        const r = { id: 'r', type: 'router', gw: '', dns: '', interfaces: [{ id: 'i1', ip: '10.0.1.1/24' }, { id: 'i2', ip: '203.0.113.2/30' }] };
        const fw = { id: 'f', type: 'firewall', gw: '', dns: '', interfaces: [{ id: 'i1', ip: '10.0.1.254/24' }] };
        const pc = { id: 'p', type: 'pc', gw: '', dns: '', interfaces: [{ id: 'i1', ip: '10.0.1.7/24' }] };
        ok('a router with a blank gateway inherits none, in any interface order', gatewaySource(r, nets).value === '' && dnsSource(r, nets).value === ''
           && gatewaySource({ ...r, interfaces: [...r.interfaces].reverse() }, nets).value === '');
        ok('nor does a firewall', gatewaySource(fw, nets).value === '');
        ok('while a client on the same LAN does', gatewaySource(pc, nets).value === '10.0.1.254' && dnsSource(pc, nets).value === '10.0.1.53');
    }
    const gwCheck = (id) => nodeChecks(node(id)).find((c) => c.key === 'gateway');
    ok('the node tab checks the inherited gateway', gwCheck('pc4').level === 'good' && /10\.10\.0\.1/.test(gwCheck('pc4').text), gwCheck('pc4').text);
    ok('the trace walks on through it', calculateReachability('pc4', { port: '' }).reachableNodes.has('isp'));
    ok('the report prints what the device uses', reportDevices().find((r) => r.name === 'PC4').gw === '10.10.0.1');
    const intent = bridgeIntent(node('pc4'));
    ok('the Netplan hand-off is configured with it', intent.ifaces[0].gw === '10.10.0.1' && intent.ifaces[0].dns === '10.10.0.53', JSON.stringify(intent.ifaces[0]));
    const row = reportSubnets().find((s) => s.network === '10.10.0.0/24');
    ok('the report\'s addressing table lists the declared network with its gateway', !!row && row.declared && row.gateway === '10.10.0.1' && row.devices.length === 6,
       JSON.stringify(row));
    // One change to the network is a change for every member, and the
    // findings follow it at once (the memo keys on the networks too).
    const lanNet = state.networks.find((n) => n.cidr === '10.10.0.0/24');
    lanNet.gateway = '10.10.0.99';
    const gwFinding = topologyFindings().filter((f) => f.key === 'gateway').flatMap((f) => f.nodeIds);
    ok('a wrong gateway on the network is found on every device that inherits it', ['ns', 'pc1', 'pc2', 'pc4'].every((id) => gwFinding.includes(id)), gwFinding.join(','));
    const pc3Says = topologyFindings().filter((f) => f.key === 'gateway' && f.nodeIds.includes('pc3')).map((f) => f.detail).join(' ');
    ok('and not on the one that overrides it: its own is what it is held to', !/10\.10\.0\.99/.test(pc3Says) && /10\.10\.0\.254/.test(pc3Says), pc3Says);
    lanNet.gateway = '';
    ok('with no gateway anywhere, the trace stops at the router', !calculateReachability('pc4', { port: '' }).reachableNodes.has('isp'));
    lanNet.gateway = '10.10.0.1';
    renderCanvasOnly();

    // ---- 4: zones ----
    const zoneCidrs = () => zonesToDraw().map((z) => z.net.cidr).sort();
    ok('a private network draws its zone; one set to never does not', JSON.stringify(zoneCidrs()) === '["10.10.0.0/24"]', JSON.stringify(zoneCidrs()));
    ok('the zone is on the canvas, labelled with the network', el('layer-zones').children.length === 1 && /10\.10\.0\.0\/24/.test(el('layer-zones').textContent));
    lanNet.name = 'Office LAN'; lanNet.vlan = 10; save(); renderCanvasOnly();
    ok('its label carries the name and the VLAN', /Office LAN · 10\.10\.0\.0\/24 · VLAN 10/.test(el('layer-zones').textContent), el('layer-zones').textContent);
    showConfigTab('networks');
    el('subnetZonesToggle').click();
    ok('"Subnet zones" off clears them all', el('layer-zones').children.length === 0 && state.settings.subnetZones === false);
    ok('and is remembered as a setting, not in the document', JSON.parse(localStorage.getItem('nettopo_settings')).subnetZones === false
       && !/subnetZones/.test(JSON.stringify(serializeDoc())));
    el('subnetZonesToggle').click();
    ok('on again', el('layer-zones').children.length === 1);
    // Two networks alternating along one row: auto zones would each reach
    // across the other's devices, so neither is drawn — unless asked for.
    const held = { nodes: state.nodes, links: state.links, networks: state.networks };
    state.nodes = ['a1', 'b1', 'a2', 'b2'].map((id, i) => normalizeLoadedNode({ id, type: 'pc', name: id, x: i * 100, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', ip: `${id[0] === 'a' ? '10.1.0' : '10.2.0'}.${i + 10}/24` }] }));
    state.links = [];
    state.networks = normalizeNetworks([{ id: 'A', cidr: '10.1.0.0/24' }, { id: 'B', cidr: '10.2.0.0/24' }]);
    ok('interleaved auto zones are not drawn', zonesToDraw().length === 0);
    state.networks[0].drawZone = true;
    ok('a network set to always draw is drawn regardless', JSON.stringify(zoneCidrs()) === '["10.1.0.0/24"]');
    state.nodes[1].x = 900; state.nodes[3].x = 1000; state.networks[0].drawZone = undefined;
    ok('apart again, both are drawn', zonesToDraw().length === 2);
    // A router with a leg on both: it belongs to each, so neither box is
    // stretched to its corner (after Tidy every LAN's bubble reached up to
    // the router and they swallowed one another).
    state.nodes.push(normalizeLoadedNode({ id: 'rt', type: 'router', name: 'rt', x: -600, y: -400,
      interfaces: [{ id: 'a', name: 'eth0', ip: '10.1.0.1/24' }, { id: 'b', name: 'eth1', ip: '10.2.0.1/24' }] }));
    const boxes = zonesToDraw().map((z) => z.box);
    ok('a device on every zone does not stretch their boxes', boxes.length === 2 && boxes.every((b) => b.minX >= 0 && b.minY === 0), JSON.stringify(boxes));
    state.nodes.pop();
    // Not declared at all: drawn as auto zones, as every inferred subnet
    // always was (a device dropped and numbered by hand declares nothing).
    state.networks = [];
    ok('subnets nobody declared still draw their zones', JSON.stringify(zoneCidrs()) === '["10.1.0.0/24","10.2.0.0/24"]', JSON.stringify(zoneCidrs()));
    state.nodes[1].x = 100; state.nodes[3].x = 300;
    ok('under the same interleave rule', zonesToDraw().length === 0);
    state.nodes = [normalizeLoadedNode({ id: 'w', type: 'server', name: 'w', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '203.0.113.5/24' }] })];
    ok('and only a private one, as a declared network\'s auto zone', zonesToDraw().length === 0);
    Object.assign(state, held);
    renderCanvasOnly();

    // ---- 5: the Subnets tab ----
    showConfigTab('networks');
    const cards = () => [...document.querySelectorAll('#networkList .net-card')];
    ok('one card per network', cards().length === 3, String(cards().length));
    const lanCard = () => document.querySelector(`#networkList .net-card[data-net="${lanNet.id}"]`);
    ok('the card says how much is used and what is free', /6 of 254 used · 248 free/.test(lanCard().textContent) && /next free 10\.10\.0\.2\b/.test(lanCard().textContent),
       lanCard().textContent.replace(/\s+/g, ' ').slice(0, 160));
    ok('and the gateway and DNS its members inherit', /gw 10\.10\.0\.1 · DNS 10\.10\.0\.53/.test(lanCard().textContent));
    lanCard().querySelector('[data-act="edit"]').click();
    const gwField = lanCard().querySelector('[data-field="gateway"]');
    ok('Edit opens the network\'s fields', !!gwField && !lanCard().querySelector('.net-edit').hidden);
    const steps = () => Number((el('undoBtn').title.match(/\((\d+)\)/) || [0, 0])[1]);
    const before = steps();
    gwField.focus();
    gwField.value = '10.10.0.25'; gwField.dispatchEvent(new Event('input', { bubbles: true }));
    gwField.value = '10.10.0.254'; gwField.dispatchEvent(new Event('input', { bubbles: true }));
    gwField.blur(); commitTyping();
    ok('typing a gateway on the network changes it for every member at once', effectiveGw(node('pc1')) === '10.10.0.254' && effectiveGw(node('pc4')) === '10.10.0.254');
    ok('as one undo step', steps() === before + 1, `${before} -> ${steps()}`);
    undo();
    ok('which Undo takes back whole', effectiveGw(node('pc1')) === '10.10.0.1');
    const vlanField = () => document.querySelector(`#networkList [data-net="${state.networks.find((n) => n.cidr === '10.10.0.0/24').id}"][data-field="vlan"]`);
    showConfigTab('networks');
    lanCard().querySelector('[data-act="edit"]').getAttribute('aria-expanded') === 'true' || lanCard().querySelector('[data-act="edit"]').click();
    vlanField().value = '5000'; vlanField().dispatchEvent(new Event('input', { bubbles: true }));
    ok('an impossible VLAN is marked and not saved', vlanField().classList.contains('bad') && !('vlan' in JSON.parse(liveDocJson()).networks.find((n) => n.cidr === '10.10.0.0/24')));
    vlanField().value = '30'; vlanField().dispatchEvent(new Event('input', { bubbles: true })); commitTyping();
    ok('a real one is', JSON.parse(liveDocJson()).networks.find((n) => n.cidr === '10.10.0.0/24').vlan === 30);

    // A device selected shows where its blank fields come from.
    select('pc4', 'node');
    ok('a device\'s blank gateway field shows what it inherits, and says from where', el('propGw').value === ''
       && el('propGw').placeholder === '10.10.0.1' && el('propGw').title === '10.10.0.1 · from Office LAN', `${el('propGw').placeholder} | ${el('propGw').title}`);
    ok('and names the network it can open', !el('inheritNote').classList.contains('hidden') && /Office LAN/.test(el('inheritNote').textContent));
    el('inheritNote').querySelector('[data-net]').click();
    ok('which opens the Subnets tab on it', !el('cfgPanel-networks').classList.contains('hidden') && lanCard().querySelector('[data-act="edit"]').getAttribute('aria-expanded') === 'true');
    select(null, null);

    // Select members: every member at once, in the selection set (plan 3.1).
    const ids = selectNetworkMembers(state.networks.find((n) => n.cidr === '10.10.0.0/24').id);
    ok('Select members knows every member', ids.length === 6 && ['rtr', 'ns', 'pc1', 'pc2', 'pc3', 'pc4'].every((id) => ids.includes(id)), ids.join(','));
    ok('and selects them all at once', state.selection.size === 6 && ids.every((id) => inSelection('node', id)) && state.selectedId === null,
       selectedOf('node').join(','));
    ok('the rail shows their count, not one device', !el('multiSelectionPane').classList.contains('hidden') && el('propertiesPane').classList.contains('hidden')
       && /6/.test(el('selCounts').textContent));
    ok('and the button says what it does', /Select every device on this subnet/.test(lanCard().querySelector('[data-act="members"]').title));
    select(null, null);

    // A subnet in use that nobody declared: listed, and one click declares it.
    batch(() => { state.nodes.push(normalizeLoadedNode({ id: 'lab', type: 'server', name: 'Lab', x: 700, y: 320, gw: '10.40.0.1',
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.40.0.9/24' }] })); save(); renderCanvasOnly(); });
    showConfigTab('networks');
    const declare = document.querySelector('#undeclaredBox [data-act="declare"]');
    ok('an undeclared subnet is offered', !el('undeclaredBox').classList.contains('hidden') && !!declare && declare.dataset.net === '10.40.0.0/24');
    declare.click();
    const labNet = state.networks.find((n) => n.cidr === '10.40.0.0/24');
    ok('Declare makes it a network with the gateway its device used', !!labNet && labNet.gateway === '10.40.0.1' && getNode('lab').gw === '' && effectiveGw(getNode('lab')) === '10.40.0.1');
    ok('and nothing is left undeclared', el('undeclaredBox').classList.contains('hidden'));

    // + Network, through the page's own dialog.
    answers.push(() => '10.50.0.7/24');
    await addNetwork();
    ok('+ Network declares the subnet typed, masked', state.networks.some((n) => n.cidr === '10.50.0.0/24'));
    answers.push(() => '10.50.0.0/24');
    await addNetwork();
    ok('the same subnet twice is refused', state.networks.filter((n) => n.cidr === '10.50.0.0/24').length === 1);

    // The Delete confirmation counts its members in words that agree.
    const deleteText = async (cidr) => {
        let said = '';
        answers.push((req) => { said = req.message; return false; });
        await deleteNetwork(state.networks.find((n) => n.cidr === cidr).id);
        return said;
    };
    ok('Delete on an empty network says nobody is on it', /No device is on it/.test(await deleteText('10.50.0.0/24')));
    ok('on two members, "Its 2 devices"', /Its 2 devices keep/.test(await deleteText('10.20.0.0/24')));
    batch(() => { getNode('cam2').interfaces[0].ip = '10.21.0.12/24'; save(); });
    ok('on one, "Its one device", never "1 devices"', /Its one device keeps/.test(await deleteText('10.20.0.0/24')));
    undo();
    ok('and saying no deletes nothing', state.networks.some((n) => n.cidr === '10.20.0.0/24') && state.networks.some((n) => n.cidr === '10.50.0.0/24'));

    // Delete: the members keep what they use.
    const camNet = state.networks.find((n) => n.cidr === '10.20.0.0/24');
    answers.push(() => true);
    await deleteNetwork(camNet.id);
    ok('Delete removes the network', !state.networks.some((n) => n.cidr === '10.20.0.0/24'));
    ok('and writes what its members inherited onto them, so nothing they use changes', getNode('cam1').gw === '10.20.0.1' && effectiveGw(getNode('cam2')) === '10.20.0.1');
    undo();
    ok('Undo brings it back, and the copies go again', state.networks.some((n) => n.cidr === '10.20.0.0/24') && getNode('cam1').gw === '');

    // ---- 6: Renumber ----
    const lanId = () => state.networks.find((n) => n.cidr === '10.10.0.0/24' || n.cidr === '10.30.0.0/24').id;
    const why = (cidr) => planRenumber(lanId(), cidr).errors.join(' | ');
    ok('Renumber refuses what is not a subnet', /not a subnet/.test(why('10.30.0.1')));
    ok('another address family', /same address family/.test(why('2001:db8::/64')));
    ok('the address it already has', /already this subnet/.test(why('10.10.0.0/24')));
    ok('a range another network holds is refused as already declared, not as overlapping itself',
       /10\.20\.0\.0\/24 is already declared/.test(why('10.20.0.0/24')) && !/overlaps/.test(why('10.20.0.0/24')), why('10.20.0.0/24'));
    ok('a range overlapping another network', /overlaps 10\.20\.0\.0\/24/.test(why('10.20.0.0/23')), why('10.20.0.0/23'));
    ok('a range too small for its host bits', /10\.10\.0\.254 does not fit/.test(why('10.30.0.0/25')), why('10.30.0.0/25'));
    batch(() => { state.nodes.push(normalizeLoadedNode({ id: 'stray', type: 'pc', name: 'Stray', x: 0, y: 600, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.30.0.21/24' }] })); save(); });
    ok('an address somebody already holds', /10\.30\.0\.21 is already used by Stray/.test(why('10.30.0.0/24')), why('10.30.0.0/24'));
    undo();
    // A reference moves too: PC3's gateway 10.10.0.254, which no device holds,
    // would become 10.30.0.254, and somebody outside the network holds that.
    batch(() => { state.nodes.push(normalizeLoadedNode({ id: 'stray', type: 'pc', name: 'Stray', x: 0, y: 600, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.30.0.254/24' }] })); save(); });
    ok('a gateway reference that would land on somebody else\'s address', /10\.30\.0\.254 is already used by Stray/.test(why('10.30.0.0/24')), why('10.30.0.0/24'));
    undo();
    const plan = planRenumber(lanId(), '10.30.0.0/24');
    ok('a clean plan: six addresses and three references', !plan.errors.length && plan.ifaces.length === 6 && plan.refs.length === 3,
       `${plan.errors.join('|')} ${plan.ifaces.length}/${plan.refs.length}`);
    const bytesBefore = JSON.stringify(serializeDoc());
    const stepsBefore = steps();
    answers.push(() => '10.30.0.0/24', () => true);
    await renumberNetwork(lanId());
    const lanNow = state.networks.find((n) => n.id === lanId());
    ok('Renumber moves the network', lanNow.cidr === '10.30.0.0/24');
    ok('every member keeps its host part', getNode('pc1').interfaces[0].ip === '10.30.0.21/24' && getNode('rtr').interfaces[1].ip === '10.30.0.1/24'
       && getNode('ns').interfaces[0].ip === '10.30.0.53/24');
    ok('and the references move with them', lanNow.gateway === '10.30.0.1' && lanNow.dns === '10.30.0.53' && getNode('pc3').gw === '10.30.0.254');
    ok('what pointed elsewhere is left alone', getNode('pc3').dns === '8.8.8.8' && getNode('rtr').interfaces[0].ip === '203.0.113.2/30');
    ok('the members still reach their gateway', nodeChecks(getNode('pc4')).find((c) => c.key === 'gateway').level === 'good');
    ok('in one undo step', steps() === stepsBefore + 1, `${stepsBefore} -> ${steps()}`);
    undo();
    ok('which Undo takes back whole', JSON.stringify(serializeDoc()) === bytesBefore);
    answers.push(() => '10.30.0.0/25', (req) => { ok('a refused renumber says why', req.kind === 'tell' && /does not fit/.test(req.message), req.message); });
    await renumberNetwork(lanId());
    ok('and changes nothing', JSON.stringify(serializeDoc()) === bytesBefore);

    // ---- 7: construction ----
    const spawned = spawnNode('pc', { connectTo: 'sw' });
    ok('a device cabled into a declared network gets an address and inherits, with no copies', spawned.interfaces[0].ip.startsWith('10.10.0.')
       && spawned.gw === '' && spawned.dns === '' && effectiveGw(spawned) === '10.10.0.1', spawned.interfaces[0].ip);
    undo();
    // The network's gateway is taken even when nobody drew it.
    state.networks.push(makeNetwork('10.60.0.0/24'));
    state.networks[state.networks.length - 1].gateway = '10.60.0.1';
    ok('the next free address skips an undrawn gateway', nextFreeAddress('10.60.0.0/24') === '10.60.0.2');
    state.networks.pop();
    const count = state.networks.length;
    insertBlock(builtinBlock('dmz'));
    const added = state.networks.length - count;
    ok('a stamped block declares the subnets it brings', added > 0, String(added));
    const stamped = state.nodes.filter((n) => /^s_/.test(n.id));
    ok('and its devices keep no copies of them', stamped.every((n) => { const g = gatewaySource(n); return !(g.network && n.gw); }));
    undo();
    ok('a block is one undo step, networks included', state.networks.length === count);

    // ---- The tab speaks the visitor's language (its sentences) ----
    setLocale('es'); renderNetworksPanel(true);
    ok('es: the card is translated', /de 254 en uso/.test(lanCard().textContent) && /Seleccionar miembros/.test(lanCard().textContent));
    // The tab's static markup too: the Subnet zones tooltip is a sentence and
    // + Subnet its button, so both follow the locale; the label stays English.
    applyStaticI18n();
    const zonesLbl = el('subnetZonesToggle').closest('label');
    ok('es: the Subnet zones tooltip is translated', /^Dibuja la zona/.test(zonesLbl.title), zonesLbl.title);
    ok('es: + Subnet is translated', el('addNetworkBtn').textContent === '+ Subred', el('addNetworkBtn').textContent);
    ok('es: Subnet zones itself stays English', /Subnet zones/.test(zonesLbl.textContent));
    setLocale('en'); applyStaticI18n(); renderNetworksPanel(true);
    ok('back to en: the tooltip and button read English again', /^Draw each subnet/.test(zonesLbl.title) && el('addNetworkBtn').textContent === '+ Subnet');

    // ---- Read-only: the networks are document too ----
    replaceDocument({ v: DOC_VERSION + 1, nodes: [], links: [], networks: [{ id: 'x', cidr: '10.0.0.0/24' }] }, { origin: 'file' });
    ok('a newer document\'s networks cannot be edited', el('networkList').inert === true && el('addNetworkBtn').inert === true);
    ok('nor renumbered', (await renumberNetwork('x'), state.networks[0].cidr === '10.0.0.0/24'));
    replaceDocument(templatesData.house, { origin: 'template' });
    ok('opening another document puts them back in reach', el('networkList').inert === false);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
