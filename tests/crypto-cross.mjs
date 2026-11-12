// The monitor's encryption both ways (docs/SCOPE.md D136, step 7h):
// js/servercrypto.js, loaded here as the browser loads it, against Rust's
// desktop/src-tauri/src/servercrypto.rs.
//
//   node tests/crypto-cross.mjs          # check both files
//   node tests/crypto-cross.mjs --write  # write record_vectors.json anew
//
// - server/internal/tcrypto/testdata/record_vectors.json is made here with
//   js/servercrypto.js (records sealed by a monitor's keys, the site key
//   wrapped to that monitor by an owner); `cargo test servercrypto` opens it
//   in Rust and `go test ./internal/tcrypto` checks its signatures in Go.
// - desktop/src-tauri/src/testdata/rust_vectors.json is made by Rust
//   (TOPO_WRITE_VECTORS=1 cargo test rust_vectors); it must open here.
// Prints PASS/FAIL lines and exits 1 on any failure.
import { webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
globalThis.window = globalThis;
vm.runInThisContext(readFileSync(join(root, 'js', 'servercrypto.js'), 'utf8'), { filename: 'servercrypto.js' });
const C = globalThis.TopoServerCrypto;
const subtle = globalThis.crypto.subtle;

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log('PASS ::', name); } else { fail++; console.log('FAIL ::', name); } };

const recFile = join(root, 'server', 'internal', 'tcrypto', 'testdata', 'record_vectors.json');
const rustFile = join(root, 'desktop', 'src-tauri', 'src', 'testdata', 'rust_vectors.json');

async function writeRecords() {
    const owner = await C.newUser();
    const mE = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const mS = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const raw = async (k) => C.b64u(new Uint8Array(await subtle.exportKey('raw', k)));
    const pk8 = async (k) => C.b64u(new Uint8Array(await subtle.exportKey('pkcs8', k)));
    const site = C.newId('s_');
    const mid = 'm_' + [...C.random(11)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const ownerId = C.newId('u_');
    const keyRaw = C.newSiteKeyRaw();
    const key = await C.importSiteKey(keyRaw);
    const monitor = { id: mid, encPub: await raw(mE.publicKey), sigPub: await raw(mS.publicKey), encPkcs8: await pk8(mE.privateKey), sigPkcs8: await pk8(mS.privateKey) };
    const monitorWrap = await C.wrap({ toPub: monitor.encPub, ctx: C.siteCtx(site, 1, mid), plaintext: keyRaw, by: ownerId, sigPriv: owner.sig });
    const records = [];
    const kinds = [
        ['status', mid, { v: 1, items: { n1: { state: 'down', since: 1762900000000 } } }],
        ['issue', 'in0123456789', { v: 1, node: 'n1', start: 1762900000000, end: null, behind: ['n2'] }],
        ['stats', mid + '|2026-11-11', { v: 1, day: '2026-11-11', hours: [] }],
    ];
    let at = 1762900000000;
    for (const [kind, id, body] of kinds) {
        const plaintext = JSON.stringify(body);
        const record = await C.sealRecord({ site, kind, id, epoch: 1, author: mid, at: at++ }, key, mS.privateKey, C.utf8(plaintext));
        records.push({ record, signed: C.recordSigned(record), plaintext });
    }
    const out = {
        note: 'Written by tests/crypto-cross.mjs --write with js/servercrypto.js. Test data only: these keys protect nothing.',
        site, siteKey: C.b64u(keyRaw),
        owner: { id: ownerId, encPub: owner.encPub, sigPub: owner.sigPub },
        monitor, monitorWrap, records,
    };
    writeFileSync(recFile, JSON.stringify(out, null, 2) + '\n');
    console.log('wrote', recFile);
}

async function checkRecords() {
    const v = JSON.parse(readFileSync(recFile, 'utf8'));
    const key = await C.importSiteKey(C.unb64u(v.siteKey));
    for (const r of v.records) {
        const plain = C.fromUtf8(await C.openRecord(r.record, key, v.monitor.sigPub));
        check('JS opens its own ' + r.record.kind + ' record', plain === r.plaintext && C.recordSigned(r.record) === r.signed);
        let refused = false;
        try { await C.openRecord(r.record, key, v.owner.sigPub); } catch (e) { refused = e.message === 'bad-signature'; }
        check('a ' + r.record.kind + ' record checked against another key is refused', refused);
    }
}

async function checkRust() {
    const v = JSON.parse(readFileSync(rustFile, 'utf8'));
    const secret = JSON.parse(v.monitor.secret);
    // The monitor's ECDH scalar from Rust, as a WebCrypto key (JWK d, x, y).
    const pub = C.unb64u(v.monitor.encPub);
    const jwk = { kty: 'EC', crv: 'P-256', d: secret.enc, x: C.b64u(pub.slice(1, 33)), y: C.b64u(pub.slice(33)), ext: false };
    const priv = await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const keyRaw = await C.unwrap(v.wrap, { priv, pub: v.monitor.encPub, ctx: C.siteCtx(v.site, 1, v.monitor.id), signers: [v.owner.sigPub] });
    check('JS opens the site key Rust wrapped', C.b64u(keyRaw) === v.siteKey);
    let refused = false;
    try { await C.unwrap(v.wrap, { priv, pub: v.monitor.encPub, ctx: C.siteCtx(v.site, 2, v.monitor.id), signers: [v.owner.sigPub] }); } catch (e) { refused = e.code === 'untrusted-wrap'; }
    check('JS refuses Rust\'s wrap in another context', refused);
    const key = await C.importSiteKey(keyRaw);
    const plain = C.fromUtf8(await C.openRecord(v.record, key, v.monitor.sigPub));
    check('JS opens the record Rust sealed and signed', plain === v.plaintext);
    check('JS verifies a Rust signature', await C.verify(v.monitor.sigPub, v.signed.text, v.signed.sig));
    check('JS refuses a Rust signature over other text', !await C.verify(v.monitor.sigPub, v.signed.text + 'x', v.signed.sig));
    const sPub = C.unb64u(v.monitor.sigPub);
    const sjwk = { kty: 'EC', crv: 'P-256', d: secret.sig, x: C.b64u(sPub.slice(1, 33)), y: C.b64u(sPub.slice(33)), ext: false };
    const spriv = await subtle.importKey('jwk', sjwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const mine = await C.sign(spriv, 'from-js');
    check('Rust\'s signing key, used by JS, verifies against Rust\'s public key', await C.verify(v.monitor.sigPub, 'from-js', mine));
}

if (process.argv.includes('--write')) await writeRecords();
await checkRecords();
await checkRust();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
