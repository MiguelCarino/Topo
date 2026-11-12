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
// archived or opened on a machine that has never heard of this tool. The
// preview's Download saves it as that HTML file or as a PDF of the same pages
// (the fleet's carino-pdf.js, see reportFormat below); Print hands it to the
// browser's print dialog, which saves a PDF with selectable text.
//
// Load order: state -> i18n -> model -> data -> diagnostics -> ui -> report -> app

// ---- Metadata ----
// Who the survey was for, and who signed it. Held on the document rather than in
// settings so it rides the share URL and the .nettopo file: one link is then the
// whole engagement, not just the picture.
const REPORT_FIELDS = [
    { key: 'site', label: 'Site', keys: 'words', placeholder: 'Hospital San José — Torre B' },
    { key: 'client', label: 'Client', keys: 'words', placeholder: 'Grupo Médico del Norte, S.A. de C.V.' },
    { key: 'engineer', label: 'Prepared by', keys: 'words', placeholder: 'Miguel Carino — Carino Systems' },
    { key: 'ref', label: 'Reference', keys: 'code', placeholder: 'CS-2026-014' },
    { key: 'date', label: 'Date', keys: 'code', placeholder: '' },
    { key: 'scope', label: 'Scope & notes', keys: 'prose', placeholder: 'What was surveyed, what was not, and anything the reader needs to know.', multiline: true }
];

// The LOCAL calendar date (todayISO, js/model.js) dates every report and
// names every download: topo_<organization>_<site>_<this date> (topoFileStem
// below).

// A name as the first half of a filename. Accents fold to their letter
// ("José" -> "jose") and every run of anything else becomes one hyphen, but a
// letter is kept in any script: an ASCII-only slug turned every Japanese or
// Russian site name into the same "network".
function fileSlug(text, fallback = 'network') {
    // NFKD then NFC: accents on a Latin letter are taken off in between, and
    // any other mark (Japanese voicing, the breve of Russian й) goes back on
    // its letter.
    const slug = String(text || '').normalize('NFKD').replace(/([A-Za-z])[\u0300-\u036f]+/g, '$1').normalize('NFC').toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return slug || fallback;
}

// ---- What a download is called ----
// topo_<organization>_<site>_<YYYY-MM-DD>[_<kind>].<ext>: the client field of
// the report header, then the network (its card's name or the report's
// site), then the day, then what the file is (report, labels, devices, ...).
// Underscores separate the parts and never occur inside one, so a name
// splits back into its parts; inside a part every run of anything that is
// not a letter or a number is one hyphen (fileSlug). An empty part is left
// out, and a file naming neither organization nor site says `fallback`
// ("network"; a binder of networks from several clients says "networks"). A
// site that repeats the organization word for word is not said twice.
//   topo_acme_casa-roma_2026-11-09.json
//   topo_acme_casa-roma_2026-11-09_report.html
//   topo_networks_2026-11-09.json
// The date part is a YYYY-MM-DD day or today: a report's Date is free text
// ("09/11/2026"), and a slash in a file name is not a day the folder sorts by.
// Organization and site together stay within TOPO_NAMES_BYTES of UTF-8 (the
// longer one is trimmed first), so a Cyrillic or Japanese name cannot push
// the date and kind past the 255-byte limit of a file name.
const TOPO_NAMES_BYTES = 180;
const utf8Bytes = (s) => new TextEncoder().encode(s).length;
function topoFileStem({ org = '', site = '', date = '', kind = '', fallback = 'network' } = {}) {
    const part = (s) => fileSlug(s, '').replace(/_/g, '-');
    let o = Array.from(part(org)), s = Array.from(part(site));
    if (s.join('') === o.join('')) s = [];
    // One character at a time off the longer (in bytes) of the two.
    const room = TOPO_NAMES_BYTES - (o.length && s.length ? 1 : 0);
    let ob = utf8Bytes(o.join('')), sb = utf8Bytes(s.join(''));
    while (ob + sb > room) {
        if (ob >= sb) ob -= utf8Bytes(o.pop()); else sb -= utf8Bytes(s.pop());
    }
    o = o.join('').replace(/-+$/, ''); s = s.join('').replace(/-+$/, '');
    const names = [o, s].filter(Boolean);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').trim()) ? String(date).trim() : todayISO();
    return ['topo', ...(names.length ? names : [fallback]), day, part(kind)].filter(Boolean).join('_');
}
const topoFileName = (parts, ext) => `${topoFileStem(parts)}.${ext}`;
// A card name read back from a file named that way when the file itself does
// not carry one: its site part, or its organization when that is all it has.
// '' for a name that is not one (a hand-named file keeps its name as it was).
// A browser's " (1)" on a repeated download is not part of the name.
function nameFromTopoFileName(stem) {
    const m = /^topo_(.+?)_\d{4}-\d{2}-\d{2}(?:_[^_]+)?$/u.exec(String(stem || '').replace(/\s*\(\d+\)$/, ''));
    if (!m) return null;
    const last = m[1].split('_').pop();
    return last === 'network' || last === 'networks' ? '' : last;
}

function normalizeReportMeta(meta) {
    const m = meta || {};
    const out = {};
    REPORT_FIELDS.forEach(({ key }) => { out[key] = typeof m[key] === 'string' ? m[key] : ''; });
    if (!out.date) out.date = todayISO();
    return out;
}

// The name the open network is kept under (its library card), or ''. A
// report whose Site field was left blank is headed with it: the downloads
// were already named after the card ("oficina-reforma-2026-10-26…") while
// the report itself said "Site not named", one network under two names.
// Only the report reads it; nothing is written into the header, so the
// field stays blank (its placeholder says the name) and a later rename of
// the card is what the next report says.
function keptSiteName() {
    const card = state.libraryId && typeof libraryEntry === 'function' ? libraryEntry(state.libraryId) : null;
    return card && typeof card.name === 'string' ? card.name.trim() : '';
}
function siteReportMeta(meta) {
    const out = normalizeReportMeta(meta);
    if (!out.site.trim()) out.site = keptSiteName();
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

const SEVERITY_NAMES = { bad: 'Critical', warn: 'Advisory', info: 'Info' };

// A finding's detail is written to follow its panel prefix ("L2 loop: the link
// between …"), so on its own in a table cell it starts mid-sentence. Only the
// first letter moves, and only for display — the panel keeps its own wording.
const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---- The model ----
// Pure: no DOM, no formatting. The tests assert against this rather than against
// the rendered HTML, so a layout change cannot quietly break the content.

// Faceplate usage: portCapacity()'s count (js/model.js), the one the node
// panel (evaluatePorts) and the port map print too. Numbered sockets only, so
// an AP's wireless clients are not reported as cables in a port, and a bond
// counts as used.
function portUsage(node) {
    const cap = portCapacity(node);
    return cap ? { used: cap.used, total: cap.total } : null;
}

function reportInterface(node, iface) {
    const api = window.CarinoOUI;
    const decoded = hasMac(iface) && api ? api.decodeMac(normMac(iface.mac)) : null;
    return {
        // The interface's id, so a view built on these rows (the table,
        // js/table.js) can find the interface it is about. Unique only inside
        // its device, like every interface id.
        id: iface.id,
        name: iface.name || iface.id,
        ip: iface.ip || '',
        mac: decoded && !decoded.error ? fmtColonSafe(iface.mac) : '',
        vendor: decoded && decoded.vendor && decoded.vendor.vendor ? decoded.vendor.vendor : '',
        wireless: ifaceIsWireless(iface),
        bond: isBond(iface) ? (BOND_MODES[iface.bond.mode] || iface.bond.mode) : '',
        member: isBondMember(node, iface.id)
    };
}

function reportDevices() {
    return state.nodes.map((node) => ({
        // Which device the row is about: the table view (js/table.js) selects
        // and edits by it. The rows themselves are never written back to.
        id: node.id,
        name: node.name || node.id,
        type: node.type,
        typeName: typeName(node.type),
        // The badge's severity: the engine's, so an issue accepted with a
        // reason is not flagged here either.
        severity: nodeDiagnosis(node).severity,
        // Explicit interfaces only. A 24-port switch would otherwise contribute
        // 24 blank rows to the inventory, which is noise, not documentation —
        // the faceplate is reported as a count instead.
        interfaces: (node.interfaces || []).map((iface) => reportInterface(node, iface)),
        ports: portUsage(node),
        // gw, dns, os, allowedPorts, nat, notes: whatever NODE_FIELDS marks
        // for the report (js/model.js), so a field added there reaches the
        // inventory without being listed a second time here.
        ...reportFieldsOf(node),
        // Where it is (Review-Packs/Topo-groups.md, "Location"): its group's
        // path and, in a rack, its units, else the free text it was given
        // (nodePlaceText). `location` above stays the free text, which is
        // what its table cell edits.
        place: nodePlaceText(node),
        groupId: groupOfNode(node) ? node.group : '',
        rackSpan: rackSpanText(node),
        // What it runs on (js/model.js "Hosts"): the table's Runs on column,
        // and the inventory lists it under its host.
        hostId: hostOf(node) ? node.host : '',
        host: hostOf(node) ? (hostOf(node).name || node.host) : '',
        // Who is responsible for it (js/model.js "Providers"): its own, its
        // hosts' or its groups', per service, joined.
        provider: nodeProviders(node).map((r) => providerLabel(r.provider)).join(', '),
        // The network's own columns (js/model.js "Custom columns") that the
        // Devices table shows, in its order, with what this device holds.
        custom: reportCustomOf(node),
        // Age and upkeep (js/model.js), as of the report's date: the day
        // reportModel() counts the checks to (onChecksDay), so the inventory
        // and the findings say one age. Outside a report it is today.
        upkeep: reportUpkeepOf(node, checksDay()),
        // What it draws by PoE (document v16), for its inventory line, or null.
        poeDraw: canDrawPoe(node.type) && asPoeDraw(node.poeDraw) !== undefined ? asPoeDraw(node.poeDraw) : null
    }));
}
// The day a report counts to: its own date when that is one, so a report
// printed again later still says what it said; else today. meta: the header
// the dialog hands over, which a read-only document never stores.
const reportAsOf = (meta = state.report) => (meta && customDate(meta.date)) || todayISO();
// "In service since 2019 (about 7 y) · Last serviced 2026-05-14 · Next service 2027-05-14", or ''.
function reportUpkeepOf(node, asOf) {
    const age = deviceAge(node, asOf), next = nextServiceDate(node);
    return [
        node.inService ? t('In service since {date}', { date: node.inService }) + (age ? ` (${ageText(age)})` : '') : '',
        node.serviced ? t('Last serviced {date}', { date: node.serviced }) : '',
        next ? t('Next service {date}', { date: next }) : ''
    ].filter(Boolean).join(' · ');
}
// [{ name, text }] for the custom columns the table shows (a column hidden
// there is not printed either: hiding it is how it is left out of the
// report), only those this device holds a value in.
function reportCustomOf(node) {
    const cols = reportCustomColumns();
    return cols.map((c) => {
        const v = customValueOf(node, c.id);
        if (v === undefined) return null;
        return { name: c.name, text: c.kind === 'yesno' ? t(v ? 'Yes' : 'No') : customText(c, v) };
    }).filter(Boolean);
}
function reportCustomColumns() {
    const view = (state.tableView && state.tableView.devices) || {};
    const hidden = new Set(view.hidden || []);
    const rank = new Map((view.order || []).map((k, i) => [k, i]));
    const key = (c) => `x:${c.id}`;
    const cols = (state.columns || []).filter((c) => !hidden.has(key(c)));
    const at = (c) => (rank.has(key(c)) ? rank.get(key(c)) : Infinity);
    return cols.map((c, i) => ({ c, i })).sort((a, b) => (at(a.c) - at(b.c)) || (a.i - b.i)).map((x) => x.c);
}

// The groups, in tree order (groupTree): each with its path, its kind, its
// parent's path and how many devices it holds itself (own) and with the
// groups inside it (deep). The table's Groups tab reads these rows, and the
// report's inventory is laid out under them.
function reportGroups() {
    const counts = new Map(), deep = new Map();
    const byId = new Map(state.groups.map((g) => [g.id, g]));
    state.nodes.forEach((n) => {
        if (!n.group || !byId.has(n.group)) return;
        counts.set(n.group, (counts.get(n.group) || 0) + 1);
        const seen = new Set();
        for (let g = byId.get(n.group); g && !seen.has(g.id); g = byId.get(g.parent)) { seen.add(g.id); deep.set(g.id, (deep.get(g.id) || 0) + 1); }
    });
    return groupTree().map(({ group: g, depth }) => {
        const parent = groupById(g.parent);
        return {
            id: g.id, depth,
            name: groupLabel(g),
            kind: g.kind,
            kindName: groupKindName(g.kind),
            path: groupPath(g),
            parentId: parent ? parent.id : '',
            parent: parent ? groupPath(parent) : '',
            uHeight: isRackGroup(g) ? (g.uHeight || RACK_U_DEFAULT) : null,
            // A rack's size (the table's Groups tab): its width, its depth
            // in mm when one was given, and its numbering ('bottom'|'top').
            width: isRackGroup(g) ? asRackWidth(g.width) : null,
            depthMm: isRackGroup(g) && Number.isInteger(g.depthMm) ? g.depthMm : null,
            numbering: isRackGroup(g) ? (rackTopDown(g) ? 'top' : 'bottom') : null,
            own: counts.get(g.id) || 0,
            deep: deep.get(g.id) || 0
        };
    });
}

// The bands a network is on the air on: the bands of the radios that
// broadcast it, as each radio carries it (apBandSsids), so a WPA2/WPA3
// network set to "every band" (the default) on a Wi-Fi 6 AP with no 6 GHz
// radio reads 2.4 · 5 GHz, which is what is broadcast. A network nobody
// broadcasts yet reads as its own setting.
function wifiOnAirBands(w) {
    const on = new Set();
    wifiBroadcasters(w.id).forEach((n) => getInterfaces(n).filter(ifaceIsWireless).forEach((i) => {
        const radio = radioOf(i);
        (radioBands(radio) || WIFI_BANDS).forEach((b) => { if (apBandSsids(radio, b).includes(w.id)) on.add(b); });
    }));
    return on.size ? WIFI_BANDS.filter((b) => on.has(b)) : wifiBandsOf(w);
}

// The Wi-Fi networks (doc.wifi, js/model.js "Wi-Fi"), in the document's
// order: each with its security, the bands it is on (wifiOnAirBands),
// its subnet and VLAN, whether it is hidden, the APs broadcasting it and the
// devices on it, counted as the Wi-Fi tab counts them (js/wifi.js). The
// table's Wi-Fi tab is these rows.
function reportWifi() {
    return (state.wifi || []).map((w) => {
        const net = w.network ? networkById(w.network) : null;
        const bands = wifiOnAirBands(w);
        return {
            id: w.id,
            ssid: w.ssid || '',
            security: w.security || '',
            securityName: w.security ? wifiSecurityName(w.security) : '',
            bands,
            bandsText: wifiBandsText(bands),
            networkId: net ? net.id : '',
            // The address, and the network's name over it when it has one:
            // a named network alone ("Home") left the reader without the subnet.
            subnet: net ? net.cidr : '',
            subnetName: net && !isBlank(net.name) ? net.name.trim() : '',
            vlan: net && Number.isInteger(net.vlan) ? net.vlan : null,
            hidden: !!w.hidden,
            aps: wifiBroadcasters(w.id).map((n) => n.name || n.id),
            clients: wifiClients(w.id).map((n) => n.name || n.id)
        };
    });
}

// The access points as the report's Wi-Fi section prints them: per device
// that serves radio (an AP, or a home router with a radio), its standard and
// a row per band its radio has, with the channel and width (null is auto),
// the SSIDs that band broadcasts and the clients on it with their signal.
// The band of a client is the one the link panel shows (linkWifiBand): what
// it says, else the inference. A client on a band the radio does not list
// still gets a row (a finding says why), and a client whose band is not
// known goes in a last row with no band, so every association is printed
// once. Every described radio is read, not only the first: an AP with one
// radio interface per band (wlan0 on 2.4, wlan1 on 5) has its rows from
// each, and a link bound to an interface lands on that radio's row, as the
// checks and the link panel read it. An unbound link lands on the one radio
// that offers its band; when two do, it cannot be said which, and it gets a
// band row of its own (auto, like an undescribed radio's). A row names its
// interface (`iface`) only when the device has more than one radio.
function reportWifiAps() {
    const wifi = state.wifi || [];
    const out = [];
    state.nodes.forEach((node) => {
        if (!radioServes(node)) return;
        const links = state.links.filter((l) => { const e = wifiLinkEnds(l); return !!e && !!e.ap && !!e.client && e.ap.node === node; });
        const radios = getInterfaces(node).filter(ifaceIsWireless).map((iface) => ({ iface, radio: radioOf(iface) })).filter((r) => r.radio);
        if (node.type !== 'ap' && !links.length && !radios.length) return;
        const many = radios.length > 1;
        const rows = [];
        radios.forEach(({ iface, radio }) => (radioBands(radio) || []).forEach((band) => {
            const b = radioBand(radio, band) || {};
            rows.push({ band, ifaceId: iface.id, iface: many ? (iface.name || iface.id) : '',
                channel: b.channel !== undefined ? b.channel : null, width: b.width !== undefined ? b.width : null,
                ssids: apBandSsids(radio, band, wifi).map((id) => wifiLabel(wifiById(id, wifi))), clients: [] });
        }));
        const loose = { band: '', iface: '', channel: null, width: null, ssids: [], clients: [] };
        links.forEach((l) => {
            const e = wifiLinkEnds(l);
            const band = linkWifiBand(l, wifi) || '';
            let row = loose;
            if (band) {
                const bound = e.ap.iface && rows.find((r) => r.band === band && r.ifaceId === e.ap.iface.id);
                const offering = rows.filter((r) => r.band === band && r.ifaceId);
                row = bound || (!e.ap.iface && offering.length === 1 ? offering[0] : null)
                    || rows.find((r) => r.band === band && !r.ifaceId);
                if (!row) { row = { band, iface: '', channel: null, width: null, ssids: [], clients: [] }; rows.push(row); }
            }
            const signal = linkWifiOf(l, 'signal');
            row.clients.push({ name: e.client.node.name || e.client.node.id, signal: signal !== undefined ? signal : null });
        });
        // By band, a device's radios in their interface order within one.
        const order = rows.slice();
        rows.sort((a, b) => WIFI_BANDS.indexOf(a.band) - WIFI_BANDS.indexOf(b.band) || order.indexOf(a) - order.indexOf(b));
        rows.forEach((r) => { delete r.ifaceId; });
        if (loose.clients.length) rows.push(loose);
        const standards = [...new Set(radios.map((r) => r.radio.standard).filter(Boolean))];
        out.push({ id: node.id, name: node.name || node.id, standard: standards.map(wifiStandardName).join(', '), rows });
    });
    return out;
}
// The whole section, or null when the site has nothing wireless to print
// (no Wi-Fi network, no access point, no radio link): a wired site's report
// reads as it did before Wi-Fi was recorded.
function reportWifiSection() {
    const networks = reportWifi();
    const aps = reportWifiAps();
    return networks.length || aps.length ? { networks, aps } : null;
}

// Derived and read-only: these rows are built for reading, and nothing ever
// writes back through them. A text field reads as '' when unset, a boolean as
// true or false. The gateway and DNS are the ones in force (R7): a device
// that inherits its network's is configured with it, and the inventory says
// what the device uses, not which field it was typed into.
const REPORT_EFFECTIVE = { gw: effectiveGw, dns: effectiveDns };
function reportFieldsOf(node) {
    const out = {};
    NODE_FIELDS.forEach((f) => {
        if (!f.report) return;
        const v = REPORT_EFFECTIVE[f.key] ? REPORT_EFFECTIVE[f.key](node) : node[f.key];
        out[f.report.key] = f.kind === 'bool' ? !!v : asText(v);
    });
    return out;
}

// A report column's text for one device row: its field's value, except the
// Model column, which reads "vendor model" (the vendor has no column of its
// own; document v16).
const REPORT_CELL = { model: (d) => [d.vendor, d.model].filter((v) => !isBlank(v)).map((v) => v.trim()).join(' ') };
const reportCellText = (d, f) => (REPORT_CELL[f.report.key] ? REPORT_CELL[f.report.key](d) : d[f.report.key]);

function reportConnections() {
    return state.links.map((link) => {
        const src = getNode(link.source), tgt = getNode(link.target);
        return {
            id: link.id,
            from: src ? (src.name || src.id) : '—',
            fromIface: src ? ifaceLabel(src, link.sourceIface) : '—',
            to: tgt ? (tgt.name || tgt.id) : '—',
            toIface: tgt ? ifaceLabel(tgt, link.targetIface) : '—',
            medium: mediumName(effectiveMedium(link)),
            mediumKey: effectiveMedium(link) || '',
            // The cable's own facts (link.cable, CABLE_FIELDS in js/model.js).
            label: cableOf(link, 'label').trim(),
            length: cableOf(link, 'length').trim(),
            color: cableOf(link, 'color').trim(),
            via: cableOf(link, 'via').trim(),
            provider: linkProviders(link).map(providerLabel).join(', ')
        };
    }).filter((c) => c.from !== '—' && c.to !== '—');
}

// Who is responsible for what (js/model.js "Providers"): one row per
// provider with how to reach them and what they answer for. A group's
// devices are the group's line ("Server room, 6 devices"), not each device
// again; a device that names the provider itself (or through its host) is
// listed by name.
const REPORT_PROVIDER_NAMES_MAX = 12;
function reportProviders() {
    return (state.providers || []).map((p) => {
        const c = providerCovers(p.id);
        const how = (n) => nodeProviders(n).find((r) => r.provider.id === p.id);
        const named = c.nodes.filter((n) => { const r = how(n); return r && r.via !== 'group'; });
        const groupCount = (g) => c.nodes.filter((n) => { const r = how(n); return r && r.via === 'group' && r.from.id === g.id; }).length;
        const cable = (l) => { const a = getNode(l.source), b = getNode(l.target); return `${a ? a.name || a.id : '—'} ↔ ${b ? b.name || b.id : '—'}`; };
        return {
            id: p.id,
            name: providerLabel(p),
            service: p.service || '',
            serviceName: providerServiceLabel(p.service),
            contact: p.contact || '', phone: p.phone || '', email: p.email || '',
            account: p.account || '', hours: p.hours || '', notes: p.notes || '',
            devices: named.map((n) => n.name || n.id),
            groups: c.groups.map((g) => ({ path: groupPath(g), devices: groupCount(g) })),
            cables: c.links.map((l) => cableLabelOrEnds(l, cable)),
            covered: c.nodes.length + c.links.length
        };
    });
}
const cableLabelOrEnds = (l, ends) => { const label = cableOf(l, 'label').trim(); return label ? `${label} (${ends(l)})` : ends(l); };
// "Reception PC, NAS, Server room (6 devices), the cable WAN-01 (…)" for a
// row, the names cut at REPORT_PROVIDER_NAMES_MAX with "…and N more".
function providerCoversLine(p) {
    const parts = p.groups.map((g) => (g.devices ? `${g.path} (${t(g.devices === 1 ? '{n} device' : '{n} devices', { n: g.devices })})` : g.path))
        .concat(p.devices, p.cables.map((c) => t('the cable {name}', { name: c })));
    const shown = parts.slice(0, REPORT_PROVIDER_NAMES_MAX).join(', ');
    return parts.length > REPORT_PROVIDER_NAMES_MAX ? `${shown} ${t('…and {n} more.', { n: parts.length - REPORT_PROVIDER_NAMES_MAX })}` : shown;
}
// The technical sheet's table: provider, how to reach them, the contract
// and hours, and what they are responsible for.
function providersSection(list) {
    const muted = (text) => `<span class="muted">${escapeHtml(text)}</span>`;
    const dash = muted('—');
    return `<table class="providers">
        <thead><tr><th>${t('Provider')}</th><th>${t('Contact')}</th><th>${t('Account / contract')}</th><th>${t('Support hours / SLA')}</th><th>${t('Responsible for')}</th></tr></thead>
        <tbody>${list.map((p) => `<tr>
            <td><b>${escapeHtml(p.name)}</b>${p.serviceName ? `<br>${muted(p.serviceName)}` : ''}${p.notes ? `<br>${muted(p.notes)}` : ''}</td>
            <td>${[p.contact ? escapeHtml(p.contact) : '', p.phone ? `<span class="mono">${escapeHtml(p.phone)}</span>` : '', p.email ? `<span class="mono">${escapeHtml(p.email)}</span>` : ''].filter(Boolean).join('<br>') || dash}</td>
            <td class="mono">${p.account ? escapeHtml(p.account) : dash}</td>
            <td>${p.hours ? escapeHtml(p.hours) : dash}</td>
            <td>${p.covered || p.groups.length ? escapeHtml(providerCoversLine(p)) : muted(t('Nothing on the map yet'))}</td>
        </tr>`).join('')}</tbody></table>`;
}
// The summary's Who to call: a short block per provider in plain words.
function whoToCallSection(list) {
    return `<ul class="who-to-call">${list.map((p) => {
        const reach = [p.phone, p.email].filter(Boolean).join(' · ');
        const covers = p.covered || p.groups.length ? providerCoversLine(p) : '';
        return `<li><b>${escapeHtml(p.name)}</b>${p.serviceName ? ` <span class="muted">· ${escapeHtml(p.serviceName)}</span>` : ''}
        ${p.contact || reach ? `<br>${escapeHtml([p.contact, reach].filter(Boolean).join(' — '))}` : ''}${p.hours ? `<br><span class="muted">${escapeHtml(p.hours)}</span>` : ''}${p.account ? `<br><span class="muted">${escapeHtml(t('Account / contract'))}: ${escapeHtml(p.account)}</span>` : ''}${covers ? `<br><span class="muted">${escapeHtml(t('Responsible for {what}', { what: covers }))}</span>` : ''}</li>`;
    }).join('')}</ul>`;
}

// One row per network: the declared ones (R7) with what they say about
// themselves (name, VLAN, gateway, DNS, DHCP), even with nobody on them yet,
// then any subnet the addressing implies that nobody has declared. This is
// the table an auditor asks for and the one nobody has written down.
// `network`, `kind`, `isPrivate` and `devices` are what the estate report
// compares across sites.
function reportSubnets() {
    const byNet = new Map();
    state.networks.forEach((net) => {
        const p = parseValidCIDR(net.cidr);
        if (!p || byNet.has(net.cidr)) return;
        byNet.set(net.cidr, { id: net.id, network: net.cidr, kind: p.kind, isPrivate: p.isPrivate, declared: true,
            name: asText(net.name).trim(), vlan: Number.isInteger(net.vlan) ? net.vlan : null, purpose: asText(net.purpose).trim(),
            gateway: asText(net.gateway).trim(), dns: asText(net.dns).trim(), dhcp: !!net.dhcp,
            dhcpFirst: asText(net.dhcpFirst).trim(), dhcpLast: asText(net.dhcpLast).trim(), devices: [], nodeIds: [] });
    });
    state.nodes.forEach((node) => {
        getValidIps(node).forEach((parsed) => {
            const net = networkOfIp(parsed.ip);
            const key = net ? net.cidr : parsed.networkStr;
            if (!byNet.has(key)) {
                byNet.set(key, { id: null, network: key, kind: parsed.kind, isPrivate: parsed.isPrivate, declared: false,
                    name: '', vlan: null, purpose: '', gateway: '', dns: '', dhcp: false, dhcpFirst: '', dhcpLast: '', devices: [], nodeIds: [] });
            }
            const entry = byNet.get(key);
            const name = node.name || node.id;
            if (!entry.devices.includes(name)) entry.devices.push(name);
            // By id as well as by name: two devices may share a name, and the
            // table view selects a network's devices from this list.
            if (!entry.nodeIds.includes(node.id)) entry.nodeIds.push(node.id);
        });
    });
    // How much of it is used and free (subnetCapacity, js/model.js), the
    // numbers the Capacity section and the table's Subnets tab print: size
    // and free are null past 2^24 addresses (an IPv6 /64), bits says how many
    // host bits it has then. near: the address-capacity note's test
    // (addressCapacityNote), so the table marks what the Findings tab names.
    // pool: the DHCP pool's split (subnetCapacity), null with none recorded;
    // fixed: the part outside a valid one, the whole subnet otherwise.
    byNet.forEach((entry) => {
        const net = entry.id ? state.networks.find((n) => n.id === entry.id) : null;
        const of = net || entry.network;
        const cap = subnetCapacity(of);
        const p = parseValidCIDR(entry.network);
        const note = addressCapacityNote(of, cap);
        Object.assign(entry, { size: cap ? cap.size : null, used: cap ? cap.used : 0, free: cap ? cap.free : null,
            bits: p ? hostBits(p) : 0, near: !!note, full: !!(note && note.fixed.free === 0),
            pool: cap ? cap.pool : null, fixed: cap ? cap.fixed : { size: null, used: 0, free: null } });
    });
    return [...byNet.values()].sort((a, b) => a.network.localeCompare(b.network));
}

// VLANs (docs/BACKLOG.md feature 4): one row per VLAN the register names,
// a declared subnet's, a port's untagged one or one listed tagged, in number
// order, or null when no port and no wired interface records a tagged VLAN
// (an access-only network's VLANs are already under Addressing and Switch
// ports). Each row:
//   vlan      the number
//   subnets   [{ name, cidr, gateway }] the declared subnets on it
//   access    how many ports have it untagged with no tagged list
//   trunks    [{ device, ports: [names] }] the ports and wired interfaces
//             that carry it tagged (a list holding it, or "all"), by device
//             in name order
// What is written only: nothing is walked or checked here.
function reportVlans() {
    const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });
    const ends = [];
    state.nodes.forEach((node) => {
        const name = node.name || node.id;
        if (hasPortGrid(node)) {
            Object.keys(node.portAttrs || {}).forEach((id) => {
                if (!/^p\d+$/.test(id)) return;
                const a = portAttrOf(node, id);
                const list = a.tagged ? parseVlanList(a.tagged) : null;
                if (a.vlan !== null || list) ends.push({ device: name, port: ifaceLabel(node, id), n: Number(id.slice(1)), untagged: a.vlan, list, port_: true });
            });
        }
        // As portVlans reads them: not a faceplate port written into the
        // list (its VLANs are portAttrs, above), not a bond member (it reads
        // its bond's).
        (node.interfaces || []).forEach((i, k) => {
            if (ifaceIsWireless(i) || isBondMember(node, i.id) || (hasPortGrid(node) && PORT_ID_RE.test(i.id || ''))) return;
            const list = asVlanList(i.tagged) ? parseVlanList(i.tagged) : null;
            if (list) ends.push({ device: name, port: i.name || i.id, n: 10000 + k, untagged: null, list, port_: false });
        });
    });
    if (!ends.some((e) => e.list)) return null;
    const nums = new Set();
    state.networks.forEach((net) => { if (asVlan(net.vlan) !== undefined) nums.add(asVlan(net.vlan)); });
    ends.forEach((e) => {
        if (e.untagged !== null) nums.add(e.untagged);
        if (e.list && !e.list.all) e.list.forEach((v) => nums.add(v));
    });
    const group = (list) => {
        const trunks = [];
        list.sort((a, b) => byName(a.device, b.device) || a.n - b.n).forEach((e) => {
            const last = trunks[trunks.length - 1];
            if (last && last.device === e.device) last.ports.push(e.port); else trunks.push({ device: e.device, ports: [e.port] });
        });
        return trunks;
    };
    const rows = [...nums].sort((a, b) => a - b).map((v) => {
        const subnets = state.networks.filter((net) => asVlan(net.vlan) === v && parseValidCIDR(net.cidr))
            .map((net) => ({ name: asText(net.name).trim(), cidr: net.cidr, gateway: asText(net.gateway).trim() }));
        const access = ends.filter((e) => e.port_ && e.untagged === v && !e.list).length;
        return { vlan: v, subnets, access, trunks: group(ends.filter((e) => vlanListHas(e.list, v))) };
    });
    // Trunks that carry every VLAN in a file that names none: one row for
    // them, so the section still says they are there.
    const all = ends.filter((e) => e.list && e.list.all);
    if (!rows.length && all.length) rows.push({ vlan: 'all', subnets: [], access: 0, trunks: group(all) });
    return rows;
}

// Every faceplate port of every switch and access point, cabled or free, in
// port order: its name as the box gives it (node.portScheme), what is written
// about it (node.portAttrs: a label, an access VLAN) and what is plugged in.
// The rows of the table's Ports tab (js/table.js); derived, like every row
// here, so an edit there is written to the node, never to the row.
function reportPorts() {
    const out = [];
    state.nodes.filter(hasPortGrid).forEach((node) => {
        const total = portCountOf(node);
        faceplatePortIds(node).forEach((id) => {
            const a = portAttrOf(node, id);
            const n = Number(id.slice(1));
            const link = linkOnIface(node.id, id);
            const peerId = link ? (link.source === node.id ? link.target : link.source) : null;
            const peer = peerId ? getNode(peerId) : null;
            const peerIface = peer ? ifaceIdOn(link, peerId) : null;
            out.push({ nodeId: node.id, portId: id, number: n, device: node.name || node.id, port: ifaceLabel(node, id),
                label: a.label, vlan: a.vlan, tagged: a.tagged, poe: a.poe, over: n > total,
                peerId: peer ? peer.id : null, peer: peer ? peer.name || peer.id : '', peerIface: peer ? ifaceLabel(peer, peerIface) : '',
                linkId: link && peer ? link.id : null, cable: link ? cableOf(link, 'label').trim() : '' });
        });
    });
    return out;
}

// Each rack as it would be drawn on the door (Review-Packs/Topo-groups.md,
// step C): its units from the top down, front and rear, each run of units
// one device or empty, then the devices in it with no unit yet, and its
// patch schedule (Review-Packs/Topo-groups.md, "Round 5", R5b): a row per
// cable that touches the rack, as rackSchedule (js/model.js) reads it and the
// rack view's Schedule panel lists it, in the rack's order. It replaced the
// first build's cables by device pair, gone from the rack view with the
// per-pair lines: the person at the rack patches ports, not pairs.
// Each device's cell carries its ports as the rack view draws them, on the
// face they are on (rackPortsFace): a small strip in its corner, a mark per
// port in order, hollow when free, filled when cabled (in the cable's colour
// when it is one a browser knows), ringed red on a port with a problem (past
// the faceplate, two cables on a socket (isSocketPort, as the cabling check
// reads it), or a cable a finding names: `bad`, the
// open findings' cables, from reportModel).
// A unit two devices claim (a sheet can say so; the rack view cannot) is a
// row of its own naming both, marked, as the finding names them. A device
// whose units are outside the rack is listed under the rack, not drawn in it.
// Racks in the Groups tab's order; a rack nobody put anything in is left out
// (an empty frame is a page of nothing).
const REPORT_PORTS_ROW = 24;   // ports in a row of a cell's strip, as on the rack view's boxes
function reportRackPorts(n, units, bad) {
    const ports = rackPortsOf(n);
    if (!ports.length) return null;
    // A 1U cell has room for two rows of marks beside the name: a bigger
    // switch's rows are made longer rather than taller.
    const perRow = Math.max(REPORT_PORTS_ROW, Math.ceil(ports.length / Math.max(2, units * 2)));
    const okColour = (c) => !!c && typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('color', c);
    return { perRow, marks: ports.map((p) => ({
        cabled: p.links.length > 0,
        color: p.links.map((l) => cableOf(l, 'color').trim()).find(okColour) || '',
        bad: p.past || p.doubled || p.links.some((l) => !!bad && bad.has(l.id))
    })) };
}
function reportRacks(bad = null) {
    return groupTree().map((e) => e.group).filter(isRackGroup).map((rack) => {
        const top = rackTop(rack);
        const members = rackMembers(rack);
        if (!members.length) return null;
        const placed = members.filter((n) => rackSpanOf(n));
        const name = (n) => n.name || n.id;
        const faces = RACK_FACES.map((face) => {
            // Who is in each unit on this face: its own devices, and the
            // backs of the full-depth ones mounted on the other.
            const at = Array.from({ length: top + 1 }, () => []);
            placed.forEach((n) => {
                const s = rackSpanOf(n);
                const back = s.face !== face;
                if (back && !rackFullDepth(n)) return;
                for (let u = Math.max(1, s.lo); u <= Math.min(top, s.hi); u++) at[u].push({ n, back });
            });
            const rows = [];
            for (let u = top; u >= 1;) {
                const here = at[u];
                if (!here.length) { rows.push({ u, span: 1, empty: true }); u--; continue; }
                const one = here.length === 1 ? here[0] : null;
                const s = one ? rackSpanOf(one.n) : null;
                // A device alone in all of its units is one cell over them.
                let span = 1;
                if (one) {
                    const lo = Math.max(1, s.lo);
                    if (Math.min(top, s.hi) === u && [...Array(u - lo + 1).keys()].every((k) => at[u - k].length === 1 && at[u - k][0].n === one.n)) span = u - lo + 1;
                }
                rows.push({ u, span, clash: here.length > 1,
                    items: here.map(({ n, back }) => ({ name: name(n), type: n.type, typeName: typeName(n.type),
                        units: (() => { const x = rackSpanOf(n); return rackUnitsText(rack, x.lo, x.hi); })(),
                        back, full: rackFullDepth(n), status: n.status === 'planned' || n.status === 'retired' ? n.status : '',
                        // What runs on it, on the face it is mounted on (its back is its units only).
                        guests: back ? [] : guestTreeOf(n).map(name),
                        // Its ports, on the face they are on; not in a unit two devices claim.
                        ports: here.length === 1 && rackPortsFace(n) === face ? reportRackPorts(n, span, bad) : null })) });
                u -= span;
            }
            return { face, rows };
        });
        const outside = placed.filter((n) => !rackSpanInside(rack, rackSpanOf(n).lo, rackSpanOf(n).hi)).map((n) => `${name(n)} (${rackSpanText(n)})`);
        // A VM or a container on a host is listed in its host's units, not here.
        const unplaced = members.filter((n) => !rackSpanOf(n) && !hostOf(n)).map(name);
        return {
            // Its size as one line, and which way its units are numbered:
            // the rows stay counted from the bottom (u), and the printed
            // number of each is racksSection's to work out (topDown).
            id: rack.id, path: groupPath(rack), top, size: rackSizeText(rack), topDown: rackTopDown(rack), inches: rackWidthInches(rack), faces, outside, unplaced,
            // Each placed host and what runs on it, in full: a 1U box's cell
            // has room for a few names at most, and cuts the rest.
            hosts: placed.map((n) => ({ name: name(n), guests: guestTreeOf(n).map(name) })).filter((h) => h.guests.length),
            // The patch schedule, as words (rackScheduleEnd: "SW-1 · 24").
            schedule: rackSchedule(rack).map((r) => ({ id: r.link.id, from: rackScheduleEnd(r), to: rackScheduleEnd(r, true), where: r.where,
                tag: r.tag, color: r.color, length: r.length, via: r.via }))
        };
    }).filter(Boolean);
}

// Every device with a faceplate (a switch, an access point) and what is in
// each of its ports, in port order: the page a technician tracing a cable at
// the rack wants, which the connections table (one row per cable, in the
// order they were drawn) is not. Named interfaces (an uplink called sfp1, an
// AP's radio) follow the numbered ports, in name order; the free ports are
// written as ranges ("3, 5–8") rather than as rows, except a free port
// somebody labelled or gave a VLAN, which is a row of its own: that is the
// jack the next device goes in. Ports read as the box names them
// (node.portScheme), and the Label and VLAN columns appear on a switch whose
// ports carry them.
function reportPortMaps() {
    const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });
    return state.nodes.filter(hasPortGrid).map((node) => {
        const rows = [];
        linksAtNode(node.id).forEach((link) => {
            const mine = ifaceIdOn(link, node.id);
            const peerId = link.source === node.id ? link.target : link.source;
            const peerIface = link.source === node.id ? link.targetIface : link.sourceIface;
            const peer = getNode(peerId);
            if (!peer) return;
            const m = /^p(\d+)$/.exec(mine || '');
            const a = portAttrOf(node, mine);
            rows.push({ port: m ? Number(m[1]) : null, label: ifaceLabel(node, mine), linkId: link.id, peerId: peer.id,
                peer: peer.name || peer.id, peerIface: ifaceLabel(peer, peerIface), ip: asText(ifaceOn(peer, peerIface)?.ip),
                cable: cableOf(link, 'label').trim(), medium: mediumName(effectiveMedium(link)),
                portLabel: a.label, vlan: a.vlan, tagged: a.tagged, poe: a.poe, free: false });
        });
        // Free ports with something written about them.
        const cabled = new Set(rows.filter((r) => r.port !== null).map((r) => r.port));
        Object.keys(node.portAttrs || {}).forEach((id) => {
            const m = /^p(\d+)$/.exec(id);
            if (!m || cabled.has(Number(m[1])) || !hasPortAttrs(node, id)) return;
            const a = portAttrOf(node, id);
            rows.push({ port: Number(m[1]), label: ifaceLabel(node, id), linkId: null, peerId: null, peer: '', peerIface: '', ip: '',
                cable: '', medium: '', portLabel: a.label, vlan: a.vlan, tagged: a.tagged, poe: a.poe, free: true });
        });
        rows.sort((a, b) => ((a.port === null) - (b.port === null)) || (a.port !== null ? a.port - b.port : 0)
            || byName(a.label, b.label) || byName(a.peer, b.peer));
        // Used and total are portCapacity()'s, so the heading agrees with the
        // inventory and the node panel (a bond is used, a radio's clients are
        // not ports); the free ranges are its free ports less the ones that
        // already have a row of their own (a labelled free jack).
        const cap = portCapacity(node);
        const total = cap.total;
        const listed = new Set(rows.filter((r) => r.port !== null).map((r) => r.port));
        const freeNums = cap.freeIds.map((id) => Number(id.slice(1))).filter((i) => i <= total && !listed.has(i));
        // full: the port-capacity note's test (portCapacityNote), so the map
        // marks the switch the Findings tab and the Capacity section name.
        const note = portCapacityNote(node);
        return { id: node.id, name: node.name || node.id, typeName: typeName(node.type), total, used: cap.used, rows,
            explicit: cap.explicit, retired: isRetired(node), freeCount: cap.free, nearlyFull: !!note, full: !!(note && note.full),
            hasLabels: rows.some((r) => r.portLabel), hasVlans: rows.some((r) => r.vlan !== null),
            // Tagged and PoE columns only on a switch whose rows have them, as
            // Label and VLAN; poe: what its PoE ports draw against its budget
            // (poeLoad, js/model.js), for the heading, or null.
            hasTagged: rows.some((r) => r.tagged !== null && r.tagged !== undefined), hasPoe: rows.some((r) => r.poe !== null && r.poe !== undefined),
            poe: poeLoad(node),
            free: portRangeText(node, freeNums) };
    // Every switch and AP, cabled or not: a switch with nothing plugged in yet
    // is the room the site has to grow (Decisions taken, docs/BACKLOG.md).
    // Not a bare one-port faceplate with nothing on it (a default AP's
    // uplink), which says nothing a reader needs, and not a retired box with
    // nothing on it, which is off the network and no room to grow (the note
    // and Room to grow leave it out too).
    }).filter((m) => m.rows.length || (m.total >= 2 && !m.retired))
        .sort((a, b) => byName(a.name, b.name));
}

// Capacity (docs/BACKLOG.md feature 2): what is close to running out of room,
// worked out from the register only. The ports side:
//   ports  each switch or AP the port-capacity note names (portCapacityNote,
//          js/model.js), with its free ports as the port map writes them, in
//          name order: the Capacity section's Ports table. The note itself
//          is info, which the report's findings leave out, so this is where
//          a reader sees it. Every switch's own ports are the port map's.
//   room   for the Simple summary's Room to grow line: the free ports over
//          every in-service or planned switch and AP whose port count was
//          set, of PORT_CAPACITY_MIN ports or more (an implicit count grows
//          with every cable, so its free ports are not known), and how many
//          such boxes there are (aps: how many of them are access points,
//          so the line names what the site has); null when there is none.
// The documented state, like everything else here: no date enters it.
function reportCapacity(subnets = reportSubnets()) {
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
    const ports = [];
    let free = 0, devices = 0, aps = 0;
    state.nodes.forEach((node) => {
        if (!hasPortGrid(node) || isRetired(node)) return;
        const cap = portCapacity(node);
        if (cap.explicit && cap.total >= PORT_CAPACITY_MIN) { devices++; free += cap.free; if (node.type === 'ap') aps++; }
        const note = portCapacityNote(node);
        if (!note) return;
        ports.push({ id: node.id, name: node.name || node.id, typeName: typeName(node.type), total: note.total, used: note.used,
            free: note.free, full: note.full, freePorts: portRangeText(node, note.freeIds.map((id) => Number(id.slice(1)))) });
    });
    // The addresses side, from the Addressing table's rows (reportSubnets):
    //   subnets   every subnet it lists, declared or implied, with its size,
    //             use and free count, and whether the address-capacity note
    //             names it (near, full): the Capacity section's Addresses
    //             table;
    //   addresses for Room to grow: the free addresses over every subnet the
    //             note could name (countable IPv4 of ADDRESS_CAPACITY_MIN
    //             addresses or more), how many such subnets, and the nearly
    //             full ones by name; null when there is none. An implied
    //             subnet only retired devices hold is left out: they are off
    //             the network, so it is no room to grow (the port half leaves
    //             retired boxes out the same way). A free address is added
    //             once: a subnet inside another counted one (a /24 declared
    //             inside a /16) is already in the outer one's free count,
    //             which subnetCapacity works out over the whole range.
    const rows = subnets.map((s) => ({ network: s.network, name: s.name, declared: s.declared, kind: s.kind,
        size: s.size, used: s.used, free: s.free, bits: s.bits, near: s.near, full: s.full, pool: s.pool, fixed: s.fixed }));
    const counted = rows.filter((r) => r.kind === 'ipv4' && r.size !== null && r.size >= ADDRESS_CAPACITY_MIN
        && (r.declared || r.used > 0));
    const spans = counted.map((r) => usableRange(parseValidCIDR(r.network)));
    const inside = (k) => spans.some((o, j) => j !== k && o.first <= spans[k].first && spans[k].last <= o.last
        && (o.first !== spans[k].first || o.last !== spans[k].last || j < k));
    const addresses = counted.length ? { free: counted.reduce((n, r, k) => (inside(k) ? n : n + r.free), 0), networks: counted.length,
        tight: counted.filter((r) => r.near).map((r) => (r.pool && r.pool.valid
            ? { name: r.name || r.network, free: r.fixed.free, size: r.fixed.size, full: r.full, fixed: true }
            : { name: r.name || r.network, free: r.free, size: r.size, full: r.full })) } : null;
    // The PoE side: every switch or AP in service or planned that records a
    // budget, what its PoE ports are asked for and what is left (poeLoad,
    // js/model.js). A figure only: going over is stage 2b's check.
    const poe = state.nodes.filter((n) => hasPortGrid(n) && !isRetired(n)).map((n) => ({ n, load: poeLoad(n) }))
        .filter((x) => x.load && x.load.budget !== null)
        .map(({ n, load }) => ({ id: n.id, name: n.name || n.id, typeName: typeName(n.type), budget: load.budget, used: load.used,
            left: Math.round((load.budget - load.used) * 100) / 100, devices: load.devices.length }));
    return { ports: ports.sort(byName), room: devices ? { free, devices, aps } : null, subnets: rows, addresses, poe: poe.sort(byName) };
}

// ---- Inventory by vendor, model and firmware (docs/BACKLOG.md feature 3, stage 5) ----
// What the register holds, counted three ways: the report's Inventory
// section and the Table's Inventory tab both read this, so they cannot
// disagree. Typed values only: a vendor the MAC suggests is not saved, so it
// is not counted (macVendorSuggestion, js/assets.js).
//   any       some device has a vendor, a model or a firmware / OS: the
//             section prints and the tab is offered only then;
//   vendors   one row per vendor (compared without case, runs of space as
//             one, shown in the most common spelling);
//   models    one row per model, keyed as the firmware finding keys it
//             (firmwareFindings, js/diagnostics.js): a vendor set and
//             different is another model, a blank vendor joins the model's
//             one vendor or stays apart when the model is under two; with
//             the firmware versions of its devices in service, each with its
//             count, most first; mismatch: 'open' while a firmware finding
//             names one of its devices and is not accepted, 'accepted' once
//             it is, else '';
//   firmware  one row per firmware / OS (the finding's comparison key, so
//             "v17.9.4" and "17.9.4" are one row).
// Every row: value ('' for the one Not recorded row, last), count (devices
// in service or planned), retired (retired devices, counted apart), nodeIds
// and names in the map's order. Ordered by count, then by value.
// findings: the diagnosis to read the firmware finding from (the report
// passes its own, counted to its date).
function reportInventory(findings) {
    const nodes = state.nodes;
    const any = nodes.some((n) => !isBlank(n.vendor) || !isBlank(n.model) || !isBlank(n.os));
    if (!any) return { any: false, vendors: [], models: [], firmware: [] };
    const low = (s) => fwSpace(s).toLowerCase();
    const bucket = (map, key) => { if (!map.has(key)) map.set(key, { key, nodes: [], spell: [], extra: [] }); return map.get(key); };
    const vendors = new Map(), models = new Map(), firmware = new Map();
    // The vendors each model is recorded under, so a blank vendor can join:
    // counted over the devices the firmware finding groups (in service, with
    // a model and a firmware), so a blank vendor joins or stays apart here
    // exactly as it does there, whatever a retired device or one with no
    // firmware is recorded under.
    const modelVendors = new Map();
    nodes.forEach((n) => {
        const m = low(n.model), v = low(n.vendor);
        if (!m || !v || isRetired(n) || !fwSpace(n.os) || !firmwareKey(n.os)) return;
        if (!modelVendors.has(m)) modelVendors.set(m, new Set());
        modelVendors.get(m).add(v);
    });
    nodes.forEach((n) => {
        const vendor = fwSpace(n.vendor), model = fwSpace(n.model), fw = fwSpace(n.os);
        const vb = bucket(vendors, vendor.toLowerCase()); vb.nodes.push(n); vb.spell.push(vendor);
        const fb = bucket(firmware, fw ? firmwareKey(n.os) : ''); fb.nodes.push(n); fb.spell.push(fw);
        let mk = '';
        if (model) {
            const known = modelVendors.get(model.toLowerCase());
            const v = vendor.toLowerCase() || (known && known.size === 1 ? [...known][0] : '');
            // A pair, not a joined string: "A|B" + "C" and "A" + "B|C" are two models.
            mk = JSON.stringify([v, model.toLowerCase()]);
        }
        const mb = bucket(models, mk); mb.nodes.push(n); mb.spell.push(model); mb.extra.push(vendor);
    });
    const fwFindings = (findings || topologyFindings()).filter((f) => f.key === 'firmware');
    const order = (a, b) => (!a.value) - (!b.value) || b.count - a.count || b.retired - a.retired
        || a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: 'base' });
    const row = (b) => {
        const live = b.nodes.filter((n) => !isRetired(n));
        return { key: b.key, value: b.key ? commonSpelling(b.spell) : '', count: live.length, retired: b.nodes.length - live.length,
            nodeIds: b.nodes.map((n) => n.id), names: b.nodes.map((n) => n.name || n.id) };
    };
    const modelRows = [...models.values()].map((b) => {
        const r = row(b);
        if (!b.key) return Object.assign(r, { vendor: '', model: '', firmware: [], mismatch: '' });
        r.model = r.value;
        r.vendor = commonSpelling(b.extra);
        r.value = (r.vendor ? r.vendor + ' ' : '') + r.model;
        const versions = new Map();
        b.nodes.forEach((n) => {
            const fw = fwSpace(n.os);
            if (isRetired(n) || !fw) return;
            const k = firmwareKey(n.os);
            if (!versions.has(k)) versions.set(k, []);
            versions.get(k).push(fw);
        });
        r.firmware = [...versions.values()].map((s) => ({ value: commonSpelling(s), count: s.length }))
            .sort((x, y) => y.count - x.count || x.value.localeCompare(y.value, undefined, { numeric: true }));
        const ids = new Set(r.nodeIds);
        const hits = fwFindings.filter((f) => (f.nodeIds || []).some((id) => ids.has(id)));
        r.mismatch = hits.some((f) => !f.accepted) ? 'open' : hits.length ? 'accepted' : '';
        return r;
    });
    return { any: true, vendors: [...vendors.values()].map(row).sort(order), models: modelRows.sort(order),
        firmware: [...firmware.values()].map(row).sort(order) };
}
// A model's firmware versions as one line: "17.9.4 × 2; 17.6.1 × 1".
const inventoryVersionsText = (list) => (list || []).map((v) => `${v.value} × ${v.count}`).join('; ');

// ---- Saved searches, printed (docs/BACKLOG.md feature 6, stage 3) ----
// The cells the Devices table draws for the screen that would print wrong:
// every address rather than two and '+N', a type and a tick in words, the
// whole note. Everything else is the table's own show(row).text, so the
// report and the table cannot disagree; age and next service count to
// checksDay(), the report's date inside reportModel (js/table.js).
const REPORT_SEARCH_CELLS = {
    type: (row) => t(row.data.typeName),
    ifaces: (row) => {
        const ips = row.data.interfaces.map((i) => i.ip).filter(Boolean);
        return ips.length ? ips.join(', ') : (row.data.ports ? `${row.data.ports.used}/${row.data.ports.total}` : '');
    },
    nat: (row) => { const n = getNode(row.ref.nodeId); return n && isRoutingDevice(n.type) ? t(row.data.nat ? 'Yes' : 'No') : '—'; },
    notes: (row) => String(row.data.notes || '').trim(),
    // The record's own vendor only: the MAC's suggestion the table greys
    // (tvVendorCell) is never printed (docs/BACKLOG.md feature 3, stage 3).
    vendor: (row) => { const n = getNode(row.ref.nodeId); return n && !isBlank(n.vendor) ? n.vendor.trim() : ''; }
};
function reportSearchCell(col, row) {
    if (REPORT_SEARCH_CELLS[col.key]) return REPORT_SEARCH_CELLS[col.key](row);
    if (col.custom) {
        const def = customColumnById(col.custom);
        if (def && def.kind === 'yesno') return t(customValueOf(getNode(row.ref.nodeId), def.id) ? 'Yes' : 'No');
    }
    const text = String(col.show(row).text || '');
    return text === '✓' ? t('Yes') : text;
}
// The column a search sorts by, as the sheet prints it: one whose cell the
// report words differently from the screen (a type, NAT, a yes/no column, a
// whole note) sorts on the printed text, so the rows follow the words the
// reader sees, in the report's language, and Yes/No turn over when
// descending. A dash is a blank, last either way. Addresses keep the table's
// numeric order (the first address leads in both).
function reportSearchSortColumn(col) {
    if (!col) return null;
    const yesno = col.custom && (customColumnById(col.custom) || {}).kind === 'yesno';
    if (col.key === 'ifaces' || (!REPORT_SEARCH_CELLS[col.key] && !yesno)) return col;
    return Object.assign({}, col, { sort: 'text', sortKey: null, show: (row) => { const text = reportSearchCell(col, row); return { text: text === '—' ? '' : text }; } });
}
// The saved searches the technical sheet prints, in document order. ids: the
// ones asked for (the report dialog's ticks, parts.searches); null or absent
// means every search marked to print (a binder's site, a report from code).
// Worked out here, inside reportModel's lookup pass and report date, so a
// binder's sheet is its own site's and has:finding counts to the report's
// date as the Findings section does (open findings only). devices: the
// model's rows (reportDevices). Each one is
//   { id, name, query, total, local?, error?, columns: [{ label, mono }],
//     rows: [{ name, guest, cells: [text] }] }
// local: the browser-local words (was:, has:history), never matched here: a
// report is the same whoever prints it. error: the words not understood.
// Either way no rows. O(searches × devices), at most SEARCH_MAX searches.
function reportSearches(ids, devices = reportDevices()) {
    const pick = Array.isArray(ids) ? new Set(ids) : null;
    const chosen = (state.searches || []).filter((s) => (pick ? pick.has(s.id) : !!s.print));
    if (!chosen.length) return [];
    const all = devices.map((d) => ({ rec: 'node', ref: { nodeId: d.id }, data: d }));
    const tableKeys = tvDevicesArranged().filter((c) => c.key !== TV_FIXED_COL).map((c) => c.key);
    return chosen.map((s) => {
        const base = { id: s.id, name: s.name, query: s.query, total: devices.length, columns: [], rows: [] };
        const local = queryLocalTerms(s.query);
        if (local.length) return Object.assign(base, { local: local.join(' ') });
        const parsed = parseQuery(s.query);
        if (parsed.errors.length) return Object.assign(base, { error: parsed.errors.join(' ') });
        const cols = (s.columns || tableKeys).filter((k) => k !== TV_FIXED_COL).map(tvDeviceColumn)
            .filter((c) => c && (!c.when || c.when()));
        base.columns = cols.map((c) => ({ label: c.custom ? c.label : t(c.label), mono: !!c.mono }));
        let rows = parsed.terms.length ? all.filter((r) => queryMatch(parsed, 'node', getNode(r.ref.nodeId))) : [];
        const sortCol = reportSearchSortColumn(s.sort && (s.sort === TV_FIXED_COL ? TV_COLS.devices.find((c) => c.key === TV_FIXED_COL) : tvDeviceColumn(s.sort)));
        if (sortCol) {
            const dir = s.desc ? -1 : 1;
            rows = rows.map((r, seq) => ({ r, seq })).sort((a, b) => (compareRows(sortCol, a.r, b.r, dir) * dir) || (a.seq - b.seq)).map((x) => x.r);
        } else {
            // As listed: a guest under its host, as the inventory has it.
            const byId = new Map(rows.map((r) => [r.data.id, r]));
            rows = hostOrdered(rows.map((r) => r.data)).map((d) => Object.assign({}, byId.get(d.id), { guest: d.guest || 0 }));
        }
        base.rows = rows.map((r) => ({ name: r.data.name, guest: r.guest || 0, cells: cols.map((c) => reportSearchCell(c, r)) }));
        return base;
    });
}

// Past this many devices the diagram no longer reads at the width of a page
// of text, and it pushed the inventory pages down behind it: it goes to a
// landscape page at the end, and the report says so where it would have been.
const REPORT_DIAGRAM_INLINE_MAX = 40;

// How the diagram goes on paper, by how small its labels would print: a
// device's name is 10 drawing units tall (js/ui.js), and below about 0.2 mm
// a unit (a 2 mm, 5.7 pt name) it stops reading. Three ways:
//   inline   at the width of the text, where it always was (a small site);
//   sheet    a landscape page of its own at the end, filled edge to edge,
//            when it reads there but not at the width of the text, or the
//            site is past REPORT_DIAGRAM_INLINE_MAX devices;
//   tiles    too big for even that: a landscape overview of the whole
//            network with a lettered grid on it, then a landscape sheet per
//            square of the grid that has a device in it, each at a size its
//            labels read at, overlapping its neighbours a little so nothing
//            on an edge is cut in two.
// The paper is not known (A4 or Carta, see @page), so the sizes are what
// fits on both: the text width of a portrait page, and a landscape page
// with 10 mm margins less its heading. In mm.
const REPORT_DIAGRAM_PAPER = { inlineW: 180, inlineH: 230, sheetW: 259, sheetH: 170 };
const REPORT_DIAGRAM_LEGIBLE = 0.2;    // mm per drawing unit, the least that reads
const REPORT_DIAGRAM_OVERLAP = 0.06;   // of a tile, shared with the next one
// The large map the dialog can add (Large map): the whole diagram again on
// a grid of landscape sheets the visitor picks, so many across and so many
// down (Sheets across, Sheets down), to read up close or tape together.
// Nothing about it is guessed: every square of the grid is printed, empty or
// not, and the grid is even, the same overlap between every two sheets.
const REPORT_DIAGRAM_GRID_MAX = 6;   // sheets across, and down, at most
const REPORT_DIAGRAM_GRID_DEFAULT = 2;
const gridCount = (v) => Math.max(1, Math.min(REPORT_DIAGRAM_GRID_MAX, Math.floor(Number(v)) || REPORT_DIAGRAM_GRID_DEFAULT));
// The squares left out (the dialog's toggles, or a click on the preview's
// overview): their names, A1, B2… A square left out is still drawn on the
// overview, faded, but has no sheet of its own.
const gridSkip = (v) => new Set((Array.isArray(v) || v instanceof Set ? [...v] : String(v || '').split(','))
    .map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z]+[0-9]+$/.test(x)));

// Pixels per drawing unit for the report's picture: `base` (4, 2 in a binder)
// while that is a reasonable image, fewer for a very large drawing, which
// would otherwise ask for a canvas the browser refuses. At the floor a tile
// still prints at about 75 dpi.
const REPORT_DIAGRAM_MAX_PIXELS = 48e6, REPORT_DIAGRAM_MAX_SIDE = 16000;
// The side is a hard limit (a canvas past it draws nothing), the floor is not.
const reportDiagramScale = (base) => (w, h) => Math.min(REPORT_DIAGRAM_MAX_SIDE / w, REPORT_DIAGRAM_MAX_SIDE / h,
    Math.max(0.75, Math.min(base, Math.sqrt(REPORT_DIAGRAM_MAX_PIXELS / Math.max(1, w * h)))));

// A grid square's name: its column as a letter (A…Z, AA…), its row a number.
const tileName = (c, r) => {
    let col = '', n = c + 1;
    while (n > 0) { col = String.fromCharCode(65 + ((n - 1) % 26)) + col; n = Math.floor((n - 1) / 26); }
    return `${col}${r + 1}`;
};

// image: { width, height } in pixels and, from captureReportDiagram, scale
// (pixels per unit), minX/minY (the drawing's corner) and points (where each
// device is drawn). A picture without them (a test's stand-in) is placed by
// its device count alone, as before. Tiles are in the picture's pixels.
// opts.large: the large map, always tiles, opts.cols × opts.rows of them
// (null for a picture without its scale, which cannot be tiled).
function reportDiagramLayout(image, devices, opts = {}) {
    if (!image) return null;
    const P = REPORT_DIAGRAM_PAPER;
    const s = Number(image.scale);
    if (!(s > 0) || !(image.width > 0) || !(image.height > 0)) {
        return opts.large ? null : { kind: devices > REPORT_DIAGRAM_INLINE_MAX ? 'sheet' : 'inline' };
    }
    const W = image.width / s, H = image.height / s;   // drawing units
    const fit = (w, h) => Math.min(w / W, h / H);
    // Without the large map a diagram is in the text where it reads there,
    // else on one landscape sheet of its own, however small that prints it:
    // the lettered grid and its sheets are the Large map's alone.
    if (!opts.large) {
        if (devices <= REPORT_DIAGRAM_INLINE_MAX && fit(P.inlineW, P.inlineH) >= REPORT_DIAGRAM_LEGIBLE) return { kind: 'inline' };
        return { kind: 'sheet' };
    }

    // opts.cols × opts.rows sheets, each the shape of the page, as large as
    // that grid allows while it covers the drawing, centred on it. The
    // squares named in opts.skip are left out (grid: every square, tiles:
    // the ones printed); leaving every one out leaves none out.
    const OV = REPORT_DIAGRAM_OVERLAP;
    const cols = gridCount(opts.cols), rows = gridCount(opts.rows);
    const across = (n) => n - (n - 1) * OV;   // a grid's span, in sheets
    const aspect = P.sheetW / P.sheetH;
    const tw = Math.max(W / across(cols), (H / across(rows)) * aspect), th = tw / aspect;
    const x0 = (W - tw * across(cols)) / 2, y0 = (H - th * across(rows)) / 2;
    const tiles = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = x0 + c * tw * (1 - OV), y = y0 + r * th * (1 - OV);
            tiles.push({ c, r, name: tileName(c, r), x: x * s, y: y * s, w: tw * s, h: th * s });
        }
    }
    const skip = gridSkip(opts.skip);
    if (tiles.every((tl) => skip.has(tl.name))) skip.clear();
    tiles.forEach((tl) => { tl.off = skip.has(tl.name); });
    return { kind: 'tiles', cols, rows, grid: tiles, tiles: tiles.filter((tl) => !tl.off), mm: P.sheetW / tw };
}

// The landscape pages: the picture once, as an <image> every page points at
// with <use>, so a network on twelve sheets carries its picture once and not
// twelve times; each page's viewBox is its piece of it.
// defined: the picture is already in the document under `id` (the summary's
// map, or the diagram's own sheet before the large map), so it is not
// carried again.
function diagramSheets(layout, image, caption, id, defined = false) {
    const W = image.width, H = image.height;
    const pic = defined ? '' : `<svg class="dg-src" width="0" height="0" aria-hidden="true"><defs><image id="${id}" href="${image.url}" width="${W}" height="${H}"/></defs></svg>`;
    const view = (x, y, w, h, extra = '') => `<svg class="dg" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(t('Network topology diagram'))}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f8fafc"/><use href="#${id}"/>${extra}</svg>`;
    if (layout.kind === 'sheet') {
        return `<div class="sheet land">${pic}
    <div class="land-head"><b>${escapeHtml(caption)}</b></div>
    ${view(0, 0, W, H)}
</div>`;
    }
    const tiles = layout.tiles, n = tiles.length, all = layout.grid || tiles;
    // The grid may reach past the drawing (it is centred on it): the
    // overview and the corner map show the whole grid, the squares left out
    // faded.
    const gx = Math.min(...all.map((tl) => tl.x)), gy = Math.min(...all.map((tl) => tl.y));
    const gw = Math.max(...all.map((tl) => tl.x + tl.w)) - gx, gh = Math.max(...all.map((tl) => tl.y + tl.h)) - gy;
    const font = Math.min(all[0].w, all[0].h) * 0.09;
    const grid = all.map((tl) => `<g class="dg-cell${tl.off ? ' off' : ''}" data-cell="${tl.name}"><rect x="${tl.x}" y="${tl.y}" width="${tl.w}" height="${tl.h}"/><text x="${tl.x + font * 0.4}" y="${tl.y + font * 1.05}" font-size="${font}">${tl.name}</text></g>`).join('');
    const overview = `<div class="sheet land">${pic}
    <div class="land-head"><b>${escapeHtml(caption)}</b><span>${escapeHtml(all.length > n ? t('Overview: each square is one of the {n} sheets that follow; the faded ones are left out.', { n }) : t('Overview: each square is one of the {n} sheets that follow.', { n }))}</span></div>
    ${view(gx, gy, gw, gh, grid)}
</div>`;
    const byCell = new Map(tiles.map((tl) => [`${tl.c},${tl.r}`, tl]));
    // A small map of the grid in each page's corner, its own square filled.
    const mw = 64, mh = Math.max(16, Math.min(64, (mw * gh) / gw)), kx = mw / gw, ky = mh / gh;
    const locator = (cur) => `<svg class="dg-loc" viewBox="0 0 ${mw} ${mh}" width="${mw}" height="${mh}" aria-hidden="true"><rect width="${mw}" height="${mh}" fill="#fff" stroke="#cbd5e1"/>${all.map((tl) => `<rect x="${(tl.x - gx) * kx}" y="${(tl.y - gy) * ky}" width="${tl.w * kx}" height="${tl.h * ky}"${tl === cur ? ' class="on"' : tl.off ? ' class="off"' : ''}/>`).join('')}</svg>`;
    const pages = tiles.map((tl, i) => {
        const next = [['←', -1, 0], ['↑', 0, -1], ['→', 1, 0], ['↓', 0, 1]]
            .map(([arrow, dc, dr]) => { const o = byCell.get(`${tl.c + dc},${tl.r + dr}`); return o ? `${arrow} ${o.name}` : ''; })
            .filter(Boolean);
        return `<div class="sheet land">
    <div class="land-head"><b>${escapeHtml(caption)}</b><span>${escapeHtml(t('Sheet {name} · {i} of {n}', { name: tl.name, i: i + 1, n }))}${next.length ? ` · ${escapeHtml(t('Continues on'))} ${next.join('  ')}` : ''}</span>${locator(tl)}</div>
    ${view(tl.x, tl.y, tl.w, tl.h)}
</div>`;
    });
    return overview + pages.join('');
}

// Read-only, so the whole model is built in one lookup pass (js/model.js):
// every device's row asks its diagnosis, its effective gateway and DNS and
// its addresses, and the pass answers each from one index instead of a scan
// or a whole-document key per device. withDoc() (binderSiteModels below)
// swaps the document in first, so the pass indexes the site being reported.
// Every date-relative check (ages, services due, schedules) counts to the
// report's date (onChecksDay, js/model.js), and so do the counts and the
// verdict built from them. meta: the dialog's header, else state.report.
// searchIds: the saved searches to print (reportParts' searches); absent,
// every one marked to print (reportSearches).
function reportModel(meta, searchIds) { return onChecksDay(reportAsOf(meta || state.report), () => withLookupPass(() => reportModelNow(searchIds))); }
function reportModelNow(searchIds) {
    // Severity order, then the order the checks ran in. topologyFindings() walks
    // nodes before links, so ties keep the reading order of the Findings tab
    // rather than whatever the sort happens to do with equal keys.
    // A finding accepted with a reason (js/diagnostics.js) is printed in a
    // section of its own, "Known / accepted", with the reason, and is not
    // counted: the totals are what is still open.
    // An info finding (a rack's untagged cables) is a note for the editor,
    // not a fault for the reader: the report leaves it out (isCountedFinding).
    const all = topologyFindings().filter((f) => f.level !== 'info')
        .map((f, seq) => ({ ...f, seq }))
        .sort((a, b) => (a.level === b.level ? a.seq - b.seq : (a.level === 'bad' ? -1 : 1)));
    const findings = all.filter((f) => !f.accepted);
    const accepted = all.filter((f) => f.accepted);
    const tally = findingCounts(all);

    const devices = reportDevices();
    // The socket each end device is plugged into (locateSocketText,
    // js/model.js), for the Simple summary's Where cell: only on a list the
    // summary prints, and only where the register holds one, so a network
    // with none reads byte for byte as before. reportDevices maps state.nodes
    // in order.
    if (devices.length <= SUMMARY_LIST_MAX) devices.forEach((d, i) => { const s = locateSocketText(state.nodes[i]); if (s) d.socket = s; });
    const connections = reportConnections();
    const subnets = reportSubnets();
    const groups = reportGroups();
    // The ports the open findings' cables are on are ringed on the
    // elevations, as on the rack view's boxes.
    const racks = reportRacks(new Set(findings.filter((f) => f.level === 'bad' || f.level === 'warn').flatMap((f) => f.linkIds || [])));

    return {
        meta: siteReportMeta(state.report),
        findings,
        accepted,
        // Pinned for the next visit (js/diagnostics.js), whatever their
        // finding's state, and the accepted ones scheduled until a date. A
        // pinned schedule is carried on its pin's row, so it is not here too.
        visit: reportVisit(),
        scheduled: accepted.filter((f) => f.accepted.until && !pinEntryFor(f)),
        devices,
        // The names of the network's own columns the table shows, in its
        // order: the summary's device list heads its columns with them. Kept
        // here because a binder's sheets are drawn after its documents are
        // put back.
        customColumns: reportCustomColumns().map((c) => c.name),
        groups,
        racks,
        connections,
        subnets,
        portMaps: reportPortMaps(),
        // One row per VLAN, printed only once a trunk is recorded (reportVlans).
        vlans: reportVlans(),
        capacity: reportCapacity(subnets),
        // By vendor, model and firmware (reportInventory), with the firmware
        // finding as this report counts it.
        inventory: reportInventory(all),
        // The saved searches the technical sheet prints (doc.searches), each
        // matched here so a binder's sheet is its own site's.
        searches: reportSearches(searchIds, devices),
        wifi: reportWifiSection(),
        providers: reportProviders(),
        // The network log (doc.log), printed only when its tick is on.
        log: Array.isArray(state.log) ? state.log.slice() : [],
        // The problem reports (doc.incidents), printed only when ticked.
        incidents: Array.isArray(state.incidents) ? state.incidents.slice() : [],
        counts: {
            devices: devices.length,
            connections: connections.length,
            subnets: subnets.length,
            critical: tally.critical,
            advisory: tally.advisory,
            accepted: tally.accepted
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
            if (typeof v === 'string' && v) tally.set(v, (tally.get(v) || 0) + 1);
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
    /* The summary for the client: the verdict first, big, in the colour of
       its answer; then the problems as a numbered list, not a table. */
    .verdict { border: 1px solid; border-radius: 6px; padding: 14px 16px; margin: 14px 0 6px; page-break-inside: avoid; }
    .verdict b { display: block; font-size: 20px; line-height: 1.2; }
    .verdict span { display: block; font-size: 14px; font-weight: 600; margin-top: 2px; }
    .verdict small { display: block; font-size: 10.5px; color: #475569; margin-top: 6px; }
    .verdict.ok { border-color: #a7f3d0; background: #ecfdf5; color: #065f46; }
    .verdict.warn { border-color: #fde68a; background: #fffbeb; color: #92400e; }
    .verdict.bad { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
    .todo { margin: 6px 0; padding-left: 20px; }
    .todo li { margin: 0 0 10px; page-break-inside: avoid; }
    .todo .sev { margin-right: 6px; }
    .summary-list td { padding: 3px 6px; }
    .changes { margin: 4px 0; padding-left: 18px; }
    .planned { margin: 4px 0; padding-left: 18px; }
    .planned li + li { margin-top: 4px; }
    .who-to-call { margin: 4px 0; padding-left: 18px; }
    .who-to-call li + li { margin-top: 6px; }
    .changes li { margin: 0 0 3px; }
    .who { margin-top: 18px; color: #334155; }
    .figure { margin: 10px 0 4px; text-align: center; page-break-inside: avoid; }
    .figure img { max-width: 100%; border: 1px solid #e2e8f0; border-radius: 4px; }
    .caption { font-size: 10px; color: #64748b; margin-top: 5px; }

    /* The compact inventory: one line per interface. A device's first line
       carries its name and its own fields; the lines after it only the
       interface, without the rule between them, so a device reads as one block. */
    .inv td { padding: 3px 6px; }
    /* The Inventory section's three tables: the counts stay narrow. */
    .invsum th.n, .invsum td.n { width: 64px; }
    .inv tr.cont td { border-top: 0; }
    .inv tr.dev td { border-top: 1px solid #e2e8f0; }
    .inv tr.guest > td:first-child { padding-left: calc(6px + var(--guest, 1) * 14px); }
    .inv tr.grp td { border-top: 1px solid #cbd5e1; padding-top: 8px; background: #f8fafc; }
    .inv tbody tr:first-child td { border-top: 0; }
    /* The switch port map: one small table per switch, headed by its name. */
    h3 { font-size: 12px; margin: 14px 0 4px; page-break-after: avoid; }
    h3 .muted { font-weight: 400; }
    .ports td:first-child, .ports th:first-child { width: 52px; }
    .free { font-size: 10.5px; margin: 2px 0 8px; }
    /* The changes table (js/changes.js): the change and the item stay narrow. */
    .changes td:first-child { width: 70px; white-space: nowrap; }
    .changes td:nth-child(2) { width: 34%; }
    /* The accepted findings: the reason is the column that matters. */
    .accepted td:last-child { color: #334155; }
    /* The diagram's landscape pages (diagramSheets): a named page turned on its
       side, and the picture filling it. Landscape, still no paper size. */
    @page topo-land { size: landscape; margin: 10mm; }
    .sheet.land { page: topo-land; max-width: 297mm; padding: 10mm; }
    .land-head { display: flex; align-items: center; gap: 12px; margin: 0 0 6px; font-size: 11px; color: #475569; }
    .land-head b { color: #0f172a; font-size: 12px; }
    .land-head span { flex: 1; }
    .dg { display: block; width: 100%; height: 170mm; border: 1px solid #e2e8f0; border-radius: 4px; }
    .dg-src { position: absolute; }
    .dg-cell rect { fill: rgba(37, 99, 235, 0.04); stroke: #2563eb; stroke-width: 1.5; stroke-dasharray: 6 4; vector-effect: non-scaling-stroke; }
    .dg-cell text { fill: #1d4ed8; font-weight: 700; paint-order: stroke; stroke: #fff; stroke-width: 3; vector-effect: non-scaling-stroke;
                    font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .dg-loc { flex: none; }
    .dg-loc rect + rect { fill: none; stroke: #94a3b8; stroke-width: 0.6; }
    .dg-loc rect.on { fill: #2563eb; stroke: #2563eb; }
    .dg-cell.off rect { fill: rgba(148, 163, 184, 0.28); stroke: #94a3b8; }
    .dg-cell.off text { fill: #94a3b8; }
    .dg-loc rect.off { fill: #e2e8f0; }
    /* The rack elevations: front and rear side by side, a unit a row, so a
       42U rack is a third of a page and never splits. */
    .rack { margin-bottom: 14px; }
    /* The elevations never split; the patch schedule under them may run on
       to the next page (a rack of 48-port switches is pages of cables), its
       head repeated there. */
    .elevs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; page-break-inside: avoid; break-inside: avoid; }
    .elev { table-layout: fixed; border: 1.5px solid #64748b; }
    .elev th { text-align: center; }
    .elev td { padding: 0 6px; height: 13px; line-height: 12px; font-size: 9px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
    .elev col.ruc { width: 30px; }
    .elev td.ru { text-align: right; color: #94a3b8; font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; border-right: 1.5px solid #64748b; }
    .elev td.rs { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .elev td.rs:not(.empty) { background: #f1f5f9; border: 1px solid #94a3b8; }
    .elev td.back { background: repeating-linear-gradient(135deg, #fff 0 4px, #e2e8f0 4px 5px); }
    .elev td.retired { color: #94a3b8; }
    .elev td.clash { background: #fef2f2; border-color: #b91c1c; color: #991b1b; }
    .elev .guests { color: #475569; font-style: italic; }
    /* A device's ports, a mark each, in the corner of its cell: a small
       faceplate over the end of its words. Hollow free, filled cabled (its
       cable's colour inline), ringed red with a problem. */
    .elev td.rs { position: relative; }
    .pstrip { position: absolute; right: 3px; bottom: 2px; display: grid; gap: 1px; padding: 1px 2px; background: #fff; border: 1px solid #cbd5e1; border-radius: 2px; }
    .pm { display: block; width: 3px; height: 3px; border: 0.5px solid #64748b; box-sizing: border-box; }
    .pm.on { background: #334155; border-color: #334155; }
    .pm.bad { outline: 1px solid #b91c1c; }
    .patch { margin-top: 8px; }
    .patch caption { caption-side: top; text-align: left; font-weight: 700; font-size: 10.5px; padding: 0 0 3px; }
    .patch thead { display: table-header-group; }
    .patch tr { page-break-inside: avoid; break-inside: avoid; }
    .patch td:nth-child(1), .patch td:nth-child(3) { width: 28%; }

    .note { font-size: 10.5px; color: #475569; background: #f8fafc; border-left: 3px solid #cbd5e1;
            padding: 9px 12px; margin: 8px 0; white-space: pre-wrap; }
    footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e2e8f0;
             font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; gap: 12px; }

    .toolbar { max-width: 210mm; margin: 0 auto 12px; display: flex; justify-content: flex-end; }
    .toolbar button { background: #0f172a; color: #fff; border: 0; border-radius: 4px;
                      padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; }

    @media print {
        body { background: #fff; padding: 0; }
        .sheet, .sheet.land { box-shadow: none; max-width: none; padding: 0; }
        /* On paper the page break IS the separation; the screen gap would print
           as a stripe of dead space at the top of every site's first page. */
        .sheet + .sheet { margin-top: 0; }
        .toolbar { display: none; }
        h2 { margin-top: 18px; }
    }`;
}

function findingsSection(findings, opts = {}) {
    if (!findings.length && opts.accepted) {
        return `<div class="clean"><b>${escapeHtml(t('No open findings: every one raised is accepted, with its reason, below.'))}</b></div>`;
    }
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

// The pins, each as one line: { key, names, check, detail, note, scheduled }.
// A pin whose finding is not raised at the moment still prints (somebody asked
// for it to be looked at), saying so. scheduled: the schedules its findings
// are under, [{ until, reason }] once each, so a finding both pinned and
// scheduled is one line saying both, not two.
function reportVisit() {
    return pinnedGroups(topologyFindings()).map((p) => {
        // Not an info finding's: the report leaves those out (reportModelNow),
        // so its schedule is planned nowhere, pinned or not.
        const sched = p.findings.filter((f) => f.level !== 'info' && f.accepted && f.accepted.until);
        return {
            key: p.entry.check,
            names: p.findings.length ? [...new Set(p.findings.map((f) => f.subject).filter(Boolean))].join(', ') : pinnedNames(p.entry),
            check: findingCheckName(p.entry.check),
            detail: p.findings.length ? p.findings.map((f) => sentenceCase(f.detail)).join(' ') : t('Not raised at the moment.'),
            note: p.entry.note || '',
            scheduled: [...new Map(sched.map((f) => [f.accepted.until + '\u0000' + f.accepted.reason, { until: f.accepted.until, reason: f.accepted.reason }])).values()]
        };
    });
}
// To check on the next visit: the pins, with what to look at and what is
// already scheduled for them.
function visitSection(visit) {
    const rows = visit.map((v, i) => `
        <tr>
            <td class="num">${i + 1}</td>
            <td><b>${escapeHtml(v.names || '—')}</b></td>
            <td class="muted">${escapeHtml(v.check)}</td>
            <td>${escapeHtml(v.detail)}</td>
            <td>${[v.note].concat((v.scheduled || []).map((s) => t('By {date}: {reason}', { date: s.until, reason: s.reason }))).filter(Boolean).map(escapeHtml).join('<br>')}</td>
        </tr>`).join('');
    return `<table class="accepted">
        <thead><tr><th></th><th>${t('Device')}</th><th>${t('Check')}</th><th>${t('Finding')}</th><th>${t('To check')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// Known / accepted: what was raised and accepted, with who-knows-why written
// down. The same columns as the findings, the reason in place of a severity;
// a scheduled one says until when.
function acceptedSection(accepted) {
    const rows = accepted.map((f, i) => `
        <tr>
            <td class="num">${i + 1}</td>
            <td><b>${escapeHtml(f.subject || '—')}</b></td>
            <td class="muted">${escapeHtml(f.check)}</td>
            <td>${escapeHtml(sentenceCase(f.detail))}</td>
            <td>${escapeHtml(f.accepted.until ? t('Scheduled until {date}: {reason}', { date: f.accepted.until, reason: f.accepted.reason }) : f.accepted.reason)}</td>
        </tr>`).join('');
    return `<p class="muted">${escapeHtml(t('Raised by the checks and accepted as known, for the reason given. They are not counted in the summary.'))}</p>
        <table class="accepted">
        <thead><tr><th></th><th>${t('Device')}</th><th>${t('Check')}</th><th>${t('Finding')}</th><th>${t('Reason')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// One small table per switch or access point, in port order. The Label and
// VLAN columns are there only on a switch whose ports carry them, so a
// report of a site nobody labelled reads as it always did.
// The racks: per rack, its path and height, front and rear side by side as
// two columns of units with each device's ports, then what is not drawn in
// them, then its patch schedule.
function racksSection(racks) {
    // A device's ports in the corner of its cell (reportRackPorts): a small
    // faceplate, so the words it sits over are covered, not crossed.
    const portStrip = (p) => `<span class="pstrip" style="grid-template-columns:repeat(${Math.min(p.perRow, p.marks.length)},3px)">${p.marks.map((m) =>
        `<i class="${['pm', m.cabled ? 'on' : '', m.bad ? 'bad' : ''].filter(Boolean).join(' ')}"${m.color ? ` style="background:${escapeHtml(m.color)}"` : ''}></i>`).join('')}</span>`;
    const face = (f, rack) => {
        // The number printed beside unit u: from the top on a rack set so.
        const no = (u) => (rack.topDown ? rack.top - u + 1 : u);
        const rows = f.rows.map((r) => {
            const unit = Array.from({ length: r.span }, (_, k) => r.u - k);
            if (r.empty) return `<tr><td class="ru">${no(r.u)}</td><td class="rs empty"></td></tr>`;
            const cell = r.items.map((it) => `<b>${escapeHtml(it.name)}</b>`
                + ` <span class="muted">${escapeHtml([t(it.typeName), it.units, it.back ? t('back') : it.full ? '' : t('half depth'), it.status ? statusName(it.status) : ''].filter(Boolean).join(' · '))}</span>`
                + (it.guests && it.guests.length ? ` <span class="guests">${escapeHtml(t('Runs here: {names}', { names: it.guests.join(', ') }))}</span>` : '')
                + (it.ports ? portStrip(it.ports) : '')).join(' / ');
            const cls = ['rs', r.clash ? 'clash' : '', r.items.every((it) => it.back) ? 'back' : '',
                r.items.some((it) => it.status === 'retired') ? 'retired' : ''].filter(Boolean).join(' ');
            return unit.map((u, k) => `<tr><td class="ru">${no(u)}</td>${k === 0 ? `<td class="${cls}" rowspan="${r.span}">${cell}</td>` : ''}</tr>`).join('');
        }).join('');
        // As wide as the rack against a 19" one, as the rack view draws it
        // (a 23" one fills its half of the page too: there is no wider).
        const pct = Math.round(Math.min(1, (rack.inches || 19) / 19) * 100);
        return `<table class="elev"${pct < 100 ? ` style="width:${pct}%"` : ''}><colgroup><col class="ruc"><col></colgroup><thead><tr><th colspan="2">${escapeHtml(t(f.face === 'rear' ? 'Rear' : 'Front'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    return racks.map((rack) => {
        const notes = [
            rack.outside.length ? `<p class="free"><b>${escapeHtml(t('Outside its units'))}:</b> ${escapeHtml(rack.outside.join(', '))}</p>` : '',
            rack.unplaced.length ? `<p class="free"><b>${escapeHtml(t('Not placed yet'))}:</b> ${escapeHtml(rack.unplaced.join(', '))}</p>` : '',
            ...(rack.hosts || []).map((h) => `<p class="free"><b>${escapeHtml(t('Runs on {host}', { host: h.name }))}:</b> ${escapeHtml(h.guests.join(', '))}</p>`)
        ].join('');
        // The patch schedule, a row per cable, in the rack's order. An
        // untagged cable says so in its Tag cell: the editor's finding about
        // it is an info note the report leaves out, and the gap is still
        // what the person at the rack needs to see.
        const sched = (rack.schedule || []).map((r) => `<tr><td class="mono">${escapeHtml(r.from)}</td>`
            + `<td class="mono">${r.tag ? escapeHtml(r.tag) : `<span class="muted">${escapeHtml(t('no tag'))}</span>`}</td>`
            + `<td class="mono">${escapeHtml(r.to)}${r.where ? ` <span class="muted">(${escapeHtml(r.where)})</span>` : ''}</td>`
            + `<td>${escapeHtml(r.color)}</td><td>${escapeHtml(r.length)}</td><td>${escapeHtml(r.via)}</td></tr>`).join('');
        return `<div class="rack">
        <h3>${escapeHtml(rack.path)} <span class="muted">${escapeHtml(rack.size || `${rack.top}U`)}${rack.topDown ? ` · ${escapeHtml(t('numbered from the top'))}` : ''}</span></h3>
        <div class="elevs">${rack.faces.map((f) => face(f, rack)).join('')}</div>
        ${notes}
        ${sched ? `<table class="patch"><caption>${escapeHtml(t('Patch schedule'))}</caption><thead><tr><th>${escapeHtml(t('Device · port'))}</th><th>${escapeHtml(t('Tag'))}</th><th>${escapeHtml(t('Far end'))}</th>`
            + `<th>${escapeHtml(t('Colour'))}</th><th>${escapeHtml(t('Length'))}</th><th>${escapeHtml(t('Via'))}</th></tr></thead><tbody>${sched}</tbody></table>` : ''}
    </div>`;
    }).join('');
}

// A switch with nothing cabled to it yet has its heading and its free ports,
// no table (a bond with no cable on it still takes its ports, and it says
// so). One the port-capacity note names (portCapacityNote) is marked in its
// heading, as the Capacity section lists it. A switch whose port count was
// never set says so after its total, which is then a guess (the node panel's
// 'Port count not set, so the total is a guess.'), and has no Free line: its
// free ports are not known.
function portMapsSection(maps) {
    return maps.map((m) => `
        <h3>${escapeHtml(m.name)} <span class="muted">· ${escapeHtml(t(m.typeName))} · ${escapeHtml(t(m.total === 1 ? '{used} of {total} port used' : '{used} of {total} ports used', { used: m.used, total: m.total }))}${m.explicit ? '' : ` · ${escapeHtml(t('port count not set'))}`}${m.poe && m.poe.budget !== null ? ` · ${escapeHtml(t('PoE: {used} of {budget} W budget', { used: wattsText(m.poe.used), budget: wattsText(m.poe.budget) }))}` : ''}</span>${m.nearlyFull ? ` <span class="sev warn">${escapeHtml(t(m.full ? 'No free port' : 'Almost full'))}</span>` : ''}</h3>
        ${!m.rows.length ? `<p class="muted">${escapeHtml(t(m.used ? 'No cable is plugged in yet. Its bond ports count as in use.' : 'Nothing is plugged in yet.'))}</p>` : `<table class="ports">
        <thead><tr><th>${t('Port')}</th>${m.hasLabels ? `<th>${t('Label')}</th>` : ''}${m.hasVlans ? `<th>${m.hasTagged ? escapeHtml(t('Untagged')) : 'VLAN'}</th>` : ''}${m.hasTagged ? `<th>${escapeHtml(t('Tagged'))}</th>` : ''}${m.hasPoe ? '<th>PoE</th>' : ''}<th>${t('Device')}</th><th>${t('Interface')}</th><th>${t('Address')}</th><th>${t('Cable')}</th></tr></thead>
        <tbody>${m.rows.map((r) => `<tr${r.free ? ' class="free-port"' : ''}>
            <td class="mono"><b>${escapeHtml(r.label)}</b></td>
            ${m.hasLabels ? `<td>${escapeHtml(r.portLabel)}</td>` : ''}
            ${m.hasVlans ? `<td class="mono">${r.vlan === null ? '' : r.vlan}</td>` : ''}
            ${m.hasTagged ? `<td class="mono">${r.tagged === null || r.tagged === undefined ? '' : escapeHtml(r.tagged)}</td>` : ''}
            ${m.hasPoe ? `<td class="mono">${r.poe === null || r.poe === undefined ? '' : escapeHtml(poeText(r.poe))}</td>` : ''}
            ${r.free ? `<td class="muted" colspan="4">${escapeHtml(t('Free'))}</td>` : `
            <td><b>${escapeHtml(r.peer)}</b></td>
            <td class="mono muted">${escapeHtml(r.peerIface)}</td>
            <td class="mono">${escapeHtml(r.ip) || '<span class="muted">—</span>'}</td>
            <td>${r.cable ? `<span class="mono">${escapeHtml(r.cable)}</span> · ` : ''}<span class="muted">${escapeHtml(t(r.medium))}</span></td>`}
        </tr>`).join('')}</tbody></table>`}
        ${m.free && m.explicit ? `<p class="free muted">${escapeHtml(t('Free: {ports}', { ports: m.free }))}</p>` : ''}`).join('');
}

// An interface's own line: its name and what kind of port it is, then its
// address and MAC in columns of their own.
function ifaceNameCell(iface) {
    const kind = iface.bond ? `${t('bond')} · ${iface.bond}` : iface.member ? t('bond member') : iface.wireless ? t('radio') : '';
    return `<b>${escapeHtml(iface.name)}</b>${kind ? ` <span class="muted">${escapeHtml(kind)}</span>` : ''}`;
}

// The compact inventory: one line per interface, so a site of three hundred
// devices is a few pages a technician can scan down, not a stack of cells. A
// device's name, type, gateway, DNS and model are on its first line; a device
// with no interface recorded still gets one line, which says so.
//
// With groups (reportGroups), the inventory is laid out under them in tree
// order: a heading line per group that holds devices itself, its path and
// kind, then those devices, and the devices in no group last under a heading
// of their own. A device under its group's heading says only its units, if
// any; the path is the heading. A site with no groups prints as before.
// A host's guests listed straight under it, and a container in a VM under
// the VM, each marked with its depth (d.guest), in the order given otherwise.
// Only within `list`: a guest whose host is under another heading (a scratch
// copy that skipped repairHosts) keeps its own place. Pure.
function hostOrdered(list) {
    const here = new Set(list.map((d) => d.id));
    const under = (d) => !!d.hostId && d.hostId !== d.id && here.has(d.hostId);
    const kids = new Map();
    list.forEach((d) => { if (under(d)) { if (!kids.has(d.hostId)) kids.set(d.hostId, []); kids.get(d.hostId).push(d); } });
    if (!kids.size) return list;
    const out = [];
    const seen = new Set();
    const walk = (d, depth) => {
        if (seen.has(d)) return;
        seen.add(d);
        out.push(depth ? Object.assign({}, d, { guest: depth }) : d);
        (kids.get(d.id) || []).forEach((k) => walk(k, depth + 1));
    };
    list.forEach((d) => { if (!under(d)) walk(d, 0); });
    list.forEach((d) => walk(d, 0));   // a loop nothing outside reaches (never after repairHosts)
    return out;
}

function devicesSection(devices, groups) {
    // Gateway, DNS, Model, Firmware / OS: the schema rows that carry a report
    // column (reportCellText joins the vendor into Model).
    const cols = reportColumns();
    const empty = '<span class="muted">—</span>';
    const known = new Set((groups || []).map((g) => g.id));
    const grouped = known.size > 0 && devices.some((d) => d.groupId && known.has(d.groupId));
    const deviceRows = (d) => {
        const extra = [
            d.ports ? `${escapeHtml(t('Ports'))}: ${d.ports.used}/${d.ports.total}` : '',
            d.poeDraw !== null && d.poeDraw !== undefined ? escapeHtml(`PoE ${wattsText(d.poeDraw)} W`) : '',
            d.nat ? escapeHtml(t('NAT')) : '',
            d.allowedPorts ? `${escapeHtml(t('Allowed'))}: ${escapeHtml(d.allowedPorts)}` : ''
        ].filter(Boolean).join(' · ');
        // The Asset group (js/assets.js): the tag, serial and place under the
        // name, and a status other than in service, which a reader of the
        // register has to see.
        const where = grouped && d.groupId ? d.rackSpan : (d.place !== undefined ? d.place : d.location);
        const asset = [d.assetTag ? `${t('Asset tag')} ${d.assetTag}` : '', d.serial ? `${t('Serial number')} ${d.serial}` : '', where,
            d.provider ? `${t('Provider')}: ${d.provider}` : '']
            .filter(Boolean).join(' · ');
        // The network's own columns, one line of "Name: value" under the
        // asset line: the inventory's columns are Topo's, and a site's own
        // facts read best beside the device they are about.
        const mine = (d.custom || []).map((x) => `${x.name}: ${x.text}`).join(' · ');
        const upkeep = d.upkeep || '';
        const status = d.status && d.status !== 'active' ? ` <span class="muted">(${escapeHtml(statusName(d.status))})</span>` : '';
        // A guest, under its host: stepped in, and saying what it runs on.
        const runs = d.hostId ? `<br><span class="muted">${escapeHtml(t('Runs on {host}', { host: d.host }))}</span>` : '';
        const guestCls = d.guest ? ` guest" style="--guest:${Math.min(d.guest, HOST_DEPTH_MAX)}` : '';
        const ifaces = d.interfaces.length ? d.interfaces : [null];
        return ifaces.map((iface, i) => {
            const first = i === 0;
            const own = iface
                ? `<td>${ifaceNameCell(iface)}</td>
            <td class="mono">${escapeHtml(iface.ip) || empty}</td>
            <td class="mono">${iface.mac ? `${escapeHtml(iface.mac)}${iface.vendor ? ` <span class="muted">· ${escapeHtml(iface.vendor)}</span>` : ''}` : empty}</td>`
                : `<td colspan="3"><span class="muted">${escapeHtml(t('none recorded'))}</span></td>`;
            if (!first) return `<tr class="cont"><td></td><td></td>${own}${cols.map(() => '<td></td>').join('')}</tr>`;
            return `<tr class="dev${guestCls}">
            <td>${d.guest ? '<span class="muted">↳ </span>' : ''}<b>${escapeHtml(d.name)}</b>${status}${runs}${asset ? `<br><span class="muted">${escapeHtml(asset)}</span>` : ''}${upkeep ? `<br><span class="muted">${escapeHtml(upkeep)}</span>` : ''}${mine ? `<br><span class="muted">${escapeHtml(mine)}</span>` : ''}${d.notes ? `<br><span class="muted">${escapeHtml(d.notes)}</span>` : ''}</td>
            <td>${escapeHtml(t(d.typeName))}${extra ? `<br><span class="muted">${extra}</span>` : ''}</td>
            ${own}
            ${cols.map((f) => `<td${f.report.mono ? ' class="mono"' : ''}>${escapeHtml(reportCellText(d, f)) || empty}</td>`).join('\n            ')}
        </tr>`;
        }).join('');
    };
    const width = 5 + cols.length;
    const heading = (title, note) => `<tr class="grp"><td colspan="${width}"><b>${escapeHtml(title)}</b>${note ? ` <span class="muted">· ${escapeHtml(note)}</span>` : ''}</td></tr>`;
    let rows;
    if (!grouped) rows = hostOrdered(devices).map(deviceRows).join('');
    else {
        const by = new Map();
        devices.forEach((d) => { const k = d.groupId && known.has(d.groupId) ? d.groupId : ''; if (!by.has(k)) by.set(k, []); by.get(k).push(d); });
        const count = (n) => t(n === 1 ? '{n} device' : '{n} devices', { n });
        rows = groups.filter((g) => by.has(g.id)).map((g) => heading(g.path, `${g.kindName}${g.uHeight ? ` ${g.uHeight}U` : ''} · ${count(by.get(g.id).length)}`)
            + hostOrdered(by.get(g.id)).map(deviceRows).join('')).join('')
            + (by.has('') ? heading(t('Not in a group'), count(by.get('').length)) + hostOrdered(by.get('')).map(deviceRows).join('') : '');
    }
    return `<table class="inv">
        <thead><tr><th>${t('Device')}</th><th>${t('report::Type')}</th><th>${t('Interface')}</th><th>${t('Address')}</th><th>${t('MAC')}</th>${cols.map((f) => `<th>${t(f.report.column)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// The Cable column (label, length, colour, via) appears only when some cable
// says something about itself, so a drawing that never used it reports as
// it did before the column existed.
function connectionsSection(connections) {
    if (!connections.length) return `<p class="muted">${escapeHtml(t('No connections recorded.'))}</p>`;
    const withCable = connections.some((c) => c.label || c.length || c.color || c.via || c.provider);
    const cableCell = (c) => {
        const facts = [c.length, c.color].filter(Boolean).join(' · ');
        return [c.label ? `<b class="mono">${escapeHtml(c.label)}</b>` : '', facts ? `<span class="muted">${escapeHtml(facts)}</span>` : '',
            c.via ? `<span class="mono muted">${escapeHtml(c.via)}</span>` : '',
            c.provider ? `<span class="muted">${escapeHtml(t('Provider'))}: ${escapeHtml(c.provider)}</span>` : ''].filter(Boolean).join('<br>');
    };
    const rows = connections.map((c) => `<tr>
        <td><b>${escapeHtml(c.from)}</b></td>
        <td class="mono muted">${escapeHtml(c.fromIface)}</td>
        <td><b>${escapeHtml(c.to)}</b></td>
        <td class="mono muted">${escapeHtml(c.toIface)}</td>
        <td>${escapeHtml(t(c.medium))}</td>${withCable ? `
        <td>${cableCell(c)}</td>` : ''}
    </tr>`).join('');
    return `<table>
        <thead><tr><th>${t('From')}</th><th>${t('Interface')}</th><th>${t('To')}</th><th>${t('Interface')}</th><th>${t('Medium')}</th>${withCable ? `<th>${t('Cable')}</th>` : ''}</tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// Wi-Fi: the networks (SSID, security, bands, subnet and VLAN, who
// broadcasts it, who is on it), then a block per access point: a row per
// band with its channel and width ("auto" when the radio leaves it to
// itself), the SSIDs on it and the clients with their signal. SSID, the
// bands and dBm are the trade's words and are printed as written.
function wifiSection(w) {
    const muted = (text) => `<span class="muted">${escapeHtml(text)}</span>`;
    const dash = muted('—');
    const nets = w.networks.length ? `<table class="wifi">
        <thead><tr><th>SSID</th><th>${t('Security')}</th><th>${t('Bands')}</th><th>${t('Subnet')}</th><th>${t('Access points')}</th><th>${t('Clients')}</th></tr></thead>
        <tbody>${w.networks.map((n) => `<tr>
            <td><b>${escapeHtml(n.ssid || t('Wi-Fi network'))}</b>${n.hidden ? `<br>${muted(t('Hidden network'))}` : ''}</td>
            <td>${n.securityName ? escapeHtml(n.securityName) : dash}</td>
            <td class="mono">${escapeHtml(n.bandsText)}</td>
            <td>${n.subnet ? `${n.subnetName ? `${escapeHtml(n.subnetName)}<br>` : ''}<span class="mono">${escapeHtml(n.subnet)}</span>${n.vlan !== null ? `<br>${muted(`VLAN ${n.vlan}`)}` : ''}` : dash}</td>
            <td>${n.aps.length ? escapeHtml(n.aps.join(', ')) : dash}</td>
            <td>${n.clients.length ? escapeHtml(n.clients.join(', ')) : dash}</td>
        </tr>`).join('')}</tbody></table>` : `<p class="muted">${escapeHtml(t('No Wi-Fi networks recorded.'))}</p>`;
    const channel = (r) => (r.channel !== null ? `<span class="mono">${r.channel}</span>` : muted(t('auto')));
    const width = (r) => (r.width !== null ? `<span class="mono">${r.width} MHz</span>` : muted(t('auto')));
    const client = (c) => `${escapeHtml(c.name)}${c.signal !== null ? ` <span class="mono muted">${c.signal} dBm</span>` : ''}`;
    const aps = w.aps.map((ap) => `
        <h3>${escapeHtml(ap.name)}${ap.standard ? ` <span class="muted">· ${escapeHtml(ap.standard)}</span>` : ''}</h3>
        ${ap.rows.length ? `<table class="radio">
        <thead><tr><th>${t('Band')}</th><th>${t('Channel')}</th><th>${t('Width')}</th><th>SSID</th><th>${t('Clients')}</th></tr></thead>
        <tbody>${ap.rows.map((r) => `<tr>
            <td class="mono">${r.band ? escapeHtml(wifiBandName(r.band)) : muted(t('Band not known'))}${r.iface ? `<br>${muted(r.iface)}` : ''}</td>
            <td>${r.band ? channel(r) : dash}</td>
            <td>${r.band ? width(r) : dash}</td>
            <td>${r.ssids.length ? escapeHtml(r.ssids.join(', ')) : dash}</td>
            <td>${r.clients.length ? r.clients.map(client).join('<br>') : dash}</td>
        </tr>`).join('')}</tbody></table>` : `<p class="muted">${escapeHtml(t('Its radio is not described.'))}</p>`}`).join('');
    return nets + aps;
}

// A declared network prints its name, VLAN, purpose, gateway, DNS and DHCP
// under its address; one only implied by the addressing says so, since
// nobody has said what it is for.
function subnetsSection(subnets) {
    if (!subnets.length) return `<p class="muted">${escapeHtml(t('No addressing recorded.'))}</p>`;
    const muted = (text) => `<span class="muted">${escapeHtml(text)}</span>`;
    const rows = subnets.map((s) => {
        const about = s.declared
            ? [s.name ? `<b>${escapeHtml(s.name)}</b>` : '', s.vlan ? escapeHtml(`VLAN ${s.vlan}`) : '', s.purpose ? muted(s.purpose) : '']
            : [muted(t('Not declared: implied by the addresses'))];
        const service = [
            s.gateway ? `${escapeHtml(t('Gateway'))} <span class="mono">${escapeHtml(s.gateway)}</span>` : '',
            s.dns ? `${escapeHtml(t('DNS'))} <span class="mono">${escapeHtml(s.dns)}</span>` : '',
            s.dhcp ? `${escapeHtml(t('DHCP'))}${s.dhcpFirst || s.dhcpLast ? ` <span class="mono">${escapeHtml(t('pool {range}', { range: `${s.dhcpFirst || '?'}–${s.dhcpLast || '?'}` }))}</span>` : ''}` : ''
        ].filter(Boolean);
        return `<tr>
        <td><span class="mono"><b>${escapeHtml(s.network)}</b></span>${about.filter(Boolean).map((x) => `<br>${x}`).join('')}</td>
        <td>${escapeHtml(s.kind === 'ipv6' ? 'IPv6' : 'IPv4')} · ${escapeHtml(t(s.isPrivate ? 'Private' : 'Public / routable'))}${service.length ? `<br>${service.join(' · ')}` : ''}</td>
        <td>${s.devices.length}</td>
        <td>${escapeHtml(s.devices.join(', '))}</td>
    </tr>`;
    }).join('');
    return `<table>
        <thead><tr><th>${t('Network')}</th><th>${t('Kind')}</th><th>${t('Devices')}</th><th>${t('Members')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// The VLANs section (reportVlans): its number, its subnet (name, CIDR) and
// gateway, its access ports and the trunks that carry it, by device and
// port. '' when there is nothing to print.
function vlansSection(rows) {
    if (!rows || !rows.length) return '';
    const muted = (text) => `<span class="muted">${escapeHtml(text)}</span>`;
    const body = rows.map((r) => `<tr>
        <td class="mono"><b>${r.vlan === 'all' ? escapeHtml(t('All VLANs')) : r.vlan}</b></td>
        <td>${r.subnets.length ? r.subnets.map((x) => `<span class="mono">${escapeHtml(x.cidr)}</span>${x.name ? ` ${escapeHtml(x.name)}` : ''}`).join('<br>') : muted('—')}</td>
        <td class="mono">${r.subnets.some((x) => x.gateway) ? r.subnets.filter((x) => x.gateway).map((x) => escapeHtml(x.gateway)).join('<br>') : muted('—')}</td>
        <td>${r.access || muted('—')}</td>
        <td>${r.trunks.length ? r.trunks.map((x) => `<b>${escapeHtml(x.device)}</b> <span class="mono">${escapeHtml(x.ports.join(', '))}</span>`).join('<br>') : muted('—')}</td>
    </tr>`).join('');
    return `<p class="muted">${escapeHtml(t('Each VLAN the register names: its subnet, how many ports have it untagged, and the trunks that carry it tagged. What is written only; nothing here is checked yet.'))}</p>
    <table class="vlans">
        <thead><tr><th>VLAN</th><th>${t('Subnet')}</th><th>${t('Gateway')}</th><th>${escapeHtml(t('Access ports'))}</th><th>${escapeHtml(t('Carried tagged on'))}</th></tr></thead>
        <tbody>${body}</tbody></table>`;
}

// The Inventory section (reportInventory): three compact tables, By vendor,
// By model (with each model's firmware versions, a mismatch marked as its
// firmware finding is) and By firmware / OS. Retired devices are counted in
// a muted column of their own. Text only: nothing in it reaches outside the
// page. '' when no device has a vendor, a model or a firmware.
const hasInventory = (inv) => !!inv && !!inv.any;
function inventorySection(inv) {
    if (!hasInventory(inv)) return '';
    const muted = (text) => `<span class="muted">${escapeHtml(text)}</span>`;
    const value = (r, text) => (r.value ? escapeHtml(text === undefined ? r.value : text) || muted('—') : muted(t('Not recorded')));
    const counts = (r) => `<td class="n">${r.count}</td><td class="n">${r.retired ? muted(String(r.retired)) : muted('—')}</td>`;
    const head = (cells) => `<thead><tr>${cells.map((c) => `<th${c.n ? ' class="n"' : ''}>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
    const N = (label) => ({ label, n: true }), L = (label) => ({ label });
    const versions = (r) => {
        if (!r.firmware.length) return muted('—');
        const text = escapeHtml(inventoryVersionsText(r.firmware));
        if (r.mismatch === 'open') return `<span class="sev warn">${text}</span>`;
        if (r.mismatch === 'accepted') return `${text} ${muted('· ' + t('Accepted'))}`;
        return text;
    };
    const vendorRows = inv.vendors.map((r) => `<tr><td>${value(r)}</td>${counts(r)}</tr>`).join('');
    const modelRows = inv.models.map((r) => `<tr><td>${r.value ? (escapeHtml(r.vendor) || muted('—')) : muted('—')}</td><td>${value(r, r.model)}</td>${counts(r)}<td class="mono">${r.value ? versions(r) : muted('—')}</td></tr>`).join('');
    const fwRows = inv.firmware.map((r) => `<tr><td class="mono">${value(r)}</td>${counts(r)}</tr>`).join('');
    return `<p class="muted">${escapeHtml(t('Devices counts the ones in service or planned; retired ones are counted apart.'))}</p>
    <h3>${escapeHtml(t('By vendor'))}</h3>
    <table class="invsum">${head([L(t('Vendor')), N(t('Devices')), N(t('Retired'))])}<tbody>${vendorRows}</tbody></table>
    <h3>${escapeHtml(t('By model'))}</h3>
    <table class="invsum">${head([L(t('Vendor')), L(t('Model')), N(t('Devices')), N(t('Retired')), L(t('Firmware / OS'))])}<tbody>${modelRows}</tbody></table>
    <h3>${escapeHtml(t('By firmware / OS'))}</h3>
    <table class="invsum">${head([L(t('Firmware / OS')), N(t('Devices')), N(t('Retired'))])}<tbody>${fwRows}</tbody></table>`;
}

// The Capacity section (reportCapacity): '' when there is nothing in it, so
// the sheet leaves the heading out too.
const hasCapacity = (cap) => !!cap && ((cap.ports || []).length > 0 || (cap.subnets || []).length > 0 || (cap.poe || []).length > 0);
// sec: the sections ticked (reportSections); a table not ticked is left
// out, and with none left the section is '' and its heading goes too.
function capacitySection(cap, sec = reportSections()) {
    if (!hasCapacity(cap)) return '';
    return (sec.capAddresses ? capacityAddresses(cap.subnets || []) : '')
        + (sec.capPorts ? capacityPorts(cap.ports || [], sec.ports) : '')
        + (sec.capPoe ? capacityPoe(cap.poe || []) : '');
}
// The PoE table: each switch or AP with a budget, the draw of the devices
// on its PoE ports and what is left; a figure under nothing is marked.
function capacityPoe(rows) {
    if (!rows.length) return '';
    const body = rows.map((r) => `<tr>
        <td><b>${escapeHtml(r.name)}</b> <span class="muted">${escapeHtml(t(r.typeName))}</span></td>
        <td class="mono">${escapeHtml(wattsText(r.budget))}</td>
        <td class="mono">${escapeHtml(wattsText(r.used))}</td>
        <td class="mono">${r.left < 0 ? `<span class="sev warn">${escapeHtml(wattsText(r.left))}</span>` : escapeHtml(wattsText(r.left))}</td>
        <td>${r.devices}</td>
    </tr>`).join('');
    return `<h3>PoE</h3>
    <p class="muted">${escapeHtml(t('Each switch with a PoE budget: what the devices on its PoE ports draw, as recorded, and what is left.'))}</p>
    <table class="capacity poe">
        <thead><tr><th>${t('Device')}</th><th>${escapeHtml(t('Budget (W)'))}</th><th>${escapeHtml(t('Drawn (W)'))}</th><th>${escapeHtml(t('Left (W)'))}</th><th>${t('Devices')}</th></tr></thead>
        <tbody>${body}</tbody></table>`;
}
// The Addresses table: every subnet the Addressing table lists, its size, how
// many addresses are in use (its devices, and its own gateway and DNS, drawn
// or not) and how many are free, which is what Add devices can still hand
// out. An implied subnet is muted, as in Addressing; an IPv6 one says
// 2^bits and its use only; one the address-capacity note names has its free
// count marked, without counting it anywhere.
// A subnet that records a DHCP pool adds three columns for every row: the
// pool as written, how many of its addresses are recorded here (never the
// leases, which Topo cannot see) and the fixed addresses free outside it,
// marked when the note names it. A pool that does not count says so.
function capacityAddresses(subnets) {
    if (!subnets.length) return '';
    const muted = (text) => `<span class="muted">${escapeHtml(text)}</span>`;
    const pooled = (s) => !!(s.pool && s.pool.valid);
    const pools = subnets.some((s) => s.pool);
    const poolCells = (s) => {
        if (!s.pool) return `<td>${muted('—')}</td><td>${muted('—')}</td><td>${muted('—')}</td>`;
        const range = `<span class="mono">${escapeHtml(`${s.pool.first || '?'}–${s.pool.last || '?'}`)}</span>`;
        if (!s.pool.valid) return `<td>${range}<br>${muted(t('not counted'))}</td><td>${muted('—')}</td><td>${muted('—')}</td>`;
        const fixed = s.fixed.free === null ? muted('—') : s.near ? `<span class="sev warn">${s.fixed.free}</span>` : s.fixed.free;
        return `<td>${range}</td><td>${s.pool.used} / ${s.pool.size === null ? '—' : s.pool.size}</td><td>${fixed}</td>`;
    };
    const rows = subnets.map((s) => `<tr>
        <td><span class="mono"><b>${escapeHtml(s.network)}</b></span>${s.declared ? (s.name ? ` ${escapeHtml(s.name)}` : '') : `<br>${muted(t('Not declared: implied by the addresses'))}`}</td>
        <td class="mono">${s.size === null ? `2^${s.bits}` : s.size}</td>
        <td>${s.used}</td>
        <td>${s.size === null ? muted('—') : s.near && !pooled(s) ? `<span class="sev warn">${s.free}</span>` : s.free}</td>
        ${pools ? poolCells(s) : ''}
    </tr>`).join('');
    return `<h3>${escapeHtml(t('Addresses'))}</h3>
    <p class="muted">${escapeHtml(t('In use counts the devices on each subnet and its own gateway and DNS servers, drawn or not. Free is what can still be handed out.'))}</p>
    ${pools ? `<p class="muted">${escapeHtml(t('In pool counts the addresses inside the DHCP pool that are recorded here, not the leases the server has handed out. Fixed free is what is left outside the pool.'))}</p>` : ''}
    <table class="capacity addresses">
        <thead><tr><th>${t('Subnet')}</th><th>${t('Size')}</th><th>${t('In use')}</th><th>${t('Free')}</th>${pools ? `<th>${t('DHCP pool')}</th><th>${t('In pool')}</th><th>${t('Fixed free')}</th>` : ''}</tr></thead>
        <tbody>${rows}</tbody></table>`;
}
// mapped: the Switch ports section prints too (sec.ports), so the intro can
// point at it; without it the pointer is left off.
function capacityPorts(ports, mapped = true) {
    if (!ports.length) return '';
    const rows = ports.map((r) => `<tr>
        <td><b>${escapeHtml(r.name)}</b> <span class="muted">${escapeHtml(t(r.typeName))}</span></td>
        <td>${r.total}</td>
        <td>${r.used}</td>
        <td><span class="sev warn">${r.free}</span>${r.freePorts ? ` <span class="mono">${escapeHtml(r.freePorts)}</span>` : ''}</td>
    </tr>`).join('');
    return `<h3>${escapeHtml(t('Ports'))}</h3>
    <p class="muted">${escapeHtml(t(mapped ? 'Switches and access points with few or no free ports left. Every port of every switch is under Switch ports.' : 'Switches and access points with few or no free ports left.'))}</p>
    <table class="capacity">
        <thead><tr><th>${t('Device')}</th><th>${t('Ports')}</th><th>${t('In use')}</th><th>${t('Free ports')}</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// The Address history section (js/trail.js trailReportHistory): one table,
// a device per run of rows (its name on the first), each value that changed
// since the previous report with the value now first, then the past ones
// newest first with the dates each was seen and how it was recorded. A
// removed device says when it went. Print-safe: text only, no link out.
function addressHistorySection(h) {
    const muted = (text) => `<span class="muted">${escapeHtml(text)}</span>`;
    const lead = `<p class="muted">${escapeHtml(h.since !== null
        ? t('Recorded in this browser at each back-up and report since the report of {date}: the addresses, MACs, switch ports, groups and names that changed, with the dates each was seen.', { date: localDateOf(h.since) })
        : t('Recorded in this browser at each back-up and report since {date}: the addresses, MACs, switch ports, groups and names that changed, with the dates each was seen.', { date: localDateOf(h.first) }))}</p>`;
    if (!h.devices.length) return `${lead}<p>${escapeHtml(t('Nothing has changed since then.'))}</p>`;
    const kinds = { backup: 'back-up', report: 'report', file: 'file' };
    const range = (s) => (s.first === s.last ? localDateOf(s.first) : t('{from} → {to}', { from: localDateOf(s.first), to: localDateOf(s.last) }));
    const val = (f, text) => (f === 'ip' || f === 'mac' ? `<span class="mono">${escapeHtml(text)}</span>` : escapeHtml(text));
    const rows = [];
    h.devices.forEach((d) => {
        let first = true;
        const who = () => {
            if (!first) return '';
            first = false;
            const note = d.gone !== null ? t('removed on {date}', { date: localDateOf(d.gone) })
                : d.goneAfter ? t('removed after {date}', { date: localDateOf(d.goneAfter) }) : '';
            return `<b>${escapeHtml(d.name)}</b>${note ? `<br>${muted(note)}` : ''}`;
        };
        d.blocks.forEach((b) => {
            const lines = [];
            if (b.now) lines.push([val(b.f, b.now), muted(b.since !== null ? t('since {date}', { date: localDateOf(b.since) }) : t('now'))]);
            b.past.forEach((s) => lines.push([val(b.f, s.txt || s.val), `${escapeHtml(range(s))} ${muted(t(kinds[s.kind] || s.kind))}`]));
            lines.forEach(([v, when], i) => rows.push(`<tr class="${first ? 'dev' : 'cont'}">
        <td>${who()}</td>
        <td>${i === 0 ? escapeHtml(b.label) : ''}</td>
        <td>${v}</td>
        <td>${when}</td>
    </tr>`));
        });
    });
    // The inventory's row rules (.inv tr.dev / tr.cont), so a device reads
    // as one block and the stylesheet every report prints stays as it was.
    return `${lead}<table class="inv addrhist">
        <thead><tr><th>${escapeHtml(t('Device'))}</th><th>${escapeHtml(t('Field'))}</th><th>${escapeHtml(t('Value'))}</th><th>${escapeHtml(t('Seen'))}</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table>`;
}

// The Saved searches section (reportSearches): one block per search, its
// name, the search as typed in mono (prefixes are syntax, never translated),
// how many devices it matched, then a table of them with Device first. A
// search that is not understood, or that reads what one browser remembers,
// says so in a muted line and prints no table.
function searchesSection(list) {
    const muted = (html) => `<p class="muted">${html}</p>`;
    const marker = '\u0001q\u0001';
    return list.map((s) => {
        const said = escapeHtml(t('Search: {query}', { query: marker })).replace(marker, () => `<span class="mono">${escapeHtml(s.query)}</span>`);
        const head = `<h3>${escapeHtml(s.name)}</h3>`;
        if (s.local) return `${head}${muted(`${said}<br>${escapeHtml(t('Not printed: {terms} reads what this browser remembers, so it would match differently on another computer.', { terms: s.local }))}`)}`;
        if (s.error) return `${head}${muted(`${said}<br>${escapeHtml(t('Not understood, so nothing matches: {terms}', { terms: s.error }))}`)}`;
        const line = muted(`${said} · ${escapeHtml(t('Devices: {n} of {total}', { n: s.rows.length, total: s.total }))}`);
        if (!s.rows.length) return `${head}${line}${muted(escapeHtml(t('No devices match.')))}`;
        const empty = '<span class="muted">—</span>';
        const rows = s.rows.map((r) => `<tr class="dev${r.guest ? ` guest" style="--guest:${Math.min(r.guest, HOST_DEPTH_MAX)}` : ''}">
            <td>${r.guest ? '<span class="muted">↳ </span>' : ''}<b>${escapeHtml(r.name)}</b></td>${r.cells.map((text, i) => `<td${s.columns[i].mono ? ' class="mono"' : ''}>${text && text !== '—' ? escapeHtml(text) : empty}</td>`).join('')}
        </tr>`).join('');
        return `${head}${line}
    <table class="inv saved-search">
        <thead><tr><th>${escapeHtml(t('Device'))}</th>${s.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody></table>`;
    }).join('\n');
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

// ---- The summary for the client ----
// One page in plain words for the person who owns the network and will never
// read a findings table: whether it is all right, what needs attention and
// why, what they have, what changed, and who looked. Built from the same
// model as the technical sheet, so the two can never disagree; it only says
// it differently. Each check has a plain sentence for what is wrong and one
// for why it matters (PLAIN_FINDINGS); a check without one falls back to its
// own name. The open findings only: an accepted one is known and explained in
// the technical pages, and an info note is the editor's, as there.
const PLAIN_FINDINGS = {
    'ip-conflict': ['Two devices are set to the same address', 'Only one of them can work at a time; the other keeps losing its connection.'],
    'mac-conflict': ['Two devices claim the same hardware address', 'The network mixes them up, so either one can lose its connection.'],
    cabling: ['Devices are cabled together but set up for different networks', 'They are plugged in, but cannot talk to each other over that cable.'],
    loop: ['The cables form a loop', 'Unless the switches are set up for it, a loop can flood the network and bring it down.'],
    'cable-label': ['Two cables carry the same label', 'Whoever traces a cable later may unplug the wrong one.'],
    'asset-tag': ['Two devices carry the same asset tag', 'The inventory cannot tell them apart.'],
    firmware: ['Devices of the same model run different software versions', 'They can behave differently, and the older ones may miss security fixes.'],
    group: ['The list of places (buildings, rooms, racks) has an error', 'Some devices do not show where they really are.'],
    rack: ['A device does not fit where the rack drawing puts it', 'The rack drawing does not match what fits in the rack.'],
    host: ['Something runs on a device that is marked as retired', 'If that device is switched off, what runs on it stops too.'],
    'wifi-band': ['A wireless device is on a band its access point cannot use', 'It cannot connect the way it is documented.'],
    'wifi-ssid': ['A wireless device is set to a Wi-Fi network its access point does not offer', 'It cannot connect the way it is documented.'],
    'wifi-subnet': ['A wireless device has an address that does not belong to its Wi-Fi network', 'It may connect but not reach anything.'],
    'wifi-overlap': ['Two access points use overlapping channels', 'They slow each other down.'],
    'wifi-security': ['A Wi-Fi network has weak or no protection', 'People nearby could join it or read what is sent over it.'],
    'wifi-signal': ['A wireless device has a weak signal', 'Its connection may be slow or drop.'],
    age: ['A device is older than it is expected to last', 'It is more likely to fail; plan and budget its replacement.'],
    service: ['A device is overdue for its service', 'Equipment that is not looked after fails sooner, often without warning.'],
    'service-due': ['A device is due for its service soon', 'Booking it now keeps it from becoming overdue.'],
    'port-capacity': ['A switch is almost out of free ports', 'The next device may have nowhere to plug in: plan a bigger switch or another one.'],
    'address-capacity': ['A network is almost out of free addresses', 'The next device may get no address: plan a bigger network, or move some devices to another one.'],
    'dhcp-pool': ['The automatic address range clashes with a fixed address', 'Devices may be handed an address already in use, and lose their connection.'],
    // PoE (feature 4 stage 2b): plain words, so neither "PoE" nor "VLAN".
    'vlan-path': ['Part of the network cannot reach its way out', 'The devices on it cannot reach the internet or the other networks, because a link between the switches does not carry it.'],
    'vlan-subnet': ['A switch port is set up for a network that has no addresses recorded', 'A device plugged into it may get no address, or the record is out of date.'],
    'vlan-mismatch': ['A device is plugged into a port set up for another network', 'The two ends of the cable do not agree on which network it carries, so traffic is lost on it.'],
    'poe-none': ['A device that takes its power from the network cable is on a port that gives none', 'It cannot switch on where it is plugged in.'],
    'poe-class': ['A device that takes its power from the network cable needs more than its port gives', 'It may not switch on, or may restart when it works hardest.'],
    'poe-budget': ['A switch is asked for more power than it can give', 'Some devices will switch off or restart.'],
    'poe-near': ['A switch is almost out of power for the devices it feeds', 'The next device powered by its cable may not switch on: plan a bigger switch or another one.'],
    interfaces: ['A device has no valid address recorded', 'It cannot be reached the way it is documented.'],
    multihoming: ['A device is connected twice to the same network', 'Its connection can become unstable.'],
    bond: ['Network ports joined together on a device are set up wrongly', 'The backup or extra speed they should give does not work.'],
    ports: ['The cables and ports of a device do not match up', 'The record of what is plugged in where is incomplete or wrong.'],
    radio: ['A cable and a wireless connection are mixed up on a device', 'The connection cannot work the way it is documented.'],
    mac: ['A hardware address on a device looks wrong', 'The device may be hard to identify, or clash with another one.'],
    gateway: ['A device cannot reach the way out of its network', 'It may not reach the internet or the other networks.'],
    dns: ['The name server of a device cannot be reached', 'Websites and services may not open by their names.']
};
const plainFinding = (f) => {
    const p = PLAIN_FINDINGS[f.key];
    return p ? { what: t(p[0]), why: t(p[1]) } : { what: f.check || t('Something needs a look'), why: '' };
};

// The open findings as problems: one per check and severity, naming every
// device it is about. What must be fixed first, then what needs attention.
// The rows are grouped, but the headline (summaryVerdict) counts findings, as
// the Findings tab and the technical sheet do.
function summaryProblems(findings) {
    const by = new Map();
    (findings || []).filter((f) => f.level === 'bad' || f.level === 'warn').forEach((f) => {
        const k = `${f.level}\u0000${f.key}`;
        if (!by.has(k)) by.set(k, Object.assign({ key: f.key, level: f.level, where: [] }, plainFinding(f)));
        const p = by.get(k);
        if (f.subject && !p.where.includes(f.subject)) p.where.push(f.subject);
    });
    const list = [...by.values()];
    return list.filter((p) => p.level === 'bad').concat(list.filter((p) => p.level === 'warn'));
}
// The one line at the top: { cls: 'ok' | 'warn' | 'bad', title, more }, from
// findingCounts(): five devices on a wrong gateway are five problems in one row.
// spread ({ kinds, devices }, the critical rows and the devices they name) says
// so when the problems are fewer kinds than findings: "One kind of problem
// needs fixing, on 5 devices" over that one row, not "5 problems".
function summaryVerdict({ critical, advisory }, spread = {}) {
    const bad = critical || 0, warn = advisory || 0;
    const attention = (n) => t(n === 1 ? 'One thing needs attention' : '{n} things need attention', { n });
    const kinds = spread.kinds || 0, devices = spread.devices || 0;
    const fix = kinds && kinds < bad && devices > 1
        ? t(kinds === 1 ? 'One kind of problem needs fixing, on {n} devices' : '{k} kinds of problem need fixing, on {n} devices', { k: kinds, n: devices })
        : t(bad === 1 ? 'One problem needs fixing' : '{n} problems need fixing', { n: bad });
    if (bad) return { cls: 'bad', title: fix, more: warn ? attention(warn) : '' };
    if (warn) return { cls: 'warn', title: attention(warn), more: '' };
    return { cls: 'ok', title: t('Your network looks fine'), more: '' };
}
// Past this many devices the summary lists kinds only: a page, not a register.
const SUMMARY_LIST_MAX = 60;
const SUMMARY_WHERE_MAX = 6;
const SUMMARY_CHANGES_MAX = 8;

// The summary's Room to grow paragraph, from model.capacity: the switches'
// half, then the subnets'; '' when neither is known (no switch's port count
// set, no subnet that can run out). The names are cut as the Where lines are
// (SUMMARY_WHERE_MAX), each half on its own.
function summaryRoomPorts(cap) {
    const room = cap && cap.room;
    if (!room) return '';
    const n = room.free, aps = room.aps || 0;
    // Named for what the boxes are: switches, access points, or both.
    const words = !aps ? (room.devices === 1 ? ['The switch has {n} free port.', 'The switch has {n} free ports.']
        : ['The switches have {n} free port.', 'The switches have {n} free ports.'])
        : aps === room.devices ? (room.devices === 1 ? ['The access point has {n} free port.', 'The access point has {n} free ports.']
            : ['The access points have {n} free port.', 'The access points have {n} free ports.'])
            : ['The switches and access points have {n} free port.', 'The switches and access points have {n} free ports.'];
    const total = t(words[n === 1 ? 0 : 1], { n });
    const tight = (cap.ports || []).map((r) => (r.full ? t('{name} is full: all {total} ports are in use.', { name: r.name, total: r.total })
        : t(r.free === 1 ? '{name} is almost full: {free} free port of {total}.' : '{name} is almost full: {free} free ports of {total}.',
            { name: r.name, free: r.free, total: r.total })));
    const named = tight.slice(0, SUMMARY_WHERE_MAX).concat(tight.length > SUMMARY_WHERE_MAX
        ? [t('…and {n} more.', { n: tight.length - SUMMARY_WHERE_MAX })] : []).join(' ');
    return [total, named].filter(Boolean).join(' ');
}
// The addresses half: the free addresses over the subnets that can run out
// (reportCapacity's addresses), then the ones almost or quite out of them by
// name, cut as the switches are. A subnet is a network in these words, as
// the Simple view calls it.
function summaryRoomAddresses(cap) {
    const a = cap && cap.addresses;
    if (!a) return '';
    const n = a.free;
    const total = t(a.networks === 1 ? (n === 1 ? 'The network has {n} free address.' : 'The network has {n} free addresses.')
        : (n === 1 ? 'The networks have {n} free address.' : 'The networks have {n} free addresses.'), { n });
    const tight = a.tight.map((r) => (r.fixed ? (r.full ? t('The network {name} has no fixed address left outside the automatic range.', { name: r.name })
        : t(r.free === 1 ? 'The network {name} has {free} fixed address left outside the automatic range, of {size}.' : 'The network {name} has {free} fixed addresses left outside the automatic range, of {size}.',
            { name: r.name, free: r.free, size: r.size }))
        : r.full ? t('The network {name} is full: all {size} addresses are in use.', { name: r.name, size: r.size })
        : t(r.free === 1 ? 'The network {name} is almost full: {free} free address of {size}.' : 'The network {name} is almost full: {free} free addresses of {size}.',
            { name: r.name, free: r.free, size: r.size })));
    const named = tight.slice(0, SUMMARY_WHERE_MAX).concat(tight.length > SUMMARY_WHERE_MAX
        ? [t('…and {n} more.', { n: tight.length - SUMMARY_WHERE_MAX })] : []).join(' ');
    return [total, named].filter(Boolean).join(' ');
}
function summaryRoom(cap) {
    const text = [summaryRoomPorts(cap), summaryRoomAddresses(cap)].filter(Boolean).join(' ');
    if (!text) return '';
    return `
    <h3>${escapeHtml(t('Room to grow'))}</h3>
    <p class="room">${escapeHtml(text)}</p>`;
}

// opts as reportSheet's: a binder labels the sheet by site and anchors it.
function summarySheet(model, opts = {}) {
    const meta = model.meta || {};
    const devices = model.devices || [];
    const problems = summaryProblems(model.findings);
    const critical = (model.findings || []).filter((f) => f.level === 'bad' && !f.accepted);
    const verdict = summaryVerdict(findingCounts(model.findings), {
        kinds: problems.filter((p) => p.level === 'bad').length,
        devices: new Set(critical.flatMap((f) => f.nodeIds || [])).size
    });
    const metaRows = REPORT_FIELDS
        .filter(({ key, multiline }) => !multiline && meta[key])
        .map(({ key, label }) => `<div><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(meta[key])}</dd></div>`)
        .join('');
    const basis = meta.date ? t('Based on the network as it was documented on {date}. Nothing was scanned or logged into.', { date: meta.date })
        : t('Based on the network as it was documented. Nothing was scanned or logged into.');
    const where = (list) => {
        const shownList = list.slice(0, SUMMARY_WHERE_MAX).join(', ');
        return list.length > SUMMARY_WHERE_MAX ? `${shownList} ${t('…and {n} more.', { n: list.length - SUMMARY_WHERE_MAX })}` : shownList;
    };
    const todo = problems.length ? `<h2>${escapeHtml(t('What needs attention'))}</h2>
    <ol class="todo">${problems.map((p) => `<li class="${p.level}">
        <span class="sev ${p.level}">${escapeHtml(t(p.level === 'bad' ? 'Fix now' : 'Needs attention'))}</span>
        <b>${escapeHtml(p.what)}</b>${p.why ? `<br>${escapeHtml(p.why)}` : ''}${p.where.length ? `<br><span class="muted">${escapeHtml(t('Where: {list}', { list: where(p.where) }))}</span>` : ''}
    </li>`).join('')}</ol>` : `<p>${escapeHtml(t('No problems were found in how the network is set up. Keep this document: it is the record of what you have.'))}</p>`;

    // What is planned: the pins (on the next visit) and the schedules (by a
    // date), so the client sees what is already in hand. A pinned finding that
    // is also scheduled is one line saying both.
    const planned = (model.visit || []).map((v) => `<li><b>${escapeHtml(plainFinding({ key: v.key, check: v.check }).what)}</b> — ${escapeHtml(v.names)}<br><span class="muted">${[v.note ? t('On the next visit: {note}', { note: v.note }) : t('On the next visit.')].concat((v.scheduled || []).map((s) => t('By {date}: {reason}', { date: s.until, reason: s.reason }))).map(escapeHtml).join('<br>')}</span></li>`)
        .concat((model.scheduled || []).map((f) => `<li><b>${escapeHtml(plainFinding(f).what)}</b> — ${escapeHtml(f.subject || '')}<br><span class="muted">${escapeHtml(t('By {date}: {reason}', { date: f.accepted.until, reason: f.accepted.reason }))}</span></li>`));
    const plan = planned.length ? `<h2>${escapeHtml(t('What is planned'))}</h2>
    <ul class="planned">${planned.join('')}</ul>` : '';
    // Who to call: whoever is responsible for what, so someone new to the
    // site knows (js/model.js "Providers").
    const call = (model.providers || []).length ? `<h2>${escapeHtml(t('Who to call'))}</h2>
    ${whoToCallSection(model.providers)}` : '';

    // What they have: how many of each kind, then the devices themselves with
    // where they are and the network's own columns the table shows.
    const kinds = new Map();
    devices.forEach((d) => { const k = t(d.typeName); kinds.set(k, (kinds.get(k) || 0) + 1); });
    const kindStats = [...kinds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k, n]) => `<div class="stat"><b>${n}</b><span>${escapeHtml(k)}</span></div>`).join('');
    const own = model.customColumns || [];
    // Where it is, then the socket it is plugged into when known: a device
    // with a socket but no place still gets the Where column.
    const placeOf = (d) => [d.place || d.location || '', d.socket || ''].filter(Boolean).join(' · ');
    const anyPlace = devices.some(placeOf);
    const cell = (d, name) => { const x = (d.custom || []).find((c) => c.name === name); return x ? escapeHtml(x.text) : ''; };
    const list = devices.length && devices.length <= SUMMARY_LIST_MAX ? `<table class="summary-list">
        <thead><tr><th>${escapeHtml(t('Device'))}</th><th>${escapeHtml(t('Kind'))}</th>${anyPlace ? `<th>${escapeHtml(t('Where'))}</th>` : ''}${own.map((n) => `<th>${escapeHtml(n)}</th>`).join('')}</tr></thead>
        <tbody>${devices.map((d) => `<tr><td><b>${escapeHtml(d.name)}</b>${d.status === 'retired' ? ` <span class="muted">(${escapeHtml(statusName('retired'))})</span>` : ''}</td><td>${escapeHtml(t(d.typeName))}</td>${anyPlace ? `<td>${escapeHtml(placeOf(d))}</td>` : ''}${own.map((n) => `<td>${cell(d, n)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>` : (devices.length ? `<p class="muted">${escapeHtml(t('The full list of devices is in the technical report.'))}</p>` : '');

    // Room to grow (reportCapacity): the free ports the switches have, then
    // the ones that are almost out of them, by name, as many as the Where
    // lines. Only when a port count was set somewhere; otherwise nothing is
    // known and the line is left out.
    const room = summaryRoom(model.capacity);

    // What changed since the last visit, in a few lines.
    const ch = model.changes;
    const changes = ch ? `<h2>${escapeHtml(t('What changed since the last visit'))}</h2>
    <p class="muted">${escapeHtml(baselineSentence(ch))}</p>${ch.rows.length ? `<ul class="changes">${ch.rows.slice(0, SUMMARY_CHANGES_MAX).map((r) => `<li>${escapeHtml(r.op)} · ${escapeHtml(r.what)}${r.name ? ` <b>${escapeHtml(r.name)}</b>` : ''}${r.detail ? ` <span class="muted">— ${escapeHtml(r.detail)}</span>` : ''}</li>`).join('')}${ch.rows.length > SUMMARY_CHANGES_MAX ? `<li class="muted">${escapeHtml(t('…and {n} more.', { n: ch.rows.length - SUMMARY_CHANGES_MAX }))}</li>` : ''}</ul>` : `<p>${escapeHtml(t('Nothing has changed since then.'))}</p>`}` : '';

    const who = meta.engineer ? `<p class="who">${escapeHtml(t('Checked by {name}. Questions about this summary go to them.', { name: meta.engineer }))}</p>` : '';
    // The map: a landscape sheet of its own after the summary's page, the
    // whole network on it (opts.image; the technical sheet after it points
    // at the same picture).
    const caption = meta.site ? `${t('Topology')} — ${meta.site}` : t('Topology');
    const map = opts.image ? diagramSheets({ kind: 'sheet' }, opts.image, caption, opts.diagramId || 'topo-dg') : '';
    return `<div class="sheet summary"${opts.anchorId ? ` id="${escapeHtml(opts.anchorId)}"` : ''}>
    <div class="rule"></div>
    <h1>${escapeHtml(opts.title || t('Network summary'))}</h1>
    <p class="sub">${escapeHtml(opts.subtitle !== undefined ? opts.subtitle : (meta.site || t('Site not named')))}</p>
    <dl class="meta">${metaRows}</dl>

    <div class="verdict ${verdict.cls}"><b>${escapeHtml(verdict.title)}</b>${verdict.more ? `<span>${escapeHtml(verdict.more)}</span>` : ''}<small>${escapeHtml(basis)}</small></div>
    ${todo}
    ${plan}
    ${call}

    <h2>${escapeHtml(t('What you have'))}</h2>
    <div class="stats">${kindStats || `<div class="stat"><b>0</b><span>${escapeHtml(t('Devices'))}</span></div>`}</div>
    ${list}${room}${map ? `
    <p class="muted">${escapeHtml(t('The map of the network is on the next page.'))}</p>` : ''}
    ${changes}
    ${who}
    <footer>
        <span>${escapeHtml(meta.ref || '')}</span>
        <span>${escapeHtml(t('Generated with Topo · topo.carino.systems'))}</span>
    </footer>
</div>${map}`;
}

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
    // The sections ticked (reportParts.sections); every one at its default
    // when the caller names none. The summary stats above them always print.
    const sec = opts.sections || reportSections();
    const accepted = model.accepted || [];
    const portMaps = sec.ports ? model.portMaps || [] : [];
    // Inline, a landscape page of its own, or tiles (reportDiagramLayout).
    // With the large map asked for (opts.largeMap, the dialog's Large map)
    // the diagram is also tiled large at the end: an overview with each
    // sheet's square marked, then the sheets. A diagram already in tiles is
    // tiled large in their place rather than twice.
    const layout = sec.diagram ? reportDiagramLayout(image, counts.devices) : null;
    const large = opts.largeMap ? reportDiagramLayout(image, counts.devices, { large: true, cols: opts.largeCols, rows: opts.largeRows, skip: opts.largeSkip }) : null;
    const caption = meta.site ? `${t('Topology')} — ${meta.site}` : t('Topology');
    const figure = layout && layout.kind === 'inline' ? `<div class="figure">
        <img src="${image.url}" alt="${escapeHtml(t('Network topology diagram'))}">
        <div class="caption">${escapeHtml(caption)}</div>
    </div>` : '';
    const away = layout && layout.kind === 'sheet' ? t('The diagram is on a landscape page of its own at the end of this report.') : '';
    const largeNote = large ? t('A large map is at the end: an overview with each sheet marked, then {n} landscape sheets.', { n: large.tiles.length }) : '';
    const diagramId = opts.diagramId || 'topo-dg';
    const capacity = capacitySection(model.capacity, sec);

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
        ${stat(counts.advisory, 'Advisory', 'adv')}${accepted.length ? `
        ${stat(accepted.length, 'Accepted')}` : ''}
    </div>

${sec.findings ? `    <h2>${escapeHtml(t('Findings'))}</h2>
    ${findingsSection(model.findings, { accepted: accepted.length > 0 })}` : ''}
${sec.findings && (model.visit || []).length ? `
    <h2>${escapeHtml(t('To check on the next visit'))}</h2>
    ${visitSection(model.visit)}
` : ''}${sec.findings && accepted.length ? `
    <h2>${escapeHtml(t('Known / accepted'))}</h2>
    ${acceptedSection(accepted)}
` : ''}${sec.providers && (model.providers || []).length ? `
    <h2>${escapeHtml(t('Providers'))}</h2>
    ${providersSection(model.providers)}
` : ''}
    ${image && sec.diagram ? `<h2>${escapeHtml(t('Topology'))}</h2>
    ${away ? `<p class="muted">${escapeHtml(away)}</p>` : figure}${largeNote ? `
    <p class="muted">${escapeHtml(largeNote)}</p>` : ''}` : (largeNote ? `<h2>${escapeHtml(t('Topology'))}</h2>
    <p class="muted">${escapeHtml(largeNote)}</p>` : '')}

${sec.devices ? `    <h2>${escapeHtml(t('Device inventory'))}</h2>
    ${devicesSection(model.devices, model.groups)}` : ''}
${sec.inventory && hasInventory(model.inventory) ? `
    <h2>${escapeHtml(t('Inventory'))}</h2>
    ${inventorySection(model.inventory)}
` : ''}${sec.racks && (model.racks || []).length ? `
    <h2>${escapeHtml(t('Racks'))}</h2>
    ${racksSection(model.racks)}
` : ''}${portMaps.length ? `
    <h2>${escapeHtml(t('Switch ports'))}</h2>
    ${portMapsSection(portMaps)}
` : ''}
${sec.cables ? `    <h2>${escapeHtml(t('Connections'))}</h2>
    ${connectionsSection(model.connections)}` : ''}
${sec.wifi && model.wifi ? `
    <h2>Wi-Fi</h2>
    ${wifiSection(model.wifi)}
` : ''}
${sec.addressing ? `    <h2>${escapeHtml(t('Addressing'))}</h2>
    ${subnetsSection(model.subnets)}` : ''}
${sec.vlans && (model.vlans || []).length ? `
    <h2>VLANs</h2>
    ${vlansSection(model.vlans)}
` : ''}
${capacity ? `
    <h2>${escapeHtml(t('Capacity'))}</h2>
    ${capacity}
` : ''}${sec.searches && (model.searches || []).length ? `
    <h2>${escapeHtml(t('Saved searches'))}</h2>
    ${searchesSection(model.searches)}
` : ''}${sec.changes && model.changes ? `
    <h2>${escapeHtml(t(model.changes.kind === 'report' ? 'Changes since the last report' : 'Changes since the last back-up'))}</h2>
    ${changesSection(model.changes)}
` : ''}${sec.incidents && model.incidents && model.incidents.length && typeof incidentsReportSection === 'function' ? `
    <h2>${escapeHtml(t('Problems and visits'))}</h2>
    ${incidentsReportSection(model.incidents, model.log)}
` : ''}${sec.log && model.log && model.log.length && typeof logReportSection === 'function' ? `
    <h2>${escapeHtml(t('Network log'))}</h2>
    ${logReportSection(model.log)}
` : ''}${sec.history && model.history ? `
    <h2>${escapeHtml(t('Address history'))}</h2>
    ${addressHistorySection(model.history)}
` : ''}
    <h2>${escapeHtml(t('Scope and method'))}</h2>
    ${methodSection(meta)}
    <footer>
        <span>${escapeHtml(meta.ref || '')}</span>
        <span>${escapeHtml(t('Generated with Topo · topo.carino.systems'))}</span>
    </footer>
</div>${away ? diagramSheets(layout, image, caption, diagramId, !!opts.diagramDefined) : ''}${large ? diagramSheets(large, image, `${caption} · ${t('Large map')}`, diagramId, !!opts.diagramDefined || !!away) : ''}`;
}

// What a report holds: the summary for the client, the technical sheet, or
// both (the summary first). The dialog ticks both by default; a caller that
// says nothing gets the technical sheet alone, as before the summary existed.
// The technical sheet's sections, in print order: a tick each in the
// report dialog, and reportParts.sections. `on` is what prints when nothing
// says otherwise, which is the sheet as it always printed, except the
// Capacity section's Ports table (the nearly full switches only, which the
// Switch ports maps already list), off unless ticked. The summary stats at
// the top and Scope and method at the end always print. 'findings' carries
// To check on the next visit and Known / accepted with it. 'history' is
// the Address history section (feature 5 stage 5, the owner's call on
// 2026-11-05): off unless ticked, and only for a kept network with a trail.
const REPORT_SECTIONS = [
    { key: 'findings', label: 'Findings', on: true },
    { key: 'providers', label: 'Providers', on: true },
    { key: 'diagram', label: 'Topology', on: true },
    { key: 'devices', label: 'Device inventory', on: true },
    { key: 'inventory', label: 'Inventory', on: true },
    { key: 'racks', label: 'Racks', on: true },
    { key: 'ports', label: 'Switch ports', on: true },
    { key: 'cables', label: 'Connections', on: true },
    { key: 'wifi', label: 'Wi-Fi', on: true },
    { key: 'addressing', label: 'Addressing', on: true },
    { key: 'vlans', label: 'VLANs', on: true },
    { key: 'capAddresses', label: 'Capacity: addresses', on: true },
    { key: 'capPorts', label: 'Capacity: ports table', on: false },
    { key: 'capPoe', label: 'Capacity: PoE budgets', on: true },
    { key: 'searches', label: 'Saved searches', on: true },
    { key: 'changes', label: 'Changes since the last back-up or report', on: true },
    // The network log (docs/SCOPE.md step 2; js/mergeapply.js logReportSection):
    // the merges into the network, off unless ticked.
    // The problem reports and their visits (docs/SCOPE.md step 4,
    // js/incidents.js incidentsReportSection): off unless ticked, because
    // they carry the reporter's name and phone.
    { key: 'incidents', label: 'Problems and visits', on: false },
    { key: 'log', label: 'Network log', on: false },
    { key: 'history', label: 'Address history', on: false },
];
// A sections map read for one report: every key of REPORT_SECTIONS, a
// boolean given for it winning, anything else (unknown keys, non-booleans,
// no map at all) leaving the default.
const reportSections = (given) => {
    const out = {};
    const src = given && typeof given === 'object' ? given : {};
    REPORT_SECTIONS.forEach(({ key, on }) => {
        out[key] = Object.prototype.hasOwnProperty.call(src, key) && typeof src[key] === 'boolean' ? src[key] : on;
    });
    return out;
};

const reportParts = (parts) => {
    const p = { summary: !!(parts && parts.summary), technical: !parts || parts.technical !== false, largeMap: !!(parts && parts.largeMap),
        largeCols: gridCount(parts && parts.largeCols), largeRows: gridCount(parts && parts.largeRows),
        largeSkip: [...gridSkip(parts && parts.largeSkip)].sort(),
        // The saved searches ticked for this report (ids), or null: every
        // one marked to print. Never written back to the searches.
        searches: parts && Array.isArray(parts.searches) ? parts.searches.filter((id) => typeof id === 'string') : null,
        // The technical sheet's sections (REPORT_SECTIONS), every key there.
        sections: reportSections(parts && parts.sections) };
    if (!p.summary && !p.technical) p.technical = true;
    return p;
};
// Whether handing this report over moves a kept network's report baseline
// (onKept): only when the report shows what changed, which the summary
// always does and the technical sheet does while Changes is ticked.
// Otherwise the next report would count from a copy that never listed them.
const reportShowsChanges = (p) => p.summary || (p.technical && p.sections.changes);
// A report that printed the Address history but not Changes still notes a
// 'report' point in the trail (recordPoint alone), so the next one's history
// counts from it, while the Changes baseline stays where it was.
const reportShowsHistoryOnly = (p) => !reportShowsChanges(p) && p.technical && p.sections.history;
const reportKept = (p, list) => (reportShowsChanges(p) ? () => list.forEach((e) => takeSnapshot(e.id, 'report', e.doc))
    : reportShowsHistoryOnly(p) && typeof recordPoint === 'function' ? () => list.forEach((e) => recordPoint(e.id, 'report', e.doc)) : null);
const reportTitleWord = (p) => t(p.technical ? 'Network documentation report' : 'Network summary');

// The single-site report: one document of the parts asked for.
function reportHtml(model, image, parts) {
    const p = reportParts(parts);
    const title = model.meta.site ? `${model.meta.site} — ${reportTitleWord(p)}` : reportTitleWord(p);
    return reportDocument(title, (p.summary ? summarySheet(model, { image }) : '')
        + (p.technical ? reportSheet(model, image, { sections: p.sections, largeMap: p.largeMap, largeCols: p.largeCols, largeRows: p.largeRows, largeSkip: p.largeSkip, diagramDefined: p.summary && !!image }) : ''));
}

// The cover: what the whole engagement adds up to, before any one building.
// sec (reportParts.sections): the estate findings, addressing and topology
// follow the Findings, Addressing and Topology ticks, as each site's do.
function binderCoverSheet(binder, sec = reportSections()) {
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

${sec.findings ? `    <h2>${escapeHtml(t('Findings across the estate'))}</h2>
    ${findingsSection(binder.findings, { site: true })}

` : ''}${sec.addressing ? `    <h2>${escapeHtml(t('Estate addressing'))}</h2>
    ${estateSubnetsSection(binder.subnets)}

` : ''}${sec.diagram ? `    <h2>${escapeHtml(t('Estate topology'))}</h2>
    ${estateGraphSvg(binder.graph)}
    ${siteLinksSection(binder.graph)}

` : ''}    <h2>${escapeHtml(t('Scope and method'))}</h2>
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
// With the summary, each site's summary comes before its technical sheet
// (and takes the anchor the cover's index links to); a summary on its own is
// one page per site and no cover, which is the estate in the client's words.
function binderHtml(binder, images = {}, parts) {
    const p = reportParts(parts);
    const word = t(p.technical ? 'Estate documentation report' : 'Network summary');
    const title = binder.meta.site ? `${binder.meta.site} — ${word}` : word;
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
        // rawMeta is the stored header exactly as the document carried it, and
        // a binder or library doc is outside input: a non-string field must
        // cost that field, not throw and abort the whole estate report.
        const str = (v) => (typeof v === 'string' ? v : '');
        const recordedSite = str(s.rawMeta.site).trim();
        sheetMeta.site = recordedSite && recordedSite !== s.name ? recordedSite : '';
        sheetMeta.scope = str(s.rawMeta.scope);   // each building's own scope note always stands
        REPORT_FIELDS.forEach(({ key }) => {
            if (key === 'site' || key === 'scope') return;
            const recorded = str(s.rawMeta[key]).trim();
            if (recorded && recorded !== binder.meta[key]) sheetMeta[key] = recorded;
        });
        const sheetModel = Object.assign({}, s.model, { meta: sheetMeta });
        // The summary is read on its own, so it carries the whole header:
        // the cover's, with the site's own where it says something else.
        const image = images[s.id] || null, diagramId = `topo-dg-${s.anchor}`;
        const summary = p.summary ? summarySheet(Object.assign({}, s.model, { meta: Object.assign({}, binder.meta, { site: '' }, pickSet(sheetMeta)) }),
            { title: s.name, subtitle: t('Network summary'), anchorId: s.anchor, image, diagramId }) : '';
        return summary + (p.technical ? reportSheet(sheetModel, image, { title: s.name, subtitle: '', anchorId: p.summary ? '' : s.anchor, diagramId, sections: p.sections, largeMap: p.largeMap, largeCols: p.largeCols, largeRows: p.largeRows, largeSkip: p.largeSkip, diagramDefined: p.summary && !!image }) : '');
    }).join('');
    return reportDocument(title, (p.technical ? binderCoverSheet(binder, p.sections) : '') + sheets);
}
// The fields of a header that say something.
const pickSet = (meta) => { const out = {}; Object.keys(meta || {}).forEach((k) => { if (meta[k]) out[k] = meta[k]; }); return out; };

// ---- Delivering it ----
// A new tab is the useful default: the report is read and printed far more often
// than it is filed. Popup blockers are common enough that the download has to be
// a real fallback rather than an error message, and both paths hand over the
// same bytes. The object URL outlives the call because revoking it immediately
// leaves the new tab pointed at nothing.
// `kind` names the download ('report' or 'summary').
// A report has been read in the dialog's preview already
// (refreshReportPreview below): it is saved as a file, and handed over, so
// `onKept` runs (a kept network's report baseline, buildSiteReport). Any
// other kind opens in a tab (openReportTab); the labels and Locate sheets
// no longer come here, they have a preview of their own (js/sheetpreview.js),
// which falls back to that tab only on a page without its dialog.
// `format` is the preview's PDF | HTML switch (reportFormat): 'html' saves
// the document byte for byte, as it always did; 'pdf' answers with a promise,
// the same pages drawn into a PDF (makeReportPdf) and saved under the same
// stem, unless `wanted()` says the preview was closed meanwhile. A PDF that
// cannot be made is { ok: false, error } and nothing is handed over.
function deliverReport(html, meta, kind = 'report', onKept = null, format = 'html', wanted = null) {
    if (kind !== 'report' && kind !== 'summary') return openReportTab(html, meta, kind);
    if (format === 'pdf') {
        const name = reportFileName(meta, kind, 'pdf');
        return makeReportPdf(html).then((blob) => {
            if (typeof wanted === 'function' && !wanted()) return { ok: false, cancelled: true, name, downloaded: false };
            const url = saveBlob(blob, name);
            if (typeof onKept === 'function') onKept();
            return { ok: true, url, name, opened: false, downloaded: true, format: 'pdf' };
        }, (e) => {
            console.warn('Report: could not create the PDF.', e);
            return { ok: false, name, downloaded: false, error: (e && e.message) || String(e) };
        });
    }
    const name = reportFileName(meta, kind);
    const url = saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), name);
    if (typeof onKept === 'function') onKept();
    return { url, name, opened: false, downloaded: true };
}

// ---- The file's format: PDF or HTML ----
// Every report preview in the fleet offers its file in two formats, picked
// with the PDF | HTML switch just above the file name (CarinoPdf.formatSwitch,
// carino-pdf.js, which remembers the choice for this site); the one Download
// button and the file name follow it. HTML is the document itself, the bytes
// Topo always saved. PDF is that same document drawn page by page
// (CarinoPdf.pdf: its print rules and @page margins, pictures of the pages
// made with html2canvas), so it looks exactly like the preview; its text is
// not selectable (Print, then Save as PDF, gives text). The site report, the
// labels and the Locate sheet all go through here (js/sheetpreview.js).
// Without carino-pdf.js (a page that did not load it) there is no switch and
// Download saves the HTML.
const reportPdfEngine = () => (typeof window !== 'undefined' && window.CarinoPdf && typeof window.CarinoPdf.pdf === 'function') ? window.CarinoPdf : null;
let _reportFormat = null;
const _reportFormatSwitches = new Map();
function reportFormat() {
    const P = reportPdfEngine();
    if (!P) return 'html';
    if (!_reportFormat) _reportFormat = (typeof P.remembered === 'function' && P.remembered()) || 'pdf';
    return _reportFormat === 'html' ? 'html' : 'pdf';
}
// Sets the format for every preview (not remembered: only the switch's own
// click is). -> the format now.
function setReportFormat(v) {
    _reportFormat = v === 'html' ? 'html' : 'pdf';
    _reportFormatSwitches.forEach((sw) => sw.set(_reportFormat));
    return reportFormat();
}
// 'Download PDF' / 'Download HTML', translated.
function reportDownloadLabel(format = reportFormat()) {
    const P = reportPdfEngine();
    if (P && typeof P.label === 'function') return P.label(format);
    return t(format === 'pdf' ? 'Download PDF' : 'Download HTML');
}
// The switch in a preview's column, just above its file name (.rpv-name),
// outside the scrolling options; made once per dialog, on its first opening
// (carino-pdf.js is deferred, so it is not there while these scripts load).
// onChange(format) runs when it changes, from either preview. -> the switch,
// or null without carino-pdf.js.
function mountReportFormat(dialog, onChange) {
    const P = reportPdfEngine();
    if (!dialog || !P || typeof P.formatSwitch !== 'function') return null;
    let sw = _reportFormatSwitches.get(dialog.id);
    if (!sw) {
        const name = dialog.querySelector('.rpv-name');
        if (!name) return null;
        sw = P.formatSwitch({ value: reportFormat(), onChange: (v) => {
            _reportFormat = v;
            _reportFormatSwitches.forEach((other) => { if (other !== sw) other.set(v); });
            if (typeof onChange === 'function') onChange(v);
        } });
        sw.el.classList.add('topo-format');
        name.parentNode.insertBefore(sw.el, name);
        _reportFormatSwitches.set(dialog.id, sw);
    }
    sw.relabel();
    if (sw.get() !== reportFormat()) sw.set(reportFormat());
    return sw;
}
// The switch's words again (a language switch).
function relabelReportFormats() { _reportFormatSwitches.forEach((sw) => sw.relabel()); }
// The report (or sheet) as a PDF: its document as it prints, pages from its
// own @page rule (A4 when it names no paper), the site's fonts.
function makeReportPdf(html) {
    const P = reportPdfEngine();
    if (!P) return Promise.reject(new Error('carino-pdf.js is not loaded'));
    return P.pdf(inlineDiagramUses(html), { producer: 'Topo (Carino Systems)' });
}
// The landscape map sheets draw the picture with <use href="#topo-dg"/>,
// pointing at one <image> in another <svg>'s <defs> (diagramSheets), so
// the file carries it once. html2canvas draws each <svg> on its own and
// cannot follow a reference out of it, which left those sheets blank in the
// PDF. For the PDF only, each such <use> gets the picture itself.
function inlineDiagramUses(html) {
    const defs = new Map();
    String(html).replace(/<image id="([^"]+)" href="([^"]+)" width="([^"]+)" height="([^"]+)"\/>/g, (m, id, href, w, h) => {
        defs.set(id, `<image href="${href}" width="${w}" height="${h}"/>`);
        return m;
    });
    if (!defs.size) return html;
    return String(html).replace(/<use href="#([^"]+)"\/>/g, (m, id) => defs.get(id) || m);
}
// A report or sheet (topoFileStem): its header's client and site, the
// report's own date, and the kind. An estate report (meta.binder) that
// names no site and no client says "networks", as the binder file does.
// A site report carries `fileSite` (buildSiteReport): the network's name as
// every other download of it says it, the card's name first (docDisplayName,
// js/app.js), so a kept network has one stem even when its report's Site
// header says something else; the header's Site still heads the report.
// `format` 'pdf' names the PDF of it (reportFormat); anything else the HTML.
const reportFileName = (meta, kind, format = 'html') => topoFileName({ org: meta.client, site: typeof meta.fileSite === 'string' ? meta.fileSite : meta.site, date: meta.date || todayISO(), kind,
    fallback: meta.binder ? 'networks' : 'network' }, format === 'pdf' ? 'pdf' : 'html');
function openReportTab(html, meta, kind) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const name = reportFileName(meta, kind);

    const tab = window.open(url, '_blank');
    // A blob: page inherits this page's CSP, which forbids inline handlers, so
    // the toolbar's onclick is dead in the tab. It stays in the markup for the
    // downloaded file, which has no CSP; the tab is same-origin, so it is wired
    // from here instead.
    if (tab) tab.addEventListener('load', () => {
        const btn = tab.document.querySelector('.toolbar button');
        if (btn) btn.onclick = () => tab.print();
    });
    if (!tab) {
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { url, name, opened: !!tab };
}

// `meta` overrides the stored header for this one report: a read-only document
// cannot keep what was typed into the dialog (commitReportMeta), but the report
// the visitor asked for still carries it.
//
// A kept network's report says what changed since its last back-up or report
// (js/changes.js), and is then its new baseline: the next report says what
// changed since this one. Worked out before the baseline moves, or every
// report would say nothing had changed.
// parts: { summary, technical, largeMap } (reportParts); the diagram is drawn
// for either part, the summary carrying it on a sheet of its own.
// cache: the dialog's (reportImageCache), so a preview redrawn for every
// edit draws the diagram once per date rather than per keystroke.
// -> { html, meta, kind, onKept }
async function buildSiteReport(meta, parts, cache = null) {
    const p = reportParts(parts);
    // The dialog's date, not only the stored one: a read-only document never
    // stores what was typed, and the model would count to another day.
    // The saved searches only where the technical sheet prints them.
    const model = reportModel(meta, p.technical ? p.searches : []);
    if (meta) model.meta = siteReportMeta(meta);
    const keptId = isKept() ? state.libraryId : null;
    const doc = keptId ? serializeDoc() : null;
    if (keptId) model.changes = reportChanges(keptId, doc);
    // The Address history, only when ticked: what this browser's trail
    // holds for the card (js/trail.js), never the Simple summary's.
    if (keptId && p.technical && p.sections.history) model.history = trailReportHistory(keptId, doc);
    let image = null;
    {
        const day = reportAsOf(meta || state.report);
        try { image = await cachedImage(cache, `site:${day}`, () => captureReportDiagram(day)); }
        catch (e) { console.warn('Report: could not rasterise the diagram; continuing without it.', e); }
    }
    // The baseline moves when the report is handed over (downloaded or
    // printed), not when it is only looked at.
    return { html: reportHtml(model, image, p), meta: Object.assign({}, model.meta, { fileSite: keptSiteName() || model.meta.site }), kind: p.technical ? 'report' : 'summary',
        onKept: keptId ? reportKept(p, [{ id: keptId, doc }]) : null };
}
async function generateSiteReport(meta, parts) {
    const b = await buildSiteReport(meta, parts);
    return deliverReport(b.html, b.meta, b.kind, b.onKept);
}
// A cache's promise for `key`, made once; a failed one is not kept.
function cachedImage(cache, key, make) {
    if (!cache) return make();
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(make).catch((e) => { cache.delete(key); throw e; }));
    return cache.get(key);
}

// Draw a stored document onto the real canvas so it can be rasterised, then put
// the editor back exactly as it was. withDoc() cannot do this: it is a pure
// model swap that never renders, and it deliberately drops annotations — which
// captureCanvasImage measures when it crops. Never calls save(), so the URL
// and the undo timeline are untouched: the user asked for a report, not for
// their canvas to be edited.
// The diagram as of the report's day, as its findings are: a folded group's
// card (groupRollup, js/groupmap.js) counts every open finding, the age and
// service ones and a lapsed schedule among them. onChecksDay is synchronous
// only, so the canvas is drawn for that day and copied inside it
// (captureCanvasImage clones the canvas before its first await), then drawn
// for today again. Only the drawing: the panels never show the report's day.
// A pending typing redraw is flushed first, or the copy would draw it for
// that day through all of renderCanvasOnly.
// It also says where each device is drawn, which reportDiagramLayout needs to
// leave out a tile with nothing on it. base: pixels per unit before a very
// large drawing is capped (reportDiagramScale).
function captureReportDiagram(day, base = 4) {
    const scale = reportDiagramScale(base);
    const points = mapPointsOf(state.nodes).map((n) => [n.x, n.y]);
    const withPoints = (p) => p.then((img) => (img ? Object.assign(img, { points }) : img));
    if (!day || day === todayISO()) return withPoints(captureCanvasImage('png', scale));
    flushTypedRender();
    try { return withPoints(onChecksDay(day, () => { withLookupPass(drawCanvas); return captureCanvasImage('png', scale); })); }
    finally { withLookupPass(drawCanvas); }
}

async function withDocRendered(doc, fn) {
    // Every key loadDocState writes (holdDocState, js/app.js): a site's log
    // left behind would be saved into the open card.
    const held = Object.assign(holdDocState(), {
        camera: { x: state.camera.x, y: state.camera.y, zoom: state.camera.zoom },
        selection: state.selection,   // the whole set: a getter pair would lose a set of several
    });
    borrowCanvas(true);   // save() refuses while the canvas is not the user's document
    try {
        state.selection = new Set();
        loadDocState(doc || {});   // migrates a v1 card, as opening it would
        renderCanvasOnly();
        return await fn();
    } finally {
        restoreDocState(held);
        state.camera = held.camera;
        state.selection = held.selection;
        borrowCanvas(false);
        applyCamera(); renderCanvasOnly();
    }
}

// One picture per site, captured in turn. At the export's 4x a twelve-building
// estate is an enormous file for images printed two to a page, so these go in
// at 2x. A site that will not rasterise is skipped rather than failing the
// document — a report with one picture missing beats no report.
async function captureBinderImages(sites, onProgress, capture) {
    // Each site's diagram counts to that site's own date, as its sheet does:
    // inside withDocRendered, state.report is the site's.
    const grab = capture || ((doc) => withDocRendered(doc, () => captureReportDiagram(reportAsOf(), 2)));
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

async function buildBinderReport(estateMeta, opts = {}, cache = null) {
    // Sites only: a saved template is a starting point, not a building.
    flushAutosave();
    const entries = libraryNetworks();
    if (!entries.length) return null;
    const binder = binderModel(entries, estateMeta);
    // binderSiteModels drops the document once it has the model; the image
    // sweep needs it back, and matching by id keeps that lookup honest.
    const byId = new Map(entries.map((e) => [e.id, e.doc]));
    binder.sites.forEach((s) => { s.doc = byId.get(s.id); });
    // Each site's sheet says what changed since that card's baseline, and the
    // estate report is then every card's new one, as a site report is.
    binder.sites.forEach((s) => { if (s.model) s.model.changes = reportChanges(s.id, s.doc); });
    const p = reportParts(opts.parts);
    // Ticked, each site's sheet reads its own card's trail.
    if (p.technical && p.sections.history) binder.sites.forEach((s) => { if (s.model) s.model.history = trailReportHistory(s.id, s.doc); });
    const images = opts.images === false ? {}
        : await cachedImage(cache, 'binder', () => captureBinderImages(binder.sites, opts.onProgress, opts.capture));
    return { html: binderHtml(binder, images, p), meta: { site: binder.meta.site, client: binder.meta.client, date: binder.meta.date, ref: binder.meta.ref, binder: true },
        kind: p.technical ? 'report' : 'summary', onKept: reportKept(p, entries) };
}

async function generateBinderReport(estateMeta, opts = {}) {
    const b = await buildBinderReport(estateMeta, opts);
    if (!b) { showToast(t('Nothing to report on yet — save a network first.')); return null; }
    return deliverReport(b.html, b.meta, b.kind, b.onKept);
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

    REPORT_FIELDS.forEach(({ key, label, keys, placeholder, multiline }) => {
        const wrap = document.createElement('label');
        wrap.className = 'field';
        const cap = document.createElement('span');
        cap.className = 'prop-lbl';
        cap.textContent = t(label);
        const input = document.createElement(multiline ? 'textarea' : 'input');
        if (!multiline) input.type = 'text';
        else input.rows = 3;
        input.id = `report-${key}`;
        input.className = multiline ? 'textarea' : 'input';
        // keys: the phone keyboard the field asks for (KEYBOARDS, js/ui.js).
        setKeyboard(input, keys || 'prose');
        input.placeholder = (key === 'site' && _reportMode === 'site' && keptSiteName()) || t(placeholder) || '';
        // Who prepares it: the network's own, else this browser's default
        // (Settings, js/settings.js).
        input.value = meta[key] || (key === 'engineer' && typeof reportEngineerDefault === 'function' ? reportEngineerDefault() : '');
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

// A read-only document (one from a newer Topo) is never written, so its header
// is read for this report and not stored; the dialog's blurb says so up front,
// rather than save() reverting it with the generic read-only toast.
function commitReportMeta() {
    if (state.readOnly) return normalizeReportMeta(readReportFields());
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
    const entries = binder ? libraryNetworks() : [];
    const title = document.getElementById('reportDialogTitle');
    const blurb = document.getElementById('reportDialogBlurb');
    const build = document.getElementById('reportBuildBtn');
    const images = document.getElementById('reportImagesRow');
    if (title) title.textContent = binder ? t('Binder report') : t('Site report');
    if (blurb) {
        blurb.textContent = binder
            ? t('Every saved network as one document: the estate totals, the findings across all sites, the addressing they share, then each network in full.')
            : t('The findings, the inventory and the diagram as one printable document. Everything here is optional — it only fills in the header.')
                + (state.readOnly ? ` ${t('This network is read-only, so the header is used for this report and not kept.')}` : '');
    }
    if (build) build.textContent = reportDownloadLabel();
    relabelReportFormats();
    // The report prints every device's notes: a password in one is named
    // here, before the document is handed to anyone (js/assets.js).
    renderSecretLint(document.getElementById('reportLint'), secretHitsFor(binder ? 'binder-report' : 'doc'), binder ? null : closeReportDialog);
    if (images) {
        // Every part shows each site's map now, the summary too.
        images.classList.toggle('hidden', !binder);
        // On by default up to eight sites. Past that the sweep is slow and the
        // file is enormous, and the estate cover is the part being read anyway.
        const cb = document.getElementById('reportImages');
        if (cb && binder) cb.checked = entries.length <= 8;
    }
    renderReportFields(binder ? Object.assign({ site: '' }, binderHeaderDefaults(binderSiteModels(entries))) : null);
    // The search ticks' notes are worded too (This browser only, Not understood),
    // and so are the section ticks.
    renderReportSections(true);
    renderReportSearches(true);
}

function openReportDialog(mode) {
    const dialog = document.getElementById('reportDialog');
    if (!dialog) return;
    _reportMode = mode === 'binder' ? 'binder' : 'site';
    // Both, every time it opens: the hand-over copy is the usual report,
    // unless Settings says to start with one of them off (js/settings.js).
    const startOn = (key) => (typeof reportPartDefault === 'function' ? reportPartDefault(key) : true);
    [['reportSummary', 'reportSummaryOn'], ['reportTechnical', 'reportTechnicalOn']].forEach(([id, key]) => { const cb = document.getElementById(id); if (cb) cb.checked = startOn(key); });
    if (!document.getElementById('reportSummary')?.checked && !document.getElementById('reportTechnical')?.checked) { const tech = document.getElementById('reportTechnical'); if (tech) tech.checked = true; }
    document.getElementById('reportLargeMapRow')?.classList.toggle('hidden', !document.getElementById('reportTechnical')?.checked);
    // Off: it adds pages.
    const large = document.getElementById('reportLargeMap');
    if (large) large.checked = false;
    ['reportLargeCols', 'reportLargeRows'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = String(REPORT_DIAGRAM_GRID_DEFAULT); });
    _largeSkip.clear();
    syncLargeSheets();
    document.getElementById('reportLargeMapRow')?.classList.toggle('hidden', !document.getElementById('reportTechnical')?.checked);
    renderReportSections();
    renderReportSearches();
    // The PDF | HTML switch above the file name (reportFormat).
    mountReportFormat(dialog, syncReportFormat);
    renderReportDialog();
    dropReportPreview();
    dialog.classList.remove('hidden');
    // Site is the first thing typed, except on a touch screen, where the
    // keyboard would cover the dialog before it is read (focusForTyping,
    // js/dialog.js): there the card takes the focus.
    focusForTyping(document.getElementById('report-site'), dialog.querySelector('.rpv'));
    scheduleReportPreview(0);
}

function openBinderReportDialog() {
    if (!libraryNetworks().length) { showToast(t('Nothing to report on yet — save a network first.')); return; }
    openReportDialog('binder');
}

const reportMode = () => _reportMode;

// The two ticks as reportParts reads them.
function readReportParts() {
    const on = (id) => { const cb = document.getElementById(id); return !cb || cb.checked; };
    const large = document.getElementById('reportLargeMap');
    const val = (id) => { const el = document.getElementById(id); return el ? Number(el.value) : REPORT_DIAGRAM_GRID_DEFAULT; };
    return reportParts({ summary: on('reportSummary'), technical: on('reportTechnical'), largeMap: !!(large && large.checked),
        largeCols: val('reportLargeCols'), largeRows: val('reportLargeRows'), largeSkip: largeSkipInGrid(val('reportLargeCols'), val('reportLargeRows')),
        searches: readReportSearches(), sections: readReportSections() });
}
// ---- The technical sheet's sections to print (an owner request, 2026-11-04) ----
// A tick per REPORT_SECTIONS entry (none for one marked reserved), each
// starting from its default every time the dialog opens: nothing is
// remembered between openings, in this browser or the document, so a
// report nobody unticks is the usual one. Site and binder alike. The row
// shows while the technical sheet is ticked (syncReportSections).
// keep: redrawn in place (a language switch), the ticks as they were left.
function renderReportSections(keep) {
    const list = document.getElementById('reportSectionsList');
    if (!list) return;
    const held = new Map(keep ? [...list.querySelectorAll('[data-section]')].map((cb) => [cb.dataset.section, cb.checked]) : []);
    list.replaceChildren(...REPORT_SECTIONS.filter((x) => !x.reserved).map(({ key, label, on }) => {
        const row = document.createElement('label');
        row.className = 'dlg-section';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.section = key;
        cb.checked = held.has(key) ? held.get(key) : on;
        const text = document.createElement('span');
        text.textContent = t(label);
        const dim = key === 'capPorts' ? 'The nearly full switches only; Switch ports lists every port.'
            : key === 'history' ? 'What each device held at earlier back-ups and reports, from this browser. Networks kept here only.'
                : key === 'log' ? 'Each merge into this network from another copy, newest first.'
                    : key === 'incidents' ? 'Each problem reported and each visit recorded, with who reported it and how to reach them.' : '';
        if (dim) {
            const why = document.createElement('span');
            why.className = 'dlg-dim';
            why.textContent = t(dim);
            text.append(why);
        }
        row.append(cb, text);
        return row;
    }));
    syncReportSections();
}
function syncReportSections() {
    document.getElementById('reportSectionsRow')?.classList.toggle('hidden', !document.getElementById('reportTechnical')?.checked);
    syncReportSearches();
}
// The ticks as a sections map, or undefined when the dialog draws none:
// the defaults then hold.
function readReportSections() {
    const boxes = [...document.querySelectorAll('#reportSectionsList [data-section]')];
    if (!boxes.length) return undefined;
    const out = {};
    boxes.forEach((cb) => { out[cb.dataset.section] = cb.checked; });
    return out;
}
// ---- The saved searches to print (docs/BACKLOG.md feature 6, stage 3) ----
// A tick per saved search, in document order, each starting from its print
// mark every time the dialog opens; one that reads what this browser
// remembers (was:, has:history) says it will not be printed. A site report
// only: a binder prints each site's marked ones. The row shows while the
// technical sheet is ticked (syncReportSearches).
// keep: redrawn in place (a language switch, renderReportDialog), so a tick
// the visitor changed stays as they left it; only opening starts afresh.
function renderReportSearches(keep) {
    const list = document.getElementById('reportSearchesList');
    if (!list) return;
    const searches = _reportMode === 'site' ? (state.searches || []) : [];
    const held = new Map(keep ? [...list.querySelectorAll('[data-search]')].map((cb) => [cb.dataset.search, cb.checked]) : []);
    list.replaceChildren(...searches.map((s) => {
        const row = document.createElement('label');
        row.className = 'dlg-search';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.search = s.id;
        cb.checked = held.has(s.id) ? held.get(s.id) : !!s.print;
        const text = document.createElement('span');
        const name = document.createElement('span');
        name.textContent = s.name;
        const query = document.createElement('span');
        query.className = 'dlg-dim mono';
        query.textContent = s.query;
        text.append(name, document.createElement('br'), query);
        const local = queryLocalTerms(s.query);
        const why = local.length ? t('This browser only') : parseQuery(s.query).errors.length ? t('Not understood') : '';
        if (why) { const note = document.createElement('span'); note.className = 'dlg-dim'; note.textContent = ' · ' + why; text.append(note); }
        row.append(cb, text);
        return row;
    }));
    syncReportSearches();
}
function syncReportSearches() {
    const row = document.getElementById('reportSearchesRow');
    if (!row) return;
    const any = !!document.querySelector('#reportSearchesList [data-search]');
    const section = document.querySelector('#reportSectionsList [data-section="searches"]');
    row.classList.toggle('hidden', !any || !document.getElementById('reportTechnical')?.checked || (!!section && !section.checked));
}
// The ticked ids, or undefined when the dialog lists none (a binder, or a
// network with no saved searches): the default then holds.
function readReportSearches() {
    const boxes = [...document.querySelectorAll('#reportSearchesList [data-search]')];
    return boxes.length ? boxes.filter((cb) => cb.checked).map((cb) => cb.dataset.search) : undefined;
}
// At least one stays ticked: unticking the last one ticks the other.
(function wireReportParts() {
    const s = document.getElementById('reportSummary'), tech = document.getElementById('reportTechnical');
    if (!s || !tech) return;
    const keep = (other) => (e) => {
        if (!e.target.checked && !other.checked) other.checked = true;
        const images = document.getElementById('reportImagesRow');
        if (images) images.classList.toggle('hidden', _reportMode !== 'binder');
        // The large map is a diagram's, so the technical sheet's, and so
        // are the saved searches.
        document.getElementById('reportLargeMapRow')?.classList.toggle('hidden', !tech.checked);
        syncReportSections();
    };
    s.addEventListener('change', keep(tech));
    tech.addEventListener('change', keep(s));
})();

// The squares of the large map the visitor left out, by name. Kept while
// the grid changes size (a square that is no longer on it simply does not
// count), cleared each time the dialog opens.
const _largeSkip = new Set();
function largeSkipInGrid(cols, rows) {
    cols = gridCount(cols); rows = gridCount(rows);
    const names = new Set();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) names.add(tileName(c, r));
    const skip = [..._largeSkip].filter((x) => names.has(x));
    return skip.length >= names.size ? [] : skip;
}
// One square on or off; the last one printed stays on.
function toggleLargeSheet(name) {
    const p = readReportParts();
    if (_largeSkip.has(name)) _largeSkip.delete(name);
    else if (p.largeCols * p.largeRows - p.largeSkip.length > 1) _largeSkip.add(name);
    else return false;
    _reportPv.focusLarge = true;
    syncLargeSheets();
    scheduleReportPreview(50);
    return true;
}
// The large map's grid is asked only while Large map is ticked: its size,
// and a square per sheet to leave it out or put it back.
function syncLargeSheets() {
    const on = !!document.getElementById('reportLargeMap')?.checked && !!document.getElementById('reportTechnical')?.checked;
    document.getElementById('reportLargeSheetsRow')?.classList.toggle('hidden', !on);
    const p = readReportParts(), total = document.getElementById('reportLargeTotal');
    const all = p.largeCols * p.largeRows, n = all - p.largeSkip.length;
    if (total) total.textContent = n < all ? t('= {n} of {all} sheets', { n, all }) : t(n === 1 ? '= 1 sheet' : '= {n} sheets', { n });
    const cells = document.getElementById('reportLargeCells');
    if (!cells) return;
    const skip = new Set(p.largeSkip);
    cells.style.setProperty('--cols', p.largeCols);
    cells.replaceChildren(...Array.from({ length: all }, (_, i) => {
        const name = tileName(i % p.largeCols, Math.floor(i / p.largeCols));
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dlg-cell';
        b.dataset.cell = name;
        b.textContent = name;
        b.setAttribute('aria-pressed', String(!skip.has(name)));
        b.title = t(skip.has(name) ? 'Sheet {name}: left out' : 'Sheet {name}: printed', { name });
        return b;
    }));
}
function closeReportDialog() {
    document.getElementById('reportDialog')?.classList.add('hidden');
    dropReportPreview();
}

// ---- The preview, in the dialog ----
// The report as it will print, beside the questions that shape it: redrawn
// a moment after each edit, so what is downloaded or printed is what was
// read. The diagram is drawn once per opening (per date for a site, once
// for a binder's sweep) and reused for every redraw. The frame is a blob:
// page of this origin under this page's CSP; the report's own toolbar (an
// inline onclick) is hidden there, the dialog's buttons do its job. Only
// Download or Print hands the report over (its onKept); the header typed
// into a site's dialog is stored then too (commitReportMeta).
const _reportPv = { seq: 0, timer: null, url: null, built: null, cache: null, pending: null, focusLarge: false, session: 0 };
// What the dialog asks for now, read and not stored.
function reportDialogAsk() {
    const binder = _reportMode === 'binder';
    const raw = readReportFields();
    return { binder, meta: binder ? raw : normalizeReportMeta(raw), parts: readReportParts(),
        images: binder ? !!document.getElementById('reportImages')?.checked : false };
}
function buildFromAsk(ask) {
    return ask.binder ? buildBinderReport(ask.meta, { images: ask.images, parts: ask.parts }, _reportPv.cache)
        : buildSiteReport(ask.meta, ask.parts, _reportPv.cache);
}
function scheduleReportPreview(delay = 400) {
    clearTimeout(_reportPv.timer);
    _reportPv.timer = setTimeout(() => { refreshReportPreview(); }, delay);
}
function reportPreviewStatus(key) {
    const el = document.getElementById('reportPreviewStatus');
    if (el) el.textContent = key ? t(key) : '';
}
async function refreshReportPreview() {
    clearTimeout(_reportPv.timer);
    const dialog = document.getElementById('reportDialog');
    const frame = document.getElementById('reportPreviewFrame');
    if (!dialog || dialog.classList.contains('hidden') || !frame) return null;
    if (!_reportPv.cache) _reportPv.cache = new Map();
    const seq = ++_reportPv.seq;
    reportPreviewStatus('Updating…');
    const run = (async () => {
        let b;
        try { b = await buildFromAsk(reportDialogAsk()); }
        catch (e) { console.warn('Report preview failed:', e); if (seq === _reportPv.seq) reportPreviewStatus('Could not build the report.'); return null; }
        if (seq !== _reportPv.seq || dialog.classList.contains('hidden')) return null;
        if (!b) { reportPreviewStatus('Nothing to report on yet — save a network first.'); return null; }
        // Opened as a file (the offline zip), a blob: frame is another origin
        // and its document cannot be read, so the report goes in as srcdoc,
        // which shares this page's origin and CSP. On the web, and in the
        // desktop app, the blob as before.
        const inline = location.protocol === 'file:';
        const url = inline ? null : URL.createObjectURL(new Blob([b.html], { type: 'text/html;charset=utf-8' }));
        const old = _reportPv.url;
        const hadOne = !!(old || _reportPv.built);
        _reportPv.url = url; _reportPv.built = b;
        // Where the preview was, so a redraw does not send it back to the
        // top; after a change to the large map's grid, its overview instead.
        let was = 0;
        try { was = hadOne && frame.contentWindow ? frame.contentWindow.scrollY : 0; } catch (e) { /* not readable */ }
        const toLarge = _reportPv.focusLarge;
        _reportPv.focusLarge = false;
        // Resolved once the frame shows it, so Print prints this one.
        await new Promise((done) => {
            const shown = () => {
                frame.onload = null;
                try {
                    const bar = frame.contentDocument && frame.contentDocument.querySelector('.toolbar');
                    if (bar) bar.style.display = 'none';
                    // Esc inside the page (focused by Print, or a click on
                    // it) closes the dialog too, as in the sheet preview.
                    frame.contentWindow.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReportDialog(); });
                    wirePreviewCells(frame.contentDocument);
                    fitReportPreview(frame);
                    placeReportPreview(frame, toLarge, was);
                } catch (e) { /* not readable: the toolbar stays, harmless */ }
                if (old) URL.revokeObjectURL(old);
                done();
            };
            frame.onload = shown;
            setTimeout(shown, 5000);   // a frame that never says it loaded
            if (inline) frame.srcdoc = b.html;
            else frame.src = url;
        });
        if (seq !== _reportPv.seq) return null;
        const name = document.getElementById('reportPreviewName');
        if (name) name.textContent = reportFileName(b.meta, b.kind, reportFormat());
        reportPreviewStatus('');
        return b;
    })();
    _reportPv.pending = run;
    return run;
}
// Scrolls the preview within its own frame (never the dialog around it): to
// the large map's overview when asked and there is one, else back to `y`.
function placeReportPreview(frame, toLarge, y) {
    const win = frame.contentWindow, doc = frame.contentDocument;
    if (!win || !doc) return;
    const ov = toLarge ? doc.querySelector('.dg-cell[data-cell]') : null;
    const sheet = ov && ov.closest('.sheet');
    if (sheet) win.scrollTo(0, Math.max(0, sheet.getBoundingClientRect().top + win.scrollY - 12));
    else if (y) win.scrollTo(0, y);
}
// A preview narrower than a page (a phone) shows the page scaled down, as it
// will print, rather than the report reflowed to a phone's width (its own
// narrow-screen rules go by the frame's width): the frame is laid out a page
// wide and the frame itself scaled to fit. Only the element is scaled, so
// printing its document is untouched.
const REPORT_PREVIEW_PAGE_PX = 820;
function fitReportPreview(frame) {
    const box = frame && frame.parentElement;
    if (!box) return;
    frame.style.width = ''; frame.style.height = ''; frame.style.transform = ''; frame.style.flex = '';
    // box is the dialog's stage (.rpv-stage), which holds the frame alone.
    const w = box.clientWidth;
    if (!w || w >= REPORT_PREVIEW_PAGE_PX) return;
    const k = w / REPORT_PREVIEW_PAGE_PX;
    const h = Math.max(200, box.clientHeight);
    Object.assign(frame.style, { flex: 'none', width: `${REPORT_PREVIEW_PAGE_PX}px`, height: `${Math.round(h / k)}px`,
        transform: `scale(${k})`, transformOrigin: '0 0' });
}
window.addEventListener('resize', () => { const f = document.getElementById('reportPreviewFrame'); if (f && (_reportPv.url || _reportPv.built)) fitReportPreview(f); });
function dropReportPreview() {
    clearTimeout(_reportPv.timer);
    _reportPv.seq++;
    _reportPv.session++;
    const frame = document.getElementById('reportPreviewFrame');
    if (frame) { frame.onload = null; frame.removeAttribute('src'); frame.removeAttribute('srcdoc'); }
    if (_reportPv.url) URL.revokeObjectURL(_reportPv.url);
    _reportPv.url = null; _reportPv.built = null; _reportPv.cache = null; _reportPv.pending = null;
    const name = document.getElementById('reportPreviewName');
    if (name) name.textContent = '';
}
const reportPreviewBuilt = () => _reportPv.built;
// The header as the report will carry it: a site's is stored now (a
// read-only document's is only read), a binder's belongs to this document.
function commitReportAsk() {
    if (_reportMode === 'binder') return;
    commitReportMeta();
}
// The switch changed: the Download button and the file name follow it.
function syncReportFormat() {
    const build = document.getElementById('reportBuildBtn');
    if (build) build.textContent = reportDownloadLabel();
    const name = document.getElementById('reportPreviewName'), b = _reportPv.built;
    if (name && b) name.textContent = reportFileName(b.meta, b.kind, reportFormat());
}
// Download: the report as previewed, built again after the header is
// stored (so the changes section does not count the header it just got),
// saved as a file in the switch's format (reportFormat). The HTML is saved
// and the dialog closes at once; a PDF takes a moment, said in the status
// (the buttons are held by reportAction, js/app.js), and the dialog closes
// once it is saved. A PDF that could not be made says so and the dialog
// stays; one finished after the dialog was closed is not saved.
async function downloadReportFromDialog() {
    commitReportAsk();
    const b = await buildFromAsk(reportDialogAsk());
    if (!b) { showToast(t('Nothing to report on yet — save a network first.')); return null; }
    const format = reportFormat();
    if (format !== 'pdf') {
        closeReportDialog();
        return deliverReport(b.html, b.meta, b.kind, b.onKept);
    }
    clearTimeout(_reportPv.timer);
    const session = _reportPv.session;
    reportPreviewStatus('Creating the PDF…');
    const out = await deliverReport(b.html, b.meta, b.kind, b.onKept, 'pdf', () => _reportPv.session === session);
    if (_reportPv.session !== session) return out;
    if (out && out.ok === false) { reportPreviewStatus('Could not create the PDF.'); return out; }
    closeReportDialog();
    return out;
}
// The desktop app's answer to "do you print reports yourself?", asked once
// per app (an app with no such command, or none at all, does not).
let _hostPrints = null;
function hostPrintsReports(host) {
    if (!_hostPrints || _hostPrints.host !== host) {
        _hostPrints = { host, answer: Promise.resolve().then(() => host.invoke('host_prints')).then((v) => v === true, () => false) };
    }
    return _hostPrints.answer;
}
// Print: the preview redrawn with the stored header, then that frame printed
// (or saved as PDF from the print dialog). The dialog stays, for a copy.
async function printReportFromDialog() {
    commitReportAsk();
    const b = await refreshReportPreview();
    const frame = document.getElementById('reportPreviewFrame');
    if (!b || !frame || !frame.contentWindow) return false;
    if (typeof b.onKept === 'function') { try { b.onKept(); } catch (e) { console.warn('Report: could not record the hand-over.', e); } }
    // The desktop app on macOS cannot print a frame (WKWebView), so the app
    // opens the report in the default browser, where its own Print button
    // works. The page asks once whether the app prints (host_prints), so the
    // report crosses IPC only to an app that does. The website has no __TAURI__.
    const host = window.__TAURI__ && window.__TAURI__.core;
    if (host && typeof host.invoke === 'function' && await hostPrintsReports(host)) {
        try {
            if (await host.invoke('host_print', { html: b.html, name: reportFileName(b.meta, b.kind) })) return true;
        } catch (e) { console.warn('Report: the app could not print, printing the preview.', e); }
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
    return true;
}
// In the preview, the large map's overview squares are the toggles too: a
// click leaves that sheet out or puts it back. Only the preview is wired;
// the file downloaded or printed is the plain report.
function wirePreviewCells(doc) {
    if (!doc) return;
    const cells = doc.querySelectorAll('.land-head + svg .dg-cell[data-cell]');
    if (!cells.length || !document.getElementById('reportLargeMap')?.checked) return;
    const css = doc.createElement('style');
    css.textContent = '.dg-cell[data-cell] { cursor: pointer; } .dg-cell[data-cell]:hover rect { fill: rgba(37, 99, 235, 0.14); }';
    doc.head.appendChild(css);
    cells.forEach((g) => {
        // Only the overview's own squares (the sheets after it have none).
        g.addEventListener('click', () => toggleLargeSheet(g.dataset.cell));
    });
}
(function wireReportPreview() {
    const fields = document.getElementById('reportFields');
    if (fields) fields.addEventListener('input', () => scheduleReportPreview());
    document.getElementById('reportSectionsList')?.addEventListener('change', syncReportSearches);
    ['reportLargeMap', 'reportTechnical', 'reportLargeCols', 'reportLargeRows'].forEach((id) => document.getElementById(id)?.addEventListener('change', syncLargeSheets));
    // A change to the large map's grid shows the preview at its overview.
    ['reportLargeMap', 'reportLargeCols', 'reportLargeRows'].forEach((id) => document.getElementById(id)?.addEventListener('change', () => { _reportPv.focusLarge = true; }));
    document.getElementById('reportLargeCells')?.addEventListener('click', (e) => {
        const b = e.target.closest('.dlg-cell');
        if (b) toggleLargeSheet(b.dataset.cell);
    });
    ['reportSummary', 'reportTechnical', 'reportLargeMap', 'reportLargeCols', 'reportLargeRows', 'reportImages', 'reportSearchesList', 'reportSectionsList'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', () => scheduleReportPreview(50));
    });
})();
