// The findings engine (R5). One pass, diagnoseDoc(), feeds the node tab, the
// badges, the alert panel and the report, so the things asserted here are the
// ones two engines used to get wrong between them: the 0.0.0.0 placeholder and
// a mixed-family gateway, IPv6 subnets, a duplicate MAC or an unreachable
// gateway/DNS server that never left the node tab. Then that the engine is
// pure (it can be asked about a scratch copy, which the bulk preview will
// diff), that the shared reachability walk agrees with the plain one, and that
// the panel groups, folds and points at what it is talking about.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const N = (o) => normalizeLoadedNode(o);
  const L = (o) => normalizeLoadedLink(o);
  // These fixtures declare no networks (R7), so none is left over from the
  // boot document to lend them a gateway.
  const use = (nodes, links) => { state.nodes = nodes.map(N); state.links = (links || []).map(L); state.networks = []; autoBindLinks(); };
  const keys = () => topologyFindings().map((f) => f.key);
  const row = (id, key) => nodeChecks(getNode(id)).find((c) => c.key === key);

  // ---- The 0.0.0.0 placeholder ----
  // A router drawn with the default-route placeholder used to be "unreachable"
  // in the panel and fine on the node tab.
  use([
    { id: 'net', type: 'cloud', name: 'ISP', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '203.0.113.1/30' }] },
    { id: 'r', type: 'router', name: 'Edge', x: 0, y: 100, gw: '0.0.0.0',
      interfaces: [{ id: 'i1', name: 'wan', ip: '203.0.113.2/30' }, { id: 'i2', name: 'lan', ip: '192.168.1.1/24' }] }
  ], [{ id: 'l1', source: 'net', target: 'r', sourceIface: 'i1', targetIface: 'i1' }]);
  ok('a 0.0.0.0 gateway raises no finding', !keys().includes('gateway'), topologyFindings().map((f) => f.line).join(' | '));
  ok('and the node tab calls it the placeholder', /placeholder/i.test(row('r', 'gateway').text), row('r', 'gateway').text);

  // ---- Mixed address families ----
  // ipaddr.js throws when an IPv4 gateway is matched against an IPv6 network;
  // the old panel check caught that and printed "Invalid gateway format".
  use([
    { id: 'g', type: 'router', name: 'GW', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.1/24' }, { id: 'i2', name: 'eth1', ip: '2001:db8::1/64' }] },
    { id: 'h', type: 'server', name: 'Dual', x: 0, y: 100, gw: '192.168.1.1',
      interfaces: [{ id: 'i1', name: 'eth0', ip: '2001:db8::5/64' }, { id: 'i2', name: 'eth1', ip: '192.168.1.50/24' }] }
  ], [{ id: 'l1', source: 'g', target: 'h', sourceIface: 'i1', targetIface: 'i2' }]);
  ok('an IPv4 gateway on a dual-stack host whose IPv6 NIC comes first is fine',
     !keys().includes('gateway') && row('h', 'gateway').level === 'good', row('h', 'gateway').text);
  getNode('h').gw = '2001:db8::1';
  ok('so is an IPv6 gateway with an IPv4 NIC first', row('h', 'gateway').level === 'good', row('h', 'gateway').text);
  getNode('h').gw = '10.9.9.9';
  ok('a gateway outside every subnet is critical and says why',
     row('h', 'gateway').level === 'bad' && /outside every subnet/.test(row('h', 'gateway').text), row('h', 'gateway').text);
  ok('and the same verdict is a finding', topologyFindings().some((f) => f.key === 'gateway' && f.nodeIds[0] === 'h'));

  // ---- IPv6 subnets ----
  use([
    { id: 'a', type: 'server', name: 'A6', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '2001:db8::1/64' }] },
    { id: 'b', type: 'server', name: 'B6', x: 100, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '2001:db8::2/64' }] }
  ], [{ id: 'l1', source: 'a', target: 'b', sourceIface: 'i1', targetIface: 'i1' }]);
  ok('the IPv6 network is the masked prefix', parseValidCIDR('2001:db8::5/64').networkStr === '2001:db8::/64',
     parseValidCIDR('2001:db8::5/64').networkStr);
  ok('and an odd prefix masks inside the group', parseValidCIDR('2001:db8:abcd:12ff::1/52').networkStr === '2001:db8:abcd:1000::/52',
     parseValidCIDR('2001:db8:abcd:12ff::1/52').networkStr);
  ok('two hosts on one /64 are not a cabling fault', !keys().includes('cabling'), topologyFindings().map((f) => f.line).join(' | '));
  ok('and the report lists one IPv6 network, not one per host',
     reportSubnets().length === 1 && reportSubnets()[0].network === '2001:db8::/64', reportSubnets().map((s) => s.network).join(', '));
  ok('IPv4 is unchanged', parseValidCIDR('10.1.2.3/20').networkStr === '10.1.0.0/20');

  // ---- Duplicate MACs reach the panel and the report ----
  use([
    { id: 'm1', type: 'pc', name: 'Alpha', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.2/24', mac: '3C:07:54:11:22:33' }] },
    { id: 'm2', type: 'pc', name: 'Beta', x: 100, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.3/24', mac: '3c07.5411.2233' }] }
  ]);
  const macs = topologyFindings().filter((f) => f.key === 'mac-conflict');
  ok('one finding per duplicated address', macs.length === 1, String(macs.length));
  ok('naming both holders, by id', macs[0] && macs[0].nodeIds.join(',') === 'm1,m2', macs[0] && macs[0].nodeIds.join(','));
  ok('and it is in the report', reportModel().findings.some((f) => f.key === 'mac-conflict'));
  ok('while the node tab still says it from each side', row('m1', 'mac').level === 'bad' && row('m2', 'mac').level === 'bad');
  use([{ id: 'm1', type: 'server', name: 'Solo', x: 0, y: 0, interfaces: [
    { id: 'i1', name: 'eno1', ip: '', mac: '3C:07:54:11:22:33' }, { id: 'i2', name: 'eno2', ip: '', mac: '3C:07:54:11:22:33' }] }]);
  ok('one device repeating its own address is not a conflict', !keys().includes('mac-conflict'), keys().join(','));

  // ---- Unreachable gateway and DNS reach the panel and the report ----
  use([
    { id: 'r1', type: 'router', name: 'R1', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] },
    { id: 'r2', type: 'router', name: 'R2', x: 300, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.254/24' }] },
    { id: 'dns', type: 'server', name: 'Resolver', x: 300, y: 100, ports: '53', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.53/24' }] },
    { id: 'h', type: 'pc', name: 'Host', x: 0, y: 100, gw: '10.0.0.254', dns: '10.0.0.53', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.9/24' }] }
  ], [{ id: 'l1', source: 'r1', target: 'h', sourceIface: 'i1', targetIface: 'i1' },
      { id: 'l2', source: 'r2', target: 'dns', sourceIface: 'i1', targetIface: 'i1' }]);
  const gwF = topologyFindings().find((f) => f.key === 'gateway');
  const dnsF = topologyFindings().find((f) => f.key === 'dns');
  ok('an unreachable gateway is a finding', gwF && /not reachable/.test(gwF.detail) && gwF.nodeIds[0] === 'h', gwF && gwF.line);
  ok('so is an unreachable DNS server', dnsF && /not reachable/.test(dnsF.detail) && dnsF.nodeIds[0] === 'h', dnsF && dnsF.line);
  ok('and both are in the report', ['gateway', 'dns'].every((k) => reportModel().findings.some((f) => f.key === k)));
  ok('the node tab says the same', row('h', 'gateway').level === 'bad' && row('h', 'dns').level === 'bad');
  // A warning on the node tab is not a finding: every new device has no DNS.
  state.nodes.push(N({ id: 'bare', type: 'pc', name: 'New PC', x: 0, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.77/24' }] }));
  ok('a device with no gateway or DNS yet raises no finding', !topologyFindings().some((f) => f.nodeIds.includes('bare')),
     topologyFindings().filter((f) => f.nodeIds.includes('bare')).map((f) => f.line).join(' | '));
  ok('only a node-tab warning', row('bare', 'gateway').level === 'warn' && row('bare', 'dns').level === 'warn');

  // ---- A gateway past the cloud ----
  use([
    { id: 'net', type: 'cloud', name: 'ISP', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] },
    { id: 'r', type: 'router', name: 'Edge', x: 0, y: 100, gw: '203.0.113.1', interfaces: [{ id: 'i1', name: 'wan', ip: '203.0.113.2/30' }] },
    { id: 'p', type: 'pc', name: 'Typo', x: 0, y: 200, gw: '192.168.5.254', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.5.10/24' }] }
  ], [{ id: 'l1', source: 'net', target: 'r', sourceIface: 'i1', targetIface: 'i1' }]);
  ok('a public upstream behind a reachable cloud is outside the map, not missing',
     row('r', 'gateway').level === 'good' && !topologyFindings().some((f) => f.nodeIds.includes('r')), row('r', 'gateway').text);
  ok('a private gateway nobody holds is still critical', topologyFindings().some((f) => f.key === 'gateway' && f.nodeIds[0] === 'p'));

  // ---- A bridged guest reaches out through its host ----
  use([
    { id: 'r', type: 'router', name: 'R', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.1.0.1/24' }] },
    { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, interfaces: [] },
    { id: 'hv', type: 'server', name: 'Hypervisor', x: 0, y: 200, gw: '10.1.0.1', interfaces: [{ id: 'i1', name: 'eno1', ip: '10.1.0.10/24' }, { id: 'i2', name: 'eth0', ip: '' }] },
    { id: 'vm', type: 'vm', name: 'Guest', x: 0, y: 300, gw: '10.1.0.1', interfaces: [{ id: 'i1', name: 'ens18', ip: '10.1.0.20/24' }] }
  ], [{ id: 'l1', source: 'r', target: 'sw', sourceIface: 'i1', targetIface: 'p1' },
      { id: 'l2', source: 'sw', target: 'hv', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'l3', source: 'hv', target: 'vm', sourceIface: 'i2', targetIface: 'i1', attachment: 'bridged' }]);
  ok('a bridged VM reaches its gateway through a plain server', row('vm', 'gateway').level === 'good', row('vm', 'gateway').text);
  state.links[2].attachment = null;
  ok('and so does one whose link names no attachment', row('vm', 'gateway').level === 'good', row('vm', 'gateway').text);

  // ---- Pure ----
  loadDocState(templatesData.errors); autoBindLinks(); renderCanvasOnly();
  // The port is a setting now (R8); the input only mirrors it. Both are
  // watched: the engine must change neither.
  state.settings.tracePort = '443'; state.settings.tracePortOn = true; syncTraceControls();
  const tracePort = document.getElementById('tracePort');
  const panelBefore = document.getElementById('conflictMsgList').innerHTML;
  const nodesBefore = state.nodes, linksBefore = state.links, onScreen = topologyFindings().map((f) => f.line).join('|');
  // The trace port used to be read by blanking the input mid-check; count any
  // write to it while the engine runs.
  let writes = 0;
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(tracePort, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { writes++; desc.set.call(this, v); } });
  const scratch = { nodes: cloneData(state.nodes), links: cloneData(state.links) };
  scratch.nodes.find((n) => n.id === 'dup').interfaces[0].ip = '192.168.9.99/24';
  const fresh = diagnoseDoc(scratch);
  const live = diagnoseDoc();
  delete tracePort.value;
  ok('a scratch copy is diagnosed on its own terms', !fresh.findings.some((f) => f.key === 'ip-conflict') && live.findings.some((f) => f.key === 'ip-conflict'),
     fresh.findings.map((f) => f.key).join(','));
  ok('the editor still holds its own document afterwards', state.nodes === nodesBefore && state.links === linksBefore
     && topologyFindings().map((f) => f.line).join('|') === onScreen);
  ok('nothing on the page changed', document.getElementById('conflictMsgList').innerHTML === panelBefore && tracePort.value === '443'
     && state.settings.tracePort === '443' && state.settings.tracePortOn === true);
  ok('and the trace port input was never touched', writes === 0, `${writes} writes`);
  ok('a typed trace port does not change a verdict', diagnoseDoc().findings.map((f) => f.line).join('|') === onScreen);
  ok('the lookup indexes are closed after a pass', lookupPass === null);
  let threw = false;
  try { diagnoseDoc({ nodes: [{ id: 'x', type: 'pc', name: 'X', interfaces: null, get gw() { throw new Error('boom'); } }], links: [] }); } catch (e) { threw = true; }
  ok('a check that throws on a scratch copy still hands the document back', threw && state.nodes === nodesBefore && lookupPass === null);
  state.settings.tracePort = ''; state.settings.tracePortOn = false; syncTraceControls();

  // ---- The shared walk is the plain walk ----
  // reachContext() composes a host's reach from its first step and the walks
  // of the routers it hands on to, shared between hosts. It must find what a
  // single calculateReachability() finds, from every device.
  let checked = 0; const differs = [];
  Object.keys(templatesData).forEach((k) => {
    loadDocState(templatesData[k]); autoBindLinks();
    withLookupPass(() => {
      const ctx = reachContext();
      state.nodes.forEach((n) => {
        const a = ctx.reach(n.id), b = calculateReachability(n.id, { port: '' });
        checked++;
        const same = (x, y) => x.size === y.size && [...x].every((v) => y.has(v));
        if (!same(a.reachableNodes, b.reachableNodes) || !same(a.reachableLinks, b.reachableLinks)) differs.push(`${k}/${n.name}`);
      });
    });
  });
  ok('the shared reachability walk agrees with the plain one on every template device', differs.length === 0 && checked > 100,
     differs.slice(0, 4).join(', ') || `${checked} devices`);

  // ---- One list, every surface ----
  loadDocState(templatesData.errors); autoBindLinks(); renderCanvasOnly();
  const diag = currentDiagnosis();
  ok('the badges are the engine\'s severities', state.nodes.every((n) => nodeSeverity(n) === diag.nodes.get(n.id).severity));
  // nodeSeverity is what drawCanvas draws the badge from (js/ui.js), so the
  // suites asserting badges through it assert the map: here, the drawn disc.
  const drawn = (n) => { const disc = document.querySelector(`#ui-node-${CSS.escape(n.id)} > g[transform="translate(19, -19)"] circle`);
    return disc ? (disc.getAttribute('fill') === '#dc2626' ? 'bad' : 'warn') : null; };
  ok('and what the map draws on each device', state.nodes.every((n) => drawn(n) === nodeSeverity(n)) && state.nodes.some((n) => drawn(n)),
     state.nodes.filter((n) => drawn(n) !== nodeSeverity(n)).map((n) => `${n.name}:${drawn(n)}/${nodeSeverity(n)}`).join(', '));
  ok('every finding points at a device or a cable', diag.findings.every((f) => f.nodeIds.length || f.linkIds.length),
     diag.findings.find((f) => !f.nodeIds.length && !f.linkIds.length)?.line);
  ok('every id it points at exists', diag.findings.every((f) => f.nodeIds.every((id) => getNode(id)) && f.linkIds.every((id) => getLink(id))));
  ok('the report lists the same findings', reportModel().findings.length === diag.findings.length);
  const before = currentDiagnosis();
  getNode('dup').x += 40;
  ok('moving a device reuses the pass', currentDiagnosis() === before);
  getNode('dup').name = 'Renamed';
  ok('editing one runs it again', currentDiagnosis() !== before && topologyFindings().some((f) => /Renamed/.test(f.line)));

  // Undo, redo and Back/Forward rebuild every node object from the stored
  // document. After a move the key still matches, so the pass is reused, and
  // its entries must follow the new objects: an entry left on the old object
  // made every render rerun each device's checks alone, unindexed (seconds a
  // render at a few hundred devices).
  const rebuilt = currentDiagnosis();
  state.nodes = state.nodes.map((n) => Object.assign(cloneData(n), { x: n.x + 15 }));
  let lone = 0;
  const realReach = reachContext;
  reachContext = function () { lone++; return realReach(); };
  try {
    ok('a rebuilt document with only moves reuses the pass', currentDiagnosis() === rebuilt);
    ok('and its entries are the new objects', state.nodes.every((n) => currentDiagnosis().nodes.get(n.id).node === n));
    state.nodes.forEach((n) => nodeDiagnosis(n));
    renderCanvasOnly();
    ok('so no device is diagnosed on its own', lone === 0, `${lone} lone runs`);
  } finally { reachContext = realReach; }
  ok('a node object the document does not hold still gets its own run', nodeDiagnosis(cloneData(getNode('dup'))).checks.length === NODE_CHECKS.length);

  // ---- The panel: grouped, folded, clickable ----
  const hosts = [{ id: 'r', type: 'router', name: 'R', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] }];
  for (let i = 0; i < 30; i++) hosts.push({ id: `h${i}`, type: 'pc', name: `PC-${i}`, x: 60 * i, y: 200, gw: '10.9.9.1', interfaces: [{ id: 'i1', name: 'eth0', ip: `10.0.0.${i + 10}/24` }] });
  hosts.push({ id: 'dupA', type: 'pc', name: 'Dup A', x: 0, y: 400, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.200/24' }] });
  hosts.push({ id: 'dupB', type: 'pc', name: 'Dup B', x: 900, y: 400, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.200/24' }] });
  // Five ARP-flux warnings, each on its own subnet, so five distinct lines.
  for (let i = 0; i < 5; i++) hosts.push({ id: `mh${i}`, type: 'server', name: `MH-${i}`, x: 80 * i, y: 600,
    interfaces: [{ id: 'i1', name: 'eth0', ip: `172.16.${i}.10/24` }, { id: 'i2', name: 'eth1', ip: `172.16.${i}.11/24` }] });
  try { localStorage.removeItem('nettopo_alert_groups'); } catch (e) { /* blocked storage */ }
  panelOpen.clear();
  use(hosts);
  state.settings.alertsHidden = false;
  renderCanvasOnly();
  const list = document.getElementById('conflictMsgList');
  const groups = [...list.querySelectorAll('.ca-group')];
  const gwGroup = groups.find((g) => /Gateway/.test(g.querySelector('.ca-check').textContent));
  ok('thirty identical gateway findings are one group', gwGroup && gwGroup.querySelector('.ca-count').textContent === '30',
     gwGroup && gwGroup.querySelector('.ca-count').textContent);
  ok('folded into one line naming the devices', gwGroup && gwGroup.querySelectorAll('.ca-line').length === 1
     && /PC-0, PC-1, PC-2 and 27 more: Gateway 10\.9\.9\.1/.test(gwGroup.querySelector('.ca-line').textContent),
     gwGroup && gwGroup.querySelector('.ca-line').textContent.slice(0, 80));
  ok('a critical group starts open however long it is', gwGroup && !gwGroup.querySelector('.ca-items').hidden
     && gwGroup.querySelector('.ca-group-head').getAttribute('aria-expanded') === 'true');
  const mhGroup = () => [...list.querySelectorAll('.ca-group')].find((g) => /Multi-Homing/.test(g.querySelector('.ca-check').textContent));
  ok('a long warning group starts closed', mhGroup() && mhGroup().querySelectorAll('.ca-line').length === 5
     && mhGroup().querySelector('.ca-items').hidden && mhGroup().querySelector('.ca-group-head').getAttribute('aria-expanded') === 'false');
  ok('the pill still counts every finding', document.getElementById('conflictPillCount').textContent === String(topologyFindings().length));
  mhGroup().querySelector('.ca-group-head').click();
  ok('its header opens it', !mhGroup().querySelector('.ca-items').hidden);
  gwGroup.querySelector('.ca-group-head').click();
  renderCanvasOnly();
  const gwAgain = [...list.querySelectorAll('.ca-group')].find((g) => /Gateway/.test(g.querySelector('.ca-check').textContent));
  ok('and both stay as left across the next render', !mhGroup().querySelector('.ca-items').hidden && gwAgain.querySelector('.ca-items').hidden);
  let savedOpen = null;
  try { savedOpen = JSON.parse(localStorage.getItem('nettopo_alert_groups')); } catch (e) { /* blocked storage */ }
  ok('and are remembered for the next visit', savedOpen && savedOpen.multihoming === true && savedOpen.gateway === false, JSON.stringify(savedOpen));
  gwAgain.querySelector('.ca-group-head').click();

  const canvasRect = document.getElementById('networkCanvas').getBoundingClientRect();
  const centred = (id) => {
    const n = getNode(id);
    return Math.abs(n.x * state.camera.zoom + state.camera.x - canvasRect.width / 2) < 1
      && Math.abs(n.y * state.camera.zoom + state.camera.y - canvasRect.height / 2) < 1;
  };
  const conflictLine = () => [...list.querySelectorAll('.ca-line')].find((b) => /shared by Dup A, Dup B/.test(b.textContent));
  ok('a line under its check does not repeat the check', conflictLine() && /^10\.0\.0\.200 shared by/.test(conflictLine().textContent),
     conflictLine() && conflictLine().textContent);
  conflictLine().click();
  ok('clicking a finding selects the device', state.selectedType === 'node' && state.selectedId === 'dupA', `${state.selectedType}:${state.selectedId}`);
  ok('and centres the map on it', centred('dupA'));
  conflictLine().click();
  ok('clicking again moves on to the next one', state.selectedId === 'dupB' && centred('dupB'), String(state.selectedId));
  conflictLine().click();
  ok('and comes round again', state.selectedId === 'dupA');

  loadDocState(templatesData.errors); autoBindLinks(); renderCanvasOnly();
  const cableLine = [...list.querySelectorAll('.ca-line')].find((b) => /different subnets/.test(b.textContent));
  cableLine.click();
  ok('a cable finding selects the cable', state.selectedType === 'link' && topologyFindings().some((f) => f.key === 'cabling' && f.linkIds[0] === state.selectedId),
     `${state.selectedType}:${state.selectedId}`);
  ok('the lines are buttons', [...list.querySelectorAll('.ca-line')].every((b) => b.tagName === 'BUTTON' && b.type === 'button'));
  select(null);
  try { localStorage.removeItem('nettopo_alert_groups'); } catch (e) { /* blocked storage */ }
  panelOpen.clear();

  // ---- Translated ----
  setLocale('es');
  ok('the new check names are translated', t('MAC Conflict') !== 'MAC Conflict' && t('{names} and {n} more', { names: 'A', n: 2 }) === 'A y 2 más');
  ok('so is the verdict past the cloud', !/outside the map/.test(t('Gateway {gw} is past the cloud/internet node, outside the map.', { gw: '1.2.3.4' })));
  setLocale('en');

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
