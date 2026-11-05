// One of a thing reads in the singular, and the full editor's sentences are
// translated (js/i18n.js: English is the key, the singular is picked at the
// call site with n === 1). What is held here:
//   1. the counts: a service due in 1 day or 1 day ago, an expected life of
//      1 year (the finding and the table's title), one link on a node (bound,
//      unbound, two unbound), a one-port faceplate in the findings and the
//      report, Add devices' button and summary, the port count's refusal, a
//      full rack's toast, a one-node template and the trace's status line;
//      and the plural still where there are several;
//   2. the service sentences in each locale;
//   3. what stayed English in every locale: the trace's status and the port
//      field's title, the Blocks tab's blurbs, the interface rows' titles,
//      the MAC notes, the bond's words, the cloud's site picker, the
//      gateway's toast, the rail notes and the Port filter label. The block
//      names stay English on purpose (DMZ).
// canvasmarks, mac and macnorm pin the English of the same rows.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const locales = ['es', 'pt-BR', 'ru', 'ja'];
  const heldToast = window.showToast;
  const toasts = [];
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const heldSettings = { traceMode: state.settings.traceMode, tracePort: state.settings.tracePort, tracePortOn: state.settings.tracePortOn };
  setLocale('en');

  try {
    window.showToast = (m) => toasts.push(m);

    // ---- 1: the counts ----
    const upkeepDoc = () => ({ v: DOC_VERSION, nodes: [
      { id: 'svc', type: 'pc', name: 'Front desk', x: 0, y: 0, serviceEvery: 12, serviced: '2025-11-01', interfaces: [] },
      { id: 'old', type: 'pc', name: 'Old PC', x: 100, y: 0, inService: '2020-01-01', lifeYears: 1, interfaces: [] }], links: [] });
    replaceDocument(upkeepDoc(), { origin: 'file' });
    const svcOn = (day) => onChecksDay(day, () => upkeepFindings()).find((f) => f.nodeIds[0] === 'svc' && /service/.test(f.key)) || {};
    ok('due tomorrow: "in 1 day"', svcOn('2026-10-31').detail === 'Due for service on 2026-11-01, in 1 day.', svcOn('2026-10-31').detail);
    ok('due yesterday: "1 day ago"', svcOn('2026-11-02').detail === 'Was due for service on 2026-11-01, 1 day ago.', svcOn('2026-11-02').detail);
    ok('two days out is still "in 2 days"', svcOn('2026-10-30').detail === 'Due for service on 2026-11-01, in 2 days.', svcOn('2026-10-30').detail);
    const age = upkeepFindings().find((f) => f.key === 'age') || {};
    ok('an expected life of 1 year says "1 year"', /expected to last 1 year\. Plan its replacement\.$/.test(age.detail || ''), age.detail);
    const ageCol = tvCols('devices').find((c) => c.key === 'age');
    const ageCell = ageCol.show({ key: 'n:old', rec: 'node', ref: { nodeId: 'old' }, data: {} });
    ok('and so does the table\'s title', ageCell.title === 'Past its expected life (1 year)', ageCell.title);

    // Links left unbound: loadDocState does not bind them.
    loadDocState({ v: DOC_VERSION, nodes: [
      { id: 'a', type: 'pc', name: 'A', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.2/24' }] },
      { id: 'h', type: 'pc', name: 'H', x: 100, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.3/24' }] },
      { id: 'b', type: 'pc', name: 'B', x: 0, y: 100, interfaces: [] },
      { id: 'c', type: 'pc', name: 'C', x: 100, y: 100, interfaces: [] }],
      links: [{ id: 'ab', source: 'a', target: 'b' }, { id: 'hb', source: 'h', target: 'b' }, { id: 'hc', source: 'h', target: 'c' }] });
    const one = evaluatePorts(getNode('a')).text, two = evaluatePorts(getNode('h')).text;
    ok('one unbound link: "1 link is not bound"', /^1 link is not bound to an interface\./.test(one), one);
    ok('two: "2 links are not bound"', /^2 links are not bound to an interface\. Select the links and pick their ports\.$/.test(two), two);
    ok('no "(s)" left', !/\(s\)/.test(one + two));

    const portsDoc = () => ({ v: DOC_VERSION,
      networks: [{ id: 'n1', cidr: '10.0.0.0/24', gateway: '10.0.0.1' }],
      nodes: [
        { id: 'rt', type: 'router', name: 'R', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] },
        { id: 'sw', type: 'switch', name: 'SW-1', x: 200, y: 0, portCount: 8, interfaces: [] },
        { id: 'ap', type: 'ap', name: 'AP-1', x: 400, y: 0, interfaces: [] },
        { id: 'srv', type: 'server', name: 'NAS', x: 0, y: 200, interfaces: [
          { id: 'e0', name: 'eth0', ip: '10.0.0.5/24', mac: '02:00:00:00:00:01' },
          { id: 'e1', name: 'eno1', ip: '' }, { id: 'e2', name: 'eno2', ip: '' },
          { id: 'b0', name: 'bond0', ip: '', bond: { mode: 'active-backup', members: ['e1', 'e2'] } },
          { id: 'e3', name: 'eth3', ip: '', mac: 'AA:BB' }] },
        { id: 'pc2', type: 'pc', name: 'PC-2', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.6/24', mac: '02:00:00:00:00:01' }] },
        { id: 'cl', type: 'cloud', name: 'Branch', x: 400, y: 200, interfaces: [] },
        { id: 'g', type: 'pc', name: 'Lost', x: 600, y: 200, gw: '10.9.9.9', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.9.5/24' }] }],
      links: [
        { id: 'l1', source: 'rt', target: 'srv', sourceIface: 'i1', targetIface: 'e0' },
        { id: 'l2', source: 'sw', target: 'ap', sourceIface: 'p1', targetIface: 'p1' }] });
    replaceDocument(portsDoc(), { origin: 'file' });
    const srvPorts = evaluatePorts(getNode('srv')).text;
    ok('one bound link: "1 link, on its own interface."', srvPorts === '1 link, on its own interface.', srvPorts);
    // Then what is left (portCapacity): an AP with no count set says so, a
    // switch with one gives its free ports.
    ok('a default AP with one cable: "1 of 1 port in use."', evaluatePorts(getNode('ap')).text === '1 of 1 port in use. Port count not set, so the total is a guess.', evaluatePorts(getNode('ap')).text);
    ok('a switch keeps "1 of 8 ports in use."', evaluatePorts(getNode('sw')).text === '1 of 8 ports in use. 7 ports free.', evaluatePorts(getNode('sw')).text);
    getNode('sw').portCount = 2;
    ok('one free port: "1 port free."', evaluatePorts(getNode('sw')).text === '1 of 2 ports in use. 1 port free.', evaluatePorts(getNode('sw')).text);
    getNode('sw').portCount = 8;
    const html = reportHtml(reportModel(), null);
    ok('the report\'s port map: "1 of 1 port used"', html.includes('1 of 1 port used') && html.includes('1 of 8 ports used'),
       (html.match(/AP-1 <span[^\n]*/) || [])[0]);

    // The port count refused below a cabled port 1.
    select('sw', 'node');
    const cnt = el('portCountInput');
    cnt.value = '0'; cnt.dispatchEvent(new Event('input'));
    const refusal = el('portCountRefusal');
    ok('the port count refusal says "below 1 port."', !!refusal && !refusal.hidden && /below 1 port\.$/.test(refusal.textContent), refusal && refusal.textContent);
    cnt.dispatchEvent(new Event('blur'));
    ok('and the count is left as it was', getNode('sw').portCount === 8);

    // Add devices: one of something.
    openAddDevices({ mode: 'add' });
    const setOne = () => {
      const inputs = [...document.querySelectorAll('#addRows .add-count')];
      inputs.forEach((i, k) => { i.value = k === 0 ? '1' : '0'; });
      inputs[0].dispatchEvent(new Event('input'));
    };
    setOne();
    ok('Add devices\' button: "Add 1 device"', el('addApplyBtn').textContent === 'Add 1 device', el('addApplyBtn').textContent);
    closeAddDevices();
    openAddDevices({ mode: 'new' });
    setOne();
    ok('a new network: "A router and 1 device."', el('addSummary').textContent.includes('A router and 1 device.'), el('addSummary').textContent.slice(0, 80));
    closeAddDevices();

    // A full rack refuses a 1U device in one sentence.
    replaceDocument({ v: DOC_VERSION, groups: [{ id: 'rk', name: 'R1', kind: 'rack', uHeight: 1 }],
      nodes: [{ id: 'f', type: 'server', name: 'Full', x: 0, y: 0, group: 'rk', rackU: 1, interfaces: [] },
              { id: 'w', type: 'server', name: 'Waiting', x: 100, y: 0, group: 'rk', interfaces: [] }], links: [] }, { origin: 'file' });
    toasts.length = 0;
    const placed = placeUnplaced(getNode('w'));
    const rackName = groupLabel(rackOfNode(getNode('w')));
    ok('a full rack: "There is no free unit in <rack>."', !placed && toasts.includes(`There is no free unit in ${rackName}.`), show(toasts));

    // A one-node template.
    persistLibrary({});
    replaceDocument({ v: DOC_VERSION, nodes: [{ id: 'r', type: 'router', name: 'R', x: 0, y: 0, interfaces: [] }], links: [] }, { origin: 'file' });
    librarySave('Solo', null, { template: true });
    renderUserTemplates();
    ok('a one-node template: "1 node · reusable template"', el('userTemplateList').textContent.includes('1 node · reusable template'), el('userTemplateList').textContent.slice(0, 80));
    persistLibrary({}); renderUserTemplates();

    // The trace.
    replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'r', type: 'router', name: 'R', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 's', type: 'server', name: 'Web', x: 100, y: 0, gw: '10.0.0.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] }],
      links: [{ id: 'l', source: 'r', target: 's' }] }, { origin: 'file' });
    autoBindLinks();
    state.settings.tracePort = ''; state.settings.tracePortOn = false;
    select('r', 'node'); setTraceMode(true); renderCanvasOnly();
    ok('the trace: "→ 1 device"', el('traceStatus').textContent === '→ 1 device', el('traceStatus').textContent);
    setLocale('es'); renderCanvasOnly();
    ok('and in Spanish "→ 1 dispositivo"', el('traceStatus').textContent === '→ 1 dispositivo', el('traceStatus').textContent);
    setLocale('en'); setTraceMode(false);

    // ---- 2: the service sentences in each locale ----
    replaceDocument(upkeepDoc(), { origin: 'file' });
    const forms = {
      es: ['en 1 día.', 'hace 1 día', 'dure 1 año.'], 'pt-BR': ['daqui a 1 dia.', 'há 1 dia', 'de 1 ano.'],
      ru: ['через 1 дн.', '1 дн. назад', 'лет: 1.'], ja: ['あと1日です。', '1日前', '耐用年数は1年']
    };
    locales.forEach((loc) => {
      setLocale(loc);
      const soon = svcOn('2026-10-31').detail || '', late = svcOn('2026-11-02').detail || '';
      ok(`${loc}: due in 1 day, and 1 day ago`, soon.includes(forms[loc][0]) && late.includes(forms[loc][1]), `${soon} | ${late}`);
      const life = (upkeepFindings().find((f) => f.key === 'age') || {}).detail || '';
      ok(`${loc}: the 1-year life is translated, in the singular`, life.includes(forms[loc][2]), life);
    });
    setLocale('en');

    // ---- 3: nothing left in English ----
    replaceDocument(portsDoc(), { origin: 'file' });
    getNode('srv').macOpen = true;
    state.settings.traceMode = false; state.settings.tracePort = '443'; state.settings.tracePortOn = false;
    const words = (s) => /[A-Za-z]{3,} [A-Za-z]{2,}/.test(s);
    const snapshot = (loc) => {
      setLocale(loc);
      select('srv', 'node');
      applyLocale();   // the selected device's rows are redrawn by the switch itself
      const box = el('ifaceListContainer');
      const snap = {
        trace: el('traceStatus').textContent,
        portTitle: el('tracePort').title,
        blocks: el('blockList').textContent,
        titles: [...box.querySelectorAll('[title]')].map((x) => x.title),
        mac: [...box.querySelectorAll('.if-mac-out')].map((x) => x.textContent).join(' | '),
        bond: [...box.querySelectorAll('.if-note')].map((x) => x.textContent).join(' | '),
        bondMode: (box.querySelector('select.if-select') || {}).title || '',
        notes: ['Passthrough bypasses the host OS, connecting the VM directly to the physical switch logic.',
          'Pick the interface this link uses on each end. Occupied ports are marked — you can still pick one, and the node will flag the conflict.',
          'Unassigned switches act as L2 Backplanes.', 'Port filter']
          .map((k) => [...document.querySelectorAll('[data-i18n]')].find((x) => x.dataset.i18nKey === k)).map((x) => (x ? x.textContent : null))
      };
      select('cl', 'node');
      snap.site = [...el('propSiteRef').options].map((o) => o.textContent).join(' | ');
      select('g', 'node');
      toasts.length = 0;
      el('jumpGwBtn').click();
      snap.toast = toasts.join(' | ');
      select(null);
      return snap;
    };
    const en = snapshot('en');
    ok('the fixture: in English the rows say what the other locales must not',
       en.trace === 'Trace off' && /Firewall \+ two zones/.test(en.blocks) && en.titles.some((x) => /^Linked to /.test(x))
       && /OUI not in the built-in table/.test(en.mac) && /Randomised or hand-set/.test(en.mac) && /Also on PC-2 \/ eth0/.test(en.mac)
       && /Need exactly 12 hex digits — got 4\./.test(en.mac) && /member of bond0/.test(en.bond) && /— not a site —/.test(en.site)
       && en.toast === 'Gateway node (10.9.9.9) not found in the topology.'
       && en.portTitle === 'Port filter is off — this port is ignored. Toggle Port filter on to apply it.',
       show(en).slice(0, 300));
    locales.forEach((loc) => {
      const s = snapshot(loc);
      setLocale(loc);
      ok(`${loc}: the trace status is translated`, !!s.trace && s.trace !== 'Trace off', s.trace);
      ok(`${loc}: the port field's title says the filter is off, translated`,
         s.portTitle === t('Port filter is off — this port is ignored. Toggle Port filter on to apply it.') && s.portTitle !== en.portTitle, s.portTitle);
      ok(`${loc}: the Blocks tab's blurbs are translated, its names are not`, !s.blocks.includes('Firewall + two zones') && s.blocks.includes('DMZ'));
      // Words, not addresses: an IP field's title is its value in every locale.
      const left = s.titles.filter((x) => words(x) && en.titles.includes(x));
      ok(`${loc}: no English title on the interface rows`, s.titles.length === en.titles.length && left.length === 0, show(left));
      ok(`${loc}: the MAC notes are translated`, !/OUI not in|Randomised|Also on|Need exactly/.test(s.mac) && /PC-2 \/ eth0/.test(s.mac), s.mac.slice(0, 120));
      ok(`${loc}: so are the bond's words`, !!s.bond && !/member of/.test(s.bond) && s.bond.includes('bond0') && !!s.bondMode && s.bondMode !== en.bondMode, `${s.bond} / ${s.bondMode}`);
      ok(`${loc}: the site picker's "not a site" is translated`, !s.site.includes('— not a site —'), s.site);
      ok(`${loc}: the gateway toast is translated, and keeps its address`, !!s.toast && s.toast !== en.toast && s.toast.includes('10.9.9.9'), s.toast);
      ok(`${loc}: the rail notes and the Port filter label are translated`, s.notes.every((x, i) => !!x && x !== en.notes[i]), show(s.notes));
    });
  } catch (e) {
    ok('the suite ran to the end', false, `${e.message} ${(e.stack || '').split('\n')[1] || ''}`);
  } finally {
    window.showToast = heldToast;
    setDialogResponder(heldResponder);
    Object.assign(state.settings, heldSettings);
    setLocale('en'); applyLocale();
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
