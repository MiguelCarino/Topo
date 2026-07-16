window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  loadTemplateState(templatesData.showcase); autoBindLinks(); renderCanvasOnly();

  const media = new Set(state.links.map(l => effectiveMedium(l)));
  ok('showcase demonstrates all 5 media', ['utp','fiber','wireless','powerline','vpn'].every(m => media.has(m)), [...media].join(', '));

  const att = new Set(state.links.map(l => l.attachment).filter(Boolean));
  ok('shows both VM attachment kinds', att.has('bridged') && att.has('passthrough'), [...att].join(', '));

  // Parallel links (the LAG) must be bowed apart and on separate ports.
  const lag = state.links.filter(l => (l.source === 'fw' && l.target === 'l3') || (l.source === 'l3' && l.target === 'fw'));
  ok('has a redundant LAG', lag.length === 2, lag.length + ' links fw<->l3');
  ok('LAG links are drawn apart, not stacked', lag.every(l => linkGeometry(l).bow !== 0), lag.map(l => linkGeometry(l).bow).join('/'));
  // Both cables land on the core's one L3 interface, and that is honest: without bond
  // modelling a LAG is exactly "two cables into one gateway interface". The routing-device
  // exemption is what stops it being flagged.
  ok('the redundant pair is not flagged as a fault', !nodeSeverity(getNode('l3')) && !nodeSeverity(getNode('fw')),
     `l3=${nodeSeverity(getNode('l3'))} fw=${nodeSeverity(getNode('fw'))}`);

  const grids = state.nodes.filter(hasPortGrid);
  ok('switches declare faceplates', grids.every(n => Number.isFinite(n.portCount) || n.type === 'ap'),
     grids.map(n => `${n.name}:${portCountOf(n)}`).join(', '));

  // Legit multi-homing (the contrast to the errors template).
  const as = getNode('as');
  ok('App Server is legitimately dual-homed', evaluateMultiHoming(as).level === 'good', evaluateMultiHoming(as).text);
  ok('its passthrough NIC is separate from its data NICs',
     state.links.find(l => l.attachment === 'passthrough' && l.source === 'as').sourceIface === 'a3');

  // Wireless clients on radios.
  const wlinks = state.links.filter(l => effectiveMedium(l) === 'wireless');
  ok('every wireless link runs radio-to-radio', wlinks.every(l =>
      ifaceIsWireless(ifaceOn(getNode(l.source), l.sourceIface)) && ifaceIsWireless(ifaceOn(getNode(l.target), l.targetIface))),
     wlinks.length + ' associations');

  // Every palette type still represented.
  const types = new Set(state.nodes.map(n => n.type));
  const missing = paletteDefs.map(p => p.type).filter(t => !types.has(t));
  ok('still covers every node type', missing.length === 0, missing.join(',') || 'all present');

  const alerts = [...document.querySelectorAll('#conflictMsgList li')].map(li => li.textContent);
  ok('the showcase itself is clean', alerts.length === 0, alerts.slice(0,3).join(' | '));
  ok('no node is badged', state.nodes.filter(n => nodeSeverity(n)).length === 0,
     state.nodes.filter(n => nodeSeverity(n)).map(n => n.name + ':' + nodeSeverity(n)).join(', '));

  // The NAS demonstrates the bond. It is the same two-NICs-one-subnet-one-switch
  // shape as the flapping PACS server in Common Errors, so it is only clean if
  // the bond is really modelled rather than drawn.
  const nas = getNode('nas');
  const nasBond = (nas.interfaces || []).find(isBond);
  ok('the NAS is bonded', !!nasBond, (nas.interfaces || []).map(i => i.name).join(','));
  ok('its bond holds the address', nasBond && nasBond.ip === '10.31.0.10/24', nasBond && nasBond.ip);
  ok('its members hold none', (nas.interfaces || []).filter(i => !isBond(i)).every(i => !i.ip));
  ok('two cables reach it, one per member', state.links.filter(l => l.source === 'nas' || l.target === 'nas').length === 2);
  ok('the bond reads healthy', evaluateBond(nas).level === 'good', evaluateBond(nas).text.slice(0, 60));
  // Same two NICs, same subnet, unbonded: the contrast the template is making.
  ok('while the unbonded PACS in Common Errors still flaps', (() => {
    loadTemplateState(templatesData.errors); autoBindLinks();
    return state.nodes.some(n => evaluateMultiHoming(n).level === 'bad');
  })());

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
