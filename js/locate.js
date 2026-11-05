// ---- Locate in the Full editor (docs/BACKLOG.md, feature 1, stage 2) ----
// The device panel's Locate section: where the selected device is plugged
// in, read from locatePath (js/model.js) and never stored. A vertical list
// of steps (the device's NIC, the cable, the port with its jack, the rack
// units, the group path), each a button: a device selects that device, a
// cable selects the cable, Open in rack shows the rack in One cable mode on
// that cable, and a cable with no port at the switch offers Pick a port.
// Every gap is a muted line saying what is missing, never a guessed value.
// The reduced views (#simple, #imagenology) get one plain read-only
// sentence instead (#locateSentence, stage 4), and W shows it there.
// Show on map selects the path's devices and cables and fits them in view:
// a view action, never an undo step. Key W (SHORTCUTS, js/app.js) opens the
// section. Print (stage 5, locateHtml/printLocate at the end of this file)
// opens the on-site sheet for the device, or from the rail for a selection.
// Loaded after js/rackview.js (openRackView, rvTraceCable,
// openCablePorts) and before js/query.js; renderSidebarData (js/ui.js) calls
// renderLocate at run time.

const locateEl = (id) => document.getElementById(id);
const locName = (n) => (n && n.name && String(n.name).trim()) || (n ? n.id : '');
// "SW-1 · Gi1/0/3": a device and, when one is picked, its port.
const locAt = (n, port) => (port ? `${locName(n)} · ${port}` : locName(n));

// The gap's sentence, in the Full editor's words. The values in it (names,
// port names, the typed location) are data and are never translated. hop:
// the hop the gap is on (its far port and place), when it is on one.
function locateGapText(gap, hop) {
    const name = locName(gap.node);
    switch (gap.code) {
        case 'noCable': return t('No cable recorded.');
        case 'noUplink': return t('Nothing recorded leads up from {device}.', { device: name });
        case 'noPort': return t('No port picked at {switch}.', { switch: name });
        case 'noJack': return t('Port {port} has no jack label.', { port: hop ? hop.farPort : gap.portId || '' });
        case 'noVia': return t('No via written for this cable.');
        case 'notGrouped': return t('{device} is in no group.', { device: name });
        case 'notPlaced': {
            const rack = hop && hop.place.rack;
            return t('In {rack}, not placed yet.', { rack: rack ? groupLabel(rack) : t('Rack') });
        }
        case 'radioUnknown': return t('Which side is the access point is not recorded.');
        case 'apUpstream': return t('Which access point is upstream is not recorded.');
        case 'retired': return t('{device} is retired.', { device: name });
        default: return '';
    }
}

// Why a leg's walk ended, where that is worth a line: a faceplate reached is
// the answer, and the gaps already say the rest (noUplink, radioUnknown,
// apUpstream).
function locateStopText(leg) {
    const s = leg && leg.stop;
    if (!s) return '';
    const name = locName(s.node);
    switch (s.reason) {
        case 'depth': return t(leg.hops.length === 1 ? 'Stopped after {n} step.' : 'Stopped after {n} steps.', { n: leg.hops.length });
        case 'loop': return t('{device} is already on this path: stopped there.', { device: name });
        case 'several': return t('More than one cable leads on from {device}: which one is not recorded.', { device: name });
        case 'routing': return t('Stops at {device}, a routing device.', { device: name });
        default: return '';
    }
}

// The one-line answer in the section's summary: where the first cable ends.
function locateSummaryText(path) {
    const leg = path && path.legs[0];
    const hop = leg && leg.hops[leg.hops.length - 1];
    return hop ? locAt(hop.far, hop.farPort) : '';
}

// Every device and cable on the path, for Show on map.
function locateEntries(path) {
    const seen = new Set(), entries = [];
    const add = (type, id) => { const k = `${type}:${id}`; if (!seen.has(k)) { seen.add(k); entries.push({ type, id }); } };
    if (!path || !path.start) return entries;
    add('node', path.start.node.id);
    path.start.hosts.forEach((h) => add('node', h.id));
    path.legs.forEach((leg) => leg.hops.forEach((h) => { add('node', h.from.id); add('link', h.link.id); add('node', h.far.id); }));
    return entries;
}

// One hop's words, shared by the section and the print sheet: the near
// end's NIC (with its bond), the cable's main line and its facts (tag,
// medium, colour and length; on Wi-Fi the SSID and band as recorded, or as
// worked out, marked so), the via exactly as typed ('' when none), and the
// far port's jack and VLANs (untagged and tagged on a trunk).
function locateHopFacts(h) {
    const nic = h.nic ? h.nic + (h.bond ? ` (${h.bond})` : '') : '';
    const meta = [];
    let main;
    if (h.medium === 'wireless') {
        const w = h.wifi || {};
        main = t('Wi-Fi');
        const inf = (on) => (on ? ` ${t('(inferred)')}` : '');
        // The link holds the Wi-Fi network's id: its name is shown.
        const net = w.ssid ? wifiById(w.ssid) : null;
        const ssid = net && net.ssid && String(net.ssid).trim() ? net.ssid : w.ssid;
        if (ssid) meta.push(`${ssid}${inf(w.ssidInferred)}`);
        if (w.band) meta.push(`${w.band} GHz${inf(w.bandInferred)}`);
        if (Number.isFinite(w.signal)) meta.push(`${w.signal} dBm`);
    } else {
        main = h.cable.tag ? t('Tag: {tag}', { tag: h.cable.tag }) : t('no tag');
        if (h.medium && h.medium !== 'utp') meta.push(h.medium);
        if (h.cable.color) meta.push(h.cable.color);
        if (h.cable.length) meta.push(h.cable.length);
    }
    const via = h.cable.via && h.cable.via.trim() ? h.cable.via : '';
    // An access port says "VLAN 10"; a trunk says which is untagged and
    // which are tagged (portVlanFacts, js/model.js).
    const jack = [h.jack ? t('Jack {jack}', { jack: h.jack }) : '', ...portVlanFacts(h.vlan, h.tagged)].filter(Boolean).join(' · ');
    return { nic, main, meta, via, jack };
}

// The cross-check: open findings about a hop's cable that matter to where a
// device is plugged in (the far port is set up for another VLAN, or gives
// the device no power). Read from the diagnosis, never worked out again;
// an accepted one is not shown.
const LOCATE_FINDING_KEYS = ['vlan-mismatch', 'poe-none'];
function locateLinkFindings(linkId) {
    const diag = typeof currentDiagnosis === 'function' ? currentDiagnosis() : null;
    if (!diag || !linkId) return [];
    return diag.findings.filter((f) => LOCATE_FINDING_KEYS.includes(f.key) && isOpenFinding(f) && (f.linkIds || []).includes(linkId));
}

// ---- The section ----
function locatePanelHtml(path) {
    const esc = escapeHtml;
    const dim = (retired) => (retired ? ' locate-retired' : '');
    const devBtn = (n, port, extra = '', retired = false) => `<li class="locate-row"><button type="button" class="locate-step locate-dev${dim(retired)}" data-loc-node="${esc(n.id)}">`
        + `<span class="locate-main">${esc(locAt(n, port))}</span>${extra}</button></li>`;
    const gapLine = (g) => {
        const pick = g.code === 'noPort' && g.link && !state.readOnly
            ? ` <button type="button" class="link-btn locate-pick" data-loc-pick="${esc(g.link.id)}">${esc(t('Pick a port'))}</button>` : '';
        const typed = g.code === 'notGrouped' && g.text ? ` <span class="locate-typed">${esc(t('Location typed on it: {text}', { text: g.text }))}</span>` : '';
        const hop = g.leg >= 0 && g.hop >= 0 ? path.legs[g.leg].hops[g.hop] : null;
        return `<li class="locate-gap" data-gap="${esc(g.code)}">${esc(locateGapText(g, hop))}${typed}${pick}</li>`;
    };
    const gapsOf = (li, hi) => path.gaps.filter((g) => g.leg === li && g.hop === hi).map(gapLine).join('');
    const parts = [];
    const start = path.start;
    parts.push(`<ol class="locate-steps">${devBtn(start.node, '', '', start.retired)}`
        + start.hosts.map((h) => `<li class="locate-row"><button type="button" class="locate-step locate-dev${dim(isRetired(h))}" data-loc-node="${esc(h.id)}">`
            + `<span class="locate-main">${esc(t('Runs on {host}', { host: locName(h) }))}</span></button></li>`).join('')
        + gapsOf(-1, -1) + '</ol>');
    path.legs.forEach((leg, li) => {
        const rows = [];
        // Open in rack: the far device's rack, else the near end's (the
        // device's own on the first cable).
        let fromRack = start.place.rack;
        leg.hops.forEach((h, hi) => {
            const f = locateHopFacts(h);
            rows.push(devBtn(h.from, f.nic, '', isRetired(h.from)));
            const via = f.via ? `<span class="locate-via"><span class="locate-k">${esc(t('Via'))}: </span><span class="locate-data">${esc(f.via)}</span></span>` : '';
            rows.push(`<li class="locate-row"><button type="button" class="locate-step locate-cable" data-loc-link="${esc(h.link.id)}">`
                + `<span class="locate-main">${esc(f.main)}</span>${f.meta.length ? `<span class="locate-meta">${esc(f.meta.join(' · '))}</span>` : ''}${via}</button></li>`);
            // The far end: the port, its jack and VLAN.
            rows.push(devBtn(h.far, h.farPort, f.jack ? `<span class="locate-meta">${esc(f.jack)}</span>` : '', h.retired));
            locateLinkFindings(h.link.id).forEach((x) => rows.push(`<li class="locate-finding ${x.level === 'bad' ? 'bad' : 'warn'}" data-loc-finding="${esc(x.key)}"`
                + ` title="${esc(t('Open finding on this cable: {text}', { text: x.line || x.detail }))}"><span aria-hidden="true">${x.level === 'bad' ? '❌' : '⚠️'}</span> ${esc(x.line || x.detail)}</li>`));
            // Where it is: the rack's units (Open in rack), then the groups.
            const p = h.place;
            const rack = p.rack || fromRack;
            if (p.rack && p.units) rows.push(`<li class="locate-place">${esc(groupLabel(p.rack))} · ${esc(p.units)}</li>`);
            // Only on a cable the rack view draws: a radio link (or a VPN)
            // is never among a rack's cables, so One cable mode on it would
            // show nothing.
            if (rack && rackCableLinks(rack).includes(h.link)) rows.push(`<li class="locate-row"><button type="button" class="locate-step locate-rack" data-loc-rack="${esc(rack.id)}" data-loc-link="${esc(h.link.id)}" title="${esc(t('Trace this cable in the rack view.'))}">`
                + `<span class="locate-main">${esc(t('Open in rack'))}</span><span class="locate-meta">${esc(groupLabel(rack))}</span></button></li>`);
            if (p.groups.length) rows.push(`<li class="locate-place locate-groups">${p.groups.map((g) =>
                `<span class="locate-grp"><span class="locate-k">${esc(groupKindName(g.kind))}</span> ${esc(g.name || '')}</span>`).join('<span class="locate-sep" aria-hidden="true"> › </span>')}</li>`);
            rows.push(gapsOf(li, hi));
            fromRack = p.rack;
        });
        const stop = locateStopText(leg);
        if (stop) rows.push(`<li class="locate-gap" data-stop="${esc(leg.stop.reason)}">${esc(stop)}</li>`);
        const head = path.legs.length > 1 ? `<p class="locate-leg">${esc(t('Cable {n} of {total}', { n: li + 1, total: path.legs.length }))}</p>` : '';
        parts.push(`${head}<ol class="locate-steps">${rows.join('')}</ol>`);
    });
    parts.push(`<div class="locate-acts"><button type="button" class="cs-btn locate-show" data-loc-show title="${esc(t('Select the path\'s devices and cables and fit them in view.'))}">${esc(t('Show on map'))}</button>`
        + `<button type="button" class="cs-btn locate-print" data-loc-print title="${esc(t('Print where it is plugged in: a page to take on site.'))}">${esc(t('Print'))}</button></div>`);
    return parts.join('');
}

// The path last drawn, for the buttons.
let _locatePath = null;
function renderLocate(node) {
    const group = locateEl('locateGroup');
    if (!group) return;
    // The reduced views' plain sentence (locatePlainSentence, js/model.js,
    // stage 4): read-only, in the device panel, never the Full steps.
    const sentence = locateEl('locateSentence');
    const plain = node && isReduced() ? locatePlainSentence(locatePath(node)) : '';
    if (sentence && sentence.textContent !== plain) sentence.textContent = plain;
    if (!node || isReduced()) { _locatePath = null; locateEl('locateBody').innerHTML = ''; locateEl('locateSummary').textContent = ''; return; }
    const path = locatePath(node);
    _locatePath = path;
    locateEl('locateSummary').textContent = locateSummaryText(path);
    // Drawn only while open; the toggle draws it when it opens.
    locateEl('locateBody').innerHTML = group.open ? locatePanelHtml(path) : '';
}
const locateNode = () => (state.selectedType === 'node' && state.selectedId ? getNode(state.selectedId) : null);

// Open state: a view preference of this browser, like the Asset group's.
const LOCATE_OPEN_KEY = 'nettopo_locate_open';
function restoreLocateGroup() {
    let open = false;
    try { open = localStorage.getItem(LOCATE_OPEN_KEY) === '1'; } catch (e) { /* storage blocked: closed */ }
    locateEl('locateGroup').open = open;
}
locateEl('locateGroup').addEventListener('toggle', () => {
    const open = locateEl('locateGroup').open;
    try { localStorage.setItem(LOCATE_OPEN_KEY, open ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (open) renderLocate(locateNode());
});
restoreLocateGroup();

// Show on map: the path's devices and cables selected and fitted in view.
// Selection and camera only: no edit, no undo step.
function locateShowOnMap(path = _locatePath) {
    const entries = locateEntries(path);
    if (!entries.length) return false;
    // On a phone the rail is a drawer over the map: shut, so the fit shows
    // (as openRackView and showFindingOnMap do).
    const ws = document.querySelector('.topo-ws');
    if (ws && ws.classList.contains('drawer-open') && window.matchMedia('(max-width: 900px)').matches) {
        const toggle = document.querySelector('[data-ws-toggle]');
        if (toggle) toggle.click();
    }
    if (typeof effectiveView === 'function' && effectiveView() !== 'map') setView('map');
    selectEntries(entries);
    centreOnNodes(entries.filter((e) => e.type === 'node').map((e) => getNode(e.id)).filter(Boolean));
    return true;
}

locateEl('locateBody').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.locRack) {
        if (openRackView(b.dataset.locRack)) rvTraceCable(b.dataset.locLink);
        return;
    }
    if (b.dataset.locPick) { const link = getLink(b.dataset.locPick); if (link) openCablePorts(link); return; }
    if (b.hasAttribute('data-loc-show')) { locateShowOnMap(); return; }
    if (b.hasAttribute('data-loc-print')) { const n = locateNode(); if (n) printLocate([{ type: 'node', id: n.id }]); return; }
    if (b.dataset.locNode && getNode(b.dataset.locNode)) { selectEntries([{ type: 'node', id: b.dataset.locNode }]); return; }
    if (b.dataset.locLink && getLink(b.dataset.locLink)) selectEntries([{ type: 'link', id: b.dataset.locLink }]);
});

// Key W: with one device selected, its Locate section opened and scrolled
// to (in a reduced view, its plain sentence shown); with nothing selected,
// the search box, as / does.
function openLocate() {
    const node = locateNode();
    if (!node) return false;
    if (typeof showConfigTab === 'function') showConfigTab('config');
    const ws = document.querySelector('.topo-ws');
    if (ws && !ws.classList.contains('drawer-open') && window.matchMedia('(max-width: 900px)').matches) {
        const toggle = document.querySelector('[data-ws-toggle]');
        if (toggle) toggle.click();
    }
    if (isReduced()) {
        renderLocate(node);
        const p = locateEl('locateSentence');
        if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
        return true;
    }
    const group = locateEl('locateGroup');
    if (!group.open) group.open = true;   // the toggle event remembers it
    renderLocate(node);
    if (group.scrollIntoView) group.scrollIntoView({ block: 'nearest' });
    return true;
}
function locateKey() {
    if (openLocate()) return;
    if (state.selection.size) return;
    const f = locateEl('queryInput');
    if (f && f.offsetParent !== null) { f.focus(); f.select(); }
}

// ---- The print sheet (feature 1, stage 5) ----
// One self-contained page to take on site, like the labels sheet: no font,
// stylesheet, image or link is fetched, so it prints the same offline. One
// block per device (its name, asset tag, address and MAC), then every step
// of every cable and every gap, in the section's words, under the network's
// name and the date. Printed from the Locate section (one device) and from
// the rail for a selection of devices.

// The selection's devices, by name, each with its path: [{ node, path }].
// One lookup pass, so a page of devices asks each path once.
function locateRows(entries = [...state.selection]) {
    const ids = [...new Set(entries.filter((e) => e && e.type === 'node').map((e) => e.id))];
    const nodes = ids.map(getNode).filter(Boolean).sort((a, b) => naturalCompare(locName(a), locName(b)));
    return withLookupPass(() => nodes.map((node) => ({ node, path: locatePath(node) })));
}

// rows: locateRows's; meta: { site, date }.
function locateHtml(rows, meta = {}) {
    const esc = escapeHtml;
    const li = (cls, html) => `<li class="${cls}">${html}</li>`;
    const dev = (n, port, extra, retired) => li(`dev${retired ? ' retired' : ''}`, `<b>${esc(locAt(n, port))}</b>${extra ? ` <span class="dim">${esc(extra)}</span>` : ''}`
        + (retired ? ` <span class="dim">(${esc(t('Retired'))})</span>` : ''));
    const block = ({ node, path }) => {
        const ifaces = node.interfaces || [];
        const ip = (ifaces.find((i) => parseValidCIDR(i.ip)) || {}).ip || '';
        const macIf = ifaces.find((i) => !isBlank(i.mac));
        const facts = [!isBlank(node.assetTag) ? `${t('Asset tag')} ${String(node.assetTag).trim()}` : '', ip, macIf ? fmtColonSafe(macIf.mac) : '']
            .filter(Boolean).map((v) => `<span class="mono">${esc(v)}</span>`).join('');
        const gapLine = (g) => {
            const hop = g.leg >= 0 && g.hop >= 0 ? path.legs[g.leg].hops[g.hop] : null;
            const typed = g.code === 'notGrouped' && g.text ? ` ${esc(t('Location typed on it: {text}', { text: g.text }))}` : '';
            return li('gap', `${esc(locateGapText(g, hop))}${typed}`);
        };
        const gapsOf = (l, h) => path.gaps.filter((g) => g.leg === l && g.hop === h).map(gapLine).join('');
        const start = path.start;
        const head = start.hosts.map((h) => li(`dev${isRetired(h) ? ' retired' : ''}`, esc(t('Runs on {host}', { host: locName(h) })))).join('') + gapsOf(-1, -1);
        const legs = path.legs.map((leg, l) => {
            const rows = [];
            leg.hops.forEach((h, k) => {
                const f = locateHopFacts(h);
                rows.push(dev(h.from, f.nic, '', isRetired(h.from)));
                rows.push(li('cab', `${esc(f.main)}${f.meta.length ? ` <span class="dim">${esc(f.meta.join(' · '))}</span>` : ''}`
                    + (f.via ? `<span class="via"><span class="dim">${esc(t('Via'))}:</span> <span class="mono">${esc(f.via)}</span></span>` : '')));
                rows.push(dev(h.far, h.farPort, f.jack, h.retired));
                const p = h.place;
                if (p.rack && p.units) rows.push(li('place', `${esc(groupLabel(p.rack))} · ${esc(p.units)}`));
                if (p.groups.length) rows.push(li('place', p.groups.map((g) => `<span class="dim">${esc(groupKindName(g.kind))}</span> ${esc(g.name || '')}`).join(' › ')));
                rows.push(gapsOf(l, k));
            });
            const stop = locateStopText(leg);
            if (stop) rows.push(li('gap', esc(stop)));
            const n = path.legs.length > 1 ? `<p class="leg">${esc(t('Cable {n} of {total}', { n: l + 1, total: path.legs.length }))}</p>` : '';
            return `${n}<ol class="steps">${rows.join('')}</ol>`;
        }).join('');
        return `<section class="dev-block${start.retired ? ' retired' : ''}"><h2>${esc(locName(node))}${start.retired ? ` <span class="dim">(${esc(t('Retired'))})</span>` : ''}</h2>`
            + (facts ? `<p class="facts">${facts}</p>` : '')
            + (head ? `<ol class="steps">${head}</ol>` : '') + legs + '</section>';
    };
    const title = t('Where they are plugged in');
    const sub = [meta.site, meta.date].filter(Boolean).join(' · ');
    return `<!doctype html><html lang="${esc(document.documentElement.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
:root { color-scheme: light dark; --bg: #f3f4f6; --card: #fff; --text: #111; --dim: #4b5563; --rule: #d1d5db; }
@media (prefers-color-scheme: dark) { :root { --bg: #111318; --card: #1b1e25; --text: #f3f4f6; --dim: #a1a7b3; --rule: #3a3f4b; } }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.4; color: var(--text); background: var(--bg); overflow-wrap: anywhere; }
.toolbar { padding: 10px 16px; font-size: 13px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.toolbar button { font: inherit; min-height: 44px; padding: 6px 16px; }
header { padding: 0 16px; } h1 { font-size: 20px; margin: 4px 0 2px; } .sub { margin: 0 0 12px; color: var(--dim); }
.sheet { display: flex; flex-direction: column; gap: 12px; padding: 0 16px 16px; max-width: 900px; }
.dev-block { background: var(--card); border: 1px solid var(--rule); border-radius: 8px; padding: 10px 14px; break-inside: avoid; page-break-inside: avoid; }
h2 { font-size: 16px; margin: 0 0 2px; }
.facts { margin: 0 0 6px; display: flex; flex-wrap: wrap; gap: 4px 14px; }
.mono { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 12.5px; white-space: pre-wrap; }
.dim { color: var(--dim); }
.leg { margin: 8px 0 2px; font-weight: 700; font-size: 12px; color: var(--dim); }
.steps { list-style: none; margin: 4px 0 0; padding: 0 0 0 12px; border-left: 2px solid var(--rule); }
.steps li { padding: 2px 0; }
.cab, .place { font-size: 13px; } .via { display: block; }
.gap { font-style: italic; color: var(--dim); font-size: 13px; }
.retired { opacity: 0.6; }
@media print {
  :root { --bg: #fff; --card: #fff; --text: #000; --dim: #333; --rule: #999; color-scheme: light; }
  body { background: #fff; color: #000; font-size: 11pt; } .toolbar { display: none; }
  .sheet { padding: 0; max-width: none; } header { padding: 0; }
  .dev-block { border: 0; border-bottom: 1px solid #999; border-radius: 0; padding: 6pt 0; }
  .retired { opacity: 1; }
}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">${esc(t('Print'))}</button><span>${esc(t('Each device: the cables it is on, the port and jack at the far end, and where that is. What is not recorded is said, never guessed.'))}</span></div>
<header><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</header>
<div class="sheet">${rows.map(block).join('')}</div></body></html>`;
}

// From the selection (its devices), or one device. -> what was printed, or
// null with a toast saying why when the set holds no device.
function printLocate(entries = [...state.selection]) {
    const rows = locateRows(entries);
    if (!rows.length) { showToast(t('Select devices to print where they are plugged in.')); return null; }
    const meta = { site: docDisplayName(), date: todayISO() };
    return Object.assign({ rows }, deliverReport(locateHtml(rows, meta), meta, 'locate'));
}
{
    const btn = locateEl('printLocateBtn');
    if (btn) btn.onclick = () => printLocate();
}
