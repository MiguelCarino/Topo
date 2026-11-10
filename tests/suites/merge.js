// The merge engine (docs/SCOPE.md section 3, step 2, stage 2; js/merge.js):
//   A. two-way: added, kept (never removed), unchanged, a field conflict
//      defaulting to mine, a blank of mine filled from theirs, choices;
//   B. matching devices: id, asset tag, serial, MAC, IP, name; ambiguous is
//      a conflict (skip by default, a candidate, or add as new); ids no file
//      carried are no identity (A6); a contradicted id is another device (A7);
//   C. interfaces: matched inside a device, a colliding template id minted
//      and every reference following it;
//   D. cables: by id, by both ends either way round, by ports, parallel
//      ones ambiguous, a replugged one matched;
//   E. every other kind: subnets (id first, never relocated), groups (id,
//      then path), Wi-Fi, providers, notes, saved searches, custom columns,
//      accepted findings and pins (their scope too), the report header,
//      expected lives, the table view;
//   F. three-way: the per-field table and the per-item table, added on both
//      sides, the removal cascades (A10);
//   G. positions: matched stay, added by group, by cable, beside the map,
//      clear of every device, on the grid;
//   H. the result: deterministic, idempotent, canonical, its counts what it
//      holds, the findings it would have, the open document untouched, a
//      newer document refused, a 300-device budget;
//   I. the network log: union, entry, chain, tamper shown.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const TM = window.TopoMerge;
  const heldNodes = state.nodes, heldLinks = state.links, heldLog = state.log;
  const heldOpen = JSON.stringify(serializeDoc());

  // ---- Fixtures ----
  const nic = (id, ip, mac, extra = {}) => Object.assign({ id, name: 'eth0', ip: ip || '' }, mac ? { mac } : {}, extra);
  const dev = (id, name, o = {}) => Object.assign({ id, type: 'pc', name, x: 0, y: 0, interfaces: [] }, o);
  const cab = (id, source, target, o = {}) => Object.assign({ id, source, target }, o);
  const D = (o = {}) => Object.assign({ v: DOC_VERSION, nodes: [], links: [] }, o);
  const plan = (m, t, b) => TM.planMerge(m, t, b || null);
  const apply = (m, p, c) => TM.applyMergePlan(m, p, c || {});
  const item = (p, key) => p.items.find((i) => i.key === key) || null;
  const field = (it, f) => (it ? it.fields.find((x) => x.field === f) || null : null);
  const nodeOf = (doc, id) => (doc.nodes || []).find((n) => n.id === id) || null;
  const nodeNamed = (doc, name) => (doc.nodes || []).find((n) => n.name === name) || null;
  const statusOf = (p, key) => { const i = item(p, key); return i ? i.status : null; };
  // A deterministic stand-in for SHA-256 (64 hex), for --dump-dom.
  const fakeDigest = async (text) => {
    let s = '';
    for (let seed = 1; seed <= 8; seed++) {
      let h = 0x811c9dc5 ^ seed;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
      s += (h >>> 0).toString(16).padStart(8, '0');
    }
    return s;
  };

  try {
    ok('the engine is loaded', !!TM && typeof planMerge === 'function' && typeof applyMergePlan === 'function');

    // ---- A. Two-way ----
    {
      const mine = D({ nodes: [dev('a', 'Alpha', { interfaces: [nic('i1', '10.0.0.1/24', 'aa:00:00:00:00:01')], notes: 'mine' }),
        dev('k', 'KeptOnlyMine', { interfaces: [nic('i1', '10.0.0.9/24')] })] });
      const theirs = D({ nodes: [dev('a', 'Alpha', { interfaces: [nic('i1', '10.0.0.1/24', 'aa:00:00:00:00:01')], notes: 'theirs', serial: 'SN1' }),
        dev('b', 'Beta', { x: 300, interfaces: [nic('i1', '10.0.0.2/24')] })] });
      const p = plan(mine, theirs);
      ok('A1 two-way without a base', p.mode === 'two-way' && p.baseRev === null);
      ok('A2 an item only in theirs is added', statusOf(p, 'nodes:b') === 'added');
      ok('A3 an item only in mine is kept, never removed', statusOf(p, 'nodes:k') === 'unchanged' && !p.items.some((i) => i.status === 'removed'));
      const a = item(p, 'nodes:a');
      ok('A4 in both and different: a conflict', a.status === 'conflict' && a.conflict.type === 'fields' && a.matchedBy === 'id');
      const notes = field(a, 'notes'), serial = field(a, 'serial');
      ok('A5 the differing field defaults to mine', notes && notes.conflict && notes.take === 'mine' && notes.mine === 'mine' && notes.theirs === 'theirs');
      ok('A6 a field empty in mine and filled in theirs takes theirs, no conflict', serial && !serial.conflict && serial.take === 'theirs');
      ok('A7 the counts', p.counts.added === 1 && p.counts.conflicts === 1 && p.counts.unchanged === 1 && p.counts.removed === 0, JSON.stringify([p.counts, p.items.map((i) => i.key + ' ' + i.status)]));
      const r = apply(mine, p);
      ok('A8 the defaults: mine kept, the blank filled, theirs added', nodeOf(r.doc, 'a').notes === 'mine' && nodeOf(r.doc, 'a').serial === 'SN1'
         && !!nodeOf(r.doc, 'b') && !!nodeOf(r.doc, 'k') && r.doc.nodes.length === 3);
      const r2 = apply(mine, p, { 'nodes:a#notes': 'theirs', 'nodes:a#serial': 'mine' });
      ok('A9 a choice takes theirs; a field that was no conflict ignores a choice', nodeOf(r2.doc, 'a').notes === 'theirs' && nodeOf(r2.doc, 'a').serial === 'SN1');
      ok('A10 the counts of the result', r.counts.added === 1 && r.counts.changed === 1 && r.counts.removed === 0 && r.counts.conflicts === 1, JSON.stringify(r.counts));
      const filled = D({ nodes: [dev('a', 'Alpha', { interfaces: [nic('i1', '10.0.0.1/24')], notes: 'filled' })] });
      const blank = D({ nodes: [dev('a', 'Alpha', { interfaces: [nic('i1', '10.0.0.1/24')], notes: '' })] });
      const pb = plan(filled, blank);
      ok('A11 a field filled in mine and empty in theirs keeps mine quietly, no conflict (D32)', !field(item(pb, 'nodes:a'), 'notes')
         && pb.counts.conflicts === 0 && apply(filled, pb).doc.nodes[0].notes === 'filled');
      const same = plan(mine, clone(mine));
      ok('A12 the same network: everything unchanged, nothing to take', same.items.every((i) => i.status === 'unchanged') && same.counts.unchanged === same.items.length);
    }

    // ---- B. Matching devices ----
    {
      const base = (o) => dev('m1', 'Mine', Object.assign({ interfaces: [nic('i1', '10.1.0.5/24', 'aa:bb:cc:00:00:01')] }, o));
      const t = (o) => dev('t1', 'Theirs', Object.assign({ interfaces: [nic('j1', '10.9.9.9/24', 'aa:bb:cc:99:99:99')] }, o));
      const by = (mineNode, theirsNode) => { const p = plan(D({ nodes: [mineNode] }), D({ nodes: [theirsNode] })); return { p, it: item(p, 'nodes:' + mineNode.id) }; };
      let x = by(base({ assetTag: 'TAG-1' }), t({ assetTag: 'tag-1' }));
      ok('B1 by asset tag (any case)', x.it.matchedBy === 'assetTag' && x.it.theirsId === 't1' && !item(x.p, 'nodes:t1'));
      x = by(base({ serial: 'S-77' }), t({ serial: 'S-77' }));
      ok('B2 by serial number', x.it.matchedBy === 'serial');
      x = by(base(), t({ interfaces: [nic('j1', '10.9.9.9/24', 'AA-BB-CC-00-00-01')] }));
      ok('B3 by MAC (any spelling)', x.it.matchedBy === 'mac');
      x = by(base(), t({ name: 'Mine', interfaces: [nic('j1', '10.1.0.5/24')] }));
      ok('B4 by IP', x.it.matchedBy === 'ip');
      x = by(base({ interfaces: [nic('i1', '')] }), t({ name: 'MINE', interfaces: [nic('j1', '')] }));
      ok('B5 by name (any case)', x.it.matchedBy === 'name');
      x = by(base({ interfaces: [nic('i1', '')] }), t({ name: 'Unnamed Node', interfaces: [nic('j1', '')] }));
      ok('B6 no match: added', x.it.status === 'unchanged' && statusOf(x.p, 'nodes:t1') === 'added');
      x = by(base({ assetTag: 'A' }), t({ name: 'Mine', assetTag: 'B', interfaces: [nic('j1', '10.1.0.5/24')] }));
      ok('B7 by IP, but another asset tag: another device', statusOf(x.p, 'nodes:t1') === 'added');
      x = by(base({ type: 'router' }), t({ name: 'Printer', type: 'printer', interfaces: [nic('j1', '10.1.0.5/24')] }));
      ok('B8 by IP, but another name and type: another device', statusOf(x.p, 'nodes:t1') === 'added');

      // Ambiguous.
      const mine = D({ nodes: [dev('p1', 'PC', { interfaces: [nic('i1', '')] }), dev('p2', 'PC', { x: 200, interfaces: [nic('i1', '')] }),
        dev('sw', 'Switch', { type: 'switch', x: 0, y: 300, interfaces: [nic('i1', '', 'aa:aa:aa:aa:aa:01')] })] });
      const theirs = D({ nodes: [dev('q', 'pc', { interfaces: [nic('e', '')], notes: 'from the closet' }),
        dev('sw2', 'Switch', { type: 'switch', interfaces: [nic('i9', '', 'aa:aa:aa:aa:aa:01')] })],
        links: [cab('lq', 'q', 'sw2', { targetIface: 'p4' })] });
      const p = plan(mine, theirs);
      const amb = item(p, 'nodes:q');
      ok('B9 a name two of mine have: an ambiguous conflict, never a guess', amb && amb.status === 'conflict' && amb.conflict.type === 'ambiguous'
         && JSON.stringify(amb.conflict.candidates) === '["p1","p2"]' && amb.conflict.by === 'name');
      const skip = apply(mine, p);
      ok('B10 skipped by default: not added, its cable dropped and said', skip.doc.nodes.length === 3 && !(skip.doc.links || []).length
         && skip.notes.some((n) => /Skipped/.test(n.key)) && skip.notes.some((n) => /Dropped/.test(n.key)), JSON.stringify(skip.notes));
      const pick = apply(mine, p, { 'nodes:q': 'p2' });
      ok('B11 a candidate chosen: matched, its fields and its cable follow', pick.doc.nodes.length === 3 && nodeOf(pick.doc, 'p2').notes === 'from the closet'
         && pick.doc.links.length === 1 && pick.doc.links[0].source === 'p2' && pick.doc.links[0].target === 'sw' && pick.doc.links[0].targetIface === 'p4');
      const asNew = apply(mine, p, { 'nodes:q': 'add' });
      ok('B12 added as new', asNew.doc.nodes.length === 4 && !!nodeOf(asNew.doc, 'q') && asNew.doc.links[0].source === 'q' && asNew.counts.added >= 2);
      ok('B13 an answered ambiguity still counts as a conflict met', pick.counts.conflicts >= 1);

      // A6: ids nobody carried.
      const noIds = (name, ip) => ({ v: DOC_VERSION, nodes: [{ type: 'pc', name, x: 0, y: 0, interfaces: [{ name: 'eth0', ip }] }], links: [] });
      const p6 = plan(noIds('Alpha', '10.0.0.1/24'), noIds('Bravo', '10.0.0.2/24'));
      ok('B14 records with no id are not paired by the ids a load mints (A6)', p6.counts.added === 1
         && apply(noIds('Alpha', '10.0.0.1/24'), p6).doc.nodes.map((n) => n.name).sort().join() === 'Alpha,Bravo');

      // A7: a template's fixed id on another device.
      const tm = D({ nodes: [dev('h1', 'Router', { type: 'router', interfaces: [nic('i1', '192.168.1.1/24', '00:11:22:33:44:55')] })] });
      const tt = D({ nodes: [dev('h1', 'NAS', { type: 'nas', interfaces: [nic('i1', '192.168.1.20/24', '00:11:22:33:44:66')] })] });
      const p7 = plan(tm, tt);
      const r7 = apply(tm, p7);
      ok('B15 the same id on another device (MACs, name and type differ) is unrelated: a new id', statusOf(p7, 'nodes:h1m1') === 'added'
         && nodeOf(r7.doc, 'h1').name === 'Router' && nodeOf(r7.doc, 'h1m1').name === 'NAS' && p7.idMap.nodes.h1 === 'h1m1');
      const p8 = plan(D({ nodes: [dev('h1', 'Box', { assetTag: 'X1', interfaces: [nic('i1', '')] })] }), D({ nodes: [dev('h1', 'Box', { assetTag: 'X2', interfaces: [nic('i1', '')] })] }));
      ok('B16 the same id with another asset tag is unrelated', statusOf(p8, 'nodes:h1m1') === 'added');
      const p9 = plan(D({ nodes: [dev('h1', 'Box', { interfaces: [nic('i1', '')] })] }), D({ nodes: [dev('h1', 'Box renamed', { interfaces: [nic('i1', '')] })] }));
      ok('B17 the same id renamed only is the same device', item(p9, 'nodes:h1').matchedBy === 'id' && field(item(p9, 'nodes:h1'), 'name').conflict);
      // Strongest first: a MAC match claims before a weaker name match can.
      const pm = plan(D({ nodes: [dev('x', 'Cam', { interfaces: [nic('i1', '', 'aa:00:00:00:00:0a')] }), dev('y', 'Cam 2', { interfaces: [nic('i1', '')] })] }),
        D({ nodes: [dev('u', 'Cam 2', { interfaces: [nic('e', '', 'aa:00:00:00:00:0a')] }), dev('v', 'Cam', { interfaces: [nic('e', '')] })] }));
      ok('B18 a strong match claims first: by MAC, then the name left', item(pm, 'nodes:x').theirsId === 'u' && item(pm, 'nodes:x').matchedBy === 'mac'
         && statusOf(pm, 'nodes:v') === 'added');
    }

    // ---- C. Interfaces ----
    {
      const mine = D({ nodes: [dev('s', 'Server', { type: 'server', interfaces: [nic('i1', '10.0.0.10/24', '02:00:00:00:00:01')] }),
        dev('sw', 'Core', { type: 'switch', y: 200, interfaces: [nic('i1', '', '02:00:00:00:00:99')] })] });
      const theirs = D({ nodes: [dev('s', 'Server', { type: 'server', interfaces: [nic('i1', '10.0.0.10/24', '02:00:00:00:00:01'),
        nic('i2', '10.0.1.10/24', '02:00:00:00:00:02', { name: 'eth1' })] }),
      dev('sw', 'Core', { type: 'switch', y: 200, interfaces: [nic('i1', '', '02:00:00:00:00:99')] })],
      links: [cab('l9', 's', 'sw', { sourceIface: 'i2', targetIface: 'p3' })] });
      // Theirs' new NIC is i1 on their side and i1 is taken in mine: a
      // different MAC on the same id is another NIC.
      theirs.nodes[0].interfaces = [nic('i9', '10.0.0.10/24', '02:00:00:00:00:01'), nic('i1', '10.0.1.10/24', '02:00:00:00:00:02', { name: 'eth1' })];
      theirs.links[0].sourceIface = 'i1';
      const p = plan(mine, theirs);
      const s = item(p, 'nodes:s');
      const kids = s.children;
      ok('C1 interfaces are child items of a matched device', s.status === 'changed' && kids.length === 2);
      ok('C2 matched by MAC whatever its id', kids[0].mineId === 'i1' && kids[0].theirsId === 'i9' && kids[0].matchedBy === 'mac' && kids[0].status === 'unchanged');
      ok('C3 the same id with another MAC is another NIC: added under a new id', kids[1].status === 'added' && kids[1].theirs.id === 'i1m1' && p.idMap.ifaces.s.i1 === 'i1m1');
      const r = apply(mine, p);
      const srv = nodeOf(r.doc, 's');
      ok('C4 the NIC is added and the cable on it follows its new id', srv.interfaces.map((i) => i.id).join() === 'i1,i1m1'
         && r.doc.links.length === 1 && r.doc.links[0].sourceIface === 'i1m1' && r.doc.links[0].targetIface === 'p3');
      // An interface's field.
      const t2 = clone(mine); t2.nodes[0].interfaces[0].ip = '10.0.0.11/24';
      const p2 = plan(mine, t2);
      const k2 = item(p2, 'nodes:s').children[0];
      ok('C5 an interface field differing is a conflict on the child, the device in conflict', k2.status === 'conflict' && field(k2, 'ip').mine === '10.0.0.10/24'
         && item(p2, 'nodes:s').status === 'conflict');
      ok('C6 chosen per interface field', nodeOf(apply(mine, p2, { [k2.key + '#ip']: 'theirs' }).doc, 's').interfaces[0].ip === '10.0.0.11/24');
      // Bond members follow interface ids.
      const bm = D({ nodes: [dev('n', 'NAS', { type: 'nas', interfaces: [nic('i1', '', '02:00:00:00:01:01')] })] });
      const bt = D({ nodes: [dev('n', 'NAS', { type: 'nas', interfaces: [nic('e1', '', '02:00:00:00:01:01'), nic('i1', '', '02:00:00:00:01:02', { name: 'eth1' }),
        { id: 'b0', name: 'bond0', ip: '10.0.0.40/24', bond: { mode: '802.3ad', members: ['e1', 'i1'] } }] })] });
      const rb = apply(bm, plan(bm, bt));
      const bond = nodeOf(rb.doc, 'n').interfaces.find((i) => i.bond);
      ok('C7 a bond names its members by their ids here', bond && JSON.stringify(bond.bond.members) === '["i1","i1m1"]', JSON.stringify(bond));
    }

    // ---- D. Cables ----
    {
      const nodes = [dev('a', 'A', { interfaces: [nic('i1', '', '02:00:00:00:0a:01')] }), dev('b', 'B', { x: 200, interfaces: [nic('i1', '', '02:00:00:00:0b:01')] })];
      const mine = D({ nodes, links: [cab('l1', 'a', 'b', { sourceIface: 'i1', targetIface: 'i1' })] });
      const swapped = D({ nodes: clone(nodes), links: [cab('zz', 'b', 'a', { sourceIface: 'i1', targetIface: 'i1' })] });
      const p = plan(mine, swapped);
      ok('D1 a cable drawn the other way round is the same cable', item(p, 'links:l1').matchedBy === 'ends' && item(p, 'links:l1').status === 'unchanged' && p.counts.added === 0);
      const byId = plan(mine, D({ nodes: clone(nodes), links: [cab('l1', 'a', 'b', { sourceIface: 'i1', targetIface: 'i1', medium: 'fiber' })] }));
      ok('D2 by id when its ends are the same two devices; a blank medium filled', item(byId, 'links:l1').matchedBy === 'id' && field(item(byId, 'links:l1'), 'medium').take === 'theirs');
      // The same id between other devices is another cable.
      const three = nodes.concat([dev('c', 'C', { x: 400, interfaces: [nic('i1', '', '02:00:00:00:0c:01')] })]);
      const other = plan(D({ nodes: clone(three), links: [cab('l1', 'a', 'b')] }), D({ nodes: clone(three), links: [cab('l1', 'a', 'c')] }));
      ok('D3 the same id between other devices: another cable, a new id', statusOf(other, 'links:l1m1') === 'added');
      // Parallel cables: the ports say which.
      const par = D({ nodes: [dev('sw', 'SW', { type: 'switch', interfaces: [nic('i1', '')] }), dev('h', 'Host', { x: 200, interfaces: [nic('i1', '', '02:00:00:00:00:a1'), nic('i2', '', '02:00:00:00:00:a2', { name: 'eth1' })] })],
        links: [cab('c1', 'sw', 'h', { sourceIface: 'p1', targetIface: 'i1' }), cab('c2', 'sw', 'h', { sourceIface: 'p2', targetIface: 'i2' })] });
      const parT = clone(par);
      parT.links = [cab('x2', 'h', 'sw', { sourceIface: 'i2', targetIface: 'p2', cable: { label: 'B-2' } })];
      const pp = plan(par, parT);
      ok('D4 parallel cables told apart by their ports', item(pp, 'links:c2').theirsId === 'x2' && field(item(pp, 'links:c2'), 'cable.label').take === 'theirs');
      const noPorts = clone(par); noPorts.links = [cab('x3', 'sw', 'h')];
      const pa = plan(par, noPorts);
      ok('D5 a cable that could be either of two: ambiguous', item(pa, 'links:x3').conflict.type === 'ambiguous' && item(pa, 'links:x3').conflict.candidates.join() === 'c1,c2');
      // Replugged: the only cable between the two on each side.
      const rp = clone(mine); rp.links = [cab('q', 'a', 'b', { sourceIface: 'i1', targetIface: 'p7' })];
      const prp = plan(mine, rp);
      ok('D6 the only cable between two devices on both sides, on other ports: the same cable', item(prp, 'links:l1').theirsId === 'q'
         && field(item(prp, 'links:l1'), 'targetIface').conflict && prp.counts.added === 0);
      // A cable between two of mine found by MAC names mine's ids.
      const macs = D({ nodes: [dev('A2', 'a', { interfaces: [nic('e', '', '02:00:00:00:0a:01')] }), dev('B2', 'b', { interfaces: [nic('e', '', '02:00:00:00:0b:01')] })],
        links: [cab('new', 'A2', 'B2', { sourceIface: 'e', targetIface: 'e' })] });
      const pmc = plan(D({ nodes: clone(nodes) }), macs);
      const rmc = apply(D({ nodes: clone(nodes) }), pmc);
      ok('D7 a new cable between two of mine names mine\'s devices and interfaces', rmc.doc.links.length === 1
         && rmc.doc.links[0].source === 'a' && rmc.doc.links[0].target === 'b' && rmc.doc.links[0].sourceIface === 'i1' && rmc.doc.links[0].targetIface === 'i1');
    }

    // ---- E. Every other kind ----
    {
      // Subnets.
      const nm = D({ networks: [{ id: 'net1', cidr: '10.0.0.0/24', name: 'Office' }] });
      const nt = D({ networks: [{ id: 'net1', cidr: '10.0.0.0/23', name: 'Office' }, { id: 'n9', cidr: '10.0.0.0/22' }, { id: 'nx', cidr: '172.16.0.0/16' }] });
      const pn = plan(nm, nt);
      ok('E1 a subnet re-addressed under its id is the same subnet: its range a conflict (A8)', item(pn, 'networks:net1').matchedBy === 'id'
         && field(item(pn, 'networks:net1'), 'cidr').conflict);
      const rn = apply(nm, pn);
      ok('E2 never relocated: an overlapping range is added as it is', rn.doc.networks.map((n) => n.cidr).join() === '10.0.0.0/24,10.0.0.0/22,172.16.0.0/16');
      const byRange = plan(D({ networks: [{ id: 'a', cidr: '192.168.5.0/24' }] }), D({ networks: [{ id: 'b', cidr: '192.168.5.0/24', vlan: 20 }] }));
      ok('E3 another id, the same range: matched by range', item(byRange, 'networks:a').matchedBy === 'range' && field(item(byRange, 'networks:a'), 'vlan').take === 'theirs');

      // Groups: id, then path, parents' names and all.
      const gm = D({ groups: [{ id: 'b1', name: 'HQ', kind: 'building' }, { id: 'f1', name: 'Floor 2', kind: 'floor', parent: 'b1' }, { id: 'r1', name: 'Closet', kind: 'room', parent: 'f1' }],
        nodes: [dev('sw', 'SW', { type: 'switch', group: 'r1', interfaces: [nic('i1', '', '02:00:00:00:00:51')] })] });
      const gt = D({ groups: [{ id: 'B', name: 'hq', kind: 'building' }, { id: 'F', name: 'Floor 2', kind: 'floor', parent: 'B' }, { id: 'R', name: 'Closet', kind: 'room', parent: 'F' },
        { id: 'K', name: 'Rack 1', kind: 'rack', parent: 'R' }, { id: 'X', name: 'Closet', kind: 'room' }],
      nodes: [dev('ap', 'AP', { type: 'ap', group: 'R', interfaces: [nic('w1', '', '02:00:00:00:00:52')] })] });
      const pg = plan(gm, gt);
      ok('E4 groups matched by their path, parents first', item(pg, 'groups:r1').theirsId === 'R' && item(pg, 'groups:r1').matchedBy === 'path'
         && item(pg, 'groups:b1').matchedBy === 'path');
      ok('E5 a room of the same name elsewhere is another group', statusOf(pg, 'groups:X') === 'added');
      const rg = apply(gm, pg);
      ok('E6 references follow: the new rack inside mine\'s room, the device in it', rg.doc.groups.find((g) => g.id === 'K').parent === 'r1'
         && nodeOf(rg.doc, 'ap').group === 'r1');
      const ren = clone(gm); ren.groups[2].name = 'Server room';
      ok('E7 a room renamed under its id is the same room: its name a conflict', field(item(plan(gm, ren), 'groups:r1'), 'name').conflict);

      // Wi-Fi: by SSID; a cable's and a radio's references follow.
      const wm = D({ wifi: [{ id: 'w1', ssid: 'Office', security: 'wpa2' }] });
      const wt = D({ wifi: [{ id: 'wz', ssid: 'Office', security: 'wpa3' }, { id: 'wg', ssid: 'Guest' }],
        nodes: [dev('ap', 'AP', { type: 'ap', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true, radio: { standard: 'ax', bands: [{ band: '5', ssids: ['wz', 'wg'] }] } }] }),
          dev('lap', 'Laptop', { type: 'laptop', x: 200, interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] })],
        links: [cab('wl', 'lap', 'ap', { sourceIface: 'w1', targetIface: 'w1', medium: 'wireless', wifi: { ssid: 'wz' } })] });
      const pw = plan(wm, wt);
      ok('E8 Wi-Fi networks matched by SSID; the security a conflict', item(pw, 'wifi:w1').matchedBy === 'ssid' && field(item(pw, 'wifi:w1'), 'security').conflict);
      const rw = apply(wm, pw);
      const radio = nodeOf(rw.doc, 'ap').interfaces[0].radio;
      ok('E9 a radio band\'s SSIDs and a cable\'s SSID name mine\'s network', radio && JSON.stringify(radio.bands[0].ssids) === '["w1","wg"]'
         && rw.doc.links[0].wifi.ssid === 'w1', JSON.stringify(radio));

      // Providers.
      const pm = D({ providers: [{ id: 'pv1', name: 'FiberCo', service: 'internet' }] });
      const pt = D({ providers: [{ id: 'pz', name: 'fiberco', phone: '555' }], nodes: [dev('mo', 'Modem', { type: 'router', provider: 'pz', interfaces: [nic('i1', '')] })] });
      const pp = plan(pm, pt);
      const rp = apply(pm, pp);
      ok('E10 providers matched by name; a device\'s provider follows', item(pp, 'providers:pv1').matchedBy === 'name' && rp.doc.providers.length === 1
         && rp.doc.providers[0].phone === '555' && nodeOf(rp.doc, 'mo').provider === 'pv1');

      // Notes.
      const am = D({ nodes: [dev('n1', 'N', { interfaces: [nic('i1', '')] })], annotations: [{ id: 't1', x: 0, y: 0, text: 'Check', targets: ['n1'] }] });
      const at = D({ nodes: [dev('n1', 'N', { interfaces: [nic('i1', '')] })], annotations: [{ id: 'tz', x: 50, y: 50, text: 'Check', targets: ['n1'] }, { id: 't1', x: 0, y: 0, text: 'Other', targets: [] }] });
      const pa = plan(am, at);
      ok('E11 notes matched by id, else the same text on the same things', item(pa, 'annotations:t1').theirsId === 't1' && field(item(pa, 'annotations:t1'), 'text').conflict
         && statusOf(pa, 'annotations:tz') === 'added');
      const am2 = plan(D({ nodes: am.nodes, annotations: [{ id: 'a', x: 0, y: 0, text: 'Check', targets: ['n1'] }] }), D({ nodes: am.nodes, annotations: [{ id: 'b', x: 9, y: 9, text: 'Check', targets: ['n1'] }] }));
      ok('E12 the same text on the same device: the same note', item(am2, 'annotations:a').matchedBy === 'text' && am2.counts.added === 0);

      // Custom columns and saved searches: c1 and sq_1 are in every document.
      const cm = D({ columns: [{ id: 'c1', name: 'Cost', kind: 'number' }], nodes: [dev('n', 'N', { interfaces: [nic('i1', '')], extra: { c1: 10 } })],
        searches: [{ id: 'sq_1', name: 'Old', query: 'type:pc' }] });
      const ct = D({ columns: [{ id: 'c1', name: 'Owner' }, { id: 'c2', name: 'cost', kind: 'number' }], nodes: [dev('n', 'N', { interfaces: [nic('i1', '')], extra: { c1: 'Ana', c2: 10 } })],
        searches: [{ id: 'sq_1', name: 'Owners', query: 'x', columns: ['name', 'x:c1'], sort: 'x:c1' }, { id: 'sq_2', name: 'old', query: 'type:pc' }],
        tableView: { devices: { order: ['name', 'x:c1'] } } });
      const pc = plan(cm, ct);
      ok('E13 a column under another column\'s id is unrelated: the next c<N> (A7)', item(pc, 'columns:c1').theirsId === 'c2' && statusOf(pc, 'columns:c2') === 'added'
         && pc.idMap.columns.c1 === 'c2' && pc.idMap.columns.c2 === 'c1', JSON.stringify(pc.idMap.columns));
      const rc = apply(cm, pc);
      ok('E14 a device\'s values follow their column', JSON.stringify(nodeOf(rc.doc, 'n').extra) === '{"c1":10,"c2":"Ana"}', JSON.stringify(nodeOf(rc.doc, 'n').extra));
      ok('E15 a search under another\'s id is unrelated; matched by name; its column keys follow', item(pc, 'searches:sq_1').theirsId === 'sq_2'
         && rc.doc.searches.length === 2 && JSON.stringify(rc.doc.searches[1].columns) === '["x:c2"]' && rc.doc.searches[1].sort === 'x:c2'
         && rc.doc.searches[1].id === 'sq_1m1', JSON.stringify(rc.doc.searches));
      ok('E16 the table view: mine wins silently in two-way', statusOf(pc, 'tableView:tableView') === 'unchanged' && !rc.doc.tableView);

      // Accepted findings and pins, and a scope naming a subnet.
      const fm = D({ nodes: [dev('a', 'A', { interfaces: [nic('i1', '10.0.0.5/24', '02:00:00:00:00:a1')] })], networks: [{ id: 'net1', cidr: '10.0.0.0/24' }],
        accepted: [{ check: 'gw', nodeIds: ['a'], reason: 'Lab' }] });
      const ft = D({ nodes: [dev('A', 'A', { interfaces: [nic('e', '10.0.0.5/24', '02:00:00:00:00:a1')] })], networks: [{ id: 'nn', cidr: '10.0.0.0/24' }],
        accepted: [{ check: 'gw', nodeIds: ['A'], reason: 'Lab, checked' }, { check: 'address-capacity', nodeIds: ['A'], scope: 'nn', reason: 'Planned' }],
        pinned: [{ check: 'dhcp-pool', nodeIds: ['A'], scope: 'nn:clash', note: 'Look' }] });
      const pf = plan(fm, ft);
      ok('E17 an accepted finding matched by its check and what it names: the reason a conflict', item(pf, 'accepted:gw||a|').status === 'conflict');
      const rf = apply(fm, pf);
      ok('E18 a scope naming a subnet follows the subnet (A9)', rf.doc.accepted.length === 2 && rf.doc.accepted[1].scope === 'net1' && rf.doc.accepted[1].nodeIds[0] === 'a'
         && rf.doc.pinned[0].scope === 'net1:clash' && rf.doc.pinned[0].nodeIds[0] === 'a', JSON.stringify([rf.doc.accepted, rf.doc.pinned]));

      // Report header and expected lives.
      const hm = D({ report: { client: 'Acme', site: 'HQ' }, expectedLife: { pc: 5 } });
      const ht = D({ report: { client: 'Acme S.A.', ref: 'CS-1' }, expectedLife: { pc: 6, server: 7 } });
      const ph = plan(hm, ht);
      const rh = item(ph, 'report:report'), el = item(ph, 'expectedLife:expectedLife');
      ok('E19 the report header field by field: a conflict, a blank filled, a blank of theirs kept mine quietly (D32)', field(rh, 'client').conflict
         && field(rh, 'ref').take === 'theirs' && !field(rh, 'site'));
      ok('E20 expected lives per type', field(el, 'pc').conflict && field(el, 'server').take === 'theirs');
      const rr = apply(hm, ph);
      ok('E21 applied: mine kept, the blanks filled', JSON.stringify(rr.doc.report) === JSON.stringify({ site: 'HQ', client: 'Acme', ref: 'CS-1' })
         && rr.doc.expectedLife.pc === 5 && rr.doc.expectedLife.server === 7, JSON.stringify([rr.doc.report, rr.doc.expectedLife]));
    }

    // ---- F. Three-way ----
    {
      const B0 = D({ nodes: [
        dev('a', 'A', { interfaces: [nic('i1', '10.0.0.1/24', '02:00:00:00:00:01')], notes: 'base' }),
        dev('b', 'B', { x: 200, interfaces: [nic('i1', '10.0.0.2/24')] }),
        dev('c', 'C', { x: 400, interfaces: [nic('i1', '10.0.0.3/24')] }),
        dev('d', 'D', { x: 600, interfaces: [nic('i1', '10.0.0.4/24')] }),
        dev('e', 'E', { x: 800, interfaces: [nic('i1', '10.0.0.5/24')] })],
      links: [cab('ab', 'a', 'b'), cab('cd', 'c', 'd')],
      tableView: { devices: { hidden: ['os'] } } });
      // Per field.
      const fmine = clone(B0), fthe = clone(B0);
      fmine.nodes[0].os = 'mine-os';                       // only mine
      fthe.nodes[0].gw = '10.0.0.254';                     // only theirs
      fmine.nodes[0].dns = '1.1.1.1'; fthe.nodes[0].dns = '1.1.1.1';   // both, the same
      fmine.nodes[0].notes = 'mine'; fthe.nodes[0].notes = 'theirs';   // both, different
      const pf = plan(fmine, fthe, B0);
      const a = item(pf, 'nodes:a');
      ok('F1 three-way with a base', pf.mode === 'three-way');
      ok('F2 changed only in theirs: theirs taken, no conflict', field(a, 'gw').take === 'theirs' && !field(a, 'gw').conflict && field(a, 'gw').base === '');
      ok('F3 changed only in mine: mine stays (not listed)', !field(a, 'os'));
      ok('F4 changed alike on both: fine', !field(a, 'dns'));
      ok('F5 changed differently on both: a conflict defaulting to mine', field(a, 'notes').conflict && field(a, 'notes').take === 'mine' && field(a, 'notes').base === 'base');
      const rf = apply(fmine, pf);
      const ra = nodeOf(rf.doc, 'a');
      ok('F6 applied', ra.os === 'mine-os' && ra.gw === '10.0.0.254' && ra.dns === '1.1.1.1' && ra.notes === 'mine');
      ok('F7 a field only theirs emptied is emptied (three-way)', (() => {
        const t = clone(B0); t.nodes[0].notes = '';
        return apply(B0, plan(B0, t, B0)).doc.nodes[0].notes === '';
      })());

      // Per item.
      const mine = clone(B0), theirs = clone(B0);
      theirs.nodes = theirs.nodes.filter((n) => n.id !== 'b' && n.id !== 'c');   // theirs removed b (mine left it) and c (mine edited it)
      theirs.links = theirs.links.filter((l) => l.id !== 'ab' && l.id !== 'cd');
      mine.nodes.find((n) => n.id === 'c').notes = 'edited in mine';
      mine.nodes = mine.nodes.filter((n) => n.id !== 'd' && n.id !== 'e');      // mine removed d and e
      theirs.nodes.find((n) => n.id === 'e').notes = 'edited in theirs';      // theirs edited e
      mine.links = mine.links.filter((l) => l.id !== 'cd');
      mine.nodes.push(dev('m', 'MineNew', { x: 1000, interfaces: [nic('i1', '10.0.0.6/24')] }));
      theirs.nodes.push(dev('t', 'TheirsNew', { x: 1200, interfaces: [nic('i1', '10.0.0.7/24')] }));
      mine.nodes.push(dev('m2', 'Shared new', { x: 1400, interfaces: [nic('i1', '', '02:00:00:00:00:77')], notes: 'mine says' }));
      theirs.nodes.push(dev('t2', 'Shared new', { x: 1400, interfaces: [nic('j', '', '02:00:00:00:00:77')], notes: 'theirs says', serial: 'Z9' }));
      const p = plan(mine, theirs, B0);
      ok('F8 removed in theirs, untouched in mine: removed', statusOf(p, 'nodes:b') === 'removed' && statusOf(p, 'links:ab') === 'removed');
      ok('F9 removed in theirs, edited in mine: a conflict, keep by default', item(p, 'nodes:c').conflict.type === 'removed-theirs-edited-mine');
      ok('F10 removed in mine, untouched in theirs: stays removed', statusOf(p, 'nodes:d') === 'unchanged' && item(p, 'nodes:d').gone === true);
      ok('F11 removed in mine, edited in theirs: a conflict, keep by default', item(p, 'nodes:e').conflict.type === 'removed-mine-edited-theirs');
      ok('F12 added only in theirs: added; only in mine: kept', statusOf(p, 'nodes:t') === 'added' && statusOf(p, 'nodes:m') === 'unchanged');
      const sh = item(p, 'nodes:m2');
      ok('F13 added on both sides, matched: two-way rules for it', sh.matchedBy === 'mac' && field(sh, 'notes').conflict && field(sh, 'serial').take === 'theirs');
      const r = apply(mine, p);
      const ids = r.doc.nodes.map((n) => n.id).sort().join();
      ok('F14 the defaults applied', ids === 'a,c,e,m,m2,t', ids);
      ok('F15 a re-added item comes back with theirs\' values', nodeOf(r.doc, 'e').notes === 'edited in theirs');
      const r2 = apply(mine, p, { 'nodes:c': 'remove', 'nodes:e': 'remove' });
      ok('F16 removal conflicts answered "remove"', r2.doc.nodes.map((n) => n.id).sort().join() === 'a,m,m2,t');
      ok('F17 the counts: theirs\' new one and the one kept back added; the removals', r.counts.added === 2 && r.counts.removed === 2
         && r2.counts.added === 1 && r2.counts.removed === 3, JSON.stringify([r.counts, r2.counts]));
      const cnt = (doc) => (doc.nodes || []).length + (doc.links || []).length;
      ok('F18 nodes + cables = mine + added − removed', cnt(r.doc) === cnt(mine) + r.counts.added - r.counts.removed
         && cnt(r2.doc) === cnt(mine) + r2.counts.added - r2.counts.removed, JSON.stringify([cnt(mine), r.counts, cnt(r.doc), r2.counts, cnt(r2.doc)]));

      // A10: an edit to a device's cables is an edit to the device.
      const m3 = clone(B0), t3 = clone(B0);
      m3.nodes = m3.nodes.filter((n) => n.id !== 'b'); m3.links = m3.links.filter((l) => l.id !== 'ab');
      t3.links.find((l) => l.id === 'ab').cable = { label: 'A-B' };
      const p3 = plan(m3, t3, B0);
      ok('F19 removed in mine while theirs relabelled its cable: the device is a conflict too (A10)', item(p3, 'nodes:b').conflict.type === 'removed-mine-edited-theirs'
         && item(p3, 'links:ab').conflict.type === 'removed-mine-edited-theirs');
      const k3 = apply(m3, p3);
      ok('F20 kept by default: the device and its cable both back', !!nodeOf(k3.doc, 'b') && k3.doc.links.some((l) => l.id === 'ab' && l.cable.label === 'A-B'));
      const m4 = clone(B0), t4 = clone(B0);
      t4.nodes = t4.nodes.filter((n) => n.id !== 'b'); t4.links = t4.links.filter((l) => l.id !== 'ab');
      m4.links.push(cab('bc', 'b', 'c'));
      const p4 = plan(m4, t4, B0);
      ok('F21 theirs removed a device mine cabled since: a conflict (A10)', item(p4, 'nodes:b').conflict.type === 'removed-theirs-edited-mine');
      const d4 = apply(m4, p4, { 'nodes:b': 'remove' });
      ok('F22 removed anyway: its cables go with it, and are counted', !nodeOf(d4.doc, 'b') && !(d4.doc.links || []).some((l) => l.source === 'b' || l.target === 'b')
         && cnt(d4.doc) === cnt(m4) + d4.counts.added - d4.counts.removed);
      // The table view: theirs only when only theirs changed it.
      const tv = clone(B0); tv.tableView = { devices: { hidden: ['os', 'dns'] } };
      const ptv = plan(B0, tv, B0);
      ok('F23 the table view: theirs taken when only theirs changed it', statusOf(ptv, 'tableView:tableView') === 'changed'
         && JSON.stringify(apply(B0, ptv).doc.tableView.devices.hidden) === '["os","dns"]');
      const mtv = clone(B0); mtv.tableView = { devices: { hidden: ['ports'] } };
      ok('F24 both changed it: mine, silently', statusOf(plan(mtv, tv, B0), 'tableView:tableView') === 'unchanged');
      // An interface removed in theirs.
      const ib = D({ nodes: [dev('s', 'S', { interfaces: [nic('i1', '10.0.0.1/24'), nic('i2', '10.0.0.2/24', null, { name: 'eth1' })] })] });
      const it2 = clone(ib); it2.nodes[0].interfaces.pop();
      const pib = plan(clone(ib), it2, ib);
      ok('F25 an interface removed in theirs is removed', item(pib, 'nodes:s').children[1].status === 'removed'
         && nodeOf(apply(ib, pib).doc, 's').interfaces.length === 1);
      // Base ids nobody carried are no identity there either.
      const nb = { v: DOC_VERSION, nodes: [{ type: 'pc', name: 'Old', x: 0, y: 0, interfaces: [] }], links: [] };
      const pnb = plan({ v: DOC_VERSION, nodes: [{ type: 'pc', name: 'Mine', x: 0, y: 0, interfaces: [] }], links: [] }, { v: DOC_VERSION, nodes: [], links: [] }, nb);
      ok('F26 a base record with no id removes nothing', pnb.counts.removed === 0);
      // Accepted in base, removed in theirs.
      const ab = D({ nodes: [dev('a', 'A', { interfaces: [nic('i1', '')] })], accepted: [{ check: 'gw', nodeIds: ['a'], reason: 'ok' }] });
      const at = clone(ab); delete at.accepted;
      const pab = plan(clone(ab), at, ab);
      ok('F27 an accepted finding reopened in theirs is reopened', statusOf(pab, 'accepted:gw||a|') === 'removed' && !apply(ab, pab).doc.accepted);
    }

    // ---- F (more): cables, interfaces, hosts, caps, notes ----
    {
      const B1 = D({ nodes: [dev('sw', 'SW', { type: 'switch', interfaces: [nic('i1', '')] }), dev('pc', 'PC', { x: 200, interfaces: [nic('i1', '10.0.0.8/24')] })],
        links: [cab('c', 'pc', 'sw', { sourceIface: 'i1', targetIface: 'p1' })] });
      const t = clone(B1); t.links[0].targetIface = 'p5';
      const m = clone(B1); m.links[0].cable = { color: 'blue' };
      const p = plan(m, t, B1);
      const c = item(p, 'links:c');
      ok('F28 three-way: theirs replugged the cable, mine labelled it: both kept', c.status === 'changed' && field(c, 'targetIface').take === 'theirs'
         && apply(m, p).doc.links[0].targetIface === 'p5' && apply(m, p).doc.links[0].cable.color === 'blue');
      const mi = clone(B1), ti = clone(B1);
      mi.nodes[1].interfaces = []; ti.nodes[1].interfaces[0].ip = '10.0.0.9/24';
      const pi = plan(mi, ti, B1);
      const kid = item(pi, 'nodes:pc').children.find((x) => x.theirsId === 'i1');
      ok('F29 an interface mine removed and theirs re-addressed: a conflict, kept with theirs\' address', kid.conflict.type === 'removed-mine-edited-theirs'
         && nodeOf(apply(mi, pi).doc, 'pc').interfaces[0].ip === '10.0.0.9/24' && nodeOf(apply(mi, pi, { [kid.key]: 'remove' }).doc, 'pc').interfaces.length === 0);
      ok('F30 every status the plan uses is one of five', [p, pi].every((x) => x.items.every((i) => TM.MERGE_STATUSES.includes(i.status))));
    }
    {
      // A VM on a host mine knows by MAC: its host is mine's, and it lands beside it.
      const mine = D({ nodes: [dev('S1', 'Hyper', { type: 'server', x: 500, y: 500, interfaces: [nic('i1', '', '02:00:00:00:0f:01')] })] });
      const theirs = D({ nodes: [dev('srv', 'hyper-v', { type: 'server', x: 0, y: 0, interfaces: [nic('e', '', '02:00:00:00:0f:01')] }),
        dev('vm', 'VM', { type: 'vm', host: 'srv', x: 0, y: 100, interfaces: [nic('i1', '')] })] });
      const r = apply(mine, plan(mine, theirs));
      const vm = nodeOf(r.doc, 'vm');
      ok('F31 a VM\'s host follows the device it was matched to, and it is placed beside it', vm.host === 'S1' && Math.abs(vm.x - 500) <= 100 && Math.abs(vm.y - 500) <= 110);
      // A note on a device follows the device.
      const nt = D({ nodes: clone(theirs.nodes), annotations: [{ id: 't1', x: 0, y: 0, text: 'Hot', targets: ['srv'] }] });
      ok('F32 a note\'s targets follow the devices', JSON.stringify(apply(mine, plan(mine, nt)).doc.annotations[0].targets) === '["S1"]');
      // Caps: a network already holding PROVIDER_MAX providers takes no more.
      const full = D({ providers: Array.from({ length: PROVIDER_MAX }, (_, i) => ({ id: 'pv' + i, name: 'P' + i })) });
      const more = D({ providers: [{ id: 'x1', name: 'Extra' }] });
      const pc = plan(full, more);
      ok('F33 what would pass a cap is not added; a note says so', !pc.items.some((i) => i.kind === 'providers' && i.status === 'added')
         && pc.notes.some((n) => n.args.kind === 'providers' && n.args.label === 'Extra') && apply(full, pc).doc.providers.length === PROVIDER_MAX);
    }

    // ---- G. Positions ----
    {
      const mine = D({ nodes: [dev('sw', 'SW', { type: 'switch', x: 1000, y: 500, interfaces: [nic('i1', '', '02:00:00:00:00:51')] }),
        dev('far', 'Far', { x: 0, y: 0, interfaces: [nic('i1', '')] })] });
      const theirs = D({ nodes: [dev('sw', 'SW', { type: 'switch', x: 100, y: 100, interfaces: [nic('i1', '', '02:00:00:00:00:51')] }),
        dev('pc1', 'PC1', { x: 100, y: 300, interfaces: [nic('i1', '')] })], links: [cab('l', 'pc1', 'sw')] });
      const r = apply(mine, plan(mine, theirs));
      const sw = nodeOf(r.doc, 'sw'), pc1 = nodeOf(r.doc, 'pc1');
      ok('G1 a matched device stays where mine has it', sw.x === 1000 && sw.y === 500);
      ok('G2 a single added device goes beside the device it is cabled to, on the grid', Math.abs(pc1.x - 1000) <= 100 && Math.abs(pc1.y - 500) <= 110
         && pc1.x % GRID_SNAP === 0 && pc1.y % GRID_SNAP === 0 && (Math.abs(pc1.x - 1000) >= GM_SIDE.CLEAR_X || Math.abs(pc1.y - 500) >= GM_SIDE.CLEAR_Y), JSON.stringify(pc1));
      // A group of added devices keeps its drawing, shifted onto its anchor.
      const t2 = clone(theirs);
      t2.nodes.push(dev('pc2', 'PC2', { x: 300, y: 300, interfaces: [nic('i1', '')] }));
      t2.links.push(cab('l2', 'pc2', 'pc1'));
      const r2 = apply(mine, plan(mine, t2));
      const a1 = nodeOf(r2.doc, 'pc1'), a2 = nodeOf(r2.doc, 'pc2');
      ok('G3 several added devices keep theirs\' layout, moved by where the anchor is', a2.x - a1.x === 200 && a2.y === a1.y && a1.x === 1000 && a1.y === 700, JSON.stringify([a1, a2]));
      // Clear of everything: a device of mine where the shift would land.
      const busy = clone(mine); busy.nodes.push(dev('busy', 'Busy', { x: 1000, y: 700, interfaces: [nic('i1', '')] }));
      const r3 = apply(busy, plan(busy, t2));
      const placed = r3.doc.nodes.filter((n) => !['pc1', 'pc2'].includes(n.id));
      const clear = ['pc1', 'pc2'].every((id) => { const n = nodeOf(r3.doc, id); return placed.every((o) => Math.abs(o.x - n.x) >= GM_SIDE.CLEAR_X || Math.abs(o.y - n.y) >= GM_SIDE.CLEAR_Y); });
      ok('G4 never on top of a device: stepped right until clear', clear && nodeOf(r3.doc, 'pc1').y === 700 && nodeOf(r3.doc, 'pc1').x > 1000);
      // Group before cable.
      const gm = D({ groups: [{ id: 'rk', name: 'Rack', kind: 'rack' }], nodes: [dev('sw', 'SW', { type: 'switch', x: 1000, y: 500, interfaces: [nic('i1', '', '02:00:00:00:00:51')] }),
        dev('srv', 'Srv', { type: 'server', x: -2000, y: -2000, group: 'rk', interfaces: [nic('i1', '')] })] });
      const gt = D({ groups: [{ id: 'rk', name: 'Rack', kind: 'rack' }], nodes: [dev('sw', 'SW', { type: 'switch', x: 0, y: 0, interfaces: [nic('i1', '', '02:00:00:00:00:51')] }),
        dev('nas', 'NAS', { type: 'nas', x: 0, y: 100, group: 'rk', interfaces: [nic('i1', '')] })], links: [cab('l', 'nas', 'sw')] });
      const rg = apply(gm, plan(gm, gt));
      const nas = nodeOf(rg.doc, 'nas');
      ok('G5 a device in a group mine has devices in goes among them, before its cable (A20)', Math.abs(nas.x + 2000) <= 100 && Math.abs(nas.y + 2000) <= 110, JSON.stringify(nas));
      // Nothing to anchor on: beside the map.
      const lone = D({ nodes: [dev('z', 'Lone', { x: -60, y: 40, interfaces: [nic('i1', '')] })] });
      const rl = apply(mine, plan(mine, lone));
      const z = nodeOf(rl.doc, 'z');
      ok('G6 no anchor: right of the map, top edges level', z.x === 1000 + 160 && z.y === 0, JSON.stringify(z));
      ok('G7 into an empty network: theirs\' own places', (() => { const e = apply(D(), plan(D(), lone)).doc; return e.nodes[0].x === -60 && e.nodes[0].y === 40; })());
    }

    // ---- H. The result ----
    {
      const mine = D({ nodes: [dev('r', 'Router', { type: 'router', interfaces: [nic('i1', '192.168.1.1/24', '02:00:00:00:00:01')] })] });
      const theirs = D({ nodes: [dev('r', 'Router', { type: 'router', interfaces: [nic('i1', '192.168.1.1/24', '02:00:00:00:00:01')] }),
        dev('p', 'Printer', { type: 'printer', interfaces: [nic('i1', '192.168.1.1/24')] })], links: [cab('l', 'p', 'r')] });
      const p1 = plan(mine, theirs), p2 = plan(clone(mine), clone(theirs));
      ok('H1 the plan is deterministic', JSON.stringify(p1) === JSON.stringify(p2));
      const r1 = apply(mine, p1), r2 = apply(clone(mine), p2);
      ok('H2 the result is deterministic', JSON.stringify(r1) === JSON.stringify(r2));
      ok('H3 the result is canonical: a load reads it as itself', JSON.stringify(canonicalDoc(r1.doc)) === JSON.stringify(r1.doc));
      const again = plan(r1.doc, theirs);
      ok('H4 merged again: nothing left to take', again.counts.added === 0 && again.items.every((i) => i.fields.every((f) => f.take !== 'theirs')
         && (i.children || []).every((c) => c.status !== 'added')), JSON.stringify(again.counts));
      const delta = TM.mergeFindingsDelta(mine, r1.doc);
      ok('H5 the findings the result would have: one address now shared', delta.some((d) => d.key === 'ip-conflict' && d.diff > 0), JSON.stringify(delta));
      ok('H6 the open document is untouched', state.nodes === heldNodes && state.links === heldLinks && state.log === heldLog && JSON.stringify(serializeDoc()) === heldOpen);
      let refused = null;
      try { plan(mine, { v: DOC_VERSION + 1, nodes: [] }); } catch (e) { refused = e; }
      ok('H7 a document from a newer Topo is refused', refused instanceof TM.MergeRefused && refused.reason === 'newer');
      refused = null;
      try { plan(mine, { nodes: {} }); } catch (e) { refused = e; }
      ok('H8 something that is no document is refused', refused instanceof TM.MergeRefused && refused.reason === 'shape');
      ok('H9 mintMergeId: the smallest free, prefix kept', TM.mintMergeId('n_1', new Set(['n_1m1', 'n_1m2'])) === 'n_1m3' && TM.mintMergeId('i1', new Set()) === 'i1m1');
      ok('H10 a v16 file merges (migrated)', (() => { const t = clone(theirs); t.v = 16; return plan(mine, t).counts.added === 2; })());
      // Identity is not content.
      const idt = Object.assign(clone(theirs), { id: 'abc', updated: 5, rev: 'R1', base: 'R0', prior: ['Rz'] });
      ok('H11 identity is not compared; the revs are read', JSON.stringify(plan(mine, idt).items) === JSON.stringify(p1.items) && plan(mine, idt).theirsRev === 'R1');
      // A 300-device budget.
      const big = (n, off) => {
        const nodes = [], links = [];
        for (let i = 0; i < n; i++) {
          nodes.push(dev('n' + i, 'Dev ' + i, { x: (i % 20) * 120, y: Math.floor(i / 20) * 120,
            interfaces: [nic('i1', `10.${Math.floor(i / 250)}.${i % 250}.${off}/16`, '02:00:00:' + [i >> 8, i & 255, off].map((v) => v.toString(16).padStart(2, '0')).join(':'))] }));
          if (i) links.push(cab('l' + i, 'n' + i, 'n' + Math.floor(i / 2)));
        }
        return D({ nodes, links });
      };
      const bm = big(300, 1), bt = big(300, 1);
      bt.nodes.forEach((n, i) => { if (i % 3 === 0) n.notes = 'checked'; });
      for (let i = 300; i < 340; i++) bt.nodes.push(dev('t' + i, 'New ' + i, { interfaces: [nic('i1', '')] }));
      const t0 = performance.now();
      const bp = plan(bm, bt);
      const br = apply(bm, bp);
      const ms = performance.now() - t0;
      ok('H12 300 devices plan and apply within budget', ms < 6000 && br.doc.nodes.length === 340 && br.counts.changed === 100, `${Math.round(ms)} ms ${JSON.stringify(br.counts)}`);
    }

    // ---- I. The network log ----
    {
      const e = (id, at, extra = {}) => Object.assign({ id, at, kind: 'merge', source: 'x.json', counts: { added: 1, changed: 0, removed: 0, conflicts: 0 }, mode: 'two-way' }, extra);
      const u = TM.unionLogs([e('a', 1), e('b', 2, { prev: 'f'.repeat(64) })], [e('b', 2), e('c', 3, { prev: 'e'.repeat(64) }), e('a', 1)]);
      ok('I1 logs unioned by id: mine in order, then theirs\' new ones, their prev dropped', u.map((x) => x.id).join() === 'a,b,c' && u[1].prev === 'f'.repeat(64) && !u[2].prev);
      const many = []; for (let i = 0; i < 600; i++) many.push(e('m' + i, i + 1));
      ok('I2 the newest LOG_MAX kept', TM.unionLogs(many, [e('z', 9999)]).length === LOG_MAX && TM.unionLogs(many, [e('z', 9999)]).pop().id === 'z');
      const entry = TM.mergeLogEntry({ id: 'lg_1', at: 1700000000000, source: 'closet.json', by: 'Ana', counts: { added: 2, changed: 1, removed: 0, conflicts: 3 }, mode: 'three-way', rev: 'R5' });
      ok('I3 the merge\'s entry, normalized, its summary in English', entry.kind === 'merge' && entry.by === 'Ana' && entry.rev === 'R5' && entry.mode === 'three-way'
         && entry.summary === 'Merged closet.json: 2 added, 1 changed, 0 removed, 3 conflicts.');
      const held = TM.setDigest(fakeDigest);
      const d1 = await TM.appendLogEntry({ nodes: [], log: [e('a', 1), e('b', 2)] }, entry);
      ok('I4 appended last and chained: each prev the digest of the entry before', d1.log.map((x) => x.id).join() === 'a,b,lg_1' && !d1.log[0].prev
         && d1.log[1].prev === await fakeDigest(JSON.stringify(sortedKeys(d1.log[0]))) && d1.log[2].prev === await fakeDigest(JSON.stringify(sortedKeys(d1.log[1]))));
      ok('I5 an untouched log verifies', await TM.verifyLog(d1.log) === -1);
      const tampered = clone(d1.log); tampered[1].source = 'other.json';
      ok('I6 an entry edited by hand shows (the one after it)', await TM.verifyLog(tampered) === 2);
      ok('I7 the first entry present starts the chain (A21)', await TM.verifyLog(d1.log.slice(1)) === -1);
      const again = await TM.appendLogEntry(d1, TM.mergeLogEntry({ id: 'lg_2', at: 1700000000001, source: 'link', counts: {}, mode: 'two-way' }));
      ok('I8 a second entry keeps the first ones\' prev', again.log[1].prev === d1.log[1].prev && again.log[3].prev === await fakeDigest(JSON.stringify(sortedKeys(again.log[2]))));
      TM.setDigest(async () => null);
      const nod = await TM.appendLogEntry({ nodes: [] }, entry);
      ok('I9 no Web Crypto: the entry goes without prev', nod.log.length === 1 && !nod.log[0].prev);
      TM.setDigest(held);
      const mine = D({ nodes: [], log: [e('a', 1)] }), theirs = D({ nodes: [], log: [e('a', 1), e('t', 5)] });
      const r = apply(mine, plan(mine, theirs));
      ok('I10 the result carries both logs; the log is never an item', r.doc.log.map((x) => x.id).join() === 'a,t' && !plan(mine, theirs).items.some((i) => i.kind === 'log'));
    }

    // ---- J. Review fixes (2026-11-09) ----
    {
      // J1-J4: a record the other side removed while this side pointed at it
      // (a custom value, a group, a provider, a Wi-Fi network) is an edit.
      const run = (m, t, b, c) => { const p = plan(m, t, b); return { p, r: apply(m, p, c) }; };
      {
        const base = D({ columns: [{ id: 'c1', name: 'Owner' }], nodes: [dev('a', 'A')] });
        const theirs = D({ nodes: [dev('a', 'A')] });
        const mine = D({ columns: [{ id: 'c1', name: 'Owner' }], nodes: [dev('a', 'A', { extra: { c1: 'Ana' } }), dev('n', 'N', { extra: { c1: 'Bob' } })] });
        const { p, r } = run(mine, theirs, base);
        const it = item(p, 'columns:c1');
        ok('J1 a column theirs removed while mine filled it: a conflict, kept by default', it && it.status === 'conflict' && it.conflict.type === 'removed-theirs-edited-mine'
           && r.doc.columns.length === 1 && nodeOf(r.doc, 'a').extra.c1 === 'Ana' && nodeOf(r.doc, 'n').extra.c1 === 'Bob', JSON.stringify(p.items.map((i) => i.key + ' ' + i.status)));
        const gone = apply(mine, p, { 'columns:c1': 'remove' });
        ok('J1b and removed when chosen', !(gone.doc.columns || []).length);
        const m2 = D({ nodes: [dev('a', 'A')] });
        const t2 = D({ columns: [{ id: 'c1', name: 'Owner' }], nodes: [dev('a', 'A', { extra: { c1: 'Ana' } })] });
        const j2 = run(m2, t2, base);
        ok('J2 the mirror: mine removed the column, theirs filled it: kept, the value with it', statusOf(j2.p, 'columns:c1') === 'conflict'
           && (j2.r.doc.columns || []).length === 1 && (nodeOf(j2.r.doc, 'a').extra || {}).c1 === 'Ana', JSON.stringify(j2.r.doc.nodes));
      }
      {
        const base = D({ groups: [{ id: 'g1', name: 'Lab', kind: 'room' }], nodes: [dev('a', 'A')] });
        const theirs = D({ nodes: [dev('a', 'A')] });
        const mine = D({ groups: [{ id: 'g1', name: 'Lab', kind: 'room' }], nodes: [dev('a', 'A'), dev('n', 'N', { group: 'g1' })] });
        const { p, r } = run(mine, theirs, base);
        ok('J3 a group theirs removed while mine put a device in it: a conflict, the device stays in it', statusOf(p, 'groups:g1') === 'conflict'
           && nodeOf(r.doc, 'n').group === 'g1' && p.counts.conflicts === 1);
      }
      {
        const base = D({ providers: [{ id: 'p1', name: 'FiberCo' }], wifi: [{ id: 'w1', ssid: 'Office' }],
          nodes: [dev('a', 'Modem', { type: 'router' }), dev('b', 'Lap', { type: 'laptop' })] });
        const theirs = D({ nodes: [dev('a', 'Modem', { type: 'router' }), dev('b', 'Lap', { type: 'laptop' })] });
        const mine = D({ providers: [{ id: 'p1', name: 'FiberCo' }], wifi: [{ id: 'w1', ssid: 'Office' }],
          nodes: [dev('a', 'Modem', { type: 'router', provider: 'p1' }), dev('b', 'Lap', { type: 'laptop' })],
          links: [cab('wl', 'b', 'a', { medium: 'wireless', wifi: { ssid: 'w1' } })] });
        const { p, r } = run(mine, theirs, base);
        ok('J4 a provider and a Wi-Fi network theirs removed while mine used them: conflicts, kept', statusOf(p, 'providers:p1') === 'conflict' && statusOf(p, 'wifi:w1') === 'conflict'
           && nodeOf(r.doc, 'a').provider === 'p1' && r.doc.links[0].wifi && r.doc.links[0].wifi.ssid === 'w1', JSON.stringify(p.items.map((i) => i.key + ' ' + i.status)));
        const quiet = D({ providers: [{ id: 'p1', name: 'FiberCo' }], wifi: [{ id: 'w1', ssid: 'Office' }], nodes: clone(base.nodes) });
        const q = plan(quiet, theirs, base);
        ok('J4b untouched and unused on mine: still simply removed', statusOf(q, 'providers:p1') === 'removed' && statusOf(q, 'wifi:w1') === 'removed');
      }
      // J5-J7: a unique range or name that taking theirs would make twice.
      {
        const base = D({ networks: [{ id: 'na', cidr: '10.0.1.0/24' }] });
        const theirs = D({ networks: [{ id: 'na', cidr: '10.0.2.0/24' }] });
        const mine = D({ networks: [{ id: 'na', cidr: '10.0.1.0/24' }, { id: 'nb', cidr: '10.0.2.0/24', name: 'Cameras' }] });
        const { p, r } = run(mine, theirs, base);
        const f = field(item(p, 'networks:na'), 'cidr');
        ok('J5 a re-addressed subnet meeting one mine added: a conflict defaulting to mine, nothing dropped', f && f.conflict && f.take === 'mine' && f.collides
           && r.doc.networks.length === 2 && r.counts.removed === 0, JSON.stringify([r.doc.networks, r.counts]));
        const forced = apply(mine, p, { 'networks:na#cidr': 'theirs' });
        ok('J5b theirs chosen anyway: yours stays, a note says why', forced.doc.networks.length === 2 && forced.doc.networks.find((n) => n.id === 'na').cidr === '10.0.1.0/24'
           && forced.notes.some((n) => n.key === 'Kept yours: another one already has that name or range.'));
      }
      {
        const base = D({ searches: [{ id: 'sq_a', name: 'Old', query: 'type:pc' }] });
        const theirs = D({ searches: [{ id: 'sq_a', name: 'Printers', query: 'type:pc' }] });
        const mine = D({ searches: [{ id: 'sq_a', name: 'Old', query: 'type:pc' }, { id: 'sq_b', name: 'Printers', query: 'type:printer' }] });
        const { p, r } = run(mine, theirs, base);
        ok('J6 a search renamed to the name of one mine added: a conflict, both kept', statusOf(p, 'searches:sq_a') === 'conflict' && r.doc.searches.length === 2);
      }
      {
        const base = D({ columns: [{ id: 'c1', name: 'Old' }], nodes: [dev('a', 'A')] });
        const theirs = D({ columns: [{ id: 'c1', name: 'Owner' }], nodes: [dev('a', 'A')] });
        const mine = D({ columns: [{ id: 'c1', name: 'Old' }, { id: 'c2', name: 'Owner' }], nodes: [dev('a', 'A', { extra: { c2: 'Ana' } })] });
        const { p, r } = run(mine, theirs, base);
        ok('J7 a column renamed to the name of one mine added: a conflict, mine\'s column and value kept', statusOf(p, 'columns:c1') === 'conflict'
           && r.doc.columns.length === 2 && nodeOf(r.doc, 'a').extra.c2 === 'Ana');
        // Added on theirs with a range one of mine took since: not added, a note.
        const b3 = D({ networks: [{ id: 'na', cidr: '10.0.1.0/24' }] });
        const t3 = D({ networks: [{ id: 'na', cidr: '10.0.1.0/24' }, { id: 'nz', cidr: '10.0.9.0/24', name: 'New' }] });
        const m3 = D({ networks: [{ id: 'na', cidr: '10.0.9.0/24' }] });
        const p3 = plan(m3, t3, b3);
        const r3 = apply(m3, p3);
        ok('J7b the counts of the result match the plan\'s (no record dropped unseen)', r3.counts.added === p3.counts.added && r3.counts.removed === p3.counts.removed,
          JSON.stringify([p3.counts, r3.counts, p3.notes]));
      }
      // J8: cables follow a device kept against the other side's removal.
      {
        const base = D({ nodes: [dev('sw', 'SW', { type: 'switch' }), dev('d', 'D')], links: [cab('l1', 'sw', 'd')] });
        const theirs = D({ nodes: [dev('sw', 'SW', { type: 'switch' })] });
        const mine = D({ nodes: [dev('sw', 'SW', { type: 'switch' }), dev('d', 'D', { notes: 'x' })], links: [cab('l1', 'sw', 'd')] });
        const p = plan(mine, theirs, base);
        const r = apply(mine, p);
        ok('J8 a device kept against their removal keeps its cables', !!nodeOf(r.doc, 'd') && r.doc.links.length === 1 && statusOf(p, 'links:l1') === 'unchanged');
        const rm = apply(mine, p, { 'nodes:d': 'remove' });
        ok('J8b removed when chosen: its cables go with it', !nodeOf(rm.doc, 'd') && !(rm.doc.links || []).length);
        const t2 = D({ nodes: [dev('sw', 'SW', { type: 'switch' }), dev('d', 'D', { notes: 'y' })], links: [cab('l1', 'sw', 'd')] });
        const m2 = D({ nodes: [dev('sw', 'SW', { type: 'switch' })] });
        const r2 = apply(m2, plan(m2, t2, base));
        ok('J8c the mirror: theirs kept against my removal comes back with its cable', !!nodeOf(r2.doc, 'd') && (r2.doc.links || []).length === 1);
      }
      // J9: an interface theirs removed that mine plugged a new cable into.
      {
        const sw = (ifs) => dev('sw', 'SW', { type: 'switch', interfaces: ifs });
        const e1 = nic('e1', ''), e2 = Object.assign(nic('e2', '10.0.1.1/24'), { name: 'eth1' });
        const pc = () => dev('pc', 'PC', { interfaces: [nic('p1', '')] });
        const base = D({ nodes: [sw([e1, e2]), pc()] });
        const theirs = D({ nodes: [sw([clone(e1)]), pc()] });
        const mine = D({ nodes: [sw([clone(e1), clone(e2)]), pc()], links: [cab('lnew', 'sw', 'pc', { sourceIface: 'e2', targetIface: 'p1' })] });
        const p = plan(mine, theirs, base);
        const r = apply(mine, p);
        const kid = (item(p, 'nodes:sw').children || []).find((c) => c.key === 'ifaces:sw/e2');
        ok('J9 an interface removed by theirs that mine cabled: a conflict, kept with its cable', kid && kid.status === 'conflict'
           && nodeOf(r.doc, 'sw').interfaces.some((i) => i.id === 'e2') && r.doc.links[0].sourceIface === 'e2');
      }
      // J10: the same device of mine chosen for two of theirs.
      {
        const mine = D({ nodes: [dev('m1', 'Cam'), dev('m2', 'Cam')] });
        const theirs = D({ nodes: [dev('t1', 'Cam', { notes: 'one' }), dev('t2', 'Cam', { notes: 'two' })] });
        const r = apply(mine, plan(mine, theirs), { 'nodes:t1': 'm1', 'nodes:t2': 'm1' });
        ok('J10 one of mine chosen twice: the second is skipped with a note, never added', r.doc.nodes.length === 2
           && r.notes.some((n) => n.key === 'Skipped: the one of yours chosen for it was chosen for another too.'), JSON.stringify([r.doc.nodes.map((n) => n.id), r.notes]));
      }
      // J11: two-way ids that repeat across unrelated documents.
      {
        const mine = D({ providers: [{ id: 'pv_isp', name: 'FiberCo', service: 'internet' }], wifi: [{ id: 'w1', ssid: 'Office' }],
          groups: [{ id: 'g1', name: 'HQ', kind: 'building' }] });
        const theirs = D({ providers: [{ id: 'pv_isp', name: 'CableNet', service: 'internet' }], wifi: [{ id: 'w1', ssid: 'Guest' }],
          groups: [{ id: 'g1', name: 'Clinic', kind: 'floor' }, { id: 'g2', name: 'Room', kind: 'room', parent: 'g1' }],
          nodes: [dev('mo', 'Modem', { type: 'router', provider: 'pv_isp', group: 'g2' })] });
        const p = plan(mine, theirs);
        const r = apply(mine, p);
        const room = r.doc.groups.find((g) => g.name === 'Room');
        ok('J11 two-way: a provider or SSID of another name, a group of another kind, under the same id is another one', r.doc.providers.length === 2 && r.doc.wifi.length === 2
           && r.doc.groups.length === 3 && nodeOf(r.doc, 'mo').provider !== 'pv_isp' && room && room.parent !== 'g1', JSON.stringify([r.doc.providers, r.doc.groups]));
        const ren = D({ groups: [{ id: 'g1', name: 'Head office', kind: 'building' }] });
        ok('J11b a group renamed in place (same kind, same parent) is still the same group', item(plan(mine, ren), 'groups:g1').status === 'conflict');
      }
      // K1 (D32): two-way, a field blank in theirs keeps mine without a conflict.
      {
        const mine = D({ nodes: [dev('a', 'Alpha', { interfaces: [nic('i1', '10.0.0.1/24', 'aa:00:00:00:00:01')], notes: 'rack 2', serial: 'S1' })],
          report: { site: 'Casa Roma', client: 'Acme' } });
        const theirs = D({ nodes: [dev('t', 'Alpha', { interfaces: [nic('j1', '10.0.0.1/24', 'aa:00:00:00:00:01')], vendor: 'Dell' })] });
        const p = plan(mine, theirs);
        const a = item(p, 'nodes:a');
        ok('K1 two-way: blanks in theirs are no conflict, a blank of mine still fills', a && a.status === 'changed' && !field(a, 'notes') && !field(a, 'serial')
           && field(a, 'vendor').take === 'theirs' && p.counts.conflicts === 0, JSON.stringify([a && a.fields, p.counts]));
        const r = apply(mine, p);
        ok('K1b the result keeps mine where theirs was blank (report header too)', nodeOf(r.doc, 'a').notes === 'rack 2' && nodeOf(r.doc, 'a').serial === 'S1'
           && r.doc.report && r.doc.report.site === 'Casa Roma' && r.doc.report.client === 'Acme', JSON.stringify([nodeOf(r.doc, 'a'), r.doc.report]));
        const differ = D({ nodes: [dev('t', 'Alpha', { interfaces: [nic('j1', '10.0.0.1/24', 'aa:00:00:00:00:01')], notes: 'rack 3' })] });
        ok('K1c two different filled values are still a conflict defaulting to mine', field(item(plan(mine, differ), 'nodes:a'), 'notes').conflict === true);
      }
      // K2 (D33): two-way, an interface with no name, address or MAC is the next free one of mine.
      {
        const mine = D({ nodes: [dev('sw', 'SW-Core', { type: 'switch', interfaces: [nic('i1', '10.0.0.2/24'), Object.assign(nic('i2', ''), { name: 'eth1' })] }),
          dev('pc', 'PC-Ana', { interfaces: [nic('p1', '10.0.0.10/24', 'aa:00:00:00:00:10')] })],
          links: [cab('l1', 'sw', 'pc', { sourceIface: 'i1', targetIface: 'p1' })] });
        const theirs = D({ nodes: [dev('s2', 'SW-Core', { type: 'switch', interfaces: [nic('x1', '10.0.0.2/24'), { id: 'x2', name: '', ip: '' }] }),
          dev('pr', 'Printer', { type: 'printer', interfaces: [nic('q1', '10.0.0.20/24')] })],
          links: [cab('m1', 's2', 'pr', { sourceIface: 'x2', targetIface: 'q1' })] });
        const p = plan(mine, theirs);
        const r = apply(mine, p);
        const sw = nodeOf(r.doc, 'sw'), pr = nodeNamed(r.doc, 'Printer');
        const toPr = pr && r.doc.links.find((l) => l.source === 'sw' && l.target === pr.id);
        ok('K2 two-way: a blank interface of theirs is the free one of mine, not an extra one', sw.interfaces.length === 2 && toPr && toPr.sourceIface === 'i2'
           && sw.interfaces.find((i) => i.id === 'i2').name === 'eth1', JSON.stringify([sw.interfaces, r.doc.links]));
        const full = D({ nodes: [dev('sw', 'SW-Core', { type: 'switch', interfaces: [nic('i1', '10.0.0.2/24')] }), dev('pc', 'PC-Ana', { interfaces: [nic('p1', '10.0.0.10/24')] })],
          links: [cab('l1', 'sw', 'pc', { sourceIface: 'i1', targetIface: 'p1' })] });
        const r2 = apply(full, plan(full, theirs));
        ok('K2b with no free interface of mine (all cabled), the blank one is added', nodeOf(r2.doc, 'sw').interfaces.length === 2, JSON.stringify(nodeOf(r2.doc, 'sw').interfaces));
      }
    }
  } catch (err) {
    ok('the suite ran to the end', false, err && (err.stack || err.message));
  }
  function sortedKeys(v) {
    if (Array.isArray(v)) return v.map(sortedKeys);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { if (v[k] !== undefined) o[k] = sortedKeys(v[k]); }); return o; }
    return v;
  }
  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 0); });
