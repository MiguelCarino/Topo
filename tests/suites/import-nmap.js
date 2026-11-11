// nmap XML to Topo (js/importers/nmap.js; docs/SCOPE.md step 6, D114), on
// hand-written scans in tests/fixtures/import/: nmap-basic.xml (a /24 with
// -sV: a gateway, a printer, a Windows PC with an OS match, a camera by its
// RTSP port, the scanning laptop with no MAC, a host that is down, a host
// with no address) and nmap-os.xml (-O on named hosts: a sure Linux match,
// a 70% guess, the PC again by its MAC, an IPv6 host; no subnet given).
// Covered: detection, addresses with the scan's prefix (else /32 and a
// note), MAC and vendor (from the file, else the OUI table), names (PTR
// loses its domain), open ports as a notes line and nothing in Allowed
// Ports, the OS at 85% or more (else a notes line), types from services
// and OS, down hosts and hosts with no address said, two scans combined by
// MAC, and a merge into a sample matching by MAC with no transient id left.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const load = async (n) => { const text = await (await fetch(`tests/fixtures/import/${n}`)).text(); return { name: n, text, bytes: new TextEncoder().encode(text) }; };
  try {
    const I = TopoImporters;
    const node = (doc, name) => doc.nodes.find((n) => n.name === name);
    const basic = await load('nmap-basic.xml'), os = await load('nmap-os.xml');
    ok('both scans are detected as nmap, by nothing else', [basic, os].every((f) => I.sniff(f).importer === 'nmap' && I.list().filter((x) => x.detect(f) > 0.5).length === 1),
      JSON.stringify([basic, os].map((f) => I.sniff(f))));
    const r = I.parse('nmap', [basic]);
    const d = r.doc;
    ok('the hosts that are up and have an address are devices', d.nodes.length === 5, d.nodes.map((n) => n.name).join());
    ok('a host that is down is said', r.notes.some((x) => x.code === 'hosts-down' && x.params.n === 1));
    ok('a host with no address is listed', r.warnings.some((w) => w.code === 'host-no-address' && w.params.n === 7), JSON.stringify(r.warnings));
    const gw = node(d, 'gw'), pr = node(d, 'impresora-recepcion'), pc = node(d, 'CONTA-PC03'), cam = node(d, '192.168.50.40'), me = node(d, 'scanner-laptop');
    ok('PTR names lose their domain; a user name wins over PTR; no name is the address', gw && pr && pc && cam && me);
    ok('addresses take the scan\'s /24', gw.interfaces[0].ip === '192.168.50.1/24' && cam.interfaces[0].ip === '192.168.50.40/24' && me.interfaces[0].ip === '192.168.50.10/24');
    ok('MAC and vendor from the file', gw.interfaces[0].mac === 'D0:67:E5:10:20:01' && gw.vendor === 'Dell' && pr.vendor === 'Hewlett Packard');
    ok('a vendor nmap did not give comes from the OUI table', cam.vendor === 'Intel Corporate', cam.vendor);
    ok('types: printer by 9100/631, camera by RTSP, Windows PC', pr.type === 'printer' && cam.type === 'camera' && pc.type === 'pc');
    ok('the OS at 92% is the firmware/OS', pc.os === 'Microsoft Windows 11 21H2');
    ok('open ports are a notes line (filtered ones not), and Allowed Ports stays empty', /^Open: 22\/tcp ssh \(OpenSSH 9\.6p1\), 53\/tcp domain \(dnsmasq 2\.90\), 80\/tcp http \(nginx\)/.test(gw.notes)
      && !/8080/.test(gw.notes) && d.nodes.every((n) => !n.ports), gw.notes);
    ok('when the scan was is in the notes', /Seen by nmap: 2026-11-10/.test(gw.notes));
    ok('no /32 note when the scan named the subnet', !r.notes.some((x) => x.code === 'no-prefix'));
    ok('no cables, no ids of the source: every id is transient', d.links.length === 0 && d.nodes.every((n) => /^imp-/.test(n.id)));
    ok('the result is a document the editor reads', isDocShape(d) && canonicalDoc(d).nodes.length === 5);

    const r2 = I.parse('nmap', [os]);
    const files = node(r2.doc, 'files01'), mt = node(r2.doc, '10.20.0.6'), v6 = node(r2.doc, 'v6-sensor');
    ok('Linux at 96% with SSH is a server, OS kept', files.type === 'server' && files.os === 'Linux 5.0 - 5.14');
    ok('a 70% guess is only a notes line', !mt.os && /OS guess: MikroTik RouterOS 7\.X \(70%\)/.test(mt.notes) && mt.type === 'router', mt.notes);
    ok('no subnet named: /32 and /128, and a note', files.interfaces[0].ip === '10.20.0.5/32' && v6.interfaces[0].ip === '2001:db8:20::9/128'
      && r2.notes.some((x) => x.code === 'no-prefix' && x.params.n === 4), JSON.stringify(r2.notes));
    const both = I.parse('nmap', [basic, os]);
    const pcs = both.doc.nodes.filter((n) => (n.interfaces || []).some((i) => i.mac === '3C:A9:F4:00:33:01'));
    ok('two scans: the PC seen in both is one device, its notes from both', pcs.length === 1 && /3389/.test(pcs[0].notes) && /5900/.test(pcs[0].notes) && pcs[0].interfaces[0].ip === '192.168.50.33/24',
      JSON.stringify(pcs));
    ok('two scans: 8 devices', both.doc.nodes.length === 8, both.doc.nodes.map((n) => n.name).join());
    ok('a file that is not nmap XML is said', I.parse('nmap', [{ name: 'x.xml', text: '<foo/>', bytes: new Uint8Array() }]).warnings.some((w) => w.code === 'bad-xml'));

    // ---- Into a sample: by MAC ----
    const mine = canonicalDoc(templatesData.house);
    const target = mine.nodes.find((n) => n.type !== 'cloud' && (n.interfaces || []).length);
    target.interfaces[0].mac = 'D0:67:E5:10:20:01';
    const plan = planMerge(mine, r.doc, null);
    ok('the gateway matches the sample\'s device by MAC', plan.items.some((it) => it.kind === 'nodes' && it.mineId === target.id && it.matchedBy === 'mac'), target.id);
    const res = applyMergePlan(mine, plan, {});
    ok('no transient id survives the merge', !/"imp-/.test(JSON.stringify(res.doc)));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
