// Locate stage 2 (docs/BACKLOG.md, feature 1, landing order step 4): the
// Full editor's Locate section and the W key (js/locate.js). What is held:
//   1. the slot: <details id="locateGroup" data-adv> right after the Asset
//      group in the device panel; its open state kept in this browser
//      (LOCATE_OPEN_KEY, closed by default) and restored;
//   2. the steps for a bonded server in a rack: the device, its NIC with the
//      bond, the cable's tag, colour, length and via (byte for byte), the
//      switch port by its scheme with the jack and VLAN, the rack's units,
//      Open in rack and the group path with each kind; two cables two legs;
//      the summary names the first cable's far end;
//   3. every gap as a muted line in plain words, never a guessed value: no
//      cable, no port picked (with Pick a port, gone on a read-only network),
//      no jack label, no via, in no group with the typed location, not
//      placed in its rack, which side serves the radio, which AP is upstream,
//      retired (dimmed), the walk's depth cap and a loop;
//   4. the buttons: a device step selects that device, a cable step the
//      cable, Open in rack lands in One cable mode on that cable, Pick a port
//      does what openCablePorts does, Show on map selects the path's devices
//      and cables; none of them is an edit (document byte for byte, no undo
//      step, docChanges counts nothing); 44px targets on a phone;
//   7. more of the path and the review's fixes: a VM on a retired racked host,
//      the routing and several stops, noUplink, an inferred SSID by name, no
//      Open in rack on a radio hop, Show on map shutting the phone drawer and
//      centring the camera, a redraw on going back from a reduced view;
//   5. the W key: with a device selected it opens the section; with nothing
//      selected it focuses the search box as / does; in a reduced view the
//      section is gone and W shows the plain sentence instead (stage 4); the
//      cheatsheet lists it;
//   6. the words in the other locales: Spanish gaps, the singular for one
//      step, and every new string in es, pt-BR, ja and ru;
//   8. stage 3, the search box: a Locate button in #queryTools after Zoom and
//      Select, enabled only on exactly one device match (tag:, mac: with odd
//      separators, ip:, plain text), disabled with "Narrow the search to one
//      device" on several and on none, never picking the first; a click selects
//      the device and opens its section, with no edit; the table's Devices tab
//      has it and its other tabs do not; the rack view has it (Zoom hidden),
//      enabled on one and a click working there; each enabled case checks the
//      device it names; translated; 44px on a phone, and the card wraps onto
//      more rows with nothing overflowing at 360 and 390 in Spanish;
//   9. stage 3, '#asset/<tag>' in the Full editor: on the open network and
//      from a card kept here (through load()) the device is selected with its
//      Locate section open; a reduced view opens nothing.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const gone = (id) => getComputedStyle(el(id)).display === 'none' || el(id).offsetParent === null;
  const undoBtn = () => el('undoBtn');
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const NIC = (...names) => names.map((name, k) => ({ id: `e${k + 1}`, name, ip: '' }));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: NIC('eth0') }, extra);
  const L = (id, source, sourceIface, target, targetIface, extra = {}) => Object.assign({ id, source, target, sourceIface, targetIface }, extra);
  const VIA = '  PP-A:12 > WJ-3B ';
  const WIFI = (id, name) => N(id, 'pc', { name, group: 'off', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] });
  const doc = () => ({ v: DOC_VERSION,
    nodes: [
      N('sw1', 'switch', { name: 'SW-1', group: 'rk', rackU: 40, x: 300, interfaces: [], portCount: 24, portScheme: { prefix: 'Gi1/0/', start: 1 },
        portAttrs: { p1: { label: 'Patch 1', vlan: 10 }, p3: { label: 'Reception 2' } } }),
      N('sw2', 'switch', { name: 'SW-2', group: 'rk2', x: 300, y: 200, interfaces: [], portCount: 8 }),
      N('sw3', 'switch', { name: 'SW-3', x: 300, y: 300, interfaces: [], location: '  Closet B ' }),
      N('srv', 'server', { name: 'SRV', group: 'rk', rackU: 10, rackHeight: 2,
        interfaces: [...NIC('eno1', 'eno2'), { id: 'b0', name: 'bond0', ip: '10.0.0.5/24', bond: { mode: '802.3ad', members: ['e1', 'e2'] } }] }),
      N('np', 'pc', { name: 'No port', group: 'off', y: 100 }),
      N('typ', 'pc', { name: 'Typed', group: 'off', y: 150 }),
      N('lone', 'pc', { name: 'Lone', group: 'off', y: 200 }),
      N('old', 'pc', { name: 'Old PC', group: 'off', status: 'retired', y: 250 }),
      N('lap', 'pc', { name: 'Laptop', group: 'off', y: 300, interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }),
      N('ap1', 'ap', { name: 'AP-1', group: 'off', x: 150, y: 300, interfaces: [] }),
      N('ap2', 'ap', { name: 'AP-Mesh', group: 'off', x: 150, y: 400, interfaces: [] }),
      WIFI('tab', 'Tablet'), WIFI('ra', 'Radio A'), WIFI('rb', 'Radio B'),
      N('x1', 'pc', { name: 'X1', group: 'off', interfaces: NIC('a', 'b') }),
      N('x2', 'pc', { name: 'X2', group: 'off', interfaces: NIC('a', 'b') }),
      N('x3', 'pc', { name: 'X3', group: 'off', interfaces: NIC('a', 'b') }),
      ...[1, 2, 3, 4, 5, 6].map((k) => N(`d${k}`, 'pc', { name: `D${k}`, group: 'off', interfaces: NIC('a', 'b') }))
    ],
    links: [
      L('c1', 'srv', 'e1', 'sw1', 'p1', { cable: { label: 'A-01', color: 'blue', length: '2 m', via: VIA } }),
      L('c2', 'srv', 'e2', 'sw1', 'p2', { cable: { label: 'A-02' } }),
      L('c3', 'np', 'e1', 'sw2', null, { cable: { via: 'v' } }),
      L('c4', 'typ', 'e1', 'sw3', 'p1', { cable: { via: 'v' } }),
      L('c5', 'old', 'e1', 'sw1', 'p3', { cable: { via: 'v' } }),
      L('c6', 'lap', 'w1', 'ap1', null, { medium: 'wireless', wifi: { band: '5' } }),
      L('c7', 'ap1', 'p1', 'sw1', 'p4', { cable: { via: 'PP-C:4' } }),
      L('c8', 'ap1', null, 'ap2', null, { medium: 'wireless' }),
      L('c9', 'tab', 'w1', 'ap2', null, { medium: 'wireless' }),
      L('c10', 'ra', 'w1', 'rb', 'w1', { medium: 'wireless' }),
      L('c11', 'x1', 'e1', 'x2', 'e1'), L('c12', 'x2', 'e2', 'x3', 'e1'), L('c13', 'x3', 'e2', 'x1', 'e2'),
      L('c14', 'd1', 'e1', 'd2', 'e1'), L('c15', 'd2', 'e2', 'd3', 'e1'), L('c16', 'd3', 'e2', 'd4', 'e1'),
      L('c17', 'd4', 'e2', 'd5', 'e1'), L('c18', 'd5', 'e2', 'd6', 'e1')
    ],
    groups: [{ id: 'bld', name: 'HQ', kind: 'building' }, { id: 'fl', name: 'Floor 2', kind: 'floor', parent: 'bld' },
      { id: 'room', name: 'Server room', kind: 'room', parent: 'fl' }, { id: 'rk', name: 'Rack S', kind: 'rack', parent: 'room', uHeight: 42 },
      { id: 'rk2', name: 'Rack T', kind: 'rack', parent: 'room', uHeight: 24 }, { id: 'off', name: 'Office', kind: 'room', parent: 'fl' }] });
  const body = () => el('locateBody');
  const gapText = (code) => [...body().querySelectorAll(`.locate-gap[data-gap="${code}"]`)].map((g) => g.textContent);
  const show = (id) => { select(id, 'node'); return body(); };
  const press = (key) => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  const heldKey = (() => { try { return localStorage.getItem(LOCATE_OPEN_KEY); } catch (e) { return null; } })();
  setLocale('en');

  try {
    replaceDocument(doc(), { origin: 'file' });
    setView('map');

    // ---- 1. The slot and its open state ----
    ok('Locate is a data-adv fold right after the Asset group, in the device panel',
      el('assetGroup').nextElementSibling === el('locateGroup') && el('locateGroup').tagName === 'DETAILS'
      && el('locateGroup').hasAttribute('data-adv') && el('nodeGeneralProps').contains(el('locateGroup')));
    localStorage.removeItem(LOCATE_OPEN_KEY);
    restoreLocateGroup();
    ok('closed by default', el('locateGroup').open === false);
    select('srv', 'node');
    ok('closed, the summary still says where it ends', el('locateSummary').textContent === 'SW-1 · Gi1/0/1' && body().innerHTML === '', el('locateSummary').textContent);
    el('locateGroup').open = true; el('locateGroup').dispatchEvent(new Event('toggle'));
    await tick();
    ok('opening it is remembered in this browser', localStorage.getItem(LOCATE_OPEN_KEY) === '1');
    ok('and draws the steps', body().querySelectorAll('.locate-step').length > 3);
    el('locateGroup').open = false; el('locateGroup').dispatchEvent(new Event('toggle'));
    await tick();
    ok('folding it is remembered too', localStorage.getItem(LOCATE_OPEN_KEY) === '0');
    localStorage.setItem(LOCATE_OPEN_KEY, '1');
    restoreLocateGroup();
    ok('and restored', el('locateGroup').open === true);

    // ---- 2. The steps ----
    show('srv');
    const txt = body().textContent;
    const devs = [...body().querySelectorAll('.locate-dev')].map((b) => b.textContent);
    ok('the device, then its NIC with the bond', devs[0] === 'SRV' && devs[1] === 'SRV · eno1 (bond0)', devs.slice(0, 2).join(' | '));
    const cable = body().querySelector('.locate-cable[data-loc-link="c1"]');
    ok('the cable: tag, colour and length', cable && /Tag: A-01/.test(cable.textContent) && /blue · 2 m/.test(cable.textContent), cable && cable.textContent);
    ok('the via byte for byte, never trimmed or split', cable && cable.querySelector('.locate-via .locate-data').textContent === VIA);
    const far = [...body().querySelectorAll('.locate-dev[data-loc-node="sw1"]')][0];
    ok('the switch port by its scheme, with the jack and VLAN', far && /^SW-1 · Gi1\/0\/1/.test(far.textContent) && /Jack Patch 1 · VLAN 10/.test(far.textContent), far && far.textContent);
    ok('the rack\'s units', /Rack S · U40/.test(txt), txt.slice(0, 300));
    ok('Open in rack on the cable', !!body().querySelector('.locate-rack[data-loc-rack="rk"][data-loc-link="c1"]'));
    const grp = body().querySelector('.locate-groups');
    ok('the group path, each with its kind', grp && grp.textContent === 'Building HQ › Floor Floor 2 › Room Server room › Rack Rack S', grp && grp.textContent);
    ok('two cables, two legs, the first numbered', body().querySelectorAll('.locate-steps').length === 3 && /Cable 1 of 2/.test(txt) && /Cable 2 of 2/.test(txt));
    ok('a step is a real button', [...body().querySelectorAll('.locate-step')].every((b) => b.tagName === 'BUTTON' && b.type === 'button'));
    // The runner's window is narrow (<= 900px), where the phone rule applies.
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    ok('the runner window is a phone-width rail (so the next check means something)', narrow, String(window.innerWidth));
    ok('every step is a 44px target on a phone', narrow && [...body().querySelectorAll('.locate-step')].every((b) => parseFloat(getComputedStyle(b).minHeight) >= 44)
      && parseFloat(getComputedStyle(body().querySelector('.locate-show')).minHeight) >= 44);

    // ---- 3. The gaps ----
    ok('no via: a muted line', gapText('noVia').includes('No via written for this cable.'), gapText('noVia').join(' | '));
    show('np');
    ok('no port picked: named, never port 1', gapText('noPort')[0] === 'No port picked at SW-2. Pick a port' && !/SW-2 · 1\b/.test(body().textContent), gapText('noPort').join(' | '));
    ok('with Pick a port', !!body().querySelector('[data-loc-pick="c3"]'));
    ok('in its rack, not placed yet', gapText('notPlaced')[0] === 'In Rack T, not placed yet.', gapText('notPlaced').join(' | '));
    state.readOnly = true; renderLocate(getNode('np'));
    ok('a read-only network offers no Pick a port', !body().querySelector('[data-loc-pick]') && gapText('noPort')[0] === 'No port picked at SW-2.');
    state.readOnly = false; renderLocate(getNode('np'));
    show('typ');
    ok('in no group, with the location typed on it', gapText('notGrouped')[0] === 'SW-3 is in no group. Location typed on it: Closet B', gapText('notGrouped').join(' | '));
    show('lone');
    ok('no cable recorded', gapText('noCable')[0] === 'No cable recorded.', body().textContent);
    show('old');
    ok('retired: said, and the step dimmed', gapText('retired')[0] === 'Old PC is retired.' && body().querySelector('.locate-dev').classList.contains('locate-retired'));
    ok('and the walk goes on to the port', /SW-1 · Gi1\/0\/3/.test(body().textContent) && /Jack Reception 2/.test(body().textContent));
    show('lap');
    ok('over Wi-Fi: the band as recorded, the AP, then its cable to the switch',
      /Wi-Fi/.test(body().querySelector('.locate-cable').textContent) && /5/.test(body().querySelector('.locate-cable').textContent)
      && !!body().querySelector('.locate-dev[data-loc-node="ap1"]') && /SW-1 · Gi1\/0\/4/.test(body().textContent));
    ok('a port with no label: no jack label', gapText('noJack')[0] === 'Port Gi1/0/4 has no jack label.', gapText('noJack').join(' | '));
    show('tab');
    ok('a mesh AP: which access point is upstream is not recorded', gapText('apUpstream')[0] === 'Which access point is upstream is not recorded.', body().textContent);
    show('ra');
    ok('two radio clients: which side serves is not recorded', gapText('radioUnknown')[0] === 'Which side is the access point is not recorded.', body().textContent);
    show('d1');
    const depth = body().querySelector('[data-stop="depth"]');
    ok('the depth cap says so', depth && depth.textContent === `Stopped after ${LOCATE_HOPS_MAX} steps.`, depth && depth.textContent);
    show('x1');
    const loop = body().querySelector('[data-stop="loop"]');
    ok('a loop says where', loop && /is already on this path: stopped there\.$/.test(loop.textContent), body().textContent);

    // ---- 4. The buttons: views, never edits ----
    show('srv');
    const before = JSON.stringify(serializeDoc ? serializeDoc() : { n: state.nodes, l: state.links });
    const stepsBefore = steps();
    const baseDoc = JSON.parse(JSON.stringify(serializeDoc()));
    body().querySelector('.locate-dev[data-loc-node="sw1"]').click();
    ok('a device step selects that device', state.selection.size === 1 && state.selectedId === 'sw1' && state.selectedType === 'node');
    show('srv');
    body().querySelector('.locate-cable[data-loc-link="c1"]').click();
    ok('a cable step selects the cable', state.selection.size === 1 && state.selectedId === 'c1' && state.selectedType === 'link');
    show('srv');
    body().querySelector('.locate-rack[data-loc-link="c1"]').click();
    ok('Open in rack shows that rack in One cable mode on the cable', rackShown() && _rv.rackId === 'rk' && _rv.cables === 'one' && state.selectedId === 'c1', `${rackShown()} ${_rv.rackId} ${_rv.cables} ${state.selectedId}`);
    setView('map');
    show('np');
    body().querySelector('[data-loc-pick="c3"]').click();
    ok('Pick a port selects the cable and shows its port picker, as openCablePorts does', state.selectedId === 'c3' && state.selectedType === 'link' && !gone('linkPortProps'));
    show('lap');
    const want = locateEntries(locatePath(getNode('lap')));
    body().querySelector('[data-loc-show]').click();
    const sel = [...state.selection].map((e) => `${e.type}:${e.id}`).sort().join(',');
    ok('Show on map selects the path\'s devices and cables', sel === want.map((e) => `${e.type}:${e.id}`).sort().join(',')
      && sel === 'link:c6,link:c7,node:ap1,node:lap,node:sw1', sel);
    ok('on the map', effectiveView() === 'map');
    setView('table'); show('lap'); body().querySelector('[data-loc-show]').click();
    ok('from the table it goes to the map', effectiveView() === 'map');
    ok('none of it is an edit: the document byte for byte', JSON.stringify(serializeDoc ? serializeDoc() : { n: state.nodes, l: state.links }) === before);
    ok('no undo step', steps() === stepsBefore, `${stepsBefore} -> ${steps()}`);
    ok('and the changes count is unchanged (docChanges, as the card counts them)', docChanges(baseDoc, serializeDoc()).total === 0, String(docChanges(baseDoc, serializeDoc()).total));

    // ---- 5. The W key ----
    ok('W is in the shortcut table as "Where is it plugged in?"', SHORTCUTS.some((s) => s.keys[0] === 'W' && s.label === 'Where is it plugged in?'));
    select('srv', 'node');
    el('locateGroup').open = false; el('locateGroup').dispatchEvent(new Event('toggle'));
    await tick();
    press('w');
    await tick();
    ok('W with a device selected opens its Locate section', el('locateGroup').open && body().querySelectorAll('.locate-step').length > 3);
    ok('and that is remembered like a click on it', localStorage.getItem(LOCATE_OPEN_KEY) === '1');
    select(null, null);
    press('w');
    ok('W with nothing selected focuses the search box, as / does', document.activeElement === el('queryInput'));
    el('queryInput').blur();
    select('srv', 'node');
    state.settings.advanced = false; applyProfile();
    ok('the section is gone in a reduced view', gone('locateGroup'));
    el('locateGroup').open = false;
    // applyProfile already drew the sentence; cleared, so only W can fill it.
    el('locateSentence').textContent = '';
    press('w');
    // Stage 4: W is no longer simpleHidden; there it shows the plain sentence.
    ok('and W there opens no section: it shows the plain sentence (stage 4)', el('locateGroup').open === false && document.activeElement !== el('queryInput')
      && !gone('locateSentence') && el('locateSentence').textContent.startsWith('Plugged into SW-1, socket Gi1/0/1'), el('locateSentence').textContent);
    state.settings.advanced = true; applyProfile();
    el('locateGroup').open = true;

    // ---- 6. The words ----
    setLocale('es');
    show('np');
    ok('the gaps in Spanish', gapText('noPort')[0] === 'No se eligió puerto en SW-2. Elegir un puerto', gapText('noPort').join(' | '));
    setLocale('en');
    ok('one step reads in the singular', locateStopText({ hops: [{}], stop: { reason: 'depth', node: null } }) === 'Stopped after 1 step.');
    const keys = ['Locate', 'Where is it plugged in?', 'Show on map', 'Open in rack', 'No cable recorded.', 'No port picked at {switch}.',
      'Port {port} has no jack label.', 'No via written for this cable.', '{device} is in no group.', 'In {rack}, not placed yet.',
      'Which side is the access point is not recorded.', 'Which access point is upstream is not recorded.',
      'Stopped after {n} step.', 'Stopped after {n} steps.'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const missing = keys.filter((k) => !CarinoI18N.has(loc, k));
      ok(`${loc} has the Locate strings`, missing.length === 0, missing.join(' | '));
    });
    ok('Russian keeps one form for any count', CarinoI18N.MESSAGES.ru['Stopped after {n} step.'] === CarinoI18N.MESSAGES.ru['Stopped after {n} steps.']);

    // ---- 7. More of the path, and the review's fixes ----
    {
      const d = doc();
      d.nodes.push(
        N('hst', 'server', { name: 'HST', group: 'rk', rackU: 20, status: 'retired' }),
        N('vm', 'vm', { name: 'VM-9', host: 'hst', interfaces: [{ id: 'v1', name: 'eth0', ip: '' }] }),
        N('rt', 'router', { name: 'RT', group: 'off', interfaces: NIC('eth0') }),
        N('rp', 'pc', { name: 'RP', group: 'off' }),
        N('y1', 'pc', { name: 'Y1', group: 'off' }),
        N('y2', 'pc', { name: 'Y2', group: 'off', interfaces: NIC('a', 'b', 'c') }),
        N('y3', 'pc', { name: 'Y3', group: 'off' }), N('y4', 'pc', { name: 'Y4', group: 'off' }));
      d.links.push(L('h1', 'hst', 'e1', 'sw1', 'p5', { cable: { via: 'v' } }), L('r1', 'rp', 'e1', 'rt', 'e1', { cable: { via: 'v' } }),
        L('y12', 'y1', 'e1', 'y2', 'e1'), L('y23', 'y2', 'e2', 'y3', 'e1'), L('y24', 'y2', 'e3', 'y4', 'e1'));
      replaceDocument(d, { origin: 'file' });
      setView('map');
      localStorage.setItem(LOCATE_OPEN_KEY, '1'); restoreLocateGroup();
    }
    show('vm');
    const host = body().querySelector('.locate-dev[data-loc-node="hst"]');
    ok('a VM: "Runs on" its host, dimmed when the host is retired', host && host.textContent === 'Runs on HST' && host.classList.contains('locate-retired'), host && host.outerHTML);
    ok('and the host\'s cable is the VM\'s way out', el('locateSummary').textContent === 'SW-1 · Gi1/0/5' && gapText('retired')[0] === 'HST is retired.', el('locateSummary').textContent);
    ok('Open in rack from the host\'s rack on that cable', !!body().querySelector('.locate-rack[data-loc-rack="rk"][data-loc-link="h1"]'));
    show('rp');
    const routing = body().querySelector('[data-stop="routing"]');
    ok('a PC on a router: stops there as a routing device', routing && routing.textContent === 'Stops at RT, a routing device.', body().textContent);
    show('y1');
    const several = body().querySelector('[data-stop="several"]');
    ok('a fork with no faceplate: which cable leads on is not recorded', several && several.textContent === 'More than one cable leads on from Y2: which one is not recorded.', body().textContent);
    show('sw1');
    ok('a core switch: nothing recorded leads up from it', gapText('noUplink')[0] === 'Nothing recorded leads up from SW-1.', body().textContent);

    // Wi-Fi: the SSID worked out from the AP's radio is the network's name,
    // marked inferred; the band in GHz as recorded.
    state.wifi = [{ id: 'wf1', ssid: 'Staff' }];
    getNode('ap1').interfaces = [{ id: 'r1', name: 'wlan0', ip: '', wireless: true, radio: { ssids: ['wf1'] } }];
    getLink('c6').targetIface = 'r1';
    show('lap');
    const air = body().querySelector('.locate-cable[data-loc-link="c6"] .locate-meta');
    ok('an SSID worked out is shown by its name and marked (inferred), never as its id', air && air.textContent === 'Staff (inferred) · 5 GHz', air && air.textContent);
    // An AP in a rack reached by radio: the rack view draws no radio link, so
    // its hop offers no Open in rack; the AP's cable to the switch does.
    getNode('ap1').group = 'rk'; getNode('ap1').rackU = 30;
    show('lap');
    ok('no Open in rack on a radio hop (the rack view never draws one)', !body().querySelector('.locate-rack[data-loc-link="c6"]'), body().innerHTML.slice(0, 400));
    ok('the AP\'s cable in the same rack still has it', !!body().querySelector('.locate-rack[data-loc-rack="rk"][data-loc-link="c7"]'));

    // Show on map fits the path in view, and on a phone shuts the drawer
    // that covers the map.
    show('lap');
    const ws = document.querySelector('.topo-ws');
    if (!ws.classList.contains('drawer-open')) document.querySelector('[data-ws-toggle]').click();
    ok('the drawer is open over the map before', ws.classList.contains('drawer-open'));
    state.camera = { x: 5000, y: 5000, zoom: 3 }; applyCamera();
    body().querySelector('[data-loc-show]').click();
    ok('Show on map shuts the drawer on a phone', !ws.classList.contains('drawer-open'));
    const r = el('networkCanvas').getBoundingClientRect();
    const pts = ['lap', 'ap1', 'sw1'].map(getNode);
    const midX = (Math.min(...pts.map((n) => n.x)) + Math.max(...pts.map((n) => n.x))) / 2;
    ok('and fits the path: the camera moved to centre it', state.camera.x !== 5000 && Math.abs(state.camera.x + midX * state.camera.zoom - r.width / 2) < 1,
      JSON.stringify(state.camera));

    // Reduced, then back to Full with a device selected: drawn again.
    state.settings.advanced = false; applyProfile();
    select('srv', 'node');
    ok('a reduced view leaves the section empty', body().innerHTML === '');
    state.settings.advanced = true; applyProfile();
    ok('back in Full, the section is drawn again for the selection', el('locateGroup').open && body().querySelectorAll('.locate-step').length > 3
      && el('locateSummary').textContent === 'SW-1 · Gi1/0/1', el('locateSummary').textContent);

    // ---- 8. The search's Locate button (stage 3) ----
    {
      const d = doc();
      Object.assign(d.nodes.find((n) => n.id === 'srv'), { assetTag: 'CS-0700' });
      d.nodes.find((n) => n.id === 'np').interfaces[0].mac = 'AA:BB:CC:00:11:22';
      replaceDocument(d, { origin: 'file' });
      setView('map');
    }
    const lb = () => el('queryLocateBtn');
    const shown = (b) => !b.classList.contains('hidden') && getComputedStyle(b).display !== 'none';
    const tools = el('queryTools');
    ok('Locate sits in #queryTools right after Select matches', lb() && lb().parentElement === tools && el('querySelectBtn').nextElementSibling === lb() && lb().type === 'button');
    setQuery('');
    ok('no search, no tools card', getComputedStyle(tools).display === 'none');
    // Enabled, and the one match is the device the search names.
    const one = (q, id) => { setQuery(q); return shown(lb()) && !lb().disabled && lb().title === 'Where is it plugged in?'
      && JSON.stringify(queryLocateIds()) === JSON.stringify([id]); };
    ok('tag: naming one device enables it', one('tag:cs-0700', 'srv'), `${lb().disabled} ${lb().title} ${JSON.stringify(queryLocateIds())}`);
    ok('mac: with odd separators too', one('mac:aabb.cc00-1122', 'np'), `${lb().disabled} ${el('queryCount').textContent} ${JSON.stringify(queryLocateIds())}`);
    ok('ip: too', one('ip:10.0.0.5', 'srv'), `${lb().disabled} ${el('queryCount').textContent} ${JSON.stringify(queryLocateIds())}`);
    ok('and a plain word', one('Laptop', 'lap'), `${lb().disabled} ${el('queryCount').textContent} ${JSON.stringify(queryLocateIds())}`);
    setQuery('type:switch');
    ok('several matches: shown, disabled, saying why', shown(lb()) && lb().disabled && lb().title === 'Narrow the search to one device', `${lb().disabled} ${lb().title}`);
    select(null, null);
    ok('and it never picks the first', locateQueryMatch() === false && state.selection.size === 0 && !state.selectedId);
    setQuery('name:nothing-here');
    ok('no match: disabled', shown(lb()) && lb().disabled);
    setLocale('es'); applyStaticI18n();
    setQuery('type:pc'); setQuery('type:switch');
    ok('the tooltip is translated', lb().title === 'Acota la búsqueda a un solo dispositivo' && lb().textContent === 'Ubicar', `${lb().title} / ${lb().textContent}`);
    setLocale('en'); applyStaticI18n();
    setQuery('');
    {
      const before = JSON.stringify(serializeDoc()), stepsBefore = steps();
      select(null, null);
      el('locateGroup').open = false; el('locateGroup').dispatchEvent(new Event('toggle'));
      await tick();
      setQuery('tag:CS-0700');
      lb().click();
      await tick();
      ok('a click selects that device', state.selectedType === 'node' && state.selectedId === 'srv', state.selectedId);
      ok('and opens its Locate section, drawn', el('locateGroup').open && body().querySelectorAll('.locate-step').length > 3 && el('locateSummary').textContent === 'SW-1 · Gi1/0/1');
      ok('the search stays as typed', state.query === 'tag:CS-0700' && el('queryInput').value === 'tag:CS-0700');
      ok('none of it is an edit: the document byte for byte, no undo step', JSON.stringify(serializeDoc()) === before && steps() === stepsBefore);
    }
    // The table: the Devices tab's rows are devices; the other tabs' are not.
    setView('table'); showTableTab('devices');
    setQuery('tag:CS-0700');
    ok('the table\'s Devices tab has it, enabled on its one row', shown(lb()) && !lb().disabled, `${lb().className} ${lb().disabled}`);
    setQuery('type:switch');
    ok('and disabled on several rows', shown(lb()) && lb().disabled);
    showTableTab('cables');
    ok('the Cables tab has no Locate (its rows are cables)', !shown(lb()));
    showTableTab('devices');
    setQuery('tag:CS-0700');
    select(null, null);
    el('locateGroup').open = false; el('locateGroup').dispatchEvent(new Event('toggle'));
    await tick();
    ok('(the section starts shut for the table click)', !el('locateGroup').open);
    lb().click();
    await tick();
    ok('from the table a click selects the device and opens its section too', state.selectedId === 'srv' && el('locateGroup').open
      && body().querySelectorAll('.locate-step').length > 3, `${state.selectedId} ${el('locateGroup').open}`);
    setView('map');
    // The rack view: Zoom goes (nothing to frame), Locate stays and works.
    setQuery('');
    select(null, null);
    el('locateGroup').open = false; el('locateGroup').dispatchEvent(new Event('toggle'));
    await tick();
    ok('(the rack view opens)', openRackView('rk') && rackShown());
    setQuery('tag:CS-0700');
    ok('the rack view: Locate shown and enabled on one match, Zoom hidden', shown(lb()) && !lb().disabled && !shown(el('queryZoomBtn'))
      && JSON.stringify(queryLocateIds()) === '["srv"]', `${lb().className} ${lb().disabled} ${JSON.stringify(queryLocateIds())}`);
    setQuery('type:switch');
    ok('and disabled on several there', shown(lb()) && lb().disabled && lb().title === 'Narrow the search to one device');
    setQuery('tag:CS-0700');
    lb().click();
    await tick();
    ok('a click in the rack view selects the device and opens its section', state.selectedId === 'srv' && el('locateGroup').open
      && body().querySelectorAll('.locate-step').length > 3, `${state.selectedId} ${el('locateGroup').open}`);
    setView('map');
    // A phone: 44px, and the card wraps inside the window rather than scroll.
    setQuery('tag:CS-0700');
    ok('a 44px target on a phone, like Zoom and Select', narrow && ['queryLocateBtn', 'querySelectBtn', 'queryZoomBtn'].every((id) => parseFloat(getComputedStyle(el(id)).minHeight) >= 44));
    ok('the card fits the window, its buttons wrapped inside it', tools.getBoundingClientRect().right <= window.innerWidth + 0.5 && tools.scrollWidth <= tools.clientWidth + 1
      && [...tools.children].every((c) => c.getBoundingClientRect().right <= tools.getBoundingClientRect().right + 0.5), `${tools.getBoundingClientRect().right} / ${window.innerWidth}`);
    // 360 and 390 phones, in Spanish (the longest labels): the top bar is the
    // pane's width less its 12px sides, so it is pinned to that width here.
    // The card must wrap its buttons onto more rows and overflow nothing.
    {
      const bar = document.querySelector('.topo-topbar');
      const held = bar.getAttribute('style');
      setLocale('es'); applyStaticI18n();
      setQuery('tag:CS-0700');
      for (const w of [360, 390]) {
        bar.style.right = 'auto'; bar.style.width = `${w - 24}px`;
        const tr = tools.getBoundingClientRect(), br = bar.getBoundingClientRect();
        const tops = new Set([...tools.children].filter(shown).map((c) => Math.round(c.offsetTop)));
        ok(`${w}px: the card wraps its buttons onto more than one row`, tops.size > 1, [...tops].join(','));
        ok(`${w}px: nothing overflows the card or the bar`, tr.right <= br.right + 0.5 && tools.scrollWidth <= tools.clientWidth + 1
          && [...tools.children].filter(shown).every((c) => c.getBoundingClientRect().right <= tr.right + 0.5),
          `${tr.right} / ${br.right} ${tools.scrollWidth}/${tools.clientWidth}`);
      }
      if (held === null) bar.removeAttribute('style'); else bar.setAttribute('style', held);
      setLocale('en'); applyStaticI18n();
    }
    setQuery('');

    // ---- 9. #asset/<tag> in the Full editor (stage 3) ----
    select(null, null);
    el('locateGroup').open = false; el('locateGroup').dispatchEvent(new Event('toggle'));
    await tick();
    ok('a tag on the open network: selected with its Locate section open', (await openAssetLink('cs-0700')) === true && state.selectedId === 'srv'
      && el('locateGroup').open && body().querySelectorAll('.locate-step').length > 3);
    {
      const heldLib = (() => { try { return localStorage.getItem('nettopo_library'); } catch (e) { return null; } })();
      try {
        const cardDoc = JSON.parse(JSON.stringify(serializeDoc()));
        persistLibrary({ lc1: { id: 'lc1', name: 'Locate card', created: 1, updated: 2, doc: cardDoc } });
        replaceDocument(EMPTY_DOC, { origin: 'new' });
        el('locateGroup').open = false; el('locateGroup').dispatchEvent(new Event('toggle'));
        await tick();
        window.history.replaceState(null, '', `${location.pathname}${location.search}#asset/CS-0700`);
        await load();
        renderCanvasOnly(); fitToView(); applyArrivalFocus();
        ok('a printed label from a card kept here: the card opens, the device is selected', state.libraryId === 'lc1' && state.selectedId === 'srv', `${state.libraryId} ${state.selectedId}`);
        ok('and its Locate section is open and drawn', el('locateGroup').open && body().querySelectorAll('.locate-step').length > 3 && el('locateSummary').textContent === 'SW-1 · Gi1/0/1');
        ok('the tag leaves the address bar', location.hash === '');
      } finally {
        try { if (heldLib === null) localStorage.removeItem('nettopo_library'); else localStorage.setItem('nettopo_library', heldLib); } catch (e) { /* storage blocked */ }
      }
    }
    state.settings.advanced = false; applyProfile();
    select(null, null);
    el('locateGroup').open = false;
    const reducedHit = await openAssetLink('CS-0700');
    ok('a reduced view selects the device and opens no section', reducedHit === true && state.selectedId === 'srv' && el('locateGroup').open === false);
    state.settings.advanced = true; applyProfile();
  } catch (e) {
    ok('locatepanel suite ran without throwing', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    state.readOnly = false;
    try { if (heldKey === null) localStorage.removeItem(LOCATE_OPEN_KEY); else localStorage.setItem(LOCATE_OPEN_KEY, heldKey); } catch (e) { /* storage blocked */ }
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
