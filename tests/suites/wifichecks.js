// Wi-Fi, the checks (Review-Packs/Topo-wifi.md, W2 part 1; js/diagnostics.js
// "Wi-Fi" and radioSettingProblems):
//   1. a healthy site (three APs on two floors, a laptop, a phone, a 6E
//      tablet, every network secured) raises no Wi-Fi finding at all;
//   2. each check fires on the one fault it is about, at its level, naming
//      the devices and the link: a band the AP does not offer, 6 GHz without
//      6E/7, an SSID not broadcast (or not on that band), an SSID whose
//      subnet misses the client, a channel or width the band cannot take,
//      overlapping APs in one room/floor (else one subnet), 2.4 GHz off
//      1/6/11 (info, never counted), open/WEP/WPA, a weak signal (stricter
//      for a phone);
//   3. what is unknown is never a fault (no standard, no channel, no
//      address, no signal), and a retired device is off the air;
//   2b. a mesh backhaul is no client; a client's channel is no AP's; an
//      invalid width overlaps as 20 MHz; one check on the same devices and
//      scope (a network for security, a band for overlap) is one finding,
//      so accepting it cannot hide another; grouped APs with no shared
//      room or floor are not compared by subnet;
//   4. the same findings in the document on screen: the Radio badge, the
//      link's has:finding, accept with reason, and every language.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const json = (v) => JSON.stringify(v);

  const site = () => ({ v: DOC_VERSION, accepted: [],
    networks: [{ id: 'nS', cidr: '10.1.0.0/24', vlan: 10 }, { id: 'nG', cidr: '10.9.0.0/24', vlan: 90 }, { id: 'nM', cidr: '10.2.0.0/24' }],
    groups: [
      { id: 'bld', kind: 'building', name: 'HQ' },
      { id: 'f1', kind: 'floor', name: 'Floor 1', parent: 'bld' },
      { id: 'r1', kind: 'room', name: 'Room 101', parent: 'f1' },
      { id: 'r2', kind: 'room', name: 'Room 102', parent: 'f1' },
      { id: 'f2', kind: 'floor', name: 'Floor 2', parent: 'bld' }
    ],
    wifi: [
      { id: 'wS', ssid: 'Staff', security: 'wpa3', network: 'nS' },
      { id: 'wG', ssid: 'Guest', security: 'owe', bands: ['2.4', '5'], network: 'nG' }
    ],
    nodes: [
      { id: 'ap1', type: 'ap', name: 'AP-1', x: 0, y: 0, group: 'r1', interfaces: [{ id: 'e0', name: 'eth0', ip: '10.1.0.2/24' }, { id: 'w1', name: 'wlan0', ip: '',
        radio: { standard: 'ax', bands: [{ band: '2.4', channel: 1, width: 20 }, { band: '5', channel: 36, width: 80 }] } }] },
      { id: 'ap2', type: 'ap', name: 'AP-2', x: 200, y: 0, group: 'r2', interfaces: [{ id: 'e0', name: 'eth0', ip: '10.1.0.3/24' }, { id: 'w1', name: 'wlan0', ip: '',
        radio: { standard: 'ax', bands: [{ band: '2.4', channel: 6 }, { band: '5', channel: 52, width: 80 }] } }] },
      { id: 'ap3', type: 'ap', name: 'AP-3', x: 400, y: 0, group: 'f2', interfaces: [{ id: 'e0', name: 'eth0', ip: '10.2.0.3/24' }, { id: 'w1', name: 'wlan0', ip: '',
        radio: { standard: 'be', bands: [{ band: '2.4', channel: 1 }, { band: '5', channel: 36, width: 80 }, { band: '6', channel: 37, width: 320 }] } }] },
      { id: 'lap', type: 'pc', name: 'Laptop', x: 0, y: 200, group: 'r1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.1.0.20/24', radio: { standard: 'ax' } }] },
      { id: 'phone', type: 'voip', name: 'Phone', x: 200, y: 200, group: 'r2', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.9.0.5/24' }] },
      { id: 'tab', type: 'pc', name: 'Tablet', x: 400, y: 200, group: 'f2', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.1.0.30/24', radio: { standard: 'axe' } }] }
    ],
    links: [
      { id: 'a1', source: 'lap', target: 'ap1', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { ssid: 'wS', band: '5', signal: -55 } },
      { id: 'a2', source: 'phone', target: 'ap2', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { ssid: 'wG', signal: -60 } },
      { id: 'a3', source: 'tab', target: 'ap3', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { ssid: 'wS', band: '6', signal: -50 } }
    ] });
  const node = (d, id) => d.nodes.find((n) => n.id === id);
  const radio = (d, id) => node(d, id).interfaces.find((i) => i.radio).radio;
  const band = (d, id, b) => radio(d, id).bands.find((x) => x.band === b);
  const link = (d, id) => d.links.find((l) => l.id === id);
  const wifiOf = (d, id) => d.wifi.find((w) => w.id === id);
  // The Wi-Fi findings of a document: its relational ones and its Radio ones.
  const found = (d) => diagnoseDoc(d).findings.filter((f) => /^wifi-/.test(f.key) || f.key === 'radio');
  const of = (d, key) => found(d).filter((f) => f.key === key);
  const show = (list) => list.map((f) => `${f.key}/${f.level}: ${f.detail}`).join(' | ') || 'none';
  const ids = (f) => (f.nodeIds || []).slice().sort().join(',') + (f.linkIds && f.linkIds.length ? '|' + f.linkIds.join(',') : '');

  try {
    setLocale('en');
    // ---- 1: healthy ----
    const healthy = found(site());
    ok('a healthy site raises no Wi-Fi finding', healthy.length === 0, show(healthy));
    ok('and its devices pass the Radio check', ['ap1', 'ap2', 'ap3', 'lap', 'tab'].every((id) => withLookupPass(() => evaluateRadio(node(site(), id))).level !== 'bad'));

    // ---- 2: each check fires ----
    // A band the AP does not offer.
    let d = site(); radio(d, 'ap1').bands = [{ band: '2.4', channel: 1 }];
    let f = of(d, 'wifi-band');
    ok('a client on a band its AP radio does not offer is a Problem', f.length === 1 && f[0].level === 'bad' && /Laptop is on 5 GHz, which the radio of AP-1 does not offer \(it has 2\.4 GHz\)/.test(f[0].detail)
       && ids(f[0]) === 'ap1,lap|a1', show(found(d)));
    d = site(); radio(d, 'lap').bands = [{ band: '2.4' }];
    f = of(d, 'wifi-band');
    ok('so is a band the client\'s own radio does not have', f.length === 1 && f[0].level === 'bad' && /its own radio has only 2\.4 GHz/.test(f[0].detail), show(found(d)));
    d = site(); delete link(d, 'a1').wifi.band; radio(d, 'lap').standard = 'axe'; radio(d, 'lap').bands = [{ band: '6' }];
    f = of(d, 'wifi-band');
    ok('and two ends with no band in common', f.length === 1 && /no band in common: Laptop has 6 GHz, AP-1 has 2\.4 GHz, 5 GHz/.test(f[0].detail), show(found(d)));

    // 6 GHz without 6E/7.
    d = site(); radio(d, 'tab').standard = 'ax';
    f = of(d, 'wifi-band');
    ok('6 GHz with a Wi-Fi 6 client is one Problem naming it', f.length === 1 && f[0].level === 'bad'
       && f[0].detail.includes('Tablet is Wi-Fi 6 (802.11ax). 6 GHz takes Wi-Fi 6E or Wi-Fi 7 at both ends') && ids(f[0]) === 'ap3,tab|a3', show(found(d)));
    d = site(); radio(d, 'ap3').standard = 'ax'; band(d, 'ap3', '6').width = 160;
    f = found(d);
    ok('an AP listing 6 GHz on Wi-Fi 6 is its own Radio Problem, not repeated on the link', of(d, 'radio').length === 1 && of(d, 'radio')[0].level === 'bad'
       && /wlan0 lists 6 GHz, but Wi-Fi 6 \(802\.11ax\) has no 6 GHz/.test(of(d, 'radio')[0].detail) && !of(d, 'wifi-band').length, show(f));
    d = site(); radio(d, 'tab').standard = 'axe'; radio(d, 'ap3').standard = 'be';
    ok('6E at one end and 7 at the other is fine', !of(d, 'wifi-band').length);

    // The SSID.
    d = site(); band(d, 'ap1', '2.4').ssids = ['wG']; band(d, 'ap1', '5').ssids = ['wG'];
    f = of(d, 'wifi-ssid');
    ok('a client on an SSID its AP does not broadcast is a Warning', f.length === 1 && f[0].level === 'warn' && f[0].detail === 'Laptop is set to Staff, but AP-1 does not broadcast it.'
       && ids(f[0]) === 'ap1,lap|a1', show(found(d)));
    d = site(); band(d, 'ap1', '5').ssids = ['wG'];
    f = of(d, 'wifi-ssid');
    ok('and one it broadcasts on another band only', f.length === 1 && f[0].detail === 'Laptop is on Staff on 5 GHz, but AP-1 broadcasts Staff only on 2.4 GHz.', show(found(d)));
    d = site(); delete link(d, 'a1').wifi.ssid; band(d, 'ap1', '2.4').ssids = ['wG']; band(d, 'ap1', '5').ssids = ['wG'];
    ok('an SSID nobody picked is not held against the AP', !of(d, 'wifi-ssid').length, show(found(d)));

    // The subnet.
    d = site(); node(d, 'lap').interfaces[0].ip = '10.9.0.20/24';
    f = of(d, 'wifi-subnet');
    ok('an SSID whose subnet does not hold the client\'s address is a Problem', f.length === 1 && f[0].level === 'bad'
       && f[0].detail === 'Laptop is on Staff, whose subnet is 10.1.0.0/24, but its address 10.9.0.20 is not in it.' && ids(f[0]) === 'ap1,lap|a1', show(found(d)));
    d = site(); node(d, 'lap').interfaces[0].ip = '';
    ok('a client with no address recorded (DHCP) is not flagged', !of(d, 'wifi-subnet').length);
    d = site(); delete wifiOf(d, 'wS').network; node(d, 'lap').interfaces[0].ip = '10.9.0.20/24';
    ok('nor is a network on no subnet', !of(d, 'wifi-subnet').length);

    // Channels and widths.
    d = site(); band(d, 'ap1', '5').channel = 38; band(d, 'ap2', '2.4').channel = 15; band(d, 'ap3', '6').channel = 3;
    f = of(d, 'radio');
    ok('a channel its band does not have is a Problem, per band', f.length === 3 && f.every((x) => x.level === 'bad')
       && f.some((x) => x.detail.includes('wlan0 is on channel 38, which 5 GHz does not have'))
       && f.some((x) => x.detail.includes('wlan0 is on channel 15, which 2.4 GHz does not have (1 to 14)'))
       && f.some((x) => x.detail.includes('wlan0 is on channel 3, which 6 GHz does not have')), show(f));
    d = site(); band(d, 'ap1', '2.4').width = 80; band(d, 'ap2', '5').width = 320; radio(d, 'ap3').standard = 'axe';
    f = of(d, 'radio');
    ok('a width the band or the standard cannot take is a Problem', f.length === 3
       && f.some((x) => x.detail.includes('2.4 GHz is at most 40 MHz wide, not 80 MHz'))
       && f.some((x) => x.detail.includes('320 MHz is on 6 GHz only, not on 5 GHz'))
       && f.some((x) => x.detail.includes('Wi-Fi 6E (802.11ax) bonds at most 160 MHz, not 320 MHz')), show(f));
    d = site(); radio(d, 'ap1').standard = 'n';
    ok('Wi-Fi 4 bonds 40 MHz at most', of(d, 'radio').length === 1 && of(d, 'radio')[0].detail.includes('Wi-Fi 4 (802.11n) bonds at most 40 MHz, not 80 MHz'));
    d = site(); band(d, 'ap1', '5').channel = 38;
    ok('the Radio Problem badges the device on the map', withLookupPass(() => nodeSeverity(node(d, 'ap1'), diagnoseDoc(d))) === 'bad');

    // Same air.
    d = site(); band(d, 'ap2', '5').channel = 44; band(d, 'ap2', '5').width = 20;
    f = of(d, 'wifi-overlap');
    ok('two APs in one floor on overlapping 5 GHz channels (80 MHz counted) are a Warning', f.length === 1 && f[0].level === 'warn'
       && f[0].detail === 'AP-1 (ch 36/80) and AP-2 (ch 44/20) overlap on 5 GHz in Floor 1: they take turns on the same air and slow each other down.' && ids(f[0]) === 'ap1,ap2', show(found(d)));
    d = site(); band(d, 'ap2', '2.4').channel = 1;
    f = of(d, 'wifi-overlap');
    ok('the same channel says so', f.length === 1 && f[0].detail.startsWith('AP-1 and AP-2 are both on 2.4 GHz ch 1/20 in Floor 1'), show(found(d)));
    d = site(); node(d, 'ap2').group = 'r1'; band(d, 'ap2', '2.4').channel = 3;
    f = of(d, 'wifi-overlap');
    ok('the nearest room is named, and 2.4 GHz 1 and 3 overlap', f.length === 1 && f[0].detail.includes('in Room 101'), show(found(d)));
    ok('the same channel on another floor is not flagged', !of(site(), 'wifi-overlap').length);
    d = site(); d.groups = []; d.nodes.forEach((n) => { delete n.group; }); band(d, 'ap2', '2.4').channel = 1;
    f = of(d, 'wifi-overlap');
    ok('with no rooms or floors, the APs on one subnet are compared', f.length === 1 && f[0].detail.includes('in the subnet 10.1.0.0/24') && ids(f[0]) === 'ap1,ap2', show(found(d)));
    d = site(); delete node(d, 'ap2').group; band(d, 'ap2', '2.4').channel = 1;
    ok('one placed and one not is not known to be near', !of(d, 'wifi-overlap').length, show(found(d)));
    // Grouped, but in no shared room or floor: the subnet does not stand in.
    d = site(); d.groups.push({ id: 'b2', kind: 'building', name: 'Annex' }); node(d, 'ap1').group = 'bld'; node(d, 'ap2').group = 'b2'; band(d, 'ap2', '5').channel = 36;
    ok('two APs in different buildings on one subnet are not flagged', !of(d, 'wifi-overlap').length, show(found(d)));
    d = site(); d.groups.push({ id: 'k1', kind: 'rack', name: 'Rack 1' }, { id: 'k2', kind: 'rack', name: 'Rack 2' }); node(d, 'ap1').group = 'k1'; node(d, 'ap2').group = 'k2'; band(d, 'ap2', '5').channel = 36;
    ok('nor are two in racks with no room or floor above them', !of(d, 'wifi-overlap').length, show(found(d)));
    d = site(); delete band(d, 'ap1', '5').channel; delete band(d, 'ap2', '5').channel;
    ok('channels on auto overlap nothing', !of(d, 'wifi-overlap').length);

    // The 2.4 GHz plan.
    d = site(); band(d, 'ap2', '2.4').channel = 9;
    f = of(d, 'wifi-plan');
    ok('2.4 GHz off 1, 6 and 11 is listed as info', f.length === 1 && f[0].level === 'info' && f[0].detail.startsWith('AP-2 (wlan0) is on 2.4 GHz channel 9.') && ids(f[0]) === 'ap2', show(found(d)));
    ok('and never counted', !isCountedFinding(f[0]));

    // Security.
    [['open', /Guest is open: anyone in range can join it/], ['wep', /Guest uses WEP/], ['wpa', /Guest allows WPA \(TKIP\)/]].forEach(([sec, re]) => {
      d = site(); wifiOf(d, 'wG').security = sec;
      f = of(d, 'wifi-security');
      ok(`${sec} security is a Warning naming the APs that broadcast it`, f.length === 1 && f[0].level === 'warn' && re.test(f[0].detail) && ids(f[0]) === 'ap1,ap2,ap3', show(found(d)));
    });
    d = site(); wifiOf(d, 'wG').security = 'owe';
    ok('OWE (Enhanced Open) is fine', !of(d, 'wifi-security').length);
    d = site(); wifiOf(d, 'wG').security = 'open'; ['ap1', 'ap2', 'ap3'].forEach((id) => radio(d, id).bands.forEach((b) => { b.ssids = ['wS']; }));
    ok('an open network no AP broadcasts is not on the air, and not flagged', !of(d, 'wifi-security').length);

    // Signal.
    d = site(); link(d, 'a1').wifi.signal = -80;
    f = of(d, 'wifi-signal');
    ok('a signal under -75 dBm is an Advisory', f.length === 1 && f[0].level === 'warn' && f[0].detail.startsWith('Laptop hears AP-1 at -80 dBm, weaker than -75 dBm') && ids(f[0]) === 'ap1,lap|a1', show(found(d)));
    d = site(); link(d, 'a1').wifi.signal = -70;
    ok('-70 dBm is fine for a laptop', !of(d, 'wifi-signal').length);
    d = site(); link(d, 'a2').wifi.signal = -70;
    f = of(d, 'wifi-signal');
    ok('but not for a VoIP phone, which needs -67', f.length === 1 && f[0].detail.startsWith('Phone hears AP-2 at -70 dBm. A phone needs -67 dBm or better'), show(found(d)));
    d = site(); link(d, 'a2').wifi.signal = -65;
    ok('-65 dBm is fine for a phone', !of(d, 'wifi-signal').length);

    // ---- 2b: what the verifier found (repair round 1) ----
    // A mesh backhaul: AP-2 joins AP-1 by radio. Its address is a management
    // one, and it is no client of Staff, picked or worked out.
    const mesh = (d) => { d.links.push({ id: 'm1', source: 'ap1', target: 'ap2', sourceIface: 'w1', targetIface: 'w1', medium: 'wireless' }); return d; };
    d = mesh(site()); node(d, 'ap2').interfaces[0].ip = '10.2.0.9/24';
    ok('a mesh backhaul raises no subnet or SSID finding', !found(d).length, show(found(d)));
    replaceDocument(d, { origin: 'file' });
    ok('and works out no SSID for the far AP', linkWifiSsid(state.links.find((l) => l.id === 'm1')) === null);
    d = mesh(site()); node(d, 'ap2').interfaces[0].ip = '10.2.0.9/24'; link(d, 'm1').wifi = { ssid: 'wG' };
    ok('nor when an SSID is typed on it', !of(d, 'wifi-ssid').length && !of(d, 'wifi-subnet').length, show(found(d)));
    d = mesh(site()); radio(d, 'ap1').bands = [{ band: '2.4', channel: 1 }]; radio(d, 'ap2').bands = [{ band: '5', channel: 52 }];
    f = of(d, 'wifi-band').filter((x) => (x.linkIds || []).includes('m1'));
    ok('but its band is still checked', f.length === 1 && /AP-2 and AP-1 have no band in common/.test(f[0].detail), show(found(d)));
    // A client whose channel was recorded is not an AP.
    d = site(); radio(d, 'lap').bands = [{ band: '2.4', channel: 3 }, { band: '5', channel: 40 }];
    ok('a client\'s recorded channel is neither off-plan nor overlapping', !of(d, 'wifi-plan').length && !of(d, 'wifi-overlap').length, show(found(d)));
    // A width the band cannot take is its Radio Problem only.
    d = site(); band(d, 'ap1', '5').width = 320;
    ok('an invalid width is a Radio Problem, not also an overlap', of(d, 'radio').length === 1 && !of(d, 'wifi-overlap').length, show(found(d)));
    d = site(); band(d, 'ap1', '5').width = 320; band(d, 'ap2', '5').channel = 36; band(d, 'ap2', '5').width = 20;
    f = of(d, 'wifi-overlap');
    ok('which overlaps as 20 MHz', f.length === 1 && f[0].detail.startsWith('AP-1 and AP-2 are both on 5 GHz ch 36 in Floor 1'), show(found(d)));
    // One line per check, devices and scope: accepting one cannot hide another.
    d = site(); band(d, 'ap2', '2.4').channel = 1; band(d, 'ap2', '5').channel = 40;
    f = of(d, 'wifi-overlap');
    ok('two APs overlapping on two bands are one finding per band, scoped by it', f.length === 2 && f.map((x) => x.scope).sort().join(',') === '2.4,5'
       && f.every((x) => ids(x) === 'ap1,ap2') && f.find((x) => x.scope === '2.4').detail.includes('2.4 GHz') && !f.find((x) => x.scope === '2.4').detail.includes('5 GHz'), show(found(d)));
    d = site(); wifiOf(d, 'wS').security = 'wep'; wifiOf(d, 'wG').security = 'open';
    f = of(d, 'wifi-security');
    ok('two weak networks on the same APs are one finding each, named by their own SSID', f.length === 2
       && f.find((x) => x.subject === 'Staff' && x.scope === 'wS' && /^Staff uses WEP/.test(x.detail) && !x.detail.includes('Guest'))
       && f.find((x) => x.subject === 'Guest' && x.scope === 'wG' && /^Guest is open/.test(x.detail)), show(found(d)));
    d = site(); radio(d, 'ap1').bands = [{ band: '2.4', channel: 1 }]; radio(d, 'lap').bands = [{ band: '2.4' }];
    f = of(d, 'wifi-band');
    ok('a band neither end has is one finding with both sentences', f.length === 1 && /does not offer/.test(f[0].detail) && /its own radio has only/.test(f[0].detail), show(found(d)));

    // ---- 3: unknown is no fault; retired is off the air ----
    d = site(); d.nodes.forEach((n) => n.interfaces.forEach((i) => { delete i.radio; })); d.links.forEach((l) => { delete l.wifi; });
    ok('radios nobody described and links nobody filled raise nothing', found(d).length === 0, show(found(d)));
    d = site(); link(d, 'a1').wifi.signal = -90; node(d, 'lap').interfaces[0].ip = '10.9.0.20/24'; node(d, 'lap').status = 'retired';
    ok('a retired client\'s link is off the air', !found(d).some((x) => (x.linkIds || []).includes('a1')), show(found(d)));
    d = site(); band(d, 'ap2', '2.4').channel = 1; node(d, 'ap2').status = 'retired'; wifiOf(d, 'wG').security = 'open';
    f = found(d);
    ok('a retired AP shares no air and broadcasts nothing', !of(d, 'wifi-overlap').length && of(d, 'wifi-security').length === 1
       && !of(d, 'wifi-security')[0].nodeIds.includes('ap2'), show(f));

    // ---- 4: on screen ----
    d = site(); link(d, 'a1').wifi.signal = -82; wifiOf(d, 'wG').security = 'wep';
    replaceDocument(d, { origin: 'file' });
    const onScreen = topologyFindings().filter((x) => /^wifi-/.test(x.key));
    ok('the document on screen raises the same findings', onScreen.length === 2, show(onScreen));
    const linkHits = withLookupPass(() => state.links.filter((l) => qLinkSeverity(l)).map((l) => l.id + ':' + qLinkSeverity(l)).join(','));
    ok('the weak link is the one link with a finding of its own (has:advisory)', linkHits === 'a1:warn', linkHits);
    ok('the panel names the checks', groupFindings(onScreen).map((g) => g.check).sort().join(',') === 'Signal,Wi-Fi security');
    const sig = onScreen.find((x) => x.key === 'wifi-signal');
    ok('a Wi-Fi finding can be accepted with a reason, in one step', acceptFindings([sig], 'Storeroom, nobody works there')
       && topologyFindings().find((x) => x.key === 'wifi-signal').accepted && !isCountedFinding(topologyFindings().find((x) => x.key === 'wifi-signal')));
    ok('an accepted entry with no finding is still named', findingCheckName('wifi-signal') === 'Signal' && findingCheckName('wifi-overlap') === 'Channel overlap');
    undo();
    ok('and undone in one', !topologyFindings().find((x) => x.key === 'wifi-signal').accepted);


    const english = topologyFindings().filter((x) => /^wifi-/.test(x.key)).map((x) => x.detail);
    window.CarinoI18N.locales.filter((l) => l !== 'en').forEach((loc) => {
      setLocale(loc);
      const here = topologyFindings().filter((x) => /^wifi-/.test(x.key));
      ok(`${loc}: the same Wi-Fi findings, translated, with the facts in them`, here.length === english.length
         && here.every((x, i) => x.detail !== english[i]) && here.some((x) => x.detail.includes('-82')) && here.some((x) => x.detail.includes('Guest')),
         here.map((x) => x.detail.slice(0, 50)).join(' | '));
      d = site(); radio(d, 'tab').standard = 'ax'; band(d, 'ap2', '2.4').channel = 1; band(d, 'ap1', '5').channel = 38; node(d, 'lap').interfaces[0].ip = '10.9.0.20/24';
      band(d, 'ap2', '2.4').channel = 3; band(d, 'ap1', '2.4').width = 80; link(d, 'a2').wifi.signal = -70;
      const many = found(d);
      ok(`${loc}: every kind of Wi-Fi sentence is translated`, many.length >= 6 && many.every((x) => !/ is on | hears | overlap | stay clear | is at most | does not have /.test(x.detail)),
         many.filter((x) => / is on | hears | overlap | stay clear | is at most | does not have /.test(x.detail)).map((x) => x.detail.slice(0, 60)).join(' | '));
    });
    setLocale('en');

    // Accepting one network's security is not accepting another's, now or
    // later; nor an overlap on one band another on the next.
    d = site(); wifiOf(d, 'wS').security = 'wep';
    replaceDocument(d, { origin: 'file' });
    const sec = (ssid) => topologyFindings().find((x) => x.key === 'wifi-security' && x.subject === ssid);
    ok('a security finding is accepted on its network', acceptFindings([sec('Staff')], 'Old scanners, replaced in spring')
       && state.accepted.length === 1 && state.accepted[0].scope === 'wS' && sec('Staff').accepted);
    batch(() => { state.wifi.find((w) => w.id === 'wG').security = 'open'; save(); renderCanvasOnly(); });
    ok('a network turned open later on the same APs is open and counted', sec('Guest') && !sec('Guest').accepted && isCountedFinding(sec('Guest'))
       && sec('Staff').accepted && !sec('Staff').detail.includes('Guest'), show(topologyFindings().filter((x) => /^wifi-/.test(x.key))));
    const kept = JSON.parse(JSON.stringify(serializeDoc()));
    ok('the scope is written with the entry and read back', kept.accepted.length === 1 && kept.accepted[0].scope === 'wS'
       && normalizeAccepted(kept.accepted)[0].scope === 'wS' && normalizeAccepted([{ check: 'x', nodeIds: ['a'], reason: 'r', scope: 7 }])[0].scope === undefined, json(kept.accepted));
    d = site(); band(d, 'ap2', '2.4').channel = 1;
    replaceDocument(d, { origin: 'file' });
    const lap = (b) => topologyFindings().find((x) => x.key === 'wifi-overlap' && x.scope === b);
    acceptFindings([lap('2.4')], 'Shared on purpose for the old handsets');
    batch(() => { band(state, 'ap2', '5').channel = 40; save(); renderCanvasOnly(); });
    ok('an overlap accepted on 2.4 GHz does not accept a later one on 5 GHz', lap('2.4').accepted && lap('5') && !lap('5').accepted && isCountedFinding(lap('5')));
    d = site(); band(d, 'ap2', '2.4').channel = 1; band(d, 'ap2', '5').channel = 40;
    replaceDocument(d, { origin: 'file' });
    acceptFindings([lap('2.4'), lap('5')], 'Lab, both bands on purpose');
    ok('findings of two scopes accepted together are one entry per scope', state.accepted.length === 2
       && state.accepted.map((a) => a.scope).sort().join(',') === '2.4,5' && lap('2.4').accepted && lap('5').accepted, json(state.accepted));
    undo();
    ok('in one undo step', state.accepted.length === 0 && !lap('2.4').accepted && !lap('5').accepted, json(state.accepted));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  try { setLocale('en'); } catch (e) { /* the page goes with the run */ }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
