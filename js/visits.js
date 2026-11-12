// ---- Visits waiting: provider visits through the owner (docs/SCOPE.md step 7, D139, D153, D154, D180-D190) ----
// Every visit a provider records comes back to the network's owner and
// waits for them; nothing merges on its own. Two ways back, one list:
//
//   * link or file: the copy the provider sent back (Record visit's link or
//     file, a binder site) is kept here as it arrived (the key store,
//     IndexedDB) until it is decided, one per provider and report: a newer
//     copy for the same report replaces it (it holds the older visit too);
//   * on a Topo server: the provider's browser uploads a visit copy
//     (js/serversync.js uploadVisit), which waits on the server; an owner's
//     browser lists it, opens it (the signature checked against the trusted
//     roster) and reviews it three-way against the revision it was made on.
//
// Every visit opens the merge review (js/mergeui.js), whose foot then asks
// two things: the changes (apply as reviewed, or reject: nothing applied)
// and the visit (Successful: the report is marked fixed; Not successful: it
// opens again one round up, as Reopen does, with the note for the
// provider; Undecided: it stays as it is). Either way a 'decision' entry
// goes into the network's log (format v19), in the same undo step as the
// merge. A rejected copy is downloaded as a file. On a server the answer is
// sent once what was written is on the server, and the provider is told by
// email (the visit-recorded event) and takes the server's version.
//
// On a server, a copy's changes to items outside what its provider covers
// are marked "outside what X covers" and left out unless applied (the
// review's own question per row; js/merge.js scope).
//
// Translated: the client reads all of it.

const VW_PREFIX = 'topo-visit-wait|';
const _vw = {
    local: new Map(),       // key -> the copy kept here (link, file, binder)
    loaded: false, loading: null,
    server: new Map(),      // cardId -> { at, rows: [{ hdr, info, err }] }
    opened: new Map(),      // server copy id -> { env } (decrypted once)
    fetching: new Map(),    // cardId -> promise
    hooks: { now: () => Date.now(), serverMs: 30000 }
};
const vwEl = (id) => document.getElementById(id);
const VC = () => window.TopoServerCrypto;
const VY = () => window.TopoServerSync;
const VT = () => window.TopoServer;

// ---- What a copy brings ----
const vwLog = (doc) => (doc && Array.isArray(doc.log) ? doc.log.filter((e) => e && typeof e === 'object') : []);
// The visit entry ids a 'decision' entry of any of the documents answers.
function visitDecidedIds(...docs) {
    const out = new Set();
    docs.forEach((d) => vwLog(d).forEach((e) => { if (e.kind === 'decision') (e.visits || []).forEach((id) => out.add(id)); }));
    return out;
}
// The visits `theirs` brings that `mine` has not got and nobody has decided
// on, oldest first.
function visitUndecided(theirs, mine) {
    const held = new Set(vwLog(mine).map((e) => e.id));
    const decided = visitDecidedIds(theirs, mine);
    return vwLog(theirs).filter((e) => e.kind === 'visit' && typeof e.id === 'string' && !held.has(e.id) && !decided.has(e.id))
        .sort((a, b) => (a.at || 0) - (b.at || 0));
}
// -> what the review and the list say of a copy, or null (no visit to
// decide on): { ids, visits, providerId, provider, visitBy, incidentId,
// symptom, at, count, changes }. The newest visit names the provider and
// the report; the decision answers every visit the copy brings.
function visitReviewInfo(theirs, mine) {
    const visits = visitUndecided(theirs, mine);
    if (!visits.length) return null;
    const e = visits[visits.length - 1];
    const incidentId = e.incidentId || null;
    const find = (doc) => (incidentId && doc && Array.isArray(doc.incidents) ? doc.incidents.find((x) => x && x.id === incidentId) : null) || null;
    const inc = find(theirs) || find(mine);
    const changes = visits.reduce((n, v) => { const c = v.changes && v.changes.counts; return n + (c ? (c.added || 0) + (c.changed || 0) + (c.removed || 0) : 0); }, 0);
    return { ids: visits.map((v) => v.id), visits, providerId: e.providerId || null, provider: e.provider || '', visitBy: e.by || '', incidentId,
        symptom: inc ? inc.symptom : '', at: e.at || 0, count: visits.length, changes };
}
const visitKey = (cardId, info) => [cardId || '', (info && (info.providerId || String(info.provider || '').trim().toLowerCase())) || '', (info && info.incidentId) || ''].join('|');
// "Juan Pérez (Andes IT)", or one of them, or "A provider".
function visitWho(info) {
    const by = info && info.visitBy, p = info && info.provider;
    if (by && p) return t('{by} ({provider})', { by, provider: p });
    return by || p || t('A provider');
}

// ---- The copies kept here (link, file, binder) ----
async function vwLoad() {
    if (_vw.loaded) return;
    if (_vw.loading) return _vw.loading;
    _vw.loading = (async () => {
        try {
            const all = VC() ? await VC().ksAll('sync') : [];
            (all || []).forEach((v) => { if (v && v.vw === 1 && typeof v.key === 'string' && !_vw.local.has(v.key)) _vw.local.set(v.key, v); });
        } catch (e) { /* memory only */ }
        _vw.loaded = true;
    })();
    return _vw.loading;
}
async function vwPut(rec) {
    _vw.local.set(rec.key, rec);
    try { if (VC()) await VC().ksPut('sync', VW_PREFIX + rec.key, rec); } catch (e) { /* this tab only */ }
}
async function vwDel(key) {
    const had = _vw.local.delete(key);
    try { if (VC()) await VC().ksDel('sync', VW_PREFIX + key); } catch (e) { /* gone with the tab */ }
    return had;
}
// A copy that came back (by link or file) and was not decided on yet:
// kept, replacing the one waiting for the same provider and report.
// o: { targetId, theirs, ident, source, fileName }. -> the record, or null.
async function visitKeepWaiting(o, info) {
    if (!o || !o.targetId || !o.theirs || !info) return null;
    await vwLoad();
    const key = visitKey(o.targetId, info);
    const was = _vw.local.get(key);
    const rec = {
        vw: 1, key, cardId: o.targetId, at: _vw.hooks.now(), source: o.source || 'link', fileName: o.fileName || '',
        ident: o.ident ? { id: o.ident.id || null, updated: o.ident.updated || 0, rev: o.ident.rev || null, base: o.ident.base || null, prior: (o.ident.prior || []).slice() } : null,
        doc: JSON.parse(JSON.stringify(o.theirs)), providerId: info.providerId, provider: info.provider, visitBy: info.visitBy,
        incidentId: info.incidentId, symptom: info.symptom, count: info.count, changes: info.changes, replaced: was ? (was.replaced || 0) + 1 : 0
    };
    await vwPut(rec);
    visitsWaitingChanged(o.targetId);
    return rec;
}
// A copy that arrived on screen by link or file (js/providermode.js
// noteArrival): kept waiting, so closing the tab does not lose it.
async function visitArrived(cardId, origin) {
    const card = cardId ? libraryEntry(cardId) : null;
    if (!card || !card.doc || card.template || card.block || state.readOnly) return null;
    const theirs = serializeDoc();
    const info = visitReviewInfo(theirs, card.doc);
    if (!info) return null;
    const ident = { id: state.docId, updated: state.docUpdated, rev: state.docRev, base: state.docBase, prior: (state.docPrior || []).slice() };
    return visitKeepWaiting({ targetId: cardId, theirs, ident, source: origin === 'file' ? 'file' : 'link' }, info);
}

// ---- The list ----
// Server copies of the card's site, opened (owners only), for the list.
async function refreshServerVisits(cardId, fresh) {
    const Y = VY();
    const r = Y && cardId ? Y.rec(cardId) : null;
    if (!r || r.role !== 'owner' || !VT() || !VT().ready()) { _vw.server.delete(cardId); return []; }
    if (_vw.fetching.has(cardId)) return _vw.fetching.get(cardId);
    const run = (async () => {
        let list;
        try { list = await Y.ownerVisits(r.siteId, fresh); } catch (e) { return (_vw.server.get(cardId) || {}).rows || []; }
        const card = libraryEntry(cardId);
        const rows = [];
        for (const hdr of list) {
            let o = _vw.opened.get(hdr.id);
            if (!o) {
                try { o = { env: (await Y.openVisitCopy(r.siteId, hdr, { base: false })).env }; } catch (e) { o = { err: e.code || 'error' }; }
                _vw.opened.set(hdr.id, o);
            }
            const info = o.env ? (visitReviewInfo(o.env.doc, card && card.doc) || { ids: [], visits: [], providerId: o.env.providerId || null, provider: '', visitBy: '',
                incidentId: o.env.incidentId || null, symptom: '', at: hdr.at, count: 0, changes: 0 }) : null;
            rows.push({ hdr, info, err: o.err || null });
        }
        _vw.server.set(cardId, { at: _vw.hooks.now(), rows });
        return rows;
    })();
    _vw.fetching.set(cardId, run);
    try { return await run; } finally { _vw.fetching.delete(cardId); }
}
// -> every copy waiting for card `cardId`, oldest first:
// [{ key, kind: 'local'|'server', at, info, rec?, hdr?, err? }].
function visitsWaitingFor(cardId) {
    if (!cardId) return [];
    const out = [];
    _vw.local.forEach((rec) => {
        if (rec.cardId !== cardId) return;
        out.push({ key: rec.key, kind: 'local', at: rec.at || 0, rec, info: { providerId: rec.providerId, provider: rec.provider, visitBy: rec.visitBy, incidentId: rec.incidentId,
            symptom: rec.symptom, count: rec.count || 1, changes: rec.changes || 0 } });
    });
    const srv = _vw.server.get(cardId);
    (srv ? srv.rows : []).forEach((row) => out.push({ key: 'server|' + row.hdr.id, kind: 'server', at: row.hdr.received || row.hdr.at || 0, hdr: row.hdr, info: row.info, err: row.err }));
    return out.sort((a, b) => a.at - b.at);
}
const visitsWaitingCount = (cardId) => visitsWaitingFor(cardId).length;
// The landing card's line: "Visits waiting: 2", or ''.
function landingVisitsText(cardId) {
    // The key store read once, then the landing drawn again with it.
    if (!_vw.loaded && !_vw.loading) vwLoad().then(() => { if (_vw.local.size && typeof landingIsOpen === 'function' && landingIsOpen() && typeof renderLanding === 'function') renderLanding(); });
    // A server card's copies, read for the landing too (an owner sees the
    // count without opening the network), then the landing drawn again.
    const Y = VY();
    const r = Y && cardId ? Y.rec(cardId) : null;
    const srv = _vw.server.get(cardId);
    if (r && r.role === 'owner' && VT() && VT().ready() && (!srv || _vw.hooks.now() - srv.at > _vw.hooks.serverMs) && !_vw.fetching.has(cardId)) {
        refreshServerVisits(cardId).then(() => {
            if (_vw.server.has(cardId) && typeof landingIsOpen === 'function' && landingIsOpen() && typeof renderLanding === 'function') renderLanding();
        });
    }
    const n = visitsWaitingCount(cardId);
    return n ? t(n === 1 ? 'A visit waits for your review' : 'Visits waiting: {n}', { n }) : '';
}
function visitRowWords(row) {
    const info = row.info || {};
    const what = info.symptom && typeof symptomLabel === 'function' ? symptomLabel(info.symptom) : '';
    const head = row.err ? t('A visit copy that could not be opened') : [visitWho(info), what].filter(Boolean).join(' · ');
    const bits = [];
    if (!row.err) {
        bits.push(info.count > 1 ? t('{n} visits', { n: info.count }) : t('One visit'));
        if (info.changes) bits.push(t(info.changes === 1 ? '1 change' : '{n} changes', { n: info.changes }));
    }
    bits.push(row.kind === 'server' ? t('On the server') : row.rec && row.rec.fileName && row.rec.source !== 'link' ? row.rec.fileName : t('By link'));
    if (row.at && typeof incidentWhen === 'function') bits.push(incidentWhen(row.at));
    return { head, line: bits.join(' · ') };
}
function renderVisitsWaitingInto(box, rows) {
    if (!box) return;
    box.textContent = '';
    box.classList.toggle('hidden', !rows.length);
    if (!rows.length) return;
    const h = document.createElement('p');
    h.className = 'rail-sub vw-sub';
    h.textContent = rows.length === 1 ? t('A visit waits for your review') : t('Visits waiting: {n}', { n: rows.length });
    box.appendChild(h);
    const note = document.createElement('p');
    note.className = 'dlg-dim vw-note';
    note.textContent = t('Nothing a provider changed is applied until you review it.');
    box.appendChild(note);
    const ul = document.createElement('ul');
    ul.className = 'vw-list';
    rows.forEach((row) => {
        const li = document.createElement('li');
        li.className = 'vw-row';
        li.dataset.vwKey = row.key;
        const words = visitRowWords(row);
        const head = document.createElement('span');
        head.className = 'vw-head';
        head.textContent = words.head;
        const line = document.createElement('span');
        line.className = 'dlg-dim vw-line';
        line.textContent = words.line;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn vw-review';
        b.dataset.vwKey = row.key;
        b.textContent = t('Review…');
        b.disabled = !!row.err || state.readOnly;
        li.append(head, line, b);
        ul.appendChild(li);
    });
    box.appendChild(ul);
}
// The open card's list, in the Problems tab and the Simple view; a server
// card's copies are read when they are older than serverMs.
function renderVisitsWaiting() {
    const cardId = isKept() ? state.libraryId : null;
    const rows = cardId && !state.readOnly ? visitsWaitingFor(cardId) : [];
    renderVisitsWaitingInto(vwEl('visitsWaiting'), rows);
    renderVisitsWaitingInto(vwEl('visitsWaitingSimple'), isReduced() ? rows : []);
    const btn = vwEl('incTabBtn');
    if (btn && rows.length && !isReduced()) btn.classList.remove('hidden');
    if (!cardId) return;
    if (!_vw.loaded) { vwLoad().then(() => { if (state.libraryId === cardId) renderVisitsWaiting(); }); return; }
    const Y = VY();
    const r = Y ? Y.rec(cardId) : null;
    const srv = _vw.server.get(cardId);
    if (r && r.role === 'owner' && (!srv || _vw.hooks.now() - srv.at > _vw.hooks.serverMs) && !_vw.fetching.has(cardId)) {
        refreshServerVisits(cardId).then(() => { if (state.libraryId === cardId) renderVisitsWaiting(); if (typeof landingIsOpen === 'function' && landingIsOpen() && typeof renderLanding === 'function') renderLanding(); });
    }
}
// Something changed for card `cardId` (a copy kept, decided, or the server
// said so).
function visitsWaitingChanged(cardId) {
    if (cardId) { const s = _vw.server.get(cardId); if (s) s.at = 0; }
    if (state.libraryId === cardId || !cardId) renderVisitsWaiting();
    if (typeof landingIsOpen === 'function' && landingIsOpen() && typeof renderLanding === 'function') renderLanding();
}

// ---- Reviewing one ----
// A copy kept here: through the merge doors as it arrived (three-way when
// the part it answers is held). A server copy: opened, against its base.
async function reviewWaitingVisit(key) {
    await vwLoad();
    if (key.startsWith('server|')) {
        const id = key.slice(7);
        for (const [cardId, s] of _vw.server) {
            const row = (s.rows || []).find((x) => x.hdr.id === id);
            if (row) return reviewServerVisit(cardId, row.hdr);
        }
        return { ok: false, reason: 'gone' };
    }
    const rec = _vw.local.get(key);
    if (!rec) return { ok: false, reason: 'gone' };
    const card = libraryEntry(rec.cardId);
    if (!card) { await vwDel(key); visitsWaitingChanged(rec.cardId); return { ok: false, reason: 'target' }; }
    // Every visit it brings was answered already (through a newer copy that
    // held them too): nothing left to decide on.
    if (!visitReviewInfo(rec.doc, mergeMineNow(rec.cardId))) {
        await vwDel(key);
        visitsWaitingChanged(rec.cardId);
        showToast(t('This visit was already answered.'), 'ok');
        return { ok: false, reason: 'decided' };
    }
    const link = rec.source === 'link';
    const res = await mergeCopyInto(rec.cardId, rec.doc, { ident: rec.ident || undefined, source: link ? 'link' : rec.fileName || '',
        fileName: link ? '' : rec.fileName || '', reason: link ? 'Before merging a link' : rec.fileName ? 'Before merging {file}' : undefined });
    // Older than yours: nothing left to decide on.
    if (res && res.reason === 'ancestor') { await vwDel(key); visitsWaitingChanged(rec.cardId); }
    return res;
}
// What a server copy's provider covers (D154): their items in the copy and
// in its base, the reports routed to them, their own record. A provider not
// in the network covers nothing: every existing item is outside.
function visitScope(theirs, base, providerId) {
    const sc = { name: '', nodes: new Set(), links: new Set(), groups: new Set(), incidents: new Set(), providers: new Set() };
    if (!providerId) return sc;
    sc.providers.add(providerId);
    [theirs, base].forEach((doc) => {
        if (!doc) return;
        const p = (Array.isArray(doc.providers) ? doc.providers : []).find((x) => x && x.id === providerId);
        if (!p) return;
        if (!sc.name) sc.name = p.name || p.id;
        const part = typeof providerPart === 'function' ? providerPart(doc, [providerId]) : null;
        if (part && !part.whole) ['nodes', 'links', 'groups'].forEach((k) => part.items[k].forEach((id) => sc[k].add(id)));
        (Array.isArray(doc.incidents) ? doc.incidents : []).forEach((x) => { if (x && (x.routedTo || []).includes(providerId)) sc.incidents.add(x.id); });
    });
    return sc;
}
// The changes a rejected copy of the same provider made that `theirs`
// still carries as they were (D191): its items whose record differs from
// that copy's base and is the same in `theirs`. A provider keeps working on
// the card until the owner has answered every copy, so a later copy holds a
// rejected one's edits too; they are marked and left out unless applied.
// rejected: [{ doc, base }]. -> a Set of 'kind:id'.
function visitRejectedKeys(theirs, rejected) {
    const out = new Set();
    const byId = (doc, kind) => {
        const m = new Map();
        (doc && Array.isArray(doc[kind]) ? doc[kind] : []).forEach((x) => { if (x && typeof x === 'object' && typeof x.id === 'string') m.set(x.id, JSON.stringify(x)); });
        return m;
    };
    (rejected || []).forEach(({ doc, base }) => {
        if (!doc || !base) return;
        const kinds = new Set([...Object.keys(doc), ...Object.keys(base)].filter((k) => k !== 'log' && (Array.isArray(doc[k]) || Array.isArray(base[k]))));
        kinds.forEach((kind) => {
            const a = byId(doc, kind), b = byId(base, kind), th = byId(theirs, kind);
            new Set([...a.keys(), ...b.keys()]).forEach((id) => {
                if (a.get(id) === b.get(id)) return;
                if (th.get(id) === a.get(id)) out.add(kind + ':' + id);
            });
        });
    });
    return out;
}
// The same author's rejected copies still on the server, opened with
// their bases (at most 4, newest first). -> [{ doc, base }].
async function visitRejectedCopies(siteId, hdr) {
    const Y = VY();
    let all = [];
    try { all = await Y.siteVisits(siteId); } catch (e) { return []; }
    const rej = all.filter((v) => v.author === hdr.author && v.id !== hdr.id && v.state === 'rejected').sort((a, b) => (b.received || 0) - (a.received || 0)).slice(0, 4);
    const out = [];
    for (const v of rej) {
        try { const o = await Y.openVisitCopy(siteId, v); if (o.base) out.push({ doc: o.env.doc, base: o.base }); } catch (e) { /* not checked: not used */ }
    }
    return out;
}
async function reviewServerVisit(cardId, hdr) {
    const Y = VY();
    const r = Y ? Y.rec(cardId) : null;
    if (!r || r.role !== 'owner') return { ok: false, reason: 'target' };
    let opened;
    try { opened = await Y.openVisitCopy(r.siteId, hdr); }
    catch (e) { showToast(typeof TopoServerUI !== 'undefined' && TopoServerUI.errText ? TopoServerUI.errText(e) : t('The visit copy could not be opened.'), 'err'); return { ok: false, reason: 'open' }; }
    const mine = mergeMineNow(cardId);
    const env = opened.env;
    const info = visitReviewInfo(env.doc, mine) || { ids: [], visits: [], providerId: env.providerId || null, provider: '', visitBy: '', incidentId: env.incidentId || null,
        symptom: '', at: hdr.at, count: 0, changes: 0 };
    const pid = env.providerId || info.providerId;
    const scope = visitScope(env.doc, opened.base, pid);
    scope.rejected = visitRejectedKeys(env.doc, await visitRejectedCopies(r.siteId, hdr));
    if (!info.provider && scope.name) info.provider = scope.name;
    Object.assign(info, { serverId: hdr.id, siteId: r.siteId, email: hdr.email || '' });
    return openMergeReview({ targetId: cardId, theirs: env.doc, base: opened.base, theirsRev: env.rev, source: 'server', reason: 'Before merging from the server',
        open: true, scope, visit: info });
}

// ---- The decision ----
// The report's state after the owner's judgement (D153), on a document:
// successful closes it (the note as its close note), not successful opens
// it again one round up (as Reopen, D38), undecided leaves it.
function visitJudge(doc, incidentId, outcome, note, at) {
    const x = incidentId && doc && Array.isArray(doc.incidents) ? doc.incidents.find((i) => i && i.id === incidentId) : null;
    if (!x) return false;
    const n = String(note || '').trim().slice(0, INCIDENT_TEXT_MAX);
    if (outcome === 'successful') {
        if (x.status === 'closed') return false;
        x.status = 'closed';
        x.closedAt = at;
        if (n) x.closedNote = n; else delete x.closedNote;
        return true;
    }
    if (outcome === 'not-successful') {
        x.status = 'open';
        x.reopened = (Number.isInteger(x.reopened) && x.reopened > 0 ? x.reopened : 0) + 1;
        delete x.closedAt;
        delete x.closedNote;
        return true;
    }
    return false;
}
function visitDecisionEntry(info, dec, result, file) {
    return decisionLogEntry({ id: 'lg_' + randomToken(), at: _vw.hooks.now(), visits: info.ids || [], incidentId: info.incidentId || undefined,
        providerId: info.providerId || undefined, provider: info.provider || undefined, visitBy: info.visitBy || undefined,
        by: (typeof reportEngineerDefault === 'function' ? reportEngineerDefault() : '') || undefined, result, outcome: dec.outcome,
        note: String(dec.note || '').trim() || undefined, file: file || undefined });
}
// commitMerge's finish: the merged document with the judgement and the
// decision entry, in the same undo step.
async function visitFinishDoc(doc, info, dec, result, file) {
    const out = JSON.parse(JSON.stringify(doc));
    visitJudge(out, info.incidentId, dec.outcome, dec.note, _vw.hooks.now());
    return appendLogEntry(out, visitDecisionEntry(info, dec, result, file));
}
// The rejected copy as a file: { fileName, payload }. Downloaded only once
// the decision is written (a retried review downloads it once).
function visitRejectedFile(opts) {
    const theirs = opts.theirs;
    const card = libraryEntry(opts.targetId);
    const name = (card && card.name) || '';
    const id = (opts.ident && opts.ident.id) || opts.targetId;
    const f = networkJsonFile(name, id, (opts.ident && opts.ident.updated) || _vw.hooks.now(), theirs, todayISO(new Date(_vw.hooks.now())), { rev: validRev(opts.theirsRev) || undefined });
    return { fileName: f.fileName.replace(/\.json$/, '_rejected-visit.json'), payload: f.payload };
}
function visitDownloadRejected(f) {
    if (typeof _vw.hooks.download === 'function') _vw.hooks.download(f.payload, f.fileName);
    else downloadJson(f.payload, f.fileName);
}
// Reject: nothing of the copy applied; the judgement and the decision on
// the network as it is, one undo step on screen (the card opened first, as
// a merge opens it). -> { ok, entry, file } or { ok: false, reason }.
async function visitCommitReject(opts, info, dec) {
    const targetId = opts.targetId;
    const card = libraryEntry(targetId);
    if (!card) return { ok: false, reason: 'target' };
    if (opts.open !== false && state.libraryId !== targetId) {
        if (opts.replaceAsked) {
            replaceDocument(card.doc, { libraryId: card.id, origin: 'library' });
            if (typeof landingIsOpen === 'function' && landingIsOpen()) landingHandledDocument();
        } else await openFromLibrary(targetId);
        if (state.libraryId !== targetId || state.readOnly) return { ok: false, reason: 'cancelled' };
    }
    const f = visitRejectedFile(opts);
    const file = f.fileName;
    let entry = null;
    if (state.libraryId === targetId && isKept()) {
        flushAutosave();
        const res = await commitIncidentChange((doc) => {
            visitJudge(doc, info.incidentId, dec.outcome, dec.note, _vw.hooks.now());
            return { entry: visitDecisionEntry(info, dec, 'rejected', file) };
        });
        if (!res) return { ok: false, reason: 'stale' };
        entry = (state.log || [])[state.log.length - 1] || null;
    } else {
        const next = await visitFinishDoc(card.doc, info, dec, 'rejected', file);
        if (!writeMergeToCard(targetId, next)) return { ok: false, reason: 'storage' };
        entry = next.log[next.log.length - 1];
    }
    visitDownloadRejected(f);
    return { ok: true, entry, file, rejected: true };
}
// After either answer: the copy waits no more here; a server copy's answer
// goes once the network is on the server.
async function visitDecided(opts, info, dec, result) {
    await vwLoad();
    await vwDel(visitKey(opts.targetId, info));
    // An older copy whose visits this decision answered too (a newer copy
    // holds the older one's visit as well) waits no more either.
    const card = libraryEntry(opts.targetId);
    const now = card && state.libraryId === opts.targetId && isKept() ? serializeDoc() : card && card.doc;
    if (now) {
        for (const rec of [..._vw.local.values()]) {
            if (rec.cardId === opts.targetId && !visitReviewInfo(rec.doc, now)) await vwDel(rec.key);
        }
    }
    if (info.serverId && VY()) {
        _vw.opened.delete(info.serverId);
        const s = _vw.server.get(opts.targetId);
        if (s) s.rows = s.rows.filter((row) => row.hdr.id !== info.serverId);
        VY().queueDecision(opts.targetId, info.serverId, result);
    }
    visitsWaitingChanged(opts.targetId);
}
// The review answered (js/mergeui.js openMergeReview hands it over): the
// changes applied or not, the visit judged. dec: { changes, outcome, note }.
async function commitVisitDecision(opts, info, dec, merge) {
    const d = { changes: dec && dec.changes === 'reject' ? 'reject' : 'apply', outcome: VISIT_JUDGEMENTS.includes(dec && dec.outcome) ? dec.outcome : 'undecided', note: (dec && dec.note) || '' };
    let res;
    if (d.changes === 'reject') {
        res = await visitCommitReject(opts, info, d);
        if (res.ok) showToast(t('Visit rejected: nothing was applied. Its copy was kept as the file {file}.', { file: res.file }), 'ok');
    } else {
        res = await merge((doc) => visitFinishDoc(doc, info, d, 'approved'));
        if (res && res.ok) showToast(d.outcome === 'successful' ? t('Visit approved: the problem is marked fixed.') : d.outcome === 'not-successful'
            ? t('Visit approved: the problem is open again.') : t('Visit approved.'), 'ok');
    }
    if (res && res.ok) await visitDecided(opts, info, d, d.changes === 'reject' ? 'rejected' : 'approved');
    return res;
}

// ---- A decision in words (the log, the Problems tab) ----
const VISIT_JUDGEMENT_WORD = { successful: 'Successful', 'not-successful': 'Not successful', undecided: 'Undecided' };
function visitDecisionText(e) {
    const who = visitWho({ visitBy: e.visitBy, provider: e.provider });
    if (e.result === 'rejected') return e.note ? t('Visit by {who} rejected: {note}', { who, note: e.note }) : t('Visit by {who} rejected.', { who });
    return t('Visit by {who} approved: {outcome}.', { who, outcome: t(VISIT_JUDGEMENT_WORD[e.outcome] || 'Undecided') });
}
// The decision entries that answer visit entry `id`.
const visitDecisionsOf = (id, log = state.log) => (log || []).filter((e) => e && e.kind === 'decision' && (e.visits || []).includes(id));

(function wireVisitsWaiting() {
    ['visitsWaiting', 'visitsWaitingSimple'].forEach((id) => {
        const box = vwEl(id);
        if (!box) return;
        box.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-vw-key]');
            if (b && !b.disabled) reviewWaitingVisit(b.dataset.vwKey);
        });
    });
})();

// Tests: back to nothing.
function _vwReset() { _vw.local.clear(); _vw.server.clear(); _vw.opened.clear(); _vw.fetching.clear(); _vw.loaded = false; _vw.loading = null; }

window.TopoVisits = {
    _vw, _reset: _vwReset, hooks: _vw.hooks, visitUndecided, visitReviewInfo, visitDecidedIds, visitKey, visitWho, visitKeepWaiting, visitArrived, vwLoad, vwDel,
    refreshServerVisits, visitsWaitingFor, visitsWaitingCount, landingVisitsText, renderVisitsWaiting, visitsWaitingChanged, reviewWaitingVisit, reviewServerVisit,
    visitScope, visitRejectedKeys, visitJudge, visitFinishDoc, commitVisitDecision, visitDecisionText, visitDecisionsOf
};
