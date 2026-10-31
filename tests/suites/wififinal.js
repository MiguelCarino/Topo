// Wi-Fi, the final review's fixes (Review-Packs/Topo-wifi.md):
//   1. Wi-Fi networks count in the change history: added, edited (by field)
//      and removed, each a row under its SSID, in the card's total;
//   2. the report reads every radio of an AP: one per band (wlan0 on 2.4,
//      wlan1 on 5) gives each band its own channel and width, its own
//      interface named, and a client bound to wlan1 lands on wlan1's row;
//   3. a serving radio with a standard and no listed bands shows a channel
//      and width row per inferred band, and the first pick writes the list
//      (the other bands kept, one undo step);
//   4. the radio row's selects are wide enough for "160 MHz" and "ch auto";
//   5. a Wi-Fi card's actions are a finger's size on a phone-width layout
//      (checked by the stylesheet rule, the browser check measures it);
//   6. the presets not used yet stay under the cards, one click each, and
//      one already made (any case) is not offered again;
//   7. Bulk Set Wi-Fi refuses an SSID the client's AP does not broadcast,
//      on its row, as it refuses a band; Auto is never refused.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const change = (x, v) => { x.value = v; x.dispatchEvent(new Event('change', { bubbles: true })); };
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false, interfaces: [] }, extra);
  const site = () => ({ v: DOC_VERSION,
    networks: [{ id: 'nS', cidr: '10.1.0.0/24', name: 'Office' }],
    wifi: [{ id: 'wS', ssid: 'Office', security: 'wpa3', network: 'nS' }, { id: 'wG', ssid: 'Guest', security: 'owe', bands: ['2.4'] }],
    nodes: [
      N('ap', 'ap', { name: 'AP', interfaces: [
        { id: 'w1', name: 'wlan0', ip: '', radio: { standard: 'ax', bands: [{ band: '2.4', channel: 6, width: 20, ssids: ['wS'] }] } },
        { id: 'w2', name: 'wlan1', ip: '', radio: { standard: 'ax', bands: [{ band: '5', channel: 36, width: 80 }] } }] }),
      N('cam', 'camera', { name: 'Cam', y: 100, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.1.0.20/24' }] }),
      N('tv', 'pc', { name: 'TV', x: 100, y: 100, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.1.0.21/24' }] })
    ],
    links: [
      { id: 'a1', source: 'cam', target: 'ap', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { band: '2.4', signal: -60 } },
      { id: 'a2', source: 'tv', target: 'ap', sourceIface: 'i1', targetIface: 'w2', medium: 'wireless', wifi: { band: '5' } }
    ] });
  const open = () => { replaceDocument(site(), { origin: 'file', docId: 'wififinal-test' }); initHistory(); renderCanvasOnly(); };

  try {
    state.settings.advanced = true; applyProfile();
    if (typeof setView === 'function') setView('map');
    setLocale('en');

    // ---- 1: the change history ----
    open();
    let base = serializeDoc();
    addWifiPreset('iot');
    let ch = docChanges(base, serializeDoc());
    ok('a Wi-Fi network added is one change', ch.total === 1 && ch.wifi.added.length === 1 && ch.wifi.added[0].name === 'IoT', JSON.stringify(ch.wifi));
    let rows = changeRows(ch);
    ok('its row: Added, Wi-Fi network, by SSID', rows.some((r) => r.op === 'Added' && r.what === 'Wi-Fi network' && r.name === 'IoT'), JSON.stringify(rows));
    base = serializeDoc();
    state.wifi.find((w) => w.id === 'wG').security = 'open';
    save();
    ch = docChanges(base, serializeDoc());
    ok('a network\'s security changed is one change, named by field', ch.total === 1 && ch.wifi.changed.length === 1
      && ch.wifi.changed[0].name === 'Guest' && ch.wifi.changed[0].fields.join() === 'Security', JSON.stringify(ch.wifi));
    base = serializeDoc();
    batch(() => { state.wifi = state.wifi.filter((w) => w.ssid !== 'IoT'); save(); });
    ch = docChanges(base, serializeDoc());
    ok('a network removed is one change', ch.total === 1 && ch.wifi.removed.length === 1 && ch.wifi.removed[0].name === 'IoT');
    ok('an older change set with no Wi-Fi still makes rows', Array.isArray(changeRows(Object.assign({}, ch, { wifi: undefined }))));
    setLocale('es');
    ok('es: the row says Red Wi-Fi', changeRows(ch).some((r) => r.what === 'Red Wi-Fi'));
    setLocale('en');

    // ---- 2: the report, every radio ----
    open();
    const ap = reportWifiAps().find((a) => a.id === 'ap');
    const line = ap ? ap.rows.map((r) => `${r.band}:${r.iface}:ch${r.channel}/${r.width}[${r.ssids.join(',')}]{${r.clients.map((c) => c.name).join(',')}}`).join(' | ') : 'none';
    ok('one radio per band: each band from its own radio, its interface named, its clients on it',
      line === '2.4:wlan0:ch6/20[Office]{Cam} | 5:wlan1:ch36/80[Office]{TV}', line);
    ok('the standard is said once', ap && ap.standard === 'Wi-Fi 6 (802.11ax)', ap && ap.standard);
    const html = (() => { const s = reportWifiSection(); return s ? wifiSection(s) : ''; })();
    ok('the printed block names the interfaces', /wlan0/.test(html) && /wlan1/.test(html), html.slice(0, 120));
    // An AP with one radio has no interface named: the block reads as before.
    getNode('ap').interfaces.pop();
    getLink('a2').targetIface = 'w1';
    const one = reportWifiAps().find((a) => a.id === 'ap');
    ok('one radio: no interface on its rows', one.rows.every((r) => r.iface === ''), JSON.stringify(one.rows.map((r) => r.iface)));
    // Unbound to an interface, a client lands on the one radio that offers its band.
    open();
    delete getLink('a2').targetIface;
    const unbound = reportWifiAps().find((a) => a.id === 'ap');
    const row5 = unbound.rows.find((r) => r.band === '5');
    ok('unbound: on the only radio with that band', unbound.rows.filter((r) => r.band === '5').length === 1 && row5.channel === 36 && row5.clients.length === 1,
      JSON.stringify(unbound.rows));

    // ---- 3, 4: inferred bands on a serving radio ----
    open();
    getNode('ap').interfaces = [{ id: 'w1', name: 'wlan0', ip: '', radio: { standard: 'ax' } }];
    getLink('a2').targetIface = 'w1';
    save(); initHistory();
    _radioOpen.clear();
    select('ap', 'node');
    const box = () => document.querySelector('#ifaceListContainer [data-radio]');
    box().open = true; box().dispatchEvent(new Event('toggle'));
    const ctl = (r, band) => box().querySelector(`[data-r="${r}"][data-band="${band}"]`);
    ok('standard only: a channel and width per inferred band', !!ctl('channel', '2.4') && !!ctl('channel', '5') && !!ctl('width', '5') && !ctl('channel', '6'));
    ok('both still shown as inferred', box().querySelectorAll('.radio-tick.inferred input:checked').length === 2);
    change(ctl('channel', '5'), '36');
    const r = radioOf(getNode('ap').interfaces[0]);
    ok('the first pick writes the list, the other band kept', JSON.stringify(r.bands) === '[{"band":"2.4"},{"band":"5","channel":36}]', JSON.stringify(r.bands));
    undo();
    ok('one undo step back to the standard alone', !(radioOf(getNode('ap').interfaces[0]).bands || []).length, JSON.stringify(radioOf(getNode('ap').interfaces[0])));
    // 4: the row's selects are as wide as their longest text in the rail.
    select('ap', 'node');
    box().open = true;
    const w5 = ctl('width', '5');
    w5.value = '160';
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${getComputedStyle(w5).font}`;
    probe.textContent = '160 MHz';
    document.body.appendChild(probe);
    const room = w5.clientWidth - parseFloat(getComputedStyle(w5).paddingLeft) - 16;   // the native arrow
    ok('"160 MHz" fits its select in the rail', room >= probe.offsetWidth, `${room} < ${probe.offsetWidth}`);
    probe.remove();

    // ---- 6: presets under the cards ----
    open();
    state.wifi = [];
    normalizeWifiRefs();   // as deleting them in the editor does: no band names one that is gone
    save();
    showConfigTab('wifi');
    renderWifiPanel(true);
    el('wifiList').querySelector('[data-act="preset"][data-wf="guest"]').click();
    await tick();
    let left = [...el('wifiList').querySelectorAll('.wifi-presets-more [data-act="preset"]')].map((b) => b.dataset.wf);
    ok('one made: the other two still one click under the card', left.join() === 'staff,iot', left.join());
    el('wifiList').querySelector('.wifi-presets-more [data-wf="staff"]').click();
    await tick();
    el('wifiList').querySelector('.wifi-presets-more [data-wf="iot"]').click();
    await tick();
    ok('all three in three clicks, no chips left', state.wifi.map((w) => w.ssid).join() === 'Guest,Staff,IoT' && !el('wifiList').querySelector('.wifi-presets-more'),
      state.wifi.map((w) => w.ssid).join());
    undo();
    ok('each one undo step', state.wifi.length === 2);
    state.wifi[0].ssid = 'staff';
    renderWifiPanel(true);
    left = [...el('wifiList').querySelectorAll('.wifi-presets-more [data-act="preset"]')].map((b) => b.dataset.wf);
    ok('a network already named so (any case) is not offered', !left.includes('staff') && left.includes('iot'), left.join());

    // ---- 5: touch size rule ----
    const rule = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } })
      .flatMap((x) => (x.cssRules ? [...x.cssRules] : [x]))
      .find((x) => x.selectorText === '#wifiList .net-actions .link-btn' && x.style.minWidth);
    ok('a card action is at least 44px on a phone layout', !!rule && rule.style.minWidth === '44px' && rule.style.minHeight === '44px');
    showConfigTab('config');

    // ---- 7: bulk, an SSID the AP does not broadcast ----
    open();
    let plan = bulkPlanWifi(['cam', 'tv'], { ssid: 'wG', band: '' });
    const bad = plan.rows.filter((x) => x.status === 'bad');
    ok('Guest on 2.4 only and listed nowhere: refused on each row', bad.length === 2 && bad.every((x) => /does not broadcast Guest/.test(x.why)) && !plan.ops.length,
      JSON.stringify(plan.rows.map((x) => [x.name, x.status, x.why])));
    plan = bulkPlanWifi(['cam', 'tv'], { ssid: 'wS', band: '' });
    ok('Office, broadcast by both radios: a change on each row', plan.rows.every((x) => x.status === 'change') && plan.ops.length === 2,
      JSON.stringify(plan.rows.map((x) => [x.name, x.status, x.why])));
    plan = bulkPlanWifi(['cam'], { ssid: BULK_WIFI_AUTO, band: '' });
    ok('Auto is never refused', !plan.rows.some((x) => x.status === 'bad'));
    // Applied, an accepted plan raises no SSID warning.
    plan = bulkPlanWifi(['cam', 'tv'], { ssid: 'wS', band: '' });
    batch(() => { bulkWrite(plan, state); save(); });
    ok('applied: no SSID finding', !topologyFindings().some((f) => f.key === 'wifi-ssid'), topologyFindings().map((f) => f.key).join());
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
