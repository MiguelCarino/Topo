// @realtime — the Topo server's encryption in the browser (js/servercrypto.js,
// docs/SCOPE.md step 5a, design §5 and amendments A1-A5). Web Crypto only,
// so it runs on the real clock. Covered:
//   - keys: a device key and the user keys come back non-extractable; a
//     bundle's public halves are derived from its private keys (A2);
//   - wraps: the round trip; the wrong recipient, context or signer is
//     refused ('untrusted-wrap'); `by` and the salt are signed (A4);
//   - the recovery key: 26 + 2 symbols in 7 groups, typing hints, the
//     checksum, the escrow round trip, a wrong key opens nothing;
//   - revisions: sealing twice draws two IVs (A5), tampering with any field
//     of the signed string, the body or the AAD fails;
//   - rosters: the first is trust on first use for its only owner; the next
//     must be signed by an owner of the one before; a viewer's signature,
//     a skipped seq and a key whose fingerprint the roster does not name fail;
//   - the WebCrypto vectors the Go side verifies (server/internal/tcrypto/
//     testdata/webcrypto_vectors.json) check out here too, byte for byte;
//   - the safety code (24 digits, A1) and the link code (8 symbols over the
//     device key and both user keys, A2) are stable and change with any key.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const C = window.TopoServerCrypto;
  const throwsCode = async (fn, code) => { try { await fn(); return false; } catch (e) { return e.code === code || e.message === code; } };
  try {
    ok('the module is there', !!C && typeof C.wrap === 'function');
    // ---- Keys ----
    const dev = await C.newDevice();
    ok('a device key is not extractable', dev.priv.extractable === false && C.unb64u(dev.pub).length === 65);
    const u = await C.newUser();
    ok('the user keys are not extractable', u.enc.extractable === false && u.sig.extractable === false);
    const again = await C.importBundle(u.bundle);
    ok('a bundle gives back the same public keys (A2)', again.encPub === u.encPub && again.sigPub === u.sigPub);
    ok('the public keys are 65-byte points', C.unb64u(u.encPub).length === 65 && C.unb64u(u.sigPub)[0] === 4);
    // ---- Signatures ----
    const sig = await C.sign(u.sig, 'hello');
    ok('a P1363 signature is 64 bytes', C.unb64u(sig).length === 64);
    ok('it verifies', await C.verify(u.sigPub, 'hello', sig));
    ok('another text does not', !(await C.verify(u.sigPub, 'hellO', sig)));
    // ---- Wraps ----
    const other = await C.newUser();
    const ctx = C.siteCtx('s_' + 'a'.repeat(22), 1, 'u_' + 'b'.repeat(22));
    const key = C.newSiteKeyRaw();
    const w = await C.wrap({ toPub: other.encPub, ctx, plaintext: key, by: 'u_' + 'c'.repeat(22), sigPriv: u.sig });
    ok('a wrap names its recipient by fingerprint', w.to === await C.fp(other.encPub) && w.to.length === 22 && w.alg === C.WRAP_ALG);
    const back = await C.unwrap(w, { priv: other.enc, pub: other.encPub, ctx, signers: [u.sigPub] });
    ok('wrap and unwrap round trip', C.b64u(back) === C.b64u(key));
    ok('the wrong context is refused', await throwsCode(() => C.unwrap(w, { priv: other.enc, pub: other.encPub, ctx: ctx + 'x', signers: [u.sigPub] }), 'untrusted-wrap'));
    ok('the wrong recipient is refused', await throwsCode(() => C.unwrap(w, { priv: u.enc, pub: u.encPub, ctx, signers: [u.sigPub] }), 'untrusted-wrap'));
    ok('an untrusted signer is refused', await throwsCode(() => C.unwrap(w, { priv: other.enc, pub: other.encPub, ctx, signers: [other.sigPub] }), 'untrusted-wrap'));
    ok('`by` is signed (A4)', await throwsCode(() => C.unwrap(Object.assign({}, w, { by: 'u_' + 'd'.repeat(22) }), { priv: other.enc, pub: other.encPub, ctx, signers: [u.sigPub] }), 'untrusted-wrap'));
    const salt = C.unb64u(w.salt); salt[0] ^= 1;
    ok('the salt is signed (A4)', await throwsCode(() => C.unwrap(Object.assign({}, w, { salt: C.b64u(salt) }), { priv: other.enc, pub: other.encPub, ctx, signers: [u.sigPub] }), 'untrusted-wrap'));
    const ct = C.unb64u(w.ct); ct[3] ^= 1;
    ok('a changed ciphertext is refused', await throwsCode(() => C.unwrap(Object.assign({}, w, { ct: C.b64u(ct) }), { priv: other.enc, pub: other.encPub, ctx, signers: [u.sigPub] }), 'untrusted-wrap'));
    const devWrap = await C.wrap({ toPub: dev.pub, ctx: C.deviceCtx('u_x', 'd_y'), plaintext: u.bundle, by: 'u_x', sigPriv: u.sig });
    const devBack = await C.unwrap(devWrap, { priv: dev.priv, pub: dev.pub, ctx: C.deviceCtx('u_x', 'd_y'), signers: [u.sigPub] });
    ok('a bundle wrapped to a device comes back whole', C.fromUtf8(devBack) === C.fromUtf8(u.bundle));

    // ---- Recovery ----
    const rc = await C.newRecoveryCode();
    ok('the recovery key is 7 groups of 4 from the alphabet', /^([a-z2-9]{4}-){6}[a-z2-9]{4}$/.test(rc.text) && ![...rc.text.replace(/-/g, '')].some((c) => !C.ALPHABET.includes(c)), rc.text);
    ok('it is typed with spaces, in capitals', (await C.parseRecoveryCode(rc.text.toUpperCase().replace(/-/g, ' '))).ok);
    ok('an i, l, o, 0 or 1 is named', (await C.parseRecoveryCode(rc.text.replace(/^./, 'l'))).error === 'alphabet');
    const flip = rc.text[0] === 'a' ? 'b' + rc.text.slice(1) : 'a' + rc.text.slice(1);
    ok('a wrong character fails the checksum', (await C.parseRecoveryCode(flip)).error === 'checksum');
    ok('a short code says so', (await C.parseRecoveryCode(rc.text.slice(0, 20))).error === 'length');
    const esc = await C.sealEscrow(rc.symbols, u.bundle, 'u_me');
    ok('the escrow round trip', C.fromUtf8(await C.openEscrow(rc.symbols, esc, 'u_me')) === C.fromUtf8(u.bundle));
    ok('the escrow is bound to its user', (await C.openEscrow(rc.symbols, esc, 'u_other')) === null);
    const rc2 = await C.newRecoveryCode();
    ok('another recovery key opens nothing', (await C.openEscrow(rc2.symbols, esc, 'u_me')) === null);

    // ---- Revisions ----
    const site = C.newId('s_');
    const sk = await C.importSiteKey(C.newSiteKeyRaw());
    const plain = await C.packDoc({ v: 1, id: 'net1', rev: 'r1', doc: { nodes: [{ id: 'n1' }], links: [] } });
    const h0 = await C.genesis(site);
    const hd = { site, n: 1, base: 0, prev: h0, epoch: 1, rseq: 1, author: 'u_a', dev: 'd_a', at: 1700000000000 };
    const s1 = await C.sealRevision(hd, sk, u.sig, plain);
    const s2 = await C.sealRevision(hd, sk, u.sig, plain);
    ok('two seals of the same text draw different IVs (A5)', s1.envelope.iv !== s2.envelope.iv && s1.envelope.ct !== s2.envelope.ct);
    const e1 = s1.envelope;
    ok('the chain hash is SHA-256 of S and the signature', s1.h === await C.chainHash(C.revSigned(e1), e1.sig));
    ok('the signature covers S', await C.verify(u.sigPub, C.revSigned(e1), e1.sig));
    const env = await C.unpackDoc(await C.openRevision(e1, { iv: e1.iv, ct: e1.ct }, sk));
    ok('a revision opens to its envelope', env.id === 'net1' && env.doc.nodes[0].id === 'n1');
    for (const f of ['n', 'base', 'prev', 'epoch', 'rseq', 'author', 'dev', 'at']) {
      const t2 = Object.assign({}, e1, { [f]: typeof e1[f] === 'number' ? e1[f] + 1 : e1[f] + 'x' });
      let opened = true;
      try { await C.openRevision(t2, { iv: e1.iv, ct: e1.ct }, sk); } catch (e) { opened = false; }
      ok(`changing ${f} breaks the signature and the AAD`, !(await C.verify(u.sigPub, C.revSigned(t2), e1.sig)) && !opened);
    }
    const ctb = C.unb64u(e1.ct); ctb[5] ^= 1;
    ok('a changed body does not match ctHash', await throwsCode(() => C.openRevision(e1, { iv: e1.iv, ct: C.b64u(ctb) }, sk), 'bad-chain'));
    ok('the name seals and opens with its epoch', (await C.openName(sk, site, await C.sealName(sk, site, 1, 'Clínica Sol'))) === 'Clínica Sol');
    ok('a name moved to another site does not open', (await C.openName(sk, C.newId('s_'), await C.sealName(sk, site, 1, 'X'))) === null);

    // ---- Rosters ----
    const owner = { u: 'u_' + 'o'.repeat(22), email: 'Owner@Example.test', role: 'owner', encPub: u.encPub, sigPub: u.sigPub };
    const prov = { u: 'u_' + 'p'.repeat(22), email: 'prov@example.test', role: 'provider', encPub: other.encPub, sigPub: other.sigPub };
    const pubs = { [owner.u]: { sigPub: u.sigPub }, [prov.u]: { sigPub: other.sigPub } };
    const r1 = await C.signRoster({ site, seq: 1, epoch: 1, by: owner.u, at: 1, members: [owner], sigPriv: u.sig });
    ok('emails are lowercased in a roster', r1.members[0].email === 'owner@example.test');
    ok('the first roster is trusted on first use', await C.acceptRoster(r1, null, pubs));
    const r2 = await C.signRoster({ site, seq: 2, epoch: 1, by: owner.u, at: 2, members: [owner, prov], sigPriv: u.sig });
    ok('the next, signed by an owner of the first, is accepted', await C.acceptRoster(r2, r1, pubs));
    const r3bad = await C.signRoster({ site, seq: 3, epoch: 1, by: prov.u, at: 3, members: [owner, Object.assign({}, prov, { role: 'owner' })], sigPriv: other.sig });
    ok('a provider cannot sign the next roster', !(await C.acceptRoster(r3bad, r2, pubs)));
    const r4 = await C.signRoster({ site, seq: 4, epoch: 1, by: owner.u, at: 4, members: [owner], sigPriv: u.sig });
    ok('a skipped seq is refused', !(await C.acceptRoster(r4, r2, pubs)));
    ok('a key the roster does not name is refused', !(await C.acceptRoster(r2, r1, { [owner.u]: { sigPub: other.sigPub } })));
    const r1two = await C.signRoster({ site, seq: 1, epoch: 1, by: owner.u, at: 1, members: [owner, prov], sigPriv: u.sig });
    ok('a first roster with two members is refused', !(await C.acceptRoster(r1two, null, pubs)));
    const r2tamper = JSON.parse(JSON.stringify(r2)); r2tamper.members[1].role = 'owner';
    ok('a changed member line breaks the signature', !(await C.acceptRoster(r2tamper, r1, pubs)));

    // ---- Codes ----
    const sc = await C.safetyCode(u.encPub, u.sigPub);
    ok('the safety code is 24 digits in groups of four (A1)', /^(\d{4} ){5}\d{4}$/.test(sc), sc);
    ok('it is stable', sc === await C.safetyCode(u.encPub, u.sigPub));
    ok('it changes with either key', sc !== await C.safetyCode(other.encPub, u.sigPub) && sc !== await C.safetyCode(u.encPub, other.sigPub));
    const lc = await C.linkCode(dev.pub, u.encPub, u.sigPub);
    ok('the link code is 8 symbols in two groups', /^[a-z2-9]{4} [a-z2-9]{4}$/.test(lc), lc);
    ok('it covers the user keys too (A2)', lc !== await C.linkCode(dev.pub, other.encPub, u.sigPub) && lc !== await C.linkCode(dev.pub, u.encPub, other.sigPub));

    // ---- The vectors the Go side checks ----
    const res = await fetch('server/internal/tcrypto/testdata/webcrypto_vectors.json');
    ok('the vectors file is there', res.ok);
    if (res.ok) {
      const v = await res.json();
      ok('vectors: fingerprints', v.owner.encFp === await C.fp(v.owner.encPub) && v.provider.sigFp === await C.fp(v.provider.sigPub));
      ok('vectors: genesis', v.genesis === await C.genesis(v.site));
      ok('vectors: roster canonical form and signatures', C.rosterCanonical(v.rosters[1].roster) === v.rosters[1].canonical
        && await C.verify(v.owner.sigPub, v.rosters[0].canonical, v.rosters[0].roster.sig));
      const vp = { [v.owner.id]: { sigPub: v.owner.sigPub }, [v.provider.id]: { sigPub: v.provider.sigPub } };
      ok('vectors: the roster chain is accepted', await C.acceptRoster(v.rosters[0].roster, null, vp) && await C.acceptRoster(v.rosters[1].roster, v.rosters[0].roster, vp));
      const encKey = await crypto.subtle.importKey('pkcs8', C.unb64u(v.provider.encPkcs8), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const skRaw = await C.unwrap(v.siteWrap, { priv: encKey, pub: v.provider.encPub, ctx: v.siteWrap.ctx, signers: [v.owner.sigPub] });
      ok('vectors: the site key unwraps', C.b64u(skRaw) === v.siteKey);
      const devKey = await crypto.subtle.importKey('pkcs8', C.unb64u(v.device.pkcs8), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      ok('vectors: the device wrap unwraps to the bundle', C.b64u(await C.unwrap(v.deviceWrap, { priv: devKey, pub: v.device.pub, ctx: v.deviceWrap.ctx, signers: [v.provider.sigPub] })) === v.bundle);
      const vk = await C.importSiteKey(skRaw);
      let chainOk = true, prev = v.genesis;
      for (const r of v.revs) {
        const h = Object.assign({ site: v.site }, r.rev);
        if (C.revSigned(h) !== r.signed || r.rev.prev !== prev || await C.chainHash(r.signed, r.rev.sig) !== r.h) chainOk = false;
        const pt = await C.openRevision(h, r.rev, vk);
        if (C.b64u(pt) !== r.plaintext) chainOk = false;
        prev = r.h;
      }
      ok('vectors: both revisions chain, sign and decrypt', chainOk && await C.verify(v.provider.sigPub, v.revs[1].signed, v.revs[1].rev.sig));
    }
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
