// ---- Problem reports: Report a problem and Send (docs/SCOPE.md step 4) ----
// A client who is not technical says what is wrong and where; Topo says whom
// to contact (routeIncident, js/routing.js) and sends the report, with the
// network it happened on, to those providers. The record itself is
// doc.incidents (js/model.js "Problem reports"); every change to one is one
// undo step with its own 'incident' log entry, chained like a merge's.
//
//   commitIncidentChange   the one way an incident changes on the open
//                          network: the change and its log entry, after the
//                          one await (the chain's digest), in one batch
//   createIncident         a new report (status open), the network kept in
//                          this browser first, so a visit sent back has a
//                          card to merge into
//   sendIncident           status sent (sentAt the first time, routedTo
//                          grows), then a locked link of the network with
//                          its reports; a network too big for a link, or a
//                          page that cannot lock one, goes as a file to
//                          attach: an unlocked link never carries a report
//   composeIncidentMessage the email's subject and body and the mailto:,
//                          pure, so the suite reads the words without a mail
//                          program
//
// The sheet (#problemDialog) is one page, top to bottom, phone first: what
// is wrong (tiles), where (tap it on the map, a list, the place), what
// happened, who you are (remembered in Settings, never in a URL), whom to
// contact (ranked, with call and email buttons and Send to ticks). Save, or
// Save and send: the second turns the sheet into the send step. Translated:
// the client reads all of it.
//
// Nothing is sent from here. Email opens the visitor's mail program with a
// mailto:, Share hands the message to the system's share sheet; the link
// travels in what they send, the passphrase another way.

const INCIDENT_MAILTO_MAX = 1900;   // desktop mail programs cut a mailto: near 2000
const INCIDENT_SYMPTOM_GLYPH = { internet: '🌐', wifi: '📶', phone: '☎', camera: '📷', printer: '🖨', power: '⚡', other: '❓' };
const incEl = (id) => document.getElementById(id);

// Hooks the suite replaces: the link-length cap, and how a mailto: or tel:
// is opened (a real one leaves the page for the mail program).
const _incHooks = {
    urlMax: () => (typeof DOC_URL_MAX === 'number' ? DOC_URL_MAX : 16000),
    open: (url) => { window.location.href = url; },
    canShare: () => typeof navigator.share === 'function',
    share: (data) => navigator.share(data),
    copy: (text) => navigator.clipboard.writeText(text),
    now: () => Date.now()
};

// ---- Reading an incident ----
const incidentById = (id, list = state.incidents) => (list || []).find((x) => x && x.id === id) || null;
// "Reception PC, Printer", "Office", or "Whole place".
function incidentWhereText(inc, ctx = {}) {
    const nodes = ctx.nodes || state.nodes, groups = ctx.groups || state.groups;
    const names = (inc.nodeIds || []).map((id) => nodes.find((n) => n.id === id)).filter(Boolean).map(locPlainName);
    const group = inc.groupId ? groupById(inc.groupId, groups) : null;
    const parts = [];
    if (names.length) parts.push(names.slice(0, 5).join(', ') + (names.length > 5 ? ` +${names.length - 5}` : ''));
    if (group) parts.push(groupLabel(group));
    return parts.length ? parts.join(' · ') : t('Whole place');
}
const incidentReporterText = (r) => [r && r.name, r && r.phone, r && r.email].filter(Boolean).join(' · ');
function incidentWhen(at) {
    if (!Number.isFinite(at) || at <= 0) return '';
    return typeof restoreWhenText === 'function' ? restoreWhenText(at) : new Date(at).toLocaleString();
}
// Where the network is, for a subject line: the report's site, the card's
// name, the organization.
function incidentSiteName() {
    const site = state.report && typeof state.report.site === 'string' ? state.report.site.trim() : '';
    return site || docDisplayName() || docOrganization() || t('Untitled network');
}
// A phone number as a tel: target: digits, +, and the dial characters.
const telHref = (phone) => { const x = String(phone || '').replace(/[^\d+*#,;]/g, ''); return x ? `tel:${x}` : ''; };
const mailAddr = (a) => String(a || '').trim().replace(/[%?&#,\s]/g, (c) => encodeURIComponent(c));

// ---- The message (pure) ----
// -> { subject, body, fullBody, mailto, to: [emails], noEmail: [names], linkLeftOut }
// body is what the mailto: carries; fullBody always has the link (Copy
// message, Share). A mailto: longer than INCIDENT_MAILTO_MAX leaves the link
// out ("in your clipboard: paste it here", D43); if it is still too long,
// the client's words are shortened in the email (never in the report).
function composeIncidentMessage({ incident, site, providers = [], link = '', file = '', sealed = false, ctx = {} }) {
    const inc = incident || {};
    const symptom = symptomLabel(inc.symptom);
    const subject = t('Network problem at {site}: {symptom}', { site: site || incidentSiteName(), symptom });
    const to = [], noEmail = [];
    providers.forEach((p) => { if (!p) return; if (p.email && providerEmailOk(p.email)) to.push(p.email.trim()); else noEmail.push(p.name || p.id); });
    const head = (words) => {
        const lines = [];
        if (words) lines.push(words, '');
        lines.push(t('Problem: {symptom}', { symptom }));
        lines.push(t('Where: {where}', { where: incidentWhereText(inc, ctx) }));
        const who = incidentReporterText(inc.reporter);
        if (who) lines.push(t('Reported by: {who}', { who }));
        const when = incidentWhen(inc.at);
        if (when) lines.push(t('When: {date}', { date: when }));
        lines.push('');
        return lines;
    };
    const tail = (withLink) => {
        const lines = [];
        if (link) lines.push(withLink ? t('Open the network in Topo: {link}', { link }) : t('The link is in your clipboard: paste it here.'));
        else if (file) lines.push(t('The network is in the attached file {file}. Open it with Topo: {url}', { file, url: publicBase() }));
        if (link && sealed) lines.push(t('The passphrase comes separately: I will send it by another way.'));
        return lines;
    };
    const words = inc.text || '';
    const fullBody = head(words).concat(tail(true)).join('\n');
    const mk = (b) => `mailto:${to.map(mailAddr).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b)}`;
    let body = fullBody, mailto = mk(body), linkLeftOut = false;
    if (mailto.length > INCIDENT_MAILTO_MAX && link) {
        linkLeftOut = true;
        body = head(words).concat(tail(false)).join('\n');
        mailto = mk(body);
    }
    if (mailto.length > INCIDENT_MAILTO_MAX && words) {
        // The words are what is left to shorten: by halves, then exactly.
        let keep = words.length;
        while (keep > 0 && mailto.length > INCIDENT_MAILTO_MAX) {
            keep = Math.floor(keep * 0.8);
            body = head(words.slice(0, keep).trimEnd() + '…').concat(tail(!linkLeftOut)).join('\n');
            mailto = mk(body);
        }
    }
    return { subject, body, fullBody, mailto, to, noEmail, linkLeftOut };
}

// ---- Changing an incident on the open network ----
// mutate(doc) changes the serialized copy's incidents and returns
// { incident, event, routedTo } for the log entry (or { entry }, an entry
// already built: a visit's), or null to do nothing.
// The log's digest is awaited, so whatever moved the network meanwhile is
// checked for: tried once more, then refused. -> mutate's answer, or null.
async function commitIncidentChange(mutate) {
    if (state.readOnly) { readOnlyRefuses(); return null; }
    for (let attempt = 0; attempt < 2; attempt++) {
        if (typeof commitTyping === 'function') commitTyping();
        const beforeJson = JSON.stringify(serializeDoc());
        const doc = JSON.parse(beforeJson);
        if (!Array.isArray(doc.incidents)) doc.incidents = [];
        const res = mutate(doc);
        if (!res) return null;
        // A visit brings its own entry (js/providermode.js); the rest are
        // the report's events.
        const entry = res.entry !== undefined ? res.entry : incidentLogEntry({ id: 'lg_' + randomToken(), at: _incHooks.now(), incident: res.incident, event: res.event, routedTo: res.routedTo });
        const next = entry ? await appendLogEntry(doc, entry) : doc;
        if (JSON.stringify(serializeDoc()) !== beforeJson || state.readOnly) continue;
        state.linkSourceId = null;
        batch(() => {
            loadDocState(next);
            pruneSelection();
            save();
            renderCanvasOnly();
        });
        // A report is not left to the autosave's delay: it is in the card
        // now (a refusal shows the storage banner; it stays on screen).
        if (isKept()) flushAutosave();
        renderSelection();
        updateUndoButtons();
        if (typeof renderDocBar === 'function') renderDocBar();
        return res;
    }
    showToast(t('The network changed while the report was being saved. Try again.'));
    return null;
}

// The report's network has to be a card here: a visit sent back is merged
// into it, and an unkept network lives only in this tab. A link of a
// network that is already a card (yours, sent back) is not claimed here:
// keeping it is the merge question, asked by Keep this network.
// -> 'kept' | 'claimed' | 'known' | 'failed'
function keepForIncident() {
    if (isKept()) return 'kept';
    if (state.docId && libraryEntry(state.docId)) return 'known';
    const id = claimDocument(null, state.docId || null, {}, sessionCardMeta());
    return id ? 'claimed' : 'failed';
}

// What is missing from a report before it can be saved: translated lines.
function incidentDraftProblems(d) {
    const out = [];
    if (!INCIDENT_SYMPTOMS.includes(d.symptom)) out.push(t('Choose what is wrong.'));
    if (!String(d.name || '').trim()) out.push(t('Type your name.'));
    if (!String(d.phone || '').trim() && !String(d.email || '').trim()) out.push(t('Type a phone number or an email, so they can reach you.'));
    if (String(d.email || '').trim() && !providerEmailOk(d.email)) out.push(t('That email does not look right.'));
    return out;
}

// d: { symptom, nodeIds, groupId, text, name, phone, email, routedTo, remember }
// -> the new incident's id, or null (refused, or the network changed).
async function createIncident(d) {
    if (state.readOnly) { readOnlyRefuses(); return null; }
    if (incidentDraftProblems(d).length) return null;
    const kept = keepForIncident();
    const reporter = {};
    ['name', 'phone', 'email'].forEach((k) => { const v = String(d[k] || '').trim(); if (v) reporter[k] = v; });
    const inc = {
        id: newIncidentId(), at: _incHooks.now(), status: 'open', symptom: d.symptom,
        nodeIds: (d.nodeIds || []).filter((id) => getNode(id)),
        text: String(d.text || '').slice(0, INCIDENT_TEXT_MAX),
        reporter,
        routedTo: (d.routedTo || []).filter((id) => providerById(id)),
        visits: []
    };
    if (d.groupId && groupById(d.groupId)) inc.groupId = d.groupId;
    const res = await commitIncidentChange((doc) => {
        doc.incidents.push(inc);
        return { incident: inc, event: 'opened', routedTo: inc.routedTo };
    });
    if (!res) return null;
    if (d.remember !== false) {
        const rep = normalizeReporterSetting(reporter);
        if (rep) state.settings.reporter = rep;
        saveSettings();
    }
    if (kept === 'claimed') showToast(t('Kept in this browser, with the problem report.'), 'ok');
    else if (kept === 'failed') showToast(t('This network could not be kept in this browser (storage is unavailable). Send the report as a file to keep it.'), 'err');
    else if (kept === 'known') showToast(t('Problem saved in this copy. Keep this network to put it with yours.'));
    return inc.id;
}

// A network file of the open network, its reports and visits included:
// topo_<org>_<site>_<date>_<kind>.json. -> the file's name.
function downloadIncidentFile(kind) {
    const doc = identifiedDoc(serializeDoc());
    const name = docDisplayName();
    const filename = `${docFileStem(kind)}.json`;
    downloadJson(Object.assign({ kind: 'nettopology', version: 1 }, name ? { name } : {}, { doc }), filename);
    return filename;
}

// Mark it sent and make what goes to the providers. opts: { providerIds,
// passphrase }. The status is committed first, so the copy that leaves says
// sent; if the link then cannot be made, that one step is undone (nothing
// else has run since). -> { ok, url, file, why: 'link'|'too-long'|'no-seal',
// message } or { ok: false, reason }.
async function sendIncident(id, opts = {}) {
    if (state.readOnly) { readOnlyRefuses(); return { ok: false, reason: 'readonly' }; }
    if (!incidentById(id)) return { ok: false, reason: 'missing' };
    const to = (opts.providerIds || incidentById(id).routedTo || []).filter((p) => providerById(p));
    const res = await commitIncidentChange((doc) => {
        const x = doc.incidents.find((i) => i && i.id === id);
        if (!x) return null;
        x.routedTo = (Array.isArray(x.routedTo) ? x.routedTo : []).concat(to.filter((p) => !(x.routedTo || []).includes(p)));
        if (!x.sentAt) x.sentAt = _incHooks.now();
        if (incidentStatusIndex(x.status) < incidentStatusIndex('sent')) x.status = 'sent';
        return { incident: x, event: 'sent', routedTo: to };
    });
    if (!res) return { ok: false, reason: 'stale' };
    const committed = JSON.stringify(serializeDoc());
    let url = null, file = '', why = 'link';
    if (!canSeal()) why = 'no-seal';
    else {
        const pass = String(opts.passphrase || '');
        try {
            if (pass.length < SEAL_MIN_PASSPHRASE) throw new Error('passphrase');
            url = await buildShareLink('doc', true, pass, { incidents: true, max: _incHooks.urlMax() });
        } catch (e) {
            console.warn('Report: could not make the link', e);
            if (JSON.stringify(serializeDoc()) === committed) undo();
            return { ok: false, reason: 'build' };
        }
        if (!url) why = 'too-long';
    }
    if (!url) file = downloadIncidentFile('incident');
    const inc = incidentById(id);
    const providers = to.map((p) => providerById(p)).filter(Boolean);
    const message = composeIncidentMessage({ incident: inc, providers, link: url || '', file, sealed: !!url });
    return { ok: true, url, file, why, message, providers };
}

// ---- The sheet ----
const _pb = {
    open: false, stage: 'form', gen: 0, busy: false, picking: false,
    symptom: '', nodeIds: [], groupId: '', text: '', name: '', phone: '', email: '', remember: true,
    sendTo: [], ticksTouched: false, incidentId: null, send: null
};
const problemDialogOpen = () => _pb.open;

function resetProblemDraft() {
    const rep = state.settings.reporter || {};
    Object.assign(_pb, { stage: 'form', busy: false, picking: false, symptom: '', nodeIds: [], groupId: '', text: '',
        name: rep.name || '', phone: rep.phone || '', email: rep.email || '', remember: true, sendTo: [], ticksTouched: false, incidentId: null, send: null });
    // The device selected now is the likely one.
    if (state.selectedType === 'node' && state.selectedId && getNode(state.selectedId)) _pb.nodeIds = [state.selectedId];
}

function openProblemDialog() {
    if (state.readOnly) { readOnlyRefuses(); return; }
    resetProblemDraft();
    showProblemSheet();
}
// Send again, or the send step of a report saved earlier.
function openIncidentSend(id) {
    const inc = incidentById(id);
    if (!inc) return;
    if (state.readOnly) { readOnlyRefuses(); return; }
    resetProblemDraft();
    Object.assign(_pb, { incidentId: id, symptom: inc.symptom, nodeIds: (inc.nodeIds || []).slice(), groupId: inc.groupId || '', sendTo: (inc.routedTo || []).slice() });
    showProblemSheet();
    enterSendStage();
}
function showProblemSheet() {
    const scrim = incEl('problemDialog');
    _pb.open = true;
    _pb.gen++;
    if (window.CarinoUI) CarinoUI.modal.open(scrim, { onClose: () => { if (!_pb.picking) { _pb.open = false; _pb.gen++; } } });
    else scrim.hidden = false;
    renderProblemDialog();
}
function closeProblemDialog() {
    const scrim = incEl('problemDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
    if (!_pb.picking) { _pb.open = false; _pb.gen++; }
}

// The form's fields into the draft (before a redraw or a pick).
function readProblemForm() {
    if (_pb.stage !== 'form') return;
    _pb.text = incEl('problemText').value;
    _pb.name = incEl('problemName').value;
    _pb.phone = incEl('problemPhone').value;
    _pb.email = incEl('problemEmail').value;
    _pb.remember = incEl('problemRemember').checked;
    _pb.groupId = incEl('problemGroup').value;
}

function problemRoute() {
    return routeIncident(undefined, { nodeIds: _pb.nodeIds, groupId: _pb.groupId || undefined, symptom: _pb.symptom || 'other' }, { now: new Date(_incHooks.now()) });
}
// The ticks to start with: the top contact, and any tied with it.
function defaultSendTo(route) {
    const r = route.results;
    if (!r.length) return [];
    const top = r[0];
    return r.filter((x) => x.serviceRank === top.serviceRank && x.distance === top.distance).map((x) => x.provider.id);
}

function renderProblemDialog() {
    if (!_pb.open) return;
    const form = _pb.stage === 'form';
    incEl('problemForm').hidden = !form;
    incEl('problemSend').hidden = form;
    incEl('problemTitle').textContent = form ? t('Report a problem') : t('Send the problem report');
    incEl('problemCancelBtn').classList.toggle('hidden', !form);
    incEl('problemSaveBtn').classList.toggle('hidden', !form);
    incEl('problemSaveSendBtn').classList.toggle('hidden', !form);
    incEl('problemDoneBtn').classList.toggle('hidden', form);
    [incEl('problemSaveBtn'), incEl('problemSaveSendBtn')].forEach((b) => { b.disabled = _pb.busy; });
    if (form) renderProblemForm(); else renderProblemSend();
}

function renderProblemForm() {
    // What is wrong: a tile per symptom, one at a time.
    const tiles = incEl('problemSymptoms');
    tiles.textContent = '';
    INCIDENT_SYMPTOMS.forEach((s) => {
        const lab = document.createElement('label');
        lab.className = 'pb-tile' + (_pb.symptom === s ? ' on' : '');
        const r = document.createElement('input');
        r.type = 'radio'; r.name = 'problemSymptom'; r.value = s; r.checked = _pb.symptom === s;
        const g = document.createElement('span'); g.className = 'pb-glyph'; g.setAttribute('aria-hidden', 'true'); g.textContent = INCIDENT_SYMPTOM_GLYPH[s];
        const w = document.createElement('span'); w.textContent = symptomLabel(s);
        lab.append(r, g, w);
        tiles.appendChild(lab);
    });
    // Where: the devices as chips, a list to add one from, the place.
    const where = incEl('problemWhere');
    where.textContent = '';
    _pb.nodeIds = _pb.nodeIds.filter((id) => getNode(id));
    _pb.nodeIds.forEach((id) => {
        const n = getNode(id);
        const chip = document.createElement('span'); chip.className = 'pv-chip';
        const nm = document.createElement('span'); nm.textContent = locPlainName(n);
        const x = document.createElement('button');
        x.type = 'button'; x.className = 'pv-chip-x'; x.dataset.remove = id; x.textContent = '✕';
        x.setAttribute('aria-label', t('Remove {name}', { name: locPlainName(n) }));
        chip.append(nm, x);
        where.appendChild(chip);
    });
    const pick = incEl('problemDevicePick');
    pick.textContent = '';
    const first = document.createElement('option');
    first.value = ''; first.textContent = t('Choose from a list…');
    pick.appendChild(first);
    const likely = SYMPTOM_DEVICE_TYPES[_pb.symptom] || [];
    const devices = state.nodes.filter((n) => !isRetired(n) && !_pb.nodeIds.includes(n.id))
        .sort((a, b) => naturalCompare(locPlainName(a), locPlainName(b)));
    const opt = (n) => { const o = document.createElement('option'); o.value = n.id; o.textContent = `${locPlainName(n)} · ${t(typeName(n.type))}`; return o; };
    const top = devices.filter((n) => likely.includes(n.type)), rest = devices.filter((n) => !likely.includes(n.type));
    if (top.length) {
        const og = document.createElement('optgroup'); og.label = t('Likely');
        top.forEach((n) => og.appendChild(opt(n)));
        pick.appendChild(og);
        const og2 = document.createElement('optgroup'); og2.label = t('Every device');
        rest.forEach((n) => og2.appendChild(opt(n)));
        if (rest.length) pick.appendChild(og2);
    } else rest.forEach((n) => pick.appendChild(opt(n)));
    pick.value = '';
    const grp = incEl('problemGroup');
    grp.textContent = '';
    const whole = document.createElement('option'); whole.value = ''; whole.textContent = t('Whole place');
    grp.appendChild(whole);
    (state.groups || []).filter((g) => g.kind !== 'rack').forEach((g) => {
        const o = document.createElement('option');
        o.value = g.id;
        o.textContent = groupChain(g).map(groupLabel).join(' › ');
        grp.appendChild(o);
    });
    grp.value = (state.groups || []).some((g) => g.id === _pb.groupId) ? _pb.groupId : '';
    _pb.groupId = grp.value;
    grp.closest('.pb-row').classList.toggle('hidden', !(state.groups || []).some((g) => g.kind !== 'rack'));
    incEl('problemTapBtn').textContent = t('Tap it on the map');
    // The words and who: kept as typed across redraws.
    const setVal = (id, v) => { const f = incEl(id); if (f.value !== v) f.value = v; };
    setVal('problemText', _pb.text);
    setVal('problemName', _pb.name);
    setVal('problemPhone', _pb.phone);
    setVal('problemEmail', _pb.email);
    incEl('problemRemember').checked = _pb.remember;
    renderProblemCount();
    renderProblemContacts();
}
function renderProblemCount() {
    incEl('problemCount').textContent = t('{n} of {max} characters', { n: incEl('problemText').value.length, max: INCIDENT_TEXT_MAX });
}

// One row per provider, best first: name, service, why, open now, a call
// and an email button, and Send to.
function contactRow(r, opts = {}) {
    const li = document.createElement('li');
    li.className = 'pb-contact';
    const text = document.createElement('div'); text.className = 'pb-contact-text';
    const name = document.createElement('span'); name.className = 'pb-contact-name'; name.textContent = r.provider.name || r.provider.id;
    const why = document.createElement('span'); why.className = 'pb-contact-why';
    why.textContent = [r.reason, routeOpenText(r)].filter(Boolean).join(' · ');
    text.append(name, why);
    const acts = document.createElement('div'); acts.className = 'pb-contact-acts';
    const tel = telHref(r.provider.phone);
    if (tel) {
        const a = document.createElement('a'); a.className = 'btn pb-call'; a.href = tel;
        a.textContent = `📞 ${r.provider.phone}`;
        a.setAttribute('aria-label', t('Call {name}', { name: r.provider.name || r.provider.id }));
        acts.appendChild(a);
    }
    if (r.provider.email && providerEmailOk(r.provider.email) && opts.mail !== false) {
        const a = document.createElement('a'); a.className = 'btn pb-mail'; a.href = `mailto:${mailAddr(r.provider.email)}`;
        a.textContent = '✉';
        a.setAttribute('aria-label', t('Email {name}', { name: r.provider.name || r.provider.id }));
        a.title = r.provider.email;
        acts.appendChild(a);
    }
    if (opts.tick) {
        const lab = document.createElement('label'); lab.className = 'dlg-check pb-sendto';
        const box = document.createElement('input'); box.type = 'checkbox'; box.dataset.sendto = r.provider.id;
        box.checked = _pb.sendTo.includes(r.provider.id);
        const w = document.createElement('span'); w.textContent = t('Send to');
        lab.append(box, w);
        acts.appendChild(lab);
    }
    li.append(text, acts);
    return li;
}
function renderProblemContacts() {
    const route = problemRoute();
    if (!_pb.ticksTouched) _pb.sendTo = defaultSendTo(route);
    const none = incEl('problemNoProvider');
    none.textContent = route.empty ? route.sentence : '';
    none.classList.toggle('hidden', !route.empty);
    const list = incEl('problemContacts');
    list.textContent = '';
    route.results.forEach((r) => list.appendChild(contactRow(r, { tick: true })));
}

// Save (and maybe go on to Send).
async function saveProblem(andSend) {
    if (_pb.busy) return;
    readProblemForm();
    const problems = incidentDraftProblems(_pb);
    const err = incEl('problemError');
    err.textContent = joinSentences(problems);
    if (problems.length) {
        // The first field that needs something.
        const target = !INCIDENT_SYMPTOMS.includes(_pb.symptom) ? incEl('problemSymptoms').querySelector('input')
            : !String(_pb.name).trim() ? incEl('problemName') : incEl(String(_pb.email).trim() ? 'problemEmail' : 'problemPhone');
        if (target) target.focus();
        return;
    }
    _pb.busy = true; renderProblemDialog();
    const gen = _pb.gen;
    let id = null;
    try { id = await createIncident(Object.assign({}, _pb, { routedTo: _pb.sendTo })); }
    finally { _pb.busy = false; }
    if (gen !== _pb.gen) return;
    if (!id) { err.textContent = t('The problem could not be saved.'); renderProblemDialog(); return; }
    _pb.incidentId = id;
    if (!andSend) {
        closeProblemDialog();
        showToast(t('Problem saved. Send it to the providers when you are ready.'), 'ok');
        return;
    }
    enterSendStage();
}

// ---- The send step ----
function enterSendStage() {
    _pb.stage = 'send';
    incEl('problemError').textContent = '';
    const hits = secretHitsFor('doc');
    _pb.send = { pass: canSeal() ? generatePassphrase() : '', shown: false, hits, result: null, busy: false, copied: '' };
    renderProblemDialog();
    // Nothing to warn about: the link is made at once. Otherwise the
    // warning is read first, and the link waits for a tap.
    if (!hits.length) makeIncidentLink();
}

async function makeIncidentLink() {
    const s = _pb.send;
    if (!s || s.busy || !_pb.incidentId) return;
    s.busy = true; s.copied = '';
    incEl('problemError').textContent = '';
    renderProblemDialog();
    const gen = _pb.gen;
    let res;
    try { res = await sendIncident(_pb.incidentId, { providerIds: _pb.sendTo, passphrase: s.pass }); }
    catch (e) { console.warn('Report: send failed', e); res = { ok: false, reason: 'build' }; }
    if (gen !== _pb.gen || _pb.send !== s) return;
    s.busy = false;
    if (!res.ok) {
        incEl('problemError').textContent = res.reason === 'build' ? t('The link could not be made in this browser, so nothing was marked as sent.')
            : t('The problem could not be marked as sent.');
        renderProblemDialog();
        return;
    }
    s.result = res;
    renderProblemDialog();
}

function renderProblemSend() {
    const s = _pb.send || {};
    const inc = incidentById(_pb.incidentId);
    incEl('problemSendHead').textContent = inc ? `${INCIDENT_SYMPTOM_GLYPH[inc.symptom] || ''} ${symptomLabel(inc.symptom)} · ${incidentWhereText(inc)}` : '';
    const names = _pb.sendTo.map((id) => providerById(id)).filter(Boolean).map((p) => p.name || p.id);
    const res = s.result;
    const noEmail = res && res.message && Array.isArray(res.message.noEmail) ? res.message.noEmail : [];
    incEl('problemSendTo').textContent = joinSentences([names.length ? t('To: {names}', { names: names.join(', ') })
        : t('No provider is chosen: send it to whoever looks after this network.'),
        noEmail.length ? t('No email address for {names}: call them, or copy the message.', { names: noEmail.join(', ') }) : '']);
    renderSecretLint(incEl('problemLint'), s.hits || [], null);
    const sealedLink = !!(res && res.url);
    // The passphrase: before the link only while it is being made; after,
    // only for a locked link.
    incEl('problemPassRow').classList.toggle('hidden', !s.pass || !!(res && !sealedLink));
    const pass = incEl('problemPass');
    pass.value = s.pass || '';
    pass.type = s.shown ? 'text' : 'password';
    const show = incEl('problemPassShow');
    show.textContent = s.shown ? t('Hide') : t('Show');
    show.setAttribute('aria-pressed', s.shown ? 'true' : 'false');
    show.setAttribute('aria-label', s.shown ? t('Hide the passphrase') : t('Show the passphrase'));
    incEl('problemPassCopy').textContent = s.copied === 'pass' ? `✓ ${t('Passphrase copied')}` : `🔑 ${t('Copy passphrase')}`;
    const status = incEl('problemSendStatus');
    const make = incEl('problemMakeBtn');
    make.classList.toggle('hidden', !!res || !(s.hits && s.hits.length) && !s.busy && !incEl('problemError').textContent);
    make.disabled = !!s.busy;
    make.textContent = s.busy ? `⏳ ${t('Locking…')}` : (s.hits && s.hits.length ? t('Send anyway') : t('Try again'));
    if (s.busy) status.textContent = canSeal() ? t('Locking the link…') : '';
    else if (!res) status.textContent = '';
    else if (res.why === 'link') status.textContent = t('Marked as sent. The link is locked: send the passphrase another way, such as a call or a text.');
    else if (res.why === 'too-long') status.textContent = t('Marked as sent. This network is too big for a link, so the file {file} was downloaded: attach it to the email.', { file: res.file });
    else status.textContent = t('Marked as sent. This page cannot lock a link (it needs https), so the file {file} was downloaded instead: attach it to the email.', { file: res.file });
    if (res && s.copied === 'link') status.textContent = t('The link is in your clipboard. Paste it into the email where it says so.');
    if (res && s.copied === 'link-failed') status.textContent = t('The link could not be copied. Copy it from the box below, then press the email button again and paste it where the email says so.');
    if (res && s.copied === 'message') status.textContent = t('Message copied.');
    const link = incEl('problemLink');
    link.value = sealedLink ? res.url : '';
    link.classList.toggle('hidden', !sealedLink);
    const email = incEl('problemEmailBtn'), share = incEl('problemShareBtn'), copy = incEl('problemCopyMsgBtn'), file = incEl('problemFileBtn');
    [email, share, copy, file].forEach((b) => b.classList.toggle('hidden', !res));
    // Nobody chosen has an email: a mailto: with no one in To helps nobody.
    if (res) email.classList.toggle('hidden', !(res.message && res.message.to.length));
    if (res) {
        email.textContent = `✉ ${t('Email')}`;
        share.textContent = `↗ ${t('Share…')}`;
        share.classList.toggle('hidden', !_incHooks.canShare());
        copy.textContent = `📋 ${t('Copy message')}`;
        file.textContent = res.file ? `⬇ ${t('Download the file again')}` : `⬇ ${t('Download the file')}`;
    }
    // Calls stay at hand: a provider's phone is often the quickest way.
    const calls = incEl('problemCalls');
    calls.textContent = '';
    if (res) (res.providers || []).forEach((p) => { if (telHref(p.phone)) calls.appendChild(contactRow({ provider: p, reason: providerServiceLabel(providerServiceOf(p)) || '', open: null }, { mail: false })); });
}

async function incidentCopy(text) {
    try { await _incHooks.copy(text); return true; } catch (e) { return false; }
}
async function problemEmail() {
    const res = _pb.send && _pb.send.result;
    if (!res) return;
    const m = res.message;
    // The link did not fit the mailto: it goes to the clipboard, and the
    // email says to paste it.
    // If the copy fails, the email would say "paste it here" with nothing to
    // paste: say so first and show the link; the second press opens it.
    if (m.linkLeftOut && res.url && _pb.send.copied !== 'link-failed') {
        if (await incidentCopy(res.url)) _pb.send.copied = 'link';
        else {
            _pb.send.copied = 'link-failed';
            renderProblemDialog();
            const box = incEl('problemLink'); box.focus(); box.select();
            return;
        }
    }
    renderProblemDialog();
    _incHooks.open(m.mailto);
}
async function problemShare() {
    const res = _pb.send && _pb.send.result;
    if (!res) return;
    try { await _incHooks.share({ title: res.message.subject, text: res.message.fullBody }); }
    catch (e) { /* cancelled */ }
}
async function problemCopyMessage() {
    const res = _pb.send && _pb.send.result;
    if (!res) return;
    const text = `${res.message.subject}\n\n${res.message.fullBody}`;
    if (await incidentCopy(text)) { _pb.send.copied = 'message'; renderProblemDialog(); }
    else { const box = incEl('problemLink'); box.value = text; box.classList.remove('hidden'); box.focus(); box.select(); }
}
async function problemCopyPass() {
    if (!_pb.send) return;
    if (await incidentCopy(_pb.send.pass)) { _pb.send.copied = 'pass'; renderProblemDialog(); }
    else { const f = incEl('problemPass'); f.type = 'text'; f.focus(); f.select(); }
}
function problemFileAgain() {
    const res = _pb.send && _pb.send.result;
    if (!res) return;
    res.file = downloadIncidentFile('incident');
}

// ---- Tap it on the map ----
// The sheet steps aside, a banner asks for the device, and the next device
// selected is the one. Cancel brings the sheet back as it was.
function problemPickBanner() {
    let b = incEl('problemPickBanner');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'problemPickBanner';
    b.className = 'pb-pick-banner';
    b.setAttribute('role', 'status');
    b.hidden = true;
    const text = document.createElement('span'); text.className = 'pb-pick-text';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'cs-btn pb-pick-cancel';
    cancel.addEventListener('click', () => endProblemPick(null));
    b.append(text, cancel);
    document.body.appendChild(b);
    if (typeof mapOverlay === 'function') mapOverlay(b);
    return b;
}
function startProblemPick() {
    readProblemForm();
    _pb.picking = true;
    closeProblemDialog();
    const ws = document.querySelector('.topo-ws');
    if (ws && ws.classList.contains('drawer-open') && mqMatches(DRAWER_MQ)) {
        const toggle = document.querySelector('[data-ws-toggle]');
        if (toggle) toggle.click();
    }
    if (typeof effectiveView === 'function' && effectiveView() !== 'map' && typeof setView === 'function') setView('map');
    selectEntries([]);
    const b = problemPickBanner();
    b.querySelector('.pb-pick-text').textContent = t('Tap the device with the problem');
    b.querySelector('.pb-pick-cancel').textContent = t('Cancel');
    b.hidden = false;
}
function endProblemPick(nodeId) {
    if (!_pb.picking) return;
    _pb.picking = false;
    const b = incEl('problemPickBanner');
    if (b) b.hidden = true;
    if (nodeId && getNode(nodeId) && !_pb.nodeIds.includes(nodeId)) _pb.nodeIds.push(nodeId);
    showProblemSheet();
}
document.addEventListener('topo:selectionchange', () => {
    if (!_pb.picking) return;
    if (state.selectedType === 'node' && state.selectedId) endProblemPick(state.selectedId);
});

// The language changed with the sheet open (applyLocale, js/app.js).
function problemDialogLocale() {
    if (!_pb.open) return;
    readProblemForm();
    renderProblemDialog();
}

(function wireProblemDialog() {
    const scrim = incEl('problemDialog');
    if (!scrim) return;
    ['reportProblemBtn', 'reportProblemBtn2', 'reportProblemMenuBtn'].forEach((id) => { const b = incEl(id); if (b) b.addEventListener('click', openProblemDialog); });
    scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeProblemDialog));
    if (!window.CarinoUI) scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeProblemDialog(); } });
    incEl('problemSymptoms').addEventListener('change', (e) => {
        if (e.target.name !== 'problemSymptom') return;
        readProblemForm();
        _pb.symptom = e.target.value;
        incEl('problemError').textContent = '';
        renderProblemDialog();
        const r = incEl('problemSymptoms').querySelector(`input[value="${_pb.symptom}"]`);
        if (r) r.focus();
    });
    incEl('problemWhere').addEventListener('click', (e) => {
        const x = e.target.closest('[data-remove]');
        if (!x) return;
        readProblemForm();
        _pb.nodeIds = _pb.nodeIds.filter((id) => id !== x.dataset.remove);
        renderProblemDialog();
    });
    incEl('problemDevicePick').addEventListener('change', (e) => {
        const id = e.target.value;
        if (!id) return;
        readProblemForm();
        if (getNode(id) && !_pb.nodeIds.includes(id)) _pb.nodeIds.push(id);
        renderProblemDialog();
    });
    incEl('problemGroup').addEventListener('change', () => { readProblemForm(); renderProblemContacts(); });
    incEl('problemTapBtn').addEventListener('click', startProblemPick);
    incEl('problemText').addEventListener('input', renderProblemCount);
    incEl('problemContacts').addEventListener('change', (e) => {
        const id = e.target.dataset && e.target.dataset.sendto;
        if (!id) return;
        _pb.ticksTouched = true;
        _pb.sendTo = _pb.sendTo.filter((x) => x !== id);
        if (e.target.checked) _pb.sendTo.push(id);
    });
    incEl('problemSaveBtn').addEventListener('click', () => saveProblem(false));
    incEl('problemSaveSendBtn').addEventListener('click', () => saveProblem(true));
    incEl('problemMakeBtn').addEventListener('click', makeIncidentLink);
    incEl('problemPassShow').addEventListener('click', () => { if (_pb.send) { _pb.send.shown = !_pb.send.shown; renderProblemDialog(); } });
    incEl('problemPassCopy').addEventListener('click', problemCopyPass);
    incEl('problemEmailBtn').addEventListener('click', problemEmail);
    incEl('problemShareBtn').addEventListener('click', problemShare);
    incEl('problemCopyMsgBtn').addEventListener('click', problemCopyMessage);
    incEl('problemFileBtn').addEventListener('click', problemFileAgain);
})();

// ---- Closing the loop: the client's side (step 4 stage 5) ----
// What came back is merged (js/mergeui.js shows the visit and the report's
// status in the review); here the client reads the reports and their visits
// and acts on them: Send again, Mark fixed (closed, with a note), Reopen (a
// round up: incidentRank, so a merge with an older closed copy cannot undo
// it, D38). Three places show them: the Problems tab of the full editor, the
// Simple and imagenology views' lists (the selected device's, or every open
// one with nothing selected) with a marker on the map, and a line on the
// landing card. Translated throughout: the client reads all of it.

// A report still to be dealt with: anything not closed.
const incidentLive = (x) => !!x && x.status !== 'closed';
const liveIncidents = (list = state.incidents) => (list || []).filter(incidentLive);
const incidentsNewestFirst = (list) => list.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
// The devices with a report not closed, for the map's marker (js/ui.js and
// js/groupmap.js read it once per draw).
function openIncidentNodeIds() {
    const out = new Set();
    liveIncidents().forEach((x) => (x.nodeIds || []).forEach((id) => out.add(id)));
    return out;
}
const INCIDENT_STATUS_TEXT = { open: 'Reported', sent: 'Sent', visited: 'Visited', closed: 'Fixed' };
const incidentStatusText = (inc) => t(INCIDENT_STATUS_TEXT[inc && inc.status] || 'Reported');

// Mark fixed: closed, when and why. One undo step, a 'closed' log entry.
// -> whether it was closed.
async function markIncidentFixed(id, note) {
    const res = await commitIncidentChange((doc) => {
        const x = doc.incidents.find((i) => i && i.id === id);
        if (!x || x.status === 'closed') return null;
        x.status = 'closed';
        x.closedAt = _incHooks.now();
        const n = String(note || '').trim().slice(0, INCIDENT_TEXT_MAX);
        if (n) x.closedNote = n; else delete x.closedNote;
        return { incident: x, event: 'closed', routedTo: [] };
    });
    return !!res;
}
// Reopen: open again, one round up, the closure cleared. One undo step, a
// 'reopened' log entry. -> whether it was reopened.
async function reopenIncident(id) {
    const res = await commitIncidentChange((doc) => {
        const x = doc.incidents.find((i) => i && i.id === id);
        if (!x || x.status !== 'closed') return null;
        x.status = 'open';
        x.reopened = (Number.isInteger(x.reopened) && x.reopened > 0 ? x.reopened : 0) + 1;
        delete x.closedAt;
        delete x.closedNote;
        return { incident: x, event: 'reopened', routedTo: [] };
    });
    return !!res;
}
// The buttons' answers: the note asked first (Cancel closes nothing).
async function askMarkFixed(id) {
    const inc = incidentById(id);
    if (!inc || inc.status === 'closed') return false;
    const note = await askPrompt(t('Mark this problem as fixed. A note, if you like (what was done, who confirmed it):'),
        { title: t('Mark fixed'), value: '', ok: t('Mark fixed') });
    if (note === null) return false;
    const done = await markIncidentFixed(id, note);
    if (done) showToast(t('Marked as fixed.'), 'ok');
    return done;
}
async function askReopen(id) {
    const done = await reopenIncident(id);
    if (done) showToast(t('Reopened.'), 'ok');
    return done;
}

// A log entry of a report, in words (the network log, the report).
function incidentLogText(e) {
    const symptom = symptomLabel(e.symptom);
    const n = Array.isArray(e.routedTo) ? e.routedTo.length : 0;
    if (e.event === 'sent') return n === 1 ? t('Problem sent to 1 provider: {symptom}.', { symptom }) : t('Problem sent to {n} providers: {symptom}.', { n, symptom });
    if (e.event === 'closed') return t('Problem marked fixed: {symptom}.', { symptom });
    if (e.event === 'reopened') return t('Problem reopened: {symptom}.', { symptom });
    return t('Problem reported: {symptom}.', { symptom });
}

// ---- One report as a row ----
const incNode = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
function incButton(text, act, id) {
    const b = incNode('button', 'btn inc-act', text);
    b.type = 'button';
    b.dataset.incAct = act;
    b.dataset.inc = id;
    return b;
}
const incVisitEntry = (id) => (state.log || []).find((e) => e && e.id === id && e.kind === 'visit') || null;
// opts.compact: the Simple view's (the words cut, the last visit only, no
// list of changes).
function incidentRowEl(inc, opts = {}) {
    const li = incNode('li', `inc-row inc-${inc.status}`);
    li.dataset.inc = inc.id;
    const head = incNode('div', 'inc-head');
    head.appendChild(incNode('span', `pm-status pm-${inc.status}`, incidentStatusText(inc)));
    const what = incNode('span', 'inc-what', `${INCIDENT_SYMPTOM_GLYPH[inc.symptom] || '⚠'} ${symptomLabel(inc.symptom)}`);
    head.appendChild(what);
    li.appendChild(head);
    const where = incNode('p', 'inc-where');
    const nodes = (inc.nodeIds || []).map((id) => getNode(id)).filter(Boolean);
    if (nodes.length && !opts.compact) {
        nodes.forEach((n, i) => {
            if (i) where.appendChild(document.createTextNode(', '));
            const b = incNode('button', 'link-btn inc-dev', locPlainName(n));
            b.type = 'button';
            b.dataset.incAct = 'locate';
            b.dataset.node = n.id;
            where.appendChild(b);
        });
        const g = inc.groupId ? groupById(inc.groupId) : null;
        if (g) where.appendChild(document.createTextNode(` · ${groupLabel(g)}`));
    } else where.textContent = incidentWhereText(inc);
    where.appendChild(incNode('span', 'dlg-dim inc-when', ` · ${incidentWhen(inc.at)}`));
    li.appendChild(where);
    if (inc.text) {
        const words = opts.compact && inc.text.length > 140 ? `${inc.text.slice(0, 140).trimEnd()}…` : inc.text;
        li.appendChild(incNode('blockquote', 'pm-words inc-words', words));
    }
    if (!opts.compact) {
        const who = incidentReporterText(inc.reporter);
        if (who) li.appendChild(incNode('p', 'dlg-dim inc-line', t('Reported by: {who}', { who })));
        const to = (inc.routedTo || []).map((id) => providerById(id)).filter(Boolean).map((p) => p.name || p.id);
        li.appendChild(incNode('p', 'dlg-dim inc-line', to.length ? t('Sent to: {names}', { names: to.join(', ') })
            : inc.status === 'open' ? t('Not sent yet.') : t('Sent to: {names}', { names: '—' })));
    }
    // The visits: who, when, how it went, the notes, what changed.
    const ids = inc.visits || [];
    const held = ids.map(incVisitEntry).filter(Boolean);
    const shown = opts.compact ? held.slice(-1) : held;
    if (shown.length) {
        const ul = incNode('ul', 'pm-visit-list inc-visits');
        shown.forEach((e) => {
            const v = incNode('li', 'pm-visit', typeof visitLineText === 'function' ? visitLineText(e) : e.summary || '');
            if (e.notes && !opts.compact) v.appendChild(incNode('span', 'pm-visit-notes', e.notes));
            const items = (e.changes && e.changes.items) || [];
            if (items.length && !opts.compact && typeof visitChangeText === 'function') {
                const det = incNode('details', 'inc-changes');
                det.appendChild(incNode('summary', '', t('What changed')));
                const cl = incNode('ul', 'vs-changes');
                items.forEach((x) => cl.appendChild(incNode('li', 'vs-change', visitChangeText(x))));
                det.appendChild(cl);
                v.appendChild(det);
            }
            ul.appendChild(v);
        });
        li.appendChild(ul);
    }
    if (ids.length > held.length && !opts.compact) {
        const n = ids.length - held.length;
        li.appendChild(incNode('p', 'dlg-dim inc-line', t(n === 1 ? 'One visit was recorded elsewhere and is not in this copy.' : '{n} visits were recorded elsewhere and are not in this copy.', { n })));
    }
    if (inc.status === 'closed') {
        const line = t('Marked fixed {date}.', { date: incidentWhen(inc.closedAt) }) + (inc.closedNote ? ` ${inc.closedNote}` : '');
        li.appendChild(incNode('p', 'dlg-dim inc-line inc-closed', line));
    }
    if (!state.readOnly) {
        const acts = incNode('div', 'pb-acts inc-acts');
        if (inc.status !== 'closed') {
            acts.appendChild(incButton(`↗ ${inc.sentAt ? t('Send again') : t('Send to the providers')}`, 'send', inc.id));
            acts.appendChild(incButton(`✓ ${t('Mark fixed')}`, 'fix', inc.id));
        } else acts.appendChild(incButton(`↺ ${t('Reopen')}`, 'reopen', inc.id));
        li.appendChild(acts);
    }
    return li;
}

// ---- The Problems tab (full editor) and the Simple lists ----
const incTabShown = () => { const p = incEl('cfgPanel-incidents'); return !!p && !p.classList.contains('hidden'); };
function renderIncidentsPanel() {
    const all = state.incidents || [];
    const live = liveIncidents(all);
    const btn = incEl('incTabBtn');
    if (btn) btn.classList.toggle('hidden', isReduced() || !all.length);
    const count = incEl('incTabCount');
    if (count) { count.textContent = live.length ? String(live.length) : ''; count.classList.toggle('hidden', !live.length); }
    const panel = incEl('cfgPanel-incidents');
    if (panel && incTabShown()) {
        // A field being typed in is left alone (none here today; a note
        // asked for goes through askPrompt).
        const list = incEl('incidentList');
        list.textContent = '';
        incidentsNewestFirst(all).forEach((inc) => list.appendChild(incidentRowEl(inc)));
        incEl('incidentsEmpty').classList.toggle('hidden', !!all.length);
        incEl('incidentsSummary').textContent = all.length ? t('{open} open of {n}.', { open: live.length, n: all.length }) : '';
    }
    renderProblemsSimpleAll();
}
// The Simple views, nothing selected: every report not closed.
function renderProblemsSimpleAll() {
    const box = incEl('problemsSimpleAll');
    if (!box) return;
    box.textContent = '';
    const live = isReduced() ? incidentsNewestFirst(liveIncidents()) : [];
    box.classList.toggle('hidden', !live.length);
    if (!live.length) return;
    box.appendChild(incNode('p', 'rail-sub inc-sub', t(live.length === 1 ? 'Open problems: 1' : 'Open problems: {n}', { n: live.length })));
    const ul = incNode('ul', 'inc-list');
    live.forEach((inc) => ul.appendChild(incidentRowEl(inc, { compact: true })));
    box.appendChild(ul);
}
// The Simple views, one device selected: its reports not closed
// (renderLocate, js/locate.js, hands the device).
function renderProblemsSimple(node) {
    const box = incEl('problemsSimple');
    if (!box) return;
    box.textContent = '';
    const live = node && isReduced() ? incidentsNewestFirst(liveIncidents().filter((x) => (x.nodeIds || []).includes(node.id))) : [];
    box.classList.toggle('hidden', !live.length);
    if (!live.length) return;
    box.appendChild(incNode('p', 'rail-sub inc-sub', t(live.length === 1 ? 'Open problems: 1' : 'Open problems: {n}', { n: live.length })));
    const ul = incNode('ul', 'inc-list');
    live.forEach((inc) => ul.appendChild(incidentRowEl(inc, { compact: true })));
    box.appendChild(ul);
}
function renderIncidentsUi() {
    renderIncidentsPanel();
    if (typeof locateNode === 'function') renderProblemsSimple(locateNode());
}
// The map's marker for a device (or a fold holding one) with a problem
// not closed: a small amber ! at the bottom-left corner, clear of the ✕
// (top-left), the findings badge (top-right) and the pin (bottom-right).
// Explicit colours, as the pin's; the export leaves it out (it is the
// view's, canvasSvgMarkup in js/app.js).
function problemMarkEl(x, y) {
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('transform', 'translate(' + x + ', ' + y + ')');
    g.setAttribute('class', 'node-problem');
    const disc = document.createElementNS(ns, 'circle');
    disc.setAttribute('r', '7');
    disc.setAttribute('fill', '#f59e0b'); disc.setAttribute('stroke', '#ffffff'); disc.setAttribute('stroke-width', '1.5');
    g.appendChild(disc);
    const mark = document.createElementNS(ns, 'text');
    mark.setAttribute('text-anchor', 'middle'); mark.setAttribute('y', '3.5');
    mark.setAttribute('font-size', '10'); mark.setAttribute('font-weight', '900'); mark.setAttribute('fill', '#ffffff');
    mark.setAttribute('font-family', 'sans-serif');
    mark.textContent = '!';
    g.appendChild(mark);
    const tip = document.createElementNS(ns, 'title');
    tip.textContent = t('A problem was reported here');
    g.appendChild(tip);
    return g;
}
// The Problems tab opened (the landing card's ⚠, a suite); the Simple
// views show their list with nothing selected.
function openIncidentsView() {
    const ws = document.querySelector('.topo-ws');
    const openDrawer = () => {
        if (ws && mqMatches(DRAWER_MQ) && !ws.classList.contains('drawer-open')) {
            const toggle = document.querySelector('[data-ws-toggle]');
            if (toggle) toggle.click();
        }
    };
    if (isReduced()) {
        selectEntries([]);
        showConfigTab('config');
        openDrawer();
        renderIncidentsUi();
        const box = incEl('problemsSimpleAll');
        if (box && box.scrollIntoView) requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest' }));
        return;
    }
    renderIncidentsPanel();
    showConfigTab('incidents');
    openDrawer();
    renderIncidentsPanel();
}
// The landing card's line: "Open problems: 2 · newest No internet, 9 Nov
// 2026, 14:10", or '' when none is open. From the card's document alone.
function landingProblemsText(doc) {
    const live = liveIncidents(doc && Array.isArray(doc.incidents) ? doc.incidents : []);
    if (!live.length) return '';
    const newest = incidentsNewestFirst(live)[0];
    return t('Open problems: {n} · newest {symptom}, {date}', { n: live.length, symptom: symptomLabel(newest.symptom), date: incidentWhen(newest.at) });
}
// One handler for every list's buttons (the tab, both Simple lists).
async function incidentActClick(e) {
    const b = e.target.closest('[data-inc-act]');
    if (!b) return;
    const act = b.dataset.incAct;
    if (act === 'locate') {
        const n = getNode(b.dataset.node);
        if (n) { selectEntries([{ type: 'node', id: n.id }]); centreOnNodes([n]); }
        return;
    }
    const id = b.dataset.inc;
    if (act === 'send') openIncidentSend(id);
    else if (act === 'fix') await askMarkFixed(id);
    else if (act === 'reopen') await askReopen(id);
}
['cfgPanel-incidents', 'problemsSimple', 'problemsSimpleAll'].forEach((id) => { const x = incEl(id); if (x) x.addEventListener('click', incidentActClick); });

// ---- In the report ----
// The Problem reports and visits section (REPORT_SECTIONS 'incidents', off
// unless ticked): each report, newest first, with its visits read from the
// log by id; a visit the log does not hold is said, not guessed. It prints
// the reporter's name and contact, which is why it is off by default.
function incidentsReportSection(incidents, log) {
    const list = incidentsNewestFirst(normalizeIncidents(incidents));
    if (!list.length) return '';
    const entries = new Map((Array.isArray(log) ? log : []).filter((e) => e && e.kind === 'visit').map((e) => [e.id, e]));
    const esc = escapeHtml;
    const lead = `<p class="muted">${esc(t('The problems reported on this network and the visits recorded for them, newest first. They travel with the network.'))}</p>`;
    const blocks = list.map((inc) => {
        const visits = (inc.visits || []).map((id) => {
            const e = entries.get(id);
            if (!e) return `<li class="muted">${esc(t('A visit recorded elsewhere.'))}</li>`;
            const line = typeof visitLineText === 'function' ? visitLineText(e) : e.summary || '';
            return `<li>${esc(line)}${e.notes ? `<br><span class="muted">${esc(e.notes)}</span>` : ''}${e.signoff ? `<br><span class="muted">${esc(t('Signed off by: {name}', { name: e.signoff }))}</span>` : ''}</li>`;
        }).join('');
        const to = (inc.routedTo || []).map((id) => providerById(id)).filter(Boolean).map((p) => p.name || p.id).join(', ');
        const rows = [
            [t('Status'), incidentStatusText(inc) + (inc.status === 'closed' && inc.closedAt ? ` · ${localDateOf(inc.closedAt)}` : '')],
            [t('Where?'), incidentWhereText(inc)],
            [t('Reported on'), localDateOf(inc.at)],
            [t('Reported by'), incidentReporterText(inc.reporter) || '—'],
            [t('Sent to'), to || '—']
        ];
        if (inc.closedNote) rows.push([t('Note'), inc.closedNote]);
        return `<h3>${esc(`${symptomLabel(inc.symptom)} · ${incidentWhereText(inc)}`)}</h3>
        <table class="changes"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
        ${inc.text ? `<p>${esc(inc.text)}</p>` : ''}${visits ? `<ul>${visits}</ul>` : `<p class="muted">${esc(t('No visit recorded yet.'))}</p>`}`;
    }).join('');
    return lead + blocks;
}

// Published for tests/suites/incident.js (and the later steps' panels).
window.TopoIncidents = {
    hooks: _incHooks, draft: _pb, INCIDENT_MAILTO_MAX,
    commitIncidentChange, createIncident, sendIncident, composeIncidentMessage, incidentDraftProblems, keepForIncident,
    incidentWhereText, incidentSiteName, downloadIncidentFile, openProblemDialog, openIncidentSend, closeProblemDialog,
    startProblemPick, endProblemPick, defaultSendTo, telHref,
    markIncidentFixed, reopenIncident, askMarkFixed, askReopen, openIncidentNodeIds, liveIncidents, incidentLogText, renderIncidentsPanel,
    renderIncidentsUi, renderProblemsSimple, openIncidentsView, landingProblemsText, incidentsReportSection, incidentStatusText, incidentById
};
