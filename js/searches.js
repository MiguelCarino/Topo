// ---- Saved searches in the search bar (docs/BACKLOG.md feature 6, stage 2) ----
// A search typed in the full editor's box, kept under a name in the network
// (doc.searches, SEARCH_FIELDS in js/model.js). Two controls:
//   * ☆ Save search, the last button of the search's tools card
//     (#queryTools, after Locate). Enabled on a search Topo understands that
//     uses nothing only this browser can answer (queryLocalTerms: was:,
//     has:history). When the box holds a saved search's text it reads
//     ★ Update saved search and edits that one.
//   * ▾ Saved, at the end of the box (#queryBar), only while the network has
//     a saved search. Its menu has a row per search: the name runs it
//     (setQuery, so the map dims and the table filters as a typed search
//     would), with its count worked out live and a 🖨 when it prints, then
//     Edit and Delete. On a phone the panel is a sheet under the bar.
// The dialog (#searchDialog) holds the name, the search as typed (parsed
// live, with the box's "Not understood" line), the Devices columns to print
// in their order (Name always first, or "as the Devices table shows them",
// which stores no columns), a sort and whether the site report prints it.
// Each save, update and delete is one batch()+save(): one undo step, and
// refused on a read-only network. Running a search is a view, never an edit,
// so it works there too. Full editor only (data-adv), like the box.
// Loaded after js/query.js and before js/bulk.js; updateQueryBar (js/query.js)
// calls updateSavedSearchBar at run time.

const sqEl = (id) => document.getElementById(id);
const sqText = () => String(state.query || '').trim();
// The saved search whose text the box holds, or null.
const searchByQuery = (text) => {
    const v = String(text == null ? '' : text).trim();
    return v ? (state.searches || []).find((s) => s.query === v) || null : null;
};

// Why a search cannot be saved as it stands, or ''. The order is the order a
// visitor fixes them in: what the search says, then its name, then room.
// exceptId: the search being edited (its own name is no clash).
function searchProblem(fields, exceptId) {
    const query = String(fields.query || '').trim();
    if (!query) return t('A saved search needs a search.');
    // Over the limit the model keeps no query at all (searchQuery), and the
    // next load would drop the whole search; a cut query matches something else.
    if (query.length > SEARCH_QUERY_MAX) return t('A saved search can be at most {n} characters long.', { n: SEARCH_QUERY_MAX });
    const local = queryLocalTerms(query);
    if (local.length) return t('{terms} reads what this browser remembers, so a saved search cannot use it: it would match differently on another computer.', { terms: local.join(' ') });
    const parsed = parseQuery(query);
    if (parsed.errors.length) return t('Not understood, so nothing matches: {terms}', { terms: parsed.errors.join(' ') });
    if (!parsed.terms.length) return t('A saved search needs a search.');
    const name = searchName(fields.name);
    if (!name) return t('A saved search needs a name.');
    // searchColumns would keep the first SEARCH_COLUMNS_MAX and drop the rest.
    if (Array.isArray(fields.columns) && fields.columns.length > SEARCH_COLUMNS_MAX) return t('A saved search can print at most {n} columns.', { n: SEARCH_COLUMNS_MAX });
    const low = name.toLowerCase();
    if ((state.searches || []).some((s) => s.id !== exceptId && s.name.toLowerCase() === low)) return t('A saved search with this name already exists.');
    if (!exceptId && (state.searches || []).length >= SEARCH_MAX) return t('A network can keep at most {n} saved searches.', { n: SEARCH_MAX });
    return '';
}

// ---- The edits: one undo step each ----
function searchEdit(fn) {
    let out;
    batch(() => { out = fn(); save(); });
    updateQueryBar();
    renderSavedMenu();
    return out;
}
// -> the new search, or null (and why, as a toast) when it is refused.
function saveSearch(fields) {
    if (readOnlyRefuses()) return null;
    const why = searchProblem(fields);
    if (why) { showToast(why, 'err'); return null; }
    const s = makeSearch(Object.assign({}, fields, { query: String(fields.query).trim() }));
    return searchEdit(() => { state.searches = (state.searches || []).concat(s); return s; });
}
function updateSearch(id, fields) {
    const old = searchById(id);
    if (!old || readOnlyRefuses()) return null;
    const merged = Object.assign({}, old, fields, { id });
    const why = searchProblem(merged, id);
    if (why) { showToast(why, 'err'); return null; }
    const s = readFields(SEARCH_FIELDS, Object.assign({}, merged, { query: String(merged.query).trim() }));
    return searchEdit(() => { state.searches = state.searches.map((x) => (x.id === id ? s : x)); return s; });
}
// Asks first. -> a Promise of whether it went.
function deleteSearch(id) {
    const s = searchById(id);
    if (!s || readOnlyRefuses()) return Promise.resolve(false);
    return askConfirm(t('Delete the saved search {name}?', { name: s.name }), { ok: t('Delete saved search'), danger: true })
        .then((yes) => {
            if (!yes || !searchById(id)) return false;
            searchEdit(() => { state.searches = state.searches.filter((x) => x.id !== id); });
            return true;
        });
}
// A view: the box takes the search's text, exactly as typed.
function runSavedSearch(id) {
    const s = searchById(id);
    if (!s) return false;
    setQuery(s.query);
    return true;
}

// ---- The bar: ☆ in the card, ▾ in the box ----
// -> whether the ▾ shows (updateQueryBar's shape, for the row's height).
function updateSavedSearchBar(q = activeQuery()) {
    const btn = sqEl('querySaveBtn'), menu = sqEl('querySavedMenu');
    if (!btn || !menu) return false;
    const saved = searchByQuery(sqText());
    const local = queryLocalTerms(sqText());
    btn.textContent = saved ? `★ ${t('Update saved search')}` : `☆ ${t('Save search')}`;
    btn.classList.toggle('on', !!saved);
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    const tooLong = sqText().length > SEARCH_QUERY_MAX;
    btn.disabled = !saved && (!q || !!q.errors.length || !q.terms.length || !!local.length || tooLong);
    btn.title = local.length && !saved
        ? t('{terms} reads what this browser remembers, so a saved search cannot use it: it would match differently on another computer.', { terms: local.join(' ') })
        : tooLong && !saved ? t('A saved search can be at most {n} characters long.', { n: SEARCH_QUERY_MAX })
        : saved ? t('Update saved search') : t('Save search');
    const any = !isReduced() && (state.searches || []).length > 0;
    menu.classList.toggle('hidden', !any);
    if (!any) closeSavedMenu();
    return any;
}

// ---- The Saved menu ----
function closeSavedMenu() {
    const panel = sqEl('querySavedPanel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    sqEl('querySavedBtn').setAttribute('aria-expanded', 'false');
}
// Built when it opens and after each edit while it is open: the counts are
// the register as it is now, in one lookup pass for every row.
function renderSavedMenu() {
    const list = sqEl('querySavedList'), panel = sqEl('querySavedPanel');
    if (!list || !panel || panel.hidden) return;
    const current = searchByQuery(sqText());
    const rows = withLookupPass(() => (state.searches || []).map((s) => {
        const parsed = parseQuery(s.query);
        const local = queryLocalTerms(s.query);
        let note, cls = '', title = '';
        if (local.length) {
            note = t('This browser only'); cls = ' warn';
            title = t('{terms} reads what this browser remembers, so a saved search cannot use it: it would match differently on another computer.', { terms: local.join(' ') });
        } else if (parsed.errors.length) {
            note = t('Not understood'); cls = ' err';
            title = t('Not understood, so nothing matches: {terms}', { terms: parsed.errors.join(' ') });
        } else note = t('Devices: {n}', { n: queryMatchCount(s.query, parsed) });
        const name = escapeHtml(s.name);
        return `<li class="sq-row${current && current.id === s.id ? ' current' : ''}" role="none">
            <button type="button" class="cs-menu-item sq-run" role="menuitem" data-run="${escapeHtml(s.id)}" title="${escapeHtml(s.query)}">
                <span class="sq-name">${name}</span>
                <span class="sq-meta"><span class="sq-count${cls}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(note)}</span>${s.print
                    ? `<span class="sq-print" title="${escapeHtml(t('Prints in the site report'))}" aria-label="${escapeHtml(t('Prints in the site report'))}">🖨</span>` : ''}</span>
            </button>
            <span class="sq-acts">
                <button type="button" class="cs-btn sq-act" data-edit="${escapeHtml(s.id)}" aria-label="${escapeHtml(t('Edit {name}', { name: s.name }))}">${escapeHtml(t('Edit'))}</button>
                <button type="button" class="cs-btn sq-act danger" data-delete="${escapeHtml(s.id)}" aria-label="${escapeHtml(t('Delete {name}', { name: s.name }))}">${escapeHtml(t('Delete'))}</button>
            </span>
        </li>`;
    }));
    list.innerHTML = rows.join('');
}

// ---- The dialog ----
// What it is editing: editId null for a new one; cols the columns in the
// order they are listed (ticked ones first, in their order), ticked the keys
// that print, unknown the stored keys this build does not draw (or that do
// not apply to this network now: kept where they stood), stored the search's
// columns as it came, keepSort its sort when that is no choice here (kept,
// offered as it is, so a rename does not lose it).
let _sq = { editId: null, cols: [], ticked: new Set(), unknown: [], stored: null, keepSort: '' };

const sqColLabel = (c) => (c.custom ? ((customColumnById(c.custom) || {}).name || c.key) : tvLabel(c));
// Every column a search may print, in the Devices table's order; one that
// applies only to some networks (the Wi-Fi ones) while it applies.
const sqAvailable = () => tvDevicesOrder().filter((c) => !c.when || c.when());
const sqTableKeys = () => tvDevicesArranged().filter((c) => c.key !== TV_FIXED_COL && (!c.when || c.when())).map((c) => c.key);

function openSearchDialog(id) {
    if (isReduced() || readOnlyRefuses()) return false;
    const s = id ? searchById(id) : null;
    if (id && !s) return false;
    if (!s && (state.searches || []).length >= SEARCH_MAX) {
        showToast(t('A network can keep at most {n} saved searches.', { n: SEARCH_MAX }), 'err');
        return false;
    }
    closeSavedMenu();
    if (typeof flushQuery === 'function') flushQuery();
    const avail = sqAvailable(), known = new Set(avail.map((c) => c.key));
    const stored = s && s.columns ? s.columns : null;
    const ticked = stored ? stored.filter((k) => known.has(k)) : sqTableKeys();
    _sq = { editId: s ? s.id : null, ticked: new Set(ticked), unknown: stored ? stored.filter((k) => !known.has(k)) : [],
        cols: ticked.concat(avail.map((c) => c.key).filter((k) => !ticked.includes(k))), stored, keepSort: (s && s.sort) || '' };
    const text = s ? s.query : sqText();
    sqEl('sqTitle').textContent = t(s ? 'Update saved search' : 'Save search');
    sqEl('sqName').value = s ? s.name : searchName(text) || '';
    sqEl('sqQuery').value = text;
    sqEl('sqColsTable').checked = !stored;
    sqEl('sqPrint').checked = s ? !!s.print : true;
    renderSearchDialog(s ? s.sort || '' : '', !!(s && s.desc));
    const scrim = sqEl('searchDialog');
    // On a touch screen, closing goes back to the card's ☆ (★ once saved),
    // not into the search box and its keyboard; and the name waits for a tap
    // (focusForTyping, js/dialog.js). Not the ▾: it is hidden until a first
    // search is kept, and a hidden button cannot take the focus.
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { returnFocus: typingTarget(sqEl('queryInput'), sqEl('querySaveBtn')) });
    else scrim.hidden = false;
    focusForTyping(sqEl('sqName'), scrim.querySelector('.modal'), { select: true });
    return true;
}
function closeSearchDialog() {
    const scrim = sqEl('searchDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
}
const sqColsShown = () => (sqEl('sqColsTable').checked ? sqTableKeys() : _sq.cols.filter((k) => _sq.ticked.has(k)));
// A sort key as an option: its column when Topo draws one, else the key itself.
const sqSortCol = (key) => tvDevicesOrder().find((x) => x.key === key) || { key, label: key };
// The ticked columns with the stored keys this dialog does not list put back
// where they stood: each after the stored key before it that is still there.
function sqWithUnknown(shown) {
    const out = shown.slice(), stored = _sq.stored || [];
    stored.forEach((k, i) => {
        if (!_sq.unknown.includes(k) || out.includes(k)) return;
        let at = 0;
        for (let j = i - 1; j >= 0; j--) { const p = out.indexOf(stored[j]); if (p >= 0) { at = p + 1; break; } }
        out.splice(at, 0, k);
    });
    return out;
}

// The list, the sort's choices and the live checks. sort/desc: what to pick
// (default: what is picked now).
function renderSearchDialog(sort = sqEl('sqSort').value, desc = sqEl('sqDesc').checked) {
    const asTable = sqEl('sqColsTable').checked;
    const byKey = new Map(sqAvailable().map((c) => [c.key, c]));
    const order = asTable ? sqTableKeys().concat(_sq.cols.filter((k) => !sqTableKeys().includes(k))) : _sq.cols;
    const on = new Set(asTable ? sqTableKeys() : [..._sq.ticked]);
    const nameCol = TV_COLS.devices.find((c) => c.key === TV_FIXED_COL);
    const keys = order.filter((k) => byKey.has(k));
    const row = (c, i) => {
        const label = escapeHtml(sqColLabel(c));
        const fixed = c.key === TV_FIXED_COL;
        const dis = fixed || asTable;
        return `<li class="cols-row sq-col${dis ? ' dim' : ''}" data-key="${escapeHtml(c.key)}">
            <label class="sq-col-pick"><input type="checkbox" data-pick="${escapeHtml(c.key)}"${fixed || on.has(c.key) ? ' checked' : ''}${dis ? ' disabled' : ''}>
            <span class="cols-label">${label}</span></label>
            <span class="cols-acts">${fixed ? '' : `
                <button type="button" class="cs-btn cols-mv" data-move="-1" data-key="${escapeHtml(c.key)}"${dis || i === 0 ? ' disabled' : ''} title="${escapeHtml(t('Move up'))}" aria-label="${escapeHtml(t('Move up'))}">↑</button>
                <button type="button" class="cs-btn cols-mv" data-move="1" data-key="${escapeHtml(c.key)}"${dis || i === keys.length - 1 ? ' disabled' : ''} title="${escapeHtml(t('Move down'))}" aria-label="${escapeHtml(t('Move down'))}">↓</button>`}
            </span>
        </li>`;
    };
    sqEl('sqColsList').innerHTML = row(nameCol, -1) + keys.map((k, i) => row(byKey.get(k), i)).join('');
    // Sort by: as listed, Name, or a column that prints.
    const choices = [nameCol].concat(sqColsShown().map((k) => byKey.get(k)).filter(Boolean));
    // The search's own sort stays on offer when it is no choice here (a
    // column hidden in the table, one this build does not draw), so editing
    // anything else keeps it.
    if (_sq.keepSort && !choices.some((c) => c.key === _sq.keepSort)) choices.push(sqSortCol(_sq.keepSort));
    if (!choices.some((c) => c.key === sort)) sort = '';
    sqEl('sqSort').innerHTML = `<option value="">${escapeHtml(t('As listed'))}</option>`
        + choices.map((c) => `<option value="${escapeHtml(c.key)}"${c.key === sort ? ' selected' : ''}>${escapeHtml(c.label != null ? c.label : sqColLabel(c))}</option>`).join('');
    sqEl('sqSort').value = sort;
    sqEl('sqDesc').disabled = !sort;
    sqEl('sqDesc').checked = !!sort && desc;
    checkSearchDialog();
}

// The search as typed, parsed live: the box's "Not understood" line, the
// refusal of a browser-local term, the hint about type names, and whatever
// else stops the save.
function checkSearchDialog() {
    const query = sqEl('sqQuery').value.trim();
    const parsed = parseQuery(query);
    const local = queryLocalTerms(query);
    const err = sqEl('sqQueryError');
    const line = local.length
        ? t('{terms} reads what this browser remembers, so a saved search cannot use it: it would match differently on another computer.', { terms: local.join(' ') })
        : parsed.errors.length ? t('Not understood, so nothing matches: {terms}', { terms: parsed.errors.join(' ') }) : '';
    err.textContent = line;
    err.classList.toggle('hidden', !line);
    sqEl('sqQuery').classList.toggle('bad', !!line);
    // A type name typed in the page's language (type:Cámara) matches only in
    // that language; the key, or the English name, matches in every one.
    const english = (v) => Object.entries(NODE_TYPE_NAMES).some(([k, nm]) => k === v || String(nm).toLowerCase().includes(v));
    const typeBound = !line && parsed.terms.some((term) => term.def === Q_PREFIXES.type && !english(term.q.v));
    sqEl('sqTypeHint').classList.toggle('hidden', !typeBound);
    // Unticking every column would store none, which means "as the Devices
    // table shows them": the opposite of what was picked.
    const none = !sqEl('sqColsTable').checked && !sqColsShown().length && !_sq.unknown.length;
    const why = line ? '' : none ? t('Tick at least one column, or As the Devices table shows them.')
        : searchProblem(readSearchDialog(), _sq.editId || undefined);
    sqEl('sqProblem').textContent = why;
    sqEl('sqProblem').classList.toggle('hidden', !why);
    sqEl('sqSaveBtn').disabled = !!(line || why);
    return !(line || why);
}
// The fields as the dialog holds them. "As the Devices table shows them"
// stores no columns; otherwise the ticked ones in their order, with any this
// dialog does not list where they stood.
function readSearchDialog() {
    const sort = sqEl('sqSort').value || undefined;
    const columns = sqEl('sqColsTable').checked ? undefined : sqWithUnknown(sqColsShown());
    return { name: sqEl('sqName').value, query: sqEl('sqQuery').value.trim(), columns: columns && columns.length ? columns : undefined,
        sort, desc: sort && sqEl('sqDesc').checked ? true : undefined, print: sqEl('sqPrint').checked ? true : undefined };
}
function submitSearchDialog() {
    if (!checkSearchDialog()) return null;
    const fields = readSearchDialog();
    const s = _sq.editId ? updateSearch(_sq.editId, fields) : saveSearch(fields);
    if (s) closeSearchDialog();
    return s;
}

(function wireSavedSearches() {
    const btn = sqEl('querySaveBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (typeof flushQuery === 'function' && !flushQuery()) return;
        const saved = searchByQuery(sqText());
        openSearchDialog(saved ? saved.id : null);
    });
    // The ▾ is a .cs-menu (carino-ui.js opens and closes it); the rows are
    // drawn as it opens.
    sqEl('querySavedBtn').addEventListener('click', () => setTimeout(renderSavedMenu, 0));
    sqEl('querySavedList').addEventListener('click', (e) => {
        const run = e.target.closest('[data-run]');
        if (run) { runSavedSearch(run.dataset.run); return; }
        const edit = e.target.closest('[data-edit]');
        if (edit) { e.stopPropagation(); openSearchDialog(edit.dataset.edit); return; }
        const del = e.target.closest('[data-delete]');
        if (del) { e.stopPropagation(); deleteSearch(del.dataset.delete); }
    });
    sqEl('sqQuery').addEventListener('input', checkSearchDialog);
    sqEl('sqName').addEventListener('input', checkSearchDialog);
    sqEl('sqColsTable').addEventListener('change', () => renderSearchDialog());
    sqEl('sqSort').addEventListener('change', () => renderSearchDialog());
    sqEl('sqColsList').addEventListener('change', (e) => {
        const key = e.target.dataset && e.target.dataset.pick;
        if (!key) return;
        if (e.target.checked) _sq.ticked.add(key); else _sq.ticked.delete(key);
        renderSearchDialog();
    });
    sqEl('sqColsList').addEventListener('click', (e) => {
        const mv = e.target.closest('[data-move]');
        if (!mv) return;
        const at = _sq.cols.indexOf(mv.dataset.key), to = at + Number(mv.dataset.move);
        if (at < 0 || to < 0 || to >= _sq.cols.length) return;
        [_sq.cols[at], _sq.cols[to]] = [_sq.cols[to], _sq.cols[at]];
        renderSearchDialog();
        const again = sqEl('sqColsList').querySelector(`[data-move="${mv.dataset.move}"][data-key="${CSS.escape(mv.dataset.key)}"]`);
        if (again && !again.disabled) again.focus();
    });
    sqEl('sqSaveBtn').addEventListener('click', submitSearchDialog);
    ['sqName', 'sqQuery'].forEach((id) => sqEl(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitSearchDialog(); }
    }));
})();
