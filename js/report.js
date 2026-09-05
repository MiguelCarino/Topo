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
        .toolbar { display: none; }
        h2 { margin-top: 18px; }
    }`;
}

function findingsSection(findings) {
    if (!findings.length) {
        return `<div class="clean"><b>${t('No faults were raised by the documented configuration.')}</b><br>
            ${escapeHtml(t('Every automated check passed against the topology as recorded. That is a statement about the drawing, not a clean bill of health for the network — see Scope and method.'))}</div>`;
    }
    const rows = findings.map((f, i) => `
        <tr>
            <td class="num">${i + 1}</td>
            <td><span class="sev ${f.level}">${escapeHtml(t(SEVERITY_NAMES[f.level] || f.level))}</span></td>
            <td><b>${escapeHtml(f.subject || '—')}</b></td>
            <td class="muted">${escapeHtml(f.check)}</td>
            <td>${escapeHtml(sentenceCase(f.detail))}</td>
        </tr>`).join('');
    return `<table class="findings">
        <thead><tr><th></th><th>${t('Severity')}</th><th>${t('Device')}</th><th>${t('Check')}</th><th>${t('Finding')}</th></tr></thead>
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

function reportHtml(model, image) {
    const { meta, counts } = model;
    const title = meta.site ? `${meta.site} — ${t('Network documentation report')}` : t('Network documentation report');

    const metaRows = REPORT_FIELDS
        .filter(({ key, multiline }) => !multiline && meta[key])
        .map(({ key, label }) => `<div><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(meta[key])}</dd></div>`)
        .join('');

    const stat = (value, label, cls) => `<div class="stat${cls ? ' ' + cls : ''}"><b>${value}</b><span>${escapeHtml(t(label))}</span></div>`;

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
<div class="sheet">
    <div class="rule"></div>
    <h1>${escapeHtml(t('Network documentation report'))}</h1>
    <p class="sub">${escapeHtml(meta.site || t('Site not named'))}</p>
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
</div>
</body>
</html>`;
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

// ---- The dialog ----
// Rendered from REPORT_FIELDS rather than written into index.html, so adding a
// field to the document adds it to the form and nowhere else.
function renderReportFields() {
    const host = document.getElementById('reportFields');
    if (!host) return;
    const meta = normalizeReportMeta(state.report);
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
function commitReportMeta() {
    const meta = {};
    REPORT_FIELDS.forEach(({ key }) => {
        const el = document.getElementById(`report-${key}`);
        if (el) meta[key] = el.value.trim();
    });
    state.report = meta;
    save();
    return normalizeReportMeta(meta);
}

function openReportDialog() {
    const dialog = document.getElementById('reportDialog');
    if (!dialog) return;
    renderReportFields();
    dialog.classList.remove('hidden');
    document.getElementById('report-site')?.focus();
}

function closeReportDialog() {
    document.getElementById('reportDialog')?.classList.add('hidden');
}
