// @realtime — awaits Web Crypto, so tests/run.sh runs it on a real clock.
// A subnet's DHCP pool (document v16, tests/suites/dhcppool.js) travels with
// the document: in a plain share link, in a sealed ('e~') one opened with
// the passphrase, and in a binder link's file, every site written through
// the serializer. Opened at the other end, the pool is the one sent and is
// counted the same. The saved searches folded into v16 (doc.searches,
// tests/suites/searches.js) travel the same three ways, and so do a
// device's vendor and model (also v16, tests/suites/inventory.js), and so do
// the VLAN and PoE facts (also v16, tests/suites/vlanmodel.js): a port's
// tagged VLANs and PoE, a switch's budget, a device's draw and a wired
// interface's own and tagged VLANs.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 400) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };

  try {
    await until(() => typeof replaceDocument === 'function' && typeof canSeal === 'function');
    const pooled = { v: DOC_VERSION,
      networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1', dhcp: true, dhcpFirst: '10.0.1.100', dhcpLast: '10.0.1.199' }],
      nodes: [{ id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'lan', ip: '10.0.1.1/24', tagged: '20,30-39' }, { id: 'i2', name: 'lan.40', ip: '', vlan: 40 }] },
        { id: 'sw', type: 'switch', name: 'SW', x: 100, y: 0, portCount: 8, poeBudget: 370.5, portAttrs: { p1: { vlan: 1, tagged: 'all' }, p2: { vlan: 10, poe: 'bt3' }, p3: { poe: 12.5 } }, interfaces: [] },
        { id: 'cam', type: 'camera', name: 'Cam', x: 100, y: 100, poeDraw: 6.49, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] },
        { id: 'pc', type: 'pc', name: 'PC', x: 0, y: 100, vendor: 'Dell', model: 'OptiPlex 7010', os: 'Windows 11', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.150/24' }] }],
      links: [],
      searches: [{ id: 'sq_pc', name: 'Office PCs', query: 'type:pc net:Office', columns: ['ifaces'], sort: 'name', print: true }] };
    replaceDocument(cloneData(pooled), { origin: 'template' });
    const sent = json(serializeDoc());
    const poolOf = () => { const n = serializeDoc().networks[0]; return [n.dhcp, n.dhcpFirst, n.dhcpLast]; };
    const made = () => { const n = serializeDoc().nodes.find((x) => x.id === 'pc'); return [n.vendor, n.model, n.os]; };
    const madeOk = () => json(made()) === json(['Dell', 'OptiPlex 7010', 'Windows 11']);
    const vlans = () => { const d = serializeDoc(); const n = (id) => d.nodes.find((x) => x.id === id);
      return json([n('sw').portAttrs, n('sw').poeBudget, n('cam').poeDraw, n('rt').interfaces[0].tagged, n('rt').interfaces[1].vlan]); };
    const vlansSent = json([{ p1: { vlan: 1, tagged: 'all' }, p2: { vlan: 10, poe: 'bt3' }, p3: { poe: 12.5 } }, 370.5, 6.49, '20,30-39', 40]);
    const counted = () => { const c = subnetCapacity(state.networks[0]); return !!c.pool && c.pool.valid && c.pool.used === 1 && c.fixed.free === 153; };

    // A plain share link.
    const frag = await encodeShareFragment(sent);
    ok('a plain link carries the pool and the saved searches', (await decodeFragment(frag)) === sent && /dhcpFirst/.test(sent) && /sq_pc/.test(sent));
    replaceDocument(templatesData.house, { origin: 'template' });
    openArrivedDocument(await decodeFragment(frag));
    ok('opened, the saved searches are the ones sent', json(serializeDoc().searches) === json(pooled.searches));
    ok('opened, the pool is the one sent and counts the same', json(poolOf()) === json([true, '10.0.1.100', '10.0.1.199']) && counted(), json(poolOf()));
    ok('opened, the device keeps its vendor and model', madeOk(), json(made()));
    ok('opened, the VLAN and PoE facts are the ones sent', vlans() === vlansSent, vlans());

    // A sealed one.
    const pass = generatePassphrase();
    const sealed = await sealFragment(sent, SEAL_KIND.doc, pass);
    ok('the link is sealed', isSealedFragment(sealed));
    const bytes = Array.from(_bytesFromB64url(sealed.slice(2)), (b) => String.fromCharCode(b)).join('');
    ok('the pool is not readable in it', !bytes.includes('10.0.1.100') && !bytes.includes('dhcpFirst'));
    const back = await unsealFragment(sealed, pass);
    ok('the saved search is not readable in it either', !bytes.includes('Office PCs') && !bytes.includes('type:pc'));
    ok('it opens byte for byte', back.json === sent && back.kind === SEAL_KIND.doc);
    replaceDocument(templatesData.house, { origin: 'template' });
    openArrivedDocument(back.json);
    ok('opened, the pool is the one sent and counts the same', json(serializeDoc().networks) === json(JSON.parse(sent).networks) && counted());
    ok('and the saved searches are the ones sent', json(serializeDoc().searches) === json(pooled.searches));
    ok('and the vendor and model', madeOk(), json(made()));
    ok('the model is not readable in the sealed link', !bytes.includes('OptiPlex'));
    ok('and the VLAN and PoE facts', vlans() === vlansSent, vlans());
    ok('no tagged list or PoE key is readable in it', !bytes.includes('30-39') && !bytes.includes('poeBudget') && !bytes.includes('tagged'));

    // A binder link: every site goes through the serializer.
    ok('a binder link\'s site keeps the pool', json(canonicalDoc(JSON.parse(sent)).networks) === json(JSON.parse(sent).networks));
    ok('and its saved searches', json(canonicalDoc(JSON.parse(sent)).searches) === json(pooled.searches));
    const site = canonicalDoc(JSON.parse(sent)).nodes.find((x) => x.id === 'pc');
    ok('and its vendor and model', site.vendor === 'Dell' && site.model === 'OptiPlex 7010');
    const sn = (id) => canonicalDoc(JSON.parse(sent)).nodes.find((x) => x.id === id);
    ok('and its VLAN and PoE facts', json([sn('sw').portAttrs, sn('sw').poeBudget, sn('cam').poeDraw, sn('rt').interfaces[0].tagged, sn('rt').interfaces[1].vlan]) === vlansSent);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
