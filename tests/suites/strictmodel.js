// The model reads what is written, and nothing else (js/model.js). What is held:
//   1. addresses: an interface address is four plain decimals or a valid IPv6
//      address, and a prefix of digits. ipaddr.parse() used to read a leading
//      zero as octal ("192.168.1.010" was .8, "010.0.0.1" a public 8.0.0.1),
//      fill in shorthands ("10.1" was 10.0.0.1, "3232235777" 192.168.1.1),
//      and parseInt() took "/24abc" and "/24/9". Such text is now an invalid
//      address with the usual finding, never a different address in secret;
//      what was right before still reads the same. A saved network row in
//      such text is kept as written (and invalid), not dropped unseen;
//   2. the faceplate count: a whole number from 0 to 4096, or no count. A file
//      holding "portCount": 1e9 used to hang the tab on its first render, and
//      so did one naming a port "p1000000000" with no count at all;
//   3. bonds: members carrying different addresses are not bonded until the
//      person picks the one the bond keeps, so no address goes silently. One
//      address, or one written twice, bonds as before;
//   4. the words are translated;
//   5. a damaged file: a device or cable that is no object is dropped, not
//      read as an "Unnamed Node"; a second device or cable under one id gets
//      its own; "v": "14" is version 14 (not v1 rerunning every migration);
//      a version that is none, or an accepted list that is no list, is a
//      damaged document.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder(null);
  const open = (doc) => { replaceDocument({ v: DOC_VERSION, links: [], ...doc }, { origin: 'file' }); };
  const saved = () => JSON.parse(JSON.stringify(serializeDoc()));
  const host = (id, ...ips) => ({ id, type: 'server', name: id.toUpperCase(), x: 100, y: 100,
    interfaces: ips.map((ip, i) => ({ id: 'i' + (i + 1), name: 'eth' + i, ip })) });

  try {
    // ---- 1: addresses ----
    const refused = ['192.168.1.010/24', '010.0.0.1/24', '10.1/24', '3232235777/24', '10.0.0.5/24abc', '/24/9',
      '10.0.0.5/24/9', '10.0.0.5/', '10.0.0.5', '10.0.0.5/33', '2001:db8::5/129', '0x0a.0.0.1/24', '10.0.0.5/-1', '10.0.0.5/2 4'];
    const misread = refused.filter((s) => parseValidCIDR(s));
    ok('lenient spellings are not addresses', !misread.length, show(misread.map((s) => [s, parseValidCIDR(s).ip.toString()])));
    const passed = refused.filter((s) => fieldOk.cidr(s));
    ok('and the field check refuses them too', !passed.length, show(passed));

    const kept = { '192.168.1.10/24': '192.168.1.0/24', ' 10.0.0.5/24 ': '10.0.0.0/24', '10.0.0.5 / 24': '10.0.0.0/24',
      '0.0.0.0/0': '0.0.0.0/0', '10.0.0.5/32': '10.0.0.5/32', '2001:db8::5/64': '2001:db8::/64', 'fe80::1%eth0/64': 'fe80::/64',
      '::ffff:192.168.1.1/128': '::ffff:c0a8:101/128' };
    const changed = Object.entries(kept).filter(([s, net]) => { const p = parseValidCIDR(s); return !p || p.networkStr !== net || !fieldOk.cidr(s); });
    ok('what was right before reads the same', !changed.length, show(changed.map(([s]) => [s, (parseValidCIDR(s) || {}).networkStr])));
    ok('a zero is an octet, not an octal prefix', !!parseValidCIDR('10.0.0.0/8') && parseValidCIDR('10.0.0.0/8').ip.toString() === '10.0.0.0');
    ok('a network row takes the same rule', canonicalCidr('010.0.0.0/8') === undefined && canonicalCidr('10.1/16') === undefined
       && canonicalCidr('10.1.0.0/16abc') === undefined && canonicalCidr('10.1.0.7/16') === '10.1.0.0/16');

    // A saved network row in such text is kept as written, not dropped: its
    // name, VLAN and gateway would have gone on the next save, unseen. It is
    // invalid wherever it is shown and is no network to any lookup.
    open({ nodes: [host('pc', '192.168.8.5/24')], networks: [
      { id: 'n1', cidr: '192.168.010.0/24', name: 'Imaging', vlan: 20, gateway: '192.168.10.1' },
      { id: 'n2', cidr: ' 10.1/16 ' }, { id: 'n3', cidr: '10.0.0.0' }, { id: 'n4', cidr: '10.0.9.7/24' }] });
    const nets = () => state.networks.map((n) => n.id + '=' + n.cidr);
    ok('a network row in lenient text is kept, its facts with it', show(nets()) === show(['n1=192.168.010.0/24', 'n2=10.1/16', 'n4=10.0.9.0/24'])
       && getNode('pc') && state.networks[0].name === 'Imaging' && state.networks[0].vlan === 20, show(nets()));
    ok('and survives a save', show(saved().networks.map((n) => n.cidr)) === show(['192.168.010.0/24', '10.1/16', '10.0.9.0/24']),
       show(saved().networks));
    ok('it is invalid, and no network to the lookups', !fieldOk.cidr(state.networks[0].cidr) && networkOfIp(ipaddr.parse('192.168.8.5')) === null
       && networkTable(state.networks).length === 1, String(networkTable(state.networks).length));

    // A document already holding such text: the address is reported, and the
    // checks do not act on the address it used to be misread as.
    open({ nodes: [host('nas', '192.168.1.010/24'), host('pc', '192.168.1.8/24'), host('web', '010.0.0.1/24')] });
    const nas = getNode('nas'), web = getNode('web');
    ok('the text stays as written', nas.interfaces[0].ip === '192.168.1.010/24');
    ok('and is an invalid address on that device', evaluateInterfaces(nas).level === 'bad' && /Invalid CIDR/.test(evaluateInterfaces(nas).text),
       evaluateInterfaces(nas).text);
    ok('it holds no address the checks would use', getValidIps(nas).length === 0 && getValidIps(web).length === 0,
       show(getValidIps(nas).map((p) => p.ip.toString())));
    ok('so .010 is not a duplicate of .8', findNodeByIp('192.168.1.8') === getNode('pc'));
    // A gateway or DNS server is read as strictly as an address: the diagnostics
    // parse them with parseIpOrThrow, which throws where ipaddr.parse would guess.
    const gwRead = ['010.0.0.1', '10.1', '3232235777', '192.168.1.1'].map((s) => { try { return parseIpOrThrow(s).toString(); } catch (e) { return null; } });
    ok('a gateway in lenient text is no address', show(gwRead) === show([null, null, null, '192.168.1.1']), show(gwRead));
    ok('and 010.0.0.1 is not found as the public 8.0.0.1', findNodeByIp('8.0.0.1') === null);

    // The single-address lookups are as strict as the gateway field.
    open({ nodes: [host('gw', '10.0.0.1/24')] });
    ok('a gateway written in shorthand finds nobody', findNodeByIp('10.1') === null && findNodeByIp('167772161') === null
       && findNodeByIp('010.0.0.1') === null, show([findNodeByIp('10.1') && 'found']));
    ok('written plainly it finds the device', findNodeByIp('10.0.0.1') === getNode('gw') && findNodeByIp(' 10.0.0.1 ') === getNode('gw'));

    // ---- 2: the faceplate count ----
    const count = (v) => readFields(NODE_FIELDS, { id: 's', type: 'switch', x: 0, y: 0, portCount: v, interfaces: [] });
    const bad = [1e9, 4097, -1, 2.5, NaN, Infinity, '24', null, true].filter((v) => 'portCount' in count(v));
    ok('a count that is no count is not read', !bad.length, show(bad));
    ok('a real one is', count(24).portCount === 24 && count(0).portCount === 0 && count(4096).portCount === 4096);
    const written = writeFields(NODE_FIELDS, { id: 's', type: 'switch', x: 0, y: 0, portCount: 1e9, interfaces: [] });
    ok('and none is written either', !('portCount' in written) || written.portCount === undefined, show(written.portCount));

    // Only opened once the reader has been seen to refuse it: on a build that
    // still took it, this is the line that hangs.
    if (!bad.length) {
      open({ nodes: [{ id: 'big', type: 'switch', name: 'Big', x: 0, y: 0, portCount: 1e9, interfaces: [] },
                     { id: 'neg', type: 'switch', name: 'Neg', x: 0, y: 0, portCount: -3, interfaces: [] },
                     { id: 'sw', type: 'switch', name: 'Core', x: 0, y: 0, portCount: 48, interfaces: [] }] });
      ok('a file holding 1e9 opens at the implicit size', portCountOf(getNode('big')) === DEFAULT_PORT_COUNT.switch
         && getInterfaces(getNode('big')).length === DEFAULT_PORT_COUNT.switch, String(portCountOf(getNode('big'))));
      ok('a negative count is no count', !('portCount' in getNode('neg')) && faceplatePortIds(getNode('neg')).length === DEFAULT_PORT_COUNT.switch);
      ok('a real count survives the round trip', saved().nodes.find((n) => n.id === 'sw').portCount === 48);
      // A count that reached a node some other way is not trusted either.
      getNode('sw').portCount = 1e9;
      ok('nor one set after loading', getInterfaces(getNode('sw')).length === DEFAULT_PORT_COUNT.switch, String(getInterfaces(getNode('sw')).length));
    } else {
      ok('a file holding 1e9 opens at the implicit size', false, 'not opened: the reader still takes it');
    }

    // With no count the faceplate grows to the highest port in use, so that is
    // capped the same way: a port id is raw text on load. Checked on a node
    // outside the document first, for the same reason as above.
    const loose = { id: 'loose', type: 'switch', interfaces: [{ id: 'p1000000000' }, { id: 'p5000' }, { id: 'p4096' }] };
    const capped = highestPortInUse(loose) === 4096 && highestPortInUse({ id: 'l2', type: 'switch', interfaces: [{ id: 'p999999999' }] }) === 0;
    ok('a port id past the cap does not size the faceplate', capped, String(highestPortInUse(loose)));
    if (capped) {
      open({ nodes: [{ id: 'far', type: 'switch', name: 'Far', x: 0, y: 0, interfaces: [{ id: 'p1000000000', name: 'x', ip: '' }] },
                     { id: 'pc', type: 'server', name: 'PC', x: 0, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }],
             links: [{ id: 'l1', source: 'far', target: 'pc', sourceIface: 'p999999999', targetIface: 'i1' }] });
      const far = getNode('far');
      ok('a file naming p1000000000 opens at the implicit size', portCountOf(far) === DEFAULT_PORT_COUNT.switch
         && faceplatePortIds(far).length <= DEFAULT_PORT_COUNT.switch + 2, String(portCountOf(far)));
      ok('and the far port is still listed, after the faceplate', getInterfaces(far).length === DEFAULT_PORT_COUNT.switch + 1
         && getInterfaces(far).pop().id === 'p1000000000', String(getInterfaces(far).length));
    } else {
      ok('a file naming p1000000000 opens at the implicit size', false, 'not opened: the far port id still sizes the faceplate');
    }

    // ---- 3: bonds ----
    open({ nodes: [host('nas', '192.168.1.10/24', '192.168.1.11/24')] });
    const n1 = getNode('nas');
    ok('two addresses are a choice', show(bondAddresses(n1)) === show([{ ip: '192.168.1.10/24', names: ['eth0'] }, { ip: '192.168.1.11/24', names: ['eth1'] }]),
       show(bondAddresses(n1)));
    ok('so the bond is refused without one', createBond(n1) === null && !n1.interfaces.some(isBond));
    ok('and no address went', show(n1.interfaces.map((i) => i.ip)) === show(['192.168.1.10/24', '192.168.1.11/24']), show(n1.interfaces.map((i) => i.ip)));
    ok('an address it does not have is no choice', createBond(n1, { keep: '192.168.1.12/24' }) === null && !n1.interfaces.some(isBond));
    const b1 = createBond(n1, { keep: '192.168.1.11/24' });
    ok('the chosen one is the bond\'s', !!b1 && b1.ip === '192.168.1.11/24' && b1.bond.members.length === 2, b1 && b1.ip);
    ok('and the members hold none', n1.interfaces.filter((i) => !isBond(i)).every((i) => !i.ip));

    // Back compatible: one address, or the same one twice, bonds as it did.
    open({ nodes: [host('a', '10.0.0.5/24', ''), host('b', '10.0.0.6/24', ' 10.0.0.6/24 ')] });
    const ba = createBond(getNode('a'));
    ok('one address bonds with no choice to make', !!ba && ba.ip === '10.0.0.5/24', ba && ba.ip);
    const bb = createBond(getNode('b'));
    ok('the same address twice is one address', !!bb && parseValidCIDR(bb.ip).networkStr === '10.0.0.0/24'
       && parseValidCIDR(bb.ip).ip.toString() === '10.0.0.6', bb && bb.ip);
    // Text that does not parse is still somebody's: it is not cleared unseen.
    open({ nodes: [host('c', '10.0.0.7/24', '10.0.0.8/24abc')] });
    ok('an unreadable address is not cleared unseen either', createBond(getNode('c')) === null && bondAddresses(getNode('c')).length === 2);

    // The sidebar: the button opens the choice, and the choice bonds.
    open({ nodes: [host('nas', '192.168.1.10/24', '192.168.1.11/24'), host('pc', '192.168.1.20/24')] });
    select('nas', 'node');
    el('bondIfaceBtn').click();
    const choice = () => el('bondChoice');
    ok('the button offers the choice', !!choice() && choice().querySelectorAll('button').length === 3, choice() ? choice().textContent : 'no choice shown');
    ok('and bonds nothing by itself', !getNode('nas').interfaces.some(isBond));
    const keepBtn = choice() && [...choice().querySelectorAll('button')].find((b) => b.textContent.includes('192.168.1.11/24'));
    ok('each option says where the address is now', !!keepBtn && keepBtn.title.includes('eth1'), keepBtn && keepBtn.title);
    select('pc', 'node'); select('nas', 'node');
    ok('another device closes it', !choice());
    el('bondIfaceBtn').click();
    const cancel = choice() && [...choice().querySelectorAll('button')].pop();
    if (cancel) cancel.click();
    ok('Cancel closes it', !choice() && !getNode('nas').interfaces.some(isBond));
    el('bondIfaceBtn').click();
    const pick = choice() && [...choice().querySelectorAll('button')].find((b) => b.textContent.includes('192.168.1.11/24'));
    if (pick) pick.click();
    const made = getNode('nas').interfaces.find(isBond);
    ok('picking one bonds with it', !!made && made.ip === '192.168.1.11/24' && !choice(), made ? made.ip : 'no bond');
    select('pc', 'node');
    open({ nodes: [host('one', '10.0.0.5/24', '')] });
    select('one', 'node');
    el('bondIfaceBtn').click();
    ok('with one address the button bonds straight away', !choice() && (getNode('one').interfaces.find(isBond) || {}).ip === '10.0.0.5/24');
    select(null, null);

    // ---- 4: words ----
    const keys = ['These NICs carry {n} different addresses, and a bond holds one. Pick the one it keeps; the others are cleared.',
      'Bond, keeping {ip}', 'Now on {names}'];
    // MESSAGES is a const inside i18n.js, so a suite reaches it through the exported object.
    const { MESSAGES } = window.CarinoI18N;
    const missing = ['es', 'pt-BR', 'ru', 'ja'].flatMap((l) => keys.filter((k) => !(MESSAGES[l] && MESSAGES[l][k])).map((k) => `${l}: ${k}`));
    ok('the bond choice is translated in every language', !missing.length, show(missing));
    setLocale('es'); applyLocale();
    ok('and reads in Spanish', t('Bond, keeping {ip}', { ip: 'x' }) === 'Crear el bond con x');
    setLocale('en'); applyLocale();

    // ---- 5: a damaged file ----
    ok('a list entry that is no object is no device', (() => {
      open({ nodes: [null, 'pc', 7, ['x'], host('srv', '10.0.0.2/24')], links: [null, 'l1'] });
      return state.nodes.length === 1 && state.nodes[0].id === 'srv' && state.links.length === 0;
    })(), show(state.nodes.map((n) => n.id)));
    open({ nodes: [host('a', '10.0.0.2/24'), host('a', '10.0.0.3/24'), host('b', '10.0.0.4/24')],
      links: [{ id: 'l1', source: 'a', target: 'b' }, { id: 'l1', source: 'b', target: 'a' }] });
    const ids = state.nodes.map((n) => n.id);
    ok('two devices under one id: the second gets its own', ids.length === 3 && new Set(ids).size === 3 && ids[0] === 'a' && ids[2] === 'b'
      && getNode(ids[1]).interfaces[0].ip === '10.0.0.3/24', show(ids));
    ok('and so does a second cable, both kept', state.links.length === 2 && new Set(state.links.map((l) => l.id)).size === 2 && state.links[0].id === 'l1');
    ok('a version written as text is that version', docVersionOf({ v: '14' }) === 14 && docVersionOf({ v: ' 3 ' }) === 3 && docVersionOf({}) === 1);
    const half = { v: String(DOC_VERSION), nodes: [{ id: 'sw', type: 'switch', name: 'SW', x: 0, y: 0, interfaces: [], group: 'rk', rackU: 10, rackDepth: 'half' }],
      links: [], groups: [{ id: 'rk', name: 'Rack', kind: 'rack', uHeight: 42 }] };
    ok('so a current file with "v": "14" runs no migration (its half-depth gear stays half)', migrateDoc(half).doc.nodes[0].rackDepth === 'half');
    ok('a version that is no version is a damaged file', !isDocShape({ v: 'abc', nodes: [] }) && !isDocShape({ v: 0, nodes: [] }) && !isDocShape({ v: 2.5 })
      && isDocShape({ v: '14' }) && isDocShape({ nodes: [] }));
    ok('and so is an accepted list that is not a list', !isDocShape({ v: DOC_VERSION, accepted: 'x' }) && !isDocShape({ v: DOC_VERSION, accepted: {} })
      && isDocShape({ v: DOC_VERSION, accepted: [] }));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
