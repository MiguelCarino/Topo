// The site report at site scale (plan section 4, "Report at site scale";
// js/report.js):
//   1. a port map per switch and access point, sorted by port whatever order
//      the cables were drawn in, named interfaces after the numbered ports,
//      the free ports as ranges, each row with the device, its interface,
//      its address and the cable's label;
//   2. a compact inventory: one line per interface, the device's own fields
//      on its first line only, a device with no interface still one line;
//   3. the diagram stays inline while its labels read at the width of the
//      text; past that (or past 40 devices) it goes to a landscape page at
//      the end, and past one landscape page to an overview and tiled
//      landscape sheets; the report says so where it would have been;
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
    ok('a small site keeps the diagram before the inventory', html.indexOf('<img src="data:image/png') < html.indexOf('>Device inventory<') && !html.includes('class="sheet land"'));
    loadDocState(site(REPORT_DIAGRAM_INLINE_MAX)); renderCanvasOnly();
    const big = reportModel();
    ok('the large lab is past the line', big.counts.devices > REPORT_DIAGRAM_INLINE_MAX && REPORT_DIAGRAM_INLINE_MAX === 40, String(big.counts.devices));
    const bigHtml = reportHtml(big, image);
    const land = bigHtml.split('class="sheet land"')[1] || '';
    ok('past 40 devices the diagram is on a landscape page of its own', count(bigHtml, 'class="sheet land"') === 1 && !bigHtml.includes('<img src="data:image/png')
       && /<image id="topo-dg" href="data:image\/png/.test(land) && /<use href="#topo-dg"\/>/.test(land));
    ok('at the end, after Scope and method, turned on its side', bigHtml.indexOf('>Scope and method<') < bigHtml.indexOf('class="sheet land"')
       && bigHtml.includes('@page topo-land { size: landscape;') && bigHtml.includes('.sheet.land { page: topo-land;'));
    ok('and the report says where it went', bigHtml.split('>Device inventory<')[0].includes('The diagram is on a landscape page of its own at the end of this report.'));
    ok('without a picture there is no landscape page either', !reportHtml(big, null).includes('class="sheet land"'));

    // The tier follows how small the labels would print (0.2 mm a unit), not
    // the device count alone. Pictures at 1 px a unit, so units = pixels.
    const pic = (w, h, extra = {}) => ({ url: 'data:image/png;base64,iVBORw0KGgo=', width: w, height: h, scale: 1, minX: 0, minY: 0, ...extra });
    ok('a small, narrow drawing stays inline', reportDiagramLayout(pic(800, 600), 10).kind === 'inline');
    ok('a small but wide one goes to a landscape page', reportDiagramLayout(pic(1200, 500), 10).kind === 'sheet');
    ok('a big one that reads on one landscape page gets just that', reportDiagramLayout(pic(1250, 800), 80).kind === 'sheet');
    ok('one too big to read on a page is still one whole page, no grid', reportDiagramLayout(pic(4000, 2000), 300).kind === 'sheet');
    // The lettered grid and its sheets are the Large map's (reportParts.largeMap),
    // so many across and so many down as picked: nothing is guessed.
    const huge = reportDiagramLayout(pic(4000, 2000), 300, { large: true, cols: 4, rows: 2 });
    ok('the large map is the grid asked for, every square printed', huge.kind === 'tiles' && huge.cols === 4 && huge.rows === 2 && huge.tiles.length === 8
       && huge.tiles.map((x) => x.name).join(',') === 'A1,B1,C1,D1,A2,B2,C2,D2', huge.tiles.map((x) => x.name).join(','));
    ok('the tiles cover the drawing, edge to edge', Math.min(...huge.tiles.map((x) => x.x)) <= 0 && Math.max(...huge.tiles.map((x) => x.x + x.w)) >= 4000 - 1e-6
       && Math.min(...huge.tiles.map((x) => x.y)) <= 0 && Math.max(...huge.tiles.map((x) => x.y + x.h)) >= 2000 - 1e-6);
    const a1 = huge.tiles.find((x) => x.name === 'A1'), b1 = huge.tiles.find((x) => x.name === 'B1'), c1 = huge.tiles.find((x) => x.name === 'C1'), a2 = huge.tiles.find((x) => x.name === 'A2');
    ok('neighbours overlap, so nothing on an edge is cut in two', a1 && b1 && a1.x + a1.w - b1.x >= a1.w * REPORT_DIAGRAM_OVERLAP - 1e-6);
    ok('and by the same amount everywhere: an even grid', Math.abs((b1.x - a1.x) - (c1.x - b1.x)) < 1e-6 && Math.abs((a1.x + a1.w - b1.x) - a1.w * REPORT_DIAGRAM_OVERLAP) < 1e-6
       && Math.abs((a1.y + a1.h - a2.y) - a1.h * REPORT_DIAGRAM_OVERLAP) < 1e-6);
    ok('each tile has the page\'s shape', Math.abs(a1.w / a1.h - REPORT_DIAGRAM_PAPER.sheetW / REPORT_DIAGRAM_PAPER.sheetH) < 1e-9);
    ok('the grid is centred on the drawing', Math.abs((a1.x + Math.max(...huge.tiles.map((x) => x.x + x.w))) - 4000) < 1e-6
       && Math.abs((a1.y + Math.max(...huge.tiles.map((x) => x.y + x.h))) - 2000) < 1e-6);
    const sparse = reportDiagramLayout(pic(4000, 2000, { points: [[100, 100], [3900, 1900]] }), 300, { large: true, cols: 3, rows: 3 });
    ok('a square with no device in it is printed too', sparse.tiles.length === 9);
    // Squares can be left out by name: the grid stays the same, they get no sheet.
    const holed = reportDiagramLayout(pic(4000, 2000), 300, { large: true, cols: 3, rows: 2, skip: ['b1', 'C2'] });
    ok('a square left out has no sheet, the grid is the same', holed.grid.length === 6 && holed.tiles.length === 4
       && holed.tiles.map((x) => x.name).join(',') === 'A1,C1,A2,B2' && holed.grid.find((x) => x.name === 'B1').off === true
       && JSON.stringify(holed.grid.map((x) => [x.x, x.y])) === JSON.stringify(reportDiagramLayout(pic(4000, 2000), 300, { large: true, cols: 3, rows: 2 }).tiles.map((x) => [x.x, x.y])));
    ok('leaving every square out leaves none out', reportDiagramLayout(pic(4000, 2000), 300, { large: true, cols: 1, rows: 1, skip: 'A1' }).tiles.length === 1);
    const holedHtml = reportHtml(big, pic(4000, 2000), { technical: true, largeMap: true, largeCols: 3, largeRows: 2, largeSkip: ['B1', 'C2'] });
    ok('the overview shows them faded, the sheets skip them', /class="dg-cell off" data-cell="B1"/.test(holedHtml) && /class="dg-cell off" data-cell="C2"/.test(holedHtml)
       && !/Sheet B1 ·/.test(holedHtml) && /Sheet C1 · 2 of 4/.test(holedHtml) && /the faded ones are left out/.test(holedHtml));
    ok('and no sheet points the way to one left out', !/→ B1/.test(holedHtml) && !/↓ C2/.test(holedHtml));
    ok('past six either way, six; nonsense, two', (() => { const l = reportDiagramLayout(pic(4000, 2000), 3, { large: true, cols: 40, rows: 'x' }); return l.cols === REPORT_DIAGRAM_GRID_MAX && l.rows === REPORT_DIAGRAM_GRID_DEFAULT; })());
    const whole = reportHtml(big, pic(4000, 2000));
    ok('without the large map: one landscape page, no grid, no sheet marks', count(whole, 'class="sheet land"') === 1 && !whole.includes('class="dg-cell"') && !whole.includes('Sheet A1'));
    const tiled = reportHtml(big, pic(4000, 2000), { technical: true, largeMap: true, largeCols: 4, largeRows: 2 });
    const nTiles = huge.tiles.length;
    ok('with it: the page, then an overview and one landscape sheet per square', count(tiled, 'class="sheet land"') === nTiles + 2);
    ok('the picture is carried once, every page points at it', count(tiled, 'href="data:image/png') === 1 && count(tiled, '<use href="#topo-dg"/>') === nTiles + 2);
    ok('the overview draws the grid, the sheets say where they are', count(tiled, 'class="dg-cell"') === nTiles && tiled.includes(`Sheet A1 · 1 of ${nTiles}`) && /Continues on → B1  ↓ A2/.test(tiled));
    ok('and the report says how many', tiled.split('>Device inventory<')[0].includes(`then ${nTiles} landscape sheets`));
    ok('the report caps the picture\'s pixels for a vast drawing', (() => { const f = reportDiagramScale(4); const s = f(10000, 6000); return f(500, 400) === 4 && s < 1 && s * s * 10000 * 6000 <= REPORT_DIAGRAM_MAX_PIXELS + 1 && f(40000, 400) * 40000 <= REPORT_DIAGRAM_MAX_SIDE; })());
    ok('the second switch\'s map runs to its 40 ports', reportPortMaps().find((m) => m.id === 'sw2').rows.length === 41
       && reportPortMaps().find((m) => m.id === 'sw2').free === '41–47');

    // ---- 4. In Spanish ----
    setLocale('es');
    const es = reportHtml(reportModel(), image);
    ok('the new headings are translated', es.includes('>Puertos de los switches<') && es.includes('El diagrama está en una página horizontal propia')
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
