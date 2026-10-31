// Wi-Fi, the data (Review-Packs/Topo-wifi.md, W1 part 1; js/model.js "Wi-Fi"):
//   1. the standards by name with the IEEE letters, and every way of writing
//      one, a band, a security mode, a channel, a width and a signal;
//   2. channel validity and overlap with width (2.4 GHz's 22 MHz channels,
//      the 5 and 6 GHz bonded blocks);
//   3. what a radio offers, what two ends share, what an AP broadcasts, and a
//      link's SSID and band when nobody picked them;
//   4. the document: iface.radio, doc.wifi and link.wifi through the schema,
//      the allowlist (no passphrase, no junk key), the references kept sound,
//      v12 and its migration, one undo step, a new AP's default radio, and
//      the Netplan hand-off using the real SSID;
//   5. the query terms ssid:, band:, wifi:, channel: and has:wifi.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const json = (v) => JSON.stringify(v);

  const site = () => ({ v: DOC_VERSION,
    networks: [{ id: 'nS', cidr: '10.1.0.0/24', vlan: 10 }, { id: 'nG', cidr: '10.9.0.0/24', vlan: 90 }],
    wifi: [
      { id: 'wS', ssid: 'Staff', security: 'wpa3', network: 'nS' },
      { id: 'wG', ssid: 'Guest', security: 'owe', bands: ['2.4', '5'], network: 'nG' },
      { id: 'wI', ssid: 'IoT', security: 'wpa2', bands: ['2.4'], hidden: true }
    ],
    nodes: [
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, portCount: 8, interfaces: [] },
      { id: 'ap1', type: 'ap', name: 'AP-1', x: 0, y: 100, interfaces: [{ id: 'w1', name: 'wlan0', ip: '',
        radio: { standard: 'axe', bands: [{ band: '2.4', channel: 6, width: 20, power: 17 }, { band: '5', channel: 36, width: 80 }, { band: '6', channel: 37, width: 160, ssids: ['wS'] }] } }] },
      { id: 'ap2', type: 'ap', name: 'AP-2', x: 200, y: 100, interfaces: [{ id: 'w1', name: 'wlan0', ip: '',
        radio: { standard: 'ac', bands: [{ band: '2.4', channel: 1, ssids: ['wG'] }, { band: '5', channel: 44, width: 80, ssids: ['wG'] }] } }] },
      { id: 'lap', type: 'pc', name: 'Laptop', x: 0, y: 200, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.1.0.20/24', radio: { standard: 'ax' } }] },
      { id: 'phone', type: 'voip', name: 'Phone', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.9.0.5/24' }] },
      { id: 'cam', type: 'camera', name: 'Cam', x: 100, y: 200, interfaces: [{ id: 'i1', name: 'wlan0', ip: '', radio: { bands: ['2.4'] } }] }
    ],
    links: [
      { id: 'u1', source: 'sw', target: 'ap1', sourceIface: 'p1', targetIface: 'p1' },
      { id: 'a1', source: 'lap', target: 'ap1', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { ssid: 'wS', signal: -58 } },
      { id: 'a2', source: 'phone', target: 'ap2', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless' },
      { id: 'a3', source: 'cam', target: 'ap1', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { ssid: 'wI', band: '2.4', signal: -71 } }
    ] });

  try {
    // ---- 1: names and spellings ----
    ok('a standard is its Wi-Fi name with the IEEE letters', wifiStandardName('n') === 'Wi-Fi 4 (802.11n)' && wifiStandardName('ac') === 'Wi-Fi 5 (802.11ac)'
       && wifiStandardName('ax') === 'Wi-Fi 6 (802.11ax)' && wifiStandardName('axe') === 'Wi-Fi 6E (802.11ax)' && wifiStandardName('be') === 'Wi-Fi 7 (802.11be)' && wifiStandardName('x') === '',
       WIFI_STANDARDS.map(wifiStandardName).join(' | '));
    ok('every name reads back as its standard, 6E apart from 6', WIFI_STANDARDS.every((k) => wifiStandardKey(wifiStandardName(k)) === k));
    ok('a standard however it is written', wifiStandardKey('802.11ax') === 'ax' && wifiStandardKey('Wi-Fi 6E') === 'axe' && wifiStandardKey('wifi7') === 'be'
       && wifiStandardKey('6e') === 'axe' && wifiStandardKey('WiFi 5') === 'ac' && wifiStandardKey(4) === 'n' && wifiStandardKey('banana') === '');
    ok('a band however it is written', wifiBandKey('2.4 GHz') === '2.4' && wifiBandKey('2g') === '2.4' && wifiBandKey(2.4) === '2.4' && wifiBandKey('5g') === '5'
       && wifiBandKey('6E') === '6' && wifiBandKey('6 GHz') === '6' && wifiBandKey('7') === '' && wifiBandName('5') === '5 GHz');
    ok('a list of bands, low to high, once each', json(wifiBandList('5, 2.4 GHz, 5')) === '["2.4","5"]' && json(wifiBandList('2.4/5/6')) === '["2.4","5","6"]'
       && json(wifiBandList('2,4 GHz, 5 GHz')) === '["2.4","5"]' && json(wifiBandList('2.4,5')) === '["2.4","5"]' && wifiBandList('2.4 7') === null,
       json(wifiBandList('2,4 GHz, 5 GHz')));
    ok('security by key, name or what a controller calls it', wifiSecurityKey('WPA2-PSK') === 'wpa2' && wifiSecurityKey('WPA3-SAE') === 'wpa3'
       && wifiSecurityKey('WPA2/WPA3') === 'wpa2/3' && wifiSecurityKey('Enhanced Open') === 'owe' && wifiSecurityKey('WPA2 Enterprise') === 'wpa2-ent'
       && wifiSecurityKey('WPA (TKIP)') === 'wpa' && wifiSecurityKey('none') === 'open' && wifiSecurityKey('rot13') === '');
    ok('every security name reads back as its key', WIFI_SECURITY.every((k) => wifiSecurityKey(wifiSecurityName(k)) === k));
    ok('the controller spellings with a cipher, "mixed" or a note in brackets', wifiSecurityKey('WPA2-Personal (AES)') === 'wpa2' && wifiSecurityKey('WPA2 PSK AES') === 'wpa2'
       && wifiSecurityKey('WPA2/WPA3 Personal Mixed') === 'wpa2/3' && wifiSecurityKey('Open (no encryption)') === 'open' && wifiSecurityKey('WPA/WPA2 Mixed') === 'wpa'
       && wifiSecurityKey('OWE (Enhanced Open)') === 'owe' && wifiSecurityKey('WPA2-PSK/WPA3-SAE') === 'wpa2/3' && wifiSecurityKey('WPA3-Enterprise (GCMP-256)') === 'wpa3-ent',
       ['WPA2-Personal (AES)', 'WPA2 PSK AES', 'WPA2/WPA3 Personal Mixed', 'Open (no encryption)', 'WPA/WPA2 Mixed', 'WPA2-PSK/WPA3-SAE', 'WPA3-Enterprise (GCMP-256)'].map(wifiSecurityKey).join(','));
    ok('a standard as "11ax" or its PHY name', wifiStandardKey('11ax') === 'ax' && wifiStandardKey('11n') === 'n' && wifiStandardKey('11be') === 'be'
       && wifiStandardKey('HE') === 'ax' && wifiStandardKey('VHT') === 'ac' && wifiStandardKey('802.11ax (Wi-Fi 6)') === 'ax');
    ok('6E written IEEE first is still 6E', wifiStandardKey('802.11ax (Wi-Fi 6E)') === 'axe' && wifiStandardKey('802.11ax (6E)') === 'axe'
       && wifiStandardKey('Wi-Fi 6E (802.11ax)') === 'axe' && wifiStandardKey('802.11ax (Wi-Fi 7)') === 'ax');
    ok('WPA3 transition mode however it is dressed', ['WPA2/WPA3 Transition', 'WPA2/WPA3 Transitional', 'WPA3 Transition', 'WPA3-Personal Transition', 'wpa2/3 transition']
       .every((x) => wifiSecurityKey(x) === 'wpa2/3') && wifiSecurityKey('WPA2 Transition') === '' && wifiSecurityKey('WPA3-SAE') === 'wpa3');
    ok('channel, width, power and signal as typed', asWifiChannel('36') === 36 && asWifiChannel('ch 6') === 6 && asWifiChannel(0) === undefined && asWifiChannel('auto') === undefined
       && asWifiWidth('80 MHz') === 80 && asWifiWidth(60) === undefined && asWifiPower('20 dBm') === 20 && asWifiPower(90) === undefined);
    ok('a signal is never positive: 67 is -67, and out of range is nothing', asWifiSignal('-67 dBm') === -67 && asWifiSignal(67) === -67 && asWifiSignal(0) === 0
       && asWifiSignal(-120) === undefined && asWifiSignal('weak') === undefined);

    // ---- 2: channels ----
    ok('2.4 GHz channels are 1 to 14', wifiChannelValid('2.4', 1) && wifiChannelValid('2.4', 14) && !wifiChannelValid('2.4', 15) && !wifiChannelValid('2.4', 0));
    ok('5 GHz channels are the valid 20 MHz ones from 36 to 177', wifiChannelValid('5', 36) && wifiChannelValid('5', 144) && wifiChannelValid('5', 177)
       && !wifiChannelValid('5', 38) && !wifiChannelValid('5', 13) && !wifiChannelValid('5', 181));
    ok('6 GHz channels are 1 to 233 in steps of 4', wifiChannelValid('6', 1) && wifiChannelValid('6', 37) && wifiChannelValid('6', 233) && !wifiChannelValid('6', 3) && !wifiChannelValid('6', 237));
    ok('2.4 GHz is at most 40 MHz, 320 is 6 GHz on Wi-Fi 7 only, and a standard bonds no wider than it can',
       wifiWidthValid('2.4', 40) && !wifiWidthValid('2.4', 80) && !wifiWidthValid('5', 320) && wifiWidthValid('6', 320, 'be') && !wifiWidthValid('6', 320, 'axe')
       && !wifiWidthValid('5', 80, 'n') && wifiWidthValid('5', 160) && wifiWidthValid('5', undefined, 'n'));
    const ov = (a, b) => wifiChannelsOverlap(a, b);
    ok('1, 6 and 11 stay clear of each other on 2.4 GHz; 1 and 5 do not', !ov({ band: '2.4', channel: 1 }, { band: '2.4', channel: 6 })
       && !ov({ band: '2.4', channel: 6 }, { band: '2.4', channel: 11 }) && ov({ band: '2.4', channel: 1 }, { band: '2.4', channel: 5 }));
    ok('a 40 MHz channel on 2.4 GHz takes the one above it too', ov({ band: '2.4', channel: 1, width: 40 }, { band: '2.4', channel: 6 })
       && !ov({ band: '2.4', channel: 1, width: 40 }, { band: '2.4', channel: 11 }));
    ok('5 GHz overlap counts the bonded block', ov({ band: '5', channel: 36, width: 80 }, { band: '5', channel: 44 }) && !ov({ band: '5', channel: 36, width: 80 }, { band: '5', channel: 52 })
       && ov({ band: '5', channel: 36, width: 160 }, { band: '5', channel: 52 }) && !ov({ band: '5', channel: 149, width: 80 }, { band: '5', channel: 165 })
       && !ov({ band: '5', channel: 36 }, { band: '5', channel: 40 }) && ov({ band: '5', channel: 44, width: 80 }, { band: '5', channel: 36, width: 40 }));
    ok('6 GHz likewise', ov({ band: '6', channel: 37, width: 160 }, { band: '6', channel: 45 }) && !ov({ band: '6', channel: 37, width: 160 }, { band: '6', channel: 1 }));
    ok('different bands, an unknown channel or an invalid one overlap nothing', !ov({ band: '5', channel: 36 }, { band: '6', channel: 37 })
       && !ov({ band: '5' }, { band: '5', channel: 36 }) && !ov({ band: '5', channel: 38 }, { band: '5', channel: 36 }) && wifiChannelSpan('5', 38, 20) === null);

    // ---- 3: what is offered, shared, broadcast and inferred ----
    ok('a radio offers its bands, else its standard\'s, else nobody knows', json(radioBands({ bands: [{ band: '5' }] })) === '["5"]'
       && json(radioBands({ standard: 'axe' })) === '["2.4","5","6"]' && json(radioBands({ standard: 'ax' })) === '["2.4","5"]' && radioBands(null) === null);
    ok('the common bands of two ends, best first', json(commonWifiBands(['2.4', '5'], ['2.4', '5', '6'])) === '["5","2.4"]'
       && commonWifiBands(null, null) === null && json(commonWifiBands(null, ['2.4'])) === '["2.4"]' && json(commonWifiBands(['6'], ['2.4'])) === '[]');
    replaceDocument(site(), { origin: 'file' });
    initHistory();
    const ap1 = getNode('ap1').interfaces[0].radio, ap2 = getNode('ap2').interfaces[0].radio;
    ok('an AP band broadcasts every SSID on it unless it lists its own', json(apBandSsids(ap1, '2.4')) === '["wS","wG","wI"]' && json(apBandSsids(ap1, '5')) === '["wS","wG"]'
       && json(apBandSsids(ap1, '6')) === '["wS"]' && json(apSsids(ap2)) === '["wG"]', json(apBandSsids(ap1, '2.4')));
    ok('a link names its SSID, or is on the AP\'s only one', linkWifiSsid(getLink('a1')) === 'wS' && linkWifiSsid(getLink('a2')) === 'wG' && linkWifiSsid(getLink('u1')) === null);
    ok('its band is its own, else the best one every side has', linkWifiBand(getLink('a1')) === '5' && linkWifiBand(getLink('a2')) === '5' && linkWifiBand(getLink('a3')) === '2.4'
       && linkWifiBand(getLink('u1')) === null, ['a1', 'a2', 'a3'].map((id) => linkWifiBand(getLink(id))).join(','));
    ok('the AP and the cabled ends are told apart', wifiLinkEnds(getLink('a1')).ap.node.id === 'ap1' && wifiLinkEnds(getLink('a1')).client.node.id === 'lap' && wifiLinkEnds(getLink('u1')) === null);
    ok('the radio in one line', radioSummary(ap1, true) === 'Wi-Fi 6E · 2.4 GHz ch 6/20 · 5 GHz ch 36/80 · 6 GHz ch 37/160 · Staff, Guest, IoT', radioSummary(ap1, true));
    // An AP that broadcasts several SSIDs: the client's address says which
    // when it sits in exactly one of their subnets (the phone, 10.9.0.5, is
    // on Guest's 10.9.0.0/24); with no address to go by nobody guesses. A
    // client on 2.4 GHz only pulls the band down.
    batch(() => { delete getNode('ap2').interfaces[0].radio.bands[0].ssids; save(); });
    ok('with several SSIDs on the AP, the client\'s subnet says which', linkWifiSsid(getLink('a2')) === 'wG' && linkWifiBand(getLink('a2')) === '5', linkWifiSsid(getLink('a2')));
    ok('and so ssid: and a plain search find the phone', withLookupPass(() => queryMatch(parseQuery('ssid:guest'), 'node', getNode('phone'))
       && queryMatch(parseQuery('guest'), 'node', getNode('phone')) && !queryMatch(parseQuery('staff'), 'node', getNode('phone'))));
    batch(() => { getNode('phone').interfaces[0].ip = '192.168.7.5/24'; save(); });
    ok('an address in none of their subnets: nobody guesses which', linkWifiSsid(getLink('a2')) === null);
    batch(() => { getNode('phone').interfaces[0].ip = ''; save(); });
    ok('nor with no address at all', linkWifiSsid(getLink('a2')) === null && linkWifiBand(getLink('a2')) === '5');
    batch(() => { getNode('phone').interfaces[0].radio = { bands: [{ band: '2.4' }] }; save(); });
    ok('a 2.4 GHz-only client is on 2.4 GHz', linkWifiBand(getLink('a2')) === '2.4');
    batch(() => { getNode('phone').interfaces[0].radio = { bands: [{ band: '6' }] }; save(); });
    ok('and ends with no band in common are nobody\'s guess', linkWifiBand(getLink('a2')) === null);

    // ---- 4: the document ----
    replaceDocument(site(), { origin: 'file' });
    const saved = serializeDoc();
    ok('the document is v12 or later and carries its Wi-Fi networks', DOC_VERSION >= 12 && saved.v === DOC_VERSION && json(saved.wifi.map((w) => w.ssid)) === '["Staff","Guest","IoT"]');
    ok('a network keeps what it said, and every band is not stored', json(saved.wifi[0]) === '{"id":"wS","ssid":"Staff","security":"wpa3","network":"nS"}'
       && json(saved.wifi[1].bands) === '["2.4","5"]' && saved.wifi[2].hidden === true, json(saved.wifi[0]));
    const sap1 = saved.nodes.find((n) => n.id === 'ap1').interfaces[0];
    ok('a radio round-trips key for key', json(sap1.radio) === json(site().nodes[1].interfaces[0].radio), json(sap1.radio));
    ok('a client radio with bands only keeps them', json(saved.nodes.find((n) => n.id === 'cam').interfaces[0].radio) === '{"bands":[{"band":"2.4"}]}');
    ok('an association keeps its SSID, band and signal', json(saved.links.find((l) => l.id === 'a3').wifi) === '{"ssid":"wI","band":"2.4","signal":-71}' && !saved.links.find((l) => l.id === 'a2').wifi);
    loadDocState(JSON.parse(json(saved)));
    ok('read back the same', json(serializeDoc()) === json(saved));

    // The allowlist: a passphrase (any spelling), or any key the schema does
    // not name, never survives a load, so it cannot ride a file or a link.
    const junk = site();
    junk.wifi[0].passphrase = 'hunter2'; junk.wifi[0].psk = 'hunter2'; junk.wifi[0].password = 'hunter2';
    junk.nodes[1].interfaces[0].radio.key = 'hunter2';
    junk.nodes[1].interfaces[0].radio.bands[0].psk = 'hunter2';
    junk.links[1].wifi.password = 'hunter2';
    replaceDocument(junk, { origin: 'file' });
    ok('no passphrase, PSK or unknown key is kept anywhere', !json(serializeDoc()).includes('hunter2'));
    const refs = site();
    refs.wifi[0].network = 'gone'; refs.links[1].wifi.ssid = 'gone';
    refs.nodes[2].interfaces[0].radio.bands[1].ssids = ['gone'];
    refs.nodes[2].interfaces[0].radio.bands[0].ssids = [];
    refs.wifi.push({ id: 'wS', ssid: 'Twin' }, { ssid: '  Lobby\u0007  ', security: 'WPA2-PSK', bands: '2.4 GHz, 5 GHz, 6 GHz' }, 'not a network');
    replaceDocument(refs, { origin: 'file' });
    ok('a subnet or an SSID the document does not hold is dropped', state.wifi[0].network === undefined && json(getLink('a1').wifi) === '{"signal":-58}');
    ok('a band whose list named only gone networks is back to the default; an empty one is kept as none',
       getNode('ap2').interfaces[0].radio.bands[1].ssids === undefined && json(getNode('ap2').interfaces[0].radio.bands[0].ssids) === '[]');
    ok('a repeated id is reminted, a hand-typed record coerced, junk dropped', state.wifi.length === 5 && state.wifi[3].id !== 'wS' && state.wifi[3].ssid === 'Twin'
       && state.wifi[4].ssid === 'Lobby' && state.wifi[4].security === 'wpa2' && state.wifi[4].bands === undefined, json(state.wifi.slice(3)));
    const wired = site();
    wired.nodes[3].interfaces[0].name = 'eth0'; wired.nodes[3].interfaces[0].wireless = false;
    replaceDocument(wired, { origin: 'file' });
    ok('a wired interface carries no radio', getNode('lap').interfaces[0].radio === undefined);
    batch(() => { getNode('ap1').interfaces[0].wireless = false; save(); });
    ok('nor does a radio turned wired leave in the file', !('radio' in JSON.parse(json(serializeDoc())).nodes.find((n) => n.id === 'ap1').interfaces[0]));

    const plain = { v: 11, nodes: [{ id: 'a', type: 'ap', name: 'A', x: 0, y: 0, interfaces: [{ id: 'w1', name: 'wlan0', ip: '' }] }], links: [] };
    const m = migrateDoc(plain);
    ok('a v11 document migrates with nothing converted', m.doc.v === DOC_VERSION && m.from === 11 && !m.newer && json(m.doc.nodes) === json(plain.nodes));
    replaceDocument(plain, { origin: 'file' });
    ok('one with no Wi-Fi writes no key for it, and its AP no radio', !('wifi' in JSON.parse(json(serializeDoc()))) && !('radio' in JSON.parse(json(serializeDoc())).nodes[0].interfaces[0]));
    ok('a wifi list that is not a list is a damaged document', !isDocShape({ nodes: [], wifi: {} }) && isDocShape({ nodes: [], wifi: [] }));

    replaceDocument(site(), { origin: 'file' });
    initHistory();
    const steps = _undoStack.length;
    batch(() => {
      state.wifi.push(makeWifi({ ssid: 'Lab', security: 'wpa3' }));
      setLinkWifi(getLink('a2'), 'signal', -80);
      getNode('ap2').interfaces[0].radio.bands[1].channel = 48;
      save();
    });
    ok('an edit to all three is one undo step', _undoStack.length === steps + 1 && state.wifi.length === 4 && linkWifiOf(getLink('a2'), 'signal') === -80);
    undo();
    ok('and one undo takes it back', state.wifi.length === 3 && !getLink('a2').wifi && getNode('ap2').interfaces[0].radio.bands[1].channel === 44);
    setLinkWifi(getLink('a1'), 'ssid', undefined); setLinkWifi(getLink('a1'), 'signal', undefined);
    ok('a link whose facts are all cleared drops the object', !('wifi' in getLink('a1')));

    // A subnet deleted under a network leaves the network on none.
    state.networks = state.networks.filter((n) => n.id !== 'nG');
    normalizeWifiRefs();
    ok('a deleted subnet leaves its Wi-Fi network on none', wifiById('wG').network === undefined);

    // A new AP's radio is Wi-Fi 6 on 2.4 and 5 GHz; a client's is unknown.
    const newAp = newNodeRecord('ap', 0, 0), newPc = newNodeRecord('pc', 0, 0);
    ok('a new access point is Wi-Fi 6 on 2.4 and 5 GHz, channels on auto', json(newAp.interfaces.find(ifaceIsWireless).radio) === '{"standard":"ax","bands":[{"band":"2.4"},{"band":"5"}]}'
       && newPc.interfaces.every((i) => !i.radio));

    // The Netplan hand-off names the SSID the radio is on, not the device.
    replaceDocument(site(), { origin: 'file' });
    const hand = bridgeIntent(getNode('lap'));
    ok('the Netplan hand-off uses the association\'s SSID', hand.ifaces[0].ssid === 'Staff', json(hand.ifaces[0]));

    // ---- 5: the query ----
    const hits = (text, kind = 'node') => withLookupPass(() => {
      const q = parseQuery(text);
      if (kind === 'node') return state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id).sort().join(',');
      if (kind === 'link') return state.links.filter((l) => queryMatch(q, 'link', l)).map((l) => l.id).sort().join(',');
      return state.wifi.filter((w) => queryMatch(q, 'wifi', w)).map((w) => w.id).sort().join(',');
    });
    ok('ssid: finds the APs that broadcast it and the clients on it', hits('ssid:staff') === 'ap1,lap' && hits('ssid:staff', 'link') === 'a1', hits('ssid:staff'));
    ok('band: finds a radio that offers it and a link on it', hits('band:6') === 'ap1' && hits('band:5', 'link') === 'a1,a2' && hits('band:2.4ghz', 'link') === 'a3', hits('band:5', 'link'));
    ok('wifi: finds a standard however it is written', hits('wifi:6e') === 'ap1' && hits('wifi:ax') === 'lap' && hits('wifi:5') === 'ap2' && hits('wifi:802.11ac') === 'ap2');
    ok('channel: finds the radio and the links through it', hits('channel:36') === 'ap1' && hits('channel:36', 'link') === 'a1' && hits('channel:6', 'link') === 'a3', hits('channel:6', 'link'));
    ok('has:wifi finds every radio and association, not the switch', hits('has:wifi') === 'ap1,ap2,cam,lap,phone' && hits('has:wifi', 'link') !== '' && !hits('-has:wifi').includes('ap'), hits('has:wifi'));
    ok('a Wi-Fi network row by its own fields', hits('guest', 'wifi') === 'wG' && hits('band:6', 'wifi') === 'wS' && hits('wpa3-personal', 'wifi') === 'wS');
    ok('the plain SSID finds the links on it', hits('iot', 'link') === 'a3');
    ok('a band or a channel that is none is not understood', parseQuery('band:7').errors.length === 1 && parseQuery('channel:auto').errors.length === 1 && parseQuery('wifi:9').errors.length === 1);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
