// Capacity, stage 4 (docs/BACKLOG.md feature 2, landing order step 7): a
// subnet's DHCP pool (NETWORK_FIELDS dhcpFirst, dhcpLast) and document
// version 16. What is held here:
//   1. the format: every older version (1 to 15) opens as the current one
//      and not read-only; a v15 network opens and saves byte for byte as it
//      was but for v; the pool is written after dhcp only when it is set,
//      and kept as typed (a bad end too); a newer document opens read-only;
//      every template opens through the v16 step unchanged;
//   2. the split (subnetCapacity, dhcpPoolOf): a valid pool counts its
//      recorded addresses (devices and the gateway) inside it, fixed is the
//      rest; outside, reversed, the wrong family, the network address, one
//      end only, an end that is no address and DHCP off are each not
//      counted, with their problem, and leave fixed the whole subnet;
//   3. address-capacity measures the fixed part, with its own wording, and
//      never fires on a subnet the pool fills completely;
//   4. the 'dhcp-pool' warn: a gateway inside the pool names the router and
//      is counted; accepted with a reason it is out of the counts; scoped to
//      the network, so another subnet's stays open; a pool outside the
//      subnet raises it; DHCP off or a sound pool raise nothing; its check
//      name and its plain words;
//   5. the Subnets card: the pool's fields only with DHCP ticked (drawn at
//      once, the tick keeping the focus), the pool line, the advice in the
//      finding's words, "DHCP is off" with a pool kept; typing a pool end is
//      one undo step;
//   6. Renumber moves the pool at its host bits, and a block inserted onto
//      a used range brings its pool across with its subnet;
//   7. subnets.csv: dhcp_first and dhcp_last after dhcp, a round trip into
//      an empty map gives the same document, 'abc' refused on its row, a
//      formula-looking end escaped, the hand-listed parsers;
//   8. the table's Subnets tab: the two ends as editable columns, In pool
//      and Fixed free worked out, a pool that does not count muted with why;
//   9. the report: the Addresses table's pool columns only when a subnet
//      records a pool, Addressing's "pool a–b", the summary's plain words
//      under What needs attention and Room to grow on the fixed part;
//  10. translated in es, pt-BR, ru and ja, singular and plural;
//  11. a binder's site keeps and counts its pool, a dated report prints the
//      same, and no simple sample (no template at all) raises the finding;
//      the changes since the last back-up name the pool's ends;
//  12. freeAddresses() itself still hands out the bottom of the subnet, pool
//      or not; Add devices, bulk Move and a dropped device step round the
//      pool for fixed-address devices (owner's option C), held in
//      tests/suites/addpool.js.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const open = (doc) => replaceDocument({ v: DOC_VERSION, links: [], networks: [], ...doc }, { origin: 'file' });
  const pcs = (tag, base, from, count, prefix, extra) => {
    const list = [];
    for (let k = 0; k < count; k++) {
      list.push({ id: `${tag}${k + 1}`, type: 'pc', name: `${tag.toUpperCase()}-${k + 1}`, x: 0, y: 0,
        interfaces: [{ id: 'i1', name: 'eth0', ip: `${base}.${from + k}/${prefix}` }], ...(extra || {}) });
    }
    return list;
  };
  const router = (ip) => ({ id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'lan', ip }] });
  const pools = () => topologyFindings().filter((f) => f.key === 'dhcp-pool');
  const office = (extra) => ({ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1', dhcp: true, dhcpFirst: '10.0.1.100', dhcpLast: '10.0.1.199', ...(extra || {}) });
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
  const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
  setLocale('en');

  try {
    // ---- 1. The format ----
    ok('the document is version 16 or later', DOC_VERSION >= 16);
    const older = [];
    for (let v = 1; v < 16; v++) {
      const m = migrateDoc({ v, nodes: [{ id: 'a', type: 'pc', name: 'A', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.5/24' }] }], links: [] });
      if (m.newer || m.from !== v || m.doc.v !== DOC_VERSION) older.push(`${v}: ${show({ newer: m.newer, from: m.from, v: m.doc.v })}`);
    }
    ok('every older version, 1 to 15, opens as the current one', !older.length, older.join(' | '));
    const v15 = { v: 15, nodes: [{ id: 'a', type: 'pc', name: 'A', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.5/24' }] }], links: [],
      networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1', dhcp: true }] };
    replaceDocument(cloneData(v15), { origin: 'file' });
    const saved = serializeDoc();
    ok('a v15 file opens editable, not read-only', !state.readOnly);
    ok('and saves its subnet byte for byte, with no pool key', show(saved.networks) === show(v15.networks) && !/dhcpFirst|dhcpLast/.test(show(saved)), show(saved.networks));
    ok('stamped as the current version', saved.v === DOC_VERSION);
    // The v16 step itself changes nothing but v.
    const step = migrateDoc(Object.assign(cloneData(v15), { v: 15 })).doc;
    ok('the 15 to 16 step changes nothing but v', show({ ...step, v: 15 }) === show(v15));
    open({ networks: [office()], nodes: [router('10.0.1.1/24')] });
    ok('a pool is written after dhcp, as typed', show(serializeDoc().networks[0]) === show({ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1', dhcp: true, dhcpFirst: '10.0.1.100', dhcpLast: '10.0.1.199' }),
       show(serializeDoc().networks[0]));
    open({ networks: [office({ dhcpFirst: ' 10.0.1.x ', dhcpLast: '' })] });
    ok('a bad end is kept as typed, an empty one left out', serializeDoc().networks[0].dhcpFirst === ' 10.0.1.x ' && !/dhcpLast/.test(show(serializeDoc().networks[0])), show(serializeDoc().networks[0]));
    replaceDocument({ v: DOC_VERSION + 1, nodes: [], links: [], networks: [office()] }, { origin: 'file' });
    ok('a newer document opens read-only', !!state.readOnly);
    const odd = [];
    Object.keys(templatesData).forEach((k) => {
      const doc = cloneData(templatesData[k]);
      const m = migrateDoc({ ...doc, v: 15 });
      if (show({ ...m.doc, v: doc.v }) !== show(doc)) odd.push(k);
    });
    ok('every template opens through the v16 step unchanged', !odd.length, odd.join(', '));

    // ---- 2. The split ----
    open({ networks: [office()], nodes: [router('10.0.1.1/24'), ...pcs('a', '10.0.1', 2, 10, 24), ...pcs('p', '10.0.1', 150, 3, 24)] });
    let cap = subnetCapacity(networkById('n1'));
    ok('a valid pool: 3 of its 100 addresses recorded, 97 free', show(cap.pool) === show({ first: '10.0.1.100', last: '10.0.1.199', valid: true, problem: null, size: 100, used: 3, free: 97 }), show(cap.pool));
    ok('fixed is the rest: 154, 11 used (the router and ten PCs), 143 free', show(cap.fixed) === show({ size: 154, used: 11, free: 143 }) && cap.used === 14 && cap.free === 240, show(cap));
    open({ networks: [office({ gateway: '10.0.1.150' })], nodes: pcs('a', '10.0.1', 2, 2, 24) });
    cap = subnetCapacity(networkById('n1'));
    ok('an undrawn gateway inside the pool is recorded in it', cap.pool.used === 1 && cap.fixed.used === 2, show(cap));
    const problem = (extra) => { open({ networks: [office(extra)] }); const c = subnetCapacity(networkById('n1')); return [c.pool.valid, c.pool.problem, c.fixed.size]; };
    ok('outside the subnet: not counted', show(problem({ dhcpFirst: '10.0.2.5', dhcpLast: '10.0.2.9' })) === show([false, 'outside', 254]));
    ok('reversed: not counted', show(problem({ dhcpFirst: '10.0.1.199', dhcpLast: '10.0.1.100' })) === show([false, 'reversed', 254]));
    ok('the wrong family: not counted', show(problem({ dhcpFirst: '2001:db8::1', dhcpLast: '2001:db8::9' })) === show([false, 'family', 254]));
    ok('taking in the network address: not counted', show(problem({ dhcpFirst: '10.0.1.0', dhcpLast: '10.0.1.50' })) === show([false, 'edge', 254]));
    ok('or the broadcast address', show(problem({ dhcpFirst: '10.0.1.200', dhcpLast: '10.0.1.255' })) === show([false, 'edge', 254]));
    ok('one end only: not counted', show(problem({ dhcpLast: undefined })) === show([false, 'half', 254]));
    ok('an end that is no address: not counted', show(problem({ dhcpFirst: 'abc' })) === show([false, 'unreadable', 254]));
    ok('DHCP unticked: the pool is kept and ignored', show(problem({ dhcp: undefined })) === show([false, 'off', 254]));
    open({ networks: [{ id: 'n1', cidr: '10.0.1.0/24' }] });
    ok('no pool recorded: pool is null, fixed the whole subnet', subnetCapacity(networkById('n1')).pool === null && subnetCapacity(networkById('n1')).fixed.size === 254);
    open({ networks: [office({ cidr: '10.0.0.0/8', dhcpFirst: '10.0.0.1', dhcpLast: '10.255.255.254' })] });
    ok('a pool over a /8 is counted by arithmetic, not walked', subnetCapacity(networkById('n1')).pool.size === 16777214 && subnetCapacity(networkById('n1')).fixed.size === 0);

    // ---- 3. Address capacity on the fixed part ----
    open({ networks: [office()], nodes: pcs('a', '10.0.1', 2, 89, 24) });
    const addrNote = () => topologyFindings().find((f) => f.key === 'address-capacity') || null;
    ok('pool .100-.199, 90 fixed used of 154: nothing', !addrNote(), show(subnetCapacity(networkById('n1')).fixed));
    open({ networks: [office()], nodes: [...pcs('a', '10.0.1', 2, 98, 24), ...pcs('b', '10.0.1', 200, 51, 24)] });
    let an = addrNote();
    ok('150 fixed used of 154: the note, on the fixed part, in its own words', !!an && an.detail === '10.0.1.0/24 has 4 free addresses outside the DHCP pool, of 154.', an && an.detail);
    ok('the whole subnet would not have fired (104 free)', subnetCapacity(networkById('n1')).free === 104);
    open({ networks: [office()], nodes: [...pcs('a', '10.0.1', 2, 98, 24), ...pcs('b', '10.0.1', 200, 55, 24)] });
    an = addrNote();
    ok('full outside the pool: its own wording', !!an && an.detail === '10.0.1.0/24 has no free address outside the DHCP pool: all 154 fixed addresses are in use. Shrink the pool, plan a bigger subnet, or move some devices to another one.', an && an.detail);
    open({ networks: [office({ dhcpFirst: '10.0.1.1', dhcpLast: '10.0.1.254', gateway: '' })], nodes: pcs('a', '10.0.1', 2, 3, 24) });
    ok('a pool that fills the subnet leaves nothing fixed to run out of: no note', !addrNote());
    open({ networks: [office({ dhcp: undefined })], nodes: [...pcs('a', '10.0.1', 2, 98, 24), ...pcs('b', '10.0.1', 200, 51, 24)] });
    ok('DHCP off: the whole subnet again (104 free), no note', !addrNote() && subnetCapacity(networkById('n1')).fixed.free === 104);
    open({ networks: [office({ dhcpFirst: '10.0.1.2', dhcpLast: '10.0.1.254' })], nodes: [router('10.0.1.1/24')] });
    ok('gateway .1 and pool .2-.254: a one-address fixed part is full by design, no note', subnetCapacity(networkById('n1')).fixed.size === 1 && !addrNote(), show(addrNote()));
    open({ networks: [office({ gateway: '', dhcpFirst: '10.0.1.1', dhcpLast: '10.0.1.252' })], nodes: [] });
    ok('an empty subnet with two fixed addresses: no note', subnetCapacity(networkById('n1')).fixed.size === 2 && !addrNote(), show(addrNote()));
    open({ networks: [office({ gateway: '', dhcpFirst: '10.0.1.9', dhcpLast: '10.0.1.254' })], nodes: pcs('a', '10.0.1', 1, 7, 24) });
    ok('a fixed part of 8 still gets the note when it is full', subnetCapacity(networkById('n1')).fixed.size === 8 && !!addrNote(), show(subnetCapacity(networkById('n1')).fixed));

    // ---- 4. The dhcp-pool warn ----
    open({ networks: [office({ gateway: '10.0.1.120' }), { id: 'n2', cidr: '10.0.2.0/24', name: 'Lab', gateway: '10.0.2.120', dhcp: true, dhcpFirst: '10.0.2.100', dhcpLast: '10.0.2.199' }],
      nodes: [router('10.0.1.120/24'), ...pcs('a', '10.0.1', 2, 3, 24), ...pcs('l', '10.0.2', 2, 2, 24)] });
    let pf = pools();
    const one = pf.find((f) => f.scope === 'n1:clash');
    ok('a gateway inside the pool: a warn naming the router', !!one && one.level === 'warn' && one.check === 'DHCP pool' && one.subject === 'Office'
       && one.detail === 'The gateway 10.0.1.120 is inside the DHCP pool 10.0.1.100–10.0.1.199.' && show(one.nodeIds) === show(['rt']), show(one));
    const two = pf.find((f) => f.scope === 'n2:clash');
    ok('an undrawn gateway: the subnet\'s members are named instead', !!two && show(two.nodeIds) === show(['l1', 'l2']), show(two));
    const countsBefore = findingCounts(topologyFindings());
    ok('counted as advisory', countsBefore.advisory >= 2, show(countsBefore));
    ok('accepting it takes one reason', acceptFindings([one], 'Excluded on the server'));
    pf = pools();
    ok('accepted, it is out of the counts', pf.find((f) => f.scope === 'n1:clash').accepted && findingCounts(topologyFindings()).advisory === countsBefore.advisory - 1,
       show(findingCounts(topologyFindings())));
    ok('scoped to the network: the other subnet\'s stays open', !pf.find((f) => f.scope === 'n2:clash').accepted);
    ok('accepting the second one too', acceptFindings([pf.find((f) => f.scope === 'n2:clash')], 'Excluded on the server') && pools().every((f) => f.accepted));
    batch(() => { networkById('n2').dhcpLast = '10.0.2.50'; save(); });
    const reopened = pools().find((f) => f.subject === 'Lab');
    ok('a different problem on an accepted subnet opens again (reversed after a clash was accepted)', !!reopened && reopened.scope === 'n2:reversed' && !reopened.accepted, show(reopened));
    open({ networks: [{ id: 'n1', cidr: '10.0.1.0/33', dhcp: true, dhcpFirst: '10.0.1.100', dhcpLast: '10.0.1.199' }], nodes: pcs('a', '10.0.1', 2, 2, 24) });
    ok('a CIDR that does not parse: its pool raises nothing on top of the CIDR\'s own finding', !pools().length && dhcpPoolOf(networkById('n1')).problem === 'nocidr'
       && !poolProblemTexts(networkById('n1')).length, show(pools()));
    open({ networks: [office({ dhcpFirst: '10.0.2.5', dhcpLast: '10.0.2.9' })], nodes: pcs('a', '10.0.1', 2, 2, 24) });
    ok('a pool outside the subnet: the warn', pools().length === 1 && pools()[0].detail === 'The DHCP pool 10.0.2.5–10.0.2.9 is outside 10.0.1.0/24.', show(pools()));
    open({ networks: [office({ dns: '10.0.1.53, 8.8.8.8' })], nodes: pcs('a', '10.0.1', 2, 2, 24) });
    ok('a sound pool, gateway and DNS outside it: nothing', !pools().length, show(pools()));
    open({ networks: [office({ dns: '10.0.1.110' })], nodes: pcs('a', '10.0.1', 2, 2, 24) });
    ok('a DNS server inside it: the warn', pools().length === 1 && pools()[0].detail === 'The DNS server 10.0.1.110 is inside the DHCP pool 10.0.1.100–10.0.1.199.', show(pools()));
    open({ networks: [office({ dhcp: undefined, gateway: '10.0.1.120' })], nodes: pcs('a', '10.0.1', 2, 2, 24) });
    ok('DHCP off: the pool is not checked', !pools().length);
    ok('its check name and plain words', FINDING_CHECK_NAMES['dhcp-pool'] === 'DHCP pool'
       && show(PLAIN_FINDINGS['dhcp-pool']) === show(['The automatic address range clashes with a fixed address', 'Devices may be handed an address already in use, and lose their connection.']));

    // ---- 5. The Subnets card ----
    open({ networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1' }], nodes: [router('10.0.1.1/24'), ...pcs('p', '10.0.1', 150, 3, 24)] });
    showConfigTab('networks');
    const card = () => document.querySelector('#networkList .net-card[data-net="n1"]');
    card().querySelector('[data-act="edit"]').click();
    ok('DHCP unticked: no pool fields', !card().querySelector('[data-field="dhcpFirst"]') && !card().querySelector('[data-field="dhcpLast"]'));
    const tick = card().querySelector('[data-field="dhcp"]');
    tick.focus(); tick.checked = true; tick.dispatchEvent(new Event('change', { bubbles: true }));
    const first = card().querySelector('[data-field="dhcpFirst"]');
    ok('ticked, the two fields appear at once, mono, with example ends', !!first && first.classList.contains('mono') && first.placeholder === '10.0.1.100'
       && card().querySelector('[data-field="dhcpLast"]').placeholder === '10.0.1.199', first && first.placeholder);
    ok('and the tick keeps the focus', document.activeElement && document.activeElement.dataset.field === 'dhcp');
    const steps = () => Number((el('undoBtn').title.match(/\((\d+)\)/) || [0, 0])[1]);
    const before = steps();
    const typeIn = (key, value) => {
      const f = card().querySelector(`[data-field="${key}"]`);
      f.focus(); f.value = value.slice(0, -1); f.dispatchEvent(new Event('input', { bubbles: true }));
      f.value = value; f.dispatchEvent(new Event('input', { bubbles: true }));
      f.blur(); commitTyping();
    };
    typeIn('dhcpFirst', '10.0.1.100');
    ok('typing a pool end is one undo step', networkById('n1').dhcpFirst === '10.0.1.100' && steps() === before + 1, `${before} -> ${steps()}`);
    renderNetworksPanel(true);
    ok('one end only: the advice says so', /needs both its first and its last address/.test(card().textContent));
    typeIn('dhcpLast', '10.0.1.199');
    renderNetworksPanel(true);
    const text = () => card().textContent.replace(/\s+/g, ' ');
    ok('the pool line: range, recorded of size, fixed free', text().includes('Pool 10.0.1.100–10.0.1.199 · 3 recorded of 100 · fixed 153 free'), text().slice(0, 300));
    batch(() => { networkById('n1').gateway = '10.0.1.150'; save(); }); renderNetworksPanel(true);
    ok('a gateway inside it: the finding\'s own words on the card', text().includes('The gateway 10.0.1.150 is inside the DHCP pool 10.0.1.100–10.0.1.199.'));
    batch(() => { networkById('n1').dhcp = undefined; save(); }); renderNetworksPanel(true);
    ok('DHCP off with a pool kept: "not counted", no fields, no pool line', text().includes('DHCP is off: the pool is not counted.')
       && !card().querySelector('[data-field="dhcpFirst"]') && !text().includes('Pool 10.0.1.100'));
    undo(); undo(); undo();
    ok('undo takes the ends back one by one', isBlank(networkById('n1').dhcpLast) && networkById('n1').dhcpFirst === '10.0.1.100' && networkById('n1').dhcp === true, show(networkById('n1')));

    // ---- 6. Renumber and blocks ----
    open({ networks: [office()], nodes: [router('10.0.1.1/24'), ...pcs('a', '10.0.1', 2, 2, 24)] });
    const plan = planRenumber('n1', '10.0.9.0/24');
    ok('Renumber plans the pool too', !plan.errors.length && plan.refs.some((r) => r.key === 'dhcpFirst' && r.value === '10.0.9.100') && plan.refs.some((r) => r.key === 'dhcpLast' && r.value === '10.0.9.199'),
       show(plan.refs.map((r) => [r.key, r.value])));
    batch(() => { plan.ifaces.forEach((c) => { c.iface.ip = c.ip; }); plan.refs.forEach((r) => { r.obj[r.key] = r.value; }); plan.net.cidr = plan.to.networkStr; save(); });
    ok('renumbered 10.0.1.0/24 to 10.0.9.0/24, the pool is .9.100-.9.199', networkById('n1').dhcpFirst === '10.0.9.100' && networkById('n1').dhcpLast === '10.0.9.199'
       && subnetCapacity(networkById('n1')).pool.valid);
    const outsider = { id: 'pc9', type: 'pc', name: 'PC', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.9.100/24' }] };
    open({ networks: [office()], nodes: [router('10.0.1.1/24'), ...pcs('a', '10.0.1', 2, 19, 24), outsider] });
    const p1 = planRenumber('n1', '10.0.9.0/24');
    ok('a pool end is no address anybody holds: a device at the new pool start does not refuse the renumber', !p1.errors.length
       && p1.refs.some((r) => r.key === 'dhcpFirst' && r.value === '10.0.9.100'), show(p1.errors));
    open({ networks: [office({ dhcp: undefined })], nodes: [router('10.0.1.1/24'), ...pcs('a', '10.0.1', 2, 19, 24)] });
    const p2 = planRenumber('n1', '10.0.9.0/25');
    ok('a pool that does not fit the smaller range does not refuse it, and is left as written', !p2.errors.length
       && !p2.refs.some((r) => r.key === 'dhcpFirst' || r.key === 'dhcpLast') && p2.ifaces.length === 20, show(p2.errors));
    open({ networks: [office({ dhcpFirst: '10.0.1.0', dhcpLast: '10.0.1.50' })], nodes: [router('10.0.1.1/24')] });
    const p3 = planRenumber('n1', '10.0.9.0/24');
    ok('an edge pool does not refuse a same-size renumber', !p3.errors.length && !p3.refs.some((r) => r.key === 'dhcpFirst'), show(p3.errors));
    open({ networks: [{ id: 'm', cidr: '10.0.1.0/24' }], nodes: pcs('a', '10.0.1', 2, 2, 24) });
    const moved =readdressBlock({ networks: [{ id: 'b', cidr: '10.0.1.0/24', gateway: '10.0.1.1', dhcp: true, dhcpFirst: '10.0.1.100', dhcpLast: '10.0.1.199' }],
      nodes: pcs('x', '10.0.1', 10, 1, 24), links: [] });
    ok('a block on a used range brings its pool across with its subnet', moved.moves.length === 1 && moved.doc.networks[0].cidr === '10.0.2.0/24'
       && moved.doc.networks[0].dhcpFirst === '10.0.2.100' && moved.doc.networks[0].dhcpLast === '10.0.2.199', show(moved.doc.networks[0]));

    // ---- 7. subnets.csv ----
    open({ networks: [office(), { id: 'n2', cidr: '10.0.2.0/24' }], nodes: [router('10.0.1.1/24')] });
    const sheet = csvSubnetsSheet();
    ok('dhcp_first and dhcp_last after dhcp', sheet.headers.join() === 'network_id,cidr,name,vlan,purpose,gateway,dns,dhcp,dhcp_first,dhcp_last,draw_zone', sheet.headers.join());
    ok('the pool in its row, blank where there is none', sheet.rows[0].join() === 'n1,10.0.1.0/24,Office,,,10.0.1.1,,true,10.0.1.100,10.0.1.199,' && sheet.rows[1].join() === 'n2,10.0.2.0/24,,,,,,false,,,',
       sheet.rows.map((r) => r.join()).join(' | '));
    ok('the hand-listed parsers take an address, trimmed, and refuse one that is not', show(CSV_PARSERS['net:dhcpFirst'](' 10.0.1.5 ')) === show({ value: '10.0.1.5' })
       && CSV_PARSERS['net:dhcpLast']('abc').error === true);
    const text1 = csvText(sheet);
    const before7 = show(serializeDoc().networks);
    open({ networks: [], nodes: [] });
    let p7 = planOf(text1);
    applyCsvPlan(p7);
    ok('exported then imported into an empty map, the same networks', show(serializeDoc().networks) === before7, show(serializeDoc().networks));
    ok('and imported again over it, nothing changes', !planOf(text1).ops.length);
    p7 = planOf('cidr,dhcp,dhcp_first,dhcp_last\r\n10.0.5.0/24,yes,abc,10.0.5.9\r\n10.0.6.0/24,yes,10.0.6.2,10.0.6.9\r\n');
    ok('an end that is no address is refused on its row, the next row goes in', p7.rows[0].status === 'conflict' && /abc is not a valid/.test(p7.rows[0].why) && p7.rows[1].status === 'add',
       show(p7.rows.map((r) => [r.status, r.why])));
    p7 = planOf('cidr,dhcp start,dhcp end\r\n10.0.7.0/24,10.0.7.100,10.0.7.150\r\n');
    ok('"DHCP start" and "DHCP end" headings are read as the pool', p7.kind === 'subnets' && p7.ops.some((o) => o.net && o.net.create && o.net.create.dhcpFirst === '10.0.7.100' && o.net.create.dhcpLast === '10.0.7.150'),
       show(p7.ops));
    open({ networks: [office({ dhcpFirst: '=1+1' })] });
    ok('a formula-looking end is escaped on export, as every cell', csvText(csvSubnetsSheet()).includes(',\'=1+1,'), csvText(csvSubnetsSheet()));

    // ---- 8. The table's Subnets tab ----
    open({ networks: [office(), office({ id: 'n2', cidr: '10.0.2.0/24', name: 'Lab', gateway: '', dhcpFirst: '10.0.2.199', dhcpLast: '10.0.2.100' }), { id: 'n3', cidr: '10.0.3.0/24' }],
      nodes: [router('10.0.1.1/24'), ...pcs('p', '10.0.1', 150, 3, 24)] });
    const cols = tvCols('subnets');
    const col = (key) => cols.find((c) => c.key === key);
    ok('the two ends are editable columns after DHCP', !!col('dhcpFirst') && col('dhcpFirst').editor === 'text' && col('dhcpLast').editor === 'text'
       && cols.indexOf(col('dhcpFirst')) === cols.indexOf(col('dhcp')) + 1 && cols.indexOf(col('dhcpLast')) === cols.indexOf(col('dhcp')) + 2);
    const rows = tvBuildRows('subnets');
    const cell = (key, cidr) => col(key).show(rows.find((r) => r.data.network === cidr));
    ok('In pool: recorded of size; Fixed free: what is left outside', cell('inPool', '10.0.1.0/24').text === '3 / 100' && cell('fixedFree', '10.0.1.0/24').text === '153',
       show([cell('inPool', '10.0.1.0/24'), cell('fixedFree', '10.0.1.0/24')]));
    ok('a pool that does not count: a muted dash saying why', cell('inPool', '10.0.2.0/24').text === '—' && cell('inPool', '10.0.2.0/24').muted
       && /ends before it starts/.test(cell('inPool', '10.0.2.0/24').title) && cell('fixedFree', '10.0.2.0/24').text === '', show(cell('inPool', '10.0.2.0/24')));
    ok('no pool: blank', cell('inPool', '10.0.3.0/24').text === '' && cell('dhcpFirst', '10.0.3.0/24').text === '');
    ok('read-only, worked out', col('inPool').editor === null && col('fixedFree').editor === null);
    setLocale('es');
    ok('their headings translated', tvLabel(col('inPool')) === 'En el pool' && tvLabel(col('fixedFree')) === 'Fijas libres', `${tvLabel(col('inPool'))} ${tvLabel(col('fixedFree'))}`);
    setLocale('en');

    // ---- 9. The report ----
    const m9 = reportModel();
    const html9 = capacitySection(m9.capacity);
    ok('the Addresses table gains DHCP pool, In pool and Fixed free', /<th>DHCP pool<\/th><th>In pool<\/th><th>Fixed free<\/th>/.test(html9), html9.slice(0, 600));
    ok('a counted pool\'s cells, a reversed one "not counted", none a dash', html9.includes('10.0.1.100–10.0.1.199</span></td><td>3 / 100</td><td>153</td>')
       && /10\.0\.2\.199–10\.0\.2\.100<\/span><br><span class="muted">not counted/.test(html9), html9);
    open({ networks: [{ id: 'n3', cidr: '10.0.3.0/24' }], nodes: pcs('a', '10.0.3', 2, 2, 24) });
    ok('with no pool anywhere, the table is as it was', !/DHCP pool|In pool/.test(capacitySection(reportModel().capacity)));
    open({ networks: [office({ gateway: '10.0.1.120' })], nodes: [router('10.0.1.120/24')] });
    const m9b = reportModel();
    ok('Addressing says DHCP and the pool', /DHCP <span class="mono">pool 10\.0\.1\.100–10\.0\.1\.199<\/span>/.test(subnetsSection(m9b.subnets)), subnetsSection(m9b.subnets));
    const sum = summarySheet(m9b);
    ok('the summary puts it under What needs attention in plain words', /What needs attention/.test(sum) && sum.includes('The automatic address range clashes with a fixed address')
       && sum.includes('Devices may be handed an address already in use'), sum.slice(0, 400));
    open({ networks: [office()], nodes: [...pcs('a', '10.0.1', 2, 98, 24), ...pcs('b', '10.0.1', 200, 51, 24)] });
    const room = (summarySheet(reportModel()).match(/<p class="room">([^<]*)/) || [])[1] || '';
    ok('Room to grow names the fixed part', room.includes('The network Office has 4 fixed addresses left outside the automatic range, of 154.'), room);

    // ---- 10. Translated ----
    open({ networks: [office({ gateway: '10.0.1.120', dhcpFirst: '10.0.1.100', dhcpLast: '10.0.1.199' })], nodes: [router('10.0.1.120/24'), ...pcs('a', '10.0.1', 2, 98, 24), ...pcs('b', '10.0.1', 200, 50, 24)] });
    const left = [];
    ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => {
      setLocale(loc);
      const fs = topologyFindings().filter((f) => f.key === 'dhcp-pool' || f.key === 'address-capacity');
      fs.forEach((f) => { if (/[{}]/.test(f.detail) || /inside the DHCP pool|outside the DHCP pool/.test(f.detail) || f.check === 'DHCP pool') left.push(`${loc}: ${f.check}: ${f.detail}`); });
      if (fs.length !== 2) left.push(`${loc}: ${fs.length} findings`);
      const s = summarySheet(reportModel());
      if (s.includes('automatic address range clashes')) left.push(`${loc}: summary`);
    });
    setLocale('es');
    const esNote = topologyFindings().find((f) => f.key === 'address-capacity');
    setLocale('en');
    ok('the pool sentences, its check name and the summary in es, pt-BR, ru and ja', !left.length, left.join(' | '));
    ok('Spanish: the plural', !!esNote && esNote.detail === '10.0.1.0/24 tiene 6 direcciones libres fuera del pool DHCP, de 154.', esNote && esNote.detail);
    setLocale('es');
    open({ networks: [office({ gateway: '' })], nodes: [...pcs('a', '10.0.1', 1, 99, 24), ...pcs('b', '10.0.1', 200, 54, 24)] });
    const esOne = topologyFindings().find((f) => f.key === 'address-capacity');
    setLocale('en');
    ok('and the singular', !!esOne && esOne.detail === '10.0.1.0/24 tiene 1 dirección libre fuera del pool DHCP, de 154.', esOne && esOne.detail);

    // ---- 11. Binder, dates, samples ----
    const pooled = { v: DOC_VERSION, networks: [office()], nodes: [router('10.0.1.1/24'), ...pcs('p', '10.0.1', 150, 3, 24)], links: [] };
    open({ networks: [{ id: 'n3', cidr: '10.0.3.0/24' }], nodes: pcs('a', '10.0.3', 2, 2, 24) });
    const canvas = JSON.stringify(serializeDoc());
    ok('a site written through the serializer keeps its pool', show(canonicalDoc(cloneData(pooled)).networks[0]) === show(pooled.networks[0]));
    const b = binderModel([{ id: 's1', name: 'Pooled', updated: 1, doc: cloneData(pooled) }], { site: 'Estate', client: '', engineer: '', ref: '', date: '', scope: '' });
    const site = b.sites.find((s) => s.name === 'Pooled');
    const srow = site && site.model.capacity.subnets.find((s) => s.network === '10.0.1.0/24');
    ok('a binder\'s site counts its own pool inside withDoc', !!srow && srow.pool.valid && srow.pool.used === 3 && srow.fixed.free === 153, show(srow));
    ok('the canvas is handed back unchanged', JSON.stringify(serializeDoc()) === canvas);
    open(cloneData(pooled));
    const today = reportModel({ date: '' }), past = reportModel({ date: '2016-01-01' });
    const pastCap = capacitySection(past.capacity);
    ok('a report dated in the past prints the same pool columns', pastCap === capacitySection(today.capacity)
       && pastCap.includes('<th>In pool</th>') && pastCap.includes('<th>Fixed free</th>') && pastCap.includes('3 / 100'), pastCap);
    const noisy = [];
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'template' });
      if (pools().length) noisy.push(k);
    });
    ok('no template, simple or full, raises the dhcp-pool finding', !noisy.length && Object.keys(templatesData).some((k) => k.endsWith(SIMPLE_SUFFIX)), noisy.join(', '));
    // The SIMPLE_SAMPLES promise with a pool in place: each simple sample
    // given a sound pool .100-.199 on every /24 (edge at .1, devices from
    // .10 up) still opens with no finding at all but Common Errors' own.
    const simpleKeys = [], loud = [];
    let poolsGiven = 0;
    Object.keys(templatesData).filter((k) => k.endsWith(SIMPLE_SUFFIX)).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'template' });
      const keysOf = () => topologyFindings().filter((f) => !f.accepted).map((f) => f.key).sort();
      const was = keysOf();
      batch(() => {
        state.networks.forEach((n) => {
          const p = parseValidCIDR(n.cidr);
          if (!p || p.kind !== 'ipv4' || p.prefix !== 24) return;
          const base = p.networkStr.split('/')[0].split('.').slice(0, 3).join('.');
          Object.assign(n, { dhcp: true, dhcpFirst: `${base}.100`, dhcpLast: `${base}.199` });
          poolsGiven++;
        });
        save();
      });
      const now = keysOf();
      simpleKeys.push(k);
      if (show(now) !== show(was) || (!k.startsWith('errors') && now.length)) loud.push(`${k}: ${show(was)} -> ${show(now)}`);
    });
    ok('every simple sample with a sound pool still opens with no finding (the SIMPLE_SAMPLES promise)', !loud.length && poolsGiven >= simpleKeys.length && simpleKeys.length > 0,
       loud.join(' | ') + ` pools ${poolsGiven}`);

    const base = { v: DOC_VERSION, nodes: [], links: [], networks: [{ id: 'n1', cidr: '10.0.1.0/24', dhcp: true }] };
    const ch = docChanges(base, { ...base, networks: [{ id: 'n1', cidr: '10.0.1.0/24', dhcp: true, dhcpFirst: '10.0.1.100', dhcpLast: '10.0.1.199' }] });
    ok('Changes since the last back-up names the pool\'s ends', show(ch.subnets.changed.map((c) => c.fields)) === show([['DHCP first', 'DHCP last']]), show(ch.subnets));

    // ---- 12. Add devices ----
    open({ networks: [office({ dhcpFirst: '10.0.1.2', dhcpLast: '10.0.1.99' })], nodes: [router('10.0.1.1/24')] });
    ok('freeAddresses still hands out the bottom of the subnet, pool or not', show(freeAddresses('10.0.1.0/24', 2)) === show(['10.0.1.2', '10.0.1.3']));
    getNode('rt').x = 0;
    state.nodes.push({ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 8, interfaces: [], ports: undefined });
    state.links.push({ id: 'l1', source: 'rt', target: 'sw', sourceIface: 'i1', targetIface: 'p1' });
    const given = planAddDevices({ items: [{ type: 'pc', count: 1 }, { type: 'printer', count: 1 }], pattern: '', targetId: 'sw' }).devices.map((d) => d.ip);
    ok('Add devices: the PC takes the pool\'s bottom, the printer steps past the pool (option C)', show(given) === show(['10.0.1.2/24', '10.0.1.100/24']), show(given));
  } catch (e) {
    ok('the suite ran', false, e && (e.stack || e.message));
  }
  setLocale('en');
  setDialogResponder(heldResponder);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 50); });
