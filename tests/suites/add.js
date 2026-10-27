// Add devices and blocks (plan R8, js/add.js). The count wizard became one
// dialog: kinds × typeable counts with no cap of 9, a name pattern that
// carries on after the names already on the map, the selected switch or AP's
// next free ports and its network's next free addresses, all in one batch.
// Blocks became saved selections, re-addressed into the next free network
// when inserted, and a selection can be saved as one. Everything here drives
// the real dialog, store and findings.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const el = (id) => document.getElementById(id);
  const isOpen = () => !el('addDevices').hidden;
  const ipOf = (n) => (n.interfaces[0] && n.interfaces[0].ip) || '';
  const count = (type, v) => { const i = document.querySelector(`#addRows .add-count[data-type="${type}"]`); i.value = String(v); i.dispatchEvent(new Event('input')); };
  const summary = () => el('addSummary').textContent;
  const site = () => replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'r', type: 'router', name: 'Core', x: 400, y: 80, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 400, y: 240, portCount: 24, interfaces: [] },
      { id: 'ap', type: 'ap', name: 'AP-1', x: 700, y: 240, interfaces: [{ id: 'w1', name: 'wlan0', ip: '' }] },
      { id: 'p1', type: 'voip', name: 'Phone-01', x: 300, y: 400, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.0.2/24' }] },
      { id: 'p2', type: 'voip', name: 'Phone-02', x: 400, y: 400, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.0.3/24' }] } ],
    links: [{ id: 'l1', source: 'r', target: 'sw', sourceIface: 'i1', targetIface: 'p1' },
            { id: 'l2', source: 'sw', target: 'ap', sourceIface: 'p2', targetIface: 'p1' },
            { id: 'l3', source: 'sw', target: 'p1', sourceIface: 'p3', targetIface: 'i1' },
            { id: 'l4', source: 'sw', target: 'p2', sourceIface: 'p5', targetIface: 'i1' }],
    networks: [{ id: 'lan', cidr: '10.20.0.0/24', name: 'Office LAN', gateway: '10.20.0.1', dns: '10.20.0.1' }] }, { origin: 'file' });

  // ---- The plan: names, ports, addresses ----
  site();
  let plan = planAddDevices({ items: [{ type: 'voip', count: 12 }], pattern: 'Phone-{n:02}', targetId: 'sw' });
  ok('twelve of one kind, no cap of 9', plan.total === 12);
  ok('the names carry on after the ones on the map', plan.devices[0].name === 'Phone-03' && plan.devices[11].name === 'Phone-14',
     `${plan.devices[0].name} … ${plan.devices[11].name}`);
  ok('the ports are the next free ones, in order, around the ones in use',
     plan.devices.slice(0, 3).map((d) => d.port).join(',') === 'p4,p6,p7', plan.devices.slice(0, 3).map((d) => d.port).join(','));
  ok('the addresses are the next free hosts, past the gateway and the phones',
     plan.devices[0].ip === '10.20.0.4/24' && plan.devices[11].ip === '10.20.0.15/24', `${plan.devices[0].ip} … ${plan.devices[11].ip}`);
  plan = planAddDevices({ items: [{ type: 'voip', count: 25 }], pattern: 'Phone-{n:02}', targetId: 'sw' });
  ok('past an explicit faceplate is counted, not refused', plan.total === 25 && plan.portsPast === 5, String(plan.portsPast));
  plan = planAddDevices({ items: [{ type: 'pc', count: 1 }, { type: 'printer', count: 2 }], pattern: '', targetId: 'sw' });
  ok('left blank, a lone device is called by its kind and several are numbered',
     plan.devices.map((d) => d.name).join('|') === 'Workstation|Printer 1|Printer 2', plan.devices.map((d) => d.name).join('|'));
  plan = planAddDevices({ items: [{ type: 'iot', count: 3 }], pattern: 'Sensor {n}', targetId: 'ap' });
  ok('onto an AP: by radio, no port', plan.devices.every((d) => d.wireless && !d.port));
  ok('and the AP’s network gives the addresses', plan.devices[0].ip === '10.20.0.4/24', plan.devices[0].ip);
  plan = planAddDevices({ items: [{ type: 'switch', count: 1 }], pattern: '', targetId: 'sw' });
  ok('a switch added stays layer 2: a port, no address', !!plan.devices[0].port && !plan.devices[0].ip);
  ok('a count is clamped to ADD_MAX', planAddDevices({ items: [{ type: 'pc', count: 5000 }], targetId: null }).total === ADD_MAX);
  ok('without {n}, the plan says the names will repeat', planAddDevices({ items: [{ type: 'pc', count: 3 }], pattern: 'Desk', targetId: null }).sameNames);

  // ---- Applying: one step, selected, nothing invented ----
  site();
  const before = state.nodes.length;
  const added = addDevices({ items: [{ type: 'voip', count: 12 }], pattern: 'Phone-{n:02}', targetId: 'sw' });
  ok('the devices are added', state.nodes.length === before + 12 && added.length === 12);
  ok('and selected, ready for the next bulk edit', state.selection.size === 12 && added.every((n) => inSelection('node', n.id)));
  ok('each one cabled to its planned port', added.every((n) => state.links.some((l) => l.source === 'sw' && l.target === n.id && /^p\d+$/.test(l.sourceIface))));
  ok('with its address from the network', ipOf(added[0]) === '10.20.0.4/24');
  ok('and no gateway or DNS copied onto it: the network hands them down',
     added.every((n) => !n.gw && !n.dns) && effectiveGw(added[0]) === '10.20.0.1');
  ok('no two devices share an address', (() => { const ips = state.nodes.map(ipOf).filter(Boolean); return new Set(ips).size === ips.length; })());
  ok('no port is used twice', (() => { const ports = state.links.filter((l) => l.source === 'sw').map((l) => l.sourceIface); return new Set(ports).size === ports.length; })());
  ok('they sit below the switch, under what already hangs there', added.every((n) => n.y > 400));
  undo();
  ok('one Undo takes them all back', state.nodes.length === before);

  // Loose: nowhere to take an address from, so none (no seed address either).
  site();
  const loose = addDevices({ items: [{ type: 'pc', count: 3 }], targetId: null });
  ok('loose devices have no address and no cable', loose.every((n) => !ipOf(n) && !state.links.some((l) => l.target === n.id)));
  ok('and no invented gateway, DNS or OS', loose.every((n) => !n.gw && !n.dns && !n.os));

  // An undeclared subnet is declared first, so the devices inherit.
  replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'r', type: 'router', name: 'R', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'S', x: 0, y: 150, interfaces: [] }],
    links: [{ id: 'l1', source: 'r', target: 'sw' }] }, { origin: 'file' });
  autoBindLinks();
  addDevices({ items: [{ type: 'camera', count: 4 }], targetId: 'sw' });
  ok('a subnet nobody declared is declared, with the router as gateway',
     state.networks.length === 1 && state.networks[0].cidr === '10.9.0.0/24' && state.networks[0].gateway === '10.9.0.1');

  // ---- The dialog ----
  site();
  showLibraryTab('nodes');
  ok('the Nodes tab has "+ Add devices…"', !!el('addDevicesBtn') && el('tabPanel-nodes').contains(el('addDevicesBtn')));
  select('sw', 'node');
  el('addDevicesBtn').click();
  ok('it opens the dialog to add', isOpen() && el('addTitle').textContent === 'Add devices' && !el('addTargetField').hidden);
  ok('connected to the selected switch by default', el('addTarget').value === 'sw');
  ok('the router is offered when adding', !!document.querySelector('#addRows .add-count[data-type="router"]'));
  ok('every count starts at zero, and Apply waits for one', [...document.querySelectorAll('#addRows .add-count')].every((i) => i.value === '0')
     && el('addApplyBtn').disabled);
  ok('the full editor shows the options', el('addMore').open);
  count('voip', 12);
  el('addPattern').value = 'Phone-{n:02}'; el('addPattern').dispatchEvent(new Event('input'));
  ok('Apply says how many', el('addApplyBtn').textContent === 'Add 12 devices' && !el('addApplyBtn').disabled);
  ok('the summary names the run, the ports and the addresses', /Phone-03 … Phone-14/.test(summary())
     && /SW-1, ports 4–16/.test(summary()) && /10\.20\.0\.4 – 10\.20\.0\.15 on Office LAN/.test(summary()), summary());
  count('voip', 25);
  ok('and warns about a port overflow before it happens', /past the 24-port faceplate of SW-1/.test(summary()), summary());
  el('addTarget').value = 'ap'; el('addTarget').dispatchEvent(new Event('change'));
  ok('onto an AP it says radio', /Joined to AP-1 by radio/.test(summary()), summary());
  el('addTarget').value = 'sw'; count('voip', 3);
  const n0 = state.nodes.length;
  el('addPattern').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  ok('Enter applies, and the dialog closes', state.nodes.length === n0 + 3 && !isOpen());

  // A reduced view keeps the options folded and the technical lines out.
  state.settings.advanced = false; applyProfile();
  select('sw', 'node');
  el('addDevicesBtn').click();
  count('pc', 2);
  ok('reduced: options folded, no ports or addresses in the summary', !el('addMore').open
     && !/port|10\.20/.test(summary()) && /Connected to SW-1/.test(summary()), summary());
  closeAddDevices();
  state.settings.advanced = true; applyProfile();

  // A read-only document refuses, before the dialog opens.
  replaceDocument({ v: DOC_VERSION + 1, nodes: [{ id: 'a', type: 'switch', name: 'A', x: 0, y: 0, interfaces: [] }], links: [] }, { origin: 'file' });
  openAddDevices({ mode: 'add' });
  ok('a read-only network is not added to', !isOpen() && addDevices({ items: [{ type: 'pc', count: 2 }], targetId: 'a' }).length === 0
     && state.nodes.length === 1);

  // ---- The landing ----
  ok('the landing says "Add devices", not "Set up from a count"', el('landingAddBtn').textContent === 'Add devices'
     && !el('landingWizardBtn') && el('landingAddBtn').parentElement.contains(el('landingExampleBtn')));
  openLanding(false);
  el('landingAddBtn').click();
  ok('it opens the intake for a new network', isOpen() && !landingIsOpen() && el('addTitle').textContent === 'What do you have?'
     && el('addTargetField').hidden && !el('addMore').open);

  // The final review: the intake's summary hid the names, and a pattern
  // without {type} named the switches PC-01…03 unseen.
  document.querySelectorAll('#addRows .add-count').forEach((i) => { i.value = '0'; });
  count('switch', 3); count('pc', 20);
  el('addPattern').value = 'PC-{n:02}'; el('addPattern').dispatchEvent(new Event('input'));
  ok('the intake previews the names it will give', /Names: PC-01 … PC-03, PC-04 … PC-23/.test(summary()), summary());
  ok('and says when every kind shares one run of numbers', /every kind shares one run of numbers/.test(summary()), summary());
  el('addPattern').value = '{type}-{n:02}'; el('addPattern').dispatchEvent(new Event('input'));
  ok('with {type} in it, no warning, and each kind counts on its own', !/shares one run/.test(summary()) && /Switch-01 … Switch-03, Workstation-01 … Workstation-20/.test(summary()), summary());
  el('addPattern').value = '';
  applyAddDevices();
  const hub = state.nodes.find((n) => n.type === 'router');
  const lanId = hub.interfaces[0].id;
  const onHub = state.links.filter((l) => l.source === hub.id || l.target === hub.id);
  ok('the built network\'s router has its LAN address', hub.interfaces[0].ip === '192.168.1.1/24', JSON.stringify(hub.interfaces));
  ok('and every switch is cabled to that LAN, none to an unnumbered port', onHub.length === 3 && onHub.every((l) => ifaceIdOn(l, hub.id) === lanId)
     && hub.interfaces.every((i) => !isBlank(i.ip)), JSON.stringify(hub.interfaces.map((i) => i.name + '=' + i.ip)));
  const sw2 = state.nodes.filter((n) => n.type === 'switch').sort((a, b) => naturalCompare(a.name, b.name))[1];
  plan = planAddDevices({ items: [{ type: 'voip', count: 2 }], targetId: sw2.id });
  ok('so phones added onto the second switch are on the router\'s LAN', plan.cidr === '192.168.1.0/24' && /^192\.168\.1\./.test(plan.devices[0].ip), plan.cidr);

  // A switch on a router port with no address borrows nothing from the
  // router's other port (subnetContext): no address, rather than one on a
  // network the phones are not on.
  replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'r', type: 'router', name: 'R', x: 0, y: 0, interfaces: [{ id: 'a', name: 'eth0', ip: '192.168.1.1/24' }, { id: 'b', name: 'eth1', ip: '' }] },
      { id: 's1', type: 'switch', name: 'SW-A', x: -100, y: 120, portCount: 8, interfaces: [] },
      { id: 's2', type: 'switch', name: 'SW-B', x: 100, y: 120, portCount: 8, interfaces: [] }],
    links: [{ id: 'k1', source: 'r', target: 's1', sourceIface: 'a', targetIface: 'p8' }, { id: 'k2', source: 'r', target: 's2', sourceIface: 'b', targetIface: 'p8' }] }, { origin: 'file' });
  plan = planAddDevices({ items: [{ type: 'voip', count: 2 }], targetId: 's2' });
  ok('a switch on an unnumbered router port gets no addresses from the router\'s other port', plan.cidr === null && plan.devices.every((d) => !d.ip), String(plan.cidr));
  getNode('r').interfaces[1].ip = '10.20.0.1/24'; save();
  plan = planAddDevices({ items: [{ type: 'voip', count: 2 }], targetId: 's2' });
  ok('and once that port is numbered, its network', plan.cidr === '10.20.0.0/24' && plan.devices[0].ip === '10.20.0.2/24', `${plan.cidr} ${plan.devices[0].ip}`);
  plan = planAddDevices({ items: [{ type: 'voip', count: 1 }], targetId: 's1' });
  ok('while the other switch keeps the LAN it is on', plan.cidr === '192.168.1.0/24', String(plan.cidr));

  // ---- Blocks: re-addressed into the next free network ----
  replaceDocument(EMPTY_DOC, { origin: 'file' });
  const first = insertBlock(builtinBlock('voip'));
  ok('a block on an empty map keeps its addresses', first.moves.length === 0
     && state.nodes.some((n) => ipOf(n) === '10.80.0.61/24'));
  ok('and is selected once inserted', state.selection.size === first.nodeIds.length);
  const second = insertBlock(builtinBlock('voip'));
  ok('the second copy moves to the next free network', second.moves.length === 1
     && second.moves[0].from === '10.80.0.0/24' && second.moves[0].to === '10.80.1.0/24', JSON.stringify(second.moves));
  const copy = second.nodeIds.map(getNode);
  ok('every address in it moved with it', copy.filter((n) => ipOf(n)).every((n) => ipOf(n).startsWith('10.80.1.')));
  ok('its network too, with its gateway', state.networks.some((n) => n.cidr === '10.80.1.0/24' && n.gateway === '10.80.1.1'));
  ok('so the two copies do not conflict', (() => { const ips = state.nodes.map(ipOf).filter(Boolean); return new Set(ips).size === ips.length; })()
     && !currentDiagnosis().findings.some((f) => f.key === 'ip-conflict'));
  insertBlock(builtinBlock('voip'));
  ok('and a third goes to the one after', state.networks.some((n) => n.cidr === '10.80.2.0/24'));
  // The DMZ brings two subnets and a WAN /30: each moves on its own.
  replaceDocument(EMPTY_DOC, { origin: 'file' });
  insertBlock(builtinBlock('dmz'));
  const dmz2 = insertBlock(builtinBlock('dmz'));
  ok('a block with several subnets moves each of them', dmz2.moves.length === 3, JSON.stringify(dmz2.moves));
  const fw2 = getNode(dmz2.nodeIds[0]);
  ok('a host keeps its gateway in its own (moved) subnet', (() => {
    const srv = dmz2.nodeIds.map(getNode).find((n) => n.type === 'server');
    const gw = effectiveGw(srv);
    return gw && getValidIps(fw2).some((p) => p.ip.toString() === gw);
  })());

  // ---- Save the selection as a block ----
  persistLibrary({});
  site();
  setSelectionEntries(['sw', 'p1', 'p2'].map((id) => ({ type: 'node', id })));
  const saving = saveSelectionAsBlock();
  await tick();
  el('topoAskInput').value = 'Phone closet';
  el('topoAskInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const blockId = await saving;
  const card = libraryEntry(blockId);
  ok('the selection is saved as a block card', !!card && card.block === true && card.template === true && card.name === 'Phone closet');
  ok('with the selected devices, the cables between them and their network',
     card.doc.nodes.length === 3 && card.doc.links.length === 2 && card.doc.networks.length === 1 && card.doc.networks[0].cidr === '10.20.0.0/24');
  ok('placed around its middle', card.doc.nodes.some((n) => n.x < 0) && card.doc.nodes.some((n) => n.x > 0));
  ok('it is not a site and not a whole-network template', !libraryNetworks().some((e) => e.id === blockId)
     && !libraryTemplates().some((e) => e.id === blockId));
  showLibraryTab('blocks');
  ok('the Blocks tab lists it under My blocks', !el('userBlockSection').classList.contains('hidden')
     && /Phone closet/.test(el('userBlockList').textContent));
  ok('the shipped blocks are still all there', document.querySelectorAll('#blockList .lib-item').length === SNIPPET_META.length);
  const nBefore = state.nodes.length;
  el('userBlockList').querySelector('.lib-item-open').click();
  const inserted = state.nodes.slice(nBefore);
  ok('inserting it adds its devices', inserted.length === 3);
  ok('re-addressed off the network it came from', inserted.filter(ipOf).every((n) => ipOf(n).startsWith('10.20.1.')),
     inserted.map(ipOf).join(','));
  ok('its cables keep their ports', state.links.filter((l) => inserted.some((n) => n.id === l.source)).map((l) => l.sourceIface).sort().join(',') === 'p3,p5');
  // It travels like a template does, and comes back a block.
  const file = binderFile();
  const entry = file.sites.find((x) => x.id === blockId);
  ok('the back-up carries it as a block', !!entry && entry.block === true && entry.template === true);
  persistLibrary({});
  importBinderSites(file.sites);
  ok('and a restore keeps it one', libraryEntry(blockId) && libraryEntry(blockId).block === true);
  // Saving with no devices selected says what to do.
  select(null, null);
  ok('with nothing selected it asks for a selection first', (await saveSelectionAsBlock()) === null);
  persistLibrary({});

  // ---- Translated: plain words in the reporter's language ----
  setLocale('es'); applyStaticI18n();
  openAddDevices({ mode: 'add' });
  ok('es: the dialog speaks Spanish', el('addTitle').textContent === 'Añadir dispositivos'
     && document.querySelector('#addMore summary').textContent === 'Más opciones'
     && el('addDevicesBtn').textContent === '＋ Añadir dispositivos…');
  closeAddDevices();
  setLocale('en'); applyStaticI18n();

  replaceDocument(templatesData.house, { origin: 'template' });
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 50); });
