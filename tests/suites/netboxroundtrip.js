// Topo -> NetBox -> Topo (js/netboxexport.js, js/importers/netbox.js;
// docs/SCOPE.md step 6, D117). For every sample network (and its simple
// view) and a rich fixture with every field filled
// (tests/fixtures/import/netbox-rich.json), for NetBox 4.2-4.4 and 4.1:
//   - the export is numbered CSV files in import order with a README;
//   - importing them gives the same network: every record, compared whole
//     (ids included) after NetBox's own normalisations (MACs through
//     normMac, addresses and subnets as parseValidCIDR prints them);
//   - merging the import into the original (two-way) changes nothing;
//   - the guard: every key of every *_FIELDS table that the rich fixture
//     holds comes back, and the rich fixture holds every key but the listed
//     few, so a new model field fails here until the export carries it;
//   - names NetBox needs unique are made unique, and the originals come back;
//   - a second cable on one port, an unbound end, a VPN link, a link to a VM
//     and a 2U device in a top-numbered rack;
//   - edits made in NetBox to its own columns (a name, a serial) are read back;
//   - the zip: stored entries whose CRC-32 matches, read back by unzip;
//   - the cells are guarded against formula injection (csvGuard).
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  try {
    const NB = window.TopoNetbox, I = window.TopoImporters;
    ok('the exporter and the importer are loaded', !!(NB && NB.buildNetboxSet && I && I.get('netbox')));
    const NOT_CARRIED = ['annotations', 'report', 'searches', 'tableView', 'accepted', 'pinned', 'incidents', 'log', 'expectedLife', 'id', 'updated', 'rev', 'base', 'prior', 'v'];
    const sortById = (l) => (Array.isArray(l) ? l.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))) : l);
    const norm = (doc) => {
      const c = canonicalDoc(doc);
      NOT_CARRIED.forEach((k) => delete c[k]);
      c.nodes = sortById(c.nodes).map((n) => Object.assign({}, n, { interfaces: sortById(n.interfaces || []).map((i) => {
        const o = Object.assign({}, i);
        if (o.mac) o.mac = normMac(o.mac);
        if (o.ip && parseValidCIDR(o.ip)) o.ip = String(o.ip).trim();
        return o;
      }) }));
      ['links', 'networks', 'groups', 'wifi', 'providers', 'columns'].forEach((k) => { if (c[k]) c[k] = sortById(c[k]); });
      return JSON.stringify(mgSorted(c));
    };
    const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `@${i}: ${a.slice(Math.max(0, i - 80), i + 60)} ||| ${b.slice(Math.max(0, i - 80), i + 60)}`; };
    const asFiles = (set) => set.files.filter((f) => f.name !== 'README.txt').map((f) => ({ name: f.name, text: f.text, bytes: new TextEncoder().encode(f.text) }));
    const roundTrip = (doc, version) => {
      const set = NB.buildNetboxSet(doc, { version, siteName: 'Site' });
      const res = I.parse('netbox', asFiles(set));
      return { set, res };
    };
    const mergeCounts = (mine, theirs) => {
      const plan = planMerge(canonicalDoc(mine), theirs, null);
      const items = plan.items.filter((it) => it.status === 'added' || it.status === 'changed' || it.status === 'conflict' || it.status === 'removed');
      return items.map((it) => `${it.kind}:${it.key}:${it.status}${it.fields ? '[' + it.fields.map((f) => f.field || f.key).join(',') + ']' : ''}`);
    };

    // ---- Every sample ----
    const bad = [], badMerge = [];
    for (const key of Object.keys(templatesData)) {
      const doc = templatesData[key];
      if (!(doc.nodes || []).length) continue;
      const { res } = roundTrip(doc, '4.2');
      const a = norm(doc), b = norm(res.doc);
      if (a !== b) bad.push(`${key} ${firstDiff(a, b)}`);
      const m = mergeCounts(doc, res.doc);
      if (m.length) badMerge.push(`${key}: ${m.slice(0, 3).join(' ')}`);
    }
    ok('every sample comes back the same through NetBox 4.2-4.4', !bad.length, bad.slice(0, 2).join(' ## '));
    ok('and merging it into the original changes nothing', !badMerge.length, badMerge.slice(0, 3).join(' ## '));
    {
      const doc = templatesData.datacenter || templatesData.showcase;
      const { res } = roundTrip(doc, '4.1');
      ok('through NetBox 4.1 too', norm(doc) === norm(res.doc), firstDiff(norm(doc), norm(res.doc)));
    }

    // ---- The rich fixture ----
    const rich = JSON.parse(await (await fetch('tests/fixtures/import/netbox-rich.json')).text()).doc;
    const richC = canonicalDoc(rich);
    for (const version of ['4.2', '4.1']) {
      const { set, res } = roundTrip(rich, version);
      const a = norm(rich), b = norm(res.doc);
      ok(`the rich network comes back the same (NetBox ${version})`, a === b, firstDiff(a, b));
      const m = mergeCounts(rich, res.doc);
      ok(`and merges into the original with no change (NetBox ${version})`, !m.length, m.slice(0, 4).join(' '));
      if (version === '4.2') {
        const names = set.files.map((f) => f.name);
        ok('README first, then the files numbered in import order', names[0] === 'README.txt' && names.slice(1).every((n, i) => n.startsWith(String(i + 1).padStart(2, '0') + '-')), names.join(' '));
        const order = names.slice(1).map((n) => n.replace(/^\d+-|\.csv$/g, ''));
        const before = (x, y) => order.indexOf(x) >= 0 && order.indexOf(y) >= 0 && order.indexOf(x) < order.indexOf(y);
        ok('dependencies first: fields, site, locations, racks, types, devices, VLANs, interfaces, MACs, addresses, cables',
          before('custom-fields', 'sites') && before('sites', 'locations') && before('locations', 'racks') && before('device-types', 'devices') && before('racks', 'devices')
          && before('devices', 'interfaces') && before('vlans', 'interfaces') && before('interfaces', 'mac-addresses') && before('interfaces', 'ip-addresses')
          && before('interfaces', 'cables') && before('clusters', 'virtual-machines') && before('virtual-machines', 'vm-interfaces') && before('wireless-lans', 'wireless-links'), order.join(','));
        const readme = set.files[0].text;
        ok('the README names the version, the order and what is not carried', /NetBox 4\.2 to 4\.4/.test(readme) && /01-custom-fields\.csv/.test(readme)
          && /Not carried/.test(readme) && /not checked against a live NetBox/.test(readme), readme.slice(0, 120));
        ok('and lists the links NetBox cannot hold as cables', /FW-01 - Internet \(vpn\)/.test(readme) && /HV-01 - DC-01 \(virtual\)/.test(readme), readme.split('Links NetBox')[1]);
        const file = (n) => set.files.find((f) => f.name.replace(/^\d+-/, '') === `${n}.csv`);
        const sheet = (n) => { const t = TopoImportCommon.csvTable(file(n).text); return t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r.cells[i] || '']))); };
        const devs = sheet('devices');
        ok('device names made unique, the original kept', devs.some((d) => d.name === 'AP') && devs.some((d) => d.name === 'AP (2)'));
        ok('a device in a top-numbered rack: position counted from the top (2U at U10 of 24 from the bottom stays bottom-numbered)',
          devs.find((d) => d.name === 'FW-01').position === '3' && devs.find((d) => d.name === 'HV-01').position === '10', devs.map((d) => `${d.name}:${d.position}`).join(' '));
        ok('an unknown make and model are written as stand-ins, roles as Topo\'s types', devs.find((d) => d.name === 'AP').manufacturer === 'Unknown'
          && devs.find((d) => d.name === 'FW-01').role === 'Firewall' && devs.find((d) => d.name === 'SW-CORE').status === 'planned' && devs.find((d) => d.name === 'AP (2)').status === 'decommissioning');
        const ifs = sheet('interfaces');
        ok('the port grid as named ports with the port number', ifs.some((r) => r.device === 'SW-CORE' && r.name === 'Gi1/0/2' && r.cf_topo_port === '2' && r.label === 'Reception 2' && r.untagged_vlan === '20' && r.poe_type === 'type2-ieee802.3at'));
        ok('a trunk with every VLAN is tagged-all, a list is its vids', ifs.some((r) => r.name === 'Gi1/0/3' && r.mode === 'tagged-all') && ifs.some((r) => r.name === 'trunk0' && r.mode === 'tagged' && r.tagged_vlans === '20,30,31,32' && r.type === 'lag'));
        ok('LAG members name their LAG', ifs.filter((r) => r.lag === 'trunk0').length === 2);
        ok('a second cable on one port and an unbound end get generated interfaces', ifs.filter((r) => r.cf_topo_generated).length >= 4
          && ifs.some((r) => r.device === 'SW-CORE' && r.cf_topo_generated === 'p1') && ifs.some((r) => r.device === 'Unnamed Node' && r.cf_topo_generated === 'unbound'));
        ok('4.2: MACs in their own file, not on the interface', !('mac_address' in ifs[0]) && sheet('mac-addresses').some((r) => r.mac_address === '00:09:0F:AA:00:01' && r.interface === 'wan1'));
        ok('a bare address is not written as an IP address', !sheet('ip-addresses').some((r) => /10\.99\.0\.1/.test(r.address)) && sheet('ip-addresses').some((r) => r.address === '203.0.113.2/29' && r.device === 'FW-01'));
        const cab = sheet('cables');
        ok('cables: ends by device and interface name, type, label, colour hex, length', cab.some((r) => r.side_a_device === 'Internet' && r.side_b_name === 'wan1' && r.type === 'mmf'
          && r.label === 'WAN-1' && r.color === COLOR_HEX_YELLOW() && r.length === '15' && r.length_unit === 'm') && cab.some((r) => r.length === '8' && r.length_unit === 'ft'), JSON.stringify(cab[0]));
        ok('wireless links between wireless interfaces', sheet('wireless-links').some((r) => r.device_a === 'AP' && r.interface_a === 'wlan0' && r.device_b === 'Laptop' && r.ssid === 'Staff'));
        ok('virtual machines in a cluster named after their host', sheet('virtual-machines').every((r) => r.cluster === 'HV-01') && devs.find((d) => d.name === 'HV-01').cluster === 'HV-01');
        ok('custom columns as topo_c_ custom fields with their kinds', sheet('custom-fields').some((r) => r.name === 'topo_c_c3' && r.type === 'date' && r.label === 'Warranty ends')
          && devs.find((d) => d.name === 'FW-01').cf_topo_c_c4 === 'true');
        ok('prefixes 4.2: no site column; VLAN by vid', !('site' in sheet('prefixes')[0]) && sheet('prefixes').some((r) => r.prefix === '192.168.10.0/24' && r.vlan === '10' && r.description === 'Data'));
      } else {
        const ifs = set.files.find((f) => /-interfaces\.csv$/.test(f.name) && !/vm-/.test(f.name)).text;
        ok('4.1: MACs on the interface, prefixes with their site, no MAC file', /mac_address/.test(ifs.split('\r\n')[0]) && !set.files.some((f) => /mac-addresses/.test(f.name))
          && /,site,/.test(set.files.find((f) => /prefixes/.test(f.name)).text.split('\r\n')[0]));
      }
    }

    // ---- The guard ----
    const tables = { node: NODE_FIELDS, iface: IFACE_FIELDS, link: LINK_FIELDS, cable: CABLE_FIELDS, network: NETWORK_FIELDS, group: GROUP_FIELDS, wifi: WIFI_FIELDS, provider: PROVIDER_FIELDS };
    // Keys the rich fixture does not hold, each with its reason.
    const NOT_IN_RICH = {};
    const has = { node: new Set(), iface: new Set(), link: new Set(), cable: new Set(), network: new Set(), group: new Set(), wifi: new Set(), provider: new Set() };
    richC.nodes.forEach((n) => { Object.keys(n).forEach((k) => has.node.add(k)); (n.interfaces || []).forEach((i) => Object.keys(i).forEach((k) => has.iface.add(k))); });
    richC.links.forEach((l) => { Object.keys(l).forEach((k) => has.link.add(k)); Object.keys(l.cable || {}).forEach((k) => has.cable.add(k)); });
    [['network', 'networks'], ['group', 'groups'], ['wifi', 'wifi'], ['provider', 'providers']].forEach(([t, k]) => (richC[k] || []).forEach((r) => Object.keys(r).forEach((x) => has[t].add(x))));
    const missing = [];
    Object.keys(tables).forEach((t) => tables[t].forEach((f) => { if (!has[t].has(f.key) && !(NOT_IN_RICH[t] || []).includes(f.key)) missing.push(`${t}.${f.key}`); }));
    ok('the rich fixture holds every field of every table (so the round trip covers them all)', !missing.length, missing.join(', '));

    // ---- NetBox edits come back ----
    {
      const set = NB.buildNetboxSet(rich, { version: '4.2', siteName: 'Site' });
      const files = asFiles(set).map((f) => {
        if (!/-devices\.csv$/.test(f.name)) return f;
        const text = f.text.replace('FGT60F0000001', 'FGT60F9999999').replace(/^HV-01,/m, 'HV-01-renamed,');
        return { name: f.name, text, bytes: new TextEncoder().encode(text) };
      });
      const res = I.parse('netbox', files);
      const fw = res.doc.nodes.find((n) => n.id === 'fw'), srv = res.doc.nodes.find((n) => n.id === 'srv');
      ok('a serial and a name changed in NetBox are taken; the rest stays Topo\'s', fw.serial === 'FGT60F9999999' && srv.name === 'HV-01-renamed' && fw.assetTag === 'AT-0001', `${fw.serial} ${srv.name}`);
    }

    // ---- The zip ----
    {
      const set = NB.buildNetboxSet(rich, { version: '4.2', siteName: 'Site' });
      const zip = NB.zipStore(set.files, new Date(2026, 10, 10, 12, 0, 0));
      ok('the zip starts with a local header and ends with the directory end', zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 3 && zip[3] === 4
        && new DataView(zip.buffer).getUint32(zip.length - 22, true) === 0x06054b50);
      ok('CRC-32 of "123456789" is CBF43926', NB.crc32(new TextEncoder().encode('123456789')).toString(16) === 'cbf43926');
      const back = await NB.unzip(zip);
      ok('unzip gives every file back byte for byte', back && back.length === set.files.length && back.every((f, i) => f.name === set.files[i].name
        && new TextDecoder().decode(f.bytes) === set.files[i].text), back ? back.map((f) => f.name).join(' ') : 'null');
    }

    // ---- Values written exactly (for NetBox, not a spreadsheet) ----
    {
      const doc = { v: DOC_VERSION, nodes: [{ id: 'a', type: 'pc', name: '=HYPERLINK("x")', x: 0, y: 0, notes: '- replaced PSU', interfaces: [] }], links: [] };
      const set = NB.buildNetboxSet(doc, { version: '4.2', siteName: 'S' });
      const dev = set.files.find((f) => /-devices\.csv$/.test(f.name)).text;
      ok('a value that starts with = or - is written as it is (NetBox would keep a guard apostrophe)', !/'=HYPERLINK/.test(dev) && !/'- replaced/.test(dev) && /"=HYPERLINK\(""x""\)"/.test(dev) && /,- replaced PSU,/.test(dev), dev.split('\r\n')[1]);
      ok('and the README says to open them in NetBox, not a spreadsheet', /open them in NetBox rather than a spreadsheet/.test(set.files[0].text));
      const res = I.parse('netbox', asFiles(set));
      ok('and reads back as written', res.doc.nodes[0].name === '=HYPERLINK("x")' && res.doc.nodes[0].notes === '- replaced PSU', res.doc.nodes[0].name);
      // NetBox's REST JSON of that device (no CSV guard in between): no edit seen.
      const row = {};
      const heads = dev.split('\r\n')[0].split(',');
      const cells = [];
      { let cur = '', q = false; const line = dev.split('\r\n')[1]; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch; } cells.push(cur); }
      heads.forEach((h, i) => { row[h] = cells[i]; });
      const custom = {};
      Object.keys(row).filter((k) => k.startsWith('cf_')).forEach((k) => { custom[k.slice(3)] = row[k]; });
      const api = { count: 1, next: null, previous: null, results: [{ id: 1, url: 'https://netbox.example/api/dcim/devices/1/', name: row.name, comments: row.comments, serial: '', asset_tag: null,
        role: { name: row.role }, device_type: { model: row.device_type, manufacturer: { name: row.manufacturer } }, site: { name: 'S' }, status: { value: 'active' }, custom_fields: custom }] };
      const text = JSON.stringify(api);
      const back = I.parse('netbox', [{ name: 'devices.json', text, bytes: new TextEncoder().encode(text) }]);
      ok('read back through the REST JSON, the notes are not taken as a NetBox edit', back.doc.nodes[0] && back.doc.nodes[0].notes === '- replaced PSU', back.doc.nodes[0] && back.doc.nodes[0].notes);
    }

    // ---- Makes, models, platforms spelled two ways; a repeated asset tag; LAGs and VLAN order ----
    {
      const mk = (id, name, extra) => Object.assign({ id, type: 'server', name, x: 0, y: 0, interfaces: [] }, extra);
      const doc = { v: DOC_VERSION, nodes: [
        mk('h1', 'HV', { vendor: 'Cisco', model: 'UCS C220', os: 'Proxmox VE', assetTag: 'A-1' }),
        mk('h2', 'HV2', { vendor: 'CISCO', model: 'ucs c220', os: 'proxmox ve', assetTag: 'A-1' }),
        mk('s1', 'SW1', { type: 'switch', vendor: 'TP-Link', model: 'TL-SG108' }),
        mk('s2', 'SW2', { type: 'switch', vendor: 'TP Link', model: 'TL-SG108' }),
        mk('srv', 'SRV', { interfaces: [{ id: 'e1', name: 'eno1' }, { id: 'e2', name: 'eno2' }, { id: 'b0', name: 'bond0', bond: { members: ['e1', 'e2'] } }] }),
        mk('vm', 'VM1', { type: 'vm', host: 'srv', interfaces: [{ id: 'v1', name: 'eth0', vlan: 30 }] })], links: [] };
      const set = NB.buildNetboxSet(doc, { version: '4.2', siteName: 'S' });
      const csvOf = (re) => set.files.find((f) => re.test(f.name)).text;
      const lines = (re) => csvOf(re).trim().split('\r\n');
      const mans = lines(/-manufacturers\.csv$/).slice(1);
      const slugs = (re) => lines(re).slice(1).map((l) => l.split(',').slice(-1)[0]);
      ok('one manufacturer per spelling-without-case, slugs unique', mans.length === 4 && mans.some((l) => l.startsWith('Cisco,')) && !mans.some((l) => l.startsWith('CISCO,'))
        && new Set(slugs(/-manufacturers\.csv$/)).size === mans.length, mans.join(' | '));
      const dtSlugs = lines(/-device-types\.csv$/).slice(1).map((l) => l.split(',')[2]);
      ok('device types: one per make and model without case, slugs unique', lines(/-device-types\.csv$/).length - 1 === 4 && new Set(dtSlugs).size === dtSlugs.length, lines(/-device-types\.csv$/).join(' | '));
      const devs = lines(/-devices\.csv$/);
      const dh = devs[0].split(',');
      const devRow = (name) => { const c = devs.find((l) => l.startsWith(name + ',')).split(','); return (k) => c[dh.indexOf(k)]; };
      ok('device rows use that one spelling', devRow('HV2')('manufacturer') === 'Cisco' && devRow('HV2')('device_type') === 'UCS C220' && devRow('HV2')('platform') === 'Proxmox VE'
        && lines(/-platforms\.csv$/).length - 1 === 1, devs.slice(1, 3).join(' | '));
      ok('a repeated asset tag is written once, the clash named in the README', devRow('HV')('asset_tag') === 'A-1' && devRow('HV2')('asset_tag') === '' && /A-1: HV2/.test(set.files[0].text));
      const order = set.files.map((f) => f.name.replace(/^\d+-|\.csv$/g, ''));
      ok('VLANs before both interface files', order.indexOf('vlans') < order.indexOf('vm-interfaces') && order.indexOf('vlans') < order.indexOf('interfaces'), order.join(','));
      const ifl = lines(/^\d+-interfaces\.csv$/).filter((l) => l.startsWith('SRV,')).map((l) => l.split(',')[1]);
      ok('a LAG before its members', ifl.indexOf('bond0') >= 0 && ifl.indexOf('bond0') < ifl.indexOf('eno1') && ifl.indexOf('bond0') < ifl.indexOf('eno2'), ifl.join(','));
      const res = I.parse('netbox', asFiles(set));
      const a = norm(doc), b = norm(res.doc);
      ok('and it all comes back the same (spellings, the second asset tag, interface order)', a === b, firstDiff(a, b));
    }
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  function COLOR_HEX_YELLOW() { return TopoImportCommon.colorHex('yellow'); }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
