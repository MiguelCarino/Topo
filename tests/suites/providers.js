// Providers (js/model.js "Providers", js/providers.js, document v15): who is
// responsible for what, so someone new to the site knows whom to call.
//   1. the model: doc.providers through PROVIDER_FIELDS (a service by any of
//      its words, an email checked, no key at all when there are none), a
//      v14 document opening as v15, a reference to a provider the document
//      does not hold dropped; who answers for a device (its own, its VM
//      host's, the innermost group's) and what a provider covers;
//   2. the Providers tab: offered in the full editor only, empty it offers
//      the usual kinds one click each, a card's contact and what it covers,
//      typed fields one undo step each, Delete leaving what named it with no
//      provider (one step); Select what it covers;
//   3. the pickers: a device's (saying whose it is through its group or
//      host), a cable's, a group's, and New provider… making one and setting
//      it in one step;
//   4. the report: the Providers section on the technical sheet, the
//      provider under a device in the inventory and on a cable, Who to call
//      on the summary, and none of it with no providers;
//   5. the finding: an info note on an internet cloud nobody is named for,
//      gone with a provider on it, its group or a cable into it, never on a
//      cloud standing for another site, and never counted;
//   6. the hover: off by default (no tooltip), on in Settings a tooltip on
//      the device and the cable naming the provider and how to reach them,
//      left out of the SVG export;
//   7. the spreadsheets: providers.csv out and back in (by id, then by name),
//      devices.csv, cables.csv (cable_provider) and groups.csv carrying the
//      provider by name, an unknown name refused, the whole round trip into
//      a blank map;
//   8. Settings: Export where File was, the Settings button, its toggles and
//      defaults kept with this browser's settings and not the document's,
//      Prepared by filled into the report dialog when the network names
//      nobody, the parts it starts with; About inside it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const answers = [];
  const held = setDialogResponder((req) => (answers.length ? answers.shift()(req) : (req.kind === 'confirm' ? false : null)));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const change = (x, v) => { if (v !== undefined) { if (x.type === 'checkbox') x.checked = v; else x.value = v; } x.dispatchEvent(new Event('change', { bubbles: true })); };
  const input = (x, v) => { x.value = v; x.dispatchEvent(new Event('input', { bubbles: true })); };
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false, interfaces: [] }, extra);
  const saved = () => serializeDoc();
  const heldSettings = Object.assign({}, state.settings);
  const site = (extra = {}) => Object.assign({ v: DOC_VERSION,
    providers: [{ id: 'pT', name: 'Telmex', service: 'internet', phone: '800 123 4567', email: 'soporte@telmex.example', account: 'ACC-1', hours: '24/7' },
                { id: 'pA', name: 'Acme IT', service: 'it', contact: 'Ana López', phone: '55 1234 5678' }],
    groups: [{ id: 'gB', name: 'Building', kind: 'building' }, { id: 'gR', name: 'Server room', kind: 'room', parent: 'gB', provider: 'pA' }],
    nodes: [
      N('isp', 'cloud', { name: 'ISP', interfaces: [{ id: 'i1', name: 'wan', ip: '203.0.113.1/30' }] }),
      N('gw', 'router', { name: 'Gateway', x: 100, provider: 'pT', interfaces: [{ id: 'i1', name: 'wan', ip: '203.0.113.2/30' }, { id: 'i2', name: 'lan', ip: '10.0.0.1/24' }] }),
      N('srv', 'server', { name: 'Host', x: 200, group: 'gR', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] }),
      N('vm', 'vm', { name: 'VM1', x: 250, host: 'srv', group: 'gR', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] }),
      N('pc', 'pc', { name: 'Desk', x: 300, group: 'gB', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.20/24' }] })
    ],
    links: [
      { id: 'w1', source: 'isp', target: 'gw', sourceIface: 'i1', targetIface: 'i1', medium: 'fiber', cable: { label: 'WAN-01' }, provider: 'pT' },
      { id: 'l1', source: 'gw', target: 'srv', sourceIface: 'i2', targetIface: 'i1' },
      { id: 'l2', source: 'gw', target: 'pc', sourceIface: 'i2', targetIface: 'i1' }
    ] }, extra);
  const open = (doc) => { replaceDocument(doc || site(), { origin: 'file' }); renderCanvasOnly(); };
  try {
    state.settings.advanced = true; applyProfile();

    // ---- 1. The model ----
    ok('the document is version 15 or later', DOC_VERSION >= 15);
    const m = migrateDoc({ v: 14, nodes: [], links: [] });
    ok('a v14 document opens as the current version', m.doc.v === DOC_VERSION && !m.newer && m.from === 14);
    const norm = normalizeProviders([{ id: 'p1', name: '  Telmex  ', service: 'ISP', email: 'a@b.co', notes: 'line 1\r\nline 2' }, { id: 'p1', name: 'Dup', service: 'nonsense' }, 'junk', null]);
    ok('read through the fields: trimmed, a service by its words, a repeated id reminted, junk dropped',
       norm.length === 2 && norm[0].name === 'Telmex' && norm[0].service === 'internet' && norm[0].notes === 'line 1\nline 2'
       && norm[1].id !== 'p1' && norm[1].service === undefined, JSON.stringify(norm));
    ok('the services in other words and languages', ['msp', 'CCTV', 'ups', 'proveedor', 'nube', 'Телефония'].map(providerServiceKey).join() === 'it,security,power,vendor,cloud,phone');
    ok('an email is checked, blank is fine', providerEmailOk('') && providerEmailOk('x@y.mx') && !providerEmailOk('not an email'));
    open({ v: DOC_VERSION, nodes: [N('a', 'pc')], links: [] });
    ok('a document that never named a provider has no providers key', !/"providers?"/.test(JSON.stringify(saved())));
    open(site({ nodes: site().nodes.concat(N('ghost', 'pc', { provider: 'nobody' })) }));
    ok('a reference to a provider the document does not hold is dropped', getNode('ghost').provider === undefined && getNode('gw').provider === 'pT');
    ok('they are written in order, every field', JSON.stringify(saved().providers[0]) === '{"id":"pT","name":"Telmex","service":"internet","phone":"800 123 4567","email":"soporte@telmex.example","account":"ACC-1","hours":"24/7"}', JSON.stringify(saved().providers[0]));
    const who = (id) => { const r = nodeProvider(getNode(id)); return r ? `${r.provider.id}/${r.via}/${r.from.id}` : ''; };
    ok('a device\'s own provider', who('gw') === 'pT/own/gw');
    ok('else its innermost group\'s', who('srv') === 'pA/group/gR' && who('pc') === '');
    getNode('srv').provider = 'pT';
    ok('a VM with none of its own is its host\'s', who('vm') === 'pT/host/srv', who('vm'));
    delete getNode('srv').provider;
    ok('else its host\'s group\'s', who('vm') === 'pA/group/gR', who('vm'));
    const cov = providerCovers('pA');
    ok('what a provider covers: through the group too, and the groups naming it', cov.nodes.map((n) => n.id).join() === 'srv,vm' && cov.groups.map((g) => g.id).join() === 'gR' && !cov.own.length);
    ok('and the cables naming it', providerCovers('pT').links.map((l) => l.id).join() === 'w1');

    // The samples carry them (SAMPLE_EXTRAS, js/data.js), with dates that
    // raise nothing, and nobody's internet line goes unnamed.
    {
      const keys = Object.keys(SAMPLE_EXTRAS);
      const bad = [];
      keys.forEach((k) => {
        replaceDocument(cloneData(templatesData[k]), { origin: 'template' }); renderCanvasOnly();
        const fs = topologyFindings();
        if (!(state.providers || []).length) bad.push(`${k}: no providers`);
        if (!state.nodes.some((n) => n.inService)) bad.push(`${k}: no dates`);
        fs.filter((f) => ['age', 'service', 'service-due', 'provider'].includes(f.key)).forEach((f) => bad.push(`${k}: ${f.key} ${f.subject}`));
      });
      ok('the samples name their providers and dates, and raise no age, service or provider note', keys.length >= 8 && !bad.length, bad.slice(0, 4).join(' | '));
      replaceDocument(cloneData(templatesData.house), { origin: 'template' });
      const rep = reportHtml(reportModel(), null, { summary: true, technical: true });
      ok('Smart Home\'s report says who to call', /Who to call/.test(rep) && /Fibra Norte/.test(rep) && /Casa Segura/.test(rep));
    }

    // ---- 2. The Providers tab ----
    open({ v: DOC_VERSION, nodes: [N('isp', 'cloud', { name: 'ISP' })], links: [] });
    showConfigTab('providers');
    ok('the tab shows in the full editor', !el('providerTabBtn').classList.contains('hidden') && !el('cfgPanel-providers').classList.contains('hidden'));
    const presets = [...el('providerList').querySelectorAll('[data-act="preset"]')].map((b) => b.dataset.pv);
    ok('empty, the usual kinds one click each', presets.join() === PV_PRESETS.join(), presets.join());
    el('providerList').querySelector('[data-act="preset"][data-pv="internet"]').click();
    await tick();
    ok('one click makes an internet provider, its card open on the name', state.providers.length === 1 && state.providers[0].service === 'internet'
       && document.activeElement && document.activeElement.dataset.field === 'name');
    const pid = state.providers[0].id;
    input(el('providerList').querySelector(`[data-field="name"][data-pv="${pid}"]`), 'Totalplay');
    input(el('providerList').querySelector(`[data-field="phone"][data-pv="${pid}"]`), '55 8000 0000');
    const em = el('providerList').querySelector(`[data-field="email"][data-pv="${pid}"]`);
    input(em, 'bad email');
    ok('typed fields are kept, a bad email marked', state.providers[0].name === 'Totalplay' && state.providers[0].phone === '55 8000 0000' && em.classList.contains('invalid'));
    input(em, '');
    renderProvidersPanel(true);
    undo();
    // Typing coalesces as every typed field does (saveTyping): the words go,
    // the provider the click made stays.
    ok('typing is undone apart from making the provider', state.providers.length === 1 && state.providers[0].phone === undefined && state.providers[0].service === 'internet', JSON.stringify(state.providers[0]));
    state.providers[0].name = 'Totalplay'; save();
    getNode('isp').provider = pid; save(); renderProvidersPanel(true);
    const card = el('providerList').querySelector(`.pv-card[data-pv="${pid}"]`);
    ok('the card says what it covers', /Responsible for 1 device/.test(card.textContent), card.textContent.replace(/\s+/g, ' ').slice(0, 160));
    el('providerList').querySelector(`[data-act="covers"][data-pv="${pid}"]`).click();
    ok('Select what it covers selects it', state.selection.size === 1 && inSelection('node', 'isp'));
    answers.push(() => true);
    el('providerList').querySelector(`[data-act="delete"][data-pv="${pid}"]`).click();
    await tick(); await tick();
    ok('Delete: the provider goes, the cloud stays with none', state.providers.length === 0 && !!getNode('isp') && getNode('isp').provider === undefined);
    undo();
    ok('and that is one undo step', state.providers.length === 1 && getNode('isp').provider === pid);

    // ---- 3. The pickers ----
    open();
    select('pc', 'node');
    ok('a device names none: the picker offers every provider and New', [...el('propProvider').options].map((o) => o.value).join() === ',pA,pT,' + PV_NEW && el('propProvider').value === '');
    select('srv', 'node');
    ok('one in a group that names one says so', !el('providerNote').classList.contains('hidden') && /From its group Server room: Acme IT/.test(el('providerNote').textContent), el('providerNote').textContent);
    change(el('propProvider'), 'pT'); await tick();
    ok('picked, it is the device\'s own', getNode('srv').provider === 'pT' && el('providerNote').classList.contains('hidden'));
    undo();
    ok('one undo step', getNode('srv').provider === undefined);
    answers.push(() => 'Hikvision Partner');
    select('pc', 'node');
    change(el('propProvider'), PV_NEW); await tick(); await tick();
    const made = state.providers.find((p) => p.name === 'Hikvision Partner');
    ok('New provider… makes one and sets it', !!made && getNode('pc').provider === made.id && el('propProvider').value === made.id);
    undo();
    ok('in one undo step', !state.providers.some((p) => p.name === 'Hikvision Partner') && getNode('pc').provider === undefined);
    select('l1', 'link');
    ok('a cable has a picker too', !el('linkProviderProps').classList.contains('hidden') && el('propLinkProvider').value === '');
    change(el('propLinkProvider'), 'pA'); await tick();
    ok('and keeps it', getLink('l1').provider === 'pA');
    select(null);
    showConfigTab('groups');
    el('groupList').querySelector('[data-act="edit"][data-grp="gB"]').click();
    const gsel = el('groupList').querySelector('[data-field="provider"][data-grp="gB"]');
    ok('a group\'s card has a picker', !!gsel && gsel.value === '');
    change(gsel, 'pA'); await tick();
    ok('set on the building, its desk is Acme IT\'s', groupById('gB').provider === 'pA' && who('pc') === 'pA/group/gB');
    showConfigTab('config');
    // The bulk panel sets one on many devices, or many cables: a pick of the
    // network's providers, one undo step.
    open();
    let bp = bulkPlanSet(['pc', 'srv'], { provider: { text: 'pT' } });
    ok('bulk Set fields: a provider on two devices', !bp.errors.length && bp.counts.change === 2, JSON.stringify(bp.counts));
    applyBulkPlan(bp);
    ok('applied to both', getNode('pc').provider === 'pT' && getNode('srv').provider === 'pT');
    undo();
    ok('in one undo step', getNode('pc').provider === undefined && getNode('srv').provider === undefined);
    ok('a provider the network lacks is refused', bulkPlanSet(['pc'], { provider: { text: 'nobody' } }).errors.length === 1);
    bp = bulkPlanSet(['l1', 'l2'], { provider: { text: 'pA' } }, 'link');
    applyBulkPlan(bp);
    ok('and on cables', getLink('l1').provider === 'pA' && getLink('l2').provider === 'pA', JSON.stringify(bp.errors));
    selectEntries([{ type: 'node', id: 'pc' }, { type: 'node', id: 'srv' }]);
    const bsel = document.querySelector('#bulkFields select[data-key="provider"]');
    ok('the panel offers it as a pick of the providers', !!bsel && [...bsel.options].map((o) => o.value).join() === ',pT,pA', bsel && [...bsel.options].map((o) => o.value).join());
    select(null);

    // ---- 4. The report ----
    open();
    const html = reportHtml(reportModel(), null, { summary: true, technical: true });
    const cut = html.indexOf('<h1>Network documentation report');
    const tech = html.slice(cut);
    ok('the technical sheet has a Providers section', /<h2>Providers<\/h2>/.test(tech) && /<table class="providers">/.test(tech));
    ok('with how to reach them and what they cover', /Telmex/.test(tech) && /800 123 4567/.test(tech) && /ACC-1/.test(tech) && /24\/7/.test(tech)
       && /Server room \(2 devices\)/.test(tech) && /the cable WAN-01 \(ISP ↔ Gateway\)/.test(tech));
    ok('the inventory names a device\'s provider', /Provider: Acme IT/.test(tech) && /Provider: Telmex/.test(tech));
    const sum = html.slice(0, cut);
    ok('the summary says who to call', /<h2>Who to call<\/h2>/.test(sum) && /class="who-to-call"/.test(sum) && /Ana López — 55 1234 5678/.test(sum));
    open({ v: DOC_VERSION, nodes: [N('a', 'pc')], links: [] });
    const bare = reportHtml(reportModel(), null, { summary: true, technical: true });
    ok('with no providers, neither section', !/Who to call/.test(bare) && !/<h2>Providers<\/h2>/.test(bare));

    // ---- 5. The finding ----
    const pvFinding = () => topologyFindings().find((f) => f.key === 'provider');
    open({ v: DOC_VERSION, nodes: [N('isp', 'cloud', { name: 'ISP' }), N('r', 'router', { x: 100 })], links: [{ id: 'k', source: 'isp', target: 'r' }], providers: [{ id: 'p', name: 'Telmex' }] });
    const f = pvFinding();
    ok('a cloud nobody is named for: an info note', !!f && f.level === 'info' && f.nodeIds.join() === 'isp' && /whom to call/.test(f.detail));
    ok('never counted', !isCountedFinding(f) && !reportModel().findings.some((x) => x.key === 'provider'));
    getLink('k').provider = 'p'; renderCanvasOnly();
    ok('a provider on the cable into it answers', !pvFinding());
    delete getLink('k').provider; getNode('isp').provider = 'p'; renderCanvasOnly();
    ok('so does one on the cloud', !pvFinding());
    delete getNode('isp').provider; getNode('isp').siteRef = { name: 'Torre A' }; renderCanvasOnly();
    ok('a cloud standing for another site is not the internet', !pvFinding());

    // ---- 6. The hover ----
    open();
    state.settings.providerHover = false; renderCanvasOnly();
    ok('off by default: no tooltip', !document.querySelector('#ui-node-gw > title.pv-tip'));
    state.settings.providerHover = true; renderCanvasOnly();
    const tipN = document.querySelector('#ui-node-gw > title.pv-tip'), tipG = document.querySelector('#ui-node-srv > title.pv-tip'), tipL = document.querySelector('#ui-link-w1 > title.pv-tip');
    ok('on: the device names its provider and how to reach them', !!tipN && /Provider: Telmex · Internet/.test(tipN.textContent) && /800 123 4567/.test(tipN.textContent), tipN && tipN.textContent);
    ok('through its group', !!tipG && /Acme IT · IT support \(through Server room\)/.test(tipG.textContent), tipG && tipG.textContent);
    ok('and the cable', !!tipL && /Telmex/.test(tipL.textContent));
    ok('none on a device nobody answers for', !document.querySelector('#ui-node-pc > title.pv-tip'));
    const svgText = canvasSvgFile ? (await canvasSvgFile()) : '';
    ok('the SVG export leaves them out', typeof svgText === 'string' ? !/pv-tip/.test(svgText) : !/pv-tip/.test(String(svgText && svgText.markup)), typeof svgText);
    state.settings.providerHover = false; renderCanvasOnly();

    // ---- 7. The spreadsheets ----
    open();
    const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
    const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
    const pvSheet = csvProvidersSheet();
    ok('providers.csv: every field, the service as its key', pvSheet.headers.join() === 'provider_id,name,service,contact,phone,email,account,support_hours,notes'
       && pvSheet.rows[0].slice(0, 3).join() === 'pT,Telmex,internet', pvSheet.headers.join());
    ok('offered once there is a provider', CSV_SHEETS.find((x) => x.key === 'providers').shown());
    ok('devices.csv names the provider', (() => { const d = csvDevicesSheet(); const i = d.headers.indexOf('provider'); return i > -1 && d.rows.find((r) => r.includes('Gateway'))[i] === 'Telmex'; })());
    ok('cables.csv as cable_provider', (() => { const c = csvCablesSheet(); const i = c.headers.indexOf('cable_provider'); return i > -1 && c.rows.find((r) => r[0] === 'w1')[i] === 'Telmex'; })());
    ok('groups.csv too', (() => { const g = csvGroupsSheet(); const i = g.headers.indexOf('provider'); return i > -1 && g.rows.find((r) => r[0] === 'gR')[i] === 'Acme IT'; })());
    const pPlan = planOf(csvText(pvSheet));
    ok('providers.csv is read as a sheet of providers, unchanged', pPlan.kind === 'providers' && pPlan.counts.same === 2 && !pPlan.ops.length, JSON.stringify(pPlan.counts));
    const edited = planOf('provider_id,name,phone,service\r\n,Telmex,800 999 0000,isp\r\n,New Alarm Co,55 1111 2222,alarm\r\n');
    ok('by name: a change, and a new one', edited.counts.change === 1 && edited.counts.add === 1, JSON.stringify(edited.rows.map((r) => r.status + ':' + r.why)));
    applyCsvPlan(edited);
    ok('applied', providerById('pT').phone === '800 999 0000' && state.providers.some((p) => p.name === 'New Alarm Co' && p.service === 'security'));
    undo();
    const badRef = planOf('name,provider\r\nGateway,Nobody Inc\r\n');
    ok('a device sheet naming an unknown provider is refused for that row', badRef.counts.conflict === 1, JSON.stringify(badRef.rows.map((r) => r.why)));
    // The whole round trip into a blank map: providers first, as Wi-Fi.
    const sig = () => JSON.stringify({ p: state.providers, n: state.nodes.map((n) => [n.name, n.provider ? providerById(n.provider).name : '']), l: state.links.map((l) => [l.id, l.provider ? providerById(l.provider).name : '']), g: state.groups.map((g) => [g.name, g.provider ? providerById(g.provider).name : '']) });
    const want = sig();
    const sheets = { P: csvText(csvProvidersSheet()), G: csvText(csvGroupsSheet()), S: csvText(csvSubnetsSheet()), D: csvText(csvDevicesSheet()), I: csvText(csvInterfacesSheet()), C: csvText(csvCablesSheet()) };
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    const why = [];
    ['P', 'G', 'S', 'D', 'I', 'C'].forEach((k) => { const pl = planOf(sheets[k]); pl.rows.filter((r) => r.status === 'conflict').forEach((r) => why.push(`${k} ${r.name}: ${r.why}`)); applyCsvPlan(pl); });
    ok('every provider and every reference round-trips into a blank map', sig() === want && !why.length, why.slice(0, 3).join(' | ') || sig().slice(0, 200));

    // ---- 8. Settings ----
    ok('the menu is Export, Settings beside it', /Export/.test(el('exportMenuBtn').textContent) && !/File/.test(el('exportMenuBtn').textContent) && /Settings/.test(el('settingsBtn').textContent));
    el('settingsBtn').click(); await tick();
    ok('Settings opens, with the map, the reports and About', settingsOpen() && !!el('setProviderHover') && !!el('setEngineer') && /About/.test(el('setAboutHead').textContent)
       && /Nothing you add here is uploaded/.test(el('settingsDialog').textContent) && new RegExp(`Document version ${DOC_VERSION}`).test(el('setVersion').textContent));
    ok('the provider on hover starts off', el('setProviderHover').checked === false);
    change(el('setProviderHover'), true);
    ok('ticked, it is this browser\'s setting, not the document\'s', state.settings.providerHover === true && !/providerHover/.test(JSON.stringify(saved()))
       && JSON.parse(localStorage.getItem(SETTINGS_KEY)).providerHover === true);
    change(el('setProviderHover'), false);
    change(el('setMapInk'), 'blue');
    ok('the background follows', el('canvasContainer').classList.contains('map-blue'));
    change(el('setMapInk'), '');
    input(el('setEngineer'), 'Miguel Carino — Carino Systems');
    change(el('setReportSummary'), false);
    change(el('setReportTechnical'), false);
    ok('the parts: one stays ticked', el('setReportSummary').checked === true && el('setReportTechnical').checked === false, [el('setReportSummary').checked, el('setReportTechnical').checked].join());
    closeSettings();
    ok('Done closes it', !settingsOpen());
    open({ v: DOC_VERSION, nodes: [N('a', 'pc')], links: [] });
    openReportDialog();
    ok('the report dialog starts with Prepared by and the parts Settings gave', el('report-engineer').value === 'Miguel Carino — Carino Systems'
       && el('reportSummary').checked && !el('reportTechnical').checked);
    closeReportDialog();
    state.report = { engineer: 'Someone Else' };
    openReportDialog();
    ok('a network that names someone keeps its own', el('report-engineer').value === 'Someone Else');
    closeReportDialog();
    // Spanish: the tab, the dialog and a card.
    setLocale('es'); applyLocale();
    open();
    showConfigTab('providers');
    ok('es: the tab, the menu and Settings', el('providerTabBtn').textContent === 'Proveedores' && /Exportar/.test(el('exportMenuBtn').textContent) && /Ajustes/.test(el('settingsBtn').textContent)
       && /Responsable de/.test(el('providerList').textContent), el('providerTabBtn').textContent);
    setLocale('en'); applyLocale();
    showConfigTab('config');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(held);
    Object.keys(state.settings).forEach((k) => { if (!(k in heldSettings)) delete state.settings[k]; });
    Object.assign(state.settings, heldSettings);
    saveSettings();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
