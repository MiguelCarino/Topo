window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const panel = document.getElementById('conflictAlert');
  const pill  = document.getElementById('conflictPill');
  const vis = (el) => !el.classList.contains('hidden');

  // ---- Alerts: hide / restore / persist ----
  localStorage.removeItem('nettopo_settings');
  state.settings.alertsHidden = false;
  state.nodes = [normalizeLoadedNode({ id: 'a', type: 'server', name: 'Broken', x: 0, y: 0,
    interfaces: [{ id: 'i1', name: 'eth0', ip: 'not-an-ip' }] })];
  state.links = [];
  validateTopology();
  ok('panel shows when there are errors', vis(panel) && !vis(pill));

  document.getElementById('conflictHideBtn').click();
  ok('dismiss hides the panel', !vis(panel), 'panel hidden=' + !vis(panel));
  ok('dismiss leaves a pill so problems are not silently lost', vis(pill));
  ok('pill reports the error count', document.getElementById('conflictPillCount').textContent === '1',
     document.getElementById('conflictPillCount').textContent);
  ok('preference persisted to localStorage', JSON.parse(localStorage.getItem('nettopo_settings')).alertsHidden === true);

  // Stays hidden across re-validation (i.e. every render).
  validateTopology();
  ok('stays hidden across re-renders', !vis(panel) && vis(pill));

  // Clean topology hides both.
  getNode('a').interfaces[0].ip = '192.168.1.5/24';
  validateTopology();
  ok('no errors hides panel and pill alike', !vis(panel) && !vis(pill));

  pill.click();
  getNode('a').interfaces[0].ip = 'bad';
  validateTopology();
  ok('pill click restores the panel', vis(panel) && !vis(pill));
  ok('restore persisted', JSON.parse(localStorage.getItem('nettopo_settings')).alertsHidden === false);

  // The panel must not block the canvas beneath it.
  ok('panel is click-through', getComputedStyle(panel).pointerEvents === 'none');
  ok('dismiss button is still clickable', getComputedStyle(document.getElementById('conflictHideBtn')).pointerEvents === 'auto');

  // ---- Per-medium flow animation ----
  const media = ['utp','fiber','wireless','powerline','vpn'];
  const nodes = [{ id: 'r', type: 'router', name: 'R', x: 0, y: 0, gw: '', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] }];
  const links = [];
  media.forEach((m, i) => {
    nodes.push({ id: 'n' + i, type: 'server', name: 'N' + i, x: 100 * (i + 1), y: 100, gw: '10.0.0.1',
      interfaces: [{ id: 'i1', name: m === 'wireless' ? 'wlan0' : 'eth0', ip: '10.0.0.' + (10 + i) + '/24' }] });
    links.push({ id: 'l' + i, source: 'r', target: 'n' + i, medium: m });
  });
  state.nodes = nodes.map(normalizeLoadedNode); state.links = links.map(normalizeLoadedLink); autoBindLinks();
  state.settings.traceMode = true;
  select('r', 'node');

  const classes = media.map(m => {
    const l = state.links.find(x => x.medium === m);
    const el = document.getElementById('ui-link-' + l.id);
    return el ? [...el.classList].find(c => c.startsWith('flow-')) : 'MISSING';
  });
  ok('every medium animates', classes.every(Boolean) && !classes.includes('MISSING'), classes.join(', '));
  ok('each medium animates differently', new Set(classes).size === media.length, classes.join(', '));
  ok('medium maps to its own class', classes.join(',') === 'flow-utp,flow-fiber,flow-wireless,flow-powerline,flow-vpn', classes.join(','));

  // The CSS must actually resolve — a class with no rule would silently do nothing.
  // Wireless is excluded: it is driven by SMIL on a textPath, not a CSS animation
  // (covered by wave.js), so it legitimately reports animation-name: none.
  const styles = media.filter(m => m !== 'wireless').map(m => {
    const l = state.links.find(x => x.medium === m);
    const cs = getComputedStyle(document.getElementById('ui-link-' + l.id));
    return `${m}: dash=[${cs.strokeDasharray}] ${cs.animationName} ${cs.animationDuration}`;
  });
  const durations = styles.map(s => s.match(/([\d.]+)s$/)[1]);
  ok('each cable medium has a distinct speed', new Set(durations).size === media.length - 1, durations.join(','));
  ok('animations are real CSS, not dead classes', styles.every(s => !/\bnone\b/.test(s)));
  styles.forEach(s => out.push('    ' + s));

  // ---- Interface rows stay readable in a 281px sidebar ----
  // This has broken twice: once when a cable indicator squeezed the name field to
  // nothing, once when a bond's mode dropdown squeezed the CIDR down to "10".
  // Both times a passing test suite said nothing and only a screenshot showed it.
  state.nodes = [normalizeLoadedNode({ id: 'b', type: 'server', name: 'Bonded', x: 0, y: 0,
    interfaces: [
      { id: 'i1', name: 'eno1', ip: '' },
      { id: 'i2', name: 'enp4s0', ip: '' },
      // 255.255.255.255/32 is the longest an IPv4 CIDR can get (18 chars). If the
      // worst case fits, every real address does.
      { id: 'i3', name: 'bond0', ip: '255.255.255.255/32', bond: { mode: '802.3ad', members: ['i1', 'i2'] } },
      { id: 'i4', name: 'wlp1s0', ip: '255.255.255.255/32' }
    ] })];
  state.links = [];
  select('b', 'node');
  // Measure a tick later, never in select()'s own tick. Tailwind's browser JIT
  // generates arbitrary values like w-[74px] only once it sees them in the DOM,
  // and until it does the input falls back to its ~170px default — which reads
  // as a squeezed layout that will not exist by the time anyone looks.
  setTimeout(() => {
  const rows = [...document.querySelectorAll('#ifaceListContainer input[type=text]')];
  const named = rows.filter(r => r.value === 'bond0' || r.value === 'eno1');
  ok('interface name fields are rendered', named.length === 2, rows.map(r => r.value).join('|'));
  named.forEach(r => ok(`${r.value} name field is wide enough to read`, r.getBoundingClientRect().width >= 40,
                        `${Math.round(r.getBoundingClientRect().width)}px`));
  // Ask the real question — is the text clipped? — rather than guess a pixel
  // threshold. A field can clear "wide enough" and still hide half an address,
  // and "192.168.1.70/24" clipped to "192.168.1.7" reads as a valid, different
  // address, which is worse than an obviously truncated one.
  const fits = (el) => el.scrollWidth <= el.clientWidth;
  const ipBoxes = rows.filter(r => r.value === '255.255.255.255/32');
  ok('both worst-case address fields are rendered', ipBoxes.length === 2, rows.map(r => r.value).join('|'));
  // The plain row carries more controls than the bond row (kind toggle, zone,
  // cable indicator), so it is the one that runs out of width first.
  ipBoxes.forEach((el, i) => ok(`the longest IPv4 CIDR is fully visible (field ${i + 1})`, fits(el),
    `${Math.round(el.clientWidth)}px available, needs ${el.scrollWidth}px`));
  // The mode select must not be sharing the address's line — that pairing is
  // what squeezed the CIDR down to "10" when bonds first landed.
  const modeSel = document.querySelector('#ifaceListContainer select');
  const bondIp = ipBoxes[0];
  ok('the bond mode is on its own line, not beside the address', !!modeSel && !!bondIp &&
     Math.abs(modeSel.getBoundingClientRect().top - bondIp.getBoundingClientRect().top) > 4,
     modeSel && bondIp ? `mode@${Math.round(modeSel.getBoundingClientRect().top)} ip@${Math.round(bondIp.getBoundingClientRect().top)}` : 'missing');

  // ---- Typing a two-digit port count must be possible ----
  // The field re-rendered the whole sidebar on every keystroke, which destroyed
  // the input being typed into: after "2" the element is detached, focus falls to
  // <body>, and the "4" of "24" never arrives.
  state.nodes = [normalizeLoadedNode({ id: 'sw', type: 'switch', name: 'Core', x: 0, y: 0, portCount: 8, interfaces: [] })];
  state.links = [];
  select('sw', 'node');
  const portInput = [...document.querySelectorAll('#ifaceListContainer input')]
    .find(el => el.value === '8' && el.type !== 'checkbox');
  ok('the port-count field is rendered', !!portInput, portInput ? portInput.value : 'missing');
  if (portInput) {
    // Type "2". The row is rebuilt, so the live field is a new element — what
    // matters is that focus follows it, not that the old object survives.
    portInput.focus();
    portInput.value = '2';
    portInput.dispatchEvent(new Event('input', { bubbles: true }));
    const live = document.getElementById('portCountInput');
    ok('focus follows the port-count field across its re-render',
       !!live && document.activeElement === live,
       `focus is on ${document.activeElement.tagName}${document.activeElement.id ? '#' + document.activeElement.id : ''}`);
    // Now the "4", into whatever is focused — as a keyboard would.
    if (live) {
      live.value = '24';
      live.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ok('so a two-digit port count can actually be typed', portCountOf(getNode('sw')) === 24,
       String(portCountOf(getNode('sw'))));
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
  }, 50);
}, 400); });
