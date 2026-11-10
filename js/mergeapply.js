// ---- Applying a merge (docs/SCOPE.md section 3, step 2, stage 3) ----
// The engine (js/merge.js) says what a merge would do; this writes it into a
// kept network, the same way every time, whichever door it came through:
//
//   1. refused up front: a read-only network on screen (made by a newer
//      Topo), a copy made by a newer Topo, a template or a block;
//   2. a restore point of the network first ("Before merging {file}"),
//      which may ask when it cannot be stored (keepRestorePoints): Cancel
//      stops here, nothing changed;
//   3. planned again from the network as it is now (a plan reviewed a
//      minute ago is never what is written: the open network's last edit is
//      flushed into it first). The choices carry over by key; when the
//      conflicts themselves changed, nothing is written and the review is
//      asked for again (reason 'stale');
//   4. the merged document, with an entry at the end of its log (source,
//      who: Settings' prepared-by name, counts, mode, the revision merged
//      in), chained to the entry before it (prev, SHA-256);
//   5. written: on screen, one undo step (batch: load, save, draw), so
//      Ctrl+Z takes the whole merge back, its log entry with it; a card not
//      open is written in place, as a restore is. Then saved at once;
//   6. the copy merged in is kept in the revision store under the card
//      (merge-theirs). That, with the log entry's rev, is the base the
//      network's next copy goes out with (outgoingBase, js/revisions.js):
//      undo the merge and the entry goes, and the base with it (A1). The
//      result itself is not kept as a revision (A23): it gets one when it
//      leaves.
//
// The log is also shown here, read-only (the Export menu's Network log…, a
// card's ≡ tool), and printed by the report's Network log tick (js/report.js).

const MERGE_REASONS = ['Before merging {file}', 'Before merging a link', 'Before merging a binder', 'Before merging {name}', 'Before merging from the server'];
const _mergeApply = { applying: false };

// The keys of what is in conflict in a plan, in order: two plans with the
// same keys ask the same questions, so the answers given to one fit the other.
function mergeConflictKeys(plan) {
    const keys = [];
    const walk = (it) => {
        if (it.conflict && it.conflict.type !== 'fields') keys.push(`${it.key}@${it.conflict.type}`);
        (it.fields || []).forEach((f) => { if (f.conflict) keys.push(`${it.key}#${f.field}`); });
        (it.children || []).forEach(walk);
    };
    ((plan && plan.items) || []).forEach(walk);
    return keys.join('\n');
}

// Where a merge came from, as the log and the restore point name it: a
// file by its name only (never its folder), else 'link', 'binder' or a
// card's name.
function mergeSourceName(source) {
    const s = String(source == null ? '' : source).trim();
    return (s.split(/[\\/]/).pop() || '').slice(0, 200);
}

// The network log entry's words, in this language: built from its kind,
// counts and source, its English summary only for a kind this build reads
// but has no words for.
function logSourceText(source) {
    if (source === 'link') return t('a link');
    if (source === 'binder') return t('a binder');
    // A Topo server's copy (js/serversync.js).
    if (source === 'server') return t('the server');
    return source || t('a copy');
}
function logEntryText(e) {
    if (!e) return '';
    if (e.kind === 'merge') {
        const c = e.counts || {};
        return t((c.conflicts || 0) === 1 ? 'Merged {source}: {added} added, {changed} changed, {removed} removed, {conflicts} conflict.' : 'Merged {source}: {added} added, {changed} changed, {removed} removed, {conflicts} conflicts.',
            { source: logSourceText(e.source), added: c.added || 0, changed: c.changed || 0, removed: c.removed || 0, conflicts: c.conflicts || 0 });
    }
    // A problem report's events and a provider's visits (js/incidents.js,
    // js/providermode.js), in the reader's language.
    if (e.kind === 'incident' && typeof incidentLogText === 'function') return incidentLogText(e);
    if (e.kind === 'visit' && typeof visitLineText === 'function') return visitLineText(e);
    return e.summary || e.kind;
}
const logModeText = (e) => (e && e.mode === 'three-way' ? t('Three-way merge') : e && e.mode === 'two-way' ? t('Two-way merge') : '');

// ---- Commit ----
// opts:
//   targetId   the kept network (a card id) merged into;
//   theirs     the copy merged in (a document, its identity included or not);
//   base       the copy both started from (a document), or null: two-way;
//   theirsRev  the revision theirs carried (its `rev`), if any;
//   choices    the review's answers ({} or omitted: every default);
//   plan       the plan the review showed, when there was one: if the
//              network has changed so that its conflicts are not the same,
//              nothing is written (reason 'stale');
//   source     what the log calls it: a file name, 'link', 'binder', a card's name;
//   reason     the restore point's reason (RESTORE_REASONS), with fileName
//              or name for its placeholder;
//   open       false: a card not on screen is written in place and stays
//              closed (a binder's merges); otherwise it is opened first,
//              so the merge is the undo step on screen;
//   replaceAsked  the door already asked whether the canvas may be
//              replaced: the target opens without asking again;
//   pointTaken the restore point was taken already (a binder's batch);
//   quiet      no toast (a binder door says one for all).
// -> { ok: true, counts, entry, notes, mode } or { ok: false, reason }:
//    'busy', 'target', 'read-only', 'newer', 'cancelled', 'stale', 'storage'.
async function commitMerge(opts = {}) {
    if (_mergeApply.applying) return { ok: false, reason: 'busy' };
    const targetId = opts.targetId;
    const card = targetId ? libraryEntry(targetId) : null;
    if (!card || !card.doc || card.template || card.block) return { ok: false, reason: 'target' };
    if (migrateDoc(card.doc).newer || (state.libraryId === targetId && state.readOnly)) {
        if (state.libraryId === targetId && state.readOnly) readOnlyRefuses();
        else showToast(t('This network is read-only: it was made by a newer version of Topo.'));
        return { ok: false, reason: 'read-only' };
    }
    const theirs = opts.theirs;
    if (!isDocShape(theirs)) return { ok: false, reason: 'target' };
    if (migrateDoc(theirs).newer) {
        showToast(t('This copy was made by a newer version of Topo, so it cannot be merged. Open it as a copy to read it.'));
        return { ok: false, reason: 'newer' };
    }
    const base = opts.base && isDocShape(opts.base) && !migrateDoc(opts.base).newer ? opts.base : null;
    const theirsRev = typeof validRev === 'function' ? validRev(opts.theirsRev) : null;
    const source = mergeSourceName(opts.source);
    const choices = opts.choices && typeof opts.choices === 'object' ? opts.choices : {};
    _mergeApply.applying = true;
    try {
        // The review shuts before anything can ask a question (A13).
        if (typeof closeMergeDialog === 'function') closeMergeDialog();
        // The restore point first (a binder door took them as one batch:
        // pointTaken), before anything on screen changes, so a Cancel
        // there leaves the screen as it was.
        if (!opts.pointTaken) {
            const reason = opts.reason || (source ? 'Before merging {file}' : 'Before opening a file');
            const reasonArgs = {};
            if (opts.fileName || reason.includes('{file}')) reasonArgs.fileName = opts.fileName || source;
            // keepRestorePoints names a point's file by fileName; {name} rides the same field.
            if (reason.includes('{name}')) reasonArgs.fileName = opts.name || source;
            if (!(await keepRestorePoints([targetId], reason, reasonArgs))) return { ok: false, reason: 'cancelled' };
        }
        // On screen, so Ctrl+Z is the merge. replaceAsked: the door already
        // asked whether the canvas may go (a file opened, a link kept), so
        // it is not asked again.
        if (opts.open !== false && state.libraryId !== targetId) {
            if (opts.replaceAsked) {
                const entry = libraryEntry(targetId);
                replaceDocument(entry.doc, { libraryId: entry.id, origin: 'library' });
                if (typeof landingIsOpen === 'function' && landingIsOpen()) landingHandledDocument();
            } else await openFromLibrary(targetId);
            if (state.libraryId !== targetId || state.readOnly) return { ok: false, reason: 'cancelled' };
        }

        const live = state.libraryId === targetId && isKept();
        // The network as it is now (A12): the open one's last edit included.
        if (live) flushAutosave();
        const mineJson = live ? JSON.stringify(serializeDoc()) : JSON.stringify((libraryEntry(targetId) || {}).doc || null);
        const mine = JSON.parse(mineJson);
        if (!mine) return { ok: false, reason: 'target' };
        const plan = planMerge(mine, theirs, base);
        if (opts.plan && mergeConflictKeys(opts.plan) !== mergeConflictKeys(plan)) {
            showToast(t('The network changed since the merge was reviewed: review it again.'));
            return { ok: false, reason: 'stale', plan };
        }
        const { doc, counts, notes } = applyMergePlan(mine, plan, choices);
        const by = typeof reportEngineerDefault === 'function' ? reportEngineerDefault() : '';
        const entry = mergeLogEntry({ id: 'lg_' + randomToken(), at: Date.now(), source, by, counts, mode: plan.mode, rev: theirsRev || undefined });
        const merged = await appendLogEntry(doc, entry);
        // The chain's digest is the one await after planning: anything that
        // moved the network meanwhile is not overwritten.
        const nowJson = live ? (state.libraryId === targetId ? JSON.stringify(serializeDoc()) : null)
            : JSON.stringify((libraryEntry(targetId) || {}).doc || null);
        if (nowJson !== mineJson) {
            showToast(t('The network changed since the merge was reviewed: review it again.'));
            return { ok: false, reason: 'stale', plan };
        }
        const before = new Set((mine.nodes || []).map((n) => n.id));
        if (live) {
            if (!writeMergeOnScreen(merged, before)) return { ok: false, reason: 'storage' };
        } else if (!writeMergeToCard(targetId, merged)) {
            showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err');
            return { ok: false, reason: 'storage' };
        }
        // The copy merged in, under its revision: the next copy of this
        // network names it as its base (outgoingBase reads the log entry).
        // What that revision holds is the copy as it LEFT: a link visited
        // and edited before Keep merges the canvas, which the rev never held,
        // and a later copy naming the rev must not take the edits as its
        // base (they would read as removed by the other side). The tab's
        // copy of the arrival is recorded instead when it has one.
        if (theirsRev && typeof recordRevision === 'function' && !hasRevision(targetId, theirsRev)) {
            if (typeof hasSessionRevision === 'function' && hasSessionRevision(theirsRev)) adoptSessionRevisions(targetId, [theirsRev], 'merge-theirs');
            else recordRevision(targetId, theirsRev, theirs, 'merge-theirs');
        }
        if (typeof landingIsOpen === 'function' && landingIsOpen() && typeof renderLanding === 'function') renderLanding();
        // A report brought in open or sent: the provider's banner (an IT firm
        // that holds the client's network opened what the client sent;
        // js/providermode.js).
        if (live && typeof providerMergeArrival === 'function') providerMergeArrival(mine);
        // All four counts: a merge that removed devices says so.
        if (!opts.quiet) showToast(t(counts.conflicts === 1 ? 'Merged {source}: {added} added, {changed} changed, {removed} removed, {conflicts} conflict.' : 'Merged {source}: {added} added, {changed} changed, {removed} removed, {conflicts} conflicts.', Object.assign({ source: logSourceText(source) }, counts)), 'ok');
        return { ok: true, counts, entry: (merged.log || [])[merged.log.length - 1] || entry, notes, mode: plan.mode };
    } finally {
        _mergeApply.applying = false;
    }
}

// The open network becomes the merged one in one undo step (batch: one
// save, one history record, one draw), and is saved at once. The devices
// added are selected, and the map fits when one is out of sight.
function writeMergeOnScreen(merged, before) {
    state.linkSourceId = null;
    if (typeof cancelTypedRender === 'function') cancelTypedRender();
    batch(() => {
        loadDocState(merged);
        pruneHostFolds();
        pruneSelection();
        save();
        renderCanvasOnly();
    });
    flushAutosave();   // a refusal shows the storage banner; the merge stays on screen and in the undo
    if (typeof renderGroupsPanel === 'function') renderGroupsPanel();
    if (typeof updateQueryBar === 'function') updateQueryBar();
    if (typeof renderSavedMenu === 'function') renderSavedMenu();
    if (typeof refreshLifeDialog === 'function') refreshLifeDialog();
    const added = state.nodes.filter((n) => !before.has(n.id));
    if (added.length) {
        selectEntries(added.map((n) => ({ type: 'node', id: n.id })));
        const v = mapViewport();
        const { x, y, zoom } = state.camera;
        const m = 70;
        if (added.some((nd) => nd.x * zoom + x < v.left + m || nd.x * zoom + x > v.left + v.width - m || nd.y * zoom + y < v.top + m || nd.y * zoom + y > v.top + v.height - m)) fitToView();
    } else renderSelection();
    updateUndoButtons();
    renderDocBar();
    return true;
}

// A card not on screen, written in place (as restoreFromPoint does): its
// revision fields stay (the rev is checked against the content before it is
// reused, js/revisions.js stampCard), `updated` moves on.
function writeMergeToCard(targetId, merged) {
    const lib = loadLibrary();
    const cur = lib[targetId];
    if (!cur) return false;
    lib[targetId] = Object.assign({}, cur, { doc: merged, updated: Math.max(Date.now(), (cur.updated || 0) + 1) });
    return persistLibrary(lib);
}

// ---- The network log, read-only ----
// A network's log, newest first: the open one's (state.log, as on screen,
// so an undone merge is not listed) or a card's.
let _logDialogCard = undefined;
function logOf(cardId) {
    if (!cardId || (cardId === state.libraryId && isKept())) return normalizeLog(state.log);
    const card = libraryEntry(cardId);
    return card && card.doc ? normalizeLog(card.doc.log) : [];
}
const logWhenText = (at) => (typeof restoreWhenText === 'function' ? restoreWhenText(at) : new Date(at).toLocaleString());

function renderLogDialog() {
    const el = (id) => document.getElementById(id);
    const cardId = _logDialogCard;
    const card = cardId ? libraryEntry(cardId) : null;
    el('logName').textContent = card ? card.name : (typeof docDisplayName === 'function' ? docDisplayName() : '');
    const log = logOf(cardId);
    el('logEmpty').classList.toggle('hidden', log.length > 0);
    const list = el('logList');
    list.textContent = '';
    log.slice().reverse().forEach((e) => {
        const li = document.createElement('li');
        li.className = 'restore-row log-row';
        li.dataset.id = e.id;
        const text = document.createElement('div');
        text.className = 'restore-text';
        const when = document.createElement('span');
        when.className = 'restore-when';
        when.textContent = logWhenText(e.at);
        const what = document.createElement('span');
        what.className = 'restore-why';
        what.textContent = logEntryText(e);
        const how = document.createElement('span');
        how.className = 'restore-n';
        how.textContent = [logModeText(e), e.by ? t('by {name}', { name: e.by }) : ''].filter(Boolean).join(' · ');
        text.append(when, what);
        if (how.textContent) text.append(how);
        li.append(text);
        list.appendChild(li);
    });
    // The chain checked (js/merge.js verifyLog): a hint, never a finding.
    const hint = el('logHint');
    hint.textContent = '';
    hint.classList.add('hidden');
    const asked = cardId;
    verifyLog(log).then((i) => {
        if (i < 0 || _logDialogCard !== asked || !logDialogOpen()) return;
        hint.textContent = t('The entry of {date} does not follow from the one before it: this log was edited outside Topo.', { date: logWhenText(log[i].at) });
        hint.classList.remove('hidden');
    }).catch(() => { /* no digest: nothing said */ });
}
function logDialogOpen() {
    const scrim = document.getElementById('logDialog');
    return !!scrim && !scrim.hidden;
}
// cardId: a card's log; null or omitted: the network on screen.
function openLogDialog(cardId) {
    const scrim = document.getElementById('logDialog');
    if (!scrim) return;
    if (cardId && !libraryEntry(cardId)) return;
    _logDialogCard = cardId || null;
    if (window.CarinoUI) CarinoUI.modal.open(scrim, {});
    else scrim.hidden = false;
    renderLogDialog();
}
function closeLogDialog() {
    const scrim = document.getElementById('logDialog');
    if (!scrim) return;
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
}
(function wireLogDialog() {
    const scrim = document.getElementById('logDialog');
    if (!scrim) return;
    scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeLogDialog));
})();

// ---- In the report ----
// The report's Network log section (REPORT_SECTIONS 'log', off unless
// ticked): newest first, at most REPORT_LOG_MAX, then how many earlier.
const REPORT_LOG_MAX = 50;
function logReportSection(log) {
    const list = normalizeLog(log);
    const lead = `<p class="muted">${escapeHtml(t('What was merged into this network from other copies, newest first. The log travels with the network.'))}</p>`;
    const shown = list.slice().reverse().slice(0, REPORT_LOG_MAX);
    const rows = shown.map((e) => `<tr>
        <td>${escapeHtml(localDateOf(e.at))}</td>
        <td>${escapeHtml(logEntryText(e))}${e.mode ? ` <span class="muted">${escapeHtml(logModeText(e))}</span>` : ''}</td>
        <td>${e.by ? escapeHtml(e.by) : '<span class="muted">—</span>'}</td>
    </tr>`).join('');
    const more = list.length > shown.length ? `<p class="muted">${escapeHtml(tn(list.length - shown.length, '…and {n} earlier entry.', '…and {n} earlier entries.'))}</p>` : '';
    return `${lead}<table class="changes">
        <thead><tr><th>${escapeHtml(t('Date'))}</th><th>${escapeHtml(t('Merge'))}</th><th>${escapeHtml(t('Prepared by'))}</th></tr></thead>
        <tbody>${rows}</tbody></table>${more}`;
}

// Published for tests/suites/mergeapply.js.
window.TopoMergeApply = { MERGE_REASONS, commitMerge, mergeConflictKeys, mergeSourceName, logEntryText, logOf,
    openLogDialog, closeLogDialog, renderLogDialog, logReportSection, REPORT_LOG_MAX, state: _mergeApply };
