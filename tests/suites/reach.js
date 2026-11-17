// Reaching a device, its own picture, and a way out's part (js/reach.js,
// js/diagnostics.js uplinkFindings; docs/SCOPE.md steps 9e, 9f and 9g; D442,
// D443, D446):
//   1. the address of a way in: web (http or https, the port left out when
//      it is the kind's own, a path), ssh and telnet with a user name, vnc,
//      an IPv6 address in brackets; RDP is a file, with no password in it;
//      a device with no address has none;
//   2. the buttons: one per way in, a link for each but RDP (a button that
//      downloads), disabled with the reason when the device has no address,
//      shown in the Simple view too; none when there is no way in;
//   3. the list: Add a way in offers the next kind, a kind, a port, https, a
//      path and a user name are edited, a way is removed, each one undo
//      step; what the format refuses is not kept; at most eight;
//   4. its own picture: kept on the device and drawn on the map as an image
//      in place of the glyph, Remove puts the glyph back, one undo step
//      each; a picture the format refuses is refused in words, and so is one
//      more than the network may carry; an export holds the picture;
//   5. a way out: offered on a link into a cloud (not one that stands for
//      another site, not a link that carries no IP), Primary and Back-up are
//      kept, a back-up is drawn broken; a router whose one way out is marked
//      is told so as advice that counts nowhere (unmarked, nothing is said),
//      two ways out say nothing, a back-up
//      marked with no primary is said; What if this fails? treats a second
//      line as a way round;
//   5b. the programs a way in needs (D450-D452): on the website one link
//      under the buttons to software.carino.systems searched for them, none
//      for a web page alone, the CSP unchanged; in the desktop app (its
//      commands stood in for) the programs are asked for once, a kind with
//      none links to the catalogue searched for it, the others are buttons
//      that name the program and hand the app only the kind, address, port
//      and user name, a refusal is said in words;
//   6. the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const show = (v) => JSON.stringify(v);
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false, ports: '80',
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const site = () => ({ v: DOC_VERSION,
    nodes: [N('net', 'cloud', { x: 300, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '203.0.113.1/30' }] }), N('lte', 'cloud', { x: 500, y: 0 }), N('hq', 'cloud', { x: 100, y: 0, siteRef: { id: 'other-site', name: 'Head office' } }),
      N('rt', 'router', { x: 300, y: 120, nat: true, interfaces: [{ id: 'i1', name: 'eth0', ip: '203.0.113.2/30' }, { id: 'i2', name: 'eth1', ip: '192.168.1.1/24' }] }),
      N('sw', 'switch', { x: 300, y: 240, portCount: 8, interfaces: [] }),
      N('nas', 'server', { x: 150, y: 360, interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.10/24' }] }),
      N('v6', 'server', { x: 300, y: 360, interfaces: [{ id: 'i1', name: 'eth0', ip: '2001:db8::10/64' }] }), N('bare', 'pc', { x: 450, y: 360 })],
    links: [{ id: 'l1', source: 'net', target: 'rt' }, { id: 'l2', source: 'rt', target: 'sw' }, { id: 'l3', source: 'sw', target: 'nas' }, { id: 'l4', source: 'sw', target: 'v6' }, { id: 'l5', source: 'sw', target: 'bare' }] });
  const open = (doc) => { replaceDocument(doc, { origin: 'file', docId: 'doc-reach' }); autoBindLinks(); renderCanvasOnly(); };
  const R = window.TopoReach;
  const type = (input, value) => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); };
  const uplinkOf = () => currentDiagnosis().findings.filter((f) => f.key === 'uplink');
  try {
    setLocale('en');
    open(site()); await tick();
    const nas = () => getNode('nas');
    // ---- 1. The address of a way in ----
    ok('web: http, the port left out when it is 80', R.url(nas(), { kind: 'web' }) === 'http://192.168.1.10/' && R.url(nas(), { kind: 'web', port: 80 }) === 'http://192.168.1.10/');
    ok('web: https, another port, a path', R.url(nas(), { kind: 'web', tls: true, port: 8443, path: '/admin' }) === 'https://192.168.1.10:8443/admin' && R.url(nas(), { kind: 'web', tls: true, port: 443 }) === 'https://192.168.1.10/');
    ok('ssh and telnet take a user name, vnc none', R.url(nas(), { kind: 'ssh', user: 'admin' }) === 'ssh://admin@192.168.1.10' && R.url(nas(), { kind: 'ssh', port: 2222 }) === 'ssh://192.168.1.10:2222'
      && R.url(nas(), { kind: 'telnet', user: 'op' }) === 'telnet://op@192.168.1.10' && R.url(nas(), { kind: 'vnc', user: 'x', port: 5901 }) === 'vnc://192.168.1.10:5901');
    ok('an IPv6 address goes in brackets', R.url(getNode('v6'), { kind: 'ssh' }) === 'ssh://[2001:db8::10]' && R.url(getNode('v6'), { kind: 'web', port: 8080 }) === 'http://[2001:db8::10]:8080/');
    const rdp = R.rdpFile(nas(), { kind: 'rdp', user: 'Admin', port: 3390 });
    ok('RDP is a file: the address, the user name, and it asks for the password', R.url(nas(), { kind: 'rdp' }) === null && /^full address:s:192\.168\.1\.10:3390\r\nusername:s:Admin\r\nprompt for credentials:i:1\r\n$/.test(rdp) && !/password/i.test(rdp), show(rdp));
    ok('a device with no address has none', R.url(getNode('bare'), { kind: 'ssh' }) === null && R.rdpFile(getNode('bare'), { kind: 'rdp' }) === null && R.address(getNode('bare')) === '');

    // ---- 2. The buttons ----
    select('nas', 'node'); await tick();
    ok('no way in: no button', el('reachRow').classList.contains('hidden') && el('reachRow').children.length === 0);
    batch(() => { nas().access = [{ kind: 'web', tls: true }, { kind: 'ssh', user: 'admin' }, { kind: 'rdp' }]; save(); renderCanvasOnly(); });
    select('nas', 'node'); await tick();
    const btns = [...el('reachRow').children];
    ok('one button per way in', !el('reachRow').classList.contains('hidden') && btns.length === 3 && btns.map((b) => b.dataset.kind).join() === 'web,ssh,rdp');
    ok('web and ssh are links to the address', btns[0].tagName === 'A' && btns[0].getAttribute('href') === 'https://192.168.1.10/' && btns[0].target === '_blank' && /noopener/.test(btns[0].rel)
      && btns[1].tagName === 'A' && btns[1].getAttribute('href') === 'ssh://admin@192.168.1.10' && /SSH ↗ \(admin\)/.test(btns[1].textContent));
    ok('RDP is a button that downloads', btns[2].tagName === 'BUTTON' && /Remote Desktop/.test(btns[2].textContent) && /192\.168\.1\.10/.test(btns[2].title));
    batch(() => { getNode('bare').access = [{ kind: 'ssh' }]; save(); renderCanvasOnly(); });
    select('bare', 'node'); await tick();
    ok('no address: the button is off and says why', el('reachRow').children.length === 1 && el('reachRow').children[0].disabled === true && /no address yet/.test(el('reachRow').children[0].title));

    // ---- 3. The list ----
    select('v6', 'node'); await tick();
    let undoAt = _undoStack.length;
    el('reachAddBtn').click(); await tick();
    ok('Add a way in: a web page first, one undo step', show(getNode('v6').access) === '[{"kind":"web"}]' && _undoStack.length === undoAt + 1 && el('reachList').children.length === 1);
    el('reachAddBtn').click(); await tick();
    ok('…then the next kind it has none of', show(getNode('v6').access) === '[{"kind":"web"},{"kind":"ssh"}]');
    const row = (i) => el('reachList').children[i];
    row(0).querySelector('.reach-tls input').click(); await tick();
    type(row(0).querySelector('.reach-port'), '8443'); await tick();
    type(row(0).querySelector('.reach-path'), '/ui'); await tick();
    ok('https, a port and a path are kept', show(getNode('v6').access[0]) === '{"kind":"web","port":8443,"tls":true,"path":"/ui"}', show(getNode('v6').access[0]));
    type(row(1).querySelector('.reach-user'), 'root'); await tick();
    ok('a user name is kept', show(getNode('v6').access[1]) === '{"kind":"ssh","user":"root"}');
    type(row(1).querySelector('.reach-user'), 'root:hunter2'); await tick();
    type(row(1).querySelector('.reach-port'), '99999'); await tick();
    ok('what the format refuses is not kept', show(getNode('v6').access[1]) === '{"kind":"ssh"}', show(getNode('v6').access[1]));
    const kind = row(1).querySelector('.reach-kind');
    kind.value = 'vnc'; kind.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    ok('the kind is changed; VNC asks for no user name', getNode('v6').access[1].kind === 'vnc' && !row(1).querySelector('.reach-user'));
    ok('the summary and the buttons follow', /Web, VNC/.test(el('reachSummary').textContent) && el('reachRow').children.length === 2 && el('reachRow').children[0].getAttribute('href') === 'https://[2001:db8::10]:8443/ui');
    undoAt = _undoStack.length;
    row(0).querySelector('.reach-x').click(); await tick();
    ok('a way is removed, one undo step', show(getNode('v6').access) === '[{"kind":"vnc"}]' && _undoStack.length === undoAt + 1);
    row(0).querySelector('.reach-x').click(); await tick();
    ok('the last one removed leaves no key', !('access' in getNode('v6')) && el('reachRow').classList.contains('hidden'));
    for (let i = 0; i < 9; i++) { el('reachAddBtn').click(); await tick(); }
    ok('at most eight, and Add is then off', getNode('v6').access.length === 8 && el('reachAddBtn').disabled === true);

    // ---- 4. Its own picture ----
    select('nas', 'node'); await tick();
    undoAt = _undoStack.length;
    ok('before: the glyph, no picture', !el('ui-node-nas').querySelector('image') && el('ownIconPic').hidden && el('ownIconClear').classList.contains('hidden') && /Choose a picture/.test(el('ownIconPick').textContent));
    ok('a picture is kept', R.setIcon(nas(), PNG) === true && nas().icon === PNG && _undoStack.length === undoAt + 1);
    await tick();
    const image = el('ui-node-nas').querySelector('image.own-icon-img');
    ok('…and drawn on the map as an image in place of the glyph', !!image && image.getAttribute('href') === PNG && !el('ui-node-nas').querySelector('svg') && !!el('ui-node-sw').querySelector('svg'));
    ok('…and shown in the panel, with Remove', !el('ownIconPic').hidden && el('ownIconPic').getAttribute('src') === PNG && !el('ownIconClear').classList.contains('hidden') && /Change picture/.test(el('ownIconPick').textContent));
    ok('an export holds the picture', canvasSvgMarkup(1).markup.includes(PNG));
    ok('a picture the format refuses is refused in words', R.setIcon(nas(), '<svg onload="x()"/>') === false && nas().icon === PNG && /could not be used/.test(el('topoToast').textContent));
    const big = 'data:image/png;base64,' + 'A'.repeat(32000);
    state.nodes.forEach((n, i) => { if (n.id !== 'nas') n.icon = big; });
    for (let i = 0; i < 40; i++) state.nodes.push(N('pad' + i, 'pc', { icon: big }));
    ok('one more than the network may carry is refused', R.setIcon(nas(), big) === false && /as many pictures as it can carry/.test(el('topoToast').textContent), String(state.nodes.length));
    state.nodes = state.nodes.filter((n) => !/^pad/.test(n.id)); state.nodes.forEach((n) => { if (n.id !== 'nas') delete n.icon; });
    undoAt = _undoStack.length;
    el('ownIconClear').click(); await tick();
    ok('Remove puts the glyph back, one undo step', !('icon' in nas()) && !el('ui-node-nas').querySelector('image') && !!el('ui-node-nas').querySelector('svg') && _undoStack.length === undoAt + 1);

    // ---- 5. A way out ----
    open(site()); await tick();
    select('l1', 'link'); await tick();
    ok('a link into a cloud is offered Way out', !el('linkUplinkProps').classList.contains('hidden') && el('propUplink').value === '' && el('propUplink').options.length === 3);
    select('l2', 'link'); await tick();
    ok('a link between our own devices is not', el('linkUplinkProps').classList.contains('hidden'));
    select('rt', 'node'); await tick();
    ok('nor a device', el('linkUplinkProps').classList.contains('hidden'));
    ok('one way out that nobody marked says nothing', uplinkOf().length === 0);
    batch(() => { getLink('l1').uplink = 'primary'; save(); renderCanvasOnly(); });
    let ups = uplinkOf();
    ok('one way out, marked: the router is told, naming the line', ups.length === 1 && ups[0].level === 'info' && show(ups[0].nodeIds) === '["rt"]' && /One way out to the internet\. Nothing takes over if NET stops\./.test(ups[0].detail), show(ups));
    ok('…as advice that counts nowhere', isCountedFinding(ups[0]) === false);
    batch(() => { state.links.push(bindLink({ id: 'ls', source: 'hq', target: 'rt' })); save(); renderCanvasOnly(); });
    ok('a cloud that stands for another site is no second line', uplinkOf().length === 1);
    batch(() => { delete getLink('l1').uplink; save(); renderCanvasOnly(); });
    select('ls', 'link'); await tick();
    ok('…and its link is not offered Way out', el('linkUplinkProps').classList.contains('hidden'));
    batch(() => { state.links.push(bindLink({ id: 'lu', source: 'lte', target: 'rt' })); save(); renderCanvasOnly(); });
    ok('two ways out say nothing', uplinkOf().length === 0);
    select('lu', 'link'); await tick();
    const undo0 = _undoStack.length;
    el('propUplink').value = 'backup'; el('propUplink').dispatchEvent(new Event('change', { bubbles: true })); await tick();
    ok('Back-up is kept, one undo step', getLink('lu').uplink === 'backup' && _undoStack.length === undo0 + 1);
    select(null, null); await tick();
    ok('…and drawn broken', el('ui-link-lu').getAttribute('stroke-dasharray') === '12 5 3 5' && el('ui-link-lu').classList.contains('uplink-backup') && el('ui-link-l1').getAttribute('stroke-dasharray') !== '12 5 3 5');
    ups = uplinkOf();
    ok('a back-up with no primary is said', ups.length === 1 && /no primary one/.test(ups[0].detail), show(ups.map((f) => f.detail)));
    select('l1', 'link'); await tick();
    el('propUplink').value = 'primary'; el('propUplink').dispatchEvent(new Event('change', { bubbles: true })); await tick();
    ok('Primary on the other: nothing more to say', getLink('l1').uplink === 'primary' && uplinkOf().length === 0);
    el('propUplink').value = ''; el('propUplink').dispatchEvent(new Event('change', { bubbles: true })); await tick();
    ok('Not said leaves no key', !('uplink' in getLink('l1')));
    const dark = (id) => [...TopoWhatIf.plan(state.nodes, state.links, { type: 'link', id }).dark].length;
    ok('What if this fails? treats the second line as a way round', dark('l1') === 0 && dark('lu') === 0);
    batch(() => { getLink('lu').medium = 'vpn'; getLink('l1').uplink = 'primary'; save(); renderCanvasOnly(); });
    ok('a VPN tunnel is no second line', uplinkOf().length === 1 && /One way out/.test(uplinkOf()[0].detail));

    // ---- 5b. The programs a way in needs ----
    const rowKinds = () => [...el('reachRow').children].map((b) => `${b.dataset.kind}${b.dataset.missing ? '!' : ''}`).join();
    open(site()); await tick();
    batch(() => { R.setWays(nas(), [{ kind: 'web' }]); save(); }); select('nas', 'node'); await tick();
    ok('only a web page: no link to programs', !!el('reachNeed') && el('reachNeed').classList.contains('hidden'));
    batch(() => { R.setWays(nas(), [{ kind: 'web' }, { kind: 'ssh', user: 'admin', port: 2222 }, { kind: 'rdp', user: 'Admin' }, { kind: 'vnc' }, { kind: 'telnet' }]); save(); }); select('nas', 'node'); await tick();
    const need = el('reachNeed');
    ok('on the website one link under the buttons opens the catalogue searched for them', !need.classList.contains('hidden') && need.getAttribute('href') === 'https://software.carino.systems/?search=remote-access'
      && need.target === '_blank' && /noopener/.test(need.rel) && need.previousElementSibling === el('reachRow') && /contacts nothing/.test(need.title), need.getAttribute('href'));
    ok('…and the buttons are the links they were', rowKinds() === 'web,ssh,rdp,vnc,telnet' && el('reachRow').children[1].getAttribute('href') === 'ssh://admin@192.168.1.10:2222');
    ok('the catalogue link by kind', R.programsLink('vnc') === 'https://software.carino.systems/?search=vnc-client' && R.programsLink('') === 'https://software.carino.systems/?search=remote-access');
    ok('the page may contact nothing new', !/software\.carino\.systems/.test(document.querySelector('meta[http-equiv="Content-Security-Policy"]').content));
    // The desktop app, stood in for: it looks, starts, and says what is missing.
    const calls = [];
    let fail = '';
    R._forget();
    R._host.invoke = async (cmd, args) => { calls.push([cmd, args]); if (cmd === 'reach_clients') return { ssh: 'OpenSSH', rdp: 'Remmina', vnc: null, telnet: null }; if (fail) throw fail; return 'OpenSSH'; };
    try {
      select(null, null); select('nas', 'node'); await tick(); await tick();
      ok('in the app the programs are asked for once', calls.filter((c) => c[0] === 'reach_clients').length === 1);
      ok('…no link under the row, and a kind with no program says so', el('reachNeed').classList.contains('hidden') && rowKinds() === 'web,ssh,rdp,vnc!,telnet!', rowKinds());
      const kids = [...el('reachRow').children];
      ok('…a missing kind links to the catalogue searched for it', kids[3].getAttribute('href') === 'https://software.carino.systems/?search=vnc-client' && kids[4].getAttribute('href') === 'https://software.carino.systems/?search=telnet-client'
        && /VNC: get a program/.test(kids[3].textContent) && kids[3].target === '_blank');
      ok('the web page is still a link', kids[0].tagName === 'A' && kids[0].getAttribute('href') === 'http://192.168.1.10/');
      ok('SSH and Remote Desktop are buttons that name the program', kids[1].tagName === 'BUTTON' && /in OpenSSH/.test(kids[1].title) && kids[2].tagName === 'BUTTON' && /in Remmina/.test(kids[2].title) && !/⭳/.test(kids[2].textContent));
      kids[1].click(); await tick();
      const sent = calls[calls.length - 1];
      ok('a click hands the app the kind, address, port and user name, and nothing else', sent[0] === 'reach_open' && show(sent[1]) === '{"kind":"ssh","host":"192.168.1.10","port":2222,"user":"admin"}', show(sent));
      el('reachRow').children[2].click(); await tick();
      ok('…Remote Desktop with its own port left to the app', show(calls[calls.length - 1][1]) === '{"kind":"rdp","host":"192.168.1.10","port":null,"user":"Admin"}', show(calls[calls.length - 1][1]));
      fail = 'no-terminal';
      ok('a refusal is said in words', (await R.openInApp(nas(), { kind: 'ssh' })) === false && /No terminal was found/.test(document.body.textContent));
      select(null, null); select('nas', 'node'); await tick();
      ok('…and the programs are not asked for again', calls.filter((c) => c[0] === 'reach_clients').length === 1);
      R._forget(); R._host.invoke = async (cmd) => { if (cmd === 'reach_clients') throw new Error('old app'); return ''; };
      select(null, null); select('nas', 'node'); await tick(); await tick();
      ok('an app that cannot say what it has still offers every button', rowKinds() === 'web,ssh,rdp,vnc,telnet' && el('reachRow').children[3].tagName === 'BUTTON');
    } finally { R._host.invoke = null; R._forget(); }
    select(null, null); select('nas', 'node'); await tick();
    ok('back on the website the link returns', !el('reachNeed').classList.contains('hidden') && el('reachRow').children[1].tagName === 'A');

    // ---- 6. Translations ----
    const { has, locales } = window.CarinoI18N;
    const strings = ['Reach it', '+ Add a way in', 'Opens your own program at this device\'s address. Topo keeps no password and no key.', 'Remove', 'Choose a picture…', 'Change picture…', 'Not said', 'Primary', 'Back-up',
      'What the router is set to do. Topo fails nothing over.', 'Open web page ↗', 'Remote Desktop ⭳', 'Web page', 'Remote Desktop (RDP)', 'Path', 'User name', 'user name', 'This device has no address yet.',
      'Downloads a .rdp file for {address}. Your Remote Desktop client asks for the password.', 'That picture could not be used. Choose an SVG, PNG, WebP or JPEG.',
      'This network already holds as many pictures as it can carry in a link. Remove one first.', 'One way out to the internet. Nothing takes over if {name} stops.',
      'A back-up way out is marked, but no primary one. Mark the line the router uses first.', 'Way out', 'Own icon', 'Need a program for these? ↗', 'Opens software.carino.systems with programs for SSH, Remote Desktop, VNC and Telnet. Topo itself contacts nothing.', '{kind}: get a program ↗',
      'No program for this was found on this computer. Opens software.carino.systems with the ones that do it.', 'Opens {address} in {program}. It asks for the password itself.', 'That address, port or user name cannot be handed to a program.',
      'No program for this was found on this computer.', 'No terminal was found on this computer to open it in.', 'The program could not be started.'];
    locales.forEach((loc) => ok(`${loc} carries the strings`, strings.every((s) => has(loc, s)), strings.filter((s) => !has(loc, s)).join(' | ')));
    select(null, null);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
