// The three offline-plan templates. They exist so offline.carino.systems' bill
// of materials and the diagram of it cannot drift apart, which means the thing
// worth asserting is not "it loads" but that each one still says what the plan
// says: the WAN is a leaf, DNS is local, and each tier buys the thing its own
// blurb claims it buys.
window.addEventListener('load', () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);

  const KEYS = ['offlineLean', 'offlineBalanced', 'offlineExtended'];

  function load(key) {
    const tpl = templatesData[key];
    state.nodes = tpl.nodes.map(normalizeLoadedNode);
    state.links = tpl.links.map(normalizeLoadedLink);
    autoBindLinks();
    return tpl;
  }

  // ---- 1: all three are registered and reachable from the library ----
  KEYS.forEach((k) => ok(`${k} has data`, !!templatesData[k]));
  KEYS.forEach((k) => ok(`${k} has a menu row`, TEMPLATE_META.some((m) => m.key === k)));

  // ---- 2: they load without tripping the diagnostics ----
  // A template shipped with a fault in it teaches the fault. Common Errors is
  // the only one allowed to be broken, and it is not one of these.
  KEYS.forEach((k) => {
    load(k);
    const bad = state.nodes.filter((n) => nodeSeverity(n) === 'bad');
    ok(`${k} loads clean`, bad.length === 0, bad.map((n) => n.name).join(', '));
  });

  // ---- 3: the WAN is a leaf, not the root ----
  // This is the whole claim of the site these came from. Every cloud must be a
  // dead end hanging off the gateway: if a client reached a service THROUGH the
  // cloud, cutting it would take the service with it.
  KEYS.forEach((k) => {
    load(k);
    const clouds = state.nodes.filter((n) => n.type === 'cloud');
    ok(`${k} has an uplink to lose`, clouds.length > 0, String(clouds.length));
    const leafy = clouds.every((c) =>
      state.links.filter((l) => l.source === c.id || l.target === c.id).length === 1);
    ok(`${k} keeps every uplink a leaf`, leafy);
  });

  // ---- 4: nothing points at a public resolver ----
  // A template that sent clients to 8.8.8.8 would be drawing the exact failure
  // the plan exists to avoid.
  KEYS.forEach((k) => {
    load(k);
    const publicDns = state.nodes.filter((n) => n.dns && /^(8\.8\.|1\.1\.1\.1|9\.9\.9\.9)/.test(n.dns.trim()));
    ok(`${k} resolves locally`, publicDns.length === 0,
       publicDns.map((n) => `${n.name}=${n.dns}`).join(', '));
  });

  // ---- 5: each tier buys what its blurb says ----
  load('offlineLean');
  ok('lean is a single site', !state.links.some((l) => l.medium === 'vpn'));
  ok('lean has exactly one uplink', state.nodes.filter((n) => n.type === 'cloud').length === 1);
  ok('lean still serves Wi-Fi', state.links.some((l) => l.medium === 'wireless'));

  load('offlineBalanced');
  ok('balanced reaches a second site', state.links.some((l) => l.medium === 'vpn'));
  ok('balanced has a failover path', state.nodes.filter((n) => n.type === 'cloud').length === 2);
  ok('balanced names Node B', state.nodes.some((n) => /Node B/.test(n.name)));

  load('offlineExtended');
  ok('extended reaches two more sites',
     state.links.filter((l) => l.medium === 'vpn').length === 2,
     String(state.links.filter((l) => l.medium === 'vpn').length));
  ok('extended has three uplinks', state.nodes.filter((n) => n.type === 'cloud').length === 3);
  ok('extended carries the GPU node', state.nodes.some((n) => /GPU/.test(n.name)));

  // ---- 6: each tier is a superset of the one below, by node count ----
  const counts = KEYS.map((k) => { load(k); return state.nodes.length; });
  ok('tiers grow in order', counts[0] < counts[1] && counts[1] < counts[2], counts.join(' < '));

  // ---- 7: every link binds to a real interface ----
  KEYS.forEach((k) => {
    load(k);
    const orphan = state.links.filter((l) => {
      const s = getNode(l.source), t = getNode(l.target);
      return !s || !t;
    });
    ok(`${k} has no dangling cable`, orphan.length === 0, String(orphan.length));
  });

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
