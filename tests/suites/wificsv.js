// Wi-Fi in spreadsheets (Review-Packs/Topo-wifi.md, W1 part 1; js/csv.js):
//   1. wifi.csv: one row per network, its subnet by CIDR, every band it is
//      on; listed in the export only once there is one;
//   2. interfaces.csv: a radio's standard, bands and per band its channel,
//      width, power and SSIDs (ch_2g, width_5g, ssids_6g...);
//   3. cables.csv: an association's ssid, band and signal, as stored;
//   4. the round trip: subnets.csv, wifi.csv, devices.csv, interfaces.csv
//      and cables.csv into a blank map give back every network, radio and
//      association; the formula guard still holds on an SSID;
//   5. import: a network found by its id or SSID and changed, a new one
//      added, a controller's export (SSID beside security) read as one, a
//      mixed sheet refused, an unknown SSID a conflict, an inventory's SSID
//      column left a device sheet, a radio part changed on a device on the
//      map, and Apply one undo step.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const json = (v) => JSON.stringify(v);
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
  const planOf = (text, mapping) => { const s = sheetOf(text); return csvPlan(s, mapping || csvAutoMap(s)); };
  const statuses = (plan) => plan.rows.map((r) => r.status).join(',');
  const row = (sheet, first) => { const r = sheet.rows.find((x) => x[0] === first); return r ? Object.fromEntries(sheet.headers.map((h, i) => [h, r[i]])) : null; };

  const site = () => ({ v: DOC_VERSION,
    networks: [{ id: 'nS', cidr: '10.1.0.0/24', vlan: 10, gateway: '10.1.0.1' }, { id: 'nG', cidr: '10.9.0.0/24', vlan: 90 }],
    wifi: [
      { id: 'wS', ssid: 'Staff', security: 'wpa3', network: 'nS' },
      { id: 'wG', ssid: 'Guest', security: 'owe', bands: ['2.4', '5'], network: 'nG' },
      { id: 'wI', ssid: '=IoT', security: 'wpa2', bands: ['2.4'], hidden: true }
    ],
    nodes: [
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8, interfaces: [] },
      { id: 'ap1', type: 'ap', name: 'AP-1', x: 0, y: 100, portCount: 1, interfaces: [{ id: 'w1', name: 'wlan0', ip: '',
        radio: { standard: 'axe', bands: [{ band: '2.4', channel: 6, width: 20, power: 17 }, { band: '5', channel: 36, width: 80 }, { band: '6', channel: 37, width: 160, ssids: ['wS'] }] } }] },
      { id: 'ap2', type: 'ap', name: 'AP-2', x: 200, y: 100, portCount: 1, interfaces: [{ id: 'w1', name: 'wlan0', ip: '',
        radio: { standard: 'ac', bands: [{ band: '2.4', channel: 1, ssids: [] }, { band: '5', channel: 44, width: 80, ssids: ['wG', 'wI'] }] } }] },
      { id: 'lap', type: 'pc', name: 'Laptop', x: 0, y: 200, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.1.0.20/24', radio: { standard: 'ax' } }] },
      { id: 'phone', type: 'voip', name: 'Phone', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.9.0.5/24' }] },
      { id: 'cam', type: 'camera', name: 'Cam', x: 100, y: 200, interfaces: [{ id: 'i1', name: 'wlan0', ip: '', radio: { bands: ['2.4'] } }] }
    ],
    links: [
      { id: 'u1', source: 'sw', target: 'ap1', sourceIface: 'p1', targetIface: 'p1' },
      { id: 'u2', source: 'sw', target: 'ap2', sourceIface: 'p2', targetIface: 'p1' },
      { id: 'a1', source: 'lap', target: 'ap1', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { ssid: 'wS', signal: -58 } },
      { id: 'a2', source: 'phone', target: 'ap2', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless' },
      { id: 'a3', source: 'cam', target: 'ap1', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { ssid: 'wI', band: '2.4', signal: -71 } }
    ] });
  const open = () => { replaceDocument(site(), { origin: 'file' }); initHistory(); };
  const blank = () => replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });

  try {
    // ---- 1: wifi.csv ----
    blank();
    ok('a map with no Wi-Fi does not list the sheet', !CSV_SHEETS.find((s) => s.key === 'wifi').shown());
    open();
    ok('a map with Wi-Fi does', CSV_SHEETS.find((s) => s.key === 'wifi').shown());
    const wf = csvWifiSheet();
    ok('wifi.csv has the schema\'s columns', wf.headers.join(',') === 'wifi_id,ssid,security,bands,subnet,hidden', wf.headers.join(','));
    ok('a row: the subnet by its CIDR, every band it is on', json(row(wf, 'wS')) === json({ wifi_id: 'wS', ssid: 'Staff', security: 'wpa3', bands: '2.4 5 6', subnet: '10.1.0.0/24', hidden: 'false' })
       && row(wf, 'wG').bands === '2.4 5' && row(wf, 'wI').hidden === 'true', json(row(wf, 'wS')));
    ok('no passphrase column, ever', !wf.headers.some((h) => /pass|psk|key|secret/i.test(h)));
    ok('an SSID that reads as a formula is guarded', csvText(wf).split('\r\n')[3].startsWith("wI,'=IoT,"), csvText(wf).split('\r\n')[3]);

    // ---- 2: interfaces.csv ----
    const ifs = csvInterfacesSheet();
    ok('interfaces.csv carries the radio after the interface', ifs.headers.slice(9).join(',') === RADIO_CSV_PARTS.map((p) => p.csv).join(',')
       && ['standard', 'bands', 'ch_2g', 'ch_5g', 'ch_6g', 'width_2g', 'width_5g', 'width_6g', 'power_2g', 'ssids_6g'].every((h) => ifs.headers.includes(h)), ifs.headers.join(','));
    const r1 = row({ headers: ifs.headers, rows: ifs.rows.filter((r) => r[0] === 'ap1') }, 'ap1');
    ok('an AP\'s radio, band by band', r1.standard === 'axe' && r1.bands === '2.4 5 6' && r1.ch_2g === '6' && r1.ch_5g === '36' && r1.ch_6g === '37'
       && r1.width_2g === '20' && r1.width_5g === '80' && r1.width_6g === '160' && r1.power_2g === '17' && r1.power_5g === '' && r1.ssids_2g === '' && r1.ssids_6g === 'Staff', json(r1));
    const r2 = row({ headers: ifs.headers, rows: ifs.rows.filter((r) => r[0] === 'ap2') }, 'ap2');
    ok('a band broadcasting none says so, and a list is names', r2.ssids_2g === 'none' && r2.ssids_5g === 'Guest; =IoT', json(r2));
    ok('a client\'s, and a wired device\'s none', row({ headers: ifs.headers, rows: ifs.rows.filter((r) => r[0] === 'lap') }, 'lap').standard === 'ax'
       && RADIO_CSV_PARTS.every((p) => row({ headers: ifs.headers, rows: ifs.rows.filter((r) => r[0] === 'sw') }, 'sw')[p.csv] === ''));

    // ---- 3: cables.csv ----
    const cab = csvCablesSheet();
    ok('cables.csv has ssid, band and signal before the cable\'s own facts', cab.headers.slice(9, 12).join(',') === 'ssid,band,signal' && cab.headers.slice(-4).join(',') === 'cable_label,cable_length,cable_color,cable_via', cab.headers.join(','));
    ok('as stored: a band nobody picked is blank', json([row(cab, 'a1').ssid, row(cab, 'a1').band, row(cab, 'a1').signal]) === '["Staff","","-58"]'
       && json([row(cab, 'a3').ssid, row(cab, 'a3').band, row(cab, 'a3').signal]) === '["=IoT","2.4","-71"]' && row(cab, 'u1').ssid === '' && row(cab, 'a2').ssid === '');

    // ---- 4: the round trip ----
    const sig = () => {
      const d = JSON.parse(json(serializeDoc()));
      const name = (id) => (getNode(id) || {}).name;
      return {
        nets: json(d.networks), wifi: json(d.wifi),
        nodes: d.nodes.map((n) => json(n)).sort().join('\n'),
        // Either way round, and by the medium it is: devices.csv draws a
        // client's association from the AP's side and leaves the medium to be
        // inferred, which is the same link (tests/suites/csv.js, cableSig).
        links: state.links.map((l) => json([[`${name(l.source)}:${l.sourceIface}`, `${name(l.target)}:${l.targetIface}`].sort(), effectiveMedium(l), l.attachment || '', readLinkWifi(l.wifi) || null])).sort().join('\n')
      };
    };
    open();
    const want = sig();
    const sheets = { S: csvText(csvSubnetsSheet()), W: csvText(csvWifiSheet()), D: csvText(csvDevicesSheet()), I: csvText(csvInterfacesSheet()), C: csvText(csvCablesSheet()) };
    ['SWDIC', 'SWIDC', 'SWDCI'].forEach((order) => {
      blank();
      const why = [];
      [...order].forEach((k) => { const pl = planOf(sheets[k]); pl.rows.filter((r) => r.status === 'conflict').forEach((r) => why.push(`${k} ${r.name}: ${r.why}`)); applyCsvPlan(pl); });
      const got = sig();
      const diff = Object.keys(want).filter((k) => got[k] !== want[k]);
      const first = diff[0] ? (() => { const a = want[diff[0]].split('\n'), b = got[diff[0]].split('\n'); const i = a.findIndex((x, j) => x !== b[j]); return `${a[i]} ≠ ${b[i]}`; })() : '';
      ok(`every network, radio and association round-trips (${order})`, !diff.length && !why.length, `${diff.join('+')} ${first.slice(0, 400)} ${why.slice(0, 2).join(' | ')}`);
    });
    // In the other order, a sheet naming a network the map lacks says so
    // rather than dropping it.
    blank();
    let plan = planOf(sheets.I);
    ok('interfaces.csv before wifi.csv: a radio naming an SSID the map lacks is a conflict', plan.rows.some((r) => r.status === 'conflict' && /SSID list 6 GHz/.test(r.why)), plan.rows.filter((r) => r.status === 'conflict').map((r) => r.why).join(' | '));

    // ---- 5: import ----
    open();
    plan = planOf('wifi_id,ssid,security,bands,hidden\nwS,Staff,WPA2-PSK,,\n,Lab,WPA3-SAE,"2.4 GHz, 5 GHz",yes\n,Guest,,6,');
    ok('found by id, by SSID, or new', statuses(plan) === 'change,add,change', statuses(plan));
    ok('the review says what changes, in the trade\'s words', plan.rows[0].changes.map((c) => `${c.field}:${c.before}>${c.after}`).join() === 'Security:WPA3-Personal>WPA2-Personal'
       && plan.rows[2].changes.map((c) => `${c.field}:${c.before}>${c.after}`).join() === 'Bands:2.4 GHz, 5 GHz>6 GHz', plan.rows.map((r) => r.changes.map((c) => `${c.field}:${c.before}>${c.after}`).join()).join(' | '));
    const steps = _undoStack.length;
    applyCsvPlan(plan);
    ok('Apply writes them in one undo step', _undoStack.length === steps + 1 && wifiById('wS').security === 'wpa2' && json(wifiById('wG').bands) === '["6"]'
       && state.wifi.length === 4 && state.wifi[3].ssid === 'Lab' && state.wifi[3].hidden === true && json(state.wifi[3].bands) === '["2.4","5"]', json(state.wifi));
    undo();
    ok('and one undo takes them back', state.wifi.length === 3 && wifiById('wS').security === 'wpa3');
    plan = planOf('SSID,Security,VLAN\nCorp,WPA2-Enterprise,20');
    ok('a controller\'s export (SSID beside security) is a sheet of Wi-Fi networks', plan.kind === 'wifi' && statuses(plan) === 'add', `${plan.kind} ${statuses(plan)}`);
    plan = planOf('wifi_id,ssid,subnet\nwS,Staff,10.99.0.0/24');
    ok('a subnet the map has not declared is a conflict', statuses(plan) === 'conflict' && /Subnet/.test(plan.rows[0].why), plan.rows[0].why);
    plan = planOf('wifi_id,ssid,subnet\nwG,Guest,10.1.0.7/24');
    ok('one given by any address in it is that subnet', statuses(plan) === 'change' && plan.ops[0].wifi.set.network === 'nS');
    plan = planOf('ssid\nNoSecurity');
    ok('an SSID column alone is a device sheet\'s, not a Wi-Fi one', plan.kind === 'devices');
    const mixed = sheetOf('wifi_id,ssid,ip\nwS,Staff,10.0.0.1');
    plan = csvPlan(mixed, ['wf:id', 'wf:ssid', 'if:ip']);
    ok('a sheet of Wi-Fi networks with another record\'s column is refused', plan.kind === 'mixed-wifi' && plan.errors.length === 1 && /Wi-Fi network/.test(plan.errors[0]), plan.errors.join());
    plan = planOf('name,ip,ssid,band\nLaptop,10.1.0.20/24,Staff,5');
    ok('an inventory\'s SSID and band columns leave it a sheet of devices', plan.kind === 'devices' && !plan.errors.length, `${plan.kind} ${plan.errors.join()}`);
    plan = planOf('cable_id,ssid,band,signal\na2,Guest,5 GHz,-66 dBm\na1,Nowhere,,\na3,,6,');
    ok('a cable row sets the association; an unknown SSID is a conflict', statuses(plan) === 'change,conflict,change' && /Nowhere/.test(plan.rows[1].why), statuses(plan) + ' ' + plan.rows[1].why);
    applyCsvPlan(plan);
    ok('written as the link holds it', json(getLink('a2').wifi) === '{"ssid":"wG","band":"5","signal":-66}' && json(getLink('a3').wifi) === '{"ssid":"wI","band":"6","signal":-71}', json(getLink('a2').wifi));
    plan = planOf('device_id,interface_id,ch_5g,width_5g,ssids_2g,standard\nap2,w1,48,40,Staff; Guest,Wi-Fi 6');
    ok('a radio\'s parts on a device on the map', statuses(plan) === 'change' && plan.rows[0].changes.length === 4, plan.rows[0].changes.map((c) => `${c.field}:${c.before}>${c.after}`).join(' | '));
    applyCsvPlan(plan);
    const rr = getNode('ap2').interfaces[0].radio;
    ok('laid over the radio it had', rr.standard === 'ax' && rr.bands[1].channel === 48 && rr.bands[1].width === 40 && json(rr.bands[1].ssids) === '["wG","wI"]'
       && json(rr.bands[0].ssids) === '["wS","wG"]' && rr.bands[0].channel === 1, json(rr));
    plan = planOf('device_id,interface_id,ch_6g\nlap,i1,5');
    applyCsvPlan(plan);
    ok('a band\'s fact lists its band if it was not', json(getNode('lap').interfaces[0].radio) === '{"standard":"ax","bands":[{"band":"6","channel":5}]}', json(getNode('lap').interfaces[0].radio));
    plan = planOf('device_id,interface_id,ch_5g,bands\nap1,w1,36,2.4 9');
    ok('a channel or bands cell that says something else is a conflict', statuses(plan) === 'conflict', plan.rows[0].why);

    // ---- 6: SSIDs a cell could misread ----
    // A ';' (the list separator), the "none" token, and another network's id
    // are written as the network's id, so they come back as they went.
    const awkward = () => replaceDocument({ v: DOC_VERSION,
      wifi: [{ id: 'w1', ssid: 'none' }, { id: 'w2', ssid: 'Cafe; Bar' }, { id: 'w3', ssid: 'w1' }, { id: 'w4', ssid: 'Other' }],
      nodes: [
        { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 0, interfaces: [{ id: 'r', name: 'wlan0', ip: '',
          radio: { standard: 'ax', bands: [{ band: '2.4', ssids: ['w1', 'w3'] }, { band: '5', ssids: ['w2'] }, { band: '6', ssids: [] }] } }] },
        { id: 'pc', type: 'pc', name: 'PC', x: 0, y: 100, interfaces: [{ id: 'i1', name: 'wlan0', ip: '' }] }
      ],
      links: [{ id: 'k1', source: 'pc', target: 'ap', sourceIface: 'i1', targetIface: 'r', medium: 'wireless', wifi: { ssid: 'w2' } }] }, { origin: 'file' });
    awkward();
    const awkWant = sig();
    const awkIfs = csvInterfacesSheet();
    const apRow = row(awkIfs, 'ap');
    ok('an SSID with ";", "none" or another network\'s id is written as its id', apRow.ssids_2g === 'w1; w3' && apRow.ssids_5g === 'w2' && apRow.ssids_6g === 'none' && row(csvCablesSheet(), 'k1').ssid === 'w2', json(apRow));
    ok('a plain SSID is still written by name', csvWifiRef('w4') === 'Other');
    plan = planOf(csvText(awkIfs));
    ok('read back onto the same map: nothing to change, no conflict', !plan.rows.some((r) => r.status === 'conflict' || r.status === 'change'), plan.rows.map((r) => `${r.status} ${r.why || ''}`).join(' | '));
    const awkSheets = { S: csvText(csvSubnetsSheet()), W: csvText(csvWifiSheet()), D: csvText(csvDevicesSheet()), I: csvText(csvInterfacesSheet()), C: csvText(csvCablesSheet()) };
    blank();
    const awkWhy = [];
    [...'SWDIC'].forEach((k) => { const pl = planOf(awkSheets[k]); pl.rows.filter((r) => r.status === 'conflict').forEach((r) => awkWhy.push(`${k} ${r.name}: ${r.why}`)); applyCsvPlan(pl); });
    const awkGot = sig();
    ok('and into a blank map they all round-trip', Object.keys(awkWant).every((k) => awkGot[k] === awkWant[k]) && !awkWhy.length, `${awkWhy.join(' | ')} ${awkGot.nodes.slice(0, 300)}`);
    // Another tool's single SSID with a ';' in it is that one network.
    awkward();
    plan = planOf('device_id,interface_id,ssids_2g\nap,r,Cafe; Bar');
    ok('a whole cell naming one network is read before the split', statuses(plan) === 'change' && json(plan.rows[0].changes.map((c) => c.after)).includes('Cafe; Bar'), plan.rows.map((r) => `${r.status} ${r.why || ''}`).join());
    plan = planOf('device_id,interface_id,ssids_5g\nap,r,Nowhere');
    ok('the conflict reads as a sentence ("SSID list 5 GHz")', statuses(plan) === 'conflict' && /is not a valid SSID list 5 GHz\./.test(plan.rows[0].why), plan.rows[0].why);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
