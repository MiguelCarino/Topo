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

const _shareEl = (id) => document.getElementById(id);

function openShareDialog(mode) {
    _shareMode = mode === 'binder' ? 'binder' : 'doc';
    const seal = _shareEl('shareSeal');
    seal.checked = canSeal();
    seal.disabled = !canSeal();
    _shareEl('sharePass').value = canSeal() ? generatePassphrase() : '';
    resetShareResult();
    renderShareDialog();
    _shareEl('shareDialog').classList.remove('hidden');
    _shareEl('shareCopyBtn').focus();
}

function closeShareDialog() {
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
    _shareEl('shareTitle').textContent = binder ? t('Share these networks') : t('Share this network');
    _shareEl('shareBlurb').textContent = binder
        ? t('One link carries every saved network. Whoever opens it sees them on a shelf and chooses which to keep.')
        : t('The link carries the whole network: devices, addresses, names and notes.');
    _shareEl('sharePassRow').classList.toggle('hidden', !sealed);
    const hint = _shareEl('shareHint');
    hint.style.color = sealed ? 'var(--cs-text-muted)' : '#f87171';
    if (!canSeal()) hint.textContent = t('This page cannot encrypt (it needs https), so the link can only be plain. Anyone who gets it can read the whole network.');
    else if (!sealed) hint.textContent = `⚠ ${t('Anyone who gets this link can read the whole network. Chats, mail and browser history keep links.')}`;
    else if (pass.length < SEAL_MIN_PASSPHRASE) hint.textContent = t('At least {n} characters. The suggested one is far stronger than anything memorable.', { n: SEAL_MIN_PASSPHRASE });
    else hint.textContent = t('Send the passphrase a different way from the link: a call, a text, another app. The link alone cannot be opened.');
    const copy = _shareEl('shareCopyBtn');
    copy.disabled = _shareBusy || (sealed && pass.length < SEAL_MIN_PASSPHRASE);
    copy.textContent = _shareBusy ? `⏳ ${t('Locking…')}` : sealed ? `🔒 ${t('Copy locked link')}` : `🔗 ${t('Copy plain link')}`;
    _shareEl('sharePassCopyBtn').textContent = `🔑 ${t('Copy passphrase')}`;
}

// A link that no longer matches what is on screen is worse than none, so any
// change to the choices takes the last result away.
function resetShareResult() {
    _shareEl('shareResult').classList.add('hidden');
    _shareEl('shareLink').value = '';
    _shareEl('sharePassCopyBtn').classList.add('hidden');
}

// -> the full URL, or null when a binder is too big for one link.
async function buildShareLink(mode, sealed, passphrase) {
    const binder = mode === 'binder';
    const json = JSON.stringify(binder ? binderFile() : serializeDoc());
    const frag = sealed
        ? await sealFragment(json, binder ? SEAL_KIND.binder : SEAL_KIND.doc, passphrase)
        : binder ? await encodeBinderFragment(json) : await encodeShareFragment(json);
    if (binder && frag.length > BINDER_URL_MAX) return null;
    // A network link keeps the query ('?profile=' composes with it), while a
    // binder link never did, because the shelf is not a view of the editor.
    return `${location.origin}${location.pathname}${binder ? '' : location.search}#${frag}`;
}

async function copyShareLink() {
    if (_shareBusy) return;
    const sealed = shareSealed(), pass = sharePassphrase();
    if (sealed && pass.length < SEAL_MIN_PASSPHRASE) return;
    _shareBusy = true; renderShareDialog();
    let url;
    try { url = await buildShareLink(_shareMode, sealed, pass); }
    catch (e) { console.warn('Share: could not build the link', e); url = undefined; }
    finally { _shareBusy = false; renderShareDialog(); }

    if (url === null) {
        const n = binderFile().sites.length;
        closeShareDialog();
        if (confirm(t('These {n} networks are too much for one link. Export the binder file instead?', { n }))) exportBinder();
        return;
    }
    const done = _shareEl('shareDone');
    _shareEl('shareResult').classList.remove('hidden');
    if (!url) { done.textContent = t('The link could not be made in this browser.'); return; }
    const box = _shareEl('shareLink');
    box.value = url;
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (e) { /* shown for manual copy below */ }
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
_shareEl('sharePass').addEventListener('input', () => { resetShareResult(); renderShareDialog(); });
_shareEl('shareNewPass').onclick = () => { _shareEl('sharePass').value = generatePassphrase(); resetShareResult(); renderShareDialog(); };
_shareEl('shareCopyBtn').onclick = copyShareLink;
_shareEl('sharePassCopyBtn').onclick = copySharePassphrase;
_shareEl('shareCloseBtn').onclick = closeShareDialog;
_shareEl('shareDialog').addEventListener('click', (e) => { if (e.target.id === 'shareDialog') closeShareDialog(); });
_shareEl('shareDialog').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeShareDialog(); } });

// ---- Opening a sealed link ----
// Resolves with the typed passphrase, or null when the visitor declines. The
// error line says why the last attempt failed. `blocked` hides Open, for a
// browser that could never succeed.
let _unlockResolve = null;
function askPassphrase(error, blocked) {
    const dialog = _shareEl('unlockDialog'), field = _shareEl('unlockPass');
    _shareEl('unlockError').textContent = error || '';
    _shareEl('unlockOpenBtn').textContent = `🔓 ${t('Open')}`;
    _shareEl('unlockOpenBtn').disabled = false;
    _shareEl('unlockOpenBtn').classList.toggle('hidden', !!blocked);
    field.disabled = !!blocked;
    dialog.classList.remove('hidden');
    if (!blocked) { field.focus(); field.select(); }
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

async function openSealedLink(frag) {
    const blocked = !canSeal();
    let error = blocked ? t('This browser cannot open locked links. It needs a secure (https) page.') : '';
    for (;;) {
        const pass = await askPassphrase(error, blocked);
        if (pass === null) break;
        try {
            const { kind, json } = await unsealFragment(frag, pass);
            closeUnlockDialog();
            if (kind === SEAL_KIND.binder) {
                openBinderPayload(json);
                window.history.replaceState(null, '', cleanUrl());
            } else {
                openArrivedDocument(json);    // writes the document into the entry and clears the URL
            }
            return;
        } catch (e) {
            error = e.code === 'passphrase' ? t('That passphrase does not open this link.')
                : e.code === 'unsupported' ? t('This browser cannot open locked links. It needs a secure (https) page.')
                : t('This link is damaged. Ask for it to be sent again.');
        }
    }
    // Declined. Mid-session (pasted over an open network) the canvas stays and
    // simply takes this entry. On a fresh boot it is as if the link was bare.
    closeUnlockDialog();
    if (state.nodes.length) { save(); return; }
    window.history.replaceState(null, '', cleanUrl());
    await load();
}
