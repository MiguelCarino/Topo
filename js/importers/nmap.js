// ---- nmap XML (-oX) to Topo (docs/SCOPE.md step 6, D114) ----
// A scan's hosts that are up become devices: their address (with the prefix
// of the subnet the scan names in its command line, else /32 with a note),
// MAC and its vendor, host name, open ports and services as a notes line
// (Allowed Ports is a rule Topo checks, not what a scan saw, so nothing is
// written there), and the OS guess when nmap is at least 85% sure (else a
// notes line with its accuracy). The type comes from the services and the OS.
// No cables, no ids: a scan has no stable key, so a re-scan matches by MAC,
// then address, then name. Several scans picked together are one set.

(function () {
'use strict';
const C = window.TopoImportCommon;

function detect(file) {
    const s = String(file.text || '').slice(0, 2000);
    if (/<nmaprun[\s>]/.test(s)) return 0.98;
    if (/<!DOCTYPE nmaprun/.test(s)) return 0.95;
    return 0;
}

const attr = (n, a) => (n && n.getAttribute(a)) || '';
const kids = (n, tag) => (n ? [...n.children].filter((c) => c.tagName === tag) : []);
const kid = (n, tag) => kids(n, tag)[0] || null;

// The type from what answered: printers, cameras, phones, Windows PCs,
// Linux servers, network gear by its OS words.
function typeOf(open, osText, vendor) {
    const ports = new Set(open.map((p) => p.port));
    const svc = open.map((p) => p.service).join(' ');
    const os = String(osText || '').toLowerCase();
    if (ports.has(9100) || ports.has(631) || /ipp|jetdirect|printer/.test(svc) || /printer|laserjet/.test(os)) return 'printer';
    if (ports.has(554) || /rtsp/.test(svc) || /camera|ip cam|hikvision|axis/i.test(os + ' ' + vendor)) return 'camera';
    if (ports.has(5060) || ports.has(5061) || /\bsip\b/.test(svc)) return 'voip';
    if (ports.has(104) || ports.has(11112) || /dicom/.test(svc)) return 'dicom';
    if (/routeros|ios xe|cisco ios|junos|fortios|pfsense|opnsense|edgeos|openwrt|router/.test(os)) return /fortios|pfsense|opnsense|firewall/.test(os) ? 'firewall' : 'router';
    if (/switch/.test(os)) return 'switch';
    if (/windows/.test(os)) return /server/.test(os) ? 'server' : (ports.has(3389) || ports.has(445) || ports.has(139) ? 'pc' : 'pc');
    if (/linux|unix|bsd/.test(os) && ports.has(22)) return 'server';
    if (/vmware|esxi|proxmox/.test(os)) return 'server';
    if (/\b(iphone|ios|android|mac os|macos)\b/.test(os)) return 'pc';
    return 'custom';
}

// The subnets named on the command line ("nmap -sV -oX x.xml 192.168.1.0/24").
function argNets(args) {
    return String(args || '').split(/\s+/).filter((w) => /^[0-9a-f:.]+\/\d{1,3}$/i.test(w) && parseValidCIDR(w));
}

function parse(files) {
    const b = C.builder();
    const warnings = [], notes = [];
    let scans = 0, down = 0;
    const docs = [];
    files.forEach((f) => {
        let xml = null;
        try { xml = new DOMParser().parseFromString(String(f.text || ''), 'application/xml'); } catch (e) { xml = null; }
        const root = xml && xml.documentElement;
        if (!root || root.tagName !== 'nmaprun' || xml.getElementsByTagName('parsererror').length) {
            warnings.push(C.issue('bad-xml', { file: f.name }));
            return;
        }
        docs.push({ f, root });
        argNets(attr(root, 'args')).forEach((cidr) => b.network(cidr));
    });
    docs.forEach(({ f, root }) => {
        scans++;
        kids(root, 'host').forEach((h, idx) => {
            const st = attr(kid(h, 'status'), 'state');
            if (st && st !== 'up') { down++; return; }
            const addrs = kids(h, 'address');
            const ip4 = addrs.find((a) => attr(a, 'addrtype') === 'ipv4');
            const ip6 = addrs.find((a) => attr(a, 'addrtype') === 'ipv6');
            const macEl = addrs.find((a) => attr(a, 'addrtype') === 'mac');
            const ip = attr(ip4 || ip6, 'addr');
            const mac = C.macText(attr(macEl, 'addr'));
            if (!ip && !mac) { warnings.push(C.issue('host-no-address', { file: f.name }, { n: idx + 1 })); return; }
            const names = kids(kid(h, 'hostnames'), 'hostname');
            const hn = (names.find((x) => attr(x, 'type') === 'user') || names.find((x) => attr(x, 'type') === 'PTR') || names[0]);
            // A reverse-DNS name loses its domain; one the user gave is kept.
            let hostname = attr(hn, 'name');
            if (hostname && attr(hn, 'type') === 'PTR' && !C.isIp(hostname)) hostname = hostname.split('.')[0];
            const open = kids(kid(h, 'ports'), 'port').filter((p) => attr(kid(p, 'state'), 'state') === 'open').map((p) => {
                const s = kid(p, 'service');
                const product = [attr(s, 'product'), attr(s, 'version')].filter(Boolean).join(' ');
                return { port: Number(attr(p, 'portid')), proto: attr(p, 'protocol') || 'tcp', service: attr(s, 'name'), product };
            });
            const matches = kids(kid(h, 'os'), 'osmatch').map((m) => ({ name: attr(m, 'name'), acc: Number(attr(m, 'accuracy')) || 0 }))
                .sort((a, z) => z.acc - a.acc);
            const best = matches[0];
            let vendor = attr(macEl, 'vendor');
            if (!vendor && mac && window.CarinoOUI) { const v = CarinoOUI.lookupVendor(CarinoOUI.normalizeMac(mac)); if (v && v.kind === 'oui') vendor = v.vendor; }
            const osSure = best && best.acc >= 85 ? best.name : '';
            const type = typeOf(open, best ? best.name : '', vendor);
            const lines = [];
            if (open.length) lines.push('Open: ' + open.map((p) => `${p.port}/${p.proto}${p.service ? ' ' + p.service : ''}${p.product ? ` (${p.product})` : ''}`).join(', '));
            if (best && !osSure) lines.push(`OS guess: ${best.name} (${best.acc}%)`);
            const seen = attr(h, 'endtime') || attr(h, 'starttime') || attr(root, 'start');
            if (seen && /^\d+$/.test(seen)) lines.push('Seen by nmap: ' + new Date(Number(seen) * 1000).toISOString().slice(0, 10));
            const init = { type, name: hostname || '' };
            if (vendor) init.vendor = vendor;
            if (osSure) init.os = osSure;
            const n = b.node({ mac, ip, name: hostname }, init);
            if (lines.length) {
                const add = lines.filter((l) => !String(n.notes || '').includes(l));
                if (add.length) n.notes = [n.notes, ...add].filter(Boolean).join('\n');
            }
            const iface = { mac };
            if (ip) iface.ip = b.addr(ip);
            b.iface(n, iface);
            if (ip4 && ip6 && attr(ip6, 'addr')) b.iface(n, { ip: b.addr(attr(ip6, 'addr')), name: '' });
        });
    });
    if (down) notes.push(C.issue('hosts-down', null, { n: down }));
    b.notes(notes);
    return { doc: b.finish(), warnings, notes, name: '', counts: { scans } };
}

const importer = { id: 'nmap', label: 'nmap XML', family: 'nmap', multi: true, detect, parse };
if (window.TopoImporters) TopoImporters.register(importer);
window.TopoImportNmap = { importer, typeOf };
})();
