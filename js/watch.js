// ---- Watched addresses: the Watched tab (docs/SCOPE.md D371-D374, D380,
// step 8d) ----
// Addresses the owner wrote down to be checked beside the devices (doc.watch,
// js/model.js "Watched addresses"): the ISP's gateway, a public resolver, a
// cloud service, a box nobody drew. Still not a scanner: one address each,
// and nothing is checked unless it has answer checks and a PC monitors the
// network (the desktop app, js/checks.js monitorPlan). An address with no
// check has no state at all: no dot, no "unknown" (the owner's rule, D380).
//
//   the tab    one row per address: its state dot (only while a state is
//              known here), its name and address, what an outage does
//              (Raise an issue or Record only), its checks, how it is now;
//              Edit, Add to the map, Quiet for… and Delete. The full editor
//              only (data-adv); a read-only network shows the rows only.
//   the sheet  Add an address / Edit: name, address, group, reached
//              through (a device on the map, for root cause), providers,
//              what an outage does, the availability target, notes and the
//              answer checks (the device panel's cards, js/checks.js). Save
//              is one undo step.
//   Add to the map  it becomes a device with the same checks, cabled to
//              the device it is reached through, and leaves the list; its
//              outages name the device from then on. Only an IP address
//              (a device holds addresses, not host names).
// Load order: ... -> checks -> watch -> issues -> app

(function () {
'use strict';
const el = (id) => document.getElementById(id);
const _wt = { draft: null, editing: null, error: '', dirty: false };
const TC = () => window.TopoChecks;

const panelShown = () => { const p = el('cfgPanel-watch'); return !!p && !p.classList.contains('hidden'); };
const checksText = (w) => (w.checks && w.checks.length ? w.checks.map((c) => TC().protoLabel(c.proto)).join(', ') : t('Not checked'));
const outageText = (w) => (watchRecordsOnly(w) ? t('Record only') : t('Raises an issue'));

// ---- The tab ----
function render(force) {
    const btn = el('watchTabBtn');
    if (btn) btn.classList.toggle('hidden', isReduced());
    const list = el('watchList');
    if (!list) return;
    if (!panelShown()) { _wt.dirty = true; return; }
    const active = document.activeElement;
    if (!force && active && list.contains(active) && active.matches('select')) { _wt.dirty = true; return; }
    _wt.dirty = false;
    const all = state.watch || [];
    const ro = !!state.readOnly;
    const add = el('addWatchBtn');
    if (add) add.classList.toggle('hidden', ro);
    const net = el('checkInternetBtn');
    if (net) net.classList.toggle('hidden', ro);
    list.innerHTML = all.length ? all.map((w) => rowHtml(w, ro)).join('')
        : `<p class="rail-none">${escapeHtml(t('No watched addresses. Add one to check an address that is not on the map: the internet provider\'s gateway, a public resolver, a cloud service.'))}</p>`;
}
function rowHtml(w, ro) {
    const h = TC().watchHolder(w);
    const lk = TC().holderLook(h);
    const ss = lk ? TC().statusesOf(h) : [];
    const worst = ss.slice().sort((a, b) => rank(TC().look(b)) - rank(TC().look(a)))[0] || null;
    const id = escapeHtml(w.id);
    const via = w.via ? getNode(w.via) : null;
    let x = `<div class="net-card wt-card" data-wt="${id}">`;
    x += `<div class="wt-head">${lk ? `<span class="ck-dot ck-${lk}" title="${escapeHtml(t(TC().LOOK_WORDS[lk]))}" aria-label="${escapeHtml(t(TC().LOOK_WORDS[lk]))}"></span>` : ''}`
        + `<span class="grp-name">${escapeHtml(watchLabel(w))}</span><span class="wt-addr mono">${escapeHtml(w.address)}</span></div>`;
    x += `<div class="net-line">${escapeHtml([outageText(w), checksText(w), via ? t('Reached through {name}', { name: locPlainName(via) }) : ''].filter(Boolean).join(' · '))}</div>`;
    if (worst) x += `<div class="net-line ck-now ck-now-${TC().look(worst)}">${escapeHtml(TC().nowText(worst, h))}</div>`;
    x += '<div class="net-actions">';
    x += `<button type="button" class="link-btn" data-wact="edit" data-wt="${id}">${escapeHtml(t(ro ? 'Open' : 'Edit'))}</button>`;
    if (!ro) {
        x += `<button type="button" class="link-btn" data-wact="map" data-wt="${id}"${isIpText(w.address) ? '' : ` disabled title="${escapeHtml(t('A device holds addresses, not host names.'))}"`}>${escapeHtml(t('Add to the map'))}</button>`;
    }
    if (w.checks && w.checks.length && (TC().monitorOn() || TC().ownerOfSite())) {
        x += `<select class="select wt-quiet" data-wact="quiet" data-wt="${id}" aria-label="${escapeHtml(t('Quiet (maintenance)'))}"><option value="">${escapeHtml(t('Quiet for…'))}</option>`
            + TC().QUIET_FOR.map((q) => `<option value="${q}">${escapeHtml(t(TC().QUIET_WORDS[q]))}</option>`).join('')
            + (quietLeft(w) ? `<option value="end">${escapeHtml(t('End the quiet'))}</option>` : '') + '</select>';
    }
    if (!ro) x += `<button type="button" class="link-btn quiet" data-wact="delete" data-wt="${id}">${escapeHtml(t('Delete'))}</button>`;
    x += '</div>';
    if (quietLeft(w)) x += `<p class="rail-note ck-note">${escapeHtml(t('Quiet until {time}.', { time: new Date(quietLeft(w)).toLocaleString() }))}</p>`;
    return x + '</div>';
}
const LOOK_RANK = { down: 8, split: 7, cause: 6, flapping: 5, slow: 4, unknown: 3, quiet: 2, up: 1 };
const rank = (lk) => LOOK_RANK[lk] || 0;
function quietLeft(w) {
    const q = TC().quietNow();
    const until = (q.nodes || {})[watchItemId(w.id)] || 0;
    return until > Date.now() ? until : 0;
}

async function onListClick(e) {
    const b = e.target.closest('[data-wact]');
    if (!b || b.tagName === 'SELECT') return;
    const id = b.dataset.wt, act = b.dataset.wact;
    if (act === 'edit') { openSheet(id); return; }
    if (readOnlyRefuses()) return;
    if (act === 'map') { addToMap(id); return; }
    if (act === 'delete') {
        const w = watchById(id);
        if (!w) return;
        const ok = await askConfirm(t('Delete {name}? Its checks stop; the outages already recorded stay in the reports.', { name: watchLabel(w) }), { ok: t('Delete'), danger: true });
        if (!ok) return;
        batch(() => { state.watch = state.watch.filter((x) => x.id !== id); save(); renderCanvasOnly(); });
        render(true);
    }
}
function onListChange(e) {
    const s = e.target.closest('select[data-wact="quiet"]');
    if (!s || !s.value) return;
    const until = s.value === 'end' ? 0 : TC().quietUntil(s.value);
    TC().quietItem('node', watchItemId(s.dataset.wt), until).then(() => render(true));
}

// ---- Add to the map (D372) ----
function addToMap(id) {
    const w = watchById(id);
    if (!w || readOnlyRefuses()) return null;
    if (!isIpText(w.address)) { showToast(t('A device holds addresses, not host names.'), 'warn'); return null; }
    let priv = true;
    try { priv = isPrivateIP(ipaddr.parse(w.address)); } catch (e) { /* not one */ }
    const via = w.via ? getNode(w.via) : null;
    const at = via ? { x: via.x + 160, y: via.y + 120 } : besideTheMap([{ x: 0, y: 0 }]);
    const node = normalizeLoadedNode({
        id: nextId('n'), type: priv ? 'server' : 'cloud', name: watchLabel(w), x: Math.round(at.x), y: Math.round(at.y),
        interfaces: [{ id: 'i1', name: 'eth0', ip: w.address }],
        group: w.group, providers: w.providers, notes: w.notes, checks: w.checks, target: w.target,
        outage: watchRecordsOnly(w) ? 'record' : undefined
    });
    batch(() => {
        state.nodes.push(node);
        if (via) state.links.push(normalizeLoadedLink({ id: nextId('l'), source: via.id, target: node.id }));
        state.watch = state.watch.filter((x) => x.id !== id);
        // Its outages and reports name the device from now on.
        (state.incidents || []).forEach((inc) => {
            if (!Array.isArray(inc.watchIds) || !inc.watchIds.includes(id)) return;
            inc.watchIds = inc.watchIds.filter((x) => x !== id);
            if (!inc.watchIds.length) delete inc.watchIds;
            if (!inc.nodeIds.includes(node.id)) inc.nodeIds.push(node.id);
        });
        save();
        renderCanvasOnly();
    });
    if (typeof select === 'function') select(node.id, 'node');
    showToast(t('{name} is on the map now, with its checks.', { name: locPlainName(node) }), 'ok');
    render(true);
    return node;
}

// ---- Check the Internet (D375, step 8e) ----
// Three watched addresses in one step, each asked and each skippable: a
// ping to the internet provider's gateway (the router's own gateway
// offered), a DNS question to a public resolver, and HTTPS to an address
// the owner gives. Reached through the router facing the internet, named
// on the network's internet providers, Record only as any new one.
function internetRouter() {
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    const routers = state.nodes.filter((n) => !isRetired(n) && n.type !== 'cloud' && isRoutingDevice(n.type));
    const toCloud = routers.find((r) => state.links.some((l) => (l.source === r.id || l.target === r.id)
        && (byId.get(l.source === r.id ? l.target : l.source) || {}).type === 'cloud'));
    return toCloud || routers[0] || null;
}
// "https://app.example.com:8443/status" or "app.example.com" -> { host, port, path } or null.
function webTarget(text) {
    const v = String(text || '').trim();
    if (!v) return null;
    // A bare address or name first (an IPv6 address holds colons).
    const plain = asWatchAddress(v);
    if (plain) return { address: plain, port: undefined, path: undefined };
    let host = v, port, path;
    const m = /^(?:https?:\/\/)?(\[[^\]]+\]|[^/:?#]+)(?::(\d{1,5}))?(\/[^?#\s]*)?/i.exec(v);
    // With no scheme, an address and /24 is a subnet, not a page.
    if (m && !/^https?:\/\//i.test(v) && /^\/\d{1,3}$/.test(m[3] || '')) return null;
    if (m) { host = m[1].replace(/^\[|\]$/g, ''); port = m[2] ? asCheckPort(m[2]) : undefined; path = m[3] ? asCheckPath(m[3]) : undefined; }
    const address = asWatchAddress(host);
    return address ? { address, port, path } : null;
}
async function checkTheInternet() {
    if (readOnlyRefuses()) return null;
    const room = WATCH_MAX - (state.watch || []).length;
    if (room <= 0) { showToast(t('A network holds at most {n} watched addresses.', { n: WATCH_MAX }), 'warn'); return null; }
    const title = t('Check the Internet');
    const router = internetRouter();
    const gw = await askPrompt(t('The internet provider\'s gateway: the address your router sends everything to. Leave it empty to skip.'),
        { title, value: router && router.gw ? router.gw : '', keys: 'code', ok: t('Next') });
    if (gw === null) return null;
    const dns = await askPrompt(t('A public resolver to ask for a name. Leave it empty to skip.'), { title, value: '1.1.1.1', keys: 'code', ok: t('Next') });
    if (dns === null) return null;
    const web = await askPrompt(t('An address on the internet to open over HTTPS, such as a service you use. Leave it empty to skip.'), { title, value: '', keys: 'code', ok: t('Add the checks') });
    if (web === null) return null;
    const bad = [];
    const gwA = gw.trim() ? asWatchAddress(gw) : null;
    if (gw.trim() && !gwA) bad.push(gw.trim());
    const dnsA = dns.trim() ? asWatchAddress(dns) : null;
    if (dns.trim() && !dnsA) bad.push(dns.trim());
    const webT = web.trim() ? webTarget(web) : null;
    if (web.trim() && !webT) bad.push(web.trim());
    if (bad.length) { await tell(t('Not added: {list} is not one address (an IP address or a host name).', { list: bad.join(', ') }), { title }); return null; }
    const via = router ? router.id : undefined;
    const isp = (state.providers || []).filter((p) => p.service === 'internet').map((p) => p.id);
    const providers = isp.length ? isp : undefined;
    const ck = (fields) => Object.assign({ id: nextId('ck') }, fields);
    const recs = [];
    if (gwA) recs.push(makeWatch({ name: t('Internet provider\'s gateway'), address: gwA, via, providers, checks: [ck({ proto: 'ping' })] }));
    // The name asked: the service's own when it is a name, else one that always exists.
    const asked = webT && !isIpText(webT.address) ? webT.address : 'example.com';
    if (dnsA) recs.push(makeWatch({ name: t('Public resolver'), address: dnsA, via, checks: [ck({ proto: 'dns', name: asked })] }));
    if (webT) recs.push(makeWatch({ name: webT.address, address: webT.address, via, providers, checks: [ck({ proto: 'https', port: webT.port, path: webT.path })] }));
    const add = recs.slice(0, room);
    if (!add.length) return [];
    batch(() => {
        state.watch = normalizeWatch((state.watch || []).concat(add), { nodes: state.nodes, groups: state.groups, providers: state.providers });
        save();
        renderCanvasOnly();
    });
    render(true);
    showToast(tn(add.length, '1 watched address added. It is checked from the PCs that monitor this network.', '{n} watched addresses added. They are checked from the PCs that monitor this network.'), 'ok');
    return add.map((r) => watchById(r.id)).filter(Boolean);
}

// ---- The sheet: Add an address, Edit ----
function openSheet(id) {
    const w = id ? watchById(id) : null;
    if (!w && (state.readOnly || readOnlyRefuses())) return;
    if (!w && (state.watch || []).length >= WATCH_MAX) { showToast(t('A network holds at most {n} watched addresses.', { n: WATCH_MAX }), 'warn'); return; }
    // A new one starts at Record only, with a ping (D373).
    _wt.draft = w ? JSON.parse(JSON.stringify(w)) : { id: nextId('wa'), name: '', address: '', checks: [{ id: nextId('ck'), proto: 'ping' }] };
    _wt.editing = w ? w.id : null;
    _wt.error = '';
    const scrim = el('watchDialog');
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onClose: () => { _wt.draft = null; } });
    else scrim.hidden = false;
    renderSheet();
    if (!state.readOnly) { const f = el('watchName'); if (f && typeof focusForTyping === 'function') focusForTyping(f, null, {}); }
}
function closeSheet() {
    const scrim = el('watchDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
    _wt.draft = null;
}
function renderSheet() {
    const d = _wt.draft;
    if (!d) return;
    const ro = !!state.readOnly;
    const dis = ro ? ' disabled' : '';
    el('watchDlgTitle').textContent = _wt.editing ? (ro ? watchLabel(d) : t('Edit the watched address')) : t('Add an address');
    el('watchSaveBtn').classList.toggle('hidden', ro);
    const opt = (v, label, cur) => `<option value="${escapeHtml(String(v))}"${String(v) === String(cur || '') ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    let h = `<p class="rail-note ck-note ck-rule">${escapeHtml(t(TC().NOT_CHECKED_RULE))}</p>`;
    h += '<div class="prop-grid wt-grid">';
    h += `<div><label class="prop-lbl" for="watchName">${escapeHtml(t('Name'))}</label><input id="watchName" class="input" maxlength="${WATCH_NAME_MAX}" autocomplete="off" placeholder="${escapeHtml(t('Internet provider\'s gateway'))}" value="${escapeHtml(d.name || '')}"${dis}></div>`;
    h += `<div><label class="prop-lbl" for="watchAddress">${escapeHtml(t('Address'))}</label><input id="watchAddress" class="input mono" maxlength="253" autocomplete="off" spellcheck="false" inputmode="url" placeholder="1.1.1.1" value="${escapeHtml(d.address || '')}"${dis}></div>`;
    h += `<div><label class="prop-lbl" for="watchGroup">${escapeHtml(t('Group'))}</label><select id="watchGroup" class="select"${dis}>${opt('', t('The whole site'), d.group)}`
        + (state.groups || []).filter((g) => g.kind !== 'rack').map((g) => opt(g.id, groupLabel(g), d.group)).join('') + '</select></div>';
    const devs = state.nodes.slice().sort((a, b) => locPlainName(a).localeCompare(locPlainName(b)));
    h += `<div><label class="prop-lbl" for="watchVia">${escapeHtml(t('Reached through'))}</label><select id="watchVia" class="select"${dis}>${opt('', t('Not on the map'), d.via)}`
        + devs.map((n) => opt(n.id, locPlainName(n), d.via)).join('') + '</select></div>';
    h += `<div><label class="prop-lbl" for="watchTarget">${escapeHtml(t('Availability target (%)'))}</label><input id="watchTarget" class="input mono" inputmode="decimal" maxlength="7" autocomplete="off" placeholder="99.5" value="${escapeHtml(d.target != null ? String(d.target) : '')}"${dis}></div>`;
    h += '</div>';
    h += `<fieldset class="wt-outage"><legend class="prop-lbl">${escapeHtml(t('When it is not answering'))}</legend>`
        + `<label class="dlg-check pb-radio"><input type="radio" name="watchOutage" value="record"${watchRecordsOnly(d) ? ' checked' : ''}${dis}> <span>${escapeHtml(t('Record only: in the statistics and the monitoring report, no issue, no alarm'))}</span></label>`
        + `<label class="dlg-check pb-radio"><input type="radio" name="watchOutage" value="raise"${watchRecordsOnly(d) ? '' : ' checked'}${dis}> <span>${escapeHtml(t('Raise an issue: the banner, and the alarm on PCs that show alarms'))}</span></label></fieldset>`;
    if ((state.providers || []).length) {
        h += `<fieldset class="wt-providers"><legend class="prop-lbl">${escapeHtml(t('Providers'))}</legend>`
            + state.providers.map((p) => `<label class="ck-tick"><input type="checkbox" data-wprov="${escapeHtml(p.id)}"${(d.providers || []).includes(p.id) ? ' checked' : ''}${dis}> <span>${escapeHtml(providerLabel(p))}</span></label>`).join('') + '</fieldset>';
    }
    h += `<div><label class="prop-lbl" for="watchNotes">${escapeHtml(t('Notes'))}</label><textarea id="watchNotes" class="input" rows="2" maxlength="${PROVIDER_NOTES_MAX}"${dis}>${escapeHtml(d.notes || '')}</textarea></div>`;
    h += `<h3 class="prop-lbl wt-checks-head">${escapeHtml(t('Answer checks'))}</h3><div id="watchChecks">`;
    const holder = TC().watchHolder(d);
    (d.checks || []).forEach((c) => { h += TC().checkCardHtml(holder, c, ro); });
    if (!(d.checks || []).length) h += `<p class="rail-none">${escapeHtml(t('No answer checks: it is not checked, and has no state.'))}</p>`;
    if (!ro && (d.checks || []).length < CHECKS_MAX) h += `<button type="button" class="btn ck-add" data-ck="add">${escapeHtml(t('＋ Add a check'))}</button>`;
    // Check now (D381): the desktop app, once, kept nowhere.
    if (TC().hasHost()) h += `<div class="ck-row ck-checknow"><button type="button" class="btn" data-ck="checknow">${escapeHtml(t('Check now'))}</button>`
        + `<p class="rail-note ck-note" id="watchNowResult" aria-live="polite">${escapeHtml(t('Once, from this PC: nothing is kept.'))}</p></div>`;
    h += '</div>';
    el('watchBody').innerHTML = h;
    el('watchError').textContent = _wt.error;
    if (_wt.editing) (d.checks || []).forEach((c) => TC().loadHistory(holder, c, el('watchChecks')));
}
// The form's fields into the draft (before a redraw or Save).
function readForm() {
    const d = _wt.draft;
    if (!d || !el('watchName')) return;
    d.name = el('watchName').value;
    d.address = el('watchAddress').value.trim();
    d.group = el('watchGroup').value || undefined;
    d.via = el('watchVia').value || undefined;
    d.notes = el('watchNotes').value;
    const raise = el('watchBody').querySelector('input[name="watchOutage"][value="raise"]');
    d.outage = raise && raise.checked ? 'raise' : undefined;
    const ticked = [...el('watchBody').querySelectorAll('[data-wprov]')].filter((x) => x.checked).map((x) => x.dataset.wprov);
    d.providers = ticked.length ? ticked : undefined;
}
function onSheetChange(e) {
    const d = _wt.draft;
    if (!d || state.readOnly) return;
    const card = e.target.closest('.ck-card');
    if (card && e.target.dataset.f) {
        readForm();
        const c = (d.checks || []).find((x) => x.id === card.dataset.check);
        if (c && TC().applyCheckField(TC().watchHolder(d), c, e.target, card)) { e.target.classList.add('bad'); return; }
        d.checks = asWatchChecks(d.checks, true) || [];
        renderSheet();
    }
}
function onSheetClick(e) {
    const b = e.target.closest('[data-ck]');
    const d = _wt.draft;
    if (!b || !d) return;
    if (b.dataset.ck === 'checknow') {
        if (!state.readOnly) readForm();
        const address = asWatchAddress(d.address);
        if (!address) { el('watchNowResult').textContent = t('Type the address to check.'); return; }
        TC().runCheckNow(Object.assign(TC().watchHolder(d), { address }), el('watchNowResult'));
        return;
    }
    if (state.readOnly) return;
    readForm();
    if (b.dataset.ck === 'add') d.checks = (d.checks || []).concat([{ id: nextId('ck'), proto: 'ping' }]);
    else if (b.dataset.ck === 'del') { const cid = b.closest('.ck-card').dataset.check; d.checks = (d.checks || []).filter((x) => x.id !== cid); }
    else return;
    renderSheet();
}
// Save: one undo step. -> the record, or null (refused, with why).
function saveSheet() {
    const d = _wt.draft;
    if (!d || readOnlyRefuses()) return null;
    readForm();
    const address = asWatchAddress(d.address);
    const target = String(el('watchTarget').value || '').trim();
    const tgt = target === '' ? undefined : asTarget(target);
    const why = !d.address ? t('Type the address to check.')
        : !address ? t('One address: an IP address or a host name. Not a range, a subnet or a wildcard.')
            : target !== '' && tgt === undefined ? t('The target is a percentage below 100, such as 99.5.') : '';
    if (why) { _wt.error = why; el('watchError').textContent = why; return null; }
    const rec = readFields(WATCH_FIELDS, Object.assign({}, d, { address, target: tgt }));
    rec.checks = asWatchChecks(d.checks, true);
    Object.keys(rec).forEach((k) => { if (rec[k] === undefined) delete rec[k]; });
    batch(() => {
        const list = (state.watch || []).slice();
        const i = _wt.editing ? list.findIndex((x) => x.id === _wt.editing) : -1;
        if (i >= 0) list[i] = rec; else list.push(rec);
        state.watch = normalizeWatch(list, { nodes: state.nodes, groups: state.groups, providers: state.providers });
        save();
        renderCanvasOnly();
    });
    closeSheet();
    render(true);
    return watchById(rec.id);
}

// ---- Wiring ----
(function wire() {
    const list = el('watchList');
    if (list) { list.addEventListener('click', onListClick); list.addEventListener('change', onListChange); }
    const add = el('addWatchBtn');
    if (add) add.addEventListener('click', () => openSheet(null));
    const net = el('checkInternetBtn');
    if (net) net.addEventListener('click', () => { checkTheInternet(); });
    const scrim = el('watchDialog');
    if (scrim) {
        scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
        el('watchBody').addEventListener('change', onSheetChange);
        el('watchBody').addEventListener('click', onSheetClick);
        el('watchSaveBtn').addEventListener('click', saveSheet);
    }
})();

// Simple's Problems view (D372): a row per watched address whose state is
// known here, read only; none is said of one that is not checked (D380).
function simpleRows() {
    return (state.watch || []).map((w) => {
        const h = TC().watchHolder(w);
        const lk = TC().holderLook(h);
        if (!lk) return null;
        const worst = TC().statusesOf(h).slice().sort((a, b) => rank(TC().look(b)) - rank(TC().look(a)))[0] || null;
        const li = document.createElement('li');
        li.className = 'inc-row wt-simple';
        li.innerHTML = `<div class="inc-head"><span class="ck-dot ck-${lk}" aria-hidden="true"></span> <b>${escapeHtml(watchLabel(w))}</b> <span class="mono dim">${escapeHtml(w.address)}</span></div>`
            + `<div class="inc-line">${escapeHtml(worst ? TC().nowText(worst, h) : t(TC().LOOK_WORDS[lk]))}</div>`;
        return li;
    }).filter(Boolean);
}

window.TopoWatch = {
    state: _wt, render, openSheet, closeSheet, saveSheet, readForm, addToMap, simpleRows, checkTheInternet, webTarget, internetRouter,
    // The document or a state changed: the tab follows while it shows.
    docChanged: () => { if (panelShown()) render(false); else _wt.dirty = true; },
    statusesChanged: () => {
        if (panelShown()) render(false);
        if (isReduced() && typeof renderProblemsSimpleAll === 'function') renderProblemsSimpleAll();
    }
};
})();
