// ---- Opening a server backup file (docs/SCOPE.md step 5b, D100, D107) ----
// A Topo server backs up a network as a topo-backup file (server/internal/
// backup/snapshot.go): its newest revision exactly as the server holds it,
// still encrypted, plus what an owner needs to open it:
//   - rev       the revision's header, signature and chain hash, its iv and
//               ciphertext;
//   - rosters   the member list in force for that revision and the newest
//               one, signed as stored;
//   - pubs      the public keys of the people those lists name, only where
//               the key still matches their line;
//   - owners    each owner then, with their locked copy of the network key
//               for that revision (wrap) and their locked recovery copy
//               (escrow), or null when they skipped the recovery key;
//   - originHash  SHA-256 of the server's address, so this page can tell it
//               is on the same server without the file naming it.
// The server cannot read any of it, and neither can the drive company.
//
// This file opens one, here, with or without a server (the website, the
// offline zip, the desktop app):
//   1. structure: the ciphertext hash and the chain hash must match;
//   2. members: on the same server, the lists this browser already trusts
//      for that network must match (a planted list is refused; a list newer
//      than this browser's record is checked like any other); every list
//      whose signer's key is in the file must carry a good signature;
//      trust then starts from whoever opens it (this browser's owner, or the
//      owner whose recovery key was typed) and the lists it already trusts:
//      a list signed by a trusted owner makes its owners trusted, and so on.
//      The network key's wrap and the member list in force must come from
//      that chain; when they do not (a list signed only by an owner this
//      file cannot tie to you), it still opens, and the merge review says
//      plainly that Topo could not confirm who made it;
//   3. the key: this browser's own keys when it is signed in on that server
//      as one of the owners; otherwise the recovery key of one of the
//      owners, typed here. It never leaves the page and nothing is stored;
//   4. the revision is decrypted, its author's signature checked when the
//      author's key is still the one on the list (after a key reset it no
//      longer is: the network still opens, and the merge review says the
//      signature could not be checked), and the network goes to the same
//      door as any file (applyImportedDoc, js/app.js): Merge, Replace with
//      this copy (a restore point first) or Open as a copy; a network not in
//      this browser merges into one or opens as its own. Nothing is written
//      without the review or a restore point.
// Loaded after js/servercrypto.js and before js/app.js.

(function () {
'use strict';

const C = window.TopoServerCrypto;
const T = () => window.TopoServer;
const Y = () => window.TopoServerSync;
const BACKUP_KIND = 'topo-backup';
const BACKUP_REASON = 'Before restoring a backup';
const _hooks = { origin: null };

const isBackupFile = (p) => !!p && typeof p === 'object' && !Array.isArray(p) && p.kind === BACKUP_KIND;

function fail(code, extra) { const e = new Error(code); e.code = code; Object.assign(e, extra || {}); throw e; }

// The words for what went wrong (codes from unlockBackup).
const BACKUP_ERRORS = {
    damaged: 'This backup is damaged or was changed, so it was not opened.',
    newer: 'This backup was made by a newer version of Topo. Update Topo to open it.',
    'roster-mismatch': 'This backup\'s member list does not match the one this browser trusts, so it was not opened.',
    'no-recovery': 'None of this backup\'s owners saved a recovery key. It can be opened only in a browser on its server that still holds an owner\'s keys.',
    'no-crypto': 'This browser cannot open encrypted backups (it needs a secure page: https or this computer).'
};
const backupErrorText = (e) => t(BACKUP_ERRORS[(e && e.code) || ''] || 'This backup could not be opened.');

const isStr = (s) => typeof s === 'string' && s.length > 0 && s.length < 1e8;
const isInt = (n) => Number.isSafeInteger(n) && n >= 0;
function shapeOk(b) {
    const r = b.rev;
    return C.validId(b.site, 's_') && r && typeof r === 'object'
        && ['n', 'base', 'epoch', 'rseq', 'at'].every((k) => isInt(r[k]))
        && ['prev', 'author', 'dev', 'ctHash', 'sig', 'h', 'iv', 'ct'].every((k) => isStr(r[k]))
        && Array.isArray(b.rosters) && b.rosters.length >= 1 && b.rosters.length <= 4
        && Array.isArray(b.owners) && b.owners.length <= 200
        && (!b.pubs || typeof b.pubs === 'object');
}
const rosterOk = (r, site) => !!r && typeof r === 'object' && r.v === 1 && r.site === site && isInt(r.seq) && isInt(r.epoch)
    && typeof r.sig === 'string' && Array.isArray(r.members) && r.members.every((m) => m && typeof m.u === 'string');

// b64u(SHA-256(origin)), as the server writes originHash.
async function originHash(origin) { return C.b64u(await C.sha256(C.utf8(origin))); }
const pageOrigin = () => _hooks.origin || (T() && T()._hooks.origin) || location.origin;

// A key of the file's that matches the person's line in one of `rosters`.
async function matchingPubs(pubs, rosters) {
    const out = {};
    for (const [u, p] of Object.entries(pubs || {})) {
        if (!p || typeof p.encPub !== 'string' || typeof p.sigPub !== 'string') continue;
        let fe, fs;
        try { fe = await C.fp(p.encPub); fs = await C.fp(p.sigPub); } catch (e) { continue; }
        if (rosters.some((r) => { const m = C.rosterMember(r, u); return m && m.enc === fe && m.sig === fs; })) out[u] = { encPub: p.encPub, sigPub: p.sigPub };
    }
    return out;
}
// The signing keys of the owners those lists name (who may have made a wrap).
async function ownerSigners(rosters, pubs) {
    const out = [];
    for (const r of rosters) for (const m of r.members) {
        if (m.role !== 'owner') continue;
        const p = pubs[m.u];
        if (p && (await C.fp(p.sigPub)) === m.sig) out.push(p.sigPub);
    }
    return [...new Set(out)];
}
const ownerLine = (rosters, u) => rosters.map((r) => C.rosterMember(r, u)).find((m) => m && m.role === 'owner') || null;

// Step 2 on the same server: the lists this browser trusts must match. ->
// { pubs: the trust record's keys, matched: the seqs it vouches for }, or
// null when this browser has none for the network. A list newer than the
// record (this browser signed out, or behind) is not refused here: it is
// checked by its signature like any list (anchoredRosters).
async function checkTrusted(b, rosters) {
    if (!Y()) return null;
    let tr = null;
    try { tr = await Y().trust(b.site); } catch (e) { tr = null; }
    if (T().ready()) { try { tr = await Y().walkRosters(b.site); } catch (e) { /* the stored record stands */ } }
    if (!tr || !tr.rosters || !tr.rosters.length) return null;
    const first = tr.rosters[0].seq, last = tr.rosters[tr.rosters.length - 1].seq;
    const matched = new Set();
    for (const r of rosters) {
        if (r.seq < first || r.seq > last) continue;   // outside what this browser keeps
        const mine = tr.rosters.find((x) => x.seq === r.seq);
        if (!mine || mine.sig !== r.sig) fail('roster-mismatch');
        matched.add(r.seq);
    }
    return { pubs: tr.pubs || {}, matched };
}

// The signer's key of list r, when the file has it and it is the one r's
// signer has on that list (or on the list before it, when the file holds it).
async function rosterSignerPub(r, rosters, pubs) {
    const p = pubs[r.by];
    if (!p) return null;
    const prev = rosters.find((x) => x.seq === r.seq - 1);
    const line = C.rosterMember(prev, r.by) || C.rosterMember(r, r.by);
    return line && line.sig === await C.fp(p.sigPub) ? p.sigPub : null;
}
// Every list whose signer's key is in the file must verify under it: a
// changed list is damaged, whatever server it is opened on.
async function checkRosterSigs(rosters, pubs) {
    for (const r of rosters) {
        const k = await rosterSignerPub(r, rosters, pubs);
        if (k && !(await C.verify(k, C.rosterCanonical(r), r.sig))) fail('damaged');
    }
}
// Trust from a starting point (D107): the lists already vouched for
// (matched) and the signing keys of whoever opens the file (seeds). A list
// signed by a trusted key is trusted, and its owners' keys become trusted;
// repeated until nothing more is added. -> { keys: Set of trusted signing
// keys, ok: Set of trusted list seqs }.
async function anchoredRosters(rosters, pubs, seeds, matched) {
    const keys = new Set(seeds.filter(Boolean)), ok = new Set();
    const addOwners = async (r) => {
        for (const m of r.members) {
            const p = pubs[m.u];
            if (m.role === 'owner' && p && (await C.fp(p.sigPub)) === m.sig) keys.add(p.sigPub);
        }
    };
    for (const r of rosters) if (matched && matched.has(r.seq)) { ok.add(r.seq); await addOwners(r); }
    for (let grew = true; grew;) {
        grew = false;
        for (const r of rosters) {
            if (ok.has(r.seq)) continue;
            const k = await rosterSignerPub(r, rosters, pubs);
            if (!k || !keys.has(k) || !(await C.verify(k, C.rosterCanonical(r), r.sig))) continue;
            ok.add(r.seq); grew = true;
            await addOwners(r);
        }
    }
    return { keys, ok };
}
// Unwraps with the trusted keys first, then with any owner's on the lists.
// -> { raw, anchored } or null.
async function unwrapAnchored(wrapObj, opts, trustedKeys, anyKeys) {
    try { return { raw: await C.unwrap(wrapObj, Object.assign({}, opts, { signers: [...trustedKeys] })), anchored: true }; } catch (e) { /* try the wider set */ }
    try { return { raw: await C.unwrap(wrapObj, Object.assign({}, opts, { signers: anyKeys })), anchored: false }; } catch (e) { return null; }
}

// The recovery key, asked for. -> the typed text, or null (cancelled).
// Tests answer through setDialogResponder (kind 'prompt').
function askRecovery(b, rosters, pubs, problem) {
    const lines = b.owners.map((o) => {
        const m = ownerLine(rosters, o.u);
        const who = (m && m.email) || o.u;
        return o.escrow ? '• ' + who : '• ' + t('{email} (no recovery key)', { email: who });
    });
    const made = new Date(b.rev.at || Date.parse(b.made) || 0);
    const msg = [problem ? problem + '\n' : '', t('This backup is locked. Type the recovery key of one of its owners:'), ...lines, '',
        t('This backup is from {date}. Owners added after that are not in it.', { date: made.toLocaleString() })].filter((x, i) => x || i).join('\n');
    return askPrompt(msg.trim(), { title: t('Open a backup'), ok: t('Open'), keys: 'code' });
}

// -> { env, name, at, site, note, how } or throws { code }: 'damaged',
// 'newer', 'roster-mismatch', 'no-recovery', 'no-crypto', 'cancelled'.
// opts.ask(b, rosters, problem) -> text | null, in place of the dialog.
async function unlockBackup(b, opts = {}) {
    if (!isBackupFile(b)) fail('damaged');
    if (typeof b.v === 'number' && b.v > 1) fail('newer');
    if (b.v !== 1 || !shapeOk(b)) fail('damaged');
    if (!(window.crypto && window.crypto.subtle)) fail('no-crypto');
    const site = b.site, rv = b.rev;
    const h = { site, n: rv.n, base: rv.base, prev: rv.prev, epoch: rv.epoch, rseq: rv.rseq, author: rv.author, dev: rv.dev, at: rv.at, ctHash: rv.ctHash };
    // 1. Structure.
    try {
        if (await C.ctHashOf(C.unb64u(rv.iv), C.unb64u(rv.ct)) !== rv.ctHash) fail('damaged');
        if (await C.chainHash(C.revSigned(h), rv.sig) !== rv.h) fail('damaged');
    } catch (e) { fail('damaged'); }
    // 2. Members.
    const rosters = b.rosters.filter((r) => rosterOk(r, site)).sort((x, y) => x.seq - y.seq);
    if (rosters.length !== b.rosters.length) fail('damaged');
    const headR = rosters.find((r) => r.seq === rv.rseq);
    if (!headR || headR.epoch !== rv.epoch) fail('damaged');
    let pubs = await matchingPubs(b.pubs, rosters);
    const server = !!(T() && T().state.on);
    const same = server && typeof b.originHash === 'string' && b.originHash === await originHash(pageOrigin());
    let matched = null;
    if (same) {
        const trusted = await checkTrusted(b, rosters);
        if (trusted) { pubs = Object.assign(await matchingPubs(trusted.pubs, rosters), pubs); matched = trusted.matched; }
    }
    await checkRosterSigs(rosters, pubs);
    const signers = await ownerSigners(rosters, pubs);
    const ctx = (u) => C.siteCtx(site, rv.epoch, u);
    // 3. The key, and where trust starts.
    let key = null, how = '', anchor = null, wrapAnchored = false, viaSiteKey = false;
    if (same && T().ready()) {
        const me = T().me(), K = T().keys();
        const own = b.owners.find((o) => o && o.u === me.id && o.wrap);
        anchor = await anchoredRosters(rosters, pubs, [K.sigPub], matched);
        if (own) {
            const u = await unwrapAnchored(own.wrap, { priv: K.uEnc, pub: K.encPub, ctx: ctx(me.id) }, new Set([...anchor.keys, K.sigPub]), signers.concat([K.sigPub]));
            if (u) { try { key = await C.importSiteKey(u.raw); how = 'own'; wrapAnchored = u.anchored; } catch (e) { key = null; } }
        }
        if (!key && Y() && ownerLine(rosters, me.id)) {
            // The network key this browser already holds: a revision that
            // opens under it was made by a member.
            try { key = await Y().siteKey(site, rv.epoch); how = 'own'; viaSiteKey = true; } catch (e) { key = null; }
        }
    }
    if (!key) {
        const lockable = b.owners.filter((o) => o && typeof o.u === 'string' && o.wrap && o.escrow);
        if (!lockable.length) fail('no-recovery');
        let problem = '';
        for (;;) {
            const text = opts.ask ? await opts.ask(b, rosters, problem) : await askRecovery(b, rosters, pubs, problem);
            if (text === null || text === undefined) fail('cancelled');
            const p = await C.parseRecoveryCode(text);
            if (!p.ok) {
                problem = p.error === 'alphabet' ? t('The code has no i, l, o, 0 or 1.') : t('Check the code: one character is wrong.');
                continue;
            }
            for (const o of lockable) {
                const bundle = await C.openEscrow(p.symbols, o.escrow, o.u);
                if (!bundle) continue;
                let k;
                try { k = await C.importBundle(bundle); } catch (e) { continue; }
                // The keys it opens must be that owner's on the list.
                const line = ownerLine(rosters, o.u);
                if (!line || line.enc !== await C.fp(k.encPub) || line.sig !== await C.fp(k.sigPub)) continue;
                // Trust starts from this owner: their key is genuine (only
                // their recovery key opens their escrow).
                const known = Object.assign({}, pubs, { [o.u]: { encPub: k.encPub, sigPub: k.sigPub } });
                const a = await anchoredRosters(rosters, known, [k.sigPub], matched);
                const u = await unwrapAnchored(o.wrap, { priv: k.enc, pub: k.encPub, ctx: ctx(o.u) }, new Set([...a.keys, k.sigPub]), signers.concat([k.sigPub]));
                try { key = u ? await C.importSiteKey(u.raw) : null; } catch (e) { key = null; }
                if (key) { how = 'recovery'; pubs = known; anchor = a; wrapAnchored = u.anchored; break; }
            }
            if (key) break;
            problem = joinSentences([t('That recovery key does not open this backup.'),
                t('This backup is from {date}. It needs the recovery key its owners had then.', { date: new Date(rv.at).toLocaleDateString() })]);
        }
    }
    // 4. Open.
    let env;
    try { env = await C.unpackDoc(await C.openRevision(h, { iv: rv.iv, ct: rv.ct }, key)); }
    catch (e) { fail('damaged'); }
    if (!env || env.v !== 1 || !env.doc || typeof env.doc !== 'object' || !Array.isArray(env.doc.nodes)) fail('damaged');
    // The author must be an owner or a provider then; their signature is
    // checked when their key is still the one on the list.
    const line = C.rosterMember(headR, rv.author);
    if (!line || (line.role !== 'owner' && line.role !== 'provider')) fail('damaged');
    const ap = pubs[rv.author];
    let note = '';
    if (ap && (await C.fp(ap.sigPub)) === line.sig) {
        if (!(await C.verify(ap.sigPub, C.revSigned(h), rv.sig))) fail('damaged');
    } else note = t('The author\'s signature could not be checked (their keys changed since). The copy opened with the network\'s key, so it was not changed after it was made.');
    // Who made it: the network key and the member list in force must come
    // from the owners trust started from (step 2). Otherwise it is said.
    const anchored = viaSiteKey || (wrapAnchored && !!anchor && anchor.ok.has(headR.seq));
    if (!anchored) note = joinSentences([note, t('Topo could not confirm who made this backup: its member list is not signed by you or by an owner you trust. Restore it only if you expect it.')]);
    // 5. The records not yet folded when the backup was made (a site
    // monitor's issues and the people's acts on them, D159): checked as
    // js/monitors.js checks any record (the author on the file's lists in a
    // role that may write it, its signature, a provider's act on what they
    // cover) and folded in, so a restore loses no open issue or act.
    if (Array.isArray(b.records) && b.records.length && window.TopoMonitors && window.TopoIssues) {
        const keyOf = async (e) => (e === rv.epoch ? key : (Y() ? Y().siteKey(site, e) : Promise.reject(new Error('no-key'))));
        try {
            const recs = await TopoMonitors.backupIssues(b.records, keyOf, rosters, pubs, null, env.doc);
            if (recs.length) env.doc = await TopoIssues.foldRecordsIntoDoc(env.doc, recs);
        } catch (e) { console.warn('Topo: the backup\'s issue records could not be folded:', e); }
    }
    let name = typeof env.name === 'string' ? env.name : '';
    if (!name && typeof b.name === 'string') name = b.name;
    if (!name && b.nameCt && b.nameCt.epoch === rv.epoch) { try { name = (await C.openName(key, site, b.nameCt)) || ''; } catch (e) { name = ''; } }
    return { env, name: name.slice(0, 200), at: rv.at, site, note, how };
}

// The file, opened and handed to the door every file goes through. ->
// whether it took. opts: { fileName, check (only open it and say so),
// mergeInto (a network id: merge it there, through the review) }.
async function openBackupFile(parsed, opts = {}) {
    let res;
    try { res = await unlockBackup(parsed, opts); }
    catch (e) {
        if (e && e.code === 'cancelled') return false;
        if (!e || !e.code) console.warn('Topo: backup', e);
        await tell(backupErrorText(e), { title: t('Open a backup') });
        return false;
    }
    if (opts.check) {
        const n = (res.env.doc.nodes || []).length;
        await tell(joinSentences([t('The backup opens.'), tn(n, '1 device.', '{n} devices.'), res.note]), { title: t('Open a backup') });
        return true;
    }
    const env = res.env;
    const doc = Object.assign({}, env.doc, { id: env.id, updated: res.at }, typeof revisionFields === 'function' ? revisionFields({ rev: env.rev, base: env.base, prior: env.prior }) : {});
    // "A file into this network…": merged into the network it was picked for.
    if (opts.mergeInto && typeof mergeCopyInto === 'function') {
        return mergeCopyInto(opts.mergeInto, doc, { ident: docIdentity(doc), source: 'backup', fileName: opts.fileName || '', reason: BACKUP_REASON, note: res.note, name: res.name });
    }
    return applyImportedDoc({ kind: 'nettopology', version: 1, name: res.name, doc },
        { fileName: opts.fileName || '', source: 'backup', reason: BACKUP_REASON, note: res.note, backup: true });
}

window.isBackupFile = isBackupFile;
window.openBackupFile = openBackupFile;
window.TopoBackupFile = { _hooks, BACKUP_KIND, BACKUP_REASON, isBackupFile, unlockBackup, openBackupFile, backupErrorText, originHash };
})();
