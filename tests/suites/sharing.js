// Transmitting a build: the shareable URL is now deflate-raw compressed (the "~"
// scheme), and there is a .nettopo file path for builds too big or too archival
// for a link. This suite drives the real codec and import/export the app uses, so
// it proves round-trip fidelity, back-compat with old (uncompressed) links, and
// that the compressed form is actually smaller. Async because compression is.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  // A real-ish diagram — big enough that compression clearly wins.
  const build = () => [
    { id: 'r', type: 'router', name: 'Edge Router', x: 0, y: 0, nat: true, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.0.1/24' }] },
    { id: 'sw', type: 'switch', name: 'Core Switch', x: 0, y: 100, portCount: 24, interfaces: [] },
    { id: 's1', type: 'server', name: 'App Server', x: -100, y: 200, gw: '10.20.0.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.0.10/24' }] },
    { id: 's2', type: 'server', name: 'DB Server', x: 0, y: 200, gw: '10.20.0.1', ports: '5432', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.20.0.11/24' }] },
    { id: 'ap', type: 'ap', name: 'Floor AP', x: 100, y: 200, interfaces: [{ id: 'w1', name: 'wlan0', ip: '' }] },
    { id: 'pc', type: 'pc', name: 'Kiosk', x: 100, y: 300, gw: '10.20.0.1', interfaces: [{ id: 'w1', name: 'wlan0', ip: '10.20.0.50/24' }] }
  ];
  state.nodes = build().map(normalizeLoadedNode);
  state.links = [
    { id: 'l1', source: 'r', target: 'sw', sourceIface: 'i1', targetIface: 'p1' },
    { id: 'l2', source: 'sw', target: 's1', sourceIface: 'p2', targetIface: 'i1' },
    { id: 'l3', source: 'sw', target: 's2', sourceIface: 'p3', targetIface: 'i1' },
    { id: 'l4', source: 'sw', target: 'ap', sourceIface: 'p4', targetIface: 'w1' },
    { id: 'l5', source: 'ap', target: 'pc', medium: 'wireless', sourceIface: 'w1', targetIface: 'w1' }
  ].map(normalizeLoadedLink);
  const N = state.nodes.length;

  const json = JSON.stringify(serializeDoc());
  const legacy = btoa(encodeURIComponent(json));

  // ---- Compressed share fragment ----
  const frag = await encodeShareFragment(json);
  ok('the share fragment carries the "~" compressed marker', frag[0] === '~', frag.slice(0, 1));
  ok('the compressed fragment is much shorter than the legacy encoding',
     frag.length < legacy.length * 0.6, `${frag.length} vs ${legacy.length} bytes`);
  ok('a compressed fragment round-trips to the exact same JSON', (await decodeFragment(frag)) === json);

  // ---- Back-compat: old uncompressed links must still open ----
  ok('legacy (uncompressed) fragments still decode', (await decodeFragment(legacy)) === json);

  // ---- Unicode must survive deflate + base64url ----
  const uni = JSON.stringify({ nodes: [{ id: 'x', type: 'pc', name: 'café 日本 🌐', x: 0, y: 0,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] }], links: [] });
  ok('unicode names survive the compressed round-trip', (await decodeFragment(await encodeShareFragment(uni))) === uni);

  // ---- load() restores from both hash formats ----
  window.location.hash = frag;
  await load();
  ok('load() restores a build from a compressed #~ link', state.nodes.length === N && !!getNode('s2'), String(state.nodes.length));
  window.location.hash = legacy;
  await load();
  ok('load() still restores a build from a legacy hash (sync path)', state.nodes.length === N && !!getNode('ap'), String(state.nodes.length));
  window.location.hash = '';

  // ---- Portable .nettopo file: shape, acceptance, round-trip ----
  ok('an envelope file unwraps to its doc', !!docFromImported({ kind: 'nettopology', version: 1, doc: { nodes: [{}], links: [] } }));
  ok('a bare {nodes,links} imports too (a decoded share URL)', !!docFromImported({ nodes: [{}], links: [] }));
  ok('junk is rejected, not loaded as empty', docFromImported({ foo: 1 }) === null && docFromImported(null) === null);

  // What exportJsonFile writes must re-import to the same build.
  state.nodes = build().map(normalizeLoadedNode); state.links = [];
  const payload = { kind: 'nettopology', version: 1, doc: serializeDoc() };
  const reDoc = docFromImported(JSON.parse(JSON.stringify(payload)));
  ok('an exported build re-imports to the same node count', reDoc && reDoc.nodes.length === N, reDoc && String(reDoc.nodes.length));

  // applyImportedDoc actually lands it on the canvas (empty first, so no confirm()).
  state.nodes = []; state.links = [];
  const took = applyImportedDoc(payload);
  ok('importing a build loads it onto an empty canvas', took === true && state.nodes.length === N, String(state.nodes.length));
  ok('the imported build keeps its NAT and port count', !!getNode('r') && getNode('r').nat === true && portCountOf(getNode('sw')) === 24);

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
