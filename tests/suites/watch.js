// Watched addresses and Record only (docs/SCOPE.md D371-D374, D380, step 8d):
//   1. the model (v20): one address each (an IPv4, an IPv6, a host name;
//      never a subnet, a range or a wildcard), at most 64, Record only by
//      default, the checks without `ip`, references to what the document
//      lacks dropped, no key when there are none, a v19 document migrated,
//      a device's `outage: 'record'`, an incident's watchIds and an
//      outage's recordOnly;
//   2. the plan: a watched address's checks under "w:<id>", its address
//      asked, its chain through the device it is reached through, Record
//      only on the item (a device set so, a watched address by default);
//      an unchecked one is not planned;
//   3. issues: a record of a watched address folds into an outage naming
//      watchIds; a Record only record folds closed, marked recordOnly, says
//      "Recorded only" and is nothing to act on; a provider of the address
//      may act on it;
//   4. routing: the watched address's provider first, "for {name}";
//   5. the merge: theirs added, matched by address, an incident's watchIds
//      remapped; caps;
//   6. the report: a watched address's row beside the devices, its outage
//      marked "Recorded only", "Checked: 1 device and 1 watched address";
//   7. not checked is not down (D380): with no checks no dot on the map, no
//      dot on a row, no row in the report, nothing counted;
//   8. the Watched tab: rows, Add an address (an address refused, one undo
//      step), Edit, a check added, Quiet, Delete (asked), Add to the map (a
//      device with its checks, cabled to the device it is reached through,
//      its outages naming the device), read only; states shown only while
//      known; Simple's read-only rows;
//   9. watched.csv: exported once there is one, read back as watched
//      addresses (never as devices), a change and an addition planned;
//  10. the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 200) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const el = (id) => document.getElementById(id);
  const CK = window.TopoChecks;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  let heldResponder = null;
  try {
    setLocale('en');
    const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    const site = () => ({
      v: DOC_VERSION,
      providers: [{ id: 'pI', name: 'Fibra Norte', service: 'internet', phone: '1' }, { id: 'pT', name: 'Andes IT', service: 'it', phone: '2' }],
      groups: [{ id: 'gB', name: 'Office', kind: 'building' }],
      nodes: [
        N('isp', 'cloud'), N('rt', 'router', { interfaces: [{ id: 'i1', name: 'lan', ip: '10.0.0.1/24' }], checks: [{ id: 'p', proto: 'ping' }] }),
        N('sw', 'switch', { group: 'gB', interfaces: [{ id: 'i1', name: 'mgmt', ip: '10.0.0.2/24' }], checks: [{ id: 'p', proto: 'ping' }], outage: 'record' }),
        N('pc', 'pc', { group: 'gB' })
      ],
      links: [{ id: 'l0', source: 'isp', target: 'rt' }, { id: 'l1', source: 'rt', target: 'sw' }, { id: 'l2', source: 'sw', target: 'pc' }],
      watch: [
        { id: 'wa1', name: 'Public DNS', address: '1.1.1.1', via: 'rt', providers: ['pI'], checks: [{ id: 'c1', proto: 'dns', name: 'example.com' }] },
        { id: 'wa2', name: 'Cloud app', address: 'app.example.com', group: 'gB', outage: 'raise', target: 99.5, checks: [{ id: 'c1', proto: 'https', ip: '10.9.9.9' }] },
        { id: 'wa3', name: 'Not checked', address: '2001:db8::1' }
      ]
    });

    // ---- 1. The model ----
    const W = (address) => normalizeWatch([{ id: 'x', address }])[0] || null;
    ok('an IPv4, an IPv6 and a host name are addresses', !!W('192.0.2.1') && !!W('2001:db8::5') && W('pacs.clinic.local').address === 'pacs.clinic.local' && W(' dns.google. ').address === 'dns.google');
    ok('never a subnet, a range or a wildcard', ['10.0.0.0/24', '10.0.0.1-20', '10.0.0.*', '10.0.0.1, 10.0.0.2', '*.example.com', '10.0.0', ''].every((a) => W(a) === null),
      show(['10.0.0.0/24', '10.0.0.1-20', '10.0.0.*', '10.0.0'].map((a) => W(a))));
    ok('at most 64', normalizeWatch(Array.from({ length: 70 }, (_, i) => ({ address: `192.0.2.${i}` }))).length === WATCH_MAX && WATCH_MAX === 64);
    replaceDocument(clone(site()));
    const s1 = serializeDoc();
    ok('kept as written, the checks without ip, Record only left unwritten', show(s1.watch[0]) === show({ id: 'wa1', name: 'Public DNS', address: '1.1.1.1', via: 'rt', providers: ['pI'], checks: [{ id: 'c1', proto: 'dns', name: 'example.com' }] })
      && show(s1.watch[1].checks) === '[{"id":"c1","proto":"https"}]' && s1.watch[1].outage === 'raise' && s1.watch.length === 3, show(s1.watch));
    ok('a device set to Record only says so; one that raises writes nothing', s1.nodes.find((n) => n.id === 'sw').outage === 'record' && s1.nodes.find((n) => n.id === 'rt').outage === undefined && !JSON.stringify(s1.nodes.find((n) => n.id === 'rt')).includes('outage'));
    ok('Record only is the default of a watched address, Raise an issue of a device', watchRecordsOnly(state.watch[0]) && !watchRecordsOnly(state.watch[1]) && !nodeRecordsOnly(getNode('rt')) && nodeRecordsOnly(getNode('sw')));
    const dangling = normalizeWatch([{ id: 'w9', address: '192.0.2.9', via: 'ghost', group: 'gX', providers: ['pX', 'pI'] }], { nodes: state.nodes, groups: state.groups, providers: state.providers })[0];
    ok('a device, group or provider the document lacks is dropped', !dangling.via && !dangling.group && show(dangling.providers) === '["pI"]', show(dangling));
    replaceDocument({ v: DOC_VERSION, nodes: [N('a', 'pc')], links: [] });
    ok('none: no key, as a v19 document', serializeDoc().watch === undefined && !JSON.stringify(serializeDoc()).includes('watch'));
    const m19 = migrateDoc({ v: 19, nodes: [], links: [] });
    ok('a v19 document migrates to v20 with nothing to convert', DOC_VERSION === 20 && m19.doc.v === 20 && m19.from === 19 && !m19.newer && !('watch' in m19.doc));
    const inc = normalizeIncident({ id: 'inabc1234567', at: 1, status: 'open', symptom: 'other', nodeIds: [], watchIds: ['wa1', 'gone'], kind: 'outage', recordOnly: true, outages: [{ from: 5 }] },
      { nodes: [], watch: [{ id: 'wa1' }] });
    ok('an incident names watched addresses; an outage says Record only', show(inc.watchIds) === '["wa1"]' && inc.recordOnly === true, show(inc));

    // ---- 2. The plan ----
    replaceDocument(clone(site()));
    const plan = CK.monitorPlan({ nodes: state.nodes, links: state.links, groups: state.groups, watch: state.watch }, {});
    const item = (k) => plan.items.find((i) => i.key === k);
    ok('a watched address is planned under w:<id>', !!item('w:wa1/c1') && item('w:wa1/c1').nodeId === 'w:wa1' && item('w:wa1/c1').nodeName === 'Public DNS', show(plan.items.map((i) => i.key)));
    ok('its address is asked, with the check\'s options', item('w:wa1/c1').spec.host === '1.1.1.1' && item('w:wa1/c1').spec.proto === 'dns' && item('w:wa1/c1').spec.name === 'example.com'
      && item('w:wa2/c1').spec.host === 'app.example.com');
    ok('reached through the router: its chain ends with it', show(item('w:wa1/c1').chain) === '["rt"]' && show(item('w:wa2/c1').chain) === '[]', show(item('w:wa1/c1').chain));
    ok('its group for its quiet windows', show(item('w:wa2/c1').groups) === '["gB"]');
    ok('Record only on the item: a watched address by default, a device set so', item('w:wa1/c1').recordOnly === true && item('w:wa2/c1').recordOnly === false
      && item('sw/p').recordOnly === true && item('rt/p').recordOnly === false);
    ok('a watched address with no check is not asked anything', !plan.items.some((i) => i.nodeId === 'w:wa3'));

    // ---- 3. Issues ----
    const TI = window.TopoIssues;
    const recW = { id: 'inw000000001', networkId: 'k', nodeId: 'w:wa1', name: 'Public DNS', keys: ['w:wa1/c1'], outages: [{ from: 1000 }], recordOnly: true, closed: 1000, acts: [], rev: 1 };
    const folded = normalizeIncident(TI.outageFromRecord(recW, null, serializeDoc()), { nodes: state.nodes, watch: state.watch });
    ok('a watched address\'s record folds into an outage naming it', folded.kind === 'outage' && show(folded.watchIds) === '["wa1"]' && folded.nodeIds.length === 0, show(folded));
    ok('Record only: closed as it opened, marked', folded.recordOnly === true && folded.status === 'closed' && folded.closedAt === 1000);
    state.incidents.push(folded);
    const recR = { id: 'inw000000002', networkId: 'k', nodeId: 'w:wa2', name: 'Cloud app', keys: ['w:wa2/c1'], outages: [{ from: 2000 }], acts: [], rev: 1 };
    const raised = normalizeIncident(TI.outageFromRecord(recR, null, serializeDoc()), { nodes: state.nodes, watch: state.watch });
    ok('one that raises an issue stays open', raised.status === 'open' && !raised.recordOnly && show(raised.watchIds) === '["wa2"]');
    state.incidents.push(raised);
    renderIncidentsPanel();
    showConfigTab('incidents'); await tick();
    const rowOf = (id) => document.querySelector(`[data-inc="${id}"]`);
    ok('the Problems tab: the recorded one says Recorded only, with its name', !!rowOf(folded.id) && /Recorded only/.test(rowOf(folded.id).textContent) && /Public DNS/.test(rowOf(folded.id).textContent),
      rowOf(folded.id) && rowOf(folded.id).textContent);
    ok('…and offers nothing to act on; the raised one does', !rowOf(folded.id).querySelector('button[data-act], .inc-acts button') && /Not answering/.test(rowOf(raised.id).textContent));
    ok('the banner and the open problems count the raised one only', liveIncidents().some((x) => x.id === raised.id) && !liveIncidents().some((x) => x.id === folded.id));

    // ---- 4. Routing ----
    const route = routeIncident(undefined, { watchIds: ['wa1'], symptom: 'other' });
    ok('its provider first, "for Public DNS"', route.results[0].provider.id === 'pI' && /for Public DNS/.test(route.results[0].reason), show(route.results.map((r) => [r.provider.id, r.reason])));

    // ---- 5. The merge ----
    const mine = serializeDoc();
    const theirs = clone(mine);
    theirs.watch.push({ id: 'wa7', name: 'NTP', address: 'pool.ntp.org', checks: [{ id: 'c1', proto: 'ntp' }] });
    theirs.watch.find((w) => w.id === 'wa1').name = 'Cloudflare DNS';
    const plan5 = TopoMerge.planMerge(mine, theirs, mine);
    const res5 = TopoMerge.applyMergePlan(mine, plan5);
    ok('the merge adds theirs and takes their change', res5.doc.watch.length === 4 && res5.doc.watch.find((w) => w.id === 'wa1').name === 'Cloudflare DNS'
      && res5.doc.watch.some((w) => w.address === 'pool.ntp.org'), show(res5.doc.watch.map((w) => [w.id, w.name])));
    const theirs2 = clone(mine);
    theirs2.watch = [{ id: 'other', name: 'DNS', address: '1.1.1.1' }];
    const plan6 = TopoMerge.planMerge(mine, theirs2, null);
    ok('two-way, the same address under another id is the same watched address', plan6.items.filter((it) => it.kind === 'watch' && it.status === 'added').length === 0, show(plan6.items.filter((it) => it.kind === 'watch').map((it) => [it.status, it.key])));

    // ---- 6. The report ----
    const RP = window.TopoReports;
    const HOUR = 3600000, TO = Math.floor(Date.now() / HOUR) * HOUR;
    const range = { kind: 'week', from: TO - 7 * 24 * HOUR, to: TO, now: TO + 1000 };
    const H = (hour, f = {}) => Object.assign({ hour, checks: 60, ok: 60, fail: 0, rttMed: 4, rttP95: 9, sUp: 3600, sSlow: 0, sDown: 0, sUpstream: 0, sMaint: 0, sUnknown: 0 }, f);
    const hrs = []; for (let h = range.from; h < range.to; h += HOUR) hrs.push(H(h));
    const docR = serializeDoc();
    docR.incidents = [Object.assign(clone(folded), { outages: [{ from: TO - 5 * HOUR, to: TO - 4 * HOUR }] })];
    const m = RP.buildModel(docR, { source: 'local', streams: [{ key: 'rt/p', hours: hrs }, { key: 'w:wa1/c1', hours: hrs }] }, { scope: 'site', period: 'week', range, parts: RP.PARTS });
    ok('the watched address has its row beside the devices', m.rows.some((r) => r.key === 'w:wa1/c1' && r.name === 'Public DNS') && m.rows.some((r) => r.key === 'rt/p'), show(m.rows.map((r) => r.key)));
    ok('what was checked is named, never more', m.checkedDevices === 2 && m.checkedWatch === 2, show([m.checkedDevices, m.checkedWatch]));
    const html = RP.reportHtml ? RP.reportHtml(m) : '';
    ok('the report says what was checked', /Checked: 2 devices and 2 watched addresses\. Anything not checked has no figures here\./.test(html), html.slice(0, 300));
    ok('its outage is listed, marked Recorded only', m.outages.length === 1 && m.outages[0].recordOnly && m.outages[0].name === 'Public DNS' && /Recorded only: no issue was raised\./.test(html));

    // ---- 7. Not checked is not down (D380) ----
    const bare = { v: DOC_VERSION, nodes: [N('a', 'server', { interfaces: [{ id: 'i1', ip: '10.0.0.5/24' }] })], links: [], watch: [{ id: 'w1', address: '192.0.2.1' }] };
    const mb = RP.buildModel(bare, { source: 'local', streams: [] }, { scope: 'site', period: 'week', range, parts: RP.PARTS });
    ok('no checks: no row, nothing counted, nothing said checked', mb.rows.length === 0 && mb.checkedDevices === 0 && mb.checkedWatch === 0 && !/Checked:/.test(RP.reportHtml ? RP.reportHtml(mb) : ''));
    ok('no checks: no dot on the map', checkMarkEl(bare.nodes[0]) === null);
    ok('no checks: no look for a watched address, even with a monitor', CK.holderLook(CK.watchHolder(bare.watch[0])) === null);

    // ---- 8. The Watched tab ----
    persistLibrary({ kw: { id: 'kw', name: 'HQ', doc: clone(site()), created: 1, updated: Date.now() - 1000 } });
    replaceDocument(libraryEntry('kw').doc, { libraryId: 'kw', origin: 'library' });
    showConfigTab('watch'); await tick();
    const rows = () => [...el('watchList').querySelectorAll('.wt-card')];
    ok('the tab: a row each, the rule said once', rows().length === 3 && /Topo checks only what you ask it to\. Anything not checked has no state\./.test(el('cfgPanel-watch').textContent), String(rows().length));
    ok('no monitor here: no dot on any row', !el('watchList').querySelector('.ck-dot'));
    ok('a row: what an outage does and its checks', /Record only · DNS · Reached through RT/.test(rows()[0].textContent) && /Raises an issue · HTTPS/.test(rows()[1].textContent) && /Not checked/.test(rows()[2].textContent),
      rows().map((r) => r.querySelector('.net-line').textContent).join(' | '));
    ok('a host name cannot go on the map', rows()[1].querySelector('[data-wact="map"]').disabled && !rows()[0].querySelector('[data-wact="map"]').disabled);
    // States, with a monitor that watches this network.
    CK.state.invoke = async () => [];
    CK.state.info = { on: true, networkId: 'kw', networkName: 'HQ' };
    CK.onStatuses([{ key: 'w:wa1/c1', nodeId: 'w:wa1', state: 'down', since: Date.now() - 60000, status: '' }]);
    TopoWatch.render(true);
    ok('with a monitor: the checked rows have a dot, the unchecked one none', rows()[0].querySelector('.ck-dot.ck-down') && rows()[1].querySelector('.ck-dot.ck-unknown') && !rows()[2].querySelector('.ck-dot'),
      rows().map((r) => (r.querySelector('.ck-dot') || {}).className).join(' | '));
    ok('…and says how it is now', /Not answering since/.test(rows()[0].textContent));
    ok('Quiet for… is offered on a checked row only', !!rows()[0].querySelector('select[data-wact="quiet"]') && !rows()[2].querySelector('select[data-wact="quiet"]'));
    let quietAsked = null;
    CK.state.invoke = async (cmd, args) => { if (cmd === 'monitor_quiet') { quietAsked = args; return CK.state.info; } return []; };
    const qs = rows()[0].querySelector('select[data-wact="quiet"]');
    qs.value = '1h'; qs.dispatchEvent(new Event('change', { bubbles: true }));
    ok('Quiet for 1 hour goes to the monitor under its w: id', await until(() => !!quietAsked) && quietAsked.scope === 'node' && quietAsked.id === 'w:wa1' && quietAsked.until > Date.now(), show(quietAsked));
    // Add an address.
    const undoDepth = () => (state.history ? state.history.length : (typeof undoStack !== 'undefined' ? undoStack.length : 0));
    const before = JSON.stringify(serializeDoc());
    el('addWatchBtn').click(); await tick();
    ok('Add an address: the sheet, Record only ticked, a ping', !el('watchDialog').hidden && el('watchDlgTitle').textContent === 'Add an address'
      && el('watchBody').querySelector('input[name="watchOutage"][value="record"]').checked && el('watchBody').querySelectorAll('.ck-card').length === 1);
    el('watchName').value = 'ISP gateway'; el('watchAddress').value = '10.0.0.0/24';
    el('watchSaveBtn').click(); await tick();
    ok('a subnet is refused, said why, nothing saved', /Not a range, a subnet or a wildcard/.test(el('watchError').textContent) && JSON.stringify(serializeDoc()) === before);
    el('watchAddress').value = '200.1.1.1';
    el('watchVia').value = 'rt';
    el('watchBody').querySelector('[data-ck="add"]').click(); await tick();
    const proto = el('watchBody').querySelectorAll('.ck-card select[data-f="proto"]')[1];
    proto.value = 'tcp'; proto.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    const port = el('watchBody').querySelectorAll('.ck-card input[data-f="port"]')[1];
    port.value = '443'; port.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    ok('a second check added in the sheet', el('watchBody').querySelectorAll('.ck-card').length === 2 && el('watchName').value === 'ISP gateway', String(el('watchBody').querySelectorAll('.ck-card').length));
    el('watchSaveBtn').click(); await tick();
    const added = state.watch.find((w) => w.address === '200.1.1.1');
    ok('saved: its name, address, device, checks, Record only', !!added && added.name === 'ISP gateway' && added.via === 'rt' && show(added.checks.map((c) => [c.proto, c.port || null])) === '[["ping",null],["tcp",443]]'
      && !added.outage && el('watchDialog').hidden, show(added));
    undo(); await tick();
    ok('one undo step takes it back', JSON.stringify(serializeDoc()) === before && !state.watch.some((w) => w.address === '200.1.1.1'));
    redo(); await tick();
    // Edit.
    TopoWatch.openSheet('wa1'); await tick();
    el('watchBody').querySelector('input[name="watchOutage"][value="raise"]').checked = true;
    el('watchSaveBtn').click(); await tick();
    ok('Edit: set to Raise an issue', state.watch.find((w) => w.id === 'wa1').outage === 'raise');
    // Delete, asked.
    heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : undefined));
    rows().find((r) => r.dataset.wt === 'wa3').querySelector('[data-wact="delete"]').click();
    ok('Delete, once asked', await until(() => !state.watch.some((w) => w.id === 'wa3')));
    // Add to the map.
    state.incidents = [normalizeIncident(Object.assign(clone(folded), { id: 'inw000000009' }), { nodes: state.nodes, watch: state.watch })];
    const node = TopoWatch.addToMap('wa1');
    ok('Add to the map: a device with its checks, cabled to the router', !!node && node.type === 'cloud' && node.interfaces[0].ip === '1.1.1.1' && show(node.checks) === '[{"id":"c1","proto":"dns","name":"example.com"}]'
      && state.links.some((l) => l.source === 'rt' && l.target === node.id), show(node));
    ok('…it leaves the list; its outages name the device', !state.watch.some((w) => w.id === 'wa1') && show(state.incidents[0].nodeIds) === show([node.id]) && !state.incidents[0].watchIds);
    ok('…its providers and what an outage does go with it', show(node.providers) === '["pI"]' && !node.outage);
    // Read only.
    state.readOnly = { doc: clone(serializeDoc()), loaded: JSON.stringify(serializeDoc()) };
    TopoWatch.render(true);
    ok('read only: the rows, no Add, no Edit, no Delete', rows().length === state.watch.length && el('addWatchBtn').classList.contains('hidden')
      && !el('watchList').querySelector('[data-wact="delete"]') && !el('watchList').querySelector('[data-wact="map"]'));
    state.readOnly = null;
    // Simple's rows: only what has a state here.
    CK.onStatuses([{ key: 'w:wa2/c1', nodeId: 'w:wa2', state: 'up', since: Date.now() - 60000, rttMs: 12, status: '' }]);
    const simple = TopoWatch.simpleRows();
    ok('Simple: a read-only row for each checked address with a state', simple.length === 2 && simple.some((li) => /Cloud app/.test(li.textContent) && /Answering · 12 ms/.test(li.textContent)), simple.map((li) => li.textContent).join(' | '));
    CK.state.info = null; CK.state.status.clear(); CK.state.invoke = null;
    ok('Simple: no monitor, no rows', TopoWatch.simpleRows().length === 0);

    // ---- 9. watched.csv ----
    const sheet = CSV_SHEETS.find((s) => s.key === 'watched');
    const built = sheet.build();
    ok('watched.csv: its columns, a row each, the device by name', show(built.headers) === show(['watch_id', 'name', 'address', 'group', 'reached_through', 'provider', 'raise_issue', 'availability_target', 'notes'])
      && built.rows.some((r) => r[2] === 'app.example.com' && r[3] === 'Office' && r[6] === 'true' && r[7] === '99.5')
      && built.rows.some((r) => r[2] === '200.1.1.1' && r[4] === 'RT' && r[6] === 'false'), show(built.rows));
    const text = [built.headers.join(','), 'wa2,Cloud app,app.example.com,,,Andes IT,false,,', ',Resolver,9.9.9.9,,RT,,,,'].join('\n');
    const pr = csvParse(text);
    const parsed = csvSheet(pr, csvHasHeadingRow(pr.rows));
    const map = csvAutoMap(parsed);
    const plan9 = csvPlan(parsed, map, {});
    ok('read back as watched addresses, never as devices', plan9.kind === 'watch' && plan9.counts.change === 1 && plan9.counts.add === 1,
      show({ map, kind: plan9.kind, counts: plan9.counts, errors: plan9.errors, rows: plan9.rows && plan9.rows.map((r) => [r.status, r.why]) }));

    // ---- 11. Step 8e: the TLS certificate check and Check the Internet (D375) ----
    ok('tls is a check: its port 443', CHECK_PROTOCOLS.includes('tls') && CHECK_PORTS.tls === 443 && CK.protoLabel('tls') === 'TLS certificate'
      && show(asCheck({ id: 'c', proto: 'tls', port: 636 }, false)) === '{"id":"c","proto":"tls","port":636}');
    const tlsPlan = CK.monitorPlan({ nodes: [N('dc', 'server', { interfaces: [{ id: 'i1', ip: '10.0.0.9/24' }], checks: [{ id: 't', proto: 'tls', port: 636 }] })], links: [] }, {});
    ok('…planned with its port, on a device too (LDAPS here)', tlsPlan.items[0].spec.proto === 'tls' && tlsPlan.items[0].spec.port === 636 && tlsPlan.items[0].spec.host === '10.0.0.9');
    ok('a name that does not resolve says so', /The name does not resolve from this PC\./.test(CK.nowText({ key: 'w:x/c', state: 'down', since: Date.now(), status: 'resolve' }, { id: 'w:x' })));
    ok('an address on the internet: a URL, a name, an address, an IPv6 address', show(TopoWatch.webTarget('https://status.example.com:8443/health?x=1')) === show({ address: 'status.example.com', port: 8443, path: '/health' })
      && TopoWatch.webTarget('app.example.com').address === 'app.example.com' && TopoWatch.webTarget('2001:db8::8').address === '2001:db8::8' && TopoWatch.webTarget('10.0.0.0/24') === null);
    const asked8e = [];
    let answers = ['200.1.1.254', '9.9.9.9', 'https://status.example.com/health'];
    setDialogResponder((req) => { asked8e.push(req); if (req.kind === 'prompt') return answers.shift(); return undefined; });
    batch(() => { getNode('rt').gw = '200.1.1.254'; save(); });
    const beforeNet = JSON.stringify(serializeDoc());
    const nWatch = state.watch.length;
    const made = await TopoWatch.checkTheInternet();
    ok('Check the Internet asks three things, the router\'s gateway offered first', asked8e.filter((r) => r.kind === 'prompt').length === 3 && asked8e[0].value === '200.1.1.254' && asked8e[1].value === '1.1.1.1',
      show(asked8e.map((r) => [r.kind, r.value])));
    const byName = (a) => state.watch.find((w) => w.address === a);
    ok('…and adds three watched addresses, reached through the router, Record only', made.length === 3 && state.watch.length === nWatch + 3 && made.every((w) => w.via === 'rt' && !w.outage), show(made));
    ok('…a ping to the gateway on the internet provider', show(byName('200.1.1.254').checks.map((c) => c.proto)) === '["ping"]' && show(byName('200.1.1.254').providers) === '["pI"]');
    ok('…a DNS question for the service\'s name to the resolver', byName('9.9.9.9').checks[0].proto === 'dns' && byName('9.9.9.9').checks[0].name === 'status.example.com');
    ok('…HTTPS to the service, its page', byName('status.example.com').checks[0].proto === 'https' && byName('status.example.com').checks[0].path === '/health');
    undo(); await tick();
    ok('one undo step takes the three back', JSON.stringify(serializeDoc()) === beforeNet);
    answers = ['', null];
    asked8e.length = 0;
    ok('Cancel on the second question adds nothing', (await TopoWatch.checkTheInternet()) === null && JSON.stringify(serializeDoc()) === beforeNet);
    answers = ['10.0.0.0/24', '', ''];
    asked8e.length = 0;
    ok('a subnet is not one address: said, nothing added', (await TopoWatch.checkTheInternet()) === null && asked8e.some((r) => r.kind === 'tell' && /10\.0\.0\.0\/24 is not one address/.test(r.message))
      && JSON.stringify(serializeDoc()) === beforeNet);
    setDialogResponder((req) => (req.kind === 'confirm' ? true : undefined));
    ok('the tab offers Check the Internet…', !!el('checkInternetBtn') && el('checkInternetBtn').textContent === 'Check the Internet…');

    // ---- 10. The strings ----
    const { has, locales } = window.CarinoI18N;
    const strs = ['Watched', '+ Address', 'Add an address', 'Edit the watched address', 'Record only', 'Raises an issue', 'Not checked', 'Add to the map', 'Recorded only',
      'Topo checks only what you ask it to. Anything not checked has no state.', 'Reached through {name}', 'When it is not answering', 'Watched addresses',
      'Record only: in the statistics and the monitoring report, no issue, no alarm', 'Raise an issue: the banner, and the alarm on PCs that show alarms',
      'One address: an IP address or a host name. Not a range, a subnet or a wildcard.', 'Checked: {what}. Anything not checked has no figures here.',
      'Recorded only: no issue was raised.', '{name} is on the map now, with its checks.', 'Rows of watched addresses: {n}', 'Watched address',
      'TLS certificate', 'One handshake on this port: the certificate\'s end date (a warning 14 days before). Nothing is sent after it.', 'The name does not resolve from this PC.',
      'Check the Internet', 'Check the Internet…', 'The internet provider\'s gateway: the address your router sends everything to. Leave it empty to skip.',
      'A public resolver to ask for a name. Leave it empty to skip.', 'An address on the internet to open over HTTPS, such as a service you use. Leave it empty to skip.',
      'Add the checks', 'Public resolver', 'Not added: {list} is not one address (an IP address or a host name).',
      '1 watched address added. It is checked from the PCs that monitor this network.', '{n} watched addresses added. They are checked from the PCs that monitor this network.', 'Next'];
    locales.forEach((loc) => { const missing = strs.filter((s) => !has(loc, s)); ok(`${loc} carries the strings`, !missing.length, missing.join(' | ')); });
    ok('no console error', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    if (heldResponder !== null) setDialogResponder(heldResponder);
    if (CK) { CK.state.info = null; CK.state.status.clear(); CK.state.invoke = null; }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
