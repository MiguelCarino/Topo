// @realtime — awaits Web Crypto, so tests/run.sh runs it on a real clock.
// Wi-Fi travels in a sealed ('e~') share link like the rest of the document
// (Review-Packs/Topo-wifi.md): sealed, opened with the passphrase, and read
// back through the loader, the networks, every radio and every association
// come back as they left, and no SSID is readable in the link. The suite for
// the data itself is tests/suites/wifimodel.js.
window.addEventListener('load', async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const json = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const until = async (fn, tries = 400) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await tick(); } return false; };

  try {
    await until(() => typeof replaceDocument === 'function' && typeof canSeal === 'function');
    replaceDocument({ v: DOC_VERSION,
      networks: [{ id: 'nS', cidr: '10.1.0.0/24', vlan: 10 }],
      wifi: [{ id: 'wS', ssid: 'Torre Norte Staff', security: 'wpa3', network: 'nS' }, { id: 'wG', ssid: 'Visitas', security: 'owe', bands: ['2.4', '5'], hidden: true }],
      nodes: [
        { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 0, interfaces: [{ id: 'w1', name: 'wlan0', ip: '',
          radio: { standard: 'be', bands: [{ band: '5', channel: 149, width: 80, power: 20 }, { band: '6', channel: 5, width: 320, ssids: ['wS'] }] } }] },
        { id: 'pc', type: 'pc', name: 'PC', x: 0, y: 100, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.1.0.9/24', radio: { standard: 'be' } }] }
      ],
      links: [{ id: 'a', source: 'pc', target: 'ap', sourceIface: 'i1', targetIface: 'w1', medium: 'wireless', wifi: { ssid: 'wS', band: '6', signal: -49 } }] }, { origin: 'template' });
    const sent = json(serializeDoc());
    ok('sealing is available on this page', canSeal());
    const pass = generatePassphrase();
    const sealed = await sealFragment(sent, SEAL_KIND.doc, pass);
    ok('the link is sealed', isSealedFragment(sealed));
    const bytes = Array.from(_bytesFromB64url(sealed.slice(2)), (b) => String.fromCharCode(b)).join('');
    ok('no SSID is readable in it', !bytes.includes('Torre Norte') && !bytes.includes('Visitas'));
    const back = await unsealFragment(sealed, pass);
    ok('it opens byte for byte', back.json === sent && back.kind === SEAL_KIND.doc);

    replaceDocument(templatesData.house, { origin: 'template' });
    openArrivedDocument(back.json);
    const now = serializeDoc();
    ok('opened, the Wi-Fi networks are the ones sent', json(now.wifi) === json(JSON.parse(sent).wifi), json(now.wifi));
    ok('and every radio and association', json(now.nodes) === json(JSON.parse(sent).nodes) && json(getLink('a').wifi) === '{"ssid":"wS","band":"6","signal":-49}');
    ok('the inferences read the same at the other end', linkWifiBand(getLink('a')) === '6' && linkWifiSsid(getLink('a')) === 'wS'
       && radioSummary(getNode('ap').interfaces[0].radio, true) === 'Wi-Fi 7 · 5 GHz ch 149/80 · 6 GHz ch 5/320 · Torre Norte Staff, Visitas');
    ok('the live document is in the history entry, not the URL', !/Visitas|Torre/.test(window.location.href));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
});
