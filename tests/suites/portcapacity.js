// Capacity, stage 2 (docs/BACKLOG.md feature 2, landing order step 5): the
// port-capacity note, and where it is read. What is held here:
//   1. the note (capacityFindings, portCapacityNote in js/model.js): an
//      explicit 8-port switch with 6 used gives nothing, with 7 a nearly
//      full note naming its free port, with 8 a full one; 24 ports with 21
//      used nothing, with 22 a note naming "23–24"; 9 cables on 8 ports only
//      the critical overflow, no note; an implicit switch, a one-port AP and
//      a retired switch nothing; a planned switch and a 4-port AP get one; a
//      bond's ports count as used; the port scheme names the free ports;
//   2. it is info: listed in the Findings tab (an info line, not a fault),
//      never counted (findingCounts, isCountedFinding), left out of the
//      report's findings and counts, no badge on the switch;
//   3. accepting it: one undo step, accepted with its reason, scoped to the
//      port count, so a full switch at the same count stays accepted and a
//      changed count reopens it; its check name (FINDING_CHECK_NAMES);
//   4. translated: the full and nearly full sentences, singular and plural,
//      the check name and the summary's words in es, pt-BR, ja and ru, no
//      placeholder left, Russian on the counting form;
//   5. the report: the port map lists a switch with nothing cabled (its
//      free ports, "Nothing is plugged in yet."), not a bare one-port AP,
//      and marks a nearly full one; the Capacity section after Addressing
//      and before Changes holds a Ports table naming only the noted
//      switches, and is left out when none is; the Simple summary's Room to
//      grow line totals the free ports of the switches whose count is set,
//      names the nearly full ones (cut after SUMMARY_WHERE_MAX), and is left
//      out when no port count is set;
//   6. has:full (js/query.js) finds exactly the noted switches;
//   7. the shipped samples: no simple sample raises the note (the
//      SIMPLE_SAMPLES "no finding at all" promise), and every template's
//      notes agree with the report's Capacity section.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const open = (doc) => replaceDocument({ v: DOC_VERSION, links: [], ...doc }, { origin: 'file' });
  const pc = (id) => ({ id, type: 'pc', name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0' }] });
  // A switch with `used` cables on p1..p<used>, each to a PC of its own.
  const rig = (id, extra, used) => {
    const sw = { id, type: 'switch', name: id.toUpperCase(), x: 0, y: 0, interfaces: [], ...extra };
    const pcs = [], links = [];
    for (let p = 1; p <= used; p++) {
      pcs.push(pc(`${id}h${p}`));
      links.push({ id: `${id}l${p}`, source: id, target: `${id}h${p}`, sourceIface: `p${p}`, targetIface: 'i1' });
    }
    return { nodes: [sw, ...pcs], links };
  };
  const doc = (...rigs) => ({ nodes: rigs.flatMap((r) => r.nodes), links: rigs.flatMap((r) => r.links) });
  const notes = () => topologyFindings().filter((f) => f.key === 'port-capacity');
  const noteOf = (id) => notes().find((f) => f.nodeIds[0] === id) || null;
  setLocale('en');

  try {
    // ---- 1. The note ----
    open(doc(rig('six', { portCount: 8 }, 6), rig('seven', { portCount: 8 }, 7), rig('eight', { portCount: 8 }, 8),
             rig('nine', { portCount: 8 }, 9), rig('w21', { portCount: 24 }, 21), rig('w22', { portCount: 24 }, 22),
             rig('imp', {}, 8), rig('old', { portCount: 8, status: 'retired' }, 8),
             rig('plan', { portCount: 8, status: 'planned' }, 7)));
    ok('8 ports with 6 used: nothing', !noteOf('six'));
    const seven = noteOf('seven');
    ok('with 7 used: an info note naming the free port', !!seven && seven.level === 'info'
       && seven.detail === 'SEVEN has 1 free port of 8: 8.' && seven.check === 'Port capacity' && seven.subject === 'SEVEN', show(seven));
    const eight = noteOf('eight');
    ok('with 8 used: the full wording', !!eight
       && eight.detail === 'EIGHT has no free port: 8 of 8 in use. Raise the port count if it is bigger, or plan another switch.', show(eight));
    const nine = topologyFindings().filter((f) => f.nodeIds.includes('nine'));
    ok('9 cables on 8 ports: only the critical overflow, no note', !noteOf('nine') && nine.some((f) => f.level === 'bad'),
       show(nine.map((f) => `${f.key}/${f.level}`)));
    ok('24 ports with 21 used: nothing', !noteOf('w21'));
    ok('with 22 used: a note naming the two free ports as a range', !!noteOf('w22') && noteOf('w22').detail === 'W22 has 2 free ports of 24: 23–24.',
       show(noteOf('w22')));
    ok('an implicit switch is never noted, however full', !noteOf('imp') && portCapacity(getNode('imp')).free === 0);
    ok('a retired switch is off the network: no note', !noteOf('old'));
    ok('a planned one is noted', !!noteOf('plan'));
    ok('notes name the switch, no cable, and carry the port count as their scope',
       notes().every((f) => f.nodeIds.length === 1 && !f.linkIds.length && f.scope === `ports:${portCapacity(getNode(f.nodeIds[0])).total}`));

    const ap1 = rig('ap1', { type: 'ap', portCount: 1 }, 1), ap4 = rig('ap4', { type: 'ap', portCount: 4 }, 4);
    open(doc(ap1, ap4));
    ok('an AP\'s single uplink port, used, gives nothing', !noteOf('ap1'));
    ok('a 4-port AP with all four used is full', !!noteOf('ap4') && /^AP4 has no free port: 4 of 4/.test(noteOf('ap4').detail), show(noteOf('ap4')));

    // A bond's ports are used, cabled or not; the port scheme names the free ones.
    const bonded = rig('lag', { portCount: 8, portScheme: { prefix: 'ge-0/0/', start: 0 } }, 5);
    bonded.nodes[0].interfaces = [{ id: 'p6', name: 'p6', bond: { mode: '802.3ad', members: ['p7'] } }];
    open(doc(bonded));
    const lag = noteOf('lag');
    ok('a bond and its member count as used, and the free port reads as the box names it',
       !!lag && lag.detail === 'LAG has 1 free port of 8: ge-0/0/7.', show(lag));

    // ---- 2. Info: listed, never counted ----
    open(doc(rig('seven', { portCount: 8 }, 7), rig('eight', { portCount: 8 }, 8)));
    const all = topologyFindings();
    const counts = findingCounts(all);
    ok('the notes are not counted', counts.critical === 0 && counts.advisory === 0 && counts.open === 0
       && all.filter((f) => f.key === 'port-capacity').every((f) => !isCountedFinding(f)), show(counts));
    ok('no badge on the switch', !nodeSeverity(getNode('seven')) && !nodeSeverity(getNode('eight')));
    const rm = reportModel();
    ok('the report\'s findings and counts leave them out', !rm.findings.some((f) => f.key === 'port-capacity')
       && rm.counts.critical === 0 && rm.counts.advisory === 0, show(rm.counts));
    validateTopology();
    const infoLines = [...document.querySelectorAll('#conflictMsgList .ca-item.info')].map((li) => li.textContent);
    const faultLines = [...document.querySelectorAll('#conflictMsgList .ca-item:not(.info)')].length;
    ok('the Findings tab lists them as info lines, no fault', infoLines.some((x) => x.includes('SEVEN has 1 free port of 8')) && !faultLines,
       show(infoLines));

    // ---- 3. Accepting it ----
    ok('its check name', FINDING_CHECK_NAMES['port-capacity'] === 'Port capacity' && findingCheckName('port-capacity') === 'Port capacity');
    // 7 of 8, with an eighth PC drawn and not yet cabled.
    const acc = rig('seven', { portCount: 8 }, 8);
    open({ nodes: acc.nodes, links: acc.links.filter((l) => l.id !== 'sevenl8') });
    initHistory();
    ok('the fixture: 7 of 8', !!noteOf('seven') && portCapacity(getNode('seven')).used === 7);
    ok('accepted with a reason', acceptFindings([noteOf('seven')], 'The closet only ever has 8 phones'));
    ok('and it is one undo step', document.getElementById('undoBtn').disabled === false && _undoStack.length === 1, String(_undoStack.length));
    undo();
    ok('which undo takes back: nothing accepted, the note open again, nothing left to undo',
       !(state.accepted || []).length && !!noteOf('seven') && !noteOf('seven').accepted && document.getElementById('undoBtn').disabled === true,
       show(state.accepted));
    redo();
    ok('it reads accepted, with its scope', !!noteOf('seven').accepted && state.accepted[0].scope === 'ports:8', show(state.accepted));
    state.links.push({ id: 'sevenl8', source: 'seven', target: 'sevenh8', sourceIface: 'p8', targetIface: 'i1' });
    ok('full at the same count: still the accepted finding', !!noteOf('seven') && !!noteOf('seven').accepted && portCapacity(getNode('seven')).full);
    getNode('seven').portCount = 9;
    ok('a changed port count reopens it', !!noteOf('seven') && !noteOf('seven').accepted && noteOf('seven').scope === 'ports:9', show(noteOf('seven')));

    // ---- 4. Translated ----
    open(doc(rig('one', { portCount: 8 }, 7), rig('two', { portCount: 24 }, 22), rig('full', { portCount: 8 }, 8)));
    const rmEn = reportModel();
    const wantEn = { one: 'ONE has 1 free port of 8: 8.', two: 'TWO has 2 free ports of 24: 23–24.' };
    ok('English: the singular and the plural', notes().length === 3 && noteOf('one') && noteOf('two')
       && noteOf('one').detail === wantEn.one && noteOf('two').detail === wantEn.two, show(notes().map((f) => f.detail)));
    const leftEnglish = [];
    ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => {
      setLocale(loc);
      const fs = notes();
      const words = fs.map((f) => f.detail).concat([findingCheckName('port-capacity'), summarySheet(reportModel())]);
      if (fs.length !== 3 || words.some((w) => /\{[a-z]+\}/.test(w))) leftEnglish.push(`${loc}: placeholder`);
      if (fs.some((f) => /free port|in use|Raise the port/.test(f.detail)) || findingCheckName('port-capacity') === 'Port capacity') leftEnglish.push(`${loc}: English left`);
      const sum = summarySheet(reportModel());
      if (/Room to grow|almost full|free ports? of/.test(sum)) leftEnglish.push(`${loc}: summary in English`);
    });
    setLocale('ru');
    const ruOne = notes().find((f) => f.nodeIds[0] === 'one');
    ok('Russian counts with "свободно портов: n", which reads for any n', !!ruOne && ruOne.detail === 'У ONE свободно портов: 1 из 8: 8.', ruOne && ruOne.detail);
    setLocale('es');
    const esOne = notes().find((f) => f.nodeIds[0] === 'one'), esTwo = notes().find((f) => f.nodeIds[0] === 'two');
    ok('Spanish: one free port in the singular, two in the plural', esOne.detail === 'ONE tiene 1 puerto libre de 8: 8.'
       && esTwo.detail === 'TWO tiene 2 puertos libres de 24: 23–24.', `${esOne.detail} | ${esTwo.detail}`);
    setLocale('en');
    ok('translated in every locale, nothing left in English', !leftEnglish.length, leftEnglish.join(' | '));
    ok('and back in English', reportModel().capacity.ports.length === rmEn.capacity.ports.length && notes()[0].detail === wantEn.one);

    // ---- 5. The report ----
    open({ networks: [{ id: 'n1', cidr: '10.0.0.0/24' }],
      nodes: [...rig('core', { portCount: 8 }, 7).nodes, { id: 'spare', type: 'switch', name: 'Spare', x: 0, y: 0, portCount: 8, interfaces: [] },
        { id: 'apx', type: 'ap', name: 'Lone AP', x: 0, y: 0, interfaces: [] },
        { id: 'big', type: 'switch', name: 'Big', x: 0, y: 0, portCount: 24, interfaces: [] }],
      links: rig('core', { portCount: 8 }, 7).links });
    const maps = reportPortMaps();
    const spare = maps.find((m) => m.id === 'spare');
    ok('the port map lists a switch with nothing cabled, with its free ports', !!spare && !spare.rows.length && spare.free === '1–8' && spare.used === 0,
       show(maps.map((m) => m.name)));
    ok('but not a bare one-port AP', !maps.some((m) => m.id === 'apx'));
    const core = maps.find((m) => m.id === 'core');
    ok('a nearly full one is marked in the model', core.nearlyFull && !core.full && !spare.nearlyFull);
    const model = reportModel();
    // The Ports table prints only when its tick is on (the report dialog's
    // Capacity: ports table, off by default; tests/suites/reportsections.js).
    const html = reportHtml(model, null, { technical: true, sections: { capPorts: true } });
    ok('the cable-less switch has a heading and "Nothing is plugged in yet.", no empty table',
       /<h3>Spare <span class="muted">· Switch · 0 of 8 ports used<\/span><\/h3>\s*<p class="muted">Nothing is plugged in yet\.<\/p>/.test(html)
       && html.includes('Free: 1–8'), (html.match(/<h3>Spare[^]*?Free: [^<]*/) || [])[0]);
    ok('the nearly full switch\'s heading says so', /<h3>CORE <span class="muted">· Switch · 7 of 8 ports used<\/span> <span class="sev warn">Almost full<\/span><\/h3>/.test(html),
       (html.match(/<h3>CORE[^\n]*/) || [])[0]);
    ok('model.capacity names the noted switch only', show(model.capacity.ports.map((r) => [r.id, r.total, r.used, r.free, r.freePorts])) === show([['core', 8, 7, 1, '8']]),
       show(model.capacity));
    ok('and totals the free ports of the switches whose count is set', show(model.capacity.room) === show({ free: 1 + 8 + 24, devices: 3, aps: 0 }), show(model.capacity.room));
    const at = (h) => html.indexOf(`<h2>${h}</h2>`);
    ok('a Capacity section after Addressing, before Scope and method', at('Capacity') > at('Addressing') && at('Capacity') < at('Scope and method') && at('Addressing') > 0);
    const capPart = html.slice(at('Capacity'), at('Scope and method'));
    ok('holding a Ports table with the switch, its count, use and free ports', capPart.includes('<table class="capacity">')
       && /<td><b>CORE<\/b> <span class="muted">Switch<\/span><\/td>\s*<td>8<\/td>\s*<td>7<\/td>\s*<td><span class="sev warn">1<\/span> <span class="mono">8<\/span><\/td>/.test(capPart)
       && !capPart.includes('Spare') && !capPart.includes('Big'), capPart.slice(0, 600));
    ok('the counts still leave the note out', model.counts.critical === 0 && model.counts.advisory === 0);
    // Changes since the last back-up go after it.
    model.changes = { kind: 'backup', rows: [], at: Date.now() };
    try {
      const withChanges = reportSheet(model, null);
      ok('and before Changes', withChanges.indexOf('<h2>Capacity</h2>') < withChanges.indexOf('<h2>Changes since the last back-up</h2>'));
    } catch (e) { ok('and before Changes', false, e.message); }

    // A switch whose port count was never set: its total is the default, a
    // guess, so the port map says so and lists no free ports.
    open({ nodes: [{ id: 'bare', type: 'switch', name: 'Bare', x: 0, y: 0, interfaces: [] }, ...rig('imp2', {}, 3).nodes],
      links: rig('imp2', {}, 3).links });
    const bareHtml = reportHtml(reportModel(), null);
    ok('an implicit cable-less switch reads "port count not set", no Free line',
       /<h3>Bare <span class="muted">· Switch · 0 of 8 ports used · port count not set<\/span><\/h3>\s*<p class="muted">Nothing is plugged in yet\.<\/p>\s*<h3>/.test(bareHtml),
       (bareHtml.match(/<h3>Bare[^]*?<h3>/) || [])[0]);
    ok('and so does a cabled one', /<h3>IMP2 <span class="muted">· Switch · 3 of 8 ports used · port count not set<\/span><\/h3>/.test(bareHtml)
       && !/Free: 4–8/.test(bareHtml), (bareHtml.match(/<h3>IMP2[^\n]*/) || [])[0]);
    setLocale('es');
    ok('in Spanish too', reportHtml(reportModel(), null).includes(' · número de puertos sin indicar</span>'));
    setLocale('en');
    // A bond with no cable takes its ports: not "Nothing is plugged in yet."
    open({ nodes: [{ id: 'lagx', type: 'switch', name: 'Lagx', x: 0, y: 0, portCount: 8,
      interfaces: [{ id: 'p1', name: 'p1', bond: { mode: '802.3ad', members: ['p2'] } }] }] });
    const lagHtml = reportHtml(reportModel(), null);
    ok('a cable-less switch with a bond says its bond ports are in use, not that nothing is plugged in',
       /<h3>Lagx <span class="muted">· Switch · 2 of 8 ports used<\/span><\/h3>\s*<p class="muted">No cable is plugged in yet\. Its bond ports count as in use\.<\/p>/.test(lagHtml)
       && lagHtml.includes('Free: 3–8'), (lagHtml.match(/<h3>Lagx[^]*?Free: [^<]*/) || [])[0]);
    // A retired switch with nothing on it is not room to grow.
    open({ nodes: [{ id: 'gone', type: 'switch', name: 'Gone', x: 0, y: 0, status: 'retired', portCount: 8, interfaces: [] },
      ...rig('live', { portCount: 8, status: 'retired' }, 2).nodes], links: rig('live', { portCount: 8, status: 'retired' }, 2).links });
    ok('a retired switch with nothing cabled is left out of the port map; one with cables stays',
       !reportPortMaps().some((m) => m.id === 'gone') && reportPortMaps().some((m) => m.id === 'live')
       && !reportHtml(reportModel(), null).includes('<h3>Gone'), show(reportPortMaps().map((m) => m.id)));
    // Room to grow names what the boxes are.
    open(doc(rig('apa', { type: 'ap', portCount: 4 }, 2)));
    ok('an access point alone: "The access point has 2 free ports."', summarySheet(reportModel()).includes('<p class="room">The access point has 2 free ports.</p>'),
       (summarySheet(reportModel()).match(/<p class="room">[^<]*/) || [])[0]);
    open(doc(rig('apa', { type: 'ap', portCount: 4 }, 2), rig('apb', { type: 'ap', portCount: 4 }, 3)));
    ok('two: "The access points have 3 free ports."', summarySheet(reportModel()).includes('<p class="room">The access points have 3 free ports. APB is almost full'),
       (summarySheet(reportModel()).match(/<p class="room">[^<]*/) || [])[0]);
    open(doc(rig('apa', { type: 'ap', portCount: 4 }, 3), rig('swa', { portCount: 8 }, 8)));
    ok('both: "The switches and access points have 1 free port."', summarySheet(reportModel()).includes('<p class="room">The switches and access points have 1 free port.')
       && show(reportModel().capacity.room) === show({ free: 1, devices: 2, aps: 1 }), (summarySheet(reportModel()).match(/<p class="room">[^<]*/) || [])[0]);
    setLocale('ru');
    ok('and in Russian on the counting form', summarySheet(reportModel()).includes('Свободных портов на коммутаторах и точках доступа: 1.'));
    setLocale('en');

    open({ networks: [{ id: 'n1', cidr: '10.0.0.0/24' }],
      nodes: [...rig('core', { portCount: 8 }, 7).nodes, { id: 'spare', type: 'switch', name: 'Spare', x: 0, y: 0, portCount: 8, interfaces: [] },
        { id: 'apx', type: 'ap', name: 'Lone AP', x: 0, y: 0, interfaces: [] },
        { id: 'big', type: 'switch', name: 'Big', x: 0, y: 0, portCount: 24, interfaces: [] }],
      links: rig('core', { portCount: 8 }, 7).links });
    const summary = summarySheet(reportModel());
    ok('the summary\'s Room to grow line: the total, then the nearly full switch (then the subnet half)',
       summary.includes('<h3>Room to grow</h3>') && summary.includes('<p class="room">The switches have 33 free ports. CORE is almost full: 1 free port of 8. The network has 254 free addresses.</p>'),
       (summary.match(/<p class="room">[^<]*/) || [])[0]);
    open(doc(rig('solo', { portCount: 8 }, 8)));
    ok('one switch, full: the singular switch and the full wording', summarySheet(reportModel()).includes('<p class="room">The switch has 0 free ports. SOLO is full: all 8 ports are in use.</p>'),
       (summarySheet(reportModel()).match(/<p class="room">[^<]*/) || [])[0]);
    open(doc(rig('solo', { portCount: 8 }, 6)));
    ok('nothing nearly full: only the total', summarySheet(reportModel()).includes('<p class="room">The switch has 2 free ports.</p>'));
    open(doc(rig('a', {}, 3), rig('b', { portCount: 2 }, 1)));
    const noRoom = reportModel();
    ok('no port count set (or a box too small to count): no Room to grow line and no Capacity section',
       noRoom.capacity.room === null && !summarySheet(noRoom).includes('Room to grow') && !reportHtml(noRoom, null).includes('<h2>Capacity</h2>'));
    const many = [];
    for (let i = 1; i <= SUMMARY_WHERE_MAX + 2; i++) many.push(rig(`s${i}`, { portCount: 8 }, 8));
    open(doc(...many));
    const room = (summarySheet(reportModel()).match(/<p class="room">([^<]*)/) || [])[1] || '';
    ok('past SUMMARY_WHERE_MAX nearly full switches, the rest are counted',
       (room.match(/is full/g) || []).length === SUMMARY_WHERE_MAX && room.endsWith('…and 2 more.'), room);

    // ---- 6. has:full ----
    open(doc(rig('seven', { portCount: 8 }, 7), rig('six', { portCount: 8 }, 6), rig('imp', {}, 8)));
    const matches = (text) => { const q = parseQuery(text); return state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id).sort().join(','); };
    ok('has:full finds the nearly full switch only', matches('has:full') === 'seven', matches('has:full'));
    ok('type:switch -has:full the others', matches('type:switch -has:full') === 'imp,six', matches('type:switch -has:full'));
    ok('it is understood', !parseQuery('has:full').errors.length);

    // ---- 7. The shipped samples ----
    const noisy = [], odd = [];
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'template' });
      const ns = notes();
      if (k.endsWith(SIMPLE_SUFFIX) && ns.length) noisy.push(`${k}: ${ns.map((f) => f.subject).join(', ')}`);
      // Worked out here from the spec's rule (explicit count, 4 ports or more,
      // free <= max(1, floor(total / 10)), in service or planned, no
      // overflow), not through portCapacityNote, which both sides read.
      const want = state.nodes.filter((n) => {
        if (!hasPortGrid(n) || n.status === 'retired' || !Number.isInteger(n.portCount) || n.portCount < 4) return false;
        const c = portCapacity(n);
        return c.free <= Math.max(1, Math.floor(n.portCount / 10)) && !c.past && c.cables <= n.portCount;
      }).map((n) => n.id).sort();
      const cap = reportModel().capacity;
      if (show(cap.ports.map((r) => r.id).sort()) !== show(want) || show(ns.map((f) => f.nodeIds[0]).sort()) !== show(want)) odd.push(`${k}: ${show(want)}`);
    });
    ok('no simple sample raises a port-capacity note (they open with no finding at all)', !noisy.length, noisy.join(' | '));
    ok('on every template the notes and the Capacity section name exactly the nearly full switches', !odd.length, odd.join(' | '));
  } catch (e) {
    ok('the suite ran', false, e && (e.stack || e.message));
  }
  setLocale('en');
  setDialogResponder(heldResponder);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 50); });
