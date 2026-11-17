// ---- Reaching a device, and its own picture (docs/SCOPE.md steps 9e and 9g) ----
// Two facts a device carries since document v21 (js/model.js):
//   - access (D446): how it is reached: web, SSH, RDP, VNC, Telnet, each with
//     a port and, if wanted, a user name. Never a password or a key. Each is
//     a button on the device. On the website a button is a link the
//     computer's own client answers (ssh://, vnc://, telnet://, the web
//     address) and, for RDP, a small .rdp file, since few systems answer
//     rdp://. Topo opens no connection itself and sits between nobody and
//     their credentials.
//   - icon (D442): a picture drawn in place of its kind's icon, chosen from
//     a file (on a phone, the camera is offered by the system's own
//     chooser). Scaled to 96 px and kept in the document as a data: address
//     within ICON_MAX, and within ICON_TOTAL_MAX for the whole network, so a
//     share link and a back-up carry it. Only ever drawn as an image.
// The address a way in uses is the device's first valid address: Topo does
// not guess a name.
// The programs a way in needs (D450-D452, steps 9l and 9m):
//   - on the website a page cannot see what is installed, and Topo does not
//     probe: under the buttons one link, Need a program for these? ↗, opens
//     software.carino.systems searched for them. A link the person clicks;
//     Topo asks that site nothing.
//   - in the desktop app (window.__TAURI__) the buttons start this
//     computer's own program (reach_open, desktop/src-tauri/src/reach.rs),
//     found by reach_clients, asked once. A kind with no program here is a
//     link to the catalogue searched for that kind, and says so. Nothing is
//     installed by Topo.
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const ICON_TOTAL_MAX = 1400000;   // characters over the whole network: about 1 MB of pictures
    const ICON_SIZES = [96, 64, 48];
    const LABELS = { web: 'Open web page ↗', ssh: 'SSH ↗', rdp: 'Remote Desktop ⭳', vnc: 'VNC ↗', telnet: 'Telnet ↗' };
    const KIND_NAMES = { web: 'Web page', ssh: 'SSH', rdp: 'Remote Desktop (RDP)', vnc: 'VNC', telnet: 'Telnet' };

    const CATALOGUE = 'https://software.carino.systems/';
    // The catalogue searched for one kind's programs, or for all of them.
    const programsLink = (kind) => `${CATALOGUE}?search=${kind ? `${kind}-client` : 'remote-access'}`;
    // The desktop app: its commands, and what it found (undefined until asked, null when it could not say).
    const _host = { invoke: null, clients: undefined, asking: null };
    function hostInvoke() {
        if (_host.invoke) return _host.invoke;
        const core = window.__TAURI__ && window.__TAURI__.core;
        return core && typeof core.invoke === 'function' ? core.invoke.bind(core) : null;
    }
    function askClients() {
        const invoke = hostInvoke();
        if (!invoke) return Promise.resolve(null);
        if (!_host.asking) {
            _host.asking = Promise.resolve().then(() => invoke('reach_clients', {})).then((c) => { _host.clients = c && typeof c === 'object' ? c : null; })
                .catch(() => { _host.clients = null; }).then(() => { const n = state.selectedId && getNode(state.selectedId); if (n) renderButtons(n); return _host.clients; });
        }
        return _host.asking;
    }
    const OPEN_ERRORS = { 'bad-address': 'That address, port or user name cannot be handed to a program.', none: 'No program for this was found on this computer.',
        'no-terminal': 'No terminal was found on this computer to open it in.' };
    function openInApp(node, a) {
        const invoke = hostInvoke();
        const ip = reachAddress(node);
        if (!invoke || !ip) return Promise.resolve(false);
        return Promise.resolve().then(() => invoke('reach_open', { kind: a.kind, host: ip, port: a.port || null, user: a.user || null })).then(() => true)
            .catch((e) => { showToast(t(OPEN_ERRORS[String(e)] || 'The program could not be started.'), 'warn'); return false; });
    }

    function reachAddress(node) {
        const ips = getValidIps(node);
        return ips.length ? ips[0].ip.toString() : '';
    }
    // The address a way in opens, or null (no address yet, or RDP, which is a file).
    function reachUrl(node, a) {
        const ip = reachAddress(node);
        if (!ip || !a || a.kind === 'rdp') return null;
        const host = ip.includes(':') ? `[${ip}]` : ip;
        if (a.kind === 'web') {
            const own = a.tls ? 443 : 80;
            return `${a.tls ? 'https' : 'http'}://${host}${a.port && a.port !== own ? `:${a.port}` : ''}${a.path || '/'}`;
        }
        const user = a.user && a.kind !== 'vnc' ? `${encodeURIComponent(a.user)}@` : '';
        return `${a.kind}://${user}${host}${a.port && a.port !== ACCESS_PORTS[a.kind] ? `:${a.port}` : ''}`;
    }
    // What a Remote Desktop client reads. It asks for the password itself.
    function rdpFileText(node, a) {
        const ip = reachAddress(node);
        if (!ip) return null;
        const host = ip.includes(':') ? `[${ip}]` : ip;
        return [`full address:s:${host}${a.port && a.port !== ACCESS_PORTS.rdp ? `:${a.port}` : ''}`, a.user ? `username:s:${a.user}` : null, 'prompt for credentials:i:1', '']
            .filter((l) => l !== null).join('\r\n');
    }
    const fileNameOf = (node) => `${String(node.name || node.id).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60) || 'device'}.rdp`;

    // An edit of the selected device: one undo step, the map and the panel redrawn.
    function change(node, fn) {
        if (typeof readOnlyRefuses === 'function' && readOnlyRefuses()) return;
        fn();
        save(); renderCanvasOnly();
        renderReach(node);
    }
    const waysOf = (node) => (Array.isArray(node.access) ? node.access : []);
    function setWays(node, list) {
        const kept = asAccess(list);
        if (kept) node.access = kept; else delete node.access;
    }

    // ---- The buttons ----
    function renderButtons(node) {
        const row = $('reachRow');
        if (!row) return;
        row.textContent = '';
        const ways = node ? waysOf(node) : [];
        row.classList.toggle('hidden', !ways.length);
        const ip = node ? reachAddress(node) : '';
        const inApp = !!hostInvoke();
        if (inApp && _host.clients === undefined) askClients();
        const found = inApp ? _host.clients : null;
        ways.forEach((a) => {
            const label = t(LABELS[a.kind]) + (a.user && a.kind !== 'web' && a.kind !== 'vnc' ? ` (${a.user})` : '');
            if (!ip) {
                const off = document.createElement('button');
                off.type = 'button'; off.className = 'btn reach-btn'; off.disabled = true; off.textContent = label;
                off.title = t('This device has no address yet.');
                row.appendChild(off);
                return;
            }
            if (inApp && a.kind !== 'web') {
                // No program here for this kind: the catalogue, searched for it.
                if (found && !found[a.kind]) {
                    const need = document.createElement('a');
                    need.className = 'btn reach-btn reach-missing'; need.dataset.kind = a.kind; need.dataset.missing = '1';
                    need.textContent = t('{kind}: get a program ↗', { kind: KIND_NAMES[a.kind].split(' (')[0] });
                    need.href = programsLink(a.kind); need.target = '_blank'; need.rel = 'noopener noreferrer';
                    need.title = t('No program for this was found on this computer. Opens software.carino.systems with the ones that do it.');
                    row.appendChild(need);
                    return;
                }
                const b = document.createElement('button');
                b.type = 'button'; b.className = 'btn reach-btn'; b.textContent = label.replace(' ⭳', ' ↗'); b.dataset.kind = a.kind;
                b.title = found && found[a.kind] ? t('Opens {address} in {program}. It asks for the password itself.', { address: ip, program: found[a.kind] }) : ip;
                b.onclick = () => openInApp(node, a);
                row.appendChild(b);
                return;
            }
            if (a.kind === 'rdp') {
                const b = document.createElement('button');
                b.type = 'button'; b.className = 'btn reach-btn'; b.textContent = label; b.dataset.kind = 'rdp';
                b.title = t('Downloads a .rdp file for {address}. Your Remote Desktop client asks for the password.', { address: ip });
                b.onclick = () => downloadRdp(node, a);
                row.appendChild(b);
                return;
            }
            const link = document.createElement('a');
            link.className = 'btn reach-btn'; link.textContent = label; link.dataset.kind = a.kind;
            link.href = reachUrl(node, a);
            link.title = link.href;
            link.rel = 'noopener noreferrer';
            if (a.kind === 'web') link.target = '_blank';
            row.appendChild(link);
        });
        // The website cannot see what is installed: one link to the programs (D451).
        // It sits under the row, not in it: the row holds one button per way in.
        let need = $('reachNeed');
        if (!need) {
            need = document.createElement('a');
            need.className = 'link-btn reach-need'; need.id = 'reachNeed';
            need.target = '_blank'; need.rel = 'noopener noreferrer';
            row.insertAdjacentElement('afterend', need);
        }
        need.textContent = t('Need a program for these? ↗');
        need.href = programsLink('');
        need.title = t('Opens software.carino.systems with programs for SSH, Remote Desktop, VNC and Telnet. Topo itself contacts nothing.');
        need.classList.toggle('hidden', inApp || !ways.some((a) => a.kind !== 'web'));
    }
    function downloadRdp(node, a) {
        const text = rdpFileText(node, a);
        if (!text) return;
        const url = URL.createObjectURL(new Blob([text], { type: 'application/x-rdp' }));
        const link = document.createElement('a');
        link.href = url; link.download = fileNameOf(node);
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ---- The list of ways in (full editor) ----
    function renderEditor(node) {
        const list = $('reachList');
        if (!list) return;
        list.textContent = '';
        const ways = node ? waysOf(node) : [];
        $('reachSummary').textContent = ways.length ? ways.map((a) => KIND_NAMES[a.kind].split(' ')[0]).join(', ') : '';
        if (!node) return;
        const input = (cls, value, placeholder, label) => {
            const i = document.createElement('input');
            i.type = 'text'; i.className = `input reach-in ${cls}`; i.value = value == null ? '' : String(value); i.placeholder = placeholder; i.autocomplete = 'off';
            i.setAttribute('aria-label', label);
            return i;
        };
        ways.forEach((a, idx) => {
            const row = document.createElement('div');
            row.className = 'reach-way'; row.dataset.kind = a.kind;
            const kind = document.createElement('select');
            kind.className = 'select reach-kind'; kind.setAttribute('aria-label', t('Kind'));
            ACCESS_KINDS.forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = t(KIND_NAMES[k]); kind.appendChild(o); });
            kind.value = a.kind;
            const edit = (patch) => change(node, () => setWays(node, ways.map((w, i) => (i === idx ? Object.assign({}, w, patch) : w))));
            kind.onchange = () => edit({ kind: kind.value, tls: undefined, path: undefined });
            const port = input('reach-port', a.port, String(a.kind === 'web' && a.tls ? 443 : ACCESS_PORTS[a.kind]), t('Port'));
            port.inputMode = 'numeric';
            port.onchange = () => edit({ port: port.value.trim() === '' ? undefined : port.value.trim() });
            row.append(kind, port);
            if (a.kind === 'web') {
                const tls = document.createElement('label');
                tls.className = 'prop-check reach-tls';
                const box = document.createElement('input'); box.type = 'checkbox'; box.checked = a.tls === true;
                box.onchange = () => edit({ tls: box.checked ? true : undefined });
                const word = document.createElement('span'); word.textContent = 'https';
                tls.append(box, word);
                const path = input('reach-path', a.path, '/', t('Path'));
                path.onchange = () => edit({ path: path.value.trim() || undefined });
                row.append(tls, path);
            } else if (a.kind !== 'vnc') {
                const user = input('reach-user', a.user, t('user name'), t('User name'));
                user.onchange = () => edit({ user: user.value.trim() || undefined });
                row.append(user);
            }
            const x = document.createElement('button');
            x.type = 'button'; x.className = 'link-btn reach-x'; x.textContent = '✕'; x.title = t('Remove'); x.setAttribute('aria-label', t('Remove'));
            x.onclick = () => change(node, () => setWays(node, ways.filter((w, i) => i !== idx)));
            row.append(x);
            list.appendChild(row);
        });
        const add = $('reachAddBtn');
        add.disabled = ways.length >= ACCESS_MAX;
        add.onclick = () => {
            // The next kind this device has none of yet, web first.
            const next = ACCESS_KINDS.find((k) => !ways.some((w) => w.kind === k)) || 'web';
            change(node, () => setWays(node, ways.concat([{ kind: next }])));
        };
    }

    // ---- Its own picture ----
    const iconTotal = (but) => state.nodes.reduce((n, d) => n + (d && d !== but && typeof d.icon === 'string' ? d.icon.length : 0), 0);
    // -> true when kept. Refused: not a picture the format takes, or too much for one network.
    function setIcon(node, dataUrl) {
        const icon = asIcon(dataUrl);
        if (!icon) { showToast(t('That picture could not be used. Choose an SVG, PNG, WebP or JPEG.'), 'warn'); return false; }
        if (iconTotal(node) + icon.length > ICON_TOTAL_MAX) { showToast(t('This network already holds as many pictures as it can carry in a link. Remove one first.'), 'warn'); return false; }
        change(node, () => { node.icon = icon; });
        return true;
    }
    function clearIcon(node) { if (node.icon) change(node, () => { delete node.icon; }); }
    const readAsDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
    // A picture file as a data: address the format takes: an SVG small enough
    // as it is, anything else drawn into a square and saved as PNG, smaller
    // until it fits.
    function iconFromFile(file) {
        return readAsDataUrl(file).then((raw) => {
            if (/^data:image\/svg\+xml;base64,/.test(raw) && asIcon(raw)) return raw;
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    for (const size of ICON_SIZES) {
                        const c = document.createElement('canvas'); c.width = size; c.height = size;
                        const w = img.naturalWidth || size, h = img.naturalHeight || size, k = Math.min(size / w, size / h);
                        c.getContext('2d').drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
                        let out = null;
                        try { out = c.toDataURL('image/png'); } catch (e) { out = null; }
                        if (out && asIcon(out)) { resolve(out); return; }
                    }
                    resolve(null);
                };
                img.onerror = () => resolve(null);
                img.src = raw;
            });
        }).catch(() => null);
    }
    function renderIcon(node) {
        const box = $('ownIconBox');
        if (!box) return;
        const has = !!(node && node.icon);
        const pic = $('ownIconPic');
        if (has) pic.src = node.icon; else pic.removeAttribute('src');
        pic.hidden = !has;
        $('ownIconClear').classList.toggle('hidden', !has);
        $('ownIconPick').textContent = t(has ? 'Change picture…' : 'Choose a picture…');
        $('ownIconPick').onclick = () => $('ownIconFile').click();
        $('ownIconClear').onclick = () => { if (node) clearIcon(node); };
        $('ownIconFile').onchange = (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!f || !node) return;
            iconFromFile(f).then((url) => { if (state.selectedId === node.id) setIcon(node, url); });
        };
    }

    // The selected device's panel (selectNow, js/ui.js); null clears it.
    function renderReach(node) {
        renderButtons(node);
        renderEditor(node);
        renderIcon(node);
    }

    window.TopoReach = { render: renderReach, url: reachUrl, rdpFile: rdpFileText, address: reachAddress, setIcon, clearIcon, iconFromFile, setWays,
        ICON_TOTAL_MAX, programsLink, openInApp, _host, _forget: () => { _host.clients = undefined; _host.asking = null; } };
})();
