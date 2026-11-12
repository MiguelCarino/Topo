// Topo to keep on this computer: the landing's download card and the About
// window's line, modelled on dcm.carino.systems' "Have it offline" card.
//
// Offered on the website only, on a computer: the desktop app and the offline
// zip are that download already, a Topo server's page has its own, and a
// phone installs none of them. The card shows at once with a link to the
// latest release; one GET to GitHub's API then turns it into "Download for
// macOS" pointing at the file itself, with every other build listed under it.
// That request is the website's one outside request: no cookies, no Referer
// (the page's referrer policy), nothing of any network in it, and never made
// off topo.carino.systems. Offline, rate-limited or blocked, the card keeps
// its plain link to the releases page.
//
// Asset names are Tauri's: Topo_<v>_aarch64.dmg, Topo_<v>_x64-setup.exe,
// Topo_<v>_amd64.AppImage, Topo_<v>_arm64.deb, Topo-<v>-1.x86_64.rpm, and
// Topo-<v>-offline.zip. Names and URLs come from the network, so they are
// only ever set with textContent and href, never as HTML.

const DOWNLOAD_RELEASES = 'https://github.com/MiguelCarino/Topo/releases/latest';
const DOWNLOAD_API = 'https://api.github.com/repos/MiguelCarino/Topo/releases/latest';

// -> null, or the computer's system ('windows', 'mac', 'linux' or '' when it
// does not say).
function offlineOffer(where) {
    const w = where || {};
    const host = w.host !== undefined ? w.host : location.hostname;
    const ua = String(w.ua !== undefined ? w.ua : navigator.userAgent);
    const desktopApp = w.desktopApp !== undefined ? w.desktopApp : !!window.__TAURI__;
    if (host !== 'topo.carino.systems' || desktopApp) return null;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return null;
    // An iPad asking for the desktop site says Macintosh, with a touch screen.
    const touchMac = w.touch !== undefined ? w.touch : (navigator.maxTouchPoints || 0) > 1;
    if (/Macintosh/.test(ua) && touchMac) return null;
    if (/Windows/.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
    if (/Linux|X11/.test(ua) && !/CrOS/.test(ua)) return 'linux';
    return '';
}

// The systems, in the order the other links list them. `kind` names the
// package for Linux, which ships three; the first kind is the one to offer.
const DOWNLOAD_SYSTEMS = [
    { id: 'mac', name: 'macOS', kinds: [{ id: 'dmg', re: /\.dmg$/i }] },
    { id: 'windows', name: 'Windows', kinds: [{ id: 'exe', re: /-setup\.exe$/i }] },
    { id: 'linux', name: 'Linux', kinds: [
        { id: 'AppImage', re: /\.AppImage$/i },
        { id: '.deb', re: /\.deb$/i },
        { id: '.rpm', re: /\.rpm$/i }] },
];
const DOWNLOAD_ARCHS = [
    { id: 'arm64', re: /(^|[-_.])(arm64|aarch64)($|[-_.])/i },
    { id: 'x64', re: /(^|[-_.])(x64|x86[-_]?64|amd64)($|[-_.])/i },
];
// Machine names stay in English in every language, like the version number.
function downloadArchName(sys, arch) {
    if (!arch) return '';
    if (sys === 'mac') return arch === 'arm64' ? 'Apple silicon' : 'Intel';
    return arch === 'arm64' ? 'Arm64' : 'x64';
}
// The architecture to put first. A Mac gets no guess (Chrome under Rosetta
// says Intel on Apple silicon): Apple silicon leads, as most Macs are now, and
// Intel is the first other link. Windows on Arm runs the x64 installer too, so
// x64 leads there. Linux says its machine in navigator.platform.
function downloadLeadArch(sys, platform) {
    if (sys === 'mac') return 'arm64';
    if (sys === 'linux' && /aarch64|arm64/i.test(platform || '')) return 'arm64';
    return 'x64';
}

// The card's content for a release, as data, so it can be tested without a
// network. -> { version, primary, others } where each link is
// { label, url, size, arch }; primary is null for a system with no build.
function downloadPlan(release, sys, platform) {
    const assets = (release && Array.isArray(release.assets) ? release.assets : [])
        .filter((a) => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string'
            && /^https:\/\/github\.com\//.test(a.browser_download_url));
    const version = String((release && release.tag_name) || '').replace(/^v/, '');
    const archOf = (name) => (DOWNLOAD_ARCHS.find((x) => x.re.test(name)) || {}).id || '';
    const builds = (s) => {
        const lead = downloadLeadArch(s.id, platform);
        const out = [];
        s.kinds.forEach((k, ki) => assets.filter((a) => k.re.test(a.name)).forEach((a) => {
            out.push({ sys: s.id, kind: k.id, ki, arch: archOf(a.name), url: a.browser_download_url, size: a.size }); }));
        // Same order for every system: the first kind, the lead architecture first.
        return out.sort((x, y) => (x.ki - y.ki) || ((x.arch === lead ? 0 : 1) - (y.arch === lead ? 0 : 1)));
    };
    const label = (b, withSystem) => {
        const parts = [];
        if (withSystem) parts.push(DOWNLOAD_SYSTEMS.find((s) => s.id === b.sys).name);
        if (b.sys === 'linux') parts.push(b.kind);
        const an = downloadArchName(b.sys, b.arch);
        if (an) parts.push(an);
        return parts.join(' ');
    };
    const link = (b, withSystem) => ({ label: label(b, withSystem), url: b.url, size: b.size, arch: b.arch, sys: b.sys });

    const mine = DOWNLOAD_SYSTEMS.find((s) => s.id === sys) || null;
    const own = mine ? builds(mine) : [];
    const primary = own.length ? link(own[0], false) : null;
    const others = own.slice(1).map((b) => link(b, true));
    DOWNLOAD_SYSTEMS.filter((s) => s !== mine).forEach((s) => builds(s).forEach((b) => others.push(link(b, true))));
    const zip = assets.find((a) => /-offline\.zip$/i.test(a.name));
    if (zip) others.push({ label: 'zip', url: zip.browser_download_url, size: zip.size, arch: '', sys: 'zip' });
    return { version, primary, others };
}

const downloadMB = (n) => Math.max(1, Math.round(Number(n) / 1048576)) + ' MB';
const DOWNLOAD_SYSTEM_NAMES = { mac: 'macOS', windows: 'Windows', linux: 'Linux' };

let _downloadRelease = null;     // the latest release, once GitHub answered
let _downloadAsked = false;

// Fills the card for the computer's system; with no release yet it is the
// plain link to the releases page.
function renderDownloadCard(sys, platform) {
    const card = document.getElementById('landingGet');
    const primary = document.getElementById('landingGetLink');
    const meta = document.getElementById('landingGetMeta');
    const others = document.getElementById('landingGetOthers');
    if (!card || !primary || !meta || !others) return;
    const plan = _downloadRelease ? downloadPlan(_downloadRelease, sys, platform) : null;
    others.textContent = '';
    if (!plan || !plan.primary) {
        primary.textContent = t('⤓ Get Topo for this computer');
        primary.href = DOWNLOAD_RELEASES;
        meta.textContent = plan && plan.version ? plan.version : '';
    } else {
        primary.textContent = t('⤓ Download for {os}', { os: DOWNLOAD_SYSTEM_NAMES[sys] });
        primary.href = plan.primary.url;
        // The architecture is named so a reader on the other one looks below.
        meta.textContent = [plan.version, plan.primary.label, downloadMB(plan.primary.size)].filter(Boolean).join(' · ');
    }
    if (plan) {
        plan.others.forEach((o) => {
            const a = document.createElement('a');
            a.textContent = o.sys === 'zip' ? t('Offline folder (.zip)') : o.label;
            a.href = o.url;
            a.title = a.textContent + ' · ' + downloadMB(o.size);
            others.appendChild(a);
        });
    }
    const all = document.createElement('a');
    all.textContent = t('All downloads');
    all.href = DOWNLOAD_RELEASES; all.target = '_blank'; all.rel = 'noopener';
    others.appendChild(all);
}

// Shows or hides the offer; run at start and with each language.
function renderOfflineOffer(where) {
    const os = offlineOffer(where);
    const card = document.getElementById('landingGet');
    const about = document.getElementById('aboutOffline');
    const github = document.getElementById('aboutGithub');
    if (card) card.hidden = os === null;
    if (about) about.hidden = os === null;
    if (github) github.hidden = os === null;
    if (os === null) return os;
    const platform = (where && where.platform !== undefined) ? where.platform : (navigator.platform || '');
    renderDownloadCard(os, platform);
    // Asked once, and only for the real page: a test passes its own `where`.
    if (!where && !_downloadAsked && typeof fetch === 'function') {
        _downloadAsked = true;
        fetch(DOWNLOAD_API, { credentials: 'omit', referrerPolicy: 'no-referrer',
            headers: { Accept: 'application/vnd.github+json' } })
            .then((r) => (r.ok ? r.json() : null))
            .then((rel) => {
                if (!rel || !rel.tag_name) return;
                _downloadRelease = rel;
                renderDownloadCard(os, platform);
            })
            .catch(() => { /* offline, rate-limited, blocked: the plain link stays */ });
    }
    return os;
}
renderOfflineOffer();
window.addEventListener('carino:langchange', () => setTimeout(() => {
    const os = offlineOffer();
    if (os !== null) renderDownloadCard(os, navigator.platform || '');
}, 0));
