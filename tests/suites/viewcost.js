// The table and the rack view at site scale, as one lookup pass each (speed
// plan, cluster "views"; js/table.js renderTableView, js/rackview.js
// renderRackView, rvDrawCables, rackOthersItems and renderPlaceDialog).
// What is held here:
//   1. the markup is the plain one: on every table tab, with and without a
//      search, sorted by two columns, #tvGrid is byte for byte what it is with
//      withLookupPass stubbed to a plain call (no indexes, no shared diagnosis);
//   2. the work is bounded: a table render walks the cable list and the device
//      list a few times, not once per row or per cell, and builds the
//      diagnosis key at most once, and not at all when the caller hands it the
//      diagnosis of the same render;
//   3. the rack view's markup and its wiring are the plain ones, front and
//      rear, for the cables all, selected and one, with and without a search,
//      on two racks of switches, a host with guests and a cable with no port;
//      its render is bounded the same way;
//   4. the selection: with all 300 devices selected the Devices tab is the
//      plain one (the render's own selection set, js/table.js _tvSel);
//   5. the place dialog's list and Other devices' list: the same ids, order
//      and disabled states as the plain ones, filtered and not.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const finish = () => {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  };
  const el = (id) => document.getElementById(id);
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
  const savedView = state.settings.view;
  const savedCables = _rv.cables;
  const heldResponder = setDialogResponder(() => null);

  // fn with every lookup pass a plain call: the answers without indexes.
  const unpassed = (fn) => {
    const real = window.withLookupPass;
    window.withLookupPass = (f) => f();
    try { return fn(); } finally { window.withLookupPass = real; }
  };
  // How many times a list is walked while fn runs (as perf.js counts them).
  const SCANS = new Set(['filter', 'find', 'forEach', 'some', 'map', 'every', 'findIndex', 'reduce', 'flatMap']);
  const scansOf = (key) => (fn) => {
    const real = state[key];
    let n = 0;
    state[key] = new Proxy(real, { get(target, k, recv) { if (SCANS.has(k)) n++; return Reflect.get(target, k, recv); } });
    try { fn(); } finally { state[key] = real; }
    return n;
  };
  const linkScans = scansOf('links'), nodeScans = scansOf('nodes');
  const keyBuilds = (fn) => {
    const real = JSON.stringify;
    let n = 0;
    JSON.stringify = function (v) { if (v === state.nodes) n++; return real.apply(this, arguments); };
    try { fn(); } finally { JSON.stringify = real; }
    return n;
  };
  // Where two strings first differ, for a failure's note.
  const diffAt = (a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i === a.length && i === b.length ? '' : `at ${i}: ${JSON.stringify(a.slice(i, i + 80))} vs ${JSON.stringify(b.slice(i, i + 80))}`;
  };

  try {
    await loadScript('tests/fixtures/site300.js');
    replaceDocument(topoSite300(), { origin: 'file' });
    // Two racks of five switches each, cabled to each other inside and across,
    // a host with two guests (one cabled), and a cable with no port at one end.
    const doc = cloneData(serializeDoc());
    doc.groups.push({ id: 'vc-ra', name: 'Cost rack A', kind: 'rack', parent: 'g-mdf', uHeight: 42 },
      { id: 'vc-rb', name: 'Cost rack B', kind: 'rack', parent: 'g-mdf', uHeight: 24 });
    const N = (id, type, extra) => Object.assign({ id, type, name: id.toUpperCase(), x: 3200, y: 400, interfaces: [] }, extra);
    ['a', 'b'].forEach((r, ri) => {
      for (let k = 1; k <= 5; k++) doc.nodes.push(N(`s-${r}${k}`, 'switch', { x: 3200 + k * 90, y: 600 + ri * 200, group: `vc-r${r}`, rackU: k * 2, portCount: 24 }));
    });
    const two = [{ id: 'i1', name: 'eth0', ip: '10.20.10.200/24' }, { id: 'i2', name: 'eth1', ip: '' }];
    doc.nodes.push(N('vh-a', 'server', { group: 'vc-ra', rackU: 20, rackHeight: 2, interfaces: two }),
      N('vm-1', 'vm', { host: 'vh-a', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.10.201/24' }] }),
      N('vm-2', 'vm', { host: 'vh-a', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.10.202/24' }] }));
    let seq = 0;
    const cab = (source, target, sourceIface, targetIface, extra) => doc.links.push(Object.assign({ id: `VC${++seq}`, source, target, sourceIface, targetIface }, extra || {}));
    ['a', 'b'].forEach((r) => {
      for (let k = 1; k < 5; k++) cab(`s-${r}${k}`, `s-${r}${k + 1}`, 'p24', 'p23', { cable: { label: `${r.toUpperCase()}-${k}`, color: k % 2 ? 'blue' : 'not a colour' } });
    });
    cab('s-a5', 's-b1', 'p1', 'p1', { cable: { label: 'X-AB' } });
    cab('s-a1', 'vh-a', 'p5', 'i1');
    cab('s-a2', 'vm-1', 'p6', 'i1');
    cab('s-a3', 'vh-a', 'p7', undefined);
    cab('core', 's-a1', 'p20', 'p22', { cable: { label: 'CORE-A' } });
    replaceDocument(doc, { origin: 'file' });
    renderCanvasOnly();
    ok('the site is the fixture plus the two racks', state.nodes.length === 313 && state.groups.some((g) => g.id === 'vc-rb'),
      `${state.nodes.length} devices`);

    // ---- 1, 2. The table ----
    setView('table');
    const tabs = TV_TABS.map((tb) => tb.key).filter(tvTabOffered);
    ok('the table offers its tabs, Wi-Fi among them', tabs.includes('wifi') && tabs.includes('groups'), tabs.join(','));
    _tv.expanded.add('rt'); _tv.expanded.add('core');
    selectEntries([{ type: 'node', id: 'rt' }]);
    const grid = () => el('tvGrid').innerHTML;
    const tvRender = (diag) => renderTableView(true, diag);
    const sorts = (tab) => tvCols(tab).filter((c) => c.sort);
    const mismatch = [];
    ['', 'sw'].forEach((q) => {
      setQuery(q);
      tabs.forEach((tab) => {
        showTableTab(tab);
        const cols = sorts(tab);
        const orders = [null, cols[0] ? { col: cols[0].key, dir: 1 } : null, cols.length > 1 ? { col: cols[cols.length - 1].key, dir: -1 } : null];
        orders.forEach((s, i) => {
          if (i && !s) return;
          if (s) _tv.sort[tab] = s; else delete _tv.sort[tab];
          tvRender();
          const real = grid();
          unpassed(() => tvRender());
          const plain = grid();
          if (real !== plain) mismatch.push(`${tab}/${q || '-'}/${s ? s.col + s.dir : 'unsorted'} ${diffAt(real, plain)}`);
        });
        delete _tv.sort[tab];
      });
    });
    ok('every tab, searched or not and sorted either way, is the plain markup', !mismatch.length, mismatch.slice(0, 3).join(' | '));
    setQuery('');
    ok('and the devices tab has rows to compare (the comparison is not of two empties)',
      (showTableTab('devices'), grid().includes('data-row="n:s-a1"')));

    const costs = {};
    tabs.forEach((tab) => {
      showTableTab(tab);
      const d = currentDiagnosis();
      costs[tab] = { links: linkScans(() => tvRender()), nodes: nodeScans(() => tvRender()),
        keys: keyBuilds(() => tvRender()), seeded: keyBuilds(() => tvRender(d)) };
    });
    const cj = JSON.stringify(costs);
    ok('a table render walks the cables a bounded number of times on every tab', Object.values(costs).every((c) => c.links <= 12), cj);
    ok('and the devices', Object.values(costs).every((c) => c.nodes <= 12), cj);
    ok('and builds the diagnosis key at most once', Object.values(costs).every((c) => c.keys <= 1), cj);
    ok('and never when it is handed the diagnosis', Object.values(costs).every((c) => c.seeded === 0), cj);

    // ---- 4. Every device selected ----
    selectEntries(state.nodes.filter((n) => !n.host).slice(0, 300).map((n) => ({ type: 'node', id: n.id })));
    showTableTab('devices');
    const allReal = grid();
    unpassed(() => tvRender());
    const allPlain = grid();
    ok('with 300 devices selected the devices tab is the plain markup', allReal === allPlain, diffAt(allReal, allPlain));
    ok('and shows them selected', (allReal.match(/aria-selected="true"/g) || []).length === 300,
      String((allReal.match(/aria-selected="true"/g) || []).length));
    ok('the render leaves no selection set behind', _tvSel === null);
    selectEntries([]);

    // ---- 3. The rack view ----
    const body = () => el('rackBody');
    const wiring = () => { const w = body().querySelector('.rk-wiring'); return w ? w.innerHTML : null; };
    const rackMis = [];
    let drawnWires = 0;
    ['vc-ra', 'vc-rb'].forEach((id) => {
      openRackView(id);
      ['', 'sw'].forEach((q) => {
        setQuery(q);
        ['front', 'rear'].forEach((face) => {
          _rv.face = face;
          ['all', 'sel', 'one'].forEach((mode) => {
            rvKeepCables(mode);
            if (mode === 'one') selectEntries([{ type: 'link', id: 'VC1' }]);
            else selectEntries([{ type: 'node', id: id === 'vc-ra' ? 's-a2' : 's-b2' }]);
            renderRackView(true);
            renderRackView(true);
            const real = body().innerHTML, realW = wiring();
            unpassed(() => renderRackView(true));
            const plain = body().innerHTML, plainW = wiring();
            if (realW) drawnWires++;
            if (real !== plain) rackMis.push(`${id}/${q || '-'}/${face}/${mode} body ${diffAt(real, plain)}`);
            else if (realW !== plainW) rackMis.push(`${id}/${q || '-'}/${face}/${mode} wiring`);
          });
        });
      });
    });
    setQuery('');
    _rv.face = 'front';
    ok('the rack view is the plain markup on both racks, both faces, every cable filter, searched or not', !rackMis.length, rackMis.slice(0, 3).join(' | '));
    ok('and its cables were drawn (the wiring compared is not empty)', drawnWires > 0, String(drawnWires));
    // Rack B last drawn; now A: the spots and rings are A's, from this render.
    openRackView('vc-ra');
    const spots = (m) => [...m.keys()].sort().join(',');
    ok('the no-port spots are this render\'s rack (set before the markup)', _rv.noPort instanceof Map
      && spots(_rv.noPort) === spots(rvNoPortLinks(currentRack())), spots(_rv.noPort));
    ok('and each has its spot in the markup', [..._rv.noPort.keys()].every((id) => !!body().querySelector(`.rk-dev[data-node="${CSS.escape(id)}"] .rk-noport`)));

    rvKeepCables('all');
    selectEntries([{ type: 'node', id: 's-a1' }]);
    const rd = currentDiagnosis();
    const rc = { links: linkScans(() => renderRackView(true)), keys: keyBuilds(() => renderRackView(true)), seeded: keyBuilds(() => renderRackView(true, rd)) };
    const rj = JSON.stringify(rc);
    ok('a rack render walks the cables a bounded number of times', rc.links <= 20, rj);
    ok('and builds the diagnosis key at most once', rc.keys <= 1, rj);
    ok('and never when it is handed the diagnosis', rc.seeded === 0, rj);

    // ---- 5. The place dialog and Other devices ----
    const items = () => [...el('rackPlaceList').querySelectorAll('.rkp-item')].map((b) => b.dataset.node + (b.disabled ? '!' : '')).join(',');
    const dlgMis = [];
    [[30, ''], [2, ''], [30, 'sw'], [2, 'pc']].forEach(([u, f]) => {
      openPlaceDialog({ rackId: 'vc-ra', face: 'front', u, height: 1 });
      el('rackPlaceFilter').value = f;
      renderPlaceDialog();
      const real = items(), realMsg = el('rackPlaceMsg').textContent, realCount = el('rackPlaceMapCount').textContent;
      unpassed(() => renderPlaceDialog());
      const plain = items();
      if (!real) dlgMis.push(`U${u}/${f || '-'} empty`);
      if (real !== plain || realMsg !== el('rackPlaceMsg').textContent || realCount !== el('rackPlaceMapCount').textContent) dlgMis.push(`U${u}/${f || '-'} ${diffAt(real, plain)}`);
      closePlaceDialog();
    });
    ok('the place dialog lists the same devices, in the same order, enabled the same', !dlgMis.length, dlgMis.join(' | '));

    _rv.othersOpen = true;
    renderRackView(true);
    const others = () => [...body().querySelectorAll('.rk-others-list li')].map((li) => {
      const b = li.querySelector('[data-node]');
      const dis = [...li.querySelectorAll('button')].some((x) => x.disabled);
      return (b ? b.dataset.node : li.textContent.trim()) + (dis ? '!' : '');
    }).join(',');
    const othMis = [];
    ['', 'pc', 'SW-ACC', 'nothing-is-called-this'].forEach((f) => {
      const input = body().querySelector('[data-rk-filter]');
      if (!input) { othMis.push('no filter'); return; }
      input.value = f;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const real = others();
      unpassed(() => input.dispatchEvent(new Event('input', { bubbles: true })));
      const plain = others();
      if (!real || real !== plain) othMis.push(`${f || '-'} ${diffAt(real, plain)}`);
    });
    ok('Other devices lists the same devices, in the same order, enabled the same, filtered or not', !othMis.length, othMis.join(' | '));
    _rv.othersFilter = '';
    _rv.othersOpen = false;

    // ---- The pass is shut after every render ----
    ok('no lookup pass is left open', lookupPass === null);
  } catch (e) {
    ok('the suite ran without throwing', false, (e && e.stack) || String(e));
  } finally {
    try { closePlaceDialog(); } catch (e) { /* not open */ }
    try { setQuery(''); } catch (e) { /* nothing to clear */ }
    try { rvKeepCables(savedCables); } catch (e) { /* kept as it was */ }
    selectEntries([]);
    setDialogResponder(heldResponder);
    state.settings.view = savedView;
    saveSettings();
    applyView();
    finish();
  }
}, 0); });
