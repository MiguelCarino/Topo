// Links that carry no IP and the devices on them (js/model.js NONIP_MEDIA,
// isOffNetMedium, isOffIpDevice; docs/SCOPE.md step 9d, D441):
//   1. the kinds: thread, zigbee, zwave, bluetooth and serial carry no IP; a
//      VPN tunnel and those are left out of the network's own walks; a
//      device joined only by them, with no address, is "off IP" (not one
//      with an address, not one with a cable too, not one with no link);
//   2. ports: such a link takes no port when it is made or bound, a cable
//      beside it still does; it is not a cable that owns a port;
//   3. findings: a sensor on its hub raises nothing about ports, and its hub
//      is not asked to bind the sensors; the same drawing by cable is asked;
//   4. the picker: ten kinds; a cable changed to Zigbee lets go of its
//      ports, loses its port pickers, cable facts and label, in one undo
//      step; changed back it is bound again;
//   5. a trace from the router does not arrive at a sensor; What if this
//      fails? takes the sensors with their hub;
//   6. the Simple view's names for the kinds, in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false, ports: '80',
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = (medium) => ({ v: DOC_VERSION,
    nodes: [N('net', 'cloud', { x: 300, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '203.0.113.1/30' }] }),
      N('rt', 'router', { x: 300, y: 120, nat: true, interfaces: [{ id: 'i1', name: 'eth0', ip: '203.0.113.2/30' }, { id: 'i2', name: 'eth1', ip: '192.168.1.1/24' }] }),
      N('sw', 'switch', { x: 300, y: 240, portCount: 8, interfaces: [] }),
      N('hub', 'iot', { x: 300, y: 360, gw: '192.168.1.1', dns: '192.168.1.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24' }] }),
      N('s1', 'iot', { x: 150, y: 480, interfaces: [] }), N('s2', 'iot', { x: 300, y: 480 }), N('s3', 'custom', { x: 450, y: 480 })],
    links: [{ id: 'l1', source: 'net', target: 'rt' }, { id: 'l2', source: 'rt', target: 'sw' }, { id: 'l3', source: 'sw', target: 'hub' },
      { id: 'l4', source: 'hub', target: 's1', medium }, { id: 'l5', source: 'hub', target: 's2', medium }, { id: 'l6', source: 'hub', target: 's3', medium }] });
  const open = (doc) => { replaceDocument(doc, { origin: 'file', docId: 'doc-nonip' }); autoBindLinks(); save(); renderCanvasOnly(); };
  const ports = () => currentDiagnosis().findings.filter((f) => f.check === 'Ports').map((f) => f.nodeIds.join('+')).sort().join();
  const bound = (id) => { const l = getLink(id); return !!(l.sourceIface || l.targetIface); };
  try {
    setLocale('en');
    // ---- 1. The kinds ----
    ok('five kinds carry no IP', ['thread', 'zigbee', 'zwave', 'bluetooth', 'serial'].every(isNonIpMedium) && !['utp', 'fiber', 'wireless', 'powerline', 'vpn', '', undefined].some(isNonIpMedium));
    ok('a tunnel and those are left out of the network\'s walks', isOffNetMedium('vpn') && isOffNetMedium('zigbee') && !isOffNetMedium('wireless') && !isOffNetMedium('utp') && !isOffNetMedium(undefined));
    open(site('zigbee')); await tick();
    ok('a sensor on its hub is off IP', isOffIpDevice(getNode('s1')) && isOffIpDevice(getNode('s2')) && isOffIpDevice(getNode('s3')));
    ok('…its hub is not, nor a switch, nor nothing', !isOffIpDevice(getNode('hub')) && !isOffIpDevice(getNode('sw')) && !isOffIpDevice(null));
    batch(() => { getNode('s2').interfaces[0].ip = '192.168.1.50/24'; state.links.push({ id: 'lx', source: 's3', target: 'sw' }); state.nodes.push(N('alone', 'iot')); save(); renderCanvasOnly(); });
    ok('one with an address is not; nor one with a cable too; nor one with no link', !isOffIpDevice(getNode('s2')) && !isOffIpDevice(getNode('s3')) && !isOffIpDevice(getNode('alone')) && isOffIpDevice(getNode('s1')));

    // ---- 2. Ports ----
    open(site('zigbee')); await tick();
    ok('a link that carries no IP takes no port', !bound('l4') && !bound('l5') && !bound('l6'));
    ok('…a cable beside it does', bound('l2') && bound('l3') && !!getLink('l3').targetIface);
    ok('…and it owns none', isExclusiveLink(getLink('l4')) === false && isExclusiveLink(getLink('l3')) === true);
    const made = bindLink({ id: 'ly', source: 'hub', target: 's1', medium: 'thread' });
    ok('bindLink leaves a new one alone', !made.sourceIface && !made.targetIface);

    // ---- 3. Findings ----
    ok('by Zigbee: nothing about ports from the sensors or their hub', ports() === '', ports());
    const said = evaluatePorts(getNode('s1'));
    ok('…the sensor\'s Ports line says why', said.level === 'ok' && /Joined without a network port/.test(said.text), JSON.stringify(said));
    replaceDocument(site('utp'), { origin: 'file', docId: 'doc-nonip' }); renderCanvasOnly(); await tick();
    ok('the same drawing by cable, unbound, is asked about every end', /hub/.test(ports()) && /s1/.test(ports()) && /s3/.test(ports()), ports());
    replaceDocument(site('zigbee'), { origin: 'file', docId: 'doc-nonip' }); renderCanvasOnly(); await tick();
    ok('unbound by Zigbee: the sensors are not asked, the hub only about its cable', !/s1|s2|s3/.test(ports()) && /hub/.test(ports()), ports());

    // ---- 4. The picker ----
    open(site('utp')); await tick();
    ok('by cable every link is bound', ['l4', 'l5', 'l6'].every(bound));
    select('l4', 'link'); await tick();
    const pick = el('propMedium');
    ok('the picker offers ten kinds', pick.options.length === 10 && [...pick.options].map((o) => o.value).join() === 'utp,fiber,wireless,powerline,vpn,thread,zigbee,zwave,bluetooth,serial');
    ok('a cable shows its port pickers and its label button', !el('linkPortProps').classList.contains('hidden') && !el('printLabelBtn').classList.contains('hidden'));
    const undoAt = _undoStack.length;
    pick.value = 'zigbee'; pick.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    ok('changed to Zigbee: it lets go of its ports', getLink('l4').medium === 'zigbee' && !bound('l4'));
    ok('…and has no port pickers, cable facts or label', el('linkPortProps').classList.contains('hidden') && el('printLabelBtn').classList.contains('hidden') && el('linkCableProps').classList.contains('hidden'));
    ok('…in one undo step', _undoStack.length === undoAt + 1, String(_undoStack.length - undoAt));
    pick.value = 'utp'; pick.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    ok('changed back: bound again, the pickers back', bound('l4') && !el('linkPortProps').classList.contains('hidden'));
    undo(); undo(); await tick();
    ok('two undos: the cable as it was', getLink('l4').medium === 'utp' && bound('l4'));

    // ---- 5. A trace, and What if this fails? ----
    open(site('zigbee')); await tick();
    ok('drawn in its ink', el('ui-link-l4').getAttribute('stroke') === LINK_INK.zigbee.colour && el('ui-link-l3').getAttribute('stroke') === LINK_INK.utp.colour);
    const reach = [...calculateReachability('rt').reachableNodes];
    ok('a trace from the router does not arrive at a sensor', reach.includes('hub') && !reach.includes('s1') && !reach.includes('s2'), reach.join());
    const dark = [...TopoWhatIf.plan(state.nodes, state.links, { type: 'node', id: 'hub' }).dark].sort().join();
    ok('What if the hub fails: the sensors go with it', dark === 's1,s2,s3', dark);

    // ---- 6. Names ----
    const { has, locales } = window.CarinoI18N;
    const names = ['Thread (smart home)', 'Zigbee (smart home)', 'Z-Wave (smart home)', 'Bluetooth', 'Serial cable', 'Joined without a network port. No address is expected.'];
    locales.forEach((loc) => ok(`${loc} carries the names`, names.every((s) => has(loc, s)), names.filter((s) => !has(loc, s)).join(' | ')));
    ok('each kind has a Simple name', [...pick.options].every((o) => !!o.dataset.simple));
    select(null, null);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
