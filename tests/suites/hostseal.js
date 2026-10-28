// @realtime — awaits Web Crypto, so tests/run.sh runs it on a real clock.
// A VM's host (node.host, js/model.js "Hosts") travels in a sealed ('e~')
// share link like the rest of the document: sealed, opened with the
// passphrase and read back through the loader, every guest is on its host
// and in its host's place. The suite for hosts themselves is tests/suites/hosts.js.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 400) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };

  try {
    await until(() => typeof replaceDocument === 'function' && typeof canSeal === 'function');
    const N = (id, type, extra) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', ports: '', notes: '', nat: false,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
    replaceDocument({ v: DOC_VERSION, nodes: [
        N('esx', 'server', { name: 'esx-norte', group: 'rk', rackU: 20, rackHeight: 2 }),
        N('vm', 'vm', { name: 'Expedientes', host: 'esx' }),
        N('ct', 'container', { name: 'Visor', host: 'vm' })
      ], links: [], groups: [{ id: 'rk', name: 'Rack 1', kind: 'rack', uHeight: 42 }] }, { origin: 'template' });
    const sent = json(serializeDoc());
    ok('the guests are in the host\'s rack before it leaves', getNode('vm').group === 'rk' && getNode('ct').group === 'rk');
    const pass = generatePassphrase();
    const sealed = await sealFragment(sent, SEAL_KIND.doc, pass);
    ok('the link is sealed', isSealedFragment(sealed));
    const bytes = Array.from(_bytesFromB64url(sealed.slice(2)), (b) => String.fromCharCode(b)).join('');
    ok('no device name is readable in it', !bytes.includes('esx-norte') && !bytes.includes('Expedientes'));
    const back = await unsealFragment(sealed, pass);
    ok('it opens byte for byte', back.json === sent && back.kind === SEAL_KIND.doc);
    replaceDocument(templatesData.house, { origin: 'template' });
    openArrivedDocument(back.json);
    ok('opened, every guest is on its host', getNode('vm').host === 'esx' && getNode('ct').host === 'vm' && json(serializeDoc().nodes) === json(JSON.parse(sent).nodes));
    ok('and where its host is', nodePlaceText(getNode('ct')) === 'Rack 1 · U20–U21 front', nodePlaceText(getNode('ct')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
