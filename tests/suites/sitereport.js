// The site report at site scale (plan section 4, "Report at site scale";
// js/report.js):
//   1. a port map per switch and access point, sorted by port whatever order
//      the cables were drawn in, named interfaces after the numbered ports,
//      the free ports as ranges, each row with the device, its interface,
//      its address and the cable's label;
//   2. a compact inventory: one line per interface, the device's own fields
//      on its first line only, a device with no interface still one line;
//   3. past 40 devices the diagram goes to an appendix at the end, on a page
//      of its own, and the report says so where it would have been; at 40 or
//      fewer it stays where it was;
//   4. the new headings are translated.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const count = (hay, needle) => hay.split(needle).length - 1;
  const image = { url: 'data:image/png;base64,iVBORw0KGgo=' };

  // A router, a 24-port switch cabled out of order (ports 7, 2, 1, 12, 3 and
  // the named uplink), an AP with a radio client, a server with two NICs and
  // a printer with none; `extra` more PCs on a second switch.
  const site = (extra) => {
    const nodes = [
      { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 100, portCount: 24, interfaces: [{ id: 'up', name: 'sfp1', ip: '' }] },
      { id: 'ap', type: 'ap', name: 'AP-1', x: 200, y: 100, interfaces: [{ id: 'w1', name: 'wlan0', ip: '' }, { id: 'e1', name: 'eth0', ip: '10.0.0.5/24' }] },
      { id: 'srv', type: 'server', name: 'NAS', x: 0, y: 200, interfaces: [{ id: 'i1', name: 'eno1', ip: '10.0.0.20/24', mac: '3C:07:54:11:22:33' }, { id: 'i2', name: 'eno2', ip: '10.0.0.21/24' }] },
      { id: 'prn', type: 'printer', name: 'Printer', x: 100, y: 200, interfaces: [] },
      { id: 'pc7', type: 'pc', name: 'PC-7', x: 0, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.37/24' }] },
      { id: 'pc2', type: 'pc', name: 'PC-2', x: 100, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.32/24' }] },
      { id: 'lap', type: 'pc', name: 'Laptop', x: 300, y: 200, interfaces: [{ id: 'w', name: 'wlan0', ip: '10.0.0.60/24' }] }
    ];
    const links = [
      { id: 'u', source: 'rt', target: 'sw', sourceIface: 'e0', targetIface: 'up' },
      { id: 'a', source: 'sw', target: 'pc7', sourceIface: 'p7', targetIface: 'i1', cable: { label: 'WS-07' } },
      { id: 'b', source: 'sw', target: 'pc2', sourceIface: 'p2', targetIface: 'i1' },
      { id: 'c', source: 'srv', target: 'sw', sourceIface: 'i1', targetIface: 'p1' },
      { id: 'd', source: 'sw', target: 'prn', sourceIface: 'p12', targetIface: 'p12' },
      { id: 'e', source: 'sw', target: 'ap', sourceIface: 'p3', targetIface: 'e1' },
      { id: 'f', source: 'ap', target: 'lap', sourceIface: 'w1', targetIface: 'w', medium: 'wireless' }
    ];
    if (extra) {
      nodes.push({ id: 'sw2', type: 'switch', name: 'SW-2', x: 400, y: 100, portCount: 48, interfaces: [] });
      links.push({ id: 's2', source: 'sw', target: 'sw2', sourceIface: 'p24', targetIface: 'p48' });
      for (let i = 1; i <= extra; i++) {
        nodes.push({ id: `x${i}`, type: 'pc', name: `Desk ${i}`, x: 400, y: 200 + i, interfaces: [{ id: 'i1', name: 'eth0', ip: `10.0.0.${100 + i}/24` }] });
        links.push({ id: `lx${i}`, source: 'sw2', target: `x${i}`, sourceIface: `p${i}`, targetIface: 'i1' });
      }
    }
    return { v: DOC_VERSION, nodes, links };
  };

  try {
    // ---- 1. The port map ----
    loadDocState(site(0)); renderCanvasOnly();
    const maps = reportPortMaps();
    const sw = maps.find((m) => m.id === 'sw');
    ok('one map per switch or AP with something cabled to it', maps.map((m) => m.name).join(',') === 'AP-1,SW-1', maps.map((m) => m.name).join(','));
    ok('sorted by port, whatever order the cables were drawn in', sw.rows.map((r) => r.label).join(',') === '1,2,3,7,12,sfp1', sw.rows.map((r) => r.label).join(','));
    ok('each row names the device, its interface and address', sw.rows[0].peer === 'NAS' && sw.rows[0].peerIface === 'eno1' && sw.rows[0].ip === '10.0.0.20/24');
    ok('and the cable\'s label', sw.rows.find((r) => r.label === '7').cable === 'WS-07');
    ok('the free ports as ranges', sw.free === '4–6, 8–11, 13–24' && sw.used === 5 && sw.total === 24, `${sw.free} ${sw.used}/${sw.total}`);
    const ap = maps.find((m) => m.id === 'ap');
    ok('an AP lists its radio client after its ports', ap.rows.map((r) => `${r.label}>${r.peer}`).join(',') === 'eth0>SW-1,wlan0>Laptop', ap.rows.map((r) => `${r.label}>${r.peer}`).join(','));
    const model = reportModel();
    const html = reportHtml(model, image);
    ok('the report has a Switch ports section with one table per switch', html.includes('>Switch ports<') && count(html, 'class="ports"') === 2);
    ok('headed by the switch and its use', /<h3>SW-1 <span class="muted">· Switch · 5 of 24 ports used<\/span><\/h3>/.test(html), (html.match(/<h3>SW-1[^\n]*/) || [])[0]);
    ok('printed in port order', (() => { const t = html.split('<h3>SW-1')[1].split('</table>')[0]; return ['NAS', 'PC-2', 'AP-1', 'PC-7', 'Printer'].every((n, i, a) => !i || t.indexOf(`<b>${a[i - 1]}</b>`) < t.indexOf(`<b>${n}</b>`)); })());
    ok('with the free ports under it', html.includes('Free: 4–6, 8–11, 13–24'));

    // ---- 2. The compact inventory ----
    const inv = html.split('<table class="inv">')[1].split('</table>')[0];
    const ifaceCount = model.devices.reduce((n, d) => n + Math.max(1, d.interfaces.length), 0);
    ok('one line per interface', count(inv, '<tr class="dev">') + count(inv, '<tr class="cont">') === ifaceCount, `${count(inv, '<tr class="dev">')}+${count(inv, '<tr class="cont">')} vs ${ifaceCount}`);
    ok('a device starts one line, its other interfaces continue it', count(inv, '<tr class="dev">') === model.devices.length);
    const nas = inv.split('<b>NAS</b>')[1].split('<tr class="dev">')[0];
    ok('the second NIC is a line of its own, without the device repeated', count(nas, '<tr class="cont">') === 1 && /eno2/.test(nas) && /10\.0\.0\.21\/24/.test(nas));
    ok('the MAC in a column of its own', /<td class="mono">3C:07:54:11:22:33/.test(nas));
    ok('a device with no interface is one line that says so', /<b>Printer<\/b>[\s\S]*?<td colspan="3"><span class="muted">none recorded<\/span><\/td>/.test(inv));
    ok('the headers: device, type, interface, address, MAC, then the schema\'s', /<th>Device<\/th><th>Type<\/th><th>Interface<\/th><th>Address<\/th><th>MAC<\/th><th>Gateway<\/th>/.test(inv));

    // ---- 3. The diagram ----
    ok('a small site keeps the diagram before the inventory', html.indexOf('<img src="data:image/png') < html.indexOf('>Device inventory<') && !html.includes('class="appendix"'));
    loadDocState(site(REPORT_DIAGRAM_INLINE_MAX)); renderCanvasOnly();
    const big = reportModel();
    ok('the large lab is past the line', big.counts.devices > REPORT_DIAGRAM_INLINE_MAX && REPORT_DIAGRAM_INLINE_MAX === 40, String(big.counts.devices));
    const bigHtml = reportHtml(big, image);
    const appendix = bigHtml.split('class="appendix"')[1] || '';
    ok('past 40 devices the diagram is in an appendix', count(bigHtml, '<img src="data:image/png') === 1 && /<img src="data:image\/png/.test(appendix));
    ok('at the end, after Scope and method, on a page of its own', bigHtml.indexOf('>Scope and method<') < bigHtml.indexOf('class="appendix"')
       && bigHtml.includes('.appendix { page-break-before: always'));
    ok('and the report says where it went', new RegExp(`At ${big.counts.devices} devices the diagram needs a page of its own`).test(bigHtml.split('>Device inventory<')[0]));
    ok('without a picture there is no appendix either', !reportHtml(big, null).includes('class="appendix"'));
    ok('the second switch\'s map runs to its 40 ports', reportPortMaps().find((m) => m.id === 'sw2').rows.length === 41
       && reportPortMaps().find((m) => m.id === 'sw2').free === '41–47');

    // ---- 4. In Spanish ----
    setLocale('es');
    const es = reportHtml(reportModel(), image);
    ok('the new headings are translated', es.includes('>Puertos de los switches<') && es.includes('>Anexo: diagrama de la topología<')
       && /<th>Puerto<\/th>/.test(es) && /<th>Dirección<\/th>/.test(es) && /Libres: 41–47/.test(es));
    setLocale('en');

    // A kept network's name heads its report when Site was left blank: the
    // downloads were named after the card while the report said "Site not
    // named". Read, never written into the header.
    const { LIBRARY_KEY } = CarinoLibrary;
    const heldLib = localStorage.getItem(LIBRARY_KEY);
    state.report = {};
    claimDocument('Oficina Reforma');
    ok('a blank Site is the kept network\'s name', reportModel().meta.site === 'Oficina Reforma' && !reportHtml(reportModel(), null).includes('Site not named'),
       reportModel().meta.site);
    renderReportFields();
    ok('the dialog shows it as the Site field\'s hint, and leaves the field blank', document.getElementById('report-site').placeholder === 'Oficina Reforma'
       && document.getElementById('report-site').value === '' && !state.report.site);
    state.report = { site: 'Torre B' };
    ok('a Site typed in still wins', reportModel().meta.site === 'Torre B');
    state.report = {};
    if (heldLib === null) localStorage.removeItem(LIBRARY_KEY); else localStorage.setItem(LIBRARY_KEY, heldLib);
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e).slice(0, 300));
  }
  state.nodes = []; state.links = []; state.networks = []; state.accepted = [];

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
