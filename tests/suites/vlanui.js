// VLANs, trunks and PoE, stage 1b (docs/BACKLOG.md feature 4, landing order
// step 15): what a person sees and edits. No checks: stage 2a waits for the
// managed-switch decision (step 6), so nothing here raises a finding. Held:
//   1. the words: portAttrsSummary ("Port labels, VLANs and PoE (3 · 1 trunk
//      · 2 PoE)"), portVlanFacts (VLAN n on an access port, Untagged / Tagged
//      on a trunk), poeText ("PoE+ 30 W", "PoE 25 W"), wattsText's decimal
//      comma in es / pt-BR / ru, poeLoad / poeLoadText (only PoE ports, a
//      retired device and a port without PoE not counted);
//   2. the faceplate: a dot on a port with only PoE or a tagged list, the
//      chip's title naming Tagged and PoE, the PoE budget under the count
//      with its live line, a bad budget marked and not written;
//   3. the port list: the VLAN field's 'Untagged' placeholder, the ⋯ line
//      folded on a plain port and open by itself on one with facts, a tagged
//      list written canonical, a bad one marked and held, PoE picked (one
//      undo step) and Watts… typed;
//   4. Set on ports: a run written as one undo step, a port the box does not
//      have refusing the whole run with nothing written, a bad value refused,
//      a blank value clearing, names of the scheme read;
//   5. the device's PoE draw field (on a camera, not on a VM; "class 4" read
//      as 25.5) and a wired interface's VLAN line (Auto · 10 Staff greyed,
//      typed over, tagged canonical; none on a radio);
//   6. the link panel's end VLANs, only once an end records any;
//   7. the table: Ports tab Tagged and PoE edited in place (bad refused),
//      Interfaces tab VLAN greyed from the subnet and Tagged, a dash on a
//      radio, the Devices tab's PoE columns offered once PoE is recorded;
//      Change all setting a draw and skipping a VM with the reason;
//   8. the rack tip and tint, Locate's hop on a trunk port;
//   9. the report: the port map's Untagged / Tagged / PoE columns only where
//      a switch has them, the heading's PoE budget, the VLANs section only
//      with a tagged list (after Addressing, before Capacity), the
//      Capacity section's PoE table, a powered device's "PoE 6,5 W"; and a
//      file with none of it printing no new heading or column;
//  10. no finding from any of it, and the words in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const fire = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const enter = (input) => input.dispatchEvent(new Event('focus'));
  const leave = (input) => { input.dispatchEvent(new Event('blur')); commitTyping(); };
  const steps = () => _undoStack.length;
  const quiet = setDialogResponder(() => null);
  const savedView = state.settings.view;
  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n10', cidr: '10.0.10.0/24', name: 'Staff', vlan: 10, gateway: '10.0.10.1' }, { id: 'n20', cidr: '10.0.20.0/24', name: 'Cams', vlan: 20 }],
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 300, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.1/24', tagged: '20' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 300, y: 150, portCount: 8, poeBudget: 120, portScheme: { prefix: 'Gi1/0/', start: 1 },
        portAttrs: { p1: { vlan: 10, tagged: '20' }, p3: { vlan: 10 }, p5: { vlan: 20, poe: 'at' }, p6: { poe: 'af' } }, interfaces: [] },
      { id: 'pc', type: 'pc', name: 'PC-1', x: 200, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.5/24' }, { id: 'w1', name: 'wlan0', ip: '' }] },
      { id: 'cam', type: 'camera', name: 'CAM-1', x: 300, y: 300, poeDraw: 6.5, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.5/24' }] },
      { id: 'cam2', type: 'camera', name: 'CAM-2', x: 400, y: 300, poeDraw: 12, status: 'retired', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.20.6/24' }] },
      { id: 'ph', type: 'phone', name: 'PH-1', x: 500, y: 300, poeDraw: 5, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.7/24' }] },
      { id: 'vm', type: 'vm', name: 'VM-1', x: 600, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.10.9/24' }] }
    ],
    links: [
      { id: 'up', source: 'sw', target: 'rt', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'l3', source: 'sw', target: 'pc', sourceIface: 'p3', targetIface: 'i1' },
      { id: 'l5', source: 'sw', target: 'cam', sourceIface: 'p5', targetIface: 'i1' },
      { id: 'l6', source: 'sw', target: 'cam2', sourceIface: 'p6', targetIface: 'i1' },
      { id: 'l7', source: 'sw', target: 'ph', sourceIface: 'p7', targetIface: 'i1' }
    ] });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); initHistory(); select(null, null); };
  setLocale('en');

  try {
    // ---- 1. The words ----
    open();
    const sw = () => getNode('sw');
    ok('the summary counts noted ports, trunks and PoE ports', portAttrsSummary(sw()) === 'Port labels, VLANs and PoE (4 · 1 trunk · 2 PoE)', portAttrsSummary(sw()));
    ok('an access port says VLAN n, a trunk Untagged and Tagged', show(portVlanFacts(10, null)) === '["VLAN 10"]' && show(portVlanFacts(1, '10,20')) === '["Untagged 1","Tagged 10,20"]'
       && show(portVlanFacts(null, 'all')) === '["Tagged all"]' && show(portVlanFacts(null, null)) === '[]');
    ok('PoE in one line', poeText('at') === 'PoE+ 30 W' && poeText('af') === 'PoE 15.4 W' && poeText('bt4') === 'PoE++ Type 4 90 W' && poeText(25) === 'PoE 25 W' && poeText(null) === '' && poeText('junk') === '');
    setLocale('es');
    ok('watts take the decimal comma in Spanish, Portuguese and Russian', wattsText(12.5) === '12,5' && poeText('af') === 'PoE 15,4 W');
    setLocale('ja');
    ok('and the point in Japanese', wattsText(12.5) === '12.5');
    setLocale('en');
    const load = poeLoad(sw());
    ok('poeLoad: the draw on PoE ports only, a retired device not counted', load.budget === 120 && load.used === 6.5 && show(load.devices) === '["cam"]' && load.ports === 2, show(load));
    ok('the live line', poeLoadText(load) === 'PoE: 6.5 of 120 W' && poeLoadText(null) === '');
    ok('a box with no PoE has no load', poeLoad(getNode('pc')) === null && poeLoad({ id: 'x', type: 'switch', portCount: 4, interfaces: [] }) === null);
    ok('PoE ports and no budget: what is drawn', poeLoadText({ budget: null, used: 4, devices: [], ports: 1 }) === 'PoE: 4 W drawn');

    // ---- 2. The faceplate ----
    select('sw', 'node');
    const chip = (n) => document.querySelector(`#ifaceListContainer .faceplate .chip-row .port-chip[data-port="p${n}"]`);
    ok('a port with only PoE is marked', chip(6).classList.contains('noted') && !chip(2).classList.contains('noted'));
    ok('the chip names Tagged and PoE', /Gi1\/0\/1 · Untagged 10 · Tagged 20/.test(chip(1).title) && /Gi1\/0\/5 · VLAN 20 · PoE\+ 30 W/.test(chip(5).title), chip(1).title + ' | ' + chip(5).title);
    const budget = el('poeBudgetInput');
    ok('the PoE budget sits under the port count with its live line', !!budget && budget.value === '120' && el('poeLoadLine').textContent === 'PoE: 6.5 of 120 W'
       && budget.compareDocumentPosition(el('portCountInput')) & Node.DOCUMENT_POSITION_PRECEDING);
    let before = steps();
    enter(budget);
    fire(budget, '150,5');
    ok('a budget is read with a decimal comma and the line follows', sw().poeBudget === 150.5 && el('poeLoadLine').textContent === 'PoE: 6.5 of 150.5 W');
    fire(budget, '0');
    ok('a budget it cannot read is marked and not written', budget.classList.contains('bad') && sw().poeBudget === 120, String(sw().poeBudget));
    fire(budget, '200');
    leave(budget);
    ok('one undo step', steps() === before + 1 && sw().poeBudget === 200, `${steps() - before} ${sw().poeBudget}`);
    undo();
    ok('undo puts it back', sw().poeBudget === 120);
    select('pc', 'node');
    ok('no budget on a PC', !el('poeBudgetInput'));

    // ---- 3. The port list ----
    open();
    select('sw', 'node');
    el('portAttrBox').open = true;
    const line = (n) => document.querySelector(`#portAttrList .port-attr[data-port="p${n}"]`);
    ok('the VLAN field says Untagged', line(2).querySelector('.port-attr-vlan').placeholder === 'Untagged');
    ok('the ⋯ line is folded on a plain port and open by itself on one with facts', line(2).querySelector('.port-attr-more').hidden && !line(1).querySelector('.port-attr-more').hidden
       && !line(6).querySelector('.port-attr-more').hidden && line(1).querySelector('.port-attr-more-btn').getAttribute('aria-expanded') === 'true');
    line(2).querySelector('.port-attr-more-btn').click();
    ok('⋯ opens it', !line(2).querySelector('.port-attr-more').hidden);
    const tagged = line(2).querySelector('.port-attr-tagged');
    enter(tagged);
    fire(tagged, '30-39, 10 ,20,20');
    ok('a tagged list is written canonical', portAttrOf(sw(), 'p2').tagged === '10,20,30-39', portAttrOf(sw(), 'p2').tagged);
    fire(tagged, '30-39, 10 ,20,4095');
    ok('a bad one is marked and keeps what it held', tagged.classList.contains('bad') && portAttrOf(sw(), 'p2').tagged === null, String(portAttrOf(sw(), 'p2').tagged));
    leave(tagged);
    ok('leaving it shows what is kept', tagged.value === '' && !tagged.classList.contains('bad'));
    before = steps();
    enter(tagged);
    fire(tagged, '10 - 12');
    leave(tagged);
    ok('leaving a good one shows it canonical, one undo step', tagged.value === '10-12' && steps() === before + 1, `${tagged.value} ${steps() - before}`);
    ok('the summary follows', /\(5 · 2 trunks · 2 PoE\)/.test(el('portAttrBox').querySelector('summary').textContent), el('portAttrBox').querySelector('summary').textContent);
    const poe = line(2).querySelector('.port-attr-poe');
    before = steps();
    poe.value = 'bt3'; poe.dispatchEvent(new Event('change'));
    ok('a PoE pick is written, one undo step', portAttrOf(sw(), 'p2').poe === 'bt3' && steps() === before + 1);
    const watts = line(2).querySelector('.port-attr-watts');
    ok('the watts field is hidden for a standard', watts.hidden);
    poe.value = 'w'; poe.dispatchEvent(new Event('change'));
    ok('Watts… shows the field and writes nothing yet', !watts.hidden && portAttrOf(sw(), 'p2').poe === 'bt3');
    enter(watts);
    fire(watts, '25,5');
    leave(watts);
    ok('watts typed are written', portAttrOf(sw(), 'p2').poe === 25.5, String(portAttrOf(sw(), 'p2').poe));
    poe.value = ''; poe.dispatchEvent(new Event('change'));
    ok('— clears it', portAttrOf(sw(), 'p2').poe === null);
    ok('the PoE options', [...poe.options].map((o) => o.textContent).join('|') === '—|802.3af|802.3at (PoE+)|802.3bt Type 3|802.3bt Type 4|Watts…');

    // ---- 4. Set on ports ----
    open();
    select('sw', 'node');
    el('portAttrBox').open = true;
    const setRow = document.querySelector('#portAttrBox .port-set');
    ok('Set on ports sits at the top of the open list', !!setRow && setRow.nextElementSibling === el('portAttrList'));
    const [run, what, value] = [setRow.querySelector('.port-set-run'), setRow.querySelector('.port-set-key'), setRow.querySelector('.port-set-value')];
    before = steps();
    run.value = '2-4'; what.value = 'tagged'; value.value = '30,31,32';
    setRow.querySelector('.port-set-go').click();
    ok('a run is written as one undo step', ['p2', 'p3', 'p4'].every((p) => portAttrOf(getNode('sw'), p).tagged === '30-32') && steps() === before + 1, `${steps() - before}`);
    ok('and says how many', /Set on 3 ports\./.test(document.querySelector('#portAttrBox .port-set-note').textContent));
    undo();
    ok('one undo takes all of it back', ['p2', 'p3', 'p4'].every((p) => portAttrOf(getNode('sw'), p).tagged === null));
    const n0 = steps();
    const snap = show(getNode('sw').portAttrs);
    let r = applyPortSet(getNode('sw'), '6-12', 'vlan', '30');
    ok('a port the box does not have refuses the whole run', !!r.error && /SW-1 has no port 9/.test(r.error) && show(getNode('sw').portAttrs) === snap, r.error);
    select('sw', 'node'); el('portAttrBox').open = true;
    const setRow2 = document.querySelector('#portAttrBox .port-set');
    setRow2.querySelector('.port-set-run').value = '7-9'; setRow2.querySelector('.port-set-key').value = 'vlan'; setRow2.querySelector('.port-set-value').value = '30';
    setRow2.querySelector('.port-set-go').click();
    ok('and through the row nothing is written, the reason shown', show(getNode('sw').portAttrs) === snap && steps() === n0
       && setRow2.querySelector('.port-set-note').classList.contains('bad'), setRow2.querySelector('.port-set-note').textContent);
    r = applyPortSet(getNode('sw'), '1,3', 'vlan', '5000');
    ok('a bad value is refused', !!r.error && /5000 is not a valid Untagged/.test(r.error) && show(getNode('sw').portAttrs) === snap, r.error);
    r = applyPortSet(getNode('sw'), 'Gi1/0/5, 6', 'poe', 'poe+');
    ok('the scheme\'s names are read, PoE words too', r.n === 1 && portAttrOf(getNode('sw'), 'p5').poe === 'at' && portAttrOf(getNode('sw'), 'p6').poe === 'at', show(r));
    r = applyPortSet(getNode('sw'), '5-6', 'poe', '');
    ok('a blank value clears', r.n === 2 && portAttrOf(getNode('sw'), 'p5').poe === null && portAttrOf(getNode('sw'), 'p6').poe === null);
    ok('a garbled run says how to type it', /1-24, or 1,3,5/.test(applyPortSet(getNode('sw'), '9-2', 'vlan', '1').error));

    // ---- 5. The device's draw, an interface's VLANs ----
    open();
    select('cam', 'node');
    const draw = el('propPoeDraw');
    ok('a camera shows its PoE draw', !el('poeDrawRow').classList.contains('hidden') && draw.value === '6.5');
    before = steps();
    enter(draw);
    fire(draw, 'class 4');
    leave(draw);
    ok('"class 4" is read as 25.5 W, one undo step', getNode('cam').poeDraw === 25.5 && draw.value === '25.5' && steps() === before + 1, `${getNode('cam').poeDraw} ${draw.value}`);
    enter(draw);
    fire(draw, '');
    leave(draw);
    ok('blank clears it, no key left', !('poeDraw' in getNode('cam')));
    select('vm', 'node');
    ok('a VM has no draw field', el('poeDrawRow').classList.contains('hidden'));
    select('pc', 'node');
    ok('no VLAN line until + MAC / VLAN or a recorded VLAN', !document.querySelector('#ifaceListContainer .if-vlan'));
    el('addMacBtn').click();
    const vrows = document.querySelectorAll('#ifaceListContainer .if-vlan');
    ok('+ MAC / VLAN opens it on the wired interface only', vrows.length === 1 && el('addMacBtn').textContent === '+ MAC / VLAN');
    const vin = vrows[0].querySelector('.if-vlan-in'), tin = vrows[0].querySelector('.if-tagged-in');
    ok('its untagged VLAN shows the subnet\'s, greyed', vin.value === '' && vin.placeholder === 'Auto · 10 Staff', vin.placeholder);
    enter(vin);
    fire(vin, '30');
    enter(tin);
    fire(tin, '40,41,42');
    leave(tin);
    ok('typed over, and tagged canonical', getNode('pc').interfaces[0].vlan === 30 && getNode('pc').interfaces[0].tagged === '40-42' && tin.value === '40-42');
    enter(vin);
    fire(vin, '');
    leave(vin);
    ok('blank goes back to the subnet\'s', !('vlan' in getNode('pc').interfaces[0]) && portVlans(getNode('pc'), 'i1').untagged === 10);
    getNode('pc').macOpen = false;
    select('pc', 'node');
    ok('a recorded tagged list keeps the line shown', document.querySelectorAll('#ifaceListContainer .if-vlan').length === 1);

    // ---- 6. The link panel ----
    open();
    select('l3', 'link');
    const ends = () => [...document.querySelectorAll('#linkPortBody .port-end-vlan')].map((x) => x.textContent);
    ok('both ends\' VLANs, read-only', show(ends()) === '["VLAN 10","VLAN 10"]', show(ends()));
    select('up', 'link');
    ok('a trunk end and a router\'s', show(ends()) === '["Untagged 10 · Tagged 20","Untagged 10 · Tagged 20"]', show(ends()));
    select('l7', 'link');
    ok('an end that records nothing says it carries every VLAN', show(ends()) === '["No VLAN recorded: it carries every VLAN.","VLAN 10"]', show(ends()));
    getNode('ph').interfaces[0].ip = '';
    select('l7', 'link');
    ok('nothing on a cable whose ends say nothing', ends().length === 0, show(ends()));

    // ---- 7. The table, Change all ----
    open();
    setView('table');
    showTableTab('ports');
    const cell = (rk, col) => { const row = [...el('tvGrid').querySelectorAll('tbody tr[data-row]')].find((x) => x.dataset.row === rk); return row && row.querySelector(`td[data-col="${col}"]`); };
    const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const edit = (rk, col, v) => { const td = cell(rk, col); if (!td) return false; td.focus(); key(td, 'Enter'); const ed = _tv.editor; if (!ed) return false; ed.el.value = v; key(ed.el, 'Enter'); return true; };
    ok('Ports tab: Tagged and PoE', cell('p:sw:p1', 'port:tagged').textContent === '20' && cell('p:sw:p5', 'port:poe').textContent === 'PoE+ 30 W' && cell('p:sw:p2', 'port:poe').textContent === '');
    before = steps();
    ok('Tagged edited in place, canonical', edit('p:sw:p2', 'port:tagged', '12,11,10') && portAttrOf(getNode('sw'), 'p2').tagged === '10-12' && steps() === before + 1);
    ok('a bad list refused', edit('p:sw:p2', 'port:tagged', '10,0') === true && portAttrOf(getNode('sw'), 'p2').tagged === '10-12');
    if (_tv.editor) key(_tv.editor.el, 'Escape');
    ok('PoE by its words, and as the cell shows it', edit('p:sw:p2', 'port:poe', '802.3bt type 4') && portAttrOf(getNode('sw'), 'p2').poe === 'bt4'
       && edit('p:sw:p3', 'port:poe', 'PoE+ 30 W') && portAttrOf(getNode('sw'), 'p3').poe === 'at' && edit('p:sw:p4', 'port:poe', '7,5') && portAttrOf(getNode('sw'), 'p4').poe === 7.5);
    showTableTab('interfaces');
    const irow = (nid, iid) => [...el('tvGrid').querySelectorAll('tbody tr[data-row]')].find((x) => x.dataset.row.includes(nid) && x.dataset.row.includes(iid));
    const icell = (nid, iid, col) => { const x = irow(nid, iid); return x && x.querySelector(`td[data-col="${col}"]`); };
    const pcv = icell('pc', 'i1', 'vlan');
    ok('Interfaces tab: a VLAN worked out from the subnet is greyed', !!pcv && pcv.textContent === '10' && pcv.classList.contains('tv-muted'), pcv && pcv.outerHTML);
    ok('a router\'s tagged list', icell('rt', 'i1', 'tagged').textContent === '20');
    ok('a dash on a radio', icell('pc', 'w1', 'vlan').textContent === '—' && icell('pc', 'w1', 'tagged').textContent === '—');
    showTableTab('devices');
    const heads = () => [...el('tvGrid').querySelectorAll('thead th[data-col]')].map((th) => th.dataset.col);
    ok('Devices tab: PoE budget and draw, once PoE is recorded', heads().includes('poeBudget') && heads().includes('poeDraw'));
    const dcell = (id, col) => cell(`n:${id}`, col);
    ok('a dash where it cannot be held', dcell('pc', 'poeBudget').textContent === '—' && dcell('vm', 'poeDraw').textContent === '—' && dcell('cam', 'poeDraw').textContent === '6.5');
    ok('a draw edited in place', edit('n:ph', 'poeDraw', 'class 2') && getNode('ph').poeDraw === 6.49);
    setView('map');
    replaceDocument({ v: DOC_VERSION, nodes: [{ id: 'a', type: 'pc', name: 'A', x: 0, y: 0, interfaces: [] }, { id: 's', type: 'switch', name: 'S', x: 0, y: 0, portCount: 4, interfaces: [] }], links: [] }, { origin: 'file' });
    ok('a network with no PoE has no PoE columns', !tvCols('devices').some((c) => /^poe/.test(c.key)));
    open();
    const plan = bulkPlanSet(['cam', 'vm', 'ph'], { poeDraw: { text: '7,5' } });
    const row = (id) => plan.rows.find((x) => x.nodeId === id);
    ok('Change all sets a draw and skips a VM, saying why', row('cam').status === 'change' && row('ph').status === 'change' && row('vm').status === 'skip'
       && row('vm').why === 'A cloud, a VM or a container draws no PoE.', show(plan.rows));
    const bplan = bulkPlanSet(['sw', 'pc'], { poeBudget: { text: '370' } });
    ok('and a budget, only on the switch', bplan.rows.find((x) => x.nodeId === 'sw').status === 'change' && bplan.rows.find((x) => x.nodeId === 'pc').why === 'Only a switch or an access point has a PoE budget.');
    const cleared = bulkPlanSet(['cam', 'ph'], { poeDraw: { clear: true } });
    const doc = JSON.parse(JSON.stringify(serializeDoc()));
    bulkWrite(cleared, doc);
    ok('a cleared draw leaves no key', !('poeDraw' in doc.nodes.find((n) => n.id === 'cam')) && !('poeDraw' in doc.nodes.find((n) => n.id === 'ph')));

    // ---- 8. The rack tip and tint, Locate ----
    const rp = rackPortsOf(getNode('sw'));
    ok('the rack reads tagged and PoE', rp[0].tagged === '20' && rp[4].poe === 'at' && rp[1].tagged === null);
    const tip = rvPortInfo(getNode('sw'), 'p1');
    ok('the rack tip says Untagged and Tagged', tip.lines.includes('Untagged 10 · Tagged 20'), show(tip.lines));
    ok('and PoE', rvPortInfo(getNode('sw'), 'p5').lines.includes('PoE+ 30 W'), show(rvPortInfo(getNode('sw'), 'p5').lines));
    getNode('sw').portAttrs.p2 = { tagged: '30' };
    ok('a tagged-only port is tinted', /rk-pvlan[^>]*data-port="p2"/.test(rvPortsHtml(getNode('sw')).html));
    getNode('sw').portAttrs.p3 = { vlan: 1, tagged: '10,20' };
    const path = locatePath(getNode('pc'));
    const hop = path.legs[0].hops[0];
    ok('Locate: a trunk port says which is untagged and which tagged', hop.tagged === '10,20' && locateHopFacts(hop).jack === 'Untagged 1 · Tagged 10,20', locateHopFacts(hop).jack);
    getNode('sw').portAttrs.p3 = { vlan: 10, label: 'Desk 3' };
    ok('an access port still says VLAN n', locateHopFacts(locatePath(getNode('pc')).legs[0].hops[0]).jack === 'Jack Desk 3 · VLAN 10');

    // ---- 9. The report ----
    open();
    let model = reportModel();
    const html = reportHtml(model, null, { technical: true });
    const map = model.portMaps.find((m) => m.id === 'sw');
    ok('the port map has Tagged and PoE where the switch has them', map.hasTagged && map.hasPoe && /<th>Untagged<\/th><th>Tagged<\/th><th>PoE<\/th>/.test(portMapsSection([map])));
    ok('its heading carries the PoE budget', /PoE: 6\.5 of 120 W budget/.test(portMapsSection([map])));
    getNode('sw').portAttrs.p8 = { poe: 'af' };
    const freeRow = reportModel().portMaps.find((m) => m.id === 'sw').rows.find((x) => x.port === 8);
    ok('a free port with only PoE is a row', !!freeRow && freeRow.free === true && freeRow.poe === 'af', show(freeRow));
    delete getNode('sw').portAttrs.p8;
    ok('the VLANs section, after Addressing and before Capacity', /<h2>VLANs<\/h2>/.test(html) && html.indexOf('<h2>VLANs</h2>') > html.indexOf('>Addressing<') && html.indexOf('<h2>VLANs</h2>') < html.indexOf('>Capacity<'));
    const v20 = model.vlans.find((x) => x.vlan === 20), v10 = model.vlans.find((x) => x.vlan === 10);
    ok('a row per VLAN with its subnet, gateway, access ports and trunks', model.vlans.map((x) => x.vlan).join() === '10,20'
       && v10.subnets[0].cidr === '10.0.10.0/24' && v10.subnets[0].gateway === '10.0.10.1' && v10.access === 1 && v10.trunks.length === 0
       && v20.access === 1 && show(v20.trunks) === '[{"device":"Core","ports":["eth0"]},{"device":"SW-1","ports":["Gi1/0/1"]}]', show(model.vlans));
    ok('the Capacity section has the PoE budget', model.capacity.poe.length === 1 && model.capacity.poe[0].left === 113.5 && /<table class="capacity poe">/.test(html), show(model.capacity.poe));
    ok('a powered device\'s inventory line', /PoE 6\.5 W/.test(devicesSection(model.devices, model.groups)));
    setLocale('es');
    ok('in Spanish with its decimal comma', /PoE 6,5 W/.test(devicesSection(reportModel().devices, [])) && /Puertos de acceso/.test(vlansSection(reportModel().vlans)));
    setLocale('en');
    // Access ports only, no PoE: no new column, heading or section.
    const plain = lab();
    plain.nodes[1] = Object.assign({}, plain.nodes[1], { poeBudget: undefined, portAttrs: { p3: { vlan: 10 } } });
    plain.nodes[0].interfaces[0].tagged = undefined;
    plain.nodes.forEach((n) => { delete n.poeDraw; delete n.poeBudget; });
    open(plain);
    model = reportModel();
    const plainHtml = reportHtml(model, null, { technical: true });
    ok('an access-only file prints no VLANs section, no Tagged or PoE column, no PoE line', model.vlans === null && !/<h2>VLANs<\/h2>/.test(plainHtml)
       && !/<th>Tagged<\/th>|<th>PoE<\/th>|class="capacity poe"|PoE:/.test(plainHtml) && /<th>VLAN<\/th>/.test(plainHtml));

    // ---- 10. No findings, the words ----
    open();
    // Stage 2b: the PoE facts raise the PoE checks (tests/suites/poechecks.js)
    // and nothing else; no VLAN check yet (stage 2a).
    const nonPoe = () => topologyFindings().map((f) => f.key).filter((k) => !/^poe-/.test(k)).sort().join();
    const withFacts = nonPoe();
    const bare = lab();
    bare.nodes.forEach((n) => { delete n.poeDraw; delete n.poeBudget; delete n.portAttrs; (n.interfaces || []).forEach((i) => { delete i.tagged; }); });
    open(bare);
    ok('no finding but the PoE checks comes from any of it', nonPoe() === withFacts && !topologyFindings().some((f) => /^poe-/.test(f.key)), withFacts);
    const { MESSAGES } = window.CarinoI18N;
    const words = ['All VLANs', 'Untagged', 'Tagged', 'Untagged VLAN', 'Tagged VLANs and PoE', 'Watts…', 'Set on ports', 'Set on {n} ports.',
      'PoE: {used} of {budget} W', 'PoE: {used} of {budget} W budget', 'No VLAN recorded: it carries every VLAN.', 'Access ports', 'Carried tagged on',
      'Type the ports as 1-24, or 1,3,5.', 'Budget (W)', 'Drawn (W)', 'Left (W)'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = words.filter((w) => !MESSAGES[loc][w] || MESSAGES[loc][w] === w);
      ok(`${loc} carries the new words`, !miss.length, miss.join(' | '));
    });
    ok('PoE and VLAN stay English', /PoE/.test(MESSAGES.ja['PoE: {used} of {budget} W']) && /VLAN/.test(MESSAGES.ru['Untagged VLAN']) && /VLAN/.test(MESSAGES.es['No VLAN recorded: it carries every VLAN.']));
    // 'Trunk' stays English in the Full editor, as VLAN and PoE do (BACKLOG
    // feature 4, Translations); Russian counts it without a plural ending.
    ok('Trunk stays English in every locale', ['es', 'pt-BR', 'ja', 'ru'].every((loc) => /trunk/.test(MESSAGES[loc]['{n} trunk']) && /trunk/.test(MESSAGES[loc]['{n} trunks'])),
       ['es', 'pt-BR', 'ja', 'ru'].map((loc) => MESSAGES[loc]['{n} trunks']).join(' | '));
    ok('Russian counts trunks without a wrong plural', MESSAGES.ru['{n} trunks'] === 'trunk: {n}');
    setLocale('es');
    open();
    select('sw', 'node');
    ok('the Spanish summary keeps trunk', /\(4 · 1 trunk · 2 PoE\)/.test(portAttrsSummary(getNode('sw'))), portAttrsSummary(getNode('sw')));
    setLocale('en');

    // ---- 11. Review fixes ----
    // Set on ports reads a range's ends and a bare number on the box's own
    // numbers: a ge-0/0/ box counted from 0, a stack member counted from 25.
    const junos = () => ({ v: DOC_VERSION, nodes: [
      { id: 'jx', type: 'switch', name: 'EX', x: 0, y: 0, portCount: 8, portScheme: { prefix: 'ge-0/0/', start: 0 }, interfaces: [] },
      { id: 'st', type: 'switch', name: 'Stack-2', x: 0, y: 100, portCount: 4, portScheme: { prefix: 'Gi2/0/', start: 25 }, interfaces: [] }], links: [] });
    open(junos());
    const vl = (nid) => faceplatePortIds(getNode(nid)).filter((p) => portAttrOf(getNode(nid), p).vlan === 30).join();
    r = applyPortSet(getNode('jx'), '0-3', 'vlan', '30');
    ok('a range from 0 on a box counted from 0', !r.error && vl('jx') === 'p1,p2,p3,p4', r.error || vl('jx'));
    open(junos());
    applyPortSet(getNode('jx'), '0,1,2,3', 'vlan', '30');
    ok('the same ports typed one by one', vl('jx') === 'p1,p2,p3,p4', vl('jx'));
    open(junos());
    applyPortSet(getNode('jx'), '4-4', 'vlan', '30');
    const asRange = vl('jx');
    open(junos());
    applyPortSet(getNode('jx'), '4', 'vlan', '30');
    ok('"4" and "4-4" are the same port, ge-0/0/4', asRange === 'p5' && vl('jx') === 'p5', `${asRange} ${vl('jx')}`);
    r = applyPortSet(getNode('jx'), '6-8', 'vlan', '30');
    ok('past the faceplate names the box\'s number', !!r.error && /EX has no port 8\./.test(r.error), r.error);
    r = applyPortSet(getNode('st'), '25-26', 'vlan', '30');
    ok('a stack member counted from 25', !r.error && vl('st') === 'p1,p2', r.error || vl('st'));
    select('jx', 'node');
    el('portAttrBox').open = true;
    ok('the run\'s placeholder counts as the box does', document.querySelector('#portAttrBox .port-set-run').placeholder === '0-7');

    // The table's PoE and VLAN columns sort by their numbers, a dash last,
    // with the decimal comma in Spanish.
    open();
    getNode('cam').poeDraw = 25.5; getNode('ph').poeDraw = 6.5;
    setLocale('es');
    const drawCol = tvCols('devices').find((c) => c.key === 'poeDraw');
    const order = (col, tab) => tvBuildRows(tab).slice().sort((a, b) => compareRows(col, a, b, 1)).map((x) => x.ref.nodeId + (x.ref.ifaceId ? ':' + x.ref.ifaceId : ''));
    const drawn = order(drawCol, 'devices').filter((id) => ['cam', 'cam2', 'ph', 'vm'].includes(id));
    ok('PoE draw sorts by watts in Spanish, a dash last', drawn.join() === 'ph,cam2,cam,vm', drawn.join());
    setLocale('en');
    const vlanCol = TV_COLS.interfaces.find((c) => c.key === 'vlan');
    const vorder = order(vlanCol, 'interfaces');
    ok('the interfaces\' VLAN sorts by number, a radio last', vorder.indexOf('rt:i1') < vorder.indexOf('cam:i1') && vorder.indexOf('cam:i1') < vorder.indexOf('pc:w1'), vorder.join());

    // A custom 15.4 W port opened in its cell and left as it was stays
    // custom: it does not read as 802.3af's "PoE 15.4 W".
    getNode('sw').portAttrs.p4 = { poe: 15.4 };
    setView('table');
    showTableTab('ports');
    ok('custom watts show as watts', cell('p:sw:p4', 'port:poe').textContent === '15.4 W' && cell('p:sw:p6', 'port:poe').textContent === 'PoE 15.4 W', cell('p:sw:p4', 'port:poe').textContent);
    edit('p:sw:p4', 'port:poe', cell('p:sw:p4', 'port:poe').textContent);
    ok('and stay custom when left as they are', portAttrOf(getNode('sw'), 'p4').poe === 15.4, String(portAttrOf(getNode('sw'), 'p4').poe));
    edit('p:sw:p6', 'port:poe', cell('p:sw:p6', 'port:poe').textContent);
    ok('a standard stays the standard', portAttrOf(getNode('sw'), 'p6').poe === 'af', String(portAttrOf(getNode('sw'), 'p6').poe));
    setView('map');

    // The port's Watts… field puts back what the port held, a standard
    // included, and the pick follows what the port holds when it is left.
    open();
    select('sw', 'node');
    el('portAttrBox').open = true;
    const p5 = () => document.querySelector('#portAttrList .port-attr[data-port="p5"]');
    const pick5 = p5().querySelector('.port-attr-poe'), watts5 = p5().querySelector('.port-attr-watts');
    pick5.value = 'w'; pick5.dispatchEvent(new Event('change'));
    enter(watts5);
    fire(watts5, '2');
    fire(watts5, '2x');
    leave(watts5);
    ok('a refused entry puts the standard back', portAttrOf(getNode('sw'), 'p5').poe === 'at' && pick5.value === 'at' && watts5.hidden, `${portAttrOf(getNode('sw'), 'p5').poe} ${pick5.value}`);
    pick5.value = 'w'; pick5.dispatchEvent(new Event('change'));
    enter(watts5);
    fire(watts5, '7');
    fire(watts5, '');
    leave(watts5);
    ok('a blank one does too (— is what clears)', portAttrOf(getNode('sw'), 'p5').poe === 'at' && pick5.value === 'at', `${portAttrOf(getNode('sw'), 'p5').poe} ${pick5.value}`);
    pick5.value = 'w'; pick5.dispatchEvent(new Event('change'));
    enter(watts5);
    leave(watts5);
    ok('Watts… left empty: the pick says what the port holds', portAttrOf(getNode('sw'), 'p5').poe === 'at' && pick5.value === 'at');

    // The interface's greyed VLAN follows its address as it is typed.
    select('pc', 'node');
    el('addMacBtn').click();
    const pcRow = document.querySelector('#ifaceListContainer .if-row .if-ip');
    fire(pcRow, '10.0.20.5/24');
    ok('the greyed VLAN follows a new address', document.querySelector('#ifaceListContainer .if-vlan .if-vlan-in').placeholder === 'Auto · 20 Cams',
       document.querySelector('#ifaceListContainer .if-vlan .if-vlan-in').placeholder);
    commitTyping();
    getNode('pc').macOpen = false;

    // A faceplate port written into a switch's interface list, and a bond
    // member, hold no VLANs of their own: portVlans reads the port's facts
    // and the bond's, so the editor, the table and the report do too.
    const named = { v: DOC_VERSION, networks: [],
      nodes: [
        { id: 'sx', type: 'switch', name: 'SX', x: 0, y: 0, portCount: 24, macOpen: true, interfaces: [{ id: 'p24', name: 'sfp1', ip: '' }] },
        { id: 'srv', type: 'server', name: 'SRV', x: 0, y: 100, macOpen: true, interfaces: [
          { id: 'e0', name: 'eth0', ip: '' }, { id: 'e1', name: 'eth1', ip: '' },
          { id: 'b0', name: 'bond0', ip: '10.0.30.5/24', bond: { mode: '802.3ad', members: ['e0', 'e1'] } }] }],
      links: [{ id: 'x1', source: 'sx', target: 'srv', sourceIface: 'p24', targetIface: 'e0' }] };
    open(named);
    select('sx', 'node');
    if (!getNode('sx').macOpen) el('addMacBtn').click();
    ok('no VLAN line on a named faceplate port', getNode('sx').macOpen === true && !document.querySelector('#ifaceListContainer .if-vlan'));
    select('srv', 'node');
    if (!getNode('srv').macOpen) el('addMacBtn').click();
    ok('the bond has the line, its members do not', document.querySelectorAll('#ifaceListContainer .if-vlan').length === 1, String(document.querySelectorAll('#ifaceListContainer .if-vlan').length) + ' ' + JSON.stringify(getNode('srv').interfaces.map((i) => i.id)));
    setView('table');
    showTableTab('interfaces');
    ok('the Interfaces tab: a dash on the named port and the member', icell('sx', 'p24', 'tagged').textContent === '—' && icell('srv', 'e0', 'tagged').textContent === '—'
       && icell('srv', 'e0', 'vlan').textContent === '—' && icell('srv', 'b0', 'tagged').textContent === '');
    ok('and they cannot be edited there', edit('i:srv:e0', 'tagged', '10,20') === false || getNode('srv').interfaces[0].tagged === undefined);
    if (_tv.editor) key(_tv.editor.el, 'Escape');
    setView('map');
    getNode('sx').interfaces[0].tagged = '10,20';
    getNode('srv').interfaces[0].tagged = '30';
    ok('the report reads them as portVlans does', reportVlans() === null && portVlans(getNode('sx'), 'p24').known === false);
    getNode('sx').portAttrs = { p24: { tagged: 'all' } };
    const allRows = reportVlans();
    ok('a trunk carrying every VLAN in a file that names none still prints', !!allRows && allRows.length === 1 && allRows[0].vlan === 'all'
       && show(allRows[0].trunks) === '[{"device":"SX","ports":["sfp1"]}]' && /<b>All VLANs<\/b>/.test(vlansSection(allRows)), show(allRows));

    // An SVI on a trunk (stage 2a review): the Full Showcase's L3 uplink
    // eth2 is on the VLAN 20 subnet and tags 20, so neither the editor nor
    // the Interfaces tab shows 20 as its untagged VLAN (portVlans does not).
    replaceDocument(cloneData(templatesData.showcase), { origin: 'template' });
    initHistory();
    const svi = getNode('l3').interfaces.find((i) => i.id === 'i3');
    ok('the Showcase SVI has no greyed untagged VLAN from its subnet', ifaceVlanAuto(svi) === null && portVlans(getNode('l3'), 'i3').untagged === null, show(ifaceVlanAuto(svi)));
    select('l3', 'node');
    if (!document.querySelector('#ifaceListContainer .if-vlan')) el('addMacBtn').click();
    const sviLine = [...document.querySelectorAll('#ifaceListContainer .if-vlan')].find((r) => r.querySelector('.if-tagged-in').value === '20');
    ok('its VLAN line says Untagged, not Auto · 20', !!sviLine && sviLine.querySelector('.if-vlan-in').placeholder === 'Untagged', sviLine && sviLine.querySelector('.if-vlan-in').placeholder);
    const sviTag = sviLine.querySelector('.if-tagged-in');
    enter(sviTag); fire(sviTag, ''); leave(sviTag);
    ok('the tagged list cleared, the subnet\'s VLAN is greyed again', /^Auto · 20/.test(sviLine.querySelector('.if-vlan-in').placeholder), sviLine.querySelector('.if-vlan-in').placeholder);
    enter(sviTag); fire(sviTag, '20'); leave(sviTag);
    ok('and tagged again, gone again', sviLine.querySelector('.if-vlan-in').placeholder === 'Untagged', sviLine.querySelector('.if-vlan-in').placeholder);
    setView('table');
    showTableTab('interfaces');
    ok('the Interfaces tab: no untagged VLAN beside Tagged 20', icell('l3', 'i3', 'vlan').textContent === '' && icell('l3', 'i3', 'tagged').textContent === '20',
       icell('l3', 'i3', 'vlan') && icell('l3', 'i3', 'vlan').outerHTML);
    setView('map');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(quiet);
    state.settings.view = savedView; saveSettings(); applyView();
    setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 50); });
