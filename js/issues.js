// ---- Issues: outages and who acted on them (docs/SCOPE.md D132, D158-D160,
// D172, D173, step 7g) ----
// A confirmed outage on the PC that monitors becomes an issue record, kept
// by the app (desktop/src-tauri/src/issues.rs) and sent here as the event
// "topo-issues". This file is the page's side:
//
//   folding   when the network the records belong to is open (and not
//             read-only, nor locked), every record not yet in the document
//             goes into doc.incidents as an outage (kind 'outage', the
//             record's id, js/model.js "Problem reports") with an
//             'incident' log entry ('outage'), and each act with its own
//             ('acknowledged', 'reported', 'expected'); a recovery or a
//             repeat updates the outage with no entry. No review: it only
//             adds (D158). Without a server these records are this PC's own,
//             trusted as local (D173); the app is told which were folded,
//             and acts the document holds that the record lacks (made where
//             the app was not, a file, another window) are sent back to it.
//   acting    Acknowledge (a note if you like), Report a problem (the
//             report prefilled, routed by step 4, nothing sent on its own)
//             and Expected (maintenance or planned work: its time counts as
//             maintenance). Each is one undo step with its log entry, and
//             goes to the app's record too. Owners act; a provider only on
//             the devices they cover; a viewer (read-only) only looks.
//   the rows  an outage's row in the Problems tab and the Simple lists:
//             not answering since, answering again since (in a softer
//             colour, still waiting), the devices behind it, who acted.
//   the card  the app's alarm window (desktop/alarm.html) hands
//             Acknowledge and Report a problem here when the window is
//             locked (and Report a problem always): Topo asks to unlock
//             first (TopoLock.requestUnlock), opens the monitored network,
//             then acts.
//   Settings  Show alarms on this PC (off as shipped, D131), with the
//             Wayland caveat, and Test the alarm (the card marked DRILL).
//
// The website and the offline zip have no window.__TAURI__: they show the
// outages a document carries and act on them in the document only.
// Load order: ... -> checks -> issues -> app -> settings

(function () {
'use strict';
const _is = {
    invoke: null,        // tests: stands in for window.__TAURI__.core.invoke
    records: new Map(),  // id -> the app's issue record
    listening: false,
    timer: 0,
    folding: null,       // the fold running now (a promise)
    pending: null,       // an act handed over by the card, waiting for the page
    lastHand: null,      // { key, at }: the last hand-over taken (it can come twice: the event and alarm_take)
    ready: false,        // the boot has decided (topo:ready)
    seenRecovered: new Set(),
    // D254: a fold is one undo step that Undo may take back. So a record is
    // folded again only when it changes (foldedRev: id -> the rev folded or
    // found), not on every redraw, and the app is told a record is in the
    // document (and may drop it) only when this page found it there without
    // having folded it in itself: the undo history then cannot take it out.
    foldedRev: new Map(),
    foldedHere: new Set(),
    foldNet: null        // the network those two are for (a network opened anew starts a new undo history)
};
const el = (id) => document.getElementById(id);
const FOLD_DELAY_MS = 300;

function isInvoke(cmd, args) {
    if (_is.invoke) return Promise.resolve().then(() => _is.invoke(cmd, args || {}));
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
function isListen(name, cb) {
    const ev = window.__TAURI__ && window.__TAURI__.event;
    if (!ev || typeof ev.listen !== 'function') return Promise.resolve(() => {});
    return ev.listen(name, cb);
}
const hasHost = () => !!_is.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
const locked = () => !!(window.TopoLock && TopoLock.isLocked());

// ---- Reading an outage ----
// The symptom a device's outage reads as (step 4's words and routing).
const OUTAGE_SYMPTOM = { cloud: 'internet', router: 'internet', firewall: 'internet', edge: 'internet', modem: 'internet', ap: 'wifi', voip: 'phone', camera: 'camera', nvr: 'camera', printer: 'printer' };
const symptomForType = (type) => OUTAGE_SYMPTOM[type] || 'other';
const outageNode = (inc, nodes = state.nodes) => (inc && inc.nodeIds && inc.nodeIds[0] ? nodes.find((n) => n.id === inc.nodeIds[0]) : null) || null;
// A watched address's outage (v20, D374) names it in watchIds.
const outageWatch = (inc, watch = state.watch) => (inc && inc.watchIds && inc.watchIds[0] ? watchById(inc.watchIds[0], watch) : null);
function outageName(inc, nodes, watch) {
    const n = outageNode(inc, nodes);
    if (n) return locPlainName(n);
    const w = outageWatch(inc, watch);
    if (w) return watchLabel(w);
    return (inc && ((inc.watchIds && inc.watchIds[0]) || (inc.nodeIds && inc.nodeIds[0]))) || t('A device');
}
// What a record is about in `doc`: a device, or a watched address ("w:" id).
function recordSubject(r, doc) {
    if (!r || !r.nodeId) return null;
    const wid = watchIdOfItem(r.nodeId);
    if (wid) { const w = watchById(wid, (doc && doc.watch) || []); return w ? { watch: w } : null; }
    const n = ((doc && doc.nodes) || []).find((x) => x.id === r.nodeId);
    return n ? { node: n } : null;
}
const lastSpan = (inc) => (inc && Array.isArray(inc.outages) && inc.outages.length ? inc.outages[inc.outages.length - 1] : null);
// Answering again since (the last time down ended), or null.
function outageRecovered(inc) {
    const s = lastSpan(inc);
    return s && Number.isFinite(s.to) && !inc.gone ? s.to : null;
}
const outageSince = (inc) => { const s = lastSpan(inc); return s ? s.from : (inc && inc.at) || 0; };
function minutesText(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    return min < 60 ? t('{n} min', { n: min }) : t('{h} h {m} min', { h: Math.floor(min / 60), m: min % 60 });
}
function clockText(at) {
    const lang = window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined;
    const sameDay = new Date(at).toDateString() === new Date().toDateString();
    try { return sameDay ? new Date(at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : new Date(at).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(at).toLocaleString(); }
}
const ACT_WORDS = { ack: 'Acknowledged', report: 'Problem reported', expected: 'Expected (maintenance)' };
const ACT_STATUS = { ack: 'Acknowledged', report: 'Reported', expected: 'Expected' };

// ---- From a record to an outage ----
// The outage a record says, joined with what the document already holds
// for it (acts and times down are unions; the earlier close wins).
function outageFromRecord(r, had, doc) {
    const nodes = (doc && doc.nodes) || state.nodes;
    const node = nodes.find((n) => n.id === r.nodeId);
    const base = had ? JSON.parse(JSON.stringify(had)) : { id: r.id, status: 'open', reporter: {}, routedTo: [], visits: [] };
    const spans = (had && had.outages ? had.outages : []).map((o) => Object.assign({}, o));
    (r.outages || []).forEach((o) => {
        const i = spans.findIndex((x) => x.from === o.from);
        const span = { from: o.from };
        if (Number.isFinite(o.to)) span.to = o.to;
        if (i < 0) spans.push(span);
        else if (Number.isFinite(o.to) && !(Number.isFinite(spans[i].to) && spans[i].to >= o.to)) spans[i].to = o.to;
    });
    spans.sort((a, b) => a.from - b.from);
    const acts = (had && had.acts ? had.acts : []).map((a) => Object.assign({}, a));
    (r.acts || []).forEach((a) => {
        const x = { act: a.act, at: a.at };
        if (a.by) x.by = a.by;
        if (a.note) x.note = a.note;
        if (a.reportId) x.reportId = a.reportId;
        if (!acts.some((y) => outageActKey(y) === outageActKey(x))) acts.push(x);
    });
    acts.sort((a, b) => a.at - b.at);
    const wid = watchIdOfItem(r.nodeId);
    const inc = Object.assign(base, {
        kind: 'outage', at: spans.length ? spans[0].from : (base.at || Date.now()),
        symptom: had ? had.symptom : symptomForType(node && node.type),
        nodeIds: wid ? [] : [r.nodeId]
    });
    if (wid) inc.watchIds = [wid];
    if (spans.length) inc.outages = spans; else delete inc.outages;
    const behind = (r.behind || []).filter((id) => nodes.some((n) => n.id === id));
    if (behind.length) inc.behind = behind; else delete inc.behind;
    if (r.monitor) inc.monitor = r.monitor;
    if (r.flapping || (had && had.flapping)) inc.flapping = true;
    if (r.gone) inc.gone = true; else delete inc.gone;
    if (acts.length) {
        inc.acts = acts;
        inc.status = 'closed';
        inc.closedAt = Math.min(acts[0].at, Number.isFinite(base.closedAt) ? base.closedAt : Infinity);
    }
    // Record only (D373): recorded, closed as it opened; nothing to act on.
    if (r.recordOnly || (had && had.recordOnly)) {
        inc.recordOnly = true;
        if (inc.status !== 'closed') { inc.status = 'closed'; inc.closedAt = inc.at; }
    }
    return inc;
}
// An outage's log entry: an 'incident' entry with its event.
function outageLogEntry(inc, event, at, extra = {}, nodes) {
    const name = outageName(inc, nodes);
    const summary = event === 'outage' ? `Not answering: ${name}.`
        : `Outage ${event}${extra.by ? ` by ${extra.by}` : ''}: ${name}.`;
    return { id: 'lg_' + randomToken(), at, kind: 'incident', incidentId: inc.id, event, symptom: inc.symptom, summary: summary.slice(0, 300) };
}
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Folding ----
const watchedNetwork = () => {
    const info = window.TopoChecks && TopoChecks.state.info;
    return info && info.networkId ? info.networkId : null;
};
// A record of a site's monitor (step 7h, js/monitors.js) is folded only by
// an owner's page with that site's network open (D158).
const serverFoldable = (r) => !r.server || !!(window.TopoMonitors && TopoMonitors.mayFold(r.server));
const foldable = (r) => !!r && !!state.libraryId && r.networkId === state.libraryId && serverFoldable(r);
function canFold() {
    return !state.readOnly && !locked() && !!state.libraryId && [..._is.records.values()].some((r) => foldable(r) && (r.server || hasHost()));
}
function scheduleFold() {
    clearTimeout(_is.timer);
    _is.timer = setTimeout(() => { foldIssues(); }, FOLD_DELAY_MS);
}
// The open network changed: its undo history starts again (initHistory),
// so what was folded before is below the floor.
function foldNetNow() {
    if (_is.foldNet === state.libraryId) return;
    _is.foldNet = state.libraryId;
    _is.foldedRev.clear();
    _is.foldedHere.clear();
}
// The acts of a record as the document would hold them (their keys).
function recordActKeys(r, doc) {
    const probe = normalizeIncident(outageFromRecord(Object.assign({}, r, { outages: r.outages || [] }), null, doc), { nodes: doc.nodes });
    return new Set(((probe && probe.acts) || []).map(outageActKey));
}
// Folds every record of the open network. -> how many outages changed.
async function foldIssues() {
    if (_is.folding) { await _is.folding; }
    if (!canFold()) return 0;
    const run = (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (typeof commitTyping === 'function') commitTyping();
            const beforeJson = JSON.stringify(serializeDoc());
            const doc = JSON.parse(beforeJson);
            if (!Array.isArray(doc.incidents)) doc.incidents = [];
            foldNetNow();
            const entries = [], back = [], done = [], dropped = [], seen = [], here = [];
            let changed = 0;
            const now = Date.now();
            [..._is.records.values()].filter(foldable).sort((a, b) => ((a.outages || [])[0] ? a.outages[0].from : 0) - ((b.outages || [])[0] ? b.outages[0].from : 0)).forEach((r) => {
                seen.push([r.id, r.rev]);
                const i = doc.incidents.findIndex((x) => x && x.id === r.id);
                const had = i >= 0 ? doc.incidents[i] : null;
                if (had && !isOutage(had)) return;   // an id that is not an outage's: never touched
                // Its device is no longer in the document: the app drops it
                // once its outage is over (D253).
                if (!recordSubject(r, doc)) { dropped.push(r.id); return; }
                const next = normalizeIncident(outageFromRecord(r, had, doc), { nodes: doc.nodes, watch: doc.watch || [] });
                if (!next) return;
                // Acts the document holds that the record lacks go to the
                // app, compared as the document would hold the record's.
                // A site monitor's record: compared with the acts the monitor
                // itself holds, so a person's act it has not taken yet (a
                // provider's) is passed on (js/monitors.js relayAct).
                const recKeys = recordActKeys(r.server ? Object.assign({}, r, { acts: r.ownActs || [] }) : r, doc);
                (had && had.acts || []).forEach((a) => { if (!recKeys.has(outageActKey(a))) back.push({ id: r.id, act: a }); });
                if (!had) entries.push(outageLogEntry(next, 'outage', now));
                const known = new Set((had && had.acts || []).map(outageActKey));
                (next.acts || []).filter((a) => !known.has(outageActKey(a))).forEach((a) => entries.push(outageLogEntry(next, OUTAGE_ACT_EVENT[a.act], now, { by: a.by })));
                if (!had || !sameJson(normalizeIncident(had, { nodes: doc.nodes }), next)) {
                    if (had) doc.incidents[i] = next; else doc.incidents.push(next);
                    changed++;
                    here.push(r.id);
                } else if (!_is.foldedHere.has(r.id)) {
                    done.push([r.id, r.rev]);   // there as it says, and not by an undoable fold of this page
                }
            });
            if (changed) {
                let next = doc;
                for (const e of entries) next = await appendLogEntry(next, e);
                if (JSON.stringify(serializeDoc()) !== beforeJson || state.readOnly || locked()) continue;
                state.linkSourceId = null;
                batch(() => {
                    loadDocState(next);
                    pruneSelection();
                    save();
                    renderCanvasOnly();
                });
                if (isKept()) flushAutosave();
                renderSelection();
                updateUndoButtons();
                if (typeof renderDocBar === 'function') renderDocBar();
                if (typeof renderIncidentsUi === 'function') renderIncidentsUi();
            }
            seen.forEach(([id, rev]) => _is.foldedRev.set(id, rev));
            here.forEach((id) => _is.foldedHere.add(id));
            // The site's records go back to the server (js/monitors.js): which
            // are in the document now, and the acts its monitor lacks, passed
            // on signed by this owner. This PC's own records go to the app.
            const isSrv = (id) => { const r = _is.records.get(id); return !!(r && r.server); };
            const srvSite = (id) => _is.records.get(id).server;
            const srvDone = [...done.map(([id]) => id), ...here].filter(isSrv);
            if (srvDone.length && window.TopoMonitors) TopoMonitors.folded(srvSite(srvDone[0]), srvDone);
            const appDone = done.filter(([id]) => !isSrv(id)), appDropped = dropped.filter((id) => !isSrv(id));
            if (appDone.length || appDropped.length) isInvoke('monitor_issues_folded', { done: appDone, dropped: appDropped }).then(() => {}, () => {});
            back.forEach((b) => {
                if (isSrv(b.id)) { if (window.TopoMonitors) TopoMonitors.relayAct(srvSite(b.id), b.id, b.act); }
                else isInvoke('monitor_issue_act', { id: b.id, act: actForApp(b.act) }).then(onRecords, () => {});
            });
            return changed;
        }
        return 0;
    })();
    _is.folding = run;
    try { return await run; } finally { if (_is.folding === run) _is.folding = null; }
}
const actForApp = (a) => ({ act: a.act, at: a.at, by: a.by || '', note: a.note || '', reportId: a.reportId || '' });

// Records from the app (all of them, or the ones that changed).
function onRecords(list) {
    const arr = Array.isArray(list) ? list : list && typeof list === 'object' ? [list] : [];
    arr.forEach((r) => {
        if (!r || typeof r.id !== 'string') return;
        const was = _is.records.get(r.id);
        _is.records.set(r.id, r);
        // Answering again: said once, softly.
        const last = r.outages && r.outages[r.outages.length - 1];
        const back = last && Number.isFinite(last.to) && !r.gone;
        if (back && was && !_is.seenRecovered.has(r.id + '/' + last.to) && r.networkId === state.libraryId) {
            _is.seenRecovered.add(r.id + '/' + last.to);
            const node = getNode(r.nodeId);
            const w = watchById(watchIdOfItem(r.nodeId));
            // Record only: answering again is not said either (D373).
            if (!r.recordOnly) showToast(t('{name} is answering again (down {time}).', { name: node ? locPlainName(node) : w ? watchLabel(w) : r.name || r.nodeId, time: minutesText(last.to - last.from) }), 'ok');
        }
    });
    scheduleFold();
}
// The app's events, listened to once: from the page's first moment, so a
// window that boots locked still hears the card hand an act over.
function listenOnce() {
    if (_is.listening || !hasHost()) return;
    _is.listening = true;
    isListen('topo-issues', (e) => onRecords(e && e.payload)).catch(() => { _is.listening = false; });
    // Heard live: the app's copy of it is taken too, so a later page load
    // (the window closed to the tray and opened again) does not replay it.
    isListen('topo-alarm-act', (e) => {
        if (!e || !e.payload) return;
        isInvoke('alarm_take').then(() => {}, () => {});
        handOver(e.payload);
    }).catch(() => {});
}
function refreshIssues() {
    if (!hasHost()) return Promise.resolve([]);
    listenOnce();
    return isInvoke('monitor_issues').then((list) => {
        _is.records.clear();
        onRecords(list);
        return list;
    }).catch(() => []);
}
// Every redraw of the map asks (js/checks.js checksDocChanged): a network
// just opened may have records waiting. Only records not folded at their
// rev count, so an Undo of a fold is not folded straight back (D254).
function issuesDocChanged() {
    if (!_is.records.size) return;
    foldNetNow();
    if ([..._is.records.values()].some((r) => foldable(r) && _is.foldedRev.get(r.id) !== r.rev)) scheduleFold();
}

// ---- Who may act (D158) ----
// Owners (an editable network that is not a provider's); a provider only on
// the devices they cover; a viewer (read-only) never.
function mayActOnOutage(inc) {
    if (!inc || state.readOnly) return false;
    const provider = (typeof serverIsProvider === 'function' && serverIsProvider(state.libraryId))
        || !!(window.TopoProviderMode && TopoProviderMode.state.on);
    if (!provider) return true;
    const pid = window.TopoProviderMode ? TopoProviderMode.providerSelfOf(state.docId || state.libraryId) : null;
    if (!pid) return false;
    const w = outageWatch(inc);
    if (w) return (w.providers || []).includes(pid);
    const covered = new Set(providerCovers(pid).nodes.map((n) => n.id));
    return (inc.nodeIds || []).length > 0 && inc.nodeIds.every((id) => covered.has(id));
}
// Who acts: the name Settings keeps for reports, else nobody named.
const whoActs = () => ((state.settings.reporter && state.settings.reporter.name) || '').trim().slice(0, 120);

// ---- Acting ----
// One act: the document first (one undo step, its log entry), then the
// app's record. -> whether it was recorded.
async function actOnOutage(id, act, opts = {}) {
    const inc = incidentById(id);
    if (!OUTAGE_ACTS.includes(act)) return false;
    if (inc && !mayActOnOutage(inc)) { showToast(t('Only an owner, or the provider who covers this device, can act on it.'), 'warn'); return false; }
    const a = { act, at: Date.now() };
    const by = opts.by !== undefined ? opts.by : whoActs();
    if (by) a.by = by;
    const note = String(opts.note || '').trim().slice(0, INCIDENT_TEXT_MAX);
    if (note) a.note = note;
    if (act === 'report' && opts.reportId) a.reportId = opts.reportId;
    let ok = !inc;
    if (inc) {
        const res = await commitIncidentChange((doc) => {
            const entry = addOutageAct(doc, id, a);
            return entry ? { entry, incident: doc.incidents.find((i) => i && i.id === id) } : null;
        });
        ok = !!res;
    }
    if (ok) await sendAct(id, a);
    if (typeof renderIncidentsUi === 'function') renderIncidentsUi();
    return ok;
}
// Adds act a to the outage id in doc (a serialized copy, inside a commit),
// closing it. -> its log entry, or null when there is no such outage.
function addOutageAct(doc, id, a) {
    const x = (doc.incidents || []).find((i) => i && i.id === id);
    if (!x || !isOutage(x)) return null;
    x.acts = (x.acts || []).concat([a]).sort((p, q) => p.at - q.at);
    x.status = 'closed';
    x.closedAt = Math.min(Number.isFinite(x.closedAt) ? x.closedAt : Infinity, a.at);
    return outageLogEntry(x, OUTAGE_ACT_EVENT[a.act], a.at, { by: a.by });
}
// The act as the document now holds it (normalized) goes to the app's
// record, so both sides key it the same (act|at|by).
async function sendAct(id, a) {
    // On a server's site the act is a signed record too (step 7h).
    const site = window.TopoMonitors ? TopoMonitors.siteOfOpen() : null;
    const rec = _is.records.get(id);
    if (site) {
        const inc = incidentById(id);
        const held = inc && (inc.acts || []).find((x) => x.act === a.act && x.at === a.at);
        TopoMonitors.pushAct(site, id, held || a);
    }
    if (!hasHost() || !rec || rec.server) return;
    const inc = incidentById(id);
    const held = inc && (inc.acts || []).find((x) => x.act === a.act && x.at === a.at);
    try { onRecords(await isInvoke('monitor_issue_act', { id, act: actForApp(held || a) })); } catch (e) { console.warn('Topo: the app did not take the act:', e); }
}
// An outage someone already acted on is not acted on again (a card handed
// over late, a second window). -> true when it is closed (and says so).
function alreadyActed(inc) {
    if (!inc || inc.status !== 'closed') return false;
    showToast(t('Someone has already acted on this issue.'), 'warn');
    return true;
}
async function askAcknowledge(id) {
    const inc = incidentById(id);
    if (!inc || alreadyActed(inc)) return false;
    const note = await askPrompt(t('Acknowledge: you have seen that {name} is not answering and someone is on it. A note, if you like:', { name: outageName(inc) }),
        { title: t('Acknowledge'), value: '', ok: t('Acknowledge') });
    if (note === null) return false;
    const done = await actOnOutage(id, 'ack', { note });
    if (done) showToast(t('Acknowledged.'), 'ok');
    return done;
}
async function askExpected(id) {
    const inc = incidentById(id);
    if (!inc || alreadyActed(inc)) return false;
    const note = await askPrompt(t('Expected: maintenance or planned work on {name}. Its time counts as maintenance, not as down. A note, if you like:', { name: outageName(inc) }),
        { title: t('Expected'), value: '', ok: t('Expected') });
    if (note === null) return false;
    const done = await actOnOutage(id, 'expected', { note });
    if (done) showToast(t('Marked as expected.'), 'ok');
    return done;
}
// Report a problem: the step-4 report, prefilled with the device and what
// the monitor saw; it is saved (and sent) only as the person chooses. Its
// save is the act (js/incidents.js createIncident calls reported()).
function reportOutage(id) {
    const inc = incidentById(id);
    if (!inc || alreadyActed(inc)) return false;
    if (!mayActOnOutage(inc)) { showToast(t('Only an owner, or the provider who covers this device, can act on it.'), 'warn'); return false; }
    const rep = state.settings.reporter || {};
    const since = outageSince(inc);
    const rec = outageRecovered(inc);
    const lines = [rec ? t('{name} did not answer from {from} to {to} ({time}).', { name: outageName(inc), from: clockText(since), to: clockText(rec), time: minutesText(rec - since) })
        : t('{name} has not answered since {time}.', { name: outageName(inc), time: clockText(since) })];
    if (inc.behind && inc.behind.length) lines.push(tn(inc.behind.length, '{n} device behind it is not answering either.', '{n} devices behind it are not answering either.'));
    if (inc.monitor) lines.push(t('Checked by monitor {pc}.', { pc: inc.monitor }));
    const ok = TopoIncidents.reopenProblemDraft({ symptom: inc.symptom, nodeIds: inc.nodeIds.slice(), watchIds: (inc.watchIds || []).slice(), text: lines.join(' '), name: rep.name || '', phone: rep.phone || '', email: rep.email || '', remember: true });
    if (ok) TopoIncidents.draft.fromIssue = id;
    return ok;
}
// The report from an outage is being saved: that is the act. Called inside
// createIncident's own commit (js/incidents.js), so the report, the act and
// both log entries are one undo step. -> { act, entry } or null (no such
// outage, already closed, or not this person's to act on).
function reportAct(doc, issueId, reportId, by) {
    const inc = issueId && incidentById(issueId);
    if (!inc || inc.status === 'closed' || !mayActOnOutage(inc)) return null;
    const a = { act: 'report', at: Date.now() };
    const who = String(by || whoActs()).trim().slice(0, 120);
    if (who) a.by = who;
    if (reportId) a.reportId = reportId;
    const entry = addOutageAct(doc, issueId, a);
    return entry ? { act: a, entry } : null;
}
// After that commit: the act goes to the app's record.
function reported(issueId, act) {
    if (issueId && act) return sendAct(issueId, act).then(() => { if (typeof renderIncidentsUi === 'function') renderIncidentsUi(); });
    return Promise.resolve();
}

// ---- The row (the Problems tab and the Simple lists) ----
function outageRowEl(inc, opts = {}) {
    const node = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
    const rec = outageRecovered(inc);
    const closed = inc.status === 'closed';
    const li = node('li', `inc-row inc-outage inc-${inc.status}${rec ? ' inc-recovered' : ''}`);
    li.dataset.inc = inc.id;
    const head = node('div', 'inc-head');
    const first = (inc.acts || [])[0];
    // Record only (D373): said so, whatever its state.
    const pill = inc.recordOnly ? t('Recorded only') : closed && first ? t(ACT_STATUS[first.act]) : rec ? t('Answering again') : t('Not answering');
    head.appendChild(node('span', `pm-status pm-${closed ? 'closed' : rec ? 'recovered' : 'down'}`, pill));
    const name = outageName(inc);
    const behind = (inc.behind || []).length;
    head.appendChild(node('span', 'inc-what', `📡 ${behind ? tn(behind, '{name} and {n} device behind it', '{name} and {n} devices behind it', { name }) : name}`));
    li.appendChild(head);
    const since = outageSince(inc);
    const when = rec ? t('Answering again since {time} (down {down}).', { time: clockText(rec), down: minutesText(rec - since) })
        : inc.gone ? t('Down from {time}; no longer checked.', { time: clockText(since) })
        : t('Not answering since {time} ({down}).', { time: clockText(since), down: minutesText(Date.now() - since) });
    li.appendChild(node('p', 'inc-where inc-when-line', when));
    const n = (inc.outages || []).length;
    const facts = [];
    if (n > 1) facts.push(t('Went down {n} times while open.', { n }));
    if (inc.flapping) facts.push(t('It keeps going down and coming back (flapping).'));
    // Two monitors disagree now: the path between them, not the device (D150).
    const sp = !closed && window.TopoMonitors && inc.nodeIds && inc.nodeIds[0] ? TopoMonitors.splitOf(inc.nodeIds[0]) : null;
    if (sp) facts.push(TopoMonitors.splitText(sp));
    if (inc.monitor && !opts.compact) facts.push(t('Checked by monitor {pc}.', { pc: inc.monitor }));
    if (facts.length) li.appendChild(node('p', 'dlg-dim inc-line', facts.join(' ')));
    if (behind && !opts.compact) {
        const names = inc.behind.map((id) => getNode(id)).filter(Boolean).map(locPlainName);
        li.appendChild(node('p', 'dlg-dim inc-line', t('Behind it: {names}', { names: names.slice(0, 12).join(', ') + (names.length > 12 ? ` +${names.length - 12}` : '') })));
    }
    (inc.acts || []).forEach((a) => {
        const who = a.by ? t('{what} by {name}, {time}', { what: t(ACT_WORDS[a.act]), name: a.by, time: clockText(a.at) }) : t('{what}, {time}', { what: t(ACT_WORDS[a.act]), time: clockText(a.at) });
        li.appendChild(node('p', 'dlg-dim inc-line inc-act-line', who + (a.note ? ` · ${a.note}` : '')));
    });
    if (!closed && mayActOnOutage(inc)) {
        const acts = node('div', 'pb-acts inc-acts');
        const b = (text, act) => { const x = node('button', 'btn inc-act', text); x.type = 'button'; x.dataset.incAct = act; x.dataset.inc = inc.id; return x; };
        acts.appendChild(b(`✓ ${t('Acknowledge')}`, 'outage-ack'));
        acts.appendChild(b(`⚠ ${t('Report a problem')}`, 'outage-report'));
        acts.appendChild(b(`🛠 ${t('Expected')}`, 'outage-expected'));
        li.appendChild(acts);
    }
    return li;
}
// The lists' buttons (js/incidents.js incidentActClick hands them over).
function outageActClick(act, id) {
    if (act === 'outage-ack') { askAcknowledge(id); return true; }
    if (act === 'outage-expected') { askExpected(id); return true; }
    if (act === 'outage-report') { reportOutage(id); return true; }
    return false;
}
// The landing card's line for an outage.
function outageLandingText(inc, doc) {
    return t('{name} not answering', { name: outageName(inc, (doc && doc.nodes) || []) });
}
// An outage's log entry in words.
function outageLogText(e) {
    const inc = incidentById(e.incidentId);
    const name = inc ? outageName(inc) : '';
    if (e.event === 'outage') return t('Not answering: {name}.', { name });
    if (e.event === 'acknowledged') return t('Outage acknowledged: {name}.', { name });
    if (e.event === 'expected') return t('Outage marked expected (maintenance): {name}.', { name });
    if (e.event === 'reported') return t('Problem reported for an outage: {name}.', { name });
    return null;
}

// ---- The card hands an act over ----
// Asks to unlock first when locked, waits for the boot, opens the network
// the issue is on, folds, then acts.
async function handOver(p) {
    if (!p || typeof p.id !== 'string' || (p.act !== 'ack' && p.act !== 'report')) return;
    // The same hand-over twice (the event and alarm_take at boot): once.
    const key = p.id + '|' + p.act;
    if ((_is.pending && _is.pending.id === p.id && _is.pending.act === p.act) || (_is.lastHand && _is.lastHand.key === key && Date.now() - _is.lastHand.at < 5000)) return;
    _is.lastHand = { key, at: Date.now() };
    _is.pending = p;
    if (locked()) {
        const ok = await TopoLock.requestUnlock(p.act === 'ack' ? t('Unlock to acknowledge the device that is not answering.') : t('Unlock to report the device that is not answering.'));
        if (!ok) { _is.pending = null; _is.lastHand = null; return; }   // Not now: the card may hand it over again
    }
    if (!_is.ready) await new Promise((r) => window.addEventListener('topo:ready', r, { once: true }));
    if (_is.pending !== p) return;
    _is.pending = null;
    await refreshIssues();
    const rec = _is.records.get(p.id);
    if (rec && rec.networkId && state.libraryId !== rec.networkId && typeof openFromLibrary === 'function' && libraryEntry(rec.networkId)) {
        await openFromLibrary(rec.networkId);
    }
    await foldIssues();
    if (!incidentById(p.id)) { showToast(t('That issue is in a network that is not open here.'), 'warn'); return; }
    if (alreadyActed(incidentById(p.id))) return;
    if (p.act === 'ack') await askAcknowledge(p.id); else reportOutage(p.id);
}
window.addEventListener('topo:ready', () => {
    _is.ready = true;
    if (hasHost()) refreshIssues();
});
// An act the card handed over before this page was there (the window was
// closed, or is booting locked): taken at once, asked to unlock if locked.
if (hasHost()) {
    listenOnce();
    isInvoke('alarm_take').then((p) => { if (p) handOver(p); }).catch(() => {});
}

// ---- Settings: Show alarms on this PC ----
function renderAlarmSettings() {
    const box = el('setAlarmBox');
    if (!box) return;
    box.hidden = !hasHost();
    const info = window.TopoChecks && TopoChecks.state.info;
    if (info) el('setAlarmOn').checked = !!info.alarms;
}
async function onAlarmSwitch(e) {
    try {
        const info = await isInvoke('monitor_set', { args: Object.assign({ labels: TopoChecks.labels() }, { alarms: e.target.checked }) });
        if (info && window.TopoChecks) TopoChecks.state.info = info;
    } catch (err) {
        showToast(t('The monitor did not take the change: {error}', { error: String(err && err.message || err) }), 'warn');
    }
    renderAlarmSettings();
}
async function testAlarm() {
    try {
        // The words first, so the drill speaks the page's language.
        await isInvoke('monitor_set', { args: { labels: TopoChecks.labels() } });
        await isInvoke('alarm_test');
        showToast(t('The alarm card is shown, marked DRILL.'), 'ok');
    } catch (err) {
        showToast(t('The alarm could not be shown: {error}', { error: String(err && err.message || err) }), 'warn');
    }
}
(function wire() {
    const on = el('setAlarmOn');
    if (on) on.addEventListener('change', onAlarmSwitch);
    const test = el('setAlarmTest');
    if (test) test.addEventListener('click', testAlarm);
})();

window.outageRowEl = outageRowEl;
window.outageActClick = outageActClick;
window.outageLandingText = outageLandingText;
window.outageLogText = outageLogText;
window.issuesDocChanged = issuesDocChanged;
window.renderAlarmSettings = renderAlarmSettings;
// Records folded into a document that is not open (a server backup being
// restored, D159): each outage added or brought up to date, with its log
// entries, as foldIssues does. -> the new document.
async function foldRecordsIntoDoc(doc, recs) {
    let next = JSON.parse(JSON.stringify(doc));
    if (!Array.isArray(next.incidents)) next.incidents = [];
    const entries = [];
    const now = Date.now();
    (recs || []).forEach((r) => {
        if (!recordSubject(r, next)) return;
        const i = next.incidents.findIndex((x) => x && x.id === r.id);
        const had = i >= 0 ? next.incidents[i] : null;
        if (had && !isOutage(had)) return;
        const inc = normalizeIncident(outageFromRecord(r, had, next), { nodes: next.nodes, watch: next.watch || [] });
        if (!inc) return;
        if (!had) entries.push(outageLogEntry(inc, 'outage', now, {}, next.nodes));
        const known = new Set((had && had.acts || []).map(outageActKey));
        (inc.acts || []).filter((a) => !known.has(outageActKey(a))).forEach((a) => entries.push(outageLogEntry(inc, OUTAGE_ACT_EVENT[a.act], now, { by: a.by }, next.nodes)));
        if (had) next.incidents[i] = inc; else next.incidents.push(inc);
    });
    for (const e of entries) next = await appendLogEntry(next, e);
    return next;
}
// A site's issue records read through the server (js/monitors.js): they
// replace that site's records held before (an issue gone from the server
// is gone here too).
function onServerRecords(siteId, list) {
    for (const [id, r] of _is.records) if (r.server === siteId) _is.records.delete(id);
    (list || []).forEach((r) => { if (r && r.id && !(_is.records.get(r.id) && !_is.records.get(r.id).server)) _is.records.set(r.id, r); });
    scheduleFold();
    if (typeof renderIncidentsUi === 'function') renderIncidentsUi();
}
window.TopoIssues = { state: _is, hasHost, foldIssues, onRecords, onServerRecords, foldRecordsIntoDoc, refreshIssues, outageFromRecord, symptomForType, mayActOnOutage, actOnOutage,
    askAcknowledge, askExpected, reportOutage, reportAct, reported, handOver, outageRecovered, outageName, testAlarm, renderAlarmSettings, whoActs };
})();
