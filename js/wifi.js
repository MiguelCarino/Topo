// ---- Wi-Fi in the editor (Review-Packs/Topo-wifi.md, W1 part 2) ----
// The data is js/model.js "Wi-Fi": a radio on a wireless interface
// (iface.radio), the Wi-Fi networks (doc.wifi) and what one association is
// (link.wifi). This file is where they are edited:
//
//   the Wi-Fi tab   one card per Wi-Fi network in the rail, next to Subnets
//                   and Groups: its SSID, security, bands, subnet (and so its
//                   VLAN), whether it is hidden, the APs that broadcast it and
//                   how many clients are on it, with Select clients, Edit and
//                   Delete. Empty, it offers the three networks nearly every
//                   site has (Staff, Guest, IoT) as one click each. The tab is
//                   offered only while there is something wireless to talk
//                   about: an AP, a wireless link, or a Wi-Fi network already
//                   in the document (which a reload must never hide).
//   the link panel  a wireless link swaps the cable's facts (label, length,
//                   colour, via: there is no cable) for its SSID, band and
//                   signal, and shows the AP radio's channel and width on
//                   that band, read-only, one click from its editor. A VPN
//                   link hides the cable's facts too (js/assets.js).
//   the radio block under each wireless interface in the device editor,
//                   folded to one line ("Wi-Fi 6 · 2.4 GHz ch 6 · 5 GHz
//                   ch 36/80 · Staff, Guest"). An AP's (or a home router's)
//                   has the standard, a row per band with its channel and
//                   width, and the SSIDs it broadcasts as chips; a client's
//                   only the standard and the bands its card has.
//
// The owner's rule for all of it: simplify wherever possible. Defaults and
// inference come before fields, and a field shows only where it applies. So a
// link's SSID and band are inferred until somebody picks one (the select's
// first entry says what the inference is: "Auto · Staff"); an AP broadcasts
// every SSID on every band it shares with it until a chip is turned off; a
// channel and a width are picked from the ones valid for the band, never
// typed; a network is on every band unless it says otherwise; and there is no
// passphrase field, here or anywhere (js/model.js says why).
//
// Vocabulary: the trade's words stay English in the full editor (SSID, WPA3,
// 5 GHz, 802.11ax, dBm, Channel, Width, Band, Security, Standard, the tab's
// own name); the sentences and the plain words are translated (MESSAGES,
// js/i18n.js). None of this is in a reduced view (data-adv, and isReduced()).
//
// Every edit is one undo step: a select or a box through save(), typing (an
// SSID, a signal) through saveTyping(), several records at once through
// batch(). Which cards are open, and which radio blocks, is a view held here
// for the session, never in the document.
//
// The tab is rebuilt from the document after anything changes, as the Subnets
// and Groups tabs are (renderCanvasOnly calls renderWifiPanel), with their two
// exceptions: hidden, it only notes that it is out of date; with the focus in
// one of its fields, it waits until the focus leaves.
// Load order: ... networks -> groups -> hosts -> wifi -> motion -> ... -> app

let _wifiPanelDirty = true;
const _wifiEditOpen = new Set();   // Wi-Fi networks whose edit fields are open, this session
const _radioOpen = new Set();      // radioKey(node, iface): radio blocks unfolded, this session

const wifiPanel = () => document.getElementById('cfgPanel-wifi');
const wifiPanelShown = () => { const p = wifiPanel(); return !!p && !p.classList.contains('hidden') && !isReduced(); };
const wifiEl = (id) => document.getElementById(id);

// radioServes (js/model.js): an AP, or a home router with a radio of its
// own. The checks (js/diagnostics.js) ask it too, so the tab and the
// findings agree on who broadcasts what.

// Something wireless to talk about. A Wi-Fi network already in the document
// counts too, or a register that lost its last AP would hide its networks.
function wifiInUse() {
    if ((state.wifi || []).length) return true;
    if (state.nodes.some((n) => n.type === 'ap')) return true;
    return withLookupPass(() => state.links.some((l) => effectiveMedium(l) === 'wireless'));
}
const wifiOffered = () => !isReduced() && wifiInUse();

// The clients on a network (wifiBroadcasters, js/model.js, are the APs
// on it): an association whose SSID is it, picked or inferred
// (linkWifiSsid), so a card counts what the link panel shows.
function wifiClientLinks(id) {
    return state.links.filter((l) => {
        const e = wifiLinkEnds(l);
        return !!e && !!e.client && linkWifiSsid(l) === id;
    });
}
function wifiClients(id) {
    const seen = new Set(), out = [];
    wifiClientLinks(id).forEach((l) => {
        const e = wifiLinkEnds(l);
        if (e && e.client && !seen.has(e.client.node.id)) { seen.add(e.client.node.id); out.push(e.client.node); }
    });
    return out;
}

// "2.4 · 5 GHz": a list of bands, low to high, in the trade's way of writing them.
const wifiBandsText = (bands) => (bands && bands.length ? bands.join(' · ') + ' GHz' : '');
// "Office LAN · VLAN 10", or '' when the network is on no subnet.
function wifiSubnetText(w) {
    const net = w && w.network ? networkById(w.network) : null;
    if (!net) return '';
    return networkLabel(net) + (Number.isInteger(net.vlan) ? ` · VLAN ${net.vlan}` : '');
}
// A guest network, by its name, in the languages the page speaks: the one a
// new device is not put on unless somebody says so (js/add.js).
const WIFI_GUEST_RE = /guest|visit|invit|convid|гост|ゲスト|来客/i;
const wifiIsGuest = (w) => !!w && WIFI_GUEST_RE.test(w.ssid || '');

// ============================================================================
// The Wi-Fi tab
// ============================================================================
function renderWifiPanel(force) {
    const btn = wifiEl('wifiTabBtn');
    const offered = wifiOffered();
    if (btn) btn.classList.toggle('hidden', !offered);
    // The tab went away under the visitor (the last AP deleted, an undo):
    // never leave the rail on a panel with no tab.
    if (!offered && btn && btn.getAttribute('aria-selected') === 'true') showConfigTab('config');
    const panel = wifiPanel();
    if (!panel) return;
    if (!wifiPanelShown()) { _wifiPanelDirty = true; return; }
    const active = document.activeElement;
    if (!force && active && panel.contains(active) && active.matches('input, select, textarea')) { _wifiPanelDirty = true; return; }
    _wifiPanelDirty = false;

    // A rebuild replaces the buttons and fields: the one that had the focus
    // gets it back.
    const d = active && panel.contains(active) && active.dataset;
    const refocus = d && d.wf ? (d.act ? `[data-act="${CSS.escape(d.act)}"][data-wf="${CSS.escape(d.wf)}"]`
        : d.field ? `[data-field="${CSS.escape(d.field)}"][data-wf="${CSS.escape(d.wf)}"]${d.band ? `[data-band="${CSS.escape(d.band)}"]` : ''}` : null) : null;

    const list = wifiEl('wifiList');
    const nets = state.wifi || [];
    list.innerHTML = nets.length ? withLookupPass(() => nets.map(wifiCardHtml).join('')) + wifiMorePresetsHtml(nets) : wifiEmptyHtml();
    if (refocus) { const again = panel.querySelector(refocus); if (again) again.focus(); }
}

// The empty tab: a sentence and the three networks nearly every site has,
// each one click. The SSIDs are the trade's own names, kept as they are.
const WIFI_PRESETS = {
    staff: { ssid: 'Staff', security: 'wpa2/3', hint: /staff|corp|office|employ|oficina|escrit|офис|社員|事務/i },
    guest: { ssid: 'Guest', security: 'owe', hint: WIFI_GUEST_RE },
    iot: { ssid: 'IoT', security: 'wpa2', bands: ['2.4'], hint: /\biot\b|smart|camera|cámara|câmera|камер|カメラ/i }
};
function wifiEmptyHtml() {
    return `<p class="rail-note">${escapeHtml(t('No Wi-Fi networks yet. Add the ones the access points broadcast: one click makes a usual one, and every field can be changed after.'))}</p>
        <div class="wifi-presets">
            ${Object.keys(WIFI_PRESETS).map((k) => `<button type="button" class="btn" data-act="preset" data-wf="${k}">+ ${escapeHtml(WIFI_PRESETS[k].ssid)}</button>`).join('')}
        </div>`;
}
// Under the cards, the usual ones not made yet stay one click each: the
// Staff + Guest + IoT site is three clicks, not one and two typed. A preset
// whose SSID is already a network's (any case) is not offered twice.
function wifiMorePresetsHtml(nets) {
    const have = new Set(nets.map((w) => (w.ssid || '').toLowerCase()));
    const left = Object.keys(WIFI_PRESETS).filter((k) => !have.has(WIFI_PRESETS[k].ssid.toLowerCase()));
    return left.length ? `<div class="chip-row wifi-presets-more" role="group" aria-label="${escapeHtml(t('Add a Wi-Fi network'))}">
            ${left.map((k) => `<button type="button" class="fchip" data-act="preset" data-wf="${k}">+ ${escapeHtml(WIFI_PRESETS[k].ssid)}</button>`).join('')}
        </div>` : '';
}

function wifiCardHtml(w) {
    const id = escapeHtml(w.id);
    const open = _wifiEditOpen.has(w.id);
    const aps = wifiBroadcasters(w.id).map((n) => n.name || n.id);
    const clients = wifiClients(w.id).length;
    const sec = w.security ? wifiSecurityName(w.security) : '';
    const subnet = wifiSubnetText(w);
    const bands = wifiBandsOf(w);
    const apsText = aps.length ? (aps.length > 4 ? t('{names} and {n} more', { names: aps.slice(0, 4).join(', '), n: aps.length - 4 }) : aps.join(', ')) : '';
    const option = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const nets = state.networks.slice().sort((a, b) => compareCidr(a.cidr, b.cidr));
    return `<article class="net-card wifi-card" data-wf="${id}">
        <div class="net-head">
            <span class="grp-name${w.ssid ? '' : ' net-muted'}">${escapeHtml(wifiLabel(w))}</span>
            ${w.hidden ? `<span class="chip-tag">${escapeHtml(t('Hidden'))}</span>` : ''}
        </div>
        <div class="net-line">${sec ? escapeHtml(sec) : `<span class="net-muted">${escapeHtml(t('security not set'))}</span>`} · ${escapeHtml(wifiBandsText(bands))}</div>
        <div class="net-line mono">${subnet ? escapeHtml(subnet) : `<span class="net-muted">${escapeHtml(t('on no subnet'))}</span>`}</div>
        <div class="net-line">${aps.length ? escapeHtml(t('Broadcast by {names}', { names: apsText })) : `<span class="net-muted">${escapeHtml(t('No access point broadcasts it.'))}</span>`}
            · ${escapeHtml(t(clients === 1 ? '{n} client' : '{n} clients', { n: clients }))}</div>
        <div class="net-actions">
            <button type="button" class="link-btn" data-act="clients" data-wf="${id}" ${clients ? '' : 'disabled'}
                title="${escapeHtml(t('Select every device on this Wi-Fi network and show them on the map'))}">${escapeHtml(t('Select clients'))}</button>
            <button type="button" class="link-btn" data-act="edit" data-wf="${id}" aria-expanded="${open}">${escapeHtml(t(open ? 'Close' : 'Edit'))}</button>
            <button type="button" class="link-btn quiet" data-act="delete" data-wf="${id}">${escapeHtml(t('Delete'))}</button>
        </div>
        <div class="net-edit prop-grid"${open ? '' : ' hidden'}>
            <div class="span2">
                <label class="prop-lbl" for="wf-${id}-ssid">SSID</label>
                <input id="wf-${id}-ssid" type="text" class="input" data-field="ssid" data-wf="${id}" value="${escapeHtml(w.ssid || '')}"
                    maxlength="${WIFI_SSID_MAX}" autocomplete="off" spellcheck="false">
            </div>
            <div>
                <label class="prop-lbl" for="wf-${id}-security">Security</label>
                <select id="wf-${id}-security" class="select" data-field="security" data-wf="${id}">
                    ${option('', '—', !w.security)}${WIFI_SECURITY.map((k) => option(k, wifiSecurityName(k), w.security === k)).join('')}
                </select>
            </div>
            <div>
                <label class="prop-lbl" for="wf-${id}-network">Subnet</label>
                <select id="wf-${id}-network" class="select" data-field="network" data-wf="${id}">
                    ${option('', t('— None'), !w.network)}${nets.map((n) => option(n.id, networkLabel(n) + (Number.isInteger(n.vlan) ? ` · VLAN ${n.vlan}` : ''), w.network === n.id)).join('')}
                </select>
            </div>
            <fieldset class="span2 wifi-bands">
                <legend class="prop-lbl">Bands</legend>
                ${WIFI_BANDS.map((b) => `<label class="prop-check"><input type="checkbox" data-field="band" data-band="${b}" data-wf="${id}"${bands.includes(b) ? ' checked' : ''}><span>${escapeHtml(wifiBandName(b))}</span></label>`).join('')}
            </fieldset>
            <label class="prop-check span2"><input type="checkbox" data-field="hidden" data-wf="${id}"${w.hidden ? ' checked' : ''}><span class="prop-lbl">${escapeHtml(t('Hidden network'))}</span></label>
        </div>
    </article>`;
}

// After a Wi-Fi edit: the tab, the selected link's or device's Wi-Fi, the
// findings.
function refreshWifiViews(force) {
    renderWifiPanel(force);
    const one = soleSelected(state.selection);
    if (one && one.type === 'link') renderLinkWifi(getLink(one.id));
    else if (one && one.type === 'node' && getNode(one.id)) renderSidebarData(getNode(one.id));
    refreshSelectedNodeDiagnostics();
}

function onWifiField(e) {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    if (e.type === 'input' && el.matches('select, input[type="checkbox"]')) return;   // theirs is the change
    const w = wifiById(el.dataset.wf);
    if (!w || readOnlyRefuses()) { renderWifiPanel(true); return; }
    const key = el.dataset.field;
    if (key === 'ssid') {
        // Typed: one undo step per field edit. Its change only marks the tab
        // out of date; the rebuild waits for the focus to leave the tab.
        if (e.type === 'change') { _wifiPanelDirty = true; return; }
        const v = wifiSsidText(el.value);
        if (v) w.ssid = v; else delete w.ssid;
        saveTyping();
        renderTyped();
        return;
    }
    if (e.type !== 'change') return;
    if (key === 'security') { const v = asWifiSecurity(el.value); if (v) w.security = v; else delete w.security; }
    else if (key === 'network') { if (networkById(el.value)) w.network = el.value; else delete w.network; }
    else if (key === 'hidden') { if (el.checked) w.hidden = true; else delete w.hidden; }
    else if (key === 'band') {
        const on = [...wifiPanel().querySelectorAll(`[data-field="band"][data-wf="${CSS.escape(w.id)}"]`)].filter((x) => x.checked).map((x) => x.dataset.band);
        // A network on no band is no network: the last one stays ticked.
        if (!on.length) { el.checked = true; return; }
        const v = asWifiBands(on);
        if (v) w.bands = v; else delete w.bands;
    }
    save();
    renderCanvasOnly();
    refreshWifiViews(true);
}

async function onWifiAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.wf;
    if (act === 'edit') {
        if (_wifiEditOpen.has(id)) _wifiEditOpen.delete(id); else _wifiEditOpen.add(id);
        renderWifiPanel(true);
        if (_wifiEditOpen.has(id)) { const f = wifiPanel().querySelector(`[data-wf="${CSS.escape(id)}"][data-field="ssid"]`); if (f) f.focus(); }
        return;
    }
    if (act === 'clients') { selectWifiClients(id); return; }
    if (readOnlyRefuses()) return;
    if (act === 'preset') { addWifiPreset(id); return; }
    if (act === 'delete') await deleteWifiNetwork(id);
}

// Made, opened on its card, one undo step. -> the record.
function addWifiRecord(fields) {
    if (readOnlyRefuses()) return null;
    const w = makeWifi(fields);
    batch(() => { state.wifi = (state.wifi || []).concat(w); save(); renderCanvasOnly(); });
    return w;
}
// One of the usual three, on the subnet its name suggests: a declared subnet
// named or described for it, else, for the staff network only, the one
// subnet there is when there is one (where everyone already is). A guest or
// IoT network is never put on the main LAN by guesswork.
function addWifiPreset(key) {
    const p = WIFI_PRESETS[key];
    if (!p) return null;
    const nets = state.networks || [];
    const named = nets.find((n) => p.hint.test(`${n.name || ''} ${n.purpose || ''}`));
    const net = named || (key === 'staff' && nets.length === 1 ? nets[0] : null);
    const w = addWifiRecord({ ssid: p.ssid, security: p.security, bands: p.bands, network: net ? net.id : undefined });
    if (w) refreshWifiViews(true);
    return w;
}
// + Wi-Fi network: its SSID asked, the rest left to the card (and to the
// defaults: every band, no subnet, not hidden). -> the record, or null.
async function addWifiNetwork(opts = {}) {
    if (readOnlyRefuses()) return null;
    const text = await askPrompt(t('The new Wi-Fi network\'s SSID, as the access points broadcast it:'), { title: t('Add a Wi-Fi network'), ok: t('Add') });
    if (text === null) return null;
    const ssid = wifiSsidText(text);
    if (!ssid) { showToast(t('A new Wi-Fi network needs its SSID.')); return null; }
    const w = addWifiRecord({ ssid });
    if (!w) return null;
    if (opts.open !== false) _wifiEditOpen.add(w.id);
    refreshWifiViews(true);
    return w;
}

// Its clients stay on the map: their links just stop naming it (the default
// answers again), as do the APs' lists of what they broadcast. One step.
async function deleteWifiNetwork(id) {
    const w = wifiById(id);
    if (!w) return false;
    const n = wifiClientLinks(id).filter((l) => linkWifiOf(l, 'ssid') === id).length;
    const ok = await askConfirm(t(n === 0 ? 'Delete the Wi-Fi network {ssid}?' : n === 1
        ? 'Delete the Wi-Fi network {ssid}? The one device set to it stays on the map, and its SSID goes back to automatic.'
        : 'Delete the Wi-Fi network {ssid}? The {n} devices set to it stay on the map, and their SSID goes back to automatic.', { ssid: wifiLabel(w), n }),
        { title: t('Delete Wi-Fi network'), ok: t('Delete'), danger: true });
    if (!ok || !wifiById(id)) return false;
    batch(() => {
        state.wifi = state.wifi.filter((x) => x.id !== id);
        normalizeWifiRefs();
        _wifiEditOpen.delete(id);
        save(); renderCanvasOnly();
    });
    refreshWifiViews(true);
    return true;
}

// Every client on it selected and brought into view; the tab stays open.
// -> their ids.
function selectWifiClients(id) {
    const nodes = withLookupPass(() => wifiClients(id));
    if (!nodes.length) return [];
    selectEntries(nodes.map((n) => ({ type: 'node', id: n.id })));
    centreOnNodes(nodes);
    return nodes.map((n) => n.id);
}

// ============================================================================
// The link panel
// ============================================================================
// Only on a wireless link, and only in the full editor (the block is
// data-adv). The SSID and the band are what the link says, else what is
// inferred, which the first entry of each select names: picking that entry
// takes the link back to automatic.
// The Add entry's value: not an id Topo mints (wf_…), and should a file have
// given a network this one, the change handler picks that network instead.
const WIFI_ADD = '+add';
function linkWifiChoices(link) {
    const e = wifiLinkEnds(link);
    if (!e) return null;
    const apRadio = e.ap ? radioOf(e.ap.iface) : null;
    const bare = Object.assign({}, link, { wifi: undefined });
    const own = linkWifiOf(link, 'ssid'), ownBand = linkWifiOf(link, 'band');
    // The AP's SSIDs (every one when there is no AP: two clients, a bridge).
    const ssids = e.ap ? apSsids(apRadio) : (state.wifi || []).map((w) => w.id);
    if (own && wifiById(own) && !ssids.includes(own)) ssids.push(own);
    // The bands both ends have, low to high; all of them when neither says.
    const sides = e.ends.map((end) => radioBands(radioOf(end.iface))).filter(Boolean);
    let bands = WIFI_BANDS.filter((b) => sides.every((s) => s.includes(b)));
    if (ownBand && !bands.includes(ownBand)) bands = WIFI_BANDS.filter((b) => bands.includes(b) || b === ownBand);
    return { e, ssids, bands, autoSsid: linkWifiSsid(bare), autoBand: linkWifiBand(Object.assign({}, bare, own ? { wifi: { ssid: own } } : {})) };
}

function renderLinkWifi(link) {
    const box = wifiEl('linkWifiProps');
    if (!box) return;
    const c = link && !isReduced() ? withLookupPass(() => linkWifiChoices(link)) : null;
    box.classList.toggle('hidden', !c);
    if (!c) return;
    const option = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const own = linkWifiOf(link, 'ssid'), ownBand = linkWifiOf(link, 'band'), signal = linkWifiOf(link, 'signal');
    const auto = (what) => (what ? `${t('Auto')} · ${what}` : '—');
    const ssid = wifiEl('propWifiSsid');
    ssid.innerHTML = option('', auto(c.autoSsid ? wifiLabel(wifiById(c.autoSsid)) : ''), !own)
        + c.ssids.map((id) => option(id, wifiLabel(wifiById(id)), own === id)).join('')
        + option(WIFI_ADD, t('Add a Wi-Fi network…'), false);
    const band = wifiEl('propWifiBand');
    band.innerHTML = option('', auto(c.autoBand ? wifiBandName(c.autoBand) : ''), !ownBand)
        + c.bands.map((b) => option(b, wifiBandName(b), ownBand === b)).join('');
    const sig = wifiEl('propWifiSignal');
    if (document.activeElement !== sig) sig.value = signal === undefined ? '' : String(signal);
    sig.classList.remove('bad');
    const disabled = !!state.readOnly;
    [ssid, band, sig].forEach((x) => { x.disabled = disabled; });
    renderLinkApLine(link, c);
}

// "AP-1 · 5 GHz · ch 36 · 80 MHz", read-only, with the way to change it: the
// AP's radio block, opened. Only once the band is known and there is an AP.
function renderLinkApLine(link, c) {
    const line = wifiEl('wifiApLine');
    const bandKey = linkWifiBand(link);
    const ap = c.e.ap;
    if (!ap || !bandKey || !ap.iface) { line.classList.add('hidden'); line.innerHTML = ''; return; }
    const entry = radioBand(radioOf(ap.iface), bandKey) || {};
    const parts = [ap.node.name || ap.node.id, wifiBandName(bandKey),
        entry.channel !== undefined ? `ch ${entry.channel}` : `ch ${t('Auto').toLowerCase()}`,
        entry.width ? `${entry.width} MHz` : ''].filter(Boolean);
    line.classList.remove('hidden');
    line.innerHTML = `<span class="mono">${escapeHtml(parts.join(' · '))}</span>
        <button type="button" class="link-btn" data-node="${escapeHtml(ap.node.id)}" data-iface="${escapeHtml(ap.iface.id)}" data-band="${escapeHtml(bandKey)}">${escapeHtml(t('Edit radio'))}</button>`;
}

// The AP's device editor with its radio block open, the band's channel in
// the focus.
function openRadioEditor(nodeId, ifaceId, band) {
    const node = getNode(nodeId);
    if (!node) return;
    _radioOpen.add(radioKey({ id: nodeId }, { id: ifaceId }));
    showConfigTab('config');
    focusOnMap({ type: 'node', id: nodeId });
    const box = document.querySelector(`#ifaceListContainer [data-radio="${CSS.escape(radioKey({ id: nodeId }, { id: ifaceId }))}"]`);
    if (!box) return;
    box.open = true;
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
    const f = box.querySelector(`[data-r="channel"][data-band="${CSS.escape(band || '')}"]`) || box.querySelector('select');
    if (f) f.focus({ preventScroll: true });
}

const selectedLinkForWifi = () => { const one = soleSelected(state.selection); return one && one.type === 'link' ? getLink(one.id) : null; };

function afterLinkWifi(link) {
    renderCanvasOnly();
    renderLinkWifi(link);
    renderWifiPanel();
    refreshSelectedNodeDiagnostics();
}

(function wireLinkWifi() {
    const box = wifiEl('linkWifiProps');
    if (!box) return;
    wifiEl('propWifiSsid').addEventListener('change', async (e) => {
        const link = selectedLinkForWifi();
        if (!link || readOnlyRefuses()) { if (link) renderLinkWifi(link); return; }
        if (e.target.value === WIFI_ADD && !wifiById(WIFI_ADD)) {
            renderLinkWifi(link);   // the select back on what it was while the question is open
            const text = await askPrompt(t('The new Wi-Fi network\'s SSID, as the access points broadcast it:'), { title: t('Add a Wi-Fi network'), ok: t('Add') });
            const ssid = text === null ? '' : wifiSsidText(text);
            if (text !== null && !ssid) showToast(t('A new Wi-Fi network needs its SSID.'));
            if (!ssid || !getLink(link.id)) { renderLinkWifi(link); return; }
            // The network and the link on it: one step.
            batch(() => {
                const w = makeWifi({ ssid });
                state.wifi = (state.wifi || []).concat(w);
                setLinkWifi(link, 'ssid', w.id);
                save(); renderCanvasOnly();
            });
        } else {
            setLinkWifi(link, 'ssid', e.target.value || undefined);
            save();
        }
        afterLinkWifi(link);
    });
    wifiEl('propWifiBand').addEventListener('change', (e) => {
        const link = selectedLinkForWifi();
        if (!link || readOnlyRefuses()) { if (link) renderLinkWifi(link); return; }
        setLinkWifi(link, 'band', e.target.value || undefined);
        save();
        afterLinkWifi(link);
    });
    // Typed: one undo step per field edit. 67 is read as -67, so a phone's
    // number pad, which has no minus key, still says it.
    wifiEl('propWifiSignal').addEventListener('input', (e) => {
        const link = selectedLinkForWifi();
        if (!link) return;
        const text = String(e.target.value).trim();
        const v = asWifiSignal(text);
        e.target.classList.toggle('bad', !!text && v === undefined);
        if (text && v === undefined) return;
        setLinkWifi(link, 'signal', v);
        saveTyping();
        renderTyped();
    });
    wifiEl('propWifiSignal').addEventListener('change', () => { const link = selectedLinkForWifi(); if (link) renderLinkWifi(link); });
    wifiEl('wifiApLine').addEventListener('click', (e) => {
        const b = e.target.closest('[data-node]');
        if (b) openRadioEditor(b.dataset.node, b.dataset.iface, b.dataset.band);
    });
})();

// ============================================================================
// The radio block (device editor, under a wireless interface)
// ============================================================================
// The channels each band may use, as the select offers them: 2.4 GHz 1-13
// (14 is Japan's, 802.11b only, and kept when a file says it), 5 GHz the
// valid 20 MHz channels, 6 GHz every fourth from 1.
const WIFI_CHANNELS = {
    '2.4': Array.from({ length: 13 }, (_, i) => i + 1),
    5: WIFI_5G_CHANNELS.slice(),
    6: Array.from({ length: 59 }, (_, i) => 1 + 4 * i)
};
// '|' between the two: a selector carries it (a NUL would come back as U+FFFD).
const radioKey = (node, iface) => `${node.id}|${iface.id}`;

// The bands the block offers: the standard's (all three while it is not
// said), and any the radio lists that its standard would not (a file's).
function radioOfferedBands(radio) {
    const std = radio && standardBands(radio.standard);
    const listed = radio && Array.isArray(radio.bands) ? radio.bands.map((b) => b.band) : [];
    return WIFI_BANDS.filter((b) => (std ? std.includes(b) : true) || listed.includes(b));
}

// -> the <details> element. Built as markup, its controls answered by one
// listener on the block (data-r says which control).
function radioBlock(node, iface) {
    const radio = radioOf(iface);
    const serves = radioServes(node);
    const key = radioKey(node, iface);
    const box = document.createElement('details');
    box.className = 'radio-box';
    box.dataset.radio = key;
    box.open = _radioOpen.has(key);
    const summary = radioSummary(radio, serves);
    const option = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const listed = radio && Array.isArray(radio.bands) && radio.bands.length ? radio.bands.map((b) => b.band) : null;
    // A client whose card lists no bands has its standard's: shown ticked
    // and greyed (inferred), so the common case is right with no clicks.
    const inferred = !listed ? (radioBands(radio) || []) : [];
    const offered = radioOfferedBands(radio);
    const dis = state.readOnly ? ' disabled' : '';
    const idp = `rad-${escapeHtml(node.id)}-${escapeHtml(iface.id)}`;
    const bandRow = (b) => {
        const on = listed ? listed.includes(b) : inferred.includes(b);
        const tick = `<label class="prop-check radio-tick${!listed && on ? ' inferred' : ''}"${!listed && on ? ` title="${escapeHtml(t('From the standard'))}"` : ''}>
            <input type="checkbox" data-r="band" data-band="${b}"${on ? ' checked' : ''}${dis}><span class="mono">${escapeHtml(wifiBandName(b))}</span></label>`;
        if (!serves) return tick;
        // An inferred band on a serving radio (a file's {standard:'ax'}, an
        // AP whose last band was unticked) gets its row too, both selects on
        // auto: the first pick writes the list, as a tick would.
        const entry = listed ? (listed.includes(b) ? radioBand(radio, b) : null) : (inferred.includes(b) ? {} : null);
        if (!entry) return `<div class="radio-band">${tick}</div>`;
        const chans = WIFI_CHANNELS[b].slice();
        if (entry.channel !== undefined && !chans.includes(entry.channel)) chans.push(entry.channel);
        const widths = WIFI_WIDTHS.filter((w) => wifiWidthValid(b, w, radio.standard) || entry.width === w);
        return `<div class="radio-band">${tick}
            <select class="select mono" data-r="channel" data-band="${b}" aria-label="Channel ${escapeHtml(wifiBandName(b))}" title="Channel"${dis}>
                ${option('', `ch ${t('Auto').toLowerCase()}`, entry.channel === undefined)}${chans.map((ch) => option(String(ch), `ch ${ch}${wifiChannelValid(b, ch) ? '' : ' ✕'}`, entry.channel === ch)).join('')}
            </select>
            <select class="select mono" data-r="width" data-band="${b}" aria-label="Width ${escapeHtml(wifiBandName(b))}" title="Width"${dis}>
                ${option('', t('Auto'), entry.width === undefined)}${widths.map((w) => option(String(w), `${w} MHz${wifiWidthValid(b, w, radio.standard) ? '' : ' ✕'}`, entry.width === w)).join('')}
            </select>
        </div>`;
    };
    const ssids = serves ? apSsids(radio) : [];
    const chips = serves ? ((state.wifi || []).length
        ? `<div class="chip-row radio-ssids" role="group" aria-label="SSID">${state.wifi.map((w) => `<button type="button" class="fchip" data-r="ssid" data-id="${escapeHtml(w.id)}" aria-pressed="${ssids.includes(w.id)}"${dis}>${escapeHtml(wifiLabel(w))}</button>`).join('')}</div>`
        : `<p class="rail-note radio-none">${escapeHtml(t('No Wi-Fi networks yet.'))} <button type="button" class="link-btn" data-r="add-ssid"${dis}>${escapeHtml(t('+ Wi-Fi network'))}</button></p>`) : '';
    box.innerHTML = `<summary class="radio-sum"><span class="prop-lbl">Radio</span>
            <span class="radio-sum-text${summary ? '' : ' net-muted'}">${escapeHtml(summary || t('not described'))}</span></summary>
        <div class="radio-body">
            <div class="radio-std">
                <label class="prop-lbl" for="${idp}-std">Standard</label>
                <select id="${idp}-std" class="select" data-r="standard"${dis}>
                    ${option('', '—', !(radio && radio.standard))}${WIFI_STANDARDS.map((k) => option(k, wifiStandardName(k), !!radio && radio.standard === k)).join('')}
                </select>
            </div>
            <div class="${serves ? 'radio-bands' : 'radio-bands radio-bands-row'}">${offered.map(bandRow).join('')}</div>
            ${chips}
        </div>`;
    box.addEventListener('toggle', () => { if (box.open) _radioOpen.add(key); else _radioOpen.delete(key); });
    box.addEventListener('change', (e) => onRadioControl(e, node, iface));
    box.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-r]');
        if (b) onRadioControl(e, node, iface, b);
    });
    return box;
}

// A radio written through its normalizer, so the block can only store what a
// file could: one step per change.
function writeRadio(iface, fn) {
    const r = cloneData(radioOf(iface) || {});
    r.bands = Array.isArray(r.bands) ? r.bands : [];
    fn(r);
    const next = normalizeRadio(r);
    if (next) iface.radio = next; else delete iface.radio;
}

async function onRadioControl(e, node, iface, btn) {
    const el = btn || e.target.closest('[data-r]');
    if (!el || !el.dataset.r) return;
    const what = el.dataset.r;
    if (readOnlyRefuses()) { renderSidebarData(node); return; }
    if (what === 'add-ssid') {
        const w = await addWifiNetwork({ open: false });
        if (w) renderSidebarData(getNode(node.id) || node);
        return;
    }
    const band = el.dataset.band;
    writeRadio(iface, (r) => {
        if (what === 'standard') r.standard = el.value || undefined;
        else if (what === 'band') {
            // A list that was inferred becomes the one on screen, then the
            // band clicked changes.
            if (!r.bands.length) r.bands = (radioBands(radioOf(iface)) || []).map((b) => ({ band: b }));
            if (el.checked && !r.bands.some((b) => b.band === band)) r.bands.push({ band });
            if (!el.checked) r.bands = r.bands.filter((b) => b.band !== band);
        } else if (what === 'channel' || what === 'width') {
            // A pick on an inferred row writes the inferred list first, so
            // the other bands stay on as they were shown.
            if (!r.bands.length) r.bands = (radioBands(radioOf(iface)) || []).map((b) => ({ band: b }));
            let entry = r.bands.find((b) => b.band === band);
            if (!entry) { entry = { band }; r.bands.push(entry); }
            const v = el.value === '' ? undefined : Number(el.value);
            if (v === undefined) delete entry[what]; else entry[what] = v;
        } else if (what === 'ssid') {
            toggleRadioSsid(r, el.dataset.id);
        }
    });
    save();
    renderCanvasOnly();
    // The block again (a new band's row, a width list for the new standard),
    // with the focus back on the control that was used.
    const sel = what === 'ssid' ? `[data-r="ssid"][data-id="${CSS.escape(el.dataset.id)}"]` : `[data-r="${what}"]${band ? `[data-band="${CSS.escape(band)}"]` : ''}`;
    renderSidebarData(node);
    renderNodeDiagnostics(node);
    renderWifiPanel();
    const again = document.querySelector(`#ifaceListContainer [data-radio="${CSS.escape(radioKey(node, iface))}"] ${sel}`);
    if (again) again.focus({ preventScroll: true });
}

// One SSID on or off for the whole radio. Each band then broadcasts the
// SSIDs that are on and that the network itself allows on that band; a band
// whose list ends up as the default (every SSID on it) keeps no list, so a
// network added later is broadcast without anyone ticking it.
function toggleRadioSsid(r, id) {
    const before = apSsids(r);
    const on = new Set(before.includes(id) ? before.filter((x) => x !== id) : before.concat(id));
    if (!r.bands.length) r.bands = (radioBands(r) || WIFI_BANDS).map((b) => ({ band: b }));
    r.bands.forEach((b) => {
        const fits = (state.wifi || []).filter((w) => wifiBandsOf(w).includes(b.band)).map((w) => w.id);
        const list = fits.filter((x) => on.has(x));
        if (list.length === fits.length) delete b.ssids; else b.ssids = list;
    });
}

(function wireWifiPanel() {
    const panel = wifiPanel();
    if (!panel) return;
    panel.addEventListener('input', onWifiField);
    panel.addEventListener('change', onWifiField);
    panel.addEventListener('click', onWifiAction);
    panel.addEventListener('focusout', () => setTimeout(() => { if (_wifiPanelDirty) renderWifiPanel(); }, 0));
    wifiEl('addWifiBtn').addEventListener('click', () => addWifiNetwork());
})();
