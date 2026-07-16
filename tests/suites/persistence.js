// Saving your own network as a template goes through a different allowlist than
// the URL hash, so it can lose fields the hash keeps. What you get back has to
// be the network you saved.
window.addEventListener('load', () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);

  const KEY = 'nettopo_user_templates';
  localStorage.removeItem(KEY);

  // A network using the features that make this tool worth using: a grown
  // switch, a bond, deliberate NAT, and cables in specific sockets.
  state.nodes = [
    { id: 'sw', type: 'switch', name: 'Core', x: 0, y: 100, portCount: 24, interfaces: [] },
    { id: 'srv', type: 'server', name: 'NAS', x: 0, y: 0, gw: '10.0.0.1', interfaces: [
        { id: 'i1', name: 'eno1', ip: '' },
        { id: 'i2', name: 'eno2', ip: '' },
        { id: 'b1', name: 'bond0', ip: '10.0.0.9/24', bond: { mode: '802.3ad', members: ['i1', 'i2'] } } ] },
    // Each of these has NAT set AGAINST its type default, so a dropped nat field
    // cannot hide behind normalizeLoadedNode reapplying the default: a router
    // defaults to no NAT and a vpn defaults to NAT on.
    { id: 'rtr', type: 'router', name: 'Router', x: -100, y: 200, nat: true, interfaces: [{ id: 'r1', name: 'eth0', ip: '10.0.0.1/24' }] },
    { id: 'vpn', type: 'vpn', name: 'VPN', x: 100, y: 200, nat: false, interfaces: [{ id: 'v1', name: 'wan', ip: '203.0.113.9/30' }] }
  ].map(normalizeLoadedNode);
  state.links = [
    { id: 'x1', source: 'srv', target: 'sw', sourceIface: 'i1', targetIface: 'p7' },
    { id: 'x2', source: 'srv', target: 'sw', sourceIface: 'i2', targetIface: 'p8' }
  ].map(normalizeLoadedLink);

  const before = {
    ports: portCountOf(getNode('sw')),
    rtrNat: !!getNode('rtr').nat,
    vpnNat: !!getNode('vpn').nat,
    sockets: state.links.map((l) => `${l.sourceIface}>${l.targetIface}`).join('|')
  };

  // Serialize with the app's own function — not a copy of it here, or this
  // suite would only prove that the test agrees with itself. Round-trip through
  // localStorage for real, so anything unserializable shows up.
  localStorage.setItem(KEY, JSON.stringify({ mine: templateSnapshot() }));
  const back = JSON.parse(localStorage.getItem(KEY)).mine;

  state.nodes = []; state.links = [];
  loadTemplateState(back);
  autoBindLinks();

  ok('a 24-port switch comes back with 24 ports', portCountOf(getNode('sw')) === before.ports,
     `${portCountOf(getNode('sw'))} vs ${before.ports}`);
  // NAT round-trips WRONG rather than to a default: normalizeLoadedNode reapplies
  // the type default when nat is undefined, so a dropped field silently flips
  // these back to what the palette thinks they should be.
  ok('a router with NAT on stays on', !!getNode('rtr').nat, String(getNode('rtr').nat));
  ok('a VPN gateway with NAT off stays off', !getNode('vpn').nat, String(getNode('vpn').nat));

  const bond = (getNode('srv').interfaces || []).find(isBond);
  ok('the bond survives', !!bond, (getNode('srv').interfaces || []).map((i) => i.name).join(','));
  ok('with its mode and members', bond && bond.bond.mode === '802.3ad' && bond.bond.members.length === 2,
     bond ? `${bond.bond.mode} x${bond.bond.members.length}` : 'gone');
  ok('and its address', bond && bond.ip === '10.0.0.9/24', bond && bond.ip);

  const sockets = state.links.map((l) => `${l.sourceIface}>${l.targetIface}`).join('|');
  ok('every cable comes back in the socket it was in', sockets === before.sockets, `${sockets} vs ${before.sockets}`);
  ok('the saved network raises no new complaints', state.nodes.every((n) => nodeSeverity(n) === null),
     state.nodes.filter((n) => nodeSeverity(n)).map((n) => n.name).join(',') || 'none');

  localStorage.removeItem(KEY);

  // ---- Loading a different network must not leave stale ids pointing at it ----
  // popstate reaches load() without a reload: paste a shared URL while link mode
  // is armed and the next click looked up a node that no longer exists.
  state.nodes = [normalizeLoadedNode({ id: 'gone', type: 'pc', name: 'Doomed', x: 0, y: 0 })];
  state.links = [];
  state.selectedId = 'gone'; state.selectedType = 'node'; state.linkSourceId = 'gone';
  window.location.hash = btoa(encodeURIComponent(JSON.stringify({
    nodes: [{ id: 'fresh', type: 'pc', name: 'Fresh', x: 0, y: 0, ips: ['10.0.0.2/24'] }], links: []
  })));
  load();
  ok('loading a new topology disarms link mode', state.linkSourceId === null, String(state.linkSourceId));
  ok('and drops the stale selection', state.selectedId === null, String(state.selectedId));
  ok('the old node really is gone', !getNode('gone') && !!getNode('fresh'));

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
