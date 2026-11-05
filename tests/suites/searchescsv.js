// Saved searches, stage 4 (docs/BACKLOG.md feature 6, landing order step 9):
// searches.csv out and back in. Part 5 of the spec's searches.js. Held here:
//   1. the export: listed only once a search exists; every SEARCH_FIELDS
//      column under its csv name; columns as Topo keys and custom columns
//      by name joined by '; ', a custom name holding ';' (or reading back as
//      another column) as its x:<id> key; descending only beside a sort,
//      yes/no; a query that would start a formula goes out guarded and comes
//      back as typed;
//   2. read back over itself it changes nothing (an unknown Topo key and a
//      not-understood query the search already keeps included); into a
//      blank map it recreates the searches by id, custom columns found by
//      name under their new ids, in one undo step;
//   3. the rows: by name a row updates its query; Topo headings in English
//      and in the page's language are tokens; yes/no clears; a new row needs
//      a name and a search; an unknown column token, a not-understood or
//      browser-local query, a name another search still has once the whole
//      sheet is read (a swap goes), two rows on one search (two new ones
//      under one unused id too) are conflicts on their row; past 30 is
//      refused;
//   4. the sheet: found by its search_id heading (or name and query with
//      nothing but searches.csv's headings), a device sheet's Query or
//      Columns heading never mapped to a search, a sheet that mixes them
//      refused; the review's line; every template's searches round-trip.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const el = (id) => document.getElementById(id);
  setLocale('en');
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
  const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
  const statuses = (plan) => plan.rows.map((r) => r.status).join();
  const whys = (plan) => plan.rows.map((r) => r.why).join(' | ');
  const pc = (id, name, ip) => ({ id, type: 'pc', name, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const columns = [{ id: 'c1', name: 'On UPS', kind: 'yesno' }, { id: 'c2', name: 'Owner' }, { id: 'c3', name: 'Floor; room' }, { id: 'c4', name: 'serial' }];
  const searches = [
    { id: 'sq_pcs', name: 'Office PCs', query: 'type:pc', columns: ['ifaces', 'type', 'x:c1', 'x:c3'], sort: 'x:c2', desc: true, print: true },
    { id: 'sq_neg', name: 'Not PCs', query: '-type:pc' },
    { id: 'sq_ser', name: 'Serials', query: 'has:ip', columns: ['serial', 'x:c4'], sort: 'name' }
  ];
  const doc = (list, cols) => ({ v: DOC_VERSION, columns: cols || columns, networks: [{ id: 'n1', cidr: '10.0.1.0/24' }],
    nodes: [pc('a', 'Alpha', '10.0.1.5/24'), pc('b', 'Bravo', '10.0.1.6/24')], links: [], searches: list });
  const open = (list, cols) => replaceDocument(cloneData(doc(list, cols)), { origin: 'file' });

  try {
    // ---- 1. The export ----
    open([]);
    ok('no saved search, no searches.csv', !CSV_SHEETS.find((s) => s.key === 'searches').shown());
    open(searches);
    ok('listed once there is one, labelled Saved searches', CSV_SHEETS.find((s) => s.key === 'searches').shown() && csvSheetLabel(CSV_SHEETS.find((s) => s.key === 'searches')) === 'Saved searches');
    const sh = csvSearchesSheet();
    ok('every field under its csv name', sh.headers.join() === 'search_id,name,query,columns,sort,descending,in_report', sh.headers.join());
    ok('columns as keys and custom names, a name with ; as its key; sort as a name; yes/no',
       show(sh.rows[0]) === show(['sq_pcs', 'Office PCs', 'type:pc', 'ifaces; type; On UPS; x:c3', 'Owner', 'yes', 'yes']), show(sh.rows[0]));
    ok('no columns and no sort: blank, descending blank, not printed: no', show(sh.rows[1]) === show(['sq_neg', 'Not PCs', '-type:pc', '', '', '', 'no']), show(sh.rows[1]));
    ok('a custom name that reads back as Topo\'s column goes by its key', sh.rows[2][3] === 'serial; x:c4' && sh.rows[2][4] === 'name' && sh.rows[2][5] === 'no', show(sh.rows[2]));
    const text = csvText(sh);
    ok('the query that starts a formula goes out guarded', text.includes(",'-type:pc,"), text);
    ok('and comes back as typed', sheetOf(text).rows[1][2] === '-type:pc');
    open([{ id: 'sq_eq', name: 'Eq', query: '=type:pc' }]);
    {
      const eqText = csvText(csvSearchesSheet());
      ok('a query starting with = goes out guarded too', eqText.includes(",'=type:pc,"), eqText);
      ok('and comes back as typed, over itself unchanged', sheetOf(eqText).rows[0][2] === '=type:pc' && !planOf(eqText).ops.length);
    }
    open(searches);

    // ---- 2. Round trips ----
    let plan = planOf(text);
    ok('read as a sheet of saved searches', plan.kind === 'searches' && show(csvAutoMap(sheetOf(text))) === show(['sq:id', 'sq:name', 'sq:query', 'sq:columns', 'sq:sort', 'sq:desc', 'sq:print']), plan.kind + ' ' + csvAutoMap(sheetOf(text)).join());
    ok('imported over itself it changes nothing', statuses(plan) === 'same,same,same' && !plan.ops.length, statuses(plan) + ' ' + whys(plan));
    // A key this build draws no column for, and a query it does not parse:
    // kept by the search, so they read back as themselves.
    open([{ id: 'sq_new', name: 'Future', query: 'zzz:1', columns: ['futureCol', 'type'], sort: 'futureCol' }]);
    plan = planOf(csvText(csvSearchesSheet()));
    ok('an unknown key and a not-understood query the search keeps read back unchanged', statuses(plan) === 'same' && !plan.ops.length, statuses(plan) + ' ' + whys(plan));
    open(searches);
    const want = show(serializeSearches(state.searches).map((s) => ({ ...s, columns: (s.columns || []).map((k) => (k === 'x:c1' ? 'UPS' : k)), sort: s.sort === 'x:c2' ? 'OWN' : s.sort })));
    // A blank map whose columns have other ids: found by name. Floor; room
    // keeps its id, since it went out as x:c3; 'serial' too (x:c4).
    open([], [{ id: 'c7', name: 'on ups', kind: 'yesno' }, { id: 'c8', name: 'Owner' }, { id: 'c3', name: 'Floor; room' }, { id: 'c4', name: 'serial' }]);
    const steps = _undoStack.length;
    plan = planOf(text);
    ok('into a blank map: every row a new search', statuses(plan) === 'add,add,add', statuses(plan) + ' ' + whys(plan));
    applyCsvPlan(plan);
    const got = show(serializeSearches(state.searches).map((s) => ({ ...s, columns: (s.columns || []).map((k) => (k === 'x:c7' ? 'UPS' : k)), sort: s.sort === 'x:c8' ? 'OWN' : s.sort })));
    ok('recreated by id, in order, custom columns by name under their new ids', got === want, got + ' vs ' + want);
    ok('in one undo step', _undoStack.length === steps + 1);
    ok('the ▾ Saved menu shows them', !el('querySavedMenu').classList.contains('hidden'));
    undo();
    ok('undo takes them out again', !(state.searches || []).length);

    // A blank map with no column under the ids the sheet gave as x:<id>
    // (Floor; room, serial): those rows name no column, a conflict that
    // names the key; the row whose custom columns went by name still goes.
    open([], [{ id: 'c7', name: 'on ups', kind: 'yesno' }, { id: 'c8', name: 'Owner' }]);
    plan = planOf(text);
    ok('into a blank map lacking an x:<id> column: that row is a conflict naming it', statuses(plan) === 'conflict,add,conflict'
       && /No column is called x:c3\./.test(plan.rows[0].why) && /No column is called x:c4\./.test(plan.rows[2].why), statuses(plan) + ' ' + whys(plan));

    // ---- 3. Rows ----
    open(searches);
    plan = planOf('name,query,search_id\nOFFICE PCS,type:pc status:active,\n');
    ok('found by name in any case, a row updates the query', statuses(plan) === 'change' && plan.rows[0].sqId === 'sq_pcs'
       && plan.rows[0].changes.map((c) => c.after).join() === 'OFFICE PCS,type:pc status:active', show(plan.rows[0]));
    applyCsvPlan(plan);
    ok('applied (the name as the row writes it), the rest kept', searchById('sq_pcs').name === 'OFFICE PCS' && searchById('sq_pcs').query === 'type:pc status:active' && searchById('sq_pcs').desc === true && searchById('sq_pcs').columns.length === 4);
    undo();
    const serialLabel = tvLabel(tvDeviceColumn('serial'));
    plan = planOf(`search_id,columns,sort,descending,in_report\nsq_neg,Type; ${serialLabel}; owner,Type,no,yes\n`);
    applyCsvPlan(plan);
    ok('Topo headings and a custom name in any case are tokens', show(searchById('sq_neg').columns) === show(['type', 'serial', 'x:c2']) && searchById('sq_neg').sort === 'type' && searchById('sq_neg').print === true,
       show(searchById('sq_neg')) + ' ' + whys(plan));
    undo();
    applyCsvPlan(planOf('search_id,descending,in_report\nsq_pcs,no,no\n'));
    ok('no clears descending and the print mark', !('desc' in searchById('sq_pcs')) && !('print' in searchById('sq_pcs')) && searchById('sq_pcs').sort === 'x:c2', show(searchById('sq_pcs')));
    undo();
    plan = planOf('search_id,sort\nsq_pcs,\n');
    ok('a blank cell changes nothing', !plan.ops.length);
    plan = planOf('search_id,descending\nsq_neg,yes\n');
    ok('descending with no sort is none: no change', statuses(plan) === 'same' && !plan.ops.length, statuses(plan));
    plan = planOf('search_id,name,query\nsq_x,Cameras,\n,,type:camera\n');
    ok('a new row needs a name and a search', statuses(plan) === 'conflict,conflict' && /needs a name and a search/.test(plan.rows[0].why) && /needs a name and a search/.test(plan.rows[1].why), whys(plan));
    plan = planOf('search_id,name,query,columns,sort\n,Cams,type:camera,type; Nowhere; ups,\n,Cams2,type:camera,,Elsewhere\n');
    ok('an unknown column token is a conflict that names it', statuses(plan) === 'conflict,conflict' && /No column is called Nowhere\./.test(plan.rows[0].why) && /No column is called Elsewhere\./.test(plan.rows[1].why), whys(plan));
    plan = planOf('search_id,name,query\n,Odd,zzz:1\n,Mine,was:10.0.1.5\nsq_neg,,has:history\n');
    ok('a not-understood query is refused on its row', plan.rows[0].status === 'conflict' && plan.rows[0].why === 'zzz:1 is not understood: zzz:1', plan.rows[0].why);
    ok('a browser-local one too (was:, has:history), new or changed', plan.rows[1].status === 'conflict' && /reads what this browser remembers/.test(plan.rows[1].why)
       && plan.rows[2].status === 'conflict' && /has:history/.test(plan.rows[2].why), whys(plan));
    plan = planOf('search_id,name\nsq_neg,office PCS\n');
    ok('a name another search has is a conflict', statuses(plan) === 'conflict' && /already exists/.test(plan.rows[0].why), whys(plan));
    plan = planOf('search_id,name,query\nsq_neg,Swap,has:ip\nsq_neg,Other,type:pc\n,New one,type:pc\n,new ONE,type:router\n');
    ok('two rows on one search, or two new ones by one name: the later is a conflict', statuses(plan) === 'change,conflict,add,conflict' && /Another row is this saved search/.test(plan.rows[1].why) && /Another row/.test(plan.rows[3].why), statuses(plan) + ' ' + whys(plan));
    // Two new rows under one id no search here has: one search, never two
    // records under that id.
    plan = planOf('search_id,name,query\nsq_9,Cameras,type:camera\nsq_9,Printers,type:printer\n');
    ok('two new rows by one unused search_id: the later is a conflict', statuses(plan) === 'add,conflict' && /Another row is this saved search/.test(plan.rows[1].why)
       && plan.ops.length === 1 && plan.counts.add === 1, statuses(plan) + ' ' + whys(plan));
    applyCsvPlan(plan);
    ok('applied: one search under that id', state.searches.filter((x) => x.id === 'sq_9').length === 1 && searchById('sq_9').name === 'Cameras');
    undo();
    // Names are checked against what the whole sheet leaves: a swap goes,
    // and a name one row frees another row can take.
    plan = planOf('search_id,name\nsq_pcs,Not PCs\nsq_neg,Office PCs\n');
    ok('two searches swap names in one sheet', statuses(plan) === 'change,change', statuses(plan) + ' ' + whys(plan));
    applyCsvPlan(plan);
    ok('applied: the names swapped', searchById('sq_pcs').name === 'Not PCs' && searchById('sq_neg').name === 'Office PCs');
    undo();
    plan = planOf('search_id,name,query\nsq_pcs,Desks,\n,Office PCs,type:router\n');
    ok('a renamed search\'s old name is free for a new row', statuses(plan) === 'change,add' && plan.rows[1].name === 'Office PCs', statuses(plan) + ' ' + whys(plan));
    plan = planOf('search_id,name\nsq_pcs,Not PCs\nsq_neg,Serials\n');
    ok('a name the sheet still leaves to another search: each row that takes it is a conflict', statuses(plan) === 'conflict,conflict' && /already exists/.test(plan.rows[0].why) && /already exists/.test(plan.rows[1].why) && !plan.ops.length, statuses(plan) + ' ' + whys(plan));
    plan = planOf('search_id,name\nsq_pcs,Same\nsq_neg,same\n');
    ok('two rows renaming to one name: the later is a conflict', statuses(plan) === 'change,conflict' && /already exists/.test(plan.rows[1].why) && plan.ops.length === 1, statuses(plan) + ' ' + whys(plan));
    plan = planOf('search_id,name,query,columns\n,Wide,type:pc,' + TV_COLS.devices.filter((c) => c.key !== 'name').slice(0, 21).map((c) => c.key).join('; ') + '\n');
    ok('more than 20 columns is refused', statuses(plan) === 'conflict' && /at most 20 columns/.test(plan.rows[0].why), whys(plan));
    plan = planOf('search_id,name,query\n,Long,' + 'a'.repeat(501) + '\n');
    ok('a search over 500 characters is refused', statuses(plan) === 'conflict' && /at most 500 characters/.test(plan.rows[0].why), whys(plan));
    open(Array.from({ length: 28 }, (_, i) => ({ id: `sq_${i}`, name: `S${i}`, query: 'type:pc' })));
    plan = planOf('name,query,search_id\nA,type:pc,\nB,type:pc,\nC,type:pc,\nS3,type:router,\n');
    ok('past 30 is refused, an update still goes', statuses(plan) === 'add,add,conflict,change' && /at most 30 saved searches/.test(plan.rows[2].why), statuses(plan) + ' ' + whys(plan));
    applyCsvPlan(plan);
    ok('applied: 30 searches', state.searches.length === 30 && searchById('sq_3').query === 'type:router');

    // ---- 4. The sheet ----
    open(searches);
    let s = sheetOf('search_id,name,query\nsq_pcs,Office PCs,type:pc\n');
    ok('a search_id heading makes a sheet of saved searches', csvSheetFamily(s) === 'sqdef' && csvSheetKind(csvAutoMap(s)) === 'searches');
    s = sheetOf('Hostname,IP Address,Query,Columns,Sort\nPC-9,10.0.1.9,abc,def,ghi\n');
    ok('a device sheet\'s Query, Columns or Sort heading is never a saved search\'s', !csvAutoMap(s).some((k) => /^sq:/.test(k)) && csvSheetKind(csvAutoMap(s)) === 'devices', csvAutoMap(s).join());
    // Without a search_id column: a name and a query and nothing a device
    // has is a sheet of saved searches too, never a device per row.
    s = sheetOf('name,query\nCameras,type:camera\n');
    ok('name and query alone make a sheet of saved searches', csvSheetFamily(s) === 'sqdef' && csvSheetKind(csvAutoMap(s)) === 'searches', csvAutoMap(s).join());
    plan = planOf('Name,Query,Columns,Sort\nCameras,type:camera,type,name\n');
    ok('and its rows are new searches, no device made', statuses(plan) === 'add' && plan.kind === 'searches' && plan.ops.every((o) => o.sq), statuses(plan) + ' ' + whys(plan));
    s = sheetOf('name,ip,query\nPC-9,10.0.1.9,abc\n');
    ok('a query column beside a device\'s is still a device sheet', csvSheetFamily(s) !== 'sqdef' && csvSheetKind(csvAutoMap(s)) === 'devices', csvAutoMap(s).join());
    plan = csvPlan(sheetOf('search_id,name\nsq_pcs,PCs\n'), ['sq:id', 'name']);
    ok('a sheet that mixes them is refused', csvSheetKind(['sq:id', 'name']) === 'mixed-searches' && plan.errors.length === 1 && /A sheet of saved searches/.test(plan.errors[0]), plan.errors.join());
    // The review: the line and the mapping's own group.
    {
      openCsvDialog('import');
      el('csvText').value = text;
      _csv.headings = null; _csv.mode = null; _csv.step = 'map'; _csv.chosen.clear();
      csvReparse(); renderCsvDialog();
      ok('the review says rows of saved searches', /Rows of saved searches: 3/.test(el('csvKind').textContent), el('csvKind').textContent);
      ok('the mapping lists a Saved searches group', [...el('csvMap').querySelectorAll('optgroup')].some((g) => g.label === 'Saved searches'));
      closeCsvDialog();
    }
    // Every template, with saved searches over its own columns: out and back
    // into the template with none gives them back field for field.
    const bad = [];
    Object.keys(templatesData).forEach((key) => {
      const d = cloneData(templatesData[key]);
      // No template has custom columns of its own: give each three, one by
      // name, one whose name holds ';' and one that reads as Topo's, so every
      // way a custom column goes out is read back.
      d.columns = (d.columns || []).concat([{ id: 'ct1', name: 'Owner' }, { id: 'ct2', name: 'Floor; room' }, { id: 'ct3', name: 'serial' }]);
      const cols = d.columns.map((c) => `x:${c.id}`);
      d.searches = [
        { id: 'sq_t1', name: 'Every device', query: 'has:ip', print: true },
        { id: 'sq_t2', name: 'Kinds', query: '-type:switch', columns: ['type', 'ifaces'].concat(cols.slice(0, 2)), sort: 'type', desc: true },
        { id: 'sq_t3', name: 'Findings', query: 'has:finding', columns: cols.length ? cols : ['location'], sort: cols[0] || 'name' }
      ];
      replaceDocument(cloneData(d), { origin: 'file' });
      const before = show(serializeSearches(state.searches));
      const csv = csvText(csvSearchesSheet());
      const self = planOf(csv);
      d.searches = [];
      replaceDocument(cloneData(d), { origin: 'file' });
      const p = planOf(csv);
      applyCsvPlan(p);
      const after = show(serializeSearches(state.searches));
      if (!/Owner/.test(csv) || !/x:ct2/.test(csv) || !/x:ct3/.test(csv)) bad.push(`${key}: custom columns not written by name and key: ${JSON.stringify(csv)}`);
      if (self.ops.length || p.rows.some((r) => r.status === 'conflict') || after !== before) bad.push(`${key}: ${self.ops.length} ops over itself; ${whys(p)} ${after.slice(0, 120)}`);
    });
    ok('every template\'s saved searches round-trip through searches.csv', !bad.length, bad.slice(0, 2).join(' ; '));

    // Spanish: the review's words translated, the query as typed.
    open(searches);
    setLocale('es');
    ok('the sheet label and the review\'s sentences in Spanish', csvSheetLabel(CSV_SHEETS.find((x) => x.key === 'searches')) === 'Búsquedas guardadas'
       && t(CSV_MIXED_SEARCHES) !== CSV_MIXED_SEARCHES && t('Rows of saved searches: {n}', { n: 2 }) === 'Filas de búsquedas guardadas: 2');
    plan = planOf('search_id,columns,query\nsq_neg,Tipo; Nowhere,type:pc\n');
    ok('a Spanish heading is a token, the refusal in Spanish', /Ninguna columna se llama Nowhere\./.test(plan.rows[0].why) && !/Tipo/.test(plan.rows[0].why), whys(plan));
    plan = planOf('search_id,columns\nsq_neg,Tipo\n');
    ok('a heading in the page\'s language reads as its column', plan.rows[0].status === 'change' && show(plan.ops[0].sq.set.columns) === show(['type']), whys(plan) + show(plan.ops));
    setLocale('en');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 0); });
