// Port names, port labels and access VLANs (plan section 4, phase 3;
// js/model.js "Port names, labels and access VLANs"). What is held here:
//   1. the document: node.portScheme { prefix, start } and a sparse
//      node.portAttrs { pN: { label, vlan } }, read and written through the
//      schema, junk dropped (a key that is not a port, a VLAN outside 1-4094,
//      control characters), kept only on a switch or an AP, left out when
//      empty, the document stamped v6 and a v5 one opened by the chain;
//   2. names: every reader (the faceplate list, the link panel, the canvas
//      port label, the cables table, the CSV) names a port by the scheme,
//      counted from its first number, an overflow port too, and a cable
//      stays on its position when the scheme changes; a sheet's "Gi1/0/12"
//      or "12" finds the port, counted from the scheme's start;
//   3. the side panel: the prefix and first number with their preview, a
//      label and a VLAN per port (a bad VLAN marked and not written), each
//      field one undo step, a dot on a noted chip, a free chip opening its
//      line; the link panel's chips carry the scheme's name and the label;
//   4. the report's port map: the names, Label and VLAN columns only when a
//      switch's ports carry them, a free labelled port as a row and out of
//      the free ranges, which read in the scheme's names;
//   5. the table's Ports tab: every faceplate port, label and VLAN edited in
//      place (a bad VLAN refused), one undo step, sorted by position, a row
//      click selecting the cable or the switch, the search narrowing it;
//   6. CSV: devices.csv's first_port and ports.csv exported and imported back
//      changing nothing; a ports sheet setting labels and VLANs (blank left,
//      a bad VLAN, an unknown port, a device without a faceplate, two rows
//      disagreeing all conflicts; other columns mapped refused); a site with
//      a scheme counted from 0 rebuilt in a blank map with every cable on
//      the same port and every label back;
//   7. the search: a label finds its switch, vlan: finds the switch with
//      such a port and the device cabled into it; the changes since a
//      back-up name the port facts;
//   8. the words: Spanish for the sentences, VLAN and Physical Ports English.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const fire = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const steps = () => _undoStack.length;
  const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
  const planOf = (text, mapping) => { const s = sheetOf(text); return csvPlan(s, mapping || csvAutoMap(s)); };
  const csvOf = (key) => csvText(CSV_SHEETS.find((s) => s.key === key).build(), ',');

  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1', vlan: 10 }],
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 300, y: 40, interfaces: [{ id: 'w', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 300, y: 160, portCount: 8, interfaces: [],
        portScheme: { prefix: 'Gi1/0/', start: 1 },
        portAttrs: { p3: { label: 'Reception desk', vlan: 30 }, p5: { vlan: 20 } } },
      { id: 'pc1', type: 'pc', name: 'PC-1', x: 200, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] },
      { id: 'pc2', type: 'pc', name: 'PC-2', x: 300, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24' }] }
    ],
    links: [
      { id: 'up', source: 'sw', target: 'rt', sourceIface: 'p1', targetIface: 'w' },
      { id: 'l1', source: 'sw', target: 'pc1', sourceIface: 'p3', targetIface: 'i1' },
      { id: 'l2', source: 'sw', target: 'pc2', sourceIface: 'p4', targetIface: 'i1' }
    ] });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); select(null, null); };
  const quiet = setDialogResponder(() => null);
  const savedView = state.settings.view;

  try {
    // ---- 1: the document ----
    open();
    let sw = getNode('sw');
    ok('the scheme and the port facts load', JSON.stringify(sw.portScheme) === '{"prefix":"Gi1/0/","start":1}'
       && JSON.stringify(sw.portAttrs) === '{"p3":{"label":"Reception desk","vlan":30},"p5":{"vlan":20}}', JSON.stringify(sw.portAttrs));
    const doc = serializeDoc();
    ok(`the document is stamped v${DOC_VERSION} (v6 brought the ports)`, doc.v === DOC_VERSION && DOC_VERSION >= 6);
    ok('a v5 document is opened by the chain', migrateDoc({ v: 5, nodes: [], links: [] }).doc.v === DOC_VERSION
       && MIGRATIONS.some((m) => m.from === 5 && m.to === 6));
    const swOut = doc.nodes.find((n) => n.id === 'sw');
    ok('both are written, in schema order before the interfaces', JSON.stringify(Object.keys(swOut).slice(Object.keys(swOut).indexOf('portCount'), Object.keys(swOut).indexOf('portCount') + 4))
       === '["portCount","portScheme","portAttrs","interfaces"]', Object.keys(swOut).join(','));
    ok('a device that never said anything carries neither', !('portScheme' in JSON.parse(JSON.stringify(doc)).nodes.find((n) => n.id === 'rt'))
       && !('portAttrs' in JSON.parse(JSON.stringify(doc)).nodes.find((n) => n.id === 'rt')));
    applyDoc(JSON.stringify(doc));
    ok('serialize -> load is a fixed point', JSON.stringify(serializeDoc()) === JSON.stringify(doc));

    const junk = normalizeLoadedNode({ id: 'j', type: 'switch', name: 'J', x: 0, y: 0, interfaces: [],
      portScheme: { prefix: '\u0007  Te', start: '0', extra: 'x' },
      portAttrs: JSON.parse('{"__proto__":{"label":"bad"},"p0":{"label":"zero"},"eth0":{"label":"nic"},"p2":{"label":"  A\\nB  ","vlan":"40","x":1},"p7":{"vlan":4095},"p9":"text","p10":{"label":"   "}}') });
    ok('junk is dropped: a key that is not a port, a VLAN out of range, an empty entry',
       JSON.stringify(junk.portAttrs) === '{"p2":{"label":"A B","vlan":40}}', JSON.stringify(junk.portAttrs));
    ok('the prefix loses control characters and leading space; a string start is a number', JSON.stringify(junk.portScheme) === '{"prefix":"Te","start":0}', JSON.stringify(junk.portScheme));
    ok('the default scheme (no prefix, from 1) is no scheme', normalizePortScheme({ prefix: '', start: 1 }) === undefined && normalizePortScheme({ prefix: '', start: 99999 }) === undefined);
    const host = normalizeLoadedNode({ id: 'h', type: 'pc', name: 'H', x: 0, y: 0, portScheme: { prefix: 'x', start: 2 }, portAttrs: { p1: { label: 'L' } } });
    ok('only a switch or an AP keeps them', !('portScheme' in host) && !('portAttrs' in host));
    // A prefix ending in a digit has no text form that reads back as itself
    // ("Port 0" from 1 prints "Port 01", which reads as "Port " from 1).
    ok('a prefix ending in a digit is no scheme', normalizePortScheme({ prefix: 'Port 0', start: 1 }) === undefined
       && normalizePortScheme({ prefix: 'Gi1/0/1', start: 0 }) === undefined && JSON.stringify(normalizePortScheme({ prefix: 'eth', start: 0 })) === '{"prefix":"eth","start":0}');
    const schemeRow = NODE_FIELDS.find((f) => f.key === 'portScheme');
    ok('first_port refuses a padded number, reads a plain 0',
       schemeRow.fromText('Port 01') === null && schemeRow.fromText('Gi1/0/007') === null
       && JSON.stringify(schemeRow.fromText('Gi1/0/0')) === '{"prefix":"Gi1/0/","start":0}' && JSON.stringify(schemeRow.fromText('10')) === '{"prefix":"","start":10}');
    const trips = [['Gi1/0/', 1], ['ge-0/0/', 0], ['Port ', 10], ['eth', 0], ['', 7], ['X-', 9999]].every(([prefix, start]) => {
        const sc = normalizePortScheme({ prefix, start });
        return JSON.stringify(normalizePortScheme(schemeRow.fromText(schemeRow.toText(sc)) || {})) === JSON.stringify(sc);
    });
    ok('every scheme\'s first_port reads back as the same scheme', trips);
    const stray = JSON.stringify(writeFields(NODE_FIELDS, normalizeLoadedNode({ id: 's2', type: 'switch', name: 'S', x: 0, y: 0, interfaces: [], portAttrs: { p1: { label: 'ok', secret: 'pw' } } })));
    ok('the allowlist holds inside a port entry', stray.indexOf('secret') === -1 && stray.indexOf('"label":"ok"') > -1);
    const cleared = { type: 'switch', portAttrs: { p3: { label: 'x' } } };
    setPortAttr(cleared, 'p3', 'label', '');
    ok('emptying the last fact drops the entry and the map', !('portAttrs' in cleared));

    // ---- 2: names ----
    open(); sw = getNode('sw');
    ok('a port reads as the scheme names it', ifaceLabel(sw, 'p12') === 'Gi1/0/12' && getInterfaces(sw)[0].name === 'Gi1/0/1');
    ok('no scheme reads as the bare number, as before', ifaceLabel(getNode('rt'), 'w') === 'eth0' && portNameOf({ type: 'switch' }, 7) === '7');
    sw.portScheme = { prefix: 'ge-0/0/', start: 0 };
    ok('counted from the first number (0 here)', ifaceLabel(sw, 'p1') === 'ge-0/0/0' && ifaceLabel(sw, 'p8') === 'ge-0/0/7');
    ok('a port past the faceplate is named the same way', ifaceLabel(sw, 'p9') === 'ge-0/0/8');
    ok('a cable keeps its position when the names change', state.links.find((l) => l.id === 'l1').sourceIface === 'p3');
    ok('a sheet\'s name, or its number, finds the port', portIdByText(sw, 'ge-0/0/4') === 'p5' && portIdByText(sw, '4') === 'p5' && portIdByText(sw, 'port 0') === 'p1');
    ok('a number before the first is no port', portIdByText({ type: 'switch', portScheme: { prefix: '', start: 5 } }, '3') === null);
    ok('another box\'s prefix is no port (a stack member\'s Gi2/0/5 is not Gi1/0/5)',
       portIdByText({ type: 'switch', portScheme: { prefix: 'Gi1/0/', start: 1 } }, 'Gi2/0/5') === null
       && portIdByText({ type: 'switch', portScheme: { prefix: 'Gi1/0/', start: 1 } }, 'gi1/0/5') === 'p5'
       && portIdByText({ type: 'switch', portScheme: { prefix: 'Gi1/0/', start: 1 } }, 'Port 5') === 'p5');
    ok('a box with no prefix reads any name by its number, as before', portIdByText({ type: 'switch' }, 'Gi1/0/12') === 'p12');
    ok('the cables table names the ports by the scheme', reportConnections().find((c) => c.id === 'l1').fromIface === 'ge-0/0/2');

    // ---- 3: the side panel ----
    open(); sw = getNode('sw');
    select('sw', 'node');
    const prefix = el('portPrefixInput'), start = el('portStartInput');
    ok('the scheme is in the faceplate, with its preview', !!prefix && !!start && prefix.value === 'Gi1/0/' && start.value === '1'
       && /Gi1\/0\/1 … Gi1\/0\/8/.test(document.querySelector('.port-scheme-preview').textContent));
    initHistory();
    let before = steps();
    fire(prefix, 'Fa0/');
    fire(start, '0');
    commitTyping();
    ok('typing the scheme renames the ports, one undo step', ifaceLabel(sw, 'p3') === 'Fa0/2' && steps() === before + 1, `${ifaceLabel(sw, 'p3')} ${steps() - before}`);
    ok('the field being typed into stays', document.activeElement !== prefix || el('portPrefixInput') === prefix);
    ok('the preview follows', /Fa0\/0 … Fa0\/7/.test(document.querySelector('.port-scheme-preview').textContent));
    ok('so do the chips\' tooltips', /Fa0\/1: free/.test(document.querySelector('.port-chip[data-port="p2"]').title), document.querySelector('.port-chip[data-port="p2"]').title);
    fire(start, '-3');
    ok('a negative first number is marked and not written', start.classList.contains('bad') && sw.portScheme.start === 0);
    fire(prefix, 'Gi9/');
    ok('a bad first number does not hold up the prefix', sw.portScheme.prefix === 'Gi9/' && sw.portScheme.start === 0 && start.classList.contains('bad') && !prefix.classList.contains('bad'),
       JSON.stringify(sw.portScheme));
    fire(start, '0');
    // Entered as a person would: what the scheme said then is what a bad
    // prefix keeps, not the keystroke before it.
    prefix.dispatchEvent(new Event('focus'));
    fire(prefix, 'Port ');
    fire(prefix, 'Port 0');
    ok('a prefix ending in a digit is marked, says why, and keeps the scheme it was entered with',
       prefix.classList.contains('bad') && prefix.getAttribute('aria-invalid') === 'true' && /cannot end in a digit/.test(prefix.title)
       && sw.portScheme.prefix === 'Gi9/' && ifaceLabel(sw, 'p1') === 'Gi9/0', JSON.stringify(sw.portScheme) + ' ' + prefix.title);
    ok('and says why under the field, where a phone shows it', /cannot end in a digit/.test(document.querySelector('.port-scheme-preview').textContent));
    prefix.dispatchEvent(new Event('blur'));
    ok('leaving it shows what is kept', /Gi9\/0 … Gi9\/7/.test(document.querySelector('.port-scheme-preview').textContent) && prefix.value === 'Gi9/' && !prefix.classList.contains('bad') && !prefix.hasAttribute('aria-invalid'));
    // Back to what was committed, so the undo below has one step to take.
    fire(prefix, 'Fa0/');
    fire(start, '0');
    undo();
    sw = getNode('sw');
    ok('undo puts the old names back', ifaceLabel(sw, 'p3') === 'Gi1/0/3');
    // Typed slowly: a pause on "Port " (a scheme nobody chose, on the way to
    // "Port 0/") is not an undo step; leaving the field takes the one step.
    sw.portScheme = { prefix: 'Gi1/0/', start: 0 };
    save(); select('sw', 'node');
    const slow = el('portPrefixInput');
    before = steps();
    slow.focus(); slow.dispatchEvent(new Event('focus'));
    fire(slow, 'Port ');
    await new Promise((r) => setTimeout(r, TYPING_IDLE_MS + 200));
    ok('a pause in the prefix field takes no undo step', steps() === before && sw.portScheme.prefix === 'Port ', (steps() - before) + ' ' + JSON.stringify(sw.portScheme));
    fire(slow, 'Port 0');
    fire(slow, 'Port 0/');
    slow.blur();
    ok('leaving it takes one', steps() === before + 1 && sw.portScheme.prefix === 'Port 0/', (steps() - before) + ' ' + JSON.stringify(sw.portScheme));
    undo();
    sw = getNode('sw');
    ok('and Undo goes back to the scheme before, not the half-typed one', JSON.stringify(sw.portScheme) === JSON.stringify({ prefix: 'Gi1/0/', start: 0 }), JSON.stringify(sw.portScheme));
    undo();
    sw = getNode('sw');
    select('sw', 'node');
    const chips = [...document.querySelectorAll('#ifaceListContainer .faceplate .chip-row .port-chip')];
    ok('the faceplate shows positions, a noted port marked', chips[2].textContent === '3' && chips[2].classList.contains('noted') && !chips[1].classList.contains('noted'));
    ok('a chip\'s tooltip names the port, its label and VLAN', /Gi1\/0\/3 · Reception desk · VLAN 30/.test(chips[2].title) && /PC-1/.test(chips[2].title), chips[2].title);
    ok('a free port says so', /Gi1\/0\/6: free/.test(chips[5].title), chips[5].title);
    ok('the list is folded at first and counts what is noted', el('portAttrBox') && !el('portAttrBox').open && /\(2\)/.test(el('portAttrBox').querySelector('summary').textContent));
    chips[5].click();
    const line6 = el('portAttrBox').querySelector('.port-attr[data-port="p6"]');
    ok('a free chip opens its line on the label', el('portAttrBox').open && document.activeElement === line6.querySelector('.port-attr-label'));
    before = steps();
    fire(line6.querySelector('.port-attr-label'), 'Wall jack 2B');
    commitTyping();
    ok('a label typed is kept, one undo step', portAttrOf(sw, 'p6').label === 'Wall jack 2B' && steps() === before + 1);
    const vlan6 = line6.querySelector('.port-attr-vlan');
    fire(vlan6, '5000');
    ok('a VLAN outside 1-4094 is marked and not written', vlan6.classList.contains('bad') && portAttrOf(sw, 'p6').vlan === null);
    ok('the faceplate catches up as a label is typed: the dot and the count', document.querySelector('.port-chip[data-port="p6"]').classList.contains('noted')
       && /\(3\)/.test(el('portAttrBox').querySelector('summary').textContent)
       && /Wall jack 2B/.test(document.querySelector('.port-chip[data-port="p6"]').title), el('portAttrBox').querySelector('summary').textContent);
    // Typed digit by digit, the valid prefixes on the way to a refused value
    // are not left behind in the document.
    vlan6.dispatchEvent(new Event('focus'));
    ['5', '50', '500', '5000'].forEach((v) => fire(vlan6, v));
    ok('"5000" typed digit by digit leaves no VLAN 500 behind', vlan6.classList.contains('bad') && portAttrOf(sw, 'p6').vlan === null, String(portAttrOf(sw, 'p6').vlan));
    vlan6.dispatchEvent(new Event('blur'));
    ok('leaving a refused field shows what the port holds', vlan6.value === '' && !vlan6.classList.contains('bad'));
    fire(vlan6, '40');
    commitTyping();
    ok('a good one is', !vlan6.classList.contains('bad') && portAttrOf(sw, 'p6').vlan === 40);
    ok('the chip\'s tooltip follows the VLAN', /VLAN 40/.test(document.querySelector('.port-chip[data-port="p6"]').title));
    vlan6.dispatchEvent(new Event('focus'));
    ['4', '40', '409', '4095'].forEach((v) => fire(vlan6, v));
    ok('a refused edit puts back the VLAN the port had', portAttrOf(sw, 'p6').vlan === 40, String(portAttrOf(sw, 'p6').vlan));
    vlan6.dispatchEvent(new Event('blur'));
    ok('and the field shows it again', vlan6.value === '40');
    commitTyping();
    fire(vlan6, '');
    fire(line6.querySelector('.port-attr-label'), '');
    commitTyping();
    ok('emptied, the port says nothing again', !hasPortAttrs(sw, 'p6') && !('p6' in (sw.portAttrs || {})));
    select('sw', 'node');
    ok('the list stays open across a redraw', el('portAttrBox').open);
    _portAttrsOpen = false;

    // The link panel.
    select('l1', 'link');
    const swRow = el('linkPortBody').children[0];
    const picked = swRow.querySelector('.port-chip.picked');
    ok('the link panel names the port by the scheme and shows its label', !!picked && picked.firstChild.textContent === 'Gi1/0/3'
       && picked.querySelector('.port-chip-sub').textContent === 'Reception desk' && /VLAN 30/.test(picked.title), picked && picked.title);
    select(null, null);

    // ---- 4: the report ----
    open();
    const maps = reportModel().portMaps;
    const m = maps.find((x) => x.id === 'sw');
    ok('the port map reads the scheme\'s names', m.rows.map((r) => r.label).join(',') === 'Gi1/0/1,Gi1/0/3,Gi1/0/4,Gi1/0/5', m.rows.map((r) => r.label).join(','));
    ok('a free port with a VLAN is a row of its own, and not counted as used', m.rows.find((r) => r.port === 5).free && m.used === 3);
    ok('the free ranges read in the scheme\'s names, without it', m.free === 'Gi1/0/2, Gi1/0/6–Gi1/0/8', m.free);
    const html = portMapsSection(maps);
    ok('Label and VLAN columns, with the facts', /<th>Label<\/th><th>VLAN<\/th>/.test(html) && /Reception desk/.test(html) && />30</.test(html) && />Free</.test(html));
    getNode('sw').portAttrs = undefined; delete getNode('sw').portAttrs;
    const plain = portMapsSection(reportModel().portMaps);
    ok('a switch with no port facts has no such columns', !/<th>Label<\/th>/.test(plain) && !/<th>VLAN<\/th>/.test(plain));

    // ---- 5: the table ----
    open();
    setView('table');
    showTableTab('ports');
    const keys = () => [...el('tvGrid').querySelectorAll('tbody tr[data-row]')].map((r) => r.dataset.row);
    ok('a row per faceplate port', keys().length === 8 && keys()[0] === 'p:sw:p1', keys().join(' '));
    const cell = (rk, col) => [...el('tvGrid').querySelectorAll('tbody tr[data-row]')].find((r) => r.dataset.row === rk).querySelector(`td[data-col="${col}"]`);
    ok('names, facts and what is plugged in', cell('p:sw:p3', 'port').textContent === 'Gi1/0/3' && cell('p:sw:p3', 'port:label').textContent === 'Reception desk'
       && cell('p:sw:p3', 'port:vlan').textContent === '30' && /PC-1 · eth0/.test(cell('p:sw:p3', 'peer').textContent) && cell('p:sw:p6', 'peer').textContent === 'Free');
    ok('technical headers stay English, plain ones are words', el('tableView').querySelector('[data-tvtab="ports"]').textContent === 'Ports'
       && el('tvGrid').querySelector('th[data-col="port:vlan"]').textContent.includes('VLAN'));
    const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const edit = (rk, col, value) => { const td = cell(rk, col); td.focus(); key(td, 'Enter'); const ed = _tv.editor; if (!ed) return false; ed.el.value = value; key(ed.el, 'Enter'); return true; };
    initHistory();
    before = steps();
    ok('a label is edited in place', edit('p:sw:p7', 'port:label', 'Printer drop') && portAttrOf(getNode('sw'), 'p7').label === 'Printer drop' && steps() === before + 1);
    edit('p:sw:p7', 'port:vlan', '9999');
    ok('a bad VLAN is refused, the cell left open', portAttrOf(getNode('sw'), 'p7').vlan === null && !!_tv.editor);
    if (_tv.editor) cancelEdit(true);
    ok('a good one is kept', edit('p:sw:p7', 'port:vlan', '50') && portAttrOf(getNode('sw'), 'p7').vlan === 50);
    edit('p:sw:p7', 'port:vlan', '');
    ok('a blank VLAN clears it', portAttrOf(getNode('sw'), 'p7').vlan === null && portAttrOf(getNode('sw'), 'p7').label === 'Printer drop');
    undo(); undo(); undo();
    ok('each kept edit was one undo step', !hasPortAttrs(getNode('sw'), 'p7'));
    _tv.sort.ports = { col: 'port', dir: -1 }; renderTableView(true);
    ok('sorted by position, not as text', keys()[0] === 'p:sw:p8' && keys()[7] === 'p:sw:p1');
    _tv.sort.ports = null; renderTableView(true);
    focusRow(rowByKey('p:sw:p3'));
    ok('a cabled port\'s row selects its cable', inSelection('link', 'l1'));
    focusRow(rowByKey('p:sw:p6'));
    ok('a free one selects the switch', inSelection('node', 'sw'));
    setQuery('reception');
    ok('the search narrows the ports by label', keys().join(' ') === 'p:sw:p3', keys().join(' '));
    setQuery('vlan:20');
    ok('vlan: finds the port with that access VLAN', keys().join(' ') === 'p:sw:p5', keys().join(' '));
    setQuery('');
    // A paste down the label column.
    const plan = planPaste('port:label', 'Desk A\nDesk B', { rows: [rowByKey('p:sw:p6'), rowByKey('p:sw:p7')], mode: 'selected' });
    ok('a list pastes down the label column', applyPastePlan(plan) === 2 && portAttrOf(getNode('sw'), 'p6').label === 'Desk A' && portAttrOf(getNode('sw'), 'p7').label === 'Desk B');
    setView('map');

    // ---- 6: CSV ----
    open();
    const dev = sheetOf(csvOf('devices'));
    const swRowCsv = dev.rows.find((r) => r[0] === 'sw');
    ok('devices.csv carries first_port', dev.headers.includes('first_port') && swRowCsv[dev.headers.indexOf('first_port')] === 'Gi1/0/1'
       && dev.rows.find((r) => r[0] === 'pc1')[dev.headers.indexOf('first_port')] === '');
    ok('and the PC\'s switch port by the scheme', dev.rows.find((r) => r[0] === 'pc1')[dev.headers.indexOf('port')] === 'Gi1/0/3');
    const portsCsv = csvOf('ports');
    const ps = sheetOf(portsCsv);
    ok('ports.csv: every faceplate port, its name, label and VLAN', ps.rows.length === 8 && ps.headers.join(',') === 'device_id,device,port,port_label,port_vlan,connected_device,connected_port'
       && ps.rows[2].join('|') === 'sw|SW-1|Gi1/0/3|Reception desk|30|PC-1|eth0', ps.rows[2].join('|'));
    ok('its columns map themselves, the connected ones left alone', csvAutoMap(ps).join(',') === 'id,name,cab:port,pt:label,pt:vlan,,', csvAutoMap(ps).join(','));
    ok('every sheet imported straight back changes nothing',
       ['devices', 'interfaces', 'cables', 'ports'].every((k) => { const p = planOf(csvOf(k)); return !p.errors.length && p.counts.change === 0 && p.counts.add === 0 && p.counts.conflict === 0; }));
    let p = planOf('device,port,port_label,port_vlan\nSW-1,Gi1/0/6,Jack 6,60\nSW-1,7,,70\nSW-1,3,,\nSW-1,Gi1/0/2,Upstairs,4095\nPC-1,1,x,\nSW-1,Te9,,\nSW-1,Gi1/0/99,Far jack,\nSW-1,Gi2/0/5,Wrong member,\nNobody,1,x,\nSW-1,8,A,\nSW-1,8,B,');
    ok('a ports sheet: set, blank left, bad VLAN, no faceplate, unknown device, two rows disagreeing',
       p.kind === 'ports' && p.rows.map((r) => r.status).join(',') === 'change,change,same,conflict,conflict,conflict,conflict,conflict,conflict,change,conflict', p.rows.map((r) => r.status + ':' + r.why).join(' | '));
    ok('a port the box does not have is a conflict, not a made-up port: another prefix, or past the faceplate',
       [5, 6, 7].every((i) => /has no port/.test(p.rows[i].why)), [5, 6, 7].map((i) => p.rows[i].why).join(' | '));
    const nBefore = steps();
    applyCsvPlan(p);
    sw = getNode('sw');
    ok('applied as one step: labels and VLANs written, a blank cell left', portAttrOf(sw, 'p6').label === 'Jack 6' && portAttrOf(sw, 'p6').vlan === 60
       && portAttrOf(sw, 'p7').vlan === 70 && portAttrOf(sw, 'p3').label === 'Reception desk' && portAttrOf(sw, 'p8').label === 'A'
       && portAttrOf(sw, 'p2').label === '' && steps() === nBefore + 1);
    ok('nothing written past the faceplate or on another member\'s port', faceplatePortIds(sw).length === 8 && !hasPortAttrs(sw, 'p9') && !hasPortAttrs(sw, 'p99') && portAttrOf(sw, 'p5').label !== 'Wrong member');
    p = planOf('device,port,port_label,ip\nSW-1,1,x,10.0.0.5');
    ok('a ports sheet with other columns mapped is refused', p.kind === 'mixed-ports' && p.errors.length === 1);
    p = planOf('device,port_label\nSW-1,x');
    ok('a row with no port says which column to map', p.rows[0].status === 'conflict' && /port column/.test(p.rows[0].why));
    // An inventory with a VLAN column is still an inventory.
    ok('a bare "VLAN" heading is not a port sheet', csvSheetKind(csvAutoMap(sheetOf('name,ip,vlan\nX,10.0.0.9/24,10'))) === 'devices');

    // The round trip, counted from 0, into a blank map.
    open();
    getNode('sw').portScheme = { prefix: 'ge-0/0/', start: 0 };
    setPortAttr(getNode('sw'), 'p8', 'label', 'Spare');
    save();
    const files = ['devices', 'interfaces', 'cables', 'ports'].map((k) => csvOf(k));
    const wasLinks = state.links.map((l) => `${l.source}:${l.sourceIface}>${l.target}:${l.targetIface}`).sort().join(' ');
    const wasSw = JSON.stringify({ s: getNode('sw').portScheme, a: getNode('sw').portAttrs });
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'new' });
    files.forEach((text) => applyCsvPlan(planOf(text)));
    const back = state.nodes.find((n) => n.name === 'SW-1');
    ok('a scheme counted from 0 comes back', back && JSON.stringify({ s: back.portScheme, a: back.portAttrs }) === wasSw, back && JSON.stringify({ s: back.portScheme, a: back.portAttrs }));
    const nowLinks = state.links.map((l) => `${l.source}:${l.sourceIface}>${l.target}:${l.targetIface}`).sort().join(' ');
    ok('every cable on the same port', nowLinks === wasLinks, `${nowLinks} vs ${wasLinks}`);

    // A padded first_port from another sheet is refused, not read as
    // another name.
    p = planOf('id,first_port\nsw,Port 01');
    ok('a padded first_port is a conflict', p.rows[0].status === 'conflict' && /Port 01/.test(p.rows[0].why), p.rows.map((r) => r.status + ':' + r.why).join(' | '));

    // A switch turned into a PC keeps its port facts in memory (turning it
    // back gives them back) but writes none: they would leave unseen.
    open();
    getNode('sw').type = 'pc';
    const written = () => JSON.parse(JSON.stringify(serializeDoc())).nodes.find((n) => n.id === 'sw');
    let out = written();
    ok('a device with no faceplate writes no port names or labels', !('portScheme' in out) && !('portAttrs' in out), Object.keys(out).join(','));
    // Nor does its spreadsheet row: a first_port left on a PC would not read
    // back ("Only a switch or an access point has numbered ports").
    const pcDev = sheetOf(csvOf('devices'));
    ok('nor does devices.csv: the retyped switch\'s first_port is blank', pcDev.rows.find((r) => r[0] === 'sw')[pcDev.headers.indexOf('first_port')] === '',
       pcDev.rows.find((r) => r[0] === 'sw').join('|'));
    const pcPlan = planOf(csvOf('devices'));
    const pcRow = pcPlan.rows.find((r) => r.nodeId === 'sw');
    ok('and the sheet reads back without a word about numbered ports',
       !pcPlan.errors.length && pcPlan.rows.every((r) => !/numbered ports/.test([r.why].concat(r.notes || []).join(' '))) && !!pcRow && pcRow.status !== 'conflict',
       pcPlan.rows.map((r) => r.status + ':' + (r.why || '') + ':' + (r.notes || []).join(';')).join(' | '));
    // Nor is it found by a label the page no longer shows.
    setPortAttr(getNode('sw'), 'p2', 'label', 'Zebrajack');
    const pcLit = (text) => { setQuery(text); const m2 = queryMapMatches(); setQuery(''); return m2 ? [...m2.nodes].sort().join(',') : ''; };
    ok('nor does the search find it by a port label it no longer shows', !pcLit('Zebrajack').split(',').includes('sw'), pcLit('Zebrajack'));
    getNode('sw').type = 'switch';
    out = written();
    ok('turned back, they are written again', out.portScheme && out.portAttrs && out.portAttrs.p3.label === 'Reception desk');
    ok('turned back, the label finds it again', pcLit('Zebrajack') === 'sw', pcLit('Zebrajack'));

    // ---- 7: search and changes ----
    open();
    const lit = (text) => { setQuery(text); const m2 = queryMapMatches(); setQuery(''); return m2 ? [...m2.nodes].sort().join(',') : ''; };
    ok('a label finds its switch', lit('reception') === 'sw', lit('reception'));
    ok('vlan: finds the switch with that port and the device cabled into it', lit('vlan:30') === 'pc1,sw', lit('vlan:30'));
    ok('a network\'s VLAN still works', lit('vlan:10').split(',').includes('pc2'));
    const base = serializeDoc();
    setPortAttr(getNode('sw'), 'p4', 'label', 'Lab');
    save();
    const ch = docChanges(base, serializeDoc());
    const swCh = ch.devices.changed.find((c) => c.id === 'sw');
    ok('the changes since a back-up name the port facts', !!swCh && swCh.fields.includes('Port labels and VLANs'), JSON.stringify(ch.devices.changed));

    // ---- 8: the words ----
    open();
    setLocale('es'); applyLocale();
    select('sw', 'node');
    ok('the sentences are Spanish', document.querySelector('.port-scheme .prop-lbl').textContent === 'Nombres de los puertos'
       && /Etiquetas y VLAN de los puertos/.test(el('portAttrBox').querySelector('summary').textContent)
       && /Puerto Gi1\/0\/6: libre/.test(document.querySelectorAll('#ifaceListContainer .faceplate .chip-row .port-chip')[5].title));
    ok('the report too', /<th>Etiqueta<\/th><th>VLAN<\/th>/.test(portMapsSection(reportModel().portMaps)));
    ok('the faceplate\'s own heading stays English', /Physical Ports/.test(document.querySelector('#ifaceListContainer .faceplate .prop-lbl').textContent));
    setLocale('en'); applyLocale();
    select(null, null);
  } catch (err) {
    ok('suite ran without throwing', false, err && (err.stack || err.message));
  } finally {
    setDialogResponder(quiet);
    setQuery('');
    if (_tv.editor) cancelEdit(true);
    state.settings.view = savedView; saveSettings(); applyView();
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 50); });
