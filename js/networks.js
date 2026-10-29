// ---- The Subnets tab: the declared networks (R7) ----
// One card per network in doc.networks: its address, name and VLAN; how big it
// is, how much of it is used and the next free address; the gateway and DNS
// every member without its own inherits; who is on it. Editing a card edits
// the network, so changing a gateway here changes it for every device that
// inherits it, in one undo step. Renumber moves the whole network to another
// range (planRenumber, js/model.js). Below the cards, the subnets the drawing
// uses that nobody has declared, each one click from being a network.
//
// It is the full editor's, like the Diagnostics tab: technical vocabulary
// (CIDR, VLAN, Gateway, DNS, DHCP, Subnet zones) stays English, as the comment
// in applyProfile (js/app.js) explains; the sentences and plain verbs are
// translated (MESSAGES, js/i18n.js), the static ones in index.html too: the
// Subnet zones tooltip and the + Subnet button.
//
// One word per thing: in the full editor a declared network is a "subnet"
// everywhere (this tab, its buttons and questions, the bulk panel's Move, the
// zones, the spreadsheet's subnets sheet), and "network" is the whole
// document (New network, My networks, Keep this network). The tab's button
// and dialogs said "network" and so meant both.
//
// The panel is rebuilt from the document after anything changes, as the
// canvas is (renderCanvasOnly calls renderNetworksPanel). Two exceptions: while
// it is hidden it only notes that it is out of date, and while a field inside
// it has the focus it waits, so a rebuild cannot take the field away from the
// person typing in it. Leaving the panel catches up.
// Load order: ... ui -> dialog -> report -> library -> share -> networks -> app

let _netPanelDirty = true;
const _netEditOpen = new Set();   // networks whose edit fields are open, this session

const netPanel = () => document.getElementById('cfgPanel-networks');
const netPanelShown = () => { const p = netPanel(); return !!p && !p.classList.contains('hidden') && !isReduced(); };

function renderNetworksPanel(force) {
    const panel = netPanel();
    if (!panel) return;
    if (!netPanelShown()) { _netPanelDirty = true; return; }
    const active = document.activeElement;
    if (!force && active && panel.contains(active) && active.matches('input, select, textarea')) { _netPanelDirty = true; return; }
    _netPanelDirty = false;

    // A rebuild replaces the buttons: the one that had the focus gets it back.
    const refocus = active && panel.contains(active) && active.dataset && active.dataset.act
        ? `[data-act="${active.dataset.act}"][data-net="${active.dataset.net || ''}"]` : null;

    const zones = document.getElementById('subnetZonesToggle');
    zones.checked = state.settings.subnetZones !== false;

    const list = document.getElementById('networkList');
    const nets = state.networks.slice().sort((a, b) => compareCidr(a.cidr, b.cidr));
    // One lookup pass for the whole tab: every card asks who is on it.
    list.innerHTML = nets.length ? withLookupPass(() => nets.map(networkCardHtml).join(''))
        : `<p class="rail-note">${escapeHtml(t('No subnets declared yet. Give a device an address, or add one with + Subnet.'))}</p>`;

    const undeclared = undeclaredSubnets();
    const box = document.getElementById('undeclaredBox');
    box.classList.toggle('hidden', !undeclared.length);
    box.innerHTML = undeclared.length ? `
        <div class="prop-headrow">
            <h3 class="rail-sub">${escapeHtml(t('In use, not declared'))}</h3>
            ${undeclared.length > 1 ? `<button type="button" class="link-btn" data-act="declare-all" data-net="">${escapeHtml(t('Declare all'))}</button>` : ''}
        </div>
        <p class="rail-note">${escapeHtml(t('Declare one to give it a name, a gateway its devices inherit, and a zone.'))}</p>
        ${undeclared.map((u) => `<div class="net-undecl-row">
            <span class="mono">${escapeHtml(u.cidr)}</span>
            <span class="net-muted">${escapeHtml(t(u.nodeIds.length === 1 ? '{n} device' : '{n} devices', { n: u.nodeIds.length }))}</span>
            <button type="button" class="link-btn" data-act="declare" data-net="${escapeHtml(u.cidr)}">${escapeHtml(t('Declare'))}</button>
        </div>`).join('')}` : '';

    if (refocus) { const again = panel.querySelector(refocus); if (again) again.focus(); }
}

// Numeric order, IPv4 before IPv6: 10.0.2.0 before 10.0.10.0.
function compareCidr(a, b) {
    const pa = parseValidCIDR(a), pb = parseValidCIDR(b);
    if (!pa || !pb) return String(a).localeCompare(String(b));
    if (pa.kind !== pb.kind) return pa.kind === 'ipv4' ? -1 : 1;
    const x = netBase(pa), y = netBase(pb);
    return x < y ? -1 : x > y ? 1 : pa.prefix - pb.prefix;
}

function networkCardHtml(net) {
    const st = networkStats(net);
    const id = escapeHtml(net.id);
    const open = _netEditOpen.has(net.id);
    const name = isBlank(net.name) ? '' : net.name.trim();
    const use = st.size !== null
        ? t('{used} of {size} used · {free} free', { used: st.used, size: st.size, free: st.free })
        : t('{used} used · 2^{bits} addresses', { used: st.used, bits: st.bits });
    const next = st.next ? t('next free {ip}', { ip: st.next }) : t('no free address');
    const svc = [
        !isBlank(net.gateway) ? `gw ${escapeHtml(net.gateway.trim())}` : `<span class="net-muted">${escapeHtml(t('no gateway'))}</span>`,
        !isBlank(net.dns) ? `DNS ${escapeHtml(net.dns.trim())}` : '',
        net.dhcp ? 'DHCP' : ''
    ].filter(Boolean).join(' · ');
    const names = st.members.map((m) => m.node.name || m.node.id);
    const shown = names.length > 6 ? t('{names} and {n} more', { names: names.slice(0, 6).join(', '), n: names.length - 6 }) : names.join(', ');
    const field = (key, label, attrs = '') => `<div class="${key === 'dns' || key === 'purpose' ? 'span2' : ''}">
            <label class="prop-lbl" for="net-${id}-${key}">${escapeHtml(label)}</label>
            <input id="net-${id}-${key}" type="text" class="input${key === 'gateway' || key === 'dns' || key === 'vlan' ? ' mono' : ''}${fieldBad(net, key) ? ' bad' : ''}"
                data-field="${key}" data-net="${id}" value="${escapeHtml(net[key] === undefined ? '' : String(net[key]))}" ${attrs} autocomplete="off" spellcheck="false">
        </div>`;
    const zone = net.drawZone === true ? 'on' : net.drawZone === false ? 'off' : 'auto';
    return `<article class="net-card" data-net="${id}">
        <div class="net-head">
            <span class="net-cidr mono">${escapeHtml(net.cidr)}</span>
            ${Number.isInteger(net.vlan) ? `<span class="chip-tag">VLAN ${net.vlan}</span>` : ''}
        </div>
        ${name || !isBlank(net.purpose) ? `<div class="net-name">${escapeHtml(name)}${!isBlank(net.purpose) ? ` <span class="net-muted">· ${escapeHtml(net.purpose.trim())}</span>` : ''}</div>` : ''}
        <div class="net-line mono">${escapeHtml(use)} · ${escapeHtml(next)}</div>
        <div class="net-line mono">${svc}</div>
        <div class="net-line net-members">${names.length ? escapeHtml(shown) : `<span class="net-muted">${escapeHtml(t('Nobody on it yet.'))}</span>`}</div>
        <div class="net-actions">
            <button type="button" class="link-btn" data-act="members" data-net="${id}" ${names.length ? '' : 'disabled'}
                title="${escapeHtml(t('Select every device on this subnet and show them on the map'))}">${escapeHtml(t('Select members'))}</button>
            <button type="button" class="link-btn" data-act="edit" data-net="${id}" aria-expanded="${open}">${escapeHtml(t(open ? 'Close' : 'Edit'))}</button>
            <button type="button" class="link-btn" data-act="renumber" data-net="${id}">${escapeHtml(t('Renumber…'))}</button>
            <button type="button" class="link-btn quiet" data-act="delete" data-net="${id}">${escapeHtml(t('Delete'))}</button>
        </div>
        <div class="net-edit prop-grid"${open ? '' : ' hidden'}>
            ${field('name', t('Name'))}
            ${field('vlan', 'VLAN', 'inputmode="numeric" placeholder="1–4094"')}
            ${field('purpose', t('Purpose'))}
            ${field('gateway', 'Gateway')}
            <div>
                <label class="prop-lbl" for="net-${id}-zone">Zone</label>
                <select id="net-${id}-zone" class="select" data-field="drawZone" data-net="${id}">
                    <option value="auto"${zone === 'auto' ? ' selected' : ''}>${escapeHtml(t('Auto'))}</option>
                    <option value="on"${zone === 'on' ? ' selected' : ''}>${escapeHtml(t('Always'))}</option>
                    <option value="off"${zone === 'off' ? ' selected' : ''}>${escapeHtml(t('Never'))}</option>
                </select>
            </div>
            ${field('dns', 'DNS', 'placeholder="10.0.0.53, 10.0.0.54"')}
            <label class="prop-check span2"><input type="checkbox" data-field="dhcp" data-net="${id}"${net.dhcp ? ' checked' : ''}><span class="prop-lbl">DHCP</span></label>
            ${gatewayAdvice(net, st)}
        </div>
    </article>`;
}

// The schema row's own validator (NETWORK_FIELDS), so the tab and a future
// CSV import agree on what is acceptable.
function fieldBad(net, key) {
    const row = NETWORK_FIELDS.find((f) => f.key === key);
    const v = net[key];
    return !!(row && row.validate && v !== undefined && !row.validate(v));
}

// A gateway outside its own network is unreachable for every member that
// inherits it; said here, where it is typed, as well as on each device.
function gatewayAdvice(net, st) {
    const gw = parseIpText(net.gateway);
    if (!gw || !st.parsed || ipInParsed(gw, st.parsed)) return '';
    return `<p class="rail-note span2 net-warn">${escapeHtml(t('{gw} is outside {cidr}, so no member can reach it.', { gw: gw.toString(), cidr: net.cidr }))}</p>`;
}

// ---- Editing a network ----
// Typing is one undo step per field, as on a device (saveTyping); the
// checkbox and the zone are one step each. Every member's diagnostics, the
// selected device's hints and the zones follow at once.
function onNetworkField(e) {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    // A checkbox and a select fire both events; theirs is the change.
    if (e.type === 'input' && el.matches('input[type="checkbox"], select')) return;
    const net = networkById(el.dataset.net);
    if (!net || readOnlyRefuses()) return;
    const key = el.dataset.field;
    if (key === 'dhcp') net.dhcp = el.checked ? true : undefined;
    else if (key === 'drawZone') net.drawZone = el.value === 'on' ? true : el.value === 'off' ? false : undefined;
    else if (key === 'vlan') {
        net.vlan = isBlank(el.value) ? undefined : (asVlan(el.value) !== undefined ? asVlan(el.value) : el.value);
        el.classList.toggle('bad', fieldBad(net, 'vlan'));
    } else {
        net[key] = el.value;
        el.classList.toggle('bad', fieldBad(net, key));
    }
    if (e.type === 'input') saveTyping(); else save();
    renderCanvasOnly();
    refreshSelectedNodeDiagnostics();
    const sel = state.selectedType === 'node' && getNode(state.selectedId);
    if (sel) refreshInheritance(sel);
}

// The VLAN field holds whatever is typed while it is typed (so "4" on the
// way to "40" is not thrown away); what does not read as a VLAN is dropped
// when the field is left, rather than written into the document.
function onNetworkFieldDone(e) {
    const el = e.target.closest('[data-field="vlan"]');
    if (!el) return;
    const net = networkById(el.dataset.net);
    if (net && net.vlan !== undefined && !Number.isInteger(net.vlan)) { net.vlan = undefined; save(); }
}

async function onNetworkAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.net;
    if (act === 'edit') {
        if (_netEditOpen.has(id)) _netEditOpen.delete(id); else _netEditOpen.add(id);
        renderNetworksPanel(true);
        if (_netEditOpen.has(id)) { const f = netPanel().querySelector(`[data-net="${id}"][data-field="name"]`); if (f) f.focus(); }
        return;
    }
    if (act === 'members') { selectNetworkMembers(id); return; }
    if (readOnlyRefuses()) return;
    if (act === 'declare') { declareAndShow([id]); return; }
    if (act === 'declare-all') { declareAndShow(undeclaredSubnets().map((u) => u.cidr)); return; }
    if (act === 'renumber') { await renumberNetwork(id); return; }
    if (act === 'delete') { await deleteNetwork(id); }
}

// Declared, in one undo step however many.
function declareAndShow(cidrs) {
    let last = null;
    batch(() => { cidrs.forEach((c) => { last = declareSubnet(c) || last; }); save(); renderCanvasOnly(); });
    if (cidrs.length === 1 && last) _netEditOpen.add(last.id);
    refreshSelectedNodeDiagnostics();
    renderNetworksPanel(true);
}

async function addNetwork() {
    if (readOnlyRefuses()) return;
    const text = await askPrompt(t('The subnet\'s address and prefix, like 10.0.9.0/24.'), { title: t('Add a subnet'), ok: t('Add') });
    if (text === null) return;
    const cidr = canonicalCidr(text);
    if (!cidr) { showToast(t('{cidr} is not a subnet with a prefix, like 10.0.9.0/24.', { cidr: text.trim() || '—' })); return; }
    if (state.networks.some((n) => n.cidr === cidr)) { showToast(t('{cidr} is already declared.', { cidr })); return; }
    declareAndShow([cidr]);
}

// Its members keep the gateway and DNS they use: what they inherited is
// written onto each of them, so taking the declaration away changes no
// device's configuration. Undo puts the network back.
async function deleteNetwork(id) {
    const net = networkById(id);
    if (!net) return;
    const members = networkMembers(net);
    const n = members.length;
    const ok = await askConfirm(t(n === 0 ? 'Delete the subnet {cidr}? No device is on it.'
        : n === 1 ? 'Delete the subnet {cidr}? Its one device keeps its address, and the gateway and DNS it uses now are written onto it.'
        : 'Delete the subnet {cidr}? Its {n} devices keep their addresses, and the gateway and DNS they use now are written onto each of them.', { cidr: net.cidr, n }),
        { ok: t('Delete'), danger: true });
    if (!ok || !networkById(id)) return;
    batch(() => {
        members.forEach(({ node }) => {
            const gw = gatewaySource(node), dns = dnsSource(node);
            if (gw.network === net) node.gw = gw.value;
            if (dns.network === net) node.dns = dns.value;
        });
        state.networks = state.networks.filter((n) => n !== net);
        // A Wi-Fi network on it is left on no subnet, as a reload would.
        normalizeWifiRefs();
        _netEditOpen.delete(id);
        save(); renderCanvasOnly();
    });
    refreshSelectedNodeDiagnostics();
    renderNetworksPanel(true);
}

// What the checks would find once the plan is applied, against what they find
// now: the plan written into a scratch copy (the same objects, found by their
// place in the lists) and diagnosed there, the way the bulk panel previews a
// change (js/bulk.js). Nothing on screen is touched.
function renumberFindingsDelta(plan) {
    if (plan.errors.length) return [];
    const scratch = cloneData({ nodes: state.nodes, links: state.links, networks: state.networks });
    const nodeAt = (node) => scratch.nodes[state.nodes.indexOf(node)];
    plan.ifaces.forEach((c) => {
        const n = nodeAt(c.node);
        const i = n && n.interfaces[(c.node.interfaces || []).indexOf(c.iface)];
        if (i) i.ip = c.ip;
    });
    plan.refs.forEach((r) => {
        const ni = state.nodes.indexOf(r.obj), wi = state.networks.indexOf(r.obj);
        const target = ni > -1 ? scratch.nodes[ni] : wi > -1 ? scratch.networks[wi] : null;
        if (target) target[r.key] = r.value;
    });
    const net = scratch.networks[state.networks.indexOf(plan.net)];
    if (net) net.cidr = plan.to.networkStr;
    return findingsDelta(topologyFindings(), diagnoseDoc(scratch).findings);
}

// One transaction: every member address, every reference into the old range
// and the network itself, in one batch and one undo step. Planned twice, once
// to ask and once to apply, because the question is answered asynchronously
// and the plan holds the objects it will change. The question says what the
// findings would become, as every bulk change's preview does.
async function renumberNetwork(id) {
    const net = networkById(id);
    if (!net) return;
    const text = await askPrompt(t('Move {cidr} to which range? Every device keeps its host part.', { cidr: net.cidr }),
        { title: t('Renumber subnet'), value: net.cidr, ok: t('Next') });
    if (text === null) return;
    const first = planRenumber(id, text);
    if (first.errors.length) {
        await tell([t('{cidr} was not renumbered:', { cidr: net.cidr }), ...first.errors.slice(0, 8).map((x) => `• ${x}`)].join('\n'),
            { title: t('Renumber subnet') });
        return;
    }
    const ok = await askConfirm(`${t('Renumber {from} to {to}?\nAddresses moved: {n}\nGateway and DNS entries rewritten: {m}\nOne step, which Undo takes back.',
        { from: first.from.networkStr, to: first.to.networkStr, n: first.ifaces.length, m: first.refs.length })}\n\n${findingsDeltaText(renumberFindingsDelta(first))}`,
        { title: t('Renumber subnet'), ok: t('Renumber') });
    if (!ok) return;
    const plan = planRenumber(id, text);
    if (plan.errors.length) { showToast(plan.errors[0]); return; }
    batch(() => {
        plan.ifaces.forEach((c) => { c.iface.ip = c.ip; });
        plan.refs.forEach((r) => { r.obj[r.key] = r.value; });
        plan.net.cidr = plan.to.networkStr;
        save(); renderCanvasOnly();
    });
    refreshSelectedNodeDiagnostics();
    if (state.selectedType === 'node' && getNode(state.selectedId)) select(state.selectedId, 'node');
    renderNetworksPanel(true);
    showToast(t('Renumbered to {cidr}.', { cidr: plan.to.networkStr }), 'ok');
}

// ---- Select members ----
// Every device on the network, selected at once (the selection set, js/state.js)
// and brought into view; the rail's Configuration tab then shows their count
// and Delete. The Subnets tab stays open: the visitor is working there.
// Returns the member ids.
function selectNetworkMembers(id) {
    const net = networkById(id);
    if (!net) return [];
    const members = networkMembers(net).map((m) => m.node);
    if (!members.length) return [];
    selectEntries(members.map((n) => ({ type: 'node', id: n.id })));
    centreOnNodes(members);
    return members.map((n) => n.id);
}

// From a device's "Blank fields use the network's:" line: this network's
// card, open, in the Subnets tab.
function openNetworkInTab(id) {
    if (!networkById(id)) return;
    _netEditOpen.add(id);
    showConfigTab('networks');
    renderNetworksPanel(true);
    const card = netPanel().querySelector(`.net-card[data-net="${id}"]`);
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
}

(function wireNetworksPanel() {
    const panel = netPanel();
    if (!panel) return;
    panel.addEventListener('input', onNetworkField);
    panel.addEventListener('change', (e) => {
        if (e.target.id === 'subnetZonesToggle') {
            state.settings.subnetZones = e.target.checked;
            saveSettings(); renderCanvasOnly();
            return;
        }
        if (e.target.matches('input[type="checkbox"][data-field], select[data-field]')) onNetworkField(e);
        else onNetworkFieldDone(e);
    });
    panel.addEventListener('click', onNetworkAction);
    // Catch up once the focus has left the panel's fields.
    panel.addEventListener('focusout', () => setTimeout(() => { if (_netPanelDirty) renderNetworksPanel(); }, 0));
    document.getElementById('addNetworkBtn').addEventListener('click', addNetwork);
})();
