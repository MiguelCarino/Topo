// ---- Providers in the editor (js/model.js "Providers", document v15) ----
// Who is responsible for what, so someone new to the site, or from another
// company, knows whom to call. The data is doc.providers, and node.providers,
// link.providers and group.providers name them by id (several per item since
// v18; inheritance is per service, nodeProviders). This file is where they
// are edited:
//
//   the Providers tab  one card per provider in the rail, next to Groups and
//                      Wi-Fi: its name, what it provides, how to reach it and
//                      what it answers for (devices, cables, groups), with
//                      Select what it covers, Edit and Delete. Empty, it
//                      offers the usual kinds (Internet, IT support, …) as
//                      one click each. Always offered in the full editor:
//                      any network has someone to call.
//   the pickers        a Providers list on a device (under its Group), on a
//                      cable (under its material) and on a group's card:
//                      chips with ✕ and an Add provider… select. A device's
//                      says who answers for the services it names nobody for
//                      (its host's providers, or its groups'), and the last
//                      entry makes a new provider on the spot.
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
    phoneFields(list);   // the phone's country pick (js/phone.js)
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
            <button type="button" class="link-btn" data-act="problem" data-pv="${id}"
                title="${escapeHtml(t('Report a problem with what they look after: they are ticked as the recipient and their report goes with it'))}">${escapeHtml(t('Report a problem to them'))}</button>
            ${window.TopoReports ? `<button type="button" class="link-btn" data-act="monitoring" data-pv="${id}"
                title="${escapeHtml(t('Availability of their devices against their target, response times and outages over a period'))}">${escapeHtml(t('Monitoring report'))}</button>` : ''}
            <button type="button" class="link-btn" data-act="sharepart" data-pv="${id}"
                title="${escapeHtml(t('A locked link that carries only what this provider looks after'))}">${escapeHtml(t('Share their part'))}</button>
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
            <div>
                <label class="prop-lbl" for="pv-${id}-target">${escapeHtml(t('Availability target (%)'))}</label>
                <input id="pv-${id}-target" type="text" class="input mono" data-field="target" data-pv="${id}" maxlength="7"${keyboardAttrs('dec')} placeholder="99.5" value="${escapeHtml(p.target != null ? String(p.target) : '')}">
            </div>
            <label class="span2 pv-tick"><input type="checkbox" data-field="targetHours" data-pv="${id}"${p.targetHours ? ' checked' : ''}> <span>${escapeHtml(t('Judge the target only during their support hours'))}</span></label>
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
    // The availability target (v19, step 7j), when the field is left: one
    // undo step; what does not read as a target clears it.
    if (key === 'target') { const v = asTarget(el.value); if (v === undefined) delete p.target; else p.target = v; }
    if (key === 'targetHours') { if (el.checked) p.targetHours = true; else delete p.targetHours; }
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
    // Their report (D98) is Export's Provider report… and the send step's
    // Print their report (D365).
    // Their monitoring report (js/reports.js, step 7j).
    if (act === 'monitoring') { if (window.TopoReports) await TopoReports.openMonitoringReport({ scope: 'provider', id, period: 'month' }); return; }
    if (readOnlyRefuses()) return;
    // Their part as a locked link (js/share.js), any time.
    if (act === 'sharepart') { openShareDialog('doc', { providerIds: [id] }); return; }
    // Report a problem to them (js/incidents.js, D365).
    if (act === 'problem') { if (typeof openProblemFor === 'function') openProblemFor(id); return; }
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
// answers for it and how to reach them, one provider a line. list is
// nodeProviders()'s answer ([{ provider, via, from }]), or a cable's records
// (linkProviders). -> '' when nobody does.
function providerTipText(name, list) {
    const rows = (Array.isArray(list) ? list : []).map((r) => (r && r.provider ? r : { provider: r, via: 'own' })).filter((r) => r.provider);
    if (!rows.length) return '';
    const lines = [name];
    rows.forEach((r) => {
        const p = r.provider;
        const whose = r.via === 'group' ? t('through {name}', { name: groupLabel(r.from) })
            : r.via === 'host' ? t('through {name}', { name: r.from.name || r.from.id }) : '';
        lines.push(`${t('Provider')}: ${providerLabel(p)}${p.service ? ` · ${providerServiceLabel(p.service)}` : ''}${whose ? ` (${whose})` : ''}`);
        const reach = [p.contact, p.phone, p.email].filter(Boolean).join(' · ');
        if (reach) lines.push(reach);
        if (p.hours) lines.push(p.hours);
    });
    return lines.join('\n');
}

// ============================================================================
// The pickers: a device, a cable, a group
// ============================================================================
// An item names several providers (v18): its list as chips, each with ✕ to
// remove it, and an "Add provider…" select of the providers it does not name
// yet, then New provider…. Each add or remove is one undo step.
const providerOptionText = (p) => providerLabel(p) + (p.service ? ` · ${providerServiceLabel(p.service)}` : '');
// The Add select's options: a placeholder, the providers not in `ids`, by
// name, and New provider….
function providerAddOptionsHtml(ids) {
    const option = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    const have = new Set(ids || []);
    const sorted = (state.providers || []).filter((p) => !have.has(p.id)).sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)));
    return option('', t('Add provider…'))
        + sorted.map((p) => option(p.id, providerOptionText(p))).join('')
        + (readOnlyDoc() ? '' : option(PV_NEW, t('+ New provider…')));
}
// The chips of a list, or a dim "none" (saying what answers instead, when
// something does). data-pv-remove on each ✕.
function providerChipsHtml(ids, noneText) {
    const list = (ids || []).map((id) => providerById(id)).filter(Boolean);
    if (!list.length) return noneText ? `<span class="net-muted pv-none">${escapeHtml(noneText)}</span>` : '';
    return list.map((p) => `<span class="pv-chip">${escapeHtml(providerOptionText(p))}${readOnlyDoc() ? ''
        : `<button type="button" class="pv-chip-x" data-pv-remove="${escapeHtml(p.id)}" aria-label="${escapeHtml(t('Remove {name}', { name: providerLabel(p) }))}">✕</button>`}</span>`).join('');
}
const readOnlyDoc = () => !!state.readOnly;
// "From its group Server room: Acme IT (IT support)" for every provider a
// device inherits, one line each.
function inheritedProviderText(node) {
    if (!node) return '';
    return nodeProviders(node).filter((r) => r.via !== 'own').map((r) => {
        const pv = providerOptionText(r.provider);
        return r.via === 'host'
            ? t('From its host {name}: {provider}', { name: r.from.name || r.from.id, provider: pv })
            : t('From its group {name}: {provider}', { name: groupLabel(r.from), provider: pv });
    }).join('\n');
}
function renderNodeProviderPicker(node) {
    const sel = pvEl('propProvider');
    if (!sel) return;
    const inherited = inheritedProviderText(node);
    const chips = pvEl('propProviderChips');
    if (chips) chips.innerHTML = providerChipsHtml(providerRefsOf(node), inherited ? '' : t('— None'));
    sel.innerHTML = providerAddOptionsHtml(providerRefsOf(node));
    sel.value = '';
    const note = pvEl('providerNote');
    if (note) { note.textContent = inherited; note.classList.toggle('hidden', !inherited); }
}
function renderLinkProviderPicker(link) {
    const box = pvEl('linkProviderProps'), sel = pvEl('propLinkProvider');
    if (!box || !sel) return;
    box.classList.toggle('hidden', !link || isReduced());
    if (!link) return;
    const chips = pvEl('propLinkProviderChips');
    if (chips) chips.innerHTML = providerChipsHtml(providerRefsOf(link), t('— None'));
    sel.innerHTML = providerAddOptionsHtml(providerRefsOf(link));
    sel.value = '';
}
// `ids` as `rec`'s list (a device, a cable or a group), in doc.providers'
// order. One undo step, with `made` (a provider New provider… minted) in it.
// -> true when it changed.
function setProviders(rec, ids, made = null) {
    if (!rec || readOnlyRefuses()) return false;
    const before = providerRefsOf(rec).join();
    const all = (state.providers || []).concat(made ? [made] : []);
    const rank = new Map(all.map((p, i) => [p.id, i]));
    const next = [...new Set(ids || [])].filter((id) => rank.has(id)).sort((a, b) => rank.get(a) - rank.get(b));
    if (next.join() === before && !made) return false;
    batch(() => {
        if (made) state.providers = all;
        if (next.length) rec.providers = next; else delete rec.providers;
        delete rec.provider;
        save(); renderCanvasOnly();
    });
    refreshProviderViews(true);
    return true;
}
// The Add select's value onto `rec`: a provider's id adds it, New provider…
// asks the name first and adds the one it makes, in the same step.
async function addProviderTo(rec, value) {
    if (!rec || !value || readOnlyRefuses()) return false;
    let id = value, made = null;
    if (id === PV_NEW) {
        const text = await askPrompt(t('The provider\'s name, as it should be printed:'), { title: t('Add a provider'), ok: t('Add') });
        const name = text === null ? '' : providerLine(PROVIDER_NAME_MAX)(text);
        if (!name) { if (text !== null) showToast(t('A new provider needs a name.')); return false; }
        if ((state.providers || []).length >= PROVIDER_MAX) { showToast(t('A network holds at most {n} providers.', { n: PROVIDER_MAX })); return false; }
        made = makeProvider({ name });
        id = made.id;
    } else if (!providerById(id)) return false;
    return setProviders(rec, providerRefsOf(rec).concat(id), made);
}
const removeProviderFrom = (rec, id) => (rec ? setProviders(rec, providerRefsOf(rec).filter((x) => x !== id)) : false);

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
    const selectedNode = () => (state.selectedType === 'node' ? getNode(state.selectedId) : null);
    const selectedLink = () => (state.selectedType === 'link' ? getLink(state.selectedId) : null);
    const nodeSel = pvEl('propProvider');
    if (nodeSel) nodeSel.addEventListener('change', async (e) => {
        const node = selectedNode();
        await addProviderTo(node, e.target.value);
        if (node) renderNodeProviderPicker(getNode(node.id) || node);
    });
    const nodeChips = pvEl('propProviderChips');
    if (nodeChips) nodeChips.addEventListener('click', (e) => {
        const x = e.target.closest('[data-pv-remove]');
        const node = selectedNode();
        if (!x || !node) return;
        removeProviderFrom(node, x.dataset.pvRemove);
        renderNodeProviderPicker(getNode(node.id) || node);
    });
    const linkSel = pvEl('propLinkProvider');
    if (linkSel) linkSel.addEventListener('change', async (e) => {
        const link = selectedLink();
        await addProviderTo(link, e.target.value);
        if (link) renderLinkProviderPicker(getLink(link.id) || link);
    });
    const linkChips = pvEl('propLinkProviderChips');
    if (linkChips) linkChips.addEventListener('click', (e) => {
        const x = e.target.closest('[data-pv-remove]');
        const link = selectedLink();
        if (!x || !link) return;
        removeProviderFrom(link, x.dataset.pvRemove);
        renderLinkProviderPicker(getLink(link.id) || link);
    });
    // Export's Provider report… (D365): one provider's report with no
    // problem attached; a read-only network prints too.
    const prBtn = pvEl('providerReportBtn');
    if (prBtn) prBtn.addEventListener('click', () => {
        if (typeof closeConfigMenu === 'function') closeConfigMenu();
        openProviderReportPicker();
    });
})();

// Which provider's report: the only one at once, else a pick.
async function openProviderReportPicker() {
    const list = (state.providers || []).filter((p) => p && p.id);
    if (!list.length) { showToast(t('This network has no providers yet. Add one in the Providers tab.')); return null; }
    const id = list.length === 1 ? list[0].id : await askPick(t('Whose report?'), { title: t('Provider report'), ok: t('Open the report'),
        rows: list.map((p) => ({ id: p.id, label: providerLabel(p), detail: providerServiceLabel(p.service) })) });
    if (!id || typeof openProviderReport !== 'function') return null;
    try { return await openProviderReport(id, { doc: serializeDoc(), audience: 'client' }); }
    catch (e) { console.warn('Report: the provider report could not be made', e); showToast(t('Could not build the report.'), 'err'); return null; }
}
