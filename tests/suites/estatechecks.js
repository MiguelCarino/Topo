// Checks between the sites of a binder (js/report.js estateChecks;
// docs/SCOPE.md step 9i, D445):
//   1. a private subnet used at two sites that are joined (a cloud at one
//      that stands for the other) is a fault, said once whichever site holds
//      the cloud, naming it; unjoined sites sharing one say nothing here (it
//      stays a fact in the addressing table); a public subnet says nothing;
//   2. a VLAN number under different names at different sites, and a VLAN
//      name on different numbers, are advisory; the same name (any case) or
//      one site with two is nothing;
//   3. an asset tag on devices at two sites is advisory; twice at one site
//      is that site's own finding, not this one; a retired device is out;
//   4. two sites' devices sharing a name say nothing;
//   5. the rows are worst first and the same on a second run; the cover's
//      counts include them; the report prints them under "Between sites",
//      and prints no such heading when there is none; an unreadable site is
//      left out, not a crash;
//   6. the open network is untouched; the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false, ports: '80',
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const ip = (cidr) => ({ interfaces: [{ id: 'i1', name: 'eth0', ip: cidr }] });
  // One site: a router on `lan`, a PC, optional extras.
  const siteDoc = (lan, more = {}) => ({ v: DOC_VERSION,
    nodes: [N('rt', 'router', Object.assign(ip(`${lan}.1/24`), { name: 'Router' })), N('pc', 'pc', Object.assign(ip(`${lan}.10/24`), { name: 'Front desk', gw: `${lan}.1` }))].concat(more.nodes || []),
    links: [{ id: 'l1', source: 'rt', target: 'pc' }].concat(more.links || []),
    networks: more.networks || [] });
  const cloudTo = (id, name) => ({ nodes: [N('wan', 'cloud', { name: `Link to ${name}`, siteRef: { id, name } })], links: [{ id: 'lw', source: 'rt', target: 'wan' }] });
  const entry = (id, name, doc) => ({ id, name, updated: 1, doc });
  const meta = { site: 'Estate', client: 'Estate', engineer: '', ref: '', date: '2026-11-17', scope: '' };
  const across = (entries) => binderModel(entries, meta).across;
  const lines = (rows) => rows.map((r) => [r.level, r.check, r.subject, r.site].join('|')).join(' ;; ');
  try {
    setLocale('en');
    const held = show(serializeDoc());

    // ---- 1. Joined sites and a shared subnet ----
    const a1 = entry('a', 'Torre A', siteDoc('192.168.1', cloudTo('b', 'Torre B')));
    const b1 = entry('b', 'Torre B', siteDoc('192.168.1'));
    let rows = across([a1, b1]);
    ok('joined sites on the same private subnet: a fault', rows.length === 1 && rows[0].level === 'bad' && rows[0].subject === '192.168.1.0/24' && rows[0].site === 'Torre A · Torre B'
      && /192\.168\.1\.0\/24 is used at both Torre A and Torre B, which are joined \(Link to Torre B\)/.test(rows[0].detail), show(rows));
    ok('…said once when both sites hold a cloud for the other', across([a1, entry('b', 'Torre B', siteDoc('192.168.1', cloudTo('a', 'Torre A')))]).length === 1);
    ok('…and the same whichever site holds the cloud', lines(across([entry('a', 'Torre A', siteDoc('192.168.1')), entry('b', 'Torre B', siteDoc('192.168.1', cloudTo('a', 'Torre A')))])) === 'bad|Joined sites|192.168.1.0/24|Torre A · Torre B');
    ok('unjoined sites sharing a subnet say nothing here', across([entry('a', 'Torre A', siteDoc('192.168.1')), b1]).length === 0);
    ok('…and the addressing table still lists it as a fact', binderModel([entry('a', 'Torre A', siteDoc('192.168.1')), b1], meta).subnets.find((s) => s.network === '192.168.1.0/24').sites.length === 2);
    ok('joined sites on different subnets say nothing', across([a1, entry('b', 'Torre B', siteDoc('192.168.2'))]).length === 0);
    ok('a public subnet shared by joined sites says nothing', across([entry('a', 'Torre A', siteDoc('203.0.113', cloudTo('b', 'Torre B'))), entry('b', 'Torre B', siteDoc('203.0.113'))]).length === 0);
    ok('a cloud that names a site not in the binder joins nothing', across([entry('a', 'Torre A', siteDoc('192.168.1', cloudTo('zz', 'Elsewhere'))), b1]).length === 0);

    // ---- 2. VLANs ----
    const nets = (list) => ({ networks: list.map(([vlan, name], i) => ({ id: `n${i}`, name, vlan, cidr: `10.${vlan}.0.0/24` })) });
    rows = across([entry('a', 'Torre A', siteDoc('192.168.1', nets([[10, 'Voice'], [20, 'Guests']]))), entry('b', 'Torre B', siteDoc('192.168.2', nets([[10, 'Cameras'], [30, 'Guests']])))]);
    ok('a VLAN number under different names is advisory', rows.some((r) => r.level === 'warn' && r.check === 'VLAN names' && r.subject === 'VLAN 10' && /VLAN 10 goes by different names: Voice \(Torre A\), Cameras \(Torre B\)\./.test(r.detail)), lines(rows));
    ok('a VLAN name on different numbers is advisory', rows.some((r) => r.level === 'warn' && r.check === 'VLAN numbers' && r.subject === 'Guests' && /"Guests" is on different VLAN numbers: 20 \(Torre A\), 30 \(Torre B\)\./.test(r.detail)), lines(rows));
    ok('…and that is all', rows.length === 2);
    ok('the same name in another case is the same name', across([entry('a', 'Torre A', siteDoc('192.168.1', nets([[10, 'Voice']]))), entry('b', 'Torre B', siteDoc('192.168.2', nets([[10, 'VOICE']])))]).length === 0);
    ok('one site with the same number twice is its own business', across([entry('a', 'Torre A', siteDoc('192.168.1', nets([[10, 'Voice'], [10, 'Phones']]))), entry('b', 'Torre B', siteDoc('192.168.2'))]).length === 0);
    ok('an unnamed VLAN disagrees with nobody', across([entry('a', 'Torre A', siteDoc('192.168.1', nets([[10, '']]))), entry('b', 'Torre B', siteDoc('192.168.2', nets([[10, 'Voice']])))]).length === 0);

    // ---- 3. Asset tags ----
    const tagged = (tag, extra = {}) => ({ nodes: [N('sv', 'server', Object.assign({ name: 'NAS', assetTag: tag }, extra))], links: [{ id: 'ls', source: 'rt', target: 'sv' }] });
    rows = across([entry('a', 'Torre A', siteDoc('192.168.1', tagged('CS-0042'))), entry('b', 'Torre B', siteDoc('192.168.2', tagged('cs-0042')))]);
    ok('an asset tag at two sites is advisory', rows.length === 1 && rows[0].level === 'warn' && rows[0].check === 'Asset tag' && /Asset tag CS-0042 is on more than one device: NAS \(Torre A\), NAS \(Torre B\)\./.test(rows[0].detail), show(rows));
    ok('a retired device is out', across([entry('a', 'Torre A', siteDoc('192.168.1', tagged('CS-0042', { status: 'retired' }))), entry('b', 'Torre B', siteDoc('192.168.2', tagged('CS-0042')))]).length === 0);
    const twice = siteDoc('192.168.1', tagged('CS-0042')); twice.nodes.push(N('sv2', 'server', { name: 'NAS 2', assetTag: 'CS-0042' }));
    ok('twice at one site is that site\'s own finding, not this one', across([entry('a', 'Torre A', twice), entry('b', 'Torre B', siteDoc('192.168.2'))]).length === 0);

    // ---- 4. Names ----
    ok('two sites\' devices sharing a name say nothing', across([entry('a', 'Torre A', siteDoc('192.168.1')), entry('b', 'Torre B', siteDoc('192.168.2'))]).length === 0);

    // ---- 5. Order, counts, the report ----
    const mixA = siteDoc('192.168.1', { nodes: cloudTo('b', 'Torre B').nodes.concat(tagged('CS-1').nodes), links: cloudTo('b', 'Torre B').links.concat(tagged('CS-1').links), networks: nets([[10, 'Voice']]).networks });
    const mixB = siteDoc('192.168.1', { nodes: tagged('CS-1').nodes, links: tagged('CS-1').links, networks: nets([[10, 'Cameras']]).networks });
    mixB.networks[0].cidr = '10.110.0.0/24';   // its own addresses: the declared subnet is not the one shared
    const mixed = [entry('b', 'Torre B', mixB), entry('a', 'Torre A', mixA)];
    const model = binderModel(mixed, meta);
    ok('worst first, then by check and subject', lines(model.across) === 'bad|Joined sites|192.168.1.0/24|Torre A · Torre B ;; warn|Asset tag|CS-1|Torre A · Torre B ;; warn|VLAN names|VLAN 10|Torre A · Torre B', lines(model.across));
    ok('the same rows on a second run, in any order of the binder', lines(binderModel(mixed.slice().reverse(), meta).across) === lines(model.across));
    const site = (m) => m.findings;
    ok('the cover counts include them', model.counts.across === 3 && model.counts.critical === site(model).filter((f) => f.level === 'bad').length + 1 && model.counts.advisory === site(model).filter((f) => f.level === 'warn').length + 2,
      show(model.counts));
    const html = binderHtml(model, {});
    ok('the report prints them under Between sites', /<h3 class="est-across">Between sites<\/h3>/.test(html) && /192\.168\.1\.0\/24 is used at both Torre A and Torre B/.test(html) && /VLAN 10 goes by different names/.test(html));
    const quiet = binderHtml(binderModel([entry('a', 'Torre A', siteDoc('192.168.1')), entry('b', 'Torre B', siteDoc('192.168.2'))], meta), {});
    ok('…and no such heading when there is nothing between them', !/est-across/.test(quiet));
    let crashed = null;
    try { rows = across([a1, b1, { id: 'x', name: 'Broken', updated: 1, doc: { v: DOC_VERSION, nodes: 'nope', links: [] } }]); } catch (e) { crashed = e; }
    ok('an unreadable site is left out, not a crash', !crashed && rows.length === 1, crashed ? String(crashed) : show(rows));

    // ---- 6. Untouched, and translated ----
    ok('the open network is what it was', show(serializeDoc()) === held);
    const { has, locales } = window.CarinoI18N;
    const strings = ['Joined sites', '{network} is used at both {a} and {b}, which are joined ({via}). Devices on it at one site cannot reach the other.', 'a site link', 'VLAN names',
      'VLAN {vlan} goes by different names: {names}.', 'VLAN numbers', '"{name}" is on different VLAN numbers: {numbers}.', 'Asset tag {tag} is on more than one device: {devices}.', 'Between sites',
      'What only two sites side by side can show. A subnet shared by sites that are not joined is listed under Estate addressing, as a fact.'];
    locales.forEach((loc) => ok(`${loc} carries the strings`, strings.every((s) => has(loc, s)), strings.filter((s) => !has(loc, s)).join(' | ')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
