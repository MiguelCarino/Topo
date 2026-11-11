// UniFi to Topo (js/importers/unifi.js; docs/SCOPE.md step 6, D114, D118),
// on hand-written API responses in tests/fixtures/import/unifi/ (stat/device,
// stat/sta, rest/networkconf, rest/wlanconf) and the Network application's
// client list as CSV (unifi-clients.csv). Covered: detection (no fixture
// claimed by another importer), gateways, switches and APs with their port
// grid (labels, PoE, native VLAN), uplinks as cables to the parent's port, a
// mesh AP as a wireless link, an uplink to a device not in the files said,
// subnets with gateway, VLAN and DHCP range (the WAN left out), Wi-Fi with
// security and hidden, passphrases never read, wired clients on their
// switch port (with the port's VLAN), wireless clients on their AP with
// SSID, band and signal, wireless clients left out by default (the tick
// brings them), a client with no MAC listed, UniFi ids kept so a re-import
// changes nothing, and a merge into a sample matching by MAC.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const load = async (n) => { const text = await (await fetch(`tests/fixtures/import/${n}`)).text(); return { name: n.split('/').pop(), text, bytes: new TextEncoder().encode(text) }; };
  try {
    const I = TopoImporters;
    const node = (doc, name) => doc.nodes.find((n) => n.name === name);
    const iface = (n, name) => (n.interfaces || []).find((i) => i.name === name);
    const files = await Promise.all(['unifi/device.json', 'unifi/sta.json', 'unifi/networkconf.json', 'unifi/wlanconf.json', 'unifi-clients.csv'].map(load));
    ok('every file is detected as UniFi, by nothing else', files.every((f) => I.sniff(f).importer === 'unifi' && I.list().filter((x) => x.detect(f) > 0.5).length === 1),
      files.map((f) => `${f.name}:${JSON.stringify(I.sniff(f))}:${I.list().filter((x) => x.detect(f) > 0.5).map((x) => x.id)}`).join(' '));
    const r = I.parse('unifi', files);
    const full = r.full, d = r.doc;
    const udm = node(full, 'UDM Oficina'), sw = node(full, 'USW-24-PoE Rack'), ap = node(full, 'U6 Lite Sala'), mesh = node(full, 'U6 Mesh Patio'), flex = node(full, 'USW Flex Bodega');
    ok('device types: gateway router, switch, APs', udm.type === 'router' && sw.type === 'switch' && ap.type === 'ap' && mesh.type === 'ap' && flex.type === 'switch');
    ok('model, firmware, serial, maker', sw.model === 'USL24P' && sw.os === 'UniFi 7.0.50.15116' && sw.serial === '74ACB9100002' && sw.vendor === 'Ubiquiti');
    ok('ids are UniFi\'s', udm.id === 'uf-6512a0c1e4b0a1b2c3d40001');
    ok('the management address on its own interface', iface(sw, 'Management').ip === '192.168.1.2/24' && iface(sw, 'Management').mac === '74:AC:B9:10:00:02');
    ok('port grid: named ports are labels, PoE, native VLAN', sw.portCount === 25 && sw.portAttrs.p1.label === 'Recepcion PC' && sw.portAttrs.p2.poe === 'at' && sw.portAttrs.p2.vlan === 20
      && !sw.portAttrs.p8 && sw.portAttrs.p3.label === 'AP Sala', JSON.stringify(sw.portAttrs));
    ok('a gateway\'s ports are interfaces; the WAN keeps its address', iface(udm, 'WAN').ip === '203.0.113.10/29' && iface(udm, 'SFP+ LAN'));
    const lk = (a, z) => full.links.find((l) => (l.source === a.id && l.target === z.id) || (l.source === z.id && l.target === a.id));
    const up = lk(udm, sw);
    ok('the switch\'s uplink: its port 25 to the gateway\'s port 11', up && up.targetIface === 'p25' && up.sourceIface === iface(udm, 'SFP+ LAN').id && up.medium === 'fiber', JSON.stringify(up));
    ok('the AP on switch port 3', lk(sw, ap) && lk(sw, ap).sourceIface === 'p3' && lk(sw, ap).targetIface === 'p1');
    ok('a mesh AP is a wireless link', lk(ap, mesh) && lk(ap, mesh).medium === 'wireless');
    ok('an uplink to a device not in the files is said', r.warnings.some((w) => w.code === 'uplink-unknown' && w.params.name === 'USW Flex Bodega'));
    const ofi = full.networks.find((n) => n.cidr === '192.168.1.0/24'), voz = full.networks.find((n) => n.cidr === '10.10.20.0/24');
    ok('subnets: gateway, DHCP and its range, VLAN, name; the WAN is not one', ofi.gateway === '192.168.1.1' && ofi.dhcp && ofi.dhcpFirst === '192.168.1.100' && ofi.dhcpLast === '192.168.1.200'
      && ofi.dns === '192.168.1.1' && voz.vlan === 20 && voz.name === 'Voz' && full.networks.length === 3, JSON.stringify(full.networks));
    const wf = full.wifi.find((w) => w.ssid === 'Oficina-WiFi'), guest = full.wifi.find((w) => w.ssid === 'Invitados'), iot = full.wifi.find((w) => w.ssid === 'Cam-IoT');
    ok('Wi-Fi: WPA2/WPA3, open, hidden on 2.4 GHz, each on its subnet', wf.security === 'wpa2/3' && wf.network === ofi.id && guest.security === 'open' && iot.hidden === true && iot.bands === '2.4',
      JSON.stringify(full.wifi));
    ok('passphrases and the WAN password are never read', !/Clave-Super|iot-key|pppoe-secret/.test(JSON.stringify(full)) && r.notes.some((x) => x.code === 'secrets' && x.params.n === 3), JSON.stringify(r.notes));
    const pc = node(full, 'Recepción PC'), prn = node(full, 'NPI0A1B2C'), tel = node(full, 'GXP2170'), phone = node(full, 'iPhone-de-Ana'), tab = node(full, 'Galaxy-Tab');
    ok('wired clients on their switch port', lk(sw, pc).sourceIface === 'p1' && lk(sw, prn).sourceIface === 'p8' && lk(sw, tel).sourceIface === 'p2' && lk(sw, pc).medium === 'utp');
    ok('a client\'s VLAN on a port that had none', sw.portAttrs.p8 === undefined || !sw.portAttrs.p8.vlan, JSON.stringify(sw.portAttrs.p8));
    ok('client fields: name over host name, maker, address in its subnet\'s prefix', pc.vendor === 'Dell Inc.' && pc.interfaces[0].ip === '192.168.1.120/24' && pc.interfaces[0].mac === 'D0:67:E5:AA:00:01');
    const wl = lk(ap, phone);
    ok('wireless clients on their AP: SSID, band, signal', wl && wl.medium === 'wireless' && wl.wifi.ssid === wf.id && wl.wifi.band === '5' && wl.wifi.signal === -58 && phone.interfaces[0].wireless, JSON.stringify(wl));
    ok('a guest on the mesh AP', lk(mesh, tab) && lk(mesh, tab).wifi.band === '2.4');
    ok('CSV clients: wired by uplink name and port, wireless on its AP', lk(sw, node(full, 'Contabilidad')).sourceIface === 'p6' && lk(ap, node(full, 'Sala TV')).medium === 'wireless');
    ok('clients with no MAC are listed (JSON and CSV)', r.warnings.filter((w) => w.code === 'no-mac').length === 2);
    ok('the parts: wired and wireless clients counted', r.parts.find((p) => p.key === 'wired').ids.length === 4 && r.parts.find((p) => p.key === 'wireless').ids.length === 3,
      JSON.stringify(r.parts.map((p) => [p.key, p.ids.length, p.on])));
    ok('wireless clients start left out, with their links', !node(d, 'iPhone-de-Ana') && !d.links.some((l) => l.medium === 'wireless' && l.wifi && l.wifi.signal) && node(d, 'Recepción PC'));
    r.parts.find((p) => p.key === 'wireless').on = true;
    I.applyParts(r);
    ok('ticked, they come back and are counted', node(r.doc, 'iPhone-de-Ana') && r.counts.devices === full.nodes.length);
    ok('the result is a document the editor reads', isDocShape(r.doc) && canonicalDoc(r.doc).nodes.length === full.nodes.length);

    // ---- Re-import updates ----
    persistLibrary({});
    replaceDocument(I.withoutTransientIds(r.doc), { origin: 'file' });
    const again = I.parse('unifi', files);
    again.parts.forEach((p) => { p.on = true; });
    I.applyParts(again);
    const plan = planMerge(serializeDoc(), again.doc, null);
    ok('the same export merged again adds no device', !plan.items.some((it) => it.kind === 'nodes' && !it.mineId) && plan.counts.conflicts === 0, JSON.stringify(plan.counts));

    // ---- Into a sample: by MAC ----
    const mine = canonicalDoc(templatesData.house);
    const target = mine.nodes.find((n) => n.type !== 'cloud' && (n.interfaces || []).length);
    target.interfaces[0].mac = 'D0:67:E5:AA:00:01';
    const plan2 = planMerge(mine, r.doc, null);
    ok('a client matches the sample\'s device by MAC', plan2.items.some((it) => it.kind === 'nodes' && it.mineId === target.id && it.matchedBy === 'mac'));
    ok('no transient id survives the merge', !/"imp-/.test(JSON.stringify(applyMergePlan(mine, plan2, {}).doc)));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
