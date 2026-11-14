// "Does A reach B?" (docs/SCOPE.md D381-D387, step 8h; js/tracetarget.js):
//   1. the answer is the trace's own walk: it reaches through the shortest
//      path the walk found, with the VLANs it crosses ("VLAN 10 → 20 at
//      R1"); on every sample, for every pair it is asked, Trace and the
//      target agree;
//   2. it does not: where it stops, and the first reason the map records:
//      no cable, a retired device on the way, the target's Allowed ports, a
//      cable that does not carry the VLAN, no gateway, a router with no
//      subnet toward it, inbound through NAT, or "Nothing recorded explains
//      it";
//   3. On port and And back? (the way back differs behind NAT);
//   4. the gestures: right-click A then right-click B asks and files no
//      cable; right-click then left-click still files one; a third device
//      after the pair asks again, never re-arms; Trace to… then a click;
//      Esc and a click on empty map clear it; a read-only document arms the
//      target, never link mode; nothing is an undo step or stored;
//   5. Check now (D381): offered only when A is this PC, its answer beside
//      the map's; a device's Answer checks and its ping spec;
//   6. the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const el = (id) => document.getElementById(id);
  const TT = window.TopoTraceTarget;
  const CK = window.TopoChecks;
  const held = { vlan: state.settings.traceVlan };
  try {
    setLocale('en');
    const N = (id, type, ips, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0,
      interfaces: ips.map((ip, i) => ({ id: 'i' + (i + 1), name: 'eth' + i, ip })) }, extra);
    const net = () => ({
      v: DOC_VERSION,
      nodes: [
        N('isp', 'cloud', []),
        N('r1', 'router', ['203.0.113.2/30', '10.0.10.1/24', '10.0.20.1/24'], { nat: true }),
        N('sw1', 'switch', [], { portCount: 8, portAttrs: { p1: { vlan: 10 }, p2: { vlan: 10 }, p3: { vlan: 20 }, p4: { vlan: 20 }, p8: { tagged: '10,20' } } }),
        N('pc1', 'pc', ['10.0.10.5/24'], { gw: '10.0.10.1' }),
        N('nas', 'server', ['10.0.10.9/24'], { gw: '10.0.10.1', ports: '445, 443' }),
        N('pacs', 'server', ['10.0.20.7/24'], { gw: '10.0.20.1', ports: '104' }),
        N('cam', 'camera', ['10.0.20.8/24'], { gw: '10.0.20.1' }),
        N('lone', 'pc', ['10.0.10.30/24']),
        N('nogw', 'pc', ['10.0.10.40/24']),
        N('old', 'switch', [], { status: 'retired' }),
        N('far', 'pc', ['10.0.10.50/24'], { gw: '10.0.10.1' }),
        N('web', 'server', ['198.51.100.10/24'], { gw: '198.51.100.1' })
      ],
      links: [
        { id: 'l0', source: 'isp', target: 'r1', targetIface: 'i1' },
        { id: 'l1', source: 'r1', target: 'sw1', sourceIface: 'i2', targetIface: 'p8' },
        { id: 'l1b', source: 'r1', target: 'sw1', sourceIface: 'i3', targetIface: 'p7' },
        { id: 'l2', source: 'sw1', target: 'pc1', sourceIface: 'p1', targetIface: 'i1' },
        { id: 'l3', source: 'sw1', target: 'nas', sourceIface: 'p2', targetIface: 'i1' },
        { id: 'l4', source: 'sw1', target: 'pacs', sourceIface: 'p3', targetIface: 'i1' },
        { id: 'l5', source: 'sw1', target: 'cam', sourceIface: 'p4', targetIface: 'i1' },
        { id: 'l6', source: 'sw1', target: 'nogw', sourceIface: 'p5', targetIface: 'i1' },
        { id: 'l7', source: 'sw1', target: 'old' },
        { id: 'l8', source: 'old', target: 'far' },
        { id: 'l9', source: 'isp', target: 'web' }
      ]
    });
    replaceDocument(net());
    await tick();
    state.settings.traceVlan = true;
    const A = (a, b, p) => TT.answer(a, b, p);

    // ---- 1. It reaches ----
    const r1 = A('pc1', 'nas');
    ok('PC1 reaches NAS through SW1, VLAN 10', r1.reaches && show(r1.path.nodes) === '["pc1","sw1","nas"]' && r1.line === 'PC1 reaches NAS through SW1 · VLAN 10', r1.line);
    const r2 = A('pc1', 'pacs');
    ok('across the router: VLAN 10 → 20 at R1', r2.reaches && r2.path.nodes.includes('r1') && /VLAN 10 → 20 at R1/.test(r2.line), r2.line);
    // Trace and the target agree, on every sample.
    const bad = [];
    let asked = 0;
    const keys = TEMPLATE_META.map((m) => m.key).filter((k) => templatesData[k]);
    keys.forEach((k) => {
      replaceDocument(cloneData(templatesData[k]));
      const ids = state.nodes.map((n) => n.id);
      for (let i = 0; i < ids.length && i < 12; i++) {
        const reach = calculateReachability(ids[i], { port: '', vlan: true });
        for (let j = 0; j < ids.length && j < 12; j++) {
          if (i === j) continue;
          asked++;
          const ans = TT.answer(ids[i], ids[j], '');
          if (ans.reaches !== reach.reachableNodes.has(ids[j])) bad.push(`${k}: ${ids[i]}→${ids[j]}`);
          if (ans.reaches && (!ans.path || ans.path.nodes[0] !== ids[i] || ans.path.nodes[ans.path.nodes.length - 1] !== ids[j])) bad.push(`${k}: path ${ids[i]}→${ids[j]}`);
          if (!ans.reaches && !(ans.why && ans.why.text)) bad.push(`${k}: no reason ${ids[i]}→${ids[j]}`);
        }
      }
    });
    ok('every sample: Trace and the target agree, a path when it reaches, a reason when not', asked > 500 && !bad.length, `${asked} asked; ` + bad.slice(0, 4).join(' | '));
    replaceDocument(net());
    await tick();

    // ---- 2. It does not, and why ----
    const why = (a, b, p) => { const x = A(a, b, p); return x.reaches ? 'reaches' : x.why.key; };
    const whyText = (a, b, p) => { const x = A(a, b, p); return x.reaches ? 'it reaches: ' + x.line : x.why.text; };
    ok('no cable', why('pc1', 'lone') === 'no-cable' && /There is no cable between PC1 and LONE on the map\./.test(whyText('pc1', 'lone')));
    ok('a retired device on the way', why('pc1', 'far') === 'retired' && /OLD is retired: off the network\./.test(whyText('pc1', 'far')), whyText('pc1', 'far'));
    ok('the target\'s Allowed ports', why('pc1', 'nas', '22') === 'port' && /NAS does not list port 22 in its Allowed ports\./.test(whyText('pc1', 'nas', '22')));
    // Two hosts on one switch, one subnet, their ports on VLANs 10 and 30, no
    // router: the cable to the second does not carry VLAN 10.
    replaceDocument({ v: DOC_VERSION, nodes: [N('h1', 'pc', ['10.1.0.5/24']), N('h2', 'pc', ['10.1.0.6/24']),
      N('s', 'switch', [], { portCount: 4, portAttrs: { p1: { vlan: 10 }, p2: { vlan: 30 } } })],
      links: [{ id: 'a', source: 's', target: 'h1', sourceIface: 'p1', targetIface: 'i1' }, { id: 'b', source: 's', target: 'h2', sourceIface: 'p2', targetIface: 'i1' }] });
    const v = A('h1', 'h2');
    ok('a cable that does not carry the VLAN, in the VLAN path finding\'s words', !v.reaches && v.why.key === 'vlan' && /VLAN 10 stops at S · .* ↔ H2 · .*: it does not carry it\./.test(v.why.text), show(v.why || v.line));
    ok('…and with the VLAN tick off it reaches, as Trace does', (state.settings.traceVlan = false, A('h1', 'h2').reaches) && (state.settings.traceVlan = true));
    replaceDocument(net());
    await tick();
    ok('no gateway, the target on another subnet', why('nogw', 'pacs') === 'gateway' && /NOGW has no gateway, and PACS is on another subnet\./.test(whyText('nogw', 'pacs')), whyText('nogw', 'pacs'));
    const inbound = A('web', 'pc1');
    ok('inbound from outside: where it stops and the reason recorded, never a guess', !inbound.reaches && ['nat', 'route', 'none'].includes(inbound.why.key) && inbound.stopLine !== '', show([inbound.why, inbound.stopLine]));
    batch(() => { getNode('r1').interfaces = getNode('r1').interfaces.filter((i) => i.id !== 'i3'); save(); });
    const route = A('pc1', 'pacs');
    ok('a router with no subnet toward it, or nothing recorded: never a guess', !route.reaches && ['route', 'none', 'vlan'].includes(route.why.key) && !!route.why.text, show(route.why));
    undo(); await tick();

    // ---- 3. On port, and back ----
    ok('On port 104: PC1 reaches the PACS\'s DICOM', A('pc1', 'pacs', '104').reaches && /port 104/.test(A('pc1', 'pacs', '104').line));
    ok('…not on 443, which it does not list', !A('pc1', 'pacs', '443').reaches && A('pc1', 'pacs', '443').why.key === 'port');
    const out1 = A('pc1', 'web'), back1 = A('web', 'pc1');
    ok('the way back differs behind NAT: out yes, in no', out1.reaches && !back1.reaches, show([out1.line, back1.line]));

    // ---- 4. The gestures ----
    const node = (id) => el('ui-node-' + id);
    const ctx = (id) => node(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const click = (id) => node(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    renderCanvasOnly(); await tick();
    const before = JSON.stringify(serializeDoc());
    const links0 = state.links.length;
    ctx('pc1'); await tick();
    ok('a right-click arms link mode, as before', state.linkSourceId === 'pc1');
    ctx('nas'); await tick();
    ok('the second right-click asks "Does PC1 reach NAS?", files no cable', !state.linkSourceId && state.links.length === links0
      && TT.state.from === 'pc1' && TT.state.to === 'nas' && !el('traceTargetBar').hidden && /PC1 reaches NAS/.test(el('traceTargetBar').textContent));
    ok('…says it is the map\'s answer', /From the map, not a live test\./.test(el('traceTargetBar').textContent));
    ok('…lights its path and its ends', node('sw1').classList.contains('tt-path') && node('pc1').classList.contains('tt-end') && node('nas').classList.contains('tt-end')
      && document.querySelectorAll('.tt-path-link').length === 2);
    ok('nothing stored, no undo step', JSON.stringify(serializeDoc()) === before);
    ctx('cam'); await tick();
    ok('a right-click on a third device arms link mode from it (it does not re-ask)', state.linkSourceId === 'cam');
    ctx('pacs'); await tick();
    ok('…and the next right-click asks from there', TT.state.from === 'cam' && TT.state.to === 'pacs' && !state.linkSourceId);
    ctx('pc1'); await tick(); click('nas'); await tick();
    ok('a right-click then a left click still files the cable', state.links.length === links0 + 1);
    undo(); await tick();
    // And back?
    TT.ask('pc1', 'web'); await tick();
    el('traceTargetBar').querySelector('[data-tt="back"]').click(); await tick();
    ok('And back? shows both ways', el('traceTargetBar').querySelectorAll('.tt-line').length === 2 && /WEB does not reach PC1/.test(el('traceTargetBar').textContent));
    const port = el('ttPort'); port.value = '443'; port.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    ok('On port: the question asks it', TT.state.port === '443' && /port 443/.test(el('traceTargetBar').textContent));
    // Esc and the empty map clear it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    ok('Esc clears it', !TT.state.from && el('traceTargetBar').hidden && !document.querySelector('.tt-path-link'));
    // Trace to… then a click.
    select('pc1', 'node'); await tick();
    el('traceToBtn').click(); await tick();
    ok('Trace to… waits for the target, says so over the device as link mode does (D433)', TT.state.arm === 'pc1' && node('pc1').querySelector('.tt-hint')
      && node('pc1').querySelector('.tt-hint').textContent === 'TRACING TARGET...' && (matchMedia('(max-width: 900px)').matches ? !el('traceTargetBar').hidden && /Click or tap the device to ask whether PC1 reaches it\./.test(el('traceTargetBar').textContent) : el('traceTargetBar').hidden));
    click('pacs'); await tick();
    ok('…a click on it asks, files no cable', TT.state.from === 'pc1' && TT.state.to === 'pacs' && state.links.length === links0);
    TT.clear();
    // Right-click twice on the same device: tracing (D432).
    ctx('pc1'); await tick(); ctx('pc1'); await tick();
    ok('right-click twice: tracing, not link mode, TRACING TARGET... over it, no LINK TARGET..., no bar at this width', !state.linkSourceId && TT.state.arm === 'pc1'
      && node('pc1').querySelector('.tt-hint').textContent === 'TRACING TARGET...' && !/LINK TARGET/.test(node('pc1').textContent) && (matchMedia('(max-width: 900px)').matches ? !el('traceTargetBar').hidden && /Click or tap the device to ask whether PC1 reaches it\./.test(el('traceTargetBar').textContent) : el('traceTargetBar').hidden)
      && node('pc1').querySelector('rect').getAttribute('stroke') === '#0891b2', node('pc1').textContent);
    ok('…the device rings in the trace\'s own colour, the map is all targets', node('pc1').classList.contains('tt-arm') && !node('pc1').classList.contains('linking-glow')
      && node('nas').classList.contains('cursor-crosshair') && el('networkCanvas').classList.contains('tracing')
      && getComputedStyle(document.documentElement).getPropertyValue('--tt-hl').trim() !== getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    // A real press: mousedown first. It neither drags nor selects (whose
    // redraw used to swallow the click, D433).
    const sel0 = JSON.stringify([...state.selection]);
    node('nas').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }));
    await tick();
    ok('…the target\'s press selects nothing, moves nothing', JSON.stringify([...state.selection]) === sel0 && TT.state.arm === 'pc1');
    click('nas'); await tick();
    ok('…a left click asks, files no cable, lights the path and dims the rest', TT.state.from === 'pc1' && TT.state.to === 'nas' && state.links.length === links0
      && node('sw1').classList.contains('tt-path') && node('cam').classList.contains('tt-off') && !node('sw1').classList.contains('tt-off')
      && document.querySelectorAll('.tt-off-link').length > 0 && !el('networkCanvas').classList.contains('tracing'));
    TT.ask('web', 'pc1'); await tick();
    ok('…a path not found dims nothing', !TT.state.answer.reaches && !document.querySelector('#layer-nodes .tt-off') && !document.querySelector('.tt-off-link'));
    TT.clear();
    ctx('pc1'); await tick(); ctx('pc1'); await tick(); ctx('pc1'); await tick();
    ok('a third right-click ends tracing', !TT.state.arm && !state.linkSourceId && el('traceTargetBar').hidden && !node('pc1').classList.contains('tt-arm'));
    // Read only: the target, never link mode.
    state.readOnly = { doc: cloneData(serializeDoc()), loaded: JSON.stringify(serializeDoc()) };
    renderCanvasOnly(); await tick();
    ctx('pc1'); await tick();
    ok('read only: a right-click arms the target, not link mode', !state.linkSourceId && TT.state.arm === 'pc1');
    ctx('nas'); await tick();
    ok('…the second asks', TT.state.from === 'pc1' && TT.state.to === 'nas' && /PC1 reaches NAS/.test(el('traceTargetBar').textContent));
    state.readOnly = null;
    TT.clear();

    // ---- 5. Check now ----
    ok('no app: no Check now', (TT.ask('pc1', 'nas'), !el('traceTargetBar').querySelector('[data-tt="now"]')));
    const calls = [];
    TT.state.invoke = async (cmd, args) => { calls.push([cmd, args]); return { ok: true, rttMs: 3.2, status: 'echo' }; };
    CK.state.macs = new Set(['001122334455']);
    getNode('pc1').interfaces[0].mac = '00:11:22:33:44:55';
    TT.ask('pc1', 'nas'); await tick();
    const now = el('traceTargetBar').querySelector('[data-tt="now"]');
    ok('A is this PC: Check now is offered', !!now);
    await TT.checkNow();
    ok('…one question to B from this PC, its answer beside the map\'s', calls.length === 1 && calls[0][0] === 'check_now' && calls[0][1].spec.host === '10.0.10.9' && calls[0][1].spec.proto === 'ping'
      && /From this PC: answered in 3\.2 ms/.test(el('traceTargetBar').textContent) && /PC1 reaches NAS/.test(el('traceTargetBar').textContent), show(calls));
    TT.state.port = '445';
    ok('…on a port it asks that port over TCP', show(TT.checkNowSpec(getNode('nas'), '445')) === show({ proto: 'tcp', host: '10.0.10.9', port: 445 }));
    TT.state.port = '';
    TT.ask('nas', 'pc1'); await tick();
    ok('A is not this PC: no Check now', !el('traceTargetBar').querySelector('[data-tt="now"]'));
    TT.clear();
    const specs = CK.checkNowSpecs(getNode('nas'));
    ok('a device with no check: Check now is a ping, once', specs.length === 1 && specs[0].spec.proto === 'ping' && specs[0].spec.host === '10.0.10.9');
    getNode('nas').checks = [{ id: 'h', proto: 'https' }];
    ok('…with checks: each of them', CK.checkNowSpecs(getNode('nas'))[0].spec.proto === 'https' && CK.checkNowSpecs(getNode('nas'))[0].spec.port === 0);
    delete getNode('nas').checks;
    CK.state.macs = null;
    TT.state.invoke = null;

    // ---- 6. The strings ----
    const { has, locales } = window.CarinoI18N;
    const strs = ['{a} reaches {b} through {via}', '{a} reaches {b}', '{a} does not reach {b}', 'It stops at {name}.', 'port {port}', 'VLAN {vlan}', '→ {vlan} at {name}',
      'There is no cable between {a} and {b} on the map.', '{name} is retired: off the network.', '{name} does not list port {port} in its Allowed ports.',
      'VLAN {vlan} stops at {cable}: it does not carry it.', '{a} has no gateway, and {b} is on another subnet.',
      '{name} does NAT: the map records nothing that lets traffic in from outside.', '{name} has no subnet toward {b}.', 'Nothing recorded explains it.',
      'From the map, not a live test.', 'On port', 'any', 'And back?', 'Check now', 'Click or tap the device to ask whether {name} reaches it.',
      'From this PC: answered in {ms} ms, {time}', 'From this PC: no answer ({why}), {time}', 'From this PC: it cannot be asked ({why}).', 'From this PC: it could not be asked.',
      'From this PC: {name} has no address to ask.', 'Asking from this PC…', 'Trace to…', 'Select the device to start from first.', '+{n} more',
      'Once, from this PC: nothing is kept.', 'A ping, once, from this PC: nothing is kept.', 'Trace to… (does it reach a device?)',
      'Then click or tap the device to ask whether the selected one reaches it'];
    locales.forEach((loc) => { const missing = strs.filter((s) => !has(loc, s)); ok(`${loc} carries the strings`, !missing.length, missing.join(' | ')); });
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    state.settings.traceVlan = held.vlan;
    if (TT) { TT.state.invoke = null; TT.clear(); }
    if (CK) CK.state.macs = null;
    state.readOnly = null;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
