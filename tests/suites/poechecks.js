// VLANs, trunks and PoE, stage 2b (docs/BACKLOG.md feature 4, landing order
// step 15): the PoE checks (poeFindings in js/diagnostics.js, the poe-near
// note in capacityFindings). What is held here:
//   1. poe-none: a device with a draw on a port that records no PoE, on a
//      switch that records a budget or a PoE port, is critical, naming the
//      device, the switch and the cable; on a switch that records nothing
//      about PoE, on a router's NIC, over a radio, from a retired device or
//      to a retired switch there is nothing; a device that also has a
//      powered cable is not flagged; a device with no draw never is;
//   2. poe-class: an 802.3af port with a 25.5 W device is advisory, naming
//      the standard and what it gives at the device; a custom-watts port
//      names its watts; the best of two powered ports is the one judged;
//      class 0, class 3 and 13 W on 802.3af are not flagged (the class
//      table's rounding), 13.1 W is; a custom port is compared on its watts;
//   3. poe-budget: over the budget is critical, naming the switch and its
//      powered devices, singular and plural, a retired device not counted;
//      90-100% is the info note poe-near (listed, never counted), exactly at
//      the budget a note and not over, under 90% nothing, no budget nothing;
//      a device retyped as a VM is not charged; a device on two switches'
//      PoE ports counts in full against each;
//   4. counted and read: the counts, has:finding, the report, the Simple
//      summary's plain words (PLAIN_FINDINGS, no "PoE" in them), the check
//      names;
//   5. accepting: poe-budget scoped to the budget (a new budget reopens it),
//      poe-near reopening when another powered device joins;
//   6. the samples: the Full Showcase records PoE (two switches, three
//      powered devices) and every template and simple sample raises no PoE
//      finding;
//   7. the words in es, pt-BR, ja and ru, no placeholder left, the decimal
//      comma, Russian keeping the count out of the plural.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const open = (nodes, links) => { replaceDocument({ v: DOC_VERSION, links: links || [], nodes }, { origin: 'file' }); initHistory(); };
  let x = 0;
  const sw = (id, extra) => ({ id, type: 'switch', name: id.toUpperCase(), x: (x += 80), y: 0, portCount: 8, interfaces: [], ...(extra || {}) });
  const cam = (id, draw, extra) => ({ id, type: 'camera', name: 'Cam ' + id.slice(-1), x: (x += 80), y: 100, ...(draw === null ? {} : { poeDraw: draw }),
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }], ...(extra || {}) });
  const cable = (id, s, si, tg, ti, extra) => ({ id, source: s, target: tg, sourceIface: si, targetIface: ti, ...(extra || {}) });
  const poe = () => topologyFindings().filter((f) => /^poe-/.test(f.key));
  const of = (key) => poe().filter((f) => f.key === key);
  const ids = (f) => (f ? f.nodeIds.slice().sort().join(',') : '');
  setLocale('en');

  try {
    // ---- 1. poe-none ----
    open([sw('sw', { portAttrs: { p1: { poe: 'at' } } }), cam('c1', 6.49), cam('c2', 6.49)],
      [cable('k1', 'sw', 'p1', 'c1', 'i1'), cable('k2', 'sw', 'p2', 'c2', 'i1')]);
    let f = of('poe-none');
    ok('a draw on a port with no PoE, on a switch with a PoE port: one critical finding', f.length === 1 && f[0].level === 'bad', show(poe()));
    ok('naming the device, the switch and the cable', ids(f[0]) === 'c2,sw' && show(f[0].linkIds) === '["k2"]', show(f[0]));
    ok('its words', f[0].detail === 'Cam 2 draws 6.49 W over its cable, but SW · 2 gives no PoE.' && f[0].check === 'PoE power' && f[0].subject === 'Cam 2', f[0].detail);
    ok('the powered one is fine', !poe().some((g) => g.nodeIds.includes('c1')), show(poe()));
    ok('it is counted as critical', findingCounts(topologyFindings()).critical === 1, show(findingCounts(topologyFindings())));

    open([sw('sw', { poeBudget: 120, portScheme: { prefix: 'Gi1/0/', start: 1 } }), cam('c1', 6.49)], [cable('k1', 'c1', 'i1', 'sw', 'p7')]);
    f = of('poe-none');
    ok('a budget alone documents the switch, and the port is named as the box names it', f.length === 1 && f[0].detail.includes('SW · Gi1/0/7 gives no PoE'), show(f));

    open([sw('sw'), cam('c1', 6.49)], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
    ok('on a switch that records nothing about PoE: nothing', !poe().length, show(poe()));
    open([{ id: 'rt', type: 'router', name: 'RT', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] }, sw('sw', { poeBudget: 60 }), cam('c1', 6.49)],
      [cable('k1', 'rt', 'i1', 'c1', 'i1')]);
    ok('cabled to a router\'s NIC: nothing (an injector is what Accept is for)', !poe().length, show(poe()));
    open([sw('sw', { poeBudget: 60 }), cam('c1', 6.49, { status: 'retired' })], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
    ok('a retired device is not judged', !poe().length, show(poe()));
    open([sw('sw', { poeBudget: 60, status: 'retired' }), cam('c1', 6.49)], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
    ok('nor a retired switch', !poe().length, show(poe()));
    open([sw('sw', { poeBudget: 60 }), cam('c1', null)], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
    ok('a device with no draw never is', !poe().length, show(poe()));
    open([sw('sw', { poeBudget: 60 }), cam('c1', 6.49)], [cable('k1', 'sw', 'p1', 'c1', 'i1', { medium: 'wireless' })]);
    ok('a radio link is not a cable: nothing', !of('poe-none').length, show(poe()));
    open([sw('sa', { portAttrs: { p1: { poe: 'af' } } }), sw('sb', { poeBudget: 60 }), cam('c1', 6.49, { interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }] })],
      [cable('k1', 'sa', 'p1', 'c1', 'i1'), cable('k2', 'sb', 'p1', 'c1', 'i2')]);
    ok('a device that also has a powered cable is not flagged on its other one', !poe().length, show(poe()));
    open([sw('sw', { poeBudget: 60 }), { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 200, poeDraw: 12, interfaces: [{ id: 'w1', name: 'wlan0', ip: '' }] }],
      [cable('k1', 'sw', 'p3', 'ap', 'p1')]);
    ok('an access point with a draw on a bare port: flagged too', of('poe-none').length === 1 && of('poe-none')[0].detail.includes('SW · 3'), show(poe()));

    // ---- 2. poe-class ----
    open([sw('sw', { portAttrs: { p7: { poe: 'af' } } }), cam('c1', 25.5)], [cable('k1', 'sw', 'p7', 'c1', 'i1')]);
    f = of('poe-class');
    ok('25.5 W on an 802.3af port: one advisory', f.length === 1 && f[0].level === 'warn' && !of('poe-none').length, show(poe()));
    ok('naming the standard and what it gives at the device', f[0].detail === 'Cam 1 asks 25.5 W; SW · 7 is 802.3af, 12.95 W at the device.', f[0].detail);
    ok('with the device, the switch and the cable', ids(f[0]) === 'c1,sw' && show(f[0].linkIds) === '["k1"]');
    open([sw('sw', { portAttrs: { p7: { poe: 20 } } }), cam('c1', 25.5)], [cable('k1', 'sw', 'p7', 'c1', 'i1')]);
    ok('a custom port names its watts', of('poe-class').length === 1 && of('poe-class')[0].detail === 'Cam 1 asks 25.5 W; SW · 7 gives 20 W.', show(poe()));
    open([sw('sw', { portAttrs: { p7: { poe: 'at' } } }), cam('c1', 25.5)], [cable('k1', 'sw', 'p7', 'c1', 'i1')]);
    ok('25.5 W on 802.3at: enough', !poe().length, show(poe()));
    open([sw('sa', { portAttrs: { p1: { poe: 'af' } } }), sw('sb', { portAttrs: { p1: { poe: 'bt3' } } }), cam('c1', 40, { interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }] })],
      [cable('k1', 'sa', 'p1', 'c1', 'i1'), cable('k2', 'sb', 'p1', 'c1', 'i2')]);
    ok('the best of two powered ports is the one judged', !poe().length, show(poe()));
    ['class 0', 'class 3', '13 W', '12.95'].forEach((typed) => {
      open([sw('sw', { portAttrs: { p1: { poe: 'af' } } }), cam('c1', poeDrawFromText(typed))], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
      ok('a device whose draw is "' + typed + '" on an 802.3af port: nothing (the class table rounds)', !poe().length, show(poe()));
    });
    open([sw('sw', { portAttrs: { p1: { poe: 'af' } } }), cam('c1', 13.1)], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
    ok('13.1 W on 802.3af is still more than it gives', of('poe-class').length === 1, show(poe()));
    open([sw('sw', { portAttrs: { p1: { poe: 15.4 } } }), cam('c1', 15.4)], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
    ok('a custom port is compared on its own watts (at the switch)', !poe().length, show(poe()));

    // ---- 3. poe-budget and poe-near ----
    const budgetDoc = (budget, extra) => open([sw('sw', { poeBudget: budget, portAttrs: { p1: { poe: 'at' }, p2: { poe: 'at' }, p3: { poe: 'at' } } }),
      cam('c1', 6.49), cam('c2', 6.49), cam('c3', 6.49, extra)],
      [cable('k1', 'sw', 'p1', 'c1', 'i1'), cable('k2', 'sw', 'p2', 'c2', 'i1'), cable('k3', 'sw', 'p3', 'c3', 'i1')]);
    budgetDoc(15);
    f = of('poe-budget');
    ok('over the budget: one critical finding', f.length === 1 && f[0].level === 'bad', show(poe()));
    ok('its words', f[0].detail === 'SW: 19.47 W drawn of a 15 W budget (3 devices).' && f[0].check === 'PoE budget' && f[0].subject === 'SW', f[0].detail);
    ok('naming the switch and its powered devices, scoped to the budget', ids(f[0]) === 'c1,c2,c3,sw' && f[0].scope === 'budget:15', show(f[0]));
    ok('no note beside it', !of('poe-near').length);
    budgetDoc(12, { status: 'retired' });
    f = of('poe-budget');
    ok('a retired device\'s draw is not counted', f.length === 1 && f[0].detail === 'SW: 12.98 W drawn of a 12 W budget (2 devices).' && !f[0].nodeIds.includes('c3'), show(f));
    open([sw('sw', { poeBudget: 5, portAttrs: { p1: { poe: 'at' } } }), cam('c1', 6.49)], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
    ok('one device: the singular', of('poe-budget').length === 1 && of('poe-budget')[0].detail === 'SW: 6.49 W drawn of a 5 W budget (1 device).', show(poe()));
    budgetDoc(20);
    f = of('poe-near');
    ok('97% of the budget: the info note', f.length === 1 && f[0].level === 'info' && !of('poe-budget').length, show(poe()));
    ok('its words', f[0].detail === 'SW draws 19.47 W of its 20 W PoE budget (97%).', f[0].detail);
    ok('not counted', !isCountedFinding(f[0]) && findingCounts(topologyFindings()).critical === 0 && findingCounts(topologyFindings()).advisory === 0, show(findingCounts(topologyFindings())));
    ok('naming the switch and its devices, scoped to the budget', ids(f[0]) === 'c1,c2,c3,sw' && f[0].scope === 'budget:20', show(f[0]));
    open([sw('sw', { poeBudget: 13, portAttrs: { p1: { poe: 'at' }, p2: { poe: 'at' } } }), cam('c1', 6.5), cam('c2', 6.5)],
      [cable('k1', 'sw', 'p1', 'c1', 'i1'), cable('k2', 'sw', 'p2', 'c2', 'i1')]);
    ok('exactly at the budget: the note, not over', of('poe-near').length === 1 && !of('poe-budget').length, show(poe()));
    budgetDoc(22);
    ok('under 90% (88%): nothing', !poe().length, show(poe()));
    open([sw('sw', { portAttrs: { p1: { poe: 'at' } } }), cam('c1', 99)], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
    ok('no budget: no budget finding', !of('poe-budget').length && !of('poe-near').length, show(poe()));
    open([sw('sw', { poeBudget: 15, portAttrs: { p1: { poe: 'at' } } }), cam('c1', 20)], [cable('k1', 'sw', 'p1', 'c1', 'i1')]);
    ok('a camera over the budget is found', of('poe-budget').length === 1, show(poe()));
    getNode('c1').type = 'vm';
    ok('retyped as a VM (its draw still in memory) it is not charged', !of('poe-budget').length && !of('poe-near').length && !poe().length, show(poe()));
    ok('nor shown on the box\'s load', poeLoad(getNode('sw')).used === 0 && !poeLoad(getNode('sw')).devices.length, show(poeLoad(getNode('sw'))));
    open([sw('sa', { poeBudget: 15, portAttrs: { p1: { poe: 'af' }, p2: { poe: 'af' } } }), sw('sb', { poeBudget: 30, portAttrs: { p1: { poe: 'at' } } }),
      { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 200, poeDraw: 12, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }, { id: 'i2', name: 'eth1', ip: '' }] }, cam('c2', 6.49)],
      [cable('k1', 'sa', 'p1', 'ap', 'i1'), cable('k2', 'sb', 'p1', 'ap', 'i2'), cable('k3', 'sa', 'p2', 'c2', 'i1')]);
    f = of('poe-budget');
    ok('a device on the PoE ports of two switches counts in full against each', poeLoad(getNode('sa')).used === 18.49 && poeLoad(getNode('sb')).used === 12
       && f.length === 1 && f[0].subject === 'SA' && ids(f[0]) === 'ap,c2,sa', show(poe()));

    // ---- 4. Counted, and where it is read ----
    open([sw('sw', { poeBudget: 10, portAttrs: { p1: { poe: 'at' }, p2: { poe: 'at' } } }), cam('c1', 6.49), cam('c2', 6.49), cam('c3', 6.49)],
      [cable('k1', 'sw', 'p1', 'c1', 'i1'), cable('k2', 'sw', 'p2', 'c2', 'i1'), cable('k3', 'sw', 'p3', 'c3', 'i1')]);
    const counts = findingCounts(topologyFindings());
    ok('the budget and the bare port: two criticals', counts.critical === 2 && of('poe-budget').length === 1 && of('poe-none').length === 1, show(counts));
    const q = parseQuery('has:finding');
    const hits = state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id).sort().join(',');
    ok('has:finding finds their devices', hits === 'c1,c2,c3,sw', hits);
    validateTopology();
    const lines = [...document.querySelectorAll('#conflictMsgList .ca-item')].map((li) => li.textContent);
    ok('the Findings tab lists both', lines.some((l) => l.includes('drawn of a 10 W budget')) && lines.some((l) => l.includes('gives no PoE')), show(lines));
    const rm = reportModel();
    ok('the report\'s findings hold both', rm.findings.some((g) => g.key === 'poe-budget') && rm.findings.some((g) => g.key === 'poe-none'));
    ok('and the technical sheet prints them', reportHtml(rm, null).includes('drawn of a 10 W budget'));
    const plain = summarySheet(rm);
    ok('the Simple summary says them in plain words', plain.includes('A switch is asked for more power than it can give') && plain.includes('A device that takes its power from the network cable is on a port that gives none'));
    const plainWords = ['poe-none', 'poe-class', 'poe-budget', 'poe-near'].map((k) => PLAIN_FINDINGS[k]);
    ok('PLAIN_FINDINGS has all four, and none says PoE or VLAN', plainWords.every((p) => Array.isArray(p) && p.length === 2 && p.every((s) => !/PoE|VLAN/.test(s))), show(plainWords));
    ok('the check names', FINDING_CHECK_NAMES['poe-none'] === 'PoE power' && FINDING_CHECK_NAMES['poe-class'] === 'PoE power'
       && findingCheckName('poe-budget') === 'PoE budget' && findingCheckName('poe-near') === 'PoE budget');

    // ---- 5. Accepting ----
    budgetDoc(15);
    ok('accepted with a reason, one undo step', acceptFindings([of('poe-budget')[0]], 'Spare supply fitted') && _undoStack.length === 1, String(_undoStack.length));
    ok('scoped to the budget', !!of('poe-budget')[0].accepted && state.accepted[0].scope === 'budget:15', show(state.accepted));
    getNode('sw').poeBudget = 16;
    ok('a new budget, still over: open again', of('poe-budget').length === 1 && !of('poe-budget')[0].accepted, show(of('poe-budget')));
    budgetDoc(20);
    acceptFindings([of('poe-near')[0]], 'Known');
    ok('the note accepted', !!of('poe-near')[0].accepted);
    state.nodes.push(cam('c4', 0.1));
    getNode('sw').portAttrs.p4 = { poe: 'af' };
    state.links.push(cable('k4', 'sw', 'p4', 'c4', 'i1'));
    ok('another powered device joining reopens it', of('poe-near').length === 1 && !of('poe-near')[0].accepted && of('poe-near')[0].nodeIds.includes('c4'), show(of('poe-near')));

    // ---- 6. The samples ----
    replaceDocument(cloneData(templatesData.showcase), { origin: 'template' });
    const csw = getNode('csw'), hsw = getNode('hsw');
    const cl = poeLoad(csw), hl = poeLoad(hsw);
    ok('the Full Showcase records PoE: the call centre\'s phones and the ward camera, on budgeted switches',
       cl && cl.budget === 120 && cl.devices.length === 2 && hl && hl.budget === 65 && hl.devices.length === 1, show([cl, hl]));
    ok('and raises no finding from it', !poe().length, show(poe()));
    const noisy = [];
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'template' });
      if (poe().length) noisy.push(`${k}: ${poe().map((g) => g.key + ' ' + g.subject).join(', ')}`);
    });
    ok('no template or simple sample raises a PoE finding', !noisy.length, noisy.join(' | '));

    // ---- 7. Translated ----
    open([sw('sw', { poeBudget: 10, portAttrs: { p1: { poe: 'af' }, p2: { poe: 'at' } } }), cam('c1', 25.5), cam('c2', 6.49), cam('c3', 6.49)],
      [cable('k1', 'sw', 'p1', 'c1', 'i1'), cable('k2', 'sw', 'p2', 'c2', 'i1'), cable('k3', 'sw', 'p3', 'c3', 'i1')]);
    ok('the translation fixture holds all three kinds', of('poe-none').length === 1 && of('poe-class').length === 1 && of('poe-budget').length === 1, show(poe()));
    const left = [];
    ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => {
      setLocale(loc);
      const fs = poe();
      const sheet = summarySheet(reportModel());
      fs.forEach((g) => {
        if (/\{[a-z]+\}/.test(g.detail + g.check)) left.push(`${loc}: placeholder in ${g.detail}`);
        if (/ over its cable| asks | drawn of a | at the device/.test(g.detail)) left.push(`${loc}: English left: ${g.detail}`);
        if (!g.detail.includes('SW')) left.push(`${loc}: name lost: ${g.detail}`);
      });
      if (/\{[a-z]+\}/.test(sheet)) left.push(`${loc}: placeholder in the summary`);
      if (sheet.includes('A switch is asked for more power') || sheet.includes('takes its power from the network cable')) left.push(`${loc}: plain words English`);
    });
    setLocale('en');
    ok('translated in es, pt-BR, ru and ja', !left.length, left.join(' | '));
    setLocale('es');
    ok('Spanish writes the decimal comma', of('poe-class')[0].detail === 'Cam 1 pide 25,5 W; SW · 1 es 802.3af, 12,95 W en el dispositivo.', of('poe-class')[0].detail);
    ok('and the budget', of('poe-budget')[0].detail === 'SW: 31,99 W consumidos de un presupuesto de 10 W (2 dispositivos).', of('poe-budget')[0].detail);
    setLocale('ru');
    ok('Russian keeps the count out of the plural', of('poe-budget')[0].detail === 'SW: потребление 31,99 Вт при бюджете 10 Вт (устройств: 2).', of('poe-budget')[0].detail);
    setLocale('ja');
    ok('Japanese', of('poe-none')[0].detail === 'Cam 3 はケーブルから 6.49 W を受電しますが、SW · 3 は PoE を供給しません。', of('poe-none')[0].detail);
  } catch (e) {
    ok('the suite ran', false, e && (e.stack || e.message));
  }
  setLocale('en');
  setDialogResponder(heldResponder);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 50); });
