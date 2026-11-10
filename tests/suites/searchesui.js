// Saved searches, stage 2 (docs/BACKLOG.md feature 6, landing order step 9):
// save and list in the search bar (js/searches.js). What is held here (parts
// 2 and 3 of the spec's searches.js; part 1, the model, is searches.js):
//   1. matching: a saved 'type:camera has:finding' counts the same devices
//      as the box does with that text (queryMapMatches); it still counts in
//      a reduced view, where activeQuery() is null; an accepted finding is
//      not matched by has:finding; a query that is not understood counts 0;
//   2. browser-local terms: was: and has:history are found by the words
//      (negated and quoted too), whether or not this build knows the prefix;
//      a search that uses one cannot be saved (☆ disabled and saying why,
//      searchProblem refusing), and one that came in a file is flagged
//      "This browser only" in the Saved menu;
//   3. ☆ Save search: the last button of #queryTools, after Locate;
//      disabled on an empty box (no card at all) and on a 'Not understood'
//      search; the dialog opens with the box's text as the name and the
//      query, "as the Devices table shows them" and Print ticked; Save adds
//      one search in one undo step and undo takes it back; chosen columns in
//      a chosen order (↑), a sort and Descending are stored; a duplicate
//      name, an empty name and a not-understood query keep Save disabled
//      and say why; 30 is the most;
//   4. the ▾ Saved menu: shown only while there is a saved search, a row
//      each with its live count and 🖨 when it prints; a click on the name
//      sets the box and dims the map; ★ "Update saved search" when the box
//      holds a saved search, and its click edits that one; Edit renames in
//      one undo step; Delete asks (no keeps it), then removes in one step;
//   5. a read-only network refuses the dialog and the delete, but running a
//      saved search still works; none of it shows in #simple; the button
//      speaks the page's language.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const shown = (id) => { const e = el(id); return !!e && getComputedStyle(e).display !== 'none' && !e.closest('.hidden') && e.offsetParent !== null; };
  const undoBtn = () => el('undoBtn');
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let answer = true;
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req.message); return req.kind === 'confirm' ? answer : null; });
  const heldToast = window.showToast;
  const toasts = [];
  const D = (id, type, name, ip) => ({ id, type, name, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const doc = (extra) => ({ v: DOC_VERSION, nodes: [
      D('cam1', 'camera', 'Cam lobby', '10.0.0.20/24'), D('cam2', 'camera', 'Cam door', '10.0.0.20/24'), D('cam3', 'camera', 'Cam yard', '10.0.0.21/24'),
      D('pc1', 'pc', 'Desk A', '10.0.0.30/24'), D('pc2', 'pc', 'Desk B', '10.0.0.31/24')],
    links: [], networks: [{ id: 'n1', cidr: '10.0.0.0/24', name: 'Office' }], ...(extra || {}) });
  const open = (extra) => { replaceDocument(doc(extra), { origin: 'file' }); setView('map'); setQuery(''); };
  const saveBtn = () => el('querySaveBtn');
  const dlgOpen = () => !el('searchDialog').hidden;
  const sorted = (a) => [...a].sort().join(',');
  setLocale('en'); applyStaticI18n();

  try {
    window.showToast = (m) => toasts.push(m);
    open();

    // ---- 1. Matching ----
    setQuery('type:camera has:finding');
    const boxed = sorted(queryMapMatches().nodes);
    ok('a saved search counts the devices the box lights for the same text', sorted(querySavedMatches('type:camera has:finding')) === boxed && boxed.length > 0, `${sorted(querySavedMatches('type:camera has:finding'))} / ${boxed}`);
    ok('queryMatchCount is that number', queryMatchCount('type:camera has:finding') === queryMapMatches().nodes.size);
    setQuery('type:camera has:critical');
    ok('the same for has:critical (the shared address)', sorted(querySavedMatches('type:camera has:critical')) === sorted(queryMapMatches().nodes) && queryMatchCount('type:camera has:critical') === 2,
       `${sorted(querySavedMatches('type:camera has:critical'))} / ${sorted(queryMapMatches().nodes)}`);
    setQuery('');
    state.settings.advanced = false; applyProfile();
    ok('in a reduced view activeQuery() is null', activeQuery() === null);
    ok('and a saved search still counts there', sorted(querySavedMatches('type:camera has:critical')) === 'cam1,cam2', sorted(querySavedMatches('type:camera has:critical')));
    state.settings.advanced = true; applyProfile(); setView('map');
    const dupe = currentDiagnosis().findings.filter((f) => f.nodeIds.includes('cam1'));
    ok('(the duplicate address is a finding)', dupe.length > 0);
    acceptFindings(dupe, 'Known: a spare unit');
    ok('an accepted finding is not matched by has:finding or has:critical', queryMatchCount('type:camera has:critical') === 0
       && !querySavedMatches('type:camera has:finding').includes('cam1') && !querySavedMatches('type:camera has:finding').includes('cam2'), sorted(querySavedMatches('type:camera has:finding')));
    ok('a search that is not understood counts nothing', queryMatchCount('lco:lobby') === 0 && queryMatchCount('') === 0);
    open();

    // ---- 2. Terms only this browser can answer ----
    ok('was: and has:history are found by their words', show(queryLocalTerms('type:pc was:10.0.0.5 -has:history has:finding Was:"Room 2"')) === show(['was:10.0.0.5', '-has:history', 'Was:"Room 2"']),
       show(queryLocalTerms('type:pc was:10.0.0.5 -has:history has:finding Was:"Room 2"')));
    ok('and nothing else is', queryLocalTerms('type:pc has:finding was ip:10.0.0.5 washer').length === 0);
    setQuery('type:pc was:10.0.0.5');
    ok('☆ is disabled on a search with was:', saveBtn().disabled);
    ok('and says why', /reads what this browser remembers/.test(saveBtn().title) && /another computer/.test(saveBtn().title), saveBtn().title);
    ok('searchProblem refuses has:history as well, before anything else', /^has:history reads what this browser remembers/.test(searchProblem({ name: 'X', query: 'has:history' })), searchProblem({ name: 'X', query: 'has:history' }));
    ok('saveSearch refuses it', saveSearch({ name: 'Moved', query: 'was:10.0.0.5' }) === null && state.searches.length === 0);

    // ---- 3. Save search ----
    setQuery('');
    ok('no search, no card, so no ☆', !shown('querySaveBtn'));
    setQuery('type:camera');
    // After it only the phone's ⋯ (M36), which is not shown wider.
    ok('☆ is the card\'s last button, right after Locate', saveBtn().parentElement === el('queryTools') && el('queryLocateBtn').nextElementSibling === saveBtn()
       && saveBtn().nextElementSibling === el('queryMoreMenu') && !el('queryMoreMenu').nextElementSibling && getComputedStyle(el('queryMoreMenu')).display === 'none');
    ok('enabled on a search Topo understands, reading Save search', shown('querySaveBtn') && !saveBtn().disabled && saveBtn().textContent === '☆ Save search', saveBtn().textContent);
    setQuery('lco:lobby');
    ok('disabled on a search that is not understood', saveBtn().disabled);
    ok('no saved search yet: no ▾', !shown('querySavedMenu'));
    setQuery('type:camera');
    const before = show(serializeDoc()), stepsBefore = steps();
    saveBtn().click();
    ok('☆ opens the dialog', dlgOpen() && el('sqTitle').textContent === 'Save search');
    ok('named and filled from the box', el('sqName').value === 'type:camera' && el('sqQuery').value === 'type:camera');
    ok('the columns as the Devices table shows them, and Print ticked', el('sqColsTable').checked && el('sqPrint').checked && el('sqSort').value === '' && el('sqDesc').disabled);
    ok('Name is listed first, fixed', (() => { const first = el('sqColsList').querySelector('li'); const box = first.querySelector('input'); return first.dataset.key === 'name' && box.checked && box.disabled; })());
    el('sqName').value = 'Cameras'; el('sqName').dispatchEvent(new Event('input'));
    el('sqSaveBtn').click();
    ok('Save closes it and adds one search', !dlgOpen() && state.searches.length === 1);
    ok('as typed, printing, with no columns stored', show(serializeDoc().searches.map(({ id, ...s }) => s)) === show([{ name: 'Cameras', query: 'type:camera', print: true }]), show(serializeDoc().searches));
    ok('one undo step', steps() === stepsBefore + 1, `${stepsBefore} -> ${steps()}`);
    ok('★ Update saved search now, the box holding it', saveBtn().textContent === '★ Update saved search' && saveBtn().classList.contains('on') && !saveBtn().disabled, saveBtn().textContent);
    ok('and the ▾ shows', shown('querySavedMenu'));
    undo();
    ok('undo takes it back', show(serializeDoc()) === before && state.searches.length === 0);
    ok('and the ▾ goes, the ☆ is back', !shown('querySavedMenu') && saveBtn().textContent === '☆ Save search');
    redo();

    // Columns, order, sort.
    setQuery('type:pc');
    saveBtn().click();
    el('sqName').value = 'PCs'; el('sqName').dispatchEvent(new Event('input'));
    el('sqColsTable').checked = false; el('sqColsTable').dispatchEvent(new Event('change'));
    const pick = (key, on) => { const b = el('sqColsList').querySelector(`[data-pick="${key}"]`); b.checked = on; b.dispatchEvent(new Event('change', { bubbles: true })); };
    const table = sqTableKeys();
    table.forEach((k) => pick(k, false));
    pick('location', true); pick('ifaces', true);
    ok('unticked from the table, the list is editable', !el('sqColsList').querySelector('[data-pick="location"]').disabled);
    const listed = () => [...el('sqColsList').querySelectorAll('li')].map((li) => li.dataset.key);
    for (let k = 0; k < 40 && listed().indexOf('location') > listed().indexOf('ifaces'); k++) el('sqColsList').querySelector('[data-move="-1"][data-key="location"]').click();
    ok('↑ moves a column up the list', listed().indexOf('location') < listed().indexOf('ifaces'), listed().join());
    const sortTo = (v) => { el('sqSort').value = v; el('sqSort').dispatchEvent(new Event('change')); };
    ok('Sort by offers As listed, Name and the ticked columns', [...el('sqSort').options].map((o) => o.value).join(',') === ',name,location,ifaces',
       [...el('sqSort').options].map((o) => o.value).join(','));
    sortTo('name');
    el('sqDesc').checked = true;
    el('sqPrint').checked = false;
    el('sqSaveBtn').click();
    const pcs = state.searches.find((s) => s.name === 'PCs');
    ok('only the ticked columns are stored, in the chosen order, with the sort', !!pcs && show({ columns: pcs.columns, sort: pcs.sort, desc: pcs.desc, print: pcs.print })
       === show({ columns: ['location', 'ifaces'], sort: 'name', desc: true }), show(pcs));

    // Refusals in the dialog.
    setQuery('type:camera has:finding');
    saveBtn().click();
    el('sqName').value = 'cameras'; el('sqName').dispatchEvent(new Event('input'));
    ok('a name another search has in any case keeps Save disabled, saying so', el('sqSaveBtn').disabled && el('sqProblem').textContent === 'A saved search with this name already exists.', el('sqProblem').textContent);
    el('sqName').value = '  '; el('sqName').dispatchEvent(new Event('input'));
    ok('so does no name', el('sqSaveBtn').disabled && el('sqProblem').textContent === 'A saved search needs a name.');
    el('sqName').value = 'Cameras with findings'; el('sqName').dispatchEvent(new Event('input'));
    el('sqQuery').value = 'type:camera lco:x'; el('sqQuery').dispatchEvent(new Event('input'));
    ok('the search is parsed live: the box\'s Not understood line', el('sqSaveBtn').disabled && !el('sqQueryError').classList.contains('hidden')
       && el('sqQueryError').textContent === 'Not understood, so nothing matches: lco:x', el('sqQueryError').textContent);
    el('sqQuery').value = 'type:camera was:Room'; el('sqQuery').dispatchEvent(new Event('input'));
    ok('and a browser-local term refused there too', el('sqSaveBtn').disabled && /^was:Room reads what this browser remembers/.test(el('sqQueryError').textContent), el('sqQueryError').textContent);
    el('sqQuery').value = 'type:Cámara'; el('sqQuery').dispatchEvent(new Event('input'));
    ok('a type name in another language gets the hint toward its key', !el('sqTypeHint').classList.contains('hidden'));
    el('sqQuery').value = 'type:camera has:finding'; el('sqQuery').dispatchEvent(new Event('input'));
    ok('the key does not, and Save is enabled again', el('sqTypeHint').classList.contains('hidden') && !el('sqSaveBtn').disabled && el('sqProblem').classList.contains('hidden'));
    closeSearchDialog();
    ok('closing saves nothing', state.searches.length === 2);

    // Limits the model would quietly enforce, refused before Save instead.
    const long = 'type:pc ' + Array.from({ length: 80 }, (_, k) => '-desk' + k).join(' ');
    ok('(a search of more than 500 characters that parses)', long.length > SEARCH_QUERY_MAX && !parseQuery(long).errors.length, String(long.length));
    setQuery(long);
    ok('☆ is disabled on a search over 500 characters, saying why', saveBtn().disabled && saveBtn().title === 'A saved search can be at most 500 characters long.', saveBtn().title);
    ok('searchProblem and saveSearch refuse it', searchProblem({ name: 'Long', query: long }) === 'A saved search can be at most 500 characters long.'
       && saveSearch({ name: 'Long', query: long }) === null && state.searches.length === 2, searchProblem({ name: 'Long', query: long }));
    setQuery('type:pc desk');
    saveBtn().click();
    ok('(a new search, not the saved PCs)', el('sqTitle').textContent === 'Save search');
    el('sqName').value = 'Long one'; el('sqName').dispatchEvent(new Event('input'));
    el('sqQuery').value = long; el('sqQuery').dispatchEvent(new Event('input'));
    ok('and the dialog keeps Save disabled on it', el('sqSaveBtn').disabled && el('sqProblem').textContent === 'A saved search can be at most 500 characters long.', el('sqProblem').textContent);
    el('sqQuery').value = 'type:pc desk'; el('sqQuery').dispatchEvent(new Event('input'));
    el('sqColsTable').checked = false; el('sqColsTable').dispatchEvent(new Event('change'));
    ok('(the table shows more than 20 columns, all ticked)', sqTableKeys().length > SEARCH_COLUMNS_MAX && sqColsShown().length === sqTableKeys().length, String(sqTableKeys().length));
    ok('more than 20 ticked keeps Save disabled, saying so', el('sqSaveBtn').disabled && el('sqProblem').textContent === 'A saved search can print at most 20 columns.', el('sqProblem').textContent);
    // Untick down to exactly 20, however many columns the table has.
    sqTableKeys().slice(0, sqTableKeys().length - SEARCH_COLUMNS_MAX).forEach((k) => pick(k, false));
    ok('20 is fine', sqColsShown().length === SEARCH_COLUMNS_MAX && !el('sqSaveBtn').disabled, el('sqProblem').textContent);
    sqTableKeys().forEach((k) => pick(k, false));
    ok('no column ticked (and not as the table) keeps Save disabled, saying so', el('sqSaveBtn').disabled
       && el('sqProblem').textContent === 'Tick at least one column, or As the Devices table shows them.', el('sqProblem').textContent);
    ok('submitting it saves nothing', submitSearchDialog() === null && state.searches.length === 2);
    closeSearchDialog();

    // ---- 4. The Saved menu ----
    setQuery('');
    ok('the ▾ shows with an empty box', shown('querySavedMenu') && !shown('querySaveBtn'));
    el('querySavedBtn').click();
    await tick();
    const rows = () => [...el('querySavedList').querySelectorAll('.sq-row')];
    ok('it opens with a row per search', !el('querySavedPanel').hidden && rows().length === 2, String(rows().length));
    const row = (name) => rows().find((r) => r.querySelector('.sq-name').textContent === name);
    ok('each with its live count', row('Cameras').querySelector('.sq-count').textContent === 'Devices: 3' && row('PCs').querySelector('.sq-count').textContent === 'Devices: 2',
       rows().map((r) => r.querySelector('.sq-count').textContent).join(' | '));
    ok('and 🖨 only on the one that prints', !!row('Cameras').querySelector('.sq-print') && !row('PCs').querySelector('.sq-print'));
    row('Cameras').querySelector('[data-run]').click();
    await tick();
    ok('a click on the name sets the box and runs it', state.query === 'type:camera' && el('queryInput').value === 'type:camera');
    ok('the map dims what it does not match', !!document.querySelector('#layer-nodes .q-dim') && sorted(queryMapMatches().nodes) === 'cam1,cam2,cam3');
    ok('and the menu closes', el('querySavedPanel').hidden);
    ok('★ shows, the box holding a saved search', saveBtn().textContent === '★ Update saved search');
    ok('none of it is an edit', state.searches.length === 2 && steps() === stepsBefore + 2, String(steps()));
    // ★ edits that one.
    saveBtn().click();
    ok('★ opens that search to edit', dlgOpen() && el('sqTitle').textContent === 'Update saved search' && el('sqName').value === 'Cameras' && el('sqQuery').value === 'type:camera');
    closeSearchDialog();
    // Edit from the menu renames it.
    el('querySavedBtn').click(); await tick();
    const camId = state.searches.find((s) => s.name === 'Cameras').id;
    row('Cameras').querySelector('[data-edit]').click();
    ok('Edit opens the dialog on it, the menu closed', dlgOpen() && el('sqName').value === 'Cameras' && el('querySavedPanel').hidden);
    const stepsEdit = steps();
    el('sqName').value = 'All cameras'; el('sqName').dispatchEvent(new Event('input'));
    el('sqSaveBtn').click();
    ok('Edit renames it, keeping its id', !dlgOpen() && searchById(camId).name === 'All cameras' && state.searches.length === 2);
    ok('in one undo step', steps() === stepsEdit + 1);
    undo();
    ok('undo puts the old name back', searchById(camId).name === 'Cameras');
    redo();
    // Delete asks.
    el('querySavedBtn').click(); await tick();
    answer = false; asked.length = 0;
    row('PCs').querySelector('[data-delete]').click();
    await tick(); await tick();
    ok('Delete asks first', asked.length === 1 && asked[0] === 'Delete the saved search PCs?', show(asked));
    ok('and no keeps it', state.searches.some((s) => s.name === 'PCs'));
    answer = true;
    const stepsDel = steps();
    ok('yes removes it', await deleteSearch(state.searches.find((s) => s.name === 'PCs').id) === true && !state.searches.some((s) => s.name === 'PCs'));
    ok('in one undo step', steps() === stepsDel + 1);
    undo();
    ok('and undo brings it back', state.searches.some((s) => s.name === 'PCs'));
    closeSavedMenu();

    // A hand-written file's searches: not understood, browser-local.
    open({ searches: [{ id: 'sq_a', name: 'Odd', query: 'lco:x' }, { id: 'sq_b', name: 'Moved', query: 'was:10.0.0.5' }, { id: 'sq_c', name: 'Cams', query: 'type:camera', print: true }] });
    el('querySavedBtn').click(); await tick();
    ok('a search that is not understood says so in the menu', row('Odd').querySelector('.sq-count').textContent === 'Not understood' && row('Odd').querySelector('.sq-count').classList.contains('err'));
    ok('one that reads this browser\'s history is flagged', row('Moved').querySelector('.sq-count').textContent === 'This browser only' && /another computer/.test(row('Moved').querySelector('.sq-count').title));
    closeSavedMenu();
    // 30 at most.
    open({ searches: Array.from({ length: SEARCH_MAX }, (_, k) => ({ id: `sq_${k + 1}`, name: `S${k + 1}`, query: 'type:pc' })) });
    setQuery('type:camera');
    toasts.length = 0;
    ok('past 30 the dialog does not open, saying why', openSearchDialog(null) === false && !dlgOpen() && toasts[0] === 'A network can keep at most 30 saved searches.', show(toasts));
    ok('and saveSearch refuses', saveSearch({ name: 'One more', query: 'type:camera' }) === null && state.searches.length === SEARCH_MAX);

    // An edit keeps what the dialog cannot offer: a sort on a column it does
    // not list, and stored keys it does not draw, where they stood.
    open({ tableView: { devices: { hidden: ['os'] } }, searches: [
      { id: 'sq_os', name: 'By OS', query: 'type:pc', sort: 'os', desc: true },
      { id: 'sq_fx', name: 'Future', query: 'type:pc', columns: ['zzfuture', 'os', 'yyfuture', 'serial'], sort: 'location' }] });
    const renameTo = (id, name) => { openSearchDialog(id); el('sqName').value = name; el('sqName').dispatchEvent(new Event('input')); el('sqSaveBtn').click(); };
    renameTo('sq_os', 'By OS 2');
    ok('renaming a search sorted by a column the table hides keeps its sort and Descending', show(searchById('sq_os')) === show({ id: 'sq_os', name: 'By OS 2', query: 'type:pc', sort: 'os', desc: true }), show(searchById('sq_os')));
    openSearchDialog('sq_fx');
    ok('a sort on a column it does not print is still offered, by its label', [...el('sqSort').options].some((o) => o.value === 'location' && o.selected && o.textContent === tvLabel(TV_COLS.devices.find((c) => c.key === 'location'))),
       [...el('sqSort').options].map((o) => o.value + '=' + o.textContent).join(','));
    closeSearchDialog();
    renameTo('sq_fx', 'Future 2');
    ok('and unknown stored columns stay where they stood', show(searchById('sq_fx')) === show({ id: 'sq_fx', name: 'Future 2', query: 'type:pc', columns: ['zzfuture', 'os', 'yyfuture', 'serial'], sort: 'location' }), show(searchById('sq_fx')));
    openSearchDialog('sq_fx');
    pick('os', false); pick('ifaces', true);
    el('sqSaveBtn').click();
    ok('also when the ticks change around them', show(searchById('sq_fx').columns) === show(['zzfuture', 'yyfuture', 'serial', 'ifaces']), show(searchById('sq_fx').columns));

    // ---- 5. Read-only, Simple, language ----
    replaceDocument({ ...doc(), v: DOC_VERSION + 1, searches: [{ id: 'sq_r', name: 'Cams', query: 'type:camera' }] }, { origin: 'file' });
    setView('map');
    ok('(a newer file is read-only)', !!state.readOnly);
    setQuery('type:pc');
    toasts.length = 0;
    saveBtn().click();
    ok('a read-only network refuses the dialog', !dlgOpen() && /read-only/.test(toasts[0] || ''), show(toasts));
    ok('and the delete', await deleteSearch('sq_r') === false && state.searches.length === 1);
    ok('running a saved search still works there', runSavedSearch('sq_r') && state.query === 'type:camera');
    setQuery('');
    open({ searches: [{ id: 'sq_c', name: 'Cams', query: 'type:camera' }] });
    setQuery('type:camera');
    state.settings.advanced = false; applyProfile();
    ok('the Simple view shows neither control', !shown('querySavedMenu') && !shown('querySaveBtn') && !shown('queryBar'));
    ok('and opens no dialog', openSearchDialog(null) === false && !dlgOpen());
    state.settings.advanced = true; applyProfile(); setView('map');
    setQuery('type:pc');
    setLocale('es'); applyStaticI18n(); updateQueryBar();
    ok('the button speaks the page\'s language', saveBtn().textContent === '☆ Guardar búsqueda' && el('querySavedBtn').getAttribute('aria-label') === 'Búsquedas guardadas', `${saveBtn().textContent} / ${el('querySavedBtn').getAttribute('aria-label')}`);
    setLocale('ja'); applyStaticI18n(); updateQueryBar();
    setQuery('type:pc was:x');
    ok('Japanese says PC in the refusal', /別のPC/.test(saveBtn().title), saveBtn().title);
    setLocale('en'); applyStaticI18n();
    setQuery('');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.showToast = heldToast;
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 0); });
