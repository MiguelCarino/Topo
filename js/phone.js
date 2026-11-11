// ---- Phone numbers: the country in front ----
// Every phone field (your phone in Settings, the problem report's, a
// provider's) gets a pick of the country in front of it, drawn as a length's
// unit pick is (.unit-field, css/app.css). The number is still the plain text
// it always was ("+52 55 1234 5678"): the pick only writes and reads its
// calling code, so the file, the CSV and the reports are as before.
//   - Picking a country writes its code in front of the number, in place of
//     the one there.
//   - Typing a code ("+52", "0052") picks its country as it is typed.
//   - A number left without a code (a local "55 1234 5678") is given the
//     picked country's when the field is left, its trunk 0 dropped
//     ("020 7946 0000" in the UK is "+44 20 7946 0000"; Italy keeps its 0).
//   - An empty field shows the country last picked in this browser, else the
//     browser's own region, and writes nothing until a number is typed.
// Country names are the browser's (Intl.DisplayNames), in the page's language.

// ISO 3166 code + calling code. A North American number's country is its
// area code ("1809" the Dominican Republic): the longest code that starts
// the number wins.
const PHONE_CODES = ('AF93 AX358 AL355 DZ213 AS1684 AD376 AO244 AI1264 AG1268 AR54 AM374 AW297 AU61 AT43 AZ994 '
    + 'BS1242 BH973 BD880 BB1246 BY375 BE32 BZ501 BJ229 BM1441 BT975 BO591 BQ599 BA387 BW267 BR55 VG1284 BN673 '
    + 'BG359 BF226 BI257 KH855 CM237 CA1 CV238 KY1345 CF236 TD235 CL56 CN86 CO57 KM269 CG242 CD243 CK682 CR506 '
    + 'CI225 HR385 CU53 CW599 CY357 CZ420 DK45 DJ253 DM1767 DO1809 DO1829 DO1849 EC593 EG20 SV503 GQ240 ER291 '
    + 'EE372 SZ268 ET251 FK500 FO298 FJ679 FI358 FR33 GF594 PF689 GA241 GM220 GE995 DE49 GH233 GI350 GR30 GL299 '
    + 'GD1473 GP590 GU1671 GT502 GG44 GN224 GW245 GY592 HT509 HN504 HK852 HU36 IS354 IN91 ID62 IR98 IQ964 IE353 '
    + 'IM44 IL972 IT39 JM1876 JM1658 JP81 JE44 JO962 KZ7 KE254 KI686 XK383 KW965 KG996 LA856 LV371 LB961 LS266 '
    + 'LR231 LY218 LI423 LT370 LU352 MO853 MG261 MW265 MY60 MV960 ML223 MT356 MH692 MQ596 MR222 MU230 YT262 MX52 '
    + 'FM691 MD373 MC377 MN976 ME382 MS1664 MA212 MZ258 MM95 NA264 NR674 NP977 NL31 NC687 NZ64 NI505 NE227 NG234 '
    + 'NU683 KP850 MK389 MP1670 NO47 OM968 PK92 PW680 PS970 PA507 PG675 PY595 PE51 PH63 PL48 PT351 PR1787 PR1939 '
    + 'QA974 RE262 RO40 RU7 RW250 BL590 SH290 KN1869 LC1758 MF590 PM508 VC1784 WS685 SM378 ST239 SA966 SN221 '
    + 'RS381 SC248 SL232 SG65 SX1721 SK421 SI386 SB677 SO252 ZA27 KR82 SS211 ES34 LK94 SD249 SR597 SE46 CH41 '
    + 'SY963 TW886 TJ992 TZ255 TH66 TL670 TG228 TK690 TO676 TT1868 TN216 TR90 TM993 TC1649 TV688 UG256 UA380 '
    + 'AE971 GB44 US1 UY598 UZ998 VU678 VA39 VE58 VN84 VI1340 WF681 YE967 ZM260 ZW263')
    .split(' ').map((x) => ({ cc: x.slice(0, 2), code: x.slice(2) }));
// A code several countries share: whose it is when nothing says otherwise.
const PHONE_SHARED = { 1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 212: 'MA', 262: 'RE', 358: 'FI', 590: 'GP', 599: 'CW' };
// Canada's area codes (the rest of +1 without an own code is the US).
const PHONE_CA_AREAS = new Set(('204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 '
    + '437 438 450 460 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 '
    + '807 819 825 867 873 879 902 905 942').split(' '));
// Where a local number's leading 0 is part of it, not a trunk prefix.
const PHONE_KEEPS_ZERO = new Set(['IT', 'VA', 'SM']);
const PHONE_COUNTRY_KEY = 'nettopo_phone_country';
const phoneCodeOf = (cc) => { const e = PHONE_CODES.find((x) => x.cc === cc); return e ? e.code : ''; };
// "1809" is written "+1 809", as people write it.
const phoneCodeText = (code) => (code.length === 4 && code[0] === '1' ? `+1 ${code.slice(1)}` : `+${code}`);

// The number's international digits ("+52 55…" or "0052 55…" -> "5255…"),
// or null when it has no code.
function phoneIntlDigits(value) {
    const v = String(value || '').trim();
    if (v.startsWith('+')) return v.slice(1).replace(/\D/g, '');
    if (/^00\d/.test(v.replace(/[\s.()-]/g, ''))) return v.replace(/\D/g, '').slice(2);
    return null;
}
// The calling codes that start these digits, the longest first found.
function phoneCodesFor(digits) {
    let best = [];
    PHONE_CODES.forEach((e) => {
        if (!digits.startsWith(e.code)) return;
        if (!best.length || e.code.length > best[0].code.length) best = [e];
        else if (e.code.length === best[0].code.length) best.push(e);
    });
    return best;
}
// The country of a number ('' when it has no code, or one not yet whole).
// prefer: the country picked now, kept when it shares the code.
function phoneCountryOf(value, prefer) {
    const d = phoneIntlDigits(value);
    if (!d) return '';
    const hits = phoneCodesFor(d);
    if (!hits.length) return '';
    if (prefer && hits.some((e) => e.cc === prefer)) return prefer;
    const code = hits[0].code;
    if (code === '1' && PHONE_CA_AREAS.has(d.slice(1, 4))) return 'CA';
    if (code === '7' && /^[67]/.test(d.slice(1))) return 'KZ';
    return PHONE_SHARED[code] || hits[0].cc;
}
// The number with the country's code in front: in place of the code it has,
// or, for a local number, in front of it, the trunk 0 dropped.
function phoneWithCountry(value, cc) {
    const code = phoneCodeOf(cc);
    const v = String(value || '').trim();
    if (!code) return v;
    const d = phoneIntlDigits(v);
    let rest;
    if (d !== null) {
        // Skip the + or 00 and the old code's digits, keep how the rest was written.
        // A North American area code ("1809") is part of the number: only the 1 goes.
        const old = phoneCodesFor(d)[0];
        const oldLen = old ? (old.code[0] === '1' ? 1 : old.code.length) : 0;
        let skip = (v.startsWith('+') ? 0 : 2) + oldLen, i = v.startsWith('+') ? 1 : 0;
        for (; i < v.length && skip > 0; i++) if (/\d/.test(v[i])) skip--;
        rest = v.slice(i);
    } else {
        rest = PHONE_KEEPS_ZERO.has(cc) ? v : v.replace(/^0(?=\d)/, '');
    }
    rest = rest.replace(/^[\s.-]+/, '');
    // To a North American area code: the 1, and the area code unless the number has it.
    const head = code.length === 4 && code[0] === '1' && rest.replace(/\D/g, '').startsWith(code.slice(1)) ? '+1' : phoneCodeText(code);
    return `${head}${rest ? ' ' + rest : ' '}`;
}
// The country an empty field shows: the last picked here, else the browser's region.
function phoneDefaultCountry() {
    let saved = '';
    try { saved = localStorage.getItem(PHONE_COUNTRY_KEY) || ''; } catch (e) { /* storage blocked */ }
    if (phoneCodeOf(saved)) return saved;
    for (const tag of (navigator.languages || [navigator.language])) {
        const m = /-([A-Z]{2})\b/i.exec(String(tag || ''));
        if (m && phoneCodeOf(m[1].toUpperCase())) return m[1].toUpperCase();
    }
    return '';
}
function phoneRemember(cc) {
    try { if (cc) localStorage.setItem(PHONE_COUNTRY_KEY, cc); } catch (e) { /* storage blocked */ }
}

// The page's language (js/i18n.js).
const phoneLang = () => (window.CarinoI18N && window.CarinoI18N.current()) || 'en';
// The options, in the page's language, sorted by name.
let _phoneOptsLang = '', _phoneOpts = '';
function phoneOptionsHtml() {
    const lang = phoneLang();
    if (_phoneOptsLang === lang && _phoneOpts) return _phoneOpts;
    let names = null;
    try { names = new Intl.DisplayNames([lang, 'en'], { type: 'region' }); } catch (e) { /* an old engine: the codes */ }
    const seen = new Set(), rows = [];
    PHONE_CODES.forEach(({ cc, code }) => {
        if (seen.has(cc)) return;   // a country with several codes is listed once, at its first
        seen.add(cc);
        let name = cc;
        try { name = (names && names.of(cc)) || cc; } catch (e) { /* unknown to this engine */ }
        rows.push({ cc, name, code });
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, lang));
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    _phoneOpts = `<option value="">${esc(t('No country'))}</option>`
        + rows.map((r) => `<option value="${r.cc}">${esc(r.name)} (${esc(phoneCodeText(r.code))})</option>`).join('');
    _phoneOptsLang = lang;
    return _phoneOpts;
}

const _phoneValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
// Gives one phone field its country pick. Safe to call again on a field that has one.
function phoneField(input) {
    if (!input || input.closest('.phone-field')) return;
    const box = document.createElement('div');
    box.className = 'unit-field phone-field';
    const pick = document.createElement('label');
    pick.className = 'phone-cc';
    const shown = document.createElement('span');
    shown.className = 'phone-cc-txt';
    const sel = document.createElement('select');
    sel.className = 'phone-pick';
    pick.append(shown, sel);
    input.parentNode.insertBefore(box, input);
    box.append(pick, input);

    let cc = '';
    // The pick shows the country (its ISO code and calling code); an empty
    // field shows the default dimmed, as a hint, not a value.
    const show = () => {
        const code = phoneCodeOf(cc);
        shown.textContent = cc ? `${cc} ${phoneCodeText(code)}` : '+';
        if (sel.options.length) sel.value = cc;
        box.classList.toggle('phone-hint', !phoneIntlDigits(_phoneValue.get.call(input)));
        const label = t('Country code');
        sel.setAttribute('aria-label', label);
        sel.title = label;
    };
    const fill = () => {
        if (_phoneOptsLang !== (phoneLang()) || !sel.options.length) sel.innerHTML = phoneOptionsHtml();
        sel.value = cc;
    };
    // Reads the country from the number; one without a code keeps the
    // country shown (or the default, when the field is empty).
    const sync = () => {
        const v = _phoneValue.get.call(input);
        const found = phoneCountryOf(v, cc);
        if (found) cc = found;
        else if (!phoneIntlDigits(v) && !cc) cc = phoneDefaultCountry();
        show();
    };
    // Written into the field as if typed: its owner saves it on its input event.
    const write = (v) => {
        _phoneValue.set.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    sel.addEventListener('focus', fill);
    sel.addEventListener('pointerdown', fill);
    sel.addEventListener('change', () => {
        cc = sel.value;
        phoneRemember(cc);
        const v = _phoneValue.get.call(input);
        if (cc) write(phoneWithCountry(v, cc));
        else if (phoneIntlDigits(v) !== null) write(v.replace(/^\s*(\+|00)\s*/, '').trim());
        show();
        input.focus();
        try { const n = _phoneValue.get.call(input).length; input.setSelectionRange(n, n); } catch (e) { /* not a text field */ }
    });
    input.addEventListener('input', sync);
    // Left with a local number: it takes the shown country's code.
    input.addEventListener('change', () => {
        const v = _phoneValue.get.call(input);
        if (cc && /\d/.test(v) && phoneIntlDigits(v) === null) { write(phoneWithCountry(v, cc)); show(); }
        if (phoneIntlDigits(v)) phoneRemember(cc);
    });
    // A field filled by its owner (a redraw, the saved settings) shows its country too.
    Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return _phoneValue.get.call(this); },
        set(v) { _phoneValue.set.call(this, v); sync(); }
    });
    sync();
}
// Every phone field under root (data-keys="tel", js/ui.js KEYBOARDS) that has none yet.
function phoneFields(root) {
    (root || document).querySelectorAll('input[data-keys="tel"]').forEach(phoneField);
}
phoneFields(document);
// The labels and the names follow the language.
window.addEventListener('carino:langchange', () => setTimeout(() => {
    _phoneOptsLang = '';
    document.querySelectorAll('.phone-field > input').forEach((i) => { i.value = i.value; });   // redraws its pick
}, 0));
