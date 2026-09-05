// Reachability and the checks behind the node badges.
// Load order: state -> model -> data -> diagnostics -> ui -> app

// The port the trace is actually filtering by. A port only applies when it is
// both typed in AND its toggle is on, so a user can suspend port filtering
// without clearing the port they entered. Blank string means "IP reachability
// only" — every reader below already treats that as no filter.
function activeTracePort() {
    const toggle = document.getElementById('tracePortToggle');
    if (toggle && !toggle.checked) return '';
    return document.getElementById('tracePort')?.value?.trim() || '';
}

function calculateBaseReachability(startNodeId) {
    const traceInput = document.getElementById('tracePort');
    const oldTracePort = traceInput ? traceInput.value : '';

    if (traceInput) traceInput.value = '';

    const result = calculateReachability(startNodeId);

    if (traceInput) traceInput.value = oldTracePort;

    return result;
}

function canReachNode(sourceNode, targetNode) {
    if (!sourceNode || !targetNode) return false;
    if (sourceNode.id === targetNode.id) return true;

    const reach = calculateBaseReachability(sourceNode.id);
    return reach.reachableNodes.has(targetNode.id);
}

function canReachCloud(sourceNode) {
    if (!sourceNode) return false;

    const reach = calculateBaseReachability(sourceNode.id);
    return state.nodes.some((node) => node.type === 'cloud' && reach.reachableNodes.has(node.id));
}

function getStatusClasses(level) {
    if (level === 'good') return 'bg-emerald-50 border-emerald-200 text-emerald-700';
    if (level === 'bad') return 'bg-red-50 border-red-200 text-red-700';
    if (level === 'warn') return 'bg-amber-50 border-amber-200 text-amber-700';
    return 'bg-slate-50 border-slate-200 text-slate-600';
}

function diagnosticRow(label, level, text) {
    const icon = level === 'good' ? '✅' : level === 'bad' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';

    return `
        <div class="border rounded px-2 py-1 ${getStatusClasses(level)}">
            <div class="flex justify-between gap-2">
                <span class="font-bold">${escapeHtml(label)}</span>
                <span>${icon}</span>
            </div>
            <div class="text-[10px] leading-snug mt-0.5">${escapeHtml(text)}</div>
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
        if (used > total) {
            return { level: 'bad', text: t('{used} cables on a {total}-port {type}. Raise the port count or add a switch.', { used, total, type: node.type }) };
        }
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
function interfaceIssues(node) {
    if (!node) return [];
    const issues = [];

    const invalid = (node.interfaces || []).filter((iface) => iface.ip && !parseValidCIDR(iface.ip));
    if (invalid.length) {
        issues.push({ label: t('Interfaces'), level: 'bad', text: t('Invalid CIDR on: {names}', { names: invalid.map((i) => i.name || 'interface').join(', ') }) });
    }

    [[t('Multi-Homing'), evaluateMultiHoming(node)], [t('Bond'), evaluateBond(node)], [t('Ports'), evaluatePorts(node)], [t('Radio'), evaluateRadio(node)]].forEach(([label, result]) => {
        if (result.level === 'bad' || result.level === 'warn') issues.push({ label, ...result });
    });

    return issues;
}

function nodeSeverity(node) {
    const issues = interfaceIssues(node);
    if (!issues.length) return null;
    return issues.some((i) => i.level === 'bad') ? 'bad' : 'warn';
}

// MAC addresses are optional on a drawing, so silence is the right answer when
// none are set — this check only speaks when there is something to say.
//
// It is the counterpart to evaluateMultiHoming: that one infers ARP flux from
// two interfaces sharing a subnet, which is a guess. A duplicate hardware
// address is not a guess, and it breaks the segment the same way whether or not
// the addresses happen to share a subnet.
function evaluateMac(node) {
    const own = getInterfaces(node).filter(hasMac);
    if (!own.length) return { level: 'info', text: t('No hardware addresses recorded on this node.') };

    const api = window.CarinoOUI;

    // An interface configured with a group address cannot source a frame from
    // it; that is a fault on this node, before any question of duplicates.
    const group = own.filter((i) => parseInt(normMac(i.mac).slice(0, 2), 16) & 0x01);
    if (group.length) {
        return { level: 'bad', text: t('{names} carries a broadcast or multicast address. An interface cannot source frames from a group address — that value belongs in a destination, not on a NIC.', { names: group.map((i) => i.name).join(', ') }) };
    }

    const dupes = duplicateMacs(state.nodes)
        .filter((d) => d.holders.some((h) => h.node.id === node.id));
    if (dupes.length) {
        const first = dupes[0];
        const where = first.holders.map((h) => `${h.node.name} / ${h.iface.name}`).join(' and ');
        return { level: 'bad', text: t('{mac} is on {where}. Two interfaces in one broadcast domain cannot hold the same address — the switch rewrites its CAM table on every frame, which is the flapping this tool reports from the other direction. Clone, restored backup or a hand-typed address are the usual causes.', { mac: api ? api.fmtColon(first.hex) : first.hex, where }) };
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

function evaluateGateway(node) {
    if (isDumbDevice(node)) {
        return {
            level: 'info',
            text: t('L2 backplane nodes do not require a gateway.')
        };
    }

    if (!node.gw || !node.gw.trim()) {
        return {
            level: 'warn',
            text: t('No gateway configured.')
        };
    }

    const gw = node.gw.trim();

    if (gw === '0.0.0.0') {
        const cloudOk = canReachCloud(node);

        return {
            level: cloudOk ? 'good' : 'info',
            text: t(cloudOk
                ? 'Default route placeholder configured; cloud/internet node is reachable.'
                : 'Default route placeholder configured.')
        };
    }

    try {
        ipaddr.parse(gw);
    } catch (e) {
        return {
            level: 'bad',
            text: t('Invalid gateway IP: {gw}', { gw })
        };
    }

    const gatewayNode = findNodeByIp(gw);

    if (!gatewayNode) {
        return {
            level: 'bad',
            text: t('Gateway {gw} was not found on any node/interface.', { gw })
        };
    }

    const reachable = canReachNode(node, gatewayNode);

    return {
        level: reachable ? 'good' : 'bad',
        text: t(reachable
            ? 'Gateway {gw} found on {node} and is reachable.'
            : 'Gateway {gw} exists on {node}, but is not reachable from this node.', { gw, node: gatewayNode.name })
    };
}

function evaluateDns(node) {
    if (isDumbDevice(node)) {
        return {
            level: 'info',
            text: t('L2 backplane nodes do not require DNS.')
        };
    }

    const dnsList = parseDnsList(node.dns);

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

        const dnsNode = findNodeByIp(dnsIp);

        if (dnsNode) {
            const reachable = canReachNode(node, dnsNode);
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

        const cloudOk = canReachCloud(node);

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
        text: results.map((r) => r.text).join(' ')
    };
}

function evaluateTracePort(node) {
    const typed = document.getElementById('tracePort')?.value?.trim() || '';
    const toggle = document.getElementById('tracePortToggle');
    const filterOn = !toggle || toggle.checked;

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
        summary.textContent = 'Idle';
        summary.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-bold';
        return;
    }

    if (placeholder) placeholder.classList.add('hidden');

    const checks = [
        [t('Interfaces'), evaluateInterfaces(node)],
        [t('Multi-Homing'), evaluateMultiHoming(node)],
        [t('Bond'), evaluateBond(node)],
        [t('Ports'), evaluatePorts(node)],
        [t('Radio'), evaluateRadio(node)],
        [t('MAC'), evaluateMac(node)],
        [t('Gateway'), evaluateGateway(node)],
        [t('DNS'), evaluateDns(node)],
        [t('Trace Port'), evaluateTracePort(node)]
    ];

    const hasBad = checks.some(([, result]) => result.level === 'bad');
    const hasWarn = checks.some(([, result]) => result.level === 'warn');

    const overall = hasBad ? 'Issues' : hasWarn ? 'Warnings' : 'OK';

    summary.textContent = overall;
    summary.className = hasBad
        ? 'text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold'
        : hasWarn
            ? 'text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold'
            : 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold';

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
function calculateReachability(startNodeId) {
    const start = getNode(startNodeId);
    if (!start) return { reachableNodes: new Set(), reachableLinks: new Set() };

    // Queue entries carry viaNet: the subnet we arrived on (or a sentinel),
    // so NAT can tell inside↔outside direction.
    const reachableNodes = new Set([startNodeId]), reachableLinks = new Set(), queue = [{ id: startNodeId, viaNet: null }], processedMode = {};
    const targetPort = activeTracePort();
    const _natCache = {};

    // Returns the shared subnet's networkStr, '__cloud__' if either is the
    // Internet cloud, or null.
    function sharedSubnetOf(a, b) {
        if (!a || !b) return null;
        if (a.type === 'cloud' || b.type === 'cloud') return '__cloud__';
        const ipsA = getValidIps(a), ipsB = getValidIps(b);
        for (const ia of ipsA) for (const ib of ipsB) if (ia.kind === ib.kind && ia.networkStr === ib.networkStr) return ia.networkStr;
        return null;
    }
    function shareSubnet(a, b) { return sharedSubnetOf(a, b) !== null; }

    // For a NAT gateway, classify its subnets into outside (WAN/public) vs
    // inside (private LAN). Outside = the subnet containing its default gw, or
    // any public (non-RFC1918) subnet.
    function natInfo(node) {
        if (!node) return { nat: false, outside: new Set(), inside: new Set() };
        if (_natCache[node.id]) return _natCache[node.id];
        const info = { nat: !!node.nat, outside: new Set(), inside: new Set() };
        if (node.nat) {
            const ips = getValidIps(node).filter(i => i.kind === 'ipv4');
            let gwNet = null;
            if (node.gw) { try { const g = ipaddr.parse(node.gw.trim()).toString(); ips.forEach(i => { const c = parseValidCIDR(g + '/' + i.prefix); if (c && c.networkStr === i.networkStr) gwNet = i.networkStr; }); } catch (e) {} }
            ips.forEach(i => { if (!i.isPrivate) info.outside.add(i.networkStr); else info.inside.add(i.networkStr); });
            if (gwNet) { info.outside.add(gwNet); info.inside.delete(gwNet); }
            if (info.outside.size === 0 && ips.length) { const o = gwNet || ips[0].networkStr; info.outside.add(o); info.inside.delete(o); }
        }
        _natCache[node.id] = info; return info;
    }

    function isGateway(client, possibleGateway) {
        if (!client || !possibleGateway) return false;
        if (possibleGateway.type === 'cloud') return true;
        if (!client.gw) return false;
        try {
            const gwIp = ipaddr.parse(client.gw.trim());
            return getValidIps(possibleGateway).some((ib) => ib.ip.toString() === gwIp.toString());
        } catch (e) { return false; }
    }

    // Enhanced L2 Traverse (Supports Dumb Switches & VM Passthrough)
    function getL2Domain(originId) {
        const nodes = new Set([originId]), links = new Set(), l2Queue = [originId], l2Processed = new Set();
        while (l2Queue.length) {
            const currentId = l2Queue.shift();
            if (l2Processed.has(currentId)) continue;
            l2Processed.add(currentId);

            const adjacentLinks = state.links.filter((l) => l.source === currentId || l.target === currentId);
            for (const link of adjacentLinks) {
                const nextId = link.source === currentId ? link.target : link.source, nextNode = getNode(nextId);
                if (!nextNode) continue;

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

    if (isDumbDevice(start)) {
        const l2 = getL2Domain(startNodeId);
        l2.nodes.forEach((id) => reachableNodes.add(id)); l2.links.forEach((id) => reachableLinks.add(id));
        l2.nodes.forEach((l2id) => {
            state.links.filter((l) => l.source === l2id || l.target === l2id).forEach((link) => {
                const neighborId = link.source === l2id ? link.target : link.source, neighbor = getNode(neighborId);
                if (!neighbor || isDumbDevice(neighbor)) return;
                reachableNodes.add(neighborId); reachableLinks.add(link.id); queue.push({ id: neighborId, viaNet: null });
            });
        });
    }

    while (queue.length) {
        const { id: currentId, viaNet } = queue.shift();
        const currentNode = getNode(currentId);
        if (!currentNode) continue;

        // NAT boundary: arriving on WAN/outside (or via the Internet cloud)
        // hides the device's private (inside) subnets. A node reached on a
        // blocked (outside) path may be re-expanded later if a trusted (inside/
        // VPN) path reaches it — so tunnel order doesn't matter.
        const ni = natInfo(currentNode);
        const enteredOutside = ni.nat && viaNet && (viaNet === '__cloud__' || ni.outside.has(viaNet));
        const blockInside = enteredOutside && ni.inside.size > 0;
        const mode = blockInside ? 'blocked' : 'full';
        if (processedMode[currentId] === 'full') continue;
        if (processedMode[currentId] === 'blocked' && mode !== 'full') continue;
        processedMode[currentId] = mode;

        const l2 = getL2Domain(currentId);
        l2.nodes.forEach((id) => reachableNodes.add(id)); l2.links.forEach((id) => reachableLinks.add(id));

        const candidateDevices = new Set(), candidateLinks = new Map();
        l2.nodes.forEach((l2id) => {
            state.links.filter((l) => l.source === l2id || l.target === l2id).forEach((link) => {
                const neighborId = link.source === l2id ? link.target : link.source, neighbor = getNode(neighborId);
                if (!neighbor || isDumbDevice(neighbor)) return;
                if (link.medium === 'vpn') return; // overlay tunnels handled below, not as physical adjacency
                candidateDevices.add(neighborId); candidateLinks.set(neighborId, link.id);
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
            if (candidateLinks.has(deviceId)) reachableLinks.add(candidateLinks.get(deviceId));

            const currentCanRoute = isRoutingDevice(currentNode.type), deviceCanRoute = isRoutingDevice(device.type);
            const viaGateway = isGateway(currentNode, device) || isGateway(device, currentNode);
            if (deviceCanRoute && (viaGateway || currentCanRoute)) queue.push({ id: deviceId, viaNet: shared });
        });

        // VPN overlay: a tunnel is a routed adjacency across the underlay. The
        // far endpoint (and its LAN) becomes reachable, entering on the trusted
        // side (so it bypasses the far gateway's NAT).
        l2.nodes.forEach((l2id) => {
            state.links.filter((l) => l.medium === 'vpn' && (l.source === l2id || l.target === l2id)).forEach((link) => {
                const farId = link.source === l2id ? link.target : link.source, far = getNode(farId);
                if (!far) return;
                reachableNodes.add(farId); reachableLinks.add(link.id);
                queue.push({ id: farId, viaNet: '__vpn__' });
            });
        });
    }

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

// ---- Topology-wide findings ----
// Split out of validateTopology() so one list can feed two surfaces: the canvas
// alert panel, which wants a sentence per problem, and the site report, which
// wants the device, the check and the severity in their own columns.
//
// Each finding carries an explicit `line` because three of these read naturally
// as "IP Conflict: …" or "L2 loop: …" rather than "<device>: …" — the panel's
// wording predates the report and changing it was not the point of the split.
// `subject` is who to go and look at; `line` is what the panel says.
//
// Node-local NIC faults come from interfaceIssues(); everything here is
// relational — a duplicate address, a mismatched cable, a cycle — which is why
// none of it can be blamed on a single node's badge.
function topologyFindings() {
    const findings = [];
    const add = (level, subject, check, detail, line) => findings.push({
        level, subject, check, detail,
        line: line || (subject ? `${subject}: ${detail}` : detail)
    });
    const ipMap = {};

    state.nodes.forEach((node) => {
        getValidIps(node).forEach((parsed) => {
            const ip = parsed.ip.toString();
            if (!ipMap[ip]) ipMap[ip] = [];
            ipMap[ip].push(node.name || node.id);
        });

        if (!isDumbDevice(node) && node.gw) {
            const validIPs = getValidIps(node);
            if (validIPs.length > 0) {
                try {
                    const gwIp = ipaddr.parse(node.gw.trim());
                    const gatewayOnLocalSubnet = validIPs.some((local) => gwIp.match(local.cidrObj));
                    if (!gatewayOnLocalSubnet) add('bad', node.name, t('Gateway'), t('Gateway {gw} is unreachable.', { gw: node.gw }));
                } catch (e) { add('bad', node.name, t('Gateway'), t('Invalid gateway format.')); }
            }
        }
    });

    Object.entries(ipMap).forEach(([ip, names]) => {
        if (names.length > 1) {
            const detail = t('{ip} shared by {names}.', { ip, names: names.join(', ') });
            add('bad', names.join(', '), t('IP Conflict'), detail, `${t('IP Conflict')}: ${detail}`);
        }
    });

    // Interface-level problems, surfaced globally so you do not have to click
    // each node to find the one that is flapping.
    state.nodes.forEach((node) => {
        interfaceIssues(node).forEach((issue) => add(issue.level, node.name, issue.label, issue.text));
    });

    // Both ends of a cable are one wire: if each end holds an IP, they must agree.
    state.links.forEach((link) => {
        const src = getNode(link.source), tgt = getNode(link.target);
        if (!src || !tgt || effectiveMedium(link) === 'vpn') return;
        const a = parseValidCIDR(ifaceOn(src, link.sourceIface)?.ip);
        const b = parseValidCIDR(ifaceOn(tgt, link.targetIface)?.ip);
        if (!a || !b || a.networkStr === b.networkStr) return;
        const detail = t('{a} ({ifaceA}) and {b} ({ifaceB}) are cabled together but sit on different subnets ({netA} vs {netB}).',
            { a: src.name, ifaceA: ifaceLabel(src, link.sourceIface), b: tgt.name, ifaceB: ifaceLabel(tgt, link.targetIface), netA: a.networkStr, netB: b.networkStr });
        add('bad', `${src.name} ↔ ${tgt.name}`, t('Cabling'), detail, detail);
    });

    // An L2 loop is the sibling failure to MAC flapping: a cycle through dumb
    // switches floods broadcasts forever unless STP is running.
    const parent = {};
    const find = (id) => { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
    state.nodes.forEach((n) => { parent[n.id] = n.id; });
    state.links.forEach((link) => {
        const src = getNode(link.source), tgt = getNode(link.target);
        if (!src || !tgt || effectiveMedium(link) === 'vpn') return;
        if (!isDumbDevice(src) || !isDumbDevice(tgt)) return; // only forwarding devices close a loop
        const rootA = find(src.id), rootB = find(tgt.id);
        if (rootA === rootB) {
            const detail = t('the link between {a} and {b} closes a switching loop. Broadcast storm risk unless STP is enabled.', { a: src.name, b: tgt.name });
            add('bad', `${src.name} ↔ ${tgt.name}`, t('L2 loop'), detail, `${t('L2 loop')}: ${detail}`);
        } else parent[rootA] = rootB;
    });

    return findings;
}

function validateTopology() {
    const alertBox = document.getElementById('conflictAlert');
    const msgList = document.getElementById('conflictMsgList');
    const errors = topologyFindings().map((f) => f.line);

    const pill = document.getElementById('conflictPill');
    const hidden = !!state.settings.alertsHidden;

    if (errors.length) {
        msgList.innerHTML = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
        document.getElementById('conflictPillCount').textContent = String(errors.length);
        alertBox.classList.toggle('hidden', hidden);
        pill.classList.toggle('hidden', !hidden);
    } else {
        msgList.innerHTML = ''; // otherwise the last run's errors linger in the hidden panel
        alertBox.classList.add('hidden');
        pill.classList.add('hidden');
    }
}
