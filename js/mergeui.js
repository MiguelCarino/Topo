// ---- The merge review (docs/SCOPE.md section 3, step 2, stage 4) ----
// One dialog for every merge, whichever door it came through (a file, a
// link, a card merged into another, a binder site), built like the
// spreadsheet import's review (js/csv.js):
//
//   * the counts: to add, to change, unchanged, to remove, conflicts; each
//     a toggle that shows or hides its rows (unchanged hidden at first);
//   * a filter by kind (devices, cables, subnets...);
//   * a row per item: a conflicting field is a pair of buttons, Mine and
//     Theirs, pressed on the side it takes (the default, until chosen); a
//     field taken without asking reads "before → after"; an item in
//     conflict as a whole (removed on one side and edited on the other, or
//     matching several of mine) gets its own buttons;
//   * Use mine for all / Use theirs for all (the field conflicts only: an
//     item's own question keeps its cautious default);
//   * what the findings would do: open findings now and after, and which;
//   * Apply / Cancel. Apply is always enabled while there is something to
//     merge: every conflict has a default.
//   * a provider's visit (docs/SCOPE.md D139, D153, js/visits.js): the foot
//     asks two things more, the changes (apply as reviewed, or reject:
//     nothing applied) and the visit (Successful, Not successful,
//     Undecided), with a note for the provider; Apply is enabled even with
//     nothing to merge, since the visit is still to be judged. On a server,
//     a row outside what the provider covers asks Leave it out (the
//     default) or Apply it (D154).
//
// Apply hands the answers to commitMerge (js/mergeapply.js), which closes
// this first (A13), keeps a restore point, plans again from the network as
// it is then and writes one undo step. A plan that went stale meanwhile
// (the network's conflicts changed) is reviewed again, the answers carried
// over by key.
//
// On a phone the rows stack: a pick pair is two full-width buttons, the
// tools are full width, every target 44px, nothing scrolls sideways. Names,
// values and labels are text, never markup. The dialog is translated: it is
// reached from the landing and from Open a file. Field names are the
// columns' own labels through t(); one with no label shows its key. Values
// are never translated.
//
// Tests answer it with setMergeResponder(fn): fn gets the request ({ plan,
// mine, targetId, source, name }) and returns the choices ({} for every
// default) or null for Cancel, as setDialogResponder does for the questions
// (js/dialog.js). tests/suites/mergeui.js drives the real dialog too.

const MERGE_ROWS_MAX = 500;
const MERGE_DELTA_MS = 250;
const MERGE_VALUE_MAX = 160;
// The kinds as the review names them: one, and the filter's many.
const MERGE_KIND_ONE = {
    nodes: 'Device', links: 'Cable', networks: 'Subnet', groups: 'Group', wifi: 'Wi-Fi network', providers: 'Provider', incidents: 'Problem report',
    annotations: 'Note', searches: 'Saved search', columns: 'Custom column', accepted: 'Accepted finding', pinned: 'Pinned finding',
    report: 'Report header', expectedLife: 'Expected life by type', tableView: 'Table view', ifaces: 'Interface'
};
const MERGE_KIND_MANY = {
    nodes: 'Devices', links: 'Cables', networks: 'Subnets', groups: 'Groups', wifi: 'Wi-Fi networks', providers: 'Providers', incidents: 'Problem reports',
    annotations: 'Notes', searches: 'Saved searches', columns: 'Custom columns', accepted: 'Accepted findings', pinned: 'Pinned findings',
    report: 'Report header', expectedLife: 'Expected life by type', tableView: 'Table view'
};
// The status chips, in order; 'conflict' counts as the plan's 'conflicts'.
const MERGE_CHIPS = [
    { status: 'added', label: 'To add', mark: '+' },
    { status: 'changed', label: 'To change', mark: '→' },
    { status: 'unchanged', label: 'Unchanged', mark: '=' },
    { status: 'removed', label: 'To remove', mark: '−' },
    { status: 'conflict', label: 'Conflicts', mark: '✕' }
];
const MERGE_MARK = Object.fromEntries(MERGE_CHIPS.map((c) => [c.status, c.mark]));
// How a match was made, when it was not the id both carried.
const MERGE_MATCHED_BY = {
    assetTag: 'asset tag', serial: 'serial number', mac: 'MAC', ip: 'IP address', name: 'name', ends: 'both ends',
    range: 'range', path: 'place', ssid: 'SSID', text: 'text', chosen: 'your choice', blank: 'a free interface'
};
// Fields that hold another record's id: shown by that record's name.
const MERGE_REF_FIELDS = {
    nodes: { group: 'groups', providers: 'providers', host: 'nodes' },
    links: { source: 'nodes', target: 'nodes', providers: 'providers' },
    groups: { parent: 'groups', providers: 'providers' },
    wifi: { network: 'networks' },
    incidents: { nodeIds: 'nodes', groupId: 'groups', routedTo: 'providers' }
};
// Labels for fields no descriptor list names.
const MERGE_FIELD_WORDS = {
    columns: { name: 'Name', kind: 'Kind' }, annotations: { text: 'Text' },
    incidents: { state: 'Status', symptom: 'Problem', nodeIds: 'Devices', groupId: 'Group', text: 'What happened', reporter: 'Reported by',
        routedTo: 'Sent to', sentAt: 'Sent', visits: 'Visits', at: 'Reported on' }
};
// A problem report's status as the review says it.
const MERGE_INCIDENT_STATUS = { open: 'Reported', sent: 'Sent', visited: 'Visited', closed: 'Closed' };

let _mergeResponder = null;
// -> the previous responder, so a suite can put it back.
function setMergeResponder(fn) {
    const prev = _mergeResponder;
    _mergeResponder = typeof fn === 'function' ? fn : null;
    return prev;
}

// The review on screen: { opts, mine, plan, shown, choices, statuses, kind,
// before (findings now), timer, resolve }; null when shut.
let _mr = null;
const mrEl = (id) => document.getElementById(id);

// ---- Words ----
const mergeKindText = (kind, many) => t((many ? MERGE_KIND_MANY : MERGE_KIND_ONE)[kind] || kind);
function mergeFieldSet(kind) {
    const sets = {
        nodes: typeof NODE_FIELDS !== 'undefined' ? NODE_FIELDS : null,
        ifaces: typeof IFACE_FIELDS !== 'undefined' ? IFACE_FIELDS : null,
        links: typeof LINK_FIELDS !== 'undefined' ? LINK_FIELDS : null,
        networks: typeof NETWORK_FIELDS !== 'undefined' ? NETWORK_FIELDS : null,
        groups: typeof GROUP_FIELDS !== 'undefined' ? GROUP_FIELDS : null,
        wifi: typeof WIFI_FIELDS !== 'undefined' ? WIFI_FIELDS : null,
        providers: typeof PROVIDER_FIELDS !== 'undefined' ? PROVIDER_FIELDS : null,
        searches: typeof SEARCH_FIELDS !== 'undefined' ? SEARCH_FIELDS : null,
        report: typeof REPORT_FIELDS !== 'undefined' ? REPORT_FIELDS : null
    };
    return sets[kind] || null;
}
const mergeLabelIn = (list, key) => { const f = (list || []).find((x) => x && x.key === key); return f && f.label ? f.label : ''; };
// The English label a field is shown by ('' when it has none: its key is
// shown). Exposed for the suite, which checks each has its translations.
function mergeFieldKey(kind, field) {
    if (kind === 'nodes' && field.startsWith('port ')) return 'Port {port}';
    if (kind === 'links' && field.startsWith('cable.')) return mergeLabelIn(typeof CABLE_FIELDS !== 'undefined' ? CABLE_FIELDS : null, field.slice(6));
    if (kind === 'tableView') return 'Table view';
    const words = MERGE_FIELD_WORDS[kind];
    if (words && words[field]) return words[field];
    return mergeLabelIn(mergeFieldSet(kind), field);
}
function mergeFieldText(kind, field, ctx) {
    if (kind === 'nodes' && field.startsWith('x:')) {
        const name = ctx && ctx.colNames.get(field.slice(2));
        return name || field;
    }
    const key = mergeFieldKey(kind, field);
    if (key === 'Port {port}') return t(key, { port: field.slice(5) });
    return key ? t(key) : field;
}
// A value as a row shows it: a name for an id, Yes / No, a list joined,
// anything else as JSON; cut to MERGE_VALUE_MAX (the whole in the title).
function mergeValueText(kind, field, v, ctx) {
    if (mgEmpty(v)) return t('(empty)');
    const ref = (MERGE_REF_FIELDS[kind] || {})[field];
    if (ref && typeof v === 'string') return (ctx && ctx.labels.get(`${ref}:${v}`)) || v;
    // A list of references (an item's providers, v18): each by its name.
    if (ref && Array.isArray(v)) return v.map((x) => (ctx && ctx.labels.get(`${ref}:${x}`)) || x).join(', ');
    if (kind === 'incidents' && field === 'state' && v && typeof v === 'object') return t(MERGE_INCIDENT_STATUS[v.status] || 'Reported');
    // Visits are log entries: a count here, each one in words in the notes
    // below the rows (mergeVisitNotes), never their ids.
    if (kind === 'incidents' && field === 'visits' && Array.isArray(v)) return v.length === 1 ? t('One visit') : t('Visits: {n}', { n: v.length });
    if (kind === 'incidents' && (field === 'sentAt' || field === 'at') && Number.isFinite(v)) return new Date(v).toISOString().slice(0, 16).replace('T', ' ');
    if (typeof v === 'boolean') return v ? t('Yes') : t('No');
    // Port names as the box shows its first ports (GigabitEthernet1, …), not
    // the scheme's JSON (an import sets it from the interface names).
    if (field === 'portScheme' && v && typeof v === 'object' && !Array.isArray(v) && typeof portNameOf === 'function') {
        const node = { portScheme: v };
        return `${portNameOf(node, 1)}, ${portNameOf(node, 2)}, …`;
    }
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) return v.join(', ');
    return JSON.stringify(v);
}
const mergeCut = (s) => (s.length > MERGE_VALUE_MAX ? `${s.slice(0, MERGE_VALUE_MAX - 1)}…` : s);

// ---- The plan as shown ----
// An ambiguous match answered with one of mine (or "add as new") is shown
// planned again as that match, so its fields can be chosen too; the plan
// handed to commitMerge stays the one first made (applyMergePlan plans the
// answered ambiguities again itself).
function mergeForce(plan, choices) {
    const force = {};
    plan.items.forEach((it) => {
        if (!it.conflict || it.conflict.type !== 'ambiguous') return;
        const c = choices[it.key] || mergeAmbiguousDefault(it);
        if (typeof c === 'string' && c && c !== 'skip') force[`${it.kind}:${it.theirsId}`] = c === 'add' ? 'add' : c;
    });
    return force;
}
function mergeShownPlan(ctx) {
    const force = mergeForce(ctx.plan, ctx.choices);
    if (!Object.keys(force).length) return ctx.plan;
    try {
        return planMerge(ctx.mine, ctx.plan.inputs.theirs, ctx.plan.inputs.base, { force: Object.assign({}, ctx.plan.force || {}, force), part: ctx.plan.part, scope: ctx.plan.scope });
    } catch (e) {
        return ctx.plan;
    }
}
// The rows: the ambiguous items first made (their question stays, answered
// or not), then the shown plan's others, conflicts first.
function mergeDisplayItems(ctx) {
    const seen = new Set();
    const out = [];
    const push = (it) => { if (seen.has(it.key)) return; seen.add(it.key); out.push(it); };
    ctx.plan.items.filter((it) => it.conflict && it.conflict.type === 'ambiguous').forEach(push);
    ctx.shown.items.filter((it) => !(it.conflict && it.conflict.type === 'ambiguous')).forEach(push);
    return out.filter((it) => it.status === 'conflict').concat(out.filter((it) => it.status !== 'conflict'));
}
function mergeDisplayCounts(items) {
    const c = { added: 0, changed: 0, unchanged: 0, removed: 0, conflict: 0 };
    items.forEach((it) => { if (c[it.status] !== undefined) c[it.status]++; });
    return c;
}
// Every record's name by `kind:id` (both sides, the result's ids), for the
// fields that name another record; and the custom columns' names.
function mergeNames(ctx) {
    const labels = new Map();
    [ctx.plan, ctx.shown].forEach((p) => p.items.forEach((it) => { if (it.label && !labels.has(it.key)) labels.set(it.key, it.label); }));
    const colNames = new Map();
    const cols = (doc) => ((doc && Array.isArray(doc.columns)) ? doc.columns : []);
    cols(ctx.mine).forEach((c) => { if (c && c.id) colNames.set(c.id, c.name || c.id); });
    const remap = (ctx.plan.idMap && ctx.plan.idMap.columns) || {};
    cols(ctx.plan.inputs.theirs).forEach((c) => { if (c && c.id) { const id = remap[c.id] || c.id; if (!colNames.has(id)) colNames.set(id, c.name || c.id); } });
    ctx.labels = labels;
    ctx.colNames = colNames;
}

// ---- Choices ----
const mergeFieldTake = (ctx, item, f) => {
    const c = ctx.choices[`${item.key}#${f.field}`];
    return f.conflict && (c === 'mine' || c === 'theirs') ? c : f.take;
};
function mergeItemTake(ctx, item) {
    const c = ctx.choices[item.key];
    const type = item.conflict && item.conflict.type;
    if (type === 'ambiguous') return typeof c === 'string' && c ? c : mergeAmbiguousDefault(item);
    return c === 'remove' ? 'remove' : 'keep';
}
// Every field conflict in the rows shown (children too) to one side.
function mergeUseAll(side) {
    if (!_mr) return;
    const walk = (it) => {
        (it.fields || []).forEach((f) => { if (f.conflict) _mr.choices[`${it.key}#${f.field}`] = side; });
        (it.children || []).forEach(walk);
    };
    _mr.shown.items.forEach(walk);
    renderMergeList();
    scheduleMergeDelta();
}

// ---- Rendering ----
function mergeButton(text, data, pressed, extra) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn merge-btn${extra ? ' ' + extra : ''}`;
    Object.keys(data).forEach((k) => { b.dataset[k] = data[k]; });
    if (pressed !== undefined) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    b.textContent = text;
    return b;
}
function mergeFieldRow(ctx, item, f) {
    const wrap = document.createElement('div');
    wrap.className = `merge-field${f.conflict ? ' merge-asks' : ''}`;
    const name = document.createElement('span');
    name.className = 'merge-fname';
    name.textContent = mergeFieldText(item.kind, f.field, ctx);
    wrap.appendChild(name);
    const mineText = mergeValueText(item.kind, f.field, f.mine, ctx);
    const theirsText = mergeValueText(item.kind, f.field, f.theirs, ctx);
    if (f.conflict) {
        const take = mergeFieldTake(ctx, item, f);
        const pair = document.createElement('div');
        pair.className = 'merge-pick';
        pair.setAttribute('role', 'group');
        pair.setAttribute('aria-label', name.textContent);
        const mine = mergeButton(t('Mine: {value}', { value: mergeCut(mineText) }), { key: item.key, field: f.field, take: 'mine' }, take === 'mine');
        const theirs = mergeButton(t('Theirs: {value}', { value: mergeCut(theirsText) }), { key: item.key, field: f.field, take: 'theirs' }, take === 'theirs');
        mine.title = mineText;
        theirs.title = theirsText;
        pair.append(mine, theirs);
        wrap.appendChild(pair);
    } else {
        const line = document.createElement('span');
        line.className = 'merge-change';
        // A set merged (v18): yours, then both sides' together.
        const both = f.take === 'merged' ? t('Both: {a}', { a: mergeValueText(item.kind, f.field, f.value, ctx) }) : '';
        const before = f.take === 'theirs' || both ? mineText : theirsText;
        const after = both || (f.take === 'theirs' ? theirsText : mineText);
        line.textContent = `${mergeCut(before)} → ${mergeCut(after)}`;
        line.title = `${before} → ${after}`;
        wrap.appendChild(line);
    }
    return wrap;
}
// What tells one of mine apart from another of the same name.
function mergeCandidateDetail(ctx, kind, id) {
    const rec = (Array.isArray(ctx.mine[kind]) ? ctx.mine[kind] : []).find((r) => r && r.id === id);
    if (!rec) return id;
    if (kind === 'nodes') {
        const ifs = Array.isArray(rec.interfaces) ? rec.interfaces : [];
        const ip = ifs.map((i) => i && i.ip).find((x) => x && String(x).trim());
        const mac = ifs.map((i) => i && i.mac).find((x) => x && String(x).trim());
        return String(ip || mac || rec.assetTag || rec.serial || id);
    }
    return id;
}
// An item's own question: removed on one side and edited on the other, or
// matching more than one of mine.
function mergeItemQuestion(ctx, item) {
    const type = item.conflict && item.conflict.type;
    if (!type || type === 'fields') return null;
    const box = document.createElement('div');
    box.className = 'merge-field merge-asks';
    const q = document.createElement('span');
    q.className = 'merge-fname';
    const acts = document.createElement('div');
    acts.className = 'merge-acts';
    acts.setAttribute('role', 'group');
    const take = mergeItemTake(ctx, item);
    const add = (text, value) => acts.appendChild(mergeButton(text, { key: item.key, choice: value }, take === value, value === 'add' || value === 'skip' || value === 'keep' || value === 'remove' ? '' : 'merge-cand-btn'));
    if (type === 'removed-theirs-edited-mine') {
        q.textContent = t('Removed in their copy, but edited in yours.');
        add(t('Keep it'), 'keep');
        add(t('Remove it'), 'remove');
    } else if (type === 'removed-mine-edited-theirs') {
        q.textContent = t('Removed in yours, but edited in their copy.');
        add(t('Keep theirs'), 'keep');
        add(t('Leave it removed'), 'remove');
    } else if (type === 'ambiguous') {
        const how = t(MERGE_MATCHED_BY[item.conflict.by] || item.conflict.by || 'name');
        // One another provider's copy added since this part left: the same
        // name is no proof, so Add as new is the default (D152.2).
        q.textContent = item.conflict.other ? t('Another provider added one with the same {how} since this part left: is it the same one?', { how })
            : t('It matches more than one of yours by {how}: which is it?', { how });
        // Each candidate by its name and what tells it apart (its first
        // address, else its MAC, else its id): two of mine often share a name.
        (item.conflict.candidates || []).forEach((id) => {
            const b = add(ctx.labels.get(`${item.kind}:${id}`) || id, id);
            const detail = mergeCandidateDetail(ctx, item.kind, id);
            if (detail) {
                const d = document.createElement('span');
                d.className = 'merge-cand';
                d.textContent = detail;
                b.appendChild(d);
            }
        });
        add(t('Add as new'), 'add');
        add(t('Skip'), 'skip');
    }
    acts.setAttribute('aria-label', q.textContent);
    box.append(q, acts);
    return box;
}
// A visit copy's change to an item outside what its provider covers (D154):
// left out unless applied.
function mergeOutsideQuestion(ctx, item) {
    if (!item.outside) return null;
    const box = document.createElement('div');
    box.className = 'merge-field merge-asks merge-outside';
    const q = document.createElement('span');
    q.className = 'merge-fname';
    const name = (ctx.plan.scope && ctx.plan.scope.name) || (ctx.opts.visit && (ctx.opts.visit.provider || ctx.opts.visit.visitBy)) || '';
    q.textContent = item.rejectedBefore ? t('This change came in a visit you rejected before.')
        : name ? t('Outside what {name} covers.', { name }) : t('Outside what this provider covers.');
    const acts = document.createElement('div');
    acts.className = 'merge-acts';
    acts.setAttribute('role', 'group');
    acts.setAttribute('aria-label', q.textContent);
    const key = `${item.key}@outside`;
    const take = ctx.choices[key] === 'apply' ? 'apply' : 'skip';
    acts.append(mergeButton(t('Leave it out'), { key, choice: 'skip' }, take === 'skip'), mergeButton(t('Apply it'), { key, choice: 'apply' }, take === 'apply'));
    box.append(q, acts);
    return box;
}
function mergeRow(ctx, item, child) {
    const row = document.createElement(child ? 'div' : 'li');
    row.className = `merge-row merge-${item.status}${child ? ' merge-sub' : ''}`;
    row.dataset.key = item.key;
    const head = document.createElement('div');
    head.className = 'merge-head';
    const mark = document.createElement('span');
    mark.className = 'merge-mark';
    mark.textContent = MERGE_MARK[item.status] || '';
    mark.setAttribute('aria-hidden', 'true');
    const kind = document.createElement('span');
    kind.className = 'merge-kind';
    kind.textContent = mergeKindText(item.kind);
    const label = document.createElement('span');
    label.className = 'merge-label';
    const objectKind = ['report', 'expectedLife', 'tableView'].includes(item.kind);
    label.textContent = objectKind ? '' : item.kind === 'incidents' ? mergeIncidentLabel(ctx, item) : (item.label || item.mineId || item.theirsId || '');
    head.append(mark, kind, label);
    if (item.matchedBy && item.matchedBy !== 'id' && item.matchedBy !== 'key' && MERGE_MATCHED_BY[item.matchedBy]) {
        const by = document.createElement('span');
        by.className = 'merge-by';
        by.textContent = t('matched by {how}', { how: t(MERGE_MATCHED_BY[item.matchedBy]) });
        head.appendChild(by);
    }
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.textContent = ' (' + t(MERGE_CHIPS.find((c) => c.status === item.status).label) + ')';
    head.appendChild(status);
    row.appendChild(head);
    const out = mergeOutsideQuestion(ctx, item);
    if (out) { row.classList.add('merge-out'); row.appendChild(out); }
    const q = mergeItemQuestion(ctx, item);
    if (q) row.appendChild(q);
    (item.fields || []).forEach((f) => row.appendChild(mergeFieldRow(ctx, item, f)));
    (item.children || []).filter((c) => c.status !== 'unchanged').forEach((c) => row.appendChild(mergeRow(ctx, c, true)));
    return row;
}

// A problem report's row in plain words (docs/SCOPE.md step 4): what, where,
// and where it stands after this merge (the later state wins, D38): "No
// internet at Reception PC. Now: Visited".
function mergeIncidentRecords(ctx, item) {
    const find = (doc, id) => (id && doc && Array.isArray(doc.incidents) ? doc.incidents.find((x) => x && x.id === id) : null) || null;
    return { mine: find(ctx.mine, item.mineId), theirs: find(ctx.plan.inputs.theirs, item.theirsId), theirsDoc: ctx.plan.inputs.theirs };
}
function mergeIncidentLabel(ctx, item) {
    const { mine, theirs, theirsDoc } = mergeIncidentRecords(ctx, item);
    const rec = mine || theirs;
    if (!rec) return item.label || item.mineId || item.theirsId || '';
    const doc = mine ? ctx.mine : theirsDoc;
    const where = typeof incidentWhereText === 'function' ? incidentWhereText(rec, { nodes: (doc && doc.nodes) || [], groups: (doc && doc.groups) || [] }) : '';
    const now = !theirs || (mine && incidentRank(mine) >= incidentRank(theirs)) ? mine : theirs;
    return t('{symptom} at {where}. Now: {status}', { symptom: symptomLabel(rec.symptom), where, status: t(MERGE_INCIDENT_STATUS[now.status] || 'Reported') });
}
// The visits the copy brings that this network has not got: one line each
// under the rows ("Visit by Juan Pérez (Andes IT), 9 Nov 14:10: Fixed. 3
// changes."). The log itself joins by id (unionLogs, js/merge.js).
function mergeVisitNotes(ctx) {
    const held = new Set(((ctx.mine && ctx.mine.log) || []).map((e) => e && e.id));
    // A visit someone already decided on (a 'decision' entry, v19) is
    // history, not one to judge.
    const decided = typeof visitDecidedIds === 'function' ? visitDecidedIds(ctx.mine, { log: (ctx.plan && ctx.plan.theirsLog) || [] }) : new Set();
    return ((ctx.plan && ctx.plan.theirsLog) || []).filter((e) => e && e.kind === 'visit' && !held.has(e.id) && !decided.has(e.id))
        .sort((a, b) => (a.at || 0) - (b.at || 0))
        .map((e) => (typeof visitLineText === 'function' ? visitLineText(e) : e.summary || ''));
}

function renderMergeCounts() {
    const ctx = _mr;
    const counts = mergeDisplayCounts(ctx.items);
    const box = mrEl('mergeCounts');
    box.textContent = '';
    MERGE_CHIPS.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `toggle-btn merge-chip merge-chip-${c.status}${counts[c.status] ? '' : ' zero'}`;
        b.dataset.status = c.status;
        b.setAttribute('aria-pressed', ctx.statuses.has(c.status) ? 'true' : 'false');
        // On looks on: the fleet's toggle style (carino-ui.css .toggle-btn.active).
        b.classList.toggle('active', ctx.statuses.has(c.status));
        const word = document.createElement('span');
        word.textContent = t(c.label);
        const n = document.createElement('b');
        n.className = 'merge-chip-n';
        n.textContent = String(counts[c.status]);
        b.append(word, ' ', n);
        box.appendChild(b);
    });
    const kinds = [...new Set(ctx.items.map((it) => it.kind))];
    const sel = mrEl('mergeKind');
    sel.textContent = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = t('All kinds');
    sel.appendChild(all);
    MERGE_KINDS.filter((k) => kinds.includes(k)).forEach((k) => {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = mergeKindText(k, true);
        sel.appendChild(o);
    });
    if (ctx.kind && !kinds.includes(ctx.kind)) ctx.kind = '';
    sel.value = ctx.kind;
    const work = counts.added + counts.changed + counts.removed + counts.conflict;
    const apply = mrEl('mergeApplyBtn');
    const v = ctx.visit;
    apply.disabled = !work && !v;
    apply.textContent = v && v.changes === 'reject' ? t('Reject the changes') : work ? t('Apply') : v ? t('Save the decision') : t('Nothing to merge');
    const anyAsk = ctx.shown.items.some(function asks(it) { return (it.fields || []).some((f) => f.conflict) || (it.children || []).some(asks); });
    mrEl('mergeAllMine').disabled = !anyAsk;
    mrEl('mergeAllTheirs').disabled = !anyAsk;
}
function renderMergeList() {
    const ctx = _mr;
    if (!ctx) return;
    ctx.shown = mergeShownPlan(ctx);
    mergeNames(ctx);
    ctx.items = mergeDisplayItems(ctx);
    renderMergeCounts();
    const list = mrEl('mergeList');
    const keepTop = list.scrollTop;
    list.textContent = '';
    const rows = ctx.items.filter((it) => ctx.statuses.has(it.status) && (!ctx.kind || it.kind === ctx.kind));
    rows.slice(0, MERGE_ROWS_MAX).forEach((it) => list.appendChild(mergeRow(ctx, it, false)));
    if (rows.length > MERGE_ROWS_MAX) {
        const more = document.createElement('li');
        more.className = 'merge-more';
        more.textContent = t('…and {n} more.', { n: rows.length - MERGE_ROWS_MAX });
        list.appendChild(more);
    }
    if (!rows.length) {
        const none = document.createElement('li');
        none.className = 'merge-more';
        none.textContent = t('Nothing to show with these filters.');
        list.appendChild(none);
    }
    list.scrollTop = keepTop;
    // What the engine leaves out or drops, said once each.
    const notes = mrEl('mergeNotes');
    notes.textContent = '';
    (ctx.shown.notes || []).forEach((n) => {
        const li = document.createElement('li');
        li.textContent = `${mergeKindText(n.args && n.args.kind)} ${(n.args && n.args.label) || ''}: ${t(n.key)}`;
        notes.appendChild(li);
    });
    mergeVisitNotes(ctx).forEach((line) => {
        const li = document.createElement('li');
        li.className = 'merge-visit';
        li.textContent = line;
        notes.appendChild(li);
    });
    notes.hidden = !notes.children.length;
}

// ---- A provider's visit: the foot's two questions (D153) ----
const MERGE_VISIT_OUTCOMES = [
    { id: 'successful', label: 'Successful' }, { id: 'not-successful', label: 'Not successful' }, { id: 'undecided', label: 'Undecided' }
];
function renderMergeVisit() {
    const ctx = _mr;
    const box = mrEl('mergeVisit');
    if (!box) return;
    box.hidden = !ctx || !ctx.visit;
    if (!ctx || !ctx.visit) return;
    const v = ctx.visit, info = v.info || {};
    const who = typeof visitWho === 'function' ? visitWho(info) : (info.visitBy || info.provider || '');
    const head = [t('A visit by {who} waits for your decision.', { who })];
    if (info.count > 1) head.push(t('This copy holds {n} visits: it replaced the one that was waiting.', { n: info.count }));
    mrEl('mergeVisitHead').textContent = joinSentences(head);
    const press = (sel, attr, value) => box.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', b.dataset[attr] === value ? 'true' : 'false'));
    box.querySelectorAll('[data-visit-changes]').forEach((b) => { b.textContent = b.dataset.visitChanges === 'apply' ? t('Apply as reviewed') : t('Reject: apply nothing'); });
    box.querySelectorAll('[data-visit-outcome]').forEach((b) => { const o = MERGE_VISIT_OUTCOMES.find((x) => x.id === b.dataset.visitOutcome); b.textContent = t(o.label); });
    press('[data-visit-changes]', 'visitChanges', v.changes);
    press('[data-visit-outcome]', 'visitOutcome', v.outcome);
    mrEl('mergeVisitChangesLabel').textContent = t('The changes');
    mrEl('mergeVisitOutcomeLabel').textContent = t('The visit');
    mrEl('mergeVisitNoteLabel').textContent = t('A note for the provider (optional)');
    const note = mrEl('mergeVisitNote');
    if (note.value !== v.note) note.value = v.note;
    const says = [];
    if (v.changes === 'reject') says.push(t('Nothing of this copy is applied; it is kept as a file.'));
    if (info.incidentId) {
        says.push(v.outcome === 'successful' ? t('The problem is marked fixed.') : v.outcome === 'not-successful'
            ? t('The problem opens again for another round, and the provider gets your note.') : t('The problem stays as it is.'));
    }
    if (info.serverId) says.push(t('The provider is told by email.'));
    mrEl('mergeVisitSays').textContent = joinSentences(says);
}

// ---- What the findings would do ----
const mergeFindingsOf = (doc) => withDoc(doc, () => withLookupPass(() => topologyFindings()));
const mergeOpenCount = (list) => list.filter((f) => (typeof isCountedFinding === 'function' ? isCountedFinding(f) : true)).length;
// Sync: the result with the choices as they are, its findings against now.
// -> { now, after, delta } or null when it cannot be worked out.
function mergeReviewDelta(ctx = _mr) {
    if (!ctx) return null;
    if (ctx.visit && ctx.visit.changes === 'reject') return { now: mergeOpenCount(ctx.before), after: mergeOpenCount(ctx.before), delta: findingsDelta(ctx.before, ctx.before) };
    try {
        const { doc } = applyMergePlan(ctx.mine, ctx.plan, ctx.choices);
        const after = mergeFindingsOf(doc);
        return { now: mergeOpenCount(ctx.before), after: mergeOpenCount(after), delta: findingsDelta(ctx.before, after) };
    } catch (e) {
        return null;
    }
}
function refreshMergeDelta() {
    if (!_mr) return null;
    clearTimeout(_mr.timer);
    _mr.timer = 0;
    const d = mergeReviewDelta(_mr);
    const el = mrEl('mergeDelta');
    if (!d) { el.textContent = ''; return null; }
    el.innerHTML = `${escapeHtml(t('Open findings: {now} now, {after} after this merge.', { now: d.now, after: d.after }))} ${findingsDeltaHtml(d.delta, true, true)}`.trim();
    return d;
}
function scheduleMergeDelta() {
    if (!_mr) return;
    clearTimeout(_mr.timer);
    _mr.timer = setTimeout(refreshMergeDelta, MERGE_DELTA_MS);
}

// ---- Open and close ----
function mergeDialogOpen() {
    const scrim = mrEl('mergeDialog');
    return !!scrim && !scrim.hidden;
}
function finishMergeReview(value) {
    const ctx = _mr;
    if (!ctx) return;
    _mr = null;
    clearTimeout(ctx.timer);
    const scrim = mrEl('mergeDialog');
    if (scrim) {
        if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
        else scrim.hidden = true;
    }
    if (ctx.resolve) ctx.resolve(value);
}
// commitMerge calls this before it can ask anything (A13).
function closeMergeDialog() { finishMergeReview(null); }

// Shows the review. -> Promise of the choices, or null for Cancel.
function showMergeReview(req) {
    if (_mergeResponder) {
        const responder = _mergeResponder;
        return Promise.resolve().then(() => responder(req)).then((v) => (v && typeof v === 'object' ? v : null));
    }
    const scrim = mrEl('mergeDialog');
    if (!scrim) return Promise.resolve(null);
    if (_mr) finishMergeReview(null);
    return new Promise((resolve) => {
        _mr = {
            opts: req, mine: req.mine, plan: req.plan, shown: req.plan, choices: Object.assign({}, req.choices || {}),
            statuses: new Set(['added', 'changed', 'removed', 'conflict']), kind: '', before: [], timer: 0, resolve, items: [],
            visit: req.visit ? Object.assign({ changes: 'apply', outcome: 'undecided', note: '' }, req.choices && req.choices.$visit, { info: req.visit }) : null
        };
        delete _mr.choices.$visit;
        // "a link", "a binder", "a copy" are words of this language and take
        // the title's capitals; only a file's name keeps its own.
        const src = mergeSourceName(req.source);
        mergeTitleInto(mrEl('mergeTitle'), req.sourceText, req.name, !!src && src !== 'link' && src !== 'binder' && src !== 'server' && src !== 'backup');
        // req.note: what the door has to say first (a backup whose author's
        // signature could not be checked, js/backupfile.js).
        mrEl('mergeMode').textContent = joinSentences([req.note || '', req.plan.mode === 'three-way'
            ? t('Three-way: compared with the copy both started from. An edit made on one side only is taken; an edit made on both sides to the same thing asks.')
            : t('Two-way: no copy both started from was found, so nothing is removed. Where the two differ, yours is kept unless you choose theirs; a blank of yours is filled from theirs.')]);
        try { _mr.before = mergeFindingsOf(req.mine); } catch (e) { _mr.before = []; }
        renderMergeList();
        renderMergeVisit();
        mrEl('mergeDelta').textContent = '';
        if (window.CarinoUI) CarinoUI.modal.open(scrim, { onDismiss: () => finishMergeReview(null) });
        else scrim.hidden = false;
        refreshMergeDelta();
    });
}

// "Merge {source} into {name}", the source (a file's name, as a rule) in a
// span of its own that the title's capitals leave as it is
// (topo_clinica-sol_reception_2026-11-10.json, never TOPO_CLINICA-…):
// css/app.css .modal-title .fname. The translation decides where it goes.
function mergeTitleInto(el, source, name, asTyped = true) {
    const text = t('Merge {source} into {name}', { source: '\u0000', name });
    const [before, after = ''] = text.split('\u0000');
    const span = document.createElement('span');
    if (asTyped) span.className = 'fname';
    span.textContent = source;
    el.replaceChildren(document.createTextNode(before), span, document.createTextNode(after));
    el.title = t('Merge {source} into {name}', { source, name });
}

// The network to merge into, as it is now: the open one with its last edit
// flushed in (A12), else the card's.
function mergeMineNow(targetId) {
    if (state.libraryId === targetId && isKept()) {
        flushAutosave();
        return JSON.parse(JSON.stringify(serializeDoc()));
    }
    const card = libraryEntry(targetId);
    return card && card.doc ? JSON.parse(JSON.stringify(card.doc)) : null;
}

// ---- The door every merge goes through ----
// opts: as commitMerge's (targetId, theirs, base, theirsRev, source, reason,
// fileName | name, open). Plans, reviews, commits; a stale plan is reviewed
// again with the answers given so far.
// -> commitMerge's answer, or { ok: false, reason } ('cancelled', 'target',
//    'read-only', 'newer', 'shape', 'stale').
async function openMergeReview(opts = {}) {
    const card = opts.targetId ? libraryEntry(opts.targetId) : null;
    if (!card || !card.doc || card.template || card.block) return { ok: false, reason: 'target' };
    if (migrateDoc(card.doc).newer || (state.libraryId === opts.targetId && state.readOnly)) {
        if (state.libraryId === opts.targetId && state.readOnly) readOnlyRefuses();
        else showToast(t('This network is read-only: it was made by a newer version of Topo.'));
        return { ok: false, reason: 'read-only' };
    }
    const sourceText = logSourceText(mergeSourceName(opts.source));
    let choices = Object.assign({}, opts.choices || {});
    // A provider's visit (D139, D153): a server's visit copy says so; any
    // other copy (a link, a file, a binder site) that brings a visit nobody
    // has decided on is one. A server's revision or a backup is the site's
    // history, never a visit to judge.
    const src = mergeSourceName(opts.source);
    let visit = opts.visit || null;
    if (!visit && src !== 'server' && src !== 'backup' && typeof visitReviewInfo === 'function') {
        try { visit = visitReviewInfo(opts.theirs, mergeMineNow(opts.targetId)); } catch (e) { visit = null; }
    }
    for (let round = 0; round < 3; round++) {
        const mine = mergeMineNow(opts.targetId);
        if (!mine) return { ok: false, reason: 'target' };
        let plan;
        try {
            plan = planMerge(mine, opts.theirs, opts.base || null, { part: opts.part || null, scope: opts.scope || null });
        } catch (e) {
            if (!(e instanceof MergeRefused)) throw e;
            if (e.reason === 'newer') showToast(t('This copy was made by a newer version of Topo, so it cannot be merged. Open it as a copy to read it.'));
            return { ok: false, reason: e.reason };
        }
        const answer = await showMergeReview({ plan, mine, targetId: opts.targetId, name: card.name, source: opts.source, sourceText, choices, note: opts.note || '', visit });
        if (!answer) {
            // A visit by link or file not decided on stays in Visits waiting.
            if (visit && !visit.serverId && typeof visitKeepWaiting === 'function') await visitKeepWaiting({ targetId: opts.targetId, theirs: opts.theirs, ident: opts.ident, source: opts.source, fileName: opts.fileName }, visit);
            return { ok: false, reason: 'cancelled' };
        }
        const dec = answer.$visit || null;
        choices = Object.assign({}, answer);
        delete choices.$visit;
        if (visit && typeof commitVisitDecision === 'function') {
            const res = await commitVisitDecision(opts, visit, dec || {}, (finish) => commitMerge(Object.assign({}, opts, { plan, choices, finish })));
            if (dec) choices.$visit = dec;
            if (res.ok || res.reason !== 'stale') return res;
            continue;
        }
        const res = await commitMerge(Object.assign({}, opts, { plan, choices }));
        if (res.ok || res.reason !== 'stale') return res;
    }
    return { ok: false, reason: 'stale' };
}

// ---- Wiring ----
(function wireMergeDialog() {
    const scrim = mrEl('mergeDialog');
    if (!scrim) return;
    scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeMergeDialog));
    mrEl('mergeApplyBtn').addEventListener('click', () => {
        if (!_mr) return;
        const v = _mr.visit;
        finishMergeReview(Object.assign({}, _mr.choices, v ? { $visit: { changes: v.changes, outcome: v.outcome, note: v.note } } : {}));
    });
    // The visit's two questions and the note (D153).
    const vbox = mrEl('mergeVisit');
    if (vbox) {
        vbox.addEventListener('click', (e) => {
            const b = e.target.closest('[data-visit-changes], [data-visit-outcome]');
            if (!b || !_mr || !_mr.visit) return;
            if (b.dataset.visitChanges) _mr.visit.changes = b.dataset.visitChanges;
            else _mr.visit.outcome = b.dataset.visitOutcome;
            renderMergeVisit();
            renderMergeCounts();
            scheduleMergeDelta();
        });
        mrEl('mergeVisitNote').addEventListener('input', (e) => { if (_mr && _mr.visit) _mr.visit.note = e.target.value; });
    }
    mrEl('mergeAllMine').addEventListener('click', () => mergeUseAll('mine'));
    mrEl('mergeAllTheirs').addEventListener('click', () => mergeUseAll('theirs'));
    mrEl('mergeKind').addEventListener('change', (e) => { if (!_mr) return; _mr.kind = e.target.value; renderMergeList(); });
    // On a phone the mode's sentence shows two lines (css/app.css): a tap
    // on it shows the rest, another folds it again.
    mrEl('mergeMode').addEventListener('click', (e) => e.currentTarget.classList.toggle('open'));
    mrEl('mergeCounts').addEventListener('click', (e) => {
        const b = e.target.closest('[data-status]');
        if (!b || !_mr) return;
        const s = b.dataset.status;
        if (_mr.statuses.has(s)) _mr.statuses.delete(s); else _mr.statuses.add(s);
        renderMergeList();
    });
    mrEl('mergeList').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-key]');
        if (!b || !_mr) return;
        if (b.dataset.field !== undefined) {
            _mr.choices[`${b.dataset.key}#${b.dataset.field}`] = b.dataset.take;
            // Only this pair changes: pressed in place, the list not rebuilt
            // (the focus and the scroll stay where they are).
            b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        } else if (b.dataset.choice !== undefined) {
            _mr.choices[b.dataset.key] = b.dataset.choice;
            const ambiguous = _mr.plan.items.some((it) => it.key === b.dataset.key && it.conflict && it.conflict.type === 'ambiguous');
            if (ambiguous) {
                // The match chosen brings its own fields: the list is planned again.
                renderMergeList();
                const again = mrEl('mergeList').querySelector(`button[data-key="${CSS.escape(b.dataset.key)}"][data-choice="${CSS.escape(b.dataset.choice)}"]`);
                if (again) again.focus();
            } else b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        }
        scheduleMergeDelta();
    });
})();

// Published for tests/suites/mergeui.js.
window.TopoMergeUI = {
    openMergeReview, showMergeReview, closeMergeDialog, setMergeResponder, mergeDialogOpen, refreshMergeDelta, mergeReviewDelta,
    mergeUseAll, mergeFieldKey, mergeFieldText, mergeValueText, mergeKindText, MERGE_KIND_ONE, MERGE_KIND_MANY, MERGE_CHIPS,
    MERGE_MATCHED_BY, MERGE_ROWS_MAX, mergeIncidentLabel, mergeVisitNotes, renderMergeVisit, review: () => _mr
};
