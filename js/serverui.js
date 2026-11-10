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
const ROLE = { owner: 'Owner', provider: 'Provider', viewer: 'Viewer' };
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
    'storage': 'Could not save — browser storage is unavailable (private mode or full).'
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
        return [para(t('If {email} can sign in here, a code is on its way. Type it here, or open the link in the email in this browser.', { email: st.email })),
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
            if (me.serverRole === 'owner') st.people = (await T().api('GET', '/api/admin/users')).users || [];
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

// ---- Cards: the line and the tools ----
const STATE_TEXT = {
    synced: 'Synced', pushing: 'Saving to the server…', pulling: 'Checking the server…', pending: 'Changes not saved to the server yet',
    offline: 'Offline: {n} local changes', 'needs-merge': 'Needs merge: tap to review', waiting: 'Waiting for the owner to give you access',
    locked: 'Open this account on this browser first', 'history-mismatch': 'The server sent an older or different history',
    removed: 'You were removed from this site', 'update-needed': 'Saved by a newer Topo. Reload or update to open it.', error: 'Not saved to the server',
    'signed-out': 'Sign in to keep it in step with the server'
};
const STATE_CLS = { synced: 'ok', pushing: 'busy', pulling: 'busy', pending: 'busy', offline: 'warn', 'needs-merge': 'warn', waiting: 'warn', locked: 'warn',
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
    const short = { synced: 'Synced', pushing: 'Saving…', pulling: 'Saving…', pending: 'Saving…', offline: 'Offline · {n}', 'needs-merge': 'Merge', error: 'Not saved' }[s.state] || 'Server';
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
    if (!on() || T().state.status === 'off' || T().state.status === 'checking' || T().state.status === 'unreachable') { section.hidden = true; return; }
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
window.renderServerSection = () => { if (on()) renderServerSection(); else { const s = document.getElementById('landingServer'); if (s) s.hidden = true; } };
window.serverSendRoute = (cardId, providerIds) => (on() && Y() ? Y().provider.sendRoute(cardId, providerIds) : null);
window.serverReturnRoute = (cardId) => (on() && Y() ? Y().provider.returnRoute(cardId) : false);
window.serverPushNow = (cardId) => { if (on() && Y() && cardId) Y().syncNow(cardId); };

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
    showRecoveryCode, waitingArrived, linkRequested,
    openSignIn, openAccount, openUnlock, openMembers, openHistory, openSyncSheet, putOnServer, pickToPut, openFromServer, closeSheet, sheetOpen,
    setServerResponder, errText, syncText, ERR, STATE_TEXT, NOTIFY
};
})();
