// ---- The server's end-to-end encryption, in the browser (docs/SCOPE.md step 5a) ----
// A Topo server (server/, docs/SERVER.md) keeps networks for a client, but
// only as ciphertext: every key is made and used here, with WebCrypto and
// nothing else. This file is the arithmetic and the key store; js/server.js
// talks to the server, js/serversync.js keeps the cards in step.
//
// The scheme (design §5, amendments A1-A5; verified byte for byte in Go by
// server/internal/tcrypto against tests/gen-vectors.mjs):
//   - a device key D (ECDH P-256) per browser, never extractable;
//   - one user key pair per person, U_enc (ECDH) and U_sig (ECDSA), wrapped
//     to each of their devices and escrowed under a printed recovery code;
//   - a random AES-GCM site key per site and epoch, wrapped to each member's
//     U_enc and signed by the owner who made the wrap;
//   - a signed roster per site (members, roles, key fingerprints), each
//     signed by an owner of the one before;
//   - revisions sealed with the site key in a signed hash chain.
// A wrap is ECIES: ECDH with an ephemeral key, HKDF-SHA256, AES-GCM-256,
// its header (A4: ctx, recipient, ephemeral key, salt, signer) both the AAD
// and the signed prefix. Signatures are P1363 (r||s), as WebCrypto makes them.
//
// Inert by itself: it only defines functions. Nothing here runs on a page no
// Topo server served (js/server.js decides that).

(function () {
'use strict';

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => (window.crypto && window.crypto.subtle) || null;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const WRAP_ALG = 'P256-HKDF256-A256GCM';
// The recovery code's alphabet: no i, l, o, 0 or 1 to misread (as
// generatePassphrase, js/app.js).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// ---- Bytes ----
function b64u(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad-b64');
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
const utf8 = (s) => enc.encode(String(s));
const fromUtf8 = (b) => dec.decode(b);
function cat(...parts) {
    const n = parts.reduce((a, p) => a + p.length, 0);
    const o = new Uint8Array(n);
    let i = 0;
    parts.forEach((p) => { o.set(p, i); i += p.length; });
    return o;
}
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
async function sha256(bytes) { return new Uint8Array(await subtle().digest('SHA-256', bytes)); }
// fp(pub) = the first 22 characters (132 bits) of b64u(SHA-256(raw)).
async function fp(raw) { return b64u(await sha256(typeof raw === 'string' ? unb64u(raw) : raw)).slice(0, 22); }
// A server id: prefix and 16 random bytes (s_ for a site, the browser mints those; D4).
const newId = (prefix) => prefix + b64u(random(16));
const ID_RE = /^[a-z]_[A-Za-z0-9_-]{22}$/;
const validId = (s, prefix) => typeof s === 'string' && ID_RE.test(s) && (!prefix || s.startsWith(prefix));

// ---- Keys ----
const rawOf = async (pub) => new Uint8Array(await subtle().exportKey('raw', pub));
async function importPub(raw, kind) {
    const bytes = typeof raw === 'string' ? unb64u(raw) : raw;
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('bad-key');
    return subtle().importKey('raw', bytes, kind === 'sig' ? ECDSA : ECDH, true, kind === 'sig' ? ['verify'] : []);
}
// A device: its private half never leaves WebCrypto.
async function newDevice() {
    const k = await subtle().generateKey(ECDH, false, ['deriveBits']);
    return { priv: k.privateKey, pub: b64u(await rawOf(k.publicKey)) };
}
// The user's keys, made once (setup, or a reset). The bundle (both private
// halves as pkcs8) exists only to be wrapped and escrowed; the keys kept are
// re-imported non-extractable.
async function newUser() {
    const e = await subtle().generateKey(ECDH, true, ['deriveBits']);
    const s = await subtle().generateKey(ECDSA, true, ['sign', 'verify']);
    const bundle = utf8(JSON.stringify({ v: 1,
        enc: b64u(new Uint8Array(await subtle().exportKey('pkcs8', e.privateKey))),
        sig: b64u(new Uint8Array(await subtle().exportKey('pkcs8', s.privateKey))) }));
    const keys = await importBundle(bundle);
    return Object.assign(keys, { bundle });
}
// A bundle -> { enc, sig (non-extractable), encPub, sigPub }. The public
// halves come from the private keys themselves (amendment A2): imported once
// extractable for their JWK x and y, then dropped.
async function importBundle(bundle) {
    let b;
    try { b = JSON.parse(fromUtf8(bundle)); } catch (e) { throw new Error('bad-bundle'); }
    if (!b || b.v !== 1 || typeof b.enc !== 'string' || typeof b.sig !== 'string') throw new Error('bad-bundle');
    const pubOf = async (pkcs8, alg, use) => {
        const k = await subtle().importKey('pkcs8', pkcs8, alg, true, use);
        const jwk = await subtle().exportKey('jwk', k);
        return b64u(cat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y)));
    };
    const encP = unb64u(b.enc), sigP = unb64u(b.sig);
    return {
        enc: await subtle().importKey('pkcs8', encP, ECDH, false, ['deriveBits']),
        sig: await subtle().importKey('pkcs8', sigP, ECDSA, false, ['sign']),
        encPub: await pubOf(encP, ECDH, ['deriveBits']),
        sigPub: await pubOf(sigP, ECDSA, ['sign'])
    };
}

// ---- Signatures (P1363) ----
async function sign(sigPriv, text) { return b64u(new Uint8Array(await subtle().sign(SIGN, sigPriv, utf8(text)))); }
async function verify(sigPub, text, sigB64) {
    try {
        const sig = unb64u(sigB64);
        if (sig.length !== 64) return false;
        const key = typeof sigPub === 'string' ? await importPub(sigPub, 'sig') : sigPub;
        return await subtle().verify(SIGN, key, sig, utf8(text));
    } catch (e) { return false; }
}

// ---- Codes people read ----
// The safety code (A1): the first 80 bits of SHA-256("topo-safety-v1" |
// encRaw | sigRaw) as 24 digits in groups of four. Digits read out the same
// in every language.
async function safetyCode(encPub, sigPub) {
    const h = await sha256(cat(utf8('topo-safety-v1'), unb64u(encPub), unb64u(sigPub)));
    let n = 0n;
    for (let i = 0; i < 10; i++) n = (n << 8n) | BigInt(h[i]);
    const digits = (n % (10n ** 24n)).toString().padStart(24, '0');
    return digits.match(/.{4}/g).join(' ');
}
// The link code (A2): 8 symbols from SHA-256("topo-link-v1" | devRaw |
// encRaw | sigRaw). Both browsers show it; a host that swapped any of the
// three keys changes it.
async function linkCode(devPub, encPub, sigPub) {
    const h = await sha256(cat(utf8('topo-link-v1'), unb64u(devPub), unb64u(encPub), unb64u(sigPub)));
    let s = '';
    for (let i = 0; i < 8; i++) s += ALPHABET[h[i] % ALPHABET.length];
    return s.slice(0, 4) + ' ' + s.slice(4);
}

// ---- Wraps (ECIES, signed; design §5.3 with A4) ----
const wrapHeader = (w) => ['topo-wrap-v1', w.ctx, w.to, w.epk, w.salt, w.by || ''].join('\n');
async function hkdfKey(z, salt, info, use) {
    const ikm = await subtle().importKey('raw', z, 'HKDF', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, ikm, { name: 'AES-GCM', length: 256 }, false, use);
}
// plaintext to toPub (b64u raw), in context ctx, made and signed by `by`.
async function wrap({ toPub, ctx, plaintext, by, sigPriv }) {
    const recipient = await importPub(toPub, 'enc');
    const eph = await subtle().generateKey(ECDH, true, ['deriveBits']);
    const z = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256));
    const salt = random(16), iv = random(12);
    const w = { v: 1, alg: WRAP_ALG, to: await fp(toPub), ctx, epk: b64u(await rawOf(eph.publicKey)), salt: b64u(salt), iv: b64u(iv), ct: '', by: by || null, sig: null };
    const k = await hkdfKey(z, salt, 'topo/v1/wrap\n' + ctx, ['encrypt']);
    const header = wrapHeader(w);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(header) }, k, plaintext));
    w.ct = b64u(ct);
    if (sigPriv) w.sig = await sign(sigPriv, header + '\n' + b64u(await sha256(cat(iv, ct))));
    return w;
}
// -> the plaintext, or throws 'untrusted-wrap'. Checked in order: addressed
// to me, the context I expect, signed by someone I trust (signers: b64u raw
// U_sig keys, any one of which may have made it), then decrypted.
async function unwrap(w, { priv, pub, ctx, signers }) {
    const fail = () => { const e = new Error('untrusted-wrap'); e.code = 'untrusted-wrap'; throw e; };
    if (!w || w.v !== 1 || w.alg !== WRAP_ALG || typeof w.ct !== 'string') fail();
    if (w.to !== await fp(pub) || w.ctx !== ctx || !w.sig) fail();
    const iv = unb64u(w.iv), ct = unb64u(w.ct);
    const header = wrapHeader(w);
    const signed = header + '\n' + b64u(await sha256(cat(iv, ct)));
    let good = false;
    for (const s of signers || []) { if (s && await verify(s, signed, w.sig)) { good = true; break; } }
    if (!good) fail();
    try {
        const epk = await importPub(w.epk, 'enc');
        const z = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: epk }, priv, 256));
        const k = await hkdfKey(z, unb64u(w.salt), 'topo/v1/wrap\n' + ctx, ['decrypt']);
        return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: utf8(header) }, k, ct));
    } catch (e) { return fail(); }
}
const deviceCtx = (user, dev) => `user:${user}|dev:${dev}`;
const siteCtx = (site, epoch, user) => `site:${site}|epoch:${epoch}|user:${user}`;

// ---- Site keys ----
const newSiteKeyRaw = () => random(32);
const importSiteKey = (raw) => subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
// The site's name, with the epoch key (design §5.7).
async function sealName(key, site, epoch, text) {
    const iv = random(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`topo-name-v1\n${site}\n${epoch}`) }, key, utf8(text)));
    return { v: 1, epoch, iv: b64u(iv), ct: b64u(ct) };
}
async function openName(key, site, n) {
    try {
        const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(n.iv), additionalData: utf8(`topo-name-v1\n${site}\n${n.epoch}`) }, key, unb64u(n.ct));
        return fromUtf8(new Uint8Array(pt));
    } catch (e) { return null; }
}

// ---- Rosters (design §5.6) ----
function rosterCanonical(r) {
    const ms = (r.members || []).slice().sort((a, b) => (a.u < b.u ? -1 : a.u > b.u ? 1 : 0));
    return ['topo-roster-v1', r.site, String(r.seq), String(r.epoch), r.by, String(r.at),
        ...ms.map((m) => `${m.u}|${m.email}|${m.role}|${m.enc}|${m.sig}`)].join('\n');
}
// members: [{ u, email, role, encPub, sigPub }] -> a signed roster.
async function signRoster({ site, seq, epoch, by, at, members, sigPriv }) {
    const ms = [];
    for (const m of members) ms.push({ u: m.u, email: String(m.email).toLowerCase(), role: m.role, enc: await fp(m.encPub), sig: await fp(m.sigPub) });
    ms.sort((a, b) => (a.u < b.u ? -1 : a.u > b.u ? 1 : 0));
    const r = { v: 1, site, seq, epoch, by, at: at || Date.now(), members: ms, sig: '' };
    r.sig = await sign(sigPriv, rosterCanonical(r));
    return r;
}
const rosterMember = (r, u) => ((r && r.members) || []).find((m) => m.u === u) || null;
// Is roster `r` the next one after the trusted `prev` (null for seq 1)?
// pubs: user -> { sigPub } as the server gave them (untrusted: a key counts
// only when its fingerprint is the one the trusted roster names).
async function acceptRoster(r, prev, pubs) {
    if (!r || r.v !== 1 || !Array.isArray(r.members) || !r.members.length) return false;
    const signerPub = pubs && pubs[r.by] && pubs[r.by].sigPub;
    if (!signerPub) return false;
    let line;
    if (!prev) {
        // The first: its signer is its only member, an owner (trust on first use).
        if (r.seq !== 1 || r.members.length !== 1 || r.members[0].u !== r.by || r.members[0].role !== 'owner') return false;
        line = r.members[0];
    } else {
        if (r.site !== prev.site || r.seq !== prev.seq + 1 || r.epoch < prev.epoch) return false;
        line = rosterMember(prev, r.by);
        if (!line || line.role !== 'owner') return false;
    }
    if (line.sig !== await fp(signerPub)) return false;
    return verify(signerPub, rosterCanonical(r), r.sig);
}

// ---- Revisions (design §5.5) ----
const revSigned = (h) => ['topo-rev-v1', h.site, h.n, h.base, h.prev, h.epoch, h.rseq, h.author, h.dev, h.at, h.ctHash].map(String).join('\n');
const revAad = (h) => ['topo-rev-v1', h.site, h.n, h.base, h.prev, h.epoch, h.rseq, h.author, h.dev, h.at].map(String).join('\n');
async function chainHash(signed, sig) { return b64u(await sha256(utf8(signed + '\n' + sig))); }
async function genesis(site) { return b64u(await sha256(utf8('topo-genesis-v1\n' + site))); }
async function ctHashOf(iv, ct) { return b64u(await sha256(cat(iv, ct))); }
// The plaintext of a revision: kind 0 (a document), deflated or not, then
// the JSON envelope { v, id, name, rev, base, prior, doc }.
async function packDoc(env) {
    const raw = utf8(JSON.stringify(env));
    const deflate = typeof CompressionStream !== 'undefined';
    const body = deflate ? await pipe(new CompressionStream('deflate-raw'), raw) : raw;
    return cat(new Uint8Array([0, deflate ? 1 : 0]), body);
}
async function unpackDoc(plain) {
    if (plain[0] !== 0) throw new Error('bad-kind');
    if (plain[1] && typeof DecompressionStream === 'undefined') throw new Error('unsupported');
    const raw = plain[1] ? await pipe(new DecompressionStream('deflate-raw'), plain.slice(2)) : plain.slice(2);
    return JSON.parse(fromUtf8(raw));
}
async function pipe(stream, bytes) {
    const w = stream.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
// The only way a revision is sealed (A5): a fresh IV every time, so a push
// rebuilt after a 409 never reuses a ciphertext.
// h: { site, n, base, prev, epoch, rseq, author, dev, at }.
async function sealRevision(h, key, sigPriv, plain) {
    const iv = random(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(revAad(h)) }, key, plain));
    const head = Object.assign({}, h, { ctHash: await ctHashOf(iv, ct) });
    const S = revSigned(head);
    const sig = await sign(sigPriv, S);
    return { envelope: Object.assign(head, { sig, iv: b64u(iv), ct: b64u(ct) }), h: await chainHash(S, sig) };
}
// -> the plaintext; throws when the body is not the header's or does not authenticate.
async function openRevision(h, body, key) {
    const iv = unb64u(body.iv), ct = unb64u(body.ct);
    if (await ctHashOf(iv, ct) !== h.ctHash) throw new Error('bad-chain');
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: utf8(revAad(h)) }, key, ct));
}

// ---- Recovery code and escrow (design §5.4) ----
// 26 symbols (128.8 bits) and two check symbols, shown in 7 groups of 4.
async function checkSymbols(s26) {
    const h = await sha256(utf8(s26));
    return ALPHABET[h[0] % ALPHABET.length] + ALPHABET[h[1] % ALPHABET.length];
}
async function newRecoveryCode() {
    const limit = 256 - (256 % ALPHABET.length);
    let s = '';
    while (s.length < 26) for (const b of random(40)) { if (b < limit && s.length < 26) s += ALPHABET[b % ALPHABET.length]; }
    const full = s + await checkSymbols(s);
    return { symbols: s, text: full.match(/.{4}/g).join('-') };
}
// Typed text -> { ok, symbols } or { ok: false, error: 'alphabet' | 'length' | 'checksum' }.
async function parseRecoveryCode(text) {
    const s = String(text || '').toLowerCase().replace(/[\s-]+/g, '');
    if ([...s].some((c) => !ALPHABET.includes(c))) return { ok: false, error: 'alphabet' };
    if (s.length !== 28) return { ok: false, error: 'length' };
    if (await checkSymbols(s.slice(0, 26)) !== s.slice(26)) return { ok: false, error: 'checksum' };
    return { ok: true, symbols: s.slice(0, 26) };
}
async function escrowKey(symbols, salt, use) {
    const ikm = await subtle().importKey('raw', utf8(symbols), 'HKDF', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8('topo/v1/recovery') }, ikm, { name: 'AES-GCM', length: 256 }, false, use);
}
async function sealEscrow(symbols, bundle, userId) {
    const salt = random(16), iv = random(12);
    const k = await escrowKey(symbols, salt, ['encrypt']);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8('topo-escrow-v1\n' + userId) }, k, bundle));
    return { v: 1, kdf: 'HKDF-SHA256', salt: b64u(salt), iv: b64u(iv), ct: b64u(ct) };
}
async function openEscrow(symbols, escrow, userId) {
    try {
        const k = await escrowKey(symbols, unb64u(escrow.salt), ['decrypt']);
        return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(escrow.iv), additionalData: utf8('topo-escrow-v1\n' + userId) }, k, unb64u(escrow.ct)));
    } catch (e) { return null; }
}

// ---- The key store (design §5.2, D76) ----
// IndexedDB 'topo_keys': 'sync' (the documents the sync engine builds on,
// js/serversync.js), 'keys' (one record per server origin and user:
// the device and user CryptoKeys, non-extractable) and 'trust' (per site:
// the rosters walked, the pinned head; per origin: people's pinned keys).
// Without IndexedDB (a private window, a blocked store, the test runner)
// a Map in memory, and `ephemeral` says so: this browser is a new device
// every time.
const KEYS_DB = 'topo_keys';
const _mem = { keys: new Map(), trust: new Map(), sync: new Map() };
let _db = null, _opening = null, _ephemeral = false;
function openKeyStore(ms = 1500) {
    if (_db || _ephemeral) return Promise.resolve(!_ephemeral);
    if (_opening) return _opening;
    _opening = new Promise((resolve) => {
        let done = false;
        const finish = (db) => { if (done) { if (db) db.close(); return; } done = true; _db = db; _ephemeral = !db; resolve(!!db); };
        setTimeout(() => finish(null), ms);
        try {
            if (typeof indexedDB === 'undefined' || !indexedDB) { finish(null); return; }
            const req = indexedDB.open(KEYS_DB, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
                if (!db.objectStoreNames.contains('trust')) db.createObjectStore('trust');
                if (!db.objectStoreNames.contains('sync')) db.createObjectStore('sync');
            };
            req.onsuccess = () => finish(req.result);
            req.onerror = () => finish(null);
            req.onblocked = () => finish(null);
        } catch (e) { finish(null); }
    });
    return _opening;
}
function idbDo(store, mode, fn) {
    return new Promise((resolve) => {
        try {
            const tx = _db.transaction(store, mode);
            const req = fn(tx.objectStore(store));
            tx.oncomplete = () => resolve(req ? req.result : true);
            tx.onerror = tx.onabort = () => resolve(mode === 'readonly' ? undefined : false);
        } catch (e) { resolve(mode === 'readonly' ? undefined : false); }
    });
}
async function ksGet(store, key) {
    await openKeyStore();
    if (!_db) return _mem[store].get(key);
    return idbDo(store, 'readonly', (s) => s.get(key));
}
async function ksPut(store, key, value) {
    await openKeyStore();
    if (!_db) { _mem[store].set(key, value); return true; }
    return idbDo(store, 'readwrite', (s) => s.put(value, key));
}
async function ksDel(store, key) {
    await openKeyStore();
    if (!_db) { _mem[store].delete(key); return true; }
    return idbDo(store, 'readwrite', (s) => s.delete(key));
}
async function ksAll(store) {
    await openKeyStore();
    if (!_db) return [..._mem[store].values()];
    return (await idbDo(store, 'readonly', (s) => s.getAll())) || [];
}
// Tests: forget everything (memory) or close the database.
function ksReset() { _mem.keys.clear(); _mem.trust.clear(); _mem.sync.clear(); if (_db) { _db.close(); } _db = null; _opening = null; _ephemeral = false; }

window.TopoServerCrypto = {
    ALPHABET, WRAP_ALG, b64u, unb64u, utf8, fromUtf8, cat, random, sha256, fp, newId, validId,
    importPub, newDevice, newUser, importBundle, sign, verify, safetyCode, linkCode,
    wrap, unwrap, deviceCtx, siteCtx, newSiteKeyRaw, importSiteKey, sealName, openName,
    rosterCanonical, signRoster, rosterMember, acceptRoster,
    revSigned, revAad, chainHash, genesis, ctHashOf, packDoc, unpackDoc, sealRevision, openRevision,
    newRecoveryCode, parseRecoveryCode, sealEscrow, openEscrow,
    openKeyStore, ksGet, ksPut, ksDel, ksAll, ksReset, ephemeral: () => _ephemeral
};
})();
