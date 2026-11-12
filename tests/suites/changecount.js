// docChangeCount (js/library.js) counts every part of the canonical document:
// the "(n changes)" on Update, and 0 meaning "the same". It counted devices,
// cables, notes, the report header, the accepted findings, the pins and the
// saved searches, and nothing else, so a copy differing only by a subnet, a
// group, a Wi-Fi network, a provider, a custom column, the table view or the
// expected lives was "the same": opening it opened the card and dropped the
// file's version. What is held:
//   1. each of those keys is a change, one per added, removed or edited
//      item for an id list and one for a plain value, both ways round;
//   2. the counts that were there before stay what they were (two devices
//      are two changes, a changed list of searches or pins is one);
//   3. a document against itself, or against its kept card, is 0;
//   4. through the callers: askAboutKnownCopy asks (with the count) instead
//      of answering 'same', applyImportedDoc offers Update for a file that
//      differs only by a subnet and Update takes it, and binderOlderSites
//      offers an older binder site that differs only by a group;
//   5. docChanges (the changes since the last back-up) has a row for every
//      part counted here: one edit per kind across every top-level key
//      serializeDoc writes, both ways round (the report's date alone the one
//      exemption), and what the new rows (providers, custom columns, saved
//      searches, expected lives, the table layout, a field outside a kind's
//      list) say, in English and Spanish.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const L = CarinoLibrary;
  let choose = null, offered = null;
  // Restore points (js/restore.js) on a store that takes every write, so an
  // Update is not held up by the could-not-be-saved question (tests/suites/restore.js).
  if (window.CarinoRestore) await CarinoRestore.openRestoreStore({ open: async () => [], readCards: async () => ({}), readDoc: async () => null, write: async () => true });
  const heldResponder = setDialogResponder((req) => {
    if (req.kind === 'choice') { offered = { message: req.message, ids: req.choices.map((c) => c.id), labels: req.choices.map((c) => c.label) }; return choose; }
    if (req.kind === 'confirm') return true;
    return undefined;
  });
  const heldLib = L.loadLibrary();
  L.persistLibrary({});

  // A network that has every part a document can hold.
  const fx = () => ({ v: DOC_VERSION,
    nodes: [
      { id: 'r', type: 'router', name: 'Router', x: 0, y: 0, interfaces: [], groupId: 'g1', extra: { c1: 'Rack A' } },
      { id: 'p', type: 'pc', name: 'PC', x: 100, y: 0, interfaces: [] }
    ],
    links: [{ id: 'l1', source: 'r', target: 'p' }],
    networks: [{ id: 'net1', cidr: '10.0.0.0/24', name: 'LAN' }, { id: 'net2', cidr: '10.0.1.0/24', name: 'Guests' }],
    groups: [{ id: 'g1', name: 'Main building', kind: 'building' }],
    wifi: [{ id: 'wf1', ssid: 'Office', security: 'wpa2' }],
    providers: [{ id: 'pv1', name: 'FiberCo', service: 'internet' }],
    watch: [{ id: 'wa1', name: 'Public DNS', address: '1.1.1.1', checks: [{ id: 'c1', proto: 'ping' }] }],
    columns: [{ id: 'c1', name: 'Asset tag' }],
    expectedLife: { pc: 4 },
    tableView: { devices: { hidden: ['mac'] } },
    searches: [{ id: 'sq_1', name: 'PCs', query: 'type:pc' }, { id: 'sq_2', name: 'Routers', query: 'type:router' }],
    annotations: [{ id: 'a1', x: 0, y: 50, text: 'Note' }],
    report: { site: 'Casa Roma' },
    // A problem report (v18).
    incidents: [{ id: 'in1', at: 1762600000000, status: 'open', symptom: 'internet', nodeIds: ['p'], text: 'No internet', reporter: { name: 'Ana' } }]
  });
  const edit = (fn) => { const d = fx(); fn(d); return d; };
  const both = (a, b) => [docChangeCount(a, b), docChangeCount(b, a)];
  const is = (name, d, n) => { const got = both(fx(), d); ok(name, got[0] === n && got[1] === n, show(got)); };

  try {
    // The fixture survives the serializer: every key is still there, so
    // what is counted below is really in the document.
    const keys = Object.keys(canonicalDoc(fx()));
    ok('the fixture keeps every key through canonicalDoc',
       ['nodes', 'links', 'networks', 'groups', 'wifi', 'providers', 'expectedLife', 'annotations', 'report', 'columns', 'tableView', 'searches'].every((k) => keys.includes(k)), show(keys));

    // ---- 3: nothing differs ----
    ok('a document against itself is no change', docChangeCount(fx(), fx()) === 0, String(docChangeCount(fx(), fx())));
    ok('nor against its canonical form', docChangeCount(canonicalDoc(fx()), fx()) === 0 && docChangeCount(fx(), canonicalDoc(fx())) === 0);
    ok('key order is not a change', docChangeCount(fx(), Object.fromEntries(Object.entries(fx()).reverse())) === 0);
    ok('the identity is not a change', docChangeCount(fx(), Object.assign(fx(), { id: 'abc', updated: 12345 })) === 0);
    // Records with no id, or a repeated one, get an id from the serializer:
    // the same one on every pass, so a copy of such a file is still the same.
    const idless = () => ({ nodes: [], links: [], wifi: [{ ssid: 'Home' }, { ssid: 'Guests' }],
      groups: [{ id: 'g_x', name: 'A', kind: 'building' }, { id: 'g_x', name: 'B', kind: 'building' }] });
    const raw = idless();
    const rawJson = JSON.stringify(raw);
    ok('Wi-Fi with no id and groups sharing an id are no change against a copy', docChangeCount(raw, idless()) === 0 && docChangeCount(idless(), JSON.parse(rawJson)) === 0,
       show([...docChangeParts(raw, idless())]));
    ok('and comparing does not write ids into the documents', JSON.stringify(raw) === rawJson, JSON.stringify(raw));
    ok('and a real difference among them still counts', docChangeCount(idless(), Object.assign(idless(), { wifi: [{ ssid: 'Home' }, { ssid: 'Other' }] })) === 1);
    const seqBefore = idSeq;
    canonicalDoc(idless());
    ok('and the live id sequence is put back', idSeq === seqBefore && /^n_/.test(nextId('n')) && !nextId('n').startsWith('n_0'), String(idSeq));

    // ---- 1: the keys that were not counted ----
    is('an edited subnet is one change', edit((d) => { d.networks[0].name = 'Office LAN'; }), 1);
    is('an added subnet is one change', edit((d) => { d.networks.push({ id: 'net3', cidr: '10.0.2.0/24' }); }), 1);
    is('a removed subnet is one change', edit((d) => { d.networks.pop(); }), 1);
    is('two edited subnets are two', edit((d) => { d.networks[0].name = 'X'; d.networks[1].name = 'Y'; }), 2);
    is('every subnet gone is one per subnet', edit((d) => { delete d.networks; }), 2);
    is('an edited group is one change', edit((d) => { d.groups[0].name = 'Annex'; }), 1);
    is('an added group is one change', edit((d) => { d.groups.push({ id: 'g2', name: 'Rack 1', kind: 'rack', parent: 'g1' }); }), 1);
    is('an edited Wi-Fi network is one change', edit((d) => { d.wifi[0].security = 'wpa3'; }), 1);
    is('an added Wi-Fi network is one change', edit((d) => { d.wifi.push({ id: 'wf2', ssid: 'Guests' }); }), 1);
    is('an edited provider is one change', edit((d) => { d.providers[0].phone = '555 0100'; }), 1);
    is('a removed provider is one change', edit((d) => { d.providers = []; }), 1);
    is('a renamed custom column is one change', edit((d) => { d.columns[0].name = 'Inventory no.'; }), 1);
    is('an added custom column is one change', edit((d) => { d.columns.push({ id: 'c2', name: 'Owner' }); }), 1);
    is('a changed expected life is one change', edit((d) => { d.expectedLife = { pc: 6, printer: 3 }; }), 1);
    is('expected lives gone are one change', edit((d) => { delete d.expectedLife; }), 1);
    is('a changed table view is one change', edit((d) => { d.tableView = { devices: { hidden: ['mac', 'ip'], order: ['name'] } }; }), 1);
    is('a table view gone is one change', edit((d) => { delete d.tableView; }), 1);
    is('one of each is one change each',
       edit((d) => { d.networks[0].name = 'X'; d.groups[0].name = 'Y'; d.wifi[0].ssid = 'Z'; d.providers[0].name = 'W'; d.columns[0].name = 'V'; d.expectedLife = { pc: 7 }; d.tableView = {}; }), 7);

    // ---- 2: the counts that were there stay ----
    is('two edited devices are two changes', edit((d) => { d.nodes[0].name = 'A'; d.nodes[1].name = 'B'; }), 2);
    is('an added cable is one change', edit((d) => { d.links.push({ id: 'l2', source: 'p', target: 'r' }); }), 1);
    is('an edited text note is one change', edit((d) => { d.annotations[0].text = 'Other'; }), 1);
    is('a changed report header is one change', edit((d) => { d.report = { site: 'Casa Roma', client: 'Ana', tech: 'Luis' }; }), 1);
    is('both searches changed are still one change', edit((d) => { d.searches[0].name = 'Desktops'; d.searches[1].query = 'type:edge'; }), 1);
    is('a search added is one change', edit((d) => { d.searches.push({ id: 'sq_3', name: 'Printers', query: 'type:printer' }); }), 1);

    // ---- 5: no part goes without a row ----
    // docChanges (js/changes.js, the "± n changes since the last back-up" and
    // the report's section) must say every part counted here. One document
    // pair per kind of edit, each differing in one part; every top-level key
    // serializeDoc writes is exercised, both ways round. 2026-11-09.
    const rich = () => edit((d) => {
      d.nodes[0].interfaces = [{ id: 'i1', name: 'eth0' }, { id: 'i2', name: 'eth1' }];
      d.accepted = [{ check: 'age', nodeIds: ['p'], reason: 'Planned', until: '2027-01-31' }];
      d.pinned = [{ check: 'age', nodeIds: ['p'], note: 'Look' }, { check: 'age', nodeIds: ['r'], note: 'Also' }];
      // A column no device has a value in (a new kind would drop a value
      // that does not fit it, a second change), and a group with no name of
      // its own (it reads as its kind's).
      d.columns.push({ id: 'c2', name: 'Floor' });
      d.groups.push({ id: 'g9', name: '', kind: 'floor', parent: 'g1' });
    });
    const richEdit = (fn) => { const d = rich(); fn(d); return d; };
    const cases = [
      ['nodes', 'a device field', (d) => { d.nodes[1].model = 'T14'; }],
      ['nodes', 'a device moved', (d) => { d.nodes[1].x = 300; }],
      ['nodes', 'interfaces reordered', (d) => { d.nodes[0].interfaces.reverse(); }],
      ['nodes', 'a device added', (d) => { d.nodes.push({ id: 'q', type: 'printer', name: 'PRN', x: 0, y: 200, interfaces: [] }); }],
      ['nodes', 'a custom value', (d) => { d.nodes[0].extra = { c1: 'Rack B' }; }],
      ['links', 'a cable field', (d) => { d.links[0].cable = { label: 'P-01' }; }],
      ['links', 'a cable added', (d) => { d.links.push({ id: 'l2', source: 'p', target: 'r' }); }],
      ['networks', 'a subnet edited', (d) => { d.networks[0].vlan = 20; }],
      ['networks', 'a subnet removed', (d) => { d.networks.pop(); }],
      ['groups', 'a group edited', (d) => { d.groups[0].kind = 'floor'; }],
      ['groups', 'a group named its default', (d) => { d.groups[1].name = groupKindName('floor'); }],
      ['groups', 'a group added', (d) => { d.groups.push({ id: 'g2', name: 'Rack 1', kind: 'rack', parent: 'g1' }); }],
      ['wifi', 'a Wi-Fi network edited', (d) => { d.wifi[0].security = 'wpa3'; }],
      ['wifi', 'a Wi-Fi network removed', (d) => { d.wifi = []; }],
      ['providers', 'a provider edited', (d) => { d.providers[0].phone = '555 0100'; }],
      ['providers', 'a provider added', (d) => { d.providers.push({ id: 'pv2', name: 'PowerCo' }); }],
      ['providers', 'a provider removed', (d) => { d.providers = []; }],
      ['watch', 'a watched address edited', (d) => { d.watch[0].name = 'Cloudflare'; }],
      ['watch', 'a watched address added', (d) => { d.watch.push({ id: 'wa2', address: '9.9.9.9' }); }],
      ['watch', 'a watched address removed', (d) => { d.watch = []; }],
      ['columns', 'a column renamed', (d) => { d.columns[0].name = 'Inventory no.'; }],
      ['columns', 'a column kind', (d) => { d.columns[1].kind = 'number'; }],
      ['columns', 'a column added', (d) => { d.columns.push({ id: 'c3', name: 'Owner' }); }],
      ['searches', 'a search edited', (d) => { d.searches[1].query = 'type:edge'; }],
      ['searches', 'a search added', (d) => { d.searches.push({ id: 'sq_3', name: 'Printers', query: 'type:printer' }); }],
      ['searches', 'a search removed', (d) => { d.searches.pop(); }],
      ['annotations', 'a text note edited', (d) => { d.annotations[0].text = 'Other'; }],
      ['accepted', 'a finding accepted', (d) => { d.accepted.push({ check: 'age', nodeIds: ['r'], reason: 'Spare' }); }],
      ['accepted', 'an accepted finding’s date', (d) => { d.accepted[0].until = '2027-06-30'; }],
      ['pinned', 'a finding pinned', (d) => { d.pinned.pop(); }],
      ['pinned', 'the pins reordered', (d) => { d.pinned.reverse(); }],
      ['expectedLife', 'an expected life', (d) => { d.expectedLife = { pc: 6 }; }],
      ['tableView', 'the table layout', (d) => { d.tableView = { devices: { hidden: ['mac', 'ip'] } }; }],
      ['report', 'a report header field', (d) => { d.report.client = 'Ana'; }],
      ['incidents', 'a problem report sent', (d) => { d.incidents[0].status = 'sent'; d.incidents[0].sentAt = 1762600100000; }],
      ['incidents', 'a problem report added', (d) => { d.incidents.push({ id: 'in2', at: 1762600200000, status: 'open', symptom: 'printer', text: 'Jammed' }); }]
    ];
    const silent = [], wrongCount = [], generic = [];
    cases.forEach(([key, label, fn]) => {
      const a = rich(), b = richEdit(fn);
      [[a, b], [b, a]].forEach(([x, y], back) => {
        const n = docChangeCount(x, y), ch = docChanges(x, y), rows = changeRows(ch);
        if (n !== 1) wrongCount.push(`${label}${back ? ' (back)' : ''}: ${n} ${show([...docChangeParts(x, y)])}`);
        if (n > 0 && !(ch.total > 0 && rows.length > 0)) silent.push(`${label}${back ? ' (back)' : ''}`);
        // Said by its own kind, not by the generic fallback (unsaidParts):
        // only a reorder of the pins has no kind of its own.
        if (label !== 'the pins reordered' && (ch.other || []).length) generic.push(`${label}${back ? ' (back)' : ''}: ${show(ch.other)}`);
        if (n === 0 && ch.total !== 0) silent.push(`${label}${back ? ' (back)' : ''}: rows with no count`);
      });
    });
    ok('every single-part edit differs in exactly one part', !wrongCount.length, wrongCount.join(' | '));
    ok('no part docChangeCount counts goes without a row in docChanges', !silent.length, silent.join(' | '));
    ok('and each is said by its own kind, not the generic fallback', !generic.length, generic.join(' | '));
    const exercised = new Set(cases.map((c) => c[0]));
    // The network log (v17) is the one key left out on purpose (docs/SCOPE.md
    // D1): a merge unions it, and counting it would make every copy of a
    // merged network look changed. Asserted below.
    const emitted = Object.keys(canonicalDoc(rich())).filter((k) => k !== 'v' && k !== 'log');
    ok('every top-level key serializeDoc writes is exercised', emitted.length === exercised.size && emitted.every((k) => exercised.has(k)),
       show(emitted.filter((k) => !exercised.has(k))) + ' ' + show([...exercised].filter((k) => !emitted.includes(k))));
    const logged = richEdit((d) => { d.log = [{ id: 'lg_a', at: 5, kind: 'merge', source: 'x.json', counts: { added: 1, changed: 0, removed: 0, conflicts: 0 } }]; });
    ok('the network log is written, but a copy differing only in it is no change', Array.isArray(canonicalDoc(logged).log)
       && docChangeCount(rich(), logged) === 0 && docChanges(rich(), logged).total === 0 && docChanges(logged, rich()).total === 0);
    ok('nor is a copy differing only in its rev, base or prior', docChangeCount(rich(), Object.assign({ rev: 'r1', base: 'r0', prior: ['q'] }, rich())) === 0);
    // The one exemption, on purpose: a report's date is when it was issued.
    const dated = richEdit((d) => { d.report.date = '2026-11-09'; });
    ok('the report date alone counts for Update but is no change since the back-up', docChangeCount(rich(), dated) === 1 && docChanges(rich(), dated).total === 0);

    // What the new rows say.
    const rowsOf = (fn) => changeRows(docChanges(rich(), richEdit(fn)));
    const one = (fn) => { const r = rowsOf(fn); return r.length === 1 ? `${r[0].op}|${r[0].what}|${r[0].name}|${r[0].detail}` : show(r); };
    const expect = (name, fn, want) => { const got = one(fn); ok(name, got === want, got); };
    expect('a provider edited: its row names the field', (d) => { d.providers[0].phone = '555 0100'; }, 'Changed|Provider|FiberCo|Phone');
    expect('a provider renamed', (d) => { d.providers[0].name = 'FibraNet'; }, 'Changed|Provider|FibraNet|renamed from FiberCo');
    expect('a provider added', (d) => { d.providers.push({ id: 'pv2', name: 'PowerCo' }); }, 'Added|Provider|PowerCo|');
    expect('a problem report sent: its row names the fields', (d) => { d.incidents[0].status = 'sent'; d.incidents[0].sentAt = 1762600100000; }, 'Changed|Problem report|No internet: No internet|Status, Sent');
    expect('a problem report added', (d) => { d.incidents.push({ id: 'in2', at: 1762600200000, status: 'open', symptom: 'printer', text: 'Jammed' }); }, 'Added|Problem report|Printer: Jammed|');
    setLocale('es');
    { const got = one((d) => { d.incidents.push({ id: 'in3', at: 1762600300000, status: 'open', symptom: 'printer', text: 'Atasco' }); });
      ok('a problem report\'s row names the symptom in the reader\'s language, never its key', got.split('|')[2] === t('Printer') + ': Atasco' && t('Printer') !== 'Printer', got); }
    setLocale('en');
    expect('a custom column renamed', (d) => { d.columns[0].name = 'Inventory no.'; }, 'Changed|Custom column|Inventory no.|renamed from Asset tag');
    expect('a custom column’s kind', (d) => { d.columns[1].kind = 'number'; }, 'Changed|Custom column|Floor|Kind');
    expect('a saved search removed', (d) => { d.searches.pop(); }, 'Removed|Saved search|Routers|');
    expect('a saved search sorted, by its field labels', (d) => { d.searches[0].sort = 'name'; d.searches[0].desc = true; }, 'Changed|Saved search|PCs|Sort by, Descending');
    expect('the expected lives, by type', (d) => { d.expectedLife = { pc: 6, printer: 3 }; }, `Changed|Expected life by type||${typeName('pc')}, ${typeName('printer')}`);
    expect('the table layout, one row', (d) => { d.tableView = { devices: { order: ['ip', 'name'] } }; }, 'Changed|Table layout||');
    expect('an accepted finding’s date reads as reopened and accepted', (d) => { d.accepted[0].until = '2027-06-30'; }, 'Changed|Accepted findings||1 accepted, 1 reopened');
    const named = one((d) => { d.groups[1].name = groupKindName('floor'); });
    ok('a group given its kind’s own name (the label it already read as) says Name', named.startsWith('Changed|Group|') && named.endsWith('|Name'), named);
    expect('interfaces only reordered are not "moved"', (d) => { d.nodes[0].interfaces.reverse(); }, 'Changed|Device|Router|changed: Interfaces');
    expect('the pins only reordered: one row for them', (d) => { d.pinned.reverse(); }, 'Changed|Pinned findings||');
    expect('a device moved is still moved', (d) => { d.nodes[1].x = 300; }, 'Moved|1 device||On the map only, nothing else changed.');
    // A field outside a kind's list (a later build's, or a key that survived)
    // is named rather than left out. Stubbed at the diff, past the
    // serializer that would drop it today.
    const realCanon = window.canonicalDoc;
    window.canonicalDoc = (doc) => { const c = realCanon(doc); if (doc.__probe) c.providers[0].portal = doc.__probe; return c; };
    let probe;
    try { probe = changeRows(docChanges(Object.assign(rich(), { __probe: 'a' }), Object.assign(rich(), { __probe: 'b' }))); }
    finally { window.canonicalDoc = realCanon; }
    ok('a field outside the kind’s list is named: "changed: <field>"', probe.length === 1 && probe[0].what === 'Provider' && probe[0].detail === 'changed: portal', show(probe));
    // Spanish, for the new words.
    setLocale('es');
    const es = one((d) => { d.searches.pop(); });
    const esCol = one((d) => { d.columns[1].kind = 'number'; });
    const esView = one((d) => { d.tableView = {}; });
    setLocale('en');
    ok('in Spanish: a saved search, a custom column, the table layout', es === 'Eliminado|Búsqueda guardada|Routers|'
       && esCol === 'Modificado|Columna propia|Floor|Tipo' && esView === 'Modificado|Disposición de la tabla||', [es, esCol, esView].join(' / '));

    // ---- 4: through the callers ----
    const id = 'cc_card';
    const base = fx();
    const lib = {};
    lib[id] = { id, name: 'Casa Roma', created: 1000, updated: 2000, doc: base };
    L.persistLibrary(lib);
    const card = L.libraryEntry(id);
    ok('askAboutKnownCopy: the same document is the same', (await askAboutKnownCopy({ doc: fx(), updated: 3000 }, card)) === 'same');
    offered = null; choose = 'update';
    const onlySubnet = edit((d) => { d.networks[0].gateway = '10.0.0.1'; });
    const answer = await askAboutKnownCopy({ doc: onlySubnet, updated: 3000 }, card);
    // (Replace with this copy: the old Update, js/mergedoors.js. Without a
    // mergeContext answer, as here, Merge is not offered.)
    ok('askAboutKnownCopy: a newer copy differing only by a subnet is asked about, not "the same"',
       answer === 'update' && !!offered && offered.ids.join(',') === 'copy,update,mine' && offered.labels[1] === 'Replace with this copy',
       show(offered) + ' ' + answer);
    offered = null; choose = 'mine';
    const olderAnswer = await askAboutKnownCopy({ doc: edit((d) => { d.wifi = []; }), updated: 1500 }, card);
    ok('and an older one differing only by a Wi-Fi network too', olderAnswer === 'mine' && !!offered && offered.ids.includes('mine'), show(offered));

    // The file door: a back-up differing only by a subnet was opened as the
    // card and the subnet was lost.
    replaceDocument(templatesData.bank, { origin: 'template' });
    offered = null; choose = 'update';
    const file = { kind: 'nettopology', version: 1, name: 'Casa Roma', doc: Object.assign({ v: DOC_VERSION, id, updated: 5000 }, stripIdentity(onlySubnet)) };
    const took = await applyImportedDoc(file, { fileName: 'casa-roma.json' });
    ok('a file differing only by a subnet is offered as a merge, or Replace with this copy', took === true && !!offered
       && offered.ids.join(',') === 'merge,update,copy,mine' && offered.labels[1] === 'Replace with this copy', show(offered));
    const kept = L.loadLibrary()[id];
    ok('and Update takes the subnet into the card', !!kept && kept.updated === 5000 && (kept.doc.networks || []).find((n) => n.id === 'net1').gateway === '10.0.0.1',
       show(kept && kept.doc.networks));
    ok('and opens it', state.libraryId === id && state.networks.find((n) => n.id === 'net1').gateway === '10.0.0.1');
    flushAutosave();

    // The binder's older sites: one differing only by a group is offered
    // for the card's history (when this build can read it in).
    const olderSite = { id, name: 'Casa Roma', updated: 4000, doc: edit((d) => { d.networks[0].gateway = '10.0.0.1'; d.groups[0].name = 'Annex'; }) };
    const canRead = typeof trailCanReadIn !== 'function' || trailCanReadIn(olderSite.doc, olderSite.updated);
    if (canRead) {
      const older = binderOlderSites([olderSite]);
      ok('binderOlderSites offers an older site differing only by a group', older.length === 1 && older[0].id === id, show(older.map((s) => s.id)));
      const sameSite = { id, name: 'Casa Roma', updated: 4000, doc: cloneData(L.loadLibrary()[id].doc) };
      ok('and not one that is the same', binderOlderSites([sameSite]).length === 0);
    } else ok('binderOlderSites: the trail could not read the site in (recording off?)', true);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    L.persistLibrary(heldLib);
    if (window.CarinoRestore) { CarinoRestore.releaseRestoreStore(); CarinoRestore._reset(); }
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
