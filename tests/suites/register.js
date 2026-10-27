// The Phase 1 exit test (Review-Packs/Topo-proposal.md, "Phase 1: trustworthy
// register"): a 63-device site survives reload, export, re-import and undo
// with every field intact. It gives one consistent set of findings, makes no
// duplicate cards, and a fresh device carries no invented values.
//
// Each of those has its own suite (schema, docpath, keep, history, findings).
// This one puts a site of a realistic size through all of them in the order a
// person would, because the bugs Phase 1 fixed were exactly the ones that only
// showed when the paths met: a field the serializer forgot, a reload that
// re-ran a migration, a re-import that made a second card, an undo that
// brought back a document without its MACs.
//
// The site sets every field the schema knows, on purpose and to something
// that is not a default, so a field that went missing anywhere on the way
// changes the bytes. It is a v3 document, the shape a site has once its
// networks are declared (R7): the LAN, the uplink and the tunnel are
// networks, the LAN's gateway and DNS live on it, and a device carries its
// own only where it differs (the router's resolver, Desk 22's wrong gateway). It also carries two deliberate faults (a duplicate
// address, a gateway outside its subnet), so "one consistent set of
// findings" compares a set with something in it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
  await loadScript('tests/fixtures/migration.js');   // docNeedsMigration
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const cards = () => CarinoLibrary.libraryEntries();
  const { LIBRARY_KEY, BINDER_EXPORT_KEY, USER_TPL_KEY } = CarinoLibrary;
  const heldResponder = setDialogResponder((req) => {
    if (req.kind === 'prompt') return 'Clínica Norte';
    if (req.kind === 'choice') return null;   // an unexpected question is answered "no" and fails below
    if (req.kind === 'confirm') return true;
    return undefined;
  });
  const held = [LIBRARY_KEY, BINDER_EXPORT_KEY, USER_TPL_KEY].map((k) => [k, localStorage.getItem(k)]);
  held.forEach(([k]) => localStorage.removeItem(k));
  let downloads = [];
  const realDownload = window.downloadJson;
  window.downloadJson = (payload, name) => { downloads.push({ payload: JSON.parse(JSON.stringify(payload)), name }); };

  // ---- The site: 63 devices ----
  const pad = (n) => String(n).padStart(2, '0');
  const mac = (n) => `52:54:00:40:00:${pad(n.toString(16))}`.toUpperCase();
  const nodes = [], links = [];
  let macN = 1, linkN = 1;
  const host = (id, type, name, ip, extra = {}) => {
    const node = Object.assign({ id, type, name, x: 0, y: 0, gw: '', dns: '', os: '', ports: '', notes: '', nat: false,
      interfaces: [{ id: 'i1', name: 'eth0', ip, mac: mac(macN++) }] }, extra);
    nodes.push(node); return node;
  };
  const cable = (source, sourceIface, target, targetIface, extra = {}) =>
    links.push(Object.assign({ id: `c${linkN++}`, source, target, attachment: null, medium: 'utp', sourceIface, targetIface }, extra));

  nodes.push({ id: 'isp', type: 'cloud', name: 'ISP', x: 600, y: 40, gw: '', dns: '', os: 'Fibra 1G', ports: '', notes: 'Circuit 77-1042', nat: false,
    interfaces: [{ id: 'w', name: 'wan0', ip: '203.0.113.1/30' }] });
  nodes.push({ id: 'hq', type: 'cloud', name: 'HQ', x: 900, y: 40, gw: '', dns: '', os: '', ports: '', notes: '', nat: false,
    siteRef: { id: 'card-hq', name: 'Oficinas Centrales' }, interfaces: [{ id: 'w', name: 'tun0', ip: '10.99.0.2/30' }] });
  nodes.push({ id: 'rtr', type: 'router', name: 'Core Router', x: 600, y: 160, gw: '203.0.113.1', dns: '10.40.0.10', os: 'RouterOS 7.14',
    ports: '22, 443', notes: 'Rack A, U12', nat: true, interfaces: [
      { id: 'wan', name: 'ether1', ip: '203.0.113.2/30', mac: 'DC:2C:6E:00:00:01' },
      { id: 'lan', name: 'ether2', ip: '10.40.0.1/24', mac: 'DC:2C:6E:00:00:02' },
      { id: 'tun', name: 'wg0', ip: '10.99.0.1/30' }] });
  nodes.push({ id: 'core', type: 'switch', name: 'Core Switch', x: 600, y: 280, gw: '', dns: '', os: 'SwOS 2.16', ports: '', notes: '', nat: false, portCount: 24, interfaces: [] });
  ['a', 'b', 'c'].forEach((s, i) => nodes.push({ id: `sw${s}`, type: 'switch', name: `Access ${s.toUpperCase()}`, x: 300 + i * 300, y: 400,
    gw: '', dns: '', os: '', ports: '', notes: `Floor ${i + 1}`, nat: false, portCount: 24, interfaces: [] }));
  ['1', '2'].forEach((s, i) => nodes.push({ id: `ap${s}`, type: 'ap', name: `AP ${s}`, x: 200 + i * 800, y: 280, gw: '', dns: '', os: 'UniFi 6.6',
    ports: '', notes: '', nat: false, portCount: 1, interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }));
  host('dns', 'server', 'DNS / DHCP', '10.40.0.10/24', { os: 'Debian 12', ports: '53, 67', notes: 'Also NTP' });
  host('files', 'server', 'File Server', '', { os: 'TrueNAS 24', ports: '445, 22', interfaces: [
    { id: 'e1', name: 'eno1', ip: '', mac: mac(macN++) }, { id: 'e2', name: 'eno2', ip: '', mac: mac(macN++) },
    { id: 'b0', name: 'bond0', ip: '10.40.0.11/24', mac: mac(macN++), bond: { mode: '802.3ad', members: ['e1', 'e2'] } }] });
  host('vm', 'vm', 'Backup VM', '10.40.0.12/24', { os: 'Ubuntu 24.04', ports: '22' });

  cable('isp', 'w', 'rtr', 'wan', { medium: 'fiber' });
  cable('rtr', 'tun', 'hq', 'w', { medium: 'vpn' });
  cable('rtr', 'lan', 'core', 'p1', { medium: 'fiber' });
  cable('core', 'p2', 'swa', 'p24'); cable('core', 'p3', 'swb', 'p24'); cable('core', 'p4', 'swc', 'p24');
  cable('core', 'p5', 'ap1', 'p1'); cable('core', 'p6', 'ap2', 'p1');
  cable('core', 'p7', 'dns', 'i1'); cable('core', 'p8', 'files', 'e1'); cable('core', 'p9', 'files', 'e2');
  cable('files', 'e1', 'vm', 'i1', { attachment: 'bridged', medium: 'virtual' });

  // 51 endpoints across the three access switches, two APs.
  const port = { swa: 1, swb: 1, swc: 1 };
  const onSwitch = (id, n) => { const sw = ['swa', 'swb', 'swc'][n % 3]; cable(id, 'i1', sw, `p${port[sw]++}`); };
  for (let n = 0; n < 22; n++) { host(`pc${n}`, 'pc', `Desk ${pad(n + 1)}`, `10.40.0.${100 + n}/24`, { os: 'Windows 11 23H2', ports: '3389' }); onSwitch(`pc${n}`, n); }
  for (let n = 0; n < 4; n++) {
    host(`lap${n}`, 'pc', `Laptop ${n + 1}`, `10.40.0.${130 + n}/24`, { os: 'macOS 14',
      interfaces: [{ id: 'i1', name: 'wlan0', ip: `10.40.0.${130 + n}/24`, mac: mac(macN++), wireless: true }] });
    cable(`ap${(n % 2) + 1}`, 'w1', `lap${n}`, 'i1', { medium: 'wireless' });
  }
  for (let n = 0; n < 12; n++) { host(`ph${n}`, 'voip', `Ext ${200 + n}`, `10.40.0.${150 + n}/24`, { os: 'Yealink 66.86', ports: '5060' }); onSwitch(`ph${n}`, n); }
  for (let n = 0; n < 6; n++) { host(`cam${n}`, 'camera', `Camera ${n + 1}`, `10.40.0.${200 + n}/24`, { dns: '', os: 'Hikvision 5.7', ports: '554' }); onSwitch(`cam${n}`, n + 1); }
  for (let n = 0; n < 4; n++) { host(`prn${n}`, 'printer', `Printer ${n + 1}`, `10.40.0.${220 + n}/24`, { dns: '', ports: '9100', notes: n === 0 ? 'Toner in cupboard 3' : '' }); onSwitch(`prn${n}`, n + 2); }
  for (let n = 0; n < 3; n++) {
    host(`iot${n}`, 'iot', `Sensor ${n + 1}`, `10.40.0.${230 + n}/24`, { os: 'ESPHome', ports: '1883',
      interfaces: [{ id: 'i1', name: 'wlan0', ip: `10.40.0.${230 + n}/24`, mac: mac(macN++) }] });
    cable('ap2', 'w1', `iot${n}`, 'i1', { medium: 'wireless' });
  }
  // The two deliberate faults.
  nodes.find((n) => n.id === 'prn3').interfaces[0].ip = '10.40.0.222/24';   // = Printer 3
  nodes.find((n) => n.id === 'pc21').gw = '10.41.0.1';                       // outside its subnet
  nodes.forEach((n, i) => { if (!n.x) { n.x = 100 + (i % 12) * 110; n.y = 560 + Math.floor(i / 12) * 120; } });
  // Every network field, in the table's order (NETWORK_FIELDS), so the bytes
  // can be compared.
  const networks = [
    { id: 'lan', cidr: '10.40.0.0/24', name: 'Clinic LAN', vlan: 40, purpose: 'Staff, phones and devices', gateway: '10.40.0.1', dns: '10.40.0.10', dhcp: true },
    { id: 'up', cidr: '203.0.113.0/30', name: 'Uplink', gateway: '203.0.113.1' },
    { id: 'tun', cidr: '10.99.0.0/30', name: 'Tunnel to HQ', drawZone: false }
  ];
  const site = {
    v: DOC_VERSION, nodes, links, networks,
    annotations: [{ id: 'a1', x: 600, y: 10, text: 'Clínica Norte — planta baja', style: 'note', size: 14, targets: ['rtr'] }],
    report: { site: 'Clínica Norte', client: 'Grupo Salud', engineer: 'M. C.', ref: 'CN-2026-10', date: '2026-10-26', scope: 'Full survey' }
  };
  const input = JSON.parse(JSON.stringify(site));

  const bytes = () => JSON.stringify(serializeDoc());
  const sig = (findings) => findings.map((f) => `${f.level}|${f.key}|${f.line}`).sort().join('\n');
  const findingsNow = () => sig(topologyFindings());

  try {
    ok('the site has 63 devices', nodes.length === 63, String(nodes.length));
    ok('every cable is bound, so nothing is migrated on the way in', !docNeedsMigration(site));

    // ---- Opened from a file: kept, as a file is ----
    ok('opening the file takes', (await applyImportedDoc({ kind: 'nettopology', version: 1, name: 'Clínica Norte', doc: site })) === true);
    const id = state.libraryId;
    ok('it is one card, named from the file', !!id && cards().length === 1 && cards()[0].name === 'Clínica Norte');
    const base = bytes(), baseFindings = findingsNow();
    ok('its networks arrive exactly as written', JSON.stringify(JSON.parse(base).networks) === JSON.stringify(input.networks),
       JSON.stringify(JSON.parse(base).networks));
    ok('and the devices use them: the LAN\'s gateway and DNS; the router its own', effectiveGw(getNode('pc4')) === '10.40.0.1'
       && effectiveDns(getNode('pc4')) === '10.40.0.10' && effectiveGw(getNode('rtr')) === '203.0.113.1' && effectiveDns(getNode('rtr')) === '10.40.0.10');

    // Every field the input set is on the canvas, as it was set.
    const fieldDiff = () => {
      const bad = [];
      const now = JSON.parse(bytes());
      input.nodes.forEach((n) => {
        const got = now.nodes.find((m) => m.id === n.id);
        if (!got) { bad.push(`${n.id} missing`); return; }
        NODE_FIELDS.forEach((f) => {
          if (!(f.key in n) || f.key === 'interfaces') return;
          if (JSON.stringify(got[f.key]) !== JSON.stringify(n[f.key])) bad.push(`${n.id}.${f.key}`);
        });
        n.interfaces.forEach((i) => {
          const gi = (got.interfaces || []).find((x) => x.id === i.id);
          if (!gi) { bad.push(`${n.id}/${i.id} missing`); return; }
          IFACE_FIELDS.forEach((f) => { if (f.key in i && JSON.stringify(gi[f.key]) !== JSON.stringify(i[f.key])) bad.push(`${n.id}/${i.id}.${f.key}`); });
        });
      });
      input.links.forEach((l) => {
        const got = now.links.find((m) => m.id === l.id);
        if (!got) { bad.push(`${l.id} missing`); return; }
        LINK_FIELDS.forEach((f) => { if (f.key in l && JSON.stringify(got[f.key] ?? null) !== JSON.stringify(l[f.key] ?? null)) bad.push(`${l.id}.${f.key}`); });
      });
      if (now.nodes.length !== input.nodes.length || now.links.length !== input.links.length) bad.push('counts');
      if (JSON.stringify(now.annotations) !== JSON.stringify(input.annotations)) bad.push('annotations');
      if (JSON.stringify(now.report) !== JSON.stringify(input.report)) bad.push('report header');
      return bad;
    };
    let diff = fieldDiff();
    ok('every field arrives intact (MACs, bonds, port counts, site link, notes, report header…)', !diff.length, diff.slice(0, 8).join(', '));
    // No invented values: a field the file left blank is still blank.
    const invented = [];
    JSON.parse(base).nodes.forEach((n) => {
      const src = input.nodes.find((m) => m.id === n.id);
      ['gw', 'dns', 'os', 'ports', 'notes'].forEach((k) => { if ((src[k] || '') !== (n[k] || '')) invented.push(`${n.id}.${k}=${n[k]}`); });
    });
    ok('nothing is filled in that the file left blank', !invented.length, invented.slice(0, 6).join(', '));

    // ---- One consistent set of findings ----
    const all = topologyFindings();
    ok('the two deliberate faults are found', all.some((f) => f.key === 'ip-conflict') && all.some((f) => /10\.41\.0\.1/.test(f.line)),
       all.map((f) => f.key).join(','));
    ok('the report lists exactly the panel’s findings', sig(reportModel().findings) === baseFindings);
    const summary = CarinoLibrary.librarySummary(CarinoLibrary.loadLibrary()[id].doc);
    ok('the card counts what the panel counts', summary.devices === 63
       && summary.critical === all.filter((f) => f.level === 'bad').length && summary.advisory === all.filter((f) => f.level === 'warn').length,
       JSON.stringify(summary));
    const badged = state.nodes.filter((n) => nodeSeverity(n) === 'bad').map((n) => n.id).sort().join(',');
    ok('every red badge is a device a critical finding names', badged.split(',').filter(Boolean).every((nid) =>
       all.some((f) => f.level === 'bad' && (f.nodeIds || []).includes(nid))), badged);

    // ---- Reload ----
    // What a reload finds: this history entry's document, and its card.
    flushAutosave();
    ok('the card holds the same bytes as the canvas', JSON.stringify(CarinoLibrary.canonicalDoc(CarinoLibrary.loadLibrary()[id].doc))
       === JSON.stringify(CarinoLibrary.canonicalDoc(JSON.parse(base))));
    const entry = window.history.state;
    state.nodes = []; state.links = []; state.annotations = []; state.report = null; state.libraryId = null; state.docId = null;
    window.history.replaceState(entry, '', cleanUrl());
    await load();
    ok('a reload brings back the same bytes', bytes() === base);
    ok('and the same card, not a second one', state.libraryId === id && cards().length === 1);
    ok('and the same findings', findingsNow() === baseFindings);

    // ---- Export, then re-import ----
    downloads = []; exportJsonFile();
    const file = downloads[0] && downloads[0].payload;
    ok('the back-up file names the site and carries the card’s id', !!file && file.doc.id === id && /^clinica-norte-/.test(downloads[0].name),
       downloads[0] && downloads[0].name);
    replaceDocument(templatesData.house, { origin: 'template' });
    ok('re-importing your own file takes, without a question', (await applyImportedDoc(file)) === true);
    ok('the same bytes', bytes() === base);
    ok('the same single card', state.libraryId === id && cards().length === 1);
    ok('the same findings', findingsNow() === baseFindings);
    diff = fieldDiff();
    ok('every field still intact', !diff.length, diff.slice(0, 8).join(', '));
    // The same file in a browser that has never seen it: a card of its own,
    // under the file's identity, and still one card.
    const keepLib = CarinoLibrary.loadLibrary();
    CarinoLibrary.persistLibrary({});
    replaceDocument(templatesData.house, { origin: 'template' });
    await applyImportedDoc(file);
    ok('in a fresh browser the file opens as one card with the same bytes', cards().length === 1 && bytes() === base && state.docId === id);
    CarinoLibrary.persistLibrary(keepLib);
    replaceDocument(CarinoLibrary.loadLibrary()[id].doc, { libraryId: id, origin: 'library' });
    ok('back on the original card', bytes() === base && state.libraryId === id && cards().length === 1);

    // ---- Undo ----
    // Four different kinds of edit, each undone, then all redone and undone.
    initHistory();
    const ph = getNode('ph3');
    ph.name = 'Reception'; save();
    getNode('pc4').interfaces[0].mac = 'AA:BB:CC:00:11:22'; save();
    getNode('files').interfaces.find((i) => i.id === 'b0').bond.mode = 'active-backup'; save();
    const killed = 'cam2';
    state.links = state.links.filter((l) => l.source !== killed && l.target !== killed);
    state.nodes = state.nodes.filter((n) => n.id !== killed); save();
    ok('four edits are four steps', bytes() !== base && !getNode(killed));
    undo(); undo(); undo(); undo();
    ok('undoing them gives back the same bytes', bytes() === base);
    ok('with the MACs and the bond as they were', getNode('pc4').interfaces[0].mac === input.nodes.find((n) => n.id === 'pc4').interfaces[0].mac
       && getNode('files').interfaces.find((i) => i.id === 'b0').bond.mode === '802.3ad');
    redo(); redo(); redo(); redo();
    ok('redo replays all four', getNode('ph3').name === 'Reception' && !getNode(killed));
    undo(); undo(); undo(); undo();
    ok('and undo takes them back again', bytes() === base);
    ok('the findings are the same after the round trip', findingsNow() === baseFindings);
    flushAutosave();
    ok('the card followed the undo', JSON.stringify(CarinoLibrary.canonicalDoc(CarinoLibrary.loadLibrary()[id].doc))
       === JSON.stringify(CarinoLibrary.canonicalDoc(JSON.parse(base))));

    // ---- A fresh device carries no invented values ----
    const loose = spawnNode('pc');
    ok('a device dropped on the canvas has no gateway, DNS or OS nobody gave it', !!loose && loose.gw === '' && loose.dns === '' && loose.os === '',
       loose && JSON.stringify({ gw: loose.gw, dns: loose.dns, os: loose.os }));
    undo();
    const wired = spawnNode('pc', { connectTo: 'swb' });
    ok('one cabled into the LAN takes the gateway and DNS the LAN uses, and still no OS',
       !!wired && effectiveGw(wired) === '10.40.0.1' && effectiveDns(wired) === '10.40.0.10' && wired.os === '',
       wired && JSON.stringify({ gw: effectiveGw(wired), dns: effectiveDns(wired), os: wired.os }));
    ok('by inheriting them from the network, not as copies', !!wired && wired.gw === '' && wired.dns === '');
    undo();
    // The final review: allowed ports, NAT and the seed address were still
    // copied from the type defaults, so three PCs dropped in a row were an
    // IP conflict at once and every PC in the report allowed 80 and 443.
    const conflictsBefore = topologyFindings().filter((f) => /IP Conflict/.test(f.check)).length;
    const drops = [0, 1, 2].map((i) => spawnNode('pc', { at: { x: 2000 + i * 100, y: 2000 } }));
    ok('a device dropped loose has no address, no allowed ports and no NAT nobody gave it',
       drops.every((n) => n.ports === '' && n.nat === false && n.interfaces.every((i) => i.ip === '')), JSON.stringify(drops.map((n) => [n.ports, n.nat, n.interfaces.map((i) => i.ip)])));
    ok('so three dropped in a row are no IP conflict', topologyFindings().filter((f) => /IP Conflict/.test(f.check)).length === conflictsBefore);
    const lb = spawnNode('loadbalancer', { at: { x: 2400, y: 2000 } });
    ok('a load balancer does not arrive doing NAT on two addresses', lb.nat === false && lb.interfaces.length === 2 && lb.interfaces.every((i) => i.ip === ''),
       JSON.stringify({ nat: lb.nat, ips: lb.interfaces.map((i) => i.ip) }));
    undo(); undo(); undo(); undo();
    ok('and undoing both leaves the site as it was', bytes() === base);

    // ---- Still one card ----
    flushAutosave();
    ok('no duplicate cards at the end of it all', cards().length === 1 && cards()[0].id === id, String(cards().length));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.downloadJson = realDownload;
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
