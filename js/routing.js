// Whom to call: routing a problem report to the providers (docs/SCOPE.md
// step 4 stage 2, D41 and the routing decisions after it). Pure: the
// document's lists come in through ctx (the live state's by default) and the
// clock through opts.now, so the same report on the same network ranks the
// same way on every machine.
//
// routeIncident(ctx, { nodeIds, groupId, symptom }, { now }) ->
//   { results, empty, sentence }
// results, best first, one per provider:
//   { provider, service, serviceRank, distance, via, open, hoursText, reason, alsoFor }
//   via      { kind: 'device'|'cable'|'power'|'group'|'network', id, label, how, from }
//            how is nodeProviders' 'own'|'host'|'group' for a device, from
//            the host or group record it came through;
//   distance steps from the device with the problem (0: that device),
//            Infinity for a provider only listed for the network;
//   open     true, false, or null when its support hours do not read;
//   reason   one translated sentence: "Internet for Modem, 2 steps upstream".
//
// The way up is not locatePath's walk: that one follows the faceplate
// (uplinkOf), which from a router heads down to a LAN switch. It is a
// breadth-first search from the device over the cables (a VPN rides the
// internet, so it is not a way out; a guest's tie to its host is not a cable)
// to every internet edge it reaches: each cloud that stands for the internet
// (not another site, not retired), else each routing device. Both lines of
// a site with two show, each at its own distance. Ties go to the neighbour
// whose name sorts first, then its id, then the cable's id.

const SYMPTOMS = INCIDENT_SYMPTOMS;
// Which services answer each symptom, best first. 'other': IT support, then
// anyone. A provider of a service not in the list still shows, after them.
const SYMPTOM_SERVICES = {
    internet: ['internet', 'it'],
    wifi: ['it', 'internet'],
    phone: ['phone', 'it'],
    camera: ['security', 'it'],
    printer: ['it', 'vendor'],
    power: ['power'],
    other: ['it']
};
const SYMPTOM_LABEL = {
    internet: 'No internet', wifi: 'Wi-Fi', phone: 'Phones', camera: 'Cameras',
    printer: 'Printer', power: 'Power cut', other: 'Something else'
};
const symptomLabel = (s) => t(SYMPTOM_LABEL[s] || SYMPTOM_LABEL.other);
// The kinds of device a symptom is usually about, for the "choose from a
// list" picker (and the tests): those come first.
const SYMPTOM_DEVICE_TYPES = {
    internet: ['cloud', 'router', 'firewall', 'edge'],
    wifi: ['ap'],
    phone: ['voip'],
    camera: ['camera'],
    printer: ['printer'],
    power: [],
    other: []
};
const ROUTE_ALSO_MAX = 3;

// ---- Support hours ----
// parseHours(text) -> { always: true } | { spans: [{ days, from, to }] } | null
// days 0..6 (Sunday 0), from/to minutes after midnight; to < from wraps past
// midnight. null: nothing reads, which is "unknown", never "closed".
const HOURS_DAYS = (() => {
    const m = new Map();
    const put = (day, words) => words.forEach((w) => m.set(w, day));
    put(0, ['sun', 'sunday', 'dom', 'domingo', 'вс', 'воскресенье', '日']);
    put(1, ['mon', 'monday', 'lun', 'lunes', 'seg', 'segunda', 'пн', 'понедельник', '月']);
    put(2, ['tue', 'tues', 'tuesday', 'mar', 'martes', 'ter', 'terça', 'terca', 'вт', 'вторник', '火']);
    put(3, ['wed', 'wednesday', 'mié', 'mie', 'miércoles', 'miercoles', 'qua', 'quarta', 'ср', 'среда', '水']);
    put(4, ['thu', 'thur', 'thurs', 'thursday', 'jue', 'jueves', 'qui', 'quinta', 'чт', 'четверг', '木']);
    put(5, ['fri', 'friday', 'vie', 'viernes', 'sex', 'sexta', 'пт', 'пятница', '金']);
    put(6, ['sat', 'saturday', 'sáb', 'sab', 'sábado', 'sabado', 'сб', 'суббота', '土']);
    return m;
})();
// Spanish single letters, only as capitals ("L-V 9:00-18:00").
const HOURS_LETTERS = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 0 };
const HOURS_RANGE_WORDS = new Set(['a', 'to', 'até', 'ate', 'às', 'as', 'до', 'по', 'al', 'à', 'au', 'bis']);
// A range followed by one of these is a duration ("2-4 h response"), not
// opening hours.
const HOURS_DURATION_WORDS = new Set(['response', 'respond', 'restore', 'restoration', 'resolution', 'repair', 'fix', 'sla', 'turnaround',
    'respuesta', 'restauración', 'restauracion', 'restablecimiento', 'reparación', 'reparacion', 'solución', 'solucion',
    'resposta', 'restauração', 'restauracao', 'reparo', 'solução', 'solucao', 'ответ', 'реакция', 'восстановление', 'ремонт', '対応', '復旧']);
const HOURS_ALWAYS_RE = /(^|[^\d])24\s*[\/x×]\s*7(?![\d])|(^|[^\d])24\s*(h|hrs?|hours|horas|hs|часа)(?![\p{L}\d])|\b(always|siempre|sempre)\b|круглосуточно|24時間|年中無休/iu;
const HOURS_EVERY_RE = /every\s*day|everyday|daily|todos\s+los\s+d[ií]as|todos\s+os\s+dias|diario|diariamente|ежедневно|毎日|без\s+выходных/giu;
const HOURS_WEEKDAYS_RE = /weekdays|d[ií]as\s+h[aá]biles|dias\s+[uú]teis|будни|平日/giu;

function parseHours(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const s0 = text.normalize('NFC');
    if (HOURS_ALWAYS_RE.test(s0)) return { always: true };
    // Phrases first, as one marker word each; "-feira" and 曜日 are noise.
    const s = s0.replace(HOURS_EVERY_RE, ' \u0001E ').replace(HOURS_WEEKDAYS_RE, ' \u0001W ')
        .replace(/-?feira/giu, '').replace(/曜日|曜/gu, ' ');
    const tokRe = /\u0001([EW])|(\d{1,2})(?:\s*[:.h時]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|h|hs|時|ч)?(?![\p{L}\d])|([-–—~〜～])|(\p{L}+)|([,;·|\n/])/giu;
    const toks = [];
    let m;
    while ((m = tokRe.exec(s))) {
        if (m[1]) toks.push(m[1] === 'E' ? { k: 'days', days: [0, 1, 2, 3, 4, 5, 6] } : { k: 'days', days: [1, 2, 3, 4, 5] });
        else if (m[2] !== undefined) {
            let h = +m[2];
            const min = m[3] !== undefined ? +m[3] : 0;
            const ap = (m[4] || '').toLowerCase().replace(/\./g, '');
            if (ap === 'am' && h === 12) h = 0;
            if (ap === 'pm' && h < 12) h += 12;
            toks.push(h <= 24 && min < 60 && (h < 24 || min === 0) ? { k: 'time', v: h * 60 + min, ap: ap === 'am' || ap === 'pm' } : { k: 'junk' });
        } else if (m[5]) toks.push({ k: 'sep' });
        else if (m[6]) {
            const raw = m[6], w = raw.toLowerCase();
            if (HOURS_DAYS.has(w)) toks.push({ k: 'day', d: HOURS_DAYS.get(w) });
            else if (raw.length === 1 && raw in HOURS_LETTERS) toks.push({ k: 'day', d: HOURS_LETTERS[raw] });
            else if (HOURS_RANGE_WORDS.has(w)) toks.push({ k: 'sep' });
            else toks.push({ k: 'word', w });
        } else toks.push({ k: 'comma' });
    }
    // Days gather until a time range uses them; a range with no new days
    // reuses the last ones ("Mon-Fri 9-13 15-19"), and with none at all it
    // is every day until days follow it ("8:00-17:00 L-V"). A lone time
    // ("8 h on-site") and a duration ("2-4 h response") read as nothing.
    const spans = [];
    let days = [], used = null, pending = [], pendingGot = false, trail = false;
    const sorted = (list) => [...new Set(list)].sort((a, b) => a - b);
    const dayRange = (a, b) => { const out = []; for (let d = a; ; d = (d + 1) % 7) { out.push(d); if (d === b || out.length > 7) break; } return out; };
    for (let i = 0; i < toks.length; i++) {
        const x = toks[i];
        if (x.k === 'day' || x.k === 'days') {
            if (used) { days = []; used = null; }
            if (x.k === 'day' && toks[i + 1] && toks[i + 1].k === 'sep' && toks[i + 2] && toks[i + 2].k === 'day') {
                days.push(...dayRange(x.d, toks[i + 2].d)); i += 2;
            } else days.push(...(x.k === 'day' ? [x.d] : x.days));
            // Days written after hours that had none are those hours' days.
            if (pending.length) { const ds = sorted(days); pending.forEach((k) => { spans[k].days = ds; }); pendingGot = true; }
        } else if (x.k === 'time' && toks[i + 1] && toks[i + 1].k === 'sep' && toks[i + 2] && toks[i + 2].k === 'time') {
            const y = toks[i + 2];
            i += 2;
            const after = toks.slice(i + 1, i + 3).filter((k) => k.k === 'word');
            if (after.some((k) => HOURS_DURATION_WORDS.has(k.w))) continue;
            const from = x.v;
            let to = y.v;
            // "9-5": with no am/pm, an end before a start that are both
            // morning numbers is the afternoon, not past midnight.
            if (!x.ap && !y.ap && to < from && from <= 720 && to < 720) to += 720;
            const fresh = !days.length && !used;
            const ds = sorted(days.length ? days : (used || [0, 1, 2, 3, 4, 5, 6]));
            spans.push(from === to ? { days: ds, from: 0, to: 1440 } : { days: ds, from, to });
            if (fresh || (trail && !days.length)) { pending.push(spans.length - 1); used = null; }
            else { used = ds; pending = []; pendingGot = false; }
            trail = false;
        } else if (x.k === 'comma') {
            // "8-17 L-V, 9-13 S": the days that followed are taken.
            if (pendingGot) { used = sorted(days); days = []; pending = []; pendingGot = false; trail = true; }
        }
        // A word between the days and their hours ("Mon-Fri from 9-18")
        // keeps the days.
    }
    return spans.length ? { spans } : null;
}
// Open at this moment, in the browser's local time (the document has no
// time zone): true, false, or null when the hours do not read.
function hoursOpenAt(parsed, date) {
    if (!parsed) return null;
    if (parsed.always) return true;
    const d = date instanceof Date ? date : new Date(date);
    const day = d.getDay(), min = d.getHours() * 60 + d.getMinutes();
    return parsed.spans.some((s) => (s.from < s.to
        ? s.days.includes(day) && min >= s.from && min < s.to
        : (s.days.includes(day) && min >= s.from) || (s.days.includes((day + 6) % 7) && min < s.to)));
}

// ---- The way up ----
function routeCtx(ctx) {
    // A document passed in answers for itself: a list it lacks is empty,
    // never the live document's.
    if (!ctx) return { nodes: state.nodes, links: state.links, groups: state.groups || [], providers: state.providers || [] };
    return { nodes: ctx.nodes || [], links: ctx.links || [], groups: ctx.groups || [], providers: ctx.providers || [] };
}
// The outermost host of a VM or container, and the hosts on the way,
// innermost first (as nodeProviders walks them).
function routeHosts(node, byId) {
    const out = [];
    if (!node || !isVirtualType(node.type)) return out;
    const seen = new Set([node.id]);
    for (let h = byId.get(node.host); h && !seen.has(h.id) && out.length < HOST_DEPTH_MAX; h = isVirtualType(h.type) ? byId.get(h.host) : null) {
        seen.add(h.id); out.push(h);
    }
    return out;
}
// The cable graph routing walks: no self-loop, no VPN, no guest-to-host tie,
// nothing through a retired box. Neighbours in a fixed order.
function routeGraph(c) {
    const byId = new Map(c.nodes.filter(Boolean).map((n) => [n.id, n]));
    const adj = new Map();
    const kin = (a, b) => routeHosts(a, byId).includes(b) || routeHosts(b, byId).includes(a);
    c.links.forEach((l) => {
        if (!l || l.source === l.target) return;
        const a = byId.get(l.source), b = byId.get(l.target);
        if (!a || !b || effectiveMedium(l, a, b) === 'vpn' || kin(a, b)) return;
        [[a, b], [b, a]].forEach(([x, y]) => { if (!adj.has(x.id)) adj.set(x.id, []); adj.get(x.id).push({ node: y, link: l }); });
    });
    adj.forEach((list) => list.sort((p, q) => naturalCompare(locPlainName(p.node), locPlainName(q.node))
        || (p.node.id < q.node.id ? -1 : p.node.id > q.node.id ? 1 : 0)
        || (p.link.id < q.link.id ? -1 : p.link.id > q.link.id ? 1 : 0)));
    const clouds = c.nodes.filter((n) => n && n.type === 'cloud' && !n.siteRef && !isRetired(n));
    const anchors = new Set((clouds.length ? clouds : c.nodes.filter((n) => n && isRoutingDevice(n.type) && !isRetired(n))).map((n) => n.id));
    return { byId, adj, anchors };
}
// One device's ways out: [{ node, distance }] and [{ link, distance }], the
// device first. The shortest path to each internet edge it reaches.
function routePath(seed, g) {
    const hosts = routeHosts(seed, g.byId);
    const start = hosts.length ? hosts[hosts.length - 1] : seed;
    const off = hosts.length;
    const devices = [{ node: seed, distance: 0 }, ...hosts.map((h, i) => ({ node: h, distance: i + 1 }))];
    const cables = [];
    const dist = new Map([[start.id, 0]]), back = new Map();
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
        const here = queue[qi];
        if (g.anchors.has(here.id) && here !== start) continue;   // the edge: nothing past it is "up"
        (g.adj.get(here.id) || []).forEach(({ node, link }) => {
            if (dist.has(node.id) || isRetired(node)) return;
            dist.set(node.id, dist.get(here.id) + 1);
            back.set(node.id, { from: here, link });
            queue.push(node);
        });
    }
    const reached = queue.filter((n) => g.anchors.has(n.id));
    // No way out (a cloud drawn but not cabled, no router at all, the only
    // way up through a retired box): the switches, access points and routing
    // devices the walk did reach stand in for the path, nearest first, so
    // the access point's own provider still ranks by distance rather than
    // falling to "listed for this network".
    const ends = reached.length ? reached
        : queue.filter((n) => n !== start && (isL2Forwarder(n) || isRoutingDevice(n.type)));
    const onPath = new Set(devices.map((d) => d.node.id)), cablesOn = new Set();
    ends.forEach((edge) => {
        for (let n = edge; n && n !== start; ) {
            const b = back.get(n.id);
            if (!onPath.has(n.id)) { onPath.add(n.id); devices.push({ node: n, distance: dist.get(n.id) + off }); }
            if (b && !cablesOn.has(b.link.id)) { cablesOn.add(b.link.id); cables.push({ link: b.link, distance: dist.get(n.id) + off, far: n }); }
            n = b ? b.from : null;
        }
    });
    devices.sort((a, b) => a.distance - b.distance);
    cables.sort((a, b) => a.distance - b.distance);
    return { devices, cables, edges: reached.map((n) => ({ node: n, distance: dist.get(n.id) + off })) };
}
// The devices the report starts from: those it names, or for the whole place
// or a group the routing devices in it (none: no path, only the groups and
// the network's list).
function routeSeeds(c, q, g) {
    const named = (q.nodeIds || []).map((id) => g.byId.get(id)).filter(Boolean);
    if (named.length) return named;
    const inGroup = q.groupId ? new Set([q.groupId, ...groupDescendantIds(q.groupId, c.groups)]) : null;
    const where = (n) => !inGroup || inGroup.has(n.group) || (isVirtualType(n.type) && routeHosts(n, g.byId).some((h) => inGroup.has(h.group)));
    return c.nodes.filter((n) => n && isRoutingDevice(n.type) && !isRetired(n) && where(n));
}
// For the tests and the provider panel: every seed's way out.
function routePaths(ctx, query = {}) {
    const c = routeCtx(ctx), g = routeGraph(c);
    return routeSeeds(c, query, g).map((seed) => Object.assign({ seed }, routePath(seed, g)));
}

// ---- The ranking ----
function routeServiceRank(service, symptom) {
    if (symptom === 'other' || !SYMPTOM_SERVICES[symptom]) return service === 'it' ? 0 : 1;
    const list = SYMPTOM_SERVICES[symptom], i = list.indexOf(service);
    return i < 0 ? list.length : i;
}
function routeIncident(ctx, query = {}, opts = {}) {
    const c = routeCtx(ctx);
    const symptom = SYMPTOMS.includes(query.symptom) ? query.symptom : 'other';
    const now = opts.now instanceof Date ? opts.now : new Date(opts.now === undefined ? Date.now() : opts.now);
    if (!c.providers.length) return { results: [], empty: true, sentence: routeEmptySentence() };
    const g = routeGraph(c);
    const pctx = { nodes: c.nodes, groups: c.groups, providers: c.providers };
    const seeds = routeSeeds(c, query, g);
    // The whole place or a group: the seeds are its routing devices, named.
    const whole = !(query.nodeIds || []).some((id) => g.byId.has(id));
    const found = new Map();   // provider id -> [candidate...] in the order seen
    const add = (provider, distance, via) => {
        if (!provider) return;
        if (!found.has(provider.id)) found.set(provider.id, []);
        found.get(provider.id).push({ distance, via });
    };
    let pathMax = 0;
    seeds.forEach((seed) => {
        const p = routePath(seed, g);
        p.devices.forEach(({ node, distance }) => {
            pathMax = Math.max(pathMax, distance);
            nodeProviders(node, pctx).forEach((r) => add(r.provider, distance,
                { kind: 'device', id: node.id, label: locPlainName(node), how: r.via, from: r.via === 'own' ? null : (r.from.name || groupLabel(r.from) || r.from.id), whole }));
        });
        p.cables.forEach(({ link, distance, far }) => {
            pathMax = Math.max(pathMax, distance);
            linkProviders(link, c.providers).forEach((pv) => add(pv, distance, { kind: 'cable', id: link.id, label: locPlainName(far), how: 'own', from: null }));
        });
    });
    // The groups round the place: the seeds', and the one the report names.
    const chainIds = [];
    const chainOf = (gid) => { const gr = groupById(gid, c.groups); return gr ? groupChain(gr, c.groups) : []; };
    const rootOf = (n) => { const h = routeHosts(n, g.byId); return h.length ? h[h.length - 1] : n; };
    [...seeds.map((n) => rootOf(n).group), query.groupId].forEach((gid) => {
        chainOf(gid).slice().reverse().forEach((gr) => { if (!chainIds.includes(gr.id)) chainIds.push(gr.id); });
    });
    // A power cut: whoever looks after power on a device in the same place
    // (Topo has no UPS type: a device naming a Power / UPS provider is one).
    if (symptom === 'power') {
        const roots = new Set(chainIds.map((id) => chainOf(id)[0]).filter(Boolean).map((gr) => gr.id));
        const inPlace = (n) => {
            if (!roots.size) return true;
            const ch = chainOf(rootOf(n).group);
            return !!ch.length && roots.has(ch[0].id);
        };
        c.nodes.filter((n) => n && !isRetired(n) && inPlace(n)).forEach((n) => {
            nodeProviders(n, pctx).filter((r) => r.via === 'own' && providerServiceOf(r.provider) === 'power')
                .forEach((r) => add(r.provider, pathMax + 1, { kind: 'power', id: n.id, label: locPlainName(n), how: 'own', from: null }));
        });
    }
    chainIds.forEach((gid) => {
        const gr = groupById(gid, c.groups);
        providerRefsOf(gr).forEach((id) => { if (!found.has(id)) add(providerById(id, c.providers), pathMax + 2, { kind: 'group', id: gr.id, label: groupLabel(gr), how: 'own', from: null }); });
    });
    c.providers.forEach((pv) => { if (!found.has(pv.id)) add(pv, Infinity, { kind: 'network', id: null, label: '', how: 'own', from: null }); });

    const order = new Map(c.providers.map((pv, i) => [pv.id, i]));
    const results = [];
    found.forEach((cands, id) => {
        const provider = providerById(id, c.providers);
        if (!provider) return;
        // Its nearest place; the rest are "also for", nearest first.
        const sorted = cands.map((x, i) => ({ x, i })).sort((a, b) => (a.x.distance - b.x.distance) || (a.i - b.i)).map((o) => o.x);
        const best = sorted[0];
        const service = providerServiceOf(provider);
        const hoursText = provider.hours || '';
        const open = hoursOpenAt(parseHours(hoursText), now);
        const seenAlso = new Set([best.via.kind + ':' + best.via.id]);
        const alsoFor = [];
        sorted.slice(1).forEach((o) => {
            const k = o.via.kind + ':' + o.via.id;
            if (seenAlso.has(k) || o.via.kind === 'network' || alsoFor.length >= ROUTE_ALSO_MAX) return;
            seenAlso.add(k); alsoFor.push({ kind: o.via.kind, id: o.via.id, label: o.via.label, distance: o.distance });
        });
        const r = { provider, service, serviceRank: routeServiceRank(service, symptom), distance: best.distance, via: best.via, open, hoursText, alsoFor };
        r.reason = routeReasonText(r);
        results.push(r);
    });
    const hoursRank = (o) => (o === true ? 0 : o === null ? 1 : 2);
    results.sort((a, b) => (a.serviceRank - b.serviceRank)
        || (a.distance === b.distance ? 0 : a.distance < b.distance ? -1 : 1)
        || (hoursRank(a.open) - hoursRank(b.open))
        || (order.get(a.provider.id) - order.get(b.provider.id)));
    return { results, empty: false, sentence: '' };
}
const routeEmptySentence = () => t('No provider is listed for this network yet. Add one in Providers so Topo can say whom to call; you can still save and share this report.');
// The service as said in a sentence; a provider with none (or "Other") is
// just "Provider".
const routeServiceWord = (service) => (service && service !== 'other' ? providerServiceLabel(service) : t('Provider'));
function routeReasonText(r) {
    const service = routeServiceWord(r.service), v = r.via || {}, n = r.distance, name = v.label;
    let s;
    if (v.kind === 'network') s = t('{service}, listed for this network', { service });
    else if (v.kind === 'group') s = t('{service} for {name} (its group)', { service, name });
    else if (v.kind === 'power') s = t('{service} for {name}, in the same place', { service, name });
    else if (v.kind === 'cable') s = n === 1 ? t('{service} for the cable to {name}, 1 step upstream', { service, name })
        : t('{service} for the cable to {name}, {n} steps upstream', { service, name, n });
    else if (n === 0) s = v.whole ? t('{service} for {name}', { service, name }) : t('{service} for this device', { service });
    else s = n === 1 ? t('{service} for {name}, 1 step upstream', { service, name }) : t('{service} for {name}, {n} steps upstream', { service, name, n });
    if (v.kind === 'device' && v.how !== 'own' && v.from) s = t('{reason} (through {name})', { reason: s, name: v.from });
    return s;
}
// "Open now" / "Closed now", or '' when the hours do not read.
const routeOpenText = (r) => (r.open === true ? t('Open now') : r.open === false ? t('Closed now') : '');
