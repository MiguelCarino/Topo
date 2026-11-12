// ---- This computer (docs/SCOPE.md D166, step 7d; D204-D208) ----
// The desktop app only: "Add this computer" (the Nodes panel and Settings)
// asks the app for this PC's own interfaces, default gateways and DNS
// servers (desktop/src-tauri/src/thiscomputer.rs, the `this_computer`
// command; nothing goes onto the network) and hands what it read to the
// Import… review (js/importui.js, openResult), so nothing is kept before the
// merge review:
//   - the PC as one device (type PC, its name, its system, its DNS servers);
//   - its network cards as interfaces, each with one address (IPv4 first,
//     else a stable IPv6; Topo keeps one address per interface), its MAC and
//     Wi-Fi when the system says so;
//   - the subnet of each of those addresses, from the address and prefix.
// Nothing else (the owner's decision): the default gateway is not added,
// the review shows it as information, with the DNS servers, the MTUs, the
// addresses not kept and the interfaces left out. Virtual interfaces
// (bridges, containers' links, tunnels) are left out unless ticked.
// A second run is the same review again: the merge finds the PC by its MAC
// (else its name) and its interfaces by name, MAC or address, so it updates
// instead of adding a second PC.
//
// The website and the offline zip have no window.__TAURI__: the buttons
// stay hidden and nothing here runs.
// Load order: ... -> importers -> importui -> thiscomputer -> ... -> settings

(function () {
'use strict';
const _tc = { invoke: null, busy: false };
const el = (id) => document.getElementById(id);

function tcInvoke(cmd, args) {
    if (_tc.invoke) return _tc.invoke(cmd, args || {});
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return Promise.reject(new Error('no-host'));
    return core.invoke(cmd, args || {});
}
const hasHost = () => !!_tc.invoke || !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');

// What an address is, for choosing the one an interface keeps.
function addrKind(a) {
    const ip = String(a.ip || '');
    if (ip.includes(':')) {
        const lc = ip.toLowerCase();
        if (lc === '::1' || lc === '::') return 'skip';
        if (/^fe[89ab]/.test(lc)) return 'v6-link';
        return a.temporary ? 'v6-temp' : 'v6';
    }
    if (/^127\./.test(ip) || ip === '0.0.0.0') return 'skip';
    if (/^169\.254\./.test(ip)) return 'v4-link';
    return 'v4';
}
const RANK = { v4: 1, v6: 2, 'v4-link': 3 };
// The address an interface keeps (D205): IPv4 first, else a stable IPv6,
// else an IPv4 link-local one. Temporary and IPv6 link-local ones never.
function chooseAddress(addrs) {
    const ok = (addrs || []).filter((a) => RANK[addrKind(a)]);
    ok.sort((a, b) => RANK[addrKind(a)] - RANK[addrKind(b)]);
    return ok[0] || null;
}
const cidrOf = (a) => `${a.ip}/${a.prefix}`;
const ifaceName = (i) => i.label || i.name || '';
// An address that says the card is on a network: not loopback, not
// link-local, not a temporary one (D209: a card that is not connected and
// has only those is left out).
const isReal = (a) => { const k = addrKind(a); return k === 'v4' || k === 'v6'; };
// A DNS server worth writing on the device (D210): never loopback (a local
// stub such as systemd-resolved's 127.0.0.53) nor the fec0:0:0:ffff::1-3
// placeholders Windows lists.
function realDns(s) {
    const ip = String(s || '').trim().toLowerCase();
    if (!ip || /^127\./.test(ip) || ip === '::1' || ip === '0.0.0.0' || ip === '::') return false;
    return !/^fec0:0{0,4}:0{0,4}:ffff::[123]$/.test(ip);
}

// The interfaces that are considered at all: not loopback, and with
// something of their own (an address or a MAC).
function candidates(info) {
    return (info.interfaces || []).filter((i) => !i.loopback && (i.mac || (i.addresses || []).some((a) => addrKind(a) !== 'skip')));
}

// The app's answer -> an Import… result (the shape TopoImporters.parse
// gives), with `info` lines for the review and the virtual tick.
function toResult(info, opts = {}) {
    const C = window.TopoImportCommon;
    const b = C.builder();
    const virtualOn = !!opts.virtual;
    const all = candidates(info);
    const virt = all.filter((i) => !i.physical);
    const down = all.filter((i) => i.physical && !i.up && !(i.addresses || []).some(isReal));
    const used = all.filter((i) => (i.physical || virtualOn) && !down.includes(i));
    const hostname = String(info.hostname || '').trim().split('.')[0].slice(0, 120);
    const mac = (used.find((i) => i.physical && i.mac) || used.find((i) => i.mac) || {}).mac || '';
    const init = { type: 'pc', name: hostname || 'PC' };
    if (info.os) init.os = String(info.os).slice(0, 120);
    const dns = (info.dns || []).filter(realDns);
    if (dns.length) init.dns = dns.join(', ');
    const lines = [];
    let n = null;
    if (used.length || hostname) {
        n = b.node({ mac, name: hostname }, init);
        used.forEach((i) => {
            const keep = chooseAddress(i.addresses);
            const f = { name: ifaceName(i) };
            if (i.mac) f.mac = i.mac;
            if (keep) {
                f.ip = cidrOf(keep);
                const full = keep.ip.includes(':') ? 128 : 32;
                if (keep.prefix < full && addrKind(keep) !== 'v4-link') b.network(f.ip);
            }
            if (i.wireless) f.wireless = true;
            b.iface(n, f);
            const extra = (i.addresses || []).filter((a) => a !== keep && addrKind(a) !== 'skip' && addrKind(a) !== 'v6-link' && addrKind(a) !== 'v6-temp');
            if (extra.length) lines.push({ code: 'tc-extra', params: { name: ifaceName(i), list: extra.map(cidrOf).join(', ') } });
        });
    }
    const gws = (info.gateways || []).map((g) => ({ code: 'tc-gateway', params: { address: g.ip, name: g.iface || '' } }));
    lines.unshift(...(gws.length ? gws : [{ code: 'tc-no-gateway', params: {} }]));
    lines.push({ code: dns.length ? 'tc-dns' : 'tc-no-dns', params: { list: dns.join(', ') } });
    used.filter((i) => i.mtu).forEach((i) => lines.push({ code: 'tc-mtu', params: { name: ifaceName(i), mtu: i.mtu } }));
    if (virt.length && !virtualOn) lines.push({ code: virt.length === 1 ? 'tc-virtual-1' : 'tc-virtual', params: { n: virt.length, list: virt.map(ifaceName).join(', ') } });
    if (down.length) lines.push({ code: 'tc-down', params: { list: down.map(ifaceName).join(', ') } });
    const doc = b.finish();
    const res = {
        importer: 'thiscomputer', label: 'This computer', files: [hostname || 'PC'], name: hostname || 'PC',
        doc, full: doc, counts: C.countDoc(doc), extraCounts: {}, warnings: [], notes: [], parts: [], info: lines,
        options: virt.length ? [{ key: 'virtual', label: 'Also add the virtual interfaces ({n})', n: virt.length, on: virtualOn }] : [],
        rebuild: (o) => toResult(info, Object.assign({}, opts, o)),
        thisComputer: info
    };
    return res;
}

// Read this PC and open the review. -> the result, or null.
async function addThisComputer() {
    if (_tc.busy || !hasHost()) return null;
    _tc.busy = true;
    try {
        const info = await tcInvoke('this_computer');
        const res = toResult(info || {});
        if (typeof closeSettings === 'function' && typeof settingsOpen === 'function' && settingsOpen()) closeSettings();
        window.TopoImportUI.openResult(res);
        return res;
    } catch (e) {
        showToast(t('Topo could not read this computer: {error}', { error: String((e && e.message) || e || '') }), 'err');
        return null;
    } finally { _tc.busy = false; }
}

// The buttons show only in the app.
function renderThisComputer() {
    const on = hasHost();
    const sec = el('setTcSec');
    if (sec) sec.hidden = !on;
    const btn = el('addThisPcBtn');
    if (btn) btn.classList.toggle('hidden', !on);
}

(function wire() {
    const btn = el('addThisPcBtn');
    if (btn) btn.addEventListener('click', () => { addThisComputer(); });
    const set = el('setTcAdd');
    if (set) set.addEventListener('click', () => { addThisComputer(); });
    renderThisComputer();
})();

window.renderThisComputer = renderThisComputer;
window.TopoThisComputer = { state: _tc, toResult, addThisComputer, chooseAddress, renderThisComputer, hasHost, realDns };
})();
