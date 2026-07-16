// Everything that draws: palette, canvas, sidebar, faceplate.
// Load order: state -> model -> data -> diagnostics -> ui -> app

const iconPaths = {
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    router: '<circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/>',
    firewall: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    switch: '<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 12h4m4 0h4"/>',
    server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    pc: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    ap: '<path d="M12 20h.01M8.5 16.5a5 5 0 0 1 7 0M6 14a8 8 0 0 1 12 0M3.5 11.5a11.5 11.5 0 0 1 17 0"/>',
    vm: '<rect x="2" y="2" width="20" height="20" rx="2" stroke-dasharray="4 4"/><path d="M12 8v8M8 12h8"/>',
    iot: '<path d="M4.9 19.1C3.1 17.3 2 14.8 2 12s1.1-5.3 2.9-7.1M19.1 4.9C20.9 6.7 22 9.2 22 12s-1.1 5.3-2.9 7.1M8.5 15.5c-1-1-1.6-2.4-1.6-3.5s.6-2.5 1.6-3.5M15.5 8.5c1 1 1.6 2.4 1.6 3.5s-.6 2.5-1.6 3.5"/><circle cx="12" cy="12" r="2"/>',
    dicom: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    container: '<rect x="2" y="7" width="20" height="12" rx="1"/><path d="M6 7v12M10 7v12M14 7v12M18 7v12"/>',
    loadbalancer: '<circle cx="12" cy="4" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="12" cy="20" r="2"/><circle cx="19" cy="20" r="2"/><path d="M12 6v3M12 9l-7 9M12 9v9M12 9l7 9"/>',
    l3switch: '<rect x="2" y="9" width="20" height="7" rx="2"/><path d="M6 12.5h12"/><path d="M8 6l3-3 3 3M8 19l3 3 3-3"/>',
    edge: '<rect x="5" y="9" width="14" height="7" rx="1.5"/><path d="M9 9V4M15 9V4M12 16v4"/><path d="M6 4h6M12 4h6"/>',
    vpn: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/><path d="M12 16v2"/>',
    voip: '<path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    custom: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'
};

// Palette order: each base type is followed by its L3 derivatives, so
// Router → Load Balancer / L3 Switch / Edge, and Firewall → VPN Gateway.
const paletteDefs = [
    { type: 'cloud', name: 'Cloud' }, { type: 'router', name: 'Router' }, { type: 'loadbalancer', name: 'Load Balancer' },
    { type: 'l3switch', name: 'L3 Switch' }, { type: 'edge', name: 'Edge Gateway' }, { type: 'firewall', name: 'Firewall' },
    { type: 'vpn', name: 'VPN Gateway' }, { type: 'switch', name: 'Switch' }, { type: 'ap', name: 'Wireless AP' },
    { type: 'server', name: 'Server' }, { type: 'vm', name: 'VM' }, { type: 'container', name: 'Container' },
    { type: 'pc', name: 'Workstation' }, { type: 'voip', name: 'VoIP Phone' }, { type: 'iot', name: 'IoT Device' },
    { type: 'printer', name: 'Printer' }, { type: 'camera', name: 'IP Camera' }, { type: 'dicom', name: 'DICOM' },
    { type: 'custom', name: 'Custom Node' }
];

const lZones = document.getElementById('layer-zones'), lLinks = document.getElementById('layer-links'), lNodes = document.getElementById('layer-nodes');
let isDraggingCanvas = false, isDraggingNode = false, draggedNode = null, dragOffset = { x: 0, y: 0 }, lastMouse = { x: 0, y: 0 };

const paletteContainer = document.getElementById('nodePalette');
paletteDefs.forEach((d) => {
    const btn = document.createElement('button');
    btn.className = 'palette-item flex flex-col items-center p-2 bg-slate-50 border border-slate-200 rounded hover:border-blue-400 hover:bg-blue-50 cursor-pointer';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" stroke="#1e293b" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${iconPaths[d.type]}</svg><span class="text-[9px] font-medium mt-1 uppercase text-center leading-tight">${d.name}</span>`;
    btn.title = 'Click to add (connects to the selected node) — or drag onto the canvas';
    // Click: add connected to the current selection (fast tree building)
    btn.onclick = () => spawnNode(d.type, { connectTo: (state.selectedType === 'node' && state.selectedId) ? state.selectedId : null });
    // Drag: drop onto the canvas at the cursor
    btn.setAttribute('draggable', 'true');
    btn.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/carino-node', d.type); e.dataTransfer.effectAllowed = 'copy'; });
    paletteContainer.appendChild(btn);
});

function renderCanvasOnly() {
    lZones.innerHTML = ''; lLinks.innerHTML = ''; lNodes.innerHTML = '';
    document.getElementById('networkCanvas').className = `w-full h-full absolute inset-0 select-none ${state.linkSourceId ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`;

    // 1. Render Zone Bubbles (Controllable per interface)
    const subnets = {};
    state.nodes.forEach((node) => { 
        if (node.type === 'cloud') return; // Suppress cloud public zones
        if (!node.interfaces) return;

        node.interfaces.forEach((iface) => {
            const ipData = parseValidCIDR(iface.ip);
            if (!ipData) return;

            // Check explicit toggle first. If undefined, fallback to isPrivate rule.
            const shouldDraw = iface.drawZone !== undefined ? iface.drawZone : ipData.isPrivate;
            if (!shouldDraw) return;

            const subnet = ipData.networkStr; 
            if (!subnets[subnet]) subnets[subnet] = []; 
            subnets[subnet].push(node); 
        });
    });

    let labelOffsets = {}; 
    Object.entries(subnets).forEach(([subnet, nodes]) => {
        if (!nodes.length) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach((node) => {
            minX = Math.min(minX, node.x); minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x); maxY = Math.max(maxY, node.y);
        });

        const padX = 45, padTop = 45, padBottom = 80;
        const hue = Array.from(subnet).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'zone-bubble');

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', minX - padX); rect.setAttribute('y', minY - padTop);
        rect.setAttribute('width', maxX - minX + padX * 2); rect.setAttribute('height', maxY - minY + padTop + padBottom);
        rect.setAttribute('rx', '16');
        rect.setAttribute('fill', `hsla(${hue}, 70%, 50%, 0.06)`); rect.setAttribute('stroke', `hsla(${hue}, 70%, 50%, 0.3)`);
        rect.setAttribute('stroke-dasharray', '8 4'); rect.setAttribute('stroke-width', '2');
        g.appendChild(rect);

        // Label sits as a "tab" ABOVE the zone's top edge so it is never
        // hidden behind a node; stacked subnets at the same corner rise upward.
        const labelPosKey = `${minX}_${minY}`;
        const offsetIndex = labelOffsets[labelPosKey] || 0;
        labelOffsets[labelPosKey] = offsetIndex + 1;

        const lx = minX - padX + 6;
        const ly = minY - padTop - 8 - (offsetIndex * 17);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', lx); text.setAttribute('y', ly);
        text.setAttribute('font-size', '11'); text.setAttribute('font-family', 'monospace');
        text.setAttribute('font-weight', 'bold'); text.setAttribute('fill', `hsla(${hue}, 70%, 34%, 1)`);
        text.textContent = subnet;
        g.appendChild(text);
        lZones.appendChild(g);
        // Backdrop behind the text so crossing links don't bleed through it.
        try {
            const bb = text.getBBox();
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('x', bb.x - 5); bg.setAttribute('y', bb.y - 2);
            bg.setAttribute('width', bb.width + 10); bg.setAttribute('height', bb.height + 4);
            bg.setAttribute('rx', '3');
            bg.setAttribute('fill', '#f8fafc'); bg.setAttribute('fill-opacity', '0.9');
            bg.setAttribute('stroke', `hsla(${hue}, 70%, 50%, 0.35)`); bg.setAttribute('stroke-width', '1');
            g.insertBefore(bg, text);
        } catch (e) { /* getBBox unavailable */ }
    });

    const reach = state.settings.traceMode && state.selectedId && state.selectedType === 'node' ? calculateReachability(state.selectedId) : null;

    // 2. Render Links
    state.links.forEach((link) => {
        const src = getNode(link.source), tgt = getNode(link.target);
        if (!src || !tgt) return;

        const geo = linkGeometry(link);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('fill', 'none');
        applyLinkGeometry(line, geo);
        line.setAttribute('id', `ui-link-${link.id}`);

        const isSelected = state.selectedId === link.id && state.selectedType === 'link';
        const medium = effectiveMedium(link, src, tgt);

        let defaultColor = '#94a3b8'; // utp
        let dashArray = null;
        let baseWidth = 2;

        if (medium === 'fiber') defaultColor = '#06b6d4';
        else if (medium === 'wireless') { defaultColor = '#8b5cf6'; dashArray = '4 4'; }
        else if (medium === 'powerline') { defaultColor = '#eab308'; dashArray = '8 4 2 4'; }
        else if (medium === 'vpn') { defaultColor = '#14b8a6'; dashArray = '10 6'; baseWidth = 2.5; } // secure overlay tunnel

        if (link.attachment === 'passthrough') { defaultColor = '#a855f7'; dashArray = '4 4'; }

        if (reach && reach.reachableLinks.has(link.id)) {
            // Amber still means "reachable"; the flow pattern keeps the medium
            // readable while tracing, which the old single animation lost.
            line.setAttribute('stroke', '#f59e0b');
            line.setAttribute('stroke-width', medium === 'fiber' ? '3.5' : medium === 'wireless' ? '2.5' : '3');
            line.setAttribute('stroke-dasharray', FLOW_DASH[medium] || FLOW_DASH.utp);
            line.setAttribute('class', `${FLOW_CLASS[medium] || FLOW_CLASS.utp} cursor-pointer`);
        } else {
            line.setAttribute('stroke', isSelected ? '#eab308' : defaultColor);
            line.setAttribute('stroke-width', isSelected ? '3' : baseWidth);
            line.setAttribute('class', reach ? 'fade-inactive cursor-pointer' : 'cursor-pointer transition-colors');
            if (dashArray) line.setAttribute('stroke-dasharray', dashArray);
        }
        line.addEventListener('mousedown', (event) => { event.stopPropagation(); select(link.id, 'link'); });
        lLinks.appendChild(line);

        // Radio does not march down a wire, so a traced wireless link emits ")))"
        // arcs that ride the link itself — textPath rotates each glyph to follow
        // the path, so they stay square-on to the direction of travel even on a
        // bowed run.
        if (reach && reach.reachableLinks.has(link.id) && medium === 'wireless') {
            const waves = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            waves.setAttribute('class', 'flow-wave');
            waves.setAttribute('font-family', 'monospace');
            waves.setAttribute('font-size', '13');
            waves.setAttribute('font-weight', '700');
            waves.setAttribute('fill', '#f59e0b');
            waves.setAttribute('dominant-baseline', 'middle');

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
            path.setAttribute('href', `#ui-link-${link.id}`);

            // Measure the glyph advance once rather than assuming it: the loop has
            // to close on exactly one repeat or the arcs visibly jump. It only
            // depends on the font and size, both fixed, so every later link reuses
            // it and skips the layout flush entirely.
            const total = line.getTotalLength();
            const reps = waveAdvance ? Math.ceil(total / waveAdvance) + 2 : Math.max(3, Math.ceil(total / 8) + 3);
            path.textContent = WAVE_UNIT.repeat(reps);
            waves.appendChild(path);
            lLinks.appendChild(waves);

            if (!waveAdvance) waveAdvance = waves.getComputedTextLength() / reps;
            const advance = waveAdvance;
            if (advance > 0) {
                // Run from -advance to 0: starting at 0 would leave a bare gap at
                // the head of the link for one whole cycle.
                const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
                anim.setAttribute('attributeName', 'startOffset');
                anim.setAttribute('from', String(-advance));
                anim.setAttribute('to', '0');
                anim.setAttribute('dur', '1.2s');
                anim.setAttribute('repeatCount', 'indefinite');
                path.appendChild(anim);
            }
        }

        // Port labels would bury the canvas if always on, so they ride the selection.
        if (isSelected) {
            // Place labels a fixed distance out rather than a fixed fraction, so
            // they clear the node's glyph and IP text on a short link without
            // drifting to the midpoint on a long one.
            const span = Math.hypot(tgt.x - src.x, tgt.y - src.y) || 1;
            const off = Math.min(0.42, Math.max(0.15, 66 / span));

            [[src, link.sourceIface, off], [tgt, link.targetIface, 1 - off]].forEach(([node, ifaceId, t]) => {
                const name = ifaceId ? ifaceLabel(node, ifaceId) : 'unbound';
                const at = geo.pointAt(t);
                const portLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                portLabel.setAttribute('x', String(at.x));
                portLabel.setAttribute('y', String(at.y));
                portLabel.setAttribute('text-anchor', 'middle');
                portLabel.setAttribute('font-size', '8');
                portLabel.setAttribute('font-family', 'monospace');
                portLabel.setAttribute('font-weight', '700');
                portLabel.setAttribute('fill', ifaceId ? '#a16207' : '#dc2626');
                portLabel.setAttribute('paint-order', 'stroke');
                portLabel.setAttribute('stroke', '#ffffff');
                portLabel.setAttribute('stroke-width', '3');
                portLabel.textContent = name;
                portLabel.style.pointerEvents = 'none';
                lLinks.appendChild(portLabel);
            });
        }
    });

    // 3. Render Nodes
    state.nodes.forEach((node) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('id', `ui-node-${node.id}`);
        g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

        const isSelected = state.selectedId === node.id && state.selectedType === 'node';
        const isLinkSource = state.linkSourceId === node.id;
        const isReachable = reach && reach.reachableNodes.has(node.id);
        const isInactiveTraceNode = reach && !isReachable;
        const severity = nodeSeverity(node);

        let classes = state.linkSourceId ? (isLinkSource ? 'linking-glow cursor-crosshair' : 'cursor-crosshair') : 'cursor-grab active:cursor-grabbing';
        if (isInactiveTraceNode) classes += ' fade-inactive';
        g.setAttribute('class', classes);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '-24'); rect.setAttribute('y', '-24'); rect.setAttribute('width', '48'); rect.setAttribute('height', '48'); rect.setAttribute('rx', '6');

        if (isLinkSource) { rect.setAttribute('fill', '#fff7ed'); rect.setAttribute('stroke', '#ea580c'); rect.setAttribute('stroke-width', '2'); } 
        else if (isSelected) { rect.setAttribute('fill', '#fefce8'); rect.setAttribute('stroke', '#eab308'); rect.setAttribute('stroke-width', '2'); } 
        else if (isReachable) { rect.setAttribute('fill', '#fffbeb'); rect.setAttribute('stroke', '#fcd34d'); rect.setAttribute('stroke-width', '2.5'); }
        else if (severity === 'bad') { rect.setAttribute('fill', '#fef2f2'); rect.setAttribute('stroke', '#dc2626'); rect.setAttribute('stroke-width', '2'); }
        else if (severity === 'warn') { rect.setAttribute('fill', '#fffbeb'); rect.setAttribute('stroke', '#d97706'); rect.setAttribute('stroke-width', '2'); }
        else { rect.setAttribute('fill', '#ffffff'); rect.setAttribute('stroke', '#cbd5e1'); rect.setAttribute('stroke-width', '1.5'); }

        if (isVirtualType(node.type)) rect.setAttribute('stroke-dasharray', '4 3');
        rect.style.transition = 'all 0.1s ease'; g.appendChild(rect);

        const iconG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        iconG.setAttribute('transform', 'translate(-12, -14)');
        iconG.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="#334155" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${iconPaths[node.type] || iconPaths.custom}</svg>`;
        iconG.style.pointerEvents = 'none'; g.appendChild(iconG);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('text-anchor', 'middle'); label.setAttribute('y', '36'); label.setAttribute('font-size', '10');
        label.setAttribute('font-weight', '600'); label.setAttribute('fill', '#334155'); label.textContent = node.name; label.style.pointerEvents = 'none';
        g.appendChild(label);

        // Badge rides on top of selection/trace styling, so a flapping node stays
        // visible even while it is selected or lit up by a trace.
        if (severity) {
            const issues = interfaceIssues(node);
            const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badge.setAttribute('transform', 'translate(19, -19)');

            const disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            disc.setAttribute('r', '7.5');
            disc.setAttribute('fill', severity === 'bad' ? '#dc2626' : '#d97706');
            disc.setAttribute('stroke', '#ffffff');
            disc.setAttribute('stroke-width', '1.5');
            badge.appendChild(disc);

            const mark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            mark.setAttribute('text-anchor', 'middle'); mark.setAttribute('y', '3.5');
            mark.setAttribute('font-size', '10'); mark.setAttribute('font-weight', '900'); mark.setAttribute('fill', '#ffffff');
            mark.textContent = '!';
            badge.appendChild(mark);

            const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            tip.textContent = issues.map((i) => `${i.label}: ${i.text}`).join('\n\n');
            badge.appendChild(tip); // needs pointer events for the tooltip; clicks bubble to the node

            g.appendChild(badge);
        }

        if (isLinkSource) {
            const hint = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            hint.setAttribute('text-anchor', 'middle'); hint.setAttribute('y', '-34'); hint.setAttribute('font-size', '9');
            hint.setAttribute('font-weight', '700'); hint.setAttribute('fill', '#ea580c'); hint.textContent = 'LINK TARGET...'; hint.style.pointerEvents = 'none';
            g.appendChild(hint);
        }

        if (!isDumbDevice(node) && node.interfaces && node.interfaces.length > 0) {
            const validDisplayIps = node.interfaces.map(i=>i.ip).filter((i) => i && i.trim() !== '');
            validDisplayIps.slice(0, 2).forEach((ip, idx) => {
                const ipLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                ipLabel.setAttribute('text-anchor', 'middle'); ipLabel.setAttribute('y', String(48 + idx * 10));
                ipLabel.setAttribute('font-size', '8'); ipLabel.setAttribute('font-family', 'monospace'); ipLabel.setAttribute('fill', '#64748b');
                let text = ip; if (idx === 1 && validDisplayIps.length > 2) { text += ` (+${validDisplayIps.length - 2})`; }
                ipLabel.textContent = text; ipLabel.style.pointerEvents = 'none'; g.appendChild(ipLabel);
            });
        }

        // Interactions
        g.addEventListener('mousedown', (event) => {
            event.stopPropagation();
            if (!state.linkSourceId) {
                isDraggingNode = true; draggedNode = node;
                const pt = getWorkspacePoint(event.clientX, event.clientY);
                dragOffset.x = pt.x - node.x; dragOffset.y = pt.y - node.y;
                select(node.id, 'node');
            }
        });

        g.addEventListener('click', (event) => {
            event.stopPropagation();
            if (state.linkSourceId) {
                if (state.linkSourceId !== node.id) {
                    const sNode = getNode(state.linkSourceId);
                    // A second cable between the same pair is legitimate (redundant
                    // NICs, LAG), so only an identical port-to-port run is a duplicate.
                    const link = { id: nextId('l'), source: state.linkSourceId, target: node.id, attachment: (isVirtualType(sNode.type) || isVirtualType(node.type)) ? 'bridged' : null };
                    bindLink(link);
                    const duplicate = state.links.some((l) =>
                        (l.source === link.source && l.target === link.target && l.sourceIface === link.sourceIface && l.targetIface === link.targetIface) ||
                        (l.source === link.target && l.target === link.source && l.sourceIface === link.targetIface && l.targetIface === link.sourceIface));
                    if (!duplicate) state.links.push(link);
                }
                state.linkSourceId = null; save();
                renderCanvasOnly();
                renderNodeDiagnostics(node);
            }
        });

        g.addEventListener('contextmenu', (event) => {
            event.preventDefault(); // Stops browser menu
            event.stopPropagation();
            state.linkSourceId = node.id;
            renderCanvasOnly();
        });

        lNodes.appendChild(g);
    });
    updateTraceStatus(reach);
    validateTopology();
};

// Switch/AP faceplate: how many ports the device has, and what is in them.
// Ports stay implicit unless one is given a name or IP, so a 48-port switch
// costs one number in the URL hash rather than 48 objects.
function renderFaceplate(node, container) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-2';

    const head = document.createElement('div');
    head.className = 'flex items-center justify-between mb-1';
    head.innerHTML = '<span class="text-[9px] font-bold text-slate-500 uppercase">Physical Ports</span>';

    const count = document.createElement('input');
    count.type = 'number'; count.min = '0'; count.max = '96';
    count.value = String(portCountOf(node));
    count.className = 'w-14 border border-slate-300 rounded px-1 py-0.5 text-[10px] font-mono text-right focus:outline-blue-500';
    count.oninput = (e) => {
        const next = parseInt(e.target.value, 10);
        if (!Number.isFinite(next) || next < 0) return;
        node.portCount = Math.min(next, 96);
        save(); renderCanvasOnly(); renderSidebarData(node); renderNodeDiagnostics(node);
    };
    head.appendChild(count);
    wrap.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'flex flex-wrap gap-1';
    const ports = getInterfaces(node).filter((i) => /^p\d+$/.test(i.id));

    if (!ports.length) {
        grid.innerHTML = '<span class="text-[9px] text-slate-400 italic">No ports. Raise the count above.</span>';
    }

    ports.forEach((port) => {
        const link = linkOnIface(node.id, port.id);
        const neighbour = link ? getNode(link.source === node.id ? link.target : link.source) : null;
        const chip = document.createElement('button');
        chip.className = 'w-6 h-6 rounded border text-[9px] font-mono font-bold transition ' + (
            neighbour ? 'bg-emerald-50 border-emerald-400 text-emerald-700 hover:border-emerald-600'
                : 'bg-white border-slate-200 text-slate-400 hover:border-slate-400');
        chip.textContent = port.name || port.id;
        chip.title = neighbour ? `Port ${port.name} → ${neighbour.name}` : `Port ${port.name} — free`;
        if (link) chip.onclick = () => select(link.id, 'link'); // jump to the cable in this port
        grid.appendChild(chip);
    });

    wrap.appendChild(grid);
    container.appendChild(wrap);
}

function renderSidebarData(node) {
    const ifCont = document.getElementById('ifaceListContainer'); ifCont.innerHTML = '';
    node.interfaces = node.interfaces || [];

    if (hasPortGrid(node)) renderFaceplate(node, ifCont);

    if (!node.interfaces.length) {
        if (!hasPortGrid(node)) ifCont.innerHTML = '<span class="text-[10px] text-slate-400 italic">No interfaces defined.</span>';
    }
    else {
        node.interfaces.forEach((iface, i) => {
            const div = document.createElement('div'); div.className = 'flex items-center gap-1 min-w-0';
            const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = iface.name; nameInp.placeholder = 'eth0';
            nameInp.className = 'w-[74px] shrink-0 border border-slate-300 rounded px-2 py-1 text-xs font-mono focus:outline-blue-500 bg-slate-50';
            nameInp.addEventListener('input', (e) => { node.interfaces[i].name = e.target.value; save();
            renderCanvasOnly();
            renderNodeDiagnostics(node); });

            const ipInp = document.createElement('input'); ipInp.type = 'text'; ipInp.value = iface.ip; ipInp.placeholder = 'CIDR';
            ipInp.className = 'flex-1 min-w-0 border border-slate-300 rounded px-2 py-1 text-xs font-mono focus:outline-blue-500';
            if (iface.ip.trim() !== '' && !parseValidCIDR(iface.ip)) ipInp.classList.add('border-red-400', 'bg-red-50');
            const zoneLabel = document.createElement('label');
            zoneLabel.className = 'flex items-center gap-0.5 shrink-0 text-[9px] text-slate-500 font-bold cursor-pointer mx-1';
            zoneLabel.title = 'Draw Subnet Zone Bubble';

            const zoneCb = document.createElement('input');
            zoneCb.type = 'checkbox';
            zoneCb.className = 'w-3 h-3 accent-blue-500 rounded cursor-pointer';

            const initParsed = parseValidCIDR(iface.ip);
            zoneCb.checked = iface.drawZone !== undefined ? iface.drawZone : (initParsed ? initParsed.isPrivate : false);

            zoneCb.onchange = (e) => {
                node.interfaces[i].drawZone = e.target.checked;
                save();
                renderCanvasOnly();
            };

            zoneLabel.appendChild(zoneCb);
            zoneLabel.appendChild(document.createTextNode('Zone'));

            ipInp.addEventListener('input', (e) => { 
                node.interfaces[i].ip = e.target.value; 
                const parsedData = parseValidCIDR(e.target.value);
                if (e.target.value.trim() !== '' && !parsedData) ipInp.classList.add('border-red-400', 'bg-red-50');
                else ipInp.classList.remove('border-red-400', 'bg-red-50');

                // Auto-update checkbox fallback visual state if it was never explicitly set
                if (node.interfaces[i].drawZone === undefined && parsedData) {
                    zoneCb.checked = parsedData.isPrivate;
                }

                save();
                renderCanvasOnly();
                renderNodeDiagnostics(node); 
            });

            const del = document.createElement('button'); del.innerHTML = '✖'; del.className = 'text-slate-400 hover:text-red-500 px-1 shrink-0';
            del.onclick = () => {
                node.interfaces.splice(i, 1);
                save();
                renderCanvasOnly();
                renderSidebarData(node);
                renderNodeDiagnostics(node);
            };

            // Show what is plugged into this interface, so the ARP-flux warning
            // can be traced back to a specific cable without hunting the canvas.
            const link = linkOnIface(node.id, iface.id);
            const peer = link ? getNode(link.source === node.id ? link.target : link.source) : null;
            const wire = document.createElement('button');
            const radio = ifaceIsWireless(iface);
            wire.className = 'text-[9px] shrink-0 px-0.5 ' + (peer ? 'text-slate-400 hover:text-blue-600' : 'text-slate-300 cursor-default');
            wire.textContent = peer ? (radio ? '📶' : '🔌') : (radio ? '📡' : '○');
            wire.title = peer ? `${radio ? 'Associated' : 'Linked'} to ${peer.name}` : `${radio ? 'Radio' : 'Interface'} not linked`;
            if (link) wire.onclick = () => select(link.id, 'link');

            div.appendChild(nameInp); div.appendChild(ipInp); div.appendChild(zoneLabel); div.appendChild(wire); div.appendChild(del); ifCont.appendChild(div);
        });
    }
}

// Interface picker for a selected link: one row per end, chips for each
// interface. Occupied chips are marked but still selectable — conflicts are
// reported, not blocked, so you can draw a network to document that it is wrong.
function renderLinkPorts(link) {
    const panel = document.getElementById('linkPortProps');
    const body = document.getElementById('linkPortBody');
    const src = getNode(link.source), tgt = getNode(link.target);
    if (!src || !tgt) { panel.classList.add('hidden'); return; }

    body.innerHTML = '';
    [[src, tgt], [tgt, src]].forEach(([node, other]) => {
        const key = ifaceKeyFor(link, node.id);
        const row = document.createElement('div');

        const head = document.createElement('div');
        head.className = 'flex items-center justify-between mb-1';
        head.innerHTML = `<span class="text-[10px] font-bold text-slate-600 truncate">${escapeHtml(node.name)}</span>`;

        const addBtn = document.createElement('button');
        addBtn.className = 'text-[9px] text-blue-600 hover:underline font-bold shrink-0 ml-1';
        addBtn.textContent = hasPortGrid(node) ? '+ Port' : '+ NIC';
        addBtn.onclick = () => {
            link[key] = createIfaceFor(node, { grow: true }).id;
            save(); renderCanvasOnly(); renderLinkPorts(link);
        };
        head.appendChild(addBtn);
        row.appendChild(head);

        const chips = document.createElement('div');
        chips.className = 'flex flex-wrap gap-1';

        const interfaces = getInterfaces(node);
        if (!interfaces.length) {
            chips.innerHTML = '<span class="text-[9px] text-slate-400 italic">No interfaces — add one.</span>';
        }

        interfaces.forEach((iface) => {
            const selected = link[key] === iface.id;
            const takenBy = linksAtNode(node.id).find((l) => l.id !== link.id && ifaceIdOn(l, node.id) === iface.id && isExclusiveLink(l));
            const chip = document.createElement('button');
            chip.className = 'px-1.5 py-0.5 rounded border text-[9px] font-mono font-bold transition ' + (
                selected ? 'bg-amber-100 border-amber-500 text-amber-800'
                    : takenBy ? 'bg-slate-100 border-slate-300 text-slate-400 hover:border-slate-400'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600');
            chip.textContent = iface.name || iface.id;

            if (takenBy) {
                const neighbour = getNode(takenBy.source === node.id ? takenBy.target : takenBy.source);
                chip.title = `In use by ${neighbour?.name || 'another link'}`;
            } else if (iface.ip) {
                chip.title = iface.ip;
            }

            chip.onclick = () => {
                // Picking an implicit faceplate port keeps it implicit until it
                // needs a name or IP, so the URL hash stays small.
                link[key] = iface.id;
                save(); renderCanvasOnly(); renderLinkPorts(link);
            };
            chips.appendChild(chip);
        });

        row.appendChild(chips);
        body.appendChild(row);
    });

    panel.classList.remove('hidden');
}

function clearPropertyInputs() {
    document.getElementById('propName').value = '';
    document.getElementById('propGw').value = '';
    document.getElementById('propDns').value = '';
    document.getElementById('propOs').value = '';
    document.getElementById('propPorts').value = '';
    document.getElementById('propNotes').value = '';
    document.getElementById('ifaceListContainer').innerHTML = '';
    document.getElementById('jumpGwBtn').classList.add('hidden');
    renderNodeDiagnostics(null);
}

function select(id, type) {
    state.selectedId = id; state.selectedType = type; state.linkSourceId = null;
    const pPane = document.getElementById('propertiesPane'), nPane = document.getElementById('noSelectionPane');
    const netProps = document.getElementById('nodeNetworkProps'), generalProps = document.getElementById('nodeGeneralProps'), linkProps = document.getElementById('linkProps');
    const nameInput = document.getElementById('propName'), jumpGwBtn = document.getElementById('jumpGwBtn');

    if (!id) { clearPropertyInputs(); pPane.classList.add('hidden'); pPane.classList.remove('flex'); nPane.classList.remove('hidden'); renderCanvasOnly(); return; }
    nPane.classList.add('hidden'); pPane.classList.remove('hidden'); pPane.classList.add('flex');

    if (type === 'node') {
        const node = getNode(id); if (!node) return;
        nameInput.value = node.name || ''; nameInput.disabled = false; generalProps.classList.remove('hidden'); linkProps.classList.add('hidden');
        if (document.getElementById('linkMediumProps')) document.getElementById('linkMediumProps').classList.add('hidden');
        document.getElementById('linkPortProps').classList.add('hidden');
        document.getElementById('propOs').value = node.os || ''; document.getElementById('propPorts').value = node.ports || ''; document.getElementById('propNotes').value = node.notes || '';

        netProps.classList.remove('hidden');
        document.getElementById('propGw').value = node.gw || ''; document.getElementById('propDns').value = node.dns || '';
        // NAT toggle — only meaningful on routing devices
        const natRow = document.getElementById('natRow'), propNat = document.getElementById('propNat');
        if (isRoutingDevice(node.type)) {
            natRow.classList.remove('hidden'); natRow.classList.add('flex');
            propNat.checked = !!node.nat;
            propNat.onchange = (e) => { node.nat = e.target.checked; save(); renderCanvasOnly(); renderNodeDiagnostics(node); };
        } else { natRow.classList.add('hidden'); natRow.classList.remove('flex'); }
        if (node.gw && node.gw.trim() !== '') {
            jumpGwBtn.classList.remove('hidden');
            jumpGwBtn.onclick = () => {
                const gwIpStr = node.gw.trim(), targetNode = state.nodes.find((n) => getValidIps(n).some((ipData) => ipData.ip.toString() === gwIpStr));
                if (targetNode) {
                    const rect = document.getElementById('networkCanvas').getBoundingClientRect();
                    state.camera.x = (rect.width / 2) - targetNode.x * state.camera.zoom; state.camera.y = (rect.height / 2) - targetNode.y * state.camera.zoom;
                    applyCamera(); select(targetNode.id, 'node');
                } else { alert(`Gateway node (${gwIpStr}) not found in the topology.`); }
            };
        } else { jumpGwBtn.classList.add('hidden'); }
        renderSidebarData(node);
        renderNodeDiagnostics(node);
    } else if (type === 'link') {
        const link = getLink(id); if (!link) return;
        const a = getNode(link.source), b = getNode(link.target);
        nameInput.value = `${a?.name || link.source} ↔ ${b?.name || link.target}`; nameInput.disabled = true;
        netProps.classList.add('hidden'); generalProps.classList.add('hidden');

        if (link.attachment !== undefined && link.attachment !== null) {
            linkProps.classList.remove('hidden');
            document.getElementById('propAttachment').value = link.attachment;
            document.getElementById('propAttachment').onchange = (e) => { link.attachment = e.target.value; save(); renderCanvasOnly(); };
        } else { linkProps.classList.add('hidden'); }

        renderLinkPorts(link);

        const linkMediumProps = document.getElementById('linkMediumProps');
        linkMediumProps.classList.remove('hidden');
        document.getElementById('propMedium').value = link.medium || 'utp';
        document.getElementById('propMedium').onchange = (e) => { link.medium = e.target.value; save(); renderCanvasOnly(); renderLinkPorts(link); };
    }
    renderCanvasOnly();
}
