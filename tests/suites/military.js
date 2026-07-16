// Extracted from the scratchpad HTML this suite was first authored in.
window.addEventListener('load',()=>{ setTimeout(()=>{
  const out=[]; const ok=(n,c,e)=>out.push(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`);
  loadTemplateState(templatesData.military); autoBindLinks(); renderCanvasOnly();

  const alerts=[...document.querySelectorAll('#conflictMsgList li')].map(li=>li.textContent);
  ok('military base validates clean', alerts.length===0, alerts.slice(0,2).join(' | '));
  ok('no node is badged', state.nodes.filter(n=>nodeSeverity(n)).length===0,
     state.nodes.filter(n=>nodeSeverity(n)).map(n=>n.name).join(', '));

  // --- Each enclave reaches its own WAN ---
  const nipr = calculateReachability('m_hq1').reachableNodes;
  const sipr = calculateReachability('m_sw1').reachableNodes;
  ok('unclassified WS reaches NIPRNet', nipr.has('m_net'));
  ok('classified WS reaches SIPRNet through the TACLANE', sipr.has('m_snet'));
  ok('classified WS reaches the classified server', sipr.has('m_ssrv'));

  // --- The air gap: neither side can see the other, in any direction ---
  ok('classified WS cannot reach NIPRNet', !sipr.has('m_net'));
  ok('classified WS cannot reach any unclassified host', !sipr.has('m_hq1') && !sipr.has('m_c2') && !sipr.has('m_log'));
  ok('classified WS cannot reach the base firewall', !sipr.has('m_fw') && !sipr.has('m_edge'));
  ok('unclassified WS cannot reach SIPRNet', !nipr.has('m_snet'));
  ok('unclassified WS cannot reach any classified host', !nipr.has('m_sw1') && !nipr.has('m_sw2') && !nipr.has('m_ssrv'));
  ok('unclassified WS cannot reach the TACLANE', !nipr.has('m_tac') && !nipr.has('m_scif'));

  // The gap must be structural, not incidental: no link and no shared subnet.
  const RED = ['m_snet','m_tac','m_scif','m_sw1','m_sw2','m_ssrv'];
  const crossing = state.links.filter(l => RED.includes(l.source) !== RED.includes(l.target));
  ok('not one cable crosses the boundary', crossing.length===0, crossing.map(l=>l.id).join(',') || 'none');
  const nets = (ids) => new Set(ids.flatMap(id => getValidIps(getNode(id)).map(i=>i.networkStr)));
  const redNets = nets(RED), blackNets = nets(state.nodes.map(n=>n.id).filter(id=>!RED.includes(id)));
  const overlap = [...redNets].filter(n => blackNets.has(n));
  ok('the enclaves share no subnet', overlap.length===0, overlap.join(',') || 'none');

  // --- Feature coverage ---
  ok('backbone runs on fibre', effectiveMedium(getLink('ml3'))==='fiber' && effectiveMedium(getLink('ml17'))==='fiber');
  ok('motor pool handheld associates by radio', effectiveMedium(getLink('ml15'))==='wireless');
  ok('TACLANE ct/pt sides bound as authored',
     ifaceLabel(getNode('m_tac'), getLink('ml16').targetIface)==='ct' && ifaceLabel(getNode('m_tac'), getLink('ml17').sourceIface)==='pt');
  ok('firewall VLANs bound as authored',
     ['igb1','igb2','igb3'].every((v,i)=>ifaceLabel(getNode('m_fw'), getLink(['ml3','ml7','ml10'][i]).sourceIface)===v));

  const pre=document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent=out.join('\n'); document.body.appendChild(pre);
},400); });
