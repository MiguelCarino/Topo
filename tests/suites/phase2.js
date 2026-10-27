// The Phase 2 exit tests (Review-Packs/Topo-proposal.md, "Phase 2: bulk and
// inventory"), run through the real controls on one realistic site:
//   1. Moving 20 phones to VLAN 20 is one undoable action with a findings
//      preview: the search selects them, the bulk panel's Move previews the
//      change and what the checks would find, Apply is one undo step.
//   2. Renumbering the camera network is one undoable action with a findings
//      preview: the Subnets tab's Renumber asks with the findings delta in
//      the question, and Undo takes the whole renumber back.
//   3. The site round-trips through a spreadsheet with no loss: subnets.csv,
//      devices.csv, interfaces.csv and cables.csv, exported as files (UTF-8
//      with a BOM) and imported into an empty map, give back every network,
//      device, field, interface, MAC, cable, cable label and finding, and the
//      gateway and DNS each device uses (most inherited, so blank in
//      devices.csv); imported over the site itself, they change nothing.
//      (It used to start from a map that already declared the networks, and
//      so passed while the export had no way to carry them.)
//   4. A printed QR asset label opens the right device: the QR code on the
//      label sheet is decoded here, by a reader that shares no code with the
//      encoder (vendor/qrcode-generator), and the address it holds, opened as
//      a visit would, opens the kept network holding that tag (not the other
//      one on screen) and selects that device.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const asked = [];
  let promptAnswer = null;
  const heldResponder = setDialogResponder((req) => {
    asked.push(req);
    if (req.kind === 'prompt') return promptAnswer;
    if (req.kind === 'confirm') return true;
    if (req.kind === 'choice') return req.choices.length ? req.choices[0].id : null;
    return undefined;
  });
  const heldStore = loadLibrary();
  persistLibrary({});
  const heldOpen = window.open;

  // ---- The site: a clinic floor. A router, a core switch, a phone switch
  // with twenty desk phones still on the data network (with a stale gateway
  // override each), a camera switch with eight cameras and the NVR on
  // 10.10.30.0/24, and a few PCs and a printer with asset tags. The router's
  // camera-side port was already moved to 10.10.40.1, so the NVR's cable to
  // it is a cabling fault until the camera network follows.
  const site = () => {
    const nodes = [
      { id: 'rt', type: 'router', name: 'Router', x: 0, y: 0, os: 'RouterOS 7.14', assetTag: 'CS-0001', serial: 'RB-55', location: 'Rack A · U1',
        interfaces: [{ id: 'e0', name: 'eth0', ip: '10.10.10.1/24', mac: '48:8F:5A:00:00:01' }, { id: 'e1', name: 'eth1', ip: '10.10.40.1/24' }, { id: 'e2', name: 'eth2', ip: '10.10.20.1/24' }] },
      { id: 'core', type: 'switch', name: 'Core', x: 0, y: 120, portCount: 24, assetTag: 'CS-0002', interfaces: [] },
      { id: 'swp', type: 'switch', name: 'SW-Phones', x: -300, y: 240, portCount: 24, interfaces: [] },
      { id: 'swc', type: 'switch', name: 'SW-Cams', x: 300, y: 240, portCount: 16, interfaces: [] },
      { id: 'nvr', type: 'server', name: 'NVR', x: 500, y: 240, notes: 'Retention 30 days', assetTag: 'CS-0042', serial: 'NVR-8812', location: 'Rack A · U4', status: 'active',
        interfaces: [{ id: 'i1', name: 'eth0', ip: '10.10.30.250/24', mac: '00:1B:21:3A:4B:5C' }] },
      { id: 'pc1', type: 'pc', name: 'Reception', x: 0, y: 360, os: 'Windows 11', assetTag: 'CS-0101', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.10.10.21/24', mac: '3C:07:54:11:22:33' }] },
      { id: 'pc2', type: 'pc', name: 'Doctor 1', x: 100, y: 360, dns: '1.1.1.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.10.10.22/24' }] },
      { id: 'prn', type: 'printer', name: 'Printer', x: 200, y: 360, status: 'planned', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.10.10.30/24' }] }
    ];
    const links = [
      { id: 'u1', source: 'rt', target: 'core', sourceIface: 'e0', targetIface: 'p24', cable: { label: 'UP-01', length: '1 m', color: 'blue' } },
      { id: 'u2', source: 'core', target: 'swp', sourceIface: 'p1', targetIface: 'p24' },
      { id: 'u3', source: 'core', target: 'swc', sourceIface: 'p2', targetIface: 'p16' },
      { id: 'u4', source: 'rt', target: 'nvr', sourceIface: 'e1', targetIface: 'i1', cable: { label: 'CAM-UP', via: 'PP-A:12 > WJ-3B' } },
      { id: 'l1', source: 'core', target: 'pc1', sourceIface: 'p5', targetIface: 'i1', cable: { label: 'WS-05' } },
      { id: 'l2', source: 'core', target: 'pc2', sourceIface: 'p6', targetIface: 'i1' },
      { id: 'l3', source: 'core', target: 'prn', sourceIface: 'p7', targetIface: 'i1' }
    ];
    for (let i = 1; i <= 20; i++) {
      nodes.push({ id: `ph${i}`, type: 'voip', name: `Phone-${String(i).padStart(2, '0')}`, x: -500 + i * 20, y: 480, os: 'Yealink T46U', gw: '10.10.99.1',
        interfaces: [{ id: 'i1', name: 'eth0', ip: `10.10.10.${100 + i}/24`, mac: `80:5E:C0:00:00:${String(i).padStart(2, '0')}` }] });
      links.push({ id: `lp${i}`, source: 'swp', target: `ph${i}`, sourceIface: `p${i}`, targetIface: 'i1' });
    }
    for (let i = 1; i <= 8; i++) {
      nodes.push({ id: `cam${i}`, type: 'camera', name: `CAM-${String(i).padStart(2, '0')}`, x: 200 + i * 40, y: 480,
        interfaces: [{ id: 'i1', name: 'eth0', ip: `10.10.30.${10 + i}/24` }] });
      links.push({ id: `lc${i}`, source: 'swc', target: `cam${i}`, sourceIface: `p${i}`, targetIface: 'i1' });
    }
    return { v: DOC_VERSION,
      networks: [
        { id: 'data', cidr: '10.10.10.0/24', name: 'Data', vlan: 10, gateway: '10.10.10.1', dns: '10.10.10.1' },
        { id: 'voice', cidr: '10.10.20.0/24', name: 'Voice', vlan: 20, gateway: '10.10.20.1', dns: '10.10.10.1', purpose: 'Desk phones' },
        { id: 'cams', cidr: '10.10.30.0/24', name: 'Cameras', vlan: 30 }
      ], nodes, links };
  };
  const open = () => { replaceDocument(site(), { origin: 'file' }); initHistory(); showConfigTab('config'); };
  const ipOf = (id) => getNode(id).interfaces[0].ip;
  const phones = () => state.nodes.filter((n) => n.type === 'voip');
  // The network a device is on, by its address.
  const networkOf = (n) => { const p = parseValidCIDR(n.interfaces[0].ip); return p ? networkOfIp(p.ip) : null; };

  try {
    // ---- 1. Twenty phones to VLAN 20 ----
    open();
    const gwBefore = topologyFindings().filter((f) => f.key === 'gateway').length;
    ok('the site: twenty phones on the data network, each with a stale gateway', phones().length === 20 && phones().every((n) => networkOf(n) && networkOf(n).id === 'data') && gwBefore === 20,
       `${phones().length} phones, ${gwBefore} gateway findings`);
    setQuery('type:voip');
    el('querySelectBtn').click();
    ok('the search selects them', state.selection.size === 20 && selectedOf('node').every((id) => getNode(id).type === 'voip'));
    setQuery('');
    document.querySelector('#bulkTabs [data-bulk="move"]').click();
    el('bulkNet').value = 'voice'; el('bulkNet').dispatchEvent(new Event('change', { bubbles: true }));
    const steps0 = _undoStack.length;
    el('bulkPreviewBtn').click();
    ok('Move previews the change on every phone', el('bulkTitle').textContent === 'Move to Voice' && /20\s*To change/.test(el('bulkCounts').textContent), el('bulkCounts').textContent);
    ok('with the findings it would leave (the twenty stale gateways go)', /Findings after this change:/.test(el('bulkDelta').textContent) && /−20 Gateway/.test(el('bulkDelta').textContent), el('bulkDelta').textContent);
    ok('and nothing moves before Apply', ipOf('ph1') === '10.10.10.101/24' && _undoStack.length === steps0);
    el('bulkApplyBtn').click();
    const voice = networkById('voice');
    ok('Apply: every phone is on VLAN 20', phones().every((n) => networkOf(n) === voice) && voice.vlan === 20);
    ok('each with the voice network\'s gateway, its own override gone', phones().every((n) => effectiveGw(n) === '10.10.20.1' && !n.gw));
    ok('the stale-gateway findings went with it', topologyFindings().filter((f) => f.key === 'gateway').length === 0);
    ok('as one undo step', _undoStack.length === steps0 + 1);
    undo();
    ok('one Undo puts all twenty back', phones().every((n) => networkOf(n).id === 'data' && n.gw === '10.10.99.1') && ipOf('ph20') === '10.10.10.120/24');
    redo();
    ok('and Redo moves them again', phones().every((n) => networkOf(n) === networkById('voice')));

    // ---- 2. Renumber the camera network ----
    select(null, null);
    showConfigTab('networks');
    const cablingBefore = topologyFindings().filter((f) => f.key === 'cabling').length;
    ok('before: the NVR\'s cable to the router is a cabling fault', cablingBefore === 1);
    const steps1 = _undoStack.length;
    promptAnswer = '10.10.40.0/24';
    asked.length = 0;
    const btn = el('networkList').querySelector('[data-act="renumber"][data-net="cams"]');
    ok('the Subnets tab offers Renumber on the camera network', !!btn);
    btn.click();
    await wait(0); await wait(0); await wait(0);
    const question = asked.find((a) => a.kind === 'confirm');
    ok('it asks first, with what would move', !!question && /Renumber 10\.10\.30\.0\/24 to 10\.10\.40\.0\/24\?/.test(question.message) && /Addresses moved: 9/.test(question.message), question && question.message);
    ok('and with the findings it would leave', !!question && /Findings after this change: −1 Cabling/.test(question.message), question && question.message);
    ok('renumbered: the cameras and the NVR keep their host parts', ipOf('cam1') === '10.10.40.11/24' && ipOf('cam8') === '10.10.40.18/24' && ipOf('nvr') === '10.10.40.250/24'
       && networkById('cams').cidr === '10.10.40.0/24');
    ok('the cabling fault is gone', topologyFindings().filter((f) => f.key === 'cabling').length === 0);
    ok('as one undo step', _undoStack.length === steps1 + 1);
    undo();
    ok('one Undo puts the whole network back', ipOf('cam1') === '10.10.30.11/24' && ipOf('nvr') === '10.10.30.250/24' && networkById('cams').cidr === '10.10.30.0/24'
       && phones().every((n) => networkOf(n) === networkById('voice')));
    redo();
    showConfigTab('config');

    // ---- 3. The spreadsheet round trip ----
    // What a file holds: the sheet as downloadCsv writes it, BOM and all.
    const files = { subnets: CSV_BOM + csvText(csvSubnetsSheet(), ','), devices: CSV_BOM + csvText(csvDevicesSheet(), ','), interfaces: CSV_BOM + csvText(csvInterfacesSheet(), ','), cables: CSV_BOM + csvText(csvCablesSheet(), ',') };
    const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
    const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
    // Everything a device is, but where it was drawn; every cable by its ends,
    // ports and facts; every finding as worded.
    const devSig = () => state.nodes.map((n) => { const s = serializeNode(n); delete s.x; delete s.y; return JSON.stringify(s); }).sort().join('\n');
    // A cable drawn here says attachment: null, one in a file may say nothing;
    // both mean "not set", so the comparison reads them alike. A cable has no
    // direction either: devices.csv lays the router's uplink from the switch
    // end, the drawing had it from the router, and it is the same cable on
    // the same two ports. So each cable is its two ends in a fixed order,
    // with its facts.
    const cabSig = () => state.links.map((l) => {
      const s = serializeLink(l);
      const ends = [`${s.source}:${s.sourceIface || '-'}`, `${s.target}:${s.targetIface || '-'}`].sort();
      return JSON.stringify({ ends, medium: s.medium, attachment: s.attachment || undefined, cable: s.cable });
    }).sort().join('\n');
    const finSig = () => topologyFindings().map((f) => `${f.check}|${f.subject}|${f.detail}`).sort().join('\n');
    const netSig = () => JSON.stringify((serializeNetworks(state.networks) || []).slice().sort((a, b) => a.cidr.localeCompare(b.cidr)));
    const effSig = () => state.nodes.map((n) => `${n.id}:${effectiveGw(n)}|${effectiveDns(n)}`).sort().join(' ');
    const want = { dev: devSig(), cab: cabSig(), fin: finSig(), nets: netSig(), eff: effSig() };
    // Over the site itself: nothing to do.
    const same = ['subnets', 'devices', 'interfaces', 'cables'].map((k) => planOf(files[k]));
    ok('imported over the site, every sheet changes nothing', same.every((p) => !p.ops.length && !p.errors.length && p.rows.every((r) => r.status === 'same')),
       same.map((p) => p.rows.filter((r) => r.status !== 'same').map((r) => `${r.status}:${r.name}:${r.why || ''}`).slice(0, 3).join(';')).join(' / '));
    // Into an empty map: no devices, no cables, no networks.
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    const conflicts = [];
    ['subnets', 'devices', 'interfaces', 'cables'].forEach((k) => {
      const plan = planOf(files[k]);
      plan.rows.filter((r) => r.status === 'conflict').forEach((r) => conflicts.push(`${k}: ${r.name}: ${r.why}`));
      applyCsvPlan(plan);
    });
    ok('into an empty map, nothing conflicts', !conflicts.length, conflicts.slice(0, 3).join(' | '));
    ok('every device comes back with every field, interface and MAC', devSig() === want.dev,
       (() => { const a = want.dev.split('\n'), b = devSig().split('\n'); const i = a.findIndex((x, j) => x !== b[j]); return i < 0 ? `${a.length} vs ${b.length}` : `${a[i]} ≠ ${b[i]}`.slice(0, 400); })());
    ok('every cable, on the same ports, with its label, length, colour and route', cabSig() === want.cab,
       (() => { const a = want.cab.split('\n'), b = cabSig().split('\n'); const i = a.findIndex((x, j) => x !== b[j]); return i < 0 ? `${a.length} vs ${b.length}` : `${a[i]} ≠ ${b[i]}`.slice(0, 300); })());
    ok('and the checks find exactly what they found before', finSig() === want.fin, finSig().slice(0, 200));
    ok('every network comes back with its name, VLAN, gateway and DNS', netSig() === want.nets, netSig().slice(0, 300));
    ok('and every device uses the gateway and DNS it used before', effSig() === want.eff,
       (() => { const a = want.eff.split(' '), b = effSig().split(' '); const i = a.findIndex((x, j) => x !== b[j]); return i < 0 ? '' : `${a[i]} ≠ ${b[i]}`; })());

    // ---- 4. A printed QR label opens the right device ----
    // The site is kept as a card; a second network holding another device is
    // on screen when the label is scanned.
    // Kept as Keep this network keeps one (claimDocument, js/library.js).
    open();
    const siteCard = claimDocument('Clínica Norte — piso 2');
    replaceDocument({ v: DOC_VERSION, nodes: [{ id: 'z', type: 'pc', name: 'Elsewhere', x: 0, y: 0, assetTag: 'CS-9000', interfaces: [] }], links: [] }, { origin: 'new' });
    claimDocument('Bodega Sur');
    ok('two networks are kept, the other one on screen', !!siteCard && !!state.libraryId && state.libraryId !== siteCard && libraryNetworks().length === 2,
       `${siteCard} ${state.libraryId} ${libraryNetworks().length}`);
    // Print the NVR's label from the site, as the Print labels button does.
    await openFromLibrary(siteCard);
    let downloaded = null;
    window.open = () => null;   // no tab: the download fallback hands back the file name
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
    const printed = printAssetLabels([{ type: 'node', id: 'nvr' }]);
    HTMLAnchorElement.prototype.click = realClick;
    window.open = heldOpen;
    ok('Print labels makes a label for the NVR', !!printed && printed.set.devices.length === 1 && /-labels-/.test(downloaded || ''), downloaded);
    const sheet = new DOMParser().parseFromString(labelsHtml(printed.set), 'text/html');
    const svg = sheet.querySelector('.lbl .qr svg');
    const text = qrDecodeSvg(svg);
    ok('its QR code decodes, by a reader of its own, to this page\'s asset link', text === `${location.origin}${location.pathname}#asset/CS-0042`, text);
    ok('the label carries the tag and the name beside the code', /CS-0042/.test(sheet.body.textContent) && /NVR/.test(sheet.body.textContent));
    // Scanning it: another network on screen, then the address the code holds.
    await openFromLibrary(libraryNetworks().find((e) => e.id !== siteCard).id);
    ok('the other network is on screen', state.libraryId !== siteCard && !!getNode('z'));
    asked.length = 0;
    // The address as the phone opens it (with this run's ?lang= kept).
    window.history.replaceState(null, '', text.replace('#', `${location.search}#`));
    await load();
    renderCanvasOnly(); fitToView(); applyArrivalFocus();
    ok('the scan opens the network that holds the tag', state.libraryId === siteCard && !!getNode('nvr'), state.libraryId);
    ok('and selects the device on the label, centred on the map', state.selectedId === 'nvr' && state.selectedType === 'node'
       && (() => { const r = el('networkCanvas').getBoundingClientRect(); return Math.abs(state.camera.x + getNode('nvr').x * state.camera.zoom - r.width / 2) < 1; })());
    ok('without asking anything, and the tag leaves the address bar', !asked.length && location.hash === '', asked.map((a) => a.kind).join(','));
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e).slice(0, 400));
  } finally {
    setDialogResponder(heldResponder);
    window.open = heldOpen;
    persistLibrary(heldStore);
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });

// ---- A QR reader, for a code drawn as one SVG square per dark module ----
// Written here from ISO/IEC 18004, sharing nothing with the encoder the page
// uses, so a label that decodes is a label any phone would read the same way.
// Byte mode, versions 1 to 10, any error-correction level; error correction
// itself is not needed for a code read straight from its own drawing.
function qrDecodeSvg(svg) {
  if (!svg) return null;
  const box = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  const quiet = 4, size = box[2] - quiet * 2;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const d = svg.querySelector('path').getAttribute('d');
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) dark[Number(m[2]) - quiet][Number(m[1]) - quiet] = true;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 10) return null;

  // Format: 15 bits beside the top-left finder, (row 8, cols 0-5, 7, 8), then
  // (rows 7, 5-0, col 8); matched against the 32 valid codes.
  const fmtCells = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  let raw = 0;
  fmtCells.forEach(([r, c], i) => { if (dark[r][c]) raw |= 1 << (14 - i); });
  let fmt = -1;
  for (let data = 0; data < 32; data++) {
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    if ((((data << 10) | rem) ^ 0x5412) === raw) fmt = data;
  }
  if (fmt < 0) return null;
  const level = ['M', 'L', 'H', 'Q'][fmt >> 3], mask = fmt & 7;

  // Function patterns: finders with separators and format areas, timing,
  // alignment (version 2+), version blocks (7+).
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r0, c0, h, w) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < size && c < size) fn[r][c] = true; };
  mark(0, 0, 9, 9); mark(0, size - 8, 9, 8); mark(size - 8, 0, 8, 9);
  mark(6, 0, 1, size); mark(0, 6, size, 1);
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    const step = Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
    const at = [6];
    for (let p = size - 7; at.length < n; p -= step) at.splice(1, 0, p);
    at.forEach((r) => at.forEach((c) => {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) return;
      mark(r - 2, c - 2, 5, 5);
    }));
  }
  if (version >= 7) { mark(0, size - 11, 6, 3); mark(size - 11, 0, 3, 6); }

  const masks = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];
  // The data bits, in the standard's two-column zigzag from the bottom right.
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v++) {
      const r = upward ? size - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (fn[r][c]) continue;
        bits.push(dark[r][c] !== masks[mask](r, c));
      }
    }
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | (b ? 1 : 0), 0));

  // Blocks, per version and level: [count, data words] groups (Table 9).
  const BLOCKS = {
    L: [[[1, 19]], [[1, 34]], [[1, 55]], [[1, 80]], [[1, 108]], [[2, 68]], [[2, 78]], [[2, 97]], [[2, 116]], [[2, 68], [2, 69]]],
    M: [[[1, 16]], [[1, 28]], [[1, 44]], [[2, 32]], [[2, 43]], [[4, 27]], [[4, 31]], [[2, 38], [2, 39]], [[3, 36], [2, 37]], [[4, 43], [1, 44]]],
    Q: [[[1, 13]], [[1, 22]], [[2, 17]], [[2, 24]], [[2, 15], [2, 16]], [[4, 19]], [[2, 14], [4, 15]], [[4, 18], [2, 19]], [[4, 16], [4, 17]], [[6, 19], [2, 20]]],
    H: [[[1, 9]], [[1, 16]], [[2, 13]], [[4, 9]], [[2, 11], [2, 12]], [[4, 15]], [[4, 13], [1, 14]], [[4, 14], [2, 15]], [[4, 12], [4, 13]], [[6, 15], [2, 16]]]
  };
  const lens = BLOCKS[level][version - 1].flatMap(([n, k]) => Array(n).fill(k));
  const blocks = lens.map(() => []);
  let at = 0;
  for (let i = 0; i < Math.max(...lens); i++) lens.forEach((k, b) => { if (i < k) blocks[b].push(words[at++]); });
  const data = blocks.flat();

  // The segment: mode 0100 (byte), a count, the bytes, as UTF-8.
  let pos = 0;
  const take = (n) => { let v = 0; for (let i = 0; i < n; i++) { const w = data[(pos + i) >> 3]; v = (v << 1) | ((w >> (7 - ((pos + i) & 7))) & 1); } pos += n; return v; };
  if (take(4) !== 4) return null;
  const count = take(version <= 9 ? 8 : 16);
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) bytes[i] = take(8);
  return new TextDecoder().decode(bytes);
}
