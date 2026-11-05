// Address history in the Simple views (the owner, 2026-11-05: "Add optional
// history on simple view"; docs/BACKLOG.md feature 5, Decisions taken).
// js/trail.js historySimpleLines / historySimpleHtml / renderHistorySimple,
// #historySimple in the device panel, Settings' #setTrailSimple. What is held:
//   1. the slot: #historySimple, not data-adv, in the device panel after the
//      Locate sentence (and the Full-only History fold), empty and hidden;
//   2. off by default: nothing drawn in #simple even with a past recorded,
//      the panel's text the same as before, the settings save carrying no
//      trailSimple key; the report the same either way (part 5);
//   3. Settings: the History section in every view, the second box after
//      the recording one, unticked by default, on kept as trailSimple:true
//      through saveSettings/loadSettings and dropped again when off, no undo
//      step, another tab's change followed;
//   4. on, in #simple: plain sentences newest first ("Was 192.168.1.20 until
//      2026-03-02.", plugged into, in, called), no MAC, no buttons, no
//      Forget, no kind words, no edit and no undo step; capped at four with
//      a pointer to the Full editor; the empty states (not kept or read
//      only, nothing earlier, recording off with nothing); nothing with
//      nothing selected; a point recorded while it shows drawn at once;
//   5. #imagenology too; never in Full (the fold is there instead);
//   6. a long value wrapping with no horizontal scroll;
//   7. the words in es, pt-BR, ja (no コンピューター) and ru, and in Spanish;
//   8. the review cases: a past Wi-Fi link (no port, or a radio port) reads
//      'Was on Wi-Fi through {ap}', never "plugged into"; an address the
//      device still holds on another NIC (a replacement NIC, a bond, two
//      NICs swapped) is no past address, and one held on two NICs is one
//      line; a port label or a switch name holding ' · ' splits right.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const T = window.CarinoTrail;
  const L = window.CarinoLibrary;
  const { LIBRARY_KEY, BINDER_EXPORT_KEY } = L;
  const held = [LIBRARY_KEY, BINDER_EXPORT_KEY, T.HISTORY_OPEN_KEY, SETTINGS_KEY].map((k) => [k, localStorage.getItem(k)]);
  const heldLib = L.loadLibrary();
  const heldSettings = { trailRecording: state.settings.trailRecording, trailSimple: state.settings.trailSimple,
    profile: state.settings.profile, advanced: state.settings.advanced };
  const box = () => el('setTrailSimple');
  const pane = () => el('historySimple');
  const shown = () => getComputedStyle(pane()).display !== 'none' && pane().offsetParent !== null;
  const lines = () => [...pane().querySelectorAll('p')].map((p) => p.textContent);
  const savedSimple = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').trailSimple; } catch (e) { return 'unreadable'; } };
  const flip = (on) => { box().checked = on; box().dispatchEvent(new Event('change', { bubbles: true })); };
  const reduce = (profile) => { state.settings.profile = profile; state.settings.advanced = false; applyProfile(); };
  const full = () => { state.settings.advanced = true; applyProfile(); };
  const day = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  const D1 = day(2026, 3, 2), D2 = day(2026, 9, 14), D3 = day(2026, 10, 1);
  const site = () => ({
    v: DOC_VERSION,
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 }, interfaces: [] },
      { id: 'pc', type: 'pc', name: 'PC-1', x: 100, y: 200, group: 'r3',
        interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24', mac: 'aa-bb-cc-00-11-22' }] },
      { id: 'prn', type: 'printer', name: 'Printer', x: 300, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.90/24' }] }
    ],
    links: [
      { id: 'up', source: 'rt', target: 'sw', sourceIface: 'e0', targetIface: 'p24' },
      { id: 'a', source: 'sw', target: 'pc', sourceIface: 'p12', targetIface: 'i1' }
    ],
    groups: [{ id: 'b1', name: 'Building A', kind: 'building' }, { id: 'r3', name: 'Rack 3', kind: 'rack', parent: 'b1' },
      { id: 'r4', name: 'Rack 4', kind: 'rack', parent: 'b1' }],
    networks: [{ id: 'lan', cidr: '192.168.1.0/24', name: 'LAN' }]
  });
  const record = (id, kind, at) => T.recordPoint(id, kind, serializeDoc(), at);
  // Between D1 and D3: a new address and MAC, replugged to port 13, moved to
  // Rack 4 and renamed.
  const moveOn = () => {
    const pc = getNode('pc');
    pc.interfaces[0].ip = '192.168.1.30/24';
    pc.interfaces[0].mac = 'aa:bb:cc:00:11:99';
    pc.group = 'r4'; pc.name = 'PC-1B';
    getLink('a').sourceIface = 'p13';
    save();
  };

  try {
    setLocale('en');
    persistLibrary({});
    state.readOnly = null;
    delete state.settings.trailRecording;
    delete state.settings.trailSimple;
    window.captureReportDiagram = async () => null;

    // ---- 1. The slot ----
    replaceDocument(site(), { origin: 'file' });
    setView('map');
    ok('#historySimple is in the device panel, not data-adv, after the Locate sentence and the History fold',
      !!pane() && el('nodeGeneralProps').contains(pane()) && !pane().hasAttribute('data-adv')
      && pane().previousElementSibling === el('historyGroup') && el('historyGroup').previousElementSibling === el('locateSentence'));

    // ---- 2. Off by default ----
    {
      // Every simple sample in #simple, kept, with each device renamed between
      // two points: off, the element stays empty for every device; on (only
      // to show the check has teeth), the same devices draw their lines.
      // The whole device panel (less the Full-only History fold, hidden
      // here) and its fields' values, per device, before any card or trail
      // exists, against the same after a past is recorded with it off.
      const panelSnap = () => {
        const c = el('nodeGeneralProps').cloneNode(true);
        const fold = c.querySelector('#historyGroup');
        if (fold) fold.remove();
        return c.innerHTML + '|' + [...el('nodeGeneralProps').querySelectorAll('input, select, textarea')].map((x) => x.value).join('|');
      };
      const drawn = [], onDrawn = [], changed = [];
      Object.keys(SIMPLE_SAMPLES).forEach((key) => {
        replaceDocument(JSON.parse(JSON.stringify(templatesData[key + SIMPLE_SUFFIX])), { origin: 'file' });
        reduce('simple');
        const before = new Map();
        state.nodes.forEach((n) => { select(n.id, 'node'); before.set(n.id, panelSnap()); });
        select(null);
        const names = new Map(state.nodes.map((n) => [n.id, n.name]));
        const sid = L.claimDocument('Sample ' + key, null);
        record(sid, 'backup', D1);
        state.nodes.forEach((n) => { n.name = String(n.name || n.id) + ' (new)'; });
        save();
        record(sid, 'backup', D2);
        // The names back as they were: the panel should read as before, with
        // a past ('... (new)') now recorded for every device.
        state.nodes.forEach((n) => { n.name = names.get(n.id); });
        save();
        state.nodes.forEach((n) => { select(n.id, 'node'); if (pane().innerHTML !== '' || shown()) drawn.push(key + ':' + n.id);
          if (panelSnap() !== before.get(n.id)) changed.push(key + ':' + n.id); });
        state.settings.trailSimple = true;
        state.nodes.forEach((n) => { select(n.id, 'node'); if (/^Was called /.test(lines()[0] || '')) onDrawn.push(n.id); });
        delete state.settings.trailSimple;
        L.libraryDelete(sid);
      });
      ok("off: every simple sample's devices draw nothing, with a past recorded", drawn.length === 0 && Object.keys(SIMPLE_SAMPLES).length >= 18, drawn.join(' '));
      ok("off: every simple sample's device panel is the same as with no history at all", changed.length === 0, changed.slice(0, 8).join(' '));
      ok('(on, the same devices do draw it)', onDrawn.length > 50, String(onDrawn.length));
      replaceDocument(site(), { origin: 'file' });
      full();
    }
    const id = L.claimDocument('Clínica', null);
    ok('a point recorded at D1', record(id, 'backup', D1));
    moveOn();
    ok('a point recorded at D3', record(id, 'backup', D3));
    reduce('simple');
    select('pc', 'node');
    ok('off by default: the setting reads off', T.trailSimpleOn() === false && !('trailSimple' in state.settings));
    ok('off: #simple draws nothing, even with a past recorded', pane().innerHTML === '' && !shown());
    ok('off: the panel says nothing of history', !/Was 192\.168\.1\.20|Was plugged into|Was called/.test(el('nodeGeneralProps').textContent));
    saveSettings();
    ok('off: the settings save carries no trailSimple key', savedSimple() === undefined, String(localStorage.getItem(SETTINGS_KEY)));

    // ---- 3. Settings ----
    openSettings();
    const sec = box() && box().closest('.set-sec');
    ok('the box sits in the History section after the recording one',
      !!sec && sec === el('setTrailRecording').closest('.set-sec')
      && !!(el('setTrailRecording').compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING));
    ok('#simple: the History section and both boxes show', getComputedStyle(sec).display !== 'none' && box().offsetParent !== null && el('setTrailRecording').offsetParent !== null);
    ok('its label and hint', box().closest('.set-row').querySelector('span > span').textContent === 'Show address history in Simple view'
      && box().closest('.set-row').querySelector('.dlg-dim').textContent === 'A few plain lines under the selected device: the addresses, names and sockets it had at earlier back-ups and reports. Read only. Off by default.');
    ok('unticked by default', box().checked === false);
    const undoBefore = _undoStack.length;
    const docBefore = JSON.stringify(serializeDoc());
    flip(true);
    ok('ticking it: kept as trailSimple true and saved', state.settings.trailSimple === true && savedSimple() === true);
    ok('and the open device panel draws the lines at once', shown() && lines().length > 0, JSON.stringify(lines()));
    closeSettings();

    // ---- 4. On, in #simple ----
    const spans = T.deviceTrail(id, 'pc').spans;
    const grpTxt = (spans.find((s) => s.f === 'group' && s.val === 'r3') || {}).txt;
    const portTxt = (spans.find((s) => s.f === 'port' && s.last === D1) || {}).txt;
    ok('the trail holds the old group and port (fixture)', !!grpTxt && !!portTxt, JSON.stringify(spans));
    const want = ['Was 192.168.1.20 until 2026-03-02.', 'Was plugged into SW, socket Gi1/0/12 until 2026-03-02.',
      `Was in ${grpTxt} until 2026-03-02.`, 'Was called PC-1 until 2026-03-02.'];
    ok('plain sentences: the address without its prefix, the port, the place, the name', JSON.stringify(lines()) === JSON.stringify(want), JSON.stringify(lines()));
    ok('the port reads as the switch and its socket, as the Locate sentence words it', portTxt === 'SW · Gi1/0/12', portTxt);
    {
      // A port span whose text has no port part (the switch's name alone)
      // falls back to the neutral words. The live record, not trailOf's copy.
      const dev = _trails.get(id).devices.pc;
      const heldSpans = JSON.stringify(dev.spans);
      dev.spans.forEach((sp) => { if (sp.f === 'port' && sp.last === D1) sp.txt = 'SW'; });
      select('prn', 'node'); select('pc', 'node');
      ok('a port text with no port part: the neutral words', lines()[1] === 'Was connected to SW until 2026-03-02.', JSON.stringify(lines()));
      dev.spans = JSON.parse(heldSpans);
      select('prn', 'node'); select('pc', 'node');
    }
    ok('no MAC, no buttons, no Forget, no kind words', !/aa[:-]bb|MAC/i.test(pane().textContent) && !pane().querySelector('button, a, input')
      && !/back-up|report|file/.test(pane().textContent));
    ok('drawing it is no edit and no undo step', JSON.stringify(serializeDoc()) === docBefore && _undoStack.length === undoBefore, undoBefore + ' -> ' + _undoStack.length);
    flip(false);
    ok('unticking: the key goes, the lines go', !('trailSimple' in state.settings) && savedSimple() === undefined && pane().innerHTML === '' && !shown());
    ok('turning it on and off is no undo step', _undoStack.length === undoBefore);
    flip(true);
    loadSettings();
    ok('read back at start: on stays on', state.settings.trailSimple === true);
    {
      const heldStore = localStorage.getItem(SETTINGS_KEY);
      const b = JSON.parse(heldStore || '{}'); delete b.trailSimple;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(b));
      loadSettings();
      ok('read back with no stored key: off', !('trailSimple' in state.settings));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign({}, b, { trailSimple: 'yes' })));
      loadSettings();
      ok('anything but true reads as off', !('trailSimple' in state.settings));
      localStorage.setItem(SETTINGS_KEY, heldStore);
      loadSettings();
      reduce('simple');
    }
    {
      // Another tab ticks it, then unticks it.
      const heldStore = localStorage.getItem(SETTINGS_KEY);
      const fromOtherTab = (obj) => {
        const v = JSON.stringify(obj);
        localStorage.setItem(SETTINGS_KEY, v);
        window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY, newValue: v }));
      };
      const base = JSON.parse(heldStore || '{}'); delete base.trailSimple;
      select('pc', 'node');
      fromOtherTab(base);
      ok('another tab turning it off: this tab follows, the box unticks and the lines go', !T.trailSimpleOn() && box().checked === false && pane().innerHTML === '');
      fromOtherTab(Object.assign({}, base, { trailSimple: true }));
      ok('and on again: drawn again', T.trailSimpleOn() && box().checked === true && lines().length === 4);
      localStorage.setItem(SETTINGS_KEY, heldStore);
    }
    select('pc', 'node');
    ok('the reduced view: the Full History fold stays hidden', getComputedStyle(el('historyGroup')).display === 'none');

    // A point recorded while it shows is drawn at once.
    getNode('pc').interfaces[0].ip = '192.168.1.40/24'; save();
    record(id, 'backup', day(2026, 10, 20));
    ok('a point recorded while it shows: drawn at once', lines()[0] === 'Was 192.168.1.30 until 2026-10-01.', JSON.stringify(lines()));
    ok('capped at four, with the pointer to the Full editor', lines().length === 5 && pane().querySelectorAll('p:not(.hist-simple-more)').length === T.HISTORY_SIMPLE_MAX
      && pane().querySelector('.hist-simple-more').textContent === 'Earlier changes are in the Full editor.', JSON.stringify(lines()));

    // The empty states.
    select('prn', 'node');
    ok('a device with nothing earlier: one plain line', JSON.stringify(lines()) === JSON.stringify(['No earlier addresses recorded.']), JSON.stringify(lines()));
    const roHeld = state.readOnly;
    state.readOnly = { doc: serializeDoc() };
    select('pc', 'node');
    ok('a read-only network: kept only for networks kept here', JSON.stringify(lines()) === JSON.stringify(['History is kept only for networks kept in this browser.']), JSON.stringify(lines()));
    state.readOnly = roHeld;
    {
      replaceDocument(site(), { origin: 'file' });
      reduce('simple');
      select('pc', 'node');
      ok('a network not kept: the same line', JSON.stringify(lines()) === JSON.stringify(['History is kept only for networks kept in this browser.']), JSON.stringify(lines()));
      const bare = L.claimDocument('Sin historial', null);
      state.settings.trailRecording = false;
      select('pc', 'node');
      ok('recording off and nothing recorded: says it is turned off', JSON.stringify(lines()) === JSON.stringify(['Nothing recorded: address history is turned off in Settings.']), JSON.stringify(lines()));
      delete state.settings.trailRecording;
      select('pc', 'node');
      ok('recording on and nothing recorded yet: nothing earlier', JSON.stringify(lines()) === JSON.stringify(['No earlier addresses recorded.']), JSON.stringify(lines()));
      L.libraryDelete(bare);
    }
    select(null);
    ok('nothing selected: empty', pane().innerHTML === '');

    // ---- 5. #imagenology, and never in Full ----
    replaceDocument(site(), { origin: 'file' });
    const id2 = L.claimDocument('Imagen', null);
    record(id2, 'backup', D1);
    moveOn();
    record(id2, 'backup', D3);
    reduce('imagenology');
    select('pc', 'node');
    ok('#imagenology shows the lines too', shown() && lines()[0] === 'Was 192.168.1.20 until 2026-03-02.', JSON.stringify(lines()));
    full();
    select('pc', 'node');
    ok('Full: never drawn, the History fold instead', pane().innerHTML === '' && !shown() && getComputedStyle(el('historyGroup')).display !== 'none');
    {
      // On, with a past recorded: the report carries none of these lines.
      const repOn = (await buildSiteReport(null, { summary: true, technical: true })).html;
      ok('the report (summary and technical) carries none of the Simple lines with it on and a past recorded',
        T.trailSimpleOn() && T.deviceTrail(id2, 'pc').spans.length > 4
        && !/Was called|Was plugged into|Was connected to|Was on Wi-Fi|Was in Building|Was 192\.168/.test(repOn));
    }

    // ---- 6. A long value wraps ----
    reduce('simple');
    getNode('pc').name = 'A-very-long-device-name-with-no-spaces-at-all-that-must-wrap-somewhere-PC-01';
    save();
    record(id2, 'backup', day(2026, 10, 20));
    getNode('pc').name = 'PC'; save();
    record(id2, 'backup', day(2026, 10, 25));
    select('pc', 'node');
    ok('a long old name is listed', lines().some((x) => /A-very-long/.test(x)), JSON.stringify(lines()));
    ok('and wraps with no horizontal scroll', pane().scrollWidth <= pane().clientWidth + 1
      && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, `${pane().scrollWidth} ${pane().clientWidth}`);

    // ---- 7. The words ----
    const KEYS = ['Show address history in Simple view',
      'A few plain lines under the selected device: the addresses, names and sockets it had at earlier back-ups and reports. Read only. Off by default.',
      'Was {value} until {date}.', 'Was connected to {value} until {date}.', 'Was plugged into {switch}, socket {port} until {date}.', 'Was on Wi-Fi through {ap} until {date}.', 'Was in {value} until {date}.', 'Was called {value} until {date}.',
      'No earlier addresses recorded.', 'Earlier changes are in the Full editor.'];
    const { MESSAGES } = window.CarinoI18N;
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = KEYS.filter((k) => !MESSAGES[loc][k] || MESSAGES[loc][k] === k);
      ok(`${loc} carries every Simple history string`, miss.length === 0, miss.join(' | '));
      const holes = KEYS.filter((k) => (k.match(/\{\w+\}/g) || []).some((ph) => !MESSAGES[loc][k].includes(ph)));
      ok(`${loc} keeps every placeholder`, holes.length === 0, holes.join(' | '));
    });
    ok('Japanese never says コンピューター in them', !KEYS.some((k) => /コンピューター/.test(MESSAGES.ja[k] || '')));
    setLocale('es'); applyStaticI18n();
    replaceDocument(site(), { origin: 'file' });
    const id3 = L.claimDocument('Español', null);
    record(id3, 'backup', D1);
    moveOn();
    record(id3, 'backup', D3);
    reduce('simple');
    select('pc', 'node');
    ok('in Spanish: the sentences read in Spanish', lines()[0] === 'Tenía 192.168.1.20 hasta 2026-03-02.' && lines().some((x) => /^Se llamaba PC-1 hasta/.test(x)), JSON.stringify(lines()));
    openSettings();
    ok('in Spanish: the box reads in Spanish', box().closest('.set-row').querySelector('span > span').textContent === MESSAGES.es['Show address history in Simple view']);
    closeSettings();
    setLocale('en'); applyStaticI18n();

    // ---- 8. The review cases ----
    state.settings.trailSimple = true;
    // One network, recorded at D1, changed by `change`, recorded at D3; the
    // device `sel` selected in #simple.
    const twoPoints = (doc, change, sel) => {
      full();
      replaceDocument(doc, { origin: 'file' });
      const cid = L.claimDocument('Review', null);
      record(cid, 'backup', D1);
      change();
      save();
      record(cid, 'backup', D3);
      reduce('simple');
      select(sel, 'node');
      return cid;
    };
    const base = (nodes, links) => ({ v: DOC_VERSION, nodes, links, groups: [], networks: [{ id: 'lan', cidr: '192.168.1.0/24', name: 'LAN' }] });
    {
      // A laptop on Wi-Fi through the Lobby AP, then the Office AP.
      const c = twoPoints(base([
        { id: 'ap1', type: 'ap', name: 'Lobby AP', x: 0, y: 0, interfaces: [] },
        { id: 'ap2', type: 'ap', name: 'Office AP', x: 200, y: 0, interfaces: [] },
        { id: 'lap', type: 'laptop', name: 'L', x: 100, y: 100, interfaces: [{ id: 'w', name: 'wlan0', ip: '192.168.1.70/24' }] }
      ], [{ id: 'r', source: 'ap1', target: 'lap', medium: 'wireless', targetIface: 'w' }]),
      () => { getLink('r').source = 'ap2'; }, 'lap');
      const sp = (T.deviceTrail(c, 'lap').spans.find((x) => x.f === 'port' && x.last === D1) || {});
      ok('(fixture) the past Wi-Fi link is a port span with no port', sp.val === 'ap1|' && sp.txt === 'Lobby AP', JSON.stringify(sp));
      ok('a past Wi-Fi link with no port: on Wi-Fi through the AP, not plugged in',
        JSON.stringify(lines()) === JSON.stringify(['Was on Wi-Fi through Lobby AP until 2026-03-02.']), JSON.stringify(lines()));
      L.libraryDelete(c);
    }
    {
      // A laptop on an AP's radio interface (a port id), then cabled to a switch.
      const c = twoPoints(base([
        { id: 'ap1', type: 'ap', name: 'Lobby AP', x: 0, y: 0, interfaces: [{ id: 'r0', name: 'radio0', wireless: true }] },
        { id: 'sw', type: 'switch', name: 'SW', x: 200, y: 0, portCount: 8, interfaces: [] },
        { id: 'lap', type: 'laptop', name: 'L', x: 100, y: 100, interfaces: [{ id: 'e', name: 'eth0', ip: '192.168.1.70/24' }] }
      ], [{ id: 'r', source: 'ap1', target: 'lap', sourceIface: 'r0', targetIface: 'e' }]),
      () => { const l = getLink('r'); l.source = 'sw'; l.sourceIface = 'p3'; }, 'lap');
      const sp = (T.deviceTrail(c, 'lap').spans.find((x) => x.f === 'port' && x.last === D1) || {});
      ok('(fixture) the past radio link holds its port', sp.val === 'ap1|r0' && sp.txt === 'Lobby AP · radio0', JSON.stringify(sp));
      ok('a past link on a radio port: on Wi-Fi through the AP',
        JSON.stringify(lines()) === JSON.stringify(['Was on Wi-Fi through Lobby AP until 2026-03-02.']), JSON.stringify(lines()));
      L.libraryDelete(c);
    }
    {
      // The address moved to a replacement NIC: no past address.
      const c = twoPoints(base([{ id: 'pc', type: 'pc', name: 'PC', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24' }] }], []),
        () => { getNode('pc').interfaces = [{ id: 'i9', name: 'eth1', ip: '192.168.1.20/24' }]; }, 'pc');
      ok('an address moved to a replacement NIC is no past address',
        JSON.stringify(lines()) === JSON.stringify(['No earlier addresses recorded.']), JSON.stringify(lines()));
      L.libraryDelete(c);
    }
    {
      // Onto a bond, eth0's own address cleared (and a different prefix).
      const c = twoPoints(base([{ id: 'pc', type: 'pc', name: 'PC', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24' }, { id: 'i2', name: 'eth1' }] }], []),
        () => { const n = getNode('pc'); n.interfaces[0].ip = ''; n.interfaces.push({ id: 'b0', name: 'bond0', ip: '192.168.1.20/16', members: ['i1', 'i2'] }); }, 'pc');
      ok('an address moved onto a bond is no past address',
        JSON.stringify(lines()) === JSON.stringify(['No earlier addresses recorded.']), JSON.stringify(lines()));
      L.libraryDelete(c);
    }
    {
      // Two NICs swapping their addresses: nothing past.
      const c = twoPoints(base([{ id: 'pc', type: 'pc', name: 'PC', x: 0, y: 0,
        interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24' }, { id: 'i2', name: 'eth1', ip: '192.168.1.21/24' }] }], []),
        () => { const n = getNode('pc'); n.interfaces[0].ip = '192.168.1.21/24'; n.interfaces[1].ip = '192.168.1.20/24'; }, 'pc');
      ok('two NICs swapping addresses: no past address', JSON.stringify(lines()) === JSON.stringify(['No earlier addresses recorded.']), JSON.stringify(lines()));
      L.libraryDelete(c);
    }
    {
      // One address on two NICs before, both changed since: one line.
      const c = twoPoints(base([{ id: 'pc', type: 'pc', name: 'PC', x: 0, y: 0,
        interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.50/24' }, { id: 'i2', name: 'eth1', ip: '192.168.1.50/24' }] }], []),
        () => { const n = getNode('pc'); n.interfaces[0].ip = '192.168.1.60/24'; n.interfaces[1].ip = '192.168.1.61/24'; }, 'pc');
      ok('one past address held on two NICs: one line', JSON.stringify(lines()) === JSON.stringify(['Was 192.168.1.50 until 2026-03-02.']), JSON.stringify(lines()));
      L.libraryDelete(c);
    }
    {
      // A port named with ' · ' in it, then a switch named with one.
      const c = twoPoints(base([
        { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8, interfaces: [{ id: 'p1', name: 'Gi1/0/1 · uplink' }] },
        { id: 'pc', type: 'pc', name: 'PC', x: 0, y: 100, interfaces: [{ id: 'e', name: 'eth0', ip: '192.168.1.20/24' }] }
      ], [{ id: 'a', source: 'sw', target: 'pc', sourceIface: 'p1', targetIface: 'e' }]),
      () => { getLink('a').sourceIface = 'p2'; }, 'pc');
      ok("a port label holding ' · ': split at the switch's name",
        JSON.stringify(lines()) === JSON.stringify(['Was plugged into SW, socket Gi1/0/1 · uplink until 2026-03-02.']), JSON.stringify(lines()));
      L.libraryDelete(c);
      const c2 = twoPoints(base([
        { id: 'sw', type: 'switch', name: 'Core · SW', x: 0, y: 0, portCount: 8, interfaces: [] },
        { id: 'pc', type: 'pc', name: 'PC', x: 0, y: 100, interfaces: [{ id: 'e', name: 'eth0', ip: '192.168.1.20/24' }] }
      ], [{ id: 'a', source: 'sw', target: 'pc', sourceIface: 'p1', targetIface: 'e' }]),
      () => { getLink('a').sourceIface = 'p2'; }, 'pc');
      ok("a switch name holding ' · ': split at the port's label",
        JSON.stringify(lines()) === JSON.stringify(['Was plugged into Core · SW, socket 1 until 2026-03-02.']), JSON.stringify(lines()));
      L.libraryDelete(c2);
    }
    void D2;
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    try { closeSettings(); } catch (e) { /* closed */ }
    ['trailRecording', 'trailSimple'].forEach((k) => { if (heldSettings[k] === undefined) delete state.settings[k]; else state.settings[k] = heldSettings[k]; });
    state.settings.profile = heldSettings.profile; state.settings.advanced = heldSettings.advanced;
    try { applyProfile(); } catch (e) { /* best effort */ }
    persistLibrary(heldLib);
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
