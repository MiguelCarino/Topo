// Writes server/internal/tcrypto/testdata/webcrypto_vectors.json: keys, a
// roster chain, a site-key wrap, a device wrap and two chained encrypted
// revisions, all made with WebCrypto exactly as the browser does (design
// §5, amendments A3/A4). `go test ./internal/tcrypto` verifies every
// signature, fingerprint, chain hash and ciphertext in Go, so both sides
// agree byte for byte. ECDSA signatures are randomised, so each run writes
// different (equally valid) values; the committed file is one such run.
//
//   node tests/gen-vectors.mjs
import { webcrypto as wc } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const subtle = wc.subtle;
const enc = new TextEncoder();
const b64u = (buf) => Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString('base64url');
const sha = async (bytes) => new Uint8Array(await subtle.digest('SHA-256', bytes));
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const rnd = (n) => wc.getRandomValues(new Uint8Array(n));

const fp = async (raw) => b64u(await sha(raw)).slice(0, 22);
const id = (p) => p + b64u(rnd(16));

async function ecdh() { return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']); }
async function ecdsa() { return subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); }
async function raw(pub) { return new Uint8Array(await subtle.exportKey('raw', pub)); }
async function sign(priv, text) { return new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, enc.encode(text))); }

async function person(email) {
  const e = await ecdh(), s = await ecdsa();
  const encRaw = await raw(e.publicKey), sigRaw = await raw(s.publicKey);
  return { id: id('u_'), email, e, s, encRaw, sigRaw, encFp: await fp(encRaw), sigFp: await fp(sigRaw),
    encPkcs8: new Uint8Array(await subtle.exportKey('pkcs8', e.privateKey)), sigPkcs8: new Uint8Array(await subtle.exportKey('pkcs8', s.privateKey)) };
}

async function roster(site, seq, epoch, by, members) {
  const at = 1762765200000 + seq;
  const ms = members.map(([p, role]) => ({ u: p.id, email: p.email, role, enc: p.encFp, sig: p.sigFp }));
  const lines = ['topo-roster-v1', site, String(seq), String(epoch), by.id, String(at),
    ...[...ms].sort((a, b) => (a.u < b.u ? -1 : a.u > b.u ? 1 : 0)).map((m) => `${m.u}|${m.email}|${m.role}|${m.enc}|${m.sig}`)];
  const canonical = lines.join('\n');
  const sig = b64u(await sign(by.s.privateKey, canonical));
  return { roster: { v: 1, site, seq, epoch, by: by.id, at, members: ms, sig }, canonical };
}

async function wrap(toPub, toRaw, ctx, plaintext, by) {
  const eph = await ecdh();
  const z = await subtle.deriveBits({ name: 'ECDH', public: toPub }, eph.privateKey, 256);
  const salt = rnd(16), iv = rnd(12);
  const ikm = await subtle.importKey('raw', z, 'HKDF', false, ['deriveKey']);
  const k = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('topo/v1/wrap\n' + ctx) }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const to = await fp(toRaw), epk = b64u(await raw(eph.publicKey));
  const header = ['topo-wrap-v1', ctx, to, epk, b64u(salt), by.id].join('\n');
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(header) }, k, plaintext));
  const signed = header + '\n' + b64u(await sha(cat(iv, ct)));
  const sig = b64u(await sign(by.s.privateKey, signed));
  return { v: 1, alg: 'P256-HKDF256-A256GCM', to, ctx, epk, salt: b64u(salt), iv: b64u(iv), ct: b64u(ct), by: by.id, sig };
}

async function revision(site, siteKey, n, prev, epoch, rseq, author, dev, doc) {
  const body = enc.encode(JSON.stringify({ v: 1, rev: 'r' + n, base: n > 1 ? 'r' + (n - 1) : '', prior: '', doc }));
  const plain = cat(new Uint8Array([0, 0]), body);
  const at = 1762765200000 + n * 1000;
  const iv = rnd(12);
  const head = ['topo-rev-v1', site, String(n), String(n - 1), prev, String(epoch), String(rseq), author.id, dev, String(at)];
  const aad = head.join('\n');
  const key = await subtle.importKey('raw', siteKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, plain));
  const ctHash = b64u(await sha(cat(iv, ct)));
  const S = aad + '\n' + ctHash;
  const sig = b64u(await sign(author.s.privateKey, S));
  const h = b64u(await sha(enc.encode(S + '\n' + sig)));
  return { rev: { n, base: n - 1, prev, epoch, rseq, author: author.id, dev, at, ctHash, sig, iv: b64u(iv), ct: b64u(ct) }, signed: S, h, plaintext: b64u(plain) };
}

const owner = await person('owner@example.test');
const prov = await person('prov@example.test');
const site = id('s_');
const genesis = b64u(await sha(enc.encode('topo-genesis-v1\n' + site)));
const r1 = await roster(site, 1, 1, owner, [[owner, 'owner']]);
const r2 = await roster(site, 2, 1, owner, [[owner, 'owner'], [prov, 'provider']]);
const siteKey = rnd(32);
const siteWrap = await wrap(prov.e.publicKey, prov.encRaw, `site:${site}|epoch:1|user:${prov.id}`, siteKey, owner);

const dev = await ecdh();
const devRaw = await raw(dev.publicKey);
const devId = id('d_');
const bundle = enc.encode(JSON.stringify({ v: 1, enc: b64u(prov.encPkcs8), sig: b64u(prov.sigPkcs8) }));
const devWrap = await wrap(dev.publicKey, devRaw, `user:${prov.id}|dev:${devId}`, bundle, prov);

const rev1 = await revision(site, siteKey, 1, genesis, 1, 1, owner, id('d_'), { name: 'Office', devices: [] });
const rev2 = await revision(site, siteKey, 2, rev1.h, 1, 2, prov, devId, { name: 'Office', devices: [{ id: 'x' }] });

const out = {
  note: 'Generated by tests/gen-vectors.mjs with WebCrypto. Test data only: these keys protect nothing.',
  site, genesis,
  owner: { id: owner.id, email: owner.email, encPub: b64u(owner.encRaw), sigPub: b64u(owner.sigRaw), encFp: owner.encFp, sigFp: owner.sigFp },
  provider: { id: prov.id, email: prov.email, encPub: b64u(prov.encRaw), sigPub: b64u(prov.sigRaw), encFp: prov.encFp, sigFp: prov.sigFp, encPkcs8: b64u(prov.encPkcs8) },
  device: { id: devId, pub: b64u(devRaw), fp: await fp(devRaw), pkcs8: b64u(new Uint8Array(await subtle.exportKey('pkcs8', dev.privateKey))) },
  rosters: [r1, r2],
  siteKey: b64u(siteKey),
  siteWrap,
  deviceWrap: devWrap,
  bundle: b64u(bundle),
  revs: [rev1, rev2],
};
const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'server', 'internal', 'tcrypto', 'testdata', 'webcrypto_vectors.json');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log('wrote', dest);
