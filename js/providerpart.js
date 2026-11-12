// ---- A provider's part of the network (docs/SCOPE.md D91-D93) ----
// A problem report goes to the providers who look after what is wrong. The
// link it carries is, by default, only their part of the network (the client
// chooses "The whole network" otherwise): what they answer for, in full, and
// the devices around it, reduced, so they can find their way.
//
//   providerPart(doc, providerIds, opts)   pure: the part of a serialized
//                                          document for a set of providers
//   partOfSelf(doc, selfId)                the part of one provider, as the
//                                          provider's report reads it
//   partCopy(providerIds, opts)            the open network's part as it
//                                          leaves: identified, chained, and
//                                          kept here as a 'part' revision
//                                          (js/revisions.js), the base its
//                                          return is merged against
//   partMergeInfo(cardId, rev)             what the merge back needs to know
//                                          of a part (js/mergedoors.js)
//   partCopyFrom(part, theirs, mine)       whose copy a merge back is
//                                          (js/mergeapply.js)
//
// The rule (D91, D92). For each chosen provider p:
//   items     every device, cable and group p answers for: named on it,
//             through its host chain (D35, per service), or through a group;
//             a group naming p brings ALL its members, nested groups
//             included (the owner, 2026-11-10), even one a nearer provider of
//             the same service covers; and every cable between two items.
//             Items go in full.
//   context   the path, not the neighbourhood (D363): for each item device
//             the devices on its way to the network, as monitorChains
//             (js/checks.js) walks it: to its nearest routing device, and
//             for a routing device toward the Internet (a cloud node) or else
//             its upstream router; the nearest two devices of that way that
//             are not items (a VPN tunnel is not a way; a radio association
//             and a patch panel are). The far end of a cable an item
//             answers for comes too. The hosts the kept devices run on, and
//             the devices a kept problem report names. Context goes reduced:
//             name, type, place, the ports facing the kept cables (every
//             field of those), and the addresses of its other interfaces.
//             Nothing else: no notes, no serial, no other provider.
//   left out  what hangs below an item and is not on a way (D364: the PCs
//             on their switch, the phones on their PoE ports) is not sent,
//             nor its cable; each port of an item such a cable used goes out
//             marked portAttrs.pN.partUsed, "in use (not in your part)", a
//             mark of the part only: the merge strips it (mergeInput,
//             js/merge.js), so it is never written into the client's
//             network.
//   cables    every cable whose two ends are kept; one between two context
//             devices goes reduced (its ends, ports and medium).
//   groups    the items' groups and every group needed to place a kept
//             device or a kept report.
//   providers only the chosen ones, without the client's notes about them.
//   reports   the one being sent, and the chosen providers' reports on their
//             items (open, or with a visit of theirs), routed to them only;
//             their visits only; the matching log entries, chained again.
//   header    the site and the client; Wi-Fi networks and subnets the kept
//             devices use; custom columns the items use; expected lives.
// Ids are the network's own everywhere: the merge back matches by them.

// How many devices of each way are sent (D363).
const PART_HOPS = 2;
// What a context device keeps of itself (and its host, when that is kept).
const PART_CONTEXT_KEYS = ['id', 'type', 'name', 'x', 'y', 'group', 'portCount', 'portScheme', 'portsFace'];
// A cable between two context devices: where it runs, nothing about it.
const PART_CONTEXT_LINK_KEYS = ['id', 'source', 'target', 'sourceIface', 'targetIface', 'medium', 'wifi'];
const partArr = (v) => (Array.isArray(v) ? v : []);
const partRecs = (v) => partArr(v).filter((x) => x && typeof x === 'object' && !Array.isArray(x));
const partClone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// -> { whole, doc, providers, items: { nodes, links, groups } (Sets of ids),
//      context: Map(id -> { hop: 0|1|2|null, why: Set, facing: Set }),
//      groups: Set (every group kept), incidents: [ids], counts }
// whole: no chosen provider is in the document, so there is no part (the
// caller sends the whole network, as before parts).
function providerPart(doc, providerIds, opts = {}) {
    const src = doc && typeof doc === 'object' ? doc : {};
    const nodes = partRecs(src.nodes), links = partRecs(src.links), groups = partRecs(src.groups), providers = partRecs(src.providers);
    const want = new Set(partArr(providerIds));
    const P = providers.filter((p) => want.has(p.id)).map((p) => p.id).filter((id, i, a) => a.indexOf(id) === i);
    const byId = new Map();
    nodes.forEach((n) => { if (!byId.has(n.id)) byId.set(n.id, n); });
    const groupOf = new Map();
    groups.forEach((g) => { if (!groupOf.has(g.id)) groupOf.set(g.id, g); });
    if (!P.length) {
        return { whole: true, doc: src, providers: [], items: { nodes: new Set(byId.keys()), links: new Set(links.map((l) => l.id)), groups: new Set(groupOf.keys()) },
            context: new Map(), groups: new Set(groupOf.keys()), incidents: partRecs(src.incidents).map((x) => x.id),
            counts: { items: byId.size, context: 0, links: links.length, groups: groupOf.size, leftOut: 0, busyPorts: 0 } };
    }
    const Pset = new Set(P);

    // ---- Items ----
    const ctx = { nodes, links, groups, providers, nodeOf: (id) => byId.get(id) || null };
    const items = { nodes: new Set(), links: new Set(), groups: new Set() };
    const via = new Map();   // device id -> how the chosen providers answer for it ('own' | 'host' | 'group')
    P.forEach((p) => {
        const cov = providerCovers(p, ctx);
        cov.nodes.forEach((n) => {
            items.nodes.add(n.id);
            if (!via.has(n.id)) { const r = nodeProviders(n, ctx).find((x) => x.provider.id === p); via.set(n.id, r ? r.via : 'own'); }
        });
        cov.links.forEach((l) => items.links.add(l.id));
        cov.groups.forEach((g) => {
            items.groups.add(g.id);
            groupDescendantIds(g.id, groups).forEach((id) => items.groups.add(id));
            groupMembers(g.id, true, nodes, groups).forEach((n) => { items.nodes.add(n.id); if (!via.has(n.id)) via.set(n.id, 'group'); });
        });
    });
    links.forEach((l) => { if (items.nodes.has(l.source) && items.nodes.has(l.target)) items.links.add(l.id); });

    // ---- Context: the way each item takes to the network (D363) ----
    const context = new Map();
    const ctxOf = (id) => {
        if (!context.has(id)) context.set(id, { hop: null, why: new Set(), facing: new Set() });
        return context.get(id);
    };
    const dist = new Map();
    items.nodes.forEach((id) => dist.set(id, 0));
    const near = (id, d, why) => {
        if (!byId.has(id) || items.nodes.has(id)) return;
        if (!dist.has(id) || dist.get(id) > d) dist.set(id, d);
        ctxOf(id).why.add(why);
    };
    // The far end of a cable they answer for: one, whatever the medium.
    links.forEach((l) => {
        if (!items.links.has(l.id)) return;
        [l.source, l.target].forEach((id) => near(id, 1, 'cable-end'));
    });
    const adj = new Map();
    const join = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
    links.forEach((l) => {
        if (l.source === l.target || !byId.has(l.source) || !byId.has(l.target)) return;
        if (effectiveMedium(l, byId.get(l.source), byId.get(l.target)) === 'vpn') return;
        join(l.source, l.target); join(l.target, l.source);
    });
    adj.forEach((list) => list.sort());
    const live = (id) => { const n = byId.get(id); return !!n && !isRetired(n); };
    const isGate = (id) => { const n = byId.get(id); return live(id) && n.type !== 'cloud' && isRoutingDevice(n.type); };
    const isCloud = (id) => { const n = byId.get(id); return live(id) && n.type === 'cloud'; };
    // The way from `from` to the first device `stop` takes, nearest first,
    // `from` left out; [] when there is none. Breadth first, as monitorChains.
    const wayTo = (from, stop) => {
        const parent = new Map([[from, null]]);
        const queue = [from];
        while (queue.length) {
            const id = queue.shift();
            if (id !== from && stop(id)) {
                const way = [];
                for (let p = id; p && p !== from; p = parent.get(p)) way.unshift(p);
                return way;
            }
            if (id !== from && !live(id)) continue;
            (adj.get(id) || []).forEach((nx) => { if (!parent.has(nx)) { parent.set(nx, id); queue.push(nx); } });
        }
        return [];
    };
    [...items.nodes].sort().forEach((id) => {
        if (!adj.has(id)) return;
        let way;
        if (isGate(id)) {
            way = wayTo(id, isCloud);
            if (!way.length) way = wayTo(id, isGate);
        } else way = wayTo(id, isGate);
        way.filter((x) => !items.nodes.has(x)).slice(0, PART_HOPS).forEach((x, i) => near(x, i + 1, 'path'));
    });
    dist.forEach((d, id) => { if (d > 0) ctxOf(id).hop = d; });
    // The hosts of every device kept so far (a guest without its host would
    // lose it on load).
    const hostChain = (n) => {
        const out = [];
        const seen = new Set([n.id]);
        for (let h = n.host ? byId.get(n.host) : null; h && !seen.has(h.id) && out.length < HOST_DEPTH_MAX; h = h.host ? byId.get(h.host) : null) { seen.add(h.id); out.push(h); }
        return out;
    };
    [...dist.keys()].forEach((id) => hostChain(byId.get(id)).forEach((h) => {
        if (items.nodes.has(h.id)) return;
        const c = ctxOf(h.id);
        c.why.add('host');
        if (c.hop === null) c.hop = 0;
    }));

    // ---- Problem reports ----
    const log = partRecs(src.log);
    const visitById = new Map();
    log.forEach((e) => { if (e.kind === 'visit' && !visitById.has(e.id)) visitById.set(e.id, e); });
    const ownVisit = (vid) => { const e = visitById.get(vid); return !!e && Pset.has(e.providerId); };
    const incidents = partRecs(src.incidents).filter((inc) => {
        if (opts.incidentId && inc.id === opts.incidentId) return true;
        if (!partArr(inc.routedTo).some((id) => Pset.has(id))) return false;
        const touches = partArr(inc.nodeIds).some((id) => items.nodes.has(id)) || (!!inc.groupId && items.groups.has(inc.groupId));
        if (!touches) return false;
        return inc.status !== 'closed' || partArr(inc.visits).some(ownVisit);
    });
    const keptInc = new Set(incidents.map((x) => x.id));
    // Where each kept report is, even beyond two hops.
    incidents.forEach((inc) => partArr(inc.nodeIds).forEach((id) => {
        if (!byId.has(id) || items.nodes.has(id)) return;
        ctxOf(id).why.add('problem');
    }));

    const kept = new Set([...items.nodes, ...context.keys()]);

    // ---- Left out below the items (D364) ----
    const leftOut = new Set();
    const busy = new Map();   // item id -> Set of its faceplate ports a cable left out used
    links.forEach((l) => {
        if (l.source === l.target || !byId.has(l.source) || !byId.has(l.target)) return;
        [['source', 'sourceIface', 'target'], ['target', 'targetIface', 'source']].forEach(([end, port, far]) => {
            if (!items.nodes.has(l[end]) || kept.has(l[far])) return;
            leftOut.add(l[far]);
            if (typeof l[port] === 'string' && PORT_ID_RE.test(l[port])) {
                if (!busy.has(l[end])) busy.set(l[end], new Set());
                busy.get(l[end]).add(l[port]);
            }
        });
    });

    // ---- Groups: the items', and every one needed to place what is kept ----
    const keptGroups = new Set(items.groups);
    const addChain = (gid) => {
        const seen = new Set();
        for (let g = groupOf.get(gid); g && !seen.has(g.id); g = g.parent ? groupOf.get(g.parent) : null) { seen.add(g.id); keptGroups.add(g.id); }
    };
    kept.forEach((id) => { const n = byId.get(id); if (n && n.group) addChain(n.group); });
    [...items.groups].forEach(addChain);
    incidents.forEach((inc) => { if (inc.groupId) addChain(inc.groupId); });

    // ---- Cables: both ends kept ----
    const keptLinks = links.filter((l) => byId.has(l.source) && byId.has(l.target) && kept.has(l.source) && kept.has(l.target));
    keptLinks.forEach((l) => {
        [['source', 'sourceIface'], ['target', 'targetIface']].forEach(([end, port]) => {
            if (context.has(l[end]) && typeof l[port] === 'string' && l[port]) context.get(l[end]).facing.add(l[port]);
        });
    });

    // ---- The records ----
    const outNodes = nodes.filter((n) => kept.has(n.id) && byId.get(n.id) === n).map((n) => {
        if (items.nodes.has(n.id)) {
            const whole = partClone(n);
            if (busy.has(n.id)) {
                const pa = Object.assign({}, whole.portAttrs && typeof whole.portAttrs === 'object' ? whole.portAttrs : {});
                [...busy.get(n.id)].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))).forEach((p) => { pa[p] = Object.assign({}, pa[p] || {}, { partUsed: true }); });
                whole.portAttrs = pa;
            }
            return whole;
        }
        const c = context.get(n.id);
        const out = {};
        PART_CONTEXT_KEYS.forEach((k) => { if (n[k] !== undefined) out[k] = partClone(n[k]); });
        if (n.host && kept.has(n.host)) out.host = n.host;
        if (n.portAttrs && typeof n.portAttrs === 'object') {
            const pa = {};
            c.facing.forEach((f) => { if (PORT_ID_RE.test(f) && Object.prototype.hasOwnProperty.call(n.portAttrs, f)) pa[f] = partClone(n.portAttrs[f]); });
            if (Object.keys(pa).length) out.portAttrs = pa;
        }
        out.interfaces = partRecs(n.interfaces).map((i) => {
            if (c.facing.has(i.id)) return partClone(i);
            if (typeof i.ip === 'string' && i.ip.trim()) { const o = { id: i.id }; if (i.name !== undefined) o.name = i.name; o.ip = i.ip; return o; }
            return null;
        }).filter(Boolean);
        return out;
    });
    const outLinks = keptLinks.map((l) => {
        if (items.links.has(l.id) || items.nodes.has(l.source) || items.nodes.has(l.target)) return partClone(l);
        const out = {};
        PART_CONTEXT_LINK_KEYS.forEach((k) => { if (l[k] !== undefined) out[k] = partClone(l[k]); });
        return out;
    });
    const outGroups = groups.filter((g) => keptGroups.has(g.id) && groupOf.get(g.id) === g).map(partClone);
    const outProviders = providers.filter((p) => Pset.has(p.id)).map((p) => { const c = partClone(p); delete c.notes; return c; });

    // Wi-Fi: named by a kept cable or broadcast by a kept radio.
    const wifiAll = partRecs(src.wifi);
    const wifiIds = new Set();
    outLinks.forEach((l) => { if (l.wifi && typeof l.wifi.ssid === 'string') wifiIds.add(l.wifi.ssid); });
    outNodes.forEach((n) => partRecs(n.interfaces).forEach((i) => {
        if (i.radio && typeof i.radio === 'object') { try { apSsids(i.radio, wifiAll).forEach((id) => wifiIds.add(id)); } catch (e) { /* an odd radio: none */ } }
    }));
    const outWifi = wifiAll.filter((w) => wifiIds.has(w.id)).map(partClone);
    // Subnets: holding a kept address, carrying a kept VLAN, or a kept Wi-Fi's.
    const networks = partRecs(src.networks);
    const netIds = new Set();
    const vlans = new Set();
    let allVlans = false;
    const addVlans = (v) => {
        if (v === undefined || v === null || v === '') return;
        const set = parseVlanList(v);
        if (!set) return;
        if (set.all) allVlans = true; else set.forEach((x) => vlans.add(x));
    };
    outNodes.forEach((n) => {
        partRecs(n.interfaces).forEach((i) => {
            if (typeof i.ip === 'string' && i.ip.trim()) {
                const c = parseValidCIDR(i.ip);
                const net = c && c.ip ? networkOfIp(c.ip, networks) : networkOfIp(i.ip.trim(), networks);
                if (net) netIds.add(net.id);
            }
            addVlans(i.vlan); addVlans(i.tagged);
        });
        if (n.portAttrs && typeof n.portAttrs === 'object') Object.values(n.portAttrs).forEach((a) => { if (a && typeof a === 'object') { addVlans(a.vlan); addVlans(a.tagged); } });
    });
    networks.forEach((net) => {
        const v = Number(net.vlan);
        if (Number.isInteger(v) && v > 0 && (allVlans || vlans.has(v))) netIds.add(net.id);
    });
    outWifi.forEach((w) => { if (w.network) netIds.add(w.network); });
    const outNetworks = networks.filter((n) => netIds.has(n.id)).map(partClone);
    // Custom columns the items use.
    const colIds = new Set();
    outNodes.forEach((n) => { if (items.nodes.has(n.id) && n.extra && typeof n.extra === 'object') Object.keys(n.extra).forEach((k) => colIds.add(k)); });
    const outColumns = partRecs(src.columns).filter((c) => colIds.has(c.id)).map(partClone);

    // Reports: routed to the chosen providers only, their visits only.
    const keptVisitIds = new Set();
    log.forEach((e) => { if (e.kind === 'visit' && Pset.has(e.providerId) && keptInc.has(e.incidentId)) keptVisitIds.add(e.id); });
    const outIncidents = incidents.map((inc) => {
        const c = partClone(inc);
        c.routedTo = partArr(inc.routedTo).filter((id) => Pset.has(id));
        c.visits = partArr(inc.visits).filter((id) => keptVisitIds.has(id));
        return c;
    });
    // The log: their reports' events and their visits, in order. From the
    // first entry dropped or changed on, the kept ones lose `prev`, to be
    // chained again (relinkLog, js/share.js) before the copy leaves.
    const keptRecIds = new Set([...kept, ...keptLinks.map((l) => l.id), ...keptGroups]);
    const outLog = [];
    let broken = false;
    log.forEach((e) => {
        let c = null;
        if (e.kind === 'incident' && keptInc.has(e.incidentId)) {
            c = partClone(e);
            if (Array.isArray(e.routedTo)) {
                const to = e.routedTo.filter((id) => Pset.has(id));
                if (to.length !== e.routedTo.length) {
                    if (to.length) c.routedTo = to; else delete c.routedTo;
                    if (typeof c.summary === 'string') c.summary = c.summary.replace(/ \(to \d+\)\.$/, to.length ? ` (to ${to.length}).` : '.');
                }
            }
        } else if (e.kind === 'visit' && keptVisitIds.has(e.id)) {
            c = partClone(e);
            if (c.changes && Array.isArray(c.changes.items)) {
                const its = c.changes.items.filter((x) => x && (!x.id || keptRecIds.has(x.id)));
                if (its.length !== c.changes.items.length) { if (its.length) c.changes.items = its; else delete c.changes.items; }
            }
        }
        const same = !!c && JSON.stringify(c) === JSON.stringify(e);
        if (!c || !same) broken = true;
        if (!c) return;
        if (broken) delete c.prev;
        outLog.push(c);
    });

    const report = {};
    if (src.report && typeof src.report === 'object') ['site', 'client'].forEach((k) => { if (typeof src.report[k] === 'string' && src.report[k]) report[k] = src.report[k]; });
    const out = { v: src.v };
    out.nodes = outNodes;
    out.links = outLinks;
    if (outNetworks.length) out.networks = outNetworks;
    if (outGroups.length) out.groups = outGroups;
    if (outWifi.length) out.wifi = outWifi;
    if (outProviders.length) out.providers = outProviders;
    if (src.expectedLife !== undefined) out.expectedLife = partClone(src.expectedLife);
    if (Object.keys(report).length) out.report = report;
    if (outColumns.length) out.columns = outColumns;
    if (outIncidents.length) out.incidents = outIncidents;
    if (outLog.length) out.log = outLog;
    const ctxGroups = new Set([...keptGroups].filter((id) => !items.groups.has(id)));
    return {
        whole: false, doc: out, providers: P, items, context, via, groups: keptGroups, contextGroups: ctxGroups,
        incidents: outIncidents.map((x) => x.id),
        counts: { items: items.nodes.size, context: context.size, links: outLinks.length, groups: keptGroups.size,
            leftOut: leftOut.size, busyPorts: [...busy.values()].reduce((s, x) => s + x.size, 0) }
    };
}

// The part of one provider, as that provider's copy holds it (the
// provider's report, js/providerreport.js later). On a part it gives the
// part again; on a whole network it computes it.
const partOfSelf = (doc, selfId) => providerPart(doc, [selfId]);

// "Andes IT" / "Andes IT and Fibra Norte" / "A, B and C": the chosen
// providers' names for the send step.
function partProviderNames(ids, providers = state.providers) {
    const names = partArr(ids).map((id) => providerById(id, providers)).filter(Boolean).map(providerLabel);
    if (names.length <= 1) return names.join('');
    return t('{list} and {last}', { list: names.slice(0, -1).join(', '), last: names[names.length - 1] });
}

// ---- The part as it leaves ----
// The open network's part for `providerIds` (opts.incidentId: the report
// being sent): canonical (as the provider's loader reads it), its log
// chained again and cut to a link's, kept here under a new revision held as
// 'part' with its context (js/revisions.js), and identified: the network's
// id and updated, that revision, and the network's own full revisions as
// base and prior, so a provider who holds an older full copy merges it
// three-way (D93). -> { doc, rev, part } or null (no part: the whole network).
async function partCopy(providerIds, opts = {}) {
    if (state.readOnly) throw new Error('A read-only document is not shared as a link.');
    const raw = serializeDoc();
    const part = providerPart(raw, providerIds, { incidentId: opts.incidentId || null });
    if (part.whole) return null;
    let canon = canonicalDoc(part.doc);
    canon = withLinkLog(await relinkLog(canon));
    const head = docIdentityHead();
    const kept = isKept() ? libraryEntry(state.libraryId) : null;
    const prior = kept ? [kept.rev, ...validPrior(kept.prior)].filter((r) => validRev(r))
        : [state.docRev, ...(state.docPrior || [])].filter((r) => validRev(r));
    const base = kept ? outgoingBase(state.libraryId, kept.doc, kept.base) : validRev(state.docBase);
    const rev = randomToken();
    const hash = revHashOf(canon, true);
    const ident = { rev, base, prior: [...new Set(prior)].slice(0, PRIOR_MAX) };
    const all = [];
    ['nodes', 'links', 'groups'].forEach((k) => partRecs(raw[k]).forEach((r) => { if (typeof r.id === 'string') all.push(r.id); }));
    // incidents and providers: what holds the part until it is answered
    // (heldParts, js/revisions.js, D176).
    const context = { nodes: [...part.context.keys()], groups: [...part.contextGroups], from: [base, ...ident.prior].filter((r) => validRev(r)), all,
        incidents: opts.incidentId ? [opts.incidentId] : [], providers: partArr(providerIds) };
    recordPartRevision(kept ? state.libraryId : null, rev, canon, hash, context);
    const { v, ...rest } = canon;
    const doc = Object.assign({ v, id: head.id, updated: head.updated }, revisionFields(ident), rest);
    return { doc, rev, part };
}

// ---- The merge back ----
// A copy coming back from a part, merged on card `cardId`: the part's
// context (devices and groups the provider only saw, so removing one is
// asked, never silent) and every record id a revision of the card ever
// held (a record the provider still has from an older full copy, that the
// client has deleted since, is not brought back). baseRev: the 'part'
// revision the merge is three-way against, or null (two-way).
// rev and incidents: the part it answers and the reports that part went out
// for, kept with the copy once merged (heldParts, D176). others: the
// devices, cables and groups another provider's copy, merged back after this
// part left, added: matched with a new record of this copy only by id, MAC or
// serial (mergePartPool, js/merge.js, D152.2, D177).
// providers: whom the part went to (whose copy this is: partCopyFrom).
// -> { nodes: Set, groups: Set, known: Set, rev, incidents: [], providers: [], others: Set }.
async function partMergeInfo(cardId, baseRev) {
    const meta = baseRev && typeof revisionPartMeta === 'function' ? revisionPartMeta(cardId, baseRev) : null;
    // The network as the part left (its ids), then every full revision's.
    const known = new Set(meta && Array.isArray(meta.all) ? meta.all : []);
    const metas = typeof revisionsOf === 'function' ? revisionsOf(cardId).filter((m) => m.why !== 'part') : [];
    for (const m of metas) {
        const d = await revisionDoc(cardId, m.rev);
        if (!d) continue;
        ['nodes', 'links', 'groups'].forEach((k) => partRecs(d[k]).forEach((r) => { if (typeof r.id === 'string') known.add(r.id); }));
    }
    const others = await partOthers(cardId, baseRev, meta);
    return { nodes: new Set(meta ? meta.nodes : []), groups: new Set(meta ? meta.groups : []), known,
        rev: baseRev || null, incidents: meta && Array.isArray(meta.incidents) ? meta.incidents.slice() : [],
        providers: meta && Array.isArray(meta.providers) ? meta.providers.slice() : [], others };
}
// Whose copy `theirs` is, merged back on a part (partMergeInfo's): the one
// provider the part went to; of several, the one whose visit entries are new
// in it (not in `mine`'s log), when only one's are. Else null (D179).
function partCopyFrom(part, theirs, mine) {
    const providers = part && Array.isArray(part.providers) ? part.providers.filter((x) => typeof x === 'string' && x) : [];
    if (providers.length === 1) return providers[0];
    if (!providers.length || !theirs || !Array.isArray(theirs.log)) return null;
    const had = new Set((mine && Array.isArray(mine.log) ? mine.log : []).map((e) => e && e.id).filter(Boolean));
    const who = new Set(theirs.log.filter((e) => e && e.kind === 'visit' && !had.has(e.id) && providers.includes(e.providerId)).map((e) => e.providerId));
    return who.size === 1 ? [...who][0] : null;
}
// What other providers' copies merged back since part `baseRev` left added:
// each copy's records less what its own part held when it left (its all) and
// less what this part held. Two-way (no base): every copy merged back.
async function partOthers(cardId, baseRev, meta) {
    const others = new Set();
    if (typeof revisionsOf !== 'function') return others;
    const recs = revisionsOf(cardId);
    const base = baseRev ? recs.find((m) => m.rev === baseRev) : null;
    const since = base ? base.at : 0;
    const card = typeof libraryEntry === 'function' ? libraryEntry(cardId) : null;
    const sent = new Set(card && Array.isArray(card.partRevs) ? card.partRevs : []);
    const ours = new Set(meta && Array.isArray(meta.all) ? meta.all : []);
    for (const m of recs) {
        if (m.why !== 'part' || m.rev === baseRev || !(m.at > since)) continue;
        if (!partIsBack(m, sent)) continue;
        const d = await revisionDoc(cardId, m.rev);
        if (!d) continue;
        const theirsHad = new Set(m.part && Array.isArray(m.part.all) ? m.part.all : []);
        ['nodes', 'links', 'groups'].forEach((k) => partRecs(d[k]).forEach((r) => {
            if (typeof r.id === 'string' && !ours.has(r.id) && !theirsHad.has(r.id)) others.add(r.id);
        }));
    }
    return others;
}

// Published for the suites (tests/suites/providerpart.js).
window.TopoPart = { PART_HOPS, PART_CONTEXT_KEYS, PART_CONTEXT_LINK_KEYS, providerPart, partOfSelf, partProviderNames, partCopy, partMergeInfo, partCopyFrom };
