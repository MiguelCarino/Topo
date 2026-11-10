// @realtime — sealing and the log's hash chain await Web Crypto.
// Problem reports, step 4 stage 3 (js/incidents.js, docs/SCOPE.md section 4):
//   1. the message, pure: subject, body lines, the mailto: encoded, the link
//      left out (and said to be in the clipboard) when the mailto: would pass
//      1900 characters, which with a real locked link is the usual case; a
//      file instead of a link; providers with no email named;
//   2. what a report needs before it saves (a symptom, a name, a phone or an
//      email that reads as one);
//   3. Save: the incident's fields, status open, an 'opened' log entry, one
//      undo step, the network kept in this browser first, the reporter
//      remembered in Settings and in no URL;
//   4. Send: status sent, sentAt the first time only, routedTo grows, a
//      'sent' entry chained to the one before (verifyLog -1), a locked link
//      that opens back to the same report; too big for a link (or no lock
//      here) downloads topo_…_incident.json instead; a link that cannot be
//      made undoes the 'sent' it had just saved;
//   5. the sheet: seven tiles, the symptom's devices first in the list, Tap
//      it on the map, the contacts ranked with their ticks, Save and send to
//      the result, Email through the mailto: with the link in the clipboard;
//      the password-in-notes warning holds the link back until Send anyway;
//   6. the share dialog leaves reports and visits out unless ticked
//      (withoutIncidents mends the copy's chain);
//   7. translated: the sheet in es, every new string in every locale, and
//      Japanese never says パソコン.
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
  const TI = window.TopoIncidents;
  const H = TI.hooks;
  const held = { urlMax: H.urlMax, open: H.open, copy: H.copy, share: H.share, canShare: H.canShare, saveBlob: window.saveBlob, build: window.buildShareLink };
  const heldLib = CarinoLibrary.loadLibrary();
  const heldReporter = state.settings.reporter;
  const opened = [], copied = [], saved = [];
  H.open = (u) => opened.push(u);
  H.copy = async (s) => { copied.push(s); };
  window.saveBlob = (blob, name) => { saved.push({ blob, name }); };
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({
    v: DOC_VERSION,
    report: { client: 'Clinica Sol', site: 'Reception' },
    providers: [
      { id: 'pI', name: 'Fibra Norte', service: 'internet', phone: '+52 55 1234 5678', email: 'noc@fibra.example', hours: '24/7' },
      { id: 'pT', name: 'Andes IT', service: 'it', phone: '555-0100', email: 'help@andes.example' },
      { id: 'pS', name: 'Casa Segura', service: 'security', phone: '555-0199' }
    ],
    groups: [{ id: 'gB', name: 'Office', kind: 'building', providers: ['pT'] }],
    nodes: [
      N('isp', 'cloud', { name: 'Internet', providers: ['pI'], x: 0, y: 0 }),
      N('rt', 'router', { name: 'Router', x: 0, y: 100 }),
      N('sw', 'switch', { name: 'Switch', x: 0, y: 200, group: 'gB' }),
      N('pc', 'pc', { name: 'Reception PC', x: -100, y: 300, group: 'gB' }),
      N('cam', 'camera', { name: 'Door cam', x: 100, y: 300, group: 'gB', providers: ['pS'] })
    ],
    links: [
      { id: 'l1', source: 'isp', target: 'rt' }, { id: 'l2', source: 'rt', target: 'sw' },
      { id: 'l3', source: 'sw', target: 'pc' }, { id: 'l4', source: 'sw', target: 'cam' }
    ]
  });
  const PASS = 'test-pass-word-123';

  try {
    await until(() => typeof replaceDocument === 'function' && typeof canSeal === 'function' && !!TI);
    setLocale('en');
    CarinoLibrary.persistLibrary({});
    delete state.settings.reporter;

    // ---- 1. The message ----
    const inc0 = { id: 'inabc', at: Date.UTC(2026, 10, 9, 15, 0), symptom: 'internet', nodeIds: ['pc'], text: 'Nothing loads since 9.', reporter: { name: 'Ana', phone: '555-1', email: 'ana@x.example' } };
    replaceDocument(site(), { origin: 'link', docId: 'inc-net' });
    const pvs = state.providers;
    const short = TI.composeIncidentMessage({ incident: inc0, site: 'Reception', providers: [pvs[0], pvs[2]], link: 'https://t.example/#e~abc', sealed: true });
    ok('the subject names the site and the symptom', short.subject === 'Network problem at Reception: No internet', short.subject);
    ok('the body: the words, the problem, where, who, the link, the passphrase line',
       short.body.startsWith('Nothing loads since 9.\n\nProblem: No internet\nWhere: Reception PC\nReported by: Ana · 555-1 · ana@x.example\nWhen: ')
       && short.body.includes('Open the network in Topo: https://t.example/#e~abc') && short.body.endsWith('The passphrase comes separately: I will send it by another way.'), short.body);
    ok('the mailto: goes to the providers with an email, encoded', short.mailto.startsWith('mailto:noc@fibra.example?subject=Network%20problem%20at%20Reception')
       && short.mailto.includes('&body=Nothing%20loads') && !short.linkLeftOut && short.to.join() === 'noc@fibra.example', short.mailto.slice(0, 90));
    ok('a provider with no email is named, not lost', show(short.noEmail) === '["Casa Segura"]');
    ok('the full body is the body when the link fits', short.fullBody === short.body);
    const longLink = 'https://topo.carino.systems/#e~' + 'A'.repeat(2200);
    const long = TI.composeIncidentMessage({ incident: inc0, site: 'Reception', providers: [pvs[0], pvs[1]], link: longLink, sealed: true });
    ok('a real locked link is too long for a mailto: so the email says it is in the clipboard', long.linkLeftOut && !long.body.includes('e~')
       && long.body.includes('The link is in your clipboard: paste it here.') && long.mailto.length <= TI.INCIDENT_MAILTO_MAX, `${long.mailto.length}`);
    ok('Copy message and Share still carry the link', long.fullBody.includes(longLink));
    ok('two providers: both addresses', long.to.join(',') === 'noc@fibra.example,help@andes.example' && long.mailto.startsWith('mailto:noc@fibra.example,help@andes.example?'));
    const huge = TI.composeIncidentMessage({ incident: Object.assign({}, inc0, { text: 'x'.repeat(2000) }), site: 'R', providers: [pvs[0]], link: longLink, sealed: true });
    ok('words too long for a mailto: are shortened in the email only', huge.mailto.length <= TI.INCIDENT_MAILTO_MAX && huge.body.includes('…') && huge.fullBody.includes('x'.repeat(2000)), `${huge.mailto.length}`);
    const filed = TI.composeIncidentMessage({ incident: inc0, site: 'R', providers: [pvs[0]], file: 'topo_a_b_2026-11-09_incident.json' });
    ok('a file instead of a link: attach it, no passphrase line', filed.body.includes('The network is in the attached file topo_a_b_2026-11-09_incident.json. Open it with Topo: ')
       && !filed.body.includes('passphrase') && !filed.linkLeftOut);

    // ---- 2. What a report needs ----
    ok('nothing typed: a symptom, a name, a way to reach you', TI.incidentDraftProblems({}).length === 3, show(TI.incidentDraftProblems({})));
    ok('a phone is enough', TI.incidentDraftProblems({ symptom: 'wifi', name: 'Ana', phone: '1' }).length === 0);
    ok('an email that does not read as one is refused', TI.incidentDraftProblems({ symptom: 'wifi', name: 'Ana', email: 'ana@' }).join() === 'That email does not look right.');
    ok('an unknown symptom is refused', TI.incidentDraftProblems({ symptom: 'fire', name: 'Ana', phone: '1' }).length === 1);

    // ---- 3. Save ----
    ok('a link arrival is not kept yet', !isKept() && state.incidents.length === 0);
    const before = JSON.stringify(serializeDoc());
    const id = await TI.createIncident({ symptom: 'internet', nodeIds: ['pc'], text: 'Nothing loads since 9.', name: 'Ana', phone: '555-1', email: 'ana@x.example', routedTo: ['pI'], remember: true });
    const inc = state.incidents[0];
    ok('Save makes the incident', !!id && state.incidents.length === 1 && inc.id === id && /^in[0-9a-z]{10}$/.test(id), id);
    ok('its fields', inc.status === 'open' && inc.symptom === 'internet' && show(inc.nodeIds) === '["pc"]' && inc.text === 'Nothing loads since 9.'
       && show(inc.reporter) === '{"name":"Ana","phone":"555-1","email":"ana@x.example"}' && show(inc.routedTo) === '["pI"]' && !inc.sentAt && show(inc.visits) === '[]', show(inc));
    const opened1 = state.log[state.log.length - 1];
    ok('one log entry: opened', state.log.length === 1 && opened1.kind === 'incident' && opened1.event === 'opened' && opened1.incidentId === id && opened1.symptom === 'internet', show(opened1));
    ok('the network was kept first, so a visit sent back has a card', isKept() && state.libraryId === 'inc-net' && !!CarinoLibrary.loadLibrary()['inc-net']);
    ok('the card holds the report', ((CarinoLibrary.loadLibrary()['inc-net'] || {}).doc || {}).incidents?.length === 1);
    ok('the reporter is remembered in this browser', show(state.settings.reporter) === '{"name":"Ana","phone":"555-1","email":"ana@x.example"}'
       && /"reporter":\{"name":"Ana"/.test(localStorage.getItem('nettopo_settings') || ''));
    ok('and never in the URL', !location.href.includes('555-1') && !location.href.includes('Ana'));
    undo();
    ok('one undo takes the report and its entry back', state.incidents.length === 0 && state.log.length === 0 && JSON.stringify(serializeDoc()) === before);
    redo();
    ok('redo puts both back', state.incidents.length === 1 && state.log.length === 1);

    // ---- 4. Send ----
    const r1 = await TI.sendIncident(id, { providerIds: ['pI'], passphrase: PASS });
    const s1 = state.incidents[0];
    ok('Send: status sent, sentAt set', r1.ok && s1.status === 'sent' && Number.isFinite(s1.sentAt), show(r1.ok ? s1 : r1));
    ok('a locked link to this page', r1.why === 'link' && typeof r1.url === 'string' && r1.url.startsWith(publicBase()) && r1.url.includes('#e~') && !r1.file, String(r1.url).slice(0, 60));
    const sent1 = state.log[state.log.length - 1];
    ok('a sent entry, chained to the one before', state.log.length === 2 && sent1.event === 'sent' && show(sent1.routedTo) === '["pI"]' && /^[0-9a-f]{64}$/.test(sent1.prev || '')
       && (await TopoMerge.verifyLog(state.log)) === -1, show(sent1));
    const back = await unsealFragment(r1.url.slice(r1.url.indexOf('#') + 1), PASS);
    const arrived = JSON.parse(back.json);
    const ai = (arrived.incidents || [])[0] || {};
    ok('the link opens back to the same report, already sent', ai.id === id && ai.status === 'sent' && ai.reporter.phone === '555-1' && arrived.log.length === 2, show(ai));
    ok('the full message carries the link; the email does when it fits', r1.message.fullBody.includes(r1.url) && r1.message.body.includes(r1.url) === !r1.message.linkLeftOut);
    const firstSent = s1.sentAt;
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await TI.sendIncident(id, { providerIds: ['pT'], passphrase: PASS });
    const s2 = state.incidents[0];
    ok('Send again: sentAt kept, routedTo grows, another entry', r2.ok && s2.sentAt === firstSent && show(s2.routedTo) === '["pI","pT"]' && state.log.length === 3
       && state.log[2].event === 'sent' && show(state.log[2].routedTo) === '["pT"]', show(s2));
    undo();
    ok('each send is one undo step', state.log.length === 2 && show(state.incidents[0].routedTo) === '["pI"]');
    redo();

    // Too big for a link: the file.
    H.urlMax = () => 100;
    saved.length = 0;
    const r3 = await TI.sendIncident(id, { passphrase: PASS });
    ok('too big for a link: the file, named for what it is', r3.ok && r3.why === 'too-long' && !r3.url && /^topo_clinica-sol_reception_\d{4}-\d{2}-\d{2}_incident\.json$/.test(r3.file)
       && saved.length === 1 && saved[0].name === r3.file, `${r3.why} ${r3.file}`);
    const fileDoc = JSON.parse(await saved[0].blob.text());
    ok('the file is a Topo network file with the report and its whole log', fileDoc.kind === 'nettopology' && fileDoc.doc.incidents[0].id === id && fileDoc.doc.log.length === 4
       && String(fileDoc.$schema || '').includes('topo-v18'), String(fileDoc.$schema));
    ok('its message says to attach it', r3.message.body.includes(r3.file) && !r3.message.linkLeftOut);
    H.urlMax = held.urlMax;
    // A visit-heavy network goes as a file: sent for real, with the real cap
    // (the log counts towards the link's length). The notes are varied text,
    // so the link's compression cannot hide them.
    {
      let seed = 7;
      const prose = (n) => { let x = ''; while (x.length < n) { seed = (seed * 1103515245 + 12345) % 2147483648; x += 'abcdefghijklmnopqrstuvwxyz .,'[seed % 29]; } return x; };
      const big = [];
      for (let i = 0; i < 40; i++) big.push(visitLogEntry({ id: 'lgv' + i, at: 1e12 + i, incidentId: id, providerId: 'pT', provider: 'Andes IT', by: 'Tech ' + i, outcome: 'fixed', notes: prose(3000),
        changes: { counts: { added: 1, changed: 0, removed: 0 }, items: Array.from({ length: 200 }, (_, k) => ({ kind: 'devices', id: 'd' + k, name: 'Device ' + k, status: 'added' })) } }));
      const logN = state.log.length;
      batch(() => { state.log = state.log.concat(big); save(); });
      saved.length = 0;
      const r5 = await TI.sendIncident(id, { passphrase: PASS });
      ok('a visit-heavy network is sent as the file, not an oversized link', r5.ok && r5.why === 'too-long' && !r5.url && saved.length === 1 && saved[0].name === r5.file,
         String(r5.why) + ' ' + String(r5.url && r5.url.length));
      undo(); undo();
      ok('and two undo steps take the send and the heavy log back', state.log.length === logN && !state.log.some((e) => e.id === 'lgv0'), String(state.log.length));
    }

    // A link that cannot be made: the sent step is taken back.
    const logBefore = state.log.length, statusBefore = state.incidents[0].status, sentBefore = state.incidents[0].sentAt;
    window.buildShareLink = async () => { throw new Error('no'); };
    const r4 = await TI.sendIncident(id, { passphrase: PASS });
    window.buildShareLink = held.build;
    ok('a failed link undoes the sent it had saved', !r4.ok && r4.reason === 'build' && state.log.length === logBefore && state.incidents[0].status === statusBefore
       && state.incidents[0].sentAt === sentBefore, show(r4));

    // No lock on this page: the file, never an unlocked link.
    const subtle = Object.getOwnPropertyDescriptor(Crypto.prototype, 'subtle');
    Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true });
    saved.length = 0;
    let r5;
    try { r5 = await TI.sendIncident(id, { passphrase: PASS }); }
    finally { delete window.crypto.subtle; }
    ok('a page that cannot lock sends the file', r5.ok && r5.why === 'no-seal' && !r5.url && saved.length === 1 && /_incident\.json$/.test(saved[0].name), show(r5 && r5.why));
    ok('Web Crypto is back', !!(subtle && window.crypto.subtle));
    ok('the chain still reads as whole', (await TopoMerge.verifyLog(state.log)) === -1);

    // ---- 5. The sheet ----
    selectEntries([{ type: 'node', id: 'cam' }]);
    TI.openProblemDialog();
    ok('Report a problem opens the sheet', !el('problemDialog').hidden && !el('problemForm').hidden && el('problemSend').hidden);
    ok('seven symptom tiles', el('problemSymptoms').querySelectorAll('input[type=radio]').length === 7);
    ok('the selected device is the place to start', show(TI.draft.nodeIds) === '["cam"]' && el('problemWhere').textContent.includes('CAM') === false && el('problemWhere').textContent.includes('Door cam'));
    ok('the reporter is filled in from Settings', el('problemName').value === 'Ana' && el('problemPhone').value === '555-1');
    const tile = el('problemSymptoms').querySelector('input[value=camera]');
    tile.checked = true; tile.dispatchEvent(new Event('change', { bubbles: true }));
    const contacts = [...el('problemContacts').querySelectorAll('.pb-contact')];
    ok('the contacts, CCTV first, with a call button and Send to', contacts.length === 3 && contacts[0].textContent.includes('Casa Segura')
       && contacts[0].querySelector('a.pb-call').getAttribute('href') === 'tel:5550199' && contacts[0].querySelector('input[data-sendto=pS]').checked
       && !contacts[1].querySelector('input[data-sendto]').checked, contacts.map((c) => c.textContent).join(' | '));
    // Remove the camera, pick the PC from the list.
    el('problemWhere').querySelector('[data-remove=cam]').click();
    const likely = el('problemDevicePick').querySelector('optgroup');
    ok('a camera problem lists the cameras first', !!likely && likely.label === 'Likely' && [...likely.children].map((o) => o.value).join() === 'cam'
       && el('problemDevicePick').querySelectorAll('optgroup')[1].label === 'Every device', likely ? likely.innerHTML.slice(0, 80) : 'none');
    const pick = el('problemDevicePick');
    pick.value = 'pc'; pick.dispatchEvent(new Event('change', { bubbles: true }));
    ok('choose from a list adds the device', show(TI.draft.nodeIds) === '["pc"]');
    // Tap it on the map.
    el('problemTapBtn').click();
    ok('Tap it on the map: the sheet steps aside and a banner asks', el('problemDialog').hidden && !el('problemPickBanner').hidden
       && el('problemPickBanner').textContent.includes('Tap the device with the problem'));
    selectEntries([{ type: 'node', id: 'rt' }]);
    await until(() => !el('problemDialog').hidden);
    ok('the device tapped joins, and the sheet is back as it was', !el('problemDialog').hidden && el('problemPickBanner').hidden && show(TI.draft.nodeIds) === '["pc","rt"]'
       && el('problemName').value === 'Ana', show(TI.draft.nodeIds));
    el('problemText').value = 'Camera shows nothing'; el('problemText').dispatchEvent(new Event('input', { bubbles: true }));
    ok('the counter counts', el('problemCount').textContent === '20 of 2000 characters', el('problemCount').textContent);
    el('problemName').value = '';
    el('problemSaveBtn').click();
    await tick();
    ok('a missing name is said, nothing saved', el('problemError').textContent.includes('Type your name.') && state.incidents.length === 1);
    el('problemName').value = 'Ana';
    opened.length = 0; copied.length = 0;
    el('problemSaveSendBtn').click();
    await until(() => TI.draft.send && TI.draft.send.result, 600);
    const inc2 = state.incidents[1];
    ok('Save and send: the report saved and sent to the ticked provider', !!inc2 && inc2.symptom === 'camera' && inc2.status === 'sent' && show(inc2.routedTo) === '["pS"]'
       && show(inc2.nodeIds) === '["pc","rt"]', show(inc2));
    ok('the send step: status, link, passphrase masked', !el('problemSend').hidden && el('problemSendStatus').textContent.startsWith('Marked as sent. The link is locked')
       && el('problemLink').value.includes('#e~') && el('problemPass').type === 'password' && el('problemPass').value.length >= 16, el('problemSendStatus').textContent);
    el('problemPassShow').click();
    ok('Show reveals the passphrase', el('problemPass').type === 'text' && el('problemPassShow').getAttribute('aria-pressed') === 'true');
    el('problemEmailBtn').click();
    await until(() => opened.length > 0);
    const leftOut = TI.draft.send.result.message.linkLeftOut;
    ok('Email: a long link to the clipboard, then the mailto:', opened.length === 1 && opened[0].startsWith('mailto:?subject=') && opened[0].length <= TI.INCIDENT_MAILTO_MAX
       && (leftOut ? copied[0] === el('problemLink').value && el('problemSendStatus').textContent.startsWith('The link is in your clipboard.') : copied.length === 0 && opened[0].includes('e~')),
       `${leftOut} ${opened[0] && opened[0].length} ${el('problemSendStatus').textContent}`);
    ok('Casa Segura has no email: the mailto: has no address, and the call button stays', el('problemCalls').querySelector('a[href="tel:5550199"]') !== null);
    el('problemCopyMsgBtn').click();
    await until(() => copied.length > (leftOut ? 1 : 0));
    ok('Copy message: subject, body, and the link', copied[copied.length - 1].startsWith('Network problem at Reception: Cameras\n\nCamera shows nothing') && copied[copied.length - 1].includes(el('problemLink').value));
    H.canShare = () => false; TI.closeProblemDialog(); TI.openIncidentSend(inc2.id);
    await until(() => TI.draft.send && TI.draft.send.result, 600);
    ok('Send again from a saved report; no share sheet here, no Share button', !!TI.draft.send.result && el('problemShareBtn').classList.contains('hidden') && state.incidents[1].routedTo.join() === 'pS');
    H.canShare = held.canShare;
    TI.closeProblemDialog();

    // The password warning holds the link back.
    getNode('pc').notes = 'admin password: hunter22';
    save();
    const logN = state.log.length;
    TI.openIncidentSend(inc2.id);
    await tick(); await tick();
    ok('a password in the notes: the warning, no link yet, Send anyway', !el('problemLint').classList.contains('hidden')
       && el('problemLint').textContent.includes('Reception PC') && !TI.draft.send.result && !el('problemMakeBtn').classList.contains('hidden')
       && el('problemMakeBtn').textContent === 'Send anyway' && state.log.length === logN, el('problemLint').textContent);
    el('problemMakeBtn').click();
    await until(() => TI.draft.send.result, 600);
    ok('Send anyway sends', !!TI.draft.send.result && state.log.length === logN + 1);
    TI.closeProblemDialog();
    const hits = docSecretHits(Object.assign({}, serializeDoc(), { incidents: [{ id: 'inzz', symptom: 'other', text: 'wifi password: hunter22' }] }));
    ok('the warning reads a report\'s words too', hits.some((h) => h.kind === 'incident' && h.id === 'inzz'));

    // ---- 6. Links leave the reports out unless ticked ----
    const chained = [
      { id: 'a', at: 1, kind: 'merge', source: 'link', counts: {} },
      { id: 'b', at: 2, kind: 'incident', incidentId: 'inx', event: 'opened', symptom: 'wifi', prev: 'f'.repeat(64) },
      { id: 'c', at: 3, kind: 'merge', source: 'link', counts: {}, prev: 'e'.repeat(64) },
      { id: 'd', at: 4, kind: 'merge', source: 'link', counts: {}, prev: 'd'.repeat(64) }
    ];
    const stripped = withoutIncidents({ v: DOC_VERSION, nodes: [], links: [], incidents: [{ id: 'inx' }], log: chained });
    ok('withoutIncidents: no reports, no incident entries, every later prev taken off', !('incidents' in stripped) && stripped.log.map((e) => e.id).join() === 'a,c,d'
       && !('prev' in stripped.log[1]) && !('prev' in stripped.log[2]) && chained[2].prev === 'e'.repeat(64), show(stripped.log));
    {
      // Real digests: M0, an incident, M1, M2 chained; dropping the incident
      // and chaining again must verify (a stale prev on M2 would not).
      const real = await TopoMerge.chainLog(chained.map((e) => { const c = Object.assign({}, e); delete c.prev; return c; }));
      const realOk = (await TopoMerge.verifyLog(real)) === -1;
      const cut = withoutIncidents({ v: DOC_VERSION, nodes: [], links: [], log: real });
      const mended = await relinkLog(cut);
      ok('a log that lost an incident entry is chained again and verifies', realOk && (await TopoMerge.verifyLog(mended.log)) === -1
         && mended.log.every((e, i) => i === 0 || /^[0-9a-f]{64}$/.test(e.prev)) && real[3].prev !== mended.log[2].prev, show(mended.log));
    }
    openShareDialog('doc');
    ok('the share dialog offers the reports, unticked', !el('shareIncidentsRow').classList.contains('hidden') && !el('shareIncidents').checked);
    closeShareDialog();
    const plainOut = await buildShareLink('doc', true, PASS);
    const plainDoc = JSON.parse((await unsealFragment(plainOut.slice(plainOut.indexOf('#') + 1), PASS)).json);
    ok('a link made without the tick carries no report and no incident entry', !plainDoc.incidents && !(plainDoc.log || []).some((e) => e.kind === 'incident'));
    ok('and its log still verifies', (await TopoMerge.verifyLog(plainDoc.log || [])) === -1);

    // ---- 7. Translated ----
    setLocale('es');
    TI.openProblemDialog();
    ok('the sheet in Spanish', el('problemTitle').textContent === 'Reportar un problema' && el('problemSymptoms').textContent.includes('Sin internet')
       && el('problemTapBtn').textContent === 'Tócalo en el mapa', el('problemTitle').textContent);
    const esMsg = TI.composeIncidentMessage({ incident: inc0, site: 'Recepción', providers: [], link: 'https://t/#e~a', sealed: true });
    ok('the email in Spanish', esMsg.subject === 'Problema de red en Recepción: Sin internet' && esMsg.body.includes('Dónde: Reception PC'), esMsg.subject);
    TI.closeProblemDialog();
    setLocale('en');
    const req = new XMLHttpRequest(); req.open('GET', 'js/incidents.js', false); req.send();
    const keys = tKeys(req.responseText).concat(Object.values(INCIDENT_STATUS_TEXT));
    const { has, locales } = window.CarinoI18N;
    ok('the module asks for a real number of strings', keys.length > 40, `${keys.length}`);
    locales.forEach((loc) => {
      const missing = keys.filter((k) => !has(loc, k));
      ok(`${loc} carries every string of the sheet`, missing.length === 0, missing.slice(0, 3).join(' | '));
    });
    ok('Japanese never says パソコン', !keys.some((k) => String((window.CarinoI18N.MESSAGES.ja || {})[k] || '').includes('パソコン')));
    ok('the static strings too', ['⚠ Report a problem', 'What is wrong?', 'Whom to contact', 'Save and send', 'Include problem reports and visits (names, phone numbers)']
       .every((k) => locales.every((loc) => has(loc, k))));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    Object.assign(H, { urlMax: held.urlMax, open: held.open, copy: held.copy, share: held.share, canShare: held.canShare });
    window.saveBlob = held.saveBlob;
    window.buildShareLink = held.build;
    try { TI.closeProblemDialog(); } catch (e) { /* closed */ }
    CarinoLibrary.persistLibrary(heldLib);
    if (heldReporter) state.settings.reporter = heldReporter; else delete state.settings.reporter;
    saveSettings();
    setLocale('en');
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
