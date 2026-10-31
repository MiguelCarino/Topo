// Adding many things at once: the Add devices dialog and blocks (plan R8).
//
// ---- Add devices ----
// One dialog for every way of adding devices by the dozen. It replaced the
// count wizard, which could only start a new network around one router,
// capped every kind at 9, hung everything (switches too) off that router as
// leaves, and forced the simple view on whoever used it. Now:
//
//   kinds × counts  a tile per kind of device, its count typed or stepped,
//                   up to ADD_MAX of each.
//   name pattern    'Phone-{n:02}' (the bulk panel's Rename tokens, plus
//                   {type}). Numbering carries on after the names already on
//                   the map, so a second batch of phones does not repeat the
//                   first one's names. Left blank, a kind's devices are
//                   called "<kind> 1", "<kind> 2"… and a lone one just
//                   "<kind>".
//   connect to      the selected switch or AP (or router, firewall…), else
//                   the first one on the map, else nothing. New devices take
//                   its next free ports in order (freePorts, js/model.js) and
//                   the next free addresses of its network (freeAddresses):
//                   the network's gateway and DNS then reach them by
//                   inheritance, nothing is copied onto each device. Onto
//                   an access point the devices that join it by radio join
//                   one of its Wi-Fi networks: its only one, else the one
//                   picked (by default the first that is not a guest
//                   network; the pick is shown only when there is a choice),
//                   and take their addresses from that network's subnet
//                   when it has one, so the Guest SSID's phones land on the
//                   guest subnet. A seed
//                   address nobody gave is not kept (spawnNode's rule for
//                   gateway, DNS and OS): a device with nowhere to take an
//                   address from has none.
//
// Two modes. 'add' puts the devices into the open network. 'new' is the old
// wizard's intake: a new network (kept, like New network) with a router in
// the middle; the switches, APs and other gear hang off the router, and the
// hosts off the first new switch when there is one. The landing's "Add
// devices", the mode picker's Setup wizard and the '#setup' entries open it;
// '#setup' keeps the advanced options folded away and, alone, lands the built
// network in the simple view (simpleAfter). Everything runs in one batch():
// one undo step, one save, one redraw, however many devices.
//
// Plain words and sentences are translated (MESSAGES, js/i18n.js); a summary
// line about ports and addresses is the full editor's, in its technical
// vocabulary, and a reduced view does not show it. Device names follow the
// view, as spawnNode()'s do: the localized kind in a reduced view, the
// palette's English name in Advanced.
//
// ---- Blocks: saved selections ----
// A block is a piece of a network kept to be inserted again: a document
// fragment of devices (placed around 0,0), the cables between them and the
// networks they sit on. The shipped ones are BUILTIN_BLOCKS (js/data.js); a
// user's own come from "Save the selection as a block" and are library cards
// flagged `template` and `block` (js/library.js), so they travel in the back-up
// and the binder like a saved template, and are never counted as a site.
// Inserting one re-addresses it into the next free network: each subnet it
// brings that overlaps one already on the map moves up to the next free one
// of the same size, every address in it (interfaces, gateways, DNS, the
// network's own) shifted by the same amount. Stamping a block used to bring
// its fixed 10.80/10.90 addresses every time, so the second copy was an IP
// conflict on every device.
//
// Load order: ... bulk -> add -> csv -> app

// ---- The kinds of device ----
// Most likely first, technical gear further down. `name` is what a device of
// the kind is called in a reduced view (localized), `label` the tile's.
// The router is the hub of a new network, so it is offered only when adding.
const ADD_HUB = { type: 'router', name: 'Router' };
const ADD_KINDS = [
    { type: 'pc', name: 'Computer', label: 'Computers / laptops', count: 2 },
    { type: 'iot', name: 'Smart Device', label: 'Smart TVs & devices', count: 2 },
    { type: 'printer', name: 'Printer', label: 'Printers', count: 1 },
    { type: 'camera', name: 'Camera', label: 'Cameras', count: 0 },
    { type: 'ap', name: 'Wireless AP', label: 'Wi-Fi points', count: 0 },
    { type: 'switch', name: 'Switch', label: 'Switches', count: 0 },
    { type: 'server', name: 'Server', label: 'Servers / NAS', count: 0 },
    { type: 'voip', name: 'VoIP Phone', label: 'Desk phones', count: 0 },
    { type: 'dicom', name: 'Modality', label: 'Modalities (CT, MR, US…)', count: 0 },
    { type: 'firewall', name: 'Firewall', label: 'Firewalls', count: 0 },
    { type: 'vpn', name: 'VPN Gateway', label: 'VPN gateways', count: 0 },
    { type: 'l3switch', name: 'L3 Switch', label: 'L3 switches', count: 0 },
    { type: 'loadbalancer', name: 'Load Balancer', label: 'Load balancers', count: 0 },
    { type: 'edge', name: 'Edge Gateway', label: 'Edge gateways', count: 0 },
    { type: 'vm', name: 'VM', label: 'Virtual machines', count: 0 },
    { type: 'container', name: 'Container', label: 'Containers', count: 0 },
    { type: 'cloud', name: 'Cloud', label: 'Internet / cloud links', count: 0 },
    { type: 'custom', name: 'Device', label: 'Other devices', count: 0 },
    { type: 'router', name: 'Router', label: 'Routers', count: 0, addOnly: true }
];
const ADD_MAX = 999;
// What new devices can be connected to: the gear other devices plug into.
const ATTACH_TYPES = ['switch', 'ap', 'l3switch', 'router', 'firewall', 'edge', 'vpn', 'loadbalancer'];
const canAttachTo = (n) => !!n && ATTACH_TYPES.includes(n.type);
// In a new network these hang off the router; everything else is a host and
// goes on the first new switch, so a switch is never a leaf with nothing on it.
const ADD_INFRA = new Set(['switch', 'ap', 'l3switch', 'router', 'firewall', 'edge', 'vpn', 'loadbalancer', 'cloud']);
// Layer-2 gear: a switch or an AP gets no address of its own (bulk Move's rule).
const staysL2 = (type) => type === 'switch' || type === 'ap' || type === 'cloud';

const clampCount = (v) => Math.max(0, Math.min(ADD_MAX, Math.floor(Number(v)) || 0));
const addKindsFor = (mode) => ADD_KINDS.filter((k) => mode === 'add' || !k.addOnly);
const addEl = (id) => document.getElementById(id);

function kindName(type) {
    if (isReduced()) {
        const k = type === ADD_HUB.type ? ADD_HUB : ADD_KINDS.find((x) => x.type === type);
        return t(k ? k.name : 'Device');
    }
    const p = paletteDefs.find((x) => x.type === type);
    return p ? p.name : 'Device';
}

// ---- Names ----
const nameKey = (s) => String(s || '').trim().toLowerCase();
// `count` names from `pattern` for one kind, none of them already in `taken`
// when the pattern counts: the run starts at the first number that fits
// whole, so Phone-01…12 on the map makes the next five Phone-13…17.
function nameRun(pattern, kind, count, taken, plain) {
    const pat = String(pattern).split('{type}').join(kind);
    if (plain && count === 1 && !taken.has(nameKey(kind))) return [kind];
    const make = (n) => expandPattern(pat, n, kind).trim() || kind;
    if (!usesCount(pat)) return Array.from({ length: count }, () => make(0));
    let start = 1;
    for (let guard = 0; guard <= taken.size + 1; guard++) {
        let clash = -1;
        for (let i = 0; i < count; i++) if (taken.has(nameKey(make(start + i)))) { clash = i; break; }
        if (clash < 0) break;
        start += clash + 1;
    }
    return Array.from({ length: count }, (_, i) => make(start + i));
}

// The node new devices would hang off when nothing else is said: the
// selected device when it is one they can, else the first switch, AP, L3
// switch or router on the map.
function defaultAddTarget() {
    const sel = state.selectedType === 'node' ? getNode(state.selectedId) : null;
    if (canAttachTo(sel)) return sel;
    for (const type of ['switch', 'ap', 'l3switch', 'router', 'firewall']) {
        const n = state.nodes.find((x) => x.type === type);
        if (n) return n;
    }
    return null;
}

// The network new devices on `target` join: subnetContext()'s answer (the
// target's own address, else a neighbour's), else the first one found across
// its layer-2 domain. An AP behind a switch behind the router has no
// addressed neighbour of its own, and is still on the router's LAN.
function addContext(target) {
    const own = subnetContext(target);
    if (own || !isDumbDevice(target)) return own;
    for (const id of l2DomainOf(target.id)) {
        const n = getNode(id);
        const ctx = n && n !== target && isDumbDevice(n) ? subnetContext(n) : null;
        if (ctx) return ctx;
    }
    return null;
}

// ---- Joining an access point's Wi-Fi ----
// The SSIDs a target broadcasts, in the document's order (none for a device
// with no radio, or a network with no Wi-Fi networks yet).
function addTargetSsids(target) {
    if (!target || !radioServes(target)) return [];
    const on = new Set();
    (target.interfaces || []).forEach((i) => { if (ifaceIsWireless(i)) apSsids(radioOf(i)).forEach((id) => on.add(id)); });
    return (state.wifi || []).filter((w) => on.has(w.id)).map((w) => w.id);
}
// The one new devices join unless somebody picks: the only one, else the
// first that is not a guest network (a guest network is chosen, never
// fallen into), else the first.
function addDefaultSsid(target) {
    const ids = addTargetSsids(target);
    return ids.find((id) => !wifiIsGuest(wifiById(id))) || ids[0] || null;
}

// ---- The plan (pure: reads the map, writes nothing) ----
// req: { items: [{ type, count }], pattern, targetId, targetIface, taken, ssid }
//   ssid         the Wi-Fi network the devices joining by radio join (an id
//                the target broadcasts); left out, addDefaultSsid's
//   targetIface  the target's interface every cable lands on, when the
//                target has no faceplate (the new network's router: its LAN)
//   taken        the names already used, when they are not the map's (the
//                new network's summary, before the map is replaced)
// -> { target, devices: [{ type, name, port, ip, wireless }], total, cidr,
//      prefix, network, portsPast, noAddress, sameNames, sharedRun, ssid,
//      wifiCidr, wifiNetwork }
function planAddDevices(req) {
    const target = req.targetId ? getNode(req.targetId) : null;
    const items = (req.items || []).map((i) => ({ type: i.type, count: clampCount(i.count) })).filter((i) => i.count > 0);
    const pattern = String(req.pattern || '').trim();
    const taken = new Set((req.taken || state.nodes.map((n) => n.name)).map(nameKey));
    const devices = [];
    let sameNames = false;
    items.forEach(({ type, count }) => {
        const names = nameRun(pattern || '{type} {n}', kindName(type), count, taken, !pattern);
        if (count > 1 && new Set(names.map(nameKey)).size < names.length) sameNames = true;
        names.forEach((name) => { taken.add(nameKey(name)); devices.push({ type, name, port: null, ip: '', wireless: false }); });
    });
    // A pattern that counts but does not say {type} numbers every kind in
    // one run ('PC-{n:02}' with three switches and twenty PCs: PC-01…03 are
    // the switches). Sometimes meant, so not refused; said in the summary.
    const sharedRun = items.length > 1 && !!pattern && !pattern.includes('{type}') && usesCount(pattern);
    const plan = { target, devices, total: devices.length, cidr: null, prefix: null, network: null, portsPast: 0, noAddress: 0, sameNames, sharedRun,
        ssid: null, wifiCidr: null, wifiNetwork: null };
    if (!target || !devices.length) return plan;

    // By radio onto an AP, by cable onto anything else (apMediumGuess: an AP
    // takes a switch, a router or another AP by cable or mesh as it says).
    devices.forEach((d) => { d.wireless = apMediumGuess(target, { type: d.type }) === 'wireless'; });
    if (hasPortGrid(target)) {
        const wired = devices.filter((d) => !d.wireless);
        const ports = freePorts(target, wired.length);
        wired.forEach((d, i) => { d.port = ports.ids[i]; });
        plan.portsPast = ports.past;
    }

    // The Wi-Fi network the radio ones join, and the subnet it puts them on.
    const ssids = devices.some((d) => d.wireless) ? addTargetSsids(target) : [];
    if (ssids.length) {
        plan.ssid = ssids.includes(req.ssid) ? req.ssid : addDefaultSsid(target);
        const w = wifiById(plan.ssid);
        const wnet = w && w.network ? networkById(w.network) : null;
        const wp = wnet ? parseValidCIDR(wnet.cidr) : null;
        if (wp && wp.kind === 'ipv4' && wp.prefix < 31) Object.assign(plan, { wifiCidr: wp.networkStr, wifiPrefix: wp.prefix, wifiNetwork: wnet });
    }

    const ctx = addContext(target);
    const wants = (d) => !staysL2(d.type) && (initialDataDefaults[d.type]?.interfaces || [{}]).length;
    const onWifiNet = (d) => d.wireless && !!plan.wifiCidr;
    // The addresses handed out by cable, which the radio ones must not be
    // handed again: an SSID on the target's own LAN (or a subnet inside it)
    // draws from the same pool, and each call only knows what the map holds,
    // so the firewall and the first PC of one add came out on one address.
    const given = new Set();
    if (ctx && ctx.prefix < 31) {
        const want = devices.filter((d) => wants(d) && !onWifiNet(d));
        const ips = freeAddresses(ctx.networkStr, want.length);
        ips.forEach((ip) => given.add(ip));
        want.forEach((d, i) => { if (ips[i]) d.ip = `${ips[i]}/${ctx.prefix}`; });
        plan.noAddress = want.length - ips.length;
        Object.assign(plan, { cidr: ctx.networkStr, prefix: ctx.prefix, network: ctx.network || networkOfIp(ctx.networkStr.split('/')[0]) });
    }
    if (plan.wifiCidr) {
        const want = devices.filter((d) => wants(d) && onWifiNet(d));
        const ips = freeAddresses(plan.wifiCidr, want.length + given.size).filter((ip) => !given.has(ip)).slice(0, want.length);
        want.forEach((d, i) => { if (ips[i]) d.ip = `${ips[i]}/${plan.wifiPrefix}`; });
        plan.noAddress += want.length - ips.length;
    }
    return plan;
}

// Rows of up to ADD_ROW devices, centred under (cx, top).
const ADD_ROW = 12, ADD_COLW = 100, ADD_ROWH = 110;
function addSlots(count, cx, top) {
    return Array.from({ length: count }, (_, i) => {
        const row = Math.floor(i / ADD_ROW), inRow = Math.min(ADD_ROW, count - row * ADD_ROW);
        return { x: cx + (i % ADD_ROW - (inRow - 1) / 2) * ADD_COLW, y: top + row * ADD_ROWH };
    });
}
function viewCentre() {
    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    return { x: (rect.width / 2 - state.camera.x) / state.camera.zoom, y: (rect.height / 2 - state.camera.y) / state.camera.zoom };
}

// Writes a plan into the live document. Inside a batch (addDevices, the
// new-network build); returns the new nodes.
function addDevicesNow(req) {
    const plan = planAddDevices(req);
    if (!plan.total) return [];
    const target = plan.target;
    // A subnet nobody has declared yet is declared first (declareSubnet,
    // js/model.js), with the gateway and DNS its devices already agree on, so
    // the new devices inherit them instead of each carrying a copy.
    if (target && plan.cidr && !plan.network) declareSubnet(plan.cidr);
    // Below the target and anything already hanging under it.
    let at;
    if (target) {
        const below = linksAtNode(target.id).map((l) => getNode(l.source === target.id ? l.target : l.source))
            .filter((n) => n && n.y > target.y + 40);
        at = { x: target.x, y: Math.max(target.y + 130, ...below.map((n) => n.y + 120)) };
    } else {
        // Loose: beside what is drawn (as a block goes), or mid-view on an
        // empty map; either way, not on top of anything.
        const rows = addSlots(plan.total, 0, 0);
        at = besideTheMap(rows);
        if (!state.nodes.length) at.y -= Math.floor((plan.total - 1) / ADD_ROW) * ADD_ROWH / 2;
    }
    const slots = addSlots(plan.total, at.x, at.y);
    const added = [];
    plan.devices.forEach((d, i) => {
        const node = newNodeRecord(d.type, slots[i].x, slots[i].y);
        node.name = d.name;
        // The network hands these down; the seed values were nobody's answer.
        node.gw = ''; node.dns = '';
        node.interfaces.forEach((f, k) => { f.ip = k === 0 ? d.ip : ''; });
        if (d.wireless && node.interfaces.length && !node.interfaces.some(ifaceIsWireless)
            && WIRED_DEFAULT_RE.test(node.interfaces[0].name || '')) node.interfaces[0].name = 'wlan0';
        state.nodes.push(node);
        if (target) {
            const bridged = isVirtualType(target.type) || isVirtualType(d.type);
            // A cloud is the router's uplink, never on its LAN interface.
            const onIface = req.targetIface && d.type !== 'cloud' ? req.targetIface : null;
            const link = bindLink({ id: nextId('l'), source: target.id, target: node.id, attachment: bridged ? 'bridged' : null,
                sourceIface: d.port || onIface, targetIface: null });
            // Its Wi-Fi network said only when there was a choice: the only
            // one is what Topo works out anyway (linkWifiSsid).
            if (d.wireless && plan.ssid && addTargetSsids(target).length > 1) setLinkWifi(link, 'ssid', plan.ssid);
            state.links.push(link);
        }
        added.push(node);
    });
    save(); renderCanvasOnly();
    return added;
}

// Into the open network: one batch, the new devices selected afterwards so
// the next thing done (a bulk edit, a move) applies to them.
function addDevices(req) {
    if (readOnlyRefuses()) return [];
    const added = batch(() => addDevicesNow(req));
    if (added.length) {
        selectEntries(added.map((n) => ({ type: 'node', id: n.id })));
        // What was just added is looked at next: when any of it is off the
        // screen, the whole map is framed (fitToView) rather than left there.
        const rect = document.getElementById('networkCanvas').getBoundingClientRect();
        const { x, y, zoom } = state.camera;
        if (added.some((n) => n.x * zoom + x < 0 || n.x * zoom + x > rect.width || n.y * zoom + y < 0 || n.y * zoom + y > rect.height)) fitToView();
        showToast(t('Devices added: {n}', { n: added.length }), 'ok');
    }
    return added;
}

// A new network around a router. Not a step: the build is the floor of the
// new document's undo timeline, as the wizard's was.
//
// The router is the one device here given an address nobody typed: its LAN,
// the type's seed (192.168.1.1/24). "The network draws itself" is what this
// was asked for, and every other device takes its address from that LAN, so
// a router without one would build a network with no addressing at all.
// Everything the router serves is cabled to that one LAN interface (a
// router's NIC carries several cables on the map, as a switch nobody drew
// would): left to the binder, the second and third switches landed on new,
// unnumbered eth1 and eth2, and devices added onto them later took addresses
// from eth0's network with a gateway on another port.
function buildNewNetwork(req) {
    if (req.simpleAfter) { state.settings.advanced = false; saveSettings(); applyProfile(); }
    // A built network is a new document: not the card that was open, with no
    // notes or report header of the old one. Kept, like New network: what is
    // built here is somebody's network.
    replaceDocument(EMPTY_DOC, { origin: 'wizard', fit: false, claim: true });
    batch(() => {
        const c = viewCentre();
        const hub = newNodeRecord(ADD_HUB.type, c.x, c.y - 160);
        hub.name = kindName(ADD_HUB.type);
        hub.interfaces = cloneData(initialDataDefaults[ADD_HUB.type].interfaces);
        state.nodes.push(hub);
        const lan = hub.interfaces[0].id;
        const items = (req.items || []).filter((i) => clampCount(i.count) > 0);
        addDevicesNow({ items: items.filter((i) => ADD_INFRA.has(i.type)), pattern: req.pattern, targetId: hub.id, targetIface: lan });
        const sw = state.nodes.find((n) => n.type === 'switch');
        addDevicesNow({ items: items.filter((i) => !ADD_INFRA.has(i.type)), pattern: req.pattern, targetId: (sw || hub).id, targetIface: sw ? null : lan });
        select(null, null);
        save();
    });
    fitToView();
    initHistory();
    renderCanvasOnly();
}

// ---- The dialog ----
const _add = { mode: 'add', simpleAfter: false };

// opts: { mode: 'add' | 'new', simpleAfter }
function openAddDevices(opts = {}) {
    _add.mode = opts.mode === 'new' ? 'new' : 'add';
    _add.simpleAfter = !!opts.simpleAfter;
    if (_add.mode === 'add' && readOnlyRefuses()) return;
    const isNew = _add.mode === 'new';
    addEl('addTitle').textContent = isNew ? t('What do you have?') : t('Add devices');
    addEl('addBlurb').textContent = isNew
        ? t("Count what's in the building — the network draws itself. You can rename and adjust everything afterwards.")
        : t('Count what you are adding. Each one is connected to what you pick under More options and gets the next free address there.');
    addEl('addCancelBtn').textContent = isNew ? t('Start empty') : t('Cancel');
    const rows = addEl('addRows');
    rows.innerHTML = '';
    // A tile per kind (the palette's icons), the count between its steppers.
    addKindsFor(_add.mode).forEach((kind) => {
        const count = isNew ? kind.count : 0;
        const tile = document.createElement('div');
        tile.className = `setup-tile${count === 0 ? ' off' : ''}`;
        tile.dataset.type = kind.type;
        const id = `addCount-${kind.type}`;
        tile.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-sec)">${iconPaths[kind.type] || ''}</svg>
            <label class="st-label" for="${id}">${escapeHtml(t(kind.label))}</label>
            <span class="st-steps">
              <button type="button" class="cs-btn add-dec" aria-label="${escapeHtml(t('One fewer'))}">−</button>
              <input id="${id}" class="input add-count" type="number" inputmode="numeric" min="0" max="${ADD_MAX}" step="1" value="${count}" data-type="${kind.type}">
              <button type="button" class="cs-btn add-inc" aria-label="${escapeHtml(t('One more'))}">+</button></span>`;
        const input = tile.querySelector('input');
        const step = (by) => { input.value = String(clampCount(Number(input.value) + by)); onAddChanged(); };
        tile.querySelector('.add-dec').onclick = () => step(-1);
        tile.querySelector('.add-inc').onclick = () => step(1);
        input.oninput = onAddChanged;
        input.onchange = () => { input.value = String(clampCount(input.value)); onAddChanged(); };
        rows.appendChild(tile);
    });
    addEl('addPattern').value = '';
    // What to connect to: only when adding; a new network's hub is its router.
    const select = addEl('addTarget');
    select.innerHTML = '';
    addEl('addTargetField').hidden = isNew;
    if (!isNew) {
        const none = document.createElement('option');
        none.value = ''; none.textContent = t('Nothing (place them loose)');
        select.appendChild(none);
        state.nodes.filter(canAttachTo)
            .sort((a, b) => ATTACH_TYPES.indexOf(a.type) - ATTACH_TYPES.indexOf(b.type) || naturalCompare(a.name, b.name))
            .forEach((n) => {
                const o = document.createElement('option');
                o.value = n.id;
                o.textContent = isReduced() ? n.name : `${n.name} · ${typeName(n.type)}`;
                select.appendChild(o);
            });
        const def = defaultAddTarget();
        select.value = def ? def.id : '';
    }
    // Folded away in the intake and in a reduced view; open in the full
    // editor, where the pattern and the switch are the point.
    addEl('addMore').open = !isNew && !isReduced();
    onAddChanged();
    const scrim = addEl('addDevices');
    if (window.CarinoUI) CarinoUI.modal.open(scrim);
    else scrim.hidden = false;
}
function closeAddDevices() {
    const scrim = addEl('addDevices');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
}
const addDevicesOpen = () => !addEl('addDevices').hidden;

function addDevicesRequest() {
    return {
        mode: _add.mode,
        simpleAfter: _add.simpleAfter,
        items: [...document.querySelectorAll('#addRows .add-count')].map((el) => ({ type: el.dataset.type, count: clampCount(el.value) })),
        pattern: addEl('addPattern').value,
        targetId: _add.mode === 'add' ? addEl('addTarget').value || null : null,
        ssid: _add.mode === 'add' && !addEl('addSsidField').hidden ? addEl('addSsid').value || null : null
    };
}

function onAddChanged() {
    document.querySelectorAll('#addRows .setup-tile').forEach((tile) => {
        tile.classList.toggle('off', clampCount(tile.querySelector('input').value) === 0);
    });
    renderAddSsid();
    renderAddSummary();
}

// The Wi-Fi network pick: only in the full editor, only onto a target that
// broadcasts more than one, and only while something joins it by radio.
// What was picked stays picked while the counts change.
function renderAddSsid() {
    const field = addEl('addSsidField'), pick = addEl('addSsid');
    const target = _add.mode === 'add' ? getNode(addEl('addTarget').value) : null;
    const ids = target && !isReduced() ? addTargetSsids(target) : [];
    const radio = ids.length > 1 && planAddDevices(Object.assign(addDevicesRequest(), { ssid: null })).devices.some((d) => d.wireless);
    field.hidden = !radio;
    if (!radio) return;
    const was = pick.value;
    pick.innerHTML = ids.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(wifiLabel(wifiById(id)))}</option>`).join('');
    pick.value = ids.includes(was) && pick.dataset.target === target.id ? was : addDefaultSsid(target);
    pick.dataset.target = target.id;
}

// "Names: Phone-01 … Phone-12, Printer": a run per kind, the first four.
function addNamesLine(devices) {
    const runs = [];
    devices.forEach((d) => {
        const last = runs[runs.length - 1];
        if (last && last.type === d.type) last.to = d.name; else runs.push({ type: d.type, from: d.name, to: null });
    });
    const shown = runs.slice(0, 4).map((r) => (r.to ? `${r.from} … ${r.to}` : r.from));
    if (runs.length > 4) shown.push(t('{n} more kinds', { n: runs.length - 4 }));
    return t('Names: {names}', { names: shown.join(', ') });
}
const SHARED_RUN = 'The pattern has no {type}, so every kind shares one run of numbers.';

// What Apply would do, said before it does it. The first lines are for
// everyone; ports and addresses are the full editor's.
function renderAddSummary() {
    const req = addDevicesRequest();
    const out = addEl('addSummary');
    const btn = addEl('addApplyBtn');
    const lines = [];
    const warn = [];
    if (req.mode === 'new') {
        const n = req.items.reduce((s, i) => s + i.count, 0);
        lines.push(t('A router and {n} devices.', { n }));
        // The names too, as buildNewNetwork will give them: the gear the
        // router serves first, then the hosts, on a map holding only the
        // router. Without them a pattern's surprise (PC-01 is a switch) was
        // found only on the map.
        if (n) {
            const hub = kindName(ADD_HUB.type);
            const gear = planAddDevices({ items: req.items.filter((i) => ADD_INFRA.has(i.type)), pattern: req.pattern, taken: [hub] });
            const hosts = planAddDevices({ items: req.items.filter((i) => !ADD_INFRA.has(i.type)), pattern: req.pattern,
                taken: [hub].concat(gear.devices.map((d) => d.name)) });
            lines.push(addNamesLine(gear.devices.concat(hosts.devices)));
            if (gear.sameNames || hosts.sameNames) warn.push(t('Without {n} in the pattern, every device gets the same name.'));
            else if (planAddDevices({ items: req.items, pattern: req.pattern, taken: [] }).sharedRun) warn.push(t(SHARED_RUN));
        }
        btn.textContent = t('✨ Build my network');
        btn.disabled = false;
    } else {
        const plan = planAddDevices(req);
        const n = plan.total;
        btn.textContent = n ? t('Add {n} devices', { n }) : t('Add devices');
        btn.disabled = !n || !!state.readOnly;
        if (n) {
            lines.push(addNamesLine(plan.devices));
            if (plan.sameNames) warn.push(t('Without {n} in the pattern, every device gets the same name.'));
            else if (plan.sharedRun) warn.push(t(SHARED_RUN));
            const target = plan.target;
            if (!target) lines.push(t('Not connected to anything.'));
            else if (!isReduced()) {
                const ports = plan.devices.filter((d) => d.port).map((d) => ifaceLabel(target, d.port));
                const radio = plan.devices.some((d) => d.wireless);
                if (ports.length) lines.push(t(ports.length === 1 ? 'Cabled to {name}, port {from}.' : 'Cabled to {name}, ports {from}–{to}.',
                    { name: target.name, from: ports[0], to: ports[ports.length - 1] }));
                else if (radio) lines.push(t('Joined to {name} by radio.', { name: target.name }));
                else lines.push(t('Cabled to {name}.', { name: target.name }));
                if (radio && plan.ssid) lines.push(t('On the Wi-Fi network {ssid}.', { ssid: wifiLabel(wifiById(plan.ssid)) }));
                const ips = plan.devices.filter((d) => d.ip).map((d) => d.ip.split('/')[0]);
                // All of them on the Wi-Fi network's subnet: that one is named.
                const allWifi = plan.wifiNetwork && plan.devices.every((d) => !d.ip || d.wireless);
                const net = allWifi ? networkLabel(plan.wifiNetwork) : plan.network ? networkLabel(plan.network) : plan.cidr;
                if (ips.length) lines.push(t(ips.length === 1 ? 'Address {from} on {network}.' : 'Addresses {from} – {to} on {network}.',
                    { from: ips[0], to: ips[ips.length - 1], network: net }));
                else if (!plan.cidr && !plan.wifiCidr) lines.push(t('No addresses: {name} is on no network.', { name: target.name }));
                if (plan.portsPast) warn.push(t('{n} of them land past the {ports}-port faceplate of {name} and show as a port overflow.',
                    { n: plan.portsPast, ports: portCountOf(target), name: target.name }));
                if (plan.noAddress > 0) warn.push(t('{network} has no free address left for {n} of them.', { network: net, n: plan.noAddress }));
            } else lines.push(t('Connected to {name}.', { name: target.name }));
        }
    }
    out.innerHTML = lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')
        + warn.map((l) => `<p class="add-warn">⚠ ${escapeHtml(l)}</p>`).join('');
}

function applyAddDevices() {
    const req = addDevicesRequest();
    if (req.mode === 'add' && !planAddDevices(req).total) return;
    closeAddDevices();
    if (req.mode === 'new') buildNewNetwork(req);
    else addDevices(req);
}

addEl('addApplyBtn').onclick = applyAddDevices;
addEl('addCancelBtn').onclick = closeAddDevices;
addEl('addPattern').oninput = renderAddSummary;
addEl('addTarget').onchange = onAddChanged;
addEl('addSsid').onchange = renderAddSummary;
// The tiles scroll on their own above "More options", so on a phone (and in
// the longer Spanish or Russian blurb) the summary sits at the foot of the
// visible body and opening it showed nothing new until you thought to scroll
// the dialog. A person's click brings the options into view; the full editor
// opening them by default does not, so its tiles stay where they start.
addEl('addMore').querySelector('summary').addEventListener('click', () => requestAnimationFrame(() => {
    const more = addEl('addMore');
    if (more.open) more.scrollIntoView({ block: 'nearest' });
}));
// Enter in a count or the pattern is Apply, as in any form.
addEl('addDevices').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input') && !addEl('addApplyBtn').disabled) { e.preventDefault(); applyAddDevices(); }
});
// Before carino-ui.js has loaded ('#setup' opens this during boot) the scrim
// is plain markup: its backdrop and its ✕ close it here, and Esc in js/app.js.
addEl('addDevices').addEventListener('click', (e) => {
    const scrim = addEl('addDevices');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) return;   // CarinoUI's own
    if (e.target === scrim || e.target.closest('[data-close]')) closeAddDevices();
});
addEl('addDevicesBtn').onclick = () => openAddDevices({ mode: 'add' });

// ---- Blocks ----
const builtinBlock = (key) => {
    const meta = SNIPPET_META.find((m) => m.key === key);
    return BUILTIN_BLOCKS[key] ? { key, name: meta ? meta.name : key, doc: BUILTIN_BLOCKS[key], builtin: true } : null;
};
const libraryBlocks = () => libraryEntries().filter((e) => e.block);

// IPv4 ranges as numbers (ipToNum, js/app.js): enough for subnets of a map.
function v4Range(cidr) {
    const p = typeof cidr === 'string' ? parseValidCIDR(cidr) : null;
    if (!p || p.kind !== 'ipv4') return null;
    return { base: ipToNum(p.networkStr.split('/')[0]), size: 2 ** (32 - p.prefix), prefix: p.prefix };
}
const rangesOverlap = (a, b) => a.base < b.base + b.size && b.base < a.base + a.size;
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

// The subnets of a block that would land on ones the map already uses, each
// moved to the next free subnet of its size, and the block rewritten to
// match. Pure: `doc` is a copy, the map is only read.
// -> { doc, moves: [{ from: 'a.b.c.d/p', to: 'a.b.c.d/p' }] }
function readdressBlock(doc) {
    const used = [];
    state.networks.forEach((n) => { const r = v4Range(n.cidr); if (r) used.push(r); });
    state.nodes.forEach((n) => getValidIps(n).forEach((p) => { const r = p.kind === 'ipv4' && v4Range(p.networkStr); if (r) used.push(r); }));
    // The block's own subnets, its declared networks first and widest first,
    // so a host's /24 inside a block's /16 moves with the /16.
    const own = [];
    const addOwn = (cidr) => {
        const r = v4Range(cidr);
        if (r && !own.some((o) => o.base <= r.base && r.base + r.size <= o.base + o.size)) own.push(r);
    };
    (doc.networks || []).map((n) => v4Range(n.cidr)).filter(Boolean).sort((a, b) => b.size - a.size)
        .forEach((r) => addOwn(`${numToIp(r.base)}/${r.prefix}`));
    (doc.nodes || []).forEach((n) => (n.interfaces || []).forEach((i) => { const p = parseValidCIDR(i && i.ip); if (p && p.kind === 'ipv4') addOwn(p.networkStr); }));
    const moves = [];
    own.forEach((r) => {
        if (!used.some((u) => rangesOverlap(u, r))) { used.push(r); return; }
        for (let base = r.base + r.size, tries = 0; base + r.size <= 2 ** 32 && tries < 65536; base += r.size, tries++) {
            const cand = { base, size: r.size, prefix: r.prefix };
            if (used.some((u) => rangesOverlap(u, cand))) continue;
            used.push(cand);
            moves.push({ from: r, to: base });
            return;
        }
        used.push(r);   // nowhere free: it goes in as it is, and the findings say so
    });
    const shift = (text) => (typeof text !== 'string' || !moves.length ? text : text.replace(IPV4_RE, (ip) => {
        if (!ipaddr.IPv4.isValidFourPartDecimal(ip)) return ip;
        const n = ipToNum(ip);
        const m = moves.find((x) => n >= x.from.base && n < x.from.base + x.from.size);
        return m ? numToIp(m.to + (n - m.from.base)) : ip;
    }));
    (doc.nodes || []).forEach((n) => {
        n.gw = shift(n.gw); n.dns = shift(n.dns);
        (n.interfaces || []).forEach((i) => { if (i) i.ip = shift(i.ip); });
    });
    (doc.networks || []).forEach((n) => { n.cidr = shift(n.cidr); n.gateway = shift(n.gateway); n.dns = shift(n.dns); });
    return { doc, moves: moves.map((m) => ({ from: `${numToIp(m.from.base)}/${m.from.prefix}`, to: `${numToIp(m.to)}/${m.from.prefix}` })) };
}

// Where a block's middle goes: to the right of everything already drawn, top
// edges level, so it never lands on top of the devices it is meant to sit
// beside; on an empty map, the middle of the view.
function besideTheMap(blockNodes) {
    if (!state.nodes.length) return viewCentre();
    const xs = blockNodes.map((n) => Number(n.x) || 0), ys = blockNodes.map((n) => Number(n.y) || 0);
    const right = Math.max(...state.nodes.map((n) => n.x)), top = Math.min(...state.nodes.map((n) => n.y));
    return { x: right + 160 - Math.min(0, ...xs), y: top - Math.min(0, ...ys) };
}

// One batch: a block is one thing you added, however many devices it holds.
// opts.at: where its middle goes (default: beside the map, besideTheMap).
function insertBlock(block, opts = {}) { return batch(() => insertBlockNow(block, opts)); }
function insertBlockNow(block, opts) {
    if (!block || !block.doc || readOnlyRefuses()) return null;
    const { doc, moves } = readdressBlock(cloneData(block.doc));
    const c = opts.at || besideTheMap(doc.nodes || []);
    const snap = (v) => Math.round(v / GRID_SNAP) * GRID_SNAP;
    // nextId, not Date.now(): two blocks inserted in the same millisecond
    // would otherwise be handed identical node ids and merge into each other.
    const idMap = {}; const newIds = [];
    (doc.nodes || []).forEach((n) => {
        if (!n || typeof n !== 'object') return;
        const nid = nextId('s'); idMap[n.id] = nid; newIds.push(nid);
        const node = normalizeLoadedNode({ ...n, id: nid, x: snap(c.x + (Number(n.x) || 0)), y: snap(c.y + (Number(n.y) || 0)) });
        dropBlockPlace(node);   // a block from a file or card that still carries one
        state.nodes.push(node);
    });
    // A VM's host is a device id like a cable's end, so it is renamed the same
    // way: onto the copy of its host when the block brought one, else dropped.
    // Kept as it was, a block saved from this map would put the copy on the
    // original's host, or on whatever device of another map has that id.
    newIds.forEach((id) => {
        const node = getNode(id);
        if (!node || node.host === undefined) return;
        if (idMap[node.host]) node.host = idMap[node.host]; else delete node.host;
    });
    // Its networks come with it, under ids of their own; a name already on
    // the map gets a number, so two "Voice" networks can be told apart.
    const names = new Set(state.networks.map((n) => nameKey(n.name)).filter(Boolean));
    normalizeNetworks(doc.networks).forEach((net) => {
        if (state.networks.some((x) => x.cidr === net.cidr)) return;
        net.id = nextId('net');
        if (!isBlank(net.name) && names.has(nameKey(net.name))) {
            let k = 2; while (names.has(nameKey(`${net.name} ${k}`))) k++;
            net.name = `${net.name} ${k}`;
        }
        if (!isBlank(net.name)) names.add(nameKey(net.name));
        state.networks.push(net);
    });
    // Every cable in before any is bound: naming an AP client's radio depends
    // on seeing its link. A cable pinned to an interface (a block that means
    // to show a particular binding) keeps it.
    const newLinks = [];
    (doc.links || []).forEach((l) => {
        if (!l || !idMap[l.source] || !idMap[l.target]) return;
        const link = normalizeLoadedLink({ ...l, id: nextId('sl'), source: idMap[l.source], target: idMap[l.target] });
        state.links.push(link); newLinks.push(link);
    });
    const ids = new Set(newIds);
    // Binding is construction here: only the block's own nodes and cables.
    // A shipped block is written unbound (its wlan0 names included); a saved
    // one was bound when it was drawn, and keeps its interface names.
    if (block.builtin) autoBindLinks(ids); else newLinks.forEach(bindLink);
    // Anything it brings that no network covers is declared, as a migrated
    // document's subnets are, so it does not bring copies of one gateway.
    adoptSubnets(state.nodes, state.networks, { nodeIds: ids });
    setSelectionEntries(newIds.map((id) => ({ type: 'node', id })));
    save(); renderCanvasOnly();
    return { nodeIds: newIds, moves };
}

function insertBlockFromMenu(block) {
    const done = insertBlock(block);
    if (!done) return;
    renderSelection();
    fitToView();   // it went in beside the map, which may be off the screen
    showLibraryTab('nodes');
    if (done.moves.length) showToast(t('Moved to free addresses: {list}', { list: done.moves.map((m) => `${m.from} → ${m.to}`).join(', ') }), 'ok');
}

// A block carries no place (document v7 groups): it is a stamp to put down
// anywhere, as a template is, while a group belongs to one site. Its group id
// means nothing in another document (and would dangle there: the loader's
// normalizeGroupRefs() never sees an insert), and put back into the same
// document its rack units would claim a place the original still holds. So the
// copies come in ungrouped, and the Group picker puts them where they go.
// Carrying the groups along would need the naming and merging rules networks
// have above, for little: a rack place has to be chosen anew anyway.
function dropBlockPlace(n) { delete n.group; RACK_KEYS.forEach((k) => { delete n[k]; }); return n; }

// The selected devices as a block: their records as the serializer writes
// them (the allowlist, as for any card) less their place (dropBlockPlace),
// placed around their middle; the cables with both ends inside; the networks
// they are on or inherit from.
function blockFromSelection() {
    const nodes = selectedOf('node').map((id) => getNode(id)).filter(Boolean);
    if (!nodes.length) return null;
    const ids = new Set(nodes.map((n) => n.id));
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2 / GRID_SNAP) * GRID_SNAP;
    const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2 / GRID_SNAP) * GRID_SNAP;
    const nets = new Set();
    nodes.forEach((n) => {
        getValidIps(n).forEach((p) => { const net = networkOfIp(p.ip); if (net) nets.add(net); });
        ['gateway', 'dns'].forEach((k) => { const net = inheritingNetwork(n, k); if (net) nets.add(net); });
    });
    return {
        v: DOC_VERSION,
        nodes: nodes.map((n) => dropBlockPlace({ ...serializeNode(n), x: n.x - cx, y: n.y - cy })),
        links: state.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map(serializeLink),
        networks: serializeNetworks(state.networks.filter((n) => nets.has(n)))
    };
}

// "Save the selection as a block": a card in the library (js/library.js).
// A block of the same name is updated rather than doubled, as templates are.
async function saveSelectionAsBlock() {
    const doc = blockFromSelection();
    if (!doc) { showToast(t('Select the devices to keep as a block first.')); return null; }
    if (readOnlyRefuses()) return null;
    const name = await askPrompt(t('Name for this block:'), { title: t('Save the selection as a block'), ok: t('Save') });
    if (name === null || !name.trim()) return null;
    const same = libraryBlocks().find((e) => e.name === name.trim());
    const id = librarySave(name.trim(), same ? same.id : null, { template: true, block: true, doc });
    if (!id) { showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err'); return null; }
    renderBlocks();
    if (landingIsOpen()) renderLanding();
    showToast(t('Saved block "{name}".', { name: name.trim() }), 'ok');
    return id;
}

// The Blocks tab: your own first, then the shipped ones. Shipped block names
// are Advanced vocabulary and stay English; the sentences are translated.
function renderBlocks() {
    const list = addEl('blockList');
    if (!list) return;
    list.innerHTML = '';
    SNIPPET_META.forEach((meta) => {
        const block = builtinBlock(meta.key);
        if (block) list.appendChild(libraryItem(meta, () => insertBlockFromMenu(block)));
    });
    const mine = libraryBlocks();
    const own = addEl('userBlockList');
    own.innerHTML = '';
    addEl('userBlockSection').classList.toggle('hidden', !mine.length);
    mine.forEach((e) => {
        own.appendChild(libraryItem(
            { icon: '🧱', name: e.name, blurb: t(((e.doc && e.doc.nodes) || []).length === 1 ? '{n} device' : '{n} devices', { n: ((e.doc && e.doc.nodes) || []).length }) },
            () => insertBlockFromMenu({ name: e.name, doc: e.doc }),
            async () => {
                if (!(await askConfirm(t('Delete block "{name}"?', { name: e.name }), { ok: t('Delete'), danger: true }))) return;
                libraryDelete(e.id);
                renderBlocks();
                if (landingIsOpen()) renderLanding();
            }
        ));
    });
}
addEl('saveBlockBtn').onclick = saveSelectionAsBlock;
