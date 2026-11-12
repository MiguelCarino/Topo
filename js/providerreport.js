// ---- A provider's report: "Your part of this network" (docs/SCOPE.md D96) ----
// What one provider looks after here, on paper: the report a provider prints
// or saves in provider mode (and, later, the client's "Report for this
// provider" and the report attached to a problem's email: one builder).
//
//   providerReportModel(doc, providerId, opts)  the report's content, worked
//                                               out from the provider's part
//                                               (providerPart, js/providerpart.js)
//   providerReportHtml(model, image)            the sheet, a document of its own
//   openProviderReport(providerId, opts)        the diagram drawn, then the
//                                               sheet shown in the print preview
//                                               (openSheetPreview, js/sheetpreview.js):
//                                               Print, Download PDF or HTML
//   providerCsv(doc, providerId, which)         devices.csv / cables.csv of
//                                               their items, as Topo's own
//                                               export writes them, so the
//                                               importer reads them back
//
// opts: { incidentId (the problem at hand), audience: 'provider' (their own
// copy: "Your part of this network") | 'client' ("{name}'s part of this
// network") }.
//
// The sheet, top to bottom: the header (the site, the client, who reported
// the problem and how to reach them, the day, the provider's own record);
// this problem; their devices in full (model, serial, addresses, MAC, where,
// ports and VLANs, how they answer for it); the linked devices around them,
// reduced (hop 1, hop 2, the host they run on, where the problem is), with
// the ports facing their devices and their addresses; the cables, ports at
// both ends; a diagram of the part only; their other open problems and
// their past visits. Never a finding: findings worked out on a part would be
// false (a switch with its other cables cut off reads as nearly empty).
//
// The file is named as every download (reportFileName): topo_<org>_<site>_
// <date>_<provider>.pdf or .html. It goes through the sheet preview on the
// Locate sheet's paper (A4, 16 mm by 14 mm), registered here under the
// provider's name (providerSheetKind). Without the PDF engine the preview
// offers the HTML only (reportFormat, js/report.js).
//
// Translated: the provider and the client both read it.

const PROVIDER_REPORT_DIAGRAM_BASE = 2;   // pixels per drawing unit, as a binder's sites
const PROVIDER_REPORT_KINDS_TAKEN = new Set(['labels', 'locate']);

// The device ids of the part that are theirs, in the network's order.
const prItems = (part, doc) => (Array.isArray(doc.nodes) ? doc.nodes : []).filter((n) => n && part.items.nodes.has(n.id));

// The sheet's header: the site and the client the part carries, else the
// network's own name; the day it is printed.
function providerReportMeta(doc) {
    const r = (doc && doc.report) || {};
    const site = (typeof r.site === 'string' && r.site.trim()) || (typeof docDisplayName === 'function' ? docDisplayName() : '') || '';
    const client = (typeof r.client === 'string' && r.client.trim()) || '';
    // The file is named as the network's other files (docFileStem, the site
    // report): the kept card's name first; the sheet shows the report's site.
    const fileSite = (typeof keptSiteName === 'function' ? keptSiteName() : '') || site;
    return { site, client, date: todayISO(), fileSite };
}

// The preview's kind, which names the file: the provider's name. Registered
// as a sheet on the Locate paper; a name the preview already uses for
// another paper (or one an object already answers to) gets a trailing space,
// which the file name's slug drops (fileSlug).
function providerSheetKind(name) {
    let kind = String(name || '').trim() || t('Provider');
    while ((PROVIDER_REPORT_KINDS_TAKEN.has(kind) || (kind in SHEET_PREVIEW && !Object.prototype.hasOwnProperty.call(SHEET_PREVIEW, kind))
        || (Object.prototype.hasOwnProperty.call(SHEET_PREVIEW, kind) && SHEET_PREVIEW[kind] !== SHEET_PREVIEW.locate))) kind += ' ';
    SHEET_PREVIEW[kind] = SHEET_PREVIEW.locate;
    return kind;
}

// "Through the group Server room" and the like: how the provider answers for
// an item. part.via says own / host / group; the host or the group is the
// nearest one naming them.
function providerViaText(node, providerId, via) {
    if (via === 'host') {
        const seen = new Set([node.id]);
        for (let h = hostOf(node); h && !seen.has(h.id); h = hostOf(h)) {
            seen.add(h.id);
            if ((h.providers || []).includes(providerId)) return t('Through its host {name}', { name: h.name || h.id });
        }
        return t('Through its host');
    }
    if (via === 'group') {
        const g = (groupOfNode(node) ? groupChain(groupOfNode(node)) : []).slice().reverse().find((x) => (x.providers || []).includes(providerId));
        return g ? t('Through the group {name}', { name: groupLabel(g) }) : t('Through its group');
    }
    return t('Named on it');
}

// A faceplate port reads "Port 3", not a bare "3"; a named interface as it is.
const prPort = (label) => (/^\d+$/.test(String(label || '')) ? `${t('Port')} ${label}` : String(label || ''));

const PR_HOP_WORD = { 1: 'Hop 1', 2: 'Hop 2' };
// What a linked device is to them: a hop, a host their devices run on, or
// where the problem is (a device a kept report names off their way). Hop 1
// and Hop 2: the first and second device on their way to the network (D363).
function providerContextRole(c) {
    if (c.hop === 1 || c.hop === 2) return { key: `hop${c.hop}`, text: t(PR_HOP_WORD[c.hop]) };
    if (c.why.has('host')) return { key: 'host', text: t('Runs their devices') };
    return { key: 'problem', text: t('Where the problem is') };
}

// -> the model, or null when the network does not hold the provider.
// Worked out on the part, with the part as the open document (withDoc), so
// every name and port reads as the provider's copy reads it.
// providerId: one provider, or several (an array: the report attached to a
// problem sent to more than one, D97): their part together, each device
// saying which of them answers for it.
function providerReportModel(doc, providerId, opts = {}) {
    const src = doc || serializeDoc();
    const ids = (Array.isArray(providerId) ? providerId : [providerId]).filter((x) => typeof x === 'string' && x);
    if (!ids.length) return null;
    const part = providerPart(src, ids, { incidentId: opts.incidentId || null });
    if (part.whole) return null;
    providerId = part.providers.length ? part.providers[0] : ids[0];
    const multi = part.providers.length > 1;
    const audience = opts.audience === 'client' ? 'client' : 'provider';
    const meta = providerReportMeta(src);
    return withDoc(part.doc, () => {
        const p = providerById(providerId) || { id: providerId };
        const recs = (multi ? part.providers : [providerId]).map((id) => providerById(id) || { id });
        const name = multi ? partProviderNames(part.providers) : providerLabel(p);
        // Which of them answers for a device, and how: the first that names
        // it (its own, its host, its group), else the group that brought it.
        const answer = (n) => {
            if (!multi) return providerViaText(n, providerId, part.via.get(n.id));
            const r = nodeProviders(n).find((x) => part.providers.includes(x.provider.id));
            const pid = r ? r.provider.id : providerId;
            return `${providerLabel(providerById(pid) || { id: pid })}: ${providerViaText(n, pid, r ? r.via : part.via.get(n.id))}`;
        };
        const items = state.nodes.filter((n) => part.items.nodes.has(n.id));
        const portMaps = new Map(reportPortMaps().map((m) => [m.id, m]));
        const devices = items.map((n) => {
            const map = portMaps.get(n.id);
            const ifaces = (n.interfaces || []).map((i) => ({
                name: i.name || i.id,
                ip: typeof i.ip === 'string' ? i.ip.trim() : '',
                mac: !isBlank(i.mac) ? fmtColonSafe(i.mac) : '',
                vlan: i.vlan === undefined || i.vlan === null || i.vlan === '' ? '' : String(i.vlan),
                tagged: i.tagged === undefined || i.tagged === null || i.tagged === '' ? '' : String(i.tagged)
            }));
            const g = groupOfNode(n);
            const host = hostOf(n);
            return {
                id: n.id, name: n.name || n.id, typeName: t(typeName(n.type)), status: n.status ? statusName(n.status) : '',
                model: [n.vendor, n.model].filter((v) => !isBlank(v)).map((v) => String(v).trim()).join(' '),
                serial: asText(n.serial).trim(), assetTag: asText(n.assetTag).trim(), os: asText(n.os).trim(),
                group: g ? groupPath(g) : '', rack: rackSpanText(n), location: asText(n.location).trim(),
                host: host ? host.name || host.id : '',
                via: answer(n),
                interfaces: ifaces,
                ports: map ? map.rows.filter((r) => !r.free || r.portLabel || r.vlan !== null || r.tagged !== null).map((r) => ({
                    label: prPort(r.label), portLabel: r.portLabel || '', free: !!r.free,
                    peer: r.peer || '', peerIface: prPort(r.peerIface || ''),
                    vlan: r.vlan === null ? '' : String(r.vlan), tagged: r.tagged === null || r.tagged === undefined ? '' : String(r.tagged),
                    poe: r.poe === null || r.poe === undefined ? '' : poeText(r.poe)
                })) : [],
                portsUsed: map ? t(map.total === 1 ? '{used} of {total} port used' : '{used} of {total} ports used', { used: map.used, total: map.total }) : '',
                upkeep: reportUpkeepOf(n, todayISO()),
                notes: asText(n.notes).trim()
            };
        });
        // The linked devices, in the network's order: hop 1 first, then hop 2,
        // then the hosts, then where the problem is.
        const roleRank = { hop1: 0, hop2: 1, host: 2, problem: 3 };
        const context = state.nodes.filter((n) => part.context.has(n.id)).map((n) => {
            const c = part.context.get(n.id);
            const role = providerContextRole(c);
            const facing = state.links.filter((l) => l.source === n.id || l.target === n.id).map((l) => {
                const mine = l.source === n.id ? l.sourceIface : l.targetIface;
                const peerId = l.source === n.id ? l.target : l.source;
                const peerIface = l.source === n.id ? l.targetIface : l.sourceIface;
                const peer = getNode(peerId);
                if (!peer) return null;
                return { port: mine ? prPort(ifaceLabel(n, mine)) : '', peer: peer.name || peer.id, peerIface: peerIface ? prPort(ifaceLabel(peer, peerIface)) : '',
                    theirs: part.items.nodes.has(peerId) };
            }).filter(Boolean).sort((a, b) => (b.theirs - a.theirs));
            return {
                id: n.id, name: n.name || n.id, typeName: t(typeName(n.type)), role: role.key, roleText: role.text,
                facing, addresses: (n.interfaces || []).map((i) => (typeof i.ip === 'string' ? i.ip.trim() : '')).filter(Boolean)
            };
        }).sort((a, b) => roleRank[a.role] - roleRank[b.role]);
        const cables = state.links.map((l) => {
            const a = getNode(l.source), b = getNode(l.target);
            if (!a || !b) return null;
            return {
                id: l.id, from: a.name || a.id, fromIface: l.sourceIface ? prPort(ifaceLabel(a, l.sourceIface)) : '',
                to: b.name || b.id, toIface: l.targetIface ? prPort(ifaceLabel(b, l.targetIface)) : '',
                medium: t(mediumName(effectiveMedium(l))),
                facts: [cableOf(l, 'label'), cableOf(l, 'length'), cableOf(l, 'color'), cableOf(l, 'via')].map((v) => String(v || '').trim()).filter(Boolean),
                theirs: part.items.links.has(l.id) || part.items.nodes.has(l.source) || part.items.nodes.has(l.target)
            };
        }).filter(Boolean).sort((x, y) => (y.theirs - x.theirs));
        // The problem at hand, then their other open problems; their visits.
        const incOf = (inc) => ({
            id: inc.id, symptom: `${INCIDENT_SYMPTOM_GLYPH[inc.symptom] || '⚠'} ${symptomLabel(inc.symptom)}`,
            where: incidentWhereText(inc), at: inc.at ? localDateOf(inc.at) : '', status: incidentStatusText(inc),
            reporter: inc.reporter ? { name: inc.reporter.name || '', phone: inc.reporter.phone || '', email: inc.reporter.email || '' } : null,
            text: inc.text || ''
        });
        const incs = Array.isArray(state.incidents) ? state.incidents : [];
        const here = opts.incidentId ? incs.find((x) => x.id === opts.incidentId) : null;
        const problems = incs.filter((x) => x !== here && x.status !== 'closed').map(incOf);
        const visits = (state.log || []).filter((e) => e && e.kind === 'visit' && part.providers.includes(e.providerId))
            .slice().sort((x, y) => (y.at || 0) - (x.at || 0))
            .map((e) => ({ line: typeof visitLineText === 'function' ? visitLineText(e) : (e.summary || ''), notes: e.notes || '' }));
        const record = (x) => ({
            name: providerLabel(x), service: providerServiceLabel(x.service), contact: x.contact || '', phone: x.phone || '', email: x.email || '',
            account: x.account || '', hours: x.hours || ''
        });
        return {
            audience, providerId, providerIds: part.providers.slice(), name,
            // The file name's last part: their names, one after the other.
            fileKind: recs.map(providerLabel).join(' '),
            title: audience === 'provider' ? t('Your part of this network')
                : multi ? t('The part of this network {names} look after', { names: name }) : t('{name}\'s part of this network', { name }),
            meta,
            provider: Object.assign(record(p), { name }),
            providers: recs.map(record),
            incident: here ? incOf(here) : null,
            devices, context, cables, problems, visits,
            counts: { devices: devices.length, context: context.length, cables: cables.length }
        };
    });
}

// The sheet. Phone-first: no table, so nothing is wider than a phone; each
// block (.dev-block) stays whole on paper and the preview counts the pages
// by them (measureSheetPreview, js/sheetpreview.js).
function providerReportHtml(model, image = null, monitoring = null) {
    const esc = escapeHtml;
    const m = model;
    const kv = (label, value, mono = false) => (value ? `<div><dt>${esc(label)}</dt><dd${mono ? ' class="mono"' : ''}>${esc(value)}</dd></div>` : '');
    const section = (cls, title, body, lead = '') => `<section class="part ${cls}"><h2>${esc(title)}</h2>${lead ? `<p class="dim">${esc(lead)}</p>` : ''}${body}</section>`;
    const pv = m.provider;
    const sub = [m.meta.site, m.meta.client, m.meta.date].filter(Boolean).join(' · ');
    const who = m.incident && m.incident.reporter && (m.incident.reporter.name || m.incident.reporter.phone || m.incident.reporter.email)
        ? [m.incident.reporter.name, m.incident.reporter.phone, m.incident.reporter.email].filter(Boolean).join(' · ') : '';
    const head = `<header class="dev-block"><h1>${esc(m.title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
${(m.providers && m.providers.length > 1 ? m.providers : [pv]).map((x, i, all) => `<dl class="facts">${kv(t('Provider'), x.name)}${kv(t('Service'), x.service)}${kv(t('Contact person'), x.contact)}${kv(t('Phone'), x.phone, true)}${kv(t('Email'), x.email, true)}${kv(t('Account / contract'), x.account)}${kv(t('Support hours / SLA'), x.hours)}${i === all.length - 1 ? kv(t('Client contact'), who) : ''}</dl>`).join('')}
<p class="count">${esc(t(m.counts.devices === 1 ? '1 device of theirs' : '{n} devices of theirs', { n: m.counts.devices }))} · ${esc(t(m.counts.context === 1 ? '1 linked device' : '{n} linked devices', { n: m.counts.context }))} · ${esc(t(m.counts.cables === 1 ? '1 cable' : '{n} cables', { n: m.counts.cables }))}</p></header>`;
    const incBlock = (x, full) => `<div class="dev-block inc"><h3>${esc(x.symptom)}</h3><dl class="facts">${kv(t('Where?'), x.where)}${kv(t('Reported on'), x.at)}${kv(t('Status'), x.status)}${full && x.reporter ? kv(t('Reported by'), [x.reporter.name, x.reporter.phone, x.reporter.email].filter(Boolean).join(' · ')) : ''}</dl>${full && x.text ? `<blockquote>${esc(x.text)}</blockquote>` : ''}</div>`;
    const problem = m.incident ? section('problem', t('This problem'), incBlock(m.incident, true)) : '';
    const ifaceLine = (i) => `<li><b>${esc(i.name)}</b>${[i.ip, i.mac].filter(Boolean).map((v) => ` <span class="mono">${esc(v)}</span>`).join('')}${i.vlan ? ` <span class="dim">VLAN ${esc(i.vlan)}</span>` : ''}${i.tagged ? ` <span class="dim">${esc(t('Tagged'))} ${esc(i.tagged)}</span>` : ''}</li>`;
    const portLine = (r) => `<li><b class="mono">${esc(r.label)}</b>${r.portLabel ? ` ${esc(r.portLabel)}` : ''}${r.free ? ` <span class="dim">${esc(t('Free'))}</span>` : ` → ${esc(r.peer)}${r.peerIface ? ` <span class="mono dim">${esc(r.peerIface)}</span>` : ''}`}${r.vlan ? ` <span class="dim">VLAN ${esc(r.vlan)}</span>` : ''}${r.tagged ? ` <span class="dim">${esc(t('Tagged'))} ${esc(r.tagged)}</span>` : ''}${r.poe ? ` <span class="dim">PoE ${esc(r.poe)}</span>` : ''}</li>`;
    const devBlock = (d) => `<div class="dev-block dev"><h3>${esc(d.name)} <span class="dim">· ${esc(d.typeName)}${d.status ? ` · ${esc(d.status)}` : ''}</span></h3>
<p class="via">${esc(d.via)}</p>
<dl class="facts">${kv(t('Model'), d.model)}${kv(t('Serial number'), d.serial, true)}${kv(t('Asset tag'), d.assetTag, true)}${kv(t('Operating system'), d.os)}${kv(t('Group'), d.group)}${kv(t('Rack'), d.rack)}${kv(t('Location'), d.location)}${kv(t('Runs on'), d.host)}${kv(t('Upkeep'), d.upkeep)}</dl>
${d.interfaces.length ? `<h4>${esc(t('Interfaces'))}</h4><ul class="lines">${d.interfaces.map(ifaceLine).join('')}</ul>` : ''}
${d.ports.length || d.portsUsed ? `<h4>${esc(t('Ports and VLANs'))}${d.portsUsed ? ` <span class="dim">· ${esc(d.portsUsed)}</span>` : ''}</h4>${d.ports.length ? `<ul class="lines">${d.ports.map(portLine).join('')}</ul>` : ''}` : ''}
${d.notes ? `<p class="notes">${esc(d.notes)}</p>` : ''}</div>`;
    const devices = section('devices', t('Their devices'), m.devices.length ? m.devices.map(devBlock).join('') : `<p class="dim">${esc(t('Nothing here names them yet.'))}</p>`);
    const ctxBlock = (c) => `<div class="dev-block ctx"><h3>${esc(c.name)} <span class="dim">· ${esc(c.typeName)}</span> <span class="hop hop-${esc(c.role)}">${esc(c.roleText)}</span></h3>
${c.addresses.length ? `<p class="mono">${c.addresses.map(esc).join(' · ')}</p>` : ''}
${c.facing.length ? `<ul class="lines">${c.facing.map((f) => `<li>${f.port ? `<b class="mono">${esc(f.port)}</b> ` : ''}→ ${esc(f.peer)}${f.peerIface ? ` <span class="mono dim">${esc(f.peerIface)}</span>` : ''}</li>`).join('')}</ul>` : ''}</div>`;
    const context = m.context.length ? section('linked', t('Linked devices'), m.context.map(ctxBlock).join(''),
        t('The devices around theirs, up to two cables away, the hosts they run on and where the problem is: their names, the ports facing them and their addresses only.')) : '';
    const cabLine = (c) => `<li${c.theirs ? '' : ' class="dim"'}><b>${esc(c.from)}</b>${c.fromIface ? ` <span class="mono">${esc(c.fromIface)}</span>` : ''} ↔ <b>${esc(c.to)}</b>${c.toIface ? ` <span class="mono">${esc(c.toIface)}</span>` : ''} <span class="dim">· ${esc(c.medium)}${c.facts.length ? ` · ${esc(c.facts.join(' · '))}` : ''}</span></li>`;
    const cables = m.cables.length ? section('cables', t('Cables'), `<div class="dev-block"><ul class="lines">${m.cables.map(cabLine).join('')}</ul></div>`) : '';
    const diagram = image && image.url ? section('diagram', t('Diagram'), `<div class="dev-block figure"><img src="${image.url}" alt="${esc(t('Diagram of their part of the network'))}"></div>`) : '';
    const others = m.problems.length ? section('problems', t('Open problems on their devices'), m.problems.map((x) => incBlock(x, false)).join('')) : '';
    // Their monitoring section (js/reports.js, step 7j): availability against
    // their target, response times and outages, since their last visit.
    const mon = monitoring && window.TopoReports ? section('monitoring', t('Monitoring'), `<div class="dev-block">${TopoReports.providerSectionHtml(monitoring)}</div>`) : '';
    const visits = m.visits.length ? section('visits', t('Their past visits'), `<div class="dev-block"><ul class="lines">${m.visits.map((v) => `<li>${esc(v.line)}${v.notes ? `<br><span class="dim">${esc(v.notes)}</span>` : ''}</li>`).join('')}</ul></div>`) : '';
    const blurb = m.audience === 'provider'
        ? t('What you look after here, the devices around it and this problem. Keep it with your own records.')
        : (m.providers && m.providers.length > 1) ? t('What {name} look after here, the devices around it and their problems.', { name: m.name })
            : t('What {name} looks after here, the devices around it and their problems.', { name: m.name });
    return `<!doctype html><html lang="${esc(document.documentElement.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)}</title><style>
@page { size: A4; margin: 16mm 14mm; }
:root { color-scheme: light dark; --bg: #f3f4f6; --card: #fff; --text: #111; --dim: #4b5563; --rule: #d1d5db; --mark: #1d4ed8; }
@media (prefers-color-scheme: dark) { :root { --bg: #111318; --card: #1b1e25; --text: #f3f4f6; --dim: #a1a7b3; --rule: #3a3f4b; --mark: #93b4ff; } }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.4; color: var(--text); background: var(--bg); overflow-wrap: anywhere; }
.toolbar { padding: 10px 16px; font-size: 13px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.sheet { display: flex; flex-direction: column; gap: 12px; padding: 0 16px 16px; max-width: 900px; }
.dev-block { background: var(--card); border: 1px solid var(--rule); border-radius: 8px; padding: 10px 14px; break-inside: avoid; page-break-inside: avoid; }
.part { display: flex; flex-direction: column; gap: 8px; }
h1 { font-size: 20px; margin: 0 0 2px; } .sub { margin: 0 0 8px; color: var(--dim); }
h2 { font-size: 16px; margin: 8px 0 0; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 15px; margin: 0 0 4px; } h4 { font-size: 13px; margin: 8px 0 2px; }
.facts { margin: 4px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px 14px; }
.facts div { min-width: 0; } dt { font-size: 11.5px; color: var(--dim); } dd { margin: 0; }
.count { margin: 8px 0 0; color: var(--dim); font-size: 13px; }
.via { margin: 0 0 4px; color: var(--mark); font-size: 13px; }
.lines { list-style: none; margin: 2px 0 0; padding: 0 0 0 10px; border-left: 2px solid var(--rule); }
.lines li { padding: 2px 0; }
.mono { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 12.5px; }
.dim { color: var(--dim); }
.hop { display: inline-block; font-size: 11.5px; font-weight: 600; border: 1px solid var(--rule); border-radius: 999px; padding: 0 8px; vertical-align: 1px; }
.hop-problem { border-color: #b45309; color: #b45309; }
.facts + .facts { border-top: 1px solid var(--rule); padding-top: 6px; margin-top: 8px; }
.notes { margin: 6px 0 0; white-space: pre-wrap; }
blockquote { margin: 6px 0 0; padding: 4px 10px; border-left: 3px solid var(--mark); white-space: pre-wrap; }
.figure img { display: block; max-width: 100%; max-height: 230mm; height: auto; margin: 0 auto; }
@media print {
  :root { --bg: #fff; --card: #fff; --text: #000; --dim: #333; --rule: #999; --mark: #1d4ed8; color-scheme: light; }
  body { background: #fff; color: #000; font-size: 10.5pt; } .toolbar { display: none; }
  .sheet { padding: 0; max-width: none; }
  .dev-block { border: 0; border-bottom: 1px solid #999; border-radius: 0; padding: 6pt 0; }
}
</style></head><body>
<div class="toolbar"><span>${esc(blurb)}</span></div>
<div class="sheet">${head}${problem}${devices}${mon}${context}${cables}${diagram}${others}${visits}</div></body></html>`;
}

// The diagram of the part, drawn on the canvas (withDocRendered, js/report.js)
// before the preview opens: never while it is open, which would borrow the
// canvas under it. null when it cannot be drawn: the sheet goes without.
async function providerReportImage(partDoc) {
    try { return await withDocRendered(partDoc, () => captureReportDiagram(todayISO(), PROVIDER_REPORT_DIAGRAM_BASE)); }
    catch (e) { console.warn('Provider report: could not draw the diagram; continuing without it.', e); return null; }
}

// Their monitoring section's figures, or null (no check on their devices, or
// no reports here); never a reason for the report itself to fail.
async function providerMonitoringOf(doc, ids) {
    if (!window.TopoReports) return null;
    try { return await TopoReports.providerMonitoring(doc, ids); }
    catch (e) { console.warn('Provider report: the monitoring section could not be made; continuing without it.', e); return null; }
}

// The report shown in the print preview. opts: { doc (default the open
// network), incidentId, audience }. -> what openSheetPreview returns, with
// the model; null (and a toast) when the network does not name them.
async function openProviderReport(providerId, opts = {}) {
    const doc = opts.doc || serializeDoc();
    // One provider, or several (the recipients of a problem, D365).
    const ids = Array.isArray(providerId) ? providerId : [providerId];
    const part = providerPart(doc, ids, { incidentId: opts.incidentId || null });
    if (part.whole) { showToast(t('This network does not name that provider.'), 'err'); return null; }
    const image = await providerReportImage(part.doc);
    const first = providerReportModel(doc, providerId, opts);
    if (!first) return null;
    const monitoring = await providerMonitoringOf(doc, ids);
    const kind = providerSheetKind(first.name);
    let model = first;
    // opts.onClose: called once the preview is closed (the problem sheet comes back, D401).
    const out = openSheetPreview({ kind, meta: first.meta, onClose: opts.onClose, build: () => {
        model = providerReportModel(doc, providerId, opts) || model;
        return providerReportHtml(model, image, monitoring);
    } });
    return Object.assign({ model, image, monitoring }, out);
}

// The report as a file, without the preview: what a problem's email carries
// (D97). providerIds: one or several (their part together). opts: { doc,
// incidentId, audience (default 'client'), format: 'pdf' | 'html' (default
// reportFormat(); a PDF that cannot be made, or no PDF engine, gives the
// HTML) }. The diagram borrows the canvas: call it on a press, never while a
// map pick is on. -> { blob, name, type, format, bytes, model } or null.
async function providerReportFile(providerIds, opts = {}) {
    const ids = (Array.isArray(providerIds) ? providerIds : [providerIds]).filter(Boolean);
    const doc = opts.doc || serializeDoc();
    const part = providerPart(doc, ids, { incidentId: opts.incidentId || null });
    if (part.whole) return null;
    const image = await providerReportImage(part.doc);
    const model = providerReportModel(doc, ids, { incidentId: opts.incidentId || null, audience: opts.audience || 'client' });
    if (!model) return null;
    const monitoring = await providerMonitoringOf(doc, ids);
    const html = providerReportHtml(model, image, monitoring);
    let format = opts.format === 'html' || opts.format === 'pdf' ? opts.format : reportFormat();
    let blob = null;
    if (format === 'pdf') {
        // Without the toolbar: paper never shows it. (It has no Print button:
        // an inline handler is refused by the page's CSP when the PDF engine
        // lays the sheet out in the preview, and Firefox says so in the
        // console. The preview has its own Print; a saved file prints with
        // the browser's.)
        try { blob = await makeReportPdf(html.replace(/<div class="toolbar">[\s\S]*?<\/div>/, '')); }
        catch (e) { console.warn('Provider report: no PDF in this browser; the HTML instead.', e); blob = null; }
        if (!blob) format = 'html';
    }
    if (!blob) blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    return { blob, name: reportFileName(model.meta, model.fileKind, format), type: format === 'pdf' ? 'application/pdf' : 'text/html', format, bytes: blob.size, model };
}

// ---- Their items as spreadsheets ----
// devices.csv and cables.csv as Topo's own export writes them (csvDevicesSheet,
// csvCablesSheet, js/csv.js), worked out on the part and cut to their items:
// their devices; the cables they answer for and every cable at one of their
// devices; without the provider columns (below). Imported into the network
// (or into the part), they plan no change.
// -> { text, name, rows } or null.
function providerCsv(doc, providerId, which) {
    const src = doc || serializeDoc();
    const part = providerPart(src, [providerId], {});
    if (part.whole) return null;
    const meta = providerReportMeta(src);
    const p = (Array.isArray(src.providers) ? src.providers : []).find((x) => x && x.id === providerId);
    const name = providerLabel(p);
    const sheet = withDoc(part.doc, () => {
        if (which === 'cables') {
            const s = csvCablesSheet();
            const idAt = s.headers.indexOf('cable_id');
            s.rows = s.rows.filter((r) => { const l = getLink(r[idAt]); return !!l && (part.items.links.has(l.id) || part.items.nodes.has(l.source) || part.items.nodes.has(l.target)); });
            return s;
        }
        const s = csvDevicesSheet();
        const idAt = s.headers.indexOf('id');
        s.rows = s.rows.filter((r) => part.items.nodes.has(r[idAt]));
        return s;
    });
    // The provider columns go: the part names only this provider, so a
    // column read back would take every other provider off the network's
    // devices and cables.
    const drop = new Set(['provider', 'cable_provider']);
    const keep = sheet.headers.map((h, i) => (drop.has(h) ? -1 : i)).filter((i) => i >= 0);
    sheet.headers = keep.map((i) => sheet.headers[i]);
    sheet.rows = sheet.rows.map((r) => keep.map((i) => r[i]));
    // The sheet's word stays English in every language, as the network's own
    // devices.csv and cables.csv (FEATURES, File names): the file is named
    // the same whoever downloads it.
    const kind = `${name} ${which === 'cables' ? 'cables' : 'devices'}`;
    return { text: CSV_BOM + csvText(sheet, ','), name: topoFileName({ org: meta.client, site: meta.fileSite || meta.site, date: meta.date, kind }, 'csv'), rows: sheet.rows.length };
}
function downloadProviderCsv(providerId, which, doc = null) {
    const out = providerCsv(doc, providerId, which);
    if (!out) { showToast(t('This network does not name that provider.'), 'err'); return null; }
    out.url = saveBlob(new Blob([out.text], { type: 'text/csv;charset=utf-8' }), out.name);
    return out;
}

// Published for tests/suites/providerreport.js.
window.TopoProviderReport = {
    providerReportModel, providerReportHtml, providerReportMeta, providerSheetKind, providerViaText, providerContextRole,
    providerReportImage, openProviderReport, providerReportFile, providerCsv, downloadProviderCsv
};
