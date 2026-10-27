// Reachability and the checks behind the node badges.
// Load order: state -> model -> data -> diagnostics -> ui -> app

// The port the trace is actually filtering by. A port only applies when it is
// both typed in AND its toggle is on, so a user can suspend port filtering
// without clearing the port they entered. Blank string means "IP reachability
// only" — every reader below already treats that as no filter. Read from
// state.settings, not from the controls in the Diagnostics tab: those only
// mirror it, and a walk that read the page could not run off-screen.
const typedTracePort = () => String(state.settings.tracePort || '').trim();
function activeTracePort() {
    if (!state.settings.tracePortOn) return '';
    return typedTracePort();
}

// Plain IP reachability, whatever the trace port says. It used to blank the
// tracePort input, walk, and put the value back, which tied every gateway and
// DNS verdict to a DOM field and made the checks impossible to run on a
// document that is not on screen. The port is now an argument instead.
function calculateBaseReachability(startNodeId) {
    return calculateReachability(startNodeId, { port: '' });
}

// One findings pass asks "can A reach B?" for every device, and most devices
// ask about the same gateway. This holds the walks for one pass so each is
// done once, plus the address and MAC indexes the gateway, DNS and MAC checks
// share. A context is only valid while the document does not change, and the
// engine (diagnoseDoc) makes a fresh one per pass.
//
// The walk from an ordinary host (not a switch, not a router) is composed
// rather than repeated: its first step reaches what shares a subnet with it,
// and every step after that starts from a router it handed on, the same
// router and subnet for every host behind it. Those continuations are walked
// once and shared. The union is the set the single walk would have found —
// tests/suites/findings.js compares the two on every device of the templates.
function reachContext() {
    const walks = new Map(), tails = new Map(), parts = new Map();
    let byIp = null, macDupes = null, clouds = null;

    function tail(entry) {
        const key = `${entry.id}\u0000${entry.viaNet}`;
        if (!tails.has(key)) {
            const acc = reachAccumulator([entry.id]);
            reachWalk([entry], acc, null);
            tails.set(key, acc);
        }
        return tails.get(key);
    }

    // The pieces a device's reach is the union of: one walk for a switch or a
    // router, or a host's first step plus the shared walks it hands on to.
    // Asking "is B in it?" of the pieces is cheaper than copying hundreds of
    // shared results into one set per host, which is what made a 500-device
    // pass slow.
    function partsOf(id) {
        if (parts.has(id)) return parts.get(id);
        const start = getNode(id);
        let list;
        if (!start || isDumbDevice(start) || isRoutingDevice(start.type)) {
            list = [calculateReachability(id, { port: '' })];
        } else {
            const acc = reachAccumulator([id]);
            const handedOn = [];
            reachWalk([{ id, viaNet: null }], acc, handedOn);
            list = [acc].concat(handedOn.map(tail));
        }
        parts.set(id, list);
        return list;
    }

    function reaches(sourceId, targetId) {
        return partsOf(sourceId).some((p) => p.reachableNodes.has(targetId));
    }

    // The whole set, for whoever needs to list it (the tests compare it with
    // a single calculateReachability() walk).
    function reach(id) {
        if (walks.has(id)) return walks.get(id);
        const list = partsOf(id);
        let result = list[0];
        if (list.length > 1) {
            result = { reachableNodes: new Set(), reachableLinks: new Set() };
            list.forEach((p) => {
                p.reachableNodes.forEach((n) => result.reachableNodes.add(n));
                p.reachableLinks.forEach((l) => result.reachableLinks.add(l));
            });
        }
        result = { reachableNodes: result.reachableNodes, reachableLinks: result.reachableLinks };
        walks.set(id, result);
        return result;
    }

    return {
        reach,
        reaches,
        reachesCloud(sourceId) {
            if (!clouds) clouds = state.nodes.filter((n) => n.type === 'cloud').map((n) => n.id);
            return clouds.some((c) => reaches(sourceId, c));
        },
        // The node holding the address, as findNodeByIp() answers it (an
        // active holder first, then the first in document order), without
        // scanning every node per question.
        nodeByIp(ipString) {
            if (!byIp) {
                byIp = new Map();
                state.nodes.forEach((n) => getValidIps(n).forEach((p) => {
                    const k = p.ip.toString();
                    const had = byIp.get(k);
                    if (!had || (isRetired(had) && !isRetired(n))) byIp.set(k, n);
                }));
            }
            try { return byIp.get(ipaddr.parse(String(ipString || '').trim()).toString()) || null; } catch (e) { return null; }
        },
        // A retired device is off the network (STATUS_VALUES, js/model.js),
        // so its hardware address no longer shares a segment with anyone.
        macDupes() { return macDupes || (macDupes = duplicateMacs(state.nodes.filter((n) => !isRetired(n)))); }
    };
}

function canReachNode(sourceNode, targetNode, ctx) {
    if (!sourceNode || !targetNode) return false;
    if (sourceNode.id === targetNode.id) return true;

    if (ctx) return ctx.reaches(sourceNode.id, targetNode.id);
    return calculateBaseReachability(sourceNode.id).reachableNodes.has(targetNode.id);
}

function canReachCloud(sourceNode, ctx) {
    if (!sourceNode) return false;

    if (ctx) return ctx.reachesCloud(sourceNode.id);
    const reach = calculateBaseReachability(sourceNode.id);
    return state.nodes.some((node) => node.type === 'cloud' && reach.reachableNodes.has(node.id));
}

function getStatusClasses(level) {
    return level === 'good' || level === 'bad' || level === 'warn' ? level : '';
}

function diagnosticRow(label, level, text) {
    const icon = level === 'good' ? '✅' : level === 'bad' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';

    return `
        <div class="dg-row ${getStatusClasses(level)}">
            <div class="dg-head">
                <span>${escapeHtml(label)}</span>
                <span>${icon}</span>
            </div>
            <div class="dg-text">${escapeHtml(text)}</div>
        </div>
    `;
}

function evaluateInterfaces(node) {
    if (isDumbDevice(node)) {
        return {
            level: 'info',
            text: t('No interfaces assigned. This node is acting as an L2 backplane.')
        };
    }

    if (!node.interfaces || !node.interfaces.length) {
        return {
            level: 'warn',
            text: t('No interfaces configured.')
        };
    }

    const invalid = node.interfaces.filter((iface) => iface.ip && !parseValidCIDR(iface.ip));

    if (invalid.length) {
        return {
            level: 'bad',
            text: t('Invalid CIDR on: {names}', { names: invalid.map((i) => i.name || 'interface').join(', ') })
        };
    }

    const valid = getValidIps(node);

    if (!valid.length) {
        return {
            level: 'warn',
            text: t('Interfaces exist, but none has a valid CIDR IP.')
        };
    }

    return {
        level: 'good',
        text: t(valid.length === 1 ? '{n} valid interface configured.' : '{n} valid interfaces configured.', { n: valid.length })
    };
}

// Two interfaces on one subnet make the Linux weak host model answer ARP for
// both NICs (ARP flux). If they also land in the same broadcast domain, the
// switch sees one MAC on two ports and flaps its CAM table — which is what
// breaks outbound ARP while established TCP sessions keep working.
function evaluateMultiHoming(node) {
    if (isDumbDevice(node)) {
        return { level: 'info', text: t('L2 backplane nodes do not hold IPs to duplicate.') };
    }

    const addressed = getInterfaces(node)
        .map((iface) => ({ iface, parsed: parseValidCIDR(iface.ip) }))
        .filter((entry) => entry.parsed);

    const byNet = new Map();
    addressed.forEach(({ iface, parsed }) => {
        if (!byNet.has(parsed.networkStr)) byNet.set(parsed.networkStr, []);
        byNet.get(parsed.networkStr).push(iface);
    });

    const duplicated = [...byNet.entries()].filter(([, list]) => list.length > 1);
    if (!duplicated.length) {
        return { level: 'good', text: t('Each interface sits on its own subnet.') };
    }

    for (const [networkStr, list] of duplicated) {
        const names = list.map((i) => i.name).join(' + ');
        const segments = list
            .map((iface) => {
                const link = linkOnIface(node.id, iface.id);
                return link ? segmentKeyOf(link, node.id) : null;
            })
            .filter(Boolean);

        const sameSegment = segments.some((seg, idx) => segments.indexOf(seg) !== idx);
        if (sameSegment) {
            return {
                level: 'bad',
                text: t('MAC flapping: {names} both sit on {net} in the same broadcast domain. The switch sees this MAC on two ports and rewrites its CAM table, so new outbound ARP gets dropped while existing TCP sessions survive. Fix: unplug one, set arp_ignore=1 / arp_announce=2, or bond the NICs.', { names, net: networkStr })
            };
        }
    }

    const [networkStr, list] = duplicated[0];
    return {
        level: 'warn',
        text: t('ARP flux: {names} share subnet {net}. The kernel answers ARP for these IPs on both NICs (weak host model). They reach different broadcast domains, so switches will not flap — but set arp_ignore=1 / arp_announce=2 to bind ARP to its own interface.', { names: list.map((i) => i.name).join(' + '), net: networkStr })
    };
}

// Physical plausibility of what is plugged in where.
function evaluatePorts(node) {
    const adjacent = linksAtNode(node.id);
    if (!adjacent.length) {
        return { level: 'info', text: t('No links attached.') };
    }

    const unbound = adjacent.filter((l) => !ifaceIdOn(l, node.id));
    if (unbound.length) {
        return { level: 'warn', text: t('{n} link(s) are not bound to an interface. Select the link and pick a port.', { n: unbound.length }) };
    }

    // A switch port or a host NIC is a physical socket that takes one cable. A
    // router's L3 interface is a subnet gateway, and diagrams routinely hang
    // several hosts off one — the switch is simply not drawn. Only complain
    // about the former.
    const isSocket = (ifaceId) => hasPortGrid(node) ? /^p\d+$/.test(ifaceId) : !isRoutingDevice(node.type);
    const usage = new Map();
    adjacent.forEach((link) => {
        if (!isExclusiveLink(link)) return; // radios, tunnels and bridges share
        const id = ifaceIdOn(link, node.id);
        if (!isSocket(id)) return;
        usage.set(id, (usage.get(id) || 0) + 1);
    });
    const doubled = [...usage.entries()].filter(([, count]) => count > 1);
    if (doubled.length) {
        const names = doubled.map(([id]) => ifaceLabel(node, id)).join(', ');
        return { level: 'bad', text: t('Two cables on one port: {names}. A physical port carries one link.', { names }) };
    }

    // Port overflow comes before the orphan check below, which would otherwise
    // claim it in vaguer words: a cable on port 33 of a 32-port switch is not
    // on "an interface this node no longer has", it is one cable too many for
    // the hardware the count describes. An explicit count is never grown to
    // make room (see DEFAULT_PORT_COUNT in js/model.js), so this is where the
    // extra cable is reported instead of absorbed.
    if (hasPortGrid(node)) {
        const total = portCountOf(node);
        const usedIds = new Set(adjacent.map((l) => ifaceIdOn(l, node.id)).filter((id) => /^p\d+$/.test(id)));
        // More cables than ports. Fewer, but one of them past the faceplate
        // (a count lowered by an older build) is a cable to rebind, and the
        // orphan check says exactly that.
        if (usedIds.size > total) {
            // One key per device rather than a {type} slot: the slot printed
            // the raw type ("switch") into every locale's sentence, and the
            // finding now reaches the reduced profiles, where it must read
            // as the locale's own word.
            const key = node.type === 'ap'
                ? '{used} cables on a {total}-port access point. Raise the port count or add a switch.'
                : '{used} cables on a {total}-port switch. Raise the port count or add a switch.';
            return { level: 'bad', text: t(key, { used: usedIds.size, total }) };
        }
    }

    const known = new Set(getInterfaces(node).map((i) => i.id));
    const orphaned = adjacent.filter((l) => !known.has(ifaceIdOn(l, node.id)));
    if (orphaned.length) {
        return { level: 'bad', text: t('{n} link(s) land on interfaces this node no longer has. Rebind them or raise the port count.', { n: orphaned.length }) };
    }

    if (hasPortGrid(node)) {
        // Count sockets only. An AP's radio is not part of the faceplate, and its
        // clients must not read as cables in a port.
        const total = portCountOf(node);
        const used = new Set(adjacent.map((l) => ifaceIdOn(l, node.id)).filter((id) => /^p\d+$/.test(id))).size;
        const clients = adjacent.filter((l) => ifaceIsWireless(ifaceOn(node, ifaceIdOn(l, node.id)))).length;
        const key = !clients ? '{used} of {total} ports in use.'
            : clients === 1 ? '{used} of {total} ports in use, {n} wireless client.'
                : '{used} of {total} ports in use, {n} wireless clients.';
        return { level: 'good', text: t(key, { used, total, n: clients }) };
    }

    return { level: 'good', text: t('{n} link(s) on distinct interfaces.', { n: adjacent.length }) };
}

// Radio and copper are not interchangeable: a Wi-Fi association cannot originate
// from eth0/eno1/enp1s0, and a cable cannot terminate on a radio.
function evaluateRadio(node) {
    const problems = [];
    linksAtNode(node.id).forEach((link) => {
        const iface = ifaceOn(node, ifaceIdOn(link, node.id));
        if (!iface) return;
        const medium = effectiveMedium(link);
        if (medium === 'vpn') return; // an overlay rides whatever is underneath
        const peer = getNode(link.source === node.id ? link.target : link.source);
        const name = peer?.name || 'peer';
        const wireless = ifaceIsWireless(iface);

        if (medium === 'wireless' && !wireless) problems.push(t('{iface} is wired but carries the Wi-Fi link to {peer}', { iface: iface.name, peer: name }));
        else if (medium !== 'wireless' && wireless) problems.push(t('{iface} is a radio but carries the {medium} cable to {peer}', { iface: iface.name, medium, peer: name }));
    });

    if (problems.length) {
        return { level: 'bad', text: t('{problems}. Wi-Fi needs a wireless NIC (wlan0, wlp1s0); cables need an Ethernet port.', { problems: problems.join('; ') }) };
    }
    const radios = getInterfaces(node).filter(ifaceIsWireless).length;
    if (!linksAtNode(node.id).length) return { level: 'info', text: t('No links attached.') };
    const key = !radios ? 'Links match their interface type.'
        : radios === 1 ? 'Links match their interface type ({n} radio).'
            : 'Links match their interface type ({n} radios).';
    return { level: 'good', text: t(key, { n: radios }) };
}

// Bonds are the remedy evaluateMultiHoming prescribes, so a half-built one has
// to be called out rather than quietly accepted — a bond that still leaves the
// address on its members has changed nothing about the flapping it was meant
// to cure.
function evaluateBond(node) {
    const bonds = getInterfaces(node).filter(isBond);
    if (!bonds.length) return { level: 'info', text: t('No bonded interfaces.') };

    for (const bond of bonds) {
        const ids = bond.bond.members || [];
        const dangling = ids.filter((id) => !ifaceOn(node, id));
        if (dangling.length) {
            return { level: 'bad', text: t(dangling.length === 1
                ? '{bond} lists {n} member interface that no longer exists. Remove it from the bond, or recreate the NIC.'
                : '{bond} lists {n} member interfaces that no longer exist. Remove them from the bond, or recreate the NICs.',
                { bond: bond.name, n: dangling.length }) };
        }

        const members = bondMembers(node, bond);
        if (members.length < 2) {
            return { level: 'warn', text: t('{bond} has {n} member. A bond of one is a NIC with extra steps — it buys no redundancy and no bandwidth. Add a second member or unbond it.', { bond: bond.name, n: members.length }) };
        }

        const addressed = members.filter((m) => parseValidCIDR(m.ip));
        if (addressed.length) {
            return { level: 'bad', text: t('{names} still hold an address inside {bond}. Members are L2 only — the address belongs on the bond. Leave it on the members and the kernel answers ARP on each of them, which is the flux the bond was supposed to fix.', { names: addressed.map((m) => m.name).join(', '), bond: bond.name }) };
        }

        const radios = members.filter(ifaceIsWireless);
        if (radios.length) {
            return { level: 'bad', text: t('{names} is a radio. A Wi-Fi association cannot be a bond member — the two ends negotiate a single association, not a trunk.', { names: radios.map((m) => m.name).join(', ') }) };
        }

        if (bond.bond.mode === '802.3ad') {
            const segments = members
                .map((m) => { const link = linkOnIface(node.id, m.id); return link ? segmentKeyOf(link, node.id) : null; })
                .filter(Boolean);
            if (segments.length > 1 && new Set(segments).size > 1) {
                return { level: 'bad', text: t('LACP: {bond} members land in different broadcast domains. 802.3ad negotiates a LAG with one switch — split across two independent switches, the peers never bring the aggregate up. Use active-backup, or stack/MLAG the switches so they present as one.', { bond: bond.name }) };
            }
        }
    }

    const bond = bonds[0];
    const count = (bond.bond.members || []).length;
    return { level: 'good', text: t('{bond} bonds {n} NICs ({mode}). One MAC, one address — no ARP flux to answer for.', { bond: bond.name, n: count, mode: BOND_MODES[bond.bond.mode] || bond.bond.mode }) };
}

// Interface-level problems only — this is what the canvas badge reflects, so it
// deliberately ignores gateway/DNS/trace concerns that are not about the NICs.
// `results` is the findings pass's own run of the checks (keyed by check),
// so the badge is read off the same verdicts as the node tab and the panel
// rather than a second run of them.
const BADGE_CHECKS = ['multihoming', 'bond', 'ports', 'radio'];
function interfaceIssues(node, results) {
    // A retired device keeps its record, not its faults: nothing on it is
    // live, so nothing on it is badged or listed.
    if (!node || isRetired(node)) return [];
    const issues = [];

    const invalid = (node.interfaces || []).filter((iface) => iface.ip && !parseValidCIDR(iface.ip));
    if (invalid.length) {
        issues.push({ key: 'interfaces', label: t('Interfaces'), level: 'bad', text: t('Invalid CIDR on: {names}', { names: invalid.map((i) => i.name || 'interface').join(', ') }) });
    }

    BADGE_CHECKS.forEach((key) => {
        const check = NODE_CHECKS_BY_KEY[key];
        const result = results ? results[key] : check.run(node);
        if (result.level === 'bad' || result.level === 'warn') issues.push({ key, label: t(check.label), level: result.level, text: result.text });
    });

    return issues;
}

// The badge a device wears on the map: 'bad', 'warn' or null. drawCanvas
// (js/ui.js) asks this for every device it draws, so a suite asserting a
// badge asserts what the map shows, from the same findings pass (it used to
// rerun the checks on its own, beside the engine the map had moved to).
const nodeSeverity = (node, diag) => nodeDiagnosis(node, diag).severity;

// MAC addresses are optional on a drawing, so silence is the right answer when
// none are set — this check only speaks when there is something to say.
//
// It is the counterpart to evaluateMultiHoming: that one infers ARP flux from
// two interfaces sharing a subnet, which is a guess. A duplicate hardware
// address is not a guess, and it breaks the segment the same way whether or not
// the addresses happen to share a subnet.
//
// `code` tells the findings pass which verdict this is: a group address is
// this node's own fault and goes to the panel as such, while a duplicate is
// reported there once per address, naming every holder (macConflictFindings).
function evaluateMac(node, ctx) {
    const own = getInterfaces(node).filter(hasMac);
    if (!own.length) return { level: 'info', text: t('No hardware addresses recorded on this node.') };

    const api = window.CarinoOUI;

    // An interface configured with a group address cannot source a frame from
    // it; that is a fault on this node, before any question of duplicates.
    const group = own.filter((i) => parseInt(normMac(i.mac).slice(0, 2), 16) & 0x01);
    if (group.length) {
        return { level: 'bad', code: 'group', text: t('{names} carries a broadcast or multicast address. An interface cannot source frames from a group address — that value belongs in a destination, not on a NIC.', { names: group.map((i) => i.name).join(', ') }) };
    }

    const dupes = (ctx ? ctx.macDupes() : duplicateMacs(state.nodes))
        .filter((d) => d.holders.some((h) => h.node.id === node.id));
    if (dupes.length) {
        const first = dupes[0];
        // A comma, not ' and ': the sentence around it is translated, and an
        // English conjunction in the middle of it was not.
        const where = first.holders.map((h) => `${h.node.name} / ${h.iface.name}`).join(', ');
        return { level: 'bad', code: 'duplicate', text: t('{mac} is on {where}. Two interfaces in one broadcast domain cannot hold the same address — the switch rewrites its CAM table on every frame, which is the flapping this tool reports from the other direction. Clone, restored backup or a hand-typed address are the usual causes.', { mac: api ? api.fmtColon(first.hex) : first.hex, where }) };
    }

    const local = own.filter((i) => parseInt(normMac(i.mac).slice(0, 2), 16) & 0x02);
    if (local.length === own.length) {
        return { level: 'warn', text: t('Every address here is locally administered ({names}). That is correct for a VM, a bond or a randomising client, and wrong for an inventory — the vendor prefix on these is made up.', { names: own.map((i) => i.name).join(', ') }) };
    }
    if (local.length) {
        return { level: 'warn', text: t(local.length === 1
            ? '{names} is locally administered — randomised or hand-set, so the vendor prefix says nothing.'
            : '{names} are locally administered — randomised or hand-set, so the vendor prefix says nothing.',
            { names: local.map((i) => i.name).join(', ') }) };
    }

    const vendors = own.map((i) => {
        const d = api ? api.decodeMac(i.mac) : null;
        return d && d.vendor && d.vendor.vendor ? d.vendor.vendor : null;
    }).filter(Boolean);
    const uniq = Array.from(new Set(vendors));
    const key = uniq.length
        ? (own.length === 1 ? '{n} burned-in address, no duplicates on the map ({vendors}).' : '{n} burned-in addresses, no duplicates on the map ({vendors}).')
        : (own.length === 1 ? '{n} burned-in address, no duplicates on the map.' : '{n} burned-in addresses, no duplicates on the map.');
    return { level: 'good', text: t(key, { n: own.length, vendors: uniq.join(', ') }) };
}

// One gateway check. There used to be two: this one for the node tab, and a
// second inside the panel's findings that asked only "is the gateway on one of
// my subnets?". They disagreed. The panel's never knew 0.0.0.0 is the
// default-route placeholder (so every router drawn with one was "unreachable"),
// and it matched an IPv4 gateway against an IPv6 interface, which throws in
// ipaddr.js and was then reported as "Invalid gateway format". Now there is
// this one, the panel shows its critical verdicts, and the subnet test runs
// per address family.
//
// `problems` lists what the findings pass reports: only the critical
// verdicts. A missing gateway is a warning on the node tab, not a finding, or
// every new device would raise one.
function evaluateGateway(node, ctx) {
    if (isDumbDevice(node)) {
        return {
            level: 'info',
            text: t('L2 backplane nodes do not require a gateway.')
        };
    }

    // The gateway in force: the device's own, or its network's (R7). The
    // checks below hold either to the same standard, so a wrong gateway on
    // a network is reported on every device that inherits it.
    const gw = effectiveGw(node);
    if (!gw) {
        return {
            level: 'warn',
            text: t('No gateway configured.')
        };
    }

    const bad = (text) => ({ level: 'bad', text, problems: [text] });

    if (gw === '0.0.0.0') {
        const cloudOk = canReachCloud(node, ctx);

        return {
            level: cloudOk ? 'good' : 'info',
            text: t(cloudOk
                ? 'Default route placeholder configured; cloud/internet node is reachable.'
                : 'Default route placeholder configured.')
        };
    }

    let gwIp;
    try {
        gwIp = ipaddr.parse(gw);
    } catch (e) {
        return bad(t('Invalid gateway IP: {gw}', { gw }));
    }

    // The next hop has to be on-link: inside one of this device's own subnets
    // of the same family. Only asked when the device has an address at all —
    // one with none has its own finding, and this one would only repeat it.
    const own = getValidIps(node);
    if (own.length && !own.some((p) => p.kind === gwIp.kind() && gwIp.match(p.cidrObj))) {
        return bad(t('Gateway {gw} is outside every subnet on this device, so it is unreachable.', { gw }));
    }

    const gatewayNode = ctx ? ctx.nodeByIp(gw) : findNodeByIp(gw);

    if (!gatewayNode) {
        // An edge router's gateway is the provider's, and the provider is drawn
        // as a cloud: a public next hop behind a reachable cloud is outside the
        // map by design, not missing from it. A private one nobody holds is a
        // typo or a device that was never drawn.
        if (!isPrivateIP(gwIp) && canReachCloud(node, ctx)) {
            return { level: 'good', text: t('Gateway {gw} is past the cloud/internet node, outside the map.', { gw }) };
        }
        return bad(t('Gateway {gw} was not found on any node/interface.', { gw }));
    }

    // Only a retired device holds it (nodeByIp prefers an active one): the
    // replacement was never given the address, which is the thing to say.
    if (isRetired(gatewayNode)) return bad(t('Gateway {gw} is on {node}, which is retired.', { gw, node: gatewayNode.name }));

    const reachable = canReachNode(node, gatewayNode, ctx);

    if (!reachable) return bad(t('Gateway {gw} exists on {node}, but is not reachable from this node.', { gw, node: gatewayNode.name }));
    return { level: 'good', text: t('Gateway {gw} found on {node} and is reachable.', { gw, node: gatewayNode.name }) };
}

// `problems` as in evaluateGateway(): the critical verdicts, one per server,
// so the panel does not repeat the servers that are fine.
function evaluateDns(node, ctx) {
    if (isDumbDevice(node)) {
        return {
            level: 'info',
            text: t('L2 backplane nodes do not require DNS.')
        };
    }

    const dnsList = parseDnsList(effectiveDns(node));   // its own, or its network's (R7)

    if (!dnsList.length) {
        return {
            level: 'warn',
            text: t('No DNS server configured.')
        };
    }

    const results = dnsList.map((dnsIp) => {
        let parsed;

        try {
            parsed = ipaddr.parse(dnsIp);
        } catch (e) {
            return {
                level: 'bad',
                text: t('{ip}: invalid DNS IP.', { ip: dnsIp })
            };
        }

        const dnsNode = ctx ? ctx.nodeByIp(dnsIp) : findNodeByIp(dnsIp);

        if (dnsNode && isRetired(dnsNode)) {
            return {
                level: 'bad',
                text: t('{ip}: found on {node}, which is retired.', { ip: dnsIp, node: dnsNode.name })
            };
        }

        if (dnsNode) {
            const reachable = canReachNode(node, dnsNode, ctx);
            const dnsPort = getPortStatus(dnsNode, '53');

            if (reachable && dnsPort.ok) {
                return {
                    level: 'good',
                    text: t('{ip}: found on {node}, reachable, DNS port OK.', { ip: dnsIp, node: dnsNode.name })
                };
            }

            if (!reachable) {
                return {
                    level: 'bad',
                    text: t('{ip}: found on {node}, but not reachable.', { ip: dnsIp, node: dnsNode.name })
                };
            }

            return {
                level: 'bad',
                text: t('{ip}: reachable, but DNS port 53 appears closed.', { ip: dnsIp })
            };
        }

        if (isPrivateIP(parsed)) {
            return {
                level: 'bad',
                text: t('{ip}: private DNS server not found in topology.', { ip: dnsIp })
            };
        }

        const cloudOk = canReachCloud(node, ctx);

        return {
            level: cloudOk ? 'good' : 'warn',
            text: t(cloudOk
                ? '{ip}: public DNS; cloud/internet path appears reachable.'
                : '{ip}: public DNS, but no cloud/internet path was found.', { ip: dnsIp })
        };
    });

    const worst = results.some((r) => r.level === 'bad')
        ? 'bad'
        : results.some((r) => r.level === 'warn')
            ? 'warn'
            : 'good';

    return {
        level: worst,
        text: results.map((r) => r.text).join(' '),
        problems: results.filter((r) => r.level === 'bad').map((r) => r.text)
    };
}

function evaluateTracePort(node) {
    const typed = typedTracePort();
    const filterOn = !!state.settings.tracePortOn;

    // Distinguish "no port typed" from "port typed but filter switched off" — the
    // second must not claim there is no port, or the toggle looks broken.
    if (!filterOn && typed) {
        return {
            level: 'info',
            text: t('Port filter off — trace is evaluating IP reachability only (port {port} ignored).', { port: typed })
        };
    }
    if (!typed) {
        return {
            level: 'info',
            text: t('No trace port entered. Trace is evaluating IP reachability only.')
        };
    }

    return getPortStatus(node, typed);
}

function renderNodeDiagnostics(node) {
    const panel = document.getElementById('nodeDiagnosticsPanel');
    const body = document.getElementById('nodeDiagnosticsBody');
    const summary = document.getElementById('nodeDiagnosticsSummary');
    // Placeholder shown in the Diagnostics tab when there is no node to diagnose.
    const placeholder = document.getElementById('diagNoSelection');

    if (!panel || !body || !summary) return;

    if (!node || state.selectedType !== 'node') {
        panel.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        body.innerHTML = '';
        summary.textContent = t('Idle');
        summary.className = 'diag-pill';
        return;
    }

    if (placeholder) placeholder.classList.add('hidden');

    // The engine's verdicts for this node, the same ones the panel and the
    // report are filtered from, plus the trace port, which is about the
    // trace above it rather than the network and so is not a finding.
    const checks = nodeChecks(node)
        .map((c) => [c.label, c])
        .concat([[t('Trace Port'), evaluateTracePort(node)]]);

    const hasBad = checks.some(([, result]) => result.level === 'bad');
    const hasWarn = checks.some(([, result]) => result.level === 'warn');

    const overall = hasBad ? 'Issues' : hasWarn ? 'Warnings' : 'OK';

    summary.textContent = t(overall);
    summary.className = 'diag-pill ' + (hasBad ? 'bad' : hasWarn ? 'warn' : 'good');

    body.innerHTML = checks
        .map(([label, result]) => diagnosticRow(label, result.level, result.text))
        .join('');

    panel.classList.remove('hidden');
}

function refreshSelectedNodeDiagnostics() {
    if (!state.selectedId || state.selectedType !== 'node') {
        renderNodeDiagnostics(null);
        return;
    }

    renderNodeDiagnostics(getNode(state.selectedId));
}

// ---- Reachability ----
// A breadth-first walk over L2 domains (through dumb switches and passthrough
// links), stepping on to routers that share a subnet, honouring NAT and
// crossing VPN overlays. calculateReachability() is the whole walk from one
// device; reachWalk() is the walk itself, split out so the findings pass can
// share the part that is the same for every host behind one router (see
// reachContext() above).

// Returns the shared subnet's networkStr, '__cloud__' if either is the
// Internet cloud, or null.
function sharedSubnetOf(a, b) {
    if (!a || !b) return null;
    if (a.type === 'cloud' || b.type === 'cloud') return '__cloud__';
    const ipsA = getValidIps(a), ipsB = getValidIps(b);
    for (const ia of ipsA) for (const ib of ipsB) if (ia.kind === ib.kind && ia.networkStr === ib.networkStr) return ia.networkStr;
    return null;
}

// For a NAT gateway, classify its subnets into outside (WAN/public) vs
// inside (private LAN). Outside = the subnet containing its default gw, or
// any public (non-RFC1918) subnet.
function natInfo(node, cache) {
    if (!node) return { nat: false, outside: new Set(), inside: new Set() };
    if (cache[node.id]) return cache[node.id];
    const info = { nat: !!node.nat, outside: new Set(), inside: new Set() };
    if (node.nat) {
        const ips = getValidIps(node).filter(i => i.kind === 'ipv4');
        let gwNet = null;
        const ownGw = effectiveGw(node);
        if (ownGw) { try { const g = ipaddr.parse(ownGw).toString(); ips.forEach(i => { const c = parseValidCIDR(g + '/' + i.prefix); if (c && c.networkStr === i.networkStr) gwNet = i.networkStr; }); } catch (e) {} }
        ips.forEach(i => { if (!i.isPrivate) info.outside.add(i.networkStr); else info.inside.add(i.networkStr); });
        if (gwNet) { info.outside.add(gwNet); info.inside.delete(gwNet); }
        if (info.outside.size === 0 && ips.length) { const o = gwNet || ips[0].networkStr; info.outside.add(o); info.inside.delete(o); }
    }
    cache[node.id] = info; return info;
}

function isGatewayOf(client, possibleGateway) {
    if (!client || !possibleGateway) return false;
    if (possibleGateway.type === 'cloud') return true;
    const gw = effectiveGw(client);
    if (!gw) return false;
    try {
        const gwIp = ipaddr.parse(gw);
        return getValidIps(possibleGateway).some((ib) => ib.ip.toString() === gwIp.toString());
    } catch (e) { return false; }
}

// Enhanced L2 Traverse (Supports Dumb Switches & VM Passthrough)
function reachL2Domain(originId) {
    const nodes = new Set([originId]), links = new Set(), l2Queue = [originId], l2Processed = new Set();
    while (l2Queue.length) {
        const currentId = l2Queue.shift();
        if (l2Processed.has(currentId)) continue;
        l2Processed.add(currentId);

        for (const link of linksAtNode(currentId)) {
            const nextId = link.source === currentId ? link.target : link.source, nextNode = getNode(nextId);
            // A retired switch is still drawn, but forwards nothing.
            if (!nextNode || isRetired(nextNode)) continue;

            // Traverse if it's a dumb switch, OR if it's a passthrough link (treats the host like a dumb switch for this path)
            if (isDumbDevice(nextNode) || link.attachment === 'passthrough') {
                if (!nodes.has(nextId)) {
                    nodes.add(nextId); links.add(link.id); l2Queue.push(nextId);
                }
            }
        }
    }
    return { nodes, links };
}

// "Bridged (Routed by Host)", as the link's Attachment field puts it: a VM or
// container on a bridged link reaches the network through its host, so seen
// from the guest the host is a hop that forwards, router or not. Without this
// a VM on an ordinary server could reach the server and nothing else, and its
// own gateway read as unreachable. A guest link that names no attachment is
// read as the editor writes one (bridged); passthrough is already L2 and is
// walked as such in reachL2Domain().
function hostRoutesFor(guest, host, link) {
    if (!link || !isVirtualType(guest.type) || isVirtualType(host.type)) return false;
    return link.attachment === 'bridged' || !link.attachment;
}

function reachAccumulator(seedIds) {
    return { reachableNodes: new Set(seedIds), reachableLinks: new Set(), processedMode: {}, natCache: {} };
}

// Queue entries carry viaNet: the subnet we arrived on (or a sentinel), so NAT
// can tell inside<->outside direction. With handedOn, only the entries already
// queued are expanded and whatever they would queue next is handed back
// instead of walked.
function reachWalk(queue, acc, handedOn) {
    const { reachableNodes, reachableLinks, processedMode } = acc;
    const push = handedOn ? (entry) => handedOn.push(entry) : (entry) => queue.push(entry);

    while (queue.length) {
        const { id: currentId, viaNet } = queue.shift();
        const currentNode = getNode(currentId);
        // Retired: off the network. Walked from, it reaches nothing but
        // itself; it is never reached (the neighbour tests below), so no path
        // runs through it and nobody's gateway or DNS server can be it.
        if (!currentNode || isRetired(currentNode)) continue;

        // NAT boundary: arriving on WAN/outside (or via the Internet cloud)
        // hides the device's private (inside) subnets. A node reached on a
        // blocked (outside) path may be re-expanded later if a trusted (inside/
        // VPN) path reaches it — so tunnel order doesn't matter.
        const ni = natInfo(currentNode, acc.natCache);
        const enteredOutside = ni.nat && viaNet && (viaNet === '__cloud__' || ni.outside.has(viaNet));
        const blockInside = enteredOutside && ni.inside.size > 0;
        const mode = blockInside ? 'blocked' : 'full';
        if (processedMode[currentId] === 'full') continue;
        if (processedMode[currentId] === 'blocked' && mode !== 'full') continue;
        processedMode[currentId] = mode;

        const l2 = reachL2Domain(currentId);
        l2.nodes.forEach((id) => reachableNodes.add(id)); l2.links.forEach((id) => reachableLinks.add(id));

        const candidateDevices = new Set(), candidateLinks = new Map();
        l2.nodes.forEach((l2id) => {
            linksAtNode(l2id).forEach((link) => {
                const neighborId = link.source === l2id ? link.target : link.source, neighbor = getNode(neighborId);
                if (!neighbor || isDumbDevice(neighbor) || isRetired(neighbor)) return;
                if (link.medium === 'vpn') return; // overlay tunnels handled below, not as physical adjacency
                candidateDevices.add(neighborId); candidateLinks.set(neighborId, link);
            });
        });

        candidateDevices.forEach((deviceId) => {
            if (deviceId === currentId) return;
            const device = getNode(deviceId);
            if (!device) return;
            const shared = sharedSubnetOf(currentNode, device);
            if (!shared) return;
            if (blockInside && ni.inside.has(shared)) return; // NAT hides this inside subnet from the WAN side

            reachableNodes.add(deviceId);
            const link = candidateLinks.get(deviceId);
            if (link) reachableLinks.add(link.id);

            // The gateway test parses addresses, so it is only asked when its
            // answer matters: a router seen from a host. From a router, every
            // router it shares a subnet with is a next hop anyway.
            const currentCanRoute = isRoutingDevice(currentNode.type), deviceCanRoute = isRoutingDevice(device.type);
            const onward = deviceCanRoute
                ? (currentCanRoute || isGatewayOf(currentNode, device) || isGatewayOf(device, currentNode))
                : hostRoutesFor(currentNode, device, link);
            if (onward) push({ id: deviceId, viaNet: shared });
        });

        // VPN overlay: a tunnel is a routed adjacency across the underlay. The
        // far endpoint (and its LAN) becomes reachable, entering on the trusted
        // side (so it bypasses the far gateway's NAT).
        l2.nodes.forEach((l2id) => {
            linksAtNode(l2id).filter((l) => l.medium === 'vpn').forEach((link) => {
                const farId = link.source === l2id ? link.target : link.source, far = getNode(farId);
                if (!far || isRetired(far)) return;
                reachableNodes.add(farId); reachableLinks.add(link.id);
                push({ id: farId, viaNet: '__vpn__' });
            });
        });
    }
}

// opts.port: the service port to filter by. Left out, it is the trace's own
// (activeTracePort(), from state.settings); the checks always pass '' so a
// typed trace port never changes a diagnostic.
function calculateReachability(startNodeId, opts = {}) {
    const start = getNode(startNodeId);
    if (!start) return { reachableNodes: new Set(), reachableLinks: new Set() };

    const acc = reachAccumulator([startNodeId]);
    const { reachableNodes, reachableLinks } = acc;
    const queue = [{ id: startNodeId, viaNet: null }];
    const targetPort = opts.port !== undefined ? String(opts.port).trim() : activeTracePort();

    if (isDumbDevice(start) && !isRetired(start)) {
        const l2 = reachL2Domain(startNodeId);
        l2.nodes.forEach((id) => reachableNodes.add(id)); l2.links.forEach((id) => reachableLinks.add(id));
        l2.nodes.forEach((l2id) => {
            linksAtNode(l2id).forEach((link) => {
                const neighborId = link.source === l2id ? link.target : link.source, neighbor = getNode(neighborId);
                if (!neighbor || isDumbDevice(neighbor) || isRetired(neighbor)) return;
                reachableNodes.add(neighborId); reachableLinks.add(link.id); queue.push({ id: neighborId, viaNet: null });
            });
        });
    }

    reachWalk(queue, acc, null);

    // Port Filtering pass on final reachable nodes AND links
    if (targetPort !== '') {
        const filteredNodes = new Set();
        const filteredLinks = new Set();

        reachableNodes.forEach(id => {
            const node = getNode(id);
            if (isRoutingDevice(node.type) || isDumbDevice(node) || id === startNodeId || acceptsPort(node, targetPort)) {
                filteredNodes.add(id);
            }
        });

        // Only highlight links that connect to permitted nodes
        reachableLinks.forEach(linkId => {
            const link = getLink(linkId);
            if (filteredNodes.has(link.source) && filteredNodes.has(link.target)) {
                filteredLinks.add(linkId);
            }
        });
        return { reachableNodes: filteredNodes, reachableLinks: filteredLinks };
    }

    return { reachableNodes, reachableLinks };
}

function updateTraceStatus(reach) {
        const el = document.getElementById('traceStatus'); if (!el) return;
        if (!state.settings.traceMode) { el.textContent = 'Trace off'; el.className = 'cs-trace-status'; return; }
        if (!state.selectedId || state.selectedType !== 'node') { el.textContent = 'Select a node'; el.className = 'cs-trace-status active'; return; }

        let count = 0;
        if (reach) {
            reach.reachableNodes.forEach(id => { if(!isDumbDevice(getNode(id)) && id !== state.selectedId) count++; });
        }
        el.textContent = `→ ${count} devices`; el.className = 'cs-trace-status active';
    }

// ============================================================================
// The findings engine
// ============================================================================
// One pass, one list. The node tab, the canvas badges, the findings list and the
// site report used to run their own checks: the panel had its own gateway rule
// that disagreed with the node tab's, a duplicate MAC or an unreachable DNS
// server showed on the node tab and nowhere else, and the panel named devices
// rather than pointing at them. Now diagnoseDoc() runs every check once and
// each surface is a filtered view of what it returns:
//
//   nodes     per device: every check's verdict (the node tab), the
//             interface-level issues and the severity they add up to (the
//             badge).
//   findings  what is wrong, as { key, level, check, subject, detail, line,
//             nodeIds, linkIds }. key is the check's stable id, check its
//             translated name (the report's column), nodeIds/linkIds what to
//             select. line is what the panel says. Only critical and advisory
//             verdicts become findings.
//
// Pure in the sense the bulk preview needs: no DOM, nothing written, and it
// can be asked about a document that is not on screen (diagnoseDoc(scratch)).
// It reads state.nodes and state.links like every helper in js/model.js, so a
// scratch document is lent to state for the length of the call and handed
// back in a finally, the way withDoc() in js/library.js lends a stored one.
//
// Node-local NIC faults come from interfaceIssues(); the relational ones — a
// duplicate address, a mismatched cable, a cycle — are added after the
// per-device checks, because none of them can be blamed on one device.

const NODE_CHECKS = [
    { key: 'interfaces', label: 'Interfaces', run: evaluateInterfaces },
    { key: 'multihoming', label: 'Multi-Homing', run: evaluateMultiHoming },
    { key: 'bond', label: 'Bond', run: evaluateBond },
    { key: 'ports', label: 'Ports', run: evaluatePorts },
    { key: 'radio', label: 'Radio', run: evaluateRadio },
    { key: 'mac', label: 'MAC', run: evaluateMac },
    { key: 'gateway', label: 'Gateway', run: evaluateGateway },
    { key: 'dns', label: 'DNS', run: evaluateDns }
];
const NODE_CHECKS_BY_KEY = Object.fromEntries(NODE_CHECKS.map((c) => [c.key, c]));
// Every check on a retired device says the same thing: it is off the
// network, so a gateway it cannot reach (it reaches nothing) is not a fault.
const runNodeCheck = (c, node, ctx) => (isRetired(node)
    ? { level: 'info', text: t('Retired: off the network, so not checked.') }
    : c.run(node, ctx));

// doc: { nodes, links } in the editor's own shape (a scratch copy of
// state.nodes/state.links, say), or nothing for the document on screen. A
// stored or serialized document goes through withDoc() first, which reads it
// the way opening it would.
// Its networks too: a device's gateway may be its network's. A scratch copy
// without a `networks` list is read as declaring none.
// The accepted findings are the one exception: a scratch copy without an
// `accepted` list is read as carrying the document's own. Every scratch copy
// is the document on screen with a change applied (a bulk edit, a paste, a
// CSV import), and the accepted list is a note about that document; read as
// empty, every accepted finding would show up in the preview as a new one.
function diagnoseDoc(doc) {
    if (!doc) return withLookupPass(runDiagnosis);
    const held = { nodes: state.nodes, links: state.links, networks: state.networks, accepted: state.accepted };
    try {
        state.nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
        state.links = Array.isArray(doc.links) ? doc.links : [];
        state.networks = Array.isArray(doc.networks) ? doc.networks : [];
        if (Array.isArray(doc.accepted)) state.accepted = doc.accepted;
        return withLookupPass(runDiagnosis);
    } finally {
        state.nodes = held.nodes; state.links = held.links; state.networks = held.networks; state.accepted = held.accepted;
    }
}

function runDiagnosis() {
    const ctx = reachContext();
    const findings = [];
    const nodes = new Map();
    const add = (f) => findings.push(Object.assign({ nodeIds: [], linkIds: [] }, f,
        { line: f.line || (f.subject ? `${f.subject}: ${f.detail}` : f.detail) }));

    const accepted = acceptedList();
    state.nodes.forEach((node) => {
        const results = {};
        NODE_CHECKS.forEach((c) => { results[c.key] = runNodeCheck(c, node, ctx); });
        const issues = interfaceIssues(node, results);
        // The badge counts what is still open: an issue someone accepted with
        // a reason is listed as accepted, not flagged on the map. The node
        // tab's verdicts (checks) still say what each check found.
        const open = issues.filter((i) => !acceptedEntryFor(accepted, i.key, [node.id], []));
        const severity = !open.length ? null : open.some((i) => i.level === 'bad') ? 'bad' : 'warn';
        if (!nodes.has(node.id)) {
            nodes.set(node.id, { node, issues: open, severity, checks: NODE_CHECKS.map((c) => ({ key: c.key, label: t(c.label), ...results[c.key] })) });
        }

        const own = (key, level, detail) => add({ key, level, check: t(NODE_CHECKS_BY_KEY[key].label), subject: node.name, detail, nodeIds: [node.id] });
        // Interface-level problems, surfaced globally so you do not have to
        // click each node to find the one that is flapping.
        issues.forEach((i) => own(i.key, i.level, i.text));
        if (results.mac.code === 'group') own('mac', 'bad', results.mac.text);
        ['gateway', 'dns'].forEach((key) => {
            const problems = results[key].problems;
            if (problems && problems.length) own(key, 'bad', problems.join(' '));
        });
    });

    ipConflictFindings().forEach(add);
    macConflictFindings(ctx).forEach(add);
    cablingFindings().forEach(add);
    loopFindings().forEach(add);
    labelFindings().forEach(add);

    // Each finding says whether it was accepted, and why: { reason, index }
    // (the entry's place in state.accepted, which the Findings tab's Reopen
    // removes), or null while it is open.
    findings.forEach((f) => {
        const entry = acceptedEntryFor(accepted, f.key, f.nodeIds, f.linkIds);
        f.accepted = entry ? { reason: entry.reason, index: accepted.indexOf(entry) } : null;
    });
    return { findings, nodes };
}

// ---- Accepted findings ----
// Some findings are known and stay: a lab switch with no STP on purpose, two
// devices that share an address behind a NAT nobody drew, a printer nobody
// will re-address this year. Left in the list, they bury the next real one.
// "Accept with reason" keeps them, as accepted, out of every count (the tab,
// the pill, the badges, the report's totals, a card's summary, a preview's
// delta, has:finding) while the Findings tab and the report still list them
// with the reason, so nothing is hidden from whoever reads the register next.
//
// Stored in the document (state.accepted, serialized as `accepted`), because
// the reason is part of the record: it travels with the file, the link and
// the report, and an accept is one undo step like any edit. Each entry is
// { check, nodeIds, linkIds, reason }: check is the finding's stable key
// (ip-conflict, gateway, loop…), never its wording, which follows the
// language.
//
// A finding is accepted when an entry of its check names every device and
// cable the finding names. So an accepted conflict between A and B comes back
// the day C joins it, and a gateway accepted on thirty PCs comes back on the
// thirty-first: what was accepted was those devices, not the check.
const ACCEPT_REASON_MAX = 300;
const acceptedList = () => (Array.isArray(state.accepted) ? state.accepted : []);
function acceptedEntryFor(accepted, key, nodeIds, linkIds) {
    if (!accepted.length || !((nodeIds || []).length + (linkIds || []).length)) return null;
    return accepted.find((a) => a.check === key
        && (nodeIds || []).every((id) => a.nodeIds.includes(id))
        && (linkIds || []).every((id) => a.linkIds.includes(id))) || null;
}
const isOpenFinding = (f) => !f.accepted;

// Read from a document: only the four fields, ids as strings, a reason that
// is text and not empty. Anything else is dropped, as the serializer's
// allowlist drops an unknown key.
function normalizeAccepted(list) {
    const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : []);
    return (Array.isArray(list) ? list : []).map((a) => {
        if (!a || typeof a !== 'object' || typeof a.check !== 'string' || !a.check) return null;
        const reason = typeof a.reason === 'string' ? a.reason.trim().slice(0, ACCEPT_REASON_MAX) : '';
        const out = { check: a.check, nodeIds: ids(a.nodeIds), linkIds: ids(a.linkIds), reason };
        return reason && (out.nodeIds.length || out.linkIds.length) ? out : null;
    }).filter(Boolean);
}
// Written with the devices and cables that are gone left out (a deleted
// device cannot be accepted any more), and an entry naming nothing left
// dropped. Nothing to write is no key, like the networks.
function serializeAccepted(list) {
    const nodeIds = new Set(state.nodes.map((n) => n.id));
    const linkIds = new Set(state.links.map((l) => l.id));
    const out = [];
    normalizeAccepted(list).forEach((a) => {
        const n = a.nodeIds.filter((id) => nodeIds.has(id)), l = a.linkIds.filter((id) => linkIds.has(id));
        if (n.length || l.length) out.push({ check: a.check, nodeIds: n.length ? n : undefined, linkIds: l.length ? l : undefined, reason: a.reason });
    });
    return out.length ? out : undefined;
}

// The name a check goes by in the tab and the report, for an accepted entry
// that matches nothing at the moment (there is no finding to borrow it from).
const FINDING_CHECK_NAMES = { 'ip-conflict': 'IP Conflict', 'mac-conflict': 'MAC Conflict', cabling: 'Cabling', loop: 'L2 loop',
    'cable-label': 'Cable label', 'asset-tag': 'Asset tag' };
const findingCheckName = (key) => t(FINDING_CHECK_NAMES[key] || (NODE_CHECKS_BY_KEY[key] && NODE_CHECKS_BY_KEY[key].label) || key);

// One undo step: the findings of one line of the tab (the same finding on
// one or more devices), accepted together under one reason.
function acceptFindings(findings, reason) {
    const text = String(reason || '').trim().slice(0, ACCEPT_REASON_MAX);
    const list = (findings || []).filter((f) => f && !f.accepted);
    if (!text || !list.length || readOnlyRefuses()) return false;
    const union = (key) => [...new Set(list.flatMap((f) => f[key] || []))];
    batch(() => {
        state.accepted = acceptedList().concat([{ check: list[0].key, nodeIds: union('nodeIds'), linkIds: union('linkIds'), reason: text }]);
        save(); renderCanvasOnly();
    });
    refreshSelectedNodeDiagnostics();
    return true;
}
// Reopen: the entry goes, and whatever it covered counts again. One step.
function reopenAccepted(index) {
    const list = acceptedList();
    if (!list[index] || readOnlyRefuses()) return false;
    batch(() => {
        state.accepted = list.filter((a, i) => i !== index);
        save(); renderCanvasOnly();
    });
    refreshSelectedNodeDiagnostics();
    return true;
}

// Keyed by node, not by interface: one device holding the same address on two
// of its own interfaces is not in conflict with itself, and was being reported
// as "X, X".
function ipConflictFindings() {
    const ipMap = new Map();
    state.nodes.forEach((node) => {
        // A retired device has handed its address back: giving it to the
        // replacement is the normal course of things, not a conflict.
        if (isRetired(node)) return;
        getValidIps(node).forEach((parsed) => {
            const ip = parsed.ip.toString();
            if (!ipMap.has(ip)) ipMap.set(ip, new Map());
            ipMap.get(ip).set(node.id, node);
        });
    });

    const out = [];
    ipMap.forEach((holders, ip) => {
        // A cloud stands for something outside the drawing (the internet, an
        // ISP, another site), and two of them on one address are two drawings
        // of the same outside thing, as every dual-ISP map's pair of default
        // 8.8.8.8 clouds is. A device of this site holding a cloud's address
        // is still a conflict, so only an all-cloud set is let off.
        const list = [...holders.values()];
        if (list.length < 2 || list.every((n) => n.type === 'cloud')) return;
        const names = list.map((n) => n.name || n.id).join(', ');
        const detail = t('{ip} shared by {names}.', { ip, names });
        out.push({ key: 'ip-conflict', level: 'bad', check: t('IP Conflict'), subject: names, detail,
            line: `${t('IP Conflict')}: ${detail}`, nodeIds: list.map((n) => n.id) });
    });
    return out;
}

// One finding per duplicated address, naming every holder — the node tab's
// MAC check says the same thing from each holder's side. Like an IP conflict,
// it takes two devices: one device repeating its own address (bond members
// often do) is not a conflict on the segment.
function macConflictFindings(ctx) {
    const api = window.CarinoOUI;
    const out = [];
    ctx.macDupes().forEach((d) => {
        const ids = [...new Set(d.holders.map((h) => h.node.id))];
        if (ids.length < 2) return;
        const mac = api ? api.fmtColon(d.hex) : d.hex;
        const where = d.holders.map((h) => `${h.node.name} / ${h.iface.name}`).join(', ');
        const detail = t('{mac} shared by {where}.', { mac, where });
        out.push({ key: 'mac-conflict', level: 'bad', check: t('MAC Conflict'),
            subject: [...new Set(d.holders.map((h) => h.node.name || h.node.id))].join(', '),
            detail, line: `${t('MAC Conflict')}: ${detail}`, nodeIds: ids });
    });
    return out;
}

// Both ends of a cable are one wire: if each end holds an IP, they must agree.
function cablingFindings() {
    const out = [];
    state.links.forEach((link) => {
        const src = getNode(link.source), tgt = getNode(link.target);
        if (!src || !tgt || effectiveMedium(link) === 'vpn' || isRetired(src) || isRetired(tgt)) return;
        const a = parseValidCIDR(ifaceOn(src, link.sourceIface)?.ip);
        const b = parseValidCIDR(ifaceOn(tgt, link.targetIface)?.ip);
        if (!a || !b || a.networkStr === b.networkStr) return;
        const detail = t('{a} ({ifaceA}) and {b} ({ifaceB}) are cabled together but sit on different subnets ({netA} vs {netB}).',
            { a: src.name, ifaceA: ifaceLabel(src, link.sourceIface), b: tgt.name, ifaceB: ifaceLabel(tgt, link.targetIface), netA: a.networkStr, netB: b.networkStr });
        out.push({ key: 'cabling', level: 'bad', check: t('Cabling'), subject: `${src.name} ↔ ${tgt.name}`, detail, line: detail,
            nodeIds: [src.id, tgt.id], linkIds: [link.id] });
    });
    return out;
}

// An L2 loop is the sibling failure to MAC flapping: a cycle through dumb
// switches floods broadcasts forever unless STP is running.
function loopFindings() {
    const out = [];
    const parent = {};
    const find = (id) => { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
    state.nodes.forEach((n) => { parent[n.id] = n.id; });
    state.links.forEach((link) => {
        const src = getNode(link.source), tgt = getNode(link.target);
        if (!src || !tgt || effectiveMedium(link) === 'vpn') return;
        if (!isDumbDevice(src) || !isDumbDevice(tgt)) return; // only forwarding devices close a loop
        if (isRetired(src) || isRetired(tgt)) return;          // nor does one that is off the network
        const rootA = find(src.id), rootB = find(tgt.id);
        if (rootA === rootB) {
            const detail = t('the link between {a} and {b} closes a switching loop. Broadcast storm risk unless STP is enabled.', { a: src.name, b: tgt.name });
            out.push({ key: 'loop', level: 'bad', check: t('L2 loop'), subject: `${src.name} ↔ ${tgt.name}`, detail,
                line: `${t('L2 loop')}: ${detail}`, nodeIds: [src.id, tgt.id], linkIds: [link.id] });
        } else parent[rootA] = rootB;
    });
    return out;
}

// Labels are how a person finds the thing in the building: the same cable
// label on two runs, or one asset tag on two devices, sends someone to the
// wrong one (and `#asset/<tag>` cannot say which device a printed QR label
// means). Advisory, not critical: the network works; the register misleads.
// Compared as written but without case or surrounding space ("ws-3b" is the
// sticker "WS-3B"). A retired device keeps its tag: tags are never reused.
function labelFindings() {
    const out = [];
    const dupes = (items, keyOf) => {
        const by = new Map();
        items.forEach((it) => {
            const k = keyOf(it).trim();
            if (!k) return;
            const key = k.toLowerCase();
            if (!by.has(key)) by.set(key, { text: k, items: [] });
            by.get(key).items.push(it);
        });
        return [...by.values()].filter((g) => g.items.length > 1);
    };
    const linkName = (l) => { const a = getNode(l.source), b = getNode(l.target); return `${a ? a.name || a.id : l.source} ↔ ${b ? b.name || b.id : l.target}`; };
    dupes(state.links.filter((l) => getNode(l.source) && getNode(l.target)), (l) => cableOf(l, 'label')).forEach((g) => {
        const detail = t('Label {label} is on {n} cables: {cables}.', { label: g.text, n: g.items.length, cables: g.items.map(linkName).join(', ') });
        out.push({ key: 'cable-label', level: 'warn', check: t('Cable label'), subject: g.text, detail,
            line: `${t('Cable label')}: ${detail}`, nodeIds: [], linkIds: g.items.map((l) => l.id) });
    });
    dupes(state.nodes, (n) => asText(n.assetTag)).forEach((g) => {
        const names = g.items.map((n) => n.name || n.id).join(', ');
        const detail = t('Asset tag {tag} is on {n} devices: {names}.', { tag: g.text, n: g.items.length, names });
        out.push({ key: 'asset-tag', level: 'warn', check: t('Asset tag'), subject: names, detail,
            line: `${t('Asset tag')}: ${detail}`, nodeIds: g.items.map((n) => n.id) });
    });
    return out;
}

// The document on screen, diagnosed once per change. A render, a click that
// only selects, or the node tab after an edit would otherwise rerun every
// reachability walk on an unchanged network. The key is the document minus
// positions (moving a device changes no verdict) plus the language the
// verdicts are worded in. The networks are part of the document: a
// network's gateway is every member's gateway. So is the accepted list: it
// decides which findings count.
let diagnosisMemo = null;
const omitPosition = (k, v) => (k === 'x' || k === 'y' ? undefined : v);
// Building the key is a serialization of the whole document: cheap once, not
// once per device. The table's rows, the report's inventory and the map's
// badges each ask for every device, so inside a lookup pass (which nothing
// writes through) the answer is kept on the pass and the key built once. At
// 300 devices the per-row key alone was over 100 ms of every table redraw.
function currentDiagnosis() {
    if (lookupPass) return lookupPass.diag || (lookupPass.diag = currentDiagnosisNow());
    return currentDiagnosisNow();
}
function currentDiagnosisNow() {
    const lang = window.CarinoI18N ? window.CarinoI18N.current() : '';
    const key = `${lang}\u0000${JSON.stringify(state.nodes, omitPosition)}\u0000${JSON.stringify(state.links)}\u0000${JSON.stringify(state.networks)}\u0000${JSON.stringify(state.accepted || [])}`;
    if (diagnosisMemo && diagnosisMemo.key === key) {
        // Same network, but maybe not the same objects: undo, redo and
        // Back/Forward rebuild every node from the stored document, and a move
        // there leaves the key as it was. The verdicts still hold, so the
        // entries are pointed at the new objects; left as they were, every
        // nodeDiagnosis() would miss and rerun the checks one device at a
        // time, unindexed, on each render (seconds at a few hundred devices).
        // The first device holding an id owns its entry, as in the pass.
        const nodes = diagnosisMemo.value.nodes;
        const seen = new Set();
        state.nodes.forEach((n) => {
            if (seen.has(n.id)) return;
            seen.add(n.id);
            const entry = nodes.get(n.id);
            if (entry && entry.node !== n) nodes.set(n.id, { ...entry, node: n });
        });
        return diagnosisMemo.value;
    }
    const value = diagnoseDoc(null);
    diagnosisMemo = { key, value };
    return value;
}

// The panel and the report's list. A copy, so a caller sorting it cannot
// reorder the memo under the next one.
function topologyFindings() {
    return currentDiagnosis().findings.slice();
}

// The engine's entry for a device on screen, or a run of the checks for one
// that is not (a node object a caller built itself).
function nodeDiagnosis(node, diag) {
    const entry = (diag || currentDiagnosis()).nodes.get(node && node.id);
    if (entry && entry.node === node) return entry;
    // Indexed like a full pass: a lone run is still one walk per check.
    const results = withLookupPass(() => {
        const ctx = reachContext();
        const out = {};
        NODE_CHECKS.forEach((c) => { out[c.key] = runNodeCheck(c, node, ctx); });
        return out;
    });
    const issues = interfaceIssues(node, results);
    return { node, issues, severity: !issues.length ? null : issues.some((i) => i.level === 'bad') ? 'bad' : 'warn',
        checks: NODE_CHECKS.map((c) => ({ key: c.key, label: t(c.label), ...results[c.key] })) };
}
const nodeChecks = (node) => nodeDiagnosis(node).checks;

// ---- Grouping, for the panel ----
// At 300 devices one wrong gateway is 300 lines that say the same thing. The
// panel groups findings by check, and inside a group, findings that read the
// same apart from the device become one item naming the devices. Critical
// groups first; otherwise the order the checks ran in.
function groupFindings(findings) {
    const groups = new Map();
    findings.forEach((f) => {
        if (!groups.has(f.key)) groups.set(f.key, { key: f.key, check: f.check, level: f.level, findings: [], items: new Map() });
        const g = groups.get(f.key);
        if (f.level === 'bad') g.level = 'bad';
        g.findings.push(f);
        const itemKey = `${f.level}\u0000${f.detail}`;
        if (!g.items.has(itemKey)) g.items.set(itemKey, { key: `${f.key}\u0000${itemKey}`, level: f.level, detail: f.detail, findings: [] });
        g.items.get(itemKey).findings.push(f);
    });
    const list = [...groups.values()].map((g) => ({ ...g, items: [...g.items.values()] }));
    return list.filter((g) => g.level === 'bad').concat(list.filter((g) => g.level !== 'bad'));
}

// What a click on an item visits, in order: the link for a cable finding, the
// devices for everything else. Repeated clicks step through them.
function findingTargets(item) {
    const out = [];
    const seen = new Set();
    item.findings.forEach((f) => {
        const targets = f.linkIds.length ? f.linkIds.map((id) => ({ type: 'link', id })) : f.nodeIds.map((id) => ({ type: 'node', id }));
        targets.forEach((tg) => { const k = `${tg.type}:${tg.id}`; if (!seen.has(k)) { seen.add(k); out.push(tg); } });
    });
    return out;
}

// The group's header already names the check, so a line that would open with
// it again ("IP Conflict: …" under "IP Conflict") drops the repeat; the report
// and the line field keep it.
function findingItemText(item) {
    if (item.findings.length === 1) {
        const f = item.findings[0];
        const prefix = `${f.check}: `;
        return f.line.startsWith(prefix) ? f.detail.charAt(0).toUpperCase() + f.detail.slice(1) : f.line;
    }
    const names = item.findings.map((f) => f.subject);
    const shown = names.length > 3
        ? t('{names} and {n} more', { names: names.slice(0, 3).join(', '), n: names.length - 3 })
        : names.join(', ');
    return `${shown}: ${item.detail}`;
}

// ---- The Findings tab ----
// The list used to float over the map's top-right corner, where at site scale
// it covered the very devices it named and had to be hidden (and forgotten)
// to work. It is docked now: a tab of the rail beside Configuration,
// Diagnostics and Subnets, with the open findings grouped by check, then the
// accepted ones with their reasons. On the map a small pill counts what is
// open and opens the tab (on a phone, the drawer with it).
//
// Which groups the person opened or closed, by check: the tab is rebuilt on
// every render, and a group that snapped shut on each click would be
// unusable. Kept in localStorage beside the other panel preferences (a UI
// choice, so not in the document or a share link), and in memory alone when
// storage is blocked. Where a step-through click has got to, by item, is for
// the session only.
const PANEL_OPEN_KEY = 'nettopo_alert_groups';
const panelOpen = (() => {
    try {
        const saved = JSON.parse(localStorage.getItem(PANEL_OPEN_KEY) || '{}');
        return new Map(Object.entries(saved && typeof saved === 'object' ? saved : {}).filter(([, v]) => typeof v === 'boolean'));
    } catch (e) { return new Map(); }
})();
function savePanelOpen() {
    try { localStorage.setItem(PANEL_OPEN_KEY, JSON.stringify(Object.fromEntries(panelOpen))); } catch (e) { /* private mode */ }
}
const panelCursor = new Map();
let panelGroups = [];
let panelAccepted = [];   // [{ index, entry, findings }], as the Accepted list shows them

// The accepted entries, each with the findings it covers now. An entry that
// covers nothing at the moment (the fault was fixed, or not raised yet) is
// still listed, so a reason nobody can see never decides what counts.
function acceptedGroups(findings) {
    return acceptedList().map((entry, index) => ({ index, entry,
        findings: findings.filter((f) => f.accepted && f.accepted.index === index) }));
}

function validateTopology(diag) {
    const msgList = document.getElementById('conflictMsgList');
    if (!msgList) return;
    const all = (diag || currentDiagnosis()).findings;
    const findings = all.filter(isOpenFinding);

    if (!msgList.dataset.wired) {
        msgList.dataset.wired = '1';
        msgList.addEventListener('click', onFindingClick);
        document.getElementById('acceptedList').addEventListener('click', onAcceptedClick);
    }

    panelGroups = groupFindings(findings);
    // Small lists open in full; past that, critical groups and the groups
    // short enough to read at a glance (counted in lines, so 300 devices
    // with one wrong gateway is one line), and a group the person
    // toggled stays as left.
    const small = findings.length <= 8;
    // Accepting changes the document, so it is offered only where an edit
    // would be kept: not on a read-only network.
    const canAccept = !state.readOnly;
    msgList.innerHTML = panelGroups.map((g, gi) => {
        const open = panelOpen.has(g.key) ? panelOpen.get(g.key) : (small || g.level === 'bad' || g.items.length <= 3);
        const items = g.items.map((item, ii) => {
            const many = findingTargets(item).length > 1;
            return `<li class="ca-item ${item.level}"><button type="button" class="ca-line" data-g="${gi}" data-i="${ii}"
                title="${escapeHtml(t(many ? 'Show on the map (click again for the next one)' : 'Show on the map'))}">${escapeHtml(findingItemText(item))}</button>${canAccept
                ? `<button type="button" class="link-btn quiet ca-accept" data-g="${gi}" data-i="${ii}" title="${escapeHtml(t('Keep this finding as known, with a reason. It stays listed but no longer counts.'))}">${escapeHtml(t('Accept…'))}</button>` : ''}</li>`;
        }).join('');
        return `<li class="ca-group ${g.level}">
            <button type="button" class="ca-group-head" data-g="${gi}" aria-expanded="${open}">
                <span class="ca-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>
                <span class="ca-check">${escapeHtml(g.check)}</span>
                <span class="ca-count">${g.findings.length}</span>
            </button>
            <ul class="ca-items"${open ? '' : ' hidden'}>${items}</ul>
        </li>`;
    }).join('');

    panelAccepted = acceptedGroups(all);
    const acceptedBox = document.getElementById('acceptedBox');
    acceptedBox.classList.toggle('hidden', !panelAccepted.length);
    document.getElementById('acceptedSummary').textContent = t('Accepted: {n}', { n: panelAccepted.reduce((n, a) => n + Math.max(1, a.findings.length), 0) });
    document.getElementById('acceptedList').innerHTML = panelAccepted.map((a, ai) => {
        const lines = a.findings.length
            ? groupFindings(a.findings).flatMap((g) => g.items.map((item) => `${g.check}: ${findingItemText(item)}`))
            : [`${findingCheckName(a.entry.check)}: ${t('Not raised at the moment.')}`];
        return `<li class="ca-item accepted">
            <button type="button" class="ca-line" data-a="${ai}" title="${escapeHtml(t('Show on the map'))}"${a.findings.length ? '' : ' disabled'}>${lines.map(escapeHtml).join('<br>')}</button>
            <p class="ca-reason">${escapeHtml(t('Reason: {reason}', { reason: a.entry.reason }))}</p>
            ${canAccept ? `<button type="button" class="link-btn quiet ca-reopen" data-a="${ai}">${escapeHtml(t('Reopen'))}</button>` : ''}
        </li>`;
    }).join('');

    document.getElementById('findingsEmpty').classList.toggle('hidden', findings.length > 0);
    const worst = findings.some((f) => f.level === 'bad') ? 'bad' : findings.length ? 'warn' : '';
    const count = document.getElementById('findTabCount');
    count.textContent = findings.length ? String(findings.length) : '';
    count.className = `cfg-count ${worst}${findings.length ? '' : ' hidden'}`;
    document.getElementById('conflictPillCount').textContent = String(findings.length);
    const pill = document.getElementById('conflictPill');
    pill.classList.toggle('hidden', !findings.length);
    pill.classList.toggle('bad', worst === 'bad');
}

// The tab, from the pill, the A key or a test. On a phone the rail is a
// drawer (carino-ui.js), opened through its own toggle so the drawer's
// aria-expanded stays honest.
function openFindingsTab() {
    if (isReduced()) return;
    showConfigTab('findings');
    const ws = document.querySelector('.topo-ws');
    if (ws && window.matchMedia('(max-width: 900px)').matches && !ws.classList.contains('drawer-open')) {
        const toggle = document.querySelector('[data-ws-toggle]');
        if (toggle) toggle.click();
    }
}
// A on the keyboard: to the Findings tab, and from it back to Configuration.
function toggleFindingsTab() {
    if (findingsTabShown()) showConfigTab('config');
    else openFindingsTab();
}
const findingsTabShown = () => document.getElementById('findTabBtn')?.getAttribute('aria-selected') === 'true';

// On a phone the drawer covers the map: a line clicked there closes it, so
// the device it centres on is in sight.
function showFindingOnMap(target) {
    const ws = document.querySelector('.topo-ws');
    if (ws && ws.classList.contains('drawer-open') && window.matchMedia('(max-width: 900px)').matches) {
        const toggle = document.querySelector('[data-ws-toggle]');
        if (toggle) toggle.click();
    }
    focusOnMap(target);
}

async function onFindingClick(e) {
    const head = e.target.closest('.ca-group-head');
    if (head) {
        const g = panelGroups[Number(head.dataset.g)];
        if (!g) return;
        const open = head.getAttribute('aria-expanded') !== 'true';
        panelOpen.set(g.key, open);
        savePanelOpen();
        head.setAttribute('aria-expanded', String(open));
        head.querySelector('.ca-caret').textContent = open ? '▾' : '▸';
        head.nextElementSibling.hidden = !open;
        return;
    }
    const accept = e.target.closest('.ca-accept');
    if (accept) {
        const g = panelGroups[Number(accept.dataset.g)];
        const item = g && g.items[Number(accept.dataset.i)];
        if (item) await askAcceptReason(item);
        return;
    }
    const line = e.target.closest('.ca-line');
    if (!line) return;
    const g = panelGroups[Number(line.dataset.g)];
    const item = g && g.items[Number(line.dataset.i)];
    if (!item) return;
    stepThrough(item.key, findingTargets(item));
}
function stepThrough(key, targets) {
    if (!targets.length) return;
    const step = panelCursor.get(key) || 0;
    panelCursor.set(key, step + 1);
    showFindingOnMap(targets[step % targets.length]);
}

// The reason is asked for, and required: an accept nobody can explain later
// is a finding swept under the rug, which is what this must not become.
async function askAcceptReason(item) {
    const what = findingItemText(item);
    const reason = await askPrompt(t('Why is this accepted? The reason is kept with the network and printed in the report.\n\n{finding}', { finding: what }),
        { title: t('Accept a finding'), ok: t('Accept') });
    if (reason === null) return false;
    if (!reason.trim()) { showToast(t('Nothing was accepted: a reason is needed.')); return false; }
    const done = acceptFindings(item.findings, reason);
    if (done) showToast(t('Accepted. It stays listed under Accepted and no longer counts.'), 'ok');
    return done;
}

function onAcceptedClick(e) {
    const reopen = e.target.closest('.ca-reopen');
    const a = panelAccepted[Number((reopen || e.target.closest('.ca-line') || {}).dataset?.a)];
    if (!a) return;
    if (reopen) {
        if (reopenAccepted(a.index)) showToast(t('Reopened: it counts again.'), 'ok');
        return;
    }
    stepThrough(`accepted\u0000${a.index}`, findingTargets({ findings: a.findings }));
}
