// ---- What a Topo server adds to the page (docs/SCOPE.md step 5a) ----
// The landing's "On this server" section, a card's line and tools, the doc
// bar's sync state, and one sheet (#serverSheet) whose content is built
// here for each step: sign in, the recovery key, opening the account on a
// new browser, the account, an invitation, the members of a site, its
// history on the server. Everything a client sees is translated; Japanese
// says "PC". Server error codes are shown as sentences, never raw (E4).
//
// Nothing here runs on a page no Topo server served: every entry point
// below returns at once while js/server.js says the server is off.
//
// Tests answer the questions with setServerResponder(fn): fn gets
// { kind, ... } and returns the answer ('recovery' -> 'ok'|'skip'|null,
// 'grant' -> { checked, history } | null, 'delete' -> 'local'|'everyone'|null,
// 'merge-local' -> bool, 'show-name' -> bool), as setDialogResponder does.

(function () {
'use strict';

const T = () => window.TopoServer;
const Y = () => window.TopoServerSync;
const C = window.TopoServerCrypto;
const on = () => !!(T() && T().state.on);
let _responder = null;
function setServerResponder(fn) { const prev = _responder; _responder = typeof fn === 'function' ? fn : null; return prev; }

// ---- Words ----
const ROLE = { owner: 'Owner', provider: 'Provider', viewer: 'Viewer', monitor: 'Monitor' };
const roleText = (r) => t(ROLE[r] || r);
const ERR = {
    'bad-email': 'That does not look like an email address.',
    'bad-code': 'That code is not right, or it has expired. Ask for a new one.',
    'bad-link': 'This sign-in link has expired or was already used. Ask for a new code.',
    'other-browser': 'This link works in the browser where you asked for it. Type the code from the email there instead.',
    'offline': 'The server cannot be reached. Check the connection and try again.',
    'unauthorized': 'You are signed out. Sign in again.',
    'forbidden': 'You are not allowed to do that on this server.',
    'not-found': 'This is no longer on the server.',
    'bad-invite': 'This invitation has expired or was already used.',
    'wrong-email': 'This invitation is for another email address. Sign out, then sign in with that address.',
    'already-member': 'That person is already a member.',
    'last-owner': 'A site needs at least one owner.',
    'no-keys': 'They have not opened Topo yet. Try again once they have.',
    'no-device': 'This browser is not set up yet. Reload the page and try again.',
    'too-large': 'This network is too large for this server.',
    'site-full': 'This site has no room left on the server.',
    'untrusted-wrap': 'The keys could not be checked, so nothing was opened.',
    'untrusted-roster': 'The keys could not be checked, so nothing was opened.',
    'keys-changed': 'The server lists different keys for a member than this site trusts, so nothing was changed. Check their safety code with them.',
    'bad-chain': 'The server sent a copy that does not check out, so it was not used.',
    'history-mismatch': 'The server sent an older or different history.',
    'conflict': 'Someone else changed this first. Try again.',
    'stale-roster': 'Someone else changed this first. Try again.',
    'stale-epoch': 'Someone else changed this first. Try again.',
    'catch-up': 'Could not catch up with the server. Try again.',
    'waiting': 'Waiting for the owner to give you access.',
    'storage': 'Could not save — browser storage is unavailable (private mode or full).',
    'owners-only': 'Only owners save versions of this site. Your visits go to the owner for review.',
    'visits-full': 'Too many visits are waiting for the owner on this site. Ask them to review some first.',
    'needs-merge': 'Review the merge with the server first, then record the visit again.',
    'not-provider': 'Whoever recorded this visit is no longer a provider on this site, so it cannot be reviewed.'
};
function errText(e) {
    const code = (e && (e.code || e.message)) || '';
    if (code === 'rate-limited') {
        const s = (e.data && e.data.retryAfter) || 60;
        return t('Too many tries. Wait {minutes} min.', { minutes: Math.max(1, Math.ceil(s / 60)) });
    }
    return t(ERR[code] || 'Something went wrong on the server. Try again.');
}

// ---- A small DOM builder ----
function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'hidden') el.hidden = true;
        else el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((k) => { if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : String(k)); });
    return el;
}
const btn = (label, onclick, cls = 'btn') => h('button', { type: 'button', class: cls, onclick }, label);
const para = (text, cls = 'srv-p') => h('p', { class: cls, text });

// ---- The sheet ----
const _sheet = { render: null, onClose: null };
const sheetEl = (id) => document.getElementById(id);
function sheetOpen() { const s = sheetEl('serverSheet'); return !!s && !s.hidden; }
// title, body builder (gets a re-render function), onClose.
function showSheet(title, build, onClose) {
    const scrim = sheetEl('serverSheet');
    if (!scrim) return;
    const prevClose = _sheet.onClose;
    _sheet.onClose = null;
    if (prevClose) prevClose('replaced');
    _sheet.render = () => {
        sheetEl('serverSheetTitle').textContent = title();
        const body = sheetEl('serverSheetBody');
        const keep = document.activeElement && body.contains(document.activeElement) ? document.activeElement.dataset.k : null;
        body.replaceChildren(...[].concat(build(_sheet.render)).filter(Boolean));
        if (keep) { const f = body.querySelector(`[data-k="${keep}"]`); if (f) f.focus(); }
    };
    _sheet.onClose = onClose || null;
    _sheet.render();
    if (!sheetOpen()) {
        if (window.CarinoUI) CarinoUI.modal.open(scrim, { onDismiss: () => closeSheet('dismissed') });
        else scrim.hidden = false;
    }
    const first = sheetEl('serverSheetBody').querySelector('input, select, button.primary, button');
    if (first) first.focus();
}
function closeSheet(reason = 'answered') {
    const scrim = sheetEl('serverSheet');
    const cb = _sheet.onClose;
    _sheet.onClose = null; _sheet.render = null;
    if (scrim) {
        if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, reason);
        else scrim.hidden = true;
    }
    if (cb) cb(reason);
}
function rerender() { if (_sheet.render && sheetOpen()) _sheet.render(); }
function field(label, input, hint) {
    return h('label', { class: 'srv-field' }, h('span', { class: 'srv-label', text: label }), input, hint ? h('span', { class: 'srv-hint', text: hint }) : null);
}
const errBox = (text) => h('p', { class: 'srv-err', role: 'alert', text: text || '' });
const statusBox = (text) => h('p', { class: 'srv-status', role: 'status', text: text || '' });

// ---- Sign in (design §6.1) ----
function openSignIn(opts = {}) {
    if (!on()) return;
    const st = { step: 'email', email: opts.email || '', token: '', code: '', challenge: null, err: '', busy: false, sentAt: 0, then: opts.then || null };
    const setup = !!(T().state.health && T().state.health.setup);
    const send = async () => {
        if (st.busy) return;
        st.busy = true; st.err = ''; rerender();
        try {
            st.challenge = await T().requestCode(st.email, { setupToken: setup ? st.token : undefined, invite: opts.invite });
            st.step = 'code'; st.sentAt = Date.now(); st.code = '';
            setTimeout(rerender, 30500);
        } catch (e) { st.err = errText(e); }
        st.busy = false; rerender();
    };
    const verify = async () => {
        if (st.busy || st.code.replace(/\D/g, '').length < 6) return;
        st.busy = true; st.err = ''; rerender();
        try {
            await T().verifyCode(st.challenge, st.code, st.email);
            signedInDone(st.then);
            return;
        } catch (e) { st.err = errText(e); }
        st.busy = false; rerender();
    };
    showSheet(() => t('Sign in to Topo'), () => {
        if (st.step === 'email') {
            const email = h('input', { type: 'email', class: 'input', autocomplete: 'email', inputmode: 'email', 'data-k': 'email', value: st.email, oninput: (e) => { st.email = e.target.value; },
                onkeydown: (e) => { if (e.key === 'Enter') send(); } });
            email.value = st.email;
            const out = [para(t('Type your email address. A code to sign in will be sent there.')), field(t('Email'), email)];
            if (setup) {
                const tok = h('input', { type: 'text', class: 'input', autocomplete: 'off', spellcheck: 'false', 'data-k': 'token', oninput: (e) => { st.token = e.target.value; } });
                tok.value = st.token;
                out.push(field(t('Setup code'), tok, t('The first person to sign in becomes the owner of this server. The setup code is in the server\'s log.')));
            }
            out.push(errBox(st.err), h('div', { class: 'srv-acts' }, btn(st.busy ? t('Sending…') : t('Send me a code'), send, 'btn primary')));
            return out;
        }
        const code = h('input', { type: 'text', class: 'input srv-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*', 'data-k': 'code',
            oninput: (e) => { st.code = e.target.value; if (st.code.replace(/\D/g, '').length === 6) verify(); }, onkeydown: (e) => { if (e.key === 'Enter') verify(); } });
        code.value = st.code;
        const again = btn(t('Send a new code'), send);
        again.disabled = Date.now() - st.sentAt < 30000 || st.busy;
        // In the desktop app's window (js/desktopclient.js) the email's link
        // would sign in a browser, not this window (D196): only the code.
        return [para(T()._hooks.desktop ? t('If {email} can sign in here, a code is on its way. Type the code from the email here.', { email: st.email })
            : t('If {email} can sign in here, a code is on its way. Type it here, or open the link in the email in this browser.', { email: st.email })),
            field(t('Code from the email'), code), errBox(st.err),
            h('div', { class: 'srv-acts' }, btn(st.busy ? t('Signing in…') : t('Sign in'), verify, 'btn primary'), again,
                btn(t('Use another email'), () => { st.step = 'email'; st.err = ''; rerender(); }))];
    });
}
async function signedInDone(then) {
    closeSheet();
    const st = T().state.status;
    if (st === 'locked') openUnlock();
    if (then) await then();
    render();
}
// The email's link, opened in this browser (D54): consumed only by a tap.
function linkArrived(token) {
    const st = { err: '', busy: false };
    showSheet(() => t('Sign in to Topo'), () => [
        para(t('Sign in to Topo on this browser?')), errBox(st.err),
        h('div', { class: 'srv-acts' }, btn(st.busy ? t('Signing in…') : t('Sign in'), async () => {
            if (st.busy) return;
            st.busy = true; st.err = ''; rerender();
            try { await T().signInWithLink(token); signedInDone(takeInviteAfter()); return; }
            catch (e) { st.err = errText(e); }
            st.busy = false; rerender();
        }, 'btn primary'), btn(t('Cancel'), () => closeSheet()))
    ]);
}

// ---- An invitation (design §4.6) ----
const INVITE_KEY = 'topo-server-invite';
function takeInviteAfter() {
    let tok = null;
    try { tok = sessionStorage.getItem(INVITE_KEY); sessionStorage.removeItem(INVITE_KEY); } catch (e) { tok = null; }
    return tok ? () => acceptInvite(tok) : null;
}
async function acceptInvite(token) {
    try {
        await T().api('POST', '/api/invites/accept', { token });
        await T().refreshSites();
        showToast(t('Invitation accepted. Waiting for the owner to give you access.'), 'ok');
        if (typeof openLanding === 'function' && !landingIsOpen()) openLanding(false);
    } catch (e) { showToast(errText(e), 'err'); }
    render();
}
async function inviteArrived(token) {
    let info = null, err = '';
    try { info = await T().api('POST', '/api/invites/peek', { token }); } catch (e) { err = errText(e); }
    const me = T().me();
    showSheet(() => t('An invitation'), () => {
        if (!info) return [errBox(err), h('div', { class: 'srv-acts' }, btn(t('Close'), () => closeSheet()))];
        const out = [para(t('{inviter} invited you to a network on this Topo server as {role}.', { inviter: info.inviter || t('Someone'), role: roleText(info.role) }))];
        if (info.nameClear) out.push(para(t('Name given by the server: {name}', { name: info.nameClear }), 'srv-p srv-dim'));
        if (me && String(me.email).toLowerCase() === String(info.email).toLowerCase()) {
            out.push(h('div', { class: 'srv-acts' }, btn(t('Accept invitation'), () => { closeSheet(); acceptInvite(token); }, 'btn primary'), btn(t('Not now'), () => closeSheet())));
        } else if (me) {
            out.push(para(t('You are signed in as {me}. This invitation is for {email}.', { me: me.email, email: info.email })),
                h('div', { class: 'srv-acts' }, btn(t('Sign out'), async () => { await T().signOut(); inviteArrived(token); }), btn(t('Not now'), () => closeSheet())));
        } else {
            out.push(para(t('Sign in as {email} to accept.', { email: info.email })),
                h('div', { class: 'srv-acts' }, btn(t('Sign in'), () => {
                    try { sessionStorage.setItem(INVITE_KEY, token); } catch (e) { /* asked again */ }
                    openSignIn({ email: info.email, invite: token, then: () => { const f = takeInviteAfter(); return f ? f() : null; } });
                }, 'btn primary'), btn(t('Not now'), () => closeSheet())));
        }
        return out;
    });
}

// ---- The recovery key, shown once (design §5.4) ----
function showRecoveryCode(code, opts = {}) {
    if (_responder) return Promise.resolve(_responder({ kind: 'recovery', code, required: !!opts.required }));
    return new Promise((resolve) => {
        const st = { ticked: false };
        let done = false;
        const finish = (v) => { if (done) return; done = true; resolve(v); };
        showSheet(() => t('Your recovery key'), () => {
            const tick = h('input', { type: 'checkbox', 'data-k': 'tick', onchange: (e) => { st.ticked = e.target.checked; rerender(); } });
            tick.checked = st.ticked;
            const ok = btn(t('Continue'), () => { finish('ok'); closeSheet(); }, 'btn primary');
            ok.disabled = !st.ticked;
            const dl = btn(t('Download .txt'), () => {
                const text = [t('Topo recovery key'), opts.email || '', '', code, '', t('Keep it somewhere safe. With it you can open your networks on a new browser if you lose this one.')].join('\n');
                const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: `topo-recovery-${String(opts.email || 'key').replace(/[^A-Za-z0-9@._-]/g, '_')}.txt` });
                document.body.appendChild(a); a.click(); a.remove();
            });
            const acts = [ok, btn(t('Print'), () => printRecovery(code, opts.email)), dl];
            if (!opts.required) acts.push(btn(t('Skip'), () => { finish('skip'); closeSheet(); }));
            return [
                para(opts.first ? t('This browser is set up. Write down or print your recovery key now: it is shown only once.') : t('Write down or print your new recovery key now: it is shown only once.')),
                h('p', { class: 'srv-recovery', id: 'serverRecoveryCode', text: code }),
                para(t('If you lose every browser where you use Topo, this key opens your networks again. Without it, an owner has to give you access again, and a site whose only owner lost it cannot be opened by anyone.'), 'srv-p srv-dim'),
                opts.required ? para(t('Owners should also add a second owner to each site.'), 'srv-p srv-dim') : null,
                h('label', { class: 'srv-tick' }, tick, h('span', { text: t('I have written it down or printed it') })),
                h('div', { class: 'srv-acts' }, acts)
            ];
        }, (reason) => { if (reason !== 'answered') finish(null); });
    });
}

// Print: a print-only block straight under <body> (css: #srvPrint), so
// the page's other content and the sheet's own ancestors print nothing.
// Taken away after printing (afterprint; print() returns early on some
// browsers, so not in a finally).
function printRecovery(code, email) {
    const old = document.getElementById('srvPrint');
    if (old) old.remove();
    const block = h('div', { id: 'srvPrint', 'aria-hidden': 'true' },
        h('h1', { text: t('Topo recovery key') }),
        email ? h('p', { text: email }) : null,
        h('p', { class: 'srv-print-code', text: code }),
        h('p', { text: t('Keep it somewhere safe. With it you can open your networks on a new browser if you lose this one.') }));
    document.body.appendChild(block);
    document.body.classList.add('srv-printing');
    const done = () => { document.body.classList.remove('srv-printing'); block.remove(); };
    window.addEventListener('afterprint', done, { once: true });
    try { window.print(); } catch (e) { done(); }
}

// ---- Opening the account on this browser (design §9.1, 3) ----
function openUnlock() {
    if (!on()) return;
    const st = { step: 'choose', err: '', link: null, code: '', busy: false };
    showSheet(() => t('Open your account on this browser'), () => {
        if (st.step === 'link') {
            return [para(t('On a browser where you already use Topo, open Account, Devices. Approve this browser there if it shows this code:')),
                h('p', { class: 'srv-recovery', text: st.link ? st.link.code : '…' }),
                statusBox(t('Waiting for approval…')), errBox(st.err),
                h('div', { class: 'srv-acts' }, btn(t('Back'), () => { T().cancelLink(); st.step = 'choose'; rerender(); }))];
        }
        if (st.step === 'recover') {
            const f = h('input', { type: 'text', class: 'input', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none', 'data-k': 'rec', oninput: (e) => { st.code = e.target.value; } });
            f.value = st.code;
            return [field(t('Recovery key'), f, t('The code has no i, l, o, 0 or 1.')), errBox(st.err),
                h('div', { class: 'srv-acts' }, btn(st.busy ? t('Checking…') : t('Open my account'), async () => {
                    if (st.busy) return;
                    st.busy = true; st.err = ''; rerender();
                    let res;
                    try { res = await T().recover(st.code); } catch (e) { res = e.code || 'error'; }
                    st.busy = false;
                    if (res === 'ok') { closeSheet(); showToast(t('This browser is ready.'), 'ok'); render(); return; }
                    st.err = res === 'alphabet' ? t('The code has no i, l, o, 0 or 1.') : res === 'checksum' || res === 'length' ? t('Check the code: one character is wrong.')
                        : res === 'wrong' ? t('That recovery key does not open this account.') : res === 'no-escrow' ? t('This account has no recovery key on the server.') : errText({ code: res });
                    rerender();
                }, 'btn primary'), btn(t('Back'), () => { st.step = 'choose'; st.err = ''; rerender(); }))];
        }
        return [para(t('Your account has keys, but this browser does not hold them yet.')),
            h('div', { class: 'srv-acts srv-stack' },
                btn(t('Approve from another browser'), async () => {
                    st.step = 'link'; st.err = ''; rerender();
                    try {
                        st.link = await T().startLink(); rerender();
                        const ok = await st.link.done;
                        if (ok) { closeSheet(); showToast(t('This browser is ready.'), 'ok'); render(); }
                        else if (st.step === 'link') { st.err = t('The request was turned down or ran out. Try again.'); rerender(); }
                    } catch (e) { st.err = errText(e); rerender(); }
                }, 'btn primary'),
                btn(t('Use my recovery key'), () => { st.step = 'recover'; rerender(); }),
                btn(t('I lost both: reset my keys'), () => confirmReset(), 'btn danger')),
            errBox(st.err)];
    }, () => T().cancelLink());
}
async function confirmReset() {
    const ok = await askConfirm(t('Reset your keys? Every site you are a member of has to give you access again, and a site where you are the only owner can no longer be opened by anyone.'), { ok: t('Reset my keys'), danger: true });
    if (!ok) return;
    try { await T().resetKeys(); render(); } catch (e) { showToast(errText(e), 'err'); }
}

// ---- The account (design §9.1) ----
const NOTIFY = [['revision', 'Changes on sites I own'], ['revisionShared', 'Changes on sites shared with me'], ['visit', 'Visits recorded'],
    ['incident', 'Problems sent to me'], ['closed', 'Problems closed'], ['join', 'People waiting for access']];
const LANGS = [['en', 'English'], ['es', 'Español'], ['pt-BR', 'Português (Brasil)'], ['ja', '日本語'], ['ru', 'Русский']];
async function openAccount() {
    if (!on()) return;
    const me = T().me();
    if (!me) { openSignIn(); return; }
    const st = { devices: [], sessions: [], requests: [], people: null, err: '', loaded: false };
    const load = async () => {
        try {
            st.devices = (await T().api('GET', '/api/devices')).devices || [];
            st.sessions = (await T().api('GET', '/api/me/sessions')).sessions || [];
            st.requests = await T().linkRequests().catch(() => []);
            if (me.serverRole === 'owner') {
                st.people = (await T().api('GET', '/api/admin/users')).users || [];
                st.backups = await T().api('GET', '/api/admin/backups').catch(() => null);
            }
        } catch (e) { st.err = errText(e); }
        st.loaded = true; rerender();
    };
    showSheet(() => t('Account'), () => {
        const m = T().me() || me;
        const status = T().state.status;
        const out = [h('p', { class: 'srv-email', text: m.email })];
        if (status === 'locked' || status === 'needs-keys') out.push(h('div', { class: 'srv-acts' }, btn(status === 'locked' ? t('Open your account on this browser') : t('Set up this browser'), () => (status === 'locked' ? openUnlock() : T().ensureKeys(true).then(render)), 'btn primary')));
        if (C.ephemeral()) out.push(para(t('This browser cannot keep keys (a private window, or storage is blocked): it counts as a new browser every time.'), 'srv-p srv-warn'));
        // Language for emails.
        const sel = h('select', { class: 'select', 'data-k': 'lang', onchange: async (e) => { try { await T().patchMe({ lang: e.target.value }); } catch (x) { showToast(errText(x), 'err'); } } },
            LANGS.map(([v, l]) => h('option', { value: v, text: l })));
        sel.value = m.lang || 'en';
        out.push(field(t('Language for emails'), sel));
        // Notifications.
        const notes = h('fieldset', { class: 'srv-group' }, h('legend', { text: t('Emails') }));
        NOTIFY.forEach(([k, label]) => {
            const c = h('input', { type: 'checkbox', onchange: async (e) => { try { await T().patchMe({ notify: { [k]: e.target.checked } }); } catch (x) { showToast(errText(x), 'err'); rerender(); } } });
            c.checked = !!(m.notify && m.notify[k]);
            notes.append(h('label', { class: 'srv-tick' }, c, h('span', { text: t(label) })));
        });
        out.push(notes);
        // Link requests waiting for this browser.
        if (st.requests.length) {
            const box = h('div', { class: 'srv-group srv-alert' }, para(t('A new browser wants to open your account. Approve it only if it shows the same code.')));
            st.requests.forEach((q) => box.append(h('div', { class: 'srv-row' },
                h('span', { class: 'srv-row-text' }, h('b', { class: 'srv-mono', text: q.code }), ' ', q.label || ''),
                h('span', { class: 'srv-row-acts' },
                    btn(t('The codes match: approve'), async () => { try { await T().approveLink(q); showToast(t('Approved.'), 'ok'); } catch (e) { showToast(errText(e), 'err'); } load(); }, 'btn primary'),
                    btn(t('Deny'), async () => { try { await T().denyLink(q); } catch (e) { /* gone */ } load(); })))));
            out.push(box);
        }
        // Devices and sessions.
        const myDev = T().keys() && T().keys().deviceId;
        const devs = h('fieldset', { class: 'srv-group' }, h('legend', { text: t('Browsers') }));
        st.devices.forEach((d) => devs.append(h('div', { class: 'srv-row' },
            h('span', { class: 'srv-row-text', text: [d.label || t('A browser'), d.id === myDev ? t('this browser') : '', d.linked ? '' : t('not opened yet')].filter(Boolean).join(' · ') }),
            d.id === myDev ? null : btn(t('Remove'), async () => {
                if (!(await askConfirm(t('Remove this browser from your account? It is signed out and can no longer open your networks.'), { ok: t('Remove'), danger: true }))) return;
                try { await T().api('DELETE', `/api/devices/${d.id}`); } catch (e) { showToast(errText(e), 'err'); }
                load();
            }))));
        if (st.sessions.filter((x) => !x.current).length) devs.append(h('div', { class: 'srv-acts' }, btn(t('Sign out everywhere else'), async () => {
            try { await T().api('POST', '/api/me/sessions/revoke-others'); showToast(t('Signed out everywhere else.'), 'ok'); } catch (e) { showToast(errText(e), 'err'); }
            load();
        })));
        out.push(devs);
        // Keys.
        if (status === 'ready') out.push(h('div', { class: 'srv-acts' }, btn(t('New recovery key'), async () => {
            try { await T().newRecoveryKey(); } catch (e) { showToast(errText(e), 'err'); }
            openAccount();
        })));
        // The server's people (the server owner).
        if (st.people) out.push(peopleBox(st, load));
        // Backups (step 5b): the server owner's, one destination for the server.
        if (st.backups) out.push(h('fieldset', { class: 'srv-group' }, h('legend', { text: t('Backups') }),
            para(backupBrief(st.backups), 'srv-p srv-dim'),
            h('div', { class: 'srv-acts' }, btn(t('Backups…'), () => openBackups(), 'btn'))));
        out.push(errBox(st.err), h('div', { class: 'srv-acts' },
            btn(t('Sign out'), async () => { closeSheet(); await T().signOut(); render(); }),
            m.keys ? btn(t('Reset my keys'), () => { closeSheet(); confirmReset(); }, 'btn danger') : null));
        if (!st.loaded) out.push(statusBox(t('Loading…')));
        return out;
    });
    load();
}
function peopleBox(st, load) {
    const box = h('fieldset', { class: 'srv-group' }, h('legend', { text: t('People on this server') }));
    st.people.forEach((u) => box.append(h('div', { class: 'srv-row' },
        h('span', { class: 'srv-row-text', text: [u.email, t(u.serverRole === 'owner' ? 'Server owner' : u.serverRole === 'staff' ? 'Staff' : 'Member'), u.disabled ? t('Disabled') : ''].filter(Boolean).join(' · ') }),
        u.serverRole === 'owner' ? null : btn(u.disabled ? t('Enable') : t('Disable'), async () => {
            try { await T().api('PATCH', `/api/admin/users/${u.id}`, { disabled: !u.disabled }); } catch (e) { showToast(errText(e), 'err'); }
            load();
        }))));
    const email = h('input', { type: 'email', class: 'input', autocomplete: 'off', 'data-k': 'addEmail' });
    const role = h('select', { class: 'select' }, h('option', { value: 'staff', text: t('Staff: may put networks on the server') }), h('option', { value: 'member', text: t('Member: only what they are invited to') }));
    box.append(field(t('Add someone'), email), role, h('div', { class: 'srv-acts' }, btn(t('Add'), async () => {
        try { await T().api('POST', '/api/admin/users', { email: email.value.trim(), serverRole: role.value, lang: CarinoI18N.current() }); showToast(t('Added. They got an email.'), 'ok'); }
        catch (e) { showToast(errText(e), 'err'); }
        load();
    })));
    return box;
}

// ---- Members of a site (design §9.5, D61, A1, A6) ----
async function openMembers(siteId) {
    if (!on() || !T().ready()) return;
    const st = { d: null, err: '', codes: {}, keys: {}, mine: null, busy: false, email: '', role: 'provider', lang: CarinoI18N.current(), name: '' };
    const load = async () => {
        try {
            st.d = await Y().siteDetail(siteId, true);
            st.name = await Y().siteName(siteId);
            // The site's monitors: their names and last reports (step 7h).
            if (window.TopoMonitors && st.d.site.status === 'granted') { try { st.mons = await TopoMonitors.loadMonitors(siteId); } catch (e) { st.mons = null; } }
            for (const m of st.d.members || []) {
                if (m.encPub && m.sigPub) {
                    st.codes[m.user] = await C.safetyCode(m.encPub, m.sigPub);
                    st.keys[m.user] = await T().personKeys(m.user, m.encPub, m.sigPub);
                }
            }
        } catch (e) { st.err = errText(e); }
        rerender(); render();
    };
    const act = (fn) => async () => {
        if (st.busy) return;
        st.busy = true; st.err = ''; rerender();
        try { await fn(); } catch (e) { st.err = errText(e); }
        st.busy = false;
        await load();
    };
    showSheet(() => t('Members'), () => {
        const d = st.d;
        if (!d) return [statusBox(t('Loading…')), errBox(st.err)];
        const me = T().me();
        const owner = d.site.role === 'owner' && d.site.status === 'granted';
        const out = [h('p', { class: 'restore-name', text: st.name || t('A shared network') })];
        const list = h('div', { class: 'srv-list' });
        (d.members || []).forEach((m) => {
            // A site monitor (D147, D149): "Monitor: PC name (turned on by X
            // on date)", when it last reported, and Revoke for an owner.
            if (m.role === 'monitor') {
                const mt = window.TopoMonitors ? TopoMonitors.memberMonitorText(siteId, m.user) : null;
                const row = h('div', { class: 'srv-row' + (mt && mt.stale ? ' srv-danger' : '') },
                    h('span', { class: 'srv-row-text' }, h('span', {}, h('b', { text: mt ? mt.title : t('Monitor') })),
                        h('span', { class: 'srv-sub', text: mt ? mt.last : t('Revoked or not set up') })));
                const acts = h('span', { class: 'srv-row-acts' });
                if (owner) acts.append(btn(t('Revoke'), async () => {
                    if (!(await askConfirm(t('Revoke this monitor? It stops reporting, and the network key changes for everyone left.'), { ok: t('Revoke'), danger: true }))) return;
                    act(() => Y().removeMember(siteId, m.user))();
                }));
                row.append(acts);
                list.append(row);
                return;
            }
            const k = st.keys[m.user] || { state: 'none' };
            const lines = [h('b', { text: m.email }), ' · ', roleText(m.role)];
            const sub = [];
            if (m.status === 'waiting') sub.push(m.encPub ? t('Accepted: give access') : t('Waiting for them to open Topo once'));
            if (k.state === 'changed') sub.push(t('Their keys changed on {date}', { date: new Date(k.at).toLocaleDateString() }));
            else if (m.status === 'granted' && k.state === 'same' && !k.checked && m.user !== me.id) sub.push(t('Not checked'));
            const row = h('div', { class: 'srv-row' + (k.state === 'changed' ? ' srv-danger' : '') },
                h('span', { class: 'srv-row-text' }, h('span', {}, lines), sub.length ? h('span', { class: 'srv-sub', text: sub.join(' · ') }) : null,
                    st.codes[m.user] ? h('span', { class: 'srv-sub srv-mono', text: t('Safety code: {code}', { code: st.codes[m.user] }) }) : null));
            const acts = h('span', { class: 'srv-row-acts' });
            if (owner && m.user !== me.id) {
                if (m.status === 'waiting' && m.encPub) acts.append(btn(t('Give access'), () => giveAccess(siteId, m, st.codes[m.user], k).then(load), 'btn primary'));
                const sel = h('select', { class: 'select', 'aria-label': t('Role'), onchange: (e) => act(() => Y().setRole(siteId, m.user, e.target.value))() },
                    ['owner', 'provider', 'viewer'].map((r) => h('option', { value: r, text: roleText(r) })));
                sel.value = m.role;
                acts.append(sel, btn(t('Remove'), async () => {
                    if (!(await askConfirm(t('{email} will not see new changes. What they already opened stays with them.', { email: m.email }), { ok: t('Remove'), danger: true }))) return;
                    act(() => Y().removeMember(siteId, m.user))();
                }));
            }
            row.append(acts);
            list.append(row);
        });
        (d.invites || []).filter((i) => i.status === 'pending').forEach((i) => list.append(h('div', { class: 'srv-row' },
            h('span', { class: 'srv-row-text' }, h('span', {}, h('b', { text: i.email }), ' · ', roleText(i.role)),
                h('span', { class: 'srv-sub', text: t('Invited · expires {date}', { date: new Date(i.expires).toLocaleDateString() }) })),
            h('span', { class: 'srv-row-acts' },
                btn(t('Resend'), act(() => T().api('POST', `/api/sites/${siteId}/invites/${i.id}/resend`))),
                btn(t('Cancel'), act(() => T().api('DELETE', `/api/sites/${siteId}/invites/${i.id}`)))))));
        out.push(list);
        if (d.site.status === 'waiting') {
            out.push(para(t('Waiting for the owner to give you access.')));
            const mine = T().keys() ? st.codes[me.id] : '';
            if (mine) out.push(para(t('Your safety code: {code}', { code: mine }), 'srv-p srv-mono'), para(t('Read it to the owner if they ask.'), 'srv-p srv-dim'));
        }
        if (owner) {
            const email = h('input', { type: 'email', class: 'input', autocomplete: 'off', 'data-k': 'inv', oninput: (e) => { st.email = e.target.value; } });
            email.value = st.email;
            const role = h('select', { class: 'select', onchange: (e) => { st.role = e.target.value; } }, ['provider', 'viewer', 'owner'].map((r) => h('option', { value: r, text: roleText(r) })));
            role.value = st.role;
            const lang = h('select', { class: 'select', onchange: (e) => { st.lang = e.target.value; } }, LANGS.map(([v, l]) => h('option', { value: v, text: l })));
            lang.value = st.lang;
            out.push(h('fieldset', { class: 'srv-group' }, h('legend', { text: t('Invite someone') }),
                field(t('Email'), email), field(t('Role'), role), field(t('Language of the email'), lang),
                h('div', { class: 'srv-acts' }, btn(t('Send invitation'), act(async () => { await Y().invite(siteId, st.email.trim(), st.role, st.lang); st.email = ''; showToast(t('Invitation sent.'), 'ok'); }), 'btn primary'))));
            const show = h('input', { type: 'checkbox', onchange: (e) => act(() => Y().setShowName(siteId, e.target.checked))() });
            show.checked = !!d.site.showName;
            out.push(h('fieldset', { class: 'srv-group' }, h('legend', { text: t('Settings') }),
                h('label', { class: 'srv-tick' }, show, h('span', { text: t('Show the name in emails') })),
                para(t('The server can then read the name. Everything else stays encrypted.'), 'srv-p srv-dim'),
                h('div', { class: 'srv-acts' }, btn(t('Lock out anyone who left from new changes'), act(() => Y().rotate(siteId))))));
            // Keep statistics, for the whole site (D162): the server and every
            // monitor keep the hourly figures this long; Off keeps none.
            if (window.TopoMonitors && st.mons) {
                const days = st.mons.statsDays;
                const keep = h('select', { class: 'select', 'aria-label': t('Keep statistics'), onchange: (e) => act(async () => {
                    const r = await TopoMonitors.setStatsDays(siteId, Number(e.target.value));
                    if (r) showToast(t('Saved.'), 'ok');
                })() }, [0, 30, 90, 180, 360, 720, 3650].map((v) => h('option', { value: String(v), text: v === 0 ? t('Off: keep nothing') : v === 3650 ? t('10 years') : v === 360 ? t('360 days (default)') : t('{n} days', { n: v }) })));
                keep.value = String(days);
                out.push(h('fieldset', { class: 'srv-group' }, h('legend', { text: t('Statistics of the site\'s monitors') }),
                    field(t('Keep statistics'), keep),
                    para(t('Hourly figures of every monitor, kept on the server and on each monitor PC for this long. Off keeps none; the states and the issues still show.'), 'srv-p srv-dim')));
            }
            // Backups of this network, while the server makes them (D106, D107).
            if (d.backups && d.backups.on) out.push(h('fieldset', { class: 'srv-group' }, h('legend', { text: t('Backups') }),
                para(d.backups.readable ? t('The server backs this network up, encrypted, and keeps a readable copy too.') : t('The server backs this network up, encrypted.'), 'srv-p srv-dim'),
                h('div', { class: 'srv-acts' }, btn(t('Backups…'), () => openSiteBackups(siteId), 'btn'))));
        }
        const mute = h('input', { type: 'checkbox', onchange: (e) => act(() => T().api('PATCH', `/api/sites/${siteId}/me`, { muted: e.target.checked }))() });
        mute.checked = !!d.site.muted;
        out.push(h('label', { class: 'srv-tick' }, mute, h('span', { text: t('No emails about this site') })));
        out.push(errBox(st.err), h('div', { class: 'srv-acts' },
            d.site.status === 'granted' ? btn(t('History on the server'), () => openHistory(siteId)) : null,
            !owner ? btn(t('Leave this site'), async () => {
                if (!(await askConfirm(t('Leave this site? You can no longer open it from the server.'), { ok: t('Leave'), danger: true }))) return;
                try { await Y().leave(siteId); closeSheet(); render(); } catch (e) { st.err = errText(e); rerender(); }
            }) : null,
            btn(t('Close'), () => closeSheet())));
        return out;
    });
    load();
}
// Give access: the newcomer's safety code compared (A1); after a key
// change the compare is required (A6).
async function giveAccess(siteId, m, code, k) {
    const changed = k && k.state === 'changed';
    let answer;
    if (_responder) answer = await _responder({ kind: 'grant', email: m.email, code, changed });
    else {
        const choices = [{ id: 'checked', label: t('Yes, give access'), primary: true }];
        if (!changed) choices.push({ id: 'unchecked', label: t('Give access without checking') });
        const msg = joinSentences([changed ? t('Their keys changed. If you did not expect this, do not give access.') : '',
            t('Safety code for {email}: {code}', { email: m.email, code }), t('Does {email} see the same code? Ask them to read it from their screen.', { email: m.email })]);
        const id = await askChoice(msg, { title: t('Give access'), choices });
        answer = id ? { checked: id === 'checked', history: true } : null;
    }
    if (!answer) return;
    try { await Y().grant(siteId, [m.user], { checked: !!answer.checked, history: answer.history !== false }); showToast(t('Access given.'), 'ok'); }
    catch (e) { showToast(errText(e), 'err'); }
}
async function openHistory(siteId) {
    let res = null, err = '';
    const authors = {};
    try {
        res = await Y().history(siteId);
        ((await Y().siteDetail(siteId)).members || []).forEach((m) => { authors[m.user] = m.email; });
    } catch (e) { err = errText(e); }
    showSheet(() => t('History on the server'), () => {
        if (!res) return [errBox(err)];
        const out = [para(t('Each copy saved to the server, newest first. Compare the code at the top with another member to check you both see the same history.')),
            h('p', { class: 'srv-recovery', text: `${res.head.n} · ${String(res.head.h).slice(0, 6)}` })];
        const list = h('ul', { class: 'restore-list' });
        res.revs.slice(0, 200).forEach((r) => list.append(h('li', { class: 'restore-row log-row' }, h('div', { class: 'restore-text' },
            h('span', { class: 'restore-when', text: new Date(r.received || r.at).toLocaleString() }),
            h('span', { class: 'restore-why', text: `${r.n} · ${authors[r.author] || t('A former member')}` }),
            h('span', { class: 'restore-n', text: `${Math.ceil((r.size || 0) / 1024)} KB${r.pruned ? ' · ' + t('not kept') : ''}` })))));
        out.push(list, h('div', { class: 'srv-acts' }, btn(t('Close'), () => closeSheet())));
        return out;
    });
}

// ---- Backups (docs/SCOPE.md step 5b, D99-D108) ----
// The server owner's sheet (Account, Backups…): where the server backs every
// network up, when, the readable-copy permission, Test / Save / Back up now /
// Check now, and how it went. Passwords are sent once and never come back:
// a saved one shows "Saved (type to replace)". A network owner's sheet
// (Members, Backups…): the files of that network, each restored through the
// merge (js/backupfile.js) or downloaded as it is, and the readable copy.
const BACKUP_KINDS = { folder: 'A folder on the server', webdav: 'WebDAV (Nextcloud, ownCloud, Synology, QNAP)',
    s3: 'S3-compatible (Backblaze B2, Wasabi, MinIO, AWS)', gdrive: 'Google Drive', onedrive: 'OneDrive' };
const BACKUP_KIND_SHORT = { folder: 'a folder on the server', webdav: 'WebDAV', s3: 'S3', gdrive: 'Google Drive', onedrive: 'OneDrive' };
// 5c (D110): these sign in at the provider (Connect) instead of a password.
const BACKUP_OAUTH = { gdrive: 'Google', onedrive: 'Microsoft' };
// The setup steps for each kind, in docs/SERVER.md (a plain link, not a fetch).
const BACKUP_HELP_BASE = 'https://github.com/MiguelCarino/Topo/blob/main/docs/SERVER.md';
const BACKUP_HELP = { webdav: '#webdav', s3: '#s3-compatible-storage', gdrive: '#google-drive', onedrive: '#onedrive' };
// [name, label, input kind, hint]; 'secret' fields are never shown back.
const BACKUP_FIELDS = {
    folder: [['path', 'Folder', 'text', 'The full path of a folder that already exists on the server, inside one of the folders below.']],
    webdav: [['url', 'Address', 'url', 'The WebDAV address of a folder, for example https://cloud.example.com/remote.php/dav/files/ana/Topo'],
        ['user', 'User name', 'text', ''],
        ['password', 'App password', 'secret', 'Make an app password for Topo in the cloud\'s settings rather than using your own.'],
        ['fingerprint', 'Certificate fingerprint (SHA-256)', 'text', 'Only for a server with its own certificate (a NAS on the network). Empty: the usual checks.']],
    s3: [['endpoint', 'Endpoint', 'url', 'For example https://s3.us-west-004.backblazeb2.com or https://minio.example.lan:9000'],
        ['region', 'Region', 'text', 'For example us-east-1 or us-west-004. Empty: us-east-1.'],
        ['bucket', 'Bucket', 'text', ''],
        ['prefix', 'Folder in the bucket', 'text', 'Empty: topo/'],
        ['keyId', 'Access key ID', 'text', 'Make a key for this bucket only, rather than one for the whole account.'],
        ['secret', 'Secret access key', 'secret', ''],
        ['pathStyle', 'Path-style addresses', 'tick', 'Needed for MinIO and most self-hosted stores.'],
        ['fingerprint', 'Certificate fingerprint (SHA-256)', 'text', 'Only for a server with its own certificate (a NAS on the network). Empty: the usual checks.']],
    gdrive: [['clientId', 'Client ID', 'text', 'From the OAuth app you made for Topo in Google Cloud.'],
        ['clientSecret', 'Client secret', 'secret', '']],
    onedrive: [['clientId', 'Application (client) ID', 'text', 'From the app you registered for Topo in Microsoft Entra.'],
        ['clientSecret', 'Client secret', 'secret', 'Microsoft client secrets expire (24 months at most): make a new one in time.'],
        ['tenant', 'Tenant', 'text', 'Empty: common (personal and work accounts). Or your organisation’s tenant ID.']]
};
// The destination's problem codes (server/internal/backup/dest.go), as the
// emails say them.
const BACKUP_WHY = {
    unreachable: 'The destination did not answer.', refused: 'The destination refused the user name or password.',
    'not-found': 'The backup folder is not there (is the disk connected?).', full: 'The destination is full.',
    'too-large': 'A backup is larger than the destination accepts.', conflict: 'The destination refused the file because it is busy or locked.',
    'bad-answer': 'The destination gave an answer Topo did not expect.', certificate: 'The destination’s certificate is not trusted.',
    secrets: 'The saved passwords could not be read; enter them again.', mismatch: 'A backup read back is not the file that was written.',
    damaged: 'A backup read back is damaged.', other: 'Something went wrong.',
    connect: 'The drive’s sign-in ended: press Connect again in Account, Backups.',
    'client-secret': 'The app’s client ID or client secret was refused (a client secret may have expired): make a new one and paste it.',
    clock: 'This server’s clock is wrong, so the storage refused the request.'
};
const backupWhy = (code) => t(BACKUP_WHY[code] || BACKUP_WHY.other);
// In the app's language (as js/restore.js restoreWhenText), with seconds:
// two backups a minute apart must not read the same.
const whenText = (ms) => {
    try { return new Date(ms).toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'medium' }); }
    catch (e) { return new Date(ms).toLocaleString(); }
};
function backupBrief(data) {
    const c = data && data.config;
    if (!c || !c.enabled || !c.kind) return t('Backups: off');
    const last = data.status && data.status.lastOk ? t('last {time}', { time: whenText(data.status.lastOk) }) : t('none yet');
    return t('Backups: to {where} · {last}', { where: t(BACKUP_KIND_SHORT[c.kind] || c.kind), last });
}
// A backup route's refusal, in words.
function backupErrText(e) {
    const code = e && e.code;
    const d = (e && e.data) || {};
    if (code === 'backup-dest') {
        const fp = d.fingerprint ? ' ' + t('It showed this certificate: {fp}', { fp: d.fingerprint }) : '';
        return backupWhy(d.code) + fp;
    }
    if (code === 'backup-folder-not-allowed') return t('The server may not write to that folder. It may write inside: {folders}', { folders: (d.allowed || []).join(', ') || '—' });
    if (code === 'backup-off') return t('Backups are off. Turn them on first.');
    if (code === 'readable-off') return t('Readable copies are not allowed on this server.');
    if (code === 'oauth-state') return t('That sign-in took too long or was already used. Press Connect again.');
    if (code === 'oauth-denied') return t('The drive did not allow Topo, or the sign-in was cancelled. Press Connect to try again.');
    if (code === 'bad-request' && d.field) {
        const f = Object.values(BACKUP_FIELDS).flat().find((x) => x[0] === d.field);
        return t('Check “{field}”.', { field: f ? t(f[1]) : d.field });
    }
    return errText(e);
}
// A file's bytes as the server sends them (a download is the file itself).
async function rawGet(path) {
    const f = T()._hooks.fetch || window.fetch.bind(window);
    let res;
    try { res = await f(path, { method: 'GET', credentials: 'same-origin', headers: { 'X-Topo': '1' } }); }
    catch (e) { throw new (T().ServerError)(0, 'offline'); }
    if (!res.ok) {
        let d = null;
        try { d = await res.json(); } catch (e) { d = null; }
        throw new (T().ServerError)(res.status, (d && d.error) || 'error', d);
    }
    return res.text();
}
// Opens the newest encrypted backup of a network here, to see that it
// really opens (the server cannot: it holds no key, D104).
async function openLatestBackup(siteId, check) {
    const list = await Y().siteBackups(siteId);
    const b = list.find((x) => x.kind === 'enc' && !x.missing && !x.previousDest);
    if (!b) { showToast(t('This network has no backup yet.')); return false; }
    return openBackupText(await rawGet(`/api/sites/${siteId}/backups/${b.id}`), b.name, check);
}
async function openBackupText(text, name, check) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { showToast(t('That file is not valid JSON.'), 'err'); return false; }
    if (sheetOpen()) closeSheet();
    return openBackupFile(parsed, { fileName: name, check: !!check });
}
function saveText(text, name) { saveBlob(new Blob([text], { type: 'application/json' }), name); }

// Where the provider sends the browser back: on the server machine itself
// http://localhost (Google and Microsoft take no LAN address), else the
// public address (server/internal/api/backups_oauth.go oauthRedirect).
// The server's address, not the page's: in the desktop app's window the
// page is the app's own (tauri://localhost) and the server is
// TopoServer._hooks.origin (js/desktopclient.js).
function oauthRedirectHere(d) {
    let u;
    try { u = new URL(T()._hooks.origin || location.origin); } catch (e) { u = null; }
    const host = u ? u.hostname.replace(/^\[|\]$/g, '') : '';
    if (u && /^https?:$/.test(u.protocol) && (host === 'localhost' || /^127\./.test(host) || host === '::1')) return u.protocol + '//localhost' + (u.port ? ':' + u.port : '') + '/api/backups/oauth/callback';
    return (d && d.oauthRedirect) || (u ? u.origin : location.origin) + '/api/backups/oauth/callback';
}
function navigateTo(url) {
    const nav = T()._hooks.navigate;
    if (typeof nav === 'function') nav(url); else window.location.assign(url);
}
// Back from the provider with '#backup-connect=' (taken off the URL by the
// boot): finish the sign-in, then show the Backups sheet with the result.
async function backupConnectArrived(payload) {
    let q;
    try { q = new URLSearchParams(decodeURIComponent(payload)); } catch (e) { q = new URLSearchParams(); }
    const me = T().me();
    if (!me || me.serverRole !== 'owner') { showToast(t('Sign in as the server owner, then press Connect again.'), 'err'); return; }
    let note = '', err = '';
    try {
        const r = await T().api('POST', '/api/admin/backups/oauth/finish', { state: q.get('state') || '', code: q.get('code') || '', error: q.get('error') || '' });
        const c = r && r.connect || {};
        note = c.account ? t('Connected as {account}.', { account: c.account }) : t('Connected.');
        if (c.code) err = joinSentences([t('The test did not work:'), backupWhy(c.code)]);
    } catch (e) { err = backupErrText(e); }
    await openBackups({ note, err });
}

async function openBackups(arrived) {
    if (!on() || !T().me() || T().me().serverRole !== 'owner') return;
    const st = { data: null, err: (arrived && arrived.err) || '', note: (arrived && arrived.note) || '', busy: false, kind: '', fields: {}, secrets: {}, dailyAt: '02:30', readable: false, touched: false };
    const fromData = () => {
        const c = st.data.config;
        st.kind = c.enabled ? c.kind : '';
        st.savedKind = c.kind;
        st.fields = Object.assign({}, c.fields || {});
        st.secrets = {};
        st.dailyAt = c.dailyAt || '02:30';
        st.readable = !!c.readableAllowed;
    };
    const load = async (keep) => {
        try { st.data = await T().api('GET', '/api/admin/backups'); if (!keep) fromData(); }
        catch (e) { st.err = backupErrText(e); }
        rerender();
    };
    const request = () => {
        const out = { enabled: !!st.kind, dailyAt: st.dailyAt, readableAllowed: st.readable };
        if (st.kind) {
            out.kind = st.kind;
            out.fields = {};
            const secrets = {};
            (BACKUP_FIELDS[st.kind] || []).forEach(([k, , kind]) => {
                if (kind === 'secret') { if (st.secrets[k]) secrets[k] = st.secrets[k]; }
                else if (kind === 'tick') out.fields[k] = st.fields[k] === '1' ? '1' : '';
                else out.fields[k] = String(st.fields[k] || '').trim();
            });
            if (Object.keys(secrets).length) out.secrets = secrets;
        }
        return out;
    };
    const run = (fn) => async () => {
        if (st.busy) return;
        st.busy = true; st.err = ''; st.note = ''; rerender();
        try { await fn(); } catch (e) { st.err = backupErrText(e); }
        st.busy = false; rerender();
    };
    const save = run(async () => {
        try { st.data = await T().api('PUT', '/api/admin/backups', request()); }
        catch (e) {
            if (e.code !== 'backup-dest') throw e;
            const why = backupErrText(e);
            if (!(await askConfirm(joinSentences([t('The test did not work:'), why, t('Save anyway? (For a disk that is not plugged in yet.)')]), { title: t('Backups'), ok: t('Save anyway') }))) { st.err = why; return; }
            st.data = await T().api('PUT', '/api/admin/backups?force=1', request());
        }
        fromData();
        st.note = t('Saved.');
    });
    const test = run(async () => { await T().api('POST', '/api/admin/backups/test', request()); st.note = t('The test worked: Topo wrote a file there, read it back and deleted it.'); });
    // Connect (D110): the server keeps what was typed for 10 minutes and
    // answers the provider's sign-in page; the provider brings the browser
    // back to /#backup-connect=…, which backupConnectArrived() finishes.
    const connect = run(async () => {
        const r = await T().api('POST', '/api/admin/backups/oauth/start', request());
        st.note = t('Opening the sign-in page of {provider}…', { provider: BACKUP_OAUTH[st.kind] || '' });
        rerender();
        navigateTo(r.url);
    });
    const backupNow = run(async () => { await T().api('POST', '/api/admin/backups/run'); st.note = t('Backing up now. The status below shows how it went.'); setTimeout(() => load(true), 2000); });
    const checkNow = run(async () => { await T().api('POST', '/api/admin/backups/check'); st.note = t('Checking now. The status below shows how it went.'); setTimeout(() => load(true), 2000); });
    showSheet(() => t('Backups'), () => {
        const d = st.data;
        if (!d) return [statusBox(t('Loading…')), errBox(st.err)];
        const out = [para(t('The server keeps an encrypted copy of every network on a drive you choose: daily, and a few minutes after changes. The drive cannot read them; an owner opens one with their recovery key.'), 'srv-p srv-dim')];
        const where = h('select', { class: 'select', 'data-k': 'kind', onchange: (e) => { st.kind = e.target.value; st.secrets = {}; st.fields = st.kind === st.savedKind ? Object.assign({}, st.data.config.fields || {}) : {}; rerender(); } },
            h('option', { value: '', text: t('Off') }), (d.kinds || Object.keys(BACKUP_KINDS)).filter((k) => BACKUP_KINDS[k]).map((k) => h('option', { value: k, text: t(BACKUP_KINDS[k]) })));
        where.value = st.kind;
        out.push(field(t('backups::Where'), where));
        if (BACKUP_HELP[st.kind]) {
            out.push(h('p', { class: 'srv-p srv-dim' }, h('a', { href: BACKUP_HELP_BASE + BACKUP_HELP[st.kind], class: 'srv-help', target: '_blank', rel: 'noopener noreferrer', 'data-k': 'help', text: t('How to set this up') })));
        }
        (BACKUP_FIELDS[st.kind] || []).forEach(([k, label, kind, hint]) => {
            if (kind === 'tick') {
                const tk = h('input', { type: 'checkbox', 'data-k': 'f-' + k, onchange: (e) => { st.fields[k] = e.target.checked ? '1' : ''; } });
                tk.checked = st.fields[k] === '1';
                out.push(h('label', { class: 'srv-tick' }, tk, h('span', { text: t(label) })));
                if (hint) out.push(para(t(hint), 'srv-p srv-dim'));
                return;
            }
            const secret = kind === 'secret';
            const saved = secret && st.kind === st.savedKind && (d.config.secretsSet || []).includes(k);
            const input = h('input', { type: secret ? 'password' : kind === 'url' ? 'url' : 'text', class: 'input', 'data-k': 'f-' + k,
                autocomplete: secret ? 'new-password' : 'off', autocapitalize: 'none', spellcheck: 'false', inputmode: kind === 'url' ? 'url' : undefined,
                placeholder: saved ? t('Saved (type to replace)') : undefined,
                oninput: (e) => { if (secret) st.secrets[k] = e.target.value; else st.fields[k] = e.target.value; } });
            input.value = secret ? (st.secrets[k] || '') : (st.fields[k] || '');
            let hintText = hint ? t(hint) : '';
            if (k === 'path' && (d.allowedFolders || []).length) hintText = joinSentences([hintText, t('Allowed: {folders}', { folders: d.allowedFolders.join(', ') })]);
            out.push(field(t(label), input, hintText));
        });
        if (d.config.secretsError) out.push(para(backupWhy('secrets'), 'srv-p srv-warn'));
        if (BACKUP_OAUTH[st.kind]) {
            const linked = st.kind === st.savedKind && d.config.connected;
            const box = h('fieldset', { class: 'srv-group', 'data-k': 'connect' }, h('legend', { text: t('Connection') }));
            // The desktop app's window cannot finish it: the provider brings
            // a browser back, signed in there or not, and the server ties
            // the sign-in to the session that started it (D196, D200).
            const inApp = !!T()._hooks.desktop;
            if (linked || !inApp) box.append(para(linked ? (d.config.account ? t('Connected as {account}.', { account: d.config.account }) : t('Connected.'))
                : t('Not connected yet. Connect opens the sign-in page of {provider}; after you allow Topo, it brings you back here.', { provider: BACKUP_OAUTH[st.kind] }), 'srv-p'));
            box.append(para(t('Topo asks only for its own folder: it cannot see your other files.'), 'srv-p srv-dim'));
            box.append(para(t('Redirect address to register in the app: {url}', { url: oauthRedirectHere(d) }), 'srv-p srv-dim'));
            if (inApp) {
                box.append(para(t('In this window, Connect cannot finish: {provider} sends you back to a browser, not to this window. Open the server in a browser, sign in as the owner, and press Connect in Backups there.', { provider: BACKUP_OAUTH[st.kind] })));
                box.append(h('div', { class: 'srv-acts' }, btn(t('Open the server in a browser'), () => navigateTo(T()._hooks.origin + '/'), 'btn')));
            } else box.append(h('div', { class: 'srv-acts' }, btn(linked ? t('Connect again') : t('Connect'), connect, linked ? 'btn' : 'btn primary')));
            out.push(box);
        }
        if (st.kind) {
            const time = h('input', { type: 'time', class: 'input', 'data-k': 'daily', value: st.dailyAt, oninput: (e) => { st.dailyAt = e.target.value || '02:30'; } });
            time.value = st.dailyAt;
            out.push(field(t('Every day at'), time, t('Networks that changed are backed up then, and a few minutes after each change.')));
            const rd = h('input', { type: 'checkbox', 'data-k': 'readable', onchange: (e) => { st.readable = e.target.checked; rerender(); } });
            rd.checked = st.readable;
            out.push(h('label', { class: 'srv-tick' }, rd, h('span', { text: t('Also allow readable copies') })));
            if (st.readable) out.push(para(t('A readable copy can be read by anyone with access to the drive, passwords in notes included. Each network\'s owner still has to turn it on.'), 'srv-p srv-warn'));
        }
        out.push(errBox(st.err), statusBox(st.note || (st.busy ? t('Working…') : '')));
        out.push(h('div', { class: 'srv-acts' },
            btn(t('Save'), save, 'btn primary'),
            st.kind ? btn(t('Test'), test) : null,
            d.config.enabled ? btn(t('backups::Back up now'), backupNow) : null,
            d.config.enabled ? btn(t('Check now'), checkNow) : null));
        // How it went.
        const s = d.status || {};
        const lines = [];
        if (d.config.enabled) {
            lines.push(s.lastOk ? t('Last backup: {time}', { time: whenText(s.lastOk) }) : t('No backup yet.'));
            if (s.lastError) lines.push(t('Last problem: {why} ({time})', { why: backupWhy(s.lastError.code), time: whenText(s.lastError.at) }));
            if (s.nextRun) lines.push(t('Next daily backup: {time}', { time: whenText(s.nextRun) }));
            if (s.backoffUntil && s.backoffUntil > Date.now()) lines.push(t('Trying again at {time}', { time: whenText(s.backoffUntil) }));
            if (s.markerOwed) lines.push(t('Saved without a test: connect the disk, then press Save again to start backing up there.'));
            if (s.dropNote === 'locked') lines.push(t('The bucket keeps files locked; Topo cannot delete old backups there.'));
            if (s.lastCheck) lines.push(s.lastCheck.ok ? t('Last check: passed {time}', { time: whenText(s.lastCheck.at) }) : t('Last check: failed, {why} ({time})', { why: backupWhy(s.lastCheck.code), time: whenText(s.lastCheck.at) }));
            const missing = (d.sites || []).reduce((n, x) => n + (x.missing || 0), 0);
            if (missing) lines.push(t('{n} backups are missing from the destination.', { n: missing }));
            if (d.previousDest) lines.push(t('{n} older backups are on an earlier destination.', { n: d.previousDest }));
        }
        if (lines.length) out.push(h('fieldset', { class: 'srv-group' }, h('legend', { text: t('backups::Status') }), lines.map((l) => para(l, 'srv-p'))));
        // Networks.
        if ((d.sites || []).length) {
            const box = h('fieldset', { class: 'srv-group' }, h('legend', { text: t('Networks') }));
            d.sites.forEach((x) => {
                const mine = T().site(x.site);
                const owner = mine && mine.role === 'owner' && mine.status === 'granted';
                box.append(h('div', { class: 'srv-row' },
                    h('span', { class: 'srv-row-text' }, h('b', { text: x.name || t('A network') }),
                        h('span', { class: 'srv-sub', text: [t(x.count === 1 ? '1 backup' : '{n} backups', { n: x.count }), x.last ? t('last {time}', { time: whenText(x.last) }) : ''].filter(Boolean).join(' · ') })),
                    owner ? h('span', { class: 'srv-row-acts' }, btn(t('Open the latest backup here'), run(() => openLatestBackup(x.site, true)))) : null));
            });
            box.append(para(t('Opening a backup here is the full test: the server cannot open them itself.'), 'srv-p srv-dim'));
            out.push(box);
        }
        if ((d.deleted || []).length) {
            const box = h('fieldset', { class: 'srv-group' }, h('legend', { text: t('Deleted networks') }));
            d.deleted.forEach((x) => box.append(h('div', { class: 'srv-row' },
                h('span', { class: 'srv-row-text' }, h('b', { text: x.name || t('A network') }), h('span', { class: 'srv-sub', text: t(x.count === 1 ? '1 backup' : '{n} backups', { n: x.count }) })),
                h('span', { class: 'srv-row-acts' },
                    btn(t('Download the latest'), run(async () => {
                        const list = ((await T().api('GET', `/api/admin/backups/deleted/${x.site}`)) || {}).backups || [];
                        const b = list.find((y) => y.kind === 'enc' && !y.missing && !y.previousDest);
                        if (!b) throw Object.assign(new Error('not-found'), { code: 'not-found' });
                        saveText(await rawGet(`/api/admin/backups/files/${b.id}`), b.name);
                    })),
                    btn(t('Delete'), run(async () => {
                        if (!(await askConfirm(t('Delete every backup of this deleted network? This cannot be undone.'), { ok: t('Delete'), danger: true }))) return;
                        await T().api('DELETE', `/api/admin/backups/deleted/${x.site}`);
                        await load(true);
                    }), 'btn danger')))));
            out.push(box);
        }
        out.push(h('div', { class: 'srv-acts' }, btn(t('Close'), () => closeSheet())));
        return out;
    });
    load();
}

// A network's backups (its owners; Members, Backups…).
async function openSiteBackups(siteId) {
    if (!on() || !T().ready()) return;
    const st = { list: null, d: null, err: '', busy: false };
    const load = async () => {
        try { st.d = await Y().siteDetail(siteId, true); st.list = await Y().siteBackups(siteId); }
        catch (e) { st.err = backupErrText(e); }
        rerender();
    };
    const run = (fn) => async () => {
        if (st.busy) return;
        st.busy = true; st.err = ''; rerender();
        try { await fn(); } catch (e) { st.err = backupErrText(e); }
        st.busy = false; rerender();
    };
    showSheet(() => t('Backups'), () => {
        if (!st.list) return [statusBox(t('Loading…')), errBox(st.err)];
        const b = (st.d && st.d.backups) || {};
        const out = [para(t('Restoring goes through the merge, so you see every change first and a restore point is kept. To go back to how it was, choose Replace with this copy, or open it as a copy.'), 'srv-p srv-dim')];
        const list = h('div', { class: 'srv-list' });
        if (!st.list.length) list.append(para(t('No backups yet.'), 'srv-p'));
        st.list.forEach((x) => {
            const flags = [x.kind === 'readable' ? t('Readable') : t('Encrypted'), `${Math.max(1, Math.ceil((x.size || 0) / 1024))} KB`];
            if (x.missing) flags.push(t('Missing'));
            if (x.previousDest) flags.push(t('On an earlier destination'));
            const can = !x.missing && !x.previousDest;
            list.append(h('div', { class: 'srv-row' + (x.missing ? ' srv-danger' : '') },
                h('span', { class: 'srv-row-text' }, h('b', { text: whenText(x.at) }), h('span', { class: 'srv-sub', text: flags.join(' · ') })),
                can ? h('span', { class: 'srv-row-acts' },
                    x.kind === 'enc' ? btn(t('Restore…'), run(async () => openBackupText(await rawGet(`/api/sites/${siteId}/backups/${x.id}`), x.name))) : null,
                    btn(t('Download'), run(async () => saveText(await rawGet(`/api/sites/${siteId}/backups/${x.id}`), x.name)))) : null));
        });
        out.push(list);
        if (b.readableAllowed || b.readable) {
            const tick = h('input', { type: 'checkbox', 'data-k': 'readable', onchange: (e) => run(async () => {
                const want = e.target.checked;
                if (want && !(await askConfirm(joinSentences([t('A readable copy can be read by anyone with access to the drive, passwords in notes included.'),
                    t('The server passes it to the drive, so whoever runs the server could read it too. It is made by an owner\'s browser after changes, so it is only as recent as the last time an owner opened this network.')]),
                { title: t('Keep a readable copy too'), ok: t('Turn it on') }))) { e.target.checked = false; return; }
                await Y().setReadable(siteId, want);
                if (!want && (st.list || []).some((x) => x.kind === 'readable')
                    && await askConfirm(t('Delete the readable copies already made? The encrypted backups stay.'), { ok: t('Delete'), danger: true })) await Y().deleteReadable(siteId);
                await load();
            })() });
            tick.checked = !!b.readable;
            out.push(h('label', { class: 'srv-tick' }, tick, h('span', { text: t('Keep a readable copy too') })));
            out.push(para(t('Off by default: a readable copy is not end-to-end encrypted.'), 'srv-p srv-dim'));
        }
        out.push(errBox(st.err), h('div', { class: 'srv-acts' }, btn(t('Back'), () => openMembers(siteId)), btn(t('Close'), () => closeSheet())));
        return out;
    });
    load();
}

// ---- Cards: the line and the tools ----
const STATE_TEXT = {
    synced: 'Synced', pushing: 'Saving to the server…', pulling: 'Checking the server…', pending: 'Changes not saved to the server yet',
    proposed: 'Your changes go to the owner when you record a visit', 'visit-waiting': 'Your visit is waiting for the owner\'s review',
    offline: 'Offline: {n} local changes', 'needs-merge': 'Needs merge: tap to review', waiting: 'Waiting for the owner to give you access',
    locked: 'Open this account on this browser first', 'history-mismatch': 'The server sent an older or different history',
    removed: 'You were removed from this site', 'update-needed': 'Saved by a newer Topo. Reload or update to open it.', error: 'Not saved to the server',
    'signed-out': 'Sign in to keep it in step with the server'
};
const STATE_CLS = { synced: 'ok', pushing: 'busy', pulling: 'busy', pending: 'busy', proposed: 'busy', 'visit-waiting': 'busy', offline: 'warn', 'needs-merge': 'warn', waiting: 'warn', locked: 'warn',
    'history-mismatch': 'bad', removed: 'bad', 'update-needed': 'warn', error: 'bad', 'signed-out': 'warn' };
function syncText(s) {
    if (!s) return '';
    let text = t(STATE_TEXT[s.state] || 'Synced', { n: s.changes || 0 });
    if (s.state === 'needs-merge' && s.long) text = t('Not saved to the server for a day');
    if (s.state === 'error' && s.err) text = joinSentences([text + '.', errText({ code: s.err })]);
    if (s.role === 'viewer' && s.state === 'synced') text = joinSentences([t('Synced'), t('You can look, not change.')]);
    return text;
}
window.serverCardText = (cardId) => {
    if (!on() || !Y()) return null;
    const s = Y().cardSync(cardId);
    return s ? { text: '☁ ' + syncText(s), cls: STATE_CLS[s.state] || '', state: s.state } : null;
};
window.serverCardTools = (entry, tool) => {
    if (!on() || !Y() || entry.template || entry.block) return;
    const s = Y().cardSync(entry.id);
    const me = T().me();
    if (!s) {
        if (T().ready() && me && me.canCreate && !migrateDoc(entry.doc).newer) tool('☁', t('Put on the server'), () => putOnServer(entry.id));
        return;
    }
    if (s.state === 'needs-merge') tool('⇆', t('Review merge'), () => Y().reviewMerge(entry.id).then(render));
    if (s.state === 'history-mismatch') tool('!', t('Trust the server\'s history'), async () => {
        if (await askConfirm(t('Use the history the server sends now? Only do this if the person who runs the server says it was restored on purpose.'), { ok: t('Trust it'), danger: true })) Y().trustServerHistory(entry.id);
    });
    if (['offline', 'error', 'pending'].includes(s.state)) tool('⟳', t('Sync now'), () => Y().syncNow(entry.id).then(render));
    if (T().site(s.siteId)) tool('👥', t('Members'), () => openMembers(s.siteId));
};
window.serverDeleteQuestion = async (entry) => {
    if (!on() || !Y() || !Y().rec(entry.id)) return false;
    const r = Y().rec(entry.id);
    const site = T().site(r.siteId);
    const choices = [{ id: 'local', label: t('Remove from this browser'), primary: true }];
    if (site && site.role === 'owner' && site.status === 'granted') choices.push({ id: 'everyone', label: t('Delete the site for everyone') });
    let how = _responder ? await _responder({ kind: 'delete', name: entry.name, owner: choices.length > 1 }) : await askChoice(t('"{name}" is on the server. Remove it from this browser only (it stays on the server), or delete it for everyone?', { name: entry.name }), { title: t('Delete'), choices });
    if (how === 'everyone' && !_responder && !(await askConfirm(t('Delete "{name}" for everyone? Every member loses it from the server. This cannot be undone.', { name: entry.name }), { ok: t('Delete'), danger: true }))) how = null;
    if (!how) return true;
    try { await Y().removeCard(entry.id, how); } catch (e) { showToast(errText(e), 'err'); }
    return true;
};
window.serverDocBar = (bar, status) => {
    let b = document.getElementById('docBarSync');
    const s = on() && Y() && state.libraryId ? Y().cardSync(state.libraryId) : null;
    if (!s) { if (b) b.hidden = true; return; }
    if (!b) {
        b = h('button', { type: 'button', id: 'docBarSync', class: 'docbar-sync', onclick: () => openSyncSheet(state.libraryId) });
        bar.appendChild(b);
    }
    b.hidden = false;
    b.className = 'docbar-sync ' + (STATE_CLS[s.state] || '');
    const short = { synced: 'Synced', pushing: 'Saving…', pulling: 'Saving…', pending: 'Saving…', proposed: 'Proposed', 'visit-waiting': 'With the owner', offline: 'Offline · {n}', 'needs-merge': 'Merge', error: 'Not saved' }[s.state] || 'Server';
    b.textContent = '☁ ' + t(short, { n: s.changes || 0 });
    b.title = syncText(s);
    b.setAttribute('aria-label', syncText(s));
};
function openSyncSheet(cardId) {
    const r = Y().rec(cardId);
    if (!r) return;
    showSheet(() => t('On the server'), () => {
        const s = Y().cardSync(cardId);
        if (!s) return [];
        return [h('p', { class: 'srv-status', role: 'status', text: syncText(s) }), h('div', { class: 'srv-acts srv-stack' },
            s.state === 'needs-merge' ? btn(t('Review merge'), () => { closeSheet(); Y().reviewMerge(cardId).then(render); }, 'btn primary') : null,
            btn(t('Sync now'), () => Y().syncNow(cardId).then(rerender)),
            T().site(s.siteId) ? btn(t('Members'), () => openMembers(s.siteId)) : null,
            btn(t('Account'), () => openAccount()),
            btn(t('Close'), () => closeSheet()))];
    });
}

// ---- Put on the server, open from the server ----
async function putOnServer(cardId) {
    const entry = libraryEntry(cardId);
    if (!entry) return;
    const show = _responder ? !!(await _responder({ kind: 'show-name', name: entry.name }))
        : (await askChoice(t('Show this network\'s name in emails about it? The server can then read the name. Everything else stays encrypted.'), { title: t('Put on the server'),
            choices: [{ id: 'no', label: t('No, keep the name private'), primary: true }, { id: 'yes', label: t('Yes, show the name') }] })) === 'yes';
    try {
        showToast(t('Saving to the server…'), 'ok');
        await Y().putCard(cardId, { showName: show });
        showToast(t('"{name}" is on the server.', { name: entry.name }), 'ok');
    } catch (e) { showToast(errText(e), 'err'); }
    render();
}
async function pickToPut() {
    const onServer = Y().serverCardIds();
    const rows = libraryNetworks().filter((e) => !onServer.has(e.id) && !migrateDoc(e.doc).newer).map((e) => ({ id: e.id, label: e.name, detail: libraryWhen(e.updated) }));
    if (!rows.length) { tell(t('Keep a network in this browser first, then put it on the server.')); return; }
    const id = await askPick(t('Which network goes on the server?'), { title: t('Put a network on the server'), rows, ok: t('Put on the server') });
    if (id) putOnServer(id);
}
async function openFromServer(siteId) {
    try {
        await Y().openSite(siteId, async (kind) => (_responder ? _responder({ kind }) : askConfirm(t('This browser already has this network. Merge it with the server\'s copy?'), { ok: t('Merge') })));
    } catch (e) { showToast(errText(e), 'err'); }
    render();
}

// ---- The landing's section ----
const _names = new Map();   // siteId -> decrypted name
let _mySafety = '';
async function decryptNames() {
    for (const s of T().state.sites) {
        if (s.status !== 'granted' || !s.nameCt || _names.has(s.id)) continue;
        try { const n = await Y().siteName(s.id); if (n) { _names.set(s.id, n); render(); } } catch (e) { /* the clear name or nothing */ }
    }
    const k = T().keys();
    if (k && !_mySafety) { _mySafety = await C.safetyCode(k.encPub, k.sigPub); render(); }
}
function stubCard(name, line, cls, actions) {
    const card = h('div', { class: 'landing-card server-stub' });
    card.append(h('div', { class: 'landing-card-open server-stub-body' },
        h('span', { class: 'landing-card-name', text: name }),
        h('span', { class: 'landing-card-sync ' + (cls || ''), text: line })));
    if (actions.length) card.append(h('div', { class: 'landing-card-tools guest' }, actions));
    return card;
}
function renderServerSection() {
    const section = document.getElementById('landingServer');
    if (!section) return;
    const none = !on() || T().state.status === 'off' || T().state.status === 'checking' || T().state.status === 'unreachable';
    // A server's page starts on the server: its section (and Sign in) comes
    // before the ways to start a network in this browser (D425, css/app.css).
    const landing = document.getElementById('landing');
    if (landing) landing.classList.toggle('served', !none);
    if (none) { section.hidden = true; return; }
    section.hidden = false;
    const st = T().state.status;
    const me = T().me();
    const acct = document.getElementById('serverAccountBtn');
    const waiting = (me && (me.waitingGrants || 0) + (me.linkRequests || 0)) || 0;
    acct.textContent = me ? `👤 ${me.email}` : t('Sign in');
    acct.classList.toggle('badge', waiting > 0);
    acct.setAttribute('aria-label', me ? t('Account: {email}', { email: me.email }) + (waiting ? ' · ' + t('Something is waiting for you') : '') : t('Sign in'));
    const put = document.getElementById('serverPutBtn');
    put.hidden = !(st === 'ready' && me && me.canCreate);
    const list = document.getElementById('serverCards');
    const status = document.getElementById('serverStatus');
    list.replaceChildren();
    status.textContent = st === 'insecure' ? t('This server needs https before networks can be kept on it.')
        : st === 'signed-out' ? t('Sign in to see the networks kept on this server.')
        : st === 'needs-keys' ? t('Set up this browser to keep networks on this server.')
        : st === 'locked' ? t('Open your account on this browser to see your networks.') : '';
    const next = document.getElementById('serverNextBtn');
    next.hidden = !['signed-out', 'needs-keys', 'locked'].includes(st);
    next.textContent = st === 'signed-out' ? t('Sign in') : st === 'needs-keys' ? t('Set up this browser') : t('Open your account on this browser');
    if (st !== 'ready' && st !== 'locked' && st !== 'needs-keys') return;
    const linked = Y().serverCardIds();
    // This browser's cards on the server.
    libraryEntries().filter((e) => linked.has(e.id)).forEach((e) => list.appendChild(landingCard(e)));
    // Sites on the server not opened here yet, and memberships waiting.
    T().state.sites.forEach((s) => {
        const r = Y().recBySite(s.id);
        if (r && linked.has(r.cardId)) return;
        const name = _names.get(s.id) || (s.nameClear ? t('{name} (name given by the server)', { name: s.nameClear }) : t('A shared network'));
        if (s.status === 'waiting') {
            list.appendChild(stubCard(name, joinSentences([t('Waiting for the owner to give you access.'), _mySafety ? t('Your safety code: {code}', { code: _mySafety }) : '']), 'warn',
                [btn(t('Members'), () => openMembers(s.id), 'landing-tool wide')]));
        } else {
            list.appendChild(stubCard(name, t('On the server, not opened here yet'), '', [btn(t('Open'), () => openFromServer(s.id), 'landing-tool wide')]));
        }
    });
    T().state.invites.forEach((i) => list.appendChild(stubCard(i.nameClear ? t('{name} (name given by the server)', { name: i.nameClear }) : t('A shared network'),
        t('{inviter} invited you as {role}', { inviter: i.inviter || t('Someone'), role: roleText(i.role) }), 'warn',
        [btn(t('Accept'), () => acceptInviteById(i.id), 'landing-tool wide')])));
    if (!list.children.length && st === 'ready') status.textContent = me && me.canCreate ? t('Nothing on this server yet. Put a network on it to share it with your provider or your team.') : t('Nothing shared with you on this server yet.');
    decryptNames();
}
async function acceptInviteById(id) {
    try { await T().api('POST', '/api/invites/accept', { id }); await T().refreshSites(); showToast(t('Invitation accepted. Waiting for the owner to give you access.'), 'ok'); }
    catch (e) { showToast(errText(e), 'err'); }
    render();
}
// Someone accepted an invitation, or needs access again (D61): the badge, and once a toast.
const _told = new Set();
function waitingArrived(siteId) {
    render();
    if (_told.has(siteId)) return;
    _told.add(siteId);
    const name = _names.get(siteId) || (Y().recBySite(siteId) && libraryEntry(Y().recBySite(siteId).cardId) || {}).name || t('a shared network');
    showToast(t('Someone is waiting for access to {site}. Open Members to give it.', { site: name }), 'ok');
}
function linkRequested() { render(); showToast(t('A new browser wants to open your account. Open Account to approve it.'), 'ok'); }

// Redraw what shows the server: the landing section, the cards, the bar.
let _renderQueued = false;
function render() {
    if (!on() || _renderQueued) return;
    _renderQueued = true;
    Promise.resolve().then(() => {
        _renderQueued = false;
        if (typeof landingIsOpen === 'function' && landingIsOpen()) renderLanding();
        if (typeof renderDocBar === 'function') renderDocBar();
    });
}
window.serverLocale = () => { if (!on()) return; rerender(); render(); };
window.renderServerSection = () => {
    if (on()) { renderServerSection(); return; }
    const s = document.getElementById('landingServer'); if (s) s.hidden = true;
    const l = document.getElementById('landing'); if (l) l.classList.remove('served');
};
window.serverSendRoute = (cardId, providerIds) => (on() && Y() ? Y().provider.sendRoute(cardId, providerIds) : null);
window.serverMailRoute = (cardId) => (on() && Y() ? Y().provider.mailRoute(cardId) : null);
window.serverReportMail = (siteId, body) => (on() && Y() ? Y().provider.reportMail(siteId, body) : Promise.reject(new Error('no server')));
window.serverReturnRoute = (cardId) => (on() && Y() ? Y().provider.returnRoute(cardId) : false);
window.serverPushNow = (cardId) => { if (on() && Y() && cardId) Y().syncNow(cardId); };
// A provider member on this card's site: its visits go to the owner as visit
// copies (docs/SCOPE.md D154).
window.serverIsProvider = (cardId) => { const r = on() && Y() && cardId ? Y().rec(cardId) : null; return !!r && r.role === 'provider'; };
window.serverUploadVisit = (cardId, info) => Y().uploadVisit(cardId, info);

// Wired once the client opens (js/server.js), never on a static page.
let _wired = false;
function wire() {
    if (_wired) return;
    _wired = true;
    const scrim = document.getElementById('serverSheet');
    if (scrim) scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet('dismissed')));
    document.getElementById('serverAccountBtn').addEventListener('click', () => (T().me() ? openAccount() : openSignIn()));
    document.getElementById('serverPutBtn').addEventListener('click', pickToPut);
    document.getElementById('serverNextBtn').addEventListener('click', () => {
        const st = T().state.status;
        if (st === 'signed-out') openSignIn();
        else if (st === 'locked') openUnlock();
        else if (st === 'needs-keys') T().ensureKeys(true).then(render);
    });
    // The provider's send step needs to know the members first.
    T().on('changed', () => { if (state.libraryId && Y()) Y().provider.warmMembers(state.libraryId); });
}
window.TopoServerUI = {
    render: () => { if (on()) { wire(); render(); rerender(); } },
    linkArrived: (tok) => { wire(); linkArrived(tok); },
    inviteArrived: (tok) => { wire(); inviteArrived(tok); },
    backupConnectArrived: (payload) => { wire(); return backupConnectArrived(payload); },
    showRecoveryCode, waitingArrived, linkRequested,
    openSignIn, openAccount, openUnlock, openMembers, openHistory, openBackups, openSiteBackups, openLatestBackup, backupErrText, backupBrief, BACKUP_WHY, openSyncSheet, putOnServer, pickToPut, openFromServer, closeSheet, sheetOpen,
    setServerResponder, errText, syncText, ERR, STATE_TEXT, NOTIFY
};
})();
