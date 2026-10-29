// Wi-Fi, the exit suite (Review-Packs/Topo-wifi.md, W2 part 2): the Smart
// Home sample end to end, as somebody opening it would meet it.
//   1. the samples: Smart Home, Retail, Hotel and the Showcase carry real
//      Wi-Fi (networks, radios with channels, associations) and raise no
//      finding; Common Errors teaches one Wi-Fi fault, its open guest
//      network, and only that one;
//   2. Smart Home: its SSIDs, the AP's radio summary, what is inferred (the
//      TV on Home by its address, every band the best both ends have);
//   3. a client band change through the link panel: a valid one moves the
//      map's label, an impossible one fires the check, and undo clears it;
//   4. the map: a band chip per association, on its own line and clear of
//      zone names, other chips and the ✕, with the SSID in its tooltip,
//      no cable label on a radio link, and 6 GHz drawn in its own dash;
//   5. the CSV round trip of the whole sample;
//   6. the report's Wi-Fi section: the SSID table, a block per AP with each
//      band's channel and width and its clients with their signal, in the
//      reader's language, and no section at all on a wired site.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const json = (v) => JSON.stringify(v);
  const el = (id) => document.getElementById(id);
  const change = (x, v) => { x.value = v; x.dispatchEvent(new Event('change', { bubbles: true })); };
  const show = (list) => list.map((f) => `${f.key}/${f.level}: ${f.detail}`).join(' | ') || 'none';
  const open = (key) => { replaceDocument(cloneData(templatesData[key]), { origin: 'template' }); initHistory(); renderCanvasOnly(); };
  const wifiFound = () => topologyFindings().filter((f) => /^wifi-/.test(f.key) || f.key === 'radio');
  const ssidNamed = (name) => state.wifi.find((w) => w.ssid === name);
  const linkTo = (nodeId) => state.links.find((l) => l.target === nodeId || l.source === nodeId && effectiveMedium(l) === 'wireless');

  try {
    setLocale('en');
    // ---- 1: the samples ----
    ['house', 'retail', 'hotel', 'showcase'].forEach((key) => {
      const doc = templatesData[key];
      const radios = doc.nodes.flatMap((n) => (n.interfaces || []).filter((i) => i.radio && (i.radio.bands || []).some((b) => b.channel)));
      const assoc = doc.links.filter((l) => l.wifi);
      ok(`${key}: Wi-Fi networks, radios with channels and associations`, (doc.wifi || []).length > 0 && radios.length > 0 && assoc.length > 0,
         `${(doc.wifi || []).length} networks, ${radios.length} radios, ${assoc.length} associations`);
      ok(`${key}: every Wi-Fi network is secured and on a subnet the document holds, or on none`,
         doc.wifi.every((w) => ['wpa2', 'wpa3', 'wpa2/3', 'owe'].includes(w.security) && (!w.network || doc.networks.some((n) => n.id === w.network))), json(doc.wifi));
      open(key);
      const found = topologyFindings();
      ok(`${key}: no Wi-Fi finding, not even a note`, wifiFound().length === 0, show(wifiFound()));
      ok(`${key}: no finding at all`, found.filter((f) => f.level !== 'info').length === 0, show(found.filter((f) => f.level !== 'info')));
    });
    open('showcase');
    const office = state.links.find((l) => l.target === 'opc');
    ok('the Showcase\'s 6E laptop lands on 6 GHz by itself', !linkWifiOf(office, 'band') && linkWifiBand(office) === '6', String(linkWifiBand(office)));

    open('errors');
    // Its radio cabled out of eth0 is the older Radio fault, not this one.
    const wf = wifiFound().filter((f) => f.key !== 'radio');
    ok('Common Errors teaches one Wi-Fi fault: its open guest network', wf.length === 1 && wf[0].key === 'wifi-security' && wf[0].level === 'warn'
       && /Guest is open/.test(wf[0].detail) && json(wf[0].nodeIds) === json(['ap']), show(wf));
    ok('and it is listed in the panel under its check', [...document.querySelectorAll('#conflictMsgList .ca-group')]
      .some((g) => /Wi-Fi security/.test(g.querySelector('.ca-check').textContent) && /Guest is open/.test(g.textContent)));
    ok('its blurb counts seven faults', /seven faults/.test(TEMPLATE_META.find((m) => m.key === 'errors').blurb));

    // ---- 2: Smart Home ----
    open('house');
    const home = ssidNamed('Home'), iot = ssidNamed('IoT');
    ok('Smart Home has Home and IoT', state.wifi.map((w) => w.ssid).join() === 'Home,IoT');
    ok('Home is WPA2/WPA3 on every band, on the LAN', home.security === 'wpa2/3' && !home.bands && networkById(home.network).cidr === '192.168.1.0/24', json(home));
    ok('IoT is WPA2 on 2.4 GHz only, with no subnet of its own', iot.security === 'wpa2' && json(iot.bands) === '["2.4"]' && !iot.network, json(iot));
    const ap = getNode('hap');
    const apRadio = radioOf(ap.interfaces.find((i) => i.radio));
    ok('the AP\'s radio summary', radioSummary(apRadio, true) === 'Wi-Fi 6 · 2.4 GHz ch 6/20 · 5 GHz ch 36/80 · Home, IoT', radioSummary(apRadio, true));
    ok('both are broadcast by the one AP', wifiBroadcasters(home.id).map((n) => n.id).join() === 'hap' && wifiBroadcasters(iot.id).map((n) => n.id).join() === 'hap');
    const tv = linkTo('h5'), cam = linkTo('h6'), printer = linkTo('hp1');
    ok('the TV is on Home by its address, and on 5 GHz, with nothing stored', !linkWifiOf(tv, 'ssid') && !linkWifiOf(tv, 'band')
       && linkWifiSsid(tv) === home.id && linkWifiBand(tv) === '5', `${linkWifiSsid(tv)} ${linkWifiBand(tv)}`);
    ok('the camera and the printer are on IoT, on 2.4 GHz', [cam, printer].every((l) => linkWifiSsid(l) === iot.id && linkWifiBand(l) === '2.4'));
    ok('the Wi-Fi tab counts the clients', wifiClients(home.id).map((n) => n.name).join() === 'Smart TV'
       && wifiClients(iot.id).map((n) => n.name).join() === 'Porch Cam,Wireless Printer');

    // ---- 3: a client band change ----
    const bandLabel = (l) => { const x = document.querySelector(`#layer-links text.wifi-band-label[data-link="${l.id}"]`); return x ? x.firstChild.textContent : null; };
    select(tv.id, 'link');
    ok('the link panel shows the band, with the inference first', ![...el('linkWifiProps').classList].includes('hidden')
       && [...el('propWifiBand').options].map((o) => o.textContent).join('|') === 'Auto · 5 GHz|2.4 GHz|5 GHz', [...el('propWifiBand').options].map((o) => o.textContent).join('|'));
    let steps = _undoStack.length;
    change(el('propWifiBand'), '2.4');
    ok('the TV moved to 2.4 GHz: stored, one undo step', linkWifiOf(getLink(tv.id), 'band') === '2.4' && _undoStack.length === steps + 1);
    ok('the map\'s label follows', bandLabel(tv) === '2.4 GHz', String(bandLabel(tv)));
    ok('a band both ends have is no finding', wifiFound().length === 0, show(wifiFound()));
    undo();
    ok('undo puts it back on automatic', !linkWifiOf(getLink(tv.id), 'band') && bandLabel(tv) === '5 GHz');

    // The camera has a 2.4 GHz radio only: its band select offers no 5 GHz, so
    // the impossible band arrives the way a spreadsheet or a hand edit
    // brings it, and the check is what says so.
    select(cam.id, 'link');
    ok('the camera\'s panel offers only the band it has', [...el('propWifiBand').options].map((o) => o.value).join('|') === '|2.4', [...el('propWifiBand').options].map((o) => o.value).join('|'));
    steps = _undoStack.length;
    batch(() => { setLinkWifi(getLink(cam.id), 'band', '5'); save(); });
    renderCanvasOnly();
    let f = wifiFound();
    ok('the camera on 5 GHz fires the band check', f.some((x) => x.key === 'wifi-band' && x.level === 'bad' && /Porch Cam is on 5 GHz, but its own radio has only 2\.4 GHz/.test(x.detail)), show(f));
    ok('and the SSID check: IoT is on 2.4 GHz only', f.some((x) => x.key === 'wifi-ssid' && /broadcasts IoT only on 2\.4 GHz/.test(x.detail)), show(f));
    ok('the camera is marked on the map', nodeSeverity(getNode('h6')) === 'bad' || topologyFindings().some((x) => x.key === 'wifi-band' && x.nodeIds.includes('h6')));
    undo();
    ok('undo clears both', wifiFound().length === 0 && _undoStack.length === steps, show(wifiFound()));

    // ---- 4: the map ----
    renderCanvasOnly();
    const labels = [...document.querySelectorAll('#layer-links g.wifi-band-chip')];
    ok('a band chip per association', labels.length === 3 && labels.every((x) => x.hasAttribute('data-adv')), labels.map((x) => x.textContent).join());
    const tvTip = document.querySelector(`#layer-links g.wifi-band-chip[data-link="${tv.id}"] > title`);
    ok('its tooltip is the SSID, the band and the signal', tvTip && tvTip.textContent === 'Home · 5 GHz · -58 dBm', tvTip && tvTip.textContent);
    batch(() => { getLink(tv.id).cable = { label: 'C-07' }; save(); });
    renderCanvasOnly();
    ok('a radio link shows no cable label, though one is stored', !document.querySelector('#layer-links text.cable-label') && getLink(tv.id).cable.label === 'C-07');
    undo();
    const tagEl = document.querySelector(`#layer-links text.wifi-band-label[data-link="${cam.id}"]`);
    select(null, null);
    tagEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    ok('a press on the label selects its link', inSelection('link', cam.id));
    // The press redrew the map: the label is a new element now.
    const tagNow = document.querySelector(`#layer-links g.wifi-band-chip[data-link="${cam.id}"]`);
    ok('the reduced views hide the labels (data-adv)', getComputedStyle(tagNow).display !== 'none'
       && (document.body.classList.add('simple-mode'), getComputedStyle(tagNow).display === 'none'));
    document.body.classList.remove('simple-mode');
    open('showcase');
    const dashOf = (id) => el(`ui-link-${id}`).getAttribute('stroke-dasharray');
    ok('a 6 GHz link is drawn in its own dash, 2.4 and 5 GHz in the radio one', dashOf('k22') === WIFI_6G_DASH && dashOf('k23') === '4 4' && dashOf('k25') === '4 4'
       && WIFI_6G_DASH !== '4 4', `${dashOf('k22')} / ${dashOf('k23')} / ${dashOf('k25')}`);
    ok('in the same purple', el('ui-link-k22').getAttribute('stroke') === el('ui-link-k23').getAttribute('stroke'));
    const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    ok('the purple is the --topo-wifi token, written as a plain value for the PNG', !!token('--topo-wifi')
       && el('ui-link-k23').getAttribute('stroke') === token('--topo-wifi'), `${el('ui-link-k23').getAttribute('stroke')} vs ${token('--topo-wifi')}`);
    const pillOf = (id) => document.querySelector(`#layer-links g.wifi-band-chip[data-link="${id}"] rect:nth-of-type(2)`);
    ok('a 6 GHz chip is filled in the link colour, a 5 GHz one is outlined on the halo', pillOf('k22').getAttribute('fill') === token('--topo-wifi')
       && pillOf('k23').getAttribute('fill') === token('--topo-wifi-halo'), `${pillOf('k22').getAttribute('fill')} / ${pillOf('k23').getAttribute('fill')}`);

    // Where the chips land (wifiChipPlace): on their own line, so nobody has
    // to guess which link a chip belongs to, and clear of the zone and group
    // name tabs, the devices' names, each other and a selected link's port
    // labels and ✕, on every sample with Wi-Fi.
    const boxOf = (x) => x.getBoundingClientRect();
    const meets = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const chipClash = () => {
        const chips = [...document.querySelectorAll('#layer-links g.wifi-band-chip')];
        const pills = chips.map((c) => boxOf(c.querySelector('rect:nth-of-type(2)')));
        // Zone name tabs, group name tabs, device names and addresses, and a
        // selected link's port labels and ✕.
        const tabs = [...document.querySelectorAll('#layer-zones rect[rx="3"], #layer-groups .grp-tab-pill, #layer-nodes text, #layer-links .port-label, #layer-links .node-delete circle')].map(boxOf);
        const out = [];
        chips.forEach((c, i) => {
            const id = c.getAttribute('data-link');
            const m = /translate\(([-\d.e]+),\s*([-\d.e]+)\)/.exec(c.getAttribute('transform'));
            // The nearest point of the link's path (sampled: isPointInStroke
            // counts the dash gaps as off the stroke).
            if (!m) { out.push(`${id} has no place`); return; }
            const path = el(`ui-link-${id}`), len = path.getTotalLength();
            let near = Infinity;
            for (let k = 0; k <= 400; k++) { const q = path.getPointAtLength(len * k / 400); near = Math.min(near, Math.hypot(q.x - +m[1], q.y - +m[2])); }
            if (near > 1.5) out.push(`${id} off its line (${near.toFixed(1)})`);
            if (tabs.some((t) => meets(pills[i], t))) out.push(`${id} on a label`);
            pills.forEach((p, j) => { if (j > i && meets(pills[i], p)) out.push(`${id} on ${chips[j].getAttribute('data-link')}`); });
        });
        return { n: chips.length, out };
    };
    ['house', 'retail', 'hotel', 'showcase'].forEach((key) => {
        open(key);
        const r = chipClash();
        ok(`${key}: every chip on its own line, clear of zone names and of each other`, r.n > 0 && !r.out.length, `${r.n} chips; ${r.out.join(', ')}`);
    });
    open('house');
    select(tv.id, 'link');
    const tvChip = document.querySelector(`#layer-links g.wifi-band-chip[data-link="${tv.id}"] rect:nth-of-type(2)`);
    const del = document.querySelector('#layer-links .node-delete circle');
    ok('a selected link\'s chip keeps off its ✕', !!tvChip && !!del && !meets(boxOf(tvChip), boxOf(del)));
    const selClash = chipClash();
    ok('and off its port labels and the group tab beside it', !selClash.out.length, selClash.out.join(', '));
    const pad = document.querySelector(`#layer-links g.wifi-band-chip[data-link="${tv.id}"] rect`);
    ok('the chip carries a finger-sized margin round it to press', +pad.getAttribute('height') >= 24 && pad.getAttribute('fill') === 'transparent');
    select(null, null);
    open('showcase');
    state.settings.traceMode = true; select('oap', 'node'); renderCanvasOnly();
    ok('traced, a 6 GHz link still emits the ))) arcs', !!document.querySelector('#layer-links text.flow-wave') && dashOf('k22') === FLOW_DASH.wireless);
    state.settings.traceMode = false; select(null, null); renderCanvasOnly();

    // ---- 5: the CSV round trip ----
    open('house');
    const sig = () => {
      const d = JSON.parse(json(serializeDoc()));
      const name = (id) => (getNode(id) || {}).name;
      return {
        wifi: json(d.wifi),
        radios: d.nodes.map((n) => json([n.name, (n.interfaces || []).map((i) => i.radio || null)])).sort().join('\n'),
        links: state.links.map((l) => json([[`${name(l.source)}:${l.sourceIface}`, `${name(l.target)}:${l.targetIface}`].sort(), effectiveMedium(l), readLinkWifi(l.wifi) || null])).sort().join('\n')
      };
    };
    const want = sig();
    const sheets = [csvSubnetsSheet(), csvWifiSheet(), csvDevicesSheet(), csvInterfacesSheet(), csvCablesSheet()].map((x) => csvText(x));
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    const why = [];
    sheets.forEach((text) => {
      const p = csvParse(text);
      const s = csvSheet(p, csvHasHeadingRow(p.rows));
      const plan = csvPlan(s, csvAutoMap(s));
      plan.rows.filter((r) => r.status === 'conflict').forEach((r) => why.push(`${r.name}: ${r.why}`));
      applyCsvPlan(plan);
    });
    const got = sig();
    const diff = Object.keys(want).filter((k) => got[k] !== want[k]);
    ok('Smart Home round-trips through the spreadsheets: networks, radios, associations', !diff.length && !why.length,
       `${diff.join('+')} ${diff[0] ? String(got[diff[0]]).slice(0, 300) : ''} ${why.slice(0, 2).join(' | ')}`);
    ok('and is as clean after', wifiFound().length === 0, show(wifiFound()));

    // ---- 6: the report ----
    open('house');
    const model = reportModel();
    ok('the report model has the Wi-Fi section', !!model.wifi && model.wifi.networks.length === 2 && model.wifi.aps.length === 1);
    const homeRow = model.wifi.networks.find((n) => n.ssid === 'Home'), iotRow = model.wifi.networks.find((n) => n.ssid === 'IoT');
    ok('an SSID row: security, bands, subnet, APs, clients', homeRow.securityName === 'WPA2/WPA3-Personal' && homeRow.bandsText === '2.4 · 5 GHz'
       && homeRow.subnet && json(homeRow.aps) === '["WiFi AP"]' && json(homeRow.clients) === '["Smart TV"]'
       && iotRow.bandsText === '2.4 GHz' && json(iotRow.clients) === '["Porch Cam","Wireless Printer"]', json([homeRow, iotRow]));
    const apRow = model.wifi.aps[0];
    ok('the AP block: its standard, a row per band', apRow.name === 'WiFi AP' && apRow.standard === 'Wi-Fi 6 (802.11ax)' && apRow.rows.map((r) => r.band).join() === '2.4,5', json(apRow));
    const r24 = apRow.rows[0], r5 = apRow.rows[1];
    ok('each band: channel, width, SSIDs', r24.channel === 6 && r24.width === 20 && json(r24.ssids) === '["Home","IoT"]' && r5.channel === 36 && r5.width === 80 && json(r5.ssids) === '["Home"]');
    ok('and its clients with their signal', json(r24.clients) === json([{ name: 'Porch Cam', signal: -71 }, { name: 'Wireless Printer', signal: -54 }])
       && json(r5.clients) === json([{ name: 'Smart TV', signal: -58 }]), json([r24.clients, r5.clients]));
    const html = reportHtml(model, null);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const h2 = [...doc.querySelectorAll('h2')].map((x) => x.textContent);
    ok('the section is printed, after Connections', h2.indexOf('Wi-Fi') === h2.indexOf('Connections') + 1, h2.join(' / '));
    const nets = doc.querySelector('table.wifi'), radio = doc.querySelector('table.radio');
    ok('the SSID table', nets && nets.tBodies[0].rows.length === 2 && /WPA2\/WPA3-Personal/.test(nets.textContent) && /192\.168\.1\.0\/24/.test(nets.textContent), nets && nets.textContent.replace(/\s+/g, ' ').slice(0, 160));
    ok('the AP\'s table', radio && radio.tBodies[0].rows.length === 2 && /Porch Cam\s*-71 dBm/.test(radio.textContent) && /80 MHz/.test(radio.textContent), radio && radio.textContent.replace(/\s+/g, ' ').slice(0, 200));
    // A channel left to the AP prints as auto, and a client whose band is
    // not known still gets its row.
    const hapRadio = () => radioOf(getNode('hap').interfaces.find((i) => i.radio));
    batch(() => { delete radioBand(hapRadio(), '5').channel; save(); });
    const m2 = reportModel();
    ok('a channel left to the AP is auto', m2.wifi.aps[0].rows[1].channel === null && /auto/.test(new DOMParser().parseFromString(reportHtml(m2, null), 'text/html').querySelector('table.radio').textContent));
    undo();
    setLocale('es');
    const es = new DOMParser().parseFromString(reportHtml(reportModel(), null), 'text/html').querySelector('table.radio');
    ok('in the reader\'s language, the trade\'s words as written', es && /Canal/.test(es.textContent) && /Banda/.test(es.textContent) && /SSID/.test(es.textContent) && /2\.4 GHz/.test(es.textContent), es && es.querySelector('thead').textContent.replace(/\s+/g, ' '));
    setLocale('en');
    open('bank');
    ok('a wired site has no Wi-Fi section', reportModel().wifi === null && !/<h2>Wi-Fi<\/h2>/.test(reportHtml(reportModel(), null)));
  } catch (e) {
    ok('the suite ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  }
  setLocale('en');

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
