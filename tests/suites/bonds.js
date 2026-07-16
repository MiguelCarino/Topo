// Bonds are the remedy the MAC-flapping diagnostic prescribes, so the point of
// this suite is that taking the advice actually silences the alert — and that a
// half-built bond does not.
window.addEventListener('load', () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);

  function reset(nodes, links) {
    state.nodes = nodes.map(normalizeLoadedNode);
    state.links = links.map(normalizeLoadedLink);
    autoBindLinks();
  }

  // The original complaint: an Ubuntu PACS box, two NICs, one subnet, one switch.
  const pacsScenario = () => reset([
    { id: 'pacs', type: 'server', name: 'PACS', x: 0, y: 0, gw: '192.168.1.1',
      interfaces: [{ id: 'i1', name: 'eno1', ip: '192.168.1.10/24' }, { id: 'i2', name: 'enp4s0', ip: '192.168.1.11/24' }] },
    { id: 'sw', type: 'switch', name: 'Core', x: 0, y: 100, interfaces: [] }
  ], [
    { id: 'l1', source: 'pacs', target: 'sw' },
    { id: 'l2', source: 'pacs', target: 'sw' }
  ]);

  // ---- 1: bonding cures the thing the diagnostic told you to bond for ----
  pacsScenario();
  ok('unbonded PACS still flags MAC flapping', nodeSeverity(getNode('pacs')) === 'bad');

  const pacs = getNode('pacs');
  const bond = createBond(pacs);
  ok('createBond folds both NICs in', bond && bond.bond.members.length === 2, bond && bond.bond.members.join('+'));
  ok('the bond takes the address', bond && bond.ip === '192.168.1.10/24', bond && bond.ip);
  ok('members give theirs up', pacs.interfaces.filter((i) => !isBond(i)).every((i) => !i.ip),
     pacs.interfaces.map((i) => `${i.name}=${i.ip || '-'}`).join(' '));
  ok('flapping alert is gone', evaluateMultiHoming(pacs).level !== 'bad', evaluateMultiHoming(pacs).level);
  ok('bonded PACS is no longer badged', nodeSeverity(pacs) === null, String(nodeSeverity(pacs)));
  ok('the bond reports itself healthy', evaluateBond(pacs).level === 'good', evaluateBond(pacs).text.slice(0, 60));
  ok('both cables stay put', state.links.length === 2, String(state.links.length));
  ok('cables land on members, never on the bond',
     state.links.every((l) => l.sourceIface !== bond.id && l.targetIface !== bond.id),
     state.links.map((l) => l.sourceIface).join(','));

  // ---- 2: a bond that kept the address on its members fixes nothing ----
  pacsScenario();
  const p2 = getNode('pacs');
  const b2 = createBond(p2);
  p2.interfaces.find((i) => i.name === 'eno1').ip = '192.168.1.10/24'; // the classic half-migration
  ok('address left on a member is flagged', evaluateBond(p2).level === 'bad', evaluateBond(p2).text.slice(0, 70));
  ok('and the node stays badged', nodeSeverity(p2) === 'bad');

  // ---- 3: a bond of one is not a bond ----
  reset([{ id: 'h', type: 'server', name: 'Host', x: 0, y: 0,
           interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }, { id: 'i2', name: 'eth1', ip: '' }] }], []);
  const h = getNode('h');
  const b3 = createBond(h);
  b3.bond.members = [b3.bond.members[0]];
  ok('a single-member bond warns', evaluateBond(h).level === 'warn', evaluateBond(h).text.slice(0, 55));

  // ---- 4: LACP across two independent switches never comes up ----
  const lacpScenario = (mode) => {
    reset([
      { id: 'srv', type: 'server', name: 'Srv', x: 0, y: 0,
        interfaces: [{ id: 'i1', name: 'eno1', ip: '192.168.1.10/24' }, { id: 'i2', name: 'eno2', ip: '' }] },
      { id: 'swA', type: 'switch', name: 'A', x: -100, y: 100, interfaces: [] },
      { id: 'swB', type: 'switch', name: 'B', x: 100, y: 100, interfaces: [] }
    ], [
      { id: 'l1', source: 'srv', target: 'swA' },
      { id: 'l2', source: 'srv', target: 'swB' }
    ]);
    const n = getNode('srv');
    const b = createBond(n, { mode });
    return { n, b };
  };

  const lacp = lacpScenario('802.3ad');
  ok('LACP split across two switches is flagged', evaluateBond(lacp.n).level === 'bad', evaluateBond(lacp.n).text.slice(0, 60));
  ok('and it says why (one switch, or MLAG)', /MLAG|one switch/i.test(evaluateBond(lacp.n).text));

  const ab = lacpScenario('active-backup');
  ok('active-backup across two switches is correct', evaluateBond(ab.n).level === 'good', evaluateBond(ab.n).text.slice(0, 60));

  // ...but LACP into a single switch is exactly right.
  pacsScenario();
  const p4 = getNode('pacs');
  createBond(p4, { mode: '802.3ad' });
  ok('LACP into one switch is fine', evaluateBond(p4).level === 'good', evaluateBond(p4).text.slice(0, 60));

  // ---- 5: a radio cannot be a bond member ----
  reset([{ id: 'lap', type: 'pc', name: 'Laptop', x: 0, y: 0,
           interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.20/24' }, { id: 'i2', name: 'wlan0', ip: '' }] }], []);
  const lap = getNode('lap');
  const b5 = createBond(lap);
  ok('createBond leaves the radio out', !b5 || !b5.bond.members.includes('i2'), b5 ? b5.bond.members.join(',') : 'no bond');
  if (b5) {
    b5.bond.members.push('i2'); // force it, as a hand-edited diagram might
    ok('a radio forced into a bond is flagged', evaluateBond(lap).level === 'bad', evaluateBond(lap).text.slice(0, 55));
  } else {
    ok('a radio forced into a bond is flagged', true, 'no bond was formed from one NIC + a radio');
  }

  // ---- 6: bonds survive the URL hash ----
  pacsScenario();
  createBond(getNode('pacs'), { mode: '802.3ad' });
  save(); load();
  const reloaded = getNode('pacs');
  const rb = (reloaded.interfaces || []).find(isBond);
  ok('the bond survives save/load', !!rb, (reloaded.interfaces || []).map((i) => i.name).join(','));
  ok('with its mode and members intact', rb && rb.bond.mode === '802.3ad' && rb.bond.members.length === 2,
     rb ? `${rb.bond.mode} x${rb.bond.members.length}` : 'gone');
  ok('and still reads clean after reload', nodeSeverity(reloaded) === null, String(nodeSeverity(reloaded)));

  // ---- 7: unbonding hands the address back ----
  pacsScenario();
  const p7 = getNode('pacs');
  const b7 = createBond(p7);
  removeBond(p7, b7.id);
  ok('unbond returns the address to a member', (p7.interfaces[0] || {}).ip === '192.168.1.10/24',
     p7.interfaces.map((i) => `${i.name}=${i.ip || '-'}`).join(' '));
  ok('unbond leaves no bond behind', !p7.interfaces.some(isBond));

  // ---- 8: deleting a NIC takes its cable, and does not orphan the link ----
  pacsScenario();
  const p8 = getNode('pacs');
  ok('two cables before the delete', state.links.length === 2);
  deleteIface(p8, 'i2');
  ok('deleting a NIC drops the cable that was in it', state.links.length === 1, String(state.links.length));
  ok('no link is left pointing at the dead NIC',
     !state.links.some((l) => l.sourceIface === 'i2' || l.targetIface === 'i2'));
  ok('and the survivor is no longer flapping', nodeSeverity(p8) === null, String(nodeSeverity(p8)));

  // Deleting a bonded member pulls it out of the bond too.
  pacsScenario();
  const p9 = getNode('pacs');
  const b9 = createBond(p9);
  deleteIface(p9, b9.bond.members[1]);
  ok('deleting a member removes it from the bond', b9.bond.members.length === 1, b9.bond.members.join(','));

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
