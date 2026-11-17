// What if this fails? (js/whatif.js; docs/SCOPE.md step 9a, D438):
//   1. the walk, from the Internet cloud: a switch takes what hangs off it
//      and nothing beside it; an end device takes nothing; the cloud or the
//      only router takes everything; a cable is asked the same way;
//   2. ways round: two cables to the same switch, a ring, a second uplink;
//      one way round less and the same failure takes the devices;
//   3. a VM goes with its host, a VPN tunnel is no way round, a retired or
//      planned device is neither counted nor walked through;
//   4. no cloud drawn: the way to the router; no router either: cut off from
//      the rest, the largest piece left being the rest;
//   5. on the map: the thing asked about is marked, what goes dark is
//      dimmed with its cables, the bar says it in words with the devices by
//      group and "From the map, not a live test."; the button says Stop
//      asking; nothing is written to the document and there is no undo step;
//   6. it follows an edit, and ends with the selection, Esc, the button, the
//      bar's ✕ or the X key; it clears a trace's question; the button is
//      offered for a device and a cable and not for a note;
//   7. the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const L = (id, a, b, extra = {}) => Object.assign({ id, source: a, target: b }, extra);
  // net - rt - core - (acc1 - pc1, pc2) (acc2 - pc3) ; srv on core with a VM
  const site = (more = {}) => ({ v: DOC_VERSION,
    nodes: [N('net', 'cloud', { x: 400, y: 0 }), N('rt', 'router', { x: 400, y: 120 }), N('core', 'switch', { x: 400, y: 240, portCount: 8, interfaces: [] }),
      N('acc1', 'switch', { x: 200, y: 360, group: 'east', portCount: 8, interfaces: [] }), N('acc2', 'switch', { x: 600, y: 360, group: 'west', portCount: 8, interfaces: [] }),
      N('pc1', 'pc', { x: 100, y: 480, group: 'east' }), N('pc2', 'pc', { x: 300, y: 480, group: 'east' }), N('pc3', 'pc', { x: 600, y: 480, group: 'west' }),
      N('srv', 'server', { x: 800, y: 360 }), N('vm1', 'vm', { x: 800, y: 480, host: 'srv' })].concat(more.nodes || []),
    links: [L('l1', 'net', 'rt'), L('l2', 'rt', 'core'), L('l3', 'core', 'acc1'), L('l4', 'core', 'acc2'), L('l5', 'acc1', 'pc1'), L('l6', 'acc1', 'pc2'),
      L('l7', 'acc2', 'pc3'), L('l8', 'core', 'srv')].concat(more.links || []),
    groups: [{ id: 'east', name: 'East wing', kind: 'room' }, { id: 'west', name: 'West wing', kind: 'room' }] });
  const ask = (doc, type, id) => { const p = TopoWhatIf.plan(doc.nodes, doc.links, { type, id }); return [p.kind, [...p.dark].sort().join()].join(':'); };
  const open = (doc) => { replaceDocument(doc, { origin: 'file', docId: 'doc-whatif' }); renderCanvasOnly(); };
  const cls = (id) => el(id).getAttribute('class') || '';
  const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  try {
    setLocale('en');
    // ---- 1. The walk ----
    ok('an access switch takes what hangs off it', ask(site(), 'node', 'acc1') === 'internet:pc1,pc2', ask(site(), 'node', 'acc1'));
    ok('the core switch takes everything behind it, the VM with its host', ask(site(), 'node', 'core') === 'internet:acc1,acc2,pc1,pc2,pc3,srv,vm1', ask(site(), 'node', 'core'));
    ok('an end device takes nothing', ask(site(), 'node', 'pc1') === 'internet:');
    ok('the cloud takes everything', ask(site(), 'node', 'net') === 'internet:acc1,acc2,core,pc1,pc2,pc3,rt,srv,vm1', ask(site(), 'node', 'net'));
    ok('a cable is asked the same way', ask(site(), 'link', 'l3') === 'internet:acc1,pc1,pc2' && ask(site(), 'link', 'l5') === 'internet:pc1');

    // ---- 2. Ways round ----
    ok('a second cable to the same switch is a way round', ask(site({ links: [L('l3b', 'core', 'acc1')] }), 'link', 'l3') === 'internet:');
    const ring = site({ links: [L('lr', 'acc1', 'acc2')] });
    ok('a ring: one cable of it takes nothing', ask(ring, 'link', 'l3') === 'internet:' && ask(ring, 'link', 'l4') === 'internet:');
    ok('…a switch on it takes only its own devices', ask(ring, 'node', 'acc1') === 'internet:pc1,pc2');
    const two = site({ nodes: [N('lte', 'cloud', { x: 600, y: 0 })], links: [L('lu', 'lte', 'rt')] });
    ok('a second uplink: the first provider takes nothing', ask(two, 'node', 'net') === 'internet:' && ask(two, 'link', 'l1') === 'internet:');
    ok('…and the router still takes everything', ask(two, 'node', 'rt') === 'internet:acc1,acc2,core,pc1,pc2,pc3,srv,vm1', ask(two, 'node', 'rt'));

    // ---- 3. Hosts, tunnels, devices out of service ----
    ok('a VM goes with its host', ask(site(), 'node', 'srv') === 'internet:vm1');
    ok('…even cabled to something else', ask(site({ links: [L('lv', 'vm1', 'core', { attachment: 'bridged' })] }), 'node', 'srv') === 'internet:vm1');
    ok('a VPN tunnel is no way round', ask(site({ links: [L('lt', 'rt', 'acc1', { medium: 'vpn' })] }), 'link', 'l3') === 'internet:acc1,pc1,pc2');
    const retired = site({ links: [L('lr', 'acc1', 'acc2')] });
    retired.nodes.find((n) => n.id === 'acc2').status = 'retired';
    ok('a retired switch is no way round, and is not counted', ask(retired, 'link', 'l3') === 'internet:acc1,pc1,pc2', ask(retired, 'link', 'l3'));
    const planned = site(); planned.nodes.find((n) => n.id === 'pc2').status = 'planned';
    ok('a planned device is not counted', ask(planned, 'node', 'acc1') === 'internet:pc1');

    // ---- 4. No cloud, no router ----
    const noCloud = site(); noCloud.nodes = noCloud.nodes.filter((n) => n.id !== 'net'); noCloud.links = noCloud.links.filter((l) => l.id !== 'l1');
    ok('no cloud drawn: the way to the router', ask(noCloud, 'node', 'acc1') === 'router:pc1,pc2' && TopoWhatIf.plan(noCloud.nodes, noCloud.links, { type: 'node', id: 'acc1' }).where.id === 'rt');
    ok('…and the only router takes the rest apart', ask(noCloud, 'node', 'rt').startsWith('rest:'));
    const flat = { nodes: [N('s', 'switch', { portCount: 8, interfaces: [] }), N('a', 'pc'), N('b', 'pc'), N('c', 'pc'), N('h', 'switch', { portCount: 5, interfaces: [] })],
      links: [L('f1', 's', 'a'), L('f2', 's', 'b'), L('f3', 's', 'h'), L('f4', 'h', 'c')] };
    ok('no router: a cable cuts the smaller piece off from the rest', ask(flat, 'link', 'f3') === 'rest:c,h', ask(flat, 'link', 'f3'));
    ok('…and the switch in the middle leaves every piece but the largest', ask(flat, 'node', 's') === 'rest:a,b', ask(flat, 'node', 's'));

    // ---- 5. On the map ----
    open(site()); await tick();
    const saved = JSON.stringify(serializeDoc()), undoAt = _undoStack.length;
    select('acc1', 'node'); await tick();
    const btn = el('whatIfBtn');
    ok('a device selected offers the button', !btn.classList.contains('hidden') && btn.textContent === 'What if this fails?' && btn.getAttribute('aria-pressed') === 'false');
    btn.click(); await tick();
    ok('asked: the device is marked', /\bwi-failed\b/.test(cls('ui-node-acc1')));
    ok('…what goes dark is dimmed, the rest is not', /\bwi-dark\b/.test(cls('ui-node-pc1')) && /\bwi-dark\b/.test(cls('ui-node-pc2')) && !/\bwi-/.test(cls('ui-node-pc3')) && !/\bwi-/.test(cls('ui-node-core')));
    ok('…with its cables', el('ui-link-l5').classList.contains('wi-dark-link') && el('ui-link-l3').classList.contains('wi-dark-link') && !el('ui-link-l4').classList.contains('wi-dark-link'));
    const bar = el('whatIfBar');
    ok('the bar says it in words', !bar.hidden && /If ACC1 fails: 2 devices lose their way to the internet\./.test(bar.textContent), bar.textContent);
    ok('…the devices by group', /East wing: PC1, PC2/.test(bar.textContent));
    ok('…and that it is read off the map', /From the map, not a live test\./.test(bar.textContent));
    ok('the button says Stop asking', btn.textContent === 'Stop asking' && btn.getAttribute('aria-pressed') === 'true');
    ok('nothing is written, and there is no undo step', JSON.stringify(serializeDoc()) === saved && _undoStack.length === undoAt);

    // ---- 6. Following and ending ----
    batch(() => { state.links.push(bindLink({ id: 'lx', source: 'core', target: 'pc1' })); save(); renderCanvasOnly(); }); await tick();
    ok('an edit is followed: a second cable saves that device', !/\bwi-dark\b/.test(cls('ui-node-pc1')) && /\bwi-dark\b/.test(cls('ui-node-pc2')) && /1 device loses its way to the internet\./.test(bar.textContent), bar.textContent);
    select('pc3', 'node'); await tick();
    ok('another selection ends it', !TopoWhatIf.asked() && bar.hidden && !document.querySelector('.wi-failed, .wi-dark') && btn.textContent === 'What if this fails?');
    btn.click(); await tick();
    ok('an end device: nothing else is affected', /If PC3 fails: nothing else is affected\./.test(bar.textContent) && !document.querySelector('.wi-dark'), bar.textContent);
    btn.click(); await tick();
    ok('the button ends it', !TopoWhatIf.asked() && bar.hidden);
    select('l4', 'link'); await tick();
    ok('a cable selected offers the button', !btn.classList.contains('hidden'));
    key('x'); await tick();
    ok('the X key asks: the cable is marked and named', el('ui-link-l4').classList.contains('wi-failed-link') && /If the cable between CORE and ACC2 fails: 2 devices lose their way to the internet\./.test(bar.textContent), bar.textContent);
    bar.querySelector('[data-wi="close"]').click(); await tick();
    ok('the bar\'s ✕ ends it, the selection kept', !TopoWhatIf.asked() && bar.hidden && state.selectedId === 'l4');
    key('x'); await tick();
    key('Escape'); await tick();
    ok('Esc ends it', !TopoWhatIf.asked() && bar.hidden && state.selection.size === 0);
    ok('nothing selected: no button', btn.classList.contains('hidden'));
    batch(() => { state.annotations.push({ id: 'an1', kind: 'note', x: 50, y: 50, text: 'Note' }); save(); renderCanvasOnly(); });
    select('an1', 'annotation'); await tick();
    ok('a note: no button', btn.classList.contains('hidden'));
    ok('still nothing written by asking', _undoStack.length === undoAt + 2);

    // ---- 7. Translations ----
    const { has, locales } = window.CarinoI18N;
    const strings = ['What if this fails?', 'Stop asking', 'If {name} fails:', 'nothing else is affected.', '1 device is cut off from the rest.', '{n} devices are cut off from the rest.',
      '1 device loses its way to {where}.', '{n} devices lose their way to {where}.', 'the internet', 'the cable between {a} and {b}', 'What if the selected device or cable fails'];
    locales.forEach((loc) => ok(`${loc} carries the strings`, strings.every((s) => has(loc, s)), strings.filter((s) => !has(loc, s)).join(' | ')));
    setLocale('es'); select('acc1', 'node'); await tick();
    ok('the button follows the language', btn.textContent === '¿Y si esto falla?', btn.textContent);
    btn.click(); await tick();
    ok('…and so does the bar', /Si falla ACC1:/.test(bar.textContent), bar.textContent);
    select(null, null);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    try { setLocale('en'); } catch (e) { /* leave */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
