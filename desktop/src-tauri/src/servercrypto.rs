// js/servercrypto.js in Rust, for a PC turned into a site monitor
// (docs/SCOPE.md D136, D146, step 7h). A monitor is not a person and never
// builds a document: it only needs to
//
// - keep its own key pair (an ECDH key the site key is wrapped to, an ECDSA
//   key it signs its records with), made here and kept in the keychain
//   (src/keystore.rs);
// - walk the site's signed rosters from the one it was given, so it knows
//   which owners may wrap the site key for it;
// - open the site key wrapped for it (ECIES: ECDH, HKDF-SHA-256, AES-GCM,
//   the A4 header as AAD and signed prefix);
// - seal and sign its records (status, statistics, issues) with the site key,
//   and open and check the people's records (their acts on issues, quiet
//   windows).
//
// Byte for byte the JavaScript's: tests/gen-vectors.mjs's WebCrypto vectors
// open here, and src/testdata/rust_vectors.json, written here, opens in
// js/servercrypto.js (tests/crypto-cross.mjs). Signatures are P1363 (r||s),
// as WebCrypto makes them. ECDH and ECDSA are p256 (RustCrypto); AES-GCM,
// HKDF and the random bytes are ring.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use p256::ecdsa::signature::{Signer, Verifier};
use p256::ecdsa::{Signature, SigningKey, VerifyingKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::hkdf;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const WRAP_ALG: &str = "P256-HKDF256-A256GCM";

// ---- Bytes ----

pub fn b64u(b: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(b)
}

pub fn unb64u(s: &str) -> Result<Vec<u8>, String> {
    if !s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
        return Err("bad-b64".into());
    }
    URL_SAFE_NO_PAD.decode(s.as_bytes()).map_err(|_| "bad-b64".to_string())
}

pub fn sha256(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

/// fp(pub) = the first 22 characters of b64u(SHA-256(raw)).
pub fn fp(raw_b64: &str) -> Result<String, String> {
    Ok(b64u(&sha256(&unb64u(raw_b64)?))[..22].to_string())
}

pub fn random(n: usize) -> Vec<u8> {
    let mut v = vec![0u8; n];
    SystemRandom::new().fill(&mut v).expect("system random");
    v
}

// ---- Keys ----

/// A P-256 secret scalar, made from the system's random bytes (a value out
/// of range, about one in 2^32, is drawn again).
fn new_secret() -> SecretKey {
    loop {
        if let Ok(k) = SecretKey::from_slice(&random(32)) {
            return k;
        }
    }
}

fn pub_raw(k: &PublicKey) -> String {
    b64u(k.to_encoded_point(false).as_bytes())
}

/// A public key as the browsers send it: b64u of the 65-byte raw point.
pub fn import_pub(raw_b64: &str) -> Result<PublicKey, String> {
    let b = unb64u(raw_b64)?;
    if b.len() != 65 || b[0] != 4 {
        return Err("bad-key".into());
    }
    PublicKey::from_sec1_bytes(&b).map_err(|_| "bad-key".to_string())
}

/// A monitor's own keys: `enc` (ECDH, the site key is wrapped to it) and
/// `sig` (ECDSA, its records). Kept as the two secret scalars.
#[derive(Clone)]
pub struct DeviceKeys {
    enc: SecretKey,
    sig: SigningKey,
}

#[derive(Serialize, Deserialize)]
struct KeysFile {
    v: u32,
    enc: String,
    sig: String,
}

impl DeviceKeys {
    pub fn generate() -> DeviceKeys {
        DeviceKeys { enc: new_secret(), sig: SigningKey::from(new_secret()) }
    }
    pub fn enc_pub(&self) -> String {
        pub_raw(&self.enc.public_key())
    }
    pub fn sig_pub(&self) -> String {
        b64u(self.sig.verifying_key().to_encoded_point(false).as_bytes())
    }
    /// The secret, as kept in the keychain (JSON, both scalars b64u).
    pub fn to_secret(&self) -> String {
        serde_json::to_string(&KeysFile { v: 1, enc: b64u(&self.enc.to_bytes()), sig: b64u(&self.sig.to_bytes()) }).unwrap_or_default()
    }
    pub fn from_secret(s: &str) -> Result<DeviceKeys, String> {
        let f: KeysFile = serde_json::from_str(s).map_err(|_| "bad-keys".to_string())?;
        if f.v != 1 {
            return Err("bad-keys".into());
        }
        let enc = SecretKey::from_slice(&unb64u(&f.enc)?).map_err(|_| "bad-keys".to_string())?;
        let sig = SigningKey::from_slice(&unb64u(&f.sig)?).map_err(|_| "bad-keys".to_string())?;
        Ok(DeviceKeys { enc, sig })
    }
    /// From WebCrypto's pkcs8 exports (the tests' vectors).
    #[cfg(test)]
    pub fn from_pkcs8(enc_pkcs8: &[u8], sig_pkcs8: Option<&[u8]>) -> Result<DeviceKeys, String> {
        use p256::pkcs8::DecodePrivateKey;
        let enc = SecretKey::from_pkcs8_der(enc_pkcs8).map_err(|_| "bad-keys".to_string())?;
        let sig = match sig_pkcs8 {
            Some(b) => SigningKey::from(SecretKey::from_pkcs8_der(b).map_err(|_| "bad-keys".to_string())?),
            None => SigningKey::from(new_secret()),
        };
        Ok(DeviceKeys { enc, sig })
    }
    pub fn sign(&self, text: &str) -> String {
        let s: Signature = self.sig.sign(text.as_bytes());
        b64u(&s.to_bytes())
    }
}

// ---- Signatures (P1363) ----

pub fn verify(sig_pub: &str, text: &str, sig_b64: &str) -> bool {
    let Ok(sig) = unb64u(sig_b64) else { return false };
    if sig.len() != 64 {
        return false;
    }
    let Ok(raw) = unb64u(sig_pub) else { return false };
    if raw.len() != 65 || raw[0] != 4 {
        return false;
    }
    let Ok(key) = VerifyingKey::from_sec1_bytes(&raw) else { return false };
    let Ok(sig) = Signature::from_slice(&sig) else { return false };
    key.verify(text.as_bytes(), &sig).is_ok()
}

// ---- AES-256-GCM and HKDF ----

struct Len32;
impl hkdf::KeyType for Len32 {
    fn len(&self) -> usize {
        32
    }
}

fn hkdf32(ikm: &[u8], salt: &[u8], info: &str) -> [u8; 32] {
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, salt).extract(ikm);
    let infos = [info.as_bytes()];
    let okm = prk.expand(&infos, Len32).expect("hkdf length");
    let mut out = [0u8; 32];
    okm.fill(&mut out).expect("hkdf fill");
    out
}

pub fn gcm_seal(key: &[u8], iv: &[u8], aad: &[u8], plain: &[u8]) -> Result<Vec<u8>, String> {
    let k = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, key).map_err(|_| "bad-key".to_string())?);
    let nonce = Nonce::try_assume_unique_for_key(iv).map_err(|_| "bad-iv".to_string())?;
    let mut buf = plain.to_vec();
    k.seal_in_place_append_tag(nonce, Aad::from(aad), &mut buf).map_err(|_| "seal".to_string())?;
    Ok(buf)
}

pub fn gcm_open(key: &[u8], iv: &[u8], aad: &[u8], ct: &[u8]) -> Result<Vec<u8>, String> {
    let k = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, key).map_err(|_| "bad-key".to_string())?);
    let nonce = Nonce::try_assume_unique_for_key(iv).map_err(|_| "bad-iv".to_string())?;
    let mut buf = ct.to_vec();
    let out = k.open_in_place(nonce, Aad::from(aad), &mut buf).map_err(|_| "decrypt".to_string())?;
    Ok(out.to_vec())
}

fn ecdh(secret: &SecretKey, public: &PublicKey) -> [u8; 32] {
    let z = p256::ecdh::diffie_hellman(secret.to_nonzero_scalar(), public.as_affine());
    let mut out = [0u8; 32];
    out.copy_from_slice(z.raw_secret_bytes());
    out
}

// ---- Wraps (ECIES, signed; design §5.3 with A4) ----

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Wrap {
    pub v: u32,
    pub alg: String,
    pub to: String,
    pub ctx: String,
    pub epk: String,
    pub salt: String,
    pub iv: String,
    pub ct: String,
    pub by: Option<String>,
    pub sig: Option<String>,
}

fn wrap_header(w: &Wrap) -> String {
    ["topo-wrap-v1", &w.ctx, &w.to, &w.epk, &w.salt, w.by.as_deref().unwrap_or("")].join("\n")
}

pub fn site_ctx(site: &str, epoch: i64, user: &str) -> String {
    format!("site:{site}|epoch:{epoch}|user:{user}")
}

/// plaintext to `to_pub` (b64u raw), in context ctx, made and signed by `by`.
/// A monitor never wraps a key for anyone; this is the other direction of
/// the shared vectors (Rust wraps, JavaScript opens) and the tests' owner.
#[cfg_attr(not(test), allow(dead_code))]
pub fn wrap(to_pub: &str, ctx: &str, plaintext: &[u8], by: &str, signer: &DeviceKeys) -> Result<Wrap, String> {
    let recipient = import_pub(to_pub)?;
    let eph = new_secret();
    let z = ecdh(&eph, &recipient);
    let salt = random(16);
    let iv = random(12);
    let mut w = Wrap {
        v: 1,
        alg: WRAP_ALG.into(),
        to: fp(to_pub)?,
        ctx: ctx.into(),
        epk: pub_raw(&eph.public_key()),
        salt: b64u(&salt),
        iv: b64u(&iv),
        ct: String::new(),
        by: Some(by.into()),
        sig: None,
    };
    let k = hkdf32(&z, &salt, &format!("topo/v1/wrap\n{ctx}"));
    let header = wrap_header(&w);
    let ct = gcm_seal(&k, &iv, header.as_bytes(), plaintext)?;
    w.ct = b64u(&ct);
    let mut both = iv.clone();
    both.extend_from_slice(&ct);
    w.sig = Some(signer.sign(&format!("{header}\n{}", b64u(&sha256(&both)))));
    Ok(w)
}

/// -> the plaintext, or Err("untrusted-wrap"): addressed to me, the context
/// I expect, signed by one of `signers` (b64u raw ECDSA keys), then opened.
pub fn unwrap(w: &Wrap, me: &DeviceKeys, ctx: &str, signers: &[String]) -> Result<Vec<u8>, String> {
    let fail = || "untrusted-wrap".to_string();
    if w.v != 1 || w.alg != WRAP_ALG {
        return Err(fail());
    }
    if w.to != fp(&me.enc_pub())? || w.ctx != ctx {
        return Err(fail());
    }
    let sig = w.sig.as_deref().ok_or_else(fail)?;
    let iv = unb64u(&w.iv).map_err(|_| fail())?;
    let ct = unb64u(&w.ct).map_err(|_| fail())?;
    let header = wrap_header(w);
    let mut both = iv.clone();
    both.extend_from_slice(&ct);
    let signed = format!("{header}\n{}", b64u(&sha256(&both)));
    if !signers.iter().any(|s| verify(s, &signed, sig)) {
        return Err(fail());
    }
    let epk = import_pub(&w.epk).map_err(|_| fail())?;
    let z = ecdh(&me.enc, &epk);
    let k = hkdf32(&z, &unb64u(&w.salt).map_err(|_| fail())?, &format!("topo/v1/wrap\n{ctx}"));
    gcm_open(&k, &iv, header.as_bytes(), &ct).map_err(|_| fail())
}

// ---- Rosters (design §5.6) ----

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RosterMember {
    pub u: String,
    pub email: String,
    pub role: String,
    pub enc: String,
    pub sig: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Roster {
    pub v: u32,
    pub site: String,
    pub seq: i64,
    pub epoch: i64,
    pub by: String,
    pub at: i64,
    pub members: Vec<RosterMember>,
    pub sig: String,
}

impl Roster {
    pub fn member(&self, u: &str) -> Option<&RosterMember> {
        self.members.iter().find(|m| m.u == u)
    }
}

pub fn roster_canonical(r: &Roster) -> String {
    let mut ms: Vec<&RosterMember> = r.members.iter().collect();
    ms.sort_by(|a, b| a.u.cmp(&b.u));
    let mut lines = vec!["topo-roster-v1".to_string(), r.site.clone(), r.seq.to_string(), r.epoch.to_string(), r.by.clone(), r.at.to_string()];
    for m in ms {
        lines.push(format!("{}|{}|{}|{}|{}", m.u, m.email, m.role, m.enc, m.sig));
    }
    lines.join("\n")
}

/// Is `r` the next roster after the trusted `prev` (None: the first)?
/// `signer_pub` is the ECDSA key the server says `r.by` has; it counts only
/// when its fingerprint is the one the trusted roster names.
pub fn accept_roster(r: &Roster, prev: Option<&Roster>, signer_pub: &str) -> bool {
    if r.v != 1 || r.members.is_empty() {
        return false;
    }
    let line = match prev {
        None => {
            if r.seq != 1 || r.members.len() != 1 || r.members[0].u != r.by || r.members[0].role != "owner" {
                return false;
            }
            &r.members[0]
        }
        Some(p) => {
            if r.site != p.site || r.seq != p.seq + 1 || r.epoch < p.epoch {
                return false;
            }
            match p.member(&r.by) {
                Some(l) if l.role == "owner" => l,
                _ => return false,
            }
        }
    };
    if fp(signer_pub).ok().as_deref() != Some(line.sig.as_str()) {
        return false;
    }
    verify(signer_pub, &roster_canonical(r), &r.sig)
}

// ---- Records (docs/SCOPE.md D158, D159, step 7h) ----
// What a monitor and the people write beside the document: status, the
// statistics of a day, issues, acts on them and quiet windows. Sealed with
// the site key of an epoch, signed by the author (a monitor's device key or
// a person's user key). The header is the AAD; the header and the
// ciphertext's hash are what is signed, and the server checks that
// signature against the author's registered key without reading anything.

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Record {
    pub v: u32,
    pub site: String,
    pub kind: String,
    pub id: String,
    pub epoch: i64,
    pub author: String,
    pub at: i64,
    #[serde(rename = "ctHash")]
    pub ct_hash: String,
    pub sig: String,
    pub iv: String,
    pub ct: String,
}

pub fn record_aad(site: &str, kind: &str, id: &str, epoch: i64, author: &str, at: i64) -> String {
    ["topo-record-v1", site, kind, id, &epoch.to_string(), author, &at.to_string()].join("\n")
}

pub fn record_signed(r: &Record) -> String {
    format!("{}\n{}", record_aad(&r.site, &r.kind, &r.id, r.epoch, &r.author, r.at), r.ct_hash)
}

pub struct RecordHead<'a> {
    pub site: &'a str,
    pub kind: &'a str,
    pub id: &'a str,
    pub epoch: i64,
    pub author: &'a str,
    pub at: i64,
}

pub fn seal_record(h: &RecordHead, site_key: &[u8], signer: &DeviceKeys, plain: &[u8]) -> Result<Record, String> {
    let iv = random(12);
    let aad = record_aad(h.site, h.kind, h.id, h.epoch, h.author, h.at);
    let ct = gcm_seal(site_key, &iv, aad.as_bytes(), plain)?;
    let mut both = iv.clone();
    both.extend_from_slice(&ct);
    let mut r = Record {
        v: 1,
        site: h.site.into(),
        kind: h.kind.into(),
        id: h.id.into(),
        epoch: h.epoch,
        author: h.author.into(),
        at: h.at,
        ct_hash: b64u(&sha256(&both)),
        sig: String::new(),
        iv: b64u(&iv),
        ct: b64u(&ct),
    };
    r.sig = signer.sign(&record_signed(&r));
    Ok(r)
}

/// The record's signature by `author_sig_pub`, its hash, then its plaintext.
pub fn open_record(r: &Record, site_key: &[u8], author_sig_pub: &str) -> Result<Vec<u8>, String> {
    if r.v != 1 {
        return Err("bad-record".into());
    }
    let iv = unb64u(&r.iv)?;
    let ct = unb64u(&r.ct)?;
    let mut both = iv.clone();
    both.extend_from_slice(&ct);
    if b64u(&sha256(&both)) != r.ct_hash {
        return Err("bad-record".into());
    }
    if !verify(author_sig_pub, &record_signed(r), &r.sig) {
        return Err("bad-signature".into());
    }
    let aad = record_aad(&r.site, &r.kind, &r.id, r.epoch, &r.author, r.at);
    gcm_open(site_key, &iv, aad.as_bytes(), &ct)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const JS: &str = include_str!("../../../server/internal/tcrypto/testdata/webcrypto_vectors.json");
    const JS_RECORDS: &str = include_str!("../../../server/internal/tcrypto/testdata/record_vectors.json");

    fn js() -> Value {
        serde_json::from_str(JS).unwrap()
    }

    #[test]
    fn fingerprints_match_webcrypto() {
        let v = js();
        for who in ["owner", "provider"] {
            assert_eq!(fp(v[who]["encPub"].as_str().unwrap()).unwrap(), v[who]["encFp"].as_str().unwrap());
            assert_eq!(fp(v[who]["sigPub"].as_str().unwrap()).unwrap(), v[who]["sigFp"].as_str().unwrap());
        }
        assert_eq!(fp(v["device"]["pub"].as_str().unwrap()).unwrap(), v["device"]["fp"].as_str().unwrap());
    }

    #[test]
    fn webcrypto_rosters_verify_and_walk() {
        let v = js();
        let owner_sig = v["owner"]["sigPub"].as_str().unwrap();
        let r1: Roster = serde_json::from_value(v["rosters"][0]["roster"].clone()).unwrap();
        let r2: Roster = serde_json::from_value(v["rosters"][1]["roster"].clone()).unwrap();
        assert_eq!(roster_canonical(&r1), v["rosters"][0]["canonical"].as_str().unwrap());
        assert!(accept_roster(&r1, None, owner_sig));
        assert!(accept_roster(&r2, Some(&r1), owner_sig));
        // Skipping one, or signed by someone the roster before does not name an owner.
        assert!(!accept_roster(&r2, None, owner_sig));
        assert!(!accept_roster(&r2, Some(&r1), v["provider"]["sigPub"].as_str().unwrap()));
        let mut bad = r2.clone();
        bad.members[0].role = "viewer".into();
        assert!(!accept_roster(&bad, Some(&r1), owner_sig));
    }

    #[test]
    fn opens_a_webcrypto_site_wrap() {
        let v = js();
        let me = DeviceKeys::from_pkcs8(&unb64u(v["provider"]["encPkcs8"].as_str().unwrap()).unwrap(), None).unwrap();
        assert_eq!(me.enc_pub(), v["provider"]["encPub"].as_str().unwrap());
        let w: Wrap = serde_json::from_value(v["siteWrap"].clone()).unwrap();
        let ctx = site_ctx(v["site"].as_str().unwrap(), 1, v["provider"]["id"].as_str().unwrap());
        let owner = vec![v["owner"]["sigPub"].as_str().unwrap().to_string()];
        let key = unwrap(&w, &me, &ctx, &owner).unwrap();
        assert_eq!(b64u(&key), v["siteKey"].as_str().unwrap());
        // The wrong context, an untrusted signer, a changed byte: refused.
        assert!(unwrap(&w, &me, &site_ctx(v["site"].as_str().unwrap(), 2, v["provider"]["id"].as_str().unwrap()), &owner).is_err());
        assert!(unwrap(&w, &me, &ctx, &[v["provider"]["sigPub"].as_str().unwrap().to_string()]).is_err());
        let mut t = w.clone();
        let mut ct = unb64u(&t.ct).unwrap();
        ct[0] ^= 1;
        t.ct = b64u(&ct);
        assert!(unwrap(&t, &me, &ctx, &owner).is_err());
    }

    #[test]
    fn opens_a_webcrypto_revision_with_the_site_key() {
        let v = js();
        let key = unb64u(v["siteKey"].as_str().unwrap()).unwrap();
        let rev = &v["revs"][0]["rev"];
        let aad = [
            "topo-rev-v1".to_string(),
            v["site"].as_str().unwrap().into(),
            rev["n"].to_string(),
            rev["base"].to_string(),
            rev["prev"].as_str().unwrap().into(),
            rev["epoch"].to_string(),
            rev["rseq"].to_string(),
            rev["author"].as_str().unwrap().into(),
            rev["dev"].as_str().unwrap().into(),
            rev["at"].to_string(),
        ]
        .join("\n");
        let plain = gcm_open(&key, &unb64u(rev["iv"].as_str().unwrap()).unwrap(), aad.as_bytes(), &unb64u(rev["ct"].as_str().unwrap()).unwrap()).unwrap();
        assert_eq!(b64u(&plain), v["revs"][0]["plaintext"].as_str().unwrap());
        assert!(verify(v["owner"]["sigPub"].as_str().unwrap(), v["revs"][0]["signed"].as_str().unwrap(), rev["sig"].as_str().unwrap()));
    }

    #[test]
    fn opens_webcrypto_records() {
        let v: Value = serde_json::from_str(JS_RECORDS).unwrap();
        let key = unb64u(v["siteKey"].as_str().unwrap()).unwrap();
        let author = v["monitor"]["sigPub"].as_str().unwrap();
        for item in v["records"].as_array().unwrap() {
            let r: Record = serde_json::from_value(item["record"].clone()).unwrap();
            assert_eq!(record_signed(&r), item["signed"].as_str().unwrap());
            let plain = open_record(&r, &key, author).unwrap();
            assert_eq!(String::from_utf8(plain).unwrap(), item["plaintext"].as_str().unwrap());
            // Another author's key, or a changed header: refused.
            assert!(open_record(&r, &key, v["owner"]["sigPub"].as_str().unwrap()).is_err());
            let mut t = r.clone();
            t.at += 1;
            assert!(open_record(&t, &key, author).is_err());
        }
        // The monitor's keys from WebCrypto's pkcs8 give the same public keys.
        let k = DeviceKeys::from_pkcs8(&unb64u(v["monitor"]["encPkcs8"].as_str().unwrap()).unwrap(), Some(&unb64u(v["monitor"]["sigPkcs8"].as_str().unwrap()).unwrap())).unwrap();
        assert_eq!(k.enc_pub(), v["monitor"]["encPub"].as_str().unwrap());
        assert_eq!(k.sig_pub(), author);
        // And the site key JS wrapped to that monitor opens here.
        let w: Wrap = serde_json::from_value(v["monitorWrap"].clone()).unwrap();
        let got = unwrap(&w, &k, &site_ctx(v["site"].as_str().unwrap(), 1, v["monitor"]["id"].as_str().unwrap()), &[v["owner"]["sigPub"].as_str().unwrap().to_string()]).unwrap();
        assert_eq!(got, key);
    }

    #[test]
    fn keys_round_trip_and_sign() {
        let k = DeviceKeys::generate();
        let again = DeviceKeys::from_secret(&k.to_secret()).unwrap();
        assert_eq!(k.enc_pub(), again.enc_pub());
        assert_eq!(k.sig_pub(), again.sig_pub());
        let s = k.sign("hello");
        assert!(verify(&k.sig_pub(), "hello", &s));
        assert!(!verify(&k.sig_pub(), "hellO", &s));
        assert!(DeviceKeys::from_secret("{\"v\":2}").is_err());
    }

    #[test]
    fn rust_wrap_and_record_round_trip() {
        let owner = DeviceKeys::generate();
        let monitor = DeviceKeys::generate();
        let key = random(32);
        let ctx = site_ctx("s_AAAAAAAAAAAAAAAAAAAAAA", 3, "m_00");
        let w = wrap(&monitor.enc_pub(), &ctx, &key, "u_owner", &owner).unwrap();
        assert_eq!(unwrap(&w, &monitor, &ctx, &[owner.sig_pub()]).unwrap(), key);
        let h = RecordHead { site: "s_AAAAAAAAAAAAAAAAAAAAAA", kind: "status", id: "m_00", epoch: 3, author: "m_00", at: 1 };
        let r = seal_record(&h, &key, &monitor, b"{\"a\":1}").unwrap();
        assert_eq!(open_record(&r, &key, &monitor.sig_pub()).unwrap(), b"{\"a\":1}");
        assert!(open_record(&r, &random(32), &monitor.sig_pub()).is_err());
    }

    /// src/testdata/rust_vectors.json: made here, opened by
    /// js/servercrypto.js in tests/crypto-cross.mjs. The committed file is
    /// checked here every run; TOPO_WRITE_VECTORS=1 writes a new one.
    #[test]
    fn rust_vectors_for_javascript() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/testdata/rust_vectors.json");
        if std::env::var("TOPO_WRITE_VECTORS").ok().as_deref() == Some("1") {
            let owner = DeviceKeys::generate();
            let monitor = DeviceKeys::generate();
            let site = "s_RustRustRustRustRust01";
            let key = random(32);
            let wrap_m = wrap(&monitor.enc_pub(), &site_ctx(site, 1, "m_0123456789abcdef012345"), &key, "u_RustOwnerRustOwner0001", &owner).unwrap();
            let plain = "{\"v\":1,\"items\":{\"n1\":{\"state\":\"down\"}}}";
            let rec = seal_record(&RecordHead { site, kind: "status", id: "m_0123456789abcdef012345", epoch: 1, author: "m_0123456789abcdef012345", at: 1762900000000 }, &key, &monitor, plain.as_bytes()).unwrap();
            let out = serde_json::json!({
                "note": "Written by src/servercrypto.rs (TOPO_WRITE_VECTORS=1 cargo test rust_vectors). Test data only: these keys protect nothing.",
                "site": site,
                "siteKey": b64u(&key),
                "owner": { "id": "u_RustOwnerRustOwner0001", "sigPub": owner.sig_pub() },
                "monitor": { "id": "m_0123456789abcdef012345", "encPub": monitor.enc_pub(), "sigPub": monitor.sig_pub(), "secret": monitor.to_secret() },
                "wrap": wrap_m,
                "record": rec,
                "plaintext": plain,
                "signed": { "text": "topo-test-v1\nhello", "sig": monitor.sign("topo-test-v1\nhello") }
            });
            std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap() + "\n").unwrap();
        }
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let m = DeviceKeys::from_secret(v["monitor"]["secret"].as_str().unwrap()).unwrap();
        assert_eq!(m.sig_pub(), v["monitor"]["sigPub"].as_str().unwrap());
        let w: Wrap = serde_json::from_value(v["wrap"].clone()).unwrap();
        let key = unwrap(&w, &m, &site_ctx(v["site"].as_str().unwrap(), 1, v["monitor"]["id"].as_str().unwrap()), &[v["owner"]["sigPub"].as_str().unwrap().to_string()]).unwrap();
        assert_eq!(b64u(&key), v["siteKey"].as_str().unwrap());
        let r: Record = serde_json::from_value(v["record"].clone()).unwrap();
        assert_eq!(open_record(&r, &key, &m.sig_pub()).unwrap(), v["plaintext"].as_str().unwrap().as_bytes());
    }
}
