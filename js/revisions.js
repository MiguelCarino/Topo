// ---- Revisions: what each copy that left was ----
// A copy of a network goes out (a back-up file, a link, a binder) and may
// come back edited while the network here was edited too. Telling whose edit
// is whose needs the copy both started from: the base of a three-way merge
// (docs/SCOPE.md section 3, js/merge.js). So every copy that leaves carries a
// revision token, `rev` (a new one only when the content changed since the
// last copy that left), and the base it was started from, `base`, and the
// revisions it carried before, `prior` (newest first, at most PRIOR_MAX);
// and the content that left is kept here under its rev. A copy coming back
// names its base, and the base is looked up here (findBase).
//
// Identity, not content, like a document's id and updated: rev, base and
// prior are never in serializeDoc(), never an undo step, and docChangeParts
// does not see them. A kept network's are its card's (card.rev, revHash,
// revAt, base, prior; setCardMeta in js/library.js), an open document's
// that is not kept are state.docRev and the rest (js/state.js).
//
// card.base is only where the card started from (a file, a link or a binder
// site kept as a new card, a copy replaced over it). After a merge the base
// that goes out is the newest merged revision this card holds, read from the
// network's log (outgoingBase): the log rides undo and restore points, so
// undoing a merge takes its base back with it.
//
// Where it is kept: IndexedDB, a database of its own (nettopo_revisions),
// the same adapter as the restore points (js/restore.js idbRestoreAdapter):
// 'revs' holds { id: cardId|rev, cardId, rev, at, bytes, hash, why } with an
// index on cardId, 'revdocs' { id, doc }. Capped at REVISION_LIMITS.perCard
// per card and totalBytes in all, the revisions only opened dropped first,
// then the oldest; a card's own rev and base are never dropped. Dropped
// with the card. Without IndexedDB they are kept for this tab only.
//
// A copy nobody kept (a link opened, a file opened read-only) is never
// written to disk: its revisions are held in this tab only (the session
// bucket) and reach the disk when it is kept, as the network itself does
// (the autosave rule, js/library.js). The same privacy rule as the
// baselines (js/changes.js): nothing here is in a card, a binder or a link.

const REVISION_DB = 'nettopo_revisions';
const REVISION_STORE = 'revs';
const REVISION_DOCS = 'revdocs';
const REVISION_OPEN_MS = 1000;
// Mutable for the suites (CarinoRevisions.REVISION_LIMITS); nothing else changes them.
const REVISION_LIMITS = { perCard: 30, totalBytes: 40 * 1024 * 1024, writeMs: 4000, session: 30 };
// Why a revision was kept: what left (export, backup, binder, link), what
// arrived and was kept (opened), what was merged in (merge-theirs), what was
// pulled from or pushed to a Topo server (server; js/serversync.js), a
// provider's part of the network that left as a link or a file, or such a
// part merged back (part; js/providerpart.js, docs/SCOPE.md D93).
const REVISION_WHY = ['export', 'backup', 'binder', 'link', 'opened', 'merge-theirs', 'server', 'part'];
// A part in flight survives every cap until it is answered (heldParts,
// D152.1, D175, D176): no count limit.
// The parts a card sent (card.partRevs, ids only): a copy naming one is a
// part, whose base can only be a part (mergeContext, js/mergedoors.js).
// Every outstanding part is named, however many; of the answered ones, the
// newest PART_REVS_MAX are remembered.
const PART_REVS_MAX = 64;
// A card's part list from outside (a binder, a back-up, a server site): a
// generous bound, the newest kept (D179).
const PART_REVS_HARD_MAX = 16 * PART_REVS_MAX;
// Parts nothing can answer or close (D179): those recorded before 0.0.2 (no
// providers, no report) and copies merged back for no report are held as
// before, the newest few only; and of the copies merged back since the
// oldest unanswered part left (D177 reads them), the newest few.
const PART_LOOSE_HELD = 8;
const PART_SINCE_HELD = 16;
const PART_CONTEXT_MAX = 20000;
// A card on a Topo server makes a 'server' revision at every push and pull:
// the newest few are enough (the sync keeps its own base), and they go first,
// so they never push out the binder's and the links' that findBase needs
// (amendment C1).
const SERVER_REVISIONS_KEPT = 3;
const PRIOR_MAX = 8;
const REV_RE = /^[A-Za-z0-9_-]{1,64}$/;
const validRev = (v) => (typeof v === 'string' && REV_RE.test(v) ? v : null);
const validPrior = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => validRev(x)))].slice(0, PRIOR_MAX) : []);

// card id -> [meta], oldest first.
const _revs = new Map();
// meta id -> doc, for revisions not (yet) confirmed on disk.
const _revDocs = new Map();
// rev -> { rev, doc, hash, at, why }: copies nobody kept, this tab only.
const _revSession = new Map();
let _revAdapter = null;
let _revChannel = null;
let _revOpening = null;
let _revAdopting = null;
let _revSeq = 0;

const revisionKey = (cardId, rev) => cardId + '|' + rev;

function validRevisionMeta(rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (typeof rec.cardId !== 'string' || !rec.cardId || !validRev(rec.rev) || rec.id !== revisionKey(rec.cardId, rec.rev)) return null;
    if (!Number.isFinite(rec.at)) return null;
    return {
        id: rec.id, cardId: rec.cardId, rev: rec.rev, at: rec.at,
        bytes: Number.isFinite(rec.bytes) && rec.bytes >= 0 ? rec.bytes : 0,
        hash: typeof rec.hash === 'string' ? rec.hash.slice(0, 64) : '',
        why: REVISION_WHY.includes(rec.why) ? rec.why : 'export',
        ...(validPartMeta(rec.part) ? { part: validPartMeta(rec.part) } : {})
    };
}
// A part's context (the linked devices and the groups kept only to place
// them, js/providerpart.js): ids, kept with the revision so the merge back
// can tell a context removal from an item removal. null when not one.
function validPartMeta(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const ids = (list) => (Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 200))].slice(0, PART_CONTEXT_MAX) : []);
    // from: the network's full revisions the part carried as base and prior
    // (mergeContext tells a later whole-network copy from a part by them).
    const from = Array.isArray(v.from) ? [...new Set(v.from.filter((x) => validRev(x)))].slice(0, PRIOR_MAX + 1) : [];
    // all: every device, cable and group id the network held when the part
    // left, so a record the provider adds is never matched with one of yours
    // it never saw (mergePartPool, js/merge.js).
    const all = Array.isArray(v.all) ? [...new Set(v.all.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 200))].slice(0, 3 * PART_CONTEXT_MAX) : [];
    const out = { nodes: ids(v.nodes), groups: ids(v.groups), from, all };
    // What holds it (heldParts, D176): incidents, the reports it went out
    // for (closed or gone, it is let go); providers, whom it went to (that
    // many copies merged back answer it); back, a copy merged back rather
    // than a part sent; answers, the part a copy merged back was merged on.
    const incidents = ids(v.incidents).slice(0, 500), providers = ids(v.providers).slice(0, 500);
    if (incidents.length) out.incidents = incidents;
    if (providers.length) out.providers = providers;
    if (v.back === true) out.back = true;
    // by: the provider a copy merged back came from, when known (D179).
    if (typeof v.by === 'string' && v.by.length > 0 && v.by.length <= 200) out.by = v.by;
    const answers = Array.isArray(v.answers) ? [...new Set(v.answers.filter((x) => validRev(x)))].slice(0, PRIOR_MAX + 1) : [];
    if (answers.length) out.answers = answers;
    return out;
}

// ---- The content's hash ----
// What says whether a document changed since the copy that left: the
// serializer's reading of it (canonicalDoc), without identity, hashed with
// the library's 64-bit content hash. `canonical`: the doc is already the
// serializer's output (serializeDoc()), so the pass through it is skipped.
function revHashOf(doc, canonical = false) {
    try { return contentHash(JSON.stringify(canonical ? stripIdentity(doc) : canonicalDoc(stripIdentity(doc)))); }
    catch (e) { return ''; }
}

// ---- Card meta ----
const CARD_REV_KEYS = ['rev', 'revHash', 'revAt', 'base', 'prior', 'partRevs'];
const validPartRevs = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => validRev(x)))].slice(-PART_REVS_HARD_MAX) : []);
// A card's revision fields from `src` (a card, a site, a patch), validated;
// null, an empty list or an invalid value removes the key.
function applyCardRevision(card, src) {
    if (!card || !src) return card;
    CARD_REV_KEYS.forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(src, k)) return;
        const v = k === 'rev' || k === 'base' ? validRev(src[k])
            : k === 'revHash' ? (typeof src[k] === 'string' && src[k] ? src[k].slice(0, 64) : null)
                : k === 'revAt' ? (Number.isFinite(src[k]) ? src[k] : null)
                    : k === 'partRevs' ? validPartRevs(src[k])
                        : validPrior(src[k]);
        if (v === null || (Array.isArray(v) && !v.length)) delete card[k]; else card[k] = v;
    });
    return card;
}
// What a card keeps of an incoming copy that becomes its content (a binder
// site, a file): it IS that revision (rev, its hash), started from it
// (base), with the revisions the copy carried before. A copy with no rev
// keeps only the base it names.
function arrivedCardMeta(site, updated) {
    const rev = validRev(site && site.rev);
    const out = { rev: null, revHash: null, revAt: null, base: rev || validRev(site && site.base), prior: validPrior(site && site.prior) };
    if (rev && site.doc && !migrateDoc(site.doc).newer) {
        out.rev = rev;
        out.revHash = revHashOf(site.doc);
        out.revAt = Number.isFinite(updated) ? updated : null;
    }
    return out;
}
// The open document's identity, for the card it is about to become (its
// first save as a card). Its base is the revision it arrived as, or the one
// it was started from.
function sessionCardMeta() {
    return { rev: state.docRev, revHash: state.docRevHash, revAt: null, base: state.docRev || state.docBase, prior: state.docPrior, partRevs: sessionRevsWhy('part') };
}
// The tab's revisions held as `why` (oldest first): the parts sent from a
// network not kept, adopted with it when it is kept.
const sessionRevsWhy = (why) => [..._revSession.values()].filter((r) => r.why === why).map((r) => r.rev);
// What `rev` was held as under card `cardId` (or in this tab): its why, or ''.
function revisionWhy(cardId, rev) {
    if (!validRev(rev)) return '';
    const m = cardId ? (_revs.get(cardId) || []).find((x) => x.rev === rev) : null;
    if (m) return m.why;
    const s = _revSession.get(rev);
    return s ? s.why : '';
}
// The part's context kept with revision `rev` of card `cardId`, or null.
function revisionPartMeta(cardId, rev) {
    const m = (_revs.get(cardId) || []).find((x) => x.rev === rev);
    if (m && m.part) return m.part;
    const s = !m || !cardId ? _revSession.get(rev) : null;
    return s && s.part ? s.part : null;
}
// The parts card `cardId` sent (card.partRevs), with those it holds as 'part'.
function cardPartRevs(cardId) {
    const card = cardId && typeof libraryEntry === 'function' ? libraryEntry(cardId) : null;
    const out = new Set(card ? validPartRevs(card.partRevs) : []);
    (_revs.get(cardId) || []).forEach((m) => { if (m.why === 'part') out.add(m.rev); });
    return out;
}
// A part that left from card `cardId` (or this tab): held as 'part' with its
// context, and named in card.partRevs so a copy naming it is known for a
// part even once its revision is dropped. Not an edit: no undo step.
function recordPartRevision(cardId, rev, doc, hash, context) {
    const part = validPartMeta(context);
    if (!cardId) {
        if (!recordSessionRevision(rev, doc, 'part', hash)) return false;
        const s = _revSession.get(rev);
        if (s && part) s.part = part;
        return true;
    }
    const card = typeof libraryEntry === 'function' ? libraryEntry(cardId) : null;
    if (!card) return false;
    const held = recordRevision(cardId, rev, doc, 'part', hash, part);
    const list = validPartRevs(card.partRevs);
    if (!list.includes(rev)) setCardMeta(cardId, { partRevs: trimPartRevs(cardId, list.concat([rev])) });
    return !!held;
}
// A card's partRevs: every part still out, and of the others (answered, or
// dropped from the store) the newest PART_REVS_MAX.
function trimPartRevs(cardId, list) {
    const out = heldParts(cardId);
    const others = list.filter((r) => !out.has(r) || !hasRevision(cardId, r));
    const cut = new Set(others.slice(0, Math.max(0, others.length - PART_REVS_MAX)));
    return list.filter((r) => !cut.has(r));
}
// The parts of card `cardId` still out (D152.1, D175, D176, D179), as revs:
// a revision held as 'part' (a part sent, or a copy of one merged back,
// which is the base of that provider's next return) until it is answered
// (a copy merged back on it from each provider it went to, one at least; a
// copy that does not say whose counts as one more) or every report it went
// out for is closed or gone. A part sent for no report waits for its copy:
// no count limit. Parts nothing can answer or close (sent before 0.0.2, or
// a copy back for no report) are held the newest PART_LOOSE_HELD only. With
// them, the newest PART_SINCE_HELD copies merged back since the oldest
// unanswered part sent left: what another provider added meanwhile is told
// apart by them when it comes back (partMergeInfo's others, D177).
// -> a Set of revs; its .weak: those held with no open report, which the
// 40 MB budget lets go, oldest first, before it gives up (D179).
function heldParts(cardId, card) {
    if (card === undefined) card = typeof libraryEntry === 'function' ? libraryEntry(cardId) : null;
    const list = (_revs.get(cardId) || []).filter((m) => m.why === 'part');
    const out = new Set();
    out.weak = new Set();
    if (!list.length) return out;
    const sent = new Set(card ? validPartRevs(card.partRevs) : []);
    const answers = new Map();
    list.forEach((m) => {
        const p = m.part || {};
        (p.answers || []).forEach((r) => {
            const a = answers.get(r) || { by: new Set(), anon: 0 };
            if (p.by) a.by.add(p.by); else a.anon++;
            answers.set(r, a);
        });
    });
    const answeredBy = (rev) => { const a = answers.get(rev); return a ? a.by.size + a.anon : 0; };
    const incs = new Map((card && card.doc && Array.isArray(card.doc.incidents) ? card.doc.incidents : [])
        .filter((x) => x && typeof x.id === 'string').map((x) => [x.id, x]));
    const reports = (ids) => (!ids.length ? 'none'
        : ids.some((id) => { const x = incs.get(id); return !!x && x.status !== 'closed'; }) ? 'open' : 'closed');
    const loose = [], anchors = [];
    list.forEach((m) => {
        const p = m.part || {};
        const back = partIsBack(m, sent);
        const fromNow = !back && Array.isArray(p.providers) && p.providers.length > 0;
        if (answeredBy(m.rev) >= (fromNow ? p.providers.length : 1)) return;
        const st = reports(p.incidents || []);
        if (st === 'closed') return;
        if (st === 'open') { out.add(m.rev); if (fromNow) anchors.push(m); return; }
        if (fromNow) { out.add(m.rev); out.weak.add(m.rev); anchors.push(m); } else loose.push(m);
    });
    loose.slice(-PART_LOOSE_HELD).forEach((m) => { out.add(m.rev); out.weak.add(m.rev); });
    if (anchors.length) {
        const since = Math.min(...anchors.map((m) => m.at));
        list.filter((m) => m.at > since && !out.has(m.rev) && partIsBack(m, sent)).slice(-PART_SINCE_HELD)
            .forEach((m) => { out.add(m.rev); out.weak.add(m.rev); });
    }
    return out;
}
// A 'part' revision (meta m) that is a copy merged back, not a part sent:
// marked so since D176 (a part sent names its providers); an older one is a
// copy merged back when the card never named it as sent (sent: card.partRevs).
const partIsBack = (m, sent) => !!(m.part && m.part.back === true) || (!(m.part && m.part.providers) && !sent.has(m.rev));
// The open document's identity from its card (after a card is made of it).
function syncDocRevision(card) {
    state.docRev = (card && validRev(card.rev)) || null;
    state.docRevHash = (card && typeof card.revHash === 'string' && card.revHash) || null;
    state.docBase = (card && validRev(card.base)) || null;
    state.docPrior = card ? validPrior(card.prior) : [];
}
// replaceDocument (js/app.js): the identity of the document just loaded.
// A card's own; else what it carried (or what opts says: a guest site's, a
// reload's). A copy arriving with a rev is held in this tab under it.
function setDocRevision(card, ident, opts, nowJson, newer, origin) {
    if (card) { syncDocRevision(card); return; }
    const pick = (k, fallback) => (opts && opts[k] !== undefined ? opts[k] : fallback);
    state.docRev = newer ? null : validRev(pick('docRev', ident.rev));
    state.docBase = newer ? null : validRev(pick('docBase', ident.base));
    state.docPrior = newer ? [] : validPrior(pick('docPrior', ident.prior));
    const givenHash = opts && typeof opts.docRevHash === 'string' && opts.docRevHash ? opts.docRevHash : null;
    state.docRevHash = state.docRev ? (givenHash || contentHash(nowJson)) : null;
    // Arriving (not a reload, whose content may have been edited since):
    // the content as it came is that revision.
    if (state.docRev && !givenHash && origin !== 'live') {
        try { recordSessionRevision(state.docRev, JSON.parse(nowJson), 'opened', state.docRevHash); } catch (e) { /* not kept: nothing lost */ }
    }
}

// ---- Stamping a copy as it leaves ----
// -> { rev, base, prior } for the card `cardId` as it is stored, the rev
// minted when its content changed since the last copy that left (or
// reused while `updated` has not moved since it was stamped), and the
// content kept under it. null for a card from a newer Topo, a template or
// a block (never merged), or no card.
function stampCard(cardId, why) {
    const card = typeof libraryEntry === 'function' ? libraryEntry(cardId) : null;
    if (!card || !card.doc || !Array.isArray(card.doc.nodes) || card.template || card.block) return null;
    if (migrateDoc(card.doc).newer) return null;
    let rev = validRev(card.rev);
    let prior = validPrior(card.prior);
    let hash = typeof card.revHash === 'string' ? card.revHash : '';
    if (!(rev && Number.isFinite(card.revAt) && card.revAt === card.updated && hash)) {
        const now = revHashOf(card.doc);
        if (!rev || now !== hash) {
            if (rev) prior = [rev, ...prior.filter((x) => x !== rev)].slice(0, PRIOR_MAX);
            rev = randomToken();
        }
        hash = now;
        setCardMeta(cardId, { rev, revHash: hash, revAt: card.updated, prior });
    }
    recordRevision(cardId, rev, card.doc, why, hash);
    return { rev, base: outgoingBase(cardId, card.doc, card.base), prior };
}
// The open document as it leaves (identifiedDoc, js/app.js). Its card's
// when the card holds what is on screen; else the tab's own identity, the
// content held in this tab only. doc: serializeDoc() of it.
function stampOpenDoc(doc, why) {
    if (state.readOnly) return null;
    const kept = isKept() && flushAutosave() ? libraryEntry(state.libraryId) : null;
    if (kept) {
        const ident = stampCard(state.libraryId, why);
        if (ident) { syncDocRevision(libraryEntry(state.libraryId)); return ident; }
    }
    const hash = revHashOf(doc, true);
    if (!state.docRev || hash !== state.docRevHash) {
        if (state.docRev) state.docPrior = [state.docRev, ...state.docPrior.filter((x) => x !== state.docRev)].slice(0, PRIOR_MAX);
        state.docRev = randomToken();
        state.docRevHash = hash;
    }
    recordSessionRevision(state.docRev, doc, why, hash);
    refreshLiveEntryQuietly();
    return { rev: state.docRev, base: state.docBase, prior: state.docPrior.slice() };
}
// A stored document of card `cardId` that is not its current content (a
// restore point downloaded): its own rev, kept under the card, unless it is
// the card's content after all.
function stampCardDoc(cardId, doc, why) {
    const card = libraryEntry(cardId);
    if (!card || !doc || migrateDoc(doc).newer) return null;
    const hash = revHashOf(doc);
    if (validRev(card.rev) && hash === card.revHash) return stampCard(cardId, why);
    const rev = randomToken();
    recordRevision(cardId, rev, doc, why, hash);
    return { rev, base: outgoingBase(cardId, doc, card.base), prior: [] };
}
// Binder sites built from cards (binderFile, the restore download), as they
// leave: each network card's site with its rev, base and prior, before its
// doc. The open card's is stamped as the open document (stampOpenDoc: its
// card's when the card holds the canvas, as binderFile puts the canvas in
// when it could not be stored). Templates,
// blocks, sites of a newer Topo and sites of no card here go as they are.
function stampSites(sites, why) {
    return (sites || []).map((s) => {
        if (!s || typeof s !== 'object' || s.template || s.block || !s.doc) return s;
        let ident = null;
        if (s.id === state.libraryId && isKept() && !state.readOnly) ident = stampOpenDoc(serializeDoc(), why);
        else ident = stampCard(s.id, why);
        return ident ? withSiteRevision(s, ident) : s;
    });
}
// A site with rev, base and prior right before its doc.
function withSiteRevision(site, ident) {
    const out = {};
    Object.keys(site).forEach((k) => {
        if (k === 'rev' || k === 'base' || k === 'prior') return;
        if (k === 'doc') Object.assign(out, revisionFields(ident));
        out[k] = site[k];
    });
    return out;
}
// { rev, base, prior } -> the keys a copy carries, absent ones left out.
function revisionFields(ident) {
    const out = {};
    if (!ident) return out;
    const rev = validRev(ident.rev), base = validRev(ident.base), prior = validPrior(ident.prior);
    if (rev) out.rev = rev;
    if (base) out.base = base;
    if (prior.length) out.prior = prior;
    return out;
}
// The base a copy of card `cardId` goes out with: the newest revision its
// log says was merged in and this browser holds under the card, else the
// card's own (where it was started from).
// A part merged back (held as 'part') is never a full copy's base: an older
// merged revision is, else the card's own (D93).
function outgoingBase(cardId, doc, cardBase) {
    const log = normalizeLog(doc && doc.log);
    for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].rev && hasRevision(cardId, log[i].rev) && revisionWhy(cardId, log[i].rev) !== 'part') return log[i].rev;
    }
    const b = validRev(cardBase);
    return b && revisionWhy(cardId, b) !== 'part' ? b : null;
}
// The history entry follows the identity (a reload keeps the rev).
function refreshLiveEntryQuietly() {
    if (typeof refreshLiveEntry === 'function') { try { refreshLiveEntry(); } catch (e) { /* the next save writes it */ } }
}

// ---- Keeping ----
// Content `doc` of card `cardId` under `rev`. Synchronous: in this tab at
// once, the write follows. A revision already held is not written again.
// -> { id, stored } (stored: a promise of whether it reached the disk), or null.
function recordRevision(cardId, rev, doc, why, hash, part) {
    if (typeof cardId !== 'string' || !cardId || !validRev(rev) || !doc || !Array.isArray(doc.nodes)) return null;
    const id = revisionKey(cardId, rev);
    const list = _revs.get(cardId) || [];
    if (list.some((m) => m.id === id)) return { id, stored: Promise.resolve(true) };
    let copy;
    try { copy = stripIdentity(cloneData(doc)); } catch (e) { return null; }
    const last = list.length ? list[list.length - 1].at : 0;
    const now = Date.now();
    const meta = { id, cardId, rev, at: now > last ? now : last + 1, bytes: restoreBytes(copy),
        hash: typeof hash === 'string' ? hash : revHashOf(copy), why: REVISION_WHY.includes(why) ? why : 'export' };
    const pm = validPartMeta(part);
    if (pm) meta.part = pm;
    list.push(meta);
    _revs.set(cardId, list);
    _revDocs.set(id, copy);
    const dropped = enforceRevisionCaps(cardId);
    let stored;
    if (_revAdapter || !_revAdopting) stored = writeRevisions([id], dropped);
    else {
        const adopting = _revAdopting;
        const timeout = new Promise((resolve) => setTimeout(() => resolve(false), REVISION_LIMITS.writeMs));
        stored = Promise.race([adopting.then(() => (_revAdapter
            ? (_revDocs.has(id) ? writeRevisions([id], []) : !!revisionMetaById(id)) : false)), timeout]);
    }
    return { id, stored };
}
// A copy nobody kept: this tab only, never the disk or the channel.
function recordSessionRevision(rev, doc, why, hash) {
    if (!validRev(rev) || !doc || !Array.isArray(doc.nodes)) return false;
    if (_revSession.has(rev)) return true;
    let copy;
    try { copy = stripIdentity(cloneData(doc)); } catch (e) { return false; }
    _revSession.set(rev, { rev, doc: copy, hash: typeof hash === 'string' ? hash : revHashOf(copy), at: Date.now(), why: REVISION_WHY.includes(why) ? why : 'export' });
    // The tab's count is for the copies only opened: a part sent from a
    // network not kept yet is still out (D152.1, D176), and stays.
    const others = [..._revSession.values()].filter((r) => r.why !== 'part');
    for (let i = 0; i < others.length - REVISION_LIMITS.session; i++) _revSession.delete(others[i].rev);
    return true;
}
// The tab's revisions `revs` (all when omitted) become card `cardId`'s, and
// go to disk: the copy was kept.
// why: what to record them as instead of what they were held as (a copy
// visited and then merged in is 'merge-theirs'); part: the part's context to
// keep with them instead of their own (a copy merged back as a part).
function adoptSessionRevisions(cardId, revs, why, part) {
    const want = Array.isArray(revs) ? new Set(revs.filter(validRev)) : null;
    let n = 0;
    [..._revSession.values()].forEach((r) => {
        if (want && !want.has(r.rev)) return;
        if (recordRevision(cardId, r.rev, r.doc, why || r.why, r.hash, part || r.part)) n++;
        _revSession.delete(r.rev);
    });
    return n;
}

// Drops the oldest past the caps: per card, the ones only opened first.
// Never a card's own rev or base. -> the dropped ids.
function revisionHeld(cardId) {
    const card = typeof libraryEntry === 'function' ? libraryEntry(cardId) : null;
    const held = new Set();
    if (!card) return held;
    if (validRev(card.rev)) held.add(card.rev);
    if (validRev(card.base)) held.add(card.base);
    const b = card.doc ? outgoingBaseRaw(cardId, card.doc) : null;
    if (b) held.add(b);
    // The parts still out: a provider may still be working on one (D93, D176).
    // weak: those of them the budget may let go (no open report, D179), never
    // the card's own rev or base.
    const parts = heldParts(cardId, card);
    held.weak = new Set([...parts.weak].filter((r) => !held.has(r)));
    parts.forEach((r) => held.add(r));
    return held;
}
// outgoingBase's log half, without the card.
function outgoingBaseRaw(cardId, doc) {
    const log = Array.isArray(doc.log) ? doc.log : [];
    const list = _revs.get(cardId) || [];
    for (let i = log.length - 1; i >= 0; i--) {
        const rev = log[i] && validRev(log[i].rev);
        if (rev && list.some((m) => m.rev === rev)) return rev;
    }
    return null;
}
function enforceRevisionCaps(cardId) {
    const dropped = [];
    const drop = (list, i) => { const [m] = list.splice(i, 1); dropped.push(m.id); _revDocs.delete(m.id); };
    const cards = cardId ? [cardId] : [..._revs.keys()];
    cards.forEach((id) => {
        const list = _revs.get(id);
        if (!list) return;
        // The server's: the newest SERVER_REVISIONS_KEPT only.
        let heldS = null;
        while (list.filter((m) => m.why === 'server').length > SERVER_REVISIONS_KEPT) {
            if (!heldS) heldS = revisionHeld(id);
            const i = list.findIndex((m) => m.why === 'server' && !heldS.has(m.rev));
            if (i < 0) break;
            drop(list, i);
        }
        if (!list.length) { _revs.delete(id); return; }
        if (list.length <= REVISION_LIMITS.perCard) return;
        const held = revisionHeld(id);
        while (list.length > REVISION_LIMITS.perCard) {
            let i = list.findIndex((m) => m.why === 'server' && !held.has(m.rev));
            if (i < 0) i = list.findIndex((m) => m.why === 'opened' && !held.has(m.rev));
            if (i < 0) i = list.findIndex((m) => !held.has(m.rev));
            if (i < 0) break;
            drop(list, i);
        }
        if (!list.length) _revs.delete(id);
    });
    let total = 0;
    _revs.forEach((list) => list.forEach((m) => { total += m.bytes; }));
    if (total > REVISION_LIMITS.totalBytes) {
        const held = new Map();
        const heldOf = (id) => { if (!held.has(id)) held.set(id, revisionHeld(id)); return held.get(id); };
        while (total > REVISION_LIMITS.totalBytes) {
            let oldest = null;
            // The server's first (C1), then the oldest.
            const rank = (m) => (m.why === 'server' ? 0 : 1);
            _revs.forEach((list) => list.forEach((m, i) => {
                if (!heldOf(m.cardId).has(m.rev) && (!oldest || rank(m) < rank(oldest.m) || (rank(m) === rank(oldest.m) && m.at < oldest.m.at))) oldest = { m, list, i };
            }));
            // Only held ones left: a part with no open report goes, the
            // oldest first (nothing could ever close it, D179); one with an
            // open report never does, and the library warns (D175).
            if (!oldest) {
                _revs.forEach((list) => list.forEach((m, i) => {
                    const h = heldOf(m.cardId);
                    if (h.weak && h.weak.has(m.rev) && (!oldest || m.at < oldest.m.at)) oldest = { m, list, i };
                }));
                if (oldest) held.delete(oldest.m.cardId);
            }
            if (!oldest) break;
            total -= oldest.m.bytes;
            drop(oldest.list, oldest.i);
            if (!oldest.list.length) _revs.delete(oldest.m.cardId);
        }
    }
    return dropped;
}

// Over the budget (REVISION_LIMITS.totalBytes) with nothing left to drop:
// only held revisions, mostly parts still out (D175). The library says so
// (renderLanding, js/library.js) instead of dropping one.
function revisionsOverBudget() {
    let total = 0;
    _revs.forEach((list) => list.forEach((m) => { total += m.bytes; }));
    return total > REVISION_LIMITS.totalBytes;
}

function revisionMetaById(id) {
    for (const list of _revs.values()) { const m = list.find((x) => x.id === id); if (m) return m; }
    return null;
}

function writeRevisions(putIds, delIds) {
    const adapter = _revAdapter;
    if (!adapter) return Promise.resolve(false);
    const put = putIds.map((id) => ({ meta: revisionMetaById(id), doc: _revDocs.get(id) })).filter((p) => p.meta && p.doc);
    if (!put.length && !delIds.length) return Promise.resolve(putIds.length === 0);
    const cardIds = [...new Set(put.map((p) => p.meta.cardId))];
    const write = Promise.resolve().then(() => adapter.write({ put, del: delIds })).catch(() => false).then((ok) => {
        if (!ok) { console.warn('Topo: could not store the revisions', putIds); return false; }
        put.forEach((p) => { if (adapter === _revAdapter) _revDocs.delete(p.meta.id); });
        if (_revChannel) { try { _revChannel.postMessage({ cardIds: cardIds.length ? cardIds : null }); } catch (e) { /* closed */ } }
        return true;
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), REVISION_LIMITS.writeMs));
    return Promise.race([write, timeout]).then((ok) => ok && put.length === putIds.length);
}

// ---- The store ----
function idbRevisionAdapter() { return idbRestoreAdapter(REVISION_DB, REVISION_STORE, REVISION_DOCS); }

// Boot, once the library is open. Not awaited; findBase waits for it.
function openRevisionStore(adapter, ms = REVISION_OPEN_MS) {
    if (adapter === undefined) adapter = typeof indexedDB !== 'undefined' && indexedDB ? idbRevisionAdapter() : null;
    if (!adapter) { _revAdapter = null; _revOpening = null; _revAdopting = null; return Promise.resolve('tab'); }
    const seq = ++_revSeq;
    _revAdapter = null;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ms));
    const opened = Promise.resolve().then(() => adapter.open()).catch(() => null);
    const adopted = opened.then((disk) => (disk && seq === _revSeq ? adoptRevisionStore(adapter, disk) : null));
    const done = Promise.race([adopted.then(() => true), timeout]);
    _revOpening = done;
    _revAdopting = adopted;
    done.then(() => { if (_revOpening === done) _revOpening = null; });
    adopted.then(() => { if (_revAdopting === adopted) _revAdopting = null; });
    return Promise.race([opened, timeout]).then((disk) => (disk ? 'idb' : 'tab'));
}

function adoptRevisionStore(adapter, disk) {
    const onDisk = new Set();
    (Array.isArray(disk) ? disk : []).forEach((rec) => {
        const meta = validRevisionMeta(rec);
        if (!meta) return;
        onDisk.add(meta.id);
        const list = _revs.get(meta.cardId) || [];
        if (!list.some((m) => m.id === meta.id)) list.push(meta);
        _revs.set(meta.cardId, list);
    });
    _revs.forEach((list) => list.sort((a, b) => a.at - b.at));
    _revAdapter = adapter;
    const del = enforceRevisionCaps(null);
    if (typeof libraryStoreKind === 'function' && libraryStoreKind() === 'idb') {
        [..._revs.keys()].filter((id) => !libraryEntry(id)).forEach((id) => {
            _revs.get(id).forEach((m) => { del.push(m.id); _revDocs.delete(m.id); });
            _revs.delete(id);
        });
    }
    const put = [];
    _revs.forEach((list) => list.forEach((m) => { if (!onDisk.has(m.id) && _revDocs.has(m.id)) put.push(m.id); }));
    listenForRevisions();
    const dels = del.filter((id) => onDisk.has(id));
    return put.length || dels.length ? writeRevisions(put, dels) : Promise.resolve(true);
}

function releaseRevisionStore() {
    if (_revChannel) { try { _revChannel.close(); } catch (e) { /* closed */ } }
    _revChannel = null; _revAdapter = null; _revOpening = null; _revAdopting = null; _revSeq++;
}

function listenForRevisions() {
    if (_revChannel) { try { _revChannel.close(); } catch (e) { /* closed */ } }
    _revChannel = null;
    if (typeof BroadcastChannel !== 'function') return;
    try { _revChannel = new BroadcastChannel(REVISION_DB); } catch (e) { return; }
    const adapter = _revAdapter;
    _revChannel.onmessage = (event) => {
        const data = event.data || {};
        const cardIds = Array.isArray(data.cardIds) ? data.cardIds.filter((id) => typeof id === 'string') : [];
        if (!cardIds.length) return;
        Promise.resolve(adapter.readCards(cardIds)).then((fresh) => {
            if (!fresh || adapter !== _revAdapter) return;
            cardIds.forEach((cardId) => {
                const pending = (_revs.get(cardId) || []).filter((m) => _revDocs.has(m.id));
                const list = (fresh[cardId] || []).map(validRevisionMeta).filter(Boolean);
                pending.forEach((m) => { if (!list.some((x) => x.id === m.id)) list.push(m); });
                list.sort((a, b) => a.at - b.at);
                if (list.length) _revs.set(cardId, list); else _revs.delete(cardId);
            });
        }).catch(() => { /* the next message, or the next visit, catches up */ });
    };
}

// ---- Reading ----
// Card `cardId`'s revisions, newest first, as copies (no documents).
function revisionsOf(cardId) {
    return (_revs.get(cardId) || []).slice().reverse().map((m) => Object.assign({}, m));
}
// Whether `rev` is held under card `cardId` (under any card when cardId is null).
function hasRevision(cardId, rev) {
    if (!validRev(rev)) return false;
    if (cardId) return (_revs.get(cardId) || []).some((m) => m.rev === rev);
    for (const list of _revs.values()) if (list.some((m) => m.rev === rev)) return true;
    return false;
}
const hasSessionRevision = (rev) => _revSession.has(rev);
// -> a copy of the content kept under (cardId, rev), or null.
function revisionDoc(cardId, rev) {
    const id = revisionKey(cardId, rev);
    const held = _revDocs.get(id);
    if (held) return Promise.resolve(cloneData(held));
    const adapter = _revAdapter;
    if (!adapter || !revisionMetaById(id)) return Promise.resolve(null);
    return Promise.resolve().then(() => adapter.readDoc(id)).catch(() => null)
        .then((doc) => (doc && typeof doc === 'object' && Array.isArray(doc.nodes) ? doc : null));
}
// The store has adopted the disk (or there is none), bounded by writeMs:
// a file dropped during boot must not find an empty store and merge
// two-way for want of waiting.
function revisionsReady() {
    if (!_revAdopting) return Promise.resolve(true);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), REVISION_LIMITS.writeMs));
    return Promise.race([_revAdopting.then(() => true, () => false), timeout]);
}
// The base of a returning copy: the first of `revs` (one rev, or a list in
// the order to try: rev, prior..., base) held under card `preferCardId`,
// then under any card, then in this tab. -> { rev, cardId, doc } or null.
async function findBase(revs, preferCardId) {
    const list = (Array.isArray(revs) ? revs : [revs]).filter(validRev);
    if (!list.length) return null;
    await revisionsReady();
    const tryCard = async (cardId, rev) => {
        if (!hasRevision(cardId, rev)) return null;
        const doc = await revisionDoc(cardId, rev);
        return doc ? { rev, cardId, doc } : null;
    };
    for (const rev of list) {
        if (preferCardId) { const hit = await tryCard(preferCardId, rev); if (hit) return hit; }
    }
    for (const rev of list) {
        for (const cardId of _revs.keys()) {
            if (cardId === preferCardId) continue;
            const hit = await tryCard(cardId, rev);
            if (hit) return hit;
        }
    }
    for (const rev of list) {
        const s = _revSession.get(rev);
        if (s) return { rev, cardId: null, doc: cloneData(s.doc) };
    }
    return null;
}
// Every revision written by this tab has reached the disk (or failed).
function revisionsFlushed() {
    const ids = [..._revDocs.keys()];
    return ids.length && _revAdapter ? writeRevisions(ids, []) : Promise.resolve(true);
}

// A deleted card's revisions: here and, on disk, every one under the card.
function dropRevisions(cardId) {
    if (!cardId) return false;
    const list = _revs.get(cardId) || [];
    _revs.delete(cardId);
    list.forEach((m) => _revDocs.delete(m.id));
    const ids = list.map((m) => m.id);
    const fromDisk = () => {
        const adapter = _revAdapter;
        if (!adapter) return;
        const again = _revs.get(cardId);
        if (again) { again.forEach((m) => { _revDocs.delete(m.id); if (!ids.includes(m.id)) ids.push(m.id); }); _revs.delete(cardId); }
        Promise.resolve().then(() => (typeof adapter.dropCard === 'function'
            ? Promise.all([adapter.dropCard(cardId), ids.length ? adapter.write({ put: [], del: ids }) : true]).then((r) => r.every(Boolean))
            : adapter.write({ put: [], del: ids }))).catch(() => false).then((ok) => {
            if (ok && _revChannel) { try { _revChannel.postMessage({ cardIds: [cardId] }); } catch (e) { /* closed */ } }
        });
    };
    if (_revAdapter) fromDisk();
    else if (_revAdopting) _revAdopting.then(fromDisk);
    return list.length > 0;
}

// Published for tests/suites/revisions.js (and js/merge.js later).
window.CarinoRevisions = { REVISION_DB, REVISION_LIMITS, REVISION_WHY, PRIOR_MAX, openRevisionStore, releaseRevisionStore, idbRevisionAdapter,
    recordRevision, recordSessionRevision, adoptSessionRevisions, hasRevision, hasSessionRevision, revisionsOf, revisionDoc, findBase,
    revisionsReady, revisionsFlushed, dropRevisions, stampCard, stampOpenDoc, stampCardDoc, stampSites, outgoingBase, revHashOf,
    PART_REVS_MAX, PART_LOOSE_HELD, PART_SINCE_HELD, revisionWhy, revisionPartMeta, cardPartRevs, recordPartRevision, sessionRevsWhy, heldParts, revisionsOverBudget,
    _reset() { _revs.clear(); _revDocs.clear(); _revSession.clear(); } };
