// Wiring: node creation, persistence, shortcuts, event handlers, boot.
// Load order: state -> model -> data -> diagnostics -> ui -> app

// Create a node. opts.at = {x,y} drop point; opts.connectTo = node id to
// link to (and inherit its subnet for auto-IP). A batch of its own, so a
// caller spawning many (a block, a bulk create) can wrap them all in
// one batch and get one undo step and one redraw.
function spawnNode(type, opts = {}) { return batch(() => spawnNodeNow(type, opts)); }
function spawnNodeNow(type, opts) {
    if (readOnlyRefuses()) return null;
    const connectTo = opts.connectTo ? getNode(opts.connectTo) : null;
    let x, y;
    if (opts.at) {
        x = opts.at.x; y = opts.at.y;
    } else if (connectTo) {
        const degree = state.links.filter(l => l.source === connectTo.id || l.target === connectTo.id).length;
        x = connectTo.x + ((degree % 2 === 0 ? -1 : 1) * (70 + Math.floor(degree / 2) * 80));
        y = connectTo.y + 130;
    } else {
        const rect = document.getElementById('networkCanvas').getBoundingClientRect();
        x = (rect.width / 2 - state.camera.x) / state.camera.zoom + (state.nodes.length % 6) * 20;
        y = (rect.height / 2 - state.camera.y) / state.camera.zoom + (state.nodes.length % 6) * 20;
    }
    const node = newNodeRecord(type, x, y);
    const seeded = isReduced();

    // Spawned onto an AP by radio: the seed data's eth0 is the wrong hardware,
    // so rename before it inherits an address.
    if (connectTo && node.interfaces.length && apMediumGuess(connectTo, node) === 'wireless'
        && !node.interfaces.some(ifaceIsWireless) && WIRED_DEFAULT_RE.test(node.interfaces[0].name || '')) {
        node.interfaces[0].name = 'wlan0';
    }

    // Subnet-aware auto-IP: when connecting into an existing subnet, hand the
    // new node the next free host address. Its gateway and DNS are not copied
    // onto it (R7): a declared network hands them down, so the device's own
    // fields stay empty. On a subnet nobody has declared yet the full editor
    // declares it (declareSubnet, js/model.js) with what the drawing already
    // says — the gateway and DNS its devices agree on, or a router on it — so
    // this device and the next one inherit instead of each getting a copy. The
    // seeded profiles still take the best guess onto the device, as they
    // always have: they hide these fields, and their networks are drawn from
    // the seeds.
    if (connectTo && node.interfaces.length) {
        const ctx = subnetContext(connectTo);
        if (ctx) {
            const free = nextFreeHost(ctx.networkStr, ctx.prefix);
            if (free) {
                node.interfaces[0].ip = free;
                if (!ctx.network) {
                    if (seeded) { if (ctx.gatewayIp) node.gw = ctx.gatewayIp; }
                    else declareSubnet(ctx.networkStr);
                }
            }
        }
    }

    state.nodes.push(node);
    if (connectTo && connectTo.id !== node.id) {
        const isVirtual = isVirtualType(connectTo.type) || isVirtualType(type);
        state.links.push(bindLink({ id: nextId('l'), source: connectTo.id, target: node.id, attachment: isVirtual ? 'bridged' : null }));
    }
    select(node.id, 'node'); save();
    renderCanvasOnly();
    renderNodeDiagnostics(node);
    return node;   // as spawnAnnotation does, so a caller can go on to configure it
}

// A new device of `type` at (x, y), snapped to the grid, not yet on the map:
// spawnNode() above and Add devices (js/add.js) both start from this, so a
// device made either way carries the same defaults.
function newNodeRecord(type, x, y) {
    const defs = initialDataDefaults[type] || { os: '', ports: '', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.50/24'}] };
    const palette = paletteDefs.find((p) => p.type === type);
    x = Math.round(x / GRID_SNAP) * GRID_SNAP;
    y = Math.round(y / GRID_SNAP) * GRID_SNAP;

    // The default name is the first label a reporter sees on the canvas, so in
    // the reduced profiles it is the palette's localized (and renamed) word, as
    // Add devices names its devices; Advanced keeps "New <type>" in English,
    // like the rest of its vocabulary.
    const prof = PROFILES[state.settings.profile];
    const shown = (prof && prof.renames && prof.renames[type]) || palette?.name || 'Node';
    const defaultName = isReduced() ? t(shown) : `New ${palette?.name || 'Node'}`;
    // In a register an empty field means "unknown", and a plausible wrong value
    // is worse than none: a PC dropped on an empty canvas used to arrive with
    // gateway 192.168.1.1, DNS 8.8.8.8, "Windows 11", ports 80 and 443 allowed
    // and the address 192.168.1.50, none of which anybody had said, and all of
    // which went straight into the site report (three PCs dropped in a row
    // were also an IP conflict on the spot). So the full editor writes none of
    // the type defaults' values: no gateway, DNS, OS, allowed ports, NAT or
    // address. The interfaces keep their names (the hardware a device of the
    // type has) with no address on them. The gateway, DNS and OS hints are the
    // fields' grey text instead (fieldHints), and an address comes only from
    // the network the device is cabled into (spawnNode, Add devices). The
    // reduced profiles keep the seeds: they hide those fields, and their demo
    // networks are drawn from them.
    const seeded = isReduced();
    const interfaces = cloneData(defs.interfaces);
    if (!seeded) interfaces.forEach((f) => { f.ip = ''; });
    // A new access point's radio is Wi-Fi 6 on 2.4 and 5 GHz, channels and
    // widths on auto (js/model.js "Wi-Fi"): what nearly every AP sold now
    // is, so the common case needs no typing. Unlike the seeds above it is
    // the hardware's, not a guess about the site, so the full editor keeps
    // it too. Any other device's radio starts blank, unknown.
    if (type === 'ap') interfaces.forEach((f) => { if (ifaceIsWireless(f) && !f.radio) f.radio = defaultApRadio(); });
    const node = { id: nextId('n'), type, name: defaultName, x, y, gw: seeded ? defs.gw || '' : '', dns: seeded ? defs.dns || '' : '', os: seeded ? defs.os || '' : '',
        ports: seeded ? defs.ports || '' : '', notes: '', nat: seeded ? !!defs.nat : false, interfaces };
    return node;
}

// ---- Subnet / auto-IP helpers (IPv4) ----
function ipToNum(ip) { const o = ip.split('.').map(Number); return (((o[0] << 24) >>> 0) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0; }
function numToIp(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }

// gatewayIp is the best guess, which ends in "the subnet's .1" when nothing on
// the drawing says otherwise; knownGatewayIp is only what the drawing says.
// The seeded profiles use the guess, the full editor shows it as a hint.
// network is the declared network the address belongs to, when there is one:
// by containment, so a /24 inside a declared /16 is that network's, and
// spawning onto it does not quietly declare a second, nested one.
function subnetContext(node) {
    const ctxFor = (p) => ({ networkStr: p.networkStr, prefix: p.prefix, gatewayIp: gatewayForSubnet(p.networkStr),
        knownGatewayIp: gatewayForSubnet(p.networkStr, { known: true }), dns: dnsForSubnet(p.networkStr),
        network: networkOfIp(p.ip) });
    const own = getValidIps(node).filter(i => i.kind === 'ipv4');
    if (own.length) return ctxFor(own[0]);
    // dumb device (switch/ap): borrow a subnet from an IP-bearing neighbor —
    // first from the interface each cable lands on, since a router's first
    // address is usually its uplink, not the LAN this switch hangs off.
    //
    // A cable that lands on a NIC with no address says this switch is on a
    // segment nobody has numbered yet, and that neighbour lends nothing:
    // borrowing its other address (the router's eth0 LAN, for a switch on
    // its blank eth1) handed every device added there an address on a
    // network it is not on, with the gateway on another router port.
    const unnumbered = new Set();
    for (const l of linksAtNode(node.id)) {
        const nid = l.source === node.id ? l.target : l.source;
        const nb = getNode(nid);
        const face = nb && l3IfaceFor(nb, ifaceIdOn(l, nid));
        const p = face && parseValidCIDR(face.ip);
        if (p && p.kind === 'ipv4') return ctxFor(p);
        if (face && !hasPortGrid(nb) && isBlank(face.ip)) unnumbered.add(nid);
    }
    const neighborIds = state.links.filter(l => l.source === node.id || l.target === node.id).map(l => l.source === node.id ? l.target : l.source)
        .filter((nid) => !unnumbered.has(nid));
    for (const nid of neighborIds) {
        const nb = getNode(nid); if (!nb) continue;
        const ips = getValidIps(nb).filter(i => i.kind === 'ipv4');
        if (ips.length) return ctxFor(ips[0]);
    }
    return null;
}

// A declared network's own gateway answers first: it is what the drawing
// says, in so many words. Then a router on the subnet, then the gateway a
// device there uses (effectiveGw: its own, or inherited).
function gatewayForSubnet(networkStr, opts = {}) {
    const net = state.networks.find((n) => n.cidr === networkStr);
    if (net && !isBlank(net.gateway)) return net.gateway.trim();
    for (const n of state.nodes) {
        const ips = getValidIps(n).filter(i => i.kind === 'ipv4' && i.networkStr === networkStr);
        if (ips.length && isRoutingDevice(n.type)) return ips[0].ip.toString();
    }
    for (const n of state.nodes) {
        const ips = getValidIps(n).filter(i => i.kind === 'ipv4' && i.networkStr === networkStr);
        if (ips.length && effectiveGw(n)) return effectiveGw(n);
    }
    if (opts.known) return null;
    const [base] = networkStr.split('/');
    return numToIp(ipToNum(base) + 1);
}

// The declared network's resolvers, else the ones the hosts already on the
// subnet use, by majority; ties go to the first one drawn. Routing devices are
// left out: their DNS field is their own upstream resolver, which is not what
// a client behind them is handed.
function dnsForSubnet(networkStr) {
    const net = state.networks.find((n) => n.cidr === networkStr);
    if (net && !isBlank(net.dns)) return net.dns.trim();
    const votes = new Map();
    state.nodes.forEach((n) => {
        const dns = effectiveDns(n);
        if (isRoutingDevice(n.type) || !dns) return;
        if (!getValidIps(n).some((i) => i.kind === 'ipv4' && i.networkStr === networkStr)) return;
        const key = dns;
        votes.set(key, (votes.get(key) || 0) + 1);
    });
    let best = '', most = 0;
    votes.forEach((count, dns) => { if (count > most) { best = dns; most = count; } });
    return best;
}

// The grey hint text in the gateway, DNS and OS fields. The gateway and DNS
// fields are overrides now (R7): left blank, the device uses its network's,
// and the hint is that value, so a blank field never reads as "none". The
// field is half a 340px rail wide, so the hint is the bare address; which
// network it comes from is the line under the fields and the field's tooltip
// ("10.0.1.1 · from Office LAN", gwFrom/dnsFrom). With no network to inherit
// from, the hint is what the type defaults used to write into the document,
// now only suggested (see spawnNode), preferring the subnet's own answer,
// guess included, because "e.g. 10.20.0.1" on a 10.20.0.0/24 host says more
// than a generic example.
function fieldHints(node) {
    const defs = (node && initialDataDefaults[node.type]) || {};
    const ctx = node ? subnetContext(node) : null;
    const eg = (v) => (v ? t('e.g. {value}', { value: v }) : '');
    const from = (net, key) => (net ? t('{value} · from {network}', { value: net[key].trim(), network: networkLabel(net) }) : '');
    const gwNet = node ? inheritingNetwork(node, 'gateway') : null;
    const dnsNet = node ? inheritingNetwork(node, 'dns') : null;
    // A router's stored default gateway was the 0.0.0.0 placeholder, which is
    // not an example of anything.
    const typeGw = defs.gw && defs.gw !== '0.0.0.0' ? defs.gw : '';
    return {
        gw: gwNet ? gwNet.gateway.trim() : eg((ctx && ctx.gatewayIp) || typeGw || '10.0.0.1'),
        dns: dnsNet ? dnsNet.dns.trim() : eg((ctx && ctx.dns) || defs.dns || '8.8.8.8'),
        gwFrom: from(gwNet, 'gateway'),
        dnsFrom: from(dnsNet, 'dns'),
        os: eg(defs.os || '')
    };
}

// The next free host address on a subnet, as "ip/prefix". The declared
// network's gateway and resolvers count as taken even when nobody drew them
// (nextFreeAddress, js/model.js), so a new device is never handed the
// router's address.
function nextFreeHost(networkStr, prefix) {
    if (!networkStr || prefix >= 31) return null;
    const ip = nextFreeAddress(networkStr);
    return ip ? `${ip}/${prefix}` : null;
}

// ---- Auto-layout: tiers, then each switch's devices in a block ----
// Tidy used to toggle: a second press put back the layout it had saved before
// the first (_tidyBackup, shown as "Untidy"). Tidy is one batch and one undo
// step, so Undo already does that, and does it after any other edit too,
// where the saved layout went stale and had to be thrown away on every move,
// stamp and replace. A second press now simply tidies again.
//
// It used to put every device of one depth in one row, so at site scale the
// row of phones and cameras under the access switches was some forty devices
// wide and the map a ribbon. Now:
//   * the backbone (everything that more than one cable passes through: the
//     cloud, the router, the switches, an AP with clients) is laid out in
//     tiers from the internet down, each tier wrapped TIDY_WRAP wide;
//   * the devices on the end of a single cable (a PC, a phone, a camera) are
//     gathered by the switch or AP they hang off, in port order, each
//     switch's in a block TIDY_WRAP wide, the blocks side by side under the
//     backbone and wrapped the same way;
//   * devices with no cable at all go last, in one block.
// With two or more devices selected, only those are arranged, by the same
// rules among themselves, where they already were (the top-left of the
// arrangement stays where the selection's was); nothing else moves, but for
// the groups inside a group whose devices are all selected
// (tidyWithInnerGroups).
// One batch: every node moves, and that is one step and one redraw.
const TIDY_WRAP = 12;
// Played (js/motion.js): every device glides to its tidied place.
function tidyLayout() { mapMotion(() => batch(tidyLayoutNow)); }
function tidyLayoutNow() {
    if (!state.nodes.length || readOnlyRefuses()) return;
    const picked = selectedOf('node').map(getNode).filter(Boolean);
    const only = picked.length >= 2;
    const nodes = only ? tidyWithInnerGroups(picked) : state.nodes;
    const pos = tidyPositionsGrouped(nodes, state.links);
    let dx = 0, dy = 0;
    if (only) {
        // Anchored: the arrangement starts where the selection started.
        const minOf = (list, k) => Math.min(...list.map((p) => p[k]));
        const placed = [...pos.values()];
        dx = minOf(nodes, 'x') - minOf(placed, 'x');
        dy = minOf(nodes, 'y') - minOf(placed, 'y');
    }
    const snap = (v) => Math.round(v / GRID_SNAP) * GRID_SNAP;
    nodes.forEach((n) => { const p = pos.get(n.id); if (p) { n.x = snap(p.x + dx); n.y = snap(p.y + dy); } });
    save(); renderCanvasOnly();
    if (!only) fitToView();
}

// nodes, links -> Map(id -> { x, y }). Pure: reads positions only to keep the
// order things already had where nothing else decides it, and writes nothing.
function tidyPositions(nodes, links) {
    const COLW = 150, ROWH = 130, LEAF_ROWH = 110, startX = 140, startY = 120;
    const ids = new Set(nodes.map((n) => n.id));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const adj = new Map(nodes.map((n) => [n.id, new Set()]));
    const wired = links.filter((l) => l.source !== l.target && ids.has(l.source) && ids.has(l.target));
    wired.forEach((l) => { adj.get(l.source).add(l.target); adj.get(l.target).add(l.source); });
    const nameOrder = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, { numeric: true });

    // Depth from the top: the clouds, else a routing device, else the most
    // connected device, then again for every part of the drawing the first
    // walk did not reach, each part starting below the last.
    const depth = new Map();
    const walk = (roots, base) => {
        const q = [];
        roots.forEach((id) => { if (!depth.has(id)) { depth.set(id, base); q.push(id); } });
        while (q.length) {
            const cur = q.shift();
            adj.get(cur).forEach((nb) => { if (!depth.has(nb)) { depth.set(nb, depth.get(cur) + 1); q.push(nb); } });
        }
    };
    const connected = nodes.filter((n) => adj.get(n.id).size);
    const topOf = (list) => list.find((n) => isRoutingDevice(n.type))
        || list.slice().sort((a, b) => adj.get(b.id).size - adj.get(a.id).size)[0];
    const clouds = connected.filter((n) => n.type === 'cloud');
    if (clouds.length) walk(clouds.map((n) => n.id), 0);
    for (let rest = connected.filter((n) => !depth.has(n.id)); rest.length; rest = connected.filter((n) => !depth.has(n.id))) {
        // One unreached part at a time: everything reachable from its first
        // device, so its own top device can be picked.
        const part = new Set([rest[0].id]);
        const q = [rest[0].id];
        while (q.length) adj.get(q.shift()).forEach((nb) => { if (!part.has(nb)) { part.add(nb); q.push(nb); } });
        const base = depth.size ? Math.max(...depth.values()) + 1 : 0;
        walk([topOf(rest.filter((n) => part.has(n.id))).id], base);
    }

    // A leaf hangs off one device on the tier above, by its only cable.
    const parentOf = new Map();
    connected.forEach((n) => {
        const nbs = [...adj.get(n.id)];
        if (n.type === 'cloud' || nbs.length !== 1 || depth.get(n.id) === 0) return;
        if (depth.get(nbs[0]) === depth.get(n.id) - 1) parentOf.set(n.id, nbs[0]);
    });

    // The port a cable between two devices uses on the first one, by number
    // (Infinity for a named interface or no cable).
    const portOn = (headId, otherId) => {
        const l = wired.find((x) => (x.source === headId && x.target === otherId) || (x.target === headId && x.source === otherId));
        const m = l && /^p(\d+)$/.exec(ifaceIdOn(l, headId) || '');
        return m ? Number(m[1]) : Infinity;
    };

    const pos = new Map();
    // The backbone, tier by tier, each ordered under the devices it hangs
    // from (the mean x of its parents), and wrapped.
    const tiers = new Map();
    connected.filter((n) => !parentOf.has(n.id)).forEach((n) => {
        const d = depth.get(n.id);
        if (!tiers.has(d)) tiers.set(d, []);
        tiers.get(d).push(n);
    });
    let y = startY;
    [...tiers.keys()].sort((a, b) => a - b).forEach((d) => {
        const bary = (n) => {
            const ps = [...adj.get(n.id)].filter((id) => depth.get(id) === d - 1 && pos.has(id)).map((id) => pos.get(id).x);
            return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
        };
        // Under one parent, in the order of the parent's ports (the core
        // switch's port 1 first), then as they were drawn, then by name.
        const upPort = (n) => Math.min(Infinity, ...wired.filter((l) => (l.source === n.id || l.target === n.id))
            .map((l) => { const up = l.source === n.id ? l.target : l.source; return depth.get(up) === d - 1 ? portOn(up, n.id) : Infinity; }));
        const row = tiers.get(d).map((n) => ({ n, b: bary(n), p: upPort(n) }))
            .sort((a, b) => (a.b - b.b) || (a.p - b.p) || (a.n.x - b.n.x) || nameOrder(a.n, b.n)).map((e) => e.n);
        row.forEach((n, i) => {
            if (i && i % TIDY_WRAP === 0) y += ROWH;
            pos.set(n.id, { x: startX + (i % TIDY_WRAP) * COLW, y });
        });
        y += ROWH;
    });

    // Each switch's (or AP's, or router's) leaves as a block, in port order:
    // the order a technician reads the faceplate in. Blocks follow their
    // switch's place in the backbone, and wrap like a tier does.
    const blocks = new Map();
    parentOf.forEach((head, id) => { if (!blocks.has(head)) blocks.set(head, []); blocks.get(head).push(byId.get(id)); });
    const heads = [...blocks.keys()].sort((a, b) => (pos.get(a).y - pos.get(b).y) || (pos.get(a).x - pos.get(b).x));
    const groups = heads.map((head) => blocks.get(head).map((n) => ({ n, p: portOn(head, n.id) }))
        .sort((a, b) => (a.p - b.p) || nameOrder(a.n, b.n)).map((e) => e.n));
    // The devices with no cable: one last block, by type then name.
    const loose = nodes.filter((n) => !adj.get(n.id).size)
        .sort((a, b) => String(a.type).localeCompare(String(b.type)) || nameOrder(a, b));
    if (loose.length) groups.push(loose);

    let col = 0, shelfRows = 0;
    groups.forEach((list, gi) => {
        const cols = Math.min(TIDY_WRAP, list.length), rows = Math.ceil(list.length / TIDY_WRAP);
        // A block that does not fit beside the last one starts a new shelf;
        // a column's gap keeps two switches' devices apart. The devices with
        // no cable belong to no switch, so they always start one.
        const isLoose = loose.length && gi === groups.length - 1;
        if (col && (isLoose || col + 1 + cols > TIDY_WRAP)) { y += shelfRows * LEAF_ROWH + (ROWH - LEAF_ROWH); col = 0; shelfRows = 0; }
        const left = col ? col + 1 : 0;
        list.forEach((n, i) => pos.set(n.id, { x: startX + (left + (i % TIDY_WRAP)) * COLW, y: y + Math.floor(i / TIDY_WRAP) * LEAF_ROWH }));
        col = left + cols;
        shelfRows = Math.max(shelfRows, rows);
    });

    // The backbone over what hangs off it. Laid out from the left edge, the
    // router and the switches sat in the top-left corner while their blocks
    // ran twelve wide to the right, so every cable crossed the map. Now,
    // from the lowest backbone row up, each device moves over the middle of
    // what it serves: its own block's first row, and the backbone devices on
    // the tier below it. A row is then laid left to right in that order, one
    // column at least between two devices, so nothing lands on anything (two
    // switches whose blocks sit on different shelves want the same middle;
    // the second goes beside the first, still over its own block).
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const rowsAt = new Map();
    connected.filter((n) => !parentOf.has(n.id)).forEach((n) => {
        const ry = pos.get(n.id).y;
        if (!rowsAt.has(ry)) rowsAt.set(ry, []);
        rowsAt.get(ry).push(n);
    });
    [...rowsAt.keys()].sort((a, b) => b - a).forEach((ry) => {
        const row = rowsAt.get(ry).map((n) => {
            const under = [];
            if (blocks.has(n.id)) under.push(mean(blocks.get(n.id).slice(0, TIDY_WRAP).map((c) => pos.get(c.id).x)));
            adj.get(n.id).forEach((id) => {
                if (depth.get(id) === depth.get(n.id) + 1 && !parentOf.has(id) && pos.get(id).y > ry) under.push(pos.get(id).x);
            });
            return { n, at: pos.get(n.id).x, want: under.length ? mean(under) : pos.get(n.id).x };
        }).sort((a, b) => (a.want - b.want) || (a.at - b.at));
        let last = -Infinity;
        row.forEach((e) => {
            const x = Math.max(e.want, last + COLW);
            pos.set(e.n.id, { x, y: ry });
            last = x;
        });
    });
    return pos;
}

// ---- Tidy with groups (Review-Packs/Topo-groups.md, step B) ----
// Tidy lays the map out by its cables. With groups, a building's devices
// laid out by cables alone were scattered over the whole drawing, and their
// frames (js/groupmap.js) were drawn round half the map and over each other.
// So when the devices tidied sit in groups, each group is laid out as a
// block of its own: its own devices by the rules above, among themselves
// (what a Tidy of them selected does), and each group inside it as a block
// in turn; the blocks are then set side by side in shelves, the way a
// switch's devices are, far enough apart that no frame, tab included, lands
// on another, and an inner frame stays inside the one round it. The devices
// in no group are one more block among them.
//
// What goes first is what the cables say: the blocks are ordered by where
// their devices would sit in a Tidy without groups, so the block with the
// internet and the core comes first and the access closets after it.
//
// The reduced views draw no frames, so they tidy by cables alone, as before
// groups existed; so does a set of devices in no group.
//
// A selection tidied with groups: a group whose own devices are all selected
// is tidied whole, the groups inside it included. Its frame is drawn round
// them too, so leaving them where they were (two rooms selected, not their
// racks) kept a rack switch in place while its room's block was set
// elsewhere, and the room's frame stretched back to it, over the room beside
// it. A group only partly selected stays a selection's tidy: only what was
// picked moves.
function tidyWithInnerGroups(picked) {
    const groups = state.groups || [];
    if (!groups.length || isReduced()) return picked;
    const ids = new Set(picked.map((n) => n.id));
    const whole = groups.filter((g) => {
        const mine = groupMembers(g.id, false);
        return mine.length && mine.every((n) => ids.has(n.id));
    });
    const out = picked.slice();
    whole.forEach((g) => groupMembers(g.id, true).forEach((n) => { if (!ids.has(n.id)) { ids.add(n.id); out.push(n); } }));
    return out;
}

// nodes, links -> Map(id -> { x, y }), as tidyPositions. Pure.
function tidyPositionsGrouped(nodes, links) {
    const groups = state.groups || [];
    const byId = new Map(groups.map((g) => [g.id, g]));
    const keyOf = (n) => (n.group && byId.has(n.group) ? n.group : null);
    if (!groups.length || isReduced() || !nodes.some(keyOf)) return tidyPositions(nodes, links);
    const F = GROUP_FRAME, GAP = 60;
    const order = tidyPositions(nodes, links);   // where cables alone would put them

    // The tree of the groups holding these devices: each one's own devices,
    // and the groups directly inside it. null is the top, and its own
    // devices are the ones in no group.
    const own = new Map([[null, []]]), kids = new Map([[null, new Set()]]);
    const parentKey = (gid) => { const p = byId.get(gid).parent; return p && byId.has(p) ? p : null; };
    nodes.forEach((n) => {
        const k = keyOf(n);
        if (!own.has(k)) own.set(k, []);
        own.get(k).push(n);
        // Up the chain to the top, guarded: the normalizer refuses a cycle,
        // but a loop here would hang the page.
        const seen = new Set();
        for (let c = k; c !== null && !seen.has(c); c = parentKey(c)) {
            seen.add(c);
            const p = parentKey(c);
            if (!kids.has(p)) kids.set(p, new Set());
            kids.get(p).add(c);
        }
    });

    // One block: its devices' places and the box it takes, frame and margin
    // included, both relative to the block's own top-left. Each item in it
    // (its own devices as one, each inner group as one) carries a rank for
    // the order, and they are shelved left to right, wrapping at MAXW.
    const rankOf = (list) => list.reduce((r, n) => {
        const p = order.get(n.id) || n;
        return p.y < r[0] || (p.y === r[0] && p.x < r[1]) ? [p.y, p.x] : r;
    }, [Infinity, Infinity]);
    const layout = (key, depth) => {
        if (depth > groups.length + 1) return { pos: new Map(), box: { w: 0, h: 0 }, all: [] };
        const items = [];
        const mine = own.get(key) || [];
        if (mine.length) {
            const p = tidyPositions(mine, links);
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            p.forEach((v) => { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); });
            // A device's share of a frame: as far round it as groupMapView pads it.
            const pos = new Map([...p].map(([id, v]) => [id, { x: v.x - x0 + F.SIDE, y: v.y - y0 + F.TOP }]));
            items.push({ pos, w: x1 - x0 + 2 * F.SIDE, h: y1 - y0 + F.TOP + F.BOTTOM, all: mine, rank: rankOf(mine) });
        }
        (kids.get(key) || new Set()).forEach((gid) => {
            const sub = layout(gid, depth + 1);
            if (!sub.all.length) return;
            // An inner frame inside an outer one: the outer reaches this much
            // further round it (groupMapView's NEST_*).
            const pos = new Map([...sub.pos].map(([id, v]) => [id, { x: v.x + F.NEST_SIDE, y: v.y + F.NEST_TOP }]));
            items.push({ pos, w: sub.box.w + 2 * F.NEST_SIDE, h: sub.box.h + F.NEST_TOP + F.NEST_SIDE, all: sub.all, rank: rankOf(sub.all) });
        });
        items.sort((a, b) => (a.rank[0] - b.rank[0]) || (a.rank[1] - b.rank[1]));
        // Shelved, in order, wrapping at `wrap`: each shelf's place.
        const shelve = (wrap) => {
            const shelves = [];
            let cur = null;
            items.forEach((it) => {
                if (!cur || (cur.w && cur.w + GAP + it.w > wrap)) { cur = { items: [], w: 0, h: 0 }; shelves.push(cur); }
                cur.w += (cur.items.length ? GAP : 0) + it.w;
                cur.h = Math.max(cur.h, it.h);
                cur.items.push(it);
            });
            const w = Math.max(0, ...shelves.map((s) => s.w));
            const h = shelves.reduce((sum, s) => sum + s.h, 0) + GAP * Math.max(0, shelves.length - 1);
            return { shelves, w, h };
        };
        // The wrap that makes the block most like a screen, landscape: one
        // fixed width put a site's floors one under another, a column too
        // tall to read when the map is framed. Tried at every width a run of
        // items in a row can take (a handful of items, so a handful of tries).
        const ASPECT = 1.6;
        let best = null;
        const widths = new Set([Math.max(0, ...items.map((it) => it.w))]);
        items.forEach((_, i) => { let s = 0; items.slice(i).forEach((it, k) => { s += (k ? GAP : 0) + it.w; widths.add(s); }); });
        [...widths].sort((a, b) => a - b).forEach((wrap) => {
            const p = shelve(wrap);
            const score = Math.max(p.w / ASPECT, p.h);
            if (!best || score < best.score - 0.5) best = Object.assign(p, { score });
        });
        // Each shelf centred under the widest: a rack's switch sits over the
        // middle of the desks it serves, not at their left end.
        const pos = new Map();
        let y = 0;
        best.shelves.forEach((s) => {
            let x = Math.round((best.w - s.w) / 2);
            s.items.forEach((it) => {
                it.pos.forEach((v, id) => pos.set(id, { x: v.x + x, y: v.y + y }));
                x += it.w + GAP;
            });
            y += s.h + GAP;
        });
        return { pos, box: { w: best.w, h: best.h }, all: items.flatMap((it) => it.all) };
    };
    const top = layout(null, 0);
    // Where a Tidy without groups starts, so the map is framed as before.
    let x0 = Infinity, y0 = Infinity;
    top.pos.forEach((v) => { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); });
    const out = new Map();
    top.pos.forEach((v, id) => out.set(id, { x: v.x - x0 + 140, y: v.y - y0 + 120 }));
    return out;
}

// Blocks (stamped pieces of a network) are saved selections now, inserted
// re-addressed into the next free network: insertBlock in js/add.js.

// ---- Settings (localStorage) ----
// UI preferences live in localStorage, not the URL hash — a shared diagram should
// not carry the sharer's panel state. The trace (traceMode, tracePort,
// tracePortOn) is deliberately not persisted: reopening into an active trace
// with nothing selected is confusing, and a port is one session's question.
const SETTINGS_KEY = 'nettopo_settings';

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
        // alertsHidden (the floating alert panel's ✕) went with the panel: the
        // findings are a tab of the rail now, and an old saved value is ignored.
        if (PROFILES[saved.profile]) {
            state.settings.profile = saved.profile;
            state.settings.advanced = 'advanced' in saved ? !!saved.advanced : false;
        } else if (saved.simpleMode) { state.settings.profile = 'simple'; state.settings.advanced = false; } // pre-profile settings migrate
        // saved.profile === 'advanced' (interim schema): the defaults already say advanced view, simple home
        if (resolveLocale(saved.lang)) state.settings.lang = resolveLocale(saved.lang);
        if (['nodes', 'templates', 'blocks'].includes(saved.libraryTab)) state.settings.libraryTab = saved.libraryTab;
        if (typeof saved.subnetZones === 'boolean') state.settings.subnetZones = saved.subnetZones;
        // Map, Table or Rack, once chosen (js/table.js); until then the width
        // decides. Rack stands only while the document has a rack.
        if (saved.view === 'map' || saved.view === 'table' || saved.view === 'rack') state.settings.view = saved.view;
        if (typeof saved.mapInk === 'boolean') state.settings.mapInk = saved.mapInk;
    } catch (e) { /* first run or blocked storage */ }
}

function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ profile: state.settings.profile, advanced: !!state.settings.advanced, lang: state.settings.lang, libraryTab: state.settings.libraryTab, subnetZones: state.settings.subnetZones !== false, view: state.settings.view, mapInk: !!state.settings.mapInk })); } catch (e) { /* private mode */ }
}

// Saved templates used to have a store of their own here (USER_TPL_KEY,
// saveUserTemplate, renderUserTemplates). They are library cards flagged as
// templates now, migrated once at boot: see "Saved templates" in
// js/library.js.

// A text annotation is document furniture, not a device: no interfaces, no
// links — just words pinned to the canvas, saved with the diagram and
// included in exports. See spawnNode for the placement conventions.
function spawnAnnotation(opts = {}) {
    if (readOnlyRefuses()) return null;
    let x, y;
    if (opts.at) { x = opts.at.x; y = opts.at.y; }
    else {
        const rect = document.getElementById('networkCanvas').getBoundingClientRect();
        x = (rect.width / 2 - state.camera.x) / state.camera.zoom;
        y = (rect.height / 2 - state.camera.y) / state.camera.zoom;
    }
    const a = { id: nextId('t'), x: Math.round(x / GRID_SNAP) * GRID_SNAP, y: Math.round(y / GRID_SNAP) * GRID_SNAP, text: opts.text !== undefined ? opts.text : (opts.edit ? '' : 'Double-click to edit'), style: opts.style === 'note' ? 'note' : 'plain', size: 12, targets: [] };
    state.annotations.push(a);
    save(); select(a.id, 'annotation'); renderCanvasOnly();
    if (opts.edit) openAnnotationEditor(a);
    return a;
}

function getWorkspacePoint(clientX, clientY) {
    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    return { x: (clientX - rect.left - state.camera.x) / state.camera.zoom, y: (clientY - rect.top - state.camera.y) / state.camera.zoom };
}

function applyCamera() {
    document.getElementById('workspace').setAttribute('transform', `translate(${state.camera.x}, ${state.camera.y}) scale(${state.camera.zoom})`);
    const backgroundSize = GRID_SNAP * state.camera.zoom, canvasContainer = document.getElementById('canvasContainer');
    canvasContainer.style.backgroundSize = `${backgroundSize}px ${backgroundSize}px`; canvasContainer.style.backgroundPosition = `${state.camera.x}px ${state.camera.y}px`;
}

// Frame the whole topology in the viewport (centered + zoomed to fit).
// nodes: frame these instead of the whole map (the search box's "Zoom to
// matches", js/query.js). Left out, it is every device.
function fitToView(nodes) {
    const list = Array.isArray(nodes) ? nodes : state.nodes;
    if (!list.length) { state.camera = { x: 0, y: 0, zoom: 1 }; applyCamera(); return; }
    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    if (!rect.width || !rect.height) { requestAnimationFrame(() => fitToView(nodes)); return; }
    const NODE = 30, LABEL = 46; // node half-box + label allowance below
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach((n) => {
        minX = Math.min(minX, n.x - NODE); minY = Math.min(minY, n.y - NODE);
        maxX = Math.max(maxX, n.x + NODE); maxY = Math.max(maxY, n.y + NODE + LABEL);
    });
    // The whole map takes in the group frames, whose tabs sit above the
    // devices (js/groupmap.js); a set of matches is framed by its devices.
    const frames = Array.isArray(nodes) ? null : groupFrameBounds();
    if (frames) {
        minX = Math.min(minX, frames.minX); minY = Math.min(minY, frames.minY);
        maxX = Math.max(maxX, frames.maxX); maxY = Math.max(maxY, frames.maxY);
    }
    const PAD = 80;
    const w = (maxX - minX) || 1, h = (maxY - minY) || 1;
    const zoom = Math.min(1.4, Math.max(0.2, Math.min((rect.width - PAD * 2) / w, (rect.height - PAD * 2) / h)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    state.camera.zoom = zoom;
    state.camera.x = rect.width / 2 - cx * zoom;
    state.camera.y = rect.height / 2 - cy * zoom;
    applyCamera();
}

function updateOsDatalist() {
    const dl = document.getElementById('osDatalist'); dl.innerHTML = '';
    new Set(state.nodes.map((n) => n.os).filter(Boolean)).forEach((os) => { dl.appendChild(new Option(os, os)); });
}

// ---- The one document serializer ----
// Everything that persists the canvas — the URL hash, "save as template", and
// undo/redo — goes through here, so there is a single allowlist to keep honest.
// The allowlist is the field schema in js/model.js: any node/link/interface
// field its tables do not name is dropped on the next save.
function serializeNode(n) {
    // The fields, their order and the `|| undefined` rule for each one live in
    // NODE_FIELDS / IFACE_FIELDS (js/model.js), the one list the normalizer
    // and the report read too. Fields that predate the rule (gw, dns, os,
    // ports, notes, nat) are still written when empty, so every document saved
    // before the schema existed serializes to the same bytes.
    //
    // siteRef, portCount and mac ride the `|| undefined` trick, as
    // sourceIface does on a link: JSON.stringify drops them, so documents that
    // never touch them stay byte-identical to what they were before those
    // fields existed. siteRef and bond are rebuilt field by field rather than
    // passed through: an allowlist keeps a hand-edited key out of the URL.
    //
    // mac was the reason for the schema. It was edited in the sidebar and read
    // by the vendor decode, the duplicate-MAC check and the report, but missing
    // from the hand-kept list that used to sit here, so every save, Undo,
    // library card, share link and export silently dropped it.
    return writeFields(NODE_FIELDS, n);
}
function serializeLink(l) {
    return writeFields(LINK_FIELDS, l);
}
function serializeAnnotation(a) {
    return { id: a.id, x: a.x, y: a.y, text: a.text, style: a.style === 'note' ? 'note' : undefined, size: a.size && a.size !== 12 ? a.size : undefined, targets: a.targets && a.targets.length ? a.targets : undefined };
}
function serializeDoc() {
    // annotations and report ride the same `|| undefined` trick as portCount:
    // documents that never place a text note, and diagrams whose report header
    // was never filled in, stay byte-identical to their pre-feature form.
    //
    // The report header travels with the document rather than living in
    // settings, so a shared link is the whole engagement — the survey and who it
    // was for — and not just the picture.
    //
    // `v` is the schema version (DOC_VERSION, js/model.js), first so a reader
    // meets it before anything it might misread. Every document is stamped on
    // its first save; one without it is read as version 1 and migrated once.
    //
    // networks (R7) rides the same trick: a document that declares none
    // carries no key for them. So does `accepted` (the findings accepted with
    // a reason, js/diagnostics.js): allowlisted to its four fields, and the
    // ids of devices and cables that are gone left out. And `groups` (v7):
    // allowlisted through GROUP_FIELDS, no key when there are none. And
    // `wifi` (v12): the Wi-Fi networks, through WIFI_FIELDS, likewise. And
    // `columns` and `tableView` (v13): the custom columns and the Devices
    // table's arrangement (js/model.js "Custom columns").
    return { v: DOC_VERSION, nodes: state.nodes.map(serializeNode), links: state.links.map(serializeLink), networks: serializeNetworks(state.networks), groups: serializeGroups(state.groups), wifi: serializeWifi(state.wifi), accepted: serializeAccepted(state.accepted), pinned: serializePinned(state.pinned), expectedLife: serializeExpectedLife(state.expectedLife), annotations: state.annotations.length ? state.annotations.map(serializeAnnotation) : undefined, report: serializeReportMeta(state.report), columns: serializeCustomColumns(state.columns), tableView: serializeTableView(state.tableView) };
}
function encodeDoc(doc) { return btoa(encodeURIComponent(JSON.stringify(doc))); }

// ---- URL fragment codec ----
// A shared diagram rides in the URL fragment: never sent to a server (so no
// proxy length cap, and it stays out of server logs and Referer). Not private,
// though: see sealed links below, and the live document, which is kept out of
// the URL altogether.
// Its one weakness is size, so the *shareable* form (Copy URL) is compressed.
// Two fragment formats, told apart by a leading marker so old links keep opening:
//   ~<base64url>   deflate-raw compressed  — 7–10x smaller, the form Copy URL emits
//   <base64>       legacy btoa(encodeURIComponent(json)) — what save() once wrote live
// "~" is unreserved in URLs and absent from both base64 alphabets, so it is an
// unambiguous discriminator. Compression is async (native CompressionStream), so
// only the compressed path awaits; the legacy path stays synchronous, which is
// why load() can still be called synchronously with a legacy hash.
const FRAG_SCHEME = '~';
// A third format, one level up: 'b~' carries a whole binder — many networks in
// one link. Detection is a prefix test and decoding slices one character, after
// which the payload is exactly a '~' fragment, so there is one codec and not
// two. Always compressed: encodeShareFragment falls back to the legacy form
// when deflate does not help, and a legacy fallback here would emit an
// ambiguous 'b<base64>' that the discriminator below could not tell from a
// document whose base64 happens to start with b.
const BINDER_FRAG_SCHEME = 'b~';
// Roughly fifteen sites. Measured: eight realistic sites bundle to ~4.7k chars
// and nineteen to ~10.8k, so this is a ceiling on the pathological case rather
// than a limit anyone meets. Past it the file is the honest answer.
const BINDER_URL_MAX = 12000;
const isBinderFragment = (frag) => typeof frag === 'string' && frag.startsWith(BINDER_FRAG_SCHEME);
const _canCompress = typeof CompressionStream !== 'undefined';
const _canDecompress = typeof DecompressionStream !== 'undefined';

function _b64urlFromBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _bytesFromB64url(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
async function _pipeStream(stream, bytes) {
    const w = stream.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

// json string -> the compact shareable fragment (no leading '#'). Falls back to
// the legacy encoding on a browser without CompressionStream, or whenever the
// compressed form would somehow be larger (tiny docs can inflate under deflate).
async function encodeShareFragment(json) {
    const legacy = btoa(encodeURIComponent(json));
    if (!_canCompress) return legacy;
    const packed = await _pipeStream(new CompressionStream('deflate-raw'), new TextEncoder().encode(json));
    const compressed = FRAG_SCHEME + _b64urlFromBytes(packed);
    return compressed.length < legacy.length + 1 ? compressed : legacy;
}
const canMakeBinderLink = () => _canCompress;

async function encodeBinderFragment(json) {
    if (!_canCompress) throw new Error('This browser cannot compress a binder link.');
    const packed = await _pipeStream(new CompressionStream('deflate-raw'), new TextEncoder().encode(json));
    return BINDER_FRAG_SCHEME + _b64urlFromBytes(packed);
}
const decodeBinderFragment = (frag) => decodeFragment(frag.slice(1));   // 'b~xxx' -> '~xxx'

// ---- Sealed links: 'e~' ----
// A fragment never reaches a server, but it is not a secret either: it sits in
// browser history (and whatever syncs it), in the chat or mail thread it was
// pasted into, and in front of every extension that can read the tab's URL.
// base64 and deflate are encodings, so anyone holding a '~' link holds the
// network. A sealed link is AES-GCM ciphertext under a key stretched from a
// passphrase; sent separately from the link, the passphrase is what makes a
// leaked link noise.
//
//   e~<base64url( version | salt[16] | iv[12] | ciphertext+tag )>
//   plaintext = kind (0 document, 1 binder) | deflated (1/0) | body
//
// One envelope for both payloads, so a binder is sealed the same way a single
// network is, and the kind travels inside the ciphertext — the link does not
// even say which of the two it carries. The version byte is the additional
// authenticated data, and it fixes the KDF parameters: raising the iteration
// count later means a new version, never reinterpreting an old link.
const SEAL_SCHEME = 'e~';
const SEAL_VERSION = 1;
const SEAL_ITERATIONS = 600000;      // PBKDF2-HMAC-SHA256, OWASP's 2023 figure
const SEAL_KIND = { doc: 0, binder: 1 };
const SEAL_MIN_PASSPHRASE = 8;
const isSealedFragment = (frag) => typeof frag === 'string' && frag.startsWith(SEAL_SCHEME);
// Web Crypto is secure-context only: https, or localhost while developing.
const canSeal = () => !!(window.crypto && crypto.subtle);

async function _sealKey(passphrase, salt, usage) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: SEAL_ITERATIONS },
        base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

// json string -> 'e~...' (no leading '#').
async function sealFragment(json, kind, passphrase) {
    if (!canSeal()) throw new Error('This browser cannot encrypt a link.');
    const raw = new TextEncoder().encode(json);
    const body = _canCompress ? await _pipeStream(new CompressionStream('deflate-raw'), raw) : raw;
    const plain = new Uint8Array(2 + body.length);
    plain[0] = kind; plain[1] = _canCompress ? 1 : 0; plain.set(body, 2);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const header = new Uint8Array([SEAL_VERSION]);
    const key = await _sealKey(passphrase, salt, 'encrypt');
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, plain));
    const out = new Uint8Array(1 + 16 + 12 + ct.length);
    out.set(header, 0); out.set(salt, 1); out.set(iv, 17); out.set(ct, 29);
    return SEAL_SCHEME + _b64urlFromBytes(out);
}

// 'e~...' -> { kind, json }. Throws an Error whose .code is 'damaged' (not a
// link this build can read), 'passphrase' (wrong passphrase — GCM cannot tell
// that apart from tampering, and neither should the message) or 'unsupported'.
async function unsealFragment(frag, passphrase) {
    const fail = (code) => Object.assign(new Error(code), { code });
    if (!canSeal()) throw fail('unsupported');
    let bytes;
    try { bytes = _bytesFromB64url(frag.slice(SEAL_SCHEME.length)); } catch (e) { throw fail('damaged'); }
    if (bytes.length < 1 + 16 + 12 + 16 + 2 || bytes[0] !== SEAL_VERSION) throw fail('damaged');
    const key = await _sealKey(passphrase, bytes.slice(1, 17), 'decrypt');
    let plain;
    try {
        plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(17, 29), additionalData: bytes.slice(0, 1) }, key, bytes.slice(29)));
    } catch (e) { throw fail('passphrase'); }
    const kind = plain[0], body = plain.slice(2);
    if (kind !== SEAL_KIND.doc && kind !== SEAL_KIND.binder) throw fail('damaged');
    if (plain[1] && !_canDecompress) throw fail('unsupported');
    const raw = plain[1] ? await _pipeStream(new DecompressionStream('deflate-raw'), body) : body;
    return { kind, json: new TextDecoder().decode(raw) };
}

// A passphrase worth sending: 16 characters from an alphabet with no i/l/o/0/1
// to misread over the phone — 31 symbols, so ~79 bits, in groups of four.
// Rejection-sampled (bytes of 248 and up are redrawn) so no symbol is favoured.
function generatePassphrase() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const limit = 256 - (256 % alphabet.length);
    let s = '';
    while (s.replace(/-/g, '').length < 16) {
        for (const b of crypto.getRandomValues(new Uint8Array(32))) {
            if (b >= limit) continue;
            const n = s.replace(/-/g, '').length;
            if (n === 16) break;
            if (n && n % 4 === 0) s += '-';
            s += alphabet[b % alphabet.length];
        }
    }
    return s;
}

// ---- The live document: history.state, not the URL ----
// The open document used to be rewritten into the fragment on every edit, so
// every network anyone drew landed in browser history, and in any history sync,
// whether or not it was ever shared. It now rides the history entry's state
// object instead: kept per tab, restored by a reload and by Back/Forward exactly
// as the fragment was, but stored with the session rather than as a URL — never
// in the history list, never synced. The address bar stays bare. A fragment is
// now only ever an envelope arriving: load() opens it, then puts the document
// here and clears the URL.
//
// The card it came from rides along, so a reload no longer forgets which saved
// network is open, and so does the document's identity (did, upd), so a
// network opened from a link and reloaded is still the same network when it
// is kept. All three are taken when the write is asked for (liveMeta): by the
// time a held write goes in, another card may be open.
const LIVE_STATE_KEY = 'topoDoc';
const cleanUrl = () => window.location.pathname + window.location.search;
// `org` is where it came from, so the bar on the canvas still says "an
// example" or "opened from a link" after a reload.
const liveMeta = () => ({ lib: state.libraryId || null, did: state.docId || null, upd: state.docUpdated || 0, org: _docOrigin });
function liveState(json, meta = liveMeta()) {
    return { [LIVE_STATE_KEY]: json, lib: meta.lib || null, did: meta.did || null, upd: meta.upd || 0, org: meta.org || null };
}
// Reading the entry means wanting the current document, so a throttled write
// still waiting goes in first (see queueLiveDoc). popstate is the one reader
// that must not have it, and drops it before it reads.
function liveEntry() {
    flushLiveDoc();
    const s = window.history.state;
    return s && typeof s[LIVE_STATE_KEY] === 'string' ? s : null;
}
// The same, and a field still being typed into as well.
const liveDocJson = () => { commitTyping(); const e = liveEntry(); return e ? e[LIVE_STATE_KEY] : null; };

// The entry follows the document, but under a budget. save() used to call
// replaceState on every keystroke, and WebKit throws SecurityError after about
// 100 calls in 30 seconds: from then on the entry stopped following the
// document while the undo history kept recording, so a reload quietly brought
// back an older network. Now writes draw on a bucket of LIVE_BURST that refills
// one every LIVE_REFILL_MS — at most 40 + 40 = 80 in any 30 seconds, under the
// limit with room for the pushes that open documents. Ordinary editing never
// empties it, so an edit is in the entry at once, as it was before the budget.
// Only a long run (fast typing in the notes, a held Ctrl+Z) runs dry, and then
// the newest document waits for the next token (only the newest: an older
// pending one is simply replaced). beforeunload, pagehide and visibilitychange
// flush it (see the listeners below), so a reload or a closed tab still finds
// the last edit.
//
// Back/Forward inside the tab is the case a held write cannot reach: by the
// time popstate runs, the entry it was meant for is no longer the current one,
// and replaceState can only write the current one. So every entry this page
// writes carries an id (eid), a waiting write remembers the entry it is for,
// and popstate parks it under that id instead of writing one network into
// another network's entry (parkPendingSaves). Coming back to the entry puts
// it in first. The parking is memory only — it is the network, and it goes
// nowhere the history entry would not — so a reload while on another entry
// forgets it; that is the one remaining loss, and it needs a dry bucket too.
const LIVE_BURST = 40;
const LIVE_REFILL_MS = 750;
let _liveTokens = LIVE_BURST, _liveTokensAt = Date.now();
// What waits for its turn, or null: the JSON, the card and identity it belongs
// to (meta) and the entry it is for, all taken when it was saved — by the time
// it is written another card may be open.
let _livePending = null;
let _liveTimer = 0;
let _liveFailing = false;  // warn once per run of failures, not once a second
const _liveParked = new Map();   // eid -> { json, meta }: writes for entries Back/Forward left
const liveEid = () => { const s = window.history.state; return s && typeof s.eid === 'string' ? s.eid : null; };
const newEid = () => Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join('');
function liveTokens() {
    const now = Date.now();
    _liveTokens = Math.min(LIVE_BURST, _liveTokens + (now - _liveTokensAt) / LIVE_REFILL_MS);
    _liveTokensAt = now;
    return _liveTokens;
}
function writeLiveNow(json, push, meta = liveMeta()) {
    const eid = (!push && liveEid()) || newEid();
    const s = window.history.state;
    // The entry already says exactly this (the typing it filed, a save that
    // changed nothing the entry holds): no call, no token. `upd` is left out
    // of the comparison: it only moves when the document does.
    if (!push && s && s[LIVE_STATE_KEY] === json && (s.lib || null) === (meta.lib || null)
        && (s.did || null) === (meta.did || null) && s.eid === eid) return true;
    try {
        window.history[push ? 'pushState' : 'replaceState']({ ...liveState(json, meta), eid }, '', cleanUrl());
        liveTokens(); _liveTokens = Math.max(0, _liveTokens - 1);
        _liveFailing = false;
        return true;
    } catch (err) {
        // Throttled by the browser, or the document is over its size limit for
        // a history entry. Keep it and try again later: the undo history still
        // has it, and the next save would replace it anyway.
        if (!_liveFailing) console.warn('Could not write the live document:', err);
        _liveFailing = true;
        return false;
    }
}
function scheduleLiveWrite() {
    clearTimeout(_liveTimer);
    const wait = Math.max(0, Math.ceil((1 - liveTokens()) * LIVE_REFILL_MS));
    _liveTimer = setTimeout(flushLiveDoc, _liveFailing ? Math.max(wait, LIVE_REFILL_MS * 2) : wait);
}
// The budgeted write, for edits. Not held while the address bar still holds a
// fragment (an envelope just opened, an entry trigger typed over an open
// network): taking that off the URL is the privacy promise, and it is kept
// now, not a moment later. Nor for an entry without an id yet (one this page
// did not write, the boot demo's): the first write gives it one, so a write
// held after it can be parked by Back.
function queueLiveDoc(json) {
    _livePending = { json, meta: liveMeta(), eid: liveEid() };
    if (window.location.hash || !_livePending.eid) { flushLiveDoc(); return; }
    if (!_liveTimer && !_liveFailing && liveTokens() >= 1) { flushLiveDoc(); return; }
    if (!_liveTimer) scheduleLiveWrite();
}
function flushLiveDoc() {
    clearTimeout(_liveTimer); _liveTimer = 0;
    if (_livePending === null) return;
    if (writeLiveNow(_livePending.json, false, _livePending.meta)) _livePending = null;
    else scheduleLiveWrite();
}
function dropLiveDoc() { clearTimeout(_liveTimer); _liveTimer = 0; _livePending = null; }
// popstate, before it reads: the waiting write was for the entry just left.
// Parked under that entry's id, and put into it when Back/Forward returns.
function parkLiveDoc() {
    const p = _livePending;
    dropLiveDoc();
    if (p && p.eid) _liveParked.set(p.eid, { json: p.json, meta: p.meta });
}
function unparkLiveDoc() {
    const eid = liveEid(), p = eid && _liveParked.get(eid);
    if (!p) return;
    _liveParked.delete(eid);
    // Not a token's worth of choice here: the entry must hold it before
    // load() reads it. A refusal is retried like any other write.
    if (!writeLiveNow(p.json, false, p.meta)) { _livePending = { ...p, eid }; scheduleLiveWrite(); }
}
// The immediate write, for a document being opened. Pushing a new entry first
// lets the old entry have its last edit; replacing this one makes anything
// still waiting for it obsolete.
function writeLiveDoc(json, push) {
    if (push) flushLiveDoc(); else dropLiveDoc();
    if (!writeLiveNow(json, push) && !push) { _livePending = { json, meta: liveMeta(), eid: liveEid() }; scheduleLiveWrite(); }
}
// The document as the history entry holds it: as it arrived when it is
// read-only (replaceDocument), otherwise the serializer's.
const liveJsonNow = () => JSON.stringify(state.readOnly ? state.readOnly.doc : serializeDoc());
// The document did not change but what the entry says about it did (kept,
// released): queued like an edit, so the entry follows.
function refreshLiveEntry() { if (!_borrowedCanvas) queueLiveDoc(liveJsonNow()); }

// fragment (no '#') -> json string. Async only for the compressed form.
async function decodeFragment(frag) {
    if (frag[0] === FRAG_SCHEME) {
        if (!_canDecompress) throw new Error('This link is compressed, but this browser cannot decompress it.');
        return new TextDecoder().decode(await _pipeStream(new DecompressionStream('deflate-raw'), _bytesFromB64url(frag.slice(1))));
    }
    return decodeURIComponent(atob(frag)); // legacy
}

// ---- Topology → netplan bridge ----
// Projects a node onto netplan.carino.systems' interface-intent model, computed
// fresh every time so the link always reflects the node as it is *now* — the
// toggle stores one boolean, never a config snapshot. Wire format is the same
// fragment codec above wrapped in a {v:1, ifaces, fam} envelope; the receiver
// keeps a byte-identical decoder. Full rationale: docs/netplan-bridge-design.md.
function bridgeIntent(node) {
    // Faceplate ports and bonded members are topology bookkeeping, not hosts'
    // configurable interfaces — netplan would render nonsense for them.
    const bondMembers = new Set();
    (node.interfaces || []).forEach((i) => { if (i.bond && Array.isArray(i.bond.members)) i.bond.members.forEach((m) => bondMembers.add(m)); });
    const real = (node.interfaces || []).filter((i) => !i.implicit && !bondMembers.has(i.id));

    // The node-level gateway/DNS belong to exactly one interface on the netplan
    // side: the one whose subnet contains the gateway, else the first addressed
    // one. A heuristic — the hydrated form is meant to be reviewed, not applied.
    // Effective values (R7): a device that inherits its network's gateway is
    // configured with it all the same.
    const gw = effectiveGw(node), dns = effectiveDns(node);
    let gwOwner = null;
    if (gw) {
        const gwStr = gw;
        gwOwner = real.find((i) => {
            const parsed = parseValidCIDR(i.ip);
            try { return parsed && ipaddr.parse(gwStr).match(parsed.cidrObj); } catch (e) { return false; }
        }) || real.find((i) => i.ip) || real[0] || null;
    }

    const ifaces = real.map((i) => {
        const wifi = ifaceIsWireless(i);
        const entry = {
            name: i.name || 'eth0',
            type: wifi ? 'wifi' : 'ethernet',
            dhcp4: !i.ip,                                              // blank IP → assume a DHCP client
            dhcp6: false,
            addr: i.ip ? (i.ip.includes('/') ? i.ip : `${i.ip}${i.ip.includes(':') ? '/64' : '/24'}`) : '', // prefix-less topology IPs get a guessed /24 (v4) or /64 (v6)
            gw: i === gwOwner ? gw : '',
            dns: i === gwOwner ? dns : '',
            search: '',
            routes: [],
        };
        // The SSID the radio's association is on (link.wifi, or the AP's only
        // one), else a placeholder from the node name. The passphrase never
        // rides a URL — fragments land in browser history — and Topo keeps
        // none to ride anywhere (js/model.js "Wi-Fi").
        if (wifi) {
            const assoc = linkOnIface(node.id, i.id);
            const net = assoc ? wifiById(linkWifiSsid(assoc)) : null;
            entry.ssid = (net && net.ssid) || node.name || 'MyWiFi';
        }
        return entry;
    });
    const anyV6 = ifaces.some((i) => i.addr.includes(':'));
    return { v: 1, ifaces, fam: [true, anyV6] };
}

// While a stored document is temporarily on the canvas — the binder report
// rasterises every site in turn — the canvas is not the user's document. The
// sweep's finally can put state back, but it cannot un-write the URL or un-push
// an undo step, so the one chokepoint that writes both refuses instead. See
// withDocRendered() in js/report.js.
let _borrowedCanvas = 0;
const canvasIsBorrowed = () => _borrowedCanvas > 0;
function borrowCanvas(on) { _borrowedCanvas = Math.max(0, _borrowedCanvas + (on ? 1 : -1)); }

function save() {
    if (_borrowedCanvas) return;
    if (_batchDepth) { _batchSave = true; return; }   // once, when the batch ends
    // A document from a newer Topo is never re-written by this one (see
    // replaceDocument). The entry points that create things refuse up front;
    // this is the catch-all for every other edit, which all end here: the
    // change is undone by reloading the document as it arrived.
    // Many paths call save() without having changed anything — a click on a
    // device ends in the same mouseup as a drag — so only a real difference
    // from the document as it was loaded counts as an edit. Without this
    // check a plain click reverted, cleared the selection it had just made
    // and claimed an edit that never happened.
    if (state.readOnly) {
        if (JSON.stringify(serializeDoc()) !== state.readOnly.loaded) revertReadOnlyEdit();
        return;
    }
    try {
        // The host rule (js/model.js "Hosts"), here because every edit ends
        // here: a host moved into a room takes its VMs, a deleted host leaves
        // its guests on nothing, a VM retyped to a server stops being a guest,
        // without the dozen paths that move, delete and retype each knowing
        // it. In place, before the snapshot, so the step undo files is the
        // document as it now is.
        repairHosts(state.nodes);
        pruneHostFolds();   // a host whose last guest just went folds nothing (js/groupmap.js)
        const doc = serializeDoc();
        const json = JSON.stringify(doc);
        // A field still being typed into is part of this document already (the
        // model changes on every keystroke), but it was its own edit: it goes
        // into the timeline first, as the step before this one.
        if (_typingJson !== null) recordHistory(_typingJson);
        cancelTyping();
        recordHistory(json);                           // ride the one chokepoint every mutation already calls
        queueLiveDoc(json);
        noteDocChanged(json);                          // a kept network saves itself (js/library.js)
        updateOsDatalist();
    } catch (err) { console.warn('Could not save diagram state:', err); }
}

// ---- Transactions: one operation, one undo step, one render ----
// An operation that changes many things — a block inserted, a dozen devices
// added at once, the tidy layout, any bulk edit — used to save and
// redraw once per thing, and every save was an undo step: the wizard's network
// cost one Ctrl+Z per device to take back, and each redraw re-read the whole
// drawing. batch(fn) holds save() and renderCanvasOnly() back while fn runs and
// runs each once, if it was asked for, when the outermost batch ends. Nested
// batches fold into the outer one. A throwing fn still saves what it changed:
// the model already holds it, and an unsaved model is the stale-entry bug again.
let _batchDepth = 0, _batchSave = false, _batchRender = false;
function batch(fn) {
    _batchDepth++;
    try { return fn(); }
    finally {
        if (--_batchDepth === 0) {
            const wantSave = _batchSave, wantRender = _batchRender;
            _batchSave = false; _batchRender = false;
            if (wantSave) save();
            if (wantRender) renderCanvasOnly();
        }
    }
}
// renderCanvasOnly() (js/ui.js) asks this first: true means "noted, later".
function holdRender() {
    if (!_batchDepth) return false;
    _batchRender = true;
    return true;
}

// ---- Typing: one field edit, one undo step ----
// Text fields change the model on every keystroke, so the canvas label follows
// as you type, but an undo step per keystroke spent 16 of the 100 steps on one
// address and one gateway. saveTyping() records nothing yet: the step is taken
// when the field is left (change or focusout, wherever it is), after
// TYPING_IDLE_MS without a keystroke, or by the next save() — whichever comes
// first. _typingJson is the document as of the last keystroke, kept so a save
// for some other edit can file the typing as the step before its own.
const TYPING_IDLE_MS = 500;
let _typingTimer = 0, _typingJson = null;
// held: the field's keystrokes pass through values nobody meant (the port
// prefix: "Port " on the way to "Port 0/"), so a pause does not take the step;
// leaving the field (or the next save) does. Without it a slow typist's
// half-typed scheme was an undo step, and Undo put it back.
function saveTyping(held) {
    if (_borrowedCanvas) return;
    // A read-only document is put back at once, not half a second later.
    if (state.readOnly || _batchDepth) { save(); return; }
    try { _typingJson = JSON.stringify(serializeDoc()); } catch (err) { _typingJson = null; }
    // The entry follows the keystrokes (under the budget, see queueLiveDoc):
    // only the undo step waits. Holding the entry back too lost the last half
    // second of typing to a Back pressed straight from the field.
    if (_typingJson !== null) { queueLiveDoc(_typingJson); noteDocChanged(_typingJson); }
    clearTimeout(_typingTimer);
    // Held, the pending step is _typingJson alone (commitTyping takes it);
    // a document that would not serialise has no step to hold, so it keeps
    // the timer and save() takes one from the model.
    _typingTimer = held === true && _typingJson !== null ? 0 : setTimeout(commitTyping, TYPING_IDLE_MS);
    updateUndoButtons();
}
function cancelTyping() {
    const had = _typingJson !== null;
    clearTimeout(_typingTimer); _typingTimer = 0; _typingJson = null;
    if (had) updateUndoButtons();
}
function commitTyping() {
    if (!_typingTimer && _typingJson === null) return;
    // The binder report has the canvas on loan: try again once it is back.
    if (_borrowedCanvas) { clearTimeout(_typingTimer); _typingTimer = setTimeout(commitTyping, TYPING_IDLE_MS); return; }
    cancelTyping();
    save();
}
// Everything held back, written now: the page is going away or out of sight,
// or something is about to read the live document. The autosave too: a kept
// network's card is the copy that outlives the tab.
// A library write still in flight may not outlive the page, so its cards are
// journalled where the next visit will find them (js/library.js).
function flushPendingSaves() { commitTyping(); flushLiveDoc(); flushAutosave(); journalUnsettledCards(); }
// The history entry has changed under us (popstate): what was pending belongs
// to the entry that was left, and is parked for it (see parkLiveDoc). The
// typing's undo step goes with the document it was typed into; the keystrokes
// themselves are in the parked write.
function parkPendingSaves() { cancelTyping(); parkLiveDoc(); }
// Leaving any field is the end of its edit. Capture, so the step is taken
// before the field's own change handler (a checkbox, a select) saves its own.
document.addEventListener('focusout', commitTyping, true);
document.addEventListener('change', commitTyping, true);
// beforeunload is the one a reload keeps: measured in Chromium, a replaceState
// made in beforeunload is in the entry the reload finds, and one made in
// pagehide or visibilitychange is not — the entry is already taken by then.
// pagehide stays for the engines and the bfcache paths that skip
// beforeunload, and visibilitychange covers a mobile browser killing a
// backgrounded tab: the write happens while the page is still alive, so it
// is there when the tab is brought back. No returnValue: this never asks
// "leave site?".
window.addEventListener('beforeunload', flushPendingSaves);
window.addEventListener('pagehide', flushPendingSaves);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingSaves(); });

// ---- Undo / redo ----
// The document is exactly {nodes, links}, and save() already reserializes it
// after every mutation — while camera pans and selection clicks never reach
// save(). So history rides that chokepoint: we hold the last committed snapshot
// (_present, a JSON string) plus a stack of prior ones and a stack of undone
// ones. A save() whose JSON equals _present is a no-op (e.g. a redundant save)
// and does not push a duplicate step; a save() that differs forks the timeline,
// discarding any redo future.
const UNDO_LIMIT = 100;
let _present = null;
let _undoStack = [];
let _redoStack = [];

// Call once the initial document is on screen: makes the loaded state the floor
// of the timeline without itself being an undoable step.
function initHistory() {
    cancelTyping();   // a half-typed edit is not a step below the floor
    _present = JSON.stringify(serializeDoc());
    _undoStack = []; _redoStack = [];
    updateUndoButtons();
}

function recordHistory(json) {
    if (_present === null) { _present = json; updateUndoButtons(); return; }
    if (json === _present) return;                     // nothing about the document changed
    _undoStack.push(_present);
    if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
    _present = json;
    _redoStack = [];                                   // a fresh edit invalidates the redo future
    updateUndoButtons();
}

// Rebuild the canvas from a snapshot without touching the history stacks — undo
// and redo move _present themselves. An armed link is disarmed, as load() does.
// The selection is kept where it can be (plan 3.1): what is still in the
// snapshot stays selected, what the step took away is dropped
// (pruneSelection, js/ui.js), and the rail is redrawn on the snapshot's
// objects — the old ones are gone, and an editor bound to them would edit
// nothing.
//
// An undo snapshot is serializeDoc() output, so it is always at DOC_VERSION:
// loadDocState() only normalizes it. Undo used to re-run auto-bind and the
// wlan0 rename on every step.
function applyDoc(json) {
    state.linkSourceId = null;
    loadDocState(JSON.parse(json));
    pruneHostFolds();   // the step took a host's last guest away: no fold left on it
    pruneSelection();
    // Queued like any edit: a held Ctrl+Z repeats thirty times a second.
    const now = JSON.stringify(serializeDoc());
    queueLiveDoc(now);
    noteDocChanged(now);   // an undo is a change to the card as much as an edit is
    updateOsDatalist();
    renderSelection();
    renderCanvasOnly();
    updateUndoButtons();
    // The Expected life by type dialog, if open, shows the step's values.
    if (typeof refreshLifeDialog === 'function') refreshLifeDialog();
}

// A field still being typed into is the newest step, so it is filed first
// and is what the undo takes back.
function undo() {
    commitTyping();
    if (!_undoStack.length) return;
    _redoStack.push(_present);
    _present = _undoStack.pop();
    mapMotion(() => applyDoc(_present));   // what the step changed on the map is played back
}
function redo() {
    commitTyping();   // which, being an edit, forks the timeline: nothing to redo after it
    if (!_redoStack.length) return;
    _undoStack.push(_present);
    _present = _redoStack.pop();
    mapMotion(() => applyDoc(_present));
}

function updateUndoButtons() {
    const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
    // Typing not yet filed is a step all the same: the button must not read
    // "Nothing to undo" over a field that has just been changed.
    const steps = _undoStack.length + (_typingJson !== null ? 1 : 0);
    if (u) { u.disabled = !steps; u.title = steps ? t('Undo ({n}) — Ctrl+Z', { n: steps }) : t('Nothing to undo'); }
    // and it is a fresh edit, which ends the redo future the moment it is filed.
    const redos = _typingJson !== null ? 0 : _redoStack.length;
    if (r) { r.disabled = !redos; r.title = redos ? t('Redo ({n}) — Ctrl+Shift+Z', { n: redos }) : t('Nothing to redo'); }
}

// Every field is read through NODE_FIELDS (js/model.js): coerced to its
// kind, defaulted, and anything the table does not name is dropped. The legacy
// shapes (`ips`, an AP with no radio) are converted in normalizeNodeInterfaces,
// and normalizeSiteRef — the "only a cloud stands for another site" rule —
// lives beside the table it serves.
function normalizeLoadedNode(node) {
    return readFields(NODE_FIELDS, node && typeof node === 'object' ? node : {});
}

// Links from older diagrams carry no interface refs; keep them optional here and
// let autoBindLinks() fill them in once every node is loaded.
function normalizeLoadedLink(link) {
    return readFields(LINK_FIELDS, link && typeof link === 'object' ? link : {});
}

function normalizeLoadedAnnotation(a) {
    // dangling targets (deleted nodes) are skipped at render time, not here —
    // load order aside, that also self-heals docs edited by older builds.
    return { id: a.id || `t_${Date.now()}_${Math.random().toString(16).slice(2)}`, x: Number.isFinite(a.x) ? a.x : 200, y: Number.isFinite(a.y) ? a.y : 200, text: typeof a.text === 'string' ? a.text : '', style: a.style === 'note' ? 'note' : 'plain', size: Number.isFinite(a.size) ? Math.min(36, Math.max(10, a.size)) : 12, targets: Array.isArray(a.targets) ? a.targets.filter((t) => typeof t === 'string') : [] };
}
// ---- Reading a document into state ----
// The one place a stored document becomes state.nodes / links / annotations /
// report: replaceDocument() below, undo (applyDoc), and the borrowed reads in
// withDoc() and withDocRendered(). Migrates first (a no-op at DOC_VERSION,
// js/model.js), then normalizes. Every list is checked for being a list, so a
// bare { nodes } file can no longer leave the previous document's cables in
// place. Returns { newer } for a document this build may not re-save.
function loadDocState(doc) {
    const { doc: d, newer } = migrateDoc(doc);
    const list = (v) => (Array.isArray(v) ? v : []);
    state.nodes = list(d.nodes).map(normalizeLoadedNode);
    state.links = list(d.links).map(normalizeLoadedLink).filter((l) => getNode(l.source) && getNode(l.target));
    state.networks = normalizeNetworks(d.networks);
    // Groups after the devices: a device's group must be one of them.
    state.groups = normalizeGroups(d.groups);
    normalizeGroupRefs(state.nodes, state.groups);
    // The Wi-Fi networks after the subnets they name, and every reference
    // to them (a link's SSID, a radio band's list) checked against them.
    state.wifi = normalizeWifi(d.wifi);
    normalizeWifiRefs(state.nodes, state.links, state.networks, state.wifi);
    // And after both: a VM's host must be a device here it may run on, and
    // its group is its host's (js/model.js "Hosts").
    repairHosts(state.nodes);
    state.accepted = normalizeAccepted(d.accepted);
    state.pinned = normalizePinned(d.pinned);
    state.expectedLife = normalizeExpectedLife(d.expectedLife);
    // The custom columns, and every device's values checked against them.
    state.columns = normalizeCustomColumns(d.columns);
    normalizeCustomRefs(state.nodes, state.columns);
    state.tableView = normalizeTableView(d.tableView);
    state.annotations = list(d.annotations).filter((a) => a && typeof a === 'object').map(normalizeLoadedAnnotation);
    // Left exactly as stored. normalizeReportMeta() defaults the date to today,
    // so normalising here would give every untouched diagram a report header to
    // serialize. Assigned unconditionally, including to null: leaving it alone
    // once put the previous document's client name on a shared link.
    state.report = d.report && typeof d.report === 'object' ? cloneData(d.report) : null;
    return { newer };
}

const EMPTY_DOC = Object.freeze({ nodes: [], links: [] });

// ---- The one way to replace the document ----
// Opening a link, a file, a card, a template or the example, starting a new
// network, building one with the wizard, restoring a reload: each used to swap
// the document by hand and each reset a different part of the rest. Clear kept
// the saved-network card (so Save overwrote that card with an empty canvas),
// the text notes, the report header and the whole undo history; a { nodes }
// file without `links` half-swapped. Now every path comes here, and the order
// is fixed: migrate and normalize, drop the selection, write the live
// document, start a fresh undo timeline, render.
//
//   libraryId  the saved network this document is (null: none — Save asks
//              for a name rather than overwrite a card with another network).
//   origin     where it came from. 'default' is the boot demo, which is not
//              written to the history entry: until it is edited it is not a
//              document, and a reload of a bare visit must still find the
//              landing. 'live' is a reload or Back/Forward, which keeps the
//              undo timeline when the document it finds is the one on screen.
//   push       a new history entry rather than replacing this one, so Back
//              returns to where the visitor was (a binder shelf).
//   fit        false to leave the camera alone.
//   claim      keep it: it becomes a card with its first change (New network,
//              the wizard, a file). Under libraryId when given, else the id
//              the document carries, else a new one.
//   docId, docUpdated
//              the identity of a document that is not kept (a reload, a guest
//              site); otherwise read from the card, or from the document as
//              it travelled (docIdentity in js/library.js).
function replaceDocument(doc, opts = {}) {
    const origin = opts.origin || 'file';
    // The network going away keeps its last edits: a kept one's pending
    // autosave goes into its card before anything is swapped. The model
    // already holds any half-typed field, so this has it too.
    flushAutosave();
    // A field still being typed into belongs to the document going away. Into
    // a new entry, the old entry keeps it (writeLiveDoc flushes before it
    // pushes); replacing this entry, it has nowhere to go.
    if (opts.push) commitTyping(); else cancelTyping();
    const raw = doc && typeof doc === 'object' ? doc : EMPTY_DOC;
    state.selection = new Set(); state.linkSourceId = null;
    const { newer } = loadDocState(raw);
    // A template is a starting point, never the network it was saved from, so
    // it brings no identity with it.
    const ident = origin === 'template' ? { id: null, updated: 0 } : docIdentity(raw);
    let lib = opts.libraryId || null;
    if (!lib && opts.claim && !newer) lib = ident.id || mintLibraryId();
    state.libraryId = lib;
    state.docId = lib || opts.docId || ident.id || null;
    groupViewDocChanged();   // its own collapsed groups: a view, kept per document (js/groupmap.js)
    const card = lib ? libraryEntry(lib) : null;
    state.docUpdated = card ? card.updated || 0 : (Number.isFinite(opts.docUpdated) ? opts.docUpdated : ident.updated);
    // Kept exactly as it arrived, so an export or a share of it loses nothing
    // this build did not understand.
    // `loaded` is this build's reading of it, taken before anything can touch
    // the model, so save() can tell an edit from a call that changed nothing.
    state.readOnly = newer ? { doc: cloneData(raw), loaded: JSON.stringify(serializeDoc()) } : null;
    select(null, null); updateOsDatalist();
    const json = liveJsonNow();
    noteDocLoaded(JSON.stringify(serializeDoc()), origin === 'live' ? (opts.shownAs || 'live') : origin);
    if (origin !== 'default') writeLiveDoc(json, !!opts.push);
    if (!(origin === 'live' && JSON.stringify(serializeDoc()) === _present)) initHistory();
    renderReadOnly();
    renderDocBar();
    renderCanvasOnly();
    if (opts.fit !== false) fitToView();
}

// The blank canvas a dismissed landing leaves is a network started here, so it
// is kept like New network's: its first device makes it a card.
function claimEmptyDocument() {
    if (state.libraryId || state.readOnly || docHasContent()) return;
    state.libraryId = state.docId = mintLibraryId();
    state.docUpdated = 0;
    noteDocLoaded(JSON.stringify(serializeDoc()), 'new');
}

// ---- The document as it leaves the tab ----
// A build file or a link carries the document's identity: its id (the card's,
// when kept) and when it last changed. Bringing it back is then recognised as
// the same network and merged newer-wins (applyImportedDoc, keepThisNetwork),
// where it used to become a second card. Written here and not by
// serializeDoc(), because an identity is not an edit: in serializeDoc() it
// would be an undo step and a history write of its own. `v` stays first.
function identifiedDoc(doc) {
    if (!state.docId) state.docId = mintLibraryId();   // so the next export or link is the same network
    const kept = isKept() && flushAutosave() ? libraryEntry(state.libraryId) : null;
    const updated = (kept && kept.updated) || state.docUpdated || Date.now();
    const { v, ...rest } = doc;
    return { v, id: state.docId, updated, ...rest };
}

// What a download of this network is called: <site-slug>-<local date>. The
// card's name if it is kept, the report's site if one was typed, "network"
// otherwise. Fixed names ("network-build.nettopo.json") filled a downloads
// folder with copies nobody could tell apart.
function docDisplayName() {
    const card = state.libraryId ? libraryEntry(state.libraryId) : null;
    const site = state.report && typeof state.report.site === 'string' ? state.report.site.trim() : '';
    return (card && card.name) || site || '';
}
const docFileStem = () => `${fileSlug(docDisplayName())}-${todayISO()}`;

// ---- Read-only: a document from a newer Topo ----
// What the build file writes for the open document: the document as it
// arrived when it is read-only, otherwise the serializer's. Only the build
// file takes this. The share link, a saved card and a saved template refuse a
// read-only document instead (share.js, keepThisNetwork and saveAsTemplate in library.js): the
// serializer's allowlist is what keeps hand-edited keys out of a URL and out of
// storage that a binder or a binder link later copies, and anyone can make a
// document "newer" by typing v: 99 into it. Passing it through would turn that
// one number into a way past the allowlist. A file download is the visitor's
// own copy of what they opened, which is the "exported as is" the banner
// promises. The history entry keeps it raw as well (replaceDocument), but that
// is per-tab session state, never a URL.
function outgoingDoc() { return state.readOnly ? cloneData(state.readOnly.doc) : serializeDoc(); }

// True (and says why) when the open document may not be edited.
function readOnlyRefuses() {
    if (!state.readOnly) return false;
    showToast(t('This network is read-only: it was made by a newer version of Topo.'));
    return true;
}

let _reverting = false;
function revertReadOnlyEdit() {
    if (_reverting) return;
    _reverting = true;
    try {
        // Keep what the visitor was looking at when it is still there after
        // the reload: being read-only is about not writing, not about losing
        // your place.
        loadDocState(state.readOnly.doc);
        state.linkSourceId = null;
        pruneSelection(); renderSelection(); renderCanvasOnly();
        readOnlyRefuses();
    } finally { _reverting = false; }
}

// The banner, and the panels that only edit: `inert` takes them out of reach
// of the pointer and the keyboard while leaving them on screen to read.
function renderReadOnly() {
    const on = !!state.readOnly;
    document.body.classList.toggle('doc-readonly', on);
    const banner = document.getElementById('readOnlyBanner');
    if (banner) banner.classList.toggle('hidden', !on);
    // The Subnets tab's networks are document too; its "Subnet zones" switch
    // is a view setting and stays usable. The Groups tab's groups too.
    ['tabPanel-nodes', 'tabPanel-blocks', 'cfgPanel-config', 'networkList', 'undeclaredBox', 'addNetworkBtn', 'groupList', 'addGroupBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.inert = on;
    });
    const tidy = document.getElementById('tidyBtn');
    if (tidy) tidy.disabled = on;
}

// A one-line notice that goes away on its own (carino-ui.css's .toast).
let _toastTimer = null;
function showToast(text, kind = 'warn') {
    const el = document.getElementById('topoToast');
    if (!el) return;
    el.textContent = text;
    el.className = `toast ${kind} show`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// Async so it can decompress a shared "~" link, but the legacy path evaluates no
// await — an async function runs synchronously until its first awaited expression
// — so load() with a legacy hash still completes in one tick, and callers that do
// `save(); load();` keep working without change.
async function load() {
    // Every node about to be replaced, so any id still held is about to dangle.
    // popstate reaches here without a reload — paste a shared URL while link mode
    // is armed and the next canvas click looked up a node that no longer exists.
    state.selection = new Set(); state.linkSourceId = null;
    const hash = window.location.hash.substring(1);
    // The default document follows the profile only on an explicit profile
    // entry ('#imagenology' opens onto an imaging network); a plain visit
    // always gets the Smart Home demo.
    const loadDefaultDoc = (profileTemplate) => {
        const prof = PROFILES[state.settings.profile];
        const key = (profileTemplate && prof && prof.template) || 'house';
        replaceDocument(templatesData[key] || templatesData.house, { origin: 'default' });
    };
    // Entry triggers in the hash — the hash otherwise carries the shared
    // diagram, so these are consumed (the profile itself persists in
    // settings): '#simple' / '#imagenology' open that profile's reduced view,
    // '#advanced' the full view, '#setup' the Add devices intake directly
    // ('#setup-<profile>' also sets that home profile first). On a fresh boot
    // fall through to the profile's default template; mid-session (typed over
    // an open diagram) keep the canvas and let save() put it back in the entry.
    let wizard = false, trigger = hash;
    if (hash === 'setup') { wizard = true; trigger = state.settings.profile; }
    else if (hash.startsWith('setup-') && PROFILES[hash.slice(6)]) { wizard = true; trigger = hash.slice(6); }
    if (PROFILES[trigger] || trigger === 'advanced') {
        if (PROFILES[trigger]) { state.settings.profile = trigger; state.settings.advanced = false; }
        else state.settings.advanced = true;
        saveSettings(); applyProfile();
        if (state.nodes.length) { save(); }
        else {
            window.history.replaceState(null, '', cleanUrl());
            loadDefaultDoc(true);
        }
        // Only this entry lands the built network in the simple view: it is
        // the intake link handed to someone who is not technical.
        if (wizard) openAddDevices({ mode: 'new', simpleAfter: true });
        return;
    }
    // A printed asset label's QR code ('#asset/<tag>', js/assets.js): find the
    // device in this browser's networks, open that one and select it. Not a
    // document, so it never reaches the document branch below (which would
    // read the tag as a broken link and open the demo).
    const assetTag = assetTagOfHash(hash);
    if (assetTag !== null) { await openAssetLink(assetTag); return; }
    // A binder link: many networks, and not a document at all. It opens the
    // landing with them on a guest shelf and touches neither the canvas nor
    // this browser's library — see openBinderLink(). Placed ahead of the
    // document branch because that branch would atob() this, throw, and load
    // the demo network, which looks exactly like a working app. The payload
    // leaves the URL once it is on the shelf; the shelf is what a reload finds.
    if (isBinderFragment(hash)) {
        await openBinderLink(hash);
        window.history.replaceState(null, '', cleanUrl());
        return;
    }
    // A sealed link: ask for the passphrase in the page (never prompt(): boot
    // awaits this, and a native modal would freeze a blank page), then route
    // what comes out exactly as the plain link would have been routed.
    if (isSealedFragment(hash)) { await openSealedLink(hash); return; }

    // No fragment, but this history entry holds the open document: a reload,
    // or Back/Forward onto a network. The card it belonged to comes back with it.
    const live = !hash && liveEntry();
    if (live) {
        if (landingIsOpen()) landingHandledDocument();
        replaceDocument(parseDocJson(live[LIVE_STATE_KEY]) || templatesData.house,
            { libraryId: live.lib || null, origin: 'live', docId: live.did || null, docUpdated: Number.isFinite(live.upd) ? live.upd : 0,
              shownAs: typeof live.org === 'string' ? live.org : null });
        return;
    }

    // A bare URL is the front door, not a document: the landing offers the
    // networks this browser already holds before anything is drawn. Everything
    // else — a shared hash, a profile trigger, an intake link — arrives with the
    // job already chosen and goes straight to the editor. The demo network is
    // still one click away, as "Open the example". Back onto the landing with a
    // network still on the canvas keeps it: dismissing then means "carry on",
    // not "start empty".
    if (!hash) {
        if (shouldShowLanding()) { openLanding(state.nodes.length === 0); return; }
        loadDefaultDoc(false); return;
    }
    // A hash is a document in its own right — a shared link, a pasted URL, an
    // old link from before the document moved out of the URL — and so is the
    // demo the catch below falls back to.
    let json = null;
    try { json = hash[0] === FRAG_SCHEME ? await decodeFragment(hash) : decodeURIComponent(atob(hash)); }
    catch (e) { /* unreadable: openArrivedDocument(null) falls back to the demo */ }
    openArrivedDocument(json);
}

// A document that arrived by link — plain or unsealed. Whatever saved network
// was open, this is not necessarily it, so the association is dropped and Save
// asks for a name rather than quietly overwriting an entry with a different
// network. The profile-trigger branch keeps the canvas it had, so it keeps its
// card too. Then the envelope comes off the URL: the document moves into the
// history entry, and the address bar no longer carries the network.
function openArrivedDocument(json) {
    // A document arriving by Back/Forward off a binder link would otherwise load
    // underneath a landing page still painted on top of it, with the editor's
    // own controls still suppressed.
    if (landingIsOpen()) landingHandledDocument();
    // An unreadable link opens the demo rather than a blank page that looks
    // like a working app with nothing in it.
    replaceDocument(parseDocJson(json) || templatesData.house, { origin: 'link' });
}

// json -> a document object, or null when it is not one.
function parseDocJson(json) {
    try {
        const parsed = JSON.parse(json);
        return isDocShape(parsed) ? parsed : null;
    } catch (e) { return null; }
}

// Deletes the whole selection, in one transaction and one undo step: every
// selected device with every cable on it (selected or not — a cable cannot
// outlive its end), every selected cable, and any note leader that pointed at
// a deleted device. A note or a leader is only ever selected alone.
//
// A set holding devices a collapsed group folds out of sight (js/groupmap.js)
// is asked about first: what is about to go is not on the map to be seen.
// The answer comes back here with `confirmed`, and the set is the one there
// is then. So is one holding a VM or a container folded into its host: the
// question then says folded, which covers both.
function deleteSelected(opts = {}) {
    if (!state.selection.size || readOnlyRefuses()) return;
    const hiddenCount = opts.confirmed ? 0 : selectedHiddenCount();
    if (hiddenCount) {
        const n = selectedOf('node').length;
        const inHost = selectedFoldedGuestCount() > 0;
        const text = n === 1 ? t(inHost ? 'Delete the selected device? It is folded into its host on the map.' : 'Delete the selected device? It is inside a collapsed group on the map.')
            : inHost ? t(hiddenCount === 1 ? 'Delete the {n} selected devices? One of them is folded out of sight on the map.'
                : 'Delete the {n} selected devices? {m} of them are folded out of sight on the map.', { n, m: hiddenCount })
            : t(hiddenCount === 1 ? 'Delete the {n} selected devices? One of them is inside a collapsed group on the map.'
                : 'Delete the {n} selected devices? {m} of them are inside a collapsed group on the map.', { n, m: hiddenCount });
        askConfirm(text, { ok: t('Delete'), danger: true }).then((ok) => { if (ok) deleteSelected({ confirmed: true }); });
        return;
    }
    const one = soleSelected(state.selection);
    const dropTargets = (gone) => state.annotations.forEach((a) => { if (a.targets && a.targets.length) a.targets = a.targets.filter((t) => !gone.has(t)); });
    batch(() => {
        if (one && one.type === 'annotation') { state.annotations = state.annotations.filter((a) => a.id !== one.id); dropTargets(new Set([one.id])); }
        else if (one && one.type === 'notelink') { removeNoteLink(one.id); }
        else {
            const nodes = new Set(selectedOf('node')), links = new Set(selectedOf('link'));
            state.nodes = state.nodes.filter((n) => !nodes.has(n.id));
            state.links = state.links.filter((l) => !links.has(l.id) && !nodes.has(l.source) && !nodes.has(l.target));
            dropTargets(nodes);
        }
        select(null, null); save();
        renderCanvasOnly();
    });
}

// ---- The selection box ----
// Shift-drag on the empty canvas draws a box; every device whose centre is in
// it joins the selection when the button comes up. Devices only: a box drawn
// round a rack is a set of devices, and a set with its cables in it would be
// a mixed one, which offers nothing but Delete (renderSelection, js/ui.js).
// The box adds to what is selected, as Shift does everywhere; a press that
// barely moved selects nothing and keeps the set. Plain drag still pans.
let _marquee = null;   // { x0, y0, x1, y1, el } in workspace coordinates
const MARQUEE_MIN = 4;
function startMarquee(event) {
    const pt = getWorkspacePoint(event.clientX, event.clientY);
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    el.setAttribute('id', 'selectionBox'); el.setAttribute('class', 'selection-box');
    document.getElementById('workspace').appendChild(el);
    _marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y, el };
    drawMarquee();
}
function marqueeBox() {
    const m = _marquee;
    return { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
}
function drawMarquee() {
    const b = marqueeBox();
    _marquee.el.setAttribute('x', b.x); _marquee.el.setAttribute('y', b.y);
    _marquee.el.setAttribute('width', b.w); _marquee.el.setAttribute('height', b.h);
    // the stroke stays one screen pixel wide at any zoom
    _marquee.el.setAttribute('stroke-width', String(1 / state.camera.zoom));
}
function endMarquee() {
    const m = _marquee; _marquee = null;
    m.el.remove();
    const b = { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
    if (Math.max(b.w, b.h) * state.camera.zoom < MARQUEE_MIN) return;
    const inside = state.nodes.filter((n) => n.x >= b.x && n.x <= b.x + b.w && n.y >= b.y && n.y <= b.y + b.h);
    if (!inside.length) return;
    selectEntries([...state.selection, ...inside.map((n) => ({ type: 'node', id: n.id }))]);
}

window.addEventListener('mousedown', (event) => {
    if (event.target.id === 'networkCanvas' && (event.button === 1 || event.button === 0)) {
        if (event.button === 0 && event.shiftKey && !state.linkSourceId) { event.preventDefault(); startMarquee(event); return; }
        isDraggingCanvas = true; lastMouse = { x: event.clientX, y: event.clientY };
        // Ctrl/Cmd, like Shift, means "add to the selection", so a modified
        // press on empty canvas keeps the set rather than clearing it.
        if (event.button === 0 && !isDraggingNode && !event.ctrlKey && !event.metaKey) select(null, null);
    }
});

// The drag's move and its release, named so a finger's drag on a device
// (touchPressNode, below) goes through exactly what a mouse's does.
window.addEventListener('mousemove', (event) => mapPointerMove(event));
function mapPointerMove(event) {
    if (isDraggingCanvas && !isDraggingNode) {
        state.camera.x += event.clientX - lastMouse.x; state.camera.y += event.clientY - lastMouse.y;
        lastMouse = { x: event.clientX, y: event.clientY }; applyCamera();
    } else if (_marquee) {
        const pt = getWorkspacePoint(event.clientX, event.clientY);
        _marquee.x1 = pt.x; _marquee.y1 = pt.y; drawMarquee();
    } else if (isDraggingNode && dragGroup.length) {
        // A press on a collapsed group's node is a tap (it expands) until the
        // pointer has travelled a few pixels (js/groupmap.js): nothing moves yet.
        if (foldPressHolds(event)) return;
        const pt = getWorkspacePoint(event.clientX, event.clientY);
        // The pressed item snaps to the grid and every other item takes the
        // same step from where it started, so a set moves as one and keeps its
        // shape even when its members sit off the grid (the shipped example
        // does). Snapping each on its own would squeeze or stretch the gaps.
        const lead = dragGroup.find((g) => g.item === draggedNode) || dragGroup[0];
        const stepX = Math.round((pt.x - lead.dx) / GRID_SNAP) * GRID_SNAP - lead.x0;
        const stepY = Math.round((pt.y - lead.dy) / GRID_SNAP) * GRID_SNAP - lead.y0;
        const moved = new Set();
        dragGroup.forEach(({ item, x0, y0 }) => {
            item.x = x0 + stepX;
            item.y = y0 + stepY;
            moved.add(item.id);
            // Direct DOM update (Zero RAM overhead) — annotations drag the same way
            const nodeEl = document.getElementById(`ui-node-${item.id}`) || document.getElementById(`ui-ann-${item.id}`);
            if (nodeEl) nodeEl.setAttribute('transform', `translate(${item.x}, ${item.y})`);
        });

        // In a lookup pass, opened after the moves: a whole site dragged at
        // once (Ctrl+A) reshapes every cable, and each one's fan of parallel
        // cables and its two devices are then index lookups, not scans of the
        // document per cable per mouse move. The pass indexes ids and cables,
        // never positions, so the coordinates just set are what is read.
        withLookupPass(() => state.links.forEach(l => {
            if (moved.has(l.source) || moved.has(l.target)) {
                const lineEl = document.getElementById(`ui-link-${l.id}`);
                const geo = lineEl && linkGeometry(l);
                if (geo) applyLinkGeometry(lineEl, geo);
            }
        }));

        // So do the group frames, a collapsed group's node and the cables
        // folded into it (js/groupmap.js): its members have no element of
        // their own to move. A device's drag also lights the group it would
        // be let go into (trackGroupDrop).
        trackGroupDrop(event);
        if (mapOverlayLive()) redrawGroupOverlay();

        // Note leaders follow drags just as fluidly — the dragged thing may be
        // the note itself or a node one of its red lines points at.
        state.annotations.forEach((a) => {
            (a.targets || []).forEach((tid) => {
                if (!moved.has(a.id) && !moved.has(tid)) return;
                const t = noteLinkTarget(tid);
                if (!t) return;
                const geo = noteLinkGeometry(a, t);
                const el = document.getElementById(`ui-annlink-${a.id}-${tid}`);
                const hitEl = document.getElementById(`ui-annlinkhit-${a.id}-${tid}`);
                if (el) applyNoteLinkGeometry(el, geo);
                if (hitEl) applyNoteLinkGeometry(hitEl, geo);
            });
        });
    }
}

window.addEventListener('mouseup', (event) => mapPointerUp(event));
function mapPointerUp(event) {
    isDraggingCanvas = false;
    if (_marquee) { endMarquee(); return; }
    // A press on a collapsed group's node that never became a drag was a tap
    // on it: it expands the group, a view (js/groupmap.js). Nothing moved, so
    // there is nothing to save and no undo step.
    const tapped = takeFoldTap(event);
    // Where a device's drag was let go: into a group, or out of one
    // (js/groupmap.js). Taken before anything else so a drag never leaves it armed.
    const drop = takeGroupDrop(event);
    if (tapped) {
        isDraggingNode = false; draggedNode = null; dragGroup = []; dragCollapse = null;
        expandFoldTapped(tapped);
        return;
    }
    // A press on one device of a set that moved nothing was a click on it.
    const collapse = dragCollapse && dragGroup.every((g) => g.item.x === g.x0 && g.item.y === g.y0) ? dragCollapse : null;
    dragCollapse = null;
    if (isDraggingNode) {
        // One save however many moved: a set dragged is one undo step, and
        // so is a drag that also put it in a group or took it out of one.
        const moved = dragGroup.some((g) => g.item.x !== g.x0 || g.item.y !== g.y0);
        isDraggingNode = false; draggedNode = null; dragGroup = [];
        let said = '';
        // Let go on another device: a new group of them is offered, and the
        // move waits for the answer, so the move and the group are filed as
        // one undo step, or the move alone on Cancel (js/groupmap.js).
        // A drop is played (js/motion.js): a VM set beside its host slides
        // there from where it was let go, and the frame it went into eases
        // to its new size and pulses.
        let motion = null;
        if (moved && drop && drop.target && drop.target.pair) offerGroupFromPair(drop);
        else if (moved && drop) { motion = mapMotionStart(); batch(() => { said = applyGroupDrop(drop); save(); }); }
        else save();
        if (said) { refreshGroupViews(true); showToast(said, 'ok'); }
        if (collapse) { select(collapse, 'node'); return; }   // select() redraws
        renderCanvasOnly(); // Render zones/traces only ONCE when mouse is released
        if (motion) mapMotionPlay(motion, { pulse: drop.target && drop.target.gid });
    } else if (collapse) select(collapse, 'node');
    dragGroup = [];
}

// ---- A finger on a device ----
// A touch screen sends no mouse events for a finger that moves: only a tap
// becomes a mousedown, mouseup and click, after the finger lifts. So a press
// on a device that travels past the tap margin is turned into the mouse's
// drag here, through the same press (pressNode, js/ui.js), move and release
// as a mouse's, and with the same drops: into a group, onto a host, onto
// another device for a new group (js/groupmap.js). A finger that lifts
// without travelling is left alone, and the browser's own mouse events
// select the device as they always have. A device's card takes no pan or
// pinch of its own (touch-action, css/app.css), so the browser hands every
// move to the page and the drag can cancel them.
//
// The moves are heard on the element the finger came down on, not on the
// window: the press selects the device, which redraws the map and takes that
// element out of the page, and a touch keeps sending its events to where it
// started, which then no longer reaches the window.
let _touchPress = null;
function touchPressNode(event, node) {
    if (_touchPress || !event.touches || event.touches.length !== 1 || state.linkSourceId || state.readOnly) return;
    const first = event.touches[0];
    const el = event.target;
    const p = { id: first.identifier, x: first.clientX, y: first.clientY, last: null, started: false };
    _touchPress = p;
    // What the mouse's handlers read off an event, from a touch point.
    const as = (x, y) => ({ clientX: x, clientY: y, button: 0, buttons: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
        sourceCapabilities: { firesTouchEvents: true }, target: el, stopPropagation() {}, preventDefault() {} });
    const mine = (e) => [...(e.changedTouches || [])].find((x) => x.identifier === p.id);
    const move = (e) => {
        const pt = mine(e);
        if (!pt) return;
        p.last = pt;
        if (!p.started) {
            if (Math.hypot(pt.clientX - p.x, pt.clientY - p.y) <= GM_TAP_SLOP.touch) return;
            if (!getNode(node.id)) { done(); return; }
            p.started = true;
            pressNode(as(p.x, p.y), node);
        }
        if (e.cancelable) e.preventDefault();
        mapPointerMove(as(pt.clientX, pt.clientY));
    };
    const end = (e) => {
        const pt = mine(e) || p.last;
        if (!pt && e.type !== 'touchcancel') return;
        done();
        if (!p.started) return;   // a tap: the browser's mouse events select
        if (e.cancelable) e.preventDefault();   // and no click after the drag
        const at = pt || { clientX: p.x, clientY: p.y };
        mapPointerUp(as(at.clientX, at.clientY));
    };
    const done = () => {
        _touchPress = null;
        el.removeEventListener('touchmove', move);
        el.removeEventListener('touchend', end);
        el.removeEventListener('touchcancel', end);
    };
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
}

document.getElementById('networkCanvas').addEventListener('wheel', (event) => {
    event.preventDefault(); const rect = document.getElementById('networkCanvas').getBoundingClientRect();
    const mx = event.clientX - rect.left, my = event.clientY - rect.top, nextZoom = Math.min(Math.max(0.2, state.camera.zoom * Math.exp(-event.deltaY * 0.001)), 5);
    state.camera.x = mx - (mx - state.camera.x) * (nextZoom / state.camera.zoom); state.camera.y = my - (my - state.camera.y) * (nextZoom / state.camera.zoom); state.camera.zoom = nextZoom; applyCamera();
}, { passive: false });

// ---- Keyboard shortcuts ----
// The handler and the on-screen cheatsheet are generated from this one table, so
// the documented keys cannot drift away from the ones that actually fire.
// Trace lives in the node's Diagnostics tab; its state is in state.settings
// (js/state.js) and every way in (the tab's checkbox, T, the phone's handy
// bar) comes through here. Turning it on opens the Diagnostics tab, so the
// controls that turn it off and the "→ n devices" line are on screen, and
// picks a start device when none is selected (a router or firewall first) so
// the trace lights up at once. The reduced views have no trace at all.
function setTraceMode(on) {
    on = !!on && !isReduced();
    state.settings.traceMode = on;
    syncTraceControls();
    document.dispatchEvent(new CustomEvent('topo:tracechange', { detail: { on } })); // js/mobile.js
    if (on) {
        showConfigTab('diagnostics');
        if (!state.selectedId || state.selectedType !== 'node') {
            const start = state.nodes.find((n) => isRoutingDevice(n.type)) || state.nodes.find((n) => n.type !== 'cloud') || state.nodes[0];
            if (start) { select(start.id, 'node'); return; } // select() re-renders
        }
    }
    renderCanvasOnly();
}

// True while something covers the map: the landing page, or one of the plain
// .hidden-toggled dialogs (report, share, unlock, mode picker, shortcut
// list). CarinoUI.modal is checked separately, before any shortcut; Add
// devices is one of those, but '#setup' opens it during boot, before
// carino-ui.js has loaded, as a plain [hidden] scrim (js/add.js).
function topoOverlayOpen() {
    return landingIsOpen() || !!document.querySelector('.topo-dlg:not(.hidden)') || addDevicesOpen();
}

function toggleShortcutHelp(force) {
    const panel = document.getElementById('shortcutHelp');
    const show = force !== undefined ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
}

const SHORTCUTS = [
    // simpleHidden entries drive UI that Simple mode hides — the key handler
    // skips them and the cheatsheet omits them while the mode is on.
    // mod entries are the Ctrl/Cmd combinations this page takes for itself;
    // every other combination is left to the browser.
    { keys: ['T'], label: 'Toggle trace mode', simpleHidden: true, test: (e) => e.key.toLowerCase() === 't',
      run: () => setTraceMode(!state.settings.traceMode) },
    { keys: ['F'], label: 'Fit the diagram to the view', test: (e) => e.key.toLowerCase() === 'f',
      run: () => fitToView() },
    { keys: ['A'], label: 'Findings tab (and back)', simpleHidden: true, test: (e) => e.key.toLowerCase() === 'a',
      run: () => toggleFindingsTab() },
    { keys: ['L'], label: 'Link from the selected node', test: (e) => e.key.toLowerCase() === 'l',
      run: () => { if (state.selectedType === 'node' && state.selectedId) { state.linkSourceId = state.selectedId; renderCanvasOnly(); } } },
    { keys: ['1'], label: 'Nodes tab', simpleLabel: 'Devices tab', test: (e) => e.key === '1', run: () => showLibraryTab('nodes') },
    { keys: ['2'], label: 'Networks tab', simpleLabel: 'Examples tab', test: (e) => e.key === '2', run: () => showLibraryTab('templates') },
    { keys: ['3'], label: 'Blocks tab', simpleHidden: true, test: (e) => e.key === '3', run: () => showLibraryTab('blocks') },
    { keys: ['/'], label: 'Search the map and table', simpleHidden: true, test: (e) => e.key === '/',
      run: () => { const f = document.getElementById('queryInput'); f.focus(); f.select(); } },
    { keys: ['0'], label: 'Reset zoom to 1:1', test: (e) => e.key === '0',
      run: () => document.getElementById('zoomResetBtn').click() },
    { keys: ['+', '−'], label: 'Zoom in / out', test: (e) => ['+', '=', '-', '_'].includes(e.key),
      run: (e) => document.getElementById(['+', '='].includes(e.key) ? 'zoomInBtn' : 'zoomOutBtn').click() },
    // Del and Ctrl+A act on the map, so neither fires while a Topo overlay
    // covers it: the keys are left to the browser there, where Ctrl+A selects
    // the dialog's text, and Ctrl+A then Del cannot wipe a map nobody can see.
    // The table covers the map the same way: there Delete belongs to a cell
    // (it opens the cell empty), and with the focus elsewhere it would remove
    // devices that may be ticked out of sight, so it does nothing at all.
    // The rack view (js/rackview.js) shows one rack: the selection can hold
    // devices that are not in it, so it does nothing there either.
    { keys: ['Del'], label: 'Delete the selection', test: (e) => (e.key === 'Delete' || e.key === 'Backspace') && !topoOverlayOpen() && !tableShown() && !rackShown(),
      run: () => deleteSelected() },
    { keys: ['Ctrl', 'A'], label: 'Select every device and cable', mod: true, test: (e) => e.key.toLowerCase() === 'a' && !topoOverlayOpen(),
      run: () => selectAll() },
    { keys: ['Esc'], label: 'Cancel link mode / deselect', test: (e) => e.key === 'Escape',
      run: () => {
          // The landing covers everything below it, so dismissing it is the
          // whole action — nothing underneath is selectable to deselect.
          if (landingIsOpen()) { closeLanding(); return; }
          toggleShortcutHelp(false); closeAddDevices(); closeModePicker(); closeReportDialog(); state.linkSourceId = null; select(null, null); renderCanvasOnly();
      } },
    { keys: ['?'], label: 'Show this list', test: (e) => e.key === '?', run: () => toggleShortcutHelp() }
];

window.addEventListener('keydown', (event) => {
    // A question on screen (js/dialog.js) owns the keyboard: Delete must not
    // delete the selection behind it, nor F refit the map. CarinoUI.modal
    // handles Esc and Tab itself.
    if (window.CarinoUI && CarinoUI.modal.top()) return;
    const activeTag = document.activeElement?.tagName || '';
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag);

    // Undo/redo are the exception to "leave Ctrl/Cmd combos alone" below. Inside a
    // field we defer to the browser's own text undo; on the canvas they act on the
    // diagram. Ctrl+Z, and either Ctrl+Shift+Z or Ctrl+Y to redo.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !inField) {
        const k = event.key.toLowerCase();
        if (k === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
        if (k === 'y') { event.preventDefault(); redo(); return; }
        const modHit = !event.shiftKey && SHORTCUTS.find((sc) => sc.mod && sc.test(event));
        if (modHit) { event.preventDefault(); modHit.run(event); return; }
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return; // leave browser/OS combos alone

    const tag = document.activeElement?.tagName || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        // Escape is the way out of a field; every other key belongs to the field.
        if (event.key === 'Escape') document.activeElement.blur();
        return;
    }

    const hit = SHORTCUTS.find((sc) => !sc.mod && sc.test(event));
    if (!hit) return;
    if (isReduced() && hit.simpleHidden) return;
    event.preventDefault();
    hit.run(event);
});

// Mouse interactions used to live at the bottom of the Nodes palette, where they
// were easy to miss and took space from the palette. They belong here, in the
// one help surface, reachable from the ? button and the ? key.
const MOUSE_HINTS = [
    { icon: '🖱️', verb: 'Click', text: 'Select a node or link to edit it.' },
    { icon: '✋', verb: 'Drag', text: 'Move a node, or pan the empty canvas.' },
    { icon: '➕', verb: 'Shift-click', text: 'Add a device or cable to the selection, or take it out.' },
    { icon: '⬚', verb: 'Shift-drag', text: 'Select every device inside the box.' },
    { icon: '⚡', verb: 'Right-click', text: 'Link mode — then click another node to connect.' }
];

function renderShortcutHelp() {
    const subhead = (txt) => `<div class="sc-sub">${escapeHtml(t(txt))}</div>`;
    const mouse = MOUSE_HINTS.map((h) => `
        <div class="sc-hint">
            <span>${h.icon}</span>
            <span><b>${escapeHtml(t(h.verb))}:</b> ${escapeHtml(t(h.text))}</span>
        </div>`).join('');
    const keys = SHORTCUTS.filter((sc) => !(isReduced() && sc.simpleHidden)).map((sc) => `
        <div class="shortcut-row sc-row">
            <span>${escapeHtml(t((isReduced() && sc.simpleLabel) || sc.label))}</span>
            <span class="sc-keys">${sc.keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</span>
        </div>`).join('');
    // The full editor hides the "Something missing? Try another mode" button
    // (css/app.css), so the way down to a simpler view or the setup wizard
    // lives here instead of nowhere.
    const modes = isReduced() ? '' : `<div class="sc-keyboard">
            <button type="button" id="helpModeBtn" class="btn">${escapeHtml(t('Switch to a simpler view or the setup wizard'))}</button>
        </div>`;
    document.getElementById('shortcutBody').innerHTML =
        subhead('Mouse') + mouse +
        `<div class="sc-keyboard">${subhead('Keyboard')}${keys}</div>` + modes;
    const modeBtn = document.getElementById('helpModeBtn');
    if (modeBtn) modeBtn.onclick = () => { toggleShortcutHelp(false); openModePicker(); };
}

// ---- Library tabs ----
function showLibraryTab(name) {
    if (isReduced() && name === 'blocks') name = 'nodes'; // Blocks is hidden in reduced profiles
    state.settings.libraryTab = name;
    saveSettings();
    document.querySelectorAll('.lib-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll('.lib-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tabPanel-${name}`));
}
document.querySelectorAll('.lib-tab').forEach((t) => { t.onclick = () => showLibraryTab(t.dataset.tab); });

// The selection panel splits into Configuration (primary) and Diagnostics tabs.
// Purely presentational — it flips which panel shows; the panes inside keep their
// own selected/empty states, so no render logic needs to know which tab is up.
function showConfigTab(name) {
    document.querySelectorAll('.cfg-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.cfgtab === name)));
    document.querySelectorAll('.cfg-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `cfgPanel-${name}`));
    // The Subnets tab is only kept up to date while it shows (js/networks.js).
    if (name === 'networks') renderNetworksPanel(true);
    if (name === 'groups') renderGroupsPanel(true);   // and the Groups tab (js/groups.js)
    if (name === 'wifi') renderWifiPanel(true);       // and the Wi-Fi tab (js/wifi.js)
}
document.querySelectorAll('.cfg-tab').forEach((t) => { t.onclick = () => showConfigTab(t.dataset.cfgtab); });

// ---- Profiles ----
// Simple profiles are a starting point for people who are not technical at
// all. The HOME PROFILE (simple, imagenology, …) is set by how the person
// arrived — '#<profile>' / '#setup-<profile>' / '?profile=' — and is sticky;
// modes are switched only through the mode picker (the "Something missing?"
// button below the palette), so returning from Advanced always offers their
// specific simple mode. Reduced hides trace, diagnostics, IP configuration, blocks and
// validation chrome (body.simple-mode rules in css/app.css) and swaps jargon
// for plain words; a purpose profile additionally curates the palette,
// renames devices for its audience and picks the default document
// (body.<cssClass> rules handle the palette exceptions). Display-only — the
// document keeps every field, so Advanced completes the technical picture
// with nothing lost. The intake is the Add devices dialog in its 'new' mode
// (openAddDevices, js/add.js): count what you have, the network draws itself.
const PROFILES = {
    simple: {
        icon: '🙂', label: 'General', blurb: 'A home or small office — just devices and connections', template: 'house',
    },
    imagenology: {
        icon: '🩻', label: 'Imagenology', blurb: 'Medical imaging — modalities, PACS and viewing stations', template: 'imaging', cssClass: 'profile-imagenology',
        renames: { server: 'PACS / Archive', pc: 'Viewing Station', dicom: 'Modality (CT/MR/US)' },
    },
};
const isReduced = () => !state.settings.advanced;

function applyProfile() {
    if (!PROFILES[state.settings.profile]) state.settings.profile = 'simple';
    const prof = PROFILES[state.settings.profile];
    const on = isReduced();
    document.body.classList.toggle('simple-mode', on);
    Object.keys(PROFILES).forEach((k) => {
        if (PROFILES[k].cssClass) document.body.classList.toggle(PROFILES[k].cssClass, on && k === state.settings.profile);
    });
    // Plain words while reduced (localized); the English originals come back
    // with Advanced — technical vocabulary stays untranslated on purpose.
    const tabText = (tab, txt) => { const el = document.querySelector(`.lib-tab[data-tab="${tab}"]`); if (el) el.firstChild.textContent = `${txt} `; };
    tabText('nodes', on ? t('Devices') : 'Nodes');
    tabText('templates', on ? t('Examples') : 'Templates');
    // …so the collapsed group inside that tab cannot be called Examples too.
    document.getElementById('exampleTemplatesSummary').textContent = on ? t('More examples') : t('Examples');
    document.getElementById('linkMediumLabel').textContent = on ? t('Connection') : 'Link Material';
    document.querySelectorAll('#propMedium option').forEach((o) => {
        if (!o.dataset.advanced) o.dataset.advanced = o.textContent;
        o.textContent = on ? t(o.dataset.simple) : o.dataset.advanced;
    });
    // Purpose renames on the palette (e.g. Server → PACS / Archive).
    document.querySelectorAll('#nodePalette .palette-item[data-type]').forEach((b) => {
        const span = b.querySelector('span:last-child');
        if (!span.dataset.base) span.dataset.base = span.textContent;
        span.textContent = on ? t((prof.renames && prof.renames[b.dataset.type]) || span.dataset.base) : span.dataset.base;
    });
    if (on) {
        if (state.settings.traceMode) setTraceMode(false);
        if (state.settings.libraryTab === 'blocks') showLibraryTab('nodes');
        showConfigTab('config'); // the Diagnostics tab is gone; never strand the panel on it
    }
    renderShortcutHelp(); // the cheatsheet drops keys whose UI is hidden
    applyView();          // js/table.js: a reduced view has no table, only the map
}

// ---- Locale (js/i18n.js holds the dictionaries) ----
// Re-renders every reporter-path surface in the current locale: static
// data-i18n markup, the mixed-content chrome (buttons whose text sits next to
// glyphs or nested spans), then applyProfile() for the vocabulary swaps.
// Called with a lang only by the fleet switcher bridge in js/i18n.js, which is
// the one case where the new choice has to be remembered.
function applyLocale(lang) {
    if (lang) { state.settings.lang = lang; saveSettings(); }
    applyStaticI18n();
    document.getElementById('undoBtn').textContent = `↶ ${t('Undo')}`;
    document.getElementById('redoBtn').textContent = `↷ ${t('Redo')}`;
    document.getElementById('tidyBtn').textContent = `⤢ ${t('Tidy')}`;
    // File, not Export (plan R3): it opens, keeps and starts networks too.
    document.getElementById('exportMenuBtn').innerHTML = `📁 ${t('File')} <span class="cs-caret">▾</span>`;
    document.getElementById('copyUrlBtn').innerHTML = `🔗 ${t('Copy link')} <span class="cs-menu-note">${t('short URL')}</span>`;
    document.getElementById('exportPngBtn').textContent = `🖼️ ${t('PNG image')}`;
    document.getElementById('exportSvgBtn').innerHTML = `🖼️ ${t('SVG image')} <span class="cs-menu-note">${t('vector')}</span>`;
    document.getElementById('exportJsonBtn').innerHTML = `📄 ${t('Back up this network')} <span class="cs-menu-note">.nettopo</span>`;
    document.getElementById('csvMenuBtn').innerHTML = `📊 ${t('Spreadsheet')} <span class="cs-menu-note">CSV · TSV</span>`;
    document.getElementById('reportBtn').innerHTML = `📋 ${t('Site report')} <span class="cs-menu-note">${t('printable')}</span>`;
    document.getElementById('myNetworksBtn').innerHTML = `🗂️ ${t('My networks')} <span class="cs-menu-note">${t('saved here')}</span>`;
    document.getElementById('saveNetworkBtn').textContent = `💾 ${t('Keep this network')}`;
    document.getElementById('saveTemplateBtn').innerHTML = `📐 ${t('Save as template')} <span class="cs-menu-note">${t('reusable')}</span>`;
    // The cards are built at open time and carry counts, ages and pluralised
    // labels that applyStaticI18n() cannot reach.
    if (landingIsOpen()) renderLanding();
    // Only matters while the dialog is open — its fields are built at open time.
    if (!document.getElementById('reportDialog').classList.contains('hidden')) renderReportDialog();
    if (shareDialogOpen()) renderShareDialog();
    document.getElementById('binderReportBtn').innerHTML = `📋 ${t('Binder report')}`;
    document.getElementById('binderLinkBtn').innerHTML = `🔗 ${t('Copy binder link')}`;
    setMapInk(state.settings.mapInk);   // its title
    renderLibrary();
    renderDocBar();
    updateUndoButtons();
    applyProfile();
    // The findings speak the locale now, and nothing above regenerates them:
    // renderCanvasOnly() ends in validateTopology(), which redraws the alert
    // list, and the selection panel needs its own nudge. Skipped on an empty
    // canvas, which is the state applyLocale() sees during boot.
    if (state.nodes.length) { renderCanvasOnly(); refreshSelectedNodeDiagnostics(); }
    // The selected device's grey hints ("10.0.1.1 · from Office LAN") are
    // sentences too, written when it was selected.
    const sel = state.selectedType === 'node' && getNode(state.selectedId);
    if (sel) { refreshInheritance(sel); document.getElementById('propOs').placeholder = fieldHints(sel).os; renderAssetFields(sel); }
    renderNetworksPanel(true);   // its counts and buttons are built, not marked up
    renderGroupsPanel(true);     // so are the Groups tab's
    renderWifiPanel(true);       // and the Wi-Fi tab's
    renderTableView(true);       // so are the table's headers and counts
    renderBulkPanel(true);       // and the bulk panel's field rows
}
// ---- Mode picker ----
// The one place modes are switched — there is deliberately no header toggle.
// Opened by the "Something missing? Try another mode" button below the
// palette in the reduced views, and from the How to use dialog in the full
// editor, where that button is hidden. Two steps: 'main' offers Simple / Full editor / Setup wizard, and
// picking Simple re-renders the same modal as 'purpose' — the simple
// purposes (General, Imagenology, …), one per PROFILES entry.
function openModePicker(step = 'main') {
    document.getElementById('modePickerTitle').textContent =
        step === 'purpose' ? t('What are you documenting?') : t('Choose a mode');
    const list = document.getElementById('modePickerList');
    list.innerHTML = '';
    const addOption = (icon, label, blurb, pick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mode-option';
        b.innerHTML = `<span class="mo-icon">${icon}</span>
            <span><b>${escapeHtml(label)}</b>
            <span class="mo-blurb">${escapeHtml(blurb)}</span></span>`;
        b.onclick = pick;
        list.appendChild(b);
    };
    if (step === 'purpose') {
        Object.keys(PROFILES).forEach((k) => {
            const p = PROFILES[k];
            addOption(p.icon, t(p.label), t(p.blurb), () => {
                closeModePicker();
                state.settings.profile = k; state.settings.advanced = false; saveSettings(); applyProfile();
            });
        });
    } else {
        addOption('🙂', t('Simple'), t('A simpler view for non-technical people — pick your purpose next'), () => {
            openModePicker('purpose');
        });
        addOption('🛠️', t('Full editor'), t('Every device and technical detail — IPs, zones, diagnostics'), () => {
            closeModePicker();
            state.settings.advanced = true; saveSettings(); applyProfile();
        });
        addOption('✨', t('Setup wizard'), t('Start over: count what you have and the network draws itself'), () => {
            closeModePicker();
            openAddDevices({ mode: 'new' });
        });
    }
    document.getElementById('modePicker').classList.remove('hidden');
}
function closeModePicker() { document.getElementById('modePicker').classList.add('hidden'); }
document.getElementById('modeSwitchBtn').onclick = () => openModePicker();
document.getElementById('modePicker').onclick = (e) => {
    if (e.target.id === 'modePicker') closeModePicker(); // click the backdrop to dismiss
};

// The setup wizard is the Add devices dialog now (openAddDevices in
// js/add.js): the same tiles, typeable counts with no cap, a name pattern,
// and the switch or AP to connect them to.

function libraryItem({ icon, name, blurb }, onPick, onDelete) {
    const row = document.createElement('div');
    row.className = 'lib-item';
    const btn = document.createElement('button');
    btn.className = 'lib-item-open';
    btn.innerHTML = `<span class="lib-item-icon">${icon}</span><span style="min-width:0"><span class="lib-item-name">${escapeHtml(name)}</span><span class="lib-item-blurb">${escapeHtml(blurb)}</span></span>`;
    btn.onclick = onPick;
    row.appendChild(btn);
    if (onDelete) {
        const del = document.createElement('button');
        del.className = 'lib-item-del shrink-0'; del.textContent = '✖'; del.title = t('Delete "{name}"', { name });
        del.onclick = (e) => { e.stopPropagation(); onDelete(); };
        row.appendChild(del);
    }
    return row;
}

// Not kept: a template is a starting point, and what is drawn from it is kept
// with Keep this network, under a name of its own. A kept network on the
// canvas is already saved, so only an unkept one is asked about.
async function applyTemplate(template) {
    if (!template) return false;
    if (!(await okToReplace(t('Replace current workspace with this network?')))) return false;
    // A template is a different document, so the card the canvas came from is
    // not this one — replaceDocument() drops it, or autosave would overwrite
    // that card with the template, silently and with no prompt.
    replaceDocument(template, { origin: 'template' });
    return true;
}

function renderLibrary() {
    const tplList = document.getElementById('templateList');
    const exampleList = document.getElementById('exampleTemplateList');
    tplList.innerHTML = ''; exampleList.innerHTML = '';
    TEMPLATE_META.forEach((meta) => {
        if (!templatesData[meta.key]) return; // meta without data would render a dead row
        // The catalogue is chrome (the Examples tab of the simple view); Blocks
        // below are Advanced vocabulary and keep their English names.
        (meta.example ? exampleList : tplList).appendChild(libraryItem({ ...meta, name: t(meta.name), blurb: t(meta.blurb) }, () => applyTemplate(templatesData[meta.key])));
    });

    // js/library.js: the saved templates are library cards, and so are your
    // own blocks; renderUserTemplates() redraws the Blocks tab (js/add.js) too.
    renderUserTemplates();
}

document.getElementById('tidyBtn').onclick = tidyLayout;
document.getElementById('saveTemplateBtn').onclick = saveAsTemplate;
document.getElementById('undoBtn').onclick = undo;
document.getElementById('redoBtn').onclick = redo;

// Drag a palette item and drop it onto the canvas at the cursor
(function () {
    const cc = document.getElementById('canvasContainer');
    cc.addEventListener('dragover', (e) => { const t = [...e.dataTransfer.types]; if (t.includes('text/carino-node') || t.includes('text/carino-annotation')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    cc.addEventListener('drop', (e) => {
        const annStyle = e.dataTransfer.getData('text/carino-annotation');
        if (annStyle) { e.preventDefault(); spawnAnnotation({ at: getWorkspacePoint(e.clientX, e.clientY), style: annStyle, edit: true }); return; }
        const type = e.dataTransfer.getData('text/carino-node'); if (!type) return;
        e.preventDefault(); spawnNode(type, { at: getWorkspacePoint(e.clientX, e.clientY) });
    });
})();

// Double-click on empty canvas: drop a text note right there, editor open.
document.getElementById('networkCanvas').addEventListener('dblclick', (event) => {
    if (event.target.id !== 'networkCanvas') return;
    // The first click opened a collapsed group and its node went: the second
    // landed where it was, and is not a double-click on empty canvas.
    if (groupTapJustExpanded()) return;
    spawnAnnotation({ at: getWorkspacePoint(event.clientX, event.clientY), text: '', edit: true });
});

const propertyBindings = [
    { key: 'name', id: 'propName' },
    { key: 'gw', id: 'propGw' },
    { key: 'dns', id: 'propDns' },
    { key: 'os', id: 'propOs' },
    { key: 'ports', id: 'propPorts' },
    { key: 'notes', id: 'propNotes' }
];

propertyBindings.forEach((binding) => {
    document.getElementById(binding.id).addEventListener('input', (event) => {
        if (!state.selectedId || state.selectedType !== 'node') return;

        const node = getNode(state.selectedId);
        if (!node) return;

        node[binding.key] = event.target.value;

        saveTyping();         // the label follows each keystroke; the undo step waits for the field to be left
        renderCanvasOnly();
        renderNodeDiagnostics(node);
    });
});

// Opens the hardware-address line under every interface on this node. A
// node-level toggle rather than a per-row button because the interface row has
// no width left to give — see renderMacLine.
document.getElementById('addMacBtn').onclick = () => {
    if (!state.selectedId || state.selectedType !== 'node') return;
    const node = getNode(state.selectedId); if (!node) return;
    node.macOpen = !node.macOpen;
    renderSidebarData(node); save();
};
document.getElementById('addIfaceBtn').onclick = () => { if (!state.selectedId || state.selectedType !== 'node') return; const node = getNode(state.selectedId); if (!node) return; createIfaceFor(node); renderSidebarData(node); save();
renderCanvasOnly();
renderNodeDiagnostics(node); };
document.getElementById('bondIfaceBtn').onclick = () => {
    if (!state.selectedId || state.selectedType !== 'node') return;
    const node = getNode(state.selectedId); if (!node) return;
    if (!createBond(node)) return;
    renderSidebarData(node); save(); renderCanvasOnly(); renderNodeDiagnostics(node);
};
document.getElementById('deleteElementBtn').onclick = deleteSelected;
// For a set of devices the bulk panel applies to, Delete Selected shows what
// goes (and what the findings become) first; the Delete key does not ask.
document.getElementById('deleteSelectionBtn').onclick = deleteSelectionAsked;
document.getElementById('selOnlyNodesBtn').onclick = () => selectOnly('node');
document.getElementById('selOnlyLinksBtn').onclick = () => selectOnly('link');
document.getElementById('zoomInBtn').onclick = () => { state.camera.zoom = Math.min(5, state.camera.zoom * 1.2); applyCamera(); };
document.getElementById('zoomOutBtn').onclick = () => { state.camera.zoom = Math.max(0.2, state.camera.zoom / 1.2); applyCamera(); };
document.getElementById('zoomResetBtn').onclick = () => { state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 1; applyCamera(); };
// The dark map (css/app.css .map-ink): black on Carino, a blueprint on
// Colourful. A preference of this browser, like the view; the drawing and
// its exports are unchanged.
function setMapInk(on) {
    state.settings.mapInk = !!on;
    document.getElementById('canvasContainer').classList.toggle('map-ink', !!on);
    const btn = document.getElementById('mapInkBtn');
    btn.setAttribute('aria-pressed', String(!!on));
    btn.title = on ? t('Light background') : t('Dark background');
    btn.setAttribute('aria-label', btn.title);
}
document.getElementById('mapInkBtn').onclick = () => { setMapInk(!state.settings.mapInk); saveSettings(); };
// New network, in the File menu, replaced the toolbar's Clear. Clear emptied
// the nodes and cables and nothing else — the card stayed attached (so the
// next Save overwrote the saved network with nothing), and the notes, the
// report header and the undo history of the old network stayed with the new
// one. A new network is a new document, kept from the start, and not an undo
// step. The one on screen is asked about only when closing it would lose it:
// a kept one has just been saved.
async function newNetwork() {
    if (!(await okToReplace(t('Start a new, empty network? The one on screen is not kept in this browser, so it will be closed.')))) return false;
    replaceDocument(EMPTY_DOC, { origin: 'new', claim: true });
    return true;
}
document.getElementById('newNetworkBtn').onclick = newNetwork;
// Copy link is the share path. It no longer writes the link into the address
// bar: the bar stays bare so the network is not in this browser's history, and
// the link exists only on the clipboard. The dialog offers a passphrase first
// (js/share.js) — sealed is the default, plain is a deliberate choice.
document.getElementById('copyUrlBtn').onclick = () => { save(); openShareDialog('doc'); };

// The trace controls in the Diagnostics tab write state.settings and are
// redrawn from it; nothing reads them back (see setTraceMode).
function syncTraceControls() {
    const box = document.getElementById('toggleTrace');
    const portBox = document.getElementById('tracePortToggle');
    const port = document.getElementById('tracePort');
    if (box) box.checked = !!state.settings.traceMode;
    if (portBox) portBox.checked = !!state.settings.tracePortOn;
    // Only when it differs: rewriting a field the user is typing into moves the caret.
    if (port && port.value !== (state.settings.tracePort || '')) port.value = state.settings.tracePort || '';
    updateTracePortUi();
}
document.getElementById('toggleTrace').addEventListener('change', (event) => setTraceMode(event.target.checked));
// Dim the port field when a port is typed but the filter is switched off, so the
// "typed but ignored" state is visible rather than a silent no-op.
function updateTracePortUi() {
    const port = document.getElementById('tracePort');
    if (!port) return;
    const suspended = !state.settings.tracePortOn && String(state.settings.tracePort || '').trim() !== '';
    port.classList.toggle('suspended', suspended);
    port.title = suspended
        ? 'Port filter is off — this port is ignored. Toggle Port filter on to apply it.'
        : 'Port to test when the Port filter is on';
}
function onTraceControlsChanged() {
    updateTracePortUi();
    if (state.settings.traceMode) renderCanvasOnly();
    refreshSelectedNodeDiagnostics();
}
document.getElementById('tracePort').addEventListener('input', (event) => {
    // Typing a port arms the filter; emptying it disarms. The toggle then only
    // suspends/resumes, so you never lose what you typed.
    state.settings.tracePort = event.target.value;
    state.settings.tracePortOn = event.target.value.trim() !== '';
    document.getElementById('tracePortToggle').checked = state.settings.tracePortOn;
    onTraceControlsChanged();
});
document.getElementById('tracePortToggle').addEventListener('change', (event) => {
    state.settings.tracePortOn = event.target.checked;
    onTraceControlsChanged();
});

// Encode a canvas to the requested image type, but name the file for what the
// canvas ACTUALLY produced. Safari gained canvas WebP only in v17 (2023); older
// WebKit silently hands back a PNG data URL for an unsupported type, so a naive
// "webp" export would save a PNG under a .webp name that some tools then refuse.
// Trust the returned MIME, not the request.
function encodeCanvas(canvas, requested) {
    const url = canvas.toDataURL(`image/${requested}`);
    const got = /^data:image\/([a-z0-9.+-]+)/i.exec(url);
    const actual = got ? got[1].toLowerCase() : 'png';
    return { url, ext: actual === 'jpeg' ? 'jpg' : actual };
}

// ---- Portable build files (.nettopo) ----
// The escape hatch for builds too big or too archival for a URL: a file has no
// length ceiling, travels as an email/chat attachment, and diffs in git. Same
// serializer as everything else, wrapped in a tiny self-identifying envelope so
// the file can be recognised and can carry a schema version later.
function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

// `version` is the envelope's own format and stays 1; the document's schema
// version is `doc.v` (DOC_VERSION), which is what an importer migrates from.
//
// This is the network's back-up: the file carries its identity (identifiedDoc)
// and its card's name, so importing it again updates that card instead of
// adding a second one, and exporting it counts as backing that card up on the
// landing, as the binder does for all of them. A read-only document goes out
// exactly as it arrived (outgoingDoc), identity and all.
function exportJsonFile() {
    if (!state.nodes.length) { showToast(t('Nothing to export. Add at least one node first.')); return; }
    const doc = state.readOnly ? outgoingDoc() : identifiedDoc(serializeDoc());
    const name = docDisplayName();
    downloadJson(Object.assign({ kind: 'nettopology', version: 1 }, name ? { name } : {}, { doc }), `${docFileStem()}.nettopo.json`);
    // Backed up: the landing stops counting it as changed, and what went into
    // the file is the card's new baseline for "changes since" (js/changes.js).
    if (isKept()) { recordBuildExport(state.libraryId, doc.updated); takeSnapshot(state.libraryId, 'backup', doc); }
    if (landingIsOpen()) renderLanding();
}

// Accept both the enveloped file we write and a bare { nodes, links } — the same
// shape a decoded share URL holds — so a build is importable however it was saved.
function docFromImported(parsed) {
    if (parsed && parsed.doc && Array.isArray(parsed.doc.nodes)) return parsed.doc;
    if (parsed && Array.isArray(parsed.nodes)) return parsed;
    return null;
}

// Load a parsed build object onto the canvas. Split from the file reading so the
// swap logic is testable without a FileReader in the way. Resolves to whether
// it took. opts.fileName names the card when the file itself does not.
//
// A file is kept: opening one is choosing to work on it here. And a build file
// is a binder of one site, so it goes through the binder's merge: a file whose
// network is already a card here (your own back-up, or a colleague's edit of
// a network you sent) is offered as an update to that card, newer-wins, or as
// a copy — never silently as a second card, which is what re-importing used
// to do.
async function applyImportedDoc(parsed, opts = {}) {
    // A binder is a library, not a document — it merges into the saved networks
    // and leaves the canvas alone. Checked first because a binder also has a
    // `sites` array full of things that look like documents, and because this
    // is the one door: the drop zone, "Open a file" and the File menu's
    // "Open a file…" all arrive here, and the file itself says which it is.
    if (applyImportedBinder(parsed)) return true;
    const doc = docFromImported(parsed);
    if (!doc) { showToast(t('That file does not look like a Topo build or binder.'), 'err'); return false; }
    const ident = docIdentity(doc);
    const known = ident.id ? libraryEntry(ident.id) : null;
    const newer = migrateDoc(doc).newer;
    // Asked first, about the network on screen: everything below replaces it.
    if (!(await okToReplace(t('Replace the current canvas with this build?')))) return false;
    if (newer) {
        // From a newer Topo: opened read-only and not stored, as everywhere
        // else (outgoingDoc). The file is still the copy to keep.
        replaceDocument(doc, { origin: 'file' });
    } else if (known) {
        const choice = await askAboutKnownCopy({ doc, updated: ident.updated }, known, { title: t('Open a file') });
        if (!choice) return false;
        if (choice === 'update') {
            // The card stays what it was: a template's file brought back
            // updates the template, it does not turn it into a network.
            const result = importBinderSites([Object.assign({ id: known.id, name: known.name, created: known.created, updated: ident.updated, doc: stripIdentity(doc) },
                known.template ? { template: true } : {}, known.block ? { block: true } : {})]);
            if (!result) { showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err'); return false; }
        }
        if (choice === 'copy') openImportedAsNewCard(doc, t('{name} (copy)', { name: known.name }), null);
        else replaceDocument(libraryEntry(known.id).doc, { libraryId: known.id, origin: 'library' });
    } else {
        const named = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : '';
        const fromFile = String(opts.fileName || '').replace(/(\.nettopo)?(\.json)?$/i, '').trim();
        if (!openImportedAsNewCard(doc, named || fromFile, ident.id, ident.updated, !named)) return false;
    }
    // "Open a file" is one of the landing's four doors, and the file reader
    // resolves long after the click — so the landing steps aside here, where
    // the document is known to have loaded, rather than optimistically there.
    if (landingIsOpen()) landingHandledDocument();
    return true;
}

// A file's network as a new card (under the id it carries, when it has one),
// opened and kept. Stored as the file holds it, like a binder site, and
// rewritten by the serializer with the first edit.
function openImportedAsNewCard(doc, name, id, updated, nameAuto = false) {
    const site = (doc.report && typeof doc.report.site === 'string' && doc.report.site.trim()) || '';
    const result = importBinderSites([{ id: id || mintLibraryId(), name: name || site, updated: updated || Date.now(), doc: stripIdentity(doc) }]);
    if (!result || !result.storedIds.length) {
        // Not stored: still opened, as it always was, but not kept.
        showToast(t('Could not save — browser storage is unavailable (private mode or full).'), 'err');
        replaceDocument(doc, { origin: 'file' });
        return true;
    }
    const key = result.storedIds[0];
    if (nameAuto && !name) {
        const lib = loadLibrary();
        if (lib[key]) { lib[key].nameAuto = true; persistLibrary(lib); }
    }
    replaceDocument(libraryEntry(key).doc, { libraryId: key, origin: 'file' });
    return true;
}

function importJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        let parsed;
        try { parsed = JSON.parse(reader.result); } catch (e) { showToast(t('That file is not valid JSON.'), 'err'); return; }
        applyImportedDoc(parsed, { fileName: file.name });
    };
    reader.onerror = () => showToast(t('Could not read that file.'), 'err');
    reader.readAsText(file);
}

// Rasterise the canvas to a data URL, cropped to the drawing plus padding.
// Split from handleExport so the site report can embed the same picture the
// export menu saves — one code path, so the diagram in the report cannot drift
// from the diagram in the PNG. Resolves to null when there is nothing to draw.
// `scale` exists for the binder report, which rasterises every site in the
// binder in one go: at the export's 4x a twelve-site estate is a lot of canvas
// for pictures that are printed two to a page. Omitted everywhere else, so the
// PNG export and the single-site report are byte-for-byte what they were.
function captureCanvasImage(format, scale) {
    const SCALE = Number.isFinite(scale) && scale > 0 ? scale : 4;
    const drawn = canvasSvgMarkup(SCALE);
    if (!drawn) return Promise.resolve(null);
    const { minX, minY, width: exportWidth, height: exportHeight } = drawn;
    const url = URL.createObjectURL(new Blob([drawn.markup], { type: 'image/svg+xml;charset=utf-8' })), img = new Image();

    return new Promise((resolve, reject) => {
        img.onload = () => {
            const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
            canvas.width = exportWidth * SCALE; canvas.height = exportHeight * SCALE;
            ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#f8fafc'; ctx.scale(SCALE, SCALE);
            for (let x = ((-minX) % GRID_SNAP + GRID_SNAP) % GRID_SNAP; x < exportWidth; x += GRID_SNAP) {
                for (let y = ((-minY) % GRID_SNAP + GRID_SNAP) % GRID_SNAP; y < exportHeight; y += GRID_SNAP) {
                    ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
                }
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(img, 0, 0, exportWidth * SCALE, exportHeight * SCALE);
            const out = encodeCanvas(canvas, format);
            URL.revokeObjectURL(url);
            resolve({ url: out.url, ext: out.ext, width: canvas.width, height: canvas.height });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not rasterise the canvas.')); };
        img.src = url;
    });
}

// The drawing as a standalone SVG document, cropped to the drawing plus
// padding: what the PNG/WEBP export rasterises and what the SVG export saves,
// so the two cannot disagree. -> { markup, minX, minY, width, height } in
// drawing units, the markup sized `scale` times that, or null when there is
// nothing to draw.
//
// Built from a detached copy of the canvas. It used to re-point the live
// canvas (its transform, size and viewBox), serialize it and put the camera
// back, so a throw in between left the map cropped and zoomed to the export,
// and every export cost a redraw. The copy is never in the page: the map is
// not touched, and nothing needs putting back.
//
// The drawing only. The ✕ on a selected device or cable is a control of the
// editor, not part of the network, so it is left out of the picture.
function canvasSvgMarkup(scale = 1) {
    if (!state.nodes.length) return null;
    const PADDING = 90, NODE_HALF_SIZE = 24, LABEL_EXTRA_BOTTOM = 42;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // Where each device is drawn: a device folded into a collapsed group is
    // not drawn at its own x and y but at its group's node (mapPointsOf,
    // js/groupmap.js), so a group spread wide does not leave empty margin.
    mapPointsOf(state.nodes).forEach((node) => {
        minX = Math.min(minX, node.x - NODE_HALF_SIZE); minY = Math.min(minY, node.y - NODE_HALF_SIZE);
        maxX = Math.max(maxX, node.x + NODE_HALF_SIZE); maxY = Math.max(maxY, node.y + NODE_HALF_SIZE + LABEL_EXTRA_BOTTOM);
    });
    // Text notes count toward the bounds too — measure the rendered group so a
    // note sitting outside the node cluster is not cropped out of the export.
    state.annotations.forEach((a) => {
        const el = document.getElementById(`ui-ann-${a.id}`);
        const bb = el ? el.getBBox() : { width: 120, height: 30 };
        minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
        maxX = Math.max(maxX, a.x + bb.width); maxY = Math.max(maxY, a.y + bb.height);
    });
    // So do the group frames (js/groupmap.js): nested ones reach well above
    // the devices, and the padding alone cut off the outermost tab.
    const frames = groupFrameBounds();
    if (frames) {
        minX = Math.min(minX, frames.minX); minY = Math.min(minY, frames.minY);
        maxX = Math.max(maxX, frames.maxX); maxY = Math.max(maxY, frames.maxY);
    }

    minX -= PADDING; minY -= PADDING; maxX += PADDING; maxY += PADDING;
    const exportWidth = Math.max(1, Math.ceil(maxX - minX)), exportHeight = Math.max(1, Math.ceil(maxY - minY));

    const svg = document.getElementById('networkCanvas').cloneNode(true);
    svg.querySelector('#workspace').setAttribute('transform', `translate(${-minX}, ${-minY}) scale(1)`);
    svg.setAttribute('width', exportWidth * scale); svg.setAttribute('height', exportHeight * scale); svg.setAttribute('viewBox', `0 0 ${exportWidth} ${exportHeight}`);
    // A group's ▾ and a collapsed rack's Open rack (js/groupmap.js) are
    // controls too; its frame and tab are drawing. So is a host badge's
    // chevron and tap target; its count of guests is drawing.
    svg.querySelectorAll('.node-delete, .grp-toggle, .grp-rack-open, .host-fold-chev, .host-badge > .grp-toggle-hit').forEach((el) => el.remove());
    // With the ▾ gone, its seat at the tab's left end would be an empty gap.
    svg.querySelectorAll('.grp-frame .grp-tab').forEach((tab) => {
        const pill = tab.querySelector('.grp-tab-pill'), icon = tab.querySelector('.grp-tab-icon'), text = tab.querySelector('.grp-tab-text');
        if (!pill || !icon || !text) return;
        pill.setAttribute('width', String(Math.max(20, Number(pill.getAttribute('width')) - GM_TAB_TOGGLE_W)));
        icon.setAttribute('transform', 'translate(8, -6)');
        text.setAttribute('x', '24');
    });

    let markup = new XMLSerializer().serializeToString(svg);
    if (!markup.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) markup = markup.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    return { markup, minX, minY, width: exportWidth, height: exportHeight };
}

// Vector export (plan, "Vector SVG export"): the same drawing the PNG holds,
// as an SVG file that stays sharp at any size and opens in a drawing tool or
// a browser. It is the drawing with its own background (the PNG paints one
// under it; an SVG would otherwise be transparent), its own size in pixels
// at 1:1, and the site's name as its title. Nothing in it points outside the
// file: the glyphs are inline and the fonts are generic families.
function canvasSvgFile() {
    const drawn = canvasSvgMarkup(1);
    if (!drawn) return null;
    const doc = new DOMParser().parseFromString(drawn.markup, 'image/svg+xml');
    const root = doc.documentElement;
    const NS = 'http://www.w3.org/2000/svg';
    const bg = doc.createElementNS(NS, 'rect');
    bg.setAttribute('width', String(drawn.width)); bg.setAttribute('height', String(drawn.height));
    bg.setAttribute('fill', '#f8fafc');
    root.insertBefore(bg, root.firstChild);
    const name = docDisplayName();
    if (name) {
        const title = doc.createElementNS(NS, 'title');
        title.textContent = name;
        root.insertBefore(title, root.firstChild);
    }
    // The class only styles the live map (css/app.css); the file has no stylesheet.
    root.removeAttribute('class');
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}\n`;
}

function exportSvgFile() {
    if (!state.nodes.length) { showToast(t('Nothing to export. Add at least one node first.')); return; }
    let markup;
    try { markup = canvasSvgFile(); } catch (e) { console.warn('Could not build the SVG:', e); }
    if (!markup) { showToast(t('Could not export image.'), 'err'); return; }
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${docFileStem()}.svg`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function handleExport(format) {
    if (!state.nodes.length) { showToast(t('Nothing to export. Add at least one node first.')); return; }
    captureCanvasImage(format).then((out) => {
        const a = document.createElement('a'); a.href = out.url; a.download = `${docFileStem()}.${out.ext}`; a.click();
    }).catch(() => showToast(t('Could not export image.'), 'err'));
}

document.getElementById('exportPngBtn').onclick = () => handleExport('png');
document.getElementById('exportWebpBtn').onclick = () => handleExport('webp');
document.getElementById('exportSvgBtn').onclick = exportSvgFile;
document.getElementById('exportJsonBtn').onclick = exportJsonFile;
document.getElementById('importFileBtn').onclick = () => document.getElementById('importFileInput').click();

// ---- Landing ----
// js/library.js owns the store, the cards and the overlay; this is the wiring,
// kept beside the export menu because the same two doors (a file, a saved
// network) are reachable from both.
document.getElementById('myNetworksBtn').onclick = () => openLanding(false);
document.getElementById('binderExportBtn').onclick = exportBinder;
// js/report.js owns the dialog and the document; this is only the wiring.
document.getElementById('binderReportBtn').onclick = openBinderReportDialog;
document.getElementById('binderLinkBtn').onclick = copyBinderLink;
document.getElementById('guestKeepAllBtn').onclick = () => keepGuestSites(guestSites());
document.getElementById('guestDismissBtn').onclick = dismissGuestBinder;
document.getElementById('binderRebindBtn').onclick = rebindBinderFile;
document.getElementById('saveNetworkBtn').onclick = keepThisNetwork;
// The bar on the canvas (renderDocBar in js/library.js) and the storage banner.
document.getElementById('docBarKeep').onclick = keepThisNetwork;
document.getElementById('docBarName').onclick = renameOpenNetwork;
document.getElementById('storageBackupBtn').onclick = exportJsonFile;
document.getElementById('storageBackupAllBtn').onclick = exportBinder;
document.getElementById('landingNewBtn').onclick = (e) => { e.stopPropagation(); startNewNetwork(); };
document.getElementById('landingOpenFileBtn').onclick = (e) => { e.stopPropagation(); document.getElementById('importFileInput').click(); };
document.getElementById('landingAddBtn').onclick = () => {
    // The dialog sits a layer below the landing, so the landing has to leave
    // first — and it leaves as a dismissal, since nothing has been built yet
    // and "Start empty" is one of the dialog's answers.
    closeLanding();
    openAddDevices({ mode: 'new' });
};
document.getElementById('landingExampleBtn').onclick = () => {
    const prof = PROFILES[state.settings.profile];
    replaceDocument(templatesData[(prof && prof.template) || 'house'] || templatesData.house, { origin: 'template' });
    landingHandledDocument();
};

// The drop zone. A build file arriving from a colleague is the same act as
// opening one, so it lands in the same box, and clicking the box's background
// opens the picker — a convenience for the mouse, never the only way in (the
// buttons inside stop propagation so they do not also trigger it).
//
// dragover must preventDefault or the browser navigates away to the dropped
// file, which loses the page. The counter is because dragenter/dragleave fire
// for every child element the pointer crosses: without it the border flickers
// off the moment the cursor passes over the heading.
(function () {
    const zone = document.getElementById('landingDrop');
    let depth = 0;
    const paint = (on) => zone.classList.toggle('drag', on);
    zone.onclick = () => document.getElementById('importFileInput').click();
    zone.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; paint(true); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) paint(false); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault(); depth = 0; paint(false);
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) importJsonFile(file);   // owns the parse, the alerts and the swap
    });
})();

// ---- Site report ----
// The one export that is a document rather than a copy of the drawing, so it
// asks who it is for first. js/report.js owns the fields, the model and the
// layout; this is only the wiring.
document.getElementById('reportBtn').onclick = () => {
    if (!state.nodes.length) { showToast(t('Nothing to report on yet. Add at least one device first.')); return; }
    openReportDialog();
};
document.getElementById('reportCancelBtn').onclick = () => closeReportDialog();
document.getElementById('reportDialog').onclick = (e) => {
    if (e.target.id === 'reportDialog') closeReportDialog(); // click the backdrop to dismiss
};
document.getElementById('reportBuildBtn').onclick = async () => {
    const btn = document.getElementById('reportBuildBtn');
    // The binder path reads the form and stops there: the estate header belongs
    // to this one document, and writing it into state.report would stamp it on
    // whatever network happens to be open behind the landing.
    const binder = reportMode() === 'binder';
    const meta = binder ? readReportFields() : commitReportMeta();
    const images = binder ? document.getElementById('reportImages').checked : false;
    const parts = readReportParts();
    closeReportDialog();
    btn.disabled = true;
    try { await (binder ? generateBinderReport(meta, { images, parts }) : generateSiteReport(meta, parts)); }
    catch (err) { console.warn('Could not build the report:', err); showToast(t('Could not build the report.'), 'err'); }
    finally { btn.disabled = false; }
};

// The File menu's opening and closing is carino-ui.js's (shared .cs-menu);
// its items keep the handlers wired above.
document.getElementById('importFileInput').onchange = (event) => {
    const file = event.target.files[0];
    if (file) importJsonFile(file);
    event.target.value = ''; // let the same file be re-picked
};

// Browser back/forward swaps the document wholesale (a shared URL, say), so the
// edit timeline for the old document no longer applies — start a fresh one.
// initHistory() only when the document actually changed. The binder branch
// deliberately leaves the canvas alone, and resetting the timeline for a
// document still being edited threw away every undo step with nothing to show
// for it.
window.addEventListener('popstate', async () => {
    parkPendingSaves();   // they were for the entry that was just left
    unparkLiveDoc();      // and this one may have had its own parked on the way out
    const before = JSON.stringify(serializeDoc());
    await load(); renderCanvasOnly();
    if (JSON.stringify(serializeDoc()) !== before) { fitToView(); initHistory(); }
    applyArrivalFocus();   // an '#asset/<tag>' typed over the page: centre on it after the fit
});

// The pill on the map counts the open findings and opens their tab
// (js/diagnostics.js, "The Findings tab").
document.getElementById('conflictPill').onclick = () => openFindingsTab();

document.getElementById('helpBtn').onclick = () => toggleShortcutHelp();
document.getElementById('shortcutClose').onclick = () => toggleShortcutHelp(false);
document.getElementById('shortcutHelp').onclick = (e) => {
    if (e.target.id === 'shortcutHelp') toggleShortcutHelp(false); // click the backdrop to dismiss
};

// The Networks tab's own lists. Its saved templates are library cards, which
// are not readable until boot has opened the store below; they are drawn
// again then.
renderLibrary();
renderShortcutHelp();
loadSettings();
setMapInk(state.settings.mapInk);
// '?profile=<name>' (or the legacy '?simple') also selects a home profile —
// unlike the '#<profile>' hash it composes with a shared diagram hash, so one
// link can carry both the network and the profile.
{
    const params = new URLSearchParams(window.location.search);
    const p = PROFILES[params.get('profile')] ? params.get('profile') : (params.has('simple') ? 'simple' : null);
    if (p) { state.settings.profile = p; state.settings.advanced = false; saveSettings(); }
    // A plain visit — no hash, no profile param — always opens the full
    // editor, whatever view was persisted. Reduced views are entered
    // explicitly: '#simple' / '#imagenology' / '?profile=' / the mode picker.
    // A shared link, or a mid-edit reload (the document is in history.state
    // now, not the hash), keeps the persisted view so a refresh never flips a
    // simple-mode user to full.
    else if (!window.location.hash && !liveEntry()) state.settings.advanced = true;
    // Locale: '?lang=' (persisted — intake links hand a Spanish clinic a
    // Spanish wizard) > saved choice > browser language > English.
    const urlLang = resolveLocale(params.get('lang'));
    if (urlLang) { state.settings.lang = urlLang; saveSettings(); }
    setLocale(state.settings.lang || resolveLocale(navigator.language) || 'en');
}
applyLocale();
showLibraryTab(state.settings.libraryTab || 'nodes');
// Boot may need to decompress a shared "~" link, so await it before drawing.
(async () => {
    try {
        // Before anything reads the library: the landing's cards, a reload's
        // card (load()), the saved templates. IndexedDB opens asynchronously,
        // and the old store's cards are merged into it on the way (js/library.js).
        await openLibraryStore();
        // The baselines for "changes since the last back-up" (js/changes.js).
        // Not awaited: a card shows its line once they arrive.
        openSnapshotStore();
        // Saved templates from before they were cards have to be in it.
        migrateUserTemplates();
        renderUserTemplates();
        // Before load(), because a refresh of a binder link has to find its
        // shelf already in hand — openBinderLink() only runs for the hash that
        // carried it, and a plain reload of a doc hash must still show it.
        restoreGuestBinder();
        await load(); renderCanvasOnly(); fitToView();
        applyArrivalFocus(); // '#asset/<tag>': the device it found, centred once the map is fitted
        initHistory(); // the loaded document is the floor of the undo timeline, not a step
        syncTraceControls();
    } finally {
        // Boot has decided: either the landing is up and keeps the chrome hidden
        // on its own, or this is the editor and its controls belong on screen.
        // In a finally because a half-booted editor is still usable, while an
        // invisible one is not.
        document.body.classList.remove('chrome-pending');
        // For anything that has to wait for boot to have decided — the test
        // runners start their suites on it (tests/run.sh).
        window.dispatchEvent(new Event('topo:ready'));
    }
})();

// "Saved · 3m ago" ages while the page sits open. Twice a minute is as fine
// as the wording gets, and nothing is read unless a kept network is open.
setInterval(() => { if (isKept() && !landingIsOpen()) renderDocBar(); }, 30000);

// ---- Fleet language switcher (carino-lang.js) ----
// The bridge lives in js/i18n.js, which owns the dictionary and the locale: it
// listens for 'carino:langchange', switches the dictionary, then calls
// applyLocale(lang) below to re-render and persist the choice.
