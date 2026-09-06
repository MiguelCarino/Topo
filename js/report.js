// The engagement deliverable: everything on the canvas, as a document someone
// can hand to a hospital's director and keep in a file.
//
// The diagram was always exportable; the findings never were. Every check in
// diagnostics.js already computes the sentence a consultant would write by
// hand — this file only collects them, adds the inventory the diagram implies,
// and lays the result out for paper. No new analysis lives here, deliberately:
// if the report and the Diagnostics panel ever disagree, one of them is lying.
//
// The document is standalone by construction — one HTML file with its styles
// inline and the diagram embedded as a data URI — so it survives being emailed,
// archived or opened on a machine that has never heard of this tool. Printing
// it to PDF is the browser's job, which is why there is no PDF library here.
//
// Load order: state -> i18n -> model -> data -> diagnostics -> ui -> report -> app

// ---- Metadata ----
// Who the survey was for, and who signed it. Held on the document rather than in
// settings so it rides the share URL and the .nettopo file: one link is then the
// whole engagement, not just the picture.
const REPORT_FIELDS = [
    { key: 'site', label: 'Site', placeholder: 'Hospital San José — Torre B' },
    { key: 'client', label: 'Client', placeholder: 'Grupo Médico del Norte, S.A. de C.V.' },
    { key: 'engineer', label: 'Prepared by', placeholder: 'Miguel Carino — Carino Systems' },
    { key: 'ref', label: 'Reference', placeholder: 'CS-2026-014' },
    { key: 'date', label: 'Date', placeholder: '' },
    { key: 'scope', label: 'Scope & notes', placeholder: 'What was surveyed, what was not, and anything the reader needs to know.', multiline: true }
];

const todayISO = () => new Date().toISOString().slice(0, 10);

function normalizeReportMeta(meta) {
    const m = meta || {};
    const out = {};
    REPORT_FIELDS.forEach(({ key }) => { out[key] = typeof m[key] === 'string' ? m[key] : ''; });
    if (!out.date) out.date = todayISO();
    return out;
}

// A document that has never had the dialog opened must serialize as if this
// feature did not exist — same trick annotations use, so untouched diagrams stay
// byte-identical in the URL hash.
function serializeReportMeta(meta) {
    if (!meta) return undefined;
    const kept = {};
    REPORT_FIELDS.forEach(({ key }) => { if (meta[key]) kept[key] = meta[key]; });
    return Object.keys(kept).length ? kept : undefined;
}

// ---- Vocabulary ----
// paletteDefs is the one place a type gets a human name; reading it here means a
// new device type appears in the inventory without being registered twice.
const NODE_TYPE_NAMES = Object.fromEntries(paletteDefs.map((d) => [d.type, d.name]));
const typeName = (type) => NODE_TYPE_NAMES[type] || type || 'Unknown';

const MEDIUM_NAMES = { utp: 'UTP copper', fiber: 'Fibre optic', wireless: 'Wireless', powerline: 'Powerline', vpn: 'VPN tunnel' };
const mediumName = (m) => MEDIUM_NAMES[m] || m || 'Unspecified';

const SEVERITY_NAMES = { bad: 'Critical', warn: 'Advisory' };

// A finding's detail is written to follow its panel prefix ("L2 loop: the link
// between …"), so on its own in a table cell it starts mid-sentence. Only the
// first letter moves, and only for display — the panel keeps its own wording.
const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---- The model ----
// Pure: no DOM, no formatting. The tests assert against this rather than against
// the rendered HTML, so a layout change cannot quietly break the content.

// Faceplate usage, counted the way evaluatePorts() counts it — sockets only, so
// an AP's wireless clients are not reported as cables in a port.
function portUsage(node) {
    if (!hasPortGrid(node)) return null;
    const total = portCountOf(node);
    const used = new Set(linksAtNode(node.id)
        .map((l) => ifaceIdOn(l, node.id))
        .filter((id) => /^p\d+$/.test(id))).size;
    return { used, total };
}

function reportInterface(node, iface) {
    const api = window.CarinoOUI;
    const decoded = hasMac(iface) && api ? api.decodeMac(iface.mac) : null;
    return {
        name: iface.name || iface.id,
        ip: iface.ip || '',
        mac: decoded && !decoded.error ? api.fmtColon(decoded.hex) : '',
        vendor: decoded && decoded.vendor && decoded.vendor.vendor ? decoded.vendor.vendor : '',
        wireless: ifaceIsWireless(iface),
        bond: isBond(iface) ? (BOND_MODES[iface.bond.mode] || iface.bond.mode) : '',
        member: isBondMember(node, iface.id)
    };
}

function reportDevices() {
    return state.nodes.map((node) => ({
        name: node.name || node.id,
        type: node.type,
        typeName: typeName(node.type),
        severity: nodeSeverity(node),
        // Explicit interfaces only. A 24-port switch would otherwise contribute
        // 24 blank rows to the inventory, which is noise, not documentation —
        // the faceplate is reported as a count instead.
        interfaces: (node.interfaces || []).map((iface) => reportInterface(node, iface)),
        ports: portUsage(node),
        gw: node.gw || '',
        dns: node.dns || '',
        os: node.os || '',
        allowedPorts: node.ports || '',
        nat: !!node.nat,
        notes: node.notes || ''
    }));
}

function reportConnections() {
    return state.links.map((link) => {
        const src = getNode(link.source), tgt = getNode(link.target);
        return {
            from: src ? (src.name || src.id) : '—',
            fromIface: src ? ifaceLabel(src, link.sourceIface) : '—',
            to: tgt ? (tgt.name || tgt.id) : '—',
            toIface: tgt ? ifaceLabel(tgt, link.targetIface) : '—',
            medium: mediumName(effectiveMedium(link))
        };
    }).filter((c) => c.from !== '—' && c.to !== '—');
}

// One row per broadcast domain the addressing implies. This is the table an
// auditor asks for and the one nobody has written down.
function reportSubnets() {
    const byNet = new Map();
    state.nodes.forEach((node) => {
        getValidIps(node).forEach((parsed) => {
            if (!byNet.has(parsed.networkStr)) {
                byNet.set(parsed.networkStr, { network: parsed.networkStr, kind: parsed.kind, isPrivate: parsed.isPrivate, devices: [] });
            }
            const entry = byNet.get(parsed.networkStr);
            const name = node.name || node.id;
            if (!entry.devices.includes(name)) entry.devices.push(name);
        });
    });
    return [...byNet.values()].sort((a, b) => a.network.localeCompare(b.network));
}

function reportModel() {
    // Severity order, then the order the checks ran in. topologyFindings() walks
    // nodes before links, so ties keep the reading order of the alert panel
    // rather than whatever the sort happens to do with equal keys.
    const findings = topologyFindings()
        .map((f, seq) => ({ ...f, seq }))
        .sort((a, b) => (a.level === b.level ? a.seq - b.seq : (a.level === 'bad' ? -1 : 1)));

    const devices = reportDevices();
    const connections = reportConnections();
    const subnets = reportSubnets();

    return {
        meta: normalizeReportMeta(state.report),
        findings,
        devices,
        connections,
        subnets,
        counts: {
            devices: devices.length,
            connections: connections.length,
            subnets: subnets.length,
            critical: findings.filter((f) => f.level === 'bad').length,
            advisory: findings.filter((f) => f.level === 'warn').length
        }
    };
}

// ============================================================================
// The estate: every saved network as one document
// ============================================================================
// The same rule as the rest of this file, one level up. Nothing here is a new
// check. Every number on the cover is an aggregation of what withDoc() +
// reportModel() already say about each stored network, so a card, a site report
// and the estate report cannot disagree by construction.
//
// The one thing this document can show that a single-site report structurally
// cannot is a subnet used in two buildings. It is printed as a FACT with a
// count and no severity — never as a finding — because topologyFindings() has
// no cross-site check, and a report that graded it would be asserting something
// the Diagnostics panel can never confirm.

// A stable per-site anchor for the index links. Entry ids are minted locally
// and are already id-safe, but a binder that arrived from elsewhere is not
// trusted to have kept that property.
const siteAnchor = (id, i) => (/^[A-Za-z0-9_-]+$/.test(id || '') ? `site-${id}` : `site-s${i}`);

function binderSiteModels(entries) {
    return entries.map((e, i) => {
        const base = { id: e.id, name: e.name, updated: e.updated, anchor: siteAnchor(e.id, i) };
        try {
            // withDoc lends the stored document AND its survey header, so
            // reportModel().meta below is this site's header, not the canvas's.
            const model = withDoc(e.doc, () => reportModel());
            // rawMeta is the header as stored, unnormalized. The normalized one
            // has a date invented for it, so comparing sheets against the cover
            // on model.meta printed today's date on every site — a value none of
            // them recorded, contradicting the cover of the same deliverable.
            return Object.assign(base, { model, meta: model.meta, rawMeta: (e.doc && e.doc.report) || {}, counts: model.counts, siteRefs: withDoc(e.doc, () => state.nodes.filter((n) => n.siteRef).map((n) => ({ from: n.name, ref: n.siteRef }))) });
        } catch (err) {
            // A stored document too old or too broken to model still gets a
            // sheet: leaving it out silently would understate the estate.
            return Object.assign(base, { unreadable: true, siteRefs: [], rawMeta: (e.doc && e.doc.report) || {},
                counts: { devices: (e.doc.nodes || []).length, connections: 0, subnets: 0, critical: 0, advisory: 0 } });
        }
    }).sort((a, b) => a.name.localeCompare(b.name));   // stable across regenerations, unlike libraryEntries()
}

// Every finding in the estate, worst first, each carrying the site it came
// from. Ties keep per-site check order, then site name, so two runs over an
// unchanged binder produce the same register.
function estateFindingRows(sites) {
    const rows = [];
    sites.forEach((s) => {
        if (!s.model) return;
        s.model.findings.forEach((f) => rows.push(Object.assign({}, f, { site: s.name })));
    });
    return rows.sort((a, b) => (a.level === b.level
        ? (a.site === b.site ? a.seq - b.seq : a.site.localeCompare(b.site))
        : (a.level === 'bad' ? -1 : 1)));
}

// Addressing across the estate. Exact network-string equality only: the report
// says "this network appears in two buildings", which is a fact it can prove
// from two documents. Deciding whether a /16 at HQ overlapping a /24 at a
// branch is a fault needs to know whether the two are routed together, which
// the survey does not record — so it is not claimed.
function estateSubnets(sites) {
    const byNet = new Map();
    sites.forEach((s) => {
        if (!s.model) return;
        s.model.subnets.forEach((sub) => {
            if (!byNet.has(sub.network)) {
                byNet.set(sub.network, { network: sub.network, kind: sub.kind, isPrivate: sub.isPrivate, sites: [] });
            }
            byNet.get(sub.network).sites.push({ site: s.name, devices: sub.devices });
        });
    });
    return [...byNet.values()]
        .map((r) => Object.assign(r, { devices: r.sites.reduce((n, x) => n + x.devices.length, 0) }))
        // Shared networks first — they are the reason this table exists — then
        // alphabetically, so the ordering never depends on library order.
        .sort((a, b) => (b.sites.length - a.sites.length) || a.network.localeCompare(b.network));
}

// The estate graph, from the siteRef a cloud carries. Ranks by longest path to
// a sink so hubs sit above branches; the relaxation is capped at one pass per
// site, which is what stops a reference cycle (Torre A -> Torre B -> Torre A,
// which a user can absolutely draw) from hanging the tab. Names within a rank
// are sorted, so an unchanged binder draws the same picture tomorrow.
function estateGraph(sites) {
    const byId = new Map(sites.map((s) => [s.id, s]));
    const nodes = sites.map((s) => ({ id: s.id, name: s.name }));
    const edges = [];
    sites.forEach((s) => {
        (s.siteRefs || []).forEach((r) => {
            const target = r.ref.id && byId.get(r.ref.id);
            edges.push({ from: s.id, fromName: s.name, toId: target ? target.id : null,
                toName: target ? target.name : (r.ref.name || ''), via: r.from, resolved: !!target });
        });
    });
    const rank = new Map(nodes.map((n) => [n.id, 0]));
    for (let pass = 0; pass < nodes.length; pass++) {
        let moved = false;
        edges.forEach((e) => {
            if (!e.resolved) return;
            if (rank.get(e.from) <= rank.get(e.toId)) { rank.set(e.from, rank.get(e.toId) + 1); moved = true; }
        });
        if (!moved) break;
    }
    // Ascending: rank 0 is a site nothing of this estate reaches through — the
    // hub — and it belongs at the TOP, the way upstream sits at the top of the
    // canvas itself. Emitting maxRank first put the branch offices above their
    // own HQ and pointed every arrow downward at a leaf.
    const maxRank = Math.max(0, ...nodes.map((n) => rank.get(n.id)));
    const rows = [];
    for (let r = 0; r <= maxRank; r++) {
        const row = nodes.filter((n) => rank.get(n.id) === r).sort((a, b) => a.name.localeCompare(b.name));
        if (row.length) rows.push(row);
    }
    return { rows, edges, nodes };
}

// What the estate header offers as a starting point: for each field, the value
// the most sites already agree on. The engineer confirms or overrides it in the
// dialog, and the answer is used for this one document and persisted nowhere —
// an estate header is a property of a deliverable, not of any saved network.
function binderHeaderDefaults(sites) {
    const out = {};
    REPORT_FIELDS.forEach(({ key }) => {
        if (key === 'site') return;   // the estate's own name is always typed
        const tally = new Map();
        sites.forEach((s) => {
            const v = s.rawMeta && s.rawMeta[key];   // what was recorded, not what was defaulted
            if (v) tally.set(v, (tally.get(v) || 0) + 1);
        });
        let best = '', bestN = 0;
        tally.forEach((n, v) => { if (n > bestN) { best = v; bestN = n; } });
        if (best) out[key] = best;
    });
    return out;
}

function binderModel(entries, estateMeta) {
    const sites = binderSiteModels(entries);
    const findings = estateFindingRows(sites);
    const subnets = estateSubnets(sites);
    return {
        meta: normalizeReportMeta(estateMeta),
        sites, findings, subnets,
        graph: estateGraph(sites),
        counts: {
            sites: sites.length,
            devices: sites.reduce((n, s) => n + s.counts.devices, 0),
            connections: sites.reduce((n, s) => n + s.counts.connections, 0),
            // Distinct across the estate, never the sum: the same network in two
            // buildings is one network, and a total that double-counted it would
            // contradict the table directly underneath.
            subnets: subnets.length,
            critical: findings.filter((f) => f.level === 'bad').length,
            advisory: findings.filter((f) => f.level === 'warn').length,
        },
    };
}

// ---- The document ----
// Print-first: A4 with real margins, tables that break across pages without
// losing their headers, and nothing that depends on a screen being present.
function reportStyles() {
    return `
    /* Margins only, and deliberately no paper size. Forcing A4 makes a Letter/Carta
       printer scale the page, and Carta is what most of this report's readers
       have loaded. The screen view still uses A4 proportions; print fills
       whatever paper the dialog is set to. */
    @page { margin: 16mm 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #f1f5f9; color: #0f172a;
           font: 13px/1.5 "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 18mm 16mm; box-shadow: 0 1px 3px rgba(15,23,42,0.15); }
    /* Only the estate report ever has a second sheet; a single-site document is
       unaffected because the selector never matches. */
    .sheet + .sheet { margin-top: 18px; page-break-before: always; break-before: page; }
    h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -0.01em; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569;
         margin: 26px 0 8px; padding-bottom: 5px; border-bottom: 1px solid #e2e8f0; page-break-after: avoid; }
    p { margin: 0 0 8px; }
    .sub { color: #64748b; font-size: 12px; margin: 0 0 14px; }
    .rule { height: 3px; background: #eab308; margin: 0 0 14px; }

    .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; margin-bottom: 6px; }
    .meta div { display: flex; gap: 8px; font-size: 12px; border-bottom: 1px dotted #e2e8f0; padding: 3px 0; }
    .meta dt { color: #64748b; min-width: 92px; margin: 0; }
    .meta dd { margin: 0; font-weight: 600; }

    /* Grid, not flex: five flex items with min-width:auto can total wider than
       the page box and put the last tile's border under the margin. A grid of
       equal fractions cannot overflow, and it still reflows on a narrow screen. */
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 8px; margin: 12px 0 4px; }
    .stat { border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; min-width: 0; }
    .stat b { display: block; font-size: 20px; line-height: 1.1; }
    .stat span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: #64748b; }
    .stat.crit { border-color: #fecaca; background: #fef2f2; } .stat.crit b { color: #b91c1c; }
    .stat.adv  { border-color: #fde68a; background: #fffbeb; } .stat.adv b { color: #b45309; }

    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 4px; }
    thead { display: table-header-group; }
    th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em;
         color: #475569; border-bottom: 1.5px solid #cbd5e1; padding: 5px 6px; }
    td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tr { page-break-inside: avoid; }
    /* Breaking anywhere belongs on addresses, which are long and unbreakable,
       and nowhere else: applied to prose it splits Cyrillic words mid-syllable
       and hands a CJK column one character per line. */
    .mono { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; overflow-wrap: anywhere; }
    .muted { color: #94a3b8; }
    .num { width: 26px; color: #94a3b8; }
    /* Fixed columns for the findings table. Left to itself the browser gives the
       narrow columns whatever the widest sentence does not want, and the check
       name — the shortest cell and the one that names the problem — loses. */
    .findings { table-layout: fixed; }
    .findings th:nth-child(1), .findings td:nth-child(1) { width: 26px; }
    .findings th:nth-child(2), .findings td:nth-child(2) { width: 82px; }
    .findings th:nth-child(3), .findings td:nth-child(3) { width: 17%; }
    .findings th:nth-child(4), .findings td:nth-child(4) { width: 15%; }
    /* The estate register inserts Site at column 3, so everything after it
       shifts one place right. */
    .findings.estate th:nth-child(3), .findings.estate td:nth-child(3) { width: 15%; }
    .findings.estate th:nth-child(4), .findings.estate td:nth-child(4) { width: 15%; }
    .findings.estate th:nth-child(5), .findings.estate td:nth-child(5) { width: 14%; }
    /* Estate extras: the shared-network tint, the site index, the graph. */
    tr.multi td { background: #fffbeb; }
    .idx td:first-child a { color: #0f172a; text-decoration: none; border-bottom: 1px solid #cbd5e1; }
    .estate-graph { width: 100%; height: auto; margin: 4px 0 10px; }
    .estate-graph text { font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

    .sev { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9.5px;
           font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
    .sev.bad { background: #fee2e2; color: #991b1b; }
    .sev.warn { background: #fef3c7; color: #92400e; }

    .clean { border: 1px solid #a7f3d0; background: #ecfdf5; color: #065f46; border-radius: 4px; padding: 10px 12px; }
    .figure { margin: 10px 0 4px; text-align: center; page-break-inside: avoid; }
    .figure img { max-width: 100%; border: 1px solid #e2e8f0; border-radius: 4px; }
    .caption { font-size: 10px; color: #64748b; margin-top: 5px; }

    .note { font-size: 10.5px; color: #475569; background: #f8fafc; border-left: 3px solid #cbd5e1;
            padding: 9px 12px; margin: 8px 0; white-space: pre-wrap; }
    footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e2e8f0;
             font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; gap: 12px; }

    .toolbar { max-width: 210mm; margin: 0 auto 12px; display: flex; justify-content: flex-end; }
    .toolbar button { background: #0f172a; color: #fff; border: 0; border-radius: 4px;
                      padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; }

    @media print {
        body { background: #fff; padding: 0; }
        .sheet { box-shadow: none; max-width: none; padding: 0; }
        /* On paper the page break IS the separation; the screen gap would print
           as a stripe of dead space at the top of every site's first page. */
        .sheet + .sheet { margin-top: 0; }
        .toolbar { display: none; }
        h2 { margin-top: 18px; }
    }`;
}

function findingsSection(findings, opts = {}) {
    if (!findings.length) {
        return `<div class="clean"><b>${t('No faults were raised by the documented configuration.')}</b><br>
            ${escapeHtml(t('Every automated check passed against the topology as recorded. That is a statement about the drawing, not a clean bill of health for the network — see Scope and method.'))}</div>`;
    }
    // The estate register is the same table with the site named — one renderer,
    // so the register and a site's own findings can never word a finding
    // differently.
    const rows = findings.map((f, i) => `
        <tr>
            <td class="num">${i + 1}</td>
            <td><span class="sev ${f.level}">${escapeHtml(t(SEVERITY_NAMES[f.level] || f.level))}</span></td>
            ${opts.site ? `<td><b>${escapeHtml(f.site || '—')}</b></td>` : ''}
            <td><b>${escapeHtml(f.subject || '—')}</b></td>
            <td class="muted">${escapeHtml(f.check)}</td>
            <td>${escapeHtml(sentenceCase(f.detail))}</td>
        </tr>`).join('');
    return `<table class="findings${opts.site ? ' estate' : ''}">
        <thead><tr><th></th><th>${t('Severity')}</th>${opts.site ? `<th>${t('Site')}</th>` : ''}<th>${t('Device')}</th><th>${t('Check')}</th><th>${t('Finding')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

function ifaceCell(iface) {
    const bits = [`<b>${escapeHtml(iface.name)}</b>`];
    if (iface.ip) bits.push(`<span class="mono">${escapeHtml(iface.ip)}</span>`);
    if (iface.bond) bits.push(`<span class="muted">${escapeHtml(t('bond'))} · ${escapeHtml(iface.bond)}</span>`);
    else if (iface.member) bits.push(`<span class="muted">${escapeHtml(t('bond member'))}</span>`);
    if (iface.wireless) bits.push(`<span class="muted">${escapeHtml(t('radio'))}</span>`);
    if (iface.mac) bits.push(`<span class="mono muted">${escapeHtml(iface.mac)}${iface.vendor ? ` · ${escapeHtml(iface.vendor)}` : ''}</span>`);
    return bits.join('<br>');
}

function devicesSection(devices) {
    const rows = devices.map((d) => {
        const ifaces = d.interfaces.length
            ? d.interfaces.map(ifaceCell).join('<hr style="border:0;border-top:1px solid #f1f5f9;margin:4px 0">')
            : `<span class="muted">${escapeHtml(t('none recorded'))}</span>`;
        const extra = [
            d.ports ? `${escapeHtml(t('Ports'))}: ${d.ports.used}/${d.ports.total}` : '',
            d.nat ? escapeHtml(t('NAT')) : '',
            d.allowedPorts ? `${escapeHtml(t('Allowed'))}: ${escapeHtml(d.allowedPorts)}` : ''
        ].filter(Boolean).join(' · ');
        return `<tr>
            <td><b>${escapeHtml(d.name)}</b>${d.notes ? `<br><span class="muted">${escapeHtml(d.notes)}</span>` : ''}</td>
            <td>${escapeHtml(t(d.typeName))}${extra ? `<br><span class="muted">${extra}</span>` : ''}</td>
            <td>${ifaces}</td>
            <td class="mono">${escapeHtml(d.gw) || '<span class="muted">—</span>'}</td>
            <td class="mono">${escapeHtml(d.dns) || '<span class="muted">—</span>'}</td>
            <td>${escapeHtml(d.os) || '<span class="muted">—</span>'}</td>
        </tr>`;
    }).join('');
    return `<table>
        <thead><tr><th>${t('Device')}</th><th>${t('Type')}</th><th>${t('Interfaces')}</th><th>${t('Gateway')}</th><th>${t('DNS')}</th><th>${t('OS / firmware')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

function connectionsSection(connections) {
    if (!connections.length) return `<p class="muted">${escapeHtml(t('No connections recorded.'))}</p>`;
    const rows = connections.map((c) => `<tr>
        <td><b>${escapeHtml(c.from)}</b></td>
        <td class="mono muted">${escapeHtml(c.fromIface)}</td>
        <td><b>${escapeHtml(c.to)}</b></td>
        <td class="mono muted">${escapeHtml(c.toIface)}</td>
        <td>${escapeHtml(t(c.medium))}</td>
    </tr>`).join('');
    return `<table>
        <thead><tr><th>${t('From')}</th><th>${t('Interface')}</th><th>${t('To')}</th><th>${t('Interface')}</th><th>${t('Medium')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

function subnetsSection(subnets) {
    if (!subnets.length) return `<p class="muted">${escapeHtml(t('No addressing recorded.'))}</p>`;
    const rows = subnets.map((s) => `<tr>
        <td class="mono"><b>${escapeHtml(s.network)}</b></td>
        <td>${escapeHtml(s.kind === 'ipv6' ? 'IPv6' : 'IPv4')} · ${escapeHtml(t(s.isPrivate ? 'Private' : 'Public / routable'))}</td>
        <td>${s.devices.length}</td>
        <td>${escapeHtml(s.devices.join(', '))}</td>
    </tr>`).join('');
    return `<table>
        <thead><tr><th>${t('Network')}</th><th>${t('Kind')}</th><th>${t('Devices')}</th><th>${t('Members')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// The estate's table of contents. In-document anchors only — no scheme, no
// host — so the document still passes the "pulls nothing over the network"
// assertion that makes it safe to email.
function siteIndexSection(sites) {
    const rows = sites.map((s) => `<tr>
        <td><a href="#${escapeHtml(s.anchor)}"><b>${escapeHtml(s.name)}</b></a></td>
        ${s.unreadable
            ? `<td>${s.counts.devices}</td><td colspan="3" class="muted">${escapeHtml(t('This network could not be read.'))}</td>`
            : `<td>${s.counts.devices}</td><td>${s.counts.subnets}</td>
               <td>${s.counts.critical ? `<span class="sev bad">${s.counts.critical}</span>` : '<span class="muted">—</span>'}</td>
               <td>${s.counts.advisory ? `<span class="sev warn">${s.counts.advisory}</span>` : '<span class="muted">—</span>'}</td>`}
    </tr>`).join('');
    return `<table class="idx">
        <thead><tr><th>${t('Site')}</th><th>${t('Devices')}</th><th>${t('Subnets')}</th><th>${t('Critical')}</th><th>${t('Advisory')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// Addressing across the estate. A network in more than one building is tinted
// and counted, and the paragraph underneath says what that does and does not
// mean — because the document is not in a position to know.
function estateSubnetsSection(rows) {
    if (!rows.length) return `<p class="muted">${escapeHtml(t('No addressing recorded.'))}</p>`;
    const body = rows.map((r) => `<tr${r.sites.length > 1 ? ' class="multi"' : ''}>
        <td class="mono"><b>${escapeHtml(r.network)}</b></td>
        <td>${escapeHtml(r.kind === 'ipv6' ? 'IPv6' : 'IPv4')} · ${escapeHtml(t(r.isPrivate ? 'Private' : 'Public / routable'))}</td>
        <td>${r.sites.length}</td>
        <td>${r.devices}</td>
        <td>${r.sites.map((x) => `<b>${escapeHtml(x.site)}</b> <span class="muted">${escapeHtml(x.devices.slice(0, 8).join(', '))}${x.devices.length > 8 ? ` ${t('+{n} more', { n: x.devices.length - 8 })}` : ''}</span>`).join('<br>')}</td>
    </tr>`).join('');
    const shared = rows.filter((r) => r.sites.length > 1).length;
    return `<table>
        <thead><tr><th>${t('Network')}</th><th>${t('Kind')}</th><th>${t('Sites')}</th><th>${t('Devices')}</th><th>${t('Used in')}</th></tr></thead>
        <tbody>${body}</tbody></table>
        ${shared ? `<p class="muted">${escapeHtml(t('A highlighted network is documented in more than one site. Whether that is a conflict depends on whether those sites are routed together, which this survey does not record — it is stated here as a fact, not as a finding.'))}</p>` : ''}`;
}

// The estate graph, drawn as inline SVG because a report must pull nothing over
// the network and therefore cannot use a layout library. The Sites table below
// restates every edge in words: the picture is never the only place a link is
// stated, which is what makes this safe for a text-only reader or a printer
// that drops images.
function estateGraphSvg(graph) {
    if (!graph.edges.length) return '';
    const BOX_W = 150, BOX_H = 34, GAP_X = 22, GAP_Y = 56;
    // Width follows the widest rank rather than a constant: a fixed 720 clipped
    // every box past the fifth in a row straight off the viewBox, and an
    // omitted site in an estate report is worse than an ugly one. The SVG
    // scales to the page, so a wide estate simply draws smaller.
    const widest = Math.max(1, ...graph.rows.map((r) => r.length));
    const W = Math.max(720, widest * BOX_W + (widest - 1) * GAP_X + 20);
    const pos = new Map();
    graph.rows.forEach((row, r) => {
        const totalW = row.length * BOX_W + (row.length - 1) * GAP_X;
        row.forEach((n, i) => {
            pos.set(n.id, { x: (W - totalW) / 2 + i * (BOX_W + GAP_X), y: 10 + r * (BOX_H + GAP_Y), name: n.name });
        });
    });
    const H = 20 + graph.rows.length * (BOX_H + GAP_Y);
    const boxes = [...pos.entries()].map(([, p]) => `
        <rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="4" fill="#f8fafc" stroke="#94a3b8"/>
        <text x="${p.x + BOX_W / 2}" y="${p.y + BOX_H / 2 + 4}" text-anchor="middle" font-size="11" fill="#0f172a">${escapeHtml(p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name)}</text>`).join('');
    const lines = graph.edges.filter((e) => e.resolved && pos.has(e.from) && pos.has(e.toId)).map((e) => {
        const a = pos.get(e.from), b = pos.get(e.toId);
        // The referencing site sits BELOW the one it reaches, so the line leaves
        // its top edge and the arrowhead lands on the target's bottom.
        return `<line x1="${a.x + BOX_W / 2}" y1="${a.y}" x2="${b.x + BOX_W / 2}" y2="${b.y + BOX_H}" stroke="#94a3b8" stroke-width="1.4" marker-end="url(#arrow)"/>`;
    }).join('');
    return `<svg class="estate-graph" viewBox="0 0 ${W} ${H}" role="img">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker></defs>
        ${lines}${boxes}
    </svg>`;
}

// Every site reference in the estate, in words. The degradation path for the
// SVG above, and the only place an UNRESOLVED reference appears at all — a
// reference naming a site this binder does not hold is the normal state of a
// diagram someone was sent, so it is reported as a fact and never as a fault.
function siteLinksSection(graph) {
    if (!graph.edges.length) return `<p class="muted">${escapeHtml(t('No site names another site.'))}</p>`;
    const rows = graph.edges.slice().sort((a, b) => a.fromName.localeCompare(b.fromName) || a.toName.localeCompare(b.toName))
        .map((e) => `<tr>
            <td><b>${escapeHtml(e.fromName)}</b></td>
            <td class="muted">${escapeHtml(e.via)}</td>
            <td><b>${escapeHtml(e.toName || '—')}</b>${e.resolved ? '' : ` <span class="muted">${escapeHtml(t('(not in this binder)'))}</span>`}</td>
        </tr>`).join('');
    return `<table>
        <thead><tr><th>${t('Site')}</th><th>${t('Via')}</th><th>${t('Reaches')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// The paragraph that keeps this document honest. A drawing is a model of a
// network, and every finding above is a statement about the model. Saying so in
// the deliverable is not a disclaimer — it is the difference between a survey
// report and a scan someone might mistake it for.
function methodSection(meta) {
    const scope = meta.scope
        ? `<div class="note">${escapeHtml(meta.scope)}</div>`
        : '';
    return `${scope}
        <p>${escapeHtml(t('This report describes the network as documented during the survey. Findings are derived from the recorded topology, addressing and interface configuration — no device was scanned, probed or logged into to produce them, and nothing here was measured against live traffic.'))}</p>
        <p>${escapeHtml(t('A finding therefore means the configuration as recorded would cause the described behaviour. Where the documentation is incomplete, the corresponding check is silent rather than passing.'))}</p>`;
}

const stat = (value, label, cls) => `<div class="stat${cls ? ' ' + cls : ''}"><b>${value}</b><span>${escapeHtml(t(label))}</span></div>`;

// ---- The document shell, and one sheet inside it ----
// Split so the estate report can put N sheets in one document without a second
// copy of any of this. The split is the whole anti-drift argument: there is one
// stylesheet, one findings renderer, one inventory renderer, and a binder sheet
// is the same function call a single-site report makes.
function reportDocument(title, body) {
    return `<!DOCTYPE html>
<html lang="${escapeHtml(document.documentElement.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${reportStyles()}</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">${escapeHtml(t('Print / Save as PDF'))}</button></div>
${body}
</body>
</html>`;
}

// One site's sheet. opts.title/subtitle/anchorId let the estate report label a
// sheet by site and link to it from its index; every default reproduces the
// single-site document exactly, byte for byte.
function reportSheet(model, image, opts = {}) {
    const { meta, counts } = model;

    const metaRows = REPORT_FIELDS
        .filter(({ key, multiline }) => !multiline && meta[key])
        .map(({ key, label }) => `<div><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(meta[key])}</dd></div>`)
        .join('');

    return `<div class="sheet"${opts.anchorId ? ` id="${escapeHtml(opts.anchorId)}"` : ''}>
    <div class="rule"></div>
    <h1>${escapeHtml(opts.title || t('Network documentation report'))}</h1>
    <p class="sub">${escapeHtml(opts.subtitle !== undefined ? opts.subtitle : (meta.site || t('Site not named')))}</p>
    <dl class="meta">${metaRows}</dl>

    <h2>${escapeHtml(t('Summary'))}</h2>
    <div class="stats">
        ${stat(counts.devices, 'Devices')}
        ${stat(counts.connections, 'Connections')}
        ${stat(counts.subnets, 'Subnets')}
        ${stat(counts.critical, 'Critical', 'crit')}
        ${stat(counts.advisory, 'Advisory', 'adv')}
    </div>

    <h2>${escapeHtml(t('Findings'))}</h2>
    ${findingsSection(model.findings)}

    ${image ? `<h2>${escapeHtml(t('Topology'))}</h2>
    <div class="figure">
        <img src="${image.url}" alt="${escapeHtml(t('Network topology diagram'))}">
        <div class="caption">${escapeHtml(meta.site ? `${t('Topology')} — ${meta.site}` : t('Topology'))}</div>
    </div>` : ''}

    <h2>${escapeHtml(t('Device inventory'))}</h2>
    ${devicesSection(model.devices)}

    <h2>${escapeHtml(t('Connections'))}</h2>
    ${connectionsSection(model.connections)}

    <h2>${escapeHtml(t('Addressing'))}</h2>
    ${subnetsSection(model.subnets)}

    <h2>${escapeHtml(t('Scope and method'))}</h2>
    ${methodSection(meta)}

    <footer>
        <span>${escapeHtml(meta.ref || '')}</span>
        <span>${escapeHtml(t('Generated with Topo · topo.carino.systems'))}</span>
    </footer>
</div>`;
}

// The single-site report: one sheet, one document. Signature unchanged.
function reportHtml(model, image) {
    const title = model.meta.site
        ? `${model.meta.site} — ${t('Network documentation report')}`
        : t('Network documentation report');
    return reportDocument(title, reportSheet(model, image));
}

// The cover: what the whole engagement adds up to, before any one building.
function binderCoverSheet(binder) {
    const { meta, counts } = binder;
    const metaRows = REPORT_FIELDS
        .filter(({ key, multiline }) => !multiline && key !== 'site' && meta[key])
        .map(({ key, label }) => `<div><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(meta[key])}</dd></div>`)
        .join('');
    return `<div class="sheet">
    <div class="rule"></div>
    <h1>${escapeHtml(t('Estate documentation report'))}</h1>
    <p class="sub">${escapeHtml(meta.site || t('Estate not named'))}</p>
    <dl class="meta">${metaRows}</dl>

    <h2>${escapeHtml(t('Summary'))}</h2>
    <div class="stats">
        ${stat(counts.sites, 'Sites')}
        ${stat(counts.devices, 'Devices')}
        ${stat(counts.connections, 'Connections')}
        ${stat(counts.subnets, 'Subnets')}
        ${stat(counts.critical, 'Critical', 'crit')}
        ${stat(counts.advisory, 'Advisory', 'adv')}
    </div>

    <h2>${escapeHtml(t('Sites'))}</h2>
    ${siteIndexSection(binder.sites)}

    <h2>${escapeHtml(t('Findings across the estate'))}</h2>
    ${findingsSection(binder.findings, { site: true })}

    <h2>${escapeHtml(t('Estate addressing'))}</h2>
    ${estateSubnetsSection(binder.subnets)}

    <h2>${escapeHtml(t('Estate topology'))}</h2>
    ${estateGraphSvg(binder.graph)}
    ${siteLinksSection(binder.graph)}

    <h2>${escapeHtml(t('Scope and method'))}</h2>
    ${methodSection(meta)}

    <footer>
        <span>${escapeHtml(meta.ref || '')}</span>
        <span>${escapeHtml(t('Generated with Topo · topo.carino.systems'))}</span>
    </footer>
</div>`;
}

// The cover, then every site as the same sheet a single-site report produces.
// A site's own header rows are printed only where they DIFFER from the cover's,
// so a binder whose sites all name the same client says it once.
function binderHtml(binder, images = {}) {
    const title = binder.meta.site
        ? `${binder.meta.site} — ${t('Estate documentation report')}`
        : t('Estate documentation report');
    const sheets = binder.sites.map((s) => {
        if (!s.model) {
            return `<div class="sheet" id="${escapeHtml(s.anchor)}">
                <div class="rule"></div><h1>${escapeHtml(s.name)}</h1>
                <p class="muted">${escapeHtml(t('This network could not be read.'))}</p></div>`;
        }
        // Built up from blank rather than filtered down from the site's own
        // header: starting from s.meta and deleting the matches leaves every
        // agreeing field still in the object, and reportSheet prints whatever
        // is truthy — so the client's name reappeared on every sheet.
        // normalizeReportMeta is deliberately not used here either; it defaults
        // the date to today, which would then differ from the cover's and print
        // on every sheet for that reason instead.
        const sheetMeta = {};
        REPORT_FIELDS.forEach(({ key }) => { sheetMeta[key] = ''; });
        // The name the DOCUMENT records wins over the library card's label: the
        // single-site report of the same document prints that name, and the two
        // must not contradict each other. The card name is the sheet's heading
        // and its index entry, which is how the reader finds it.
        // Printed only when it says something the heading does not. The card is
        // usually named after the site, and a "Site: Bodega Sur" row under a
        // heading reading "Bodega Sur" is a line the reader has to check to
        // discover it was not worth reading. Where the two DIFFER — saving
        // before filling the header is the ordinary way that happens — the
        // document's own name is the one that prints, because the single-site
        // report of the same document prints it too.
        const recordedSite = (s.rawMeta.site || '').trim();
        sheetMeta.site = recordedSite && recordedSite !== s.name ? recordedSite : '';
        sheetMeta.scope = s.rawMeta.scope || '';   // each building's own scope note always stands
        REPORT_FIELDS.forEach(({ key }) => {
            if (key === 'site' || key === 'scope') return;
            const recorded = (s.rawMeta[key] || '').trim();
            if (recorded && recorded !== binder.meta[key]) sheetMeta[key] = recorded;
        });
        const sheetModel = Object.assign({}, s.model, { meta: sheetMeta });
        return reportSheet(sheetModel, images[s.id] || null, { title: s.name, subtitle: '', anchorId: s.anchor });
    }).join('');
    return reportDocument(title, binderCoverSheet(binder) + sheets);
}

// ---- Delivering it ----
// A new tab is the useful default: the report is read and printed far more often
// than it is filed. Popup blockers are common enough that the download has to be
// a real fallback rather than an error message, and both paths hand over the
// same bytes. The object URL outlives the call because revoking it immediately
// leaves the new tab pointed at nothing.
function deliverReport(html, meta) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const slug = (meta.site || 'network').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'network';
    const name = `${slug}-report-${meta.date || todayISO()}.html`;

    const tab = window.open(url, '_blank');
    if (!tab) {
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { url, name, opened: !!tab };
}

async function generateSiteReport() {
    const model = reportModel();
    let image = null;
    try { image = await captureCanvasImage('png'); }
    catch (e) { console.warn('Report: could not rasterise the diagram; continuing without it.', e); }
    return deliverReport(reportHtml(model, image), model.meta);
}

// Draw a stored document onto the real canvas so it can be rasterised, then put
// the editor back exactly as it was. withDoc() cannot do this: it is a pure
// model swap that never renders, and it deliberately drops annotations — which
// captureCanvasImage measures when it crops. Never calls save() or
// invalidateTidy(), so the URL and the undo timeline are untouched: the user
// asked for a report, not for their canvas to be edited.
async function withDocRendered(doc, fn) {
    const held = {
        nodes: state.nodes, links: state.links, annotations: state.annotations, report: state.report,
        camera: { x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom },
        selectedId: state.selectedId, selectedType: state.selectedType,
    };
    borrowCanvas(true);   // save() refuses while the canvas is not the user's document
    try {
        state.selectedId = null; state.selectedType = null;
        state.nodes = cloneData(doc.nodes || []).map(normalizeLoadedNode);
        state.links = cloneData(Array.isArray(doc.links) ? doc.links : []).map(normalizeLoadedLink)
            .filter((l) => getNode(l.source) && getNode(l.target));
        state.annotations = cloneData(doc.annotations || []).map(normalizeLoadedAnnotation);
        state.report = doc.report && typeof doc.report === 'object' ? cloneData(doc.report) : null;
        autoBindLinks();
        renderCanvasOnly();
        return await fn();
    } finally {
        state.nodes = held.nodes; state.links = held.links;
        state.annotations = held.annotations; state.report = held.report;
        state.camera = held.camera;
        state.selectedId = held.selectedId; state.selectedType = held.selectedType;
        borrowCanvas(false);
        applyCamera(); renderCanvasOnly();
    }
}

// One picture per site, captured in turn. At the export's 4x a twelve-building
// estate is an enormous file for images printed two to a page, so these go in
// at 2x. A site that will not rasterise is skipped rather than failing the
// document — a report with one picture missing beats no report.
async function captureBinderImages(sites, onProgress, capture) {
    const grab = capture || ((doc) => withDocRendered(doc, () => captureCanvasImage('png', 2)));
    const images = {};
    for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        if (onProgress) onProgress(i + 1, sites.length);
        if (!s.model || !s.doc) continue;
        try { const img = await grab(s.doc); if (img) images[s.id] = img; }
        catch (e) { console.warn('Binder report: could not rasterise', s.name, e); }
    }
    return images;
}

async function generateBinderReport(estateMeta, opts = {}) {
    const entries = libraryEntries();
    if (!entries.length) { alert(t('Nothing to report on yet — save a network first.')); return null; }
    const binder = binderModel(entries, estateMeta);
    // binderSiteModels drops the document once it has the model; the image
    // sweep needs it back, and matching by id keeps that lookup honest.
    const byId = new Map(entries.map((e) => [e.id, e.doc]));
    binder.sites.forEach((s) => { s.doc = byId.get(s.id); });
    const images = opts.images === false ? {} : await captureBinderImages(binder.sites, opts.onProgress, opts.capture);
    return deliverReport(binderHtml(binder, images), { site: binder.meta.site || 'estate', date: binder.meta.date, ref: binder.meta.ref });
}

// ---- The dialog ----
// Rendered from REPORT_FIELDS rather than written into index.html, so adding a
// field to the document adds it to the form and nowhere else.
// One dialog, two subjects: the network on screen, or the whole binder. A mode
// rather than a second modal, because the questions are identical — who the
// survey was for — and two dialogs would be two places to keep REPORT_FIELDS
// honest.
let _reportMode = 'site';

function renderReportFields(seed) {
    const host = document.getElementById('reportFields');
    if (!host) return;
    const meta = normalizeReportMeta(seed || state.report);
    host.innerHTML = '';

    REPORT_FIELDS.forEach(({ key, label, placeholder, multiline }) => {
        const wrap = document.createElement('label');
        wrap.className = 'flex flex-col gap-1';
        const cap = document.createElement('span');
        cap.className = 'text-[10px] font-bold uppercase tracking-wider';
        cap.style.color = 'var(--cs-text-muted)';
        cap.textContent = t(label);
        const input = document.createElement(multiline ? 'textarea' : 'input');
        if (!multiline) input.type = 'text';
        else input.rows = 3;
        input.id = `report-${key}`;
        input.className = 'w-full rounded px-2 py-1.5 text-xs';
        input.style.cssText = 'background: var(--cs-bg-elev); border: 1px solid var(--cs-border); color: var(--cs-text)';
        input.placeholder = t(placeholder) || '';
        input.value = meta[key];
        wrap.append(cap, input);
        host.appendChild(wrap);
    });
}

// Read the form back onto the document. Only called when the report is actually
// generated, so opening the dialog and thinking better of it changes nothing.
function readReportFields() {
    const meta = {};
    REPORT_FIELDS.forEach(({ key }) => {
        const el = document.getElementById(`report-${key}`);
        if (el) meta[key] = el.value.trim();
    });
    return meta;
}

function commitReportMeta() {
    state.report = readReportFields();
    save();
    return normalizeReportMeta(state.report);
}

// The wording, the images row and the seed all follow the mode. Called on open
// and again from applyLocale(), because applyStaticI18n() resets the title and
// the blurb to their captured site-report keys — without this a locale switch
// would silently turn a binder dialog into a site-report dialog that still
// generates a binder.
function renderReportDialog() {
    const binder = _reportMode === 'binder';
    const entries = binder ? libraryEntries() : [];
    const title = document.getElementById('reportDialogTitle');
    const blurb = document.getElementById('reportDialogBlurb');
    const build = document.getElementById('reportBuildBtn');
    const images = document.getElementById('reportImagesRow');
    if (title) title.textContent = binder ? t('Binder report') : t('Site report');
    if (blurb) {
        blurb.textContent = binder
            ? t('Every saved network as one document: the estate totals, the findings across all sites, the addressing they share, then each network in full.')
            : t('The findings, the inventory and the diagram as one printable document. Everything here is optional — it only fills in the header.');
    }
    if (build) build.textContent = binder ? `📋 ${t('Open binder report')}` : `📋 ${t('Open report')}`;
    if (images) {
        images.classList.toggle('hidden', !binder);
        // On by default up to eight sites. Past that the sweep is slow and the
        // file is enormous, and the estate cover is the part being read anyway.
        const cb = document.getElementById('reportImages');
        if (cb && binder) cb.checked = entries.length <= 8;
    }
    renderReportFields(binder ? Object.assign({ site: '' }, binderHeaderDefaults(binderSiteModels(entries))) : null);
}

function openReportDialog(mode) {
    const dialog = document.getElementById('reportDialog');
    if (!dialog) return;
    _reportMode = mode === 'binder' ? 'binder' : 'site';
    renderReportDialog();
    dialog.classList.remove('hidden');
    document.getElementById('report-site')?.focus();
}

function openBinderReportDialog() {
    if (!libraryEntries().length) { alert(t('Nothing to report on yet — save a network first.')); return; }
    openReportDialog('binder');
}

const reportMode = () => _reportMode;

function closeReportDialog() {
    document.getElementById('reportDialog')?.classList.add('hidden');
}
