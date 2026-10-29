// Wi-Fi in the editor (Review-Packs/Topo-wifi.md, W1 part 2; js/wifi.js):
//   1. the rail's Wi-Fi tab is offered only with an AP, a wireless link or a
//      Wi-Fi network, never in a reduced view; empty, it offers Staff, Guest
//      and IoT, each one click and one undo step, on the subnet its name
//      suggests (Staff on the only subnet; Guest and IoT never by guess);
//   2. a card's APs, client count, Select clients, Edit (SSID typed, the
//      security, the subnet, the bands with the last one kept, hidden), and
//      Delete, which leaves the clients and takes their SSID back to auto;
//   3. the link panel: a wireless link hides the cable's facts and shows
//      SSID, Band and Signal, the first entries saying what is inferred;
//      only the bands both ends have; a signal typed as 67 is -67; the AP's
//      channel and width read-only, and Edit radio opening its block; a VPN
//      link hides the cable's facts too and shows no Wi-Fi; "Add a Wi-Fi
//      network…" makes one and puts the link on it in one step;
//   4. the radio block: folded to its summary, a channel and a width picked
//      from the valid ones, a band off, the SSID chips (off writes lists, on
//      again is the default with no list), a client's standard and bands
//      only, inferred bands greyed;
//   5. the table: the Wi-Fi tab and the radio and association columns only
//      with something wireless, a cell edit one step, a dash for a cable's
//      facts on a wireless link;
//   6. the bulk panel's Set Wi-Fi: offered only with a device on Wi-Fi, a
//      preview that skips the wired one and refuses a band the ends do not
//      share, one undo step;
//   7. Add devices onto an AP with two SSIDs: the pick shown, not Guest by
//      default, the Guest pick putting the phones on the guest subnet;
//   8. every literal t('…') in js/wifi.js carried by every locale, and none of
//      the view state (open cards, open radio blocks) in the document.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const answers = [];
  const asked = [];
  const held = setDialogResponder((req) => { asked.push(req); return answers.length ? answers.shift()(req) : (req.kind === 'confirm' ? false : null); });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const hidden = (x) => !x || x.classList.contains('hidden') || x.hidden || x.closest('.hidden') !== null;
  const change = (x, v) => { if (v !== undefined) { if (x.type === 'checkbox') x.checked = v; else x.value = v; } x.dispatchEvent(new Event('change', { bubbles: true })); };
  const input = (x, v) => { x.value = v; x.dispatchEvent(new Event('input', { bubbles: true })); };
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false, interfaces: [] }, extra);
  const site = (wifi) => ({ v: DOC_VERSION,
    networks: [{ id: 'nS', cidr: '10.1.0.0/24', name: 'Staff LAN', vlan: 10 }, { id: 'nG', cidr: '10.9.0.0/24', name: 'Guest', vlan: 90 }],
    wifi: wifi || [],
    nodes: [
      N('sw', 'switch', { portCount: 8 }),
      N('ap1', 'ap', { name: 'AP-1', y: 100, interfaces: [{ id: 'w1', name: 'wlan0', ip: '',
        radio: { standard: 'axe', bands: [{ band: '2.4', channel: 6, width: 20 }, { band: '5', channel: 36, width: 80 }, { band: '6', channel: 37, width: 160 }] } }] }),
      N('lap', 'pc', { name: 'Laptop', y: 200, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.1.0.20/24', radio: { standard: 'ax' } }] }),
      N('phone', 'voip', { name: 'Phone', x: 100, y: 200, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.9.0.5/24' }] }),
      N('pc2', 'pc', { name: 'Desk', x: 200, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.1.0.30/24' }] }),
      N('r1', 'router', { name: 'R1', x: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.1.0.1/24' }] }),
      N('r2', 'router', { name: 'R2', x: 500, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.2.0.1/24' }] })
    ],
    links: [
      { id: 'u1', source: 'sw', target: 'ap1', sourceIface: 'p1', targetIface: 'p1' },
      { id: 'a1', source: 'lap', target: 'ap1', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless' },
      { id: 'a2', source: 'phone', target: 'ap1', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless' },
      { id: 'c1', source: 'pc2', target: 'sw', sourceIface: 'i1', targetIface: 'p2', cable: { label: 'WS-1' } },
      { id: 'v1', source: 'r1', target: 'r2', sourceIface: 'i1', targetIface: 'i1', medium: 'vpn', cable: { label: 'OLD' } }
    ] });
  const NETS = [{ id: 'wS', ssid: 'Staff', security: 'wpa3', network: 'nS' }, { id: 'wG', ssid: 'Guest', security: 'owe', bands: ['2.4', '5'], network: 'nG' }];
  const open = (wifi) => { replaceDocument(site(wifi), { origin: 'file', docId: 'wifiui-test' }); renderCanvasOnly(); };
  const saved = () => serializeDoc();

  try {
    state.settings.advanced = true; applyProfile();
    if (typeof setView === 'function') setView('map');

    // ---- 1: offered, presets ----
    replaceDocument({ v: DOC_VERSION, nodes: [N('sw', 'switch'), N('pc', 'pc', { interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] })], links: [{ id: 'l', source: 'pc', target: 'sw' }] }, { origin: 'file', docId: 'wifiui-0' });
    renderCanvasOnly();
    ok('no AP, no radio link, no Wi-Fi network: no Wi-Fi tab', el('wifiTabBtn').classList.contains('hidden') && !wifiOffered());
    open();
    ok('an AP: the Wi-Fi tab is offered', !el('wifiTabBtn').classList.contains('hidden'));
    el('wifiTabBtn').click();
    ok('the tab shows the Wi-Fi panel', !el('cfgPanel-wifi').classList.contains('hidden') && el('wifiTabBtn').getAttribute('aria-selected') === 'true');
    const presets = [...el('wifiList').querySelectorAll('[data-act="preset"]')].map((b) => b.textContent.trim());
    ok('empty, it offers Staff, Guest and IoT', presets.join('|') === '+ Staff|+ Guest|+ IoT', presets.join('|'));
    el('wifiList').querySelector('[data-wf="guest"]').click();
    await tick();
    let g = state.wifi[0];
    ok('Guest: one click, OWE, every band, on the subnet named Guest', state.wifi.length === 1 && g.ssid === 'Guest' && g.security === 'owe' && !g.bands && g.network === 'nG', JSON.stringify(g));
    undo();
    ok('one undo takes it back', state.wifi.length === 0);
    el('wifiTabBtn').click();
    el('wifiList').querySelector('[data-wf="iot"]').click();
    g = state.wifi[0];
    ok('IoT: WPA2 on 2.4 GHz, and no subnet by guesswork', g.ssid === 'IoT' && g.security === 'wpa2' && JSON.stringify(g.bands) === '["2.4"]' && !g.network, JSON.stringify(g));
    undo();
    replaceDocument(Object.assign(site(), { networks: [{ id: 'nOnly', cidr: '10.1.0.0/24' }] }), { origin: 'file', docId: 'wifiui-1' });
    el('wifiTabBtn').click();
    el('wifiList').querySelector('[data-wf="staff"]').click();
    g = state.wifi[0];
    ok('Staff: WPA2/WPA3 on the one subnet there is', g.ssid === 'Staff' && g.security === 'wpa2/3' && g.network === 'nOnly', JSON.stringify(g));
    state.settings.advanced = false; applyProfile();
    ok('a reduced view: no Wi-Fi tab', !wifiOffered() && el('cfgPanel-wifi').classList.contains('hidden'));
    state.settings.advanced = true; applyProfile();

    // ---- 2: cards ----
    open(NETS);
    showConfigTab('wifi');
    const card = (id) => el('wifiList').querySelector(`.wifi-card[data-wf="${id}"]`);
    ok('a card per network, its security and bands', !!card('wS') && /WPA3-Personal/.test(card('wS').textContent) && /2\.4 · 5 · 6 GHz/.test(card('wS').textContent)
      && /2\.4 · 5 GHz/.test(card('wG').textContent), card('wG').textContent.replace(/\s+/g, ' ').slice(0, 120));
    ok('its subnet and VLAN, and who broadcasts it', /Staff LAN · VLAN 10/.test(card('wS').textContent) && /Broadcast by AP-1/.test(card('wS').textContent));
    // The laptop is on Staff and the phone on Guest by their addresses (linkWifiSsid).
    ok('its clients, as the link panel infers them', /1 client\b/.test(card('wS').textContent) && /1 client\b/.test(card('wG').textContent), card('wS').textContent.replace(/\s+/g, ' '));
    card('wG').querySelector('[data-act="clients"]').click();
    ok('Select clients selects them and keeps the tab', state.selection.size === 1 && inSelection('node', 'phone') && !el('cfgPanel-wifi').classList.contains('hidden'));
    card('wS').querySelector('[data-act="edit"]').click();
    const f = (id, field, band) => el('wifiList').querySelector(`[data-wf="${id}"][data-field="${field}"]${band ? `[data-band="${band}"]` : ''}`);
    ok('Edit opens its fields with the SSID in the focus, and no passphrase field', document.activeElement === f('wS', 'ssid')
      && !card('wS').querySelector('input[type="password"]') && !/pass|psk|key/i.test([...card('wS').querySelectorAll('[data-field]')].map((x) => x.dataset.field).join(' ')));
    input(f('wS', 'ssid'), 'Staff-5');
    commitTyping();
    ok('the SSID typed is the network\'s, one step', wifiById('wS').ssid === 'Staff-5' && saved().wifi[0].ssid === 'Staff-5');
    f('wS', 'ssid').blur(); await tick();
    change(f('wS', 'security'), 'wpa2-ent');
    ok('the security picked', wifiById('wS').security === 'wpa2-ent');
    change(f('wS', 'band', '6'), false);
    ok('a band off writes the list', JSON.stringify(wifiById('wS').bands) === '["2.4","5"]', JSON.stringify(wifiById('wS').bands));
    change(f('wS', 'band', '6'), true);
    ok('every band on again is the default: no list', !('bands' in wifiById('wS')));
    change(f('wG', 'band', '2.4') || (card('wG').querySelector('[data-act="edit"]').click(), f('wG', 'band', '2.4')), false);
    change(f('wG', 'band', '5'), false);
    ok('the last band stays ticked', JSON.stringify(wifiById('wG').bands) === '["5"]' && f('wG', 'band', '5').checked, JSON.stringify(wifiById('wG').bands));
    change(f('wS', 'hidden'), true);
    ok('hidden, and the card says so', wifiById('wS').hidden === true && /Hidden/.test(card('wS').querySelector('.net-head').textContent));
    change(f('wS', 'network'), '');
    ok('no subnet', !('network' in wifiById('wS')) && /on no subnet/.test(card('wS').textContent));
    undo();
    ok('undo puts the subnet back', wifiById('wS').network === 'nS');
    // Delete: the laptop set to it explicitly loses the reference.
    setLinkWifi(getLink('a1'), 'ssid', 'wG'); save();
    answers.push(() => true);
    await onWifiAction({ target: card('wG').querySelector('[data-act="delete"]') });
    ok('Delete asks, in the page, naming the one device set to it', asked.length > 0 && /Guest/.test(asked[asked.length - 1].message) && /one device/.test(asked[asked.length - 1].message));
    ok('Delete: gone, its device on the map, its SSID back to auto', !wifiById('wG') && !!getNode('lap') && !(getLink('a1').wifi && getLink('a1').wifi.ssid));
    undo();
    ok('one undo brings both back', !!wifiById('wG') && getLink('a1').wifi.ssid === 'wG');

    // ---- 3: the link panel ----
    open(NETS);
    showConfigTab('config');
    select('a1', 'link');
    ok('a wireless link: no cable facts, SSID / Band / Signal instead', hidden(el('linkCableProps')) && !hidden(el('linkWifiProps')) && hidden(el('printLabelBtn')));
    ok('the medium select shows what is drawn', el('propMedium').value === 'wireless');
    const opts = (id) => [...el(id).options].map((o) => o.textContent);
    ok('SSID: the inference first, the AP\'s networks, then Add', opts('propWifiSsid')[0] === 'Auto · Staff' && opts('propWifiSsid').includes('Guest')
      && opts('propWifiSsid')[opts('propWifiSsid').length - 1] === 'Add a Wi-Fi network…', opts('propWifiSsid').join(' | '));
    // The laptop is Wi-Fi 6 (2.4 and 5); the AP 6E: 6 GHz is not offered.
    ok('Band: the inference first, then only the bands both ends have', opts('propWifiBand').join('|') === 'Auto · 5 GHz|2.4 GHz|5 GHz', opts('propWifiBand').join('|'));
    ok('the AP\'s channel and width on that band, read-only', /AP-1 · 5 GHz · ch 36 · 80 MHz/.test(el('wifiApLine').textContent), el('wifiApLine').textContent.trim());
    change(el('propWifiSsid'), 'wG');
    ok('picking an SSID stores it, one step', getLink('a1').wifi.ssid === 'wG' && saved().links.find((l) => l.id === 'a1').wifi.ssid === 'wG');
    change(el('propWifiBand'), '2.4');
    ok('picking a band stores it, and the AP line follows', getLink('a1').wifi.band === '2.4' && /2\.4 GHz · ch 6 · 20 MHz/.test(el('wifiApLine').textContent));
    input(el('propWifiSignal'), '67');
    commitTyping();
    ok('a signal typed as 67 is -67 dBm (a phone pad has no minus)', getLink('a1').wifi.signal === -67);
    input(el('propWifiSignal'), '-200');
    ok('out of range is marked and not written', el('propWifiSignal').classList.contains('bad') && getLink('a1').wifi.signal === -67);
    change(el('propWifiBand'), '');
    ok('Auto takes the band back off the link', !('band' in getLink('a1').wifi));
    answers.push(() => 'Lobby');
    change(el('propWifiSsid'), el('propWifiSsid').options[el('propWifiSsid').options.length - 1].value);
    await tick(); await tick();
    const lobby = state.wifi.find((w) => w.ssid === 'Lobby');
    ok('Add a Wi-Fi network…: made, and the link on it', !!lobby && getLink('a1').wifi.ssid === lobby.id);
    undo();
    ok('in one undo step', !state.wifi.some((w) => w.ssid === 'Lobby') && getLink('a1').wifi.ssid === 'wG');
    el('wifiApLine').querySelector('[data-node]').click();
    await tick();
    const apBox = document.querySelector('#ifaceListContainer [data-radio]');
    ok('Edit radio: the AP selected, its radio block open, a channel in the focus', state.selectedId === 'ap1' && !!apBox && apBox.open
      && document.activeElement && document.activeElement.dataset.r === 'channel', document.activeElement && document.activeElement.outerHTML.slice(0, 80));
    select('v1', 'link');
    ok('a VPN link: neither the cable\'s facts nor Wi-Fi', hidden(el('linkCableProps')) && hidden(el('linkWifiProps')) && getLink('v1').cable.label === 'OLD');
    select('c1', 'link');
    ok('a cable: its facts, no Wi-Fi', !hidden(el('linkCableProps')) && hidden(el('linkWifiProps')) && el('propCableLabel').value === 'WS-1');

    // ---- 4: the radio block ----
    open(NETS);
    _radioOpen.clear();   // a view of this session: Edit radio above left the AP's open
    select('ap1', 'node');
    let box = () => document.querySelector('#ifaceListContainer [data-radio]');
    ok('folded to one line: standard, channels, SSIDs', !box().open && box().querySelector('.radio-sum-text').textContent === 'Wi-Fi 6E · 2.4 GHz ch 6/20 · 5 GHz ch 36/80 · 6 GHz ch 37/160 · Staff, Guest',
      box().querySelector('.radio-sum-text').textContent);
    box().open = true; box().dispatchEvent(new Event('toggle'));
    const ctl = (r, band) => box().querySelector(`[data-r="${r}"]${band ? `[data-band="${band}"]` : ''}`);
    ok('channels offered are the band\'s valid ones', [...ctl('channel', '5').options].every((o) => !o.value || wifiChannelValid('5', Number(o.value)))
      && ![...ctl('width', '2.4').options].some((o) => o.value === '80'));
    change(ctl('channel', '5'), '149');
    ok('a channel picked, one step', radioBand(radioOf(getNode('ap1').interfaces[0]), '5').channel === 149);
    ok('the block stays open after it is rebuilt, the focus where it was', box().open && document.activeElement === ctl('channel', '5'));
    change(ctl('width', '5'), '');
    ok('width back to auto', radioBand(radioOf(getNode('ap1').interfaces[0]), '5').width === undefined);
    change(ctl('band', '6'), false);
    ok('a band off', !radioBand(radioOf(getNode('ap1').interfaces[0]), '6') && !ctl('channel', '6'));
    ctl('ssid').click();   // the first chip: Staff
    let r = radioOf(getNode('ap1').interfaces[0]);
    ok('a chip off: lists written, Staff no longer broadcast', !apSsids(r).includes('wS') && apSsids(r).includes('wG') && r.bands.every((b) => Array.isArray(b.ssids)), JSON.stringify(r.bands));
    box().querySelector('[data-r="ssid"][data-id="wS"]').click();
    r = radioOf(getNode('ap1').interfaces[0]);
    ok('on again: the default, no list kept', apSsids(r).includes('wS') && r.bands.every((b) => !('ssids' in b)), JSON.stringify(r.bands));
    select('lap', 'node');
    box = () => document.querySelector('#ifaceListContainer [data-radio]');
    ok('a client: standard and bands, no channel, no chips', !!box() && !box().querySelector('[data-r="channel"]') && !box().querySelector('[data-r="ssid"]'));
    ok('a client\'s bands from its standard are ticked and greyed', box().querySelectorAll('.radio-tick.inferred input:checked').length === 2);
    change(box().querySelector('[data-r="band"][data-band="5"]'), false);
    ok('unticking one makes the list explicit', JSON.stringify(radioBands(radioOf(getNode('lap').interfaces[0]))) === '["2.4"]');
    select('pc2', 'node');
    ok('a wired device has no radio block', !document.querySelector('#ifaceListContainer [data-radio]'));

    // ---- 5: the table ----
    replaceDocument({ v: DOC_VERSION, nodes: [N('sw', 'switch'), N('pc', 'pc', { interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] })], links: [{ id: 'l', source: 'pc', target: 'sw' }] }, { origin: 'file', docId: 'wifiui-2' });
    setView('table');
    ok('nothing wireless: no Wi-Fi tab, no radio columns', hidden(document.querySelector('[data-tvtab="wifi"]')) && !tvCols('interfaces').some((c) => c.key === 'radio:standard')
      && !tvCols('cables').some((c) => c.key === 'wifi:ssid'));
    open(NETS);
    setView('table');
    ok('with an AP: the tab, and the columns', !hidden(document.querySelector('[data-tvtab="wifi"]')) && tvCols('interfaces').some((c) => c.key === 'radio:standard'));
    showTableTab('wifi');
    const cellOf = (key, col) => el('tableView').querySelector(`tr[data-row="${key}"] td[data-col="${col}"]`);
    ok('a row per network: SSID, security, bands, subnet, clients', cellOf('w:wS', 'wf:ssid').textContent === 'Staff' && cellOf('w:wS', 'wf:security').textContent === 'WPA3-Personal'
      && cellOf('w:wG', 'wf:bands').textContent === '2.4 · 5 GHz' && /Guest · VLAN 90/.test(cellOf('w:wG', 'wf:network').textContent) && cellOf('w:wS', 'wf:clients').textContent === '1');
    startEdit(cellOf('w:wS', 'wf:ssid'), 'Office');
    finishEdit('enter');
    ok('an SSID cell typed is the network\'s, one step', wifiById('wS').ssid === 'Office');
    undo();
    showTableTab('cables');
    ok('a wireless link: SSID inferred and greyed, a dash for the cable label', cellOf('l:a1', 'wifi:ssid').textContent === 'Staff' && cellOf('l:a1', 'wifi:ssid').classList.contains('tv-muted')
      && cellOf('l:a1', 'cable:label').textContent === '—' && cellOf('l:c1', 'wifi:ssid').textContent === '—' && cellOf('l:c1', 'cable:label').textContent === 'WS-1');
    showTableTab('interfaces');
    ok('a radio\'s standard and channels on Interfaces', cellOf('i:ap1:w1', 'radio:standard').textContent === 'Wi-Fi 6E (802.11ax)'
      && cellOf('i:ap1:w1', 'radio:channels').textContent === '2.4: ch 6/20 · 5: ch 36/80 · 6: ch 37/160' && cellOf('i:pc2:i1', 'radio:standard').textContent === '—',
      cellOf('i:ap1:w1', 'radio:channels').textContent);
    setView('map');

    // ---- 6: Set Wi-Fi ----
    open(NETS);
    selectEntries([{ type: 'node', id: 'pc2' }, { type: 'node', id: 'r1' }]);
    ok('no device on Wi-Fi: no Wi-Fi tab in the bulk panel', hidden(el('bulkTabs').querySelector('[data-bulk="wifi"]')));
    selectEntries(['lap', 'phone', 'pc2'].map((id) => ({ type: 'node', id })));
    ok('one on Wi-Fi: the tab is offered', !hidden(el('bulkTabs').querySelector('[data-bulk="wifi"]')));
    let plan = bulkPlanWifi(['lap', 'phone', 'pc2'], { ssid: 'wG', band: '' });
    ok('the preview: two change, the wired one left as it is', plan.counts.change === 2 && plan.counts.skip === 1 && plan.rows.find((x) => x.nodeId === 'lap').before === 'Auto · Staff',
      JSON.stringify(plan.counts));
    plan = bulkPlanWifi(['lap'], { ssid: '', band: '6' });
    ok('a band the ends do not share is refused on its row', plan.counts.bad === 1 && plan.ops.length === 0);
    el('bulkTabs').querySelector('[data-bulk="wifi"]').click();
    change(el('bulkWifiSsid'), 'wG');
    el('bulkPreviewBtn').click();
    await tick();
    el('bulkApplyBtn').click();
    ok('applied: both on Guest', getLink('a1').wifi.ssid === 'wG' && getLink('a2').wifi.ssid === 'wG');
    undo();
    ok('in one undo step', !getLink('a1').wifi && !getLink('a2').wifi);
    // The Wi-Fi tab chosen, then a set with no device on Wi-Fi: Set fields is
    // what shows, and Preview / Enter act on it, not on the hidden Wi-Fi pane.
    selectEntries(['lap', 'pc2'].map((id) => ({ type: 'node', id })));
    el('bulkTabs').querySelector('[data-bulk="wifi"]').click();
    change(el('bulkWifiSsid'), 'wG');
    selectEntries([{ type: 'node', id: 'pc2' }, { type: 'node', id: 'r1' }]);
    const setTab = el('bulkTabs').querySelector('[data-bulk="set"]');
    ok('Wi-Fi tab gone: Set fields shown and asked for', hidden(el('bulkTabs').querySelector('[data-bulk="wifi"]')) && setTab.classList.contains('active')
      && !hidden(el('bulkPane-set')) && bulkRequest().action === 'set' && el('bulkPreviewBtn').disabled);
    const os = el('bulkF-os');
    os.value = 'RouterOS 7'; os.dispatchEvent(new Event('input', { bubbles: true }));
    el('bulkPreviewBtn').click();
    await tick();
    ok('Preview previews the fields typed, not Set Wi-Fi', _bulk.req && _bulk.req.action === 'set' && el('bulkTitle').textContent === 'Set fields', el('bulkTitle').textContent);
    closeBulkPreview();
    selectEntries(['lap', 'phone'].map((id) => ({ type: 'node', id })));
    ok('a set on Wi-Fi again: the Wi-Fi tab chosen comes back', el('bulkTabs').querySelector('[data-bulk="wifi"]').classList.contains('active') && bulkRequest().action === 'wifi');
    selectEntries([]);

    // ---- 7: Add devices onto an AP with two SSIDs ----
    open([{ id: 'wG', ssid: 'Guest', network: 'nG' }, { id: 'wS', ssid: 'Staff', network: 'nS' }]);
    select('ap1', 'node');
    openAddDevices({ mode: 'add' });
    el('addTarget').value = 'ap1'; el('addTarget').onchange();
    const voip = el('addRows').querySelector('.add-count[data-type="voip"]');
    voip.value = '2'; voip.oninput();
    ok('onto an AP with two SSIDs: the pick shows, Staff first (not Guest)', !el('addSsidField').hidden && el('addSsid').value === 'wS');
    change(el('addSsid'), 'wG');
    ok('the summary names it, and the addresses are the guest subnet\'s', /Guest/.test(el('addSummary').textContent) && /10\.9\.0\./.test(el('addSummary').textContent), el('addSummary').textContent);
    el('addApplyBtn').click();
    const added = state.nodes.filter((n) => n.type === 'voip' && n.id !== 'phone');
    const addLinks = added.map((n) => state.links.find((l) => l.source === n.id || l.target === n.id));
    ok('the new phones are on Guest, in its subnet', added.length === 2 && addLinks.every((l) => l && l.wifi && l.wifi.ssid === 'wG')
      && added.every((n) => /^10\.9\.0\./.test(n.interfaces[0].ip)), added.map((n) => n.interfaces[0].ip).join(','));
    undo();
    open([{ id: 'wS', ssid: 'Staff', network: 'nS' }]);
    openAddDevices({ mode: 'add' });
    el('addTarget').value = 'ap1'; el('addTarget').onchange();
    el('addRows').querySelector('.add-count[data-type="voip"]').value = '1'; el('addRows').querySelector('.add-count[data-type="voip"]').oninput();
    ok('one SSID: no pick to make', el('addSsidField').hidden);
    closeAddDevices();

    // ---- 8: the words, and the view state ----
    const keys = new Set();
    const req = new XMLHttpRequest(); req.open('GET', 'js/wifi.js', false); req.send();
    const re = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g; let m;
    while ((m = re.exec(req.responseText))) keys.add(m[2].replace(/\\(['"\\])/g, '$1'));
    ok('js/wifi.js asks for a real number of strings', keys.size > 20, String(keys.size));
    const { has, locales } = window.CarinoI18N;
    locales.forEach((loc) => {
      const missing = [...keys].filter((k) => !has(loc, k));
      ok(`${loc} carries every string of the Wi-Fi editor`, missing.length === 0, missing.slice(0, 2).join(' | '));
    });
    open(NETS);
    showConfigTab('wifi');
    el('wifiList').querySelector('[data-act="edit"][data-wf="wS"]').click();
    const json = JSON.stringify(saved());
    ok('an open card or radio block is not in the document, and no passphrase is', !/open|psk|passphrase|password/i.test(json.replace(/"(ssid|name)":"[^"]*"/g, '')), json.slice(0, 80));
    setLocale('es'); applyStaticI18n(); renderWifiPanel(true);
    ok('es: the card\'s sentences', /La emite AP-1/.test(el('wifiList').textContent) && /Seleccionar clientes/.test(el('wifiList').textContent));
    setLocale('en'); applyStaticI18n();
    showConfigTab('config');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(held);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
