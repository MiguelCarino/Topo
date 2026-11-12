// @realtime @touch 360x740
// This computer (js/thiscomputer.js, the Import… review's openResult in
// js/importui.js; docs/SCOPE.md D166, D204-D208), against a stub of the
// app's `this_computer` command (desktop/src-tauri/src/thiscomputer.rs,
// which has its own cargo tests on the system's texts). Covered:
//   - on the website (no window.__TAURI__) the Nodes panel's button and the
//     Settings section stay hidden; in the app (a stub of
//     window.__TAURI__.core.invoke, no test hook) both show;
//   - what this PC reads becomes one device (PC, its name without the
//     domain, its system, its DNS servers), its network cards with one
//     address each (IPv4 first, else a stable IPv6; never a temporary or
//     link-local one), their MACs and Wi-Fi, and the subnets of those
//     addresses; loopback, virtual and unplugged interfaces left out (also
//     a card not connected that has only link-local addresses, D209);
//   - a DNS stub (127.0.0.53) or Windows' fec0:0:0:ffff:: placeholders are
//     never written as the PC's DNS servers (D210);
//   - the default gateway is never added (no device, no address, no gw
//     field): the review shows it as information, with the DNS servers,
//     the MTUs, the addresses not kept and what was left out;
//   - the tick "Also add the virtual interfaces" adds them and their subnets;
//   - the button opens the review at "What was understood", titled Add this
//     computer, with no Back; Continue goes through the merge review into the
//     open network, the log names it (in English whatever the language,
//     D212), one undo step takes each run back;
//   - a second run merges into the same device (found by its MAC): no second
//     PC, no second interface;
//   - Settings, Add this computer… closes Settings and opens the review;
//   - a refusal from the app is said in words;
//   - every sentence translated; Japanese says PC;
//   - the review at 360 and 390 (44px targets, 16px fields, no sideways
//     scroll); no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };
  const TC = window.TopoThisComputer, U = TopoImportUI, R = CarinoRestore, MU = TopoMergeUI, TM = TopoMerge;
  const heldDigest = TM.setDigest(async (text) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0').repeat(8);
  });
  const reviews = [];
  const heldMerge = MU.setMergeResponder((req) => { reviews.push(req); return {}; });
  setDialogResponder((q) => (q.kind === 'confirm' ? true : q.kind === 'choice' ? null : undefined));

  // What the app answers on a Linux desktop (thiscomputer.rs, read()).
  const PC = {
    hostname: 'conta-pc03.oficina.lan', os: 'Fedora Linux 44 (Workstation Edition)', platform: 'linux',
    interfaces: [
      { name: 'docker0', label: '', mac: '02:42:AC:11:00:01', mtu: 1500, up: true, loopback: false, physical: false, wireless: false, addresses: [{ ip: '172.17.0.1', prefix: 16, temporary: false }] },
      { name: 'enp3s0', label: '', mac: '3C:A9:F4:00:33:01', mtu: 1500, up: true, loopback: false, physical: true, wireless: false, addresses: [
        { ip: '192.168.50.33', prefix: 24, temporary: false }, { ip: '2001:db8:50::33', prefix: 64, temporary: false },
        { ip: '2001:db8:50:0:a1b2:c3d4:e5f6:718', prefix: 64, temporary: true }, { ip: 'fe80::3ea9:f4ff:fe00:3301', prefix: 64, temporary: false }] },
      { name: 'enp4s0', label: '', mac: '3C:A9:F4:00:33:02', mtu: 1500, up: false, loopback: false, physical: true, wireless: false, addresses: [] },
      // Switched on with no cable (NetworkManager keeps it IFF_UP; the app
      // says up only with IFF_RUNNING, D209): only its link-local address.
      { name: 'enp5s0', label: '', mac: '3C:A9:F4:00:33:03', mtu: 1500, up: false, loopback: false, physical: true, wireless: false, addresses: [{ ip: 'fe80::3ea9:f4ff:fe00:3303', prefix: 64, temporary: false }] },
      { name: 'lo', label: '', mac: '', mtu: 65536, up: true, loopback: true, physical: false, wireless: false, addresses: [{ ip: '127.0.0.1', prefix: 8, temporary: false }, { ip: '::1', prefix: 128, temporary: false }] },
      { name: 'wlp2s0', label: '', mac: '70:9C:D1:22:44:66', mtu: 1500, up: true, loopback: false, physical: true, wireless: true, addresses: [{ ip: '10.0.0.5', prefix: 24, temporary: false }] },
      { name: 'wg0', label: '', mac: '', mtu: 1420, up: true, loopback: false, physical: false, wireless: false, addresses: [{ ip: 'fd00:77::2', prefix: 64, temporary: false }] },
    ],
    gateways: [{ ip: '192.168.50.1', iface: 'enp3s0' }, { ip: 'fe80::1', iface: 'enp3s0' }],
    // A stub and Windows' placeholders are never written as the PC's DNS (D210).
    dns: ['192.168.50.1', '127.0.0.53', '1.1.1.1', 'fec0:0:0:ffff::1'],
  };
  let answer = clone(PC), refuse = null;
  const calls = [];
  const others = [];
  const invoke = async (cmd, args) => {
    // The other desktop sections (the server, the client) ask too once
    // window.__TAURI__ is there: they get no answer, and are not counted.
    if (cmd !== 'this_computer') { others.push(cmd); return null; }
    calls.push(cmd);
    await wait(5);
    if (refuse) throw refuse;
    return clone(answer);
  };
  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    await R.openRestoreStore({ open: async () => [], readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = []; }); return o; }, readDoc: async () => null, write: async () => true });

    // ---- The website ----
    ok('on the website there is no host', !window.__TAURI__ && !TC.hasHost());
    ok('…and no Add this computer in the Nodes panel', el('addThisPcBtn').classList.contains('hidden'));
    openSettings(); await settle();
    ok('…nor in Settings', el('setTcSec').hidden === true);
    closeSettings();
    ok('nothing was asked of an app', calls.length === 0);

    // ---- What is read becomes ----
    const r = TC.toResult(clone(PC));
    const d = r.doc;
    const n = d.nodes[0];
    ok('one device: this PC', d.nodes.length === 1 && n.type === 'pc', JSON.stringify(d.nodes.map((x) => x.name)));
    ok('named by its host name, without the domain', n.name === 'conta-pc03');
    ok('its system and its DNS servers', n.os === 'Fedora Linux 44 (Workstation Edition)' && n.dns === '192.168.50.1, 1.1.1.1', `${n.os} | ${n.dns}`);
    ok('the default gateway is not added: no gw field, no device, no address', !n.gw && !JSON.stringify(d).includes('192.168.50.1"') && !JSON.stringify(d).includes('fe80::1"')
      && !/"192\.168\.50\.1\//.test(JSON.stringify(d)), JSON.stringify(d).slice(0, 300));
    const ifs = n.interfaces;
    ok('the network cards that are connected: enp3s0 and wlp2s0', ifs.map((i) => i.name).join() === 'enp3s0,wlp2s0', ifs.map((i) => i.name).join());
    const e = ifs.find((i) => i.name === 'enp3s0'), w = ifs.find((i) => i.name === 'wlp2s0');
    ok('one address each, IPv4 first, with its prefix', e.ip === '192.168.50.33/24' && w.ip === '10.0.0.5/24');
    ok('their MACs; Wi-Fi said', e.mac === '3C:A9:F4:00:33:01' && w.mac === '70:9C:D1:22:44:66' && w.wireless === true && !e.wireless);
    ok('the subnets from address and prefix', d.networks.map((x) => x.cidr).sort().join() === '10.0.0.0/24,192.168.50.0/24', d.networks.map((x) => x.cidr).join());
    ok('loopback, virtual (docker0, wg0) and the unplugged cards left out', !ifs.some((i) => /^(lo|docker0|wg0|enp4s0|enp5s0)$/.test(i.name)));
    ok('counts: 1 device, 2 interfaces, 2 subnets', r.counts.devices === 1 && r.counts.interfaces === 2 && r.counts.subnets === 2, JSON.stringify(r.counts));
    ok('only transient ids', d.nodes.every((x) => /^imp-/.test(x.id)) && d.networks.every((x) => /^imp-/.test(x.id)));
    ok('a document the editor reads', isDocShape(d) && canonicalDoc(d).nodes.length === 1);
    const info = r.info.map((x) => U.issueText(x));
    ok('the gateway is shown as information', info.some((s) => s === 'Default gateway 192.168.50.1 (enp3s0): shown here only, it is not added.') && info.some((s) => /^Default gateway fe80::1 /.test(s)), info.join(' | '));
    ok('the gateways come first, in the order the PC lists them', r.info[0].code === 'tc-gateway' && r.info[0].params.address === '192.168.50.1' && r.info[1].params.address === 'fe80::1');
    const oneVirt = clone(PC); oneVirt.interfaces = oneVirt.interfaces.filter((i) => i.name !== 'wg0');
    ok('one virtual interface is said in the singular', TC.toResult(oneVirt).info.map((x) => U.issueText(x)).includes('A virtual interface left out: docker0.'));
    ok('the DNS servers and the MTUs too', info.includes('DNS servers: 192.168.50.1, 1.1.1.1.') && info.includes('enp3s0: MTU 1500.'));
    ok('the stable IPv6 not kept is said; the temporary and link-local ones are not', info.includes('enp3s0 also has 2001:db8:50::33/64: Topo keeps one address per interface, so these are not added.')
      && !info.some((s) => /a1b2|fe80::3ea9/.test(s)));
    ok('what was left out is said', info.includes('2 virtual interfaces left out: docker0, wg0.') && info.includes('Not connected, left out: enp4s0, enp5s0.'), info.join(' | '));
    ok('a card not connected with only a link-local address (a Windows 169.254 or fe80::) is left out too',
      TC.toResult({ hostname: 'x', interfaces: [{ name: 'eth0', label: 'Ethernet', mac: 'AA:BB:CC:00:11:24', up: false, physical: true, addresses: [{ ip: 'fe80::5', prefix: 64 }, { ip: '169.254.3.4', prefix: 16 }] }] })
        .info.some((x) => x.code === 'tc-down' && x.params.list === 'Ethernet'));
    const stubOnly = TC.toResult({ hostname: 'x', interfaces: [], dns: ['127.0.0.53', 'fec0:0:0:ffff::2', '::1'] });
    ok('only a stub or placeholders: no DNS server written, and said', !(stubOnly.doc.nodes[0] || {}).dns && stubOnly.info.some((x) => x.code === 'tc-no-dns'));
    const rv = r.rebuild({ virtual: true });
    ok('ticking virtual interfaces adds them and their subnets', rv.doc.nodes[0].interfaces.map((i) => i.name).join() === 'docker0,enp3s0,wlp2s0,wg0'
      && rv.doc.networks.map((x) => x.cidr).sort().join() === '10.0.0.0/24,172.17.0.0/16,192.168.50.0/24,fd00:77::/64' && rv.options[0].on, rv.doc.networks.map((x) => x.cidr).join());
    // An IPv6-only card, no gateway, no DNS, a Windows name.
    const v6 = TC.toResult({ hostname: 'LAB-07', os: 'Windows', interfaces: [{ name: '{4D36E972-E325}', label: 'Ethernet 2', mac: 'AA:BB:CC:00:11:22', mtu: 1500, up: true, physical: true, addresses: [
      { ip: 'fe80::1', prefix: 64 }, { ip: '2001:db8:9::7', prefix: 64, temporary: true }, { ip: '2001:db8:9::70', prefix: 64 }] }], gateways: [], dns: [] });
    ok('an IPv6-only card keeps its stable address and /64; the Windows name people see', v6.doc.nodes[0].interfaces[0].ip === '2001:db8:9::70/64' && v6.doc.nodes[0].interfaces[0].name === 'Ethernet 2'
      && v6.doc.networks[0].cidr === '2001:db8:9::/64', JSON.stringify(v6.doc.nodes[0].interfaces));
    ok('no gateway and no DNS are said, and no dns field', v6.info.some((x) => x.code === 'tc-no-gateway') && v6.info.some((x) => x.code === 'tc-no-dns') && !v6.doc.nodes[0].dns);
    ok('a link-local IPv4 address makes no subnet', (TC.toResult({ hostname: 'x', interfaces: [{ name: 'eth0', mac: 'AA:BB:CC:00:11:23', up: true, physical: true, addresses: [{ ip: '169.254.10.2', prefix: 16 }] }] }).doc.networks || []).length === 0);

    // ---- In the app ----
    // The app as the page meets it: window.__TAURI__.core.invoke (no test
    // hook), so the real host check and call are what run.
    window.__TAURI__ = { core: { invoke } };
    ok('in the app the host is found through window.__TAURI__', TC.state.invoke === null && TC.hasHost());
    TC.renderThisComputer();
    ok('in the app the Nodes panel offers Add this computer', !el('addThisPcBtn').classList.contains('hidden'));
    persistLibrary({ k1: { id: 'k1', name: 'Oficina', doc: clone(canonicalDoc(templatesData.house)), created: 1, updated: Date.now() - 1000 } });
    replaceDocument(libraryEntry('k1').doc, { libraryId: 'k1', origin: 'library' });
    const targetId = state.libraryId;
    const beforeNames = state.nodes.map((x) => x.name).sort().join();
    el('addThisPcBtn').click();
    ok('the button reads this PC and opens the review', await until(() => !el('importDialog').hidden) && calls.join() === 'this_computer');
    await settle();
    const st = U._state();
    ok('straight to What was understood, titled Add this computer, no Back', st.step === 2 && st.direct && el('importTitle').textContent === 'Add this computer'
      && el('importBackBtn').classList.contains('hidden') && el('importNextBtn').textContent === 'Continue' && !el('importNextBtn').disabled);
    const body = () => el('importBody').textContent;
    ok('the review says what, and the gateway only as information', /This computer/.test(body()) && /1\s*Devices/.test(body()) && /2\s*Interfaces/.test(body()) && /2\s*Subnets/.test(body())
      && /For information, not added/.test(body()) && /Default gateway 192\.168\.50\.1 \(enp3s0\): shown here only/.test(body()), body().slice(0, 400));
    ok('merge into the open network, chosen', el('importBody').querySelector('input[value="here"]').checked);
    for (const wd of [360, 390]) { await window.__viewport(wd, wd === 360 ? 740 : 844); await audit('Add this computer, the review'); }
    await window.__viewport(1280, 900); await settle();
    const tick = el('importBody').querySelector('[data-imp-opt]');
    ok('the virtual tick, off', !!tick && !tick.checked && /Also add the virtual interfaces \(2\)/.test(body()));
    tick.click(); await settle();
    ok('ticked: 4 interfaces and 4 subnets', /4\s*Interfaces/.test(body()) && /4\s*Subnets/.test(body()) && el('importBody').querySelector('[data-imp-opt]').checked);
    el('importBody').querySelector('[data-imp-opt]').click(); await settle();
    ok('unticked again: 2 and 2', /2\s*Interfaces/.test(body()) && /2\s*Subnets/.test(body()));

    reviews.length = 0;
    el('importNextBtn').click();
    ok('Continue: the merge review, named This computer', await until(() => reviews.length === 1) && /^This computer: conta-pc03$/.test(reviews[0].sourceText), reviews[0] && reviews[0].sourceText);
    await until(() => state.nodes.some((x) => x.name === 'conta-pc03'));
    await settle();
    const mine = () => state.nodes.filter((x) => x.name === 'conta-pc03');
    ok('merged into the open network: the PC, its interfaces, its subnets', state.libraryId === targetId && mine().length === 1 && mine()[0].interfaces.length === 2
      && state.networks.some((x) => x.cidr === '192.168.50.0/24') && state.networks.some((x) => x.cidr === '10.0.0.0/24'));
    ok('no transient id in the network', !/"imp-/.test(JSON.stringify(serializeDoc())));
    ok('the gateway is not a device of it', !state.nodes.some((x) => (x.interfaces || []).some((i) => /^192\.168\.50\.1\//.test(i.ip || ''))));
    flushAutosave();
    const log = (libraryEntry(targetId).doc.log || []).slice(-1)[0];
    ok('the log names This computer', !!log && /^This computer: conta-pc03$/.test(log.source), JSON.stringify(log));
    ok('the dialog closed and its title is back', el('importDialog').hidden && el('importTitle').textContent === 'Import from another tool');

    // ---- A second run (in Spanish: the stored label stays English, D212) ----
    const afterFirst = JSON.stringify(mine()[0]);
    const logsAfterFirst = (state.log || []).length;
    answer = clone(PC);
    answer.interfaces.find((i) => i.name === 'wlp2s0').addresses = [{ ip: '10.0.0.9', prefix: 24, temporary: false }];
    answer.dns = ['192.168.50.1'];
    reviews.length = 0;
    setLocale('es');
    await TC.addThisComputer();
    await settle();
    ok('the review heading is translated (Este equipo)', el('importBody').querySelector('.imp-res-head').textContent.trim().startsWith('Este equipo'), el('importBody').querySelector('.imp-res-head').textContent);
    el('importNextBtn').click();
    ok('a second run asks the review again', await until(() => reviews.length === 1));
    const plan = reviews[0].plan;
    ok('…which finds the PC already there by its MAC', plan.items.some((it) => it.kind === 'nodes' && it.mineId === mine()[0].id && it.matchedBy === 'mac'),
      JSON.stringify(plan.items.filter((it) => it.kind === 'nodes').map((it) => [it.mineId, it.matchedBy])));
    await settle(); flushAutosave();
    ok('…and merges: still one PC with two interfaces', mine().length === 1 && mine()[0].interfaces.length === 2, `${mine().length} ${mine()[0] && mine()[0].interfaces.length}`);
    ok('…and no second copy of its subnets', state.networks.filter((x) => x.cidr === '192.168.50.0/24').length === 1);
    const log2 = (libraryEntry(targetId).doc.log || []).slice(-1)[0];
    ok('in Spanish the log and the merge source still say This computer, in English', !!log2 && log2.source === 'This computer: conta-pc03' && reviews[0].sourceText === 'This computer: conta-pc03', JSON.stringify(log2));
    setLocale('en');
    ok('the second run is its own entry in the log', (state.log || []).length === logsAfterFirst + 1, `${logsAfterFirst} -> ${(state.log || []).length}`);
    undo(); flushAutosave();
    ok('one undo step takes back the second run only: the PC as the first run left it', mine().length === 1 && JSON.stringify(mine()[0]) === afterFirst
      && mine()[0].interfaces.some((i) => i.name === 'wlp2s0' && i.ip === '10.0.0.5/24') && (state.log || []).length === logsAfterFirst, JSON.stringify(mine()[0] && mine()[0].interfaces));
    undo(); flushAutosave();
    ok('a second undo step takes back the first run', state.nodes.map((x) => x.name).sort().join() === beforeNames && !mine().length);

    // ---- Settings ----
    openSettings(); await settle();
    ok('Settings shows This computer in the app', el('setTcSec').hidden === false);
    calls.length = 0;
    el('setTcAdd').click();
    ok('Add this computer… closes Settings and opens the review', await until(() => !el('importDialog').hidden) && !settingsOpen() && calls.join() === 'this_computer');
    U.closeImportDialog();

    // ---- A refusal ----
    refuse = 'getifaddrs: Permission denied';
    await TC.addThisComputer();
    ok('a refusal is said in words, and nothing opens', await until(() => /Topo could not read this computer: getifaddrs: Permission denied/.test(document.body.textContent)) && el('importDialog').hidden);
    refuse = null;

    // ---- Translated ----
    const strings = Object.values(U.INFO_TEXT).concat(['This computer', 'Also add the virtual interfaces ({n})', 'For information, not added', 'Add this computer', 'Add this computer…',
      '＋ Add this computer…', 'Topo could not read this computer: {error}',
      'Adds this PC to the open network: its name, its network cards with their addresses, and their subnets, read from this PC alone. Nothing is sent onto the network, the default gateway is only shown, and the review shows everything before it is kept.']);
    const missing = [];
    CarinoI18N.locales.filter((l) => l !== 'en').forEach((l) => strings.forEach((s) => { if (!CarinoI18N.has(l, s)) missing.push(`${l}: ${s.slice(0, 40)}`); }));
    ok('every sentence of This computer is translated', !missing.length, `${missing.length}: ${missing.slice(0, 3).join(' | ')}`);
    setLocale('es');
    ok('in Spanish', U.issueText({ code: 'tc-gateway', params: { address: '192.168.50.1', name: 'enp3s0' } }) === 'Puerta de enlace predeterminada 192.168.50.1 (enp3s0): solo se muestra aquí, no se agrega.');
    setLocale('ja');
    ok('Japanese says PC, never パソコン or コンピューター', strings.map((s) => t(s)).join('').match(/パソコン|コンピューター/) === null && /PC/.test(t('This computer')));
    setLocale('en');
    ok('no console error', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (err) {
    ok('the suite ran to the end', false, err && (err.stack || err.message));
  }
  delete window.__TAURI__;
  if (window.renderThisComputer) renderThisComputer();
  MU.setMergeResponder(heldMerge);
  TM.setDigest(heldDigest);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
