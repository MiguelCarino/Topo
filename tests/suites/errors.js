window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  loadTemplateState(templatesData.errors); autoBindLinks(); renderCanvasOnly();
  const alerts = [...document.querySelectorAll('#conflictMsgList li')].map(li => li.textContent);
  const has = (re) => alerts.some(a => re.test(a));

  ok('MAC flapping demonstrated', has(/MAC flapping/i), alerts.find(a => /MAC flapping/i.test(a))?.slice(0, 72));
  ok('L2 loop demonstrated', has(/L2 loop/i), alerts.find(a => /L2 loop/i.test(a))?.slice(0, 60));
  ok('duplicate IP demonstrated', has(/IP Conflict/i), alerts.find(a => /IP Conflict/i.test(a))?.slice(0, 60));
  ok('Wi-Fi on a wired NIC demonstrated', has(/carries the Wi-Fi link/i), alerts.find(a => /Wi-Fi link/i.test(a))?.slice(0, 72));
  ok('subnet mismatch demonstrated', has(/different subnets/i), alerts.find(a => /different subnets/i.test(a))?.slice(0, 72));
  ok('unreachable gateway demonstrated', has(/unreachable/i), alerts.find(a => /unreachable/i.test(a))?.slice(0, 50));

  // The bindings must survive auto-bind — that is the whole trick.
  const lap = state.nodes.find(n => n.tid === 'lap' || n.id === 'lap');
  const wifiLink = state.links.find(l => effectiveMedium(l) === 'wireless');
  ok('the wrong Wi-Fi binding was not silently repaired', ifaceLabel(lap, wifiLink.sourceIface) === 'eth0',
     ifaceLabel(lap, wifiLink.sourceIface));
  const pacs = getNode('pacs');
  ok('PACS still on two NICs in one subnet', new Set(state.links.filter(l => l.source === 'pacs').map(l => l.sourceIface)).size === 2);

  // Badges mark faults attributable to one node's own NICs. Duplicate IP, subnet
  // mismatch and L2 loops are relational — no single node is the wrong one — so they
  // surface in the alert panel instead. That line is deliberate.
  const badges = state.nodes.filter(n => nodeSeverity(n) === 'bad').map(n => n.name);
  ok('nodes with their own NIC faults render red', badges.length === 2, badges.join(', ') || 'none');
  ok('relational faults alert but do not blame a node',
     !nodeSeverity(getNode('dup')) && !nodeSeverity(getNode('sw1')) && has(/IP Conflict/) && has(/L2 loop/));
  ok('the gateway itself is not blamed', nodeSeverity(getNode('rtr')) !== 'bad', String(nodeSeverity(getNode('rtr'))));
  out.push(`  total alerts raised: ${alerts.length}`);
  alerts.forEach(a => out.push('    • ' + a.slice(0, 104)));

  // Block form must produce the same lesson on a clean canvas.
  state.nodes = []; state.links = [];
  stampSnippet('errors');
  const blockAlerts = [...document.querySelectorAll('#conflictMsgList li')].map(li => li.textContent);
  ok('block form raises the same errors as the template', blockAlerts.length === alerts.length, `block=${blockAlerts.length} template=${alerts.length}`);
  ok('block form keeps the Wi-Fi-on-eth0 binding', blockAlerts.some(a => /carries the Wi-Fi link/i.test(a)));

  // Stamping twice must not collide ids.
  stampSnippet('errors');
  ok('stamping twice does not collide node ids', new Set(state.nodes.map(n => n.id)).size === state.nodes.length, `${state.nodes.length} nodes`);
  ok('stamping twice does not collide link ids', new Set(state.links.map(l => l.id)).size === state.links.length, `${state.links.length} links`);

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
