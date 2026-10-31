// "Paste anything" and bulk Re-cable (plan phase 3, Review-Packs/Topo-proposal.md
// §3.5 and the phase 3 table; js/csv.js "Paste anything", js/bulk.js
// "Re-cable"). What is held here:
//   1. the extractor, over the ARP tables and lease lists of every vendor its
//      header names: the address, the MAC in any spelling (macOS's dropped
//      zeros, Cisco's dots, HP's halves, a DHCP client id), the name when the
//      line has one and none made up when it does not (not a key of a lease
//      block or a key=value record, an HP port, a Windows store, the maker);
//   2. what it leaves out (incomplete entries, broadcast, multicast,
//      link-local, a Windows "Interface:" heading) and counts, and an entry
//      seen twice kept once; a netmask beside the address gives its prefix;
//      an ISC lease block and MikroTik's continuation lines are one entry;
//      a network scan (nmap's output and XML) is one host per report, a host
//      up without a MAC kept and counted; arp-scan's and netdiscover's maker
//      is never a name; the GUI scanners' CSV exports map as sheets;
//   3. the import dialog reads pasted ARP output as addresses seen on its
//      own, keeps a real sheet a sheet, and Read as switches either way;
//   4. the review: a known address gains its MAC, a new one is added under
//      its name, one in no network is a conflict that says so, a name seen on
//      the wire never renames a device ("Seen as …") nor finds one, lines are numbered as
//      in the text, and Apply is one undo step;
//   5. Re-cable: the patch cables move to the target's next free ports, in
//      switch-port order, from a port given; a device already there, a
//      wireless client, a device on two switches and the target itself are
//      left as they are; a full faceplate is refused; an unplugged device
//      gets a cable; two of the set on one shared cable are each cabled once;
//      the cable keeps its id and label; one undo step, and the
//      findings delta in the preview;
//   6. the sentences are translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const shown = (id) => !el(id).classList.contains('hidden');
  const nodeByName = (name) => state.nodes.find((n) => n.name === name);
  const one = (text) => { const r = seenExtract(text).rows; return r.length === 1 ? r[0] : { n: r.length }; };
  const same = (row, ip, mac, host) => row.ip === ip && row.mac === mac && row.host === host;
  const show = (row) => JSON.stringify(row);

  try {
    // ---- 1: every vendor's line ----
    const cases = [
      ['Linux ip neigh', '10.0.0.5 dev eth0 lladdr aa:bb:cc:dd:ee:05 REACHABLE', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['Linux ip neigh, a router flag', '10.0.0.1 dev br-lan lladdr aa:bb:cc:dd:ee:01 router STALE', '10.0.0.1', 'aa:bb:cc:dd:ee:01', ''],
      ['Linux arp -a, a name that is also a word', 'router.lan (10.0.0.1) at aa:bb:cc:dd:ee:01 [ether] on br-lan', '10.0.0.1', 'aa:bb:cc:dd:ee:01', 'router'],
      ['Windows arp -a in French', '  10.0.0.5            aa-bb-cc-dd-ee-05     dynamique', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['Linux arp -a, with its name', 'pc1.lan (10.0.0.5) at aa:bb:cc:dd:ee:05 [ether] on eth0', '10.0.0.5', 'aa:bb:cc:dd:ee:05', 'pc1'],
      ['/proc/net/arp', '10.0.0.5     0x1         0x2         aa:bb:cc:dd:ee:05     *        br-lan', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['macOS arp -a, zeros dropped', '? (10.0.0.5) at a:bb:c:dd:e:5 on en0 ifscope [ethernet]', '10.0.0.5', '0a:bb:0c:dd:0e:05', ''],
      ['Windows arp -a', '  10.0.0.5            aa-bb-cc-dd-ee-05     dynamic', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['Windows DHCP lease, with a mask', '10.0.0.5  255.255.255.0  aa-bb-cc-dd-ee-05  pc1.corp.local  Active  10/27/2026 10:00:00 AM', '10.0.0.5/24', 'aa:bb:cc:dd:ee:05', 'pc1'],
      ['Windows DHCP export, bare hex', '10.0.0.5\tpc1.corp.local\t10/27/2026 10:00:00 AM\tDHCP\taabbccddee05', '10.0.0.5', 'aa:bb:cc:dd:ee:05', 'pc1'],
      ['Cisco show ip arp', 'Internet  10.0.0.5               3   aabb.ccdd.ee05  ARPA   Vlan10', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['Cisco show ip dhcp binding (client id)', '10.0.0.5        01aa.bbcc.ddee.05       Mar 01 2026 10:00 AM    Automatic  Active     Vlan10', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['HP/Aruba show arp', '  10.0.0.5        aabbcc-ddee05     dynamic  12', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['Juniper show arp', 'aa:bb:cc:dd:ee:05 10.0.0.5        pc1.example.com      ge-0/0/1.0   none', '10.0.0.5', 'aa:bb:cc:dd:ee:05', 'pc1'],
      ['MikroTik /ip arp print', ' 0 DC 10.0.0.5        AA:BB:CC:DD:EE:05 ether2', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['MikroTik lease print', ' 0 D 10.0.0.5        AA:BB:CC:DD:EE:05 pc1        dhcp1  bound  9m50s', '10.0.0.5', 'aa:bb:cc:dd:ee:05', 'pc1'],
      ['MikroTik lease print, no name', ' 1 D 10.0.0.6        AA:BB:CC:DD:EE:06            dhcp1  bound  9m50s', '10.0.0.6', 'aa:bb:cc:dd:ee:06', ''],
      ['dnsmasq leases', '1729900000 aa:bb:cc:dd:ee:05 10.0.0.5 pc1 01:aa:bb:cc:dd:ee:05', '10.0.0.5', 'aa:bb:cc:dd:ee:05', 'pc1'],
      ['dnsmasq leases, no name', '1729900000 aa:bb:cc:dd:ee:06 10.0.0.6 * *', '10.0.0.6', 'aa:bb:cc:dd:ee:06', ''],
      ['Fortinet get system arp', '10.0.0.5          0          aa:bb:cc:dd:ee:05 internal', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['IPv6 neighbour', '2001:db8::5 dev eth0 lladdr aa:bb:cc:dd:ee:05 REACHABLE', '2001:db8::5', 'aa:bb:cc:dd:ee:05', ''],
      ['an address written with its prefix', '10.0.0.5/24 aa:bb:cc:dd:ee:05 kiosk', '10.0.0.5/24', 'aa:bb:cc:dd:ee:05', 'kiosk'],
      // Not names (p3-paste repair): a port, a column of states, the maker.
      ['HP/Aruba show arp, a lettered port', '  10.0.0.5        001122-334455     dynamic  A1', '10.0.0.5', '00:11:22:33:44:55', ''],
      ['HP/Aruba show arp, a trunk', '  10.0.0.5        001122-334455     dynamic  Trk1', '10.0.0.5', '00:11:22:33:44:55', ''],
      ['Windows Get-NetNeighbor', '12      10.0.0.5        aa-bb-cc-dd-ee-05   Reachable   ActiveStore', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['Windows Get-NetNeighbor, unreachable', '12      10.0.0.5        aa-bb-cc-dd-ee-05   Unreachable   PersistentStore', '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''],
      ['an OPNsense lease copy, the maker before the name', 'LAN\t10.0.0.5\taa:bb:cc:dd:ee:05 Intel Corporate\tmypc\t2026/10/26 10:00:00', '10.0.0.5', 'aa:bb:cc:dd:ee:05', 'mypc'],
      ['a pfSense lease copy, the maker in brackets', '10.0.0.5  aa:bb:cc:dd:ee:05 (Raspberry Pi Trading Ltd)  pi-hole  active', '10.0.0.5', 'aa:bb:cc:dd:ee:05', 'pi-hole'],
      ['Fortinet diagnose ip arp list', 'index=5 ifname=internal 10.0.0.5 aa:bb:cc:dd:ee:05 state=00000004 use=1 confirm=2 update=3 ref=0', '10.0.0.5', 'aa:bb:cc:dd:ee:05', '']
    ];
    cases.forEach(([what, line, ip, mac, host]) => { const r = one(line); ok(`reads ${what}`, same(r, ip, mac, host), show(r)); });

    // ---- 2: what is left out, joined and counted ----
    const win = [
      'Interface: 10.0.0.10 --- 0x4',
      '  Internet Address      Physical Address      Type',
      '  10.0.0.1              aa-bb-cc-dd-ee-01     dynamic',
      '  10.0.0.255            ff-ff-ff-ff-ff-ff     static',
      '  224.0.0.22            01-00-5e-00-00-16     static',
      '  239.255.255.250       01-00-5e-7f-ff-fa     static',
      '  169.254.10.20         aa-bb-cc-dd-ee-20     dynamic',
      '  127.0.0.1             aa-bb-cc-dd-ee-21     static',
      '? (10.0.0.9) at (incomplete) on eth0',
      '10.0.0.8 0x1 0x0 00:00:00:00:00:00 * eth0',
      '  10.0.0.1              aa-bb-cc-dd-ee-01     dynamic'
    ].join('\n');
    const w = seenExtract(win);
    ok('only the one real entry is kept, once', w.rows.length === 1 && w.rows[0].ip === '10.0.0.1' && w.rows[0].line === 3, show(w.rows));
    ok('the rest is counted as left out (the heading, broadcast, multicast, link-local, loopback, incomplete, zero MAC)', w.skipped === 8, String(w.skipped));
    ok('a line with no address at all is not counted', seenExtract('Internet Address  Physical Address  Type\n').skipped === 0);
    const isc = seenExtract([
      'lease 10.0.0.30 {',
      '  starts 3 2026/10/21 10:00:00;',
      '  binding state active;',
      '  hardware ethernet aa:bb:cc:dd:ee:30;',
      '  client-hostname "reception-pc";',
      '}',
      'lease 10.0.0.31 {',
      '  hardware ethernet aa:bb:cc:dd:ee:31;',
      '}'
    ].join('\n'));
    ok('an ISC lease block is one entry, with its client-hostname', isc.rows.length === 2 && same(isc.rows[0], '10.0.0.30', 'aa:bb:cc:dd:ee:30', 'reception-pc') && isc.rows[0].line === 1
       && same(isc.rows[1], '10.0.0.31', 'aa:bb:cc:dd:ee:31', ''), show(isc.rows));
    const mt = seenExtract([
      ' 0 D address=10.0.0.40 mac-address=AA:BB:CC:DD:EE:40 client-id="1:aa:bb:cc:dd:ee:40"',
      '      server=dhcp1 status=bound expires-after=9m50s',
      '      active-address=10.0.0.40 host-name="nurse-station"',
      ' 1 D address=10.0.0.41 mac-address=AA:BB:CC:DD:EE:41 host-name=""',
      '      server=dhcp1 status=bound'
    ].join('\n'));
    ok('MikroTik\'s continuation lines join their entry, and an empty host-name is no name', mt.rows.length === 2
       && same(mt.rows[0], '10.0.0.40', 'aa:bb:cc:dd:ee:40', 'nurse-station') && same(mt.rows[1], '10.0.0.41', 'aa:bb:cc:dd:ee:41', ''), show(mt.rows));
    const iscNoName = seenExtract([
      'lease 10.0.0.7 {',
      ' starts 4 2026/10/01 10:00:00;',
      ' binding state active;',
      ' hardware ethernet aa:bb:cc:dd:ee:07;',
      ' set vendor-class-identifier = "MSFT 5.0";',
      '}'
    ].join('\n'));
    ok('an ISC lease with no client-hostname has no name (not its vendor-class key)', iscNoName.rows.length === 1 && same(iscNoName.rows[0], '10.0.0.7', 'aa:bb:cc:dd:ee:07', ''), show(iscNoName.rows));
    const mtNoName = seenExtract(' 2 D address=10.0.0.42 mac-address=AA:BB:CC:DD:EE:42 server=dhcp1 status=bound');
    ok('a MikroTik detail entry with no host-name key has no name', mtNoName.rows.length === 1 && mtNoName.rows[0].host === '', show(mtNoName.rows));
    ok('the same address with two MACs is two observations', seenExtract('10.0.0.5 aa:bb:cc:dd:ee:05\n10.0.0.5 aa:bb:cc:dd:ee:06').rows.length === 2);
    ok('a second sighting lends its name to the first', seenExtract('10.0.0.5 aa:bb:cc:dd:ee:05\npc9 (10.0.0.5) at aa:bb:cc:dd:ee:05 on eth0').rows[0].host === 'pc9');
    ok('the documentation ranges are networks like any other', seenExtract('192.0.2.5 aa:bb:cc:dd:ee:05').rows.length === 1);
    // ---- Network scans: nmap (normal and XML), arp-scan, netdiscover ----
    const nm = seenExtract([
      'Starting Nmap 7.94 ( https://nmap.org ) at 2026-10-30 10:00 CST',
      'Nmap scan report for router.lan (10.0.0.1)',
      'Host is up (0.0010s latency).',
      'MAC Address: AA:BB:CC:DD:EE:01 (Routerboard.com)',
      'Nmap scan report for 10.0.0.5',
      'Host is up (0.0020s latency).',
      'Not shown: 998 closed tcp ports (reset)',
      'PORT   STATE SERVICE',
      '22/tcp open  ssh',
      '80/tcp open  http',
      'MAC Address: AA:BB:CC:DD:EE:05 (Raspberry Pi Trading)',
      'Nmap scan report for 10.0.0.9 [host down]',
      'Nmap scan report for me.lan (10.0.0.10)',
      'Host is up.',
      'Nmap done: 256 IP addresses (3 hosts up) scanned in 2.10 seconds'
    ].join('\n'));
    ok('nmap: a report and the MAC lines under it are one host, its name from "name (address)"', nm.rows.length === 3
       && same(nm.rows[0], '10.0.0.1', 'aa:bb:cc:dd:ee:01', 'router') && nm.rows[0].line === 2
       && same(nm.rows[1], '10.0.0.5', 'aa:bb:cc:dd:ee:05', ''), show(nm.rows));
    ok('nmap: a host down is not counted, one up without a MAC is kept and counted', !nm.rows.some((r) => r.ip === '10.0.0.9')
       && same(nm.rows[2], '10.0.0.10', '', 'me') && nm.noMac === 1 && nm.skipped === 0, show(nm));
    const nx = seenExtract([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<nmaprun scanner="nmap" args="nmap -sn -oX - 10.0.0.0/24">',
      '<hosthint><status state="up" reason="unknown-response"/><address addr="10.0.0.20" addrtype="ipv4"/></hosthint>',
      '<host starttime="1"><status state="up" reason="arp-response"/>',
      '<address addr="10.0.0.20" addrtype="ipv4"/>',
      '<address addr="AA:BB:CC:DD:EE:20" addrtype="mac" vendor="Hikvision"/>',
      '<hostnames><hostname name="cam-20.lan" type="PTR"/><hostname name="lobby-cam" type="user"/></hostnames>',
      '</host>',
      "<host><status state='down' reason='no-response'/><address addr='10.0.0.21' addrtype='ipv4'/></host>",
      '<host><status state="up"/><address addr="FF:FF:FF:FF:FF:FF" addrtype="mac"/><address addr="10.0.0.22" addrtype="ipv4"/></host>',
      '<host><status state="up"/><address addr="2001:db8::23" addrtype="ipv6"/><hostnames><hostname name="nas.example.com" type="PTR"/></hostnames></host>',
      '</nmaprun>'
    ].join('\n'));
    ok('nmap XML: a <host> once (not its <hosthint>), the user\'s name before the PTR one, on the line it starts', nx.rows.length === 2
       && same(nx.rows[0], '10.0.0.20', 'aa:bb:cc:dd:ee:20', 'lobby-cam') && nx.rows[0].line === 4, show(nx.rows));
    ok('nmap XML: a host down is not counted, a broadcast MAC is left out, an IPv6 host with no MAC is kept', nx.skipped === 1
       && same(nx.rows[1], '2001:db8::23', '', 'nas') && nx.noMac === 1, show(nx));
    const as = seenExtract([
      'Interface: eth0, type: EN10MB, MAC: aa:bb:cc:dd:ee:10, IPv4: 10.0.0.10',
      'Starting arp-scan 1.10.0 with 256 hosts (https://github.com/royhills/arp-scan)',
      '10.0.0.1\taa:bb:cc:dd:ee:01\tRouterboard.com',
      '10.0.0.5\taa:bb:cc:dd:ee:05\tRaspberry Pi Trading Ltd',
      '10.0.0.6\taa:bb:cc:dd:ee:06\t(Unknown: locally administered)',
      '',
      'Ending arp-scan 1.10.0: 256 hosts scanned in 1.9 seconds (134.74 hosts/sec). 3 responded'
    ].join('\n'));
    ok('arp-scan: the maker after the MAC is never a name', as.rows.length === 4 && as.rows.every((r) => r.host === ''), show(as.rows));
    ok('arp-scan body lines without the banner: a maker with spaces is not a name', one('10.0.0.5\taa:bb:cc:dd:ee:05\tRaspberry Pi Trading Ltd').host === '');
    const nd = seenExtract([
      ' Currently scanning: Finished!   |   Screen View: Unique Hosts',
      '   IP            At MAC Address     Count     Len  MAC Vendor / Hostname',
      ' -----------------------------------------------------------------------------',
      ' 10.0.0.1        aa:bb:cc:dd:ee:01      1      60  Routerboard.com',
      ' 10.0.0.5        aa:bb:cc:dd:ee:05      3     180  Raspberry Pi Trading Ltd'
    ].join('\n'));
    ok('netdiscover: the vendor column is never a name', nd.rows.length === 2 && nd.rows.every((r) => r.host === ''), show(nd.rows));

    ok('a plain spreadsheet line without a MAC yields nothing',seenExtract('Hostname,IP Address\nPC-1,10.0.0.11').rows.length === 0);

    // ---- 3 & 4: the import dialog ----
    const lab = () => ({ v: DOC_VERSION,
      networks: [{ id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }],
      nodes: [
        { id: 'rt', type: 'router', name: 'Core', x: 300, y: 40, nat: true, interfaces: [{ id: 'w', name: 'eth0', ip: '10.0.0.1/24' }] },
        { id: 'sw', type: 'switch', name: 'SW-1', x: 300, y: 160, portCount: 8, interfaces: [] },
        { id: 'pc1', type: 'pc', name: 'Reception PC', x: 200, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] },
        { id: 'pc2', type: 'pc', name: 'PC-2', x: 300, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24', mac: 'AA:BB:CC:00:00:12' }] }
      ],
      links: [
        { id: 'lr', source: 'rt', target: 'sw', sourceIface: 'w', targetIface: 'p8' },
        { id: 'l1', source: 'sw', target: 'pc1', sourceIface: 'p1', targetIface: 'i1' },
        { id: 'l2', source: 'sw', target: 'pc2', sourceIface: 'p2', targetIface: 'i1' }
      ] });
    replaceDocument(lab(), { origin: 'file' }); initHistory();
    const arp = [
      'Interface: 10.0.0.10 --- 0x4',
      '  10.0.0.11             aa-bb-cc-00-00-11     dynamic',
      'DESKTOP-8F3K2Q (10.0.0.12) at aa:bb:cc:00:00:12 [ether] on eth0',
      'printer-2f (10.0.0.60) at aa:bb:cc:00:00:60 [ether] on eth0',
      '  172.16.9.9            aa-bb-cc-00-09-09     dynamic'
    ].join('\n');
    openCsvDialog('import');
    el('csvText').value = arp;
    _csv.headings = null; _csv.mode = null; _csv.chosen.clear();
    csvReparse(); renderCsvDialog();
    ok('pasted ARP output is read as addresses seen', csvMode() === 'seen' && shown('csvReadAs')
       && el('csvReadAs').querySelector('[data-readas="seen"]').getAttribute('aria-pressed') === 'true');
    ok('three columns, mapped to IP, MAC and name', el('csvMap').querySelectorAll('select').length === 3
       && el('csvCol-0').value === 'if:ip' && el('csvCol-1').value === 'if:mac' && el('csvCol-2').value === 'name');
    ok('no headings checkbox for it', el('csvHasHeadings').closest('label').classList.contains('hidden'));
    ok('it says what it found and what it left out', /Addresses seen with their MAC: 4, with a name: 2\./.test(el('csvKind').textContent) && /Lines left out: 1/.test(el('csvKind').textContent), el('csvKind').textContent);
    el('csvReviewBtn').click();
    const plan = _csv.plan;
    const rowAt = (i) => plan.rows.find((r) => r.index === i);
    ok('a known address gains its MAC', rowAt(0).status === 'change' && rowAt(0).nodeId === 'pc1' && rowAt(0).changes.some((c) => /aa:bb:cc:00:00:11/i.test(c.after)), show(rowAt(0)));
    ok('a name seen on the wire does not rename the device', rowAt(1).status === 'same' && rowAt(1).nodeId === 'pc2' && rowAt(1).notes.some((n) => /Seen as DESKTOP-8F3K2Q\./.test(n)), show(rowAt(1)));
    ok('a new address is added under its name', rowAt(2).status === 'add' && rowAt(2).name === 'printer-2f', show(rowAt(2)));
    ok('an address in no network is a conflict that says so', rowAt(3).status === 'conflict' && /needs its prefix/.test(rowAt(3).why), show(rowAt(3)));
    ok('rows are numbered by the line of the text', /Line 2/.test(el('csvPreview').textContent) && /Line 5/.test(el('csvPreview').textContent) && !/Row \d/.test(el('csvPreview').textContent));
    const undoAt = _undoStack.length;
    el('csvApplyBtn').click();
    ok('Apply: one undo step', _undoStack.length === undoAt + 1 && el('csvDialog').hidden);
    ok('the MAC is on the device, the name is not changed', /AA:?BB:?CC:?00:?00:?11/i.test(getNode('pc1').interfaces[0].mac) && getNode('pc2').name === 'PC-2');
    const pr = nodeByName('printer-2f');
    ok('the new device has the address with the network\'s prefix and the MAC', pr && pr.interfaces[0].ip === '10.0.0.60/24' && normMac(pr.interfaces[0].mac) === 'AABBCC000060', pr && show(pr.interfaces));
    undo();
    ok('undo takes it all back', !nodeByName('printer-2f') && !getNode('pc1').interfaces[0].mac);

    // A seen name is not how a device is found: one lease called like a
    // device on the map (DHCP names repeat) is a new device, not that one's
    // address rewritten.
    replaceDocument(lab(), { origin: 'file' }); initHistory();
    openCsvDialog('import');
    el('csvText').value = 'PC-2 (10.0.0.77) at aa:bb:cc:00:00:77 [ether] on eth0';
    _csv.headings = null; _csv.mode = null; _csv.chosen.clear();
    csvReparse(); renderCsvDialog();
    el('csvReviewBtn').click();
    const byName = _csv.plan.rows[0];
    ok('a seen name matching a device on the map does not find it', _csv.plan.observed && byName.status === 'add' && !byName.nodeId
       && byName.notes.some((n) => /A device on the map is also called PC-2/.test(n)), show(byName));
    el('csvApplyBtn').click();
    ok('that device keeps its address and MAC', getNode('pc2').interfaces[0].ip === '10.0.0.12/24' && normMac(getNode('pc2').interfaces[0].mac) === 'AABBCC000012', show(getNode('pc2').interfaces));
    undo();
    // A real sheet still finds by name.
    openCsvDialog('import');
    el('csvText').value = 'Name,IP\nPC-2,10.0.0.77/24';
    _csv.headings = null; _csv.mode = null; _csv.chosen.clear();
    csvReparse(); renderCsvDialog();
    el('csvReviewBtn').click();
    ok('a spreadsheet row is still found by its name', !_csv.plan.observed && _csv.plan.rows[0].nodeId === 'pc2' && _csv.plan.rows[0].status === 'change', show(_csv.plan.rows[0]));
    el('csvBackBtn').click();
    closeCsvDialog();

    // An nmap scan goes through the same review; a host found without its
    // MAC is found by its address, or added with none.
    replaceDocument(lab(), { origin: 'file' }); initHistory();
    openCsvDialog('import');
    el('csvText').value = [
      'Nmap scan report for 10.0.0.11', 'Host is up (0.0010s latency).', 'MAC Address: AA:BB:CC:00:00:11 (Dell)',
      'Nmap scan report for pc-2.lan (10.0.0.12)', 'Host is up.',
      'Nmap scan report for scanner.lan (10.0.0.70)', 'Host is up.'
    ].join('\n');
    _csv.headings = null; _csv.mode = null; _csv.chosen.clear();
    csvReparse(); renderCsvDialog();
    ok('nmap output is read as addresses seen, and says how many came without a MAC', csvMode() === 'seen'
       && /Addresses seen with their MAC: 3, with a name: 2\./.test(el('csvKind').textContent) && /without their MAC[^:]*: 2\./.test(el('csvKind').textContent), el('csvKind').textContent);
    el('csvReviewBtn').click();
    const np = _csv.plan, nAt = (i) => np.rows.find((r) => r.index === i);
    ok('nmap: a known address gains its MAC', nAt(0).status === 'change' && nAt(0).nodeId === 'pc1', show(nAt(0)));
    ok('nmap: a host without a MAC is found by its address and keeps the MAC it has', nAt(1).status === 'same' && nAt(1).nodeId === 'pc2', show(nAt(1)));
    ok('nmap: a new host without a MAC is added under its name', nAt(2).status === 'add' && nAt(2).name === 'scanner', show(nAt(2)));
    el('csvApplyBtn').click();
    const sc = nodeByName('scanner');
    ok('nmap: the new device has its address and no MAC; the old one keeps its MAC', sc && sc.interfaces[0].ip === '10.0.0.70/24' && !sc.interfaces[0].mac
       && normMac(getNode('pc2').interfaces[0].mac) === 'AABBCC000012', sc && show(sc.interfaces));
    undo();

    // The GUI scanners export spreadsheets: their columns map as a sheet's.
    const scanSheets = [
      ['Advanced IP Scanner', 'Status,Name,IP,Manufacturer,MAC address,Comments\nOn,KIOSK-1,10.0.0.50,Dell Inc.,AA:BB:CC:00:00:50,'],
      ['Angry IP Scanner', '"IP","Ping","Hostname","Ports [3+]","MAC Address"\n"10.0.0.50","2 ms","kiosk-1.lan","[n/a]","AA:BB:CC:00:00:50"']
    ];
    scanSheets.forEach(([what, text]) => {
      openCsvDialog('import');
      el('csvText').value = text;
      _csv.headings = null; _csv.mode = null; _csv.chosen.clear();
      csvReparse(); renderCsvDialog();
      ok(`${what} export maps its address, MAC and name, and is one kind of sheet`, csvMode() === 'sheet' && _csv.mapping.includes('if:ip') && _csv.mapping.includes('if:mac') && _csv.mapping.includes('name')
         && !/^mixed/.test(csvSheetKind(_csv.mapping)), JSON.stringify(_csv.mapping));
      closeCsvDialog();
    });

    // A sheet with an address column stays a sheet; Read as overrides.
    openCsvDialog('import');
    el('csvText').value = 'Hostname,IP Address,MAC Address\nKiosk,10.0.0.50,aa:bb:cc:00:00:50';
    _csv.headings = null; _csv.mode = null; _csv.chosen.clear();
    csvReparse(); renderCsvDialog();
    ok('a sheet with IP and MAC columns stays a sheet', csvMode() === 'sheet' && el('csvCol-0').value === 'name' && !el('csvHasHeadings').closest('label').classList.contains('hidden'));
    el('csvReadAs').querySelector('[data-readas="seen"]').click();
    ok('Read as switches it to addresses seen', csvMode() === 'seen' && el('csvCol-0').value === 'if:ip' && csvCurrentSheet().rows.length === 1 && csvCurrentSheet().rows[0][2] === 'Kiosk');
    el('csvReadAs').querySelector('[data-readas="sheet"]').click();
    ok('and back', csvMode() === 'sheet' && el('csvCol-0').value === 'name');
    el('csvText').value = 'just some words';
    _csv.mode = null; csvReparse(); renderCsvDialog();
    ok('text with no address and MAC offers no Read as', !shown('csvReadAs'));
    closeCsvDialog();

    // ---- 5: Re-cable ----
    const P = (id, name, x, ip) => ({ id, type: 'voip', name, x, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
    const rlab = () => ({ v: DOC_VERSION,
      networks: [{ id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }, { id: 'n20', cidr: '10.0.20.0/24', name: 'Voice', gateway: '10.0.20.1' }],
      nodes: [
        { id: 'rt', type: 'router', name: 'Core', x: 300, y: 40, interfaces: [{ id: 'w', name: 'eth0', ip: '10.0.0.1/24' }, { id: 'v', name: 'eth1', ip: '10.0.20.1/24' },
          { id: 'x', name: 'eth2', ip: '' }, { id: 'y', name: 'eth3', ip: '' }, { id: 'z', name: 'eth4', ip: '' }] },
        { id: 'direct', type: 'pc', name: 'Direct', x: 50, y: 40, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.60/24' }] },
        { id: 'two', type: 'server', name: 'Two', x: 50, y: 100, interfaces: [{ id: 'a', name: 'eth0', ip: '10.0.0.61/24' }, { id: 'b', name: 'eth1', ip: '' }] },
        { id: 'swA', type: 'switch', name: 'SW-A', x: 200, y: 160, portCount: 8, interfaces: [] },
        { id: 'swB', type: 'switch', name: 'SW-B', x: 500, y: 160, portCount: 4, portScheme: { prefix: 'Gi1/0/', start: 1 }, interfaces: [] },
        { id: 'swC', type: 'switch', name: 'SW-C', x: 900, y: 160, portCount: 8, interfaces: [] },
        { id: 'ap', type: 'ap', name: 'AP-1', x: 700, y: 160, interfaces: [{ id: 'r', name: 'wlan0', ip: '' }] },
        P('ph3', 'Phone 3', 100, '10.0.0.13/24'), P('ph1', 'Phone 1', 150, '10.0.0.11/24'), P('ph2', 'Phone 2', 200, '10.0.0.12/24'),
        P('onB', 'Phone B', 400, '10.0.0.20/24'),
        P('loose', 'Phone L', 600, '10.0.0.30/24'),
        { id: 'lap', type: 'pc', name: 'Laptop', x: 700, y: 300, interfaces: [{ id: 'w', name: 'wlan0', ip: '10.0.0.40/24' }] },
        { id: 'dual', type: 'server', name: 'Dual', x: 800, y: 300, interfaces: [{ id: 'a', name: 'eth0', ip: '10.0.0.50/24' }, { id: 'b', name: 'eth1', ip: '' }] }
      ],
      links: [
        { id: 'ld', source: 'rt', target: 'direct', sourceIface: 'x', targetIface: 'i1' },
        { id: 'lt1', source: 'rt', target: 'two', sourceIface: 'y', targetIface: 'a' },
        { id: 'lt2', source: 'rt', target: 'two', sourceIface: 'z', targetIface: 'b' },
        { id: 'lrA', source: 'rt', target: 'swA', sourceIface: 'w', targetIface: 'p8' },
        { id: 'lrB', source: 'rt', target: 'swB', sourceIface: 'v', targetIface: 'p4' },
        { id: 'l3', source: 'swA', target: 'ph3', sourceIface: 'p1', targetIface: 'i1', cable: { label: 'D-03' } },
        { id: 'l1', source: 'ph1', target: 'swA', sourceIface: 'i1', targetIface: 'p3' },
        { id: 'l2', source: 'swA', target: 'ph2', sourceIface: 'p2', targetIface: 'i1' },
        { id: 'lb', source: 'swB', target: 'onB', sourceIface: 'p1', targetIface: 'i1' },
        { id: 'lw', source: 'ap', target: 'lap', sourceIface: 'r', targetIface: 'w', medium: 'wireless' },
        { id: 'd1', source: 'swA', target: 'dual', sourceIface: 'p5', targetIface: 'a' },
        { id: 'd2', source: 'swB', target: 'dual', sourceIface: 'p2', targetIface: 'b' }
      ] });
    replaceDocument(rlab(), { origin: 'file' }); initHistory();
    const pickSet = (ids) => selectEntries(ids.map((id) => ({ type: 'node', id })));
    pickSet(['ph1', 'ph2', 'ph3']);
    el('bulkTabs').querySelector('[data-bulk="recable"]').click();
    ok('Re-cable is a tab of the bulk panel', shown('bulkPane-recable') && !shown('bulkPane-move'));
    ok('it lists every switch and access point', [...el('bulkSwitch').options].map((o) => o.value).sort().join(',') === 'ap,swA,swB,swC', [...el('bulkSwitch').options].map((o) => o.value).join(','));
    let p = bulkPlanRecable(['ph1', 'ph2', 'ph3'], { target: 'swB', from: '', order: 'port' });
    ok('one free port (Gi1/0/3) for the first in switch-port order', p.rows[0].nodeId === 'ph3' && p.rows[0].status === 'change' && p.rows[0].after === 'SW-B · Gi1/0/3', show(p.rows[0]));
    ok('the full faceplate refuses the other two', p.counts.change === 1 && p.counts.bad === 2 && /No free port left on SW-B/.test(p.rows[2].why), show(p.rows[2]));
    p = bulkPlanRecable(['ph1', 'ph2', 'ph3'], { target: 'swA', from: '', order: 'port' });
    ok('already on the target: unchanged', p.counts.same === 3 && p.counts.change === 0 && /Already on SW-A/.test(p.rows[0].why));
    // Back onto SW-B with room: one port free (p3) once its count grows.
    const big = rlab(); big.nodes.find((n) => n.id === 'swB').portCount = 12;
    replaceDocument(big, { origin: 'file' }); initHistory();
    p = bulkPlanRecable(['ph1', 'ph2', 'ph3'], { target: 'swB', from: '', order: 'port' });
    ok('in switch-port order onto the free ports (Gi1/0/3, 5, 6: 4 is the uplink)', p.rows.map((r) => `${r.nodeId}>${r.after}`).join(',') === 'ph3>SW-B · Gi1/0/3,ph2>SW-B · Gi1/0/5,ph1>SW-B · Gi1/0/6',
       p.rows.map((r) => `${r.nodeId}>${r.after}`).join(','));
    ok('before says where each was', p.rows[0].before === 'SW-A · 1' && p.rows[2].before === 'SW-A · 3', p.rows.map((r) => r.before).join(','));
    p = bulkPlanRecable(['ph1', 'ph2', 'ph3'], { target: 'swB', from: 'Gi1/0/9', order: 'name' });
    ok('from a port given, by its name, in name order', p.rows.map((r) => `${r.nodeId}>${r.after}`).join(',') === 'ph1>SW-B · Gi1/0/9,ph2>SW-B · Gi1/0/10,ph3>SW-B · Gi1/0/11', p.rows.map((r) => r.after).join(','));
    p = bulkPlanRecable(['ph1', 'ph2'], { target: 'swB', from: '40', order: 'port' });
    ok('a port the switch does not have is refused', p.errors.length === 1 && /SW-B has no port 40/.test(p.errors[0]), p.errors.join());
    ok('no switch picked: refused', bulkPlanRecable(['ph1', 'ph2'], { target: '' }).errors.length === 1);
    p = bulkPlanRecable(['lap', 'dual', 'swB', 'loose', 'onB'], { target: 'swB', from: '', order: 'name' });
    const why = (id) => p.rows.find((r) => r.nodeId === id);
    ok('a wireless client is left as it is', why('lap').status === 'skip' && /Not on a switch port/.test(why('lap').why), show(why('lap')));
    ok('a device on two switches is left as it is', why('dual').status === 'same' || (why('dual').status === 'skip' && /more than one switch/.test(why('dual').why)), show(why('dual')));
    ok('the target itself is left as it is', why('swB').status === 'skip' && /This is the switch/.test(why('swB').why));
    ok('a device with no cable gets one', why('loose').status === 'change' && why('loose').before === 'No cable' && p.ops.some((op) => op.addLink && op.addLink.target === 'loose' && op.addLink.source === 'swB'));
    ok('one already there is unchanged', why('onB').status === 'same');
    p = bulkPlanRecable(['direct', 'two', 'rt'], { target: 'swC', from: '', order: 'name' });
    const row = (id) => p.rows.find((r) => r.nodeId === id);
    ok('a PC plugged straight into the router has that one cable to move', row('direct').status === 'change' && row('direct').before === 'Core · eth2' && row('direct').after === 'SW-C · 1'
       && p.ops.some((op) => op.linkId === 'ld' && op.set.source === 'swC' && op.set.sourceIface === 'p1'), show(row('direct')));
    ok('a host with two such cables is left as it is', row('two').status === 'skip' && /More than one cable/.test(row('two').why), show(row('two')));
    ok('a router on two switches is left as it is', row('rt').status === 'skip' && /more than one switch/.test(row('rt').why), show(row('rt')));
    const p2 = bulkPlanRecable(['dual', 'ph1'], { target: 'rt' });
    ok('a router is not a switch to move onto', p2.errors.length === 1);
    const pd = bulkPlanRecable(['dual', 'ph1'], { target: 'ap' });
    ok('a device cabled to two switches (neither the target) is left', pd.rows.find((r) => r.nodeId === 'dual').status === 'skip' && /more than one switch/.test(pd.rows.find((r) => r.nodeId === 'dual').why));

    // The preview and Apply through the panel.
    pickSet(['ph1', 'ph2', 'ph3']);
    el('bulkTabs').querySelector('[data-bulk="recable"]').click();
    el('bulkSwitch').value = 'swC'; el('bulkSwitch').dispatchEvent(new Event('change', { bubbles: true }));
    ok('Preview is offered once a switch is picked', !el('bulkPreviewBtn').disabled);
    const before = JSON.stringify(state.links);
    el('bulkPreviewBtn').click();
    ok('the preview names the switch', !el('bulkDialog').hidden && el('bulkTitle').textContent === 'Re-cable onto SW-C', el('bulkTitle').textContent);
    // SW-C hangs off nothing: three phones moved there lose their gateway.
    ok('and says what the checks would find', /\+\s*3/.test(el('bulkDelta').textContent), el('bulkDelta').textContent);
    ok('nothing written by the preview', JSON.stringify(state.links) === before);
    closeBulkPreview();
    el('bulkSwitch').value = 'swB'; el('bulkSwitch').dispatchEvent(new Event('change', { bubbles: true }));
    el('bulkPreviewBtn').click();
    const undoBefore = _undoStack.length;
    el('bulkApplyBtn').click();
    const l3 = getLink('l3');
    ok('Apply moves the cables, one undo step', _undoStack.length === undoBefore + 1 && l3.source === 'swB' && l3.sourceIface === 'p3' && getLink('l1').target === 'swB' && getLink('l1').targetIface === 'p6');
    ok('the cable keeps its id, its label and the device\'s own end', l3.target === 'ph3' && l3.targetIface === 'i1' && cableOf(l3, 'label') === 'D-03');
    ok('and the devices their addresses', getNode('ph3').interfaces[0].ip === '10.0.0.13/24');
    undo();
    ok('undo puts them back', getLink('l3').source === 'swA' && getLink('l3').sourceIface === 'p1' && getLink('l1').target === 'swA');
    // The new cable for a device with none, bound on Apply.
    pickSet(['loose', 'onB']);
    _bulk.tab = 'recable'; bulkDraft().recable.target = 'swB'; renderBulkPanel();
    const n0 = state.links.length;
    applyBulkPlan(bulkPlan(bulkRequest('recable')));
    const nl = state.links.find((l) => l.target === 'loose' || l.source === 'loose');
    ok('an unplugged device is cabled onto the next free port, its own end bound', state.links.length === n0 + 1 && nl && nl.source === 'swB' && nl.sourceIface === 'p3' && nl.targetIface === 'i1', nl && JSON.stringify(nl));
    undo();
    ok('and undo takes the cable away', state.links.length === n0);

    // Two devices of the set joined only to each other share one cable: it
    // is moved once, and the other gets a cable of its own (it once came back
    // as a cable from the switch to itself, neither PC cabled).
    replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'pa', type: 'pc', name: 'PA', x: 100, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] },
      { id: 'pb', type: 'pc', name: 'PB', x: 200, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] },
      { id: 'swT', type: 'switch', name: 'SW-T', x: 150, y: 250, interfaces: [] }
    ], links: [{ id: 'lx', source: 'pa', target: 'pb', sourceIface: 'i1', targetIface: 'i1' }] }, { origin: 'file' }); initHistory();
    const pp = bulkPlan({ action: 'recable', ids: ['pa', 'pb'], recable: { target: 'swT' } });
    ok('a pair on one cable: both planned onto the switch', pp.counts.change === 2 && pp.rows.map((r) => [r.nodeId, r.before].join(':') + '>' + r.after).join(',') === 'pa:PB · eth0>SW-T · 1,pb:PA · eth0>SW-T · 2',
       pp.rows.map((r) => [r.nodeId, r.before].join(':') + '>' + r.after).join(','));
    ok('the shared cable is moved once', pp.ops.filter((op) => op.linkId === 'lx').length === 1 && pp.ops.filter((op) => op.addLink).length === 1);
    applyBulkPlan(pp);
    const ends = (l) => [l.source, l.target].sort().join('-');
    const atPa = state.links.filter((l) => l.source === 'pa' || l.target === 'pa'), atPb = state.links.filter((l) => l.source === 'pb' || l.target === 'pb');
    ok('after Apply each PC has one cable to the switch, and no cable joins the switch to itself', atPa.length === 1 && ends(atPa[0]) === 'pa-swT' && atPb.length === 1 && ends(atPb[0]) === 'pb-swT'
       && !state.links.some((l) => l.source === l.target), JSON.stringify(state.links));
    const ports = state.links.map((l) => ifaceIdOn(l, 'swT')).sort().join(',');
    ok('on two different ports', ports === 'p1,p2', ports);
    undo();
    ok('undo puts the one cable back', state.links.length === 1 && ends(getLink('lx')) === 'pa-pb');
    replaceDocument(rlab(), { origin: 'file' }); initHistory();

    // ---- 6: words ----
    setLocale('es'); applyLocale();
    ok('the Re-cable tab and its sentences are translated', el('bulkTabs').querySelector('[data-bulk="recable"]').textContent === 'Recablear'
       && bulkPlanRecable(['ph1', 'ph2'], { target: 'swA' }).rows[0].why === 'Ya está en SW-A.', el('bulkTabs').querySelector('[data-bulk="recable"]').textContent);
    ok('so is Read as', el('csvReadAs').querySelector('[data-readas="sheet"]').textContent === 'Filas de hoja de cálculo');
    ok('the switch label stays English', el('bulkSwitch').labels[0].textContent === 'Switch / AP');
    setLocale('en'); applyLocale();
    select(null, null);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
