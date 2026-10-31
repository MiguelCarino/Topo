// The field schema (NODE_FIELDS / IFACE_FIELDS / LINK_FIELDS in js/model.js)
// and the honest defaults that came with it.
//
// Two promises are checked here, and they pull in opposite directions:
//   1. Nothing that serialized before the schema changes by a byte. The old
//      hand-written serializer and normalizer are copied below VERBATIM (as they
//      stood after the MAC hot fix) and every shipped template, block and the
//      boot document is run through both pipelines.
//   2. Every schema field survives the real path — serializeDoc -> JSON ->
//      applyDoc — which is the path a save, an undo and a reload take. The old
//      MAC test round-tripped state.nodes instead, and that is why it missed the
//      serializer dropping every MAC.
window.addEventListener('load', () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);
  const gone = (id) => getComputedStyle(document.getElementById(id)).display === 'none';

  // ---- The pre-schema code, verbatim. Do not "fix" it: it is the reference. ----
  // initialDataDefaults gained a dicom entry in the same change, so the legacy
  // normalizer is handed the defaults as they were, without it.
  const LEGACY_DEFAULTS = Object.fromEntries(Object.entries(initialDataDefaults).filter(([k]) => k !== 'dicom'));
  function legacySerializeNode(n) {
    return { id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, gw: n.gw || '', dns: n.dns || '', os: n.os || '', ports: n.ports || '', notes: n.notes || '', nat: !!n.nat, netcfg: n.netcfg || undefined, siteRef: n.siteRef ? { id: n.siteRef.id, name: n.siteRef.name } : undefined, portCount: Number.isFinite(n.portCount) ? n.portCount : undefined, interfaces: (n.interfaces || []).map((i) => ({ id: i.id, name: i.name, ip: i.ip, mac: (typeof i.mac === 'string' && i.mac.trim()) ? i.mac : undefined, drawZone: i.drawZone, wireless: i.wireless, bond: i.bond })) };
  }
  function legacySerializeLink(l) {
    return { id: l.id, source: l.source, target: l.target, attachment: l.attachment, medium: l.medium, sourceIface: l.sourceIface || undefined, targetIface: l.targetIface || undefined };
  }
  function legacyNormalizeNode(node) {
    const initialDataDefaults = LEGACY_DEFAULTS;
    const def = initialDataDefaults[node.type] || { interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] };
    let normalizedInterfaces = Array.isArray(node.interfaces) ? node.interfaces : cloneData(def.interfaces);
    if (node.ips && Array.isArray(node.ips) && node.ips.length > 0) {
        normalizedInterfaces = node.ips.map((ip, idx) => ({ id: `i_${Date.now()}_${idx}`, name: idx === 0 ? 'eth0' : `eth${idx}`, ip }));
    } else if (node.ips && Array.isArray(node.ips) && node.ips.length === 0) {
        normalizedInterfaces = [];
    }
    if (node.type === 'ap' && !normalizedInterfaces.some(ifaceIsWireless)) {
        normalizedInterfaces = [{ id: 'w1', name: 'wlan0', ip: '' }, ...normalizedInterfaces];
    }
    const normalized = { id: node.id || `n_${Date.now()}_${Math.random().toString(16).slice(2)}`, type: node.type || 'custom', name: node.name || 'Unnamed Node', x: Number.isFinite(node.x) ? node.x : 200, y: Number.isFinite(node.y) ? node.y : 200, gw: node.gw || '', dns: node.dns || '', os: node.os || '', ports: node.ports || '', notes: node.notes || '', nat: !!(node.nat || (initialDataDefaults[node.type] && initialDataDefaults[node.type].nat && node.nat === undefined)), interfaces: normalizedInterfaces };
    if (Number.isFinite(node.portCount)) normalized.portCount = node.portCount;
    if (node.netcfg) normalized.netcfg = true;
    const ref = node.type === 'cloud' ? normalizeSiteRef(node.siteRef) : null;
    if (ref) normalized.siteRef = ref;
    return normalized;
  }
  function legacyNormalizeLink(link) {
    return { id: link.id || nextId('l'), source: link.source, target: link.target, attachment: link.attachment, medium: link.medium, sourceIface: link.sourceIface || null, targetIface: link.targetIface || null };
  }

  // Date.now and Math.random feed the ids minted for legacy `ips` interfaces
  // and id-less nodes; frozen, so both pipelines mint the same ones.
  const frozen = (fn) => {
    const now = Date.now, rnd = Math.random;
    Date.now = () => 1700000000000; Math.random = () => 0.5;
    try { return fn(); } finally { Date.now = now; Math.random = rnd; }
  };
  const pipe = (doc, norm, ser, normL, serL) => JSON.stringify({
    nodes: cloneData(doc.nodes || []).map(norm).map(ser),
    links: cloneData(doc.links || []).map(normL).map(serL)
  });
  // The one deliberate difference: netcfg (the "Network config file" checkbox)
  // is no longer written, since the Netplan hand-off became an action on the
  // host types (R8). The reference above stays verbatim; its output is only
  // read without that key, so every other byte is still held to it.
  // The second: an interface's drawZone is the network's since v3 (R7), so
  // it is read out of the interface by the v2 -> v3 migration and no longer
  // written on it (tests/suites/networks.js holds the zones to that).
  const legacyMinusNetcfg = (n) => {
    const o = legacySerializeNode(n);
    delete o.netcfg;
    (o.interfaces || []).forEach((i) => { delete i.drawZone; });
    return o;
  };
  // The third: a VM's or a container's `host` (what it runs on, Round 3 of
  // the groups work) and a device's group and rack place came after the
  // reference, which drops them. The Homelab block ships its VMs on its
  // hypervisor and four templates ship groups and racks, so they are read
  // here without those keys; tests/suites/hosts.js, groups.js and the rack
  // suites hold the keys themselves.
  const LATER_KEYS = ['host', 'group', 'rackU', 'rackHeight', 'rackFace', 'rackDepth'];
  // The fourth: Wi-Fi (v12). Smart Home, Retail, Hotel, the Showcase and
  // Common Errors ship radios on their wireless interfaces and associations
  // on their wireless links, which the reference drops (a radio) or never
  // knew (link.wifi); both sides are read without them here, and
  // tests/suites/wifimodel.js holds the keys themselves.
  const minusRadio = (o) => { (o.interfaces || []).forEach((i) => { delete i.radio; }); return o; };
  const currentMinusHost = (n) => { const o = serializeNode(n); LATER_KEYS.forEach((k) => delete o[k]); return minusRadio(o); };
  const legacyMinusLater = (n) => minusRadio(legacyMinusNetcfg(n));
  const currentLinkMinusWifi = (l) => { const o = serializeLink(l); delete o.wifi; return o; };
  const both = (doc) => frozen(() => [
    pipe(doc, legacyNormalizeNode, legacyMinusLater, legacyNormalizeLink, legacySerializeLink),
    pipe(doc, normalizeLoadedNode, currentMinusHost, normalizeLoadedLink, currentLinkMinusWifi)
  ]);

  // ---- 1: byte identity over everything Topo ships ----
  const shipped = Object.entries(templatesData).map(([k, v]) => [`template ${k}`, v]);
  Object.entries(SNIPPETS).forEach(([k, v]) => shipped.push([`block ${k}`,
    { nodes: v.nodes.map((n) => ({ ...n, id: n.tid, x: n.dx, y: n.dy })), links: [] }]));
  const drift = shipped.filter(([, doc]) => { const [a, b] = both(doc); return a !== b; }).map(([name]) => name);
  ok(`every shipped template and block serializes to the same bytes (${shipped.length})`, shipped.length > 15 && !drift.length, drift.join(', '));

  // A document as saved by the build before the schema: normalized once and
  // serialized once already, which is what a library card or a link holds.
  const saved = JSON.parse(both(templatesData.hospital || Object.values(templatesData)[0])[0]);
  const [again0, again1] = both(saved);
  ok('a previously saved document re-serializes to the same bytes', again0 === again1 && again1 === JSON.stringify(saved));

  // Every field the old serializer wrote, set to something, on one node.
  const loaded = {
    nodes: [
      { id: 'c', type: 'cloud', name: 'Torre A', x: 1, y: 2, siteRef: { id: 'card1', name: 'Torre A', junk: 1 }, interfaces: [{ id: 'w', name: 'wan0', ip: '8.8.8.8/32' }] },
      { id: 'r', type: 'router', name: 'R', x: 3, y: 4, gw: '0.0.0.0', dns: '1.1.1.1', os: 'RouterOS', ports: '22', notes: 'rack 2', nat: false, netcfg: true,
        interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24', mac: '3C:07:54:11:22:33', drawZone: false, wireless: false },
                     { id: 'e1', name: 'eth1', ip: '' }, { id: 'e2', name: 'eth2', ip: '' },
                     { id: 'b0', name: 'bond0', ip: '10.0.1.1/24', bond: { mode: '802.3ad', members: ['e1', 'e2'] } }] },
      { id: 's', type: 'switch', name: 'S', x: 5, y: 6, portCount: 24, interfaces: [] },
      { id: 'fw', type: 'firewall', name: 'FW', x: 7, y: 8, interfaces: [{ id: 'i1', name: 'igb0', ip: '10.0.0.2/24', mac: '   ' }] }
    ],
    links: [{ id: 'l1', source: 'r', target: 's', attachment: null, medium: 'fiber', sourceIface: 'e0', targetIface: 'p1' },
            { id: 'l2', source: 's', target: 'fw', medium: 'utp' }]
  };
  const [la, lb] = both(loaded);
  ok('a document using every pre-schema field serializes to the same bytes', la === lb, la === lb ? '' : `${la.slice(0, 120)} vs ${lb.slice(0, 120)}`);

  // ---- 2: the real round trip, field by field ----
  // applyDoc is handed undo snapshots, serializeDoc output, and the suites
  // hold that a snapshot reloads as itself (TOPO_CHECKS). These documents are
  // raw on purpose, so they are loaded with that check off.
  const loadRaw = (doc) => { const c = window.TOPO_CHECKS; window.TOPO_CHECKS = false; try { applyDoc(JSON.stringify(doc)); } finally { window.TOPO_CHECKS = c; } };
  frozen(() => loadRaw(loaded));
  const first = JSON.stringify(serializeDoc());
  applyDoc(first);
  ok('serializeDoc -> applyDoc is a fixed point', JSON.stringify(serializeDoc()) === first);
  const r = getNode('r'), c = getNode('c'), sw = getNode('s');
  const lost = NODE_FIELDS.filter((f) => f.key in loaded.nodes[1] && f.key !== 'interfaces' && JSON.stringify(r[f.key]) !== JSON.stringify(loaded.nodes[1][f.key])).map((f) => f.key);
  ok('every node field survives a save and a load', !lost.length, lost.join(', '));
  ok('siteRef survives, rebuilt without the stray key', JSON.stringify(c.siteRef) === '{"id":"card1","name":"Torre A"}', JSON.stringify(c.siteRef));
  ok('portCount survives', sw.portCount === 24);
  const e0 = r.interfaces.find((i) => i.id === 'e0');
  const ifaceLost = IFACE_FIELDS.filter((f) => f.key in loaded.nodes[1].interfaces[0] && e0[f.key] !== loaded.nodes[1].interfaces[0][f.key]).map((f) => f.key);
  ok('every interface field survives (mac, wireless…)', !ifaceLost.length, ifaceLost.join(', '));
  ok('a bond survives with its mode and members', JSON.stringify(r.interfaces.find((i) => i.id === 'b0').bond) === '{"mode":"802.3ad","members":["e1","e2"]}');
  const l1 = state.links.find((l) => l.id === 'l1');
  const linkLost = LINK_FIELDS.filter((f) => f.key in loaded.links[0] && l1[f.key] !== loaded.links[0][f.key]).map((f) => f.key);
  ok('every link field survives', !linkLost.length, linkLost.join(', '));
  ok('a blank MAC is not written', !('mac' in JSON.parse(JSON.stringify(serializeDoc())).nodes.find((n) => n.id === 'fw').interfaces[0]));
  // netcfg: still read (the document above carries it and opened), no longer written.
  ok('an old netcfg flag opens but is not written back', loaded.nodes[1].netcfg === true
     && !('netcfg' in JSON.parse(first).nodes.find((n) => n.id === 'r')) && !NODE_FIELDS.some((f) => f.key === 'netcfg'));

  // Undo takes the same path, so a MAC typed and then undone-past comes back.
  initHistory();
  e0.mac = '52:54:00:AA:BB:CC'; save();
  getNode('r').name = 'R2'; save();
  undo();
  ok('undo keeps a MAC typed before the undone step', getNode('r').interfaces.find((i) => i.id === 'e0').mac === '52:54:00:AA:BB:CC');

  // ---- 3: the allowlist ----
  const stray = { nodes: [{ id: 'x', type: 'server', name: 'X', x: 0, y: 0, secret: 'pw', macOpen: true,
      interfaces: [{ id: 'i', name: 'eth0', ip: '10.1.1.1/24', secret: 'pw', implicit: true, bond: { mode: 'balance-rr', members: ['i'], secret: 'pw' } }] }],
    links: [] };
  loadRaw(stray);
  const strayOut = JSON.stringify(serializeDoc());
  ok('a key no schema table names never reaches the document', strayOut.indexOf('secret') === -1 && strayOut.indexOf('macOpen') === -1 && strayOut.indexOf('implicit') === -1, strayOut.slice(0, 160));

  // ---- 4: coercion. Each of these used to crash a reader. ----
  const messy = { nodes: [{ id: 'm', type: 'pc', name: 42, x: 'a', y: null, gw: 192, dns: { a: 1 }, os: null, ports: 80, notes: ['x'],
      interfaces: [{ id: 7, name: 3, ip: 10 }, { name: 'eth1' }, { id: 'q', ip: null, mac: 12, drawZone: 'yes', wireless: 1 }, null, 'junk'] }],
    links: [{ id: 'k', source: 'm', target: 'm', sourceIface: 7 }] };
  let threw = '';
  try { loadRaw(messy); } catch (e) { threw = e.message; }
  ok('a document with wrongly typed fields loads', !threw, threw);
  const m = getNode('m');
  ok('node text fields become strings', ['name', 'gw', 'dns', 'os', 'ports', 'notes'].every((k) => typeof m[k] === 'string'),
     ['name', 'gw', 'dns', 'os', 'ports', 'notes'].map((k) => `${k}:${typeof m[k]}`).join(' '));
  ok('a number keeps its digits; an object is not turned into "[object Object]"', m.gw === '192' && m.dns === '' && m.name === '42');
  ok('coordinates fall back to a position', m.x === 200 && m.y === 200);
  ok('only real interface records are kept', m.interfaces.length === 3, String(m.interfaces.length));
  ok('every interface id, name and ip is a string', m.interfaces.every((i) => typeof i.id === 'string' && i.id && typeof i.name === 'string' && typeof i.ip === 'string'),
     JSON.stringify(m.interfaces));
  ok('a numeric id keeps matching the cable that names it', m.interfaces[0].id === '7' && state.links[0] && state.links[0].sourceIface === '7');
  ok('a missing interface id is minted, not left blank', !!m.interfaces[1].id && m.interfaces[1].id !== m.interfaces[0].id);
  const q = m.interfaces[2];
  ok('a non-string MAC and non-boolean tri-states are dropped, not guessed', !('mac' in q) && !('drawZone' in q) && !('wireless' in q), JSON.stringify(q));
  // The readers that used to throw on these: the sidebar's interface list, the
  // gateway jump and the canvas filter.
  try {
    select('m', 'node');
    const f = document.getElementById('queryInput');
    if (f) { f.value = '10'; f.dispatchEvent(new Event('input', { bubbles: true })); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); }
    renderCanvasOnly(); reportModel();
    threw = '';
  } catch (e) { threw = e.message; }
  ok('the sidebar, filter, canvas and report all read it without throwing', !threw, threw);
  select(null, null);

  // ---- 5: the tables themselves ----
  const tables = { NODE_FIELDS, IFACE_FIELDS, LINK_FIELDS };
  Object.entries(tables).forEach(([name, rows]) => {
    ok(`${name}: every row has a key, a known kind and a label`, rows.every((f) => f.key && FIELD_KINDS[f.kind] && f.label),
       rows.filter((f) => !(f.key && FIELD_KINDS[f.kind] && f.label)).map((f) => f.key).join(','));
    const keys = rows.map((f) => f.key), csv = rows.map((f) => f.csv).filter(Boolean);
    ok(`${name}: keys and CSV headers are unique`, new Set(keys).size === keys.length && new Set(csv).size === csv.length);
  });
  ok('the serialized key order is the table order', JSON.stringify(Object.keys(serializeNode(normalizeLoadedNode(loaded.nodes[1]))))
     === JSON.stringify(NODE_FIELDS.map((f) => f.key)));
  ok('bulk-editable fields are flagged (gateway, DNS, OS, notes, medium)', ['gw', 'dns', 'os', 'notes'].every((k) => NODE_FIELDS.find((f) => f.key === k).bulk)
     && LINK_FIELDS.find((f) => f.key === 'medium').bulk && !NODE_FIELDS.find((f) => f.key === 'id').bulk);
  ok('validators: a gateway is an address, not a shorthand', fieldOk.ip('10.0.0.1') && fieldOk.ip('fe80::1') && fieldOk.ip('') && !fieldOk.ip('10') && !fieldOk.ip('10.0.0.300'));
  ok('validators: DNS lists, ports, CIDRs and MACs', fieldOk.ipList('1.1.1.1, 8.8.8.8') && !fieldOk.ipList('1.1.1.1, nope')
     && fieldOk.ports('80, 443, dicom, 1000-2000') && !fieldOk.ports('80, http2x') && fieldOk.cidr('10.0.0.5/24') && !fieldOk.cidr('10.0.0.5')
     && fieldOk.mac('3c07.5411.2233') && !fieldOk.mac('3C:07'));

  // ---- 6: the report reads its columns from the schema ----
  loadRaw(loaded);
  const dev = reportDevices().find((d) => d.name === 'R');
  ok('report rows carry the schema-marked fields', dev.gw === '0.0.0.0' && dev.dns === '1.1.1.1' && dev.os === 'RouterOS' && dev.allowedPorts === '22' && dev.notes === 'rack 2' && dev.nat === false);
  ok('the inventory columns are Gateway, DNS, Model / firmware, in that order', reportColumns().map((f) => f.report.column).join('|') === 'Gateway|DNS|Model / firmware');
  const table = devicesSection(reportDevices());
  // One line per interface (p2-report): its name, address and MAC, then the schema's columns.
  ok('and the printed table has them as headers', /<th>Interface<\/th><th>Address<\/th><th>MAC<\/th><th>Gateway<\/th><th>DNS<\/th><th>Model \/ firmware<\/th><\/tr>/.test(table));
  ok('with gateway and DNS in monospace and an em dash when empty', table.indexOf('<td class="mono">0.0.0.0</td>') > -1 && table.indexOf('<td><span class="muted">—</span></td>') > -1);

  // ---- 7: honest defaults in the full editor ----
  state.nodes = []; state.links = []; state.annotations = []; state.networks = [];
  const pc = spawnNode('pc');
  ok('a PC on an empty canvas has no invented gateway, DNS or OS', pc.gw === '' && pc.dns === '' && pc.os === '', `${pc.gw}|${pc.dns}|${pc.os}`);
  select(pc.id, 'node');
  ok('the type defaults become grey hints instead', document.getElementById('propOs').placeholder === 'e.g. Windows 11'
     && /^e\.g\. /.test(document.getElementById('propGw').placeholder) && document.getElementById('propDns').placeholder === 'e.g. 8.8.8.8',
     `${document.getElementById('propGw').placeholder} | ${document.getElementById('propOs').placeholder}`);
  ok('and the document holds none of them', JSON.stringify(serializeDoc()).indexOf('Windows 11') === -1);
  const rt = spawnNode('router');
  ok('a router no longer gets the 0.0.0.0 placeholder gateway', rt.gw === '' && rt.dns === '');

  // Cabled into a subnet the drawing describes: gateway and DNS from context.
  // Not copied onto the device (R7): the subnet is declared as a network
  // with what the drawing says, and the device inherits from it.
  state.nodes = []; state.links = []; state.networks = [];
  state.nodes.push(normalizeLoadedNode({ id: 'gw1', type: 'router', name: 'GW', x: 0, y: 0, dns: '9.9.9.9', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.0.1/24' }] }));
  state.nodes.push(normalizeLoadedNode({ id: 'sw1', type: 'switch', name: 'SW', x: 0, y: 100, interfaces: [] }));
  state.nodes.push(normalizeLoadedNode({ id: 'h1', type: 'pc', name: 'H1', x: 0, y: 200, gw: '10.20.0.1', dns: '10.20.0.53', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.0.10/24' }] }));
  state.links.push(normalizeLoadedLink({ id: 'a', source: 'gw1', target: 'sw1' }), normalizeLoadedLink({ id: 'b', source: 'sw1', target: 'h1' }));
  autoBindLinks();
  const cabled = spawnNode('pc', { connectTo: 'sw1' });
  ok('a device cabled into a described subnet takes its address, gateway and DNS from it',
     cabled.interfaces[0].ip === '10.20.0.2/24' && effectiveGw(cabled) === '10.20.0.1' && effectiveDns(cabled) === '10.20.0.53',
     `${cabled.interfaces[0].ip} ${effectiveGw(cabled)} ${effectiveDns(cabled)}`);
  ok('by inheriting them, not by a copy', cabled.gw === '' && cabled.dns === '' && getNode('h1').gw === '' && getNode('h1').dns === ''
     && state.networks.length === 1 && state.networks[0].cidr === '10.20.0.0/24' && state.networks[0].gateway === '10.20.0.1',
     JSON.stringify(state.networks));
  ok('a router\'s own upstream DNS is not handed to its clients', dnsForSubnet('10.20.0.0/24') === '10.20.0.53');

  // A subnet with no router and nobody naming a gateway: the .1 is a guess,
  // so the full editor leaves the field empty and offers the guess as a hint.
  state.nodes = []; state.links = []; state.networks = [];
  state.nodes.push(normalizeLoadedNode({ id: 'sw2', type: 'switch', name: 'SW', x: 0, y: 0, interfaces: [] }));
  state.nodes.push(normalizeLoadedNode({ id: 'h2', type: 'server', name: 'H2', x: 0, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.30.0.10/24' }] }));
  state.links.push(normalizeLoadedLink({ id: 'c', source: 'sw2', target: 'h2' }));
  autoBindLinks();
  const unsure = spawnNode('pc', { connectTo: 'sw2' });
  ok('with no gateway on the drawing, none is invented', unsure.interfaces[0].ip.startsWith('10.30.0.') && unsure.gw === '', `${unsure.interfaces[0].ip} gw=${unsure.gw}`);
  select(unsure.id, 'node');
  ok('the subnet\'s likely gateway is the hint', document.getElementById('propGw').placeholder === 'e.g. 10.30.0.1', document.getElementById('propGw').placeholder);

  // ---- 8: the reduced profiles keep their seeds ----
  state.settings.advanced = false; applyProfile();
  state.nodes = []; state.links = []; state.networks = [];
  const seededPc = spawnNode('pc');
  ok('a reduced profile still seeds a new device (its demo networks rely on it)', seededPc.gw === '192.168.1.1' && seededPc.os === 'Windows 11');
  const modality = spawnNode('dicom');
  ok('a modality has its own defaults now: both DICOM ports, on the defaults\' subnet',
     modality.ports === '104, 11112' && modality.interfaces[0].ip === '192.168.1.70/24' && modality.gw === '192.168.1.1', `${modality.ports} ${modality.interfaces[0].ip}`);
  ok('the Notes field is hidden in the reduced view', gone('notesRow'));
  state.settings.advanced = true; applyProfile();

  // ---- 9: Notes is an edited field again ----
  state.nodes = []; state.links = [];
  const noted = spawnNode('server');
  select(noted.id, 'node');
  ok('the full editor shows a Notes field', !gone('notesRow') && !!document.getElementById('propNotes'));
  const notes = document.getElementById('propNotes');
  notes.value = 'Rack 3, U12 — ask the lab lead before rebooting';
  notes.dispatchEvent(new Event('input', { bubbles: true }));
  ok('typing a note writes it to the device', getNode(noted.id).notes === 'Rack 3, U12 — ask the lab lead before rebooting');
  applyDoc(liveDocJson());
  ok('and it survives the live document', getNode(noted.id).notes === 'Rack 3, U12 — ask the lab lead before rebooting');
  select(noted.id, 'node');
  ok('selecting the device shows it again', document.getElementById('propNotes').value === 'Rack 3, U12 — ask the lab lead before rebooting');
  ok('the report prints it', reportModel().devices[0].notes === 'Rack 3, U12 — ask the lab lead before rebooting');
  select(null, null);
  ok('clearing the selection empties the field', document.getElementById('propNotes').value === '');

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
