// Minting ids and keeping them unique (js/model.js nextId, randomToken and
// keepIdsUnique), which replaced a copy of the random token in the library and
// the history entries, the de-dup loop in loadDocState, normalizeNetworks,
// normalizeWifi and normalizeGroups, and the two Math.random minters for an
// id-less device and note. What is held here:
//   1. the helpers themselves: two ids in one tick differ, a token is base 36
//      and does not repeat, the first holder of an id keeps it and a later
//      one is reminted, even one holding an id just minted;
//   2. each former call site still answering as it did: a repeated Wi-Fi
//      network, group, subnet (a repeated CIDR under a fresh id is dropped
//      and reserves nothing), device and cable, the ids an id-less device or
//      note is given, and a clean document's ids kept through a round trip;
//   3. the two lists that were never de-duplicated: two notes under one id,
//      where deleting the second deleted both, and two interfaces under one id
//      on a device, where deleting one deleted both and its cable with it.
window.addEventListener('load', () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);
  const ids = (xs) => xs.map((x) => x.id).join(' ');
  const pc = (id, extra) => Object.assign({ id, type: 'pc', name: id.toUpperCase(), x: 0, y: 0,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra || {});

  try {
    // ---- 1: the helpers ----
    const a = nextId('x'), b = nextId('x');
    ok('nextId twice in one tick gives two ids', a !== b, `${a} ${b}`);
    ok('both in the prefix_base36 form', /^x_[0-9a-z]{9,}$/.test(a) && /^x_[0-9a-z]{9,}$/.test(b), `${a} ${b}`);
    const tokens = Array.from({ length: 1000 }, randomToken);
    ok('randomToken is base 36', tokens.every((s) => /^[0-9a-z]+$/.test(s)), tokens[0]);
    ok('and 1000 of them are all different', new Set(tokens).size === 1000);
    ok('mintLibraryId keeps its n + time + token form', /^n[0-9a-z]+$/.test(mintLibraryId()), mintLibraryId());
    ok('and a history entry id is a token', /^[0-9a-z]+$/.test(newEid()));

    const items = [{ id: 'a' }, { id: 'a' }, { id: 'b' }, { id: 'a' }];
    const back = keepIdsUnique(items, 'q');
    ok('keepIdsUnique returns the same array', back === items);
    ok('the first holder keeps the id', items[0].id === 'a' && items[2].id === 'b', ids(items));
    ok('each later holder gets an id of its own',
       /^q_/.test(items[1].id) && /^q_/.test(items[3].id) && items[1].id !== items[3].id, ids(items));
    // nextId is a const and cannot be stood in for, so the clash is built:
    // the id the repeat is about to be given is worked out from the clock and
    // the counter and placed on a record after it. A tick can pass between
    // the guess and the walk, so it is tried until the guess was right.
    let landed = false, clash = [];
    for (let i = 0; i < 20 && !landed; i++) {
      const next = `q_${Date.now().toString(36)}${idSeq.toString(36)}`;
      clash = [{ id: 'z' }, { id: 'z' }, { id: next }];
      keepIdsUnique(clash, 'q');
      landed = clash[1].id === next;
    }
    ok('the minted id was the one guessed', landed, ids(clash));
    ok('a later item holding a just-minted id is reminted too',
       new Set(clash.map((x) => x.id)).size === 3 && clash[0].id === 'z' && /^q_/.test(clash[2].id), ids(clash));
    const repeat = nextId('q');
    const twice = [{ id: 'z' }, { id: repeat }, { id: 'z' }, { id: repeat }];
    keepIdsUnique(twice, 'q');
    ok('an id minted earlier is kept by its first holder only',
       new Set(twice.map((x) => x.id)).size === 4 && twice[1].id === repeat, ids(twice));
    ok('an empty list is fine', keepIdsUnique([], 'q').length === 0);

    // ---- 2: the former call sites ----
    const wf = normalizeWifi([{ id: 'w1', ssid: 'A' }, { id: 'w1', ssid: 'B' }]);
    ok('normalizeWifi: the first keeps w1, the second is reminted',
       wf[0].id === 'w1' && /^wf_/.test(wf[1].id) && wf[1].ssid === 'B', ids(wf));
    const gs = normalizeGroups([{ id: 'g1', name: 'A' }, { id: 'g1', name: 'B', parent: 'g1' }]);
    ok('normalizeGroups: the first keeps g1, the second is reminted',
       gs[0].id === 'g1' && /^g_/.test(gs[1].id), ids(gs));
    ok('and the parents are repaired after, against the ids as they now are', gs[1].parent === 'g1', String(gs[1].parent));
    const nets = normalizeNetworks([
      { id: 'net1', cidr: '10.0.0.0/24' }, { id: 'net1', cidr: '10.0.1.0/24' },
      { id: 'fresh', cidr: '10.0.0.0/24' }, { id: 'fresh', cidr: '10.0.2.0/24' }]);
    ok('normalizeNetworks: a repeated CIDR is dropped', nets.length === 3, nets.map((n) => n.cidr).join(' '));
    ok('a repeated id is reminted', nets[0].id === 'net1' && /^net_/.test(nets[1].id), ids(nets));
    ok('and the dropped record never reserved its id', nets[2].id === 'fresh' && nets[2].cidr === '10.0.2.0/24', ids(nets));

    replaceDocument({ v: DOC_VERSION, nodes: [pc('n1', { name: 'First' }), pc('n1', { name: 'Second' }), pc('n2')],
      links: [{ id: 'l1', source: 'n1', target: 'n2' }, { id: 'l1', source: 'n2', target: 'n1' }] }, { origin: 'file' });
    ok('loadDocState: the first device keeps n1', state.nodes[0].id === 'n1' && state.nodes[0].name === 'First', ids(state.nodes));
    ok('the second has an id of its own', /^n_/.test(state.nodes[1].id), ids(state.nodes));
    ok('the first cable keeps l1, the second is reminted', state.links.length === 2 && state.links[0].id === 'l1' && /^l_/.test(state.links[1].id), ids(state.links));
    ok('the cables naming n1 stay with the first device',
       state.links.every((l) => (l.source === 'n1' || l.target === 'n1') && l.source !== state.nodes[1].id && l.target !== state.nodes[1].id));

    const bare = Array.from({ length: 50 }, (_, i) => ({ type: 'pc', name: `P${i}`, x: 0, y: 0 }));
    const notes = Array.from({ length: 50 }, (_, i) => ({ x: 0, y: 0, text: `N${i}` }));
    replaceDocument({ v: DOC_VERSION, nodes: bare, links: [], annotations: notes }, { origin: 'file' });
    ok('an id-less device is given an n_ id, unique across 50',
       state.nodes.every((n) => /^n_[0-9a-z]+$/.test(n.id)) && new Set(state.nodes.map((n) => n.id)).size === 50, state.nodes[0].id);
    ok('an id-less note a t_ id, unique across 50',
       state.annotations.every((n) => /^t_[0-9a-z]+$/.test(n.id)) && new Set(state.annotations.map((n) => n.id)).size === 50, state.annotations[0].id);

    const clean = { v: DOC_VERSION, nodes: [pc('a'), pc('b')], links: [{ id: 'l1', source: 'a', target: 'b' }],
      annotations: [{ id: 't1', x: 1, y: 2, text: 'Hi' }], networks: [{ id: 'net1', cidr: '10.0.0.0/24' }],
      groups: [{ id: 'g1', name: 'Rack' }] };
    replaceDocument(clean, { origin: 'file' });
    const first = JSON.stringify(serializeDoc());
    replaceDocument(JSON.parse(first), { origin: 'file' });
    ok('a clean document keeps its ids through a round trip', JSON.stringify(serializeDoc()) === first);
    ok('the ids as written', ids(state.nodes) === 'a b' && ids(state.links) === 'l1' && ids(state.annotations) === 't1'
       && ids(state.networks) === 'net1' && ids(state.groups) === 'g1');

    // ---- 3: the drift fixes ----
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [],
      annotations: [{ id: 't1', x: 0, y: 0, text: 'A' }, { id: 't1', x: 50, y: 50, text: 'B' }] }, { origin: 'file' });
    ok('two notes under one id are two ids after load', state.annotations.length === 2
       && state.annotations[0].id === 't1' && state.annotations[1].id !== 't1', ids(state.annotations));
    select(state.annotations[1].id, 'annotation');
    deleteSelected();
    ok('deleting the second leaves the first', state.annotations.length === 1 && state.annotations[0].text === 'A',
       state.annotations.map((n) => n.text).join(' '));

    replaceDocument({ v: DOC_VERSION, nodes: [
        pc('h', { interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i1', name: 'eth1', ip: '' }] }), pc('s')],
      links: [{ id: 'c1', source: 'h', target: 's', sourceIface: 'i1', targetIface: 'i1' }] }, { origin: 'file' });
    const h = getNode('h');
    ok('two interfaces under one id are two ids after load', h.interfaces[0].id === 'i1' && h.interfaces[1].id !== 'i1'
       && /^i_/.test(h.interfaces[1].id), ids(h.interfaces));
    const link = state.links[0];
    ok('the cable bound to i1 is on eth0', link.sourceIface === 'i1');
    deleteIface(h, h.interfaces.find((i) => i.name === 'eth1').id);
    ok('deleting eth1 keeps eth0', h.interfaces.length === 1 && h.interfaces[0].name === 'eth0', h.interfaces.map((i) => i.name).join(' '));
    ok('and its cable', state.links.length === 1 && state.links[0].sourceIface === 'i1');
    // Reminting fires only on a repeat: a node read again keeps its ids.
    const again = normalizeLoadedNode(serializeNode(h));
    ok('a node read again keeps its interface ids', ids(again.interfaces) === ids(h.interfaces));
    select(null, null);
  } catch (e) {
    ok('suite ran without throwing', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e));
  }

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
