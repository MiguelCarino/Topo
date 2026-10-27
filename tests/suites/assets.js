// The Asset group and what hangs off it (plan section 4, js/assets.js):
//   1. the schema: serial, assetTag, location, status on a device and
//      link.cable { label, length, color, via }, all omitted when empty, read
//      and written through the schema (a wrong status or a junk key in a cable
//      is dropped), the document stamped v4, a v3 one opened without change;
//   2. a retired device: dimmed on the map, never reached and never walked
//      through, its own checks "not checked", no badge, and its address
//      handed back (no IP conflict with the device that took it, never the
//      gateway or DNS server ahead of its replacement, free to hand out);
//   3. labels: a cable's label drawn on the map; one cable label on two runs
//      and one asset tag on two devices are advisory findings;
//   4. the side panel: the Asset group's fields fill, edit (one undo step per
//      field) and empty to no key, the status note and the group's summary,
//      its open state remembered, the group gone in a reduced view; a cable's
//      facts in its panel;
//   5. the table, the CSV, the bulk panel and the search box all know the new
//      fields (a sheet exported and imported again changes nothing);
//   6. the notes lint: what it flags and what it leaves alone, the share and
//      report dialogs naming the device and never the secret;
//   7. '#asset/<tag>': the open network, a kept card (opened, the device
//      selected and centred), several cards (asked, by name), none (a message
//      that names no network); the tag leaves the address bar;
//   8. Print labels: a QR code drawn here for each tagged device, a cable's
//      label twice, an untagged device left out and counted, nothing fetched;
//   9. the report's inventory and connections, and the strings in Spanish.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const gone = (id) => getComputedStyle(el(id)).display === 'none' || el(id).offsetParent === null;
  const undoBtn = () => el('undoBtn');
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  const typeInto = (input, text) => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const asked = [];
  const heldResponder = setDialogResponder((req) => {
    asked.push(req);
    if (req.kind === 'confirm') return true;
    if (req.kind === 'choice') return req.choices.length ? req.choices[req.choices.length - 1].id : null;
    return undefined;
  });
  const heldStore = loadLibrary();
  persistLibrary({});
  const heldOpen = window.open;

  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n1', cidr: '10.0.0.0/24', gateway: '10.0.0.1' }],
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 120, portCount: 8, interfaces: [] },
      { id: 'pc1', type: 'pc', name: 'PC-1', x: -100, y: 240, assetTag: 'CS-0042', serial: 'SN123', location: 'Room 2 · rack A · U12', status: 'active',
        notes: 'Reception desk', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24', mac: '3C:07:54:11:22:33' }] },
      { id: 'pc2', type: 'pc', name: 'PC-2', x: 100, y: 240, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] }
    ],
    links: [
      { id: 'l0', source: 'rt', target: 'sw', sourceIface: 'e0', targetIface: 'p8', cable: { label: 'UP-1', length: '2 m', color: 'blue', via: 'PP-A:1' } },
      { id: 'l1', source: 'sw', target: 'pc1', sourceIface: 'p1', targetIface: 'i1', cable: { label: 'WS-3B' } },
      { id: 'l2', source: 'sw', target: 'pc2', sourceIface: 'p2', targetIface: 'i1' }
    ]
  });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); };
  // As written: JSON leaves out a key whose value is undefined.
  const saved = () => JSON.parse(JSON.stringify(serializeDoc()));

  try {
    // ---- 1. The schema ----
    open();
    const doc = saved();
    // v4 was the asset fields; v5 (accepted findings, p2-report) is a key, not a shape.
    ok('the document is stamped with the current version, v4 or later', doc.v === DOC_VERSION && DOC_VERSION >= 4, String(doc.v));
    const pc1 = doc.nodes.find((n) => n.id === 'pc1');
    ok('a device keeps its serial, asset tag, location and status', pc1.serial === 'SN123' && pc1.assetTag === 'CS-0042'
       && pc1.location === 'Room 2 · rack A · U12' && pc1.status === 'active', JSON.stringify(pc1));
    const pc2 = doc.nodes.find((n) => n.id === 'pc2');
    ok('a device that never used them carries no key for them', !['serial', 'assetTag', 'location', 'status'].some((k) => k in pc2), Object.keys(pc2).join(','));
    ok('a cable keeps its facts in link.cable', JSON.stringify(doc.links[0].cable) === JSON.stringify({ label: 'UP-1', length: '2 m', color: 'blue', via: 'PP-A:1' }),
       JSON.stringify(doc.links[0].cable));
    ok('a cable with none has no cable key', !('cable' in doc.links[2]));
    open({ v: DOC_VERSION, nodes: [
      { id: 'a', type: 'pc', name: 'A', x: 0, y: 0, status: 'Retired', serial: 42, assetTag: '   ', interfaces: [] },
      { id: 'b', type: 'pc', name: 'B', x: 0, y: 0, status: 'broken', interfaces: [] }
    ], links: [{ id: 'x', source: 'a', target: 'b', cable: { label: 'L', secret: 'nope', length: '' } }, { id: 'y', source: 'a', target: 'b', cable: 'junk' }] });
    const odd = saved();
    ok('a status is read in any case and a word that is not one is dropped', odd.nodes[0].status === 'retired' && !('status' in odd.nodes[1]), JSON.stringify(odd.nodes));
    ok('a number in the serial is its digits, a blank tag is no tag', odd.nodes[0].serial === '42' && !('assetTag' in odd.nodes[0]));
    ok('a key the cable table does not name is dropped, and so is an empty fact', JSON.stringify(odd.links[0].cable) === '{"label":"L"}', JSON.stringify(odd.links[0].cable));
    ok('a cable that is not an object is no cable', !('cable' in odd.links[1]));
    const v3 = { v: 3, nodes: [{ id: 'z', type: 'pc', name: 'Z', x: 0, y: 0, interfaces: [] }], links: [] };
    const m = migrateDoc(v3);
    ok('a v3 document opens at the current version with nothing else changed', m.doc.v === DOC_VERSION && !m.newer && JSON.stringify(m.doc.nodes) === JSON.stringify(v3.nodes));
    ok('a v4 document is not read by a v3 build (it would drop the new fields): the version moved', MIGRATIONS.some((s) => s.from === 3 && s.to === 4));

    // ---- 2. A retired device ----
    open();
    const reaches = (a, b) => calculateReachability(a, { port: '' }).reachableNodes.has(b);
    ok('in service, PC-1 reaches PC-2 and the router', reaches('pc1', 'pc2') && reaches('pc1', 'rt'));
    getNode('pc2').status = 'retired'; save(); renderCanvasOnly();
    ok('a retired device is never reached', !reaches('pc1', 'pc2') && !reaches('rt', 'pc2'));
    ok('and reaches nothing itself', calculateReachability('pc2', { port: '' }).reachableNodes.size === 1);
    ok('it is dimmed on the map, by an attribute the export keeps', el('ui-node-pc2').getAttribute('opacity') === '0.4' && el('ui-node-pc1').getAttribute('opacity') === null);
    const checks2 = nodeChecks(getNode('pc2'));
    ok('its checks say it is not checked', checks2.every((c) => c.level === 'info' && /Retired/.test(c.text)), checks2.map((c) => c.level).join(','));
    getNode('pc2').interfaces[0].ip = '10.0.0.10/24'; save(); renderCanvasOnly();
    ok('its address is handed back: the device that took it is no IP conflict', !topologyFindings().some((f) => f.key === 'ip-conflict'));
    getNode('pc2').status = 'active'; save();
    ok('in service again, the same address is a conflict', topologyFindings().some((f) => f.key === 'ip-conflict'));
    getNode('pc2').interfaces[0].ip = '10.0.0.11/24';
    getNode('sw').status = 'retired'; save(); renderCanvasOnly();
    ok('a retired switch forwards nothing', !reaches('pc1', 'rt') && !reaches('pc1', 'pc2'));
    ok('so a device behind it cannot reach its gateway, and the findings say so', topologyFindings().some((f) => f.key === 'gateway' && f.nodeIds.includes('pc1')));
    getNode('rt').status = 'retired'; delete getNode('sw').status; save();
    ok('a retired router is nobody\'s gateway', !reaches('pc1', 'rt') && topologyFindings().some((f) => f.key === 'gateway' && f.nodeIds.includes('pc1')));
    ok('and a retired device has no badge', nodeDiagnosis(getNode('rt')).severity === null && !el('ui-node-rt').querySelector('circle[fill="#dc2626"]'));
    // The replacement: the old router stays in the register, retired, and a
    // new one takes its address. The old one comes first in the document (it
    // was drawn first), which must not make it the gateway or the resolver.
    const swap = lab();
    swap.nodes.unshift({ id: 'old', type: 'router', name: 'OldRouter', x: 200, y: 0, status: 'retired',
      interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24' }] });
    swap.nodes.find((n) => n.id === 'pc1').dns = '10.0.0.1';
    open(swap);
    const gw1 = evaluateGateway(getNode('pc1'), reachContext());
    ok('a retired router listed first does not shadow its replacement as the gateway', gw1.level === 'good' && /Core/.test(gw1.text), gw1.text);
    ok('nor without the shared context', evaluateGateway(getNode('pc1')).level === 'good' && findNodeByIp('10.0.0.1').id === 'rt');
    const dns1 = evaluateDns(getNode('pc1'), reachContext());
    ok('nor as the DNS server', !/OldRouter|retired/.test(dns1.text), dns1.text);
    ok('and nobody behind it gets a gateway finding', !topologyFindings().some((f) => f.key === 'gateway'), topologyFindings().filter((f) => f.key === 'gateway').map((f) => f.text).join(' | '));
    getNode('rt').interfaces[0].ip = '10.0.0.2/24'; save();
    const gw2 = evaluateGateway(getNode('pc1'), reachContext());
    ok('when only the retired one holds it, the finding says the gateway is retired', gw2.level === 'bad' && /OldRouter/.test(gw2.text) && /retired/.test(gw2.text), gw2.text);
    ok('and so does DNS', /OldRouter/.test(evaluateDns(getNode('pc1'), reachContext()).text) && /retired/.test(evaluateDns(getNode('pc1'), reachContext()).text));
    // Its address is free again for whatever is added next.
    getNode('pc1').status = 'retired'; save();
    ok('a retired device\'s address is offered again as free', freeAddresses('10.0.0.0/24', 10).includes('10.0.0.10') && !takenAddresses(null).has('10.0.0.10'),
       freeAddresses('10.0.0.0/24', 10).join(','));
    ok('and the Subnets tab counts it free', networkStats(state.networks[0]).used === 2, String(networkStats(state.networks[0]).used));

    // ---- 3. Labels on the map, duplicates as findings ----
    open();
    const labels = [...document.querySelectorAll('#layer-links text.cable-label')].map((t) => t.textContent);
    ok('a cable\'s label is drawn on the map', labels.includes('UP-1') && labels.includes('WS-3B') && labels.length === 2, labels.join(','));
    const lbl = document.querySelector('#layer-links text.cable-label');
    ok('with explicit fonts (the PNG has no stylesheet) and hidden in the reduced views', lbl.getAttribute('font-family') === 'monospace' && lbl.hasAttribute('data-adv'));
    ok('no label finding while every label is its own', !topologyFindings().some((f) => f.key === 'cable-label' || f.key === 'asset-tag'));
    setCableField(getLink('l2'), 'label', 'ws-3b '); save();
    const dupCable = topologyFindings().filter((f) => f.key === 'cable-label');
    ok('one label on two runs (any case) is one advisory finding naming both cables', dupCable.length === 1 && dupCable[0].level === 'warn'
       && dupCable[0].linkIds.sort().join(',') === 'l1,l2', JSON.stringify(dupCable));
    getNode('pc2').assetTag = 'cs-0042'; save();
    const dupTag = topologyFindings().filter((f) => f.key === 'asset-tag');
    ok('one asset tag on two devices is one advisory finding naming both', dupTag.length === 1 && dupTag[0].level === 'warn'
       && dupTag[0].nodeIds.sort().join(',') === 'pc1,pc2' && /PC-1, PC-2/.test(dupTag[0].detail), dupTag[0] && dupTag[0].detail);
    getNode('pc2').status = 'retired'; save();
    ok('a retired device keeps its tag: still a duplicate (tags are never reused)', topologyFindings().some((f) => f.key === 'asset-tag'));

    // ---- 4. The side panel ----
    open();
    select('pc1', 'node');
    ok('the Asset group shows the device\'s fields', el('propSerial').value === 'SN123' && el('propAssetTag').value === 'CS-0042'
       && el('propLocation').value === 'Room 2 · rack A · U12' && el('propStatus').value === 'active');
    ok('Model / firmware is the OS field, inside the group', el('assetGroup').contains(el('propOs')) && /Model \/ firmware/.test(el('assetGroup').textContent));
    ok('the closed group still says the tag and status', el('assetSummary').textContent === 'CS-0042 · Active', el('assetSummary').textContent);
    initHistory();
    typeInto(el('propAssetTag'), 'CS-0043');
    commitTyping();
    ok('typing a tag sets it, as one undo step', getNode('pc1').assetTag === 'CS-0043' && steps() === 1, `${getNode('pc1').assetTag} ${steps()}`);
    typeInto(el('propSerial'), '   ');
    commitTyping();
    ok('emptying a field removes the key', !('serial' in getNode('pc1')) && !('serial' in saved().nodes.find((n) => n.id === 'pc1')));
    undo();
    ok('undo brings it back', getNode('pc1').serial === 'SN123', getNode('pc1').serial);
    el('propStatus').value = 'retired'; el('propStatus').dispatchEvent(new Event('change'));
    ok('the status select sets it, and the note explains what retired means', getNode('pc1').status === 'retired' && !gone('statusNote'));
    ok('the map dims it at once', el('ui-node-pc1').getAttribute('opacity') === '0.4');
    el('propStatus').value = ''; el('propStatus').dispatchEvent(new Event('change'));
    ok('— unsets it', !('status' in getNode('pc1')) && gone('statusNote'));
    el('assetGroup').open = false; el('assetGroup').dispatchEvent(new Event('toggle'));
    await new Promise((r) => setTimeout(r, 0));
    ok('folding the group is remembered in this browser', localStorage.getItem(ASSET_OPEN_KEY) === '0');
    restoreAssetGroup();
    ok('and restored', el('assetGroup').open === false);
    el('assetGroup').open = true; el('assetGroup').dispatchEvent(new Event('toggle'));
    select('l0', 'link');
    ok('a cable\'s panel shows its facts', !gone('linkCableProps') && el('propCableLabel').value === 'UP-1' && el('propCableLength').value === '2 m'
       && el('propCableColor').value === 'blue' && el('propCableVia').value === 'PP-A:1');
    typeInto(el('propCableVia'), 'PP-A:1 > WJ-3B');
    commitTyping();
    ok('editing one changes that fact only', getLink('l0').cable.via === 'PP-A:1 > WJ-3B' && getLink('l0').cable.label === 'UP-1');
    select('l2', 'link');
    typeInto(el('propCableLabel'), 'WS-4');
    commitTyping();
    typeInto(el('propCableLabel'), '');
    commitTyping();
    ok('a cable whose facts are all emptied has no cable key again', !('cable' in getLink('l2')));
    select('pc1', 'node');
    ok('a device does not show the cable facts', gone('linkCableProps') && !gone('printLabelBtn'));
    state.settings.advanced = false; applyProfile();
    ok('the Asset group is gone in a reduced view', gone('assetGroup'));
    ok('and so is Print label', gone('printLabelBtn'));
    state.settings.advanced = true; applyProfile();

    // ---- 5. Table, CSV, bulk, search ----
    open();
    const devCols = TV_COLS.devices.map((c) => c.key);
    ok('the Devices table has the asset columns', ['assetTag', 'serial', 'location', 'status'].every((k) => devCols.includes(k)), devCols.join(','));
    const statusCol = TV_COLS.devices.find((c) => c.key === 'status');
    ok('a status cell takes a key or its name, and refuses anything else', statusCol.parse('retired').value === 'retired' && statusCol.parse('Planned').value === 'planned'
       && statusCol.parse('broken').error && statusCol.parse('').value === undefined);
    const cabCols = TV_COLS.cables.map((c) => c.key);
    ok('the Cables table has the cable facts', ['cable:label', 'cable:length', 'cable:color', 'cable:via'].every((k) => cabCols.includes(k)), cabCols.join(','));
    const labelCol = TV_COLS.cables.find((c) => c.key === 'cable:label');
    ok('a cable cell reads and writes link.cable', labelCol.get(getLink('l1')) === 'WS-3B' && (labelCol.set(getLink('l2'), 'WS-9'), getLink('l2').cable.label === 'WS-9'));
    open();
    const devSheet = csvDevicesSheet();
    ok('devices.csv has serial, asset_tag, location and status columns', ['serial', 'asset_tag', 'location', 'status'].every((h) => devSheet.headers.includes(h)), devSheet.headers.join(','));
    const cabSheet = csvCablesSheet();
    ok('cables.csv has the cable facts', cabSheet.headers.slice(-4).join(',') === 'cable_label,cable_length,cable_color,cable_via'
       && cabSheet.rows[0].slice(-4).join('|') === 'UP-1|2 m|blue|PP-A:1', cabSheet.rows[0].join('|'));
    const sheetOf = (built) => csvSheet(csvParse(csvText(built, ',')), true);
    const roundTrip = (built) => { const sh = sheetOf(built); return csvPlan(sh, csvAutoMap(sh)); };
    const devPlan = roundTrip(csvDevicesSheet());
    ok('devices.csv imported straight back changes nothing', devPlan.rows.every((r) => r.status === 'same'), devPlan.rows.map((r) => `${r.name}:${r.status}:${r.why}`).join(' | '));
    const cabPlan = roundTrip(csvCablesSheet());
    ok('cables.csv imported straight back changes nothing', cabPlan.rows.every((r) => r.status === 'same'), cabPlan.rows.map((r) => `${r.name}:${r.status}:${r.why}`).join(' | '));
    const cabSh = csvSheet(csvParse('cable_id,cable_label,cable_length\nl2,WS-7,5 m\nl1,,\n'), true);
    const cabEdit = csvPlan(cabSh, csvAutoMap(cabSh));
    ok('a sheet labels a cable: the review lists the facts it sets, blank cells leave them', cabEdit.rows[0].status === 'change' && cabEdit.rows[0].changes.length === 2
       && cabEdit.rows[1].status === 'same', JSON.stringify(cabEdit.rows));
    applyCsvPlan(cabEdit);
    ok('and Apply writes them into link.cable', getLink('l2').cable.label === 'WS-7' && getLink('l2').cable.length === '5 m' && getLink('l1').cable.label === 'WS-3B');
    const twice = csvSheet(csvParse('cable_id,cable_label\nl2,A\nl2,B\n'), true);
    const twicePlan = csvPlan(twice, csvAutoMap(twice));
    ok('two rows giving one cable two labels: the second is a conflict', twicePlan.rows[1].status === 'conflict', JSON.stringify(twicePlan.rows));
    const stSh = csvSheet(csvParse('id,status,location\npc2,retired,Store room\nrt,broken,\n'), true);
    const stPlan = csvPlan(stSh, csvAutoMap(stSh));
    ok('a sheet sets a status and a location; a word that is no status is refused', stPlan.rows[0].status === 'change' && stPlan.rows[1].status === 'conflict', JSON.stringify(stPlan.rows));
    const tagSh = csvSheet(csvParse('asset tag,serial number\ncs-0042,NEW-SN\n'), true);
    const tagPlan = csvPlan(tagSh, csvAutoMap(tagSh));
    ok('a row is matched to a device by its asset tag', tagPlan.rows[0].nodeId === 'pc1' && tagPlan.rows[0].status === 'change', JSON.stringify(tagPlan.rows[0]));
    open();
    selectEntries([{ type: 'node', id: 'pc1' }, { type: 'node', id: 'pc2' }]);
    ok('the bulk panel offers Location and Status for a set of devices', !!el('bulkF-location') && !!el('bulkF-status') && !el('bulkF-assetTag') && !el('bulkF-serial'));
    const setPlan = bulkPlanSet(['pc1', 'pc2'], { status: { text: 'retired' }, location: { text: 'Store room' } });
    ok('setting a status on both: one change per device', setPlan.counts.change === 2 && !setPlan.errors.length, JSON.stringify(setPlan.counts));
    ok('a status that is not one is refused for all', bulkPlanSet(['pc1', 'pc2'], { status: { text: 'gone' } }).errors.length === 1);
    selectEntries([{ type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    ok('a set of cables offers length, colour and via, not the label', !!el('bulkF-cable.length') && !!el('bulkF-cable.color') && !!el('bulkF-cable.via') && !el('bulkF-cable.label'));
    const lenPlan = bulkPlanSet(['l1', 'l2'], { 'cable.length': { text: '3 m' } }, 'link');
    bulkWrite(lenPlan, state);
    ok('setting a length on both keeps each one\'s label', getLink('l1').cable.length === '3 m' && getLink('l1').cable.label === 'WS-3B' && getLink('l2').cable.length === '3 m');
    const clrPlan = bulkPlanSet(['l1', 'l2'], { 'cable.length': { clear: true } }, 'link');
    bulkWrite(clrPlan, state);
    ok('clearing it drops the fact, and an empty cable object goes', !('length' in getLink('l1').cable) && !('cable' in getLink('l2')));
    select(null, null);
    open();
    getNode('pc2').status = 'retired';
    const qIds = (text) => { const p = parseQuery(text); return state.nodes.filter((n) => queryMatch(p, 'node', n)).map((n) => n.id).join(','); };
    ok('status:retired finds the retired one', qIds('status:retired') === 'pc2', qIds('status:retired'));
    ok('loc: and tag: are understood', !parseQuery('loc:rack tag:cs').errors.length && qIds('loc:"rack a"') === 'pc1' && qIds('tag:0042') === 'pc1', qIds('tag:0042'));
    const ql = parseQuery('ws-3b');
    ok('plain text finds a cable by its label', state.links.filter((l) => queryMatch(ql, 'link', l)).some((l) => l.id === 'l1'));

    // ---- 6. The notes lint ----
    // Stripe's published sample key, split so push protection's scanner doesn't take the fixture for a leak.
    const flagged = ['password: hunter2', 'PSK Hunter2!', 'PIN 4821', 'pin: 1234', 'clave: secreta', 'пароль: qwerty1', '管理パスワード：abc123', 'Tr0ub4dor&3xyz', 'sk_' + 'live_4eC39HqLyjWDarjtT1zdp7dc',
      'login admin, pw Summer2024', 'WPA2 key is Hunter2024', 'admin / Summer2024!', 'root: Tr0ub4dor'];
    const clean = ['Reception desk', 'pass through to the core', 'token ring', 'srv-PACS-01.clinic', '3C:07:54:11:22:33', 'https://Example.com/Path?a=1&B=2', 'Gi1/0/24', 'Rack 3, U12 — ask the lab lead',
      'Pin 1-2 crossover', 'PoE on pin 4/5', 'pins 1,2,3,6', 'admin/root', 'user: reception', 'uses WPA2 personal', 'Cat6 run to Rack-B2, 35 m', '(Rack1Top)'];
    ok('what looks like a password is flagged', flagged.every(notesSecretHit), flagged.filter((s) => !notesSecretHit(s)).join(' | '));
    ok('ordinary notes are not', !clean.some(notesSecretHit), clean.filter(notesSecretHit).join(' | '));
    open();
    select('pc2', 'node');
    typeInto(el('propNotes'), 'admin password: S3cret!');
    ok('the field warns as it is typed', !gone('notesLint') && /password/.test(el('notesLint').textContent));
    commitTyping();
    select(null, null);
    openShareDialog('doc');
    const lint = el('shareLint');
    ok('the share dialog names the device', !lint.classList.contains('hidden') && /PC-2/.test(lint.textContent), lint.textContent);
    ok('and never the secret itself', !/S3cret/.test(lint.textContent) && !/S3cret/.test(el('shareDialog').textContent));
    lint.querySelector('button').click();
    ok('Show them closes the dialog and selects that device', el('shareDialog').classList.contains('hidden') && state.selectedId === 'pc2');
    openReportDialog('site');
    ok('the report dialog says the same before anything is printed', !el('reportLint').classList.contains('hidden') && /PC-2/.test(el('reportLint').textContent));
    closeReportDialog();
    // A network from a newer build cannot be shared, but its report still
    // prints the notes, so the report dialog still warns.
    replaceDocument({ v: DOC_VERSION + 1, nodes: [{ id: 'f1', type: 'pc', name: 'Future-PC', x: 0, y: 0, notes: 'password: Hunter2!', interfaces: [] }], links: [] }, { origin: 'file' });
    openReportDialog('site');
    ok('a read-only network is linted for its report too', !!state.readOnly && !el('reportLint').classList.contains('hidden') && /Future-PC/.test(el('reportLint').textContent));
    closeReportDialog();
    open();
    openShareDialog('doc');
    ok('a network with clean notes gets no warning', el('shareLint').classList.contains('hidden'));
    closeShareDialog();

    // ---- 7. #asset/<tag> ----
    ok('the route reads its tag, encoded or not', assetTagOfHash('asset/CS-0042') === 'CS-0042' && assetTagOfHash('asset/CS%200042') === 'CS 0042'
       && assetTagOfHash('asset/%E0%A4%A') === '%E0%A4%A' && assetTagOfHash('asset/') === null && assetTagOfHash('advanced') === null);
    // A card of its own, holding the device, and an empty canvas.
    const cardDoc = Object.assign(lab(), { report: { site: 'Clinica Norte' } });
    const lib = {};
    lib.card1 = { id: 'card1', name: 'Clinica Norte', created: 1, updated: 2, doc: cardDoc };
    lib.card2 = { id: 'card2', name: 'Bodega Sur', created: 1, updated: 1, doc: { v: DOC_VERSION, nodes: [{ id: 'q', type: 'pc', name: 'Q', x: 0, y: 0, interfaces: [] }], links: [] } };
    persistLibrary(lib);
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    window.history.replaceState(null, '', `${location.pathname}${location.search}#asset/cs-0042`);
    asked.length = 0;
    await load();
    renderCanvasOnly(); fitToView(); applyArrivalFocus();
    ok('a printed label opens the card that holds the device', state.libraryId === 'card1' && state.nodes.some((n) => n.id === 'pc1'), state.libraryId);
    ok('and selects that device (the tag in any case)', state.selectedId === 'pc1' && state.selectedType === 'node');
    ok('centred on the map', (() => { const r = el('networkCanvas').getBoundingClientRect(); return Math.abs(state.camera.x + getNode('pc1').x * state.camera.zoom - r.width / 2) < 1; })());
    ok('the tag leaves the address bar', location.hash === '');
    ok('nothing was asked', !asked.length, asked.map((a) => a.kind).join(','));
    select(null, null);
    asked.length = 0;
    ok('a tag already on the open network selects it there', (await openAssetLink('CS-0042')) === true && state.selectedId === 'pc1' && state.libraryId === 'card1' && !asked.length);
    lib.card2.doc.nodes[0].assetTag = 'CS-0042';
    persistLibrary(lib);
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    asked.length = 0;
    await openAssetLink('CS-0042');
    const choice = asked.find((a) => a.kind === 'choice');
    ok('a tag on two cards asks which, by name', !!choice && choice.choices.map((c) => c.label).sort().join(',') === 'Bodega Sur,Clinica Norte', choice && JSON.stringify(choice.choices));
    ok('and opens the one picked', state.libraryId === choice.choices[choice.choices.length - 1].id && state.selectedId === getNode(state.selectedId).id
       && getNode(state.selectedId).assetTag === 'CS-0042');
    replaceDocument(EMPTY_DOC, { origin: 'new' });
    asked.length = 0;
    const found = await openAssetLink('CS-9999');
    const told = asked.find((a) => a.kind === 'tell');
    ok('an unknown tag says so', found === false && !!told && /CS-9999/.test(told.message), told && told.message);
    ok('and names no network kept here', !/Clinica|Bodega|card/.test(told.message));
    if (landingIsOpen()) landingHandledDocument();
    persistLibrary({});

    // ---- 8. Print labels ----
    open();
    let opened = null;
    window.open = (url) => { opened = url; return null; };   // no tab: the download fallback
    const realClick = HTMLAnchorElement.prototype.click;
    let downloaded = null;
    HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
    const printed = printAssetLabels([{ type: 'node', id: 'pc1' }, { type: 'node', id: 'pc2' }, { type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    HTMLAnchorElement.prototype.click = realClick;
    ok('a tagged device and a cable are printed; the untagged one is left out and counted', printed.set.devices.length === 1 && printed.set.cables.length === 1 && printed.set.untagged === 1);
    ok('and so is a cable with no label (no "—" labels)', printed.set.unlabelled === 1 && !/—/.test(labelsHtml(printed.set).split('<div class="sheet">')[1]));
    ok('a cable with no label alone prints nothing, and says why', printAssetLabels([{ type: 'link', id: 'l2' }]) === null);
    ok('delivered like the report, named as labels', !!opened && /-labels-\d{4}-\d{2}-\d{2}\.html$/.test(downloaded || ''), downloaded);
    const html = labelsHtml(printed.set);
    const sheet = new DOMParser().parseFromString(html, 'text/html');
    ok('each device label carries its QR code, drawn here as SVG', sheet.querySelectorAll('.lbl:not(.cable) .qr svg path').length === 1 && /^M\d/.test(sheet.querySelector('.qr svg path').getAttribute('d')));
    ok('a cable label is printed twice, one for each end', sheet.querySelectorAll('.lbl.cable').length === 2 && /WS-3B/.test(sheet.querySelector('.lbl.cable').textContent));
    ok('the label says the tag, the name, the address and the MAC', /CS-0042/.test(sheet.body.textContent) && /PC-1/.test(sheet.body.textContent) && /10\.0\.0\.10/.test(sheet.body.textContent) && /3C:07:54:11:22:33/.test(sheet.body.textContent));
    ok('the sheet fetches nothing (no src, no href, no stylesheet link)', !sheet.querySelector('[src], link, a[href]') && !/@import|url\(/.test(html));
    ok('the code encodes this page\'s own asset link', assetLinkFor('CS 0042') === `${location.origin}${location.pathname}#asset/CS%200042`);
    const q1 = window.qrcode(0, 'M'); q1.addData(assetLinkFor('CS-0042')); q1.make();
    const box = sheet.querySelector('.qr svg').getAttribute('viewBox').split(' ').map(Number);
    ok('with the quiet zone around the modules', box[2] === q1.getModuleCount() + 8);
    window.open = heldOpen;

    // ---- 9. Report and Spanish ----
    open();
    getNode('pc2').status = 'retired';
    const rep = reportHtml(reportModel(), null);
    ok('the inventory prints the tag, the serial and the place under the name', /Asset tag CS-0042 · Serial number SN123 · Room 2 · rack A · U12/.test(rep));
    ok('and a status other than in service', /PC-2<\/b> <span class="muted">\(Retired\)<\/span>/.test(rep));
    ok('the connections get a Cable column when a cable says something', /<th>Cable<\/th>/.test(rep) && /<b class="mono">UP-1<\/b>/.test(rep) && /PP-A:1/.test(rep));
    open({ v: DOC_VERSION, nodes: [{ id: 'a', type: 'pc', name: 'A', x: 0, y: 0, interfaces: [] }, { id: 'b', type: 'pc', name: 'B', x: 0, y: 0, interfaces: [] }],
      links: [{ id: 'x', source: 'a', target: 'b' }] });
    ok('and none when no cable does', !/<th>Cable<\/th>/.test(reportHtml(reportModel(), null)));
    open();
    state.settings.lang = 'es'; setLocale('es'); applyLocale();
    select('pc1', 'node');
    ok('the plain labels are in Spanish', /Número de serie/.test(el('assetGroup').textContent) && /Ubicación/.test(el('assetGroup').textContent)
       && el('propStatus').options[1].textContent === 'Planificado', el('propStatus').options[1].textContent);
    ok('the technical one stays English', /Model \/ firmware/.test(el('assetGroup').textContent));
    ok('the summary speaks it too', el('assetSummary').textContent === 'CS-0042 · En servicio', el('assetSummary').textContent);
    ok('so do the status names in the table', statusName('retired') === 'Retirado' && TV_COLS.devices.find((c) => c.key === 'status').parse('Retirado').value === 'retired');
    delete state.settings.lang; setLocale('en'); applyLocale();
    select(null, null);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.open = heldOpen;
    setDialogResponder(heldResponder);
    persistLibrary(heldStore);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
