// Several providers per item (document v18, docs/SCOPE.md step 4 stage 1):
//   1. the format: v17 -> v18 lifts provider: x into providers: [x], input
//      untouched; an item that names none writes no key; the tolerant read
//      of a leftover `provider` at v18; doc.providers' order;
//   2. inheritance per service (nodeProviders): own, then the hosts (a
//      container in a VM in a server), then the groups innermost first; a
//      provider with no service blocks only 'other';
//   3. the pickers: chips with ✕ and Add provider… on a device, a cable and
//      a group, New provider… in the same step, one undo step each;
//   4. bulk Set fields: Add, Remove, Only, None, one undo step;
//   5. the report's rows, the cloud finding, the hover;
//   6. the spreadsheets: "A; B" round trip, a name holding ";" written as
//      its id, an old single-name cell, an unknown piece refused;
//   7. search: provider:, has:provider, no plain-text match on an id;
//   8. the Simple view's "who looks after this" line, in es;
//   9. the merge: provider lists as sets (two-way union, three-way per
//      element, never a conflict), a block inserted brings no provider ids;
//  10. the problem reports' model (doc.incidents) and the 'incident' and
//      'visit' log kinds, and their merge: by id, status forward, a reopen
//      beats an older close, visits unioned, never removed, the cap.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const answers = [];
  const held = setDialogResponder((req) => (answers.length ? answers.shift()(req) : (req.kind === 'confirm' ? false : null)));
  const change = (x, v) => { if (v !== undefined) x.value = v; x.dispatchEvent(new Event('change', { bubbles: true })); };
  const show = (x) => JSON.stringify(x);
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [] }, extra);
  const heldSettings = Object.assign({}, state.settings);
  const PV = [
    { id: 'pI', name: 'Fibra Norte', service: 'internet', phone: '800 1' },
    { id: 'pT', name: 'Andes IT', service: 'it', email: 'mesa@andes.example' },
    { id: 'pS', name: 'Casa Segura', service: 'security' },
    { id: 'pX', name: 'Helper' }
  ];
  const site = (extra = {}) => Object.assign({ v: DOC_VERSION,
    providers: PV.map((p) => Object.assign({}, p)),
    groups: [{ id: 'gB', name: 'Office', kind: 'building', providers: ['pT', 'pI'] }, { id: 'gR', name: 'Server room', kind: 'room', parent: 'gB', providers: ['pS'] }],
    nodes: [
      N('isp', 'cloud', { name: 'ISP' }),
      N('rt', 'router', { name: 'Router', x: 100, providers: ['pI'] }),
      N('srv', 'server', { name: 'Host', x: 200, group: 'gR', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] }),
      N('vm', 'vm', { name: 'VM1', x: 250, host: 'srv', group: 'gR' }),
      N('ct', 'container', { name: 'App', x: 260, host: 'vm', group: 'gR' }),
      N('pc', 'pc', { name: 'Desk', x: 300, group: 'gB', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.20/24' }] }),
      N('cam', 'camera', { name: 'Cam', x: 350, group: 'gB', providers: ['pX'] })
    ],
    links: [
      { id: 'w1', source: 'isp', target: 'rt', medium: 'fiber', providers: ['pI', 'pT'] },
      { id: 'l1', source: 'rt', target: 'srv' },
      { id: 'l2', source: 'rt', target: 'pc' }
    ] }, extra);
  const open = (doc) => { replaceDocument(doc || site(), { origin: 'file' }); renderCanvasOnly(); };
  const who = (id) => nodeProviders(getNode(id)).map((r) => `${r.provider.id}/${r.via}/${r.from.id}`).join();
  try {
    state.settings.advanced = true; applyProfile();

    // ---- 1. The format ----
    ok('the document version is 19 (v19: the log\'s decision kind)', DOC_VERSION === 19);
    const v17 = { v: 17, providers: [{ id: 'p1', name: 'ISP' }, { id: 'p2', name: 'IT' }],
      nodes: [N('a', 'router', { provider: 'p2' }), N('b', 'pc')], links: [{ id: 'l', source: 'a', target: 'b', provider: 'p1' }],
      groups: [{ id: 'g', name: 'G', kind: 'room', provider: 'p1' }] };
    const frozen = JSON.stringify(v17);
    const m = migrateDoc(v17);
    ok('v17 -> v18 lifts provider into a list of one, everywhere, input untouched (then v19)', m.doc.v === 19 && m.from === 17 && JSON.stringify(v17) === frozen
       && show(m.doc.nodes[0].providers) === '["p2"]' && !('provider' in m.doc.nodes[0]) && !('providers' in m.doc.nodes[1])
       && show(m.doc.links[0].providers) === '["p1"]' && show(m.doc.groups[0].providers) === '["p1"]', show(m.doc));
    ok('migrating twice gives the same document', show(migrateDoc(JSON.parse(frozen)).doc) === show(m.doc));
    open(v17);
    const s1 = JSON.parse(JSON.stringify(serializeDoc()));
    ok('saved: providers lists, no provider key, none where none', show(s1.nodes[0].providers) === '["p2"]' && !('providers' in s1.nodes[1])
       && !/"provider"/.test(show(s1)) && s1.v === 19, show(s1.nodes));
    open({ v: DOC_VERSION, providers: PV.map((p) => Object.assign({}, p)), nodes: [N('a', 'router', { provider: 'pT' }), N('b', 'router', { providers: ['pX', 'pI', 'ghost', 'pI'] })], links: [] });
    ok('a leftover provider at v18 is still read, as a list of one', show(getNode('a').providers) === '["pT"]' && !('provider' in getNode('a')));
    ok('a list is kept in doc.providers\' order, repeats and unknown ids dropped', show(getNode('b').providers) === '["pI","pX"]', show(getNode('b').providers));
    ok('isDocShape accepts incidents only as a list', isDocShape({ nodes: [], incidents: [] }) && !isDocShape({ nodes: [], incidents: {} }));

    // ---- 2. Inheritance per service ----
    open();
    ok('a device\'s own covers its service; its group adds the others', who('rt') === 'pI/own/rt', who('rt'));
    ok('innermost group first, then the outer ones for what is left', who('srv') === 'pS/group/gR,pI/group/gB,pT/group/gB', who('srv'));
    ok('a container in a VM in a server: its hosts, then the server\'s groups', (() => {
      getNode('srv').providers = ['pT']; getNode('vm').providers = ['pI'];
      const r = who('ct');
      delete getNode('srv').providers; delete getNode('vm').providers;
      return r === 'pI/host/vm,pT/host/srv,pS/group/gR';
    })(), who('ct'));
    ok('a provider with no service blocks only "other": the group\'s ISP and IT still answer', who('cam') === 'pX/own/cam,pI/group/gB,pT/group/gB', who('cam'));
    getNode('pc').providers = ['pI'];
    ok('a device\'s own ISP blocks its group\'s ISP, not its IT', who('pc') === 'pI/own/pc,pT/group/gB', who('pc'));
    delete getNode('pc').providers;
    const cov = providerCovers('pT');
    ok('providerCovers counts the inherited per service', cov.nodes.map((n) => n.id).join() === 'srv,vm,ct,pc,cam' && cov.links.map((l) => l.id).join() === 'w1'
       && cov.groups.map((g) => g.id).join() === 'gB' && !cov.own.length, cov.nodes.map((n) => n.id).join());
    ok('a cable inherits nothing', linkProviders(getLink('l1')).length === 0 && linkProviders(getLink('w1')).map((p) => p.id).join() === 'pI,pT');

    // ---- 3. The pickers ----
    open();
    select('rt', 'node');
    ok('a device: its providers as chips, Add offers the others and New', /Fibra Norte/.test(el('propProviderChips').textContent)
       && [...el('propProvider').options].map((o) => o.value).join() === `,pT,pS,pX,${PV_NEW}`, [...el('propProvider').options].map((o) => o.value).join());
    ok('a chip\'s ✕ is named for the provider', el('propProviderChips').querySelector('[data-pv-remove="pI"]').getAttribute('aria-label') === 'Remove Fibra Norte');
    change(el('propProvider'), 'pT'); await tick();
    ok('Add: a second provider on one device', show(getNode('rt').providers) === '["pI","pT"]' && el('propProviderChips').querySelectorAll('.pv-chip').length === 2);
    undo();
    ok('one undo step', show(getNode('rt').providers) === '["pI"]');
    select('rt', 'node');
    el('propProviderChips').querySelector('[data-pv-remove="pI"]').click(); await tick();
    ok('✕ removes it: no key left', getNode('rt').providers === undefined);
    undo();
    ok('one undo step', show(getNode('rt').providers) === '["pI"]');
    answers.push(() => 'Hikvision Partner');
    select('rt', 'node');
    change(el('propProvider'), PV_NEW); await tick(); await tick();
    const made = state.providers.find((p) => p.name === 'Hikvision Partner');
    ok('New provider… makes one and adds it', !!made && show(getNode('rt').providers) === show(['pI', made.id]));
    undo();
    ok('both in one undo step', !state.providers.some((p) => p.name === 'Hikvision Partner') && show(getNode('rt').providers) === '["pI"]');
    select('w1', 'link');
    ok('a cable: its two as chips', el('propLinkProviderChips').querySelectorAll('.pv-chip').length === 2);
    el('propLinkProviderChips').querySelector('[data-pv-remove="pT"]').click(); await tick();
    ok('removed from the cable', show(getLink('w1').providers) === '["pI"]');
    select(null);
    showConfigTab('groups');
    el('groupList').querySelector('[data-act="edit"][data-grp="gR"]').click();
    const gsel = el('groupList').querySelector('[data-field="providers"][data-grp="gR"]');
    change(gsel, 'pT'); await tick();
    ok('a group: Add from its card', show(groupById('gR').providers) === '["pT","pS"]', show(groupById('gR').providers));
    el('groupList').querySelector('.pv-chips[data-grp="gR"] [data-pv-remove="pS"]').click(); await tick();
    ok('and ✕ on its chip', show(groupById('gR').providers) === '["pT"]');
    undo();
    ok('one undo step', show(groupById('gR').providers) === '["pT","pS"]');
    showConfigTab('config');

    // ---- 4. Bulk Set fields ----
    open();
    let bp = bulkPlanSet(['rt', 'pc', 'cam'], { providers: { text: 'add:pT' } });
    applyBulkPlan(bp);
    ok('Add: on every device, kept in order', show(getNode('rt').providers) === '["pI","pT"]' && show(getNode('pc').providers) === '["pT"]' && show(getNode('cam').providers) === '["pT","pX"]', show([getNode('rt').providers, getNode('cam').providers]));
    undo();
    ok('one undo step', show(getNode('rt').providers) === '["pI"]' && getNode('pc').providers === undefined);
    bp = bulkPlanSet(['rt', 'pc'], { providers: { text: 'remove:pI' } });
    ok('Remove: only where it is named', bp.counts.change === 1 && bp.counts.same === 1, show(bp.counts));
    applyBulkPlan(bp);
    ok('removed, no key left', getNode('rt').providers === undefined);
    undo();
    bp = bulkPlanSet(['rt', 'cam'], { providers: { text: 'only:pS' } });
    applyBulkPlan(bp);
    ok('Only: exactly that one', show(getNode('rt').providers) === '["pS"]' && show(getNode('cam').providers) === '["pS"]');
    undo();
    applyBulkPlan(bulkPlanSet(['rt', 'cam'], { providers: { text: 'none' } }));
    ok('None: none named', getNode('rt').providers === undefined && getNode('cam').providers === undefined);
    undo();
    selectEntries([{ type: 'node', id: 'rt' }, { type: 'node', id: 'cam' }]);
    const bsel = document.querySelector('#bulkFields select[data-key="providers"]');
    ok('the panel: Remove for what any of them names, and None', !!bsel && [...bsel.options].map((o) => o.value).includes('remove:pI') && [...bsel.options].map((o) => o.value).includes('remove:pX')
       && !([...bsel.options].map((o) => o.value).includes('remove:pT')) && [...bsel.options].map((o) => o.value).includes('none'), bsel && [...bsel.options].map((o) => o.value).join());
    select(null);
    bp = bulkPlanSet(['w1', 'l1'], { providers: { text: 'add:pS' } }, 'link');
    applyBulkPlan(bp);
    ok('on cables too', show(getLink('w1').providers) === '["pI","pT","pS"]' && show(getLink('l1').providers) === '["pS"]');
    undo();

    // ---- 5. Report, finding, hover ----
    open();
    const tech = reportHtml(reportModel(), null, { technical: true });
    ok('the inventory lists every provider of a device', /Provider: Helper, Fibra Norte, Andes IT</.test(tech) && /Provider: Casa Segura, Fibra Norte, Andes IT</.test(tech), (tech.match(/Provider: [^<]*/g) || []).slice(0, 6).join(' | '));
    const rows = reportProviders();
    const row = (id) => rows.find((r) => r.id === id);
    ok('the Providers rows: a group\'s devices on the group\'s line', show(row('pT').groups) === show([{ path: 'Office', devices: 5 }]) && row('pT').cables.length === 1, show(row('pT')));
    ok('and a device named directly by name', row('pI').devices.join() === 'Router', show(row('pI')));
    const pvFinding = () => topologyFindings().find((f) => f.key === 'provider');
    ok('the cloud finding: a provider list on the cable into it answers', !pvFinding());
    delete getLink('w1').providers; renderCanvasOnly();
    ok('none on it or on its cable: the note', !!pvFinding());
    getNode('isp').providers = ['pT', 'pI']; renderCanvasOnly();
    ok('a list on the cloud answers', !pvFinding());
    open();
    state.settings.providerHover = true; renderCanvasOnly();
    const tip = document.querySelector('#ui-node-srv > title.pv-tip');
    ok('the hover: one line per provider, with whose it is', !!tip && /Casa Segura · CCTV \/ alarm \(through Server room\)/.test(tip.textContent)
       && /Andes IT · IT support \(through Office\)/.test(tip.textContent) && /mesa@andes.example/.test(tip.textContent), tip && tip.textContent);
    const tipL = document.querySelector('#ui-link-w1 > title.pv-tip');
    ok('a cable\'s names both', !!tipL && /Fibra Norte/.test(tipL.textContent) && /Andes IT/.test(tipL.textContent));
    state.settings.providerHover = false; renderCanvasOnly();

    // ---- 6. Spreadsheets ----
    open();
    const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
    const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
    const cell = (sheet, rowPick, head) => { const i = sheet.headers.indexOf(head); const r = sheet.rows.find(rowPick); return r ? r[i] : undefined; };
    ok('devices.csv: own providers joined with "; "', cell(csvDevicesSheet(), (r) => r.includes('Router'), 'provider') === 'Fibra Norte');
    ok('cables.csv: two as "A; B"', cell(csvCablesSheet(), (r) => r[0] === 'w1', 'cable_provider') === 'Fibra Norte; Andes IT');
    ok('groups.csv too', cell(csvGroupsSheet(), (r) => r[0] === 'gB', 'provider') === 'Fibra Norte; Andes IT', cell(csvGroupsSheet(), (r) => r[0] === 'gB', 'provider'));
    providerById('pX').name = 'Help; Desk'; save();
    ok('a name holding ";" is written as its id', cell(csvDevicesSheet(), (r) => r.includes('Cam'), 'provider') === 'pX');
    const twoP = planOf('name,provider\r\nDesk,Casa Segura; Andes IT\r\n');
    ok('a cell naming two reads as both', twoP.counts.change === 1, show(twoP.rows.map((r) => r.status + ':' + r.why)));
    applyCsvPlan(twoP);
    ok('applied, in doc.providers\' order', show(getNode('pc').providers) === '["pT","pS"]', show(getNode('pc').providers));
    ok('the same two in another order are no change', planOf('name,provider\r\nDesk,Andes IT; Casa Segura\r\n').counts.same === 1);
    ok('an old sheet\'s single name still reads', planOf('name,provider\r\nCam,Casa Segura\r\n').counts.change === 1);
    ok('a name with ";" typed whole still reads', planOf('name,provider\r\nRouter,Help; Desk\r\n').counts.change === 1);
    const unk = planOf('name,provider\r\nDesk,Andes IT; Nobody Inc\r\n');
    ok('one unknown piece refuses the cell', unk.counts.conflict === 1, show(unk.rows.map((r) => r.why)));
    undo();
    // Round trip into a blank map.
    const pvNames = (x) => providerRefsOf(x).map((id) => providerById(id).name).join('|');
    const sig = () => show({ p: state.providers, n: state.nodes.map((n) => [n.name, pvNames(n)]), l: state.links.map((l) => [l.source, l.target, pvNames(l)]), g: state.groups.map((g) => [g.name, pvNames(g)]) });
    getNode('pc').providers = ['pT', 'pS']; save();
    const want = sig();
    const sheets = { P: csvText(csvProvidersSheet()), G: csvText(csvGroupsSheet()), D: csvText(csvDevicesSheet()), I: csvText(csvInterfacesSheet()), C: csvText(csvCablesSheet()) };
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    const why = [];
    ['P', 'G', 'D', 'I', 'C'].forEach((k) => { const pl = planOf(sheets[k]); pl.rows.filter((r) => r.status === 'conflict').forEach((r) => why.push(`${k} ${r.name}: ${r.why}`)); applyCsvPlan(pl); });
    ok('every list round-trips into a blank map, lossless', sig() === want && !why.length, why.slice(0, 3).join(' | ') || sig().slice(0, 300));

    // ---- 7. Search ----
    open();
    const matches = (text) => { const q = parseQuery(text); return state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id).sort().join(','); };
    ok('provider: by name, through inheritance', matches('provider:fibra') === 'cam,ct,pc,rt,srv,vm', matches('provider:fibra'));
    ok('provider: by service', matches('provider:security') === 'ct,srv,vm', matches('provider:security'));
    ok('has:provider', matches('has:provider') === 'cam,ct,pc,rt,srv,vm' && matches('-has:provider') === 'isp', matches('-has:provider'));
    ok('plain text finds a device by the name of a provider it names', matches('helper') === 'cam');
    ok('but never by a provider id', matches('pI') === '' || !/rt/.test(matches('pI')), matches('pI'));
    const lq = parseQuery('provider:andes');
    ok('a cable by its own providers', state.links.filter((l) => queryMatch(lq, 'link', l)).map((l) => l.id).includes('w1'));

    // ---- 8. The Simple view's line ----
    open();
    state.settings.advanced = false; applyProfile();
    setLocale('es'); applyLocale();
    select('srv', 'node');
    const line = el('whoseSentence').textContent;
    ok('es: who looks after a device, per service', /^Quién se encarga de esto: Casa Segura \(CCTV \/ alarma, a través de Server room\), Fibra Norte \(Internet, a través de Office\), Andes IT \(Soporte de TI, a través de Office\)\.$/.test(line), line);
    select('isp', 'node');
    ok('es: none named', el('whoseSentence').textContent === 'No figura ningún proveedor para esto.', el('whoseSentence').textContent);
    setLocale('en'); applyLocale();
    select(null);
    state.settings.advanced = true; applyProfile();
    ok('the full editor does not show it', getComputedStyle(el('whoseSentence')).display === 'none' || !el('whoseSentence').textContent);

    // ---- 9. The merge: provider lists as sets ----
    const D = (o) => Object.assign({ v: DOC_VERSION, providers: PV.map((p) => Object.assign({}, p)), links: [] }, o);
    const rtWith = (ids) => D({ nodes: [N('rt', 'router', Object.assign({ name: 'Router' }, ids ? { providers: ids } : {}))] });
    const run = (mine, theirs, base) => { const p = planMerge(mine, theirs, base || null); return { p, r: applyMergePlan(mine, p, {}) }; };
    const field = (p) => { const it = p.items.find((i) => i.key === 'nodes:rt'); return it && it.fields.find((f) => f.field === 'providers'); };
    let x = run(rtWith(['pI']), rtWith(['pT']));
    ok('two-way: the union, never a conflict', show(x.r.doc.nodes[0].providers) === '["pI","pT"]' && field(x.p).take === 'merged' && !field(x.p).conflict && x.p.counts.conflicts === 0, show(field(x.p)));
    x = run(rtWith(['pI', 'pT']), rtWith(['pT']));
    ok('two-way: a list theirs lacks one of is no change', !field(x.p) && show(x.r.doc.nodes[0].providers) === '["pI","pT"]');
    x = run(rtWith(['pI', 'pS']), rtWith(['pT']), rtWith(['pI']));
    ok('three-way: mine added one, theirs removed one and added another: both edits kept', show(x.r.doc.nodes[0].providers) === '["pT","pS"]' && x.p.counts.conflicts === 0, show(x.r.doc.nodes[0].providers));
    x = run(rtWith(['pI', 'pT']), rtWith(['pI', 'pS']), rtWith(['pI']));
    ok('three-way: both added', show(x.r.doc.nodes[0].providers) === '["pI","pT","pS"]');
    x = run(rtWith(['pI']), rtWith(null), rtWith(['pI']));
    ok('three-way: theirs removed the last one', x.r.doc.nodes[0].providers === undefined && field(x.p).take === 'theirs');
    // A block inserted brings no provider ids (they are its map's).
    open();
    const before = state.nodes.length;
    insertBlock({ doc: { nodes: [N('b1', 'router', { providers: ['pI'] }), N('b2', 'pc')], links: [{ id: 'bl', source: 'b1', target: 'b2', providers: ['pT'] }] } });
    const added = state.nodes.slice(before);
    ok('a block inserted brings no provider ids', added.length === 2 && added.every((n) => !n.providers) && !state.links.slice(-1)[0].providers, show(added.map((n) => n.providers)));
    undo();

    // ---- 10. Problem reports and the log kinds ----
    const inc = (o) => Object.assign({ id: 'in0000000001', at: 1762600000000, status: 'open', symptom: 'internet', nodeIds: ['rt'], text: 'No internet', reporter: { name: 'Ana', phone: '55 1' }, routedTo: ['pI'], visits: [] }, o);
    const norm = normalizeIncidents([inc(), inc(), { id: 'bad id', symptom: 'internet' }, inc({ id: 'in2', symptom: 'gremlins' }), inc({ id: 'in3', nodeIds: ['rt', 'ghost'], routedTo: ['nobody'], groupId: 'gZ', text: '  hi\r\nthere ', closedNote: '' })],
      { nodes: [{ id: 'rt' }], groups: [], providers: [{ id: 'pI' }] });
    ok('normalizeIncidents: one per id, a bad id or symptom dropped, references checked', norm.length === 2 && norm[1].id === 'in3' && show(norm[1].nodeIds) === '["rt"]'
       && show(norm[1].routedTo) === '[]' && !('groupId' in norm[1]) && norm[1].text === 'hi\nthere' && !('closedNote' in norm[1]), show(norm));
    const many = Array.from({ length: INCIDENT_MAX + 3 }, (_, i) => inc({ id: `in${i}`, at: 1000 + i, status: i < 2 ? 'closed' : i === 5 ? 'closed' : 'open' }));
    const capped = normalizeIncidents(many);
    ok('the cap: oldest closed first, then oldest', capped.length === INCIDENT_MAX && !capped.some((c) => ['in0', 'in1', 'in5'].includes(c.id)) && capped[0].id === 'in2', capped.slice(0, 3).map((c) => c.id).join());
    ok('incidentRank: a reopen is a round up', incidentRank({ status: 'open', reopened: 1 }) > incidentRank({ status: 'closed' }) && incidentRank({ status: 'visited' }) > incidentRank({ status: 'sent' }));
    open(site({ incidents: [inc()] }));
    const saved = serializeDoc();
    ok('saved before the log, and read back the same', Object.keys(saved).indexOf('incidents') > -1 && show(saved.incidents[0]) === show(normalizeIncident(inc())) && show(state.incidents) === show(saved.incidents));
    open();
    ok('no report: no key', !('incidents' in JSON.parse(JSON.stringify(serializeDoc()))));
    replaceDocument(site({ incidents: [inc()], log: [] }), { origin: 'template' });
    ok('a template brings no reports', !state.incidents.length && !('incidents' in JSON.parse(JSON.stringify(serializeDoc()))));
    open(site({ incidents: [inc()] }));
    const tplId = librarySave('Tpl with a report', null, { template: true });
    ok('a template saved keeps none', !!tplId && !('incidents' in libraryEntry(tplId).doc));
    libraryDelete(tplId);
    const le = incidentLogEntry({ id: 'lg_i1', at: 5, incident: inc(), event: 'sent', routedTo: ['pI', 'pT'] });
    ok('an incident log entry', le.kind === 'incident' && le.event === 'sent' && le.incidentId === 'in0000000001' && show(le.routedTo) === '["pI","pT"]' && /^Problem sent: internet/.test(le.summary), show(le));
    const ve = visitLogEntry({ id: 'lg_v1', at: 6, incidentId: 'in0000000001', providerId: 'pT', provider: 'Andes IT', by: 'Juan', arrived: 4, left: 5, outcome: 'fixed', notes: 'Swapped\r\nthe cable',
      changes: { counts: { added: 1, changed: 2, removed: 0 }, items: [{ kind: 'nodes', id: 'n1', name: 'SW', status: 'added' }, { kind: 'x', status: 'bogus' }] }, signoff: 'Ana' });
    ok('a visit log entry: fields in order, notes kept with line breaks, changes neutral', ve.kind === 'visit' && Object.keys(ve).join() === 'id,at,kind,incidentId,providerId,provider,by,arrived,left,outcome,notes,changes,signoff,summary'
       && ve.notes === 'Swapped\nthe cable' && ve.changes.items.length === 1 && ve.changes.counts.changed === 2 && /^Visit by Juan \(Andes IT\): fixed, 3 changes\./.test(ve.summary), show(ve));
    ok('normalizeLog keeps both kinds', normalizeLog([le, ve, { id: 'lg_z', at: 7, kind: 'visit', outcome: 'meh' }]).map((e) => e.kind).join() === 'incident,visit,visit'
       && normalizeLog([{ id: 'lg_z', at: 7, kind: 'visit', outcome: 'meh' }])[0].outcome === undefined);

    // Their merge.
    const withInc = (list, o) => site(Object.assign({ incidents: list }, o || {}));
    const incOf = (doc) => (doc.incidents || [])[0];
    x = run(withInc([]), withInc([inc()]));
    ok('a report only theirs has is added', x.r.doc.incidents.length === 1 && x.p.items.some((i) => i.kind === 'incidents' && i.status === 'added'));
    x = run(withInc([inc()]), withInc([]));
    ok('two-way: one only mine has is kept', x.r.doc.incidents.length === 1);
    x = run(withInc([inc()]), withInc([]), withInc([inc()]));
    ok('three-way: one theirs lacks is never removed', x.r.doc.incidents.length === 1 && x.p.counts.removed === 0, show(x.p.counts));
    x = run(withInc([inc({ status: 'sent', sentAt: 9 })]), withInc([inc({ status: 'visited', sentAt: 9, visits: ['lg_v1'] })]));
    ok('status forward, two-way, no conflict: visited wins', incOf(x.r.doc).status === 'visited' && show(incOf(x.r.doc).visits) === '["lg_v1"]' && x.p.counts.conflicts === 0, show(incOf(x.r.doc)));
    x = run(withInc([inc({ status: 'visited', sentAt: 9, visits: ['lg_v1'] })]), withInc([inc({ status: 'sent', sentAt: 9 })]));
    ok('and the other way round: mine stays visited', incOf(x.r.doc).status === 'visited' && !x.p.items.find((i) => i.kind === 'incidents').fields.length);
    const base = withInc([inc({ status: 'sent', sentAt: 9 })]);
    x = run(withInc([inc({ status: 'visited', sentAt: 9, visits: ['lg_a'] })]), withInc([inc({ status: 'visited', sentAt: 9, visits: ['lg_b'] })]), base);
    ok('three-way: two providers\' visits unioned', show(incOf(x.r.doc).visits) === '["lg_a","lg_b"]' && x.p.counts.conflicts === 0, show(incOf(x.r.doc)));
    x = run(withInc([inc({ status: 'open', reopened: 1 })]), withInc([inc({ status: 'closed', closedAt: 8, closedNote: 'Fixed' })]));
    ok('a reopen beats an older close, and the close date and note go with it', incOf(x.r.doc).status === 'open' && incOf(x.r.doc).reopened === 1 && !('closedNote' in incOf(x.r.doc)), show(incOf(x.r.doc)));
    x = run(withInc([inc({ status: 'visited' })]), withInc([inc({ status: 'closed', closedAt: 8, closedNote: 'Fixed' })]));
    ok('a close comes in with its note', incOf(x.r.doc).status === 'closed' && incOf(x.r.doc).closedNote === 'Fixed');
    x = run(withInc([inc({ status: 'sent', sentAt: 20 })]), withInc([inc({ status: 'sent', sentAt: 10 })]));
    ok('the first send is the earliest', incOf(x.r.doc).sentAt === 10);
    // Theirs' device reminted: its report follows the new id.
    const mineDoc = D({ nodes: [N('rt', 'router', { name: 'Router', serial: 'A1' })] });
    const theirsDoc = D({ nodes: [N('rt', 'router', { name: 'Core', serial: 'B2' }), N('pc', 'pc', { name: 'Desk' })], incidents: [inc({ nodeIds: ['rt', 'pc'] })] });
    x = run(mineDoc, theirsDoc);
    const theirRt = x.r.doc.nodes.find((n) => n.serial === 'B2');
    ok('nodeIds follow a reminted device', !!theirRt && theirRt.id !== 'rt' && incOf(x.r.doc).nodeIds.includes(theirRt.id) && !incOf(x.r.doc).nodeIds.includes('rt'), show(incOf(x.r.doc)));
    // The cap: an old closed report mine had already let go is not added back.
    const full = Array.from({ length: INCIDENT_MAX }, (_, i) => inc({ id: `inf${i}`, at: 5000 + i }));
    const old = inc({ id: 'inold', at: 10, status: 'closed' });
    x = run(withInc(full), withInc([old]));
    ok('the cap: one the result would drop again is not added', x.r.doc.incidents.length === INCIDENT_MAX && !x.r.doc.incidents.some((c) => c.id === 'inold')
       && !x.p.items.some((i) => i.kind === 'incidents' && i.status === 'added') && !x.p.notes.length, show(x.p.notes));
    {
      // Ids are free text where the user typed them (a CSV's 'PC 3',
      // 'sw01.lab', a provider 'isp.mx'): a report keeps them.
      const fctx = { nodes: [{ id: 'PC 3' }, { id: 'sw01.lab' }], groups: [{ id: 'Planta baja' }], providers: [{ id: 'isp.mx' }] };
      const ri = normalizeIncident({ id: 'infree1', at: 5, status: 'sent', symptom: 'internet', nodeIds: ['PC 3', 'sw01.lab', 'gone'], groupId: 'Planta baja', routedTo: ['isp.mx'],
        visits: ['lg_ok', 'not a log id'] }, fctx);
      ok('a report keeps free-text device, group and provider ids (and drops what the network lacks)', show(ri.nodeIds) === '["PC 3","sw01.lab"]' && ri.groupId === 'Planta baja'
         && show(ri.routedTo) === '["isp.mx"]' && show(ri.visits) === '["lg_ok"]', show(ri));
      const le = normalizeLogEntry({ id: 'lg_f1', at: 9, kind: 'incident', incidentId: 'infree1', event: 'sent', symptom: 'internet', routedTo: ['isp.mx', ' padded', ''] });
      const lv = normalizeLogEntry({ id: 'lg_f2', at: 10, kind: 'visit', providerId: 'isp.mx', by: 'J', outcome: 'fixed' });
      ok('and so do their log entries', show(le.routedTo) === '["isp.mx"]' && lv.providerId === 'isp.mx', show([le.routedTo, lv.providerId]));
    }
    // The merge review names them.
    const vctx = { labels: new Map([['providers:pI', 'Fibra Norte'], ['providers:pT', 'Andes IT']]), colNames: new Map() };
    ok('the review shows a provider list by names, a report\'s state by its word', window.TopoMergeUI.mergeValueText('nodes', 'providers', ['pI', 'pT'], vctx) === 'Fibra Norte, Andes IT'
       && window.TopoMergeUI.mergeValueText('incidents', 'state', { status: 'visited' }, vctx) === 'Visited');
    ok('an open report reads as reported (a status, not the verb), visits as a count, never their ids',
       window.TopoMergeUI.mergeValueText('incidents', 'state', { status: 'open' }, vctx) === 'Reported'
       && window.TopoMergeUI.mergeValueText('incidents', 'visits', ['lg_v1'], vctx) === 'One visit'
       && window.TopoMergeUI.mergeValueText('incidents', 'visits', ['lg_v1', 'lg_v2'], vctx) === 'Visits: 2');
    setLocale('es');
    ok('in es: Reportado, not Abrir', window.TopoMergeUI.mergeValueText('incidents', 'state', { status: 'open' }, vctx) === 'Reportado');
    setLocale('en');
    ok('the review has words for them',window.TopoMergeUI.mergeKindText('incidents') === 'Problem report' && window.TopoMergeUI.mergeKindText('incidents', true) === 'Problem reports');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(held);
    setLocale('en');
    Object.keys(state.settings).forEach((k) => { if (!(k in heldSettings)) delete state.settings[k]; });
    Object.assign(state.settings, heldSettings);
    saveSettings();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
