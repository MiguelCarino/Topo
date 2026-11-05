// Saved searches, stage 3 (docs/BACKLOG.md feature 6, landing order step 9):
// printed in the technical sheet as their own sections. Part 4 of the spec's
// searches.js. What is held here:
//   1. the section: with a search marked to print, reportHtml has the h2
//      'Saved searches' after Capacity and before Changes, the h3 name, the
//      query in mono, 'Devices: n of total', and a table with exactly the
//      matching devices in the chosen column order; an unmarked one is
//      absent; with no search marked there is no h2;
//   2. the cells: every address (no '+N'), the type in words, a yes/no
//      custom column as Yes/No, NAT as Yes/No, a custom column under its
//      own name;
//   3. the order: 'name' descending reverses, a guest is listed under its
//      host when no sort is set; the table's own sort direction is left as
//      it was;
//   4. the refusals: zero matches prints 'No devices match.', a query not
//      understood prints the muted line and no table, a browser-local term
//      (was:, has:history) prints 'Not printed' and no table, and matches
//      nothing even where its other words would;
//   5. the parts: parts.searches picks exactly the ticked ids (an unmarked
//      one too, a marked one left out), [] prints none, a summary-only
//      report has no section, reportParts defaults to null;
//   6. the dialog: the row lists a tick per search starting from its mark,
//      hides with Technical details, its ticks reach readReportParts, and a
//      binder dialog lists none; nothing is written back;
//   7. Spanish: the heading, the line, the refusals and the type cell
//      translated, the query kept as typed ($ and all); every column heading
//      a search can print carried in every locale; a sort by type or a
//      yes/no column follows the printed words.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const el = (id) => document.getElementById(id);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  setLocale('en');
  const I18N_LOCALES_FOR_TEST = ['es', 'pt-BR', 'ja', 'ru'];
  const pc = (id, name, ips, extra) => ({ id, type: 'pc', name, x: 0, y: 0, interfaces: ips.map((ip, i) => ({ id: `i${i + 1}`, name: `eth${i}`, ip })), ...(extra || {}) });
  const doc = (searches) => ({ v: DOC_VERSION,
    columns: [{ id: 'c1', name: 'On UPS', kind: 'yesno' }, { id: 'c2', name: 'Owner' }],
    networks: [{ id: 'n1', cidr: '10.0.1.0/24', gateway: '10.0.1.1' }],
    nodes: [
      pc('a', 'Alpha', ['10.0.1.5/24', '10.0.1.6/24', '10.0.1.7/24'], { extra: { c1: true, c2: 'Ana' } }),
      pc('b', 'Bravo', ['10.0.1.8/24']),
      { id: 'r', type: 'router', name: 'Edge', x: 0, y: 0, nat: true, interfaces: [{ id: 'i1', name: 'wan', ip: '10.0.1.1/24' }] },
      { id: 'h', type: 'server', name: 'Host', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.20/24' }] },
      { id: 'v', type: 'vm', name: 'Guest VM', x: 0, y: 0, host: 'h', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.21/24' }] }
    ], links: [], searches });
  const pcs = { id: 'sq_pcs', name: 'Office PCs', query: 'type:pc', columns: ['ifaces', 'type', 'x:c1', 'x:c2'], print: true };
  const sectionOf = (html) => { const at = html.indexOf('<h2>Saved searches</h2>'); return at < 0 ? '' : html.slice(at, html.indexOf('<h2>', at + 5)); };
  const namesIn = (html) => [...html.matchAll(/<tr class="dev[^>]*>\s*<td>(?:<span class="muted">↳ <\/span>)?<b>([^<]*)<\/b>/g)].map((m) => m[1]);
  const headsIn = (html) => [...(html.match(/<table class="inv saved-search">[\s\S]*?<\/thead>/) || [''])[0].matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);

  try {
    // ---- 1. The section ----
    replaceDocument(doc([pcs, { id: 'sq_off', name: 'Routers', query: 'type:router' }]), { origin: 'file' });
    const model = reportModel();
    const html = reportHtml(model, null);
    const sec = sectionOf(html);
    ok('a marked search prints under its own h2', !!sec && sec.includes('<h3>Office PCs</h3>'), sec.slice(0, 200));
    ok('after Addressing (and Capacity), before Scope and method', html.indexOf('<h2>Addressing</h2>') < html.indexOf('<h2>Saved searches</h2>')
       && html.indexOf('<h2>Saved searches</h2>') < html.indexOf('<h2>Scope and method</h2>')
       && (!html.includes('<h2>Capacity</h2>') || html.indexOf('<h2>Capacity</h2>') < html.indexOf('<h2>Saved searches</h2>')));
    ok('the query in mono, and how many of how many', sec.includes('Search: <span class="mono">type:pc</span> · Devices: 2 of 5'), (sec.match(/<p class="muted">[^\n]*/) || [])[0]);
    ok('exactly the matching devices', show(namesIn(sec)) === show(['Alpha', 'Bravo']), show(namesIn(sec)));
    ok('Device first, then the chosen columns in their order (a custom one under its own name)',
       show(headsIn(sec)) === show(['Device', 'Interfaces', 'Type', 'On UPS', 'Owner']), show(headsIn(sec)));
    ok('an unmarked search is absent', !sec.includes('Routers'));
    ok('the model says the same', show(model.searches.map((s) => s.id)) === show(['sq_pcs']));

    // ---- 2. The cells ----
    const rowA = model.searches[0].rows.find((r) => r.name === 'Alpha'), rowB = model.searches[0].rows.find((r) => r.name === 'Bravo');
    ok('every address prints, not the table\'s +N', rowA.cells[0] === '10.0.1.5/24, 10.0.1.6/24, 10.0.1.7/24', rowA.cells[0]);
    const tableCell = TV_COLS.devices.find((c) => c.key === 'ifaces').show({ rec: 'node', ref: { nodeId: 'a' }, data: reportDevices()[0] }).text;
    ok('(the table still shows two and +1)', /\+1$/.test(tableCell), tableCell);
    ok('the type in words', rowA.cells[1] === t(typeName('pc')) && rowA.cells[1] === 'Workstation', rowA.cells[1]);
    ok('a yes/no column prints Yes and No', rowA.cells[2] === 'Yes' && rowB.cells[2] === 'No', show([rowA.cells[2], rowB.cells[2]]));
    ok('a text column as typed, a blank one as a dash', rowA.cells[3] === 'Ana' && /<td><span class="muted">—<\/span><\/td>\s*<\/tr>/.test(sec.slice(sec.indexOf('<b>Bravo</b>'))));
    state.searches = [{ id: 'sq_r', name: 'NAT', query: 'type:router', columns: ['nat', 'notes'], print: true }];
    const nat = reportModel().searches[0];
    ok('NAT prints Yes, not a tick', nat.rows[0].cells[0] === 'Yes', show(nat.rows));

    // ---- 3. The order ----
    state.searches = [{ id: 'sq_d', name: 'Desc', query: 'has:ip', columns: ['ifaces'], sort: 'name', desc: true, print: true }];
    const heldDir = _tvSortDir;
    _tvSortDir = 1;
    const desc = reportModel().searches[0];
    ok('sort by name descending reverses', show(desc.rows.map((r) => r.name)) === show(['Host', 'Guest VM', 'Edge', 'Bravo', 'Alpha']), show(desc.rows.map((r) => r.name)));
    ok('and leaves the table\'s own direction alone', _tvSortDir === 1);
    // A blank stays last however the column is turned, with the table's
    // own direction left at ascending (compareRows is given the report's).
    state.searches = [{ id: 'sq_o', name: 'OS', query: 'has:ip', columns: ['os'], sort: 'os', desc: true, print: true }];
    state.nodes.find((n) => n.id === 'a').os = 'Linux';
    state.nodes.find((n) => n.id === 'b').os = 'Windows';
    const osDesc = reportModel().searches[0];
    ok('descending, a blank still comes last', show(osDesc.rows.map((r) => r.name).slice(0, 2)) === show(['Bravo', 'Alpha']), show(osDesc.rows.map((r) => [r.name, r.cells[0]])));
    delete state.nodes.find((n) => n.id === 'a').os; delete state.nodes.find((n) => n.id === 'b').os;
    _tvSortDir = heldDir;
    state.searches = [{ id: 'sq_ip', name: 'By address', query: 'has:ip', columns: ['ifaces'], sort: 'ifaces', print: true }];
    const byIp = reportModel().searches[0];
    ok('sort by address counts addresses as numbers', show(byIp.rows.map((r) => r.name)) === show(['Edge', 'Alpha', 'Bravo', 'Host', 'Guest VM']), show(byIp.rows.map((r) => r.name)));
    state.searches = [{ id: 'sq_all', name: 'All', query: 'has:ip', columns: ['ifaces'], print: true }];
    const listed = reportModel().searches[0];
    ok('as listed: document order, a guest under its host', show(listed.rows.map((r) => [r.name, r.guest])) === show([['Alpha', 0], ['Bravo', 0], ['Edge', 0], ['Host', 0], ['Guest VM', 1]]), show(listed.rows.map((r) => [r.name, r.guest])));
    ok('the guest is stepped in on the sheet', /class="dev guest" style="--guest:1">\s*<td><span class="muted">↳ <\/span><b>Guest VM/.test(searchesSection([listed])));
    state.searches = [{ id: 'sq_t', name: 'As the table', query: 'type:pc', print: true }];
    const asTable = reportModel().searches[0];
    ok('no columns stored: the Devices table\'s own columns, Name left out',
       asTable.columns.length === tvDevicesArranged().filter((c) => c.key !== 'name' && (!c.when || c.when())).length && asTable.columns[0].label === 'Type', show(asTable.columns.map((c) => c.label)));
    state.searches = [{ id: 'sq_u', name: 'Unknown key', query: 'type:pc', columns: ['poeBudget', 'ifaces', 'x:gone'], print: true }];
    ok('a key this build cannot draw is skipped', show(reportModel().searches[0].columns.map((c) => c.label)) === show(['Interfaces']));

    // ---- 4. The refusals ----
    state.searches = [
      { id: 'sq_z', name: 'Nothing', query: 'type:camera', print: true },
      { id: 'sq_e', name: 'Garbled', query: 'lco:x', print: true },
      { id: 'sq_w', name: 'Was here', query: 'type:pc was:10.0.1.5', print: true },
      { id: 'sq_h', name: 'Has history', query: 'has:history', print: true }
    ];
    const refused = reportModel();
    const rsec = sectionOf(reportHtml(refused, null));
    const block = (name) => { const at = rsec.indexOf(`<h3>${name}</h3>`); const next = rsec.indexOf('<h3>', at + 4); return at < 0 ? '' : rsec.slice(at, next < 0 ? undefined : next); };
    ok('zero matches prints "No devices match."', block('Nothing').includes('No devices match.') && !block('Nothing').includes('<table') && block('Nothing').includes('Devices: 0 of 5'));
    ok('a query not understood prints the muted line and no table', block('Garbled').includes('Not understood, so nothing matches: lco:x') && !block('Garbled').includes('<table'));
    ok('a browser-local term is refused: "Not printed", no table', block('Was here').includes('Not printed: was:10.0.1.5 reads what this browser remembers')
       && !block('Was here').includes('<table') && block('Has history').includes('Not printed: has:history'));
    ok('and matches nothing, even where its other words would', refused.searches.filter((s) => s.local).every((s) => !s.rows.length && s.local));

    // ---- 5. The parts ----
    replaceDocument(doc([pcs, { id: 'sq_off', name: 'Routers', query: 'type:router' }]), { origin: 'file' });
    ok('reportParts defaults the searches to null (every marked one)', reportParts().searches === null && reportParts({}).searches === null);
    ok('and keeps a list it is given', show(reportParts({ searches: ['sq_off', 3] }).searches) === show(['sq_off']));
    const picked = reportModel(null, ['sq_off']);
    ok('parts.searches picks exactly the ticked ids', show(picked.searches.map((s) => s.id)) === show(['sq_off']));
    ok('an empty list prints none, and no heading', reportModel(null, []).searches.length === 0 && !reportHtml(reportModel(null, []), null).includes('<h2>Saved searches</h2>'));
    const built = await buildSiteReport(null, { summary: true, technical: false });
    ok('a summary-only report has no Saved searches section', !built.html.includes('Saved searches') && !built.html.includes('Office PCs'));
    const both = await buildSiteReport(null, { summary: true, technical: true, searches: ['sq_off'] });
    ok('a site report built with ticks prints those', both.html.includes('<h3>Routers</h3>') && !both.html.includes('<h3>Office PCs</h3>'));

    // ---- 6. The dialog ----
    const before = show(serializeDoc());
    openReportDialog('site');
    const ticks = () => [...document.querySelectorAll('#reportSearchesList [data-search]')];
    ok('a tick per search, each from its print mark', show(ticks().map((cb) => [cb.dataset.search, cb.checked])) === show([['sq_pcs', true], ['sq_off', false]]));
    ok('the row shows with Technical details', !el('reportSearchesRow').classList.contains('hidden'));
    ok('readReportParts reads the ticks', show(readReportParts().searches) === show(['sq_pcs']));
    ticks()[1].checked = true; ticks()[0].checked = false;
    ok('ticking changes what this report prints', show(readReportParts().searches) === show(['sq_off']));
    el('reportTechnical').checked = false; el('reportTechnical').dispatchEvent(new Event('change'));
    ok('unticking Technical details hides it', el('reportSearchesRow').classList.contains('hidden'));
    el('reportTechnical').checked = true; el('reportTechnical').dispatchEvent(new Event('change'));
    closeReportDialog();
    ok('nothing is written back to the searches', show(serializeDoc()) === before);
    openReportDialog('site');
    ok('opened again, the ticks start from the marks again', show(ticks().map((cb) => cb.checked)) === show([true, false]));
    closeReportDialog();
    state.searches.push({ id: 'sq_wl', name: 'Was local', query: 'was:10.0.1.5' });
    openReportDialog('site');
    ticks()[0].checked = false; ticks()[1].checked = true;
    setLocale('es'); applyLocale();
    const noteOf = () => (el('reportSearchesList').querySelectorAll('.dlg-search')[2] || {}).textContent || '';
    ok('a language switch while open rewords the notes', noteOf().includes(t('This browser only')) && t('This browser only') !== 'This browser only', noteOf());
    ok('and keeps the ticks as the visitor left them', show(ticks().map((cb) => cb.checked)) === show([false, true, false]), show(ticks().map((cb) => cb.checked)));
    setLocale('en'); applyLocale();
    closeReportDialog();
    state.searches.pop();
    replaceDocument(doc([]), { origin: 'file' });
    openReportDialog('site');
    ok('a network with none has no row', el('reportSearchesRow').classList.contains('hidden') && readReportParts().searches === null);
    closeReportDialog();
    replaceDocument(doc([pcs, { id: 'sq_off', name: 'Routers', query: 'type:router' }]), { origin: 'file' });
    openReportDialog('binder');
    ok('a binder dialog lists no ticks: each site prints its own marked ones',
       ticks().length === 0 && el('reportSearchesRow').classList.contains('hidden') && readReportParts().searches === null,
       show([ticks().length, el('reportSearchesRow').className, readReportParts().searches]));
    closeReportDialog();

    // ---- 7. Spanish ----
    replaceDocument(doc([pcs, { id: 'sq_w', name: 'Was here', query: 'was:x', print: true }]), { origin: 'file' });
    setLocale('es');
    const es = reportHtml(reportModel(), null);
    ok('the heading and the line in Spanish, the query as typed', es.includes('<h2>Búsquedas guardadas</h2>') && es.includes('Búsqueda: <span class="mono">type:pc</span> · Dispositivos: 2 de 5'));
    ok('the refusal in Spanish', es.includes('No se imprime: was:x'));
    ok('the columns and Yes in Spanish', es.includes('<th>Dispositivo</th>') && es.includes('>Sí<'));
    const esPcs = reportModel().searches[0];
    ok('the type cell in Spanish', esPcs.rows[0].cells[1] === 'Estación de trabajo', show(esPcs.rows[0].cells));
    // Every Topo column a search can print has its heading in every locale.
    const heads = TV_COLS.devices.filter((c) => c.key !== 'name').map((c) => c.label);
    I18N_LOCALES_FOR_TEST.forEach((loc) => {
      const missing = heads.filter((h) => !window.CarinoI18N.has(loc, h));
      ok('every printable column heading translated (' + loc + ')', !missing.length, show(missing));
    });
    setLocale('es');
    state.searches = [{ id: 'sq_p', name: 'Ports', query: 'type:pc', columns: ['ports'], print: true }];
    const portsHtml = reportHtml(reportModel(), null);
    ok('the Allowed Ports heading in Spanish', portsHtml.includes('<th>Puertos permitidos</th>') && !portsHtml.includes('Allowed Ports'));
    // Sorted by a column the report prints in words: in the order the
    // reader sees them, not the English one.
    state.nodes.push({ id: 'p', type: 'printer', name: 'Printer', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.30/24' }] });
    state.searches = [{ id: 'sq_ty', name: 'By type', query: 'has:ip', columns: ['type'], sort: 'type', print: true }];
    const esTypes = reportModel().searches[0].rows.map((r) => r.cells[0]);
    const sorted = esTypes.slice().sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }));
    ok('sorted by type in the printed words', esTypes.length >= 3 && show(esTypes) === show(sorted), show(esTypes));
    state.searches = [{ id: 'sq_yn', name: 'UPS', query: 'type:pc', columns: ['x:c1'], sort: 'x:c1', desc: true, print: true }];
    const ynDesc = reportModel().searches[0].rows.map((r) => r.cells[0]);
    state.searches[0].desc = false;
    const ynAsc = reportModel().searches[0].rows.map((r) => r.cells[0]);
    ok('a yes/no column turns over when sorted descending', show(ynAsc) === show(ynDesc.slice().reverse()) && ynAsc[0] !== ynAsc[1], show([ynAsc, ynDesc]));
    // The query goes in as typed, $ and all (no replacement patterns).
    const dollar = searchesSection([{ id: 'x', name: 'D', query: "notes:$&x a$` cost$ b$'", total: 1, columns: [], rows: [] }]);
    ok('a $ in the query prints as typed', dollar.includes(`<span class="mono">${escapeHtml("notes:$&x a$` cost$ b$'")}</span>`) && !dollar.includes('\u0001'), dollar);
    setLocale('en');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 0); });
