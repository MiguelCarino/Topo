// Hardware addresses on interfaces. The decoder came from
// hardware.carino.systems; what is new here is that the address lives on the
// map, so two questions become answerable that a standalone decoder cannot ask:
// is this address randomised, and does it appear twice on this drawing.
window.addEventListener('load', () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);

  function reset(nodes, links) {
    state.nodes = nodes.map(normalizeLoadedNode);
    state.links = (links || []).map(normalizeLoadedLink);
    autoBindLinks();
  }

  const api = window.CarinoOUI;

  // ---- 1: the decoder is actually loaded and reads the address, not a table ----
  ok('CarinoOUI is on the page', !!api);
  ok('a burned-in Apple address resolves', api.decodeMac('3C:07:54:11:22:33').vendor.vendor === 'Apple',
     api.decodeMac('3C:07:54:11:22:33').vendor.vendor);
  ok('QEMU is recognised', api.decodeMac('52:54:00:12:34:56').vendor.vendor === 'QEMU/KVM (virtual)');
  ok('the U/L bit is read off the address', api.decodeMac('02:11:22:33:44:55').isLocal === true);
  ok('a universal address is not flagged local', api.decodeMac('3C:07:54:11:22:33').isLocal === false);
  ok('multicast is caught by the I/G bit', api.decodeMac('01:00:5E:00:00:01').isMulticast === true);
  ok('broadcast is its own case', api.decodeMac('FF:FF:FF:FF:FF:FF').isBroadcast === true);
  ok('link-local is derived, not guessed', api.decodeMac('3C:07:54:11:22:33').ll === 'fe80::3e07:54ff:fe11:2233',
     api.decodeMac('3C:07:54:11:22:33').ll);
  ok('short input is an error, not a guess', !!api.decodeMac('3C:07:54').error);

  // Every format an address is pasted in — a label, `ip link`, Cisco `show` —
  // has to land on the same twelve digits or duplicate detection is fiction.
  const forms = ['3C:07:54:11:22:33', '3c-07-54-11-22-33', '3c07.5411.2233', '3C0754112233'];
  ok('every paste format normalises alike',
     new Set(forms.map((f) => api.normalizeMac(f))).size === 1, forms.map(api.normalizeMac).join(' '));

  // ---- 2: a new interface has the field, and it starts empty ----
  reset([{ id: 'a', type: 'server', name: 'A', x: 0, y: 0, interfaces: [] }]);
  const created = createIfaceFor(getNode('a'));
  ok('a new interface carries a mac field', 'mac' in created, JSON.stringify(created));
  ok('and it starts empty', hasMac(created) === false);

  // ---- 3: silence when nothing is recorded ----
  reset([{ id: 'a', type: 'server', name: 'A', x: 0, y: 0,
           interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] }]);
  ok('no addresses means no verdict', evaluateMac(getNode('a')).level === 'info',
     evaluateMac(getNode('a')).level);

  // ---- 4: one burned-in address is good news ----
  reset([{ id: 'a', type: 'server', name: 'A', x: 0, y: 0,
           interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24', mac: '3C:07:54:11:22:33' }] }]);
  ok('a burned-in address passes', evaluateMac(getNode('a')).level === 'good',
     evaluateMac(getNode('a')).text.slice(0, 60));
  ok('and it names the vendor', evaluateMac(getNode('a')).text.indexOf('Apple') > -1);

  // ---- 5: the duplicate — the reason the field exists ----
  // Two nodes, same address. This is the restored-backup / cloned-VM case, and
  // it is the one a standalone decoder can never see.
  reset([
    { id: 'a', type: 'server', name: 'Alpha', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24', mac: '52:54:00:12:34:56' }] },
    { id: 'b', type: 'server', name: 'Beta', x: 0, y: 100,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.6/24', mac: '52-54-00-12-34-56' }] }
  ]);
  ok('duplicateMacs finds the pair', duplicateMacs(state.nodes).length === 1,
     JSON.stringify(duplicateMacs(state.nodes).map((d) => d.hex)));
  ok('across different written formats', duplicateMacs(state.nodes)[0].holders.length === 2);
  ok('both ends are flagged bad', evaluateMac(getNode('a')).level === 'bad' &&
     evaluateMac(getNode('b')).level === 'bad');
  ok('the message names the other holder', evaluateMac(getNode('a')).text.indexOf('Beta') > -1,
     evaluateMac(getNode('a')).text.slice(0, 80));

  // ---- 6: group addresses repeat by design and must not read as duplicates ----
  reset([
    { id: 'a', type: 'server', name: 'Alpha', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', mac: 'FF:FF:FF:FF:FF:FF' }] },
    { id: 'b', type: 'server', name: 'Beta', x: 0, y: 100,
      interfaces: [{ id: 'i1', name: 'eth0', mac: 'FF:FF:FF:FF:FF:FF' }] }
  ]);
  ok('a repeated broadcast address is not a duplicate', duplicateMacs(state.nodes).length === 0);
  ok('but a NIC holding one is its own fault', evaluateMac(getNode('a')).level === 'bad',
     evaluateMac(getNode('a')).text.slice(0, 60));
  ok('and that message is about the group bit, not duplication',
     evaluateMac(getNode('a')).text.indexOf('group address') > -1);

  // ---- 7: randomised addresses are a warning, never an error ----
  reset([{ id: 'a', type: 'client', name: 'Laptop', x: 0, y: 0,
           interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.0.0.9/24', mac: '02:11:22:33:44:55' }] }]);
  ok('a locally-administered address warns', evaluateMac(getNode('a')).level === 'warn',
     evaluateMac(getNode('a')).text.slice(0, 60));
  ok('and says the vendor prefix is meaningless',
     evaluateMac(getNode('a')).text.indexOf('made up') > -1 ||
     evaluateMac(getNode('a')).text.indexOf('says nothing') > -1);

  // A mixed node reports the randomised one without condemning the whole node.
  reset([{ id: 'a', type: 'server', name: 'A', x: 0, y: 0, interfaces: [
    { id: 'i1', name: 'eth0', mac: '3C:07:54:11:22:33' },
    { id: 'i2', name: 'eth1', mac: '02:11:22:33:44:55' }] }]);
  ok('a mixed node names only the randomised NIC',
     evaluateMac(getNode('a')).level === 'warn' &&
     evaluateMac(getNode('a')).text.indexOf('eth1') > -1 &&
     evaluateMac(getNode('a')).text.indexOf('eth0') === -1,
     evaluateMac(getNode('a')).text.slice(0, 80));

  // ---- 8: the address survives a save/load round trip ----
  reset([{ id: 'a', type: 'server', name: 'A', x: 0, y: 0,
           interfaces: [{ id: 'i1', name: 'eth0', mac: '3C:07:54:11:22:33' }] }]);
  const round = JSON.parse(JSON.stringify(state.nodes)).map(normalizeLoadedNode);
  ok('normalizeLoadedNode keeps the address', round[0].interfaces[0].mac === '3C:07:54:11:22:33',
     String(round[0].interfaces[0].mac));

  // ---- 9: ...and through the REAL persistence path ----
  // Section 8 round-trips JSON of state.nodes, which never passes through the
  // serializer's allowlist, and that is how the allowlist dropping `mac` went
  // unseen: every save, Undo, library card, share link and export lost it.
  // This goes the way the document actually travels, serializeDoc → applyDoc,
  // and compares every interface field the allowlist names.
  reset([
    { id: 'a', type: 'server', name: 'A', x: 0, y: 0, interfaces: [
      { id: 'i1', name: 'eth0', ip: '10.0.0.5/24', mac: '3C:07:54:11:22:33' },
      { id: 'i2', name: 'wlan0', ip: '', mac: '02:11:22:33:44:55', wireless: true }] },
    { id: 'b', type: 'server', name: 'B', x: 0, y: 100, interfaces: [
      { id: 'i1', name: 'eth0', ip: '', mac: '' },
      { id: 'i2', name: 'eth1', ip: '' },
      { id: 'b1', name: 'bond0', ip: '10.0.0.6/24', mac: '52:54:00:AA:BB:CC', bond: { mode: '802.3ad', members: ['i1', 'i2'] } }] }
  ]);
  // drawZone is the network's since v3 (tests/suites/networks.js).
  const IFACE_KEYS = ['id', 'name', 'ip', 'mac', 'wireless', 'bond'];
  const ifaceView = () => state.nodes.map((n) => n.interfaces.map((i) =>
    JSON.stringify(IFACE_KEYS.map((k) => [k, i[k] === '' ? undefined : i[k]]))));
  const beforeTrip = JSON.stringify(ifaceView());
  applyDoc(JSON.stringify(serializeDoc()));
  const afterTrip = JSON.stringify(ifaceView());
  ok('serializeDoc → applyDoc keeps every interface field, MAC included', afterTrip === beforeTrip,
     afterTrip === beforeTrip ? '' : afterTrip.slice(0, 160));
  ok('a MAC survives the trip', getNode('a').interfaces[0].mac === '3C:07:54:11:22:33',
     String(getNode('a').interfaces[0].mac));
  ok('so does a bond\'s', getNode('b').interfaces[2].mac === '52:54:00:AA:BB:CC');
  ok('and the duplicate-MAC check still has something to read after Undo-style restore',
     duplicateMacs(state.nodes).length === 0 && evaluateMac(getNode('a')).level === 'warn',
     evaluateMac(getNode('a')).level);
  // An empty MAC is omitted rather than written as "", so a document that
  // never held one serializes byte-for-byte as it did before the fix.
  reset([{ id: 'a', type: 'server', name: 'A', x: 0, y: 0,
           interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24', mac: '' }] }]);
  ok('a document with no MACs carries no mac key at all',
     !/"mac"/.test(JSON.stringify(serializeDoc())), JSON.stringify(serializeDoc().nodes[0].interfaces));

  // ---- 10: the sidebar's own duplicate warning ----
  // Interface ids repeat across nodes (every fresh device has i1), so the
  // sidebar comparing ids alone dropped the other holder and showed nothing,
  // while the Diagnostics tab reported the duplicate.
  reset([
    { id: 'a', type: 'pc', name: 'Workstation A', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24', mac: '52:54:00:12:34:56' }] },
    { id: 'b', type: 'pc', name: '<a href="https://example.org" id="macInjected" style="font-size:40px">Click to fix</a>', x: 0, y: 100,
      interfaces: [{ id: 'i1', name: '<img id="macInjectedImg">', ip: '10.0.0.6/24', mac: '52:54:00:12:34:56' }] }
  ]);
  select('a', 'node');
  const macOut = document.querySelector('#ifaceListContainer .if-mac-out');
  const macIn = document.querySelector('#ifaceListContainer .if-mac input');
  ok('two nodes sharing an interface id still show "Also on …"',
     !!macOut && /Also on/.test(macOut.textContent), macOut ? macOut.textContent.slice(0, 80) : 'no MAC line');
  ok('and the field turns red', !!macIn && macIn.classList.contains('bad'));
  // The other holder's names come from the document, which may be a shared
  // link or a stranger's file. They must arrive as text.
  ok('a node name that is markup renders as text, not as a live link',
     !document.getElementById('macInjected') && !!macOut && macOut.textContent.indexOf('<a href=') > -1);
  ok('an interface name that is markup renders as text too',
     !document.getElementById('macInjectedImg') && !!macOut && macOut.textContent.indexOf('<img') > -1);
  select(null, null);

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
