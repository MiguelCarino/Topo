// The v21 facts in the spreadsheets (js/csv.js, js/model.js; docs/SCOPE.md
// step 9, D440-D446):
//   1. the ways in as one cell: written kind by kind (a web page as http or
//      https, a port when it is not the kind's own, a user name or a path),
//      read back the same, "none" clears, a way that is not understood
//      refuses the whole cell;
//   2. devices.csv: the reached_by column, its round trip (nothing changes),
//      a change from the sheet, a bad cell said on the row, "none" clearing;
//   3. cables.csv: way_out last, primary and backup kept, a round trip, set
//      and cleared from the sheet, a word that is neither refused;
//   4. lists.csv: listed once there is a list, every field under its csv
//      name, a rule naming a list by name (by id when two share a name), its
//      round trip, and into an empty network the sheet makes every list with
//      its rules, a rule naming a list a later row makes included;
//   5. lists.csv's refusals: an address that is not one, a list the rule
//      cannot find, a new list with no name, two rows for one list, a sheet
//      that mixes in a device's column; a change and a cleared rule;
//   6. a picture is not in any sheet; the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  setLocale('en');
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
  const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
  const statuses = (plan) => plan.rows.map((r) => r.status).join();
  const whys = (plan) => plan.rows.map((r) => r.why).filter(Boolean).join(' | ');
  const apply = (plan) => applyCsvPlan(plan);
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const N = (id, type, ip, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: ip ? [{ id: 'i1', name: 'eth0', ip }] : [] }, extra);
  const ways = [{ kind: 'web', tls: true, port: 8443, path: '/admin' }, { kind: 'web' }, { kind: 'ssh', port: 2222, user: 'admin' }, { kind: 'rdp', user: 'Admin' }, { kind: 'vnc', port: 5901 }, { kind: 'telnet' }];
  const lists = [{ id: 'al1', name: 'Office', members: ['192.168.1.0/26', '192.168.1.200'], blocked: ['al2'], notes: 'Desks' }, { id: 'al2', name: 'Cameras', members: ['192.168.1.100'], allowed: ['al1'] }, { id: 'al3', name: 'Empty' }];
  const doc = (extra = {}) => Object.assign({ v: DOC_VERSION,
    nodes: [N('net', 'cloud', '203.0.113.1/30'), N('lte', 'cloud', ''), N('rt', 'router', '192.168.1.1/24', { nat: true }), N('nas', 'server', '192.168.1.10/24', { access: ways, icon: PNG }), N('pc', 'pc', '192.168.1.20/24')],
    links: [{ id: 'l1', source: 'net', target: 'rt', uplink: 'primary' }, { id: 'l2', source: 'lte', target: 'rt', uplink: 'backup' }, { id: 'l3', source: 'rt', target: 'nas' }, { id: 'l4', source: 'rt', target: 'pc' }],
    lists }, extra);
  const open = (d) => { replaceDocument(cloneData(d), { origin: 'file', docId: 'doc-csv21' }); autoBindLinks(); renderCanvasOnly(); };
  try {
    // ---- 1. The ways in as one cell ----
    const text = accessToText(ways);
    ok('each way is written by its kind, port and user name or path', text === 'https:8443 /admin; http; ssh:2222 admin; rdp Admin; vnc:5901; telnet', text);
    ok('…and reads back the same', show(accessFromText(text)) === show(asAccess(ways)), show(accessFromText(text)));
    ok('"web" reads as http; case and spaces do not matter', show(accessFromText(' WEB ;  SSH:22  root ')) === show([{ kind: 'web' }, { kind: 'ssh', port: 22, user: 'root' }]), show(accessFromText(' WEB ;  SSH:22  root ')));
    ok('"none" is no way in', show(accessFromText('none')) === '[]' && show(accessFromText('-')) === '[]');
    ok('a way that is not understood refuses the whole cell', [ 'ssh; ftp', 'ssh:99999', 'ssh admin extra', 'https admin', ';', 'rdp:abc'].every((x) => accessFromText(x) === null),
      ['ssh; ftp', 'ssh:99999', 'ssh admin extra', 'https admin', ';', 'rdp:abc'].filter((x) => accessFromText(x) !== null).join(' | '));
    ok('nothing stored is a blank cell', accessToText(undefined) === '' && accessToText([]) === '');

    // ---- 2. devices.csv ----
    open(doc());
    const dev = csvDevicesSheet();
    const at = dev.headers.indexOf('reached_by');
    const row = (id) => dev.rows[state.nodes.findIndex((n) => n.id === id)];
    ok('devices.csv has reached_by', at > -1 && row('nas')[at] === text && row('pc')[at] === '', dev.headers.join());
    const back = planOf(csvText(dev));
    ok('its round trip changes nothing', back.errors.length === 0 && back.counts.change === 0 && back.counts.add === 0 && back.counts.conflict === 0, show(back.counts) + ' ' + whys(back));
    const hd = 'id,name,reached_by\n';
    let p = planOf(hd + 'pc,PC,"ssh:2200 ana; https /ui"\n');
    ok('a way in set from the sheet is a change, said in the sheet\'s words', statuses(p) === 'change' && p.rows[0].changes.some((c) => c.after === 'ssh:2200 ana; https /ui'), show(p.rows[0].changes));
    apply(p);
    ok('…and kept on the device', show(getNode('pc').access) === show([{ kind: 'ssh', port: 2200, user: 'ana' }, { kind: 'web', tls: true, path: '/ui' }]), show(getNode('pc').access));
    p = planOf(hd + 'pc,PC,ssh; smoke signals\n');
    ok('a cell that is not understood is said on its row, nothing written', statuses(p) === 'conflict' && /not a valid/.test(whys(p)), whys(p));
    p = planOf(hd + 'pc,PC,none\n');
    apply(p);
    ok('"none" takes them away', statuses(p) === 'change' && !('access' in getNode('pc')), show(getNode('pc').access));
    ok('a blank cell leaves them as they are', statuses(planOf(hd + 'nas,NAS,\n')) === 'same' && getNode('nas').access.length === 6);

    // ---- 3. cables.csv ----
    open(doc());
    const cab = csvCablesSheet();
    const wo = cab.headers.indexOf('way_out');
    ok('cables.csv has way_out, last', wo === cab.headers.length - 1 && cab.rows.map((r) => r[wo]).join() === 'primary,backup,,', cab.rows.map((r) => r[wo]).join());
    const cback = planOf(csvText(cab));
    ok('its round trip changes nothing', cback.errors.length === 0 && cback.counts.change === 0 && cback.counts.conflict === 0, show(cback.counts) + ' ' + whys(cback));
    const ch = 'cable_id,from_device,to_device,way_out\n';
    p = planOf(ch + 'l1,net,rt,backup\nl2,lte,rt,none\n');
    ok('a way out changed and cleared from the sheet', statuses(p) === 'change,change' && p.rows[0].changes[0].after === 'Back-up' && p.rows[1].changes[0].after === '', show(p.rows.map((r) => r.changes)));
    apply(p);
    ok('…and kept on the cables', getLink('l1').uplink === 'backup' && !('uplink' in getLink('l2')), show([getLink('l1').uplink, getLink('l2').uplink]));
    p = planOf(ch + 'l1,net,rt,sideways\n');
    ok('a word that is neither is refused', statuses(p) === 'conflict' && /not a valid/.test(whys(p)), whys(p));
    ok('Back-up and Primary read however they are typed', planOf(ch + 'l1,net,rt,Back-up\n').rows[0].status === 'same' && planOf(ch + 'l1,net,rt,PRIMARY\n').rows[0].changes[0].after === 'Primary');

    // ---- 4. lists.csv ----
    open(doc({ lists: [] }));
    ok('no list, no lists.csv', !CSV_SHEETS.find((s) => s.key === 'lists').shown());
    open(doc());
    ok('listed once there is one, labelled Address lists', CSV_SHEETS.find((s) => s.key === 'lists').shown() && csvSheetLabel(CSV_SHEETS.find((s) => s.key === 'lists')) === 'Address lists');
    const ls = csvListsSheet();
    ok('every field under its csv name', ls.headers.join() === 'list_id,name,addresses,may_not_reach,may_reach,notes', ls.headers.join());
    ok('the addresses and the rules, a rule by the other list\'s name', show(ls.rows[0]) === show(['al1', 'Office', '192.168.1.0/26; 192.168.1.200', 'Cameras', '', 'Desks']) && show(ls.rows[1]) === show(['al2', 'Cameras', '192.168.1.100', '', 'Office', ''])
      && show(ls.rows[2]) === show(['al3', 'Empty', '', '', '', '']), show(ls.rows));
    const ltext = csvText(ls);
    const lback = planOf(ltext);
    ok('the sheet is known for what it is', csvSheetKind(csvAutoMap(sheetOf(ltext))) === 'lists');
    ok('its round trip changes nothing', lback.errors.length === 0 && statuses(lback) === 'same,same,same', statuses(lback) + ' ' + whys(lback));
    open(doc({ lists: [{ id: 'al1', name: 'Twin', members: ['10.0.0.1'], blocked: ['al2'] }, { id: 'al2', name: 'Twin', members: ['10.0.0.2'] }] }));
    ok('two lists of one name: a rule names the other by its id', csvListsSheet().rows[0][3] === 'al2' && statuses(planOf(csvText(csvListsSheet()))) === 'same,same', show(csvListsSheet().rows[0]));
    open(doc({ lists: [] }));
    // The rows the other way round: a rule names a list a later row makes.
    const rev = ltext.split(/\r?\n/).filter(Boolean);
    const made = planOf([rev[0], rev[2], rev[1], rev[3]].join('\n') + '\n');
    ok('into an empty network every row is a new list', made.errors.length === 0 && statuses(made) === 'add,add,add', statuses(made) + ' ' + whys(made));
    apply(made);
    ok('…with its id, addresses, rules and notes, the rule a later row satisfied too', show(serializeLists(state.lists).sort((a, b) => a.id.localeCompare(b.id))) === show(serializeLists(normalizeLists(lists))),
      show(serializeLists(state.lists)));
    ok('one undo step takes the sheet back', (undo(), (state.lists || []).length === 0));

    // ---- 5. Refusals and changes ----
    open(doc());
    const lh = 'list_id,name,addresses,may_not_reach,may_reach,notes\n';
    p = planOf(lh + 'al3,Empty,10.0.0.1-10.0.0.9,,,\n');
    ok('a range is not an address', statuses(p) === 'conflict' && /not a valid/.test(whys(p)), whys(p));
    p = planOf(lh + 'al3,Empty,,Guests,,\n');
    ok('a rule naming a list nobody has is refused, the list named', statuses(p) === 'conflict' && /Guests is not an address list/.test(whys(p)), whys(p));
    p = planOf(lh + ',,10.9.9.9,,,\n');
    ok('a new list needs its name', statuses(p) === 'conflict' && /needs its name/.test(whys(p)), whys(p));
    p = planOf(lh + 'al1,Office,,,,\n,office,,,,\n');
    ok('two rows for one list: the second is refused', statuses(p) === 'same,conflict' && /Another row is this address list/.test(whys(p)), statuses(p));
    p = planOf(lh + 'al3,Empty,,Empty,,\n');
    ok('a list cannot name itself', statuses(p) === 'conflict');
    const mixed = sheetOf('list_id,name,addresses,serial\nal1,Office,10.0.0.1,X1\n');
    const mmap = csvAutoMap(mixed); mmap[3] = 'serial';
    ok('a sheet that mixes in a device\'s column is refused whole', csvSheetKind(mmap) === 'mixed-lists' && /maps only what a list has/.test(csvPlan(mixed, mmap).errors.join()));
    p = planOf(lh + 'al3,Guests,"10.5.0.0/24; 10.5.1.1",Office; al2,,Visitors\nal1,,,none,,\n');
    ok('a change: a name, addresses, a rule by name and by id, notes; and a rule cleared', statuses(p) === 'change,change' && p.rows[0].changes.length === 4 && p.rows[1].changes.length === 1 && p.rows[1].changes[0].before === 'Cameras', show(p.rows.map((r) => r.changes)));
    apply(p);
    ok('…kept', show(listById('al3')) === show({ id: 'al3', name: 'Guests', members: ['10.5.0.0/24', '10.5.1.1'], blocked: ['al1', 'al2'], notes: 'Visitors' }) && !('blocked' in listById('al1')) && listById('al1').members.length === 2,
      show(listById('al3')));

    // ---- 6. What is in no sheet, and the words ----
    open(doc());
    ok('a device\'s picture is in no sheet', CSV_SHEETS.every((s) => !csvText(s.build()).includes('iVBORw0KGgo')));
    const { has, locales } = window.CarinoI18N;
    const strings = ['Rows of address lists: {n}', 'Address lists', 'Two address lists are named {name}. Give the row its list_id.', 'A new address list needs its name.', 'Another row is this address list.',
      'A network holds at most {n} address lists.', '{value} is not an address list of this network or of this sheet.',
      'A sheet of address lists maps only what a list has: its name, addresses, the lists it may not reach, the lists it may reach and notes. Leave the other columns unmapped.'];
    locales.forEach((loc) => ok(`${loc} carries the strings`, strings.every((s) => has(loc, s)), strings.filter((s) => !has(loc, s)).join(' | ')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
