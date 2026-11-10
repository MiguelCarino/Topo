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
//      offers an older binder site that differs only by a group.
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
    columns: [{ id: 'c1', name: 'Asset tag' }],
    expectedLife: { pc: 4 },
    tableView: { devices: { hidden: ['mac'] } },
    searches: [{ id: 'sq_1', name: 'PCs', query: 'type:pc' }, { id: 'sq_2', name: 'Routers', query: 'type:router' }],
    annotations: [{ id: 'a1', x: 0, y: 50, text: 'Note' }],
    report: { site: 'Casa Roma' }
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
    ok('askAboutKnownCopy: a newer copy differing only by a subnet is asked about, with its count',
       answer === 'update' && !!offered && offered.ids.join(',') === 'copy,update' && offered.labels[1] === 'Update "Casa Roma" (1 change)',
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
    ok('a file differing only by a subnet is offered as an update', took === true && !!offered && offered.labels[1] === 'Update "Casa Roma" (1 change)', show(offered));
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
