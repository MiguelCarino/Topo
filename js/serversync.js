// ---- Keeping a network in step with a Topo server (docs/SCOPE.md step 5a) ----
// A network put on the server is still a card in this browser: it opens,
// edits and saves itself exactly as before, offline too. This file keeps
// the card and the server's copy in step, through the merge the app
// already has (js/merge.js, js/mergeapply.js, js/mergeui.js).
//
// The server holds an ordered list of encrypted revisions per site, each a
// full copy of the network (design §5.5, D63). This browser remembers, per
// card, the last server revision it is built on (`base`: its number n, its
// chain hash h, and the document itself, the base of every three-way
// merge). Then:
//   - pull: newer revisions are fetched, their chain and signatures
//     checked from the pinned one (a server that rolls back or forks the
//     history is caught: 'history-mismatch'), the newest decrypted; with
//     no edits here it simply becomes the card (one undo step on screen, no
//     log entry, no restore point: D64); with edits here it is merged three
//     ways, quietly when nothing conflicts, and otherwise the card says
//     "Needs merge" and the existing review opens on a tap;
//   - push: when the card's content differs from the base (by content
//     hash, amendment C2), it is sealed and sent on top of the base; a 409
//     means someone pushed first: pull, merge, push again. Pushes wait for
//     5 s of quiet, at most 60 s, and go at once on leaving the page,
//     Sync now, a problem sent and a visit recorded (C6).
// The card itself is the offline queue: edits made offline stay in it and
// push when the server is back.
//
// Server numbers never enter the document (D63). The card keeps its own
// revision tokens (js/revisions.js); every server revision carries
// { id, name, rev, base, prior, doc }, so the same token means the same
// content in every browser, and the pulled copies are kept as 'server'
// revisions (at most a few per card, C1).
//
// Where it is kept: an index in localStorage (which cards are on which
// site, their base number and hash; read synchronously by the landing),
// and the base documents in the key store's 'sync' store (IndexedDB, or
// memory). A base lost with a private window is fetched again (C4).

(function () {
'use strict';

const C = window.TopoServerCrypto;
const T = () => window.TopoServer;
const PUSH_QUIET_MS = 5000;
const PUSH_MAX_MS = 60000;
const NEEDS_MERGE_LONG_MS = 24 * 3600 * 1000;
const BUSY_MAX_MS = 15000;
const SERVER_REASON = 'Before merging from the server';
// readableMs: a readable copy at most this often per network (D106);
// readableDelayMs: how long after a sync it is sent.
const _hooks = { quietMs: PUSH_QUIET_MS, maxMs: PUSH_MAX_MS, busyMs: BUSY_MAX_MS, now: () => Date.now(), readableMs: 10 * 60 * 1000, readableDelayMs: 5000 };

// ---- The index ----
const indexKey = () => 'topo-sync:' + (T()._hooks.origin || location.origin);
// Every tab of this browser shares it: a write re-reads the stored copy and
// changes only its own card's record (a tab that is behind never writes
// back other cards' old records), and a 'storage' event from another tab
// brings this tab's copy up to date.
let _index = null;
function readStored() {
    try { return JSON.parse(localStorage.getItem(indexKey()) || '{}') || {}; } catch (e) { return null; }
}
function index() {
    if (_index) return _index;
    _index = readStored() || {};
    return _index;
}
// Brings this tab's records up to `stored`, keeping each record object
// (a sync in flight holds it). -> the card ids whose record changed.
function mergeStored(stored, keep) {
    const cur = index();
    const changed = [];
    for (const id of Object.keys(cur)) if (!(id in stored)) { delete cur[id]; changed.push(id); }
    for (const [id, v] of Object.entries(stored)) {
        if (cur[id] === keep) continue;
        if (!cur[id]) { cur[id] = v; changed.push(id); continue; }
        if (JSON.stringify(cur[id]) === JSON.stringify(v)) continue;
        Object.keys(cur[id]).forEach((k) => { delete cur[id][k]; });
        Object.assign(cur[id], v);
        changed.push(id);
    }
    return changed;
}
function writeStored(fn) {
    const stored = readStored();
    if (!stored) { fn(index()); return; }   // no storage: this tab only
    fn(stored);
    try { localStorage.setItem(indexKey(), JSON.stringify(stored)); } catch (e) { /* this tab only */ }
    return stored;
}
const rec = (cardId) => index()[cardId] || null;
const recBySite = (siteId) => Object.values(index()).find((r) => r.siteId === siteId) || null;
function putRec(r) {
    const stored = writeStored((ix) => { ix[r.cardId] = r; });
    index()[r.cardId] = r;
    if (stored) mergeStored(JSON.parse(JSON.stringify(stored)), r);
}
function dropRec(cardId) {
    const stored = writeStored((ix) => { delete ix[cardId]; });
    delete index()[cardId];
    if (stored) mergeStored(stored);
    C.ksDel('sync', docKey(cardId, 'base')); C.ksDel('sync', docKey(cardId, 'pending')); _docs.delete(cardId + '|base'); _docs.delete(cardId + '|pending');
}
// Another tab wrote the index: take its records, forget the base documents
// cached for the cards it changed (read again from the key store).
function onStorage(e) {
    if (!e || e.key !== indexKey()) return;
    const stored = readStored();
    if (!stored) return;
    const changed = mergeStored(stored);
    changed.forEach((id) => { _docs.delete(id + '|base'); _docs.delete(id + '|pending'); });
    if (changed.length && T() && T().state.on) T().changed();
}
// The cards that are on the server (the landing shows them apart). Empty
// on a page no server served, so the landing is as it always was.
function serverCardIds() {
    if (!T() || !T().state.on) return new Set();
    return new Set(Object.keys(index()).filter((id) => typeof libraryEntry === 'function' && libraryEntry(id)));
}

// ---- Documents kept beside the index ----
const _docs = new Map();
const docKey = (cardId, which) => (T()._hooks.origin || location.origin) + '|' + which + '|' + cardId;
async function getDoc(cardId, which) {
    const k = cardId + '|' + which;
    if (_docs.has(k)) return _docs.get(k);
    const v = await C.ksGet('sync', docKey(cardId, which));
    if (v) _docs.set(k, v);
    return v || null;
}
async function putDoc(cardId, which, v) {
    _docs.set(cardId + '|' + which, v);
    await C.ksPut('sync', docKey(cardId, which), v);
}

// ---- State, for the views ----
function setState(r, st, extra) {
    const was = r.state;
    r.state = st;
    if (st === 'needs-merge' && was !== 'needs-merge') r.needsMergeSince = _hooks.now();
    if (st !== 'needs-merge') delete r.needsMergeSince;
    r.err = extra && extra.err ? extra.err : null;
    putRec(r);
    if (was !== st || (extra && extra.err)) T().changed();
}
// -> { state, changes, since, err } for a card on the server, or null.
function cardSync(cardId) {
    const r = rec(cardId);
    if (!r) return null;
    let st = r.state || 'synced';
    const s = T().site(r.siteId);
    if (T().state.status === 'locked' || T().state.status === 'needs-keys') st = 'locked';
    else if (T().state.status === 'signed-out') st = 'signed-out';
    else if (s && s.status === 'waiting') st = 'waiting';
    // A provider never pushes (D154): edits stay here until Record visit
    // sends them to the owner as a visit copy, which then waits.
    else if (r.role === 'provider' && (st === 'synced' || st === 'pending')) st = visitsWaitingOf(r).length ? 'visit-waiting' : dirty(r) ? 'proposed' : st;
    else if (st === 'synced' && dirty(r)) st = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'pending';
    if (st === 'offline' || (st === 'pending' && navigator.onLine === false)) st = 'offline';
    return { state: st, changes: st === 'offline' ? localChanges(r) : 0, since: r.needsMergeSince || 0, long: !!r.needsMergeSince && _hooks.now() - r.needsMergeSince > NEEDS_MERGE_LONG_MS, err: r.err, role: r.role, siteId: r.siteId };
}
const dirty = (r) => { const card = libraryEntry(r.cardId); return !!card && revHashOf(card.doc) !== r.baseHash; };
function localChanges(r) {
    const base = _docs.get(r.cardId + '|base');
    const card = libraryEntry(r.cardId);
    if (!card) return 0;
    try { return base ? docChangeCount(base.doc, card.doc) : 1; } catch (e) { return 1; }
}

// ---- Trust: rosters and site keys (design §5.3, §5.6) ----
const trustKey = (siteId) => (T()._hooks.origin || location.origin) + '|site|' + siteId;
const _keys = new Map();   // siteId -> Map(epoch -> CryptoKey)
async function trust(siteId) { return (await C.ksGet('trust', trustKey(siteId))) || { rosters: [], pubs: {} }; }
const latest = (t) => t.rosters[t.rosters.length - 1] || null;
// Walks the rosters after the last one trusted. -> the trust record; throws 'untrusted-roster'.
async function walkRosters(siteId) {
    const t = await trust(siteId);
    const last = latest(t);
    const r = await T().api('GET', `/api/sites/${siteId}/rosters?since=${last ? last.seq : 0}`);
    const pubs = Object.assign({}, t.pubs || {}, r.pubs || {});
    let prev = last;
    for (const ro of r.rosters || []) {
        if (!(await C.acceptRoster(ro, prev, pubs))) { const e = new Error('untrusted-roster'); e.code = 'untrusted-roster'; throw e; }
        t.rosters.push(ro);
        prev = ro;
    }
    // Keys whose fingerprints a trusted roster names; nothing else is used.
    t.pubs = {};
    for (const [u, p] of Object.entries(pubs)) t.pubs[u] = p;
    t.rosters = t.rosters.slice(-200);
    await C.ksPut('trust', trustKey(siteId), t);
    return t;
}
// The key a trusted roster names for user u (its line in roster ro), or null.
async function trustedSigPub(t, ro, u) {
    const line = C.rosterMember(ro, u);
    const p = t.pubs && t.pubs[u];
    if (!line || !p || !p.sigPub) return null;
    return (await C.fp(p.sigPub)) === line.sig ? p.sigPub : null;
}
// The owners whose signature a site wrap of `epoch` may carry.
async function wrapSigners(t, epoch) {
    const rosters = [latest(t), [...t.rosters].reverse().find((r) => r.epoch === epoch)].filter(Boolean);
    const out = [];
    for (const ro of rosters) for (const m of ro.members) if (m.role === 'owner') { const k = await trustedSigPub(t, ro, m.u); if (k) out.push(k); }
    return [...new Set(out)];
}
async function siteKeysRaw(siteId) {
    const K = T().keys();
    const t = await walkRosters(siteId);
    const r = await T().api('GET', `/api/sites/${siteId}/keys`);
    const me = T().me();
    const out = new Map();
    for (const w of r.wraps || []) {
        try {
            const raw = await C.unwrap(w.wrap, { priv: K.uEnc, pub: K.encPub, ctx: C.siteCtx(siteId, w.epoch, me.id), signers: await wrapSigners(t, w.epoch) });
            out.set(w.epoch, raw);
        } catch (e) { /* untrusted: not used */ }
    }
    return out;
}
async function siteKey(siteId, epoch, refresh) {
    let m = _keys.get(siteId);
    if (!refresh && m && m.has(epoch)) return m.get(epoch);
    const raws = await siteKeysRaw(siteId);
    m = new Map();
    for (const [e, raw] of raws) m.set(e, await C.importSiteKey(raw));
    _keys.set(siteId, m);
    if (!m.has(epoch)) { const e = new Error('untrusted-wrap'); e.code = 'untrusted-wrap'; throw e; }
    return m.get(epoch);
}

// ---- Members, as the server lists them ----
const _members = new Map();   // siteId -> { at, data }
async function siteDetail(siteId, fresh) {
    const c = _members.get(siteId);
    if (!fresh && c && _hooks.now() - c.at < 30000) return c.data;
    const data = await T().api('GET', `/api/sites/${siteId}`);
    _members.set(siteId, { at: _hooks.now(), data });
    return data;
}

// ---- Pull ----
const fail = (code) => { const e = new Error(code); e.code = code; return e; };
// -> null (nothing new) or { n, h, env, epoch }. Throws 'history-mismatch',
// 'bad-chain', 'untrusted-roster', 'untrusted-wrap', or a ServerError.
async function pullHead(r, opts = {}) {
    const site = r.siteId;
    const fromN = opts.from !== undefined ? opts.from : r.baseN;
    const fromH = opts.from !== undefined ? opts.fromH : r.baseH;
    let revs = [], head = null, body = null, since = fromN;
    for (let i = 0; i < 50; i++) {
        const res = await T().api('GET', `/api/sites/${site}/revs?since=${since}&limit=1000`);
        head = res.head; body = res.body || body;
        revs = revs.concat(res.revs || []);
        if (!res.more || !(res.revs || []).length) break;
        since = res.revs[res.revs.length - 1].n;
    }
    if (head.n < fromN) throw fail('history-mismatch');
    if (head.n === fromN) {
        if (fromN > 0 && head.h !== fromH) throw fail('history-mismatch');
        return null;
    }
    const t = await walkRosters(site);
    const rosterBySeq = new Map(t.rosters.map((ro) => [ro.seq, ro]));
    let prevN = fromN, prevH = fromN === 0 ? await C.genesis(site) : fromH;
    let lastSeq = opts.from !== undefined ? 0 : (r.pinSeq || 0), lastEpoch = 0;
    for (const hd of revs) {
        if (hd.n !== prevN + 1 || hd.base !== prevN) throw fail('bad-chain');
        if (hd.prev !== prevH) throw fail(prevN === fromN ? 'history-mismatch' : 'bad-chain');
        const h = Object.assign({ site }, hd);
        const S = C.revSigned(h);
        if (await C.chainHash(S, hd.sig) !== hd.h) throw fail('bad-chain');
        // Roster and epoch only move forward along the chain (A3), and a
        // revision is signed by an owner or provider of the roster it names.
        const ro = rosterBySeq.get(hd.rseq);
        if (!ro || hd.rseq < lastSeq || hd.epoch < lastEpoch || ro.epoch !== hd.epoch) throw fail('bad-chain');
        const line = C.rosterMember(ro, hd.author);
        if (!line || (line.role !== 'owner' && line.role !== 'provider')) throw fail('bad-chain');
        const pub = await trustedSigPub(t, ro, hd.author);
        if (pub ? !(await C.verify(pub, S, hd.sig)) : hd.n === head.n) throw fail('bad-chain');
        lastSeq = hd.rseq; lastEpoch = hd.epoch;
        prevN = hd.n; prevH = hd.h;
    }
    if (prevN !== head.n || prevH !== head.h || !body || body.n !== head.n) throw fail('bad-chain');
    const hh = revs[revs.length - 1];
    const key = await siteKey(site, hh.epoch);
    let env;
    try { env = await C.unpackDoc(await C.openRevision(Object.assign({ site }, hh), body, key)); }
    catch (e) { throw fail('bad-chain'); }
    if (!env || env.v !== 1 || !env.doc || !Array.isArray(env.doc.nodes)) throw fail('bad-chain');
    return { n: head.n, h: head.h, env, epoch: hh.epoch, rseq: hh.rseq, size: hh.size };
}
// The base document, fetched again when this browser lost it (C4). -> doc or null.
async function refetchBase(r) {
    if (!r.baseN) return null;
    try {
        const res = await T().api('GET', `/api/sites/${r.siteId}/revs/${r.baseN}`);
        const h = Object.assign({ site: r.siteId }, res.rev);
        if (await C.chainHash(C.revSigned(h), res.rev.sig) !== r.baseH) return null;
        const env = await C.unpackDoc(await C.openRevision(h, res.body, await siteKey(r.siteId, res.rev.epoch)));
        await putDoc(r.cardId, 'base', { doc: env.doc, rev: env.rev });
        return env.doc;
    } catch (e) { return null; }
}

// ---- Busy: a field being typed in, a finger on the map (C3) ----
let _pointer = 0;
function busy(cardId) {
    if (state.libraryId !== cardId) return false;
    if (_pointer && _hooks.now() - _pointer < 30000) return true;
    const a = document.activeElement;
    return !!a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && !a.closest('.modal-scrim, #landing');
}
async function waitNotBusy(cardId) {
    const until = _hooks.now() + _hooks.busyMs;
    while (busy(cardId) && _hooks.now() < until) await new Promise((res) => setTimeout(res, 250));
    return !busy(cardId);
}

// ---- Applying what was pulled ----
function cardMetaOf(env, card) {
    return { rev: validRev(env.rev), revHash: revHashOf(env.doc), revAt: card ? card.updated : null, base: validRev(env.base), prior: validPrior(env.prior) };
}
// No edits here: the server's copy becomes the card's.
async function fastForward(r, p) {
    const cardId = r.cardId;
    const open = state.libraryId === cardId;
    if (open && state.readOnly && state.readOnly.viewer) {
        writeMergeToCard(cardId, p.env.doc);
        setCardMeta(cardId, cardMetaOf(p.env, libraryEntry(cardId)));
        replaceDocument(libraryEntry(cardId).doc, { libraryId: cardId, origin: 'library', fit: false });
    } else if (open && isKept()) {
        const before = serializeDoc();
        const ids = new Set((before.nodes || []).map((n) => n.id));
        writeMergeOnScreen(cloneData(p.env.doc), ids);
        setCardMeta(cardId, cardMetaOf(p.env, libraryEntry(cardId)));
        syncDocRevision(libraryEntry(cardId));
        if (typeof refreshLiveEntry === 'function') refreshLiveEntry();
        if (typeof providerMergeArrival === 'function') providerMergeArrival(before);
    } else {
        if (!writeMergeToCard(cardId, cloneData(p.env.doc))) throw fail('storage');
        setCardMeta(cardId, cardMetaOf(p.env, libraryEntry(cardId)));
    }
}
async function setBase(r, p, doc) {
    Object.assign(r, { baseN: p.n, baseH: p.h, baseRev: validRev(p.env.rev), baseHash: revHashOf(doc), epoch: p.epoch, pinSeq: Math.max(r.pinSeq || 0, p.rseq || 0) });
    await putDoc(r.cardId, 'base', { doc: cloneData(doc), rev: p.env.rev });
    putRec(r);
}
// -> 'same' | 'applied' | 'merged' | 'needs-merge' | 'update-needed' | 'deferred'
async function applyPull(r, p) {
    const cardId = r.cardId;
    if (migrateDoc(p.env.doc).newer) {
        await putDoc(cardId, 'pending', { n: p.n, h: p.h, env: p.env, epoch: p.epoch, rseq: p.rseq });
        setState(r, 'update-needed');
        return 'update-needed';
    }
    // This browser's own push, committed on the server though its answer
    // was lost: it becomes the base as it is, never merged with itself.
    const lp = r.lastPush;
    if (lp && validRev(p.env.rev) && p.env.rev === lp.rev && p.n === lp.n && revHashOf(p.env.doc) === lp.hash) {
        delete r.lastPush;
        await setBase(r, p, p.env.doc);
        await putDoc(cardId, 'pending', null);
        setState(r, 'synced');
        return 'own';
    }
    if (typeof recordRevision === 'function' && validRev(p.env.rev)) recordRevision(cardId, p.env.rev, p.env.doc, 'server');
    if (state.libraryId === cardId && isKept()) flushAutosave();
    const card = libraryEntry(cardId);
    if (!card) return 'same';
    const isDirty = revHashOf(card.doc) !== r.baseHash && !(r.role === 'viewer');
    if (!isDirty) {
        if (!(await waitNotBusy(cardId))) return mergeIn(r, p, card);   // still typing: the merge keeps the edit
        await fastForward(r, p);
        await setBase(r, p, p.env.doc);
        await putDoc(cardId, 'pending', null);
        setState(r, 'synced');
        return 'applied';
    }
    return mergeIn(r, p, card);
}
async function mergeIn(r, p) {
    const cardId = r.cardId;
    let base = (await getDoc(cardId, 'base') || {}).doc || null;
    if (r.rebase) { base = p.env.doc; delete r.rebase; putRec(r); }
    if (!base) base = await refetchBase(r);
    const card = libraryEntry(cardId);
    const mine = state.libraryId === cardId && isKept() ? serializeDoc() : card.doc;
    let plan = null;
    try { plan = base ? planMerge(mine, p.env.doc, base) : null; } catch (e) { plan = null; }
    if (plan && mergeConflictKeys(plan) === '') {
        await waitNotBusy(cardId);
        for (let i = 0; i < 2; i++) {
            const res = await commitMerge({ targetId: cardId, theirs: p.env.doc, base, theirsRev: p.env.rev, source: 'server', reason: SERVER_REASON,
                open: false, pointTaken: true, quiet: true, plan: i === 0 ? plan : undefined });
            if (res.ok) {
                await setBase(r, p, p.env.doc);
                await putDoc(cardId, 'pending', null);
                setState(r, 'synced');
                return 'merged';
            }
            if (res.reason !== 'stale') return res.reason === 'busy' ? 'deferred' : needsMerge(r, p);
        }
    }
    return needsMerge(r, p);
}
async function needsMerge(r, p) {
    // The newest server copy waits for the review (C5); the base stays.
    await putDoc(r.cardId, 'pending', { n: p.n, h: p.h, env: p.env, epoch: p.epoch, rseq: p.rseq });
    setState(r, 'needs-merge');
    return 'needs-merge';
}

// ---- Push ----
// What the browser declares when it pushes (D67): one function, from the
// base and the copy pushed. The server cannot read either.
function deriveEvents(baseDoc, doc, members) {
    const byEmail = new Map((members || []).filter((m) => m.status === 'granted' && m.email).map((m) => [String(m.email).toLowerCase(), m]));
    const providerMember = (pid) => {
        const p = ((doc && doc.providers) || []).find((x) => x && x.id === pid);
        const m = p && p.email ? byEmail.get(String(p.email).trim().toLowerCase()) : null;
        return m && (m.role === 'provider' || m.role === 'owner') ? m.user : null;
    };
    const mapIds = (ids) => [...new Set((ids || []).map(providerMember).filter(Boolean))];
    const idx = (s) => (typeof incidentStatusIndex === 'function' ? incidentStatusIndex(s) : ['open', 'sent', 'visited', 'closed'].indexOf(s));
    const baseInc = new Map((((baseDoc && baseDoc.incidents) || [])).filter(Boolean).map((x) => [x.id, x]));
    const out = [];
    ((doc && doc.incidents) || []).filter(Boolean).forEach((x) => {
        const b = baseInc.get(x.id);
        const sentNow = idx(x.status) >= idx('sent') && x.status !== 'closed' && (!b || idx(b.status) < idx('sent'));
        const grew = (x.routedTo || []).filter((pid) => !((b && b.routedTo) || []).includes(pid));
        let to = sentNow ? mapIds(x.routedTo) : (b && idx(x.status) >= idx('sent') && x.status !== 'closed' && grew.length ? mapIds(grew) : []);
        if (to.length) out.push({ kind: 'incident-sent', to });
        if (x.status === 'closed' && b && b.status !== 'closed') {
            to = mapIds(x.routedTo);
            out.push({ kind: 'incident-closed', to });
        }
    });
    const baseLog = new Set((((baseDoc && baseDoc.log) || [])).filter(Boolean).map((e) => e.id));
    ((doc && doc.log) || []).filter((e) => e && e.kind === 'visit' && !baseLog.has(e.id)).forEach((e) => {
        const inc = ((doc.incidents || [])).find((x) => x && x.id === e.incidentId);
        const email = inc && inc.reporter && inc.reporter.email ? String(inc.reporter.email).trim().toLowerCase() : '';
        const m = email ? byEmail.get(email) : null;
        out.push({ kind: 'visit-recorded', to: m ? [m.user] : [] });
    });
    return out.slice(0, 20);
}
// -> 'pushed' | 'same' | 'conflict' (a 409: pull first) | 'refresh' (keys or roster moved)
async function pushCard(r) {
    const cardId = r.cardId;
    if (state.libraryId === cardId && isKept()) flushAutosave();
    const card = libraryEntry(cardId);
    // Only owners write revisions (D139, D154): a viewer looks, a provider's
    // edits go to the owner as a visit copy (uploadVisit).
    if (!card || r.role === 'viewer' || r.role === 'provider') return 'same';
    if (r.baseN > 0 && revHashOf(card.doc) === r.baseHash) return 'same';
    const me = T().me(), K = T().keys();
    const t = await trust(r.siteId);
    const ro = latest(t);
    if (!ro) return 'refresh';
    const ident = stampCard(cardId, 'server');
    const fresh = libraryEntry(cardId);
    if (!ident || !fresh) return 'same';
    const doc = fresh.doc;
    let baseDoc = (await getDoc(cardId, 'base') || {}).doc || null;
    if (!baseDoc && r.baseN > 0) baseDoc = await refetchBase(r);   // C4
    let members = [];
    try { members = (await siteDetail(r.siteId)).members || []; } catch (e) { members = []; }
    // With no base to compare (lost and not fetched again), nothing is
    // declared: every old report and visit would look new.
    const events = r.baseN > 0 && !baseDoc ? [] : deriveEvents(baseDoc, doc, members);
    const plain = await C.packDoc({ v: 1, id: cardId, name: fresh.name, rev: ident.rev, base: ident.base, prior: ident.prior, doc });
    const max = T().state.health && T().state.health.maxRevBytes;
    if (max && plain.length > max) { setState(r, 'error', { err: 'too-large' }); return 'same'; }
    const key = await siteKey(r.siteId, ro.epoch);
    const sealed = await C.sealRevision({ site: r.siteId, n: r.baseN + 1, base: r.baseN, prev: r.baseH, epoch: ro.epoch, rseq: ro.seq, author: me.id, dev: K.deviceId, at: _hooks.now() },
        key, K.uSig, plain);
    const env = sealed.envelope;
    delete env.site;
    // Remembered in case the answer is lost after the server kept it.
    r.lastPush = { n: r.baseN + 1, rev: ident.rev, hash: revHashOf(doc) };
    setState(r, 'pushing');
    try {
        const res = await T().api('POST', `/api/sites/${r.siteId}/revs`, { rev: env, events });
        if (res.h !== sealed.h) throw fail('bad-chain');
        delete r.lastPush;
        await setBase(r, { n: res.n, h: res.h, env: { rev: ident.rev }, epoch: ro.epoch, rseq: ro.seq }, doc);
        setState(r, 'synced');
        return 'pushed';
    } catch (e) {
        if (e.code === 'stale-base' || e.code === 'stale-epoch' || e.code === 'stale-roster') { delete r.lastPush; putRec(r); }
        if (e.code === 'stale-base') return 'conflict';
        if (e.code === 'stale-epoch' || e.code === 'stale-roster') return 'refresh';
        throw e;
    }
}

// ---- One card's sync: pull, then push (design §9.2) ----
const _running = new Map();   // cardId -> promise
const _again = new Set();
function syncCard(cardId, opts = {}) {
    if (_running.has(cardId)) { _again.add(cardId); return _running.get(cardId); }
    const run = (async () => {
        try { return await lockedSync(cardId, opts); }
        finally {
            _running.delete(cardId);
            if (_again.delete(cardId)) syncCard(cardId, opts);
        }
    })();
    _running.set(cardId, run);
    return run;
}
async function lockedSync(cardId, opts) {
    const r = rec(cardId);
    if (!r || !T().ready()) return 'idle';
    // A card open in another tab is that tab's to apply (C8).
    if (state.libraryId !== cardId && openElsewhere(cardId)) return 'elsewhere';
    const locks = navigator.locks;
    if (!locks) return doSync(r, opts);
    let out = 'locked';
    await locks.request('topo-sync-' + r.siteId, { ifAvailable: true }, async (lock) => { if (lock) out = await doSync(r, opts); });
    return out;
}
async function doSync(r, opts) {
    if (['removed', 'history-mismatch', 'update-needed'].includes(r.state) && !opts.force) return r.state;
    const s = T().site(r.siteId);
    if (s && s.status === 'waiting') { setState(r, 'waiting'); return 'waiting'; }
    if (s && s.role && s.role !== r.role) { r.role = s.role; putRec(r); }
    try {
        // A provider takes the owner's answers on its visit copies first
        // (D154, D187): once all are answered the card becomes the server's
        // version as it is, never merged with it first (a merge it is about
        // to replace could only stop it with a question).
        if (r.role === 'provider' && !opts.pull && await providerDecisions(r)) {
            if (r.state !== 'error' && r.state !== 'update-needed') setState(r, 'synced');
            r.lastSyncAt = _hooks.now(); putRec(r);
            return 'pulled';
        }
        for (let round = 0; round < 3; round++) {
            if (r.state !== 'needs-merge' || opts.force) setState(r, 'pulling');
            const p = await pullHead(r);
            if (p) {
                const res = await applyPull(r, p);
                if (res === 'needs-merge' || res === 'update-needed' || res === 'deferred') return res;
                if (res === 'applied' || res === 'merged' || res === 'own') readableAfterSync(r);
            } else if (r.state === 'needs-merge' && await getDoc(r.cardId, 'pending')) { setState(r, 'needs-merge'); return 'needs-merge'; }
            if (opts.pull) { setState(r, 'synced'); return 'pulled'; }
            // A provider syncs read-only (D154).
            if (r.role === 'provider') {
                if (r.state !== 'error') setState(r, 'synced');
                r.lastSyncAt = _hooks.now(); putRec(r);
                return 'pulled';
            }
            const pushed = await pushCard(r);
            if (pushed === 'conflict') continue;
            if (pushed === 'refresh') { _keys.delete(r.siteId); await walkRosters(r.siteId); continue; }
            if (r.state !== 'error') setState(r, 'synced');
            r.lastSyncAt = _hooks.now(); putRec(r);
            if (pushed === 'pushed') readableAfterSync(r);
            // An owner's answers on visit copies go once what they wrote is
            // on the server (the provider then takes that revision).
            if (r.role === 'owner' && (r.decisions || []).length) await flushDecisions(r);
            return pushed;
        }
        setState(r, 'error', { err: 'catch-up' });
        return 'error';
    } catch (e) {
        if (e.offline) { setState(r, 'offline'); return 'offline'; }
        if (e.code === 'history-mismatch') { setState(r, 'history-mismatch'); return 'history-mismatch'; }
        if (e.status === 404) { await T().refreshSites(); setState(r, T().site(r.siteId) ? 'error' : 'removed', { err: 'not-found' }); return 'removed'; }
        if (e.status === 403) {
            await T().refreshSites();
            const s2 = T().site(r.siteId);
            // A role that changed meanwhile (an owner made a provider): the
            // edits stay here, for a visit copy.
            if (e.code === 'owners-only' && s2 && s2.role && s2.role !== r.role) { r.role = s2.role; putRec(r); setState(r, 'synced'); return 'pulled'; }
            setState(r, s2 && s2.status === 'waiting' ? 'waiting' : 'error', { err: e.code });
            return 'error';
        }
        if (e.status === 401) { await T().refreshMe(); T().changed(); return 'signed-out'; }
        console.warn('Topo server: sync', r.cardId, e.code || e);
        setState(r, 'error', { err: e.code || 'error' });
        return 'error';
    }
}
function syncAll() {
    if (!T().ready()) return;
    Object.keys(index()).forEach((id) => { if (libraryEntry(id)) syncCard(id); });
}

// ---- When to push (C6) ----
const _timers = new Map();   // cardId -> { timer, first }
function afterSave(cardId) {
    const r = rec(cardId);
    if (!r || !T().ready() || r.role === 'viewer') return;
    if (r.role === 'provider') { T().changed(); return; }   // nothing to push (D154)
    const now = _hooks.now();
    const t = _timers.get(cardId) || { timer: 0, first: now };
    clearTimeout(t.timer);
    const wait = Math.max(0, Math.min(_hooks.quietMs, t.first + _hooks.maxMs - now));
    t.timer = setTimeout(() => { _timers.delete(cardId); syncCard(cardId); }, wait);
    _timers.set(cardId, t);
    T().changed();
}
function syncNow(cardId) {
    const t = _timers.get(cardId);
    if (t) { clearTimeout(t.timer); _timers.delete(cardId); }
    return syncCard(cardId, { force: true });
}
// -> a promise of every push it started (the idle lock waits on it, D214).
function flushAll() { return Promise.all([..._timers.keys()].map((id) => syncNow(id))).catch(() => false); }

// ---- Several tabs (C8): who has which card open ----
const TAB = Math.random().toString(36).slice(2);
const _open = new Map();   // tab -> { card, at }
let _bc = null;
function presence() {
    if (!_bc) return;
    try { _bc.postMessage({ tab: TAB, card: state.libraryId || null, at: _hooks.now() }); } catch (e) { /* closed */ }
}
const openElsewhere = (cardId) => [..._open.values()].some((o) => o.card === cardId && _hooks.now() - o.at < 30000);

// ---- Events from js/server.js ----
function onHead(siteId) { const r = recBySite(siteId); if (r) syncCard(r.cardId, { pull: false }); }
function onRoster(siteId) {
    const r = recBySite(siteId);
    _members.delete(siteId);
    _visitList.delete(siteId);   // a provider removed takes their copies with them (D191)
    if (r) { syncCard(r.cardId); if (typeof visitsWaitingChanged === 'function') visitsWaitingChanged(r.cardId); }
}
function onGranted(siteId) { _members.delete(siteId); const r = recBySite(siteId); if (r) { setState(r, 'synced'); syncCard(r.cardId); } T().changed(); }
function onRemoved(siteId) {
    const r = recBySite(siteId);
    _keys.delete(siteId); _members.delete(siteId);
    if (r && !T().site(siteId)) setState(r, 'removed');
    T().changed();
}
function signedOut() { _keys.clear(); _members.clear(); T().changed(); }
// Keys reset: every site waits for its owners again; this browser's pins
// of its own sites go (the next grant starts them again).
function keysReset() { _keys.clear(); Object.values(index()).forEach((r) => setState(r, 'waiting')); }

let _opened = false;
async function open() {
    if (_opened) return;
    _opened = true;
    window.addEventListener('storage', onStorage);
    document.addEventListener('pointerdown', () => { _pointer = _hooks.now(); }, true);
    document.addEventListener('pointerup', () => { _pointer = 0; }, true);
    document.addEventListener('pointercancel', () => { _pointer = 0; }, true);
    T().on('online', syncAll);
    T().on('visible', syncAll);
    T().on('hidden', flushAll);
    T().on('hidden', flushReadable);
    if (window.BroadcastChannel) {
        try {
            _bc = new BroadcastChannel('topo-server-tabs');
            _bc.onmessage = (e) => { const m = e.data; if (m && m.tab && m.tab !== TAB) _open.set(m.tab, { card: m.card, at: m.at }); };
            setInterval(presence, 10000);
            window.addEventListener('pagehide', () => { try { _bc.postMessage({ tab: TAB, card: null, at: 0 }); } catch (e) { /* closed */ } });
        } catch (e) { _bc = null; }
    }
    // Cards linked here before: their bases are read back now.
    await Promise.all(Object.keys(index()).map((id) => getDoc(id, 'base')));
}

// ---- Putting a network on the server ----
async function putCard(cardId, opts = {}) {
    const me = T().me(), K = T().keys();
    if (!T().ready() || !me || !me.canCreate) throw fail('forbidden');
    const card = libraryEntry(cardId);
    if (!card || card.template || card.block || migrateDoc(card.doc).newer) throw fail('target');
    if (rec(cardId)) throw fail('conflict');
    const siteId = C.newId('s_');
    const raw = C.newSiteKeyRaw();
    const key = await C.importSiteKey(raw);
    const roster = await C.signRoster({ site: siteId, seq: 1, epoch: 1, by: me.id, at: _hooks.now(), members: [{ u: me.id, email: me.email, role: 'owner', encPub: K.encPub, sigPub: K.sigPub }], sigPriv: K.uSig });
    const wrap = await C.wrap({ toPub: K.encPub, ctx: C.siteCtx(siteId, 1, me.id), plaintext: raw, by: me.id, sigPriv: K.uSig });
    const nameCt = await C.sealName(key, siteId, 1, card.name || '');
    const body = { id: siteId, roster, wrap, nameCt };
    if (opts.showName) { body.showName = true; body.nameClear = card.name || ''; }
    await T().api('POST', '/api/sites', body);
    // The name in file-name form, for the backups' file names (amendment 4).
    if (opts.showName && nameSlugOf(card.name)) { try { await T().api('PATCH', `/api/sites/${siteId}`, { nameSlug: nameSlugOf(card.name) }); } catch (e) { /* the server's own name then */ } }
    _keys.set(siteId, new Map([[1, key]]));
    const r = { cardId, siteId, role: 'owner', baseN: 0, baseH: await C.genesis(siteId), baseRev: null, baseHash: '', epoch: 1, pinSeq: 1, state: 'pushing' };
    putRec(r);
    await T().refreshSites();
    await syncCard(cardId, { force: true });
    T().changed();
    return siteId;
}

// ---- Opening a site from the server on this browser ----
// -> the card id, or null. ask(kind) answers the questions (the UI).
async function openSite(siteId, ask) {
    const known = recBySite(siteId);
    if (known && libraryEntry(known.cardId)) { await openFromLibrary(known.cardId); return known.cardId; }
    const s = T().site(siteId);
    if (!s || s.status !== 'granted') throw fail('waiting');
    const tmp = { siteId, baseN: 0, baseH: await C.genesis(siteId), pinSeq: 0 };
    const p = await pullHead(tmp);
    if (!p) throw fail('empty');
    if (migrateDoc(p.env.doc).newer) throw fail('update-needed');
    // The id comes from the envelope, which the last pusher wrote: a card of
    // this browser linked to another site, or a template or block, is never
    // taken over; the site opens as a new card then.
    let cardId = validRev(p.env.id);
    const linked = cardId ? rec(cardId) : null;
    const same = cardId ? libraryEntry(cardId) : null;
    if (!cardId || (linked && linked.siteId !== siteId) || (same && (same.template || same.block))) cardId = C.newId('n_').replace(/[^A-Za-z0-9_-]/g, '');
    const local = libraryEntry(cardId);
    const r = { cardId, siteId, role: s.role, baseN: p.n, baseH: p.h, baseRev: validRev(p.env.rev), baseHash: revHashOf(p.env.doc), epoch: p.epoch, pinSeq: p.rseq, state: 'synced' };
    if (local) {
        // This browser has the network already, not linked: merged two ways (an unknown base).
        if (ask && !(await ask('merge-local', local))) return null;
        putRec(r);
        await putDoc(cardId, 'base', { doc: cloneData(p.env.doc), rev: p.env.rev });
        const res = await openMergeReview({ targetId: cardId, theirs: p.env.doc, base: null, theirsRev: p.env.rev, source: 'server', reason: SERVER_REASON, open: true });
        if (!res.ok) { await needsMerge(r, p); return cardId; }
        syncCard(cardId);
        return cardId;
    }
    const lib = loadLibrary();
    const now = _hooks.now();
    lib[cardId] = { id: cardId, name: String(p.env.name || '').slice(0, 200) || t('A shared network'), doc: cloneData(p.env.doc), created: now, updated: now };
    applyCardRevision(lib[cardId], cardMetaOf(p.env, lib[cardId]));
    if (!persistLibrary(lib)) throw fail('storage');
    if (typeof recordRevision === 'function' && validRev(p.env.rev)) recordRevision(cardId, p.env.rev, p.env.doc, 'server');
    putRec(r);
    await putDoc(cardId, 'base', { doc: cloneData(p.env.doc), rev: p.env.rev });
    await openFromLibrary(cardId);
    T().changed();
    return cardId;
}

// ---- The review a "Needs merge" card waits for ----
async function reviewMerge(cardId) {
    const r = rec(cardId);
    const pend = r && await getDoc(cardId, 'pending');
    if (!pend || !pend.env) { if (r) syncNow(cardId); return { ok: false, reason: 'nothing' }; }
    let base = (await getDoc(cardId, 'base') || {}).doc || null;
    if (!base) base = await refetchBase(r);
    const res = await openMergeReview({ targetId: cardId, theirs: pend.env.doc, base, theirsRev: pend.env.rev, source: 'server', reason: SERVER_REASON, open: true });
    if (res.ok) {
        await setBase(r, pend, pend.env.doc);
        await putDoc(cardId, 'pending', null);
        setState(r, 'synced');
        syncNow(cardId);
    }
    return res;
}
// "Trust the server's history" after a mismatch: the server's head becomes
// the base, this browser's copy is merged onto it.
async function trustServerHistory(cardId) {
    const r = rec(cardId);
    if (!r) return;
    console.warn('Topo server: trusting the server\'s history for', r.siteId, 'over the pinned', r.baseN, r.baseH);
    // This browser's copy is kept whole: it is merged onto the server's head
    // as if it had been made from it (rebase), then pushed.
    r.baseN = 0; r.baseH = await C.genesis(r.siteId); r.pinSeq = 0; r.baseHash = ''; r.rebase = true;
    setState(r, 'synced');
    return syncNow(cardId);
}

// ---- Removing a card ----
// how: 'local' (this browser only; it stays on the server) or 'everyone' (an owner deletes the site).
async function removeCard(cardId, how) {
    const r = rec(cardId);
    if (r && how === 'everyone') await T().api('DELETE', `/api/sites/${r.siteId}`);
    if (r) dropRec(cardId);
    libraryDelete(cardId);
    if (state.libraryId === cardId) releaseDocument();
    if (how === 'everyone') await T().refreshSites();
    T().changed();
}
// Keep the copy as its own network (a viewer's edits, a removed member).
function unlinkCard(cardId) { dropRec(cardId); T().changed(); }

// ---- Members: grant, roles, remove, rotate (design §4.6, D60-D62) ----
async function memberPubs(siteId) {
    const d = await siteDetail(siteId, true);
    return d;
}
// Every member who stays must carry the keys the trusted roster names for
// them: the member list comes from the server, which could swap a member's
// keys and have this owner sign them (and, on a rotation, wrap the new key
// to them). Newcomers (`fresh`, given access now) are checked by their
// safety code instead. Throws 'keys-changed'.
async function checkContinuing(t, members, fresh) {
    const last = latest(t);
    for (const m of members) {
        if (fresh && fresh.has(m.u)) continue;
        const line = C.rosterMember(last, m.u);
        if (!line) throw fail('keys-changed');   // not in the trusted roster: only a grant adds people
        if (!m.encPub || !m.sigPub || (await C.fp(m.encPub)) !== line.enc || (await C.fp(m.sigPub)) !== line.sig) throw fail('keys-changed');
    }
}
async function nextRoster(siteId, epoch, members, fresh) {
    const me = T().me(), K = T().keys();
    const t = await walkRosters(siteId);
    const last = latest(t);
    await checkContinuing(t, members, fresh);
    return C.signRoster({ site: siteId, seq: last.seq + 1, epoch: epoch || last.epoch, by: me.id, at: _hooks.now(), members, sigPriv: K.uSig });
}
const grantedOf = (d) => (d.members || []).filter((m) => m.status === 'granted').map((m) => ({ u: m.user, email: m.email, role: m.role, encPub: m.encPub, sigPub: m.sigPub }));
// users: the waiting member ids to give access; history: the older epochs too (D61).
async function grant(siteId, users, opts = {}) {
    const me = T().me(), K = T().keys();
    const d = await memberPubs(siteId);
    const raws = await siteKeysRaw(siteId);
    const epoch = d.site.epoch;
    if (!raws.has(epoch)) throw fail('untrusted-wrap');
    const grantees = (d.members || []).filter((m) => users.includes(m.user) && m.status === 'waiting');
    if (!grantees.length) throw fail('conflict');
    if (grantees.some((m) => !m.encPub)) throw fail('no-keys');
    const members = grantedOf(d).concat(grantees.map((m) => ({ u: m.user, email: m.email, role: m.role, encPub: m.encPub, sigPub: m.sigPub })));
    const roster = await nextRoster(siteId, epoch, members, new Set(grantees.map((m) => m.user)));
    const wraps = [];
    for (const m of grantees) {
        const epochs = opts.history === false ? [epoch] : [...raws.keys()].filter((e) => e <= epoch);
        for (const e of epochs) wraps.push({ user: m.user, epoch: e, wrap: await C.wrap({ toPub: m.encPub, ctx: C.siteCtx(siteId, e, m.user), plaintext: raws.get(e), by: me.id, sigPriv: K.uSig }) });
        await T().pinPerson(m.user, m.encPub, m.sigPub, !!opts.checked);
    }
    await T().api('POST', `/api/sites/${siteId}/grant`, { roster, wraps });
    await afterMembers(siteId);
}
async function setRole(siteId, user, role) {
    const d = await memberPubs(siteId);
    const target = (d.members || []).find((m) => m.user === user);
    if (!target) throw fail('not-found');
    const body = { role };
    if (target.status === 'granted') {
        const members = grantedOf(d).map((m) => (m.u === user ? Object.assign(m, { role }) : m));
        body.roster = await nextRoster(siteId, d.site.epoch, members);
    }
    await T().api('POST', `/api/sites/${siteId}/members/${user}/role`, body);
    await afterMembers(siteId);
}
// A new epoch for `remaining` (a removal, or after someone left): a new
// site key, wrapped for each of them, the name sealed again (D62).
async function newEpoch(siteId, d, remaining, name) {
    const me = T().me(), K = T().keys();
    const epoch = d.site.epoch + 1;
    const raw = C.newSiteKeyRaw();
    const key = await C.importSiteKey(raw);
    const roster = await nextRoster(siteId, epoch, remaining);
    const wraps = [];
    for (const m of remaining) wraps.push({ user: m.u, epoch, wrap: await C.wrap({ toPub: m.encPub, ctx: C.siteCtx(siteId, epoch, m.u), plaintext: raw, by: me.id, sigPriv: K.uSig }) });
    const nameCt = await C.sealName(key, siteId, epoch, name || '');
    return { roster, wraps, nameCt, key, epoch };
}
async function siteName(siteId) {
    const s = T().site(siteId);
    if (s && s.nameCt) {
        try { const n = await C.openName(await siteKey(siteId, s.nameCt.epoch), siteId, s.nameCt); if (n !== null) return n; } catch (e) { /* below */ }
    }
    const r = recBySite(siteId);
    const card = r && libraryEntry(r.cardId);
    return card ? card.name : '';
}
async function removeMember(siteId, user) {
    const d = await memberPubs(siteId);
    const target = (d.members || []).find((m) => m.user === user);
    if (!target) throw fail('not-found');
    // A member the trusted roster names may hold the current key even while
    // waiting (they reset their keys): removing them rotates too.
    const named = !!C.rosterMember(latest(await walkRosters(siteId)), user);
    if (target.status !== 'granted' && !named) {
        await T().api('POST', `/api/sites/${siteId}/remove`, { user });
    } else {
        const remaining = grantedOf(d).filter((m) => m.u !== user);
        const e = await newEpoch(siteId, d, remaining, await siteName(siteId));
        await T().api('POST', `/api/sites/${siteId}/remove`, { user, roster: e.roster, wraps: e.wraps, nameCt: e.nameCt });
        _keys.delete(siteId);
    }
    await afterMembers(siteId);
}
async function rotate(siteId) {
    const d = await memberPubs(siteId);
    const e = await newEpoch(siteId, d, grantedOf(d), await siteName(siteId));
    await T().api('POST', `/api/sites/${siteId}/rotate`, { roster: e.roster, wraps: e.wraps, nameCt: e.nameCt });
    _keys.delete(siteId);
    await afterMembers(siteId);
}
async function invite(siteId, email, role, lang) {
    await T().api('POST', `/api/sites/${siteId}/invites`, { email, role, lang });
    await afterMembers(siteId);
}
async function setShowName(siteId, show) {
    const body = { showName: !!show };
    if (show) { body.nameClear = await siteName(siteId); const slug = nameSlugOf(body.nameClear); if (slug) body.nameSlug = slug; }
    await T().api('PATCH', `/api/sites/${siteId}`, body);
    await T().refreshSites();
}
async function leave(siteId) {
    await T().api('POST', `/api/sites/${siteId}/leave`);
    const r = recBySite(siteId);
    if (r) dropRec(r.cardId);
    await T().refreshSites();
}
async function afterMembers(siteId) {
    _members.delete(siteId);
    await T().refreshSites();
    const r = recBySite(siteId);
    if (r) syncCard(r.cardId);
}

// ---- Backups on the server (docs/SCOPE.md step 5b, D106, D107) ----
// The name as backup files say it (fileSlug, js/report.js), within the
// server's 180 bytes; '' when there is none.
function nameSlugOf(name) {
    if (typeof fileSlug !== 'function') return '';
    let s = fileSlug(name || '', '');
    while (s && new TextEncoder().encode(s).length > 180) s = s.slice(0, -1).replace(/-+$/, '');
    return s;
}
// The readable copy (D106). The server cannot read the network, so when its
// owner asked for a readable copy too, an owner's browser makes it: after a
// sync that moved the network, at most every readableMs per network, the
// same file Download a back-up gives (networkJsonFile, js/restore.js) of the
// copy the server holds now (the base), sent with its revision number. The
// server refuses it when the network moved on meanwhile ('stale'), and
// writes nothing it is not allowed to.
const _readable = new Map();   // siteId -> { timer, last, cardId }
function readableAfterSync(r) {
    if (!r || r.role !== 'owner' || !T().ready()) return;
    // Known to be off (the cached site detail): nothing to send, no fetch.
    const c = _members.get(r.siteId);
    const cb = c && c.data && c.data.backups;
    if (cb && !(cb.on && cb.readable && cb.readableAllowed)) return;
    const st = _readable.get(r.siteId) || { timer: 0, last: 0, cardId: r.cardId };
    st.cardId = r.cardId;
    _readable.set(r.siteId, st);
    if (st.timer) return;
    const wait = Math.max(_hooks.readableDelayMs, st.last + _hooks.readableMs - _hooks.now());
    st.timer = setTimeout(() => { st.timer = 0; sendReadable(st.cardId).catch(() => {}); }, wait);
}
function flushReadable() {
    _readable.forEach((st) => { if (st.timer) { clearTimeout(st.timer); st.timer = 0; sendReadable(st.cardId).catch(() => {}); } });
}
// -> 'sent' | 'off' | 'idle' | 'stale' | an error code.
async function sendReadable(cardId) {
    const r = rec(cardId);
    if (!r || r.role !== 'owner' || !T().ready() || !r.baseN) return 'idle';
    const d = await siteDetail(r.siteId, true);
    const b = d && d.backups;
    if (!b || !b.on || !b.readable || !b.readableAllowed) {
        // Off: the throttle still counts, so the next sync does not ask again at once.
        const st0 = _readable.get(r.siteId);
        if (st0) st0.last = _hooks.now();
        return 'off';
    }
    const base = (await getDoc(cardId, 'base')) || {};
    const doc = base.doc || await refetchBase(r);
    if (!doc) return 'idle';
    const card = libraryEntry(cardId);
    const f = networkJsonFile((card && card.name) || '', cardId, (card && card.updated) || _hooks.now(), doc, todayISO(new Date(_hooks.now())), { rev: base.rev });
    const st = _readable.get(r.siteId) || { timer: 0, last: 0, cardId };
    _readable.set(r.siteId, st);
    try {
        await T().api('POST', `/api/sites/${r.siteId}/backups/readable`, { revN: r.baseN, fileName: f.fileName, file: withTopoSchema(f.payload) });
        st.last = _hooks.now();
        return 'sent';
    } catch (e) {
        // Someone pushed meanwhile: the next sync sends the newer one.
        if (e.code === 'stale') return 'stale';
        return e.code || 'error';
    }
}
// The site owner's switch (Members, Backups), and Delete readable copies.
async function setReadable(siteId, on) {
    await T().api('PATCH', `/api/sites/${siteId}`, { backupReadable: !!on });
    _members.delete(siteId);
    const r = recBySite(siteId);
    if (on && r) readableAfterSync(r);
}
async function deleteReadable(siteId) { await T().api('DELETE', `/api/sites/${siteId}/backups/readable`); }
async function siteBackups(siteId) { return ((await T().api('GET', `/api/sites/${siteId}/backups`)) || {}).backups || []; }

// ---- The provider on the server (D75) ----
function onDocLoaded() {
    const r = state.libraryId ? rec(state.libraryId) : null;
    presence();
    if (!r || !T() || !T().state.on) return;
    if (r.role === 'viewer' && !state.readOnly) {
        // A viewer looks; nothing they change is kept or pushed (E5).
        state.readOnly = { doc: cloneData(serializeDoc()), loaded: JSON.stringify(serializeDoc()), viewer: true };
        renderReadOnly();
        renderDocBar();
    }
    const me = T().me();
    if (r.role === 'provider' && me && typeof providerSelfOf === 'function' && !providerSelfOf(state.docId)) {
        const p = (state.providers || []).find((x) => x && x.email && String(x.email).trim().toLowerCase() === String(me.email).toLowerCase());
        if (p) setProviderSelf(state.docId, p.id);
    }
}
// A report sent from a card on the server, to providers who are all
// members there: no link to send, the server emails them.
function sendRoute(cardId, providerIds) {
    const r = cardId ? rec(cardId) : null;
    if (!r || !T().ready() || r.role === 'viewer') return null;
    const c = _members.get(r.siteId);
    const members = (c && c.data && c.data.members) || [];
    const names = [];
    for (const pid of providerIds || []) {
        const p = (state.providers || []).find((x) => x && x.id === pid);
        const m = p && p.email ? members.find((x) => x.status === 'granted' && String(x.email).toLowerCase() === String(p.email).trim().toLowerCase()) : null;
        if (!m) return null;
        names.push(p.name || p.id);
    }
    return names.length ? { names } : null;
}
// A report from a card on the server to providers who are not all members
// (D87): the link path, and then the server emails it when it can send
// mail (/api/me's mailRelay). -> { siteId, relay } or null (not on the
// server, a viewer, signed out).
function mailRoute(cardId) {
    const r = cardId ? rec(cardId) : null;
    if (!r || !T().ready() || r.role === 'viewer') return null;
    const me = T().me();
    return { siteId: r.siteId, relay: !!(me && me.mailRelay) };
}
// POST /api/sites/{id}/report-mail; a ServerError when refused.
const reportMail = (siteId, body) => T().api('POST', '/api/sites/' + encodeURIComponent(siteId) + '/report-mail', body);
// Members known before the send step asks (the detail is cached for sendRoute).
function warmMembers(cardId) { const r = cardId && rec(cardId); if (r && T().ready()) siteDetail(r.siteId).catch(() => {}); }
const returnRoute = (cardId) => { const r = cardId ? rec(cardId) : null; return !!r && T().ready() && r.role !== 'viewer'; };
const provider = { sendRoute, returnRoute, warmMembers, mailRoute, reportMail };

// ---- Provider visits through the owner (docs/SCOPE.md D139, D153, D154) ----
// A provider member never pushes. Record visit uploads a visit copy: the
// card as it is, sealed with the site key and signed, on top of the server
// revision the card is built on (r.baseN), for the report (slot: a hash of
// the site, the report and the provider, so the server learns neither). It
// waits for an owner, every time. One copy per provider and report: a new
// one replaces the one waiting. Once an owner has answered every copy of
// theirs, the provider's browser takes the server's version (a rejected
// copy, or edits the owner never got, offered as a file first) and deletes
// its copies.
const visitsWaitingOf = (r) => Object.values((r && r.visits) || {}).filter((v) => v && v.state === 'waiting');
async function visitSlot(siteId, incidentId, providerId) {
    return C.b64u(await C.sha256(C.utf8(['topo-visit-slot-v1', siteId, incidentId || '', providerId || ''].join('\n')))).slice(0, 22);
}
// info: { incidentId, providerId }. -> the copy's header; throws a
// ServerError or 'forbidden' | 'needs-merge' | 'storage'.
async function uploadVisit(cardId, info = {}) {
    const r = rec(cardId);
    if (!r || r.role !== 'provider' || !T().ready()) throw fail('forbidden');
    if (state.libraryId === cardId && isKept()) flushAutosave();
    // Built on the newest revision first: a merge here keeps the edits. A
    // pull only: the owner's answers on older copies wait for the next sync.
    await syncCard(cardId, { force: true, pull: true });
    if (r.state === 'needs-merge') throw fail('needs-merge');
    const me = T().me(), K = T().keys();
    const slot = await visitSlot(r.siteId, info.incidentId, info.providerId);
    for (let round = 0; round < 2; round++) {
        const t = await trust(r.siteId);
        const ro = latest(t);
        if (!ro) throw fail('untrusted-roster');
        const ident = stampCard(cardId, 'server');
        const card = libraryEntry(cardId);
        if (!ident || !card) throw fail('storage');
        const plain = await C.packDoc({ v: 1, kind: 'visit', id: cardId, name: card.name, rev: ident.rev, base: ident.base, prior: ident.prior, doc: card.doc,
            baseN: r.baseN, incidentId: info.incidentId || null, providerId: info.providerId || null });
        const max = T().state.health && T().state.health.maxRevBytes;
        if (max && plain.length > max) throw fail('too-large');
        const key = await siteKey(r.siteId, ro.epoch);
        const env = await C.sealVisit({ site: r.siteId, id: C.newId('v_'), slot, baseN: r.baseN, epoch: ro.epoch, rseq: ro.seq, author: me.id, dev: K.deviceId, at: _hooks.now() },
            key, K.uSig, plain);
        delete env.site;
        try {
            const res = await T().api('POST', `/api/sites/${r.siteId}/visits`, { copy: env });
            const held = {};
            Object.values(r.visits || {}).forEach((v) => { if (v && v.id && !(v.slot === slot && v.state === 'waiting')) held[v.id] = v; });
            held[env.id] = { id: env.id, slot, state: 'waiting', at: _hooks.now() };
            r.visits = held;
            putRec(r);
            T().changed();
            return res.visit;
        } catch (e) {
            if ((e.code === 'stale-epoch' || e.code === 'stale-roster') && round === 0) { _keys.delete(r.siteId); await walkRosters(r.siteId); continue; }
            throw e;
        }
    }
    throw fail('catch-up');
}
// The provider's side of the owner's answers (doSync, before its pull):
// the copies' states, then, when none is waiting any more and one was
// answered, the server's version taken. -> true when it was taken.
async function providerDecisions(r) {
    const me = T().me();
    let list;
    try { list = ((await T().api('GET', `/api/sites/${r.siteId}/visits`)) || {}).visits || []; }
    catch (e) { return false; }
    const mine = list.filter((v) => me && v.author === me.id);
    r.visits = {};
    mine.forEach((v) => { r.visits[v.id] = { id: v.id, slot: v.slot, state: v.state, at: v.received }; });
    putRec(r);
    const decided = mine.filter((v) => v.state === 'approved' || v.state === 'rejected');
    if (!decided.length || mine.some((v) => v.state === 'waiting')) { T().changed(); return false; }
    const p = await pullHead(r);
    const rejected = decided.some((v) => v.state === 'rejected');
    const lost = rejected ? 0 : await providerUnsent(r, p);
    if (rejected || lost) await offerOwnCopy(r, rejected ? 'rejected' : 'unsent');
    await takeServerVersion(r, p);
    for (const v of decided) { try { await T().api('DELETE', `/api/sites/${r.siteId}/visits/${v.id}`); } catch (e) { /* the next sync */ } }
    r.visits = {};
    putRec(r);
    if (typeof showToast === 'function') showToast(rejected ? t('The owner did not accept your visit. This network now follows the site again.') : t('The owner approved your visit.'), rejected ? '' : 'ok');
    T().changed();
    return true;
}
// What taking the server's version would lose (D187): the parts the
// provider changed since the revision the card is built on that the
// server's version does not have as the provider left them (edits made
// after the upload with no new Record visit, and rows the owner left out),
// and a visit recorded here that the server's version has not got. A
// report the owner judged in the same revisions is the owner's answer, not
// a loss. p: pullHead's result (null: the head is the card's base). -> a
// count.
async function providerUnsent(r, p) {
    const card = libraryEntry(r.cardId);
    if (!card || !card.doc) return 0;
    const base = ((await getDoc(r.cardId, 'base')) || {}).doc || null;
    const head = p ? p.env.doc : base;
    if (!head) return revHashOf(card.doc) !== r.baseHash ? 1 : 0;
    const headLog = (head.log || []).filter(Boolean);
    const baseLogIds = new Set(((base && base.log) || []).filter(Boolean).map((e) => e.id));
    const judged = new Set(headLog.filter((e) => e.kind === 'decision' && !baseLogIds.has(e.id) && e.incidentId).map((e) => 'incidents:' + e.incidentId));
    let n = 0;
    try {
        const mineParts = base ? docChangeParts(base, card.doc) : null;
        const differ = docChangeParts(head, card.doc);
        differ.forEach((part) => { if ((!mineParts || mineParts.has(part)) && !judged.has(part)) n++; });
    } catch (e) { n = revHashOf(card.doc) !== r.baseHash ? 1 : 0; }
    const onServer = new Set(headLog.map((e) => e.id));
    n += ((card.doc.log) || []).filter((e) => e && e.kind === 'visit' && !onServer.has(e.id)).length;
    return n;
}
// Before the server's version replaces the card: the card as a file, if
// the provider wants it. why: 'rejected' | 'unsent'. -> the file name or ''.
async function offerOwnCopy(r, why) {
    const card = libraryEntry(r.cardId);
    if (!card) return '';
    const msg = why === 'rejected'
        ? t('The owner did not accept your visit, so this network goes back to the site\'s version. Keep your copy as a file first?')
        : t('The owner answered your visit. This network now goes back to the site\'s version, which does not have your later changes. Keep your copy as a file first?');
    const ask = _hooks.ask || ((m, o) => (typeof askChoice === 'function' ? askChoice(m, o) : Promise.resolve(null)));
    const answer = await ask(msg, { title: t('Your visit'), choices: [{ id: 'file', label: t('Download my copy'), primary: true }, { id: 'no', label: t('Not now') }], why });
    if (answer !== 'file') return '';
    const f = networkJsonFile(card.name || '', r.cardId, card.updated || _hooks.now(), card.doc, todayISO(new Date(_hooks.now())), { rev: card.rev });
    const fileName = f.fileName.replace(/\.json$/, '_my-visit.json');
    if (typeof downloadJson === 'function') downloadJson(f.payload, fileName);
    return fileName;
}
// The card becomes the server's version as it is (the base when nothing is
// newer): on screen, one undo step.
async function takeServerVersion(r, pulled) {
    if (state.libraryId === r.cardId && isKept()) flushAutosave();
    const p = pulled !== undefined ? pulled : await pullHead(r);
    if (p) {
        if (migrateDoc(p.env.doc).newer) { await putDoc(r.cardId, 'pending', { n: p.n, h: p.h, env: p.env, epoch: p.epoch, rseq: p.rseq }); setState(r, 'update-needed'); return; }
        await fastForward(r, p);
        await setBase(r, p, p.env.doc);
    } else {
        let b = await getDoc(r.cardId, 'base');
        if (!b || !b.doc) { const d = await refetchBase(r); b = d ? { doc: d, rev: null } : null; }
        if (!b) return;
        await fastForward(r, { env: { doc: cloneData(b.doc), rev: b.rev || null } });
        r.baseHash = revHashOf(libraryEntry(r.cardId).doc);
        putRec(r);
    }
    await putDoc(r.cardId, 'pending', null);
    setState(r, 'synced');
}

// ---- The owner's side ----
// The copies on a site, oldest first (headers; the owner's list holds every
// provider's, a provider's their own).
async function siteVisits(siteId) { return ((await T().api('GET', `/api/sites/${siteId}/visits`)) || {}).visits || []; }
// One copy opened: its signature checked against the trusted roster (its
// author a provider of the roster it names), decrypted, and its base (the
// server revision it was made on) with it. -> { env, base (a document, or
// null when the server pruned it: two-way), baseRev, author, email }.
// Throws 'bad-chain' (a copy that does not check out) or a ServerError.
async function openVisitCopy(siteId, hd, opts = {}) {
    const t = await walkRosters(siteId);
    const ro = t.rosters.find((x) => x.seq === hd.rseq);
    const line = ro ? C.rosterMember(ro, hd.author) : null;
    if (!line || line.role !== 'provider') throw fail('bad-chain');
    // ...and still one now (D191): a copy from someone removed, or no
    // longer a provider, is listed but never opened.
    const now = latest(t);
    const nowLine = now ? C.rosterMember(now, hd.author) : null;
    if (!nowLine || nowLine.role !== 'provider') throw fail('not-provider');
    const pub = await trustedSigPub(t, ro, hd.author);
    const h = { site: siteId, id: hd.id, slot: hd.slot, baseN: hd.baseN, epoch: hd.epoch, rseq: hd.rseq, author: hd.author, dev: hd.dev, at: hd.at, ctHash: hd.ctHash };
    if (!pub || !(await C.verify(pub, C.visitSigned(h), hd.sig))) throw fail('bad-chain');
    const res = await T().api('GET', `/api/sites/${siteId}/visits/${hd.id}`);
    let env;
    try { env = await C.unpackDoc(await C.openVisit(h, res.body, await siteKey(siteId, hd.epoch))); }
    catch (e) { if (e.code) throw e; throw fail('bad-chain'); }
    if (!env || env.v !== 1 || !env.doc || !Array.isArray(env.doc.nodes)) throw fail('bad-chain');
    let base = null, baseRev = null;
    if (opts.base === false) return { env, base, baseRev, author: hd.author, email: hd.email || '' };
    try {
        const b = await T().api('GET', `/api/sites/${siteId}/revs/${hd.baseN}`);
        const bh = Object.assign({ site: siteId }, b.rev);
        const bro = t.rosters.find((x) => x.seq === bh.rseq);
        const bline = bro ? C.rosterMember(bro, bh.author) : null;
        const bpub = bline ? await trustedSigPub(t, bro, bh.author) : null;
        if (await C.chainHash(C.revSigned(bh), b.rev.sig) === b.rev.h && bpub && await C.verify(bpub, C.revSigned(bh), b.rev.sig)) {
            const benv = await C.unpackDoc(await C.openRevision(bh, b.body, await siteKey(siteId, bh.epoch)));
            if (benv && benv.doc && Array.isArray(benv.doc.nodes)) { base = benv.doc; baseRev = validRev(benv.rev); }
        }
    } catch (e) { base = null; }   // pruned (410) or not checked: two-way
    return { env, base, baseRev, author: hd.author, email: hd.email || '' };
}
// An owner's answer, kept on the card until what it wrote is on the server
// (doSync sends it after the push): { id, decision }.
function queueDecision(cardId, id, decision) {
    const r = rec(cardId);
    if (!r) return null;
    r.decisions = (r.decisions || []).filter((d) => d.id !== id).concat([{ id, decision }]);
    putRec(r);
    return syncNow(cardId);
}
async function flushDecisions(r) {
    const left = [];
    for (const d of r.decisions || []) {
        try { await T().api('POST', `/api/sites/${r.siteId}/visits/${d.id}/decide`, { decision: d.decision, n: r.baseN }); }
        catch (e) { if (!(e.status === 409 || e.status === 404)) left.push(d); }
    }
    r.decisions = left;
    putRec(r);
    _visitList.delete(r.siteId);
    if (typeof visitsWaitingChanged === 'function') visitsWaitingChanged(r.cardId);
}
// The owner's list, cached briefly per site (the landing reads it).
const _visitList = new Map();   // siteId -> { at, list }
async function ownerVisits(siteId, fresh) {
    const c = _visitList.get(siteId);
    if (!fresh && c && _hooks.now() - c.at < 30000) return c.list;
    const list = (await siteVisits(siteId)).filter((v) => v.state === 'waiting');
    _visitList.set(siteId, { at: _hooks.now(), list });
    return list;
}
// The live `visits` event: a provider looks at its copies again; an
// owner's list is read again.
function onVisits(siteId) {
    const r = recBySite(siteId);
    _visitList.delete(siteId);
    if (r && r.role === 'provider') syncCard(r.cardId);
    if (r && typeof visitsWaitingChanged === 'function') visitsWaitingChanged(r.cardId);
    T().changed();
}

// ---- The History on the server (design §9.3) ----
async function history(siteId) {
    const res = await T().api('GET', `/api/sites/${siteId}/revs?since=0&limit=1000`);
    return { head: res.head, revs: (res.revs || []).slice().reverse() };
}

// Tests: back to nothing.
function _reset() {
    _index = null; _docs.clear(); _keys.clear(); _members.clear();
    _timers.forEach((t) => clearTimeout(t.timer)); _timers.clear();
    _running.clear(); _again.clear(); _open.clear();
    _readable.forEach((st) => clearTimeout(st.timer)); _readable.clear();
    _visitList.clear();
}

window.serverCardIds = serverCardIds;
window.serverAfterSave = (cardId) => { if (T() && T().state.on) afterSave(cardId); };
window.serverDocLoaded = () => { if (T() && T().state.on) onDocLoaded(); };
window.TopoServerSync = {
    _hooks, _reset, open, index, rec, recBySite, putRec, dropRec, serverCardIds, cardSync, getDoc, putDoc,
    trust, walkRosters, siteKey, siteKeysRaw, siteDetail, pullHead, applyPull, pushCard, syncCard, syncAll, syncNow, afterSave, flushAll,
    onHead, onRoster, onGranted, onRemoved, signedOut, keysReset, putCard, openSite, reviewMerge, trustServerHistory, removeCard, unlinkCard,
    grant, setRole, removeMember, rotate, invite, setShowName, leave, siteName, deriveEvents, provider, history, onDocLoaded,
    nameSlugOf, sendReadable, setReadable, deleteReadable, siteBackups, flushReadable,
    uploadVisit, providerDecisions, takeServerVersion, offerOwnCopy, siteVisits, openVisitCopy, queueDecision, flushDecisions, ownerVisits, onVisits, visitSlot,
    SERVER_REASON, dirty: (cardId) => { const r = rec(cardId); return !!r && dirty(r); }
};
})();
