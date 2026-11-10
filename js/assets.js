// ---- Assets: the register's own facts (plan section 4) ----
// Topo started as a drawing of addresses. A register also has to say what each
// box IS and where it is: the model, its serial, the asset tag on its sticker,
// the room or rack, whether it is in service. This file holds the parts of that
// which are not the schema itself (NODE_FIELDS / CABLE_FIELDS, js/model.js):
//
//   Asset group   the device's fields in the side panel, folded into one
//                 collapsible group (its open state remembered here) and hidden
//                 in the reduced views (data-adv). Firmware / OS is the old
//                 OS field, relabelled; it stays English with the rest of the
//                 technical labels, while the plain words (Vendor, Model,
//                 Serial number…) are translated.
//   Status        planned / active / retired. A retired device is kept for the
//                 record and dimmed on the map, and the reachability walk
//                 neither reaches it nor goes through it (js/diagnostics.js).
//   Cable facts   link.cable { label, length, color, via } in the cable's panel,
//                 its label drawn on the map (js/ui.js).
//   Notes lint    a pre-share check: notes that look like they hold a password
//                 are named in the share and report dialogs, and under the
//                 field as it is typed. A separate "credential reference" field
//                 was cut from the plan in favour of this: one field fewer, and
//                 the place people actually type passwords is the notes.
//   #asset/<tag>  the route a printed QR label points at. It finds the device
//                 by its tag in this browser's library, opens that network and
//                 selects it. When nothing matches it says only that: the
//                 message names no network, so a label scanned on someone
//                 else's machine learns nothing about what that machine holds.
//   Print labels  a sheet of labels for the selection: a device's tag with its
//                 QR code, a cable's label (twice: one for each end). The QR
//                 code is drawn here by the vendored encoder
//                 (vendor/qrcode-generator-1.4.4.min.js); nothing is fetched.
//
// Load order: ... bulk -> add -> csv -> assets -> app

// ---- Status ----
const STATUS_NAMES = { planned: 'Planned', active: 'Active', retired: 'Retired' };
const statusName = (v) => (STATUS_NAMES[v] ? t(STATUS_NAMES[v]) : '');

// ---- The notes lint ----
// Two kinds of thing are flagged, and neither is ever repeated back: the
// dialogs say which device, not what the secret is.
//   * a secret word followed by a value: "password: hunter2", "pwd=…",
//     "PSK Hunter2!", "clave: …", "senha …", "пароль …", "パスワード：…"
//   * a long token mixing letters, digits and symbols, the shape of a key or a
//     generated password, which a person does not type for any other reason.
// An address, a MAC, a URL, a path or a plain word is not a token. False
// positives cost one look; a missed password costs the network.
// A secret word, then either a separator and any value ("password: x",
// "pwd=x") or a space and a value with a digit or symbol in it ("PSK
// Hunter2!", "pw Summer2024"): "pass through to the core" and "token ring"
// are not passwords. A word such as "key" or "code" may sit between ("WPA2
// key is Hunter2024"). Latin and Cyrillic words need a boundary before them;
// Japanese has no spaces, so its words match inside a longer one.
// PIN is apart: cabling notes say "pin 1-2" and "PoE on pin 4/5", so only a
// PIN that is four or more digits on their own counts ("PIN 4821").
const SECRET_WORDS = 'pass(?:word|wd|phrase)?|pwd|pw|passwd|secret|token|api[ _-]?key|psk|wpa[23]?|contrase(?:ñ|n)a|clave|senha|пароль';
const SECRET_WORDS_CJK = 'パスワード|暗証番号';
const SECRET_QUALIFIER = '(?:\\s+(?:key|code|clave|código|codigo|chave|ключ|код))?';
const SECRET_VALUE = '(?:\\s*[:=：]\\s*\\S{2,}|\\s+(?:(?:is|es|é|=)\\s+)?(?=\\S*[^\\p{L}\\s])\\S{3,})';
const SECRET_LABELLED = new RegExp(`(?:(?:^|[^\\p{L}\\p{N}])(?:${SECRET_WORDS})${SECRET_QUALIFIER}|(?:${SECRET_WORDS_CJK}))${SECRET_VALUE}`, 'iu');
const SECRET_PIN = /(?:^|[^\p{L}\p{N}])(?:pin|nip)(?:\s+(?:code|código|codigo|код))?\s*[:=：]?\s*\d{4,}(?![\p{L}\p{N}/-])/iu;
// A login written as a pair: "admin / Summer2024!", "root: Tr0ub4dor". The
// second half needs a digit or a symbol, so "admin/root" and "user: reception"
// are left alone.
const SECRET_PAIR = /(?:^|[^\p{L}\p{N}])(?:admin(?:istrator)?|root|user(?:name)?|usuario|usuário|login)\s*[/:]\s*(?=\S*[^\p{L}\s])\S{4,}/iu;
// The shape of a generated password or a key: ten or more characters with
// all four kinds (lower, upper, digit, a symbol other than the - _ . that
// host names use), or a long run of letters and digits with no dot in it
// (an API key such as sk_live_4eC3…). A host name, an address, a MAC, a URL
// or a path is none of these. Brackets, quotes and commas around a word are
// the sentence's, not the word's; so is a full stop or colon after a MAC
// ("the new NIC is 3c:07:54:AB:CD:EF.").
function looksLikeKey(raw) {
    const word = raw.replace(/^[("'«“\[]+|[)"'»”\],;]+$/g, '');
    if (word.length < 10 || /^[a-z]+:\/\//i.test(word) || /[\\/]/.test(word)) return false;
    if (macShaped(word.replace(/[.:]+$/, '')) || parseValidCIDR(word) || parseIpText(word)) return false;
    const lower = /[a-z]/.test(word), upper = /[A-Z]/.test(word), digit = /[0-9]/.test(word);
    if (lower && upper && digit && /[^A-Za-z0-9._-]/.test(word)) return true;
    return word.length >= 24 && !word.includes('.') && digit && (lower || upper) && [lower, upper, digit].filter(Boolean).length >= 3;
}
function notesSecretHit(text) {
    const s = typeof text === 'string' ? text : '';
    if (!s.trim()) return false;
    if (SECRET_LABELLED.test(s) || SECRET_PIN.test(s) || SECRET_PAIR.test(s)) return true;
    return s.split(/\s+/).some(looksLikeKey);
}
// doc: a serialized document (serializeDoc() output, or a binder site's).
// -> [{ id, name }]: the devices and text notes whose words look secret.
function docSecretHits(doc) {
    const out = [];
    // A custom column's text travels the same way, and is read with its
    // heading in front, so a column called "Password" is caught by its name.
    const cols = new Map(((doc && doc.columns) || []).filter((c) => c && typeof c.name === 'string').map((c) => [c.id, c.name]));
    const customHit = (n) => !!n.extra && typeof n.extra === 'object'
        && Object.keys(n.extra).some((k) => typeof n.extra[k] === 'string' && notesSecretHit(`${cols.get(k) || ''}: ${n.extra[k]}`));
    ((doc && doc.nodes) || []).forEach((n) => {
        if (!n) return;
        const inNotes = notesSecretHit(n.notes), inColumns = customHit(n);
        if (inNotes || inColumns) out.push({ id: n.id, name: asText(n.name) || n.id, kind: 'node', column: inColumns && !inNotes });
    });
    ((doc && doc.annotations) || []).forEach((a) => { if (a && notesSecretHit(a.text)) out.push({ id: a.id, name: t('Text note'), kind: 'annotation' }); });
    // An accepted finding's reason is free text that travels the same way.
    ((doc && doc.accepted) || []).forEach((a, i) => { if (a && notesSecretHit(a.reason)) out.push({ id: `accepted${i}`, name: t('Accepted finding'), kind: 'accepted' }); });
    // And a pin's note: what to check on the next visit.
    ((doc && doc.pinned) || []).forEach((a, i) => { if (a && notesSecretHit(a.note)) out.push({ id: `pinned${i}`, name: t('Pinned finding'), kind: 'accepted' }); });
    // A problem report's words and its close note, and a visit's notes
    // (v18): typed by a client or a technician, and they travel the same way.
    ((doc && doc.incidents) || []).forEach((inc) => {
        if (inc && (notesSecretHit(inc.text) || notesSecretHit(inc.closedNote))) out.push({ id: inc.id, name: t('Problem report'), kind: 'incident' });
    });
    ((doc && doc.log) || []).forEach((e) => { if (e && e.kind === 'visit' && notesSecretHit(e.notes)) out.push({ id: e.id, name: t('Visit notes'), kind: 'visit' }); });
    return out;
}
// The sentence the dialogs show, or '' when there is nothing to say.
function secretLintText(hits) {
    if (!hits.length) return '';
    const names = [...new Set(hits.map((h) => h.name))];
    const list = names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : '');
    // Said as notes while every hit is in notes; a hit in one of the
    // network's own columns would not be found by reading the notes.
    if (hits.some((h) => h.column)) return t('What is written on {names} looks like it holds a password. Whoever gets this can read it: take it out first, or keep it somewhere else.', { names: list });
    return t('The notes on {names} look like they hold a password. Whoever gets this can read it: take it out first, or keep it somewhere else.', { names: list });
}
// Fills one of the dialogs' alert boxes. `select` adds Show them, which
// selects those devices (not the notes: a text note is not in a device set).
function renderSecretLint(el, hits, onShow) {
    if (!el) return;
    const text = secretLintText(hits);
    el.classList.toggle('hidden', !text);
    el.textContent = '';
    if (!text) return;
    const p = document.createElement('span');
    p.textContent = `⚠ ${text}`;
    el.appendChild(p);
    const nodes = hits.filter((h) => h.kind === 'node');
    if (onShow && nodes.length) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'link-btn lint-show';
        b.textContent = t('Show them');
        b.onclick = () => { onShow(); selectEntries(nodes.map((h) => ({ type: 'node', id: h.id }))); if (nodes.length === 1) focusOnMap({ type: 'node', id: nodes[0].id }); };
        el.appendChild(document.createTextNode(' '));
        el.appendChild(b);
    }
}

// What a QR label prints as the model: "vendor model" when either is
// recorded, else the firmware / OS text, which is where the model was written
// before it had a field of its own (document v16).
function assetLabelModel(n) {
    const made = [asText(n.vendor).trim(), asText(n.model).trim()].filter(Boolean).join(' ');
    return made || asText(n.os).trim();
}

// ---- Split model and firmware (docs/BACKLOG.md inventory stage 2) ----
// Before document v16 a device's model and its firmware shared one field, so
// an older file's os can hold "C9200L-24P / IOS-XE 17.9.4" or "HP LaserJet
// M404dn". The upgrade leaves that text where it was (the v7 precedent: a
// pure step cannot tell a model from firmware for certain, and every stored
// baseline would show it as a change); this offers the split instead, as a
// review the user ticks, applied as one undo step. Nothing is ever split by
// itself, and nothing typed is lost: vendor + model + os always hold the
// original words, less the one separator between model and firmware.
//
// Firmware or OS words: the first word of a text that names a system.
const FW_WORDS = new Set(['ios', 'ios-xe', 'nx-os', 'junos', 'routeros', 'switchos', 'fortios', 'arubaos', 'edgeos', 'unifi',
    'openwrt', 'pfsense', 'opnsense', 'dsm', 'qts', 'esxi', 'windows', 'ubuntu', 'debian', 'rhel', 'macos', 'android',
    'linux', 'freertos', 'firmware', 'fw']);
// Vendor words: the makers js/oui.js names (in their usual short form, its
// NIC-chip and virtual entries aside) and the ones a register commonly holds.
// Matched case aside as the first word(s) of the text, and moved as typed.
const VENDOR_WORDS = ['Apple', 'Samsung', 'Intel', 'Dell', 'HP', 'HPE', 'Cisco', 'TP-Link', 'Huawei', 'Xiaomi', 'Google', 'Amazon',
    'Microsoft', 'Raspberry Pi', 'Netgear', 'ASUS', 'Lenovo', 'LG', 'Sony', 'MSI', 'Gigabyte', 'Acer', 'NVIDIA', 'Ubiquiti',
    'MikroTik', 'D-Link', 'Nintendo', 'Aruba', 'Juniper', 'Fortinet', 'Synology', 'QNAP', 'Hikvision', 'Dahua', 'Axis', 'Brother',
    'Canon', 'Epson', 'Lexmark', 'Xerox', 'Siemens', 'Philips', 'GE', 'Supermicro', 'APC', 'Eaton', 'Yealink', 'Polycom', 'Grandstream']
    .sort((a, b) => b.length - a.length);
// Between model and firmware: spaced, so "IOS-XE", "Gi1/0" and "1.2,3" never split.
const SPLIT_SEPARATORS = [' / ', ' · ', ' | ', ' ; ', ', '];
const VERSION_ALONE = /^v?\d+(?:\.\d+)+$/i;
const HAS_VERSION = /\bv?\d+(?:\.\d+)+\b/i;
let _fwSeeds = null;   // the type seeds' os ("Windows 11", "pfSense", "Firmware"), lowercased
const fwSeeds = () => _fwSeeds || (_fwSeeds = new Set(Object.values(initialDataDefaults).map((d) => asText(d && d.os).trim().toLowerCase()).filter(Boolean)));

// A leading vendor word, as typed, and the rest. -> { vendor, rest } or null.
function leadingVendor(text) {
    const s = text.trim(), low = s.toLowerCase();
    for (const w of VENDOR_WORDS) {
        const n = w.length;
        if (!low.startsWith(w.toLowerCase()) || !(s.length === n || /\s/.test(s[n]))) continue;
        const rest = s.slice(n).trim();
        // "HP / LaserJet": the maker is not followed by its model, so a
        // proposed model never starts with a separator.
        return /^[\/·|;,]/.test(rest) ? null : { vendor: s.slice(0, n), rest };
    }
    return null;
}
// What may follow a system's name in firmware text: a version or build
// ("17.9.4", "v7", "2019", "22.04") or an edition word ("Server", "LTS").
const FW_EDITION_WORDS = new Set(['server', 'pro', 'home', 'enterprise', 'lts', 'xe', 'os', 'standard', 'essentials',
    'datacenter', 'education', 'build', 'release', 'stable', 'version', 'ver', 'rev']);
const FW_TAIL_TOKEN = /^(?:v|ver\.?|r)?\d[\w.()-]*$/i;
const fwToken = (w) => w.replace(/^[(\[]+|[)\],:;]+$/g, '').toLowerCase();
// The whole text is firmware or OS: a version alone, a type seed, or a
// system's name (after a vendor: "Synology DSM 7.2") followed only by
// versions and edition words. A product line named like a system ("UniFi
// Switch 24 PoE") is not firmware: only its first word is.
function looksFirmware(text) {
    const s = text.trim();
    if (!s) return false;
    if (VERSION_ALONE.test(s) || fwSeeds().has(s.toLowerCase())) return true;
    const v = leadingVendor(s);
    const words = (v ? v.rest : s).split(/\s+/).map(fwToken).filter(Boolean);
    if (!words.length || !FW_WORDS.has(words[0])) return false;
    return words.slice(1).every((w) => FW_WORDS.has(w) || FW_EDITION_WORDS.has(w) || FW_TAIL_TOKEN.test(w));
}
// Any firmware in a text with no separator: a version token, a system's
// word anywhere ("Cisco C9200L IOS-XE"), or a type seed at its end ("Dell
// OptiPlex 7090 Windows 11").
function hasFirmwarePart(text) {
    if (HAS_VERSION.test(text)) return true;
    const words = text.trim().split(/\s+/).map(fwToken).filter(Boolean);
    if (words.some((w) => FW_WORDS.has(w))) return true;
    for (let i = 0; i < words.length; i++) if (fwSeeds().has(words.slice(i).join(' '))) return true;
    return false;
}
const firmwareLike = (text) => looksFirmware(text) || HAS_VERSION.test(text);
// The text cut at its one separator, or null for none or several.
function splitOnce(text) {
    let at = null, count = 0;
    SPLIT_SEPARATORS.forEach((sep) => {
        let i = text.indexOf(sep);
        while (i >= 0) { count++; at = { i, n: sep.length }; i = text.indexOf(sep, i + sep.length); }
    });
    return count === 1 ? [text.slice(0, at.i).trim(), text.slice(at.i + at.n).trim()] : null;
}

// Pure: what the split would do to each device whose os holds text and whose
// vendor and model are blank.
//   kept: the text is firmware or OS already ("RouterOS 7.14", "Windows 11");
//   rows: { nodeId, kind: 'split', vendor, model, os } where one separator
//         has a model on its left and firmware on its right, or
//         { nodeId, kind: 'model', vendor, model, os: '' } where the text is a
//         known maker's model with no firmware and no separator in it
//         ("HP LaserJet M404dn");
//         a leading maker's word goes to vendor in both ('' when none);
//   left: anything else, left as it is ("my old box").
// -> { rows, kept: [nodeId], left: [nodeId] }
function planModelSplit(nodes = state.nodes) {
    const rows = [], kept = [], left = [];
    (nodes || []).forEach((n) => {
        if (!n || isBlank(n.os) || !isBlank(n.model) || !isBlank(n.vendor)) return;
        const s = n.os.trim();
        if (looksFirmware(s)) { kept.push(n.id); return; }
        const parts = splitOnce(s);
        if (parts) {
            const [l, r] = parts;
            if (l && r && firmwareLike(r) && !firmwareLike(l)) {
                const v = leadingVendor(l);
                rows.push({ nodeId: n.id, kind: 'split', vendor: v ? v.vendor : '', model: v ? v.rest : l, os: r });
                return;
            }
        }
        // Model-only: a maker's model with no firmware in it and no separator
        // at all. Text after a separator ("HP LaserJet M404dn, Floor 2") is a
        // note Topo cannot place, so one, two or more separators that did not
        // split are all left as they are.
        if (!SPLIT_SEPARATORS.some((sep) => s.includes(sep)) && !hasFirmwarePart(s)) {
            const v = leadingVendor(s);
            if (v && v.rest) { rows.push({ nodeId: n.id, kind: 'model', vendor: v.vendor, model: v.rest, os: '' }); return; }
        }
        left.push(n.id);
    });
    return { rows, kept, left };
}
const modelSplitRowFor = (nodeId) => planModelSplit().rows.find((r) => r.nodeId === nodeId) || null;
const sameSplitRow = (a, b) => !!a && !!b && a.nodeId === b.nodeId && a.vendor === b.vendor && a.model === b.model && a.os === b.os;

// What a row proposes, in words: "Vendor: Cisco · Model: C9200L · Firmware / OS: 17.9".
function modelSplitDetail(row) {
    return [row.vendor ? t('Vendor') + ': ' + row.vendor : '', row.model ? t('Model') + ': ' + row.model : '',
        t('Firmware / OS') + ': ' + (row.os || '—')].filter(Boolean).join(' · ');
}

// Writes the rows given, each only if the device still plans exactly that
// row (the question was open; a stale plan is never what is written), in one
// undo step. -> the rows written.
function applyModelSplit(rows) {
    if (readOnlyRefuses()) return [];
    const now = planModelSplit().rows;
    const go = (rows || []).filter((r) => now.some((x) => sameSplitRow(x, r)));
    if (!go.length) return [];
    batch(() => {
        go.forEach((r) => {
            const n = getNode(r.nodeId);
            if (!n) return;
            if (r.vendor) n.vendor = r.vendor; else delete n.vendor;
            if (r.model) n.model = r.model; else delete n.model;
            n.os = r.os;   // still written when empty, as os always was
        });
        save(); renderCanvasOnly();
    });
    const sel = selectedNodeForEdit();
    if (sel) { assetEl('propOs').value = sel.os || ''; renderAssetFields(sel); }   // the panel shows what was written
    if (typeof tableShown === 'function' && tableShown()) renderTableView(true);
    return go;
}

const MODEL_SPLIT_LEFT_MAX = 10;
// The review: one tick per device that would change (all ticked), the ones
// left as they are named under it. Applies what stays ticked in one step.
// -> the rows written, or null when dismissed or there was nothing to split.
async function reviewModelSplit() {
    if (readOnlyRefuses()) return null;
    const plan = planModelSplit();
    if (!plan.rows.length) return null;
    const nameOf = (id) => { const n = getNode(id); return n ? (asText(n.name).trim() || id) : id; };
    const leftNames = plan.left.slice(0, MODEL_SPLIT_LEFT_MAX).map(nameOf);
    if (plan.left.length > MODEL_SPLIT_LEFT_MAX) leftNames.push(t('…and {n} more.', { n: plan.left.length - MODEL_SPLIT_LEFT_MAX }));
    const after = [plan.left.length ? t('Left as it is') + ': ' + leftNames.join(', ') : '',
        t('Nothing typed is lost: the words only move between the fields. One Undo takes all of it back.')].filter(Boolean).join('\n');
    const n = plan.rows.length;
    const ids = await askTicks(n === 1 ? t('Split model and firmware for one device?') : t('Split model and firmware for {n} devices?', { n }), {
        title: t('Split model and firmware'), ok: t('Apply split'), after,
        rows: plan.rows.map((r) => ({ id: r.nodeId, label: nameOf(r.nodeId), detail: '“' + getNode(r.nodeId).os.trim() + '” → ' + modelSplitDetail(r) }))
    });
    if (!ids || !ids.length) return null;
    const done = applyModelSplit(plan.rows.filter((r) => ids.includes(r.nodeId)));
    if (!done.length) showToast(t('Nothing was split: those devices changed while the question was open.'));
    else showToast(done.length === 1 ? t('Model and firmware split on one device.') : t('Model and firmware split on {n} devices.', { n: done.length }), 'ok');
    return done;
}

// The device editor's one-line offer. os: the field's text when it is ahead
// of the node (the keystroke's own listener, js/app.js, runs after this one).
function renderModelSplitNote(node, os) {
    const note = document.getElementById('modelSplitNote');
    if (!note) return;
    const probe = node && os !== undefined ? { ...node, os } : node;
    const row = probe && !state.readOnly ? (planModelSplit([probe]).rows[0] || null) : null;
    note.classList.toggle('hidden', !row);
    document.getElementById('modelSplitBtn').title = row ? modelSplitDetail(row) : '';
}

// ---- Vendor from the MAC (docs/BACKLOG.md inventory stage 3) ----
// A device's interfaces' MACs name who made the network card (js/oui.js,
// the curated table shared with hardware.carino.systems, about 35 makers:
// computers, phones and network gear, few printers or cameras). That is
// often who made the box, so a blank Vendor is offered it, as a hint in the
// field and in the table, and only ever written when the user presses Use
// (or Change all's "Fill vendor from MAC", which previews first). Stored
// nowhere: it is read from the MACs each time.
//
// Not offered from a randomised (locally administered) or group address,
// from a NIC-chip maker (the chip is not the box: an Intel NIC sits in a
// Dell), from a virtual machine's prefix, or when the MACs left disagree.
const OUI_CHIP_ONLY = new Set(['Intel Corporate', 'Realtek', 'Espressif (ESP8266/32)']);
const OUI_VENDOR_DISPLAY = { 'ASUSTek': 'ASUS', 'MSI (Micro-Star)': 'MSI' };
// One prefix block is both companies: servers and network gear are HPE's.
const HPE_TYPES = new Set(['server', 'switch', 'l3switch', 'ap', 'firewall']);
function ouiVendorShown(name, node) {
    if (name === 'HP / HPE') return node && HPE_TYPES.has(node.type) ? 'HPE' : 'HP';
    return OUI_VENDOR_DISPLAY[name] || name;
}
// Pure. -> { vendor, from: [interface names] }, or { why } with why one of
// 'none' (no MAC recorded), 'random' (randomised or group addresses only),
// 'chip', 'virtual', 'unknown' (a maker the table does not hold) or
// 'disagree' (the usable MACs name different makers). It does not look at
// node.vendor: the callers offer it only while that is blank.
function macVendorRead(node) {
    const ifaces = ((node && node.interfaces) || []).filter((i) => hasMac(i));
    if (!ifaces.length) return { why: 'none' };
    const seen = new Set(), found = new Map();
    ifaces.forEach((i) => {
        const v = (window.CarinoOUI ? CarinoOUI.decodeMac(i.mac) : { vendor: {} }).vendor || {};
        // A virtual prefix first: QEMU/KVM (52:54:00) and Docker (02:42) set
        // the local bit, and they are a VM's, not randomised.
        if (v.kind === 'oui' && /\(virtual\)$/.test(v.vendor || '')) { seen.add('virtual'); return; }
        if (macIsGroup(i.mac) || macIsLocal(i.mac)) { seen.add('random'); return; }
        if (v.kind !== 'oui' || !v.vendor) { seen.add('unknown'); return; }
        if (OUI_CHIP_ONLY.has(v.vendor)) { seen.add('chip'); return; }
        const name = ouiVendorShown(v.vendor, node);
        if (!found.has(name)) found.set(name, []);
        found.get(name).push(asText(i.name).trim() || i.id);
    });
    if (found.size > 1) return { why: 'disagree' };
    if (found.size === 1) { const [vendor, from] = [...found][0]; return { vendor, from }; }
    return { why: ['chip', 'virtual', 'unknown', 'random'].find((w) => seen.has(w)) };
}
// -> { vendor, from } or null.
function macVendorSuggestion(node) {
    const r = macVendorRead(node);
    return r.vendor ? r : null;
}
// What the device editor and the table offer: the suggestion, only while
// the device has no vendor of its own.
const vendorHintFor = (node) => (node && isBlank(node.vendor) ? macVendorSuggestion(node) : null);
const VENDOR_HINT_TITLE = "Suggested from the network card's MAC address. Not saved until you use it or type a vendor.";
const MAC_VENDOR_WHY = {
    none: 'No MAC address is recorded.',
    random: 'Its MAC is randomised or a group address, so it names no maker.',
    chip: "Its MAC names the network chip's maker, not the device's.",
    virtual: "Its MAC is a virtual machine's, so it names no maker.",
    unknown: "Its MAC's maker is not in the built-in list (about 35 makers, few printers, cameras or phones).",
    disagree: 'Its MACs name different makers.'
};
const macVendorWhy = (why) => t(MAC_VENDOR_WHY[why] || MAC_VENDOR_WHY.none);

// The Vendor field's grey text and its Use button.
function renderVendorHint(node) {
    const input = document.getElementById('propVendor'), btn = document.getElementById('vendorUseBtn');
    if (!input || !btn) return;
    const s = vendorHintFor(node);
    input.placeholder = s ? t('{value} · from the MAC', { value: s.vendor }) : '';
    input.title = s ? t(VENDOR_HINT_TITLE) : '';
    const use = !!s && !state.readOnly;
    btn.classList.toggle('hidden', !use);
    btn.title = use ? t(VENDOR_HINT_TITLE) : '';
}
// Use: the suggestion written as the device's vendor, one undo step.
// -> the vendor written, or null.
function useVendorHint(node) {
    if (!node || readOnlyRefuses()) return null;
    const s = vendorHintFor(node);
    if (!s) return null;
    batch(() => {
        node.vendor = s.vendor;
        save(); renderCanvasOnly();
    });
    if (selectedNodeForEdit() === node) renderAssetFields(node);
    if (typeof tableShown === 'function' && tableShown()) renderTableView(true);
    return s.vendor;
}

// ---- The Asset group in the side panel ----
const assetEl = (id) => document.getElementById(id);
const ASSET_INPUTS = [
    { key: 'vendor', id: 'propVendor' },
    { key: 'model', id: 'propModel' },
    { key: 'serial', id: 'propSerial' },
    { key: 'assetTag', id: 'propAssetTag' },
    { key: 'location', id: 'propLocation' }
];
// What the closed group still says: the tag and the status, so folding it
// away hides the fields but not the fact that the box is retired.
function assetSummaryText(node) {
    if (!node) return '';
    return [isBlank(node.assetTag) ? '' : node.assetTag.trim(), statusName(node.status)].filter(Boolean).join(' · ');
}
function renderAssetFields(node) {
    ASSET_INPUTS.forEach(({ key, id }) => { assetEl(id).value = node && typeof node[key] === 'string' ? node[key] : ''; });
    updateModelDatalist(node && node.vendor);
    renderModelSplitNote(node);
    renderVendorHint(node);
    assetEl('propStatus').value = node && asStatus(node.status) ? node.status : '';
    assetEl('statusNote').classList.toggle('hidden', !isRetired(node));
    renderUpkeepFields(node);
    assetEl('assetSummary').textContent = assetSummaryText(node);
    renderNotesLint(node);
    renderGroupPicker(node);   // the group it sits in, and its place in a rack (js/groups.js)
    renderHostPicker(node);    // what a VM runs on, and what runs on a host (js/hosts.js)
    renderNodeProviderPicker(node);   // who is responsible for it (js/providers.js)
}
// text: what the field holds now, which is ahead of node.notes while the
// keystroke's other listener (js/app.js) has yet to run.
function renderNotesLint(node, text) {
    const el = assetEl('notesLint');
    const hit = !!node && notesSecretHit(text === undefined ? node.notes : text);
    el.classList.toggle('hidden', !hit);
    el.textContent = hit ? `⚠ ${t('This looks like a password. Notes travel with every link, file and report of this network.')}` : '';
}
// The group's open state: a view preference of this browser, like the alert
// panel's groups (never part of a document).
const ASSET_OPEN_KEY = 'nettopo_asset_open';
function restoreAssetGroup() {
    let open = true;
    try { open = localStorage.getItem(ASSET_OPEN_KEY) !== '0'; } catch (e) { /* storage blocked: open */ }
    assetEl('assetGroup').open = open;
}
assetEl('assetGroup').addEventListener('toggle', () => {
    try { localStorage.setItem(ASSET_OPEN_KEY, assetEl('assetGroup').open ? '1' : '0'); } catch (e) { /* storage blocked */ }
});
restoreAssetGroup();

const selectedNodeForEdit = () => (state.selectedId && state.selectedType === 'node' ? getNode(state.selectedId) : null);
// Typed fields: one undo step per field edit, like the other sidebar fields
// (propertyBindings in js/app.js). A blank one is dropped from the record.
ASSET_INPUTS.forEach(({ key, id }) => {
    assetEl(id).addEventListener('input', (e) => {
        const node = selectedNodeForEdit();
        if (!node) return;
        if (isBlank(e.target.value)) delete node[key]; else node[key] = e.target.value;
        if (key === 'vendor') { updateModelDatalist(node.vendor); renderVendorHint(node); }   // the models this vendor's devices have (js/app.js); the MAC's hint while it is blank
        renderModelSplitNote(node);
        assetEl('assetSummary').textContent = assetSummaryText(node);
        saveTyping();
        renderTyped();
    });
});
assetEl('propOs').addEventListener('input', (e) => renderModelSplitNote(selectedNodeForEdit(), e.target.value));
assetEl('modelSplitBtn').addEventListener('click', () => {
    const node = selectedNodeForEdit();
    const row = node && modelSplitRowFor(node.id);
    if (row) applyModelSplit([row]);
});
assetEl('vendorUseBtn').addEventListener('click', () => useVendorHint(selectedNodeForEdit()));
assetEl('propNotes').addEventListener('input', (e) => renderNotesLint(selectedNodeForEdit(), e.target.value));
assetEl('propStatus').addEventListener('change', (e) => {
    const node = selectedNodeForEdit();
    if (!node) return;
    const v = asStatus(e.target.value);
    if (v) node.status = v; else delete node.status;
    save();
    renderAssetFields(getNode(node.id) || node);   // a read-only document puts it back
    renderCanvasOnly();
    refreshSelectedNodeDiagnostics();
});

// ---- Age and upkeep (js/model.js "Age and upkeep") ----
// Typed as text, read by the field's fromText: a year, a month or a day for
// the dates ("2019", "03/2019", "15/03/2019"), months for the interval ("12",
// "1 year"). What it cannot read is marked and not stored; leaving the field
// shows what is kept, written the one way the file writes it.
const UPKEEP_INPUTS = [
    { key: 'inService', id: 'propInService' },
    { key: 'serviced', id: 'propServiced' },
    { key: 'serviceEvery', id: 'propServiceEvery' },
    { key: 'lifeYears', id: 'propLifeYears' }
];
const upkeepField = (key) => NODE_FIELDS.find((f) => f.key === key);
function markUpkeep(input, bad) {
    input.classList.toggle('bad', bad);
    if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}
// The age and the next service, as of today: one line under the fields.
function upkeepNoteText(node, today = todayISO()) {
    if (!node) return '';
    const age = deviceAge(node, today), next = nextServiceDate(node);
    const st = upkeepState(node, today);
    const s = st.service;
    return [
        age ? t('Age {age}', { age: ageText(age) }) + (st.old ? ' · ' + t('past its expected life') : '') : '',
        next ? t('Next service {date}', { date: next }) + (s && (s.level === 'warn' || s.level === 'bad') ? ' · ' + t('overdue') : '') : ''
    ].filter(Boolean).join(' · ');
}
// The line, in the finding's colour when something is late or old.
function renderUpkeepNote(node) {
    const el = assetEl('upkeepNote');
    const text = upkeepNoteText(node);
    const st = upkeepState(node);
    const level = st.service && st.service.level === 'bad' ? 'bad' : (st.old || (st.service && st.service.level === 'warn')) ? 'warn' : '';
    el.textContent = text;
    el.classList.toggle('hidden', !text);
    el.classList.toggle('upkeep-bad', level === 'bad');
    el.classList.toggle('upkeep-warn', level === 'warn');
}
function renderUpkeepFields(node) {
    UPKEEP_INPUTS.forEach(({ key, id }) => {
        const v = node ? node[key] : undefined;
        assetEl(id).value = v === undefined || v === null ? '' : String(v);
        markUpkeep(assetEl(id), false);
    });
    // Serviced today: for a device that is serviced at all (it has an
    // interval, or a date), not on a read-only network.
    assetEl('servicedTodayBtn').classList.toggle('hidden', !node || state.readOnly || (!asServiceMonths(node.serviceEvery) && !node.serviced));
    // Its type's life in this network, as the hint: blank is that.
    const usual = node ? typeLifeOf(node.type) : null;
    assetEl('propLifeYears').placeholder = usual ? String(usual) : '';
    renderUpkeepNote(node);
}
UPKEEP_INPUTS.forEach(({ key, id }) => {
    assetEl(id).addEventListener('input', (e) => {
        const node = selectedNodeForEdit();
        if (!node) return;
        const blank = isBlank(e.target.value);
        const v = blank ? null : upkeepField(key).fromText(e.target.value);
        markUpkeep(e.target, !blank && v === null);
        if (!blank && v === null) return;
        if (blank) delete node[key]; else node[key] = v;
        saveTyping();
        // The findings, the device's badge and the table's Age and Next
        // service read these too: drawn like any typed field.
        renderTyped();
        renderUpkeepNote(node);
    });
    // A commit (leaving the field, Enter, a picked day) draws at once rather
    // than when the typing's window closes.
    assetEl(id).addEventListener('change', () => {
        flushTypedRender();
        const node = selectedNodeForEdit();
        if (node) renderUpkeepFields(getNode(node.id) || node);
    });
});

// Records the service as done today (servicedToday, js/diagnostics.js).
assetEl('servicedTodayBtn').addEventListener('click', () => {
    const node = selectedNodeForEdit();
    if (!node || !servicedToday(node.id)) return;
    renderUpkeepFields(getNode(node.id));
    showToast(t('Serviced today: recorded, and off the list.'), 'ok');
});

// ---- Expected life by type (doc.expectedLife, js/model.js) ----
// One row per type that has a usual life: how many of them the network has,
// and the years, blank for Topo's usual (shown as the hint). A change is
// kept when the field is left (or Enter), one undo step; what cannot be read
// is marked and not kept.
const lifeEl = (id) => document.getElementById(id);
function renderLifeDialog() {
    const own = state.expectedLife || {};
    const count = new Map();
    state.nodes.forEach((n) => count.set(n.type, (count.get(n.type) || 0) + 1));
    // The types this network has first, then the rest, each in Topo's order.
    const types = Object.keys(EXPECTED_LIFE_YEARS);
    const ordered = types.filter((ty) => count.get(ty)).concat(types.filter((ty) => !count.get(ty)));
    const list = lifeEl('lifeList');
    list.textContent = '';
    ordered.forEach((type) => {
        const li = document.createElement('li');
        li.className = 'life-row';
        const name = document.createElement('label');
        name.textContent = t(typeName(type));
        name.htmlFor = `lifeY-${type}`;
        const n = document.createElement('span');
        n.className = 'life-n';
        n.textContent = count.get(type) ? t('{n} here', { n: count.get(type) }) : '';
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'input mono'; input.id = `lifeY-${type}`;
        // Enter keeps the number (below), so the key says Done.
        setKeyboard(input, 'int', { enter: 'done' }); input.autocomplete = 'off'; input.maxLength = 10;
        input.dataset.type = type;
        input.placeholder = String(EXPECTED_LIFE_YEARS[type]);
        input.value = own[type] ? String(own[type]) : '';
        input.disabled = !!state.readOnly;
        const unit = document.createElement('span');
        unit.className = 'life-unit';
        unit.textContent = t('years');
        li.append(name, n, input, unit);
        list.appendChild(li);
    });
    lifeEl('lifeResetBtn').classList.toggle('hidden', !!state.readOnly);
    lifeEl('lifeResetBtn').disabled = !Object.keys(own).length;
}
// Writes the network's lives (null for none), one undo step, and redraws
// what reads them: the map, the findings, the panel, the table.
function setExpectedLife(next) {
    if (readOnlyRefuses()) return false;
    batch(() => {
        state.expectedLife = normalizeExpectedLife(next);
        save(); renderCanvasOnly();
    });
    const node = selectedNodeForEdit();
    if (node) renderAssetFields(node);
    if (typeof tableShown === 'function' && tableShown()) renderTableView(true);
    refreshSelectedNodeDiagnostics();
    return true;
}
function openLifeDialog() {
    const scrim = lifeEl('lifeDialog');
    if (window.CarinoUI) CarinoUI.modal.open(scrim, {});
    else scrim.hidden = false;
    renderLifeDialog();
}
const refreshLifeDialog = () => { if (!lifeEl('lifeDialog').hidden) renderLifeDialog(); };
function closeLifeDialog() {
    const scrim = lifeEl('lifeDialog');
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
}
assetEl('lifeTypesBtn').addEventListener('click', openLifeDialog);
lifeEl('lifeList').addEventListener('change', (e) => {
    const type = e.target.dataset && e.target.dataset.type;
    if (!type) return;
    const text = e.target.value.trim();
    const years = text ? lifeYearsFromText(text) : null;
    e.target.classList.toggle('bad', !!text && years === null);
    if (text && years === null) return;
    const next = Object.assign({}, state.expectedLife || {});
    // The usual typed in is the usual: no setting, so a later change of
    // Topo's usual still reaches this network.
    if (!years || years === EXPECTED_LIFE_YEARS[type]) delete next[type]; else next[type] = years;
    if (JSON.stringify(normalizeExpectedLife(next)) === JSON.stringify(normalizeExpectedLife(state.expectedLife))) { renderLifeDialog(); return; }
    setExpectedLife(next);
    renderLifeDialog();
});
lifeEl('lifeList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.type) { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); }
});
lifeEl('lifeResetBtn').addEventListener('click', () => { if (setExpectedLife({})) renderLifeDialog(); });
lifeEl('lifeDialog').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeLifeDialog));

// The calendar beside a date field: the browser's own picker, on a hidden
// date input under the field. It opens on the field's date (a month or a
// year alone on its first day), and what is picked is written into the
// field as if typed, so it is read, stored and undone the same way.
function pickerStart(text) {
    const d = looseDateFromText(text);
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return [y, m || '01', day || '01'].join('-');
}
document.querySelectorAll('.date-pick-btn').forEach((btn) => {
    const field = assetEl(btn.dataset.dateFor);
    const native = btn.parentElement.querySelector('.date-pick-native');
    btn.addEventListener('click', () => {
        if (field.disabled || field.readOnly) return;
        native.value = pickerStart(field.value);
        try { native.showPicker(); } catch (e) { native.focus(); native.click(); }
    });
    native.addEventListener('change', () => {
        if (!native.value) return;
        field.value = native.value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        commitTyping();
    });
});

// ---- A cable's facts ----
const CABLE_INPUTS = [
    { key: 'label', id: 'propCableLabel' },
    { key: 'length', id: 'propCableLength' },
    { key: 'color', id: 'propCableColor' },
    { key: 'via', id: 'propCableVia' }
];
// A wireless or VPN link has no cable: its facts are not shown (the owner's
// decision), though any it holds stay stored, for when it is turned back
// into a cable. A wireless link shows its SSID, band and signal instead
// (renderLinkWifi, js/wifi.js).
function renderCableFields(link) {
    const panel = assetEl('linkCableProps');
    const medium = link ? effectiveMedium(link) : null;
    panel.classList.toggle('hidden', !link || medium === 'wireless' || medium === 'vpn');
    CABLE_INPUTS.forEach(({ key, id }) => { if (key !== 'length') assetEl(id).value = link ? cableOf(link, key) : ''; });
    renderCableLength(link);
}
const selectedLinkForEdit = () => (state.selectedId && state.selectedType === 'link' ? getLink(state.selectedId) : null);
// The length is a number typed beside the pick of its unit, metres unless
// said otherwise (cableLengthFromText, js/model.js): only digits and one
// decimal point or comma can be typed, never the unit. A length an older
// file wrote some other way ("about 3") shows as it is until typed over.
function renderCableLength(link) {
    const s = cableLengthShown(link ? cableOf(link, 'length') : '');
    assetEl('propCableLength').value = s.text;
    assetEl('propCableUnit').value = s.unit;
    markUpkeep(assetEl('propCableLength'), false);
}
// What the field and the pick say, written to the cable: true when stored.
function storeCableLength() {
    const input = assetEl('propCableLength');
    const link = selectedLinkForEdit();
    if (!link) return false;
    const text = input.value;
    const blank = !text.trim();
    const v = blank ? '' : cableLengthFromText(text, assetEl('propCableUnit').value);
    // "2." on the way to "2.5" is not wrong yet, only unfinished.
    markUpkeep(input, !blank && v === null && !/^\d+[.,]$/.test(text));
    if (v === null) return false;
    setCableField(link, 'length', v);
    return true;
}
assetEl('propCableLength').addEventListener('input', (e) => {
    filterLengthInput(e.target);
    if (!storeCableLength()) return;
    saveTyping();
    renderTyped();
});
assetEl('propCableLength').addEventListener('blur', () => renderCableLength(selectedLinkForEdit()));
// Another unit relabels the number already there (8 m becomes 8 ft: the
// number was measured in the unit now picked), or waits for one.
assetEl('propCableUnit').addEventListener('change', () => {
    if (isBlank(assetEl('propCableLength').value) || !storeCableLength()) return;
    save();
    renderCanvasOnly();
    // What was stored, shown: an old "15 metres" with the pick moved to ft
    // is kept as 15 m (the unit it names wins), so the pick goes back to m.
    renderCableLength(selectedLinkForEdit());
});
CABLE_INPUTS.filter(({ key }) => key !== 'length').forEach(({ key, id }) => {
    assetEl(id).addEventListener('input', (e) => {
        const link = state.selectedId && state.selectedType === 'link' ? getLink(state.selectedId) : null;
        if (!link) return;
        setCableField(link, key, e.target.value);
        saveTyping();
        renderTyped();
    });
});

// ---- #asset/<tag> ----
// The tag as the route spells it, or null when the hash is not this route.
// A label printed by Topo encodes the tag (encodeURIComponent); one typed by
// hand may not, and a malformed escape is read as written.
function assetTagOfHash(hash) {
    const m = /^asset\/(.+)$/.exec(hash || '');
    if (!m) return null;
    let tag = m[1];
    try { tag = decodeURIComponent(tag); } catch (e) { /* as written */ }
    tag = tag.trim();
    return tag ? tag : null;
}
const sameTag = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
const nodeWithTag = (nodes, tag) => (Array.isArray(nodes) ? nodes : []).find((n) => n && sameTag(n.assetTag, tag)) || null;

// The device to centre on once boot (or Back/Forward) has drawn and fitted the
// map: load() runs before the fit, which would throw the centring away.
let _arrivalFocus = null;
function applyArrivalFocus() {
    const id = _arrivalFocus;
    _arrivalFocus = null;
    if (id && getNode(id)) focusOnMap({ type: 'node', id });
}

// Called by load() (js/app.js) for '#asset/<tag>'. The tag leaves the address
// bar first, like every other arriving fragment. Order of search: the network
// already on screen (a tag typed over an open network), then the networks kept
// in this browser, newest first. Templates and blocks are not networks.
async function openAssetLink(tag) {
    window.history.replaceState(null, '', cleanUrl());
    if (state.nodes.length && !landingIsOpen()) {
        const here = nodeWithTag(state.nodes, tag);
        if (here) { save(); _arrivalFocus = here.id; select(here.id, 'node'); arrivalLocate(); return true; }
    }
    const cards = libraryNetworks().filter((e) => nodeWithTag(e.doc.nodes, tag));
    let card = cards[0] || null;
    if (cards.length > 1) {
        const pick = await askChoice(t('Asset tag {tag} is on more than one network kept here. Which one?', { tag }),
            { choices: cards.map((c, i) => ({ id: c.id, label: c.name || t('Untitled network'), primary: i === 0 })) });
        card = cards.find((c) => c.id === pick) || null;
        if (!card) { assetLinkFallback(); return false; }
    }
    if (!card) {
        // Says only that it is not here, and never which networks are.
        tell(t('No device with asset tag {tag} is kept in this browser.', { tag }));
        assetLinkFallback();
        return false;
    }
    await openFromLibrary(card.id);
    if (state.libraryId !== card.id) { if (state.nodes.length) save(); return false; }   // declined the replace
    const node = nodeWithTag(state.nodes, tag);
    if (node) { _arrivalFocus = node.id; select(node.id, 'node'); arrivalLocate(); }
    return !!node;
}
// A scanned label answers "where is this plugged in": the Full editor opens
// the device's Locate section (openLocate, js/locate.js); a reduced view
// shows its plain sentence instead (stage 4).
function arrivalLocate() {
    if (typeof openLocate === 'function') openLocate();
}
// Not found, or no choice made: as if the visit had been bare, or, over an
// open network, as if nothing had happened.
function assetLinkFallback() {
    if (state.nodes.length) { save(); return; }
    if (shouldShowLanding()) openLanding(true);
    else replaceDocument(templatesData.house, { origin: 'default' });
}

// ---- Print labels ----
// The address a label's QR code opens: this page, wherever it is served from
// (topo.carino.systems, or an intranet copy such as Offline's
// topo.carino.internal), so a label printed on the intranet opens the intranet.
// From the offline zip or the desktop app, the public site (publicBase,
// js/state.js), since a file:// or tauri:// address opens nowhere else.
const assetLinkFor = (tag) => `${publicBase()}#asset/${encodeURIComponent(tag.trim())}`;

// The QR code as an SVG path, one square per dark module, with the quiet zone
// the standard asks for. Level M: survives a scuffed label.
function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return '';
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), quiet = 4, size = n + quiet * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// What the selection prints: { devices, cables, untagged, unlabelled }
// (devices with a tag; labelled cables, each twice; how many devices had no
// tag and cables no label, and were left out: a label that says only "—"
// identifies nothing, so it is not printed).
function labelsFor(entries) {
    const devices = [], cables = [];
    let untagged = 0, unlabelled = 0;
    entries.forEach((e) => {
        if (e.type === 'node') {
            const n = getNode(e.id);
            if (!n) return;
            if (isBlank(n.assetTag)) { untagged++; return; }
            const ifaces = (n.interfaces || []);
            const ip = (ifaces.find((i) => parseValidCIDR(i.ip)) || {}).ip || '';
            const macIf = ifaces.find((i) => !isBlank(i.mac));
            devices.push({ tag: n.assetTag.trim(), name: n.name || n.id, model: assetLabelModel(n), serial: asText(n.serial).trim(),
                // Where it is, as the report prints it: its group's path (and
                // units) when it is in one, else the free text it was given.
                location: nodePlaceText(n), ip, mac: macIf ? fmtColonSafe(macIf.mac) : '' });
        } else if (e.type === 'link') {
            const l = getLink(e.id), a = l && getNode(l.source), b = l && getNode(l.target);
            if (!a || !b) return;
            if (isBlank(cableOf(l, 'label'))) { unlabelled++; return; }
            cables.push({ label: cableOf(l, 'label').trim(), from: `${a.name || a.id} ${ifaceLabel(a, l.sourceIface)}`.trim(),
                to: `${b.name || b.id} ${ifaceLabel(b, l.targetIface)}`.trim(),
                facts: [cableOf(l, 'length'), cableOf(l, 'color')].map((s) => s.trim()).filter(Boolean).join(' · '), via: cableOf(l, 'via').trim() });
        }
    });
    return { devices, cables, untagged, unlabelled };
}

// A sheet of 62 × 29 mm labels, one per page, which is what a label printer
// (the Offline plan's 62 mm thermal roll) feeds; an office printer prints one
// per page as well, so it says so. Self-contained, like the site report: no
// stylesheet or font is fetched, so it prints the same offline.
function labelsHtml(set) {
    const esc = escapeHtml;
    const device = (d) => `<section class="lbl"><div class="qr">${qrSvg(assetLinkFor(d.tag))}</div><div class="txt">
        <b class="tag">${esc(d.tag)}</b><span class="nm">${esc(d.name)}</span>
        ${[d.ip, d.mac].filter(Boolean).map((v) => `<span class="mono">${esc(v)}</span>`).join('')}
        ${[d.model, d.serial ? `S/N ${d.serial}` : '', d.location].filter(Boolean).length ? `<span class="dim">${esc([d.model, d.serial ? `S/N ${d.serial}` : '', d.location].filter(Boolean).join(' · '))}</span>` : ''}
    </div></section>`;
    const cable = (c) => `<section class="lbl cable"><div class="txt">
        <b class="tag">${esc(c.label)}</b><span class="mono">${esc(c.from)} ↔ ${esc(c.to)}</span>
        ${c.facts ? `<span class="dim">${esc(c.facts)}</span>` : ''}${c.via ? `<span class="mono dim">${esc(c.via)}</span>` : ''}
    </div></section>`;
    const body = set.devices.map(device).join('') + set.cables.map((c) => cable(c) + cable(c)).join('');
    const title = t('Labels');
    return `<!doctype html><html lang="${esc(document.documentElement.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
@page { size: 62mm 29mm; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #000; background: #e5e7eb; }
.toolbar { padding: 10px 16px; font-size: 13px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.toolbar button { font: inherit; padding: 6px 12px; }
.sheet { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 16px; }
.lbl { width: 62mm; height: 29mm; background: #fff; display: flex; gap: 2mm; padding: 1.5mm 2mm; overflow: hidden; break-after: page; page-break-after: always; }
.qr { flex: 0 0 26mm; height: 26mm; } .qr svg { width: 100%; height: 100%; display: block; }
.txt { display: flex; flex-direction: column; min-width: 0; justify-content: center; line-height: 1.15; }
.tag { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 13pt; }
.nm { font-size: 8.5pt; font-weight: 600; }
.mono { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 7pt; overflow-wrap: anywhere; }
.dim { font-size: 6.5pt; color: #333; }
.cable .txt { width: 100%; }
@media print { body { background: #fff; } .toolbar { display: none; } .sheet { display: block; padding: 0; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">${esc(t('Print'))}</button><span>${esc(t('Sized for 62 × 29 mm labels, one per page. A cable gets two: one for each end.'))}</span></div>
<div class="sheet">${body}</div></body></html>`;
}

// From the selection, or one device or cable. -> what was printed.
function printAssetLabels(entries = [...state.selection]) {
    const set = labelsFor(entries);
    if (!set.devices.length && !set.cables.length) {
        showToast(set.untagged ? t('Give a device an asset tag first: its label is the tag and its QR code.')
            : set.unlabelled ? t('Give a cable a label first: its label is what is printed.')
                : t('Select devices or cables to print their labels.'));
        return null;
    }
    // Shown first (openSheetPreview, js/sheetpreview.js): its Print or
    // Download hands it over.
    const out = openSheetPreview({ kind: 'labels', meta: { site: docDisplayName(), client: docOrganization(), date: todayISO() }, build: () => labelsHtml(set) });
    const left = [set.untagged ? t('Devices without an asset tag left out: {n}', { n: set.untagged }) : '',
        set.unlabelled ? t('Cables without a label left out: {n}', { n: set.unlabelled }) : ''].filter(Boolean);
    if (left.length) showToast(left.join(' '));
    return Object.assign({ set }, out);
}
assetEl('printLabelsBtn').onclick = () => printAssetLabels();
assetEl('printLabelBtn').onclick = () => printAssetLabels();

// The lint for a dialog: 'doc' (the network on screen, as it would leave in a
// link or a report), 'binder' (every card, as Copy binder link would carry
// them) or 'binder-report' (the networks the binder report prints). A
// network's name prefixes each hit in the binder modes. A read-only network
// (one from a newer build) is linted too: share refuses it, but the report
// still prints its notes, so the report dialog still has to warn.
function secretHitsFor(mode) {
    if (mode === 'doc') return docSecretHits(serializeDoc());
    const sites = mode === 'binder-report' ? libraryNetworks() : binderFile().sites;
    return sites.flatMap((site) => docSecretHits(site.doc)
        .map((h) => Object.assign({}, h, { kind: 'site', name: `${site.name || t('Untitled network')} · ${h.name}` })));
}
