// ---- Provider mode: the provider's side of a problem report (docs/SCOPE.md step 4) ----
// A client reported a problem and sent the network (js/incidents.js). The
// provider opens the link or the file, and Topo says so: a banner names the
// problem and offers "I am the provider". In provider mode the provider works
// in the full editor as usual, with the problem at hand: a strip on the map
// (the problem, Record visit), a rail tab with the report (what, where, the
// client's words, how to reach them, which provider you are, what you look
// after here, the visits so far) and the affected devices ringed on the map.
// Record visit writes a 'visit' entry into the network's log (who, when, how
// it went, the notes, what changed in the network since the copy arrived)
// and marks the report visited, in one undo step; then the copy goes back to
// the client (a locked link, an email, the file), whose Keep or Open merges
// it three-way (js/mergedoors.js): the copy names as its base the revision
// the provider received.
//
// What lasts where:
//   - the provider session (which report, the revision that arrived, when,
//     the view to go back to): sessionStorage, this tab only, per network,
//     so a reload carries on in provider mode (re-entered when the page's
//     own network comes back, never from a URL);
//   - the copy as it arrived, for "what changed": the revision store first
//     (js/revisions.js holds every arrival under its rev), the session's
//     copy only after a reload; after a visit, the copy as it went back, so
//     a second visit lists only what is new (D-decision);
//   - which provider you are, per network: Settings (localStorage);
//   - the passphrase that opened the link: memory only. The copy going back
//     is locked with it, since the client already holds it.
// The full editor is borrowed for the session, never saved as the view:
// whoever taps "I am the provider" by mistake keeps their Simple view.
//
// Translated: the client and the provider both read all of it.

const PM_SESSION_PREFIX = 'topo_provider_';
const PM_BANNER_PREFIX = 'topo_incbanner_';
const PROVIDER_SELF_MAX = 50;
const VISIT_OUTCOME_LABEL = { fixed: 'Fixed', partly: 'Partly fixed', 'not-fixed': 'Not fixed', 'follow-up': 'Needs a follow-up visit' };
const VISIT_OUTCOME_GLYPH = { fixed: '✅', partly: '½', 'not-fixed': '✖', 'follow-up': '↻' };
const VISIT_KIND_WORD = { device: 'Device', cable: 'Cable', subnet: 'Subnet', wifi: 'Wi-Fi network', group: 'Group', provider: 'Provider',
    column: 'Custom column', search: 'Saved search', other: 'Other changes' };
const VISIT_STATUS_WORD = { added: 'Added', changed: 'Changed', removed: 'Removed', moved: 'Moved' };
const pmEl = (id) => document.getElementById(id);
const visitOutcomeLabel = (o) => (VISIT_OUTCOME_LABEL[o] ? t(VISIT_OUTCOME_LABEL[o]) : '');

const _pm = {
    on: false,          // the view is in provider mode
    docId: null,        // for this network
    session: null,      // { v, docId, incidentId, arrivalRev, at, prevAdvanced, prevProfile, viaLink, arrivalJson?, lastVisitJson?, lastVisitAt?, lastVisitId? }
    arrival: null,      // the copy that just arrived, for the banner: { docId, origin, rev, at, json?, kind, ids }
    pass: new Map(),    // docId -> the passphrase that opened its link (never stored)
    vd: null,           // the Record visit dialog's state
    prevDefault: undefined // the view the width decided before pmPreferMap, to give back
};

// ---- Sessions ----
const pmKey = (docId) => PM_SESSION_PREFIX + (docId || 'doc');
function readProviderSession(docId) {
    if (_pm.session && _pm.session.docId === docId) return _pm.session;
    try {
        const s = JSON.parse(sessionStorage.getItem(pmKey(docId)));
        return s && typeof s === 'object' && typeof s.incidentId === 'string' ? s : null;
    } catch (e) { return null; }
}
// Kept in memory whole; in sessionStorage whole when it fits, else without
// the copies (the revision store still has the arrival in this tab).
function writeProviderSession(s) {
    _pm.session = s;
    try { sessionStorage.setItem(pmKey(s.docId), JSON.stringify(s)); return true; }
    catch (e) {
        try { const lean = Object.assign({}, s); delete lean.arrivalJson; delete lean.lastVisitJson; sessionStorage.setItem(pmKey(s.docId), JSON.stringify(lean)); }
        catch (e2) { /* private window: memory only */ }
        return false;
    }
}
function dropProviderSession(docId) {
    if (_pm.session && _pm.session.docId === docId) _pm.session = null;
    try { sessionStorage.removeItem(pmKey(docId)); } catch (e) { /* nothing kept */ }
}
const providerModeOn = () => _pm.on;
// What saveSettings writes for `advanced` while the full editor is borrowed
// (js/app.js): the view the visitor had. null when nothing is borrowed.
const providerBorrowedAdvanced = () => (_pm.on && _pm.session ? !!_pm.session.prevAdvanced : null);

// ---- Which provider you are, per network (Settings) ----
function providerSelfOf(docId) {
    const map = state.settings.providerSelf || {};
    const id = map[docId || 'doc'];
    return id && providerById(id) ? id : '';
}
function setProviderSelf(docId, providerId) {
    const map = Object.assign({}, state.settings.providerSelf || {});
    const key = docId || 'doc';
    delete map[key];
    if (providerId) map[key] = providerId;
    const keys = Object.keys(map);
    while (keys.length > PROVIDER_SELF_MAX) delete map[keys.shift()];
    state.settings.providerSelf = map;
    saveSettings();
}

// ---- The report in hand ----
const pmIncident = () => (_pm.on && _pm.session ? incidentById(_pm.session.incidentId) : null);
// The devices of the report in hand, for the map's ring (js/ui.js reads it
// once per draw). Empty outside provider mode.
function incidentMapIds() {
    const inc = pmIncident();
    return new Set(inc ? inc.nodeIds || [] : []);
}
const activeIncidents = (list = state.incidents) => (list || []).filter((x) => x && (x.status === 'open' || x.status === 'sent'));
const newestOf = (list) => list.slice().sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
const visitEntry = (id) => (state.log || []).find((e) => e && e.id === id && e.kind === 'visit') || null;

// ---- Arrival ----
// replaceDocument (js/app.js) hands every document loaded here. A copy that
// arrived (a link, a file) with an open or sent report gets the banner; a
// copy of a network kept here whose report was visited (the client opening
// what the provider sent back) offers the merge. The page's own network
// coming back (a reload, Back) re-enters provider mode when this tab was in
// it for that network.
function providerDocLoaded(origin) {
    const docId = state.docId || null;
    const pass = typeof takeArrivalPassphrase === 'function' ? takeArrivalPassphrase() : null;
    if (_pm.on && _pm.docId !== docId) exitProviderView();
    _pm.arrival = null;
    if (!state.readOnly && (origin === 'link' || origin === 'file')) {
        if (pass && docId) _pm.pass.set(docId, pass);
        noteArrival(origin, null);
    } else if (!state.readOnly && (origin === 'live' || origin === 'library') && !_pm.on) {
        const s = readProviderSession(docId);
        if (s && incidentById(s.incidentId)) enterProviderView(s);
    }
    renderProviderChrome();
}
// A merge (or the file's Update) brought an open or sent report that the
// network did not have open before: an IT firm that already holds the
// client's network opens what the client sent. `before`: the network's
// document before.
function providerMergeArrival(before) {
    if (state.readOnly) return;
    const was = new Map(((before && before.incidents) || []).map((x) => [x && x.id, x && x.status]));
    const fresh = activeIncidents().filter((x) => !['open', 'sent'].includes(was.get(x.id)));
    if (!fresh.length) return;
    noteArrival('merge', JSON.stringify(serializeDoc()), fresh);
    renderProviderChrome();
}
function noteArrival(origin, json, only) {
    const docId = state.docId || null;
    const card = docId && !isKept() ? libraryEntry(docId) : null;
    // The client's own network coming back with a visit.
    if (card && card.doc && !card.template && !card.block) {
        const mine = new Map((card.doc.incidents || []).map((x) => [x && x.id, x]));
        // A report further on than the card's, or one with a visit the card
        // has not got (a second provider's, from the same link).
        const newVisit = (x) => { const m = mine.get(x.id); const held = (m && Array.isArray(m.visits)) ? m.visits : []; return (x.visits || []).some((v) => !held.includes(v)); };
        const visited = (state.incidents || []).filter((x) => x.status === 'visited' && (incidentRank(x) > incidentRank(mine.get(x.id)) || newVisit(x)));
        if (visited.length) {
            _pm.arrival = { docId, origin, rev: state.docRev || null, at: _incHooks.now(), kind: 'visited', ids: visited.map((x) => x.id) };
            return;
        }
    }
    let open = only || activeIncidents();
    // This browser keeps the network already (the client opening the link
    // they just sent, to check it): a report the card holds as far on is
    // theirs, not one to come and fix.
    if (card && card.doc && !card.template && !card.block) {
        const held = new Map((card.doc.incidents || []).map((x) => [x && x.id, x]));
        open = open.filter((x) => !held.has(x.id) || incidentRank(x) > incidentRank(held.get(x.id)));
    }
    if (!open.length) return;
    _pm.arrival = { docId, origin, rev: origin === 'merge' ? null : state.docRev || null, at: _incHooks.now(), kind: 'provider', ids: open.map((x) => x.id) };
    // A merged result has no revision of its own: its copy is what "changed
    // since" reads. A link's or a file's is in the revision store already.
    if (json) _pm.arrival.json = json;
    else if (!state.docRev) _pm.arrival.json = JSON.stringify(serializeDoc());
}

// ---- The banner ----
function bannerKey(a) {
    const inc = a ? newestOf(a.ids.map((id) => incidentById(id)).filter(Boolean)) : null;
    return inc ? `${a.kind}:${inc.id}:${inc.status}:${inc.reopened || 0}:${(inc.visits || []).length}` : '';
}
function bannerDismissed(a) {
    try { return sessionStorage.getItem(PM_BANNER_PREFIX + (a.docId || 'doc')) === bannerKey(a); } catch (e) { return false; }
}
function dismissIncidentBanner() {
    const a = _pm.arrival;
    if (a) { try { sessionStorage.setItem(PM_BANNER_PREFIX + (a.docId || 'doc'), bannerKey(a)); } catch (e) { /* hidden for now only */ } }
    _pm.arrival = null;
    renderIncidentBanner();
}
// -> the banner's sentence for an arrival, or ''.
function incidentBannerText(a) {
    if (!a) return '';
    const list = a.ids.map((id) => incidentById(id)).filter(Boolean);
    const inc = newestOf(list);
    if (!inc) return '';
    if (a.kind === 'visited') {
        const entries = list.flatMap((x) => (x.visits || []).map(visitEntry)).filter(Boolean).sort((x, y) => x.at - y.at);
        const e = entries[entries.length - 1];
        if (!e) return t('A visit was recorded for the problem reported {date}.', { date: incidentWhen(inc.at) });
        return t('{name} recorded a visit on {date}: {outcome}.', { name: e.by || e.provider || t('A technician'), date: incidentWhen(e.at), outcome: visitOutcomeLabel(e.outcome) || t('Recorded') });
    }
    const one = t('Problem reported {date}: {symptom} at {where}.', { date: incidentWhen(inc.at), symptom: symptomLabel(inc.symptom), where: incidentWhereText(inc) });
    return list.length > 1 ? joinSentences([t('{n} problems reported.', { n: list.length }), one]) : one;
}
function renderIncidentBanner() {
    const b = pmEl('incidentBanner');
    if (!b) return;
    const a = _pm.arrival;
    const show = !!a && a.docId === (state.docId || null) && !_pm.on && !state.readOnly && !bannerDismissed(a)
        && !(a.kind === 'visited' && !libraryEntry(a.docId));
    const text = show ? incidentBannerText(a) : '';
    b.classList.toggle('hidden', !text);
    if (!text) { syncProviderBarHeight(); return; }
    if (a.kind !== 'visited') pmPreferMap(true);
    pmEl('incidentBannerText').textContent = `⚠ ${text}`;
    pmEl('incidentBannerGo').textContent = a.kind === 'visited' ? t('Merge into my network') : t('I am the provider');
    pmEl('incidentBannerLater').textContent = t('Not now');
    syncProviderBarHeight();
}
async function incidentBannerGo() {
    const a = _pm.arrival;
    if (!a) return;
    if (a.kind === 'visited') {
        _pm.arrival = null;
        renderIncidentBanner();
        if (typeof keepThisNetwork === 'function') await keepThisNetwork();
        return;
    }
    const inc = newestOf(a.ids.map((id) => incidentById(id)).filter(Boolean));
    if (inc) enterProviderMode(inc.id);
}

// ---- Entering and leaving ----
// "I am the provider": the full editor for this session, the report's tab
// open, the session kept for a reload. -> whether it entered.
function enterProviderMode(incidentId) {
    if (state.readOnly) { readOnlyRefuses(); return false; }
    if (!incidentById(incidentId)) return false;
    const docId = state.docId || null;
    const a = _pm.arrival && _pm.arrival.docId === docId && _pm.arrival.kind === 'provider' ? _pm.arrival : null;
    const old = readProviderSession(docId);
    const s = {
        v: 1, docId, incidentId,
        arrivalRev: a ? a.rev : (old && old.incidentId === incidentId ? old.arrivalRev : state.docRev || null),
        at: a ? a.at : (old && old.incidentId === incidentId ? old.at : _incHooks.now()),
        // The view to go back to: the one before any provider session.
        prevAdvanced: _pm.on && _pm.session ? !!_pm.session.prevAdvanced : !!state.settings.advanced,
        prevProfile: _pm.on && _pm.session ? _pm.session.prevProfile : state.settings.profile,
        viaLink: !!(a && a.origin === 'link')
    };
    // The copy as it arrived, for "what changed" after a reload: a merged
    // one has no revision; a link's is held only in this tab. A kept file's
    // is in the revision store on disk.
    if (a && a.json) s.arrivalJson = a.json;
    else if (!s.arrivalRev && !a) s.arrivalJson = JSON.stringify(serializeDoc());
    // The copy that goes back names as its base the revision received (a
    // kept card already does: its card's base, or its merge log's rev).
    if (s.viaLink && !isKept() && state.docRev) {
        state.docBase = state.docRev;
        if (typeof refreshLiveEntryQuietly === 'function') refreshLiveEntryQuietly();
    }
    writeProviderSession(s);
    // A link's arrival is held in this tab's revision store, which a reload
    // empties: its copy goes into the session from there (never a second
    // copy taken at arrival).
    if (s.viaLink && s.arrivalRev && !s.arrivalJson && typeof findBase === 'function') {
        findBase([s.arrivalRev]).then((hit) => {
            const cur = _pm.session;
            if (hit && hit.doc && cur && cur.docId === s.docId && cur.arrivalRev === s.arrivalRev && !cur.arrivalJson) writeProviderSession(Object.assign({}, cur, { arrivalJson: JSON.stringify(hit.doc) }));
        }).catch(() => { /* the store still has it this tab */ });
    }
    _pm.arrival = null;
    enterProviderView(s);
    showConfigTab('visit');
    return true;
}
function enterProviderView(s) {
    _pm.session = s;
    _pm.on = true;
    _pm.docId = s.docId;
    document.body.classList.add('provider-mode');
    // Borrowed, not saved (saveSettings writes prevAdvanced meanwhile).
    if (!state.settings.advanced) { state.settings.advanced = true; applyProfile(); }
    pmPreferMap(true);
    // In the drawer, the report's tab before the palette (js/ui.js
    // updateRailWrap folds the library; its row opens it).
    if (typeof updateRailWrap === 'function') updateRailWrap();
    renderProviderChrome();
    renderCanvasOnly();
    // After the first view's own framing (a reload fits the map once the
    // network is in), the report's devices are brought into it.
    setTimeout(() => requestAnimationFrame(pmFrameReport), 0);
}
// A provider works from the map, where the report's devices are ringed
// (incidentMapIds): a phone's first view is the Table, which marks nothing,
// so while a report is in hand, or its banner is up, the view the width
// decides is the Map. A view the visitor chose (state.settings.view) stays,
// and nothing is saved; leaving gives the width's view back.
function pmPreferMap(on) {
    if (typeof _tv === 'undefined') return;
    if (on) {
        if (_pm.prevDefault === undefined) _pm.prevDefault = _tv.defaultView;
        if (_tv.defaultView === 'map') return;
        _tv.defaultView = 'map';
    } else {
        if (_pm.prevDefault === undefined) return;
        const was = _pm.prevDefault;
        _pm.prevDefault = undefined;
        if (_tv.defaultView === was) return;
        _tv.defaultView = was;
    }
    if (typeof applyView === 'function') applyView();
}
// The report's devices in sight: on a phone (its first view shows a part of
// the map) always; wider, only when one of them is off the map's view.
function pmFrameReport() {
    if (!_pm.on || effectiveView() !== 'map') return;
    const ids = incidentMapIds();
    const nodes = state.nodes.filter((n) => ids.has(n.id));
    if (!nodes.length) return;
    if (!phoneChrome()) {
        const v = mapViewport(), c = state.camera;
        const inView = mapPointsOf(nodes).every((n) => {
            const x = n.x * c.zoom + c.x, y = n.y * c.zoom + c.y;
            return x >= v.left && x <= v.left + v.width && y >= v.top && y <= v.top + v.height;
        });
        if (inView) return;
    }
    centreOnNodes(nodes);
}
// The view goes back to what it was; the session stays for a return to
// this network (leaveProviderMode drops it too).
function exitProviderView() {
    const s = _pm.session;
    _pm.on = false;
    _pm.docId = null;
    document.body.classList.remove('provider-mode');
    pmPreferMap(false);
    if (typeof updateRailWrap === 'function') updateRailWrap();
    if (s && !s.prevAdvanced && state.settings.advanced) {
        state.settings.advanced = false;
        if (PROFILES[s.prevProfile]) state.settings.profile = s.prevProfile;
        applyProfile();
    }
    const tab = document.querySelector('.cfg-tab[data-cfgtab="visit"]');
    if (tab && tab.getAttribute('aria-selected') === 'true') showConfigTab('config');
    syncProviderBarHeight();
}
function leaveProviderMode() {
    const docId = _pm.docId;
    exitProviderView();
    dropProviderSession(docId);
    renderProviderChrome();
    renderCanvasOnly();
}

// ---- The strip and the tab ----
function renderProviderChrome() {
    renderIncidentBanner();
    const strip = pmEl('providerStrip');
    const inc = pmIncident();
    if (strip) {
        strip.classList.toggle('hidden', !inc);
        if (inc) {
            pmEl('providerStripText').textContent = `⚠ ${symptomLabel(inc.symptom)} · ${incidentWhereText(inc)}`;
            pmEl('providerStripVisit').textContent = t('Record visit');
            pmEl('providerStripDetails').textContent = t('Details');
        }
    }
    renderProviderPanel();
    syncProviderBarHeight();
}
function openProviderPanel() {
    showConfigTab('visit');
    const ws = document.querySelector('.topo-ws');
    if (ws && mqMatches(DRAWER_MQ) && !ws.classList.contains('drawer-open')) {
        const toggle = document.querySelector('[data-ws-toggle]');
        if (toggle) toggle.click();
    }
    // In the drawer the tabs sit under the palette: brought into view.
    const tab = pmEl('visitTabBtn');
    if (tab && tab.scrollIntoView) requestAnimationFrame(() => tab.scrollIntoView({ block: 'start' }));
}
// How tall the banner or the strip is, as --pmbar-h on the body, so the
// findings pill and the table start below it (css/app.css), as they do
// below the top row (--topbar-h, js/query.js).
function syncProviderBarHeight() {
    const bar = [pmEl('providerStrip'), pmEl('incidentBanner')].find((x) => x && !x.classList.contains('hidden') && x.offsetHeight);
    document.body.classList.toggle('pm-bar', !!bar);
    document.body.style.setProperty('--pmbar-h', bar ? `${bar.offsetHeight + 8}px` : '0px');
}
const pmNode = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
function pmButton(text, cls, onClick) {
    const b = pmNode('button', cls || 'btn', text);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
}
function pmLink(href, text, label, cls) {
    const a = pmNode('a', cls || 'btn', text);
    a.href = href;
    if (label) a.setAttribute('aria-label', label);
    return a;
}
// A visit, in a line or two: "Visit by Juan (Andes IT), 9 Nov 14:10: Fixed.
// 3 changes." then the notes. Shared with the Incidents tab later.
function visitLineText(e) {
    const who = e.provider ? t('{by} ({provider})', { by: e.by || t('A technician'), provider: e.provider }) : (e.by || t('A technician'));
    const c = e.changes && e.changes.counts ? (e.changes.counts.added || 0) + (e.changes.counts.changed || 0) + (e.changes.counts.removed || 0) : null;
    const parts = [t('Visit by {who}, {date}: {outcome}.', { who, date: incidentWhen(e.at), outcome: visitOutcomeLabel(e.outcome) || t('Recorded') })];
    if (c !== null) parts.push(t(c === 1 ? '1 change.' : '{n} changes.', { n: c }));
    return joinSentences(parts);
}
// What a visit changed, one translated line per stored item.
const visitChangeText = (x) => [t(VISIT_STATUS_WORD[x.status] || 'Changed'), t(VISIT_KIND_WORD[x.kind] || 'Other changes')].join(' · ') + (x.name ? `: ${x.name}` : '');

function renderProviderPanel() {
    const panel = pmEl('cfgPanel-visit');
    if (!panel) return;
    const inc = pmIncident();
    panel.textContent = '';
    if (!inc) return;
    const head = pmNode('div', 'pm-head');
    head.appendChild(pmNode('h3', 'pm-title', `${INCIDENT_SYMPTOM_GLYPH[inc.symptom] || '⚠'} ${symptomLabel(inc.symptom)}`));
    head.appendChild(pmNode('span', `pm-status pm-${inc.status}`, t(INCIDENT_STATUS_WORD[inc.status] || 'Reported')));
    panel.appendChild(head);
    // Where: each device a link to it on the map.
    const where = pmNode('p', 'pm-where');
    where.appendChild(pmNode('span', 'prop-lbl', `${t('Where?')} `));
    const nodes = (inc.nodeIds || []).map((id) => getNode(id)).filter(Boolean);
    if (nodes.length) {
        nodes.forEach((n, i) => {
            if (i) where.appendChild(document.createTextNode(', '));
            where.appendChild(pmButton(locPlainName(n), 'link-btn pm-dev', () => { selectEntries([{ type: 'node', id: n.id }]); centreOnNodes([n]); }));
        });
        const g = inc.groupId ? groupById(inc.groupId) : null;
        if (g) where.appendChild(document.createTextNode(` · ${groupLabel(g)}`));
    } else where.appendChild(document.createTextNode(incidentWhereText(inc)));
    panel.appendChild(where);
    panel.appendChild(pmNode('p', 'dlg-dim pm-when', t('Reported {date}', { date: incidentWhen(inc.at) })));
    if (inc.text) panel.appendChild(pmNode('blockquote', 'pm-words', inc.text));
    // Who reported it, and how to reach them.
    const r = inc.reporter || {};
    if (r.name || r.phone || r.email) {
        const who = pmNode('div', 'pm-who');
        who.appendChild(pmNode('span', 'pm-who-name', t('Reported by: {who}', { who: r.name || '—' })));
        const acts = pmNode('div', 'pb-contact-acts');
        const tel = telHref(r.phone);
        if (tel) acts.appendChild(pmLink(tel, `📞 ${r.phone}`, t('Call {name}', { name: r.name || r.phone })));
        if (r.email && providerEmailOk(r.email)) {
            const a = pmLink(`mailto:${mailAddr(r.email)}`, `✉ ${t('Email')}`, t('Email {name}', { name: r.name || r.email }));
            a.title = r.email;
            acts.appendChild(a);
        }
        who.appendChild(acts);
        panel.appendChild(who);
    }
    // Which provider you are: the ones it was sent to first.
    const row = pmNode('div', 'pb-row pm-self');
    const lab = pmNode('label', 'prop-lbl', t('Which provider are you?'));
    lab.htmlFor = 'pmSelf';
    const sel = pmNode('select', 'select');
    sel.id = 'pmSelf';
    fillProviderSelect(sel, inc, providerSelfOf(_pm.docId));
    sel.addEventListener('change', () => { setProviderSelf(_pm.docId, sel.value); renderProviderPanel(); });
    row.append(lab, sel);
    panel.appendChild(row);
    const self = providerSelfOf(_pm.docId);
    if (self) {
        const c = providerCovers(self);
        const cover = pmNode('div', 'pm-covers');
        const text = providerCoversText(c);
        cover.appendChild(pmNode('span', 'dlg-dim', text ? t('You look after: {list}', { list: text }) : t('Nothing here names you yet.')));
        if (c.nodes.length || c.links.length) {
            cover.appendChild(pmButton(t('Show on map'), 'link-btn', () => {
                selectEntries(c.nodes.map((n) => ({ type: 'node', id: n.id })).concat(c.links.map((l) => ({ type: 'link', id: l.id }))));
                if (c.nodes.length) centreOnNodes(c.nodes);
            }));
        }
        panel.appendChild(cover);
    }
    // The visits so far.
    const ids = inc.visits || [];
    if (ids.length) {
        const sec = pmNode('section', 'pm-visits');
        sec.appendChild(pmNode('h4', 'pb-head', t('Visits')));
        const ul = pmNode('ul', 'pm-visit-list');
        const held = ids.map(visitEntry).filter(Boolean);
        held.forEach((e) => {
            const li = pmNode('li', 'pm-visit', visitLineText(e));
            if (e.notes) li.appendChild(pmNode('span', 'pm-visit-notes', e.notes));
            ul.appendChild(li);
        });
        sec.appendChild(ul);
        if (held.length < ids.length) sec.appendChild(pmNode('p', 'dlg-dim', t(ids.length - held.length === 1 ? 'One earlier visit is not in this copy.' : '{n} earlier visits are not in this copy.', { n: ids.length - held.length })));
        panel.appendChild(sec);
    }
    const acts = pmNode('div', 'pb-acts');
    acts.appendChild(pmButton(`✍ ${t('Record visit')}`, 'btn btn-primary', () => openVisitDialog()));
    acts.appendChild(pmButton(t('Leave provider mode'), 'btn', leaveProviderMode));
    panel.appendChild(acts);
}
const INCIDENT_STATUS_WORD = { open: 'Reported', sent: 'Sent', visited: 'Visited', closed: 'Closed' };
const soleRoutedProvider = (inc) => {
    const known = ((inc && inc.routedTo) || []).filter((pid) => providerById(pid));
    return known.length === 1 ? known[0] : '';
};
function fillProviderSelect(sel, inc, value) {
    sel.textContent = '';
    const first = pmNode('option', '', t('Choose…'));
    first.value = '';
    sel.appendChild(first);
    const routed = (inc && inc.routedTo) || [];
    const list = routed.map((id) => providerById(id)).filter(Boolean)
        .concat((state.providers || []).filter((p) => !routed.includes(p.id)));
    list.forEach((p) => {
        const o = pmNode('option', '', [p.name || p.id, providerServiceLabel(providerServiceOf(p))].filter(Boolean).join(' · '));
        o.value = p.id;
        sel.appendChild(o);
    });
    sel.value = value && list.some((p) => p.id === value) ? value : '';
}

// ---- What changed since the copy arrived ----
// The copy to compare with: the one that went back after the last visit in
// this session, else the arrival (the revision store, then the session's
// copy). -> a document, or null.
// The last visit of this session counts only while its entry is still in
// the log: an undo takes the visit back, and the baseline with it.
const lastVisitHeld = (s) => !!(s && s.lastVisitId && (state.log || []).some((e) => e && e.id === s.lastVisitId));
async function visitBaseDoc(s = _pm.session) {
    if (!s) return null;
    const parse = (j) => { try { const d = JSON.parse(j); return d && Array.isArray(d.nodes) ? d : null; } catch (e) { return null; } };
    if (s.lastVisitJson && lastVisitHeld(s)) { const d = parse(s.lastVisitJson); if (d) return d; }
    if (s.arrivalRev && typeof findBase === 'function') {
        const hit = await findBase([s.arrivalRev], state.libraryId || null);
        if (hit && hit.doc) return hit.doc;
    }
    if (s.arrivalJson) { const d = parse(s.arrivalJson); if (d) return d; }
    return null;
}
// The network's changes between two copies, in no language: counts and up
// to VISIT_CHANGE_ITEMS_MAX items { kind, id, name, status }. The reports
// and the log are not the network: a visit's own status change is not one.
function visitChangesOf(baseDoc, curDoc) {
    const strip = (d) => { const x = Object.assign({}, d); delete x.incidents; delete x.log; return x; };
    const ch = docChanges(strip(baseDoc), strip(curDoc));
    const counts = { added: 0, changed: 0, removed: 0 };
    const items = [];
    let said = 0;
    [['devices', 'device'], ['cables', 'cable'], ['subnets', 'subnet'], ['wifi', 'wifi'], ['groups', 'group'], ['providers', 'provider'], ['columns', 'column'], ['searches', 'search']]
        .forEach(([key, kind]) => {
            const g = ch[key];
            if (!g) return;
            ['added', 'changed', 'removed'].forEach((st) => (g[st] || []).forEach((x) => { counts[st]++; said++; items.push({ kind, id: String(x.id), name: x.name, status: st }); }));
            (g.moved || []).forEach((x) => { counts.changed++; said++; items.push({ kind, id: String(x.id), name: x.name, status: 'moved' }); });
        });
    const rest = Math.max(0, (ch.total || 0) - said);
    if (rest) { counts.changed += rest; items.push({ kind: 'other', status: 'changed' }); }
    return visitChanges({ counts, items });
}

// ---- Record visit ----
const pad2 = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { if (!Number.isFinite(ms)) return ''; const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fromLocalInput = (v) => { if (!v) return undefined; const ms = new Date(v).getTime(); return Number.isFinite(ms) && ms > 0 ? ms : undefined; };

// What is missing before a visit saves: translated lines.
function visitDraftProblems(d) {
    const out = [];
    if (!VISIT_OUTCOMES.includes(d.outcome)) out.push(t('Choose how it went.'));
    if (!String(d.by || '').trim()) out.push(t('Type the technician\'s name.'));
    if (d.arrived && d.left && d.left < d.arrived) out.push(t('The time you left is before the time you arrived.'));
    return out;
}
// d: { incidentId?, providerId?, by, arrived?, left?, outcome, notes?, signoff?, changes? }
// The visit entry, the report visited (never back from closed), one undo
// step. -> the entry, or null.
async function recordVisit(d) {
    if (state.readOnly) { readOnlyRefuses(); return null; }
    if (visitDraftProblems(d).length) return null;
    const p = d.providerId ? providerById(d.providerId) : null;
    const entryId = 'lg_' + randomToken();
    const res = await commitIncidentChange((doc) => {
        const x = d.incidentId ? doc.incidents.find((i) => i && i.id === d.incidentId) : null;
        if (d.incidentId && !x) return null;
        if (x) {
            x.visits = (Array.isArray(x.visits) ? x.visits : []).concat(entryId);
            if (incidentStatusIndex(x.status) < incidentStatusIndex('visited')) x.status = 'visited';
        }
        const entry = visitLogEntry({ id: entryId, at: _incHooks.now(), incidentId: x ? x.id : undefined, providerId: p ? p.id : undefined, provider: p ? p.name || p.id : undefined,
            by: String(d.by).trim(), arrived: d.arrived, left: d.left, outcome: d.outcome, notes: d.notes, changes: d.changes, signoff: d.signoff });
        return { incident: x, entry };
    });
    if (!res) return null;
    // Remembered: the technician's name is the report's prepared-by name.
    const by = String(d.by).trim().slice(0, 120);
    if (by && by !== reportEngineerDefault()) { state.settings.reportEngineer = by; saveSettings(); }
    if (p && _pm.on && providerSelfOf(_pm.docId) !== p.id) setProviderSelf(_pm.docId, p.id);
    // The next visit in this session lists what changed after this one.
    if (_pm.session) writeProviderSession(Object.assign({}, _pm.session, { lastVisitJson: JSON.stringify(serializeDoc()), lastVisitAt: d.left || _incHooks.now(), lastVisitId: res.entry.id }));
    renderProviderChrome();
    return res.entry;
}

// The message that goes back to the client (pure, as the report's).
// -> { subject, body, fullBody, mailto, to, linkLeftOut }
function composeVisitMessage({ incident, entry, site, link = '', file = '', sealed = false, samePass = false, ctx = {} }) {
    const e = entry || {};
    const outcome = visitOutcomeLabel(e.outcome) || t('Recorded');
    const subject = t('Visit recorded at {site}: {outcome}', { site: site || incidentSiteName(), outcome });
    const r = (incident && incident.reporter) || {};
    const to = r.email && providerEmailOk(r.email) ? [r.email.trim()] : [];
    const head = (notes) => {
        const who = e.provider ? t('{by} ({provider})', { by: e.by || t('A technician'), provider: e.provider }) : (e.by || t('A technician'));
        const lines = [t('Visit by {who}: {outcome}.', { who, outcome })];
        if (incident) {
            lines.push(t('Problem: {symptom}', { symptom: symptomLabel(incident.symptom) }));
            lines.push(t('Where: {where}', { where: incidentWhereText(incident, ctx) }));
        }
        if (e.arrived) lines.push(t('Arrived: {date}', { date: incidentWhen(e.arrived) }));
        if (e.left) lines.push(t('Left: {date}', { date: incidentWhen(e.left) }));
        if (notes) lines.push('', notes);
        const c = e.changes && e.changes.counts;
        if (c) {
            const n = (c.added || 0) + (c.changed || 0) + (c.removed || 0);
            lines.push('', n ? t(n === 1 ? 'Changes to the network: 1.' : 'Changes to the network: {n}.', { n }) : t('No changes to the network were recorded.'));
        }
        if (e.signoff) lines.push(t('Signed off by: {name}', { name: e.signoff }));
        lines.push('');
        return lines;
    };
    const tail = (withLink) => {
        const lines = [];
        if (link) lines.push(withLink ? t('Open it in Topo and keep it to bring the visit into your network: {link}', { link }) : t('The link is in your clipboard: paste it here.'));
        else if (file) lines.push(t('The network is in the attached file {file}. Open it with Topo: {url}', { file, url: publicBase() }));
        if (link && sealed) lines.push(samePass ? t('The passphrase is the one you sent with the problem.') : t('The passphrase comes separately: I will send it by another way.'));
        return lines;
    };
    const notes = e.notes || '';
    const fullBody = head(notes).concat(tail(true)).join('\n');
    const mk = (b) => `mailto:${to.map(mailAddr).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b)}`;
    let body = fullBody, mailto = mk(body), linkLeftOut = false;
    if (mailto.length > INCIDENT_MAILTO_MAX && link) {
        linkLeftOut = true;
        body = head(notes).concat(tail(false)).join('\n');
        mailto = mk(body);
    }
    if (mailto.length > INCIDENT_MAILTO_MAX && notes) {
        let keep = notes.length;
        while (keep > 0 && mailto.length > INCIDENT_MAILTO_MAX) {
            keep = Math.floor(keep * 0.8);
            body = head(notes.slice(0, keep).trimEnd() + '…').concat(tail(!linkLeftOut)).join('\n');
            mailto = mk(body);
        }
    }
    return { subject, body, fullBody, mailto, to, linkLeftOut };
}

// The copy that goes back: a locked link (with the passphrase that opened
// the incoming one, when this tab still holds it), or the file when the
// network is too big for a link or this page cannot lock one. Reports and
// visits always go: they are what is sent back.
// -> { ok, url, file, why: 'link'|'too-long'|'no-seal' } or { ok: false }
async function buildVisitReturn(pass) {
    let url = null, file = '', why = 'link';
    if (!canSeal()) why = 'no-seal';
    else {
        try {
            if (String(pass || '').length < SEAL_MIN_PASSPHRASE) throw new Error('passphrase');
            url = await buildShareLink('doc', true, pass, { incidents: true, max: _incHooks.urlMax() });
        } catch (e) { console.warn('Visit: could not make the link', e); return { ok: false }; }
        if (!url) why = 'too-long';
    }
    if (!url) file = downloadIncidentFile('visit');
    return { ok: true, url, file, why };
}

// ---- The dialog ----
function openVisitDialog(incidentId) {
    if (state.readOnly) { readOnlyRefuses(); return; }
    const s = _pm.session;
    const id = incidentId || (s && s.incidentId) || null;
    const now = _incHooks.now();
    _pm.vd = {
        stage: 'form', gen: (_pm.vd ? _pm.vd.gen : 0) + 1, busy: false,
        incidentId: id && incidentById(id) ? id : null,
        // Who you are, as remembered; else the one provider the report was
        // sent to, so a visit saved straight away still names its company.
        providerId: providerSelfOf(_pm.docId || state.docId) || soleRoutedProvider(id ? incidentById(id) : null),
        arrived: s && s.lastVisitAt && lastVisitHeld(s) ? s.lastVisitAt : (s ? s.at : now), left: now,
        outcome: '', notes: '', by: reportEngineerDefault(), signoff: '',
        changes: undefined, changesState: 'loading', entry: null, ret: null
    };
    const vd = _pm.vd;
    const scrim = pmEl('visitDialog');
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onClose: () => { if (_pm.vd === vd) _pm.vd = null; } });
    else scrim.hidden = false;
    renderVisitDialog();
    loadVisitChanges(vd);
}
async function loadVisitChanges(vd) {
    let base = null;
    try { base = await visitBaseDoc(); } catch (e) { base = null; }
    if (_pm.vd !== vd) return;
    if (!base) { vd.changes = undefined; vd.changesState = 'missing'; }
    else {
        try { vd.changes = visitChangesOf(base, serializeDoc()); vd.changesState = 'ok'; }
        catch (e) { console.warn('Visit: changes', e); vd.changes = undefined; vd.changesState = 'missing'; }
    }
    renderVisitDialog();
}
function closeVisitDialog() {
    const scrim = pmEl('visitDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
    _pm.vd = null;
}
const visitDialogOpen = () => !!_pm.vd;
function readVisitForm() {
    const vd = _pm.vd;
    if (!vd || vd.stage !== 'form') return;
    vd.providerId = pmEl('visitProvider').value;
    vd.arrived = fromLocalInput(pmEl('visitArrived').value);
    vd.left = fromLocalInput(pmEl('visitLeft').value);
    vd.notes = pmEl('visitNotes').value;
    vd.by = pmEl('visitBy').value;
    vd.signoff = pmEl('visitSignoff').value;
}
function renderVisitDialog() {
    const vd = _pm.vd;
    if (!vd) return;
    const form = vd.stage === 'form';
    pmEl('visitForm').hidden = !form;
    pmEl('visitReturn').hidden = form;
    pmEl('visitTitle').textContent = form ? t('Record visit') : t('Send the visit back');
    pmEl('visitCancelBtn').classList.toggle('hidden', !form);
    pmEl('visitSaveBtn').classList.toggle('hidden', !form);
    pmEl('visitDoneBtn').classList.toggle('hidden', form);
    pmEl('visitSaveBtn').disabled = vd.busy || vd.changesState === 'loading';
    pmEl('visitSaveBtn').textContent = t('Save visit');
    if (form) renderVisitForm(); else renderVisitReturn();
}
function renderVisitForm() {
    const vd = _pm.vd;
    const inc = vd.incidentId ? incidentById(vd.incidentId) : null;
    pmEl('visitHead').textContent = inc ? `${INCIDENT_SYMPTOM_GLYPH[inc.symptom] || ''} ${symptomLabel(inc.symptom)} · ${incidentWhereText(inc)}` : t('A visit with no problem report');
    fillProviderSelect(pmEl('visitProvider'), inc, vd.providerId);
    const setVal = (id, v) => { const f = pmEl(id); if (f.value !== v) f.value = v; };
    setVal('visitArrived', toLocalInput(vd.arrived));
    setVal('visitLeft', toLocalInput(vd.left));
    setVal('visitNotes', vd.notes);
    setVal('visitBy', vd.by);
    setVal('visitSignoff', vd.signoff);
    const tiles = pmEl('visitOutcomes');
    tiles.textContent = '';
    VISIT_OUTCOMES.forEach((o) => {
        const lab = pmNode('label', 'pb-tile' + (vd.outcome === o ? ' on' : ''));
        const r = pmNode('input');
        r.type = 'radio'; r.name = 'visitOutcome'; r.value = o; r.checked = vd.outcome === o;
        const g = pmNode('span', 'pb-glyph', VISIT_OUTCOME_GLYPH[o]);
        g.setAttribute('aria-hidden', 'true');
        lab.append(r, g, pmNode('span', '', visitOutcomeLabel(o)));
        tiles.appendChild(lab);
    });
    pmEl('visitCount').textContent = t('{n} of {max} characters', { n: pmEl('visitNotes').value.length, max: VISIT_NOTES_MAX });
    // What changed: read-only.
    const sum = pmEl('visitChangesSummary'), list = pmEl('visitChanges');
    list.textContent = '';
    if (vd.changesState === 'loading') sum.textContent = t('Working out what changed…');
    else if (vd.changesState === 'missing') sum.textContent = t('The copy you received is no longer held in this tab, so the changes cannot be listed.');
    else {
        const c = vd.changes.counts;
        const n = c.added + c.changed + c.removed;
        sum.textContent = n ? t('{added} added, {changed} changed, {removed} removed', c) : t('No changes to the network were recorded.');
        (vd.changes.items || []).forEach((x) => list.appendChild(pmNode('li', 'vs-change', visitChangeText(x))));
    }
}

async function saveVisit() {
    const vd = _pm.vd;
    if (!vd || vd.busy) return;
    readVisitForm();
    const problems = visitDraftProblems(vd);
    const err = pmEl('visitError');
    err.textContent = joinSentences(problems);
    if (problems.length) {
        const target = !VISIT_OUTCOMES.includes(vd.outcome) ? pmEl('visitOutcomes').querySelector('input') : !String(vd.by).trim() ? pmEl('visitBy') : pmEl('visitLeft');
        if (target) target.focus();
        return;
    }
    vd.busy = true; renderVisitDialog();
    let entry = null;
    try {
        entry = await recordVisit({ incidentId: vd.incidentId, providerId: vd.providerId, by: vd.by, arrived: vd.arrived, left: vd.left,
            outcome: vd.outcome, notes: vd.notes, signoff: String(vd.signoff || '').trim() || undefined, changes: vd.changes });
    } finally { vd.busy = false; }
    if (_pm.vd !== vd) return;
    if (!entry) { err.textContent = t('The visit could not be saved.'); renderVisitDialog(); return; }
    showToast(t('Visit recorded.'), 'ok');
    enterReturnStage(entry);
}

// ---- Sending it back ----
function enterReturnStage(entry) {
    const vd = _pm.vd;
    vd.stage = 'return';
    vd.entry = entry;
    pmEl('visitError').textContent = '';
    const held = _pm.pass.get(_pm.docId || state.docId || null);
    const hits = secretHitsFor('doc');
    vd.ret = { pass: held || (canSeal() ? generatePassphrase() : ''), samePass: !!held, shown: false, hits, result: null, busy: false, copied: '' };
    renderVisitDialog();
    if (!hits.length) makeVisitReturn();
}
async function makeVisitReturn() {
    const vd = _pm.vd;
    const r = vd && vd.ret;
    if (!r || r.busy) return;
    r.busy = true; r.copied = '';
    pmEl('visitError').textContent = '';
    renderVisitDialog();
    let res;
    try { res = await buildVisitReturn(r.pass); } catch (e) { res = { ok: false }; }
    if (_pm.vd !== vd) return;
    r.busy = false;
    if (!res.ok) { pmEl('visitError').textContent = t('The link could not be made in this browser. Download the file instead.'); r.result = { ok: true, url: null, file: '', why: 'failed' }; }
    else r.result = res;
    const inc = vd.entry && vd.entry.incidentId ? incidentById(vd.entry.incidentId) : null;
    r.result.message = composeVisitMessage({ incident: inc, entry: vd.entry, link: r.result.url || '', file: r.result.file, sealed: !!r.result.url, samePass: r.samePass });
    // A second visit in this session compares with the copy that just left.
    if (_pm.session && !state.readOnly && vd.entry && lastVisitHeld(Object.assign({}, _pm.session, { lastVisitId: vd.entry.id }))) {
        writeProviderSession(Object.assign({}, _pm.session, { lastVisitJson: JSON.stringify(serializeDoc()), lastVisitId: vd.entry.id }));
    }
    renderVisitDialog();
}
function renderVisitReturn() {
    const vd = _pm.vd;
    const r = vd.ret || {};
    const res = r.result;
    const e = vd.entry || {};
    pmEl('visitReturnHead').textContent = visitLineText(e);
    renderSecretLint(pmEl('visitLint'), r.hits || [], null);
    const sealedLink = !!(res && res.url);
    pmEl('visitPassRow').classList.toggle('hidden', !r.pass || !!(res && !sealedLink));
    const pass = pmEl('visitPass');
    pass.value = r.pass || '';
    pass.type = r.shown ? 'text' : 'password';
    const show = pmEl('visitPassShow');
    show.textContent = r.shown ? t('Hide') : t('Show');
    show.setAttribute('aria-pressed', r.shown ? 'true' : 'false');
    show.setAttribute('aria-label', r.shown ? t('Hide the passphrase') : t('Show the passphrase'));
    pmEl('visitPassCopy').textContent = r.copied === 'pass' ? `✓ ${t('Passphrase copied')}` : `🔑 ${t('Copy passphrase')}`;
    pmEl('visitPassNote').textContent = !r.pass || (res && !sealedLink) ? ''
        : r.samePass ? t('Locked with the passphrase that opened the link: the client already has it.')
            : t('A new passphrase: send it another way, such as a call or a text.');
    const make = pmEl('visitMakeBtn');
    make.classList.toggle('hidden', !!res || !(r.hits && r.hits.length) && !r.busy);
    make.disabled = !!r.busy;
    make.textContent = r.busy ? `⏳ ${t('Locking…')}` : t('Send anyway');
    const status = pmEl('visitReturnStatus');
    if (r.busy) status.textContent = canSeal() ? t('Locking the link…') : '';
    else if (!res) status.textContent = '';
    else if (res.why === 'link') status.textContent = t('Send it back to the client: they open it in Topo and keep it, and the visit joins their network.');
    else if (res.why === 'too-long') status.textContent = t('This network is too big for a link, so the file {file} was downloaded: send it to the client.', { file: res.file });
    else if (res.why === 'no-seal') status.textContent = t('This page cannot lock a link (it needs https), so the file {file} was downloaded: send it to the client.', { file: res.file });
    else status.textContent = '';
    if (res && r.copied === 'link') status.textContent = t('The link is in your clipboard. Paste it into the email where it says so.');
    if (res && r.copied === 'link-failed') status.textContent = t('The link could not be copied. Copy it from the box below, then press the email button again and paste it where the email says so.');
    if (res && r.copied === 'message') status.textContent = t('Message copied.');
    const link = pmEl('visitLink');
    link.value = sealedLink ? res.url : '';
    link.classList.toggle('hidden', !sealedLink);
    const m = res && res.message;
    const inc = e.incidentId ? incidentById(e.incidentId) : null;
    const rep = (inc && inc.reporter) || {};
    const email = pmEl('visitEmailBtn'), call = pmEl('visitCallBtn'), share = pmEl('visitShareBtn'), copyMsg = pmEl('visitCopyMsgBtn'),
        copyLink = pmEl('visitCopyLinkBtn'), file = pmEl('visitFileBtn');
    email.classList.toggle('hidden', !(m && m.to.length));
    const tel = telHref(rep.phone);
    call.classList.toggle('hidden', !(res && tel));
    if (tel) { call.href = tel; call.textContent = `📞 ${rep.phone}`; call.setAttribute('aria-label', t('Call {name}', { name: rep.name || rep.phone })); }
    share.classList.toggle('hidden', !res || !_incHooks.canShare());
    copyMsg.classList.toggle('hidden', !res);
    copyLink.classList.toggle('hidden', !sealedLink);
    file.classList.toggle('hidden', !res);
    email.textContent = `✉ ${t('Email the client')}`;
    share.textContent = `↗ ${t('Share…')}`;
    copyMsg.textContent = `📋 ${t('Copy message')}`;
    copyLink.textContent = r.copied === 'linkonly' ? `✓ ${t('Link copied')}` : `🔗 ${t('Copy link')}`;
    file.textContent = res && res.file ? `⬇ ${t('Download the file again')}` : `⬇ ${t('Download the file')}`;
}
async function visitEmail() {
    const r = _pm.vd && _pm.vd.ret;
    const res = r && r.result;
    if (!res) return;
    const m = res.message;
    if (m.linkLeftOut && res.url && r.copied !== 'link-failed') {
        if (await incidentCopy(res.url)) r.copied = 'link';
        else {
            r.copied = 'link-failed';
            renderVisitDialog();
            const box = pmEl('visitLink'); box.focus(); box.select();
            return;
        }
    }
    renderVisitDialog();
    _incHooks.open(m.mailto);
}
async function visitShare() {
    const res = _pm.vd && _pm.vd.ret && _pm.vd.ret.result;
    if (!res) return;
    try { await _incHooks.share({ title: res.message.subject, text: res.message.fullBody }); } catch (e) { /* cancelled */ }
}
async function visitCopyMessage() {
    const r = _pm.vd && _pm.vd.ret;
    const res = r && r.result;
    if (!res) return;
    if (await incidentCopy(`${res.message.subject}\n\n${res.message.fullBody}`)) { r.copied = 'message'; renderVisitDialog(); }
}
async function visitCopyLink() {
    const r = _pm.vd && _pm.vd.ret;
    const res = r && r.result;
    if (!res || !res.url) return;
    if (await incidentCopy(res.url)) { r.copied = 'linkonly'; renderVisitDialog(); }
    else { const box = pmEl('visitLink'); box.focus(); box.select(); }
}
async function visitCopyPass() {
    const r = _pm.vd && _pm.vd.ret;
    if (!r) return;
    if (await incidentCopy(r.pass)) { r.copied = 'pass'; renderVisitDialog(); }
    else { const f = pmEl('visitPass'); f.type = 'text'; f.focus(); f.select(); }
}
function visitFile() {
    const res = _pm.vd && _pm.vd.ret && _pm.vd.ret.result;
    if (!res) return;
    res.file = downloadIncidentFile('visit');
    renderVisitDialog();
}

// The language changed (applyLocale, js/app.js).
function providerModeLocale() {
    renderProviderChrome();
    if (_pm.vd) { readVisitForm(); renderVisitDialog(); }
}

(function wireProviderMode() {
    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(syncProviderBarHeight);
        ['providerStrip', 'incidentBanner'].forEach((id) => { const x = pmEl(id); if (x) ro.observe(x); });
    }
    const go = pmEl('incidentBannerGo');
    if (go) go.addEventListener('click', incidentBannerGo);
    const later = pmEl('incidentBannerLater');
    if (later) later.addEventListener('click', dismissIncidentBanner);
    const sv = pmEl('providerStripVisit');
    if (sv) sv.addEventListener('click', () => openVisitDialog());
    const sd = pmEl('providerStripDetails');
    if (sd) sd.addEventListener('click', openProviderPanel);
    const scrim = pmEl('visitDialog');
    if (!scrim) return;
    scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeVisitDialog));
    if (!window.CarinoUI) scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeVisitDialog(); } });
    pmEl('visitOutcomes').addEventListener('change', (e) => {
        if (e.target.name !== 'visitOutcome' || !_pm.vd) return;
        readVisitForm();
        _pm.vd.outcome = e.target.value;
        pmEl('visitError').textContent = '';
        renderVisitDialog();
        const r = pmEl('visitOutcomes').querySelector(`input[value="${_pm.vd.outcome}"]`);
        if (r) r.focus();
    });
    pmEl('visitNotes').addEventListener('input', () => { pmEl('visitCount').textContent = t('{n} of {max} characters', { n: pmEl('visitNotes').value.length, max: VISIT_NOTES_MAX }); });
    pmEl('visitSaveBtn').addEventListener('click', saveVisit);
    pmEl('visitMakeBtn').addEventListener('click', makeVisitReturn);
    pmEl('visitPassShow').addEventListener('click', () => { const r = _pm.vd && _pm.vd.ret; if (r) { r.shown = !r.shown; renderVisitDialog(); } });
    pmEl('visitPassCopy').addEventListener('click', visitCopyPass);
    pmEl('visitEmailBtn').addEventListener('click', visitEmail);
    pmEl('visitShareBtn').addEventListener('click', visitShare);
    pmEl('visitCopyMsgBtn').addEventListener('click', visitCopyMessage);
    pmEl('visitCopyLinkBtn').addEventListener('click', visitCopyLink);
    pmEl('visitFileBtn').addEventListener('click', visitFile);
})();

// Published for tests/suites/providermode.js (and the Incidents tab later).
window.TopoProviderMode = {
    state: _pm, VISIT_OUTCOME_LABEL,
    providerDocLoaded, providerMergeArrival, enterProviderMode, leaveProviderMode, exitProviderView, readProviderSession,
    incidentMapIds, incidentBannerText, renderIncidentBanner, dismissIncidentBanner, incidentBannerGo,
    providerSelfOf, setProviderSelf, visitBaseDoc, visitChangesOf, visitDraftProblems, recordVisit, composeVisitMessage, buildVisitReturn,
    openVisitDialog, closeVisitDialog, saveVisit, makeVisitReturn, renderProviderPanel, visitLineText, visitChangeText, openProviderPanel
};
