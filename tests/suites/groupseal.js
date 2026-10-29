// @realtime — awaits Web Crypto, so tests/run.sh runs it on a real clock.
// Groups travel in a sealed ('e~') share link like the rest of the document:
// sealed, opened with the passphrase, and read back through the loader, the
// tree, every rack place and the free-text location come back as they left.
// The suite for the groups themselves is tests/suites/groups.js.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 400) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };

  try {
    await until(() => typeof replaceDocument === 'function' && typeof canSeal === 'function');
    const N = (id, extra) => Object.assign({ id, type: 'server', name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', ports: '', notes: '', nat: false,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    replaceDocument({ v: DOC_VERSION, nodes: [
        N('a', { group: 'rk', rackU: 10, rackHeight: 2, rackFace: 'rear', rackDepth: 'half', portsFace: 'front' }),
        N('d', { group: 'rk', rackU: 12, rackHeight: 2 }),
        N('b', { group: 'room', location: 'Shelf 2' }),
        N('c', { location: 'Basement' })
      ], links: [], groups: [
        { id: 'bld', name: 'Torre Norte', kind: 'building' },
        { id: 'room', name: 'Cuarto de equipos', kind: 'room', parent: 'bld' },
        // A rack's size (Round 2, item 4) travels too: width, depth, numbering.
        { id: 'rk', name: 'Rack 1', kind: 'rack', parent: 'room', uHeight: 24, width: '10in', depthMm: 600, numbering: 'top' }
      ] }, { origin: 'template' });
    const sent = json(serializeDoc());
    ok('sealing is available on this page', canSeal());
    const pass = generatePassphrase();
    const sealed = await sealFragment(sent, SEAL_KIND.doc, pass);
    ok('the link is sealed', isSealedFragment(sealed));
    const bytes = Array.from(_bytesFromB64url(sealed.slice(2)), (b) => String.fromCharCode(b)).join('');
    ok('no group name is readable in it', !bytes.includes('Torre Norte') && !bytes.includes('Rack 1'));
    const back = await unsealFragment(sealed, pass);
    ok('it opens byte for byte', back.json === sent && back.kind === SEAL_KIND.doc);

    replaceDocument(templatesData.house, { origin: 'template' });
    openArrivedDocument(back.json);
    const now = serializeDoc();
    ok('opened, the groups are the ones sent', json(now.groups) === json(JSON.parse(sent).groups), json(now.groups));
    ok('and every device\'s place', json(now.nodes) === json(JSON.parse(sent).nodes));
    ok('the paths read the same at the other end', nodePlaceText(getNode('a')) === 'Torre Norte / Cuarto de equipos / Rack 1 · U14–U15 rear, half depth'
       && json(groupById('rk')) === json({ id: 'rk', name: 'Rack 1', kind: 'rack', parent: 'room', uHeight: 24, width: '10in', depthMm: 600, numbering: 'top' })
       && getNode('a').rackDepth === 'half' && rackFullDepth(getNode('d'))
       && nodePlaceText(getNode('c')) === 'Basement', nodePlaceText(getNode('a')));
    ok('the live document is in the history entry, not the URL', !/groups|Torre/.test(window.location.href));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
