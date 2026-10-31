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
            try { return byIp.get(parseIpOrThrow(String(ipString || '').trim()).toString()) || null; } catch (e) { return null; }
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
    // about the former (isSocketPort, js/model.js: the rack view's and the
    // report's port rings ask the same).
    const isSocket = (ifaceId) => isSocketPort(node, ifaceId);
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

    // What the radios say about themselves (iface.radio): a channel the band
    // does not have, a width it cannot take, 6 GHz on a standard without it.
    // The device's own settings, so they are its badge and its verdict here,
    // not a relational finding.
    const settings = radioSettingProblems(node);
    if (problems.length) {
        const text = t('{problems}. Wi-Fi needs a wireless NIC (wlan0, wlp1s0); cables need an Ethernet port.', { problems: problems.join('; ') });
        return { level: 'bad', text: settings.length ? text + ' ' + settings.join(' ') : text };
    }
    if (settings.length) return { level: 'bad', text: settings.join(' ') };
    const radios = getInterfaces(node).filter(ifaceIsWireless).length;
    if (!linksAtNode(node.id).length) return { level: 'info', text: t('No links attached.') };
    const key = !radios ? 'Links match their interface type.'
        : radios === 1 ? 'Links match their interface type ({n} radio).'
            : 'Links match their interface type ({n} radios).';
    return { level: 'good', text: t(key, { n: radios }) };
}

// A radio's own settings, checked against its band and its standard (the
// tables are js/model.js "Wi-Fi"): the channel must be one the band has, the
// width one the band and the standard can bond, and a radio listing 6 GHz
// must be Wi-Fi 6E or 7. Blank is auto and unknown, never a fault. One
// sentence per fault, naming the interface.
const WIFI_6G_STANDARDS = ['axe', 'be'];
const WIFI_CHANNEL_RANGES = {
    '2.4': '{iface} is on channel {ch}, which 2.4 GHz does not have (1 to 14).',
    5: '{iface} is on channel {ch}, which 5 GHz does not have (36 to 144 and 149 to 177, in steps of 4).',
    6: '{iface} is on channel {ch}, which 6 GHz does not have (1 to 233, in steps of 4: 1, 5, 9…).'
};
function radioSettingProblems(node) {
    const out = [];
    getInterfaces(node).forEach((iface) => {
        const radio = ifaceIsWireless(iface) ? radioOf(iface) : null;
        if (!radio) return;
        const name = iface.name || 'radio';
        const std = radio.standard;
        (radio.bands || []).forEach((b) => {
            if (b.channel !== undefined && !wifiChannelValid(b.band, b.channel)) out.push(t(WIFI_CHANNEL_RANGES[b.band], { iface: name, ch: b.channel }));
            if (b.width === undefined || wifiWidthValid(b.band, b.width, std)) return;
            if (b.band === '2.4' && b.width > 40) out.push(t('{iface}: 2.4 GHz is at most 40 MHz wide, not {width} MHz.', { iface: name, width: b.width }));
            else if (b.width === 320 && b.band !== '6') out.push(t('{iface}: 320 MHz is on 6 GHz only, not on {band}.', { iface: name, band: wifiBandName(b.band) }));
            else out.push(t('{iface}: {standard} bonds at most {max} MHz, not {width} MHz.', { iface: name, standard: wifiStandardName(std), max: WIFI_STANDARD_INFO[std].maxWidth, width: b.width }));
        });
        if (std && !WIFI_6G_STANDARDS.includes(std) && radioBand(radio, '6')) {
            out.push(t('{iface} lists 6 GHz, but {standard} has no 6 GHz: that takes Wi-Fi 6E or Wi-Fi 7.', { iface: name, standard: wifiStandardName(std) }));
        }
    });
    return out;
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
        gwIp = parseIpOrThrow(gw);
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
            parsed = parseIpOrThrow(dnsIp);
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

// diag: optional, the document's diagnosis from the same synchronous render
// (renderCanvasOnly's), so the panel does not build the memo key again.
// Without it the panel asks currentDiagnosis() as before.
function renderNodeDiagnostics(node, diag) {
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
    const checks = nodeChecks(node, diag)
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

function refreshSelectedNodeDiagnostics(diag) {
    if (!state.selectedId || state.selectedType !== 'node') {
        renderNodeDiagnostics(null);
        return;
    }

    renderNodeDiagnostics(getNode(state.selectedId), diag);
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
        if (ownGw) { try { const g = parseIpOrThrow(ownGw).toString(); ips.forEach(i => { const c = parseValidCIDR(g + '/' + i.prefix); if (c && c.networkStr === i.networkStr) gwNet = i.networkStr; }); } catch (e) {} }
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
        const gwIp = parseIpOrThrow(gw);
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
// The groups are read the same way, for the same reason: a scratch copy's
// devices name the document's groups, and read as having none, every device
// placed in a rack would preview as a new "rack fields without a rack".
// The Wi-Fi networks likewise: a scratch copy's links name the document's.
function diagnoseDoc(doc) {
    if (!doc) return withLookupPass(runDiagnosis);
    const held = { nodes: state.nodes, links: state.links, networks: state.networks, groups: state.groups, wifi: state.wifi, accepted: state.accepted };
    try {
        state.nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
        state.links = Array.isArray(doc.links) ? doc.links : [];
        state.networks = Array.isArray(doc.networks) ? doc.networks : [];
        if (Array.isArray(doc.groups)) state.groups = doc.groups;
        if (Array.isArray(doc.wifi)) state.wifi = doc.wifi;
        if (Array.isArray(doc.accepted)) state.accepted = doc.accepted;
        return withLookupPass(runDiagnosis);
    } finally {
        state.nodes = held.nodes; state.links = held.links; state.networks = held.networks; state.groups = held.groups; state.wifi = held.wifi; state.accepted = held.accepted;
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
    upkeepFindings().forEach(add);
    placeFindings().forEach(add);
    hostFindings().forEach(add);
    wifiFindings().forEach(add);

    // Each finding says whether it was accepted, and why: { reason, index }
    // (the entry's place in state.accepted, which the Findings tab's Reopen
    // removes), or null while it is open.
    findings.forEach((f) => {
        const entry = acceptedEntryFor(accepted, f.key, f.nodeIds, f.linkIds, f.scope);
        f.accepted = entry ? { reason: entry.reason, index: accepted.indexOf(entry), until: entry.until || '' } : null;
        // Open again because its schedule ran out: what was planned, and when.
        const lapsed = entry ? null : lapsedEntryFor(accepted, f.key, f.nodeIds, f.linkIds, f.scope);
        f.lapsed = lapsed ? { reason: lapsed.reason, until: lapsed.until } : null;
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
//
// Where the devices alone do not say which finding it was, the finding has a
// scope and the entry keeps it (v12, with Wi-Fi): the network a security
// finding is about (the same three APs broadcast Staff and Guest, and
// accepting Staff's WEP must not accept Guest turning open), and the band of
// an overlap (accepting two APs sharing 2.4 GHz is not accepting them on
// 5 GHz). No scope matches only no scope, so every older entry reads as it
// did. An IP or a MAC conflict is scoped to the address too (v14): without
// it, accepting "10.0.0.5 shared by A, B" also accepted any conflict A and B
// came to have later, and a new critical finding was born accepted. Entries
// written before that are given their address when read
// (scopeLegacyConflicts, below).
//
// Scheduled (v14): an entry with `until` (a date) is accepted up to and
// including that day, and from the next one it no longer matches, so the
// finding counts again by itself: "the client replaces it in March" needs
// nobody to remember it. The lapsed entry stays in the document (the file
// does not change by itself); the finding it covered says it was scheduled,
// and when, and scheduling or accepting it again replaces it.
const ACCEPT_REASON_MAX = 300;
const ACCEPT_SCOPE_MAX = 64;
const acceptedList = () => (Array.isArray(state.accepted) ? state.accepted : []);
// The entry and the finding name the same check, scope and things.
const entryCovers = (a, key, nodeIds, linkIds, scope) => a.check === key && (a.scope || '') === (scope || '')
    && (nodeIds || []).every((id) => a.nodeIds.includes(id))
    && (linkIds || []).every((id) => a.linkIds.includes(id));
const entryLapsed = (a, today = todayISO()) => !!a.until && a.until < today;
function acceptedEntryFor(accepted, key, nodeIds, linkIds, scope) {
    if (!accepted.length || !((nodeIds || []).length + (linkIds || []).length)) return null;
    const today = todayISO();
    return accepted.find((a) => !entryLapsed(a, today) && entryCovers(a, key, nodeIds, linkIds, scope)) || null;
}
// The schedule that lapsed on a finding now open again, or null.
function lapsedEntryFor(accepted, key, nodeIds, linkIds, scope) {
    if (!accepted.length || !((nodeIds || []).length + (linkIds || []).length)) return null;
    const today = todayISO();
    return accepted.filter((a) => entryLapsed(a, today) && entryCovers(a, key, nodeIds, linkIds, scope))
        .sort((a, b) => (a.until < b.until ? 1 : -1))[0] || null;
}
const isOpenFinding = (f) => !f.accepted;
// What the counts count: an open finding that says something is wrong. An
// info one (a rack's untagged cables) is listed in the Findings tab and the
// spreadsheet, but it is no fault: it raises no pill, no badge, no total.
const isCountedFinding = (f) => isOpenFinding(f) && f.level !== 'info';

// Read from a document: only the four fields (and a scope that is text), ids
// as strings, a reason that is text and not empty. Anything else is dropped, as the serializer's
// allowlist drops an unknown key.
function normalizeAccepted(list) {
    const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : []);
    return (Array.isArray(list) ? list : []).map((a) => {
        if (!a || typeof a !== 'object' || typeof a.check !== 'string' || !a.check) return null;
        const reason = typeof a.reason === 'string' ? a.reason.trim().slice(0, ACCEPT_REASON_MAX) : '';
        const out = { check: a.check, nodeIds: ids(a.nodeIds), linkIds: ids(a.linkIds), reason };
        const scope = typeof a.scope === 'string' ? a.scope.trim().slice(0, ACCEPT_SCOPE_MAX) : '';
        if (scope) out.scope = scope;
        const until = typeof a.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.until) ? customDate(a.until) : null;
        if (until) out.until = until;
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
        if (n.length || l.length) out.push({ check: a.check, scope: a.scope, nodeIds: n.length ? n : undefined, linkIds: l.length ? l : undefined, reason: a.reason, until: a.until });
    });
    return out.length ? out : undefined;
}

// The name a check goes by in the tab and the report, for an accepted entry
// that matches nothing at the moment (there is no finding to borrow it from).
const FINDING_CHECK_NAMES = { 'ip-conflict': 'IP Conflict', 'mac-conflict': 'MAC Conflict', cabling: 'Cabling', loop: 'L2 loop',
    'cable-label': 'Cable label', 'asset-tag': 'Asset tag', group: 'Groups', rack: 'Rack', 'rack-tag': 'Cable tags', host: 'Runs on', age: 'Age', service: 'Service', 'service-due': 'Service due',
    'wifi-band': 'Wi-Fi band', 'wifi-ssid': 'SSID', 'wifi-subnet': 'Wi-Fi subnet', 'wifi-overlap': 'Channel overlap', 'wifi-plan': 'Channel plan',
    'wifi-security': 'Wi-Fi security', 'wifi-signal': 'Signal' };
const findingCheckName = (key) => t(FINDING_CHECK_NAMES[key] || (NODE_CHECKS_BY_KEY[key] && NODE_CHECKS_BY_KEY[key].label) || key);

// One undo step: the findings of one line of the tab (the same finding on
// one or more devices), accepted together under one reason. One entry per
// scope among them (almost always one), so no entry covers a scope that was
// not on the line.
// until: a date ('YYYY-MM-DD') schedules them instead: accepted up to and
// including that day. A schedule that lapsed on any of them goes.
function acceptFindings(findings, reason, until) {
    const text = String(reason || '').trim().slice(0, ACCEPT_REASON_MAX);
    const list = (findings || []).filter((f) => f && !f.accepted);
    const day = until ? customDate(until) : null;
    if (!text || !list.length || (until && !day) || readOnlyRefuses()) return false;
    const union = (fs, key) => [...new Set(fs.flatMap((f) => f[key] || []))];
    const scopes = [...new Set(list.map((f) => f.scope || ''))];
    const entries = scopes.map((scope) => {
        const fs = list.filter((f) => (f.scope || '') === scope);
        const entry = { check: list[0].key, nodeIds: union(fs, 'nodeIds'), linkIds: union(fs, 'linkIds'), reason: text };
        if (scope) entry.scope = scope;
        if (day) entry.until = day;
        return entry;
    });
    const today = todayISO();
    const stale = (a) => entryLapsed(a, today) && list.some((f) => entryCovers(a, f.key, f.nodeIds, f.linkIds, f.scope));
    batch(() => {
        state.accepted = acceptedList().filter((a) => !stale(a)).concat(entries);
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

// ---- Pinned for the next visit ----
// A finding pinned is one somebody wants looked at on site: the technician
// opens the network and the Findings tab starts with "To check on the next
// visit", the map marks the devices, and the client's summary lists it as
// planned. Pinning changes no count (a pinned finding is still open, or
// accepted, as it was); it is a note on the record, so it is stored in the
// document (state.pinned, serialized as `pinned`) and travels with the file,
// as an accept's reason does. Each entry is { check, nodeIds, linkIds,
// scope?, note? }, matched to findings as an accepted entry is
// (entryCovers): a service pinned is that service (its scope is the date
// due), and recording it (Serviced today) takes the pin away.
const PIN_NOTE_MAX = 300;
const pinnedList = () => (Array.isArray(state.pinned) ? state.pinned : []);
function normalizePinned(list) {
    const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : []);
    return (Array.isArray(list) ? list : []).map((a) => {
        if (!a || typeof a !== 'object' || typeof a.check !== 'string' || !a.check) return null;
        const out = { check: a.check, nodeIds: ids(a.nodeIds), linkIds: ids(a.linkIds) };
        const scope = typeof a.scope === 'string' ? a.scope.trim().slice(0, ACCEPT_SCOPE_MAX) : '';
        if (scope) out.scope = scope;
        const note = typeof a.note === 'string' ? a.note.trim().slice(0, PIN_NOTE_MAX) : '';
        if (note) out.note = note;
        return out.nodeIds.length || out.linkIds.length ? out : null;
    }).filter(Boolean);
}
// As serializeAccepted: what is gone is left out, and nothing is no key.
function serializePinned(list) {
    const nodeIds = new Set(state.nodes.map((n) => n.id));
    const linkIds = new Set(state.links.map((l) => l.id));
    const out = [];
    normalizePinned(list).forEach((a) => {
        const n = a.nodeIds.filter((id) => nodeIds.has(id)), l = a.linkIds.filter((id) => linkIds.has(id));
        if (n.length || l.length) out.push({ check: a.check, scope: a.scope, nodeIds: n.length ? n : undefined, linkIds: l.length ? l : undefined, note: a.note });
    });
    return out.length ? out : undefined;
}
const pinEntryFor = (f) => pinnedList().find((a) => entryCovers(a, f.key, f.nodeIds, f.linkIds, f.scope)) || null;
// The pins, each with the findings it covers now (none: fixed, or not
// raised at the moment, which the list says rather than hiding the pin).
function pinnedGroups(findings) {
    return pinnedList().map((entry, index) => ({ index, entry,
        findings: findings.filter((f) => entryCovers(entry, f.key, f.nodeIds, f.linkIds, f.scope)) }));
}
// The devices a pin names: the map marks them.
function pinnedNodeIds() {
    return new Set(pinnedList().flatMap((a) => a.nodeIds));
}
// One undo step: the findings of one line, pinned together, with what to
// look at (optional). One entry per scope among them, as an accept.
function pinFindings(findings, note) {
    const list = (findings || []).filter((f) => f && !pinEntryFor(f));
    if (!list.length || readOnlyRefuses()) return false;
    const text = String(note || '').trim().slice(0, PIN_NOTE_MAX);
    const union = (fs, key) => [...new Set(fs.flatMap((f) => f[key] || []))];
    const entries = [...new Set(list.map((f) => f.scope || ''))].map((scope) => {
        const fs = list.filter((f) => (f.scope || '') === scope);
        const entry = { check: list[0].key, nodeIds: union(fs, 'nodeIds'), linkIds: union(fs, 'linkIds') };
        if (scope) entry.scope = scope;
        if (text) entry.note = text;
        return entry;
    });
    batch(() => {
        state.pinned = pinnedList().concat(entries);
        save(); renderCanvasOnly();
    });
    return true;
}
function unpin(index) {
    const list = pinnedList();
    if (!list[index] || readOnlyRefuses()) return false;
    batch(() => {
        state.pinned = list.filter((a, i) => i !== index);
        save(); renderCanvasOnly();
    });
    return true;
}
// Serviced today: the device's last service is today, so the service it was
// due is done. Its pins, accepts and schedules for a service are about that
// service: the device leaves them (an entry naming nobody else goes). One
// undo step.
const SERVICE_CHECKS = ['service', 'service-due'];
function servicedToday(nodeId) {
    const node = getNode(nodeId);
    if (!node || readOnlyRefuses()) return false;
    const leave = (list) => list.map((a) => (SERVICE_CHECKS.includes(a.check) && a.nodeIds.includes(nodeId)
        ? Object.assign({}, a, { nodeIds: a.nodeIds.filter((id) => id !== nodeId) }) : a))
        .filter((a) => a.nodeIds.length || a.linkIds.length);
    batch(() => {
        node.serviced = todayISO();
        state.pinned = leave(pinnedList());
        state.accepted = leave(acceptedList());
        save(); renderCanvasOnly();
    });
    refreshSelectedNodeDiagnostics();
    return true;
}

// ---- The notes kept in step with the document ----
// An accepted entry and a pin name devices and cables by id. The serializers
// leave out the ids that are gone, but the lists in memory are what the
// Findings tab, the report and Serviced today read: a pin whose devices were
// all deleted stayed on the list as "Service: n_lx3k9a · Not raised at the
// moment", and Serviced today found nothing to take it off. So they are
// pruned the way the serializers prune: save() calls this (every removal of a
// device or a cable ends there, as the host rule does), and so does reading a
// document, for a file that names ids it does not hold. An entry left naming
// nothing goes. A list is only replaced when something in it changed.
function pruneFindingNotes() {
    const nodeIds = new Set(state.nodes.map((n) => n.id));
    const linkIds = new Set(state.links.map((l) => l.id));
    const prune = (list) => {
        let changed = false;
        const out = [];
        list.forEach((a) => {
            const was = { n: a.nodeIds || [], l: a.linkIds || [] };
            const n = was.n.filter((id) => nodeIds.has(id)), l = was.l.filter((id) => linkIds.has(id));
            if (n.length === was.n.length && l.length === was.l.length) { out.push(a); return; }
            changed = true;
            if (n.length || l.length) out.push(Object.assign({}, a, { nodeIds: n, linkIds: l }));
        });
        return changed ? out : list;
    };
    state.accepted = prune(acceptedList());
    state.pinned = prune(pinnedList());
}

// ---- Conflicts accepted before they had a scope ----
// Before v14 an IP or a MAC conflict carried no scope, so its entry named
// only the devices, and it covered any conflict between them: accepting
// "10.0.0.5 shared by A, B" accepted A and B on 10.0.0.9 the day that came
// about. Documents written then hold such entries, and neither plain reading
// of them is right: kept as they are, they match no scoped finding and every
// one reopens on the upgrade; matched as before, they over-cover for good.
// So an entry with no scope is given, as it is read, each address its
// devices share in the document (one entry per address; almost always one),
// and an entry whose devices share none goes, as there is nothing it can
// have been accepting. A retired device counts: its address is the one that
// was accepted, and it comes back with the device. A scoped entry is left
// alone, so reading a document twice changes nothing. This is done on
// reading (loadDocState, js/app.js) rather than in the 13→14 step, so a
// document saved by a v14 build from before the scope reads the same way;
// the next save writes the scoped entries. Pins are read the same way.
const SCOPED_CONFLICTS = ['ip-conflict', 'mac-conflict'];
// The addresses (IPs as written by ipConflictFindings, MACs normalised) that
// two or more of these devices hold.
function sharedConflictScopes(check, nodeIds) {
    const ids = new Set(nodeIds || []);
    const nodes = state.nodes.filter((n) => ids.has(n.id));
    if (check === 'mac-conflict') {
        return duplicateMacs(nodes).filter((d) => new Set(d.holders.map((h) => h.node.id)).size > 1).map((d) => d.hex);
    }
    const held = new Map();
    nodes.forEach((n) => getValidIps(n).forEach((p) => {
        const ip = p.ip.toString();
        if (!held.has(ip)) held.set(ip, new Set());
        held.get(ip).add(n.id);
    }));
    return [...held].filter(([, holders]) => holders.size > 1).map(([ip]) => ip);
}
function scopeLegacyConflicts(list) {
    const legacy = (a) => SCOPED_CONFLICTS.includes(a.check) && !a.scope;
    if (!Array.isArray(list) || !list.some(legacy)) return list;
    return list.flatMap((a) => (legacy(a)
        ? sharedConflictScopes(a.check, a.nodeIds).map((scope) => Object.assign({}, a, { scope }))
        : [a]));
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
        // Scoped to the address: what is accepted is A and B on this one, not
        // whatever A and B come to share later.
        out.push({ key: 'ip-conflict', level: 'bad', check: t('IP Conflict'), subject: names, detail,
            line: `${t('IP Conflict')}: ${detail}`, nodeIds: list.map((n) => n.id), scope: ip });
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
            detail, line: `${t('MAC Conflict')}: ${detail}`, nodeIds: ids, scope: d.hex });   // the address, as an IP conflict's
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

// ---- Age and upkeep (js/model.js "Age and upkeep") ----
// age: in service as long as its type usually lasts, or longer (its own
// expected life, when it has one). Advisory: it works, but it is the next
// thing to fail and the next thing to budget for.
// service: its service was due and has not been recorded. Advisory, and
// critical once a whole interval has gone by since (missed twice over).
// service-due: due within SERVICE_SOON_DAYS. A note, not counted, so the
// technician sees it coming.
// The service findings are scoped to the date due: accepting one ("the
// vendor comes on the 12th") covers that service only, and the next one,
// once this is recorded, is a finding again. Worked out from today's date
// (upkeepState), so the same file says more as it gets older.
function upkeepFindings(today = todayISO()) {
    const out = [];
    const ago = (days) => (days < 60 ? t('{n} days ago', { n: days })
        : days < 730 ? t('about {n} months ago', { n: Math.round(days / 30.4) }) : t('about {n} years ago', { n: Math.round(days / 365.25) }));
    state.nodes.forEach((node) => {
        const st = upkeepState(node, today);
        const name = node.name || node.id;
        if (st.old) {
            out.push({ key: 'age', level: 'warn', check: t('Age'), subject: name, nodeIds: [node.id],
                detail: t('In service for {age}, and expected to last {life} years. Plan its replacement.', { age: ageText(st.old), life: st.old.life }) });
        }
        const s = st.service;
        if (!s || !s.level) return;
        if (s.level === 'info') {
            out.push({ key: 'service-due', level: 'info', check: t('Service due'), subject: name, nodeIds: [node.id], scope: s.due,
                detail: s.days === 0 ? t('Due for service today.', { name })
                    : t('Due for service on {date}, in {n} days.', { name, date: s.due, n: s.days }) });
            return;
        }
        out.push({ key: 'service', level: s.level, check: t('Service'), subject: name, nodeIds: [node.id], scope: s.due,
            detail: s.level === 'bad'
                ? t('Was due for service on {date}, {ago}. A whole interval has gone by since, so the next one is due as well.', { name, date: s.due, ago: ago(-s.days) })
                : t('Was due for service on {date}, {ago}.', { name, date: s.due, ago: ago(-s.days) }) });
    });
    return out;
}

// ---- Groups and racks (js/model.js "Groups") ----
// group: groups whose parent chain comes back round. The loader cuts every
// such loop (repairGroupParents) and every re-parent asks groupParentOk()
// first, so on a document opened here this does not fire; it is for a
// scratch copy that did not come through the loader, so that a loop that got
// through says so rather than leaving a tree nothing can draw.
// rack: a device placed below the first unit or above the rack's last, one
// whose lowest unit is in the rack but whose height takes it past the top,
// and a device with a rack position whose group is not a rack (or that is in
// no group), which is a position nobody can find. Then two devices in the
// same units (step C): on the same face, or on either when one of them fills
// the depth (rackOverlaps, js/model.js). The rack view refuses to make an
// overlap; a spreadsheet, a file or the device editor's fields can still say
// one, and it is critical: one of the two is not where the register says. A
// retired device is not exempt: it is in the rack until somebody takes it out.
function placeFindings() {
    const out = [];
    const groups = Array.isArray(state.groups) ? state.groups : [];
    const byId = new Map(groups.map((g) => [g.id, g]));
    const looped = new Set();
    groups.forEach((g) => {
        const seen = new Set([g.id]);
        for (let p = byId.get(g.parent); p; p = byId.get(p.parent)) {
            if (p.id === g.id) { looped.add(g.id); break; }
            if (seen.has(p.id)) break;   // a loop further up, reported by its own members
            seen.add(p.id);
        }
    });
    if (looped.size) {
        const names = groups.filter((g) => looped.has(g.id)).map(groupLabel).join(', ');
        const detail = t('These groups are each other\'s parents, so none of them has a place in the tree: {names}.', { names });
        out.push({ key: 'group', level: 'bad', check: t('Groups'), subject: names, detail, line: `${t('Groups')}: ${detail}`,
            nodeIds: state.nodes.filter((n) => n.group && looped.has(n.group)).map((n) => n.id) });
    }
    state.nodes.forEach((node) => {
        if (!hasRackFields(node)) return;
        const g = node.group ? byId.get(node.group) : null;
        const name = node.name || node.id;
        const say = (level, detail) => out.push({ key: 'rack', level, check: t('Rack'), subject: name, detail, nodeIds: [node.id] });
        if (!isRackGroup(g)) {
            say('warn', g ? t('It has a rack position, but {group} is not a rack.', { group: groupLabel(g) })
                : t('It has a rack position, but it is in no rack.'));
            return;
        }
        // Checked on the stored units (from the bottom), worded in the
        // numbers the rack's rails print (rackUnitNo): on a rack numbered
        // from the top, its top is U1.
        const top = Number.isInteger(g.uHeight) ? g.uHeight : RACK_U_DEFAULT;
        // Outside: the unit as the editor's field took it (rackStartNo), so
        // the number is the one somebody typed, not its mirror.
        const h = rackHeightOf(node);
        if (Number.isInteger(node.rackU) && (node.rackU < 1 || node.rackU > top)) {
            say('bad', t('U{u} is outside {rack}, which has units 1 to {top}.', { u: rackStartNo(g, node.rackU, h), rack: groupLabel(g), top }));
        } else if (Number.isInteger(node.rackU) && node.rackU + h - 1 > top) {
            // Numbered from the top, "from U{u}" and "past U{top}" were both
            // about U1 (the bottom unit of a device at the top is printed U1,
            // and so is the top): the bottom unit and how far above the top
            // it reaches say it plainly.
            if (rackTopDown(g)) {
                say('bad', t('It is {h}U tall with its bottom unit at U{u}, so it reaches {n}U above U1, the top of {rack}.',
                    { h, u: rackUnitNo(g, node.rackU), n: node.rackU + h - 1 - top, rack: groupLabel(g) }));
            } else {
                say('bad', t('It is {h}U tall from U{u}, so it goes past U{top}, the top of {rack}.',
                    { h, u: node.rackU, top, rack: groupLabel(g) }));
            }
        }
    });
    groups.filter(isRackGroup).forEach((rack) => rackOverlaps(rack).forEach(({ a, b, full, both }) => {
        const names = `${a.name || a.id}, ${b.name || b.id}`;
        const where = `${rackSpanText(a)}; ${rackSpanText(b)}`;
        // Both full depth on opposite faces: one made half depth still meets
        // the other's back, so the finding says both, not one.
        const detail = both
            ? t('{a} and {b} take the same units of {rack} ({where}), and both fill the rack front to back. To share them, set both to half depth.', { a: a.name || a.id, b: b.name || b.id, rack: groupLabel(rack), where })
            : full
            ? t('{a} and {b} take the same units of {rack} ({where}), and one of them fills the rack front to back.', { a: a.name || a.id, b: b.name || b.id, rack: groupLabel(rack), where })
            : t('{a} and {b} take the same units of {rack} ({where}).', { a: a.name || a.id, b: b.name || b.id, rack: groupLabel(rack), where });
        out.push({ key: 'rack', level: 'bad', check: t('Rack'), subject: names, detail, nodeIds: [a.id, b.id] });
    }));
    // A rack's cables with no tag ("Round 5", R5a): the person at the rack
    // reads a cable by the tag on it, so an untagged one is traced by hand.
    // Info, not advisory: nothing is wrong on the network, it is the register
    // that is thin, so it is listed (once per rack, naming the cables) but
    // never counted where the open findings are (the pill, the tab's count,
    // a card, the report; see isCountedFinding).
    groups.filter(isRackGroup).forEach((rack) => {
        const bare = rackCableLinks(rack).filter((l) => !cableOf(l, 'label').trim());
        if (!bare.length) return;
        const detail = bare.length === 1 ? t('One cable in {rack} has no tag.', { rack: groupLabel(rack) })
            : t('{n} cables in {rack} have no tag.', { n: bare.length, rack: groupLabel(rack) });
        out.push({ key: 'rack-tag', level: 'info', check: t('Cable tags'), subject: groupLabel(rack), detail, linkIds: bare.map((l) => l.id) });
    });
    return out;
}

// ---- Hosts (js/model.js "Hosts") ----
// A VM or a container whose host is retired: the host is off the network
// (the reachability walk neither reaches it nor passes through it), so what
// runs on it is either gone too and should say so, or has moved and the
// register has not caught up. A retired guest on it is the first case,
// already said, and raises nothing.
// A guest in another group than its host: where a VM is follows where its
// host is (repairHosts, run on load and on every save), so in the editor this
// does not fire; it is for a scratch copy that skipped the repair, so a
// document whose VMs say they are in another room than their hypervisor
// says so rather than being drawn in two places at once.
function hostFindings() {
    const out = [];
    const byId = new Map();
    state.nodes.forEach((n) => { if (n && !byId.has(n.id)) byId.set(n.id, n); });
    state.nodes.forEach((node) => {
        if (!node || !node.host || !isVirtualType(node.type)) return;
        const host = byId.get(node.host);
        if (!host || host === node) return;
        const name = node.name || node.id, hostName = host.name || host.id;
        const say = (detail) => out.push({ key: 'host', level: 'warn', check: t('Runs on'), subject: name, detail, nodeIds: [node.id, host.id] });
        if (isRetired(host) && !isRetired(node)) say(t('{name} runs on {host}, which is retired.', { name, host: hostName }));
        // Against its own host: a container on a VM in the wrong room is the
        // VM's finding, not the container's as well.
        if ((node.group || null) !== (host.group || null)) {
            const g = groupById(node.group), hg = groupById(host.group);
            say(t('{name} runs on {host}, but it is in {group} and {host} is in {other}.',
                { name, host: hostName, group: g ? groupPath(g) : t('no group'), other: hg ? groupPath(hg) : t('no group') }));
        }
    });
    return out;
}

// ---- Wi-Fi (Review-Packs/Topo-wifi.md, W2) ----
// The relational half of the Wi-Fi checks; a radio's own settings are its
// Radio verdict (radioSettingProblems). Everything here reads the inference
// the editor shows (linkWifiSsid, linkWifiBand, apBandSsids in js/model.js),
// so the band a finding names is the band the link panel says, and what
// nobody wrote down (no standard, no channel, no signal) is unknown and
// never a fault. A link or a radio on a retired device is off the air. A
// link between two devices that serve radio (a mesh backhaul) has a band
// but no client, so only the band and signal checks read it. Findings of
// one check on the same devices, links and scope are one line
// (mergeSameFindings).
//
//   wifi-band     Problem. A client on a band its AP's radio does not offer
//                 (or its own radio does not have), two ends with no band in
//                 common, and 6 GHz without Wi-Fi 6E or 7 at both ends. A
//                 radio that lists 6 GHz on the wrong standard is already
//                 its own Radio finding, so the link does not repeat it.
//   wifi-ssid     Warning. A link set to an SSID its AP does not broadcast,
//                 or not on that band.
//   wifi-subnet   Problem. The SSID's subnet does not hold the client's
//                 address: the client is drawn on one network and numbered
//                 for another.
//   wifi-overlap  Warning. Two APs on overlapping channels of one band, in
//                 the same room or floor (the nearest group of either kind
//                 they share); with neither in any group, on the same
//                 subnet. Width counts: 36/80 and 44/20 share the air. One
//                 line per band (its scope).
//   wifi-plan     Info. A 2.4 GHz channel off 1, 6 and 11. Listed, never
//                 counted: one AP on 3 is a choice, two are wifi-overlap.
//   wifi-security Warning. Open (OWE is fine: it encrypts), WEP or WPA/TKIP,
//                 on a network an AP broadcasts. One line per network (its
//                 scope), named by it.
//   wifi-signal   Advisory. Weaker than -75 dBm, or -67 for a VoIP phone,
//                 which needs the margin for a call not to break up.
const WIFI_PLAN_24 = [1, 6, 11];
const WIFI_SIGNAL_WEAK = -75;
const WIFI_SIGNAL_VOICE = -67;
const WIFI_WEAK_SECURITY = {
    open: '{ssid} is open: anyone in range can join it and read what it carries. Use WPA2/WPA3, or OWE (Enhanced Open) for a guest network.',
    wep: '{ssid} uses WEP, which free tools break in minutes. Use WPA2/WPA3.',
    wpa: '{ssid} allows WPA (TKIP), which is retired and weak, and which Wi-Fi 6 devices will not use. Use WPA2/WPA3.'
};
const wifiBandsList = (bands) => bands.map(wifiBandName).join(', ');
// "ch 36/80": a radio band's channel and, when set, its width.
const wifiChannelText = (b) => 'ch ' + b.channel + (b.width ? '/' + b.width : '');

function wifiFindings() {
    const out = [];
    const wifi = Array.isArray(state.wifi) ? state.wifi : [];
    const nameOf = (n) => n.name || n.id;

    state.links.forEach((link) => {
        const e = wifiLinkEnds(link);
        if (!e || e.ends.some((end) => isRetired(end.node))) return;
        // The client first, then its AP; between two clients (or two APs
        // with no client) the link's own order.
        const [one, two] = e.ap ? [e.client, e.ap] : e.ends;
        const a = nameOf(one.node), b = nameOf(two.node);
        const say = (key, level, check, detail) => out.push({ key, level, check: t(check), subject: a + ' ↔ ' + b, detail,
            nodeIds: [one.node.id, two.node.id], linkIds: [link.id] });
        const band = linkWifiOf(link, 'band') || linkWifiBand(link, wifi);
        const apRadio = e.ap ? radioOf(e.ap.iface) : null;
        // Two devices that both serve radio (a mesh backhaul) share a band,
        // which is checked, but the far one joins no SSID: its address is a
        // management one, and an SSID typed on the link names no network it
        // is a client of. The SSID and subnet checks are for clients.
        const backhaul = !!e.ap && radioServes(e.client.node);

        // ---- the band ----
        const handled = new Set();
        if (band === '6') {
            e.ends.forEach((end) => {
                const r = radioOf(end.iface);
                const std = r && r.standard;
                if (!std || WIFI_6G_STANDARDS.includes(std)) return;
                handled.add(end);
                if (radioBand(r, '6')) return;   // its own Radio finding says it
                say('wifi-band', 'bad', 'Wi-Fi band', t('{a} and {b} are on 6 GHz, but {name} is {standard}. 6 GHz takes Wi-Fi 6E or Wi-Fi 7 at both ends.',
                    { a, b, name: nameOf(end.node), standard: wifiStandardName(std) }));
            });
        }
        if (e.ap && band) {
            const apBands = radioBands(apRadio);
            if (apBands && !apBands.includes(band) && !handled.has(e.ap)) {
                say('wifi-band', 'bad', 'Wi-Fi band', t('{a} is on {band}, which the radio of {b} does not offer (it has {bands}).',
                    { a, b, band: wifiBandName(band), bands: wifiBandsList(apBands) }));
            }
            const own = radioBands(radioOf(e.client.iface));
            if (own && !own.includes(band) && !handled.has(e.client)) {
                say('wifi-band', 'bad', 'Wi-Fi band', t('{a} is on {band}, but its own radio has only {bands}.',
                    { a, band: wifiBandName(band), bands: wifiBandsList(own) }));
            }
        } else if (e.ap && !band) {
            const x = radioBands(radioOf(e.client.iface)), y = radioBands(apRadio);
            if (x && y && !commonWifiBands(x, y).length) {
                say('wifi-band', 'bad', 'Wi-Fi band', t('{a} and {b} have no band in common: {a} has {bandsA}, {b} has {bandsB}.',
                    { a, b, bandsA: wifiBandsList(x), bandsB: wifiBandsList(y) }));
            }
        }

        // ---- the SSID ----
        const picked = linkWifiOf(link, 'ssid');
        const w = picked ? wifiById(picked, wifi) : null;
        if (e.ap && w && !backhaul) {
            const label = wifiLabel(w);
            if (!apSsids(apRadio, wifi).includes(w.id)) {
                say('wifi-ssid', 'warn', 'SSID', t('{a} is set to {ssid}, but {b} does not broadcast it.', { a, b, ssid: label }));
            } else if (band && (radioBands(apRadio) || WIFI_BANDS).includes(band) && !apBandSsids(apRadio, band, wifi).includes(w.id)) {
                const on = (radioBands(apRadio) || WIFI_BANDS).filter((x) => apBandSsids(apRadio, x, wifi).includes(w.id));
                say('wifi-ssid', 'warn', 'SSID', t('{a} is on {ssid} on {band}, but {b} broadcasts {ssid} only on {bands}.',
                    { a, b, ssid: label, band: wifiBandName(band), bands: wifiBandsList(on) }));
            }
        }

        // ---- the subnet ----
        const ssid = e.client && !backhaul ? linkWifiSsid(link, wifi) : null;
        const net = ssid ? wifiById(ssid, wifi) : null;
        const subnet = net && net.network ? networkById(net.network) : null;
        const p = subnet ? parseValidCIDR(subnet.cidr) : null;
        if (p) {
            // The address on the client's end of the link, else its own
            // addresses of the subnet's family: one inside is enough.
            const endIp = e.client.iface ? parseValidCIDR(e.client.iface.ip) : null;
            const ips = (endIp ? [endIp] : getValidIps(e.client.node)).filter((x) => x.kind === p.kind);
            if (ips.length && !ips.some((x) => ipInParsed(x.ip, p))) {
                say('wifi-subnet', 'bad', 'Wi-Fi subnet', t('{a} is on {ssid}, whose subnet is {cidr}, but its address {ip} is not in it.',
                    { a, ssid: wifiLabel(net), cidr: p.networkStr, ip: ips[0].ip.toString() }));
            }
        }

        // ---- the signal ----
        const signal = linkWifiOf(link, 'signal');
        if (signal !== undefined) {
            const voice = e.ends.some((end) => end.node.type === 'voip' && end !== e.ap);
            const limit = voice ? WIFI_SIGNAL_VOICE : WIFI_SIGNAL_WEAK;
            if (signal < limit) {
                say('wifi-signal', 'warn', 'Signal', voice
                    ? t('{a} hears {b} at {signal} dBm. A phone needs {limit} dBm or better for calls that do not break up.', { a, b, signal, limit })
                    : t('{a} hears {b} at {signal} dBm, weaker than {limit} dBm: expect a slow link that drops. Move one closer, or add an access point.', { a, b, signal, limit }));
            }
        }
    });

    // ---- channels: the plan, and APs sharing the air ----
    // Only devices that serve radio: a client's channel (a controller's
    // export records the one each client is on) is its AP's, and would read
    // as a second AP on top of it. A width the band or standard cannot take
    // already has its Radio Problem; it is spread as 20 MHz here, so a 5 GHz
    // radio set to 320 does not also claim to overlap half the band.
    const cells = [];
    state.nodes.forEach((node) => {
        if (isRetired(node) || !radioServes(node)) return;
        getInterfaces(node).forEach((iface) => {
            const radio = ifaceIsWireless(iface) ? radioOf(iface) : null;
            (radio && radio.bands || []).forEach((band) => {
                if (!wifiChannelValid(band.band, band.channel)) return;
                const b = wifiWidthValid(band.band, band.width, radio.standard) ? band : { band: band.band, channel: band.channel };
                cells.push({ node, iface, b });
                if (b.band === '2.4' && !WIFI_PLAN_24.includes(b.channel)) {
                    const name = nameOf(node);
                    out.push({ key: 'wifi-plan', level: 'info', check: t('Channel plan'), subject: name, nodeIds: [node.id],
                        detail: t('{name} ({iface}) is on 2.4 GHz channel {ch}. Only 1, 6 and 11 stay clear of each other; a channel between them overlaps two.', { name, iface: iface.name || 'radio', ch: b.channel }) });
                }
            });
        });
    });
    // Where two APs share the air: the nearest room or floor they are both
    // in. The subnet they share stands in only while neither is in any
    // group: once the groups are drawn they are the record of where things
    // are, and two APs in different buildings (or racks with no room above
    // them) are not known to be near, however they are numbered. Likewise
    // one placed and one not.
    const placeOf = new Map();
    const placesOf = (node) => {
        if (!placeOf.has(node.id)) {
            const chain = groupChain(groupById(node.group));
            placeOf.set(node.id, chain.length ? chain.filter((g) => g.kind === 'room' || g.kind === 'floor').reverse() : null);
        }
        return placeOf.get(node.id);
    };
    const whereShared = (x, y) => {
        const px = placesOf(x), py = placesOf(y);
        if (px || py) {
            if (!px || !py) return null;
            const ids = new Set(py.map((g) => g.id));
            const g = px.find((c) => ids.has(c.id));
            return g ? groupLabel(g) : null;
        }
        const shared = sharedSubnetOf(x, y);
        return shared && shared !== '__cloud__' ? t('the subnet {net}', { net: shared }) : null;
    };
    for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
            const x = cells[i], y = cells[j];
            if (x.node.id === y.node.id || x.b.band !== y.b.band) continue;
            if (!wifiChannelsOverlap(x.b, y.b)) continue;
            const where = whereShared(x.node, y.node);
            if (!where) continue;
            const a = nameOf(x.node), b = nameOf(y.node), band = wifiBandName(x.b.band);
            const same = x.b.channel === y.b.channel && (x.b.width || 20) === (y.b.width || 20);
            const detail = same
                ? t('{a} and {b} are both on {band} {ch} in {where}: they take turns on the same air and slow each other down.', { a, b, band, ch: wifiChannelText(x.b), where })
                : t('{a} ({chA}) and {b} ({chB}) overlap on {band} in {where}: they take turns on the same air and slow each other down.', { a, b, band, chA: wifiChannelText(x.b), chB: wifiChannelText(y.b), where });
            out.push({ key: 'wifi-overlap', level: 'warn', check: t('Channel overlap'), subject: a + ', ' + b, detail, nodeIds: [x.node.id, y.node.id], scope: x.b.band });
        }
    }

    // ---- security ----
    wifi.forEach((w) => {
        const text = WIFI_WEAK_SECURITY[w.security];
        if (!text) return;
        // Only a network on the air: one no AP broadcasts is a plan, and the
        // finding needs a device to point at (and to be accepted on).
        const aps = wifiBroadcasters(w.id).filter((n) => !isRetired(n));
        if (!aps.length) return;
        const ssid = wifiLabel(w);
        out.push({ key: 'wifi-security', level: 'warn', check: t('Wi-Fi security'), subject: ssid, detail: t(text, { ssid }), nodeIds: aps.map((n) => n.id), scope: w.id });
    });
    return mergeSameFindings(out);
}

// One finding per check, set of devices and links, and scope: a link whose
// band neither the AP nor the client has, or two APs whose two 5 GHz radios
// both overlap, are one line each, their sentences joined. Accepting goes by
// check, devices, links and scope (acceptedEntryFor), so two lines with the
// same ones could only ever be accepted together: accepting the one would
// silently accept the other. The scope keeps apart what must be accepted
// apart (two networks on the same APs, one pair of APs on two bands).
function mergeSameFindings(list) {
    const rank = { bad: 3, warn: 2, info: 1 };
    const byKey = new Map();
    const merged = [];
    list.forEach((f) => {
        const k = [f.key, f.scope || '', (f.nodeIds || []).slice().sort().join(','), (f.linkIds || []).slice().sort().join(',')].join('|');
        const had = byKey.get(k);
        if (!had) { const copy = { ...f }; byKey.set(k, copy); merged.push(copy); return; }
        had.detail += ' ' + f.detail;
        if ((rank[f.level] || 0) > (rank[had.level] || 0)) had.level = f.level;
    });
    return merged;
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
    // state.wifi too: the Wi-Fi checks read a network's security, subnet and
    // bands, so editing only a Wi-Fi network must not give the old findings.
    // Today's date too: the age and service findings change with it.
    // And the network's own expected lives: they decide which device is old.
    const key = `${lang}\u0000${todayISO()}\u0000${JSON.stringify(state.expectedLife || {})}\u0000${JSON.stringify(state.nodes, omitPosition)}\u0000${JSON.stringify(state.links)}\u0000${JSON.stringify(state.networks)}\u0000${JSON.stringify(state.groups || [])}\u0000${JSON.stringify(state.accepted || [])}\u0000${JSON.stringify(state.wifi || [])}`;
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
const nodeChecks = (node, diag) => nodeDiagnosis(node, diag).checks;

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
let panelPinned = [];     // [{ index, entry, findings }], as the visit list shows them
// The devices and cables a pin names, by name: for a pin whose finding is not raised now.
const pinnedNames = (entry) => entry.nodeIds.map((id) => { const n = getNode(id); return n ? n.name || n.id : id; })
    .concat(entry.linkIds.map((id) => {
        const l = getLink(id), a = l && getNode(l.source), b = l && getNode(l.target);
        return l ? `${a ? a.name || a.id : l.source} ↔ ${b ? b.name || b.id : l.target}` : id;
    })).join(', ');

// The accepted entries, each with the findings it covers now. An entry that
// covers nothing at the moment (the fault was fixed, or not raised yet) is
// still listed, so a reason nobody can see never decides what counts.
// A schedule that ran out is not listed: its finding is open again and says so.
function acceptedGroups(findings) {
    const today = todayISO();
    return acceptedList().map((entry, index) => ({ index, entry,
        findings: findings.filter((f) => f.accepted && f.accepted.index === index) }))
        .filter((a) => !entryLapsed(a.entry, today));
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
        document.getElementById('visitList').addEventListener('click', onVisitClick);
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
            const pinned = item.findings.every((f) => pinEntryFor(f));
            const lapsed = item.findings.map((f) => f.lapsed).find(Boolean);
            const at = `data-g="${gi}" data-i="${ii}"`;
            const actions = canAccept ? `<span class="ca-acts">
                <button type="button" class="link-btn quiet ca-accept" ${at} title="${escapeHtml(t('Keep this finding as known, with a reason. It stays listed but no longer counts.'))}">${escapeHtml(t('Accept…'))}</button>
                <button type="button" class="link-btn quiet ca-schedule" ${at} title="${escapeHtml(t('Set it aside until a date, with what is planned. It comes back by itself the day after.'))}">${escapeHtml(t('Schedule…'))}</button>
                <button type="button" class="link-btn quiet ca-pin" ${at} aria-pressed="${pinned}" title="${escapeHtml(t(pinned ? 'Take it off the list for the next visit' : 'Add it to the list to check on the next visit'))}">${escapeHtml(t(pinned ? 'Unpin' : 'Pin'))}</button>
            </span>` : '';
            return `<li class="ca-item ${item.level}"><button type="button" class="ca-line" ${at}
                title="${escapeHtml(t(many ? 'Show on the map (click again for the next one)' : 'Show on the map'))}">${pinned ? '<span class="ca-pinned" aria-hidden="true">📌</span> ' : ''}${escapeHtml(findingItemText(item))}</button>${actions}${lapsed
                ? `<p class="ca-reason">${escapeHtml(t('Was scheduled until {date}: {reason}', { date: lapsed.until, reason: lapsed.reason }))}</p>` : ''}</li>`;
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
            <p class="ca-reason">${escapeHtml(a.entry.until ? t('Scheduled until {date}: {reason}', { date: a.entry.until, reason: a.entry.reason }) : t('Reason: {reason}', { reason: a.entry.reason }))}</p>
            ${canAccept ? `<button type="button" class="link-btn quiet ca-reopen" data-a="${ai}">${escapeHtml(t('Reopen'))}</button>` : ''}
        </li>`;
    }).join('');

    // To check on the next visit: every pin, whatever its finding's state
    // (open, accepted, scheduled, or not raised at the moment).
    panelPinned = pinnedGroups(all);
    document.getElementById('visitBox').classList.toggle('hidden', !panelPinned.length);
    document.getElementById('visitSummary').textContent = t('To check on the next visit: {n}', { n: panelPinned.length });
    document.getElementById('visitList').innerHTML = panelPinned.map((p, pi) => {
        const lines = p.findings.length
            ? groupFindings(p.findings).flatMap((g) => g.items.map((item) => `${g.check}: ${findingItemText(item)}`))
            : [`${findingCheckName(p.entry.check)}: ${pinnedNames(p.entry)} · ${t('Not raised at the moment.')}`];
        const serviceNode = SERVICE_CHECKS.includes(p.entry.check) && p.entry.nodeIds.length === 1 ? p.entry.nodeIds[0] : null;
        return `<li class="ca-item visit ${p.findings.length ? p.findings[0].level : 'gone'}">
            <button type="button" class="ca-line" data-p="${pi}" title="${escapeHtml(t('Show on the map'))}">${lines.map(escapeHtml).join('<br>')}</button>
            ${p.entry.note ? `<p class="ca-reason">${escapeHtml(t('To check: {note}', { note: p.entry.note }))}</p>` : ''}
            ${canAccept ? `<span class="ca-acts">${serviceNode ? `<button type="button" class="link-btn quiet ca-serviced" data-p="${pi}" title="${escapeHtml(t('Record that it was serviced today'))}">${escapeHtml(t('Serviced today'))}</button>` : ''}
                <button type="button" class="link-btn quiet ca-unpin" data-p="${pi}">${escapeHtml(t('Unpin'))}</button></span>` : ''}
        </li>`;
    }).join('');

    document.getElementById('findingsEmpty').classList.toggle('hidden', findings.length > 0);
    // Counted: what is wrong. An info finding is in the list, not the count.
    const counted = findings.filter(isCountedFinding);
    const worst = counted.some((f) => f.level === 'bad') ? 'bad' : counted.length ? 'warn' : '';
    const count = document.getElementById('findTabCount');
    count.textContent = counted.length ? String(counted.length) : '';
    count.className = `cfg-count ${worst}${counted.length ? '' : ' hidden'}`;
    document.getElementById('conflictPillCount').textContent = String(counted.length);
    const pill = document.getElementById('conflictPill');
    pill.classList.toggle('hidden', !counted.length);
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
    const schedule = e.target.closest('.ca-schedule');
    if (schedule) {
        const g = panelGroups[Number(schedule.dataset.g)];
        const item = g && g.items[Number(schedule.dataset.i)];
        if (item) await askSchedule(item);
        return;
    }
    const pin = e.target.closest('.ca-pin');
    if (pin) {
        const g = panelGroups[Number(pin.dataset.g)];
        const item = g && g.items[Number(pin.dataset.i)];
        if (item) await togglePin(item);
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

// Scheduled: accepted until a date, with what is planned (both needed: a
// date with no plan is a finding put off, and a plan with no date is an
// accept). The date is today or later; the finding is back the day after.
async function askSchedule(item) {
    const what = findingItemText(item);
    const today = todayISO();
    const answer = await askPromptDate(t('What is planned, and until when should it wait? It stops counting until that day and comes back by itself the day after.\n\n{finding}', { finding: what }),
        { title: t('Schedule a finding'), ok: t('Schedule'),
          date: { label: t('Until'), value: todayISO(new Date(Date.now() + 30 * 86400000)), min: today } });
    if (answer === null) return false;
    if (!answer.value.trim()) { showToast(t('Nothing was scheduled: say what is planned.')); return false; }
    const day = customDate(answer.date);
    if (!day || day < today) { showToast(t('Nothing was scheduled: pick a day from today on.')); return false; }
    const done = acceptFindings(item.findings, answer.value, day);
    if (done) showToast(t('Scheduled until {date}. It comes back by itself the day after.', { date: day }), 'ok');
    return done;
}
// Pin with what to look at (optional), or unpin when every finding of the
// line is pinned already.
async function togglePin(item) {
    if (item.findings.every((f) => pinEntryFor(f))) {
        const drop = new Set(item.findings.map(pinEntryFor));
        const list = pinnedList();
        if (readOnlyRefuses()) return false;
        batch(() => { state.pinned = list.filter((a) => !drop.has(a)); save(); renderCanvasOnly(); });
        showToast(t('Taken off the list for the next visit.'), 'ok');
        return true;
    }
    const note = await askPrompt(t('What should be checked on the next visit? (optional)\n\n{finding}', { finding: findingItemText(item) }),
        { title: t('Pin for the next visit'), ok: t('Pin') });
    if (note === null) return false;
    const done = pinFindings(item.findings, note);
    if (done) showToast(t('Pinned: it is on the list to check on the next visit.'), 'ok');
    return done;
}
function onVisitClick(e) {
    const btn = e.target.closest('.ca-unpin, .ca-serviced, .ca-line');
    const p = btn && panelPinned[Number(btn.dataset.p)];
    if (!p) return;
    if (btn.classList.contains('ca-unpin')) { if (unpin(p.index)) showToast(t('Taken off the list for the next visit.'), 'ok'); return; }
    if (btn.classList.contains('ca-serviced')) {
        if (servicedToday(p.entry.nodeIds[0])) showToast(t('Serviced today: recorded, and off the list.'), 'ok');
        return;
    }
    const targets = p.findings.length ? findingTargets({ findings: p.findings })
        : p.entry.nodeIds.filter(getNode).map((id) => ({ type: 'node', id })).concat(p.entry.linkIds.filter(getLink).map((id) => ({ type: 'link', id })));
    stepThrough(`pinned\u0000${p.index}`, targets);
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
