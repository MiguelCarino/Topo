// Address history, stage 3: was: and has:history in the search language
// (docs/BACKLOG.md feature 5; js/query.js qWasPrep, qWasNode, qHasHistory,
// queryTrailNote; js/trail.js historyWasQuery). Asserted here:
//   1. the words: was: and has:history understood (no "not understood"),
//      both marked browser-local (def.local, q.local), a CIDR that is no
//      network refused;
//   2. a network not kept here, and a read-only one: was: and has:history
//      understood and matching nothing, the line under the box saying no
//      history is kept;
//   3. was: on a kept network with two points: an address finds the device
//      that had it and not the one that has it now; a network; a MAC with
//      any separators; a past group path; a past switch port by its name at
//      the time; a past name; a value held now is no match; a switch renamed
//      is no move; an address moved to another NIC is still held; negated;
//      the map lighting only the matches;
//   4. has:history (and -has:history) by any past value;
//   5. a removed device that held the value named under the box with its
//      date, more than three counted, nothing said for a plain search;
//   6. the saved-search refusal, for real now that the build understands
//      the words: queryLocalTerms by the words and by the parsed term (an
//      alias), querySavedMatches matching nothing, searchProblem refusing,
//      reportSearches printing no rows and the report's "Not printed" line;
//   7. the History section's past values as buttons putting was: in the box
//      (an address without its prefix, a MAC, a port quoted);
//   8. the strings in es, pt-BR, ja (no コンピューター) and ru, and the
//      box's tooltip naming was: in every locale;
//   9. hex-like past names and groups ('DC-01', 'A-1') found as text, also
//      through their History buttons; a MAC with no separators; the start of
//      an IPv6 address; an address whose prefix changed still held; a name
//      past the recorder's cut; a dual-homed server whose switch rename
//      swaps uplinkOf's choice; the removed-holder line per term and with
//      other words; a forget redrawing the matches and the count.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const T = window.CarinoTrail;
  const L = window.CarinoLibrary;
  const { LIBRARY_KEY, BINDER_EXPORT_KEY } = L;
  const held = [LIBRARY_KEY, BINDER_EXPORT_KEY, T.HISTORY_OPEN_KEY].map((k) => [k, localStorage.getItem(k)]);
  const heldLib = L.loadLibrary();
  const day = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  const D1 = day(2026, 3, 2), D2 = day(2026, 9, 14);
  // The devices a search finds, as the map would (one lookup pass).
  const matches = (text) => {
    const q = parseQuery(text);
    if (q.errors.length) return ['ERR:' + q.errors.join(' ')];
    return withLookupPass(() => state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id)).sort();
  };
  const note = () => (el('queryNote').classList.contains('hidden') ? '' : el('queryNote').textContent);
  let id = null;

  const site = () => ({
    v: DOC_VERSION,
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 }, interfaces: [] },
      { id: 'pc', type: 'pc', name: 'PC-1', x: 100, y: 200, group: 'r3',
        interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24', mac: 'aa-bb-cc-00-11-22' }, { id: 'i2', name: 'wlan0', ip: '' }] },
      { id: 'cam', type: 'camera', name: 'CAM-03', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.77/24' }] },
      { id: 'prn', type: 'printer', name: 'Printer', x: 300, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.90/24' }] },
      { id: 'nas', type: 'server', name: 'NAS', x: 400, y: 200, interfaces: [{ id: 'n1', name: 'eth0', ip: '192.168.1.50/24' }, { id: 'n2', name: 'eth1', ip: '' }] }
    ],
    links: [
      { id: 'up', source: 'rt', target: 'sw', sourceIface: 'e0', targetIface: 'p24' },
      { id: 'a', source: 'sw', target: 'pc', sourceIface: 'p12', targetIface: 'i1' },
      { id: 'b', source: 'sw', target: 'cam', sourceIface: 'p5', targetIface: 'i1' }
    ],
    groups: [{ id: 'b1', name: 'Building A', kind: 'building' }, { id: 'r3', name: 'Rack 3', kind: 'rack', parent: 'b1' },
      { id: 'r4', name: 'Rack 4', kind: 'rack', parent: 'b1' }],
    networks: [{ id: 'lan', cidr: '192.168.1.0/24', name: 'LAN' }]
  });
  const record = (kind, at) => T.recordPoint(id, kind, serializeDoc(), at);

  try {
    setLocale('en');
    persistLibrary({});
    replaceDocument(site(), { origin: 'file' });
    setView('map');

    // ---- 1. The words ----
    const pw = parseQuery('was:192.168.1.20'), ph = parseQuery('has:history');
    ok('was: is understood', pw.errors.length === 0 && pw.terms.length === 1, show(pw.errors));
    ok('has:history is understood', ph.errors.length === 0 && ph.terms.length === 1, show(ph.errors));
    ok('was: is marked browser-local on its prefix', pw.terms[0].def.local === true && pw.terms[0].q.local === true);
    ok('has:history is marked browser-local, has:finding is not', ph.terms[0].q.local === true && !parseQuery('has:finding').terms[0].q.local);
    ok('was: with a network that is none is not understood', parseQuery('was:10.0.0.0/33').errors.length === 1);
    ok('was: with text, a MAC, a network: all understood', ['was:"rack 3"', 'was:aa-bb-cc', 'was:10.0.0.0/24', 'was:10.0.'].every((w) => !parseQuery(w).errors.length));

    // ---- 2. No history kept here ----
    ok('a network not kept: was: matches nothing, and no error', show(matches('was:192.168.1.20')) === '[]' && show(matches('has:history')) === '[]');
    setQuery('was:192.168.1.20');
    ok('the line under the box says no history is kept', note() === 'No history is kept for this network.', note());
    ok('and the box shows no "not understood"', el('queryError').classList.contains('hidden'));
    setQuery('has:history');
    ok('has:history says so too', note() === 'No history is kept for this network.', note());
    setQuery('-was:10.0.0.9');
    ok('not for a negated was: alone', note() === '', note());
    setQuery('type:pc');
    ok('nor for a search with no history term', note() === '' && el('queryNote').classList.contains('hidden'));
    setQuery('');

    // ---- 3. was: on a kept network ----
    id = L.claimDocument('Clínica', null);
    ok('kept, a first point recorded', !!id && record('backup', D1));
    ok('a kept network with one point: no past value yet', show(matches('has:history')) === '[]' && show(matches('was:192.168.1.20')) === '[]');
    setQuery('was:192.168.1.20');
    ok('and no line under the box (history is kept)', note() === '', note());
    setQuery('');
    // Between the points: the PC gets a new address and MAC, is replugged,
    // moved to Rack 4 and renamed; the camera takes the PC's old address; the
    // switch is renamed; the NAS moves its address to its second NIC.
    const pc = getNode('pc');
    pc.interfaces[0].ip = '192.168.1.30/24';
    pc.interfaces[0].mac = 'aa:bb:cc:00:11:99';
    pc.group = 'r4'; pc.name = 'PC-1B';
    state.links.find((l) => l.id === 'a').sourceIface = 'p7';
    getNode('cam').interfaces[0].ip = '192.168.1.20/24';
    getNode('sw').name = 'SW-02';
    getNode('nas').interfaces[0].ip = ''; getNode('nas').interfaces[1].ip = '192.168.1.50/24';
    save();
    ok('a second point, a report', record('report', D2));

    ok('was:<address> finds the device that had it, not the one that has it now', show(matches('was:192.168.1.20')) === '["pc"]', show(matches('was:192.168.1.20')));
    ok('with a prefix it reads as the network, as ip: does', show(matches('was:"192.168.1.20/24"')) === '["cam","pc"]', show(matches('was:"192.168.1.20/24"')));
    ok('was:<network> finds every device with a past address inside it', show(matches('was:192.168.1.0/24')) === '["cam","pc"]', show(matches('was:192.168.1.0/24')));
    ok('a network nobody was on finds nothing', show(matches('was:10.9.0.0/16')) === '[]');
    ok('the start of an address, as typed so far', show(matches('was:192.168.')) === '["cam","pc"]' && show(matches('was:192.168.1.7')) === '[]',
      show(matches('was:192.168.')));
    ok('a value held now is no match', show(matches('was:192.168.1.30')) === '[]');
    ok('an address moved to another NIC of the same device is still held', show(matches('was:192.168.1.50')) === '[]');
    ok('a MAC with colons', show(matches('was:AA:BB:CC:00:11:22')) === '["pc"]', show(matches('was:AA:BB:CC:00:11:22')));
    ok('a MAC with dashes, dots or a fragment', ['was:aa-bb-cc-00-11-22', 'was:aabb.cc00.1122', 'was:00-11-22'].every((w) => show(matches(w)) === '["pc"]'),
      ['was:aa-bb-cc-00-11-22', 'was:aabb.cc00.1122', 'was:00-11-22'].map((w) => show(matches(w))).join(' '));
    ok('the MAC held now is no match', show(matches('was:aa:bb:cc:00:11:99')) === '[]');
    ok('a past group path', show(matches('was:"rack 3"')) === '["pc"]' && show(matches('was:"building a / rack 3"')) === '["pc"]', show(matches('was:"rack 3"')));
    ok('the group held now is no match', show(matches('was:"rack 4"')) === '[]');
    ok('a past switch port by the switch’s name at the time', show(matches('was:"SW · Gi1/0/12"')) === '["pc"]', show(matches('was:"SW · Gi1/0/12"')));
    ok('a switch renamed is no move: the camera on the same port is no match', show(matches('was:"Gi1/0/5"')) === '[]', show(matches('was:"Gi1/0/5"')));
    ok('a past name (and the switch’s)', show(matches('was:"PC-1"')) === '["pc"]' && show(matches('was:sw')) === '["pc","sw"]', show(matches('was:sw')));
    ok('the name held now is no match', show(matches('was:pc-1b')) === '[]');
    ok('negated, it leaves them out', show(matches('type:pc -was:192.168.1.20')) === '[]' && show(matches('-was:192.168.1.20')).indexOf('"pc"') < 0);
    ok('ANDed with the other words', show(matches('type:camera was:192.168.1')) === '["cam"]', show(matches('type:camera was:192.168.1')));
    setQuery('was:192.168.1.20');
    const lit = queryMapMatches();
    ok('the map lights only the device that had it', !!lit && lit.nodes.size === 1 && lit.nodes.has('pc'), lit ? show([...lit.nodes]) : 'none');
    ok('and nothing is said under the box', note() === '' && el('queryError').classList.contains('hidden'), note());

    // ---- 4. has:history ----
    ok('has:history finds every device with a past value', show(matches('has:history')) === '["cam","pc","sw"]', show(matches('has:history')));
    ok('-has:history the others', show(matches('-has:history')) === '["nas","prn","rt"]', show(matches('-has:history')));
    // A read-only network: no history is kept, so nothing matches.
    const roHeld = state.readOnly;
    state.readOnly = { doc: serializeDoc() };
    ok('read-only: was: and has:history match nothing', show(matches('was:192.168.1.20')) === '[]' && show(matches('has:history')) === '[]');
    setQuery('has:history');
    ok('and the line says no history is kept', note() === 'No history is kept for this network.', note());
    state.readOnly = roHeld;
    setQuery('');

    // ---- 5. A removed device that held it ----
    const prnHeld = cloneData(getNode('prn'));
    state.nodes = state.nodes.filter((n) => n.id !== 'prn');
    save();
    ok('a removed device is no match (it cannot be drawn)', show(matches('was:192.168.1.90')) === '[]');
    setQuery('was:192.168.1.90');
    ok('the line under the box names it and until when', note() === 'Also held by removed device Printer until 2026-09-14.', note());
    ok('styled as a muted note, not an error', el('queryNote').classList.contains('q-note'));
    setQuery('was:192.168.1.0/24');
    ok('a network names the removed holder too', note() === 'Also held by removed device Printer until 2026-09-14.', note());
    setQuery('was:10.9.9.9');
    ok('nothing said when no removed device held it', note() === '');
    state.nodes.push(prnHeld); save();
    // More than three removed holders: three named, the rest counted.
    {
      const original = T.trailOf(id);
      const many = cloneData(original);
      for (let i = 1; i <= 5; i++) {
        many.devices['old' + i] = { name: 'OLD-' + i, gone: D2, spans: [{ f: 'ip', k: 'x', val: '10.7.7.7/24', txt: '10.7.7.7/24', first: D1, last: D1 + i, kind: 'backup' }] };
      }
      const keepId = state.libraryId;
      // The trail is read from the store's map; put the edited record there.
      _trails.set(keepId, many);
      setQuery('was:10.7.7.7');
      ok('past three removed holders, the rest are counted', /OLD-5 until .*OLD-4 until .*OLD-3 until .*Other removed devices that held it: 2\.$/.test(note()), note());
      setQuery('');
      _trails.set(keepId, original);
    }

    // ---- 6. The saved-search refusal, for real ----
    ok('queryLocalTerms finds them by their words', show(queryLocalTerms('type:pc was:192.168.1.20 -has:history')) === show(['was:192.168.1.20', '-has:history']));
    Q_PREFIXES.formerly = Q_PREFIXES.was;
    ok('and by the parsed term: an alias of was: is refused with it', show(queryLocalTerms('formerly:10.0.0.5 type:pc')) === show(['formerly:10.0.0.5']));
    delete Q_PREFIXES.formerly;
    ok('the device the box finds is not counted for a saved search', show(matches('was:192.168.1.20')) === '["pc"]'
      && querySavedMatches('was:192.168.1.20').length === 0 && queryMatchCount('has:history') === 0);
    ok('a plain search still counts', querySavedMatches('type:pc').length === 1);
    ok('searchProblem refuses was: and has:history', /reads what this browser remembers/.test(searchProblem({ query: 'was:192.168.1.20', name: 'Old' }) || '')
      && /reads what this browser remembers/.test(searchProblem({ query: 'type:pc has:history', name: 'Moved' }) || ''));
    const heldSearches = state.searches;
    state.searches = [{ id: 'sq_w', name: 'Old PC address', query: 'was:192.168.1.20', print: true },
      { id: 'sq_h', name: 'Moved', query: 'has:history', print: true },
      { id: 'sq_p', name: 'PCs', query: 'type:pc', print: true }];
    const printed = reportSearches();
    ok('the report prints no rows for them, naming the terms', printed[0].local === 'was:192.168.1.20' && printed[0].rows.length === 0
      && printed[1].local === 'has:history' && printed[1].rows.length === 0, show(printed.map((s) => [s.local, s.rows.length])));
    ok('and still prints the plain one', !printed[2].local && printed[2].rows.length === 1);
    const sec = searchesSection(printed);
    ok('the section says they are not printed', (sec.match(/Not printed: /g) || []).length === 2, sec.slice(0, 400));
    state.searches = heldSearches;

    // ---- 7. The History section's past values search for themselves ----
    el('historyGroup').open = true;
    select('pc', 'node');
    const btn = (f) => el('historyBody').querySelector(`.hist-block[data-f="${f}"] button.hist-was`);
    ok('a past value is a button', !!btn('ip') && btn('ip').type === 'button' && btn('ip').textContent === '192.168.1.20/24', el('historyBody').innerHTML.slice(0, 300));
    ok('its search: the address without its prefix', btn('ip').dataset.was === 'was:192.168.1.20', btn('ip').dataset.was);
    ok('a MAC as shown', btn('mac').dataset.was === 'was:AA:BB:CC:00:11:22', btn('mac').dataset.was);
    ok('a port, a group and a name quoted', btn('port').dataset.was === 'was:"SW · Gi1/0/12"' && btn('group').dataset.was === 'was:"Building A / Rack 3"'
      && btn('name').dataset.was === 'was:"PC-1"', [btn('port'), btn('group'), btn('name')].map((b) => b && b.dataset.was).join(' | '));
    ok('the value now is no button', !el('historyBody').querySelector('.hist-now button'));
    btn('ip').click();
    ok('a click puts was: in the box and searches', state.query === 'was:192.168.1.20' && el('queryInput').value === 'was:192.168.1.20'
      && !!queryMapMatches() && queryMapMatches().nodes.has('pc') && !queryMapMatches().nodes.has('cam'), state.query);
    btn('port').click();
    ok('the port’s button finds the device that was on it', state.query === 'was:"SW · Gi1/0/12"' && show(matches(state.query)) === '["pc"]');
    btn('group').click();
    ok('the group’s finds it too', show(matches(state.query)) === '["pc"]', state.query);
    setQuery('');

    // ---- 8. The words in five locales ----
    const keys = ['No history is kept for this network.', 'Also held by removed device {name} until {date}.',
      'Other removed devices that held it: {n}.', 'Search for the devices that had this',
      "Plain words match any field. Narrow with name:, type:, ip: (an address or a network such as 10.0.0.0/24), mac:, vendor:, model:, fw:, vlan:, switch:, has:finding and was: (what a device had before, from this browser's history). Put - in front of a word to leave it out. Enter frames the matches on the map."];
    const { MESSAGES } = window.CarinoI18N;
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = keys.filter((k) => !MESSAGES[loc][k] || MESSAGES[loc][k] === k);
      ok(`${loc} carries every was: string`, miss.length === 0, miss.join(' | '));
      ok(`${loc} keeps the placeholders`, ['{name}', '{date}'].every((p) => MESSAGES[loc][keys[1]].includes(p)) && MESSAGES[loc][keys[2]].includes('{n}'));
      ok(`${loc}'s tooltip names was: and has:finding untranslated`, /was:/.test(MESSAGES[loc][keys[4]]) && /has:finding/.test(MESSAGES[loc][keys[4]]));
    });
    ok('Japanese never says コンピューター in them', !keys.some((k) => /コンピューター/.test(MESSAGES.ja[k] || '')));
    ok('the box’s tooltip names was:', /was:/.test(el('queryInput').title), el('queryInput').title);
    setLocale('es'); applyStaticI18n();
    ok('in Spanish the tooltip is translated and names was:', /historial de este navegador/.test(el('queryInput').title), el('queryInput').title);
    setQuery('was:192.168.1.90');
    state.nodes = state.nodes.filter((n) => n.id !== 'prn'); save(); setQuery(''); setQuery('was:192.168.1.90');
    ok('and the removed holder reads in Spanish, the prefix untranslated', /^También lo tuvo el dispositivo eliminado Printer hasta el 2026-09-14\.$/.test(note()), note());
    setQuery('');
    setLocale('en'); applyStaticI18n();

    // ---- 9. Hex-like text, bare MACs, IPv6 fragments, prefixes, long names, two uplinks ----
    const D3 = day(2026, 10, 1), D4 = day(2026, 10, 20);
    state.groups.push({ id: 'ga', name: 'A-1', kind: 'rack' }, { id: 'gb', name: 'B-2', kind: 'rack' });
    state.nodes.push(
      { id: 'dc', type: 'server', name: 'DC-01', x: 500, y: 200, group: 'ga',
        interfaces: [{ id: 'd1', name: 'eth0', ip: '10.0.0.40' }, { id: 'd2', name: 'eth1', ip: '2001:db8::10/64' }] },
      { id: 'pfx', type: 'pc', name: 'PFX', x: 600, y: 200, interfaces: [{ id: 'f1', name: 'eth0', ip: '10.0.0.41/24' }] },
      { id: 'long', type: 'pc', name: 'x'.repeat(600), x: 700, y: 200, interfaces: [] },
      { id: 'sw2', type: 'switch', name: 'SW-B', x: 100, y: 100, portCount: 8, interfaces: [] },
      { id: 'dual', type: 'server', name: 'DUAL', x: 800, y: 200, interfaces: [{ id: 'u1', name: 'eth0', ip: '' }, { id: 'u2', name: 'eth1', ip: '' }] });
    state.links.push({ id: 'du1', source: 'sw', target: 'dual', sourceIface: 'p1', targetIface: 'u1' },
      { id: 'du2', source: 'sw2', target: 'dual', sourceIface: 'p1', targetIface: 'u2' });
    save();
    ok('a third point', record('backup', D3));
    // Between: DC-01 renamed and moved to B-2, its address given a prefix,
    // its IPv6 address cleared; PFX's prefix corrected; the second switch
    // renamed so that uplinkOf now reads the dual-homed server's other cable.
    const dcN = getNode('dc');
    dcN.name = 'DC-02'; dcN.group = 'gb'; dcN.interfaces[0].ip = '10.0.0.40/24'; dcN.interfaces[1].ip = '';
    getNode('pfx').interfaces[0].ip = '10.0.0.41/23';
    const upBefore = uplinkOf(getNode('dual')).peer.id;
    getNode('sw2').name = 'AA';
    ok('the rename swaps which uplink uplinkOf reads', upBefore === 'sw' && uplinkOf(getNode('dual')).peer.id === 'sw2', upBefore);
    save();
    ok('a fourth point', record('backup', D4));

    ok('a past name made of hex and a dash is found as text', show(matches('was:"DC-01"')) === '["dc"]' && show(matches('was:dc-01')) === '["dc"]',
      show(matches('was:"DC-01"')));
    ok('a past group made of hex and a dash too', show(matches('was:"A-1"')) === '["dc"]', show(matches('was:"A-1"')));
    ok('a MAC typed with no separators, whole or a fragment', show(matches('was:aabbcc001122')) === '["pc"]' && show(matches('was:aabbcc')) === '["pc"]',
      show(matches('was:aabbcc001122')) + ' ' + show(matches('was:aabbcc')));
    ok('the start of an IPv6 address', show(matches('was:2001:db8')) === '["dc"]' && show(matches('was:2001:db8::10')) === '["dc"]',
      show(matches('was:2001:db8')));
    ok('an address that only gained a prefix is still held', show(matches('was:10.0.0.40')) === '[]', show(matches('was:10.0.0.40')));
    ok('an address whose prefix changed is still held', show(matches('was:10.0.0.41')) === '[]', show(matches('was:10.0.0.41')));
    const hist9 = matches('has:history');
    ok('a prefix change alone is no past value for has:history', !hist9.includes('pfx'), show(hist9));
    ok('a name past the recorder’s cut is no past value', !hist9.includes('long') && show(matches('was:xxxxxxxx')) === '[]', show(matches('was:xxxxxxxx')));
    const dualTrail = T.deviceTrail(id, 'dual');
    ok('the dual-homed server keeps the uplink it was recorded on', !!dualTrail && dualTrail.spans.filter((s) => s.f === 'port').length === 1);
    ok('a dual-homed server whose other switch was renamed has no history', !hist9.includes('dual') && show(matches('was:"SW-B"')).indexOf('dual') < 0,
      show(hist9));
    el('historyGroup').open = true;
    select('dc', 'node');
    const dcBtn = (f) => el('historyBody').querySelector(".hist-block[data-f=\"" + f + "\"] button.hist-was");
    ok('the hex-like past name’s button', !!dcBtn('name') && dcBtn('name').dataset.was === 'was:"DC-01"', dcBtn('name') && dcBtn('name').dataset.was);
    dcBtn('name').click();
    ok('finds the device it is on', show(matches(state.query)) === '["dc"]' && !!queryMapMatches() && queryMapMatches().nodes.has('dc'), state.query);
    dcBtn('group').click();
    ok('and the hex-like past group’s too', state.query === 'was:"A-1"' && show(matches(state.query)) === '["dc"]', state.query);
    setQuery('');

    // The removed-holder line asks each was: term of the whole trail, and
    // says nothing when other words could rule the device out.
    {
      const original = T.trailOf(id);
      const one = cloneData(original);
      one.devices.oldp = { name: 'OLD-P', gone: D4, spans: [
        { f: 'ip', k: 'x', val: '10.8.8.8/24', txt: '10.8.8.8/24', first: D1, last: D3, kind: 'backup' },
        { f: 'port', k: '', val: 'sw|p3', txt: 'SW · Gi1/0/3', first: D1, last: D3, kind: 'backup' }] };
      _trails.set(state.libraryId, one);
      setQuery('was:10.8.8.8 was:gi1/0/3');
      ok('two was: terms matched by different values of one removed device', /OLD-P/.test(note()), note());
      setQuery('type:camera was:10.8.8.8');
      ok('no removed holder named when other words could rule it out', note() === '', note());
      setQuery('was:10.8.8.8 -was:gi1/0/3');
      ok('nor when a negated was: rules it out', note() === '', note());
      setQuery('');
      _trails.set(state.libraryId, original);
    }

    // A trail changed under a was: search redraws its matches and its count.
    setQuery('was:"DC-01"');
    ok('the count before', el('queryCount').textContent === 'Devices: 1 of ' + state.nodes.length, el('queryCount').textContent);
    T.forgetDevice(id, 'dc');
    ok('forgetting the device’s history redraws the matches and the count', el('queryCount').textContent === 'Devices: 0 of ' + state.nodes.length
      && !!_queryLastMap && _queryLastMap.nodes.size === 0, el('queryCount').textContent);
    setQuery('');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    try { setQuery(''); } catch (e) { /* the box */ }
    if (id) T.dropTrail(id);
    setLocale('en');
    persistLibrary(heldLib);
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
