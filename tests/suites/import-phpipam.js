// phpIPAM to Topo (js/importers/phpipam.js; docs/SCOPE.md step 6, D114), on
// hand-written exports in tests/fixtures/import/: phpipam-subnets.csv
// (prefix and dotted masks, "40 - Consultorios" VLANs, a bad subnet),
// phpipam-addresses.csv (a gateway, used, reserved, offline and DHCP
// addresses, Device and Port, a bad address) and phpipam-api.json (four API
// answers in one file: subnets with a gateway object, addresses with
// is_gateway and device ids, VLANs, devices). Covered: detection, subnets
// with VLAN and name, addresses as devices in their subnet's prefix, the
// gateway on its subnet, tags as statuses, notes and owner, cables to the
// device's port (named or numbered), a VLAN with no subnet noted, bad rows
// listed, phpIPAM ids (a re-import changes nothing), a merge by MAC.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const load = async (n) => { const text = await (await fetch(`tests/fixtures/import/${n}`)).text(); return { name: n, text, bytes: new TextEncoder().encode(text) }; };
  try {
    const I = TopoImporters;
    const node = (doc, name) => doc.nodes.find((n) => n.name === name);
    const iface = (n, name) => (n.interfaces || []).find((i) => i.name === name);
    const subs = await load('phpipam-subnets.csv'), adds = await load('phpipam-addresses.csv'), api = await load('phpipam-api.json');
    ok('the three files are detected as phpIPAM, by nothing else', [subs, adds, api].every((f) => I.sniff(f).importer === 'phpipam' && I.list().filter((x) => x.detect(f) > 0.5).length === 1),
      [subs, adds, api].map((f) => JSON.stringify(I.sniff(f)) + I.list().filter((x) => x.detect(f) > 0.5).map((x) => x.id)).join(' '));
    const r = I.parse('phpipam', [subs, adds]);
    const d = r.doc;
    const s40 = d.networks.find((n) => n.cidr === '192.168.40.0/24'), s41 = d.networks.find((n) => n.cidr === '192.168.41.0/24'), s10 = d.networks.find((n) => n.cidr === '10.40.0.0/22');
    ok('subnets: prefix and dotted masks, VLAN from "40 - Consultorios", name', s40 && s40.vlan === 40 && s40.name === 'Consultorios' && s41 && s41.vlan === 41 && s10 && !s10.vlan, JSON.stringify(d.networks));
    ok('a bad subnet is listed', r.warnings.some((w) => w.code === 'prefix-bad' && w.row === 5), JSON.stringify(r.warnings));
    const gw = node(d, 'gw-consultorios'), pc = node(d, 'pc-cons1'), imp = node(d, 'imp-cons'), res = node(d, '192.168.40.20'), rx = node(d, 'rx-01'), dh = node(d, '10.40.1.20');
    ok('the gateway is its subnet\'s gateway and a router', s40.gateway === '192.168.40.1' && gw.type === 'router' && gw.interfaces[0].ip === '192.168.40.1/24');
    ok('addresses in their subnet\'s prefix, with MAC', pc.interfaces.find((i) => i.mac === 'D0:67:E5:40:00:10').ip === '192.168.40.10/24' && dh.interfaces[0].ip === '10.40.1.20/22');
    ok('tags: Used active, Reserved planned, Offline retired, DHCP active', pc.status === 'active' && res.status === 'planned' && rx.status === 'retired' && dh.status === 'active');
    ok('description and note are the notes; the owner a column', imp.notes === 'Impresora consultorios\nToner HP 58A' && Object.values(pc.extra || {}).includes('Dra. Ruiz'));
    const sw = node(d, 'sw-norte');
    const lk = (a, z) => d.links.find((l) => (l.source === a.id && l.target === z.id) || (l.source === z.id && l.target === a.id));
    ok('Device and Port: a cable from that switch\'s named port', sw && sw.type === 'switch' && lk(sw, pc) && lk(sw, pc).sourceIface === iface(sw, 'Gi1/0/10').id && lk(sw, rx) && lk(sw, imp));
    ok('a bad address is listed', r.warnings.some((w) => w.code === 'ip-bad' && w.row === 8));
    ok('ids are phpIPAM\'s only when it gave one (CSV has none)', d.nodes.every((n) => /^imp-/.test(n.id)));

    const a = I.parse('phpipam', [api]);
    const ad = a.doc;
    const o = ad.networks.find((n) => n.cidr === '172.16.5.0/24'), c6 = ad.networks.find((n) => n.cidr === '172.16.6.0/25');
    ok('API: subnets with VLAN numbers by id, the gateway object, names from the VLAN', o.vlan === 50 && o.gateway === '172.16.5.1' && o.name === 'Oficinas' && c6.vlan === 60 && c6.name === 'Camaras'
      && /^ip-[0-9a-z]{6}-s7$/.test(o.id), JSON.stringify(ad.networks));
    ok('a VLAN with no subnet is noted', a.notes.some((x) => x.code === 'vlan-no-subnet' && x.params.vid === 99));
    const nas = node(ad, 'nas-01'), cam = node(ad, 'cam-pasillo'), swo = node(ad, 'sw-oficinas'), rtr = node(ad, 'rtr-oficinas');
    ok('is_gateway makes a router', rtr.type === 'router');
    ok('devices by id: numbered ports on the switch\'s grid', swo && swo.type === 'switch' && /^ip-[0-9a-z]{6}-d5$/.test(swo.id) && d.links && ad.links.some((l) => l.source === swo.id && l.sourceIface === 'p7' && l.target === nas.id)
      && ad.links.some((l) => l.source === swo.id && l.sourceIface === 'p8' && l.target === cam.id) && iface(swo, 'Management').ip === '172.16.5.2/24', JSON.stringify(ad.links));
    ok('address ids carry the section\'s tag', /^ip-[0-9a-z]{6}-a42$/.test(nas.id) && cam.status === 'planned');
    ok('the result is a document the editor reads', isDocShape(ad) && canonicalDoc(ad).nodes.length === ad.nodes.length && isDocShape(d));

    persistLibrary({});
    replaceDocument(I.withoutTransientIds(ad), { origin: 'file' });
    const plan = planMerge(serializeDoc(), I.parse('phpipam', [api]).doc, null);
    ok('the same API export merged again adds no device', !plan.items.some((it) => it.kind === 'nodes' && !it.mineId), JSON.stringify(plan.counts));

    const mine = canonicalDoc(templatesData.house);
    const target = mine.nodes.find((n) => n.type !== 'cloud' && (n.interfaces || []).length);
    target.interfaces[0].mac = '00:11:32:05:00:30';
    const plan2 = planMerge(mine, ad, null);
    ok('the NAS matches the sample\'s device by MAC', plan2.items.some((it) => it.kind === 'nodes' && it.mineId === target.id && it.matchedBy === 'mac'));
    ok('no transient id survives the merge', !/"imp-/.test(JSON.stringify(applyMergePlan(mine, plan2, {}).doc)));
    const fcsv = { name: 'phpipam-addresses.csv', text: await (await fetch('tests/fixtures/import/phpipam-addresses.csv')).text() };
    fcsv.bytes = new TextEncoder().encode(fcsv.text);
    const pcr = I.parse('phpipam', [fcsv]);
    const own = I.withoutTransientIds(pcr.doc);
    ok('opened as its own network, a host called imp-cons keeps its name; only ids lose the prefix',
      pcr.doc.nodes.some((n) => n.name === 'imp-cons') && own.nodes.some((n) => n.name === 'imp-cons') && !JSON.stringify(own).match(/"imp-[a-z]+\d+"/),
      own.nodes.map((n) => n.name + ':' + n.id).join(','));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
