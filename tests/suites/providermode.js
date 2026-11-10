// @realtime — the links are locked and the log's hash chain awaits Web Crypto.
// Provider mode, step 4 stage 4 (js/providermode.js, docs/SCOPE.md section 4):
//   1. arrival: a locked link with a sent report shows the banner (the
//      problem, when, where), a network opened from elsewhere does not; Not
//      now hides it for this copy;
//   2. "I am the provider": provider mode (the class, the full editor
//      borrowed but never saved as the view), the session in sessionStorage
//      with the revision that arrived, the copy's base set to that revision
//      (D45), the report's tab, its devices ringed on the map and the ring
//      kept out of the SVG export;
//   3. the panel: the report, the client's words, call and email, which
//      provider you are (remembered in Settings), what you look after;
//   4. Record visit: arrived defaults to the arrival, the changes since the
//      copy arrived (a rename and a new device), what is missing said, one
//      undo step, a 'visit' entry chained (verifyLog -1) with the provider's
//      name, the report visited;
//   5. the copy back: locked with the passphrase that opened the link, its
//      base the revision received, Email to the reporter (the hyperlink
//      "Follow the infrastructure link" in the clipboard, never the raw
//      link in the mailto:, D86), Copy message rich and plain, the file topo_…_visit.json, the message composed both
//      ways; a second visit lists only what changed after the first;
//   6. the copy received no longer held: said, the visit saved without a
//      list; a reload re-enters provider mode from the session, '#provider'
//      typed does nothing else; Leave gives the view back;
//   7. the client opening the copy sent back: the visited banner offers the
//      merge, three-way from the revision both started from; a merge that
//      brings a sent report shows the provider's banner;
//   8. translated: the panel and banner in es, every string of the module
//      in every locale, no パソコン.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  // Every string a t( ... ) call can ask for: its first argument's quoted
  // strings, the branches of a ternary included ("t(n === 1 ? 'One X.' :
  // '{n} X.')"), not those compared against (=== 'closed').
  const tKeys = (src) => {
    const out = [];
    const re = /\bt\(/g;
    let m;
    while ((m = re.exec(src))) {
      let i = m.index + 2, depth = 0, arg = '';
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === '\'' || c === '"' || c === '`') {
          let j = i + 1;
          while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
          arg += src.slice(i, j + 1); i = j; continue;
        }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
        else if (c === ',' && depth === 0) break;
        arg += c;
      }
      for (const s of arg.matchAll(/(===|!==|==|!=)?\s*'((?:[^'\\]|\\.)*)'/g)) if (!s[1]) out.push(s[2].replace(/\\'/g, '\''));
    }
    return [...new Set(out)];
  };
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const show = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 500) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };
  const el = (id) => document.getElementById(id);
  const visible = (id) => { const x = el(id); return !!x && !x.classList.contains('hidden') && !x.hidden && getComputedStyle(x).display !== 'none'; };
  await until(() => !!window.TopoProviderMode && !!window.TopoIncidents && typeof canSeal === 'function');
  const PM = window.TopoProviderMode;
  const TI = window.TopoIncidents;
  const H = TI.hooks;
  const held = { open: H.open, copy: H.copy, copyRich: H.copyRich, share: H.share, canShare: H.canShare, saveBlob: window.saveBlob, now: H.now };
  const heldLib = CarinoLibrary.loadLibrary();
  const heldSettings = JSON.parse(JSON.stringify(state.settings));
  const opened = [], copied = [], saved = [];
  H.open = (u) => opened.push(u);
  H.copy = async (s) => { copied.push(s); };
  const rich = [];
  H.copyRich = async (html, text) => { rich.push({ html, text }); };
  H.canShare = () => false;
  window.saveBlob = (blob, name) => { saved.push({ blob, name }); };
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({
    v: DOC_VERSION,
    report: { client: 'Clinica Sol', site: 'Reception' },
    providers: [
      { id: 'pI', name: 'Fibra Norte', service: 'internet', phone: '+52 55 1234 5678', email: 'noc@fibra.example', hours: '24/7' },
      { id: 'pT', name: 'Andes IT', service: 'it', phone: '555-0100', email: 'help@andes.example' }
    ],
    groups: [{ id: 'gB', name: 'Office', kind: 'building', providers: ['pT'] }],
    nodes: [
      N('isp', 'cloud', { name: 'Internet', providers: ['pI'], x: 0, y: 0 }),
      N('rt', 'router', { name: 'Router', x: 0, y: 100 }),
      N('sw', 'switch', { name: 'Switch', x: 0, y: 200, group: 'gB' }),
      N('pc', 'pc', { name: 'Reception PC', x: -100, y: 300, group: 'gB' })
    ],
    links: [{ id: 'l1', source: 'isp', target: 'rt' }, { id: 'l2', source: 'rt', target: 'sw' }, { id: 'l3', source: 'sw', target: 'pc' }]
  });
  const PASS = 'test-pass-word-123';
  const clearSessions = () => { try { Object.keys(sessionStorage).filter((k) => /^topo_(provider|incbanner)_/.test(k)).forEach((k) => sessionStorage.removeItem(k)); } catch (e) { /* none */ } };
  const savedSettings = () => JSON.parse(localStorage.getItem('nettopo_settings') || '{}');
  const fragOf = (url) => url.slice(url.indexOf('#') + 1);

  try {
    setLocale('en');
    clearSessions();
    CarinoLibrary.persistLibrary({});
    // The provider's own view is the Simple one: provider mode borrows the
    // full editor and must give it back.
    state.settings.advanced = false;
    delete state.settings.providerSelf;
    saveSettings(); applyProfile();

    // ---- The client reports and sends ----
    replaceDocument(site(), { origin: 'link', docId: 'pm-net' });
    const incId = await TI.createIncident({ symptom: 'internet', nodeIds: ['pc'], text: 'Nothing loads since 9.', name: 'Ana', phone: '555-1', email: 'ana@x.example', routedTo: ['pI'] });
    const sent = await TI.sendIncident(incId, { providerIds: ['pI'], passphrase: PASS });
    ok('the client sent a locked link', sent.ok && sent.why === 'link' && !!sent.url, show(sent.why));
    const clientLib = CarinoLibrary.loadLibrary();
    const clientRev = (clientLib['pm-net'] || {}).rev;
    ok('the client\'s card names the revision that left', !!clientRev);
    ok('no banner on the client\'s own network', !visible('incidentBanner'));
    openArrivedDocument((await unsealFragment(fragOf(sent.url), PASS)).json);
    ok('the client opening the link they sent, in the browser that keeps it: no provider banner', !visible('incidentBanner') && !(PM.state.arrival && PM.state.arrival.kind === 'provider'),
       show(PM.state.arrival));

    // ---- 1. The provider opens it, in a browser that does not hold it ----
    CarinoLibrary.persistLibrary({});
    clearSessions();
    const unsealed = await unsealFragment(fragOf(sent.url), PASS);
    // The real way in: the unlock dialog answered with the passphrase, which
    // openSealedLink hands to provider mode and then forgets.
    _arrivalPass = null;
    const unlocking = openSealedLink(fragOf(sent.url));
    ok('a locked link asks for its passphrase', await until(() => typeof unlockDialogOpen === 'function' && unlockDialogOpen()));
    _answerUnlock(PASS);
    await unlocking;
    ok('openSealedLink hands the passphrase over and forgets it', PM.state.pass.get('pm-net') === PASS && _arrivalPass === null && !unlockDialogOpen(),
       String(PM.state.pass.get('pm-net') === PASS) + ' ' + String(_arrivalPass));
    ok('the arrival is the client\'s network, not kept here', state.docId === 'pm-net' && !isKept() && state.docRev === clientRev, `${state.docId} ${state.docRev}`);
    ok('the banner shows', visible('incidentBanner'));
    const bannerText = el('incidentBannerText').textContent;
    ok('it says what, where and when', /Problem reported .+: No internet at Reception PC\./.test(bannerText), bannerText);
    ok('it offers I am the provider and Not now', el('incidentBannerGo').textContent === 'I am the provider' && el('incidentBannerLater').textContent === 'Not now');
    ok('the passphrase that opened it is held in memory', PM.state.pass.get('pm-net') === PASS && !JSON.stringify(Object.assign({}, sessionStorage)).includes(PASS));
    PM.dismissIncidentBanner();
    ok('Not now hides it', !visible('incidentBanner'));
    openArrivedDocument(unsealed.json);
    ok('and it stays hidden for this copy in this tab', !visible('incidentBanner'));
    clearSessions();
    replaceDocument(JSON.parse(unsealed.json), { origin: 'default' });
    ok('no banner for a network that did not arrive (the example)', !visible('incidentBanner'));
    replaceDocument(JSON.parse(unsealed.json), { origin: 'template' });
    ok('nor for a template', !visible('incidentBanner'));
    _arrivalPass = PASS;
    openArrivedDocument(unsealed.json);
    ok('a fresh arrival shows it again', visible('incidentBanner'));
    const arrivedAt = PM.state.arrival && PM.state.arrival.at;

    // ---- 2. I am the provider ----
    await PM.incidentBannerGo();
    ok('provider mode is on', document.body.classList.contains('provider-mode') && PM.state.on && !visible('incidentBanner'));
    ok('in the full editor, borrowed: Settings still say the Simple view', state.settings.advanced === true && !document.body.classList.contains('simple-mode') && savedSettings().advanced === false);
    saveSettings();
    ok('a save meanwhile does not keep the borrowed view', savedSettings().advanced === false);
    const sess = JSON.parse(sessionStorage.getItem('topo_provider_pm-net') || 'null');
    ok('the session is in this tab', !!sess && sess.incidentId === incId && sess.arrivalRev === clientRev && sess.at === arrivedAt && sess.prevAdvanced === false, show(sess && { i: sess.incidentId, r: sess.arrivalRev }));
    ok('the copy going back will name the revision received as its base', state.docBase === clientRev && state.docRev === clientRev);
    const sessJson = await until(() => !!(JSON.parse(sessionStorage.getItem('topo_provider_pm-net') || '{}').arrivalJson), 200)
      ? JSON.parse(sessionStorage.getItem('topo_provider_pm-net')).arrivalJson : null;
    ok('the copy received is copied from the revision store into the session, for a reload', !!sessJson && JSON.parse(sessJson).nodes.some((n) => n.id === 'rt' && n.name === 'Router'),
       String(sessJson).slice(0, 80));
    ok('the report\'s tab is open', visible('visitTabBtn') && el('visitTabBtn').getAttribute('aria-selected') === 'true' && !el('cfgPanel-visit').classList.contains('hidden'));
    ok('the strip names the problem', visible('providerStrip') && el('providerStripText').textContent.includes('No internet · Reception PC'), el('providerStripText').textContent);
    renderCanvasOnly();
    ok('its device is ringed on the map', (el('ui-node-pc') || { classList: { contains: () => false } }).classList.contains('inc-hit') && !el('ui-node-rt').classList.contains('inc-hit'));
    const svg = (canvasSvgMarkup() || {}).markup;
    ok('the ring is not in the SVG export', typeof svg === 'string' && svg.includes('Reception PC') && !svg.includes('inc-hit'), typeof svg + ' ' + String(svg).slice(0, 80) + ' hit=' + String(svg).includes('inc-hit'));

    // ---- 3. The panel ----
    const panel = el('cfgPanel-visit');
    ok('the panel holds the report: the words, the place, who', panel.textContent.includes('Nothing loads since 9.') && panel.textContent.includes('Reception PC') && panel.textContent.includes('Reported by: Ana'));
    ok('call and email the client', !!panel.querySelector('a[href="tel:5551"]') && !!panel.querySelector('a[href="mailto:ana@x.example"]'), [...panel.querySelectorAll('a')].map((a) => a.getAttribute('href')).join(' '));
    const selfSel = el('pmSelf');
    ok('which provider: the one it was sent to first', !!selfSel && selfSel.options[1] && selfSel.options[1].value === 'pI' && selfSel.value === '');
    selfSel.value = 'pI';
    selfSel.dispatchEvent(new Event('change', { bubbles: true }));
    ok('remembered in Settings', PM.providerSelfOf('pm-net') === 'pI' && (savedSettings().providerSelf || {})['pm-net'] === 'pI');
    ok('what you look after here', el('cfgPanel-visit').textContent.includes('You look after: 1 device'), el('cfgPanel-visit').textContent.slice(0, 400));

    // ---- 4. The provider works, then records the visit ----
    getNode('rt').name = 'Core router';
    save();
    state.nodes.push(N('ap', 'ap', { name: 'New AP', x: 100, y: 300, group: 'gB' }));
    save(); renderCanvasOnly();
    const leftAt = Math.ceil((arrivedAt + 3600000) / 60000) * 60000;
    H.now = () => leftAt;
    PM.openVisitDialog();
    await until(() => PM.state.vd && PM.state.vd.changesState !== 'loading');
    const vd = PM.state.vd;
    ok('Record visit opens', !!vd && !el('visitDialog').hidden && el('visitTitle').textContent === 'Record visit');
    ok('arrived defaults to when the copy arrived, left to now', el('visitArrived').value === toLocalInput(arrivedAt) && el('visitLeft').value === toLocalInput(leftAt),
       `${el('visitArrived').value} ${el('visitLeft').value}`);
    ok('the provider is the one chosen', el('visitProvider').value === 'pI');
    ok('the technician is the report\'s prepared-by name', el('visitBy').value === reportEngineerDefault());
    ok('what changed since the copy arrived: counted', vd.changesState === 'ok' && el('visitChangesSummary').textContent === '1 added, 1 changed, 0 removed', el('visitChangesSummary').textContent);
    const rows = [...el('visitChanges').querySelectorAll('li')].map((li) => li.textContent);
    ok('and listed', rows.includes('Added · Device: New AP') && rows.includes('Changed · Device: Core router') && rows.length === 2, show(rows));
    el('visitBy').value = '';
    el('visitSaveBtn').click();
    await tick();
    ok('nothing saves without how it went and who', el('visitError').textContent.includes('Choose how it went.') && el('visitError').textContent.includes('Type the technician\'s name.'), el('visitError').textContent);
    el('visitOutcomes').querySelector('input[value="fixed"]').click();
    el('visitNotes').value = 'Replaced the modem cable.';
    el('visitBy').value = 'Juan Pérez';
    el('visitSignoff').value = 'Ana';
    const logBefore = state.log.length;
    el('visitSaveBtn').click();
    await until(() => PM.state.vd && PM.state.vd.stage === 'return' && PM.state.vd.ret && PM.state.vd.ret.result);
    const entry = state.log[state.log.length - 1];
    ok('a visit entry', state.log.length === logBefore + 1 && entry.kind === 'visit' && entry.incidentId === incId && entry.providerId === 'pI' && entry.provider === 'Fibra Norte'
       && entry.by === 'Juan Pérez' && entry.outcome === 'fixed' && entry.notes === 'Replaced the modem cable.' && entry.signoff === 'Ana', show(entry) + ' err=' + el('visitError').textContent + ' vd=' + show(PM.state.vd && { stage: PM.state.vd.stage, outcome: PM.state.vd.outcome, by: PM.state.vd.by, busy: PM.state.vd.busy }));
    ok('its times', entry.arrived === arrivedAt - (arrivedAt % 60000) && entry.left === leftAt, `${entry.arrived} ${arrivedAt}`);
    ok('what changed, in no language', show(entry.changes.counts) === '{"added":1,"changed":1,"removed":0}'
       && entry.changes.items.some((x) => x.kind === 'device' && x.id === 'ap' && x.status === 'added' && x.name === 'New AP'), show(entry.changes));
    ok('chained to the entry before', /^[0-9a-f]{64}$/.test(entry.prev || '') && (await TopoMerge.verifyLog(state.log)) === -1);
    const inc = TI.incidentById ? TI.incidentById(incId) : state.incidents.find((x) => x.id === incId);
    ok('the report is visited, the visit listed', inc.status === 'visited' && show(inc.visits) === show([entry.id]), show(inc));
    ok('the technician is remembered as the prepared-by name', reportEngineerDefault() === 'Juan Pérez');

    // ---- 5. The copy back ----
    const r = PM.state.vd.ret;
    ok('locked with the passphrase that opened the link', r.samePass && r.pass === PASS && r.result.why === 'link' && !!r.result.url, r.result.why);
    ok('it says the client has it', el('visitPassNote').textContent.includes('the client already has it'));
    const backDoc = JSON.parse((await unsealFragment(fragOf(r.result.url), PASS)).json);
    ok('the copy holds the visit and the report visited', (backDoc.incidents || [])[0].status === 'visited' && backDoc.log.some((e) => e.id === entry.id));
    ok('its base is the revision the provider received', backDoc.base === clientRev && backDoc.rev && backDoc.rev !== clientRev, `${backDoc.base} ${backDoc.rev}`);
    ok('Email the client: shown, the reporter\'s address', visible('visitEmailBtn') && r.result.message.to.join() === 'ana@x.example');
    opened.length = 0; copied.length = 0; rich.length = 0;
    el('visitEmailBtn').click();
    await until(() => opened.length > 0);
    ok('the mailto: goes to the reporter with the subject', (opened[0] || '').startsWith('mailto:ana@x.example?subject=Visit%20recorded%20at%20Reception%3A%20Fixed'), (opened[0] || '').slice(0, 80));
    ok('the link never goes in the mailto:; the hyperlink goes to the clipboard first', rich.length === 1 && rich[0].text === r.result.url
       && rich[0].html === '<a href="' + r.result.url.replace(/&/g, '&amp;') + '">Follow the infrastructure link</a>' && !opened[0].includes('e~')
       && decodeURIComponent(opened[0]).includes('\nInfrastructure link:\n\n'), decodeURIComponent(opened[0] || '').slice(-300));
    ok('the return step says where to paste it', el('visitReturnStatus').textContent.startsWith('Your mail program is open and the infrastructure link is copied.'), el('visitReturnStatus').textContent);
    el('visitCopyMsgBtn').click();
    await until(() => rich.length > 1 && el('visitReturnStatus').textContent === 'Message copied.');
    ok('Copy message: rich with the hyperlink, plain with the raw link', rich.length === 2 && rich[1].html.includes('>Follow the infrastructure link</a>')
       && rich[1].text.includes('Follow the infrastructure link: ' + r.result.url) && rich[1].text.startsWith('Visit recorded at Reception: Fixed\n\n'), rich[1] && rich[1].html.slice(0, 120));
    ok('the call button for the reporter', visible('visitCallBtn') && el('visitCallBtn').getAttribute('href') === 'tel:5551');
    saved.length = 0;
    el('visitFileBtn').click();
    ok('Download: topo_…_visit.json', saved.length === 1 && /^topo_clinica-sol_reception_\d{4}-\d{2}-\d{2}_visit\.json$/.test(saved[0].name), saved[0] && saved[0].name);
    const visitFile = JSON.parse(await saved[0].blob.text());
    ok('the file names the same base', visitFile.doc.base === clientRev && visitFile.doc.incidents[0].status === 'visited');
    ok('the incident file\'s name, for comparison', /_incident\.json$/.test(TI.downloadIncidentFile('incident')));
    // The message, composed without a mail program.
    const shortMsg = PM.composeVisitMessage({ incident: inc, entry, site: 'Reception', link: 'https://t.example/#e~abc', sealed: true, samePass: true });
    ok('the message: who, how, the problem, the notes, the changes, the sign-off, the link', shortMsg.body.startsWith('Visit by Juan Pérez (Fibra Norte): Fixed.\nProblem: No internet\nWhere: Reception PC\nArrived: ')
       && shortMsg.body.includes('\n\nReplaced the modem cable.\n') && shortMsg.body.includes('Changes to the network: 2.') && shortMsg.body.includes('Signed off by: Ana')
       && shortMsg.body.includes('\nOpen the infrastructure link in Topo and keep it to bring the visit into your network.\nInfrastructure link:\n\nThe passphrase is the one you sent with the problem.')
       && !shortMsg.body.includes('t.example') && shortMsg.body.endsWith('The passphrase is the one you sent with the problem.'), shortMsg.body);
    ok('the full message has the raw link, the rich one the hyperlink', shortMsg.fullBody.includes('Follow the infrastructure link: https://t.example/#e~abc')
       && shortMsg.html.includes('<a href="https://t.example/#e~abc">Follow the infrastructure link</a>'), shortMsg.html);
    const newPass = PM.composeVisitMessage({ incident: inc, entry, site: 'R', link: 'https://t.example/#e~abc', sealed: true, samePass: false });
    ok('a new passphrase: sent separately', newPass.body.endsWith('The passphrase comes separately: I will send it by another way.'));
    const filed = PM.composeVisitMessage({ incident: Object.assign({}, inc, { reporter: { name: 'Ana', phone: '555-1' } }), entry, site: 'R', file: 'topo_a_b_2026-11-09_visit.json' });
    ok('a file, and a reporter with no email: no address, attach it', filed.to.length === 0 && filed.body.includes('topo_a_b_2026-11-09_visit.json') && !filed.body.includes('passphrase'));
    PM.closeVisitDialog();

    // A second visit lists only what changed after the first.
    PM.openVisitDialog();
    await until(() => PM.state.vd && PM.state.vd.changesState !== 'loading');
    ok('a second visit: nothing changed since the first went back', el('visitChangesSummary').textContent === 'No changes to the network were recorded.', el('visitChangesSummary').textContent);
    PM.closeVisitDialog();
    undo();
    ok('one undo takes the visit back, the report sent again', state.log.length === logBefore && state.incidents[0].status === 'sent' && state.incidents[0].visits.length === 0);
    PM.openVisitDialog();
    await until(() => PM.state.vd && PM.state.vd.changesState !== 'loading');
    ok('after the undo, Record visit compares with the copy received again, arrived its arrival', el('visitChangesSummary').textContent === '1 added, 1 changed, 0 removed'
       && el('visitArrived').value === toLocalInput(arrivedAt), el('visitChangesSummary').textContent + ' ' + el('visitArrived').value);
    PM.closeVisitDialog();
    redo();
    ok('redo puts it back', state.log.length === logBefore + 1 && state.incidents[0].status === 'visited');
    {
      const heldSelf = state.settings.providerSelf;
      delete state.settings.providerSelf;
      PM.openVisitDialog();
      ok('nobody remembered, the report sent to one provider: Record visit names that one', el('visitProvider').value === 'pI' && PM.state.vd.providerId === 'pI', el('visitProvider').value);
      PM.closeVisitDialog();
      state.settings.providerSelf = heldSelf;
    }

    // ---- 6. The copy received no longer held ----
    const keepSession = PM.state.session;
    PM.state.session = Object.assign({}, keepSession, { arrivalRev: 'nosuchrev', arrivalJson: undefined, lastVisitJson: undefined });
    PM.openVisitDialog();
    await until(() => PM.state.vd && PM.state.vd.changesState !== 'loading');
    ok('said when the copy received is not held', PM.state.vd.changesState === 'missing'
       && el('visitChangesSummary').textContent === 'The copy you received is no longer held in this tab, so the changes cannot be listed.');
    PM.closeVisitDialog();
    // After a reload the revision store no longer holds the copy received:
    // the session's copy of it lists the changes.
    PM.state.session = Object.assign({}, keepSession, { arrivalRev: 'nosuchrev', arrivalJson: sessJson, lastVisitJson: undefined, lastVisitId: undefined });
    PM.openVisitDialog();
    await until(() => PM.state.vd && PM.state.vd.changesState !== 'loading');
    ok('the store does not hold it, the session\'s copy does: the changes listed', PM.state.vd.changesState === 'ok'
       && el('visitChangesSummary').textContent === '1 added, 1 changed, 0 removed', el('visitChangesSummary').textContent);
    PM.closeVisitDialog();
    PM.state.session = Object.assign({}, keepSession, { arrivalRev: 'nosuchrev', arrivalJson: undefined, lastVisitJson: undefined });
    const bare = await PM.recordVisit({ incidentId: incId, providerId: 'pI', by: 'Juan Pérez', outcome: 'follow-up' });
    ok('and the visit still saves, with no list', !!bare && bare.changes === undefined && bare.outcome === 'follow-up' && state.incidents[0].visits.length === 2);
    ok('the visits so far are in the panel', el('cfgPanel-visit').querySelectorAll('.pm-visit').length === 2 && el('cfgPanel-visit').textContent.includes('Visit by Juan Pérez (Fibra Norte)'));
    ok('a left time before arrival is refused', PM.visitDraftProblems({ outcome: 'fixed', by: 'J', arrived: 10, left: 5 }).join() === 'The time you left is before the time you arrived.');
    PM.state.session = keepSession;

    // A reload: the page's network comes back from its entry.
    const liveDoc = serializeDoc();
    PM.exitProviderView();
    PM.state.session = null;
    ok('out of the view', !document.body.classList.contains('provider-mode') && state.settings.advanced === false);
    replaceDocument(liveDoc, { origin: 'live', docId: 'pm-net', docRev: state.docRev, docRevHash: state.docRevHash, docBase: state.docBase, docPrior: state.docPrior });
    ok('a reload re-enters provider mode from the session', document.body.classList.contains('provider-mode') && PM.state.on && PM.state.session && PM.state.session.incidentId === incId);
    history.replaceState(history.state, '', location.pathname + location.search + '#provider');
    await load();
    ok('#provider typed: consumed, nothing else', location.hash === '' && state.docId === 'pm-net' && state.nodes.some((n) => n.id === 'ap') && PM.state.on, location.hash);

    // Leave.
    PM.leaveProviderMode();
    ok('Leave: the view given back, the session dropped', !document.body.classList.contains('provider-mode') && state.settings.advanced === false
       && document.body.classList.contains('simple-mode') && !sessionStorage.getItem('topo_provider_pm-net') && !visible('visitTabBtn') && !visible('providerStrip'));
    renderCanvasOnly();
    ok('the ring goes with it', !document.querySelector('#layer-nodes .inc-hit'));

    // ---- 7. The client opens what came back ----
    CarinoLibrary.persistLibrary(clientLib);
    clearSessions();
    replaceDocument(backDoc, { origin: 'link' });
    ok('the client\'s network, not kept: the visited banner', state.docId === 'pm-net' && !isKept() && visible('incidentBanner'));
    ok('it names who came and how it went', /^⚠ Juan Pérez recorded a visit on .+: Fixed\.$/.test(el('incidentBannerText').textContent), el('incidentBannerText').textContent);
    ok('and offers the merge', el('incidentBannerGo').textContent === 'Merge into my network');
    const ctx = await mergeContext('pm-net', backDoc, docIdentity(backDoc));
    ok('the merge is three-way from the revision both started from', !!ctx.base && ctx.via === 'rev' && ctx.baseRev === clientRev, `${ctx.via} ${ctx.baseRev}`);
    // A merge that brings a sent report: the provider's banner.
    replaceDocument(JSON.parse(unsealed.json), { origin: 'library', libraryId: 'pm-net' });
    PM.state.arrival = null;
    PM.providerMergeArrival({ incidents: [] });
    ok('a merge bringing a sent report shows the provider\'s banner', visible('incidentBanner') && el('incidentBannerGo').textContent === 'I am the provider');
    PM.state.arrival = null;
    PM.renderIncidentBanner();
    PM.providerMergeArrival({ incidents: [{ id: incId, status: 'sent' }] });
    ok('one already sent here does not', !visible('incidentBanner'));
    {
      // The report as a file (_incident.json) through the one file door.
      const fileDoc = JSON.parse(unsealed.json);
      const envelope = () => ({ kind: 'nettopology', version: 1, doc: JSON.parse(JSON.stringify(fileDoc)) });
      let choiceAnswer = null;
      const askedHere = [];
      const prevResponder = setDialogResponder((req) => { askedHere.push(req.kind + ':' + (req.choices || []).map((c) => c.id).join('|')); return req.kind === 'confirm' ? true : req.kind === 'choice' ? choiceAnswer : null; });
      const heldReview = window.TopoMergeUI.setMergeResponder(() => ({}));
      const heldToast = window.showToast, toasts = [];
      window.showToast = (m) => { toasts.push(m); };
      try {
        CarinoLibrary.persistLibrary({}); clearSessions(); PM.state.arrival = null;
        replaceDocument(EMPTY_DOC, { origin: 'new' });
        const took = await applyImportedDoc(envelope(), { fileName: 'topo_clinica-sol_reception_2026-11-09_incident.json' });
        ok('an incident file of a network not here: the provider\'s banner', took === true && visible('incidentBanner') && el('incidentBannerGo').textContent === 'I am the provider',
           String(took) + ' ' + show(PM.state.arrival && PM.state.arrival.kind));
        // An IT firm that holds the network already, from before the report.
        const before = withoutIncidents(JSON.parse(JSON.stringify(fileDoc)));
        // Its own card: none of the client's revision marks (the copy did not leave from here).
        const firmCard = () => {
          const c = Object.assign({}, clientLib['pm-net'], { doc: Object.assign({}, before), updated: Date.now() - 60000 });
          ['rev', 'revHash', 'prior', 'base'].forEach((k) => { delete c[k]; delete c.doc[k]; });
          c.doc.log = (c.doc.log || []).filter((e) => e.kind !== 'merge');
          return { 'pm-net': c };
        };
        for (const how of ['merge', 'update']) {
          // The firm's browser holds none of the client's revisions.
          CarinoRevisions.dropRevisions('pm-net');
          CarinoLibrary.persistLibrary(firmCard()); clearSessions(); PM.state.arrival = null; PM.renderIncidentBanner();
          replaceDocument(EMPTY_DOC, { origin: 'new' });
          choiceAnswer = how;
          const t2 = await applyImportedDoc(envelope(), { fileName: 'topo_clinica-sol_reception_2026-11-09_incident.json' });
          await until(() => visible('incidentBanner'), 100);
          ok(`the network known here, the file's ${how}: the provider's banner`, t2 === true && state.libraryId === 'pm-net' && visible('incidentBanner')
             && el('incidentBannerGo').textContent === 'I am the provider', String(t2) + ' ' + state.libraryId + ' ' + show(PM.state.arrival) + ' ' + toasts.join(' / ') + ' asked=' + askedHere.join(','));
        }
      } finally {
        setDialogResponder(prevResponder);
        window.TopoMergeUI.setMergeResponder(heldReview);
        window.showToast = heldToast;
        PM.state.arrival = null; PM.renderIncidentBanner();
        CarinoLibrary.persistLibrary({});   // back to the provider's browser, which keeps none of it
      }
    }

    // ---- 8. Translated ----
    clearSessions();
    _arrivalPass = PASS;
    openArrivedDocument(unsealed.json);
    setLocale('es');
    PM.renderIncidentBanner();
    ok('the banner in Spanish', el('incidentBannerGo').textContent === 'Soy el proveedor' && el('incidentBannerText').textContent.includes('Sin internet'), el('incidentBannerText').textContent);
    PM.enterProviderMode(incId);
    PM.renderProviderPanel();
    ok('the panel in Spanish', el('cfgPanel-visit').textContent.includes('¿Qué proveedor eres?') && el('cfgPanel-visit').textContent.includes('Registrar visita'));
    PM.openVisitDialog();
    await until(() => PM.state.vd && PM.state.vd.changesState !== 'loading');
    ok('Record visit in Spanish', el('visitTitle').textContent === 'Registrar visita' && el('visitOutcomes').textContent.includes('Resuelto'));
    PM.closeVisitDialog();
    PM.leaveProviderMode();
    // Sentences are joined per language (step 3): no space after 。.
    const visitE = { at: Date.UTC(2026, 10, 10, 14, 10), by: 'Juan', provider: 'Fibra Norte', outcome: 'fixed', changes: { counts: { added: 1, changed: 0, removed: 0 } } };
    setLocale('ja');
    const jaLine = visitLineText(visitE);
    ok('the visit line in Japanese: no space after 。', jaLine.includes('解決。変更 1 件。') && !jaLine.includes('。 '), jaLine);
    setLocale('en');
    ok('the visit line in English keeps its space', visitLineText(visitE).endsWith('Fixed. 1 change.'), visitLineText(visitE));
    ok('joinSentences: spaces in English, none after a full-width stop', joinSentences(['A.', '', 'B.']) === 'A. B.' && joinSentences(['解決。', '変更 1 件。']) === '解決。変更 1 件。');
    const req = new XMLHttpRequest(); req.open('GET', 'js/providermode.js', false); req.send();
    const keys = tKeys(req.responseText)
      .concat(Object.values(PM.VISIT_OUTCOME_LABEL), Object.values(VISIT_KIND_WORD), Object.values(VISIT_STATUS_WORD), Object.values(INCIDENT_STATUS_WORD), ['Arrived', 'Left', 'How did it go?', 'Technician\'s name', 'Client\'s name (typed on this device)', 'What changed since the copy arrived']);
    const { has, locales } = window.CarinoI18N;
    ok('the module asks for a real number of strings', keys.length > 40, `${keys.length}`);
    locales.forEach((loc) => {
      const missing = keys.filter((k) => !has(loc, k));
      ok(`${loc} carries every string of provider mode`, missing.length === 0, missing.slice(0, 3).join(' | '));
    });
    ok('Japanese never says パソコン', !keys.some((k) => String((window.CarinoI18N.MESSAGES.ja || {})[k] || '').includes('パソコン')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    try { PM.closeVisitDialog(); } catch (e) { /* closed */ }
    try { if (PM.state.on) PM.leaveProviderMode(); } catch (e) { /* off */ }
    clearSessions();
    Object.assign(H, { open: held.open, copy: held.copy, copyRich: held.copyRich, share: held.share, canShare: held.canShare, now: held.now });
    window.saveBlob = held.saveBlob;
    CarinoLibrary.persistLibrary(heldLib);
    Object.keys(state.settings).forEach((k) => { delete state.settings[k]; });
    Object.assign(state.settings, heldSettings);
    saveSettings(); applyProfile();
    setLocale('en');
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
