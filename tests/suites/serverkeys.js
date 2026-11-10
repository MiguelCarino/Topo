// @realtime — the Topo server's key store with a real IndexedDB (js/servercrypto.js,
// amendment E3). run.sh gives its pages no IndexedDB, so the other server
// suites only ever see the memory fallback; here the database is real:
//   - it opens, and the store is not ephemeral (D76);
//   - a device key and user keys stored, the store closed and opened again
//     (the next visit): they come back as CryptoKeys, still not
//     extractable, and still sign what the stored public key verifies;
//   - the sync store's base documents and the pinned keys survive the same;
//   - without IndexedDB the store is memory only, and says so.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const C = window.TopoServerCrypto;
  try {
    C.ksReset();
    ok('IndexedDB opens', await C.openKeyStore() === true && C.ephemeral() === false);
    const dev = await C.newDevice();
    const u = await C.newUser();
    await C.ksPut('keys', 'origin|u_test', { origin: 'origin', userId: 'u_test', deviceId: 'd_x', devPriv: dev.priv, devPub: dev.pub, uEnc: u.enc, uSig: u.sig, encPub: u.encPub, sigPub: u.sigPub });
    await C.ksPut('sync', 'origin|base|card1', { doc: { nodes: [{ id: 'n1' }], links: [] }, rev: 'r1' });
    await C.ksPut('trust', 'origin|pins', { u_x: { enc: 'e', sig: 's', at: 1 } });
    // The next visit: the database closed and opened again.
    C.ksReset();
    const rec = await C.ksGet('keys', 'origin|u_test');
    ok('the record comes back', !!rec && rec.deviceId === 'd_x');
    ok('the keys are CryptoKeys still', rec && rec.uSig instanceof CryptoKey && rec.devPriv instanceof CryptoKey);
    ok('and still not extractable', rec && rec.uSig.extractable === false && rec.uEnc.extractable === false && rec.devPriv.extractable === false);
    let exported = true;
    try { await crypto.subtle.exportKey('pkcs8', rec.uSig); } catch (e) { exported = false; }
    ok('exporting one fails', !exported);
    ok('they still sign', rec && await C.verify(rec.sigPub, 'after a reload', await C.sign(rec.uSig, 'after a reload')));
    const w = await C.wrap({ toPub: rec.devPub, ctx: 'c', plaintext: C.utf8('x'), by: 'u', sigPriv: rec.uSig });
    ok('and the device key still unwraps', C.fromUtf8(await C.unwrap(w, { priv: rec.devPriv, pub: rec.devPub, ctx: 'c', signers: [rec.sigPub] })) === 'x');
    ok('the sync store kept its base', ((await C.ksGet('sync', 'origin|base|card1')) || {}).rev === 'r1');
    ok('the pins were kept', ((await C.ksGet('trust', 'origin|pins')) || {}).u_x.sig === 's');
    ok('listing works', (await C.ksAll('keys')).length === 1);
    await C.ksDel('keys', 'origin|u_test');
    ok('deleting works', !(await C.ksGet('keys', 'origin|u_test')));
    // Without IndexedDB: memory, and it says so.
    C.ksReset();
    const idb = Object.getOwnPropertyDescriptor(window, 'indexedDB');
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    try {
      ok('no IndexedDB: memory only', await C.openKeyStore() === false && C.ephemeral() === true);
      await C.ksPut('keys', 'k', { a: 1 });
      ok('memory still holds it for the page', ((await C.ksGet('keys', 'k')) || {}).a === 1);
    } finally {
      if (idb) Object.defineProperty(window, 'indexedDB', idb); else delete window.indexedDB;
      C.ksReset();
    }
    await new Promise((r) => { const q = indexedDB.deleteDatabase('topo_keys'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
