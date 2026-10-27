// The trace can filter reachability by port. That filter now has its own toggle,
// so a typed-in port can be suspended and resumed without being cleared — trace
// keeps working, just on IP reachability while the filter is off. This suite
// drives the real activeTracePort()/calculateReachability()/evaluateTracePort().
//
// The trace's state is in state.settings (traceMode, tracePort, tracePortOn),
// not in its controls (R8): setPort() writes the settings, and the last part
// drives the controls in the Diagnostics tab to check they write the same.
window.addEventListener('load', () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const portInput = document.getElementById('tracePort');
  const portToggle = document.getElementById('tracePortToggle');
  const setPort = (value, on) => { state.settings.tracePort = value; state.settings.tracePortOn = on; };

  // A router and a web server that only answers on port 80. A port filter of 443
  // should therefore prune the server out; 80 or no-filter keep it reachable.
  state.nodes = [
    normalizeLoadedNode({ id: 'r', type: 'router', name: 'R', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] }),
    normalizeLoadedNode({ id: 's', type: 'server', name: 'Web', x: 100, y: 0, gw: '10.0.0.1', ports: '80', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] })
  ];
  state.links = [normalizeLoadedLink({ id: 'l', source: 'r', target: 's' })];
  autoBindLinks();

  // ---- activeTracePort() is the single gate the readers consult ----
  setPort('443', true);
  ok('a typed port with the filter on is active', activeTracePort() === '443', activeTracePort());
  setPort('443', false);
  ok('the same port with the filter off is suspended, not lost',
     activeTracePort() === '' && state.settings.tracePort === '443', `active="${activeTracePort()}" port="${state.settings.tracePort}"`);
  setPort('', true);
  ok('an empty port is no filter even with the toggle on', activeTracePort() === '');

  // ---- The toggle genuinely gates the reachability pruning ----
  setPort('', false);
  ok('with no port, the web server is reachable', calculateReachability('r').reachableNodes.has('s'));
  setPort('443', true);
  ok('port 443 on, a port-80-only server drops out of the trace', !calculateReachability('r').reachableNodes.has('s'));
  setPort('443', false); // keep the port typed, only suspend the filter
  ok('toggling the filter off restores IP reachability without clearing the port',
     calculateReachability('r').reachableNodes.has('s') && state.settings.tracePort === '443', `port="${state.settings.tracePort}"`);
  setPort('80', true);
  ok('port 80 on, the port-80 server is reachable again', calculateReachability('r').reachableNodes.has('s'));

  // ---- The node diagnostic tells the three states apart ----
  setPort('443', false);
  let msg = evaluateTracePort(getNode('s')).text;
  ok('filter-off message names the ignored port, not "no port"',
     /filter off/i.test(msg) && msg.includes('443') && !/No trace port/.test(msg), msg);
  setPort('', true);
  msg = evaluateTracePort(getNode('s')).text;
  ok('an empty port reports no port entered', /No trace port/.test(msg), msg);
  setPort('80', true);
  ok('an active port evaluates the real port status, not an info note', evaluateTracePort(getNode('s')).level !== 'info',
     evaluateTracePort(getNode('s')).level);

  setPort('', false);

  // ---- The controls write the settings, and are redrawn from them ----
  // Typing arms the filter, emptying it disarms; the toggle only suspends.
  const type = (v) => { portInput.value = v; portInput.dispatchEvent(new Event('input', { bubbles: true })); };
  type('443');
  ok('typing a port in the Diagnostics tab sets the setting and arms the filter',
     state.settings.tracePort === '443' && state.settings.tracePortOn === true && portToggle.checked && activeTracePort() === '443');
  portToggle.checked = false; portToggle.dispatchEvent(new Event('change', { bubbles: true }));
  ok('unticking Port filter suspends it without clearing the port',
     state.settings.tracePortOn === false && state.settings.tracePort === '443' && activeTracePort() === ''
     && portInput.classList.contains('suspended'));
  type('');
  ok('emptying the port disarms the filter', state.settings.tracePortOn === false && !portInput.classList.contains('suspended'));
  setPort('80', true); syncTraceControls();
  ok('the controls are redrawn from the settings', portInput.value === '80' && portToggle.checked);
  setPort('', false); syncTraceControls();

  // ---- Trace lives in the Diagnostics tab; T and the handy bar share it ----
  const diagPanel = document.getElementById('cfgPanel-diagnostics');
  ok('the trace controls are in the node Diagnostics tab',
     diagPanel.contains(document.getElementById('toggleTrace')) && diagPanel.contains(portInput)
     && diagPanel.contains(document.getElementById('traceStatus')));
  ok('and no longer in the navbar actions', !document.querySelector('.topo-actions #toggleTrace, .topo-actions #tracePort'));
  select(null, null); showConfigTab('config');
  let heard = null;
  const listen = (e) => { heard = e.detail.on; };
  document.addEventListener('topo:tracechange', listen);
  setTraceMode(true);
  ok('turning trace on picks a start device and opens the Diagnostics tab',
     state.settings.traceMode === true && state.selectedId === 'r' && !diagPanel.classList.contains('hidden')
     && document.getElementById('toggleTrace').checked, `selected=${state.selectedId}`);
  ok('and announces it (the phone button listens)', heard === true);
  ok('the status line counts what the device reaches', /→ 1 devices/.test(document.getElementById('traceStatus').textContent),
     document.getElementById('traceStatus').textContent);
  document.getElementById('toggleTrace').click();
  ok('the checkbox turns it off through the same path', state.settings.traceMode === false && heard === false
     && document.getElementById('traceStatus').textContent === 'Trace off');
  const handy = document.getElementById('handyTrace');
  if (handy) {
    handy.click();
    ok('the handy bar button sets the setting and lights up', state.settings.traceMode === true && handy.classList.contains('active'));
    handy.click();
    ok('and turns it off again', state.settings.traceMode === false && !handy.classList.contains('active'));
  } else ok('the handy bar has its Trace button', false);
  document.removeEventListener('topo:tracechange', listen);
  ok('the trace is not persisted', !('traceMode' in (JSON.parse(localStorage.getItem('nettopo_settings')) || {}))
     && !('tracePort' in (JSON.parse(localStorage.getItem('nettopo_settings')) || {})));
  select(null, null); showConfigTab('config');

  // DICOM is the one service name that means two ports, 104 and 11112, and it
  // must mean both however it is written: 'tcp/dicom' went through the alias
  // table to 104 alone, so a trace for 11112 missed a PACS listed that way.
  const ports = (tok) => normalizePortToken(tok).map((p) => p.start).join(',');
  ok('dicom means 104 and 11112', ports('dicom') === '104,11112', ports('dicom'));
  ok('tcp/dicom means both too', ports('tcp/dicom') === '104,11112', ports('tcp/dicom'));
  ok('and keeps its protocol', normalizePortToken('tcp/dicom').every((p) => p.proto === 'tcp'));
  ok('a node listing tcp/dicom answers a trace for 11112',
     acceptsPort({ id: 'pacs', type: 'server', ports: 'tcp/dicom', interfaces: [] }, '11112') === true);

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
