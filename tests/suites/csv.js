// Spreadsheets: the CSV / TSV round-trip (plan 3.5, Review-Packs/Topo-proposal.md;
// js/csv.js). What is held here:
//   1. the encoding: RFC 4180 quoting, a BOM on the file, the separator
//      sniffed (tab, semicolon, comma), quoted line breaks, and the formula
//      guard (= + - @ get an apostrophe, a plain number does not) undone on
//      the way back in, so the round-trip loses nothing;
//   2. export: devices / interfaces / cables / findings, with the schema's csv
//      names as headers, and each sheet imported straight back changes
//      nothing at all;
//   3. the column mapping: guessed from headings (the schema's names and the
//      usual spellings), or from the values when there is no heading row;
//   4. matching: id, then MAC, then IP, then name; a key that names two
//      devices is a conflict, never a guess;
//   5. only mapped columns are applied, and a blank cell leaves its field;
//   6. a row is applied whole or not at all: an invalid value, or a field
//      another row sets differently, makes it a conflict;
//   7. unmatched rows add devices, cabled to switch:port (a port number read
//      out of "Gi1/0/5", the next free port when none is given, a taken
//      port a conflict), laid out under their switch without moving anything
//      already drawn, including a switch that is itself new in the sheet;
//   8. interfaces.csv rows of one unknown device id are one new device;
//   9. a cables sheet: medium changed by cable id, a new cable between two
//      devices on the map, devices and cables never mixed;
//  10. a bare address takes its network's prefix, or is refused;
//  11. the review counts and the findings delta, and Apply as one save and
//      one undo step, through the normalizer;
//  11b. a row found by a NIC's address or MAC edits that NIC; two new
//      switches naming each other are both made, with their one cable;
//      interfaces.csv after devices.csv finds ports by name; a port past a
//      faceplate is said; 1200 devices off one box review in seconds;
//  11c. the round trip (verifier findings, repair round 2): devices.csv
//      says which NIC a device's uplink is on (local_port) and the cable
//      lands there; interfaces.csv names every device and its type; a
//      port cables.csv names on a NIC-only device is a NIC it gains; a NIC
//      may carry more than one cable, a faceplate port may not; and every
//      template, exported and imported into a blank map in four orders,
//      comes back with the same devices, cables, ports and findings;
//  11d. the final review: subnets.csv (export, auto-mapped import, a
//      change inherited by every member, a CIDR never rewritten, an
//      inventory's VLAN or Network column not taken for one); a row found
//      by its address alone that names another device is a conflict, while
//      a new MAC alone or a new name alone is an edit; a first_port too long
//      for a scheme is refused, not cut into a change that wipes it;
//  12. the dialog: Export rows, Import paste → mapping → Review → Apply;
//      the sentences translated, the field names English; read-only refuses;
//      the reduced views have no menu entry for it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const nodeByName = (name) => state.nodes.find((n) => n.name === name);
  const sheetOf = (text, headings) => { const p = csvParse(text); return csvSheet(p, headings === undefined ? csvHasHeadingRow(p.rows) : headings); };
  const planOf = (text, mapping) => { const s = sheetOf(text); return csvPlan(s, mapping || csvAutoMap(s)); };
  const statuses = (plan) => plan.rows.map((r) => r.status).join(',');

  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }],
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 300, y: 40, nat: true, interfaces: [{ id: 'w', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 300, y: 160, portCount: 8, interfaces: [] },
      { id: 'pc1', type: 'pc', name: 'PC-1', x: 200, y: 300, os: 'Win 10', notes: 'desk', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24', mac: 'AA:BB:CC:00:00:01' }] },
      { id: 'pc2', type: 'pc', name: 'PC-2', x: 300, y: 300, os: 'Win 10', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24' }] },
      { id: 'twinA', type: 'printer', name: 'Printer', x: 400, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.21/24' }] },
      { id: 'twinB', type: 'printer', name: 'Printer', x: 500, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.22/24' }] }
    ],
    links: [
      { id: 'lr', source: 'rt', target: 'sw', sourceIface: 'w', targetIface: 'p8' },
      { id: 'l1', source: 'sw', target: 'pc1', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'l2', source: 'sw', target: 'pc2', sourceIface: 'p2', targetIface: 'i1' }
    ] });
  const open = () => { replaceDocument(lab(), { origin: 'file' }); initHistory(); };

  try {
    open();

    // ---- 1: encoding ----
    const guarded = csvText({ headers: ['v'], rows: [['=1+1'], ['+SUM(A1)'], ['-2+3'], ['@cmd'], ['-40'], ['3.5'], ["'=keep"], ['a,b'], ['say "hi"'], ['two\nlines']] });
    const lines = guarded.split('\r\n');
    ok('a formula gets an apostrophe', lines[1] === "'=1+1" && lines[2] === "'+SUM(A1)" && lines[3] === "'-2+3" && lines[4] === "'@cmd", lines.slice(1, 5).join(' | '));
    ok('a plain number does not', lines[5] === '-40' && lines[6] === '3.5');
    ok('a value already starting with an apostrophe is guarded again', lines[7] === "''=keep");
    ok('quotes as RFC 4180 has them', lines[8] === '"a,b"' && lines[9] === '"say ""hi"""' && guarded.includes('"two\nlines"'));
    const back = csvParse(guarded).rows.map((r) => r[0]);
    ok('and every value comes back exactly', JSON.stringify(back.slice(1)) === JSON.stringify(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '-40', '3.5', "'=keep", 'a,b', 'say "hi"', 'two\nlines']), JSON.stringify(back));
    ok('a BOM is dropped and CRLF read', JSON.stringify(csvParse('﻿a,b\r\n1,2\r\n').rows) === '[["a","b"],["1","2"]]');
    ok('a tab-separated paste is read as TSV', csvParse('a\tb,c\n1\t2').sep === '\t' && csvParse('a\tb,c\n1\t2').rows[0][1] === 'b,c');
    ok('a semicolon sheet is read as one', csvParse('a;b;c\n1;2,5;3').sep === ';' && csvParse('a;b;c\n1;2,5;3').rows[1][1] === '2,5');
    ok('empty rows are left out', csvParse('a\n\n,\n1\n').rows.length === 2);

    // ---- 2: export ----
    const dev = csvDevicesSheet();
    ok('devices.csv headers are the schema\'s csv names', dev.headers.slice(0, -7).join(',') === NODE_FIELDS.filter((f) => f.csv && f.key !== 'interfaces').map((f) => f.csv).join(',') && dev.headers.slice(-7).join(',') === 'interface_id,interface,ip,mac,switch,port,local_port', dev.headers.join(','));
    const pcRow = dev.rows.find((r) => r[0] === 'pc1');
    const col = (h) => dev.headers.indexOf(h);
    ok('a device row carries its first interface and where it is patched', pcRow[col('ip')] === '10.0.0.11/24' && pcRow[col('mac')] === 'AA:BB:CC:00:00:01' && pcRow[col('switch')] === 'SW-1' && pcRow[col('port')] === '1', pcRow.join(','));
    ok('NAT only on a routing device', dev.rows.find((r) => r[0] === 'rt')[col('nat')] === 'true' && pcRow[col('nat')] === '');
    const ifs = csvInterfacesSheet();
    ok('interfaces.csv is keyed by device id and interface id, with the type', ifs.headers.slice(0, 4).join(',') === 'device_id,device,type,interface_id' && ifs.rows.some((r) => r[0] === 'pc1' && r[2] === 'pc' && r[3] === 'i1') && ifs.rows.some((r) => r[0] === 'pc2' && r[3] === 'i1'));
    ok('and a device with no interface is a row of its own', ifs.rows.some((r) => r.join(',') === 'sw,SW-1,switch,,,,,,'), ifs.rows.filter((r) => r[0] === 'sw').map((r) => r.join(',')).join(' | '));
    const cab = csvCablesSheet();
    ok('cables.csv names both ends and their ports', cab.rows.some((r) => r.join(',') === 'l1,sw,SW-1,1,pc1,PC-1,eth0,,,,,,'), cab.rows.map((r) => r.join(',')).join(' | '));
    const fnd = csvFindingsSheet();
    // The last column is an accepted finding's reason (p2-report), empty while it is open.
    ok('findings.csv has one row per finding', fnd.rows.length === topologyFindings().length && fnd.headers.join(',') === 'severity,subject,check,finding,accepted');
    // Re-import each sheet as exported: nothing to do.
    [dev, ifs, cab].forEach((sh) => {
      const plan = planOf(csvText(sh));
      ok(`${sh.name}.csv imported back changes nothing`, plan.ops.length === 0 && plan.counts.conflict === 0 && plan.counts.same > 0, JSON.stringify(plan.counts) + ' ' + plan.rows.filter((r) => r.status !== 'same').map((r) => `${r.name}: ${r.why}`).join(' | '));
    });
    // The file: a BOM in front, named after the network.
    const RealBlob = window.Blob;
    let parts = null, fileName = '';
    window.Blob = function (p, o) { parts = p; return new RealBlob(p, o); };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { fileName = this.download; };
    try { downloadCsv('devices'); } finally { window.Blob = RealBlob; HTMLAnchorElement.prototype.click = realClick; }
    ok('the file is UTF-8 with a BOM', parts && parts[0].charCodeAt(0) === 0xFEFF && parts[0].slice(1).startsWith('id,type,name'));
    ok('and named after the network and the sheet', /-devices\.csv$/.test(fileName), fileName);
    // A name that is a formula goes out guarded and comes back as it was.
    getNode('pc2').name = '=HYPERLINK("http://x","y")';
    const evil = csvText(csvDevicesSheet());
    ok('a formula in a name is exported as text', evil.includes(`"'=HYPERLINK(""http://x"",""y"")"`), evil.split('\r\n').find((l) => l.startsWith('pc2')));
    ok('and reads back unchanged', planOf(evil).counts.change === 0);
    open();

    // ---- 3: mapping ----
    let s = sheetOf('Hostname,IP Address,MAC Address,Switch,Port,Ports,Whatever\nx,10.0.0.5,,SW-1,3,80,zz');
    ok('a heading row is recognised', s.hasHeadings && s.rows.length === 1);
    ok('headings map to fields by their usual spellings', csvAutoMap(s).join(',') === 'name,if:ip,if:mac,cab:switch,cab:port,ports,', csvAutoMap(s).join(','));
    s = sheetOf('10.0.0.5\tAA-BB-CC-00-00-09\tLobby\n10.0.0.6\tAA-BB-CC-00-00-0A\tHall');
    ok('no heading row: the values are data', !s.hasHeadings && s.rows.length === 2 && s.headers[0] === 'Column 1');
    ok('and addresses and MACs are recognised by their look', csvAutoMap(s).join(',') === 'if:ip,if:mac,', csvAutoMap(s).join(','));
    ok('a field is mapped once', csvAutoMap(sheetOf('name,hostname\na,b')).join(',') === 'name,');

    // ---- 4: matching ----
    let plan = planOf('id,mac,os\npc2,aa-bb-cc-00-00-01,X');
    ok('id comes before MAC', plan.rows[0].nodeId === 'pc2');
    plan = planOf('mac,ip,os\naabb.cc00.0001,10.0.0.12,X');
    ok('MAC (any spelling) before IP', plan.rows[0].nodeId === 'pc1');
    plan = planOf('ip,name,os\n10.0.0.12,PC-1,X');
    ok('IP before name', plan.rows[0].nodeId === 'pc2');
    plan = planOf('name,os\npc-1,X');
    ok('a name matches whatever its case', plan.rows[0].nodeId === 'pc1' && plan.rows[0].status === 'change');
    plan = planOf('name,os\nPrinter,X');
    ok('a name two devices share is a conflict', plan.rows[0].status === 'conflict' && /Matches 2 devices by Name/.test(plan.rows[0].why) && !plan.ops.length, plan.rows[0].why);
    plan = planOf('id,name,os\nnope,PC-2,Y');
    ok('an id nobody has falls through to the next key', plan.rows[0].nodeId === 'pc2');

    // ---- 5: only mapped columns; blank leaves ----
    plan = planOf('name,os,gateway,notes\nPC-1,Win 11,,');
    ok('only what the row says changes', plan.rows[0].changes.length === 1 && plan.rows[0].changes[0].field === 'Model / firmware', JSON.stringify(plan.rows[0].changes));
    s = sheetOf('name,os,notes\nPC-1,Win 11,new note');
    plan = csvPlan(s, ['name', 'os', '']);
    applyCsvPlan(plan);
    ok('an unmapped column is ignored', getNode('pc1').os === 'Win 11' && getNode('pc1').notes === 'desk' && getNode('pc1').gw === '');
    open();

    // ---- 6: whole rows ----
    plan = planOf('name,os,gateway\nPC-1,Win 11,10.0.0');
    ok('an invalid value makes the row a conflict', plan.rows[0].status === 'conflict' && /10\.0\.0 is not a valid Gateway/.test(plan.rows[0].why) && !plan.ops.length, plan.rows[0].why);
    plan = planOf('name,os\nPC-1,A\npc-1,B');
    ok('a field another row sets differently is a conflict', statuses(plan) === 'change,conflict' && /Another row sets Model \/ firmware to A/.test(plan.rows[1].why), plan.rows[1].why);
    plan = planOf('name,nat\nPC-1,yes');
    ok('NAT on a host is said and left', plan.rows[0].status === 'same' && /Only a routing device does NAT/.test(plan.rows[0].notes.join(' ')));

    // ---- 7: new devices, cabled ----
    const before = state.nodes.map((n) => `${n.id}@${n.x},${n.y}`).join(' ');
    plan = planOf('name,type,ip,switch,port\nCam-1,camera,10.0.0.31/24,SW-1,Gi1/0/5\nCam-2,camera,10.0.0.32/24,SW-1,\nCam-3,camera,10.0.0.33/24,SW-1,1\nCam-4,camera,10.0.0.34/24,SW-9,');
    ok('unmatched rows are added; a taken port and an unknown switch are conflicts', statuses(plan) === 'add,add,conflict,conflict', statuses(plan));
    ok('the conflicts say why', /Port 1 on SW-1 is taken/.test(plan.rows[2].why) && /No device called SW-9/.test(plan.rows[3].why), plan.rows[2].why + ' | ' + plan.rows[3].why);
    const linkOps = plan.ops.filter((o) => o.link).map((o) => o.link.sourceIface).join(',');
    ok('"Gi1/0/5" is port 5, and no port is the next free one', linkOps === 'p5,p3', linkOps);
    const delta = csvFindingsDelta(plan);
    ok('nothing is written before Apply', state.nodes.length === 6);
    const undoBefore = _undoStack.length;
    let saves = 0;
    const realSave = save;
    window.save = function () { if (!_batchDepth) saves++; return realSave.apply(this, arguments); };
    const res = applyCsvPlan(plan);
    window.save = realSave;
    ok('Apply adds them in one save and one undo step', res.added === 2 && state.nodes.length === 8 && saves === 1 && _undoStack.length === undoBefore + 1, `${res.added} ${state.nodes.length} ${saves} ${_undoStack.length - undoBefore}`);
    const cam1 = nodeByName('Cam-1');
    ok('cabled to the port asked for', state.links.some((l) => l.source === 'sw' && l.target === cam1.id && l.sourceIface === 'p5' && l.targetIface));
    ok('and holding only what the sheet said', cam1.type === 'camera' && cam1.interfaces[0].ip === '10.0.0.31/24' && cam1.gw === '' && cam1.os === '' && cam1.interfaces.slice(1).every((i) => !i.ip));
    ok('they are selected', selectedOf('node').length === 2);
    ok('nothing already drawn moved', state.nodes.filter((n) => before.includes(`${n.id}@`)).map((n) => `${n.id}@${n.x},${n.y}`).join(' ') === before);
    const sw = getNode('sw');
    ok('the new devices sit under their switch, below what hangs there', ['Cam-1', 'Cam-2'].every((nm) => nodeByName(nm).y > 300) && Math.abs(nodeByName('Cam-1').x - nodeByName('Cam-2').x) >= 100 && Math.abs((nodeByName('Cam-1').x + nodeByName('Cam-2').x) / 2 - sw.x) <= 60,
       ['Cam-1', 'Cam-2'].map((nm) => `${nodeByName(nm).x},${nodeByName(nm).y}`).join(' '));
    ok('the record is what a reload would read', JSON.stringify(normalizeLoadedNode(serializeNode(cam1))) === JSON.stringify(cam1));
    ok('the findings delta was computed', Array.isArray(delta));
    undo();
    ok('one undo takes the whole import back', state.nodes.length === 6 && !nodeByName('Cam-1') && state.links.length === 3);
    plan = planOf('name,switch,port\nPC-1,Core,\nPC-2,SW-1,2\nPrinter,,');
    ok('a device patched elsewhere is not given a second uplink', plan.rows[0].status === 'same' && /Already cabled to SW-1 on port 1/.test(plan.rows[0].notes.join(' ')) && !plan.ops.length, plan.rows[0].notes.join(' '));
    ok('nor is one already on that port told anything', plan.rows[1].status === 'same' && !plan.rows[1].notes.length);
    plan = planOf('id,switch,port\ntwinA,SW-1,\ntwinB,SW-1,');
    ok('an unpatched device on the map is cabled to the switch the sheet names', statuses(plan) === 'change,change' && plan.ops.filter((o) => o.link).map((o) => o.link.sourceIface).join(',') === 'p3,p4');
    // A switch that is itself new, listed after the devices on it.
    plan = planOf('name,type,switch,port\nTV-1,iot,SW-NEW,2\nTV-2,iot,SW-NEW,\nSW-NEW,switch,SW-1,7');
    ok('a new switch further down the sheet is still their switch', statuses(plan) === 'add,add,add', statuses(plan) + ' ' + plan.rows.map((r) => r.why).join('|'));
    applyCsvPlan(plan);
    const swNew = nodeByName('SW-NEW');
    ok('cabled to it', ['TV-1', 'TV-2'].every((nm) => state.links.some((l) => l.source === swNew.id && l.target === nodeByName(nm).id)) && state.links.some((l) => l.source === 'sw' && l.target === swNew.id && l.sourceIface === 'p7'));
    ok('and laid out under it, which sits under SW-1', nodeByName('TV-1').y > swNew.y && swNew.y > getNode('sw').y);
    open();
    plan = planOf('name\nLoose-1\nLoose-2');
    applyCsvPlan(plan);
    const right = Math.max(...lab().nodes.map((n) => n.x));
    ok('devices on nothing go beside the map', nodeByName('Loose-1').x > right && nodeByName('Loose-2').x > right, `${nodeByName('Loose-1').x} > ${right}`);
    open();
    plan = planOf('name,x,y\nPlaced,1000,1200');
    applyCsvPlan(plan);
    ok('a device given x and y keeps them', nodeByName('Placed').x === 1000 && nodeByName('Placed').y === 1200);
    open();
    plan = planOf('os\nWin 11');
    ok('a row with nothing to find or name a device by is a conflict', plan.rows[0].status === 'conflict' && /Nothing to find or name/.test(plan.rows[0].why));

    // ---- 8: interfaces.csv ----
    plan = planOf('device_id,device,interface_id,interface,ip\nsrv9,NAS,a,eno1,10.0.0.40/24\nsrv9,NAS,b,eno2,10.0.0.41/24\npc1,PC-1,i9,eth9,10.0.0.90/24');
    ok('two rows of one unknown device id are one new device', plan.counts.add === 1 && plan.counts.change === 1, JSON.stringify(plan.counts));
    applyCsvPlan(plan);
    const nas = getNode('srv9');
    ok('with exactly the interfaces the sheet lists', nas && nas.name === 'NAS' && nas.interfaces.map((i) => `${i.id}:${i.name}:${i.ip}`).join(' ') === 'a:eno1:10.0.0.40/24 b:eno2:10.0.0.41/24', nas && JSON.stringify(nas.interfaces));
    ok('and an interface id a device lacks is added to it', getNode('pc1').interfaces.some((i) => i.id === 'i9' && i.name === 'eth9' && i.ip === '10.0.0.90/24') && getNode('pc1').interfaces.length === 2);
    open();
    plan = planOf('device_id,interface_id,mac\npc1,i1,AA:BB:CC:00:00:0F');
    applyCsvPlan(plan);
    ok('a MAC on an existing interface is written in canonical form', getNode('pc1').interfaces[0].mac === 'AA:BB:CC:00:00:0F');
    open();

    // ---- 9: cables ----
    plan = planOf('cable_id,medium\nl1,fiber');
    ok('a cable sheet is matched by cable id', plan.kind === 'cables' && plan.rows[0].status === 'change');
    applyCsvPlan(plan);
    ok('and can change its medium', getLink('l1').medium === 'fiber');
    open();
    plan = planOf('from_device,from_port,to_device,to_port,medium\nSW-1,4,PC-2,,utp\nSW-1,1,Printer,,\nsw,6,twinA,,');
    ok('a new cable needs devices that are on the map and named once', statuses(plan) === 'same,conflict,add', statuses(plan) + ' ' + plan.rows.map((r) => r.why).join('|'));
    ok('a cable between two devices already joined is the one there', plan.rows[0].linkId === 'l2');
    ok('and a port it is not on is said, not obeyed', /Already cabled to SW-1 on port 2/.test(plan.rows[0].notes.join(' ')), plan.rows[0].notes.join(' '));
    ok('a name two devices share is refused', /names more than one device/.test(plan.rows[1].why));
    applyCsvPlan(plan);
    ok('the new cable is plugged into the port asked for', state.links.some((l) => l.source === 'sw' && l.target === 'twinA' && l.sourceIface === 'p6' && l.targetIface === 'i1'));
    open();
    s = sheetOf('cable_id,name\nl1,x');
    plan = csvPlan(s, ['lk:id', 'name']);
    ok('devices and cables are never mixed', plan.errors.length === 1 && !plan.ops.length);

    // ---- 10: a bare address ----
    plan = planOf('name,ip\nBare,10.0.0.77\nNowhere,172.31.9.9');
    ok('a bare address takes its network\'s prefix', plan.rows[0].status === 'add' && plan.ops.find((o) => o.create).create.interfaces.some((i) => i.ip === '10.0.0.77/24'));
    ok('one in no network is refused, not given a /24', plan.rows[1].status === 'conflict' && /needs its prefix/.test(plan.rows[1].why), plan.rows[1].why);

    // ---- 11: review and delta ----
    plan = planOf('name,os\nPC-1,Win 11\nPC-2,Win 10\nNew-1,');
    ok('counted as added, changed, unchanged', plan.counts.add === 1 && plan.counts.change === 1 && plan.counts.same === 1 && plan.counts.conflict === 0, JSON.stringify(plan.counts));
    plan = planOf('name,ip\nPC-1,10.0.0.12/24');
    ok('an address outranks a name: the row is the device holding it', plan.rows[0].nodeId === 'pc2');
    plan = planOf('id,ip\npc1,10.0.0.12/24');
    const d2 = csvFindingsDelta(plan);
    ok('the findings delta names the conflict it would make', d2.some((e) => e.key === 'ip-conflict' && e.diff > 0), JSON.stringify(d2));

    // ---- 11b: what a row is about (verifier findings, repair round 1) ----
    // A row found by its second NIC's address edits that NIC, not the first.
    const twoNic = () => replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'rt', type: 'router', name: 'rt', x: 0, y: 0, interfaces: [
        { id: 'a', name: 'eth0', ip: '10.0.0.1/24' }, { id: 'b', name: 'eth1', ip: '192.168.5.1/24', mac: 'AA:BB:CC:00:00:99' }] }], links: [] }, { origin: 'file' });
    twoNic();
    plan = planOf('ip,notes\n192.168.5.1,lab side');
    ok('a row found by a second NIC\'s address does not copy it onto the first', plan.rows[0].nodeId === 'rt' && !plan.ops.some((o) => o.iface) && plan.rows[0].changes.length === 1, JSON.stringify(plan.rows[0].changes));
    applyCsvPlan(plan);
    ok('so both addresses are still where they were', getNode('rt').interfaces.map((i) => i.ip).join(' ') === '10.0.0.1/24 192.168.5.1/24' && getNode('rt').notes === 'lab side');
    plan = planOf('mac,os\nAA:BB:CC:00:00:99,RouterOS');
    ok('nor a row found by its MAC', !plan.ops.some((o) => o.iface) && plan.rows[0].changes.every((c) => !/MAC/.test(c.field)), JSON.stringify(plan.rows[0].changes));
    plan = planOf('ip,mac\n192.168.5.1,AA:BB:CC:00:00:77');
    const nicOp = plan.ops.find((o) => o.iface);
    ok('a new MAC goes on the NIC holding the address the row gives', nicOp && nicOp.iface.id === 'b' && /eth1/.test(plan.rows[0].changes[0].field), JSON.stringify(plan.rows[0].changes));
    plan = planOf('mac,ip\nAA:BB:CC:00:00:99,10.0.0.1/24');
    ok('a MAC on one NIC and an address on another is a conflict, not a guess', plan.rows[0].status === 'conflict' && /different interfaces of rt/.test(plan.rows[0].why) && !plan.ops.length, plan.rows[0].why);

    // Two switches cabled to each other: devices.csv names each as the
    // other's switch, and a blank map takes both, with the one cable.
    replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'swa', type: 'switch', name: 'SW-A', x: 0, y: 0, portCount: 8, interfaces: [] },
      { id: 'swb', type: 'switch', name: 'SW-B', x: 200, y: 0, portCount: 8, interfaces: [] }],
      links: [{ id: 'lab', source: 'swa', target: 'swb', sourceIface: 'p8', targetIface: 'p8' }] }, { origin: 'file' });
    const pairCsv = csvText(csvDevicesSheet());
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    plan = planOf(pairCsv);
    ok('two new switches naming each other are both added', statuses(plan) === 'add,add', statuses(plan) + ' ' + plan.rows.map((r) => r.why).join('|'));
    applyCsvPlan(plan);
    const pairLinks = state.links.filter((l) => [l.source, l.target].sort().join() === 'swa,swb');
    ok('joined by one cable, on port 8 at both ends', pairLinks.length === 1 && state.links.length === 1 && pairLinks[0].sourceIface === 'p8' && pairLinks[0].targetIface === 'p8', JSON.stringify(state.links));

    // devices.csv then interfaces.csv into another map: one eth0 each.
    open();
    const devCsv = csvText(csvDevicesSheet()), ifCsv = csvText(csvInterfacesSheet());
    const ifCount = Object.fromEntries(state.nodes.map((n) => [n.id, (n.interfaces || []).length]));
    replaceDocument({ v: DOC_VERSION, networks: lab().networks, nodes: [], links: [] }, { origin: 'file' });
    applyCsvPlan(planOf(devCsv));
    plan = planOf(ifCsv);
    ok('interfaces.csv after devices.csv finds each port by its name', plan.counts.change === 0 && plan.counts.conflict === 0 && !plan.ops.length, JSON.stringify(plan.counts) + ' ' + plan.rows.filter((r) => r.status !== 'same').map((r) => `${r.name}: ${JSON.stringify(r.changes)}`).join(' | '));
    applyCsvPlan(plan);
    ok('so no device grows a second eth0', state.nodes.every((n) => (n.interfaces || []).length === ifCount[n.id]), state.nodes.map((n) => `${n.id}:${(n.interfaces || []).length}`).join(' '));

    // No port given: past the faceplate is said, as Add devices says it.
    open();
    plan = planOf('name,switch\nc1,SW-1\nc2,SW-1\nc3,SW-1\nc4,SW-1\nc5,SW-1\nc6,SW-1');
    const ports = plan.ops.filter((o) => o.link).map((o) => o.link.sourceIface).join(',');
    ok('the next free ports, then past the faceplate', ports === 'p3,p4,p5,p6,p7,p9', ports);
    ok('and the row past it says so', /8 ports: port 9 is past its faceplate/.test(plan.rows[5].notes.join(' ')) && plan.rows.slice(0, 5).every((r) => !r.notes.length), plan.rows[5].notes.join(' '));
    plan = planOf('name,switch,port\nc9,SW-1,12');
    ok('a port the sheet gives past it too', /port 12 is past its faceplate/.test(plan.rows[0].notes.join(' ')));

    // A thousand devices off one box with no faceplate: Review stays quick.
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    let big = 'name,switch\nBIGSW,\n';
    for (let i = 0; i < 1200; i++) big += `h${i},BIGSW\n`;
    const t0 = performance.now();
    plan = planOf(big);
    csvFindingsDelta(plan);
    const took = performance.now() - t0;
    ok('1200 devices on one custom box plan and diff in seconds, not minutes', plan.counts.add === 1201 && took < 8000, `${Math.round(took)} ms`);
    open();

    // ---- 11c: the round trip (verifier findings, repair round 2) ----
    const wanLan = () => replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'isp', type: 'cloud', name: 'ISP', x: 0, y: 0, interfaces: [{ id: 'c1', name: 'eth0', ip: '203.0.113.1/30' }] },
      { id: 'R', type: 'router', name: 'R', x: 0, y: 120, interfaces: [{ id: 'w', name: 'eth0', ip: '203.0.113.2/30' }, { id: 'l', name: 'eth1', ip: '192.168.1.1/24' }] },
      { id: 'SW', type: 'switch', name: 'SW', x: 0, y: 240, portCount: 8, interfaces: [] }],
      links: [{ id: 'k1', source: 'isp', target: 'R', sourceIface: 'c1', targetIface: 'w' }, { id: 'k2', source: 'R', target: 'SW', sourceIface: 'l', targetIface: 'p1' }] }, { origin: 'file' });
    const blank = () => replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    const importAll = (texts) => { const why = []; texts.forEach((txt) => { const pl = planOf(txt); pl.rows.filter((r) => r.status === 'conflict').forEach((r) => why.push(`${r.name}: ${r.why}`)); applyCsvPlan(pl); }); return why; };
    // Every cable as its two ends, by device id and port as the map labels
    // it. A cable to a VM or container that the template left without an
    // attachment is read as bridged: the import makes such a cable as the
    // editor does when one is drawn, and the findings read both the same.
    const cableSig = () => state.links.map((l) => {
      const end = (id, ifc) => { const n = getNode(id); const f = (n.interfaces || []).find((i) => i.id === ifc); return `${id}:${ifc ? (f ? f.name : ifaceLabel(n, ifc)) : '-'}`; };
      const virt = isVirtualType(getNode(l.source).type) || isVirtualType(getNode(l.target).type);
      return [end(l.source, l.sourceIface), end(l.target, l.targetIface)].sort().join('~') + '/' + (l.attachment || (virt ? 'bridged' : ''));
    }).sort().join(' ');
    wanLan();
    const rDev = csvDevicesSheet();
    const rRow = rDev.rows.find((r) => r[0] === 'R'), rc = (h) => rRow[rDev.headers.indexOf(h)];
    ok('a router\'s devices.csv row is its LAN side, with its own port', rc('interface') === 'eth1' && rc('ip') === '192.168.1.1/24' && rc('switch') === 'SW' && rc('port') === '1' && rc('local_port') === 'eth1', rRow.join(','));
    const wl = { D: csvText(rDev), I: csvText(csvInterfacesSheet()), C: csvText(csvCablesSheet()) };
    const wlWant = cableSig();
    blank();
    let why = importAll([wl.D]);
    ok('devices.csv into a blank map puts the switch cable on the router\'s LAN NIC', !why.length && cableSig() === 'R:eth1~SW:1/', cableSig() + ' ' + why.join(' | '));
    why = importAll([wl.I, wl.C]);
    ok('and interfaces.csv then cables.csv add the WAN side: both cables, on their ports', !why.length && state.links.length === 2 && cableSig() === wlWant, cableSig() + ' ' + why.join(' | '));
    blank();
    why = importAll([wl.D, wl.C]);
    plan = planOf(wl.C);
    ok('cables.csv straight after devices.csv gives the router the WAN NIC it names', !why.length && cableSig() === wlWant && getNode('R').interfaces.map((i) => i.name).sort().join() === 'eth0,eth1', cableSig() + ' ' + why.join(' | '));
    blank();
    why = importAll([wl.I, wl.C]);
    ok('interfaces.csv names the switch with no interface, as a switch, so cables.csv after it has both ends', !why.length && getNode('SW') && getNode('SW').type === 'switch' && cableSig() === wlWant, cableSig() + ' ' + why.join(' | '));

    // A sheet written by hand: the row's NIC is where its cable goes.
    blank();
    plan = planOf('name,type,interface,ip,switch,port\nCORE,switch,,,,\nEdge,router,eth1,192.168.1.1/24,CORE,3');
    applyCsvPlan(plan);
    const edge = nodeByName('Edge'), edgeLink = state.links[0];
    ok('a hand-made row\'s cable lands on the NIC the row names', edge && edgeLink && ifaceIdOn(edgeLink, edge.id) === edge.interfaces.find((i) => i.name === 'eth1').id && ifaceIdOn(edgeLink, nodeByName('CORE').id) === 'p3', JSON.stringify(state.links));
    plan = planOf('name,switch,port,local_port\nEdge,CORE,3,eth7');
    ok('a local port the device does not have is a conflict', plan.rows[0].status === 'conflict' && /Edge has no port eth7/.test(plan.rows[0].why), plan.rows[0].status + ' ' + plan.rows[0].why);
    blank();
    plan = planOf('name,type,interface,ip,switch,port,local_port\nCORE,switch,,,,,\nEdge,router,eth1,192.168.1.1/24,CORE,3,eth7');
    ok('a new device\'s local port that is none of its NICs is a conflict', plan.rows[1].status === 'conflict' && /Edge has no port eth7/.test(plan.rows[1].why), plan.rows[1].why);

    // cables.csv: a new NIC is shown; a NIC may carry two cables, a faceplate port not.
    wanLan();
    plan = planOf('cable_id,from_device,from_port,to_device,to_port\nk5,R,eth2,SW,2');
    ok('a port a router lacks is a NIC it gains, shown in the review', plan.rows[0].status === 'add' && plan.rows[0].changes.some((c) => c.field === 'Interface' && c.after === 'R eth2') && plan.ops.some((o) => o.iface && o.iface.create && o.iface.name === 'eth2'), JSON.stringify(plan.rows[0].changes));
    applyCsvPlan(plan);
    ok('and the cable is on it', state.links.some((l) => l.source === 'R' && l.target === 'SW' && getNode('R').interfaces.find((i) => i.id === l.sourceIface).name === 'eth2' && l.targetIface === 'p2'));
    wanLan();
    plan = planOf('cable_id,from_device,from_port,to_device,to_port\nk7,R,eth1,SW,3\nk8,SW,1,R,eth0');
    ok('a router NIC may carry a second cable; a taken faceplate port may not', statuses(plan) === 'add,conflict' && /Port 1 on SW is taken/.test(plan.rows[1].why) && !plan.rows[0].notes.length, statuses(plan) + ' ' + plan.rows.map((r) => r.why + r.notes.join(' ')).join(' | '));
    replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'h', type: 'server', name: 'H', x: 0, y: 0, interfaces: [{ id: 'e', name: 'eth0', ip: '10.0.0.5/24' }] },
      { id: 'a', type: 'pc', name: 'A', x: 0, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.6/24' }] },
      { id: 'b', type: 'pc', name: 'B', x: 100, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.7/24' }] }],
      links: [{ id: 'x1', source: 'h', target: 'a', sourceIface: 'e', targetIface: 'i1' }] }, { origin: 'file' });
    plan = planOf('from_device,from_port,to_device,to_port\nH,eth0,B,eth0');
    ok('a host NIC with a cable already takes the sheet\'s second one, and says so', plan.rows[0].status === 'add' && /eth0 on H carries another cable too/.test(plan.rows[0].notes.join(' ')), plan.rows[0].status + ' ' + plan.rows[0].why + plan.rows[0].notes.join(' '));
    // Two cables between one pair: a cable id the map lacks, on other ports, is the second.
    replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, interfaces: [] },
      { id: 'nas', type: 'server', name: 'NAS', x: 0, y: 100, interfaces: [{ id: 'n1', name: 'eth0', ip: '' }, { id: 'n2', name: 'eth1', ip: '' }] }],
      links: [{ id: 'q1', source: 'sw', target: 'nas', sourceIface: 'p2', targetIface: 'n1' }] }, { origin: 'file' });
    plan = planOf('cable_id,from_device,from_port,to_device,to_port\nq9,sw,3,nas,eth1\n,sw,4,nas,eth0');
    ok('a second cable between one pair is added; a row with no id on other ports is the one there', statuses(plan) === 'add,same' && plan.rows[1].linkId === 'q1' && /Already cabled/.test(plan.rows[1].notes.join(' ')), statuses(plan) + ' ' + plan.rows.map((r) => r.why).join('|'));
    plan = planOf('cable_id,attachment\nq1,passthrough\nq1,bridged');
    ok('an attachment is read from cables.csv, and two rows that disagree conflict', statuses(plan) === 'change,conflict', statuses(plan));

    // Every template, both ways round: the same devices, cables, ports and findings.
    const fkeys = () => topologyFindings().map((f) => `${f.check}|${f.subject}|${f.detail}`).sort().join('\n');
    const orders = ['DIC', 'IDC', 'DCI', 'ICD'];
    const bad = Object.fromEntries(orders.map((o) => [o, []]));
    Object.keys(templatesData).forEach((key) => {
      loadDocState(cloneData(templatesData[key])); autoBindLinks();
      const want = { nodes: state.nodes.map((n) => `${n.id}:${n.type}`).sort().join(), cables: cableSig(), findings: fkeys() };
      const sheets = { D: csvText(csvDevicesSheet()), I: csvText(csvInterfacesSheet()), C: csvText(csvCablesSheet()) };
      orders.forEach((order) => {
        blank();
        const conflicts = importAll([...order].map((k) => sheets[k]));
        const got = { nodes: state.nodes.map((n) => `${n.id}:${n.type}`).sort().join(), cables: cableSig(), findings: fkeys() };
        const diff = ['nodes', 'cables', 'findings'].filter((k) => got[k] !== want[k]);
        if (conflicts.length || diff.length) bad[order].push(`${key}: ${diff.join('+')} ${conflicts.slice(0, 2).join(' | ')}`);
      });
    });
    const orderName = { DIC: 'devices, interfaces, cables', IDC: 'interfaces, devices, cables', DCI: 'devices, cables, interfaces', ICD: 'interfaces, cables, devices' };
    orders.forEach((o) => ok(`every template round-trips through a blank map (${orderName[o]})`, !bad[o].length, bad[o].join(' ; ')));

    // With subnets.csv, before the rest or after it, nothing is lost: the
    // networks, every device's every field and the gateway and DNS each one
    // uses (most of them inherited from a network, so blank in devices.csv).
    // The final review's HIGH: compared only ids, cables and findings, the
    // test above passed while every network and every inherited gateway went.
    const netSig = () => JSON.stringify((serializeNetworks(state.networks) || []).slice().sort((a, b) => compareCidr(a.cidr, b.cidr)));
    const devSig = () => state.nodes.map((n) => JSON.stringify(serializeNode(n))).sort().join('\n');
    const effSig = () => state.nodes.map((n) => `${n.id}:${effectiveGw(n)}|${effectiveDns(n)}`).sort().join(' ');
    const full = { SDIC: [], DICS: [] };
    Object.keys(templatesData).forEach((key) => {
      loadDocState(cloneData(templatesData[key])); autoBindLinks();
      const want = { nodes: devSig(), cables: cableSig(), findings: fkeys(), nets: netSig(), eff: effSig() };
      const sheets = { S: csvText(csvSubnetsSheet()), D: csvText(csvDevicesSheet()), I: csvText(csvInterfacesSheet()), C: csvText(csvCablesSheet()) };
      Object.keys(full).forEach((order) => {
        blank();
        const conflicts = importAll([...order].map((k) => sheets[k]));
        const got = { nodes: devSig(), cables: cableSig(), findings: fkeys(), nets: netSig(), eff: effSig() };
        const diff = Object.keys(want).filter((k) => got[k] !== want[k]);
        if (conflicts.length || diff.length) {
          const k0 = diff[0];
          const sep = k0 === 'nodes' || k0 === 'findings' ? '\n' : ' ';
          const a = k0 ? want[k0].split(sep) : [], b = k0 ? got[k0].split(sep) : [];
          const i = a.findIndex((x, j) => x !== b[j]);
          full[order].push(`${key}: ${diff.join('+')} ${k0 ? `${a[i]} ≠ ${b[i]}`.slice(0, 300) : ''} ${conflicts.slice(0, 2).join(' | ')}`);
        }
      });
    });
    ok('every template with its subnets round-trips whole: networks, every field, inherited gateway and DNS (subnets first)', !full.SDIC.length, full.SDIC.slice(0, 2).join(' ; '));
    ok('and with subnets.csv imported last', !full.DICS.length, full.DICS.slice(0, 2).join(' ; '));
    open();

    // ---- 11d: the final review ----
    open();
    const subnets = csvSubnetsSheet();
    ok('subnets.csv: every network field under its csv name', subnets.headers.join() === 'network_id,cidr,name,vlan,purpose,gateway,dns,dhcp,draw_zone'
       && subnets.rows.length === 1 && subnets.rows[0].join() === 'n10,10.0.0.0/24,Office,,,10.0.0.1,,false,', subnets.rows.map((r) => r.join()).join(' | '));
    plan = planOf(csvText(subnets));
    ok('imported over the map it changes nothing', plan.kind === 'subnets' && !plan.ops.length && statuses(plan) === 'same', plan.kind + ' ' + statuses(plan));
    let sub = sheetOf('cidr,name,gateway,vlan\n10.0.5.0/24,Voice,10.0.5.1,20');
    ok('a sheet with a cidr column maps its columns to the subnet, name and gateway included', csvAutoMap(sub).join() === 'net:cidr,net:name,net:gateway,net:vlan', csvAutoMap(sub).join());
    plan = csvPlan(sub, csvAutoMap(sub));
    let steps = _undoStack.length;
    applyCsvPlan(plan);
    const voice = state.networks.find((n) => n.cidr === '10.0.5.0/24');
    ok('a new subnet is declared, in one undo step', statuses(plan) === 'add' && !!voice && voice.name === 'Voice' && voice.vlan === 20 && voice.gateway === '10.0.5.1'
       && _undoStack.length === steps + 1, JSON.stringify(voice));
    plan = planOf('network_id,dns\nn10,10.0.0.53');
    applyCsvPlan(plan);
    ok('a change to a subnet reaches every device inheriting from it', statuses(plan) === 'change' && effectiveDns(getNode('pc2')) === '10.0.0.53' && getNode('pc2').dns === '',
       statuses(plan) + ' ' + effectiveDns(getNode('pc2')));
    plan = planOf('network_id,cidr\nn10,10.9.9.0/24');
    ok('a subnet found by its id is never moved to another range: that is Renumber', statuses(plan) === 'conflict' && /Renumber/.test(plan.rows[0].why) && !plan.ops.length, plan.rows[0].why);
    plan = planOf('network_id,name\nzz,Lab');
    ok('a new subnet needs its CIDR', statuses(plan) === 'conflict' && /needs its CIDR/.test(plan.rows[0].why), plan.rows[0].why);
    sub = sheetOf('cidr,name\n10.0.6.0/24,Lab');
    plan = csvPlan(sub, ['net:cidr', 'name']);
    ok('subnet and device columns are never mixed', plan.errors.length === 1 && /A sheet of subnets/.test(plan.errors[0]) && csvSheetKind(['net:cidr', 'name']) === 'mixed-subnets');
    sub = sheetOf('Hostname,IP Address,VLAN,Network\nPC-9,10.0.0.99,10,Office');
    ok('an inventory\'s VLAN and Network columns do not make it a sheet of subnets', csvSheetKind(csvAutoMap(sub)) === 'devices' && !csvAutoMap(sub).some((k) => /^net:/.test(k)),
       csvAutoMap(sub).join());

    // Found by its address alone, a row naming another device is a conflict.
    open();
    plan = planOf('Hostname,Type,IP Address,MAC Address\nNAS-02,server,10.0.0.11/24,00:11:32:AA:BB:02');
    ok('a row found by IP only, with another name, type and MAC, is a conflict, not PC-1 turned into NAS-02',
       statuses(plan) === 'conflict' && /Found PC-1 by IP only/.test(plan.rows[0].why) && !plan.ops.length, statuses(plan) + ' ' + plan.rows[0].why);
    plan = planOf('Hostname,IP Address\nReception PC,10.0.0.11');
    ok('a new name alone is a rename', statuses(plan) === 'change' && plan.rows[0].changes.some((c) => c.after === 'Reception PC'), statuses(plan));
    plan = planOf('ip,mac\n10.0.0.11,AA:BB:CC:00:00:09');
    ok('and a new MAC alone is a NIC swapped', statuses(plan) === 'change', statuses(plan) + ' ' + plan.rows[0].why);

    // A first_port the scheme cannot hold is refused, not cut into "no scheme".
    getNode('sw').portScheme = { prefix: 'Gi1/0/', start: 1 }; save();
    plan = planOf('name,type,first_port\nSW-1,switch,' + 'x'.repeat(31) + '1abc/1');
    ok('a first_port prefix longer than 32 characters is a conflict, not a change that clears the scheme',
       plan.counts.conflict === 1 && plan.counts.change === 0 && !plan.ops.length, JSON.stringify(plan.counts) + ' ' + JSON.stringify(plan.rows[0].changes));
    plan = planOf('name,type,first_port\nSW-1,switch,Te1/0/1');
    ok('one it can hold is still a change', plan.counts.change === 1 && plan.rows[0].changes[0].after === 'Te1/0/1', JSON.stringify(plan.rows[0].changes));

    // ---- 12: the dialog ----
    open();
    el('csvMenuBtn').click();
    const dlgOpen = () => !el('csvDialog').hidden;
    ok('the Export menu opens it', dlgOpen() && CarinoUI.modal.isOpen(el('csvDialog')));
    // Devices, interfaces, cables, ports (p3-ports: tests/suites/ports.js), subnets, groups
    // (tests/suites/groupsheets.js) and findings.
    ok('seven sheets, each a CSV button and Copy as TSV', el('csvExportRows').querySelectorAll('[data-csv-download]').length === 7 && el('csvExportRows').querySelectorAll('[data-csv-copy]').length === 7
       && !el('csvExportRows').querySelector('.sm'));
    el('csvTabs').querySelector('[data-csvtab="import"]').click();
    ok('Import is a tab', !el('csvPane-import').classList.contains('hidden') && el('csvPane-export').classList.contains('hidden'));
    ok('Review waits for a sheet', el('csvReviewBtn').disabled);
    el('csvText').value = 'Hostname,IP Address,Switch\nPC-1,10.0.0.11,\nKiosk,10.0.0.50,SW-1';
    csvReparse(); renderCsvDialog();
    ok('each column gets a field to pick', el('csvMap').querySelectorAll('select').length === 3 && el('csvCol-0').value === 'name' && el('csvCol-1').value === 'if:ip' && el('csvCol-2').value === 'cab:switch');
    ok('the field names stay English', /IP \/ CIDR/.test(el('csvCol-1').selectedOptions[0].textContent));
    el('csvCol-2').value = 'name';
    el('csvCol-2').dispatchEvent(new Event('change', { bubbles: true }));
    ok('picking a field taken by another column frees that one', el('csvCol-0').value === '' && el('csvCol-2').value === 'name');
    el('csvCol-0').value = 'name'; el('csvCol-0').dispatchEvent(new Event('change', { bubbles: true }));
    el('csvCol-2').value = 'cab:switch'; el('csvCol-2').dispatchEvent(new Event('change', { bubbles: true }));
    el('csvReviewBtn').click();
    ok('Review lists every row', !el('csvReview').classList.contains('hidden') && el('csvPreview').querySelectorAll('tr').length === 2
       && /1\s*To add/.test(el('csvCounts').textContent) && /1\s*Unchanged/.test(el('csvCounts').textContent), el('csvCounts').textContent);
    ok('and says it is from the sheet\'s own row', /Row 3/.test(el('csvPreview').textContent));
    const undoAt = _undoStack.length;
    el('csvApplyBtn').click();
    ok('Apply closes it and adds the device, as one step', !dlgOpen() && !!nodeByName('Kiosk') && _undoStack.length === undoAt + 1);
    ok('cabled to the switch', state.links.some((l) => l.source === 'sw' && l.target === nodeByName('Kiosk').id));
    // Words.
    setLocale('es'); applyLocale();
    el('csvMenuBtn').click();
    ok('the sentences are translated', el('csvTitle').textContent === 'Hoja de cálculo' && el('csvExportRows').textContent.includes('Copiar como TSV') && el('csvMenuBtn').textContent.includes('Hoja de cálculo'), el('csvTitle').textContent);
    closeCsvDialog();
    plan = planOf('name,os\nPrinter,X');
    ok('and so are the reasons', /Coincide con 2 dispositivos/.test(plan.rows[0].why), plan.rows[0].why);
    setLocale('en'); applyLocale();
    // Read-only.
    replaceDocument(Object.assign(lab(), { v: DOC_VERSION + 1 }), { origin: 'file' });
    ok('a read-only document takes no import', applyCsvPlan(planOf('name\nNew')).added === 0 && state.nodes.length === 6);
    open();
    // The reduced views.
    state.settings.advanced = false; applyProfile();
    ok('a reduced view has no Spreadsheet entry', getComputedStyle(el('csvMenuBtn')).display === 'none');
    state.settings.advanced = true; applyProfile();
    ok('the full editor has', getComputedStyle(el('csvMenuBtn')).display !== 'none');
    select(null, null);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
