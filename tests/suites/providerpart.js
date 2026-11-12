// @realtime — the part's log is chained again (Web Crypto digests).
// A provider's part of the network (js/providerpart.js, docs/SCOPE.md D91-D93):
//   1. the rule on a hand-made network: a group naming a provider brings
//      ALL its members, nested groups included, even one a nearer provider
//      of the same service covers (the owner, 2026-11-10); the host chain
//      (D35: a VM and its container through the server); the context is the
//      way to the network, not the neighbourhood (D363): the nearest two
//      devices toward the router (for a router, toward the Internet or its
//      upstream router), a VPN tunnel is not a way, the far end of a cable
//      they answer for comes, and a problem report's device off the way
//      comes as "where the problem is"; every kept cable has both ends;
//      groups needed to place a kept device come with their parents;
//   1b. what hangs below is left out (D364): a switch with forty PCs goes
//      with its router only, its forty ports marked in use (not in your
//      part), counted; the loader keeps the mark and a marked port is used;
//      the merge strips it; a router's way to the Internet, or to its
//      upstream router when there is none;
//   2. what a linked device keeps (name, type, place, its facing ports in
//      full, its other addresses) and never (notes, serial, other
//      providers); a cable between two linked devices goes reduced;
//   3. no other provider: only the chosen providers' records, without the
//      client's notes about them; no other provider's reference survives
//      the loader; the report header is the site and the client only;
//   4. reports and the log: the one sent, the providers' reports on their
//      items (not a closed one with no visit of theirs, not one elsewhere);
//      routedTo cut to them, their visits only, a visit's changes cut to
//      what is kept, no merge entry; chained again, it verifies;
//   5. no provider chosen (or none the network holds): the whole network;
//      the same part twice is the same; the part of the part is the part
//      (partOfSelf);
//   6. every sample, every provider: items field-identical (but the
//      in-use marks), two devices of a way at most, both ends kept, context keys allowed only, no foreign provider
//      after the loader, group parents present; the largest under 200 ms.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 500) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const sorted = (it) => [...it].sort();
  try {
    await until(() => !!window.TopoPart && typeof canonicalDoc === 'function' && !!window.TopoMerge);
    const TP = window.TopoPart;
    setLocale('en');

    const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    const rawLog = [
      { id: 'lgM1', at: 1, kind: 'merge', source: 'link', counts: { added: 1, changed: 0, removed: 0, conflicts: 0 }, rev: 'r_old', summary: 'Merged link: 1 added, 0 changed, 0 removed, 0 conflicts.' },
      { id: 'lgE1', at: 2, kind: 'incident', incidentId: 'inA', event: 'opened', symptom: 'internet', routedTo: ['pA', 'pB'], summary: 'Problem opened: internet (to 2).' },
      { id: 'lgVA', at: 3, kind: 'visit', incidentId: 'inA', providerId: 'pA', provider: 'Alfa IT', by: 'Ana A', outcome: 'fixed', notes: 'A notes',
        changes: { counts: { added: 0, changed: 2, removed: 0 }, items: [{ kind: 'devices', id: 'sw', name: 'SW', status: 'changed' }, { kind: 'devices', id: 'bk', name: 'BK', status: 'changed' }] } },
      { id: 'lgVB', at: 4, kind: 'visit', incidentId: 'inA', providerId: 'pB', provider: 'Beta IT', by: 'Beto B', outcome: 'partly', notes: 'B secret', signoff: 'Boss' },
      { id: 'lgE2', at: 5, kind: 'incident', incidentId: 'inX', event: 'opened', symptom: 'other', routedTo: ['pC'], summary: 'Problem opened: other (to 1).' },
      { id: 'lgE3', at: 6, kind: 'incident', incidentId: 'inA', event: 'sent', symptom: 'internet', routedTo: ['pA'], summary: 'Problem sent: internet (to 1).' }
    ];
    const net = async () => ({
      v: DOC_VERSION,
      report: { client: 'Clinica Sol', site: 'Reception', engineer: 'Eve', ref: 'R-7', scope: 'Private scope notes' },
      providers: [
        { id: 'pA', name: 'Alfa IT', service: 'it', phone: '1', email: 'a@x.example', hours: '9-5', notes: 'They overcharge' },
        { id: 'pB', name: 'Beta IT', service: 'it', phone: '2' },
        { id: 'pC', name: 'Cable ISP', service: 'internet', phone: '3' },
        { id: 'pH', name: 'Host Co', service: 'it', phone: '4' }
      ],
      groups: [
        { id: 'gTop', name: 'HQ', kind: 'building', providers: ['pA'] },
        { id: 'gSub', name: 'Server room', kind: 'room', parent: 'gTop', providers: ['pB'] },
        { id: 'gOff', name: 'Annex', kind: 'building' },
        { id: 'gOffR', name: 'Annex room', kind: 'room', parent: 'gOff' },
        { id: 'gFar', name: 'Far', kind: 'building' }
      ],
      networks: [
        { id: 'nL', cidr: '10.0.0.0/24', name: 'LAN' },
        { id: 'nV', cidr: '10.9.0.0/24', name: 'Voice', vlan: 30 },
        { id: 'nX', cidr: '172.16.0.0/24', name: 'Elsewhere' }
      ],
      nodes: [
        N('isp', 'cloud', { providers: ['pC'] }),
        N('rt', 'router', { notes: 'router admin: see vault', serial: 'RT-1', interfaces: [{ id: 'i1', name: 'wan', ip: '' }, { id: 'i2', name: 'lan', ip: '10.0.0.1/24' }, { id: 'i3', name: 'spare', ip: '' }] }),
        N('core', 'switch', { group: 'gOffR', notes: 'core notes', serial: 'CORE-9', portCount: 24, portAttrs: { p1: { label: 'to SW', vlan: 30 }, p2: { label: 'to NAS' }, p5: { label: 'secret desk' } }, providers: ['pB'] }),
        N('sw', 'switch', { group: 'gTop', portCount: 8, serial: 'SW-1', notes: 'sw notes' }),
        N('srv', 'server', { group: 'gSub', serial: 'SRV-1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24', mac: '00:11:22:33:44:55' }] }),
        N('vm', 'vm', { host: 'srv', group: 'gSub' }),
        N('pc', 'pc', { group: 'gSub', providers: ['pB'], notes: 'pc notes', extra: { col1: 'A-12' } }),
        N('ap', 'ap', { group: 'gTop', interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'wlan0', ip: '', wireless: true }] }),
        N('lap', 'laptop', { notes: 'lap notes', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.9.0.5/24', wireless: true }] }),
        N('remote', 'router', { name: 'Remote office' }),
        N('nas', 'nas', { group: 'gOffR', notes: 'nas notes' }),
        N('bk', 'server', { name: 'Backup', group: 'gFar' }),
        N('hs', 'server', { providers: ['pH'], notes: 'hs notes' }),
        N('hvm', 'vm', { host: 'hs' }),
        N('ct', 'container', { host: 'hvm' })
      ],
      links: [
        { id: 'l1', source: 'isp', target: 'rt', sourceIface: 'i1', targetIface: 'i1' },
        { id: 'l2', source: 'rt', target: 'core', sourceIface: 'i2', targetIface: 'p24', cable: { label: 'C-2', length: 12 } },
        { id: 'l3', source: 'core', target: 'sw', sourceIface: 'p1', targetIface: 'p8', cable: { label: 'C-3' } },
        { id: 'l4', source: 'sw', target: 'srv', sourceIface: 'p1', targetIface: 'i1' },
        { id: 'l5', source: 'sw', target: 'pc', sourceIface: 'p2', targetIface: 'i1' },
        { id: 'l6', source: 'sw', target: 'ap', sourceIface: 'p3', targetIface: 'i1' },
        { id: 'l7', source: 'ap', target: 'lap', sourceIface: 'i2', targetIface: 'i1', medium: 'wireless' },
        { id: 'l8', source: 'rt', target: 'remote', medium: 'vpn' },
        { id: 'l9', source: 'core', target: 'nas', sourceIface: 'p2', targetIface: 'i1', cable: { label: 'C-9', length: 3 }, providers: ['pB'] },
        { id: 'l10', source: 'nas', target: 'bk' },
        { id: 'l11', source: 'hs', target: 'core', sourceIface: 'i1', targetIface: 'p6' }
      ],
      columns: [{ id: 'col1', name: 'Desk' }, { id: 'col2', name: 'Unused' }],
      incidents: [
        { id: 'inA', at: 2, status: 'visited', symptom: 'internet', nodeIds: ['pc'], reporter: { name: 'Ana', phone: '555' }, routedTo: ['pA', 'pB'], visits: ['lgVA', 'lgVB'] },
        { id: 'inX', at: 5, status: 'open', symptom: 'other', nodeIds: ['bk'], reporter: { name: 'Ana' }, routedTo: ['pC'], visits: [] },
        { id: 'inZ', at: 6, status: 'open', symptom: 'other', nodeIds: ['isp'], reporter: { name: 'Ana' }, routedTo: ['pA'], visits: [] },
        { id: 'inC', at: 7, status: 'closed', symptom: 'wifi', nodeIds: ['sw'], reporter: { name: 'Ana' }, routedTo: ['pA'], visits: [] }
      ],
      log: await TopoMerge.chainLog(rawLog)
    });
    const doc = canonicalDoc(await net());
    ok('the fixture loads as written (its log chained)', doc.nodes.length === 15 && doc.links.length === 11 && (await TopoMerge.verifyLog(doc.log)) === -1);

    // ---- 1. The rule ----
    const pa = TP.providerPart(doc, ['pA'], { incidentId: 'inA' });
    ok('Alfa IT\'s items: everything in HQ, the Server room inside it too, though Beta IT is nearer there', !pa.whole
       && show(sorted(pa.items.nodes)) === show(['ap', 'pc', 'srv', 'sw', 'vm']) && show(sorted(pa.items.groups)) === show(['gSub', 'gTop']), show(sorted(pa.items.nodes)));
    ok('their cables: the ones between their devices', show(sorted(pa.items.links)) === show(['l4', 'l5', 'l6']), show(sorted(pa.items.links)));
    const hopOf = (part, id) => (part.context.get(id) || {}).hop;
    ok('the way to the network: the core switch first, the router second, and nothing else', hopOf(pa, 'core') === 1 && hopOf(pa, 'rt') === 2 && pa.context.size === 2
       && pa.context.get('core').why.has('path'), show([...pa.context].map(([k, v]) => [k, v.hop])));
    ok('not the neighbourhood: not the laptop on their AP, not the NAS or the server beside the core, no Internet, no guest',
       ['lap', 'nas', 'hs', 'isp', 'bk', 'hvm', 'ct', 'remote'].every((id) => !pa.context.has(id) && !pa.items.nodes.has(id)));
    ok('the counts: the laptop on their radio left out', pa.counts.items === 5 && pa.counts.context === 2 && pa.counts.leftOut === 1 && pa.counts.busyPorts === 0, show(pa.counts));
    const ph = TP.providerPart(doc, ['pH']);
    ok('Host Co: the server, and through it its VM and the VM\'s container (D35)', show(sorted(ph.items.nodes)) === show(['ct', 'hs', 'hvm']), show(sorted(ph.items.nodes)));
    ok('the container keeps its host chain on load', (() => { const c = canonicalDoc(ph.doc); return c.nodes.find((n) => n.id === 'ct').host === 'hvm' && c.nodes.find((n) => n.id === 'hvm').host === 'hs'; })());
    const pc = TP.providerPart(doc, ['pC'], { incidentId: 'inX' });
    ok('Cable ISP: the router, where their line meets the network; nothing past it; the remote office over a VPN tunnel is not a way', pc.items.nodes.has('isp') && hopOf(pc, 'rt') === 1
       && !pc.context.has('core') && !pc.context.has('remote') && !pc.context.has('sw'), show([...pc.context].map(([k, v]) => [k, v.hop, [...v.why]])));
    ok('the report being sent: its device, three hops off, comes as where the problem is', pc.context.has('bk') && pc.context.get('bk').hop === null && pc.context.get('bk').why.has('problem')
       && show(pc.incidents) === '["inX"]', show(pc.context.get('bk') && [...pc.context.get('bk').why]));
    const pb = TP.providerPart(doc, ['pB']);
    ok('Beta IT: the Server room, their own PC, the core switch and its NAS cable they are named on', ['srv', 'vm', 'pc', 'core'].every((id) => pb.items.nodes.has(id)) && pb.items.links.has('l9')
       && pb.items.nodes.has('nas') === false && hopOf(pb, 'nas') === 1 && pb.context.get('nas').why.has('cable-end'), show(sorted(pb.items.nodes)));
    ok('their server\'s way: the access switch, then the router (the core between is theirs)', hopOf(pb, 'sw') === 1 && hopOf(pb, 'rt') === 1, show([...pb.context].map(([k, v]) => [k, v.hop])));
    const pbCore = pb.doc.nodes.find((n) => n.id === 'core');
    ok('the server beside their core is left out, and its port goes marked in use; their own ports keep what is written', !pb.context.has('hs') && pb.counts.leftOut === 1 && pb.counts.busyPorts === 1
       && show(pbCore.portAttrs.p6) === show({ partUsed: true }) && show(pbCore.portAttrs.p5) === show({ label: 'secret desk' }) && pbCore.portAttrs.p1.partUsed === undefined, show(pbCore.portAttrs));
    ok('the mark is the part\'s: the network itself is untouched', doc.nodes.find((n) => n.id === 'core').portAttrs.p6 === undefined);
    const keptIds = (p) => new Set(p.doc.nodes.map((n) => n.id));
    const bothEnds = (p) => { const k = keptIds(p); return p.doc.links.every((l) => k.has(l.source) && k.has(l.target)); };
    ok('every kept cable has both ends kept', [pa, ph, pc, pb].every(bothEnds));
    ok('a cable to a device not kept is not kept', !pa.doc.links.some((l) => l.id === 'l1' || l.id === 'l10' || l.id === 'l8'));
    ok('the groups to place them, with their parents: Annex room and Annex', ['gTop', 'gSub', 'gOffR', 'gOff'].every((g) => pa.doc.groups.some((x) => x.id === g))
       && !pa.doc.groups.some((x) => x.id === 'gFar') && show(sorted(pa.contextGroups)) === show(['gOff', 'gOffR']), show(pa.doc.groups.map((g) => g.id)));

    // ---- 1b. A switch with forty PCs (D364) ----
    const forty = (cloud) => {
      const nodes = [N('up', 'router'), N('rt', 'router', { providers: ['pR'] }), N('sw', 'switch', { portCount: 48, providers: ['pX'], portAttrs: { p3: { label: 'Desk 3' } } })];
      const links = [{ id: 'k1', source: 'up', target: 'rt' }, { id: 'k2', source: 'rt', target: 'sw', targetIface: 'p48' }];
      if (cloud) { nodes.unshift(N('isp', 'cloud')); links.push({ id: 'k0', source: 'isp', target: 'up' }); }
      for (let i = 1; i <= 40; i++) { nodes.push(N('pc' + i, 'pc')); links.push({ id: 'kp' + i, source: 'sw', target: 'pc' + i, sourceIface: 'p' + i, targetIface: 'i1' }); }
      return canonicalDoc({ v: DOC_VERSION, providers: [{ id: 'pX', name: 'Switch Co', service: 'it' }, { id: 'pR', name: 'Router Co', service: 'it' }], nodes, links });
    };
    const fd = forty(true);
    const px = TP.providerPart(fd, ['pX']);
    const pxSw = px.doc.nodes.find((n) => n.id === 'sw');
    ok('forty PCs: the switch goes with its router only', show(sorted(px.doc.nodes.map((n) => n.id))) === show(['rt', 'sw']) && hopOf(px, 'rt') === 1 && px.context.size === 1, show(px.doc.nodes.map((n) => n.id)));
    ok('the forty are counted as left out, their forty ports marked in use', px.counts.leftOut === 40 && px.counts.busyPorts === 40
       && Array.from({ length: 40 }, (_, i) => 'p' + (i + 1)).every((p) => pxSw.portAttrs[p] && pxSw.portAttrs[p].partUsed === true)
       && pxSw.portAttrs.p48 === undefined && pxSw.portAttrs.p3.label === 'Desk 3', show(px.counts));
    const pxCanon = canonicalDoc(px.doc);
    const pxSw2 = pxCanon.nodes.find((n) => n.id === 'sw');
    ok('the loader keeps the mark', pxSw2.portAttrs.p40.partUsed === true && show(pxSw2.portAttrs.p3) === show({ label: 'Desk 3', partUsed: true }));
    const cap = withDoc(pxCanon, () => { const s = getNode('sw'); return { cap: portCapacity(s), next: freePorts(s, 1).ids, away: portUsedAway(s, 'p7'), free: portUsedAway(s, 'p41') }; });
    ok('at the provider: a marked port is used, the next free is past them', cap.cap.used === 41 && cap.cap.free === 7 && show(cap.next) === '["p41"]' && cap.away && !cap.free, show(cap));
    const inSw = mergeInput(pxCanon).doc.nodes.find((n) => n.id === 'sw');
    ok('the merge strips the mark, so it is never written into the client\'s network', show(inSw.portAttrs) === show({ p3: { label: 'Desk 3' } }), show(inSw.portAttrs));
    const plan = TopoMerge.planMerge(fd, pxCanon, pxCanon, { part: { nodes: new Set(['rt']), groups: new Set(), known: new Set(fd.nodes.map((n) => n.id).concat(fd.links.map((l) => l.id))) } });
    const changed = (plan.items || []).filter((x) => x.status && x.status !== 'unchanged');
    ok('and a copy back that changed nothing merges as nothing: the forty are not removed, the ports not changed', changed.length === 0, show(changed.map((x) => [x.kind, x.id, x.status])));
    const pr = TP.providerPart(fd, ['pR']);
    ok('a router\'s way: toward the Internet, its upstream router then the cloud; the switch below it left out', hopOf(pr, 'up') === 1 && hopOf(pr, 'isp') === 2 && !pr.context.has('sw') && pr.counts.leftOut === 1,
       show([...pr.context].map(([k, v]) => [k, v.hop])));
    const pr2 = TP.providerPart(forty(false), ['pR']);
    ok('with no Internet drawn: its upstream router', hopOf(pr2, 'up') === 1 && pr2.context.size === 1, show([...pr2.context].map(([k, v]) => [k, v.hop])));

    // ---- 2. What a linked device keeps ----
    const core = pa.doc.nodes.find((n) => n.id === 'core');
    const allowed = new Set(TP.PART_CONTEXT_KEYS.concat(['host', 'portAttrs', 'interfaces']));
    ok('a linked device: name, type, place and ports, nothing else', !!core && Object.keys(core).every((k) => allowed.has(k)) && core.name === 'CORE' && core.group === 'gOffR' && core.portCount === 24,
       show(core));
    ok('never its notes, its serial or its providers', core.notes === undefined && core.serial === undefined && core.providers === undefined);
    ok('the port facing their switch, in full; not the others', show(core.portAttrs) === show({ p1: { label: 'to SW', vlan: 30 } }), show(core.portAttrs));
    const rt = pa.doc.nodes.find((n) => n.id === 'rt');
    ok('the router at two hops: its addresses only (its LAN), not an empty port', show(rt.interfaces) === show([{ id: 'i2', name: 'lan', ip: '10.0.0.1/24' }]) && rt.notes === undefined && rt.serial === undefined, show(rt.interfaces));
    ok('the laptop on their radio is not sent, nor its association', !pa.doc.nodes.some((n) => n.id === 'lap') && !pa.doc.links.some((l) => l.id === 'l7'));
    const item = pa.doc.nodes.find((n) => n.id === 'sw');
    ok('their own devices in full: notes, serial', item.notes === 'sw notes' && item.serial === 'SW-1' && pa.doc.nodes.find((n) => n.id === 'pc').notes === 'pc notes');
    const l2 = pa.doc.links.find((l) => l.id === 'l2'), l3 = pa.doc.links.find((l) => l.id === 'l3');
    ok('a cable between two linked devices: its ends and ports only', !!l2 && l2.cable === undefined && l2.providers === undefined && l2.sourceIface === 'i2' && l2.targetIface === 'p24', show(l2));
    ok('a cable to one of theirs: in full', !!l3 && show(l3.cable) === show({ label: 'C-3' }));
    ok('the subnets their devices use, and the VLAN their port carries; not one elsewhere', show(sorted((pa.doc.networks || []).map((n) => n.id))) === show(['nL', 'nV']), show((pa.doc.networks || []).map((n) => n.id)));
    ok('the custom columns their devices use', show((pa.doc.columns || []).map((c) => c.id)) === '["col1"]');

    // ---- 3. No other provider ----
    const canonA = canonicalDoc(pa.doc);
    const refs = [...canonA.nodes, ...canonA.links, ...(canonA.groups || [])].flatMap((r) => r.providers || []);
    ok('only Alfa IT\'s record, without the client\'s notes about them', show(canonA.providers.map((p) => p.id)) === '["pA"]' && canonA.providers[0].notes === undefined
       && canonA.providers[0].hours === '9-5' && canonA.providers[0].email === 'a@x.example', show(canonA.providers));
    ok('no other provider named anywhere after the loader', refs.every((id) => id === 'pA') && !JSON.stringify(canonA).includes('Beta IT') && !JSON.stringify(canonA).includes('Cable ISP') && !JSON.stringify(canonA).includes('Host Co'));
    ok('the header: the site and the client, not the engineer, the reference or the scope notes', show(canonA.report) === show({ client: 'Clinica Sol', site: 'Reception' })
       || (canonA.report.site === 'Reception' && canonA.report.client === 'Clinica Sol' && !canonA.report.engineer && !canonA.report.ref && !canonA.report.scope), show(canonA.report));

    // ---- 4. Reports and the log ----
    ok('the reports: theirs on their items; not a closed one with no visit of theirs, not one elsewhere', show(pa.incidents) === '["inA"]', show(pa.incidents));
    const inA = canonA.incidents[0];
    ok('routed to them only, their visit only', show(inA.routedTo) === '["pA"]' && show(inA.visits) === '["lgVA"]', show(inA));
    ok('the log: their report\'s events and their visit, no merge entry, no other visit', show(canonA.log.map((e) => e.id)) === show(['lgE1', 'lgVA', 'lgE3']), show(canonA.log.map((e) => e.id)));
    const e1 = canonA.log[0], va = canonA.log[1];
    ok('an entry routed to two says one, to them', show(e1.routedTo) === '["pA"]' && e1.summary === 'Problem opened: internet (to 1).', show(e1));
    ok('their visit\'s changes cut to what the part holds', show((va.changes.items || []).map((x) => x.id)) === '["sw"]' && va.changes.counts.changed === 2, show(va.changes));
    ok('nothing of the other provider\'s visit', !JSON.stringify(canonA).includes('B secret') && !JSON.stringify(canonA).includes('Beto'));
    const chained = await relinkLog(canonA);
    ok('chained again, the part\'s log verifies', (await TopoMerge.verifyLog(chained.log)) === -1 && chained.log.slice(1).every((e) => /^[0-9a-f]{64}$/.test(e.prev || '')));
    const raw = TP.providerPart(doc, ['pA']);
    ok('kept entries after a dropped one lose their old prev first', raw.doc.log.length === 3 && raw.doc.log.every((e) => !e.prev) && !!doc.log.find((x) => x.id === 'lgE3').prev);
    ok('a report on their items but not being sent, three hops off, stays home', !TP.providerPart(doc, ['pC']).context.has('bk') && show(TP.providerPart(doc, ['pC']).incidents) === '[]');

    // ---- 5. Whole, deterministic, the part of the part ----
    const none = TP.providerPart(doc, []);
    const unknown = TP.providerPart(doc, ['nobody']);
    ok('no provider chosen, or none here: the whole network', none.whole && unknown.whole && none.doc === doc);
    ok('the same part twice is the same', show(TP.providerPart(doc, ['pA'], { incidentId: 'inA' }).doc) === show(pa.doc));
    const self1 = TP.partOfSelf(canonA, 'pA');
    ok('the part of the part: the same items and the same linked devices, at the same hops', show(sorted(self1.items.nodes)) === show(sorted(pa.items.nodes))
       && show([...self1.context].map(([k, v]) => [k, v.hop]).sort()) === show([...pa.context].map(([k, v]) => [k, v.hop]).sort()), show([...self1.context].map(([k, v]) => [k, v.hop])));
    const two = TP.providerPart(doc, ['pA', 'pH']);
    ok('two providers: the union of their parts, both records', ['sw', 'hs', 'hvm', 'ct'].every((id) => two.items.nodes.has(id)) && show(two.providers) === '["pA","pH"]'
       && show(canonicalDoc(two.doc).providers.map((p) => p.id)) === '["pA","pH"]');
    ok('the names, for the send step', TP.partProviderNames(['pA'], doc.providers) === 'Alfa IT' && TP.partProviderNames(['pA', 'pB', 'pH'], doc.providers) === 'Alfa IT, Beta IT and Host Co');

    // ---- 6. Every sample, every provider ----
    const bad = [];
    let parts = 0, slowest = 0, slowestKey = '', biggest = { key: '', items: 0, context: 0 };
    const keys = TEMPLATE_META.map((m) => m.key).flatMap((k) => [k, k + SIMPLE_SUFFIX]).filter((k) => templatesData[k]);
    // An item as the network holds it: the part's in-use marks off.
    const unmark = (n) => {
      if (!n.portAttrs) return n;
      const c = JSON.parse(JSON.stringify(n));
      Object.keys(c.portAttrs).forEach((k) => { delete c.portAttrs[k].partUsed; if (!Object.keys(c.portAttrs[k]).length) delete c.portAttrs[k]; });
      if (!Object.keys(c.portAttrs).length) delete c.portAttrs;
      return c;
    };
    keys.forEach((k) => {
      const d = canonicalDoc(migrateDoc(cloneData(templatesData[k])).doc);
      const byId = new Map(d.nodes.map((n) => [n.id, n]));
      (d.providers || []).forEach((p) => {
        const t0 = performance.now();
        const part = TP.providerPart(d, [p.id]);
        const ms = performance.now() - t0;
        if (ms > slowest) { slowest = ms; slowestKey = `${k}/${p.id}`; }
        if (part.whole) return;
        parts++;
        if (part.counts.context > biggest.context) biggest = { key: `${k}/${p.id}`, items: part.counts.items, context: part.counts.context };
        const kept = new Set(part.doc.nodes.map((n) => n.id));
        part.doc.nodes.forEach((n) => {
          if (part.items.nodes.has(n.id)) { if (show(unmark(n)) !== show(byId.get(n.id))) bad.push(`${k}/${p.id}: item ${n.id} differs`); }
          else if (!Object.keys(n).every((x) => allowed.has(x))) bad.push(`${k}/${p.id}: ${n.id} keeps ${Object.keys(n).filter((x) => !allowed.has(x))}`);
        });
        part.context.forEach((c, id) => { if (c.hop !== null && c.hop > 2) bad.push(`${k}/${p.id}: ${id} at hop ${c.hop}`); if (c.hop === null && !c.why.has('problem')) bad.push(`${k}/${p.id}: ${id} has no hop`); });
        if (!part.doc.links.every((l) => kept.has(l.source) && kept.has(l.target))) bad.push(`${k}/${p.id}: a cable with an end not kept`);
        const gids = new Set((part.doc.groups || []).map((g) => g.id));
        (part.doc.groups || []).forEach((g) => { if (g.parent && !gids.has(g.parent)) bad.push(`${k}/${p.id}: group ${g.id} without its parent`); });
        part.doc.nodes.forEach((n) => { if (n.group && !gids.has(n.group)) bad.push(`${k}/${p.id}: ${n.id} without its group`); });
        const c = canonicalDoc(part.doc);
        if (c.nodes.length !== part.doc.nodes.length || c.links.length !== part.doc.links.length) bad.push(`${k}/${p.id}: the loader dropped ${part.doc.nodes.length - c.nodes.length} devices, ${part.doc.links.length - c.links.length} cables`);
        const foreign = [...c.nodes, ...c.links, ...(c.groups || [])].flatMap((r) => r.providers || []).filter((id) => id !== p.id);
        if (foreign.length || (c.providers || []).some((x) => x.id !== p.id)) bad.push(`${k}/${p.id}: another provider ${foreign}`);
      });
    });
    ok('every sample, every provider: the rule holds', parts > 10 && bad.length === 0, `${parts} parts; ` + bad.slice(0, 4).join(' | '));
    ok('the largest sample\'s part in under 200 ms', slowest < 200, `${slowest.toFixed(1)} ms ${slowestKey}`);
    out.push(`PERF :: providerPart: slowest ${slowest.toFixed(1)} ms (${slowestKey}); largest context ${biggest.key}: ${biggest.items} items, ${biggest.context} linked; ${parts} parts`);

    // The strings.
    const { has, locales } = window.CarinoI18N;
    const strs = ['{list} and {last}', 'What the link carries', 'The whole network', 'Only what {names} looks after', 'Only what {names} look after',
      '1 device of theirs', '{n} devices of theirs', '1 linked device around them', '{n} linked devices around them',
      '1 device on their ports left out', '{n} devices on their ports left out', 'Port {port}: in use (not in your part)'];
    locales.forEach((loc) => { const missing = strs.filter((s) => !has(loc, s)); ok(`${loc} carries the part's strings`, !missing.length, missing.join(' | ')); });
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
