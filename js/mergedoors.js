// ---- The doors into a merge (docs/SCOPE.md section 3, step 2, stage 5) ----
// Every way a copy of a network comes back goes through the merge now; no
// door replaces a network newer-wins without asking any more:
//
//   * Open a file whose network is not here: opened as its own network (the
//     main answer), or merged into one picked from the list.
//   * Open a file, or Keep a link, whose network IS here and differs: Merge
//     is the main answer (three-way when the copy it was taken from is in
//     the revision store, js/revisions.js; two-way otherwise). Replace with
//     this copy (the old Update, with step 1's warning and restore point),
//     Open as a copy, Add to its history and Open mine stay.
//   * A copy that is older than yours (an ancestor: it left from here, or
//     your log says it was merged, or it is exactly your last back-up) is
//     never merged: "yours already has everything in this copy" (A2).
//   * The landing card's ⇄ Merge…: a file into this network, or this
//     network into another.
//   * Binder doors (a binder file, the link shelf's Keep, a bound binder
//     file at Back up all and when binding): per site, one that merges
//     three-way with no conflicts is merged on its own (restore point and log
//     entry each); the rest are listed in one summary, where each can be
//     reviewed, replaced by theirs, kept as a copy or skipped (the default).
//
// The base of a returning copy (mergeContext): of the revisions it names
// (prior, base, the revisions its log merged in) that are held under the
// network merged into and are ancestors of it now (emitted from it, or opened
// as it, or merged into it and still named by its log; an undone merge is
// not, A1), the one held here last: the nearest (docs/SCOPE.md D29). A pre-v17 copy
// (no rev, no base) edited after your last back-up is compared with that
// back-up (A19, D17); otherwise two-way.

// The network cards a copy can be merged into: not a template or a block,
// not one from a newer Topo. Most recent first.
function mergeTargets(excludeId) {
    return libraryEntries().filter((e) => !e.template && !e.block && e.id !== excludeId && !migrateDoc(e.doc).newer);
}
function mergeTargetDetail(e) {
    const r = (e.doc && e.doc.report) || {};
    const words = (v) => (typeof v === 'string' ? v.trim() : '');
    return [words(r.client), words(r.site), libraryWhen(e.updated)].filter(Boolean).join(' · ');
}
// -> a card id, or null.
async function pickMergeTarget(excludeId, message) {
    const list = mergeTargets(excludeId);
    if (!list.length) { showToast(t('There is no network here to merge into.')); return null; }
    return askPick(message || t('Merge into which network?'), {
        title: t('Merge into a network'), ok: t('Merge into it'),
        rows: list.map((e) => ({ id: e.id, label: e.name, detail: mergeTargetDetail(e) }))
    });
}

// ---- Which copy both started from ----
const mergeLogRevs = (doc) => normalizeLog(doc && doc.log).map((e) => e.rev).filter((r) => validRev(r));
// Whether `rev`, held under card `cardId`, is a copy the network `mine`
// grew from: it left from here or arrived as it, or it was merged in and
// the log still says so.
function mergeRevIsMine(cardId, mine, rev) {
    if (!validRev(rev)) return false;
    const held = revisionsOf(cardId).filter((m) => m.rev === rev);
    if (!held.length) return false;
    return held.some((m) => m.why !== 'merge-theirs') || mergeLogRevs(mine).includes(rev);
}
// The identity a copy carries (a document's own, or a binder site's).
function mergeIdentOf(doc, site) {
    const d = docIdentity(doc);
    if (!site) return d;
    return { id: d.id || (typeof site.id === 'string' ? site.id : null), updated: d.updated || (Number.isFinite(site.updated) ? site.updated : 0),
        rev: validRev(site.rev) || d.rev, base: validRev(site.base) || d.base, prior: validPrior(site.prior).length ? validPrior(site.prior) : d.prior };
}
// Whether copy `theirs` (identity `id`) coming back to card `cardId` is a
// part: it names a part this card sent, and has not grown since from a
// whole-network copy of this card. A provider keeps an old part's rev in its
// prior for a while (PRIOR_MAX); a whole link it merged after is a full
// revision held here, newer than every part it names and not one those parts
// carried (their base and prior), and then the copy is the whole network
// again. A part whose revision is gone (nothing to compare times with) stays
// a part: two-way, which removes nothing.
function mergeCopyIsPart(cardId, mine, id, theirs) {
    const partRevs = typeof cardPartRevs === 'function' ? cardPartRevs(cardId) : new Set();
    const named = [id.rev, id.base, ...(id.prior || []), ...(theirs ? mergeLogRevs(theirs) : [])].filter((r, i, a) => validRev(r) && a.indexOf(r) === i);
    const parts = named.filter((r) => partRevs.has(r));
    if (!parts.length) return false;
    const recs = revisionsOf(cardId);
    const heldAt = (rev) => recs.filter((m) => m.rev === rev).reduce((n, m) => Math.max(n, m.at || 0), 0);
    const heldParts = parts.filter((r) => recs.some((m) => m.rev === r && m.why === 'part'));
    if (heldParts.length < parts.length) return true;
    const carried = new Set();
    heldParts.forEach((r) => { const pm = typeof revisionPartMeta === 'function' ? revisionPartMeta(cardId, r) : null; (pm && pm.from || []).forEach((x) => carried.add(x)); });
    const newestPart = Math.max(...heldParts.map(heldAt));
    return !named.some((r) => !partRevs.has(r) && !carried.has(r) && revisionWhy(cardId, r) !== 'part'
        && mergeRevIsMine(cardId, mine, r) && heldAt(r) > newestPart);
}
// -> { mine, ancestor, base, baseRev, via: 'rev' | 'snapshot' | null, snapshotAt,
//      isPart, part }
// for copy `theirs` (identity `ident`) coming back to card `cardId`.
// A copy that names a part this card sent (card.partRevs, js/revisions.js)
// is a provider's part coming back (D93): only a revision held as 'part' can
// be its base (a full one would read everything outside the part as removed),
// else it is two-way; and `part` (partMergeInfo, js/providerpart.js) tells
// the merge which records the provider only saw as context.
async function mergeContext(cardId, theirs, ident) {
    const id = ident || docIdentity(theirs);
    const mine = mergeMineNow(cardId);
    const out = { mine, ancestor: false, base: null, baseRev: null, via: null, snapshotAt: 0, isPart: false, part: null };
    if (!mine || !theirs) return out;
    if (typeof revisionsReady === 'function') await revisionsReady();
    out.isPart = mergeCopyIsPart(cardId, mine, id, theirs);
    // Older than yours (A2): it carries one of your revs and still holds
    // what that rev holds (edited since without leaving again, a
    // hand-edited file, that rev is its base instead), or your log merged
    // it, or its content is a copy that left from here, or your last
    // back-up. (Its content hash both ways a rev may have been taken:
    // canonical, or as the serializer wrote it.)
    const hashes = new Set([revHashOf(theirs), revHashOf(theirs, true)].filter(Boolean));
    const ownRev = mergeRevIsMine(cardId, mine, id.rev);
    if (ownRev) {
        const recs = revisionsOf(cardId).filter((m) => m.rev === id.rev);
        if (!hashes.size || recs.some((m) => hashes.has(m.hash))) { out.ancestor = true; return out; }
    } else if (mergeLogRevs(mine).includes(id.rev)) { out.ancestor = true; return out; }
    if (revisionsOf(cardId).some((m) => m.why !== 'merge-theirs' && hashes.has(m.hash))) { out.ancestor = true; return out; }
    const snap = typeof snapshotOf === 'function' ? snapshotOf(cardId) : null;
    let sameAsSnap = false;
    try { sameAsSnap = !!(snap && snap.doc && !docChangeParts(snap.doc, theirs).size); } catch (e) { sameAsSnap = false; }
    if (sameAsSnap) { out.ancestor = true; return out; }
    // Of the revisions it names that this network grew from, the nearest:
    // the one held here last. Not the first named: after a cross-merge its
    // own older rev (prior) can be held here as well as the merged copy
    // (base), and comparing with the older one would bring back what was
    // deleted since and undo edits, with no conflict to show it.
    const named = [ownRev ? id.rev : null, ...(id.prior || []), id.base, ...mergeLogRevs(theirs).reverse()].filter((r, i, a) => validRev(r) && a.indexOf(r) === i);
    const heldAt = (rev) => revisionsOf(cardId).filter((m) => m.rev === rev).reduce((n, m) => Math.max(n, m.at || 0), 0);
    const tries = named.filter((rev) => mergeRevIsMine(cardId, mine, rev) && (!out.isPart || revisionWhy(cardId, rev) === 'part'))
        .map((rev, i) => ({ rev, i, at: heldAt(rev) }))
        .sort((a, b) => b.at - a.at || a.i - b.i)
        .map((x) => x.rev);
    for (const rev of tries) {
        const doc = await revisionDoc(cardId, rev);
        if (doc) {
            Object.assign(out, { base: doc, baseRev: rev, via: 'rev' });
            if (out.isPart && typeof partMergeInfo === 'function') out.part = await partMergeInfo(cardId, rev);
            return out;
        }
    }
    // A part whose own revision is gone: two-way, which removes nothing.
    if (out.isPart) { if (typeof partMergeInfo === 'function') out.part = await partMergeInfo(cardId, null); return out; }
    // A copy from before revisions (A19): edited after your last back-up,
    // it is compared with that back-up.
    if (!id.rev && !id.base && !(id.prior || []).length && snap && snap.doc && id.updated && id.updated > snap.at) {
        Object.assign(out, { base: snap.doc, via: 'snapshot', snapshotAt: snap.at });
    }
    return out;
}
function mergeModeNote(ctx) {
    if (ctx && ctx.base && ctx.via === 'snapshot') return t('It is compared with your back-up of {date}, so edits made on both sides are kept.', { date: libraryWhen(ctx.snapshotAt) });
    if (ctx && ctx.base) return t('It was taken from yours, so edits made on both sides are kept.');
    return t('No copy both started from was found: merging keeps everything of yours and asks where the two differ.');
}

// ---- One copy into one network ----
// opts: { ident, ctx, source, fileName, reason, name, replaceAsked, open }.
// -> openMergeReview's answer, or { ok: false, reason: 'ancestor' }.
async function mergeCopyInto(targetId, theirs, opts = {}) {
    const ident = opts.ident || docIdentity(theirs);
    const ctx = opts.ctx || await mergeContext(targetId, theirs, ident);
    if (ctx.ancestor) {
        const card = libraryEntry(targetId);
        showToast(t('"{name}" already has everything in this copy.', { name: card ? card.name : '' }));
        return { ok: false, reason: 'ancestor' };
    }
    return openMergeReview({ targetId, theirs, base: ctx.base, theirsRev: ident.rev, source: opts.source, fileName: opts.fileName,
        reason: opts.reason, name: opts.name, replaceAsked: opts.replaceAsked, open: opts.open, part: ctx.part || null, note: opts.note || '', ident });
}

// ---- The landing card's ⇄ Merge… ----
async function openCardMerge(entryId) {
    const entry = libraryEntry(entryId);
    if (!entry || entry.template || entry.block || migrateDoc(entry.doc).newer) return null;
    const how = await askChoice(t('Merge with "{name}":', { name: entry.name }), {
        title: t('Merge'),
        choices: [{ id: 'file', label: t('A file into this network…'), primary: true }, { id: 'into', label: t('This network into another…') }]
    });
    if (how === 'file') {
        const input = document.getElementById('mergeFileInput');
        if (!input) return null;
        input.dataset.target = entry.id;
        input.value = '';
        input.click();
        return 'file';
    }
    if (how !== 'into') return null;
    return mergeCardInto(entry.id, await pickMergeTarget(entry.id, t('Merge "{name}" into which network?', { name: entry.name })));
}
// Card `fromId` merged into card `targetId`: it leaves as a copy does
// (stamped, js/revisions.js), so a later copy of it finds this as its base.
async function mergeCardInto(fromId, targetId) {
    if (!fromId || !targetId || fromId === targetId) return null;
    const from = libraryEntry(fromId);
    if (!from) return null;
    if (state.libraryId === fromId && isKept()) flushAutosave();
    const card = libraryEntry(fromId);
    const stamped = typeof stampCard === 'function' ? stampCard(fromId, 'export') : null;
    const ident = Object.assign({ id: fromId, updated: card.updated }, stamped || { rev: null, base: null, prior: [] });
    return mergeCopyInto(targetId, card.doc, { ident, source: card.name, name: card.name, reason: 'Before merging {name}' });
}
// A file picked for "A file into this network…".
function mergeFileIntoCard(targetId, parsed, fileName) {
    // A server backup is unlocked first, then offered as any copy of a network is (js/backupfile.js).
    if (typeof isBackupFile === 'function' && isBackupFile(parsed)) return openBackupFile(parsed, { fileName, mergeInto: targetId });
    if (binderFromImported(parsed)) { showToast(t('That file is a binder of several networks: open it with Open a file.')); return Promise.resolve(null); }
    const doc = docFromImported(parsed);
    if (!doc) { showToast(t('That file does not look like a Topo build or binder.'), 'err'); return Promise.resolve(null); }
    return mergeCopyInto(targetId, doc, { ident: docIdentity(doc), source: fileName || '', fileName: fileName || '' });
}
(function wireMergeFileInput() {
    const input = document.getElementById('mergeFileInput');
    if (!input) return;
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        const target = input.dataset.target;
        if (!file || !target) return;
        const reader = new FileReader();
        reader.onload = () => {
            let parsed;
            try { parsed = JSON.parse(reader.result); } catch (e) { showToast(t('That file is not valid JSON.'), 'err'); return; }
            mergeFileIntoCard(target, parsed, file.name);
        };
        reader.onerror = () => showToast(t('Could not read that file.'), 'err');
        reader.readAsText(file);
    });
})();

// ---- Binders ----
// Each site of a binder, classified:
//   add     its network is not here;
//   kept    the same as yours, or older than yours (an ancestor);
//   auto    three-way with no conflicts: merged on its own;
//   ask     everything else: a row of the summary, with its reason.
// -> [{ site, kind, entry, ident, ctx, plan, reason, canReview }].
const mergeSiteValid = (s) => !!(s && typeof s === 'object' && s.doc && Array.isArray(s.doc.nodes));
async function classifyBinderSites(sites) {
    const out = [];
    for (const site of sites || []) {
        if (!mergeSiteValid(site)) { out.push({ site, kind: 'invalid' }); continue; }
        const id = typeof site.id === 'string' && site.id ? site.id : '';
        const entry = id ? libraryEntry(id) : null;
        if (!entry) { out.push({ site, kind: 'add' }); continue; }
        const row = { site, entry, kind: 'ask', canReview: false, reason: '' };
        const mine = mergeMineNow(entry.id) || entry.doc;
        let same = false;
        try { same = !docChangeParts(mine, site.doc).size; } catch (e) { same = false; }
        if (same) { out.push(Object.assign(row, { kind: 'kept' })); continue; }
        if (entry.template || entry.block || site.template === true) {
            // Templates and blocks are not merged: yours newer stays; a newer
            // copy is asked about, never taken silently.
            if ((Number.isFinite(site.updated) ? site.updated : 0) <= (entry.updated || 0)) row.kind = 'kept';
            else row.reason = t('A newer copy of a template');
            out.push(row);
            continue;
        }
        if (migrateDoc(site.doc).newer) { out.push(Object.assign(row, { reason: t('Made by a newer version of Topo') })); continue; }
        if (migrateDoc(entry.doc).newer) { out.push(Object.assign(row, { reason: t('Yours was made by a newer version of Topo') })); continue; }
        row.ident = mergeIdentOf(site.doc, site);
        row.ctx = await mergeContext(entry.id, site.doc, row.ident);
        if (row.ctx.ancestor) { out.push(Object.assign(row, { kind: 'kept' })); continue; }
        row.canReview = true;
        if (!row.ctx.base) { out.push(Object.assign(row, { reason: t('No copy both started from was found') })); continue; }
        // Compared with your last back-up (a copy from before revisions):
        // a guess at the copy both started from, so it is never merged
        // unasked (D17).
        if (row.ctx.via === 'snapshot') { out.push(Object.assign(row, { reason: t('Compared with your last back-up') })); continue; }
        try { row.plan = planMerge(row.ctx.mine, site.doc, row.ctx.base, { part: row.ctx.part || null }); } catch (e) {
            out.push(Object.assign(row, { canReview: false, reason: t('Could not be compared') }));
            continue;
        }
        const c = row.plan.counts;
        const conflicts = mergeConflictKeys(row.plan) ? (c.conflicts || 1) : 0;
        // A provider's visit nobody has decided on waits for its owner, every
        // time (D139, D153): asked, never merged on its own.
        const visit = typeof visitReviewInfo === 'function' ? visitReviewInfo(site.doc, mine) : null;
        if (visit) row.reason = t('A visit to review');
        else if (!conflicts) row.kind = c.added + c.changed + c.removed ? 'auto' : 'kept';
        else row.reason = t(conflicts === 1 ? '{n} conflict' : '{n} conflicts', { n: conflicts });
        out.push(row);
    }
    return out;
}

// The summary's answers, in tests (as setMergeResponder): fn gets
// { rows: [{ id, name, reason, canReview }], auto: [names], backup } and
// returns { [id]: 'review' | 'replace' | 'copy' | 'skip' } or null (Cancel).
let _summaryResponder = null;
function setMergeSummaryResponder(fn) {
    const prev = _summaryResponder;
    _summaryResponder = typeof fn === 'function' ? fn : null;
    return prev;
}
const SUMMARY_ACTIONS = [
    { id: 'review', label: 'Review…' },
    { id: 'replace', label: 'Replace with theirs' },
    { id: 'copy', label: 'Keep as a copy' },
    { id: 'skip', label: 'Skip' }
];
let _ms = null;
function mergeSummaryOpen() {
    const scrim = document.getElementById('mergeSummaryDialog');
    return !!scrim && !scrim.hidden;
}
function finishMergeSummary(value) {
    const ctx = _ms;
    if (!ctx) return;
    _ms = null;
    const scrim = document.getElementById('mergeSummaryDialog');
    if (scrim) {
        if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
        else scrim.hidden = true;
    }
    ctx.resolve(value);
}
// -> { answers } (Done), { review: id, answers } (Review… on a row), or null.
function showMergeSummary(req) {
    if (_summaryResponder) {
        const responder = _summaryResponder;
        return Promise.resolve().then(() => responder(req)).then((v) => {
            if (!v || typeof v !== 'object') return null;
            const review = req.rows.find((r) => v[r.id] === 'review' && r.canReview && !r.done && !r.reviewed);
            return review ? { review: review.id, answers: v } : { answers: v };
        });
    }
    const scrim = document.getElementById('mergeSummaryDialog');
    if (!scrim) return Promise.resolve(null);
    if (_ms) finishMergeSummary(null);
    return new Promise((resolve) => {
        _ms = { req, answers: Object.assign({}, req.answers || {}), resolve };
        renderMergeSummary();
        if (window.CarinoUI) CarinoUI.modal.open(scrim, { onDismiss: () => finishMergeSummary(null) });
        else scrim.hidden = false;
    });
}
function renderMergeSummary() {
    const ctx = _ms;
    if (!ctx) return;
    const { req } = ctx;
    const el = (id) => document.getElementById(id);
    el('mergeSummaryMsg').textContent = req.backup
        ? t('The bound binder file holds copies of these networks that differ from yours. A copy you skip is replaced in the file by yours.')
        : t('These copies differ from your networks and could not be merged on their own. Choose for each; Skip leaves yours as it is.');
    const auto = el('mergeSummaryAuto');
    // Not merged yet: binderMergeSites writes them after Done, and Cancel
    // writes nothing (D25), so the line must not say they already are.
    auto.textContent = req.auto.length ? t('Merged when you press Done (nothing to decide): {names}.', { names: req.auto.join(', ') }) : '';
    auto.hidden = !req.auto.length;
    const list = el('mergeSummaryList');
    list.textContent = '';
    req.rows.forEach((r) => {
        const li = document.createElement('li');
        li.className = 'merge-row merge-summary-row';
        li.dataset.id = r.id;
        const head = document.createElement('div');
        head.className = 'merge-head';
        const name = document.createElement('span');
        name.className = 'merge-label';
        name.textContent = r.name;
        const why = document.createElement('span');
        why.className = 'merge-by';
        why.textContent = r.done ? t('Merged') : r.reason;
        head.append(name, why);
        li.append(head);
        if (!r.done) {
            const pick = document.createElement('div');
            pick.className = 'merge-acts';
            pick.setAttribute('role', 'group');
            pick.setAttribute('aria-label', r.name);
            const now = ctx.answers[r.id] || 'skip';
            SUMMARY_ACTIONS.forEach((a) => {
                if (a.id === 'review' && !r.canReview) return;
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn merge-btn';
                b.dataset.id = r.id;
                b.dataset.action = a.id;
                b.textContent = a.id === 'skip' && req.backup ? t('Skip (yours goes in the file)') : t(a.label);
                if (a.id !== 'review') b.setAttribute('aria-pressed', now === a.id ? 'true' : 'false');
                pick.append(b);
            });
            li.append(pick);
        }
        list.appendChild(li);
    });
}
(function wireMergeSummary() {
    const scrim = document.getElementById('mergeSummaryDialog');
    if (!scrim) return;
    scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => finishMergeSummary(null)));
    document.getElementById('mergeSummaryDone').addEventListener('click', () => { if (_ms) finishMergeSummary({ answers: Object.assign({}, _ms.answers) }); });
    document.getElementById('mergeSummaryList').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-action]');
        if (!b || !_ms) return;
        if (b.dataset.action === 'review') { finishMergeSummary({ review: b.dataset.id, answers: Object.assign({}, _ms.answers) }); return; }
        _ms.answers[b.dataset.id] = b.dataset.action;
        b.parentElement.querySelectorAll('button[data-action]').forEach((x) => {
            if (x.dataset.action !== 'review') x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
    });
})();

// Every binder door. sites: the binder's; opts: { source ('binder', 'link'
// or a file name), fileName, reason, backup (the bound file at Back up all:
// Cancel cancels the back-up) }.
// -> { added, merged, replaced, copied, kept, skipped, storedIds, failedIds,
//    cancelled, older } or null when storage refused.
async function binderMergeSites(sites, opts = {}) {
    if (typeof isKept === 'function' && isKept() && !state.readOnly) flushAutosave();
    const result = { added: 0, merged: 0, replaced: 0, copied: 0, kept: 0, skipped: 0, storedIds: [], failedIds: [], cancelled: false };
    const rows = await classifyBinderSites(sites);
    const reason = opts.reason || (opts.fileName ? 'Before merging {file}' : 'Before merging a binder');
    const pointOpts = opts.fileName ? { fileName: opts.fileName } : {};
    const source = opts.source || (opts.fileName ? opts.fileName : 'binder');
    const asks = rows.filter((r) => r.kind === 'ask');
    const autos = rows.filter((r) => r.kind === 'auto');
    let answers = {};
    if (asks.length) {
        const summary = asks.map((r) => ({ id: r.entry.id, name: r.entry.name, reason: r.reason, canReview: !!r.canReview, done: false, reviewed: false }));
        for (;;) {
            const got = await showMergeSummary({ rows: summary, auto: autos.map((r) => r.entry.name), backup: !!opts.backup, answers });
            if (!got) { result.cancelled = true; break; }
            answers = Object.assign({}, got.answers);
            if (!got.review) break;
            const row = asks.find((r) => r.entry.id === got.review);
            const line = summary.find((s) => s.id === got.review);
            line.reviewed = true;
            const res = await openMergeReview({ targetId: row.entry.id, theirs: row.site.doc, base: row.ctx && row.ctx.base, theirsRev: row.ident && row.ident.rev,
                source, fileName: opts.fileName, reason, open: false });
            if (res && res.ok) {
                line.done = true; row.done = true;
                result.merged++; result.storedIds.push(row.entry.id);
                delete answers[row.entry.id];
            } else if (answers[got.review] === 'review') delete answers[got.review];
        }
        if (result.cancelled) {
            // Merges already reviewed stay; nothing else is done.
            result.skipped += asks.filter((r) => !r.done).length;
            return result;
        }
    }
    const pick = (r) => answers[r.entry.id] || 'skip';
    const replaces = asks.filter((r) => !r.done && pick(r) === 'replace');
    const copies = asks.filter((r) => !r.done && pick(r) === 'copy');
    result.skipped += asks.filter((r) => !r.done && !['replace', 'copy'].includes(pick(r))).length;
    result.kept = rows.filter((r) => r.kind === 'kept').length;
    result.skipped += rows.filter((r) => r.kind === 'invalid').length;
    // One batch of restore points for what is written without a review.
    const pointIds = [...autos, ...replaces].map((r) => r.entry.id);
    if (pointIds.length && typeof keepRestorePoints === 'function' && !(await keepRestorePoints(pointIds, reason, pointOpts))) {
        result.cancelled = true;
        return result;
    }
    for (const r of autos) {
        const res = await commitMerge({ targetId: r.entry.id, theirs: r.site.doc, base: r.ctx.base, theirsRev: r.ident.rev, source, fileName: opts.fileName,
            reason, open: false, pointTaken: true, quiet: true, part: r.ctx.part || null });
        if (res && res.ok) { result.merged++; result.storedIds.push(r.entry.id); } else { result.failedIds.push(r.entry.id); result.skipped++; }
    }
    if (replaces.length) {
        const stored = importBinderSitesOverOpen(replaces.map((r) => r.site), { replace: replaces.map((r) => r.entry.id) });
        if (!stored) return null;
        result.replaced += replaces.filter((r) => stored.storedIds.includes(r.entry.id)).length;
        result.storedIds.push(...stored.storedIds);
    }
    const fresh = rows.filter((r) => r.kind === 'add').map((r) => r.site);
    const copySites = copies.map((r) => {
        const rev = validRev(r.site.rev) || validRev(r.site.base);
        const out = Object.assign({}, r.site, { id: mintLibraryId(), name: t('{name} (copy)', { name: String(r.site.name || '').trim() || r.entry.name }) });
        delete out.rev; delete out.prior; delete out.template; delete out.block;
        if (rev) out.base = rev; else delete out.base;
        return out;
    });
    if (fresh.length || copySites.length) {
        const stored = importBinderSites([...fresh, ...copySites]);
        if (!stored) return null;
        result.added += fresh.filter((s) => stored.storedIds.includes(s.id)).length;
        result.copied += copySites.filter((s) => stored.storedIds.includes(s.id)).length;
        result.skipped += stored.skipped;
        // A copy's base is the content it arrived as.
        copies.forEach((r, i) => {
            const rev = validRev(r.site.rev);
            if (rev && stored.storedIds.includes(copySites[i].id)) recordRevision(copySites[i].id, rev, r.site.doc, 'opened');
        });
        // Fresh sites stored under their own ids; copies count as stored for the site they came from.
        result.storedIds.push(...fresh.map((s) => s.id).filter((id) => stored.storedIds.includes(id)));
        copies.forEach((r, i) => { if (stored.storedIds.includes(copySites[i].id)) result.storedIds.push(r.entry.id); });
    }
    return result;
}
// The toast for a binder door's result.
function binderMergeText(result) {
    if (!result) return '';
    const text = t('Binder loaded: {added} added, {merged} merged, {kept} already up to date.',
        { added: result.added + result.copied, merged: result.merged, kept: result.kept });
    const more = [];
    if (result.replaced) more.push(t(result.replaced === 1 ? '{n} replaced by its copy.' : '{n} replaced by their copies.', { n: result.replaced }));
    if (result.skipped) more.push(t('{n} skipped.', { n: result.skipped }));
    return joinSentences([text, ...more]);
}

// Published for tests/suites/mergedoors.js.
window.TopoMergeDoors = { mergeTargets, pickMergeTarget, mergeContext, mergeCopyInto, mergeCardInto, mergeFileIntoCard, openCardMerge,
    classifyBinderSites, binderMergeSites, binderMergeText, setMergeSummaryResponder, showMergeSummary, mergeSummaryOpen, mergeModeNote,
    mergeIdentOf, mergeRevIsMine };
