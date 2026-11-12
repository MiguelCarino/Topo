// Sharing: the one way a network leaves this browser as a link.
//
// A fragment is never sent to a server, but it is not private either. The link
// lives on in the chat or mail it was pasted into, in the recipient's history
// and whatever syncs it, and in front of any extension that can read a URL.
// So the share dialog seals by default: the link is AES-GCM ciphertext
// (sealFragment in js/app.js) and the passphrase is meant to travel another way,
// such as a call, a text or a different app. A plain link is still one click
// away, because a colleague on the same desk does not need a ceremony. The
// warning it carries says what that choice means.
//
// Two dialogs: #shareDialog makes a link (a network or the whole binder), and
// #unlockDialog opens an arriving 'e~' one. The unlock dialog runs during boot,
// so it never uses alert() or prompt(), and css/app.css lets it show through
// chrome-pending.

let _shareMode = 'doc';          // 'doc' (Copy link) | 'binder' (Copy binder link)
let _shareBusy = false;
let _shareGen = 0;   // a result is shown only for the choices it was made from
// Notes that look like they hold a password (secretHitsFor, js/assets.js),
// found once when the dialog opens: the passphrase field redraws the dialog
// on every keystroke, and the network cannot change under a modal.
let _shareLintHits = [];
// Share their part (D98): the link carries only what these providers look
// after (partCopy, js/providerpart.js), not the whole network. null: the
// whole network, as always. Set by openShareDialog's opts, each opening.
let _sharePart = null;

const _shareEl = (id) => document.getElementById(id);

// opts.providerIds (mode 'doc'): their part only (Share their part, the
// Providers tab).
function openShareDialog(mode, opts = {}) {
    // A newer Topo's document does not go into a link: the serializer would
    // trim it, and passing it through raw would let hand-edited keys past the
    // allowlist (outgoingDoc in app.js). The build file carries it as it is.
    if (mode !== 'binder' && state.readOnly) {
        showToast(t('A network from a newer version of Topo cannot be shared as a link. Export the build file instead.'));
        return;
    }
    _shareMode = mode === 'binder' ? 'binder' : 'doc';
    _sharePart = null;
    if (_shareMode === 'doc' && Array.isArray(opts.providerIds) && typeof providerPart === 'function') {
        const ids = opts.providerIds.filter((id) => providerById(id));
        const part = ids.length ? providerPart(serializeDoc(), ids, {}) : null;
        if (part && !part.whole) _sharePart = { providerIds: ids, counts: part.counts, lintDoc: canonicalDoc(part.doc) };
    }
    const seal = _shareEl('shareSeal');
    seal.checked = canSeal();
    seal.disabled = !canSeal();
    _shareEl('sharePass').value = canSeal() ? generatePassphrase() : '';
    setPassphraseShown(false);   // masked each time; the visitor reveals or copies it
    // The password lint of the copy as it would leave: their part, canonical.
    _shareLintHits = _sharePart ? secretHitsFor('doc', _sharePart.lintDoc) : secretHitsFor(_shareMode);
    // Off each time: names and phone numbers go only when asked for. Their
    // part carries their own reports always (the rule, D91): no choice.
    _shareEl('shareIncidents').checked = false;
    _shareEl('shareIncidentsRow').classList.toggle('hidden', !!_sharePart || !shareHasIncidents(_shareMode));
    resetShareResult();
    renderShareDialog();
    _shareEl('shareDialog').classList.remove('hidden');
    _shareEl('shareCopyBtn').focus();
}

function closeShareDialog() {
    ++_shareGen;
    _shareEl('shareDialog')?.classList.add('hidden');
}

const shareDialogOpen = () => !_shareEl('shareDialog').classList.contains('hidden');
const shareSealed = () => canSeal() && _shareEl('shareSeal').checked;
const sharePassphrase = () => _shareEl('sharePass').value.trim();

// Everything that depends on the mode, the checkbox or the locale. It is safe to
// call at any time, and applyLocale() calls it while the dialog is open.
function renderShareDialog() {
    const binder = _shareMode === 'binder';
    const sealed = shareSealed();
    const pass = sharePassphrase();
    const part = !binder && _sharePart;
    _shareEl('shareTitle').textContent = binder ? t('Share these networks') : part ? t('Share their part') : t('Share this network');
    _shareEl('shareBlurb').textContent = binder
        ? t('One link carries every saved network. Whoever opens it sees them on a shelf and chooses which to keep.')
        : part ? t(part.providerIds.length === 1 ? 'The link carries only what {name} looks after: {items}, {context}, their reports and visits.'
            : 'The link carries only what {name} look after: {items}, {context}, their reports and visits.',
            { name: partProviderNames(part.providerIds), items: tn(part.counts.items, '1 device of theirs', '{n} devices of theirs'),
                context: tn(part.counts.context, '1 linked device around them', '{n} linked devices around them') })
                + (part.counts.leftOut ? ` (${tn(part.counts.leftOut, '1 device on their ports left out', '{n} devices on their ports left out')})` : '')
            : t('The link carries the whole network: devices, addresses, names and notes.');
    _shareEl('sharePassRow').classList.toggle('hidden', !sealed);
    const hint = _shareEl('shareHint');
    hint.style.color = sealed ? 'var(--text-muted)' : '#f87171';
    if (!canSeal()) hint.textContent = t('This page cannot encrypt (it needs https), so the link can only be plain. Anyone who gets it can read the whole network.');
    else if (!sealed) hint.textContent = `⚠ ${part ? t('Anyone who gets this link can read what it carries. Chats, mail and browser history keep links.')
        : t('Anyone who gets this link can read the whole network. Chats, mail and browser history keep links.')}`;
    else if (pass.length < SEAL_MIN_PASSPHRASE) hint.textContent = t('At least {n} characters. The suggested one is far stronger than anything memorable.', { n: SEAL_MIN_PASSPHRASE });
    else hint.textContent = t('Send the passphrase a different way from the link: a call, a text, another app. The link alone cannot be opened.');
    if (!sealed && (part ? sharePartHasPeople(part) : shareIncludesIncidents())) hint.textContent += ` ${t('The problem reports carry names and phone numbers: lock the link.')}`;
    const copy = _shareEl('shareCopyBtn');
    copy.disabled = _shareBusy || (sealed && pass.length < SEAL_MIN_PASSPHRASE);
    copy.textContent = _shareBusy ? `⏳ ${t('Locking…')}` : sealed ? `🔒 ${t('Copy locked link')}` : `🔗 ${t('Copy plain link')}`;
    renderSecretLint(_shareEl('shareLint'), _shareLintHits, binder ? null : closeShareDialog);
    _shareEl('sharePassCopyBtn').textContent = `🔑 ${t('Copy passphrase')}`;
    const shown = _shareEl('sharePass').type === 'text';
    const eye = _shareEl('sharePassShow');
    eye.textContent = shown ? t('Hide') : t('Show');
    eye.title = shown ? t('Hide the passphrase') : t('Show the passphrase');
}

// The passphrase is masked by default, so it is not read off the screen or a
// screen share; Show reveals it and Copy passphrase copies it either way.
function setPassphraseShown(on) {
    _shareEl('sharePass').type = on ? 'text' : 'password';
    _shareEl('sharePassShow').setAttribute('aria-pressed', on ? 'true' : 'false');
}

// A link that no longer matches what is on screen is worse than none, so any
// change to the choices takes the last result away.
function resetShareResult() {
    ++_shareGen;
    _shareEl('shareResult').classList.add('hidden');
    _shareEl('shareLink').value = '';
    _shareEl('sharePassCopyBtn').classList.add('hidden');
}

// -> the full URL, or null when a binder is too big for one link.
// What goes into the URL is always the serializer's output: the open document
// via serializeDoc() (a read-only one is refused) with its identity added
// (identifiedDoc in js/app.js, so whoever keeps it keeps the same network and
// a later link of it updates their card), each binder site via
// binderLinkFile(), which also leaves out sites from a newer Topo.
// opts.incidents: the problem reports and visits go too (withoutIncidents,
// js/model.js); left out unless asked. opts.max: a network link longer than
// this is null as well (a report sent to its providers goes as a file then,
// js/incidents.js); the share dialog's own network links have no cap.
// opts.doc: the copy to carry instead of the open network, as it leaves
// (partCopy, js/providerpart.js: a provider's part, with its identity).
// opts.tag: a sealed network link's reply tag (D368; "Reply tags" below).
async function buildShareLink(mode, sealed, passphrase, opts = {}) {
    const binder = mode === 'binder';
    if (!binder && state.readOnly) throw new Error('A read-only document is not shared as a link.');
    // Each copy that leaves is stamped with its revision (js/revisions.js),
    // and carries only the newest LOG_LINK_MAX entries of its log.
    // Only a copy that lost entries is chained again (relinkLog); the rest
    // go exactly as they are.
    const relinked = new Set();
    const strip = (doc) => { if (opts.incidents) return doc; const d = withoutIncidents(doc); if (d !== doc) relinked.add(d); return d; };
    const relink = async (doc) => (relinked.has(doc) ? relinkLog(doc) : doc);
    let payload;
    if (binder) {
        payload = stampedBinderLinkFile(strip);
        payload.sites = await Promise.all(payload.sites.map(async (site) => (site && site.doc ? Object.assign({}, site, { doc: await relink(site.doc) }) : site)));
    } else if (opts.doc) payload = opts.doc;   // a provider's part, identified and chained already (js/providerpart.js)
    else payload = withLinkLog(await relink(strip(identifiedDoc(serializeDoc(), 'link'))));
    const json = JSON.stringify(payload);
    const frag = sealed
        ? await sealFragment(json, binder ? SEAL_KIND.binder : SEAL_KIND.doc, passphrase, binder ? null : opts.tag)
        : binder ? await encodeBinderFragment(json) : await encodeShareFragment(json);
    if (binder && frag.length > BINDER_URL_MAX) return null;
    if (!binder && opts.max && frag.length + publicBase().length + publicQuery().length + 1 > opts.max) return null;
    // A network link keeps the query ('?profile=' composes with it), while a
    // binder link never did, because the shelf is not a view of the editor.
    // publicBase()/publicQuery() (js/state.js) are this page's address on the
    // web, and the public site's from a file or the desktop app.
    return `${publicBase()}${binder ? '' : publicQuery()}#${frag}`;
}

// A copy whose log lost entries (withoutIncidents) has the later entries'
// prev taken away; chain them again so the copy verifies (verifyLog -1).
async function relinkLog(doc) {
    if (!doc || !Array.isArray(doc.log) || doc.log.length < 2) return doc;
    if (!window.TopoMerge || !TopoMerge.chainLog) return doc;
    return Object.assign({}, doc, { log: await TopoMerge.chainLog(doc.log) });
}

function stampedBinderLinkFile(strip) {
    const file = binderLinkFile().file;
    file.sites = stampSites(file.sites, 'link');
    if (strip) file.sites = file.sites.map((site) => (site && site.doc ? Object.assign({}, site, { doc: strip(site.doc) }) : site));
    return file;
}
// Whether the network (or, for a binder, any of its networks) holds problem
// reports or visits: only then is "Include problem reports and visits" shown.
function shareHasIncidents(mode) {
    if (mode === 'binder') return binderLinkFile().file.sites.some((site) => docHasIncidentData(site && site.doc));
    return docHasIncidentData(serializeDoc());
}
// Their part always carries their reports (D91): a reporter's name, phone or
// e-mail in one of them asks for the lock as the whole network's does.
const sharePartHasPeople = (part) => (Array.isArray(part && part.lintDoc && part.lintDoc.incidents) ? part.lintDoc.incidents : [])
    .some((i) => i && i.reporter && typeof i.reporter === 'object' && Object.values(i.reporter).some((v) => typeof v === 'string' && v.trim()));
const shareIncludesIncidents = () => { const box = _shareEl('shareIncidents'); return !!box && box.checked && !_shareEl('shareIncidentsRow').classList.contains('hidden'); };

async function copyShareLink() {
    if (_shareBusy) return;
    const sealed = shareSealed(), pass = sharePassphrase();
    if (sealed && pass.length < SEAL_MIN_PASSPHRASE) return;
    if (_shareMode === 'binder') {
        // Said before the link is made, not after: a link that quietly lacks
        // some of the binder is the kind of loss nobody notices until the
        // colleague asks where a building went.
        const { newer } = binderLinkFile();
        if (newer) {
            closeShareDialog();
            if (await askConfirm(t(newer === 1 ? 'One of these networks was made by a newer version of Topo and cannot travel in a link. Export the binder file instead?'
                : '{n} of these networks were made by a newer version of Topo and cannot travel in a link. Export the binder file instead?', { n: newer }), { ok: t('Back up all') })) exportBinder();
            return;
        }
    } else if (state.readOnly) { closeShareDialog(); openShareDialog('doc', _sharePart ? { providerIds: _sharePart.providerIds } : {}); return; }
    // Sealing takes a moment and the dialog stays live meanwhile: a new
    // passphrase, the seal unticked, or the dialog closed and reopened all
    // bump the generation (resetShareResult), and the link made from the old
    // choices is then dropped rather than shown beside the new passphrase.
    const gen = _shareGen;
    _shareBusy = true; renderShareDialog();
    let url;
    try {
        if (_shareMode === 'doc' && _sharePart) {
            // Their part, recorded as a 'part' revision (its base when it
            // comes back, D93).
            const pc = await partCopy(_sharePart.providerIds, {});
            // Sealed, it carries a reply tag like a report's link (D367).
            const tag = sealed ? newReplyTag() : null;
            url = pc ? await buildShareLink('doc', sealed, pass, { doc: pc.doc, tag }) : undefined;
            if (url && tag) {
                rememberReplyTag(tag, { pass, cardId: state.libraryId || null, docId: state.docId || null,
                    to: _sharePart.providerIds.map((p) => providerById(p)).filter(Boolean).map(providerLabel) });
            }
        } else url = await buildShareLink(_shareMode, sealed, pass, { incidents: shareIncludesIncidents() });
    }
    catch (e) { console.warn('Share: could not build the link', e); url = undefined; }
    finally { _shareBusy = false; renderShareDialog(); }
    if (gen !== _shareGen) return;   // the choices changed while it was locking: that link matches nothing on screen

    if (url === null) {
        const n = binderFile().sites.length;
        closeShareDialog();
        if (await askConfirm(t(n === 1 ? 'This network is too much for one link. Export the binder file instead?'
            : 'These {n} networks are too much for one link. Export the binder file instead?', { n }), { ok: t('Back up all') })) exportBinder();
        return;
    }
    const done = _shareEl('shareDone');
    _shareEl('shareResult').classList.remove('hidden');
    if (!url) { done.textContent = t('The link could not be made in this browser.'); return; }
    const box = _shareEl('shareLink');
    box.value = url;
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (e) { /* shown for manual copy below */ }
    if (gen !== _shareGen) return;
    done.textContent = copied
        ? (sealed ? t('Locked link copied. Now send the passphrase separately.') : t('Plain link copied.'))
        : t('Copy the link below.');
    if (!copied) { box.focus(); box.select(); }
    _shareEl('sharePassCopyBtn').classList.toggle('hidden', !sealed);
}

async function copySharePassphrase() {
    const btn = _shareEl('sharePassCopyBtn');
    try { await navigator.clipboard.writeText(sharePassphrase()); btn.textContent = `✓ ${t('Passphrase copied')}`; }
    catch (e) { const f = _shareEl('sharePass'); f.focus(); f.select(); }
}

_shareEl('shareSeal').addEventListener('change', () => { resetShareResult(); renderShareDialog(); });
_shareEl('shareIncidents').addEventListener('change', () => { resetShareResult(); renderShareDialog(); });
_shareEl('sharePass').addEventListener('input', () => { resetShareResult(); renderShareDialog(); });
_shareEl('shareNewPass').onclick = () => { _shareEl('sharePass').value = generatePassphrase(); resetShareResult(); renderShareDialog(); };
_shareEl('sharePassShow').onclick = () => { setPassphraseShown(_shareEl('sharePass').type !== 'text'); renderShareDialog(); };
_shareEl('shareCopyBtn').onclick = copyShareLink;
_shareEl('sharePassCopyBtn').onclick = copySharePassphrase;
_shareEl('shareCloseBtn').onclick = closeShareDialog;
_shareEl('shareDialog').addEventListener('click', (e) => { if (e.target.id === 'shareDialog') closeShareDialog(); });
_shareEl('shareDialog').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeShareDialog(); } });

// ---- Open a link… (docs/SCOPE.md D366) ----
// A Topo link pasted into the page instead of the address bar: the only
// way a link comes into the desktop app, and the same door on the website.
// The link's fragment is what counts, whatever address it was made on (a
// topo.carino.systems link opens in the app), and a bare fragment is taken
// too. What mail does to a long link (line breaks, spaces, angle brackets)
// is taken off.
// -> the fragment (no '#'), or null when the text holds none.
function linkFragmentOf(text) {
    let s = String(text || '').trim().replace(/^<+|>+$/g, '').replace(/\s+/g, '');
    if (!s) return null;
    const at = s.indexOf('#');
    if (at >= 0) s = s.slice(at + 1);
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;   // an address with no fragment carries nothing
    // An entry word ('simple', 'setup') is a way in, not a link someone sent.
    if (!s || /^[a-z][a-z-]{0,23}$/i.test(s)) return null;
    return s;
}
// Opens it as the address bar would: a new history entry whose fragment
// load() reads (popstate, js/app.js), so a sealed link asks for its
// passphrase (or knows it, "Reply tags" below), and a network already kept
// here gets the merge questions.
async function openLinkDialog() {
    const text = await askPrompt(t('Paste the link you were sent. It opens here, in this Topo.'), { title: t('Open a link'), ok: t('Open') });
    if (text === null || text === undefined) return false;
    const frag = linkFragmentOf(text);
    if (!frag) { await tell(t('This is not a Topo link, or it was cut short.')); return false; }
    if (isSealedFragment(frag)) {
        const shape = sealedShape(frag);
        if (shape.shape === 'damaged') { await tell(t('This is not a Topo link, or it was cut short.')); return false; }
    }
    if (typeof flushAutosave === 'function') flushAutosave();
    window.location.hash = '#' + frag;
    return true;
}

// ---- Opening a sealed link ----
// Resolves with the typed passphrase, or null when the visitor declines. The
// error line says why the last attempt failed. `blocked` hides Open, for a
// browser that could never succeed.
let _unlockResolve = null;
let _unlockRun = 0;   // bumped by each openSealedLink and by abandonUnlock: a run that is no longer the latest touches nothing
function askPassphrase(error, blocked) {
    const dialog = _shareEl('unlockDialog'), field = _shareEl('unlockPass');
    _shareEl('unlockError').textContent = error || '';
    _shareEl('unlockOpenBtn').textContent = `🔓 ${t('Open')}`;
    _shareEl('unlockOpenBtn').disabled = false;
    _shareEl('unlockOpenBtn').classList.toggle('hidden', !!blocked);
    field.disabled = !!blocked;
    dialog.classList.remove('hidden');
    // On a touch screen the passphrase field waits for a tap, so the question
    // and the last error are read first; a retry sent with Enter keeps the
    // field and its keyboard (focusForTyping, js/dialog.js).
    if (!blocked) focusForTyping(field, _shareEl('unlockForm'), { select: true });
    return new Promise((resolve) => { _unlockResolve = resolve; });
}
function _answerUnlock(value) {
    const r = _unlockResolve; _unlockResolve = null;
    if (r) r(value);
}
function closeUnlockDialog() {
    _shareEl('unlockDialog').classList.add('hidden');
    _shareEl('unlockPass').value = '';
}
// Back/Forward while a sealed link is being opened: the entry it was for is gone, so the run is dropped where it stands, never let it write into the entry navigation brought back (popstate, js/app.js).
function abandonUnlock() { _unlockRun++; _answerUnlock(null); closeUnlockDialog(); }
const unlockDialogOpen = () => !_shareEl('unlockDialog').classList.contains('hidden');

_shareEl('unlockForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const pass = _shareEl('unlockPass').value.trim();
    if (!pass) return;
    // Key stretching takes a moment on purpose; say so rather than look stuck.
    _shareEl('unlockOpenBtn').disabled = true;
    _shareEl('unlockOpenBtn').textContent = `⏳ ${t('Checking…')}`;
    _answerUnlock(pass);
});
_shareEl('unlockCancelBtn').onclick = () => _answerUnlock(null);
_shareEl('unlockDialog').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); _answerUnlock(null); } });

// The passphrase that opened the document arriving now, handed over once
// (replaceDocument -> providerDocLoaded takes it), never stored; and the
// link's reply tag (D368), for the copy sent back.
let _arrivalPass = null, _arrivalTag = null;
function takeArrivalPassphrase() { const p = _arrivalPass; _arrivalPass = null; return p; }
function takeArrivalTag() { const g = _arrivalTag; _arrivalTag = null; return g; }

// ---- Reply tags (docs/SCOPE.md D367-D369) ----
// The client keeps the passphrase of each sealed link it sends to a
// provider (a problem report, Share their part), under the link's reply
// tag, beside the networks themselves (this browser's storage, or the
// app's), which already hold the network unencrypted: the passphrase
// protects the link while it travels, as before. The copy the provider
// sends back carries the same tag and, while their page still holds it, the
// same passphrase, so it opens here without asking. The provider's side
// keeps nothing (D44).
//   { tag: { pass, cardId, docId, incidentId, to: [provider names], at } }
// Kept while the network's card is here (pruned when another link is
// kept), the newest REPLY_TAGS_MAX of them.
const REPLY_TAGS_KEY = 'topo_reply_tags';
const REPLY_TAGS_MAX = 200;
function replyTagsRead() {
    try {
        const v = JSON.parse(localStorage.getItem(REPLY_TAGS_KEY) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
}
function replyTagsWrite(all) {
    try {
        if (Object.keys(all).length) localStorage.setItem(REPLY_TAGS_KEY, JSON.stringify(all));
        else localStorage.removeItem(REPLY_TAGS_KEY);
        return true;
    } catch (e) { return false; }   // storage blocked: the reply asks for the passphrase, as before
}
// rec: { pass, cardId, docId, incidentId, to }.
function rememberReplyTag(tag, rec) {
    if (!validReplyTag(tag) || !rec || typeof rec.pass !== 'string' || !rec.pass) return false;
    const all = replyTagsRead();
    // A network no longer kept here takes its passphrases with it.
    if (typeof libraryEntry === 'function') Object.keys(all).forEach((k) => { const c = all[k] && all[k].cardId; if (c && !libraryEntry(c)) delete all[k]; });
    all[tag] = { pass: rec.pass, cardId: rec.cardId || null, docId: rec.docId || null, incidentId: rec.incidentId || null,
        to: Array.isArray(rec.to) ? rec.to.filter((x) => typeof x === 'string' && x).slice(0, 8) : [], at: Date.now() };
    const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
    keys.slice(REPLY_TAGS_MAX).forEach((k) => delete all[k]);
    return replyTagsWrite(all);
}
function replyTagLookup(tag) {
    if (!validReplyTag(tag)) return null;
    const r = replyTagsRead()[tag];
    return r && typeof r === 'object' && typeof r.pass === 'string' && r.pass ? r : null;
}

async function openSealedLink(frag) {
    // A stale run returns without closing the dialog or saying why: a newer
    // run may have opened it again already, for the entry now current.
    const run = ++_unlockRun; const stale = () => run !== _unlockRun;
    const blocked = !canSeal();
    // Read before anything is asked (D369): a link that is no sealed link at
    // all, or one a newer Topo made, is said so and no passphrase is asked.
    const shape = sealedShape(frag);
    if (shape.shape !== 'ok') {
        closeUnlockDialog();
        if (shape.shape === 'newer') {
            tell(t('This link was made by a newer Topo. Update Topo to open it.'));
            if (state.nodes.length) { keepNetworkInEntry(); return; }
            window.history.replaceState(null, '', cleanUrl());
            await load();
            return;
        }
        arrivedUnreadable('');
        return;
    }
    const opened = (kind, json, pass) => {
        closeUnlockDialog();
        if (kind === SEAL_KIND.binder) {
            openBinderPayload(json);
            window.history.replaceState(null, '', cleanUrl());
        } else {
            // The passphrase goes to provider mode for the copy sent back
            // (js/providermode.js), in memory only, for this one arrival;
            // the reply tag with it.
            _arrivalPass = pass; _arrivalTag = shape.tag;
            try { if (!openArrivedDocument(json)) arrivedUnreadable(''); }    // writes the document into the entry and clears the URL, or says the link is damaged
            finally { _arrivalPass = null; _arrivalTag = null; }
        }
    };
    // A reply to a link sent from here: the passphrase kept with its tag,
    // tried once. A provider whose page forgot it locked the copy with a
    // new one (D44): the try fails and the passphrase is asked, as for any
    // link this browser does not know.
    const known = !blocked ? replyTagLookup(shape.tag) : null;
    if (known) {
        try {
            const { kind, json } = await unsealFragment(frag, known.pass);
            if (stale()) return;
            opened(kind, json, known.pass);
            if (kind !== SEAL_KIND.binder) {
                showToast(known.to.length
                    ? t('A reply from {who}: opened with the passphrase you sent it with.', { who: known.to.join(', ') })
                    : t('A reply to a link you sent: opened with the passphrase you sent it with.'), 'ok');
            }
            return;
        } catch (e) {
            if (stale()) return;
            if (e.code !== 'passphrase') console.warn('Topo: a known reply did not open', e.code || e);
        }
    }
    let error = blocked ? t('This browser cannot open locked links. It needs a secure (https) page.')
        : known ? t('This reply was locked with a new passphrase. Ask whoever sent it for it.') : '';
    for (;;) {
        const pass = await askPassphrase(error, blocked);
        if (stale()) return;   // before the decline below: abandonUnlock answers null too
        if (pass === null) break;
        try {
            const { kind, json } = await unsealFragment(frag, pass);
            if (stale()) return;
            opened(kind, json, pass);
            return;
        } catch (e) {
            if (stale()) return;
            error = e.code === 'passphrase' ? t('That passphrase does not open this link.')
                : e.code === 'unsupported' ? t('This browser cannot open locked links. It needs a secure (https) page.')
                : t('This link is damaged. Ask for it to be sent again.');
        }
    }
    // Declined. Mid-session (pasted over an open network) the canvas stays and
    // simply takes this entry. On a fresh boot it is as if the link was bare.
    closeUnlockDialog();
    if (state.nodes.length) { keepNetworkInEntry(); return; }   // js/app.js
    window.history.replaceState(null, '', cleanUrl());
    await load();
}
