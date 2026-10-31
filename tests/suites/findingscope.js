// What an accept or a pin covers, and the addresses an add hands out. What
// is held here:
//   1. an IP conflict is scoped to its address and a MAC conflict to its
//      (normalised) MAC, so accepting "10.0.0.5 shared by A, B" does not
//      accept A and B on 10.0.0.9 the day that comes about;
//   2. an entry written before conflicts had a scope is given, when read,
//      each address its devices share (one entry per address), a retired
//      holder counting; one whose devices share none goes; a scoped one, or
//      another check's, is left alone; reading twice changes nothing; the
//      next save writes the scope; a card's summary and a pin read the same;
//   3. a deleted device or cable leaves the accepted entries and the pins in
//      memory, in the same undo step (Delete, a group deleted with its
//      devices, an interface deleted with its cable), and an entry naming
//      nothing left goes; undo brings them back; a file naming ids it does
//      not hold is read without them;
//   4. an add whose SSID is on the target's own LAN hands the wired and the
//      radio devices different addresses.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  let answer = null;
  const heldResponder = setDialogResponder((req) => (req.kind === 'choice' ? answer : req.kind === 'confirm' ? true : null));

  const MAC = 'aa:bb:cc:00:00:01';
  const ifc = (id, ip, mac) => Object.assign({ id, name: id === 'i1' ? 'eth0' : 'eth1', ip }, mac ? { mac } : {});
  // A and B share 10.0.0.5; B's second NIC is free, so giving it A's second
  // address (10.0.0.9) is a new conflict between the same two.
  const lab = (extra = {}) => Object.assign({ v: DOC_VERSION,
    networks: [{ id: 'n1', cidr: '10.0.0.0/24', gateway: '10.0.0.1' }],
    groups: [{ id: 'g1', kind: 'room', name: 'Lab' }],
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [ifc('i1', '10.0.0.1/24')] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 120, portCount: 8, interfaces: [] },
      { id: 'a', type: 'pc', name: 'Lab A', x: -100, y: 240, group: 'g1', interfaces: [ifc('i1', '10.0.0.5/24'), ifc('i2', '10.0.0.9/24')] },
      { id: 'b', type: 'pc', name: 'Lab B', x: 0, y: 240, group: 'g1', interfaces: [ifc('i1', '10.0.0.5/24'), ifc('i2', '')] },
      { id: 'c', type: 'pc', name: 'Lab C', x: 100, y: 240, interfaces: [ifc('i1', '10.0.0.30/24')] }
    ],
    links: [
      { id: 'l0', source: 'rt', target: 'sw', sourceIface: 'i1', targetIface: 'p8' },
      { id: 'la', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'lb', source: 'sw', target: 'b', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'lc', source: 'sw', target: 'c', sourceIface: 'p3', targetIface: 'i1' }
    ] }, extra);
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); initHistory(); };
  const conflicts = (key) => topologyFindings().filter((f) => f.key === key);
  const onIp = (ip) => conflicts('ip-conflict').find((f) => f.scope === ip);
  const ifaceOf = (id, ifaceId) => getNode(id).interfaces.find((i) => i.id === ifaceId);
  const legacy = (entries, v = 13) => lab({ v, accepted: entries });

  try {
    // ---- 1: the conflicts carry their address ----
    open();
    const ip5 = onIp('10.0.0.5');
    ok('an IP conflict is scoped to its address', !!ip5 && ip5.scope === '10.0.0.5' && show(ip5.nodeIds.slice().sort()) === show(['a', 'b']),
       show(conflicts('ip-conflict').map((f) => f.scope)));
    acceptFindings([ip5], 'Two lab images, never on together');
    ok('accepted with its address', acceptedList().length === 1 && acceptedList()[0].scope === '10.0.0.5' && !!onIp('10.0.0.5').accepted);
    batch(() => { ifaceOf('b', 'i2').ip = '10.0.0.9/24'; save(); renderCanvasOnly(); });
    const ip9 = onIp('10.0.0.9');
    ok('a later conflict between the same two is open, not born accepted', !!ip9 && !ip9.accepted && isCountedFinding(ip9),
       show(conflicts('ip-conflict').map((f) => [f.scope, !!f.accepted])));
    ok('while the one accepted stays accepted', !!onIp('10.0.0.5').accepted);
    ok('the scope is written and read back', serializeDoc().accepted[0].scope === '10.0.0.5'
       && (loadDocState(JSON.parse(JSON.stringify(serializeDoc()))), acceptedList().length === 1 && acceptedList()[0].scope === '10.0.0.5'));

    open(lab());
    batch(() => { ifaceOf('a', 'i1').mac = MAC; ifaceOf('b', 'i1').mac = MAC; save(); renderCanvasOnly(); });
    const mac1 = conflicts('mac-conflict')[0];
    ok('a MAC conflict is scoped to the normalised address', !!mac1 && mac1.scope === normMac(MAC), mac1 && mac1.scope);
    acceptFindings([mac1], 'Cloned VM, fixed next week');
    batch(() => { ifaceOf('a', 'i2').mac = 'aa:bb:cc:00:00:02'; ifaceOf('b', 'i2').mac = 'AA-BB-CC-00-00-02'; save(); renderCanvasOnly(); });
    const mac2 = conflicts('mac-conflict').find((f) => f.scope === normMac('aa:bb:cc:00:00:02'));
    ok('a second MAC shared by the same two is open', !!mac2 && !mac2.accepted, show(conflicts('mac-conflict').map((f) => [f.scope, !!f.accepted])));
    ok('one finding per address, each its own line', conflicts('mac-conflict').length === 2);

    // ---- 2: entries from before the scope ----
    const old = { check: 'ip-conflict', nodeIds: ['a', 'b'], reason: 'Lab images' };
    open(legacy([old]));
    ok('a v13 entry is given the address its devices share', acceptedList().length === 1 && acceptedList()[0].scope === '10.0.0.5'
       && acceptedList()[0].reason === 'Lab images', show(acceptedList()));
    ok('so the conflict it accepted is still accepted after the upgrade', !!onIp('10.0.0.5') && !!onIp('10.0.0.5').accepted);
    batch(() => { ifaceOf('b', 'i2').ip = '10.0.0.9/24'; save(); renderCanvasOnly(); });
    ok('and a conflict they come to share later is not', !!onIp('10.0.0.9') && !onIp('10.0.0.9').accepted);
    ok('the next save writes the scope', serializeDoc().accepted.length === 1 && serializeDoc().accepted[0].scope === '10.0.0.5');

    const two = lab({ v: 13, accepted: [old] });
    two.nodes.find((n) => n.id === 'b').interfaces[1].ip = '10.0.0.9/24';
    open(two);
    ok('devices sharing two addresses: one entry per address', show(acceptedList().map((a) => a.scope).sort()) === show(['10.0.0.5', '10.0.0.9'])
       && acceptedList().every((a) => a.reason === 'Lab images' && show(a.nodeIds) === show(['a', 'b'])), show(acceptedList()));
    ok('both of them accepted, as they were before', conflicts('ip-conflict').every((f) => f.accepted));

    open(legacy([{ check: 'ip-conflict', nodeIds: ['a', 'c'], reason: 'Not any more' }, { check: 'loop', nodeIds: ['a', 'c'], reason: 'Kept' }]));
    ok('an entry whose devices share no address goes; another check\'s stays', acceptedList().length === 1 && acceptedList()[0].check === 'loop'
       && !acceptedList()[0].scope, show(acceptedList()));

    const retired = legacy([old]);
    retired.nodes.find((n) => n.id === 'b').status = 'retired';
    open(retired);
    ok('a retired holder counts: its address is the one accepted', acceptedList().length === 1 && acceptedList()[0].scope === '10.0.0.5');
    batch(() => { delete getNode('b').status; save(); renderCanvasOnly(); });
    ok('and back in service, the conflict is still the accepted one', !!onIp('10.0.0.5') && !!onIp('10.0.0.5').accepted);

    const macDoc = legacy([{ check: 'mac-conflict', nodeIds: ['a', 'b'], reason: 'Cloned VM', until: '2099-01-01' }]);
    macDoc.nodes.find((n) => n.id === 'a').interfaces[0].mac = MAC;
    macDoc.nodes.find((n) => n.id === 'b').interfaces[0].mac = MAC.toUpperCase();
    open(macDoc);
    ok('a MAC entry is given the MAC, its schedule kept', acceptedList().length === 1 && acceptedList()[0].scope === normMac(MAC)
       && acceptedList()[0].until === '2099-01-01' && !!conflicts('mac-conflict')[0].accepted, show(acceptedList()));

    const scoped = { check: 'ip-conflict', scope: '10.0.0.77', nodeIds: ['a', 'b'], reason: 'As written' };
    ok('a scoped entry is left alone, and reading twice changes nothing', (() => {
      open(lab({ accepted: [scoped, old] }));
      const once = show(acceptedList());
      loadDocState(JSON.parse(JSON.stringify(serializeDoc())));
      return once === show(acceptedList()) && acceptedList().some((a) => a.scope === '10.0.0.77') && acceptedList().some((a) => a.scope === '10.0.0.5')
        && acceptedList().length === 2;
    })(), show(acceptedList()));
    ok('a v14 document from before the scope is read the same way', (open(legacy([old], 14)), acceptedList().length === 1 && acceptedList()[0].scope === '10.0.0.5'));
    ok('the list on its own is untouched when nothing is old', (() => { const l = [scoped]; return scopeLegacyConflicts(l) === l; })());

    open(lab());
    const fresh = librarySummary(legacy([old]));
    const none = librarySummary(lab());
    ok('a card\'s summary counts it accepted, as opening it would', fresh.critical === none.critical - 1, show([fresh, none]));
    const pinDoc = lab({ v: 14, pinned: [{ check: 'ip-conflict', nodeIds: ['a', 'b'], note: 'Look at the images' }] });
    open(pinDoc);
    ok('a pin from before the scope is read the same way', pinnedList().length === 1 && pinnedList()[0].scope === '10.0.0.5'
       && pinnedGroups(topologyFindings())[0].findings.length === 1);

    // ---- 3: what is deleted leaves the notes ----
    open();
    acceptFindings([onIp('10.0.0.5')], 'Lab images');
    pinFindings([onIp('10.0.0.5')], 'Check the images');
    state.accepted = state.accepted.concat([{ check: 'cabling', nodeIds: [], linkIds: ['lc'], reason: 'Patch lead, to be replaced' }]);
    save();
    const steps0 = _undoStack.length;
    select('b', 'node'); deleteSelected();
    ok('a deleted device leaves the entry and the pin in memory', show(acceptedList()[0].nodeIds) === show(['a']) && show(pinnedList()[0].nodeIds) === show(['a']),
       show([acceptedList(), pinnedList()]));
    ok('in the same undo step', _undoStack.length === steps0 + 1);
    select('a', 'node'); deleteSelected();
    ok('an entry or a pin naming nothing left goes', !acceptedList().some((a) => a.check === 'ip-conflict') && pinnedList().length === 0
       && pinnedGroups(topologyFindings()).length === 0, show([acceptedList(), pinnedList()]));
    select('lc', 'link'); deleteSelected();
    ok('so does one naming a deleted cable', acceptedList().length === 0, show(acceptedList()));
    undo(); undo(); undo();
    ok('undo brings them all back', acceptedList().length === 2 && pinnedList().length === 1 && show(pinnedList()[0].nodeIds.slice().sort()) === show(['a', 'b']),
       show([acceptedList(), pinnedList()]));

    answer = 'members';
    await deleteGroup('g1');
    ok('a group deleted with its devices takes them off the notes too', !getNode('a') && acceptedList().length === 1 && acceptedList()[0].check === 'cabling'
       && pinnedList().length === 0, show([acceptedList(), pinnedList()]));
    undo();
    deleteIface(getNode('c'), 'i1'); save();
    ok('an interface deleted with its cable takes the cable off', !state.links.some((l) => l.id === 'lc') && !acceptedList().some((a) => a.check === 'cabling'),
       show(acceptedList()));

    open(lab({ accepted: [{ check: 'loop', nodeIds: ['a', 'ghost'], reason: 'r' }, { check: 'loop', nodeIds: ['ghost'], reason: 'r' }],
      pinned: [{ check: 'service', nodeIds: ['n_lx3k9a'], scope: '2026-01-01' }] }));
    ok('a file naming ids it does not hold is read without them', acceptedList().length === 1 && show(acceptedList()[0].nodeIds) === show(['a'])
       && pinnedList().length === 0, show([acceptedList(), pinnedList()]));

    // ---- 4: one pool for one subnet ----
    const ap = () => ({ v: DOC_VERSION,
      networks: [{ id: 'n1', cidr: '10.0.0.0/24', gateway: '10.0.0.1' }, { id: 'n2', cidr: '10.2.0.0/24' }],
      wifi: [{ id: 'wS', ssid: 'Office', security: 'wpa2', network: 'n1' }, { id: 'wG', ssid: 'Guest', security: 'wpa2', network: 'n2' }],
      nodes: [
        { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [ifc('i1', '10.0.0.1/24')] },
        { id: 'ap', type: 'ap', name: 'AP-1', x: 0, y: 120, interfaces: [ifc('i1', '10.0.0.2/24'),
          { id: 'w1', name: 'wlan0', ip: '', radio: { standard: 'ax', bands: [{ band: '2.4', channel: 1 }, { band: '5', channel: 36 }] } }] }
      ],
      links: [{ id: 'l0', source: 'rt', target: 'ap', sourceIface: 'i1', targetIface: 'i1' }] });
    open(ap());
    const plan = planAddDevices({ items: [{ type: 'firewall', count: 1 }, { type: 'pc', count: 3 }], pattern: '', targetId: 'ap', ssid: 'wS' });
    const ips = plan.devices.map((d) => d.ip.split('/')[0]).filter(Boolean);
    ok('the add has wired and radio devices on one subnet', plan.devices.some((d) => d.wireless) && plan.devices.some((d) => !d.wireless)
       && plan.wifiCidr === plan.cidr, show(plan.devices));
    ok('and hands every one of them its own address', ips.length === 4 && new Set(ips).size === 4 && plan.noAddress === 0, show(ips));
    batch(() => { addDevicesNow({ items: [{ type: 'firewall', count: 1 }, { type: 'pc', count: 3 }], pattern: '', targetId: 'ap', ssid: 'wS' }); save(); });
    ok('written to the map, the add raises no IP conflict', !conflicts('ip-conflict').length, show(conflicts('ip-conflict').map((f) => f.detail)));
    open(ap());
    const guest = planAddDevices({ items: [{ type: 'firewall', count: 1 }, { type: 'pc', count: 2 }], pattern: '', targetId: 'ap', ssid: 'wG' });
    ok('an SSID on another subnet still numbers from its own', guest.devices.filter((d) => d.wireless).every((d) => d.ip.startsWith('10.2.0.'))
       && guest.devices.filter((d) => !d.wireless).every((d) => d.ip.startsWith('10.0.0.')) && guest.noAddress === 0, show(guest.devices));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
