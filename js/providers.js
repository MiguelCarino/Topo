// ---- Providers in the editor (js/model.js "Providers", document v15) ----
// Who is responsible for what, so someone new to the site, or from another
// company, knows whom to call. The data is doc.providers, and node.provider,
// link.provider and group.provider name one by id. This file is where they
// are edited:
//
//   the Providers tab  one card per provider in the rail, next to Groups and
//                      Wi-Fi: its name, what it provides, how to reach it and
//                      what it answers for (devices, cables, groups), with
//                      Select what it covers, Edit and Delete. Empty, it
//                      offers the usual kinds (Internet, IT support, …) as
//                      one click each. Always offered in the full editor:
//                      any network has someone to call.
//   the pickers        a Provider select on a device (under its Group), on a
//                      cable (under its material) and on a group's card.
//                      Unset, a device's says who answers for it anyway (its
//                      host's provider, or its group's), and the last entry
//                      makes a new provider on the spot.
//
// Plain words, so translated, as the Groups tab is: a provider list is for
// whoever reads the report, technical or not. None of it is in a reduced
// view (data-adv, and isReduced()).
//
// Every edit is one undo step: a select through save(), typing through
// saveTyping(), several records at once through batch(). Which cards are
// open is a view held here for the session, never in the document.
// Load order: ... groups -> hosts -> wifi -> providers -> motion -> ... -> app

let _pvPanelDirty = true;
const _pvEditOpen = new Set();   // providers whose edit fields are open, this session

const pvPanel = () => document.getElementById('cfgPanel-providers');
const pvPanelShown = () => { const p = pvPanel(); return !!p && !p.classList.contains('hidden') && !isReduced(); };
const pvEl = (id) => document.getElementById(id);
// The Add entry's value in a picker: not an id Topo mints (pv…).
const PV_NEW = '__new_provider__';

// The usual kinds, one click each on the empty tab and under the cards.
const PV_PRESETS = ['internet', 'it', 'phone', 'security', 'power', 'vendor', 'cloud'];

// "3 devices · 1 cable · 2 groups", or nothing.
function providerCoversText(c) {
    const parts = [];
    if (c.nodes.length) parts.push(t(c.nodes.length === 1 ? '{n} device' : '{n} devices', { n: c.nodes.length }));
    if (c.links.length) parts.push(t(c.links.length === 1 ? '{n} cable' : '{n} cables', { n: c.links.length }));
    if (c.groups.length) parts.push(t(c.groups.length === 1 ? '{n} group' : '{n} groups', { n: c.groups.length }));
    return parts.join(' · ');
}
// How to reach them, one line: phone · email, and the hours.
const providerReachText = (p) => [p.phone, p.email].filter(Boolean).join(' · ');

// ============================================================================
// The Providers tab
// ============================================================================
function renderProvidersPanel(force) {
    const btn = pvEl('providerTabBtn');
    if (btn) btn.classList.toggle('hidden', isReduced());
    const panel = pvPanel();
    if (!panel) return;
    if (!pvPanelShown()) { _pvPanelDirty = true; return; }
    const active = document.activeElement;
    if (!force && active && panel.contains(active) && active.matches('input, select, textarea')) { _pvPanelDirty = true; return; }
    _pvPanelDirty = false;
    const d = active && panel.contains(active) && active.dataset;
    const refocus = d && d.pv ? (d.act ? `[data-act="${CSS.escape(d.act)}"][data-pv="${CSS.escape(d.pv)}"]`
        : d.field ? `[data-field="${CSS.escape(d.field)}"][data-pv="${CSS.escape(d.pv)}"]` : null) : null;
    const list = pvEl('providerList');
    const all = state.providers || [];
    list.innerHTML = all.length ? withLookupPass(() => all.map(providerCardHtml).join('')) + providerMorePresetsHtml(all) : providerEmptyHtml();
    if (refocus) { const again = panel.querySelector(refocus); if (again) again.focus(); }
}

function providerEmptyHtml() {
    return `<p class="rail-note">${escapeHtml(t('No providers yet. Add who is responsible for what here (the internet line, IT support, the alarm company), so anyone new knows whom to call.'))}</p>
        <div class="wifi-presets pv-presets">
            ${PV_PRESETS.map((k) => `<button type="button" class="btn" data-act="preset" data-pv="${k}">+ ${escapeHtml(providerServiceLabel(k))}</button>`).join('')}
        </div>`;
}
// Under the cards, the kinds nobody provides yet stay one click each.
function providerMorePresetsHtml(all) {
    const have = new Set(all.map((p) => p.service).filter(Boolean));
    const left = PV_PRESETS.filter((k) => !have.has(k));
    return left.length ? `<div class="chip-row wifi-presets-more" role="group" aria-label="${escapeHtml(t('Add a provider'))}">
            ${left.map((k) => `<button type="button" class="fchip" data-act="preset" data-pv="${k}">+ ${escapeHtml(providerServiceLabel(k))}</button>`).join('')}
        </div>` : '';
}

function providerCardHtml(p) {
    const id = escapeHtml(p.id);
    const open = _pvEditOpen.has(p.id);
    const c = providerCovers(p.id);
    const covers = providerCoversText(c);
    const reach = providerReachText(p);
    const option = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    // Every field has its form history off, as it always had. Spellcheck is
    // off on the names, numbers and addresses but not on the support hours,
    // a sentence (its schema keys are prose), which a desktop browser goes on
    // underlining as it did.
    const field = (key, label, attrs = '', cls = '') => {
        const keys = schemaKeys(PROVIDER_FIELDS, key);
        const prose = keys === 'prose';
        return `<div class="${cls}">
                <label class="prop-lbl" for="pv-${id}-${key}">${escapeHtml(t(label))}</label>
                <input id="pv-${id}-${key}" type="text" class="input" data-field="${key}" data-pv="${id}" value="${escapeHtml(p[key] || '')}"
                    maxlength="${key === 'name' ? PROVIDER_NAME_MAX : PROVIDER_TEXT_MAX}"${keyboardAttrs(keys, { quiet: !prose })}${prose ? ' autocomplete="off"' : ''} ${attrs}>
            </div>`;
    };
    const covered = c.nodes.length + c.links.length;
    return `<article class="net-card pv-card" data-pv="${id}">
        <div class="net-head">
            <span class="grp-name${p.name ? '' : ' net-muted'}">${escapeHtml(providerLabel(p))}</span>
            ${p.service ? `<span class="chip-tag">${escapeHtml(providerServiceLabel(p.service))}</span>` : ''}
        </div>
        ${p.contact ? `<div class="net-line">${escapeHtml(p.contact)}</div>` : ''}
        <div class="net-line">${reach ? escapeHtml(reach) : `<span class="net-muted">${escapeHtml(t('No phone or email yet.'))}</span>`}</div>
        ${p.hours ? `<div class="net-line">${escapeHtml(p.hours)}</div>` : ''}
        ${p.account ? `<div class="net-line mono">${escapeHtml(p.account)}</div>` : ''}
        <div class="net-line${covers ? '' : ' net-muted'}">${escapeHtml(covers ? t('Responsible for {what}', { what: covers }) : t('Not responsible for anything on the map yet.'))}</div>
        <div class="net-actions">
            <button type="button" class="link-btn" data-act="covers" data-pv="${id}" ${covered ? '' : 'disabled'}
                title="${escapeHtml(t('Select every device and cable this provider is responsible for and show them on the map'))}">${escapeHtml(t('Select what it covers'))}</button>
            <button type="button" class="link-btn" data-act="edit" data-pv="${id}" aria-expanded="${open}">${escapeHtml(t(open ? 'Close' : 'Edit'))}</button>
            <button type="button" class="link-btn quiet" data-act="delete" data-pv="${id}">${escapeHtml(t('Delete'))}</button>
        </div>
        <div class="net-edit prop-grid"${open ? '' : ' hidden'}>
            ${field('name', 'Name', '', 'span2')}
            <div class="span2">
                <label class="prop-lbl" for="pv-${id}-service">${escapeHtml(t('Service'))}</label>
                <select id="pv-${id}-service" class="select" data-field="service" data-pv="${id}">
                    ${option('', '—', !p.service)}${PROVIDER_SERVICES.map((k) => option(k, providerServiceLabel(k), p.service === k)).join('')}
                </select>
            </div>
            ${field('contact', 'Contact person', '', 'span2')}
            ${field('phone', 'Phone')}
            ${field('email', 'Email')}
            ${field('account', 'Account / contract')}
            ${field('hours', 'Support hours / SLA', '', '')}
            <div class="span2">
                <label class="prop-lbl" for="pv-${id}-notes">${escapeHtml(t('Notes'))}</label>
                <textarea id="pv-${id}-notes" class="input" rows="3" data-field="notes" data-pv="${id}" maxlength="${PROVIDER_NOTES_MAX}"${keyboardAttrs('prose')}>${escapeHtml(p.notes || '')}</textarea>
            </div>
            <p class="rail-note span2">${escapeHtml(t('Set it on a device, a cable or a group (everything inside a group that names none of its own).'))}</p>
        </div>
    </article>`;
}

// After a provider edit: the tab, the selection's picker, the findings.
function refreshProviderViews(force) {
    renderProvidersPanel(force);
    const one = soleSelected(state.selection);
    if (one && one.type === 'link') renderLinkProviderPicker(getLink(one.id));
    else if (one && one.type === 'node' && getNode(one.id)) renderNodeProviderPicker(getNode(one.id));
    refreshSelectedNodeDiagnostics();
}

const PV_TYPED = ['name', 'contact', 'phone', 'email', 'account', 'hours', 'notes'];
function onProviderField(e) {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    if (e.type === 'input' && el.matches('select')) return;   // a select's edit is its change
    const p = providerById(el.dataset.pv);
    if (!p || readOnlyRefuses()) { renderProvidersPanel(true); return; }
    const key = el.dataset.field;
    const f = PROVIDER_FIELDS.find((x) => x.key === key);
    if (!f) return;
    if (PV_TYPED.includes(key)) {
        // Typed: one undo step per field edit. Its change only marks the tab
        // out of date; the rebuild waits for the focus to leave the tab.
        if (e.type === 'change') { _pvPanelDirty = true; return; }
        const v = fieldRead(f)(el.value, p);
        if (v === undefined) delete p[key]; else p[key] = v;
        el.classList.toggle('invalid', key === 'email' && !providerEmailOk(el.value));
        saveTyping();
        renderTyped();
        return;
    }
    if (e.type !== 'change') return;
    if (key === 'service') { const v = asProviderService(el.value); if (v) p.service = v; else delete p.service; }
    save();
    renderCanvasOnly();
    refreshProviderViews(true);
}

async function onProviderAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.pv;
    if (act === 'edit') {
        if (_pvEditOpen.has(id)) _pvEditOpen.delete(id); else _pvEditOpen.add(id);
        renderProvidersPanel(true);
        // Its name ready to type, but not on a touch screen (onGroupAction, js/groups.js).
        if (_pvEditOpen.has(id)) { const f = pvPanel().querySelector(`[data-pv="${CSS.escape(id)}"][data-field="name"]`); if (f) focusForTyping(f, null, { reveal: true }); }
        return;
    }
    if (act === 'covers') { selectProviderCovers(id); return; }
    if (readOnlyRefuses()) return;
    if (act === 'preset') { addProviderPreset(id); return; }
    if (act === 'delete') await deleteProvider(id);
}

// Made, one undo step. -> the record, or null (read-only, or the list full).
function addProviderRecord(fields) {
    if (readOnlyRefuses()) return null;
    if ((state.providers || []).length >= PROVIDER_MAX) { showToast(t('A network holds at most {n} providers.', { n: PROVIDER_MAX })); return null; }
    const p = makeProvider(fields);
    batch(() => { state.providers = (state.providers || []).concat(p); save(); renderCanvasOnly(); });
    return p;
}
// One of the usual kinds, opened on its card with the name to type.
function addProviderPreset(service) {
    if (!PROVIDER_SERVICES.includes(service)) return null;
    const p = addProviderRecord({ service });
    if (!p) return null;
    _pvEditOpen.add(p.id);
    refreshProviderViews(true);
    const f = pvPanel() && pvPanel().querySelector(`[data-pv="${CSS.escape(p.id)}"][data-field="name"]`);
    // As a card's Edit does (onGroupAction, js/groups.js).
    if (f) focusForTyping(f, null, { reveal: true });
    return p;
}
// + Provider: its name asked, the rest left to the card. -> the record, or null.
async function addProvider(opts = {}) {
    if (readOnlyRefuses()) return null;
    const text = await askPrompt(t('The provider\'s name, as it should be printed:'), { title: t('Add a provider'), ok: t('Add') });
    if (text === null) return null;
    const name = providerLine(PROVIDER_NAME_MAX)(text);
    if (!name) { showToast(t('A new provider needs a name.')); return null; }
    const p = addProviderRecord({ name, service: opts.service });
    if (!p) return null;
    if (opts.open !== false) _pvEditOpen.add(p.id);
    refreshProviderViews(true);
    return p;
}

// What named it stays where it is and names nobody instead. One step.
async function deleteProvider(id) {
    const p = providerById(id);
    if (!p) return false;
    const c = providerCovers(id);
    const n = c.own.length + c.links.length + c.groups.length;
    const ok = await askConfirm(t(n === 0 ? 'Delete the provider {name}?' : n === 1
        ? 'Delete the provider {name}? The one device, cable or group set to it stays, with no provider.'
        : 'Delete the provider {name}? The {n} devices, cables and groups set to it stay, with no provider.', { name: providerLabel(p), n }),
        { title: t('Delete provider'), ok: t('Delete'), danger: true });
    if (!ok || !providerById(id)) return false;
    batch(() => {
        state.providers = state.providers.filter((x) => x.id !== id);
        normalizeProviderRefs();
        _pvEditOpen.delete(id);
        save(); renderCanvasOnly();
    });
    refreshProviderViews(true);
    return true;
}

// Everything it covers selected and brought into view. -> the entries.
function selectProviderCovers(id) {
    const c = withLookupPass(() => providerCovers(id));
    const entries = c.nodes.map((n) => ({ type: 'node', id: n.id })).concat(c.links.map((l) => ({ type: 'link', id: l.id })));
    if (!entries.length) return [];
    selectEntries(entries);
    const nodes = c.nodes.length ? c.nodes : c.links.flatMap((l) => [getNode(l.source), getNode(l.target)]).filter(Boolean);
    centreOnNodes(nodes);
    return entries;
}

// The hover's words (Settings: Show the provider on hover): what it is, who
// answers for it and how to reach them. r is nodeProvider()'s answer, or
// null. -> '' when nobody does.
function providerTipText(name, r) {
    if (!r || !r.provider) return '';
    const p = r.provider;
    const whose = r.via === 'group' ? t('through {name}', { name: groupLabel(r.from) })
        : r.via === 'host' ? t('through {name}', { name: r.from.name || r.from.id }) : '';
    return [name,
        `${t('Provider')}: ${providerLabel(p)}${p.service ? ` · ${providerServiceLabel(p.service)}` : ''}${whose ? ` (${whose})` : ''}`,
        [p.contact, p.phone, p.email].filter(Boolean).join(' · '),
        p.hours || ''].filter(Boolean).join('\n');
}

// ============================================================================
// The pickers: a device, a cable, a group
// ============================================================================
// The options of a Provider select: none (saying what answers instead, when
// something does), every provider, and New provider…
function providerOptionsHtml(selected, noneText) {
    const option = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const sorted = (state.providers || []).slice().sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)));
    return option('', noneText || t('— None'), !selected)
        + sorted.map((p) => option(p.id, providerLabel(p) + (p.service ? ` · ${providerServiceLabel(p.service)}` : ''), selected === p.id)).join('')
        + (readOnlyDoc() ? '' : option(PV_NEW, t('+ New provider…'), false));
}
const readOnlyDoc = () => !!state.readOnly;
// "From its group Server room: Acme IT" for a device that names none itself.
function inheritedProviderText(node) {
    const r = node && !node.provider ? nodeProvider(node) : null;
    if (!r) return '';
    return r.via === 'host'
        ? t('From its host {name}: {provider}', { name: r.from.name || r.from.id, provider: providerLabel(r.provider) })
        : t('From its group {name}: {provider}', { name: groupLabel(r.from), provider: providerLabel(r.provider) });
}
function renderNodeProviderPicker(node) {
    const sel = pvEl('propProvider');
    if (!sel) return;
    const inherited = inheritedProviderText(node);
    sel.innerHTML = providerOptionsHtml(node && node.provider, inherited ? t('— As its group or host') : t('— None'));
    sel.value = node && providerById(node.provider) ? node.provider : '';
    const note = pvEl('providerNote');
    if (note) { note.textContent = inherited; note.classList.toggle('hidden', !inherited); }
}
function renderLinkProviderPicker(link) {
    const box = pvEl('linkProviderProps'), sel = pvEl('propLinkProvider');
    if (!box || !sel) return;
    box.classList.toggle('hidden', !link || isReduced());
    if (!link) return;
    sel.innerHTML = providerOptionsHtml(link.provider);
    sel.value = providerById(link.provider) ? link.provider : '';
}
// A picker's value onto `rec` (a device, a cable or a group), New provider…
// asking its name first. One undo step, with the new provider when one is
// made. -> true when it changed.
async function pickProvider(rec, value) {
    if (!rec || readOnlyRefuses()) return false;
    let id = value || '';
    let made = null;
    if (id === PV_NEW) {
        const text = await askPrompt(t('The provider\'s name, as it should be printed:'), { title: t('Add a provider'), ok: t('Add') });
        const name = text === null ? '' : providerLine(PROVIDER_NAME_MAX)(text);
        if (!name) { if (text !== null) showToast(t('A new provider needs a name.')); return false; }
        if ((state.providers || []).length >= PROVIDER_MAX) { showToast(t('A network holds at most {n} providers.', { n: PROVIDER_MAX })); return false; }
        made = makeProvider({ name });
        id = made.id;
    }
    if (!made && id && !providerById(id)) id = '';
    if ((rec.provider || '') === id && !made) return false;
    batch(() => {
        if (made) state.providers = (state.providers || []).concat(made);
        if (id) rec.provider = id; else delete rec.provider;
        save(); renderCanvasOnly();
    });
    refreshProviderViews(true);
    return true;
}

(function wireProviders() {
    const panel = pvPanel();
    if (panel) {
        panel.addEventListener('input', onProviderField);
        panel.addEventListener('change', onProviderField);
        panel.addEventListener('click', onProviderAction);
        panel.addEventListener('focusout', () => setTimeout(() => { if (_pvPanelDirty) renderProvidersPanel(); }, 0));
    }
    const add = pvEl('addProviderBtn');
    if (add) add.addEventListener('click', () => addProvider());
    const nodeSel = pvEl('propProvider');
    if (nodeSel) nodeSel.addEventListener('change', async (e) => {
        const node = state.selectedType === 'node' ? getNode(state.selectedId) : null;
        await pickProvider(node, e.target.value);
        if (node) renderNodeProviderPicker(getNode(node.id) || node);
    });
    const linkSel = pvEl('propLinkProvider');
    if (linkSel) linkSel.addEventListener('change', async (e) => {
        const link = state.selectedType === 'link' ? getLink(state.selectedId) : null;
        await pickProvider(link, e.target.value);
        if (link) renderLinkProviderPicker(getLink(link.id) || link);
    });
})();
