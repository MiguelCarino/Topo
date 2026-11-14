// ---- Trace to a target: "Does A reach B?" (docs/SCOPE.md D382-D387, step 8h) ----
// Right-click A, then right-click B: Does A reach B? (A left click on B still
// files a cable, as before.) Right-click A twice: tracing (D432), drawn as
// link mode is (D433): A in the trace's cyan with "TRACING TARGET..." over
// it, and on a phone the bar as link mode's banner; a left click on B asks;
// a third right-click on A ends it. When A reaches B the
// path is lit in that colour and the rest of the map dimmed. On a touch screen a long-press on A then on B
// (a long-press is the browser's contextmenu). Without a mouse: the
// selection's Trace to… (the commands, the device panel), then a click or a
// tap on the target. Esc, or a click on empty map, clears it. A read-only
// document or a shared link arms the trace target, never link mode.
//
// It edits nothing: no undo step, nothing stored, nothing in the URL.
//
//   the answer   from the trace's own walk (calculateReachability, js/
//                diagnostics.js), the VLAN tick honoured, so Trace and the
//                target never disagree. It reaches: the map lights the
//                shortest path through the cables the walk reached, and the
//                line says "PC-1 reaches NAS through SW1 · R1 · VLAN 10 → 20
//                at R1". It does not: where the walk stops (the reached
//                device nearest the target) and the first reason the map
//                records, never a guess ("Nothing recorded explains it").
//   On port      one service (DICOM on 104): the trace's port filter and
//                the target's Allowed ports.
//   And back?    B to A too (NAT and one-way rules differ), both lines.
//   Check now    only when A is this PC (the desktop app, A matched by This
//                computer's MACs): one check from this PC (D381), beside the
//                map's answer; they can disagree and both are shown.
// "From the map, not a live test." is said every time.
// Load order: ... -> checks -> watch -> tracetarget -> issues -> app

(function () {
'use strict';
const _tt = {
    arm: null,        // a device waiting for its target (Trace to…, read only)
    from: null, to: null,
    port: '',
    back: false,
    answer: null, backAnswer: null,
    live: null,       // Check now's outcome { text, ok }
    invoke: null      // tests: stands in for window.__TAURI__.core.invoke
};
const el = (id) => document.getElementById(id);
const nameOf = (id) => { const n = getNode(id); return n ? locPlainName(n) : String(id || ''); };
function ttInvoke(cmd, args) {
    if (_tt.invoke) return Promise.resolve().then(() => _tt.invoke(cmd, args || {}));
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
const hasHost = () => !!_tt.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');

// ---- The walk ----
// The shortest way from a to b through `linkIds` (the walk's own cables) as
// traffic goes: through switches, access points and routers only (a host is
// an end, never a hop), and with `aware` one VLAN at a time: a switch passes
// a VLAN only through ends that carry it (endPassesVlan, js/model.js), and
// only a router changes it. -> { nodes, links, vlans } (vlans: each link's
// VLAN, null where the map records none) or null.
function pathThrough(a, b, linkIds, aware) {
    const passes = (n) => !!n && !isRetired(n) && (isL2Forwarder(n) || isRoutingDevice(n.type));
    const untaggedAt = (node, ifaceId) => { try { const pv = portVlans(node, ifaceId); return pv && pv.untagged !== null && pv.untagged !== undefined ? pv.untagged : null; } catch (e) { return null; } };
    const key = (id, v) => `${id}\u0000${v === null ? '' : v}`;
    const start = { id: a, v: null };
    const parent = new Map([[key(a, null), null]]);
    const queue = [start];
    let goal = null;
    for (let i = 0; i < queue.length && !goal; i++) {
        const cur = queue[i];
        const node = getNode(cur.id);
        if (cur.id !== a && !passes(node)) continue;
        const routes = !!node && isRoutingDevice(node.type);
        for (const l of linksAtNode(cur.id)) {
            if (!linkIds.has(l.id) || l.source === l.target) continue;
            const farId = l.source === cur.id ? l.target : l.source;
            const far = getNode(farId);
            if (!far) continue;
            const here = ifaceIdOn(l, cur.id), there = ifaceIdOn(l, farId);
            let v = cur.v;
            if (aware) {
                // Out of a router (or the start) the cable's own VLAN; through a
                // switch only a VLAN both ends let through.
                if (routes || cur.id === a || v === null) v = untaggedAt(node, here) ?? untaggedAt(far, there) ?? (routes || cur.id === a ? null : v);
                else if (!endPassesVlan(node, here, v) || !endPassesVlan(far, there, v)) continue;
            }
            const k = key(farId, v);
            if (parent.has(k)) continue;
            parent.set(k, { from: cur, link: l, v });
            const nx = { id: farId, v };
            if (farId === b) { goal = nx; break; }
            queue.push(nx);
        }
    }
    if (!goal) return aware ? pathThrough(a, b, linkIds, false) : null;
    const nodes = [b], links = [], vlans = [];
    for (let p = parent.get(key(goal.id, goal.v)); p; p = parent.get(key(p.from.id, p.from.v))) {
        links.unshift(p.link); vlans.unshift(aware ? p.v : linkVlan(p.link)); nodes.unshift(p.from.id);
    }
    return { nodes, links, vlans };
}
// Every cable, VLAN-blind: is there any way at all? (A VPN tunnel is one.)
const allLinkIds = () => new Set(state.links.map((l) => l.id));
// A cable's VLAN where the map says it: the untagged VLAN of either end.
function linkVlan(link) {
    for (const end of [link.source, link.target]) {
        const n = getNode(end);
        if (!n) continue;
        try { const pv = portVlans(n, ifaceIdOn(link, end)); if (pv && pv.untagged !== null && pv.untagged !== undefined) return pv.untagged; } catch (e) { /* none */ }
    }
    return null;
}
// "VLAN 10", "VLAN 10 → 20 at R1" (the router where it changed), or ''.
function vlanText(path) {
    const vs = path.vlans || path.links.map(linkVlan);
    const parts = [];
    let cur = null, last = -1;
    vs.forEach((v, i) => {
        if (v === null || v === undefined) return;
        if (cur === null) { cur = v; last = i; parts.push(t('VLAN {vlan}', { vlan: v })); return; }
        if (v !== cur) {
            // The router between the last link on the old VLAN and this one.
            const at = path.nodes.slice(last + 1, i + 1).map(getNode).find((n) => n && isRoutingDevice(n.type)) || getNode(path.nodes[i]);
            parts.push(t('→ {vlan} at {name}', { vlan: v, name: at ? locPlainName(at) : '' }));
            cur = v;
        }
        last = i;
    });
    return parts.join(' ');
}
const sameSubnet = (a, b) => getValidIps(a).some((x) => getValidIps(b).some((y) => x.networkStr === y.networkStr));

// Any way at all over the cables (any device, any VLAN): the "no cable"
// question and where a retired device is on it.
function anyWay(a, b) {
    const parent = new Map([[a, null]]);
    const queue = [a];
    for (let i = 0; i < queue.length; i++) {
        for (const l of linksAtNode(queue[i])) {
            const far = l.source === queue[i] ? l.target : l.source;
            if (parent.has(far)) continue;
            parent.set(far, queue[i]);
            if (far === b) { const nodes = [b]; for (let p = parent.get(b); p; p = parent.get(p)) nodes.unshift(p); return { nodes }; }
            queue.push(far);
        }
    }
    return null;
}
// Where the walk stops: the reached device nearest the target, by cables.
function stopNear(bId, reached) {
    const seen = new Set([bId]);
    const queue = [bId];
    for (let i = 0; i < queue.length; i++) {
        for (const l of linksAtNode(queue[i])) {
            const far = l.source === queue[i] ? l.target : l.source;
            if (seen.has(far)) continue;
            if (reached.has(far)) return far;
            seen.add(far);
            queue.push(far);
        }
    }
    return null;
}
// The first reason the map records, or the words for none (D384).
function reasonWhy(aId, bId, reach, port) {
    const a = getNode(aId), b = getNode(bId);
    const blind = anyWay(aId, bId);
    if (!blind) return { key: 'no-cable', text: t('There is no cable between {a} and {b} on the map.', { a: nameOf(aId), b: nameOf(bId) }) };
    const retired = blind.nodes.map(getNode).find((n) => n && isRetired(n));
    if (retired) return { key: 'retired', text: t('{name} is retired: off the network.', { name: locPlainName(retired) }), nodeId: retired.id };
    if (port && !acceptsPort(b, port)) return { key: 'port', text: t('{name} does not list port {port} in its Allowed ports.', { name: nameOf(bId), port }) };
    if (reach.vlans && reach.vlans.length) {
        for (const v of reach.vlans) {
            const r = vlanPath(aId, v, bId);
            if (r && !r.ok && r.link) {
                const near = getNode(r.near), far = getNode(r.far);
                const cable = `${vlanEndText(near, ifaceIdOn(r.link, near.id))} ↔ ${vlanEndText(far, ifaceIdOn(r.link, far.id))}`;
                return { key: 'vlan', text: t('VLAN {vlan} stops at {cable}: it does not carry it.', { vlan: v, cable }), linkId: r.link.id };
            }
        }
    }
    const stop = stopNear(bId, reach.reachableNodes);
    const stopNode = stop ? getNode(stop) : null;
    if (!sameSubnet(a, b)) {
        if (!effectiveGw(a) && !isRoutingDevice(a.type)) return { key: 'gateway', text: t('{a} has no gateway, and {b} is on another subnet.', { a: nameOf(aId), b: nameOf(bId) }) };
        const nat = blind.nodes.map(getNode).find((n) => n && n.nat === true && n.id !== aId);
        if (nat && !reach.reachableNodes.has(bId) && reach.reachableNodes.has(nat.id)) {
            return { key: 'nat', text: t('{name} does NAT: the map records nothing that lets traffic in from outside.', { name: locPlainName(nat) }), nodeId: nat.id };
        }
        if (stopNode && isRoutingDevice(stopNode.type) && stopNode.type !== 'cloud') {
            return { key: 'route', text: t('{name} has no subnet toward {b}.', { name: locPlainName(stopNode), b: nameOf(bId) }), nodeId: stopNode.id };
        }
    }
    return { key: 'none', text: t('Nothing recorded explains it.') };
}
// "Does A reach B?" -> { reaches, path, line, stop, why }.
function answer(aId, bId, port) {
    const p = String(port || '').trim();
    const reach = calculateReachability(aId, { port: p, vlan: state.settings.traceVlan !== false });
    if (reach.reachableNodes.has(bId)) {
        const path = pathThrough(aId, bId, reach.reachableLinks, state.settings.traceVlan !== false) || { nodes: [aId, bId], links: [], vlans: [] };
        const mid = path.nodes.slice(1, -1).map(nameOf);
        const via = (mid.length > 6 ? mid.slice(0, 6).concat([t('+{n} more', { n: mid.length - 6 })]) : mid).join(' · ');
        const vt = vlanText(path);
        const tail = [via, vt].filter(Boolean).join(' · ');
        const line = tail ? t('{a} reaches {b} through {via}', { a: nameOf(aId), b: nameOf(bId), via: tail }) : t('{a} reaches {b}', { a: nameOf(aId), b: nameOf(bId) });
        return { reaches: true, path, line: p ? `${line} · ${t('port {port}', { port: p })}` : line };
    }
    const why = reasonWhy(aId, bId, reach, p);
    const stop = stopNear(bId, reach.reachableNodes);
    const line = t('{a} does not reach {b}', { a: nameOf(aId), b: nameOf(bId) }) + (p ? ` · ${t('port {port}', { port: p })}` : '');
    return { reaches: false, path: null, line, stop, stopLine: stop && stop !== aId ? t('It stops at {name}.', { name: nameOf(stop) }) : '', why };
}

// ---- Asking ----
function ask(aId, bId) {
    if (!getNode(aId) || !getNode(bId) || aId === bId) return null;
    Object.assign(_tt, { arm: null, from: aId, to: bId, live: null });
    recompute();
    if (typeof renderCanvasOnly === 'function') renderCanvasOnly();
    if (hasHost() && window.TopoChecks && TopoChecks.readMacs) TopoChecks.readMacs().then(renderBar).catch(() => {});
    return _tt.answer;
}
function recompute() {
    if (!_tt.from || !_tt.to || !getNode(_tt.from) || !getNode(_tt.to)) { _tt.answer = _tt.backAnswer = null; renderBar(); return; }
    _tt.answer = answer(_tt.from, _tt.to, _tt.port);
    _tt.backAnswer = _tt.back ? answer(_tt.to, _tt.from, _tt.port) : null;
    renderBar();
}
function armFrom(id) {
    if (!getNode(id)) return false;
    Object.assign(_tt, { arm: id, from: null, to: null, answer: null, backAnswer: null, live: null, back: false });
    if (typeof renderCanvasOnly === 'function') renderCanvasOnly();
    renderBar();
    return true;
}
function clear() {
    if (!_tt.arm && !_tt.from) return false;
    Object.assign(_tt, { arm: null, from: null, to: null, answer: null, backAnswer: null, live: null, back: false, port: '' });
    renderBar();
    if (typeof renderCanvasOnly === 'function') renderCanvasOnly();
    return true;
}
// A right-click (or a long-press) on a device. -> true when it was taken
// here (the caller then arms nothing): the second one of a pair asks, and a
// read-only document arms the target instead of link mode (D382, D383).
function onContext(id) {
    const src = state.linkSourceId;
    // The same device right-clicked again: tracing from it; a third time: off (D432).
    if (src === id && getNode(id)) { state.linkSourceId = null; armFrom(id); return true; }
    if (_tt.arm === id) { clear(); return true; }
    if (src && src !== id && getNode(src) && !(typeof getAnnotation === 'function' && getAnnotation(src))) {
        state.linkSourceId = null;
        ask(src, id);
        return true;
    }
    if (_tt.arm && _tt.arm !== id) { ask(_tt.arm, id); return true; }
    if (state.readOnly) { armFrom(id); return true; }
    if (_tt.from) clear();
    return false;
}
// A left click on a device while a target is awaited (Trace to…, read only).
function onClick(id) {
    if (!_tt.arm || _tt.arm === id) return false;
    ask(_tt.arm, id);
    return true;
}
const onPath = (id) => !!(_tt.answer && _tt.answer.path && _tt.answer.path.nodes.includes(id));
const linkOnPath = (id) => !!(_tt.answer && _tt.answer.path && _tt.answer.path.links.some((l) => l.id === id));
const isEnd = (id) => !!_tt.answer && (id === _tt.from || id === _tt.to);
// The device waiting for its target, and whether a found path is lit (the
// rest of the map is dimmed then, D432).
const armed = () => _tt.arm;
const lit = () => !!(_tt.answer && _tt.answer.reaches && _tt.answer.path);

// ---- Check now, when A is this PC (D381, D386) ----
function liveOffered() {
    if (!hasHost() || !_tt.from || !window.TopoChecks || !TopoChecks.meOnMap) return false;
    return TopoChecks.meOnMap(state.nodes) === _tt.from;
}
function checkNowSpec(b, port) {
    const ips = getValidIps(b).map((x) => x.ip.toString());
    const p = asCheckPort(String(port || '').split(/[^\d]/)[0]);
    return p ? { proto: 'tcp', host: ips[0] || '', port: p } : { proto: 'ping', host: ips[0] || '', port: 0, fallbackPort: 0 };
}
function outcomeText(o) {
    const when = new Date().toLocaleTimeString((window.CarinoI18N && CarinoI18N.current ? CarinoI18N.current() : undefined), { hour: '2-digit', minute: '2-digit' });
    if (!o) return t('From this PC: it could not be asked.');
    if (o.ok) return t('From this PC: answered in {ms} ms, {time}', { ms: o.rttMs == null ? '—' : Math.round(o.rttMs * 10) / 10, time: when });
    if (o.skipped) return t('From this PC: it cannot be asked ({why}).', { why: o.status || '' });
    return t('From this PC: no answer ({why}), {time}', { why: o.status || '', time: when });
}
async function checkNow() {
    const b = getNode(_tt.to);
    if (!b || !liveOffered()) return null;
    const spec = checkNowSpec(b, _tt.port);
    if (!spec.host) { _tt.live = { text: t('From this PC: {name} has no address to ask.', { name: nameOf(_tt.to) }), ok: false }; renderBar(); return _tt.live; }
    _tt.live = { text: t('Asking from this PC…'), ok: null };
    renderBar();
    let o = null;
    try { o = await ttInvoke('check_now', { spec }); } catch (e) { o = null; }
    _tt.live = { text: outcomeText(o), ok: !!(o && o.ok) };
    renderBar();
    return _tt.live;
}

// ---- The bar ----
// A phone's width, as js/mobile.js's link banner (900px and under).
const phoneWide = () => !!(window.matchMedia && matchMedia('(max-width: 900px)').matches);
function bar() {
    let b = el('traceTargetBar');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'traceTargetBar';
    b.className = 'tt-bar';
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'polite');
    b.hidden = true;
    b.addEventListener('click', (e) => {
        const x = e.target.closest('[data-tt]');
        if (!x) return;
        const what = x.dataset.tt;
        if (what === 'close') clear();
        else if (what === 'back') { _tt.back = !_tt.back; recompute(); }
        else if (what === 'now') checkNow();
    });
    b.addEventListener('change', (e) => {
        if (e.target.id !== 'ttPort') return;
        _tt.port = e.target.value.trim();
        _tt.live = null;
        recompute();
        if (typeof renderCanvasOnly === 'function') renderCanvasOnly();
    });
    document.body.appendChild(b);
    return b;
}
function lineHtml(a, cls) {
    if (!a) return '';
    let h = `<p class="tt-line ${a.reaches ? 'tt-ok' : 'tt-no'} ${cls || ''}">${escapeHtml(a.line)}</p>`;
    if (!a.reaches) h += `<p class="tt-why">${escapeHtml([a.stopLine, a.why && a.why.text].filter(Boolean).join(' '))}</p>`;
    return h;
}
function renderBar() {
    const b = bar();
    if (!_tt.arm && !_tt.answer) { if (!b.hidden) b.hidden = true; b.innerHTML = ''; return; }
    b.hidden = false;
    const x = `<button type="button" class="tt-x" data-tt="close" aria-label="${escapeHtml(t('Close'))}" title="${escapeHtml(t('Close'))}">✕</button>`;
    if (_tt.arm) {
        // As link mode (D433): the map says it over the device; only a
        // phone, whose finger hides it, has the line as a banner.
        if (!phoneWide()) { b.hidden = true; b.innerHTML = ''; return; }
        b.innerHTML = `<div class="tt-head"><p class="tt-line">${escapeHtml(t('Click or tap the device to ask whether {name} reaches it.', { name: nameOf(_tt.arm) }))}</p>${x}</div>`;
        return;
    }
    let h = `<div class="tt-head"><div class="tt-lines">${lineHtml(_tt.answer)}${_tt.back ? lineHtml(_tt.backAnswer, 'tt-back') : ''}</div>${x}</div>`;
    h += `<p class="tt-note">${escapeHtml(t('From the map, not a live test.'))}</p>`;
    if (_tt.live) h += `<p class="tt-live ${_tt.live.ok ? 'tt-ok' : _tt.live.ok === false ? 'tt-no' : ''}">${escapeHtml(_tt.live.text)}</p>`;
    h += '<div class="tt-acts">'
        + `<label class="tt-port"><span>${escapeHtml(t('On port'))}</span><input id="ttPort" class="input mono" inputmode="numeric" maxlength="11" autocomplete="off" placeholder="${escapeHtml(t('any'))}" value="${escapeHtml(_tt.port)}"></label>`
        + `<button type="button" class="btn" data-tt="back" aria-pressed="${_tt.back}">${escapeHtml(t('And back?'))}</button>`
        + (liveOffered() ? `<button type="button" class="btn" data-tt="now">${escapeHtml(t('Check now'))}</button>` : '')
        + '</div>';
    b.innerHTML = h;
}

// The device panel's Trace to… (D382).
(function wire() {
    const b = el('traceToBtn');
    if (b) b.addEventListener('click', () => {
        if (state.selectedType === 'node' && state.selectedId) armFrom(state.selectedId);
        else showToast(t('Select the device to start from first.'), 'warn');
    });
})();

window.TopoTraceTarget = { state: _tt, answer, ask, armFrom, clear, onContext, onClick, onPath, linkOnPath, isEnd, armed, lit, checkNow, checkNowSpec, outcomeText, renderBar, pathThrough };
})();
