// Address history, stage 2: the History section in the Full editor's device
// panel (docs/BACKLOG.md feature 5; js/trail.js renderHistoryFields). Not
// tests/suites/history.js: that is the undo suite. Asserted here:
//   1. the slot: <details id="historyGroup" data-adv> after Locate (Asset,
//      Locate, History), closed by default, its open state kept in this
//      browser (HISTORY_OPEN_KEY) and restored;
//   2. the empty states: a network not kept, a read-only one, a kept one
//      with nothing recorded (the plain text), every one saying it lives in
//      this browser only and does not travel with files, links or binders;
//      a device with values only held now says no changes since its first;
//   3. the blocks: an address changed between points (the value now with
//      "since", the past one with its dates and kind), a MAC per NIC, a
//      replug as Switch port, a group moved by its path, a rename; a switch
//      renamed is no port change; a value changed on screen and not yet
//      recorded reads as now with the past below; a removed NIC's past kept;
//      the summary's count (singular and plural); nothing drawn is an edit;
//   4. the address-reuse hint: a device holding now what another device on
//      the map held before says whose it was and until when; not when both
//      hold it now (a duplicate is a finding), not for a removed device;
//   5. Forget this device's history: asks first, Cancel keeps it, yes drops
//      only that device, no edit and no undo step;
//   6. the landing card's Clear history: only on a card with a trail, asks
//      first, clears that card's trail and no other, the card itself kept;
//   7. the section gone in the reduced views and hidden in a multi-selection,
//      a point recorded while it shows drawn again, 44px on a phone;
//   8. the strings in es, pt-BR, ja (PC, never コンピューター) and ru;
//   9. the Settings toggle 'Keep address history at back-ups and reports':
//      a History section after Reports (in every view since the owner's
//      2026-11-05 call; tests/suites/trailsimple.js holds the Simple side),
//      ticked by default, off kept through saveSettings/loadSettings and
//      stopping back-ups and reports from recording while the trail already
//      there stays, no undo step, on again dropping the kept key, shown in
//      #simple, its words in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const T = window.CarinoTrail;
  const L = window.CarinoLibrary;
  const { LIBRARY_KEY, BINDER_EXPORT_KEY } = L;
  const heldTrailSetting = state.settings.trailRecording;
  const held = [LIBRARY_KEY, BINDER_EXPORT_KEY, T.HISTORY_OPEN_KEY, SETTINGS_KEY].map((k) => [k, localStorage.getItem(k)]);
  const heldLib = L.loadLibrary();
  let answer = true;
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return req.kind === 'confirm' ? answer : undefined; });
  const gone = (id) => getComputedStyle(el(id)).display === 'none' || el(id).offsetParent === null;
  const undoBtn = () => el('undoBtn');
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const body = () => el('historyBody');
  const sum = () => el('historySummary').textContent;
  const block = (f, k = '') => body().querySelector(`.hist-block[data-f="${f}"][data-k="${k}"]`);
  const lines = (b) => (b ? [...b.querySelectorAll('.hist-line')].map((li) => [...li.children].map((c) => c.textContent).join(' ').replace(/\s+/g, ' ').trim()) : []);
  const day = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  const D1 = day(2026, 3, 2), D2 = day(2026, 9, 14), D3 = day(2026, 10, 1);

  const site = () => ({
    v: DOC_VERSION,
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 }, interfaces: [] },
      { id: 'pc', type: 'pc', name: 'PC-1', x: 100, y: 200, group: 'r3',
        interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24', mac: 'aa-bb-cc-00-11-22' }, { id: 'i2', name: 'wlan0', ip: '' }] },
      { id: 'cam', type: 'camera', name: 'CAM-03', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.77/24' }] },
      { id: 'prn', type: 'printer', name: 'Printer', x: 300, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.90/24' }] }
    ],
    links: [
      { id: 'up', source: 'rt', target: 'sw', sourceIface: 'e0', targetIface: 'p24' },
      { id: 'a', source: 'sw', target: 'pc', sourceIface: 'p12', targetIface: 'i1' },
      { id: 'b', source: 'sw', target: 'cam', sourceIface: 'p5', targetIface: 'i1' }
    ],
    groups: [{ id: 'b1', name: 'Building A', kind: 'building' }, { id: 'r3', name: 'Rack 3', kind: 'rack', parent: 'b1' },
      { id: 'r4', name: 'Rack 4', kind: 'rack', parent: 'b1' }],
    networks: [{ id: 'lan', cidr: '192.168.1.0/24', name: 'LAN' }]
  });
  const record = (id, kind, at) => T.recordPoint(id, kind, serializeDoc(), at);

  try {
    setLocale('en');
    persistLibrary({});
    try { localStorage.removeItem(T.HISTORY_OPEN_KEY); } catch (e) { /* blocked */ }

    // ---- 1. The slot and its open state ----
    replaceDocument(site(), { origin: 'file' });
    setView('map');
    ok('History is a data-adv fold after Locate (Asset, Locate, History), in the device panel',
      el('historyGroup').tagName === 'DETAILS' && el('historyGroup').hasAttribute('data-adv') && el('nodeGeneralProps').contains(el('historyGroup'))
      && !!(el('assetGroup').compareDocumentPosition(el('locateGroup')) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !!(el('locateGroup').compareDocumentPosition(el('historyGroup')) & Node.DOCUMENT_POSITION_FOLLOWING)
      && el('historyGroup').previousElementSibling === el('locateSentence'));
    ok('its summary says History', /^History/.test(el('historyGroup').querySelector('summary').textContent.trim()));
    T.renderHistoryFields(null);
    // Closed by default: restoreHistoryGroup with no key (tests/suites/trailedge.js).
    T.restoreHistoryGroup();
    ok('closed by default (no key kept)', el('historyGroup').open === false);
    el('historyGroup').open = true; el('historyGroup').dispatchEvent(new Event('toggle'));
    ok('opening it is remembered in this browser', localStorage.getItem(T.HISTORY_OPEN_KEY) === '1');
    el('historyGroup').open = false; el('historyGroup').dispatchEvent(new Event('toggle'));
    ok('and closing it', localStorage.getItem(T.HISTORY_OPEN_KEY) === '0');
    localStorage.setItem(T.HISTORY_OPEN_KEY, '1');
    el('historyGroup').open = false; T.restoreHistoryGroup();
    ok('and read back at boot', el('historyGroup').open === true);
    ok('the key is distinct from the Asset and Locate ones', T.HISTORY_OPEN_KEY !== ASSET_OPEN_KEY && T.HISTORY_OPEN_KEY !== LOCATE_OPEN_KEY);
    el('historyGroup').open = true;

    // ---- 2. The empty states ----
    select('pc', 'node');
    const travelNote = () => (body().querySelector('.hist-note') || {}).textContent || '';
    ok('a network not kept: history is kept only for kept networks', /History is kept only for networks kept in this browser\./.test(body().textContent), body().textContent);
    ok('and it says it lives in this browser only, not in files, links or binders',
      travelNote() === 'Recorded at back-ups and reports, and kept in this browser only: it does not travel with files, links or binders.', travelNote());
    ok('no count, no Forget', sum() === '' && !body().querySelector('[data-hist-forget]'));

    const id = L.claimDocument('Clínica', null);
    select('pc', 'node');
    ok('a kept network with nothing recorded: the plain text',
      body().querySelector('.hist-empty').textContent === "Nothing recorded yet: Topo notes this device's addresses, MAC, switch port and group each time the network is backed up or reported.",
      body().textContent);
    ok('with the browser-only note', /kept in this browser only: it does not travel with files, links or binders/.test(travelNote()));

    ok('a point recorded', record(id, 'backup', D1));
    select('pc', 'node');
    ok('a device whose values are all held now: no changes since its first', body().querySelector('.hist-empty').textContent === 'No changes recorded since 2026-03-02.', body().textContent);
    ok('no blocks, no count', !body().querySelector('.hist-block') && sum() === '');
    ok('Forget is offered once something is recorded', !!body().querySelector('[data-hist-forget]'));

    const roHeld = state.readOnly;
    state.readOnly = { doc: serializeDoc() };
    select('pc', 'node');
    ok('a read-only network shows the kept-only line', /History is kept only for networks kept in this browser\./.test(body().textContent) && !body().querySelector('.hist-block'));
    state.readOnly = roHeld;

    // ---- 3. The blocks ----
    // Between points: the PC gets a new address and is replugged, moved to Rack 4
    // and renamed; the camera takes the PC's old address; the switch is renamed.
    const docBefore = () => JSON.stringify(serializeDoc());
    const pc = getNode('pc');
    pc.interfaces[0].ip = '192.168.1.30/24';
    pc.interfaces[0].mac = 'aa:bb:cc:00:11:99';
    pc.group = 'r4'; pc.name = 'PC-1B';
    state.links.find((l) => l.id === 'a').sourceIface = 'p7';
    getNode('cam').interfaces[0].ip = '192.168.1.20/24';
    getNode('sw').name = 'SW-02';
    save();
    ok('a second point, a report', record(id, 'report', D2));
    // The present moves again (not recorded yet): the address now is the typed one.
    select('pc', 'node');
    const ip = block('ip', 'i1');
    ok('an address block per NIC, labelled by the NIC', !!ip && ip.querySelector('.hist-label').textContent === 'IP / CIDR (eth0)', body().innerHTML);
    ok('the value now on top, since it was first recorded', lines(ip)[0] === '192.168.1.30/24 since 2026-09-14', JSON.stringify(lines(ip)));
    ok('then the past one with its date and how it was recorded', lines(ip)[1] === '192.168.1.20/24 2026-03-02 back-up', JSON.stringify(lines(ip)));
    ok('the MAC per NIC, read in colons', lines(block('mac', 'i1')).join('|') === 'AA:BB:CC:00:11:99 since 2026-09-14|AA:BB:CC:00:11:22 2026-03-02 back-up'
      && block('mac', 'i1').querySelector('.hist-label').textContent === 'MAC (eth0)', JSON.stringify(lines(block('mac', 'i1'))));
    ok('the replug as Switch port, by the switch’s name at the time', lines(block('port'))[1] === 'SW · Gi1/0/12 2026-03-02 back-up'
      && block('port').querySelector('.hist-label').textContent === 'Switch port', JSON.stringify(lines(block('port'))));
    ok('and the port now by its name today', lines(block('port'))[0] === 'SW-02 · Gi1/0/7 since 2026-09-14', JSON.stringify(lines(block('port'))));
    ok('the group by its path', lines(block('group')).join('|') === 'Building A / Rack 4 since 2026-09-14|Building A / Rack 3 2026-03-02 back-up', JSON.stringify(lines(block('group'))));
    ok('the name', lines(block('name')).join('|') === 'PC-1B since 2026-09-14|PC-1 2026-03-02 back-up', JSON.stringify(lines(block('name'))));
    ok('a blank NIC has no block', !block('ip', 'i2') && !block('mac', 'i2'));
    ok('the summary counts the past values', sum() === '5 past values', sum());
    ok('the kind is a muted word', !!body().querySelector('.hist-line .hist-kind') && body().querySelector('.hist-line .hist-kind').textContent === 'back-up');
    // The camera: renamed switch is no port change.
    select('cam', 'node');
    ok('a switch renamed is no port change', !block('port'), body().innerHTML);
    // A third point extends; then an unrecorded edit reads as now.
    ok('a third point', record(id, 'backup', D3));
    select('pc', 'node');
    ok('the past keeps its dates, the present its first', lines(block('ip', 'i1')).join('|') === '192.168.1.30/24 since 2026-09-14|192.168.1.20/24 2026-03-02 back-up');
    getNode('pc').interfaces[0].ip = '192.168.1.31/24'; save();
    select('pc', 'node');
    ok('a value typed since the last point reads as now, the recorded ones below', lines(block('ip', 'i1')).join('|')
      === '192.168.1.31/24 now|192.168.1.30/24 2026-09-14 → 2026-10-01 back-up|192.168.1.20/24 2026-03-02 back-up', JSON.stringify(lines(block('ip', 'i1'))));
    ok('the range reads from → to with the kind of its last point', /2026-09-14 → 2026-10-01/.test(body().textContent));
    // A NIC removed: its past stays, labelled as removed.
    getNode('pc').interfaces[0].ip = '192.168.1.30/24';
    getNode('pc').interfaces.push({ id: 'i3', name: 'eth1', ip: '10.9.9.9/24' }); save();
    record(id, 'backup', D3 + 1000);
    getNode('pc').interfaces = getNode('pc').interfaces.filter((i) => i.id !== 'i3'); save();
    select('pc', 'node');
    const rem = block('ip', 'i3');
    ok('a removed NIC keeps its past, labelled as removed', !!rem && rem.querySelector('.hist-label').textContent === 'IP / CIDR (removed interface)'
      && lines(rem)[0] === '— now' && /^10\.9\.9\.9\/24/.test(lines(rem)[1]), JSON.stringify(lines(rem)));
    // One past value: the singular.
    select('prn', 'node');
    getNode('prn').interfaces[0].ip = '192.168.1.91/24'; save();
    record(id, 'backup', D3 + 2000);
    select('prn', 'node');
    ok('one past value: the singular', sum() === '1 past value', sum());
    // Nothing drawn is an edit.
    const docNow = docBefore(), undoNow = steps();
    select('pc', 'node'); el('historyGroup').open = false; el('historyGroup').dispatchEvent(new Event('toggle'));
    el('historyGroup').open = true; el('historyGroup').dispatchEvent(new Event('toggle'));
    ok('drawing it changes no document and adds no undo step', docBefore() === docNow && steps() === undoNow);

    // ---- 4. Address reuse ----
    select('cam', 'node');
    const reuse = [...body().querySelectorAll('.hist-block[data-f="ip"] .hist-reuse')].map((r) => r.textContent);
    ok('the camera holds now the PC’s old address: whose it was and until when', reuse.join('|') === "Was PC-1B's until 2026-03-02", JSON.stringify(reuse));
    select('pc', 'node');
    ok('the PC, whose address nobody held before, has no hint', !body().querySelector('.hist-reuse'));
    // Both holding it now: a duplicate, not a reuse.
    getNode('pc').interfaces[0].ip = '192.168.1.20/24'; save();
    select('cam', 'node');
    ok('not when the other device holds it now too', !body().querySelector('.hist-reuse'), body().textContent);
    getNode('pc').interfaces[0].ip = '192.168.1.30/24'; save();
    // The other device removed: no hint (it is not on the map).
    const pcHeld = cloneData(getNode('pc'));
    state.nodes = state.nodes.filter((n) => n.id !== 'pc'); save();
    select('cam', 'node');
    ok('not for a device no longer on the map', !body().querySelector('.hist-reuse'));
    state.nodes.push(pcHeld); save();
    ok('the hint is no finding', !JSON.stringify(typeof diagnose === 'function' ? diagnose() : []).includes("Was PC-1B"));

    // ---- 5. Forget this device's history ----
    select('pc', 'node');
    const docF = docBefore(), undoF = steps();
    answer = false; asked.length = 0;
    body().querySelector('[data-hist-forget]').click();
    await tick(); await tick();
    ok('Forget asks first, naming the device', asked.length === 1 && asked[0].kind === 'confirm' && /PC-1B/.test(asked[0].message) && asked[0].danger === true, JSON.stringify(asked[0]));
    ok('Cancel keeps it', !!T.deviceTrail(id, 'pc'));
    answer = true;
    body().querySelector('[data-hist-forget]').click();
    await tick(); await tick();
    ok('yes forgets that device only', T.deviceTrail(id, 'pc') === null && !!T.deviceTrail(id, 'cam') && T.trailOf(id).points.length > 0);
    ok('the section is drawn again, with nothing recorded', /Nothing recorded yet/.test(body().textContent) && sum() === '', body().textContent);
    ok('no edit and no undo step', docBefore() === docF && steps() === undoF);
    ok('forgetting nothing says so', T.forgetDevice(id, 'pc') === false && T.forgetDevice('no-such', 'pc') === false);

    // ---- 6. The landing card's Clear history ----
    const other = L.librarySave('Bodega', null, { doc: site() });
    const toolOf = (cardId) => [...landingCard(L.libraryEntry(cardId)).querySelectorAll('.landing-tool')].find((b) => b.title === 'Clear history');
    ok('no Clear history on a card with no trail', !toolOf(other));
    const clear = toolOf(id);
    ok('Clear history on a card with one', !!clear && /Clínica/.test(clear.getAttribute('aria-label')));
    T.recordPoint(other, 'backup', site(), D1);
    answer = false; asked.length = 0;
    clear.click(); await tick(); await tick();
    ok('it asks first, naming the card', asked.length === 1 && asked[0].kind === 'confirm' && /Clínica/.test(asked[0].message) && asked[0].ok === 'Clear history');
    ok('Cancel keeps it', T.hasTrail(id));
    answer = true;
    toolOf(id).click(); await tick(); await tick();
    ok('yes clears that card’s trail', !T.hasTrail(id) && T.trailOf(id) === null);
    ok('and no other card’s', T.hasTrail(other));
    ok('the card itself is kept', !!L.libraryEntry(id) && !!L.libraryEntry(id).doc);
    ok('the open network’s section reads empty again', /Nothing recorded yet/.test(body().textContent));
    L.libraryDelete(other);

    // ---- 7. Views, selection, refresh, phone ----
    record(id, 'backup', D3 + 5000);
    getNode('pc').name = 'PC-1C'; save();
    select('pc', 'node');
    ok('a point recorded while it shows is drawn at once', (() => { record(id, 'backup', D3 + 6000); return lines(block('name'))[0] === 'PC-1C since ' + localDateOf(D3 + 6000); })(), JSON.stringify(lines(block('name'))));
    selectEntries([{ type: 'node', id: 'pc' }, { type: 'node', id: 'cam' }]);
    ok('a multi-selection hides the panel it is in', gone('historyGroup'));
    select('pc', 'node');
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    ok('Forget is a 44px target on a phone', narrow && parseFloat(getComputedStyle(body().querySelector('[data-hist-forget]')).minHeight) >= 44, String(window.innerWidth));
    ok('nothing in it scrolls sideways', body().scrollWidth <= body().clientWidth + 1, `${body().scrollWidth} ${body().clientWidth}`);
    const heldProfile = { profile: state.settings.profile, advanced: state.settings.advanced };
    const reduce = (profile) => { state.settings.profile = profile; state.settings.advanced = false; applyProfile(); };
    reduce('simple');
    select('pc', 'node');
    ok('#simple: the section is gone', gone('historyGroup') && body().innerHTML === '');
    reduce('imagenology');
    select('pc', 'node');
    ok('#imagenology: gone too', gone('historyGroup'));
    state.settings.profile = heldProfile.profile; state.settings.advanced = true; applyProfile();
    select('pc', 'node');
    ok('back in Full it is drawn again', !gone('historyGroup') && !!block('name'));

    // ---- 8. The words ----
    const keys = ['History', '{n} past value', '{n} past values', 'back-up', 'report', 'file', 'now', 'removed interface', 'since {date}',
      "Was {name}'s until {date}", "Nothing recorded yet: Topo notes this device's addresses, MAC, switch port and group each time the network is backed up or reported.",
      'No changes recorded since {date}.', 'Recorded at back-ups and reports, and kept in this browser only: it does not travel with files, links or binders.',
      'History is kept only for networks kept in this browser.', "Forget this device's history",
      'Forget the history recorded for {name} in this browser? The device itself is not changed. This cannot be undone.', 'Forget', 'Clear history',
      'Clear the address history kept for "{name}" in this browser? The network itself is not changed. This cannot be undone.'];
    const { MESSAGES } = window.CarinoI18N;
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = keys.filter((k) => !MESSAGES[loc][k] || MESSAGES[loc][k] === k && !/^\{/.test(k));
      ok(`${loc} carries every History string`, miss.length === 0, miss.join(' | '));
    });
    ok('Japanese never says コンピューター in them', !keys.some((k) => /コンピューター/.test(MESSAGES.ja[k] || '')));
    ok('Russian counts read with any numeral (no declension)', MESSAGES.ru['{n} past value'] === 'Прошлых значений: {n}' && MESSAGES.ru['{n} past values'] === 'Прошлых значений: {n}');
    setLocale('es'); applyStaticI18n();
    select('pc', 'node');
    ok('in Spanish: the summary, the note and the kind', /Historial/.test(el('historyGroup').querySelector('summary').textContent)
      && /no viaja con archivos, enlaces ni binders/.test(travelNote()) && /desde/.test(body().textContent), body().textContent);
    setLocale('en'); applyStaticI18n();

    // ---- 9. The Settings toggle ----
    const LABEL = 'Keep address history at back-ups and reports';
    const HINT = "Each back-up and report notes every device's addresses, MAC, switch port and group, in this browser only. Off stops recording and keeps what is already there; Clear history on a network's card removes it.";
    const box = () => el('setTrailRecording');
    const savedSetting = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').trailRecording; } catch (e) { return 'unreadable'; } };
    const flip = (on) => { box().checked = on; box().dispatchEvent(new Event('change', { bubbles: true })); };
    const sec = box() && box().closest('.set-sec');
    ok('Settings has a History section after Reports, not data-adv (every view), with the toggle',
      !!sec && el('settingsDialog').contains(sec) && !sec.hasAttribute('data-adv') && sec.querySelector('.set-head').textContent === 'History'
      && sec.previousElementSibling === el('setReportHead').closest('.set-sec'));
    ok('its words: the label and the hint', !!sec && sec.querySelector('.set-row > span > span').textContent === LABEL
      && sec.querySelector('.dlg-dim').textContent === HINT, sec && sec.textContent);
    delete state.settings.trailRecording;
    openSettings();
    ok('on by default: the box is ticked when nothing is kept', box().checked === true && T.trailRecordingOn());
    replaceDocument(site(), { origin: 'file' });
    const sid = L.claimDocument('Ajustes', null);
    record(sid, 'backup', D1);
    getNode('pc').interfaces[0].ip = '192.168.1.21/24'; save();
    record(sid, 'backup', D2);
    const pointsBefore = T.trailOf(sid).points.length;
    flip(false);
    ok('unticking turns recording off', state.settings.trailRecording === false && !T.trailRecordingOn());
    ok('and is kept through the settings save', savedSetting() === false, String(localStorage.getItem(SETTINGS_KEY)));
    getNode('pc').interfaces[0].ip = '192.168.1.22/24'; save();
    ok('off: a back-up records nothing', record(sid, 'backup', D3) === false && T.trailOf(sid).points.length === pointsBefore);
    ok('off: a report records nothing either', (takeSnapshot(sid, 'report', serializeDoc()), true) && T.trailOf(sid).points.length === pointsBefore);
    {
      // The real Back up path (exportJsonFile -> takeSnapshot), the file stubbed.
      const realDl = window.downloadJson; let files = 0;
      window.downloadJson = () => { files++; };
      try { exportJsonFile(); } finally { window.downloadJson = realDl; }
      ok('off: Back up this network still downloads and records nothing', files === 1 && T.trailOf(sid).points.length === pointsBefore, files + ' ' + T.trailOf(sid).points.length);
    }
    select('pc', 'node');
    ok('off keeps what is there: the History section still shows the past address',
      pointsBefore === 2 && lines(block('ip', 'i1')).some((x) => /^192\.168\.1\.20/.test(x)), JSON.stringify(lines(block('ip', 'i1'))));
    const ON_NOTE = 'Recorded at back-ups and reports, and kept in this browser only: it does not travel with files, links or binders.';
    const OFF_NOTE = 'Address history is turned off in Settings: back-ups and reports record nothing new. What is here is kept in this browser only: it does not travel with files, links or binders.';
    const OFF_EMPTY = 'Nothing recorded: address history is turned off in Settings.';
    const noteNow = () => (body().querySelector('.hist-note') || {}).textContent || '';
    const emptyNow = () => (body().querySelector('.hist-empty') || {}).textContent || '';
    ok('off: the note says recording is turned off in Settings', noteNow() === OFF_NOTE, noteNow());
    flip(true);
    ok('ticking it redraws the open History section with the recording note', noteNow() === ON_NOTE, noteNow());
    flip(false);
    ok('and unticking draws the off note again', noteNow() === OFF_NOTE, noteNow());
    {
      const n = _undoStack.length;
      flip(true); flip(false);
      ok('turning it off and on is no edit and no undo step', n >= 1 && _undoStack.length === n, n + ' -> ' + _undoStack.length);
    }
    {
      // A kept network with nothing recorded, while off: no promise of a recording.
      const sidBare = L.claimDocument('Sin historial', null);
      select('pc', 'node');
      ok('off, nothing recorded: the empty line says it is turned off, not "Topo notes"',
        emptyNow() === OFF_EMPTY && !/Topo notes/.test(body().textContent), emptyNow());
      L.libraryDelete(sidBare);
    }
    {
      // Another tab turns it on, then off: this tab follows the stored value.
      const heldStore = localStorage.getItem(SETTINGS_KEY);
      const fromOtherTab = (obj) => {
        const v = JSON.stringify(obj);
        localStorage.setItem(SETTINGS_KEY, v);
        window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY, newValue: v }));
      };
      const base = JSON.parse(heldStore || '{}'); delete base.trailRecording;
      fromOtherTab(base);
      ok('another tab turning it on: this tab records again and the box ticks', T.trailRecordingOn() && box().checked === true);
      fromOtherTab(Object.assign({}, base, { trailRecording: false }));
      ok('another tab turning it off: this tab stops recording and the box unticks', !T.trailRecordingOn() && box().checked === false);
      saveSettings();
      ok('and this tab\'s next settings save keeps it off', savedSetting() === false, String(localStorage.getItem(SETTINGS_KEY)));
      if (heldStore === null) localStorage.removeItem(SETTINGS_KEY); else localStorage.setItem(SETTINGS_KEY, heldStore);
    }
    delete state.settings.trailRecording;
    loadSettings();
    ok('read back at start: off stays off', state.settings.trailRecording === false && !T.trailRecordingOn());
    {
      const heldStore = localStorage.getItem(SETTINGS_KEY);
      const b = JSON.parse(heldStore || '{}'); delete b.trailRecording;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(b));
      loadSettings();
      ok('read back with no stored key: on (what is stored decides)', !('trailRecording' in state.settings) && T.trailRecordingOn());
      localStorage.setItem(SETTINGS_KEY, heldStore);
      loadSettings();
    }
    renderSettings();
    ok('and the box shows it unticked', box().checked === false);
    flip(true);
    ok('ticking it again turns recording on and drops the kept key', !('trailRecording' in state.settings) && T.trailRecordingOn() && savedSetting() === undefined);
    ok('on again: the next back-up records', record(sid, 'backup', D3 + 1000) !== false && T.trailOf(sid).points.length === pointsBefore + 1);
    closeSettings();
    L.libraryDelete(sid);
    const heldP2 = { profile: state.settings.profile, advanced: state.settings.advanced };
    state.settings.profile = 'simple'; state.settings.advanced = false; applyProfile();
    openSettings();
    ok('#simple: the History settings show too (the owner, 2026-11-05)', getComputedStyle(sec).display !== 'none' && box().offsetParent !== null);
    closeSettings();
    state.settings.profile = heldP2.profile; state.settings.advanced = heldP2.advanced; applyProfile();
    openSettings();
    ok('back in Full they show', getComputedStyle(sec).display !== 'none' && box().offsetParent !== null);
    closeSettings();
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = [LABEL, HINT, OFF_NOTE, OFF_EMPTY].filter((k) => !MESSAGES[loc][k] || MESSAGES[loc][k] === k);
      ok(loc + ` carries the Settings toggle's words`, miss.length === 0, miss.join(' | '));
    });
    ok('Japanese never says コンピューター in them', ![LABEL, HINT, OFF_NOTE, OFF_EMPTY].some((k) => /コンピューター/.test(MESSAGES.ja[k])));
    setLocale('es'); applyStaticI18n();
    ok('in Spanish: the toggle reads in Spanish', sec.querySelector('.set-row > span > span').textContent === MESSAGES.es[LABEL]
      && sec.querySelector('.set-head').textContent === 'Historial');
    setLocale('en'); applyStaticI18n();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    if (heldTrailSetting === undefined) delete state.settings.trailRecording; else state.settings.trailRecording = heldTrailSetting;
    setDialogResponder(heldResponder);
    persistLibrary(heldLib);
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
