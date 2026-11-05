// Inventory, stage 4 (docs/BACKLOG.md feature 3, landing order step 13): the
// firmware finding (firmwareFindings in js/diagnostics.js). What is held here:
//   1. the finding: two C9200L at 17.9.4 and one at 17.6.1 give one advisory
//      'firmware' finding naming all three, the most common version first,
//      no claim about which is newer; 'v17.9.4', 'V 17.9.4', 'version 17.9.4'
//      and '17.9.4' are one version, shown in the most common spelling; the
//      model's spelling and case do not split it; a retired device, a device
//      with no model and one with no firmware are left out; one firmware on
//      every device is nothing; a different vendor with the same model is a
//      group of its own; a blank vendor joins the model's one vendor, and
//      makes a group of its own when the model is under two vendors; three
//      versions say 3;
//   2. it is counted: an advisory, in the Findings tab, the report's
//      findings, has:finding, the Simple summary's plain words;
//   3. accepting it: one undo step, scoped to the model (the vendor only
//      when the model is under two vendors, so filling in its one vendor
//      keeps it accepted), a fourth device of
//      the model reopens it, accepting it on one model does not cover
//      another on the same devices; a long model's scope is cut to
//      ACCEPT_SCOPE_MAX with a hash, so two long models that share their
//      first 64 characters keep apart; its check name (FINDING_CHECK_NAMES);
//   4. the shipped samples: no template or simple sample raises it, and the
//      reduced profiles' seeded firmware ("Firmware" on two printers) never
//      does without a model;
//   5. the words in es, pt-BR, ja and ru, no placeholder left.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const open = (nodes) => { replaceDocument({ v: DOC_VERSION, links: [], nodes }, { origin: 'file' }); initHistory(); };
  let x = 0;
  const sw = (id, extra) => ({ id, type: 'switch', name: id.toUpperCase(), x: (x += 80), y: 0, interfaces: [], ...(extra || {}) });
  const fws = () => topologyFindings().filter((f) => f.key === 'firmware');
  const ids = (f) => (f ? f.nodeIds.slice().sort().join(',') : '');
  setLocale('en');

  try {
    // ---- 1. The finding ----
    const c9200 = (id, os, extra) => sw(id, { vendor: 'Cisco', model: 'C9200L', os, ...(extra || {}) });
    open([c9200('sw-1', '17.9.4'), c9200('sw-2', '17.9.4'), c9200('sw-3', '17.6.1')]);
    let f = fws();
    ok('two at 17.9.4 and one at 17.6.1: one finding naming all three', f.length === 1 && ids(f[0]) === 'sw-1,sw-2,sw-3', show(f));
    ok('advisory, with its check and subject', f[0].level === 'warn' && f[0].check === 'Firmware' && f[0].subject === 'Cisco C9200L', show(f[0]));
    ok('the detail names each version with its devices, the most common first',
       f[0].detail === 'Cisco C9200L runs 2 different firmware versions: 17.9.4 on SW-1, SW-2; 17.6.1 on SW-3.', f[0].detail);
    ok('and claims nothing about which is newer', !/newer|older|newest|latest|upgrade/i.test(f[0].detail));
    ok('its line is the check and the detail', f[0].line === 'Firmware: ' + f[0].detail, f[0].line);

    open([c9200('a', 'v17.9.4'), c9200('b', '17.9.4'), c9200('c', 'V 17.9.4'), c9200('d', 'version 17.9.4'), c9200('e', '17.9.4')]);
    ok('v17.9.4, V 17.9.4, version 17.9.4 and 17.9.4 are one version', !fws().length, show(fws()));
    open([c9200('a', 'v17.9.4'), c9200('b', 'v17.9.4'), c9200('c', '17.9.4'), c9200('d', '17.6.1')]);
    f = fws();
    ok('shown in the most common spelling', f.length === 1 && f[0].detail.includes('v17.9.4 on A, B, C; 17.6.1 on D'), f[0] && f[0].detail);
    open([sw('a', { model: 'C9200L', os: 'fw2.1' }), sw('b', { model: 'c9200l', os: '2.1' }), sw('c', { model: ' C9200L ', os: '2.1' })]);
    ok('fw before a digit is stripped, and the model\'s case and spaces do not split it', !fws().length, show(fws()));
    open([sw('a', { model: 'C9200L', os: 'IOS-XE 17.9' }), sw('b', { model: 'C9200L', os: 'IOS-XE 17.6' })]);
    ok('a vendor-less model is its own name', fws().length === 1 && fws()[0].subject === 'C9200L', show(fws()));

    open([c9200('a', '17.9.4'), c9200('b', '17.6.1', { status: 'retired' }), c9200('c', '17.9.4'),
          sw('d', { vendor: 'Cisco', os: '17.6.1' }), c9200('e', ''), c9200('f', '   ')]);
    ok('a retired device, no model, or no firmware: left out, so nothing', !fws().length, show(fws()));
    open([c9200('a', '17.9.4'), c9200('b', '17.6.1', { status: 'planned' })]);
    ok('a planned one counts', fws().length === 1 && ids(fws()[0]) === 'a,b');

    open([c9200('a', '17.9.4'), sw('b', { vendor: 'Acme', model: 'C9200L', os: '17.6.1' })]);
    ok('a different vendor with the same model is a group of its own', !fws().length, show(fws()));
    open([c9200('a', '17.9.4'), c9200('b', '17.6.1'), sw('c', { vendor: 'Acme', model: 'C9200L', os: '1.0' }), sw('d', { vendor: 'Acme', model: 'C9200L', os: '1.0' })]);
    ok('and each vendor\'s group is judged alone', fws().length === 1 && ids(fws()[0]) === 'a,b', show(fws()));
    open([c9200('a', '17.9.4'), sw('b', { model: 'C9200L', os: '17.6.1' })]);
    f = fws();
    ok('a blank vendor joins the model\'s one vendor', f.length === 1 && ids(f[0]) === 'a,b' && f[0].subject === 'Cisco C9200L', show(f));
    open([c9200('a', '17.9.4'), sw('b', { vendor: 'Acme', model: 'C9200L', os: '17.6.1' }), sw('c', { model: 'C9200L', os: '9.9' })]);
    ok('under two vendors, a blank one makes a group of its own', !fws().length, show(fws()));
    open([c9200('a', '17.9.4'), c9200('b', '17.6.1'), c9200('c', '16.12.5')]);
    ok('three versions say 3', fws().length === 1 && /runs 3 different firmware versions: /.test(fws()[0].detail), fws()[0] && fws()[0].detail);

    // ---- 2. Counted, and where it is read ----
    open([c9200('sw-1', '17.9.4'), c9200('sw-2', '17.9.4'), c9200('sw-3', '17.6.1'), sw('core', {})]);
    const counts = findingCounts(topologyFindings());
    ok('it is counted as an advisory', counts.advisory === 1 && counts.critical === 0 && isCountedFinding(fws()[0]), show(counts));
    validateTopology();
    const lines = [...document.querySelectorAll('#conflictMsgList .ca-item')].map((li) => li.textContent);
    ok('the Findings tab lists it', lines.some((l) => l.includes('runs 2 different firmware versions')), show(lines));
    const fwLine = lines.find((l) => l.includes('runs 2 different firmware versions')) || '';
    ok('and names the model once there', fwLine.split('Cisco C9200L').length === 2, fwLine);
    const rm = reportModel();
    ok('the report\'s findings hold it', rm.findings.some((g) => g.key === 'firmware') && rm.counts.advisory === 1, show(rm.counts));
    ok('and the technical sheet prints it', reportHtml(rm, null).includes('runs 2 different firmware versions'));
    const q = parseQuery('has:finding');
    const hits = state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id).sort().join(',');
    ok('has:finding finds its devices', hits === 'sw-1,sw-2,sw-3', hits);
    ok('PLAIN_FINDINGS has it', show(PLAIN_FINDINGS.firmware) === show(['Devices of the same model run different software versions', 'They can behave differently, and the older ones may miss security fixes.']));
    ok('the Simple summary says it in plain words', summarySheet(rm).includes('Devices of the same model run different software versions'));

    // ---- 3. Accepting it ----
    ok('its check name', FINDING_CHECK_NAMES.firmware === 'Firmware' && findingCheckName('firmware') === 'Firmware');
    ok('accepted with a reason', acceptFindings([fws()[0]], 'Lab switches stay on the old train'));
    ok('in one undo step', _undoStack.length === 1, String(_undoStack.length));
    ok('scoped to the model', !!fws()[0].accepted && state.accepted[0].scope === 'c9200l', show(state.accepted));
    undo();
    ok('undo takes it back', !(state.accepted || []).length && !fws()[0].accepted);
    redo();
    ok('redo accepts it again', !!fws()[0].accepted);
    state.nodes.push(c9200('sw-4', '17.6.1'));
    ok('a fourth device of the model reopens it', fws().length === 1 && !fws()[0].accepted && ids(fws()[0]) === 'sw-1,sw-2,sw-3,sw-4', show(fws()));
    state.nodes.pop();
    ok('and without it it is accepted again', !!fws()[0].accepted);
    // The same three devices, renamed to another model: a finding the entry
    // never covered.
    state.nodes.filter((n) => /^sw-/.test(n.id)).forEach((n) => { n.model = 'C9300'; });
    ok('the same devices on another model: open', fws().length === 1 && !fws()[0].accepted && fws()[0].scope === 'c9300', show(fws()));

    const long = 'X'.repeat(70);
    open([sw('a', { model: long + ' one', os: '1' }), sw('b', { model: long + ' one', os: '2' }),
          sw('c', { model: long + ' two', os: '1' }), sw('d', { model: long + ' two', os: '2' })]);
    f = fws();
    ok('two long models: two findings, each scope cut to ACCEPT_SCOPE_MAX and apart',
       f.length === 2 && f.every((g) => g.scope.length === ACCEPT_SCOPE_MAX) && f[0].scope !== f[1].scope, show(f.map((g) => g.scope)));
    ok('a long scope reads back as written', f.every((g) => normalizeAccepted([{ check: 'firmware', scope: g.scope, nodeIds: g.nodeIds, reason: 'r' }])[0].scope === g.scope));
    open([sw('a', { model: long + ' one', os: '1' }), sw('b', { model: long + ' one', os: '2' }),
          sw('c', { model: long + ' two', os: '1' }), sw('d', { model: long + ' two', os: '2' })]);
    acceptFindings([fws().find((g) => g.nodeIds.includes('a'))], 'Known');
    ok('accepting one long model leaves the other open', fws().filter((g) => g.accepted).length === 1 && fws().filter((g) => !g.accepted).length === 1);
    // The real collision: the same devices moved to another long model that
    // shares the first 64 characters. Only the hash keeps the entry off it.
    const heldScope = state.accepted[0].scope;
    state.nodes.filter((n) => n.id === 'a' || n.id === 'b').forEach((n) => { n.model = long + ' three'; });
    f = fws().filter((g) => g.nodeIds.includes('a'));
    ok('the same devices on another long model with the same first 64 characters: open',
       f.length === 1 && !f[0].accepted && f[0].scope !== heldScope, show(f.map((g) => [g.scope, !!g.accepted])));
    open([sw('a', { model: 'C9200L', os: '1' }), sw('b', { model: 'C9200L', os: '2' })]);
    ok('a short model\'s scope is its key', fws()[0].scope === 'c9200l', fws()[0].scope);
    acceptFindings([fws()[0]], 'Known');
    state.nodes.forEach((n) => { n.vendor = 'Cisco'; });
    ok('filling in the model\'s one vendor leaves it accepted', fws().length === 1 && !!fws()[0].accepted && fws()[0].scope === 'c9200l', show(fws()));
    state.nodes[0].vendor = '';
    ok('and clearing one of them too', fws().length === 1 && !!fws()[0].accepted, show(fws()));
    state.nodes[0].vendor = 'Cisco';
    state.nodes.push(sw('c', { vendor: 'Acme', model: 'C9200L', os: '3' }), sw('d', { vendor: 'Acme', model: 'C9200L', os: '4' }));
    f = fws();
    ok('under two vendors the vendor is in the scope, and the accepted devices reopen',
       f.length === 2 && f.some((g) => g.scope === 'cisco|c9200l' && !g.accepted) && f.some((g) => g.scope === 'acme|c9200l'), show(f.map((g) => [g.scope, !!g.accepted])));

    // ---- 4. The shipped samples ----
    const noisy = [];
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'template' });
      if (fws().length) noisy.push(`${k}: ${fws().map((g) => g.subject).join(', ')}`);
    });
    ok('no template or simple sample raises it (the SIMPLE_SAMPLES promise)', !noisy.length, noisy.join(' | '));
    open([sw('p1', { type: 'printer', os: 'Firmware' }), sw('p2', { type: 'printer', os: 'Firmware 2.0' })]);
    ok('seeded firmware with no model never raises it', !fws().length);

    // ---- 5. Translated ----
    open([c9200('sw-1', '17.9.4'), c9200('sw-2', '17.9.4'), c9200('sw-3', '17.6.1')]);
    const left = [];
    ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => {
      setLocale(loc);
      const g = fws()[0];
      const words = [g.detail, g.check, findingCheckName('firmware'), summarySheet(reportModel())];
      if (words.some((w) => /\{[a-z]+\}/.test(w))) left.push(`${loc}: placeholder`);
      if (/different firmware versions| on SW-/.test(g.detail) || g.check === 'Firmware' && loc !== 'es' && loc !== 'pt-BR') left.push(`${loc}: English left: ${g.detail} / ${g.check}`);
      if (!g.detail.includes('17.9.4') || !g.detail.includes('SW-3') || !g.detail.includes('Cisco C9200L')) left.push(`${loc}: values lost: ${g.detail}`);
      if (summarySheet(reportModel()).includes('Devices of the same model run different software versions')) left.push(`${loc}: plain words English`);
    });
    setLocale('en');
    ok('translated in es, pt-BR, ru and ja', !left.length, left.join(' | '));
    setLocale('ru');
    ok('Russian keeps the count out of the plural', fws()[0].detail === 'Cisco C9200L: разные версии прошивки (2): 17.9.4: SW-1, SW-2; 17.6.1: SW-3.', fws()[0].detail);
    setLocale('ja');
    ok('Japanese', fws()[0].detail.startsWith('Cisco C9200L のファームウェアが 2 種類に分かれています'), fws()[0].detail);
  } catch (e) {
    ok('the suite ran', false, e && (e.stack || e.message));
  }
  setLocale('en');
  setDialogResponder(heldResponder);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 50); });
