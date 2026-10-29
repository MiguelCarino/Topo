// Ports on the rack view's boxes (Review-Packs/Topo-groups.md, "Round 5",
// R5a part 1; rackPortsOf, rackPortsFace in js/model.js, "Ports on the
// boxes" in js/rackview.js). What is held here:
//   1. the ports face: the type's side by default (network gear front,
//      everything else rear), stored only where it differs, never on a VM;
//      the rack face the ports are drawn on (a full-depth server's back, a
//      half-depth device's own face);
//   2. which ports, in order: a switch's faceplate named by its scheme, with
//      its labels, VLANs and a port past the count; a host's interfaces,
//      radios and bonds out, a bond's members side by side; only cables
//      that own a port (not a VM's bridge);
//   3. the document: v11, a v10 one migrates with nothing changed, the field
//      round-trips through a reload and an export, and the CSV's ports_face
//      says the face, reads back without a change, and sets one;
//   4. the strip: on the face the ports are on, one mark per port, 24 to a
//      row (48 is two rows), free hollow, cabled filled in the cable's
//      colour, a finding ringed, a VLAN tinted, a bond barred;
//   5. the selected device's box grows to readable ports at 1x, inside the
//      rack; the zoom doubles and triples the units, is kept in this browser
//      and never in the document;
//   6. a port's tip on pointing (mouse) and on a tap (kept), gone on a tap
//      elsewhere and on Escape; a tap on the marks of a box not selected
//      selects it;
//   7. the selected bar's Ports button and the device editor's Ports face:
//      each one undo step; on a half-depth device, whose ports are on its one
//      face whatever the field says, both greyed and saying why;
//   8. "two cables on one port" is the cabling check's rule (isSocketPort):
//      a router's gateway interface with several hosts is not ringed (on the
//      rack view or the report), a server's NIC is, and in every sample a
//      port is ringed doubled only on a device Findings faults for it.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const frame = () => new Promise((r) => setTimeout(r, 30));
  const heldResponder = setDialogResponder(() => null);
  const savedView = state.settings.view;
  let heldZoom = null;
  try { heldZoom = localStorage.getItem('topo.rackZoom'); localStorage.removeItem('topo.rackZoom'); } catch (e) { /* blocked */ }

  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [], group: 'rk' }, extra);
  const site = (v = DOC_VERSION) => ({ v,
    nodes: [
      N('core', 'switch', { rackU: 40, portCount: 48, rackDepth: 'half', portScheme: { prefix: 'Gi1/0/', start: 1 },
        portAttrs: { p1: { label: 'Uplink', vlan: 10 }, p5: { vlan: 20 } } }),
      N('fw', 'firewall', { rackU: 42, rackDepth: 'half', interfaces: [{ id: 'i1', name: 'wan', ip: '' }, { id: 'i2', name: 'lan', ip: '' }] }),
      N('srv', 'server', { rackU: 30, rackHeight: 2, interfaces: [{ id: 'e1', name: 'eno1', ip: '' }, { id: 'w', name: 'wlan0', ip: '' },
        { id: 'e3', name: 'idrac', ip: '' }, { id: 'e2', name: 'eno2', ip: '' },
        { id: 'b0', name: 'bond0', ip: '10.0.0.5/24', bond: { mode: '802.3ad', members: ['e1', 'e2'] } }] }),
      N('half', 'server', { rackU: 20, rackFace: 'rear', rackDepth: 'half', interfaces: [{ id: 'e1', name: 'eth0', ip: '' }] }),
      N('vm', 'vm', { host: 'srv', interfaces: [{ id: 'v1', name: 'eth0', ip: '' }] }),
      N('pc', 'pc', { group: null, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] })
    ].map((n) => { if (n.group === null) delete n.group; return n; }),
    links: [
      { id: 'l1', source: 'fw', target: 'core', sourceIface: 'i2', targetIface: 'p1', cable: { color: 'blue', label: 'UPLINK', length: '1 m', via: 'PP-A:1' } },
      { id: 'l2', source: 'srv', target: 'core', sourceIface: 'e1', targetIface: 'p2', cable: { color: 'not-a-colour' } },
      { id: 'l3', source: 'srv', target: 'core', sourceIface: 'e2', targetIface: 'p3' },
      // Past the 48-port faceplate.
      { id: 'l4', source: 'pc', target: 'core', sourceIface: 'i1', targetIface: 'p50' },
      // A VM's bridge onto its host's NIC owns no port.
      { id: 'l5', source: 'vm', target: 'srv', sourceIface: 'v1', targetIface: 'e3', attachment: 'bridged' }
    ],
    groups: [{ id: 'rk', name: 'Rack P', kind: 'rack', uHeight: 42 }] });
  const node = (id) => getNode(id);
  const view = () => el('rackView');
  const open = (doc = site()) => { replaceDocument(doc, { origin: 'file', docId: 'rack-ports' }); initHistory(); setView('rack'); openRackView('rk'); select(null); renderRackView(true); };
  const box = (id, face) => view().querySelector(`.rk-slots[data-face="${face}"] .rk-dev[data-node="${id}"]`);
  const port = (id, p) => view().querySelector(`.rk-dev[data-node="${id}"] .rk-port[data-port="${p}"]`);
  const tipText = () => { const t = view().querySelector('.rk-ptip'); return t && !t.hidden ? t.textContent : ''; };
  const ptr = (type, target, extra = {}) => target.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true }, extra)));
  const clickAt = (target, extra = {}) => { const r = target.getBoundingClientRect(); target.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true, detail: 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, extra))); };

  try {
    // ---- 1: the ports face ----
    ok('network gear has its ports on its front, the rest on its back',
       ['switch', 'l3switch', 'router', 'edge', 'firewall', 'vpn', 'ap', 'loadbalancer'].every((t) => defaultPortsFace(t) === 'front')
       && ['server', 'pc', 'nas', 'custom', 'printer'].every((t) => defaultPortsFace(t) === 'rear'));
    ok('a face the type already has is not kept; another is; a VM keeps none',
       asPortsFace('rear', { type: 'server' }) === undefined && asPortsFace('front', { type: 'server' }) === 'front'
       && asPortsFace(' REAR ', { type: 'switch' }) === 'rear' && asPortsFace('front', { type: 'vm' }) === undefined && asPortsFace('side', { type: 'server' }) === undefined);
    open();
    ok('portsFaceOf: its own, else its type\'s', portsFaceOf(node('srv')) === 'rear' && portsFaceOf(node('core')) === 'front'
       && portsFaceOf(Object.assign({}, node('srv'), { portsFace: 'front' })) === 'front');
    ok('a full-depth server at the front has its ports on the rack\'s rear', rackPortsFace(node('srv')) === 'rear');
    ok('turned to front ports, on the front', rackPortsFace(Object.assign({}, node('srv'), { portsFace: 'front' })) === 'front');
    ok('a full-depth server mounted at the rear: its back is the front', rackPortsFace(Object.assign({}, node('srv'), { rackFace: 'rear' })) === 'front');
    ok('a half-depth device has its own face only, whatever it says', rackPortsFace(node('half')) === 'rear' && rackPortsFace(Object.assign({}, node('half'), { portsFace: 'front' })) === 'rear');
    ok('a switch\'s ports are on its front', rackPortsFace(node('core')) === 'front');

    // ---- 2: which ports ----
    const cp = rackPortsOf(node('core'));
    ok('a switch: its faceplate in order, and a cabled port past it', cp.length === 49 && cp[0].id === 'p1' && cp[47].id === 'p48' && cp[48].id === 'p50' && cp[48].past && !cp[47].past, cp.length);
    ok('named by its scheme, with its label and VLAN', cp[0].name === 'Gi1/0/1' && cp[0].label === 'Uplink' && cp[0].vlan === 10 && cp[4].vlan === 20 && cp[5].vlan === null);
    ok('with the cables on each', cp[0].links.length === 1 && cp[0].links[0].id === 'l1' && cp[3].links.length === 0);
    const sp = rackPortsOf(node('srv'));
    ok('a host: its interfaces, the radio and the bond out, the bond\'s members together', json(sp.map((p) => p.id)) === '["e1","e2","e3"]', json(sp.map((p) => p.id)));
    ok('the members say their bond', sp[0].bond && sp[0].bond.name === 'bond0' && sp[1].bond && sp[1].bond.id === 'b0' && sp[2].bond === null);
    ok('a VM\'s bridge onto a NIC is not a cable in the port', sp[2].links.length === 0);
    ok('a VM has no ports in the rack', rackPortsOf(node('vm')).length === 0);

    // ---- 3: the document ----
    // v11 when the ports face shipped; later versions (v12, Wi-Fi) add keys
    // of their own and convert nothing of it.
    ok('the document is v11 or later', DOC_VERSION >= 11 && serializeDoc().v === DOC_VERSION);
    const m10 = migrateDoc(Object.assign(site(10), {}));
    ok('a v10 document migrates with nothing converted', m10.doc.v === DOC_VERSION && m10.from === 10 && !m10.newer && json(m10.doc.nodes) === json(site(10).nodes));
    batch(() => { node('srv').portsFace = 'front'; node('core').portsFace = 'front'; save(); });
    const saved = serializeDoc();
    const savedJson = JSON.parse(json(saved));
    ok('written where it differs from the type, not where it is the type\'s',
       savedJson.nodes.find((n) => n.id === 'srv').portsFace === 'front' && !('portsFace' in savedJson.nodes.find((n) => n.id === 'core')));
    loadDocState(JSON.parse(json(saved)));
    ok('read back the same', node('srv').portsFace === 'front' && node('core').portsFace === undefined && json(serializeDoc()) === json(saved));
    replaceDocument(Object.assign(site(), { nodes: site().nodes.map((n) => (n.id === 'vm' ? Object.assign(n, { portsFace: 'front' }) : n)) }), { origin: 'file' });
    ok('a VM\'s is dropped on load', node('vm').portsFace === undefined);

    // The spreadsheet.
    open();
    batch(() => { node('half').portsFace = 'front'; save(); });
    const dev = csvDevicesSheet();
    const col = dev.headers.indexOf('ports_face');
    const cell = (id) => dev.rows.find((r) => r[0] === id)[col];
    ok('devices.csv says each rack device\'s face, its own or its type\'s', col > 0 && cell('srv') === 'rear' && cell('core') === 'front' && cell('half') === 'front', [cell('srv'), cell('core'), cell('half')].join());
    ok('blank for a VM and for a device out of a rack that said nothing', cell('vm') === '' && cell('pc') === '');
    const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
    const back = csvPlan(sheetOf(csvText(dev)), csvAutoMap(sheetOf(csvText(dev))));
    ok('read back, nothing changes', back.counts.change === 0 && !back.errors.length, json(back.counts));
    const flip = csvText({ headers: ['id', 'name', 'ports_face'], rows: [['srv', 'SRV', 'front'], ['core', 'CORE', 'front'], ['half', 'HALF', 'rear']] });
    const fp = csvPlan(sheetOf(flip), csvAutoMap(sheetOf(flip)));
    ok('a sheet that says front for a server is a change; the switch\'s front is not', fp.counts.change === 2, json(fp.counts));
    applyCsvPlan(fp);
    ok('applied: the server\'s ports are on its front, the other back to its type\'s', node('srv').portsFace === 'front' && node('half').portsFace === undefined && node('core').portsFace === undefined);
    undo();
    ok('in one undo step', node('srv').portsFace === undefined && node('half').portsFace === 'front');

    // ---- 4: the strip ----
    open();
    await frame();
    ok('the switch\'s ports are on its front box', !!box('core', 'front').querySelector('.rk-ports') && box('core', 'front').classList.contains('rk-hasports'));
    ok('the server\'s on its back, on the rear, not on its front', !box('srv', 'front').querySelector('.rk-ports') && !!box('srv', 'rear').querySelector('.rk-ports'));
    ok('the half-depth server\'s on its own face', !!box('half', 'rear').querySelector('.rk-ports'));
    ok('one mark per port, in order', json([...box('core', 'front').querySelectorAll('.rk-port')].slice(0, 3).map((p) => p.dataset.port)) === '["p1","p2","p3"]'
       && box('core', 'front').querySelectorAll('.rk-port').length === 49);
    // A 1U box at 1x has no room under its name: a hairline of all 49 along
    // its foot, below the name's letters (the verifier's "Ḅuilding Ẹdge GW").
    const thinBox = box('core', 'front'), thinStrip = thinBox.querySelector('.rk-ports');
    ok('a 1U box not selected, at 1x: one hairline row, not marks over its name',
       thinBox.classList.contains('rk-pthin') && thinStrip.classList.contains('rk-pthin')
       && thinBox.style.getPropertyValue('--rk-pr') === '1' && thinStrip.style.getPropertyValue('--rk-pc') === '49');
    const nameR = thinBox.querySelector('.rk-name').getBoundingClientRect(), stripR = thinStrip.getBoundingClientRect();
    ok('the hairline is below the name\'s line box and inside the box', stripR.top >= nameR.bottom - 0.5 && stripR.height <= 2.5
       && stripR.bottom <= thinBox.getBoundingClientRect().bottom, `${nameR.bottom} / ${stripR.top}-${stripR.bottom}`);
    ok('a 2U box keeps its strip of marks', !box('srv', 'rear').classList.contains('rk-pthin') && !!box('srv', 'rear').querySelector('.rk-ports'));
    select('core', 'node');
    renderRackView(true);
    ok('48 ports and one past, selected: three rows of 17, the rows in the box\'s style',
       box('core', 'front').style.getPropertyValue('--rk-pr') === '3' && box('core', 'front').querySelector('.rk-ports').style.getPropertyValue('--rk-pc') === '17'
       && !box('core', 'front').classList.contains('rk-pthin'));
    select(null);
    setRackZoom(2);
    ok('at 2x a 1U box has room for three rows of marks, not four',
       !box('core', 'front').classList.contains('rk-pthin') && rvPortsFit(1, 3) && !rvPortsFit(1, 4));
    setRackZoom(1);
    batch(() => { node('core').portCount = 24; delete node('core').portAttrs; save(); });
    state.links = state.links.filter((l) => l.id !== 'l4');
    renderRackView(true);
    ok('24 ports are one row', box('core', 'front').style.getPropertyValue('--rk-pr') === '1');
    open();
    await frame();
    ok('a cabled port is filled, a free one is not', port('core', 'p1').classList.contains('rk-pcab') && !port('core', 'p4').classList.contains('rk-pcab'));
    ok('in the cable\'s colour; a colour the browser cannot read is neutral',
       port('core', 'p1').style.getPropertyValue('--pcol') === 'blue' && port('core', 'p2').style.getPropertyValue('--pcol') === '');
    const thinFill = getComputedStyle(port('core', 'p1'), '::before').backgroundColor;
    ok('on the hairline, the cabled one is a dash in its colour', thinFill === 'rgb(0, 0, 255)', thinFill);
    select('core', 'node');
    renderRackView(true);
    const fill = getComputedStyle(port('core', 'p1'), '::before').backgroundColor;
    const hollow = getComputedStyle(port('core', 'p4'), '::before').backgroundColor;
    ok('drawn so: blue filled, the free one hollow', fill === 'rgb(0, 0, 255)' && /rgba\(0, 0, 0, 0\)|transparent/.test(hollow), `${fill} / ${hollow}`);
    ok('the port past the faceplate is ringed', port('core', 'p50').classList.contains('rk-pbad') && !port('core', 'p1').classList.contains('rk-pbad'));
    ok('a port with an access VLAN is tinted', port('core', 'p1').classList.contains('rk-pvlan') && port('core', 'p5').classList.contains('rk-pvlan') && !port('core', 'p6').classList.contains('rk-pvlan'));
    ok('a bond\'s members carry its bar, from the first to the last', port('srv', 'e1').classList.contains('rk-pb-s') && port('srv', 'e2').classList.contains('rk-pb-e')
       && !port('srv', 'e3').classList.contains('rk-pb'));
    // Two cables on one port, and a cable a finding names (a loop between two
    // dumb switches).
    batch(() => {
      state.links.push({ id: 'd1', source: 'half', target: 'core', sourceIface: 'e1', targetIface: 'p6' }, { id: 'd2', source: 'fw', target: 'core', sourceIface: 'i1', targetIface: 'p6' });
      save(); renderCanvasOnly();
    });
    renderRackView(true);
    ok('two cables on one port ring it', port('core', 'p6').classList.contains('rk-pbad'));
    undo();
    batch(() => {
      state.nodes.push(N('sw2', 'switch', { rackU: 10, rackDepth: 'half', portCount: 8 }));
      state.links.push({ id: 'y1', source: 'sw2', target: 'core', sourceIface: 'p1', targetIface: 'p10' }, { id: 'y2', source: 'sw2', target: 'core', sourceIface: 'p2', targetIface: 'p11' });
      save(); renderCanvasOnly();
    });
    renderRackView(true);
    ok('a cable an open finding names rings its ports', port('core', 'p11').classList.contains('rk-pbad') || port('core', 'p10').classList.contains('rk-pbad'),
       json(topologyFindings().filter((f) => f.key === 'loop').map((f) => f.linkIds)));
    undo();

    // ---- 5: the box grows; the zoom ----
    open();
    await frame();
    const unit = () => view().querySelector('.rk-units li').getBoundingClientRect().height;
    const u1 = unit();
    const before = box('core', 'front').getBoundingClientRect().height;
    const markBefore = port('core', 'p1').getBoundingClientRect();
    ok('at 1x a 1U switch is one unit, its ports a hairline', Math.abs(before - (u1 - 2)) < 1.5 && markBefore.height <= 6, `${before} / ${u1} / ${markBefore.height}`);
    clickAt(box('core', 'front').querySelector('.rk-name'));
    await frame();
    const grown = box('core', 'front');
    const gr = grown.getBoundingClientRect(), slots = view().querySelector('.rk-slots[data-face="front"]').getBoundingClientRect();
    const mark = getComputedStyle(port('core', 'p1'), '::before');
    ok('selected, its box grows so the ports can be read', grown.classList.contains('rk-sel') && gr.height > before * 1.5 && parseFloat(mark.height) >= 10, `${gr.height} / ${mark.height}`);
    ok('inside the rack still', gr.top >= slots.top - 0.5 && gr.bottom <= slots.bottom + 0.5);
    ok('over its neighbours', Number(getComputedStyle(grown).zIndex) > Number(getComputedStyle(box('fw', 'front')).zIndex));
    // What it covers is told apart (the verifier's U39 hidden and untappable
    // under a grown 48-port switch): its own units are a band (.rk-own) the
    // height of the 1U box, and the grown box steps in from the outer rail,
    // so the firewall it is drawn over keeps its edge in sight, and a tap
    // there selects it.
    const ownR = grown.querySelector('.rk-own').getBoundingClientRect();
    ok('its own units are marked inside the grown box', grown.classList.contains('rk-grown') && Math.abs(ownR.height - before) < 1.5
       && ownR.top > gr.top && ownR.bottom <= gr.bottom + 0.5, `${ownR.top}-${ownR.bottom} in ${gr.top}-${gr.bottom}`);
    const fwR = box('fw', 'front').getBoundingClientRect();
    ok('the firewall at U42 is under the grown box, its edge clear of it', fwR.bottom > gr.top + 2 && gr.left - fwR.left >= 13, `${fwR.left} / ${gr.left}`);
    const ex = fwR.left + 6, ey = (Math.max(fwR.top, gr.top) + fwR.bottom) / 2;
    const edgeEl = document.elementFromPoint(ex, ey);
    ok('what is under a finger there is the firewall', !!edgeEl && edgeEl.closest('.rk-dev') === box('fw', 'front'), edgeEl ? String(edgeEl.className) : 'nothing');
    if (edgeEl) edgeEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: ex, clientY: ey }));
    await frame();
    ok('a tap there selects it', state.selectedId === 'fw' && !box('core', 'front').classList.contains('rk-sel') && !box('core', 'front').classList.contains('rk-grown'));
    clickAt(box('core', 'front').querySelector('.rk-name'));
    await frame();
    ok('a 1U box not selected does not step in', !box('fw', 'front').classList.contains('rk-grown') && state.selectedId === 'core');
    view().querySelector('#rackZoom [data-zoom="2"]').click();
    await frame();
    ok('2x: the units are twice as tall', Math.abs(unit() - 2 * u1) < 1, `${unit()} vs ${u1}`);
    ok('the switch shows it', view().querySelector('#rackZoom [data-zoom="2"]').getAttribute('aria-pressed') === 'true' && view().style.getPropertyValue('--rk-z') === '2');
    view().querySelector('#rackZoom [data-zoom="3"]').click();
    await frame();
    ok('3x: three times', Math.abs(unit() - 3 * u1) < 1);
    ok('a 2U server\'s ports are full size at 3x without being selected', parseFloat(getComputedStyle(port('srv', 'e1'), '::before').height) >= 11);
    let kept = null;
    try { kept = localStorage.getItem('topo.rackZoom'); } catch (e) { kept = '3'; }
    ok('kept in this browser, not in the document', kept === '3' && !/zoom/i.test(json(serializeDoc())));
    view().querySelector('#rackZoom [data-zoom="1"]').click();
    await frame();
    ok('back to 1x', Math.abs(unit() - u1) < 1);
    select(null);

    // ---- 6: a port's tip ----
    renderRackView(true);
    await frame();
    ptr('pointerover', port('core', 'p1'));
    const said = tipText();
    ok('pointed at, a port says its name, label and VLAN', said.includes('Gi1/0/1') && said.includes('Uplink') && said.includes('VLAN 10'), said);
    ok('and its cable: the far device and port, the tag, colour, length and via', said.includes('→ FW · lan') && said.includes('UPLINK') && said.includes('blue') && said.includes('1 m') && said.includes('PP-A:1'), said);
    ptr('pointerover', box('fw', 'front').querySelector('.rk-name'));
    ok('off the port, the tip goes', tipText() === '');
    ptr('pointerover', port('core', 'p4'));
    ok('a free port says so', tipText().includes('Free: no cable on it.'));
    ptr('pointerover', port('core', 'p50'));
    ok('the port past the faceplate says it', tipText().includes('Past the 48-port faceplate'));
    view().dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
    ok('leaving the view lets it go', tipText() === '');
    // A tap on a box not selected selects it; on the selected one, a port's tip, kept.
    clickAt(port('core', 'p4'));
    await frame();
    ok('a tap on the marks of a box not selected selects the device, no tip yet', state.selectedType === 'node' && state.selectedId === 'core' && tipText() === '');
    clickAt(port('core', 'p4'));
    await frame();
    ok('tapped again, now it is grown, the port\'s tip', tipText().includes('Gi1/0/4'), tipText());
    // A finger taps what it sees: the server selected, its back scrolled
    // into the pane (a port scrolled out of it lets its tip go).
    selectEntries([{ type: 'node', id: 'srv' }]);
    box('srv', 'rear').scrollIntoView({ block: 'center' });
    await frame();
    clickAt(port('srv', 'e1'));
    await frame();
    await frame();
    ok('a tap on a port of the selected device shows its tip', tipText().includes('eno1') && tipText().includes('In bond0') && tipText().includes('→ CORE'), tipText());
    renderRackView(true);
    ok('kept over a rebuild while the device is selected', tipText().includes('eno1') && port('srv', 'e1').classList.contains('rk-ptipped'));
    view().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    ok('Escape lets it go', tipText() === '');
    clickAt(port('srv', 'e3'));
    ok('tapped again, the bridged NIC is free', tipText().includes('idrac') && tipText().includes('Free'));
    clickAt(view().querySelector('.rk-slots[data-face="front"] .rk-free'));
    ok('a tap elsewhere lets it go', tipText() === '');
    await new Promise((r) => setTimeout(r, 400));   // the place gesture's pending dialog, if any
    if (typeof closePlaceDialog === 'function') closePlaceDialog();

    // ---- 7: the Ports button and the device editor ----
    open();
    selectEntries([{ type: 'node', id: 'srv' }]);
    renderRackView(true);
    const btn = view().querySelector('.rk-selbar [data-rk="ports"]');
    ok('the selected bar says where its ports are', !!btn && btn.textContent.trim() === 'Ports: rear');
    const sB = json(serializeDoc());
    btn.click();
    ok('Ports moves them to the other side of the device', node('srv').portsFace === 'front' && !!box('srv', 'front').querySelector('.rk-ports') && !box('srv', 'rear').querySelector('.rk-ports'));
    ok('and says so', view().querySelector('.rk-selbar [data-rk="ports"]').textContent.trim() === 'Ports: front');
    // Whole messages, each worded for "ports": es "Puertos: traseros", not
    // the face's own word ("trasera", which agrees with "cara").
    const wordsIn = (loc) => { setLocale(loc); const w = [t('Ports: front'), t('Ports: rear')]; setLocale('en'); return w; };
    ok('the button\'s words are whole messages in every language', ['es', 'pt-BR', 'ja', 'ru'].every((l) => wordsIn(l).every((w) => !/^Ports/.test(w)))
       && wordsIn('es').join(' / ') === 'Puertos: frontales / Puertos: traseros');
    view().querySelector('.rk-selbar [data-rk="ports"]').click();
    ok('again, back to its type\'s, and nothing stored', node('srv').portsFace === undefined && json(serializeDoc()) === sB);
    undo();
    ok('each one undo step', node('srv').portsFace === 'front');
    undo();
    ok('(and the first)', json(serializeDoc()) === sB);
    const fld = el('propPortsFace');
    renderGroupPicker(node('srv'));
    ok('the device editor\'s rack section shows its ports face', !!fld && fld.value === 'rear' && !el('rackPlaceRow').classList.contains('hidden'));
    fld.value = 'front';
    fld.dispatchEvent(new Event('change', { bubbles: true }));
    ok('changed there, it is written', node('srv').portsFace === 'front');
    undo();
    ok('one undo step', node('srv').portsFace === undefined && json(serializeDoc()) === sB);
    state.readOnly = true;
    ok('read-only refuses it', setPortsFace(node('srv'), 'front') === false && node('srv').portsFace === undefined);
    state.readOnly = false;
    select(null);
    // A half-depth device: the button and the field greyed, saying why, and
    // a click on the button writes nothing.
    open();
    selectEntries([{ type: 'node', id: 'half' }]);
    renderRackView(true);
    const hb = view().querySelector('.rk-selbar [data-rk="ports"]');
    ok('a half-depth device\'s Ports button is greyed and says why', !!hb && hb.disabled && /half-depth/.test(hb.title) && hb.textContent.trim() === 'Ports: this face', hb ? hb.outerHTML : 'none');
    const hs = json(serializeDoc()), hd = _undoStack.length;
    hb.click();
    ok('and changes nothing', json(serializeDoc()) === hs && _undoStack.length === hd);
    renderGroupPicker(node('half'));
    ok('the device editor\'s Ports face is greyed there too', fld.disabled && /half-depth/.test(fld.title));
    renderGroupPicker(node('srv'));
    ok('and live on a full-depth one', !fld.disabled && fld.title === '');
    select(null);

    // ---- 8: two cables on one port, as the cabling check reads it ----
    open();
    batch(() => {
      // A second host on the firewall's lan (a gateway with a switch not
      // drawn), and two cables on the server's idrac NIC (a real fault).
      state.links.push({ id: 'g1', source: 'half', target: 'fw', sourceIface: 'e1', targetIface: 'i2' },
        { id: 'g2', source: 'pc', target: 'srv', sourceIface: 'i1', targetIface: 'e3' },
        { id: 'g3', source: 'core', target: 'srv', sourceIface: 'p7', targetIface: 'e3' });
      save(); renderCanvasOnly();
    });
    renderRackView(true);
    const fwLan = rackPortsOf(node('fw')).find((p) => p.id === 'i2');
    ok('a router\'s gateway interface with two cables is not doubled', fwLan.links.length === 2 && !fwLan.doubled && evaluatePorts(node('fw')).level !== 'bad',
       json(evaluatePorts(node('fw'))));
    ok('so its mark is not ringed', !port('fw', 'i2').classList.contains('rk-pbad'));
    ok('a server\'s NIC with two cables is, and ringed', rackPortsOf(node('srv')).find((p) => p.id === 'e3').doubled && port('srv', 'e3').classList.contains('rk-pbad')
       && evaluatePorts(node('srv')).level === 'bad');
    const marks = (id) => { const ps = rackPortsOf(node(id)); const r = reportRackPorts(node(id), 1, null); return (i) => r.marks[ps.findIndex((p) => p.id === i)]; };
    ok('the printed elevation agrees', !marks('fw')('i2').bad && marks('srv')('e3').bad);
    undo();
    // Every sample: a port ringed doubled only on a device the cabling check
    // faults (the reviewer's repro: Showcase Rack A, Data Centre A01, Imaging
    // Rack 1 rang their routers' shared interfaces).
    const odd = [];
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(templatesData[k], { origin: 'template' });
      state.nodes.forEach((n) => {
        const d = rackPortsOf(n).filter((p) => p.doubled);
        if (d.length && evaluatePorts(n).level !== 'bad') odd.push(`${k}:${n.name}:${d.map((p) => p.name).join('+')}`);
      });
    });
    ok('in every sample, doubled only where Findings says so', odd.length === 0, odd.join(', '));
    replaceDocument(templatesData.showcase, { origin: 'template' });
    initHistory(); setView('rack'); openRackView('g_rka'); select(null); renderRackView(true);
    ok('Showcase Rack A, which the findings call clean, rings no port', view().querySelectorAll('.rk-port.rk-pbad').length === 0
       && view().querySelectorAll('.rk-port').length > 0, String(view().querySelectorAll('.rk-port.rk-pbad').length));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    try { if (heldZoom === null) localStorage.removeItem('topo.rackZoom'); else localStorage.setItem('topo.rackZoom', heldZoom); } catch (e) { /* blocked */ }
    state.settings.view = savedView;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
