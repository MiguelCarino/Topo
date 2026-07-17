// The trace can filter reachability by port. That filter now has its own toggle,
// so a typed-in port can be suspended and resumed without being cleared — trace
// keeps working, just on IP reachability while the filter is off. This suite
// drives the real activeTracePort()/calculateReachability()/evaluateTracePort().
window.addEventListener('load', () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const portInput = document.getElementById('tracePort');
  const portToggle = document.getElementById('tracePortToggle');
  const setPort = (value, on) => { portInput.value = value; portToggle.checked = on; };

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
     activeTracePort() === '' && portInput.value === '443', `active="${activeTracePort()}" field="${portInput.value}"`);
  setPort('', true);
  ok('an empty port is no filter even with the toggle on', activeTracePort() === '');

  // ---- The toggle genuinely gates the reachability pruning ----
  setPort('', false);
  ok('with no port, the web server is reachable', calculateReachability('r').reachableNodes.has('s'));
  setPort('443', true);
  ok('port 443 on, a port-80-only server drops out of the trace', !calculateReachability('r').reachableNodes.has('s'));
  setPort('443', false); // keep the port typed, only suspend the filter
  ok('toggling the filter off restores IP reachability without clearing the port',
     calculateReachability('r').reachableNodes.has('s') && portInput.value === '443', `field="${portInput.value}"`);
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
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
