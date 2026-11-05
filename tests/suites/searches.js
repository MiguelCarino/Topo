// Saved searches, stage 1 (docs/BACKLOG.md feature 6, landing order step 8):
// the model only, doc.searches through SEARCH_FIELDS, folded into document
// version 16 beside the DHCP pool. Nothing is visible yet. What is held here
// (part 1 of the spec's searches.js):
//   1. the format: a v15 document opens as the current version, editable,
//      with no searches key written; a v16 document's searches round-trip
//      the serializer byte for byte, in SEARCH_FIELDS' key order; an empty
//      list writes no key; a newer document opens read-only with its
//      searches kept exactly as they arrived; isDocShape refuses a searches
//      key that is not a list;
//   2. normalizeSearches: damaged entries dropped (no name, no query, not a
//      record, a later duplicate name in another case), a missing or
//      repeated id minted as the first free 'sq_<n>' (the same each time), more than SEARCH_MAX cut, the columns
//      cleaned ('name' never stored, a repeat or a bad key dropped, at most
//      20), desc only with a sort, print only when true, a query that does
//      not parse kept, one over 500 characters dropped, a long name cut;
//   3. normalizeSearchRefs: a custom column that is gone is dropped from
//      columns and sort (the sort's direction with it) on load, an unknown
//      Topo key kept, a live custom column kept; deleteCustomColumn strips it
//      from every search in the same undo step, and undo puts both back;
//   4. the held-state copies: canonicalDoc, withDoc, withDocRendered,
//      diagnoseDoc and the CSV dry run each borrow a document and hand the
//      live searches back untouched; a binder card's searches survive
//      canonicalDoc; docChangeCount counts a changed list as one change (and
//      none for an id-less hand-written document against itself), and
//      docChanges (the changes since the last back-up) does not count it;
//   5. each edit to state.searches through batch()+save() is one undo step.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const pc = (id, name, ip) => ({ id, type: 'pc', name, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const base = () => ({ v: DOC_VERSION, nodes: [pc('a', 'A', '10.0.1.5/24'), pc('b', 'B', '10.0.1.6/24')], links: [],
    networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1' }] });
  const open = (extra) => replaceDocument({ ...base(), ...(extra || {}) }, { origin: 'file' });
  const cams = { id: 'sq_cams', name: 'Cameras with findings', query: 'type:camera has:finding', columns: ['ifaces', 'location', 'x:c1'], sort: 'name', desc: true, print: true };
  const plain = { id: 'sq_pcs', name: 'PCs', query: 'type:pc' };
  setLocale('en');

  try {
    // ---- 1. The format ----
    ok('saved searches ride document version 16 or later', DOC_VERSION >= 16);
    const v15 = { v: 15, nodes: [pc('a', 'A', '10.0.1.5/24')], links: [] };
    replaceDocument(cloneData(v15), { origin: 'file' });
    ok('a v15 document opens editable as the current version', !state.readOnly && serializeDoc().v === DOC_VERSION);
    ok('with no saved searches and no searches key written', state.searches.length === 0 && !('searches' in JSON.parse(show(serializeDoc()))));
    ok('the 15 to 16 step changes nothing but v', show({ ...migrateDoc(cloneData(v15)).doc, v: 15 }) === show(v15));
    open({ columns: [{ id: 'c1', name: 'User' }], searches: [cloneData(cams), cloneData(plain)] });
    ok('a v16 document opens editable', !state.readOnly);
    ok('its searches round-trip the serializer byte for byte', show(serializeDoc().searches) === show([cams, plain]), show(serializeDoc().searches));
    const keyOrder = { print: true, desc: true, sort: 'name', columns: ['ifaces'], query: 'type:pc', name: 'Odd order', id: 'sq_o' };
    open({ searches: [keyOrder] });
    ok('written in SEARCH_FIELDS order (id, name, query, columns, sort, desc, print)', Object.keys(serializeDoc().searches[0]).join() === 'id,name,query,columns,sort,desc,print', Object.keys(serializeDoc().searches[0]).join());
    ok('and reloaded through the loader the same', (() => { const s = show(serializeDoc()); replaceDocument(JSON.parse(s), { origin: 'file' }); return show(serializeDoc()) === s; })());
    open({ searches: [] });
    ok('an empty list writes no key', !('searches' in JSON.parse(show(serializeDoc()))));
    const newer = { ...base(), v: DOC_VERSION + 1, searches: [{ id: 'sq_x', name: 'Future', query: 'vendor:cisco', columns: ['vendor'], future: 1 }] };
    replaceDocument(cloneData(newer), { origin: 'file' });
    ok('a newer document opens read-only', !!state.readOnly);
    ok('and its searches are kept exactly as they arrived', show(state.readOnly.doc.searches) === show(newer.searches), show(state.readOnly.doc.searches));
    ok('while the view of them is read through SEARCH_FIELDS (the unknown key left out)',
       show(state.searches) === show([{ id: 'sq_x', name: 'Future', query: 'vendor:cisco', columns: ['vendor'] }]), show(state.searches));
    ok('isDocShape refuses a searches key that is not a list', !isDocShape({ nodes: [], searches: {} }) && !isDocShape({ nodes: [], searches: 'x' }) && isDocShape({ nodes: [], searches: [] }));

    // ---- 2. normalizeSearches ----
    const norm = normalizeSearches([
      { id: 'sq_1', name: 'Good', query: 'type:pc' },
      { id: 'sq_2', name: '', query: 'type:pc' },
      { id: 'sq_3', name: 'No query', query: '   ' },
      'a string', null, [1, 2], 42,
      { id: 'sq_4', name: 'GOOD', query: 'type:switch' },
      { name: 'Minted', query: 'status:planned' },
      { id: 'sq_1', name: 'Same id', query: 'type:ap' }
    ]);
    ok('damaged entries are dropped (no name, no query, not a record, a duplicate name in another case)',
       show(norm.map((s) => s.name)) === show(['Good', 'Minted', 'Same id']), show(norm.map((s) => s.name)));
    ok('a missing id is minted as sq_…', /^sq_/.test(norm[1].id));
    ok('a repeated id is reminted, the first keeps it', norm[0].id === 'sq_1' && norm[2].id !== 'sq_1' && /^sq_/.test(norm[2].id));
    ok('minted ids are the first free sq_<n>, never one another search has', show(norm.map((s) => s.id)) === show(['sq_1', 'sq_2', 'sq_3']), show(norm.map((s) => s.id)));
    const handA = normalizeSearches([{ name: 'PCs', query: 'type:pc' }, { name: 'APs', query: 'type:ap' }]);
    const handB = normalizeSearches([{ name: 'PCs', query: 'type:pc' }, { name: 'APs', query: 'type:ap' }]);
    ok('the same id-less searches read twice get the same ids', show(handA) === show(handB), show([handA, handB]));
    ok('id first in the record, as in the file', Object.keys(handA[0])[0] === 'id');
    const many = normalizeSearches(Array.from({ length: 40 }, (_, i) => ({ id: `sq_${i}`, name: `S${i}`, query: 'type:pc' })));
    ok('more than SEARCH_MAX (30) are cut to 30, the first kept', SEARCH_MAX === 30 && many.length === 30 && many[29].name === 'S29');
    const cleaned = normalizeSearches([{ id: 'sq_c', name: 'Cols', query: 'type:pc',
      columns: ['name', 'ifaces', 'ifaces', '1bad', 'has space', 7, 'x:c1', ...Array.from({ length: 30 }, (_, i) => `k${i}`)] }])[0];
    ok('columns: name never stored, a repeat or a bad key dropped, at most 20',
       cleaned.columns.length === 20 && cleaned.columns[0] === 'ifaces' && cleaned.columns[1] === 'x:c1' && !cleaned.columns.includes('name'), show(cleaned.columns));
    ok('columns that clean to none are left out', !('columns' in normalizeSearches([{ id: 'sq_c', name: 'C', query: 'q', columns: ['name', ''] }])[0]));
    const flags = normalizeSearches([
      { id: 'sq_d', name: 'Desc alone', query: 'type:pc', desc: true, print: 'yes' },
      { id: 'sq_e', name: 'Sorted', query: 'type:pc', sort: 'ip', desc: true, print: true },
      { id: 'sq_f', name: 'Bad sort', query: 'type:pc', sort: '9x', desc: true, print: false }]);
    ok('desc is kept only with a sort, print only when true', show(flags.map((s) => [s.sort, s.desc, s.print])) === show([[undefined, undefined, undefined], ['ip', true, true], [undefined, undefined, undefined]]),
       show(flags));
    const odd = normalizeSearches([
      { id: 'sq_g', name: '  Spaced\tname  ', query: '  zzz:what  ' },
      { id: 'sq_h', name: 'Too long', query: 'x'.repeat(501) },
      { id: 'sq_i', name: 'Just fits', query: 'x'.repeat(500) },
      { id: 'sq_j', name: 'N'.repeat(80), query: 'type:pc' }]);
    ok('a query that does not parse is kept as typed but trimmed', odd[0].query === 'zzz:what' && parseQuery(odd[0].query).errors.length > 0);
    ok('the name is one line, its spaces folded', odd[0].name === 'Spaced name');
    ok('a query over 500 characters is dropped, not cut; 500 is kept', !odd.some((s) => s.name === 'Too long') && odd.some((s) => s.name === 'Just fits'));
    ok('a long name is cut to 60', odd[odd.length - 1].name.length === 60);
    const given = [{ id: 'sq_1', name: 'Good', query: 'type:pc', columns: ['name', 'ip'] }];
    const givenText = show(given);
    normalizeSearches(given);
    ok('normalizeSearches mutates nothing it is given', show(given) === givenText);
    ok('makeSearch mints an id and reads through the fields', (() => { const s = makeSearch({ name: ' New ', query: 'type:pc', print: true }); return /^sq_/.test(s.id) && s.name === 'New' && s.print === true; })());

    // ---- 3. normalizeSearchRefs and deleteCustomColumn ----
    open({ columns: [{ id: 'c1', name: 'User' }, { id: 'c2', name: 'Cost centre' }],
      searches: [{ id: 'sq_r', name: 'Refs', query: 'type:pc', columns: ['x:c9', 'x:c1', 'futureKey', 'x:c2'], sort: 'x:c9', desc: true },
        { id: 'sq_s', name: 'Only gone', query: 'type:pc', columns: ['x:c9'], sort: 'x:c2', desc: true }] });
    ok('on load: a gone custom column dropped from columns and sort (and desc), an unknown Topo key and live ones kept',
       show(state.searches[0]) === show({ id: 'sq_r', name: 'Refs', query: 'type:pc', columns: ['x:c1', 'futureKey', 'x:c2'] }), show(state.searches[0]));
    ok('a search left with no columns has none (the table\'s), its live sort kept',
       show(state.searches[1]) === show({ id: 'sq_s', name: 'Only gone', query: 'type:pc', sort: 'x:c2', desc: true }), show(state.searches[1]));
    const before = show(serializeDoc());
    await deleteCustomColumn('c2');
    ok('deleteCustomColumn strips x:<id> from every search\'s columns and sort',
       show(state.searches.map((s) => [s.columns, s.sort, s.desc])) === show([[['x:c1', 'futureKey'], undefined, undefined], [undefined, undefined, undefined]]),
       show(state.searches));
    ok('and the column is gone in the same step', !customColumnById('c2'));
    undo();
    ok('one undo puts the column and both searches back', show(serializeDoc()) === before);
    redo();

    // ---- 4. The held-state copies ----
    open({ columns: [{ id: 'c1', name: 'User' }], searches: [cloneData(cams)] });
    const live = show(state.searches);
    const other = { ...base(), searches: [{ id: 'sq_o1', name: 'Other site', query: 'type:nas' }] };
    const canon = canonicalDoc(cloneData(other));
    ok('canonicalDoc keeps a card\'s searches', show(canon.searches) === show(other.searches));
    ok('and hands the live searches back', show(state.searches) === live);
    const seen = withDoc(cloneData(other), () => show(state.searches));
    ok('withDoc lends the card\'s searches to its function', seen === show(other.searches));
    ok('and hands the live searches back', show(state.searches) === live);
    const none = withDoc({ nodes: [], links: [] }, () => state.searches.length);
    ok('a card with no searches has none inside withDoc, not the open network\'s', none === 0 && show(state.searches) === live);
    const rendered = await withDocRendered(cloneData(other), () => show(state.searches));
    ok('withDocRendered lends the card\'s searches', rendered === show(other.searches));
    ok('and hands the live searches back', show(state.searches) === live);
    const liveRef = state.searches;
    const lent = [{ id: 'sq_l', name: 'Lent', query: 'type:pc' }];
    const realRun = window.runDiagnosis;
    let during = null;
    window.runDiagnosis = function () { during = state.searches; return realRun.apply(this, arguments); };
    try { diagnoseDoc({ nodes: [], links: [], searches: lent }); } finally { window.runDiagnosis = realRun; }
    ok('diagnoseDoc lends the document\'s searches while it runs', during === lent);
    ok('diagnoseDoc hands the live searches back', state.searches === liveRef && show(state.searches) === live);
    const s = csvSheet(csvParse('name,ip\nNew PC,10.0.1.50'), true);
    const plan = csvPlan(s, csvAutoMap(s));
    csvFindingsDelta(plan);
    ok('a CSV dry run leaves the live searches as they were', show(state.searches) === live && state.searches !== null);
    const ownList = [{ id: 'sq_w', name: 'Scratch', query: 'type:pc' }];
    csvWrite({ ops: [], newIds: [], touchedIds: [] }, { nodes: [], links: [], searches: ownList });
    ok('csvWrite on a document with its own searches hands the live list back', state.searches === liveRef && show(state.searches) === live);
    const scratch = { nodes: [], links: [] };
    csvWrite({ ops: [], newIds: [], touchedIds: [] }, scratch);
    ok('csvWrite on a document with none gives it a copy, never the live list', Array.isArray(scratch.searches) && scratch.searches !== state.searches && show(scratch.searches) === live);
    const a = serializeDoc();
    const b = { ...cloneData(a), searches: [{ ...cams, name: 'Renamed' }, cloneData(plain)] };
    ok('docChangeCount counts a changed list of searches as one change', docChangeCount(a, b) === 1, String(docChangeCount(a, b)));
    ok('and none when they are the same', docChangeCount(a, cloneData(a)) === 0);
    const hand = { v: DOC_VERSION, nodes: [], links: [], searches: [{ name: 'PCs', query: 'type:pc' }] };
    ok('a hand-written document with id-less searches is the same as itself', docChangeCount(hand, cloneData(hand)) === 0, String(docChangeCount(hand, cloneData(hand))));
    ok('and the same as the card kept from its first opening', docChangeCount(canonicalDoc(cloneData(hand)), cloneData(hand)) === 0);
    ok('the changes since the last back-up do not count them (a view)', docChanges(a, b).total === 0, String(docChanges(a, b).total));

    // ---- 5. One undo step ----
    open({ searches: [cloneData(plain)] });
    const one = show(serializeDoc());
    batch(() => { state.searches.push(makeSearch({ name: 'Added', query: 'type:switch' })); save(); });
    ok('an added search is saved', serializeDoc().searches.length === 2);
    undo();
    ok('and one undo takes it back', show(serializeDoc()) === one);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 0); });
