// Capacity, stage 3 (docs/BACKLOG.md feature 2, landing order step 5): the
// address-capacity note on whole subnets (no DHCP pool yet), and where it is
// read. What is held here:
//   1. the note (capacityFindings, addressCapacityNote in js/model.js): a /24
//      fires at 26 free (228 used: 227 devices and its undrawn gateway) and
//      not at 27 (the same devices with no gateway); a retired device's
//      address is free; a /28 fires at 2 free (plural) and 1 (singular), a
//      full one has its own wording; a /29 never (a transit link), IPv6
//      never; an implied subnet fires, named and scoped by its CIDR; the
//      note names the in-service holders (never a retired one) and is
//      scoped to the network's id;
//   2. it is info: never counted, no badge, out of the report's findings
//      and counts, an info line in the Findings tab;
//   3. accepting it: one undo step, a device joining reopens it, accepting
//      one subnet does not cover another; its check name;
//   4. translated: the sentences, the check name and the summary's words in
//      es, pt-BR, ja and ru, no placeholder or English left, Spanish
//      singular/plural, Russian on the counting form;
//   5. the report: the Capacity section's Addresses table (every subnet,
//      size, in use, free; a noted row marked, an implied one muted, IPv6
//      as 2^64 with no free count), before the Ports table, there with only
//      subnets, absent with neither; the counts leave the note out;
//   6. the Simple summary's Room to grow: the subnet half after the
//      switches', one network or several, the nearly full and full ones by
//      name, cut after SUMMARY_WHERE_MAX, left out when no subnet can run out,
//      each free address once over nested networks, a retired-only implied
//      subnet left out,
//      Russian counting form;
//   7. the table's Subnets tab: In use and Free columns, read-only, from the
//      same numbers, an implied subnet too, IPv6 a muted dash, a noted subnet
//      marked, Free sorting as a number, its headings translated;
//   8. the documented state: a report dated in the past prints the same
//      Addresses table; a binder's site counts its own subnets inside
//      withDoc and its note stays out of the estate's counts;
//   9. the shipped samples: no simple sample raises the note (the
//      SIMPLE_SAMPLES "no finding at all" promise), and on every template,
//      the Full Showcase too, the notes name exactly the subnets the spec's
//      rule, worked out here, calls nearly full.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const open = (doc) => replaceDocument({ v: DOC_VERSION, links: [], networks: [], ...doc }, { origin: 'file' });
  // `count` PCs on base.from, base.from+1, …, as /prefix, ids tag1, tag2, …
  const pcs = (tag, base, from, count, prefix, extra) => {
    const list = [];
    for (let k = 0; k < count; k++) {
      list.push({ id: `${tag}${k + 1}`, type: 'pc', name: `${tag.toUpperCase()}-${k + 1}`, x: 0, y: 0,
        interfaces: [{ id: 'i1', name: 'eth0', ip: `${base}.${from + k}/${prefix}` }], ...(extra || {}) });
    }
    return list;
  };
  const notes = () => topologyFindings().filter((f) => f.key === 'address-capacity');
  const noteOn = (scope) => notes().find((f) => f.scope === scope) || null;
  const room = (m) => (summarySheet(m).match(/<p class="room">([^<]*)/) || [])[1] || '';
  setLocale('en');

  try {
    // ---- 1. The note ----
    open({ networks: [
        { id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1' },
        { id: 'n2', cidr: '10.0.2.0/24', name: 'Lab' },
        { id: 'n8', cidr: '10.0.8.0/29', name: 'Transit' },
        { id: 'n6', cidr: '2001:db8::/64', name: 'Six' }],
      nodes: [...pcs('a', '10.0.1', 2, 227, 24), ...pcs('b', '10.0.2', 1, 227, 24),
        ...pcs('r', '10.0.2', 240, 3, 24, { status: 'retired' }),
        ...pcs('t', '10.0.8', 1, 6, 29),
        { id: 'v6', type: 'server', name: 'V6', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '2001:db8::5/64' }] }] });
    const office = noteOn('n1');
    ok('a /24 with 227 devices and its undrawn gateway: 26 free of 254, an info note', !!office && office.level === 'info'
       && office.check === 'Address capacity' && office.subject === 'Office' && office.detail === '10.0.1.0/24 has 26 free addresses of 254.', show(office));
    ok('it names the 227 holders and no cable, scoped to the network\'s id', !!office && office.nodeIds.length === 227
       && office.nodeIds.every((id) => /^a\d+$/.test(id)) && !(office.linkIds || []).length && office.scope === 'n1');
    ok('the same 227 devices with no gateway: 27 free, nothing', !noteOn('n2') && subnetCapacity(networkById('n2')).free === 27,
       show(subnetCapacity(networkById('n2'))));
    ok('a retired device\'s address is free (not counted, not named)', subnetCapacity(networkById('n2')).used === 227);
    ok('a full /29 is a transit link: nothing', !noteOn('n8') && subnetCapacity(networkById('n8')).free === 0);
    ok('IPv6 never runs out by hand: nothing', !noteOn('n6') && addressCapacityNote(networkById('n6')) === null);
    ok('the helper agrees with the findings', !!addressCapacityNote(networkById('n1')) && !addressCapacityNote(networkById('n2')));
    // The spec's own pair: 230 used of a /24 fires, 200 does not.
    open({ networks: [{ id: 'x', cidr: '10.1.0.0/24' }, { id: 'y', cidr: '10.2.0.0/24' }],
      nodes: [...pcs('x', '10.1.0', 1, 230, 24), ...pcs('y', '10.2.0', 1, 200, 24)] });
    ok('230 used of a /24: a note; 200: nothing', !!noteOn('x') && !noteOn('y'), show(notes().map((f) => f.scope)));

    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes: pcs('c', '10.0.9', 1, 12, 28) });
    ok('a /28 with 12 used: 2 free of 14, the plural', !!noteOn('n4') && noteOn('n4').detail === '10.0.9.0/28 has 2 free addresses of 14.', show(noteOn('n4')));
    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes: pcs('c', '10.0.9', 1, 11, 28) });
    ok('with 11 used: 3 free, nothing', !noteOn('n4'));
    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes: pcs('c', '10.0.9', 1, 13, 28) });
    ok('with 13 used: the singular', !!noteOn('n4') && noteOn('n4').detail === '10.0.9.0/28 has 1 free address of 14.', show(noteOn('n4')));
    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes: [...pcs('c', '10.0.9', 1, 13, 28), ...pcs('old', '10.0.9', 14, 1, 28, { status: 'retired' })] });
    ok('a retired device in a noted subnet: its address is free and the note does not name it', !!noteOn('n4')
       && noteOn('n4').detail === '10.0.9.0/28 has 1 free address of 14.' && noteOn('n4').nodeIds.length === 13
       && !noteOn('n4').nodeIds.includes('old1'), show(noteOn('n4')));
    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes: pcs('c', '10.0.9', 1, 14, 28) });
    ok('with 14 used: the full wording', !!noteOn('n4')
       && noteOn('n4').detail === '10.0.9.0/28 has no free address: all 14 are in use. Plan a bigger subnet, or move some devices to another one.', show(noteOn('n4')));
    open({ nodes: pcs('i', '10.0.7', 1, 27, 27) });
    const implied = noteOn('10.0.7.0/27');
    ok('an implied /27 with 27 used: named and scoped by its CIDR', !!implied && implied.subject === '10.0.7.0/27'
       && implied.detail === '10.0.7.0/27 has 3 free addresses of 30.' && implied.nodeIds.length === 27, show(implied));

    // ---- 2. Info: listed, never counted ----
    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes: pcs('c', '10.0.9', 1, 13, 28) });
    const all = topologyFindings();
    const counts = findingCounts(all);
    ok('the note is not counted', counts.critical === 0 && counts.advisory === 0 && counts.open === 0
       && all.filter((f) => f.key === 'address-capacity').every((f) => !isCountedFinding(f)), show(counts));
    ok('no badge on its devices', !nodeSeverity(getNode('c1')));
    const rm = reportModel();
    ok('the report\'s findings and counts leave it out', !rm.findings.concat(rm.accepted || []).some((f) => f.key === 'address-capacity')
       && rm.counts.critical === 0 && rm.counts.advisory === 0, show(rm.counts));
    validateTopology();
    const infoLines = [...document.querySelectorAll('#conflictMsgList .ca-item.info')].map((li) => li.textContent);
    const faultLines = [...document.querySelectorAll('#conflictMsgList .ca-item:not(.info)')].length;
    ok('the Findings tab lists it as an info line, no fault', infoLines.some((x) => x.includes('10.0.9.0/28 has 1 free address of 14.')) && !faultLines,
       show(infoLines));

    // ---- 3. Accepting it ----
    ok('its check name', FINDING_CHECK_NAMES['address-capacity'] === 'Address capacity' && findingCheckName('address-capacity') === 'Address capacity');
    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }, { id: 'n5', cidr: '10.0.5.0/28', name: 'Doors' }],
      nodes: [...pcs('c', '10.0.9', 1, 12, 28), ...pcs('d', '10.0.5', 1, 12, 28)] });
    initHistory();
    ok('the fixture: both noted', !!noteOn('n4') && !!noteOn('n5'));
    ok('accepted with a reason', acceptFindings([noteOn('n4')], 'Cameras only, it never grows'));
    ok('and it is one undo step', document.getElementById('undoBtn').disabled === false && _undoStack.length === 1, String(_undoStack.length));
    ok('it reads accepted, scoped to its network; the other subnet stays open',
       !!noteOn('n4').accepted && state.accepted[0].scope === 'n4' && !noteOn('n5').accepted, show(state.accepted));
    state.nodes.push(...pcs('cx', '10.0.9', 13, 1, 28));
    ok('another device joining reopens it', !!noteOn('n4') && !noteOn('n4').accepted && noteOn('n4').nodeIds.length === 13, show(noteOn('n4')));

    // ---- 4. Translated ----
    const tdoc = () => ({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }, { id: 'n5', cidr: '10.0.5.0/28', name: 'Doors' },
      { id: 'n3', cidr: '10.0.3.0/28', name: 'Full' }],
      nodes: [...pcs('c', '10.0.9', 1, 13, 28), ...pcs('d', '10.0.5', 1, 12, 28), ...pcs('f', '10.0.3', 1, 14, 28)] });
    open(tdoc());
    ok('English: three notes', notes().length === 3);
    const left = [];
    ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => {
      setLocale(loc);
      const fs = notes();
      const sum = summarySheet(reportModel());
      const words = fs.map((f) => f.detail).concat([findingCheckName('address-capacity'), sum, reportHtml(reportModel(), null)]);
      if (fs.length !== 3 || words.some((w) => /\{[a-z]+\}/.test(w))) left.push(`${loc}: placeholder`);
      if (fs.some((f) => /free address|in use|Plan a bigger/.test(f.detail)) || findingCheckName('address-capacity') === 'Address capacity') left.push(`${loc}: English left`);
      if (/free address|almost full|The network/.test(sum)) left.push(`${loc}: summary in English`);
      if (/<h3>Addresses<\/h3>|In use counts the devices/.test(reportHtml(reportModel(), null))) left.push(`${loc}: report in English`);
    });
    ok('translated in every locale, nothing left in English', !left.length, left.join(' | '));
    setLocale('es');
    ok('Spanish: one free address in the singular, two in the plural',
       noteOn('n4').detail === '10.0.9.0/28 tiene 1 dirección libre de 14.' && noteOn('n5').detail === '10.0.5.0/28 tiene 2 direcciones libres de 14.',
       `${noteOn('n4').detail} | ${noteOn('n5').detail}`);
    setLocale('ru');
    ok('Russian counts with "свободно адресов: n", which reads for any n', noteOn('n4').detail === 'В 10.0.9.0/28 свободно адресов: 1 из 14.', noteOn('n4').detail);
    ok('and so does Room to grow', room(reportModel()).startsWith('Свободных адресов в сетях: 3.'), room(reportModel()));
    setLocale('ja');
    ok('Japanese has its own words', noteOn('n4').detail === '10.0.9.0/28 の空きアドレスは 14 中 1 です。', noteOn('n4').detail);
    setLocale('en');

    // ---- 5. The report ----
    open({ networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1' }, { id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' },
        { id: 'n6', cidr: '2001:db8::/64' }],
      nodes: [...pcs('a', '10.0.1', 2, 3, 24), ...pcs('c', '10.0.9', 1, 13, 28), ...pcs('i', '192.168.50', 10, 2, 24),
        { id: 'v6', type: 'server', name: 'V6', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '2001:db8::5/64' }] }] });
    const model = reportModel();
    const subs = model.capacity.subnets;
    ok('model.capacity lists every subnet with its numbers', show(subs.map((s) => [s.network, s.size, s.used, s.free, s.near]))
       === show([['10.0.1.0/24', 254, 4, 250, false], ['10.0.9.0/28', 14, 13, 1, true], ['192.168.50.0/24', 254, 2, 252, false], ['2001:db8::/64', null, 1, null, false]]),
       show(subs));
    const html = reportHtml(model, null);
    const at = (h) => html.indexOf(`<h2>${h}</h2>`);
    ok('a Capacity section with only subnets, after Addressing', at('Capacity') > at('Addressing') && at('Addressing') > 0);
    const capPart = html.slice(at('Capacity'), at('Scope and method'));
    ok('holding an Addresses table and no Ports table', capPart.includes('<h3>Addresses</h3>') && capPart.includes('<table class="capacity addresses">')
       && !capPart.includes('<h3>Ports</h3>'), capPart.slice(0, 400));
    ok('a declared subnet: CIDR, name, size, in use, free', /<td><span class="mono"><b>10\.0\.1\.0\/24<\/b><\/span> Office<\/td>\s*<td class="mono">254<\/td>\s*<td>4<\/td>\s*<td>250<\/td>/.test(capPart));
    ok('the noted one has its free count marked', /<b>10\.0\.9\.0\/28<\/b><\/span> Cams<\/td>\s*<td class="mono">14<\/td>\s*<td>13<\/td>\s*<td><span class="sev warn">1<\/span><\/td>/.test(capPart));
    ok('an implied one is muted, as in Addressing', /<b>192\.168\.50\.0\/24<\/b><\/span><br><span class="muted">Not declared: implied by the addresses<\/span><\/td>/.test(capPart));
    ok('IPv6: 2^64 and its use, no free count', /<b>2001:db8::\/64<\/b><\/span><\/td>\s*<td class="mono">2\^64<\/td>\s*<td>1<\/td>\s*<td><span class="muted">—<\/span><\/td>/.test(capPart),
       (capPart.match(/2001:db8[^]*?<\/tr>/) || [])[0]);
    const others = findingCounts(topologyFindings().filter((f) => f.key !== 'address-capacity'));
    ok('the counts still leave the note out (the same as without it)', model.counts.critical === others.critical && model.counts.advisory === others.advisory
       && !model.findings.some((f) => f.key === 'address-capacity'), show([model.counts, others]));
    // With a nearly full switch as well: the Addresses table first.
    const sw = { id: 'sw', type: 'switch', name: 'Closet', x: 0, y: 0, portCount: 8, interfaces: [] };
    const swPcs = [], swLinks = [];
    for (let p = 1; p <= 7; p++) {
      swPcs.push({ id: `h${p}`, type: 'pc', name: `H${p}`, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: `10.0.9.${p}/28` }] });
      swLinks.push({ id: `l${p}`, source: 'sw', target: `h${p}`, sourceIface: `p${p}`, targetIface: 'i1' });
    }
    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes: [sw, ...swPcs], links: swLinks });
    const both = reportHtml(reportModel(), null, { technical: true, sections: { capPorts: true } });
    ok('with a nearly full switch too: Addresses, then Ports', both.indexOf('<h3>Addresses</h3>') > 0 && both.indexOf('<h3>Addresses</h3>') < both.indexOf('<h3>Ports</h3>'));
    open({ nodes: [{ id: 'p', type: 'pc', name: 'P', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0' }] }] });
    ok('no subnet and no noted switch: no Capacity section', !reportHtml(reportModel(), null).includes('<h2>Capacity</h2>')
       && !reportModel().capacity.subnets.length && reportModel().capacity.addresses === null);

    // ---- 6. Room to grow ----
    open({ networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1' }], nodes: pcs('a', '10.0.1', 2, 3, 24) });
    ok('one network: "The network has 250 free addresses."', room(reportModel()) === 'The network has 250 free addresses.', room(reportModel()));
    open(tdoc());
    ok('several, with the nearly full and full ones by name', room(reportModel())
       === 'The networks have 3 free addresses. The network Full is full: all 14 addresses are in use. The network Doors is almost full: 2 free addresses of 14. The network Cams is almost full: 1 free address of 14.',
       room(reportModel()));
    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28' }], nodes: pcs('c', '10.0.9', 1, 13, 28) });
    ok('one network, one free address: the singular, named by its CIDR when it has no name',
       room(reportModel()) === 'The network has 1 free address. The network 10.0.9.0/28 is almost full: 1 free address of 14.', room(reportModel()));
    open({ networks: [{ id: 'n1', cidr: '10.0.1.0/24' }], nodes: [sw, ...swPcs.map((n, k) => ({ ...n, interfaces: [{ id: 'i1', name: 'eth0', ip: `10.0.1.${k + 2}/24` }] }))], links: swLinks });
    ok('the switches first, then the subnets', room(reportModel()) === 'The switch has 1 free port. Closet is almost full: 1 free port of 8. The network has 247 free addresses.',
       room(reportModel()));
    open({ networks: [{ id: 'w', cidr: '203.0.113.0/30' }, { id: 'n6', cidr: '2001:db8::/64' }],
      nodes: [{ id: 'v6', type: 'server', name: 'V6', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '2001:db8::5/64' }, { id: 'i2', name: 'wan', ip: '203.0.113.2/30' }] }] });
    const none = reportModel();
    ok('only a /30 and IPv6: no address half, no Room to grow line (the Addresses table stays)', none.capacity.addresses === null
       && !summarySheet(none).includes('Room to grow') && reportHtml(none, null).includes('<h3>Addresses</h3>'), show(none.capacity.addresses));
    // A free address is added once: a /24 declared inside a /16 is already in
    // the /16's free count (65534 - 10), and an implied /24 around a declared
    // /25 is the same.
    open({ networks: [{ id: 'big', cidr: '10.0.0.0/16' }, { id: 'in', cidr: '10.0.1.0/24' }], nodes: pcs('p', '10.0.1', 2, 10, 24) });
    ok('nested networks: each free address counted once', reportModel().capacity.addresses.free === 65524
       && room(reportModel()) === 'The networks have 65524 free addresses.', room(reportModel()));
    open({ networks: [{ id: 'h', cidr: '10.0.1.0/25' }], nodes: [...pcs('q', '10.0.1', 10, 1, 25), ...pcs('z', '10.0.1', 200, 1, 24)] });
    ok('an implied /24 around a declared /25: counted once', reportModel().capacity.addresses.free === 252, show(reportModel().capacity.addresses));
    // An implied subnet only a retired device holds is off the network: no
    // room to grow (its row stays in the Addresses table).
    open({ networks: [{ id: 'n1', cidr: '192.168.1.0/24' }],
      nodes: [...pcs('a', '192.168.1', 2, 3, 24), ...pcs('old', '10.9.9', 5, 1, 24, { status: 'retired' })] });
    ok('a retired-only implied subnet is not room to grow', room(reportModel()) === 'The network has 251 free addresses.'
       && reportModel().capacity.subnets.some((r) => r.network === '10.9.9.0/24'), room(reportModel()));
    const many = { networks: [], nodes: [] };
    for (let i = 1; i <= SUMMARY_WHERE_MAX + 2; i++) {
      many.networks.push({ id: `m${i}`, cidr: `10.9.${i}.0/28` });
      many.nodes.push(...pcs(`m${i}x`, `10.9.${i}`, 1, 14, 28));
    }
    open(many);
    const cut = room(reportModel());
    ok('past SUMMARY_WHERE_MAX nearly full networks, the rest are counted', (cut.match(/is full/g) || []).length === SUMMARY_WHERE_MAX && cut.endsWith('…and 2 more.'), cut);

    // ---- 7. The table's Subnets tab ----
    open({ networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1' }, { id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' },
        { id: 'n6', cidr: '2001:db8::/64' }],
      nodes: [...pcs('a', '10.0.1', 2, 3, 24), ...pcs('c', '10.0.9', 1, 13, 28), ...pcs('i', '192.168.50', 10, 2, 24),
        { id: 'v6', type: 'server', name: 'V6', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '2001:db8::5/64' }] }] });
    const cols = tvCols('subnets');
    const usedCol = cols.find((c) => c.key === 'used'), freeCol = cols.find((c) => c.key === 'free');
    ok('the Subnets tab has In use and Free columns, after Devices', !!usedCol && !!freeCol
       && cols.indexOf(usedCol) === cols.findIndex((c) => c.key === 'members') + 1 && cols.indexOf(freeCol) === cols.indexOf(usedCol) + 1);
    ok('read-only: worked out, never typed', usedCol.editor === null && freeCol.editor === null && !(usedCol.can && usedCol.can({ ref: { netId: 'n1' } })));
    const rows = tvBuildRows('subnets');
    const cellOf = (col, cidr) => col.show(rows.find((r) => r.data.network === cidr));
    ok('the numbers are the Capacity section\'s', show(rows.map((r) => [r.data.network, cellOf(usedCol, r.data.network).text, cellOf(freeCol, r.data.network).text]))
       === show([['10.0.1.0/24', '4', '250'], ['10.0.9.0/28', '13', '1'], ['192.168.50.0/24', '2', '252'], ['2001:db8::/64', '1', '—']]),
       show(rows.map((r) => r.data.network)));
    ok('an IPv6 subnet\'s Free is a muted dash saying its size', cellOf(freeCol, '2001:db8::/64').muted && cellOf(freeCol, '2001:db8::/64').title === '1 used · 2^64 addresses',
       show(cellOf(freeCol, '2001:db8::/64')));
    ok('the noted subnet is marked', cellOf(freeCol, '10.0.9.0/28').sev === 'warn' && cellOf(freeCol, '10.0.9.0/28').title === 'Almost out of free addresses'
       && !cellOf(freeCol, '10.0.1.0/24').sev, show(cellOf(freeCol, '10.0.9.0/28')));
    ok('Free sorts as a number (1 before 250)', freeCol.sort === 'num' && freeCol.sortKey(rows.find((r) => r.data.network === '10.0.9.0/28')) === 1);
    setLocale('es');
    ok('its headings are translated in the reporter\'s words', tvLabel(usedCol) === 'En uso' && tvLabel(freeCol) === 'Libre', `${tvLabel(usedCol)} ${tvLabel(freeCol)}`);
    setLocale('en');

    // ---- 8. The documented state ----
    open({ networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes: pcs('c', '10.0.9', 1, 13, 28, { inService: '2015-01-01' }) });
    const today = reportModel({ date: '' }), past = reportModel({ date: '2016-01-01' });
    ok('a report dated in the past prints the same Addresses table and Room to grow line',
       show(past.capacity) === show(today.capacity) && capacitySection(past.capacity) === capacitySection(today.capacity) && room(past) === room(today));
    const tight = { v: DOC_VERSION, networks: [{ id: 'n4', cidr: '10.0.9.0/28', name: 'Cams' }], nodes: pcs('c', '10.0.9', 1, 13, 28), links: [] };
    const roomy = { v: DOC_VERSION, networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office' }], nodes: pcs('a', '10.0.1', 2, 2, 24), links: [] };
    loadDocState(cloneData(roomy));
    const canvas = JSON.stringify(serializeDoc());
    const b = binderModel([{ id: 's1', name: 'Tight', updated: 1, doc: cloneData(tight) }, { id: 's2', name: 'Roomy', updated: 1, doc: cloneData(roomy) }],
      { site: 'Estate', client: '', engineer: '', ref: '', date: '', scope: '' });
    const capOf = (name) => ((b.sites.find((s) => s.name === name) || {}).model || {}).capacity;
    ok('a binder\'s site counts its own subnets, not the open canvas\'s', !!capOf('Tight')
       && show(capOf('Tight').subnets.map((s) => [s.network, s.free, s.near])) === show([['10.0.9.0/28', 1, true]])
       && show(capOf('Roomy').subnets.map((s) => [s.network, s.free, s.near])) === show([['10.0.1.0/24', 252, false]]),
       show(b.sites.map((s) => s.model && s.model.capacity)));
    ok('and its note stays out of the estate\'s counts', b.counts.critical === 0 && b.counts.advisory === 0
       && !(b.findings || []).some((f) => f.key === 'address-capacity'));
    ok('the canvas is handed back unchanged', JSON.stringify(serializeDoc()) === canvas);

    // ---- 9. The shipped samples ----
    const noisy = [], odd = [];
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'template' });
      const ns = notes();
      if (k.endsWith(SIMPLE_SUFFIX) && ns.length) noisy.push(`${k}: ${ns.map((f) => f.subject).join(', ')}`);
      // Worked out here from the spec's rule (countable IPv4, 8 usable or
      // more, free <= max(2, ceil(size / 10))), over the Addressing rows,
      // not through addressCapacityNote, which both sides read.
      const want = reportSubnets().filter((s) => s.kind === 'ipv4' && s.size !== null && s.size >= 8
        && s.free <= Math.max(2, Math.ceil(s.size / 10))).map((s) => s.id || s.network).sort();
      const capNear = reportModel().capacity.subnets.filter((s) => s.near).length;
      if (show(ns.map((f) => f.scope).sort()) !== show(want) || capNear !== want.length) odd.push(`${k}: ${show(want)} vs ${show(ns.map((f) => f.scope))}`);
    });
    ok('no simple sample raises an address-capacity note (they open with no finding at all)', !noisy.length, noisy.join(' | '));
    ok('on every template, the Full Showcase too, the notes name exactly the nearly full subnets', !odd.length && !!templatesData.showcase, odd.join(' | '));
  } catch (e) {
    ok('the suite ran', false, e && (e.stack || e.message));
  }
  setLocale('en');
  setDialogResponder(heldResponder);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 50); });
