// Omada to Topo (js/importers/omada.js; docs/SCOPE.md step 6, D114, D118),
// on hand-written Open API responses in tests/fixtures/import/omada/
// (devices, clients, LAN and wireless networks) and a client list exported
// as CSV (omada-clients.csv). Field names are from knowledge of the Open API,
// not a live controller. Covered: detection (no fixture claimed by another
// importer), gateway, switch and AP with model, firmware, serial and ports
// (labels, PoE, native VLAN), uplinks as cables, a device with no name
// named by model, subnets with gateway, VLAN, DHCP and DNS, Wi-Fi security
// and hidden, keys never read, wired clients on their switch port with the
// port's VLAN, a wireless client on its AP with band and signal (left out
// until ticked), a client with no MAC listed, Omada ids kept, an error
// answer said, and a merge into a sample matching by MAC.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const load = async (n) => { const text = await (await fetch(`tests/fixtures/import/${n}`)).text(); return { name: n.split('/').pop(), text, bytes: new TextEncoder().encode(text) }; };
  try {
    const I = TopoImporters;
    const node = (doc, name) => doc.nodes.find((n) => n.name === name);
    const iface = (n, name) => (n.interfaces || []).find((i) => i.name === name);
    const files = await Promise.all(['omada/devices.json', 'omada/clients.json', 'omada/networks.json', 'omada-clients.csv'].map(load));
    ok('every file is detected as Omada, by nothing else', files.every((f) => I.sniff(f).importer === 'omada' && I.list().filter((x) => x.detect(f) > 0.5).length === 1),
      files.map((f) => `${f.name}:${JSON.stringify(I.sniff(f))}:${I.list().filter((x) => x.detect(f) > 0.5).map((x) => x.id)}`).join(' '));
    const r = I.parse('omada', files);
    r.parts.forEach((p) => { p.on = true; });
    I.applyParts(r);
    const d = r.doc;
    const gw = node(d, 'ER605 Clinica'), sw = node(d, 'SG2210MP Consultorios'), ap = node(d, 'EAP225 Recepcion');
    ok('types: gateway router, switch, AP', gw.type === 'router' && sw.type === 'switch' && ap.type === 'ap');
    ok('model, firmware, serial, maker; ids are Omada\'s', sw.model === 'SG2210MP' && sw.os === 'Omada 1.0.6' && sw.serial === '2234567000002' && sw.vendor === 'TP-Link'
      && sw.id === 'om-64f0c2a1b2c3d4e5f6a70002');
    ok('MACs written with dashes are read', iface(sw, 'Management').mac === '50:91:E3:00:00:02' && iface(sw, 'Management').ip === '192.168.0.2/24');
    ok('a device with no name is named by its model', d.nodes.some((n) => /^EAP610 /.test(n.name)));
    ok('switch ports: labels, PoE, native VLAN', sw.portAttrs.p1.poe === 'at' && sw.portAttrs.p2.label === 'Rayos X' && sw.portAttrs.p2.vlan === 30 && sw.portAttrs.p10.label === 'Uplink',
      JSON.stringify(sw.portAttrs));
    ok('a gateway\'s ports are interfaces', iface(gw, 'WAN1') && iface(gw, 'LAN2'));
    const lk = (a, z) => d.links.find((l) => (l.source === a.id && l.target === z.id) || (l.source === z.id && l.target === a.id));
    ok('uplinks: switch port 10 to the gateway\'s LAN2; the AP on switch port 3', lk(gw, sw) && lk(gw, sw).sourceIface === iface(gw, 'LAN2').id && lk(gw, sw).targetIface === 'p10'
      && lk(sw, ap) && lk(sw, ap).sourceIface === 'p3', JSON.stringify(d.links.slice(0, 3)));
    const lan = d.networks.find((n) => n.cidr === '192.168.0.0/24'), img = d.networks.find((n) => n.cidr === '192.168.30.0/24');
    ok('subnets: gateway, DHCP range, DNS, VLAN', lan.gateway === '192.168.0.1' && lan.dhcp && lan.dhcpFirst === '192.168.0.100' && lan.dns === '1.1.1.1, 8.8.8.8' && img.vlan === 30 && !img.dhcp
      && !lan.vlan, JSON.stringify(d.networks));
    const cl = d.wifi.find((w) => w.ssid === 'Clinica'), pac = d.wifi.find((w) => w.ssid === 'Pacientes');
    ok('Wi-Fi: WPA2-Personal; open and hidden on the VLAN 30 subnet', cl.security === 'wpa2' && pac.security === 'open' && pac.hidden === true && pac.network === img.id, JSON.stringify(d.wifi));
    ok('keys are never read', !/clave-clinica/.test(JSON.stringify(d)) && r.notes.some((x) => x.code === 'secrets' && x.params.n === 1));
    const pc = node(d, 'PC-Consultorio1'), rx = node(d, 'Equipo RX'), ipad = node(d, 'iPad-Recepcion');
    ok('wired clients on their switch port; the port\'s VLAN from the client', lk(sw, pc).sourceIface === 'p1' && lk(sw, rx).sourceIface === 'p2' && sw.portAttrs.p2.vlan === 30);
    ok('a client named by its MAC takes its host name', !!ipad && ipad.interfaces[0].mac === 'A4:5E:60:00:00:03' && ipad.vendor === 'Apple');
    const wl = lk(ap, ipad);
    ok('a wireless client on its AP: SSID, band, signal', wl && wl.medium === 'wireless' && wl.wifi.ssid === cl.id && wl.wifi.band === '5' && wl.wifi.signal === -62, JSON.stringify(wl));
    ok('CSV clients: one on the AP, one on switch port 4', lk(ap, node(d, 'Laptop Dra Ruiz')) && lk(sw, node(d, 'Impresora Caja')).sourceIface === 'p4');
    ok('a client with no MAC is listed', r.warnings.some((w) => w.code === 'no-mac' && w.file === 'clients.json' && w.row === 4), JSON.stringify(r.warnings));
    const fresh = I.parse('omada', files);
    ok('wireless clients start left out', !node(fresh.doc, 'iPad-Recepcion') && node(fresh.doc, 'PC-Consultorio1') && fresh.parts.find((p) => p.key === 'wireless').on === false);
    ok('an error answer is said', I.parse('omada', [{ name: 'e.json', text: '{"errorCode":-44112,"msg":"The site does not exist."}', bytes: new Uint8Array() }]).warnings.some((w) => w.code === 'api-error'));
    ok('the result is a document the editor reads', isDocShape(d) && canonicalDoc(d).nodes.length === d.nodes.length);

    const mine = canonicalDoc(templatesData.house);
    const target = mine.nodes.find((n) => n.type !== 'cloud' && (n.interfaces || []).length);
    target.interfaces[0].mac = 'D0:67:E5:BB:00:01';
    const plan = planMerge(mine, d, null);
    ok('a client matches the sample\'s device by MAC', plan.items.some((it) => it.kind === 'nodes' && it.mineId === target.id && it.matchedBy === 'mac'));
    ok('no transient id survives the merge', !/"imp-/.test(JSON.stringify(applyMergePlan(mine, plan, {}).doc)));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
